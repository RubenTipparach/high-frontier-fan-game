// Ad Astra exits + gravitational sunlenses (Module 2 Futures locations).
//
// The published map prints the interstellar EXITS and the two SUNLENS spots at
// the outer map edge, and they are REAL NODES on the map: node-tags marks each
// exit `exit: true` with its label (the same tag the renderer draws the
// "Jupiter-Sol-Jupiter Exit" label from), and each sunlens `special: true`.
//
// This table used to model them as ZONES instead - "a stack standing anywhere
// in the named heliocentric zone qualifies" - on the grounds that the planner
// data had no nodes for them. It does now, and the zone model had gone wrong
// in both directions (reported 2026-09-23, ENZMANN STARSHIP unmet with the
// stack parked ON the Jupiter-Sol-Jupiter Exit):
//
//   - TOO STRICT where a node sits outside the zone it is named for. The
//     Jupiter-Sol-Jupiter Exit node is in the CERES zone, so standing on it
//     failed the "Jupiter zone" test.
//   - TOO LOOSE everywhere else: anywhere in the whole Jupiter or Neptune zone
//     read as "at an exit", however far from one.
//   - And it MIS-SCORED: the Neutrino Sunlens node is in the Neptune zone, and
//     Neptune resolved to the EM lens, so a Freighter parked at the Neutrino
//     Sunlens scored the EM lens's 11 VP instead of its own 6.
//
// So every reader now tests the unit's NODE against the real ones. Pure data
// (imported by data/future-goals.js on both sides); ids are the server slugs
// the game state stores unit positions under.

import { NODE_TAGS } from './node-tags.js';

// Every node the map tags as an exit is an Ad Astra exit. Read off the tags
// rather than listed here, so a newly tagged exit counts without a second edit.
export const AD_ASTRA_EXIT_SLUGS = Object.entries(NODE_TAGS)
  .filter(([, t]) => t && t.exit)
  .map(([slug]) => slug);

// Is this node an Ad Astra exit?
export function isAdAstraExit(slug) {
  return slug != null && AD_ASTRA_EXIT_SLUGS.includes(String(slug));
}

// The two gravitational sunlenses. Named by slug rather than derived: their tag
// is the generic `special`, which other nodes carry too.
export const SUNLENSES = [
  { key: 'neutrino-sunlens', name: 'Neutrino Sunlens', slugs: ['lag-morz3'], vp: 6 },
  { key: 'em-sunlens', name: 'EM Sunlens', slugs: ['lag-mnakl'], vp: 11 },
];

// The sunlens at this node, or null.
export function sunlensAt(slug) {
  if (slug == null) return null;
  const s = String(slug);
  return SUNLENSES.find((l) => l.slugs.includes(s)) || null;
}
