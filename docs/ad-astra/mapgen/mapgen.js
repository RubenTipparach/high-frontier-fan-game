// HIGH FRONTIER: AD ASTRA - system map generator + validator.
//
// Builds a star-system map that follows docs/ad-astra/system-map-rules.md (the
// SM rules, measured off the real HF Sol board). Pure: no DOM, no imports, so
// the map builder page, the game and the validator CLI all share it. Every
// construction step cites its SM rule; validateMap() checks SM-10.
//
// Spec:
//   { name, starType, zones,                       (one star; or:)
//     stars: [{ name, type: 'yellow'|'red'|'brown'|'white', zones, role: 'primary'|'binary'|'distant' }],
//     bodies: [{ kind: 'planet'|'giant'|'dwarf'|'asteroid'|'belt'|'comet', name, star (index, default 0),
//                zone (0 = innermost), angle (deg, optional: placed by SM-5h when absent),
//                size 1..11, sites 1..3, atmosphere, cls,
//                moons: [{ name, size, sites, ocean }], trojans: n per side   (giants: size 1-2 = minor)
//                count, sizes: [..]                                          (belts) }] }

export const SOL_ZONE_PALETTE = ['#fdf441', '#fefab1', '#f97316', '#ffdd92', '#97a0bf', '#585e90', '#2b3534', '#2a2d4c', '#1d102e'];
export const WORLD = { cx: 700, cy: 450, kx: 1.45, ky: 0.95, inner: 70, outer: 420, w: 1400, h: 900 }; // a lone star fills the board

// SM-4a: escape burns by size; SM-5c: landing by size; SM-4c: flyby boost
export const wellBurns = (size) => (size <= 5 ? 1 : size <= 7 ? 2 : 3);
export const landingOf = (size) => (size >= 7 ? 'full' : size >= 4 ? 'half' : 'none');
export const flybyOf = (size) => (size >= 11 ? 4 : size >= 10 ? 2 : size >= 8 ? 1 : 0);
export const moonEscape = (size) => Math.max(1, wellBurns(size) - 1); // SM-4b: the giant's ladder comes first

export const SITE_GAP = 26; // SM-5e: the Sol board's own closest pair of sites
export const NODE_GAP = 10; // SM-5i: the Sol board keeps 99% of its route nodes 10+ px apart
export const MIN_ANGLE = 30; // SM-5i: and 95% of its nodes' connections 30+ degrees apart
const STEP = 13; // px per stop along a well, so stops sit NODE_GAP apart with room to spare
export const GIANT_HALO = 24; // a giant's sphere radius on these boards (world px)
// SM-1f / 5f / 5g / 7c design targets
export const SEASONS = ['red', 'yellow', 'blue']; // SM-5g / AA-D3a: the Comet Cycle
const lift = (p, dy) => ({ x: p.x, y: round1(p.y - dy) });
export const TARGETS = { planets: [4, 15], asteroids: [30, 50], comets: 10, majors: [4, 10], minors: [10, 15] };
const deg = (a) => (a * Math.PI) / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round1 = (v) => Math.round(v * 10) / 10;
const ZONES_FOR = { primary: [4, 9], binary: [3, 6], distant: [2, 3] };

// SM-1e: where each star's system sits on the 1400 x 900 board
export function starLayout(stars) {
  const hasB = stars.some((s) => s.role === 'binary');
  const hasD = stars.some((s) => s.role === 'distant');
  const at = (cx, cy, inner, outer) => ({ cx, cy, inner, outer, kx: WORLD.kx, ky: WORLD.ky });
  return stars.map((s, i) => {
    const role = i === 0 ? 'primary' : s.role;
    // SM-11b: a binary partner or distant companion may be moved by hand (cx, cy)
    if (role === 'binary') return at(s.cx ?? 1080, s.cy ?? 470, 40, 180);
    if (role === 'distant') return at(s.cx ?? 1240, s.cy ?? 128, 24, 104);
    if (hasB) return at(400, 470, 48, 250);
    if (hasD) return at(590, 470, 60, 355);
    return at(WORLD.cx, WORLD.cy, WORLD.inner, WORLD.outer);
  });
}
const normStars = (spec) => (spec.stars && spec.stars.length ? spec.stars : [{ name: spec.name, type: spec.starType, zones: spec.zones }])
  .map((s, i) => { const role = i === 0 ? 'primary' : (s.role === 'distant' ? 'distant' : 'binary'); const [lo, hi] = ZONES_FOR[role]; return { ...s, role, zones: clamp(s.zones | 0 || (role === 'primary' ? 6 : role === 'binary' ? 4 : 3), lo, hi) }; });

export function zoneBounds(n, L = WORLD) { // SM-1a: b[0]=0 (star) .. b[n]=outer edge
  const b = [0];
  for (let k = 1; k <= n; k++) b.push(L.inner + ((L.outer - L.inner) * (k - 1)) / Math.max(1, n - 1));
  return b;
}
const P = (L, a, r) => ({ x: round1(L.cx + Math.cos(deg(a)) * r * L.kx), y: round1(L.cy + Math.sin(deg(a)) * r * L.ky) });
export function radiusOf(x, y, L = WORLD) { return Math.hypot((x - L.cx) / L.kx, (y - L.cy) / L.ky); }
const angleTo = (L, x, y) => ((Math.atan2((y - L.cy) / L.ky, (x - L.cx) / L.kx) * 180) / Math.PI + 360) % 360;
const outAngOf = (L, a) => (Math.atan2(Math.sin(deg(a)) * L.ky, Math.cos(deg(a)) * L.kx) * 180) / Math.PI;
// SM-5i: a body's well leaves its ring pivot leaning 45 degrees off the radial
// line (alternately ahead / behind), long enough that every stop on it sits
// STEP px from the next. Returns the pivot point, the well's direction and a
// point `len` px along it.
const wellDir = (L, a, sign, lean = 45) => { const o = deg(outAngOf(L, a) + sign * lean); return { x: Math.cos(o), y: Math.sin(o) }; };
// lean further off the radial line when the well is long, so it stays inside its own zone
const leanFor = (len, w) => Math.max(45, Math.min(72, (Math.acos(Math.min(1, (0.38 * w) / len)) * 180) / Math.PI));
const along = (p, d, len, up = 0) => ({ x: round1(p.x + d.x * len), y: round1(p.y + d.y * len - up) });
const hash = (str) => { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return Math.abs(h); };

