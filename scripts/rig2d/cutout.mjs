// Cut-out character kit (owner 2026-11-20: rebuild the human rig in the flat
// "character constructor" style - rigid parts with round joints, swappable heads,
// hands and clothes, posed by rotating bones from a front-facing rest pose).
//
// The style, as used by flat vector character kits:
//  - FLAT fills, no outlines, no gradients. Each material has ONE shade tone,
//    drawn as a crescent on the side away from the light (light from screen left).
//  - RIGID parts, one per bone. A limb segment is a capsule whose round ends are
//    circles CENTRED ON THE JOINTS, with the same radius on both sides of a joint,
//    so a rotation never opens a gap or a seam (the child's end circle covers the
//    parent's exactly).
//  - Sleeves, trouser tops and collars are parts of the limb or torso they
//    cover; a sleeve's round cap overlaps the torso in the same cloth colour.
//  - Stylised proportions: about 6.3 heads, big head, dot eyes, small mouth.
//  - Hands, heads (expressions) and hair are SWAPS, not deformations.
//
// Units: one head = 1, origin at the pelvis, y down, the figure's LEFT at +x.
// Pure ES module (no DOM, no Node): the browser app and the build both import it.

const f2 = (n) => (+n).toFixed(2).replace(/\.?0+$/, '') || '0';
const P = (p) => `${f2(p[0])},${f2(p[1])}`;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const len = (a) => Math.hypot(a[0], a[1]);
const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
const perp = (a) => [-a[1], a[0]];
const rot = ([x, y], deg) => { const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); return [x * c - y * s, x * s + y * c]; };

export function shade(hex, k = 0.84) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * k));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

// ---- skeleton ----------------------------------------------------------------------
export const BONES = {
  spine: ['pelvis', 'chest'], upperChest: ['chest', 'neck'], neckB: ['neck', 'headBase'], head: ['headBase', 'headTop'],
  clavL: ['neck', 'shL'], upperL: ['shL', 'elL'], foreL: ['elL', 'wrL'], handL: ['wrL', 'tipL'],
  clavR: ['neck', 'shR'], upperR: ['shR', 'elR'], foreR: ['elR', 'wrR'], handR: ['wrR', 'tipR'],
  pelL: ['pelvis', 'hipL'], thighL: ['hipL', 'knL'], shinL: ['knL', 'anL'], footL: ['anL', 'toeL'],
  pelR: ['pelvis', 'hipR'], thighR: ['hipR', 'knR'], shinR: ['knR', 'anR'], footR: ['anR', 'toeR'],
};
export const PARENT = {
  spine: null, upperChest: 'spine', neckB: 'upperChest', head: 'neckB',
  clavL: 'upperChest', upperL: 'clavL', foreL: 'upperL', handL: 'foreL',
  clavR: 'upperChest', upperR: 'clavR', foreR: 'upperR', handR: 'foreR',
  pelL: null, thighL: 'pelL', shinL: 'thighL', footL: 'shinL',
  pelR: null, thighR: 'pelR', shinR: 'thighR', footR: 'shinR',
};
const ORDER = Object.keys(PARENT);

// Body build -> rest joints + limb radii. female / male differ in shoulders,
// waist and hips; everything else is shared so heads and hands fit both.
// Body styles (owner 2026-11-20: "humans are a bit too skinny, try different art
// styles"): slim = the first kit; classic = the stock constructor kits (thicker
// limbs, broader body, bigger head); chunky = the rounder, big-headed kits.
export const STYLES = {
  slim: { limb: 1, shoulder: 0, hip: 0, torso: 1, head: 1, hand: 1, foot: 1 },
  classic: { limb: 1.38, shoulder: 0.07, hip: 0.04, torso: 1.16, head: 1.12, hand: 1.15, foot: 1.15 },
  chunky: { limb: 1.7, shoulder: 0.12, hip: 0.07, torso: 1.3, head: 1.3, hand: 1.3, foot: 1.3 },
};
export function skeleton(body = 'female', style = 'slim') {
  const m = body === 'male' || body === 'robot';
  const ST = body === 'robot' ? STYLES.slim : (STYLES[style] || STYLES.slim);
  const sh = (m ? 0.6 : 0.52) + ST.shoulder, hip = (m ? 0.22 : 0.25) + ST.hip;
  const J = {
    pelvis: [0, 0], chest: [0, -1.2], neck: [0, -1.74], headBase: [0, -1.92], headTop: [0, -2.92],
  };
  for (const [s, k] of [['L', 1], ['R', -1]]) {
    J['sh' + s] = [k * sh, -1.6]; J['el' + s] = [k * (sh + 0.1), -0.58]; J['wr' + s] = [k * (sh + 0.15), 0.32]; J['tip' + s] = [k * (sh + 0.17), 0.72];
    J['hip' + s] = [k * hip, 0.14]; J['kn' + s] = [k * (hip + 0.02), 1.62]; J['an' + s] = [k * (hip + 0.03), 3.04]; J['toe' + s] = [k * (hip + 0.13), 3.2];
  }
  const R = m
    ? { sh: 0.155, el: 0.12, wr: 0.095, hip: 0.22, kn: 0.165, an: 0.11 }
    : { sh: 0.14, el: 0.11, wr: 0.085, hip: 0.22, kn: 0.155, an: 0.1 };
  for (const k of Object.keys(R)) R[k] *= ST.limb;
  return { body: body === 'robot' ? 'robot' : m ? 'male' : 'female', J, R, ST };
}

