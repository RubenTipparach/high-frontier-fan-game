// Runtime loader that adapts nornagon/hf-mission-planner's data-hf4.json
// (AGPL-3.0-only; vendored under vendor/hf-mission-planner) into the
// SITES / EDGES shape this renderer expects.
//
// The planner's graph is much richer than our generator-derived one:
// ~1500 nodes (sites + routing waypoints: lagrange, burn, hohmann
// transfers, hazard zones) and ~1750 edges. The waypoint nodes are
// what make the connections look like proper routes instead of a
// crisscrossed knot - they're literally the intermediate stops along
// each interplanetary corridor.
//
// Coordinates in the planner JSON are normalised 0..1 (proportions
// of the original board image). We scale to our SVG viewBox.

// Resolve data URLs against THIS module's location, not the address
// bar. With room routing the visible URL can be a deep /room/<CODE>
// path; a relative './data/...' would resolve to /room/data/... (404)
// and the whole map fails to load. import.meta.url is always
// /js/game/planner-map.js, so ../../ lands at the real app root.
const PLANNER_JSON_URL = new URL(
  '../../vendor/hf-mission-planner/assets/data-hf4.json', import.meta.url).toString();
// Extracted from reference/HF4-site-list.xlsx by
// scripts/extract-site-flags.py. Adds astrobiology / submarine /
// aerobrake / atmospheric / push booleans per site so the renderer
// can decorate planner nodes with the right glyphs.
const SITE_FLAGS_URL = new URL('../../data/site-flags.json', import.meta.url).toString();

// Hand-curated table from data/sites.js. We name-match planner
// nodes against it to surface solarZone (the heliocentric band
// the site sits in) and a siteSynodic fallback. The planner JSON
// itself carries siteSynodic on 15 sites; sites.js fills in any
// stragglers (and provides solarZone, which the planner data
// doesn't have at all).
import { SITES as LOCAL_SITES } from '../../data/sites.js';
import { ZONE_ASSIGNMENTS } from '../../data/zones.js';
const LOCAL_SITE_BY_NAME = new Map();
for (const s of LOCAL_SITES) {
  if (s && s.name) LOCAL_SITE_BY_NAME.set(normalizeSiteName(s.name), s);
}

let _cache = null;

