// Glory - HF4's "ticker-tape" system. Each rocket carries a set
// of glory chits earned by being the first to enter a given
// heliocentric zone. Chits are physical inventory: the rocket
// hauls them back to LEO (Earth zone) to convert them into VPs.
// Other VP sources (event d6 outcomes like Catastrophic Failure
// or Rookie Miscalculation) feed the same VP counter directly.
//
// We don't have a per-crew abstraction in the sandbox yet - the
// whole rocket "is" the crew for now. When real crew cards land
// (post-Stage 3) this module's _chits / _visited / _vps will
// split per-crew; the API surface won't change.
//
// Glory & Heroism chits are TWO-SIDED (published VP tracker):
//   - FRONT (the low value, 1 VP) is scored when the crew that
//     earned the chit does NOT bring it home alive: it either
//     turned into a colony or died en route.
//   - BACK (the high, zone-specific value) is scored when the crew
//     returns home (LEO) alive: the chit is flipped face-up.
// A chit is earned the first time a crew lands in a heliocentric
// zone. Only one player may retrieve a given zone's chit.
//
// Public API:
//   ZONE_CHIT_VPS                       - { zone: {front, back} }
//   getChits()                          → carried [{zone, earnedTurn}]
//   getClaimedChits()                   → resolved [{zone, side, vp}]
//   getVisitedZones()                   → array of zone names
//   getVps()                            → number
//   getChitVpValue(zone, side='back')   → number
//   getChitSides(zone)                  → {front, back}
//   awardChitForZone(zone, turn, crewId)→ chit | null
//   revokeChitForZone(zone)             → boolean
//   cashInChits(reason)                 → {vps, chits}  (BACK side, all)
//   resolveChitsFront(reason)           → {vps, chits}  (FRONT side, all)
//   resolveChitsForCrew(crewId, side)   → {vps, chits}  (one crew's chits)
//   addVps(delta, reason)               - additive (event d6 outcomes)
//   onChange(cb)                        - unsubscribe

import { isOnline } from './online-mode.js';

const STORAGE_CHITS   = 'hf-glory-chits';
const STORAGE_CLAIMED = 'hf-glory-claimed';
const STORAGE_VISITED = 'hf-glory-visited';
const STORAGE_VPS     = 'hf-glory-vps';

// Two-sided VP value of each zone's chit, mirroring the published
// HF4 Victory Point Tracker ("GLORY & HEROISM CHITS"). front =
// crew turned into a colony OR died; back = crew returned home
// alive (the chit is flipped for the bigger payout). Inner zones
// pay little; the outer system (Uranus / Neptune) pays the most.
export const ZONE_CHIT_VPS = {
  'Mercury': { front: 1, back: 3 },
  'Venus':   { front: 1, back: 2 },
  'Earth':   { front: 1, back: 2 },
  'Mars':    { front: 1, back: 2 },
  'Ceres':   { front: 1, back: 3 },
  'Jupiter': { front: 1, back: 3 },
  'Saturn':  { front: 1, back: 4 },
  'Uranus':  { front: 1, back: 5 },
  'Neptune': { front: 1, back: 6 },
};

let _chits = (() => {
  try {
    const s = localStorage.getItem(STORAGE_CHITS);
    return s ? JSON.parse(s) : [];
  } catch { return []; }
})();
// Resolved chits: each is {zone, side:'front'|'back', vp, turn}.
// Drives the "claimed chits" table in the scoring panel.
let _claimed = (() => {
  try {
    const s = localStorage.getItem(STORAGE_CLAIMED);
    return s ? JSON.parse(s) : [];
  } catch { return []; }
})();
let _visited = (() => {
  try {
    const s = localStorage.getItem(STORAGE_VISITED);
    return s ? new Set(JSON.parse(s)) : new Set();
  } catch { return new Set(); }
})();
let _vps = (() => {
  try {
    const n = parseInt(localStorage.getItem(STORAGE_VPS) || '0', 10);
    return Number.isFinite(n) ? n : 0;
  } catch { return 0; }
})();
let _listeners = [];

