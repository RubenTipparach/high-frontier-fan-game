// Robonaut deck art: 12 cards x 2 faces. A robonaut is a prospecting robot,
// and its art shows it at work against an asteroid, by role:
//   raygun  - a beam fired from a ship strikes the rock and vaporises a spot
//   missile - the robonaut is itself a small craft under thrust, diving in
//   buggy   - a rover working the surface
// Each face is its own machine (the black back is a different robot). The
// asteroid takes the card's spectral-type colour. See docs/card-art-guide.md.
import { PATENTS_BY_ID } from '../../data/patents.js';
import { H, W, f, lin, rad, space, stars, svg, radiator, solarWing } from './kit.mjs';

// ---- colour + rock helpers --------------------------------------------------

// Spectral type -> rock palette [lit, mid, shadow].
const ROCK = {
  C: ['#6b625a', '#3c3631', '#1c1916'],
  S: ['#c9a273', '#8c6a45', '#45321f'],
  M: ['#b9bfc8', '#7c838e', '#3b4048'],
  V: ['#c27a4c', '#86492b', '#3f2212'],
  D: ['#7a4a3c', '#4a2a22', '#22120e'],
  B: ['#7d8fa8', '#4b5a70', '#222a36'],
};
function spectral(card, face) {
  const c = PATENTS_BY_ID[card];
  const t = (c.faces && c.faces[face] && c.faces[face].spectralType) || c.spectralType || 'C';
  return ROCK[t] || ROCK.C;
}
function seeded(seed) {
  let s = 17 + seed * 7919;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

// A floating asteroid: an irregular lit lump with craters.
function rock(cx, cy, r, pal, seed, id = 'rk') {
  const rnd = seeded(seed);
  const n = 16;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.82 + rnd() * 0.3);
    pts.push(`${f(cx + Math.cos(a) * rr)},${f(cy + Math.sin(a) * rr * 0.86)}`);
  }
  let craters = '';
  for (let i = 0; i < 7; i++) {
    const a = rnd() * Math.PI * 2, d = rnd() * r * 0.6, cr = r * (0.06 + rnd() * 0.12);
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.8;
    craters += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(cr)}" ry="${f(cr * 0.7)}" fill="${pal[2]}" opacity="0.55"/><path d="M${f(x - cr)},${f(y)} A${f(cr)},${f(cr * 0.7)} 0 0 0 ${f(x + cr)},${f(y)}" stroke="${pal[0]}" stroke-width="1.2" fill="none" opacity="0.6"/>`;
  }
  return `<defs>${rad(id, [[0, pal[0]], [0.55, pal[1]], [1, pal[2]]], '32%', '30%', '80%')}</defs>
    <polygon points="${pts.join(' ')}" fill="url(#${id})"/>${craters}`;
}

// The surface of a big asteroid filling the bottom of the frame.
function ground(pal, seed, y = 206, id = 'gr') {
  const rnd = seeded(seed);
  let craters = '', boulders = '';
  for (let i = 0; i < 9; i++) {
    const x = rnd() * W, yy = y + 18 + rnd() * (H - y - 22), cr = 6 + rnd() * 16;
    craters += `<ellipse cx="${f(x)}" cy="${f(yy)}" rx="${f(cr)}" ry="${f(cr * 0.32)}" fill="${pal[2]}" opacity="0.6"/><path d="M${f(x - cr)},${f(yy)} A${f(cr)},${f(cr * 0.32)} 0 0 0 ${f(x + cr)},${f(yy)}" stroke="${pal[0]}" stroke-width="1" fill="none" opacity="0.5"/>`;
  }
  for (let i = 0; i < 6; i++) {
    const x = rnd() * W, yy = y + 10 + rnd() * (H - y - 10), br = 2 + rnd() * 5;
    boulders += `<ellipse cx="${f(x)}" cy="${f(yy)}" rx="${f(br)}" ry="${f(br * 0.7)}" fill="${pal[1]}"/><ellipse cx="${f(x - br * 0.3)}" cy="${f(yy - br * 0.3)}" rx="${f(br * 0.4)}" ry="${f(br * 0.3)}" fill="${pal[0]}" opacity="0.7"/>`;
  }
  return `<defs>${lin(id, [[0, pal[0]], [0.35, pal[1]], [1, pal[2]]])}</defs>
    <path d="M-10,${y + 12} Q150,${y - 22} 310,${y + 8} L310,${H + 10} L-10,${H + 10} Z" fill="url(#${id})"/>${craters}${boulders}`;
}

// A glowing beam: a soft halo, a coloured shaft, a white-hot core.
function beam(x1, y1, x2, y2, color, w = 3) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${w * 5}" opacity="0.3" stroke-linecap="round" filter="url(#soft)"/>
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${w}" stroke-linecap="round" filter="url(#glow)"/>
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#ffffff" stroke-width="${f(w * 0.35)}" stroke-linecap="round"/>`;
}

// Where a beam lands: a hot spot, a vapour plume lifting off, sparks.
function impact(x, y, color, seed = 1) {
  const rnd = seeded(seed);
  let sparks = '';
  for (let i = 0; i < 14; i++) {
    const a = (-150 + rnd() * 120) * Math.PI / 180, d = 10 + rnd() * 34;
    sparks += `<circle cx="${f(x + Math.cos(a) * d)}" cy="${f(y + Math.sin(a) * d)}" r="${f(0.8 + rnd() * 1.6)}" fill="#ffe7b3" opacity="${f(0.9 - d / 50)}"/>`;
  }
  return `<ellipse cx="${x}" cy="${y - 10}" rx="16" ry="26" fill="${color}" opacity="0.28" filter="url(#soft)"/>
    <circle cx="${x}" cy="${y}" r="16" fill="${color}" opacity="0.6" filter="url(#soft)"/>
    <circle cx="${x}" cy="${y}" r="6" fill="#fff8e1" filter="url(#glow)"/>${sparks}`;
}

// ---- the 24 faces ----------------------------------------------------------

export const ART = {};
export const RIG = {};   // robonauts draw their own craft, no ship mount

// ---- machine parts ----------------------------------------------------------

// A horizontal cylinder from x to x+len, centred on y, radius r.
function hcyl(x, y, len, r, fill, cap = '#2b313c') {
  return `<rect x="${x}" y="${y - r}" width="${len}" height="${r * 2}" fill="${fill}"/>
    <ellipse cx="${x + len}" cy="${y}" rx="${f(r * 0.32)}" ry="${r}" fill="${cap}"/>`;
}
// Ribs around a horizontal cylinder (accelerator cavities, coil turns).
function ribs(x, y, len, r, n, color, w = 2) {
  let out = '';
  for (let i = 0; i <= n; i++) {
    const xx = f(x + (len * i) / n);
    out += `<path d="M${xx},${y - r} A${f(r * 0.32)},${r} 0 0 1 ${xx},${y + r}" stroke="${color}" stroke-width="${w}" fill="none"/>`;
  }
  return out;
}
// A row of permanent-magnet blocks alternating north (red) / south (blue).
function magnetRow(x, y, len, n, h) {
  const w = len / n;
  let out = '';
  for (let i = 0; i < n; i++) out += `<rect x="${f(x + i * w + 0.6)}" y="${y}" width="${f(w - 1.2)}" height="${h}" fill="${i % 2 ? '#2563eb' : '#dc2626'}" stroke="#0f172a" stroke-width="0.6"/>`;
  return out;
}
// A radiator panel with fins.
function finPanel(x, y, w, h, n = 7) {
  let fins = '';
  for (let i = 1; i < n; i++) fins += `<line x1="${f(x + (w * i) / n)}" y1="${y}" x2="${f(x + (w * i) / n)}" y2="${y + h}" stroke="#56627a" stroke-width="1"/>`;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#262c38" stroke="#6b7487" stroke-width="1"/>${fins}`;
}
// An infrared beam: invisible to the eye, so a pale dashed core in a faint glow.
function irBeam(x1, y1, x2, y2, color) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="10" opacity="0.18" filter="url(#soft)"/>
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2" stroke-dasharray="7 5" opacity="0.9"/>`;
}
// A particle beam: a stream of dots, not a light shaft.
function particleBeam(x1, y1, x2, y2, color, seed) {
  const rnd = seeded(seed);
  let out = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="8" opacity="0.15" filter="url(#soft)"/>`;
  for (let i = 0; i < 46; i++) {
    const t = rnd(), j = (rnd() - 0.5) * 6;
    out += `<circle cx="${f(x1 + (x2 - x1) * t + j)}" cy="${f(y1 + (y2 - y1) * t + j)}" r="${f(0.8 + rnd())}" fill="${color}" opacity="${f(0.5 + rnd() * 0.5)}"/>`;
  }
  return out;
}
// Sputtering: surface atoms knocked out in a spray, no melt plume.
function sputter(x, y, color, seed) {
  const rnd = seeded(seed);
  let out = `<circle cx="${x}" cy="${y}" r="9" fill="${color}" opacity="0.45" filter="url(#soft)"/>`;
  for (let i = 0; i < 26; i++) {
    const a = (-175 + rnd() * 150) * Math.PI / 180, d = 6 + rnd() * 30;
    out += `<line x1="${f(x + Math.cos(a) * d * 0.4)}" y1="${f(y + Math.sin(a) * d * 0.4)}" x2="${f(x + Math.cos(a) * d)}" y2="${f(y + Math.sin(a) * d)}" stroke="#e0e7ff" stroke-width="1" opacity="0.7"/>`;
  }
  return out;
}
// A beam director: a 45-degree turning mirror in a housing at the end of a beam
// line, so a horizontal laser can be sent down onto the rock.
function director(x, y) {
  return `<rect x="${x - 7}" y="${y - 9}" width="14" height="18" rx="2" fill="#334155" stroke="#94a3b8" stroke-width="1.2"/><line x1="${x - 5}" y1="${y - 6}" x2="${x + 5}" y2="${y + 6}" stroke="#e2e8f0" stroke-width="3"/>`;
}
// The target asteroid for a raygun scene, low on the right, and where a beam hits it.
const RT = [266, 262], RR = 56;
const RHIT = [f(RT[0] - RR * 0.62), f(RT[1] - RR * 0.5)];
function rayTarget(card, face, seed) { return rock(RT[0], RT[1], RR, spectral(card, face), seed); }
function sunGlow(x, y, r = 80) {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="#fde68a" opacity="0.22" filter="url(#soft)"/><circle cx="${x}" cy="${y}" r="${f(r * 0.35)}" fill="#fff7d6" opacity="0.55" filter="url(#soft)"/>`;
}

