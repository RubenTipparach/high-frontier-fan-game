// Adapter that wraps our generator-derived data/sites.js into the
// same { sites, edges, byId } shape the renderer + nav engine
// expect from planner-map.js. Used as the "cleaned up" view in the
// map mode toggle: only the 188 named sites, zone-banded layered
// tree layout, no routing waypoints.
//
// The classic counterpart is planner-map.js, which loads nornagon's
// ~1500-node planner graph with waypoint nodes.

import { SITES, EDGES, SOLAR_ZONES } from '../../data/sites.js';

let _cache = null;

export async function loadCleanMap() {
  if (_cache) return _cache;

  // Adapt SITES rows -> renderer-friendly site records. Our schema
  // already overlaps (id, name, type, hydration, x, y), so this is
  // mostly type-coercion + adding the planner-compat `isWaypoint`
  // and `siteSize` keys.
  const sites = SITES.map((s) => ({
    id: s.id,
    name: s.name,
    type: s.type,                            // planet | moon | asteroid | ...
    isWaypoint: false,                       // every clean-map node is a real site
    siteSize: s.class || '',                 // class A/B/C/D as a "size" tag
    hydration: s.hydration | 0,
    hazard: false,                           // class-driven hazards live in the engine, not the map
    x: s.x,
    y: s.y,
    body: s.body,
    solarZone: s.solarZone,
    vps: s.vps,
  }));

  // EDGES is [a, b, dv][]; same shape as the planner expects.
  const edges = EDGES.map(([a, b, dv]) => [a, b, dv]);
  const byId = Object.fromEntries(sites.map((s) => [s.id, s]));

  _cache = { sites, edges, byId, mode: 'clean', zones: SOLAR_ZONES };
  return _cache;
}
