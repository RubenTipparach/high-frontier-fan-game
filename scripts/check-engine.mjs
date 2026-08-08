// Engine smoke gate: EXECUTE the hot paths, don't just link them.
//
// Why this exists. `check-boot.mjs` parses and links the module graph, which
// catches a syntax error or a bad import but nothing that only fails when code
// RUNS. On 2026-07-28 a signature change (`rocketAtLeo` gained a `state`
// parameter) updated a call inside `exposedAtLeo` without adding `state` to
// that function's own signature. It parsed, it linked, it deployed - and every
// table's END_TURN threw `ReferenceError: state is not defined` the moment the
// Sunspot clock rolled a Pad Explosion. A single executed turn would have
// caught it.
//
// So: drive a real game through the paths that actually fire in play. Fast
// (no server, no DB, no network) so CI can run it on every push next to the
// boot check.
//
// Run locally: node scripts/check-engine.mjs

import { createInitialState } from '../server/game/state.js';
import { applyOperation, autoFixGlitches, liveScoreboard, bernalVpByPlayer, bernalRowsByPlayer, assemblyVpByPlayer, repairSpeciesDeckSplit, cycleMarketDecks } from '../server/game/engine.js';
import { BERNALS } from '../data/bernals.js';
import { lineOfSightSites, zoneOfSlug, hazardKind, nodeBySlug as plannerNodeBySlug,
  findPath as plannerFindPath, leoSlug as plannerLeoSlug,
  neighborSlugs as plannerNeighborSlugs, allSiteSlugs as plannerAllSiteSlugs } from '../server/game/planner-graph.js';
import { BUGGY_ROAD_GROUPS, routeCrossesSurface } from '../data/buggy-roam.js';
import { CREW } from '../data/crew.js';
import { COLONISTS_BY_ID } from '../data/colonists.js';
import { PATENTS } from '../data/patents.js';
import { scorePlayer } from '../data/endgame-scoring.js';
import { siteBySlug, nodeSizeNumber, isLanderBurnNode, isAerobrakeLandableSite, neighborSlugs } from '../server/game/planner-graph.js';
import { SIREN_BUSTED_SITES, splitDeckForSoloSpecies, SIREN_SOLO_SPECTRALS } from '../data/sirens.js';
import { usesSoloAssembly, lawForIdeology, SOLO_LAWS } from '../data/assembly.js';
import { turnsToImpact, TURNS_PER_CYCLE, HERMES_ROUNDS, hermesSitesIndustrialized,
  hermesTargetSites, hermesProspectWaived, isHermesTargetSite, HERMES_MAX_PLAYERS, NEUJMIN_SITE } from '../data/hermes.js';
import { resolveSupportChain, unmetRequirements } from '../data/support-chain.js';
import { elevatorPairKey } from '../data/space-elevators.js';
import { futureGoalForCard, checkFutureGoal } from '../data/future-goals.js';
import { makeRng } from '../server/game/rng.js';
const PATENTS_BY_ID_LOCAL = Object.fromEntries(PATENTS.map((c) => [c.id, c]));