// SM-1c: the zone bands as the renderer draws them (setCanonicalZones), with
// the Sol palette sampled inner to outer. Takes a zone count (one star) or the
// star list, so a saved system can keep just its stars and redraw its bands.
// `restart` names each further star's innermost zone: its nesting starts over.
export function zoneLayer(starsOrN) {
  const stars = typeof starsOrN === 'number' ? [{ zones: starsOrN, role: 'primary' }] : normStars({ stars: starsOrN });
  const Ls = starLayout(stars);
  const out = { order: [], colors: {}, polys: {}, bounds: [], restart: [] };
  stars.forEach((s, i) => {
    const N = s.zones; const b = zoneBounds(N, Ls[i]); out.bounds.push(b);
    for (let k = 0; k < N; k++) {
      const z = i === 0 ? `Z${k + 1}` : `S${i + 1}-Z${k + 1}`;
      out.order.push(z); if (i > 0 && k === 0) out.restart.push(z);
      out.colors[z] = SOL_ZONE_PALETTE[Math.round((k * 8) / Math.max(1, N - 1))];
      out.polys[z] = [Array.from({ length: 48 }, (_, j) => P(Ls[i], (j * 360) / 48, b[k + 1]))];
    }
  });
  return out;
}

// SM-7c geometry of a giant's moon system (world px from the giant)
const SHELL = { inner: 62, outer: 98, minor: 156 };
const HALF_GAP = 13; // SITE_GAP / 2: a footprint reaches half a gap past its farthest site
const giantReach = (it) => ((it.moons || []).some((m) => (m.size | 0 || 6) <= 2) ? SHELL.minor + 24 : SHELL.outer + 22) + HALF_GAP;

