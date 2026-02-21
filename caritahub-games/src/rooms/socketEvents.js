'use strict';

const roomManager = require('./roomManager');
const { createGame: createXiangqiGame }    = require('../engine/xiangqi');
const { createGame: createChessGame }      = require('../engine/chess');
const { createGame: createChordaidiGame }  = require('../engine/chordaidi');
const { createGame: createBingoGame }      = require('../engine/bingo');
const analytics = require('../analytics/clickhouse');
const leaderboard = require('../leaderboard');

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

// ── Chor Dai Di helpers ─────────────────────────────────────────────────────
const CDI_COLORS = ['south', 'west', 'north', 'east'];

function seatForColor(color) { return CDI_COLORS.indexOf(color); }

/** Build the per-player game_state payload (hides other players' cards). */
function chordaidiPayload(roomId, room, engine, myColor) {
  const gs  = engine.state();
  const mySeat = seatForColor(myColor);
  return {
    gameType: 'chordaidi',
    myHand:       mySeat >= 0 ? gs.hands[mySeat] : [],
    handCounts:   gs.hands.map(h => h.length),
    currentSeat:  gs.currentSeat,
    tableCombo:   gs.tableCombo,
    tableOwner:   gs.tableOwner,
    passCount:    gs.passCount,
    isGameOver:   gs.isGameOver,
    winner:       gs.winner,
    players: room.players.map((p, i) => ({
      name: p.name, color: p.color, connected: p.socketId !== null,
      seat: seatForColor(p.color)
    }))
  };
}

/** Broadcast personalised states to all 4 players. */
function broadcastCDI(io, roomId, room, engine) {
  room.players.forEach(p => {
    if (!p.socketId) return;
    io.to(p.socketId).emit('game_state', chordaidiPayload(roomId, room, engine, p.color));
  });
}

// ── Bingo helpers ────────────────────────────────────────────────────────────
const BINGO_COLORS = ['caller', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];

function seatForBingoColor(color) { return BINGO_COLORS.indexOf(color); }

function bingoPayload(roomId, room, engine) {
  const gs = engine.state();
  return {
    gameType: 'bingo',
    called:      gs.called,
    lastCalled:  gs.lastCalled,
    cards:       gs.cards,
    marked:      gs.marked,
    isGameOver:  gs.isGameOver,
    winners:     gs.winners,
    callerSeat:  gs.callerSeat,
    playerCount: gs.playerCount,
    players: room.players.map(p => ({
      name: p.name, color: p.color, connected: p.socketId !== null,
      seat: seatForBingoColor(p.color)
    }))
  };
}

