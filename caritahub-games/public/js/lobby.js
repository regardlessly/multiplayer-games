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
    gamePage: '/game.html'
  },
  chess: {
    title: 'CaritaHub Chess',
    subtitle: 'Western Chess — Multiplayer',
    gamePage: '/chess-game.html'
  }
  // Future games: bingo, trivia, ludo …
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

  const colorLabel = color === 'red' ? 'Red' : color === 'white' ? 'White' : 'Black';
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

  const bothReady = players.filter(p => p.connected).length === 2;
  const firstColors = ['red', 'white'];
  if (firstColors.includes(myColor) && bothReady) {
    startBtn.classList.remove('hidden');
    statusMsg.textContent = 'Both players connected! You can start the game.';
  }
});

socket.on('game_started', () => {
  window.location.href = `${gameMeta.gamePage}?room=${myRoomId}&color=${myColor}&name=${encodeURIComponent(myName)}&game=${gameId}`;
});

socket.on('error', ({ message }) => {
  statusMsg.textContent = message;
  statusMsg.classList.add('error');
  createBtn.disabled = false;
});

socket.on('connect_error', () => {
  statusMsg.textContent = 'Connection failed. Please refresh.';
  statusMsg.classList.add('error');
});

function renderPlayerList(players) {
  playerListEl.innerHTML = '';
  players.forEach(p => {
    const div = document.createElement('div');
    div.className = 'player-item';
    const dot = document.createElement('span');
    dot.className = `player-dot dot-${p.color}`;
    const label = document.createElement('span');
    const pColorLabel = p.color === 'red' ? 'Red' : p.color === 'white' ? 'White' : 'Black';
    label.textContent = `${p.name} (${pColorLabel})${p.connected ? '' : ' — disconnected'}`;
    div.appendChild(dot);
    div.appendChild(label);
    playerListEl.appendChild(div);
  });
}