// ---- rayguns: each a different beam source, fired from orbit -----------------
// (HF4 rules note: a raygun fires an energy beam at the surface from orbit and
// reads the vapour's spectrum, e.g. the 3 micron water signature.)

// Blackbody-Pumped Laser: a mirror focuses sunlight on an insulated oven; the
// oven's heat glow pumps a CO2 laser tube; infrared beam; a radiator dumps heat.
ART['rob_blackbody_pumped_laser:primary'] = () => {
  const b = space('#24140f', '#060303', '15%', '55%');
  const rays = [118, 150, 182, 214, 238].map((y) => `<line x1="0" y1="${y - 30}" x2="34" y2="${y}" stroke="#fde68a" stroke-width="1.2" opacity="0.45"/><line x1="40" y1="${y}" x2="96" y2="182" stroke="#fde68a" stroke-width="1" opacity="0.4"/>`).join('');
  return svg(b.defs + lin('mir', [[0, '#fef3c7'], [0.5, '#d6d3d1'], [1, '#78716c']], 0, 0, 1, 0)
    + rad('oven', [[0, '#fff7d6'], [0.35, '#fb923c'], [0.8, '#b91c1c'], [1, '#450a0a']]),
  `${b.body}${stars(40, 31)}${sunGlow(-20, 120)}${rayTarget('rob_blackbody_pumped_laser', 'primary', 31)}
    ${rays}
    <path d="M30,104 Q86,182 30,262 L20,262 Q74,182 20,104 Z" fill="url(#mir)" stroke="#57534e" stroke-width="1"/>
    <line x1="46" y1="182" x2="80" y2="182" stroke="#78716c" stroke-width="3"/>
    ${finPanel(118, 214, 96, 22)}
    <path d="M110,182 Q122,182 124,196" stroke="#a8a29e" stroke-width="4" fill="none"/>
    <path d="M104,196 Q116,214 132,204" stroke="#a8a29e" stroke-width="4" fill="none"/>
    <circle cx="96" cy="182" r="21" fill="#44403c" stroke="#a8a29e" stroke-width="2"/>
    <circle cx="96" cy="182" r="15" fill="url(#oven)" filter="url(#glow)"/>
    ${hcyl(124, 198, 104, 9, '#4b3a3a', '#1c1917')}
    <rect x="126" y="193" width="100" height="10" fill="#fca5a5" opacity="0.35"/>
    <rect x="120" y="186" width="5" height="24" fill="#d6d3d1"/><rect x="229" y="188" width="4" height="20" fill="#93c5fd" opacity="0.8"/>
    ${director(240, 198)}${irBeam(240, 207, ...RHIT, '#fecaca')}${impact(...RHIT, '#fb923c', 31)}`);
};

// Fissile Aerosol Laser: a squat reactor drum circulates uranium aerosol whose
// fission glow pumps long laser tubes; the crew rides a long boom away from it.
ART['rob_blackbody_pumped_laser:secondary'] = () => {
  const b = space('#10200f', '#030603', '25%', '60%');
  const rnd = seeded(32);
  let aerosol = '';
  for (let i = 0; i < 26; i++) aerosol += `<circle cx="${f(70 + rnd() * 20)}" cy="${f(186 + rnd() * 34)}" r="${f(0.8 + rnd() * 1.4)}" fill="#ecfccb" opacity="${f(0.5 + rnd() * 0.5)}"/>`;
  // control drums ringing the vessel: dark absorber stripe on a light reflector
  const drum = (x, front) => `<rect x="${x - 6}" y="168" width="12" height="62" rx="6" fill="url(#cdrum)" stroke="#4b5563" stroke-width="1" opacity="${front ? 1 : 0.8}"/><rect x="${x - 2}" y="170" width="4" height="58" fill="#1f2937" opacity="0.7"/>`;
  return svg(b.defs + lin('pv', [[0, '#5b6354'], [0.4, '#d4dccf'], [1, '#3a4136']], 0, 0, 1, 0)
    + lin('cdrum', [[0, '#9ca3af'], [0.5, '#f3f4f6'], [1, '#6b7280']], 0, 0, 1, 0)
    + rad('core', [[0, '#f7fee7'], [0.45, '#a3e635'], [1, '#365314']]),
  `${b.body}${stars(40, 32)}${rayTarget('rob_blackbody_pumped_laser', 'secondary', 32)}
    <path d="M44,150 L8,112" stroke="#6b7487" stroke-width="3"/><path d="M38,156 L2,120" stroke="#6b7487" stroke-width="2"/>
    ${[0, 1, 2, 3].map((i) => `<line x1="${f(40 - i * 10)}" y1="${f(152 - i * 10)}" x2="${f(34 - i * 10)}" y2="${f(146 - i * 10)}" stroke="#6b7487" stroke-width="1.5"/>`).join('')}
    <rect x="-2" y="100" width="22" height="16" rx="3" fill="#cbd5e1"/><rect x="3" y="104" width="5" height="4" fill="#fde68a"/>
    <path d="M38,144 L62,136 L66,152 L46,160 Z" fill="#475569" stroke="#94a3b8" stroke-width="1"/>
    ${finPanel(2, 226, 44, 50)}
    ${drum(52, false)}${drum(108, false)}
    <rect x="54" y="150" width="52" height="98" rx="26" fill="url(#pv)" stroke="#2f362c" stroke-width="1.5"/>
    <path d="M58,176 L102,176 M58,224 L102,224" stroke="#4b5a46" stroke-width="2"/>
    <rect x="66" y="184" width="28" height="38" rx="10" fill="url(#core)" stroke="#d9f99d" stroke-width="1.5" filter="url(#glow)"/>
    ${aerosol}
    ${drum(64, true)}${drum(96, true)}
    <path d="M80,150 Q80,128 104,128 Q132,128 132,150 L132,181" stroke="#bef264" stroke-width="5" fill="none" opacity="0.35" filter="url(#glow)"/>
    <path d="M80,150 Q80,128 104,128 Q132,128 132,150 L132,181" stroke="#84cc16" stroke-width="2.5" fill="none"/>
    <path d="M80,248 Q80,262 106,262 Q132,262 132,209" stroke="#65a30d" stroke-width="2.5" fill="none"/>
    ${hcyl(112, 188, 112, 5, '#3f4a3a')}${hcyl(112, 202, 112, 5, '#3f4a3a')}
    <rect x="114" y="185" width="108" height="6" fill="#d9f99d" opacity="0.5"/><rect x="114" y="199" width="108" height="6" fill="#d9f99d" opacity="0.5"/>
    <rect x="226" y="182" width="5" height="26" fill="#93c5fd" opacity="0.85"/>
    ${director(238, 195)}${beam(238, 204, ...RHIT, '#fbbf24', 2.5)}${impact(...RHIT, '#fbbf24', 32)}`);
};