function broadcastBingo(io, roomId, room, engine) {
  io.to(roomId).emit('game_state', bingoPayload(roomId, room, engine));
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
        let colors;
        if (gameType === 'chess')          colors = ['white', 'black'];
        else if (gameType === 'chordaidi') colors = ['south', 'west', 'north', 'east'];
        else if (gameType === 'bingo')     colors = BINGO_COLORS.slice(); // 8 seats
        else                               colors = ['red', 'black'];
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
        const gt = roomGameTypes.get(targetRoomId) || 'xiangqi';
        if (gt === 'chordaidi') {
          socket.emit('game_state', chordaidiPayload(targetRoomId, room, engine, socket.data.color));
        } else if (gt === 'bingo') {
          socket.emit('game_state', bingoPayload(targetRoomId, room, engine));
        } else {
          socket.emit('game_state', gameStatePayload(targetRoomId, room, engine));
        }
      }

      io.to(targetRoomId).emit('room_update', roomSnapshot(room));
      analytics.logEvent('player_joined', targetRoomId, socket.id, name, { color: result.color, gameType });
    };

    socket.on('join_game',    handleJoin);
    socket.on('join_xiangqi', (data) => handleJoin({ ...data, gameType: data.gameType || 'xiangqi' }));

    // ── Chor Dai Di: required player count ──────────────────────────
    // start_game is repurposed — for CDI we need 4 players
    // The 'start_game' handler below already handles the count check

    // ── Start game ──────────────────────────────────────────────────
    socket.on('start_game', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const room = roomManager.getRoom(roomId);
      if (!room) return;
      if (engines.has(roomId)) return; // already started

      const gameType = roomGameTypes.get(roomId) || 'xiangqi';
      const requiredPlayers = gameType === 'chordaidi' ? 4 : 2;
      if (room.players.length < requiredPlayers) {
        return socket.emit('error', { message: `Waiting for ${requiredPlayers - room.players.length} more player(s).` });
      }

      let engine;
      if (gameType === 'chess')          engine = createChessGame();
      else if (gameType === 'chordaidi') engine = createChordaidiGame();
      else if (gameType === 'bingo')     engine = createBingoGame(room.players.length);
      else                               engine = createXiangqiGame();
      engines.set(roomId, engine);

      if (gameType === 'chordaidi') {
        // Send each player their personalised state (private hand)
        room.players.forEach(p => {
          if (!p.socketId) return;
          io.to(p.socketId).emit('game_started', chordaidiPayload(roomId, room, engine, p.color));
        });
      } else if (gameType === 'bingo') {
        io.to(roomId).emit('game_started', bingoPayload(roomId, room, engine));
      } else {
        const payload = gameStatePayload(roomId, room, engine);
        io.to(roomId).emit('game_started', payload);
      }
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
        if (payload.winner) {
          const winPlayer = room.players.find(p => p.color === payload.winner);
          if (winPlayer) leaderboard.recordWin(gameType, winPlayer.name);
        }
        analytics.logEvent('game_ended', roomId, socket.id, socket.data.playerName, { winner: payload.winner, gameType });
      }
    });

    // ── Chor Dai Di: play cards ──────────────────────────────────────
    socket.on('cdi_play', ({ cardIds }) => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const engine = engines.get(roomId);
      if (!engine) return socket.emit('invalid_move', { reason: 'Game not started' });
      const room = roomManager.getRoom(roomId);
      if (!room) return;

      const seat = seatForColor(socket.data.color);
      const result = engine.play(seat, cardIds);
      if (!result.ok) return socket.emit('invalid_move', { reason: result.reason });

      broadcastCDI(io, roomId, room, engine);
      if (engine.isGameOver()) {
        const winSeat = engine.winner();
        const winPlayer = room.players.find(p => seatForColor(p.color) === winSeat);
        io.to(roomId).emit('game_over', { winner: winPlayer?.color || null, reason: `${winPlayer?.name || 'Someone'} played all cards!` });
        if (winPlayer) leaderboard.recordWin('chordaidi', winPlayer.name);
        engines.delete(roomId);
        roomGameTypes.delete(roomId);
      }
    });

    // ── Chor Dai Di: pass ────────────────────────────────────────────
    socket.on('cdi_pass', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const engine = engines.get(roomId);
      if (!engine) return socket.emit('invalid_move', { reason: 'Game not started' });
      const room = roomManager.getRoom(roomId);
      if (!room) return;

      const seat = seatForColor(socket.data.color);
      const result = engine.pass(seat);
      if (!result.ok) return socket.emit('invalid_move', { reason: result.reason });

      broadcastCDI(io, roomId, room, engine);
    });

    // ── Bingo: caller draws next number ─────────────────────────────
    socket.on('bingo_call', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const engine = engines.get(roomId);
      if (!engine) return socket.emit('error', { message: 'Game not started' });
      const room = roomManager.getRoom(roomId);
      if (!room) return;

      const seat = seatForBingoColor(socket.data.color);
      const result = engine.callNumber(seat);
      if (!result.ok) return socket.emit('error', { message: result.reason });

      broadcastBingo(io, roomId, room, engine);

      if (engine.isGameOver()) {
        const ws = engine.winners();
        // Record wins for all winner seats
        ws.forEach(w => {
          const wp = room.players.find(p => seatForBingoColor(p.color) === w.seat);
          if (wp) leaderboard.recordWin('bingo', wp.name);
        });
        const winNames = ws.map(w => {
          const wp = room.players.find(p => seatForBingoColor(p.color) === w.seat);
          return wp?.name || '?';
        });
        io.to(roomId).emit('game_over', {
          winner: winNames.join(', '),
          reason: `BINGO! ${winNames.join(' & ')} won!`
        });
        engines.delete(roomId);
        roomGameTypes.delete(roomId);
        analytics.logEvent('game_ended', roomId, socket.id, socket.data.playerName, { winner: winNames.join(', '), gameType: 'bingo' });
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
      const winnerPlayer = room.players.find(p => p.color !== socket.data.color);
      const winner = winnerPlayer?.color || null;
      io.to(roomId).emit('game_over', { winner, reason: `${socket.data.playerName} resigned` });
      const gt = roomGameTypes.get(roomId) || 'xiangqi';
      if (winnerPlayer) leaderboard.recordWin(gt, winnerPlayer.name);
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
