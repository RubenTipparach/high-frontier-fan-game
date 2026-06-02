// Sunspot Cube clock - shared, pure-data single source of truth.
//
// The 12-slot Sol Sunspot Cycle: 3 seasons of 4 slots each, an event
// marker on every even slot, and the verbatim HF4 event table the cube
// consults when it lands on one.
//
// This module is PURE DATA + PURE HELPERS (no DOM, no localStorage, no
// `node:` imports) so the same definitions can be imported by every
// layer instead of being copy-pasted:
//   - the browser clock  (js/game/turn-clock.js re-exports these)
//   - the server engine  (server/game/state.js + engine.js)
//   - the docs generator (scripts/list-powers.mjs)
// These constants used to be duplicated between js/game/turn-clock.js and
// server/game/state.js; this is now the one place they live.

export const SLOTS = 12;
export const NEW_ROUND_SLOT = 0;

// Even slots. An event fires when the cube LANDS here; this is one slot
// clockwise of the old odd markers [1,3,5,7,9,11], so each event now
// resolves the turn AFTER the cube crosses its marker line. Slot 0 fires
// on the new-round tick.
export const EVENT_SLOTS = [0, 2, 4, 6, 8, 10];

// Season wedges on the 12-slot dial. The new-round marker (slot 0) sits
// in the MIDDLE of Season Blue, so Blue WRAPS the top of the dial: slots
// 10, 11, 0, 1. A `from > to` entry wraps past slot 0 - see slotInSeason.
// Event markers (slots 0, 2, 4, 6, 8, 10) are independent of this colour.
export const SEASONS = [
  { name: 'blue',   color: '#60a5fa', from: 10, to: 1, label: 'Season Blue'   },
  { name: 'yellow', color: '#facc15', from: 2,  to: 5, label: 'Season Yellow' },
  { name: 'red',    color: '#f87171', from: 6,  to: 9, label: 'Season Red'    },
];

// Verbatim HF4 Sunspot-Cube event table. Triggered each time the cube
// lands on an event slot (0, 2, 4, 6, 8, 10); the player rolls 1d6 and
// consults this table. For rolls 1-4 the event is universal; for 5-6 the
// effect depends on the current season (Blue / Yellow / Red). The text is
// reproduced from the published rulebook so the modal can surface it
// verbatim.
//
// NOTE: these events DO NOT directly award or remove VP - they change
// game state (rotate decks, place Glitch tokens, decommission cards, swap
// faction privileges, force flare rolls). VP swings only happen as a
// side-effect of those state changes (e.g. losing a card you spent ops to
// build). Don't wire d6 to VP deltas; the event is the event.
//
// Each entry also carries an `effect` key: the engine's machine-readable
// id for the state change to apply when event resolution is enabled (the
// `eventEffects` feature flag). `null` means "display only, not yet
// wired".
export const EVENT_TABLE = {
  inspiration: {
    name: 'Inspiration',
    icon: '💡',
    rolls: [1, 2],
    season: null,
    effect: 'rotate_decks',
    text: 'Put the topmost card of each patent deck (& the Colonist '
      + 'queue) at the bottom of the deck.',
  },
  glitch: {
    name: 'Glitch',
    icon: '⚠️',
    rolls: [3],
    season: null,
    effect: 'place_glitch',
    text: 'Each player places a Glitch disk on their stack with the '
      + 'most cards that has neither a Glitch nor Humans.',
  },
  pad_explosion: {
    name: 'Pad Explosion / Space Debris',
    icon: '🧨',
    rolls: [4],
    season: null,
    effect: 'pad_explosion',
    text: 'Each player decommissions their card with the highest '
      + 'Mass in LEO, choosing one if tied. However, Crew, '
      + 'Black-Side, Purple-Side, Colonists, and Bernals are immune.',
  },
  anarchy: {
    name: 'Anarchy',
    icon: '🗽',
    rolls: [5, 6],
    season: 'blue',
    effect: 'anarchy',
    text: 'Until the Sunspot Cube exits season blue, each player’s '
      + 'listed faction privilege is replaced by the Felonious '
      + 'faction privilege. (Module 0) The Active Law is inactivated, '
      + 'and make a Purge Roll.',
  },
  budget_cuts: {
    name: 'Budget Cuts',
    icon: '✂️',
    rolls: [5, 6],
    season: 'yellow',
    effect: 'budget_cuts',
    text: 'Each player discards a card of their choice from their '
      + 'Hand to the bottom of the corresponding patent deck.',
  },
  solar_flare: {
    name: 'Solar Flare',
    icon: '☀️',
    rolls: [5, 6],
    season: 'red',
    effect: 'solar_flare',
    text: 'Make a 1d6 Flare Roll and apply the result to every card '
      + 'in all non-LEO and unshielded stacks. Adjust the result by '
      + 'the modifier listed in the Heliocentric Zone the stack is '
      + 'in. If rad-hardness < modified result, then decommission '
      + 'the card.',
  },
};

// True when `slot` falls inside a season wedge, handling wedges that
// wrap past slot 0 (from > to, e.g. Blue = 10..1).
export function slotInSeason(slot, s) {
  return s.from <= s.to
    ? (slot >= s.from && slot <= s.to)
    : (slot >= s.from || slot <= s.to);
}

// The season wedge a given slot index sits in (the season object).
export function getSeasonForSlot(slot) {
  return SEASONS.find((s) => slotInSeason(slot, s)) || SEASONS[0];
}

export function isEventSlot(slot) {
  return EVENT_SLOTS.includes(slot);
}

// Resolve a (dieRoll, seasonName) pair to the canonical event record.
// Returns null when no entry matches - shouldn't happen because every d6
// value is covered for every season, but lets callers fail soft.
export function getEventForRoll(dieRoll, seasonName) {
  for (const e of Object.values(EVENT_TABLE)) {
    if (!e.rolls.includes(dieRoll)) continue;
    if (e.season !== null && e.season !== seasonName) continue;
    return e;
  }
  return null;
}
