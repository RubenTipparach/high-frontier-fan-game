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
//
// The raygun beam model (which waypoints are transparent, which
// sites bounce it) lives in the SHARED data/raygun-los.js so the
// server validates a prospect against the EXACT same reachability
// the client offers - no divergent second model.
import { raygunReachable } from '../../data/raygun-los.js';
import { isBuggyRoadPair } from '../../data/buggy-roam.js';

// Walk the raygun's reachable graph from `fromSiteId`. Returns a Set
// of site ids the ray can scan (the rocket's own site is excluded -
// missile/buggy handle the at-site case). Pure delegate to the shared
// beam walk, fed the client graph's accessors.
export function computeRaygunTargets(graph, fromSiteId) {
  if (!graph || !graph.byId || !graph.neighbors) return new Set();
  if (!graph.byId[fromSiteId]) return new Set();
  return raygunReachable(fromSiteId, {
    neighbors: (id) => graph.neighbors.get(id) || [],
    nodeOf: (id) => graph.byId[id] || null,
  });
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
    if (fromSiteId === toSiteId) return { ok: true, reason: null };
    // A buggy roads to any site joined to its own by a buggy road (the
    // yellow dashed network), acting as a raygun there. The network is
    // TAG-DRIVEN (data/buggy-roam.js, the buggy-<body> site tags), keyed by the
    // node reference slug (id2) - the same key the server checks, so client and
    // server agree on which roads exist.
    if (kind === 'buggy' && graph && graph.byId) {
      const fromNode = graph.byId[fromSiteId];
      const toNode = graph.byId[toSiteId];
      const fromRef = fromNode && (fromNode.id2 || fromNode.serverId);
      const toRef = toNode && (toNode.id2 || toNode.serverId);
      if (fromRef && toRef && isBuggyRoadPair(fromRef, toRef)) {
        return { ok: true, reason: null };
      }
    }
    return { ok: false, reason: 'Missile / buggy prospectors must land on the target site (a buggy can also road along a yellow dashed buggy road to a connected site).' };
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
