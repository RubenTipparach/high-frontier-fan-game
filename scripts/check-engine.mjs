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
import { applyOperation, liveScoreboard, bernalVpByPlayer, bernalRowsByPlayer, assemblyVpByPlayer } from '../server/game/engine.js';
import { BERNALS } from '../data/bernals.js';
import { lineOfSightSites, zoneOfSlug, hazardKind } from '../server/game/planner-graph.js';
import { CREW } from '../data/crew.js';
import { COLONISTS_BY_ID } from '../data/colonists.js';
import { PATENTS } from '../data/patents.js';
import { scorePlayer } from '../data/endgame-scoring.js';
import { siteBySlug } from '../server/game/planner-graph.js';
import { SIREN_BUSTED_SITES, splitDeckForSoloSpecies, SIREN_SOLO_SPECTRALS } from '../data/sirens.js';
import { turnsToImpact, TURNS_PER_CYCLE, HERMES_ROUNDS } from '../data/hermes.js';
import { resolveSupportChain, unmetRequirements } from '../data/support-chain.js';
import { elevatorPairKey } from '../data/space-elevators.js';
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
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

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

// An all-Siren table has nobody to hide the library from, so it keeps ONE deck.
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
  return 'no split';
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
check('a Uranian landing satisfies the Board for that cycle', () => {
  let st = startedGame({ sirens: true, seats: 1 });
  st.draftPhase = 'crew';
  const p0 = st.players[0];
  p0.faction = null;
  const card = CREW.find((c) => c.color === p0.color) || CREW[0];
  st = applyOperation(st, { kind: 'PICK_CREW', cardId: card.id, face: 'primary', species: 'siren' },
    { profileId: p0.profileId }).state;
  const me = st.players[0];
  // Stand a crew on a Uranian moon (not the aerostat).
  me.rocket.siteId = 'setebos';
  me.rocket.stack = [{ id: me.faction.cardId, kind: 'crew', face: 'primary' }];
  const r = applyOperation(st, { kind: 'END_TURN' }, { profileId: me.profileId });
  assert(r.ok, `END_TURN rejected: ${r.error}`);
  assert(r.state.sirenKpiFreeCycle === 1,
    `the landing did not mark a free cycle (got ${r.state.sirenKpiFreeCycle})`);
  assert(/First contact/.test(r.log), `the landing was not logged: ${r.log}`);
  return 'cycle 1 free';
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
  const soloSiren = () => {
    let st = startedGame({ sirens: true, seats: 1 });
    st.draftPhase = 'crew';
    const p0 = st.players[0];
    p0.faction = null;
    const card = CREW.find((c) => c.color === p0.color) || CREW[0];
    st = applyOperation(st, { kind: 'PICK_CREW', cardId: card.id, face: 'primary', species: 'siren' },
      { profileId: p0.profileId }).state;
    return st;
  };
  const attempt = (siteId, opts = {}) => {
    const st = soloSiren();
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
  return 'D/V only, human required';
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