// Forward kinematics. pose = { root:[x,y] px, scale px/head, rot:{ bone: local deg, root: deg } }
export function fk(sk, pose) {
  const world = {}, J = { pelvis: pose.root };
  const r0 = (pose.rot && pose.rot.root) || 0;
  for (const b of ORDER) {
    const [a, c] = BONES[b];
    const ang = (PARENT[b] ? world[PARENT[b]] : r0) + ((pose.rot && pose.rot[b]) || 0);
    world[b] = ang;
    const k = (pose.len && pose.len[b]) || 1;
    J[c] = add(J[a], mul(rot(sub(sk.J[c], sk.J[a]), ang), pose.scale * k));
  }
  world.root = r0;
  return { joints: J, world };
}
export function aim(sk, pose, b, p) {
  const { joints } = fk(sk, pose);
  const [a, c] = BONES[b];
  const cur = sub(joints[c], joints[a]), want = sub(p, joints[a]);
  const d = (Math.atan2(want[1], want[0]) - Math.atan2(cur[1], cur[0])) * 180 / Math.PI;
  return (((pose.rot && pose.rot[b]) || 0) + d + 540) % 360 - 180;
}
export function restPose(cx = 150, footY = 318, h = 46) {
  return { root: [cx, footY - 3.26 * h], scale: h, rot: {}, armsBehind: [] };
}

