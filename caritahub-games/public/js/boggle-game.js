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
let gameState     = null;
let board         = [];   // flat 16-element letter array
let gameActive    = false;
let timerInterval = null;
let localDeadline = 0;
const foundWords  = []; // { word, score } confirmed by server

// ── Tile selection state (drag mode) ─────────────────────────────────────────
let selecting    = false;
let selectedPath = [];
const tileEls    = [];

// ── DOM refs ─────────────────────────────────────────────────────────────────
const statusBar        = document.getElementById('statusBar');
const waitingOverlay   = document.getElementById('waitingOverlay');
const waitingMsg       = document.getElementById('waitingMsg');
const gameUI           = document.getElementById('gameUI');
const boggleBoardEl    = document.getElementById('boggleBoard');
const bogglePlayers    = document.getElementById('bogglePlayers');
const boggleTimer      = document.getElementById('boggleTimer');
const wordDisplay      = document.getElementById('boggleWordDisplay');
const wordInput        = document.getElementById('wordInput');
const submitWordBtn    = document.getElementById('submitWordBtn');
const clearWordBtn     = document.getElementById('clearWordBtn');
const boggleFeedback   = document.getElementById('boggleFeedback');
const boggleFound      = document.getElementById('boggleFound');
const boggleFoundScore = document.getElementById('boggleFoundScore');
const endRoundWrap     = document.getElementById('endRoundWrap');
const endRoundBtn      = document.getElementById('endRoundBtn');
const resultsOverlay   = document.getElementById('resultsOverlay');
const resultsTitle     = document.getElementById('resultsTitle');
const resultsBody      = document.getElementById('resultsBody');
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
  if (!gameActive)
    waitingMsg.textContent = `Waiting for game to start… (${players.filter(p => p.connected).length} connected)`;
});

socket.on('game_started', applyState);
socket.on('game_state',   applyState);

socket.on('boggle_counts', ({ submissionCounts }) => {
  if (!gameState) return;
  gameState.submissionCounts = submissionCounts;
  renderPlayers(gameState.players, submissionCounts, gameState.scores);
});

socket.on('boggle_accept', ({ word }) => {
  const pts = scoreWord(word);
  foundWords.push({ word, score: pts });
  renderFoundWords();
  flashFeedback(`✓ ${word}  +${pts} pt${pts !== 1 ? 's' : ''}`, 'success');
  clearSelection();
  wordInput.value = '';
  syncDisplay();
});

socket.on('boggle_reject', ({ word, reason }) => {
  flashFeedback(`✗ ${word} — ${reason}`, 'error');
  shakeTiles(selectedPath);
});

socket.on('error', ({ message }) => flashFeedback(message, 'error'));

socket.on('game_over', ({ winner, reason }) => {
  gameActive = false;
  stopTimer();
  setTimeout(() => showResults(reason), 400);
});

socket.on('connect_error', () => reconnectOverlay.classList.remove('hidden'));

// ── Word display helpers ──────────────────────────────────────────────────────
function syncDisplay() {
  const word = currentWord();
  wordDisplay.innerHTML = '';
  if (!word) {
    const ph = document.createElement('span');
    ph.className = 'boggle-word-display-placeholder';
    ph.textContent = 'Type or drag tiles…';
    wordDisplay.appendChild(ph);
    wordDisplay.classList.remove('active', 'boggle-input-invalid');
  } else {
    wordDisplay.textContent = word;
    wordDisplay.classList.add('active');
    wordDisplay.classList.remove('boggle-input-invalid');
  }
}

function markDisplayInvalid(invalid) {
  if (invalid) {
    wordDisplay.classList.add('boggle-input-invalid');
    wordDisplay.classList.remove('active');
  } else {
    wordDisplay.classList.remove('boggle-input-invalid');
    if (currentWord()) wordDisplay.classList.add('active');
  }
}

// ── Submit ───────────────────────────────────────────────────────────────────
function submitWord() {
  const w = currentWord();
  if (w.length < 3) { flashFeedback('Word must be at least 3 letters', 'error'); return; }
  socket.emit('boggle_submit', { word: w });
}

