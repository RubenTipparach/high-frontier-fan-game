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
//   - COLONIES score a LOCATION bonus ABOVE the dome token: astrobiology +0,
//     submarine +1, Bernal +1, a plain colony +0. The dome's flat +1 is in the
//     token line, so a submarine colony is still worth 2 total (1 token + 1
//     site), just split across two categories.
//   - Career GLORY chit VP.
//   - M0 only: delegate cubes + the winning-ideology award (passed in; the
//     assembly math lives server-side).
//
// Callers normalise their own state into the plain shapes below, so this module
// imports nothing and touches no DOM / db.

export const SPECTRAL_DIMINISHING_SCHEDULE = [8, 5, 4];
// Total per-colony VP by location (token + site bonus combined). Kept for any
// reader that wants the full value; the scorer below splits it into the token
// (a flat 1 per dome) and the COLONY_LOCATION_BONUS (the rest).
export const COLONY_VP = { astrobiology: 1, submarine: 2, bernal: 2, other: 1 };
// The site bonus ABOVE the dome's flat +1 token (COLONY_VP minus 1).
export const COLONY_LOCATION_BONUS = { astrobiology: 0, submarine: 1, bernal: 1, other: 0 };
export const SPECTRALS = ['C', 'S', 'M', 'V', 'D', 'H'];

// Market price for the Nth factory of a spectral (1-indexed by the GLOBAL count
// of that spectral's factories). 0 when there are none.
export function spectralPrice(globalCount) {
  if (!Number.isFinite(globalCount) || globalCount <= 0) return 0;
  const last = SPECTRAL_DIMINISHING_SCHEDULE[SPECTRAL_DIMINISHING_SCHEDULE.length - 1];
  return SPECTRAL_DIMINISHING_SCHEDULE[globalCount - 1] != null
    ? SPECTRAL_DIMINISHING_SCHEDULE[globalCount - 1]
    : last;
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
  firstPlayer = 0,
  glory = 0,
  cubeVp = 0,
  awardVp = 0,
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
  const spectralRows = [];
  let spectralVp = 0;
  for (const spec of SPECTRALS) {
    const count = ownBySpec[spec] || 0;
    if (!count) continue;
    const globalCount = globalBySpec[spec] || 0;
    const price = spectralPrice(globalCount);
    const vp = count * price;
    spectralVp += vp;
    spectralRows.push({ spec, count, globalCount, price, vp });
  }

  const colonyByType = { astrobiology: 0, submarine: 0, bernal: 0, other: 0 };
  for (const c of ownColonies) colonyByType[colonyVpType(c && c.type)] += 1;
  // Colonies score only the site bonus ABOVE the dome token here; the dome's
  // flat +1 is in the token line below so it isn't double-counted.
  let colonyVp = 0;
  for (const [t, n] of Object.entries(colonyByType)) colonyVp += n * (COLONY_LOCATION_BONUS[t] || 0);

  const factoryCount = own.length;
  const colonyDomes = ownColonies.length;
  const firstPlayerToken = firstPlayer ? 1 : 0;
  // Flat +1 per scoring token: factories, colony domes, claim discs, and the
  // first-player token. Its own category so the breakdown reads clearly.
  // Outposts and the rocket carry no token VP.
  const tokenBreakdown = { factories: factoryCount, colonies: colonyDomes, claims, firstPlayer: firstPlayerToken };
  const tokenVp = factoryCount + colonyDomes + claims + firstPlayerToken;

  const total = spectralVp + tokenVp + colonyVp + glory + cubeVp + awardVp;
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
    total,
  };
}
