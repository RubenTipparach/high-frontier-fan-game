// Browser feature-flag reader.
//
// Layers two override sources on top of the shared defaults in
// data/feature-flags.js, both default-off-preserving:
//   1. localStorage['hf-feature-flags'] - a JSON map { name: bool }, the
//      sticky per-device toggle a settings switch writes.
//   2. ?ff=name,name - a URL hint that enables the listed flags for this
//      load only (handy for a quick "show me the WIP" link without
//      persisting). A leading '-' disables instead (?ff=-eventEffects).
//
// Same singleton shape as online-mode.js / card-market.js: getter, setter,
// change subscription. Mirrors how the server resolves the same flags so
// sandbox and multiplayer stay in lockstep.

import {
  FEATURE_FLAGS, FEATURE_FLAG_NAMES, isFeatureEnabled as resolve,
} from '../../data/feature-flags.js';

const STORAGE_KEY = 'hf-feature-flags';

function loadStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === 'object' ? obj : {};
  } catch { return {}; }
}

// Parse ?ff=eventEffects,-cardAbilities into an overrides map. A bare name
// enables; a '-' prefix disables. Unknown names are ignored.
function loadUrl() {
  const out = {};
  try {
    const ff = new URLSearchParams(location.search).get('ff');
    if (!ff) return out;
    for (const tok of ff.split(',')) {
      const t = tok.trim();
      if (!t) continue;
      const off = t.startsWith('-');
      const name = off ? t.slice(1) : t;
      if (FEATURE_FLAG_NAMES.includes(name)) out[name] = !off;
    }
  } catch { /* no location in some contexts */ }
  return out;
}

// URL hint wins over the sticky store (it's the more deliberate, one-shot
// signal); both win over the shipped defaults.
let _overrides = { ...loadStored(), ...loadUrl() };
let _listeners = [];

function persist() {
  try {
    // Persist only the localStorage-sourced overrides, not the URL hint:
    // a ?ff= link shouldn't permanently flip a device.
    const stored = loadStored();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch { /* private mode */ }
}

function notify() {
  for (const cb of _listeners) {
    try { cb(); } catch (e) { console.error('feature-flag listener:', e); }
  }
}

export function isFeatureEnabled(name) { return resolve(name, _overrides); }

// Resolved { name: bool } map across all known flags.
export function getFeatureFlags() {
  const out = {};
  for (const name of FEATURE_FLAG_NAMES) out[name] = isFeatureEnabled(name);
  return out;
}

// Flip a flag and persist it. Pass null to clear the override (fall back
// to the shipped default).
export function setFeatureFlag(name, on) {
  if (!FEATURE_FLAG_NAMES.includes(name)) return false;
  const stored = loadStored();
  if (on === null) delete stored[name];
  else stored[name] = !!on;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stored)); } catch { /* private mode */ }
  _overrides = { ...stored, ...loadUrl() };
  notify();
  return true;
}

export function onFeatureFlagChange(cb) {
  _listeners.push(cb);
  return () => { _listeners = _listeners.filter((x) => x !== cb); };
}

export { FEATURE_FLAGS, FEATURE_FLAG_NAMES };
