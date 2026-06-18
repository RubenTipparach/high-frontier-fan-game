// Which landing sites sit next to an aerobrake corridor (the 🪂 parachute
// symbol). A site you can parachute onto: a real site reachable from an
// aerobrake-tagged node within `maxHops`, walking OUT through transparent
// waypoints (lagranges / decoratives / burns) but stopping at the first real
// site. That set is the "parachute next to this site" rule - landing there is
// allowed regardless of thrust / site size, because you descend by parachute.
//
// Pure + id-space-agnostic so the client (planner-id space) and the server
// (slug space, slug == id2) compute the SAME set from the SAME node-tags +
// graph: each caller passes its own `neighborsOf` / `isSiteId`, and the result
// is a Set in whatever id space those use. The server slug IS the client id2,
// so both Sets agree once the client maps its planner ids back to id2.
//
// maxHops = 3 is tuned against the published board: it captures every aerostat
// (Venus / Titan / Saturn / Neptune / Uranus) and the canonical atmospheric
// bodies (Mars / Pluto / Triton) while leaving airless bodies (Ceres /
// Mercury / Luna / the Galileans) gated, since they have no corridor to
// parachute through.
export function aerobrakeLandableSet({ aeroIds, neighborsOf, isSiteId, maxHops = 3 }) {
  const out = new Set();
  for (const a of aeroIds) {
    const seen = new Set([a]);
    let frontier = [a];
    for (let hop = 0; hop < maxHops && frontier.length; hop++) {
      const next = [];
      for (const f of frontier) {
        for (const nb of neighborsOf(f)) {
          if (seen.has(nb)) continue;
          seen.add(nb);
          // A real site is a landing target the corridor serves: mark it and
          // stop (don't tunnel through one body to reach the next).
          if (isSiteId(nb)) out.add(nb);
          else next.push(nb);
        }
      }
      frontier = next;
    }
  }
  return out;
}
