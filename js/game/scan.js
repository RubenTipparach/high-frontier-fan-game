// Prospecting scan rules. Each prospector kind has its own
// reachability model:
//
//   missile / buggy: the rocket MUST be physically at the target
//     site. No remote scanning.
//
//   raygun: scans through space - the rocket can scan any site
//     reachable from its current site through "transparent"
//     waypoints only. Adjacency is defined by what waypoint
//     types the ray can pass through:
//       - regular burnspaces, hohmann transfers, lagrange points:
//         BLOCK
//       - hazard burnspaces (radiation belts, asteroid hazards,
//         hohmann hazards), lander burnspaces (the burnspace
//         that's also a landing site): TRANSPARENT, ray passes
//       - aerostat-classified sites (Venus / Titan / Saturn /
//         Uranus / Neptune aerostats): BLOCK even though they're
//         sites, because dense atmospheres bounce the beam.
//
// This module is pure - it takes a graph + a from-site id + the
// prospector kind and returns reachability. UI lives elsewhere.

// Returns true when a waypoint can be traversed by a raygun
// scan without blocking it. The exceptions to "everything blocks"
// (per the HF4 rules quoted to us):
//   - radhaz nodes (radiation belts, hohmann hazards, asteroid
//     hazards): TRANSPARENT - they're sparse, the beam passes
//   - any waypoint tagged hazard:true: TRANSPARENT, same reasoning
//     (the planner tags hazard-lagranges and hazard-burns alike)
//   - lander burnspaces (burn nodes with a numeric landing>0):
//     TRANSPARENT - these ARE the site, no dense body to block
//   - decoratives: TRANSPARENT - just routing bend points, not
//     gameplay objects
// Plain burns, hohmanns, plain lagranges all block.
function isWaypointTransparentToRaygun(point) {
  if (!point) return false;
  const t = point.type;
  if (t === 'radhaz') return true;
  if (t === 'decorative') return true;
  if (point.hazard) return true;
  if (t === 'burn' && typeof point.landing === 'number' && point.landing > 0) return true;
  return false;
}

// Sites that block raygun scans. Aerostat-name sites are the
// HF4 special case (the dense atmosphere bounces the beam).
// Decoratives don't count as sites, but they get filtered at
// the routing layer.
function isSiteBlockingRaygun(point) {
  if (!point) return false;
  if (point.type === 'decorative') return false;
  // Aerostat detection by name - the planner data doesn't carry
  // a flag, but every aerostat site has "Aerostat" in its name.
  if (typeof point.name === 'string' && /aerostat/i.test(point.name)) return true;
  return false;
}

// A "site" for prospect purposes = anything that isn't a routing
// waypoint. Real destinations the player can prospect.
function isSiteNode(point) {
  if (!point) return false;
  const t = point.type;
  // Waypoint types that aren't valid scan TARGETS even when reachable.
  if (t === 'burn' || t === 'hohmann' || t === 'lagrange'
      || t === 'radhaz' || t === 'decorative' || t === 'venus') {
    return false;
  }
  // Everything else (planet, moon, asteroid, comet, dwarf, site, ...)
  // is a real destination.
  return true;
}

// Walk the raygun's reachable graph from `fromSiteId` using BFS.
// Returns a Set of site ids the ray can scan. The rocket's own
// site is excluded - you don't "scan" the site you're already
// at; missile/buggy handle that case.
//
// The BFS frontier is keyed by node id; we only descend through
// waypoints that pass isWaypointTransparentToRaygun, and we
// emit any non-waypoint site we touch (subject to aerostat
// blocking).
export function computeRaygunTargets(graph, fromSiteId) {
  const out = new Set();
  if (!graph || !graph.byId || !graph.neighbors) return out;
  const start = graph.byId[fromSiteId];
  if (!start) return out;
  // Quick check: if the rocket sits on an aerostat, the beam
  // can't get out (the rules don't actually say this but it's
  // consistent with "aerostats block scans" - leave as a
  // follow-up if a player flags it).
  const visited = new Set([fromSiteId]);
  const queue = [fromSiteId];
  while (queue.length) {
    const u = queue.shift();
    const nbrs = graph.neighbors.get(u);
    if (!nbrs) continue;
    for (const v of nbrs) {
      if (visited.has(v)) continue;
      const p = graph.byId[v];
      if (!p) continue;
      if (isSiteNode(p)) {
        // Real site. If aerostat -> beam can't read through it,
        // so don't add as a target AND don't recurse past it.
        if (isSiteBlockingRaygun(p)) {
          visited.add(v);
          continue;
        }
        out.add(v);
        visited.add(v);
        // Sites are terminal for the ray (you've hit a body).
        continue;
      }
      // Waypoint. Recurse iff transparent.
      visited.add(v);
      if (isWaypointTransparentToRaygun(p)) queue.push(v);
    }
  }
  return out;
}

// Top-level prospect-reachability check. Returns a {ok, reason}
// pair so the UI can show a tooltip when a prospect would fail.
//
// `kind` is 'missile' | 'buggy' | 'raygun'. For the first two,
// the rocket must be parked on the exact target site. For
// raygun, the target must appear in computeRaygunTargets().
export function canProspect(graph, fromSiteId, toSiteId, kind) {
  if (!kind) return { ok: false, reason: 'No active prospector.' };
  if (!fromSiteId || !toSiteId) return { ok: false, reason: 'No origin or target.' };
  if (kind === 'missile' || kind === 'buggy') {
    if (fromSiteId !== toSiteId) {
      return { ok: false, reason: 'Missile / buggy prospectors must land on the target site.' };
    }
    return { ok: true, reason: null };
  }
  if (kind === 'raygun') {
    // Raygun also covers the rocket's own site - per the rules,
    // an active raygun can scan whatever the rocket is parked on
    // in addition to anything line-of-sight reachable through
    // transparent waypoints.
    if (fromSiteId === toSiteId) return { ok: true, reason: null };
    const targets = computeRaygunTargets(graph, fromSiteId);
    if (targets.has(toSiteId)) return { ok: true, reason: null };
    return { ok: false, reason: 'Raygun has no line-of-sight to this site (blocked by burnspaces, hohmann, lagrange, or an aerostat).' };
  }
  return { ok: false, reason: `Unknown prospector kind: ${kind}.` };
}
