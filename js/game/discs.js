// Prospect discs - the physical chits placed on sites after a
// prospect roll. Success drops the player's colour over the site
// (claim marker); failure drops a red "exhausted" disc that
// signals the site can't be re-prospected this game. The sandbox
// has no multi-player colour system yet, so success uses a
// single placeholder colour from PLAYER_COLOUR below; Stage 3
// plumbs in real per-player colours.
//
// Public API:
//   getDiscs()         -> { [siteId]: {outcome, ts} }
//   getDisc(siteId)    -> {outcome, ts} | null
//   placeDisc(siteId, outcome, meta?)  outcome in {'success','fail'}
//   removeDisc(siteId) -> boolean
//   resetDiscs()
//   onChange(cb)       -> unsubscribe
//
// Disc records are intentionally tiny so they JSON-serialise into
// localStorage without bloat.

const STORAGE_DISCS = 'hf-sandbox-prospect-discs';

// Placeholder "player colour" for the sandbox - matches the
// yellow rocket sprite so the prospect disc reads as "yours".
// Stage 3 multiplayer will replace this with a real per-player
// colour palette.
export const PLAYER_COLOUR = '#facc15';
export const FAIL_COLOUR   = '#ef4444';

let _discs = (() => {
  try {
    const s = localStorage.getItem(STORAGE_DISCS);
    const parsed = s ? JSON.parse(s) : {};
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch { return {}; }
})();
let _listeners = [];

function persist() {
  try {
    if (Object.keys(_discs).length) {
      localStorage.setItem(STORAGE_DISCS, JSON.stringify(_discs));
    } else {
      localStorage.removeItem(STORAGE_DISCS);
    }
  } catch { /* private mode */ }
}
function notify() {
  for (const cb of _listeners) {
    try { cb(); } catch (e) { console.error('discs listener:', e); }
  }
}

export function getDiscs()        { return { ..._discs }; }
export function getDisc(siteId)   { return _discs[siteId] || null; }

export function placeDisc(siteId, outcome, meta = {}) {
  if (!siteId) return false;
  if (outcome !== 'success' && outcome !== 'fail') return false;
  _discs[siteId] = { outcome, ts: Date.now(), ...meta };
  persist();
  notify();
  return true;
}

export function removeDisc(siteId) {
  if (!siteId || !(siteId in _discs)) return false;
  delete _discs[siteId];
  persist();
  notify();
  return true;
}

export function resetDiscs() {
  _discs = {};
  persist();
  notify();
}

export function onChange(cb) {
  _listeners.push(cb);
  return () => { _listeners = _listeners.filter((x) => x !== cb); };
}