let failures = 0;
function check(label, fn) {
  try {
    const detail = fn();
    console.log(`  ok    ${label}${detail ? '  (' + detail + ')' : ''}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL  ${label}\n        ${err && err.message}`);
  }
}
async function checkAsync(label, fn) {
  try {
    const detail = await fn();
    console.log(`  ok    ${label}${detail ? '  (' + detail + ')' : ''}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL  ${label}\n        ${err && err.message}`);
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

// A couple of rules (the synodic-season gate) live only on the CLIENT planner,
// because the server validates fuel and not routes. Loading that planner here
// means running its browser-shaped loader headless: it fetches the map JSON,
// and under node those URLs come out as file:// paths, which fetch refuses. A
// tiny read-through shim covers it, installed only for the duration of the
// load so nothing else in this script sees a patched fetch.
async function loadClientPlannerMap() {
  const { readFileSync, existsSync } = await import('node:fs');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => {
    const path = String(u).replace(/^file:\/\//, '');
    if (!existsSync(path)) return { ok: false, status: 404 };
    const text = readFileSync(path, 'utf8');
    return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
  };
  try {
    const { loadPlannerMap } = await import('../js/game/planner-map.js');
    return await loadPlannerMap();
  } finally {
    globalThis.fetch = realFetch;
  }
}
const { planRoute: planClientRoute } = await import('../js/game/planner-nav.js');

const thruster = PATENTS.find((c) => c.type === 'thruster');

// A two-player game, crew drafted, ready to take turns.
function startedGame(opts = {}) {
  const seats = opts.seats || 2;
  const roster = Array.from({ length: seats }, (_, i) => ({ profileId: i + 1, name: `P${i + 1}`, seat: i + 1 }));
  delete opts.seats;
  let st = createInitialState({ players: roster, seed: 'check-engine', maxRounds: 5, ...opts });
  for (let i = 0; i < roster.length; i++) {
    const cur = st.players.find((p) => !p.faction);
    if (!cur) break;
    const card = CREW.find((c) => c.color === cur.color) || CREW[i];
    const r = applyOperation(st, { kind: 'PICK_CREW', cardId: card.id, face: 'primary' }, { profileId: cur.profileId });
    assert(r.ok, `PICK_CREW rejected: ${r.error}`);
    st = r.state;
  }
  return st;
}

console.log('engine smoke:');

check('game starts and the crew draft completes', () => {
  const st = startedGame();
  assert(st.draftPhase === 'play', `draft did not finish (phase ${st.draftPhase})`);
  assert(st.players.every((p) => p.faction), 'a seat has no faction');
  return `${st.players.length} seats`;
});

// THE regression this file was written for. A full lap of turns runs the
// Sunspot clock through every event slot, so Inspiration / Glitch / Pad
// Explosion / the seasonal events all resolve for real. Cards are staged at
// LEO and the rocket is parked there so pad-explosion exposure has both of its
// halves to walk.
check('a full lap of END_TURNs resolves every Sunspot event', () => {
  let st = startedGame();
  for (const p of st.players) {
    p.leo = [{ id: thruster.id, kind: 'patent', face: 'primary' }];
    p.rocket.stack = [{ id: thruster.id, kind: 'patent', face: 'primary' }];
    p.rocket.siteId = null;
  }
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const who = st.players[st.activeIndex];
    const r = applyOperation(st, { kind: 'END_TURN' }, { profileId: who.profileId });
    // A pending event (Budget Cuts discard, Pad Explosion tie-break) legitimately
    // halts the lap waiting on a player choice - that is not a failure.
    if (!r.ok) {
      assert(r.error === 'awaiting_event_choice', `END_TURN rejected: ${r.error}`);
      break;
    }
    st = r.state;
    if (st.lastEvent && st.lastEvent.kind) seen.add(st.lastEvent.kind);
  }
  assert(seen.size > 0, 'no Sunspot event fired in a full lap');
  return [...seen].join(', ');
});

// The LEO gates, which the Sirens home-base work rewrites. Each is a rule a
// player hits constantly, and each reads the rocket's location.
check('LEO gates behave', () => {
  const one = (over = {}) => {
    const st = startedGame();
    const p = st.players[st.activeIndex];
    Object.assign(p.rocket, { siteId: null, stack: [], tank: 0, tankGrade: 'water' }, over.rocket || {});
    p.aqua = 20;
    return { st, id: p.profileId };
  };
  const run = (o, op) => { const { st, id } = one(o); return applyOperation(st, op, { profileId: id }); };

  assert(run({}, { kind: 'REFUEL', amount: 3 }).ok, 'REFUEL at LEO was refused');
  assert(run({ rocket: { siteId: 'ceres' } }, { kind: 'REFUEL', amount: 3 }).error === 'rocket_not_at_leo',
    'REFUEL away from LEO was allowed');
  assert(run({ rocket: { tank: 5 } }, { kind: 'CASH_WATER', amount: 2 }).ok, 'CASH_WATER at LEO was refused');
  assert(run({ rocket: { stack: [{ id: thruster.id, kind: 'patent', face: 'primary' }] } },
    { kind: 'CONVERT_OUTPOST' }).error === 'rocket_at_leo', 'CONVERT_OUTPOST at LEO was allowed');
  return 'refuel / cash / convert';
});

check('module games start (m0, m1+m2)', () => {
  assert(startedGame({ m0: true }).m0 === true, 'm0 did not stick');
  const m2 = startedGame({ m0: true, m1: true, m2: true });
  assert(m2.m1 === true && m2.m2 === true, 'm1/m2 did not stick');
  return 'ok';
});

// V9 Sirens. A MIXED table is the interesting case: the two species have
// DIFFERENT home bases in the same game, so every home-base gate has to give
// opposite answers for the two seats. Anything that still reads "is siteId
// null?" shows up here as a Siren being treated as if it were at Earth.
// `species` names the species per SEAT; the default is the 2-seat mixed table
// (seat 0 Earthling, seat 1 Siren) most checks want.
function sirensGame(species = ['earthling', 'siren'], opts = {}) {
  let st = startedGame({ sirens: true, seats: species.length, ...opts });
  st.draftPhase = 'crew';
  const taken = new Set();
  st.players.forEach((p) => { p.faction = null; });
  st.players.forEach((p, i) => {
    const card = CREW.find((c) => c.color === p.color && !taken.has(c.id)) || CREW[i];
    taken.add(card.id);
    const r = applyOperation(st, {
      kind: 'PICK_CREW', cardId: card.id, face: 'primary', species: species[i],
    }, { profileId: p.profileId });
    assert(r.ok, `sirens PICK_CREW rejected: ${r.error}`);
    st = r.state;
  });
  return st;
}

check('a Sirens table splits the two species between two homes', () => {
  const st = sirensGame();
  const earth = st.players[0];
  const siren = st.players[1];
  assert(earth.species === 'earthling', `seat 0 is ${earth.species}`);
  assert(siren.species === 'siren', `seat 1 is ${siren.species}`);
  assert(earth.rocket.siteId === null, `the Earthling did not home at LEO (${earth.rocket.siteId})`);
  assert(siren.rocket.siteId === 'cordelia', `the Siren did not home at Cordelia (${siren.rocket.siteId})`);
  // Assert the seeded discs land on REAL sites. A typo'd slug used to seed a
  // disc on a site that does not exist, which silently does nothing - this map
  // has no plain 'luna', the Moon is two separate landing sites.
  const seeded = Object.keys(st.discs || {});
  assert(seeded.length === SIREN_BUSTED_SITES.length,
    `seeded ${seeded.length} busted claims, want ${SIREN_BUSTED_SITES.length}`);
  for (const slug of seeded) {
    // Check against the PLANNER slug space, which is what state.discs is keyed
    // by and what the engine resolves through - not data/sites.js, whose
    // underscore ids are a different spelling (see canonicalSiteId in
    // data/sirens.js).
    assert(siteBySlug(slug), `busted claim seeded on a site the engine cannot resolve: ${slug}`);
  }
  return 'LEO vs cordelia';
});

// The aqua bank reaches each species at ITS OWN home and nowhere else. Run both
// directions in the SAME game, so a gate that ignored species would have to fail
// one of the two.
check('the aqua bank follows each species home', () => {
  const at = (idx, siteId, op) => {
    const st = sirensGame();
    const p = st.players[idx];
    // Take the turn as this seat regardless of order - the ops below are
    // turn-gated, so hand them the turn explicitly.
    st.activeIndex = idx;
    Object.assign(p.rocket, { siteId, stack: [], tank: 6, tankGrade: 'water' });
    p.aqua = 20;
    return applyOperation(st, op, { profileId: p.profileId });
  };
  const refuel = { kind: 'REFUEL', amount: 2 };
  assert(at(0, null, refuel).ok, 'the Earthling could not refuel at LEO');
  assert(at(0, 'cordelia', refuel).error === 'rocket_not_at_leo',
    'the Earthling drew the bank at Cordelia');
  assert(at(1, 'cordelia', refuel).ok, 'the Siren could not refuel at Cordelia');
  assert(at(1, null, refuel).error === 'rocket_not_at_leo',
    'the Siren drew the bank at LEO');
  return 'both directions';
});

// CONVERT_OUTPOST is refused at home (you use the home Stack instead) and
// allowed away from it, so it is the mirror image of the refuel gate.
check('convert-to-outpost is refused at each species own home', () => {
  const at = (idx, siteId) => {
    const st = sirensGame();
    const p = st.players[idx];
    st.activeIndex = idx;
    Object.assign(p.rocket, { siteId, stack: [{ id: thruster.id, kind: 'patent', face: 'primary' }] });
    return applyOperation(st, { kind: 'CONVERT_OUTPOST' }, { profileId: p.profileId });
  };
  assert(at(0, null).error === 'rocket_at_leo', 'the Earthling converted at LEO');
  assert(at(1, 'cordelia').error === 'rocket_at_leo', 'the Siren converted at Cordelia');
  assert(at(1, null).error !== 'rocket_at_leo', 'the Siren was blocked at LEO, which is not its home');
  return 'both directions';
});

// A Sirens table still has to survive a full lap of turns: pad-explosion
// exposure walks each player's home stack, and a Siren's rocket is parked at a
// real site rather than at null.
check('a Sirens table survives a full lap of END_TURNs', () => {
  let st = sirensGame();
  for (const p of st.players) {
    p.leo = [{ id: thruster.id, kind: 'patent', face: 'primary' }];
    p.rocket.stack = [{ id: thruster.id, kind: 'patent', face: 'primary' }];
  }
  for (let i = 0; i < 40; i++) {
    const who = st.players[st.activeIndex];
    const r = applyOperation(st, { kind: 'END_TURN' }, { profileId: who.profileId });
    if (!r.ok) { assert(r.error === 'awaiting_event_choice', `END_TURN rejected: ${r.error}`); break; }
    st = r.state;
  }
  return `round ${st.round}`;
});

// V9b: with both species seated the libraries split in two, and neither species
// may draw from the other's. The interesting properties are that NO card is lost
// or duplicated by the cut, and that the odd card goes to the Sirens.
check('a mixed Sirens table splits every patent deck in two', () => {
  const plain = startedGame();
  const st = sirensGame();
  assert(st.sirenDecks, 'the libraries were not split');
  let checked = 0;
  for (const [type, before] of Object.entries(plain.decks)) {
    const earth = st.decks[type] || [];
    const siren = st.sirenDecks[type] || [];
    assert(earth.length + siren.length === before.length,
      `${type}: ${earth.length}+${siren.length} != ${before.length} - the cut lost or duplicated cards`);
    assert(siren.length >= earth.length,
      `${type}: the odd card did not go to the Sirens (${earth.length} vs ${siren.length})`);
    assert(!earth.some((id) => siren.includes(id)), `${type}: a card is in BOTH libraries`);
    checked += 1;
  }
  assert(checked > 0, 'no decks were compared');
  return `${checked} decks`;
});

// C4 makes the cut conditional: "1 or 2 players can be Earthling Factions. IF
// THE LATTER, all patent decks ... are to be split into two." An all-Siren table
// has nobody to withhold cards from, so it keeps ONE library.
// Everything a player LAUNCHES arrives at their own home base. A Siren's home
// stack stands at Cordelia, so a boosted colony (and a rocket formed out of that
// stack) belongs there - not in Earth orbit half a solar system away. (User
// 2026-08-01: "mirror LEO with Cordelia as a siren player" / "boosting bernal
// was also reported to appear in leo".)
check('a Siren launches to Cordelia, an Earthling to LEO', () => {
  const results = [];
  for (const [species, wantHome, label] of [['siren', 'cordelia', 'Cordelia'], ['earthling', null, 'LEO']]) {
    let st = startedGame({ seats: 1, sirens: true, m1: true, m2: true });
    const seat = st.players[0];
    seat.species = species;
    // Hand the seat a Bernal card and the aqua to lift it.
    const bernalId = (st.decks.bernal || [])[0] || ((st.sirenDecks || {}).bernal || [])[0];
    assert(!!bernalId, 'no Bernal card in the library to boost');
    seat.hand = [bernalId];
    seat.aqua = 40;
    seat.opsRemaining = Math.max(1, seat.opsRemaining | 0);

    const boosted = applyOperation(st, { kind: 'BOOST', cardIds: [bernalId] },
      { profileId: seat.profileId });
    assert(boosted.ok, `BOOST rejected for the ${species}: ${boosted.error}`);
    st = boosted.state;
    const me = st.players[0];
    const bn = (me.bernals || [])[0];
    assert(!!bn, `the ${species} boost established no colony`);
    const at = bn.siteId == null ? null : bn.siteId;
    assert(at === wantHome,
      `the ${species}'s boosted Bernal stands at ${JSON.stringify(at)}, not ${label}`);
    // The mission log must name the right place too.
    if (species === 'siren') {
      assert(!/\bLEO\b/.test(boosted.log || ''),
        `the log told a Siren their colony went to LEO: ${boosted.log}`);
    }

    // ...and a rocket formed out of that same home stack forms there as well.
    const me2 = st.players[0];
    const patentId = (st.decks.thruster || [])[0] || ((st.sirenDecks || {}).thruster || [])[0];
    me2.leo = [{ id: patentId, kind: 'patent' }];
    me2.rocket.stack = [];
    me2.rocket.tank = 0;
    me2.rocket.siteId = null;
    const moved = applyOperation(st, { kind: 'TRANSFER', cardIds: [patentId], from: 'leo', to: 'rocket' },
      { profileId: seat.profileId });
    assert(moved.ok, `TRANSFER rejected for the ${species}: ${moved.error}`);
    const rk = moved.state.players[0].rocket;
    const rAt = rk.siteId == null ? null : rk.siteId;
    assert(rAt === wantHome,
      `the ${species}'s rocket assembled at ${JSON.stringify(rAt)}, not ${label}`);
    results.push(`${species} -> ${label}`);
  }
  return results.join(', ');
});

// A Glitch Roll belongs to the stack that PERFORMED the trigger. A glitched
// rocket parked at one site must not lose cards because a different stack ran a
// refuel somewhere else. (User report 2026-08-01: a glitched stack at Minerva
// was decommissioned by a factory refuel initiated at Miahelena.)
// Cargo Transfer is a Glitch Trigger (user 2026-08-03), and a transfer is
// performed by BOTH ends - so each glitched end rolls, and an unglitched pair
// rolls nothing at all.
// V5 Hermes Fall defers to V4c: the Research Auction is a direct TAKE at 1 aqua
// per card, at ANY seat count. A competitive auction must never open there - not
// even when a Research Grants request is refused by the law check (user
// 2026-08-03: "auction showed up when m0 in effect and we have research grants").
// V5 Hermes Fall is won the MOMENT both halves carry a factory - the table must
// be told there and then, not when the clock stops (user 2026-08-03).
// A Bernal carries its own stack, so it must be able to name its own active
// thruster / prospector and wire its own supports - the three ops were all
// hardcoded to player.rocket (user 2026-08-03: "no option for me to pick what
// supports the bernal thruster").
check('a Bernal names its own active cards and wiring, not the rocket\'s', () => {
  const st = startedGame({ seats: 2, m1: true, m2: true });
  st.activeIndex = 0;
  const me = st.players[st.activeIndex];
  const thruster = PATENTS.find((c) => c.type === 'thruster');
  const gens = PATENTS.filter((c) => c.type === 'generator').slice(0, 2);
  assert(thruster && gens.length === 2, 'need a thruster and two generators');
  me.bernals = [{
    cardId: null, figure: 'kalpana', face: 'primary', anchored: true, siteId: 'burn-geo',
    stack: [
      { id: thruster.id, kind: 'patent', face: 'primary' },
      { id: gens[0].id, kind: 'patent', face: 'primary' },
      { id: gens[1].id, kind: 'patent', face: 'primary' },
    ],
    tank: 0, wiring: {}, route: [], activeThrusterId: null, activeProspectorId: null,
  }];
  me.rocket.stack = [];
  me.rocket.activeThrusterId = null;

  const r = applyOperation(st, { kind: 'SET_ACTIVE_THRUSTER', stackId: 'bernal0', cardId: thruster.id },
    { profileId: me.profileId });
  assert(r.ok, `SET_ACTIVE_THRUSTER on a Bernal was refused: ${r.error}`);
  const bn = r.state.players[r.state.activeIndex].bernals[0];
  assert(bn.activeThrusterId === thruster.id,
    `the Bernal did not take the thruster (${bn.activeThrusterId})`);
  assert(!r.state.players[r.state.activeIndex].rocket.activeThrusterId,
    'it was written to the ROCKET instead');

  // ...and the wiring picks WHICH generator feeds it, on the Bernal.
  const w = applyOperation(r.state, {
    kind: 'SET_WIRING', stackId: 'bernal0',
    wiring: { [thruster.id]: { 'gen-electric': gens[1].id } },
  }, { profileId: me.profileId });
  assert(w.ok, `SET_WIRING on a Bernal was refused: ${w.error}`);
  const bn2 = w.state.players[w.state.activeIndex].bernals[0];
  assert(bn2.wiring && bn2.wiring[thruster.id],
    `the Bernal kept no wiring (${JSON.stringify(bn2.wiring)})`);
  assert(!Object.keys(w.state.players[w.state.activeIndex].rocket.wiring || {}).length,
    'the wiring landed on the rocket');
  assert(/Bernal/i.test(w.log || ''), `the log does not name the Bernal: ${w.log}`);

  // A stack the player does not have is refused, not written nowhere.
  const bad = applyOperation(w.state, { kind: 'SET_ACTIVE_THRUSTER', stackId: 'bernal1', cardId: thruster.id },
    { profileId: me.profileId });
  assert(!bad.ok && bad.error === 'no_stack',
    `a missing stack was accepted: ${bad.ok ? 'accepted' : bad.error}`);

  // Zero bleed-through: an op with no stackId still means the rocket.
  const st2 = startedGame({ seats: 2 });
  st2.activeIndex = 0;
  const me2 = st2.players[st2.activeIndex];
  me2.rocket.stack = [{ id: thruster.id, kind: 'patent', face: 'primary' }];
  const rk = applyOperation(st2, { kind: 'SET_ACTIVE_THRUSTER', cardId: thruster.id },
    { profileId: me2.profileId });
  assert(rk.ok, `the rocket default broke: ${rk.error}`);
  assert(rk.state.players[rk.state.activeIndex].rocket.activeThrusterId === thruster.id,
    'an op with no stackId stopped meaning the rocket');
  return 'Bernal takes its own thruster + wiring; rocket default intact';
});

check('Hermes ends in victory as soon as both halves are industrialized', () => {
  let st = createInitialState({
    players: [{ profileId: 1, name: 'P1', seat: 1 }, { profileId: 2, name: 'P2', seat: 2 }],
    seed: 'check-engine', maxRounds: 2, hermes: true,
  });
  for (const p of [...st.players]) {
    const card = CREW.find((c) => c.color === p.color) || CREW[0];
    st = applyOperation(st, { kind: 'PICK_CREW', cardId: card.id, face: 'primary' },
      { profileId: p.profileId }).state;
  }
  const [A, B] = st.players;
  // ONE half planted: the mission is not over, and nobody is told it is.
  st.factories = { 'hermes-a': { ownerId: A.profileId, spectralType: 'S' } };
  const r = applyOperation(st, { kind: 'INCOME' }, { profileId: st.players[st.activeIndex].profileId });
  assert(r.ok, `INCOME rejected: ${r.error}`);
  assert(r.state.status !== 'finished', 'the game ended on ONE half');
  assert(!r.state.hermesVerdict, `a verdict was declared early: ${r.state.hermesVerdict}`);

  // The SECOND half lands - the OTHER player's, because the mission is
  // cooperative. The very next op must end it in victory.
  const st2 = r.state;
  st2.factories['hermes-b'] = { ownerId: B.profileId, spectralType: 'S' };
  // The mission is settled at the END of the turn that completed it, so the
  // player keeps the rest of their turn and ENDING it is what decides.
  st2.players.forEach((p) => { p.opsRemaining = Math.max(1, p.opsRemaining | 0); });
  const mid = applyOperation(st2, { kind: 'INCOME' },
    { profileId: st2.players[st2.activeIndex].profileId });
  assert(mid.ok, `INCOME rejected: ${mid.error}`);
  assert(mid.state.status !== 'finished',
    'the mission ended mid-turn instead of waiting for the turn to close');
  const r2 = applyOperation(mid.state, { kind: 'END_TURN' },
    { profileId: mid.state.players[mid.state.activeIndex].profileId });
  assert(r2.ok, `END_TURN rejected: ${r2.error}`);
  assert(r2.state.status === 'finished', `the game did not end (${r2.state.status})`);
  assert(r2.state.hermesVerdict === 'deflected', `wrong verdict: ${r2.state.hermesVerdict}`);
  assert(/deflected/i.test(r2.log || ''), `the log does not announce it: ${r2.log}`);

  // Zero bleed-through: an ordinary game is not ended by Hermes factories.
  let plain = createInitialState({
    players: [{ profileId: 1, name: 'P1', seat: 1 }, { profileId: 2, name: 'P2', seat: 2 }],
    seed: 'check-engine', maxRounds: 5,
  });
  for (const p of [...plain.players]) {
    const card = CREW.find((c) => c.color === p.color) || CREW[0];
    plain = applyOperation(plain, { kind: 'PICK_CREW', cardId: card.id, face: 'primary' },
      { profileId: p.profileId }).state;
  }
  plain.factories = { 'hermes-a': { ownerId: 1 }, 'hermes-b': { ownerId: 2 } };
  const pr = applyOperation(plain, { kind: 'INCOME' },
    { profileId: plain.players[plain.activeIndex].profileId });
  assert(pr.ok, `INCOME rejected: ${pr.error}`);
  assert(pr.state.status !== 'finished', 'an ordinary game ended on Hermes factories');
  return 'one half keeps playing, the second ends it in victory';
});

check('Hermes never opens a competitive auction, at any seat count', () => {
  const draft = (opts) => {
    let st = createInitialState({
      players: [{ profileId: 1, name: 'P1', seat: 1 }, { profileId: 2, name: 'P2', seat: 2 }],
      seed: 'check-engine', ...opts,
    });
    for (const p of [...st.players]) {
      const card = CREW.find((c) => c.color === p.color) || CREW[0];
      const r = applyOperation(st, { kind: 'PICK_CREW', cardId: card.id, face: 'primary' },
        { profileId: p.profileId });
      assert(r.ok, `PICK_CREW rejected: ${r.error}`);
      st = r.state;
    }
    st.players.forEach((p) => { p.aqua = 30; p.opsRemaining = Math.max(1, p.opsRemaining | 0); });
    return st;
  };
  const actor = (st) => st.players[st.activeIndex].profileId;

  const st = draft({ maxRounds: 2, hermes: true });
  assert(st.players.length === 2 && !st.ceoSolo, 'the test table is not 2-seat multiplayer');
  const take = applyOperation(st, { kind: 'AUCTION_START', deckType: 'thruster' }, { profileId: actor(st) });
  assert(take.ok, `the research take was refused: ${take.error}`);
  assert(!take.state.auction, 'Hermes multiplayer opened a competitive auction');
  assert(/took .* aqua/i.test(take.log || ''), `not a direct take: ${take.log}`);

  // The reported case: Research Grants asked for, law not usable -> must fall
  // back to the take, never to an auction.
  const st2 = draft({ maxRounds: 2, hermes: true });
  const grants = applyOperation(st2, { kind: 'AUCTION_START', deckType: 'thruster', useEquality: true },
    { profileId: actor(st2) });
  assert(grants.ok, `a refused-grants request errored: ${grants.error}`);
  assert(!grants.state.auction, 'a Research Grants request with no usable law opened an auction in Hermes');

  // Zero bleed-through: an ordinary multiplayer game still auctions.
  const plain = draft({ maxRounds: 5 });
  const auc = applyOperation(plain, { kind: 'AUCTION_START', deckType: 'thruster' }, { profileId: actor(plain) });
  assert(auc.ok, `an ordinary auction was refused: ${auc.error}`);
  assert(!!auc.state.auction, 'an ordinary multiplayer game stopped auctioning');
  return 'Hermes takes at 1 aqua/card; ordinary games still auction';
});

// A meeting place is any space two players BOTH occupy, with ANY of their units.
// Trading only ever compared ROCKETS, so two outposts on the same rock - or a
// freighter meeting a Bernal - were not a meeting place at all (user
// 2026-08-03: "all of those combinations of two players being in the same spot
// should make for valid meeting places").
check('any two colocated units make a meeting place, not just rockets', () => {
  const SITE = 'ceres';
  const ELSEWHERE = 'vesta';
  // Park each player's units, then ask whether an in-space trade is allowed.
  // TRADE_OFFER refuses with fuel_needs_site when there is no shared SITE.
  const tryTrade = (placeA, placeB) => {
    let st = startedGame({ seats: 2, m1: true, m2: true });
    st.activeIndex = 0;
    const [A, B] = st.players;
    // Everything starts far apart; each case then plants one unit at SITE.
    for (const p of [A, B]) {
      p.rocket.siteId = ELSEWHERE;
      p.outposts = {};
      p.bernals = [];
      p.freighter = null;
      p.aqua = 20;
      p.rocket.tank = 5;
    }
    placeA(A); placeB(B);
    const r = applyOperation(st, {
      kind: 'TRADE_OFFER', partnerId: B.profileId,
      give: { water: 1 }, receive: { aqua: 1 },
    }, { profileId: A.profileId });
    return r;
  };
  const atRocket   = (p) => { p.rocket.siteId = SITE; };
  const atOutpost  = (p) => { p.outposts = { A: { letter: 'A', siteId: SITE, cards: [], tank: 0 } }; };
  const atFreighter= (p) => { p.freighter = { cardId: null, face: 'primary', siteId: SITE, stack: [], tank: 0, wiring: {}, route: [] }; };
  const atBernal   = (p) => { p.bernals = [{ cardId: null, figure: 'kalpana', face: 'primary', anchored: true, siteId: SITE, stack: [], tank: 0, wiring: {}, route: [] }]; };

  const cases = [
    ['rocket / rocket',       atRocket,    atRocket],
    ['outpost / rocket',      atOutpost,   atRocket],
    ['outpost / outpost',     atOutpost,   atOutpost],
    ['freighter / rocket',    atFreighter, atRocket],
    ['freighter / freighter', atFreighter, atFreighter],
    ['freighter / bernal',    atFreighter, atBernal],
    ['bernal / rocket',       atBernal,    atRocket],
    ['bernal / bernal',       atBernal,    atBernal],
    ['bernal / outpost',      atBernal,    atOutpost],
  ];
  const bad = [];
  for (const [name, a, b] of cases) {
    const r = tryTrade(a, b);
    // fuel_needs_site is the "no shared site" refusal. Any OTHER outcome means
    // the meeting place was found (the offer may still fail later validation,
    // which is not what this check is about).
    if (!r.ok && r.error === 'fuel_needs_site') bad.push(name);
  }
  assert(!bad.length, `no meeting place found for: ${bad.join('; ')}`);

  // ...and genuinely separated players still have none.
  const apart = tryTrade((p) => { p.rocket.siteId = SITE; }, (p) => { p.rocket.siteId = ELSEWHERE; });
  assert(!apart.ok && apart.error === 'fuel_needs_site',
    `players at different sites traded fuel anyway: ${apart.ok ? 'accepted' : apart.error}`);
  return `${cases.length} unit pairings meet; separated players still cannot`;
});

check('a Cargo Transfer rolls for each glitched end', () => {
  const SITE = 'ceres';
  const build = ({ rocketGlitch = false, outpostGlitch = false } = {}) => {
    const st = startedGame({ seats: 2 });
    st.activeIndex = 0;
    const me = st.players[0];
    me.rocket.siteId = SITE;
    me.rocket.tank = 0;
    me.rocket.glitch = rocketGlitch;
    // Give each end a spread of rad-hardness so any roll takes something.
    const pick = (skip) => {
      const out = [];
      for (let hard = 1; hard <= 6; hard += 1) {
        const c = PATENTS.find((x) => x.type !== 'radiator'
          && (((x.faces && x.faces.primary && x.faces.primary.radHardness) ?? x.radHardness) | 0) === hard
          && !skip.has(x.id) && !out.some((o) => o.id === x.id));
        if (c) { out.push({ id: c.id, kind: 'patent', face: 'primary' }); skip.add(c.id); }
      }
      return out;
    };
    const used = new Set();
    me.rocket.stack = pick(used);
    me.outposts = { A: { letter: 'A', siteId: SITE, cards: pick(used), tank: 0, glitch: outpostGlitch } };
    assert(me.rocket.stack.length >= 4 && me.outposts.A.cards.length >= 4,
      'not enough rad-hardness spread on both ends');
    return st;
  };
  const move = (st) => {
    const me = st.players[0];
    const id = me.outposts.A.cards[0].id;
    return applyOperation(st, { kind: 'TRANSFER', cardIds: [id], from: 'outpostA', to: 'rocket' },
      { profileId: me.profileId });
  };

  // Neither end glitched: no roll at all, and the card just moves.
  const clean = move(build());
  assert(clean.ok, `a clean transfer was refused: ${clean.error}`);
  assert(!/Glitch roll/i.test(clean.log || ''),
    `an unglitched transfer rolled anyway: ${clean.log}`);

  // Only the RECEIVING end glitched.
  const rk = move(build({ rocketGlitch: true }));
  assert(rk.ok, `transfer into a glitched rocket was refused: ${rk.error}`);
  assert((rk.log.match(/Glitch roll/gi) || []).length === 1,
    `expected exactly one roll for one glitched end: ${rk.log}`);

  // Only the SENDING end glitched.
  const op = move(build({ outpostGlitch: true }));
  assert(op.ok, `transfer out of a glitched outpost was refused: ${op.error}`);
  assert((op.log.match(/Glitch roll/gi) || []).length === 1,
    `expected exactly one roll for the sending end: ${op.log}`);

  // BOTH ends glitched: one roll each.
  const both = move(build({ rocketGlitch: true, outpostGlitch: true }));
  assert(both.ok, `a both-glitched transfer was refused: ${both.error}`);
  assert((both.log.match(/Glitch roll/gi) || []).length === 2,
    `expected a roll for each glitched end: ${both.log}`);
  return 'none / one / one / two rolls as each end glitches';
});

check('a glitch rolls for the stack that acted, not one parked elsewhere', () => {
  const AWAY = 'ceres';       // where the glitched rocket sits
  const HERE = 'vesta';       // where the refuel actually happens
  assert(siteBySlug(AWAY) && siteBySlug(HERE), 'the two test sites must exist');

  // A rocket loaded with cards of EVERY rad-hardness, so any 1d6 roll would
  // take something - if a roll happens at all, this notices.
  const build = () => {
    const st = startedGame({ seats: 2 });
    st.activeIndex = 0;
    const me = st.players[0];
    me.rocket.siteId = AWAY;
    me.rocket.glitch = true;
    me.rocket.tank = 0;
    const stack = [];
    for (let hard = 1; hard <= 6; hard += 1) {
      const c = PATENTS.find((x) => x.type !== 'radiator'
        && (((x.faces && x.faces.primary && x.faces.primary.radHardness) ?? x.radHardness) | 0) === hard
        && !stack.some((s) => s.id === x.id));
      if (c) stack.push({ id: c.id, kind: 'patent', face: 'primary' });
    }
    assert(stack.length >= 4, `not enough rad-hardness spread to test (${stack.length})`);
    me.rocket.stack = stack;
    // An outpost at the OTHER site, which is the stack that will act, standing
    // on a factory of the player's own so the refuel actually goes through - a
    // refused op would prove nothing either way.
    me.outposts = { A: { letter: 'A', siteId: HERE, cards: [], tank: 0 } };
    st.factories[HERE] = { ownerId: me.profileId, spectralType: (siteBySlug(HERE) || {}).spectralType || 'C' };
    me.refueledSites = [];
    me.opsRemaining = Math.max(1, me.opsRemaining | 0);
    return st;
  };

  // The refuel names a site the rocket is NOT at. Whatever the op's own verdict
  // is (it may well be refused for unrelated reasons), the rocket must be
  // untouched and no die may have been spent on it.
  let st = build();
  const before = st.players[0].rocket.stack.map((s) => s.id);
  const away = applyOperation(st, { kind: 'SITE_REFUEL', siteId: HERE, mode: 'isru', outpost: 'A' },
    { profileId: st.players[0].profileId });
  assert(away.ok, `the outpost refuel was refused, so this proves nothing: ${away.error}`);
  const afterState = away.state;
  const after = afterState.players[0].rocket.stack.map((s) => s.id);
  assert(after.length === before.length,
    `the far-away rocket lost cards to someone else's refuel: ${before.length} -> ${after.length}`);
  assert(!/Glitch roll/i.test(away.log || ''),
    `a glitch roll fired for a stack that did not act: ${away.log}`);

  // ...and the rocket DOES roll when it is the one refuelling, so this is a
  // real "who acted" test rather than the trigger being switched off.
  st = build();
  st.players[0].rocket.siteId = HERE;
  delete st.players[0].outposts;
  const here = applyOperation(st, { kind: 'SITE_REFUEL', siteId: HERE, mode: 'factory' },
    { profileId: st.players[0].profileId });
  assert(here.ok, `the rocket's own factory refuel was refused: ${here.error}`);
  assert(/Glitch roll/i.test(here.log || ''),
    `the acting glitched rocket did not roll, so the trigger is just off: ${here.log}`);
  return 'idle stack spared, acting stack rolled';
});

// V9b: "any modules EXCEPT Module 0". A multiplayer Sirens table runs no Sol
// Political Assembly - not the opt-in, and not the one Module 2 would otherwise
// force on (user 2026-08-01, choosing "no Assembly at all in Sirens"). The
// SOLITAIRE route keeps its own, because a one-seat Sirens room is CEO
// Solitaire and the board meetings ARE that assembly.
check('a Sirens table seats no Assembly, even under Module 2', () => {
  // Module 2 forces m0 on for every other game; Sirens must override it.
  const mp = createInitialState({
    players: [{ profileId: 1, name: 'P1', seat: 1 }, { profileId: 2, name: 'P2', seat: 2 }],
    seed: 'check-engine', maxRounds: 7, sirens: true, m1: true, m2: true,
  });
  assert(mp.m2 === true, 'the test table is not actually an M2 game');
  assert(mp.m0 === false, `a Sirens M2 table switched Module 0 on (m0=${mp.m0})`);
  assert(!mp.assembly, 'a Sirens M2 table seated an Assembly');

  // An ordinary M2 game is untouched - M2 still requires the Assembly.
  const plain = createInitialState({
    players: [{ profileId: 1, name: 'P1', seat: 1 }, { profileId: 2, name: 'P2', seat: 2 }],
    seed: 'check-engine', maxRounds: 7, m1: true, m2: true,
  });
  assert(plain.m0 === true && !!plain.assembly,
    `an ordinary M2 game lost its Assembly (m0=${plain.m0} assembly=${!!plain.assembly})`);

  // The solitaire route keeps its own assembly (it IS the board meeting).
  const solo = createInitialState({
    players: [{ profileId: 1, name: 'P1', seat: 1 }],
    seed: 'check-engine', maxRounds: 7, sirens: true, m1: true, m2: true,
  });
  assert(solo.ceoSolo === true, 'a one-seat Sirens room did not take the CEO route');
  assert(solo.m0 === true && !!solo.assembly,
    `solitaire Sirens lost its own Assembly (m0=${solo.m0} assembly=${!!solo.assembly})`);

  // RETROACTIVE: a table already carrying an Assembly is cleared on the next op.
  const broken = createInitialState({
    players: [{ profileId: 1, name: 'P1', seat: 1 }, { profileId: 2, name: 'P2', seat: 2 }],
    seed: 'check-engine', maxRounds: 7, sirens: true, m1: true, m2: true,
  });
  broken.m0 = true;
  broken.assembly = { delegates: { freedom: { 1: 1 } }, tally: {} };
  broken.activeLawStar = 'freedom';
  let st = broken;
  // The repairs run on the FIRST op that touches the game, whichever it is -
  // they moved ahead of the op handler so a damaged board cannot refuse the
  // very op that would fix it. So collect every log and look for the narration
  // across them rather than pinning it to one.
  const logs = [];
  for (const p of [...st.players]) {
    const card = CREW.find((c) => c.color === p.color) || CREW[0];
    const r0 = applyOperation(st, { kind: 'PICK_CREW', cardId: card.id, face: 'primary', species: 'siren' },
      { profileId: p.profileId });
    assert(r0.ok, `PICK_CREW rejected: ${r0.error}`);
    logs.push(r0.log || '');
    st = r0.state;
  }
  const r = applyOperation(st, { kind: 'INCOME' },
    { profileId: st.players[st.activeIndex].profileId });
  assert(r.ok, `INCOME rejected: ${r.error}`);
  logs.push(r.log || '');
  assert(r.state.m0 === false, `the retro repair left Module 0 on (m0=${r.state.m0})`);
  assert(!r.state.assembly, 'the retro repair left the Assembly standing');
  assert(!r.state.activeLawStar, 'the retro repair left a law in force');
  assert(logs.some((l) => /Assembly was dissolved/i.test(l)), `the repair was silent: ${JSON.stringify(logs)}`);
  return 'no Assembly at 2 seats, kept at 1, dissolved retroactively';
});

// I3b: a Black-Side good sells on the Free Market from the LEO Stack OR an
// anchored Home Bernal - both are boost / boarding stations (2A6). Only LEO was
// searched, so a product manufactured into the colony could never be sold (user
// 2026-08-01: "can't sell black card in home Bernal").
check('a Black-Side good sells from the Home Bernal, not just LEO', () => {
  const HOME_NODE = 'burn-geo';   // a tagged home orbit
  // A card whose BLACK face is the secondary one (i.e. not a GW thruster /
  // Freighter, whose secondary is the purple promoted side).
  const good = PATENTS.find((c) => c.faces && c.faces.secondary
    && c.type !== 'gw-thruster' && c.type !== 'freighter' && c.type !== 'colonist');
  assert(!!good, 'no two-faced patent to sell');

  const build = (where) => {
    const st = startedGame({ seats: 2, m1: true, m2: true });
    // Seat ORDER is shuffled, so act as whoever the engine says is up.
    const me = st.players[st.activeIndex];
    me.aqua = 0;
    me.opsRemaining = Math.max(1, me.opsRemaining | 0);
    me.leo = [];
    const slot = { id: good.id, kind: 'patent', face: 'secondary' };
    me.bernals = [{
      cardId: (PATENTS.find((c) => c.type === 'bernal') || {}).id, figure: 'kalpana',
      face: 'primary', promoted: false, anchored: true, siteId: HOME_NODE,
      stack: [], tank: 0, wiring: {}, route: [],
    }];
    if (where === 'leo') me.leo.push(slot);
    else me.bernals[0].stack.push(slot);
    return st;
  };

  // From LEO: the behaviour that already worked, as the control.
  const leoState = build('leo');
  const actorOf = (state) => state.players[state.activeIndex].profileId;
  const fromLeo = applyOperation(leoState, { kind: 'FREE_MARKET', leoCardId: good.id },
    { profileId: actorOf(leoState) });
  assert(fromLeo.ok, `selling from LEO broke: ${fromLeo.error}`);
  const leoAqua = fromLeo.state.players[fromLeo.state.activeIndex].aqua | 0;
  assert(leoAqua > 0, `the LEO sale paid nothing (${leoAqua})`);

  // From the anchored Home Bernal: the reported case.
  const st = build('bernal');
  assert(st.players[st.activeIndex].bernals[0].stack.length === 1, 'the good is not in the Home Bernal');
  const fromHome = applyOperation(st, { kind: 'FREE_MARKET', leoCardId: good.id },
    { profileId: actorOf(st) });
  assert(fromHome.ok, `selling from the Home Bernal was refused: ${fromHome.error}`);
  const after = fromHome.state.players[fromHome.state.activeIndex];
  assert((after.aqua | 0) === leoAqua,
    `the Home Bernal sale paid a different price: ${after.aqua} vs ${leoAqua} at LEO`);
  assert((after.bernals[0].stack || []).length === 0, 'the good stayed in the Home Bernal');
  assert((after.hand || []).includes(good.id), 'the card did not return to hand');
  assert(/Home Bernal/i.test(fromHome.log || ''), `the log does not name the source: ${fromHome.log}`);

  // An UNANCHORED Bernal is not a station, so it sells nothing.
  const loose = build('bernal');
  loose.players[loose.activeIndex].bernals[0].anchored = false;
  const refused = applyOperation(loose, { kind: 'FREE_MARKET', leoCardId: good.id },
    { profileId: actorOf(loose) });
  assert(!refused.ok && refused.error === 'not_in_leo',
    `an unanchored Bernal sold anyway: ${refused.ok ? 'accepted' : refused.error}`);
  return `sold for ${leoAqua} from LEO and from the Home Bernal alike`;
});

check('an all-Siren table keeps a single library', () => {
  let st = startedGame({ sirens: true });
  st.draftPhase = 'crew';
  st.players.forEach((p) => { p.faction = null; });
  st.players.forEach((p, i) => {
    const card = CREW.find((c) => c.color === p.color) || CREW[i];
    const r = applyOperation(st, { kind: 'PICK_CREW', cardId: card.id, face: 'primary', species: 'siren' },
      { profileId: p.profileId });
    assert(r.ok, `PICK_CREW rejected: ${r.error}`);
    st = r.state;
  });
  assert(st.players.every((p) => p.species === 'siren'), 'not everyone is a Siren');
  assert(st.sirenDecks === undefined, 'an all-Siren table split its library anyway');
  // ...and the SAME table split the moment an Earthling joins it, so this is a
  // real condition rather than the cut being broken outright.
  st.players[st.players.length - 1].species = 'earthling';
  const r = applyOperation(st, { kind: 'INCOME' },
    { profileId: st.players[st.activeIndex].profileId });
  assert(r.ok, `INCOME rejected: ${r.error}`);
  assert(r.state.sirenDecks, 'the table did not split once an Earthling was seated');
  return 'no split until an Earthling sits down';
});

// "Earthlings cannot touch Siren decks and vice versa": an auction run off one
// species' library is closed to the other species.
check('the other species cannot bid on a split-library lot', () => {
  // THREE seats, two of them Earthlings. With only one member of a species there
  // is nobody who could bid anyway, and the V4c substitute takes over (see the
  // sole-species check below), so a contested species is needed to have a real
  // auction to be refused from.
  let st = sirensGame(['earthling', 'siren', 'earthling']);
  const earth = st.players[0];
  const siren = st.players[1];
  st.activeIndex = st.players.indexOf(earth);
  earth.aqua = 20; siren.aqua = 20;
  const deckType = Object.keys(st.decks).find((t) => (st.decks[t] || []).length);
  const start = applyOperation(st, { kind: 'AUCTION_START', deckType }, { profileId: earth.profileId });
  assert(start.ok, `AUCTION_START rejected: ${start.error}`);
  st = start.state;
  const bid = applyOperation(st, { kind: 'AUCTION_BID', amount: 1 }, { profileId: siren.profileId });
  assert(bid.error === 'other_species_deck', `the Siren bid on the Earthling deck (${bid.error || 'accepted'})`);
  // ...and an ineligible seat must NOT hold the lot open. If they counted as a
  // bidder still on the clock, the auctioneer could never close and the table
  // would deadlock on a player who is not allowed to act.
  const own = applyOperation(st, { kind: 'AUCTION_BID', amount: 1 }, { profileId: earth.profileId });
  assert(own.ok, `the auctioneer could not bid on their own lot: ${own.error}`);
  // The SECOND Earthling is a legitimate bidder and must act - only the Siren
  // should be excused. If the Siren were still counted, this pass would not be
  // enough and the sell below would come back bidders_pending.
  const rival = st.players[2];
  const passed = applyOperation(own.state, { kind: 'AUCTION_PASS' }, { profileId: rival.profileId });
  assert(passed.ok, `the same-species rival could not pass: ${passed.error}`);
  const sell = applyOperation(passed.state, { kind: 'AUCTION_SELL', buyerId: earth.profileId },
    { profileId: earth.profileId });
  assert(sell.ok, `the lot deadlocked on the ineligible seat: ${sell.error}`);
  return 'refused, and no deadlock';
});

// V9b: the three claims the variant seeds cannot be re-prospected with special
// abilities. Mine Revival is the one that exists today; a claim a player busted
// in PLAY is still revivable, so the guard must read the marker, not the site.
check('Siren busted claims resist Mine Revival', () => {
  const st = sirensGame();
  const p = st.players[st.activeIndex];
  st.discs.ceres = { outcome: 'fail', ownerId: null, ts: 0 };   // an ordinary bust
  const attempt = (siteId) => {
    const s2 = JSON.parse(JSON.stringify(st));
    const me = s2.players[s2.activeIndex];
    me.rocket.siteId = siteId;
    me.opsRemaining = 4;
    return applyOperation(s2, { kind: 'MINE_REVIVAL', siteId }, { profileId: me.profileId });
  };
  assert(attempt('luna-aristarchus-plateau').error === 'siren_busted_claim',
    `Luna's seeded claim was revivable (${attempt('luna-aristarchus-plateau').error || 'accepted'})`);
  assert(attempt('cordelia').error === 'siren_busted_claim', "Cordelia's seeded claim was revivable");
  // An ordinary busted claim must still fail for its OWN reasons (no termite
  // aboard here), never for the Sirens one - that is what proves the guard is
  // reading the marker rather than blanket-blocking the op.
  assert(attempt('ceres').error !== 'siren_busted_claim',
    'an ordinary busted claim was treated as a seeded Sirens claim');
  return 'seeded blocked, ordinary untouched';
});

// V9 contact rules: First Contact, Heroism and Technology Trade all fire when a
// player ENDS their turn with a Human standing where the other species has one.
check('meeting the other species pays First Contact and a Technology Trade', () => {
  let st = sirensGame();
  const earthIdx = st.players.findIndex((p) => p.species === 'earthling');
  const earth = st.players[earthIdx];
  const siren = st.players.find((p) => p.species === 'siren');
  // Stand a crew of each species on the same site.
  const crewSlot = (p) => ({ id: p.faction.cardId, kind: 'crew', face: 'primary' });
  earth.rocket.siteId = 'ceres';
  earth.rocket.stack = [crewSlot(earth)];
  siren.rocket.siteId = 'ceres';
  siren.rocket.stack = [crewSlot(siren)];
  st.activeIndex = earthIdx;
  const handBefore = (earth.hand || []).length;
  const sirenDeckBefore = Object.values(st.sirenDecks).reduce((n, d) => n + d.length, 0);
  const r = applyOperation(st, { kind: 'END_TURN' }, { profileId: earth.profileId });
  assert(r.ok, `END_TURN rejected: ${r.error}`);
  const after = r.state.players[earthIdx];
  assert(r.state.sirenFirstContact, 'first contact was not recorded');
  // The heroism chit is its OWN kind worth a flat 2 VP - not a heliocentric zone
  // chit. It must not consume a zone, must not need a carrier, and must score
  // straight away rather than waiting to ride home.
  const claimed = (after.glory && after.glory.claimed) || [];
  const hero = claimed.find((c) => c.kind === 'heroism');
  assert(hero, 'no heroism chit was banked');
  assert(hero.vp === 2, `the heroism chit is worth ${hero.vp}, want 2`);
  assert(!(after.glory.visited || []).includes('Heroism'), 'the heroism chit consumed a heliocentric zone');
  assert(hero.crewId == null, 'the heroism chit was bound to a carrier');
  const board = liveScoreboard(r.state).players.find((x) => x.profileId === earth.profileId);
  assert(board.gloryVp >= 2, `the heroism chit did not reach the scoreboard (gloryVp ${board.gloryVp})`);
  assert((after.hand || []).length === handBefore + 1,
    `Technology Trade did not draw a card (${handBefore} -> ${(after.hand || []).length})`);
  const sirenDeckAfter = Object.values(r.state.sirenDecks).reduce((n, d) => n + d.length, 0);
  assert(sirenDeckAfter === sirenDeckBefore - 1,
    'the Technology Trade card did not come off the SIREN library');
  assert(/First contact/.test(r.log) && /Technology Trade/.test(r.log),
    `the log does not mention both rules: ${r.log}`);
  return 'contact + trade';
});

// ...and none of that fires when the two species are nowhere near each other.
check('no contact rules fire without a meeting', () => {
  let st = sirensGame();
  const idx = st.players.findIndex((p) => p.species === 'earthling');
  const earth = st.players[idx];
  earth.rocket.siteId = 'ceres';
  earth.rocket.stack = [{ id: earth.faction.cardId, kind: 'crew', face: 'primary' }];
  st.activeIndex = idx;
  const before = (earth.hand || []).length;
  const r = applyOperation(st, { kind: 'END_TURN' }, { profileId: earth.profileId });
  assert(r.ok, `END_TURN rejected: ${r.error}`);
  assert(!r.state.sirenFirstContact, 'first contact fired with nobody to meet');
  assert((r.state.players[idx].hand || []).length === before, 'a Technology Trade card appeared anyway');
  return 'clean';
});

// V9c: the ONLY member of a species has nobody who can bid on a lot off their
// library, so the Research Auction falls back to the V4c substitute - take the
// top card for 1 aqua per card taken, no bidding.
check('a sole-species player takes rather than auctions', () => {
  let st = sirensGame();
  const idx = st.players.findIndex((p) => p.species === 'siren');
  const me = st.players[idx];
  st.activeIndex = idx;
  me.aqua = 20;
  const deckType = Object.keys(st.sirenDecks).find((t) => (st.sirenDecks[t] || []).length);
  const before = st.sirenDecks[deckType].length;
  const r = applyOperation(st, { kind: 'AUCTION_START', deckType }, { profileId: me.profileId });
  assert(r.ok, `AUCTION_START rejected: ${r.error}`);
  assert(!r.state.auction, 'an auction opened for a sole-species player instead of a straight take');
  assert((r.state.players[idx].hand || []).length > 0, 'no card landed in hand');
  assert(r.state.sirenDecks[deckType].length < before, 'the card did not come off the Siren library');
  assert(/took/.test(r.log), `the log does not read as a take: ${r.log}`);
  return 'took the top card';
});

// ...but with a rival of the SAME species the normal competitive auction runs.
check('a contested species still auctions normally', () => {
  let st = startedGame({ sirens: true });
  st.draftPhase = 'crew';
  st.players.forEach((p) => { p.faction = null; });
  st.players.forEach((p, i) => {
    const card = CREW.find((c) => c.color === p.color) || CREW[i];
    st = applyOperation(st, { kind: 'PICK_CREW', cardId: card.id, face: 'primary', species: 'siren' },
      { profileId: p.profileId }).state;
  });
  // All-Siren: no split, so nobody is "the only player of their species".
  const me = st.players[st.activeIndex];
  me.aqua = 20;
  const deckType = Object.keys(st.decks).find((t) => (st.decks[t] || []).length);
  const r = applyOperation(st, { kind: 'AUCTION_START', deckType }, { profileId: me.profileId });
  assert(r.ok, `AUCTION_START rejected: ${r.error}`);
  assert(r.state.auction, 'no auction opened for a contested species');
  return 'auction opened';
});

// V9's SOLITAIRE deck split is a different rule from the multiplayer one: the
// Sirens take all D and V patents and the Earthlings the remainder, rather than
// each deck being cut in half. The helper is in place ahead of the solo route
// itself; this pins the rule so the two cuts do not get confused later.
check('the solitaire split cuts by spectral, not by halves', () => {
  const spectralOf = (id) => (PATENTS_BY_ID_LOCAL[id] || {}).spectralType || 'C';
  const ids = PATENTS.map((c) => c.id);
  const cut = splitDeckForSoloSpecies(ids, spectralOf);
  assert(cut.earthling.length + cut.siren.length === ids.length, 'the solo cut lost or duplicated cards');
  assert(cut.siren.every((id) => SIREN_SOLO_SPECTRALS.includes(spectralOf(id))),
    'a non-D/V card ended up in the Siren pile');
  assert(cut.earthling.every((id) => !SIREN_SOLO_SPECTRALS.includes(spectralOf(id))),
    'a D or V card was left with the Earthlings');
  assert(cut.siren.length > 0 && cut.earthling.length > 0, 'one side got nothing');
  return `${cut.siren.length} D/V vs ${cut.earthling.length}`;
});

// V9b solitaire route: a ONE-SEAT Sirens room runs the CEO loop without the host
// ticking a second variant, and its libraries are cut by SPECTRAL type rather
// than in half (user decision 2026-07-28).
check('a one-seat Sirens room runs the CEO loop', () => {
  let st = startedGame({ sirens: true, seats: 1 });
  assert(st.sirens === true, 'the sirens flag was lost');
  assert(st.ceoSolo === true, 'a solo Sirens room did not turn on the CEO loop');
  assert(st.m0 === true, 'the CEO loop did not bring its solitaire assembly');
  assert(st.seniorityCycle > 0, 'the CEO seniority clock is missing');
  assert(st.demandPile, 'the CEO demand pile is missing');
  assert(Array.isArray(st.ceoBoardHistory), 'the CEO board history is missing');
  return 'ceoSolo on';
});

check('the solo Sirens libraries are cut by spectral', () => {
  let st = startedGame({ sirens: true, seats: 1 });
  st.draftPhase = 'crew';
  st.players.forEach((p) => { p.faction = null; });
  const p0 = st.players[0];
  const card = CREW.find((c) => c.color === p0.color) || CREW[0];
  const r = applyOperation(st, { kind: 'PICK_CREW', cardId: card.id, face: 'primary', species: 'siren' },
    { profileId: p0.profileId });
  assert(r.ok, `PICK_CREW rejected: ${r.error}`);
  st = r.state;
  assert(st.sirenDecks, 'a solo Sirens game did not split its libraries');
  const spectralOf = (id) => (PATENTS_BY_ID_LOCAL[id] || {}).spectralType || 'C';
  let sirenCards = 0;
  for (const [type, cards] of Object.entries(st.sirenDecks)) {
    for (const id of cards) {
      assert(SIREN_SOLO_SPECTRALS.includes(spectralOf(id)),
        `a ${spectralOf(id)} card sits in the Siren ${type} deck - the solo cut should be D/V only`);
      sirenCards += 1;
    }
  }
  for (const cards of Object.values(st.decks)) {
    for (const id of cards) {
      assert(!SIREN_SOLO_SPECTRALS.includes(spectralOf(id)),
        'a D or V card was left with the Earthlings in the solo cut');
    }
  }
  assert(sirenCards > 0, 'the Sirens got no cards at all');
  return `${sirenCards} D/V cards`;
});

// A one-seat NORMAL room must not acquire the CEO loop off a player count.
check('a one-seat normal room is untouched', () => {
  const st = startedGame({ seats: 1 });
  assert(st.ceoSolo !== true, 'a plain solo room turned into CEO Solitaire');
  assert(st.sirenDecks === undefined, 'a plain solo room split its libraries');
  return 'clean';
});

// A PUSH COLONY is a colony with a push-sat (the card property), and a Sirenian
// dome there scores +3 rather than +1. Scored through the live engine tally so
// this covers the site scan as well as the arithmetic.
check('a Siren dome at a push-sat colony scores 3, and 1 without one', () => {
  const pushCard = PATENTS.find((c) => {
    const f = c.faces && c.faces.primary;
    return f && Array.isArray(f.properties) && f.properties.some((p) => p.key === 'push' && p.value);
  });
  assert(pushCard, 'no card carries the push-sat property');
  const build = (withPushSat) => {
    const st = sirensGame();
    const idx = st.players.findIndex((p) => p.species === 'siren');
    const me = st.players[idx];
    st.colonies = { ceres: { ownerId: me.profileId, type: 'other' } };
    // An outpost at the site, with or without the push-sat aboard.
    me.outposts = { A: { letter: 'A', siteId: 'ceres', cards: withPushSat
      ? [{ id: pushCard.id, kind: 'patent', face: 'primary' }] : [], tank: 0 } };
    return { st, id: me.profileId };
  };
  const scoreOf = ({ st, id }) => {
    const row = liveScoreboard(st).players.find((r) => r.profileId === id);
    assert(row, 'the scoreboard has no row for the Siren');
    return row;
  };
  const withPush = scoreOf(build(true));
  const without = scoreOf(build(false));
  // colonyVp is the LOCATION bonus above the flat +1 dome token: 2 at a push
  // colony (total 3), 0 otherwise (total 1).
  assert(withPush.colonyVp === 2, `push-sat colony scored ${withPush.colonyVp} bonus, want 2`);
  assert(without.colonyVp === 0, `plain colony scored ${without.colonyVp} bonus, want 0`);
  return '3 vs 1';
});

// "Diamonds Aren't Forever": a Siren's Crew and Colonists are CONSIDERED
// rad-hard 0. Robots are NOT Sirens - they are hardware - so they keep their
// printed rating. Exercised through a real Solar Flare, which is the roll that
// actually reads the modifier.
check('a Siren loses crew and human colonists to a flare, but not robots', () => {
  // Drive a REAL Solar Flare (roll 1) rather than hoping the clock rolls one.
  // With the modifier applied a Siren's crew and human colonist are considered
  // rad-hard 0 and both fall to a 1; the ROBOT keeps its printed rating and
  // survives. Without the modifier the crew card prints 4 and nothing would die,
  // so this fails loudly if the rule is removed.
  const st = sirensGame(['siren', 'earthling']);
  const me = st.players[0];
  assert(me.species === 'siren', 'seat 0 is not the Siren');
  const printedCrew = (CREW.find((c) => c.id === me.faction.cardId).faces.primary.radHardness) | 0;
  assert(printedCrew > 1, `this crew card prints rad ${printedCrew}; the test needs > 1 to be meaningful`);
  // A rocket parked at a SITE rides out a flare (Bunker Shielding), and the
  // flare's bite scales with the solar zone, so the stack has to be caught in
  // the open in the EARTH zone (solar modifier 0) for a roll of 3 to land as 3.
  // Not burn-ue3lc, which is flare-sheltered inside Earth's belt.
  me.rocket.siteId = 'lag-w6ybr';
  const sirenHuman = 'col_biomechs';
  me.rocket.stack = [
    { id: me.faction.cardId, kind: 'crew', face: 'primary' },
    { id: sirenHuman, kind: 'colonist', face: 'primary' },
    { id: 'col_babbage_halbonauts', kind: 'colonist', face: 'primary' },
  ];
  st.activeIndex = 0;
  // Roll 3: the printed ratings here are crew 4, human colonist 4, robot 5, so
  // WITHOUT the modifier nothing would be lost. With it the two Sirens are
  // considered 0 and both fall, while the robot's real 5 rides it out.
  st.pendingEvent = { kind: 'solar_flare', waiting: [me.profileId], options: {}, flareRoll: 3 };
  st.lastEvent = { kind: 'solar_flare', notes: [] };
  const r = applyOperation(st, { kind: 'EVENT_CHOICE' }, { profileId: me.profileId });
  assert(r.ok, `EVENT_CHOICE rejected: ${r.error}`);
  const after = r.state.players[0].rocket.stack.map((sl) => sl.id);
  assert(after.includes('col_babbage_halbonauts'), 'the ROBOT was lost - robots are not Sirens');
  assert(!after.includes(sirenHuman), 'the human colonist survived a flare at rad-hard 0');
  assert(!after.includes(me.faction.cardId), 'the Siren crew survived a flare at rad-hard 0');
  return `printed rad ${printedCrew} -> considered 0, robot untouched`;
});

// PROVENANCE. Which library a card came out of belongs to the CARD for the whole
// game: a Technology Trade does not launder a Siren patent into an Earthling
// one, and a colonist out of the Siren queue stays rad-hard 0 in an Earthling's
// stack ("Colonists from the SIREN QUEUE", not "colonists owned by a Siren").
check('the Siren library stamps its cards for the rest of the game', () => {
  const st = sirensGame(['siren', 'earthling'], { m0: true, m1: true, m2: true });
  const origin = st.sirenOrigin;
  assert(Array.isArray(origin) && origin.length, 'no provenance was recorded at the split');
  const ids = new Set(origin);
  // Every card in the Siren half is stamped, and nothing in the Earthling half is.
  for (const [type, cards] of Object.entries(st.sirenDecks)) {
    for (const id of cards) assert(ids.has(id), `${type} card ${id} is in the Siren deck but unstamped`);
  }
  for (const [type, cards] of Object.entries(st.decks)) {
    for (const id of cards) assert(!ids.has(id), `${type} card ${id} is in the Earthling deck but stamped Sirenian`);
  }
  // The Siren colonist queue is stamped too (M2 only - it is the queue the
  // rad-hard rule names).
  assert(Array.isArray(st.sirenColonistQueue) && st.sirenColonistQueue.length,
    'the M2 colonist queue did not split');
  for (const id of st.sirenColonistQueue) assert(ids.has(id), `queued colonist ${id} is unstamped`);
  return `${origin.length} cards stamped`;
});

check('a traded Siren colonist stays rad-hard 0 in an Earthling stack', () => {
  const pickHuman = (queue) => queue.find((id) => {
    const c = COLONISTS_BY_ID[id];
    return c && c.colonistKind === 'Human'
      && ((c.faces && c.faces.primary && c.faces.primary.radHardness) | 0) > 3;
  });
  const build = (which) => {
    const st = sirensGame(['siren', 'earthling'], { m0: true, m1: true, m2: true });
    const earthling = st.players[1];
    assert(earthling.species === 'earthling', 'seat 1 is not the Earthling');
    const id = which === 'siren' ? pickHuman(st.sirenColonistQueue) : pickHuman(st.colonistQueue);
    assert(id, `no human colonist printing rad > 3 in the ${which} queue`);
    // The EARTHLING is holding it either way - only provenance differs.
    earthling.rocket.siteId = 'lag-w6ybr';
    earthling.rocket.stack = [{ id, kind: 'colonist', face: 'primary' }];
    st.activeIndex = 1;
    st.pendingEvent = { kind: 'solar_flare', waiting: [earthling.profileId], options: {}, flareRoll: 3 };
    st.lastEvent = { kind: 'solar_flare', notes: [] };
    const r = applyOperation(st, { kind: 'EVENT_CHOICE' }, { profileId: earthling.profileId });
    assert(r.ok, `EVENT_CHOICE rejected: ${r.error}`);
    return { id, survived: r.state.players[1].rocket.stack.some((sl) => sl.id === id) };
  };
  const fromSirens = build('siren');
  const fromEarth = build('earthling');
  assert(!fromSirens.survived,
    'a Siren-queue colonist survived a flare in an Earthling stack - provenance was lost');
  assert(fromEarth.survived,
    'an Earthling-queue colonist died at rad-hard 0 - the rule leaked past the Siren queue');
  return 'origin, not owner';
});

// The GLITCH half. Dirtside the event fizzles entirely; in space the Sirens die
// AND the stack takes the disc (there is no Human left aboard to repair it).
check('a glitch in space kills the Sirens and lands a disc', () => {
  const run = (siteId) => {
    const st = sirensGame(['siren', 'earthling']);
    const me = st.players[0];
    assert(me.species === 'siren', 'seat 0 is not the Siren');
    me.rocket.siteId = siteId;
    me.rocket.glitch = false;
    me.rocket.stack = [
      { id: me.faction.cardId, kind: 'crew', face: 'primary' },
      { id: st.decks.thruster[0], kind: 'patent', face: 'primary' },
    ];
    st.activeIndex = 0;
    st.pendingEvent = { kind: 'glitch', waiting: [me.profileId], options: {} };
    st.lastEvent = { kind: 'glitch', notes: [] };
    const r = applyOperation(st, { kind: 'EVENT_CHOICE' }, { profileId: me.profileId });
    assert(r.ok, `EVENT_CHOICE rejected: ${r.error}`);
    const rk = r.state.players[0].rocket;
    return { glitched: !!rk.glitch, crewAboard: rk.stack.some((sl) => sl.id === me.faction.cardId) };
  };
  const inSpace = run('lag-w6ybr');
  assert(!inSpace.crewAboard, 'the Sirens survived a glitch in space');
  assert(inSpace.glitched, 'no glitch disc landed on a stack glitched in space');
  const onSite = run('ceres');
  assert(onSite.crewAboard, 'the Sirens died to a glitch while dirtside');
  assert(!onSite.glitched, 'a glitch disc landed dirtside, where the event should fizzle');
  return 'space: die + disc; site: nothing';
});

// Fuel cargo cards (canned water / isotope) are INERT propellant: no radiation
// event may touch them, and none may ever push their generated `fuel_N` id into
// a hand (it is not a catalog card, so it renders as a phantom). Reported
// 2026-07-31 from game 180: a Solar Flare ate 8 canned water at "rad 0 vs 3"
// and handed back a phantom card. The belt roll already had this rule; the
// flare and the Valkyrie purge did not.
// The Aqua bank reaches a BERNAL wherever it reaches the rocket: at LEO, and in
// the space of the player's anchored Home Bernal. Reported 2026-07-31: two
// Bernals in the home-bernal space and 51 aqua in the bank, with no way to get
// water into either - REFUEL was LEO-only for a Bernal, so the anchored Home
// Bernal itself stayed dry, and a bernal0 -> bernal1 TRANSFER_FUEL then failed
// `no_water`. The only way through was to route it via the ROCKET, which draws
// at that very spot (rocketAtRefuelDepot), so the restriction was inconsistent
// rather than protective.
check('a Bernal draws aqua in its Home Bernal space, not just at LEO', () => {
  let st = startedGame({ seats: 2 });
  const me = st.players[st.activeIndex];
  const orbit = 'lag-ctnib';
  me.aqua = 51;
  // bernal0 is the anchored Home Bernal; bernal1 is a second one beside it.
  me.bernals = [
    { cardId: 'ber_l1_climate_control_bernal', siteId: orbit, anchored: true, home: true, face: 'primary', stack: [], tank: 0 },
    { cardId: 'ber_tourism_cycler', siteId: orbit, anchored: false, face: 'primary', stack: [], tank: 0 },
  ];
  const r0 = applyOperation(st, { kind: 'REFUEL', unit: 'bernal0', amount: 3 }, { profileId: me.profileId });
  assert(r0.ok, `REFUEL of the anchored Home Bernal was refused: ${r0.error}`);
  const bn0 = r0.state.players.find((p) => p.profileId === me.profileId).bernals[0];
  assert(Number(bn0.tank) > 0, `the Home Bernal tank stayed empty: ${bn0.tank}`);
  // ...and so must the SECOND Bernal sharing that space (the reported case).
  const r1 = applyOperation(r0.state, { kind: 'REFUEL', unit: 'bernal1', amount: 2 }, { profileId: me.profileId });
  assert(r1.ok, `REFUEL of the colocated second Bernal was refused: ${r1.error}`);
  const bn1 = r1.state.players.find((p) => p.profileId === me.profileId).bernals[1];
  assert(Number(bn1.tank) > 0, `the second Bernal tank stayed empty: ${bn1.tank}`);
  return 'home bernal space reaches the bank';
});

// The gate still HOLDS off-depot - this widens the bank's reach, not removes it.
check('a Bernal in deep space still cannot reach the aqua bank', () => {
  let st = startedGame({ seats: 2 });
  const me = st.players[st.activeIndex];
  me.aqua = 51;
  me.bernals = [{ cardId: 'ber_l1_climate_control_bernal', siteId: 'lag-w6ybr', anchored: false, face: 'primary', stack: [], tank: 0 }];
  const r = applyOperation(st, { kind: 'REFUEL', unit: 'bernal0', amount: 3 }, { profileId: me.profileId });
  assert(!r.ok, 'a Bernal nowhere near a depot drew on the bank');
  assert(r.error === 'bernal_not_at_depot', `wrong refusal: ${r.error}`);
  return 'refused off-depot';
});

check('a Solar Flare never touches canned fuel', () => {
  let st = startedGame({ seats: 2 });
  const me = st.players[0];
  // Caught in the open in the Earth zone, the one place a flare can reach.
  me.rocket.siteId = 'lag-w6ybr';
  me.rocket.stack = [
    { id: 'fuel_1', kind: 'fuel', grade: 'water', amount: 8, face: 'primary' },
    { id: thruster.id, kind: 'patent' },
  ];
  me.hand = [];
  st.activeIndex = 0;
  st.pendingEvent = { kind: 'solar_flare', waiting: [me.profileId], options: {}, flareRoll: 3 };
  st.lastEvent = { kind: 'solar_flare', notes: [] };
  const r = applyOperation(st, { kind: 'EVENT_CHOICE' }, { profileId: me.profileId });
  assert(r.ok, `EVENT_CHOICE rejected: ${r.error}`);
  const after = r.state.players[0];
  const fuel = (after.rocket.stack || []).find((sl) => sl.kind === 'fuel');
  assert(fuel, 'the flare destroyed the canned fuel');
  assert(fuel.amount === 8, `the canned water changed: ${fuel.amount}`);
  assert(!(after.hand || []).some((id) => String(id).startsWith('fuel_')),
    `a phantom fuel card landed in the hand: ${JSON.stringify(after.hand)}`);
  assert(!/fuel_/.test(r.log || ''), `the flare log names a fuel card: ${r.log}`);
  return '8 water rode it out';
});

// Fuel is immune to a Pad Explosion too (user ruling 2026-07-31). A fuel card's
// mass IS its fuel, so before this it was the highest-mass card on the pad and
// the blast's PREFERRED target - canning water at LEO made you a magnet for it.
check('a Pad Explosion never touches canned fuel', () => {
  let st = startedGame({ seats: 2 });
  const me = st.players[0];
  me.rocket.siteId = null;           // parked at LEO, so the pad reaches the stack
  // The can is mass 8 - far heavier than the patent - so if fuel were exposed at
  // all the blast would pick IT. The patent is what must be taken instead.
  const soft = PATENTS.find((c) => c.type === 'thruster');
  me.rocket.stack = [
    { id: 'fuel_9', kind: 'fuel', grade: 'water', amount: 8, face: 'primary' },
    { id: soft.id, kind: 'patent' },
  ];
  me.leo = [];
  me.hand = [];
  st.activeIndex = 0;
  st.pendingEvent = { kind: 'pad_explosion', waiting: [me.profileId], options: {} };
  st.lastEvent = { kind: 'pad_explosion', notes: [] };
  const r = applyOperation(st, { kind: 'EVENT_CHOICE' }, { profileId: me.profileId });
  assert(r.ok, `EVENT_CHOICE rejected: ${r.error}`);
  const after = r.state.players[0];
  const fuel = (after.rocket.stack || []).find((sl) => sl.kind === 'fuel');
  assert(fuel && fuel.amount === 8, `the blast took the canned fuel: ${JSON.stringify(fuel)}`);
  assert(!(after.hand || []).some((id) => String(id).startsWith('fuel_')),
    `a phantom fuel card landed in the hand: ${JSON.stringify(after.hand)}`);
  assert(!/fuel_/.test(r.log || ''), `the pad log names a fuel card: ${r.log}`);
  // ...and the blast still bit something, so immunity has not disabled the event.
  assert((after.hand || []).includes(soft.id), `the blast took nothing at all: ${r.log}`);
  return '8 water rode it out; the patent took the hit';
});

// The modifier must not be baked into the card DATA - a Siren's presence cannot
// change what the card prints for everyone else.
check('the rad-hard modifier never rewrites card data', () => {
  const crewCard = CREW[0];
  const printedBefore = crewCard.faces.primary.radHardness;
  const st = sirensGame();
  const me = st.players.find((p) => p.species === 'siren');
  me.rocket.stack = [{ id: me.faction.cardId, kind: 'crew', face: 'primary' }];
  applyOperation(st, { kind: 'END_TURN' }, { profileId: st.players[st.activeIndex].profileId });
  assert(CREW[0].faces.primary.radHardness === printedBefore,
    'a Sirens game mutated the printed rad-hardness on the shared card data');
  return 'card data intact';
});

// V9 First Contact, SOLO half: landing Humans on a Uranian moon makes the Board
// meet its KPI for that cycle automatically.
// First Contact is the VISITOR's rule: "you automatically meet the board's KPI
// threshold during the Solar Cycle when your Humans first land on an Uranian
// moon (DISCOVERING THE SIRENIANS)". You cannot discover the people you already
// are, so a Sirenian faction landing on their own moons meets nobody.
check('a Uranian landing satisfies the Board for that cycle', () => {
  const land = (species, siteId = 'setebos') => {
    let st = startedGame({ sirens: true, seats: 1 });
    st.draftPhase = 'crew';
    const p0 = st.players[0];
    p0.faction = null;
    const card = CREW.find((c) => c.color === p0.color) || CREW[0];
    st = applyOperation(st, { kind: 'PICK_CREW', cardId: card.id, face: 'primary', species },
      { profileId: p0.profileId }).state;
    assert(st.players[0].species === species, `the seat came out ${st.players[0].species}`);
    const me = st.players[0];
    // Stand a crew on a Uranian moon (not the aerostat).
    me.rocket.siteId = siteId;
    me.rocket.stack = [{ id: me.faction.cardId, kind: 'crew', face: 'primary' }];
    const r = applyOperation(st, { kind: 'END_TURN' }, { profileId: me.profileId });
    assert(r.ok, `END_TURN rejected: ${r.error}`);
    return r;
  };
  const earth = land('earthling');
  assert(earth.state.sirenKpiFreeCycle === 1,
    `the landing did not mark a free cycle (got ${earth.state.sirenKpiFreeCycle})`);
  assert(/First contact/.test(earth.log), `the landing was not logged: ${earth.log}`);
  // A Siren is home, not discovering anyone - no free cycle.
  const siren = land('siren');
  assert(siren.state.sirenKpiFreeCycle == null,
    `a Siren landing on their own moon claimed First Contact (cycle ${siren.state.sirenKpiFreeCycle})`);
  assert(!/First contact/.test(siren.log || ''), `a Siren landing was logged as first contact: ${siren.log}`);
  return 'cycle 1 free for the visitor, nothing for the locals';
});

// ...and a CENTAUR in the Uranus zone is not a moon either. This is the check
// that would have caught the original zone-based gate: chariklo is D-type and
// sits in the Uranus zone, so a zone test both waived the KPI here AND would
// have handed out the solitaire D/V patent flip at the wrong place.
check('a Uranus-zone centaur is not a moon', () => {
  let st = startedGame({ sirens: true, seats: 1 });
  st.draftPhase = 'crew';
  const p0 = st.players[0];
  p0.faction = null;
  const card = CREW.find((c) => c.color === p0.color) || CREW[0];
  st = applyOperation(st, { kind: 'PICK_CREW', cardId: card.id, face: 'primary', species: 'siren' },
    { profileId: p0.profileId }).state;
  const me = st.players[0];
  me.rocket.siteId = 'chariklo';
  me.rocket.stack = [{ id: me.faction.cardId, kind: 'crew', face: 'primary' }];
  const r = applyOperation(st, { kind: 'END_TURN' }, { profileId: me.profileId });
  assert(r.ok, `END_TURN rejected: ${r.error}`);
  assert(r.state.sirenKpiFreeCycle == null, 'a centaur counted as a Uranian moon');
  return 'chariklo excluded';
});

// ...and a landing on the Uranus AEROSTAT is not a moon landing.
check('the Uranus aerostat is not a moon', () => {
  let st = startedGame({ sirens: true, seats: 1 });
  st.draftPhase = 'crew';
  const p0 = st.players[0];
  p0.faction = null;
  const card = CREW.find((c) => c.color === p0.color) || CREW[0];
  st = applyOperation(st, { kind: 'PICK_CREW', cardId: card.id, face: 'primary', species: 'siren' },
    { profileId: p0.profileId }).state;
  const me = st.players[0];
  me.rocket.siteId = 'uranus-aerostat';
  me.rocket.stack = [{ id: me.faction.cardId, kind: 'crew', face: 'primary' }];
  const r = applyOperation(st, { kind: 'END_TURN' }, { profileId: me.profileId });
  assert(r.ok, `END_TURN rejected: ${r.error}`);
  assert(r.state.sirenKpiFreeCycle == null, 'the aerostat counted as a moon landing');
  return 'not counted';
});

// V9 SOLITAIRE Technology Trade: with no opponent to meet, the meeting place is
// the OTHER species' home. Driven through a real END_TURN so the trigger, not
// just the predicate, is what gets tested.
function soloSirenGame(species) {
  let st = startedGame({ sirens: true, seats: 1 });
  st.draftPhase = 'crew';
  const p0 = st.players[0];
  p0.faction = null;
  const card = CREW.find((c) => c.color === p0.color) || CREW[0];
  st = applyOperation(st, { kind: 'PICK_CREW', cardId: card.id, face: 'primary', species },
    { profileId: p0.profileId }).state;
  return st;
}
function endTurnWithFigureAt(st, siteId) {
  const me = st.players[0];
  me.rocket.siteId = siteId;
  me.rocket.stack = [{ id: me.faction.cardId, kind: 'crew', face: 'primary' }];
  const before = (me.hand || []).length;
  const r = applyOperation(st, { kind: 'END_TURN' }, { profileId: me.profileId });
  assert(r.ok, `END_TURN rejected: ${r.error}`);
  return { r, before, after: (r.state.players[0].hand || []).length };
}

check('a solitaire Earthling trades at Cordelia', () => {
  const st = soloSirenGame('earthling');
  const sirenBefore = Object.values(st.sirenDecks || {}).flat().length;
  const { r, before, after } = endTurnWithFigureAt(st, 'cordelia');
  assert(after === before + 1, `no card drawn (hand ${before} -> ${after})`);
  const sirenAfter = Object.values(r.state.sirenDecks || {}).flat().length;
  assert(sirenAfter === sirenBefore - 1, 'the card did not come out of the Sirenian library');
  assert(/Technology Trade at Cordelia/.test(r.log), `not logged: ${r.log}`);
  return 'drew from the Siren library';
});

check('a solitaire Earthling does NOT trade anywhere else', () => {
  const st = soloSirenGame('earthling');
  const { before, after } = endTurnWithFigureAt(st, 'setebos');
  assert(after === before, `a card was drawn away from Cordelia (${before} -> ${after})`);
  return 'no draw at Setebos';
});

check('a solitaire Siren trades at Earth LEO, not at home', () => {
  // At home (Cordelia, where PICK_CREW parks them) there must be no trade...
  const home = soloSirenGame('siren');
  const homeSite = home.players[0].rocket.siteId;
  assert(homeSite === 'cordelia', `a Siren did not start at Cordelia (got ${homeSite})`);
  const idle = endTurnWithFigureAt(home, homeSite);
  assert(idle.after === idle.before, 'a Siren traded while sitting at home');
  // ...and at Earth's LEO (a null rocket site, post-move) there must be.
  const st = soloSirenGame('siren');
  const earthBefore = Object.values(st.decks || {}).flat().length;
  const { r, before, after } = endTurnWithFigureAt(st, null);
  assert(after === before + 1, `no card drawn at LEO (hand ${before} -> ${after})`);
  const earthAfter = Object.values(r.state.decks || {}).flat().length;
  assert(earthAfter === earthBefore - 1, 'the card did not come out of the Earthling library');
  assert(/Technology Trade at LEO/.test(r.log), `not logged: ${r.log}`);
  return 'home quiet, LEO trades';
});

check('the solo trade needs a figure, not just a stack', () => {
  const st = soloSirenGame('earthling');
  const me = st.players[0];
  me.rocket.siteId = 'cordelia';
  me.rocket.stack = [{ id: thruster.id, kind: 'patent' }];   // no crew aboard
  const before = (me.hand || []).length;
  const r = applyOperation(st, { kind: 'END_TURN' }, { profileId: me.profileId });
  assert(r.ok, `END_TURN rejected: ${r.error}`);
  assert((r.state.players[0].hand || []).length === before, 'a crewless stack traded');
  return 'refused without a Human';
});

check('the solo trade stays out of a multiplayer Sirens table', () => {
  // A MIXED table, so the libraries really are split (sirenDecks present) and
  // the only thing left holding the rule back is the ceoSolo gate itself.
  let st = startedGame({ sirens: true, seats: 2 });
  st.draftPhase = 'crew';
  st.players.forEach((p) => { p.faction = null; });
  ['siren', 'earthling'].forEach((species, i) => {
    const cur = st.players.find((p) => !p.faction);
    const card = CREW.find((c) => c.color === cur.color && !st.players.some((p) => p.faction && p.faction.cardId === c.id))
      || CREW.filter((c) => !st.players.some((p) => p.faction && p.faction.cardId === c.id))[0];
    const r = applyOperation(st, { kind: 'PICK_CREW', cardId: card.id, face: 'primary', species },
      { profileId: cur.profileId });
    assert(r.ok, `PICK_CREW rejected: ${r.error}`);
    st = r.state;
  });
  assert(st.sirenDecks, 'a mixed table did not split its libraries, so this proves nothing');
  assert(!st.ceoSolo, 'a 2-seat table should not be the CEO route');
  const me = st.players[st.activeIndex];
  // Stand them at the OTHER species' home, the exact spot that trades in solo.
  me.rocket.siteId = me.species === 'siren' ? null : 'cordelia';
  me.rocket.stack = [{ id: me.faction.cardId, kind: 'crew', face: 'primary' }];
  const before = (me.hand || []).length;
  const r = applyOperation(st, { kind: 'END_TURN' }, { profileId: me.profileId });
  assert(r.ok, `END_TURN rejected: ${r.error}`);
  const after = (r.state.players.find((p) => p.profileId === me.profileId).hand || []).length;
  assert(after === before, `the solitaire trade fired at a table (hand ${before} -> ${after})`);
  return 'solitaire only';
});

// V9: home orbits are scoped by SOLAR ZONE - the Uranus anchor spaces are the
// Sirens', the rest are the Earthlings'. Driven through the real ANCHOR op so
// the gate, not just the predicate, is what gets tested.
check('home orbits are scoped by species', () => {
  const SIREN_ORBIT = 'lag-bwrlc';     // Uranus zone
  const EARTH_ORBIT = 'lag-ctnib';     // Earth zone
  const anchorAt = (species, slug) => {
    const st = sirensGame(['earthling', 'siren']);
    const idx = st.players.findIndex((p) => p.species === species);
    const me = st.players[idx];
    st.activeIndex = idx;
    st.m2 = true;
    me.opsRemaining = 4;
    // A PLAIN Bernal. The GEO Elevator and the Lofstrom Loop raise an elevator
    // when anchored at a home orbit, which is an Epic Hazard roll that returns
    // before the anchor commits - a different path from the one under test.
    const bernal = 'ber_l1_climate_control_bernal';
    // A Bernal must be OPERATIONAL to anchor, and every Bernal card requires
    // gen-electric, so give it a generator that supplies it with no requirements
    // of its own.
    me.bernals = [{ cardId: bernal, siteId: slug, anchored: false, face: 'primary',
      stack: [{ id: 'gen_cascade_photovoltaic', kind: 'patent', face: 'primary' }] }];
    return applyOperation(st, { kind: 'ANCHOR_BERNAL', cardId: bernal }, { profileId: me.profileId });
  };
  // The gate rejects for a REASON specific to the wrong branch: a home orbit
  // that is not yours falls through to the dirtside branch, which wants a
  // factory. So the tell is WHICH error comes back, not merely that one does.
  const sirenAtEarth = anchorAt('siren', EARTH_ORBIT);
  assert(!sirenAtEarth.ok, 'a Siren anchored at an Earth home orbit as home');
  assert(sirenAtEarth.error === 'anchor_needs_factory',
    `expected the Siren to fall through to the dirtside branch, got ${sirenAtEarth.error}`);
  const earthAtSiren = anchorAt('earthling', SIREN_ORBIT);
  assert(!earthAtSiren.ok, 'an Earthling anchored at a Uranus home orbit as home');
  assert(earthAtSiren.error === 'anchor_needs_factory',
    `expected the Earthling to fall through to the dirtside branch, got ${earthAtSiren.error}`);
  // ...and each species IS accepted at its own.
  const sirenHome = anchorAt('siren', SIREN_ORBIT);
  assert(sirenHome.ok, `the Siren could not anchor at its own home orbit: ${sirenHome.error}`);
  assert(sirenHome.state.players.find((p) => p.species === 'siren').bernals[0].home === true,
    'the Siren anchor was not recorded as a home anchor');
  const earthHome = anchorAt('earthling', EARTH_ORBIT);
  assert(earthHome.ok, `the Earthling could not anchor at its own home orbit: ${earthHome.error}`);
  return 'both directions';
});

// V9: a SIRENIAN Home Bernal scores its dirtsides' hydration, not the flat 6.
check('a Sirenian Home Bernal scores by dirtside, not 6', () => {
  const build = (species) => {
    const st = sirensGame(['earthling', 'siren']);
    const idx = st.players.findIndex((p) => p.species === species);
    const me = st.players[idx];
    st.m2 = true;
    // Anchored at a home orbit, with one dirtside factory of known hydration.
    const orbit = species === 'siren' ? 'lag-bwrlc' : 'lag-ctnib';
    me.bernals = [{ cardId: 'ber_l1_climate_control_bernal', siteId: orbit,
      anchored: true, home: true, face: 'primary',
      stack: [{ id: 'gen_cascade_photovoltaic', kind: 'patent', face: 'primary' }] }];
    // Give the Bernal a dirtside factory so the hydration sum is a real number
    // rather than an empty 0 - otherwise "not 6" would pass for the wrong reason.
    // A Bernal's dirtsides are the SITES in its raygun line of sight that carry
    // a factory, so put a factory on the first site the beam reaches.
    const near = [...lineOfSightSites(orbit, { includeBouncedSites: true })][0];
    if (near) st.factories = { [near]: { ownerId: me.profileId, spectralType: 'C' } };
    return { st, me, near };
  };
  const { st: sirenSt, me: siren } = build('siren');
  const { st: earthSt, me: earth } = build('earthling');
  const sirenVp = bernalVpByPlayer(sirenSt)[siren.profileId] | 0;
  const earthVp = bernalVpByPlayer(earthSt)[earth.profileId] | 0;
  assert(earthVp === 6, `an Earthling Home Bernal scored ${earthVp}, want the flat 6`);
  // lag-bwrlc sees juliet / portia / belinda, all hydration 4, so ONE factory
  // there is worth exactly 4. Asserting the number rather than "not 6" - a
  // dirtside sum of 0 would also be "not 6" and would pass for the wrong reason.
  assert(sirenVp === 4, `the Sirenian Home Bernal scored ${sirenVp}, want 4 (one hydration-4 dirtside)`);
  return `earthling 6, siren ${sirenVp} (dirtside sum)`;
});

// V9: a Cycler Bernal carries a Siren safely through the mu dust ring, the
// Uranian radiation belt. Same waiver the printed card gives "near Earth", so
// the check is that the SIREN clause fires at Uranus WITHOUT the Earth one
// changing - a non-Sirens game must still roll in the Uranian belt.
check('a Cycler Bernal waives the mu dust ring for a Siren', () => {
  const MU_RING = 'rad-y6b33';
  assert(zoneOfSlug(MU_RING) === 'Uranus', `${MU_RING} is not in the Uranus zone`);
  assert(hazardKind(MU_RING) === 'rad', `${MU_RING} is not a radiation belt`);
  // Drive a REAL move into the belt so the waiver is exercised, not just its
  // inputs. The log names every belt the ship rolled for, so its absence is the
  // observable difference between waived and not.
  const moveIntoBelt = (withCycler, species = 'siren') => {
    const st = sirensGame(['earthling', 'siren']);
    const idx = st.players.findIndex((p) => p.species === species);
    const me = st.players[idx];
    st.activeIndex = idx;
    me.rocket.siteId = 'burn-gz7tn';           // a plain neighbour of the belt
    me.rocket.stack = [
      { id: thruster.id, kind: 'patent', face: 'primary' },
      { id: me.faction.cardId, kind: 'crew', face: 'primary' },
    ];
    me.rocket.activeThrusterId = thruster.id;
    me.rocket.tank = 12;
    me.bernals = withCycler
      ? [{ cardId: 'ber_tourism_cycler', anchored: true, home: true,
          siteId: species === 'siren' ? 'lag-bwrlc' : 'lag-ctnib',
          face: 'primary', stack: [] }]
      : [];
    return applyOperation(st, {
      kind: 'MOVE',
      segments: [{ from: 'burn-gz7tn', to: MU_RING, burns: 1, turn: 1 }],
    }, { profileId: me.profileId });
  };
  const without = moveIntoBelt(false);
  const with_ = moveIntoBelt(true);
  assert(without.ok, `the move without a Cycler was rejected: ${without.error}`);
  assert(with_.ok, `the move with a Cycler was rejected: ${with_.error}`);
  // Without the station the ship rolls in the belt; with it the belt is bypassed.
  // The engine stamps the belt roll into the log as "[rad d6 N]"; a waived belt
  // is never rolled, so that marker is simply absent.
  const rolled = /rad d6/i.test(without.log || '');
  const stillRolled = /rad d6/i.test(with_.log || '');
  assert(rolled, `expected a belt roll without the Cycler, log was: ${without.log}`);
  assert(!stillRolled, `the Cycler did not waive the mu ring, log was: ${with_.log}`);
  // This is a SIRENIAN Bernal rule, so an Earthling sharing the table gets no
  // free passage even with their own Cycler anchored. Without this case the
  // waiver leaked to both species and still looked correct.
  const earthling = moveIntoBelt(true, 'earthling');
  assert(earthling.ok, `the Earthling move was rejected: ${earthling.error}`);
  assert(/rad d6/i.test(earthling.log || ''),
    `an Earthling was waived through the mu ring, log was: ${earthling.log}`);
  return 'rolled without, waived with, earthling still rolls';
});

// V9 SOLITAIRE Trade: landing a Human on a D or V Uranian moon lets you flip a
// white patent in the landing stack to its black side. Not the multiplayer
// Technology Trade - that DRAWS from the other species' deck.
check('the solitaire trade flips a patent on a D or V moon', () => {
  // The trade is with the SIRENIAN LOCALS, so the visitor is an EARTHLING. A
  // solitaire seat may declare either people, and a Siren is already home on
  // these moons - see the species case at the end.
  const soloSeat = (species) => {
    let st = startedGame({ sirens: true, seats: 1 });
    st.draftPhase = 'crew';
    const p0 = st.players[0];
    p0.faction = null;
    const card = CREW.find((c) => c.color === p0.color) || CREW[0];
    st = applyOperation(st, { kind: 'PICK_CREW', cardId: card.id, face: 'primary', species },
      { profileId: p0.profileId }).state;
    assert(st.players[0].species === species, `the seat came out ${st.players[0].species}, not ${species}`);
    return st;
  };
  const attempt = (siteId, opts = {}) => {
    const st = soloSeat(opts.species || 'earthling');
    const me = st.players[0];
    me.rocket.siteId = siteId;
    me.rocket.stack = [
      { id: thruster.id, kind: 'patent', face: 'primary' },
      ...(opts.noHuman ? [] : [{ id: me.faction.cardId, kind: 'crew', face: 'primary' }]),
    ];
    return { st, me, r: applyOperation(st, { kind: 'SIREN_TRADE_FLIP', cardId: thruster.id },
      { profileId: me.profileId }) };
  };
  // titania is D, ariel is V - both qualify.
  const ok1 = attempt('titania');
  assert(ok1.r.ok, `the flip was refused on titania: ${ok1.r.error}`);
  const flipped = ok1.r.state.players[0].rocket.stack.find((sl) => sl.id === thruster.id);
  assert(flipped.face === 'secondary', 'the patent did not flip to its black side');
  assert(/Black-Side/.test(ok1.r.log || ''), `the log does not read as a trade: ${ok1.r.log}`);
  assert(attempt('ariel').r.ok, 'the flip was refused on ariel');
  // puck is C, sycorax is S, cordelia is C - Uranian moons, but not D or V.
  for (const dull of ['puck', 'sycorax', 'cordelia']) {
    assert(attempt(dull).r.error === 'not_on_a_trade_moon',
      `${dull} is not a D or V moon but the flip was allowed`);
  }
  // chariklo is D-type and in the Uranus zone, but a CENTAUR, not a moon.
  assert(attempt('chariklo').r.error === 'not_on_a_trade_moon',
    'a D-type centaur was treated as a trade moon');
  // A Human has to have made the landing.
  assert(attempt('titania', { noHuman: true }).r.error === 'trade_needs_human',
    'a crewless stack traded with the Sirens');
  // The rule carries no species clause - it turns on "land a HUMAN". A SIRENIAN
  // is not one: their own crew standing on their own moon is not a landing
  // party (user 2026-08-07: "the game incorrectly interprets sirens as humans
  // here"). So a Siren crewed only by Sirenians is refused...
  const asSiren = attempt('titania', { species: 'siren' });
  assert(!asSiren.r.ok, 'a Sirenian crew counted as the Human who landed');
  assert(asSiren.r.error === 'trade_needs_human',
    `refused for the wrong reason: ${asSiren.r.error}`);
  // ...and the SAME Siren carrying an actual Human colonist may trade, which is
  // what keeps this a Human test rather than a species ban.
  const human = Object.values(COLONISTS_BY_ID).find((c) => c.colonistKind === 'Human');
  assert(human, 'no Human colonist in the deck to test with');
  const withHuman = (() => {
    const st = soloSeat('siren');
    const me = st.players[0];
    me.rocket.siteId = 'titania';
    me.rocket.stack = [
      { id: thruster.id, kind: 'patent', face: 'primary' },
      { id: me.faction.cardId, kind: 'crew', face: 'primary' },
      { id: human.id, kind: 'colonist', face: 'primary' },
    ];
    return applyOperation(st, { kind: 'SIREN_TRADE_FLIP', cardId: thruster.id }, { profileId: me.profileId });
  })();
  assert(withHuman.ok, `a Siren carrying a Human colonist was refused: ${withHuman.error}`);
  return 'D/V only, and a real Human has to have landed - Sirenians do not count';
});

// ...and the trade is SOLITAIRE only - a multiplayer Sirens table uses the
// Technology Trade instead.
check('the solitaire trade does not exist in multiplayer', () => {
  const st = sirensGame(['earthling', 'siren']);
  const idx = st.players.findIndex((p) => p.species === 'siren');
  const me = st.players[idx];
  st.activeIndex = idx;
  me.rocket.siteId = 'titania';
  me.rocket.stack = [
    { id: thruster.id, kind: 'patent', face: 'primary' },
    { id: me.faction.cardId, kind: 'crew', face: 'primary' },
  ];
  const r = applyOperation(st, { kind: 'SIREN_TRADE_FLIP', cardId: thruster.id },
    { profileId: me.profileId });
  assert(r.error === 'not_siren_solitaire', `expected a solitaire-only refusal, got ${r.error || 'success'}`);
  return 'refused';
});

// V9 dome VP (M2b amended): a Sirenian dome is +3 at an aerostat and +1
// everywhere else, replacing the astrobiology-2 / submarine-3 / bernal-3 table.
// Scored through the SHARED scorer, so client and server agree by construction.
check('Sirenian domes score on their own scale', () => {
  const base = (over) => scorePlayer({
    ownerId: 1, factories: [], claims: 0, outposts: 0, rocket: 0, firstPlayer: 0, ...over,
  });
  const submarine = [{ type: 'submarine', solar: false }];
  const aerostat = [{ type: 'other', solar: true }];
  // Earthling: submarine dome = 1 token + 2 location bonus = 3.
  assert(base({ ownColonies: submarine }).total === 3,
    `earthling submarine dome scored ${base({ ownColonies: submarine }).total}, want 3`);
  // Siren: the SAME submarine dome is worth 1 (token only) - the location table
  // does not apply to them.
  assert(base({ ownColonies: submarine, sirenDomes: true }).total === 1,
    `siren submarine dome scored ${base({ ownColonies: submarine, sirenDomes: true }).total}, want 1`);
  // Siren at an aerostat: 1 token + 2 = 3.
  assert(base({ ownColonies: aerostat, sirenDomes: true }).total === 3,
    `siren aerostat dome scored ${base({ ownColonies: aerostat, sirenDomes: true }).total}, want 3`);
  // And an Earthling at an aerostat is unaffected by the solar flag: type
  // 'other' carries no location bonus, so 1.
  assert(base({ ownColonies: aerostat }).total === 1, 'the solar flag leaked into Earthling scoring');
  return '3 / 1 / 3';
});

// V1 Quick Start: the existing draft opening with the published ending. Driven
// all the way through - 12 picks each, the bonus round, the disk discard - so
// the phase machine is exercised rather than asserted.
check('V1 Quick Start runs the draft into a bonus round and discards a disk', () => {
  let st = startedGame({ quickStart: true, seats: 2, maxRounds: 5 });
  assert(st.quickStart === true, 'the quickStart flag was lost');
  assert(st.draftStart === true, 'quickStart did not turn the draft on');
  assert(st.draftPhase === 'draft', `expected the card draft, got ${st.draftPhase}`);
  assert(st.players.every((p) => (p.aqua | 0) === 0), 'V1 opens every player at 0 aqua');
  // No deck cycling in V1.
  const cyc = applyOperation(st, { kind: 'DRAFT_CYCLE', deckType: 'thruster' },
    { profileId: st.players[st.activeIndex].profileId });
  assert(cyc.error === 'no_cycle_in_quick_start', `expected no cycling, got ${cyc.error || 'success'}`);
  // Draft 12 each.
  for (let i = 0; i < 40 && st.draftPhase === 'draft'; i++) {
    const who = st.players[st.activeIndex];
    const decks = st.decks;
    const type = Object.keys(decks).find((t) => (decks[t] || []).length);
    const r = applyOperation(st, { kind: 'DRAFT_PICK', deckType: type }, { profileId: who.profileId });
    assert(r.ok, `DRAFT_PICK rejected: ${r.error}`);
    st = r.state;
  }
  assert(st.draftPhase === 'bonus', `the draft did not open the bonus round (phase ${st.draftPhase})`);
  assert(st.players.every((p) => (p.hand || []).length === 12), 'not everyone holds 12 cards');
  assert(st.players.every((p) => (p.aqua | 0) === 0), 'V1 handed out a flat bank at draft end');
  // Sell two cards back: +1 aqua each, and they go to the BOTTOM of their decks.
  const seller = st.players[st.activeIndex];
  const sellIds = seller.hand.slice(0, 2);
  const sellType = PATENTS_BY_ID_LOCAL[sellIds[0]].type;
  const deckBefore = st.decks[sellType].length;
  const sold = applyOperation(st, { kind: 'DRAFT_BONUS_SELL', cardIds: sellIds },
    { profileId: seller.profileId });
  assert(sold.ok, `DRAFT_BONUS_SELL rejected: ${sold.error}`);
  st = sold.state;
  const after = st.players.find((p) => p.profileId === seller.profileId);
  assert((after.aqua | 0) === 2, `selling two cards paid ${after.aqua} aqua, want 2`);
  assert(after.hand.length === 10, `seller holds ${after.hand.length} cards, want 10`);
  assert(st.decks[sellType].length === deckBefore + 1
    || st.decks[sellType][st.decks[sellType].length - 1] === sellIds[1],
    'a sold card did not go to the bottom of its deck');
  // Everyone finishes; the last one closes the round and discards a disk.
  const roundsBefore = st.maxRounds;
  for (let i = 0; i < 6 && st.draftPhase === 'bonus'; i++) {
    const who = st.players[st.activeIndex];
    const r = applyOperation(st, { kind: 'DRAFT_BONUS_DONE' }, { profileId: who.profileId });
    assert(r.ok, `DRAFT_BONUS_DONE rejected: ${r.error}`);
    st = r.state;
  }
  assert(st.draftPhase === 'play', `the bonus round did not open play (phase ${st.draftPhase})`);
  assert(st.maxRounds === roundsBefore - 1,
    `the first Seniority Disk was not discarded (${roundsBefore} -> ${st.maxRounds})`);
  assert(st.round === 1 && st.turn === 0, 'the Sunspot Cube was moved during the opening');
  return `5 disks placed, ${st.maxRounds} cycles to play`;
});

// V1 is incompatible with CEO Solitaire (user 2026-07-28).
check('V1 Quick Start cannot run with CEO Solitaire', () => {
  const st = startedGame({ quickStart: true, ceoSolo: true, seats: 1 });
  assert(st.quickStart === undefined, 'quickStart survived alongside CEO Solitaire');
  assert(st.ceoSolo === true, 'the CEO loop was dropped instead');
  return 'quickStart forced off';
});

// Zero bleed-through: a normal room carries no variant keys at all.
// ----- M1 Mobile Factories: what scores as a Factory, and what is just a token
//
// "A Mobile Factory is considered a Factory only if it is currently sitting on
// one of your Claim disks." On a Claim it earns the Exploitation Track stock
// price and moves the chart for everyone; in transit it is a 1 VP token only.
check('a promoted Freighter on its own Claim scores as a Factory', () => {
  const claim = 'ceres';
  const build = (where) => {
    let st = startedGame({ m0: true, m1: true, seats: 2 });
    const me = st.players[0];
    st.discs = { [claim]: { ownerId: me.profileId, outcome: 'success' } };
    me.freighter = { siteId: where, promoted: true, stack: [], tank: 0 };
    return liveScoreboard(st).players.find((r) => r.profileId === me.profileId);
  };
  const onClaim = build(claim);
  const inTransit = build('lag-w6ybr');
  const offBoard = (() => {
    let st = startedGame({ m0: true, m1: true, seats: 2 });
    const me = st.players[0];
    st.discs = { [claim]: { ownerId: me.profileId, outcome: 'success' } };
    me.freighter = { siteId: claim, promoted: false, stack: [], tank: 0 };   // NOT promoted
    return liveScoreboard(st).players.find((r) => r.profileId === me.profileId);
  })();
  // On the Claim: a real Factory - stock price, and the factory token.
  assert(onClaim.spectralVp > 0, `a promoted Freighter on its own Claim scored ${onClaim.spectralVp} stock price, want > 0`);
  assert((onClaim.tokenBreakdown.factories | 0) === 1, 'it did not count as a factory token');
  assert((onClaim.tokenBreakdown.mobileFactories | 0) === 0, 'it double-counted as an in-transit token too');
  // In transit: NO stock price, but still 1 VP as a token.
  assert(inTransit.spectralVp === 0, `an in-transit Mobile Factory scored ${inTransit.spectralVp} stock price, want 0`);
  assert((inTransit.tokenBreakdown.mobileFactories | 0) === 1, 'an in-transit Mobile Factory scored no token VP');
  // Unpromoted: not a Mobile Factory at all, on a Claim or otherwise.
  assert(offBoard.spectralVp === 0 && (offBoard.tokenBreakdown.mobileFactories | 0) === 0,
    'an UNpromoted freighter acted as a Mobile Factory');
  return `on claim ${onClaim.spectralVp} VP; in transit 0 + 1 token`;
});

check('an acting Freighter moves the stock chart for everyone', () => {
  // The Exploitation Track price falls with the GLOBAL count of a spectral, so
  // a rival's acting Freighter must cut my own factory's price the same way a
  // built factory would.
  const claim = 'ceres';
  const spec = (siteBySlug(claim) || {}).spectralType || 'C';
  const build = (rivalActs) => {
    let st = startedGame({ m0: true, m1: true, seats: 2 });
    const [me, rival] = st.players;
    st.factories = { vesta: { ownerId: me.profileId, spectralType: spec } };
    st.discs = { [claim]: { ownerId: rival.profileId, outcome: 'success' } };
    rival.freighter = { siteId: rivalActs ? claim : 'lag-w6ybr', promoted: true, stack: [], tank: 0 };
    return liveScoreboard(st).players.find((r) => r.profileId === me.profileId).spectralVp;
  };
  const alone = build(false);
  const shared = build(true);
  assert(alone > shared,
    `my factory scored ${alone} alone and ${shared} with a rival Freighter acting - the chart did not move`);
  return `${alone} -> ${shared} when a rival's Freighter acts`;
});

// A Human Colonist killed by a hazard / flare / rad roll goes to the BOTTOM OF
// THE COLONIST QUEUE, not to the hand - a colonist is not a hand card.
check('a colonist killed by a flare returns to the queue, not the hand', () => {
  let st = startedGame({ m0: true, m1: true, m2: true, seats: 2 });
  const me = st.players[0];
  const colonist = (st.colonistQueue || []).find((id) => {
    const c = COLONISTS_BY_ID[id];
    return c && c.colonistKind === 'Human' && ((c.faces && c.faces.primary && c.faces.primary.radHardness) | 0) <= 3;
  });
  assert(colonist, 'no human colonist printing rad <= 3 in the queue');
  st.colonistQueue = (st.colonistQueue || []).filter((id) => id !== colonist);
  const queueBefore = st.colonistQueue.length;
  const handBefore = (me.hand || []).length;
  me.rocket.siteId = 'lag-w6ybr';        // deep space, Earth zone: the flare bites
  me.rocket.stack = [{ id: colonist, kind: 'colonist', face: 'primary' }];
  st.activeIndex = 0;
  st.pendingEvent = { kind: 'solar_flare', waiting: [me.profileId], options: {}, flareRoll: 4 };
  st.lastEvent = { kind: 'solar_flare', notes: [] };
  const r = applyOperation(st, { kind: 'EVENT_CHOICE' }, { profileId: me.profileId });
  assert(r.ok, `EVENT_CHOICE rejected: ${r.error}`);
  const after = r.state.players[0];
  assert(!after.rocket.stack.some((sl) => sl.id === colonist), 'the colonist survived the flare');
  assert(!(after.hand || []).includes(colonist), 'the dead colonist went to the HAND');
  assert((after.hand || []).length === handBefore, 'the hand grew on a colonist death');
  const q = r.state.colonistQueue || [];
  assert(q.includes(colonist), 'the dead colonist did not return to the colonist queue');
  assert(q[q.length - 1] === colonist, 'the dead colonist did not go to the BOTTOM of the queue');
  assert(q.length === queueBefore + 1, 'the queue did not grow by exactly one');
  return 'bottom of the queue, hand untouched';
});

// The scoreboard's CATEGORIES must sum to the total it prints. This broke once
// already: bernalVp was in every player's total but no category rendered it, so
// a card reading 121 VP showed only 106 VP of parts and the missing 15 looked
// like a bug in the engine. Assert the identity rather than trusting the render.
check('every scoring category is accounted for in the total', () => {
  let st = startedGame({ m0: true, m1: true, m2: true, seats: 2 });
  const me = st.players[0];
  // Give the player something in as many categories as possible.
  st.factories = {
    ceres: { ownerId: me.profileId, spectralType: 'C' },
    vesta: { ownerId: me.profileId, spectralType: 'S' },
  };
  st.discs = { ceres: { ownerId: me.profileId, outcome: 'success' } };
  st.colonies = { ceres: { ownerId: me.profileId, type: 'astrobiology' } };
  // An anchored HOME Bernal (burn-geo carries the homeBernal node tag), which
  // scores its flat 6 without needing an adjacency fixture.
  me.bernals = [{ cardId: BERNALS[0].id, anchored: true, siteId: 'burn-geo', stack: [] }];
  const row = liveScoreboard(st).players.find((r) => r.profileId === me.profileId);
  const parts = (row.spectralVp | 0) + (row.tokenVp | 0) + (row.colonyVp | 0)
    + (row.gloryVp | 0) + (row.cubeVp | 0) + (row.awardVp | 0)
    + (row.futuresVp | 0) + (row.bernalVp | 0);
  assert(parts === (row.total | 0),
    `categories sum to ${parts} but the total says ${row.total} - ${row.total - parts} VP is unaccounted for`);
  // And the itemised Bernal rows must sum to the Bernal total the card shows.
  const rows = row.bernalRows || [];
  const berSum = rows.reduce((n, r) => n + (r.vp | 0), 0);
  assert(berSum === (row.bernalVp | 0),
    `Bernal rows sum to ${berSum} but bernalVp is ${row.bernalVp}`);
  assert((row.bernalVp | 0) > 0, 'the fixture scored no Bernal VP, so this proves nothing');
  return `${row.total} VP fully itemised (${row.bernalVp} from Bernals)`;
});

// The client's scoring panels read anchored-Bernal VP off a per-player STAMP on
// the view (map adjacency is server-side, so they cannot re-derive it). The
// itemised rows ride the same stamp, so they must agree with the total - and
// deriving them at view time means a game that finished before the breakdown
// existed still shows one, since nothing was ever recorded to migrate.
check('the Bernal stamp carries rows that agree with its total', () => {
  let st = startedGame({ m0: true, m1: true, m2: true, seats: 2 });
  const me = st.players[0];
  me.bernals = [{ cardId: BERNALS[0].id, anchored: true, siteId: 'burn-geo', stack: [] }];
  const vps = bernalVpByPlayer(st);
  const rows = bernalRowsByPlayer(st);
  assert((vps[me.profileId] | 0) > 0, 'the fixture stamped no Bernal VP, so this proves nothing');
  for (const p of st.players) {
    const sum = (rows[p.profileId] || []).reduce((n, r) => n + (r.vp | 0), 0);
    assert(sum === (vps[p.profileId] | 0),
      `stamped rows sum to ${sum} but the stamped total is ${vps[p.profileId]}`);
  }
  const mine = rows[me.profileId];
  assert(mine.length === 1 && mine[0].home && mine[0].name,
    'the row does not name the station or mark it as a Home Bernal');
  return `${vps[me.profileId]} VP itemised as "${mine[0].name}"`;
});

// The M0 assembly lines (cubeVp / awardVp) are the same kind of derive-not-store
// stamp: cubeVp is a straight read of the LIVE assembly (placing or moving a
// delegate must move this number without any snapshot re-baking), and awardVp
// depends on state.finalVote, the one thing here that genuinely IS a one-time
// resolution (a vote is tallied once, not re-run every read).
check('assembly VP is a live read of the delegate board, not a frozen figure', () => {
  const st = startedGame({ m0: true, seats: 2 });
  const [me, rival] = st.players;
  // Wipe the starting-seat delegate PICK_CREW already placed (seatStartingDelegate)
  // so the fixture's counts are exact rather than baseline-plus-fixture.
  const asm = (st.assembly = { delegates: { freedom: { [me.profileId]: 2 } }, seniority: {} });
  const before = assemblyVpByPlayer(st);
  assert((before[me.profileId] || {}).cubeVp === 2, `expected 2 delegate cubes, got ${(before[me.profileId] || {}).cubeVp}`);
  assert(!before[me.profileId].awardVp, 'awardVp appeared before any vote resolved');
  // Move a delegate to a second place - the SAME board, no snapshot to refresh -
  // and the total cube count must hold on the very next read.
  asm.delegates.freedom[me.profileId] = 1;
  asm.delegates.unity = { [me.profileId]: 1 };
  const after = assemblyVpByPlayer(st);
  assert(after[me.profileId].cubeVp === 2, `splitting a delegate across places should not change my total cube count, got ${after[me.profileId].cubeVp}`);
  // Authority's award is +1 per successful Claim disc - give ME one and the
  // rival none, so a real winner/loser split is unambiguous.
  st.discs = { ceres: { ownerId: me.profileId, outcome: 'success' } };
  st.finalVote = { winner: 'authority' };
  const won = assemblyVpByPlayer(st);
  assert(won[me.profileId].awardVp > 0, 'the vote winner scored no award VP');
  assert(!won[rival.profileId].awardVp, 'the vote loser scored award VP with no claims of their own');
  return `cubeVp tracks live placement (${after[me.profileId].cubeVp}), award only after a vote`;
});

// A Space Elevator pair (data/space-elevators.js) must be genuinely BUILT (or
// be the implicit GEO cable) before it colocates cargo across its two ends.
// Owning a Factory at one end used to be enough on its own - both for a new
// outpost spun off at the far end, and for a plain Cargo Transfer between two
// EXISTING stacks - which is exactly "using the elevator before it's built"
// (user 2026-07-29). This checks both paths, unbuilt then built.
check('an elevator pair needs a BUILT cable, not just a Factory at one end', () => {
  const st = startedGame({ m0: true, m1: true, seats: 2 });
  const me = st.players[0];
  st.activeIndex = 0;
  const [a, b] = ['phobos', 'mars-arsia-mons-caves'];
  st.factories = { [a]: { ownerId: me.profileId, spectralType: 'M' } };
  me.rocket.siteId = a;
  me.rocket.stack = [{ id: 'gen_cascade_photovoltaic', kind: 'patent', face: 'primary' }];
  const cardId = me.rocket.stack[0].id;

  // 1) New-outpost spin-off at the far end: refused unbuilt, accepted once built.
  const spinOff = () => applyOperation(st, {
    kind: 'TRANSFER', from: 'rocket', to: 'newOutpost', newOutpostSite: b, cardIds: [cardId],
  }, { profileId: me.profileId });
  const before = spinOff();
  assert(!before.ok && before.error === 'outpost_not_colocated',
    `expected outpost_not_colocated with no built cable, got ${JSON.stringify(before)}`);
  st.elevators = { [elevatorPairKey(a, b)]: { ownerId: me.profileId } };
  const after = spinOff();
  assert(after.ok, `expected the spin-off to succeed once the cable is built, got ${after.error}`);

  // 2) Plain Cargo Transfer between two EXISTING stacks at the two ends: same
  // refusal unbuilt. Fresh state so the outpost from step 1 doesn't confuse it.
  let st2 = startedGame({ m0: true, m1: true, seats: 2 });
  const me2 = st2.players[0];
  st2.activeIndex = 0;
  st2.factories = { [a]: { ownerId: me2.profileId, spectralType: 'M' } };
  me2.outposts = { A: { letter: 'A', siteId: a, cards: [{ id: cardId, kind: 'patent', face: 'primary' }], tank: 0 } };
  me2.outposts.B = { letter: 'B', siteId: b, cards: [], tank: 0 };
  const xfer = () => applyOperation(st2, {
    kind: 'TRANSFER', from: 'outpostA', to: 'outpostB', cardIds: [cardId],
  }, { profileId: me2.profileId });
  const r1 = xfer();
  assert(!r1.ok && r1.error === 'not_colocated',
    `expected not_colocated with no built cable, got ${JSON.stringify(r1)}`);
  st2.elevators = { [elevatorPairKey(a, b)]: { ownerId: me2.profileId } };
  const r2 = xfer();
  assert(r2.ok, `expected the transfer to succeed once the cable is built, got ${r2.error}`);
  return 'refused unbuilt, accepted built - both the spin-off and the plain transfer';
});

// A promoted Freighter parked on its own Claim IS a Factory (M1 promotion) -
// a Bernal in raygun line of sight must Dirtside to it exactly like a real
// Factory cube, with no state.factories entry involved at all.
check('a promoted Freighter on its own Claim counts as a Bernal Dirtside', () => {
  const st = startedGame({ m0: true, m1: true, m2: true, seats: 2 });
  const me = st.players[0];
  const orbit = 'lag-bwrlc';
  const near = [...lineOfSightSites(orbit, { includeBouncedSites: true })][0];
  assert(near, 'no reachable site from the fixture orbit - pick a different one');
  st.discs = { [near]: { ownerId: me.profileId, outcome: 'success' } };
  me.freighter = { siteId: near, promoted: true, stack: [], tank: 0 };
  assert(!st.factories[near], 'the fixture accidentally placed a real Factory - this would prove nothing');
  me.bernals = [{ cardId: 'ber_l1_climate_control_bernal', siteId: orbit,
    anchored: true, home: false, face: 'primary', stack: [] }];
  const vp = bernalVpByPlayer(st)[me.profileId] | 0;
  const site = siteBySlug(near);
  assert(vp === (site.hydration | 0), `Bernal scored ${vp}, want the site's hydration ${site.hydration} from the acting Freighter`);
  return `${vp} VP from a Freighter-Factory Dirtside, no state.factories entry`;
});

// Every DEPLOYED Bernal figure (anchored or not) is its own token, on top of
// whatever bernalVp it separately earns once anchored.
check('deployed Bernal figures score their own token VP', () => {
  const st = startedGame({ m0: true, m2: true, seats: 2 });
  const me = st.players[0];
  me.bernals = [
    { cardId: 'ber_l1_climate_control_bernal', siteId: 'burn-geo', anchored: true, home: true, face: 'primary', stack: [] },
    { cardId: 'ber_l5s_cancer_hospital', siteId: null, anchored: false, home: false, face: 'primary', stack: [] },
  ];
  const row = liveScoreboard(st).players.find((r) => r.profileId === me.profileId);
  assert((row.tokenBreakdown.bernals | 0) === 2, `expected 2 Bernal tokens, got ${row.tokenBreakdown.bernals}`);
  const parts = (row.spectralVp | 0) + (row.tokenVp | 0) + (row.colonyVp | 0)
    + (row.gloryVp | 0) + (row.cubeVp | 0) + (row.awardVp | 0)
    + (row.futuresVp | 0) + (row.bernalVp | 0);
  assert(parts === (row.total | 0), `categories sum to ${parts} but the total says ${row.total}`);
  return `2 deployed Bernals -> 2 token VP (total still reconciles: ${row.total})`;
});

// A vehicle "is just a card": a PROMOTED Freighter / GW thruster keeps its
// purple face when it is stowed inside another stack, so its Future is still
// unlocked and still attemptable. locateFutureCard used to look at the
// standalone Freighter unit only (and at the rocket / outposts only for a GW
// thruster), so parking the big cube inside a Bernal silently took the Future
// off the board - it vanished from the Colonists tab's missions tracker and the
// Epic Hazard answered future_card_not_ready.
check('a promoted Freighter stowed in a Bernal can still attempt its Future', () => {
  const st = startedGame({ m0: true, m1: true, m2: true, seats: 2, maxRounds: 7 });
  assert(st.futures, 'the fixture is not a Futures game, so this proves nothing');
  const me = st.players[0];
  st.activeIndex = 0;
  // Z-Pinch D-T 6Li Fusion promotes to Z-Pinch 3He-D Target Fusion, whose
  // GOLDEN APPLES FUTURE asks only for my Factory on the Kreutz Sungrazer.
  const cardId = 'fre_z_pinch_d_t_6li_fusion';
  st.factories = { kreutz_sungrazer: { ownerId: me.profileId, spectralType: 'C' } };
  // The promoted card + my crew ride inside an anchored Bernal at Ceres; no
  // standalone Freighter unit is in play at all.
  const crewSlot = (me.leo || []).find((s) => s.kind === 'crew');
  assert(crewSlot, 'the crew draft left no crew in the LEO Stack');
  me.leo = me.leo.filter((s) => s !== crewSlot);
  me.freighter = null;
  me.aqua = 50;
  const bernalStack = () => [{ id: cardId, kind: 'patent', face: 'secondary' }, crewSlot];
  me.bernals = [{
    cardId: BERNALS[0].id, figure: 'kalpana', anchored: true, face: 'primary',
    siteId: 'ceres', stack: bernalStack(), tank: 0, wiring: {}, route: [],
  }];
  const r = applyOperation(st, { kind: 'EPIC_HAZARD', cardId, hazardPay: true }, { profileId: me.profileId });
  assert(r.ok, `EPIC_HAZARD rejected: ${r.error}`);
  const after = r.state.players.find((p) => p.profileId === me.profileId);
  assert((after.futureStars || []).some((s) => s.key === 'GOLDEN APPLES FUTURE'),
    'the attempt succeeded but no orange star was earned');
  // The WHITE side stowed the same way is still locked - promotion is what
  // unlocks a Future, not merely holding the card.
  const white = startedGame({ m0: true, m1: true, m2: true, seats: 2, maxRounds: 7 });
  const me2 = white.players[0];
  white.activeIndex = 0;
  white.factories = { kreutz_sungrazer: { ownerId: me2.profileId, spectralType: 'C' } };
  const crew2 = (me2.leo || []).find((s) => s.kind === 'crew');
  me2.leo = me2.leo.filter((s) => s !== crew2);
  me2.aqua = 50;
  me2.bernals = [{
    cardId: BERNALS[0].id, figure: 'kalpana', anchored: true, face: 'primary',
    siteId: 'ceres', stack: [{ id: cardId, kind: 'patent', face: 'primary' }, crew2],
    tank: 0, wiring: {}, route: [],
  }];
  const r2 = applyOperation(white, { kind: 'EPIC_HAZARD', cardId, hazardPay: true }, { profileId: me2.profileId });
  assert(!r2.ok && r2.error === 'future_card_not_ready',
    `an UNPROMOTED stowed Freighter was allowed to attempt its Future (${r2.ok ? 'accepted' : r2.error})`);
  return 'stowed purple card attempts, stowed white card does not';
});

// The Freighter flying as its own big cube is the ordinary case and must keep
// working - the stowed-card scan above is an addition, not a replacement.
check('a promoted Freighter unit still attempts its Future', () => {
  const st = startedGame({ m0: true, m1: true, m2: true, seats: 2, maxRounds: 7 });
  const me = st.players[0];
  st.activeIndex = 0;
  const cardId = 'fre_z_pinch_d_t_6li_fusion';
  st.factories = { kreutz_sungrazer: { ownerId: me.profileId, spectralType: 'C' } };
  const crewSlot = (me.leo || []).find((s) => s.kind === 'crew');
  me.leo = me.leo.filter((s) => s !== crewSlot);
  me.aqua = 50;
  me.freighter = {
    cardId, face: 'secondary', promoted: true, siteId: 'ceres',
    stack: [crewSlot], tank: 0, wiring: {}, route: [],
  };
  const r = applyOperation(st, { kind: 'EPIC_HAZARD', cardId, hazardPay: true }, { profileId: me.profileId });
  assert(r.ok, `EPIC_HAZARD rejected for the standalone Freighter: ${r.error}`);
  return 'big cube path unchanged';
});

// PROSPECT's Glitch Trigger (hf4-branching-manual.md:1264: "Performing a
// prospect is a Glitch Trigger") must roll BEFORE the claim can be placed - a
// roll that destroys the specific card doing the prospecting means no scan
// was completed, so no claim disc, even though the size roll never even ran
// (user 2026-07-29, reported live: a glitch-killed prospecting robonaut still
// left a successful claim on the board).
check('a glitched prospector destroyed by its own trigger places no claim', () => {
  const RAYGUN = 'rob_phase_locked_diode_laser';   // raygun, printed rad-hard 3, ISRU 3
  const build = (cursor) => {
    const st = startedGame({ seats: 2 });
    const me = st.players[0];
    me.rocket.siteId = 'ceres';                     // raygun may target its own site
    me.rocket.glitch = true;
    me.rocket.stack = [{ id: RAYGUN, kind: 'patent', face: 'primary' }];
    me.rocket.activeProspectorId = RAYGUN;
    st.activeIndex = 0;
    st.rng.cursor = cursor;
    return st;
  };
  // Find a cursor whose FIRST d6 (the glitch roll, fired before the size roll)
  // lands on 3 - the raygun's own rad-hardness - so it is the card destroyed.
  let killCursor = 0;
  while (makeRng('check-engine', killCursor).d6() !== 3 && killCursor < 1000) killCursor++;
  assert(killCursor < 1000, 'could not find a cursor rolling a 3 - has the RNG helper changed?');

  const st = build(killCursor);
  const r = applyOperation(st, { kind: 'PROSPECT', siteId: 'ceres' }, { profileId: st.players[0].profileId });
  assert(r.ok, `PROSPECT was rejected outright rather than resolving as a bust: ${r.error}`);
  assert(!r.state.discs.ceres, `a claim disc was placed despite the prospector being destroyed: ${JSON.stringify(r.state.discs.ceres)}`);
  assert(!r.state.players[0].rocket.stack.some((s) => s.id === RAYGUN), 'the destroyed raygun is still aboard the rocket');
  assert(r.state.players[0].hand.includes(RAYGUN), 'the destroyed raygun did not return to hand');
  assert(r.state.players[0].rocket.activeProspectorId == null, 'the destroyed card is still the active prospector');
  assert(/destroyed the raygun/i.test(r.log), `log does not explain the destruction: "${r.log}"`);

  // Contrast: the SAME fixture, a cursor whose roll does NOT match rad-hard 3 -
  // the raygun survives, and the prospect proceeds to a real claim disc.
  let surviveCursor = 0;
  while (makeRng('check-engine', surviveCursor).d6() === 3 && surviveCursor < 1000) surviveCursor++;
  const st2 = build(surviveCursor);
  const r2 = applyOperation(st2, { kind: 'PROSPECT', siteId: 'ceres' }, { profileId: st2.players[0].profileId });
  assert(r2.ok, `PROSPECT rejected on a non-matching roll: ${r2.error}`);
  assert(r2.state.discs.ceres, 'no claim disc was placed even though the raygun survived its glitch roll');
  assert(r2.state.players[0].rocket.stack.some((s) => s.id === RAYGUN), 'the surviving raygun vanished from the rocket');

  return `kill roll ${killCursor}->bust, no claim; survive roll ${surviveCursor}->claim placed normally`;
});

// A Bernal crawls under its own colony card, and a generator/reactor loaded
// into its stack should modify its thrust/fuel exactly like a rocket
// thruster's support chain does (rules 1+2, data/support-chain.js) - the
// user's report: "thrust modifying support not working for bernal", reported
// against a real stack (SSO Diplomatic + O'Meara LSP Paralens generator +
// D-T Gun Fusion reactor). bernalFuelPerBurn used to read only the printed
// fuel value with zero fuelMod folding; this drives a real MOVE (debug dry
// run, so it skips the operational/tank gates and just returns the computed
// calc) to prove the chain now scales the fuel-per-burn.
check('a Bernal support chain modifies its fuel per burn', () => {
  const st = startedGame({ m2: true, seats: 2 });
  const me = st.players[0];
  st.activeIndex = 0;
  // O'Meara LSP Paralens (gen_brayton_turbine's secondary/Tier-2 face): supplies
  // gen-electric (satisfies the Bernal's own requirement) with no requirement of
  // its own, so it needs no reactor to be operational. Chosen instead as the
  // generator whose SECONDARY face needs a reactor: gen_optoelectric_nuclear_battery
  // (requires reactor-fusion/antimatter/thermostat, supplies gen-electric,
  // thrustMod +1, fuelMod x1) feeding D-T Gun Fusion (primary face: thrustMod +1,
  // fuelMod x0.25, supplies reactor-antimatter) - the exact modifier path rules
  // 1+2 fold: every generator before the first reactor, plus that reactor.
  me.bernals = [{
    cardId: 'ber_sso_diplomatic', siteId: null, anchored: false, face: 'primary',
    tank: 12, movesRemaining: 1,
    stack: [
      { id: 'gen_optoelectric_nuclear_battery', kind: 'patent', face: 'secondary' },
      { id: 'rea_d_t_gun_fusion', kind: 'patent', face: 'primary' },
    ],
  }];
  const r = applyOperation(st, {
    kind: 'MOVE', unit: 'bernal0', debug: true,
    segments: [{ from: 'burn-gz7tn', to: 'rad-y6b33', burns: 1, turn: 1 }],
  }, { profileId: me.profileId });
  assert(r.ok, `the debug MOVE was rejected: ${r.error}`);
  // Base fuel 3 (SSO Diplomatic) x 0.25 (D-T Gun Fusion's fuelMod) = 0.75. The
  // generator's own fuelMod is x1 (no effect), proving the reactor's mod folds
  // even though it sits a hop deeper than the generator directly feeding the
  // Bernal's requirement.
  assert(Math.abs(r.calc.fuelStepsPerBurn - 0.75) < 1e-9,
    `expected the chain to scale fuel per burn to 0.75 (3 base x 0.25 reactor fuelMod), got ${r.calc.fuelStepsPerBurn}`);
  return `fuel per burn ${r.calc.fuelStepsPerBurn} (3 base x 0.25 reactor fuelMod)`;
});

// ---- V5 Hermes Fall ----
//
// A one-player mission: reach both halves of the binary asteroid and plant a
// factory on each before two Seniority Disks run out.

// Setup is V4b's, and the appendix prints a worked example of the half-deck cut
// (6 thrusters / 6 robonauts / 6 refineries / 8 generators / 6 radiators /
// 6 reactors, 3 GW thrusters, 3 Freighters). That example IS the assertion here,
// so a wrong rounding direction is caught by the published numbers rather than
// by whatever the code happens to do.
// V5 Hermes Fall is COOPERATIVE, solo AND at a table (user 2026-07-31). The
// deflection belongs to the TABLE: any player's factory on a half counts, and
// everyone shares one verdict. The engine used to score state.players[0] alone,
// so a co-op table could plant both halves and still be told Hermes hit.
check('the Hermes verdict counts EVERY seat, not just the first', () => {
  const facs = {
    'hermes-a': { ownerId: 7, spectralType: 'C' },   // planted by seat A
    'hermes-b': { ownerId: 9, spectralType: 'C' },   // planted by seat B
  };
  // Table-wide (no ownerId): both halves are under thrust.
  assert(hermesSitesIndustrialized(facs).length === 2,
    `the shared read missed a half: ${JSON.stringify(hermesSitesIndustrialized(facs))}`);
  // Per-seat still filters, which is what a "halves YOU planted" readout wants.
  assert(hermesSitesIndustrialized(facs, 7).length === 1, 'the per-seat read stopped filtering');
  assert(hermesSitesIndustrialized(facs, 9).length === 1, 'the per-seat read stopped filtering');
  // The OLD rule - score seat 0 only - would have read 1 of 2 and called it an
  // impact. That is exactly the bug, so spell it out.
  assert(hermesSitesIndustrialized(facs, 7).length !== 2,
    'this fixture no longer distinguishes the shared read from the per-seat one');
  return 'A + B = deflected';
});

// ...driven through a real END_TURN on a real multi-seat table, so the verdict
// itself is what gets checked, not just the helper.
check('a co-op table deflects Hermes when the halves are split between seats', () => {
  let st = startedGame({ hermes: true, seats: 2, m1: true });
  assert(st.hermes === true, 'the hermes flag was lost');
  const [p0, p1] = st.players;
  // One half each - neither player alone has both.
  st.factories = {
    'hermes-a': { ownerId: p0.profileId, spectralType: 'C' },
    'hermes-b': { ownerId: p1.profileId, spectralType: 'C' },
  };
  // Run the clock out: the verdict lands when the last round closes.
  st.round = st.maxRounds;
  st.turn = 11;
  st.activeIndex = st.players.length - 1;
  const r = applyOperation(st, { kind: 'END_TURN' }, { profileId: st.players[st.activeIndex].profileId });
  assert(r.ok, `END_TURN rejected: ${r.error}`);
  assert(r.state.hermesVerdict === 'deflected',
    `a split co-op deflection read as ${r.state.hermesVerdict}`);
  return 'deflected by two seats';
});

check('a co-op table still LOSES when only one half is planted', () => {
  let st = startedGame({ hermes: true, seats: 2, m1: true });
  const [p0] = st.players;
  st.factories = { 'hermes-a': { ownerId: p0.profileId, spectralType: 'C' } };
  st.round = st.maxRounds;
  st.turn = 11;
  st.activeIndex = st.players.length - 1;
  const r = applyOperation(st, { kind: 'END_TURN' }, { profileId: st.players[st.activeIndex].profileId });
  assert(r.ok, `END_TURN rejected: ${r.error}`);
  assert(r.state.hermesVerdict === 'impact', `one half read as ${r.state.hermesVerdict}`);
  return 'impact on one half';
});

check('V5 setup cuts each deck in half and seeds the Mass Driver on top', () => {
  const st = startedGame({ hermes: true, seats: 1, m1: true });
  // Two Seniority Disks in the centre of the Sunspot Cycle. The disk clock runs
  // off the round count here, so that is a 2-round game - and it is FORCED, not
  // merely defaulted, so asking for 7 still gets 2.
  assert(st.maxRounds === 2, `expected a 2-cycle game, got ${st.maxRounds}`);
  const long = startedGame({ hermes: true, seats: 1, maxRounds: 7 });
  assert(long.maxRounds === 2, `a Hermes room honoured maxRounds 7 (${long.maxRounds}) instead of forcing 2`);

  const want = { thruster: 6, robonaut: 6, refinery: 6, generator: 8, radiator: 6, reactor: 6, 'gw-thruster': 3, freighter: 3 };
  for (const [type, n] of Object.entries(want)) {
    const got = (st.decks[type] || []).length;
    assert(got === n, `${type} deck holds ${got} cards, the appendix's worked example says ${n}`);
  }
  // The Mass Driver is set aside BEFORE the cut and shuffled back into the top
  // five, so it survives a truncation that would otherwise have been free to
  // discard it, and it is reachable in the opening cycle.
  const idx = st.decks.thruster.indexOf('thr_mass_driver');
  assert(idx >= 0, 'the Mass Driver is not in the thruster deck at all');
  assert(idx < 5, `the Mass Driver sits at position ${idx + 1}, outside the top five`);
  // ...and exactly once: set-aside then re-insert must not leave a duplicate.
  assert(st.decks.thruster.filter((id) => id === 'thr_mass_driver').length === 1,
    'the Mass Driver was dealt twice');
  return `2 cycles, decks cut to the appendix's numbers, Mass Driver at #${idx + 1}`;
});

// Both halves are hydration 0, so the ordinary "ISRU must be <= hydration" gate
// refuses every prospector in the game and the mission could never start. The
// variant bypasses the gate AND the size roll.
check('V5 prospecting the binary auto-succeeds with any ISRU', () => {
  const RAYGUN = 'rob_phase_locked_diode_laser';   // ISRU 3, vs hydration 0
  const scan = (siteId, opts = {}) => {
    const st = startedGame({ seats: 1, ...(opts.hermes === false ? {} : { hermes: true }) });
    const me = st.players[0];
    me.rocket.siteId = siteId;
    me.rocket.stack = [{ id: RAYGUN, kind: 'patent', face: 'primary' }];
    me.rocket.activeProspectorId = RAYGUN;
    st.activeIndex = 0;
    return applyOperation(st, { kind: 'PROSPECT', siteId }, { profileId: me.profileId });
  };
  const auto = scan('hermes-a');
  assert(auto.ok, `the Hermes prospect was rejected: ${auto.error}`);
  assert(auto.state.discs['hermes-a'] && auto.state.discs['hermes-a'].outcome === 'success',
    'the auto-prospect did not place a successful claim');
  assert(auto.state.discs['hermes-a'].auto === true, 'the disc is not flagged as an auto-success');
  assert(auto.state.discs['hermes-a'].roll == null, 'an auto-success rolled a die anyway');
  assert(!/rolled/.test(auto.log), `the log narrates a roll that never happened: "${auto.log}"`);
  // The rng cursor must not have advanced - no die was thrown, so the seeded
  // stream is untouched and later rolls in the game are unaffected.
  const before = startedGame({ hermes: true, seats: 1 }).rng.cursor;
  assert(auto.state.rng.cursor === before,
    `the auto-success burned RNG (cursor ${before} -> ${auto.state.rng.cursor})`);

  // The bypass is SCOPED to the binary: the same ISRU-3 raygun at an ordinary
  // low-hydration site in the SAME Hermes game is still refused.
  const elsewhere = scan('mathilde');
  assert(!elsewhere.ok && elsewhere.error === 'isru_too_high',
    `the ISRU gate leaked off the binary (got ${elsewhere.ok ? 'accepted' : elsewhere.error})`);
  // ...and it does not exist at all outside the variant.
  const noVariant = scan('hermes-a', { hermes: false });
  assert(!noVariant.ok && noVariant.error === 'isru_too_high',
    `a normal game auto-prospected Hermes (got ${noVariant.ok ? 'accepted' : noVariant.error})`);
  return 'auto on the binary, ISRU gate intact elsewhere and off-variant';
});

// Industrializing a half additionally costs an operational dirt rocket (the grey
// thrust triangle) - the factory drives embedded thrusters off the regolith.
check('V5 industrializing a Hermes site spends a dirt rocket', () => {
  const REFINERY = 'ref_atomic_layer_deposition';
  const ROBONAUT = 'rob_phase_locked_diode_laser';
  const DIRT = 'thr_mass_driver';                  // Mass Driver: thrust 4, fuel type Dirt
  const WATER = 'thr_hall_effect';                 // a water thruster, so NOT a dirt rocket
  const build = (siteId, extraId) => {
    const st = startedGame({ hermes: true, seats: 1 });
    const me = st.players[0];
    st.activeIndex = 0;
    me.opsRemaining = 4;
    me.rocket.siteId = siteId;
    const ids = [REFINERY, ROBONAUT, ...(extraId ? [extraId] : [])];
    me.rocket.stack = ids.map((id) => ({ id, kind: 'patent', face: 'primary' }));
    st.discs[siteId] = { outcome: 'success', ownerId: me.profileId, by: me.name };
    return applyOperation(st, { kind: 'INDUSTRIALIZE', siteId, cardIds: ids }, { profileId: me.profileId });
  };
  const bare = build('hermes-a', null);
  assert(!bare.ok && bare.error === 'hermes_needs_dirt_rocket',
    `a Hermes build with no dirt rocket was allowed (got ${bare.ok ? 'accepted' : bare.error})`);
  const watery = build('hermes-a', WATER);
  assert(!watery.ok && watery.error === 'hermes_needs_dirt_rocket',
    `a WATER thruster satisfied the dirt-rocket cost (got ${watery.ok ? 'accepted' : watery.error})`);
  const dirty = build('hermes-a', DIRT);
  assert(dirty.ok, `a build carrying the Mass Driver was rejected: ${dirty.error}`);
  assert(dirty.state.factories['hermes-a'], 'the factory was not placed');
  assert(dirty.state.players[0].hand.includes(DIRT), 'the dirt rocket was not decommissioned to hand');
  // The extra cost is SCOPED to the binary: an ordinary site still builds with
  // just the refinery + robonaut.
  const ordinary = build('mathilde', null);
  assert(ordinary.ok, `the dirt-rocket cost leaked to an ordinary site: ${ordinary.error}`);
  return 'refused bare + with a water thruster, accepted with the Mass Driver, ordinary sites untouched';
});

// Binary win/lose, decided when the second Seniority Disk leaves the cycle.
check('V5 is won only by industrializing BOTH halves before the clock', () => {
  const runOut = (ownedSlugs) => {
    const st = startedGame({ hermes: true, seats: 1 });
    const me = st.players[0];
    st.activeIndex = 0;
    for (const slug of ownedSlugs) st.factories[slug] = { ownerId: me.profileId, spectralType: 'S' };
    // Walk the clock to the end rather than poking status: the verdict has to be
    // written by the real round-close path, which is the thing under test.
    let guard = 0;
    let cur = st;
    while (cur.status !== 'finished' && guard++ < 200) {
      const r = applyOperation(cur, { kind: 'END_TURN' }, { profileId: cur.players[cur.activeIndex].profileId });
      assert(r.ok, `END_TURN rejected while running the clock out: ${r.error}`);
      cur = r.state;
    }
    assert(cur.status === 'finished', 'the game never finished inside 200 turns');
    return cur;
  };
  const won = runOut(['hermes-a', 'hermes-b']);
  assert(won.hermesVerdict === 'deflected', `both halves industrialized read ${won.hermesVerdict}`);
  const half = runOut(['hermes-a']);
  assert(half.hermesVerdict === 'impact', `one half industrialized read ${half.hermesVerdict}`);
  const none = runOut([]);
  assert(none.hermesVerdict === 'impact', `no halves industrialized read ${none.hermesVerdict}`);
  return 'both -> deflected, one or none -> impact';
});

// The mission countdown the briefing and the turn-bar chip both read. It has to
// reach 0 at exactly the moment the engine writes the verdict, or the number is
// telling the player something the board is not going to honour.
check('the Hermes countdown hits zero exactly at impact', () => {
  const max = HERMES_ROUNDS;
  const total = max * TURNS_PER_CYCLE;
  assert(total === 24, `a 2-cycle mission should be 24 turns, got ${total}`);
  // Opening position: nothing spent.
  assert(turnsToImpact({ round: 1, turn: 0, maxRounds: max }) === 24,
    'the mission does not open on 24 turns');
  // One turn in.
  assert(turnsToImpact({ round: 1, turn: 1, maxRounds: max }) === 23, 'the first turn did not tick');
  // The cycle boundary must not double-count: round 2 turn 0 is 12 turns spent.
  assert(turnsToImpact({ round: 2, turn: 0, maxRounds: max }) === 12,
    'the Solar Cycle rollover miscounts');
  // The LAST playable turn reads 1, not 0 - the player still has that turn.
  assert(turnsToImpact({ round: max, turn: TURNS_PER_CYCLE - 1, maxRounds: max }) === 1,
    'the last playable turn does not read 1');
  // Ending it pushes round past maxRounds, which is exactly when resolveRoundClose
  // finishes the game - so that state reads 0 and never goes negative.
  assert(turnsToImpact({ round: max + 1, turn: 0, maxRounds: max }) === 0,
    'the countdown does not reach 0 when the clock runs out');
  assert(turnsToImpact({ round: max + 5, turn: 7, maxRounds: max }) === 0,
    'the countdown went negative past the end');

  // Cross-check against the REAL engine: run a Hermes game to its end and confirm
  // the countdown was 1 on the final accepted turn and 0 once it finished. This
  // is what stops the formula drifting from resolveRoundClose's actual cutoff.
  let st = startedGame({ hermes: true, seats: 1 });
  st.activeIndex = 0;
  let lastLive = null;
  let guard = 0;
  while (st.status !== 'finished' && guard++ < 200) {
    lastLive = turnsToImpact({ round: st.round, turn: st.turn, maxRounds: st.maxRounds });
    const r = applyOperation(st, { kind: 'END_TURN' }, { profileId: st.players[st.activeIndex].profileId });
    assert(r.ok, `END_TURN rejected while running the clock out: ${r.error}`);
    st = r.state;
  }
  assert(st.status === 'finished', 'the Hermes game never finished');
  assert(lastLive === 1, `the last playable turn read ${lastLive}, want 1`);
  const atEnd = turnsToImpact({ round: st.round, turn: st.turn, maxRounds: st.maxRounds });
  assert(atEnd === 0, `the finished game reads ${atEnd} turns left, want 0`);
  return 'opens at 24, reads 1 on the last turn, 0 when the engine ends it';
});

// Anchoring an unpowered Bernal must be refused, and refused BEFORE the Epic
// Hazard - the GEO Elevator's anchor is a hazard roll, so a late refusal means
// the player was asked to gamble on an anchor that could never succeed (user
// 2026-07-30, reported live). The rejection also names what the chain is short
// of, so the client can say "it needs a generator".
check('an unpowered Bernal is refused before any Epic Hazard roll', () => {
  const build = (withGenerator) => {
    const st = startedGame({ m0: true, m1: true, m2: true, seats: 1 });
    const me = st.players[0];
    st.activeIndex = 0;
    me.opsRemaining = 4;
    me.aqua = 40;
    // The GEO Elevator Bernal at GEO: anchoring it raises the elevator, which is
    // the Epic Hazard path. Every Bernal card requires gen-electric.
    me.bernals = [{
      cardId: 'ber_geo_elevator_bernal', siteId: 'burn-geo', anchored: false, face: 'primary',
      stack: withGenerator ? [{ id: 'gen_cascade_photovoltaic', kind: 'patent', face: 'primary' }] : [],
    }];
    return st;
  };
  const bare = build(false);
  const cursorBefore = bare.rng.cursor;
  const r = applyOperation(bare, { kind: 'ANCHOR_BERNAL', cardId: 'ber_geo_elevator_bernal' },
    { profileId: bare.players[0].profileId });
  assert(!r.ok, 'an unpowered Bernal was allowed to anchor');
  assert(r.error === 'bernal_not_operational', `expected bernal_not_operational, got ${r.error}`);
  // The refusal names the missing OR-group, which is what the button's reason reads.
  assert(r.detail && Array.isArray(r.detail.missing) && r.detail.missing.includes('gen'),
    `the refusal does not name the missing generator: ${JSON.stringify(r.detail)}`);
  // ...and it happened BEFORE the hazard: no die was rolled, so the seeded
  // stream is untouched. A refusal that burned RNG would mean the roll ran first.
  assert(bare.rng.cursor === cursorBefore,
    `the refusal burned RNG (${cursorBefore} -> ${bare.rng.cursor}), so a hazard rolled first`);

  // Contrast: the SAME anchor with a generator aboard gets past the support gate
  // and reaches the Epic Hazard (accepted, or a hazard failure - either way it is
  // no longer refused for support).
  const powered = build(true);
  const r2 = applyOperation(powered, { kind: 'ANCHOR_BERNAL', cardId: 'ber_geo_elevator_bernal' },
    { profileId: powered.players[0].profileId });
  assert(r2.error !== 'bernal_not_operational',
    'a powered Bernal was still refused for its support chain');
  return 'refused with the missing support named, and no die rolled';
});

// The shared requirement walk both sides use. If it ever stops agreeing, the
// client's anchor gate and the server's would drift apart silently.
check('the support-chain requirement walk names unmet groups', () => {
  // A Bernal card (requires gen-electric) with nothing to supply it.
  const cards = [{ id: 'root', type: 'bernal', supplies: [], requires: [{ kind: 'gen-electric', count: 1 }] }];
  const chain = resolveSupportChain({ cards, activeId: 'root', wiring: {} });
  const missing = unmetRequirements({ cards, order: chain.order, edges: chain.edges });
  assert(missing.length === 1, `expected one unmet group, got ${JSON.stringify(missing)}`);
  assert(missing[0].prefix === 'gen', `expected the gen prefix, got ${missing[0].prefix}`);
  // Add a supplier and it is satisfied.
  const cards2 = [...cards, { id: 'gen', type: 'generator', supplies: ['gen-electric'], requires: [] }];
  const chain2 = resolveSupportChain({ cards: cards2, activeId: 'root', wiring: {} });
  assert(unmetRequirements({ cards: cards2, order: chain2.order, edges: chain2.edges }).length === 0,
    'a supplied requirement still read as unmet');
  return 'unmet named by prefix, satisfied when supplied';
});

// Anarchy inactivates the law in power while the cube sits in season blue. That
// is the rule, but the refusal used to read "No operations left this turn",
// which hid the fact that the player's own Individuality law was switched off
// (user 2026-07-30, reported live in a CEO Solitaire game at round 2 turn 1).
check('a boost blocked by Anarchy says so rather than blaming the op count', () => {
  const build = (anarchy) => {
    const st = startedGame({ ceoSolo: true, seats: 1 });
    const me = st.players[0];
    st.activeIndex = 0;
    st.activeLawStar = 'individuality';     // Launch Contracts: boosting is free
    if (anarchy) st.anarchy = true;
    me.hand = ['thr_hall_effect'];
    me.aqua = 40;
    me.opsRemaining = 0;                    // the Fundraise already spent it
    st.turnActions = [];                    // nothing boosted yet this turn
    return st;
  };
  // With the law in force the boost is free even at 0 operations.
  const okSt = build(false);
  const ok = applyOperation(okSt, { kind: 'BOOST', cardIds: ['thr_hall_effect'] },
    { profileId: okSt.players[0].profileId });
  assert(ok.ok, `Launch Contracts did not make the boost free: ${ok.error}`);

  // Under Anarchy the law is suspended, so the boost IS refused - but with the
  // reason, not a bare op count.
  const anSt = build(true);
  const blocked = applyOperation(anSt, { kind: 'BOOST', cardIds: ['thr_hall_effect'] },
    { profileId: anSt.players[0].profileId });
  assert(!blocked.ok, 'Anarchy did not suspend the law');
  assert(blocked.error === 'boost_law_suspended',
    `expected boost_law_suspended, got ${blocked.error}`);

  // A plain out-of-operations boost with no law in play still reads as the
  // ordinary op-count refusal - the new code must not swallow that case.
  const plain = startedGame({ ceoSolo: true, seats: 1 });
  plain.activeIndex = 0;
  plain.activeLawStar = 'centrist';
  plain.players[0].hand = ['thr_hall_effect'];
  plain.players[0].aqua = 40;
  plain.players[0].opsRemaining = 0;
  plain.turnActions = [];
  const p = applyOperation(plain, { kind: 'BOOST', cardIds: ['thr_hall_effect'] },
    { profileId: plain.players[0].profileId });
  assert(!p.ok && p.error === 'no_ops_left', `expected no_ops_left, got ${p.error}`);
  return 'free with the law, boost_law_suspended under Anarchy, no_ops_left otherwise';
});

// ----- Promo crew abilities (docs/promo-crew-plan.md) -----
//
// These four are the first promo-crew abilities with an engine rule behind
// them. A promo card is not pickable by a normal player (the crew wizard never
// offers one), so each check seats the faction directly - the same shape an
// admin's test pick produces.

const promo = (st, idx, cardId, face = 'primary') => {
  st.players[idx].faction = { cardId, face };
  return st.players[idx];
};

// ROCKETEERS (The Martian Way): "Immune to pad explosions/space debris."
check('ROCKETEERS rides out a Pad Explosion', () => {
  const run = (withCrew) => {
    const st = startedGame({ seats: 2 });
    const me = st.players[0];
    if (withCrew) promo(st, 0, 'crew_the_martian_way', 'primary');
    me.rocket.siteId = null;                 // on the pad, so the blast reaches the stack
    me.rocket.stack = [{ id: thruster.id, kind: 'patent' }];
    me.leo = [];
    me.hand = [];
    st.activeIndex = 0;
    st.pendingEvent = { kind: 'pad_explosion', waiting: [me.profileId], options: {} };
    st.lastEvent = { kind: 'pad_explosion', notes: [] };
    const r = applyOperation(st, { kind: 'EVENT_CHOICE' }, { profileId: me.profileId });
    assert(r.ok, `EVENT_CHOICE rejected: ${r.error}`);
    return r.state.players[0];
  };
  const exposed = run(false);
  const immune = run(true);
  assert((exposed.rocket.stack || []).length === 0,
    'the blast took nothing WITHOUT the crew, so this proves nothing');
  assert((immune.rocket.stack || []).length === 1,
    `ROCKETEERS lost a card to the pad: ${JSON.stringify(immune.rocket.stack)}`);
  return 'the pad took the ordinary stack and left the Rocketeers alone';
});

// ROCKETEERS also reads "-2 to Belt Rolls for Earth zone Radiation Belts", and
// THERMAL RESEARCH (BRIN) reads "your radiators have 2 extra Rad-Hard during a
// Belt Roll". Both are exercised through a REAL move into an Earth-zone belt,
// with a radiator soft enough that the difference decides whether it survives.
const EARTH_BELT = 'rad-rttd0';
const BELT_FROM = 'burn-ue3lc';
check('the Earth-zone belt bonuses decide a real Belt Roll', () => {
  assert(zoneOfSlug(EARTH_BELT) === 'Earth', `${EARTH_BELT} is not in the Earth zone`);
  assert(hazardKind(EARTH_BELT) === 'rad', `${EARTH_BELT} is not a radiation belt`);
  const radiator = PATENTS.find((c) => c.type === 'radiator');
  const moveIntoBelt = (cardId, face, cursor = 0) => {
    const st = startedGame({ seats: 2 });
    st.rng.cursor = cursor;
    const me = st.players[0];
    if (cardId) promo(st, 0, cardId, face);
    st.activeIndex = 0;
    me.rocket.siteId = BELT_FROM;
    me.rocket.stack = [
      { id: thruster.id, kind: 'patent', face: 'primary' },
      { id: radiator.id, kind: 'patent', face: 'primary', radSide: 'light' },
    ];
    me.rocket.activeThrusterId = thruster.id;
    me.rocket.tank = 12;
    return applyOperation(st, {
      kind: 'MOVE',
      segments: [{ from: BELT_FROM, to: EARTH_BELT, burns: 1, turn: 1 }],
    }, { profileId: me.profileId });
  };
  const held = (r) => (r.state.players[0].rocket.stack || []).some((s) => s.id === radiator.id);
  // Find a roll the plain ship LOSES the radiator to: a d6 of 1 costs nobody
  // anything and would prove nothing about a -2. The rng is seeded + cursored,
  // so walking the cursor picks a real roll deterministically.
  let cursor = -1;
  for (let c = 0; c < 400; c++) {
    const r = moveIntoBelt(null, 'primary', c);
    if (r.ok && !held(r)) { cursor = c; break; }
  }
  assert(cursor >= 0, 'no belt roll in 400 cursors was hard enough to take the radiator');
  const plainRun = moveIntoBelt(null, 'primary', cursor);
  const rocketeers = moveIntoBelt('crew_the_martian_way', 'primary', cursor);
  const thermal = moveIntoBelt('crew_brin', 'primary', cursor);
  for (const [name, r] of [['plain', plainRun], ['rocketeers', rocketeers], ['thermal', thermal]]) {
    assert(r.ok, `the ${name} move was rejected: ${r.error}`);
  }
  // Same seed, same route, same roll: only the modifier differs.
  assert(!held(plainRun), `the belt spared the radiator with no crew bonus, so this proves nothing: ${plainRun.log}`);
  assert(held(rocketeers), `ROCKETEERS did not soften the Earth belt: ${rocketeers.log}`);
  assert(held(thermal), `THERMAL RESEARCH did not harden the radiator: ${thermal.log}`);
  return `the belt (cursor ${cursor}) took the plain radiator and left both crews their own`;
});

// DOWSERS (Cerulean): "When ISRU refueling for water, refuel at an ISRU = 0."
check('DOWSERS refuels at ISRU 0', () => {
  const SITE = 'hathor';   // hydration 1, so an ordinary rig out-rates it
  const run = (withCrew) => {
    const st = startedGame({ seats: 2 });
    const me = st.players[0];
    if (withCrew) promo(st, 0, 'crew_cerulean', 'secondary');
    st.activeIndex = 0;
    const site = siteBySlug(SITE);
    assert(site, `${SITE} is not a site`);
    me.rocket.siteId = SITE;
    // A rig whose ISRU is HIGHER than the site's water: refused outright
    // without the crew, and free with it.
    // ISRU lives in the face's `properties` list, not as a bare field.
    const isruOf = (c) => {
      const props = (c.faces && c.faces.primary && c.faces.primary.properties) || c.properties || [];
      const p = props.find((x) => x.key === 'isru');
      return p ? Number(p.value) : null;
    };
    const rig = PATENTS.find((c) => c.type === 'robonaut' && isruOf(c) > (site.hydration | 0));
    assert(rig, 'no robonaut rig out-rates this site');
    me.rocket.stack = [{ id: rig.id, kind: 'patent', face: 'primary' }];
    me.rocket.activeProspectorId = rig.id;
    me.rocket.tank = 0;
    return applyOperation(st, { kind: 'SITE_REFUEL', siteId: SITE, mode: 'isru' },
      { profileId: me.profileId });
  };
  const without = run(false);
  const with_ = run(true);
  assert(!without.ok && without.error === 'isru_too_high',
    `expected isru_too_high without the crew, got ${without.ok ? 'ok' : without.error}`);
  assert(with_.ok, `DOWSERS was still refused: ${with_.error}`);
  assert(/Dowsers/i.test(with_.log || ''), `the log does not name Dowsers: ${with_.log}`);
  return `refused at ${without.error} without, accepted with`;
});

// OFFWORLD TRADE NEXUS (Makers Guild): Bernal Profits from any Factory or
// anchored Bernal, not just a Home Bernal.
check('OFFWORLD TRADE NEXUS earns Bernal Profits off a plain Factory', () => {
  const run = (withCrew) => {
    const st = startedGame({ seats: 2, m0: true, m1: true, m2: true });
    const me = st.players[0];
    if (withCrew) promo(st, 0, 'crew_makers_guild', 'primary');
    me.bernals = [];                                   // no Home Bernal anywhere
    st.factories = { ceres: { ownerId: me.profileId, spectralType: 'C' } };
    const before = me.aqua | 0;
    st.activeIndex = 1;                                // the OTHER seat ends its turn...
    const r = applyOperation(st, { kind: 'END_TURN' }, { profileId: st.players[1].profileId });
    assert(r.ok, `END_TURN rejected: ${r.error}`);
    return (r.state.players[0].aqua | 0) - before;     // ...so my turn opens
  };
  assert(run(false) === 0, 'a plain Factory paid Bernal Profits with no crew, so this proves nothing');
  assert(run(true) === 1, `the Nexus did not pay: gained ${run(true)}`);
  return '+1 aqua with the crew, nothing without';
});

// WATER ARCJET / HYDROGEN ARCJET (Baltimore Gun Club): "a colocated thruster
// gets a bonus burn" when the move starts at a qualifying departure. The white
// face credits LEO only; the flipped black face also credits the player's own
// anchored Bernal or Factory. The credit is a faction privilege, so Anarchy
// suspends it, but the crew has to be ABOARD - it is colocation, not a
// player-level read.
check('the Gun Club arcjet buys a burn, and only where the card says', () => {
  const BURN_FROM = 'burn-ue3lc';
  // Fuel spent on one move, with and without the crew aboard. Same seed, same
  // route: the only difference is the arcjet credit.
  const spend = ({ aboard, face = 'primary', at = null, anarchy = false, ownFactory = false }) => {
    const st = startedGame({ seats: 2, m0: true, m1: true, m2: true });
    const me = st.players[0];
    st.activeIndex = 0;
    if (anarchy) st.anarchy = true;
    me.rocket.siteId = at;
    // A strong thruster so the Factory departure is not refused for liftoff -
    // this check is about the arcjet credit, not the lander burn.
    const engine = PATENTS.find((c) => c.id === 'thr_dumbo') || thruster;
    me.rocket.stack = [{ id: engine.id, kind: 'patent', face: 'primary' }];
    if (aboard) me.rocket.stack.push({ id: 'crew_baltimore_gun_club', kind: 'crew', face });
    me.rocket.activeThrusterId = engine.id;
    me.rocket.tank = 20;
    if (ownFactory) st.factories = { [at]: { ownerId: me.profileId, spectralType: 'C' } };
    const from = at, to = at === null ? BURN_FROM : null;
    const r = applyOperation(st, {
      kind: 'MOVE',
      segments: [{ from, to: to || 'burn-gz7tn', burns: 2, turn: 1 }],
    }, { profileId: me.profileId });
    if (!r.ok) return { error: r.error };
    return { tank: r.state.players[0].rocket.tank };
  };
  const plain = spend({ aboard: false, at: null });
  const withCrew = spend({ aboard: true, at: null });
  assert(!plain.error, `the control move was rejected: ${plain.error}`);
  assert(!withCrew.error, `the Gun Club move was rejected: ${withCrew.error}`);
  assert(withCrew.tank > plain.tank,
    `departing LEO cost the Gun Club the same as everyone else (${withCrew.tank} vs ${plain.tank})`);
  // The WHITE face credits LEO only, so at a Factory it is an ordinary ship.
  const FAC = 'hathor';   // size 1, so a strong engine can climb off it
  const whiteAtFactory = spend({ aboard: true, at: FAC, face: 'primary', ownFactory: true });
  const plainAtFactory = spend({ aboard: false, at: FAC, ownFactory: true });
  const blackAtFactory = spend({ aboard: true, at: FAC, face: 'secondary', ownFactory: true });
  for (const [n, r] of [['white', whiteAtFactory], ['plain', plainAtFactory], ['black', blackAtFactory]]) {
    assert(!r.error, `the ${n} Factory move was rejected: ${r.error}`);
  }
  assert(whiteAtFactory.tank === plainAtFactory.tank,
    'the WHITE face bought a burn at a Factory, which only the flipped face does');
  assert(blackAtFactory.tank > plainAtFactory.tank,
    `the flipped HYDROGEN face did not buy a burn at its own Factory (${blackAtFactory.tank} vs ${plainAtFactory.tank})`);
  // Anarchy suspends faction privileges, this one included.
  const underAnarchy = spend({ aboard: true, at: null, anarchy: true });
  assert(!underAnarchy.error, `the Anarchy move was rejected: ${underAnarchy.error}`);
  assert(underAnarchy.tank === plain.tank,
    'the arcjet kept paying through Anarchy, which suspends faction privileges');
  return 'credited at LEO, white face not at a Factory, black face yes, and off under Anarchy';
});

// COLLECTIVE BARGAINING (LEO Workers' Union, white): "Receive 2 Aqua at game
// start. You may commit Murder/Suicide." Both clauses.
check('COLLECTIVE BARGAINING banks 2 aqua and permits the one felony', () => {
  // Clause 1: "+2 Aqua at game start", paid when the crew draft CLOSES.
  // Seat 1 is seated directly (the wizard never offers a promo card, and a
  // PICK_CREW promo pick needs the full module stack); seat 2 then picks
  // normally, and THAT pick is what closes the draft and runs the payout. The
  // control seats an ordinary crew the same way, so the only difference between
  // the two runs is which card seat 1 holds.
  const draftAqua = (withCrew) => {
    const roster = [{ profileId: 1, name: 'P1', seat: 1 }, { profileId: 2, name: 'P2', seat: 2 }];
    const st = createInitialState({ players: roster, seed: 'check-engine', maxRounds: 5 });
    const [one, two] = st.players;
    const ordinary = CREW.find((c) => c.color === one.color) || CREW[0];
    one.faction = withCrew
      ? { cardId: 'crew_leo_workers_union', face: 'primary' }
      : { cardId: ordinary.id, face: 'primary' };
    const before = one.aqua | 0;
    const card2 = CREW.find((c) => c.color === two.color && c.id !== ordinary.id) || CREW[1];
    const r = applyOperation(st, { kind: 'PICK_CREW', cardId: card2.id, face: 'primary' },
      { profileId: two.profileId });
    assert(r.ok, `the closing PICK_CREW was rejected: ${r.error}`);
    assert(r.state.draftPhase !== 'crew', `the draft did not close (phase ${r.state.draftPhase})`);
    return (r.state.players[0].aqua | 0) - before;
  };
  const plainStart = draftAqua(false);
  const unionStart = draftAqua(true);
  assert(plainStart === 0,
    `an ordinary crew was paid ${plainStart} aqua at draft close, so this proves nothing`);
  assert(unionStart === 2,
    `COLLECTIVE BARGAINING banked ${unionStart} aqua at draft close, not 2`);
  // Clause 2: a Human colonist may be decommissioned outside Anarchy.
  // No Module 2 here: 2B3b locks faction privileges until a Home Bernal is
  // anchored, and the printed text carries no such clause - this is the core
  // felony permission, so it is checked in a core game.
  const scrapHuman = (withCrew) => {
    const st = startedGame({ seats: 2 });
    const me = st.players[0];
    st.activeIndex = 0;
    if (withCrew) promo(st, 0, 'crew_leo_workers_union', 'primary');
    const human = Object.values(COLONISTS_BY_ID).find((c) => c && c.colonistKind === 'Human');
    assert(human, 'no Human colonist in the data');
    me.rocket.siteId = null;
    me.rocket.stack = [{ id: thruster.id, kind: 'patent', face: 'primary' },
      { id: human.id, kind: 'colonist', face: 'primary' }];
    me.opsRemaining = Math.max(1, me.opsRemaining | 0);
    const r = applyOperation(st, { kind: 'DECOMMISSION', cardIds: [human.id], from: 'rocket' },
      { profileId: me.profileId });
    if (!r.ok) return { error: r.error };
    return { gone: !(r.state.players[0].rocket.stack || []).some((s) => s.id === human.id) };
  };
  const without = scrapHuman(false);
  const withIt = scrapHuman(true);
  assert(without.error === 'nothing_decommissioned' || !without.gone,
    `the control seat scrapped a Human without the privilege (${without.error || 'it went'})`);
  assert(!withIt.error && withIt.gone,
    `COLLECTIVE BARGAINING could not scrap a Human: ${withIt.error || 'it stayed aboard'}`);
  return `+${unionStart} aqua at draft close (control +${plainStart}), and only the Union may let a Human go`;
});

// RABBLE-ROUSER (AEB, black): "When you lobby authority in season blue, you may
// end or initiate anarchy." The trigger is an authority Lobby with the Sunspot
// Cube in season blue; the effect is a straight toggle of the Anarchy condition,
// opted into per Lobby. Anarchy suspends faction privileges, so the "end" half of
// the printed text is deliberately readable THROUGH Anarchy - both directions are
// checked here, each against a CONTROL seat that has no AEB card.
check('RABBLE-ROUSER starts and ends Anarchy off an authority lobby', () => {
  const BLUE = 11;     // season blue wraps slots 10, 11, 0, 1
  const YELLOW = 3;
  // One Lobby, with every knob the printed text names. Only `withCrew` differs
  // between a run and its control.
  const lobby = ({ withCrew, slot = BLUE, anarchy = false, rouse = true, ideology = 'authority' }) => {
    const st = startedGame({ seats: 2, m0: true });
    const me = st.players[0];
    st.activeIndex = 0;
    st.turn = slot;
    st.anarchy = anarchy;
    st.activeLawStar = 'centrist';   // so the lobbied ideology is never already in power
    if (withCrew) promo(st, 0, 'crew_aeb', 'secondary');
    me.aqua = 5;
    me.lobbiedThisTurn = false;
    st.assembly.delegates[ideology] = { ...(st.assembly.delegates[ideology] || {}), [me.profileId]: 1 };
    return applyOperation(st, { kind: 'LOBBY', ideology, ...(rouse ? { rabbleRouser: true } : {}) },
      { profileId: me.profileId });
  };
  // The control seat can lobby authority in season blue perfectly well - it just
  // cannot raise the rabble, so the refusal below is about the ability, not the Lobby.
  const controlPlain = lobby({ withCrew: false, rouse: false });
  assert(controlPlain.ok, `the control seat could not even lobby: ${controlPlain.error}`);
  assert(!controlPlain.state.anarchy, 'a plain authority lobby started Anarchy on its own');
  // Initiate.
  const control = lobby({ withCrew: false });
  assert(!control.ok && control.error === 'no_rabble_rouser',
    `a seat without AEB raised the rabble: ${control.ok ? 'accepted' : control.error}`);
  const started = lobby({ withCrew: true });
  assert(started.ok, `RABBLE-ROUSER was refused: ${started.error}`);
  assert(started.state.anarchy === true, 'the rouse did not start Anarchy');
  assert(/Rabble-Rouser/.test(started.log || ''), `the log does not name the Rabble-Rouser: ${started.log}`);
  // End - the half that only exists while Anarchy has every faction privilege off.
  const controlEnd = lobby({ withCrew: false, anarchy: true });
  assert(!controlEnd.ok && controlEnd.error === 'no_rabble_rouser',
    `a seat without AEB ended Anarchy: ${controlEnd.ok ? 'accepted' : controlEnd.error}`);
  const ended = lobby({ withCrew: true, anarchy: true });
  assert(ended.ok, `RABBLE-ROUSER could not end Anarchy: ${ended.error}`);
  assert(ended.state.anarchy === false, 'Anarchy survived the rouse that ends it');
  // The printed conditions, each refused on its own.
  const offSeason = lobby({ withCrew: true, slot: YELLOW });
  assert(!offSeason.ok && offSeason.error === 'rouse_needs_blue_season',
    `the rouse fired outside season blue: ${offSeason.ok ? 'accepted' : offSeason.error}`);
  const wrongLaw = lobby({ withCrew: true, ideology: 'freedom' });
  assert(!wrongLaw.ok && wrongLaw.error === 'rouse_needs_authority',
    `the rouse fired off a non-authority lobby: ${wrongLaw.ok ? 'accepted' : wrongLaw.error}`);
  // "May", not "must": the same seat lobbying authority in season blue without
  // asking for the rouse leaves Anarchy exactly where it was.
  const declined = lobby({ withCrew: true, rouse: false });
  assert(declined.ok, `the plain lobby was refused: ${declined.error}`);
  assert(!declined.state.anarchy, 'the rouse fired without being asked for');
  return 'started, ended, refused off-season, off-authority, unasked, and to a seat without the card';
});

// ----- MOONCABLE (NASRDA), as printed on the card -----
//
// "Free action 1/turn at LEO/Home Bernal: refuel an active dirt thruster
// (7 tanks, or 1 if a Crew thruster). Negotiable. Only 1 dirt tank refuel per
// turn." It is in the card's BONUS slot, so it is a faction PRIVILEGE and
// Anarchy suspends it.

// The NASRDA card, on its Mooncable face, with a card dirt thruster active.
function mooncableGame({ anarchy = false, crewTriangle = false } = {}) {
  const st = startedGame({ seats: 2 });
  const me = st.players[0];
  st.activeIndex = 0;
  me.color = CREW.find((c) => c.id === 'crew_shimizu_nasrda').color;
  me.faction = { cardId: 'crew_shimizu_nasrda', face: 'secondary' };   // MOONCABLE
  const dirt = PATENTS.find((c) => c.id === 'thr_mass_driver');        // a dirt-fuelled card
  me.rocket.siteId = null;                                            // at LEO, the depot
  me.rocket.stack = [
    { id: 'crew_shimizu_nasrda', kind: 'crew', face: 'secondary' },
    { id: dirt.id, kind: 'patent', face: 'primary' },
  ];
  me.rocket.activeThrusterId = crewTriangle ? 'crew_shimizu_nasrda' : dirt.id;
  me.rocket.tank = 0;
  me.opsRemaining = 4;
  st.turnActions = [];
  if (anarchy) st.anarchy = true;
  return st;
}
const dirtRefuel = (st, amount) => applyOperation(st,
  { kind: 'DIRT_REFUEL', ...(amount ? { amount } : {}) },
  { profileId: st.players[0].profileId });

check('MOONCABLE pipes at most 7 tanks, and only once a turn', () => {
  const st = mooncableGame();
  const first = dirtRefuel(st, 99);
  assert(first.ok, `the first cable refuel was rejected: ${first.error}`);
  const tank = first.state.players[0].rocket.tank;
  assert(tank > 0, 'the cable loaded nothing');
  assert(tank <= 7, `the cable piped more than 7 tanks: ${tank}`);
  // ...and it cannot run twice in the same turn.
  const second = dirtRefuel(first.state, 1);
  assert(!second.ok && second.error === 'mooncable_used',
    `expected mooncable_used on the second use, got ${second.ok ? 'ok' : second.error}`);
  return `loaded ${tank} tanks, second use refused`;
});

check('MOONCABLE pipes only 1 tank into a CREW triangle', () => {
  const st = mooncableGame({ crewTriangle: true });
  const r = dirtRefuel(st, 99);
  assert(r.ok, `the crew-triangle refuel was rejected: ${r.error}`);
  const tank = r.state.players[0].rocket.tank;
  assert(tank <= 1, `a crew triangle took more than 1 tank: ${tank}`);
  return `loaded ${tank} tank`;
});

check('MOONCABLE is suspended under Anarchy', () => {
  const calm = dirtRefuel(mooncableGame(), 1);
  assert(calm.ok, `the cable did not work in a calm game: ${calm.error}`);
  const anarchic = dirtRefuel(mooncableGame({ anarchy: true }), 1);
  assert(!anarchic.ok && anarchic.error === 'dirt_needs_mooncable',
    `the cable still ran under Anarchy: ${anarchic.ok ? 'accepted' : anarchic.error}`);
  return 'works in a calm game, refused under Anarchy';
});

// V9 solitaire cuts the library by SPECTRAL type, which is a rule about
// patents. The M2 Bernal deck has no spectral at all, so it used to read as 'C'
// and land entirely on the Earthling side - a solitaire Siren opened with no
// stations to auction. A deck with no spectral splits EVENLY instead, the way
// the colonist queue already does.
check('a solitaire Siren gets a share of the Bernal deck under M2', () => {
  const seatAs = (species) => {
    const st = createInitialState({
      players: [{ profileId: 1, name: 'P1', seat: 1 }],
      seed: 'check-engine', maxRounds: 5, sirens: true, m0: true, m1: true, m2: true, ceoSolo: true,
    });
    const total = (st.decks.bernal || []).length;
    assert(total > 0, 'the M2 game opened with no Bernal deck at all');
    const card = CREW.find((c) => c.color === st.players[0].color) || CREW[0];
    const r = applyOperation(st, { kind: 'PICK_CREW', cardId: card.id, face: 'primary', species },
      { profileId: 1 });
    assert(r.ok, `PICK_CREW rejected: ${r.error}`);
    const mine = species === 'siren'
      ? ((r.state.sirenDecks || {}).bernal || [])
      : (r.state.decks.bernal || []);
    return { total, mine: mine.length, split: !!r.state.sirenDecks };
  };
  const siren = seatAs('siren');
  const earth = seatAs('earthling');
  assert(siren.split, 'the solitaire library was never split, so this proves nothing');
  // Split EVENLY between the two species, the way the colonist queue is - a
  // deck with no spectral has nothing for the D/V cut to read.
  assert(siren.mine > 0 && siren.mine < siren.total,
    `a solitaire Siren got ${siren.mine} of ${siren.total} Bernals`);
  assert(earth.mine > 0 && earth.mine < earth.total,
    `a solitaire Earthling got ${earth.mine} of ${earth.total} Bernals`);
  assert(siren.mine + earth.mine === siren.total,
    `the halves do not add up: ${siren.mine} + ${earth.mine} of ${siren.total}`);
  // ...and the PATENT cut still happens, or the exemption went too wide.
  const st2 = createInitialState({
    players: [{ profileId: 1, name: 'P1', seat: 1 }],
    seed: 'check-engine', maxRounds: 5, sirens: true, m0: true, m1: true, m2: true, ceoSolo: true,
  });
  const thrTotal = (st2.decks.thruster || []).length;
  const card2 = CREW.find((c) => c.color === st2.players[0].color) || CREW[0];
  const r2 = applyOperation(st2, { kind: 'PICK_CREW', cardId: card2.id, face: 'primary', species: 'siren' },
    { profileId: 1 });
  const sirenThr = ((r2.state.sirenDecks || {}).thruster || []).length;
  assert(sirenThr > 0 && sirenThr < thrTotal,
    `the thruster deck was not cut by spectral any more (${sirenThr} of ${thrTotal})`);
  return `${siren.total} Bernals split ${siren.mine}/${earth.mine}; thrusters still cut ${sirenThr}/${thrTotal}`;
});

// Games cut BEFORE the Bernal exemption cannot re-cut themselves (the split
// runs once, at crew-draft close), so the engine repairs them in place.
check('a game already dealt the bad Bernal split is repaired in place', () => {
  const st = createInitialState({
    players: [{ profileId: 1, name: 'P1', seat: 1 }],
    seed: 'check-engine', maxRounds: 5, sirens: true, m0: true, m1: true, m2: true, ceoSolo: true,
  });
  const card = CREW.find((c) => c.color === st.players[0].color) || CREW[0];
  const picked = applyOperation(st, { kind: 'PICK_CREW', cardId: card.id, face: 'primary', species: 'siren' },
    { profileId: 1 });
  assert(picked.ok, `PICK_CREW rejected: ${picked.error}`);
  const broken = picked.state;
  // Re-create the OLD bad cut by hand: every Bernal on the Earthling side.
  broken.decks.bernal = [...(broken.decks.bernal || []), ...(broken.sirenDecks.bernal || [])];
  broken.sirenDecks.bernal = [];
  const total = broken.decks.bernal.length;
  assert(total > 0, 'no Bernals to break');
  // Any ordinary op runs the repair.
  const r = applyOperation(broken, { kind: 'INCOME' }, { profileId: 1 });
  assert(r.ok, `INCOME rejected: ${r.error}`);
  const earth = (r.state.decks.bernal || []).length;
  const siren = ((r.state.sirenDecks || {}).bernal || []).length;
  assert(siren > 0, `the repair left the Siren with no Bernals (${earth} / ${siren})`);
  assert(earth + siren === total, `the repair lost cards: ${earth} + ${siren} of ${total}`);
  assert(/re-dealt/i.test(r.log || ''), `the repair was silent: ${r.log}`);
  // ...and it is idempotent: a second op must not shuffle the halves again.
  // (Income is once a turn, so end the turn first.)
  const passed = applyOperation(r.state, { kind: 'END_TURN' }, { profileId: 1 });
  assert(passed.ok, `END_TURN rejected: ${passed.error}`);
  const again = applyOperation(passed.state, { kind: 'INCOME' }, { profileId: 1 });
  assert(again.ok, `second INCOME rejected: ${again.error}`);
  assert(((again.state.sirenDecks || {}).bernal || []).length === siren,
    'the repair fired twice and moved cards again');
  assert(!/re-dealt/i.test(again.log || ''), `the repair narrated itself twice: ${again.log}`);
  return `re-dealt ${total} Bernals ${earth}/${siren}, idempotent`;
});

// A MIXED table that started BEFORE a seat could declare its species never got
// its library cut (every seat defaulted to Sirenian, so the both-peoples test
// was false at draft close). Those games are cut retroactively on the next op.
check('a mixed table whose library was never cut is split retroactively', () => {
  let st = createInitialState({
    players: [{ profileId: 1, name: 'P1', seat: 1 }, { profileId: 2, name: 'P2', seat: 2 }],
    seed: 'check-engine', maxRounds: 5, sirens: true, m1: true, m2: true,
  });
  for (const p of [...st.players]) {
    const card = CREW.find((c) => c.color === p.color) || CREW[0];
    const r = applyOperation(st, { kind: 'PICK_CREW', cardId: card.id, face: 'primary', species: 'siren' },
      { profileId: p.profileId });
    assert(r.ok, `PICK_CREW rejected: ${r.error}`);
    st = r.state;
  }
  assert(!st.sirenDecks, 'an all-Sirenian table split its library, which C4 does not ask for');
  const thrTotal = (st.decks.thruster || []).length;
  // The seat is really an Earthling - the pre-picker game just had no way to
  // say so, which is what left the library uncut.
  st.players[1].species = 'earthling';

  const r = applyOperation(st, { kind: 'INCOME' }, { profileId: st.players[st.activeIndex].profileId });
  assert(r.ok, `INCOME rejected: ${r.error}`);
  const earth = (r.state.decks.thruster || []).length;
  const siren = ((r.state.sirenDecks || {}).thruster || []).length;
  assert(r.state.sirenDecks, 'the mixed table was still not split');
  assert(siren > 0 && earth > 0 && earth + siren === thrTotal,
    `the retro cut is wrong: ${earth} + ${siren} of ${thrTotal}`);
  assert(/divided between the two species/i.test(r.log || ''), `the cut was silent: ${r.log}`);

  // ...and it does not fire a second time.
  const passed = applyOperation(r.state, { kind: 'END_TURN' },
    { profileId: r.state.players[r.state.activeIndex].profileId });
  assert(passed.ok, `END_TURN rejected: ${passed.error}`);
  assert(((passed.state.sirenDecks || {}).thruster || []).length === siren,
    'the retro cut ran twice');
  return `cut ${thrTotal} thrusters ${earth}/${siren} on the next op`;
});

// A pre-picker table is all-Sirenian by default with nobody having chosen, so
// there is no Earthling to cut the library against. Those seats can declare
// late, once, and the cut follows immediately.
check('a legacy Sirens seat can declare its people, and the library cuts', () => {
  let st = createInitialState({
    players: [{ profileId: 1, name: 'P1', seat: 1 }, { profileId: 2, name: 'P2', seat: 2 }],
    seed: 'check-engine', maxRounds: 5, sirens: true, m1: true, m2: true,
  });
  for (const p of [...st.players]) {
    const card = CREW.find((c) => c.color === p.color) || CREW[0];
    // No species on the op: exactly what a pre-picker client sent.
    const r = applyOperation(st, { kind: 'PICK_CREW', cardId: card.id, face: 'primary' },
      { profileId: p.profileId });
    assert(r.ok, `PICK_CREW rejected: ${r.error}`);
    st = r.state;
  }
  assert(!st.sirenDecks, 'the all-Sirenian table cut its library, which C4 does not ask for');
  // Seat ORDER is shuffled, so find the seat by its profile id.
  const seatOf = (state, id) => state.players.find((p) => p.profileId === id);
  assert(!seatOf(st, 2).speciesChosen, 'a species-less pick still marked the seat as chosen');
  const thrTotal = (st.decks.thruster || []).length;

  const declared = applyOperation(st, { kind: 'SET_SPECIES', species: 'earthling' },
    { profileId: 2 });
  assert(declared.ok, `SET_SPECIES rejected: ${declared.error}`);
  const after = declared.state;
  assert(seatOf(after, 2).species === 'earthling', `the seat did not change (${seatOf(after, 2).species})`);
  assert(after.sirenDecks, 'the library was not cut once the table went mixed');
  const earth = (after.decks.thruster || []).length;
  const siren = (after.sirenDecks.thruster || []).length;
  assert(earth > 0 && siren > 0 && earth + siren === thrTotal,
    `the cut is wrong: ${earth} + ${siren} of ${thrTotal}`);
  assert(/declared for the Earthling people/i.test(declared.log || ''), `silent: ${declared.log}`);

  // Once only.
  const again = applyOperation(after, { kind: 'SET_SPECIES', species: 'siren' }, { profileId: 2 });
  assert(!again.ok && again.error === 'species_already_chosen',
    `a second declaration was allowed: ${again.ok ? 'accepted' : again.error}`);
  // ...unless an admin is fixing a table that clicked past the default.
  const byAdmin = applyOperation(after, { kind: 'SET_SPECIES', species: 'siren' },
    { profileId: 2, allowPromoCrew: true });
  assert(byAdmin.ok, `an admin could not re-declare: ${byAdmin.error}`);
  assert(seatOf(byAdmin.state, 2).species === 'siren', 'the admin re-declaration did not take');

  // ...and a seat that DID choose at pick time can never reach it.
  let fresh = createInitialState({
    players: [{ profileId: 1, name: 'P1', seat: 1 }],
    seed: 'check-engine', maxRounds: 5, sirens: true,
  });
  const c0 = CREW.find((c) => c.color === fresh.players[0].color) || CREW[0];
  fresh = applyOperation(fresh, { kind: 'PICK_CREW', cardId: c0.id, face: 'primary', species: 'siren' },
    { profileId: 1 }).state;
  const locked = applyOperation(fresh, { kind: 'SET_SPECIES', species: 'earthling' }, { profileId: 1 });
  assert(!locked.ok && locked.error === 'species_already_chosen',
    `a seat that chose at pick time could re-declare: ${locked.ok ? 'accepted' : locked.error}`);
  return `declared late, cut ${thrTotal} thrusters ${earth}/${siren}, once only`;
});

// The retroactive cut must not pre-empt an opening that schedules its own. V1
// Quick Start deliberately lets both species draw from ONE library for the
// first Solar Cycle and cuts at the bonus round; a repair firing during the
// draft would break that.
check('the retro cut waits for play to start', () => {
  // Build the one state the gate is there for: a MIXED table, no split yet, and
  // an opening still running. (The scheduled cuts - crew-draft close, and the
  // V1 bonus round - own that moment; a repair firing first would pre-empt
  // them.) Assembled by hand because the scheduled cut makes this unreachable
  // through ordinary play, which is exactly why the gate is defensive.
  let st = createInitialState({
    players: [{ profileId: 1, name: 'P1', seat: 1 }, { profileId: 2, name: 'P2', seat: 2 }],
    seed: 'check-engine', maxRounds: 5, sirens: true,
  });
  st.players[0].species = 'siren';
  st.players[1].species = 'earthling';
  st.players[0].faction = { cardId: CREW[0].id, face: 'primary' };
  st.players[1].faction = { cardId: CREW[1].id, face: 'primary' };
  delete st.sirenDecks;
  const thrTotal = (st.decks.thruster || []).length;
  for (const phase of ['crew', 'draft', 'bonus']) {
    st.draftPhase = phase;
    const notes = repairSpeciesDeckSplit(st);
    assert(!st.sirenDecks, `the library was cut during the ${phase} phase`);
    assert(!notes.length, `the repair spoke up during ${phase}: ${JSON.stringify(notes)}`);
  }
  // ...and once play starts it does its job.
  st.draftPhase = 'play';
  const notes = repairSpeciesDeckSplit(st);
  assert(st.sirenDecks, 'the repair never fired once play began');
  const earth = (st.decks.thruster || []).length;
  const siren = (st.sirenDecks.thruster || []).length;
  assert(earth + siren === thrTotal, `the cut lost cards: ${earth} + ${siren} of ${thrTotal}`);
  assert(notes.length, 'the cut was silent');
  return `held through crew / draft / bonus, cut ${earth}/${siren} at play`;
});

// ----- V9 Sirens: trade across the species line needs a physical meeting -----
//
// C4 gives the two peoples no access to each other's decks "except during trade
// ... or negotiation". User 2026-08-04: that crossing is COLOCATION - "the
// trade/negotiate mechanic should only be available to players being colocated
// with the other faction ... this rules out LEO based trade like hand cards and
// bank aqua for inter faction trade". So between an Earthling and a Siren even
// the abstract terms (a hand patent, a coin from the bank, a borrowed ability)
// wait for the two to be standing in the same Space. Between two players of the
// SAME people nothing changes.
const MEET_SITE = 'ceres';   // any shared location key; the meeting is what matters

// Put a card in `from`'s hand and a coin in `to`'s bank, then offer to swap them.
// Purely abstract terms - no fuel, no cargo - which is exactly what used to
// cross the species line for free.
function abstractTradeOffer(st, from, to) {
  const a = st.players.find((p) => p.profileId === from);
  const b = st.players.find((p) => p.profileId === to);
  const card = a.hand && a.hand.length ? a.hand[0] : PATENTS[0].id;
  a.hand = [card];
  b.aqua = Math.max(3, b.aqua | 0);
  return applyOperation(st, {
    kind: 'TRADE_OFFER', partnerId: to,
    give: { handCardIds: [card] }, receive: { aqua: 1 },
  }, { profileId: from });
}
// Park two seats' rockets on the same rock.
function standTogether(st, i, j, site = MEET_SITE) {
  st.players[i].rocket.siteId = site;
  st.players[j].rocket.siteId = site;
}

check('an Earthling and a Siren cannot deal from their separate homes', () => {
  const st = sirensGame();
  const [earth, siren] = st.players;
  assert(earth.rocket.siteId === null && siren.rocket.siteId === 'cordelia',
    `the two seats are not at their own homes (${earth.rocket.siteId} / ${siren.rocket.siteId})`);
  const r = abstractTradeOffer(st, earth.profileId, siren.profileId);
  assert(!r.ok, 'a hand patent crossed the species line with nobody standing together');
  assert(r.error === 'species_needs_meeting', `refused for the wrong reason: ${r.error}`);
  // ...and the same from the Siren's side.
  const back = abstractTradeOffer(st, siren.profileId, earth.profileId);
  assert(!back.ok && back.error === 'species_needs_meeting',
    `the Siren's side was not refused the same way (${back.ok ? 'accepted' : back.error})`);
  return 'refused both ways';
});

check('the same deal goes through once the two peoples stand together', () => {
  const st = sirensGame();
  standTogether(st, 0, 1);
  const [earth, siren] = st.players;
  const offered = abstractTradeOffer(st, earth.profileId, siren.profileId);
  assert(offered.ok, `the offer was refused at the meeting place: ${offered.error}`);
  const t = offered.state.trade;
  assert(t && t.location === MEET_SITE, `the deal was not struck at the meeting (${t && t.location})`);
  const card = t.give.handCardIds[0];
  const sirenAquaBefore = offered.state.players[1].aqua | 0;
  const accepted = applyOperation(offered.state, { kind: 'TRADE_ACCEPT', version: t.version },
    { profileId: siren.profileId });
  assert(accepted.ok, `the partner could not accept: ${accepted.error}`);
  const [e2, s2] = accepted.state.players;
  assert((s2.hand || []).includes(card), 'the patent never reached the Siren');
  assert(!(e2.hand || []).includes(card), 'the Earthling kept the patent too');
  assert((e2.aqua | 0) >= 1 && (s2.aqua | 0) === sirenAquaBefore - 1, 'the coin did not change hands');
  return `struck at ${MEET_SITE}`;
});

check('two players of the same people still deal from home', () => {
  // Seat an Earthling alongside two Sirens: the rule is per PAIR, not per table.
  const st = sirensGame(['earthling', 'siren', 'siren'], { seats: 3 });
  const [, a, b] = st.players;
  assert(a.rocket.siteId === 'cordelia' && b.rocket.siteId === 'cordelia',
    'the two Sirens are not both at Cordelia');
  // Sail one of them off, so this really tests that same-people terms travel
  // rather than that both happen to be sitting at home together.
  b.rocket.siteId = 'vesta';
  for (const p of [a, b]) {
    assert(!p.freighter && !(p.bernals || []).length && !Object.keys(p.outposts || {}).length,
      'a second unit could still put the two Sirens in the same space');
  }
  assert(a.rocket.siteId !== b.rocket.siteId, 'the two Sirens are still standing together');
  const r = abstractTradeOffer(st, a.profileId, b.profileId);
  assert(r.ok, `two Sirens light-years apart were refused an abstract deal: ${r.error}`);
  // And an Earthling is still refused at that same table, so the pass above is
  // the species rule holding rather than the rule being off.
  const st2 = sirensGame(['earthling', 'siren', 'siren'], { seats: 3 });
  const cross = abstractTradeOffer(st2, st2.players[0].profileId, st2.players[1].profileId);
  assert(!cross.ok && cross.error === 'species_needs_meeting',
    `the cross-species pair at the same table was not refused (${cross.ok ? 'accepted' : cross.error})`);
  return 'same people deal, the crossing does not';
});

check('a partner who flies off before the handshake cannot deal from afar', () => {
  const st = sirensGame();
  standTogether(st, 0, 1);
  const [earth, siren] = st.players;
  const offered = abstractTradeOffer(st, earth.profileId, siren.profileId);
  assert(offered.ok, `the offer was refused at the meeting: ${offered.error}`);
  const next = offered.state;
  next.players[1].rocket.siteId = 'cordelia';   // the Siren goes home mid-negotiation
  const accepted = applyOperation(next, { kind: 'TRADE_ACCEPT', version: next.trade.version },
    { profileId: siren.profileId });
  assert(!accepted.ok, 'the deal closed after the meeting broke up');
  assert(accepted.error === 'not_colocated', `refused for the wrong reason: ${accepted.error}`);
  return 'the meeting has to still be happening';
});

check('any pair of units makes the meeting, not just two rockets', () => {
  const st = sirensGame();
  const [earth, siren] = st.players;
  // The Earthling's OUTPOST meets the Siren's FREIGHTER on the same rock; both
  // rockets stay home.
  earth.outposts = { A: { letter: 'A', siteId: MEET_SITE, cards: [], tank: 0 } };
  siren.freighter = { cardId: null, face: 'primary', siteId: MEET_SITE, stack: [], tank: 0 };
  const r = abstractTradeOffer(st, earth.profileId, siren.profileId);
  assert(r.ok, `an outpost meeting a freighter was refused: ${r.error}`);
  assert(r.state.trade.location === MEET_SITE, `struck somewhere else (${r.state.trade.location})`);
  return 'outpost meets freighter';
});

check('a Siren scrapping their rocket goes home, not to Earth orbit', () => {
  const st = sirensGame();
  const [earth, siren] = st.players;
  // A Siren spacecraft dies out at a rock: it is recalled to CORDELIA. Sending
  // it to a bare null parked it in Earth orbit for free, which the meeting rule
  // would then read as a trade with every Earthling sitting at home.
  const lone = PATENTS.find((c) => c.type === 'robonaut') || PATENTS[0];
  siren.rocket.siteId = MEET_SITE;
  siren.rocket.stack = [{ id: lone.id, kind: 'patent', face: 'primary' }];
  siren.rocket.tank = 0;
  siren.opsRemaining = Math.max(1, siren.opsRemaining | 0);
  st.activeIndex = st.players.indexOf(siren);
  const scrapped = applyOperation(st,
    { kind: 'DECOMMISSION', cardIds: [lone.id], from: 'rocket' },
    { profileId: siren.profileId });
  assert(scrapped.ok, `the Siren could not scrap their last card: ${scrapped.error}`);
  const after = scrapped.state;
  const s2 = after.players[1];
  assert(s2.rocket.stack.length === 0, 'the rocket still carries a card, so it was never recalled');
  assert(s2.rocket.siteId === 'cordelia',
    `the Siren's scrapped rocket sits at ${JSON.stringify(s2.rocket.siteId)}, not Cordelia`);
  assert(s2.rocket.turnStartSiteId === 'cordelia',
    `the zone lock followed it to ${JSON.stringify(s2.rocket.turnStartSiteId)}`);
  // ...and it must NOT have created a free meeting at LEO.
  const r = abstractTradeOffer(after, earth.profileId, s2.profileId);
  assert(!r.ok && r.error === 'species_needs_meeting',
    `a scrapped Siren rocket opened a free meeting at LEO (${r.ok ? 'accepted' : r.error})`);
  return 'recalled to Cordelia, no phantom meeting';
});

check('an ordinary table trades from home exactly as before', () => {
  const st = startedGame();
  assert(!st.sirens, 'the control table is a Sirens game');
  const [a, b] = st.players;
  const r = abstractTradeOffer(st, a.profileId, b.profileId);
  assert(r.ok, `a normal table's home trade was refused: ${r.error}`);
  assert(r.state.trade.location === null,
    `a normal abstract trade pinned a meeting place (${r.state.trade.location})`);
  return 'unchanged';
});

// ----- V5 Hermes Fall: the SOLITAIRE Module 0 option (solo only) -----
//
// User 2026-08-04: "add m0 solitaire option for hermes fall / only available in
// solo mode". A ONE-SEAT Hermes room may take Module 0, and when it does it runs
// the SOLITAIRE Assembly (4G3) - the same law set CEO Solitaire uses - because
// the multiplayer laws are written around a contested tally a single player does
// not have. At two or more seats the option is not offered at all.
const hermesM0 = (seats, m0 = true) => createInitialState({
  players: Array.from({ length: seats }, (_, i) => ({ profileId: i + 1, name: `P${i + 1}`, seat: i + 1 })),
  seed: 'check-engine', maxRounds: 2, hermes: true, m0,
});

check('a solo Hermes room may run Module 0, a co-op one may not', () => {
  const solo = hermesM0(1);
  assert(solo.hermes === true, 'the solo table is not a Hermes game');
  assert(solo.m0 === true, `a one-seat Hermes room was refused Module 0 (m0=${solo.m0})`);
  assert(solo.soloAssembly === true, `the solo room did not flag the solitaire Assembly (${solo.soloAssembly})`);
  assert(!!solo.assembly, 'Module 0 is on but no Assembly was seated');
  // It takes the solitaire LAW SET, not CEO Solitaire's KPI loop: no board
  // meetings, no seniority demand pile, no fired/promoted verdict. Hermes has
  // its own clock and its own binary ending.
  assert(!solo.ceoSolo, 'a solo Hermes room turned into a CEO Solitaire game');
  assert(solo.demandPile === undefined, `CEO's demand pile leaked in (${JSON.stringify(solo.demandPile)})`);
  assert(solo.ceoLive === undefined, `CEO's live scoreboard leaked in (${JSON.stringify(solo.ceoLive)})`);
  assert(solo.hermesVerdict === null, `the Hermes ending was replaced (${solo.hermesVerdict})`);
  assert(solo.maxRounds === HERMES_ROUNDS,
    `Hermes lost its own two-cycle clock (maxRounds=${solo.maxRounds})`);

  for (const seats of [2, 3]) {
    const coop = hermesM0(seats);
    assert(coop.m0 === false, `a ${seats}-seat Hermes room kept Module 0 (m0=${coop.m0})`);
    assert(coop.soloAssembly === undefined,
      `a ${seats}-seat Hermes room flagged the solitaire Assembly (${coop.soloAssembly})`);
    assert(!coop.assembly, `a ${seats}-seat Hermes room seated an Assembly anyway`);
  }
  return 'on at one seat, off at two and three';
});

check('the solo Hermes Assembly runs the SOLITAIRE laws, not the base ones', () => {
  const solo = hermesM0(1);
  assert(usesSoloAssembly(solo), 'a solo Hermes + M0 game does not read as the solitaire assembly');
  // The law set is what actually differs. Freedom is Free Trade Act in the base
  // set and Free Trade Act II in the solitaire one.
  const soloLaw = lawForIdeology('freedom', usesSoloAssembly(solo));
  const baseLaw = lawForIdeology('freedom', false);
  assert(soloLaw && baseLaw && soloLaw.name !== baseLaw.name,
    'the two law sets are indistinguishable, so this check proves nothing');
  assert(soloLaw.name === SOLO_LAWS.freedom.name,
    `the solo Hermes mat shows ${soloLaw.name}, not ${SOLO_LAWS.freedom.name}`);

  // ...and an ordinary M0 game still reads the base set.
  const plain = createInitialState({
    players: [{ profileId: 1, name: 'P1', seat: 1 }, { profileId: 2, name: 'P2', seat: 2 }],
    seed: 'check-engine', maxRounds: 5, m0: true,
  });
  assert(!usesSoloAssembly(plain), 'an ordinary Module 0 table read as the solitaire assembly');
  return `${soloLaw.name} in solo Hermes, ${baseLaw.name} at an ordinary table`;
});

check('the solo Hermes table seats the 4G3a Centrist delegate', () => {
  const solo = hermesM0(1);
  const me = solo.players[0];
  const centrist = ((solo.assembly.delegates || {}).centrist || {})[me.profileId] | 0;
  assert(centrist === 1, `the extra Centrist delegate was not seated (${centrist})`);
  // An ordinary M0 table gets no such delegate, so this is the solitaire setup
  // and not something every Assembly does.
  const plain = createInitialState({
    players: [{ profileId: 1, name: 'P1', seat: 1 }, { profileId: 2, name: 'P2', seat: 2 }],
    seed: 'check-engine', maxRounds: 5, m0: true,
  });
  const plainCentrist = ((plain.assembly.delegates || {}).centrist || {})[plain.players[0].profileId] | 0;
  assert(plainCentrist === 0, `an ordinary Assembly seated a Centrist delegate too (${plainCentrist})`);
  return 'seated in solo Hermes, absent at an ordinary table';
});

check('a Hermes game without Module 0 carries no Assembly state', () => {
  const bare = hermesM0(1, false);
  assert(bare.m0 === false, `M0 leaked into a room that did not ask for it (${bare.m0})`);
  assert(bare.assembly === null, 'an Assembly was seated with Module 0 off');
  assert(bare.soloAssembly === undefined, `soloAssembly leaked (${bare.soloAssembly})`);
  assert(!usesSoloAssembly(bare), 'a Hermes game with no M0 reads as the solitaire assembly');
  return 'clean';
});

// ----- A ROAD IS BUGGY ONLY -----
//
// The board's yellow dashed roads join same-body dirtsides, and the map graph
// carries them as ordinary surface edges - so a ROCKET could drive between two
// Sites without going back to orbit. A player crossed Mars from Arsia Mons to
// Hellas Basin that way (user 2026-08-04). A road carries a buggy under The
// Martian free action; anything with a thruster has to fly.
check('a rocket cannot drive along a buggy road', () => {
  // A GW thruster (thrust 14) so the liftoff gate is satisfied at these size-10
  // Mars sites. That matters: with an under-thrust engine the drive is refused
  // for thrust anyway and the check could not tell the road rule from the
  // liftoff rule. Here the ONLY thing left to stop it is the road.
  const ENGINE = 'gw-_salt_water_zubrin';
  const drive = (fromSite, segs) => {
    const st = startedGame({ seats: 2, m1: true });
    st.activeIndex = 0;
    const me = st.players[0];
    me.rocket.siteId = fromSite;
    me.rocket.stack = [{ id: ENGINE, kind: 'patent', face: 'primary' }];
    me.rocket.activeThrusterId = ENGINE;
    me.rocket.tank = 40;
    me.rocket.tankGrade = 'isotope';   // a GW thruster burns isotope, not water
    me.aqua = 40;
    return applyOperation(st, { kind: 'MOVE', segments: segs }, { profileId: me.profileId });
  };
  // The reported crossing, verbatim: down Arsia Mons's own pad, then along the
  // surface to Hellas Basin, never touching an orbital space.
  const crossed = drive('mars-arsia-mons-caves', [
    { from: 'mars-arsia-mons-caves', to: 'burn-r1gov', burns: 1, turn: 1 },
    { from: 'burn-r1gov', to: 'dec-f2qna', burns: 1, turn: 1 },
    { from: 'dec-f2qna', to: 'mars-hellas-basin-buried-glaciers', burns: 1, turn: 1 },
  ]);
  assert(!crossed.ok, 'a rocket drove across the Mars surface from one Site to another');
  assert(crossed.error === 'road_is_buggy_only', `refused for the wrong reason: ${crossed.error}`);

  // The other Mars road, which runs through a pad that touches no orbit at all.
  const other = drive('mars-north-pole', [
    { from: 'mars-north-pole', to: 'dec-3mcui', burns: 1, turn: 1 },
    { from: 'dec-3mcui', to: 'burn-o0yoc', burns: 1, turn: 1 },
    { from: 'burn-o0yoc', to: 'dec-d42o9', burns: 1, turn: 1 },
    { from: 'dec-d42o9', to: 'mars-arsia-mons-caves', burns: 1, turn: 1 },
  ]);
  assert(!other.ok && other.error === 'road_is_buggy_only',
    `the North Pole road was not refused (${other.ok ? 'accepted' : other.error})`);

  // CONTROL: an ordinary descent from orbit is untouched. Without this the
  // check would pass just as well with every move refused.
  const descend = drive('lag-5pmg4', [
    { from: 'lag-5pmg4', to: 'lag-fp0u6', burns: 1, turn: 1 },
    { from: 'lag-fp0u6', to: 'mars-hellas-basin-buried-glaciers', burns: 1, turn: 1 },
  ]);
  assert(descend.ok, `an ordinary descent from orbit was refused: ${descend.error}`);

  // ...and it cannot be done in TWO turns by parking halfway. Blocking the
  // one-turn route alone left this open: stop on the road, finish next turn.
  const park = drive('mars-arsia-mons-caves', [
    { from: 'mars-arsia-mons-caves', to: 'burn-r1gov', burns: 1, turn: 1 },
    { from: 'burn-r1gov', to: 'dec-f2qna', burns: 1, turn: 1 },
  ]);
  assert(!park.ok, 'a rocket parked halfway along the Mars road, ready to finish next turn');
  assert(park.error === 'cannot_halt_bend_node', `parking refused for the wrong reason: ${park.error}`);
  return 'both Mars roads refused, no parking halfway, the descent from orbit still flies';
});

// Every buggy-road pair on the board, not just the one that was reported: the
// shortest route between them must no longer be a surface drive, and no site
// may be cut off by the rule.
check('no buggy-road pair keeps a surface route, and no site is stranded', () => {
  const typeOf = (slug) => { const n = plannerNodeBySlug(slug); return n ? n.type : null; };
  const pairs = [];
  for (const group of Object.values(BUGGY_ROAD_GROUPS)) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) pairs.push([group[i], group[j]]);
    }
  }
  assert(pairs.length >= 10, `expected the board's road pairs, found ${pairs.length}`);
  let surface = 0;
  for (const [a, b] of pairs) {
    const p = plannerFindPath(a, b);
    if (p && routeCrossesSurface(p.path, typeOf)) surface += 1;
  }
  assert(surface === pairs.length - 1 || surface > 0,
    'no road pair routed across the surface, so this check proves nothing');

  // Reachability: walk the graph under the rule and confirm every site is still
  // reachable from LEO. A rule that quietly strands a body would be worse than
  // the bug.
  const ORB = new Set(['lagrange', 'hohmann', 'radhaz']);
  const start = plannerLeoSlug();
  const key = (n, s, o) => `${n}|${s ? 1 : 0}|${o ? 1 : 0}`;
  const q = [[start, typeOf(start) === 'site', false]];
  const seen = new Set([key(...q[0])]);
  const found = new Set();
  while (q.length) {
    const [n, s, o] = q.shift();
    for (const m of (plannerNeighborSlugs(n) || [])) {
      const t = typeOf(m);
      let ns = s; let no = o;
      if (t === 'site') { if (s && !o) continue; ns = true; no = false; found.add(m); }
      else if (ORB.has(t)) no = true;
      const k = key(m, ns, no);
      if (seen.has(k)) continue;
      seen.add(k);
      q.push([m, ns, no]);
    }
  }
  const stranded = plannerAllSiteSlugs().filter((s) => s !== start && !found.has(s));
  assert(stranded.length === 0, `the road rule stranded ${stranded.length} site(s): ${stranded.slice(0, 5).join(', ')}`);
  return `${surface} road pairs route across the surface, 0 sites stranded`;
});

