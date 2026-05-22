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
  // Every type is included — decorative nodes are routing waypoints
  // with no name, but they connect ~half the planner's edges, so
  // dropping them tears holes in the graph. We render them as tiny
  // faint dots and exclude them from click hit-testing so they
  // don't get in the way.
  const sites = [];
  for (const [id, p] of Object.entries(raw.points || {})) {
    const type = p.type || 'unknown';
    sites.push({
      id,
      name: p.siteName || routingLabel(type),
      type,
      isWaypoint: type !== 'site',
      isDecorative: type === 'decorative',
      siteSize: p.siteSize || null,
      siteSynodic: p.siteSynodic || null,    // 'red' | 'yellow' | 'blue'
      hydration: parseHydration(p.siteWater),
      hazard: !!p.hazard,
      landing: typeof p.landing === 'number' ? p.landing : null,
      flybyBoost: p.flybyBoost || null,      // 1 | 2 | 4 | 'thrust'
      x: Math.round(p.x * viewW * 10) / 10,
      y: Math.round(p.y * viewH * 10) / 10,
    });
  }

  // Edges are strings "from:to"; keep them all now that decoratives
  // are back in the graph.
  const edges = [];
  for (const eStr of raw.edges || []) {
    const [a, b] = eStr.split(':');
    if (!a || !b) continue;
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