// Free Electron Laser: a very long straight machine - electron gun, ribbed
// copper linac, bending magnet, the undulator's striped red/blue magnet rows,
// mirrors at each end. An astronaut on the truss shows the scale.
ART['rob_free_electron_laser:primary'] = () => {
  const b = space('#0b1a2c', '#02050a', '40%', '60%');
  const y = 200;
  return svg(b.defs + lin('cu', [[0, '#fdba74'], [0.5, '#c2621f'], [1, '#7c2d12']]),
  `${b.body}${stars(45, 33)}${rayTarget('rob_free_electron_laser', 'primary', 33)}
    <path d="M2,${y + 22} L236,${y + 22} M2,${y + 32} L236,${y + 32}" stroke="#6b7487" stroke-width="2"/>
    ${[...Array(24)].map((_, i) => `<line x1="${2 + i * 9.75}" y1="${y + (i % 2 ? 22 : 32)}" x2="${11.75 + i * 9.75}" y2="${y + (i % 2 ? 32 : 22)}" stroke="#6b7487" stroke-width="1.2"/>`).join('')}
    <rect x="2" y="${y - 16}" width="22" height="32" rx="3" fill="#64748b" stroke="#94a3b8" stroke-width="1.5"/>
    ${hcyl(24, y, 60, 10, 'url(#cu)', '#7c2d12')}${ribs(24, y, 60, 10, 10, '#7c2d12', 1.6)}
    <path d="M86,${y - 16} L102,${y - 16} L102,${y + 16} L86,${y + 16} L86,${y + 6} L96,${y + 6} L96,${y - 6} L86,${y - 6} Z" fill="#1d4ed8" stroke="#93c5fd" stroke-width="1"/>
    <line x1="102" y1="${y}" x2="214" y2="${y}" stroke="#cbd5e1" stroke-width="3"/>
    ${magnetRow(108, y - 14, 100, 16, 10)}${magnetRow(108, y + 4, 100, 16, 10)}
    <rect x="103" y="${y - 18}" width="4" height="36" fill="#e2e8f0"/><rect x="209" y="${y - 18}" width="4" height="36" fill="#e2e8f0"/>
    <path d="M214,${y - 12} L228,${y - 12} L228,${y + 12} L214,${y + 12} Z" fill="#1d4ed8" stroke="#93c5fd" stroke-width="1"/>
    <path d="M221,${y + 12} L221,${y + 22}" stroke="#94a3b8" stroke-width="3"/>
    <rect x="228" y="${y - 6}" width="8" height="12" fill="#93c5fd" opacity="0.85"/>
    <line x1="104" y1="${y}" x2="212" y2="${y}" stroke="#5eead4" stroke-width="2" opacity="0.7" filter="url(#glow)"/>
    <g transform="translate(150 ${y - 20})" fill="#f1f5f9"><circle cx="0" cy="-9" r="2.6"/><rect x="-2.4" y="-6.5" width="4.8" height="7" rx="1.5"/><path d="M-2,0.5 L-3,6 M2,0.5 L3,6" stroke="#f1f5f9" stroke-width="1.6"/></g>
    ${director(243, y)}${beam(243, y + 9, ...RHIT, '#5eead4', 3)}${impact(...RHIT, '#5eead4', 33)}`);
};

// Neutral Beam: an ion source, a squat copper RFQ accelerator fed by RF power
// boxes, steering magnets and a gas neutraliser cell - an artillery barrel. Its
// beam is a faint stream of atoms that sputters the surface, not a laser.
ART['rob_neutral_beam:primary'] = () => {
  const b = space('#0f1530', '#03040a', '30%', '60%');
  return svg(b.defs + lin('cu2', [[0, '#fdba74'], [0.45, '#b45309'], [1, '#78350f']]),
  `${b.body}${stars(45, 34)}${rayTarget('rob_neutral_beam', 'primary', 34)}
    ${particleBeam(212, 212, ...RHIT, '#c4b5fd', 34)}${sputter(...RHIT, '#a78bfa', 34)}
    <g transform="rotate(14 110 196)">
      <rect x="8" y="176" width="34" height="40" rx="4" fill="#475569" stroke="#94a3b8" stroke-width="1.5"/>
      <path d="M14,176 Q8,150 30,140" stroke="#f59e0b" stroke-width="2" fill="none"/>
      ${hcyl(42, 196, 90, 16, 'url(#cu2)', '#78350f')}${ribs(42, 196, 90, 16, 6, '#78350f', 2.4)}
      ${[54, 80, 106].map((x) => `<rect x="${x}" y="154" width="18" height="14" rx="2" fill="#334155" stroke="#94a3b8" stroke-width="1"/><path d="M${x + 9},168 L${x + 9},180" stroke="#f59e0b" stroke-width="2"/>`).join('')}
      ${[136, 146, 156].map((x) => `<ellipse cx="${x}" cy="196" rx="5" ry="16" fill="none" stroke="#e3954f" stroke-width="4"/>`).join('')}
      ${hcyl(162, 196, 30, 10, '#64748b')}
      <circle cx="176" cy="176" r="7" fill="#cbd5e1" stroke="#64748b"/><path d="M176,183 L176,186" stroke="#94a3b8" stroke-width="2"/>
      <path d="M192,188 L206,182 L206,210 L192,204 Z" fill="#94a3b8"/>
    </g>`);
};

// Phase-Locked Diode Laser: a flat tiled panel of many small emitters held in
// phase, a solar array on its back - the whole face fires one broad beam that
// narrows to a point. No tube, no barrel.
ART['rob_phase_locked_diode_laser:primary'] = () => {
  const b = space('#1a1030', '#040208', '20%', '60%');
  const P = [[18, 142], [126, 122], [146, 246], [38, 270]];
  const at = (u, v) => [f(P[0][0] + (P[1][0] - P[0][0]) * u + (P[3][0] - P[0][0]) * v + (P[2][0] - P[1][0] - P[3][0] + P[0][0]) * u * v),
    f(P[0][1] + (P[1][1] - P[0][1]) * u + (P[3][1] - P[0][1]) * v + (P[2][1] - P[1][1] - P[3][1] + P[0][1]) * u * v)];
  let em = '';
  for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) {
    const [x, y] = at((i + 0.5) / 9, (j + 0.5) / 9);
    em += `<circle cx="${x}" cy="${y}" r="4.2" fill="#2e1065" stroke="#c4b5fd" stroke-width="0.8"/><circle cx="${x}" cy="${y}" r="1.8" fill="#f5d0fe"/>`;
  }
  const quad = P.map((q) => q.join(',')).join(' ');
  return svg(b.defs + lin('col', [[0, '#f0abfc', 0.35], [1, '#ffffff', 0.9]], 0, 0, 1, 0),
  `${b.body}${stars(45, 35)}${rayTarget('rob_phase_locked_diode_laser', 'primary', 35)}
    <polygon points="${[[10, 134], [118, 114], [138, 238], [30, 262]].map((q) => q.join(',')).join(' ')}" fill="#1e3a8a" stroke="#60a5fa" stroke-width="1"/>
    ${finPanel(40, 272, 90, 12)}
    <polygon points="${at(0.1, 0.1).join(',')} ${at(0.9, 0.1).join(',')} ${at(0.9, 0.9).join(',')} ${at(0.1, 0.9).join(',')}" fill="none"/>
    <path d="M${at(0.95, 0.05).join(',')} L${RHIT[0]},${RHIT[1]} L${at(0.95, 0.95).join(',')} Z" fill="url(#col)" opacity="0.55" filter="url(#glow)"/>
    <polygon points="${quad}" fill="#3b2a52" stroke="#a78bfa" stroke-width="2"/>
    ${em}
    ${impact(...RHIT, '#e879f9', 35)}`);
};

// Lorentz-Propelled Microprobe: a carrier releases a cloud of chip-sized
// spacecraft (green circuit boards, gold solar cells, stub antennas) that charge
// themselves and ride the magnetic field lines down onto the rock.
ART['rob_phase_locked_diode_laser:secondary'] = () => {
  const b = space('#0a1a2a', '#02050a', '20%', '60%');
  const lines = [0, 1, 2, 3, 4].map((k) => `<path d="M-10,${150 + k * 16} C90,${110 + k * 22} 170,${150 + k * 22} ${RHIT[0] + 10 + k * 6},${RHIT[1] - 12 + k * 10}" stroke="#60a5fa" stroke-width="1.2" fill="none" opacity="0.5" stroke-dasharray="5 4"/>`).join('');
  const pt = (k, t) => {
    const x0 = -10, y0 = 150 + k * 16, x1 = 90, y1 = 110 + k * 22, x2 = 170, y2 = 150 + k * 22, x3 = RHIT[0] + 10 + k * 6, y3 = RHIT[1] - 12 + k * 10;
    const m = 1 - t;
    return [m * m * m * x0 + 3 * m * m * t * x1 + 3 * m * t * t * x2 + t * t * t * x3, m * m * m * y0 + 3 * m * m * t * y1 + 3 * m * t * t * y2 + t * t * t * y3];
  };
  let chips = '';
  const rnd = seeded(36);
  for (let i = 0; i < 16; i++) {
    const k = i % 5, t = 0.22 + rnd() * 0.72, [x, y] = pt(k, t), r = rnd() * 40 - 20;
    chips += `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(r)})"><circle r="8" fill="#38bdf8" opacity="0.18"/><rect x="-5" y="-5" width="10" height="10" fill="#15803d" stroke="#86efac" stroke-width="0.6"/><rect x="-3" y="-3" width="6" height="6" fill="#1e3a8a" stroke="#facc15" stroke-width="0.8"/><line x1="5" y1="-5" x2="9" y2="-9" stroke="#e2e8f0" stroke-width="0.8"/></g>`;
  }
  return svg(b.defs, `${b.body}${stars(45, 36)}${rayTarget('rob_phase_locked_diode_laser', 'secondary', 36)}${lines}
    <g transform="translate(34 180) rotate(-14)"><rect x="-26" y="-14" width="52" height="28" rx="5" fill="#cbd5e1" stroke="#64748b" stroke-width="1.5"/><rect x="18" y="-12" width="10" height="24" fill="#0f172a"/>${solarWingLite(-26, -30, -52)}</g>
    ${chips}${impact(...RHIT, '#93c5fd', 36)}`);
};
function solarWingLite(x, y, w) {
  return `<rect x="${Math.min(x, x + w)}" y="${y}" width="${Math.abs(w)}" height="10" fill="#1e3a8a" stroke="#60a5fa" stroke-width="0.8"/>`;
}

