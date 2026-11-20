// Assets for the 2D human rig (rig.mjs) and the figure builder that poses them.
// Every mesh is an outline in REST coordinates (one head = 1 unit, origin at the
// pelvis, y down, the figure's left at +x) with the bones it is skinned to.
// Swappable per figure: skin tone, hair, face, top (tee | shirt | suit | coat |
// sport), sleeves, trousers, shoes, hand shapes.
import { makeRig, fkJoints, smoothClosed, smoothOpen, vec, lerp, REST } from './rig.mjs';
const { sub, add, mul, len, unit, perp, f1 } = vec;

const mirror = (pts) => pts.map(([x, y]) => [-x, y]);
const sideBones = (chain, s) => chain.map((b) => b.replace(/L$/, s));

// ---- body meshes (left side; the right is mirrored) ----------------------------
const ARM = [[0.7, -2.27], [0.9, -2.15], [1.03, -1.96], [1.07, -1.6], [1.04, -1.12], [1.01, -0.8], [1.06, -0.42], [1.04, 0.0], [1.02, 0.44],
  [0.88, 0.46], [0.85, 0.02], [0.8, -0.48], [0.78, -0.8], [0.75, -1.2], [0.72, -1.6], [0.68, -1.95]];
const LEG = [[0.74, 0.0], [0.76, 0.6], [0.68, 1.4], [0.62, 1.95], [0.64, 2.45], [0.58, 3.2], [0.53, 3.72],
  [0.31, 3.72], [0.29, 3.2], [0.25, 2.45], [0.26, 1.95], [0.18, 1.2], [0.06, 0.55], [0.03, 0.12]];
export const TORSO_REST = [[0.26, -2.34], [0.7, -2.31], [0.88, -2.16], [0.82, -1.9], [0.72, -1.3], [0.62, -0.72], [0.68, -0.12], [0.62, 0.3],
  [-0.62, 0.3], [-0.68, -0.12], [-0.62, -0.72], [-0.72, -1.3], [-0.82, -1.9], [-0.88, -2.16], [-0.7, -2.31], [-0.26, -2.34]];
const NECK = [[0.2, -2.7], [0.23, -2.3], [0.26, -2.18], [-0.26, -2.18], [-0.23, -2.3], [-0.2, -2.7]];
const SHOE = [[0.56, 3.62], [0.6, 3.86], [0.62, 4.1], [0.5, 4.16], [0.3, 4.14], [0.26, 3.9], [0.28, 3.62]];

// ---- clothing meshes ------------------------------------------------------------
// built explicitly: neckline left, down the left side, across the hem, up the right side, neckline right
function topMesh(hem, neck) {
  const L = [[0.72, -2.27], [0.9, -2.12], [0.86, -1.88], [0.78, -1.4], [0.67, -0.92], [0.65, -0.6], [0.73, -0.1], [0.77, hem]];
  const R = mirror(L).reverse();
  const nk = neck === 'v' ? [[-0.3, -2.37], [0, -1.86], [0.3, -2.37]] : neck === 'collar' ? [[-0.28, -2.42], [-0.12, -2.1], [0, -2.0], [0.12, -2.1], [0.28, -2.42]] : [[-0.3, -2.37], [-0.14, -2.21], [0, -2.17], [0.14, -2.21], [0.3, -2.37]];
  return [...nk, ...L, ...R];
}
const SLEEVE_SHORT = [[0.66, -2.3], [0.9, -2.18], [1.06, -1.97], [1.11, -1.62], [1.11, -1.42], [0.76, -1.42], [0.7, -1.92]];
const SLEEVE_LONG = [[0.66, -2.3], [0.9, -2.18], [1.06, -1.97], [1.1, -1.6], [1.07, -1.12], [1.05, -0.8], [1.1, -0.42], [1.08, 0.0], [1.06, 0.36],
  [0.84, 0.39], [0.81, 0.0], [0.76, -0.48], [0.74, -0.8], [0.71, -1.2], [0.68, -1.6], [0.64, -1.95]];
