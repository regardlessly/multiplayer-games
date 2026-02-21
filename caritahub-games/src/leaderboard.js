'use strict';

/**
 * In-memory leaderboard.
 * Tracks wins per player name per game type.
 * Resets on server restart (no persistence).
 *
 * Structure: Map<gameType, Map<playerName, wins>>
 */

const store = new Map(); // gameType -> Map<playerName, wins>

const GAME_TYPES = ['xiangqi', 'chess', 'chordaidi'];

function _ensureGame(gameType) {
  if (!store.has(gameType)) store.set(gameType, new Map());
  return store.get(gameType);
}

/** Record a win for a player in a given game type. */
function recordWin(gameType, playerName) {
  if (!playerName) return;
  const board = _ensureGame(gameType);
  board.set(playerName, (board.get(playerName) || 0) + 1);
}

/**
 * Return leaderboard for one or all game types.
 * Each entry: { name, wins }
 * Sorted descending by wins, top N entries.
 */
function getLeaderboard(gameType = null, limit = 10) {
  const types = gameType ? [gameType] : GAME_TYPES;

  // Aggregate across requested game types
  const agg = new Map();
  for (const gt of types) {
    const board = store.get(gt);
    if (!board) continue;
    for (const [name, wins] of board) {
      agg.set(name, (agg.get(name) || 0) + wins);
    }
  }

  return Array.from(agg.entries())
    .map(([name, wins]) => ({ name, wins }))
    .sort((a, b) => b.wins - a.wins)
    .slice(0, limit);
}

/**
 * Return per-game leaderboards as { gameType: [{ name, wins }] }.
 */
function getAllLeaderboards(limit = 10) {
  const result = {};
  for (const gt of GAME_TYPES) {
    const board = store.get(gt);
    if (!board) { result[gt] = []; continue; }
    result[gt] = Array.from(board.entries())
      .map(([name, wins]) => ({ name, wins }))
      .sort((a, b) => b.wins - a.wins)
      .slice(0, limit);
  }
  return result;
}

module.exports = { recordWin, getLeaderboard, getAllLeaderboards };
