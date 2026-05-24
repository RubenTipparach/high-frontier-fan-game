// Stage-3 LEO Stack.
//
// Per the variant rules (user, 2026-05-24): LEO is its OWN
// stack, distinct from the Hand. The cargo flow is:
//
//   Patent Library  --(drag, free)-->  Hand
//   Hand            --(Boost op)----->  LEO Stack
//   LEO Stack       --(Transfer, free, rocket-at-LEO)-->  Rocket
//   Rocket          --(Convert, free)-->  Outpost
//   Outpost         --(Convert, needs functional thruster)-->  Rocket
//
// LEO Stack carries its own cards AND its own water tank
// (matches the per-stack water-FT model from industrialize.md).
// The Aqua Bank (rocket.js getAqua) is shared and stays at LEO;
// the LEO Stack's tank is for water FTs that haven't yet been
// loaded onto the rocket.
//
// Public surface:
//   getLeoCards()                 -> { id, kind, face? }[]
//   isInLeo(id)                   -> boolean
//   addCardToLeo(slot)            -> boolean
//   removeCardFromLeo(index)      -> { id, kind } | null
//   removeCardFromLeoById(id)     -> { id, kind } | null
//   clearLeo()
//   getLeoTank()                  -> number
//   setLeoTank(n)                 -> boolean
//   addLeoFuel(delta)             -> boolean
//   resetLeoStack()
//   onLeoChange(cb)               -> unsubscribe
//
// Slot shape: { id, kind, face? }. Same shape as the rocket and
// outpost stack slots so cards can move between them freely.

const STORAGE_CARDS = 'hf-sandbox-leo-cards';
const STORAGE_TANK  = 'hf-sandbox-leo-tank';

const TANK_MAX = 32;

let _cards = (() => {
  try {
    const raw = localStorage.getItem(STORAGE_CARDS);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr.filter((c) => c && c.id).map((c) => {
      const out = { id: String(c.id), kind: c.kind || 'patent' };
      if (c.face === 'secondary') out.face = 'secondary';
      return out;
    });
  } catch { return []; }
})();

let _tank = (() => {
  try {
    const raw = localStorage.getItem(STORAGE_TANK);
    const n = parseInt(raw || '0', 10);
    return Number.isFinite(n) && n >= 0 ? Math.min(TANK_MAX, n) : 0;
  } catch { return 0; }
})();

let _listeners = [];

function persist() {
  try {
    localStorage.setItem(STORAGE_CARDS, JSON.stringify(_cards));
    localStorage.setItem(STORAGE_TANK, String(_tank));
  } catch { /* private mode */ }
}
function notify() {
  for (const cb of _listeners) {
    try { cb(); } catch (err) { console.error('leo-stack listener:', err); }
  }
}

export function getLeoCards() {
  return _cards.slice();
}

export function isInLeo(id) {
  return _cards.some((c) => c.id === id);
}

export function addCardToLeo(slot) {
  if (!slot || !slot.id) return false;
  const entry = { id: String(slot.id), kind: slot.kind || 'patent' };
  if (slot.face === 'secondary') entry.face = 'secondary';
  _cards.push(entry);
  persist();
  notify();
  return true;
}

export function removeCardFromLeo(index) {
  if (index < 0 || index >= _cards.length) return null;
  const removed = _cards.splice(index, 1)[0] || null;
  persist();
  notify();
  return removed;
}

export function removeCardFromLeoById(id) {
  const idx = _cards.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  return removeCardFromLeo(idx);
}

export function clearLeo() {
  if (!_cards.length && _tank === 0) return;
  _cards = [];
  _tank = 0;
  persist();
  notify();
}

export function getLeoTank() { return _tank; }

export function setLeoTank(n) {
  const v = Math.max(0, Math.min(TANK_MAX, Math.floor(Number(n) || 0)));
  if (v === _tank) return false;
  _tank = v;
  persist();
  notify();
  return true;
}

export function addLeoFuel(delta = 1) {
  return setLeoTank(_tank + (Number(delta) || 1));
}

// Reset LEO Stack to empty state. Called by the sandbox reset
// flow and the Card Market toggle.
export function resetLeoStack() {
  if (!_cards.length && _tank === 0) return;
  _cards = [];
  _tank = 0;
  persist();
  notify();
}

export function onLeoChange(cb) {
  _listeners.push(cb);
  return () => { _listeners = _listeners.filter((x) => x !== cb); };
}
