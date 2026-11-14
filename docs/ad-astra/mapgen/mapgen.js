// HIGH FRONTIER: AD ASTRA - system map generator + validator.
//
// Builds a star-system map that follows docs/ad-astra/system-map-rules.md (the
// SM rules, measured off the real HF Sol board). Pure: no DOM, no imports, so
// the map builder page, the game and the validator CLI all share it. Every
// construction step cites its SM rule; validateMap() checks SM-10.
//
// Spec:
//   { name, starType: 'yellow'|'red'|'brown', zones: 4..9,
//     bodies: [{ id, kind: 'planet'|'giant'|'dwarf'|'asteroid', name, zone (0 = innermost),
//                angle (deg, optional), size 1..11, sites 1..3, atmosphere, cls,
//                moons: [{ name, size, sites, ocean }] (giants) }] }

export const SOL_ZONE_PALETTE = ['#fdf441', '#fefab1', '#f97316', '#ffdd92', '#97a0bf', '#585e90', '#2b3534', '#2a2d4c', '#1d102e'];
export const WORLD = { cx: 700, cy: 450, kx: 1.45, ky: 0.95, inner: 70, outer: 420 };

// SM-4a: escape burns by size; SM-5c: landing by size; SM-4c: flyby boost
export const wellBurns = (size) => (size <= 5 ? 1 : size <= 7 ? 2 : 3);
export const landingOf = (size) => (size >= 7 ? 'full' : size >= 4 ? 'half' : 'none');
export const flybyOf = (size) => (size >= 11 ? 4 : size >= 10 ? 2 : size >= 8 ? 1 : 0);
export const moonEscape = (size) => Math.max(1, wellBurns(size) - 1); // SM-4b: the giant's well comes first

export const SITE_GAP = 32; // SM-5e: world px between any two sites
const deg = (a) => (a * Math.PI) / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round1 = (v) => Math.round(v * 10) / 10;

export function zoneBounds(n) { // SM-1a: b[0]=0 (star) .. b[n]=outer edge
  const b = [0];
  for (let k = 1; k <= n; k++) b.push(WORLD.inner + ((WORLD.outer - WORLD.inner) * (k - 1)) / Math.max(1, n - 1));
  return b;
}
const P = (a, r) => ({ x: round1(WORLD.cx + Math.cos(deg(a)) * r * WORLD.kx), y: round1(WORLD.cy + Math.sin(deg(a)) * r * WORLD.ky) });
export function radiusOf(x, y) { return Math.hypot((x - WORLD.cx) / WORLD.kx, (y - WORLD.cy) / WORLD.ky); }

// SM-1c: the zone bands as the renderer draws them (setCanonicalZones), with
// the Sol palette sampled inner to outer. Depends only on the zone count, so a
// saved system can keep just the count and redraw its bands.
export function zoneLayer(N) {
  const b = zoneBounds(N);
  return {
    order: Array.from({ length: N }, (_, k) => `Z${k + 1}`),
    colors: Object.fromEntries(Array.from({ length: N }, (_, k) => [`Z${k + 1}`, SOL_ZONE_PALETTE[Math.round((k * 8) / Math.max(1, N - 1))]])),
    polys: Object.fromEntries(Array.from({ length: N }, (_, k) => [`Z${k + 1}`, [Array.from({ length: 48 }, (_, i) => P((i * 360) / 48, b[k + 1]))]])),
    bounds: b,
  };
}

