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
  // TITAN HAS A ROAD after all (user 2026-08-31, with the board art: a yellow
  // dashed double-headed arrow runs across Titan between 9V Kraken Mare and 9D
  // Ontario Lacus). The pair was tagged, then UNTAGGED on 2026-08-08 because the
  // old surface gate was refusing their only route - up through the half-lander
  // burn at burn-pel45 and back down - as "driving". Deleting the tag was the
  // wrong lever: the route really is a flight, but the road really is on the
  // board, and the tag also carries the buggy's free road scan and The Martian.
  // With the gate gone (a road is a BUGGY rule, see below) the tag costs a
  // rocket nothing, so the board's road is back where it belongs.
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

// ---- A ROAD IS BUGGY ONLY - and that is a BUGGY rule, not a rocket rule ----
//
// A road carries a BUGGY, under The Martian free action (H9b) and the buggy's
// free road scan (H9). That is what the tags above are for. A ROCKET is not
// bound by them at all: if the map graph gives a spacecraft a route between two
// Sites, it may fly it (user 2026-08-31).
//
// This file used to export a routeCrossesSurface() gate that refused a rocket
// any route joining two road-tagged Sites without an orbital node between them,
// on the belief that the vendored map graph "carries the roads as ordinary
// surface edges". It does not. The board's yellow dashed roads are DRAWN from
// BUGGY_ROADS above (js/game/render.js) and exist nowhere in the movement
// graph: of the 10 road pairs, ZERO are joined by a decorative-only chain, and
// every connection between them runs through a lander burn (sometimes a
// lagrange or a radiation belt as well). So the gate never once caught a drive
// - every route it refused was a rocket flying up a lander burn and back down,
// which is exactly what "fly back up and come down again at the other Site"
// asks for.
//
// It was reported twice for that reason: Titan's two lakes (2026-08-08, patched
// by deleting Titan's road tag - see the note above, which wrongly concluded
// "the tag is the ONLY thing that could be wrong here") and Callisto's Valhalla
// to Asgard Ice Spires (2026-08-31), whose only two routes are
// site -> dec -> burn -> dec -> site through burn-ph6aq and burn-gxqyl.
//
// scripts/check-engine.mjs pins the premise: if the vendored graph ever grows a
// genuine ground link between two road-tagged Sites, that check fails and this
// decision gets revisited on real data rather than on inference.
