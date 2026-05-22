// Runtime loader that adapts nornagon/hf-mission-planner's data-hf4.json
// (AGPL-3.0-only; vendored under vendor/hf-mission-planner) into the
// SITES / EDGES shape this renderer expects.
//
// The planner's graph is much richer than our generator-derived one:
// ~1500 nodes (sites + routing waypoints: lagrange, burn, hohmann
// transfers, hazard zones) and ~1750 edges. The waypoint nodes are
// what make the connections look like proper routes instead of a
// crisscrossed knot — they're literally the intermediate stops along
// each interplanetary corridor.
//
// Coordinates in the planner JSON are normalised 0..1 (proportions
// of the original board image). We scale to our SVG viewBox.

const PLANNER_JSON_URL = './vendor/hf-mission-planner/assets/data-hf4.json';

let _cache = null;

export async function loadPlannerMap({ viewW = 1400, viewH = 900 } = {}) {
  if (_cache) return _cache;

  const res = await fetch(PLANNER_JSON_URL);
  if (!res.ok) throw new Error(`Failed to load planner map: ${res.status}`);
  const raw = await res.json();

  // Points -> sites array. The planner uses random-float string IDs;
  // we keep them as-is (they're stable across reloads of the same
  // data file) and add a human-readable name for display.
  //
  // Decorative nodes (type === 'decorative') are stripped here.
  // They're cosmetic markers on the planner's board background and
  // carry no game-mechanical information; including them clutters
  // both the canvas and the pathfinder.
  const sites = [];
  const dropped = new Set();
  for (const [id, p] of Object.entries(raw.points || {})) {
    const type = p.type || 'unknown';
    if (type === 'decorative') { dropped.add(id); continue; }
    sites.push({
      id,
      name: p.siteName || routingLabel(type),
      type,
      isWaypoint: type !== 'site',
      siteSize: p.siteSize || null,
      hydration: parseHydration(p.siteWater),
      hazard: !!p.hazard,
      x: Math.round(p.x * viewW * 10) / 10,
      y: Math.round(p.y * viewH * 10) / 10,
    });
  }

  // Edges are strings "from:to". We re-package as [from, to, dv]
  // and drop any edge that touches a stripped decorative node.
  const edges = [];
  for (const eStr of raw.edges || []) {
    const [a, b] = eStr.split(':');
    if (!a || !b) continue;
    if (dropped.has(a) || dropped.has(b)) continue;
    const dvA = raw.edgeLabels?.[a]?.[b];
    const dvB = raw.edgeLabels?.[b]?.[a];
    const dv = Number(dvA ?? dvB ?? 1) || 1;
    edges.push([a, b, dv]);
  }

  const byId = Object.fromEntries(sites.map((s) => [s.id, s]));
  _cache = { sites, edges, byId, mode: 'classic' };
  return _cache;
}

// 'site' -> ''. Other types get a short human-readable hint.
function routingLabel(type) {
  switch (type) {
    case 'lagrange': return 'Lagrange';
    case 'burn':     return 'Burn point';
    case 'hohmann':  return 'Hohmann xfer';
    default:         return type;
  }
}

// siteWater in the planner is a string like '0', '1', '2', '3', '4'.
// Coerce to a small non-negative integer.
function parseHydration(s) {
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.min(4, Math.floor(n)) : 0;
}

// Extract A/B/C/D prospect-class from a siteSize tag like '1D' or '3B'.
// Returns '' if the size tag isn't formatted that way.
export function classFromSize(siteSize) {
  if (!siteSize) return '';
  const m = /([A-D])/i.exec(siteSize);
  return m ? m[1].toUpperCase() : '';
}
