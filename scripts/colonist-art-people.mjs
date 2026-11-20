// Colonist cards with PEOPLE on them, third pass (owner 2026-11-20: "samey
// looking poses, all the new colonists you propose look like fat guys in a big
// featureless shirt ... make more dynamic poses", with the printed M2 deck as
// inspiration). Each card is staged after its printed card: profiles, hands,
// gesturing figures, a poster, slim figures in fitted clothes, light grounds
// where the print is light. Built on a posable figure (jointed arms, hands) and
// a true profile head, on top of the shared artKit. Pure string builders.
import { artKit } from './colonist-art-m4-fronts.mjs';

export const PEOPLE_FRONTS = new Set([
  // M2
  'col_heavy_water_survivalists', 'col_malcolm', 'col_botany_bay_convicts', 'col_vatican_observers',
  'col_juiced_cosmonauts', 'col_lloyd_s_salvage_co', 'col_house_of_saud', 'col_rock_rats_miners_union',
  'col_siren_cybernautics_inc',
  // M4
  'col_cobots', 'col_gabonese_mining_consortium', 'col_teleoperators', 'col_boston_hexapods',
  'col_vr_simulcasters', 'col_exoskeletalists',
]);

// Drawing primitives shared with colonist-art-drawn.mjs: tapered limbs, hands,
// arms, a slim torso, and a true profile head.
export function poseKit({ W, H }) {
  const { f1, radial, linear } = artKit({ W, H });
  const P = (pt) => `${f1(pt[0])},${f1(pt[1])}`;
  // ---- posable pieces ----------------------------------------------------------
  // A tapered limb segment a -> b (rounded ends).
  const limb = (a, b, wa, wb, fill) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
    return `<path d="M${f1(a[0] + nx * wa / 2)},${f1(a[1] + ny * wa / 2)} L${f1(b[0] + nx * wb / 2)},${f1(b[1] + ny * wb / 2)} L${f1(b[0] - nx * wb / 2)},${f1(b[1] - ny * wb / 2)} L${f1(a[0] - nx * wa / 2)},${f1(a[1] - ny * wa / 2)} Z" fill="${fill}"/>`
      + `<circle cx="${f1(a[0])}" cy="${f1(a[1])}" r="${f1(wa / 2)}" fill="${fill}"/><circle cx="${f1(b[0])}" cy="${f1(b[1])}" r="${f1(wb / 2)}" fill="${fill}"/>`;
  };
  // A hand at wrist `w`, pointing along `deg`; `pose` open | fist | point | grip.
  // `flip` mirrors the thumb side.
  const hand = (w, deg, s, skin, pose = 'open', flip = 1) => {
    const fingers = pose === 'open'
      ? [-0.32, -0.11, 0.1, 0.3].map((y, i) => `<rect x="${f1(s * 0.75)}" y="${f1(s * (y - 0.1))}" width="${f1(s * (0.62 - Math.abs(i - 1.5) * 0.07))}" height="${f1(s * 0.2)}" rx="${f1(s * 0.1)}"/>`).join('')
      : pose === 'point'
        ? `<rect x="${f1(s * 0.75)}" y="${f1(-s * 0.32)}" width="${f1(s * 0.75)}" height="${f1(s * 0.2)}" rx="${f1(s * 0.1)}"/><rect x="${f1(s * 0.62)}" y="${f1(-s * 0.1)}" width="${f1(s * 0.32)}" height="${f1(s * 0.42)}" rx="${f1(s * 0.15)}"/>`
        : `<rect x="${f1(s * 0.62)}" y="${f1(-s * 0.38)}" width="${f1(s * 0.38)}" height="${f1(s * 0.76)}" rx="${f1(s * 0.18)}"/>`;
    return `<g transform="translate(${f1(w[0])},${f1(w[1])}) rotate(${f1(deg)}) scale(1,${flip})" fill="${skin}">
      <ellipse cx="${f1(s * 0.42)}" cy="0" rx="${f1(s * 0.42)}" ry="${f1(s * 0.38)}"/>${fingers}
      <ellipse cx="${f1(s * 0.42)}" cy="${f1(-s * 0.42)}" rx="${f1(s * 0.28)}" ry="${f1(s * 0.12)}" transform="rotate(-30 ${f1(s * 0.42)} ${f1(-s * 0.42)})"/></g>`;
  };
  const angle = (a, b) => (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  // An arm: shoulder -> elbow -> wrist, with a sleeve, then the hand.
  const arm = ({ sh, el, wr, w = 22, sleeve = 'long', cloth, skin, pose = 'open', flip = 1, hs = 18 }) =>
    limb(sh, el, w, w * 0.82, cloth)
    + limb(el, wr, w * 0.78, w * 0.6, sleeve === 'long' ? cloth : skin)
    + (sleeve === 'long' ? `<circle cx="${f1(wr[0])}" cy="${f1(wr[1])}" r="${f1(w * 0.34)}" fill="${skin}"/>` : '')
    + hand(wr, angle(el, wr), hs, skin, pose, flip);
  // A slim torso between the shoulders and the hips, with soft folds.
  const torso = ({ shL, shR, hipL, hipR, cloth, fold = '#000', neckline = null }) => {
    const mL = [(shL[0] + hipL[0]) / 2 + 4, (shL[1] + hipL[1]) / 2], mR = [(shR[0] + hipR[0]) / 2 - 4, (shR[1] + hipR[1]) / 2];
    return `<path d="M${P(shL)} Q${f1((shL[0] + shR[0]) / 2)},${f1(Math.min(shL[1], shR[1]) - 6)} ${P(shR)} Q${P(mR)} ${P(hipR)} L${P(hipL)} Q${P(mL)} ${P(shL)} Z" fill="${cloth}"/>
      <path d="M${f1(shL[0] + 14)},${f1(shL[1] + 20)} Q${f1(mL[0] + 18)},${f1(mL[1] + 10)} ${f1(hipL[0] + 20)},${f1(hipL[1] - 4)} M${f1(shR[0] - 16)},${f1(shR[1] + 26)} Q${f1(mR[0] - 14)},${f1(mR[1] + 14)} ${f1(hipR[0] - 18)},${f1(hipR[1] - 6)}" stroke="${fold}" stroke-width="2" fill="none" opacity="0.14"/>
      ${neckline || ''}`;
  };
  // A true PROFILE head facing `dir` (1 right, -1 left), centred on the skull.
  const profile = ({ id, cx, cy, r, dir = 1, skin, hair, hairHi, style = 'short', eye = '#3a2414', female = false, lips = '#b0605a', brow }) => {
    const [sk0, sk1] = skin;
    const defs = `${radial(`${id}-pk`, [['0%', sk0], ['100%', sk1]], dir > 0 ? '65%' : '35%', '40%', '80%')}${linear(`${id}-ph`, [['0%', hairHi || hair], ['100%', hair]], 0.3, 1)}`;
    const k = (x, y) => `${f1(x)},${f1(y)}`;
    const hairPath = {
      short: `M0.42,-0.86 Q0.1,-1.22 -0.55,-1.0 Q-1.08,-0.62 -0.98,0.15 Q-0.86,0.42 -0.62,0.3 Q-0.55,-0.25 -0.2,-0.45 Q0.2,-0.6 0.62,-0.6 Z`,
      long: `M0.42,-0.86 Q0.1,-1.22 -0.55,-1.0 Q-1.1,-0.6 -1.05,0.4 Q-1.0,1.2 -0.7,1.75 L-0.25,1.7 Q-0.5,1.0 -0.55,0.3 Q-0.5,-0.3 -0.15,-0.48 Q0.25,-0.6 0.62,-0.58 Z`,
      bob: `M0.45,-0.86 Q0.1,-1.25 -0.6,-1.02 Q-1.12,-0.6 -1.02,0.3 Q-0.95,0.75 -0.6,0.82 L-0.45,0.4 Q-0.5,-0.25 -0.15,-0.48 Q0.25,-0.62 0.66,-0.55 Z`,
      buzz: `M0.4,-0.88 Q0.05,-1.15 -0.55,-0.98 Q-1.0,-0.62 -0.94,0.05 Q-0.8,0.05 -0.7,-0.1 Q-0.6,-0.55 -0.2,-0.7 Q0.15,-0.78 0.55,-0.72 Z`,
    }[style];
    const tf = `translate(${f1(cx)},${f1(cy)}) scale(${f1(r * dir)},${f1(r)})`;
    return { defs, svg: `<g transform="${tf}">
      <path d="M-0.28,0.55 L-0.4,1.7 L0.5,1.7 L0.4,0.7 Z" fill="${sk1}"/>
      <path d="M0.4,0.7 Q0.1,0.95 -0.3,0.75" fill="#000" opacity="0.15"/>
      <circle cx="-0.08" cy="-0.12" r="0.94" fill="url(#${id}-pk)"/>
      <path d="M0.3,-0.92 Q0.72,-0.72 0.78,-0.3 Q0.8,-0.2 0.84,-0.1 Q0.98,0.1 1.04,0.18 Q1.02,0.24 0.86,0.27 Q0.88,0.33 0.9,0.38 Q0.86,0.42 0.84,0.44 Q0.9,0.5 0.86,0.56 Q${female ? '0.78,0.8 0.56,0.86' : '0.8,0.82 0.6,0.9'} Q0.3,0.95 0.05,0.78 L-0.2,0.5 Z" fill="url(#${id}-pk)"/>
      <path d="M0.84,0.44 Q0.76,0.46 0.7,0.44" stroke="${lips}" stroke-width="0.05" fill="none" opacity="0.9"/>
      <path d="M0.88,0.37 Q0.8,0.42 0.74,0.44 Q0.82,0.52 0.86,0.55 Z" fill="${lips}" opacity="${female ? 0.85 : 0.45}"/>
      <path d="M0.42,-0.14 Q0.55,-0.22 0.66,-0.12 Q0.55,-0.06 0.42,-0.14 Z" fill="#f4efe8"/><circle cx="0.58" cy="-0.13" r="0.05" fill="${eye}"/>
      <path d="M0.4,-0.18 Q0.55,-0.27 0.68,-0.16" stroke="#2a1a10" stroke-width="0.035" fill="none"/>
      <path d="M0.36,-0.32 Q0.55,-0.42 0.76,-0.3" stroke="${brow || hair}" stroke-width="${female ? 0.05 : 0.08}" fill="none" stroke-linecap="round"/>
      <path d="M0.82,0.06 Q0.86,0.18 0.92,0.2" stroke="#000" stroke-width="0.03" fill="none" opacity="0.25"/>
      <ellipse cx="-0.12" cy="0.02" rx="0.15" ry="0.24" fill="${sk1}"/><path d="M-0.15,-0.08 Q-0.05,0.02 -0.14,0.12" stroke="#000" stroke-width="0.03" fill="none" opacity="0.25"/>
      <path d="${hairPath}" fill="url(#${id}-ph)"/>
    </g>` };
  };
  return { limb, hand, angle, arm, torso, profile };
}

