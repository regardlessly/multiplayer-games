'use strict';

// ── URL params ───────────────────────────────────────────────────────────────
const params  = new URLSearchParams(location.search);
const roomId  = params.get('room');
const myColor = params.get('color');
const myName  = decodeURIComponent(params.get('name') || '');

if (!roomId || !myColor) location.href = '/';

// ── Constants ────────────────────────────────────────────────────────────────
const BOGGLE_COLORS = ['red', 'blue', 'green', 'purple'];
const COLOR_NAMES   = { red: 'Red', blue: 'Blue', green: 'Green', purple: 'Purple' };
const COLOR_HEX     = { red: '#c0392b', blue: '#1155cc', green: '#1a6e1a', purple: '#7d3c98' };
const mySeat = BOGGLE_COLORS.indexOf(myColor);
const isHost = myColor === 'red';

// ── State ────────────────────────────────────────────────────────────────────
let gameState  = null;
let gameActive = false;
let timerInterval = null;
let serverTimeLeft = 0;
let localDeadline  = 0; // Date.now() + timeLeft*1000 at last sync
const foundWords   = []; // { word, score } confirmed by server

// ── DOM refs ─────────────────────────────────────────────────────────────────
const statusBar       = document.getElementById('statusBar');
const waitingOverlay  = document.getElementById('waitingOverlay');
const waitingMsg      = document.getElementById('waitingMsg');
const gameUI          = document.getElementById('gameUI');
const boggleBoard     = document.getElementById('boggleBoard');
const bogglePlayers   = document.getElementById('bogglePlayers');
const boggleTimer     = document.getElementById('boggleTimer');
const wordInput       = document.getElementById('wordInput');
const submitWordBtn   = document.getElementById('submitWordBtn');
const boggleFeedback  = document.getElementById('boggleFeedback');
const boggleFound     = document.getElementById('boggleFound');
const endRoundWrap    = document.getElementById('endRoundWrap');
const endRoundBtn     = document.getElementById('endRoundBtn');
const resultsOverlay  = document.getElementById('resultsOverlay');
const resultsTitle    = document.getElementById('resultsTitle');
const resultsBody     = document.getElementById('resultsBody');
const reconnectOverlay = document.getElementById('reconnectOverlay');

// ── Socket ───────────────────────────────────────────────────────────────────
const socket = io({ reconnectionAttempts: 5, reconnectionDelay: 1000, transports: ['websocket', 'polling'] });

socket.on('connect', () => {
  reconnectOverlay.classList.add('hidden');
  socket.emit('join_game', { roomId, playerName: myName, reconnect: true, gameType: 'boggle' });
});
socket.on('disconnect', () => reconnectOverlay.classList.remove('hidden'));

socket.on('joined', ({ color }) => {
  statusBar.textContent = `You are ${COLOR_NAMES[color] || color}`;
});

socket.on('room_update', ({ players }) => {
  if (!gameActive) {
    waitingMsg.textContent = `Waiting for game to start… (${players.filter(p => p.connected).length} connected)`;
  }
});

socket.on('game_started', (state) => applyState(state));
socket.on('game_state',   (state) => applyState(state));

socket.on('boggle_counts', ({ submissionCounts }) => {
  // Update word counts in player chips without full re-render
  if (!gameState) return;
  gameState.submissionCounts = submissionCounts;
  renderPlayers(gameState.players, submissionCounts, gameState.scores);
});

socket.on('boggle_accept', ({ word }) => {
  const pts = scoreWord(word);
  foundWords.push({ word, score: pts });
  renderFoundWords();
  flashFeedback(`✓ ${word} (+${pts})`, 'success');
  wordInput.value = '';
});

socket.on('boggle_reject', ({ word, reason }) => {
  flashFeedback(`✗ ${word} — ${reason}`, 'error');
  wordInput.select();
});

socket.on('error', ({ message }) => {
  flashFeedback(message, 'error');
});

socket.on('game_over', ({ winner, reason }) => {
  gameActive = false;
  stopTimer();
  // Results will come via game_state; show overlay after brief delay
  setTimeout(() => showResults(reason), 400);
});

socket.on('connect_error', () => reconnectOverlay.classList.remove('hidden'));

// ── Actions ───────────────────────────────────────────────────────────────────
function submitWord() {
  const w = wordInput.value.trim().toUpperCase();
  if (!w) return;
  socket.emit('boggle_submit', { word: w });
}

submitWordBtn.addEventListener('click', submitWord);
wordInput.addEventListener('keydown', e => { if (e.key === 'Enter') submitWord(); });

endRoundBtn.addEventListener('click', () => {
  endRoundBtn.disabled = true;
  socket.emit('boggle_end');
});

// ── State application ─────────────────────────────────────────────────────────
function applyState(state) {
  if (!state || state.gameType !== 'boggle') return;
  gameState = state;

  waitingOverlay.classList.add('hidden');
  gameUI.classList.remove('hidden');

  if (state.isGameOver) {
    gameActive = false;
    stopTimer();
    showResults();
    return;
  }

  gameActive = true;

  // Sync timer from server
  serverTimeLeft = state.timeLeft;
  localDeadline  = Date.now() + serverTimeLeft * 1000;
  startTimer();

  renderBoard(state.board);
  renderPlayers(state.players, state.submissionCounts, state.scores);

  wordInput.disabled = false;
  submitWordBtn.disabled = false;
  wordInput.focus();

  if (isHost) endRoundWrap.classList.remove('hidden');
}