function currentWord() {
  if (selectedPath.length > 0) return pathToWord(selectedPath);
  return wordInput.value.trim().toUpperCase();
}

submitWordBtn.addEventListener('click', submitWord);

// Tap on the word display to focus the hidden input
wordDisplay.addEventListener('click', () => wordInput.focus());

// Keyboard on hidden input
wordInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); submitWord(); }
});
wordInput.addEventListener('input', () => {
  if (selectedPath.length > 0) clearSelection();
  syncDisplay();
  validateInputPath();
});

clearWordBtn.addEventListener('click', () => {
  clearSelection();
  wordInput.value = '';
  syncDisplay();
  wordInput.focus();
});

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

  board = state.board;
  gameActive = true;

  localDeadline = Date.now() + state.timeLeft * 1000;
  startTimer();

  renderBoard(board);
  renderPlayers(state.players, state.submissionCounts, state.scores);

  submitWordBtn.disabled = false;
  syncDisplay();
  wordInput.focus();

  if (isHost) endRoundWrap.classList.remove('hidden');
}

// ── Board rendering ───────────────────────────────────────────────────────────
function renderBoard(b) {
  boggleBoardEl.innerHTML = '';
  tileEls.length = 0;

  b.forEach((letter, i) => {
    const tile = document.createElement('div');
    tile.className = 'boggle-tile';
    tile.dataset.idx = i;
    tile.textContent = letter === 'Q' ? 'Qu' : letter;

    // Mouse events
    tile.addEventListener('mousedown', e => { e.preventDefault(); startSelect(i); });
    tile.addEventListener('mouseenter', () => { if (selecting) extendSelect(i); });

    // Touch events (mobile)
    tile.addEventListener('touchstart', e => { e.preventDefault(); startSelect(i); }, { passive: false });

    boggleBoardEl.appendChild(tile);
    tileEls.push(tile);
  });

  // End selection on mouseup anywhere
  document.addEventListener('mouseup', endSelect);

  // Touch move: find tile under finger
  boggleBoardEl.addEventListener('touchmove', e => {
    e.preventDefault();
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    if (el && el.classList.contains('boggle-tile')) {
      extendSelect(parseInt(el.dataset.idx, 10));
    }
  }, { passive: false });

  boggleBoardEl.addEventListener('touchend', e => {
    e.preventDefault();
    endSelect();
  }, { passive: false });
}

// ── Selection logic ───────────────────────────────────────────────────────────
function startSelect(idx) {
  if (!gameActive) return;
  clearSelection();
  wordInput.value = '';
  selecting = true;
  selectedPath = [idx];
  updateTileVisuals();
  syncDisplay();
}

function extendSelect(idx) {
  if (!selecting || !gameActive) return;
  if (selectedPath.includes(idx)) return;
  const last = selectedPath[selectedPath.length - 1];
  if (!adjacent(last, idx)) return;
  selectedPath.push(idx);
  updateTileVisuals();
  syncDisplay();
}

function endSelect() {
  if (!selecting) return;
  selecting = false;
  // Don't auto-submit — let user press Submit or Enter
}

function clearSelection() {
  selecting = false;
  selectedPath = [];
  updateTileVisuals();
  syncDisplay();
}

function pathToWord(path) {
  return path.map(i => board[i] === 'Q' ? 'QU' : board[i]).join('');
}

// ── Tile visuals ──────────────────────────────────────────────────────────────
function updateTileVisuals() {
  tileEls.forEach((tile, i) => {
    const inPath    = selectedPath.includes(i);
    const pathPos   = selectedPath.indexOf(i);
    const isLast    = pathPos === selectedPath.length - 1 && selectedPath.length > 0;
    const canExtend = selecting && !inPath && selectedPath.length > 0 &&
                      adjacent(selectedPath[selectedPath.length - 1], i);

    tile.classList.toggle('boggle-tile-selected', inPath && !isLast);
    tile.classList.toggle('boggle-tile-last',     isLast);
    tile.classList.toggle('boggle-tile-adjacent', canExtend);
    tile.classList.toggle('boggle-tile-used',     inPath);

    if (inPath) {
      tile.dataset.pos = pathPos + 1;
    } else {
      delete tile.dataset.pos;
    }
  });
}

