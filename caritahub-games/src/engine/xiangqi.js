'use strict';

/**
 * Server-side Xiangqi engine — full move validation.
 * Board is a 10-row x 9-col array (row 0 = Black's back rank, row 9 = Red's back rank).
 * Piece notation: uppercase = Red, lowercase = Black
 *   K/k = General (將/帅)  A/a = Advisor (士)  B/b = Elephant/Bishop (象)
 *   N/n = Horse (馬)       R/r = Chariot (車)  C/c = Cannon (炮)  P/p = Pawn (兵/卒)
 */

const INITIAL_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w';

function parseFen(fen) {
  const [boardStr, turn] = fen.split(' ');
  const rows = boardStr.split('/');
  const board = [];
  for (const row of rows) {
    const cells = [];
    for (const ch of row) {
      if (/\d/.test(ch)) {
        for (let i = 0; i < parseInt(ch); i++) cells.push(null);
      } else {
        cells.push(ch);
      }
    }
    board.push(cells);
  }
  return { board, turn: turn || 'w' };
}

function boardToFen(board, turn) {
  const rows = [];
  for (const row of board) {
    let s = '';
    let empty = 0;
    for (const cell of row) {
      if (cell === null) {
        empty++;
      } else {
        if (empty) { s += empty; empty = 0; }
        s += cell;
      }
    }
    if (empty) s += empty;
    rows.push(s);
  }
  return rows.join('/') + ' ' + turn;
}

function isRed(piece) { return piece && piece === piece.toUpperCase(); }
function isBlack(piece) { return piece && piece === piece.toLowerCase(); }
function sameColor(a, b) {
  if (!a || !b) return false;
  return (isRed(a) && isRed(b)) || (isBlack(a) && isBlack(b));
}
function inBoard(r, c) { return r >= 0 && r <= 9 && c >= 0 && c <= 8; }

// Palace bounds
function inPalace(r, c, red) {
  const rowStart = red ? 7 : 0;
  const rowEnd = red ? 9 : 2;
  return r >= rowStart && r <= rowEnd && c >= 3 && c <= 5;
}

function getLegalMoves(board, r, c) {
  const piece = board[r][c];
  if (!piece) return [];
  const p = piece.toLowerCase();
  const red = isRed(piece);
  const moves = [];

  const add = (nr, nc) => {
    if (!inBoard(nr, nc)) return;
    if (sameColor(piece, board[nr][nc])) return;
    moves.push([nr, nc]);
  };

  if (p === 'r') {
    // Chariot — slides horizontally/vertically
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      let nr = r + dr, nc = c + dc;
      while (inBoard(nr, nc)) {
        if (board[nr][nc]) { add(nr, nc); break; }
        add(nr, nc);
        nr += dr; nc += dc;
      }
    }
  } else if (p === 'n') {
    // Horse — one orthogonal + one diagonal, blocked by adjacent
    const steps = [[-1,0],[-2,-1],[-2,1],[1,0],[2,-1],[2,1],[0,-1],[-1,-2],[1,-2],[0,1],[-1,2],[1,2]];
    const legMoves = [
      [[-1,0],[-2,-1]], [[-1,0],[-2,1]],
      [[1,0],[2,-1]],   [[1,0],[2,1]],
      [[0,-1],[-1,-2]], [[0,-1],[1,-2]],
      [[0,1],[-1,2]],   [[0,1],[1,2]]
    ];
    for (const [leg, dest] of legMoves) {
      const lr = r + leg[0], lc = c + leg[1];
      if (!inBoard(lr, lc) || board[lr][lc]) continue;
      const dr = r + dest[0], dc = c + dest[1];
      if (!inBoard(dr, dc)) continue;
      if (!sameColor(piece, board[dr][dc])) moves.push([dr, dc]);
    }
  } else if (p === 'b') {
    // Elephant — two diagonal, can't cross river, blocked at midpoint
    const diags = [[-2,-2],[-2,2],[2,-2],[2,2]];
    const midpoints = [[-1,-1],[-1,1],[1,-1],[1,1]];
    const riverRow = red ? 4 : 5;
    for (let i = 0; i < 4; i++) {
      const mr = r + midpoints[i][0], mc = c + midpoints[i][1];
      const dr = r + diags[i][0], dc = c + diags[i][1];
      if (!inBoard(dr, dc)) continue;
      if (red && dr < 5) continue;   // Red elephant can't cross river (rows 0-4)
      if (!red && dr > 4) continue;  // Black elephant can't cross river (rows 5-9)
      if (board[mr][mc]) continue;   // Blocked at midpoint
      if (!sameColor(piece, board[dr][dc])) moves.push([dr, dc]);
    }
  } else if (p === 'a') {
    // Advisor — one diagonal step within palace
    for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
      const nr = r + dr, nc = c + dc;
      if (inPalace(nr, nc, red) && !sameColor(piece, board[nr][nc])) moves.push([nr, nc]);
    }
  } else if (p === 'k') {
    // General — one orthogonal step within palace
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nr = r + dr, nc = c + dc;
      if (inPalace(nr, nc, red) && !sameColor(piece, board[nr][nc])) moves.push([nr, nc]);
    }
    // Flying general — generals face each other with no pieces between
    // (handled via check detection; we just allow the move candidate here)
  } else if (p === 'c') {
    // Cannon — slides like chariot but captures by jumping exactly one piece
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      let nr = r + dr, nc = c + dc;
      let jumped = false;
      while (inBoard(nr, nc)) {
        if (!jumped) {
          if (board[nr][nc]) jumped = true;
          else moves.push([nr, nc]);
        } else {
          if (board[nr][nc]) {
            if (!sameColor(piece, board[nr][nc])) moves.push([nr, nc]);
            break;
          }
        }
        nr += dr; nc += dc;
      }
    }
  } else if (p === 'p') {
    // Pawn — Red moves up (decreasing row), Black moves down (increasing row)
    // Before crossing river: forward only. After: forward + sideways.
    if (red) {
      add(r - 1, c); // forward
      if (r <= 4) { add(r, c - 1); add(r, c + 1); } // sideways after river
    } else {
      add(r + 1, c); // forward
      if (r >= 5) { add(r, c - 1); add(r, c + 1); } // sideways after river
    }
  }

  return moves;
}

