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
//   getTankWater() / setTankWater(n)  → ship's water tank scalar
//   addFuel(n) / removeFuel(n)        → tank deltas (clamp ≥0)
//   getStackTotals()                  → { mass, minRadHard, count, fuel }
//   getActiveThrusterStats()          → { thrust, fuel, isp, … }
//   onRocketChange(cb)                → unsubscribe

import { PATENTS_BY_ID } from '../../data/patents.js';

const STORAGE_KEY      = 'hf-sandbox-rocket';
const ACTIVE_KEY       = 'hf-sandbox-rocket-active-thruster';
const PROSPECTOR_KEY   = 'hf-sandbox-rocket-active-prospector';
const TANK_KEY         = 'hf-sandbox-rocket-tank';
// Cap the player's water tank so the +/- buttons don't run away
// at high tap rates. 99 is plenty for any solo run; we'll revisit
// when Stage 3 hands fuel allocation to the engine.
const TANK_MAX = 99;

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

// One prospector can be designated active per turn (HF4: only the
// active prospector can scan; switching mid-turn is not legal).
// Cards with `missile`, `raygun`, or `buggy` properties on the
// active face qualify. Activation also requires the prospector's
// own `requires` (support chips) to be satisfied by the rest of
// the stack - the canActivate flag in getActiveProspectorStats()
// encodes this.
let _activeProspectorId = (() => {
  try { return localStorage.getItem(PROSPECTOR_KEY) || null; }
  catch { return null; }
})();

let _tankWater = (() => {
  try {
    const n = parseInt(localStorage.getItem(TANK_KEY) || '0', 10);
    return Number.isFinite(n) && n >= 0 ? Math.min(TANK_MAX, n) : 0;
  } catch { return 0; }
})();

let _listeners = [];

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_stack));
    if (_activeThrusterId)   localStorage.setItem(ACTIVE_KEY,     _activeThrusterId);
    else                     localStorage.removeItem(ACTIVE_KEY);
    if (_activeProspectorId) localStorage.setItem(PROSPECTOR_KEY, _activeProspectorId);
    else                     localStorage.removeItem(PROSPECTOR_KEY);
    localStorage.setItem(TANK_KEY, String(_tankWater));
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
  // Expansion cards (currently GW thrusters) are previewable in
  // the library but cannot be flown until the expansion ships.
  // Refuse silently here - the calling UI greys the +/grab
  // buttons out on inspection so this is a defence-in-depth
  // check, not the only gate.
  const card = PATENTS_BY_ID[cardId];
  if (card && card.type === 'gw-thruster') return -1;
  _stack.push({ id: cardId, kind: kind || 'patent' });
  // First thruster added auto-selects as the active thruster
  // so the rocket has a sensible default. The player can
  // re-pick another thruster from the stack modal later.
  if (!_activeThrusterId) {
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
  // Same auto-recover dance for the active prospector: if it was
  // pulled, fall to any remaining prospector card.
  if (removed && removed.id === _activeProspectorId) {
    _activeProspectorId = null;
    for (const s of _stack) {
      if (isProspectorCardId(s.id)) { _activeProspectorId = s.id; break; }
    }
  }
  persist();
  notify();
  return true;
}

export function clearStack() {
  if (!_stack.length && !_activeThrusterId && !_activeProspectorId && !_tankWater) return;
  _stack = [];
  _activeThrusterId = null;
  _activeProspectorId = null;
  _tankWater = 0;
  persist();
  notify();
}

export function getActiveThrusterId() {
  return _activeThrusterId;
}

