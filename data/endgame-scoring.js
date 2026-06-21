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
//     a rival building your spectral trims your price.
//   - +1 VP per scoring TOKEN: each FACTORY and each COLONY DOME. Outposts,
//     claims, and the rocket do NOT score a token (user: outposts don't count,
//     factories and colony domes do). The colony dome's +1 rides its COLONY_VP
//     base below, so the token line here is just the factory count.
//   - COLONIES score by location type: astrobiology +1, submarine +2,
//     Bernal +2, a plain colony +1.
//   - Career GLORY chit VP.
//   - M0 only: delegate cubes + the winning-ideology award (passed in; the
//     assembly math lives server-side).
//
// Callers normalise their own state into the plain shapes below, so this module
// imports nothing and touches no DOM / db.

export const SPECTRAL_DIMINISHING_SCHEDULE = [8, 5, 4];
export const COLONY_VP = { astrobiology: 1, submarine: 2, bernal: 2, other: 1 };
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
//   cubeVp / awardVp: M0 assembly VP (0 in a non-M0 game).
// Returns the full breakdown the UI renders + the grand total.
export function scorePlayer({
  ownerId,
  factories = [],
  ownColonies = [],
  claims = 0,
  outposts = 0,
  rocket = 0,
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
  let colonyVp = 0;
  for (const [t, n] of Object.entries(colonyByType)) colonyVp += n * (COLONY_VP[t] || 1);

  const factoryCount = own.length;
  // Only factories and colony domes earn a +1 token. The colony dome's +1 is
  // already in colonyVp (its COLONY_VP base), so the factory count is the token
  // line here. Outposts, claims, and the rocket carry no token VP.
  const tokenVp = factoryCount;

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
    tokenVp,
    glory,
    cubeVp,
    awardVp,
    total,
  };
}
