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
export function isLanderBurnSite(id, neighborsOf, typeOf) {
  if (!id) return false;
  const seen = new Set([String(id)]);
  const stack = (neighborsOf(id) || []).map(String);
  let guard = 0;
  while (stack.length && guard++ < 256) {
    const n = stack.pop();
    if (seen.has(n)) continue;
    seen.add(n);
    const t = typeOf(n);
    if (t === 'burn') return true;
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