const PANT_LEG = [[0.79, -0.2], [0.82, 0.6], [0.72, 1.4], [0.66, 1.95], [0.66, 2.45], [0.62, 3.2], [0.6, 3.68],
  [0.26, 3.68], [0.25, 3.2], [0.22, 2.45], [0.22, 1.95], [0.14, 1.2], [0.03, 0.6], [0.0, 0.25]];
const PANT_HIP = [[-0.76, -0.25], [0.76, -0.25], [0.8, 0.3], [0.2, 0.55], [0, 0.4], [-0.2, 0.55], [-0.8, 0.3]];

// hands in the hand bone's frame: x across (thumb at +x for the left hand), y from
// the wrist (0) toward the fingertips (1)
const HANDS = {
  relaxed: [[-0.12, 0], [-0.16, 0.25], [-0.17, 0.55], [-0.15, 0.82], [-0.08, 0.98], [0.02, 1.0], [0.1, 0.9], [0.13, 0.62], [0.19, 0.48], [0.22, 0.33], [0.16, 0.2], [0.12, 0]],
  open: [[-0.12, 0], [-0.17, 0.3], [-0.2, 0.88], [-0.13, 0.92], [-0.1, 0.55], [-0.06, 1.02], [0.01, 1.03], [0.03, 0.57], [0.08, 0.98], [0.14, 0.95], [0.13, 0.5], [0.26, 0.42], [0.28, 0.3], [0.17, 0.2], [0.12, 0]],
  fist: [[-0.12, 0], [-0.17, 0.25], [-0.18, 0.52], [-0.12, 0.64], [0.02, 0.67], [0.14, 0.6], [0.2, 0.45], [0.19, 0.24], [0.12, 0]],
  grip: [[-0.12, 0], [-0.18, 0.28], [-0.18, 0.6], [-0.08, 0.72], [0.06, 0.72], [0.17, 0.6], [0.2, 0.38], [0.14, 0.18], [0.12, 0]],
  point: [[-0.12, 0], [-0.17, 0.25], [-0.17, 0.55], [-0.09, 0.62], [-0.07, 1.05], [0.01, 1.07], [0.04, 0.62], [0.15, 0.56], [0.2, 0.4], [0.17, 0.2], [0.12, 0]],
};

const shade = (hex, k) => {
  const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
};

// ---- the figure ------------------------------------------------------------------
// look: { skin, hair, hairStyle, eyes, sex, top: tee|shirt|suit|coat|sport, topColor,
//         sleeves: short|long, pants, shoes, hands: {l, r}, faceProps }
// heads: { bust, profile } from the card art kit (drawn faces).
// A pose: { root: [x, y] (the pelvis on the card), scale (px per head), rot: { bone:
// local degrees }, armsBehind: ['L'|'R'] }. The rest pose is all zeros: the
// character standing, facing the viewer, arms down.
export function restPose(cx = 150, footY = 322, h = 36) {
  return { root: [cx, footY - 4.1 * h], scale: h, rot: {}, armsBehind: [] };
}

