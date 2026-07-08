// Buggy road networks. PURE + SHARED by the client scan gate (js/game/scan.js)
// and the server engine (server/game/planner-graph.js) so BOTH compute the SAME
// set of buggy-prospectable sites - one model, two callers, like raygun-los.js.
//
// Rule (user 2026-06-10): on a handful of large bodies every surface site is
// connected by buggy roads, so a buggy parked on one site can prospect ANY land
// site on the SAME body - it "acts as a raygun" there (extended reach AND the
// free-after-the-first-scan economy). Elsewhere a buggy must still land on its
// target. The shared body is the "<Body>:" prefix players read on the site name
// ("Mars: Hellas Basin" + "Mars: North Pole" are one road network).

// Canonical body key: first word of a body / site-name, lowercased. Matches
// js/game/planner-map.js#bodyKeyFor so the client (site name) and the server
// (curated site.body) reduce a body to the SAME key. "Mars" / "mars" /
// "Mars: North Pole" / "Mars Hellas Basin" all collapse to "mars".
export function bodyKey(body) {
  return String(body || '').toLowerCase().replace(/[:\-].*$/, '').split(/\s+/)[0] || '';
}

// The roam bodies, as canonical keys: Mars, Luna (the Moon), Io, Callisto,
// Ganymede, Europa.
export const BUGGY_ROAM_BODIES = new Set([
  'mars', 'luna', 'io', 'callisto', 'ganymede', 'europa',
  'mercury', 'titan', 'triton',
]);

export function isBuggyRoamBody(body) {
  return BUGGY_ROAM_BODIES.has(bodyKey(body));
}

// Explicit buggy-road networks, by node reference slug (the id2 / makeRefId
// slug that BOTH the client planner map and the server planner graph stamp, so
// it is the stable shared key - not the data/sites.js underscore slug, which
// can drift in spelling: the board node "Triton: Tuenela Plantia" never
// name-matches sites.js "Triton Tuonela Planitia"). These strings are exactly
// the buggy-<body> annotation site_ids. Each inner array is one body's road
// network: every site in it is joined to every other by a yellow dashed buggy
// road. Mars is the only triplet, so each Mars site has TWO buggy-road
// neighbours; every other body is a simple pair. The aerostat sites (e.g.
// titan-aerostat) are NOT on the ground road network and are excluded.
export const BUGGY_ROAD_GROUPS = [
  ['mercury-north-pole', 'mercury-discovery-rupes'],
  ['luna-aristarchus-plateau', 'luna-shackleton-polar-rim'],
  ['mars-north-pole', 'mars-arsia-mons-caves', 'mars-hellas-basin-buried-glaciers'],
  ['callisto-asgard-ice-spires', 'callisto-valhalla'],
  ['europa-conamara-chaos', 'europa-subsurface-ocean'],
  ['ganymede-memphis-facula', 'ganymede-uruk-sulcus'],
  ['io-gish-bar-mons', 'io-loki-patera'],
  ['titan-kraken-mare', 'titan-ontario-lacus'],
  ['triton-mahilani-plume', 'triton-tuenela-plantia'],
];

// Undirected road edges = the clique within each group (a pair yields one edge,
// the Mars triplet yields three). Used to draw the roads and to strip these
// pairs out of line-of-sight adjacency (H9: buggy-connected Spaces are never
// adjacent, the horizon blocks line-of-sight).
export const BUGGY_ROADS = (() => {
  const out = [];
  for (const g of BUGGY_ROAD_GROUPS) {
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) out.push([g[i], g[j]]);
    }
  }
  return out;
})();

const _pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
const BUGGY_ROAD_PAIR_SET = new Set(BUGGY_ROADS.map(([a, b]) => _pairKey(a, b)));

// True when a and b are the two ends of a buggy road (order-independent).
export function isBuggyRoadPair(a, b) {
  return BUGGY_ROAD_PAIR_SET.has(_pairKey(a, b));
}

// Same-body land sites a buggy can road to from `fromId` (the origin is
// excluded - the at-site case is handled by the caller). Empty unless fromId
// sits on a roam body. Accessors are supplied in the caller's own id space
// (server slugs / client node ids), exactly like raygun-los.js:
//   bodyOf(id) -> the site's body string (or name) | null
//   siteIds()  -> iterable of every prospectable site id
export function buggyRoamReachable(fromId, { bodyOf, siteIds } = {}) {
  const out = new Set();
  if (fromId == null || typeof bodyOf !== 'function' || typeof siteIds !== 'function') return out;
  const key = bodyKey(bodyOf(fromId));
  if (!BUGGY_ROAM_BODIES.has(key)) return out;
  for (const id of siteIds() || []) {
    if (id === fromId) continue;
    if (bodyKey(bodyOf(id)) === key) out.add(id);
  }
  return out;
}