// Solar-Pumped MHD Exciplex Laser: a concentrator heats an alkali plasma that
// flows through a magnetohydrodynamic duct between two big electromagnets; the
// laser section across the duct throws a violet UV beam; a radiator loop
// condenses the working fluid and pumps it back round.
ART['rob_solar_pumped_mhd_exciplex_laser:primary'] = () => {
  const b = space('#1c1436', '#05030a', '15%', '45%');
  return svg(b.defs + lin('mir2', [[0, '#fef3c7'], [1, '#a8a29e']], 0, 0, 1, 0) + lin('duct', [[0, '#4c1d95'], [0.5, '#e9d5ff'], [1, '#4c1d95']]),
  `${b.body}${stars(40, 37)}${sunGlow(-30, 110, 70)}${rayTarget('rob_solar_pumped_mhd_exciplex_laser', 'primary', 37)}
    <path d="M6,128 Q44,170 10,214 L2,212 Q34,170 0,132 Z" fill="url(#mir2)"/>
    ${[136, 158, 182, 204].map((y) => `<line x1="14" y1="${y}" x2="52" y2="190" stroke="#fde68a" stroke-width="1" opacity="0.45"/>`).join('')}
    <rect x="50" y="178" width="24" height="24" rx="3" fill="#fb923c" filter="url(#glow)"/><rect x="54" y="182" width="16" height="16" fill="#fff7d6" opacity="0.7"/>
    <rect x="74" y="184" width="118" height="14" fill="url(#duct)" opacity="0.95"/>
    <rect x="74" y="184" width="118" height="14" fill="none" stroke="#a78bfa" stroke-width="1"/>
    ${[96, 140].map((x) => `<rect x="${x}" y="158" width="34" height="24" rx="3" fill="#334155" stroke="#94a3b8" stroke-width="1"/><rect x="${x}" y="200" width="34" height="24" rx="3" fill="#334155" stroke="#94a3b8" stroke-width="1"/>${[0, 1, 2, 3].map((i) => `<rect x="${x + 4 + i * 7}" y="160" width="5" height="20" fill="#c2621f"/><rect x="${x + 4 + i * 7}" y="202" width="5" height="20" fill="#c2621f"/>`).join('')}`).join('')}
    <rect x="176" y="172" width="4" height="38" fill="#e2e8f0"/><rect x="196" y="186" width="5" height="10" fill="#c4b5fd"/>
    <path d="M192,191 L208,191 L208,246 L40,246 L40,206 L50,200" stroke="#64748b" stroke-width="5" fill="none"/>
    ${finPanel(70, 238, 110, 16)}
    <circle cx="40" cy="226" r="8" fill="#475569" stroke="#94a3b8" stroke-width="1.5"/>
    ${beam(201, 191, ...RHIT, '#a78bfa', 3)}${impact(...RHIT, '#c4b5fd', 37)}`);
};

// Quantum Cascade Laser: a small sensor craft. Its laser is a fingernail chip:
// the inset shows the gold chip on its copper mount and the stack of layers the
// electrons cascade down, a photon at each step. It reads the rock with a thin
// infrared probe rather than melting it.
ART['rob_solar_pumped_mhd_exciplex_laser:secondary'] = () => {
  const b = space('#220f0f', '#060203', '25%', '55%');
  let stairs = '', photons = '';
  for (let i = 0; i < 7; i++) {
    stairs += `<rect x="${-30 + i * 8}" y="${-20 + i * 6}" width="${60 - i * 8}" height="3" fill="${i % 2 ? '#fbbf24' : '#94a3b8'}"/>`;
    photons += `<path d="M${-22 + i * 8},${-16 + i * 6} q3,-4 6,0 q3,4 6,0" stroke="#fca5a5" stroke-width="1.2" fill="none"/>`;
  }
  return svg(b.defs, `${b.body}${stars(45, 38)}${rayTarget('rob_solar_pumped_mhd_exciplex_laser', 'secondary', 38)}
    ${irBeam(84, 166, ...RHIT, '#fca5a5')}
    <circle cx="${RHIT[0]}" cy="${RHIT[1]}" r="4" fill="#fecaca" filter="url(#glow)"/>
    <g transform="translate(52 166)"><rect x="-18" y="-14" width="36" height="28" rx="3" fill="#c8a86b" stroke="#8a6d38" stroke-width="1.5"/>
      <rect x="-60" y="-6" width="40" height="12" fill="#1e3a8a" stroke="#60a5fa" stroke-width="0.8"/>
      ${hcyl(18, 0, 16, 7, '#475569')}<circle cx="34" cy="0" r="3" fill="#fecaca"/></g>
    <circle cx="104" cy="236" r="40" fill="#160a0a" stroke="#fca5a5" stroke-width="1.5"/>
    <line x1="62" y1="178" x2="80" y2="204" stroke="#fca5a5" stroke-width="1" stroke-dasharray="3 3"/>
    <g transform="translate(104 236)"><rect x="-34" y="10" width="68" height="16" fill="#b45309"/><rect x="-32" y="-24" width="64" height="36" fill="#3a2a10"/>${stairs}${photons}</g>`);
};

// ---- missiles: the robonaut is itself a small craft ----------------------
// (HF4 rules note: missile robonauts assay metals and silicates by melting
// them with thruster plasmas.) On a missile card the thrust triangle covers the
// top-centre and the supports panel the lower middle, so each scene keeps its
// machine in the open left column and upper corners; the triangle and panel
// are translucent, so what passes behind them still shows.
const MROCK = [232, 112], MRR = 50;
function mRock(card, face, seed) { return rock(MROCK[0], MROCK[1], MRR, spectral(card, face), seed); }
// A string of fusion pulses ("pearls") from (x1,y1) toward (x2,y2).
function pearls(x1, y1, x2, y2, n, color, r0) {
  let out = '';
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), r = r0 * (1 - t * 0.6);
    out += `<circle cx="${f(x1 + (x2 - x1) * t)}" cy="${f(y1 + (y2 - y1) * t)}" r="${f(r * 1.9)}" fill="${color}" opacity="${f(0.25 * (1 - t))}" filter="url(#soft)"/><circle cx="${f(x1 + (x2 - x1) * t)}" cy="${f(y1 + (y2 - y1) * t)}" r="${f(r)}" fill="#fffbeb" opacity="${f(1 - t * 0.6)}" filter="url(#glow)"/>`;
  }
  return out;
}
// A barrel wrapped in a copper helix, from x to x+len on y.
function helixTube(x, y, len, r, turns) {
  let d = '';
  for (let i = 0; i <= turns * 12; i++) {
    const t = i / (turns * 12), a = t * turns * Math.PI * 2;
    d += `${d ? 'L' : 'M'}${f(x + len * t + Math.sin(a) * r * 0.25)},${f(y + Math.cos(a) * r)}`;
  }
  return `<rect x="${x}" y="${y - r}" width="${len}" height="${r * 2}" fill="#334155"/><path d="${d}" stroke="#e3954f" stroke-width="2.4" fill="none"/>`;
}
const TREFOIL = (x, y, r = 7) => `<g transform="translate(${x} ${y})"><circle r="${r}" fill="#facc15"/>${[0, 120, 240].map((a) => `<path d="M0,0 L${f(r * 0.9 * Math.sin((a - 30) * Math.PI / 180))},${f(-r * 0.9 * Math.cos((a - 30) * Math.PI / 180))} A${f(r * 0.9)},${f(r * 0.9)} 0 0 1 ${f(r * 0.9 * Math.sin((a + 30) * Math.PI / 180))},${f(-r * 0.9 * Math.cos((a + 30) * Math.PI / 180))} Z" fill="#111827"/>`).join('')}<circle r="${f(r * 0.22)}" fill="#facc15"/></g>`;