export function setActiveThruster(id) {
  // Only allow picking a thruster that's actually in the stack
  // and is genuinely a thruster (or a missile-class robonaut
  // with its own thrust value - same idiom as the rest of the
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

// Prospector classification. A card "is a prospector" when its
// active face exposes any of the missile / raygun / buggy
// capability columns. Returns the kind ('missile'|'raygun'|'buggy')
// or null. Cards can declare more than one kind; we pick the
// first match in this priority order.
export function getProspectorKind(card) {
  if (!card) return null;
  const f = activeFace(card);
  const props = f.properties || [];
  for (const key of ['raygun', 'missile', 'buggy']) {
    if (props.some((p) => p.key === key && p.value)) return key;
  }
  return null;
}
function isProspectorCardId(id) {
  return !!getProspectorKind(PATENTS_BY_ID[id]);
}

export function getProspectorCards() {
  const out = [];
  for (const slot of _stack) {
    const card = PATENTS_BY_ID[slot.id];
    const kind = getProspectorKind(card);
    if (kind) out.push({ id: slot.id, card, kind });
  }
  return out;
}

export function getActiveProspectorId() { return _activeProspectorId; }

export function setActiveProspector(id) {
  // Must actually be in the stack AND classify as a prospector.
  if (!_stack.some((s) => s.id === id)) return false;
  if (!isProspectorCardId(id)) return false;
  _activeProspectorId = id;
  persist();
  notify();
  return true;
}

export function clearActiveProspector() {
  if (!_activeProspectorId) return false;
  _activeProspectorId = null;
  persist();
  notify();
  return true;
}

// Detailed view of the active prospector for the UI. Returns
// null when nothing is selected. `canActivate` reads the card's
// `requires` and checks them against the rest of the stack via
// the same supplier-grouped OR rule isRocketActive() uses.
export function getActiveProspectorStats() {
  const id = _activeProspectorId;
  if (!id) return null;
  const card = PATENTS_BY_ID[id];
  if (!card) return null;
  const kind = getProspectorKind(card);
  if (!kind) return null;
  const f = activeFace(card);
  const supplied = collectSupplied(id);
  const requires = Array.isArray(f.requires) ? f.requires : [];
  const groups = new Map();
  for (const r of requires) {
    const supplier = r.kind.split('-')[0];
    if (!groups.has(supplier)) groups.set(supplier, []);
    groups.get(supplier).push(r.kind);
  }
  const missing = [];
  for (const [supplier, kinds] of groups) {
    if (!kinds.some((k) => supplied.has(k))) missing.push(supplier);
  }
  return {
    id,
    kind,
    card,
    requires,
    suppliedKinds: [...supplied],
    missingSuppliers: missing,
    canActivate: missing.length === 0,
  };
}

// Build the set of support-kinds the rest of the stack supplies
// to the active card. Same logic as isRocketActive()'s supplier
// scan but scoped to a single excluded card.
function collectSupplied(excludeId) {
  const supplied = new Set();
  for (const slot of _stack) {
    if (slot.id === excludeId) continue;
    const c = PATENTS_BY_ID[slot.id];
    if (!c) continue;
    const supplies = (c.faces && c.faces.primary && c.faces.primary.supplies) || c.supplies || [];
    for (const k of supplies) supplied.add(k);
  }
  return supplied;
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
  // OR-alternatives - a thruster listing X / ∿ / 💣 reactor
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

// --------- Tank water (ship fuel) ---------

export function getTankWater() { return _tankWater; }
export function getTankMax()   { return TANK_MAX; }

export function setTankWater(n) {
  const v = Math.max(0, Math.min(TANK_MAX, Math.floor(Number(n) || 0)));
  if (v === _tankWater) return false;
  _tankWater = v;
  persist();
  notify();
  return true;
}

export function addFuel(delta = 1) {
  return setTankWater(_tankWater + (Number(delta) || 1));
}

export function removeFuel(delta = 1) {
  return setTankWater(_tankWater - (Number(delta) || 1));
}

// --------- Stack totals + thruster stats ---------

// Pulls the active face for any card in the stack, with a fallback
// to top-level fields for the older hand-written records that
// didn't carry a `faces` block.
function activeFace(card) {
  return (card && card.faces && card.faces.primary) || card || {};
}

// Total dry mass of the stack (no fuel) and minimum rad-hardness
// across the cards. min rad-hard is the ship's rad-hard limit -
// the weakest card sets the ceiling at a radhaz crossing.
export function getStackTotals() {
  let mass = 0;
  let minRad = null;
  let count = 0;
  for (const slot of _stack) {
    const card = PATENTS_BY_ID[slot.id];
    if (!card) continue;
    const f = activeFace(card);
    const m = (f.mass != null ? f.mass : card.mass) | 0;
    const r = (f.radHardness != null ? f.radHardness : card.radHardness);
    mass += m;
    if (r != null) minRad = (minRad == null) ? r : Math.min(minRad, r);
    count++;
  }
  return {
    count,
    dryMass: mass,
    fuel: _tankWater,
    wetMass: mass + _tankWater,
    minRadHard: minRad,
  };
}

// Compute the active thruster's "final" stats after applying every
// other stack card's thrustMod (additive) + fuelMod (multiplicative).
// Returns null if there is no active thruster.
//
// thrustMod is additive - Cermet NERVA contributes +3 thrust to the
// thruster it's paired with.
// fuelMod is multiplicative - values like 0.25 / 0.5 / 1.0 scale the
// base fuel-consumption-per-burn down (or leave it flat).
//
// Wet mass is exposed too so the UI can show "can it actually move":
// the rocket can move iff finalThrust ≥ wetMass (board-game equiv of
// having enough push to lift the loaded ship).
export function getActiveThrusterStats() {
  const id = _activeThrusterId;
  if (!id) return null;
  const card = PATENTS_BY_ID[id];
  if (!card) return null;
  const f = activeFace(card);
  let thrust = f.thrust != null ? f.thrust : card.thrust;
  let fuel   = f.fuel   != null ? f.fuel   : card.fuel;
  const isp  = f.isp    != null ? f.isp    : card.isp;
  if (thrust == null) return null;

  let baseThrust = thrust;
  let baseFuel = fuel;
  const modifiers = [];
  for (const slot of _stack) {
    if (slot.id === id) continue;
    const c = PATENTS_BY_ID[slot.id];
    if (!c) continue;
    const cf = activeFace(c);
    const tMod = cf.thrustMod;
    const fMod = cf.fuelMod;
    if (tMod != null && tMod !== 0) {
      thrust += tMod;
      modifiers.push({ from: c.name, kind: 'thrust', delta: tMod });
    }
    if (fMod != null && fMod !== 1 && fuel != null) {
      fuel *= fMod;
      modifiers.push({ from: c.name, kind: 'fuel', mult: fMod });
    }
  }
  const totals = getStackTotals();
  return {
    cardId: id,
    name: card.name,
    baseThrust,
    baseFuel,
    thrust,
    fuel,
    isp,
    modifiers,
    wetMass: totals.wetMass,
    dryMass: totals.dryMass,
    canLift: thrust >= totals.wetMass,
  };
}
