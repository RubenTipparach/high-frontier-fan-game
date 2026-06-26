// Nodes sheltered from Solar Flares (K2d) WITHOUT being radiation-belt hazards
// themselves. A radiation-belt node already shields a stack from a flare (the
// belt's own shadow, see server/game/engine.js#applyFlareToPlayer); these are
// transit spaces that sit INSIDE a planet's belt, so a stack caught there rides
// out the flare the same way even though the node is a plain burn / lagrange.
//
// burn-ue3lc sits inside Earth's belt, so it is flare-safe (user 2026-06-26).
// Pure data (no DOM / node imports) so the server engine and the client agree.
// Keyed by a node's server slug (id2).
export const FLARE_SHELTERED = new Set([
  'burn-ue3lc',   // inside Earth's belt
]);

export function isFlareSheltered(slug) {
  return FLARE_SHELTERED.has(String(slug));
}
