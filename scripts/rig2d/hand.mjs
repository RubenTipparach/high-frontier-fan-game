// Hand rig (owner 2026-11-20: "use hand rigs please"). The same method as the
// body: a skeleton drawn ONCE at rest (an open right hand, back view, fingers
// down), rigid round-jointed pieces hung on its bones, and a pose that only
// ROTATES bones from rest (plus `len`, the foreshortening of a bone folded
// toward the viewer). The left hand mirrors it.
//
// Units: a 100-unit box, wrist at 0,0, fingertips toward +y, thumb toward +x.
// Angles: degrees, positive = clockwise on screen (the body rig's convention).

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const len = (a) => Math.hypot(a[0], a[1]);
const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
const perp = (a) => [-a[1], a[0]];
const rot = ([x, y], deg) => { const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); return [x * c - y * s, x * s + y * c]; };

// ---- rest skeletons ------------------------------------------------------------------
// back: the back of an open hand. side: the hand seen edge-on (thumb in front),
// for grips and pinches; its four fingers stack, so only the index and a sliver
// of the middle show.
const FING = ['i', 'm', 'r', 'p'];
function backRest() {
  const J = { w: [0, 0], mc: [3, 45] };
  const K = { i: [14, 42], m: [4.5, 45], r: [-5.5, 44], p: [-15, 40] };
  const L = { i: [20, 13, 10], m: [22, 14, 11], r: [20, 13, 10], p: [15, 10, 8] };
  const A = { i: -2, m: 0, r: 1.5, p: 4 };    // a slight fan (negative = toward the thumb)
  for (const f of FING) {
    let p = K[f]; J[f + '0'] = p;
    for (let k = 0; k < 3; k++) { p = add(p, rot([0, L[f][k]], A[f])); J[f + (k + 1)] = p; }
  }
  Object.assign(J, { t0: [11, 9], t1: [23, 26], t2: [29.5, 39], t3: [32.5, 50] });
  return J;
}
function sideRest() {
  const J = { w: [0, 0], mc: [1, 46] };
  for (const [f, dx] of [['i', 0], ['m', -3]]) {
    const L = f === 'i' ? [21, 13, 10] : [22, 14, 11];
    let p = [1 + dx, 44 + (f === 'm' ? 1 : 0)]; J[f + '0'] = p;
    for (let k = 0; k < 3; k++) { p = add(p, [0, L[k]]); J[f + (k + 1)] = p; }
  }
  Object.assign(J, { t0: [6, 10], t1: [14, 27], t2: [17, 40], t3: [18.5, 50] });
  return J;
}
const REST = { back: backRest(), side: sideRest() };
const RAD = { i: 6.3, m: 6.5, r: 6.1, p: 5.3 };   // knuckle radius; tapers 0.95 / 0.9 / 0.85 toward the tip
const SIDE_RAD = { i: 7.2, m: 6.8 };

// bones: name -> [from, to, parent]
function bonesFor(view) {
  const B = { palm: ['w', 'mc', null] };
  for (const f of view === 'side' ? ['i', 'm'] : FING) {
    B[f + '1'] = [f + '0', f + '1', 'palm']; B[f + '2'] = [f + '1', f + '2', f + '1']; B[f + '3'] = [f + '2', f + '3', f + '2'];
  }
  B.t1 = ['t0', 't1', 'palm']; B.t2 = ['t1', 't2', 't1']; B.t3 = ['t2', 't3', 't2'];
  return B;
}
export const HAND_BONES = { back: bonesFor('back'), side: bonesFor('side') };

