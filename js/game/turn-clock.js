// Turn clock - Sol Sunspot Cycle (HF4 core game).
//
// 12-slot ring divided into 3 seasons of 4 slots each. The Sunspot
// Cube advances one slot per "End turn". When it crosses the new-
// round marker the round counter ticks up; when it lands on an
// event slot we roll a d6 and surface the result so the player can
// (eventually) act on it. Right now we just report the roll -
// translating each Inspiration / Glitch / Pad Explosion / Solar
// Flare / Budget Cuts outcome into engine effects belongs in
// Stage 3.
//
// Public surface:
//   getTurn()                  → 0..11
//   getRound()                 → 1, 2, …
//   getSeason()                → { name, color, from, to }
//   getLastEvent()             → null | { turn, dieRoll, round }
//   isEventSlot(slot)          → boolean
//   getOpsRemaining()          → number (default 1; placeholder until
//                                Stage 3 operations engine lands)
//   getMovesRemaining()        → number (default 1; same placeholder
//                                until rocket-movement is wired)
//   consumeOp()                → spend one operation
//   consumeMove()              → spend one ship move
//   endTurn()                  → { turn, event } - resets per-turn budgets
//   resetClock()               → reset to turn 0, round 1
//   onTurnChange(cb)           → unsubscribe
//
// Layout (slot indexes):
//   0   = new round marker (middle of Season Blue)
//   0,2,4,6,8,10 = event slots. An event fires when the cube LANDS on
//                  one of these (every 2 turns). One slot clockwise of
//                  the old odd markers, so the event resolves the turn
//                  AFTER the cube crosses the marker line, not on it.
//   0..3  = Blue, 4..7 = Yellow, 8..11 = Red

import { isOnline } from './online-mode.js';

const STORAGE_TURN   = 'hf-sandbox-turn';
const STORAGE_ROUND  = 'hf-sandbox-round';
const STORAGE_EVT    = 'hf-sandbox-last-event';
const STORAGE_OPS    = 'hf-sandbox-ops';
const STORAGE_MOVES  = 'hf-sandbox-moves';
const STORAGE_DISC   = 'hf-sandbox-discards';

export const SLOTS = 12;
// Season wedges on the 12-slot dial. The new-round marker (slot 0) sits
// in the MIDDLE of Season Blue, so Blue WRAPS the top of the dial:
// slots 10, 11, 0, 1 (two blue slots fall before turn 0). Yellow then
// Red follow clockwise. A `from > to` entry means the wedge wraps past
// slot 0 - see slotInSeason() / seasonArc(). Event markers (slots 0, 2,
// 4, 6, 8, 10) are independent of this colouring and stay put.
export const SEASONS = [
  { name: 'blue',   color: '#60a5fa', from: 10, to: 1, label: 'Season Blue'   },
  { name: 'yellow', color: '#facc15', from: 2,  to: 5, label: 'Season Yellow' },
  { name: 'red',    color: '#f87171', from: 6,  to: 9, label: 'Season Red'   },
];
export const NEW_ROUND_SLOT = 0;
// Even slots. An event fires when the cube LANDS here; this is one slot
// clockwise of the old odd markers [1,3,5,7,9,11], so each event now
// resolves the turn AFTER the cube crosses its marker line (events used
// to trigger one turn too early). Slot 0 fires on the new-round tick.
// Mirrored in server/game/state.js - keep both in sync.
export const EVENT_SLOTS = [0, 2, 4, 6, 8, 10];

