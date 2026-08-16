#!/usr/bin/env node
// Generate data/node-tags.js - the SINGLE SOURCE OF TRUTH for solar-map node
// markers. Merges two inputs into one comprehensive id2 -> { lander, half,
// hazard, aerobrake, season } map that the renderer reads with NO runtime
// fallback:
//
//   1. data/site-notes.json  - the in-app player tag export ("tag" annotations).
//      Player tags are authoritative for the node they're on. half-burn +
//      lander-burn => half-lander; the plain "burns" tag and "message" notes
//      are ignored. RULE: every aerobrake site is ALSO a hazard, so aero-break
//      implies hazard. The red / yellow / blue tags are the node's SEASON (the
//      Sunspot phase it can be entered in); a node carries at most one.
//   2. data/planner-nodes.json - a snapshot of the upstream planner flags
//      ({ id2, type, landing, hazard }). Used to fill in every UNTAGGED burn's
//      lander / hazard marker. Lagrange/venus hazard flags are too coarse
//      (the planner marks nearly every inner lagrange hazardous), so for those
//      node types we trust ONLY the player tags.
//   3. data/node-seasons.json - the canonical season seed for the 15 seasonal
//      comets / asteroids (derived from the planner JSON's siteSynodic). Sets
//      the season for those named sites; overrides a player colour-tag guess.
//   4. data/node-tag-overrides.json (OPTIONAL) - admin-edited server tags
//      exported from /admin/site-tags. These WIN over every input above; an
//      empty {} entry clears a node to no marker. Missing file = no overrides.
//
// Re-run after editing any input:  node scripts/gen-node-tags.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(__dirname, '..', 'data');
const notes = JSON.parse(readFileSync(resolve(dataDir, 'site-notes.json'), 'utf8'));
const planner = JSON.parse(readFileSync(resolve(dataDir, 'planner-nodes.json'), 'utf8'));

const FLAG = { 'lander-burn': 'lander', 'half-burn': 'half', 'hazard': 'hazard', 'aero-break': 'aerobrake', 'home-bernal': 'homeBernal', 'exit': 'exit', 'special': 'special' };
// A space's synodic SEASON (the Sunspot-phase it can be entered in). The
// red / yellow / blue player tags ARE the season; a node carries at most one.
const SEASON = { red: 'red', yellow: 'yellow', blue: 'blue' };

// 1) Player tags (authoritative per node).
const tagsBySite = {};
for (const a of notes.annotations || []) {
  if (a.kind !== 'tag') continue;          // ignore "message" notes
  if (a.body === 'burns') continue;         // ignore the plain "burns" tag for now
  if (SEASON[a.body]) { (tagsBySite[a.site_id] || (tagsBySite[a.site_id] = {})).season = SEASON[a.body]; continue; }
  const flag = FLAG[a.body];
  if (!flag) continue;
  (tagsBySite[a.site_id] || (tagsBySite[a.site_id] = {}))[flag] = true;
}

const resolved = {};
for (const [id, t] of Object.entries(tagsBySite)) {
  const r = { ...t };
  if (r.aerobrake) r.hazard = true;         // RULE: aerobrake sites are hazards too
  resolved[id] = r;
}

// 2) Untagged burns inherit the planner's own landing / hazard flags so the map
//    is fully covered. Tagged nodes are left as-is (player wins).
for (const n of planner) {
  if (resolved[n.id2]) continue;
  if (n.type !== 'burn') continue;          // lagrange/venus: player tags only
  const r = {};
  if (n.landing != null) { r.lander = true; if (n.landing < 1) r.half = true; }
  if (n.hazard) r.hazard = true;
  if (Object.keys(r).length) resolved[n.id2] = r;
}

// 2b) Canonical synodic SEASON seed (data/node-seasons.json, derived from the
//     planner JSON's siteSynodic on the 15 seasonal comets / asteroids). This
//     is the authoritative season for those named sites, so it overrides a
//     player colour-tag guess; an admin override (step 3) still wins. Named
//     sites carry no marker, so a season-only entry is created here as needed.
let seasonSeed = {};
try { seasonSeed = JSON.parse(readFileSync(resolve(dataDir, 'node-seasons.json'), 'utf8')); } catch { seasonSeed = {}; }
for (const [id, s] of Object.entries(seasonSeed)) {
  if (!SEASON[s]) continue;
  (resolved[id] || (resolved[id] = {})).season = SEASON[s];
}

