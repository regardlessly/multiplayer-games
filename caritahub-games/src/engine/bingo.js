'use strict';

/**
 * Bingo engine — server-authoritative.
 *
 * Rules:
 *  - 2–8 players, each gets a unique 5×5 card with numbers 1–75.
 *    Columns: B=1-15, I=16-30, N=31-45, G=46-60, O=61-75.
 *    Center square (row2,col2) is FREE.
 *  - One player is the "caller" (seat 0, color = first in colors array).
 *    Caller calls numbers from the pool one at a time.
 *  - All players mark their cards automatically when a number is called.
 *  - Win conditions (checked after each call):
 *    - Any row, column, or diagonal fully marked → BINGO!
 *    - Full card (full house) → FULL HOUSE!
 *  - Multiple winners can declare in the same call.
 *
 * Interface (matches CDI pattern):
 *   createGame(playerCount)  → engine object
 *   engine.state()           → full state (no secrets; all cards visible)
 *   engine.callNumber(seat)  → { ok, reason, number } — caller draws next number
 *   engine.isGameOver()      → bool
 *   engine.winners()         → [{ seat, type }] array
 */

const COLUMNS = ['B', 'I', 'N', 'G', 'O'];
// Number ranges per column
const COL_RANGES = [
  { min: 1,  max: 15 },
  { min: 16, max: 30 },
  { min: 31, max: 45 },
  { min: 46, max: 60 },
  { min: 61, max: 75 },
];
const CARD_SIZE = 5;
const FREE_ROW = 2;
const FREE_COL = 2;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Generate a unique 5×5 Bingo card for a given column range set. */
function generateCard() {
  const grid = []; // grid[row][col]
  for (let r = 0; r < CARD_SIZE; r++) grid.push([]);

  for (let col = 0; col < CARD_SIZE; col++) {
    const { min, max } = COL_RANGES[col];
    const pool = [];
    for (let n = min; n <= max; n++) pool.push(n);
    shuffle(pool);
    const nums = pool.slice(0, CARD_SIZE);
    for (let row = 0; row < CARD_SIZE; row++) {
      grid[row][col] = nums[row];
    }
  }
  // FREE center
  grid[FREE_ROW][FREE_COL] = 0; // 0 = FREE
  return grid;
}

/** Build a 5×5 marked matrix (true = marked). FREE is pre-marked. */
function initialMarked() {
  const m = [];
  for (let r = 0; r < CARD_SIZE; r++) {
    m.push([false, false, false, false, false]);
  }
  m[FREE_ROW][FREE_COL] = true;
  return m;
}

/** Check win conditions on a marked grid. Returns array of win types found. */
function checkWins(marked) {
  const wins = [];
  // Rows
  for (let r = 0; r < CARD_SIZE; r++) {
    if (marked[r].every(v => v)) wins.push(`row${r}`);
  }
  // Columns
  for (let c = 0; c < CARD_SIZE; c++) {
    if (marked.every(row => row[c])) wins.push(`col${c}`);
  }
  // Diagonals
  if ([0,1,2,3,4].every(i => marked[i][i])) wins.push('diag-tl');
  if ([0,1,2,3,4].every(i => marked[i][CARD_SIZE-1-i])) wins.push('diag-tr');
  // Full house
  if (marked.every(row => row.every(v => v))) wins.push('fullhouse');
  return wins;
}

function createGame(playerCount = 2) {
  if (playerCount < 2 || playerCount > 8) throw new Error('Bingo requires 2–8 players');

  // Build number pool 1-75, shuffled
  const pool = shuffle(Array.from({ length: 75 }, (_, i) => i + 1));
  const called = []; // numbers called so far

  // Each player gets a card + marked matrix
  const cards   = Array.from({ length: playerCount }, generateCard);
  const marked  = Array.from({ length: playerCount }, initialMarked);

  let _isGameOver = false;
  let _winners = []; // [{ seat, types }]

  function state() {
    return {
      gameType: 'bingo',
      pool: pool.slice(),          // remaining (for server; clients don't see)
      called: called.slice(),       // all called numbers
      lastCalled: called.length ? called[called.length - 1] : null,
      cards,                        // all cards (all visible in bingo)
      marked,                       // per-player marked grids
      isGameOver: _isGameOver,
      winners: _winners,
      playerCount,
      callerSeat: 0,                // seat 0 is always the caller
    };
  }

  function callNumber(seat) {
    if (seat !== 0) return { ok: false, reason: 'Only the caller can draw numbers' };
    if (_isGameOver)  return { ok: false, reason: 'Game is over' };
    if (pool.length === 0) return { ok: false, reason: 'All numbers have been called!' };

    const num = pool.pop();
    called.push(num);

    // Mark all cards
    for (let p = 0; p < playerCount; p++) {
      for (let r = 0; r < CARD_SIZE; r++) {
        for (let c = 0; c < CARD_SIZE; c++) {
          if (cards[p][r][c] === num) {
            marked[p][r][c] = true;
          }
        }
      }
    }

    // Check for new winners
    const newWinners = [];
    for (let p = 0; p < playerCount; p++) {
      const wins = checkWins(marked[p]);
      // Only count if this player wasn't already a winner with these win types
      const alreadyWon = _winners.find(w => w.seat === p);
      if (wins.length > 0 && !alreadyWon) {
        newWinners.push({ seat: p, types: wins });
      }
    }
    if (newWinners.length > 0) {
      _winners.push(...newWinners);
      // Game ends when at least one winner exists
      _isGameOver = true;
    }

    return { ok: true, number: num, newWinners };
  }

  function isGameOver() { return _isGameOver; }
  function winners() { return _winners; }

  return { state, callNumber, isGameOver, winners };
}

module.exports = { createGame, COLUMNS, CARD_SIZE, FREE_ROW, FREE_COL };
