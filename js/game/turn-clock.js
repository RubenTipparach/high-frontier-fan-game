// Turn clock — Sol Sunspot Cycle (HF4 core game).
//
// 12-slot ring divided into 3 seasons of 4 slots each. The Sunspot
// Cube advances one slot per "End turn". When it crosses the new-
// round marker the round counter ticks up; when it lands on an
// event slot we roll a d6 and surface the result so the player can
// (eventually) act on it. Right now we just report the roll —
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
//   endTurn()                  → { turn, event } — resets per-turn budgets
//   resetClock()               → reset to turn 0, round 1
//   onTurnChange(cb)           → unsubscribe
//
// Layout (slot indexes):
//   0   = new round marker (middle of Season Blue)
//   1,3,5,7,9,11 = event slots — "1 turn after new round, then
//                  every 2 turns" as specced
//   0..3  = Blue, 4..7 = Yellow, 8..11 = Red

const STORAGE_TURN   = 'hf-sandbox-turn';
const STORAGE_ROUND  = 'hf-sandbox-round';
const STORAGE_EVT    = 'hf-sandbox-last-event';
const STORAGE_OPS    = 'hf-sandbox-ops';
const STORAGE_MOVES  = 'hf-sandbox-moves';

export const SLOTS = 12;
export const SEASONS = [
  { name: 'blue',   color: '#60a5fa', from: 0, to: 3, label: 'Season Blue'   },
  { name: 'yellow', color: '#facc15', from: 4, to: 7, label: 'Season Yellow' },
  { name: 'red',    color: '#f87171', from: 8, to: 11, label: 'Season Red'   },
];
export const NEW_ROUND_SLOT = 0;
export const EVENT_SLOTS = [1, 3, 5, 7, 9, 11];
// Per-turn budgets. Stage 3's operations engine will take these
// over (HF4 core is 4 ops/turn); for now they're placeholders so
// the end-turn confirm dialog can gate on "did you spend
// everything you had?" — both default to 1.
export const OPS_PER_TURN   = 1;
export const MOVES_PER_TURN = 1;

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

let _listeners = [];

function persist() {
  try {
    localStorage.setItem(STORAGE_TURN,   String(_turn));
    localStorage.setItem(STORAGE_ROUND,  String(_round));
    localStorage.setItem(STORAGE_OPS,    String(_opsRemaining));
    localStorage.setItem(STORAGE_MOVES,  String(_movesRemaining));
    if (_lastEvent) localStorage.setItem(STORAGE_EVT, JSON.stringify(_lastEvent));
    else            localStorage.removeItem(STORAGE_EVT);
  } catch { /* private mode */ }
}
function notify() {
  for (const cb of _listeners) {
    try { cb(); } catch (e) { console.error('turn-clock listener:', e); }
  }
}

export function getTurn()  { return _turn;  }
export function getRound() { return _round; }
export function getSeason() {
  return SEASONS.find((s) => _turn >= s.from && _turn <= s.to);
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
  _opsRemaining   = OPS_PER_TURN;
  _movesRemaining = MOVES_PER_TURN;
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
  persist();
  notify();
}
