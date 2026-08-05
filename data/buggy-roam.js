// Buggy road networks. PURE + SHARED by the client scan gate (js/game/scan.js),
// the map renderer (js/game/render.js), the server engine + planner graph
// (server/game/*), and The Martian free action - one tag-driven model, many
// callers, like raygun-los.js.
//
// Rule (H9): sites joined by a yellow dashed buggy road form a road network. A
// buggy parked on one road site can prospect any other site in that network as
// a free scan ("acts as a raygun"), and can drive a Crew / Colonist along the
// road (The Martian). Membership comes ENTIRELY from the buggy-<body> site tags
// below - there are no hardcoded per-body cliques and no name / spelling
// cross-reference to data/sites.js.

// Canonical body key: first word of a body / site-name, lowercased. Matches
// js/game/planner-map.js#bodyKeyFor so the client (site name) and the server
// (curated site.body) reduce a body to the SAME key. "Mars" / "mars" /
// "Mars: North Pole" / "Mars Hellas Basin" all collapse to "mars".
export function bodyKey(body) {
  return String(body || '').toLowerCase().replace(/[:\-].*$/, '').split(/\s+/)[0] || '';
}

// ---- Buggy-road membership: DATA-DRIVEN from the site tags ----
//
// The single source of truth is the buggy-<body> site tags the user authored
// (annotation rows, kind:'tag', body:'buggy-<body>'). The KEY is the node
// reference slug (id2 / makeRefId, which is also the server slug), verbatim
// from each tag's site_id - so NO name / spelling cross-reference to
// data/sites.js is involved, and the board node "Triton: Tuenela Plantia"
// (id2 'triton-tuenela-plantia') is keyed by its own tag, not by matching
// sites.js's differently-spelled "Triton Tuonela Planitia".
//
// A site tagged buggy-<body> joins that body's road network; every pair of
// sites that share a tag is a yellow dashed buggy road. To add / remove a road,
// add / remove a tag row here - there are no hand-drawn clique arrays.
export const BUGGY_ROAD_TAGS = {
  'mercury-north-pole': 'buggy-mercury',
  'mercury-discovery-rupes': 'buggy-mercury',
  'luna-aristarchus-plateau': 'buggy-luna',
  'luna-shackleton-polar-rim': 'buggy-luna',
  'mars-north-pole': 'buggy-mars',
  'mars-arsia-mons-caves': 'buggy-mars',
  'mars-hellas-basin-buried-glaciers': 'buggy-mars',
  'callisto-asgard-ice-spires': 'buggy-callisto',
  'callisto-valhalla': 'buggy-callisto',
  'europa-conamara-chaos': 'buggy-europa',
  'europa-subsurface-ocean': 'buggy-europa',
  'ganymede-memphis-facula': 'buggy-ganymede',
  'ganymede-uruk-sulcus': 'buggy-ganymede',
  'io-gish-bar-mons': 'buggy-io',
  'io-loki-patera': 'buggy-io',
  'titan-kraken-mare': 'buggy-titan',
  'titan-ontario-lacus': 'buggy-titan',
  'triton-mahilani-plume': 'buggy-triton',
  'triton-tuenela-plantia': 'buggy-triton',
};

// Road networks: the tagged sites grouped by their buggy-<body> tag. Mars is
// the only triplet (each Mars site has TWO road neighbours); the rest are pairs.
export const BUGGY_ROAD_GROUPS = (() => {
  const byTag = new Map();
  for (const [siteId, tag] of Object.entries(BUGGY_ROAD_TAGS)) {
    if (!byTag.has(tag)) byTag.set(tag, []);
    byTag.get(tag).push(siteId);
  }
  return [...byTag.values()];
})();

// Undirected road edges = the clique within each group (a pair yields one edge,
// the Mars triplet yields three). Used to draw the roads.
export const BUGGY_ROADS = (() => {
  const out = [];
  for (const g of BUGGY_ROAD_GROUPS) {
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) out.push([g[i], g[j]]);
    }
  }
  return out;
})();

// Two sites are joined by a buggy road iff they carry the SAME buggy-<body> tag.
export function isBuggyRoadPair(a, b) {
  const ta = BUGGY_ROAD_TAGS[a];
  return !!ta && a !== b && ta === BUGGY_ROAD_TAGS[b];
}

// Sites reachable from `fromId` along buggy roads (same tag, self excluded).
export function buggyRoadReachable(fromId) {
  const tag = BUGGY_ROAD_TAGS[fromId];
  const out = new Set();
  if (!tag) return out;
  for (const [siteId, t] of Object.entries(BUGGY_ROAD_TAGS)) {
    if (t === tag && siteId !== fromId) out.add(siteId);
  }
  return out;
}

// The roam bodies, derived from the tags (buggy-mars -> 'mars', ...). A buggy on
// one of these bodies can prospect any road-connected site as a free scan.
export const BUGGY_ROAM_BODIES = new Set(
  Object.values(BUGGY_ROAD_TAGS).map((tag) => tag.replace(/^buggy-/, '')),
);

export function isBuggyRoamBody(body) {
  return BUGGY_ROAM_BODIES.has(bodyKey(body));
}

// Sites a buggy at `fromId` can road to. TAG-DRIVEN: exactly the sites sharing
// fromId's buggy-<body> tag, so it never leaks to an off-road same-body site
// (e.g. an atmospheric aerostat) and it works for every tagged body including
// ones the server's site enumeration would otherwise miss. `fromId` is the node
// reference slug (id2 / server slug), the same key space as the tags. The
// optional { bodyOf, siteIds } accessors are accepted for call-site
// compatibility but no longer needed (the tags carry the network directly).
export function buggyRoamReachable(fromId, _accessors = {}) {
  return buggyRoadReachable(fromId == null ? null : String(fromId));
}

// ---- A ROAD IS BUGGY ONLY ----
//
// The board joins some same-body dirtsides with yellow dashed BUGGY ROADS, and
// the vendored map graph carries those joins as ordinary surface edges. Nothing
// stopped a ROCKET routing along them: 10 of the board's 11 road pairs had a
// surface-only vehicle route (2 to 4 burns), and a player crossed Mars from
// Arsia Mons to Hellas Basin down one pad and along the surface, never
// returning to orbit. A road carries a BUGGY, under The Martian free action. A
// vehicle has to fly, and flying means leaving the surface.
//
// Written as a ROUTE rule rather than by deleting edges, because the graph is
// ambiguous at shared nodes: Arsia Mons's own descent pad is also the first
// step of its road to Hellas, so no edge can be cut without breaking a legal
// landing. "Two sites with no orbital space between them" is exact, needs no
// edge classification, and reads the way the rule is spoken.
//
// `typeOf(id) => 'site'|'lagrange'|'hohmann'|'burn'|'decorative'|...`, so this
// stays id-space-agnostic like the rest of this file. Radiation belts (radhaz)
// sit on transfer routes, so they count as leaving the surface too.
const ORBITAL_TYPES = new Set(['lagrange', 'hohmann', 'radhaz']);
export function routeCrossesSurface(path, typeOf) {
  let seenSite = false;
  let orbitSince = false;
  for (const id of (path || [])) {
    const t = typeOf(id);
    if (t === 'site') {
      if (seenSite && !orbitSince) return true;
      seenSite = true;
      orbitSince = false;
      continue;
    }
    if (ORBITAL_TYPES.has(t)) orbitSince = true;
  }
  return false;
}