// H-B Cat Inertial: proton-boron pulse fusion - compact and clean (it makes no
// neutrons, so only a thin shield). One superconducting hoop at the stern,
// driver beam lines converging inside it, and a tight gold "string of pearls"
// as it brakes tail-first toward the rock.
ART['rob_cat_fusion_z_pinch_torch:secondary'] = () => {
  const b = space('#1c1230', '#04020a', '25%', '35%');
  return svg(b.defs, `${b.body}${stars(45, 41)}${mRock('rob_cat_fusion_z_pinch_torch', 'secondary', 41)}
    ${pearls(96, 96, 200, 108, 6, '#fbbf24', 7)}
    <g transform="rotate(6 60 90)">
      <rect x="4" y="80" width="30" height="22" rx="4" fill="#cbd5e1" stroke="#64748b" stroke-width="1.5"/><rect x="8" y="84" width="6" height="4" fill="#fde68a"/>
      <rect x="34" y="88" width="34" height="6" fill="#64748b"/>
      <path d="M66,80 L72,80 L72,102 L66,102 Z" fill="#94a3b8"/>
      <line x1="68" y1="91" x2="92" y2="91" stroke="#cbd5e1" stroke-width="3"/>
      <path d="M70,82 L94,91 M70,100 L94,91" stroke="#f472b6" stroke-width="1.2" opacity="0.9"/>
      <ellipse cx="94" cy="91" rx="9" ry="26" fill="none" stroke="#fde68a" stroke-width="5" opacity="0.4" filter="url(#glow)"/>
      <ellipse cx="94" cy="91" rx="9" ry="26" fill="none" stroke="#e2e8f0" stroke-width="3.5"/>
      <circle cx="94" cy="91" r="5" fill="#fffbeb" filter="url(#glow)"/>
    </g>`);
};

// D-D Fusion Inertial: deuterium pulse fusion - heavier and dirtier (lots of
// neutrons): a deep reaction bowl ringed with beam ports, a thick conical shadow
// shield, big radiators, and broad blue-white pulses.
ART['rob_neutral_beam:secondary'] = () => {
  const b = space('#0f1530', '#03040a', '25%', '35%');
  return svg(b.defs + rad('bowl', [[0, '#e0f2fe'], [0.5, '#64748b'], [1, '#1e293b']], '30%', '50%', '80%'), `${b.body}${stars(45, 46)}${mRock('rob_neutral_beam', 'secondary', 46)}
    ${pearls(104, 104, 196, 112, 5, '#93c5fd', 11)}
    <g transform="rotate(5 60 96)">
      ${radiator(4, 52, 40, 22)}${radiator(4, 122, 40, 22)}
      <rect x="6" y="84" width="22" height="24" rx="3" fill="#cbd5e1" stroke="#64748b" stroke-width="1.5"/>
      <path d="M28,90 L58,80 L58,112 L28,102 Z" fill="#475569" stroke="#94a3b8" stroke-width="1"/>
      <line x1="44" y1="84" x2="44" y2="72 M44,108 L44,120" stroke="#64748b" stroke-width="2"/>
      <path d="M58,70 Q104,96 58,122 Z" fill="url(#bowl)" stroke="#cbd5e1" stroke-width="2"/>
      ${[74, 86, 108, 118].map((y) => `<circle cx="${f(58 + (1 - Math.abs(y - 96) / 26) * 26)}" cy="${y}" r="3" fill="#7dd3fc" filter="url(#glow)"/>`).join('')}
      <circle cx="90" cy="96" r="8" fill="#ffffff" filter="url(#glow)"/>
    </g>`);
};

// Wakefield e-Beam: a long, slender plasma-wakefield accelerator boom many
// times the craft's length - ring collars of focusing magnets and a fat plasma
// cell - fed by a regolith hopper, firing a hairline beam into the surface.
ART['rob_free_electron_laser:secondary'] = () => {
  const b = space('#0c1830', '#02050b', '25%', '20%');
  const pal = spectral('rob_free_electron_laser', 'secondary');
  return svg(b.defs, `${b.body}${stars(45, 42)}${ground(pal, 42, 238)}
    <line x1="62" y1="226" x2="62" y2="248" stroke="#a78bfa" stroke-width="2" filter="url(#glow)"/>
    <ellipse cx="62" cy="250" rx="14" ry="5" fill="#93c5fd" opacity="0.6" filter="url(#soft)"/><circle cx="62" cy="249" r="3" fill="#e0f2fe" filter="url(#glow)"/>
    <rect x="58" y="62" width="8" height="164" fill="#64748b"/>
    ${[78, 96, 114, 196, 212].map((y) => `<rect x="53" y="${y}" width="18" height="6" rx="2" fill="#94a3b8" stroke="#cbd5e1" stroke-width="0.8"/>`).join('')}
    <rect x="50" y="128" width="24" height="60" rx="10" fill="#4c1d95" stroke="#c4b5fd" stroke-width="1.5"/><rect x="56" y="136" width="12" height="44" rx="6" fill="#a78bfa" opacity="0.6"/>
    <rect x="34" y="22" width="56" height="40" rx="4" fill="#cbd5e1" stroke="#64748b" stroke-width="1.5"/>
    <path d="M38,22 L44,6 L80,6 L86,22 Z" fill="#8a6a45" stroke="#5b4330" stroke-width="1.2"/>
    <rect x="6" y="30" width="28" height="16" rx="3" fill="#475569"/>${[0, 1, 2, 3].map((i) => `<line x1="${8 + i * 7}" y1="30" x2="${8 + i * 7}" y2="46" stroke="#f59e0b" stroke-width="1.5"/>`).join('')}
    ${solarWing(90, 34, 60, 14)}`);
};

// Kuck Mosquito: David Kuck's comet-oasis rig - a small spidery lander on a dark
// crusted nucleus, its derrick drilling through the crust, steam venting at the
// wellhead, filling a huge quilted water bag that will carry the ice home.
ART['rob_kuck_mosquito:primary'] = () => {
  const b = space('#1d1a12', '#050402', '30%', '20%');
  const pal = spectral('rob_kuck_mosquito', 'primary');
  let quilt = '';
  for (let i = -3; i <= 3; i++) quilt += `<path d="M${f(70 + i * 15)},${f(56 - Math.sqrt(Math.max(0, 3600 - (i * 15) ** 2)) * 0.95)} Q${f(70 + i * 19)},86 ${f(70 + i * 15)},${f(116 + Math.sqrt(Math.max(0, 3600 - (i * 15) ** 2)) * 0.0)}" stroke="#cbd5e1" stroke-width="1" fill="none" opacity="0.6"/>`;
  return svg(b.defs + rad('bag', [[0, '#ffffff'], [0.6, '#e2e8f0'], [1, '#94a3b8']], '35%', '30%', '75%'), `${b.body}${stars(40, 43)}${ground(pal, 43, 188)}
    <circle cx="70" cy="86" r="60" fill="url(#bag)"/>${quilt}
    <path d="M10,86 Q70,76 130,86" stroke="#cbd5e1" stroke-width="1" fill="none" opacity="0.6"/>
    <path d="M70,146 L70,172 M64,150 L76,150" stroke="#94a3b8" stroke-width="3"/>
    <g transform="translate(70 182)">
      <path d="M-10,0 L-26,16 M10,0 L26,16 M-4,2 L-12,18 M4,2 L12,18" stroke="#a8a29e" stroke-width="2.4"/>
      <rect x="-14" y="-12" width="28" height="14" rx="3" fill="#d6d3d1" stroke="#78716c" stroke-width="1.5"/>
      <path d="M-6,2 L6,2 L4,8 L-4,8 Z" fill="#57534e"/>
    </g>
    <path d="M24,206 L32,146 L40,206 Z" fill="none" stroke="#d6d3d1" stroke-width="2"/>
    ${[160, 174, 188].map((y) => `<line x1="${f(32 - (y - 146) * 0.13)}" y1="${y}" x2="${f(32 + (y - 146) * 0.13)}" y2="${y}" stroke="#d6d3d1" stroke-width="1.2"/>`).join('')}
    <line x1="32" y1="150" x2="32" y2="250" stroke="#e7e5e4" stroke-width="2"/>
    <path d="M44,198 Q56,180 70,176" stroke="#7dd3fc" stroke-width="2" fill="none"/>
    <ellipse cx="34" cy="200" rx="14" ry="9" fill="#f8fafc" opacity="0.5" filter="url(#soft)"/><ellipse cx="40" cy="188" rx="9" ry="7" fill="#f8fafc" opacity="0.35" filter="url(#soft)"/>`);
};

// Ablative Laser: no engine, just an ice ablator plate - a laser from a distant
// station strikes it and each pulse blasts a white-violet bloom of plasma off
// the ice, pushing the little craft toward the rock.
ART['rob_kuck_mosquito:secondary'] = () => {
  const b = space('#1a1424', '#050307', '25%', '45%');
  const at = [54, 116];
  const ang = Math.atan2(MROCK[1] - at[1], MROCK[0] - at[0]) * 180 / Math.PI;   // nose on the rock
  return svg(b.defs + lin('ice', [[0, '#f0f9ff'], [0.5, '#bae6fd'], [1, '#7dd3fc']], 0, 0, 1, 0), `${b.body}${stars(45, 44)}${mRock('rob_kuck_mosquito', 'secondary', 44)}
    <g transform="translate(${at[0]} ${at[1]}) rotate(${f(ang + 90)})">
      ${beam(0, 16, 0, 320, '#4ade80', 2.2)}
      <ellipse cx="0" cy="22" rx="30" ry="16" fill="#e9d5ff" opacity="0.55" filter="url(#soft)"/>
      <ellipse cx="0" cy="15" rx="14" ry="7" fill="#ffffff" opacity="0.9" filter="url(#glow)"/>
      <path d="M-30,8 Q0,-4 30,8 L30,12 Q0,0 -30,12 Z" fill="url(#ice)" stroke="#e0f2fe" stroke-width="1"/>
      <line x1="-20" y1="6" x2="0" y2="-20" stroke="#94a3b8" stroke-width="2"/><line x1="20" y1="6" x2="0" y2="-20" stroke="#94a3b8" stroke-width="2"/>
      <rect x="-8" y="-34" width="16" height="14" rx="3" fill="#cbd5e1" stroke="#64748b" stroke-width="1.2"/>
      <path d="M-6,-34 L0,-42 L6,-34 Z" fill="#94a3b8"/>
    </g>`);
};