function persist() {
  if (isOnline()) return;
  try {
    localStorage.setItem(STORAGE_CHITS,   JSON.stringify(_chits));
    localStorage.setItem(STORAGE_CLAIMED, JSON.stringify(_claimed));
    localStorage.setItem(STORAGE_VISITED, JSON.stringify([..._visited]));
    localStorage.setItem(STORAGE_VPS,     String(_vps));
  } catch { /* private mode */ }
}
function notify() {
  for (const cb of _listeners) {
    try { cb(); } catch (e) { console.error('glory listener:', e); }
  }
}

// Replace the in-memory glory state from a server snapshot. The
// visited set is reconstructed from the passed array.
export function hydrateGlory({ chits = [], claimed = [], visited = [], vps = 0 } = {}) {
  let chitsCopy;
  let claimedCopy;
  try { chitsCopy = structuredClone(chits); }
  catch { chitsCopy = JSON.parse(JSON.stringify(chits)); }
  try { claimedCopy = structuredClone(claimed); }
  catch { claimedCopy = JSON.parse(JSON.stringify(claimed)); }
  _chits = Array.isArray(chitsCopy) ? chitsCopy : [];
  _claimed = Array.isArray(claimedCopy) ? claimedCopy : [];
  _visited = new Set(Array.isArray(visited) ? visited : []);
  _vps = Number.isFinite(vps) ? vps : 0;
  notify();
}

export function getChits()         { return _chits.slice(); }
export function getClaimedChits()  { return _claimed.slice(); }
export function getVisitedZones()  { return [..._visited]; }
export function getVps()           { return _vps; }
export function isZoneVisited(zone) { return _visited.has(zone); }

// {front, back} for a zone, defaulting to {1, 1} for unknown zones.
export function getChitSides(zone) {
  const v = ZONE_CHIT_VPS[zone];
  if (!v) return { front: 1, back: 1 };
  return { front: v.front, back: v.back };
}

// VP for one chit. side defaults to 'back' (the returned-home
// payout) so existing callers that ask "what's this chit worth"
// get the headline value.
export function getChitVpValue(zone, side = 'back') {
  const sides = getChitSides(zone);
  return side === 'front' ? sides.front : sides.back;
}

// First-time entry into a heliocentric zone earns one chit, owned
// by the crew that retrieved it (crewId). Earth is the home zone and
// never awards. Returns the chit record on success or null when
// nothing happened (already-visited, Earth, missing zone).
export function awardChitForZone(zone, turn = null, crewId = null) {
  if (!zone || zone === 'Earth') return null;
  if (_visited.has(zone)) return null;
  if (!Object.prototype.hasOwnProperty.call(ZONE_CHIT_VPS, zone)) return null;
  _visited.add(zone);
  const chit = { zone, earnedTurn: turn, crewId: crewId || null };
  _chits.push(chit);
  persist();
  notify();
  return chit;
}

// Revert the most recent awardChitForZone(zone) - undo of a rocket
// move that crossed into a new zone. Removes the chit AND drops
// the zone from the visited set so a subsequent re-entry can
// re-award it. Returns true when something was actually undone.
export function revokeChitForZone(zone) {
  if (!zone) return false;
  // Drop the chit even if visited set is stale (defence in depth).
  const idx = _chits.findIndex((c) => c.zone === zone);
  let any = false;
  if (idx >= 0) {
    _chits.splice(idx, 1);
    any = true;
  }
  if (_visited.delete(zone)) any = true;
  if (any) { persist(); notify(); }
  return any;
}

// Cash all carried chits in for VPs at the BACK (returned-home)
// value. Called when the rocket returns to a LEO/Earth-zone site:
// the crew brought them home alive, so each chit flips face-up for
// its bigger payout. Resolved chits move to the claimed list.
// Returns the gained VPs + the list of cashed chits so the mission
// log can surface what happened.
export function cashInChits(reason = 'returned to LEO') {
  return _resolveCarried('back', reason);
}

