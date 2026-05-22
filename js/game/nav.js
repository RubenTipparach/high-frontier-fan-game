// Navigation engine: shortest-path between two nodes on either of
// our two map graphs (cleaned-up zone-derived or the canonical
// nornagon planner graph). The algorithm is standard Dijkstra over
// an undirected weighted graph; no external dependency.
//
// Returns:
//   { path: [nodeId, ...], totalBurns: N, segments: [{from, to, dv}] }
// or null if unreachable.

export function findPath(graph, fromId, toId) {
  if (!graph || !graph.byId[fromId] || !graph.byId[toId]) return null;
  if (fromId === toId) return { path: [fromId], totalBurns: 0, segments: [] };

  // Build an adjacency list once. Edge weights are the burn cost.
  // graph.edges is [from, to, dv][]; treat as undirected.
  const adj = new Map();
  for (const id of Object.keys(graph.byId)) adj.set(id, []);
  for (const [a, b, dv] of graph.edges) {
    if (!adj.has(a) || !adj.has(b)) continue;
    adj.get(a).push([b, dv]);
    adj.get(b).push([a, dv]);
  }

  // Min-heap keyed by distance. Tiny binary heap, plenty fast for
  // ~1500-node graphs which is well under the perf cliff.
  const dist = new Map();
  const prev = new Map();
  dist.set(fromId, 0);
  const heap = new MinHeap();
  heap.push(0, fromId);

  while (heap.size > 0) {
    const { key, value: u } = heap.pop();
    if (key > (dist.get(u) ?? Infinity)) continue;
    if (u === toId) break;
    for (const [v, w] of (adj.get(u) || [])) {
      const alt = key + w;
      if (alt < (dist.get(v) ?? Infinity)) {
        dist.set(v, alt);
        prev.set(v, u);
        heap.push(alt, v);
      }
    }
  }

  if (!dist.has(toId)) return null;

  // Walk the predecessor chain back to source.
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
    const a = path[i], b = path[i + 1];
    const w = (adj.get(a) || []).find(([v]) => v === b)?.[1] ?? 0;
    segments.push({ from: a, to: b, dv: w });
  }

  return { path, totalBurns: dist.get(toId), segments };
}

// Tiny binary min-heap. Push (key, value), pop the smallest key.
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
      const l = 2 * i + 1, r = 2 * i + 2;
      let m = i;
      if (l < n && this.data[l].key < this.data[m].key) m = l;
      if (r < n && this.data[r].key < this.data[m].key) m = r;
      if (m === i) break;
      [this.data[m], this.data[i]] = [this.data[i], this.data[m]];
      i = m;
    }
  }
}
