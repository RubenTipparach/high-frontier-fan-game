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

import { PATENTS_BY_ID, thermsRequired, thermsSupplied } from '../../data/patents.js';
import { CREW_BY_ID } from '../../data/crew.js';
import { SOLAR_ZONE_INFO } from '../../data/sites.js';
import { weightClassForMass } from '../../data/net-thrust-track.js';
// Fuel-step capacity comes from the shared graph (the same module the server
// uses), so the client readout + the server's move check never disagree.
import { blackStepsBetween } from '../../data/fuel-graph.js';
import { isOnline } from './online-mode.js';

// Crew can act as the ship's thruster OR its robonaut
// (prospector). Crew records have a different shape than patents
// (the thruster lives in a `thruster: {thrust, fuelPerBurn,
// afterburn, dirt}` block and the prospector is a `prospector`
// string), so synthesize a patent-like view of the chosen crew
// face. `faceKey` is the picked faction face carried on the slot.
function synthCrew(crew, faceKey) {
  const key = faceKey === 'secondary' ? 'secondary' : 'primary';
  const cf = (crew.faces && (crew.faces[key] || crew.faces.primary)) || {};
  const face = {
    name: cf.name,
    mass: cf.mass,
    radHardness: cf.radHardness,
    isru: cf.isru,
    // Map the crew prospector kind onto the patent property shape
    // getProspectorKind() scans (raygun / buggy / missile).
    properties: cf.prospector ? [{ key: cf.prospector, value: true }] : [],
  };
  if (cf.thruster) {
    face.thrust = cf.thruster.thrust;
    face.fuel = cf.thruster.fuelPerBurn;
    face.afterburn = cf.thruster.afterburn || 0;
  }
  const synth = {
    id: crew.id,
    name: cf.name || crew.id,
    type: 'crew',
    mass: cf.mass,
    radHardness: cf.radHardness,
    faces: { primary: face },
  };
  if (cf.thruster) synth.thrust = cf.thruster.thrust;
  return synth;
}

// Resolve a stack slot's card. Patents come straight from
// PATENTS_BY_ID; crew is synthesized from its chosen face so the
// thruster / prospector / mass reads below are uniform.
function cardForSlot(slot) {
  if (!slot || !slot.id) return null;
  const p = PATENTS_BY_ID[slot.id];
  if (p) return p;
  const crew = CREW_BY_ID[slot.id];
  return crew ? synthCrew(crew, slot.face) : null;
}

// Resolve a card by id, finding its slot (and thus crew face) in
// the current stack. Falls back to the primary crew face when the
// id isn't in the stack.
function cardById(id) {
  const p = PATENTS_BY_ID[id];
  if (p) return p;
  const slot = _stack.find((s) => s.id === id);
  if (slot) return cardForSlot(slot);
  const crew = CREW_BY_ID[id];
  return crew ? synthCrew(crew, 'primary') : null;
}

const STORAGE_KEY      = 'hf-sandbox-rocket';
const ACTIVE_KEY       = 'hf-sandbox-rocket-active-thruster';
const PROSPECTOR_KEY   = 'hf-sandbox-rocket-active-prospector';
const TANK_KEY         = 'hf-sandbox-rocket-tank';
const AQUA_KEY         = 'hf-sandbox-aqua';
// Starting aqua balance for a fresh sandbox profile. Aqua is the
// player's liquid economy unit - spend it to bypass hazard rolls
// (4 aqua / hazard) or transfer it 1:1 into the ship's water tank
// while parked at LEO. Refilled by future income flows (Stage 3+).
const AQUA_DEFAULT = 100;
// Per the published rules the wet-mass track caps at 32 (the
// "Max wet mass" position on the Net Thrust track). Maximum
// loadable water = 32 - drymass; we cap the absolute fuel value
// here at 32 so the +/- pickers / refuels can't push past the
// published ceiling even on a zero-drymass rocket.
const TANK_MAX = 32;

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

// Afterburn engagement (per turn). Engaging is a destructive
// action - it spends fuel immediately for a one-burn thrust
// boost, so the UI must confirm before flipping this. End-turn
// resets it (Stage 3+ will wire that into the turn-clock; for
// now the button is sticky until manually toggled off or fuel
// runs out).
const AFTERBURN_KEY = 'hf-sandbox-rocket-afterburn';
let _afterburnEngaged = (() => {
  try { return localStorage.getItem(AFTERBURN_KEY) === '1'; }
  catch { return false; }
})();