// ---- shape builders (rest coordinates) ---------------------------------------------
// Capsule between two joint circles (radii ra at a, rb at b): the limb segment.
export function capsule(a, b, ra, rb) {
  const d = sub(b, a), L = len(d) || 1e-6, u = unit(d), n = perp(u);
  const c = Math.max(-0.99, Math.min(0.99, (ra - rb) / L)), s = Math.sqrt(1 - c * c);
  const dir = (sg) => add(mul(u, c), mul(n, sg * s));
  const pa1 = add(a, mul(dir(1), ra)), pa2 = add(a, mul(dir(-1), ra));
  const pb1 = add(b, mul(dir(1), rb)), pb2 = add(b, mul(dir(-1), rb));
  const big = c > 0 ? [0, 1] : [1, 0];   // [arc at b, arc at a]
  return `M${P(pa1)}L${P(pb1)}A${f2(rb)},${f2(rb)} 0 ${big[0]} 0 ${P(pb2)}L${P(pa2)}A${f2(ra)},${f2(ra)} 0 ${big[1]} 0 ${P(pa1)}Z`;
}
// A sleeve / short leg: round cap at a, straight hem at fraction t toward b, a
// little wider than the limb (cloth stands off the skin).
export function sleeve(a, b, ra, rb, t, flare = 1.12) {
  const d = sub(b, a), L = len(d) || 1e-6, u = unit(d), n = perp(u);
  const rA = ra * flare, rT = (ra + (rb - ra) * t) * flare, hem = add(a, mul(u, L * t));
  const c = Math.max(-0.99, Math.min(0.99, (rA - rT) / (L * t))), s = Math.sqrt(1 - c * c);
  const dir = (sg) => add(mul(u, c), mul(n, sg * s));
  const pa1 = add(a, mul(dir(1), rA)), pa2 = add(a, mul(dir(-1), rA));
  const h1 = add(hem, mul(n, rT)), h2 = add(hem, mul(n, -rT));
  return `M${P(pa1)}L${P(h1)}Q${P(add(hem, mul(u, 0.03)))} ${P(h2)}L${P(pa2)}A${f2(rA)},${f2(rA)} 0 1 0 ${P(pa1)}Z`;
}
// Smooth closed curve through points (Catmull-Rom).
export function blob(pts) {
  const n = pts.length;
  let d = `M${P(pts[0])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    d += `C${P(add(p1, mul(sub(p2, p0), 1 / 6)))} ${P(sub(p2, mul(sub(p3, p1), 1 / 6)))} ${P(p2)}`;
  }
  return d + 'Z';
}
const mirror = (pts, k) => pts.map(([x, y]) => [x * k, y]);
const sym = (half) => [...half, ...half.slice().reverse().map(([x, y]) => [-x, y])];   // half from top-centre down the +x side
const f3 = (n) => (+n).toFixed(3).replace(/\.?0+$/, '') || '0';   // small dots need the precision: a rounded radius can bend the arcs into a figure-8
const ell = (cx, cy, rx, ry) => `M${f3(cx - rx)},${f3(cy)}a${f3(rx)},${f3(ry)} 0 1 0 ${f3(2 * rx)},0a${f3(rx)},${f3(ry)} 0 1 0 ${f3(-2 * rx)},0Z`;

// ---- looks -------------------------------------------------------------------------
export const DEFAULT_LOOK = {
  style: 'classic', body: 'female', skin: '#f2c4a0', hair: '#2b2222', hairStyle: 'bob', face: 'smile',
  top: 'tee', topColor: '#efe4d3', collar: '#ffffff', bottom: 'trousers', bottomColor: '#5b2f2b', shoes: '#26262b',
  hands: { L: 'relaxed', R: 'relaxed' }, blush: true,
};
export const OPTIONS = {
  body: ['female', 'male', 'robot'],
  style: ['slim', 'classic', 'chunky'],
  hairStyle: ['tuft', 'bob', 'long', 'bun', 'ponytail', 'buzz', 'curly', 'bald'],
  face: ['smile', 'grin', 'neutral', 'wink', 'frown', 'surprised', 'shout', 'smirk', 'sleepy'],
  beard: ['', 'short', 'full'],
  top: ['tee', 'polo', 'longsleeve', 'jacket', 'jumpsuit'],
  bottom: ['trousers', 'shorts', 'skirt'],
  hand: ['relaxed', 'open', 'wave', 'fist', 'point', 'peace', 'thumb', 'ok', 'hold', 'pinch', 'flat'],   // HAND_POSE_NAMES
};

// ---- parts -------------------------------------------------------------------------
// Each part: { bone, layer, shapes:[{ d, fill, shade? }] } in rest coordinates.
// shade: true draws the crescent of the darker tone on the shadow side.
function headParts(sk, look) {
  const skin = look.skin, hair = look.hair, J = sk.J;
  const cy = J.headBase[1] - 0.47;           // face centre
  const face = blob([[0, cy - 0.5], [0.3, cy - 0.44], [0.4, cy - 0.12], [0.37, cy + 0.2], [0.24, cy + 0.4], [0, cy + 0.47], [-0.24, cy + 0.4], [-0.37, cy + 0.2], [-0.4, cy - 0.12], [-0.3, cy - 0.44]]);
  const ears = ell(0.39, cy + 0.02, 0.07, 0.1) + ell(-0.39, cy + 0.02, 0.07, 0.1);
  const back = [], front = [];
  const H = hairShapes(look.hairStyle, cy, look.body);
  if (H.back) back.push({ d: H.back, fill: hair, shade: true });
  const out = [{ d: ears, fill: skin }, { d: ell(0.4, cy + 0.03, 0.03, 0.05) + ell(-0.4, cy + 0.03, 0.03, 0.05), fill: shade(skin, 0.86) }, { d: face, fill: skin, shade: true }];
  if (look.beard) {
    // a full beard: from the sideburns round the jaw, the mustache over the lip,
    // the mouth left open (drawn on top)
    const Y = (v) => cy + v;
    const outer = [[0.4, Y(-0.12)], [0.39, Y(0.14)], [0.32, Y(0.38)], [0.16, Y(0.54)], [0, Y(0.58)], [-0.16, Y(0.54)], [-0.32, Y(0.38)], [-0.39, Y(0.14)], [-0.4, Y(-0.12)]];
    const inner = look.beard === 'short'
      ? [[-0.34, Y(-0.1)], [-0.3, Y(0.14)], [-0.16, Y(0.2)], [0, Y(0.18)], [0.16, Y(0.2)], [0.3, Y(0.14)], [0.34, Y(-0.1)]]
      : [[-0.33, Y(-0.1)], [-0.27, Y(0.12)], [-0.14, Y(0.17)], [0, Y(0.15)], [0.14, Y(0.17)], [0.27, Y(0.12)], [0.33, Y(-0.1)]];
    out.push({ d: blob([...outer, ...inner]), fill: hair, shade: true });
    out.push({ d: ell(0, cy + 0.26, 0.1, 0.05), fill: shade(skin, 0.8) });
  }
  out.push(...faceShapes(look.face, cy, skin, look.blush));
  if (H.front) out.push({ d: H.front, fill: hair, shade: true });
  if (H.extra) out.push(...H.extra.map((d) => ({ d, fill: shade(hair, 0.82) })));
  return { back, front: out };
}

function faceShapes(expr, cy, skin, blush) {
  const ink = '#2a1f1c', mouth = '#9b3f3f', y = cy + 0.02, out = [];
  const dot = (x, r = 0.042) => ell(x, y, r * 0.85, r);
  const stroke = (d, w = 0.035, col = ink) => ({ stroke: col, width: w, d });
  const brow = (dy = 0, tilt = 0) => [stroke(`M-0.22,${f2(y - 0.13 + dy + tilt)}Q-0.15,${f2(y - 0.17 + dy)} -0.08,${f2(y - 0.13 + dy - tilt)}`, 0.03),
    stroke(`M0.22,${f2(y - 0.13 + dy + tilt)}Q0.15,${f2(y - 0.17 + dy)} 0.08,${f2(y - 0.13 + dy - tilt)}`, 0.03)];
  const my = cy + 0.25;
  if (blush) out.push({ d: ell(0.24, cy + 0.15, 0.07, 0.04) + ell(-0.24, cy + 0.15, 0.07, 0.04), fill: '#ee8f88', opacity: 0.5 });
  out.push({ d: `M-0.02,${f2(cy + 0.07)}Q0.04,${f2(cy + 0.13)} -0.01,${f2(cy + 0.15)}`, stroke: shade(skin, 0.72), width: 0.025 });
  const eyes = (kind) => {
    if (kind === 'closed') return [stroke(`M-0.2,${f2(y)}Q-0.15,${f2(y + 0.04)} -0.1,${f2(y)}`), stroke(`M0.2,${f2(y)}Q0.15,${f2(y + 0.04)} 0.1,${f2(y)}`)];
    if (kind === 'happy') return [stroke(`M-0.2,${f2(y + 0.02)}Q-0.15,${f2(y - 0.04)} -0.1,${f2(y + 0.02)}`), stroke(`M0.2,${f2(y + 0.02)}Q0.15,${f2(y - 0.04)} 0.1,${f2(y + 0.02)}`)];
    if (kind === 'wink') return [{ d: dot(-0.15), fill: ink }, stroke(`M0.2,${f2(y + 0.01)}Q0.15,${f2(y - 0.04)} 0.1,${f2(y + 0.01)}`)];
    if (kind === 'wide') return [{ d: ell(-0.15, y, 0.05, 0.06), fill: ink }, { d: ell(0.15, y, 0.05, 0.06), fill: ink }];
    if (kind === 'sleepy') return [{ d: `M-0.2,${f2(y)}A0.05,0.05 0 0 0 -0.1,${f2(y)}Z`, fill: ink }, { d: `M0.1,${f2(y)}A0.05,0.05 0 0 0 0.2,${f2(y)}Z`, fill: ink }];
    return [{ d: dot(-0.15), fill: ink }, { d: dot(0.15), fill: ink }];
  };
  const E = {
    smile: () => [...eyes(), ...brow(), stroke(`M-0.08,${f2(my - 0.01)}Q0,${f2(my + 0.06)} 0.08,${f2(my - 0.01)}`, 0.03, mouth)],
    grin: () => [...eyes('happy'), ...brow(-0.02), { d: `M-0.11,${f2(my - 0.03)}Q0,${f2(my - 0.01)} 0.11,${f2(my - 0.03)}Q0.07,${f2(my + 0.1)} 0,${f2(my + 0.1)}Q-0.07,${f2(my + 0.1)} -0.11,${f2(my - 0.03)}Z`, fill: mouth }, { d: `M-0.08,${f2(my - 0.02)}Q0,${f2(my)} 0.08,${f2(my - 0.02)}L0.07,${f2(my + 0.01)}Q0,${f2(my + 0.02)} -0.07,${f2(my + 0.01)}Z`, fill: '#fff' }],
    neutral: () => [...eyes(), ...brow(), stroke(`M-0.06,${f2(my)}L0.06,${f2(my)}`, 0.028, mouth)],
    wink: () => [...eyes('wink'), ...brow(), stroke(`M-0.07,${f2(my)}Q0.01,${f2(my + 0.05)} 0.09,${f2(my - 0.03)}`, 0.03, mouth)],
    frown: () => [...eyes(), ...brow(0.01, -0.03), stroke(`M-0.07,${f2(my + 0.03)}Q0,${f2(my - 0.03)} 0.07,${f2(my + 0.03)}`, 0.03, mouth)],
    surprised: () => [...eyes('wide'), ...brow(-0.05), { d: ell(0, my + 0.02, 0.045, 0.06), fill: mouth }],
    shout: () => [...eyes('closed'), ...brow(0, -0.04), { d: `M-0.09,${f2(my - 0.04)}Q0,${f2(my - 0.06)} 0.09,${f2(my - 0.04)}Q0.06,${f2(my + 0.12)} 0,${f2(my + 0.12)}Q-0.06,${f2(my + 0.12)} -0.09,${f2(my - 0.04)}Z`, fill: mouth }],
    smirk: () => [...eyes(), ...brow(0, 0.02), stroke(`M-0.06,${f2(my + 0.01)}Q0.04,${f2(my + 0.02)} 0.09,${f2(my - 0.03)}`, 0.03, mouth)],
    sleepy: () => [...eyes('sleepy'), ...brow(0.02), stroke(`M-0.05,${f2(my)}Q0,${f2(my + 0.03)} 0.05,${f2(my)}`, 0.028, mouth)],
  };
  return [...out, ...(E[expr] || E.smile)()];
}

function hairShapes(style, cy, body) {
  const top = cy - 0.5, Y = (v) => cy + v;
  // a cap that follows the skull and leaves the forehead (fringe line at fy)
  const cap = (fy, side = 0.42, sideY = -0.05, puff = 0.06) => blob([[0, top - puff], [0.3, top - puff * 0.6 + 0.04], [side, Y(-0.25)], [side + 0.01, Y(sideY)], [0.34, Y(sideY - 0.02)], [0.3, Y(fy + 0.06)], [0.1, Y(fy)], [-0.12, Y(fy - 0.02)], [-0.3, Y(fy + 0.05)], [-0.34, Y(sideY - 0.02)], [-side - 0.01, Y(sideY)], [-side, Y(-0.25)], [-0.3, top - puff * 0.6 + 0.04]]);
  switch (style) {
    case 'tuft': return { front: cap(-0.27, 0.42, -0.06, 0.04) + `M-0.36,${f2(top + 0.12)}C-0.36,${f2(top - 0.12)} -0.1,${f2(top - 0.2)} 0.08,${f2(top - 0.12)}C0.18,${f2(top - 0.26)} 0.34,${f2(top - 0.26)} 0.42,${f2(top - 0.2)}C0.34,${f2(top - 0.14)} 0.32,${f2(top - 0.08)} 0.36,${f2(top - 0.02)}C0.44,${f2(top - 0.02)} 0.48,${f2(top + 0.06)} 0.44,${f2(top + 0.16)}C0.36,${f2(top + 0.04)} 0.0,${f2(top + 0.0)} -0.36,${f2(top + 0.12)}Z` };
    case 'buzz': return { front: cap(-0.33, 0.405, -0.12, 0.0) };
    case 'bald': return {};
    case 'curly': {
      const cs = [[0, -0.6, 0.17], [0.2, -0.56, 0.16], [-0.2, -0.56, 0.16], [0.36, -0.42, 0.14], [-0.36, -0.42, 0.14], [0.44, -0.22, 0.12], [-0.44, -0.22, 0.12], [0.09, -0.38, 0.12], [-0.12, -0.36, 0.12], [0.27, -0.34, 0.1], [-0.28, -0.32, 0.1], [0.47, -0.03, 0.1], [-0.47, -0.03, 0.1]];
      return { front: cs.map(([x, y, r]) => ell(x, Y(y), r, r)).join('') };
    }
    case 'bun': return { front: cap(-0.27, 0.42, -0.05) + ell(0, top - 0.12, 0.17, 0.15) };
    case 'ponytail': return { back: blob([[0.28, Y(-0.42)], [0.5, Y(-0.3)], [0.62, Y(0.0)], [0.62, Y(0.4)], [0.52, Y(0.72)], [0.46, Y(0.4)], [0.4, Y(0.05)], [0.3, Y(-0.2)]]), front: cap(-0.26, 0.43, 0.05) + ell(0.4, Y(-0.3), 0.07, 0.07) };
    case 'long': return {
      back: blob([[0, top - 0.06], [0.42, top + 0.12], [0.48, Y(0.1)], [0.5, Y(0.6)], [0.4, Y(0.8)], [0.2, Y(0.62)], [0.0, Y(0.55)], [-0.2, Y(0.62)], [-0.4, Y(0.8)], [-0.5, Y(0.6)], [-0.48, Y(0.1)], [-0.42, top + 0.12]]),
      front: blob([[0.02, top - 0.06], [0.32, top + 0.03], [0.45, Y(-0.18)], [0.46, Y(0.3)], [0.38, Y(0.55)], [0.34, Y(0.1)], [0.3, Y(-0.18)], [0.12, Y(-0.3)], [0.04, Y(-0.38)], [-0.14, Y(-0.25)], [-0.3, Y(-0.18)], [-0.35, Y(0.1)], [-0.39, Y(0.55)], [-0.47, Y(0.3)], [-0.45, Y(-0.18)], [-0.32, top + 0.03]]),
    };
    case 'bob':
    default: return {
      back: blob([[0, top - 0.04], [0.44, top + 0.14], [0.5, Y(0.12)], [0.48, Y(0.36)], [0.0, Y(0.33)], [-0.48, Y(0.36)], [-0.5, Y(0.12)], [-0.44, top + 0.14]]),
      front: blob([[0.03, top - 0.06], [0.33, top + 0.03], [0.47, Y(-0.12)], [0.49, Y(0.3)], [0.4, Y(0.36)], [0.36, Y(0.0)], [0.3, Y(-0.22)], [0.0, Y(-0.25)], [-0.25, Y(-0.3)], [-0.36, Y(-0.12)], [-0.38, Y(0.1)], [-0.42, Y(0.36)], [-0.5, Y(0.3)], [-0.47, Y(-0.12)], [-0.33, top + 0.03]]),
    };
  }
}

// Hand shapes in local coords: origin at the wrist, +y along the hand bone,
// +x toward the body for the RIGHT hand (mirrored for the left). One head = 1.
import { handPieces, HAND_POSES, HAND_POSE_NAMES } from './hand.mjs';
export { HAND_POSES };
export const HAND_SCALE = 0.85;   // the hand shapes are drawn at this size about the wrist
// ---- hands: the hand rig (scripts/rig2d/hand.mjs), 100 units = 0.42 head -----------
const HU = 0.0042;
// The hand as kit shapes: one silhouette in one colour with a faint shade, gap
// and crease lines, and the thumb on top when it crosses in front. `kind` is a
// pose name or a hand pose object ({ view, rot, len, thumbFront }).
export function handShapes(kind, fill) {
  // flat, like the kits' hands: one colour, no shade, no crease lines (owner
  // 2026-11-20: "do we even need shading there?")
  const pose = typeof kind === 'object' ? kind : (HAND_POSES[kind] || HAND_POSES.relaxed);
  const { body, front } = handPieces(pose);
  const flat = (ds) => ({ d: ds.join(''), fill, unit: HU, pieces: ds });
  const out = [{ ds: body, fill, flat: true, unit: HU }];
  if (front.length) out.push({ ds: front, fill, flat: true, unit: HU });
  return out;
}

function clothes(look) {
  const top = look.top, long = top === 'longsleeve' || top === 'jacket' || top === 'jumpsuit';
  const pants = look.top === 'jumpsuit' ? look.topColor : look.bottomColor;
  return { long, pants, short: look.bottom === 'shorts', skirt: look.bottom === 'skirt' };
}

// Every part of the figure, keyed by name, in rest coordinates.
export function buildParts(look) {
  const L = { ...DEFAULT_LOOK, ...look, hands: { ...DEFAULT_LOOK.hands, ...(look && look.hands) } };
  const sk = skeletonFor(L), J = sk.J, R = sk.R, fem = sk.body === 'female', ST = sk.ST;
  if (sk.body === 'robot') return { sk, parts: robotParts(sk, L), look: L };
  const skin = L.skin, cloth = L.topColor, C = clothes(L);
  const parts = {};
  const H = headParts(sk, L);
  const hs = ST.head !== 1 ? [J.headBase, ST.head] : null;
  parts.hairBack = { bone: 'head', layer: 0, shapes: H.back, scaleAbout: hs };
  parts.head = { bone: 'head', layer: 60, shapes: H.front, scaleAbout: hs };
  parts.neck = { bone: 'neckB', layer: 40, shapes: [{ d: capsule([0, -1.55], J.headBase, 0.09, 0.09), fill: skin }, { d: `M-0.09,-1.92Q0,-1.84 0.09,-1.92L0.09,-1.8Q0,-1.74 -0.09,-1.8Z`, fill: shade(skin, 0.86) }] };

  // torso (shirt): shoulders round into the sleeve caps; hem tucks under the pelvis
  const sw = Math.abs(J.shL[0]), w = (fem ? 0.34 : 0.4) * ST.torso, hw = (fem ? 0.4 : 0.38) * ST.torso;
  const torso = blob(sym([[0.1, -1.76], [sw - 0.1, -1.73], [sw + 0.02, -1.6], [sw - 0.02, -1.38], [fem ? sw - 0.08 : sw - 0.06, -1.05], [w, -0.55], [hw, -0.12], [0.2, -0.06]]));
  const ts = [{ d: torso, fill: cloth, shade: true }];
  if (fem) ts.push({ d: `M-0.3,-1.06Q-0.17,-0.98 -0.06,-1.07M0.06,-1.07Q0.17,-0.98 0.3,-1.06`, stroke: shade(cloth, 0.86), width: 0.03 });
  // neckline
  if (L.top === 'polo') ts.push({ d: `M-0.03,-1.76L-0.22,-1.79L-0.13,-1.6Z M0.03,-1.76L0.22,-1.79L0.13,-1.6Z`, fill: L.collar }, { d: `M0,-1.74L0,-1.5`, stroke: shade(cloth, 0.8), width: 0.02 });
  else if (L.top === 'jacket') ts.push({ d: `M-0.1,-1.76L0.1,-1.76L0.05,-0.1L-0.05,-0.1Z`, fill: L.collar }, { d: `M-0.1,-1.76L-0.22,-1.5L-0.05,-1.1Z M0.1,-1.76L0.22,-1.5L0.05,-1.1Z`, fill: shade(cloth, 0.78) });
  else if (L.top === 'jumpsuit') ts.push({ d: `M0,-1.7L0,-0.1`, stroke: shade(cloth, 0.75), width: 0.025 }, { d: ell(0.2, -1.32, 0.07, 0.05), fill: L.collar });
  else ts.push({ d: `M-0.13,-1.77Q0,-1.6 0.13,-1.77`, stroke: shade(cloth, 0.82), width: 0.035 });
  parts.torso = { bone: 'spine', layer: 30, shapes: ts };

  // pelvis (trouser top / skirt): one piece over the thigh tops
  const pw = (fem ? 0.44 : 0.4) * ST.torso;
  const pelvisD = C.skirt
    ? blob(sym([[0.2, -0.12], [pw - 0.02, -0.08], [pw + 0.1, 0.5], [pw + 0.14, 0.95], [0.2, 0.98]]))
    : blob(sym([[0.2, -0.12], [pw - 0.03, -0.1], [pw, 0.15], [pw - 0.02, 0.4], [0.06, 0.42], [0.0, 0.3]]));
  parts.pelvis = { bone: 'root', layer: 25, shapes: [{ d: pelvisD, fill: C.pants, shade: true }, { d: `M${-pw + 0.02},-0.06L${pw - 0.02},-0.06`, stroke: shade(C.pants, 0.7), width: 0.04 }] };

  for (const [s, k] of [['L', 1], ['R', -1]]) {
    // arms
    const up = [{ d: capsule(J['sh' + s], J['el' + s], R.sh, R.el), fill: C.long ? cloth : skin, shade: true }];
    if (!C.long) up.push({ d: sleeve(J['sh' + s], J['el' + s], R.sh, R.el, 0.48), fill: cloth, shade: true });
    parts['upper' + s] = { bone: 'upper' + s, layer: 50, side: s, shapes: up };
    const fore = [{ d: capsule(J['el' + s], J['wr' + s], R.el, R.wr), fill: C.long ? cloth : skin, shade: true }];
    if (C.long) fore.push({ d: `M${P(add(J['wr' + s], [-R.wr * 1.15, -0.08]))}L${P(add(J['wr' + s], [R.wr * 1.15, -0.08]))}`, stroke: shade(cloth, 0.78), width: 0.03 });
    parts['fore' + s] = { bone: 'fore' + s, layer: 51, side: s, shapes: fore };
    const hands = handShapes(L.hands[s], skin);
    parts['hand' + s] = { bone: 'hand' + s, layer: 52, side: s, mirror: k, origin: J['wr' + s], handScale: ST.hand, shapes: hands };
    // legs
    const thighFill = C.short || C.skirt ? skin : C.pants;
    const th = [{ d: capsule(J['hip' + s], J['kn' + s], R.hip, R.kn), fill: thighFill, shade: true }];
    if (C.short) th.push({ d: sleeve(J['hip' + s], J['kn' + s], R.hip, R.kn, 0.5, 1.08), fill: C.pants, shade: true });
    parts['thigh' + s] = { bone: 'thigh' + s, layer: 10, side: s, shapes: th };
    parts['shin' + s] = { bone: 'shin' + s, layer: 11, side: s, shapes: [{ d: capsule(J['kn' + s], J['an' + s], R.kn, R.an), fill: C.short || C.skirt ? skin : C.pants, shade: true }] };
    const a = J['an' + s];
    parts['foot' + s] = { bone: 'foot' + s, layer: 12, side: s, scaleAbout: ST.foot !== 1 ? [a, ST.foot] : null, shapes: [{ d: blob(mirror([[-0.12, -0.06], [0.1, -0.07], [0.25, 0.05], [0.27, 0.17], [0.02, 0.19], [-0.15, 0.17], [-0.16, 0.04]], k).map((p) => add(p, a))), fill: L.shoes, shade: true },
      { d: `M${P(add(a, [k * -0.15, 0.15]))}L${P(add(a, [k * 0.25, 0.165]))}`, stroke: '#f2f2f2', width: 0.035 }] };
  }
  return { sk, parts, look: L };
}

// ---- render ------------------------------------------------------------------------
function shapeSvg(sh, uid, i) {
  if (sh.unit) { const { unit, ...rest } = sh; return `<g transform="scale(${unit})">${shapeSvg(rest, uid, i)}</g>`; }
  if (sh.stroke) return `<path d="${sh.d}" fill="none" stroke="${sh.stroke}" stroke-width="${sh.width}" stroke-linecap="round"/>`;
  const op = sh.opacity != null ? ` opacity="${sh.opacity}"` : '';
  if (sh.ds && sh.flat) return sh.ds.map((d) => `<path d="${d}" fill="${sh.fill}"/>`).join('');
  if (sh.ds) {
    // a union of pieces (a hand: palm + phalanges) shaded as ONE silhouette: the
    // dark tone peeks out on the shadow side, no clip (a many-piece clipPath
    // dropped pieces in Chromium and left a dark fingertip)
    const all = (fill, xf = '') => sh.ds.map((d) => `<path d="${d}" fill="${fill}"${xf}/>`).join('');
    return `${all(shade(sh.fill), ` transform="translate(${sh.so || 0.055},0.2)"`)}${all(sh.fill)}`;
  }
  if (!sh.shade) return `<path d="${sh.d}" fill="${sh.fill}"${op}/>`;
  const id = `${uid}c${i}`;
  // shade crescent: the shape in the dark tone, the lit tone offset toward the light on top
  return `<clipPath id="${id}"><path d="${sh.d}"/></clipPath><path d="${sh.d}" fill="${shade(sh.fill)}"/><g clip-path="url(#${id})"><path d="${sh.d}" fill="${sh.fill}" transform="translate(${-(sh.so || 0.055)},0.01)"/></g>`;
}
function partSvg(part, name, uid, xf) {
  let body = '';
  part.shapes.forEach((sh, i) => { body += shapeSvg(sh, `${uid}${name}`, i); });
  if (part.mirror) {
    // hand shapes are local to the wrist; mirror for the left hand
    const o = part.origin;
    const hsc = HAND_SCALE * (part.handScale || 1);
    body = `<g transform="translate(${f2(o[0])},${f2(o[1])}) scale(${f2((part.mirror === 1 ? -1 : 1) * hsc)},${f2(hsc)})">${body}</g>`;
  }
  if (part.scaleAbout) {
    const [o, k] = part.scaleAbout;
    body = `<g transform="translate(${f2(o[0])},${f2(o[1])}) scale(${f2(k)}) translate(${f2(-o[0])},${f2(-o[1])})">${body}</g>`;
  }
  return `<g data-part="${name}" transform="${xf}">${body}</g>`;
}

// drawCutout({ id, look, pose, explode }) -> svg string (a <g>).
// explode > 0 pulls the parts apart (the kit's exploded view).
export function drawCutout({ id = 'cut', look = {}, pose, explode = 0 }) {
  const { sk, parts } = buildParts(look);
  pose = pose || restPose();
  const { joints, world } = fk(sk, pose);
  const behind = new Set(pose.armsBehind || []);
  const items = [];
  for (const [name, part] of Object.entries(parts)) {
    const bone = part.bone, rs = bone === 'root' ? sk.J.pelvis : sk.J[BONES[bone][0]];
    const ps = bone === 'root' ? joints.pelvis : joints[BONES[bone][0]];
    const ang = world[bone] || 0;
    let off = [0, 0];
    if (explode) {
      const c = part.side ? sk.J[BONES[bone][1]] : rs;
      const mid = part.side ? mul(add(rs, c), 0.5) : (name === 'head' || name === 'hairBack' ? [0, -2.4] : name === 'neck' ? [0, -1.8] : name === 'torso' ? [0, -1.0] : [0, 0.1]);
      off = mul([mid[0] * 0.9, mid[1] * 0.42], explode * pose.scale);
    }
    const k = bone !== 'root' && pose.len && pose.len[bone];
    let squash = '';
    if (k && k !== 1) {
      const [a, c] = BONES[bone], d = sub(sk.J[c], sk.J[a]), deg = (Math.atan2(d[1], d[0]) * 180) / Math.PI;
      squash = ` rotate(${f2(deg)}) scale(${f2(k)},1) rotate(${f2(-deg)})`;
    }
    const xf = `translate(${f2(ps[0] + off[0])},${f2(ps[1] + off[1])}) rotate(${f2(ang)}) scale(${f2(pose.scale)})${squash} translate(${f2(-rs[0])},${f2(-rs[1])})`;
    let layer = part.layer;
    if (part.side && /^(upper|fore|hand)/.test(name) && behind.has(part.side)) layer -= 48;   // behind the legs / torso
    items.push([layer, partSvg(part, name, `${id}-`, xf)]);
  }
  items.sort((a, b) => a[0] - b[0]);
  return `<g id="${id}">${items.map((x) => x[1]).join('')}</g>`;
}

// A head alone (for the expressions row), centred at [x, y] with size px/head.
export function drawHead({ id = 'h', look = {}, x, y, size }) {
  const { sk, parts } = buildParts(look);
  const c = [0, sk.J.headBase[1] - 0.47];
  const xf = `translate(${f2(x)},${f2(y)}) scale(${f2(size)}) translate(${f2(-c[0])},${f2(-c[1])})`;
  return `<g>${partSvg(parts.hairBack, 'hb', id, xf)}${partSvg(parts.head, 'hd', id, xf)}</g>`;
}
// A hand alone, wrist at [x, y], pointing down.
export function drawHand({ id = 'hand', kind, skin = DEFAULT_LOOK.skin, x, y, size, side = 'R' }) {
  const shapes = handShapes(kind, skin);
  let body = ''; shapes.forEach((s, i) => { body += shapeSvg(s, id, i); });
  const k = size * HAND_SCALE;
  return `<g transform="translate(${f2(x)},${f2(y)}) scale(${f2(side === 'L' ? -k : k)},${f2(k)})">${body}</g>`;
}

// Named poses (local bone degrees, positive = clockwise on screen).
export const POSES = {
  rest: {},
  wave: { upperR: 150, foreR: 30, handR: -10, upperL: -8 },
  point: { upperL: -80, foreL: -6, handL: 0 },
  hipsHands: { upperL: -38, foreL: 78, handL: 20, upperR: 38, foreR: -78, handR: -20 },
  cheer: { upperL: -150, foreL: -20, upperR: 150, foreR: 20 },
  think: { upperR: 12, foreR: 150, handR: 30, upperL: -14, foreL: 100, head: -8 },
  stride: { thighL: -16, shinL: 6, thighR: 8, upperL: 14, upperR: -6, foreR: 20, root: 2 },
  shrug: { upperL: -38, foreL: -95, upperR: 38, foreR: 95, head: 8 },
};

// Two-bone IK: the local angles that put side s's wrist (or ankle, limb 'leg') on
// `target` (card px), keeping the rest of the pose. bend: +1 / -1 picks which way
// the elbow / knee folds. Returns a new pose.
export function reach(sk, pose, s, target, { limb = 'arm', bend = 1 } = {}) {
  const [b1, b2, j0, j1, j2] = limb === 'arm' ? ['upper' + s, 'fore' + s, 'sh' + s, 'el' + s, 'wr' + s] : ['thigh' + s, 'shin' + s, 'hip' + s, 'kn' + s, 'an' + s];
  const { joints, world } = fk(sk, pose);
  const kl = (b) => (pose.len && pose.len[b]) || 1;
  const S = joints[j0], l1 = len(sub(sk.J[j1], sk.J[j0])) * pose.scale * kl(b1), l2 = len(sub(sk.J[j2], sk.J[j1])) * pose.scale * kl(b2);
  const d0 = sub(target, S), d = Math.max(Math.abs(l1 - l2) + 1e-3, Math.min(l1 + l2 - 1e-3, len(d0)));
  const base = Math.atan2(d0[1], d0[0]);
  const a = Math.acos((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d));
  const u = base + bend * a;                                   // posed upper direction
  const E = add(S, [Math.cos(u) * l1, Math.sin(u) * l1]);
  const T = add(S, mul(unit(d0), d));
  const v = Math.atan2(T[1] - E[1], T[0] - E[0]);
  const restA = (x, y) => Math.atan2(sk.J[y][1] - sk.J[x][1], sk.J[y][0] - sk.J[x][0]);
  const deg = (r) => (r * 180) / Math.PI;
  const w1 = deg(u - restA(j0, j1)), w2 = deg(v - restA(j1, j2));
  const norm = (x) => ((x + 540) % 360) - 180;
  return { ...pose, rot: { ...pose.rot, [b1]: norm(w1 - world[PARENT[b1]]), [b2]: norm(w2 - w1) } };
}

// ---- robot build ---------------------------------------------------------------------
// Same skeleton and joints as the people, so every pose and the app carry over.
// Plates in the top colour, joints and hands in the bottom colour, the visor
// dark with eye lights in the collar colour. Robots SHOW their round joints.
export const ROBOT_LOOK = { body: 'robot', topColor: '#e9edf2', bottomColor: '#3a4250', collar: '#6fe3ff', shoes: '#3a4250', hands: { L: 'relaxed', R: 'relaxed' } };
function robotParts(sk, L) {
  const J = sk.J, R = sk.R, plate = L.topColor, joint = L.bottomColor, glow = L.collar, visor = '#141821';
  const cy = J.headBase[1] - 0.47, parts = {};
  parts.hairBack = { bone: 'head', layer: 0, shapes: [] };
  parts.head = { bone: 'head', layer: 60, shapes: [
    { d: ell(0.42, cy + 0.02, 0.08, 0.12) + ell(-0.42, cy + 0.02, 0.08, 0.12), fill: joint },
    { d: blob([[0, cy - 0.5], [0.32, cy - 0.44], [0.43, cy - 0.12], [0.4, cy + 0.24], [0.26, cy + 0.42], [0, cy + 0.46], [-0.26, cy + 0.42], [-0.4, cy + 0.24], [-0.43, cy - 0.12], [-0.32, cy - 0.44]]), fill: plate, shade: true },
    { d: blob([[0, cy - 0.2], [0.3, cy - 0.16], [0.34, cy + 0.06], [0.26, cy + 0.26], [0, cy + 0.3], [-0.26, cy + 0.26], [-0.34, cy + 0.06], [-0.3, cy - 0.16]]), fill: visor },
    { d: ell(-0.13, cy + 0.04, 0.06, 0.07) + ell(0.13, cy + 0.04, 0.06, 0.07), fill: glow },
    { d: `M-0.2,${f2(cy - 0.33)}Q0,${f2(cy - 0.4)} 0.2,${f2(cy - 0.33)}`, stroke: shade(plate, 0.8), width: 0.03 },
  ] };
  parts.neck = { bone: 'neckB', layer: 40, shapes: [{ d: capsule([0, -1.55], J.headBase, 0.08, 0.08), fill: joint }] };
  const sw = Math.abs(J.shL[0]);
  parts.torso = { bone: 'spine', layer: 30, shapes: [
    { d: blob(sym([[0.1, -1.76], [sw - 0.12, -1.74], [sw - 0.02, -1.58], [sw - 0.06, -1.1], [0.36, -0.55], [0.3, -0.12], [0.15, -0.08]])), fill: plate, shade: true },
    { d: blob(sym([[0.0, -1.5], [0.22, -1.46], [0.24, -1.1], [0.0, -1.0]])), fill: shade(plate, 0.9) },
    { d: ell(0, -1.24, 0.07, 0.07), fill: glow },
    { d: `M-0.22,-0.75L0.22,-0.75M-0.2,-0.55L0.2,-0.55`, stroke: shade(plate, 0.75), width: 0.03 },
  ] };
  parts.pelvis = { bone: 'root', layer: 25, shapes: [{ d: blob(sym([[0.18, -0.14], [0.34, -0.1], [0.36, 0.14], [0.26, 0.32], [0.0, 0.3]])), fill: plate, shade: true },
    { d: ell(0.22, 0.14, 0.13, 0.13) + ell(-0.22, 0.14, 0.13, 0.13), fill: joint }] };
  const limb = (a, b, ra, rb) => [{ d: ell(a[0], a[1], ra * 1.05, ra * 1.05), fill: joint }, { d: capsule(a, b, ra * 0.86, rb * 0.86), fill: plate, shade: true }];
  for (const [s, k] of [['L', 1], ['R', -1]]) {
    parts['upper' + s] = { bone: 'upper' + s, layer: 50, side: s, shapes: [{ d: ell(J['sh' + s][0], J['sh' + s][1], R.sh * 1.25, R.sh * 1.25), fill: plate, shade: true }, ...limb(J['sh' + s], J['el' + s], R.sh, R.el).slice(1)] };
    parts['fore' + s] = { bone: 'fore' + s, layer: 51, side: s, shapes: limb(J['el' + s], J['wr' + s], R.el, R.wr) };
    parts['hand' + s] = { bone: 'hand' + s, layer: 52, side: s, mirror: k, origin: J['wr' + s], shapes: handShapes(L.hands[s], joint) };
    parts['thigh' + s] = { bone: 'thigh' + s, layer: 10, side: s, shapes: limb(J['hip' + s], J['kn' + s], R.hip * 0.85, R.kn) };
    parts['shin' + s] = { bone: 'shin' + s, layer: 11, side: s, shapes: limb(J['kn' + s], J['an' + s], R.kn, R.an * 1.1) };
    const a = J['an' + s];
    parts['foot' + s] = { bone: 'foot' + s, layer: 12, side: s, shapes: [{ d: blob(mirror([[-0.12, -0.04], [0.12, -0.05], [0.24, 0.06], [0.24, 0.17], [-0.14, 0.17], [-0.15, 0.05]], k).map((p) => add(p, a))), fill: plate, shade: true },
      { d: `M${P(add(a, [k * -0.14, 0.17]))}L${P(add(a, [k * 0.24, 0.17]))}`, stroke: joint, width: 0.05 }] };
  }
  return parts;
}

// The skeleton a look is drawn on (body + style, with the kit defaults).
export const skeletonFor = (look = {}) => skeleton(look.body || DEFAULT_LOOK.body, look.style || DEFAULT_LOOK.style);