// ----- Liftoff is gated on every mover, and nothing halts on a pad -----
//
// Reported 2026-08-06: "Freighter is able to liftoff from a 6 site into a burn
// space" - Vesta, size 6 with a half lander burn. Thrust must be strictly
// greater than the site size to climb off, and factory-assist cannot carry a
// maneuver out through a lander burn. The Freighter and Bernal movers only ever
// had a LANDING gate; the liftoff side was never written.
check('a Freighter cannot climb off a size-6 site behind a lander burn', () => {
  const VESTA = 'vesta';
  const PAD = 'burn-tn04s';
  assert(nodeSizeNumber(VESTA) === 6, `Vesta is size ${nodeSizeNumber(VESTA)}, not 6`);
  assert(isLanderBurnNode(PAD), `${PAD} is not a lander burn`);
  const freighterMove = (siteId, segs) => {
    const st = startedGame({ seats: 2, m1: true });
    st.activeIndex = 0;
    const me = st.players[0];
    const frCard = PATENTS.find((c) => c.type === 'freighter');
    me.freighter = { cardId: frCard.id, face: 'primary', siteId, stack: [], tank: 0, wiring: {}, route: [] };
    me.freighterMovesRemaining = 1;
    me.aqua = 60;
    return applyOperation(st, { kind: 'MOVE', unit: 'freighter', segments: segs }, { profileId: me.profileId });
  };
  // Carry PAST the pad, so the only thing that can refuse this is the liftoff
  // gate. Ending on the pad would be refused by the cannot-halt rule instead
  // and the check could not tell the two apart.
  const off = freighterMove(VESTA, [
    { from: VESTA, to: PAD, burns: 1, turn: 1 },
    { from: PAD, to: 'lag-oenil', burns: 0, turn: 1 },
  ]);
  assert(!off.ok, 'the Freighter climbed off a size-6 lander-burn site at net thrust 1');
  assert(off.error === 'cannot_liftoff', `refused for the wrong reason: ${off.error}`);

  // CONTROL: a size-1 site is free to climb off, so the gate is not just
  // refusing every Freighter move.
  const small = 'cordelia';
  assert(nodeSizeNumber(small) === 1, `${small} is size ${nodeSizeNumber(small)}, not 1`);
  // Carry PAST the pad: a lander burn is not a place to stop, so the control
  // has to end somewhere real.
  const okMove = freighterMove(small, [
    { from: small, to: 'burn-0hh45', burns: 1, turn: 1 },
    { from: 'burn-0hh45', to: 'dec-eh416', burns: 0, turn: 1 },
    { from: 'dec-eh416', to: 'burn-mojo4', burns: 0, turn: 1 },
    { from: 'burn-mojo4', to: 'burn-gz7tn', burns: 0, turn: 1 },
  ]);
  assert(okMove.ok, `a Freighter was refused a legal climb off a size-1 site: ${okMove.error}`);
  return 'refused off Vesta, still flies off a size-1 site';
});