// MET Steamer: a microwave electrothermal thruster - a short fat copper cavity
// with a window onto the glowing plasma ball, fed microwaves down a rectangular
// waveguide from the magnetron box; water tank; faint pink-violet plume.
ART['rob_met_steamer:primary'] = () => {
  const b = space('#10202a', '#03070a', '25%', '25%');
  const pal = ['#dbeafe', '#93c5fd', '#3b5b7a'];
  return svg(b.defs + lin('brass', [[0, '#fde68a'], [0.5, '#b45309'], [1, '#78350f']], 0, 0, 1, 0)
    + lin('metp', [[0, '#fbcfe8', 0.9], [1, '#a855f7', 0]]), `${b.body}${stars(45, 45)}${ground(pal, 45, 230)}
    <g transform="translate(64 88) rotate(-14)">
      <path d="M-10,64 L10,64 L36,170 L-36,170 Z" fill="url(#metp)" opacity="0.6"/>
      <circle cx="-26" cy="-26" r="22" fill="#bae6fd" stroke="#e0f2fe" stroke-width="2"/>
      <rect x="-6" y="-36" width="44" height="22" rx="3" fill="#475569" stroke="#94a3b8" stroke-width="1.2"/><rect x="26" y="-32" width="8" height="14" fill="#f59e0b"/>
      <path d="M10,-14 L10,6 L4,6" stroke="#94a3b8" stroke-width="8" fill="none" stroke-linejoin="round"/>
      <rect x="-18" y="2" width="36" height="46" rx="5" fill="url(#brass)" stroke="#78350f" stroke-width="1.5"/>
      <circle cx="0" cy="25" r="11" fill="#1f1020" stroke="#fde68a" stroke-width="1.5"/>
      <circle cx="0" cy="25" r="7" fill="#f0abfc" filter="url(#glow)"/><circle cx="0" cy="25" r="3" fill="#ffffff"/>
      <path d="M-10,48 L10,48 L14,64 L-14,64 Z" fill="#78350f"/>
      <path d="M-18,40 L-34,62 M18,40 L34,62" stroke="#94a3b8" stroke-width="2.5"/>
    </g>`);
};

// Nuclear Drill: a reactor-heated melt probe, seen in a cut-away of the ice -
// a torpedo sunk nose-first, its hot head melting the way down, a tether running
// back up to the parked lander, steam welling from the hole.
ART['rob_nuclear_drill:primary'] = () => {
  const b = space('#1f1a10', '#050402', '30%', '10%');
  return svg(b.defs + lin('cut', [[0, '#cbd5e1'], [0.15, '#94a3b8'], [1, '#334155']])
    + lin('torp', [[0, '#e2e8f0'], [0.5, '#94a3b8'], [1, '#475569']], 0, 0, 1, 0), `${b.body}${stars(40, 47)}<g transform="translate(-14 -62)">
    <rect x="0" y="150" width="${W + 20}" height="${H}" fill="url(#cut)"/>
    ${[176, 204, 236, 262].map((y) => `<path d="M0,${y} Q150,${y + 6} 300,${y - 2}" stroke="#e2e8f0" stroke-width="1" opacity="0.35" fill="none"/>`).join('')}
    <path d="M0,150 Q150,140 300,150" stroke="#f1f5f9" stroke-width="2" fill="none"/>
    <g transform="translate(30 140)"><path d="M-6,8 L-12,12 M6,8 L12,12" stroke="#9aa3b2" stroke-width="2"/><rect x="-10" y="-8" width="20" height="16" rx="3" fill="#cbd5e1" stroke="#64748b" stroke-width="1.5"/></g>
    <path d="M40,140 Q52,138 56,150 L62,190" stroke="#facc15" stroke-width="1.4" fill="none" stroke-dasharray="3 2"/>
    <ellipse cx="60" cy="146" rx="14" ry="8" fill="#f8fafc" opacity="0.5" filter="url(#soft)"/>
    <path d="M56,150 L72,150 L76,256 L52,256 Z" fill="#7dd3fc" opacity="0.25"/>
    <g transform="translate(64 214)">
      <rect x="-8" y="-28" width="16" height="44" rx="3" fill="url(#torp)"/>
      <rect x="-8" y="-14" width="16" height="8" fill="#c084fc" opacity="0.8"/>
      <path d="M-8,16 L8,16 L0,32 Z" fill="#f97316" filter="url(#glow)"/>
    </g>
    <ellipse cx="64" cy="250" rx="16" ry="7" fill="#bae6fd" opacity="0.5" filter="url(#soft)"/></g>`);
};

// Helical Railgun: a blocky armoured craft behind a long barrel wrapped in a
// copper helix, capacitor bank and regolith hopper at the breech, spitting a
// line of rock slugs with an arc flash at the muzzle.
ART['rob_nuclear_drill:secondary'] = () => {
  const b = space('#0e1a26', '#03060a', '20%', '35%');
  const hit = [f(MROCK[0] - MRR * 0.72), f(MROCK[1] + 4)];
  return svg(b.defs, `${b.body}${stars(45, 48)}${mRock('rob_nuclear_drill', 'secondary', 48)}
    ${[0, 1, 2, 3, 4].map((i) => { const t = (i + 1) / 6; return `<circle cx="${f(118 + (hit[0] - 118) * t)}" cy="${f(98 + (hit[1] - 98) * t)}" r="2.6" fill="#57534e" stroke="#fde68a" stroke-width="0.8"/>`; }).join('')}
    ${impact(...hit, '#fbbf24', 48)}
    <g transform="rotate(4 60 96)">
      <rect x="4" y="74" width="36" height="44" rx="2" fill="#64748b" stroke="#cbd5e1" stroke-width="1.5"/>
      ${[0, 1, 2].map((i) => `<rect x="${8 + i * 10}" y="58" width="8" height="16" rx="2" fill="#1e3a8a" stroke="#93c5fd" stroke-width="0.8"/>`).join('')}
      <path d="M6,118 L14,132 L30,132 L38,118 Z" fill="#8a6a45" stroke="#5b4330" stroke-width="1"/>
      ${helixTube(40, 96, 72, 8, 7)}
      <path d="M112,90 L120,90 M112,102 L120,102" stroke="#cbd5e1" stroke-width="2"/>
      <circle cx="120" cy="96" r="6" fill="#bfdbfe" filter="url(#glow)"/>
    </g>`);
};

// MagBeam: Winglee's beamed plasma - a solar-powered station fires a collimated
// magnetised plasma column from its helicon gun; it strikes the magnetic bubble
// around the small craft (an aurora where they meet) and pushes it along.
ART['rob_rock_splitter:secondary'] = () => {
  const b = space('#170f2e', '#040208', '30%', '50%');
  const pal = spectral('rob_rock_splitter', 'secondary');
  const st = [34, 214], bub = [214, 98];
  const ux = (bub[0] - st[0]), uy = (bub[1] - st[1]), L = Math.hypot(ux, uy);
  const rk = [f(bub[0] + (ux / L) * 84), f(bub[1] + (uy / L) * 84)];
  const ang = Math.atan2(uy, ux) * 180 / Math.PI;
  return svg(b.defs + lin('mbeam', [[0, '#f5d0fe', 0.9], [1, '#c084fc', 0.6]], 0, 0, 1, 0), `${b.body}${stars(45, 49)}${rock(rk[0], rk[1], 34, pal, 49)}
    <g transform="translate(${st[0]} ${st[1]}) rotate(${f(ang)})">
      <path d="M26,-7 L${f(L - 40)},-9 L${f(L - 40)},9 L26,7 Z" fill="url(#mbeam)" filter="url(#glow)" opacity="0.85"/>
    </g>
    <g transform="translate(${bub[0]} ${bub[1]}) rotate(${f(ang)})">
      ${[44, 34, 24].map((r, i) => `<ellipse cx="0" cy="0" rx="${r}" ry="${f(r * 0.8)}" fill="none" stroke="#a5b4fc" stroke-width="1.3" opacity="${0.4 + i * 0.2}"/>`).join('')}
      <path d="M-40,-16 Q-50,0 -40,16" stroke="#f0abfc" stroke-width="4" fill="none" filter="url(#glow)"/>
      <ellipse cx="0" cy="0" rx="7" ry="9" fill="none" stroke="#e2e8f0" stroke-width="2.5"/>
      <rect x="4" y="-4" width="12" height="8" rx="1.5" fill="#94a3b8"/><path d="M16,-4 L22,0 L16,4 Z" fill="#cbd5e1"/>
    </g>
    <g transform="translate(${st[0]} ${st[1]}) rotate(${f(ang)})">
      ${solarWing(-40, -44, 34, 22)}${solarWing(-40, 22, 34, 22)}
      <rect x="-30" y="-12" width="30" height="24" rx="3" fill="#cbd5e1" stroke="#64748b" stroke-width="1.5"/>
      <rect x="0" y="-6" width="28" height="12" fill="#475569"/>${[6, 13, 20].map((x) => `<rect x="${x}" y="-9" width="4" height="18" fill="#c2621f"/>`).join('')}
    </g>`);
};

