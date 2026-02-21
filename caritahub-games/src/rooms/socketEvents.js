'use strict';

const roomManager = require('./roomManager');
const { createGame: createXiangqiGame } = require('../engine/xiangqi');
const { createGame: createChessGame }   = require('../engine/chess');
const analytics = require('../analytics/clickhouse');

// Active game engines per room
const engines = new Map();
// Game type per room ('xiangqi' | 'chess')
const roomGameTypes = new Map();

// Per-IP join rate limiter (max 10 new joins per minute; reconnects are exempt)
const joinCounts = new Map();
function checkJoinRate(ip) {
  const now = Date.now();
  const entry = joinCounts.get(ip) || { count: 0, resetAt: now + 60_000 };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 60_000; }
  entry.count++;
  joinCounts.set(ip, entry);
  return entry.count <= 10;
}

function roomSnapshot(room) {
  return {
    players: room.players.map(p => ({ name: p.name, color: p.color, connected: p.socketId !== null })),
    spectators: room.spectators.map(s => s.name)
  };
}

function gameStatePayload(roomId, room, engine) {
  const isOver = engine.isGameOver();
  let winner = null;
  if (isOver) {
    // Chess engine exposes winner() directly (handles stalemate draw)
    if (typeof engine.winner === 'function') {
      winner = engine.winner();
    } else {
      // Xiangqi: losing side is the one whose turn it is at game over
      winner = engine.turn() === 'w' ? 'black' : 'red';
    }
  }
  return {
    fen: engine.fen(),
    turn: engine.turn(),   // 'w' | 'b'
    inCheck: engine.inCheck(),
    isGameOver: isOver,
    winner,
    players: room.players.map(p => ({ name: p.name, color: p.color, connected: p.socketId !== null }))
  };
}

