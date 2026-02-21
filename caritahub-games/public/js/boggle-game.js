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
let gameState    = null;
let board        = [];   // flat 16-element letter array
let gameActive   = false;
let timerInterval = null;
let localDeadline = 0;
const foundWords  = []; // { word, score } confirmed by server

// ── Tile selection state (drag mode) ─────────────────────────────────────────
let selecting      = false;  // mouse/touch is held down
let selectedPath   = [];     // ordered list of tile indices in current selection
const tileEls      = [];     // tile DOM elements (filled in renderBoard)

// ── DOM refs ─────────────────────────────────────────────────────────────────
const statusBar        = document.getElementById('statusBar');
const waitingOverlay   = document.getElementById('waitingOverlay');
const waitingMsg       = document.getElementById('waitingMsg');
const gameUI           = document.getElementById('gameUI');
const boggleBoardEl    = document.getElementById('boggleBoard');
const bogglePlayers    = document.getElementById('bogglePlayers');
const boggleTimer      = document.getElementById('boggleTimer');
const wordInput        = document.getElementById('wordInput');
const submitWordBtn    = document.getElementById('submitWordBtn');
const boggleFeedback   = document.getElementById('boggleFeedback');
const boggleFound      = document.getElementById('boggleFound');
const clearWordBtn     = document.getElementById('clearWordBtn');
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
  flashFeedback(`✓ ${word} (+${pts}pt)`, 'success');
  clearSelection();
  wordInput.value = '';
});

socket.on('boggle_reject', ({ word, reason }) => {
  flashFeedback(`✗ ${word} — ${reason}`, 'error');
  // Keep selection so player can see what was wrong; shake tiles
  shakeTiles(selectedPath);
});

socket.on('error', ({ message }) => flashFeedback(message, 'error'));

socket.on('game_over', ({ winner, reason }) => {
  gameActive = false;
  stopTimer();
  setTimeout(() => showResults(reason), 400);
});

socket.on('connect_error', () => reconnectOverlay.classList.remove('hidden'));

// ── Submit ───────────────────────────────────────────────────────────────────
function submitWord() {
  const w = currentWord();
  if (w.length < 3) { flashFeedback('Word must be at least 3 letters', 'error'); return; }
  socket.emit('boggle_submit', { word: w });
}

function currentWord() {
  // Priority: drag selection; fall back to typed input
  if (selectedPath.length > 0) return pathToWord(selectedPath);
  return wordInput.value.trim().toUpperCase();
}

submitWordBtn.addEventListener('click', submitWord);
wordInput.addEventListener('keydown', e => { if (e.key === 'Enter') submitWord(); });
clearWordBtn.addEventListener('click', () => { clearSelection(); wordInput.value = ''; wordInput.focus(); });

endRoundBtn.addEventListener('click', () => { endRoundBtn.disabled = true; socket.emit('boggle_end'); });

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

  wordInput.disabled = false;
  submitWordBtn.disabled = false;
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

    // ── Mouse events ──────────────────────────────────────────────────
    tile.addEventListener('mousedown', e => {
      e.preventDefault();
      startSelect(i);
    });
    tile.addEventListener('mouseenter', () => {
      if (selecting) extendSelect(i);
    });

    // ── Touch events (mobile) ─────────────────────────────────────────
    tile.addEventListener('touchstart', e => {
      e.preventDefault();
      startSelect(i);
    }, { passive: false });

    boggleBoardEl.appendChild(tile);
    tileEls.push(tile);
  });

  // End selection on mouseup anywhere
  document.addEventListener('mouseup', endSelect, { once: false });
  // Touch end
  boggleBoardEl.addEventListener('touchend', e => {
    e.preventDefault();
    endSelect();
  }, { passive: false });

  // Touch move: find tile under finger
  boggleBoardEl.addEventListener('touchmove', e => {
    e.preventDefault();
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    if (el && el.classList.contains('boggle-tile')) {
      extendSelect(parseInt(el.dataset.idx, 10));
    }
  }, { passive: false });
}

