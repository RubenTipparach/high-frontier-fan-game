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
import { applyOperation } from '../server/game/engine.js';
import { CREW } from '../data/crew.js';
import { PATENTS } from '../data/patents.js';
import { scorePlayer } from '../data/endgame-scoring.js';
import { siteBySlug } from '../server/game/planner-graph.js';
import { SIREN_BUSTED_SITES, splitDeckForSoloSpecies, SIREN_SOLO_SPECTRALS } from '../data/sirens.js';
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
function sirensGame(species = ['earthling', 'siren']) {
  let st = startedGame({ sirens: true, seats: species.length });
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

// Zero bleed-through: a normal room carries no variant keys at all.
check('a normal game carries no variant state', () => {
  const st = startedGame();
  for (const key of ['sirens', 'hermes', 'hotSeat', 'tutorial', 'sirenDecks', 'sirenColonistQueue']) {
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