export function buildMap(spec) {
  const N = clamp(spec.zones | 0 || 6, 4, 9);
  const b = zoneBounds(N);
  const mid = (k) => (k === 0 ? b[1] * 0.62 : (b[k] + b[k + 1]) / 2);
  const zoneAt = (x, y) => { const r = radiusOf(x, y); for (let k = 0; k < N; k++) if (r < b[k + 1]) return k; return N; };
  const nodes = []; const edges = []; const sites = []; const bodies = [];
  const byId = {};
  let seq = 0;
  const add = (kind, pos, extra = {}) => { const id = extra.id || `n${seq++}`; const n = { id, kind, x: pos.x, y: pos.y, zone: zoneAt(pos.x, pos.y), tags: {}, ...extra }; nodes.push(n); byId[id] = n; return id; };
  const link = (a, c) => { if (a && c && a !== c) edges.push([a, c]); };

  // a route between two real nodes: `stops` are real nodes along the way at
  // fraction t, decoratives fill the gaps so it draws as a curve (SM-8a)
  const route = (from, to, stops = [], bow = 0.12, step = 30) => {
    const A = byId[from], B = byId[to];
    const dx = B.x - A.x, dy = B.y - A.y;
    const cx = (A.x + B.x) / 2 - dy * bow, cy = (A.y + B.y) / 2 + dx * bow;
    const at = (t) => ({ x: round1((1 - t) * (1 - t) * A.x + 2 * (1 - t) * t * cx + t * t * B.x), y: round1((1 - t) * (1 - t) * A.y + 2 * (1 - t) * t * cy + t * t * B.y) });
    const len = Math.hypot(dx, dy) * (1 + Math.abs(bow));
    const marks = [0, ...stops.map((s) => s.t), 1];
    const ids = [from];
    for (let i = 0; i < marks.length - 1; i++) {
      const t0 = marks[i], t1 = marks[i + 1];
      const nDec = Math.max(0, Math.round(((t1 - t0) * len) / step) - 1);
      for (let j = 1; j <= nDec; j++) ids.push(add('decorative', at(t0 + ((t1 - t0) * j) / (nDec + 1))));
      if (i < stops.length) ids.push(add(stops[i].kind, at(stops[i].t), stops[i].extra || {}));
    }
    ids.push(to);
    for (let i = 0; i < ids.length - 1; i++) link(ids[i], ids[i + 1]);
    return ids;
  };
  // an arc along a zone ring between two angles, free Hohmann travel (SM-2b)
  const arc = (from, to, r, a0, a1, hazardAt = null) => {
    let span = a1 - a0; while (span <= 0) span += 360;
    const nDec = Math.max(1, Math.round(span / 9) - 1);
    let prev = from;
    for (let j = 1; j <= nDec; j++) {
      const a = a0 + (span * j) / (nDec + 1);
      const isHaz = hazardAt != null && j === Math.round((nDec + 1) / 2);
      const id = add(isHaz ? 'radhaz' : 'decorative', P(a, r)); // SM-6a
      link(prev, id); prev = id;
    }
    link(prev, to);
  };

  add('star', { x: WORLD.cx, y: WORLD.cy }, { id: 'star', label: spec.name || 'Star' });

  // ---- bodies: auto-spread angles within a zone if not given
  const bodiesIn = {};
  (spec.bodies || []).forEach((bd, i) => { const z = clamp(bd.zone | 0, 0, N - 1); (bodiesIn[z] = bodiesIn[z] || []).push({ ...bd, zone: z, idx: i }); });
  for (const list of Object.values(bodiesIn)) {
    list.forEach((bd, j) => { if (bd.angle == null) bd.angle = (200 + (360 * j) / list.length + bd.zone * 37) % 360; });
  }
  // ---- SM-2: a ring of pivots per zone; SM-3a spokes carry the radial transfers
  const SPOKES = [270, 30, 150]; // 270 = toward the arrival edge (top)
  const ringPivots = []; // per zone: [{ a, id }]
  for (let k = 0; k < N; k++) {
    const angles = new Set(SPOKES);
    for (const bd of bodiesIn[k] || []) angles.add(Math.round(bd.angle));
    const list = [...angles].sort((p, q) => p - q).filter((a, i, arr) => i === 0 || a - arr[i - 1] >= 6);
    ringPivots[k] = list.map((a) => ({ a, id: add('hohmann', P(a, mid(k))) }));
  }
  for (let k = 0; k < N; k++) {
    const ring = ringPivots[k];
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      if (ring.length === 1) break;
      arc(p.id, q.id, mid(k), p.a, q.a, k === 0 ? true : null); // SM-6a: radiation on the star's ring
    }
  }
  const pivotAt = (k, a) => ringPivots[k].reduce((best, p) => (Math.abs(((p.a - a + 540) % 360) - 180) < Math.abs(((best.a - a + 540) % 360) - 180) ? p : best), ringPivots[k][0]);
  // SM-3a: one burn on each zone boundary along every spoke
  for (const a of SPOKES) {
    for (let k = 0; k < N - 1; k++) {
      const from = pivotAt(k, a), to = pivotAt(k + 1, a);
      const t = (b[k + 1] - mid(k)) / (mid(k + 1) - mid(k));
      route(from.id, to.id, [{ kind: 'burn', t: clamp(t, 0.2, 0.8), extra: { purpose: 'transition' } }], 0.04);
    }
  }
  // SM-9a: arrival outside the outer zone; one burn crossing into it
  const high = add('orbit', P(270, WORLD.outer + 26), { id: 'high', label: 'System edge (arrival)' });
  route(high, pivotAt(N - 1, 270).id, [{ kind: 'burn', t: 0.45, extra: { purpose: 'transition' } }], 0);

  // ---- SM-4 / SM-5 / SM-7: each body's well
  const outward = (a) => ({ ux: Math.cos(deg(a)) * WORLD.kx, uy: Math.sin(deg(a)) * WORLD.ky });
  const placeSites = (bodyName, kind, centre, count, around, dist, size, landing, atmos, extra = {}, spreadDeg = 62) => {
    const ids = [];
    for (let i = 0; i < count; i++) {
      const ang = around + (count === 1 ? 0 : (i - (count - 1) / 2) * spreadDeg); // SM-5e: SITE_GAP apart
      const pos = { x: round1(centre.x + Math.cos(deg(ang)) * dist), y: round1(centre.y + Math.sin(deg(ang)) * dist) };
      const sid = add('site', pos, { body: bodyName, bodyKind: kind, size, region: i, ...extra });
      sites.push(byId[sid]); ids.push({ sid, pos });
    }
    return ids;
  };
  const landTo = (lagId, siteId, landing, hazardous, aerobrake) => {
    if (landing === 'none') { link(lagId, siteId); return; } // SM-5c small bodies
    const L = byId[lagId], S = byId[siteId];
    const lb = add('burn', { x: round1((L.x + S.x) / 2), y: round1((L.y + S.y) / 2) }, { purpose: 'landing', land: landing });
    byId[lb].tags.lander = true; if (landing === 'half') byId[lb].tags.half = true;
    if (hazardous || aerobrake) byId[lb].tags.hazard = true; // SM-6c
    if (aerobrake) byId[lb].tags.aerobrake = true;
    link(lagId, lb); link(lb, siteId);
  };
  for (const bd of (spec.bodies || []).map((x, i) => ({ ...x, ...(Object.values(bodiesIn).flat().find((q) => q.idx === i) || {}) }))) {
    const k = bd.zone; const a = bd.angle; const size = clamp(bd.size | 0 || 4, 1, 11);
    const dep = pivotAt(k, a);
    const w = b[k + 1] - b[k];
    const isGiant = bd.kind === 'giant';
    const centre = P(a, mid(k) + (isGiant ? 0.42 : 0.36) * w);
    const lag = add('lagrange', isGiant ? centre : P(a, mid(k) + 0.24 * w), { purpose: 'orbit', body: bd.name, fly: flybyOf(size) || null });
    if (k === 0) byId[lag].tags.hazard = true; // SM-6b
    const esc = isGiant ? 3 : wellBurns(size); // SM-7a / SM-4a
    route(dep.id, lag, Array.from({ length: esc }, (_, i) => ({ kind: 'burn', t: (i + 1) / (esc + 1), extra: { purpose: 'escape', body: bd.name } })), 0.18, 16);
    const out = outward(a); const outAng = (Math.atan2(out.uy, out.ux) * 180) / Math.PI;
    if (isGiant) {
      bodies.push({ id: `${lag}-body`, name: bd.name, kind: bd.giantKind || 'gas', x: centre.x, y: centre.y, size });
      const moons = bd.moons || [];
      moons.forEach((m, i) => { // SM-7b: hub -> radiation belt -> moon well -> moon orbit -> landing -> sites
        // fan the moons round the far side of the hub, alternating near / far so
        // neighbouring moons' sites stay SITE_GAP apart (SM-5e)
        const fan = Math.min(200, 56 * (moons.length - 1));
        const spread = moons.length === 1 ? 0 : (i - (moons.length - 1) / 2) * (fan / Math.max(1, moons.length - 1));
        const ma = outAng + spread; const md = 62 + (i % 2) * 26;
        const mc = { x: round1(centre.x + Math.cos(deg(ma)) * md), y: round1(centre.y + Math.sin(deg(ma)) * md * 0.85) };
        const msize = clamp(m.size | 0 || 6, 1, 9);
        if (msize <= 2) { // SM-7c moonlet: one burn, one site
          const s = placeSites(m.name, 'moon', mc, 1, ma, 0, msize, 'none', false, { moonOf: bd.name, ocean: !!m.ocean })[0];
          route(lag, s.sid, [{ kind: 'burn', t: 0.55, extra: { purpose: 'escape', body: m.name } }], 0.1, 18);
          return;
        }
        const mlag = add('lagrange', { x: round1(centre.x + Math.cos(deg(ma)) * (md - 16)), y: round1(centre.y + Math.sin(deg(ma)) * (md - 16) * 0.85) }, { purpose: 'orbit', body: m.name });
        const me = moonEscape(msize);
        route(lag, mlag, [{ kind: 'radhaz', t: 0.3 }, ...Array.from({ length: me }, (_, j) => ({ kind: 'burn', t: 0.45 + (0.45 * (j + 1)) / (me + 1), extra: { purpose: 'escape', body: m.name } }))], 0.12, 14);
        const ss = placeSites(m.name, 'moon', mc, clamp(m.sites | 0 || 1, 1, 2), ma, 24, msize, landingOf(msize), false, { moonOf: bd.name, ocean: !!m.ocean }, 84);
        ss.forEach((s, j) => landTo(mlag, s.sid, landingOf(msize), j === 0 && msize >= 8, false));
      });
    } else {
      const count = bd.kind === 'planet' ? clamp(bd.sites | 0 || 1, 1, 3) : 1; // SM-5a
      const landing = landingOf(size);
      const dist = bd.kind === 'planet' ? 33 : 14;
      const ss = placeSites(bd.name, bd.kind, centre, count, outAng, dist, size, landing, !!bd.atmosphere, { cls: bd.cls || null });
      ss.forEach((s, j) => landTo(lag, s.sid, landing, false, !!bd.atmosphere && j === 0)); // SM-6c aerobrake on one landing
    }
  }
  const zones = zoneLayer(N);
  const map = { spec, nodes, edges, sites, bodies, zones };
  map.report = validateMap(map);
  return map;
}

