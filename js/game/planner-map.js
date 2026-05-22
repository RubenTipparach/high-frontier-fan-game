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
    const rawType = p.type || 'unknown';
    // Re-classify game-destination sites by name so the renderer
    // can size them correctly: gas giants render huge, dwarf
    // planets noticeable, moons modest, asteroids small + rocky.
    // Routing waypoints keep their planner-assigned type.
    const type = rawType === 'site' ? classifyBody(p.siteName) : rawType;
    sites.push({
      id,
      name: p.siteName || routingLabel(rawType),
      type,
      isWaypoint: rawType !== 'site',
      isDecorative: rawType === 'decorative',
      siteSize: p.siteSize || null,
      siteSynodic: p.siteSynodic || null,
      hydration: parseHydration(p.siteWater),
      hazard: !!p.hazard,
      landing: typeof p.landing === 'number' ? p.landing : null,
      flybyBoost: p.flybyBoost || null,
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

  // Chains of decorative routing nodes (degree-2 nodes whose only
  // job is to bend a straight line into a curve). We split them out
  // here so the renderer can paint them as smooth Bezier ribbons
  // instead of jagged polylines, while the pathfinder keeps the
  // full straight-segment graph for shortest-path math.
  const { chains, straightEdges } = buildChains(sites, edges, byId);

  _cache = { sites, edges, byId, chains, straightEdges, mode: 'classic' };
  return _cache;
}

// Walk the adjacency graph and pull out every chain of degree-2
// decorative nodes connecting two non-mid-chain endpoints. Returns
//   chains:        [[idStart, idDec1, idDec2, ..., idEnd], ...]
//   straightEdges: [[a, b, dv], ...] for edges NOT consumed by a chain
function buildChains(sites, edges, byId) {
  const adj = new Map();
  for (const s of sites) adj.set(s.id, []);
  for (const [a, b, dv] of edges) {
    if (!adj.has(a) || !adj.has(b)) continue;
    adj.get(a).push({ to: b, dv });
    adj.get(b).push({ to: a, dv });
  }

  // A node is "mid-chain" if it's a decorative with exactly two
  // neighbours; the chain walker hops through these and terminates
  // at the first non-mid-chain node.
  function isMidChain(id) {
    const s = byId[id];
    return s && s.isDecorative && adj.get(id).length === 2;
  }
  function ek(a, b) { return a < b ? a + ':' + b : b + ':' + a; }

  const chains = [];
  const consumed = new Set();   // edge keys folded into a chain

  function walkChain(start, next) {
    const chain = [start, next];
    consumed.add(ek(start, next));
    let prev = start, cur = next;
    while (isMidChain(cur)) {
      const neighbours = adj.get(cur);
      const onward = neighbours.find((n) => n.to !== prev);
      if (!onward) break;
      consumed.add(ek(cur, onward.to));
      chain.push(onward.to);
      prev = cur;
      cur = onward.to;
    }
    return chain;
  }

  for (const s of sites) {
    if (isMidChain(s.id)) continue;          // mid-chain nodes are entered, not started from
    for (const { to } of adj.get(s.id) || []) {
      if (consumed.has(ek(s.id, to))) continue;
      if (isMidChain(to)) chains.push(walkChain(s.id, to));
    }
  }

  // Any edge not folded into a chain is a "straight" edge: draw
  // as a single line segment in the renderer.
  const straightEdges = [];
  for (const [a, b, dv] of edges) {
    if (!consumed.has(ek(a, b))) straightEdges.push([a, b, dv]);
  }

  return { chains, straightEdges };
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

// Re-classify a destination site by its name into one of:
//   planet | dwarf | moon | comet | asteroid (default).
// Planner data flattens every game destination to type='site', so
// we use name prefixes / substrings to recover the body class.
const PLANET_KEYS = [
  'mercury', 'venus', 'earth', 'mars',
  'jupiter', 'saturn', 'uranus', 'neptune',
];
const DWARF_KEYS = [
  'pluto', 'ceres', 'eris', 'sedna', 'makemake',
  'haumea', 'orcus', 'quaoar', 'gonggong',
];
const MOON_KEYS = [
  'luna', 'phobos', 'deimos',
  'io ', 'europa', 'ganymede', 'callisto',
  'titan', 'enceladus', 'iapetus', 'rhea', 'mimas',
  'hyperion', 'dione', 'tethys', 'phoebe',
  'charon', 'nix', 'hydra',
  'miranda', 'ariel', 'umbriel', 'titania', 'oberon',
  'triton', 'nereid', 'proteus',
];
function classifyBody(name) {
  const n = (name || '').toLowerCase();
  if (!n) return 'site';
  if (n.startsWith('comet')) return 'comet';
  for (const k of PLANET_KEYS) if (n.startsWith(k)) return 'planet';
  for (const k of DWARF_KEYS)  if (n.includes(k))  return 'dwarf';
  for (const k of MOON_KEYS)   if (n.includes(k))  return 'moon';
  return 'asteroid';
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
