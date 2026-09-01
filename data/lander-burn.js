// Lander-burn detection (HF4 H5e / H6c, "High Gravity Limit"). A "lander burn
// space" is a planner node of type 'burn' (the magenta burn pads in a gravity
// well). A Spacecraft (rocket OR freighter) may NOT use factory-assist to move
// INTO or OUT OF one: it needs real net thrust greater than the site size, an
// aerobrake landing (H6b), or an acetylene rocketplane liftoff (H6c). A gravity
// well is unavoidable, so "this maneuver crosses a lander burn" reduces to a
// per-site property: does the site sit behind a burn pad in its own well?
//
// Walk OUT from the site through the well's visual filler (decorative nodes) and
// report whether a burn pad is reachable before escaping the well. Orbital nodes
// (lagrange / hohmann transfers) and any OTHER body (a site) are the well
// boundary and are never traversed, so the walk never leaks into a neighbouring
// well. Ceres / Deimos / Phobos sit directly behind their pad; Mars / Luna /
// Ganymede surfaces reach theirs one or two decorative hops down the descent.
//
// Pure + shared (the data/support-chain.js + data/fuel-graph.js pattern) so the
// client land/liftoff gate and the server one resolve IDENTICALLY off whatever
// id space each side passes in:
//   id          the site node id (server slug OR client planner-point id)
//   neighborsOf (id) => id[]     adjacent node ids in the SAME id space
//   typeOf      (id) => string   node type ('site'|'burn'|'lagrange'|'decorative'|'hohmann'|...)
export function isLanderBurnSite(id, neighborsOf, typeOf, isLanderOf = null) {
  if (!id) return false;
  const seen = new Set([String(id)]);
  const stack = (neighborsOf(id) || []).map(String);
  let guard = 0;
  while (stack.length && guard++ < 256) {
    const n = stack.pop();
    if (seen.has(n)) continue;
    seen.add(n);
    const t = typeOf(n);
    // A LANDER burn, not any burn. This returned true for every burn pad in the
    // well, so a site whose only exit is an ordinary burn read as sitting behind
    // lander burns - Achilles (size 2, one neighbour, the untagged burn-b23t0)
    // was refused liftoff AND denied factory assist, which is only barred
    // through a lander burn (reported 2026-08-08). `isLanderOf` is the node-tag
    // predicate; without it the old any-burn reading is kept so a caller that
    // has not been updated behaves as before.
    if (t === 'burn') {
      if (!isLanderOf) return true;
      if (isLanderOf(n)) return true;
      continue;              // an ordinary pad is not the well's lander burn
    }
    // Only the well's decorative filler is walked through; the orbital boundary
    // (lagrange / hohmann) and other bodies (site) stop the walk so it stays
    // inside this site's own gravity well.
    if (t === 'decorative') {
      for (const m of (neighborsOf(n) || [])) {
        const ms = String(m);
        if (!seen.has(ms)) stack.push(ms);
      }
    }
  }
  return false;
}

// H6b + H5e: did this route ACTUALLY come down a parachute corridor?
//
// The aerobrake waiver on the LANDING thrust gate belongs to a ship that FLEW
// the corridor, not to every ship that happens to be landing on an atmospheric
// site. A site can have BOTH approaches - Mars Arsia Mons Caves is reached down
// its aerobrake OR through burn-r1gov, its lander burn - so keying the waiver on
// "is the destination aerobrake-landable" let a ship drop straight through the
// lander burn on no thrust at all and call it a parachute. Thrust requirements
// always apply to lander burn nodes (user 2026-08-07).
//
// So read the ROUTE: an aerobrake must have been entered, and NOTHING after it
// may be a lander burn.
//
//   fromIsAero  the ship BEGAN this move standing in an aerobrake corridor. That
//               ship is still descending - ending a turn in the corridor to
//               air-eat is legal and useful - so its aerobrake counts even
//               though it is an origin rather than an arrival. Sorted before
//               every arrival, so a lander burn later in the route still cancels
//               it, exactly as one mid-route does.
//   arrivals    the nodes entered this turn, in order.
//   isAeroOf    (id) => true when that node is an aerobrake corridor.
//   isLanderOf  (id) => true when that node is a lander burn.
//
// Pure + id-space agnostic like the walks above, so the server movers and the
// client's land gates reach ONE verdict instead of three copies drifting apart -
// which is exactly what happened: the rocket's server gate was fixed and the
// freighter's, the Bernal's and all three client gates were left behind.
export function routeFlewAerobrake({ fromIsAero = false, arrivals = [], isAeroOf = null, isLanderOf = null } = {}) {
  const NO_AERO = -1;
  const AERO_AT_ORIGIN = -0.5;   // sorts before every arrival index, but is "seen"
  let lastAero = fromIsAero ? AERO_AT_ORIGIN : NO_AERO;
  let lastLander = NO_AERO;
  (arrivals || []).forEach((id, i) => {
    if (isAeroOf && isAeroOf(id)) lastAero = i;
    if (isLanderOf && isLanderOf(id)) lastLander = i;
  });
  return lastAero > NO_AERO && lastAero > lastLander;
}

// Does the site sit behind a HAZARDOUS lander burn - a burn pad in its own well
// that carries a landing hazard (a skull on the pad)? Same well walk as
// isLanderBurnSite, but reports whether a reached burn pad (or the decorative
// descent to it) is hazardous. Drives the Individuality end-game award (Module 0:
// +1 VP per token on a Site with hazardous lander burns). `hazardOf(id)` is
// truthy when that node has a landing hazard.
export function siteHasHazardousLanderBurn(id, neighborsOf, typeOf, hazardOf) {
  if (!id) return false;
  const seen = new Set([String(id)]);
  const stack = (neighborsOf(id) || []).map(String);
  let guard = 0;
  while (stack.length && guard++ < 256) {
    const n = stack.pop();
    if (seen.has(n)) continue;
    seen.add(n);
    const t = typeOf(n);
    if (t === 'burn') { if (hazardOf(n)) return true; continue; }
    if (t === 'decorative') {
      if (hazardOf(n)) return true;
      for (const m of (neighborsOf(n) || [])) {
        const ms = String(m);
        if (!seen.has(ms)) stack.push(ms);
      }
    }
  }
  return false;
}
