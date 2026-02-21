'use strict';

// In-memory room store
const rooms = new Map();
// Grace period timers for reconnection: socketId -> timeout handle
const reconnectTimers = new Map();

const RECONNECT_GRACE_MS = 60 * 1000;

function generateRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function createRoom(options = {}) {
  const roomId = generateRoomId();
  rooms.set(roomId, {
    players: [],      // [{ socketId, name, color }]
    spectators: [],   // [{ socketId, name }]
    gameState: null,
    colors: options.colors || ['red', 'black'], // game-specific color names
    createdAt: Date.now(),
    deleteTimer: null
  });
  return roomId;
}

function joinRoom(roomId, socketId, name) {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };

  // Cancel any pending delete timer when someone joins
  if (room.deleteTimer) {
    clearTimeout(room.deleteTimer);
    room.deleteTimer = null;
  }

  // Cancel reconnect timer for this socket if one exists
  if (reconnectTimers.has(socketId)) {
    clearTimeout(reconnectTimers.get(socketId));
    reconnectTimers.delete(socketId);
  }

  // Check if this player is reconnecting — match by name only.
  // socketId may be null (clean disconnect) or stale (race with page navigation).
  const existing = room.players.find(p => p.name === name);
  if (existing) {
    existing.socketId = socketId;
    return { room, color: existing.color, reconnected: true };
  }

  if (room.players.length < 2) {
    const color = room.colors[room.players.length];
    room.players.push({ socketId, name, color });
    return { room, color, reconnected: false };
  }

  // Spectator
  room.spectators.push({ socketId, name });
  return { room, color: 'spectator', reconnected: false };
}

function leaveRoom(socketId) {
  for (const [roomId, room] of rooms) {
    const playerIdx = room.players.findIndex(p => p.socketId === socketId);
    if (playerIdx !== -1) {
      // Preserve seat for reconnection — null out socketId
      room.players[playerIdx].socketId = null;

      // Schedule room deletion if both players gone after grace period
      scheduleRoomCleanup(roomId, room);
      return { roomId, room, wasPlayer: true, playerName: room.players[playerIdx].name };
    }

    const specIdx = room.spectators.findIndex(s => s.socketId === socketId);
    if (specIdx !== -1) {
      room.spectators.splice(specIdx, 1);
      return { roomId, room, wasPlayer: false };
    }
  }
  return null;
}

function scheduleRoomCleanup(roomId, room) {
  if (room.deleteTimer) clearTimeout(room.deleteTimer);
  room.deleteTimer = setTimeout(() => {
    // Only delete if no active players
    const hasActive = room.players.some(p => p.socketId !== null);
    if (!hasActive) {
      rooms.delete(roomId);
    }
  }, RECONNECT_GRACE_MS);
}

function getRoom(roomId) {
  return rooms.get(roomId) || null;
}

function roomCount() {
  return rooms.size;
}

module.exports = { createRoom, joinRoom, leaveRoom, getRoom, roomCount };