// A lander burn is a burn you cannot HALT on (H5e). The check used to live only
// inside the Acetylene branch, so every other move could park on a pad.
check('nothing ends its move sitting on a lander burn', () => {
  const SITE = 'cordelia';
  const PAD = 'burn-0hh45';
  assert(isLanderBurnNode(PAD), `${PAD} is not a lander burn`);
  const st = startedGame({ seats: 2, m1: true });
  st.activeIndex = 0;
  const me = st.players[0];
  const frCard = PATENTS.find((c) => c.type === 'freighter');
  me.freighter = { cardId: frCard.id, face: 'primary', siteId: SITE, stack: [], tank: 0, wiring: {}, route: [] };
  me.freighterMovesRemaining = 1;
  me.aqua = 60;
  const parked = applyOperation(st, {
    kind: 'MOVE', unit: 'freighter', segments: [{ from: SITE, to: PAD, burns: 1, turn: 1 }],
  }, { profileId: me.profileId });
  assert(!parked.ok, 'a Freighter ended its turn parked on a lander burn');
  assert(parked.error === 'cannot_halt_lander_burn', `refused for the wrong reason: ${parked.error}`);
  return 'the pad cannot be a destination';
});

// Synodic seasons gate ENTERING a seasonal space, not moving around inside one.
// The binary asteroid Hermes is the case that exposed the difference: both
// halves are blue-season, and a ship standing on Hermes A was refused the hop
// to Hermes B once the Sunspot Cube left blue, even though it never left the
// region. Drives the REAL client planner (planner-nav.js over the real map),
// because that is the code the player's tap actually runs.
await checkAsync('a ship inside a seasonal region keeps moving within it off-season', async () => {
  const graph = await loadClientPlannerMap();
  const byName = (n) => graph.sites.find((s) => s.name === n);
  const A = byName('Hermes A'), B = byName('Hermes B');
  const leo = graph.sites.find((s) => s.id2 === 'lag-leo');
  assert(A && B && leo, 'the map is missing Hermes A / Hermes B / LEO');
  assert(A.siteSynodic === 'blue' && B.siteSynodic === 'blue',
    `Hermes is no longer a blue-season pair (${A.siteSynodic} / ${B.siteSynodic})`);

  const routes = (from, to, season) => {
    const r = planClientRoute(graph, from.id, to.id, { thrust: 6, solarSeason: season });
    return !!(r && r.segments && r.segments.length);
  };

  // The reported bug: standing in blue space during the yellow season.
  assert(routes(A, B, 'yellow'), 'a ship on Hermes A could not reach Hermes B out of season');
  assert(routes(A, B, 'blue'), 'a ship on Hermes A could not reach Hermes B even in blue season');
  // The gate is still shut from OUTSIDE the region, which is the whole point
  // of it. Without this the check would pass on a gate that does nothing.
  assert(!routes(leo, B, 'yellow'), 'LEO reached blue-season Hermes B during the yellow season');
  assert(routes(leo, B, 'blue'), 'LEO could not reach Hermes B during its own blue season');
  return 'Hermes A to B flies off-season, LEO to Hermes B still does not';
});

