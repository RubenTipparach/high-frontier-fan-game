// Sandbox "hand" — the player's holding area for patents and
// crew on their way to a rocket. Each physical card exists in
// exactly one location at a time: deck (library), hand, or
// rocket stack. The hand state stores the ids of cards
// currently held; addToHand refuses duplicates and also blocks
// adding a card that's already sitting in the rocket.
//
// Persists to localStorage so the work survives reloads.
//
// Public surface:
//   getHandSlots()             → string[]   (card ids, order added)
//   isInHand(id)               → boolean
//   addToHand(card)            → { ok: true } | { ok: false, reason }
//   removeFromHandAt(index)    → boolean
//   removeFromHand(id)         → boolean
//   clearHand()
//   onHandChange(cb)           → unsubscribe

import { isInRocket } from './rocket.js';

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
  catch { /* private mode */ }
}

function notify() {
  for (const cb of _listeners) {
    try { cb(); } catch (err) { console.error('hand listener:', err); }
  }
}

export function getHandSlots() {
  return _hand.slice();
}
export function getHandIds() { return _hand.slice(); }

export function isInHand(id) {
  return _hand.includes(id);
}

export function addToHand(card) {
  if (!card || !card.id) return { ok: false, reason: 'no card' };
  if (_hand.includes(card.id)) {
    return { ok: false, reason: 'already in your hand' };
  }
  if (isInRocket(card.id)) {
    return { ok: false, reason: 'currently on your rocket — pull it back first' };
  }
  _hand.push(card.id);
  persist();
  notify();
  return { ok: true };
}

export function removeFromHandAt(index) {
  if (index < 0 || index >= _hand.length) return false;
  _hand.splice(index, 1);
  persist();
  notify();
  return true;
}

export function removeFromHand(id) {
  const i = _hand.indexOf(id);
  return i >= 0 ? removeFromHandAt(i) : false;
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