// Tungsten Resistojet: a small plain engine - a slim body with its tungsten
// filament glowing through a cut-away, a little dull-orange bell, a water tank,
// and solar panels far bigger than the rest. Its steam is a faint haze.
ART['rob_tungsten_resistojet:primary'] = () => {
  const b = space('#22180f', '#060403', '30%', '30%');
  return svg(b.defs, `${b.body}${stars(45, 50)}${mRock('rob_tungsten_resistojet', 'primary', 50)}
    <g transform="translate(70 100) rotate(${f(Math.atan2(MROCK[1] - 100, MROCK[0] - 70) * 180 / Math.PI - 90)})">
      <path d="M-6,34 L6,34 L30,${f(Math.hypot(MROCK[0] - 70, MROCK[1] - 100) - MRR + 6)} L-30,${f(Math.hypot(MROCK[0] - 70, MROCK[1] - 100) - MRR + 6)} Z" fill="#e5e7eb" opacity="0.2" filter="url(#soft)"/>
      ${solarWing(-96, -14, 70, 22)}${solarWing(26, -14, 70, 22)}
      <circle cx="0" cy="-26" r="13" fill="#e2e8f0" stroke="#94a3b8" stroke-width="1.5"/>
      <rect x="-9" y="-14" width="18" height="38" rx="3" fill="#cbd5e1" stroke="#64748b" stroke-width="1.2"/>
      <rect x="-5" y="-6" width="10" height="24" fill="#1c1917"/>
      <path d="M0,-4 q4,2 0,4 q-4,2 0,4 q4,2 0,4 q-4,2 0,4 q4,2 0,4" stroke="#fde68a" stroke-width="2" fill="none" filter="url(#glow)"/>
      <path d="M-5,24 L5,24 L8,34 L-8,34 Z" fill="#c2410c"/>
      <path d="M-9,10 L-20,30 M9,10 L20,30" stroke="#94a3b8" stroke-width="2"/>
    </g>`);
};

// MITEE Arcjet: a squat nuclear hopper - a compact barrel reactor of pressure
// tubes, each with its own little nozzle - lifting off the ice, with a small
// arcjet pod on an arm firing a blue-violet needle, and radiator fins.
ART['rob_tungsten_resistojet:secondary'] = () => {
  const b = space('#141432', '#03030a', '30%', '20%');
  const pal = ['#e0f2fe', '#a5c8e4', '#4b6a88'];
  return svg(b.defs + lin('hj', [[0, '#fdf2f8', 0.8], [1, '#f9a8d4', 0]]) + lin('reac', [[0, '#94a3b8'], [0.5, '#e2e8f0'], [1, '#475569']], 0, 0, 1, 0), `${b.body}${stars(45, 51)}${ground(pal, 51, 236)}
    <g transform="translate(48 118) scale(0.85)">
      ${[-15, -5, 5, 15].map((x) => `<path d="M${x - 4},26 L${x + 4},26 L${x + 8},96 L${x - 8},96 Z" fill="url(#hj)" opacity="0.7"/>`).join('')}
      ${radiator(-62, -26, 30, 40)}${radiator(32, -26, 30, 40)}
      <rect x="-22" y="-30" width="44" height="50" rx="8" fill="url(#reac)"/>
      ${[-15, -5, 5, 15].map((x) => `<line x1="${x}" y1="-30" x2="${x}" y2="20" stroke="#64748b" stroke-width="1"/><path d="M${x - 4},20 L${x + 4},20 L${x + 5},28 L${x - 5},28 Z" fill="#475569"/>`).join('')}
      ${TREFOIL(0, -6, 6)}
      <path d="M-20,20 L-34,40 M20,20 L34,40" stroke="#9aa3b2" stroke-width="2.5"/>
      <path d="M22,-20 L46,-36" stroke="#9aa3b2" stroke-width="3"/>
      <rect x="44" y="-44" width="14" height="10" rx="2" fill="#cbd5e1" transform="rotate(-34 51 -39)"/>
      <path d="M56,-42 L92,-62 L94,-58 Z" fill="#818cf8" filter="url(#glow)"/><circle cx="57" cy="-42" r="2.4" fill="#ffffff"/>
    </g>`);
};

// BUGGY scene: a machine at work on the surface of a big asteroid.
// (HF4 rules note: buggies scoop regolith over wide areas, heat it for its
// volatiles and dump the rest; iron fines and ice can be separated
// magnetically or electrophoretically.)
function surface(card, face, seed, bg) {
  const b = space(bg[0], bg[1], '50%', '20%');
  return { b, base: `${b.body}${stars(55, seed)}${ground(spectral(card, face), seed)}` };
}
function wheels6(y, r = 9) {
  return [-44, -20, 4, 28].map((x) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#22262e" stroke="#7b8494" stroke-width="2"/><circle cx="${x}" cy="${y}" r="3" fill="#9aa3b2"/>`).join('');
}

// Cat Fusion Z-pinch Torch: the heaviest buggy - a big chassis carrying a
// capacitor bank, a boom arm, and a coaxial plasma gun whose pinched blue-white
// filament slices a glowing trench in the rock.
ART['rob_cat_fusion_z_pinch_torch:primary'] = () => {
  const { b, base } = surface('rob_cat_fusion_z_pinch_torch', 'primary', 61, ['#191430', '#040209']);
  let pinch = '';
  for (let i = 0; i < 6; i++) pinch += `<ellipse cx="0" cy="${8 + i * 7}" rx="${i % 2 ? 2.4 : 4.4}" ry="4" fill="#e0f2fe"/>`;
  return svg(b.defs, `${base}
    <path d="M150,238 Q190,232 238,242" stroke="#fb923c" stroke-width="4" fill="none" filter="url(#glow)"/>
    <g transform="translate(100 226)">
      ${wheels6(0)}
      <rect x="-58" y="-30" width="98" height="24" rx="4" fill="#9aa3b2" stroke="#4b5260" stroke-width="1.5"/>
      ${[0, 1, 2, 3].map((i) => `<rect x="${-52 + i * 14}" y="-50" width="11" height="20" rx="3" fill="#1e3a8a" stroke="#93c5fd" stroke-width="1"/>`).join('')}
      <path d="M10,-30 L52,-74 L94,-46" stroke="#cbd5e1" stroke-width="6" fill="none" stroke-linejoin="round"/>
      <path d="M-4,-42 Q30,-80 92,-48" stroke="#f59e0b" stroke-width="1.6" fill="none"/>
      <g transform="translate(96 -44)"><rect x="-8" y="-6" width="16" height="12" fill="#475569" stroke="#cbd5e1" stroke-width="1.5"/><rect x="-2" y="4" width="4" height="4" fill="#e2e8f0"/>
        <line x1="0" y1="6" x2="0" y2="50" stroke="#7dd3fc" stroke-width="7" opacity="0.5" filter="url(#glow)"/>${pinch}</g>
    </g>
    ${[...Array(10)].map((_, i) => `<circle cx="${196 + (i * 13) % 34 - 10}" cy="${226 - (i * 7) % 26}" r="${1 + (i % 3) * 0.6}" fill="#fdba74"/>`).join('')}
    <ellipse cx="196" cy="214" rx="18" ry="12" fill="#e2e8f0" opacity="0.15" filter="url(#soft)"/>`);
};

// Flywheel Tractor: a stubby tracked bulldozer with a big spinning flywheel on
// its back, its blade shoving a heap of regolith, a charging mast up top and
// spoil dumped behind.
ART['rob_flywheel_tractor:primary'] = () => {
  const { b, base } = surface('rob_flywheel_tractor', 'primary', 62, ['#171c28', '#040507']);
  return svg(b.defs, `${base}
    <path d="M196,240 Q214,214 240,240 Z" fill="#7c5a3c"/><path d="M30,244 Q40,230 52,244 Z M58,246 Q66,236 74,246 Z" fill="#5b4330"/>
    <g transform="translate(130 232)">
      <rect x="-50" y="-12" width="100" height="22" rx="11" fill="#22262e" stroke="#5b6475" stroke-width="2"/>
      ${[...Array(10)].map((_, i) => `<line x1="${-42 + i * 9.4}" y1="-12" x2="${-42 + i * 9.4}" y2="10" stroke="#5b6475" stroke-width="2"/>`).join('')}
      <rect x="-42" y="-38" width="80" height="26" rx="4" fill="#eab308" stroke="#854d0e" stroke-width="1.5"/>
      <ellipse cx="-2" cy="-44" rx="40" ry="11" fill="#4b5563" stroke="#e5e7eb" stroke-width="2"/>
      <ellipse cx="-2" cy="-46" rx="34" ry="8" fill="#6b7280"/>
      <path d="M-30,-48 A32,7 0 0 1 26,-48" stroke="#e0f2fe" stroke-width="1.5" fill="none" opacity="0.7"/>
      <path d="M-20,-41 A24,5 0 0 0 20,-41" stroke="#e0f2fe" stroke-width="1.2" fill="none" opacity="0.5"/>
      <circle cx="-2" cy="-46" r="4" fill="#facc15"/>
      <line x1="-36" y1="-38" x2="-36" y2="-70" stroke="#9aa3b2" stroke-width="2.5"/><path d="M-42,-70 L-30,-70 L-36,-78 Z" fill="#9aa3b2"/>
      <path d="M38,-28 L62,-14 L64,12 L54,12 L52,-8 L36,-16" fill="#a16207" stroke="#713f12" stroke-width="1.5"/>
    </g>`);
};

// Electrophoretic Sandworm: a long segmented burrowing worm, every segment
// ringed with copper electrode bands; electric fields lift the grains and
// convey them back along its body, leaving a raised furrow behind it.
ART['rob_flywheel_tractor:secondary'] = () => {
  const { b, base } = surface('rob_flywheel_tractor', 'secondary', 63, ['#1a1426', '#040207']);
  const pal = spectral('rob_flywheel_tractor', 'secondary');
  let segs = '', dust = '';
  for (let i = 0; i < 10; i++) {
    const x = 40 + i * 20, y = 236 + Math.sin(i * 0.7) * 4;
    segs += `<ellipse cx="${x}" cy="${f(y)}" rx="12" ry="13" fill="url(#seg)"/><path d="M${x - 4},${f(y - 12)} A6,13 0 0 1 ${x - 4},${f(y + 12)}" stroke="#d97706" stroke-width="2" fill="none"/><path d="M${x + 5},${f(y - 12)} A6,13 0 0 1 ${x + 5},${f(y + 12)}" stroke="#d97706" stroke-width="1.4" fill="none"/>`;
  }
  const rnd = seeded(63);
  for (let i = 0; i < 40; i++) {
    const x = 40 + rnd() * 210, y = 214 + rnd() * 18;
    dust += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.6 + rnd() * 1.2)}" fill="#e9d5ff" opacity="${f(0.4 + rnd() * 0.5)}"/>`;
  }
  return svg(b.defs + lin('seg', [[0, '#e5e7eb'], [0.5, '#9ca3af'], [1, '#374151']]), `${base}
    <path d="M-10,246 Q30,232 40,240 Q120,232 250,246 L250,252 L-10,252 Z" fill="${pal[0]}" opacity="0.8"/>
    ${segs}
    <ellipse cx="248" cy="238" rx="15" ry="14" fill="#6b7280" stroke="#d1d5db" stroke-width="1.5"/>
    <circle cx="256" cy="234" r="4" fill="#7dd3fc" filter="url(#glow)"/>
    ${dust}
    ${[60, 110, 160, 210].map((x) => `<path d="M${x},222 l-6,-6 l4,0 l-6,-6" stroke="#c4b5fd" stroke-width="1" fill="none" opacity="0.8"/>`).join('')}
    <path d="M-10,250 Q120,240 260,252 L300,252 L300,${H + 5} L-10,${H + 5} Z" fill="${pal[1]}"/>`);
};

