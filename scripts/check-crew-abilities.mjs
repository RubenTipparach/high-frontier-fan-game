// Crew faction privilege audit: EXECUTE every implemented faction ability
// through the real engine (createInitialState + applyOperation) and prove it
// fires for the player who holds it, and ONLY for that player.
//
// Companion to scripts/check-engine.mjs (the CI engine smoke gate). That file
// already covers several promo abilities in depth; this one is the
// per-faction audit behind docs/crew-ability-audit.md. Every check below
// compares a holder against a control (the same seat on the OTHER face of the
// same physical card, or another seat), and the disabled conditions:
//   - Anarchy (K2e): every faction privilege is suspended,
//   - Module 2 (2B3b): faction privileges are LOCKED until the player has an
//     anchored Home Bernal,
//   - solo vs multiplayer, and the faction bank (C5) solitaire payout.
//
// Some checks are EXPECTED to fail: they pin down a bug the audit found and
// are tagged `bug(...)`. They print as KNOWN BUG and do not fail the run, so the
// script stays green until someone fixes the engine - at which point the check
// prints FIXED and should be promoted to a plain check. Run with --strict to
// make known bugs fail the run too.
//
// Run: node scripts/check-crew-abilities.mjs [--strict]
// (Needs the vendored map: git submodule update --init vendor/hf-mission-planner)

import { createInitialState } from '../server/game/state.js';
import { applyOperation, autoFixGlitches, resolveSunspotEvent } from '../server/game/engine.js';
import { CREW, CREW_BY_ID, PROMO_CREW } from '../data/crew.js';
import { PATENTS, PATENTS_BY_ID } from '../data/patents.js';
import { COLONISTS_BY_ID } from '../data/colonists.js';
import { lineOfSightSites, leoSlug, neighborSlugs, siteBySlug } from '../server/game/planner-graph.js';
import { FACTION_BANK_AQUA } from '../data/altruism.js';

const STRICT = process.argv.includes('--strict');
let failures = 0;
let knownBugs = 0;
let fixed = 0;
const results = [];

