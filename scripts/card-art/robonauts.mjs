// Robonaut deck art: 12 cards x 2 faces. A robonaut is a prospecting robot,
// and its art shows it at work against an asteroid, by role:
//   raygun  - a beam fired from a ship strikes the rock and vaporises a spot
//   missile - the robonaut is itself a small craft under thrust, diving in
//   buggy   - a rover working the surface
// Each face is its own machine (the black back is a different robot). The
// asteroid takes the card's spectral-type colour. See docs/card-art-guide.md.
import { PATENTS_BY_ID } from '../../data/patents.js';
import { H, W, f, lin, rad, space, stars, svg, shipBody, plume } from './kit.mjs';

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

// A ship whose nose carries the beam emitter. Returns { svg, nose } so the
// beam can start at the emitter. The ship's forward (-y) points along `ang`.
const NOSE = { tug: 200, crewed: 200, freighter: 200, probe: 74 };
function emitterShip(kind, x, y, ang, s, glow) {
  const L = NOSE[kind] + 12;
  const r = (ang * Math.PI) / 180;
  const nose = [f(x + Math.sin(r) * L * s), f(y - Math.cos(r) * L * s)];
  const em = `<rect x="-7" y="-${NOSE[kind] + 14}" width="14" height="14" rx="3" fill="#2b313c" stroke="#9aa3b2" stroke-width="1.5"/>
    <circle cx="0" cy="-${NOSE[kind] + 14}" r="5" fill="${glow}" filter="url(#glow)"/>`;
  return { svg: `<g transform="translate(${x} ${y}) rotate(${ang}) scale(${s})">${shipBody(kind)}${em}</g>`, nose };
}

// A small robonaut craft (missiles). Forward is -y, engine at (0,0).
// `nose`: 'cone' | 'drill' | 'proboscis' | 'plate' | 'sphere' | 'coil'.
function craft({ body = '#d6dbe4', accent = '#f97316', nose = 'cone', legs = false, extra = '' }) {
  const legsSvg = legs ? `<path d="M-14,-12 L-30,10 M14,-12 L30,10" stroke="#8e97a6" stroke-width="3"/><path d="M-36,10 L-24,10 M24,10 L36,10" stroke="#8e97a6" stroke-width="3"/>` : '';
  const noses = {
    cone: `<path d="M-14,-62 L14,-62 L0,-92 Z" fill="${body}"/>`,
    drill: `<path d="M-12,-62 L12,-62 L0,-104 Z" fill="#9aa3b2"/>${[0, 1, 2, 3].map((i) => `<path d="M${-10 + i * 2.6},${-68 - i * 9} L${10 - i * 2.6},${-64 - i * 9}" stroke="#4b5260" stroke-width="2"/>`).join('')}`,
    proboscis: `<path d="M-12,-62 L12,-62 L4,-72 L-4,-72 Z" fill="${body}"/><line x1="0" y1="-72" x2="0" y2="-124" stroke="#c9d0db" stroke-width="2.5"/><circle cx="0" cy="-124" r="2.5" fill="${accent}"/>`,
    plate: `<ellipse cx="0" cy="-64" rx="30" ry="6" fill="#cfd5df" stroke="#7b8494" stroke-width="1.5"/>`,
    sphere: `<circle cx="0" cy="-76" r="18" fill="url(#crSphere)"/>`,
    coil: `<rect x="-10" y="-112" width="20" height="50" rx="4" fill="#3b424f"/>${[0, 1, 2, 3, 4, 5].map((i) => `<ellipse cx="0" cy="${-106 + i * 8}" rx="13" ry="3" fill="none" stroke="#e3954f" stroke-width="2.5"/>`).join('')}`,
  };
  return `<defs>${lin('crBody', [[0, '#f1f4f8'], [0.5, body], [1, '#4b5260']], 0, 0, 1, 0)}${rad('crSphere', [[0, '#ffffff'], [0.6, '#b9c2d0'], [1, '#4b5260']], '35%', '35%')}</defs>
    ${legsSvg}
    <path d="M-16,0 L16,0 L14,-62 L-14,-62 Z" fill="url(#crBody)"/>
    <path d="M-16,-20 L-30,-4 L-16,-4 Z M16,-20 L30,-4 L16,-4 Z" fill="${accent}"/>
    <rect x="-14" y="-40" width="28" height="4" fill="${accent}"/>
    <path d="M-10,0 L10,0 L13,10 L-13,10 Z" fill="#4b5260"/>
    ${noses[nose]}${extra}`;
}

