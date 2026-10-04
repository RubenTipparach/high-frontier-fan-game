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
const { BUGGY_ROADS } = await import(`file://${ROOT}/data/buggy-roam.js`);

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
// AN AEROBRAKE CORRIDOR IS AN ORDINARY HAZARD SPACE for movement (user
// 2026-09-05), so there is deliberately NO check here that the planner avoids
// pausing in one - it may end a turn on a corridor exactly as on any other
// hazard. What makes that safe is not routing but two rules the engine owns, and
// scripts/check-engine.mjs pins both:
//   - a stack parked on a corridor takes a fresh descent roll as its turn opens
//     (aerobrakeParkingHazard), waived only by a parachute generator;
//   - a stack standing on a corridor may drop to the site below REGARDLESS of
//     that site's size ("a ship parked on a parachute spot moves off and lands
//     below"), which is the whole point of entering one.
// Together those mean a parked ship is never trapped, so the 2026-08-30 clause
// that made the search route around corridors is gone.

// A lander burn has always had to finish inside one turn (H5e): you cannot halt
// partway down a landing. Unlike a corridor this IS a movement restriction, so
// the planner still may not put a turn boundary inside one.
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

// A ROAD IS BUGGY ONLY - which is a BUGGY rule, not a rocket rule (user
// 2026-08-31). The board's yellow dashed roads are drawn from the buggy-<body>
// tags and are not in the movement graph at all: every road-tagged pair is
// joined through a LANDER BURN, so a rocket crossing between them is flying, not
// driving. Reported on Callisto Valhalla to Asgard Ice Spires; the same shape
// had already been reported on Titan. The planner must offer a route for every
// one of these pairs, and every one of those routes must fire an engine.
check('every buggy-road pair is a flight the planner will offer', () => {
  const byRef = new Map();
  for (const s of (graph.sites || [])) if (s && s.id2 && pts[s.id]) byRef.set(String(s.id2), s.id);
  const isLander = (id) => { const p = pts[id]; return !!(p && p.type === 'burn' && p.landing != null); };
  assert(BUGGY_ROADS.length >= 11, `expected the board's road pairs, found ${BUGGY_ROADS.length}`);
  const missing = [];
  const grounded = [];
  let planned = 0;
  for (const [refA, refB] of BUGGY_ROADS) {
    const a = byRef.get(String(refA));
    const b = byRef.get(String(refB));
    assert(a && b, `a road-tagged site is not on the planner map: ${refA} / ${refB}`);
    // Thrust 14 so the liftoff gate is never what refuses these - the question
    // here is whether a route exists at all, not whether a weak engine can fly it.
    let r = null;
    try { r = planRoute(graph, a, b, { thrust: 14, gateSeason: false }); } catch { r = null; }
    if (!r || !Array.isArray(r.segments) || !r.segments.length) { missing.push(`${refA} -> ${refB}`); continue; }
    planned += 1;
    if (!r.segments.some((s) => isLander(s.to) || isLander(s.from))) grounded.push(`${refA} -> ${refB}`);
  }
  assert(!missing.length, `the planner offers no route between road-tagged sites: ${missing.join(', ')}`);
  assert(!grounded.length,
    `a road-tagged pair routes without ever firing an engine, so it really is a drive: ${grounded.join(', ')}`);
  return `${planned} road pairs, every route through a lander burn`;
});

// "Decide as I go" decides where the MOVE ends, which is exactly the kind of
// turn boundary the server cannot second-guess. Reported 2026-09-23: a player
// paid the first of two hazards and rolled a 3 on the second (an aerobrake),
// and the ship stopped ON the aerobrake - the stepper returned the last
// hazard's segment as the end of the move even though nobody pressed Stop.
const { runHazardStepper } = await import(`file://${ROOT}/js/game/hazard-stepper.js`);
async function checkAsync(name, fn) {
  try {
    const note = await fn();
    console.log(`  ok    ${name}${note ? `  (${note})` : ''}`);
  } catch (e) {
    failed += 1;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${e && e.message ? e.message : e}`);
  }
}
{
  // A five-leg turn: a skull entered on leg 1, an aerobrake on leg 3, and the
  // destination at the end of leg 4.
  const turn1Segs = ['n1', 'n2', 'n3', 'n4', 'dest'].map((to) => ({ to }));
  const items = [
    { segIndex: 1, label: 'skull', site: { name: 'Skull' } },
    { segIndex: 3, label: 'aerobrake', aero: true, site: { name: 'Aerobrake' } },
  ];
  const run = (answers, over = {}) => {
    const asked = [];
    const answer = answers.slice();
    return runHazardStepper(items, {
      turn1Segs,
      isCleanHalt: () => true,
      askGroup: async (p) => { asked.push(p); return answer.shift(); },
      siteName: (id) => id,
      aqua: 5, finaoPer: 5,
      ...over,
    }).then((r) => ({ r, asked }));
  };
  await checkAsync('decide as I go: deciding every hazard flies the whole turn', async () => {
    const { r } = await run([['pay'], ['roll']]);
    assert(r, 'the move was cancelled');
    assert(r.uptoSegIndex === turn1Segs.length - 1,
      `the move ends on leg ${r.uptoSegIndex}, not the destination (leg ${turn1Segs.length - 1}) - the ship is parked on the last hazard`);
    assert(r.choices.join() === 'pay,roll', `choices ${r.choices.join()}`);
    return 'pay the skull, roll the aerobrake: the ship reaches the destination';
  });
  await checkAsync('decide as I go: Stop here ends the move before the hazards ahead', async () => {
    const { r, asked } = await run([['pay'], 'stop']);
    assert(r && r.uptoSegIndex === 1 && r.choices.join() === 'pay', `got ${JSON.stringify(r)}`);
    assert(!asked[0].stopOffered && asked[1].stopOffered, 'Stop here offered at the wrong step');
    assert(asked[1].atSiteLabel === 'n2', `"currently at" reads ${asked[1].atSiteLabel}`);
    assert(asked[1].aquaLeft === 0, `the second step thinks ${asked[1].aquaLeft} aqua is left after paying 5 of 5`);
    return 'stops after the skull; nothing decided past it';
  });
  await checkAsync('decide as I go: cancelling decides nothing', async () => {
    const { r } = await run([['pay'], 'cancel']);
    assert(r === null, `got ${JSON.stringify(r)}`);
  });
  await checkAsync('decide as I go: a stop that is not a clean halt joins the next step', async () => {
    const { r, asked } = await run([['roll', 'pay']], { isCleanHalt: (id) => id !== 'n2' });
    assert(asked.length === 1 && asked[0].group.items.length === 2, `asked ${asked.length} steps`);
    assert(r.uptoSegIndex === turn1Segs.length - 1 && r.choices.join() === 'roll,pay', `got ${JSON.stringify(r)}`);
    return 'both hazards decided together, the whole turn flown';
  });
}

if (failed) { console.log(`\nplanner checks FAILED (${failed})`); process.exit(1); }
console.log('planner checks passed');