// Joint limits. A thumb's two outer joints only FLEX (curl toward the palm:
// clockwise in this view), never bend back; seen side-on the finger joints only
// curl toward the front (counter-clockwise). The base joints swing freely.
export const HAND_LIMITS = { t2: [-8, 90], t3: [-10, 90] };
const SIDE_LIMITS = { i2: [-110, 5], i3: [-90, 5], m2: [-110, 5], m3: [-90, 5] };
function limit(view, b, v) {
  const L = HAND_LIMITS[b] || (view === 'side' && SIDE_LIMITS[b]);
  return L ? Math.max(L[0], Math.min(L[1], v)) : v;
}
// FK: pose = { view, rot: { bone: deg }, len: { bone: k } } -> joints (100-unit box)
export function handJoints(pose = {}) {
  const view = pose.view === 'side' ? 'side' : 'back', R0 = REST[view], B = HAND_BONES[view];
  const J = { w: R0.w }, world = {};
  for (const [b, [a, c, par]] of Object.entries(B)) {
    const ang = (par ? world[par] : 0) + limit(view, b, (pose.rot && pose.rot[b]) || 0);
    world[b] = ang;
    // a child hanging off the palm (a knuckle, the thumb base) keeps its rest
    // offset from the wrist, rotated with the palm
    if (!(a in J)) J[a] = add(J.w, rot(sub(R0[a], R0.w), world.palm || 0));
    const k = (pose.len && pose.len[b] != null) ? pose.len[b] : 1;
    J[c] = add(J[a], mul(rot(sub(R0[c], R0[a]), ang), k));
  }
  return { joints: J, world, view };
}
export function handAim(pose, b, p) {
  const { joints } = handJoints(pose), [a, c] = HAND_BONES[pose.view === 'side' ? 'side' : 'back'][b];
  const cur = sub(joints[c], joints[a]), want = sub(p, joints[a]);
  const d = (Math.atan2(want[1], want[0]) - Math.atan2(cur[1], cur[0])) * 180 / Math.PI;
  return ((((pose.rot && pose.rot[b]) || 0) + d + 540) % 360) - 180;
}

