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
//     bodies: [{ kind: 'planet'|'giant'|'dwarf'|'asteroid'|'belt', name, star (index, default 0),
//                zone (0 = innermost), angle (deg, optional), size 1..11, sites 1..3,
//                atmosphere, cls,
//                moons: [{ name, size, sites, ocean }], trojans: n per side   (giants)
//                count, sizes: [..]                                          (belts) }] }

export const SOL_ZONE_PALETTE = ['#fdf441', '#fefab1', '#f97316', '#ffdd92', '#97a0bf', '#585e90', '#2b3534', '#2a2d4c', '#1d102e'];
export const WORLD = { cx: 700, cy: 450, kx: 1.45, ky: 0.95, inner: 70, outer: 420 }; // a lone star fills the board

// SM-4a: escape burns by size; SM-5c: landing by size; SM-4c: flyby boost
export const wellBurns = (size) => (size <= 5 ? 1 : size <= 7 ? 2 : 3);
export const landingOf = (size) => (size >= 7 ? 'full' : size >= 4 ? 'half' : 'none');
export const flybyOf = (size) => (size >= 11 ? 4 : size >= 10 ? 2 : size >= 8 ? 1 : 0);
export const moonEscape = (size) => Math.max(1, wellBurns(size) - 1); // SM-4b: the giant's ladder comes first

export const SITE_GAP = 32; // SM-5e: world px between any two sites
export const GIANT_HALO = 24; // a giant's sphere radius on these boards (world px)
export const ASTEROID_SHARE = 0.4; // SM-5f
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
    if (role === 'binary') return at(1075, 450, 40, 165);
    if (role === 'distant') return at(1270, 112, 26, 75);
    if (hasB) return at(400, 480, 48, 225);
    if (hasD) return at(600, 462, 60, 350);
    return at(WORLD.cx, WORLD.cy, WORLD.inner, WORLD.outer);
  });
}
const normStars = (spec) => (spec.stars && spec.stars.length ? spec.stars : [{ name: spec.name, type: spec.starType, zones: spec.zones }])
  .map((s, i) => { const role = i === 0 ? 'primary' : (s.role === 'distant' ? 'distant' : 'binary'); const [lo, hi] = ZONES_FOR[role]; return { ...s, role, zones: clamp(s.zones | 0 || (role === 'primary' ? 6 : role === 'binary' ? 4 : 2), lo, hi) }; });

