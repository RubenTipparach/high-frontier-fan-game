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
// LEO Stack holds CARDS ONLY. There is no LEO water tank - the
// Aqua Bank (rocket.js getAqua) already lives at LEO, and
// launching transfers aqua from the Bank into the rocket's
// water tank. The LEO Stack is purely a card staging area
// between Hand and Rocket.
//
// Public surface:
//   getLeoCards()                 -> { id, kind, face? }[]
//   isInLeo(id)                   -> boolean
//   addCardToLeo(slot)            -> boolean
//   removeCardFromLeo(index)      -> { id, kind } | null
//   removeCardFromLeoById(id)     -> { id, kind } | null
//   clearLeo()
//   resetLeoStack()
//   onLeoChange(cb)               -> unsubscribe
//
// Slot shape: { id, kind, face? }. Same shape as the rocket and
// outpost stack slots so cards can move between them freely.

import { isOnline } from './online-mode.js';

const STORAGE_CARDS = 'hf-sandbox-leo-cards';

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

let _listeners = [];

function persist() {
  if (isOnline()) return;
  try {
    localStorage.setItem(STORAGE_CARDS, JSON.stringify(_cards));
  } catch { /* private mode */ }
}
function notify() {
  for (const cb of _listeners) {
    try { cb(); } catch (err) { console.error('leo-stack listener:', err); }
  }
}

// Replace the in-memory LEO stack from a server snapshot.
export function hydrateLeo(cards = []) {
  let copy;
  try { copy = structuredClone(cards); }
  catch { copy = JSON.parse(JSON.stringify(cards)); }
  _cards = Array.isArray(copy) ? copy : [];
  notify();
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
  if (!_cards.length) return;
  _cards = [];
  persist();
  notify();
}

// Reset LEO Stack to empty state. Called by the sandbox reset
// flow and the Card Market toggle.
export function resetLeoStack() {
  if (!_cards.length) return;
  _cards = [];
  persist();
  notify();
}

export function onLeoChange(cb) {
  _listeners.push(cb);
  return () => { _listeners = _listeners.filter((x) => x !== cb); };
}
