'use strict';

/**
 * Chor Dai Di (大老二) — Big Two engine.
 * 4 players, standard 52-card deck (no jokers).
 * Card rank:  3 4 5 6 7 8 9 10 J Q K A 2  (3=lowest, 2=highest)
 * Suit rank:  Diamonds < Clubs < Hearts < Spades
 * Starting:   Holder of 3♦ goes first, must include 3♦ in first play.
 * Combos:     single | pair | triple | straight | flush | fullhouse | quads | straightflush
 * Turn:       play a strictly higher combo of the same TYPE, or pass.
 *             A new round starts when all others pass — table is cleared, winner plays anything.
 * Win:        first player to empty their hand.
 *
 * Interface (mirrors chess.js):
 *   createGame() → {
 *     state()        — full serialisable state (sent to clients)
 *     play(seat, cardIds)  — returns { ok, reason }
 *     pass(seat)           — returns { ok, reason }
 *     undo()               — returns false (not supported; satisfies interface)
 *     isGameOver()         — bool
 *     winner()             — seat index 0-3 or null
 *     turn()               — current seat index (0-3)
 *   }
 */

// ── Card definitions ────────────────────────────────────────────────────────

const SUITS = ['D', 'C', 'H', 'S'];          // Diamonds < Clubs < Hearts < Spades
const RANKS = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];

function makeDeck() {
  const deck = [];
  let id = 0;
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      deck.push({ id: id++, rank, suit });
    }
  }
  return deck; // 52 cards, id 0-51
}

function rankValue(rank)  { return RANKS.indexOf(rank); }   // 0=3 … 12=2
function suitValue(suit)  { return SUITS.indexOf(suit); }   // 0=D … 3=S

function cardValue(card) {
  return rankValue(card.rank) * 4 + suitValue(card.suit);   // 0-51, fully ordered
}

function cardFromId(id) {
  const rank = RANKS[Math.floor(id / 4)];
  const suit = SUITS[id % 4];
  return { id, rank, suit };
}

// ── Deal ────────────────────────────────────────────────────────────────────

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function deal() {
  const deck = shuffle(makeDeck());
  const hands = [[], [], [], []];
  deck.forEach((card, i) => hands[i % 4].push(card.id));
  // Sort each hand
  hands.forEach(h => h.sort((a, b) => a - b));
  return hands;
}

// ── Combo classification ─────────────────────────────────────────────────────

function classifyCombo(cardIds) {
  const cards = cardIds.map(cardFromId).sort((a, b) => cardValue(a) - cardValue(b));
  const n = cards.length;

  if (n === 0) return null;

  if (n === 1) return { type: 'single', cards, key: cardValue(cards[0]) };

  if (n === 2) {
    if (cards[0].rank === cards[1].rank)
      return { type: 'pair', cards, key: cardValue(cards[1]) };
    return null;
  }

  if (n === 3) {
    if (cards[0].rank === cards[1].rank && cards[1].rank === cards[2].rank)
      return { type: 'triple', cards, key: cardValue(cards[2]) };
    return null;
  }

  if (n === 5) return classifyFiveCard(cards);

  return null;
}

function classifyFiveCard(cards) {
  const ranks = cards.map(c => rankValue(c.rank));
  const suits = cards.map(c => suitValue(c.suit));
  const isFlush = suits.every(s => s === suits[0]);

  // Check straight (consecutive ranks, with wrap allowed only at A-2 which doesn't exist since 2 is top)
  const sorted = [...ranks].sort((a, b) => a - b);
  const isStraight = sorted.every((r, i) => i === 0 || r === sorted[i - 1] + 1);

  // Counts
  const countMap = {};
  ranks.forEach(r => { countMap[r] = (countMap[r] || 0) + 1; });
  const counts = Object.values(countMap).sort((a, b) => b - a);

  // highest card for ordering (last card after sort)
  const highest = cardValue(cards[cards.length - 1]);

  if (isFlush && isStraight) return { type: 'straightflush', cards, key: highest };
  if (counts[0] === 4)       return { type: 'quads',         cards, key: highest };
  if (counts[0] === 3 && counts[1] === 2)
                              return { type: 'fullhouse',     cards, key: highest };
  if (isFlush)               return { type: 'flush',         cards, key: highest };
  if (isStraight)            return { type: 'straight',      cards, key: highest };
  return null;
}

// Five-card combo rank order (for beating): straight < flush < fullhouse < quads < straightflush
const FIVE_CARD_RANK = { straight: 0, flush: 1, fullhouse: 2, quads: 3, straightflush: 4 };