// Verbatim HF4 Sunspot-Cube event table. Triggered each time the
// cube lands on an event slot (0, 2, 4, 6, 8, 10); the
// player rolls 1d6 and consults this table. For rolls 1-4 the
// event is universal; for 5-6 the effect depends on the current
// season (Blue / Yellow / Red). The text below is reproduced from
// the published rulebook so the modal can surface it verbatim.
//
// NOTE: these events DO NOT directly award or remove VP - they
// change game state (rotate decks, place Glitch tokens,
// decommission cards, swap faction privileges, force flare rolls).
// VP swings only happen as a side-effect of those state changes
// (e.g. losing a card you spent ops to build). Don't wire d6 to
// VP deltas; the event is the event.
export const EVENT_TABLE = {
  inspiration: {
    name: 'Inspiration',
    icon: '💡',
    rolls: [1, 2],
    season: null,
    text: 'Put the topmost card of each patent deck (& the Colonist '
      + 'queue) at the bottom of the deck.',
  },
  glitch: {
    name: 'Glitch',
    icon: '⚠️',
    rolls: [3],
    season: null,
    text: 'Each player places a Glitch disk on their stack with the '
      + 'most cards that has neither a Glitch nor Humans.',
  },
  pad_explosion: {
    name: 'Pad Explosion / Space Debris',
    icon: '🧨',
    rolls: [4],
    season: null,
    text: 'Each player decommissions their card with the highest '
      + 'Mass in LEO, choosing one if tied. However, Crew, '
      + 'Black-Side, Purple-Side, Colonists, and Bernals are immune.',
  },
  anarchy: {
    name: 'Anarchy',
    icon: '🗽',
    rolls: [5, 6],
    season: 'blue',
    text: 'Until the Sunspot Cube exits season blue, each player’s '
      + 'listed faction privilege is replaced by the Felonious '
      + 'faction privilege. (Module 0) The Active Law is inactivated, '
      + 'and make a Purge Roll.',
  },
  budget_cuts: {
    name: 'Budget Cuts',
    icon: '✂️',
    rolls: [5, 6],
    season: 'yellow',
    text: 'Each player discards a card of their choice from their '
      + 'Hand to the bottom of the corresponding patent deck.',
  },
  solar_flare: {
    name: 'Solar Flare',
    icon: '☀️',
    rolls: [5, 6],
    season: 'red',
    text: 'Make a 1d6 Flare Roll and apply the result to every card '
      + 'in all non-LEO and unshielded stacks. Adjust the result by '
      + 'the modifier listed in the Heliocentric Zone the stack is '
      + 'in. If rad-hardness < modified result, then decommission '
      + 'the card.',
  },
};
// Resolve a (dieRoll, seasonName) pair to the canonical event
// record. Returns null when no entry matches - shouldn't happen
// because every d6 value is covered for every season, but lets
// callers fail soft.
export function getEventForRoll(dieRoll, seasonName) {
  for (const e of Object.values(EVENT_TABLE)) {
    if (!e.rolls.includes(dieRoll)) continue;
    if (e.season !== null && e.season !== seasonName) continue;
    return e;
  }
  return null;
}
// Per-turn budgets. Stage 3's operations engine will take these
// over (HF4 core is 4 ops/turn); for now they're placeholders so
// the end-turn confirm dialog can gate on "did you spend
// everything you had?" - both default to 1.
export const OPS_PER_TURN      = 1;
export const MOVES_PER_TURN    = 1;
// Discards: voluntary free action, UNLIMITED per turn (the HF4 "any number per
// turn" free action; only a Human/crew figure is capped, and crew aren't
// discarded from the hand). Cards go to the bottom of their corresponding deck.
// This stays a non-zero "discard available" sentinel - it is no longer spent,
// so the discard never runs out.
export const DISCARDS_PER_TURN = 1;

