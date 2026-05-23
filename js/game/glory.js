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
// Public API:
//   ZONE_CHIT_VPS                       - VP table per zone
//   getChits()                          → array of {zone, earnedTurn}
//   getVisitedZones()                   → array of zone names
//   getVps()                            → number
//   awardChitForZone(zone, turn)        → chit | null
//   revokeChitForZone(zone)             → boolean
//   cashInChits(reason='returned to LEO') → {vps, chits}
//   addVps(delta, reason)               - additive (event d6 outcomes)
//   onChange(cb)                        - unsubscribe

const STORAGE_CHITS   = 'hf-glory-chits';
const STORAGE_VISITED = 'hf-glory-visited';
const STORAGE_VPS     = 'hf-glory-vps';

// VP value of each zone's chit when cashed in at LEO. Inner zones
// are easy / low-VP; outer zones (Saturn / Neptune / KBO) are the
// big payouts. 'Earth' is the home zone and never awards a chit.
// Mirror of the published HF4 ticker-tape table, abstracted to a
// flat per-zone VP because we don't yet model the published "first
// versus repeat" distinction (every chit is one-time-per-zone per
// rocket already, which captures the spirit).
export const ZONE_CHIT_VPS = {
  'Earth':   0,
  'Mercury': 2,
  'Venus':   1,
  'Mars':    1,
  'Ceres':   2,
  'Jupiter': 3,
  'Saturn':  3,
  'Uranus':  4,
  'Neptune': 4,
};

let _chits = (() => {
  try {
    const s = localStorage.getItem(STORAGE_CHITS);
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
  try {
    localStorage.setItem(STORAGE_CHITS,   JSON.stringify(_chits));
    localStorage.setItem(STORAGE_VISITED, JSON.stringify([..._visited]));
    localStorage.setItem(STORAGE_VPS,     String(_vps));
  } catch { /* private mode */ }
}
function notify() {
  for (const cb of _listeners) {
    try { cb(); } catch (e) { console.error('glory listener:', e); }
  }
}

export function getChits()         { return _chits.slice(); }
export function getVisitedZones()  { return [..._visited]; }
export function getVps()           { return _vps; }
export function isZoneVisited(zone) { return _visited.has(zone); }
export function getChitVpValue(zone) {
  return Number.isFinite(ZONE_CHIT_VPS[zone]) ? ZONE_CHIT_VPS[zone] : 1;
}

// First-time entry into a heliocentric zone earns one chit. Earth
// is the home zone and never awards. Returns the chit record on
// success or null when nothing happened (already-visited, Earth,
// missing zone). Idempotent on re-entry of an already-visited zone.
export function awardChitForZone(zone, turn = null) {
  if (!zone || zone === 'Earth') return null;
  if (_visited.has(zone)) return null;
  if (!Object.prototype.hasOwnProperty.call(ZONE_CHIT_VPS, zone)) return null;
  _visited.add(zone);
  const chit = { zone, earnedTurn: turn };
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

// Cash all carried chits in for VPs. Called when the rocket
// returns to a LEO/Earth-zone site. Returns the gained VPs + the
// list of cashed chits so the mission log can surface what
// happened.
export function cashInChits(reason = 'returned to LEO') {
  if (!_chits.length) return { vps: 0, chits: [], reason };
  const cashed = _chits.slice();
  const gained = cashed.reduce((s, c) => s + getChitVpValue(c.zone), 0);
  _chits = [];
  _vps += gained;
  persist();
  notify();
  return { vps: gained, chits: cashed, reason };
}

// Restore previously-cashed chits (undo support for the auto-cash
// step that fires when the rocket lands back at LEO). Reinstates
// the chits in the carrier and rolls back the VP credit.
export function uncashChits(chits, gainedVps) {
  if (!chits || !chits.length) return false;
  _chits = _chits.concat(chits);
  _vps -= gainedVps || 0;
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
  _visited = new Set();
  _vps = 0;
  persist();
  notify();
}

export function onChange(cb) {
  _listeners.push(cb);
  return () => { _listeners = _listeners.filter((x) => x !== cb); };
}
