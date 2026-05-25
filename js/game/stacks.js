// Stage-3 multi-stack model.
//
// The published HF4 player can own up to four Outposts in
// addition to their Rocket. Each Outpost is a parked stack at
// some site: it carries its own cards + water tank but cannot
// move (no thruster requirement). The Rocket is the only stack
// that flies.
//
// This module owns ONLY the Outpost slots + the "focused stack"
// id used by the hand-bar switcher. Rocket card state lives in
// rocket.js (unchanged); rocket location lives in browse.js's
// `_rocketSiteId`. LEO Hand state lives in hand.js. This module
// is purely additive - existing sandbox flows do not depend on
// it.
//
// Outpost slots are labelled A / B / C / D. The player picks
// which letter a new outpost takes on creation (variant rule,
// see industrialize.md). Slots return to the pool when an
// outpost dissolves.
//
// Public surface:
//   STACK_IDS                              ordered id list
//   OUTPOST_LETTERS                        ['A','B','C','D']
//   getOutposts()                          { A?, B?, C?, D? }
//   getOutpost(letter)                     outpost | null
//   getAvailableOutpostSlots()             string[]
//   createOutpost(letter, siteId)          boolean
//   dissolveOutpost(letter)                cards[] (returned to caller)
//   addCardToOutpost(letter, slot)         boolean
//   removeCardFromOutpost(letter, index)   { id, kind } | null
//   setOutpostTank(letter, n)              boolean
//   addOutpostFuel(letter, delta)          boolean
//   onOutpostsChange(cb)                   unsubscribe
//
//   getFocusedStackId()                    string ('rocket'|'leo'|'outpostA'|...)
//   setFocusedStackId(id)                  boolean
//   onFocusChange(cb)                      unsubscribe
//
// Outpost record shape:
//   { letter, siteId, cards: [{id, kind}], tank: number }

const OUTPOSTS_KEY = 'hf-sandbox-outposts';
const FOCUS_KEY    = 'hf-sandbox-focused-stack';

export const OUTPOST_LETTERS = ['A', 'B', 'C', 'D'];
export const STACK_IDS = [
  'leo',
  'rocket',
  'outpostA', 'outpostB', 'outpostC', 'outpostD',
];

const TANK_MAX = 32;

