// Endgame scoring - PURE, shared by the client (live scoring tab + the
// final-score modal) AND the server (authoritative final scores), the same way
// data/support-chain.js and data/fuel-graph.js are shared. This is the SINGLE
// source of truth for the rulebook-M2b endgame VP math, so the live panel, the
// game-over modal, and the server can never drift.
//
// Score model (user-confirmed):
//   - Factories price off the EXPLOITATION TRACK: the Nth factory of a spectral
//     ANYWHERE on the map sells at 8 / 5 / 4 (4 thereafter). Each player scores
//     that current market price for every factory they own of that spectral, so
//     a rival building your spectral trims your price. This is the FACTORY line;
//     it carries NO token VP (the token is its own category below).
//   - TOKENS: a flat +1 VP per scoring token the player owns - each FACTORY,
//     each COLONY DOME, each CLAIM disc, and the FIRST-PLAYER token. This is its
//     own category so the breakdown is legible (user 2026-06-22). Outposts and
//     the rocket carry no token VP.
//   - COLONIES score a LOCATION bonus ABOVE the dome token: astrobiology +1,
//     submarine +2, Bernal +2 (not implemented yet), a plain colony +0. The
//     dome's flat +1 is in the token line, so an astrobiology colony is worth 2
//     total (1 token + 1 site) and a submarine colony 3 total (1 token + 2),
//     split across the Tokens + Colonies categories.
//   - Career GLORY chit VP.
//   - M2 ANCHORED BERNAL VP (passed in as bernalVp; the map-adjacency math lives
//     server-side): a Home Bernal is a flat 6 VP, any other anchored (Dirtside)
//     Bernal scores its Dirtside Hydration, plus the specific promoted-Bernal
//     bonuses (rulebook 2Bd).
//   - M0 only: delegate cubes + the winning-ideology award (passed in; the
//     assembly math lives server-side).
//
// Callers normalise their own state into the plain shapes below, so this module
// imports nothing and touches no DOM / db.

export const SPECTRAL_DIMINISHING_SCHEDULE = [8, 5, 4];
// Total per-colony VP by location (token + site bonus combined). Kept for any
// reader that wants the full value; the scorer below splits it into the token
// (a flat 1 per dome) and the COLONY_LOCATION_BONUS (the rest).
export const COLONY_VP = { astrobiology: 2, submarine: 3, bernal: 3, other: 1 };
// The site bonus ABOVE the dome's flat +1 token (COLONY_VP minus 1).
export const COLONY_LOCATION_BONUS = { astrobiology: 1, submarine: 2, bernal: 2, other: 0 };
export const SPECTRALS = ['C', 'S', 'M', 'V', 'D', 'H'];
// V9 Sirens dome values (see the sirenDomes branch in scorePlayer). Duplicated
// from data/sirens.js as a plain number rather than imported, to keep this
// module dependency-free the way its header promises.
const SIREN_DOME_VP_SOLAR = 3;

// Market price for the Nth factory of a spectral (1-indexed by the GLOBAL count
// of that spectral's factories). 0 when there are none.
export function spectralPrice(globalCount) {
  if (!Number.isFinite(globalCount) || globalCount <= 0) return 0;
  const last = SPECTRAL_DIMINISHING_SCHEDULE[SPECTRAL_DIMINISHING_SCHEDULE.length - 1];
  return SPECTRAL_DIMINISHING_SCHEDULE[globalCount - 1] != null
    ? SPECTRAL_DIMINISHING_SCHEDULE[globalCount - 1]
    : last;
}

// Free Market (rulebook I3b) sale value for a Black-Side LEO card of a given
// spectral type: the Exploitation Track stock price for that spectral. With NO
// factories of the type anywhere, the card sells for 10 aqua; otherwise the
// diminishing schedule (8 / 5 / 4, 4 thereafter) by the GLOBAL factory count.
export function freeMarketBlackSideValue(globalCount) {
  if (!Number.isFinite(globalCount) || globalCount <= 0) return 10;
  return spectralPrice(globalCount);
}

// Normalise a colony's location type to a COLONY_VP key.
export function colonyVpType(type) {
  return (type && COLONY_VP[type] != null) ? type : 'other';
}