// ---- SM-10 validation
export function validateMap(map) {
  const { nodes, edges } = map;
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const adj = {}; for (const n of nodes) adj[n.id] = [];
  for (const [a, c] of edges) { adj[a].push(c); adj[c].push(a); }
  const out = [];
  const check = (rule, ok, detail) => out.push({ rule, ok, detail });
  // 1. no dead ends; decoratives exactly 2 edges
  const dead = nodes.filter((n) => !['site', 'star', 'orbit'].includes(n.kind) && adj[n.id].length < 2);
  check('SM-8b no dead ends', dead.length === 0, dead.length ? `${dead.length} dead ends: ${dead.slice(0, 5).map((n) => n.id).join(', ')}` : 'every route goes somewhere');
  const badDec = nodes.filter((n) => n.kind === 'decorative' && adj[n.id].length !== 2);
  check('SM-8a curves have 2 edges', badDec.length === 0, badDec.length ? `${badDec.length} bad curve nodes` : `${nodes.filter((n) => n.kind === 'decorative').length} curve nodes`);
  // 2. zone crossings carry a burn (look through curves)
  const real = (id) => { const res = []; for (const f of adj[id]) { let p = id, c = f, g = 0; while (byId[c].kind === 'decorative' && g++ < 400) { const nx = adj[c].find((m) => m !== p); if (!nx) break; p = c; c = nx; } res.push(c); } return res; };
  let crossings = 0, crossOk = 0;
  for (const n of nodes) {
    if (n.kind === 'decorative') continue;
    for (const m of real(n.id)) {
      if (n.id > m) continue;
      const nm = byId[m];
      if (n.zone !== nm.zone && n.kind !== 'site' && nm.kind !== 'site' && n.kind !== 'star' && nm.kind !== 'star') {
        if (n.purpose === 'escape' || nm.purpose === 'escape' || n.purpose === 'orbit' || nm.purpose === 'orbit') continue; // a well may straddle a boundary
        crossings++; if (n.kind === 'burn' || nm.kind === 'burn') crossOk++;
      }
    }
  }
  check('SM-3a zone crossings carry a burn', crossings === crossOk, `${crossOk}/${crossings} crossings`);
  // 3. every burn has a purpose
  const burns = nodes.filter((n) => n.kind === 'burn');
  const purpose = burns.reduce((a, n) => { a[n.purpose || 'none'] = (a[n.purpose || 'none'] || 0) + 1; return a; }, {});
  check('SM-3 every burn has a purpose', !purpose.none, `transition ${purpose.transition || 0}, escape ${purpose.escape || 0}, landing ${purpose.landing || 0}${purpose.none ? `, NONE ${purpose.none}` : ''}`);
  // 4. well depth by size: burns from a site out to the nearest pivot
  const wellDepth = (s) => {
    const dist = { [s]: 0 }; const open = [s]; const done = new Set();
    while (open.length) { open.sort((p, q) => dist[p] - dist[q]); const n = open.shift(); if (done.has(n)) continue; done.add(n); if (byId[n].kind === 'hohmann') return dist[n]; for (const m of adj[n]) { const nd = dist[n] + (byId[m].kind === 'burn' ? 1 : 0); if (dist[m] == null || nd < dist[m]) { dist[m] = nd; open.push(m); } } }
    return null;
  };
  // SM-4a: worlds (planets, dwarfs, asteroids) deepen with size; SM-4b: moons
  // sit deeper than their giant's own well, so they are checked on their own
  const wells = {}; const moonBad = []; let moonCount = 0;
  for (const s of nodes.filter((n) => n.kind === 'site')) {
    const d = wellDepth(s.id);
    if (s.bodyKind === 'moon') { moonCount++; if (d == null || d < 4) moonBad.push(s.body); continue; } // giant 3 + at least 1 of its own
    (wells[s.size] = wells[s.size] || []).push(d);
  }
  const wellText = Object.entries(wells).sort((p, q) => p[0] - q[0]).map(([sz, ds]) => `size ${sz}: ${(ds.reduce((a, c) => a + c, 0) / ds.length).toFixed(1)}`).join(' | ');
  const mono = Object.entries(wells).sort((p, q) => p[0] - q[0]).map(([, ds]) => Math.min(...ds));
  check('SM-4a bigger worlds have deeper wells', mono.every((v, i) => i === 0 || v >= mono[i - 1]), wellText || 'no worlds');
  check('SM-4b moons inherit the giant\'s well', moonBad.length === 0, moonBad.length ? `too shallow: ${[...new Set(moonBad)].join(', ')}` : `${moonCount} moon sites, all 4+ burns deep`);
  // 5. sites: one edge, reachable from arrival
  const multi = nodes.filter((n) => n.kind === 'site' && adj[n.id].length !== 1);
  check('SM-5b each site has one edge', multi.length === 0, multi.length ? `${multi.length} sites with ${multi.map((n) => adj[n.id].length).join('/')}` : `${nodes.filter((n) => n.kind === 'site').length} sites`);
  const seen = new Set(['high']); const q = ['high'];
  while (q.length) { const n = q.shift(); for (const m of adj[n] || []) if (!seen.has(m)) { seen.add(m); q.push(m); } }
  const unreach = nodes.filter((n) => n.kind === 'site' && !seen.has(n.id));
  check('SM-8c every site reachable', unreach.length === 0, unreach.length ? `${unreach.length} unreachable` : 'all reachable from the edge');
  // 6. radiation only in the star's zone or a giant's belt
  const giantLags = new Set(nodes.filter((n) => n.kind === 'lagrange' && map.bodies.some((bd) => bd.x === n.x && bd.y === n.y)).map((n) => n.id));
  const stray = nodes.filter((n) => n.kind === 'radhaz' && n.zone !== 0 && !adj[n.id].some((m) => { let p = n.id, c = m, g = 0; while (byId[c].kind === 'decorative' && g++ < 200) { const nx = adj[c].find((x) => x !== p); if (!nx) break; p = c; c = nx; } return giantLags.has(c); }));
  check('SM-6a radiation only near the star or a giant', stray.length === 0, stray.length ? `${stray.length} stray radiation nodes` : `${nodes.filter((n) => n.kind === 'radhaz').length} radiation nodes`);
  // 7. site spacing
  const ss = nodes.filter((n) => n.kind === 'site'); let close = 0;
  for (let i = 0; i < ss.length; i++) for (let j = i + 1; j < ss.length; j++) if (Math.hypot(ss[i].x - ss[j].x, ss[i].y - ss[j].y) < SITE_GAP) close++; // same body too: hexes must not stack
  check(`SM-5e sites at least ${SITE_GAP} px apart`, close === 0, close ? `${close} pairs too close` : 'labels clear');
  return out;
}