// Resolve carried chits at the FRONT (low) value: the crew that
// earned them turned into a colony or died, so the chits are
// scored face-down. Same bookkeeping as cashInChits, lower value.
export function resolveChitsFront(reason = 'crew lost / colonised') {
  return _resolveCarried('front', reason);
}

function _resolveCarried(side, reason) {
  if (!_chits.length) return { vps: 0, chits: [], reason, side };
  const carried = _chits.slice();
  let gained = 0;
  for (const c of carried) {
    const vp = getChitVpValue(c.zone, side);
    gained += vp;
    _claimed.push({ zone: c.zone, side, vp, turn: c.earnedTurn ?? null, crewId: c.crewId ?? null });
  }
  _chits = [];
  _vps += gained;
  persist();
  notify();
  return { vps: gained, chits: carried, reason, side };
}

// Resolve chits when a rocket reaches LEO (home). Each chit follows the
// crew that picked it up, so only the chits whose owning crew is in
// `homeCrewIds` (the crew aboard the arriving rocket) score now; chits
// owned by crew parked elsewhere in play (an outpost) stay carried and
// ride home later with THEIR crew. Legacy ownerless chits resolve too.
// Crew rode home -> BACK (returned-home) value; a crewless rocket scores
// only ownerless chits, face-up at FRONT. Returns { vps, chits, side }.
export function cashHomeArrival(homeCrewIds, reason = 'returned to LEO') {
  const home = new Set(homeCrewIds || []);
  const anyHome = home.size > 0;
  // Ownerless (legacy) chits always match; owned chits match only when
  // their crew is among those that arrived home.
  const match = (c) => (c.crewId ? home.has(c.crewId) : true);
  const matched = _chits.filter(match);
  const side = anyHome ? 'back' : 'front';
  if (!matched.length) return { vps: 0, chits: [], reason, side };
  let gained = 0;
  for (const c of matched) {
    const vp = getChitVpValue(c.zone, side);
    gained += vp;
    _claimed.push({ zone: c.zone, side, vp, turn: c.earnedTurn ?? null, crewId: c.crewId ?? null });
  }
  _chits = _chits.filter((c) => !match(c));
  _vps += gained;
  persist();
  notify();
  return { vps: gained, chits: matched, reason, side };
}

// Resolve only the chits owned by one crew (used when that crew
// leaves the rocket: colonises or dies). Other crews' chits stay
// carried. Defaults to the FRONT (face-up) value.
export function resolveChitsForCrew(crewId, side = 'front', reason = 'crew left the rocket') {
  if (!crewId) return { vps: 0, chits: [], reason, side };
  const matched = _chits.filter((c) => c.crewId === crewId);
  if (!matched.length) return { vps: 0, chits: [], reason, side };
  let gained = 0;
  for (const c of matched) {
    const vp = getChitVpValue(c.zone, side);
    gained += vp;
    _claimed.push({ zone: c.zone, side, vp, turn: c.earnedTurn ?? null, crewId: c.crewId ?? null });
  }
  _chits = _chits.filter((c) => c.crewId !== crewId);
  _vps += gained;
  persist();
  notify();
  return { vps: gained, chits: matched, reason, side };
}

// Restore previously-resolved chits (undo support for the auto-
// resolve step that fires when the rocket lands back at LEO).
// Reinstates the chits in the carrier, rolls back the VP credit,
// and pops the matching entries off the claimed list (they were
// just appended, so dropping the tail count is correct).
export function uncashChits(chits, gainedVps) {
  if (!chits || !chits.length) return false;
  _chits = _chits.concat(chits);
  _vps -= gainedVps || 0;
  _claimed = _claimed.slice(0, Math.max(0, _claimed.length - chits.length));
  persist();
  notify();
  return true;
}

export function addVps(delta, reason = '') {
  if (!delta) return 0;
  _vps += delta;
  persist();
  notify();
  return _vps;
}

export function resetGlory() {
  _chits = [];
  _claimed = [];
  _visited = new Set();
  _vps = 0;
  persist();
  notify();
}

export function onChange(cb) {
  _listeners.push(cb);
  return () => { _listeners = _listeners.filter((x) => x !== cb); };
}
