'use strict';

const socket = io();
let myRoomId = null;
let myColor = null;
let myName = '';   // captured at join-click time

const nameInput = document.getElementById('playerName');
const createBtn = document.getElementById('createBtn');
const statusMsg = document.getElementById('statusMsg');
const qrPanel = document.getElementById('qrPanel');
const qrContainer = document.getElementById('qrcode');
const joinLinkEl = document.getElementById('joinLink');
const playerListEl = document.getElementById('playerList');
const startBtn = document.getElementById('startBtn');

// ── Game metadata ────────────────────────────────────────────────────
const GAMES = {
  xiangqi: {
    title: 'CaritaHub 象棋',
    subtitle: 'Chinese Chess — Multiplayer',
    gamePage: '/game.html',
    maxPlayers: 2,
    hostColors: ['red']
  },
  chess: {
    title: 'CaritaHub Chess',
    subtitle: 'Western Chess — Multiplayer',
    gamePage: '/chess-game.html',
    maxPlayers: 2,
    hostColors: ['white']
  },
  chordaidi: {
    title: '大老二 Chor Dai Di',
    subtitle: 'Big Two — 4 Players',
    gamePage: '/chordaidi-game.html',
    maxPlayers: 4,
    hostColors: ['south']
  },
  bingo: {
    title: 'CaritaHub Bingo',
    subtitle: 'Bingo — 2 to 8 Players',
    gamePage: '/bingo-game.html',
    maxPlayers: 2,      // minimum to start; caller can begin with 2+
    hostColors: ['caller']
  }
};

const params = new URLSearchParams(window.location.search);
const gameId = params.get('game') || 'xiangqi';
const inviteRoom = params.get('room');

const gameMeta = GAMES[gameId] || GAMES['xiangqi'];

// Set page heading
const titleEl = document.getElementById('gameTitle');
const subtitleEl = document.getElementById('gameSubtitle');
if (titleEl) titleEl.textContent = gameMeta.title;
if (subtitleEl) subtitleEl.textContent = gameMeta.subtitle;
document.title = `CaritaHub — ${gameMeta.title}`;

if (inviteRoom) {
  statusMsg.textContent = 'Enter your name to join the game.';
  createBtn.textContent = 'Join Game';
}

// ── Handlers ─────────────────────────────────────────────────────────
createBtn.addEventListener('click', () => {
  const name = nameInput.value.trim();
  if (!name) {
    statusMsg.textContent = 'Please enter your name first.';
    statusMsg.classList.add('error');
    return;
  }
  myName = name;
  statusMsg.classList.remove('error');
  statusMsg.textContent = 'Connecting…';
  createBtn.disabled = true;

  socket.emit('join_game', {
    roomId: inviteRoom || null,
    playerName: name,
    gameType: gameId
  });
});

nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') createBtn.click(); });

startBtn.addEventListener('click', () => {
  socket.emit('start_game');
  startBtn.disabled = true;
  statusMsg.textContent = 'Starting game…';
});

// ── Server events ────────────────────────────────────────────────────
socket.on('joined', ({ roomId, color }) => {
  myRoomId = roomId;
  myColor = color;

  if (color === 'spectator') {
    statusMsg.textContent = 'You joined as a spectator.';
    createBtn.classList.add('hidden');
    return;
  }

  const colorLabel = colorDisplayName(color);
  statusMsg.textContent = `You are the ${colorLabel} player.`;
  createBtn.classList.add('hidden');
  qrPanel.classList.remove('hidden');

  if (!inviteRoom) {
    // QR encodes /join?room=...&game=... so the joining player lands on the right lobby
    const joinUrl = `${location.origin}/join?room=${roomId}&game=${gameId}`;
    joinLinkEl.textContent = joinUrl;

    qrContainer.innerHTML = '';
    new QRCode(qrContainer, {
      text: joinUrl,
      width: 260,
      height: 260,
      correctLevel: QRCode.CorrectLevel.H
    });
  }
});

socket.on('room_update', ({ players }) => {
  renderPlayerList(players);

  const connectedCount = players.filter(p => p.connected).length;
  const allReady = connectedCount >= gameMeta.maxPlayers;
  const isHost = gameMeta.hostColors.includes(myColor);

  if (isHost && allReady) {
    startBtn.classList.remove('hidden');
    const needed = gameMeta.maxPlayers;
    statusMsg.textContent = `All ${needed} players connected! You can start the game.`;
  } else if (isHost) {
    startBtn.classList.add('hidden');
    const waiting = gameMeta.maxPlayers - connectedCount;
    statusMsg.textContent = `Waiting for ${waiting} more player${waiting > 1 ? 's' : ''}…`;
  }
});

socket.on('game_started', () => {
  window.location.href = `${gameMeta.gamePage}?room=${myRoomId}&color=${myColor}&name=${encodeURIComponent(myName)}&game=${gameId}`;
});

socket.on('error', ({ message }) => {
  statusMsg.textContent = message;
  statusMsg.classList.add('error');
  createBtn.disabled = false;
  startBtn.disabled = false;
});

socket.on('connect_error', () => {
  statusMsg.textContent = 'Connection failed. Please refresh.';
  statusMsg.classList.add('error');
});

// ── Helpers ──────────────────────────────────────────────────────────
function colorDisplayName(color) {
  const map = {
    red: 'Red', white: 'White', black: 'Black',
    south: 'South', west: 'West', north: 'North', east: 'East',
    caller: 'Caller', p2: 'Player 2', p3: 'Player 3', p4: 'Player 4',
    p5: 'Player 5', p6: 'Player 6', p7: 'Player 7', p8: 'Player 8'
  };
  return map[color] || color;
}

function renderPlayerList(players) {
  playerListEl.innerHTML = '';
  players.forEach(p => {
    const div = document.createElement('div');
    div.className = 'player-item';
    const dot = document.createElement('span');
    dot.className = `player-dot dot-${p.color}`;
    const label = document.createElement('span');
    label.textContent = `${p.name} (${colorDisplayName(p.color)})${p.connected ? '' : ' — disconnected'}`;
    div.appendChild(dot);
    div.appendChild(label);
    playerListEl.appendChild(div);
  });
}