function check(label, fn) {
  try {
    const detail = fn();
    results.push({ label, status: 'ok' });
    console.log(`  ok    ${label}${detail ? '  (' + detail + ')' : ''}`);
  } catch (err) {
    failures++;
    results.push({ label, status: 'FAIL', msg: err && err.message });
    console.error(`  FAIL  ${label}\n        ${err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n        ') : err}`);
  }
}
// A check that pins down a bug the audit found. It asserts the CORRECT
// behaviour, so it fails today; that failure is expected and reported, not
// counted, unless --strict.
function bug(id, label, fn) {
  try {
    const detail = fn();
    fixed++;
    console.log(`  FIXED [${id}] ${label}${detail ? '  (' + detail + ')' : ''}  <- promote to a plain check`);
  } catch (err) {
    knownBugs++;
    if (STRICT) failures++;
    console.log(`  KNOWN BUG [${id}] ${label}\n        ${err && err.message}`);
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const eq = (a, b, msg) => assert(a === b, `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// ---------------------------------------------------------------- fixtures

const pkey = (bonus) => String(bonus || '').trim().toUpperCase().replace(/\s+/g, '_');
const cardOf = (cardId) => CREW_BY_ID[cardId];
const colorOf = (cardId) => cardOf(cardId).color;

// A game with `seats` players and the crew draft still open (phase 'crew').
function freshGame(seats = 2, opts = {}) {
  const roster = Array.from({ length: seats }, (_, i) => ({ profileId: i + 1, name: `P${i + 1}`, seat: i + 1 }));
  const st = createInitialState({ players: roster, seed: opts.seed || 'crew-audit', maxRounds: 5, ...opts });
  // Seat i takes the colour of CREW[i] (seat 0 = UN/B612, seat 1 = Roscosmos /
  // Taikonauts, ...), so a check can name which seat sits on which card. The
  // engine only ever compares a pick's card colour against the seat colour.
  st.players.forEach((p, i) => { p.color = CREW[i % CREW.length].color; });
  return st;
}

// Close the crew draft with real PICK_CREW ops. `picks` maps a card id to the
// face a seat should take; every other seat takes the primary face of the card
// matching its seat colour. A 1-seat table may pick any card. Returns the
// post-draft state and the seat (index) that took each requested card.
function draft(st, picks = {}) {
  const want = Object.entries(picks);
  for (const p of st.players) {
    let cardId = null; let face = 'primary';
    if (st.players.length === 1 && want.length) [cardId, face] = want[0];
    else {
      const card = CREW.find((c) => c.color === p.color);
      cardId = card.id;
      if (picks[cardId]) face = picks[cardId];
    }
    const r = applyOperation(st, { kind: 'PICK_CREW', cardId, face }, { profileId: p.profileId });
    assert(r.ok, `PICK_CREW ${cardId}/${face} refused: ${r.error}`);
    st = r.state;
  }
  return st;
}
const seatWith = (st, cardId) => st.players.findIndex((p) => p.faction && p.faction.cardId === cardId);

// A started game (draft closed, play phase) where seat `idx` is then handed
// the given faction face directly - the same shape the existing engine smoke
// uses for promo crew. The privilege is read off player.faction on every op,
// so this is exactly what a real pick produces once play is open.
function playing(seats = 2, opts = {}) {
  const st = draft(freshGame(seats, opts));
  st.activeIndex = 0;
  for (const p of st.players) { p.opsRemaining = 4; }
  st.turnActions = [];
  return st;
}
function give(st, idx, cardId, face) {
  st.players[idx].faction = { cardId, face };
  return st.players[idx];
}
// Give seat idx the privilege, and every other seat the OTHER face of a
// different card so nobody else accidentally holds it.
function only(st, idx, cardId, face) {
  const others = CREW.filter((c) => c.id !== cardId);
  st.players.forEach((p, i) => {
    if (i === idx) give(st, i, cardId, face);
    else give(st, i, others[i % others.length].id, 'primary');
  });
  return st.players[idx];
}
const op = (st, idx, body, ctx = {}) => applyOperation(st, body, { profileId: st.players[idx].profileId, ...ctx });
// The M2 lock lifts once a Home Bernal is anchored; this is the minimal record
// the engine's isHomeBernal reads (anchored + home).
function anchorHome(player) {
  player.bernals = [{ cardId: 'ber_tourism_cycler', anchored: true, home: true, siteId: leoSlug(), face: 'primary', stack: [] }];
}
function clone(x) { return JSON.parse(JSON.stringify(x)); }

const RAY = 'rob_free_electron_laser';          // raygun, ISRU 1
const SOLAR_PUSH = 'thr_re_solar_moth';          // push-icon thruster, no supports
const buggy = PATENTS.find((c) => c.type === 'robonaut'
  && (c.faces.primary.properties || []).some((p) => p.key === 'prospector' && /buggy/i.test(String(p.value))));

console.log('crew faction privileges:');

// ================================================================ core six cards

// ---- SECRETARY GENERAL (UN Cosmonauts) ----
// "Start with +2 Aqua. (Module 2: after 1st anchor of your Home Bernal.)"
check('SECRETARY GENERAL: +2 aqua when the draft closes, only for the UN seat', () => {
  const base = freshGame(2);
  const un = draft(clone(base), { crew_un_b612: 'primary' });
  const b612 = draft(clone(base), { crew_un_b612: 'secondary' });
  const i = seatWith(un, 'crew_un_b612');
  assert(i >= 0, 'nobody seated on the UN card');
  eq(un.players[i].aqua - b612.players[i].aqua, 2, 'UN vs B612 opening bank');
  const j = 1 - i;
  eq(un.players[j].aqua, b612.players[j].aqua, 'the other seat\'s bank changed with the UN pick');
  return `UN opens with ${un.players[i].aqua}, B612 with ${b612.players[i].aqua}`;
});
check('SECRETARY GENERAL: a re-pick during the draft does not pay twice', () => {
  // A 1-seat draft closes on the first pick, so use 3 seats: UN picks, re-picks,
  // then the last seat closes the draft.
  let st = freshGame(3);
  const unSeat = st.players.find((p) => p.color === colorOf('crew_un_b612'));
  assert(unSeat, 'no UN-coloured seat at a 3-seat table');
  const start = unSeat.aqua;
  for (const face of ['primary', 'secondary', 'primary']) {
    const r = applyOperation(st, { kind: 'PICK_CREW', cardId: 'crew_un_b612', face }, { profileId: unSeat.profileId });
    assert(r.ok, r.error); st = r.state;
  }
  st = draft(st);
  const me = st.players.find((p) => p.profileId === unSeat.profileId);
  eq(me.aqua - start, 2, 'UN bank after pick / re-pick / re-pick / draft close');
});
check('SECRETARY GENERAL (M2): no opening credit; +2 on the first Home Bernal anchor', () => {
  const base = freshGame(2, { m2: true });
  const un = draft(clone(base), { crew_un_b612: 'primary' });
  const b612 = draft(clone(base), { crew_un_b612: 'secondary' });
  const i = seatWith(un, 'crew_un_b612');
  eq(un.players[i].aqua, b612.players[i].aqua, 'M2: UN got an opening credit');
  return 'deferred to the anchor (anchor payout covered below)';
});

// ---- BLINK TELESCOPE (B612) ----
// "1 re-roll per prospecting operation when using a Raygun."
function raygunScan(face, opts = {}) {
  const st = playing(2);
  const me = only(st, 0, 'crew_un_b612', face);
  if (opts.anarchy) st.anarchy = true;
  if (opts.m2) { st.m2 = true; st.m0 = true; }
  if (opts.home) anchorHome(me);
  const HERE = 'mars-arsia-mons-caves';
  const A = 'mars-hellas-basin-buried-glaciers';
  me.rocket.siteId = HERE;
  me.rocket.stack = [{ id: RAY, kind: 'patent', face: 'primary' }];
  me.rocket.activeProspectorId = RAY;
  const r = op(st, 0, { kind: 'PROSPECT', siteId: A });
  assert(r.ok, `raygun scan refused: ${r.error}`);
  return r.state.discs[A];
}
check('BLINK TELESCOPE: a B612 raygun scan is re-rollable; the UN face is not', () => {
  assert(raygunScan('secondary').canReroll === true, 'B612 scan not re-rollable');
  assert(!raygunScan('primary').canReroll, 'UN (other face) scan was re-rollable');
});
check('BLINK TELESCOPE: suspended by Anarchy', () => {
  assert(!raygunScan('secondary', { anarchy: true }).canReroll, 'Anarchy did not suspend Blink Telescope');
});
check('BLINK TELESCOPE: locked under M2 until a Home Bernal anchors', () => {
  assert(!raygunScan('secondary', { m2: true }).canReroll, 'M2 lock did not hold');
  assert(raygunScan('secondary', { m2: true, home: true }).canReroll === true, 'M2 + Home Bernal did not unlock');
});

// ---- TAXES (Roscosmos) ----
// "+1 Aqua from the Pool after any player places a Claim or industrializes a Claim."
// Find a raygun-in-sight site whose size roll can't fail (threshold >= 6).
function sureClaimSetup(st, idx) {
  const me = st.players[idx];
  const HERE = 'mars-arsia-mons-caves';
  me.rocket.siteId = HERE;
  me.rocket.stack = [{ id: RAY, kind: 'patent', face: 'primary' }];
  me.rocket.activeProspectorId = RAY;
  st.activeIndex = idx;
  return HERE;
}
function taxesProspect({ holderIdx, actorIdx, anarchy = false, seed } = {}) {
  // Try targets in sight until one places a Claim (a deterministic seed per
  // target), so the check does not depend on one lucky roll.
  for (const target of ['mars-hellas-basin-buried-glaciers', 'mars-north-pole', 'mars-south-pole']) {
    for (let s = 0; s < 12; s++) {
      const st = playing(2, { seed: `taxes-${seed || ''}-${s}` });
      only(st, holderIdx, 'crew_roscosmos_taikonauts', 'primary');
      if (anarchy) st.anarchy = true;
      sureClaimSetup(st, actorIdx);
      const before = st.players.map((p) => p.aqua);
      const r = op(st, actorIdx, { kind: 'PROSPECT', siteId: target });
      if (!r.ok) continue;
      if (r.state.discs[target] && r.state.discs[target].outcome === 'success') {
        return { delta: r.state.players.map((p, i) => p.aqua - before[i]), log: r.log };
      }
    }
  }
  throw new Error('could not place a Claim on any test site');
}
check('TAXES: an OPPONENT\'s Claim pays the Roscosmos seat +1, nobody else', () => {
  const { delta, log } = taxesProspect({ holderIdx: 1, actorIdx: 0 });
  eq(delta[1], 1, 'Roscosmos seat');
  eq(delta[0], 0, 'the prospector');
  assert(/Taxes/.test(log), 'Taxes missing from the log');
});
check('TAXES: the holder\'s OWN Claim pays too ("any player")', () => {
  const { delta } = taxesProspect({ holderIdx: 0, actorIdx: 0 });
  eq(delta[0], 1, 'Roscosmos prospecting its own claim');
});
check('TAXES: suspended by Anarchy', () => {
  const { delta } = taxesProspect({ holderIdx: 1, actorIdx: 0, anarchy: true });
  eq(delta[1], 0, 'Roscosmos seat under Anarchy');
});

// ---- FELONIOUS (Taikonauts) ----
// "Your Humans may perform Felonious actions." Probe: Claim Jump (G4).
function claimJump(face, { anarchy = false, crewAboard = true } = {}) {
  const st = playing(2);
  const me = only(st, 0, 'crew_roscosmos_taikonauts', face);
  const SITE = 'mars-hellas-basin-buried-glaciers';
  st.discs[SITE] = { outcome: 'success', ownerId: st.players[1].profileId, kind: 'raygun', turn: 0, round: 1 };
  me.rocket.siteId = SITE;
  me.rocket.stack = crewAboard ? [{ id: 'crew_roscosmos_taikonauts', kind: 'crew', face }] : [{ id: RAY, kind: 'patent', face: 'primary' }];
  if (anarchy) st.anarchy = true;
  return op(st, 0, { kind: 'CLAIM_JUMP', siteId: SITE });
}
check('FELONIOUS: a Taikonaut may claim-jump; Roscosmos (other face) may not', () => {
  const t = claimJump('secondary');
  assert(t.ok, `Taikonaut claim jump refused: ${t.error}`);
  const r = claimJump('primary');
  eq(r.ok ? 'accepted' : r.error, 'felonies_not_allowed', 'Roscosmos claim jump');
});
check('FELONIOUS: still needs a Human at the site', () => {
  const t = claimJump('secondary', { crewAboard: false });
  eq(t.ok ? 'accepted' : t.error, 'felony_needs_human', 'Taikonaut claim jump with no human');
});
check('FELONIOUS: under Anarchy everyone may commit felonies', () => {
  const r = claimJump('primary', { anarchy: true });
  assert(r.ok, `Roscosmos claim jump under Anarchy refused: ${r.error}`);
});

// ---- LAUNCH FEES (NASA) ----
// "+1 Aqua from the Pool after any player performs a boost operation."
function boostWith({ holderIdx, actorIdx, anarchy = false, m2 = false, home = false }) {
  const st = playing(2);
  only(st, holderIdx, 'crew_nasa_isro', 'primary');
  if (anarchy) st.anarchy = true;
  if (m2) { st.m2 = true; st.m0 = true; }
  if (home) anchorHome(st.players[holderIdx]);
  st.activeIndex = actorIdx;
  const actor = st.players[actorIdx];
  actor.hand = ['thr_hall_effect'];
  actor.aqua = 20;
  const before = st.players.map((p) => p.aqua);
  const r = op(st, actorIdx, { kind: 'BOOST', cardIds: ['thr_hall_effect'] });
  assert(r.ok, `boost refused: ${r.error}`);
  return { delta: r.state.players.map((p, i) => p.aqua - before[i]), log: r.log };
}
check('LAUNCH FEES: an opponent\'s boost pays NASA +1, nobody else', () => {
  const { delta, log } = boostWith({ holderIdx: 1, actorIdx: 0 });
  eq(delta[1], 1, 'NASA seat');
  assert(delta[0] < 0, 'booster was not charged');
  assert(/Launch Fees/.test(log), 'Launch Fees missing from the log');
});
check('LAUNCH FEES: NASA\'s own boost pays NASA too', () => {
  const plain = boostWith({ holderIdx: 1, actorIdx: 0 }).delta[0];   // cost without the fee
  const own = boostWith({ holderIdx: 0, actorIdx: 0 }).delta[0];
  eq(own - plain, 1, 'own boost net of cost');
});
check('LAUNCH FEES: suspended by Anarchy; locked under M2 until a Home Bernal', () => {
  eq(boostWith({ holderIdx: 1, actorIdx: 0, anarchy: true }).delta[1], 0, 'Anarchy');
  eq(boostWith({ holderIdx: 1, actorIdx: 0, m2: true }).delta[1], 0, 'M2 locked');
  eq(boostWith({ holderIdx: 1, actorIdx: 0, m2: true, home: true }).delta[1], 1, 'M2 unlocked');
});

bug('LAUNCH-FEES-PER-OP', 'LAUNCH FEES: one boost OPERATION pays +1 once, not once per follow-up boost', () => {
  // Boost is one operation per turn; later boosts the same turn ride free as
  // part of it (hasBoostedThisTurn). "+1 Aqua after any player performs a boost
  // operation" should therefore pay once per operation. The engine credits on
  // every BOOST op, so a rival who boosts three cards one at a time pays 3.
  const st = playing(2);
  only(st, 1, 'crew_nasa_isro', 'primary');
  const actor = st.players[0];
  actor.hand = ['thr_hall_effect', 'thr_mass_driver', 'thr_pulsed_inductive'];
  actor.aqua = 40;
  const nasa0 = st.players[1].aqua;
  let cur = st;
  for (const id of actor.hand.slice()) {
    const r = op(cur, 0, { kind: 'BOOST', cardIds: [id] });
    assert(r.ok, `boost ${id}: ${r.error}`);
    cur = r.state;
  }
  eq(cur.players[0].opsRemaining, 3, 'operations spent by the three boosts');
  eq(cur.players[1].aqua - nasa0, 1, 'Launch Fees paid for one boost operation');
});

// ---- DHARMA REFUEL (ISRO) ----
// "If any of your Humans carry a glory chit, double yield from a Colocated
// site refuel operation."
function factoryRefuel({ face, chit = true, anarchy = false }) {
  const st = playing(2);
  const me = only(st, 0, 'crew_nasa_isro', face);
  const SITE = 'mars-hellas-basin-buried-glaciers';
  st.factories[SITE] = { ownerId: me.profileId, spectralType: 'C' };
  me.rocket.siteId = SITE;
  me.rocket.stack = [{ id: 'crew_nasa_isro', kind: 'crew', face }, { id: SOLAR_PUSH, kind: 'patent', face: 'primary' }];
  me.rocket.activeThrusterId = SOLAR_PUSH;
  me.rocket.tank = 0;
  me.refueledSites = [];
  if (chit) me.glory.chits = [{ id: 'chit-x', crewId: 'crew_nasa_isro', siteId: 'mars-north-pole', vp: 1 }];
  if (anarchy) st.anarchy = true;
  const r = op(st, 0, { kind: 'SITE_REFUEL', siteId: SITE, mode: 'factory' });
  assert(r.ok, `factory refuel refused: ${r.error}`);
  return { tank: r.state.players[0].rocket.tank, log: r.log };
}
check('DHARMA REFUEL: ISRO + glory chit doubles a factory refuel', () => {
  const isro = factoryRefuel({ face: 'secondary' });
  const nasa = factoryRefuel({ face: 'primary' });
  const none = factoryRefuel({ face: 'secondary', chit: false });
  assert(isro.tank > nasa.tank, `ISRO refuel ${isro.tank} not above NASA ${nasa.tank}`);
  eq(none.tank, nasa.tank, 'ISRO with no chit');
  assert(/Dharma/.test(isro.log), 'Dharma missing from the log');
  return `tank ${nasa.tank} -> ${isro.tank}`;
});
check('DHARMA REFUEL: suspended by Anarchy', () => {
  eq(factoryRefuel({ face: 'secondary', anarchy: true }).tank, factoryRefuel({ face: 'primary' }).tank, 'ISRO under Anarchy');
});

// ---- OPEN SOURCE FINAO (Anonymous P2P) ----
// "Failure Is Not An Option costs 3 Aqua."
function finaoMove({ face, anarchy = false }) {
  const st = playing(2);
  const me = only(st, 0, 'crew_anonp2p_esa', face);
  if (anarchy) st.anarchy = true;
  // lag-m0sea -> burn-5eobz: one burn into a skull (crash) hazard space.
  me.rocket.siteId = 'lag-m0sea';
  me.rocket.stack = [{ id: SOLAR_PUSH, kind: 'patent', face: 'primary' }];
  me.rocket.activeThrusterId = SOLAR_PUSH;
  me.rocket.tank = 12;
  me.aqua = 30;
  const r = op(st, 0, { kind: 'MOVE', hazardPay: true, segments: [{ from: 'lag-m0sea', to: 'burn-5eobz', burns: 1, turn: 1 }, { from: 'burn-5eobz', to: 'lag-c3cha', burns: 0, turn: 1 }] });
  assert(r.ok, `move refused: ${r.error}`);
  return 30 - r.state.players[0].aqua;
}
check('OPEN SOURCE FINAO: a FINAO costs Anonymous P2P 3 aqua, ESA (other face) 4', () => {
  // The route crosses n hazards; FINAO is paid once per hazard.
  const p2p = finaoMove({ face: 'primary' });
  const esa = finaoMove({ face: 'secondary' });
  const n = esa / 4;
  assert(Number.isInteger(n) && n >= 1, `ESA paid ${esa}, not a multiple of 4`);
  eq(p2p, 3 * n, `P2P FINAO cost over ${n} hazard(s)`);
  return `${n} hazards: ESA ${esa}, P2P ${p2p}`;
});
check('OPEN SOURCE FINAO: suspended by Anarchy', () => {
  eq(finaoMove({ face: 'primary', anarchy: true }), finaoMove({ face: 'secondary' }), 'P2P FINAO under Anarchy');
});

// ---- POWERSAT (ESA) ----
// "During any player's Turn, may give +1 thrust to any Spacecraft that has a
// push icon in its thruster triangle. Negotiable."
function pushThrust({ holderIdx, moverIdx, anarchy = false }) {
  const st = playing(2);
  only(st, holderIdx, 'crew_anonp2p_esa', 'secondary');
  if (anarchy) st.anarchy = true;
  st.activeIndex = moverIdx;
  const me = st.players[moverIdx];
  const from = leoSlug();
  const to = neighborSlugs(from)[0];
  me.rocket.siteId = null;
  me.rocket.stack = [{ id: SOLAR_PUSH, kind: 'patent', face: 'primary' }];
  me.rocket.activeThrusterId = SOLAR_PUSH;
  me.rocket.tank = 12;
  const r = op(st, moverIdx, { kind: 'MOVE', debug: true, segments: [{ from, to, burns: 0, turn: 1 }] });
  assert(r.ok, `debug move refused: ${r.error}`);
  return r.calc.finalThrust;
}
check('POWERSAT: +1 thrust to the ESA seat\'s own push-icon thruster', () => {
  const esa = pushThrust({ holderIdx: 0, moverIdx: 0 });
  const plain = pushThrust({ holderIdx: 1, moverIdx: 0 });   // ESA on seat 1, seat 0 flies
  eq(esa - plain, 1, 'ESA own push thruster');
  return `${plain} -> ${esa}`;
});
check('POWERSAT: suspended by Anarchy', () => {
  eq(pushThrust({ holderIdx: 0, moverIdx: 0, anarchy: true }), pushThrust({ holderIdx: 1, moverIdx: 0 }), 'ESA under Anarchy');
});
bug('POWERSAT-ANY', 'POWERSAT: "any Spacecraft ... during any player\'s Turn" - an opponent\'s push thruster gets the +1', () => {
  // The printed text lets ESA beam ANY push-icon spacecraft, on anyone's turn.
  // The engine only ever reads hasPowersat(mover), so ESA cannot extend it to
  // a rival without a negotiated ability loan (a trade).
  const withEsaAtTable = pushThrust({ holderIdx: 1, moverIdx: 0 });
  const st = playing(2);
  // No ESA anywhere: control.
  st.players.forEach((p, i) => give(st, i, CREW[i].id, 'primary'));
  const noEsa = (() => {
    const me = st.players[0];
    const from = leoSlug(); const to = neighborSlugs(from)[0];
    me.rocket.siteId = null;
    me.rocket.stack = [{ id: SOLAR_PUSH, kind: 'patent', face: 'primary' }];
    me.rocket.activeThrusterId = SOLAR_PUSH; me.rocket.tank = 12;
    return op(st, 0, { kind: 'MOVE', debug: true, segments: [{ from, to, burns: 0, turn: 1 }] }).calc.finalThrust;
  })();
  assert(withEsaAtTable === noEsa + 1, `an opponent of ESA got ${withEsaAtTable - noEsa} extra thrust, not the offered +1 (engine has no way for ESA to offer it outside a trade)`);
});

// ---- SKUNKWORKS (Shimizu) ----
// "Ignore academia hand limit when bidding or starting an auction."
function startAuctionFullHand(face, { anarchy = false } = {}) {
  const st = playing(2);
  const me = only(st, 0, 'crew_shimizu_nasrda', face);
  if (anarchy) st.anarchy = true;
  me.hand = PATENTS.filter((c) => c.type === 'thruster').slice(0, 4).map((c) => c.id);
  me.aqua = 10;
  return op(st, 0, { kind: 'AUCTION_START', deckType: 'thruster' });
}
check('SKUNKWORKS: Shimizu starts an auction at the 4-card hand limit; NASRDA cannot', () => {
  const s = startAuctionFullHand('primary');
  assert(s.ok, `Shimizu auction refused: ${s.error}`);
  const n = startAuctionFullHand('secondary');
  eq(n.ok ? 'accepted' : n.error, 'hand_limit', 'NASRDA at the limit');
});
check('SKUNKWORKS: Shimizu may BID with a full hand; others may not', () => {
  const st = playing(2);
  only(st, 1, 'crew_shimizu_nasrda', 'primary');
  st.players[0].hand = [];
  st.players[0].aqua = 10;
  let r = op(st, 0, { kind: 'AUCTION_START', deckType: 'thruster' });
  assert(r.ok, r.error);
  r.state.players[1].hand = PATENTS.filter((c) => c.type === 'reactor').slice(0, 4).map((c) => c.id);
  r.state.players[1].aqua = 10;
  const bid = op(r.state, 1, { kind: 'AUCTION_BID', amount: 1 });
  assert(bid.ok, `Shimizu full-hand bid refused: ${bid.error}`);
  const st2 = clone(r.state);
  give(st2, 1, 'crew_shimizu_nasrda', 'secondary');
  const bid2 = op(st2, 1, { kind: 'AUCTION_BID', amount: 1 });
  eq(bid2.ok ? 'accepted' : bid2.error, 'hand_limit', 'NASRDA full-hand bid');
});
check('SKUNKWORKS: suspended by Anarchy', () => {
  const s = startAuctionFullHand('primary', { anarchy: true });
  eq(s.ok ? 'accepted' : s.error, 'hand_limit', 'Shimizu at the limit under Anarchy');
});

// ---- MOONCABLE (NASRDA) ----
// "Free action 1/turn at LEO/Home Bernal: refuel an active dirt thruster
// (7 tanks, or 1 if a Crew thruster). Only 1 dirt tank refuel per turn."
function mooncable({ face, anarchy = false, m2 = false, home = false }) {
  const st = playing(2);
  const me = only(st, 0, 'crew_shimizu_nasrda', face);
  const dirt = PATENTS.find((c) => c.id === 'thr_mass_driver');
  me.rocket.siteId = null;
  me.rocket.stack = [{ id: 'crew_shimizu_nasrda', kind: 'crew', face }, { id: dirt.id, kind: 'patent', face: 'primary' }];
  me.rocket.activeThrusterId = dirt.id;
  me.rocket.tank = 0;
  if (anarchy) st.anarchy = true;
  if (m2) { st.m2 = true; st.m0 = true; }
  if (home) anchorHome(me);
  return op(st, 0, { kind: 'DIRT_REFUEL' });
}
check('MOONCABLE: NASRDA pipes dirt at LEO as a free action; Shimizu cannot', () => {
  const n = mooncable({ face: 'secondary' });
  assert(n.ok, `NASRDA dirt refuel refused: ${n.error}`);
  eq(n.state.players[0].opsRemaining, 4, 'Mooncable spent an operation');
  assert(n.state.players[0].rocket.tank > 0, 'no fuel went in');
  const s = mooncable({ face: 'primary' });
  assert(!s.ok, 'Shimizu (other face) got a Mooncable refuel');
  return `tank 0 -> ${n.state.players[0].rocket.tank}; Shimizu refused (${s.error})`;
});
check('MOONCABLE: suspended by Anarchy; locked under M2 until a Home Bernal', () => {
  assert(!mooncable({ face: 'secondary', anarchy: true }).ok, 'Anarchy did not suspend Mooncable');
  assert(!mooncable({ face: 'secondary', m2: true }).ok, 'M2 lock did not hold');
  const unlocked = mooncable({ face: 'secondary', m2: true, home: true });
  assert(unlocked.ok, `M2 + Home Bernal: ${unlocked.error}`);
});

// ---- MARKETEER (SpaceX) ----
// "If you make the highest bid in an auction, you win even if tied."
function tiedAuction(face) {
  // Seat 0 auctions (wins ties by default), seat 1 holds the card under test.
  const st = playing(2);
  only(st, 1, 'crew_spacex_norse', face);
  st.players.forEach((p) => { p.hand = []; p.aqua = 10; });
  let r = op(st, 0, { kind: 'AUCTION_START', deckType: 'thruster' });
  assert(r.ok, r.error);
  r = op(r.state, 1, { kind: 'AUCTION_BID', amount: 2 });
  assert(r.ok, `bid: ${r.error}`);
  r = op(r.state, 0, { kind: 'AUCTION_BID', amount: 2 });
  assert(r.ok, `auctioneer tie: ${r.error}`);
  // An auctioneer tie reopens the floor; the rival stands on their bid.
  r = op(r.state, 1, { kind: 'AUCTION_PASS' });
  assert(r.ok, `rival pass: ${r.error}`);
  return r.state;
}
check('MARKETEER: SpaceX wins a tie over the auctioneer', () => {
  const st = tiedAuction('primary');
  eq(st.auction.highBidderId, st.players[1].profileId, 'leader on a tie');
  const keep = op(st, 0, { kind: 'AUCTION_SELL', buyerId: st.players[0].profileId });
  eq(keep.ok ? 'accepted' : keep.error, 'marketeer_wins_tie', 'auctioneer keeping a Marketeer tie');
  const sell = op(st, 0, { kind: 'AUCTION_SELL', buyerId: st.players[1].profileId });
  assert(sell.ok, `selling to SpaceX refused: ${sell.error}`);
});
check('MARKETEER: Norse (other face) loses a tie to the auctioneer', () => {
  const st = tiedAuction('secondary');
  eq(st.auction.highBidderId, st.players[0].profileId, 'leader on a tie');
  const keep = op(st, 0, { kind: 'AUCTION_SELL', buyerId: st.players[0].profileId });
  assert(keep.ok, `auctioneer keep refused: ${keep.error}`);
});
check('MARKETEER: suspended by Anarchy', () => {
  const st = playing(2);
  only(st, 1, 'crew_spacex_norse', 'primary');
  st.players.forEach((p) => { p.hand = []; p.aqua = 10; });
  let r = op(st, 0, { kind: 'AUCTION_START', deckType: 'thruster' });
  r.state.anarchy = true;
  r = op(r.state, 1, { kind: 'AUCTION_BID', amount: 2 });
  r = op(r.state, 0, { kind: 'AUCTION_BID', amount: 2 });
  eq(r.state.auction.highBidderId, r.state.players[0].profileId, 'leader on a tie under Anarchy');
});
check('MARKETEER: a Marketeer buyer with a non-numeric profileId can be sold the tied lot', () => {
  // applyAuctionSell compares Number(mktPid) !== buyerId; for a string id
  // (tutorial bot seats) Number('x') is NaN, so selling to the Marketeer
  // themself is refused as marketeer_wins_tie.
  const roster = [{ profileId: 'alpha', name: 'A', seat: 1 }, { profileId: 'beta', name: 'B', seat: 2 }];
  let st = createInitialState({ players: roster, seed: 'crew-audit', maxRounds: 5 });
  st.players.forEach((p, i) => { p.color = CREW[i].color; });
  st = draft(st);
  st.activeIndex = 0;
  st.players.forEach((p) => { p.opsRemaining = 4; p.hand = []; p.aqua = 10; });
  only(st, 1, 'crew_spacex_norse', 'primary');
  const A = st.players[0].profileId, B = st.players[1].profileId;
  assert(typeof B === 'string', 'fixture lost its string ids');
  let r = applyOperation(st, { kind: 'AUCTION_START', deckType: 'thruster' }, { profileId: A });
  assert(r.ok, r.error);
  r = applyOperation(r.state, { kind: 'AUCTION_BID', amount: 2 }, { profileId: B });
  r = applyOperation(r.state, { kind: 'AUCTION_BID', amount: 2 }, { profileId: A });
  r = applyOperation(r.state, { kind: 'AUCTION_PASS' }, { profileId: B });
  assert(r.ok, `pass: ${r.error}`);
  eq(r.state.auction.highBidderId, B, 'the string-id Marketeer leads the tie');
  const sell = applyOperation(r.state, { kind: 'AUCTION_SELL', buyerId: B }, { profileId: A });
  assert(sell.ok, `selling to the string-id Marketeer refused: ${sell.error}`);
});

// ---- SCRUM TROUBLESHOOTERS (Norse) ----
// "Perform Glitch repair anywhere, even without Humans present."
function glitchedUncrewed(face, { anarchy = false } = {}) {
  const st = playing(2);
  const me = only(st, 0, 'crew_spacex_norse', face);
  me.rocket.siteId = 'mars-north-pole';
  me.rocket.stack = [{ id: SOLAR_PUSH, kind: 'patent', face: 'primary' }];
  me.rocket.glitch = true;
  if (anarchy) st.anarchy = true;
  autoFixGlitches(st);
  return me.rocket.glitch;
}
check('SCRUM TROUBLESHOOTERS: Norse clears an uncrewed glitch remotely; SpaceX cannot', () => {
  eq(glitchedUncrewed('secondary'), false, 'Norse glitch after repair pass');
  eq(glitchedUncrewed('primary'), true, 'SpaceX glitch after repair pass');
});
check('SCRUM TROUBLESHOOTERS: suspended by Anarchy', () => {
  eq(glitchedUncrewed('secondary', { anarchy: true }), true, 'Norse glitch under Anarchy');
});

// ---- SECRETARY GENERAL under Module 2: the anchor payout ----
const EARTH_ORBIT = 'lag-ctnib';
const PLAIN_BERNAL = 'ber_l1_climate_control_bernal';
function anchorM2(face, { anarchy = false } = {}) {
  const st = playing(2, { m2: true });
  const me = only(st, 0, 'crew_un_b612', face);
  me.bernals = [{ cardId: PLAIN_BERNAL, siteId: EARTH_ORBIT, anchored: false, face: 'primary',
    stack: [{ id: 'gen_cascade_photovoltaic', kind: 'patent', face: 'primary' }] }];
  if (anarchy) st.anarchy = true;
  const before = me.aqua;
  const r = op(st, 0, { kind: 'ANCHOR_BERNAL', cardId: PLAIN_BERNAL });
  assert(r.ok, `anchor refused: ${r.error}`);
  return { delta: r.state.players[0].aqua - before, st: r.state, log: r.log };
}
check('SECRETARY GENERAL (M2): +2 aqua on the first Home Bernal anchor, UN only', () => {
  const un = anchorM2('primary');
  const b612 = anchorM2('secondary');
  eq(un.delta - b612.delta, 2, 'UN vs B612 anchor payout');
  assert(/Secretary General/.test(un.log), 'payout missing from the log');
  assert(un.st.players[0].sgHomePaid === true, 'sgHomePaid not stamped');
});
check('SECRETARY GENERAL (M2): a second anchor of the Home Bernal does not pay again', () => {
  const first = anchorM2('primary');
  const st = first.st;
  const me = st.players[0];
  me.bernals[0].anchored = false;
  me.bernals[0].stack = [{ id: 'gen_cascade_photovoltaic', kind: 'patent', face: 'primary' }];
  me.opsRemaining = 4;
  st.turnActions = [];
  const before = me.aqua;
  const r = op(st, 0, { kind: 'ANCHOR_BERNAL', cardId: PLAIN_BERNAL });
  assert(r.ok, `re-anchor refused: ${r.error}`);
  eq(r.state.players[0].aqua - before, 0, 'second anchor payout');
});
check('SECRETARY GENERAL (M2): Anarchy at the first anchor pays nothing (and leaves it owed)', () => {
  // Recorded behaviour, see the audit doc: the payout is skipped but
  // sgHomePaid stays false, so the NEXT Home Bernal anchor pays it.
  const a = anchorM2('primary', { anarchy: true });
  const b = anchorM2('secondary', { anarchy: true });
  eq(a.delta, b.delta, 'UN payout under Anarchy');
  assert(!a.st.players[0].sgHomePaid, 'sgHomePaid stamped although nothing was paid');
});

// ---- TAXES on Industrialize ----
function industrializeWithTaxes({ holderIdx, actorIdx, anarchy = false }) {
  const REFINERY = 'ref_atomic_layer_deposition';
  const ROBONAUT = 'rob_phase_locked_diode_laser';
  const st = playing(2);
  only(st, holderIdx, 'crew_roscosmos_taikonauts', 'primary');
  if (anarchy) st.anarchy = true;
  st.activeIndex = actorIdx;
  const me = st.players[actorIdx];
  me.rocket.siteId = 'mathilde';
  const ids = [REFINERY, ROBONAUT];
  me.rocket.stack = ids.map((id) => ({ id, kind: 'patent', face: 'primary' }));
  st.discs.mathilde = { outcome: 'success', ownerId: me.profileId, by: me.name };
  const before = st.players.map((p) => p.aqua);
  const r = op(st, actorIdx, { kind: 'INDUSTRIALIZE', siteId: 'mathilde', cardIds: ids });
  assert(r.ok, `industrialize refused: ${r.error}`);
  return r.state.players.map((p, i) => p.aqua - before[i]);
}
check('TAXES: an opponent industrializing a Claim pays Roscosmos +1', () => {
  const d = industrializeWithTaxes({ holderIdx: 1, actorIdx: 0 });
  eq(d[1], 1, 'Roscosmos seat');
  eq(d[0], 0, 'the industrializer');
  eq(industrializeWithTaxes({ holderIdx: 1, actorIdx: 0, anarchy: true })[1], 0, 'under Anarchy');
});

// ---- faction bank (C5): solitaire / co-op payout for Taxes, SG, Felonious ----
function soloBank(cardId, face, opts = {}) {
  const st = draft(freshGame(1, opts), { [cardId]: face });
  return st.players[0].aqua;
}
check('faction bank: solo Taxes / Felonious open +6, Secretary General +6 on its own +2', () => {
  const base = soloBank('crew_nasa_isro', 'primary');
  eq(soloBank('crew_roscosmos_taikonauts', 'primary') - base, FACTION_BANK_AQUA, 'Taxes solo');
  eq(soloBank('crew_roscosmos_taikonauts', 'secondary') - base, FACTION_BANK_AQUA, 'Felonious solo');
  eq(soloBank('crew_un_b612', 'primary') - base, FACTION_BANK_AQUA + 2, 'Secretary General solo');
  eq(soloBank('crew_un_b612', 'secondary') - base, 0, 'B612 solo');
  eq(soloBank('crew_spacex_norse', 'primary') - base, 0, 'Marketeer solo (gets the 3-for-2 take instead)');
});
check('faction bank: under M2 the solo bank still pays; SG\'s own +2 waits for the anchor', () => {
  const base = soloBank('crew_nasa_isro', 'primary', { m2: true });
  eq(soloBank('crew_un_b612', 'primary', { m2: true }) - base, FACTION_BANK_AQUA, 'SG solo M2');
});
check('faction bank: a competitive 2-seat table pays nobody', () => {
  const base = freshGame(2);
  const ros = draft(clone(base), { crew_roscosmos_taikonauts: 'primary' });
  const tai = draft(clone(base), { crew_roscosmos_taikonauts: 'secondary' });
  const i = seatWith(ros, 'crew_roscosmos_taikonauts');
  eq(ros.players[i].aqua, tai.players[i].aqua, 'Taxes vs Felonious at a table');
  // and the UN seat beside it carries only Secretary General's own +2
  eq(ros.players[1 - i].aqua - ros.players[i].aqua, 2, 'UN vs Roscosmos seat');
});
check('faction bank: co-op Altruism pays every qualifying seat', () => {
  const base = freshGame(2, { altruism: true });
  const plain = freshGame(2);
  const a = draft(clone(base), { crew_roscosmos_taikonauts: 'primary' });
  const b = draft(clone(plain), { crew_roscosmos_taikonauts: 'primary' });
  const i = seatWith(a, 'crew_roscosmos_taikonauts');
  eq(a.players[i].aqua - b.players[i].aqua, FACTION_BANK_AQUA, 'co-op Taxes seat');
});

// ---- SCRUM TROUBLESHOOTERS: a Glitch event never lands on Norse ----
check('SCRUM TROUBLESHOOTERS: the Sunspot Glitch event skips Norse, hits SpaceX', () => {
  const run = (face, anarchy = false) => {
    const st = playing(2);
    only(st, 0, 'crew_spacex_norse', face);
    st.players.forEach((p) => {
      p.rocket.siteId = 'mars-north-pole';
      p.rocket.stack = [{ id: SOLAR_PUSH, kind: 'patent', face: 'primary' }];
    });
    if (anarchy) st.anarchy = true;
    st.lastEvent = { kind: 'glitch', notes: [] };
    resolveSunspotEvent(st, 'glitch', { skipRegime: true });
    const w = (st.pendingEvent && st.pendingEvent.waiting) || [];
    return w.map((pid) => (pid === st.players[0].profileId ? 1 : 'other'));   // 1 = the seat under test
  };
  assert(run('primary').includes(1), 'SpaceX uncrewed rocket was not glitch-targeted');
  assert(!run('secondary').includes(1), 'Norse uncrewed rocket was glitch-targeted');
  assert(run('secondary', true).includes(1), 'Norse kept glitch immunity under Anarchy');
});

// ================================================================ promo crew
//
// Promo crew is admin-only (ctx.allowPromoCrew) and refused unless the room
// runs m0+m1+m2. Module 2 LOCKS faction privileges until a Home Bernal is
// anchored (2B3b), so in the only configuration a promo pick is legal in, every
// promo privilege read through hasPrivilege is dead until that anchor. The
// checks below drive each implemented promo face in that real configuration
// (PROMO = m0+m1+m2) as well as in a bare core game.
const PROMO = { m0: true, m1: true, m2: true };

check('promo crew: refused without the admin flag, refused without m0+m1+m2', () => {
  const pickIn = (opts, ctx) => {
    const st = freshGame(2, opts);
    st.players[0].color = colorOf('crew_brin');
    return op(st, 0, { kind: 'PICK_CREW', cardId: 'crew_brin', face: 'primary' }, ctx);
  };
  eq(pickIn(PROMO, {}).error, 'promo_crew_admin_only', 'non-admin promo pick');
  eq(pickIn({ m0: true, m1: true }, { allowPromoCrew: true }).error, 'promo_crew_needs_modules', 'admin pick without m2');
  assert(pickIn(PROMO, { allowPromoCrew: true }).ok, 'admin pick with m0+m1+m2 refused');
});
check('promo crew: M4 / M5 "requiresModule" cards are still pickable by an admin (no per-card gate)', () => {
  // Recorded behaviour: the server gate is the blanket m0+m1+m2 check only, so
  // a "Coming soon" card (e.g. JAXA, M4) is accepted and does nothing.
  const st = freshGame(2, PROMO);
  st.players[0].color = colorOf('crew_jaxa');
  const r = op(st, 0, { kind: 'PICK_CREW', cardId: 'crew_jaxa', face: 'primary' }, { allowPromoCrew: true });
  assert(r.ok, `admin JAXA pick refused: ${r.error}`);
  return 'accepted';
});

// A promo seat closes the draft for real (admin pick), the other seat picks
// normally. Returns both seats' banks.
function promoDraft(cardId, face, opts = PROMO) {
  let st = freshGame(2, opts);
  st.players[0].color = colorOf(cardId);
  const r = op(st, 0, { kind: 'PICK_CREW', cardId, face }, { allowPromoCrew: true });
  assert(r.ok, `promo pick ${cardId}: ${r.error}`);
  st = r.state;
  const other = st.players[1];
  const card = CREW.find((c) => c.color === other.color && c.color !== colorOf(cardId))
    || CREW.find((c) => c.color !== colorOf(cardId));
  other.color = card.color;
  const r2 = op(st, 1, { kind: 'PICK_CREW', cardId: card.id, face: 'primary' });
  assert(r2.ok, `closing pick: ${r2.error}`);
  assert(r2.state.draftPhase !== 'crew', 'draft did not close');
  return r2.state;
}

// ---- COLLECTIVE BARGAINING (LEO Workers' Union, white) ----
// "Receive 2 Aqua at game start. You may commit Murder/Suicide."
check('COLLECTIVE BARGAINING: +2 aqua at game start in a real promo game (m0+m1+m2)', () => {
  // The payout goes through playersWithPrivilege -> privilegeOf, which the M2
  // lock nulls at draft close (nobody has a Home Bernal yet). Promo picks are
  // only legal under M2, so the printed "+2 at game start" is never paid in
  // any game a player can actually seat this card in.
  const union = promoDraft('crew_leo_workers_union', 'primary');
  const sitdown = promoDraft('crew_leo_workers_union', 'secondary');
  eq(union.players[0].aqua - sitdown.players[0].aqua, 2, 'Union vs Sitdown face opening bank under m0+m1+m2');
});
check('COLLECTIVE BARGAINING: +2 aqua at draft close in a core game (engine-level)', () => {
  // Not a reachable configuration (promo needs m0+m1+m2): the seat is handed
  // the card directly and the other seat's pick closes the draft. Proves the
  // payout itself works once the M2 lock is out of the way.
  const close = (face) => {
    const st = freshGame(2);
    st.players[0].faction = { cardId: 'crew_leo_workers_union', face };
    const before = st.players[0].aqua;
    const r = op(st, 1, { kind: 'PICK_CREW', cardId: CREW[1].id, face: 'primary' });
    assert(r.ok, r.error);
    return r.state.players[0].aqua - before;
  };
  eq(close('primary') - close('secondary'), 2, 'Union vs Sitdown face');
});
check('COLLECTIVE BARGAINING: the Union may decommission a Human colonist; others may not', () => {
  const human = Object.values(COLONISTS_BY_ID).find((c) => c && c.colonistKind === 'Human');
  const scrap = (cardId, face) => {
    const st = playing(2);
    const me = only(st, 0, cardId, face);
    me.rocket.siteId = null;
    me.rocket.stack = [{ id: SOLAR_PUSH, kind: 'patent', face: 'primary' }, { id: human.id, kind: 'colonist', face: 'primary' }];
    const r = op(st, 0, { kind: 'DECOMMISSION', cardIds: [human.id], from: 'rocket' });
    return r.ok && !r.state.players[0].rocket.stack.some((x) => x.id === human.id);
  };
  assert(scrap('crew_leo_workers_union', 'primary'), 'Union could not let a Human go');
  assert(!scrap('crew_leo_workers_union', 'secondary'), 'Sitdown face let a Human go');
  assert(!scrap('crew_spacex_norse', 'primary'), 'a core faction let a Human go');
});

// ---- ROCKETEERS (The Martian Way, white) ----
// "Immune to pad explosions/space debris; -2 to Belt Rolls for Earth zone Radiation Belts."
function padBlast(face, opts = {}) {
  const st = playing(2, opts.game || {});
  const me = only(st, 0, 'crew_the_martian_way', face);
  if (opts.anarchy) st.anarchy = true;
  if (opts.home) anchorHome(me);
  me.rocket.siteId = null;
  me.rocket.stack = [{ id: SOLAR_PUSH, kind: 'patent' }];
  me.leo = []; me.hand = [];
  st.pendingEvent = { kind: 'pad_explosion', waiting: [me.profileId], options: {} };
  st.lastEvent = { kind: 'pad_explosion', notes: [] };
  const r = op(st, 0, { kind: 'EVENT_CHOICE' });
  assert(r.ok, `EVENT_CHOICE: ${r.error}`);
  return r.state.players[0].rocket.stack.length;
}
check('ROCKETEERS: immune to a Pad Explosion; Tailings Remining (other face) is not', () => {
  eq(padBlast('primary'), 1, 'Rocketeers stack after the blast');
  eq(padBlast('secondary'), 0, 'Tailings Remining stack after the blast');
});
check('ROCKETEERS: suspended by Anarchy', () => {
  eq(padBlast('primary', { anarchy: true }), 0, 'Rocketeers under Anarchy');
});
check('ROCKETEERS (m0+m1+m2): locked until a Home Bernal is anchored', () => {
  eq(padBlast('primary', { game: PROMO }), 0, 'Rocketeers in a promo game, no Home Bernal');
  eq(padBlast('primary', { game: PROMO, home: true }), 1, 'Rocketeers in a promo game, Home Bernal anchored');
  return 'recorded: dead until the anchor (see audit open question)';
});

// ---- THERMAL RESEARCH (BRIN, white) ----
// "Your radiators have 2 extra Rad-Hard during a Belt Roll."
check('THERMAL RESEARCH: a radiator BRIN would lose without the bonus survives the belt', () => {
  const EARTH_BELT = 'rad-rttd0';
  const BELT_FROM = 'burn-ue3lc';
  const radiator = PATENTS.find((c) => c.type === 'radiator');
  const thr = 'thr_hall_effect';
  const gen = PATENTS.find((c) => c.type === 'generator' && !(c.faces.primary.requires || []).length
    && (c.faces.primary.supplies || []).includes('gen-electric'));
  const fly = (cardId, face, cursor, anarchy = false) => {
    const st = playing(2);
    st.rng.cursor = cursor;
    const me = only(st, 0, cardId, face);
    if (anarchy) st.anarchy = true;
    me.rocket.siteId = BELT_FROM;
    me.rocket.stack = [{ id: thr, kind: 'patent', face: 'primary' },
      { id: gen.id, kind: 'patent', face: 'primary' },
      { id: radiator.id, kind: 'patent', face: 'primary', radSide: 'light' }];
    me.rocket.activeThrusterId = thr;
    me.rocket.tank = 12;
    const r = op(st, 0, { kind: 'MOVE', segments: [{ from: BELT_FROM, to: EARTH_BELT, burns: 1, turn: 1 }] });
    assert(r.ok, `move: ${r.error}`);
    return r.state.players[0].rocket.stack.some((x) => x.id === radiator.id);
  };
  let cursor = -1;
  for (let c = 0; c < 400; c++) if (!fly('crew_brin', 'secondary', c)) { cursor = c; break; }
  assert(cursor >= 0, 'no cursor took the radiator from the control');
  assert(fly('crew_brin', 'primary', cursor), 'THERMAL RESEARCH did not save the radiator');
  assert(!fly('crew_brin', 'primary', cursor, true), 'THERMAL RESEARCH kept working under Anarchy');
  return `cursor ${cursor}: Thermal Labs face loses it, Thermal Research keeps it, Anarchy loses it`;
});

// ---- WATER / HYDROGEN ARCJET (Baltimore Gun Club) ----
// "Colocated thruster gets a bonus burn if it starts its move at LEO
// (black: ..., your Anchored Bernal, or your Factory)."
function arcjet({ aboard, face = 'primary', anarchy = false, game = PROMO, idx = 0, at = null, ownFactory = false }) {
  const st = playing(2, game);
  st.activeIndex = idx;
  const me = st.players[idx];
  give(st, idx, 'crew_baltimore_gun_club', face);
  if (anarchy) st.anarchy = true;
  if (ownFactory) st.factories = { [at]: { ownerId: me.profileId, spectralType: 'C' } };
  me.rocket.siteId = at;
  me.rocket.stack = [{ id: 'thr_dumbo', kind: 'patent', face: 'primary' }, { id: 'rea_cermet_nerva_fission', kind: 'patent', face: 'primary' }];
  if (aboard) me.rocket.stack.push({ id: 'crew_baltimore_gun_club', kind: 'crew', face });
  me.rocket.activeThrusterId = 'thr_dumbo';
  me.rocket.tank = 20;
  me.aqua = 40;   // FINAO any liftoff hazard so the ship is never lost before the breakdown
  const to = at == null ? 'burn-gz7tn' : neighborSlugs(at)[0];
  const r = op(st, idx, { kind: 'MOVE', debug: true, hazardPay: true, segments: [{ from: at, to, burns: 2, turn: 1 }] });
  assert(r.ok, `move: ${r.error}`);
  assert(r.calc, `no burn breakdown came back: ${r.log}`);
  return r.calc.arcjetCredit | 0;
}
check('WATER ARCJET: +1 burn leaving LEO with the Gun Club aboard; nothing when left behind', () => {
  eq(arcjet({ aboard: true }), 1, 'aboard');
  eq(arcjet({ aboard: false }), 0, 'not aboard');
});
check('HYDROGEN ARCJET: +1 burn leaving your own Factory; the white face gets none there', () => {
  eq(arcjet({ aboard: true, face: 'secondary', at: 'hathor', ownFactory: true }), 1, 'Hydrogen at own Factory');
  eq(arcjet({ aboard: true, face: 'primary', at: 'hathor', ownFactory: true }), 0, 'Water at own Factory');
  eq(arcjet({ aboard: true, face: 'secondary', at: 'hathor', ownFactory: false }), 0, 'Hydrogen at a site with no Factory');
  eq(arcjet({ aboard: true, face: 'secondary' }), 1, 'Hydrogen at LEO');
});
check('WATER ARCJET: suspended by Anarchy; NOT locked by M2 (deliberate exemption)', () => {
  eq(arcjet({ aboard: true, anarchy: true }), 0, 'Anarchy');
  eq(arcjet({ aboard: true, game: PROMO }), 1, 'M2 game with no Home Bernal');
});

// ---- RABBLE-ROUSER (AEB, black) ----
// "When you lobby authority in season blue, you may end or initiate anarchy."
function rouse({ face = 'secondary', anarchy = false, game = { m0: true }, home = false }) {
  const st = playing(2, game);
  const me = only(st, 0, 'crew_aeb', face);
  if (home) anchorHome(me);
  st.turn = 11;            // season blue
  st.anarchy = anarchy;
  st.activeLawStar = 'centrist';
  me.aqua = 5;
  me.lobbiedThisTurn = false;
  st.assembly.delegates.authority = { ...(st.assembly.delegates.authority || {}), [me.profileId]: 1 };
  return op(st, 0, { kind: 'LOBBY', ideology: 'authority', rabbleRouser: true });
}
check('RABBLE-ROUSER: AEB starts Anarchy and ends it; Ambassador face cannot', () => {
  const s = rouse({});
  assert(s.ok && s.state.anarchy === true, `start: ${s.error}`);
  const e = rouse({ anarchy: true });
  assert(e.ok && e.state.anarchy === false, `end: ${e.error}`);
  eq(rouse({ face: 'primary' }).error, 'no_rabble_rouser', 'Ambassador face');
});
check('RABBLE-ROUSER (m0+m1+m2): locked until a Home Bernal is anchored', () => {
  eq(rouse({ game: PROMO }).error, 'no_rabble_rouser', 'promo game, no Home Bernal');
  const ok = rouse({ game: PROMO, home: true });
  assert(ok.ok, `promo game, Home Bernal: ${ok.error}`);
});

// ---- OFFWORLD TRADE NEXUS (Makers Guild, white) ----
// "If you have either a Factory or Anchored Bernal, gain Bernal Profits."
function nexus({ face = 'primary', anarchy = false }) {
  const st = playing(2, PROMO);
  const me = only(st, 0, 'crew_makers_guild', face);
  me.bernals = [];
  st.factories = { ceres: { ownerId: me.profileId, spectralType: 'C' } };
  if (anarchy) st.anarchy = true;
  const before = me.aqua | 0;
  st.activeIndex = 1;
  const r = op(st, 1, { kind: 'END_TURN' });
  assert(r.ok, r.error);
  return (r.state.players[0].aqua | 0) - before;
}
check('OFFWORLD TRADE NEXUS: +1 aqua at turn start off a plain Factory (no Home Bernal needed)', () => {
  eq(nexus({}), 1, 'Nexus');
  eq(nexus({ face: 'secondary' }), 0, 'Trade Port face');
});
check('OFFWORLD TRADE NEXUS: suspended by Anarchy', () => {
  eq(nexus({ anarchy: true }), 0, 'Nexus under Anarchy');
});

// ---- DOWSERS (Cerulean, black) ----
// "When ISRU refueling for water, refuel at an ISRU = 0."
function dowse({ face = 'secondary', anarchy = false, game = {}, home = false }) {
  const SITE = 'hathor';
  const st = playing(2, game);
  const me = only(st, 0, 'crew_cerulean', face);
  if (anarchy) st.anarchy = true;
  if (home) anchorHome(me);
  const isruOf = (c) => { const p = (c.faces.primary.properties || []).find((x) => x.key === 'isru'); return p ? Number(p.value) : null; };
  const site = siteBySlug(SITE);
  const rig = PATENTS.find((c) => c.type === 'robonaut' && isruOf(c) > (site.hydration | 0));
  me.rocket.siteId = SITE;
  me.rocket.stack = [{ id: rig.id, kind: 'patent', face: 'primary' }];
  me.rocket.activeProspectorId = rig.id;
  me.rocket.tank = 0;
  return op(st, 0, { kind: 'SITE_REFUEL', siteId: SITE, mode: 'isru' });
}
check('DOWSERS: an out-rated rig refuels at ISRU 0; Blue Planet face is refused', () => {
  assert(dowse({}).ok, `Dowsers: ${dowse({}).error}`);
  eq(dowse({ face: 'primary' }).error, 'isru_too_high', 'Blue Planet face');
});
check('DOWSERS: suspended by Anarchy; locked under m0+m1+m2 until a Home Bernal', () => {
  eq(dowse({ anarchy: true }).error, 'isru_too_high', 'Anarchy');
  eq(dowse({ game: PROMO }).error, 'isru_too_high', 'promo game, no Home Bernal');
  assert(dowse({ game: PROMO, home: true }).ok, 'promo game, Home Bernal anchored');
});

// ================================================================ promo group A
// movement and hazards: LIFE RAFT, LIFEBOAT, WEAK STABILITY BOUNDARY, CAVITATION ENGINEERS, POWER SERIES CHAOS MODEL, BLUE PLANET
// (group A checks go here)










// ---------------------------------------------------------------- end promo group A








// ================================================================ promo group B
// politics: AMBASSADOR, EMISSARIES, ARBITER, POWER BROKERS, HEROIC
// (group B checks go here)
// ---- AMBASSADOR (AEB, white) ----
// "During lobby, may move a delegate into centrist instead of Decommission."
function ambassadorLobby({ face = 'primary', anarchy = false, game = { m0: true }, home = false, flag = true } = {}) {
  const st = playing(2, game);
  const me = only(st, 0, 'crew_aeb', face);
  if (home) anchorHome(me);
  st.anarchy = anarchy;
  st.activeLawStar = 'centrist';
  me.aqua = 5;
  me.lobbiedThisTurn = false;
  const pid = me.profileId;
  for (const k of Object.keys(st.assembly.delegates)) delete st.assembly.delegates[k][pid];
  st.assembly.delegates.freedom = { ...(st.assembly.delegates.freedom || {}), [pid]: 1 };
  const r = op(st, 0, { kind: 'LOBBY', ideology: 'freedom', ...(flag ? { ambassador: true } : {}) });
  const d = r.ok ? r.state.assembly.delegates : null;
  return { r, freedom: d ? (d.freedom[pid] | 0) : null, centrist: d ? ((d.centrist || {})[pid] | 0) : null };
}
check('AMBASSADOR: the lobbied delegate moves to Centrist instead of leaving; Rabble-Rouser face cannot', () => {
  const a = ambassadorLobby();
  assert(a.r.ok, `Ambassador lobby refused: ${a.r.error}`);
  eq(a.freedom, 0, 'delegate left Freedom');
  eq(a.centrist, 1, 'delegate in Centrist');
  assert(/Centrist/.test(a.r.log), 'Ambassador missing from the log');
  eq(ambassadorLobby({ face: 'secondary' }).r.error, 'no_ambassador', 'Rabble-Rouser face');
  const plain = ambassadorLobby({ flag: false });
  assert(plain.r.ok, plain.r.error);
  eq(plain.centrist, 0, 'a plain lobby (no Ambassador choice) still discards');
});
check('AMBASSADOR: suspended by Anarchy; locked under m0+m1+m2 until a Home Bernal', () => {
  eq(ambassadorLobby({ anarchy: true }).r.error, 'no_ambassador', 'Anarchy');
  eq(ambassadorLobby({ game: PROMO }).r.error, 'no_ambassador', 'promo game, no Home Bernal');
  const ok = ambassadorLobby({ game: PROMO, home: true });
  assert(ok.r.ok && ok.centrist === 1, `promo game, Home Bernal: ${ok.r.error}`);
});

// ---- EMISSARIES (African Union, white) ----
// "On your turn, you may treat any or all Ideologies tied for the most
// delegates as the Active Law."
// Freedom and Equality tied at 2 delegates each (Equality's law is Free Market
// Socialism, a law the player can feel: playerCanUseLaw('equality')). The star
// sits on Freedom. The check reads the law through the engine's own gate: the
// Equality research grant on AUCTION_START (`researchGrant`).
function emissaryGame({ face = 'primary', anarchy = false, game = { m0: true }, home = false } = {}) {
  const st = playing(2, game);
  const me = only(st, 0, 'crew_african_union_space_directorate', face);
  if (home) anchorHome(me);
  st.anarchy = anarchy;
  const [a, b] = st.players.map((p) => p.profileId);
  for (const k of Object.keys(st.assembly.delegates)) st.assembly.delegates[k] = {};
  st.assembly.delegates.freedom = { [a]: 1, [b]: 1 };
  st.assembly.delegates.equality = { [a]: 2 };
  st.activeLawStar = 'freedom';
  return st;
}
check('EMISSARIES: a tied Ideology counts as the Active Law for the African Union seat only', () => {
  const st = emissaryGame();
  const r = op(st, 0, { kind: 'EMISSARIES', ideologies: ['equality'] });
  assert(r.ok, `Emissaries refused: ${r.error}`);
  eq(JSON.stringify(r.state.players[0].emissaryLaws), '["equality"]', 'emissary laws recorded');
  assert(/Emissaries/.test(r.log), 'log');
  eq(op(emissaryGame({ face: 'secondary' }), 0, { kind: 'EMISSARIES', ideologies: ['equality'] }).error, 'no_emissaries', 'Arbiter face');
  // Not tied: name a place that is not among the winners.
  eq(op(emissaryGame(), 0, { kind: 'EMISSARIES', ideologies: ['honor'] }).error, 'not_tied', 'untied ideology');
  // A clear winner is no tie at all.
  const solo = emissaryGame();
  solo.assembly.delegates.equality[solo.players[0].profileId] = 3;
  eq(op(solo, 0, { kind: 'EMISSARIES', ideologies: ['equality'] }).error, 'no_tie', 'single winner');
});
check('EMISSARIES: the law reaches the holder through the normal law gate (Equality Research Grants)', () => {
  // Equality's Research Grants ignore the academia hand limit, so a full hand
  // can start one only while Equality is usable.
  const run = (emissary, face = 'primary') => {
    const st = emissaryGame({ face });
    st.players.forEach((p) => { p.hand = PATENTS.slice(0, 4).map((c) => c.id); p.aqua = 20; });
    let s = st;
    if (emissary) { const r = op(s, 0, { kind: 'EMISSARIES', ideologies: ['equality'] }); assert(r.ok, r.error); s = r.state; }
    return op(s, 0, { kind: 'AUCTION_START', deckType: 'thruster', useEquality: true });
  };
  const withE = run(true);
  assert(withE.ok, `Emissaries + Equality grant refused: ${withE.error}`);
  eq(run(false).error, 'hand_limit', 'no Emissaries: Equality is not usable');
  // The law lasts the holder's turn only: once the turn passes it is gone.
  const st = emissaryGame();
  const r = op(st, 0, { kind: 'EMISSARIES', ideologies: ['equality'] });
  r.state.activeIndex = 1;
  r.state.players.forEach((p) => { p.hand = PATENTS.slice(0, 4).map((c) => c.id); p.aqua = 20; p.opsRemaining = 4; });
  eq(op(r.state, 1, { kind: 'AUCTION_START', deckType: 'thruster', useEquality: true }).error, 'hand_limit', 'the other seat on its turn');
});
check('EMISSARIES: suspended by Anarchy; locked under m0+m1+m2 until a Home Bernal', () => {
  eq(op(emissaryGame({ anarchy: true }), 0, { kind: 'EMISSARIES', ideologies: ['equality'] }).error, 'no_emissaries', 'Anarchy');
  eq(op(emissaryGame({ game: PROMO }), 0, { kind: 'EMISSARIES', ideologies: ['equality'] }).error, 'no_emissaries', 'promo, no Home Bernal');
  assert(op(emissaryGame({ game: PROMO, home: true }), 0, { kind: 'EMISSARIES', ideologies: ['equality'] }).ok, 'promo + Home Bernal');
});

// ---- ARBITER (African Union, black) ----
// "At the start of your turn you may perform a vote tally. Your vote tallies
// may treat your delegates as 2 delegates each."
// Seat 0 holds 1 Honor delegate; seat 1 holds 2 Freedom. Star on Freedom. A
// doubled tally ties Honor with Freedom, so the Arbiter may pull the star to
// Honor; a plain tally leaves Freedom the clear winner.
function arbiterGame({ face = 'secondary', anarchy = false, game = { m0: true }, home = false } = {}) {
  const st = playing(2, game);
  const me = only(st, 0, 'crew_african_union_space_directorate', face);
  if (home) anchorHome(me);
  st.anarchy = anarchy;
  const [a, b] = st.players.map((p) => p.profileId);
  for (const k of Object.keys(st.assembly.delegates)) st.assembly.delegates[k] = {};
  st.assembly.delegates.honor = { [a]: 1 };
  st.assembly.delegates.freedom = { [b]: 2 };
  st.activeLawStar = 'freedom';
  return st;
}
check('ARBITER: a start-of-turn tally with doubled delegates moves the star; Emissaries face cannot', () => {
  const r = op(arbiterGame(), 0, { kind: 'ARBITER_TALLY', star: 'honor' });
  assert(r.ok, `Arbiter tally refused: ${r.error}`);
  eq(r.state.activeLawStar, 'honor', 'star after the doubled tally');
  eq(r.state.players[0].opsRemaining, 4, 'the tally spent an operation');
  assert(/Arbiter/.test(r.log), 'log');
  const single = op(arbiterGame(), 0, { kind: 'ARBITER_TALLY', double: false, star: 'honor' });
  assert(single.ok, single.error);
  eq(single.state.activeLawStar, 'freedom', 'an undoubled tally leaves Freedom the clear winner');
  eq(op(arbiterGame({ face: 'primary' }), 0, { kind: 'ARBITER_TALLY', star: 'honor' }).error, 'no_arbiter', 'Emissaries face');
});
check('ARBITER: only at the start of the turn, once per turn', () => {
  const r = op(arbiterGame(), 0, { kind: 'ARBITER_TALLY', star: 'honor' });
  eq(op(r.state, 0, { kind: 'ARBITER_TALLY', star: 'honor' }).error, 'already_tallied', 'second tally');
  const st = arbiterGame();
  st.turnActions = [{ kind: 'INCOME', payload: {} }];
  eq(op(st, 0, { kind: 'ARBITER_TALLY', star: 'honor' }).error, 'not_turn_start', 'after another action');
});
check('ARBITER: the holder\'s Fundraise tally may count delegates twice; nobody else\'s can', () => {
  const fr = (face, dbl) => op(arbiterGame({ face }), 0, { kind: 'FUNDRAISE', star: 'honor', ...(dbl ? { arbiterDouble: true } : {}) });
  const ok = fr('secondary', true);
  assert(ok.ok, `doubled fundraise: ${ok.error}`);
  eq(ok.state.activeLawStar, 'honor', 'star after the doubled fundraise');
  eq(fr('secondary', false).state.activeLawStar, 'freedom', 'a plain fundraise leaves Freedom the clear winner');
  eq(fr('primary', true).error, 'no_arbiter', 'Emissaries face asking to double');
});
check('ARBITER: suspended by Anarchy; locked under m0+m1+m2 until a Home Bernal', () => {
  eq(op(arbiterGame({ anarchy: true }), 0, { kind: 'ARBITER_TALLY', star: 'honor' }).error, 'no_arbiter', 'Anarchy');
  eq(op(arbiterGame({ game: PROMO }), 0, { kind: 'ARBITER_TALLY', star: 'honor' }).error, 'no_arbiter', 'promo, no Home Bernal');
  assert(op(arbiterGame({ game: PROMO, home: true }), 0, { kind: 'ARBITER_TALLY', star: 'honor' }).ok, 'promo + Home Bernal');
});

// ---- POWER BROKERS (The Sea Peoples, black) ----
// "After you pay FINAO, gain 1 Aqua per Seniority Disk on the Assembly (max
// half FINAO paid, round down)."
// Same one-hazard FINAO route the Open Source FINAO check flies.
function brokerMove({ face = 'secondary', disks = 3, anarchy = false, game = { m0: true }, home = false, idx = 0 } = {}) {
  const st = playing(2, game);
  st.activeIndex = idx;
  const me = st.players[idx];
  only(st, idx, 'crew_the_sea_peoples', face);
  if (home) anchorHome(me);
  st.anarchy = anarchy;
  for (const k of Object.keys(st.assembly.seniority)) st.assembly.seniority[k] = 0;
  st.assembly.seniority.honor = disks;
  me.rocket.siteId = 'lag-m0sea';
  me.rocket.stack = [{ id: SOLAR_PUSH, kind: 'patent', face: 'primary' }];
  me.rocket.activeThrusterId = SOLAR_PUSH;
  me.rocket.tank = 12;
  me.aqua = 30;
  const r = op(st, idx, { kind: 'MOVE', hazardPay: true, segments: [{ from: 'lag-m0sea', to: 'burn-5eobz', burns: 1, turn: 1 }, { from: 'burn-5eobz', to: 'lag-c3cha', burns: 0, turn: 1 }] });
  assert(r.ok, `move refused: ${r.error}`);
  return { net: 30 - r.state.players[idx].aqua, log: r.log, others: r.state.players.filter((_, i) => i !== idx).map((p) => p.aqua) };
}
check('POWER BROKERS: FINAO pays back 1 aqua per Seniority Disk, capped at half the FINAO', () => {
  const pb = brokerMove({ disks: 1 });
  const ctl = brokerMove({ face: 'primary', disks: 1 });   // Courier face
  eq(ctl.net - pb.net, 1, 'one disk rebate');
  assert(/Power Brokers/.test(pb.log), 'rebate missing from the log');
  const big = brokerMove({ disks: 9 });
  const cap = Math.floor(ctl.net / 2);
  eq(ctl.net - big.net, cap, `nine disks capped at half of ${ctl.net} FINAO`);
  eq(brokerMove({ disks: 0 }).net, ctl.net, 'no disks, no rebate');
  return `FINAO ${ctl.net}: 1 disk back 1, 9 disks back ${cap}`;
});
check('POWER BROKERS: suspended by Anarchy; locked under m0+m1+m2 until a Home Bernal', () => {
  const ctl = brokerMove({ face: 'primary', disks: 2 }).net;
  eq(brokerMove({ disks: 2, anarchy: true }).net, ctl, 'Anarchy');
  eq(brokerMove({ disks: 2, game: PROMO }).net, brokerMove({ face: 'primary', disks: 2, game: PROMO }).net, 'promo, no Home Bernal');
  assert(brokerMove({ disks: 2, game: PROMO, home: true }).net < brokerMove({ face: 'primary', disks: 2, game: PROMO, home: true }).net, 'promo + Home Bernal pays');
});

// ---- HEROIC (Galahad Group, white) ----
// "This character can carry any number of glory chits. You may lobby honor
// without losing a delegate."
function heroicLobby({ face = 'primary', ideology = 'honor', anarchy = false, game = { m0: true }, home = false } = {}) {
  const st = playing(2, game);
  const me = only(st, 0, 'crew_galahad_group', face);
  if (home) anchorHome(me);
  st.anarchy = anarchy;
  st.activeLawStar = 'centrist';
  me.aqua = 5;
  const pid = me.profileId;
  st.assembly.delegates[ideology] = { ...(st.assembly.delegates[ideology] || {}), [pid]: 1 };
  const r = op(st, 0, { kind: 'LOBBY', ideology });
  assert(r.ok, `lobby refused: ${r.error}`);
  return (r.state.assembly.delegates[ideology] || {})[pid] | 0;
}
check('HEROIC: Galahad lobbies honor and keeps the delegate; Quest face loses it; other laws cost one', () => {
  eq(heroicLobby({}), 1, 'Heroic honor lobby');
  eq(heroicLobby({ face: 'secondary' }), 0, 'Quest face honor lobby');
  eq(heroicLobby({ ideology: 'freedom' }), 0, 'Heroic freedom lobby');
});
check('HEROIC lobby: suspended by Anarchy; locked under m0+m1+m2 until a Home Bernal', () => {
  eq(heroicLobby({ anarchy: true }), 0, 'Anarchy');
  eq(heroicLobby({ game: PROMO }), 0, 'promo, no Home Bernal');
  eq(heroicLobby({ game: PROMO, home: true }), 1, 'promo + Home Bernal');
});
// Glory: the Galahad crew already carries a chit and loads a second at a fresh
// zone. Any other lone Human would be refused glory_carry_full.
function heroicGlory({ face = 'primary', anarchy = false, game = {}, home = false, crewId = 'crew_galahad_group' } = {}) {
  const st = playing(2, game);
  const me = only(st, 0, 'crew_galahad_group', face);
  if (home) anchorHome(me);
  st.anarchy = anarchy;
  st.players.forEach((p) => { p.rocket.stack = []; p.leo = []; });
  me.rocket.siteId = 'mars-north-pole';
  me.rocket.stack = [{ id: SOLAR_PUSH, kind: 'patent', face: 'primary' }, { id: crewId, kind: 'crew', face }];
  me.glory.visited = ['Earth'];
  me.glory.chits = [{ zone: 'Earth', earnedTurn: 0, crewId }];
  return op(st, 0, { kind: 'LOAD_GLORY' });
}
check('HEROIC: the Galahad crew carries a second glory chit; Quest face cannot', () => {
  const h = heroicGlory({});
  assert(h.ok, `Heroic load refused: ${h.error}`);
  eq(h.state.players[0].glory.chits.length, 2, 'chits carried');
  assert(h.state.players[0].glory.chits.every((c) => c.crewId === 'crew_galahad_group'), 'both chits ride the Galahad crew');
  eq(heroicGlory({ face: 'secondary' }).error, 'glory_carry_full', 'Quest face');
});
check('HEROIC glory: suspended by Anarchy; locked under m0+m1+m2 until a Home Bernal', () => {
  eq(heroicGlory({ anarchy: true }).error, 'glory_carry_full', 'Anarchy');
  eq(heroicGlory({ game: PROMO }).error, 'glory_carry_full', 'promo, no Home Bernal');
  assert(heroicGlory({ game: PROMO, home: true }).ok, 'promo + Home Bernal');
});










// ---------------------------------------------------------------- end promo group B








// ================================================================ promo group C
// economy and cards: SHUTTLES, ISO-SHUTTLES, TRADE PORT, PIGGYBACK, THERMAL LABS, TAILINGS REMINING
// (group C checks go here)










// ---------------------------------------------------------------- end promo group C








// ================================================================ promo group D
// colonists and factories: REFUGEE, IMMIGRANT, QUEST, SITDOWN
// (group D checks go here)










// ---------------------------------------------------------------- end promo group D








// ---- inventory: in-scope faces with no engine rule ----
// Not a behaviour test: lists every in-scope face whose privilege key appears
// nowhere in the engine, so the audit doc's "not implemented" column can be
// re-derived. Promo faces tagged requiresModule M4 / M5 are out of scope.
import * as nodeFs from 'node:fs';
{
  const src = nodeFs.readFileSync(new URL('../server/game/engine.js', import.meta.url), 'utf8');
  // Module tags are PER FACE (data/crew.js, 9084b63): each side is judged on
  // its own ability text. A card-level tag is still honoured as a fallback.
  const missing = [];
  for (const c of [...CREW, ...PROMO_CREW]) for (const f of ['primary', 'secondary']) {
    if (c.faces[f].requiresModule || c.requiresModule) continue;
    const k = pkey(c.faces[f].bonus);
    // Baltimore Gun Club is wired by card id (colocation), not by key.
    if (c.id === 'crew_baltimore_gun_club') continue;
    if (!src.includes(`'${k}'`)) missing.push(`${c.faces[f].name} / ${k}`);
  }
  console.log(`  info  ${missing.length} in-scope faces have no engine rule:`);
  for (const m of missing) console.log(`          - ${m}`);
}

// ---------------------------------------------------------------- report

console.log('');
console.log(`${results.filter((r) => r.status === 'ok').length} ok, ${failures} failed, ${knownBugs} known bug(s), ${fixed} fixed`);
if (failures) process.exit(1);