export function buildMap(spec) {
  const stars = normStars(spec);
  const Ls = starLayout(stars);
  const S = stars.map((s, i) => { const b = zoneBounds(s.zones, Ls[i]); return { ...s, i, L: Ls[i], N: s.zones, b, mid: (k) => (k === 0 ? b[1] * 0.62 : (b[k] + b[k + 1]) / 2) }; });
  const where = (x, y) => { for (const st of S) { const r = radiusOf(x, y, st.L); if (r < st.b[st.N]) { for (let k = 0; k < st.N; k++) if (r < st.b[k + 1]) return { star: st.i, zone: k }; } } return { star: -1, zone: -1 }; };
  const nodes = []; const edges = []; const sites = []; const bodies = [];
  const byId = {};
  let seq = 0;
  const add = (kind, pos, extra = {}) => { const id = extra.id || `n${seq++}`; const n = { id, kind, x: pos.x, y: pos.y, ...where(pos.x, pos.y), tags: {}, ...extra }; nodes.push(n); byId[id] = n; return id; };
  const link = (a, c) => { if (a && c && a !== c) edges.push([a, c]); };

  // a route between two real nodes: `stops` are real nodes along the way at
  // fraction t, decoratives fill the gaps so it draws as a curve (SM-8a)
  // `key` names the route by its role (a body's well, a spoke, a moon's branch),
  // so a hand bend in spec.curves[key] (SM-11c) survives rebuilds and moves
  const curves = spec.curves || {}; const routes = [];
  const route = (from, to, stops = [], bow = 0.12, step = 30, key = null) => {
    const A = byId[from], B = byId[to];
    const dx = B.x - A.x, dy = B.y - A.y;
    const bend = key && curves[key];
    const u = bend ? bend.u : 0, v = bend ? bend.v : bow; // control point = mid + u*(B-A) + v*perp(B-A)
    const cx = (A.x + B.x) / 2 + u * dx - dy * v, cy = (A.y + B.y) / 2 + u * dy + dx * v;
    // the handle sits ON the curve, at its midpoint: (A + 2*cp + B) / 4
    if (key) routes.push({ key, from, to, cp: { x: round1(cx), y: round1(cy) }, mid: { x: round1(((A.x + B.x) / 2 + cx) / 2), y: round1(((A.y + B.y) / 2 + cy) / 2) }, bent: !!bend, ids: null });
    const at = (t) => ({ x: round1((1 - t) * (1 - t) * A.x + 2 * (1 - t) * t * cx + t * t * B.x), y: round1((1 - t) * (1 - t) * A.y + 2 * (1 - t) * t * cy + t * t * B.y) });
    const len = Math.hypot(dx, dy) * (1 + Math.abs(v) + Math.abs(u));
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
    if (key) routes[routes.length - 1].ids = ids;
    return ids;
  };
  // an arc along a zone ring between two angles, free Hohmann travel (SM-2b)
  const arc = (st, from, to, r, a0, a1, hazard) => {
    let span = a1 - a0; while (span <= 0) span += 360;
    const nDec = Math.max(1, Math.round(span / 9) - 1);
    let prev = from;
    for (let j = 1; j <= nDec; j++) {
      const a = a0 + (span * j) / (nDec + 1);
      const isHaz = hazard && j === Math.round((nDec + 1) / 2);
      const id = add(isHaz ? 'radhaz' : 'decorative', P(st.L, a, r)); // SM-6a
      link(prev, id); prev = id;
    }
    link(prev, to);
  };
  // an arc round a point (a giant's escape ladder, SM-7b)
  const arcAround = (from, to, C, R, a0, a1) => {
    const n = Math.max(1, Math.round(Math.abs(a1 - a0) / 14) - 1);
    let prev = from;
    for (let j = 1; j <= n; j++) {
      const a = a0 + ((a1 - a0) * j) / (n + 1);
      const id = add('decorative', { x: round1(C.x + Math.cos(deg(a)) * R), y: round1(C.y + Math.sin(deg(a)) * R) });
      link(prev, id); prev = id;
    }
    link(prev, to);
  };

  const starNodes = S.map((st) => add('star', { x: st.L.cx, y: st.L.cy }, { id: st.i === 0 ? 'star' : `star${st.i}`, label: st.name || 'Star', starType: st.type || 'yellow', role: st.role }));

  // ---- expand the body list: belts and Trojans become asteroid clusters (SM-5f)
  const items = [];
  (spec.bodies || []).forEach((bd0, idx) => {
    const st = S[clamp(bd0.star | 0, 0, S.length - 1)];
    const bd = { ...bd0, idx, st, zone: clamp(bd0.zone | 0, bd0.kind === 'comet' ? 1 : 0, st.N - 1), fixed: bd0.angle != null }; // SM-5g: no comet in the star's zone
    if (bd.kind === 'belt') {
      const count = clamp(bd.count | 0 || 6, 1, 30); const nc = Math.ceil(count / 3);
      const sizes = bd.sizes && bd.sizes.length ? bd.sizes : [2, 3, 1, 4, 2, 3];
      let k = 0;
      for (let c = 0; c < nc; c++) {
        const n = Math.min(3, count - c * 3);
        items.push({ kind: 'cluster', st, zone: bd.zone, name: `${bd.name}#${c}`, fixed: bd.angle != null, angle: bd.angle == null ? null : (bd.angle + (360 * c) / nc) % 360, belt: bd.name, side: bd.zone === 0 ? 1 : (c % 2 ? -1 : 1),
          rocks: Array.from({ length: n }, () => ({ name: `${bd.name} ${k < 26 ? String.fromCharCode(65 + k) : `A${String.fromCharCode(65 + k - 26)}`}`, size: clamp(sizes[k++ % sizes.length] | 0 || 2, 1, 4) })) });
      }
      return;
    }
    items.push(bd);
    if (bd.kind === 'giant' && (bd.trojans | 0) > 0) {
      for (const [lp, off] of [['L4', -60], ['L5', 60]]) {
        const n = clamp(bd.trojans | 0, 1, 3);
        items.push({ kind: 'cluster', st, zone: bd.zone, name: `${bd.name} ${lp}`, trojanOf: bd, offset: off, belt: `${bd.name} ${lp}`, side: -1,
          rocks: Array.from({ length: n }, (_, j) => ({ name: `${bd.name} ${lp}${n > 1 ? String.fromCharCode(97 + j) : ''}`, size: [2, 1, 3][j] })) });
      }
    }
  });

  // ---- SM-5h: placement. Every item has a footprint round a point that
  // depends on its angle; bodies are placed largest first at the first angle
  // whose footprint clears every footprint already placed.
  const wOf = (st, k) => st.b[k + 1] - st.b[k];
  const sideOf = (it) => (hash(it.name || '') % 2 ? 1 : -1);
  // SM-5i geometry shared by placement and construction
  const bodyGeom = (it, L, a, D) => { const esc = wellBurns(clamp(it.size | 0 || 4, 1, 11)); const len = (esc + 1) * STEP; const reach = len + (it.kind === 'planet' ? 16 + 26 : 22);
    const d = wellDir(L, a, sideOf(it), leanFor(reach, wOf(it.st, it.zone))); const lag = along(D, d, len); return { d, esc, lag, centre: along(lag, d, it.kind === 'planet' ? 16 : 10) }; };
  const cometEsc = (k, N) => (k === N - 1 ? 3 : k >= N / 2 ? 2 : 1);
  // SM-5g: a comet's route climbs off the plane: up the board and to one side,
  // never folding back on itself (an outward direction plus a lift cancelled on
  // the lower half of the board and stacked the stops)
  const cometGeom = (it, L, a, D, k, N) => { const esc = cometEsc(k, N); const n1 = (esc + 1) * STEP; const d = { x: sideOf(it) * 0.5, y: -0.866 };
    return { d, esc, lag1: along(D, d, n1), lag2: along(D, d, n1 + 18), site: along(D, d, n1 + 38) }; };
  const clusterLag = (L, a, side, D) => along(D, wellDir(L, a, 0), side * 2 * STEP);
  const footprint = (it, a) => {
    const st = it.st, k = it.zone, w = wOf(st, k), L = st.L;
    if (it.kind === 'giant') { const C = P(L, a, st.mid(k) + 0.42 * w); return { x: C.x, y: C.y, r: giantReach(it) }; } // the moons fan almost all the way round
    // footprint = the farthest site from the centre, plus half a gap (SM-5e)
    const D = P(L, a, st.mid(k));
    const seg = (p, q, pad) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, r: Math.hypot(q.x - p.x, q.y - p.y) / 2 + pad });
    if (it.kind === 'cluster') { const c = clusterLag(L, a, it.side, D); return [{ x: c.x, y: c.y, r: 22 + HALF_GAP }, seg(D, c, 6)]; }
    if (it.kind === 'comet') { const g = cometGeom(it, L, a, D, k, st.N); return [seg(g.lag1, g.site, HALF_GAP), seg(D, g.lag1, 6)]; }
    const g = bodyGeom(it, L, a, D);
    return [{ x: g.centre.x, y: g.centre.y, r: (it.kind === 'planet' ? 26 : 12) + HALF_GAP }, seg(D, g.lag, 6)];
  };
  // a giant's three ring pivots sit ~70 px apart along its ring (SM-7)
  const giantDelta = (st, k) => Math.max(7, (70 / (st.mid(k) * st.L.kx)) * (180 / Math.PI));
  // SM-5h / 5i: a footprint is a set of circles (the body and its route), and
  // each body keeps its own ring pivot, clear of the spokes and the others
  const placed = [];
  const circles = (f) => (Array.isArray(f) ? f : [f]);
  const clash = (fs) => { let worst = -Infinity; for (const f of circles(fs)) for (const g of placed) worst = Math.max(worst, f.r + g.r - Math.hypot(f.x - g.x, f.y - g.y)); return worst; };
  const offBoard = (fs) => Math.max(0, ...circles(fs).map((f) => Math.max(f.r * 0.6 - f.x, f.x + f.r * 0.6 - WORLD.w, f.r * 0.6 - f.y, f.y + f.r * 0.6 - WORLD.h)));
  const SPOKE_ANGLES = [270, 30, 150];
  const ringMinDeg = (st, k) => Math.max(5, ((NODE_GAP + 4) / (st.mid(k) * st.L.kx)) * (180 / Math.PI));
  const used = {}; const useAngle = (st, k, a) => { (used[`${st.i}:${k}`] = used[`${st.i}:${k}`] || []).push(a); };
  const pin = (st, k, a) => placed.push({ x: P(st.L, a, st.mid(k)).x, y: P(st.L, a, st.mid(k)).y, r: 9 }); // a ring pivot: keep routes off it
  for (const st of S) for (let k = 0; k < st.N; k++) SPOKE_ANGLES.forEach((a) => { useAngle(st, k, a); pin(st, k, a); });
  for (const l of spec.links || []) useAngle(S[0], S[0].N - 1, ((l.angle % 360) + 360) % 360);
  for (const st of S.slice(1)) { const from = st.role === 'binary' ? S[0] : (S.find((x) => x.role === 'binary') || S[0]); useAngle(from, from.N - 1, angleTo(from.L, st.L.cx, st.L.cy)); useAngle(st, st.N - 1, angleTo(st.L, from.L.cx, from.L.cy)); }
  const angDist0 = (p, q) => Math.abs(((p - q + 540) % 360) - 180);
  const pivotAnglesOf = (it, a) => (it.kind === 'giant' ? [a - giantDelta(it.st, it.zone), a, a + giantDelta(it.st, it.zone)] : [a]);
  const crowding = (it, a) => { const md = ringMinDeg(it.st, it.zone) * 2; let worst = 0; for (const p of pivotAnglesOf(it, a)) for (const u of used[`${it.st.i}:${it.zone}`] || []) worst = Math.max(worst, md - angDist0(p, u)); return worst; };
  const size0 = (it) => (it.kind === 'giant' ? 1000 + giantReach(it) : it.kind === 'planet' ? 500 + (it.sites | 0) : it.kind === 'comet' ? 200 : it.kind === 'cluster' ? (it.trojanOf ? 50 : 100) : 300);
  const order = items.filter((it) => !it.trojanOf).sort((p, q) => (q.fixed - p.fixed) || (size0(q) - size0(p)));
  // variants a body may fall back on when its ring is full: an asteroid group
  // may sit on either side of its ring, a comet one zone further out
  const variants = (it) => (it.kind === 'cluster' && !it.trojanOf && it.zone > 0 ? [{ side: it.side }, { side: -it.side }]
    : it.kind === 'comet' ? Array.from({ length: it.st.N - it.zone }, (_, d) => ({ zone: it.zone + d })) : [{}]);
  const commit = (it, a, fs) => { placed.push(...circles(fs)); pivotAnglesOf(it, a).forEach((p) => { useAngle(it.st, it.zone, ((p % 360) + 360) % 360); }); };
  const placeOne = (it) => {
    if (it.fixed) { commit(it, it.angle, footprint(it, it.angle)); return; }
    const start = hash(`${it.name || it.kind}${spec.jitter || ''}`) % 360; // a retry re-places with another start
    let best = null;
    for (const v of variants(it)) {
      const cand = { ...it, ...v };
      for (let s = 0; s < 360; s += 2) {
        const a = (start + s) % 360;
        const f = footprint(cand, a);
        const bad = Math.max(clash(f), 0) + offBoard(f) * 2 + crowding(cand, a) * 4;
        if (!best || bad < best.bad) best = { a, f, bad, v };
        if (bad <= 0) break;
      }
      if (best.bad <= 0) break;
    }
    Object.assign(it, best.v); it.angle = best.a; commit(it, best.a, best.f);
  };
  for (const it of order) {
    placeOne(it);
    if (it.kind === 'giant') for (const tr of items.filter((x) => x.trojanOf && x.trojanOf.name === it.name)) { tr.angle = (it.angle + tr.offset + 360) % 360; commit(tr, tr.angle, footprint(tr, tr.angle)); }
  }

  // ---- SM-9b: the routes between stars need a pivot facing the other star
  const facing = S.map(() => []); const interStar = [];
  for (const st of S.slice(1)) {
    const from = st.role === 'binary' ? S[0] : (S.find((x) => x.role === 'binary') || S[0]);
    const aOut = angleTo(from.L, st.L.cx, st.L.cy); const aIn = angleTo(st.L, from.L.cx, from.L.cy);
    facing[from.i].push(Math.round(aOut)); facing[st.i].push(Math.round(aIn));
    interStar.push({ from, to: st, aOut: Math.round(aOut), aIn: Math.round(aIn) });
  }

  // ---- SM-2: a ring of pivots per zone; SM-3a spokes carry the radial transfers
  const SPOKES = [270, 30, 150]; // 270 = toward the arrival edge (top)
  const ringPivots = S.map(() => []);
  for (const st of S) {
    for (let k = 0; k < st.N; k++) {
      const angles = new Set(SPOKES);
      for (const it of items) if (it.st === st && it.zone === k) {
        angles.add(Math.round(it.angle));
        if (it.kind === 'giant') { it.delta = giantDelta(st, k); angles.add(Math.round((it.angle - it.delta + 360) % 360)); angles.add(Math.round((it.angle + it.delta) % 360)); }
      }
      if (k === st.N - 1) for (const a of facing[st.i]) angles.add(a);
      if (k === st.N - 1 && st.i === 0) for (const l of spec.links || []) angles.add(Math.round(((l.angle % 360) + 360) % 360)); // SM-9a
      const minDeg = Math.max(5, ((NODE_GAP + 4) / (st.mid(k) * st.L.kx)) * (180 / Math.PI)); // SM-5i: pivots 14+ px apart along the ring
      const list = []; for (const a of [...angles].sort((p, q) => p - q)) if (!list.length || a - list[list.length - 1] >= minDeg) list.push(a);
      ringPivots[st.i][k] = list.map((a) => ({ a, id: add('hohmann', P(st.L, a, st.mid(k))) }));
    }
    for (let k = 0; k < st.N; k++) {
      const ring = ringPivots[st.i][k];
      if (ring.length > 1) for (let i = 0; i < ring.length; i++) arc(st, ring[i].id, ring[(i + 1) % ring.length].id, st.mid(k), ring[i].a, ring[(i + 1) % ring.length].a, k === 0); // SM-6a: radiation on each star's ring
    }
  }
  const angDist = (p, q) => Math.abs(((p - q + 540) % 360) - 180);
  const pivotAt = (st, k, a) => ringPivots[st.i][k].reduce((best, p) => (angDist(p.a, a) < angDist(best.a, a) ? p : best), ringPivots[st.i][k][0]);
  // SM-3a: one burn on each zone boundary along every spoke
  for (const st of S) {
    for (const a of SPOKES) {
      for (let k = 0; k < st.N - 1; k++) {
        const from = pivotAt(st, k, a), to = pivotAt(st, k + 1, a);
        const t = (st.b[k + 1] - st.mid(k)) / (st.mid(k + 1) - st.mid(k));
        route(from.id, to.id, [{ kind: 'burn', t: clamp(t, 0.2, 0.8), extra: { purpose: 'transition' } }], 0.04, 30, `spoke:${st.i}:${a}:${k}`);
      }
    }
  }
  // SM-9a: Ad Astra nodes outside the primary's outer zone, one per star-map
  // link at that neighbour's bearing (or a single arrival node at the top);
  // entering the outer ring from one is a zone transition: one burn
  const S0 = S[0];
  const edgesSpec = (spec.links && spec.links.length) ? spec.links : [{ id: null, name: null, angle: 270 }];
  for (const l of edgesSpec) {
    const a = ((l.angle % 360) + 360) % 360;
    const id = l.id ? `edge:${l.id}` : 'high';
    const en = add('orbit', P(S0.L, a, S0.L.outer + 26), { id, label: l.name ? `Ad Astra: toward ${l.name}` : 'System edge (arrival)', adAstra: l.id || true, toward: l.id || null });
    route(en, pivotAt(S0, S0.N - 1, a).id, [{ kind: 'burn', t: 0.45, extra: { purpose: 'transition' } }], 0, 30, l.id ? `adastra:${l.id}` : 'arrival');
  }
  // SM-9b: between stars, a burn leaving one outer zone and a burn entering the other's
  for (const x of interStar) {
    const p = pivotAt(x.from, x.from.N - 1, x.aOut), q = pivotAt(x.to, x.to.N - 1, x.aIn);
    route(p.id, q.id, [{ kind: 'burn', t: 0.22, extra: { purpose: 'transition' } }, { kind: 'burn', t: 0.78, extra: { purpose: 'transition' } }], x.to.role === 'distant' ? 0.1 : 0.05, 34, `between:${x.from.i}:${x.to.i}`);
  }

  // ---- SM-4 / SM-5 / SM-7: each body's well
  const addSite = (pos, extra) => { const sid = add('site', pos, extra); sites.push(byId[sid]); return sid; };
  const fanPos = (centre, i, count, around, dist, spreadDeg) => {
    const ang = around + (count === 1 ? 0 : (i - (count - 1) / 2) * spreadDeg); // SM-5e: SITE_GAP apart
    return { x: round1(centre.x + Math.cos(deg(ang)) * dist), y: round1(centre.y + Math.sin(deg(ang)) * dist) };
  };
  const placeSites = (bodyName, kind, centre, count, around, dist, size, extra = {}, spreadDeg = 62) =>
    Array.from({ length: count }, (_, i) => ({ sid: addSite(fanPos(centre, i, count, around, dist, spreadDeg), { body: bodyName, bodyKind: kind, size, region: i, ...extra }) }));
  const landTo = (lagId, siteId, landing, hazardous, aerobrake) => {
    if (landing === 'none') { link(lagId, siteId); return; } // SM-5c small bodies
    const L = byId[lagId], Q = byId[siteId];
    const lb = add('burn', { x: round1((L.x + Q.x) / 2), y: round1((L.y + Q.y) / 2) }, { purpose: 'landing', land: landing, body: Q.body });
    byId[lb].tags.lander = true; if (landing === 'half') byId[lb].tags.half = true;
    if (hazardous || aerobrake) byId[lb].tags.hazard = true; // SM-6c
    if (aerobrake) byId[lb].tags.aerobrake = true;
    link(lagId, lb); link(lb, siteId);
  };
  // an asteroid group: from a node, one escape burn -> Lagrange -> 1-3 rocks fanned outward
  const rockGroup = (fromId, lagPos, around, rocks, bodyKind, extra, dist = 22, spread = 100, key = null) => {
    const lag = add('lagrange', lagPos, { purpose: 'orbit', body: extra.belt || extra.moonOf, ...(extra.moonOf ? { moonOf: extra.moonOf } : {}) });
    route(fromId, lag, [{ kind: 'burn', t: 0.5, extra: { purpose: 'escape', body: extra.belt || rocks[0].name, ...(extra.moonOf ? { moonOf: extra.moonOf } : {}) } }], 0.08, 16, key);
    rocks.forEach((r, j) => link(lag, addSite(fanPos(byId[lag], j, rocks.length, around, dist, spread), { ...extra, body: r.name, bodyKind, size: r.size, region: 0 })));
    return lag;
  };
  let cometNo = 0;
  for (const it of items) {
    const st = it.st; const L = st.L; const k = it.zone; const a = it.angle;
    const dep = pivotAt(st, k, a);
    const w = wOf(st, k);
    const outAng = outAngOf(L, a);
    if (it.kind === 'cluster') { // SM-5f: pivot -> one escape burn -> Lagrange -> 1-3 asteroids
      const side = it.side;
      const lag = rockGroup(dep.id, clusterLag(L, a, side, byId[dep.id]), side > 0 ? outAng : outAng + 180, it.rocks, 'asteroid', { belt: it.belt, home: st.i }, 22, 100, `group:${it.name}`);
      if (k === 0) byId[lag].tags.hazard = true; // SM-6b
      continue;
    }
    if (it.kind === 'comet') { // SM-5g: pivot -> escape burns -> orbit -> far orbit -> the comet, climbing off the plane
      const season = SEASONS.includes(it.season) ? it.season : SEASONS[cometNo++ % SEASONS.length];
      const tag = { comet: true, season, siteSynodic: season };
      const g = cometGeom(it, L, a, byId[dep.id], k, st.N); // one straight climb off the plane (SM-5i)
      const lag1 = add('lagrange', g.lag1, { purpose: 'orbit', body: it.name, ...tag });
      route(dep.id, lag1, Array.from({ length: g.esc }, (_, i) => ({ kind: 'burn', t: (i + 1) / (g.esc + 1), extra: { purpose: 'escape', body: it.name, ...tag } })), 0.04, 16, `well:${it.name}`);
      const lag2 = add('lagrange', g.lag2, { purpose: 'orbit', body: it.name, ...tag });
      route(lag1, lag2, [], 0.04, 14, `far:${it.name}`);
      link(lag2, addSite(g.site, { body: it.name, bodyKind: 'comet', size: clamp(it.size | 0 || 2, 1, 3), region: 0, home: st.i, ...tag }));
      continue;
    }
    const size = clamp(it.size | 0 || 4, 1, 11);
    if (it.kind === 'giant') {
      const C = P(L, a, st.mid(k) + 0.42 * w);
      const pol = (ang, r) => ({ x: round1(C.x + Math.cos(deg(ang)) * r), y: round1(C.y + Math.sin(deg(ang)) * r) });
      // three distinct ring pivots: ladder start, slingshot in, slingshot out (a
      // merged pivot falls back to the ring neighbour on that side)
      const ring = ringPivots[st.i][k]; const di = ring.indexOf(dep);
      let D0 = pivotAt(st, k, a - it.delta), D2 = pivotAt(st, k, a + it.delta);
      if (D0 === dep && ring.length > 2) D0 = ring[(di - 1 + ring.length) % ring.length];
      if (D2 === dep && ring.length > 1) D2 = ring[(di + 1) % ring.length];
      // SM-7a: the slingshot point, on the transfer layer: in from the ring and
      // back out to it a little further on, free through radiation belts. No
      // moon route touches it.
      const F = add('lagrange', C, { purpose: 'flyby', body: it.name, fly: flybyOf(size) || null, giant: true });
      route(dep.id, F, [{ kind: 'radhaz', t: 0.5 }], 0.05, 16, `sling-in:${it.name}`);
      if (D2.id !== dep.id) route(F, D2.id, [{ kind: 'radhaz', t: 0.45 }], 0.12, 16, `sling-out:${it.name}`);
      bodies.push({ id: `${F}-body`, name: it.name, kind: it.giantKind || 'gas', x: C.x, y: C.y, size, star: st.i });
      // SM-7b: the escape ladder curls round the outward side; moons branch off burns 2 and 3
      const R = 36; // just outside the giant's sphere (GIANT_HALO)
      const A1 = outAng - 150, A2 = outAng - 62, A3 = outAng + 62;
      const b1 = add('burn', pol(A1, R + 4), { purpose: 'escape', body: it.name, rung: 1 });
      const b2 = add('burn', pol(A2, R), { purpose: 'escape', body: it.name, rung: 2 });
      const b3 = add('burn', pol(A3, R), { purpose: 'escape', body: it.name, rung: 3 });
      route((D0.id !== dep.id ? D0 : dep).id, b1, [], 0.1, 16, `ladder:${it.name}`);
      arcAround(b1, b2, C, R + 2, A1, A2); arcAround(b2, b3, C, R, A2, A3);
      const rungFor = (ang) => (((ang - outAng + 540) % 360) - 180 < 0 ? b2 : b3);
      const majors = (it.moons || []).filter((m) => (m.size | 0 || 6) > 2);
      const minors = (it.moons || []).filter((m) => (m.size | 0 || 6) <= 2);
      // SM-7c: majors on two shells over the outward sector, inner shell through radiation
      const lo = outAng - 132, hi = outAng + 112;
      majors.forEach((m, i) => {
        const ma = majors.length === 1 ? outAng : lo + ((hi - lo) * i) / (majors.length - 1);
        const inner = i % 2 === 0;
        const md = inner ? SHELL.inner : SHELL.outer;
        const mc = pol(ma, md);
        const msize = clamp(m.size | 0 || 6, 4, 9);
        const tag = { moonOf: it.name };
        const mlag = add('lagrange', pol(ma, md - 18), { purpose: 'orbit', body: m.name, ...tag });
        const me = moonEscape(msize);
        const stops = [...(inner ? [{ kind: 'radhaz', t: 0.3 }] : []),
          ...Array.from({ length: me }, (_, j) => ({ kind: 'burn', t: 0.42 + (0.5 * (j + 1)) / (me + 1), extra: { purpose: 'escape', body: m.name, ...tag } }))];
        route(rungFor(ma), mlag, stops, 0.05, 14, `moon:${m.name}`);
        const ss = placeSites(m.name, 'moon', mc, clamp(m.sites | 0 || 1, 1, 2), ma, 22, msize, { ...tag, ocean: !!m.ocean, home: st.i }, 80);
        ss.forEach((s, j) => landTo(mlag, s.sid, landingOf(msize), j === 0 && msize >= 8, false));
      });
      // SM-7c: minors in groups of up to 3 on the outer shell, between the majors
      const groups = []; for (let i = 0; i < minors.length; i += 3) groups.push(minors.slice(i, i + 3));
      groups.forEach((g, i) => {
        const ga = lo + ((hi - lo) * (i + 0.5)) / groups.length;
        rockGroup(rungFor(ga), pol(ga, SHELL.minor - 16), ga, g.map((m) => ({ name: m.name, size: clamp(m.size | 0 || 2, 1, 2) })), 'moon', { moonOf: it.name, minor: true, home: st.i }, 24, 70, `minors:${it.name}:${i}`);
      });
      continue;
    }
    // planets, dwarfs, lone asteroids: pivot -> escape burns -> orbit -> landing -> sites
    const g = bodyGeom(it, L, a, byId[dep.id]); const centre = g.centre; // SM-5i: a leaning well, STEP px a stop
    const lag = add('lagrange', g.lag, { purpose: 'orbit', body: it.name, fly: flybyOf(size) || null });
    if (k === 0) byId[lag].tags.hazard = true; // SM-6b
    const esc = g.esc; // SM-4a
    route(dep.id, lag, Array.from({ length: esc }, (_, i) => ({ kind: 'burn', t: (i + 1) / (esc + 1), extra: { purpose: 'escape', body: it.name } })), 0.04, 16, `well:${it.name}`);
    const count = it.kind === 'planet' ? clamp(it.sites | 0 || 1, 1, 3) : 1; // SM-5a
    const landing = landingOf(size);
    const around = (Math.atan2(g.d.y, g.d.x) * 180) / Math.PI; // the sites fan on past the orbit point
    const ss = placeSites(it.name, it.kind, centre, count, around, it.kind === 'planet' ? 26 : 12, size, { cls: it.cls || null, home: st.i }, 64);
    ss.forEach((s, j) => landTo(lag, s.sid, landing, false, !!it.atmosphere && j === 0)); // SM-6c aerobrake on one landing
  }
  const zones = zoneLayer(stars);
  const map = { spec, stars: S.map((st) => ({ id: starNodes[st.i], name: st.name, type: st.type || 'yellow', role: st.role, zones: st.N, x: st.L.cx, y: st.L.cy })), nodes, edges, sites, bodies, zones, routes };
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
  const zkey = (n) => `${n.star}:${n.zone}`;
  let crossings = 0, crossOk = 0;
  for (const n of nodes) {
    if (n.kind === 'decorative') continue;
    for (const m of real(n.id)) {
      if (n.id > m) continue;
      const nm = byId[m];
      if (zkey(n) !== zkey(nm) && n.kind !== 'site' && nm.kind !== 'site' && n.kind !== 'star' && nm.kind !== 'star') {
        if (n.purpose === 'escape' || nm.purpose === 'escape' || n.purpose === 'orbit' || nm.purpose === 'orbit' || n.purpose === 'flyby' || nm.purpose === 'flyby') continue; // a well may straddle a boundary
        crossings++; if (n.kind === 'burn' || nm.kind === 'burn') crossOk++;
      }
    }
  }
  check('SM-3a zone crossings carry a burn', crossings === crossOk, `${crossOk}/${crossings} crossings`);
  // 3. every burn has a purpose
  const burns = nodes.filter((n) => n.kind === 'burn');
  const purpose = burns.reduce((a, n) => { a[n.purpose || 'none'] = (a[n.purpose || 'none'] || 0) + 1; return a; }, {});
  check('SM-3 every burn has a purpose', !purpose.none, `transition ${purpose.transition || 0}, escape ${purpose.escape || 0}, landing ${purpose.landing || 0}${purpose.none ? `, NONE ${purpose.none}` : ''}`);
  // 4. well depth: burns from a site out to the nearest pivot, never via a slingshot
  const isFly = (n) => n.purpose === 'flyby';
  const wellDepth = (s, avoidFly = false) => {
    const dist = { [s]: 0 }; const open = [s]; const done = new Set();
    while (open.length) {
      let bi = 0; for (let i = 1; i < open.length; i++) if (dist[open[i]] < dist[open[bi]]) bi = i;
      const n = open.splice(bi, 1)[0]; if (done.has(n)) continue; done.add(n);
      if (byId[n].kind === 'hohmann') return dist[n];
      for (const m of adj[n]) { if (avoidFly && isFly(byId[m])) continue; const nd = dist[n] + (byId[m].kind === 'burn' ? 1 : 0); if (dist[m] == null || nd < dist[m]) { dist[m] = nd; open.push(m); } }
    }
    return null;
  };
  // SM-4a: worlds (planets, dwarfs, asteroids) deepen with size; SM-4b: moons
  // sit deeper than their giant's own well, so they are checked on their own
  const wells = {}; const moonBad = []; let moonCount = 0;
  for (const s of nodes.filter((n) => n.kind === 'site')) {
    if (s.bodyKind === 'comet') continue; // SM-5g: a comet's burns buy an orbit, not a climb out of a well
    if (s.bodyKind === 'moon') { if (s.size <= 2) continue; moonCount++; const d = wellDepth(s.id); if (d == null || d < 4) moonBad.push(s.body); continue; } // ladder 2+, 1 of its own, landing
    const d = wellDepth(s.id);
    (wells[s.size] = wells[s.size] || []).push(d);
  }
  const wellText = Object.entries(wells).sort((p, q) => p[0] - q[0]).map(([sz, ds]) => `size ${sz}: ${(ds.reduce((a, c) => a + c, 0) / ds.length).toFixed(1)}`).join(' | ');
  const mono = Object.entries(wells).sort((p, q) => p[0] - q[0]).map(([, ds]) => Math.min(...ds));
  check('SM-4a bigger worlds have deeper wells', mono.every((v, i) => i === 0 || v >= mono[i - 1]), wellText || 'no worlds');
  check('SM-4b moons inherit the giant\'s well', moonBad.length === 0, moonBad.length ? `too shallow: ${[...new Set(moonBad)].join(', ')}` : `${moonCount} major moon sites, all 4+ burns deep`);
  // 5. sites: one edge, reachable from arrival
  const multi = nodes.filter((n) => n.kind === 'site' && adj[n.id].length !== 1);
  check('SM-5b each site has one edge', multi.length === 0, multi.length ? `${multi.length} sites with ${multi.map((n) => adj[n.id].length).join('/')}` : `${nodes.filter((n) => n.kind === 'site').length} sites`);
  const entry = (nodes.find((n) => n.kind === 'orbit') || {}).id;
  const seen = new Set([entry]); const q = [entry];
  while (q.length) { const n = q.shift(); for (const m of adj[n] || []) if (!seen.has(m)) { seen.add(m); q.push(m); } }
  const unreach = nodes.filter((n) => n.kind === 'site' && !seen.has(n.id));
  check('SM-8c every site reachable', unreach.length === 0, unreach.length ? `${unreach.length} unreachable` : 'all reachable from the edge');
  // 6. radiation only in a star's innermost zone or a giant's belts
  const nearGiant = (n) => (map.bodies || []).some((g) => Math.hypot(g.x - n.x, g.y - n.y) < 160);
  const stray = nodes.filter((n) => n.kind === 'radhaz' && !(n.star >= 0 && n.zone === 0) && !nearGiant(n));
  check('SM-6a radiation only near a star or a giant', stray.length === 0, stray.length ? `${stray.length} stray radiation nodes` : `${nodes.filter((n) => n.kind === 'radhaz').length} radiation nodes`);
  // 7. site spacing
  const ss = nodes.filter((n) => n.kind === 'site'); let close = 0; const pairs = [];
  for (let i = 0; i < ss.length; i++) for (let j = i + 1; j < ss.length; j++) if (Math.hypot(ss[i].x - ss[j].x, ss[i].y - ss[j].y) < SITE_GAP) { close++; if (pairs.length < 3) pairs.push(`${ss[i].body}/${ss[j].body}`); } // same body too: hexes must not stack
  check(`SM-5e sites at least ${SITE_GAP} px apart`, close === 0, close ? `${close} pairs too close (${pairs.join(', ')})` : 'labels clear');
  // 8. no slingshot into a moon's orbit: moon routes never touch a flyby point,
  // and every moon is reachable down its giant's ladder without one
  const flys = nodes.filter(isFly);
  const touch = flys.filter((f) => real(f.id).some((m) => byId[m].moonOf));
  const moonSites = ss.filter((n) => n.bodyKind === 'moon');
  const viaFly = moonSites.filter((n) => wellDepth(n.id, true) == null);
  check('SM-7 moons branch off the ladder, not the slingshot', !touch.length && !viaFly.length,
    touch.length ? `${touch.length} flyby points lead to a moon` : viaFly.length ? `${viaFly.length} moon sites only reachable by slingshot` : `${flys.length} slingshot points, ${moonSites.length} moon sites off the ladders`);
  // 9. design targets: planets per star, asteroids and comets per board
  const planetsBy = {};
  for (const n of ss.filter((x) => x.bodyKind === 'planet')) (planetsBy[n.home] = planetsBy[n.home] || new Set()).add(n.body);
  for (const g of map.bodies || []) (planetsBy[g.star] = planetsBy[g.star] || new Set()).add(g.name);
  const pCounts = (map.stars || [{}]).map((_, i) => (planetsBy[i] ? planetsBy[i].size : 0));
  const rocks = ss.filter((n) => n.bodyKind === 'asteroid').length;
  const comets = ss.filter((n) => n.bodyKind === 'comet');
  const [p0, p1] = TARGETS.planets, [a0, a1] = TARGETS.asteroids;
  check(`SM-1f/5f/5g ${p0}-${p1} planets a star, ${a0}-${a1} asteroids, ${TARGETS.comets} comets`,
    pCounts.every((c) => c >= p0 && c <= p1) && rocks >= a0 && rocks <= a1 && comets.length === TARGETS.comets,
    `planets ${pCounts.join(' + ')}, asteroids ${rocks}, comets ${comets.length}`);
  // 10. comets: outside the star's zone, two Lagrange points on their route
  const badComet = comets.filter((c) => c.zone === 0 || !SEASONS.includes(c.season)
    || nodes.filter((n) => n.comet && n.body === c.body && n.kind === 'lagrange').length !== 2
    || nodes.some((n) => n.body === c.body && (n.kind === 'burn' || n.kind === 'lagrange') && n.season !== c.season));
  const seasonsUsed = new Set(comets.map((c) => c.season));
  const bySeason = SEASONS.map((x) => `${comets.filter((c) => c.season === x).length} ${x}`).join(', ');
  check('SM-5g comets on seasonal far orbits', badComet.length === 0 && (comets.length < 3 || seasonsUsed.size === 3),
    badComet.length ? `${badComet.length} comets misplaced or missing a season` : comets.length ? bySeason : 'no comets');
  // 11. gas giants: 4-10 major and 10-15 minor moons
  const moonsOf = {};
  for (const n of moonSites) { const e = (moonsOf[n.moonOf] = moonsOf[n.moonOf] || { major: new Set(), minor: new Set() }); (n.size > 2 ? e.major : e.minor).add(n.body); }
  const gas = (map.bodies || []).filter((g) => g.kind === 'gas');
  const [m0, m1] = TARGETS.majors, [n0, n1] = TARGETS.minors;
  const badGas = gas.filter((g) => { const e = moonsOf[g.name] || { major: new Set(), minor: new Set() }; return e.major.size < m0 || e.major.size > m1 || e.minor.size < n0 || e.minor.size > n1; });
  check(`SM-7c gas giants: ${m0}-${m1} major, ${n0}-${n1} minor moons`, badGas.length === 0,
    gas.length ? gas.map((g) => { const e = moonsOf[g.name] || { major: new Set(), minor: new Set() }; return `${g.name} ${e.major.size}+${e.minor.size}`; }).join(', ') : 'no gas giants');
  return out;
}