// Nanobot: no vehicle - a small seed lander releases a swarm that spreads over
// the rock as a creeping grey carpet; the inset shows a few of the bots.
ART['rob_met_steamer:secondary'] = () => {
  const { b, base } = surface('rob_met_steamer', 'secondary', 64, ['#0c1a20', '#020506']);
  const rnd = seeded(64);
  let goo = '', trails = '';
  for (let i = 0; i < 140; i++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 90;
    goo += `<circle cx="${f(150 + Math.cos(a) * d * 1.5)}" cy="${f(244 + Math.sin(a) * d * 0.3)}" r="${f(0.8 + rnd())}" fill="#cbd5e1" opacity="${f(0.85 - d / 130)}"/>`;
  }
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    trails += `<path d="M150,244 L${f(150 + Math.cos(a) * 140)},${f(244 + Math.sin(a) * 30)}" stroke="#94a3b8" stroke-width="1" stroke-dasharray="2 3" opacity="0.6"/>`;
  }
  const bot = (x, y, r) => `<g transform="translate(${x} ${y}) rotate(${r})"><path d="M-6,-3 L-11,-8 M-6,3 L-11,8 M6,-3 L11,-8 M6,3 L11,8 M0,-5 L0,-11" stroke="#cbd5e1" stroke-width="1.4"/><polygon points="-6,0 -3,-5 3,-5 6,0 3,5 -3,5" fill="#64748b" stroke="#e2e8f0" stroke-width="1"/><circle cx="0" cy="0" r="1.5" fill="#5eead4"/></g>`;
  return svg(b.defs, `${base}
    <ellipse cx="150" cy="244" rx="140" ry="28" fill="#94a3b8" opacity="0.18" filter="url(#soft)"/>${trails}${goo}
    <g transform="translate(150 240)"><path d="M-12,4 L-18,12 M12,4 L18,12" stroke="#9aa3b2" stroke-width="2"/><rect x="-10" y="-16" width="20" height="20" rx="3" fill="#cbd5e1" stroke="#64748b" stroke-width="1.5"/><ellipse cx="0" cy="-16" rx="10" ry="3" fill="#e2e8f0"/><circle cx="0" cy="-6" r="3" fill="#5eead4" filter="url(#glow)"/></g>
    <circle cx="232" cy="168" r="40" fill="#0b1416" stroke="#5eead4" stroke-width="1.5"/>
    <line x1="196" y1="186" x2="176" y2="236" stroke="#5eead4" stroke-width="1" stroke-dasharray="3 3"/>
    ${bot(218, 156, 10)}${bot(246, 162, -20)}${bot(228, 184, 40)}${bot(252, 186, 5)}`);
};

// Rock Splitter: a rover with a drill mast and a hydraulic ram that drives a
// plug-and-feathers wedge into a drilled hole, cracking a boulder in two.
ART['rob_rock_splitter:primary'] = () => {
  const { b, base } = surface('rob_rock_splitter', 'primary', 65, ['#20160e', '#050302']);
  const pal = spectral('rob_rock_splitter', 'primary');
  return svg(b.defs, `${base}
    <path d="M190,240 Q194,188 236,182 Q284,184 290,240 Z" fill="${pal[1]}" stroke="${pal[2]}" stroke-width="2"/>
    <path d="M196,226 Q214,200 240,196" stroke="${pal[0]}" stroke-width="2" fill="none" opacity="0.7"/>
    <path d="M232,186 L236,200 L230,210 L238,222 L234,240" stroke="#120a05" stroke-width="3" fill="none"/>
    <g transform="translate(108 232)">
      ${wheels6(0)}
      <rect x="-56" y="-30" width="94" height="22" rx="3" fill="#facc15" stroke="#854d0e" stroke-width="1.5"/>
      ${[0, 1, 2, 3, 4, 5].map((i) => `<path d="M${-52 + i * 15},-30 l8,0 l-8,22 l-8,0 Z" fill="#1f2937" opacity="0.5"/>`).join('')}
      <rect x="-40" y="-84" width="10" height="54" fill="#9aa3b2"/><path d="M-40,-84 L-30,-84 L-35,-94 Z" fill="#9aa3b2"/>
      ${[0, 1, 2, 3, 4].map((i) => `<line x1="-40" y1="${-80 + i * 10}" x2="-30" y2="${-74 + i * 10}" stroke="#4b5260" stroke-width="1"/>`).join('')}
      <rect x="20" y="-42" width="56" height="12" rx="3" fill="#94a3b8" stroke="#475569" stroke-width="1.5"/>
      <rect x="76" y="-39" width="26" height="6" fill="#e2e8f0"/>
      <path d="M102,-42 L124,-36 L102,-30 Z" fill="#cbd5e1" stroke="#475569" stroke-width="1"/>
      <path d="M100,-44 L124,-40 M100,-28 L124,-32" stroke="#64748b" stroke-width="2"/>
      <path d="M20,-36 Q4,-60 -22,-34 M24,-32 Q0,-70 -26,-30" stroke="#111827" stroke-width="2.2" fill="none"/>
    </g>`);
};

// Fill any face not yet drawn so the generator never emits a blank.
for (const id of Object.keys(PATENTS_BY_ID).filter((k) => PATENTS_BY_ID[k].type === 'robonaut')) {
  for (const face of ['primary', 'secondary']) {
    if (!ART[`${id}:${face}`]) throw new Error(`robonaut art missing: ${id}:${face}`);
  }
}
