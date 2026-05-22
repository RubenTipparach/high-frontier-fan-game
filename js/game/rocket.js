// Sandbox rocket: a single LEO-anchored rocket whose stack the
// player fills by adding cards from their hand. Tracks the
// component cards + a basic flyable check (does every card's
// supports row find a matching supplier in the same stack?).
//
// Public surface:
//   getRocketStack()                  → { id, kind }[]
//   addToStack(cardId, kind)
//   removeFromStack(index)
//   clearStack()
//   onRocketChange(cb)                → unsubscribe
//   canRocketFly(allCardsLookup)      → { ok: bool, missing: string[] }
//
// `allCardsLookup` is (id) => card; used to read each card's
// type + requires + supplies. We don't import PATENTS here to
// keep this module independent of the deck source.

import { PATENTS_BY_ID } from '../../data/patents.js';

const STORAGE_KEY = 'hf-sandbox-rocket';

let _stack = (() => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((s) => s && s.id) : [];
  } catch { return []; }
})();

let _listeners = [];

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_stack)); }
  catch { /* private mode */ }
}

function notify() {
  for (const cb of _listeners) {
    try { cb(); } catch (err) { console.error('rocket listener:', err); }
  }
}

export function getRocketStack() {
  return _stack.slice();
}

export function isInRocket(id) {
  return _stack.some((s) => s.id === id);
}

export function addToStack(cardId, kind) {
  if (!cardId) return -1;
  _stack.push({ id: cardId, kind: kind || 'patent' });
  persist();
  notify();
  return _stack.length - 1;
}

export function removeFromStack(index) {
  if (index < 0 || index >= _stack.length) return false;
  _stack.splice(index, 1);
  persist();
  notify();
  return true;
}

export function clearStack() {
  if (!_stack.length) return;
  _stack = [];
  persist();
  notify();
}

export function onRocketChange(cb) {
  _listeners.push(cb);
  return () => { _listeners = _listeners.filter((x) => x !== cb); };
}

// Flyable check: every card's "requires" entry has to find a
// matching kind in another card's "supplies" within the same
// stack. Same-supplier OR-groups (a refinery that lists
// X / ∿ / 💣 reactor) are satisfied by ANY ONE of the listed
// kinds — so we collect the set of kinds supplied by the stack
// and ask "does at least one of the required kinds appear here?"
export function canRocketFly() {
  const cards = _stack
    .filter((s) => s.kind !== 'crew')          // crew don't satisfy reactor supports
    .map((s) => PATENTS_BY_ID[s.id])
    .filter(Boolean);
  if (cards.length === 0) return { ok: false, missing: ['empty stack'] };

  // What does each card supply? Use the primary face's supplies
  // (the player can always Flip to that side at build time).
  const supplied = new Set();
  for (const c of cards) {
    const primary = (c.faces && c.faces.primary && c.faces.primary.supplies) || c.supplies || [];
    for (const k of primary) supplied.add(k);
  }

  // What does each card require? Group same-supplier-type reqs
  // because they're OR (any one satisfies the slot).
  const missing = [];
  for (const c of cards) {
    const reqs = (c.faces && c.faces.primary && c.faces.primary.requires) || c.requires || [];
    if (!reqs.length) continue;
    // OR-group by the prefix before the dash (reactor-* / gen-*
    // are alternatives within their group).
    const groups = new Map();
    for (const r of reqs) {
      const supplier = r.kind.split('-')[0];   // reactor / gen / etc.
      if (!groups.has(supplier)) groups.set(supplier, []);
      groups.get(supplier).push(r.kind);
    }
    for (const [supplier, kinds] of groups) {
      const anyMatched = kinds.some((k) => supplied.has(k));
      if (!anyMatched) {
        missing.push(`${c.name} needs ${supplier} (${kinds.join(' / ')})`);
      }
    }
  }
  return { ok: missing.length === 0, missing };
}