module.exports = function wireEvents(io) {
  io.on('connection', socket => {
    console.log('connect', socket.id);

    // ── Ping/pong test ──────────────────────────────────────────────
    socket.on('ping', () => socket.emit('pong', { time: Date.now() }));

    // ── Join / Create room ──────────────────────────────────────────
    // Accepts both 'join_game' (new standard) and 'join_xiangqi' (backward compat)
    const handleJoin = ({ roomId, playerName, reconnect, gameType = 'xiangqi' }) => {
      if (!reconnect) {
        const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
        if (!checkJoinRate(ip)) {
          return socket.emit('error', { message: 'Too many join attempts. Please wait a moment.' });
        }
      }
      if (!playerName || !playerName.trim()) {
        return socket.emit('error', { message: 'Please enter your name.' });
      }
      const name = playerName.trim().slice(0, 30);

      let targetRoomId = roomId;
      if (!targetRoomId) {
        const colors = gameType === 'chess' ? ['white', 'black'] : ['red', 'black'];
        targetRoomId = roomManager.createRoom({ colors });
        roomGameTypes.set(targetRoomId, gameType);
      }

      const result = roomManager.joinRoom(targetRoomId, socket.id, name);
      if (result.error) {
        return socket.emit('error', { message: result.error });
      }

      socket.join(targetRoomId);
      socket.data.roomId = targetRoomId;
      socket.data.playerName = name;
      socket.data.color = result.color;

      socket.emit('joined', {
        roomId: targetRoomId,
        color: result.color,
        reconnected: result.reconnected
      });

      const room = result.room;

      // If game already in progress, send current state to reconnecting player
      if (engines.has(targetRoomId)) {
        const engine = engines.get(targetRoomId);
        socket.emit('game_state', gameStatePayload(targetRoomId, room, engine));
      }

      io.to(targetRoomId).emit('room_update', roomSnapshot(room));
      analytics.logEvent('player_joined', targetRoomId, socket.id, name, { color: result.color, gameType });
    };

    socket.on('join_game',    handleJoin);
    socket.on('join_xiangqi', (data) => handleJoin({ ...data, gameType: data.gameType || 'xiangqi' }));

    // ── Start game ──────────────────────────────────────────────────
    socket.on('start_game', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const room = roomManager.getRoom(roomId);
      if (!room) return;
      if (room.players.length < 2) {
        return socket.emit('error', { message: 'Waiting for second player.' });
      }
      if (engines.has(roomId)) return; // already started

      const gameType = roomGameTypes.get(roomId) || 'xiangqi';
      const engine = gameType === 'chess' ? createChessGame() : createXiangqiGame();
      engines.set(roomId, engine);

      const payload = gameStatePayload(roomId, room, engine);
      io.to(roomId).emit('game_started', payload);
      analytics.logEvent('game_started', roomId, socket.id, socket.data.playerName, { gameType });
    });

    // ── Make move ───────────────────────────────────────────────────
    socket.on('make_move', ({ from, to, promotion }) => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const engine = engines.get(roomId);
      if (!engine) return socket.emit('invalid_move', { reason: 'Game not started' });

      const room = roomManager.getRoom(roomId);
      if (!room) return;

      // Verify it is this socket's color's turn
      const playerColor = socket.data.color;
      const engineTurn = engine.turn();
      const gameType = roomGameTypes.get(roomId) || 'xiangqi';
      const firstColor = gameType === 'chess' ? 'white' : 'red';

      if ((engineTurn === 'w' && playerColor !== firstColor) ||
          (engineTurn === 'b' && playerColor !== 'black')) {
        return socket.emit('invalid_move', { reason: 'Not your turn' });
      }

      if (engine.isGameOver()) {
        return socket.emit('invalid_move', { reason: 'Game is over' });
      }

      const result = engine.move(from, to, promotion || null);
      if (!result.ok) {
        return socket.emit('invalid_move', { reason: result.reason });
      }

      const payload = gameStatePayload(roomId, room, engine);
      io.to(roomId).emit('game_state', payload);
      analytics.logEvent('move_made', roomId, socket.id, socket.data.playerName, { from, to, gameType });

      if (payload.isGameOver) {
        analytics.logEvent('game_ended', roomId, socket.id, socket.data.playerName, { winner: payload.winner, gameType });
      }
    });

    // ── Undo request ────────────────────────────────────────────────
    socket.on('request_undo', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const room = roomManager.getRoom(roomId);
      if (!room) return;
      const opponent = room.players.find(p => p.color !== socket.data.color && p.socketId);
      if (!opponent) return socket.emit('error', { message: 'Opponent not connected' });
      io.to(opponent.socketId).emit('undo_requested', { from: socket.data.playerName });
      analytics.logEvent('undo_requested', roomId, socket.id, socket.data.playerName);
    });

    // ── Approve undo ────────────────────────────────────────────────
    socket.on('approve_undo', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const engine = engines.get(roomId);
      if (!engine) return;
      const room = roomManager.getRoom(roomId);
      if (!room) return;
      if (!engine.undo()) return;
      io.to(roomId).emit('game_state', gameStatePayload(roomId, room, engine));
    });

    // ── Decline undo ────────────────────────────────────────────────
    socket.on('decline_undo', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const room = roomManager.getRoom(roomId);
      if (!room) return;
      const requester = room.players.find(p => p.color !== socket.data.color && p.socketId);
      if (!requester) return;
      io.to(requester.socketId).emit('undo_declined');
    });

    // ── Resign ──────────────────────────────────────────────────────
    socket.on('resign', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const room = roomManager.getRoom(roomId);
      if (!room) return;
      // Opponent of the resigning player wins
      const winner = room.players.find(p => p.color !== socket.data.color)?.color || null;
      io.to(roomId).emit('game_over', { winner, reason: `${socket.data.playerName} resigned` });
      engines.delete(roomId);
      roomGameTypes.delete(roomId);
      analytics.logEvent('game_ended', roomId, socket.id, socket.data.playerName, { winner, reason: 'resign' });
    });

    // ── Disconnect ──────────────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log('disconnect', socket.id);
      const result = roomManager.leaveRoom(socket.id);
      if (!result) return;
      const { roomId, room, wasPlayer, playerName } = result;
      if (!wasPlayer) return;

      // 2s delay absorbs the lobby→game-page socket transition race
      setTimeout(() => {
        const currentRoom = roomManager.getRoom(roomId);
        if (!currentRoom) return;
        const player = currentRoom.players.find(p => p.name === playerName);
        if (player && player.socketId !== null) return; // already reconnected

        io.to(roomId).emit('player_disconnected', { playerName });
        io.to(roomId).emit('room_update', roomSnapshot(currentRoom));
        analytics.logEvent('player_disconnected', roomId, socket.id, playerName || '');
      }, 2000);
    });
  });
};
