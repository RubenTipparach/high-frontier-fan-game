// Measure how the HF Sol board is built, so Ad Astra's system maps follow the
// same rules (docs/ad-astra/system-map-rules.md). Read-only analysis of:
//   vendor/hf-mission-planner/assets/data-hf4.json  (the board graph)
//   data/zone-assignments.json                      (helio zone per node)
//   data/node-tags.js                               (lander / hazard / aerobrake tags)
// Run from the repo root: node docs/ad-astra/analyze-sol-map.mjs
import { readFileSync } from 'node:fs';
import { makeRefId } from '../../data/planner-ids.js';
import { NODE_TAGS } from '../../data/node-tags.js';

const raw = JSON.parse(readFileSync('vendor/hf-mission-planner/assets/data-hf4.json', 'utf8'));
const ZONE = JSON.parse(readFileSync('data/zone-assignments.json', 'utf8'));
const P = raw.points;
const ids = Object.keys(P);
const id2 = {}; const seen = {};
for (const k of ids) { let r = makeRefId(P[k], P[k].type); seen[r] = (seen[r] || 0) + 1; if (seen[r] > 1) r = `${r}-${seen[r]}`; id2[k] = r; }
const adj = {}; for (const k of ids) adj[k] = [];
for (const e of raw.edges) { const [a, b] = e.split(':'); if (adj[a] && adj[b]) { adj[a].push(b); adj[b].push(a); } }
const zone = (k) => ZONE[id2[k]] || null;
const tag = (k) => NODE_TAGS[id2[k]] || {};
const isSite = (k) => P[k].type === 'site';
const name = (k) => P[k].siteName || id2[k];
const pct = (n, d) => `${n}/${d} (${Math.round((100 * n) / Math.max(1, d))}%)`;
const out = [];
const say = (...a) => out.push(a.join(' '));

// 1. helio zones
const zc = {}; for (const k of ids) { const z = zone(k); if (z) zc[z] = (zc[z] || 0) + 1; }
say('## Helio zones (nodes per zone)'); say(JSON.stringify(zc));
say(`nodes with a zone: ${pct(ids.filter(zone).length, ids.length)}`);

// Curves (decorative chains) are drawing only: look THROUGH them to the real
// neighbour at the far end of the chain.
const realNbrs = (k) => {
  const out = [];
  for (const first of adj[k]) {
    let prev = k, cur = first, guard = 0;
    while (P[cur].type === 'decorative' && guard++ < 200) { const nx = adj[cur].find((m) => m !== prev); if (!nx) break; prev = cur; cur = nx; }
    if (P[cur].type !== 'decorative') out.push(cur);
  }
  return out;
};
// 2. what does each burn do?
const burns = ids.filter((k) => P[k].type === 'burn');
// a body's "well": real nodes reachable from its sites without passing a
// Hohmann pivot (green dot, the heliocentric transfer layer)
const inWell = new Set();
for (const s of ids.filter(isSite)) {
  const q = [s]; const seenW = new Set([s]);
  while (q.length) { const n = q.shift(); inWell.add(n); for (const m of realNbrs(n)) { if (seenW.has(m) || P[m].type === 'hohmann') continue; seenW.add(m); q.push(m); } }
}
let lander = 0, transition = 0, well = 0, other = 0; const otherList = [];
for (const k of burns) {
  const t = tag(k);
  if (t.lander || P[k].landing) { lander++; continue; }
  const zs = new Set([zone(k), ...realNbrs(k).map(zone)].filter(Boolean));
  if (zs.size > 1) { transition++; continue; }
  if (inWell.has(k)) { well++; continue; }
  other++; otherList.push(`${id2[k]}@${zone(k)}`);
}
say('\n## What each burn does', `(${burns.length} burns; curves looked through)`);
say(`lander burns (descend to / lift off a surface): ${pct(lander, burns.length)}`);
say(`helio zone transitions (real neighbours in different zones): ${pct(transition, burns.length)}`);
say(`orbit entry / escape (inside a body's well, between its sites and the Hohmann layer): ${pct(well, burns.length)}`);
say(`other: ${pct(other, burns.length)}  e.g. ${otherList.slice(0, 10).join(', ')}`);