let _tankWater = (() => {
  try {
    const n = parseInt(localStorage.getItem(TANK_KEY) || '0', 10);
    return Number.isFinite(n) && n >= 0 ? Math.min(TANK_MAX, n) : 0;
  } catch { return 0; }
})();

// Aqua balance is a non-negative integer; persisted independently
// of the rest of the rocket state so a fresh sandbox profile (no
// stored key yet) seeds with the default starting amount rather
// than 0.
let _aqua = (() => {
  try {
    const raw = localStorage.getItem(AQUA_KEY);
    if (raw == null) return AQUA_DEFAULT;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : AQUA_DEFAULT;
  } catch { return AQUA_DEFAULT; }
})();

let _listeners = [];
// Aqua listeners are separate from the rocket-state listeners so
// the toolbar's aqua chip doesn't have to repaint every time the
// stack / tank changes.
let _aquaListeners = [];

function persist() {
  if (isOnline()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_stack));
    if (_activeThrusterId)   localStorage.setItem(ACTIVE_KEY,     _activeThrusterId);
    else                     localStorage.removeItem(ACTIVE_KEY);
    if (_activeProspectorId) localStorage.setItem(PROSPECTOR_KEY, _activeProspectorId);
    else                     localStorage.removeItem(PROSPECTOR_KEY);
    localStorage.setItem(AFTERBURN_KEY, _afterburnEngaged ? '1' : '0');
    localStorage.setItem(TANK_KEY, String(_tankWater));
  } catch { /* private mode */ }
}

function persistAqua() {
  try { localStorage.setItem(AQUA_KEY, String(_aqua)); } catch { /* private mode */ }
}
function notifyAqua() {
  for (const cb of _aquaListeners) {
    try { cb(); } catch (err) { console.error('aqua listener:', err); }
  }
}

function notify() {
  for (const cb of _listeners) {
    try { cb(); } catch (err) { console.error('rocket listener:', err); }
  }
}

// Deep-copy helper for hydration: structuredClone when available,
// JSON round-trip otherwise.
function _clone(x) {
  try { return structuredClone(x); }
  catch { return JSON.parse(JSON.stringify(x)); }
}

// Replace the in-memory rocket state from a server snapshot. Does
// NOT touch the aqua var (aqua has its own setter / listener and is
// not part of the multiplayer snapshot here).
export function hydrateRocket({
  stack = [],
  activeThrusterId = null,
  activeProspectorId = null,
  tank = 0,
  afterburnEngaged = false,
} = {}) {
  _stack = Array.isArray(stack) ? _clone(stack) : [];
  _activeThrusterId = activeThrusterId;
  _activeProspectorId = activeProspectorId;
  _tankWater = tank;
  _afterburnEngaged = !!afterburnEngaged;
  notify();
}

export function getRocketStack() {
  return _stack.slice();
}

export function isInRocket(id) {
  return _stack.some((s) => s.id === id);
}