function readOutposts() {
  try {
    const raw = localStorage.getItem(OUTPOSTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out = {};
    for (const letter of OUTPOST_LETTERS) {
      const rec = parsed[letter];
      if (!rec || !rec.siteId) continue;
      out[letter] = {
        letter,
        siteId: String(rec.siteId),
        cards: Array.isArray(rec.cards)
          ? rec.cards.filter((c) => c && c.id).map((c) => {
              const out = { id: String(c.id), kind: c.kind || 'patent' };
              if (c.face === 'secondary') out.face = 'secondary';
              return out;
            })
          : [],
        tank: Number.isFinite(rec.tank) && rec.tank >= 0
          ? Math.min(TANK_MAX, Math.floor(rec.tank))
          : 0,
      };
    }
    return out;
  } catch {
    return {};
  }
}

let _outposts = readOutposts();
let _focusedStackId = (() => {
  try {
    const v = localStorage.getItem(FOCUS_KEY);
    return STACK_IDS.includes(v) ? v : 'rocket';
  } catch { return 'rocket'; }
})();

let _outpostListeners = [];
let _focusListeners   = [];

function persistOutposts() {
  try {
    localStorage.setItem(OUTPOSTS_KEY, JSON.stringify(_outposts));
  } catch { /* private mode */ }
}
function persistFocus() {
  try { localStorage.setItem(FOCUS_KEY, _focusedStackId); }
  catch { /* private mode */ }
}
function notifyOutposts() {
  for (const cb of _outpostListeners) {
    try { cb(); } catch (err) { console.error('outpost listener:', err); }
  }
}
function notifyFocus() {
  for (const cb of _focusListeners) {
    try { cb(); } catch (err) { console.error('focus listener:', err); }
  }
}

export function getOutposts() {
  const out = {};
  for (const letter of OUTPOST_LETTERS) {
    if (_outposts[letter]) {
      out[letter] = {
        ..._outposts[letter],
        cards: _outposts[letter].cards.slice(),
      };
    }
  }
  return out;
}

export function getOutpost(letter) {
  const rec = _outposts[letter];
  if (!rec) return null;
  return { ...rec, cards: rec.cards.slice() };
}

export function getAvailableOutpostSlots() {
  return OUTPOST_LETTERS.filter((l) => !_outposts[l]);
}

export function createOutpost(letter, siteId) {
  if (!OUTPOST_LETTERS.includes(letter)) return false;
  if (_outposts[letter]) return false;
  if (!siteId) return false;
  _outposts[letter] = {
    letter,
    siteId: String(siteId),
    cards: [],
    tank: 0,
  };
  persistOutposts();
  notifyOutposts();
  return true;
}

// Dissolve an outpost. Returns the cards that were in it so the
// caller can route them (per spec they go to the player's hand
// for both voluntary and involuntary removal - see
// industrialize.md "Decommission / removal destinations").
export function dissolveOutpost(letter) {
  const rec = _outposts[letter];
  if (!rec) return [];
  const cards = rec.cards.slice();
  delete _outposts[letter];
  if (_focusedStackId === `outpost${letter}`) {
    _focusedStackId = 'rocket';
    persistFocus();
    notifyFocus();
  }
  persistOutposts();
  notifyOutposts();
  return cards;
}

// Slot face: 'primary' (default) is the normal Tier-1 face;
// 'secondary' is the Black-Side / Tier-2 face that ET Production
// (rulebook I8) writes when producing into a factory outpost.
// Endgame scoring (M2) doesn't care about the face today; it's
// kept here so future Delivery Op (I9) work can flip the face
// back to primary as the card travels home.
export function addCardToOutpost(letter, slot) {
  const rec = _outposts[letter];
  if (!rec) return false;
  if (!slot || !slot.id) return false;
  const entry = { id: String(slot.id), kind: slot.kind || 'patent' };
  if (slot.face === 'secondary') entry.face = 'secondary';
  rec.cards.push(entry);
  persistOutposts();
  notifyOutposts();
  return true;
}

export function removeCardFromOutpost(letter, index) {
  const rec = _outposts[letter];
  if (!rec) return null;
  if (index < 0 || index >= rec.cards.length) return null;
  const removed = rec.cards.splice(index, 1)[0];
  persistOutposts();
  notifyOutposts();
  return removed || null;
}

export function setOutpostTank(letter, n) {
  const rec = _outposts[letter];
  if (!rec) return false;
  const v = Math.max(0, Math.min(TANK_MAX, Math.floor(Number(n) || 0)));
  if (v === rec.tank) return false;
  rec.tank = v;
  persistOutposts();
  notifyOutposts();
  return true;
}

export function addOutpostFuel(letter, delta = 1) {
  const rec = _outposts[letter];
  if (!rec) return false;
  return setOutpostTank(letter, rec.tank + (Number(delta) || 1));
}

export function onOutpostsChange(cb) {
  _outpostListeners.push(cb);
  return () => { _outpostListeners = _outpostListeners.filter((x) => x !== cb); };
}

// --------- Focused stack ---------
//
// The hand-bar switcher (slice 4) lets the player pick which
// stack the cards-in-stack panel + site-popup actions target.
// Default 'rocket'. When an outpost dissolves and was focused,
// focus falls back to 'rocket' automatically (see
// dissolveOutpost).

export function getFocusedStackId() {
  return _focusedStackId;
}

export function setFocusedStackId(id) {
  if (!STACK_IDS.includes(id)) return false;
  // Refuse to focus a non-existent outpost slot.
  if (id.startsWith('outpost')) {
    const letter = id.slice('outpost'.length);
    if (!_outposts[letter]) return false;
  }
  if (id === _focusedStackId) return false;
  _focusedStackId = id;
  persistFocus();
  notifyFocus();
  return true;
}

export function onFocusChange(cb) {
  _focusListeners.push(cb);
  return () => { _focusListeners = _focusListeners.filter((x) => x !== cb); };
}

// Wipe every outpost + reset focus to 'rocket'. Called by the
// sandbox reset flow and the Card Market toggle reset. Fires
// both subscriber sets.
export function resetStacks() {
  _outposts = {};
  _focusedStackId = 'rocket';
  persistOutposts();
  persistFocus();
  notifyOutposts();
  notifyFocus();
}