// V9b: "Earthlings cannot touch Siren decks and vice versa." Every op that
// moves a card INTO a deck has to route by the acting player's species, and
// every op that takes one out has to draw from their own half. A single read of
// state.decks where decksFor(state, player) belonged silently mixes the two
// libraries, and the damage is invisible until a deck runs dry - so instead of
// checking one op, this walks EVERY path a card can take in or out of a deck
// and asserts the OTHER species' library never moves by so much as one card.
// (Reported 2026-08-06: a Sirens card sold on the Free Market should return to
// the Siren deck.)
function deckCensus(st) {
  const snap = (m) => Object.fromEntries(Object.entries(m || {}).map(([t, ids]) => [t, [...ids]]));
  return { earth: snap(st.decks), siren: snap(st.sirenDecks) };
}
// Compare as ORDERED lists, not sets: a card can legitimately appear twice
// while a check is being set up, and a set comparison would call that no
// change - which would let a real mix through.
function deckDelta(before, after, side) {
  const out = [];
  const types = new Set([...Object.keys(before[side]), ...Object.keys(after[side])]);
  for (const t of types) {
    const b = before[side][t] || [], a = after[side][t] || [];
    if (b.length === a.length && b.every((id, i) => id === a[i])) continue;
    out.push(`${t}: ${b.length} -> ${a.length}`);
  }
  return out;
}

