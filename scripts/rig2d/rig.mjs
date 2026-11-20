// A 2D human rig for the colonist card art (owner 2026-11-20: "make a 2d human
// rig, and pose that, swap out assets etc"). Build-time only, pure string
// builders, no engine.
//
//  - SKELETON: joints in a rest pose (front view, standing, arms down), units of
//    one head height, origin at the pelvis, y down. Bones join two joints.
//  - SKINNED MESHES: every body / clothing part is an outline of points in rest
//    coordinates. Each point is weighted to the bones of its chain (inverse
//    distance, so a joint bends the outline smoothly: no caps, no seams).
//  - POSE: target positions for the joints (the posed MPFB reference projected to
//    the card, scripts/blender/poses/<scene>.json). Each bone maps its rest
//    frame onto the posed one: along the bone it stretches to the posed length
//    (foreshortening), across it scales by the figure scale, so widths stay
//    true when a limb points at the camera.
//  - OUTPUT: the deformed outline as a smooth closed Catmull-Rom curve.

// ---- skeleton --------------------------------------------------------------------
export const REST = {
  pelvis: [0, 0], chest: [0, -1.55], neck: [0, -2.3], headBase: [0, -2.55], headTop: [0, -3.45],
  shL: [0.82, -2.12], elL: [0.92, -0.78], wrL: [0.98, 0.42], tipL: [1.0, 1.12],
  shR: [-0.82, -2.12], elR: [-0.92, -0.78], wrR: [-0.98, 0.42], tipR: [-1.0, 1.12],
  hipL: [0.38, 0.12], knL: [0.42, 1.95], anL: [0.42, 3.75], toeL: [0.5, 4.05],
  hipR: [-0.38, 0.12], knR: [-0.42, 1.95], anR: [-0.42, 3.75], toeR: [-0.5, 4.05],
};
export const BONES = {
  spine: ['pelvis', 'chest'], upperChest: ['chest', 'neck'], neckB: ['neck', 'headBase'], head: ['headBase', 'headTop'],
  clavL: ['neck', 'shL'], upperL: ['shL', 'elL'], foreL: ['elL', 'wrL'], handL: ['wrL', 'tipL'],
  clavR: ['neck', 'shR'], upperR: ['shR', 'elR'], foreR: ['elR', 'wrR'], handR: ['wrR', 'tipR'],
  pelL: ['pelvis', 'hipL'], thighL: ['hipL', 'knL'], shinL: ['knL', 'anL'], footL: ['anL', 'toeL'],
  pelR: ['pelvis', 'hipR'], thighR: ['hipR', 'knR'], shinR: ['knR', 'anR'], footR: ['anR', 'toeR'],
};

// The MPFB pose export (card units) -> rig joints. _l is the figure's left.
export function posedJoints(marks, fid) {
  const g = (k) => marks[`${fid}.${k}`];
  const j = {
    pelvis: g('pelvis'), chest: g('spine_03'), neck: g('neck_01'), headBase: g('head'), headTop: g('head_tip'),
    shL: g('upperarm_l'), elL: g('lowerarm_l'), wrL: g('hand_l'), tipL: g('hand_l_tip'),
    shR: g('upperarm_r'), elR: g('lowerarm_r'), wrR: g('hand_r'), tipR: g('hand_r_tip'),
    hipL: g('thigh_l'), knL: g('calf_l'), anL: g('foot_l'), toeL: g('foot_l_tip'),
    hipR: g('thigh_r'), knR: g('calf_r'), anR: g('foot_r'), toeR: g('foot_r_tip'),
  };
  // MPFB's hand bone ends at the knuckles; carry the tip a little past them.
  for (const s of ['L', 'R']) j[`tip${s}`] = lerp(j[`wr${s}`], j[`tip${s}`], 1.45);
  return j;
}

// ---- math ------------------------------------------------------------------------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);
export const lerp = (a, b, t) => add(a, mul(sub(b, a), t));
const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
const perp = (a) => [-a[1], a[0]];
const f1 = (n) => (+n).toFixed(1);

function segDist(p, a, b) {
  const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  return len(sub(p, add(a, mul(ab, t))));
}

// ---- skinning --------------------------------------------------------------------
// Weights for one rest point over a chain of bones: inverse distance to the
// fourth power, so a point near the middle of a bone follows it alone and a
// point near a joint blends the two bones meeting there.
function weights(p, chain) {
  const ws = chain.map((b) => { const [a, c] = BONES[b]; return 1 / Math.pow(segDist(p, REST[a], REST[c]) + 0.04, 4); });
  const s = ws.reduce((x, y) => x + y, 0);
  return chain.map((b, i) => [b, ws[i] / s]);
}