export function drawPeopleFronts({ W, H, panel, emit }) {
  const { f1, rect, radial, linear, vignette, stars, rng, bust, robotBust } = artKit({ W, H });
  const P = (pt) => `${f1(pt[0])},${f1(pt[1])}`;
  const soft = (id) => radial(id, [['60%', '#000', 0], ['100%', '#000', 0.28]], '50%', '45%', '75%');

  // ---- posable pieces ----------------------------------------------------------
  // A tapered limb segment a -> b (rounded ends).
  const limb = (a, b, wa, wb, fill) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
    return `<path d="M${f1(a[0] + nx * wa / 2)},${f1(a[1] + ny * wa / 2)} L${f1(b[0] + nx * wb / 2)},${f1(b[1] + ny * wb / 2)} L${f1(b[0] - nx * wb / 2)},${f1(b[1] - ny * wb / 2)} L${f1(a[0] - nx * wa / 2)},${f1(a[1] - ny * wa / 2)} Z" fill="${fill}"/>`
      + `<circle cx="${f1(a[0])}" cy="${f1(a[1])}" r="${f1(wa / 2)}" fill="${fill}"/><circle cx="${f1(b[0])}" cy="${f1(b[1])}" r="${f1(wb / 2)}" fill="${fill}"/>`;
  };
  // A hand at wrist `w`, pointing along `deg`; `pose` open | fist | point | grip.
  // `flip` mirrors the thumb side.
  const hand = (w, deg, s, skin, pose = 'open', flip = 1) => {
    const fingers = pose === 'open'
      ? [-0.32, -0.11, 0.1, 0.3].map((y, i) => `<rect x="${f1(s * 0.75)}" y="${f1(s * (y - 0.1))}" width="${f1(s * (0.62 - Math.abs(i - 1.5) * 0.07))}" height="${f1(s * 0.2)}" rx="${f1(s * 0.1)}"/>`).join('')
      : pose === 'point'
        ? `<rect x="${f1(s * 0.75)}" y="${f1(-s * 0.32)}" width="${f1(s * 0.75)}" height="${f1(s * 0.2)}" rx="${f1(s * 0.1)}"/><rect x="${f1(s * 0.62)}" y="${f1(-s * 0.1)}" width="${f1(s * 0.32)}" height="${f1(s * 0.42)}" rx="${f1(s * 0.15)}"/>`
        : `<rect x="${f1(s * 0.62)}" y="${f1(-s * 0.38)}" width="${f1(s * 0.38)}" height="${f1(s * 0.76)}" rx="${f1(s * 0.18)}"/>`;
    return `<g transform="translate(${f1(w[0])},${f1(w[1])}) rotate(${f1(deg)}) scale(1,${flip})" fill="${skin}">
      <ellipse cx="${f1(s * 0.42)}" cy="0" rx="${f1(s * 0.42)}" ry="${f1(s * 0.38)}"/>${fingers}
      <ellipse cx="${f1(s * 0.42)}" cy="${f1(-s * 0.42)}" rx="${f1(s * 0.28)}" ry="${f1(s * 0.12)}" transform="rotate(-30 ${f1(s * 0.42)} ${f1(-s * 0.42)})"/></g>`;
  };
  const angle = (a, b) => (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  // An arm: shoulder -> elbow -> wrist, with a sleeve, then the hand.
  const arm = ({ sh, el, wr, w = 22, sleeve = 'long', cloth, skin, pose = 'open', flip = 1, hs = 18 }) =>
    limb(sh, el, w, w * 0.82, cloth)
    + limb(el, wr, w * 0.78, w * 0.6, sleeve === 'long' ? cloth : skin)
    + (sleeve === 'long' ? `<circle cx="${f1(wr[0])}" cy="${f1(wr[1])}" r="${f1(w * 0.34)}" fill="${skin}"/>` : '')
    + hand(wr, angle(el, wr), hs, skin, pose, flip);
  // A slim torso between the shoulders and the hips, with soft folds.
  const torso = ({ shL, shR, hipL, hipR, cloth, fold = '#000', neckline = null }) => {
    const mL = [(shL[0] + hipL[0]) / 2 + 4, (shL[1] + hipL[1]) / 2], mR = [(shR[0] + hipR[0]) / 2 - 4, (shR[1] + hipR[1]) / 2];
    return `<path d="M${P(shL)} Q${f1((shL[0] + shR[0]) / 2)},${f1(Math.min(shL[1], shR[1]) - 6)} ${P(shR)} Q${P(mR)} ${P(hipR)} L${P(hipL)} Q${P(mL)} ${P(shL)} Z" fill="${cloth}"/>
      <path d="M${f1(shL[0] + 14)},${f1(shL[1] + 20)} Q${f1(mL[0] + 18)},${f1(mL[1] + 10)} ${f1(hipL[0] + 20)},${f1(hipL[1] - 4)} M${f1(shR[0] - 16)},${f1(shR[1] + 26)} Q${f1(mR[0] - 14)},${f1(mR[1] + 14)} ${f1(hipR[0] - 18)},${f1(hipR[1] - 6)}" stroke="${fold}" stroke-width="2" fill="none" opacity="0.14"/>
      ${neckline || ''}`;
  };
  // A true PROFILE head facing `dir` (1 right, -1 left), centred on the skull.
  const profile = ({ id, cx, cy, r, dir = 1, skin, hair, hairHi, style = 'short', eye = '#3a2414', female = false, lips = '#b0605a', brow }) => {
    const [sk0, sk1] = skin;
    const defs = `${radial(`${id}-pk`, [['0%', sk0], ['100%', sk1]], dir > 0 ? '65%' : '35%', '40%', '80%')}${linear(`${id}-ph`, [['0%', hairHi || hair], ['100%', hair]], 0.3, 1)}`;
    const k = (x, y) => `${f1(x)},${f1(y)}`;
    const hairPath = {
      short: `M0.42,-0.86 Q0.1,-1.22 -0.55,-1.0 Q-1.08,-0.62 -0.98,0.15 Q-0.86,0.42 -0.62,0.3 Q-0.55,-0.25 -0.2,-0.45 Q0.2,-0.6 0.62,-0.6 Z`,
      long: `M0.42,-0.86 Q0.1,-1.22 -0.55,-1.0 Q-1.1,-0.6 -1.05,0.4 Q-1.0,1.2 -0.7,1.75 L-0.25,1.7 Q-0.5,1.0 -0.55,0.3 Q-0.5,-0.3 -0.15,-0.48 Q0.25,-0.6 0.62,-0.58 Z`,
      bob: `M0.45,-0.86 Q0.1,-1.25 -0.6,-1.02 Q-1.12,-0.6 -1.02,0.3 Q-0.95,0.75 -0.6,0.82 L-0.45,0.4 Q-0.5,-0.25 -0.15,-0.48 Q0.25,-0.62 0.66,-0.55 Z`,
      buzz: `M0.4,-0.88 Q0.05,-1.15 -0.55,-0.98 Q-1.0,-0.62 -0.94,0.05 Q-0.8,0.05 -0.7,-0.1 Q-0.6,-0.55 -0.2,-0.7 Q0.15,-0.78 0.55,-0.72 Z`,
    }[style];
    const tf = `translate(${f1(cx)},${f1(cy)}) scale(${f1(r * dir)},${f1(r)})`;
    return { defs, svg: `<g transform="${tf}">
      <path d="M-0.28,0.55 L-0.4,1.7 L0.5,1.7 L0.4,0.7 Z" fill="${sk1}"/>
      <path d="M0.4,0.7 Q0.1,0.95 -0.3,0.75" fill="#000" opacity="0.15"/>
      <circle cx="-0.08" cy="-0.12" r="0.94" fill="url(#${id}-pk)"/>
      <path d="M0.3,-0.92 Q0.72,-0.72 0.78,-0.3 Q0.8,-0.2 0.84,-0.1 Q0.98,0.1 1.04,0.18 Q1.02,0.24 0.86,0.27 Q0.88,0.33 0.9,0.38 Q0.86,0.42 0.84,0.44 Q0.9,0.5 0.86,0.56 Q${female ? '0.78,0.8 0.56,0.86' : '0.8,0.82 0.6,0.9'} Q0.3,0.95 0.05,0.78 L-0.2,0.5 Z" fill="url(#${id}-pk)"/>
      <path d="M0.84,0.44 Q0.76,0.46 0.7,0.44" stroke="${lips}" stroke-width="0.05" fill="none" opacity="0.9"/>
      <path d="M0.88,0.37 Q0.8,0.42 0.74,0.44 Q0.82,0.52 0.86,0.55 Z" fill="${lips}" opacity="${female ? 0.85 : 0.45}"/>
      <path d="M0.42,-0.14 Q0.55,-0.22 0.66,-0.12 Q0.55,-0.06 0.42,-0.14 Z" fill="#f4efe8"/><circle cx="0.58" cy="-0.13" r="0.05" fill="${eye}"/>
      <path d="M0.4,-0.18 Q0.55,-0.27 0.68,-0.16" stroke="#2a1a10" stroke-width="0.035" fill="none"/>
      <path d="M0.36,-0.32 Q0.55,-0.42 0.76,-0.3" stroke="${brow || hair}" stroke-width="${female ? 0.05 : 0.08}" fill="none" stroke-linecap="round"/>
      <path d="M0.82,0.06 Q0.86,0.18 0.92,0.2" stroke="#000" stroke-width="0.03" fill="none" opacity="0.25"/>
      <ellipse cx="-0.12" cy="0.02" rx="0.15" ry="0.24" fill="${sk1}"/><path d="M-0.15,-0.08 Q-0.05,0.02 -0.14,0.12" stroke="#000" stroke-width="0.03" fill="none" opacity="0.25"/>
      <path d="${hairPath}" fill="url(#${id}-ph)"/>
    </g>` };
  };
  const skinTone = { light: ['#f2d2b8', '#b88468'], tan: ['#d8a882', '#8a5a3c'], brown: ['#9a6a4c', '#4e2e1c'], dark: ['#6e4630', '#341c10'], pale: ['#f6e0d0', '#c49a84'] };

  // ================================ M2 ================================
  // Heavy Water Survivalists: an older woman in a "don't tread" tee, standing
  // between two white cryo-shelter doors. Light, clinical.
  {
    const sk = skinTone.tan, cloth = 'url(#hw-tee)';
    const head = bust({ id: 'hwh', cx: 172, cy: 96, r: 27, skin: sk, hair: '#1a1410', hairHi: '#3a2e26', style: 'long', female: true, shirt: ['#fff', '#ddd'], noBody: true, eyes: '#2a1408', lips: '#9a4a40', turn: -0.25 });
    emit('col_heavy_water_survivalists', 'front', panel({
      defs: `${linear('hw-bg', [['0%', '#f4f6f8'], ['100%', '#c8d0d8']])}${linear('hw-door', [['0%', '#ffffff'], ['100%', '#a8b2bc']], 1, 0)}${linear('hw-tee', [['0%', '#f4f6fa'], ['100%', '#c4ccd6']], 1, 1)}${head.defs}${soft('hw-v')}`,
      inner: `${rect('url(#hw-bg)')}
        <path d="M14,330 L14,96 Q14,24 70,20 Q126,24 126,96 L126,330 Z" fill="url(#hw-door)"/><path d="M40,330 L40,110 Q40,60 70,58 Q100,60 100,110 L100,330 Z" fill="#dfe6ec"/><path d="M50,120 Q48,220 52,320" stroke="#fff" stroke-width="6" opacity="0.7" fill="none"/>
        <path d="M286,330 L286,80 Q286,40 300,30 L300,330 Z" fill="#7a8794"/>
        ${limb([150, 158], [140, 238], 22, 18, cloth)}${limb([140, 238], [144, 300], 16, 13, `url(#hwh-sk)`)}${hand([144, 300], 92, 15, sk[1], 'grip')}
        ${torso({ shL: [146, 150], shR: [204, 152], hipL: [150, 330], hipR: [210, 330], cloth, neckline: `<path d="M162,146 Q176,166 190,146" fill="${sk[1]}"/>` })}
        ${limb([204, 156], [216, 238], 22, 18, cloth)}${limb([216, 238], [212, 300], 16, 13, `url(#hwh-sk)`)}${hand([212, 300], 92, 15, sk[1], 'grip', -1)}
        <path d="M168,140 L168,124 L186,124 L186,140 Z" fill="${sk[1]}"/>${head.svg}
        <g transform="translate(178,226) scale(0.9)" fill="#2a2a2a"><path d="M-16,-6 Q-24,8 -8,12 Q12,16 6,30 Q-2,40 -16,34 Q-6,32 -2,26 Q2,20 -10,18 Q-30,12 -20,-6 Z"/><circle cx="-14" cy="-8" r="5"/></g>
        <text x="178" y="282" text-anchor="middle" font-family="serif" font-size="8.5" fill="#2a2a2a">DONT TREAD ON ME</text>${rect('url(#hw-v)')}`,
    }));
  }
  // Malcolm: a young man in profile, chin on his hand, gazing up into the light.
  {
    const sk = skinTone.light;
    const pr = profile({ id: 'ml', cx: 168, cy: 130, r: 66, dir: 1, skin: sk, hair: '#5a3a20', hairHi: '#8a6040', style: 'short', eye: '#4a6a7a' });
    emit('col_malcolm', 'front', panel({
      defs: `${linear('ml-bg', [['0%', '#fbfaf6'], ['60%', '#e6e4dc'], ['100%', '#b8bcc4']], 1, 1)}${linear('ml-cl', [['0%', '#4a5262'], ['100%', '#1e222c']])}${pr.defs}${soft('ml-v')}`,
      inner: `${rect('url(#ml-bg)')}<rect x="232" y="0" width="68" height="${H}" fill="#fff" opacity="0.7"/>
        <path d="M60,330 Q70,262 132,238 L210,236 Q244,262 252,330 Z" fill="url(#ml-cl)"/>
        ${pr.svg}
        ${limb([118, 330], [168, 262], 34, 28, 'url(#ml-cl)')}${limb([168, 262], [218, 196], 24, 18, `url(#ml-pk)`)}
        <g transform="translate(222,192) rotate(-58)" fill="${sk[1]}"><ellipse cx="6" cy="0" rx="15" ry="12"/><rect x="12" y="-12" width="12" height="9" rx="4.5"/><rect x="10" y="-3" width="13" height="8" rx="4"/><rect x="8" y="5" width="12" height="8" rx="4"/>
          <rect x="16" y="-22" width="20" height="7" rx="3.5" transform="rotate(-20 16 -22)"/></g>${rect('url(#ml-v)')}`,
    }));
  }
  // Botany Bay Convicts: two hands snapping a chain, links flying in warm light.
  {
    const sk = skinTone.tan;
    const g = rng(61);
    const link = (x, y, a, c = '#3a3a3e') => `<g transform="translate(${f1(x)},${f1(y)}) rotate(${f1(a)})"><rect x="-9" y="-5" width="18" height="10" rx="5" fill="none" stroke="${c}" stroke-width="3.2"/></g>`;
    let chain = ''; for (let i = 0; i < 6; i++) chain += link(40 + i * 15, 220 - i * 12, -38 + (i % 2) * 90);
    let fly = ''; for (let i = 0; i < 9; i++) fly += link(130 + g() * 120, 40 + g() * 120, g() * 180, '#4a4a50');
    emit('col_botany_bay_convicts', 'front', panel({
      defs: `${radial('bb-bg', [['0%', '#fff4e0'], ['55%', '#f0c890'], ['100%', '#a86a3a']], '55%', '35%')}${linear('bb-sl', [['0%', '#5a3a2a'], ['100%', '#2a1a10']])}${radial('bb-sk', [['0%', sk[0]], ['100%', sk[1]]], '40%', '30%')}${soft('bb-v')}`,
      inner: `${rect('url(#bb-bg)')}
        <g stroke="#fff" stroke-width="2" opacity="0.35">${Array.from({ length: 14 }, (_, i) => { const a = (i / 14) * Math.PI * 2; return `<line x1="178" y1="130" x2="${f1(178 + Math.cos(a) * 60)}" y2="${f1(130 + Math.sin(a) * 60)}"/>`; }).join('')}</g>
        <path d="M250,330 Q236,250 252,200 Q268,170 300,160 L300,330 Z" fill="#6a3a2a"/><path d="M262,200 Q276,150 300,128 L300,200 Z" fill="#2a1810"/>
        ${limb([300, 300], [232, 196], 40, 30, 'url(#bb-sl)')}${limb([232, 196], [196, 156], 26, 20, 'url(#bb-sk)')}${hand([196, 156], angle([232, 196], [196, 156]), 20, sk[1], 'grip', -1)}
        ${limb([10, 330], [96, 236], 38, 30, 'url(#bb-sl)')}${limb([96, 236], [150, 178], 26, 20, 'url(#bb-sk)')}${hand([150, 178], angle([96, 236], [150, 178]), 20, sk[1], 'grip')}
        <rect x="88" y="226" width="20" height="16" rx="3" fill="#5a5a60" transform="rotate(-45 98 234)"/><rect x="224" y="186" width="20" height="16" rx="3" fill="#5a5a60" transform="rotate(45 234 194)"/>
        ${chain}${link(214, 150, 20)}${fly}
        <rect x="40" y="246" width="34" height="22" rx="3" fill="#2a2a2e" transform="rotate(-18 57 257)"/><rect x="44" y="250" width="26" height="12" fill="#8ab8e0" transform="rotate(-18 57 257)"/>${rect('url(#bb-v)')}`,
    }));
  }
  // Vatican Observers: a gray-haired Jesuit astronomer, hand raised, flashlight
  // in the other, by a glowing gold medallion of the heavens; a colleague in
  // profile at the edge. Warm interior.
  {
    const sk = skinTone.light, cloth = 'url(#vo-cl)';
    const head = bust({ id: 'voh', cx: 150, cy: 92, r: 25, skin: sk, hair: '#e4e2de', hairHi: '#ffffff', style: 'white', shirt: ['#fff', '#ddd'], noBody: true, eyes: '#3a4a5a', turn: 0.3 });
    const col = profile({ id: 'vo2', cx: 22, cy: 108, r: 30, dir: 1, skin: skinTone.tan, hair: '#2a1a10', style: 'bob', female: true });
    emit('col_vatican_observers', 'front', panel({
      defs: `${linear('vo-bg', [['0%', '#4a3a26'], ['50%', '#8a6a40'], ['100%', '#3a2a18']], 1, 0)}${linear('vo-cl', [['0%', '#3a3a40'], ['100%', '#121216']], 1, 1)}${radial('vo-med', [['0%', '#fff0b0'], ['55%', '#e8b040'], ['100%', '#8a5a10']], '40%', '35%')}${radial('vo-glow', [['0%', '#ffd070', 0.7], ['100%', '#ffd070', 0]])}${head.defs}${col.defs}${soft('vo-v')}`,
      inner: `${rect('url(#vo-bg)')}<rect x="118" y="0" width="34" height="${H}" fill="#c89a50" opacity="0.35"/><rect x="200" y="0" width="12" height="${H}" fill="#2a1e10" opacity="0.5"/>
        <circle cx="244" cy="196" r="70" fill="url(#vo-glow)"/>
        ${col.svg}<path d="M-10,330 L-6,180 Q10,150 40,156 L54,330 Z" fill="#1e1a18"/>
        ${torso({ shL: [112, 142], shR: [190, 140], hipL: [104, 330], hipR: [196, 330], cloth, neckline: `<rect x="136" y="128" width="30" height="12" rx="3" fill="#f2f2f2"/>` })}
        ${arm({ sh: [114, 152], el: [98, 236], wr: [128, 272], w: 22, cloth, skin: sk[1], pose: 'grip' })}
        <rect x="126" y="262" width="28" height="11" rx="4" fill="#9aa0a8" transform="rotate(20 140 268)"/><path d="M152,270 L210,300 L200,316 Z" fill="#fff6c8" opacity="0.35"/>
        ${arm({ sh: [188, 150], el: [212, 196], wr: [214, 132], w: 22, cloth, skin: sk[1], pose: 'open', flip: -1 })}
        <rect x="140" y="112" width="20" height="20" fill="${sk[1]}"/>${head.svg}
        <g transform="translate(250,214)"><circle r="38" fill="url(#vo-med)" stroke="#8a5a10" stroke-width="2"/><circle r="28" fill="none" stroke="#fff4c8" stroke-width="1.2" opacity="0.8"/>
        ${Array.from({ length: 12 }, (_, i) => `<path d="M0,-30 l3,-8 l-6,0 z" fill="#fff4c8" transform="rotate(${i * 30})"/>`).join('')}<text x="0" y="6" text-anchor="middle" font-family="serif" font-weight="700" font-size="16" fill="#7a4a10">IHS</text></g>${rect('url(#vo-v)')}`,
    }));
  }
  // Juiced Cosmonauts: a Soviet space poster. A red arm thrusts a hammer and
  // sickle to the stars; the cosmonaut's helmet below.
  {
    emit('col_juiced_cosmonauts', 'front', panel({
      defs: `${linear('jc-bg', [['0%', '#0e1a4a'], ['100%', '#1a2a6a']])}${linear('jc-arm', [['0%', '#ff6a3a'], ['100%', '#c81e10']], 1, 0)}${radial('jc-helm', [['0%', '#ffffff'], ['100%', '#a8b0c0']], '35%', '30%')}${linear('jc-visor', [['0%', '#ffd8a0'], ['100%', '#8a5a2a']])}`,
      inner: `${rect('url(#jc-bg)')}${stars(50, 62)}
        ${[[60, 30], [150, 50], [230, 20], [260, 80]].map(([x, y]) => `<path d="M${x},${y - 9} L${x + 3},${y - 3} L${x + 9},${y - 3} L${x + 4},${y + 1} L${x + 6},${y + 8} L${x},${y + 4} L${x - 6},${y + 8} L${x - 4},${y + 1} L${x - 9},${y - 3} L${x - 3},${y - 3} Z" fill="#ff3a2a"/>`).join('')}
        <path d="M30,330 Q60,200 110,120" stroke="#fff" stroke-width="3" fill="none" opacity="0.7" stroke-dasharray="2 6"/><circle cx="110" cy="118" r="4" fill="#fff"/>
        ${limb([214, 330], [196, 196], 46, 36, 'url(#jc-arm)')}${limb([196, 196], [168, 96], 36, 28, 'url(#jc-arm)')}
        <g transform="translate(164,82) rotate(-12)"><rect x="-16" y="-8" width="32" height="26" rx="12" fill="#e84a2a"/>
          <path d="M-36,-46 Q-6,-80 30,-56 Q8,-60 -10,-44 Z" fill="#ffd040"/><rect x="-6" y="-56" width="9" height="60" fill="#ffd040" transform="rotate(30 -2 -26)"/><rect x="-20" y="-60" width="26" height="12" fill="#ffd040" transform="rotate(30 -7 -54)"/></g>
        <g transform="translate(110,262)"><circle r="56" fill="url(#jc-helm)"/><ellipse cx="6" cy="10" rx="38" ry="32" fill="url(#jc-visor)"/>
          <path d="M-20,-10 Q-6,-26 20,-18" stroke="#fff" stroke-width="5" opacity="0.6" fill="none"/><text x="0" y="-34" text-anchor="middle" font-family="sans-serif" font-weight="800" font-size="15" fill="#d81e10">СССР</text></g>
        <rect x="0" y="292" width="${W}" height="38" fill="#d81e10"/><text x="150" y="320" text-anchor="middle" font-family="sans-serif" font-weight="900" font-size="26" fill="#ffd040" letter-spacing="4">СЛАВА!</text>`,
    }));
  }
  // Lloyd's Salvage Co.: a trader in a smart visor reads a deal hologram, his
  // partner at the edge. Bright office.
  {
    const sk = skinTone.light;
    const head = bust({ id: 'lsh', cx: 100, cy: 128, r: 32, skin: sk, hair: '#2a1a10', hairHi: '#4a3020', style: 'short', shirt: ['#fff', '#ddd'], noBody: true, eyes: '#3a2414', turn: 0.4, visor: ['#e8f8ff', '#7ac8e8'] });
    emit('col_lloyd_s_salvage_co', 'front', panel({
      defs: `${linear('ls-bg', [['0%', '#e8ecef'], ['100%', '#9aa4ae']], 1, 1)}${linear('ls-cl', [['0%', '#7a6a8a'], ['100%', '#3a2e4a']], 1, 1)}${linear('ls-holo', [['0%', '#7ae0ff', 0.8], ['100%', '#2a9ad0', 0.6]], 1, 1)}${head.defs}${soft('ls-v')}`,
      inner: `${rect('url(#ls-bg)')}<rect x="0" y="0" width="${W}" height="70" fill="#fff" opacity="0.5"/>
        <path d="M270,330 Q262,240 280,214 Q300,200 300,200 L300,330 Z" fill="#5a3a3a"/><circle cx="292" cy="182" r="22" fill="#b07a5a"/>
        ${torso({ shL: [40, 200], shR: [158, 200], hipL: [30, 330], hipR: [168, 330], cloth: 'url(#ls-cl)', neckline: `<path d="M82,192 Q100,214 118,192" fill="${sk[1]}"/>` })}
        <rect x="88" y="156" width="24" height="40" fill="${sk[1]}"/>${head.svg}
        ${arm({ sh: [154, 212], el: [190, 260], wr: [200, 218], w: 24, cloth: 'url(#ls-cl)', skin: sk[1], pose: 'point' })}
        <g transform="translate(222,150) rotate(-4)"><rect x="-50" y="-44" width="100" height="80" rx="10" fill="url(#ls-holo)" stroke="#dff8ff" stroke-width="2"/>
          <circle cx="-20" cy="-4" r="20" fill="#0e8ab8"/><text x="-20" y="4" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="22" fill="#fff">¥</text>
          <rect x="10" y="-18" width="28" height="24" rx="8" fill="#fff"/><circle cx="19" cy="-6" r="3" fill="#2a5a8a"/><circle cx="29" cy="-6" r="3" fill="#2a5a8a"/>
          <path d="M-30,-30 H-6 M-24,-36 L-30,-30 L-24,-24 M14,22 H38 M32,16 L38,22 L32,28" stroke="#fff" stroke-width="3" fill="none"/></g>${rect('url(#ls-v)')}`,
    }));
  }
  // House of Saud: a young prince levitating in meditation, palms up, eyes
  // closed, bathed in gold light.
  {
    const sk = skinTone.tan, cloth = 'url(#hs-robe)';
    const head = bust({ id: 'hsh', cx: 150, cy: 82, r: 26, skin: sk, hair: '#3a2410', hairHi: '#6a4420', style: 'short', shirt: ['#fff', '#ddd'], noBody: true, eyesClosed: true });
    emit('col_house_of_saud', 'front', panel({
      defs: `${radial('hs-bg', [['0%', '#fffbe8'], ['45%', '#e8dca0'], ['100%', '#8a7a3a']], '50%', '30%')}${linear('hs-robe', [['0%', '#d8cc80'], ['100%', '#7a6a2a']], 1, 1)}${radial('hs-aura', [['0%', '#fff', 0.9], ['100%', '#fff4c0', 0]])}${head.defs}`,
      inner: `${rect('url(#hs-bg)')}<g stroke="#fff" stroke-width="3" opacity="0.4">${Array.from({ length: 10 }, (_, i) => `<line x1="${60 + i * 20}" y1="0" x2="${100 + i * 12}" y2="${H}"/>`).join('')}</g>
        <ellipse cx="150" cy="150" rx="110" ry="130" fill="url(#hs-aura)"/>
        <path d="M44,262 Q60,226 112,228 L188,228 Q240,226 256,262 Q232,290 150,292 Q68,290 44,262 Z" fill="${cloth}"/>
        <path d="M70,262 Q110,248 150,262 Q190,248 230,262" stroke="#5a4a1a" stroke-width="2" fill="none" opacity="0.4"/>
        ${torso({ shL: [108, 124], shR: [192, 124], hipL: [112, 240], hipR: [188, 240], cloth, neckline: `<path d="M136,118 L150,152 L164,118" fill="${sk[1]}"/>` })}
        <g transform="translate(172,170) scale(0.6)" fill="#3a5a2a"><path d="M0,-18 Q4,-6 0,8 Q-4,-6 0,-18 Z"/><path d="M-14,10 Q0,4 14,10 L10,14 Q0,10 -10,14 Z"/><path d="M-10,0 L10,20 M10,0 L-10,20" stroke="#3a5a2a" stroke-width="3"/></g>
        ${arm({ sh: [112, 134], el: [86, 200], wr: [70, 244], w: 22, cloth, skin: sk[1], pose: 'open', hs: 16 })}
        ${arm({ sh: [188, 134], el: [214, 200], wr: [230, 244], w: 22, cloth, skin: sk[1], pose: 'open', flip: -1, hs: 16 })}
        <rect x="140" y="100" width="20" height="22" fill="${sk[1]}"/>${head.svg}
        <ellipse cx="150" cy="312" rx="80" ry="8" fill="#5a4a1a" opacity="0.25"/>`,
    }));
  }
  // Rock Rats Miners' Union: a young miner in a white work tee with a union
  // patch, grinning, her cobot partner leaning in behind.
  {
    const sk = skinTone.dark, cloth = 'url(#rr-tee)';
    const head = bust({ id: 'rrh', cx: 116, cy: 120, r: 28, skin: sk, hair: '#120a06', style: 'buzz', female: true, shirt: ['#fff', '#ddd'], noBody: true, smile: true, eyes: '#1a0e08', lips: '#6a2a2a', turn: 0.35, earring: '#f2f2f2' });
    const r = robotBust({ id: 'rrb', cx: 228, cy: 112, s: 0.82 });
    emit('col_rock_rats_miners_union', 'front', panel({
      defs: `${linear('rr-bg', [['0%', '#e4e8ec'], ['100%', '#9aa2ac']], 1, 1)}${linear('rr-tee', [['0%', '#ffffff'], ['100%', '#c4cad2']], 1, 1)}${head.defs}${r.defs}${soft('rr-v')}`,
      inner: `${rect('url(#rr-bg)')}<rect x="200" y="0" width="100" height="${H}" fill="#fff" opacity="0.35"/>${r.svg}
        ${torso({ shL: [72, 176], shR: [164, 180], hipL: [66, 330], hipR: [172, 330], cloth, neckline: `<path d="M98,170 Q116,190 134,172" fill="${sk[1]}"/>` })}
        ${arm({ sh: [76, 186], el: [52, 262], wr: [70, 318], w: 24, sleeve: 'short', cloth, skin: sk[1], pose: 'grip' })}
        <rect x="56" y="200" width="14" height="22" rx="3" fill="#2a3a4a" transform="rotate(12 63 211)"/><path d="M60,206 L66,214 M66,206 L60,214" stroke="#9fd8ff" stroke-width="2" transform="rotate(12 63 211)"/>
        <circle cx="132" cy="236" r="12" fill="#2a4a8a" stroke="#fff" stroke-width="2"/><text x="132" y="240" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="9" fill="#fff">RR</text>
        <rect x="104" y="140" width="24" height="36" fill="${sk[1]}"/>${head.svg}${rect('url(#rr-v)')}`,
    }));
  }
  // Siren Cybernautics Inc.: a hairless face filling the frame, eyes shut,
  // submerged in breathable liquid and a field of numerals.
  {
    const g = rng(66);
    const head = bust({ id: 'sch', cx: 150, cy: 170, r: 118, skin: ['#9fe8ff', '#1a6a9a'], hair: '#5ab0d0', style: 'bald', shirt: ['#fff', '#ddd'], noBody: true, eyesClosed: true, lips: '#2a7aa8', brow: '#3a8ab8' });
    let digits = ''; for (let r = 0; r < 12; r++) for (let c = 0; c < 10; c++) digits += `<text x="${10 + c * 30}" y="${20 + r * 28}" opacity="${(0.25 + g() * 0.6).toFixed(2)}">${Math.floor(g() * 10)}</text>`;
    emit('col_siren_cybernautics_inc', 'front', panel({
      defs: `${linear('sc-bg', [['0%', '#2a7ab8'], ['100%', '#06182e']])}${head.defs}`,
      inner: `${rect('url(#sc-bg)')}<g font-family="monospace" font-size="15" font-weight="700" fill="#dff4ff">${digits}</g>
        <g opacity="0.82">${head.svg}</g>
        ${Array.from({ length: 14 }, () => `<circle cx="${f1(40 + g() * 220)}" cy="${f1(20 + g() * 120)}" r="${f1(2 + g() * 4)}" fill="none" stroke="#e8fcff" stroke-width="1.2" opacity="0.7"/>`).join('')}`,
    }));
  }

  // ================================ M4 ================================
  // Cobots: a woman in a white suit with an earpiece, glancing down, her
  // service robot shoulder to shoulder with her.
  {
    const sk = skinTone.brown, cloth = 'url(#cb-suit)';
    const head = bust({ id: 'cbh', cx: 108, cy: 108, r: 28, skin: sk, hair: '#120a06', hairHi: '#3a2214', style: 'curly', female: true, shirt: ['#fff', '#ddd'], noBody: true, eyes: '#2a1408', lips: '#7a3a34', turn: 0.4, earring: '#e8f2fa' });
    const r = robotBust({ id: 'cbr', cx: 214, cy: 104, s: 1.0 });
    emit('col_cobots', 'front', panel({
      defs: `${linear('cb-bg', [['0%', '#e2e6ea'], ['100%', '#7a8490']], 1, 1)}${linear('cb-suit', [['0%', '#ffffff'], ['100%', '#b8c0ca']], 1, 1)}${head.defs}${r.defs}${soft('cb-v')}`,
      inner: `${rect('url(#cb-bg)')}<rect x="0" y="220" width="${W}" height="110" fill="#5a6470" opacity="0.4"/>${r.svg}
        ${torso({ shL: [60, 166], shR: [156, 170], hipL: [56, 330], hipR: [162, 330], cloth, neckline: `<path d="M92,160 Q108,178 124,160" fill="${sk[1]}"/><path d="M104,176 L104,330" stroke="#8a96a4" stroke-width="2"/>` })}
        ${arm({ sh: [154, 182], el: [182, 248], wr: [168, 300], w: 24, cloth, skin: sk[1], pose: 'grip', flip: -1 })}
        <circle cx="126" cy="214" r="9" fill="#5aa8e8"/><circle cx="126" cy="214" r="4" fill="#fff"/>
        <rect x="96" y="128" width="24" height="36" fill="${sk[1]}"/>${head.svg}${rect('url(#cb-v)')}`,
    }));
  }
  // Gabonese Mining Consortium: a boy in profile raising binoculars to the
  // skyline, his free hand shading the lenses.
  {
    const sk = skinTone.dark;
    const pr = profile({ id: 'gm', cx: 118, cy: 126, r: 44, dir: 1, skin: sk, hair: '#0a0604', style: 'buzz', eye: '#1a0e08' });
    emit('col_gabonese_mining_consortium', 'front', panel({
      defs: `${linear('gm-sky', [['0%', '#7ab4dc'], ['70%', '#d8e8f0'], ['100%', '#f0e8d8']])}${linear('gm-shirt', [['0%', '#fbf8f0'], ['100%', '#c8bea8']], 1, 1)}${pr.defs}${soft('gm-v')}`,
      inner: `${rect('url(#gm-sky)')}<g opacity="0.55" fill="#9ab0c4"><rect x="196" y="70" width="34" height="260"/><rect x="236" y="40" width="40" height="290"/><rect x="280" y="110" width="22" height="220"/></g>
        <g opacity="0.4" fill="#fff">${Array.from({ length: 24 }, (_, i) => `<rect x="${240 + (i % 4) * 9}" y="${54 + Math.floor(i / 4) * 20}" width="4" height="9"/>`).join('')}</g>
        <path d="M30,330 Q34,226 84,204 L150,202 Q190,222 196,330 Z" fill="url(#gm-shirt)"/>
        ${pr.svg}
        ${limb([150, 236], [196, 210], 26, 20, 'url(#gm-shirt)')}${limb([196, 210], [178, 126], 18, 14, `url(#gm-pk)`)}
        <g transform="translate(170,118) rotate(-4)"><rect x="-8" y="-14" width="40" height="18" rx="7" fill="#26282c"/><rect x="-8" y="2" width="40" height="18" rx="7" fill="#1e2024"/>
          <circle cx="32" cy="-5" r="7" fill="#3a6a9a" stroke="#4a4e56" stroke-width="2"/><circle cx="32" cy="11" r="7" fill="#3a6a9a" stroke="#4a4e56" stroke-width="2"/><circle cx="30" cy="-7" r="2" fill="#fff"/></g>
        ${hand([180, 128], -100, 14, sk[1], 'grip')}${rect('url(#gm-v)')}`,
    }));
  }
  // Teleoperators: an operator in a VR visor reaching out; across the room her
  // white robot mirrors the gesture, a red rose in its hand.
  {
    const sk = skinTone.brown, cloth = 'url(#to-cl)';
    const head = bust({ id: 'toh', cx: 86, cy: 116, r: 27, skin: sk, hair: '#120a06', style: 'buzz', female: true, shirt: ['#fff', '#ddd'], noBody: true, visor: ['#f2f8ff', '#8ab0d0'], lips: '#6a2a2a', turn: 0.4 });
    const r = robotBust({ id: 'tor', cx: 222, cy: 112, s: 0.9 });
    emit('col_teleoperators', 'front', panel({
      defs: `${linear('to-bg', [['0%', '#d8dde2'], ['100%', '#6a7480']], 1, 1)}${linear('to-cl', [['0%', '#3a3e46'], ['100%', '#121418']], 1, 1)}${head.defs}${r.defs}${soft('to-v')}`,
      inner: `${rect('url(#to-bg)')}<rect x="0" y="0" width="${W}" height="80" fill="#fff" opacity="0.35"/>${r.svg}
        ${limb([254, 200], [236, 166], 20, 16, 'url(#tor-shell)')}${limb([236, 166], [204, 152], 16, 13, 'url(#tor-arm)')}<circle cx="200" cy="150" r="9" fill="#d4dae2"/>
        <g transform="translate(192,140)"><path d="M0,0 L-6,30" stroke="#3a7a3a" stroke-width="3"/><path d="M-3,14 q-12,-4 -14,6 q10,2 14,-6" fill="#4a9a4a"/><circle cx="0" cy="-6" r="11" fill="#c8202e"/><path d="M-9,-8 Q0,-19 9,-8 Q4,0 0,-4 Q-4,0 -9,-8 Z" fill="#e8404a"/></g>
        ${torso({ shL: [40, 170], shR: [130, 174], hipL: [34, 330], hipR: [138, 330], cloth, neckline: `<path d="M70,164 Q86,180 102,166" fill="${sk[1]}"/>` })}
        ${arm({ sh: [126, 180], el: [156, 220], wr: [166, 176], w: 22, cloth, skin: sk[1], pose: 'open', flip: -1 })}
        <path d="M168,170 Q184,150 196,150" stroke="#9fd8ff" stroke-width="2" stroke-dasharray="4 4" fill="none"/>
        <rect x="74" y="136" width="24" height="32" fill="${sk[1]}"/>${head.svg}${rect('url(#to-v)')}`,
    }));
  }
  // Boston Hexapods: an engineer in profile, arm outstretched, sketching a gait
  // on a holo screen.
  {
    const sk = skinTone.pale;
    const pr = profile({ id: 'bh', cx: 206, cy: 108, r: 34, dir: -1, skin: sk, hair: '#e8e6e2', hairHi: '#ffffff', style: 'bob', female: true, eye: '#3a5a7a', brow: '#9a948c' });
    const legs = [0, 1, 2].map((i) => { const x = 46 + i * 34; return `<path d="M${x},146 L${x - 12},164 L${x - 16},186 M${x},146 L${x + 12},164 L${x + 16},186"/>`; }).join('');
    emit('col_boston_hexapods', 'front', panel({
      defs: `${linear('bh-bg', [['0%', '#e8eef2'], ['100%', '#8a9aa6']], 1, 1)}${linear('bh-coat', [['0%', '#ffffff'], ['100%', '#b4bec8']], 1, 1)}${linear('bh-scr', [['0%', '#4ad8ff', 0.5], ['100%', '#1a7aa8', 0.3]], 1, 1)}${pr.defs}${soft('bh-v')}`,
      inner: `${rect('url(#bh-bg)')}
        <g transform="skewY(-5)"><rect x="12" y="80" width="146" height="128" rx="6" fill="url(#bh-scr)" stroke="#2a8ab8" stroke-width="2"/>
          <g stroke="#0e5a8a" stroke-width="2.2" fill="none"><rect x="30" y="130" width="100" height="18" rx="7"/>${legs}<circle cx="140" cy="132" r="8"/></g>
          <g stroke="#0e5a8a" opacity="0.25">${Array.from({ length: 7 }, (_, i) => `<line x1="12" y1="${92 + i * 17}" x2="158" y2="${92 + i * 17}"/>`).join('')}</g></g>
        <path d="M150,330 Q154,214 190,186 L246,186 Q282,214 284,330 Z" fill="url(#bh-coat)"/><path d="M216,190 L206,330 M224,190 L236,330" stroke="#8a96a4" stroke-width="2"/>
        ${pr.svg}
        ${limb([196, 206], [150, 196], 24, 20, 'url(#bh-coat)')}${limb([150, 196], [112, 168], 18, 14, 'url(#bh-coat)')}<circle cx="112" cy="168" r="7" fill="${sk[1]}"/>
        ${hand([112, 168], angle([150, 196], [112, 168]), 15, sk[1], 'point', -1)}${rect('url(#bh-v)')}`,
    }));
  }
  // VR Simulcasters: a woman in a purple top turns to the life-size hologram of
  // the man she streams, her hand raised to his.
  {
    const sk = skinTone.brown;
    const head = bust({ id: 'vrh', cx: 96, cy: 118, r: 28, skin: sk, hair: '#140a06', hairHi: '#3a2214', style: 'curly', female: true, shirt: ['#fff', '#ddd'], noBody: true, eyes: '#2a1408', lips: '#7a3a3a', turn: 0.45 });
    const holo = bust({ id: 'vrg', cx: 212, cy: 112, r: 26, skin: ['#bff8ff', '#2ab0d0'], hair: '#5ad8f0', style: 'short', shirt: ['#fff', '#ddd'], noBody: true, eyes: '#ffffff', lips: '#5ad8f0', brow: '#e8fcff', turn: -0.4 });
    emit('col_vr_simulcasters', 'front', panel({
      defs: `${linear('vr-bg', [['0%', '#c8b890'], ['100%', '#4a3a28']], 1, 1)}${linear('vr-top', [['0%', '#a060c8'], ['100%', '#4a1a6a']], 1, 1)}${linear('vr-gh', [['0%', '#9ff8ff', 0.7], ['100%', '#1a8ab0', 0.4]])}${head.defs}${holo.defs}${soft('vr-v')}`,
      inner: `${rect('url(#vr-bg)')}<path d="M0,0 L80,0 L60,${H} L0,${H} Z" fill="#6a4a2a" opacity="0.35"/>
        <g opacity="0.85">${torso({ shL: [170, 160], shR: [254, 160], hipL: [174, 330], hipR: [250, 330], cloth: 'url(#vr-gh)' })}
          ${arm({ sh: [172, 170], el: [150, 214], wr: [160, 176], w: 20, cloth: 'url(#vr-gh)', skin: '#9ff8ff', pose: 'open' })}
          <rect x="202" y="128" width="20" height="32" fill="#7ae8ff"/>${holo.svg}</g>
        <g stroke="#e8fcff" opacity="0.22">${Array.from({ length: 30 }, (_, i) => `<line x1="140" y1="${70 + i * 9}" x2="290" y2="${70 + i * 9}"/>`).join('')}</g>
        <ellipse cx="212" cy="318" rx="56" ry="8" fill="#7ff0ff" opacity="0.6"/>
        ${torso({ shL: [46, 170], shR: [140, 172], hipL: [42, 330], hipR: [146, 330], cloth: 'url(#vr-top)', neckline: `<path d="M78,164 Q96,184 114,166" fill="${sk[1]}"/>` })}
        ${arm({ sh: [136, 180], el: [162, 230], wr: [150, 182], w: 22, sleeve: 'short', cloth: 'url(#vr-top)', skin: sk[1], pose: 'open', flip: -1 })}
        <rect x="84" y="138" width="24" height="32" fill="${sk[1]}"/>${head.svg}${rect('url(#vr-v)')}`,
    }));
  }
  // Exoskeletalists: a hiker mid-stride up a red canyon in a powered leg frame,
  // pack on, seen in profile.
  {
    const sk = skinTone.light, suit = 'url(#ex-suit)';
    const pr = profile({ id: 'ex', cx: 150, cy: 70, r: 20, dir: 1, skin: sk, hair: '#c8a060', style: 'short', eye: '#3a5a7a' });
    emit('col_exoskeletalists', 'front', panel({
      defs: `${linear('ex-sky', [['0%', '#f6d8b0'], ['100%', '#e8925a']])}${linear('ex-far', [['0%', '#d07848'], ['100%', '#9a4a28']])}${linear('ex-near', [['0%', '#a8502a'], ['100%', '#4a1a0a']])}${linear('ex-suit', [['0%', '#f2f4f6'], ['100%', '#a4acb6']], 1, 1)}${pr.defs}${soft('ex-v')}`,
      inner: `${rect('url(#ex-sky)')}<path d="M0,140 L40,96 L80,120 L80,${H} L0,${H} Z M220,110 L260,70 L300,96 L300,${H} L220,${H} Z" fill="url(#ex-far)"/>
        <path d="M0,286 L120,262 L300,226 L300,${H} L0,${H} Z" fill="url(#ex-near)"/>
        <rect x="104" y="94" width="34" height="64" rx="8" fill="#3a4a5e"/><rect x="108" y="88" width="26" height="12" rx="5" fill="#5a6a7e"/>
        ${limb([142, 164], [118, 212], 22, 18, suit)}${limb([118, 212], [104, 266], 18, 14, suit)}<path d="M96,266 L124,266" stroke="#1e2026" stroke-width="9" stroke-linecap="round"/>
        <path d="M134,168 L112,212 L100,264" stroke="#3a4250" stroke-width="5" fill="none" stroke-linejoin="round"/><circle cx="112" cy="212" r="7" fill="#ffb84a" stroke="#3a4250" stroke-width="2"/>
        ${torso({ shL: [132, 98], shR: [168, 100], hipL: [130, 172], hipR: [162, 172], cloth: suit })}
        ${limb([152, 166], [190, 210], 22, 18, suit)}${limb([190, 210], [188, 250], 18, 14, suit)}<path d="M182,252 L210,248" stroke="#1e2026" stroke-width="9" stroke-linecap="round"/>
        <path d="M158,170 L194,212 L192,248" stroke="#3a4250" stroke-width="5" fill="none" stroke-linejoin="round"/><circle cx="194" cy="212" r="7" fill="#ffb84a" stroke="#3a4250" stroke-width="2"/>
        ${arm({ sh: [160, 110], el: [176, 144], wr: [196, 158], w: 15, cloth: suit, skin: sk[1], pose: 'grip', hs: 11 })}
        <path d="M200,160 L220,262" stroke="#6a4a2a" stroke-width="4"/>
        ${pr.svg}${rect('url(#ex-v)')}`,
    }));
  }
}