// A surface rover. (x, y) is where the wheels meet the ground.
function rover({ x, y, s = 1, body = '#e8dcc0', tool = '', tracks = false, mast = true }) {
  const wheels = tracks
    ? `<rect x="-46" y="-12" width="92" height="22" rx="11" fill="#2a2f38" stroke="#5b6475" stroke-width="2"/>${[...Array(9)].map((_, i) => `<line x1="${-38 + i * 9.5}" y1="-12" x2="${-38 + i * 9.5}" y2="10" stroke="#5b6475" stroke-width="2"/>`).join('')}`
    : [-30, 0, 30].map((wx) => `<circle cx="${wx}" cy="0" r="10" fill="#2a2f38" stroke="#7b8494" stroke-width="2"/><circle cx="${wx}" cy="0" r="3" fill="#9aa3b2"/>`).join('')
      + `<path d="M-30,0 L-14,-14 L14,-14 L30,0" stroke="#7b8494" stroke-width="2.5" fill="none"/>`;
  const mastSvg = mast ? `<line x1="-26" y1="-34" x2="-26" y2="-58" stroke="#9aa3b2" stroke-width="3"/><rect x="-34" y="-66" width="16" height="9" rx="2" fill="#4b5260"/><circle cx="-21" cy="-61.5" r="2.4" fill="#7dd3fc"/>` : '';
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <ellipse cx="0" cy="10" rx="58" ry="6" fill="#000" opacity="0.35"/>
    ${wheels}
    <rect x="-40" y="-36" width="80" height="22" rx="4" fill="${body}" stroke="#8a7a5a" stroke-width="1.5"/>
    <rect x="-36" y="-42" width="56" height="6" fill="#1e3a8a" stroke="#60a5fa" stroke-width="1"/>
    ${mastSvg}${tool}
  </g>`;
}

// ---- the 24 faces ----------------------------------------------------------

export const ART = {};
export const RIG = {};   // robonauts draw their own craft, no ship mount

// RAYGUN scene: ship mid-left, beam down-right onto a floating rock.
function raygunScene(key, seed, { bg, kind, color, shipAt = [70, 196], ang = 120, s = 0.5, rockAt = [226, 222], rockR = 52, extra = '' }) {
  const [card, face] = key.split(':');
  const pal = spectral(card, face);
  const b = space(bg[0], bg[1], '30%', '70%');
  const sh = emitterShip(kind, shipAt[0], shipAt[1], ang, s, color);
  const hit = [rockAt[0] - rockR * 0.55, rockAt[1] - rockR * 0.45];
  return svg(b.defs, `${b.body}${stars(45, seed)}
    ${rock(rockAt[0], rockAt[1], rockR, pal, seed)}
    ${beam(sh.nose[0], sh.nose[1], f(hit[0]), f(hit[1]), color)}
    ${impact(f(hit[0]), f(hit[1]), color, seed)}
    ${sh.svg}${extra}`);
}

// Blackbody-Pumped Laser: a white-hot blackbody cavity on the ship pumps a red beam.
ART['rob_blackbody_pumped_laser:primary'] = () => raygunScene('rob_blackbody_pumped_laser:primary', 31, {
  bg: ['#2a1414', '#070304'], kind: 'tug', color: '#ff3b2f', shipAt: [64, 214], ang: 118,
  extra: `<circle cx="52" cy="232" r="16" fill="#ffb347" filter="url(#glow)"/><circle cx="52" cy="232" r="8" fill="#fff4d6"/>`,
});
// Fissile Aerosol Laser: a fission-pumped aerosol cell glowing green-yellow.
ART['rob_blackbody_pumped_laser:secondary'] = () => raygunScene('rob_blackbody_pumped_laser:secondary', 32, {
  bg: ['#13240f', '#030603'], kind: 'crewed', color: '#b8f34a', shipAt: [60, 212], ang: 116,
  extra: `<rect x="34" y="236" width="40" height="14" rx="7" fill="#d9f99d" opacity="0.5" filter="url(#glow)"/>`,
});
// Free Electron Laser: a long undulator of alternating magnets on the ship.
ART['rob_free_electron_laser:primary'] = () => raygunScene('rob_free_electron_laser:primary', 33, {
  bg: ['#0b1f2e', '#02060a'], kind: 'freighter', color: '#5eead4', shipAt: [66, 220], ang: 112,
  extra: [...Array(10)].map((_, i) => `<rect x="${20 + i * 8}" y="${266 - i * 3.4}" width="6" height="8" fill="${i % 2 ? '#ef4444' : '#3b82f6'}"/>`).join(''),
});
// Neutral Beam: an accelerator ring launches a blue-white particle beam.
ART['rob_neutral_beam:primary'] = () => raygunScene('rob_neutral_beam:primary', 34, {
  bg: ['#0e1630', '#03040a'], kind: 'crewed', color: '#a5c8ff', shipAt: [64, 216], ang: 116,
  extra: `<ellipse cx="44" cy="244" rx="30" ry="9" fill="none" stroke="#93c5fd" stroke-width="4" filter="url(#glow)"/>`,
});
// Phase-Locked Diode Laser: a flat phased array of many tiny emitters.
ART['rob_phase_locked_diode_laser:primary'] = () => {
  const key = 'rob_phase_locked_diode_laser:primary';
  const pal = spectral('rob_phase_locked_diode_laser', 'primary');
  const b = space('#1b1030', '#040208', '25%', '70%');
  let dots = '';
  for (let i = 0; i < 6; i++) for (let j = 0; j < 9; j++) dots += `<circle cx="${18 + j * 9}" cy="${168 + i * 9}" r="2.2" fill="#f0abfc"/>`;
  let rays = '';
  for (let j = 0; j < 9; j += 2) rays += `<line x1="${18 + j * 9}" y1="190" x2="186" y2="214" stroke="#e879f9" stroke-width="1" opacity="0.5"/>`;
  return svg(b.defs, `${b.body}${stars(45, 35)}${rock(232, 224, 54, pal, 35)}
    <rect x="8" y="158" width="94" height="66" rx="4" fill="#2b2338" stroke="#a78bfa" stroke-width="2"/>${dots}
    <g transform="translate(55 232) rotate(-90) scale(0.4)">${shipBody('probe')}</g>
    ${rays}${beam(102, 192, 196, 214, '#e879f9')}${impact(196, 214, '#e879f9', 35)}`);
};
// Lorentz-Propelled Microprobe: chip-sized probes riding magnetic field lines down to the rock.
ART['rob_phase_locked_diode_laser:secondary'] = () => {
  const pal = spectral('rob_phase_locked_diode_laser', 'secondary');
  const b = space('#0a1a2a', '#02050a', '25%', '70%');
  let field = '', chips = '';
  for (let k = 0; k < 4; k++) field += `<path d="M${20 + k * 14},150 Q${110 + k * 10},${150 + k * 10} ${190 + k * 8},${210 + k * 6}" stroke="#60a5fa" stroke-width="1.3" fill="none" opacity="0.55" stroke-dasharray="5 4"/>`;
  for (let i = 0; i < 9; i++) {
    const t = i / 8, k = i % 4;
    const x = (1 - t) * (1 - t) * (20 + k * 14) + 2 * (1 - t) * t * (110 + k * 10) + t * t * (190 + k * 8);
    const y = (1 - t) * (1 - t) * 150 + 2 * (1 - t) * t * (150 + k * 10) + t * t * (210 + k * 6);
    chips += `<rect x="${f(x - 4)}" y="${f(y - 3)}" width="8" height="6" rx="1" fill="#facc15" stroke="#fde68a" stroke-width="0.8"/><circle cx="${f(x - 7)}" cy="${f(y)}" r="2" fill="#93c5fd" filter="url(#glow)"/>`;
  }
  return svg(b.defs, `${b.body}${stars(45, 36)}${rock(234, 228, 52, pal, 36)}
    <g transform="translate(40 180) rotate(110) scale(0.42)">${shipBody('tug')}</g>
    ${field}${chips}${impact(200, 214, '#93c5fd', 36)}`);
};
// Solar-Pumped MHD Exciplex Laser: a big solar concentrator feeds a violet UV laser.
ART['rob_solar_pumped_mhd_exciplex_laser:primary'] = () => raygunScene('rob_solar_pumped_mhd_exciplex_laser:primary', 37, {
  bg: ['#1f1638', '#05030a'], kind: 'probe', color: '#a78bfa', shipAt: [74, 200], ang: 116, s: 0.75,
  extra: `<path d="M8,150 Q40,178 30,218 Q-2,196 8,150 Z" fill="#fde68a" opacity="0.85"/><path d="M8,150 Q40,178 30,218" stroke="#a16207" stroke-width="1.5" fill="none"/>
    <circle cx="300" cy="140" r="70" fill="#fde68a" opacity="0.25" filter="url(#soft)"/>`,
});
// Quantum Cascade Laser: a compact probe with a stacked-semiconductor emitter and a deep-red IR beam.
ART['rob_solar_pumped_mhd_exciplex_laser:secondary'] = () => raygunScene('rob_solar_pumped_mhd_exciplex_laser:secondary', 38, {
  bg: ['#25100f', '#060203'], kind: 'probe', color: '#dc2626', shipAt: [70, 206], ang: 114, s: 0.8,
  extra: '',
});

// MISSILE scene: the robonaut craft dives at a rock, engine burning behind it.
// On a missile card the thrust triangle covers the top-centre and the supports
// panel the lower middle, so the craft flies in the open upper-left corner and
// the rock sits right of the triangle.
const MA = [58, 78], MANG = 118, MS = 0.72;          // craft position, heading, scale
const ROCK_AT = [254, 120], ROCK_R = 46;
const HIT = [f(ROCK_AT[0] - ROCK_R * 0.72), f(ROCK_AT[1] - ROCK_R * 0.12)];
// A point d craft-units ahead of (d > 0) or behind (d < 0) the craft's engine.
function along(d) {
  const r = (MANG * Math.PI) / 180;
  return [f(MA[0] + Math.sin(r) * d * MS), f(MA[1] - Math.cos(r) * d * MS)];
}
function missileScene(key, seed, { bg, plumeColor, craftOpts = {}, extra = '', pre = '' }) {
  const [card, face] = key.split(':');
  const pal = spectral(card, face);
  const b = space(bg[0], bg[1], '30%', '30%');
  return svg(b.defs + lin('mplume', [[0, '#ffffff'], [0.3, plumeColor, 0.8], [1, plumeColor, 0]]), `${b.body}${stars(45, seed)}
    ${rock(ROCK_AT[0], ROCK_AT[1], ROCK_R, pal, seed)}${pre}
    <g transform="translate(${MA[0]} ${MA[1]}) rotate(${MANG}) scale(${MS})">
      ${plume(0, 10, 0, 110, 10, 34, 'url(#mplume)', 0.9)}
      ${craft(craftOpts)}
    </g>${extra}`);
}

// H-B Cat Inertial: proton-boron pellets lit in a pulse chamber, bursts behind the craft.
ART['rob_cat_fusion_z_pinch_torch:secondary'] = () => missileScene('rob_cat_fusion_z_pinch_torch:secondary', 41, {
  bg: ['#1a0f2e', '#04020a'], plumeColor: '#e879f9', craftOpts: { nose: 'sphere', accent: '#c084fc' },
  extra: [1, 2, 3].map((i) => { const [x, y] = along(-34 * i); return `<circle cx="${x}" cy="${y}" r="${10 - i * 2}" fill="#f5d0fe" opacity="${f(0.9 - i * 0.2)}" filter="url(#glow)"/>`; }).join(''),
});
// Wakefield e-Beam: the craft drives an electron beam ahead of it into the rock.
ART['rob_free_electron_laser:secondary'] = () => missileScene('rob_free_electron_laser:secondary', 42, {
  bg: ['#0b1e30', '#02060b'], plumeColor: '#38bdf8', craftOpts: { nose: 'cone', accent: '#38bdf8' },
  extra: `${beam(...along(94), ...HIT, '#7dd3fc', 2.5)}${impact(...HIT, '#7dd3fc', 42)}`,
});
// Kuck Mosquito: a light lander with a long sampling proboscis and spindly legs.
ART['rob_kuck_mosquito:primary'] = () => missileScene('rob_kuck_mosquito:primary', 43, {
  bg: ['#1f1a10', '#050402'], plumeColor: '#fbbf24', craftOpts: { nose: 'proboscis', legs: true, accent: '#facc15' },
});
// Ablative Laser: a pusher plate shoved along by a laser from far behind.
ART['rob_kuck_mosquito:secondary'] = () => missileScene('rob_kuck_mosquito:secondary', 44, {
  bg: ['#2a1218', '#070305'], plumeColor: '#fb923c', craftOpts: { nose: 'plate', accent: '#ef4444' },
  pre: beam(...along(-400), ...along(-8), '#ff3b3b', 2.5),
});
// MET Steamer: a microwave-heated water rocket, its tank on the back, a white steam plume.
ART['rob_met_steamer:primary'] = () => missileScene('rob_met_steamer:primary', 45, {
  bg: ['#10202a', '#03070a'], plumeColor: '#e0f2fe', craftOpts: { nose: 'cone', legs: true, accent: '#0ea5e9', extra: `<ellipse cx="0" cy="-36" rx="20" ry="14" fill="#7dd3fc" stroke="#e0f2fe" stroke-width="2" opacity="0.9"/>` },
});
// D-D Fusion Inertial: a spherical target chamber at the nose, flashing.
ART['rob_neutral_beam:secondary'] = () => missileScene('rob_neutral_beam:secondary', 46, {
  bg: ['#1e1030', '#05030a'], plumeColor: '#f0abfc', craftOpts: { nose: 'sphere', accent: '#e879f9' },
  extra: (() => { const [x, y] = along(76); return `<circle cx="${x}" cy="${y}" r="9" fill="#fff" filter="url(#glow)"/>`; })(),
});
// Nuclear Drill: a reactor-heated drill lander, bit first, legs out.
ART['rob_nuclear_drill:primary'] = () => missileScene('rob_nuclear_drill:primary', 47, {
  bg: ['#2a1d0e', '#060403'], plumeColor: '#fdba74', craftOpts: { nose: 'drill', legs: true, accent: '#f97316', extra: `<circle cx="0" cy="-48" r="6" fill="#fde047" filter="url(#glow)"/>` },
});
// Helical Railgun: a coil gun on the craft fires slugs ahead into the rock.
ART['rob_nuclear_drill:secondary'] = () => missileScene('rob_nuclear_drill:secondary', 48, {
  bg: ['#0e1a26', '#03060a'], plumeColor: '#93c5fd', craftOpts: { nose: 'coil', accent: '#e3954f' },
  extra: [0, 1, 2, 3].map((i) => { const t = (i + 1) / 5; const [x0, y0] = along(118); return `<circle cx="${f(x0 + (HIT[0] - x0) * t)}" cy="${f(y0 + (HIT[1] - y0) * t)}" r="3" fill="#fde68a" filter="url(#glow)"/>`; }).join('') + impact(...HIT, '#fbbf24', 48),
});
// MagBeam: a distant station projects a magnetised plasma beam that pushes the craft.
ART['rob_rock_splitter:secondary'] = () => missileScene('rob_rock_splitter:secondary', 49, {
  bg: ['#170f2e', '#040208'], plumeColor: '#c4b5fd', craftOpts: { nose: 'plate', accent: '#8b5cf6' },
  pre: (() => { const [x0, y0] = along(-300); const [x1, y1] = along(-6); return `<path d="M${x0 - 14},${y0} L${x1},${y1 - 8} L${x1},${y1 + 8} L${x0 + 14},${y0} Z" fill="#a78bfa" opacity="0.5" filter="url(#glow)"/>`; })(),
});
// Tungsten Resistojet: an electrically heated tungsten coil glowing in the nozzle.
ART['rob_tungsten_resistojet:primary'] = () => missileScene('rob_tungsten_resistojet:primary', 50, {
  bg: ['#261a12', '#060403'], plumeColor: '#fb923c', craftOpts: { nose: 'cone', legs: true, accent: '#f59e0b', extra: `<path d="M-8,4 q4,-6 8,0 q4,6 8,0" stroke="#fde68a" stroke-width="2" fill="none" filter="url(#glow)"/>` },
});
// MITEE Arcjet: a miniature reactor feeding an electric arc, a blue-violet jet.
ART['rob_tungsten_resistojet:secondary'] = () => missileScene('rob_tungsten_resistojet:secondary', 51, {
  bg: ['#141432', '#03030a'], plumeColor: '#818cf8', craftOpts: { nose: 'cone', accent: '#6366f1', extra: `<rect x="-10" y="-58" width="20" height="14" rx="3" fill="#facc15"/><circle cx="0" cy="-51" r="3" fill="#1e1b4b"/>` },
});

// BUGGY scene: a rover on the surface of a big asteroid.
function buggyScene(key, seed, { bg, rov, extra = '', pre = '' }) {
  const [card, face] = key.split(':');
  const pal = spectral(card, face);
  const b = space(bg[0], bg[1], '50%', '20%');
  return svg(b.defs, `${b.body}${stars(55, seed)}${ground(pal, seed)}${pre}${rover(rov)}${extra}`);
}

// Cat Fusion Z-pinch Torch: a rover cutting rock with a violet pinch-plasma torch.
ART['rob_cat_fusion_z_pinch_torch:primary'] = () => buggyScene('rob_cat_fusion_z_pinch_torch:primary', 61, {
  bg: ['#1d1430', '#040209'],
  rov: { x: 130, y: 226, tool: `<path d="M40,-24 L66,-10 L72,8" stroke="#9aa3b2" stroke-width="4" fill="none"/><circle cx="72" cy="10" r="10" fill="#c084fc" filter="url(#glow)"/><circle cx="72" cy="10" r="4" fill="#fff"/>` },
  extra: `<ellipse cx="200" cy="240" rx="22" ry="7" fill="#e879f9" opacity="0.5" filter="url(#soft)"/>`,
});
// Flywheel Tractor: a heavy tracked tractor storing energy in a big spinning flywheel.
ART['rob_flywheel_tractor:primary'] = () => buggyScene('rob_flywheel_tractor:primary', 62, {
  bg: ['#1a1f2c', '#040507'],
  rov: { x: 140, y: 230, s: 1.15, tracks: true, body: '#d9c27a', tool: `<ellipse cx="6" cy="-50" rx="30" ry="9" fill="#5b6475" stroke="#cbd5e1" stroke-width="2"/><ellipse cx="6" cy="-50" rx="18" ry="5" fill="none" stroke="#7dd3fc" stroke-width="2" stroke-dasharray="6 4"/><path d="M-36,-30 L-56,-6" stroke="#9aa3b2" stroke-width="5"/><path d="M-60,-8 L-48,10 L-70,10 Z" fill="#9aa3b2"/>` },
});
// Electrophoretic Sandworm: a segmented worm-robot swimming through charged regolith.
ART['rob_flywheel_tractor:secondary'] = () => {
  const pal = spectral('rob_flywheel_tractor', 'secondary');
  const b = space('#1c1426', '#040207', '50%', '20%');
  let segs = '';
  for (let i = 0; i < 9; i++) {
    const x = 60 + i * 20, y = 232 + Math.sin(i * 0.9) * 10;
    segs += `<ellipse cx="${x}" cy="${f(y)}" rx="13" ry="12" fill="#a78bfa" stroke="#5b21b6" stroke-width="1.5"/><ellipse cx="${x}" cy="${f(y - 4)}" rx="7" ry="3" fill="#ede9fe" opacity="0.6"/>`;
  }
  return svg(b.defs, `${b.body}${stars(55, 63)}${ground(pal, 63)}
    <path d="M44,236 Q60,214 80,228" stroke="#c4b5fd" stroke-width="1.5" fill="none" opacity="0.7"/>
    ${segs}
    <circle cx="232" cy="${f(232 + Math.sin(9 * 0.9) * 10)}" r="14" fill="#7c3aed"/><circle cx="238" cy="${f(228 + Math.sin(9 * 0.9) * 10)}" r="3" fill="#f0abfc" filter="url(#glow)"/>
    ${[0, 1, 2, 3, 4].map((i) => `<path d="M${70 + i * 34},218 l4,-10 l-6,4 l4,-10" stroke="#e9d5ff" stroke-width="1.2" fill="none" filter="url(#glow)"/>`).join('')}`);
};
// Nanobot: a swarm of tiny glowing machines spreading over the surface.
ART['rob_met_steamer:secondary'] = () => {
  const pal = spectral('rob_met_steamer', 'secondary');
  const b = space('#0c1a20', '#020506', '50%', '20%');
  const rnd = seeded(64);
  let bots = '';
  for (let i = 0; i < 70; i++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 80;
    const x = 160 + Math.cos(a) * d * 1.6, y = 246 + Math.sin(a) * d * 0.35;
    bots += `<rect x="${f(x - 2)}" y="${f(y - 1.5)}" width="4" height="3" fill="#5eead4" filter="url(#glow)" opacity="${f(1 - d / 100)}"/>`;
  }
  return svg(b.defs, `${b.body}${stars(55, 64)}${ground(pal, 64)}
    <ellipse cx="160" cy="246" rx="128" ry="26" fill="#2dd4bf" opacity="0.12" filter="url(#soft)"/>${bots}
    <g transform="translate(70 120) rotate(140) scale(0.45)">${shipBody('probe')}</g>
    <path d="M78,134 L150,236 L170,236 Z" fill="#5eead4" opacity="0.15"/>`);
};
// Rock Splitter: a rover driving a hydraulic wedge into a boulder, cracking it open.
ART['rob_rock_splitter:primary'] = () => buggyScene('rob_rock_splitter:primary', 65, {
  bg: ['#21170f', '#050302'],
  pre: `<path d="M196,234 Q206,182 246,180 Q286,186 286,234 Z" fill="#6b4a34" stroke="#3a2618" stroke-width="2"/>
    <path d="M226,186 L232,204 L222,214 L234,232" stroke="#1b0f08" stroke-width="3" fill="none"/>
    <path d="M232,204 L252,198" stroke="#1b0f08" stroke-width="2" fill="none"/>`,
  rov: { x: 120, y: 230, body: '#f5d0a1', tool: `<path d="M40,-26 L74,-26" stroke="#9aa3b2" stroke-width="7"/><path d="M74,-34 L100,-26 L74,-18 Z" fill="#cbd5e1" stroke="#64748b" stroke-width="1.5"/>` },
});

// Fill any face not yet drawn so the generator never emits a blank.
for (const id of Object.keys(PATENTS_BY_ID).filter((k) => PATENTS_BY_ID[k].type === 'robonaut')) {
  for (const face of ['primary', 'secondary']) {
    if (!ART[`${id}:${face}`]) throw new Error(`robonaut art missing: ${id}:${face}`);
  }
}
