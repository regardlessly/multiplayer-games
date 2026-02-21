'use strict';

/**
 * Xiangqi Canvas Board Renderer
 * Draws a 9x10 Xiangqi board with pieces, highlights, and legal move dots.
 * Flips the board 180° for the Black player.
 */

const PIECE_LABELS = {
  // Red (uppercase)
  K: '帥', R: '車', N: '馬', B: '相', A: '仕', C: '炮', P: '兵',
  // Black (lowercase)
  k: '將', r: '車', n: '馬', b: '象', a: '士', c: '炮', p: '卒'
};

const COLS = 9;
const ROWS = 10;

class XiangqiBoard {
  constructor(canvas, playerColor) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.playerColor = playerColor; // 'red' | 'black' | 'spectator'
    this.flipped = playerColor === 'black'; // Black sees board flipped

    this.selected = null;      // [row, col] of selected piece
    this.legalDots = [];       // [[row,col], ...]
    this.lastMove = null;      // { from:[r,c], to:[r,c] }
    this.board = null;         // 10x9 array from FEN

    this.onMove = null;        // callback(from, to)

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
    this.canvas.height = Math.round(size * 10 / 9);
    this._calcMetrics();
  }

  _calcMetrics() {
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.padding = Math.round(w * 0.065);
    this.cellW = (w - 2 * this.padding) / (COLS - 1);
    this.cellH = (h - 2 * this.padding) / (ROWS - 1);
    this.pieceR = Math.round(Math.min(this.cellW, this.cellH) * 0.42);
  }

  resize() {
    this._setupCanvas();
    this.draw();
  }

  // Convert board [row,col] → canvas [x,y]
  _toCanvas(r, c) {
    const dr = this.flipped ? (ROWS - 1 - r) : r;
    const dc = this.flipped ? (COLS - 1 - c) : c;
    return {
      x: this.padding + dc * this.cellW,
      y: this.padding + dr * this.cellH
    };
  }

  // Convert canvas [x,y] → board [row,col], returns null if out of bounds
  _toBoard(x, y) {
    const c = Math.round((x - this.padding) / this.cellW);
    const r = Math.round((y - this.padding) / this.cellH);
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
    const br = this.flipped ? (ROWS - 1 - r) : r;
    const bc = this.flipped ? (COLS - 1 - c) : c;
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
        if (this.onMove) this.onMove(from, [r, c]);
        this.draw();
        return;
      }
      // Clicked own piece — reselect
      this.selected = null;
      this.legalDots = [];
    }

    // Select piece
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
    const { padding, cellW, cellH, pieceR } = this;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Board background
    ctx.fillStyle = '#f0c060';
    ctx.fillRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = '#5a3010';
    ctx.lineWidth = 1.5;
    for (let r = 0; r < ROWS; r++) {
      const { y } = this._toCanvas(r, 0);
      const { x: x1 } = this._toCanvas(r, COLS - 1);
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
    }
    for (let c = 0; c < COLS; c++) {
      // Top half (rows 0-4)
      for (let seg of [[0, 4], [5, 9]]) {
        const { y: y0 } = this._toCanvas(seg[0], c);
        const { y: y1 } = this._toCanvas(seg[1], c);
        const { x } = this._toCanvas(0, c);
        ctx.beginPath();
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
        ctx.stroke();
      }
    }

    // River text
    const { y: riverY } = this._toCanvas(4, 0);
    const riverMidY = riverY + cellH / 2;
    ctx.fillStyle = '#5a3010';
    ctx.font = `bold ${Math.round(cellH * 0.35)}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('楚河', padding + cellW * 1.5, riverMidY);
    ctx.fillText('漢界', padding + cellW * 5.5, riverMidY);

    // Palace diagonals
    ctx.strokeStyle = '#5a3010';
    ctx.lineWidth = 1.5;
    this._drawPalaceDiagonals(0, 3);  // Black palace
    this._drawPalaceDiagonals(7, 3);  // Red palace

    // Last move highlight
    if (this.lastMove) {
      for (const sq of [this.lastMove.from, this.lastMove.to]) {
        if (!sq) continue;
        const { x, y } = this._toCanvas(sq[0], sq[1]);
        ctx.fillStyle = 'rgba(255, 215, 0, 0.35)';
        ctx.beginPath();
        ctx.arc(x, y, pieceR + 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Legal move dots
    for (const [r, c] of this.legalDots) {
      const { x, y } = this._toCanvas(r, c);
      ctx.fillStyle = 'rgba(0, 150, 80, 0.65)';
      ctx.beginPath();
      ctx.arc(x, y, pieceR * 0.38, 0, Math.PI * 2);
      ctx.fill();
    }

    // Pieces
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const piece = this.board[r][c];
        if (!piece) continue;

        const { x, y } = this._toCanvas(r, c);
        const isRed = piece === piece.toUpperCase();
        const isSelected = this.selected && this.selected[0] === r && this.selected[1] === c;

        // Selection ring
        if (isSelected) {
          ctx.strokeStyle = '#ffd700';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(x, y, pieceR + 4, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Piece circle
        ctx.fillStyle = '#f5e6c0';
        ctx.strokeStyle = isRed ? '#8b0000' : '#1a1a1a';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x, y, pieceR, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Inner decorative ring
        ctx.strokeStyle = isRed ? '#c0392b' : '#333';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, pieceR * 0.82, 0, Math.PI * 2);
        ctx.stroke();

        // Character
        ctx.fillStyle = isRed ? '#8b0000' : '#1a1a1a';
        ctx.font = `bold ${Math.round(pieceR * 1.2)}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(PIECE_LABELS[piece] || piece, x, y);
      }
    }
  }

  _drawPalaceDiagonals(topRow, leftCol) {
    const { ctx } = this;
    const corners = [
      this._toCanvas(topRow, leftCol),
      this._toCanvas(topRow, leftCol + 2),
      this._toCanvas(topRow + 2, leftCol),
      this._toCanvas(topRow + 2, leftCol + 2)
    ];
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    ctx.lineTo(corners[3].x, corners[3].y);
    ctx.moveTo(corners[1].x, corners[1].y);
    ctx.lineTo(corners[2].x, corners[2].y);
    ctx.stroke();
  }

  updateBoard(board, lastMove) {
    this.board = board;
    if (lastMove) this.lastMove = lastMove;
    this.selected = null;
    this.legalDots = [];
    this.draw();
  }
}

window.XiangqiBoard = XiangqiBoard;
