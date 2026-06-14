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
import { resolveSupportChain, resolveCoolingAcross } from '../../data/support-chain.js';
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
    face.dirt = !!cf.thruster.dirt;   // crew dirt thruster (grey fuel)
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
const TANK_GRADE_KEY   = 'hf-sandbox-rocket-tank-grade';
const WIRING_KEY       = 'hf-sandbox-rocket-wiring';
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

// Afterburn's Open-Cycle Cooling is a TEMPORARY radiator card the engaged
// thruster vents through for the turn (0 mass, 10 rad-hardness, 1 Therm). It
// behaves like any other radiator: it SUPPLIES the thermostat support chip AND
// adds its 1 Therm to the rocket-wide cooling pool, so a card whose only cooling
// is the open-cycle vent can pick it up as a support. It lives only in the
// support-chain view (never in the real _stack), so it adds no mass / weight
// class and is cleaned up when afterburn disengages at end of turn.
export const OPEN_CYCLE_CARD_ID = 'afterburn-open-cycle';
export const OPEN_CYCLE_CARD = {
  id: OPEN_CYCLE_CARD_ID,
  name: 'Open-Cycle Cooling',
  type: 'radiator',
  mass: 0,
  radHardness: 10,
  spectralType: 'C',
  therms: 1,
  supplies: ['thermostat'],
  requires: [],
  synthetic: true,
  faces: {
    primary: {
      name: 'Open-Cycle Cooling',
      type: 'radiator',
      supplies: ['thermostat'],
      requires: [],
      therms: 1,
      Therms: 1,
      properties: [],
    },
  },
};
// Resolver-shaped descriptor (the chainCardsFromStack() card shape).
function openCycleChainCard() {
  return {
    id: OPEN_CYCLE_CARD_ID,
    type: 'radiator',
    supplies: ['thermostat'],
    requires: [],
    thrustMod: undefined,
    fuelMod: undefined,
    therms: 1,
  };
}
// The Open-Cycle vent exists only while afterburn is engaged on a thruster that
// actually has an afterburn rating - the exact same gate as the +1 net thrust,
// so the temporary radiator and the thrust gain appear and vanish together.
function afterburnContributes() {
  if (!_afterburnEngaged || !_activeThrusterId) return false;
  const slot = _stack.find((s) => s.id === _activeThrusterId);
  if (!slot) return false;
  const f = installedFace(slot);
  return !!(f && Number(f.afterburn) > 0);
}

// Player support-chain wiring: { consumerId: { kind: supplierId } }. Names
// which supplier card powers each consumer for each support kind, the single
// source the resolver (data/support-chain.js) reads on BOTH the thrust/fuel
// path and the visualizer. Empty by default (first-match); a player only wires
// when a consumer has more than one candidate supplier. Online it is hydrated
// from the server snapshot; solo it persists to localStorage.
let _wiring = (() => {
  try {
    const raw = localStorage.getItem(WIRING_KEY);
    const o = raw ? JSON.parse(raw) : {};
    return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
  } catch { return {}; }
})();

let _tankWater = (() => {
  try {
    const n = parseInt(localStorage.getItem(TANK_KEY) || '0', 10);
    return Number.isFinite(n) && n >= 0 ? Math.min(TANK_MAX, n) : 0;
  } catch { return 0; }
})();

// Fuel grade in the tank: 'water' (blue) or 'dirt' (grey). Water and dirt
// can't mix; a dirt thruster burns dirt, a water thruster burns water.
let _tankGrade = (() => {
  try { return localStorage.getItem(TANK_GRADE_KEY) === 'dirt' ? 'dirt' : 'water'; }
  catch { return 'water'; }
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
    localStorage.setItem(TANK_GRADE_KEY, _tankGrade === 'dirt' ? 'dirt' : 'water');
    localStorage.setItem(WIRING_KEY, JSON.stringify(_wiring || {}));
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
  tankGrade = 'water',
  afterburnEngaged = false,
  wiring = {},
} = {}) {
  _stack = Array.isArray(stack) ? _clone(stack) : [];
  _activeThrusterId = activeThrusterId;
  _activeProspectorId = activeProspectorId;
  _tankWater = tank;
  _tankGrade = tankGrade === 'dirt' ? 'dirt' : 'water';
  _afterburnEngaged = !!afterburnEngaged;
  _wiring = (wiring && typeof wiring === 'object' && !Array.isArray(wiring)) ? _clone(wiring) : {};
  notify();
}