function beats(incoming, table) {
  if (!incoming || !table) return false;

  // Singles, pairs, triples: must be same type, higher key
  if (['single', 'pair', 'triple'].includes(table.type)) {
    return incoming.type === table.type && incoming.key > table.key;
  }

  // Five-card combos: higher rank type wins; same type → higher key
  if (['straight','flush','fullhouse','quads','straightflush'].includes(table.type)) {
    const ir = FIVE_CARD_RANK[incoming.type];
    const tr = FIVE_CARD_RANK[table.type];
    if (ir === undefined) return false;
    if (ir !== tr) return ir > tr;
    return incoming.key > table.key;
  }

  return false;
}

// ── Game factory ─────────────────────────────────────────────────────────────

function createGame() {
  const hands = deal();

  // Find who has 3♦ (id=0)
  let startSeat = hands.findIndex(h => h.includes(0));

  let currentSeat  = startSeat;
  let passCount    = 0;
  let tableCombo   = null;     // last played combo
  let tableOwner   = null;     // seat that owns the table
  let roundFirst   = true;     // first play of the game (must include 3♦)
  let winnerSeat   = null;
  let history      = [];       // [{seat, cardIds, pass}] for undo (not implemented)

  function isGameOver() { return winnerSeat !== null; }
  function winner()     { return winnerSeat; }
  function turn()       { return currentSeat; }

  function nextSeat(s) { return (s + 1) % 4; }

  function state() {
    return {
      hands: hands.map(h => [...h]),         // full hands (server strips opponent cards before send)
      currentSeat,
      tableCombo: tableCombo ? {
        type: tableCombo.type,
        cardIds: tableCombo.cards.map(c => c.id)
      } : null,
      tableOwner,
      passCount,
      roundFirst,
      isGameOver: isGameOver(),
      winner: winnerSeat,
    };
  }

  function play(seat, cardIds) {
    if (isGameOver()) return { ok: false, reason: 'Game over' };
    if (seat !== currentSeat) return { ok: false, reason: 'Not your turn' };

    // Validate player owns these cards
    const hand = hands[seat];
    for (const id of cardIds) {
      if (!hand.includes(id)) return { ok: false, reason: 'Card not in hand' };
    }

    // Classify
    const combo = classifyCombo(cardIds);
    if (!combo) return { ok: false, reason: 'Invalid combination' };

    // First play of the game must include 3♦ (id=0)
    if (roundFirst) {
      if (!cardIds.includes(0)) return { ok: false, reason: 'First play must include 3♦' };
      roundFirst = false;
    }

    // Must beat table or table is empty (new round)
    if (tableCombo !== null && !beats(combo, tableCombo)) {
      return { ok: false, reason: 'Does not beat the table' };
    }

    // Remove cards from hand
    cardIds.forEach(id => {
      hands[seat].splice(hands[seat].indexOf(id), 1);
    });

    tableCombo  = combo;
    tableOwner  = seat;
    passCount   = 0;
    history.push({ seat, cardIds, pass: false });

    // Check win
    if (hands[seat].length === 0) {
      winnerSeat = seat;
      return { ok: true };
    }

    currentSeat = nextSeat(seat);
    return { ok: true };
  }

  function pass(seat) {
    if (isGameOver()) return { ok: false, reason: 'Game over' };
    if (seat !== currentSeat) return { ok: false, reason: 'Not your turn' };
    if (tableCombo === null)  return { ok: false, reason: 'Cannot pass on an empty table' };
    if (tableOwner === seat)  return { ok: false, reason: 'You own the table — play or wait' };

    history.push({ seat, pass: true });
    passCount++;
    currentSeat = nextSeat(seat);

    // If 3 consecutive passes, the table owner starts a new round
    if (passCount === 3) {
      tableCombo  = null;
      tableOwner  = null;
      passCount   = 0;
      currentSeat = tableOwner !== null ? tableOwner : currentSeat;
      // After clearing we already advanced; set to tableOwner
      // (tableOwner was nulled above — capture before)
    }

    return { ok: true };
  }

  // Recalculate pass-clearing (fix the ordering issue above)
  function passFixed(seat) {
    if (isGameOver()) return { ok: false, reason: 'Game over' };
    if (seat !== currentSeat) return { ok: false, reason: 'Not your turn' };
    if (tableCombo === null)  return { ok: false, reason: 'Cannot pass on an empty table' };

    const owner = tableOwner;
    history.push({ seat, pass: true });
    passCount++;
    currentSeat = nextSeat(seat);

    if (passCount === 3) {
      // All others passed — owner gets a free turn
      tableCombo  = null;
      passCount   = 0;
      currentSeat = owner;
      tableOwner  = null;
    }

    return { ok: true };
  }

  function undo() { return false; } // not supported for card games

  return { state, play, pass: passFixed, undo, isGameOver, winner, turn };
}

module.exports = { createGame };
