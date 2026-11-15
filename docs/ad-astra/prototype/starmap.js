// HIGH FRONTIER: AD ASTRA - the star map (AA-B6).
//
// The star systems within 20 light-years (starcat.js), drawn as seen from above
// the galactic plane, joined by a Delaunay triangulation of their drawn
// positions. Links longer than LINK_MAX_LY are dropped unless the map needs
// them to stay in one piece. Each link is a chain of spaces (half a light-year
// each, counted on the true 3D distance), with Oort spaces next to each star,
// a Dust space in the middle of long links, and Sunlens spaces on Sol's links.
// Pure: no DOM. Returns { nodes, adj, dist, links } in the shape game.js moves on.

export const LINK_MAX_LY = 12;    // AA-B6 [TUNE]: 170 links, 3.6 a star, 8 dead ends
export const DUST_OVER_LY = 10;   // AA-B6 [TUNE]: 35 Dust spaces
export const SPACE_LY = 0.5;      // AA-B6: one space
// the board: Sol at the centre, galactic x to the right, y up; squashed to fit
const VIEW = { cx: 700, cy: 425, sx: 33, sy: 19 };
const toBoard = (s) => ({ x: Math.round((VIEW.cx + s.x * VIEW.sx) * 10) / 10, y: Math.round((VIEW.cy - s.y * VIEW.sy) * 10) / 10 });

// Bowyer-Watson Delaunay triangulation (fine for ~100 points)
export function delaunay(pts) {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys), dx = Math.max(...xs) - minX, dy = Math.max(...ys) - minY, d = Math.max(dx, dy) * 20;
  const P = [...pts, { x: minX - d, y: minY - d }, { x: minX + dx / 2, y: minY + d + dy }, { x: minX + dx + d, y: minY - d }];
  const n = pts.length;
  const circ = (a, b, c) => {
    const A = P[a], B = P[b], C = P[c];
    const D = 2 * (A.x * (B.y - C.y) + B.x * (C.y - A.y) + C.x * (A.y - B.y));
    const ux = ((A.x ** 2 + A.y ** 2) * (B.y - C.y) + (B.x ** 2 + B.y ** 2) * (C.y - A.y) + (C.x ** 2 + C.y ** 2) * (A.y - B.y)) / D;
    const uy = ((A.x ** 2 + A.y ** 2) * (C.x - B.x) + (B.x ** 2 + B.y ** 2) * (A.x - C.x) + (C.x ** 2 + C.y ** 2) * (B.x - A.x)) / D;
    return { x: ux, y: uy, r2: (A.x - ux) ** 2 + (A.y - uy) ** 2 };
  };
  let tris = [{ v: [n, n + 1, n + 2], c: circ(n, n + 1, n + 2) }];
  for (let i = 0; i < n; i++) {
    const p = P[i];
    const bad = tris.filter((t) => (p.x - t.c.x) ** 2 + (p.y - t.c.y) ** 2 < t.c.r2);
    const edges = new Map();
    for (const t of bad) for (const [a, b] of [[t.v[0], t.v[1]], [t.v[1], t.v[2]], [t.v[2], t.v[0]]]) {
      const k = a < b ? `${a},${b}` : `${b},${a}`; edges.set(k, edges.has(k) ? null : [a, b]);
    }
    tris = tris.filter((t) => !bad.includes(t));
    for (const e of edges.values()) if (e) tris.push({ v: [e[0], e[1], i], c: circ(e[0], e[1], i) });
  }
  const out = new Set();
  for (const t of tris) for (const [a, b] of [[t.v[0], t.v[1]], [t.v[1], t.v[2]], [t.v[2], t.v[0]]]) if (a < n && b < n) out.add(a < b ? `${a},${b}` : `${b},${a}`);
  return [...out].map((k) => k.split(',').map(Number));
}

// stars: [{ id, name, x, y, z (ly, galactic) }], with Sol { id: 'sol', x: 0, y: 0, z: 0 }
export function buildStarMap(stars) {
  const pts = stars.map(toBoard);
  const ly3 = (a, b) => Math.hypot(stars[a].x - stars[b].x, stars[a].y - stars[b].y, stars[a].z - stars[b].z);
  const tri = delaunay(pts).map(([a, b]) => ({ a, b, ly: ly3(a, b) }));
  // keep short links; keep long ones only where the map would fall apart (a minimum spanning tree)
  const parent = stars.map((_, i) => i); const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const mst = new Set();
  for (const e of [...tri].sort((p, q) => p.ly - q.ly)) { const ra = find(e.a), rb = find(e.b); if (ra !== rb) { parent[ra] = rb; mst.add(e); } }
  const links = tri.filter((e) => e.ly <= LINK_MAX_LY || mst.has(e));

  const nodes = {}; const adj = {};
  const add = (id, o) => { nodes[id] = { id, ...o }; adj[id] = adj[id] || []; };
  const link = (a, b) => { adj[a].push(b); adj[b].push(a); };
  stars.forEach((s, i) => add(s.id, s.id === 'sol' ? { kind: 'sol', ...pts[i], label: 'Sol' } : { kind: 'star', star: s.id, ...pts[i], label: s.name }));
  const solI = stars.findIndex((s) => s.id === 'sol');
  const bearing = (i, j) => Math.atan2(pts[j].y - pts[i].y, pts[j].x - pts[i].x);
  links.forEach((e, li) => {
    const A = stars[e.a].id, B = stars[e.b].id;
    const steps = Math.max(3, Math.ceil(e.ly / SPACE_LY));
    e.id = li; e.from = A; e.to = B; e.spaces = steps;
    let prev = A;
    for (let k = 1; k < steps; k++) {
      const t = k / steps; const id = `L${li}_${k}`;
      add(id, { kind: 'space', link: li, x: Math.round((pts[e.a].x + (pts[e.b].x - pts[e.a].x) * t) * 10) / 10, y: Math.round((pts[e.a].y + (pts[e.b].y - pts[e.a].y) * t) * 10) / 10 });
      if (k === 1) Object.assign(nodes[id], { kind: 'oort', of: A });            // the comet cloud next to each star
      if (k === steps - 1) Object.assign(nodes[id], { kind: 'oort', of: B });
      if (e.ly > DUST_OVER_LY && k === Math.floor(steps / 2)) nodes[id].kind = 'dust';
      link(prev, id); prev = id;
    }
    link(prev, B);
    // Sol's lens points: the second space out along each Sol link looks back through
    // the Sun at the star most nearly opposite that link
    if (e.a === solI || e.b === solI) {
      const out = e.a === solI ? e.b : e.a; const sp = e.a === solI ? `L${li}_2` : `L${li}_${steps - 2}`;
      const back = bearing(solI, out) + Math.PI;
      let best = null, bestD = Infinity;
      stars.forEach((s, j) => { if (j === solI) return; const dd = Math.abs(Math.atan2(Math.sin(bearing(solI, j) - back), Math.cos(bearing(solI, j) - back))); if (dd < bestD) { bestD = dd; best = s.id; } });
      if (nodes[sp] && nodes[sp].kind === 'space') Object.assign(nodes[sp], { kind: 'sunlens', target: best });
    }
  });
  // distance from Sol in spaces (beam range, lens range)
  const dist = { sol: 0 }; const q = ['sol'];
  while (q.length) { const n = q.shift(); for (const m of adj[n]) if (dist[m] == null) { dist[m] = dist[n] + 1; q.push(m); } }
  return { nodes, adj, dist, links: links.map(({ id, from, to, ly, spaces }) => ({ id, from, to, ly: Math.round(ly * 100) / 100, spaces })) };
}
