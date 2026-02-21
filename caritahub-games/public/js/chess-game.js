'use strict';

// ── URL params ────────────────────────────────────────────────────────
const params = new URLSearchParams(window.location.search);
const roomId   = params.get('room');
const myColor  = params.get('color');   // 'white' | 'black' | 'spectator'
const myName   = params.get('name') || 'Player';

if (!roomId) window.location.href = '/';

// ── DOM refs ──────────────────────────────────────────────────────────
const statusBar       = document.getElementById('statusBar');
const opponentPanel   = document.getElementById('opponentPanel');
const myPanel         = document.getElementById('myPanel');
const opponentNameEl  = document.getElementById('opponentName');
const opponentTagEl   = document.getElementById('opponentTag');
const myNameEl        = document.getElementById('myName');
const myTagEl         = document.getElementById('myTag');
const undoBtn         = document.getElementById('undoBtn');
const resignBtn       = document.getElementById('resignBtn');

const promotionOverlay  = document.getElementById('promotionOverlay');
const promotionChoices  = document.getElementById('promotionChoices');

const undoOverlay     = document.getElementById('undoOverlay');
const undoMsg         = document.getElementById('undoMsg');
const acceptUndoBtn   = document.getElementById('acceptUndoBtn');
const declineUndoBtn  = document.getElementById('declineUndoBtn');

const resignOverlay   = document.getElementById('resignOverlay');
const confirmResignBtn = document.getElementById('confirmResignBtn');
const cancelResignBtn = document.getElementById('cancelResignBtn');

const gameOverOverlay = document.getElementById('gameOverOverlay');
const gameOverTitle   = document.getElementById('gameOverTitle');
const gameOverMsg     = document.getElementById('gameOverMsg');
const backLobbyBtn    = document.getElementById('backLobbyBtn');

const reconnectOverlay = document.getElementById('reconnectOverlay');
const reconnectMsg     = document.getElementById('reconnectMsg');
const backLobbyLink    = document.getElementById('backLobbyLink');

// ── Panel setup ───────────────────────────────────────────────────────
const opponentColor = myColor === 'white' ? 'black' : 'white';

myNameEl.textContent     = myName;
myTagEl.textContent      = myColor === 'white' ? 'White' : 'Black';
opponentTagEl.textContent = opponentColor === 'white' ? 'White' : 'Black';

// White uses panel-red (cream/red border), black uses panel-black (grey/dark border)
if (myColor === 'black') {
  myPanel.className       = 'player-panel panel-black';
  opponentPanel.className = 'player-panel panel-red';
}

// ── Board ─────────────────────────────────────────────────────────────
const canvas   = document.getElementById('boardCanvas');
const chBoard  = new ChessBoard(canvas, myColor);
let gameActive = false;
let myTurn     = false;
let currentBoard    = null;
let currentFenState = null;

chBoard.onPieceSelect = ([r, c]) => {
  if (!gameActive || !myTurn || !currentBoard || !currentFenState) return [];
  const piece = currentBoard[r][c];
  if (!piece) return [];
  const pieceIsWhite = piece === piece.toUpperCase();
  if ((myColor === 'white') !== pieceIsWhite) return [];
  return ChessMoves.legalMovesFor(currentBoard, currentFenState, r, c);
};

chBoard.onMove = (from, to, promotion) => {
  if (!gameActive || !myTurn) return;
  socket.emit('make_move', { from, to, promotion: promotion || null });
};

chBoard.onPromotionNeeded = (from, to) => {
  showPromotionPicker(from, to);
};

// ── Promotion picker ──────────────────────────────────────────────────
function showPromotionPicker(from, to) {
  const white = myColor === 'white';
  const pieces = white
    ? [['Q','♕'],['R','♖'],['B','♗'],['N','♘']]
    : [['q','♛'],['r','♜'],['b','♝'],['n','♞']];

  promotionChoices.innerHTML = '';
  for (const [piece, glyph] of pieces) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary';
    btn.style.flex = '1';
    btn.style.fontSize = '2rem';
    btn.style.minWidth = '60px';
    btn.textContent = glyph;
    btn.addEventListener('click', () => {
      promotionOverlay.classList.add('hidden');
      socket.emit('make_move', { from, to, promotion: piece });
    });
    promotionChoices.appendChild(btn);
  }
  promotionOverlay.classList.remove('hidden');
}

// ── Socket ────────────────────────────────────────────────────────────
let reconnectAttempts = 0;

const socket = io({ reconnectionAttempts: 5, reconnectionDelay: 1000 });

socket.on('connect', () => {
  reconnectAttempts = 0;
  reconnectOverlay.style.display = 'none';
  socket.emit('join_game', { roomId, playerName: myName, reconnect: true, gameType: 'chess' });
});

socket.on('disconnect', () => {
  reconnectOverlay.style.display = 'flex';
  reconnectMsg.textContent = 'Connection lost. Reconnecting…';
});

