'use strict';

/**
 * Server-side Western Chess engine.
 * Board: 8x8 array, row 0 = rank 8 (Black's back rank), row 7 = rank 1 (White's back rank).
 * Uppercase = White (K Q R B N P), lowercase = Black (k q r b n p).
 * Exposes the same interface as xiangqi.js: createGame() -> { move, undo, fen, turn, inCheck, isGameOver, legalMoves, boardState }
 * Additional: winner() -> 'white'|'black'|'draw'|null
 */

const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// ── FEN parsing / serialisation ──────────────────────────────────────

function parseFen(fen) {
  const parts = fen.split(' ');
  const boardStr = parts[0];
  const turn = parts[1] || 'w';
  const castlingStr = parts[2] || '-';
  const epStr = parts[3] || '-';
  const halfmove = parseInt(parts[4]) || 0;
  const fullmove = parseInt(parts[5]) || 1;

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
    K: castlingStr.includes('K'),
    Q: castlingStr.includes('Q'),
    k: castlingStr.includes('k'),
    q: castlingStr.includes('q'),
  };

  let enPassant = null;
  if (epStr !== '-') {
    const file = 'abcdefgh'.indexOf(epStr[0]);
    const rank = parseInt(epStr[1]);
    enPassant = [8 - rank, file]; // row, col
  }

  return { board, turn, castling, enPassant, halfmove, fullmove };
}

function boardToFen(board, turn, castling, enPassant, halfmove, fullmove) {
  const rows = [];
  for (const row of board) {
    let s = '', empty = 0;
    for (const cell of row) {
      if (cell === null) { empty++; }
      else { if (empty) { s += empty; empty = 0; } s += cell; }
    }
    if (empty) s += empty;
    rows.push(s);
  }
  const castlingStr = [
    castling.K ? 'K' : '',
    castling.Q ? 'Q' : '',
    castling.k ? 'k' : '',
    castling.q ? 'q' : '',
  ].join('') || '-';

  let epStr = '-';
  if (enPassant) {
    epStr = 'abcdefgh'[enPassant[1]] + (8 - enPassant[0]);
  }

  return `${rows.join('/')} ${turn} ${castlingStr} ${epStr} ${halfmove} ${fullmove}`;
}

// ── Helpers ───────────────────────────────────────────────────────────

function isWhite(p) { return p && p === p.toUpperCase(); }
function isBlack(p) { return p && p === p.toLowerCase(); }
function sameColor(a, b) {
  if (!a || !b) return false;
  return (isWhite(a) && isWhite(b)) || (isBlack(a) && isBlack(b));
}
function inBounds(r, c) { return r >= 0 && r <= 7 && c >= 0 && c <= 7; }

function cloneBoard(board) { return board.map(row => [...row]); }

function cloneState(s) {
  return {
    board: cloneBoard(s.board),
    turn: s.turn,
    castling: { ...s.castling },
    enPassant: s.enPassant ? [...s.enPassant] : null,
    halfmove: s.halfmove,
    fullmove: s.fullmove,
  };
}

// ── Pseudo-legal move generation ──────────────────────────────────────

/**
 * Returns candidate [row, col] destinations for piece at (r, c).
 * Does NOT filter for leaving own king in check.
 * skipCastling prevents infinite recursion in isSquareAttacked.
 */