// Player support-chain wiring accessors. getWiring returns a copy; setWiring
// replaces the map, pruning any entry whose consumer or supplier is no longer
// in the stack (the resolver would ignore those anyway, but a tidy map keeps
// the submitted op and the visualizer honest), then persists + notifies so the
// rocket stats and the chain visualizer re-resolve against the new wiring.
export function getWiring() { return _clone(_wiring || {}); }

export function setWiring(map) {
  const raw = (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
  const ids = new Set(_stack.map((s) => s.id));
  const norm = {};
  for (const consumerId of Object.keys(raw)) {
    if (!ids.has(consumerId)) continue;
    const byKind = raw[consumerId];
    if (!byKind || typeof byKind !== 'object') continue;
    const clean = {};
    for (const kind of Object.keys(byKind)) {
      const supplierId = String(byKind[kind] || '');
      if (supplierId && supplierId !== consumerId && ids.has(supplierId)) clean[String(kind)] = supplierId;
    }
    if (Object.keys(clean).length) norm[consumerId] = clean;
  }
  _wiring = norm;
  persist();
  notify();
  return _clone(_wiring);
}

export function getRocketStack() {
  return _stack.slice();
}

export function isInRocket(id) {
  return _stack.some((s) => s.id === id);
}

export function addToStack(cardId, kind, face, radSide) {
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
  // Radiators deploy on a locked light/heavy side, chosen at construction.
  // Default to heavy (max cooling) when the caller didn't pass one.
  if (card && card.type === 'radiator') {
    slot.radSide = radSide === 'light' ? 'light' : 'heavy';
  }
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

// Flip a radiator slot's deployed light/heavy side. Normal play LOCKS the side
// at construction; this is the ONE exception - radiation damage degrades a
// heavy radiator down to its light side instead of destroying it. Returns true
// when a radiator slot actually changed side.
export function setRadiatorSide(id, side) {
  const slot = _stack.find((s) => s.id === id);
  if (!slot) return false;
  const card = cardById(id);
  if (!card || card.type !== 'radiator') return false;
  const next = side === 'light' ? 'light' : 'heavy';
  if (slot.radSide === next) return false;
  slot.radSide = next;
  persist();
  notify();
  return true;
}

// Compute dry mass from the current stack. Mirrors the math in
// getStackTotals() but kept tight + non-allocating so the
// addToStack safety clip stays cheap.
function stackDryMass() {
  let mass = 0;
  for (const slot of _stack) {
    const c = cardForSlot(slot);
    if (!c) continue;
    const f = installedFace(slot);
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
// `face` is the INSTALLED face to read the prospector columns off; pass it for
// any stack slot so a flipped (black-side) card reports its real prospector
// kind. Defaults to the primary face for a bare card with no slot context.
export function getProspectorKind(card, face) {
  if (!card) return null;
  const f = face || activeFace(card);
  const props = f.properties || [];
  for (const key of ['raygun', 'missile', 'buggy']) {
    if (props.some((p) => p.key === key && p.value)) return key;
  }
  return null;
}
function isProspectorCardId(id) {
  const slot = _stack.find((s) => s.id === id);
  const card = slot ? cardForSlot(slot) : cardById(id);
  return !!getProspectorKind(card, slot ? installedFace(slot) : undefined);
}

export function getProspectorCards() {
  const out = [];
  for (const slot of _stack) {
    const card = cardForSlot(slot);
    const kind = getProspectorKind(card, installedFace(slot));
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
  const slot = _stack.find((s) => s.id === id);
  const card = slot ? cardForSlot(slot) : cardById(id);
  if (!card) return null;
  const f = slot ? installedFace(slot) : activeFace(card);
  const kind = getProspectorKind(card, f);
  if (!kind) return null;
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
  // needs) must be cooled too, but the active THRUSTER has first claim on the
  // radiators: the prospector reserves its reactor's dedicated cooling from
  // whatever the thruster chain leaves, and reads inactive if it can't. A
  // reactor shared with the thruster chain is cooled once.
  const { cool, idx } = coolingAllocation();
  const pc = idx.prospector >= 0 ? cool.perChain[idx.prospector] : null;
  const therm = pc
    ? { ok: pc.coolingOk, demand: pc.reactorDemand + pc.nonReactorHeat, supply: cool.radiatorTotal }
    : { ok: true, demand: 0, supply: cool.radiatorTotal };
  if (!therm.ok) missing.push('thermostat');
  // ISRU + display name come off the INSTALLED face. The white and black
  // sides are different techs with different ISRU ratings (e.g. Flywheel
  // Tractor ISRU 3 flips to Electrophoretic Sandworm ISRU 1), so reading
  // faces.primary here mis-gated prospect / refuel for a flipped card.
  // Patents carry ISRU in face.properties; crew carry it on the face itself
  // (same split the server's prospectorFace handles).
  const isruProp = (f.properties || []).find((p) => p && p.key === 'isru');
  const isruRaw = isruProp
    ? (typeof isruProp.value === 'number' ? isruProp.value : parseInt(isruProp.value, 10))
    : Number(f && f.isru);
  return {
    id,
    kind,
    card,
    name: (f && f.name) || card.name || id,
    isru: Number.isFinite(isruRaw) ? isruRaw : 0,
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
    const f = installedFace(slot);
    const supplies = (f && f.supplies) || [];
    for (const k of supplies) supplied.add(k);
  }
  // Afterburn's Open-Cycle Cooling supplies the thermostat chip for the turn.
  if (afterburnContributes()) supplied.add('thermostat');
  return supplied;
}

export function onRocketChange(cb) {
  _listeners.push(cb);
  return () => { _listeners = _listeners.filter((x) => x !== cb); };
}

// Dedicated reactor cooling across the active thruster chain AND the active
// prospector chain, sharing the one stack-wide radiator pool. The active
// thruster has FIRST claim (user decision: prioritize thruster); the prospector
// reserves its reactor's dedicated therms from the remainder and goes inactive
// if it can't. A reactor that powers both chains is cooled once. Returns the
// resolveCoolingAcross output plus the per-chain index of each active root, so
// the cooling gate and the visualizer read the SAME allocation. Inactive
// thrusters / inactive robonauts / refineries are never roots here, so their
// supports are never checked - only the two active cards are.
function coolingAllocation() {
  const cards = chainCardsFromStack();
  const orders = [];
  const idx = { thruster: -1, prospector: -1 };
  if (_activeThrusterId && cards.some((c) => c.id === _activeThrusterId)) {
    idx.thruster = orders.length;
    orders.push(resolveSupportChain({ cards, activeId: _activeThrusterId, wiring: _wiring }).order);
  }
  if (_activeProspectorId && cards.some((c) => c.id === _activeProspectorId)) {
    if (_activeProspectorId === _activeThrusterId) {
      idx.prospector = idx.thruster; // dual-role: one chain serves both
    } else {
      idx.prospector = orders.length;
      orders.push(resolveSupportChain({ cards, activeId: _activeProspectorId, wiring: _wiring }).order);
    }
  }
  // Afterburn's Open-Cycle cooling rides in as a temporary radiator card (its
  // +1 Therm is already in `cards`, so radiatorTotal picks it up automatically).
  return { cool: resolveCoolingAcross({ cards, orders }), idx };
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
    const f = installedFace(s);
    const supplies = (f && f.supplies) || [];
    for (const k of supplies) supplied.add(k);
  }
  // Afterburn's Open-Cycle Cooling supplies the thermostat chip for the turn.
  if (afterburnContributes()) supplied.add('thermostat');

  // Group the active thruster's requires by supplier prefix
  // (reactor-* / gen-* / etc.) so same-supplier kinds read as
  // OR-alternatives - a thruster listing X / ∿ / 💣 reactor
  // is satisfied by ANY reactor that supplies one of those. Read the
  // INSTALLED face so a thruster flipped to its black side asks for that
  // face's supports (e.g. Pulsed Inductive's gen-radioisotope vs the
  // Dual-Stage 4-Grid black side's gen-electric).
  const activeSlot = _stack.find((s) => s.id === _activeThrusterId);
  const af = installedFace(activeSlot);
  const reqs = (af && af.requires) || active.requires || [];
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

  // Cooling (rule 3, data/support-chain.js): each reactor in the chain reserves
  // its OWN dedicated radiator therms; the thruster plus any generators draw the
  // shared remainder. Stricter than a single shared pool (two reactors can't
  // split one radiator), matching the published dedicated-cooling rule. For the
  // common single-reactor stack this is the same verdict as before.
  const cool = resolveSupportChain({ cards: chainCardsFromStack(), activeId: _activeThrusterId, wiring: _wiring });
  if (!cool.coolingOk) {
    const hot = cool.reactorCooling.find((r) => !r.ok);
    if (hot) {
      const rc = cardById(hot.reactorId);
      missing.push(`${rc ? rc.name : 'A reactor'} needs ${hot.demand}🌡️ of its own radiator cooling`);
    } else {
      missing.push(`${active.name} and its generators run ${cool.nonReactorHeat}🌡️ but only ${cool.radiatorRemaining}🌡️ of radiator is free after the reactors`);
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
      const of = installedFace(stack[j]);
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

// --------- Fuel grade (water blue / dirt grey) ---------

export function getTankGrade() { return _tankGrade === 'dirt' ? 'dirt' : 'water'; }
export function setTankGrade(grade) {
  const g = grade === 'dirt' ? 'dirt' : 'water';
  if (g === _tankGrade) return false;
  _tankGrade = g;
  persist();
  notify();
  return true;
}

// A thruster face burns DIRT (grey) when its card fuelType is Dirt or its
// crew rocket is flagged dirt (mirror of engine.js#faceBurnsDirt).
export function faceBurnsDirt(face) {
  return !!(face && (face.fuelType === 'Dirt' || face.dirt === true));
}

// Dirt-load capability of the WHOLE stack (mirror of the server's
// applyDirtRefuel gates). Loading dirt rides the player-aid rule: "any
// ISRU card at a Factory or Site" (LEO tops up freely) - NOT the active
// thruster; activating the dirt burner matters only when BURNING. Returns
// { burner, hasIsru }: burner is 'card' (fills to cap) when any dirt-
// burning patent face is aboard, 'crew' (1 FT per turn) when only a crew
// dirt rocket is, null when none; hasIsru is true when any installed face
// carries an ISRU rating (rating 0 counts - the rig exists).
export function getDirtCapability() {
  let burner = null;
  let hasIsru = false;
  for (const slot of _stack) {
    const f = installedFace(slot);
    if (faceBurnsDirt(f)) {
      if (!CREW_BY_ID[slot.id]) burner = 'card';
      else if (!burner) burner = 'crew';
    }
    if ((f.properties || []).some((pr) => pr && pr.key === 'isru')
        || (f.isru != null && Number.isFinite(Number(f.isru)))) hasIsru = true;
  }
  return { burner, hasIsru };
}

// The fuel grade the active thruster needs ('dirt' or 'water'); 'water' when
// there is no active thruster. Drives the tank-grade gate + grey UI.
export function getActiveFuelGrade() {
  const stats = getActiveThrusterStats();
  return stats && stats.isDirt ? 'dirt' : 'water';
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
function faceHasPush(face) {
  return !!(face && Array.isArray(face.properties)
    && face.properties.some((p) => p.key === 'push' && p.value));
}

// Powersat (ESA faction privilege): when set, the local player gives +1
// thrust to a push-icon thruster. Pushed in from browse.js off my faction so
// getActiveThrusterStats matches the server's activeNetThrust (byte-parity:
// a move the client allows must not be rejected for a different thrust).
let _hasPowersat = false;
export function setHasPowersat(on) {
  const v = !!on;
  if (v === _hasPowersat) return;
  _hasPowersat = v;
  notify();
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
    const f = installedFace(slot);
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

// Normalise the current stack into the support-chain resolver's card shape
// (data/support-chain.js). Everything (supplies / requires / thrustMod /
// fuelMod / therms) reads the INSTALLED face, so a flipped dark-side card
// reports its own stats - its black-side supplies AND requires drive the chain,
// not the white-side ones. `therms` is the cooling a radiator SUPPLIES,
// otherwise the heat the card GENERATES.
function chainCardsFromStack() {
  const cards = _stack.map((slot) => {
    const card = cardForSlot(slot);
    const f = installedFace(slot);
    const type = card ? card.type : slot.kind;
    return {
      id: slot.id,
      type,
      supplies: (f && f.supplies) || (card && card.supplies) || [],
      requires: (f && f.requires) || (card && card.requires) || [],
      thrustMod: f ? f.thrustMod : undefined,
      fuelMod: f ? f.fuelMod : undefined,
      therms: type === 'radiator' ? thermsSupplied(card, f, slot.radSide) : thermsRequired(f),
    };
  });
  // Afterburn's Open-Cycle Cooling adds a temporary radiator (1 Therm) to the
  // stack for the turn. Appended LAST so a real radiator still wins first-match
  // as a thermostat supplier; this card is only chosen when nothing else cools.
  if (afterburnContributes()) cards.push(openCycleChainCard());
  return cards;
}

// Read-only support-chain view for the visualizer. Resolves the chain that
// powers the active thruster AND the chain that powers the active prospector
// (two roots; a card that feeds both shows up in each). The two chains may
// share supplier cards freely, EXCEPT radiator cooling: the active thruster has
// first claim on the radiator pool, so the prospector root's cooling is
// re-resolved against the post-thruster remainder (a reactor the thruster
// reserved reads "cooled in thruster chain"; one it starved reads short).
// Returns, per root, the resolver output (order / edges /
// cycles / modifierChain / firstReactorId / reactorCooling / coolingOk) plus a
// per-node read of which of that node's own requirement GROUPS are satisfied
// (rule 4: a support is met iff the resolver drew an edge for it). PURE READ -
// resolves off a clone-free snapshot and mutates nothing, so the visualizer can
// call it on every repaint.
export function getSupportChainView() {
  const cards = chainCardsFromStack();
  const byId = new Map(cards.map((c) => [c.id, c]));
  const reqKindsOf = (c) => (c.requires || [])
    .map((r) => (r && typeof r === 'object') ? r.kind : r)
    .filter(Boolean);

  // Every OTHER card that supplies `kind` (the resolver's candidate set): the
  // choices a player can wire a consumer's support to.
  const candidatesFor = (consumerId, kind) => cards
    .filter((c) => c.id !== consumerId && Array.isArray(c.supplies) && c.supplies.includes(kind))
    .map((c) => c.id);

  const buildRoot = (kind, activeId) => {
    if (!activeId || !byId.has(activeId)) return null;
    const chain = resolveSupportChain({ cards, activeId, wiring: _wiring });
    // Edge lookup: which (consumer, kind) pairs the resolver satisfied.
    const satByConsumer = new Map();
    for (const e of chain.edges) {
      if (!satByConsumer.has(e.from)) satByConsumer.set(e.from, new Map());
      satByConsumer.get(e.from).set(e.kind, e.to);
    }
    // Per node: its requirement groups (same supplier-prefix OR grouping the
    // engine uses) flagged satisfied / missing, so the visualizer can tick
    // each card and flag the one with an unmet support.
    const nodeReqs = {};
    for (const id of chain.order) {
      const c = byId.get(id);
      if (!c) continue;
      const groups = new Map();
      for (const k of reqKindsOf(c)) {
        const supplier = String(k).split('-')[0];
        if (!groups.has(supplier)) groups.set(supplier, []);
        groups.get(supplier).push(k);
      }
      const edgeKinds = satByConsumer.get(id) || new Map();
      const reqGroups = [];
      for (const [supplier, kinds] of groups) {
        const hitKind = kinds.find((k) => edgeKinds.has(k));
        reqGroups.push({
          supplier,
          kinds,
          satisfied: !!hitKind,
          supplierId: hitKind ? edgeKinds.get(hitKind) : null,
          kind: hitKind || kinds[0],
        });
      }
      nodeReqs[id] = reqGroups;
    }
    // Per node: the wirable supports, one entry PER KIND that has at least one
    // candidate supplier in the stack, with the full candidate list and the
    // currently-chosen supplier (the resolver's edge, which honors the player's
    // wiring). The visualizer renders a picker only where candidates.length > 1
    // (the single-candidate case is forced, nothing to choose).
    const wirable = {};
    for (const id of chain.order) {
      const c = byId.get(id);
      if (!c) continue;
      const edgeKinds = satByConsumer.get(id) || new Map();
      const entries = [];
      for (const k of reqKindsOf(c)) {
        const cands = candidatesFor(id, k);
        if (cands.length) entries.push({ kind: k, candidates: cands, chosen: edgeKinds.get(k) || null });
      }
      if (entries.length) wirable[id] = entries;
    }
    return { kind, activeId, chain, nodeReqs, wirable };
  };

  const roots = [];
  const t = buildRoot('thruster', _activeThrusterId);
  if (t) roots.push(t);
  // Rule 5: a card that is BOTH the active thruster AND the active prospector
  // (a missile robonaut that carries thrust) serves both roles with ONE chain,
  // so don't root a second identical tree - tag the thruster root as also the
  // prospector. Only when it's a DIFFERENT card does the prospector get its own
  // root; the two chains may share suppliers freely (a card reached by both is
  // flagged "shared", not contended), so independent resolution is correct.
  if (_activeProspectorId && _activeProspectorId === _activeThrusterId) {
    if (t) t.alsoProspector = true;
    else { const p = buildRoot('prospector', _activeProspectorId); if (p) roots.push(p); }
  } else if (_activeProspectorId) {
    const p = buildRoot('prospector', _activeProspectorId);
    if (p) {
      roots.push(p);
      // The active thruster has first claim on the radiator pool, so the
      // prospector's dedicated reactor cooling is whatever the thruster chain
      // leaves. Re-resolve cooling across both (thruster first) and override the
      // prospector root's verdict, so its pills match the gate in
      // getActiveProspectorStats (a reactor the thruster reserved reads short).
      if (t) {
        const cool = resolveCoolingAcross({ cards, orders: [t.chain.order, p.chain.order] });
        const pc = cool.perChain[1];
        if (pc) {
          p.chain.reactorCooling = pc.reactorCooling;
          p.chain.reactorsCooled = pc.reactorsCooled;
          p.chain.nonReactorHeat = pc.nonReactorHeat;
          p.chain.nonReactorCooled = pc.nonReactorCooled;
          p.chain.coolingOk = pc.coolingOk;
          p.chain.radiatorRemaining = cool.radiatorRemaining;
          p.coolingAfterThruster = true;
        }
      }
    }
  }
  return { cards, byId, roots };
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
  // Powersat (ESA faction privilege): +1 thrust to a push-icon thruster for
  // the local Powersat holder. Mirrors the server's activeNetThrust so the
  // client's thrust matches (byte-parity contract).
  if (_hasPowersat && faceHasPush(f)) {
    thrust += 1;
    modifiers.push({ from: 'Powersat', kind: 'thrust', delta: 1 });
  }
  // Support-chain modifiers (rules 1+2, data/support-chain.js). Walk the FULL
  // chain that powers this thruster and apply only the modifier path: every
  // generator before the first reactor, plus that first reactor. A reactor two
  // hops back (THRUSTER -> GENERATOR -> REACTOR) still modifies; a second reactor
  // deeper does not. This replaces the old one-hop "does it DIRECTLY supply the
  // thruster" scan, which missed multi-hop reactors and could double-count a
  // spare reactor. A self-powered thruster (a solar moth, requiring nothing)
  // pulls no chain, so it takes no stack modifiers. The server mirrors this
  // exactly (engine.js) so a move the client allows is never rejected for a
  // different thrust/fuel number.
  const chain = resolveSupportChain({ cards: chainCardsFromStack(), activeId: id, wiring: _wiring });
  for (const cid of chain.modifierChain) {
    const cslot = _stack.find((s) => s.id === cid);
    const c = cslot ? cardForSlot(cslot) : cardById(cid);
    if (!c) continue;
    const cf = cslot ? installedFace(cslot) : activeFace(c);
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
  // Afterburn engaged: +1 net thrust for the whole rocket this turn (rulebook
  // MW Afterburn - the gain is always +1, no matter how many fuel steps were
  // spent; the card's `afterburn` number is the fuel-step COST, paid at engage).
  // One-shot per turn.
  if (_afterburnEngaged && f.afterburn > 0) {
    thrust += 1;
    modifiers.push({ from: 'Afterburn (Open-Cycle)', kind: 'thrust', delta: 1 });
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
    isDirt: faceBurnsDirt(f),   // burns grey dirt fuel, not blue water
    fuelSteps,
    burnsAvailable: burnsAvail,
    modifiers,
    weightClass:   wcClass,
    weightClassMod: wcMod,
    afterburnAvailable: Number.isFinite(f.afterburn) && f.afterburn > 0,
    afterburnSteps:     Number(f.afterburn) || 0,   // fuel steps spent to engage (gain is always +1)
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