// 3. gravity well depth: fewest burns from a body's sites out to a Hohmann pivot
say('\n## Gravity well: fewest burns from a body\'s surface out to the Hohmann transfer layer');
const wellDepth = (s) => {
  const dist = { [s]: 0 }; const open = [s]; const done = new Set();
  while (open.length) {
    open.sort((a, b) => dist[a] - dist[b]); const n = open.shift(); if (done.has(n)) continue; done.add(n);
    if (P[n].type === 'hohmann') return dist[n];
    for (const m of realNbrs(n)) { const nd = dist[n] + (P[m].type === 'burn' ? 1 : 0); if (dist[m] == null || nd < dist[m]) { dist[m] = nd; open.push(m); } }
  }
  return null;
};
const sitesByBody = {};
for (const k of ids.filter(isSite)) { const body = name(k).split(':')[0].trim(); (sitesByBody[body] = sitesByBody[body] || []).push(k); }
const rows = Object.entries(sitesByBody).map(([b, ks]) => [b, Math.min(...ks.map(wellDepth).filter((x) => x != null)), ks.length, P[ks[0]].siteSize, zone(ks[0])]);
const bySize = {}; for (const r of rows) { const sz = parseInt(r[3], 10); if (!isFinite(sz) || !isFinite(r[1])) continue; (bySize[sz] = bySize[sz] || []).push(r[1]); }
say('average well depth by site size:', Object.entries(bySize).sort((a, b) => a[0] - b[0]).map(([sz, ws]) => `size ${sz}: ${(ws.reduce((a, b) => a + b, 0) / ws.length).toFixed(1)} (n${ws.length})`).join(' | '));
for (const r of rows.sort((a, b) => b[1] - a[1]).slice(0, 24)) say(`  ${r[0].padEnd(24)} well ${r[1]}  sites ${r[2]}  size ${r[3] ?? '-'}  ${r[4] || ''}`);

// 4. how sites hang off the map
say('\n## Site connections');
const sn = {}; for (const k of ids.filter(isSite)) for (const m of adj[k]) { const t = tag(m).lander ? 'lander-burn' : P[m].type; sn[t] = (sn[t] || 0) + 1; }
say('neighbour types of sites:', JSON.stringify(sn));
const deg = (k) => adj[k].length;
say(`site degree: ${JSON.stringify(ids.filter(isSite).reduce((a, k) => { a[deg(k)] = (a[deg(k)] || 0) + 1; return a; }, {}))}`);

// 5. dead ends: Sol never leaves a route hanging
const deadEnds = ids.filter((k) => !isSite(k) && deg(k) <= 1 && P[k].type !== 'venus');
say('\n## Dead ends (non-site nodes with <= 1 edge):', deadEnds.length, deadEnds.slice(0, 6).map((k) => `${id2[k]}(${P[k].type})`).join(' '));

// 6. hazards
say('\n## Hazards');
const hz = ids.filter((k) => tag(k).hazard);
const hzType = {}; const hzZone = {};
for (const k of hz) { hzType[P[k].type] = (hzType[P[k].type] || 0) + 1; const z = zone(k) || '?'; hzZone[z] = (hzZone[z] || 0) + 1; }
say('tagged hazards by node type:', JSON.stringify(hzType));
say('tagged hazards by zone:', JSON.stringify(hzZone));
const rz = {}; for (const k of ids.filter((k) => P[k].type === 'radhaz')) { const z = zone(k) || '?'; rz[z] = (rz[z] || 0) + 1; }
say('radiation (radhaz) nodes by zone:', JSON.stringify(rz));
const aero = ids.filter((k) => tag(k).aerobrake);
say('aerobrake nodes by zone:', JSON.stringify(aero.reduce((a, k) => { const z = zone(k) || '?'; a[z] = (a[z] || 0) + 1; return a; }, {})));
const landerHaz = ids.filter((k) => tag(k).lander && tag(k).hazard).length;
say(`lander burns that are also hazards: ${landerHaz}`);

// 7. lagrange + flyby boosts, hohmann junctions
say('\n## Lagrange points and flybys');
const fly = ids.filter((k) => P[k].flybyBoost);
say('flyby boosts:', fly.map((k) => `${zone(k)}:+${P[k].flybyBoost}`).join(', '));
const hoh = ids.filter((k) => P[k].type === 'hohmann');
say(`hohmann degree: ${JSON.stringify(hoh.reduce((a, k) => { a[deg(k)] = (a[deg(k)] || 0) + 1; return a; }, {}))}`);
const hohCross = hoh.filter((k) => new Set([zone(k), ...adj[k].map(zone)].filter(Boolean)).size > 1).length;
say(`hohmann nodes at a zone boundary: ${pct(hohCross, hoh.length)}`);

// 8. zone boundary edges: which node types sit on the crossing
const cross = {}; let crossN = 0;
for (const e of raw.edges) { const [a, b] = e.split(':'); if (zone(a) && zone(b) && zone(a) !== zone(b)) { crossN++; for (const k of [a, b]) cross[P[k].type] = (cross[P[k].type] || 0) + 1; } }
say(`\n## Edges that cross a helio zone boundary: ${crossN}; endpoint types:`, JSON.stringify(cross));

// 9. decoratives: only ever inside curves
const decDeg = ids.filter((k) => P[k].type === 'decorative').reduce((a, k) => { a[deg(k)] = (a[deg(k)] || 0) + 1; return a; }, {});
say('\n## Decorative (curve) node degrees:', JSON.stringify(decDeg));

console.log(out.join('\n'));
