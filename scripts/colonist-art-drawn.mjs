// Colonist people DRAWN from 3D pose references (owner 2026-11-20: "'inspired
// drawings' not filters, not tracing"). The MPFB bodies posed in Blender
// (scripts/blender/colonist_people.py) are reference only: their joints, the
// way the head and chest face, and which arm and leg are nearer the camera are
// exported to scripts/blender/poses/<scene>.json. Every line of the figure is
// then DRAWN here in the card's illustration style: tailored torsos with
// collars, seams and folds, sleeves and cuffs, trousers and shoes, shaped
// hands, and the drawn 3/4 face or true profile, sized and tilted to the pose.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { artKit } from './colonist-art-m4-fronts.mjs';
import { poseKit } from './colonist-art-people.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const POSES = join(HERE, 'blender', 'poses');
const SCENES = JSON.parse(readFileSync(join(HERE, 'blender', 'colonist_people.json'), 'utf8')).scenes;

export const hasPose = (id) => existsSync(join(POSES, `${id}.json`));
export const poseMarks = (id) => JSON.parse(readFileSync(join(POSES, `${id}.json`), 'utf8'));

// Garment family from the MakeHuman outfit named in the scene table.
const garment = (f) => {
  const c = (f.clothes || [''])[0];
  if (/elegantsuit/.test(c)) return 'suit';
  if (/sportsuit/.test(c)) return 'sport';
  if (/casualsuit0[35]|worksuit/.test(c)) return 'shirt';
  return 'tee';
};
const shade = (hex, k) => {
  const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
};