export function zoneBounds(n, L = WORLD) { // SM-1a: b[0]=0 (star) .. b[n]=outer edge
  const b = [0];
  for (let k = 1; k <= n; k++) b.push(L.inner + ((L.outer - L.inner) * (k - 1)) / Math.max(1, n - 1));
  return b;
}
const P = (L, a, r) => ({ x: round1(L.cx + Math.cos(deg(a)) * r * L.kx), y: round1(L.cy + Math.sin(deg(a)) * r * L.ky) });
export function radiusOf(x, y, L = WORLD) { return Math.hypot((x - L.cx) / L.kx, (y - L.cy) / L.ky); }
const angleTo = (L, x, y) => ((Math.atan2((y - L.cy) / L.ky, (x - L.cx) / L.kx) * 180) / Math.PI + 360) % 360;

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

  const starNodes = S.map((st) => add('star', { x: st.L.cx, y: st.L.cy }, { id: st.i === 0 ? 'star' : `star${st.i}`, label: st.name || 'Star', starType: st.type || 'yellow', role: st.role }));

  // ---- expand the body list: belts and Trojans become asteroid clusters (SM-5f)
  const items = [];
  (spec.bodies || []).forEach((bd0, idx) => {
    const st = S[clamp(bd0.star | 0, 0, S.length - 1)];
    const bd = { ...bd0, idx, st, zone: clamp(bd0.zone | 0, 0, st.N - 1) };
    if (bd.kind === 'belt') {
      const count = clamp(bd.count | 0 || 6, 1, 12); const nc = Math.ceil(count / 3);
      const sizes = bd.sizes && bd.sizes.length ? bd.sizes : [2, 3, 1, 4, 2, 3];
      let k = 0;
      for (let c = 0; c < nc; c++) {
        const n = Math.min(3, count - c * 3);
        items.push({ kind: 'cluster', st, zone: bd.zone, angle: bd.angle == null ? null : (bd.angle + (360 * c) / nc) % 360, belt: bd.name, side: c % 2 ? -1 : 1,
          rocks: Array.from({ length: n }, () => ({ name: `${bd.name} ${String.fromCharCode(65 + k)}`, size: clamp(sizes[k++ % sizes.length] | 0 || 2, 1, 4) })), beltIdx: idx, beltSpread: nc });
      }
      return;
    }
    items.push(bd);
    if (bd.kind === 'giant' && (bd.trojans | 0) > 0) {
      for (const [lp, off] of [['L4', -60], ['L5', 60]]) {
        const n = clamp(bd.trojans | 0, 1, 3);
        items.push({ kind: 'cluster', st, zone: bd.zone, trojanOf: bd, offset: off, belt: `${bd.name} ${lp}`, side: 1,
          rocks: Array.from({ length: n }, (_, j) => ({ name: `${bd.name} ${lp}${n > 1 ? String.fromCharCode(97 + j) : ''}`, size: [2, 1, 3][j] })) });
      }
    }
  });
  // auto angles: spread a zone's bodies round the ring; a belt's clusters spread evenly
  const byZone = {};
  for (const it of items) if (it.kind !== 'cluster' || it.belt) { const key = `${it.st.i}:${it.zone}`; (byZone[key] = byZone[key] || []).push(it); }
  for (const list of Object.values(byZone)) {
    const lone = list.filter((it) => it.kind !== 'cluster');
    lone.forEach((it, j) => { if (it.angle == null) it.angle = (200 + (360 * j) / lone.length + it.zone * 37) % 360; });
  }
  const beltBase = {};
  for (const it of items) {
    if (it.kind !== 'cluster') continue;
    if (it.trojanOf) { it.angle = (it.trojanOf.angle + it.offset + 360) % 360; continue; }
    if (it.angle == null) {
      if (beltBase[it.beltIdx] == null) beltBase[it.beltIdx] = { a: (40 + it.zone * 53 + it.st.i * 90) % 360, c: 0 };
      it.angle = (beltBase[it.beltIdx].a + (360 * beltBase[it.beltIdx].c++) / it.beltSpread) % 360;
    }
  }

  // ---- SM-9b: the routes between stars need a pivot facing the other star
  const facing = S.map(() => []); const interStar = [];
  for (const st of S.slice(1)) {
    const from = st.role === 'binary' ? S[0] : (S.find((x) => x.role === 'binary') || S[0]);
    const aOut = angleTo(from.L, st.L.cx, st.L.cy); const aIn = angleTo(st.L, from.L.cx, from.L.cy);
    facing[from.i].push(Math.round(aOut)); facing[st.i].push(Math.round(aIn));
    interStar.push({ from, to: st, aOut: Math.round(aOut), aIn: Math.round(aIn) });
  }

  // a giant's three ring pivots sit ~70 px apart along its ring (SM-7)
  const giantDelta = (st, k) => Math.max(7, (70 / (st.mid(k) * st.L.kx)) * (180 / Math.PI));
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
      const list = [...angles].sort((p, q) => p - q).filter((a, i, arr) => i === 0 || a - arr[i - 1] >= 6);
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
        route(from.id, to.id, [{ kind: 'burn', t: clamp(t, 0.2, 0.8), extra: { purpose: 'transition' } }], 0.04);
      }
    }
  }
  // SM-9a: arrival outside the primary's outer zone; one burn crossing into it
  const S0 = S[0];
  const high = add('orbit', P(S0.L, 270, S0.L.outer + 26), { id: 'high', label: 'System edge (arrival)' });
  route(high, pivotAt(S0, S0.N - 1, 270).id, [{ kind: 'burn', t: 0.45, extra: { purpose: 'transition' } }], 0);
  // SM-9b: between stars, a burn leaving one outer zone and a burn entering the other's
  for (const x of interStar) {
    const p = pivotAt(x.from, x.from.N - 1, x.aOut), q = pivotAt(x.to, x.to.N - 1, x.aIn);
    route(p.id, q.id, [{ kind: 'burn', t: 0.22, extra: { purpose: 'transition' } }, { kind: 'burn', t: 0.78, extra: { purpose: 'transition' } }], x.to.role === 'distant' ? 0.1 : 0.05, 34);
  }

  // ---- SM-4 / SM-5 / SM-7: each body's well
  const outAngOf = (L, a) => (Math.atan2(Math.sin(deg(a)) * L.ky, Math.cos(deg(a)) * L.kx) * 180) / Math.PI;
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
  for (const it of items) {
    const st = it.st; const L = st.L; const k = it.zone; const a = it.angle;
    const dep = pivotAt(st, k, a);
    const w = st.b[k + 1] - st.b[k];
    const outAng = outAngOf(L, a);
    if (it.kind === 'cluster') { // SM-5f: pivot -> one escape burn -> Lagrange -> 1-3 asteroids
      const side = k === 0 ? 1 : it.side;
      const lag = add('lagrange', P(L, a, st.mid(k) + side * 0.3 * w), { purpose: 'orbit', body: it.belt });
      if (k === 0) byId[lag].tags.hazard = true; // SM-6b
      route(dep.id, lag, [{ kind: 'burn', t: 0.5, extra: { purpose: 'escape', body: it.belt } }], 0.1, 16);
      const around = side > 0 ? outAng : outAng + 180;
      it.rocks.forEach((r, j) => link(lag, addSite(fanPos(byId[lag], j, it.rocks.length, around, 22, 95), { body: r.name, bodyKind: 'asteroid', size: r.size, region: 0, belt: it.belt })));
      continue;
    }
    const size = clamp(it.size | 0 || 4, 1, 11);
    if (it.kind === 'giant') {
      const C = P(L, a, st.mid(k) + 0.42 * w);
      const pol = (ang, r) => ({ x: round1(C.x + Math.cos(deg(ang)) * r), y: round1(C.y + Math.sin(deg(ang)) * r) });
      // Local frame round the giant: outAng points away from the star; the
      // slingshot uses the +90 side, the ladder and the moons the -90 side.
      const D0 = pivotAt(st, k, a - it.delta), D2 = pivotAt(st, k, a + it.delta);
      // SM-7a: the slingshot point, on the transfer layer: in from the ring and
      // back out to it a little further on, free through radiation belts; one
      // transition burn out to the next zone. No moon route touches it.
      const F = add('lagrange', C, { purpose: 'flyby', body: it.name, fly: flybyOf(size) || null, giant: true });
      route(dep.id, F, [{ kind: 'radhaz', t: 0.5 }], 0.05, 16);
      if (D2.id !== dep.id) route(F, D2.id, [{ kind: 'radhaz', t: 0.45 }], 0.12, 16);
      if (k + 1 < st.N) route(F, pivotAt(st, k + 1, a).id, [{ kind: 'burn', t: 0.55, extra: { purpose: 'transition' } }], 0.03, 18);
      bodies.push({ id: `${F}-body`, name: it.name, kind: it.giantKind || 'gas', x: C.x, y: C.y, size, star: st.i });
      // SM-7b: the escape ladder curls round the -90 side; moons branch off burns 2 and 3
      const R = 34; // just outside the giant's sphere (haloR 24)
      const b1 = add('burn', pol(outAng - 158, R + 6), { purpose: 'escape', body: it.name, rung: 1 });
      const b2 = add('burn', pol(outAng - 112, R), { purpose: 'escape', body: it.name, rung: 2 });
      const b3 = add('burn', pol(outAng - 62, R), { purpose: 'escape', body: it.name, rung: 3 });
      route((D0.id !== dep.id ? D0 : dep).id, b1, [], 0.1, 16); route(b1, b2, [], 0.12, 14); route(b2, b3, [], 0.12, 14);
      const moons = (it.moons || []).filter((m) => (m.size | 0 || 6) > 2);
      const moonlets = (it.moons || []).filter((m) => (m.size | 0 || 6) <= 2);
      // the moon sector: from just past rung 1 round to just short of the slingshot exit
      const lo = outAng - 126, hi = outAng - 18;
      moons.forEach((m, i) => {
        const ma = moons.length === 1 ? (lo + hi) / 2 : lo + ((hi - lo) * i) / (moons.length - 1);
        const md = 64 + (i % 2) * 32; // alternate near / far so sites stay SITE_GAP apart (SM-5e)
        const mc = pol(ma, md);
        const msize = clamp(m.size | 0 || 6, 3, 9);
        const tag = { moonOf: it.name };
        const mlag = add('lagrange', pol(ma, md - 18), { purpose: 'orbit', body: m.name, ...tag });
        const from = Math.abs(((ma - (outAng - 112) + 540) % 360) - 180) <= Math.abs(((ma - (outAng - 62) + 540) % 360) - 180) ? b2 : b3; // the rung nearer in angle
        const me = moonEscape(msize);
        const stops = [...(from === b3 ? [{ kind: 'radhaz', t: 0.25 }] : []), // SM-6a: the inner moons' belts
          ...Array.from({ length: me }, (_, j) => ({ kind: 'burn', t: 0.4 + (0.5 * (j + 1)) / (me + 1), extra: { purpose: 'escape', body: m.name, ...tag } }))];
        route(from, mlag, stops, 0.06, 14);
        const ss = placeSites(m.name, 'moon', mc, clamp(m.sites | 0 || 1, 1, 2), ma, 24, msize, { ...tag, ocean: !!m.ocean }, 84);
        ss.forEach((s, j) => landTo(mlag, s.sid, landingOf(msize), j === 0 && msize >= 8, false));
      });
      moonlets.forEach((m, i) => { // SM-7b moonlets: off the first burn, one burn, one site
        const ma = outAng - 174 - i * 26;
        const s = placeSites(m.name, 'moon', pol(ma, 80), 1, ma, 0, clamp(m.size | 0 || 2, 1, 2), { moonOf: it.name, ocean: !!m.ocean })[0];
        route(b1, s.sid, [{ kind: 'burn', t: 0.55, extra: { purpose: 'escape', body: m.name, moonOf: it.name } }], 0.08, 16);
      });
      continue;
    }
    // planets, dwarfs, lone asteroids: pivot -> escape burns -> orbit -> landing -> sites
    const centre = P(L, a, st.mid(k) + 0.36 * w);
    const lag = add('lagrange', P(L, a, st.mid(k) + 0.24 * w), { purpose: 'orbit', body: it.name, fly: flybyOf(size) || null });
    if (k === 0) byId[lag].tags.hazard = true; // SM-6b
    const esc = wellBurns(size); // SM-4a
    route(dep.id, lag, Array.from({ length: esc }, (_, i) => ({ kind: 'burn', t: (i + 1) / (esc + 1), extra: { purpose: 'escape', body: it.name } })), 0.18, 16);
    const count = it.kind === 'planet' ? clamp(it.sites | 0 || 1, 1, 3) : 1; // SM-5a
    const landing = landingOf(size);
    const ss = placeSites(it.name, it.kind, centre, count, outAng, it.kind === 'planet' ? 33 : 14, size, { cls: it.cls || null });
    ss.forEach((s, j) => landTo(lag, s.sid, landing, false, !!it.atmosphere && j === 0)); // SM-6c aerobrake on one landing
  }
  const zones = zoneLayer(stars);
  const map = { spec, stars: S.map((st) => ({ id: starNodes[st.i], name: st.name, type: st.type || 'yellow', role: st.role, zones: st.N, x: st.L.cx, y: st.L.cy })), nodes, edges, sites, bodies, zones };
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
  // 4. well depth: burns from a site out to the nearest pivot, never via a slingshot
  const isFly = (n) => n.purpose === 'flyby';
  const wellDepth = (s, avoidFly = false) => {
    const dist = { [s]: 0 }; const open = [s]; const done = new Set();
    while (open.length) {
      open.sort((p, q) => dist[p] - dist[q]); const n = open.shift(); if (done.has(n)) continue; done.add(n);
      if (byId[n].kind === 'hohmann') return dist[n];
      for (const m of adj[n]) { if (avoidFly && isFly(byId[m])) continue; const nd = dist[n] + (byId[m].kind === 'burn' ? 1 : 0); if (dist[m] == null || nd < dist[m]) { dist[m] = nd; open.push(m); } }
    }
    return null;
  };
  // SM-4a: worlds (planets, dwarfs, asteroids) deepen with size; SM-4b: moons
  // sit deeper than their giant's own well, so they are checked on their own
  const wells = {}; const moonBad = []; let moonCount = 0;
  for (const s of nodes.filter((n) => n.kind === 'site')) {
    const d = wellDepth(s.id);
    if (s.bodyKind === 'moon') { if (s.size <= 2) continue; moonCount++; if (d == null || d < 4) moonBad.push(s.body); continue; } // ladder 2+ and at least 1 of its own + landing
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
  // 6. radiation only in a star's innermost zone or a giant's belts
  const nearGiant = (n) => (map.bodies || []).some((g) => Math.hypot(g.x - n.x, g.y - n.y) < 150);
  const stray = nodes.filter((n) => n.kind === 'radhaz' && !(n.star >= 0 && n.zone === 0) && !nearGiant(n));
  check('SM-6a radiation only near a star or a giant', stray.length === 0, stray.length ? `${stray.length} stray radiation nodes` : `${nodes.filter((n) => n.kind === 'radhaz').length} radiation nodes`);
  // 7. site spacing
  const ss = nodes.filter((n) => n.kind === 'site'); let close = 0;
  for (let i = 0; i < ss.length; i++) for (let j = i + 1; j < ss.length; j++) if (Math.hypot(ss[i].x - ss[j].x, ss[i].y - ss[j].y) < SITE_GAP) close++; // same body too: hexes must not stack
  check(`SM-5e sites at least ${SITE_GAP} px apart`, close === 0, close ? `${close} pairs too close` : 'labels clear');
  // 8. no slingshot into a moon's orbit: moon routes never touch a flyby point,
  // and every moon is reachable down its giant's ladder without one
  const flys = nodes.filter(isFly);
  const touch = flys.filter((f) => real(f.id).some((m) => byId[m].moonOf));
  const moonSites = ss.filter((n) => n.bodyKind === 'moon');
  const viaFly = moonSites.filter((n) => wellDepth(n.id, true) == null);
  check('SM-7 moons branch off the ladder, not the slingshot', !touch.length && !viaFly.length,
    touch.length ? `${touch.length} flyby points lead to a moon` : viaFly.length ? `${viaFly.length} moon sites only reachable by slingshot` : `${flys.length} slingshot points, ${moonSites.length} moon sites off the ladders`);
  // 9. asteroids are most of the sites
  const rocks = ss.filter((n) => n.bodyKind === 'asteroid').length;
  check(`SM-5f asteroids at least ${Math.round(ASTEROID_SHARE * 100)}% of sites`, !ss.length || rocks / ss.length >= ASTEROID_SHARE, `${rocks} of ${ss.length} sites (${ss.length ? Math.round((100 * rocks) / ss.length) : 0}%)`);
  return out;
}
