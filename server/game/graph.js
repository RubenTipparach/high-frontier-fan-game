// Movement graph + pathfinding for the server-authoritative engine.
//
// The canonical movement graph is the pure data in data/sites.js:
// SITES (nodes, keyed by site id) and EDGES ([fromId, toId, dv] burn
// costs). The frontend's "clean map" (js/game/clean-map.js) renders
// the exact same SITES/EDGES with the exact same ids, so a site the
// player taps on the map is a site this graph can validate a route to.
// (The richer planner map under vendor/ uses opaque float ids and is
// browser-only, so it is deliberately NOT used here.)
//
// findPath is a standard Dijkstra over the undirected weighted graph,
// identical in behaviour to js/game/nav.js#findPath. It is vendored
// here rather than imported so the server stays decoupled from the
// frontend module tree (only data/ is shared).

import { SITES, SITES_BY_ID, EDGES } from '../../data/sites.js';

// Adjacency list, built once. Edges are undirected.
let _adj = null;
function adjacency() {
  if (_adj) return _adj;
  _adj = new Map();
  for (const id of Object.keys(SITES_BY_ID)) _adj.set(id, []);
  for (const [a, b, dv] of EDGES) {
    if (!_adj.has(a) || !_adj.has(b)) continue;
    const w = Number.isFinite(dv) ? dv : 1;
    _adj.get(a).push([b, w]);
    _adj.get(b).push([a, w]);
  }
  return _adj;
}

export function siteExists(id) {
  return !!SITES_BY_ID[id];
}

export function siteById(id) {
  return SITES_BY_ID[id] || null;
}

// Canonical launch site. There is no explicit "Earth / LEO" node in
// SITES, so the engine opens every ship at the cheapest-to-reach site
// in the Earth heliocentric zone (lowest dvLeo, id as a deterministic
// tie-break) so all games start from the same place.
let _startId = null;
export function startSiteId() {
  if (_startId) return _startId;
  let best = null;
  for (const s of SITES) {
    if (s.solarZone !== 'Earth') continue;
    if (
      !best ||
      s.dvLeo < best.dvLeo ||
      (s.dvLeo === best.dvLeo && s.id < best.id)
    ) {
      best = s;
    }
  }
  _startId = (best && best.id) || (SITES[0] && SITES[0].id) || null;
  return _startId;
}

// Shortest path between two site ids over the burn-cost graph.
// Returns { path: [id...], totalBurns, segments: [{from, to, dv}] }
// or null when unreachable / unknown ids.
export function findPath(fromId, toId) {
  const adj = adjacency();
  if (!adj.has(fromId) || !adj.has(toId)) return null;
  if (fromId === toId) return { path: [fromId], totalBurns: 0, segments: [] };

  const dist = new Map([[fromId, 0]]);
  const prev = new Map();
  const heap = new MinHeap();
  heap.push(0, fromId);

  while (heap.size > 0) {
    const { key, value: u } = heap.pop();
    if (key > (dist.get(u) ?? Infinity)) continue;
    if (u === toId) break;
    for (const [v, w] of adj.get(u) || []) {
      const alt = key + w;
      if (alt < (dist.get(v) ?? Infinity)) {
        dist.set(v, alt);
        prev.set(v, u);
        heap.push(alt, v);
      }
    }
  }

  if (!dist.has(toId)) return null;

  const path = [];
  let cur = toId;
  while (cur != null) {
    path.unshift(cur);
    if (cur === fromId) break;
    cur = prev.get(cur);
  }
  if (path[0] !== fromId) return null;

  const segments = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const w = (adj.get(a) || []).find(([v]) => v === b)?.[1] ?? 0;
    segments.push({ from: a, to: b, dv: w });
  }
  return { path, totalBurns: dist.get(toId), segments };
}

// Tiny binary min-heap. push(key, value); pop() returns the smallest.
class MinHeap {
  constructor() { this.data = []; }
  get size() { return this.data.length; }
  push(key, value) {
    this.data.push({ key, value });
    this._up(this.data.length - 1);
  }
  pop() {
    const top = this.data[0];
    const last = this.data.pop();
    if (this.data.length > 0) {
      this.data[0] = last;
      this._down(0);
    }
    return top;
  }
  _up(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.data[p].key <= this.data[i].key) break;
      [this.data[p], this.data[i]] = [this.data[i], this.data[p]];
      i = p;
    }
  }
  _down(i) {
    const n = this.data.length;
    while (true) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let m = i;
      if (l < n && this.data[l].key < this.data[m].key) m = l;
      if (r < n && this.data[r].key < this.data[m].key) m = r;
      if (m === i) break;
      [this.data[m], this.data[i]] = [this.data[i], this.data[m]];
      i = m;
    }
  }
}