function findKing(board, red) {
  const k = red ? 'K' : 'k';
  for (let r = 0; r < 10; r++)
    for (let c = 0; c < 9; c++)
      if (board[r][c] === k) return [r, c];
  return null;
}

function isInCheck(board, red) {
  const king = findKing(board, red);
  if (!king) return false;
  const [kr, kc] = king;

  // Check if any opponent piece can capture the king
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const piece = board[r][c];
      if (!piece) continue;
      if (red ? isRed(piece) : isBlack(piece)) continue; // same color
      const moves = getLegalMoves(board, r, c);
      if (moves.some(([mr, mc]) => mr === kr && mc === kc)) return true;
    }
  }

  // Flying generals check
  const oppKing = findKing(board, !red);
  if (oppKing && oppKing[1] === kc) {
    const minR = Math.min(kr, oppKing[0]);
    const maxR = Math.max(kr, oppKing[0]);
    let blocked = false;
    for (let r = minR + 1; r < maxR; r++) {
      if (board[r][kc]) { blocked = true; break; }
    }
    if (!blocked) return true;
  }

  return false;
}

function applyMove(board, from, to) {
  const newBoard = board.map(row => [...row]);
  newBoard[to[0]][to[1]] = newBoard[from[0]][from[1]];
  newBoard[from[0]][from[1]] = null;
  return newBoard;
}

function isGameOver(board, turn) {
  // Current side (turn) has no legal moves that don't leave king in check
  const red = turn === 'w';
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const piece = board[r][c];
      if (!piece) continue;
      if (isRed(piece) !== red) continue;
      const moves = getLegalMoves(board, r, c);
      for (const [nr, nc] of moves) {
        const newBoard = applyMove(board, [r, c], [nr, nc]);
        if (!isInCheck(newBoard, red)) return false; // has at least one legal move
      }
    }
  }
  return true; // no legal moves — current side loses
}

function createGame() {
  let state = parseFen(INITIAL_FEN);
  const history = []; // array of { board, turn } for undo

  function move(from, to) {
    const { board, turn } = state;
    const [fr, fc] = from;
    const piece = board[fr][fc];
    if (!piece) return { ok: false, reason: 'No piece at source' };

    const red = turn === 'w';
    if (isRed(piece) !== red) return { ok: false, reason: 'Not your piece' };

    const legal = getLegalMoves(board, fr, fc);
    if (!legal.some(([r, c]) => r === to[0] && c === to[1])) {
      return { ok: false, reason: 'Illegal move' };
    }

    const newBoard = applyMove(board, from, to);
    if (isInCheck(newBoard, red)) return { ok: false, reason: 'Move leaves king in check' };

    history.push({ board: board.map(row => [...row]), turn });
    state = { board: newBoard, turn: turn === 'w' ? 'b' : 'w' };
    return { ok: true };
  }

  function undo() {
    if (history.length === 0) return false;
    state = history.pop();
    return true;
  }

  function fen() {
    return boardToFen(state.board, state.turn);
  }

  function turn() {
    return state.turn; // 'w' = red, 'b' = black
  }

  function inCheck() {
    return isInCheck(state.board, state.turn === 'w');
  }

  function gameOver() {
    return isGameOver(state.board, state.turn);
  }

  function legalMoves(square) {
    const [r, c] = square;
    return getLegalMoves(state.board, r, c);
  }

  function boardState() {
    return state.board.map(row => [...row]);
  }

  return { move, undo, fen, turn, inCheck, isGameOver: gameOver, legalMoves, boardState };
}

module.exports = { createGame, INITIAL_FEN };