// Score ONE player.
//   factories:   ALL factories on the map, [{ ownerId, spectralType }] (the
//                global count drives each spectral's market price).
//   ownColonies: this player's colonies, [{ type }] (type already resolved to
//                astrobiology | submarine | bernal | other | null).
//   claims / outposts: this player's counts. rocket: 0 or 1. glory: chit VP.
//   firstPlayer: 1 if this player holds the first-player token, else 0.
//   cubeVp / awardVp: M0 assembly VP (0 in a non-M0 game).
// Returns the full breakdown the UI renders + the grand total.
export function scorePlayer({
  ownerId,
  factories = [],
  ownColonies = [],
  claims = 0,
  outposts = 0,
  rocket = 0,
  // M1: Mobile Factories IN TRANSIT (a promoted Freighter's cubes not currently
  // sitting on one of this player's Claims, plus the Freighter figure itself
  // when it is off-Claim). They are NOT Factories - they earn no Exploitation
  // Track stock price - but they are still tokens in the player's colour on the
  // map, so each is worth its flat 1 VP. A cube ON a Claim is a real Factory
  // and arrives in `factories` instead. 0 in a non-M1 game.
  mobileFactories = 0,
  firstPlayer = 0,
  glory = 0,
  cubeVp = 0,
  awardVp = 0,
  futuresVp = 0,
  bernalVp = 0,
  // V9 Sirens: score this player's colony domes on the Sirenian scale (see
  // below). False in every other game, which leaves the scorer byte-identical.
  sirenDomes = false,
} = {}) {
  const globalBySpec = {};
  for (const f of factories) {
    const t = (f && f.spectralType) || 'C';
    globalBySpec[t] = (globalBySpec[t] || 0) + 1;
  }
  const own = factories.filter((f) => f && f.ownerId === ownerId);
  const ownBySpec = {};
  for (const f of own) {
    const t = f.spectralType || 'C';
    ownBySpec[t] = (ownBySpec[t] || 0) + 1;
  }
  // Per-spectral rows the factory chart renders (only spectrals the player owns).
  // A Factory connected by a Space Elevator scores DOUBLE its stock price at
  // endgame (rulebook M2b), regardless of who built the elevator - so each
  // factory is priced individually and the connected ones count twice. The
  // caller flags them via `elevatorConnected` on the factory record; with none
  // flagged this is exactly count * price (byte-identical to the old math).
  const spectralRows = [];
  let spectralVp = 0;
  for (const spec of SPECTRALS) {
    const specFactories = own.filter((f) => (f.spectralType || 'C') === spec);
    const count = specFactories.length;
    if (!count) continue;
    const globalCount = globalBySpec[spec] || 0;
    const price = spectralPrice(globalCount);
    let vp = 0;
    let elevatorCount = 0;
    for (const f of specFactories) {
      if (f.elevatorConnected) { vp += price * 2; elevatorCount += 1; }
      else vp += price;
    }
    spectralVp += vp;
    spectralRows.push({ spec, count, globalCount, price, vp, elevatorCount });
  }

  const colonyByType = { astrobiology: 0, submarine: 0, bernal: 0, other: 0 };
  for (const c of ownColonies) colonyByType[colonyVpType(c && c.type)] += 1;
  // Colonies score only the site bonus ABOVE the dome token here; the dome's
  // flat +1 is in the token line below so it isn't double-counted.
  let colonyVp = 0;
  if (sirenDomes) {
    // V9 Sirens (M2b as amended): a Sirenian dome is worth +3 VP at a push
    // colony or an aerostat - solar energy is what the Sirens are short of and
    // those are where they get it - and +1 everywhere else, INCLUDING on a
    // Bernal. The flat +1 token below already pays the "+1 everywhere", so the
    // location bonus here is +2 at a solar site and 0 otherwise. This REPLACES
    // the COLONY_LOCATION_BONUS table rather than stacking with it.
    // The caller classifies each dome (`solar`), because deciding what counts
    // as a push colony / aerostat needs the map, and this module reads no data.
    for (const c of ownColonies) if (c && c.solar) colonyVp += SIREN_DOME_VP_SOLAR - 1;
  } else {
    for (const [t, n] of Object.entries(colonyByType)) colonyVp += n * (COLONY_LOCATION_BONUS[t] || 0);
  }

  const factoryCount = own.length;
  const colonyDomes = ownColonies.length;
  const firstPlayerToken = firstPlayer ? 1 : 0;
  const rocketToken = rocket ? 1 : 0;
  // Flat +1 per scoring TOKEN in the player's colour on the map (rulebook V.a:
  // "1 VP for each wooden or plastic Token, e.g. Rockets, Claims, Factories"):
  // each factory, each colony dome, each claim disc, the first-player token, the
  // player's rocket (spacecraft) token while it is in play, AND each Mobile
  // Factory in transit. Its own category so the breakdown reads clearly.
  // Outposts carry no token VP.
  const mobileTokens = Math.max(0, mobileFactories | 0);
  const tokenBreakdown = { factories: factoryCount, colonies: colonyDomes, claims, firstPlayer: firstPlayerToken, rocket: rocketToken, mobileFactories: mobileTokens };
  const tokenVp = factoryCount + colonyDomes + claims + firstPlayerToken + rocketToken + mobileTokens;

  // M2 Futures: the orange future stars' VP (rule 1D2a / M2b), computed by the
  // caller (static star VP plus any per-star endgame bonus after the 1D2b
  // re-check). 0 in a non-M2 game.
  const total = spectralVp + tokenVp + colonyVp + glory + cubeVp + awardVp + (futuresVp | 0) + (bernalVp | 0);
  return {
    ownerId,
    factoryCount,
    spectralRows,
    spectralVp,
    colonyByType,
    colonyCount: ownColonies.length,
    colonyVp,
    claims,
    outposts,
    rocket,
    firstPlayer: firstPlayerToken,
    tokenBreakdown,
    tokenVp,
    glory,
    cubeVp,
    awardVp,
    futuresVp: futuresVp | 0,
    bernalVp: bernalVp | 0,
    total,
  };
}
