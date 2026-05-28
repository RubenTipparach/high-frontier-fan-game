// Sandbox "hand" - the player's holding area for patents and
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
import { isExpansionType } from '../../data/patents.js';
import { CREW_BY_ID } from '../../data/crew.js';
import { isOnline } from './online-mode.js';

const STORAGE_KEY = 'hf-sandbox-hand';
const BOOST_KEY = 'hf-sandbox-boost-marks';

let _hand = (() => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
})();

// Boost marks: ids of hand cards the player has flagged for the
// next BOOST commit (which transfers them all to the LEO rocket
// stack). Stored as a Set; persisted alongside the hand.
let _boostMarks = (() => {
  try {
    const raw = localStorage.getItem(BOOST_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []);
  } catch { return new Set(); }
})();

let _listeners = [];

function persist() {
  if (isOnline()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_hand));
    localStorage.setItem(BOOST_KEY, JSON.stringify([..._boostMarks]));
  } catch { /* private mode */ }
}

function notify() {
  for (const cb of _listeners) {
    try { cb(); } catch (err) { console.error('hand listener:', err); }
  }
}

// Replace the in-memory hand from a server snapshot. Clears any
// pending boost marks (they don't survive a snapshot swap).
export function hydrateHand(ids = []) {
  _hand = Array.isArray(ids) ? [...ids] : [];
  _boostMarks.clear();
  notify();
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
  // Crew NEVER enters the hand (variant rule, user 2026-05). Crew
  // stages in the LEO Stack and rides the rocket / outposts; it
  // re-spawns in LEO on mishap or when turned into a colony.
  if (CREW_BY_ID[card.id] || (card.faces?.primary?.role && card.type == null)) {
    return { ok: false, reason: 'crew never enters the hand (it stages in the LEO stack)' };
  }
  if (_hand.includes(card.id)) {
    return { ok: false, reason: 'already in your hand' };
  }
  if (isInRocket(card.id)) {
    return { ok: false, reason: 'currently on your rocket - pull it back first' };
  }
  if (isExpansionType(card.type)) {
    return { ok: false, reason: 'expansion-only card (coming soon)' };
  }
  _hand.push(card.id);
  persist();
  notify();
  return { ok: true };
}

export function removeFromHandAt(index) {
  if (index < 0 || index >= _hand.length) return false;
  const id = _hand[index];
  _hand.splice(index, 1);
  // A card leaving the hand can't carry its boost mark with it.
  _boostMarks.delete(id);
  persist();
  notify();
  return true;
}

// Boost-mark API: flag a hand card for the next BOOST commit.
// The commit (in browse.js) walks every marked id, transfers
// it to the rocket stack, and clears the marks.
export function isBoostMarked(id) {
  return _boostMarks.has(id);
}
export function getBoostMarked() {
  return [..._boostMarks];
}
export function toggleBoostMark(id) {
  if (_boostMarks.has(id)) _boostMarks.delete(id);
  else _boostMarks.add(id);
  persist();
  notify();
  return _boostMarks.has(id);
}
export function clearBoostMarks() {
  if (!_boostMarks.size) return;
  _boostMarks.clear();
  persist();
  notify();
}

export function removeFromHand(id) {
  const i = _hand.indexOf(id);
  return i >= 0 ? removeFromHandAt(i) : false;
}

export function clearHand() {
  if (!_hand.length && !_boostMarks.size) return;
  _hand = [];
  _boostMarks.clear();
  persist();
  notify();
}

export function onHandChange(cb) {
  _listeners.push(cb);
  return () => { _listeners = _listeners.filter((x) => x !== cb); };
}
