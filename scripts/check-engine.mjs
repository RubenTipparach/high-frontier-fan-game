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
import { SIREN_BUSTED_SITES } from '../data/sirens.js';

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
  const roster = [
    { profileId: 1, name: 'P1', seat: 1 },
    { profileId: 2, name: 'P2', seat: 2 },
  ];
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
function sirensGame() {
  let st = startedGame({ sirens: true });
  // Re-pick with an explicit species: seat 0 Earthling, everyone else Siren.
  st.draftPhase = 'crew';
  st.players.forEach((p, i) => { p.faction = null; });
  st.players.forEach((p, i) => {
    const card = CREW.find((c) => c.color === p.color) || CREW[i];
    const r = applyOperation(st, {
      kind: 'PICK_CREW', cardId: card.id, face: 'primary',
      species: i === 0 ? 'earthling' : 'siren',
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
  let st = sirensGame();
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
  const sell = applyOperation(own.state, { kind: 'AUCTION_SELL', buyerId: earth.profileId },
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
