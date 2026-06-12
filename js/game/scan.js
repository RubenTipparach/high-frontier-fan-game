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
import { isBuggyRoamBody, bodyKey } from '../../data/buggy-roam.js';

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
    // A buggy on a connected body (Mars / Luna / Io / Callisto / Ganymede /
    // Europa) roads to any other land site on the SAME body, acting as a
    // raygun there. The shared body key is the "<Body>:" name prefix, read off
    // the planner node name on both client and server (data/buggy-roam.js).
    if (kind === 'buggy' && graph && graph.byId) {
      const fromName = graph.byId[fromSiteId] && graph.byId[fromSiteId].name;
      const toName = graph.byId[toSiteId] && graph.byId[toSiteId].name;
      if (isBuggyRoamBody(fromName) && bodyKey(fromName) === bodyKey(toName)) {
        return { ok: true, reason: null };
      }
    }
    return { ok: false, reason: 'Missile / buggy prospectors must land on the target site (a buggy can also road to any site on the same connected body: Mars, the Moon, Io, Callisto, Ganymede, Europa).' };
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