check('a solo Siren never touches the Earthling library', () => {
  // One seat, Siren. The solitaire cut gives the Sirens the D and V patents.
  const base = sirensGame(['siren']);
  assert(base.sirenDecks, 'the solo Sirens game did not split its libraries');
  const me = base.players[0];
  assert(me.species === 'siren', `the seat is ${me.species}`);

  // Run one op on a fresh clone each time, so a path that fails to fire cannot
  // be masked by an earlier one, and report which library each disturbed.
  const run = (label, setup, act) => {
    const st = JSON.parse(JSON.stringify(base));
    const p = st.players[0];
    st.activeIndex = 0;
    p.opsRemaining = 4;
    p.aqua = 40;
    setup(st, p);
    // Census AFTER the setup, so the delta measures the OP and nothing else.
    const before = deckCensus(st);
    const res = act(st, p);
    assert(res && res.ok, `${label} was refused: ${res && res.error}`);
    const after = deckCensus(res.state);
    const earthMoved = deckDelta(before, after, 'earth');
    const sirenMoved = deckDelta(before, after, 'siren');
    assert(!earthMoved.length, `${label} moved cards in the EARTHLING library: ${earthMoved.join('; ')}`);
    assert(sirenMoved.length, `${label} did not move the Siren library at all, so it proves nothing`);
    return sirenMoved.join('; ');
  };
  const op = (st, p, o) => applyOperation(st, o, { profileId: p.profileId });
  // DRAW a card off the SIREN half into hand, the way the player got it, so the
  // card genuinely belongs to that library and the deck length is honest.
  const drawSiren = (st, p, type) => {
    const deck = st.sirenDecks[type] || [];
    assert(deck.length, `the solo Siren ${type} deck is empty, so this path cannot be exercised`);
    const id = deck.shift();
    p.hand = [...(p.hand || []), id];
    return id;
  };

  const seen = [];
  // 1. Free Market, one card.
  seen.push(run('FREE_MARKET (1 card)',
    (st, p) => { p.hand = []; st._id = drawSiren(st, p, 'radiator'); },
    (st, p) => op(st, p, { kind: 'FREE_MARKET', cardId: st._id })));
  // 2. Free Market, TWO cards - the Freedom law path (Free Trade Act II under
  // the solitaire Assembly). The law paths were flagged specifically.
  seen.push(run('FREE_MARKET (2 cards, Freedom)',
    (st, p) => {
      p.hand = [];
      st._a = drawSiren(st, p, 'refinery');
      st._b = drawSiren(st, p, 'refinery');
      p.lobbiedLaws = ['freedom'];
    },
    (st, p) => op(st, p, { kind: 'FREE_MARKET', cardIds: [st._a, st._b] })));
  // 3. Voluntary discard (a free action, so it spends no operation).
  seen.push(run('DISCARD',
    (st, p) => { p.hand = []; st._id = drawSiren(st, p, 'robonaut'); },
    (st, p) => op(st, p, { kind: 'DISCARD', cardId: st._id })));
  // 4. Research auction: the lot AND its bonus supports come out of a deck.
  seen.push(run('AUCTION_START',
    (st, p) => { p.hand = []; },
    (st, p) => op(st, p, { kind: 'AUCTION_START', deckType: 'refinery' })));

  // 5. Deck cycling is a TABLE event, so it is the one path that SHOULD move
  // both libraries - the opposite assertion, and the control proving the census
  // above can see an Earthling-side move at all.
  {
    const st = JSON.parse(JSON.stringify(base));
    const before = deckCensus(st);
    cycleMarketDecks(st);
    const after = deckCensus(st);
    assert(deckDelta(before, after, 'siren').length, 'a market shake-up did not cycle the Siren library');
    assert(deckDelta(before, after, 'earth').length,
      'a market shake-up did not cycle the Earthling library (a table event must move both)');
  }
  return `${seen.length} card paths stayed in the Siren library, and a table-wide cycle still moves both`;
});

