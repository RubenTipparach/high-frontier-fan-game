// Route-planner invariants. The planner is CLIENT code that decides where each
// turn of a multi-turn route ends, and the server executes exactly the turn it
// is handed - so a bad turn boundary strands a ship with nothing the server can
// do about it. check-engine.mjs cannot see any of this (it never runs the
// planner), which is why these live in their own gate.
//
// Run: node scripts/check-planner.mjs
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// loadPlannerMap fetches its JSON through assetUrl; in node, serve those two
// files off disk so the real map data is what gets planned over.
globalThis.fetch = async (url) => {
  const u = String(url).replace(/^file:\/\//, '');
  const rel = u.replace(/^.*?(vendor\/|data\/)/, '$1');
  const body = readFileSync(`${ROOT}/${rel}`, 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(body) };
};

const { loadPlannerMap } = await import(`file://${ROOT}/js/game/planner-map.js`);
const { planRoute } = await import(`file://${ROOT}/js/game/planner-nav.js`);
const { NODE_TAGS } = await import(`file://${ROOT}/data/node-tags.js`);

let failed = 0;
function check(name, fn) {
  try {
    const note = fn();
    console.log(`  ok    ${name}${note ? `  (${note})` : ''}`);
  } catch (e) {
    failed += 1;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${e && e.message ? e.message : e}`);
  }
}
const assert = (c, msg) => { if (!c) throw new Error(msg); };

console.log('planner checks:');

const graph = await loadPlannerMap();
const pts = graph.byId;
const isChute = (id) => {
  const p = pts[id];
  return !!(p && p.id2 && NODE_TAGS[p.id2] && NODE_TAGS[p.id2].aerobrake);
};

// An aerobrake corridor is a descent in progress. The corridor hop itself is
// free, but every lander burn below still costs its burns - so a ship the search
// parks inside a chute can be unable to fund the way down, and sits there taking
// an aero roll every turn (reported 2026-08-30 by two players). The planner must
// never CHOOSE that pause. Ending a route there on PURPOSE is untouched: that is
// the `done` state, which is how an explicitly chosen destination is reached, so
// only non-final turn boundaries are inspected here.
check('no turn boundary lands inside an aerobrake corridor', () => {
  const siteIds = (graph.sites || []).map((s) => s.id).filter((id) => pts[id]);
  assert(siteIds.length > 100, `only ${siteIds.length} sites loaded - the map did not parse`);
  const chutes = Object.keys(pts).filter(isChute);
  assert(chutes.length > 0, 'no aerobrake corridors found - the tag lookup broke');

  // A deterministic spread of site-to-site routes at LOW thrust, which is where
  // the search is most tempted to pause.
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  let checked = 0, viaChute = 0;
  const paused = [];
  for (let i = 0; i < 400; i += 1) {
    const a = siteIds[Math.floor(rnd() * siteIds.length)];
    const b = siteIds[Math.floor(rnd() * siteIds.length)];
    const thrust = 1 + Math.floor(rnd() * 3);
    if (a === b) continue;
    let r;
    try { r = planRoute(graph, a, b, { thrust, gateSeason: false }); } catch { continue; }
    if (!r || !Array.isArray(r.segments) || !r.segments.length) continue;
    checked += 1;
    if (r.segments.some((s) => isChute(s.to) || isChute(s.from))) viaChute += 1;
    const turns = [...new Set(r.segments.map((s) => s.turn || 1))];
    const lastTurn = Math.max(...turns);
    for (const t of turns) {
      if (t === lastTurn) continue;              // the player's chosen destination
      const legs = r.segments.filter((s) => (s.turn || 1) === t);
      const end = legs[legs.length - 1];
      if (end && isChute(end.to)) paused.push(`${a} -> ${b} (thrust ${thrust}) turn ${t} ends at ${end.to}`);
    }
  }
  assert(checked > 100, `only ${checked} routes planned - the sweep is not exercising the planner`);
  assert(viaChute > 0, 'no route in the sweep passed through a corridor - the sweep proves nothing');
  assert(!paused.length,
    `${paused.length} turn boundaries land inside a parachute, e.g. ${paused[0]}`);
  return `${checked} routes, ${viaChute} through a corridor, none pausing in one`;
});

// A lander burn has always had to finish inside one turn. Pinned alongside the
// corridor rule because they are the same idea and share the same code path.
check('no turn boundary lands inside a lander burn', () => {
  const siteIds = (graph.sites || []).map((s) => s.id).filter((id) => pts[id]);
  const isLander = (id) => { const p = pts[id]; return !!(p && p.type === 'burn' && p.landing != null); };
  let seed = 999;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  let checked = 0;
  const paused = [];
  for (let i = 0; i < 300; i += 1) {
    const a = siteIds[Math.floor(rnd() * siteIds.length)];
    const b = siteIds[Math.floor(rnd() * siteIds.length)];
    const thrust = 1 + Math.floor(rnd() * 3);
    if (a === b) continue;
    let r;
    try { r = planRoute(graph, a, b, { thrust, gateSeason: false }); } catch { continue; }
    if (!r || !Array.isArray(r.segments) || !r.segments.length) continue;
    checked += 1;
    const turns = [...new Set(r.segments.map((s) => s.turn || 1))];
    const lastTurn = Math.max(...turns);
    for (const t of turns) {
      if (t === lastTurn) continue;
      const legs = r.segments.filter((s) => (s.turn || 1) === t);
      const end = legs[legs.length - 1];
      if (end && isLander(end.to)) paused.push(`${a} -> ${b} (thrust ${thrust}) turn ${t} ends at ${end.to}`);
    }
  }
  assert(checked > 100, `only ${checked} routes planned`);
  assert(!paused.length, `${paused.length} turn boundaries land partway down a landing, e.g. ${paused[0]}`);
  return `${checked} routes, none pausing partway down a landing`;
});

if (failed) { console.log(`\nplanner checks FAILED (${failed})`); process.exit(1); }
console.log('planner checks passed');