let _turn = (() => {
  try {
    const n = parseInt(localStorage.getItem(STORAGE_TURN) || '0', 10);
    return Number.isFinite(n) && n >= 0 && n < SLOTS ? n : 0;
  } catch { return 0; }
})();
let _round = (() => {
  try {
    const n = parseInt(localStorage.getItem(STORAGE_ROUND) || '1', 10);
    return Number.isFinite(n) && n >= 1 ? n : 1;
  } catch { return 1; }
})();
let _lastEvent = (() => {
  try {
    const s = localStorage.getItem(STORAGE_EVT);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
})();
let _opsRemaining = (() => {
  try {
    const n = parseInt(localStorage.getItem(STORAGE_OPS) || String(OPS_PER_TURN), 10);
    return Number.isFinite(n) && n >= 0 ? n : OPS_PER_TURN;
  } catch { return OPS_PER_TURN; }
})();
let _movesRemaining = (() => {
  try {
    const n = parseInt(localStorage.getItem(STORAGE_MOVES) || String(MOVES_PER_TURN), 10);
    return Number.isFinite(n) && n >= 0 ? n : MOVES_PER_TURN;
  } catch { return MOVES_PER_TURN; }
})();
let _discardsRemaining = (() => {
  try {
    const n = parseInt(localStorage.getItem(STORAGE_DISC) || String(DISCARDS_PER_TURN), 10);
    return Number.isFinite(n) && n >= 0 ? n : DISCARDS_PER_TURN;
  } catch { return DISCARDS_PER_TURN; }
})();

let _listeners = [];

function persist() {
  if (isOnline()) return;
  try {
    localStorage.setItem(STORAGE_TURN,   String(_turn));
    localStorage.setItem(STORAGE_ROUND,  String(_round));
    localStorage.setItem(STORAGE_OPS,    String(_opsRemaining));
    localStorage.setItem(STORAGE_MOVES,  String(_movesRemaining));
    localStorage.setItem(STORAGE_DISC,   String(_discardsRemaining));
    if (_lastEvent) localStorage.setItem(STORAGE_EVT, JSON.stringify(_lastEvent));
    else            localStorage.removeItem(STORAGE_EVT);
  } catch { /* private mode */ }
}
function notify() {
  for (const cb of _listeners) {
    try { cb(); } catch (e) { console.error('turn-clock listener:', e); }
  }
}

// Game length, when known (multiplayer carries state.maxRounds). null
// in the open-ended sandbox, where the cycle just keeps ticking.
let _maxRounds = null;

// Replace the in-memory clock state from a server snapshot.
export function hydrateClock({
  turn = 0,
  round = 1,
  maxRounds = null,
  lastEvent = null,
  opsRemaining = 0,
  movesRemaining = 0,
  discardsRemaining = 0,
} = {}) {
  _turn = turn;
  _round = round;
  _maxRounds = maxRounds || null;
  _lastEvent = lastEvent;
  _opsRemaining = opsRemaining;
  _movesRemaining = movesRemaining;
  _discardsRemaining = discardsRemaining;
  notify();
}

export function getTurn()  { return _turn;  }
export function getRound() { return _round; }
export function getMaxRounds() { return _maxRounds; }

// Compact "where are we" label: round.slot/maxRounds, with the slot shown
// 1-based (1-12) to match the reindexed clock face. The "/maxRounds" tail
// is dropped when the length is unknown (open-ended sandbox), leaving just
// round.slot. Examples: "1.1/5", "1.11/5", "2.3".
export function formatTurnNumber(round = _round, turn0 = _turn, maxRounds = _maxRounds) {
  const r = Number(round) || 1;
  const slot = (Number(turn0) || 0) + 1;
  return maxRounds ? `${r}.${slot}/${maxRounds}` : `${r}.${slot}`;
}
// True when `slot` falls inside a season wedge, handling wedges that
// wrap past slot 0 (from > to, e.g. Blue = 10..1).
export function slotInSeason(slot, s) {
  return s.from <= s.to
    ? (slot >= s.from && slot <= s.to)
    : (slot >= s.from || slot <= s.to);
}
export function getSeason() {
  return SEASONS.find((s) => slotInSeason(_turn, s));
}
// Look up which season a given slot index sits in (handy for
// events recorded mid-turn: the event's effect depends on the
// season at the moment the cube crossed the threshold, not the
// season as of "now").
export function getSeasonForSlot(slot) {
  return SEASONS.find((s) => slotInSeason(slot, s)) || SEASONS[0];
}
export function getLastEvent()      { return _lastEvent; }
export function getOpsRemaining()   { return _opsRemaining; }
export function getMovesRemaining() { return _movesRemaining; }
export function isEventSlot(slot)   { return EVENT_SLOTS.includes(slot); }

export function consumeOp() {
  if (_opsRemaining <= 0) return false;
  _opsRemaining -= 1;
  persist();
  notify();
  return true;
}
export function consumeMove() {
  if (_movesRemaining <= 0) return false;
  _movesRemaining -= 1;
  persist();
  notify();
  return true;
}

// Voluntary free-action discard. Card discard is UNLIMITED per turn, so this no
// longer spends a per-turn budget: it stays a hook callers can use uniformly and
// always succeeds. getDiscardsRemaining stays > 0 so the discard UI never greys.
export function getDiscardsRemaining() { return _discardsRemaining; }
export function consumeDiscard() { return true; }

// Refund a previously-consumed move. Used by the toolbar's
// 🛸 / ↩ toggle so the player can take it back before they end
// the turn (HF4 lets you do your operation before OR after your
// move - never in the middle - so the move is reversible right
// up until end-turn commits the round). Returns false when nothing
// to refund (move budget is already full).
export function refundMove() {
  if (_movesRemaining >= MOVES_PER_TURN) return false;
  _movesRemaining = Math.min(MOVES_PER_TURN, _movesRemaining + 1);
  persist();
  notify();
  return true;
}

export function onTurnChange(cb) {
  _listeners.push(cb);
  return () => { _listeners = _listeners.filter((x) => x !== cb); };
}

export function endTurn() {
  _turn = (_turn + 1) % SLOTS;
  if (_turn === NEW_ROUND_SLOT) _round += 1;
  let event = null;
  if (EVENT_SLOTS.includes(_turn)) {
    event = {
      turn: _turn,
      round: _round,
      dieRoll: 1 + Math.floor(Math.random() * 6),
    };
    _lastEvent = event;
  }
  // Per-turn budgets refill for the new turn.
  _opsRemaining      = OPS_PER_TURN;
  _movesRemaining    = MOVES_PER_TURN;
  _discardsRemaining = DISCARDS_PER_TURN;
  persist();
  notify();
  return { turn: _turn, round: _round, event };
}

export function resetClock() {
  _turn = 0;
  _round = 1;
  _lastEvent = null;
  _opsRemaining = OPS_PER_TURN;
  _movesRemaining = MOVES_PER_TURN;
  _discardsRemaining = DISCARDS_PER_TURN;
  persist();
  notify();
}