// ── Selection logic ───────────────────────────────────────────────────────────
function startSelect(idx) {
  if (!gameActive) return;
  clearSelection();
  selecting = true;
  selectedPath = [idx];
  updateTileVisuals();
  syncInputFromPath();
}

function extendSelect(idx) {
  if (!selecting || !gameActive) return;
  if (selectedPath.includes(idx)) return; // no revisiting
  const last = selectedPath[selectedPath.length - 1];
  if (!adjacent(last, idx)) return;       // must be adjacent
  selectedPath.push(idx);
  updateTileVisuals();
  syncInputFromPath();
}

function endSelect() {
  if (!selecting) return;
  selecting = false;
  // Don't auto-submit — let user confirm with button or Enter
}

function clearSelection() {
  selecting = false;
  selectedPath = [];
  updateTileVisuals();
  syncInputFromPath();
}

function pathToWord(path) {
  return path.map(i => board[i] === 'Q' ? 'QU' : board[i]).join('');
}

function syncInputFromPath() {
  if (selectedPath.length > 0) {
    wordInput.value = pathToWord(selectedPath);
  }
  // If no selection, leave input as-is (typed mode)
  validateInputPath();
}

// ── Tile visuals ──────────────────────────────────────────────────────────────
function updateTileVisuals() {
  tileEls.forEach((tile, i) => {
    const inPath     = selectedPath.includes(i);
    const pathPos    = selectedPath.indexOf(i);
    const isLast     = pathPos === selectedPath.length - 1 && selectedPath.length > 0;
    const canExtend  = selecting && !inPath && selectedPath.length > 0 &&
                       adjacent(selectedPath[selectedPath.length - 1], i);

    tile.classList.toggle('boggle-tile-selected', inPath && !isLast);
    tile.classList.toggle('boggle-tile-last',     isLast);
    tile.classList.toggle('boggle-tile-adjacent', canExtend);
    tile.classList.toggle('boggle-tile-used',     inPath);

    // Show position number inside selected tiles
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
// Client-side DFS mirroring the server engine — finds path for typed word
function adjacent(i, j) {
  const r1 = Math.floor(i / 4), c1 = i % 4;
  const r2 = Math.floor(j / 4), c2 = j % 4;
  return Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1 && i !== j;
}

function findPath(word) {
  // Returns ordered array of tile indices, or null if not formable
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
  // Try each start tile
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
  validateTimer = setTimeout(_doValidate, 80); // slight debounce
}

function _doValidate() {
  if (!board.length) return;
  const w = wordInput.value.trim().toUpperCase();

  // If we have a drag selection, don't interfere with it
  if (selectedPath.length > 0) {
    tileEls.forEach(t => {
      t.classList.remove('boggle-tile-typed');
      t.classList.remove('boggle-tile-invalid');
    });
    return;
  }

  // Clear typed highlights
  tileEls.forEach(t => {
    t.classList.remove('boggle-tile-typed', 'boggle-tile-last', 'boggle-tile-invalid');
  });

  if (!w) return;

  const path = findPath(w);
  if (path) {
    path.forEach((idx, pos) => {
      tileEls[idx].classList.add(pos === path.length - 1 ? 'boggle-tile-last' : 'boggle-tile-typed');
    });
    wordInput.classList.remove('boggle-input-invalid');
  } else {
    wordInput.classList.add('boggle-input-invalid');
    // Flash tiles to show word can't be formed
    tileEls.forEach(t => t.classList.add('boggle-tile-invalid'));
    setTimeout(() => tileEls.forEach(t => t.classList.remove('boggle-tile-invalid')), 300);
  }
}

// Wire typed validation
wordInput.addEventListener('input', () => {
  // Typing clears drag selection
  if (selectedPath.length > 0) clearSelection();
  validateInputPath();
});

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
  }, 2500);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
