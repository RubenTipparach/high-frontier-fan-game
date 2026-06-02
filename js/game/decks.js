// Card Market deck model.
//
// Per the Card Market rules (user, 2026-05-24):
//   - Each patent type has its OWN ordered deck (thruster /
//     reactor / radiator / refinery / robonaut / generator).
//   - Decks are shuffled at game start; the order persists.
//   - Only the TOP card of each deck is available to buy at
//     any given time.
//   - On Inspiration event (turn-clock event-slot d6 roll
//     1 or 2): cycle every deck - move the top card to the
//     bottom.
//   - When the auction winner takes a card whose `requires`
//     lists supports, they additionally draw 1 card from the
//     top of EACH corresponding support deck (one per
//     supplier-prefix group; disregard the specific icon
//     within the group).
//   - In solo / sandbox the player wins each auction
//     immediately for 0 aqua. The cost is the per-turn op +
//     a Hand-card sacrifice (sacrificed card goes to the
//     bottom of its own type's deck).
//
// In Free Library mode this module's state is still
// initialized for consistency, but the cart UI is hidden and
// nothing reads from these decks in that mode.
//
// Public surface:
//   DECK_TYPES                          string[] (6 entries)
//   getDeck(type)                       array of ids (top first)
//   peekTop(type)                       id | null
//   drawTop(type)                       id | null (mutates)
//   addToBottom(id)                     boolean (auto-routes by card type)
//   cycleDeck(type)                     boolean (top -> bottom)
//   cycleAllDecks()                     void (Inspiration handler)
//   removeFromDeck(id)                  boolean
//   resetDecks(ownedIds)                rebuild from a fresh shuffle,
//                                       excluding the cards already
//                                       owned by the player
//   onDeckChange(cb)                    unsubscribe

import { PATENTS, PATENTS_BY_ID } from '../../data/patents.js';
import { isOnline } from './online-mode.js';

export const DECK_TYPES = [
  'thruster', 'reactor', 'radiator',
  'refinery', 'robonaut', 'generator',
];

const STORAGE_KEY = 'hf-sandbox-market-decks';

// All-patents minus expansion. Expansion (GW thrusters) is
// browsable in the library but NOT part of the market deck.
function eligiblePatentIds() {
  return PATENTS
    .filter((c) => c.type !== 'gw-thruster')
    .map((c) => c.id);
}

// Group every eligible card by its rulebook deck type.
function buildEmptyDecks() {
  const out = {};
  for (const t of DECK_TYPES) out[t] = [];
  return out;
}

// Fisher-Yates shuffle. Math.random is fine for the sandbox;
// future multiplayer engine should pass a seeded RNG.
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Persisted state. On first load we synthesize an initial
// shuffle of every card-not-yet-owned. The "owned" check
// is the caller's responsibility (we receive the set in
// resetDecks); the first-time bootstrap below assumes nothing
// is owned because the caller can replay any draws later by
// calling removeFromDeck during init.
function loadInitial() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const out = buildEmptyDecks();
        for (const t of DECK_TYPES) {
          if (Array.isArray(parsed[t])) {
            out[t] = parsed[t].filter((id) => typeof id === 'string');
          }
        }
        return out;
      }
    }
  } catch { /* fall through to fresh shuffle */ }
  return buildShuffledFresh();
}

function buildShuffledFresh() {
  const out = buildEmptyDecks();
  for (const id of eligiblePatentIds()) {
    const c = PATENTS_BY_ID[id];
    if (!c || !out[c.type]) continue;
    out[c.type].push(id);
  }
  for (const t of DECK_TYPES) out[t] = shuffle(out[t]);
  return out;
}

let _decks = loadInitial();
let _listeners = [];

function persist() {
  if (isOnline()) return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_decks)); }
  catch { /* private mode */ }
}
function notify() {
  for (const cb of _listeners) {
    try { cb(); } catch (err) { console.error('decks listener:', err); }
  }
}

// Replace the in-memory per-type decks from a server snapshot.
export function hydrateDecks(decks = {}) {
  let copy;
  try { copy = structuredClone(decks); }
  catch { copy = JSON.parse(JSON.stringify(decks)); }
  _decks = (copy && typeof copy === 'object') ? copy : {};
  notify();
}

export function getDeck(type) {
  return Array.isArray(_decks[type]) ? _decks[type].slice() : [];
}

export function peekTop(type) {
  const d = _decks[type];
  return Array.isArray(d) && d.length ? d[0] : null;
}