// The mirror of the check above at a MIXED table, where the mistake is easier
// to make: with two seats there is a real Earthling whose ops must stay out of
// the Siren library just as firmly. Both directions, same ops.
check('at a mixed Sirens table neither species reaches the other library', () => {
  const base = sirensGame(['earthling', 'siren']);
  assert(base.sirenDecks, 'a mixed Sirens table did not split its libraries');
  const notes = [];
  for (const seat of [0, 1]) {
    const mine = seat === 1 ? 'siren' : 'earth';
    const theirs = seat === 1 ? 'earth' : 'siren';
    for (const kind of ['FREE_MARKET', 'DISCARD']) {
      const st = JSON.parse(JSON.stringify(base));
      const p = st.players[seat];
      st.activeIndex = seat;
      p.opsRemaining = 4;
      p.aqua = 40;
      // Draw off the acting player's OWN half, then put it back through the op.
      const myMap = seat === 1 ? st.sirenDecks : st.decks;
      const type = ['radiator', 'refinery', 'generator', 'robonaut'].find((t) => (myMap[t] || []).length);
      assert(type, `seat ${seat} has no non-empty deck to exercise`);
      const id = myMap[type].shift();
      p.hand = [id];
      const before = deckCensus(st);
      const res = applyOperation(st, { kind, cardId: id }, { profileId: p.profileId });
      assert(res.ok, `seat ${seat} ${kind} was refused: ${res.error}`);
      const after = deckCensus(res.state);
      const crossed = deckDelta(before, after, theirs);
      const own = deckDelta(before, after, mine);
      assert(!crossed.length,
        `a ${p.species}'s ${kind} moved the OTHER library (${theirs}): ${crossed.join('; ')}`);
      assert(own.length, `a ${p.species}'s ${kind} did not return the card to their own library`);
      notes.push(`${p.species}/${kind}`);
    }
  }
  return notes.join(', ');
});

// A returning card must never be DESTROYED. The Free Market / discard pushes
// used to read `const deck = decksFor(...)[type]; if (Array.isArray(deck))
// deck.push(id)`, which looks defensive but ate the card whenever the species
// map had no shelf for that type: it was already out of the hand, so it ended
// up in no deck, no hand, nowhere - and the deck read "empty" forever. That is
// exactly how it was reported (2026-08-06: a Sirens radiator free-marketed into
// nothing, "I don't have any radiators, deck is empty").
// The card sold is deliberately one the EARTHLING library dealt, held by a
// Siren (a technology trade puts one there). That makes the two behaviours tell
// apart, which a Siren-origin card cannot: the sale routes by the SELLER'S
// species (Siren shelf), while the lost-card sweep routes by sirenOrigin
// (Earthling shelf). If the push still drops the card, the sweep rescues it -
// to the wrong deck - and this check catches it. Asserting only "the card still
// exists" would pass either way, since the sweep runs after every op.
check('a card sold into a missing shelf is not destroyed', () => {
  for (const kind of ['FREE_MARKET', 'DISCARD']) {
    const st = sirensGame(['siren']);
    const p = st.players[0];
    st.activeIndex = 0;
    p.opsRemaining = 4;
    // An Earthling-library radiator in a Siren's hand.
    const id = st.decks.radiator[0];
    assert(id, 'the Earthling library has no radiator');
    assert(!(st.sirenOrigin || []).includes(id), `${id} is recorded as Siren-dealt, so it cannot tell the two paths apart`);
    st.decks.radiator.shift();
    p.hand = [id];
    // The shape an older / partial split leaves behind: no radiator shelf.
    const sirenBefore = [...(st.sirenDecks.radiator || [])];
    delete st.sirenDecks.radiator;
    const earthBefore = st.decks.radiator.length;
    const r = applyOperation(st, { kind, cardId: id }, { profileId: p.profileId });
    assert(r.ok, `${kind} was refused: ${r.error}`);
    const s = r.state;
    const inHand = (s.players[0].hand || []).includes(id);
    const inSiren = (s.sirenDecks.radiator || []).includes(id);
    const inEarth = s.decks.radiator.includes(id);
    assert(inHand || inSiren || inEarth, `${kind} DESTROYED ${id}: it is in no hand and no deck`);
    assert(inSiren, `${kind} did not return ${id} to the SELLER's library (siren=${inSiren} earth=${inEarth} hand=${inHand})`);
    assert(s.decks.radiator.length === earthBefore, `${kind} put the card back in the Earthling library`);
    assert((s.sirenDecks.radiator || []).length === sirenBefore.length + 1,
      'the Siren shelf did not gain exactly the one card');
  }
  return 'the shelf is created rather than the card dropped, both ways';
});

// The recovery half: a game that ALREADY lost cards to that bug gets them back
// on its next load. This only works if the census behind it knows every place a
// card can sit - a container it does not know about would make a card in play
// look lost and DUPLICATE it, which is worse than the bug. So the check proves
// both directions: a genuinely lost card comes back exactly once, and a card
// parked in each container in turn is never treated as lost.
check('lost cards come back, and cards in play are never duplicated', () => {
  const CONTAINERS = {
    hand:        (p, id) => { p.hand = [id]; },
    leo:         (p, id) => { p.leo = [{ id, kind: 'patent', face: 'primary' }]; },
    rocketStack: (p, id) => { p.rocket.stack = [{ id, kind: 'patent', face: 'primary' }]; },
    outpost:     (p, id) => { p.outposts = { ceres: { siteId: 'ceres', stack: [{ id, kind: 'patent', face: 'primary' }], tank: 0 } }; },
    bernalStack: (p, id) => { p.bernals = [{ cardId: BERNALS[0].id, stack: [{ id, kind: 'patent', face: 'primary' }] }]; },
    freighter:   (p, id) => { p.freighter = { cardId: null, stack: [{ id, kind: 'patent', face: 'primary' }], siteId: null, tank: 0 }; },
  };
  const notes = [];
  for (const [where, put] of Object.entries(CONTAINERS)) {
    const st = sirensGame(['siren']);
    const id = st.sirenDecks.radiator[0];
    assert(id, 'no radiator to move');
    st.sirenDecks.radiator.shift();          // out of the deck, into play
    put(st.players[0], id);
    repairSpeciesDeckSplit(st);
    const copies = (st.sirenDecks.radiator || []).filter((x) => x === id).length
      + st.decks.radiator.filter((x) => x === id).length;
    assert(copies === 0, `a card held in ${where} was treated as lost and duplicated back into a deck`);
    notes.push(where);
  }
  // Now genuinely lose one and confirm it returns, to its OWN library, once.
  const st = sirensGame(['siren']);
  const id = st.sirenDecks.radiator[0];
  st.sirenDecks.radiator.shift();            // gone: in no container at all
  assert(!st.decks.radiator.includes(id), 'the setup did not actually lose the card');
  const notesOut = repairSpeciesDeckSplit(st);
  assert((st.sirenDecks.radiator || []).filter((x) => x === id).length === 1,
    `the lost card did not come back to the Siren library (siren=${JSON.stringify(st.sirenDecks.radiator)})`);
  assert(!st.decks.radiator.includes(id), 'the lost card came back to the WRONG library');
  assert(notesOut.some((n) => /lost card/.test(n)), `the recovery said nothing: ${JSON.stringify(notesOut)}`);
  // ...and running it twice must not deal it a second time.
  repairSpeciesDeckSplit(st);
  assert((st.sirenDecks.radiator || []).filter((x) => x === id).length === 1,
    'a second load dealt the recovered card again');
  return `held in ${notes.join(' / ')} without duplication; a truly lost card returns once`;
});

// The recovery has to work for a game with NO provenance record. The species
// split shipped 2026-07-28 and sirenOrigin - the record of which library dealt
// each card - shipped 2026-07-29, so a Sirens game cut in that window has no
// record at all. Reading a missing record as "not Siren-dealt" sends every
// recovered card to the Earthling shelf, which is exactly what a solitaire
// Siren saw: their one radiator came back to the wrong library and their own
// deck stayed empty (2026-08-06). The solitaire cut is by spectral type, so it
// re-derives from the card itself.
check('a lost card comes home even with no provenance record', () => {
  const st = sirensGame(['siren']);
  assert(st.ceoSolo, 'a one-seat Sirens table is not running the solitaire cut, so the spectral rule would not apply');
  const id = st.sirenDecks.radiator[0];
  assert(id, 'the solo Siren has no radiator');
  const card = PATENTS_BY_ID_LOCAL[id];
  assert(['D', 'V'].includes(card.spectralType),
    `${id} is spectral ${card.spectralType}, so it is not one the solitaire cut gives the Sirens`);
  // A game from the window: split done, provenance never written, card lost.
  delete st.sirenOrigin;
  st.sirenDecks.radiator = [];
  const earthBefore = st.decks.radiator.length;
  repairSpeciesDeckSplit(st);
  assert((st.sirenDecks.radiator || []).includes(id),
    `the lost card did not come home to the Siren library (siren=${JSON.stringify(st.sirenDecks.radiator)})`);
  assert(!st.decks.radiator.includes(id), 'the lost card was returned to the Earthling library instead');
  assert(st.decks.radiator.length === earthBefore, 'the Earthling library changed size');
  // The record, when present, still wins: it is exact where the spectral rule
  // is only a reconstruction.
  const st2 = sirensGame(['siren']);
  const id2 = st2.sirenDecks.radiator[0];
  st2.sirenOrigin = [];                    // an explicit "the Earthlings dealt it"
  st2.sirenDecks.radiator = [];
  repairSpeciesDeckSplit(st2);
  assert(st2.decks.radiator.includes(id2),
    'the provenance record was ignored in favour of the spectral guess');
  return 'reconstructed from spectral when unrecorded, read off the record when present';
});

// The path that actually did the damage. destroyToDeckBottom takes the card's
// OWNER as its third argument and routes the card to that player's library;
// three call sites forgot to pass it, so decksFor(state, undefined) handed back
// the Earthling library. The Budget Cuts discard is the one a player hit: a
// solitaire Siren sent their only radiator to the bottom of the EARTHLING deck
// and their own radiator shelf stayed empty (2026-08-06, from the turn log -
// "sent Dielectric X-Ray Window to the bottom of its deck (Budget Cuts)").
check('a Budget Cuts discard goes to the discarding player own library', () => {
  const st = sirensGame(['siren']);
  const p = st.players[0];
  const id = st.sirenDecks.radiator[0];
  assert(id, 'the solo Siren has no radiator');
  st.sirenDecks.radiator.shift();
  p.hand = [id];
  st.pendingEvent = { kind: 'budget_cuts', waiting: [p.profileId] };
  const earthBefore = st.decks.radiator.length;
  const r = applyOperation(st, { kind: 'EVENT_CHOICE', cardId: id }, { profileId: p.profileId });
  assert(r.ok, `EVENT_CHOICE was refused: ${r.error}`);
  const s = r.state;
  assert((s.sirenDecks.radiator || []).includes(id),
    `the discard went to the wrong library (siren=${JSON.stringify(s.sirenDecks.radiator)}, earth has it=${s.decks.radiator.includes(id)})`);
  assert(s.decks.radiator.length === earthBefore, 'the Earthling library grew');
  return 'the Siren radiator came back to the Siren shelf';
});

// ...and the same repair moves one already filed wrong, which is the only way a
// game that took the damage before the fix can come right.
check('a card already filed in the wrong library is moved back', () => {
  const st = sirensGame(['siren']);
  assert(st.ceoSolo, 'a one-seat Sirens table is not solitaire, so the re-file would not run');
  const id = st.sirenDecks.radiator[0];
  st.sirenDecks.radiator = [];
  st.decks.radiator.push(id);                 // where the bug left it
  const earthBefore = st.decks.radiator.length;
  const notes = repairSpeciesDeckSplit(st);
  assert((st.sirenDecks.radiator || []).includes(id),
    `the card was not moved back (siren=${JSON.stringify(st.sirenDecks.radiator)})`);
  assert(!st.decks.radiator.includes(id), 'the card is still in the Earthling deck too');
  assert(st.decks.radiator.length === earthBefore - 1, 'the Earthling deck did not shed exactly one card');
  assert(notes.some((n) => /wrong library/.test(n)), `the re-file said nothing: ${JSON.stringify(notes)}`);
  // The sweep must be one-directional. A NON-D/V card in the Siren deck is what
  // a legitimate cross-library sale looks like (a Siren sells a card they got
  // by trade), so it has to be left exactly where it is.
  const st2 = sirensGame(['siren']);
  const earthling = st2.decks.radiator.find((x) => !['D', 'V'].includes((PATENTS_BY_ID_LOCAL[x] || {}).spectralType));
  assert(earthling, 'no non-D/V radiator to test the mirror with');
  st2.decks.radiator = st2.decks.radiator.filter((x) => x !== earthling);
  st2.sirenDecks.radiator.push(earthling);
  repairSpeciesDeckSplit(st2);
  assert(st2.sirenDecks.radiator.includes(earthling),
    'the sweep yanked a legitimately-sold card out of the Siren library');
  // And the Bernal deck, which splits evenly and has no spectral, is untouched.
  const st3 = sirensGame(['siren'], { m1: true, m2: true });
  if (Array.isArray(st3.sirenDecks.bernal)) {
    const before = [...st3.sirenDecks.bernal];
    repairSpeciesDeckSplit(st3);
    assert(st3.sirenDecks.bernal.length === before.length,
      `the re-file raided the Bernal deck (${before.length} -> ${st3.sirenDecks.bernal.length})`);
  }
  return 'moved back one way only, legitimate sales and the Bernal deck left alone';
});

// Seeing the card is not enough - you have to be able to TAKE it. The repairs
// used to run only AFTER a successful functional op, so a damaged game
// deadlocked: the read path repaired the view (the shelf showed the radiator)
// while the op ran against the raw state (still empty) and came back
// deck_empty. Reported verbatim from the turn log: "AUCTION_START ... That deck
// is empty. deck_empty - the game refused it {"deckType":"radiator"}".
check('a repaired deck can actually be auctioned, not just seen', () => {
  const st = sirensGame(['siren']);
  const p = st.players[0];
  st.activeIndex = 0;
  p.opsRemaining = 4;
  p.aqua = 40;
  p.hand = [];
  const id = st.sirenDecks.radiator[0];
  assert(id, 'the solo Siren has no radiator');
  // The damage: the card sits in the Earthling deck, the Siren shelf is empty.
  st.sirenDecks.radiator = [];
  st.decks.radiator.push(id);
  const r = applyOperation(st, { kind: 'AUCTION_START', deckType: 'radiator' }, { profileId: p.profileId });
  assert(r.ok, `AUCTION_START was refused: ${r.error} (the repair did not run before the op)`);
  // A solitaire table has nobody to bid against, so the lot resolves on the
  // spot and the card lands in hand rather than sitting open.
  const took = (r.state.players[0].hand || []).includes(id);
  const openLot = r.state.auction && r.state.auction.cardId === id;
  assert(took || openLot,
    `the recovered radiator neither went up nor came to hand (hand=${JSON.stringify(r.state.players[0].hand)})`);
  assert(!(r.state.sirenDecks.radiator || []).includes(id), 'the card is still sitting in the deck');
  return took ? 'the recovered radiator was taken straight into hand' : 'the recovered radiator went up for auction';
});

// A Human alongside clears a Glitch disc. The sweep ran after every FUNCTIONAL
// op but not on the META path - and END_TURN is exactly where the Sunspot clock
// DEALS a glitch. So a stack with crew aboard kept the disc until the player
// happened to run some other op, and every trigger warned about a Glitch Roll
// that was never going to happen (2026-08-07: a Cargo Transfer warned on a
// stack colocated with crew).
check('a glitch dealt at end of turn is cleared by the crew aboard', () => {
  const st = startedGame({ seats: 2 });
  const me = st.players[0];
  st.activeIndex = 0;
  me.rocket.siteId = 'ceres';
  me.rocket.stack = [
    { id: thruster.id, kind: 'patent', face: 'primary' },
    { id: me.faction.cardId, kind: 'crew', face: 'primary' },
  ];
  me.rocket.glitch = true;
  const r = applyOperation(st, { kind: 'END_TURN' }, { profileId: me.profileId });
  assert(r.ok, `END_TURN was refused: ${r.error}`);
  assert(r.state.players[0].rocket.glitch === false,
    'the glitch survived END_TURN even with crew aboard');
  // CONTROL: no Human anywhere near it and the disc stays, so the sweep is not
  // just clearing every glitch it finds.
  const st2 = startedGame({ seats: 2 });
  const me2 = st2.players[0];
  st2.activeIndex = 0;
  me2.rocket.siteId = 'ceres';
  me2.rocket.stack = [{ id: thruster.id, kind: 'patent', face: 'primary' }];
  me2.rocket.glitch = true;
  const r2 = applyOperation(st2, { kind: 'END_TURN' }, { profileId: me2.profileId });
  assert(r2.ok, `END_TURN was refused: ${r2.error}`);
  assert(r2.state.players[0].rocket.glitch === true,
    'a crewless stack had its glitch cleared for free');
  return 'cleared with crew aboard, kept without';
});

// Cordelia IS the Sirens' LEO (V9c), so it is mission control and no glitch
// lands there - LEO gets that for free by having no site slug, which is exactly
// why a Siren's home silently missed out (user 2026-08-07: "CORDELIA IS IMMUNE
// TO GLITCHES ... IT WONT FIX").
check('no glitch sticks to the Sirens home base', () => {
  const st = sirensGame(['siren']);
  const me = st.players[0];
  me.rocket.siteId = 'cordelia';
  me.rocket.stack = [{ id: thruster.id, kind: 'patent', face: 'primary' }];   // crewless
  me.rocket.glitch = true;
  me.outposts = { A: { letter: 'A', siteId: 'cordelia', cards: [{ id: thruster.id, kind: 'patent', face: 'primary' }], glitch: true } };
  autoFixGlitches(st);
  assert(st.players[0].rocket.glitch === false, 'a disc stuck to a stack at Cordelia');
  assert(st.players[0].outposts.A.glitch === false, 'a disc stuck to an outpost at Cordelia');
  // ZERO BLEED-THROUGH: in a game without the variant, Cordelia is an ordinary
  // rock and a crewless stack there keeps its disc.
  const plain = startedGame({ seats: 2 });
  const p0 = plain.players[0];
  p0.rocket.siteId = 'cordelia';
  p0.rocket.stack = [{ id: thruster.id, kind: 'patent', face: 'primary' }];
  p0.rocket.glitch = true;
  autoFixGlitches(plain);
  assert(plain.players[0].rocket.glitch === true,
    'Cordelia went glitch-proof in a game with no Sirens in it');
  return 'immune at the Siren home, ordinary everywhere else';
});

// "Diamonds Aren't Forever" splits by WHERE the stack is (user 2026-08-07:
// "sirens only die from glitch if flying in space ... but they can fix if
// glitch happens on the site"). The old reading was "Sirens cannot fix a
// glitch" at all, which left a disc on an at-home Siren stack forever.
check('Sirens repair a glitch on a site and die to one in space', () => {
  // ON A SITE: they fix it, and they live.
  const onSite = sirensGame(['siren']);
  const a = onSite.players[0];
  a.rocket.siteId = 'juliet';
  a.rocket.stack = [
    { id: thruster.id, kind: 'patent', face: 'primary' },
    { id: a.faction.cardId, kind: 'crew', face: 'primary' },
  ];
  a.rocket.glitch = true;
  autoFixGlitches(onSite);
  assert(onSite.players[0].rocket.glitch === false, 'Sirens on a site did not repair the disc');
  assert(onSite.players[0].rocket.stack.some((sl) => sl.kind === 'crew'),
    'repairing on a site cost the Sirens their lives');
  // The in-space half (the Sirens die, the disc lands) resolves inside the
  // Sunspot event's target pick, not in this sweep, so it is not assertable
  // from here - a glitch sitting on a crewed stack in space is not a state the
  // engine can reach. What IS assertable is that the sweep does not undo it:
  // once the crew is gone there is no Human aboard, so the disc stays.
  const dead = sirensGame(['siren']);
  const b = dead.players[0];
  b.rocket.siteId = 'burn-0hh45';           // a burn node - no site under them
  b.rocket.stack = [{ id: thruster.id, kind: 'patent', face: 'primary' }];   // crew already lost
  b.rocket.glitch = true;
  autoFixGlitches(dead);
  assert(dead.players[0].rocket.glitch === true,
    'the disc was swept off a crewless stack adrift in space');
  return 'repaired on a site with crew intact, kept in space with the crew gone';
});

// UPLIFT reads "Human at a promoted Bernal", and the checker only asked whether
// the player OWNED one somewhere - so the Future completed with the Bernal on
// the far side of the solar system (reported 2026-08-07: "there's no promoted
// bernal at the location").
check('UPLIFT needs the promoted Bernal where the Human is standing', () => {
  const UPLIFT_CARD = 'col_security_system';           // -> Frankenstein Navigator
  const goal = futureGoalForCard(UPLIFT_CARD);
  assert(goal && goal.name === 'UPLIFT FUTURE', `wrong goal for ${UPLIFT_CARD}`);
  const bernalId = BERNALS[0].id;
  const ctxFor = (bernalSite, atSiteId) => ({
    state: { robotsEmancipated: false },
    player: { aqua: 40, bernals: [{ cardId: bernalId, siteId: bernalSite, anchored: true, promoted: true }] },
    atSiteId,
  });
  const atBernal = checkFutureGoal(goal, ctxFor('ceres', 'ceres'));
  assert(atBernal.met, `standing at the Bernal did not satisfy UPLIFT: ${JSON.stringify(atBernal.items)}`);
  const elsewhere = checkFutureGoal(goal, ctxFor('ceres', 'vesta'));
  assert(!elsewhere.met, 'UPLIFT completed with the promoted Bernal at another site entirely');
  const item = (elsewhere.items || []).find((i) => i.id === 'at-bernal');
  assert(item && !item.met, `the failing item is not at-bernal: ${JSON.stringify(elsewhere.items)}`);
  // An UNPROMOTED Bernal at the right site is still not enough.
  const unpromoted = checkFutureGoal(goal, {
    state: { robotsEmancipated: false },
    player: { aqua: 40, bernals: [{ cardId: bernalId, siteId: 'ceres', anchored: true }] },
    atSiteId: 'ceres',
  });
  assert(!unpromoted.met, 'an unpromoted Bernal satisfied UPLIFT');
  // The checklist view (no attempt in scope) still reads, rather than showing a
  // permanent cross the player cannot explain.
  const listView = checkFutureGoal(goal, {
    state: { robotsEmancipated: false },
    player: { aqua: 40, bernals: [{ cardId: bernalId, siteId: 'ceres', anchored: true, promoted: true }] },
  });
  assert(listView.met, 'the mission checklist stopped showing UPLIFT as reachable');
  return 'bound to the attempt site, promoted still required, checklist unchanged';
});

