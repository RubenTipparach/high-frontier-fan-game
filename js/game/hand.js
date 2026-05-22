// Sandbox "hand" — the player's tentative pool of patents and
// crew. Cards live as ordered slots (duplicates allowed) so the
// player can hold multiple copies of the same patent / crew if
// they want to (one to compare against another, or to send to
// different rockets later).
//
// Each slot tracks its card id. Slots are indexed by their
// position in the array; removeFromHandAt(index) drops one
// specific copy. Persists to localStorage so the work survives
// reloads while the player iterates.
//
// Public surface:
//   getHandSlots()                → string[]  (card ids, in order)
//   addToHand(card)               → number    (index of the added slot)
//   removeFromHandAt(index)       → boolean
//   clearHand()
//   onHandChange(cb)              → unsubscribe()

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

export function getHandSlots() {
  return _hand.slice();
}

// Legacy alias kept for callers that haven't migrated yet.
export function getHandIds() {
  return _hand.slice();
}

// No more one-of-each-type rule — the player can hold as many
// copies of a card as they want. Returns the slot index where
// the new card landed.
export function addToHand(card) {
  if (!card || !card.id) return -1;
  _hand.push(card.id);
  persist();
  notify();
  return _hand.length - 1;
}

export function removeFromHandAt(index) {
  if (index < 0 || index >= _hand.length) return false;
  _hand.splice(index, 1);
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
