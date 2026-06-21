// Adapts the extracted Alpha Centauri map (data/rat-frontier/alpha-centauri-map.js)
// into the EXACT object shape the original planner map returns
// (js/game/planner-map.js#loadPlannerMap), so the original MapRenderer draws it
// with zero renderer changes: { sites, edges, byId, chains, straightEdges,
// edgeLabels, directedEdges, neighbors, mode }.

import { ALPHA_CENTAURI_MAP } from '../../../data/rat-frontier/alpha-centauri-map.js';

let _cache = null;

export function loadRatMap() {
  if (_cache) return _cache;
  const sites = ALPHA_CENTAURI_MAP.sites.map((s) => ({
    ...s,
    id2: s.id2 || s.id,
    bodyKey: s.id,               // each node is its own body (no shared halos)
    isDecorative: false,
    solarZone: s.solarZone || null,
    aeroLandable: false,
    hazard: false,
  }));
  const byId = Object.fromEntries(sites.map((s) => [s.id, s]));
  const edges = (ALPHA_CENTAURI_MAP.edges || [])
    .filter(([a, b]) => byId[a] && byId[b])
    .map(([a, b]) => [a, b]);
  const neighbors = new Map();
  const addNbr = (a, b) => {
    if (!neighbors.has(a)) neighbors.set(a, new Set());
    neighbors.get(a).add(b);
  };
  for (const [a, b] of edges) { addNbr(a, b); addNbr(b, a); }

  _cache = {
    sites,
    edges,
    byId,
    chains: [],                  // no decorative bezier chains (draw straight)
    straightEdges: edges,
    edgeLabels: {},
    directedEdges: [],
    neighbors,
    mode: 'classic',
  };
  return _cache;
}