export function drawKit({ W, H }) {
  const { f1, radial, linear, bust } = artKit({ W, H });
  const { limb, hand, angle, profile } = poseKit({ W, H });
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const mul = (a, k) => [a[0] * k, a[1] * k];
  const len = (a) => Math.hypot(a[0], a[1]);
  const lerp = (a, b, t) => add(a, mul(sub(b, a), t));
  const P = (p) => `${f1(p[0])},${f1(p[1])}`;
  const nrm = (a) => { const l = len(a) || 1; return [-a[1] / l, a[0] / l]; };

  // Hair styles for the drawn heads, from the MakeHuman hair asset.
  const bustHair = (h) => (!h ? 'bald' : /afro/.test(h) ? 'curly' : /long|braid/.test(h) ? 'long' : /bob|ponytail/.test(h) ? 'long' : /short01|short04/.test(h) ? 'buzz' : 'short');
  const profHair = (h) => (!h ? 'buzz' : /long|braid/.test(h) ? 'long' : /bob|afro|ponytail/.test(h) ? 'bob' : /short01|short04/.test(h) ? 'buzz' : 'short');

  function figure(sceneId, f, m, { holo = false } = {}) {
    const id = `${sceneId}-${f.id}`.replace(/[^a-z0-9-]/gi, '');
    const J = (bn) => m[`${f.id}.${bn}`];
    const skin = f.skin || '#c99a7a', cloth = f.cloth || '#8a8a8a';
    const pants = f.pants || shade(cloth, garment(f) === 'suit' ? 0.85 : 0.55);
    const skinD = shade(skin, 0.78), clothD = shade(cloth, 0.7), clothL = shade(cloth, 1.12);
    const g = garment(f);
    const hd = J('head'), ht = J('head_tip');
    const hs = len(sub(ht, hd));                       // head bone length, card units
    const defs = [linear(`${id}-cl`, [['0%', clothL], ['100%', clothD]], 1, 1), linear(`${id}-pn`, [['0%', shade(pants, 1.1)], ['100%', shade(pants, 0.75)]], 1, 1),
      linear(`${id}-sk`, [['0%', skin], ['100%', skinD]], 1, 1)];
    const CL = `url(#${id}-cl)`, PN = `url(#${id}-pn)`, SK = `url(#${id}-sk)`;
    const out = [];
    const near = { arm: m[`${f.id}.near_arm`] || 'r', leg: m[`${f.id}.near_leg`] || 'r' };
    const far = { arm: near.arm === 'l' ? 'r' : 'l', leg: near.leg === 'l' ? 'r' : 'l' };
    const sleeveShort = g === 'tee' || g === 'sport';

    const armSvg = (side) => {
      const sh = J(`upperarm_${side}`), el = J(`lowerarm_${side}`), wr = J(`hand_${side}`), tip = J(`hand_${side}_tip`);
      const w = hs * 0.52;
      let s = limb(sh, el, w, w * 0.84, CL);
      if (sleeveShort) {
        const cuff = lerp(sh, el, 0.55);
        s = limb(sh, cuff, w * 1.05, w * 0.98, CL) + `<path d="M${P(add(cuff, mul(nrm(sub(el, sh)), w * 0.5)))} L${P(add(cuff, mul(nrm(sub(el, sh)), -w * 0.5)))}" stroke="${clothD}" stroke-width="2"/>`
          + limb(cuff, el, w * 0.8, w * 0.72, SK) + limb(el, wr, w * 0.7, w * 0.55, SK);
      } else {
        s += limb(el, wr, w * 0.8, w * 0.66, CL);
        // the elbow crease and a cuff
        s += `<path d="M${P(add(el, mul(nrm(sub(wr, el)), w * 0.3)))} Q${P(add(el, mul(sub(wr, el), 0.08)))} ${P(add(el, mul(nrm(sub(wr, el)), -w * 0.3)))}" stroke="${clothD}" stroke-width="1.6" fill="none" opacity="0.7"/>`;
        const c0 = lerp(el, wr, 0.88);
        s += limb(c0, wr, w * 0.7, w * 0.68, clothD);
      }
      const shape = f.pose && f.pose[`hand_${side}_shape`] || 'relaxed';
      const hp = shape === 'fist' || shape === 'grip' ? 'grip' : shape === 'point' ? 'point' : 'open';
      s += hand(wr, angle(wr, tip), hs * 0.42, skinD, hp, side === 'l' ? -1 : 1);
      return s;
    };
    const legSvg = (side) => {
      const hp = J(`thigh_${side}`), kn = J(`calf_${side}`), an = J(`foot_${side}`), toe = J(`foot_${side}_tip`);
      if (!hp || !kn || hp[1] > H + 40) return '';
      const w = hs * 0.78;
      return limb(hp, kn, w, w * 0.72, PN) + limb(kn, an, w * 0.7, w * 0.5, PN)
        + `<path d="M${P(add(kn, mul(nrm(sub(an, kn)), w * 0.25)))} l${f1(sub(an, kn)[0] * 0.15)},${f1(sub(an, kn)[1] * 0.15)}" stroke="${shade(pants, 0.6)}" stroke-width="1.5" opacity="0.6"/>`
        + limb(an, toe, w * 0.5, w * 0.42, '#24262c');
    };
    // torso: shoulders widened outward, a waist, hips over the thighs
    const shL = J('upperarm_l'), shR = J('upperarm_r'), nk = J('neck_01'), mid = lerp(shL, shR, 0.5);
    const out1 = (p, k) => add(p, mul(sub(p, mid), k));
    const hipL0 = J('thigh_l'), hipR0 = J('thigh_r'), pel = J('pelvis');
    const hmid = lerp(hipL0, hipR0, 0.5);
    const hipL = add(hipL0, mul(sub(hipL0, hmid), 0.55)), hipR = add(hipR0, mul(sub(hipR0, hmid), 0.55));
    const A = out1(shL, 0.18), B = out1(shR, 0.18);
    const wL = lerp(A, hipL, 0.62), wR = lerp(B, hipR, 0.62);
    const waistIn = (p, q) => add(p, mul(sub(q, p), 0.07));
    const WL = waistIn(wL, wR), WR = waistIn(wR, wL);
    const cTop = lerp(nk, J('head'), 0.4);
    const torsoD = `M${P(A)} Q${P(lerp(A, cTop, 0.5))} ${P(cTop)} Q${P(lerp(B, cTop, 0.5))} ${P(B)} Q${P(add(B, mul(sub(WR, B), 0.5)))} ${P(WR)} L${P(hipR)} Q${P(lerp(hipR, hipL, 0.5))} ${P(hipL)} L${P(WL)} Q${P(add(A, mul(sub(WL, A), 0.5)))} ${P(A)} Z`;
    const yaw = m[`${f.id}.spine_03_yaw`] || 0;
    const facingAway = Math.abs(yaw) > 115;
    let torso = `<path d="${torsoD}" fill="${CL}"/>`;
    // folds from the armpits toward the waist
    torso += `<path d="M${P(lerp(A, WL, 0.25))} Q${P(lerp(lerp(A, WL, 0.6), mid, 0.18))} ${P(lerp(WL, hipL, 0.4))} M${P(lerp(B, WR, 0.25))} Q${P(lerp(lerp(B, WR, 0.6), mid, 0.18))} ${P(lerp(WR, hipR, 0.4))}" stroke="${clothD}" stroke-width="1.8" fill="none" opacity="0.5"/>`;
    const neckBase = lerp(nk, cTop, 0.6), chest = lerp(neckBase, lerp(hipL, hipR, 0.5), 0.5), belt = lerp(WL, WR, 0.5);
    const xo = Math.max(-1, Math.min(1, yaw / 90));   // the centre line shifts as the chest turns
    const cl = (p) => add(p, [xo * hs * 0.25, 0]);
    if (!facingAway) {
      if (g === 'suit') {
        torso += `<path d="M${P(add(neckBase, [-hs * 0.32, 0]))} L${P(cl(chest))} L${P(add(neckBase, [hs * 0.32, 0]))}" fill="${shade(cloth, 1.6)}"/>`
          + `<path d="M${P(add(neckBase, [-hs * 0.42, -2]))} L${P(cl(lerp(chest, belt, 0.4)))} L${P(add(neckBase, [hs * 0.42, -2]))}" stroke="${clothD}" stroke-width="2.4" fill="none"/>`
          + `<path d="M${P(cl(lerp(chest, belt, 0.4)))} L${P(cl(add(belt, [0, hs * 0.6])))}" stroke="${clothD}" stroke-width="1.5"/>${[0.55, 0.85].map((t) => `<circle cx="${f1(cl(lerp(chest, belt, t))[0] + 3)}" cy="${f1(lerp(chest, belt, t)[1])}" r="2" fill="${clothD}"/>`).join('')}`;
      } else if (g === 'shirt') {
        torso += `<path d="M${P(add(neckBase, [-hs * 0.3, -2]))} L${P(cl(add(neckBase, [0, hs * 0.35])))} L${P(add(neckBase, [hs * 0.3, -2]))}" fill="${SK}" stroke="${clothD}" stroke-width="2"/>`
          + `<path d="M${P(cl(add(neckBase, [0, hs * 0.35])))} L${P(cl(add(belt, [0, hs * 0.5])))}" stroke="${clothD}" stroke-width="1.4"/>${[0.2, 0.45, 0.7, 0.95].map((t) => `<circle cx="${f1(cl(lerp(chest, belt, t))[0] + 2.5)}" cy="${f1(lerp(neckBase, belt, t)[1])}" r="1.6" fill="${clothD}"/>`).join('')}
          <path d="M${P(lerp(A, chest, 0.35))} l${f1(hs * 0.35)},${f1(hs * 0.05)} l0,${f1(hs * 0.3)} l${f1(-hs * 0.35)},0 z" fill="none" stroke="${clothD}" stroke-width="1.2" opacity="0.6"/>`;
      } else {
        torso += `<path d="M${P(add(neckBase, [-hs * 0.34, -1]))} Q${P(cl(add(neckBase, [0, hs * 0.32])))} ${P(add(neckBase, [hs * 0.34, -1]))}" fill="${SK}" stroke="${clothD}" stroke-width="2.2"/>`;
        if (g === 'sport') torso += `<path d="M${P(lerp(A, hipL, 0.05))} L${P(lerp(WL, hipL, 0.5))} M${P(lerp(B, hipR, 0.05))} L${P(lerp(WR, hipR, 0.5))}" stroke="${shade(cloth, 0.55)}" stroke-width="3" opacity="0.6"/>`;
      }
      torso += `<path d="M${P(lerp(WL, hipL, 0.75))} L${P(lerp(WR, hipR, 0.75))}" stroke="${clothD}" stroke-width="1.5" opacity="0.55"/>`;
    }
    // neck
    const neck = limb(nk, lerp(nk, J('head'), 0.9), hs * 0.5, hs * 0.48, SK)
      + `<path d="M${P(add(nk, [-hs * 0.2, -hs * 0.05]))} Q${P(add(nk, [0, hs * 0.1]))} ${P(add(nk, [hs * 0.2, -hs * 0.05]))}" stroke="#000" stroke-width="2" opacity="0.12" fill="none"/>`;
    // head: the drawn 3/4 face, the true profile, or the back of the head
    const hyaw = m[`${f.id}.head_yaw`] || 0;
    const hc = lerp(hd, ht, 0.36);
    const tilt = (Math.atan2(ht[0] - hd[0], hd[1] - ht[1]) * 180) / Math.PI;
    const r = hs * 0.64;
    let head;
    if (Math.abs(hyaw) > 125) {
      head = { defs: '', svg: `<ellipse cx="${f1(hc[0])}" cy="${f1(hc[1])}" rx="${f1(r)}" ry="${f1(r * 1.12)}" fill="${f.hair_color || '#2a1a10'}"/>` };
    } else if (Math.abs(hyaw) > 52) {
      head = profile({ id: `${id}h`, cx: hc[0], cy: hc[1], r: r * 0.98, dir: hyaw > 0 ? 1 : -1, skin: [skin, skinD], hair: f.hair_color || '#2a1a10', hairHi: shade(f.hair_color || '#2a1a10', 1.6), style: profHair(f.hair), female: f.sex === 'female', eye: f.eyes || '#3a2414', lips: f.sex === 'female' ? '#a8504a' : '#a8685a' });
    } else {
      head = bust({ id: `${id}h`, cx: hc[0], cy: hc[1], r, skin: [skin, skinD], hair: f.hair_color || '#2a1a10', hairHi: shade(f.hair_color || '#2a1a10', 1.6), style: bustHair(f.hair), female: f.sex === 'female', shirt: ['#fff', '#ddd'], noBody: true, turn: Math.max(-0.9, Math.min(0.9, hyaw / 55)), eyes: f.eyes || '#3a2414', eyesClosed: !!f.eyes_closed, lips: f.sex === 'female' ? '#a8504a' : undefined, smile: !!f.smile });
    }
    head.svg = `<g transform="rotate(${f1(tilt)} ${f1(hc[0])} ${f1(hc[1])})">${head.svg}</g>`;
    defs.push(head.defs);
    out.push(armSvg(far.arm), legSvg(far.leg), legSvg(near.leg), `<g>${torso}</g>`, neck, head.svg, armSvg(near.arm));
    const svg = `<g class="figure ${f.id}"${holo ? ' opacity="0.8"' : ''}>${out.join('')}</g>`;
    return { defs: defs.join(''), svg };
  }

  // All figures of a scene, back to front (farthest from the camera first).
  function sceneFigures(sceneId) {
    const sc = SCENES.find((s) => s.id === sceneId);
    if (!sc || !hasPose(sceneId)) return null;
    const m = poseMarks(sceneId);
    const figs = sc.figures.map((f) => figure(sceneId, f, m));
    const g = figs.map((x) => x.svg).join('');
    return { defs: figs.map((x) => x.defs).join(''), g, m: (k) => m[k] || [150, 160] };
  }
  return { figure, sceneFigures };
}
