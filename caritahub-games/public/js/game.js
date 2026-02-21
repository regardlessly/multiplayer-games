'use strict';

// ── Read URL params ─────────────────────────────────────────────────
const params = new URLSearchParams(window.location.search);
const roomId = params.get('room');
const myColor = params.get('color');   // 'red' | 'black' | 'spectator'
const myName = params.get('name') || 'Player';

if (!roomId) {
  window.location.href = '/';
}

// ── DOM refs ────────────────────────────────────────────────────────
const statusBar = document.getElementById('statusBar');
const opponentPanel = document.getElementById('opponentPanel');
const myPanel = document.getElementById('myPanel');
const opponentNameEl = document.getElementById('opponentName');
const opponentTagEl = document.getElementById('opponentTag');
const myNameEl = document.getElementById('myName');
const myTagEl = document.getElementById('myTag');
const undoBtn = document.getElementById('undoBtn');
const resignBtn = document.getElementById('resignBtn');

const undoOverlay = document.getElementById('undoOverlay');
const undoMsg = document.getElementById('undoMsg');
const acceptUndoBtn = document.getElementById('acceptUndoBtn');
const declineUndoBtn = document.getElementById('declineUndoBtn');

const resignOverlay = document.getElementById('resignOverlay');
const confirmResignBtn = document.getElementById('confirmResignBtn');
const cancelResignBtn = document.getElementById('cancelResignBtn');

const gameOverOverlay = document.getElementById('gameOverOverlay');
const gameOverTitle = document.getElementById('gameOverTitle');
const gameOverMsg = document.getElementById('gameOverMsg');
const backLobbyBtn = document.getElementById('backLobbyBtn');

const reconnectOverlay = document.getElementById('reconnectOverlay');
const reconnectMsg = document.getElementById('reconnectMsg');
const backLobbyLink = document.getElementById('backLobbyLink');

// ── My color panels ──────────────────────────────────────────────────
const opponentColor = myColor === 'red' ? 'black' : 'red';

myNameEl.textContent = myName;
myTagEl.textContent = myColor === 'red' ? 'Red (先手)' : 'Black (後手)';
opponentTagEl.textContent = opponentColor === 'red' ? 'Red (先手)' : 'Black (後手)';

if (myColor === 'black') {
  myPanel.className = 'player-panel panel-black';
  opponentPanel.className = 'player-panel panel-red';
}

// ── Board ────────────────────────────────────────────────────────────
const canvas = document.getElementById('boardCanvas');
const xiBoard = new XiangqiBoard(canvas, myColor);
let gameActive = false;
let myTurn = false;

// When player selects a piece — return legal move squares to the board
xiBoard.onPieceSelect = ([r, c]) => {
  if (!gameActive || !myTurn) return [];
  if (!currentBoard) return [];
  const piece = currentBoard[r][c];
  if (!piece) return [];
  const pieceIsRed = piece === piece.toUpperCase();
  if ((myColor === 'red') !== pieceIsRed) return [];
  return XiangqiMoves.legalMovesFor(currentBoard, r, c);
};

// When player confirms a move
xiBoard.onMove = (from, to) => {
  if (!gameActive || !myTurn) return;
  socket.emit('make_move', { from, to });
};

// ── Board state ──────────────────────────────────────────────────────
let currentBoard = null;

// ── Socket ───────────────────────────────────────────────────────────
let reconnectAttempts = 0;
let hasConnectedBefore = false;

const socket = io({
  reconnectionAttempts: 5,
  reconnectionDelay: 1000
});

socket.on('connect', () => {
  reconnectAttempts = 0;
  reconnectOverlay.style.display = 'none';
  // Always use reconnect:true on the game page — the player already claimed their seat
  // in the lobby. This bypasses rate limiting and allows seat reclaim by name.
  socket.emit('join_game', { roomId, playerName: myName, reconnect: true, gameType: 'xiangqi' });
  hasConnectedBefore = true;
});

socket.on('disconnect', () => {
  reconnectOverlay.style.display = 'flex';
  reconnectMsg.textContent = 'Connection lost. Reconnecting…';
});

socket.on('reconnect_attempt', (n) => {
  reconnectAttempts = n;
  reconnectMsg.textContent = `Reconnecting… (attempt ${n})`;
});

