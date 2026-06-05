// Raygun line-of-sight reachability. PURE + SHARED by the client scan
// (js/game/scan.js) and the server engine (server/game/planner-graph.js)
// so BOTH compute the SAME set of prospect-able sites. A divergent second
// model is exactly what made the client offer a raygun prospect the server
// then rejected as "out of range" - the same drift the movement path warns
// against. One model, two callers.
//
// A raygun beam leaves the rocket's site and travels through "transparent"
// waypoints only - sparse hazard belts, lander burnspaces, decorative bend
// points - stopping at the first real site it hits. Plain burns, Hohmann
// transfers, and lagrange points BLOCK the beam; aerostat sites bounce it
// (dense atmosphere). There is no hop cap: the transparent-only rule bounds
// the beam to its local neighbourhood on its own.
//
// Callers pass graph accessors so the same walk runs over the client's
// {byId, neighbors} graph AND the server's slug tables:
//   neighbors(id) -> iterable of neighbour ids
//   nodeOf(id)    -> { type, hazard, landing, name } | null
// The relevant node fields (type / hazard / landing / name) read the SAME
// on both sides: the planner JSON's raw type is preserved for waypoints on
// both, and aerostat sites carry "Aerostat" in their name everywhere.

// A waypoint the beam can pass THROUGH without being stopped. Everything
// else (plain burn / hohmann / lagrange) blocks.
export function isWaypointTransparentToRaygun(point) {
  if (!point) return false;
  const t = point.type;
  if (t === 'radhaz') return true;       // radiation belt / hohmann hazard: sparse
  if (t === 'decorative') return true;   // routing bend point, not a body
  if (point.hazard) return true;         // any hazard-tagged waypoint
  // A burnspace that is ALSO a landing site (numeric landing > 0) is the
  // site itself, so the beam reaches it rather than being blocked.
  if (t === 'burn' && typeof point.landing === 'number' && point.landing > 0) return true;
  return false;
}

// A real site that STOPS the beam without becoming a valid target - the
// aerostat case (dense atmosphere bounces the ray). Decoratives are never
// sites.
export function isSiteBlockingRaygun(point) {
  if (!point) return false;
  if (point.type === 'decorative') return false;
  if (typeof point.name === 'string' && /aerostat/i.test(point.name)) return true;
  return false;
}

// A "site" for prospect purposes: any node that isn't a routing waypoint.
// Works on BOTH the client's mapped body types (planet / moon / asteroid /
// comet / dwarf / site ...) and the server's raw 'site' type, because both
// fall outside this waypoint blocklist.
export function isRaygunSiteNode(point) {
  if (!point) return false;
  const t = point.type;
  if (t === 'burn' || t === 'hohmann' || t === 'lagrange'
      || t === 'radhaz' || t === 'decorative' || t === 'venus') {
    return false;
  }
  return true;
}

// BFS the raygun's reachable graph from `start`. Returns a Set of site ids
// the beam can scan (the origin is excluded; sites are terminal; only
// transparent waypoints are traversed; aerostats stop the beam without
// being added).
export function raygunReachable(start, { neighbors, nodeOf } = {}) {
  const out = new Set();
  if (start == null || typeof neighbors !== 'function' || typeof nodeOf !== 'function') {
    return out;
  }
  const visited = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const u = queue.shift();
    for (const v of neighbors(u) || []) {
      if (visited.has(v)) continue;
      visited.add(v);
      const p = nodeOf(v);
      if (!p) continue;
      if (isRaygunSiteNode(p)) {
        // Real site: a target unless an aerostat bounces the beam. Either
        // way the ray stops here (you've hit a body).
        if (!isSiteBlockingRaygun(p)) out.add(v);
        continue;
      }
      // Waypoint: keep tracing only if the beam passes through it.
      if (isWaypointTransparentToRaygun(p)) queue.push(v);
    }
  }
  return out;
}
