'use strict';

/**
 * Client-side Western Chess legal move generator.
 * Mirrors src/engine/chess.js for UX highlighting only — server re-validates everything.
 */

function parseFenState(fen) {
  const parts = fen.split(' ');
  const boardStr = parts[0];
  const turn = parts[1] || 'w';
  const castlingStr = parts[2] || '-';
  const epStr = parts[3] || '-';

  const rows = boardStr.split('/');
  const board = [];
  for (const row of rows) {
    const cells = [];
    for (const ch of row) {
      if (/\d/.test(ch)) { for (let i = 0; i < parseInt(ch); i++) cells.push(null); }
      else cells.push(ch);
    }
    board.push(cells);
  }

  const castling = {
    K: castlingStr.includes('K'), Q: castlingStr.includes('Q'),
    k: castlingStr.includes('k'), q: castlingStr.includes('q'),
  };

  let enPassant = null;
  if (epStr !== '-') {
    const file = 'abcdefgh'.indexOf(epStr[0]);
    const rank = parseInt(epStr[1]);
    enPassant = [8 - rank, file];
  }

  return { board, turn, castling, enPassant };
}

function isWhite(p) { return p && p === p.toUpperCase(); }
function sameColor(a, b) {
  if (!a || !b) return false;
  return (isWhite(a) && isWhite(b)) || (!isWhite(a) && !isWhite(b));
}
function inBounds(r, c) { return r >= 0 && r <= 7 && c >= 0 && c <= 7; }

function getCandidates(board, state, r, c, skipCastling) {
  const piece = board[r][c];
  if (!piece) return [];
  const p = piece.toLowerCase();
  const white = isWhite(piece);
  const moves = [];

  const add = (nr, nc) => {
    if (!inBounds(nr, nc)) return false;
    if (sameColor(piece, board[nr][nc])) return false;
    moves.push([nr, nc]);
    return !board[nr][nc];
  };

  if (p === 'r' || p === 'q') {
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      let nr = r+dr, nc = c+dc;
      while (inBounds(nr, nc)) { if (!add(nr, nc)) break; nr+=dr; nc+=dc; }
    }
  }
  if (p === 'b' || p === 'q') {
    for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
      let nr = r+dr, nc = c+dc;
      while (inBounds(nr, nc)) { if (!add(nr, nc)) break; nr+=dr; nc+=dc; }
    }
  }
  if (p === 'n') {
    for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]])
      add(r+dr, c+dc);
  }
  if (p === 'p') {
    const dir = white ? -1 : 1;
    const startRow = white ? 6 : 1;
    if (inBounds(r+dir, c) && !board[r+dir][c]) {
      moves.push([r+dir, c]);
      if (r === startRow && !board[r+2*dir][c]) moves.push([r+2*dir, c]);
    }
    for (const dc of [-1, 1]) {
      const nr = r+dir, nc = c+dc;
      if (!inBounds(nr, nc)) continue;
      if (board[nr][nc] && !sameColor(piece, board[nr][nc])) moves.push([nr, nc]);
      if (state.enPassant && state.enPassant[0] === nr && state.enPassant[1] === nc)
        moves.push([nr, nc]);
    }
  }
  if (p === 'k') {
    for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]])
      add(r+dr, c+dc);
    if (!skipCastling) {
      const rank = white ? 7 : 0;
      if (r === rank && c === 4) {
        if ((white ? state.castling.K : state.castling.k) &&
            !board[rank][5] && !board[rank][6] &&
            !isAttacked(board, state, rank, 4, !white) &&
            !isAttacked(board, state, rank, 5, !white) &&
            !isAttacked(board, state, rank, 6, !white))
          moves.push([rank, 6]);
        if ((white ? state.castling.Q : state.castling.q) &&
            !board[rank][3] && !board[rank][2] && !board[rank][1] &&
            !isAttacked(board, state, rank, 4, !white) &&
            !isAttacked(board, state, rank, 3, !white) &&
            !isAttacked(board, state, rank, 2, !white))
          moves.push([rank, 2]);
      }
    }
  }
  return moves;
}

function isAttacked(board, state, r, c, byWhite) {
  const noEp = { ...state, enPassant: null };
  for (let pr = 0; pr < 8; pr++)
    for (let pc = 0; pc < 8; pc++) {
      const p = board[pr][pc];
      if (!p || isWhite(p) !== byWhite) continue;
      if (getCandidates(board, noEp, pr, pc, true).some(([mr,mc]) => mr===r && mc===c))
        return true;
    }
  return false;
}

function applyLocal(board, state, fr, fc, tr, tc) {
  const b = board.map(row => [...row]);
  const piece = b[fr][fc];
  const p = piece.toLowerCase();
  const white = isWhite(piece);
  const castling = { ...state.castling };
  let enPassant = null;

  // En passant capture
  if (p === 'p' && state.enPassant && tr === state.enPassant[0] && tc === state.enPassant[1])
    b[fr][tc] = null;

  // Two-step pawn
  if (p === 'p' && Math.abs(tr - fr) === 2) enPassant = [(fr+tr)/2, tc];

  // Castling rook
  if (p === 'k') {
    if (fc === 4 && tc === 6) { b[fr][5] = b[fr][7]; b[fr][7] = null; }
    if (fc === 4 && tc === 2) { b[fr][3] = b[fr][0]; b[fr][0] = null; }
    if (white) { castling.K = false; castling.Q = false; }
    else       { castling.k = false; castling.q = false; }
  }

  b[tr][tc] = b[fr][fc];
  b[fr][fc] = null;

  // Promotion — always queen for legality check purposes
  if (p === 'p' && (tr === 0 || tr === 7)) b[tr][tc] = white ? 'Q' : 'q';

  return { board: b, state: { ...state, castling, enPassant, turn: white ? 'b' : 'w' } };
}

function findKing(board, white) {
  const k = white ? 'K' : 'k';
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (board[r][c] === k) return [r, c];
  return null;
}

function inCheckLocal(board, state, white) {
  const king = findKing(board, white);
  if (!king) return false;
  return isAttacked(board, state, king[0], king[1], !white);
}

function legalMovesFor(board, state, r, c) {
  const piece = board[r][c];
  if (!piece) return [];
  const white = isWhite(piece);
  return getCandidates(board, state, r, c, false).filter(([nr, nc]) => {
    const { board: nb, state: ns } = applyLocal(board, state, r, c, nr, nc);
    return !inCheckLocal(nb, ns, white);
  });
}

function isPawnPromotion(board, r, c, nr) {
  const p = board[r][c];
  return (p === 'P' && nr === 0) || (p === 'p' && nr === 7);
}

window.ChessMoves = { legalMovesFor, parseFenState, isPawnPromotion };