function normalizeSiteName(name) {
  if (!name) return null;
  return String(name).trim().toLowerCase()
    .replace(/[:\-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export async function loadPlannerMap({ viewW = 1400, viewH = 900 } = {}) {
  if (_cache) return _cache;

  const res = await fetch(PLANNER_JSON_URL);
  if (!res.ok) throw new Error(`Failed to load planner map: ${res.status}`);
  const raw = await res.json();

  // Best-effort load of the Excel-derived flag table. If it 404s
  // (older deploy, dev without the data file), sites just don't
  // get extra glyphs -- everything else still works.
  let siteFlags = { sites: {}, groups: {} };
  try {
    const fr = await fetch(SITE_FLAGS_URL);
    if (fr.ok) siteFlags = await fr.json();
  } catch { /* ignore */ }

  // (waypoint-seasons.json fetch removed - see the comment in
  // the per-point loop below for why the corridor propagation
  // was disabled.)

  // Points -> sites array. The planner uses random-float string IDs;
  // we keep them as-is (they're stable across reloads of the same
  // data file) and add a human-readable name for display.
  //
  // Every type is included - decorative nodes are routing waypoints
  // with no name, but they connect ~half the planner's edges, so
  // dropping them tears holes in the graph. We render them as tiny
  // faint dots and exclude them from click hit-testing so they
  // don't get in the way.
  const sites = [];
  for (const [id, p] of Object.entries(raw.points || {})) {
    const rawType = p.type || 'unknown';
    const type = rawType === 'site' ? classifyBody(p.siteName) : rawType;
    // Pull Excel-derived flags for real sites: astrobiology /
    // submarine / aerobrakes count etc. Falls back through the
    // body group key so "Mars: Arsia Mons" can inherit any flags
    // recorded against the Mars group.
    const flags = lookupFlags(p.siteName, siteFlags);
    // Waypoint season propagation is disabled - the corridor
    // boundaries the BFS produced didn't match the published
    // board's seasonal painting on enough cards that the colours
    // ended up misleading. Only the canonical site-level
    // siteSynodic (comets + flagged seasonal asteroids like
    // Icarus / Phaethon / …) is kept. The extractor + data file
    // remain in the tree (scripts/extract-waypoint-seasons.py,
    // data/waypoint-seasons.json) so we can revisit with a
    // better heuristic later - just don't apply it here.
    const isWaypoint = rawType !== 'site';
    // Cross-reference the local hand-curated table by name to pull
    // solarZone (heliocentric band) + a siteSynodic fallback for
    // any seasonal sites the planner JSON missed. Waypoints carry
    // no name → never match → both stay null.
    const local = LOCAL_SITE_BY_NAME.get(normalizeSiteName(p.siteName)) || null;
    const synodic = p.siteSynodic || (local && local.siteSynodic) || null;
    const solarZone = local ? (local.solarZone || null) : null;
    // id2 - a human-friendly stable reference for every location,
    // derived once at load time. Real sites: slug of their name
    // ("comet-borrelly", "dresda"). Waypoints: type prefix + a
    // short hash of their (x, y) so unnamed lagranges/burns get
    // unique tags like "lag-3a2b9". Collisions are disambiguated
    // with a trailing counter further down. The upstream `id`
    // (random float key from the vendor JSON) stays as the
    // canonical lookup key so byId / edge data still works.
    const id2 = makeRefId(p, rawType);
    sites.push({
      id,
      id2,
      // The matched data/sites.js id (server slug), or null when this
      // node didn't name-match a real site (waypoints, decoratives).
      // Lets multiplayer translate between classic-map node ids and the
      // server's site ids without a second name-match.
      serverId: local ? local.id : null,
      name: p.siteName || routingLabel(rawType),
      type,
      isWaypoint,
      isDecorative: rawType === 'decorative',
      siteSize: p.siteSize || null,
      siteSynodic: synodic,
      solarZone,
      hydration: parseHydration(p.siteWater),
      hazard: !!p.hazard,
      // Comets are always landing sites in HF4 - you touch down
      // on the nucleus to harvest water. The planner JSON doesn't
      // flag them, so default landing=1 for any classified comet.
      landing: typeof p.landing === 'number' ? p.landing
        : (type === 'comet' ? 1 : null),
      flybyBoost: p.flybyBoost || null,
      astrobiology:  !!flags.astrobiology,
      submarine:     !!flags.submarine,
      atmospheric:   !!flags.atmospheric,
      spaceElevator: !!flags.spaceElevator,
      aerobrakes:    flags.aerobrakes | 0,
      x: Math.round(p.x * viewW * 10) / 10,
      y: Math.round(p.y * viewH * 10) / 10,
    });
  }

  // Edges are strings "from:to"; keep them all now that decoratives
  // are back in the graph.
  // Edges come back as flat [a, b] tuples for the renderer; we also
  // build (a) the raw directional edgeLabels map (preserved AS-IS;
  // these are direction tags like '0' / '1' / '2', NOT burn costs,
  // and the planner ported in planner-nav.js needs them to handle
  // Hohmann pivots correctly) and (b) a neighbours adjacency map.
  const edges = [];
  const neighbors = new Map();
  const addNbr = (a, b) => {
    if (!neighbors.has(a)) neighbors.set(a, new Set());
    neighbors.get(a).add(b);
  };
  for (const eStr of raw.edges || []) {
    const [a, b] = eStr.split(':');
    if (!a || !b) continue;
    edges.push([a, b]);
    addNbr(a, b);
    addNbr(b, a);
  }
  const edgeLabels = {};
  for (const a in (raw.edgeLabels || {})) {
    const row = raw.edgeLabels[a];
    if (!row || typeof row !== 'object') continue;
    edgeLabels[a] = {};
    for (const b in row) edgeLabels[a][b] = String(row[b]);
  }

  // Synthetic bodies the planner doesn't carry: the Sun (anchors
  // the inner system visually), Earth (you launch from LEO but it
  // isn't a destination in the planner data), and Jupiter (only
  // its moons are listed -- the planet itself is implied at the
  // centroid). Positions are normalized 0..1 and chosen to fit our
  // viewport's layout.
  synthesizeBodies(sites, viewW, viewH);

  // Disambiguate any id2 collisions (rare - only happens if two
  // unnamed waypoints sit at coords that hash to the same bucket,
  // or two real sites have the same slugged name). Append a
  // numeric suffix in iteration order so the result stays stable.
  disambiguateRefIds(sites);

  // Stamp the canonical solar zone onto every node from the frozen
  // zone data (keyed by the now-final id2). This covers ALL non-site
  // nodes - lagranges, hohmanns, burns/landers, rad hazards,
  // decoratives - which the planner JSON doesn't carry a zone for.
  // Named sites keep their hand-curated solarZone unless the data
  // overrides them.
  for (const s of sites) {
    const z = ZONE_ASSIGNMENTS[s.id2];
    if (z) s.solarZone = z;
  }

  // Each site picks up a bodyKey so the renderer can group
  // multi-site bodies (Mars, Luna, Mercury) into one shared halo.
  for (const s of sites) s.bodyKey = bodyKeyFor(s);

  const byId = Object.fromEntries(sites.map((s) => [s.id, s]));

  // Chains of decorative routing nodes (degree-2 nodes whose only
  // job is to bend a straight line into a curve). We split them out
  // here so the renderer can paint them as smooth Bezier ribbons
  // instead of jagged polylines, while the pathfinder keeps the
  // full straight-segment graph for shortest-path math.
  const { chains, straightEdges } = buildChains(sites, edges, byId);

  _cache = {
    sites, edges, byId, chains, straightEdges,
    edgeLabels,   // raw direction labels for Hohmann pivots
    neighbors,    // Map<id, Set<id>> for the ported planner
    mode: 'classic',
  };
  return _cache;
}

// id2 generator: a copy-friendly stable reference for one location.
// Real sites collapse to a slug of their name ("comet-borrelly").
// Waypoints get `<typePrefix>-<5-char position hash>` so the LEO
// lagrange reads as "lag-leo" (named) and an unnamed mid-Trojan
// burn reads as "burn-3a2b9". Identical position + type always
// hashes to the same id, so the reference is stable across loads.
const TYPE_PREFIX = {
  site: 'site', lagrange: 'lag', burn: 'burn', hohmann: 'hoh',
  decorative: 'dec', radhaz: 'rad', venus: 'venus', unknown: 'wp',
};
function makeRefId(p, rawType) {
  if (p.siteName) {
    const slug = slugify(p.siteName);
    if (slug) {
      // Named waypoints (LEO) still get a type prefix so they read
      // distinct from a same-named real site if one ever appears.
      if (rawType !== 'site') {
        return `${TYPE_PREFIX[rawType] || 'wp'}-${slug}`;
      }
      return slug;
    }
  }
  const prefix = TYPE_PREFIX[rawType] || 'wp';
  // Hash from the position coords so two waypoints can't collide
  // unless they're at the exact same x/y - which never happens in
  // practice in the planner data.
  const posKey = `${(p.x || 0).toFixed(6)},${(p.y || 0).toFixed(6)}`;
  return `${prefix}-${shortHash5(posKey)}`;
}

function slugify(name) {
  return String(name).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// djb2 → base36, 5 chars. Plenty of buckets (60M) for ~1500
// waypoints; collisions are caught and disambiguated below.
function shortHash5(s) {
  let h = 5381 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h.toString(36).padStart(5, '0').slice(-5);
}

function disambiguateRefIds(sites) {
  const seen = new Map();           // id2 -> count
  for (const s of sites) {
    if (!s.id2) continue;
    const n = (seen.get(s.id2) || 0) + 1;
    seen.set(s.id2, n);
    if (n > 1) s.id2 = `${s.id2}-${n}`;
  }
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
const GAS_GIANT_KEYS = ['jupiter', 'saturn', 'uranus', 'neptune'];
const INNER_PLANET_KEYS = ['mercury', 'venus', 'earth', 'mars', 'luna'];
const PLANET_KEYS = [...GAS_GIANT_KEYS, ...INNER_PLANET_KEYS];
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
// Resolve site flags by exact site-name match first, then by body
// group (so a "Mars: ..." surface site picks up any Mars-group
// flags even if its own row doesn't carry them).
function lookupFlags(siteName, flagsDoc) {
  const empty = {};
  if (!siteName || !flagsDoc) return empty;
  const key = normalizeSiteName(siteName);
  if (key && flagsDoc.sites && flagsDoc.sites[key]) return flagsDoc.sites[key];
  // Body fallback: first word of the normalised name.
  if (key) {
    const grp = key.split(' ')[0];
    if (flagsDoc.groups && flagsDoc.groups[grp]) return flagsDoc.groups[grp];
  }
  return empty;
}

function classifyBody(name) {
  const n = (name || '').toLowerCase();
  if (!n) return 'site';
  if (n.startsWith('comet')) return 'comet';
  for (const k of GAS_GIANT_KEYS)  if (n.startsWith(k)) return 'gas-giant';
  for (const k of INNER_PLANET_KEYS) if (n.startsWith(k)) return 'inner-planet';
  for (const k of DWARF_KEYS)  if (n.includes(k))  return 'dwarf';
  for (const k of MOON_KEYS)   if (n.includes(k))  return 'moon';
  return 'asteroid';
}

// bodyKey clusters all sites that belong to the same celestial
// body. "Mars: north pole" and "Mars: Hellas Basin" both have
// bodyKey 'mars'. Used by the renderer to draw a single shared
// halo per body rather than one per surface site.
function bodyKeyFor(site) {
  const n = (site.name || '').toLowerCase();
  if (!n || site.isWaypoint) return null;
  // Strip ":" or "-" suffixes and take the first word as the key.
  const first = n.replace(/[:\-].*$/, '').split(/\s+/)[0];
  return first || null;
}

// Inject Sun + Earth + Jupiter as renderable sites. The planner's
// underlying graph doesn't include them; we add them with synthetic
// ids so the renderer can draw them as flavour bodies. They're
// marked isLandable=false so the renderer skips the hex marker
// and the click hit-test ignores them -- you can look at them, you
// can't land on them.
function synthesizeBodies(sites, viewW, viewH) {
  const synthetics = [
    {
      id: 'synthetic_sun',
      name: 'Sun',
      type: 'sun',
      nx: 0.7443, ny: 0.7267,
    },
    {
      id: 'synthetic_earth',
      name: 'Earth',
      type: 'inner-planet',
      // LEO sits on top of the Earth-Moon +2 gravity assist
      // Lagrange in the planner data.
      nx: 0.871, ny: 0.813,
    },
    {
      id: 'synthetic_jupiter',
      name: 'Jupiter',
      type: 'gas-giant',
      // +4 gravity-assist Lagrange = Jupiter's gravity well centre.
      nx: 0.337, ny: 0.429,
    },
  ];
  for (const s of synthetics) {
    sites.push({
      id: s.id,
      name: s.name,
      type: s.type,
      isWaypoint: false,
      isDecorative: false,
      isLandable: false,        // visual only -- no hex, no click target
      siteSize: null,
      siteSynodic: null,
      hydration: 0,
      hazard: false,
      landing: null,
      flybyBoost: null,
      x: Math.round(s.nx * viewW * 10) / 10,
      y: Math.round(s.ny * viewH * 10) / 10,
    });
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
