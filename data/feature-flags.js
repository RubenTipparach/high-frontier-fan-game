// Feature flags for in-progress mechanics.
//
// Pure data + a pure resolver (no DOM, no `node:` imports) so both the
// browser sandbox and the Node server import the same defaults. Every
// flag DEFAULTS OFF: a half-wired mechanic must never change play until
// it is explicitly switched on. This lets us land "powers" (event
// resolution, faction privileges, on-card abilities) incrementally on the
// branch without altering the live game for anyone.
//
// Each layer can override a default at runtime without editing this file:
//   - browser: js/game/feature-flags.js layers localStorage + URL (?ff=)
//     on top of these defaults.
//   - server:  per-game settings / env layer on top of these defaults
//     (passed to isFeatureEnabled as the `overrides` arg).

export const FEATURE_FLAGS = {
  // Resolve Sunspot-Cube event effects (Inspiration / Glitch / Pad
  // Explosion / Anarchy / Budget Cuts / Solar Flare) when the cube lands
  // on an event slot, instead of only surfacing the d6 roll.
  eventEffects: false,

  // Apply crew faction privilege effects (LAUNCH FEES, TAXES, POWERSAT,
  // SECRETARY GENERAL, ...) instead of only displaying the privilege text.
  factionPrivileges: false,

  // Apply on-card Ability text effects (the long tail of per-card rule
  // overrides catalogued in docs/card-powers.md).
  cardAbilities: false,
};

// Resolve a flag against an optional per-runtime overrides map. An
// override is honoured only when the key is explicitly present, so an
// override map can flip a single flag without listing the rest.
export function isFeatureEnabled(name, overrides) {
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, name)) {
    return !!overrides[name];
  }
  return !!FEATURE_FLAGS[name];
}

// The canonical flag names, for any UI that wants to enumerate them.
export const FEATURE_FLAG_NAMES = Object.keys(FEATURE_FLAGS);