socket.on('reconnect_failed', () => {
  reconnectMsg.textContent = 'Could not reconnect. Please return to the lobby.';
  backLobbyLink.classList.remove('hidden');
});

socket.on('joined', () => {
  // Joined — wait for game_state or game_started
});

socket.on('room_update', ({ players }) => {
  const opponent = players.find(p => p.color === opponentColor);
  if (opponent) opponentNameEl.textContent = opponent.name;
});

socket.on('game_started', (state) => {
  applyGameState(state);
});

socket.on('game_state', (state) => {
  applyGameState(state);
});

socket.on('invalid_move', ({ reason }) => {
  flashStatus(`Invalid move: ${reason}`, 2000);
});

socket.on('undo_requested', ({ from }) => {
  undoMsg.textContent = `${from} wants to undo the last move.`;
  undoOverlay.classList.remove('hidden');
});

socket.on('undo_declined', () => {
  flashStatus('Undo declined by opponent.', 2500);
});

socket.on('game_over', ({ winner, reason }) => {
  showGameOver(winner, reason);
});

socket.on('player_disconnected', ({ playerName }) => {
  flashStatus(`${playerName} disconnected. Waiting for reconnection…`, 0);
});

// ── Game state ────────────────────────────────────────────────────────
function applyGameState(state) {
  gameActive = !state.isGameOver;
  currentBoard = parseFenBoard(state.fen);
  myTurn = (state.turn === 'w' && myColor === 'red') ||
           (state.turn === 'b' && myColor === 'black');

  const lastMove = state.lastMove
    ? { from: state.lastMove.from, to: state.lastMove.to }
    : null;
  xiBoard.updateBoard(currentBoard, lastMove);

  // Panels
  const redActive = state.turn === 'w';
  document.getElementById('opponentPanel').classList.toggle('panel-active',
    opponentColor === (redActive ? 'red' : 'black'));
  document.getElementById('myPanel').classList.toggle('panel-active',
    myColor === (redActive ? 'red' : 'black'));

  // Status bar
  statusBar.classList.remove('check', 'game-over');
  if (state.isGameOver) {
    statusBar.classList.add('game-over');
    showGameOver(state.winner, 'Checkmate');
  } else if (state.inCheck) {
    statusBar.classList.add('check');
    statusBar.textContent = myTurn ? '⚠️ You are in CHECK!' : '⚠️ Opponent is in CHECK!';
  } else {
    statusBar.textContent = myTurn ? 'Your turn' : "Opponent's turn";
  }

  // Undo button — only enabled when it's your turn (request undo from opponent)
  undoBtn.disabled = !gameActive || !myTurn;

  if (state.players) {
    const opp = state.players.find(p => p.color === opponentColor);
    if (opp) opponentNameEl.textContent = opp.name;
  }
}

function parseFenBoard(fen) {
  const [boardStr] = fen.split(' ');
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
  return board;
}

function showGameOver(winner, reason) {
  gameActive = false;
  gameOverOverlay.classList.remove('hidden');

  if (winner === myColor) {
    gameOverTitle.textContent = 'You Win!';
    gameOverMsg.textContent = reason || 'Congratulations!';
  } else if (winner) {
    gameOverTitle.textContent = 'You Lose';
    gameOverMsg.textContent = reason || 'Better luck next time!';
  } else {
    gameOverTitle.textContent = 'Game Over';
    gameOverMsg.textContent = reason || '';
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

resignBtn.addEventListener('click', () => {
  resignOverlay.classList.remove('hidden');
});
confirmResignBtn.addEventListener('click', () => {
  resignOverlay.classList.add('hidden');
  socket.emit('resign');
});
cancelResignBtn.addEventListener('click', () => {
  resignOverlay.classList.add('hidden');
});

acceptUndoBtn.addEventListener('click', () => {
  undoOverlay.classList.add('hidden');
  socket.emit('approve_undo');
});
declineUndoBtn.addEventListener('click', () => {
  undoOverlay.classList.add('hidden');
  socket.emit('decline_undo');
});

backLobbyBtn.addEventListener('click', () => {
  window.location.href = '/';
});

// ── Window resize ─────────────────────────────────────────────────────
window.addEventListener('resize', () => xiBoard.resize());