function getCandidateMoves(board, state, r, c, skipCastling = false) {
  const piece = board[r][c];
  if (!piece) return [];
  const p = piece.toLowerCase();
  const white = isWhite(piece);
  const moves = [];

  const add = (nr, nc) => {
    if (!inBounds(nr, nc)) return false;
    if (sameColor(piece, board[nr][nc])) return false;
    moves.push([nr, nc]);
    return !board[nr][nc]; // returns true if square was empty (can continue sliding)
  };

  if (p === 'r' || p === 'q') {
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      let nr = r+dr, nc = c+dc;
      while (inBounds(nr, nc)) { if (!add(nr, nc)) break; nr += dr; nc += dc; }
    }
  }
  if (p === 'b' || p === 'q') {
    for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
      let nr = r+dr, nc = c+dc;
      while (inBounds(nr, nc)) { if (!add(nr, nc)) break; nr += dr; nc += dc; }
    }
  }
  if (p === 'n') {
    for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
      add(r+dr, c+dc);
    }
  }
  if (p === 'p') {
    const dir = white ? -1 : 1;
    const startRow = white ? 6 : 1;
    // Forward
    if (inBounds(r+dir, c) && !board[r+dir][c]) {
      moves.push([r+dir, c]);
      // Double push from start
      if (r === startRow && !board[r+2*dir][c]) moves.push([r+2*dir, c]);
    }
    // Captures
    for (const dc of [-1, 1]) {
      const nr = r+dir, nc = c+dc;
      if (!inBounds(nr, nc)) continue;
      if (board[nr][nc] && !sameColor(piece, board[nr][nc])) moves.push([nr, nc]);
      // En passant
      if (state.enPassant && state.enPassant[0] === nr && state.enPassant[1] === nc) {
        moves.push([nr, nc]);
      }
    }
  }
  if (p === 'k') {
    for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
      add(r+dr, c+dc);
    }
    // Castling
    if (!skipCastling) {
      const backRank = white ? 7 : 0;
      if (r === backRank && c === 4) {
        // Kingside
        if ((white ? state.castling.K : state.castling.k) &&
            !board[backRank][5] && !board[backRank][6] &&
            !isSquareAttacked(board, state, backRank, 4, !white) &&
            !isSquareAttacked(board, state, backRank, 5, !white) &&
            !isSquareAttacked(board, state, backRank, 6, !white)) {
          moves.push([backRank, 6]);
        }
        // Queenside
        if ((white ? state.castling.Q : state.castling.q) &&
            !board[backRank][3] && !board[backRank][2] && !board[backRank][1] &&
            !isSquareAttacked(board, state, backRank, 4, !white) &&
            !isSquareAttacked(board, state, backRank, 3, !white) &&
            !isSquareAttacked(board, state, backRank, 2, !white)) {
          moves.push([backRank, 2]);
        }
      }
    }
  }
  return moves;
}

function isSquareAttacked(board, state, r, c, byWhite) {
  const noEpState = { ...state, enPassant: null };
  for (let pr = 0; pr < 8; pr++) {
    for (let pc = 0; pc < 8; pc++) {
      const piece = board[pr][pc];
      if (!piece) continue;
      if (isWhite(piece) !== byWhite) continue;
      const moves = getCandidateMoves(board, noEpState, pr, pc, true);
      if (moves.some(([mr, mc]) => mr === r && mc === c)) return true;
    }
  }
  return false;
}

// ── Apply move ────────────────────────────────────────────────────────

function applyMove(state, from, to, promotion = null) {
  const [fr, fc] = from;
  const [tr, tc] = to;
  const board = cloneBoard(state.board);
  const castling = { ...state.castling };
  let enPassant = null;
  let halfmove = state.halfmove + 1;
  let fullmove = state.fullmove;

  const piece = board[fr][fc];
  const p = piece.toLowerCase();
  const white = isWhite(piece);

  // En passant capture: remove the captured pawn
  if (p === 'p' && state.enPassant && tr === state.enPassant[0] && tc === state.enPassant[1]) {
    board[fr][tc] = null; // the captured pawn is on same row as moving pawn
  }

  // Two-step pawn: set new en passant square
  if (p === 'p' && Math.abs(tr - fr) === 2) {
    enPassant = [(fr + tr) / 2, tc];
  }

  // Castling: move the rook too
  if (p === 'k') {
    if (fc === 4 && tc === 6) { board[fr][5] = board[fr][7]; board[fr][7] = null; } // kingside
    if (fc === 4 && tc === 2) { board[fr][3] = board[fr][0]; board[fr][0] = null; } // queenside
    // Remove all castling rights for this color
    if (white) { castling.K = false; castling.Q = false; }
    else        { castling.k = false; castling.q = false; }
  }

  // Update castling rights if rook moves or is captured
  const rookSquares = { 7: { 7: 'K', 0: 'Q' }, 0: { 7: 'k', 0: 'q' } };
  if (rookSquares[fr] && rookSquares[fr][fc]) castling[rookSquares[fr][fc]] = false;
  if (rookSquares[tr] && rookSquares[tr][tc]) castling[rookSquares[tr][tc]] = false;

  // Move piece
  board[tr][tc] = board[fr][fc];
  board[fr][fc] = null;

  // Pawn promotion
  if (p === 'p' && (tr === 0 || tr === 7)) {
    const promPiece = promotion || (white ? 'Q' : 'q');
    board[tr][tc] = white ? promPiece.toUpperCase() : promPiece.toLowerCase();
  }

  // Reset halfmove on pawn move or capture
  if (p === 'p' || (state.board[tr][tc] !== null)) halfmove = 0;

  if (!white) fullmove++;

  return {
    board,
    turn: white ? 'b' : 'w',
    castling,
    enPassant,
    halfmove,
    fullmove,
  };
}