// A size-10 Mars site is unreachable by thrust - nothing in the deck exceeds 6 -
// so an aerobrake descent is the ONLY way anyone lands there. That is legal, but
// the log said nothing about it, which made a legal landing indistinguishable
// from a ship arriving on impossible thrust (user 2026-08-07: "a player claims
// someone landed on mars even though they had insufficient thrust ... I can't
// tell from the logs whether they use aero or not").
// The parachute waives the thrust-to-land requirement only for a ship that came
// DOWN THE CORRIDOR. Mars Hellas Basin has two approaches - lag-5pmg4, an
// aerobrake, and burn-r1gov, a lander burn - and an atmospheric site used to
// waive the gate however you arrived, so the lander-burn side let a thrust-0
// ship onto a size-10 well. Thrust requirements always apply to lander burn
// nodes (user 2026-08-07).
check('only the aerobrake approach waives the landing thrust', () => {
  const MARS = 'mars-hellas-basin-buried-glaciers';
  const AERO = 'lag-5pmg4';        // the aerobrake corridor
  const ORBIT = 'lag-fp0u6';       // plain Lagrange between corridor and site
  const OUTSIDE = 'dec-6906q';     // one hop outside the corridor
  const PAD = 'burn-r1gov';        // the LANDER BURN on the other side
  const VIA_PAD = 'dec-f2qna';     // decorative between pad and site
  assert(nodeSizeNumber(MARS) === 10, `${MARS} is size ${nodeSizeNumber(MARS)}`);
  assert(isAerobrakeLandableSite(MARS), `${MARS} is not aerobrake-landable`);
  assert(isLanderBurnNode(PAD), `${PAD} is not a lander burn`);

  const fly = (segments, fromSite) => {
    const st = startedGame({ seats: 2 });
    st.activeIndex = 0;
    const me = st.players[0];
    me.aqua = 80;
    me.rocket.siteId = fromSite;
    me.rocket.stack = [{ id: thruster.id, kind: 'patent', face: 'primary' }];
    me.rocket.activeThrusterId = thruster.id;
    me.rocket.tank = 30;
    return applyOperation(st, { kind: 'MOVE', segments, hazardPay: true }, { profileId: me.profileId });
  };

  // DOWN THE CORRIDOR: allowed, and named a parachute.
  const chuted = fly([
    { from: OUTSIDE, to: AERO, burns: 1, turn: 1 },
    { from: AERO, to: ORBIT, burns: 0, turn: 1 },
    { from: ORBIT, to: MARS, burns: 0, turn: 1 },
  ], OUTSIDE);
  assert(chuted.ok, `the descent through the corridor was refused: ${chuted.error}`);
  assert(/Parachuted down/.test(chuted.log || ''),
    `the corridor descent was not called a parachute: ${chuted.log}`);

  // THROUGH THE LANDER BURN: refused. This is the one the report was about -
  // it is not an aerobrake and the thrust requirement stands. Flown from one
  // hop OUTSIDE the pad, so the pad is a node the route ARRIVES at rather than
  // merely departs from - otherwise the ordering rule below is never exercised.
  const BEFORE_PAD = 'lag-5bfh5';
  const viaPad = fly([
    { from: BEFORE_PAD, to: PAD, burns: 1, turn: 1 },
    { from: PAD, to: VIA_PAD, burns: 0, turn: 1 },
    { from: VIA_PAD, to: MARS, burns: 0, turn: 1 },
  ], BEFORE_PAD);
  assert(!viaPad.ok, 'a thrust-0 ship landed on size-10 Mars through the lander burn');
  assert(viaPad.error === 'cannot_land', `refused for the wrong reason: ${viaPad.error}`);

  // NOTE: the waiver also requires the corridor to come AFTER any lander burn on
  // the route (lastAeroIdx > lastLanderIdx). That ordering clause is defensive
  // and is NOT exercised here - a turn ends when it enters a site, so a single
  // move cannot fly a corridor, land, and then drop through a pad to somewhere
  // else. Left in rather than asserted falsely.

  // IN FROM THE PLAIN ORBIT, no corridor flown: also refused - the atmosphere
  // is not a waiver on its own.
  const noChute = fly([{ from: ORBIT, to: MARS, burns: 1, turn: 1 }], ORBIT);
  assert(!noChute.ok, 'an under-thrust landing with no corridor on the route was allowed');
  assert(noChute.error === 'cannot_land', `refused for the wrong reason: ${noChute.error}`);
  return 'corridor lands, lander burn and bare orbit do not';
});

// ...and the other side of the same gate: a landing the thrust CANNOT make is
// refused. The parachute check above only proved the waiver fires; it said
// nothing about what happens without one, which is the half that actually keeps
// a ship off a site it has no business on (user 2026-08-07: "did you test to
// make sure ... it rejects landing if they try to land with insufficient
// thrust?").
check('an under-thrust landing is refused', () => {
  // A lander-burn site that is NOT aerobrake-landable, so thrust is the only
  // way down and there is no parachute to muddy the result.
  const HARD = 'mercury-north-pole';
  assert(nodeSizeNumber(HARD) === 10, `${HARD} is size ${nodeSizeNumber(HARD)}`);
  assert(isLanderBurnNode !== undefined, 'planner helpers missing');
  assert(!isAerobrakeLandableSite(HARD), `${HARD} is aerobrake-landable, so this proves nothing`);
  const PLAIN = 'psyche';                        // no lander burn, no aerobrake
  assert(nodeSizeNumber(PLAIN) === 5, `${PLAIN} is size ${nodeSizeNumber(PLAIN)}`);

  const land = (dest, thr, { factory = false } = {}) => {
    const st = startedGame({ seats: 2 });
    st.activeIndex = 0;
    const me = st.players[0];
    me.aqua = 80;
    const from = neighborSlugs(dest)[0];
    assert(from, `${dest} has no neighbour to fly in from`);
    me.rocket.siteId = from;
    me.rocket.stack = [{ id: thr.id, kind: 'patent', face: 'primary' }];
    me.rocket.activeThrusterId = thr.id;
    me.rocket.tank = 30;
    if (factory) st.factories[dest] = { ownerId: me.profileId, spectralType: 'C' };
    return applyOperation(st, {
      kind: 'MOVE', segments: [{ from, to: dest, burns: 1, turn: 1 }], hazardPay: true,
    }, { profileId: me.profileId });
  };
  // The strongest patent in the deck still cannot make a size-10 well.
  const best = PATENTS.filter((c) => c.type === 'thruster')
    .sort((a, b) => ((b.faces?.primary?.thrust ?? b.thrust ?? 0) - (a.faces?.primary?.thrust ?? a.thrust ?? 0)))[0];
  const bestThrust = best.faces?.primary?.thrust ?? best.thrust;
  assert(bestThrust < 10, `the best patent thruster is ${bestThrust}, which clears size 10`);
  const hard = land(HARD, best);
  assert(!hard.ok, `a thrust-${bestThrust} ship landed on the size-10 ${HARD}`);
  assert(hard.error === 'cannot_land', `refused for the wrong reason: ${hard.error}`);
  // A FACTORY does not rescue it either: assist cannot carry a lander burn.
  const assisted = land(HARD, best, { factory: true });
  assert(!assisted.ok, `a factory assist carried a landing through a lander burn at ${HARD}`);
  assert(assisted.error === 'cannot_land', `refused for the wrong reason: ${assisted.error}`);

  // On a PLAIN site the same under-thrust landing is refused with no factory...
  const weak = PATENTS.filter((c) => c.type === 'thruster')
    .find((c) => (c.faces?.primary?.thrust ?? c.thrust ?? 99) > 0
      && (c.faces?.primary?.thrust ?? c.thrust) < nodeSizeNumber(PLAIN));
  assert(weak, `no thruster weaker than size ${nodeSizeNumber(PLAIN)} to test with`);
  const bare = land(PLAIN, weak);
  assert(!bare.ok && bare.error === 'cannot_land',
    `an under-thrust landing on ${PLAIN} was allowed: ${bare.ok ? 'accepted' : bare.error}`);
  // ...and ALLOWED once a factory is there to assist, which is the rule that
  // makes the refusal above meaningful rather than a blanket ban.
  const helped = land(PLAIN, weak, { factory: true });
  assert(helped.ok, `a factory assist did not carry the landing at ${PLAIN}: ${helped.error}`);
  return 'refused on thrust, refused through a lander burn even with a factory, allowed on a plain assist';
});

// An outpost stores its water CANNED, never loose (user 2026-08-07). The case
// that prompted it: an outpost holding water beside an ISOTOPE ship, where
// pouring the water into the tank is refused for mixing grades, so the only way
// to carry it was to dump the isotope first - destroying the fractional
// remainder that cannot be canned. As cargo the water just rides along.
check('an outpost cans its water instead of pooling it loose', () => {
  const SITE = 'ceres';
  const setup = () => {
    const st = startedGame({ seats: 2 });
    st.activeIndex = 0;
    const me = st.players[0];
    me.rocket.siteId = SITE;
    me.rocket.tank = 6;
    me.rocket.tankGrade = 'water';
    me.outposts = { A: { letter: 'A', siteId: SITE, cards: [], tank: 0 } };
    return { st, me };
  };
  const cansIn = (o) => (o.cards || []).filter((c) => c && c.kind === 'fuel' && c.grade !== 'isotope');

  // Storing water at the outpost cans it: a card appears, the loose pool does not.
  const { st, me } = setup();
  const r = applyOperation(st, {
    kind: 'TRANSFER_FUEL', letter: 'A', amount: 4, direction: 'toOutpost',
  }, { profileId: me.profileId });
  assert(r.ok, `TRANSFER_FUEL to the outpost was refused: ${r.error}`);
  const out = r.state.players[0].outposts.A;
  const cans = cansIn(out);
  assert(cans.length === 1, `expected one water can at the outpost, found ${cans.length}`);
  assert(cans[0].amount === 4, `the can holds ${cans[0].amount} water, expected 4`);
  assert((Number(out.tank) || 0) < 1,
    `${out.tank} water was left pooled loose at the outpost instead of canned`);

  // Pumping it back out empties the can rather than leaving an empty one behind.
  const back = applyOperation(r.state, {
    kind: 'TRANSFER_FUEL', letter: 'A', amount: 4,
  }, { profileId: me.profileId });
  assert(back.ok, `pumping the outpost's water back was refused: ${back.error}`);
  const drained = back.state.players[0].outposts.A;
  assert(cansIn(drained).length === 0, 'an empty water can was left at the outpost');
  assert(Math.round(back.state.players[0].rocket.tank) === 6,
    `the rocket got ${back.state.players[0].rocket.tank} water back, expected 6`);
  return 'stored water becomes a can, pumping it out removes the can';
});

check('an isotope ship can carry an outpost water can it cannot pour', () => {
  const SITE = 'ceres';
  // An isotope tank with a FRACTIONAL remainder - the thing the old route
  // destroyed, because emptying the tank was the only way to take the water.
  const setup = () => {
    const st = startedGame({ seats: 2 });
    st.activeIndex = 0;
    const me = st.players[0];
    me.rocket.siteId = SITE;
    me.rocket.tank = 3.5;
    me.rocket.tankGrade = 'isotope';
    me.rocket.tankSpectral = 'C';
    me.outposts = { A: { letter: 'A', siteId: SITE, cards: [], tank: 5 } };
    return { st, me };
  };

  // Pouring the outpost's water into the isotope tank is still refused - that
  // is the rule this works AROUND, not one it relaxes. If this ever starts
  // succeeding the check below stops proving anything.
  const { st: st1, me: me1 } = setup();
  const poured = applyOperation(st1, {
    kind: 'TRANSFER_FUEL', letter: 'A', amount: 5,
  }, { profileId: me1.profileId });
  assert(!poured.ok && poured.error === 'cannot_mix_fuel',
    `water poured into an isotope tank: ${poured.ok ? 'accepted' : poured.error}`);

  // Carrying the can as cargo works, and leaves the isotope tank alone.
  const { st: st2, me: me2 } = setup();
  const seen = applyOperation(st2, { kind: 'END_TURN' }, { profileId: me2.profileId });
  assert(seen.ok, `END_TURN refused: ${seen.error}`);
  // The legacy loose water folded into a can on that op; find it.
  const can = (seen.state.players[0].outposts.A.cards || [])
    .find((c) => c && c.kind === 'fuel' && c.grade !== 'isotope');
  assert(can, 'the outpost\'s loose water was never folded into a can');
  assert(can.amount === 5, `the folded can holds ${can.amount} water, expected 5`);

  const st3 = seen.state;
  st3.activeIndex = 0;
  const moved = applyOperation(st3, {
    kind: 'TRANSFER', from: 'outpostA', to: 'rocket', cardIds: [can.id],
  }, { profileId: me2.profileId });
  assert(moved.ok, `the water can would not load onto the isotope ship: ${moved.error}`);
  const rk = moved.state.players[0].rocket;
  const aboard = (rk.stack || []).find((s) => s && s.kind === 'fuel' && s.id === can.id);
  assert(aboard && aboard.amount === 5, 'the water can did not arrive aboard intact');
  assert(Math.abs(rk.tank - 3.5) < 1e-6,
    `the isotope tank changed to ${rk.tank}; the fractional remainder should be untouched`);
  assert(rk.tankGrade === 'isotope', `the tank grade became ${rk.tankGrade}`);
  return 'pouring still refused, carrying works, the 3.5 isotope remainder survives';
});

check('canning water at an outpost never creates or destroys any', () => {
  const SITE = 'ceres';
  const st = startedGame({ seats: 2 });
  st.activeIndex = 0;
  const me = st.players[0];
  me.rocket.siteId = SITE;
  me.rocket.tank = 0;
  me.outposts = { A: { letter: 'A', siteId: SITE, cards: [], tank: 0 } };
  const stored = applyOperation(st, {
    kind: 'TRANSFER_FUEL', letter: 'A', amount: 0, direction: 'toOutpost',
  }, { profileId: me.profileId });
  // Zero is rejected; go through the rocket properly instead.
  assert(!stored.ok, 'a zero-water transfer was accepted');

  me.rocket.tank = 7;
  me.rocket.tankGrade = 'water';
  const r1 = applyOperation(st, {
    kind: 'TRANSFER_FUEL', letter: 'A', amount: 7, direction: 'toOutpost',
  }, { profileId: me.profileId });
  assert(r1.ok, `storing water was refused: ${r1.error}`);
  const o1 = r1.state.players[0].outposts.A;
  const can = (o1.cards || []).find((c) => c && c.kind === 'fuel');
  assert(can && can.amount === 7, `the outpost holds ${can && can.amount}, expected 7`);

  // Pouring a can into the outpost that already HOLDS it is the identity. It
  // used to read the tank before pulling the card out, so for an outpost - whose
  // tank IS its cans - the water doubled on the way through.
  const r2 = applyOperation(r1.state, {
    kind: 'LOAD_FUEL', cardId: can.id, holder: 'outpostA',
  }, { profileId: me.profileId });
  assert(r2.ok, `pouring a can into its own outpost was refused: ${r2.error}`);
  const o2 = r2.state.players[0].outposts.A;
  const total = (o2.cards || []).reduce((n, c) => n + (c && c.kind === 'fuel' ? (c.amount | 0) : 0), 0)
    + (Number(o2.tank) || 0);
  assert(Math.abs(total - 7) < 1e-6, `7 water became ${total} on a round trip through the tank`);
  return 'stored 7, round-tripped through LOAD_FUEL, still 7';
});

// A Bernal is the only unit besides the rocket that spends FUEL to move, and
// its log line named only the destination - so a station crawling into a burn
// space showed up in the record with no burn, no fuel and no origin behind it.
// Reported 2026-08-07 as a Bernal with no thrust entering burn space, which is
// precisely the move the log depicted.
check('a Bernal crawl says what it cost', () => {
  const HOME_ORBIT = 'burn-ue3lc';   // a burn node beside LEO, a Bernal home orbit
  const GEN = 'gen_cascade_photovoltaic';   // supplies gen-electric, requires nothing
  const build = (tank) => {
    const st = startedGame({ seats: 1, m0: true, m1: true, m2: true });
    st.activeIndex = 0;
    const p = st.players[0];
    p.bernals = [{
      cardId: 'ber_l5s_cancer_hospital', figure: 'kalpana', face: 'primary', promoted: false,
      siteId: null, stack: [{ id: GEN, kind: 'patent', face: 'primary' }],
      tank, wiring: {}, route: [], activeThrusterId: null, activeProspectorId: null,
      movesRemaining: 1,
    }];
    return applyOperation(st, { kind: 'MOVE', unit: 'bernal0', toSiteId: HOME_ORBIT }, { profileId: p.profileId });
  };

  // An unpowered Bernal cannot crawl at all - the rule that makes the fuelled
  // case below a real move rather than a free drift.
  const st0 = startedGame({ seats: 1, m0: true, m1: true, m2: true });
  st0.activeIndex = 0;
  st0.players[0].bernals = [{
    cardId: 'ber_l5s_cancer_hospital', figure: 'kalpana', face: 'primary', promoted: false,
    siteId: null, stack: [], tank: 9, wiring: {}, route: [],
    activeThrusterId: null, activeProspectorId: null, movesRemaining: 1,
  }];
  const unpowered = applyOperation(st0, { kind: 'MOVE', unit: 'bernal0', toSiteId: HOME_ORBIT },
    { profileId: st0.players[0].profileId });
  assert(!unpowered.ok && unpowered.error === 'bernal_unsupported',
    `an unpowered Bernal crawled anyway: ${unpowered.ok ? 'accepted' : unpowered.error}`);

  // ...and it has to be able to afford the burn.
  const broke = build(1);
  assert(!broke.ok && broke.error === 'insufficient_water',
    `a Bernal crawled on 1 water: ${broke.ok ? 'accepted' : broke.error}`);

  // The move that DOES go through has to say what it spent, or the record shows
  // a station entering a burn space for free.
  const ok = build(3);
  assert(ok.ok, `the fuelled crawl was refused: ${ok.error}`);
  const log = String(ok.log || '');
  assert(/\bfuel step/.test(log), `the crawl log never mentions fuel: "${log}"`);
  assert(/\bburn/.test(log), `the crawl log never mentions the burn: "${log}"`);
  assert(/\bLEO\b/.test(log), `the crawl log never says where it came from: "${log}"`);
  assert(/3 fuel steps/.test(log), `the crawl log states the wrong cost: "${log}"`);
  assert(ok.state.players[0].bernals[0].tank === 0,
    `the crawl did not actually spend the fuel it reported (tank ${ok.state.players[0].bernals[0].tank})`);
  return 'unpowered refused, unfuelled refused, and the paid crawl reports 1 burn / 3 fuel steps';
});

// Net thrust is a Bernal's per-turn burn budget, exactly as it is for the
// Freighter. The server had no such number - it checked only that the colony
// card CARRIED a thrust value - so the weight-class band and the support chain
// were invisible to it and a station the client correctly drew at NET THRUST 0
// still crawled (reported 2026-08-07 with a screenshot of the 0 triangle).
check('a Bernal with no net thrust cannot crawl', () => {
  const HOME_ORBIT = 'burn-ue3lc';
  const mk = (stack) => {
    const st = startedGame({ seats: 1, m0: true, m1: true, m2: true });
    st.activeIndex = 0;
    st.players[0].bernals = [{
      cardId: 'ber_l5s_cancer_hospital', figure: 'kalpana', face: 'primary', promoted: false,
      siteId: null, stack, tank: 3, wiring: {}, route: [],
      activeThrusterId: null, activeProspectorId: null, movesRemaining: 1,
    }];
    return st;
  };
  const move = (st, extra = {}) => applyOperation(st,
    { kind: 'MOVE', unit: 'bernal0', toSiteId: HOME_ORBIT, ...extra },
    { profileId: st.players[0].profileId });

  // The reported stack: base 3, a Lyman Alpha Trap at -2, a -1 TRANSPORT band.
  const REPORTED = [
    { id: 'gen_rankine_mhd', kind: 'patent', face: 'primary' },
    { id: 'rea_lyman_alpha_trap', kind: 'patent', face: 'primary' },
    { id: 'rad_microtube_array', kind: 'patent', face: 'primary', radSide: 'light' },
  ];
  const dead = move(mk(REPORTED));
  assert(!dead.ok && dead.error === 'bernal_over_thrust',
    `a net-thrust-0 Bernal crawled anyway: ${dead.ok ? 'accepted' : dead.error}`);
  assert(dead.detail && dead.detail.thrust === 0,
    `refused, but reporting thrust ${dead.detail && dead.detail.thrust} rather than 0`);

  // A Bernal that DOES have thrust still crawls - the refusal above has to be
  // about the number, not a blanket ban on crawling.
  const live = move(mk([{ id: 'gen_cascade_photovoltaic', kind: 'patent', face: 'primary' }]));
  assert(live.ok, `an ordinary powered Bernal was refused: ${live.error}`);

  // A move made before this rule existed must still REPLAY, or every undo left
  // in that turn dies rebuilding it.
  const replayed = move(mk(REPORTED), { _replay: true });
  assert(replayed.ok, `a legacy 0-thrust crawl no longer reconstructs: ${replayed.error}`);
  return 'thrust 0 refused, thrust 2 crawls, and a legacy crawl still replays';
});

// An undo that cannot rebuild has to say WHICH action refused and why. It used
// to return a bare undo_replay_failed with nothing behind it, which is a dead
// end for the player and for anyone diagnosing it (user 2026-08-07).
check('a failed undo names the action that refused', () => {
  const st = startedGame({ seats: 2 });
  st.activeIndex = 0;
  const me = st.players[0];
  // A turn whose recorded action cannot possibly replay: the base state the
  // rebuild starts from has no such op kind at all.
  st.turnActions = [
    { kind: 'NOT_A_REAL_OP', payload: {}, rolled: false },
    { kind: 'END_TURN', payload: {}, rolled: false },
  ];
  const r = applyOperation(st, { kind: 'UNDO' }, { profileId: me.profileId, turnBaseState: st });
  assert(!r.ok && r.error === 'undo_replay_failed', `expected undo_replay_failed, got ${r.error || 'ok'}`);
  assert(r.detail, 'the failure carried no detail at all');
  assert(r.detail.kind === 'NOT_A_REAL_OP', `detail named ${r.detail.kind}, not the offending op`);
  assert(r.detail.error, 'the detail says which op failed but not why');
  assert(r.detail.at === 0 && r.detail.of === 1,
    `detail placed it at ${r.detail.at}/${r.detail.of}, expected 0/1`);
  return `names the op, its position, and the reason (${r.detail.error})`;
});

// The Hermes mission scales with the table (user 2026-08-07): 1 seat waives
// prospecting the bare halves, 2 seats do not (so an ISRU-0 robonaut is the
// requirement), and 3 seats add Comet Neujmin 1 on the same industrialize terms.
check('the Hermes mission scales with the seat count', () => {
  assert(hermesTargetSites(1).length === 2, `solo owes ${hermesTargetSites(1).length} sites, expected 2`);
  assert(hermesTargetSites(2).length === 2, `two seats owe ${hermesTargetSites(2).length} sites, expected 2`);
  assert(hermesTargetSites(3).length === 3, `three seats owe ${hermesTargetSites(3).length} sites, expected 3`);
  assert(hermesTargetSites(3).includes(NEUJMIN_SITE), 'three seats do not owe Neujmin');
  assert(!hermesTargetSites(2).includes(NEUJMIN_SITE), 'two seats were handed Neujmin');
  // The prospect waiver is SOLO only.
  assert(hermesProspectWaived(1), 'solo lost its prospect waiver, so the bare halves are unclaimable');
  assert(!hermesProspectWaived(2), 'two seats kept the waiver');
  assert(!hermesProspectWaived(3), 'three seats kept the waiver');
  // Industrializing Neujmin costs a dirt rocket like the halves, but only when
  // it is actually part of the mission.
  assert(isHermesTargetSite(NEUJMIN_SITE, 3), 'Neujmin is not a mission site at three seats');
  assert(!isHermesTargetSite(NEUJMIN_SITE, 2), 'Neujmin counted as a mission site at two seats');
  assert(isHermesTargetSite('hermes-a', 1) && isHermesTargetSite('hermes-b', 1), 'a half stopped being a mission site');
  // Victory needs the WHOLE set: two halves must not win a three-seat table.
  const halves = { 'hermes-a': { ownerId: 1 }, 'hermes-b': { ownerId: 2 } };
  assert(hermesSitesIndustrialized(halves, null, 2).length === 2, 'two seats did not win on both halves');
  assert(hermesSitesIndustrialized(halves, null, 3).length === 2,
    'a three-seat table counted its mission complete on the halves alone');
  const all = { ...halves, [NEUJMIN_SITE]: { ownerId: 3 } };
  assert(hermesSitesIndustrialized(all, null, 3).length === 3, 'three seats could not complete the full set');
  assert(HERMES_MAX_PLAYERS === 3, `the seat cap is ${HERMES_MAX_PLAYERS}, expected 3`);
  return 'solo/2 owe the halves, 3 owes Neujmin too, and the waiver is solo-only';
});

// An ISRU-0 prospector has to EXIST, or the two-seat mission is unwinnable by
// construction: the halves are hydration 0 and the waiver is gone.
check('an ISRU-0 prospector exists for the two-seat Hermes mission', () => {
  const zero = [];
  for (const c of PATENTS) {
    if (c.type !== 'robonaut') continue;
    for (const k of ['primary', 'secondary']) {
      const f = c.faces && c.faces[k];
      const p = f && (f.properties || []).find((x) => x && x.key === 'isru');
      if (p && (Number(p.value) | 0) === 0) zero.push(`${c.id}:${k}`);
    }
  }
  assert(zero.length > 0, 'no robonaut face carries ISRU 0, so a 2-seat Hermes table can never claim a half');
  return `${zero.length} ISRU-0 faces (${zero[0]}...)`;
});

// The ENGINE half of the scaling rule: solo waives the prospect gate at the bare
// halves, a two-seat table does not. Drives applyOperation, not just the pure
// helpers, because the waiver read is what a player actually hits.
check('a two-seat Hermes table loses the prospect waiver at the halves', () => {
  // A prospector whose ISRU is ABOVE 0 - fine solo, refused at two seats.
  let rig = null;
  for (const c of PATENTS) {
    if (c.type !== 'robonaut') continue;
    for (const k of ['primary', 'secondary']) {
      const f = c.faces && c.faces[k];
      const p = f && (f.properties || []).find((x) => x && x.key === 'isru');
      const kind = f && (f.properties || []).find((x) => x && ['raygun', 'missile', 'buggy'].includes(x.key) && x.value);
      if (p && (Number(p.value) | 0) > 0 && kind && !rig) rig = { id: c.id, face: k, isru: Number(p.value) | 0 };
    }
  }
  assert(rig, 'no ISRU>0 prospector to test with');

  const build = (seats) => {
    const roster = Array.from({ length: seats }, (_, i) => ({ profileId: i + 1, name: `P${i + 1}`, seat: i + 1 }));
    let st = createInitialState({ players: roster, seed: 'check-engine', maxRounds: 2, hermes: true });
    for (const p of [...st.players]) {
      const card = CREW.find((c) => c.color === p.color) || CREW[0];
      st = applyOperation(st, { kind: 'PICK_CREW', cardId: card.id, face: 'primary' }, { profileId: p.profileId }).state;
    }
    st.activeIndex = 0;
    const me = st.players[0];
    me.rocket.siteId = 'hermes-a';
    me.rocket.stack = [{ id: rig.id, kind: 'patent', face: rig.face }];
    me.rocket.activeProspectorId = rig.id;
    me.opsRemaining = Math.max(1, me.opsRemaining | 0);
    return applyOperation(st, { kind: 'PROSPECT', siteId: 'hermes-a', turn: st.turn, round: st.round },
      { profileId: me.profileId });
  };

  const solo = build(1);
  assert(solo.ok, `solo could not prospect a half with an ISRU-${rig.isru} rig: ${solo.error}`);
  const duo = build(2);
  assert(!duo.ok, `a two-seat table prospected a hydration-0 half with an ISRU-${rig.isru} rig`);
  assert(duo.error === 'isru_too_high', `refused for the wrong reason: ${duo.error}`);
  return `solo waives it, two seats refuse an ISRU-${rig.isru} rig with isru_too_high`;
});

// A unit's belt roll reads the WEAKEST card aboard, not its hull. A Bernal built
// on a rad-hard-8 colony skipped the roll entirely - a d6 cannot beat 8 - so a
// heavy Microtube Array (rad-hard 0) rode through a belt untouched (reported
// 2026-08-07, game 566, crossing rad-zkdhz in blue season).
check('a Bernal belt roll costs cards, and reads its weakest one', () => {
  const BELT = 'rad-rttd0';
  const build = (stack) => {
    let st = createInitialState({ players: [{ profileId: 1, name: 'P1', seat: 1 }],
      seed: 'check-engine', maxRounds: 5, m0: true, m1: true, m2: true });
    for (const p of [...st.players]) {
      const c = CREW.find((x) => x.color === p.color) || CREW[0];
      st = applyOperation(st, { kind: 'PICK_CREW', cardId: c.id, face: 'primary' }, { profileId: p.profileId }).state;
    }
    st.activeIndex = 0;
    st.players[0].bernals = [{
      cardId: 'ber_l5s_cancer_hospital', figure: 'kalpana', face: 'primary', promoted: false,
      siteId: null, stack, tank: 9, wiring: {}, route: [],
      activeThrusterId: null, activeProspectorId: null, movesRemaining: 1,
    }];
    return applyOperation(st, { kind: 'MOVE', unit: 'bernal0',
      segments: [{ from: 'lag-leo', to: BELT, burns: 1 }] }, { profileId: 1 });
  };
  const gen = { id: 'gen_cascade_photovoltaic', kind: 'patent', face: 'primary' };
  // A HEAVY radiator is rad-hard 0 (its light side is 1, and the face-level
  // number is the light one - so this also pins the deployed-side read).
  const heavyRad = { id: 'rad_microtube_array', kind: 'patent', face: 'primary', radSide: 'heavy' };

  const risky = build([gen, heavyRad]);
  assert(risky.ok, `the crawl was refused: ${risky.error}`);
  const bn = risky.state.players[0].bernals[0];
  const rolls = (bn.rolls || []).filter((r) => r.kind === 'rad');
  assert(rolls.length === 1, `expected one belt roll, got ${rolls.length}`);
  assert(!rolls[0].bypassed, 'the belt roll was skipped with a rad-hard-0 card aboard');
  // The rocket's model, not the freighter's: severity is d6 minus net thrust,
  // and it costs CARDS rather than glitching the unit (user 2026-08-07).
  assert(rolls[0].rad != null && rolls[0].thrust != null,
    `the roll recorded no severity/thrust: ${JSON.stringify(rolls[0])}`);
  assert(!bn.glitched, 'a failed belt roll glitched the Bernal; glitches are the freighter rule');
  const stillAboard = (bn.stack || []).map((x) => x.id);
  assert(!stillAboard.includes('gen_cascade_photovoltaic'),
    'a rad-hard-1 card survived a severity-5 belt untouched');
  const rad2 = (bn.stack || []).find((x) => x.id === 'rad_microtube_array');
  assert(rad2 && rad2.radSide === 'light',
    'the heavy radiator was not degraded to its light side');

  // A stack carrying nothing weak still skips the roll - the bypass is right, it
  // was only reading the wrong number. (rad-hard 10, above any d6.)
  const hardGen = { id: 'gen_brayton_turbine', kind: 'patent', face: 'secondary' };
  const safe = build([hardGen]);
  assert(safe.ok, `the clean crawl was refused: ${safe.error}`);
  const safeRolls = (safe.state.players[0].bernals[0].rolls || []).filter((r) => r.kind === 'rad');
  assert(safeRolls.every((r) => r.bypassed) || !safeRolls.length,
    'a stack with nothing at risk still spent a die');
  return 'the belt rolls, costs the soft card, degrades the radiator, and never glitches';
});

// Acetylene Rocketplane Liftoff: "expending a special water cost using FTs at
// the Site ... then continue movement, treating the first lander burn as free"
// (reference/manuals/branch-shared-core.md). The first burn was still charged to
// the ship's own tank, so an EMPTY tank could never lift off - which is the
// whole point of fuelling the boosters from the atmosphere (reported 2026-08-07).
check('an acetylene liftoff pays for its first lander burn', () => {
  const SITE = 'titan-ontario-lacus';       // atmospheric, behind a lander burn
  const PAD = 'burn-8y72w';
  const UP = 'lag-u3g7x';
  const thr = PATENTS.find((c) => c.type === 'thruster' && (c.faces?.primary?.thrust ?? 0) > 0);
  const build = (siteWater) => {
    let st = createInitialState({ players: [{ profileId: 1, name: 'P1', seat: 1 }],
      seed: 'check-engine', maxRounds: 5, m0: true, m1: true, m2: true });
    for (const p of [...st.players]) {
      const c = CREW.find((x) => x.color === p.color) || CREW[0];
      st = applyOperation(st, { kind: 'PICK_CREW', cardId: c.id, face: 'primary' }, { profileId: p.profileId }).state;
    }
    st.activeIndex = 0;
    const me = st.players[0];
    me.rocket.siteId = SITE;
    me.rocket.tank = 0;                     // EMPTY - the reported case
    me.rocket.stack = [{ id: thr.id, kind: 'patent', face: 'primary' }];
    me.rocket.activeThrusterId = thr.id;
    me.opsRemaining = 4;
    st.factories = { [SITE]: { ownerId: me.profileId, spectralType: 'C' } };
    me.outposts = { A: { letter: 'A', siteId: SITE, cards: [], tank: siteWater } };
    return st;
  };
  const fly = (st, acet) => applyOperation(st, { kind: 'MOVE', ...(acet ? { acetyleneLiftoff: true } : {}),
    segments: [{ from: SITE, to: PAD, burns: 1 }, { from: PAD, to: UP, burns: 0 }] }, { profileId: 1 });

  const ok = fly(build(40), true);
  assert(ok.ok, `an acetylene liftoff on an empty tank was refused: ${ok.error} ${JSON.stringify(ok.detail || {})}`);
  assert(/first lander burn free/.test(ok.log || ''), `the log never says the burn was free: ${ok.log}`);
  assert(/water burned from the site/.test(ok.log || ''), `the log never says the site paid: ${ok.log}`);

  // The site's water is what buys it, so without enough stored there it fails -
  // and NOT with a fuel error, which would send the player to the wrong tank.
  const dry = fly(build(1), true);
  assert(!dry.ok && dry.error === 'insufficient_site_water',
    `a siteless liftoff was ${dry.ok ? 'accepted' : 'refused as ' + dry.error}`);

  // And the free burn is acetylene's, not a general discount: the same route
  // without it still cannot go on an empty tank.
  const plain = fly(build(40), false);
  assert(!plain.ok, 'an empty tank lifted off with no acetylene at all');
  return 'empty tank lifts off on site water; no site water and no acetylene both refuse';
});

check('a normal game carries no variant state', () => {
  const st = startedGame();
  for (const key of ['sirens', 'hermes', 'hermesVerdict', 'hotSeat', 'tutorial', 'sirenDecks',
    'sirenColonistQueue', 'quickStart']) {
    assert(st[key] === undefined, `${key} leaked into a normal game`);
  }
  assert(Object.keys(st.discs || {}).length === 0, 'a normal board opened with claim discs');
  return 'clean';
});

if (failures) {
  console.error(`\nengine smoke FAILED (${failures})`);
  process.exit(1);
}
console.log('\nengine smoke passed');
