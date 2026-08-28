// Wire-slug aliases: planner node slug -> data/sites.js id.
//
// There are two id spaces for a site (see CLAUDE.md "Site IDs"): the curated
// data/sites.js `id` and the WIRE slug the game state is keyed by, which comes
// from the planner graph's node name. Those normally agree - `mars_north_pole`
// and `mars-north-pole` are the same string bar the separator - so any table
// that carries BOTH the underscore id and slugify(name) matches whatever the
// state hands it.
//
// Six nodes break that assumption, because the vendored planner data names the
// body differently from data/sites.js: four are misspellings in the planner data
// and two are alternate names for the same body. For those, slugify(name) is NOT
// the wire slug, so a pure-data table built from data/sites.js alone silently
// fails to match the id the state actually uses.
//
// That is not theoretical: a player's Factory on Comet Phaethon (wire slug
// `phaethon`) never satisfied the FOOTFALL / NEW VENUS "Factory on a Synodic
// Comet" requirement, because the tag table held `comet_phaethon` and
// `comet-phaethon` and the state said `phaethon` (reported 2026-08-28, game 604).
// The same gap hid `echedus` from the centaur table and `ultima-thule` from the
// KBO one.
//
// This table is PURE DATA so both the engine and the client fold it identically.
// `scripts/check-engine.mjs` asserts it stays COMPLETE by walking every planner
// site node against data/sites.js, so a change to the vendored planner data
// fails the build instead of silently unmatching a Future.
export const PLANNER_SLUG_ALIASES = {
  phaethon: 'comet_phaethon',                     // planner: "Phaethon"
  'comet-bartley-2': 'comet_hartley_2',           // planner misspells Hartley
  'triton-tuenela-plantia': 'triton_tuonela_planitia',   // planner misspells Tuonela Planitia
  teharoniawako: 'teharonhiawako',                // planner drops the h
  echedus: 'echelus',                             // planner misspells Echelus
  'ultima-thule': 'arrokoth',                     // the KBO's former name
};
