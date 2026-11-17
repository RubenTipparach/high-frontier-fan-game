// Planner nodes whose TYPE differs from the vendored planner JSON
// (vendor/hf-mission-planner/assets/data-hf4.json, a submodule we do not edit),
// keyed by id2 slug. The slug keeps its original prefix, so node tags, zones and
// one-way arrows keyed by it still apply. Read by BOTH the client map
// (js/game/planner-map.js) and the server graph (server/game/planner-graph.js).
// Pure data: no DOM, no node: imports.
export const NODE_TYPE_OVERRIDES = {
  // Board reprint correction (user 2026-11-16): the dotted arrow from Titan
  // Aerostat to Ontario Lacus runs through a parachute (aerobrake) SPACE. The
  // board the planner was traced from had only a bend there. As a lagrange it is
  // a real space: drawn with its ring and parachute, it splits the curve into
  // two segments, and a ship may stop on it. (Tagged aerobrake in
  // data/node-tag-overrides.json.)
  'dec-88pxv': 'lagrange',
};