// ── Board ─────────────────────────────────────────────────────────────────────
function renderBoard(board) {
  boggleBoard.innerHTML = '';
  board.forEach((letter, i) => {
    const tile = document.createElement('div');
    tile.className = 'boggle-tile';
    tile.textContent = letter === 'Q' ? 'Qu' : letter;
    tile.addEventListener('click', () => {
      wordInput.value += (letter === 'Q' ? 'QU' : letter);
      wordInput.focus();
    });
    boggleBoard.appendChild(tile);
  });
}

// ── Players ───────────────────────────────────────────────────────────────────
function renderPlayers(players, counts, scores) {
  bogglePlayers.innerHTML = '';
  (players || []).forEach((p, i) => {
    const chip = document.createElement('div');
    chip.className = `boggle-player-chip${p.color === myColor ? ' boggle-me' : ''}${!p.connected ? ' disconnected' : ''}`;
    chip.style.borderColor = COLOR_HEX[p.color] || '#ccc';
    const wordCount = (counts && counts[i]) || 0;
    const score = (scores && scores[i]) != null ? scores[i] : '';
    chip.innerHTML = `
      <span class="boggle-chip-dot" style="background:${COLOR_HEX[p.color]}"></span>
      <span class="boggle-chip-name">${escHtml(p.name)}</span>
      <span class="boggle-chip-count">${score !== '' ? score + 'pt' : wordCount + ' words'}</span>
    `;
    bogglePlayers.appendChild(chip);
  });
}

// ── Found words ───────────────────────────────────────────────────────────────
function renderFoundWords() {
  boggleFound.innerHTML = '';
  const sorted = foundWords.slice().sort((a, b) => b.score - a.score || a.word.localeCompare(b.word));
  sorted.forEach(({ word, score }) => {
    const chip = document.createElement('span');
    chip.className = 'boggle-word-chip';
    chip.textContent = `${word} +${score}`;
    boggleFound.appendChild(chip);
  });
}

// ── Results ───────────────────────────────────────────────────────────────────
function showResults(reason) {
  if (!gameState || !gameState.scores) return;
  stopTimer();
  wordInput.disabled = true;
  submitWordBtn.disabled = true;
  endRoundWrap.classList.add('hidden');

  const scores  = gameState.scores;
  const words   = gameState.words;
  const players = gameState.players;

  const best = Math.max(...scores);
  const winnerIdx = scores.indexOf(best);
  const winnerName = players[winnerIdx]?.name || '?';

  resultsTitle.textContent = `🎉 ${winnerName} wins!`;

  let html = '';
  if (reason) html += `<p class="boggle-result-reason">${escHtml(reason)}</p>`;

  players.forEach((p, i) => {
    const isWinner = scores[i] === best;
    html += `<div class="boggle-result-player${isWinner ? ' boggle-result-winner' : ''}">
      <span class="boggle-result-name" style="color:${COLOR_HEX[p.color]}">${escHtml(p.name)}</span>
      <span class="boggle-result-score">${scores[i]} pt${scores[i] !== 1 ? 's' : ''}</span>
    </div>`;
    if (words && words[i] && words[i].length) {
      html += `<div class="boggle-result-words">`;
      words[i].forEach(({ word, score, unique }) => {
        html += `<span class="boggle-result-word${unique ? '' : ' cancelled'}" title="${unique ? `+${score}` : 'cancelled (duplicate)'}">
          ${escHtml(word)}${unique ? ` <small>+${score}</small>` : ' <small>✗</small>'}
        </span>`;
      });
      html += `</div>`;
    }
  });

  resultsBody.innerHTML = html;
  resultsOverlay.classList.remove('hidden');
}

// ── Timer ─────────────────────────────────────────────────────────────────────
function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(tickTimer, 500);
  tickTimer();
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function tickTimer() {
  const remaining = Math.max(0, Math.ceil((localDeadline - Date.now()) / 1000));
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  boggleTimer.textContent = `${m}:${s.toString().padStart(2, '0')}`;
  boggleTimer.classList.toggle('boggle-timer-urgent', remaining <= 30);
  if (remaining === 0) stopTimer();
}

// ── Scoring (mirrors server) ──────────────────────────────────────────────────
function scoreWord(word) {
  const len = word.length;
  if (len < 3) return 0;
  if (len <= 4) return 1;
  if (len === 5) return 2;
  if (len === 6) return 3;
  if (len === 7) return 5;
  return 11;
}

// ── Feedback flash ────────────────────────────────────────────────────────────
let feedbackTimer = null;
function flashFeedback(msg, type) {
  boggleFeedback.textContent = msg;
  boggleFeedback.className = `boggle-feedback boggle-feedback-${type}`;
  if (feedbackTimer) clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => {
    boggleFeedback.textContent = '';
    boggleFeedback.className = 'boggle-feedback';
  }, 2500);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