export function makeRig(joints, scale) {
  // posed frame per bone: origin, unit direction, length ratio
  const frames = {};
  for (const [b, [a, c]] of Object.entries(BONES)) {
    const ra = REST[a], rc = REST[c], pa = joints[a], pc = joints[c];
    if (!pa || !pc) continue;
    const rd = sub(rc, ra), pd = sub(pc, pa);
    frames[b] = { ra, rdir: unit(rd), rlen: len(rd) || 1, pa, pdir: unit(pd), plen: len(pd) };
  }
  // A rest point -> posed, through one bone: along-bone stretches, across scales.
  const through = (p, b) => {
    const F = frames[b];
    const d = sub(p, F.ra), u = dot(d, F.rdir), v = dot(d, perp(F.rdir));
    const along = u * (F.plen / F.rlen);
    return add(add(F.pa, mul(F.pdir, along)), mul(perp(F.pdir), v * scale));
  };
  const deform = (p, chain) => {
    const w = weights(p, chain.filter((b) => frames[b]));
    let out = [0, 0];
    for (const [b, k] of w) out = add(out, mul(through(p, b), k));
    return out;
  };
  return { frames, deform, scale, joints };
}

// ---- curves ----------------------------------------------------------------------
// Closed Catmull-Rom through the points, as cubic Beziers (tension 0.5).
export function smoothClosed(pts) {
  const n = pts.length;
  let d = `M${f1(pts[0][0])},${f1(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1 = add(p1, mul(sub(p2, p0), 1 / 6)), c2 = sub(p2, mul(sub(p3, p1), 1 / 6));
    d += ` C${f1(c1[0])},${f1(c1[1])} ${f1(c2[0])},${f1(c2[1])} ${f1(p2[0])},${f1(p2[1])}`;
  }
  return d + 'Z';
}
export function smoothOpen(pts) {
  const n = pts.length;
  let d = `M${f1(pts[0][0])},${f1(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
    const c1 = add(p1, mul(sub(p2, p0), 1 / 6)), c2 = sub(p2, mul(sub(p3, p1), 1 / 6));
    d += ` C${f1(c1[0])},${f1(c1[1])} ${f1(c2[0])},${f1(c2[1])} ${f1(p2[0])},${f1(p2[1])}`;
  }
  return d;
}
export const vec = { sub, add, mul, dot, len, unit, perp, lerp, f1 };

// ---- forward kinematics (owner 2026-11-20: rig a front-facing character, then
// pose it by rotating its bones; never pose something already posed) ----
// Each bone's parent; rotating a bone turns everything below it about its start.
export const PARENT = {
  spine: null, upperChest: 'spine', neckB: 'upperChest', head: 'neckB',
  clavL: 'upperChest', upperL: 'clavL', foreL: 'upperL', handL: 'foreL',
  clavR: 'upperChest', upperR: 'clavR', foreR: 'upperR', handR: 'foreR',
  pelL: null, thighL: 'pelL', shinL: 'thighL', footL: 'shinL',
  pelR: null, thighR: 'pelR', shinR: 'thighR', footR: 'shinR',
};
const ORDER = Object.keys(PARENT);   // parents come before children
const rot = ([x, y], deg) => { const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c]; };

// pose = { root: [x, y] (the pelvis on the card), scale (px per head), rot: { bone: degrees } }
// Degrees are LOCAL (relative to the parent), positive = clockwise on screen.
export function fkJoints(pose) {
  const world = {};          // bone -> accumulated angle
  const J = { pelvis: pose.root };
  for (const b of ORDER) {
    const [a, c] = BONES[b];
    const ang = (PARENT[b] ? world[PARENT[b]] : 0) + ((pose.rot && pose.rot[b]) || 0);
    world[b] = ang;
    const off = sub(REST[c], REST[a]);
    J[c] = add(J[a], mul(rot(off, ang), pose.scale));
  }
  return { joints: J, world };
}
// The local angle that points bone b (from its start joint) at p, given the pose.
export function aimBone(pose, b, p) {
  const { joints, world } = fkJoints(pose);
  const [a, c] = BONES[b];
  const cur = sub(joints[c], joints[a]), want = sub(p, joints[a]);
  const d = (Math.atan2(want[1], want[0]) - Math.atan2(cur[1], cur[0])) * 180 / Math.PI;
  return (((pose.rot && pose.rot[b]) || 0) + d + 540) % 360 - 180;
}