export function addToStack(cardId, kind, face) {
  if (!cardId) return -1;
  // Expansion cards (currently GW thrusters) are previewable in
  // the library but cannot be flown until the expansion ships.
  // Refuse silently here - the calling UI greys the +/grab
  // buttons out on inspection so this is a defence-in-depth
  // check, not the only gate.
  const card = PATENTS_BY_ID[cardId];
  if (card && card.type === 'gw-thruster') return -1;
  const slot = { id: cardId, kind: kind || 'patent' };
  // Crew carries its picked faction face; preserve it so the
  // right face's thruster / prospector is in play.
  if (face === 'secondary') slot.face = 'secondary';
  _stack.push(slot);
  // First thruster added auto-selects as the active thruster
  // so the rocket has a sensible default. The player can
  // re-pick another thruster from the stack modal later. Crew
  // that doubles as a thruster qualifies too.
  if (!_activeThrusterId) {
    if (slotIsThruster(slot)) _activeThrusterId = cardId;
  }
  // Safety net: a freshly-added card raises dry mass and lowers
  // the rocket's effective wet-mass cap (TANK_MAX − dry). Clip
  // the tank to the new ceiling so the wet-mass total never
  // exceeds the cap. The boost-commit caller in browse.js shows
  // a confirm modal beforehand so the player isn't surprised by
  // the loss, but this enforces the invariant for any other
  // call site too.
  const newDry = stackDryMass();
  const cap = Math.max(0, TANK_MAX - newDry);
  if (_tankWater > cap) _tankWater = cap;
  persist();
  notify();
  return _stack.length - 1;
}
// Compute dry mass from the current stack. Mirrors the math in
// getStackTotals() but kept tight + non-allocating so the
// addToStack safety clip stays cheap.
function stackDryMass() {
  let mass = 0;
  for (const slot of _stack) {
    const c = cardForSlot(slot);
    if (!c) continue;
    const f = (c.faces && c.faces.primary) || c;
    mass += ((f.mass != null ? f.mass : c.mass) | 0);
  }
  return mass;
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
      if (slotIsThruster(s)) {
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
  const slot = _stack.find((s) => s.id === id);
  if (!slot) return false;
  if (!slotIsThruster(slot)) return false;
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
  return !!getProspectorKind(cardById(id));
}

export function getProspectorCards() {
  const out = [];
  for (const slot of _stack) {
    const card = cardForSlot(slot);
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
  // (resolution via cardById -> crew prospector faces qualify.)
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
  const card = cardById(id);
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
  // The prospector's operating chain (itself + the reactor/generator it
  // needs) must be cooled too, same as the thruster chain.
  const slot = _stack.find((s) => s.id === id);
  const therm = chainThermBalance(id, installedFace(slot));
  if (!therm.ok) missing.push('thermostat');
  return {
    id,
    kind,
    card,
    requires,
    suppliedKinds: [...supplied],
    missingSuppliers: missing,
    therm,
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
    const c = cardForSlot(slot);
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

// Therms the stack's radiators can dissipate (active/installed face of
// each radiator). The shared cooling pool every operating chain draws on.
function radiatorThermSupply() {
  let supply = 0;
  for (const slot of _stack) {
    const c = cardForSlot(slot);
    if (!c || c.type !== 'radiator') continue;
    supply += thermsSupplied(c, installedFace(slot));
  }
  return supply;
}

// Therm demand of operating `consumer` (its own heat) PLUS the heat of
// the reactor/generator chain that powers it. Active-chain only: only the
// power sources the consumer actually needs are counted, and within an
// OR-group (e.g. X / ∿ / 💣 reactor) the lowest-heat matching supplier is
// assumed in use, so a spare hot reactor sitting idle doesn't block.
// Supports that aren't power sources (sail, beam, aerobrake) carry no heat.
function chainThermDemand(consumerId, consumerFace) {
  let demand = thermsRequired(consumerFace);
  const groups = new Map(); // supplier prefix -> Set(kinds)
  for (const r of (consumerFace.requires || [])) {
    const pre = String(r.kind).split('-')[0];
    if (pre !== 'reactor' && pre !== 'gen') continue;
    if (!groups.has(pre)) groups.set(pre, new Set());
    groups.get(pre).add(r.kind);
  }
  for (const [, kinds] of groups) {
    let best = null;
    for (const slot of _stack) {
      if (slot.id === consumerId) continue;
      const c = cardForSlot(slot);
      if (!c) continue;
      const f = installedFace(slot);
      const sup = (f && f.supplies) || c.supplies || [];
      if (!sup.some((k) => kinds.has(k))) continue;
      const t = thermsRequired(f);
      if (best === null || t < best) best = t;
    }
    if (best !== null) demand += best;
  }
  return demand;
}

// Is `consumerId`'s operating chain thermally balanced (radiators cover
// the chain's heat)? Returns { ok, demand, supply }.
function chainThermBalance(consumerId, consumerFace) {
  const demand = chainThermDemand(consumerId, consumerFace);
  const supply = radiatorThermSupply();
  return { ok: demand <= supply, demand, supply };
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
  const thrusters = _stack.filter((s) => slotIsThruster(s));
  if (!thrusters.length) {
    return { active: false, reason: 'no thruster in the stack', missing: [] };
  }
  if (!_activeThrusterId) {
    return { active: false, reason: 'no active thruster selected', missing: [] };
  }
  const active = cardById(_activeThrusterId);
  if (!active) {
    return { active: false, reason: 'active thruster missing', missing: [] };
  }

  // What does the REST of the stack supply? The active
  // thruster's supports are validated against those supplies.
  const others = _stack.filter((s) => s.id !== _activeThrusterId);
  const supplied = new Set();
  for (const s of others) {
    const c = cardForSlot(s);
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

  // Thermal balance: the active thruster's heat plus the heat of the
  // reactor/generator powering it must be dissipated by the stack's
  // radiators, the same hard gate as the reactor-type support above.
  const activeSlot = _stack.find((s) => s.id === _activeThrusterId);
  const therm = chainThermBalance(_activeThrusterId, installedFace(activeSlot));
  if (!therm.ok) {
    missing.push(`${active.name} runs ${therm.demand}🌡️ but radiators supply ${therm.supply}🌡️`);
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

// Pure-function version of the thruster-active check used by
// isRocketActive(), but takes an arbitrary stack array of
// { id, kind } slots. Returns the list of thruster slot indices
// whose `requires` are satisfied by the rest of the stack's
// supplies (with the same OR-by-supplier-prefix rule
// isRocketActive uses, so reactor-pulse / reactor-fusion are
// alternatives within a single reactor group).
//
// Used by Outpost -> Rocket conversion: an outpost can only
// lift back into a rocket when it carries at least one
// functional thruster (i.e. one whose supports are still in
// the same stack). Empty cargo holds + bare refineries can't
// fly.
export function findFunctionalThrusters(stack) {
  if (!Array.isArray(stack) || !stack.length) return [];
  const out = [];
  for (let i = 0; i < stack.length; i++) {
    const c = cardForSlot(stack[i]);
    if (!c) continue;
    if (!slotIsThruster(stack[i])) continue;
    const f = installedFace(stack[i]);
    const reqs = Array.isArray(f.requires) ? f.requires : (c.requires || []);
    if (!reqs.length) { out.push({ index: i, id: stack[i].id, card: c }); continue; }
    // Build supplies set from the REST of the stack.
    const supplied = new Set();
    for (let j = 0; j < stack.length; j++) {
      if (j === i) continue;
      const o = cardForSlot(stack[j]);
      if (!o) continue;
      const of = (o.faces && o.faces.primary) || o;
      const sup = Array.isArray(of.supplies) ? of.supplies : (o.supplies || []);
      for (const k of sup) supplied.add(k);
    }
    // Group requires by supplier prefix (same OR rule).
    const groups = new Map();
    for (const r of reqs) {
      const supplier = String(r.kind || '').split('-')[0];
      if (!groups.has(supplier)) groups.set(supplier, []);
      groups.get(supplier).push(r.kind);
    }
    let ok = true;
    for (const [, kinds] of groups) {
      if (!kinds.some((k) => supplied.has(k))) { ok = false; break; }
    }
    if (ok) out.push({ index: i, id: stack[i].id, card: c });
  }
  return out;
}

// --------- Tank water (ship fuel) ---------

export function getTankWater() { return _tankWater; }
// TANK_MAX is the WET-MASS cap. The actual water ceiling is
// TANK_MAX - dryMass because dry mass already takes up wet-mass
// capacity. Old callers that read getTankMax() as "max water"
// see the wrong number when the stack has mass; getWaterCap()
// is the honest reading.
export function getTankMax()   { return TANK_MAX; }
export function getWaterCap() {
  return Math.max(0, TANK_MAX - stackDryMass());
}

export function setTankWater(n) {
  // Clamp against the live wet-mass cap so water + dry can
  // never exceed TANK_MAX. Adding cards shrinks this ceiling
  // automatically through stackDryMass(). The tank is NOT floored: a burn
  // walks the wet chit down the fuel-step ladder and can leave a sub-1
  // remainder (fractional water), which we preserve (rounded to kill drift).
  const cap = getWaterCap();
  const v = Math.max(0, Math.min(cap, Math.round((Number(n) || 0) * 1e6) / 1e6));
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

// --------- Aqua (sandbox currency) ---------
//
// Aqua is the player's liquid economy unit. Two sinks today:
//   1. Bypass hazard rolls at 4 aqua per hazard along a move route
//      (browse.js#moveRocket gates the spend behind a confirm).
//   2. Convert 1:1 into water at LEO via the fuel-tank modal.
// Starting balance is AQUA_DEFAULT; future income flows
// (Stage 3+) will pay aqua at end-of-round from factories.

export function getAqua() { return _aqua; }

export function setAqua(n) {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  if (v === _aqua) return false;
  _aqua = v;
  persistAqua();
  notifyAqua();
  return true;
}

export function addAqua(delta = 1) {
  return setAqua(_aqua + (Number(delta) || 1));
}

// Spend a fixed cost. Returns true on success, false if the
// balance can't cover it (no partial spends).
export function spendAqua(cost) {
  const c = Math.max(0, Math.floor(Number(cost) || 0));
  if (c > _aqua) return false;
  _aqua -= c;
  persistAqua();
  notifyAqua();
  return true;
}

export function onAquaChange(cb) {
  _aquaListeners.push(cb);
  return () => { _aquaListeners = _aquaListeners.filter((x) => x !== cb); };
}

// Reset aqua to the AQUA_DEFAULT starting balance. Used by the
// sandbox reset flow and the Card Market toggle reset so the
// player starts from a clean economy.
export function resetAqua() {
  if (_aqua === AQUA_DEFAULT) return false;
  _aqua = AQUA_DEFAULT;
  persistAqua();
  notifyAqua();
  return true;
}

// --------- Stack totals + thruster stats ---------

// Pulls the active face for any card in the stack, with a fallback
// to top-level fields for the older hand-written records that
// didn't carry a `faces` block.
function activeFace(card) {
  return (card && card.faces && card.faces.primary) || card || {};
}

// The face a stack slot is INSTALLED on (Tier-1 primary by default,
// Tier-2 secondary when flipped). Robonauts used as thrusters and
// dark-side thruster tech carry their thrust / solar on the secondary
// face, so thrust stats must read the installed face, not just
// primary. Crew slots resolve face-specific already via cardForSlot.
function installedFace(slot) {
  const c = cardForSlot(slot);
  if (!c) return {};
  if (c.faces) {
    const key = (slot && slot.face === 'secondary' && c.faces.secondary) ? 'secondary' : 'primary';
    return c.faces[key] || c.faces.primary || c;
  }
  return c;
}

// A stack slot can serve as a thruster if it's a thruster card OR its
// INSTALLED face carries a thrust value (robonauts whose beam/laser
// thruster lives on the Tier-2 face, e.g. Rock Splitter's MagBeam).
function slotIsThruster(slot) {
  const c = cardForSlot(slot);
  if (!c) return false;
  if (c.type === 'thruster') return true;
  const f = installedFace(slot);
  return !!(f && f.thrust != null);
}

// Does this face carry the Solar capability badge? (Sails, photon
// drives, solar moths - and solar generators.)
function faceHasSolar(face) {
  return !!(face && Array.isArray(face.properties)
    && face.properties.some((p) => p.key === 'solar' && p.value));
}

// The rocket's current heliocentric zone, pushed in from browse.js
// whenever the ship moves. Drives the solar-power thrust modifier on
// solar-driven thrusters. null = unknown (treated as no modifier).
let _solarZone = null;
export function setSolarZone(zone) {
  const z = zone || null;
  if (z === _solarZone) return;
  _solarZone = z;
  notify(); // thrust changed -> refresh fuel strip / readout / gates
}
export function getSolarZone() { return _solarZone; }

// Total dry mass of the stack (no fuel) and minimum rad-hardness
// across the cards. min rad-hard is the ship's rad-hard limit -
// the weakest card sets the ceiling at a radhaz crossing.
export function getStackTotals() {
  let mass = 0;
  let minRad = null;
  let count = 0;
  for (const slot of _stack) {
    const card = cardForSlot(slot);
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
  const slot = _stack.find((s) => s.id === id);
  const card = (slot ? cardForSlot(slot) : cardById(id));
  if (!card) return null;
  // Use the INSTALLED face so a robonaut (or dark-side thruster) flipped
  // to its thrust/solar face drives the stats, not just Tier-1.
  const f = slot ? installedFace(slot) : activeFace(card);
  let thrust = f.thrust != null ? f.thrust : card.thrust;
  let fuel   = f.fuel   != null ? f.fuel   : card.fuel;
  const isp  = f.isp    != null ? f.isp    : card.isp;
  if (thrust == null) return null;

  let baseThrust = thrust;
  let baseFuel = fuel;
  const modifiers = [];
  // A reactor/generator's thrust + fuel modifiers only count when it
  // actually powers THIS thruster, i.e. it supplies a kind the active
  // thruster requires (it sits in the thruster's support chain). A power
  // source wired to some other card (say a generator feeding a robonaut's
  // gen-electric) must not shift the thruster's stats, and a self-powered
  // thruster (a solar moth, which requires nothing) takes no stack thrust
  // modifiers at all. Same supply/require match isRocketActive() gates
  // activation on, so "modified" stats and "can it fly" stay consistent.
  const reqKinds = new Set((f.requires || []).map((r) => (r && r.kind) || r));
  for (const slot of _stack) {
    if (slot.id === id) continue;
    const c = cardForSlot(slot);
    if (!c) continue;
    const cf = installedFace(slot);
    const cSupplies = (c.faces && c.faces.primary && c.faces.primary.supplies) || c.supplies || [];
    if (!cSupplies.some((k) => reqKinds.has(k))) continue;
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
  // Weight-class modifier from the published Net Thrust track, keyed off
  // wet mass. weightClassForMass (data/net-thrust-track.js) is the single
  // source of truth the fuel-strip renderer also reads, so the thrust
  // triangle and the strip can never disagree on the band (WISP +2 / PROBE
  // +1 / SCOUT 0 / TRANSPORT -1 / TUG -2, in doubling mass brackets).
  const wm = totals.wetMass;
  const wc = weightClassForMass(wm);
  const wcMod = wc.netThrust;
  const wcClass = wc.id;
  if (wcMod !== 0) {
    thrust += wcMod;
    modifiers.push({ from: `${wcClass} weight class`, kind: 'thrust', delta: wcMod });
  }
  // Afterburn engaged: applies the active face's afterburn bonus
  // (numeric in the spreadsheet). One-shot per turn; UI confirms
  // before engaging because it spends fuel up front.
  if (_afterburnEngaged && Number.isFinite(f.afterburn) && f.afterburn) {
    thrust += f.afterburn;
    modifiers.push({ from: 'Afterburn', kind: 'thrust', delta: f.afterburn });
  }
  // Solar-power modifier (Net Thrust track: "modified by ... solar
  // power"). A thruster is solar-driven when its active face is solar
  // (sail / photon / solar moth) OR it runs on electric power from a
  // solar generator in the stack (requires gen-electric and a solar
  // generator supplies it). Solar-driven thrust shifts by the rocket's
  // current zone modifier (Mercury +2 .. Saturn -4, Uranus -5); beyond
  // Uranus (Neptune outward, solar=null) the solar drive goes inert.
  let solarDriven = faceHasSolar(f);
  let solarSource = solarDriven ? card.name : null;
  if (!solarDriven && (f.requires || []).some((r) => (r.kind || r) === 'gen-electric')) {
    for (const slot of _stack) {
      if (slot.id === id) continue;
      const c = cardForSlot(slot);
      if (!c) continue;
      const cf = installedFace(slot);
      if (faceHasSolar(cf) && (cf.supplies || []).includes('gen-electric')) {
        solarDriven = true;
        solarSource = c.name;
        break;
      }
    }
  }
  let solarMod = 0;
  let solarDead = false;
  if (solarDriven) {
    const info = _solarZone ? SOLAR_ZONE_INFO[_solarZone] : null;
    const z = info ? info.solar : 0;
    if (z === null) {
      solarDead = true;
      if (thrust !== 0) modifiers.push({ from: `${_solarZone}: no sunlight`, kind: 'thrust', delta: -thrust });
      thrust = 0;
    } else if (z !== 0) {
      solarMod = z;
      thrust += z;
      modifiers.push({ from: `${_solarZone} solar`, kind: 'thrust', delta: z });
    }
  }
  if (thrust < 0) thrust = 0;
  // Fuel-strip burns: how many whole burns the current tank affords,
  // counting fuel steps along the net-thrust ladder from wet down to dry
  // (non-linear across weight classes) and dividing by the per-burn cost.
  const fuelSteps = blackStepsBetween(totals.dryMass, totals.wetMass);
  const burnsAvail = (fuel != null && fuel > 0) ? Math.floor(fuelSteps / fuel) : null;
  return {
    cardId: id,
    name: card.name,
    baseThrust,
    baseFuel,
    thrust,
    fuel,
    isp,
    fuelSteps,
    burnsAvailable: burnsAvail,
    modifiers,
    weightClass:   wcClass,
    weightClassMod: wcMod,
    afterburnAvailable: Number.isFinite(f.afterburn) && f.afterburn > 0,
    afterburnEngaged:   _afterburnEngaged,
    solarDriven,
    solarSource,
    solarZone: _solarZone,
    solarMod,
    solarDead,
    wetMass: totals.wetMass,
    dryMass: totals.dryMass,
    canLift: thrust >= totals.wetMass,
  };
}

// Afterburn toggle. Engaging spends `afterburnCost` water now
// (the rulebook calls this the "Afterburn (+ thrust for 2 fuel
// steps shown)" cost), so the caller must confirm. Returns the
// new engaged-state on success, or null when the rocket can't
// engage (no active thruster, no afterburn capability, or no
// water to spend).
export function isAfterburnEngaged() { return _afterburnEngaged; }
export function setAfterburn(engaged) {
  _afterburnEngaged = !!engaged;
  persist();
  notify();
  return _afterburnEngaged;
}