export function drawFigure({ id, fid, pose, look, heads }) {
  pose = pose || restPose();
  const J = fkJoints(pose).joints;
  const hb = J.headBase, ht = J.headTop;
  const scale = pose.scale;
  const R = makeRig(J, scale);
  const hyaw = look.face === 'profileR' ? 90 : look.face === 'profileL' ? -90 : look.face === 'back' ? 180 : look.face === '3qR' ? 35 : look.face === '3qL' ? -35 : 0;
  const behind = pose.armsBehind || [];
  const fid2 = fid || id;
  const skin = look.skin, skinS = shade(skin, 0.78);
  const top = look.topColor || '#888', topS = shade(top, 0.7), topH = shade(top, 1.15);
  const pants = look.pants || shade(top, 0.5), pantsS = shade(pants, 0.75);
  const defs = [];
  const grad = (name, a, b) => { defs.push(`<linearGradient id="${id}-${name}" x1="0" y1="0" x2="1" y2="0.25"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`); return `url(#${id}-${name})`; };
  const SKIN = grad('sk', shade(skin, 1.08), skinS), TOPF = grad('top', topH, topS), PANTF = grad('pn', shade(pants, 1.1), pantsS);
  const mesh = (pts, chain, fill, extra = '') => `<path d="${smoothClosed(pts.map((p) => R.deform(p, chain)))}" fill="${fill}"${extra}/>`;
  const line = (pts, chain, stroke, w = 1.6, op = 0.5) => `<path d="${smoothOpen(pts.map((p) => R.deform(p, chain)))}" stroke="${stroke}" stroke-width="${w}" fill="none" opacity="${op}" stroke-linecap="round"/>`;
  const side = (pts, s) => (s === 'L' ? pts : mirror(pts));

  const longSleeves = look.sleeves === 'long' || ['shirt', 'suit', 'coat'].includes(look.top);
  const armChain = (s) => sideBones(['clavL', 'upperL', 'foreL'], s);
  const arm = (s) => {
    const ch = armChain(s);
    let out = mesh(side(ARM, s), ch, SKIN);
    out += longSleeves ? mesh(side(SLEEVE_LONG, s), ch, TOPF) + line(side([[0.84, 0.3], [1.1, 0.27]], s), ch, topS, 2.4, 0.9)
      + line(side([[0.82, -0.86], [0.94, -0.74], [1.06, -0.86]], s), ch, topS, 1.4, 0.6)
      : mesh(side(SLEEVE_SHORT, s), sideBones(['clavL', 'upperL'], s), TOPF) + line(side([[0.68, -1.4], [1.14, -1.4]], s), sideBones(['upperL'], s), topS, 2, 0.8);
    // the hand, rigid on its bone
    const wr = J[`wr${s}`], tip = J[`tip${s}`], d = sub(tip, wr), u = unit(d), n = perp(u), L = len(d);
    const shape = HANDS[(look.hands && look.hands[s.toLowerCase()]) || 'relaxed'] || HANDS.relaxed;
    const flip = s === 'L' ? 1 : -1;
    const hp = shape.map(([x, y]) => add(add(wr, mul(u, y * L)), mul(n, x * flip * scale * 1.0)));
    out += `<path d="${smoothClosed(hp)}" fill="${skinS}"/>`;
    return out;
  };
  const legChain = (s) => sideBones(['pelL', 'thighL', 'shinL'], s);
  const leg = (s) => {
    const ch = legChain(s);
    if (!J[`kn${s}`]) return '';
    return mesh(side(PANT_LEG, s), ch, PANTF) + line(side([[0.5, 1.2], [0.44, 2.0], [0.46, 2.8]], s), ch, pantsS, 1.4, 0.5)
      + mesh(side(SHOE, s), sideBones(['shinL', 'footL'], s), look.shoes || '#22242a');
  };
  const torsoChain = ['spine', 'upperChest', 'clavL', 'clavR', 'pelL', 'pelR'];
  const hem = { tee: 0.32, sport: 0.3, shirt: 0.42, suit: 0.62, coat: 1.6 }[look.top] ?? 0.35;
  const neckStyle = { suit: 'v', coat: 'v', shirt: 'collar' }[look.top] || 'crew';
  const torsoMesh = topMesh(hem, neckStyle);
  const tChain = look.top === 'coat' ? [...torsoChain, 'thighL', 'thighR'] : torsoChain;
  let torso = mesh(torsoMesh, tChain, TOPF);
  torso += line([[0.55, -1.75], [0.62, -1.1], [0.58, -0.5]], torsoChain, topS, 1.6, 0.45) + line([[-0.55, -1.75], [-0.62, -1.1], [-0.58, -0.5]], torsoChain, topS, 1.6, 0.45);
  if (look.top === 'suit' || look.top === 'coat') {
    torso += mesh([[-0.3, -2.37], [0, -1.86], [0.3, -2.37], [0.12, -2.3], [0, -2.0], [-0.12, -2.3]], torsoChain, look.shirtColor || '#f2f2f2');
    torso += line([[-0.32, -2.36], [-0.05, -1.4], [0.05, hem - 0.1]], tChain, topS, 2.4, 0.9) + line([[0.32, -2.36], [0.06, -1.5]], torsoChain, topS, 2.4, 0.9);
  } else if (look.top === 'shirt') {
    torso += line([[0, -2.0], [0, hem - 0.05]], torsoChain, topS, 1.4, 0.8);
    for (const y of [-1.7, -1.2, -0.7, -0.2]) torso += mesh([[0.04, y], [0.08, y + 0.04], [0.04, y + 0.08], [0, y + 0.04]], torsoChain, topS);
  } else if (look.top === 'sport') {
    torso += line([[0.86, -2.15], [0.72, -0.1]], torsoChain, shade(top, 0.5), 3, 0.7) + line([[-0.86, -2.15], [-0.72, -0.1]], torsoChain, shade(top, 0.5), 3, 0.7);
  }
  const neck = mesh(NECK, ['neckB', 'upperChest'], SKIN) + line([[-0.18, -2.25], [0, -2.18], [0.18, -2.25]], ['upperChest'], skinS, 2, 0.4);

  // head: drawn 3/4 face or profile, by head yaw; sized and tilted to the head bone
  const hc = lerp(hb, ht, 0.45), r = scale * 0.49;
  const tilt = (Math.atan2(ht[0] - hb[0], hb[1] - ht[1]) * 180) / Math.PI;
  let head;
  const hairC = look.hair || '#2a1a10';
  if (Math.abs(hyaw) > 125) {
    head = { defs: '', svg: `<ellipse cx="${f1(hc[0])}" cy="${f1(hc[1])}" rx="${f1(r)}" ry="${f1(r * 1.15)}" fill="${hairC}"/>` };
  } else if (Math.abs(hyaw) > 55) {
    head = heads.profile({ id: `${id}hp`, cx: hc[0], cy: hc[1], r: r * 1.05, dir: hyaw > 0 ? 1 : -1, skin: [skin, skinS], hair: hairC, hairHi: shade(hairC, 1.7), style: look.profileHair || 'short', female: look.sex === 'female', eye: look.eyes || '#3a2414', lips: look.sex === 'female' ? '#a8504a' : '#a8685a' });
  } else {
    head = heads.bust({ id: `${id}hb`, cx: hc[0], cy: hc[1], r, skin: [skin, skinS], hair: hairC, hairHi: shade(hairC, 1.7), style: look.hairStyle || 'short', female: look.sex === 'female', shirt: ['#fff', '#ddd'], noBody: true, turn: Math.max(-0.9, Math.min(0.9, hyaw / 60)), eyes: look.eyes || '#3a2414', eyesClosed: !!look.eyesClosed, smile: !!look.smile, lips: look.sex === 'female' ? '#a8504a' : undefined, visor: look.visor });
  }
  defs.push(head.defs || '');
  const headSvg = `<g transform="rotate(${f1(tilt)} ${f1(hc[0])} ${f1(hc[1])})">${head.svg}</g>`;

  const svg = `<g class="rig ${fid2}">${behind.map(arm).join('')}${leg('L')}${leg('R')}${mesh(PANT_HIP, ['spine', 'pelL', 'pelR', 'thighL', 'thighR'], PANTF)}${neck}${torso}${headSvg}${['L', 'R'].filter((s) => !behind.includes(s)).map(arm).join('')}</g>`;
  return { defs: defs.join(''), svg, joints: J, scale };
}