// ── Check & game over ─────────────────────────────────────────────────

function findKing(board, white) {
  const k = white ? 'K' : 'k';
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (board[r][c] === k) return [r, c];
  return null;
}

function isInCheck(board, state, white) {
  const king = findKing(board, white);
  if (!king) return false;
  return isSquareAttacked(board, state, king[0], king[1], !white);
}

function legalMovesFor(board, state, r, c) {
  const piece = board[r][c];
  if (!piece) return [];
  const white = isWhite(piece);
  const candidates = getCandidateMoves(board, state, r, c);
  return candidates.filter(([nr, nc]) => {
    const promotion = (piece.toLowerCase() === 'p' && (nr === 0 || nr === 7)) ? (white ? 'Q' : 'q') : null;
    const newState = applyMove(state, [r, c], [nr, nc], promotion);
    return !isInCheck(newState.board, newState, white);
  });
}

function hasAnyLegalMove(board, state, white) {
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && isWhite(p) === white) {
        if (legalMovesFor(board, state, r, c).length > 0) return true;
      }
    }
  return false;
}

function isGameOver(board, state) {
  const white = state.turn === 'w';
  return !hasAnyLegalMove(board, state, white);
}

// ── Public engine factory ─────────────────────────────────────────────

function createGame() {
  let state = parseFen(INITIAL_FEN);
  const history = [];

  function move(from, to, promotion) {
    const { board, turn } = state;
    const [fr, fc] = from;
    const piece = board[fr][fc];
    if (!piece) return { ok: false, reason: 'No piece at source' };

    const white = turn === 'w';
    if (isWhite(piece) !== white) return { ok: false, reason: 'Not your piece' };

    const legal = legalMovesFor(board, state, fr, fc);
    if (!legal.some(([r, c]) => r === to[0] && c === to[1])) {
      return { ok: false, reason: 'Illegal move' };
    }

    // Normalize promotion piece to correct case
    let prom = promotion || null;
    if (prom) prom = white ? prom.toUpperCase() : prom.toLowerCase();

    history.push(cloneState(state));
    state = applyMove(state, from, to, prom);
    return { ok: true };
  }

  function undo() {
    if (history.length === 0) return false;
    state = history.pop();
    return true;
  }

  function fen() {
    return boardToFen(state.board, state.turn, state.castling, state.enPassant, state.halfmove, state.fullmove);
  }

  function turn() { return state.turn; }

  function inCheck() { return isInCheck(state.board, state, state.turn === 'w'); }

  function gameOver() { return isGameOver(state.board, state); }

  function winner() {
    if (!isGameOver(state.board, state)) return null;
    // Current side has no moves
    if (isInCheck(state.board, state, state.turn === 'w')) {
      // Checkmate — the side that just moved wins
      return state.turn === 'w' ? 'black' : 'white';
    }
    return 'draw'; // stalemate
  }

  function legalMoves(square) {
    return legalMovesFor(state.board, state, square[0], square[1]);
  }

  function boardState() { return cloneBoard(state.board); }

  return { move, undo, fen, turn, inCheck, isGameOver: gameOver, winner, legalMoves, boardState };
}

module.exports = { createGame, INITIAL_FEN };
