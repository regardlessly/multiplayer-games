'use strict';

/**
 * Chess Canvas Board Renderer
 * Standard 8x8 board with unicode pieces, legal move dots, last-move highlight.
 * Flips 180° for Black player.
 */

const PIECE_UNICODE = {
  K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟'
};

const LIGHT_SQ = '#f0d9b5';
const DARK_SQ  = '#b58863';
const COLS = 8, ROWS = 8;

class ChessBoard {
  constructor(canvas, playerColor) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.playerColor = playerColor;
    this.flipped = playerColor === 'black';

    this.selected = null;
    this.legalDots = [];
    this.lastMove = null;
    this.board = null;
    this.fenState = null;

    this.onMove = null;
    this.onPieceSelect = null;
    this.onPromotionNeeded = null;

    this._setupCanvas();
    canvas.addEventListener('click', e => this._onClick(e));
    canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      const touch = e.touches[0];
      const rect = canvas.getBoundingClientRect();
      this._handleClick(touch.clientX - rect.left, touch.clientY - rect.top);
    }, { passive: false });
  }

  _setupCanvas() {
    const size = Math.min(window.innerWidth - 32, 560);
    this.canvas.width = size;
    this.canvas.height = size;
    this._calcMetrics();
  }

  _calcMetrics() {
    this.cellSize = this.canvas.width / COLS;
    this.pieceFont = Math.round(this.cellSize * 0.74);
  }

  resize() { this._setupCanvas(); this.draw(); }

  _toCanvas(r, c) {
    const dr = this.flipped ? (ROWS - 1 - r) : r;
    const dc = this.flipped ? (COLS - 1 - c) : c;
    return { x: dc * this.cellSize, y: dr * this.cellSize };
  }

  _toBoard(x, y) {
    const dc = Math.floor(x / this.cellSize);
    const dr = Math.floor(y / this.cellSize);
    if (dr < 0 || dr >= ROWS || dc < 0 || dc >= COLS) return null;
    const br = this.flipped ? (ROWS - 1 - dr) : dr;
    const bc = this.flipped ? (COLS - 1 - dc) : dc;
    return [br, bc];
  }

  _onClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    this._handleClick(e.clientX - rect.left, e.clientY - rect.top);
  }

  _handleClick(x, y) {
    const sq = this._toBoard(x, y);
    if (!sq || !this.board) return;
    const [r, c] = sq;

    if (this.selected) {
      const isLegal = this.legalDots.some(([lr, lc]) => lr === r && lc === c);
      if (isLegal) {
        const from = this.selected;
        this.selected = null;
        this.legalDots = [];
        this.draw();

        // Promotion?
        if (this.onPromotionNeeded &&
            ChessMoves.isPawnPromotion(this.board, from[0], from[1], r)) {
          this.onPromotionNeeded(from, [r, c]);
        } else {
          if (this.onMove) this.onMove(from, [r, c], null);
        }
        return;
      }
      // Clicked elsewhere — deselect then try to select new piece
      this.selected = null;
      this.legalDots = [];
    }

    const piece = this.board[r][c];
    if (piece && this.onPieceSelect) {
      this.selected = [r, c];
      this.legalDots = this.onPieceSelect([r, c]);
      this.draw();
    }
  }

  draw() {
    if (!this.board) return;
    const ctx = this.ctx;
    const { cellSize } = this;

    // ── Squares ─────────────────────────────────────────────────────
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const { x, y } = this._toCanvas(r, c);
        ctx.fillStyle = (r + c) % 2 === 0 ? LIGHT_SQ : DARK_SQ;
        ctx.fillRect(x, y, cellSize, cellSize);
      }
    }

    // ── Last move highlight ──────────────────────────────────────────
    if (this.lastMove) {
      for (const sq of [this.lastMove.from, this.lastMove.to]) {
        if (!sq) continue;
        const { x, y } = this._toCanvas(sq[0], sq[1]);
        ctx.fillStyle = 'rgba(255, 215, 0, 0.42)';
        ctx.fillRect(x, y, cellSize, cellSize);
      }
    }

    // ── Selected square ──────────────────────────────────────────────
    if (this.selected) {
      const { x, y } = this._toCanvas(this.selected[0], this.selected[1]);
      ctx.fillStyle = 'rgba(20, 160, 20, 0.50)';
      ctx.fillRect(x, y, cellSize, cellSize);
    }

    // ── Legal move dots / capture rings ─────────────────────────────
    for (const [r, c] of this.legalDots) {
      const { x, y } = this._toCanvas(r, c);
      const cx = x + cellSize / 2;
      const cy = y + cellSize / 2;
      ctx.fillStyle = 'rgba(17, 85, 204, 0.22)';
      ctx.beginPath();
      if (this.board[r][c]) {
        // Capture: hollow ring
        ctx.arc(cx, cy, cellSize * 0.46, 0, Math.PI * 2);
        ctx.arc(cx, cy, cellSize * 0.33, 0, Math.PI * 2, true);
      } else {
        ctx.arc(cx, cy, cellSize * 0.16, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    // ── Rank/file labels ─────────────────────────────────────────────
    const labelSize = Math.round(cellSize * 0.20);
    ctx.font = `bold ${labelSize}px sans-serif`;
    for (let i = 0; i < 8; i++) {
      const visualRow = i; // canvas row
      const boardRow = this.flipped ? (ROWS - 1 - i) : i;
      const boardCol = this.flipped ? (COLS - 1 - i) : i;
      const rank = 8 - boardRow;
      const file = 'abcdefgh'[boardCol];
      const lightSquare = (boardRow + 0) % 2 === 0; // rank label is on column 0

      // Rank number — top-left of leftmost square in this row
      ctx.fillStyle = (lightSquare) ? DARK_SQ : LIGHT_SQ;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(String(rank), 2, visualRow * cellSize + 2);

      // File letter — bottom-right of bottom-most square in this column
      const fileSquareDark = (7 + boardCol) % 2 !== 0;
      ctx.fillStyle = fileSquareDark ? LIGHT_SQ : DARK_SQ;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(file, (i + 1) * cellSize - 2, 8 * cellSize - 2);
    }

    // ── Pieces ───────────────────────────────────────────────────────
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${this.pieceFont}px serif`;

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const piece = this.board[r][c];
        if (!piece) continue;
        const { x, y } = this._toCanvas(r, c);
        const cx = x + cellSize / 2;
        const cy = y + cellSize / 2 + cellSize * 0.02; // slight optical centre

        const white = piece === piece.toUpperCase();
        const glyph = PIECE_UNICODE[piece] || piece;

        if (white) {
          // Outline: dark shadow
          ctx.fillStyle = '#222';
          ctx.fillText(glyph, cx + 1, cy + 1);
          // Fill: white
          ctx.fillStyle = '#fff';
          ctx.fillText(glyph, cx, cy);
        } else {
          // Outline: light shadow
          ctx.fillStyle = '#ccc';
          ctx.fillText(glyph, cx + 1, cy + 1);
          // Fill: dark
          ctx.fillStyle = '#111';
          ctx.fillText(glyph, cx, cy);
        }
      }
    }
  }

  updateBoard(board, fenState, lastMove) {
    this.board = board;
    this.fenState = fenState;
    if (lastMove) this.lastMove = lastMove;
    this.selected = null;
    this.legalDots = [];
    this.draw();
  }
}

window.ChessBoard = ChessBoard;
