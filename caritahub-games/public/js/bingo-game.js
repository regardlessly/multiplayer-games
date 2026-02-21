'use strict';

// ── URL params ───────────────────────────────────────────────────────────────
const params   = new URLSearchParams(location.search);
const roomId   = params.get('room');
const myColor  = params.get('color');
const myName   = decodeURIComponent(params.get('name') || '');
const gameType = params.get('game') || 'bingo';

if (!roomId || !myColor) {
  location.href = '/';
}

// ── Constants ────────────────────────────────────────────────────────────────
const COLS        = ['B', 'I', 'N', 'G', 'O'];
const FREE_ROW    = 2;
const FREE_COL    = 2;
const CARD_SIZE   = 5;

const BINGO_COLORS = ['caller', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
const COLOR_NAMES  = {
  caller: 'Caller', p2: 'Player 2', p3: 'Player 3', p4: 'Player 4',
  p5: 'Player 5', p6: 'Player 6', p7: 'Player 7', p8: 'Player 8'
};
const COLOR_HEX = {
  caller: '#1155cc', p2: '#c0392b', p3: '#1a6e1a', p4: '#7d3c98',
  p5: '#b7600a',     p6: '#0a7d7d', p7: '#8b6914', p8: '#555'
};

const mySeat = BINGO_COLORS.indexOf(myColor);
const isCaller = myColor === 'caller';

// ── State ────────────────────────────────────────────────────────────────────
let gameState  = null;
let gameActive = false;

// ── DOM refs ─────────────────────────────────────────────────────────────────
const statusBar        = document.getElementById('statusBar');
const waitingOverlay   = document.getElementById('waitingOverlay');
const waitingMsg       = document.getElementById('waitingMsg');
const gameUI           = document.getElementById('gameUI');
const gameOverOverlay  = document.getElementById('gameOverOverlay');
const gameOverTitle    = document.getElementById('gameOverTitle');
const gameOverMsg      = document.getElementById('gameOverMsg');
const reconnectOverlay = document.getElementById('reconnectOverlay');
const callerPanel      = document.getElementById('callerPanel');
const callBtn          = document.getElementById('callBtn');
const lastCalledEl     = document.getElementById('lastCalled');
const calledBallsEl    = document.getElementById('calledBalls');
const bingoPlayersEl   = document.getElementById('bingoPlayers');
const myCardEl         = document.getElementById('myBingoCard');

// ── Socket ───────────────────────────────────────────────────────────────────
const socket = io({ reconnectionAttempts: 5, reconnectionDelay: 1000, transports: ['websocket', 'polling'] });

socket.on('connect', () => {
  reconnectOverlay.classList.add('hidden');
  socket.emit('join_game', { roomId, playerName: myName, reconnect: true, gameType: 'bingo' });
});

socket.on('disconnect', () => {
  reconnectOverlay.classList.remove('hidden');
});

socket.on('joined', ({ color, reconnected }) => {
  const label = COLOR_NAMES[color] || color;
  statusBar.textContent = isCaller
    ? 'You are the Caller — draw numbers for all players'
    : `You are ${label}`;
});

socket.on('room_update', ({ players }) => {
  if (!gameActive) {
    waitingMsg.textContent = `Waiting for game to start… (${players.filter(p => p.connected).length} connected)`;
  }
});

socket.on('game_started', (state) => {
  applyState(state);
});

socket.on('game_state', (state) => {
  applyState(state);
});

socket.on('game_over', ({ winner, reason }) => {
  gameActive = false;
  gameOverTitle.textContent = '🎉 BINGO!';
  gameOverMsg.textContent   = reason || `Winner: ${winner}`;
  gameOverOverlay.classList.remove('hidden');
  callBtn.disabled = true;
});

socket.on('player_disconnected', ({ playerName }) => {
  statusBar.textContent = `${playerName} disconnected…`;
});

socket.on('error', ({ message }) => {
  statusBar.textContent = message;
  callBtn.disabled = false;
});

socket.on('connect_error', () => {
  reconnectOverlay.classList.remove('hidden');
});

// ── Caller button ─────────────────────────────────────────────────────────────
callBtn.addEventListener('click', () => {
  callBtn.disabled = true;
  socket.emit('bingo_call');
});

// ── State application ─────────────────────────────────────────────────────────
function applyState(state) {
  if (!state || state.gameType !== 'bingo') return;
  gameState  = state;
  gameActive = !state.isGameOver;

  waitingOverlay.classList.add('hidden');
  gameUI.classList.remove('hidden');

  // Caller controls
  if (isCaller && gameActive) {
    callerPanel.classList.remove('hidden');
    callBtn.disabled = false;
  }

  // Last called number
  if (state.lastCalled) {
    const col = COLS[Math.floor((state.lastCalled - 1) / 15)];
    lastCalledEl.textContent = `${col}${state.lastCalled}`;
  }

  // Called balls strip
  renderCalledBalls(state.called);

  // Players row
  renderPlayers(state.players, state.winners);

  // My bingo card
  if (mySeat >= 0 && mySeat < state.cards.length) {
    renderCard(myCardEl, state.cards[mySeat], state.marked[mySeat], state.winners);
  }

  if (state.isGameOver) {
    callBtn.disabled = true;
  }
}

// ── Renderers ─────────────────────────────────────────────────────────────────
function renderCalledBalls(called) {
  calledBallsEl.innerHTML = '';
  // Show last 20 in reverse so newest is first
  const recent = called.slice().reverse().slice(0, 30);
  recent.forEach(n => {
    const col  = Math.floor((n - 1) / 15);
    const letter = COLS[col];
    const ball = document.createElement('div');
    ball.className = 'bingo-ball';
    ball.style.background = COLOR_HEX[BINGO_COLORS[col]] || '#1155cc';
    ball.textContent = `${letter}${n}`;
    calledBallsEl.appendChild(ball);
  });
}

function renderPlayers(players, winners) {
  bingoPlayersEl.innerHTML = '';
  (players || []).forEach(p => {
    const isWinner = (winners || []).some(w => w.seat === p.seat);
    const div = document.createElement('div');
    div.className = `bingo-player-chip${isWinner ? ' bingo-winner' : ''}${!p.connected ? ' disconnected' : ''}`;
    div.style.borderColor = COLOR_HEX[p.color] || '#ccc';
    div.innerHTML = `
      <span class="bingo-chip-dot" style="background:${COLOR_HEX[p.color] || '#ccc'}"></span>
      <span class="bingo-chip-name">${escHtml(p.name)}</span>
      ${isWinner ? '<span class="bingo-chip-badge">BINGO!</span>' : ''}
      ${p.color === 'caller' ? '<span class="bingo-chip-role">Caller</span>' : ''}
    `;
    bingoPlayersEl.appendChild(div);
  });
}

function renderCard(container, card, markedGrid, winners) {
  container.innerHTML = '';

  // Header row
  const headerRow = document.createElement('div');
  headerRow.className = 'bingo-row bingo-header-row';
  COLS.forEach((letter, ci) => {
    const cell = document.createElement('div');
    cell.className = 'bingo-cell bingo-header-cell';
    cell.style.background = COLOR_HEX[BINGO_COLORS[ci]] || '#1155cc';
    cell.textContent = letter;
    headerRow.appendChild(cell);
  });
  container.appendChild(headerRow);

  // Number rows
  for (let r = 0; r < CARD_SIZE; r++) {
    const row = document.createElement('div');
    row.className = 'bingo-row';
    for (let c = 0; c < CARD_SIZE; c++) {
      const cell = document.createElement('div');
      const isFree = r === FREE_ROW && c === FREE_COL;
      const isMarked = markedGrid[r][c];

      cell.className = `bingo-cell${isMarked ? ' bingo-marked' : ''}${isFree ? ' bingo-free' : ''}`;
      cell.textContent = isFree ? 'FREE' : card[r][c];
      row.appendChild(cell);
    }
    container.appendChild(row);
  }
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