// 3) Admin overrides (data/node-tag-overrides.json, exported from /admin/site-tags)
//    win over everything: an admin edited these server tags by hand. An entry
//    with no truthy flag means the node was explicitly cleared to NO marker.
let overrides = {};
try { overrides = JSON.parse(readFileSync(resolve(dataDir, 'node-tag-overrides.json'), 'utf8')); } catch { overrides = {}; }
for (const [id, raw] of Object.entries(overrides)) {
  const r = {};
  if (raw && raw.lander) r.lander = true;
  if (raw && raw.half) r.half = true;
  if (raw && raw.hazard) r.hazard = true;
  if (raw && raw.aerobrake) { r.aerobrake = true; r.hazard = true; }  // aerobrake implies hazard
  if (raw && raw.homeBernal) r.homeBernal = true;   // valid Home Bernal anchor site
  if (raw && raw.exit) r.exit = true;               // Sol / interplanetary exit node
  if (raw && raw.special) r.special = true;         // special (Sunlens etc.) node
  if (raw && SEASON[raw.season]) r.season = SEASON[raw.season];
  if (Object.keys(r).length) resolved[id] = r;
  else delete resolved[id];                 // explicitly cleared
}

// 4) The player's "message" note names a node. Exit / special nodes are
//    otherwise unnamed Lagrange points, so carry their message onto the tag as
//    a `label` the map draws. Annotations are id-sorted, so the LAST message
//    per site (its most recent) wins. Applied last so an admin override that
//    keeps the exit/special flag still gets its name.
const msgBySite = {};
for (const a of notes.annotations || []) {
  if (a.kind === 'message' && a.body) msgBySite[a.site_id] = String(a.body).trim();
}
for (const [id, r] of Object.entries(resolved)) {
  if ((r.exit || r.special) && msgBySite[id]) r.label = msgBySite[id];
}

function sprite(t) {
  if (!t) return null;
  if (t.aerobrake) return 'aerobrake';
  if (t.lander && t.half && t.hazard) return 'lander-half-hazard';
  if (t.lander && t.half) return 'lander-half';
  if (t.lander && t.hazard) return 'lander-hazard';
  if (t.lander) return 'lander';
  if (t.hazard) return 'hazard';
  return null;
}

const ids = Object.keys(resolved).sort();
const body = ids.map((id) => `  ${JSON.stringify(id)}: ${JSON.stringify(resolved[id])},`).join('\n');
const out = `// AUTO-GENERATED by scripts/gen-node-tags.mjs - do not edit by hand. The single
// source of truth for solar-map node markers: player site-notes tags merged with
// the planner's own burn flags. half-burn + lander-burn => half-lander; every
// aerobrake site is also a hazard. Keyed by a node's id2 ref.
export const NODE_TAGS = {
${body}
};

// The synodic-season gate (nodeSeason / seasonEntryBlocked) reads this table
// but lives in data/season-gate.js - this file is generated, so rule logic
// parked here would be deleted by the next regeneration.

// Resolve a { lander, half, hazard, aerobrake } record to a map marker sprite
// name (matching assets/map-icons/), or null when it implies no marker. A
// parachute (aerobrake) is itself a kind of hazard, so an aerobrake node's marker
// is just the parachute - no separate skull, even though the data records hazard.
export function spriteForTags(t) {
  if (!t) return null;
  if (t.aerobrake) return 'aerobrake';
  if (t.lander && t.half && t.hazard) return 'lander-half-hazard';
  if (t.lander && t.half) return 'lander-half';
  if (t.lander && t.hazard) return 'lander-hazard';
  if (t.lander) return 'lander';
  if (t.hazard) return 'hazard';
  return null;
}
`;
writeFileSync(resolve(dataDir, 'node-tags.js'), out);
const counts = {};
for (const id of ids) { const s = sprite(resolved[id]) || '?'; counts[s] = (counts[s] || 0) + 1; }
console.log(`wrote data/node-tags.js (${ids.length} nodes)`, JSON.stringify(counts));
