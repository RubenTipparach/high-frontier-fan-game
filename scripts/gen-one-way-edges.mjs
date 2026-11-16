#!/usr/bin/env node
// Generate data/one-way-edges.js - the solar map's one-way ("arrow") edges, in
// id2-slug space, derived from the planner JSON's '0'-direction edge labels.
//
// The published board prints an arrow on every aerobrake corridor (you can only
// descend, never climb) plus a few other one-way ramps. That direction IS
// already encoded in vendor/hf-mission-planner/assets/data-hf4.json: an edge
// labelled '0' from A to B (and NOT '0' from B to A) is traversable A -> B ONLY.
// The mission-planner renderer already draws an arrowhead from these. We surface
// the same edges as static data so the route planner, the manual plotter, the
// move commit, AND the server engine all reject a hop taken against an arrow,
// from ONE source of truth instead of a hand-maintained heuristic.
//
// Re-run after the planner JSON changes:  node scripts/gen-one-way-edges.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRefId } from '../data/planner-ids.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const raw = JSON.parse(readFileSync(resolve(root, 'vendor/hf-mission-planner/assets/data-hf4.json'), 'utf8'));
const points = raw.points || {};
const edgeLabels = raw.edgeLabels || {};

// Slug (id2) for every raw planner key, the SAME makeRefId the client + server
// stamp, so the generated arrows line up with the slugs aeroHopAllowed is fed.
const slugOf = new Map();
for (const k of Object.keys(points)) slugOf.set(k, makeRefId(points[k], points[k].type || 'unknown'));

const arrows = [];
const seen = new Set();
for (const a in edgeLabels) {
  for (const b in edgeLabels[a]) {
    // One-way iff exactly one side carries the '0' label. A both-sides-'0' edge
    // would be unusable and does not occur in the data.
    if (edgeLabels[a][b] !== '0') continue;
    if (edgeLabels[b] && edgeLabels[b][a] === '0') continue;
    const sa = slugOf.get(a), sb = slugOf.get(b);
    if (!sa || !sb || sa === sb) continue;
    const key = sa + '>' + sb;
    if (seen.has(key)) continue;
    seen.add(key);
    arrows.push([sa, sb]);
  }
}
// BOARD ARROWS THE PLANNER JSON LACKS (data/one-way-overrides.json): printed
// one-way arrows checked by eye against the board, e.g. the Titan reprint
// correction (Titan Aerostat -> parachute space -> Ontario Lacus). Each entry is
// [from, to] in id2 slugs.
for (const [a, b] of JSON.parse(readFileSync(resolve(root, 'data/one-way-overrides.json'), 'utf8'))) {
  const key = a + '>' + b;
  if (!seen.has(key)) { seen.add(key); arrows.push([a, b]); }
}

// FILL CHAIN GAPS. The board prints a one-way move as a dotted, arrowed line
// that can run through several spaces, but the planner JSON sometimes labels
// only its first and last hops (e.g. the green line below Saturn: arrows into
// and out of the ring crossing, none on the two hops through it). A two-way hop
// whose ends both sit inside the SAME linear run (degree-2 nodes) between two
// arrows pointing the same way is one-way too: there is no other way on or off
// the run, so the arrow carries through. Iterate until nothing changes, so a
// run of several unlabelled hops fills in completely. (User 2026-11-16: the
// fix "shouldn't be a one-off".)
const adj = new Map();
for (const e of raw.edges || []) {
  const [a, b] = String(e).split(':');
  const sa = slugOf.get(a), sb = slugOf.get(b);
  if (!sa || !sb || sa === sb) continue;
  if (!adj.has(sa)) adj.set(sa, new Set());
  if (!adj.has(sb)) adj.set(sb, new Set());
  adj.get(sa).add(sb); adj.get(sb).add(sa);
}
const fwd = () => new Set(arrows.map(([a, b]) => a + '>' + b));
const isArrow = (set, a, b) => set.has(a + '>' + b) || set.has(b + '>' + a);
// Walk from `cur` (arrived from `prev`) along degree-2 nodes until a hop that
// carries an arrow; return that hop's direction relative to the walk ('with' =
// pointing along the walk, 'against'), or null if the run ends without one.
function arrowAlong(prev, cur, set) {
  for (let guard = 0; guard < 12; guard++) {
    const ns = [...(adj.get(cur) || [])].filter((n) => n !== prev);
    if (ns.length !== 1) return null;            // not a linear run any more
    const nxt = ns[0];
    if (set.has(cur + '>' + nxt)) return 'with';
    if (set.has(nxt + '>' + cur)) return 'against';
    if ((adj.get(cur) || new Set()).size !== 2) return null;
    prev = cur; cur = nxt;
  }
  return null;
}
for (let changed = true; changed;) {
  changed = false;
  const set = fwd();
  for (const [a, ns] of adj) {
    for (const b of ns) {
      if (a > b || isArrow(set, a, b)) continue;
      if ((adj.get(a) || new Set()).size !== 2 || (adj.get(b) || new Set()).size !== 2) continue;
      // Looking outward from each end: an arrow beyond b pointing away from a,
      // and an arrow beyond a pointing toward b, means a -> b (and vice versa).
      const beyondB = arrowAlong(a, b, set), beyondA = arrowAlong(b, a, set);
      let dir = null;
      if (beyondB === 'with' && beyondA === 'against') dir = [a, b];
      else if (beyondB === 'against' && beyondA === 'with') dir = [b, a];
      if (!dir) continue;
      arrows.push(dir); seen.add(dir[0] + '>' + dir[1]); changed = true;
    }
  }
}

arrows.sort((p, q) => (p[0] === q[0] ? p[1].localeCompare(q[1]) : p[0].localeCompare(q[0])));

const bodyText = arrows.map(([a, b]) => `  [${JSON.stringify(a)}, ${JSON.stringify(b)}],`).join('\n');
const out = `// AUTO-GENERATED by scripts/gen-one-way-edges.mjs - do not edit by hand.
// The solar map's one-way ("arrow") edges in id2-slug space, from the planner
// JSON's '0'-direction edge labels: an edge labelled '0' A->B (and not B->A) is
// traversable A -> B ONLY - the printed arrow (every aerobrake's descent plus a
// few other one-way ramps), plus the hops INSIDE a linear one-way run that the
// planner left unlabelled (filled in, see the generator). data/aerobrake-direction.js
// reads these so a route can never be plotted, planned, or committed against an
// arrow, and the map draws its dotted arrowed lines from the same list.
export const ONE_WAY_ARROWS = [
${bodyText}
];
`;
writeFileSync(resolve(root, 'data/one-way-edges.js'), out);
console.log(`wrote data/one-way-edges.js (${arrows.length} arrows)`);