// ---- shapes ----------------------------------------------------------------------------
const f2 = (n) => (+n).toFixed(2).replace(/\.?0+$/, '') || '0';
const P = (p) => `${f2(p[0])},${f2(p[1])}`;
function capsule(a, b, ra, rb) {
  const d = sub(b, a), L = len(d);
  if (L < 0.4) { const r = Math.max(ra, rb); return `M${f2(a[0] - r)},${f2(a[1])}a${f2(r)},${f2(r)} 0 1 0 ${f2(2 * r)},0a${f2(r)},${f2(r)} 0 1 0 ${f2(-2 * r)},0Z`; }
  const u = unit(d), n = perp(u);
  const c = Math.max(-0.99, Math.min(0.99, (ra - rb) / L)), s = Math.sqrt(1 - c * c);
  const dir = (sg) => add(mul(u, c), mul(n, sg * s));
  const pa1 = add(a, mul(dir(1), ra)), pa2 = add(a, mul(dir(-1), ra)), pb1 = add(b, mul(dir(1), rb)), pb2 = add(b, mul(dir(-1), rb));
  const big = c > 0 ? [0, 1] : [1, 0];
  return `M${P(pa1)}L${P(pb1)}A${f2(rb)},${f2(rb)} 0 ${big[0]} 0 ${P(pb2)}L${P(pa2)}A${f2(ra)},${f2(ra)} 0 ${big[1]} 0 ${P(pa1)}Z`;
}
function blob(pts) {
  const n = pts.length; let d = `M${P(pts[0])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    d += `C${P(add(p1, mul(sub(p2, p0), 1 / 6)))} ${P(sub(p2, mul(sub(p3, p1), 1 / 6)))} ${P(p2)}`;
  }
  return d + 'Z';
}
// palm outlines at rest (they turn with the palm bone)
const PALM = {
  back: [[-15.5, 0], [15, 0], [19, 12], [21, 30], [19, 41], [12, 47], [3, 50], [-6, 49], [-14, 45], [-19.5, 37], [-20, 18]],
  side: [[-9.5, 0], [9, 0], [11.5, 16], [11, 36], [8, 47], [0, 51], [-7, 49], [-11, 38], [-11.5, 16]],
};

// The posed hand: { back: pieces behind, body: the silhouette pieces, front: the
// thumb when it crosses in front, lines: gap lines } as path strings (100 units).
export function handPieces(pose = {}) {
  const { joints: J, world, view } = handJoints(pose);
  const palmPts = PALM[view].map((p) => add(J.w, rot(sub(p, REST[view].w), world.palm || 0)));
  const body = [blob(palmPts)], front = [], lines = [];
  const fingers = view === 'side' ? ['m', 'i'] : ['p', 'r', 'm', 'i'];
  for (const f of fingers) {
    const r0 = view === 'side' ? SIDE_RAD[f] : RAD[f], rs = [r0, r0 * 0.95, r0 * 0.9, r0 * 0.85];
    for (let k = 0; k < 3; k++) body.push(capsule(J[f + k], J[f + (k + 1)], rs[k], rs[k + 1]));
  }
  const tr = [8.6, 7.4, 6.6, 5.8], thumb = [];
  for (let k = 0; k < 3; k++) thumb.push(capsule(J['t' + k], J['t' + (k + 1)], tr[k], tr[k + 1]));
  (pose.thumbFront ? front : body).push(...thumb);
  // gap lines between neighbouring fingers that still touch (back view)
  if (view === 'back') {
    const order = ['i', 'm', 'r', 'p'];
    for (let n = 0; n < 3; n++) {
      const a = order[n], b = order[n + 1];
      for (let k = 0; k < 3; k++) {
        const pa = J[a + k], pb = J[b + k], qa = J[a + (k + 1)], qb = J[b + (k + 1)];
        const gap0 = len(sub(pa, pb)), gap1 = len(sub(qa, qb));
        if (gap0 > RAD[a] + RAD[b] + 1.5 || gap1 > RAD[a] + RAD[b] + 1.5) break;
        const m0 = mul(add(pa, pb), 0.5), m1 = mul(add(qa, qb), 0.5);
        if (len(sub(m1, m0)) < 2) continue;
        lines.push(`M${P(k === 0 ? add(m0, mul(unit(sub(m1, m0)), 4)) : m0)}L${P(m1)}`);
      }
    }
  }
  // folded fingers (shortened bones) show their knuckle crease
  for (const f of fingers) {
    const k1 = (pose.len && pose.len[f + '1']); if (k1 != null && k1 < 0.75) {
      const c = J[f + '1'], r = (view === 'side' ? SIDE_RAD[f] : RAD[f]) * 0.8;
      lines.push(`M${P(add(c, [-r, -1]))}Q${P(add(c, [0, 2]))} ${P(add(c, [r, -1]))}`);
    }
  }
  return { body, front, lines, joints: J };
}

// ---- poses (rotations from the open rest hand) -----------------------------------------
const fold = (f, deg = 0) => ({ [f + '1']: 0.5, [f + '2']: 0.12, [f + '3']: 0.05 });
const FIST_LEN = { ...fold('i'), ...fold('m'), ...fold('r'), ...fold('p') };
const THUMB_IN = { t1: 50, t2: 28, t3: 18 };            // across the folded fingers
export const HAND_POSES = {
  relaxed: { rot: { i1: -2, m1: 0, r1: 2, p1: 4, t1: 14, t2: 6 }, len: { i3: 0.85, m3: 0.85, r3: 0.85, p3: 0.85, i2: 0.92, m2: 0.92, r2: 0.92, p2: 0.92 } },
  open: { rot: { i1: -10, m1: -2, r1: 6, p1: 14, t1: -28, t2: -8 } },
  wave: { rot: { i1: -4, m1: 0, r1: 3, p1: 7, t1: -16, t2: -6 } },
  fist: { rot: { ...THUMB_IN }, len: FIST_LEN, thumbFront: true },
  point: { rot: { ...THUMB_IN }, len: { ...FIST_LEN, i1: 1, i2: 1, i3: 1 }, thumbFront: true },
  peace: { rot: { ...THUMB_IN, i1: -9, m1: 6 }, len: { ...FIST_LEN, i1: 1, i2: 1, i3: 1, m1: 1, m2: 1, m3: 1 }, thumbFront: true },
  thumb: { rot: { t1: -146, t2: 0, t3: 0 }, len: { ...FIST_LEN, t1: 0.55 } },
  ok: { rot: { i1: -30, i2: -62, i3: -58, m1: 0, r1: 6, p1: 14, t1: -22, t2: 40, t3: 34 }, len: { i1: 0.85 } },
  hold: { view: 'side', rot: { i1: -50, i2: -70, i3: -50, m1: -50, m2: -70, m3: -50, t1: 40, t2: 30 } },
  pinch: { view: 'side', rot: { i1: -28, i2: -35, i3: -20, m1: -70, m2: -80, m3: -60, t1: -6, t2: -8 } },
  flat: { view: 'side', rot: { t1: 10 } },
};
export const HAND_POSE_NAMES = Object.keys(HAND_POSES);