export function drawTop(type) {
  const d = _decks[type];
  if (!Array.isArray(d) || !d.length) return null;
  const id = d.shift();
  persist();
  notify();
  return id;
}

// Add a card to the bottom of ITS OWN type's deck. Type is
// resolved from the card record; unknown / expansion cards
// are silently skipped.
export function addToBottom(id) {
  const card = PATENTS_BY_ID[id];
  if (!card) return false;
  if (!_decks[card.type]) return false;
  // Avoid duplicating an entry that's somehow already in the
  // deck (defence in depth).
  if (_decks[card.type].includes(id)) return false;
  _decks[card.type].push(id);
  persist();
  notify();
  return true;
}

// Move the top card of a single deck to the bottom. Used by
// the player-initiated "shuffle" affordance + by the
// Inspiration event handler indirectly through cycleAllDecks.
export function cycleDeck(type) {
  const d = _decks[type];
  if (!Array.isArray(d) || d.length < 2) return false;
  const top = d.shift();
  d.push(top);
  persist();
  notify();
  return true;
}

// Inspiration event (turn-clock event-slot d6 roll 1 or 2).
// Topmost card of every patent deck goes to the bottom.
export function cycleAllDecks() {
  let any = false;
  for (const t of DECK_TYPES) {
    const d = _decks[t];
    if (!Array.isArray(d) || d.length < 2) continue;
    const top = d.shift();
    d.push(top);
    any = true;
  }
  if (any) { persist(); notify(); }
  return any;
}

// Remove a specific id from whichever deck it's in. Used when
// a card transitions from the deck into player ownership via
// a non-auction path (currently only the bootstrap; future:
// drag-to-hand in Free Library could call this so the deck
// stays consistent across mode flips).
export function removeFromDeck(id) {
  const card = PATENTS_BY_ID[id];
  if (!card) return false;
  const d = _decks[card.type];
  if (!Array.isArray(d)) return false;
  const idx = d.indexOf(id);
  if (idx === -1) return false;
  d.splice(idx, 1);
  persist();
  notify();
  return true;
}

// Rebuild all decks from scratch. Reshuffles every eligible
// patent that isn't in ownedIds. Used by the sandbox reset
// flow + the Card Market toggle so each "new game" starts
// from a clean random order.
export function resetDecks(ownedIds) {
  const owned = ownedIds instanceof Set ? ownedIds : new Set(ownedIds || []);
  const fresh = buildShuffledFresh();
  for (const t of DECK_TYPES) {
    fresh[t] = fresh[t].filter((id) => !owned.has(id));
  }
  _decks = fresh;
  persist();
  notify();
}

export function onDeckChange(cb) {
  _listeners.push(cb);
  return () => { _listeners = _listeners.filter((x) => x !== cb); };
}

// Translate a card's `requires` entry into a deck type for
// the support-bonus draw. Per the user (2026-05-24): "disregard
// icon type" - we group by supplier prefix so multiple
// reactor-* OR alternatives within a single supplier collapse
// to one reactor draw. Returns null when the prefix doesn't
// map to a deck (e.g. abstract kinds like 'beam-receiver' that
// aren't grounded in a specific deck).
const KIND_PREFIX_TO_DECK = {
  reactor:  'reactor',
  gen:      'generator',
  radiator: 'radiator',
  refinery: 'refinery',
  robonaut: 'robonaut',
  thruster: 'thruster',
  // A heat card's cooling requirement (the 🌡️ thermostat support) is
  // satisfied by a radiator, so a lot that needs cooling draws one off
  // the radiator deck as a bonus support card.
  thermostat: 'radiator',
};
export function requireKindToDeckType(kind) {
  if (!kind) return null;
  const prefix = String(kind).split('-')[0];
  return KIND_PREFIX_TO_DECK[prefix] || null;
}

// Collect the unique deck-types this card's `requires` ought
// to draw a support bonus from. Same OR-by-supplier-prefix
// rule the rocket-active check uses - each prefix group
// produces ONE draw regardless of how many alternative kinds
// it lists.
export function supportBonusDecks(card) {
  if (!card) return [];
  const f = (card.faces && card.faces.primary) || card;
  const requires = Array.isArray(f.requires) ? f.requires : (card.requires || []);
  const decks = new Set();
  for (const r of requires) {
    const t = requireKindToDeckType(r?.kind);
    if (t) decks.add(t);
  }
  return [...decks];
}
