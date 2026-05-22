// Sandbox "hand" — the player's tentative rocket stack. Holds at
// most one card of each PATENT_TYPE so the build represents a
// real ship: one thruster + one reactor + one radiator + etc.
// Persists to localStorage so the build survives reloads while
// the player iterates.
//
// Public surface:
//   getHandIds()                 → string[]   (card ids in order added)
//   isInHand(id)                 → boolean
//   typeInHand(type, lookup)     → string|null  (id of the card of that type in hand)
//   addToHand(card, lookup)      → { ok: true } | { ok: false, reason }
//   removeFromHand(id)
//   clearHand()
//   onHandChange(cb)             → unsubscribe()
//
// `lookup` is the function (id) => card record used to read the
// type of each id already in hand. We don't import PATENTS here
// to keep this module side-effect-free.

const STORAGE_KEY = 'hf-sandbox-hand';

let _hand = (() => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
})();

let _listeners = [];

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_hand)); }
  catch { /* localStorage may be unavailable in private mode */ }
}

function notify() {
  for (const cb of _listeners) {
    try { cb(); } catch (err) { console.error('hand listener:', err); }
  }
}

export function getHandIds() {
  return _hand.slice();
}

export function isInHand(id) {
  return _hand.includes(id);
}

export function typeInHand(type, lookup) {
  for (const id of _hand) {
    const c = lookup(id);
    if (c && c.type === type) return id;
  }
  return null;
}

export function addToHand(card, lookup) {
  if (!card || !card.id) return { ok: false, reason: 'no card' };
  if (_hand.includes(card.id)) return { ok: false, reason: 'already in hand' };
  const clash = typeInHand(card.type, lookup);
  if (clash) {
    return {
      ok: false,
      reason: `one ${card.type} max — drop the current ${card.type} first`,
      clashId: clash,
    };
  }
  _hand.push(card.id);
  persist();
  notify();
  return { ok: true };
}

export function removeFromHand(id) {
  const i = _hand.indexOf(id);
  if (i < 0) return false;
  _hand.splice(i, 1);
  persist();
  notify();
  return true;
}

export function clearHand() {
  if (!_hand.length) return;
  _hand = [];
  persist();
  notify();
}

export function onHandChange(cb) {
  _listeners.push(cb);
  return () => { _listeners = _listeners.filter((x) => x !== cb); };
}
