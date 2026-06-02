// Server feature-flag reader.
//
// Resolves the shared flags (data/feature-flags.js) for the authoritative
// engine. Two override layers on top of the shipped (off) defaults:
//   1. env HF_FEATURE_FLAGS - a comma list, e.g.
//      "eventEffects,-cardAbilities". Bare name enables; '-' prefix
//      disables. Set per deploy to turn a WIP mechanic on server-wide.
//   2. per-game overrides - an optional { name: bool } map carried on a
//      game's state, so a single table can opt in without a redeploy.
//
// Mirrors js/game/feature-flags.js so sandbox and multiplayer gate on the
// same names. Effects stay off until a flag is explicitly enabled.

import { isFeatureEnabled as resolve, FEATURE_FLAG_NAMES } from '../../data/feature-flags.js';

function loadEnv() {
  const out = {};
  const raw = process.env.HF_FEATURE_FLAGS;
  if (!raw) return out;
  for (const tok of raw.split(',')) {
    const t = tok.trim();
    if (!t) continue;
    const off = t.startsWith('-');
    const name = off ? t.slice(1) : t;
    if (FEATURE_FLAG_NAMES.includes(name)) out[name] = !off;
  }
  return out;
}

// Parsed once at boot; a deploy is what changes env, and that restarts
// the process anyway.
const ENV_OVERRIDES = loadEnv();

// Resolve a flag. Per-game overrides (from state) win over env, which wins
// over the shipped default.
export function isFeatureEnabled(name, gameOverrides) {
  const merged = gameOverrides
    ? { ...ENV_OVERRIDES, ...gameOverrides }
    : ENV_OVERRIDES;
  return resolve(name, merged);
}

export { FEATURE_FLAG_NAMES };
