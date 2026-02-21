'use strict';

/**
 * Client-side Xiangqi legal move generator.
 * Mirrors the server engine so pieces light up on selection.
 * Server still re-validates everything — this is purely for UX.
 */

const COLS = 9, ROWS = 10;

function inBoard(r, c) { return r >= 0 && r <= 9 && c >= 0 && c <= 8; }
function isRed(p) { return p && p === p.toUpperCase(); }
function isBlack(p) { return p && p === p.toLowerCase(); }
function sameColor(a, b) {
  if (!a || !b) return false;
  return (isRed(a) && isRed(b)) || (isBlack(a) && isBlack(b));
}
function inPalace(r, c, red) {
  return r >= (red ? 7 : 0) && r <= (red ? 9 : 2) && c >= 3 && c <= 5;
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
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      let nr = r+dr, nc = c+dc;
      while (inBoard(nr, nc)) {
        if (board[nr][nc]) { add(nr, nc); break; }
        add(nr, nc); nr += dr; nc += dc;
      }
    }
  } else if (p === 'n') {
    const legMoves = [
      [[-1,0],[-2,-1]], [[-1,0],[-2,1]],
      [[1,0],[2,-1]],   [[1,0],[2,1]],
      [[0,-1],[-1,-2]], [[0,-1],[1,-2]],
      [[0,1],[-1,2]],   [[0,1],[1,2]]
    ];
    for (const [leg, dest] of legMoves) {
      const lr = r+leg[0], lc = c+leg[1];
      if (!inBoard(lr,lc) || board[lr][lc]) continue;
      const dr = r+dest[0], dc = c+dest[1];
      if (!inBoard(dr,dc)) continue;
      if (!sameColor(piece, board[dr][dc])) moves.push([dr, dc]);
    }
  } else if (p === 'b') {
    const diags = [[-2,-2],[-2,2],[2,-2],[2,2]];
    const mids  = [[-1,-1],[-1,1],[1,-1],[1,1]];
    for (let i = 0; i < 4; i++) {
      const mr = r+mids[i][0], mc = c+mids[i][1];
      const dr = r+diags[i][0], dc = c+diags[i][1];
      if (!inBoard(dr,dc)) continue;
      if (red && dr < 5) continue;
      if (!red && dr > 4) continue;
      if (board[mr][mc]) continue;
      if (!sameColor(piece, board[dr][dc])) moves.push([dr, dc]);
    }
  } else if (p === 'a') {
    for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
      const nr = r+dr, nc = c+dc;
      if (inPalace(nr, nc, red) && !sameColor(piece, board[nr][nc])) moves.push([nr, nc]);
    }
  } else if (p === 'k') {
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nr = r+dr, nc = c+dc;
      if (inPalace(nr, nc, red) && !sameColor(piece, board[nr][nc])) moves.push([nr, nc]);
    }
  } else if (p === 'c') {
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      let nr = r+dr, nc = c+dc, jumped = false;
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
    if (red) {
      add(r-1, c);
      if (r <= 4) { add(r, c-1); add(r, c+1); }
    } else {
      add(r+1, c);
      if (r >= 5) { add(r, c-1); add(r, c+1); }
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

function inCheck(board, red) {
  const king = findKing(board, red);
  if (!king) return false;
  const [kr, kc] = king;
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (!p || (isRed(p) === red)) continue;
      if (getLegalMoves(board, r, c).some(([mr,mc]) => mr===kr && mc===kc)) return true;
    }
  }
  // Flying generals
  const opp = findKing(board, !red);
  if (opp && opp[1] === kc) {
    let blocked = false;
    for (let r = Math.min(kr,opp[0])+1; r < Math.max(kr,opp[0]); r++)
      if (board[r][kc]) { blocked = true; break; }
    if (!blocked) return true;
  }
  return false;
}

function applyMove(board, from, to) {
  const b = board.map(row => [...row]);
  b[to[0]][to[1]] = b[from[0]][from[1]];
  b[from[0]][from[1]] = null;
  return b;
}

/**
 * Returns legal destination squares for the piece at [r,c],
 * filtering out moves that leave own king in check.
 */
function legalMovesFor(board, r, c) {
  const piece = board[r][c];
  if (!piece) return [];
  const red = isRed(piece);
  const candidates = getLegalMoves(board, r, c);
  return candidates.filter(([nr, nc]) => {
    const nb = applyMove(board, [r,c], [nr,nc]);
    return !inCheck(nb, red);
  });
}

window.XiangqiMoves = { legalMovesFor };