function shakeTiles(path) {
  path.forEach(i => {
    tileEls[i]?.classList.add('boggle-tile-shake');
    setTimeout(() => tileEls[i]?.classList.remove('boggle-tile-shake'), 500);
  });
}

// ── Typed input → highlight path on board ────────────────────────────────────
function adjacent(i, j) {
  const r1 = Math.floor(i / 4), c1 = i % 4;
  const r2 = Math.floor(j / 4), c2 = j % 4;
  return Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1 && i !== j;
}

function findPath(word) {
  function dfs(w, pos, used, path) {
    if (w.length === 0) return path;
    for (let next = 0; next < 16; next++) {
      if (used[next]) continue;
      if (path.length > 0 && !adjacent(path[path.length - 1], next)) continue;
      const tile = board[next] === 'Q' ? 'QU' : board[next];
      if (w.startsWith(tile)) {
        used[next] = true;
        const result = dfs(w.slice(tile.length), next, used, [...path, next]);
        if (result) return result;
        used[next] = false;
      }
    }
    return null;
  }
  for (let start = 0; start < 16; start++) {
    const tile = board[start] === 'Q' ? 'QU' : board[start];
    if (word.startsWith(tile)) {
      const used = new Array(16).fill(false);
      used[start] = true;
      const path = dfs(word.slice(tile.length), start, used, [start]);
      if (path) return path;
    }
  }
  return null;
}

let validateTimer = null;
function validateInputPath() {
  if (validateTimer) clearTimeout(validateTimer);
  validateTimer = setTimeout(_doValidate, 80);
}

function _doValidate() {
  if (!board.length) return;
  const w = wordInput.value.trim().toUpperCase();

  // Drag selection active — don't interfere
  if (selectedPath.length > 0) {
    tileEls.forEach(t => t.classList.remove('boggle-tile-typed', 'boggle-tile-invalid'));
    markDisplayInvalid(false);
    return;
  }

  tileEls.forEach(t => t.classList.remove('boggle-tile-typed', 'boggle-tile-last', 'boggle-tile-invalid'));

  if (!w) { markDisplayInvalid(false); return; }

  const path = findPath(w);
  if (path) {
    path.forEach((idx, pos) => {
      tileEls[idx].classList.add(pos === path.length - 1 ? 'boggle-tile-last' : 'boggle-tile-typed');
    });
    markDisplayInvalid(false);
  } else {
    markDisplayInvalid(true);
    tileEls.forEach(t => t.classList.add('boggle-tile-invalid'));
    setTimeout(() => tileEls.forEach(t => t.classList.remove('boggle-tile-invalid')), 280);
  }
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
      <span class="boggle-chip-count">${score !== '' ? score + 'pt' : wordCount + ' ✓'}</span>
    `;
    bogglePlayers.appendChild(chip);
  });
}

// ── Found words ───────────────────────────────────────────────────────────────
function renderFoundWords() {
  boggleFound.innerHTML = '';
  const sorted = foundWords.slice().sort((a, b) => b.score - a.score || a.word.localeCompare(b.word));
  const total = sorted.reduce((s, fw) => s + fw.score, 0);
  if (boggleFoundScore) boggleFoundScore.textContent = `${total} pt${total !== 1 ? 's' : ''}`;

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
  submitWordBtn.disabled = true;
  endRoundWrap.classList.add('hidden');

  const scores  = gameState.scores;
  const words   = gameState.words;
  const players = gameState.players;

  const best = Math.max(...scores);
  const winnerIdx  = scores.indexOf(best);
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
        html += `<span class="boggle-result-word${unique ? '' : ' cancelled'}" title="${unique ? `+${score}` : 'cancelled'}">
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

// ── Feedback ──────────────────────────────────────────────────────────────────
let feedbackTimer = null;
function flashFeedback(msg, type) {
  boggleFeedback.textContent = msg;
  boggleFeedback.className = `boggle-feedback boggle-feedback-${type}`;
  if (feedbackTimer) clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => {
    boggleFeedback.textContent = '';
    boggleFeedback.className = 'boggle-feedback';
  }, 2800);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