socket.on('reconnect_attempt', n => {
  reconnectAttempts = n;
  reconnectMsg.textContent = `Reconnecting… (attempt ${n})`;
});

socket.on('reconnect_failed', () => {
  reconnectMsg.textContent = 'Could not reconnect. Please return to the lobby.';
  backLobbyLink.classList.remove('hidden');
});

socket.on('joined', () => { /* seat confirmed */ });

socket.on('room_update', ({ players }) => {
  const opp = players.find(p => p.color === opponentColor);
  if (opp) opponentNameEl.textContent = opp.name;
});

socket.on('game_started', state => applyGameState(state));
socket.on('game_state',   state => applyGameState(state));

socket.on('invalid_move', ({ reason }) => flashStatus(`Invalid: ${reason}`, 2000));

socket.on('undo_requested', ({ from }) => {
  undoMsg.textContent = `${from} wants to undo the last move.`;
  undoOverlay.classList.remove('hidden');
});

socket.on('undo_declined', () => flashStatus('Undo declined by opponent.', 2500));

socket.on('game_over', ({ winner, reason }) => showGameOver(winner, reason));

socket.on('player_disconnected', ({ playerName }) =>
  flashStatus(`${playerName} disconnected. Waiting for reconnection…`, 0));

// ── Game state ────────────────────────────────────────────────────────
function applyGameState(state) {
  gameActive  = !state.isGameOver;
  const parsed = ChessMoves.parseFenState(state.fen);
  currentBoard    = parsed.board;
  currentFenState = parsed;

  myTurn = (state.turn === 'w' && myColor === 'white') ||
           (state.turn === 'b' && myColor === 'black');

  const lastMove = state.lastMove
    ? { from: state.lastMove.from, to: state.lastMove.to } : null;
  chBoard.updateBoard(currentBoard, currentFenState, lastMove);

  const whiteActive = state.turn === 'w';
  opponentPanel.classList.toggle('panel-active', opponentColor === (whiteActive ? 'white' : 'black'));
  myPanel.classList.toggle('panel-active',       myColor       === (whiteActive ? 'white' : 'black'));

  statusBar.classList.remove('check', 'game-over');
  if (state.isGameOver) {
    statusBar.classList.add('game-over');
    if (state.winner === 'draw') {
      showGameOver('draw', 'Stalemate — it\'s a draw!');
    } else {
      showGameOver(state.winner, 'Checkmate');
    }
  } else if (state.inCheck) {
    statusBar.classList.add('check');
    statusBar.textContent = myTurn ? '⚠️ You are in CHECK!' : '⚠️ Opponent is in CHECK!';
  } else {
    statusBar.textContent = myTurn ? 'Your turn' : "Opponent's turn";
  }

  undoBtn.disabled = !gameActive || !myTurn;

  if (state.players) {
    const opp = state.players.find(p => p.color === opponentColor);
    if (opp) opponentNameEl.textContent = opp.name;
  }
}

function showGameOver(winner, reason) {
  gameActive = false;
  gameOverOverlay.classList.remove('hidden');
  if (winner === 'draw') {
    gameOverTitle.textContent = 'Draw!';
    gameOverMsg.textContent   = reason || 'Stalemate';
  } else if (winner === myColor) {
    gameOverTitle.textContent = 'You Win!';
    gameOverMsg.textContent   = reason || 'Congratulations!';
  } else {
    gameOverTitle.textContent = 'You Lose';
    gameOverMsg.textContent   = reason || 'Better luck next time!';
  }
}

let flashTimer = null;
function flashStatus(msg, duration) {
  statusBar.textContent = msg;
  if (flashTimer) clearTimeout(flashTimer);
  if (duration > 0) {
    flashTimer = setTimeout(() => {
      statusBar.textContent = myTurn ? 'Your turn' : "Opponent's turn";
    }, duration);
  }
}

// ── Button handlers ───────────────────────────────────────────────────
undoBtn.addEventListener('click', () => {
  socket.emit('request_undo');
  undoBtn.disabled = true;
  flashStatus('Undo request sent…', 0);
});
resignBtn.addEventListener('click', () => resignOverlay.classList.remove('hidden'));
confirmResignBtn.addEventListener('click', () => {
  resignOverlay.classList.add('hidden');
  socket.emit('resign');
});
cancelResignBtn.addEventListener('click', () => resignOverlay.classList.add('hidden'));
acceptUndoBtn.addEventListener('click', () => {
  undoOverlay.classList.add('hidden');
  socket.emit('approve_undo');
});
declineUndoBtn.addEventListener('click', () => {
  undoOverlay.classList.add('hidden');
  socket.emit('decline_undo');
});
backLobbyBtn.addEventListener('click', () => { window.location.href = '/lobby.html?game=chess'; });

// ── Resize ────────────────────────────────────────────────────────────
window.addEventListener('resize', () => chBoard.resize());
