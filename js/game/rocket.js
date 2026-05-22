// Sandbox rocket: a single LEO-anchored rocket whose stack the
// player fills by adding cards from their hand. Tracks the
// component cards + an active-thruster selection. A rocket is
// "active" (and only then can move) when:
//   1. it has at least one thruster in the stack
//   2. the player has selected one of those thrusters as active
//   3. that active thruster's support requirements are all
//      satisfied by other cards already in the stack
//
// Public surface:
//   getRocketStack()                  → { id, kind }[]
//   isInRocket(id)                    → boolean
//   addToStack(cardId, kind)
//   removeFromStack(index)
//   clearStack()
//   getActiveThrusterId()             → string | null
//   setActiveThruster(id)             → boolean (true if set)
//   isRocketActive()                  → { active, reason, missing[] }
//   canRocketFly()                    → alias of isRocketActive
//                                       (kept for back-compat)
//   onRocketChange(cb)                → unsubscribe

import { PATENTS_BY_ID } from '../../data/patents.js';

const STORAGE_KEY  = 'hf-sandbox-rocket';
const ACTIVE_KEY   = 'hf-sandbox-rocket-active-thruster';

let _stack = (() => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((s) => s && s.id) : [];
  } catch { return []; }
})();

let _activeThrusterId = (() => {
  try { return localStorage.getItem(ACTIVE_KEY) || null; }
  catch { return null; }
})();

let _listeners = [];

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_stack));
    if (_activeThrusterId) localStorage.setItem(ACTIVE_KEY, _activeThrusterId);
    else                   localStorage.removeItem(ACTIVE_KEY);
  } catch { /* private mode */ }
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
  // First thruster added auto-selects as the active thruster
  // so the rocket has a sensible default. The player can
  // re-pick another thruster from the stack modal later.
  if (!_activeThrusterId) {
    const card = PATENTS_BY_ID[cardId];
    const isThr = card && (card.type === 'thruster' || card.thrust != null);
    if (isThr) _activeThrusterId = cardId;
  }
  persist();
  notify();
  return _stack.length - 1;
}

export function removeFromStack(index) {
  if (index < 0 || index >= _stack.length) return false;
  const removed = _stack[index];
  _stack.splice(index, 1);
  // If we just removed the active thruster, fall back to the
  // next remaining thruster in the stack (if any). Otherwise
  // clear the active selection.
  if (removed && removed.id === _activeThrusterId) {
    _activeThrusterId = null;
    for (const s of _stack) {
      const c = PATENTS_BY_ID[s.id];
      if (c && (c.type === 'thruster' || c.thrust != null)) {
        _activeThrusterId = s.id;
        break;
      }
    }
  }
  persist();
  notify();
  return true;
}

export function clearStack() {
  if (!_stack.length && !_activeThrusterId) return;
  _stack = [];
  _activeThrusterId = null;
  persist();
  notify();
}

export function getActiveThrusterId() {
  return _activeThrusterId;
}

export function setActiveThruster(id) {
  // Only allow picking a thruster that's actually in the stack
  // and is genuinely a thruster (or a missile-class robonaut
  // with its own thrust value — same idiom as the rest of the
  // app).
  if (!_stack.some((s) => s.id === id)) return false;
  const card = PATENTS_BY_ID[id];
  if (!card) return false;
  if (card.type !== 'thruster' && card.thrust == null) return false;
  _activeThrusterId = id;
  persist();
  notify();
  return true;
}

export function onRocketChange(cb) {
  _listeners.push(cb);
  return () => { _listeners = _listeners.filter((x) => x !== cb); };
}

// Activation check. Returns { active, reason, missing } where:
//   active  = true only if all three rules below are met
//   reason  = short string when active === false
//   missing = the per-card "needs X" breakdown, same shape as
//             the previous canRocketFly()
export function isRocketActive() {
  if (!_stack.length) {
    return { active: false, reason: 'empty stack', missing: [] };
  }
  const thrusters = _stack.filter((s) => {
    const c = PATENTS_BY_ID[s.id];
    return c && (c.type === 'thruster' || c.thrust != null);
  });
  if (!thrusters.length) {
    return { active: false, reason: 'no thruster in the stack', missing: [] };
  }
  if (!_activeThrusterId) {
    return { active: false, reason: 'no active thruster selected', missing: [] };
  }
  const active = PATENTS_BY_ID[_activeThrusterId];
  if (!active) {
    return { active: false, reason: 'active thruster missing', missing: [] };
  }

  // What does the REST of the stack supply? The active
  // thruster's supports are validated against those supplies.
  const others = _stack.filter((s) => s.id !== _activeThrusterId);
  const supplied = new Set();
  for (const s of others) {
    const c = PATENTS_BY_ID[s.id];
    if (!c) continue;
    const supplies = (c.faces && c.faces.primary && c.faces.primary.supplies) || c.supplies || [];
    for (const k of supplies) supplied.add(k);
  }

  // Group the active thruster's requires by supplier prefix
  // (reactor-* / gen-* / etc.) so same-supplier kinds read as
  // OR-alternatives — a thruster listing X / ∿ / 💣 reactor
  // is satisfied by ANY reactor that supplies one of those.
  const reqs = (active.faces && active.faces.primary && active.faces.primary.requires) || active.requires || [];
  const missing = [];
  if (reqs.length) {
    const groups = new Map();
    for (const r of reqs) {
      const supplier = r.kind.split('-')[0];
      if (!groups.has(supplier)) groups.set(supplier, []);
      groups.get(supplier).push(r.kind);
    }
    for (const [supplier, kinds] of groups) {
      if (!kinds.some((k) => supplied.has(k))) {
        missing.push(`${active.name} needs ${supplier} (${kinds.join(' / ')})`);
      }
    }
  }

  return {
    active: missing.length === 0,
    reason: missing.length ? 'support chain not satisfied' : '',
    missing,
  };
}

// Back-compat alias for callers that still call canRocketFly().
export function canRocketFly() {
  const r = isRocketActive();
  return { ok: r.active, missing: r.missing };
}
