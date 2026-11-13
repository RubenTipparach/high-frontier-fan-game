// Freighter deck art (Module 1): 7 cards x 2 faces. A freighter is a cargo
// hauler with its own drive, so every face bolts its engine to the kit's
// container-stack freighter hull (RIG kind 'freighter'), hull running LEFT,
// exhaust RIGHT. The engines come from Eklund's designer notes (M1 rules
// 1Z1): a steam rocket on a balloon tank, a gas-core sphere, kilometre sails,
// solar balloons and mirror swarms, dirt slings, and Z-pinch fusion. Black
// fronts sit on the dark card (backdrop stripped); purple backs wash through
// the promoted purple. Subjects sit in the open lower half of the card, under
// the load-limit and ability text. See docs/card-art-guide.md.
import { PATENTS_BY_ID } from '../../data/patents.js';
import { f, lin, rad, stars, svg, seeded, rock, ROCK, beam } from './kit.mjs';

export const ART = {};
export const RIG = {};

const Y = 212;   // the engine axis
function scene(key, seed, defs, body) {
  const side = key.split(':')[1];
  const bg = side === 'primary'
    ? `<radialGradient id="bg"><stop offset="0" stop-color="#05060c"/></radialGradient>`
    : `<radialGradient id="bg" cx="50%" cy="44%" r="80%"><stop offset="0%" stop-color="#655ca8"/><stop offset="100%" stop-color="#652d91"/></radialGradient>`;
  return svg(bg + lin('mt', [[0, '#94a3b8'], [0.45, '#e2e8f0'], [1, '#475569']]) + defs,
    `<rect width="300" height="288" fill="url(#bg)"/>${stars(36, seed)}${body}`);
}
const ship = (key, mount, extra = {}) => { RIG[key] = { mount, back: -90, kind: 'freighter', s: 0.5, ...extra }; };
function noz(x, y, len = 40, w0 = 9, w1 = 26) {
  return `<path d="M${x},${y - w0} Q${x + len * 0.6},${y - w0} ${x + len},${y - w1} L${x + len},${y + w1} Q${x + len * 0.6},${y + w0} ${x},${y + w0} Z" fill="url(#mt)" stroke="#1f2937" stroke-width="1.2"/>`;
}
function plume(x, y, len, w, c, id, a = 0.95) {
  return `<defs>${lin(id, [[0, c, a], [1, c, 0]], 0, 0, 1, 0)}</defs><path d="M${x},${y - w * 0.6} Q${x + len * 0.5},${y - w} ${x + len},${y - w * 0.3} L${x + len},${y + w * 0.3} Q${x + len * 0.5},${y + w} ${x},${y + w * 0.6} Z" fill="url(#${id})"/>`;
}
function coil(x, y, ry, c = '#d97706', w = 5) {
  return `<ellipse cx="${x}" cy="${y}" rx="${f(ry * 0.22)}" ry="${ry}" fill="none" stroke="#1f2937" stroke-width="${w + 2}"/><ellipse cx="${x}" cy="${y}" rx="${f(ry * 0.22)}" ry="${ry}" fill="none" stroke="${c}" stroke-width="${w}"/>`;
}
function dirt(x, y, ang, n, seed, spread = 0.25) {
  const rnd = seeded(seed);
  let out = '';
  for (let i = 0; i < n; i++) {
    const d = 10 + i * 9 + rnd() * 6, a = ang + (rnd() - 0.5) * spread;
    out += `<circle cx="${f(x + Math.cos(a) * d)}" cy="${f(y + Math.sin(a) * d)}" r="${f(1.4 + rnd() * 1.8)}" fill="#a16207" opacity="${f(0.95 - i * 0.05)}"/>`;
  }
  return out;
}

// 1. Fission-Heated Steam: a stubby particle-bed reactor drum bolted to a bell,
// fed by a huge thin balloon tank of water; a white steam plume.
ship('fre_fission_heated_steam:primary', [56, Y]);
ART['fre_fission_heated_steam:primary'] = () => scene('fre_fission_heated_steam:primary', 601, rad('bal', [[0, '#f8fafc', 0.9], [0.7, '#cbd5e1', 0.7], [1, '#64748b', 0.8]], '40%', '35%'),
  `<ellipse cx="116" cy="${Y}" rx="60" ry="44" fill="url(#bal)" stroke="#e2e8f0" stroke-width="1"/>
   <rect x="174" y="${Y - 6}" width="10" height="12" fill="#64748b"/>
   <rect x="184" y="${Y - 16}" width="26" height="32" rx="5" fill="#475569" stroke="#fb923c" stroke-width="1.5"/>
   ${noz(210, Y, 34, 8, 22)}${plume(244, Y, 56, 30, '#f1f5f9', 'p1', 0.8)}`);
// Fission GCR: a sphere in a thick moderator shell, a ring coil at each end
// (the rear one smaller so the field leaks), violet plasma inside, a blue jet.
ship('fre_fission_heated_steam:secondary', [96, Y]);
ART['fre_fission_heated_steam:secondary'] = () => scene('fre_fission_heated_steam:secondary', 602, rad('gcr', [[0, '#ffffff'], [0.35, '#c4b5fd'], [1, '#6d28d9', 0.4]]),
  `<circle cx="160" cy="${Y}" r="46" fill="#334155" stroke="#cbd5e1" stroke-width="2"/>
   <circle cx="160" cy="${Y}" r="30" fill="url(#gcr)"/>
   ${coil(110, Y, 36)}${coil(208, Y, 26)}
   ${plume(212, Y, 80, 14, '#bfdbfe', 'p2')}`);

// 2. Fusion Fragment Sail: a kilometre-wide two-layer disc, dark absorber
// speckled with warm radioactive dust, the freighter hanging on shroud lines.
ship('fre_fusion_fragment_sail:primary', [120, Y]);
ART['fre_fusion_fragment_sail:primary'] = () => scene('fre_fusion_fragment_sail:primary', 603, '',
  (() => {
    const rnd = seeded(603);
    let dust = '';
    for (let i = 0; i < 40; i++) { const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()); dust += `<circle cx="${f(236 + Math.cos(a) * r * 22)}" cy="${f(Y + Math.sin(a) * r * 80)}" r="1.2" fill="#fdba74" opacity="${f(0.4 + rnd() * 0.5)}"/>`; }
    return `${[-76, -40, 0, 40, 76].map((d) => `<line x1="120" y1="${Y}" x2="232" y2="${Y + d}" stroke="#94a3b8" stroke-width="0.8"/>`).join('')}
      <ellipse cx="240" cy="${Y}" rx="26" ry="84" fill="#78716c" opacity="0.7"/>
      <ellipse cx="236" cy="${Y}" rx="24" ry="84" fill="#1c1917" stroke="#a8a29e" stroke-width="1.5"/>${dust}
      ${[-60, 60].map((d) => `<rect x="228" y="${Y + d - 6}" width="10" height="12" fill="#e7e5e4" opacity="0.7"/>`).join('')}`;
  })());
// Antiproton Sail and Harvester: a charged carbon disc with nested wire-mesh
// spheres at its focus, a magenta annihilation sparkle.
ship('fre_fusion_fragment_sail:secondary', [116, Y]);
ART['fre_fusion_fragment_sail:secondary'] = () => scene('fre_fusion_fragment_sail:secondary', 604, '',
  `${[-70, 0, 70].map((d) => `<line x1="116" y1="${Y}" x2="244" y2="${Y + d}" stroke="#c4b5fd" stroke-width="0.8"/>`).join('')}
   <ellipse cx="248" cy="${Y}" rx="22" ry="82" fill="#1e1b4b" stroke="#a5b4fc" stroke-width="1.5"/>
   ${[30, 22, 14].map((r) => `<circle cx="196" cy="${Y}" r="${r}" fill="none" stroke="#e0e7ff" stroke-width="1" stroke-dasharray="3 2"/>`).join('')}
   <circle cx="196" cy="${Y}" r="4" fill="#f0abfc" filter="url(#glow)"/>
   <path d="M244,${Y - 40} l6,-6 m-6,0 l6,6" stroke="#f0abfc" stroke-width="2" filter="url(#glow)"/>
   ${[...Array(5)].map((_, i) => `<path d="M300,${150 + i * 26} q-18,4 -40,2" stroke="#f472b6" stroke-width="1" fill="none" stroke-dasharray="2 3" opacity="0.7"/>`).join('')}`);

// 3. HIIPER Beam Rider: a big flat receiver sail lit by a laser from below, a
// small helicon tube and spherical IEC grid on its axis, a faint ion plume.
ship('fre_hiiper_beam_rider:primary', [104, Y]);
ART['fre_hiiper_beam_rider:primary'] = () => scene('fre_hiiper_beam_rider:primary', 605, '',
  `${beam(300, 286, 170, Y + 40, '#4ade80', 2)}
   <ellipse cx="170" cy="${Y}" rx="16" ry="74" fill="#1e3a8a" stroke="#93c5fd" stroke-width="1.5"/>
   ${[-50, -25, 0, 25, 50].map((d) => `<line x1="158" y1="${Y + d}" x2="182" y2="${Y + d}" stroke="#60a5fa" stroke-width="0.7"/>`).join('')}
   <rect x="104" y="${Y - 6}" width="50" height="12" rx="4" fill="#e0f2fe" opacity="0.8" stroke="#0e7490"/>
   ${[0, 1, 2, 3, 4].map((i) => `<line x1="${108 + i * 10}" y1="${Y - 8}" x2="${114 + i * 10}" y2="${Y + 8}" stroke="#d97706" stroke-width="1.6"/>`).join('')}
   <circle cx="210" cy="${Y}" r="16" fill="none" stroke="#cbd5e1" stroke-width="1.2"/><ellipse cx="210" cy="${Y}" rx="7" ry="16" fill="none" stroke="#cbd5e1"/><line x1="194" y1="${Y}" x2="226" y2="${Y}" stroke="#cbd5e1"/>
   ${plume(226, Y, 74, 10, '#a78bfa', 'p3')}`);
// Magnetic Mirror Beam Rider: a giant shielded stern hoop and a smaller
// forward ring; a pellet stream rises from behind and sprays back out of it.
ship('fre_hiiper_beam_rider:secondary', [110, Y]);
ART['fre_hiiper_beam_rider:secondary'] = () => scene('fre_hiiper_beam_rider:secondary', 606, '',
  `${coil(150, Y, 34, '#d97706', 6)}${coil(232, Y, 70, '#d97706', 9)}
   <line x1="150" y1="${Y}" x2="232" y2="${Y}" stroke="#94a3b8" stroke-width="2"/>
   <rect x="124" y="${Y - 22}" width="10" height="44" fill="#0ea5e9" opacity="0.6"/>
   ${[...Array(8)].map((_, i) => `<circle cx="${300 - i * 8}" cy="${Y + 6 - i * 0.5}" r="2" fill="#fde047"/>`).join('')}
   ${[-1, 1].map((s) => [...Array(6)].map((_, i) => `<circle cx="${244 + i * 9}" cy="${Y + s * (18 + i * 8)}" r="1.6" fill="#fde047" opacity="${f(0.9 - i * 0.12)}"/>`).join('')).join('')}`);

// 4. Inflatable Solar-Heated: a big silver lens-shaped balloon, mirrored
// inside, focusing a sunbeam cone onto a white-hot absorber and small nozzle.
ship('fre_inflatable_solar_heated:primary', [100, Y]);
ART['fre_inflatable_solar_heated:primary'] = () => scene('fre_inflatable_solar_heated:primary', 607, lin('lens', [[0, '#f8fafc'], [0.5, '#94a3b8'], [1, '#e2e8f0']], 0, 0, 1, 0),
  `<circle cx="320" cy="140" r="60" fill="#fde68a" opacity="0.35" filter="url(#soft)"/>
   <path d="M252,${Y - 78} Q226,${Y} 252,${Y + 78} Q278,${Y} 252,${Y - 78} Z" fill="url(#lens)" stroke="#e2e8f0" stroke-width="1"/>
   <path d="M246,${Y - 70} L150,${Y} L246,${Y + 70} Z" fill="#fde68a" opacity="0.18"/>
   <line x1="100" y1="${Y}" x2="150" y2="${Y}" stroke="#94a3b8" stroke-width="3"/><line x1="160" y1="${Y}" x2="236" y2="${Y}" stroke="#94a3b8" stroke-width="1.5"/>
   <circle cx="150" cy="${Y}" r="9" fill="#fffbeb" filter="url(#glow)"/>
   <path d="M144,${Y + 6} l-6,26 l12,0 Z" fill="url(#mt)"/>${`<path d="M144,${Y + 32} l-8,30 l16,0 Z" fill="#e0f2fe" opacity="0.4"/>`}`);
// Archimedes Palmer Lens: a loose swarm of flat mirror tiles held by two thin
// lasers, all reflecting onto one glowing carbon-foam absorber.
ship('fre_inflatable_solar_heated:secondary', [104, Y]);
ART['fre_inflatable_solar_heated:secondary'] = () => scene('fre_inflatable_solar_heated:secondary', 608, '',
  (() => {
    const rnd = seeded(608);
    let tiles = '', rays = '';
    for (let i = 0; i < 16; i++) {
      const x = 196 + rnd() * 96, y = Y - 80 + rnd() * 160;
      tiles += `<rect x="${f(x - 5)}" y="${f(y - 2)}" width="10" height="4" fill="#e2e8f0" transform="rotate(${f(-30 + rnd() * 60)} ${f(x)} ${f(y)})"/>`;
      if (i % 2) rays += `<line x1="${f(x)}" y1="${f(y)}" x2="150" y2="${Y}" stroke="#fde68a" stroke-width="0.6" opacity="0.5"/>`;
    }
    return `${rays}${tiles}<line x1="150" y1="40" x2="290" y2="${Y - 20}" stroke="#4ade80" stroke-width="0.8"/><line x1="150" y1="284" x2="290" y2="${Y + 20}" stroke="#4ade80" stroke-width="0.8"/>
      <line x1="104" y1="${Y}" x2="140" y2="${Y}" stroke="#94a3b8" stroke-width="3"/>
      <rect x="138" y="${Y - 10}" width="20" height="20" rx="3" fill="#fb923c" filter="url(#glow)"/>
      <path d="M144,${Y + 10} l-6,22 l14,0 Z" fill="url(#mt)"/>`;
  })());

// 5. Poodle Steam: the simplest drive in the deck - a small heater block of
// polonium capsules glowing dull red, a water tank, a plain nozzle, a wisp.
ship('fre_poodle_steam:primary', [100, Y]);
ART['fre_poodle_steam:primary'] = () => scene('fre_poodle_steam:primary', 609, '',
  `<rect x="100" y="${Y - 22}" width="60" height="44" rx="14" fill="url(#mt)" stroke="#1f2937"/>
   <rect x="160" y="${Y - 12}" width="30" height="24" rx="4" fill="#7f1d1d" stroke="#ef4444" stroke-width="1.5" filter="url(#glow)"/>
   ${[0, 1, 2].map((i) => `<circle cx="${168 + i * 7}" cy="${Y}" r="2.4" fill="#fca5a5"/>`).join('')}
   ${noz(190, Y, 30, 6, 16)}${plume(220, Y, 70, 12, '#e2e8f0', 'p5', 0.6)}`);
// D-Nanotube Dirt Launcher: a hairline carbon-nanotube loop shaped like a
// capital D, a little cable car running it, dirt flying off the curve.
ship('fre_poodle_steam:secondary', [96, Y]);
ART['fre_poodle_steam:secondary'] = () => scene('fre_poodle_steam:secondary', 610, '',
  `<path d="M150,${Y - 80} L150,${Y + 80} A80,80 0 0 0 150,${Y - 80} Z" fill="none" stroke="#e2e8f0" stroke-width="1.2"/>
   <line x1="96" y1="${Y}" x2="150" y2="${Y}" stroke="#94a3b8" stroke-width="2.5"/>
   <rect x="${f(150 + Math.cos(-0.9) * 80 - 5)}" y="${f(Y + Math.sin(-0.9) * 80 - 4)}" width="10" height="8" rx="2" fill="#fbbf24"/>
   ${dirt(150 + Math.cos(-0.2) * 80, Y + Math.sin(-0.2) * 80, Math.PI / 2 - 0.2, 8, 610, 0.15)}`);

// 6. Rotary Dirt Launcher: two counter-rotating tapered Kevlar arms on hubs,
// motion arcs turning opposite ways, brown pellets leaving each tip.
ship('fre_rotary_dirt_launcher:primary', [96, Y]);
ART['fre_rotary_dirt_launcher:primary'] = () => scene('fre_rotary_dirt_launcher:primary', 611, '',
  `<line x1="96" y1="${Y}" x2="210" y2="${Y}" stroke="#94a3b8" stroke-width="3"/>
   ${[[150, Y - 34, 1], [196, Y + 34, -1]].map(([x, y, s]) => `<path d="M${x - 62},${y + s * 6} L${x + 62},${y - s * 6} L${x + 62},${y - s * 2} L${x - 62},${y + s * 10} Z" fill="#d6d3d1" stroke="#57534e" stroke-width="1"/><circle cx="${x}" cy="${y}" r="9" fill="#475569" stroke="#cbd5e1"/>
      <path d="M${x - 50},${y - s * 26} A56,30 0 0 ${s > 0 ? 1 : 0} ${x + 50},${y - s * 26}" fill="none" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="3 4" opacity="0.6"/>
      ${dirt(x + 62, y - s * 4, s > 0 ? -0.3 : 0.3, 7, 611 + s, 0.2)}`).join('')}`);
// KESTS Hoop Dirt Launcher: two giant thin hoops arching off a rubble-pile
// asteroid's equator like handles, held open by mass streams, flinging dirt.
ship('fre_rotary_dirt_launcher:secondary', [96, Y + 30], { s: 0.42 });
ART['fre_rotary_dirt_launcher:secondary'] = () => scene('fre_rotary_dirt_launcher:secondary', 612, '',
  `${rock(150, Y + 34, 46, ROCK.C, 612)}
   ${[[-1, 0.9], [1, 0.9]].map(([s]) => `<ellipse cx="${150 + s * 70}" cy="${Y - 20}" rx="70" ry="56" fill="none" stroke="#e2e8f0" stroke-width="1.6" transform="rotate(${s * -20} ${150 + s * 70} ${Y - 20})"/>
      <ellipse cx="${150 + s * 70}" cy="${Y - 20}" rx="70" ry="56" fill="none" stroke="#a16207" stroke-width="1" stroke-dasharray="2 5" transform="rotate(${s * -20} ${150 + s * 70} ${Y - 20})"/>`).join('')}
   ${dirt(232, 128, -0.8, 7, 612, 0.2)}`);

// 7. Z-Pinch D-T / 6Li: a long ship with Marx capacitor banks forward, an
// annular nozzle firing a fuel column inside a lithium sleeve, a pink-white
// pulse flash in the magnetic nozzle.
ship('fre_z_pinch_d_t_6li_fusion:primary', [92, Y]);
ART['fre_z_pinch_d_t_6li_fusion:primary'] = () => scene('fre_z_pinch_d_t_6li_fusion:primary', 613, rad('zp', [[0, '#ffffff'], [0.35, '#f9a8d4'], [1, '#db2777', 0]]),
  `${[0, 1, 2, 3].map((i) => `<rect x="${94 + i * 18}" y="${Y - 30}" width="14" height="24" rx="2" fill="#475569" stroke="#cbd5e1"/><rect x="${94 + i * 18}" y="${Y + 6}" width="14" height="24" rx="2" fill="#475569" stroke="#cbd5e1"/>`).join('')}
   <rect x="166" y="${Y - 10}" width="28" height="20" rx="3" fill="#0e7490" stroke="#67e8f9"/>
   <path d="M194,${Y - 12} Q214,${Y - 14} 238,${Y - 40} L238,${Y + 40} Q214,${Y + 14} 194,${Y + 12} Z" fill="none" stroke="#d97706" stroke-width="3"/>
   ${[206, 220, 234].map((x, i) => coil(x, Y, 16 + i * 9, '#d97706', 3)).join('')}
   <circle cx="214" cy="${Y}" r="20" fill="url(#zp)"/>
   ${plume(238, Y, 62, 30, '#f9a8d4', 'p7', 0.7)}`);
// Z-Pinch 3He-D Target: a ring of flux-compression generators converging on
// a silver lithium liner that bursts into a cleaner blue exhaust.
ship('fre_z_pinch_d_t_6li_fusion:secondary', [96, Y]);
ART['fre_z_pinch_d_t_6li_fusion:secondary'] = () => scene('fre_z_pinch_d_t_6li_fusion:secondary', 614, rad('lr', [[0, '#ffffff'], [0.6, '#cbd5e1'], [1, '#64748b']], '35%', '35%'),
  `<line x1="96" y1="${Y}" x2="160" y2="${Y}" stroke="#94a3b8" stroke-width="3"/><rect x="132" y="${Y - 8}" width="20" height="16" rx="3" fill="#475569" stroke="#cbd5e1"/>
   ${[...Array(8)].map((_, i) => { const a = i * Math.PI / 4; return `<rect x="${f(196 + Math.cos(a) * 30 - 6)}" y="${f(Y + Math.sin(a) * 30 - 4)}" width="12" height="8" rx="2" fill="#d97706" stroke="#1f2937" transform="rotate(${i * 45} ${f(196 + Math.cos(a) * 30)} ${f(Y + Math.sin(a) * 30)})"/>`; }).join('')}
   <circle cx="196" cy="${Y}" r="12" fill="url(#lr)"/>
   ${coil(240, Y, 30, '#d97706', 3)}${plume(240, Y, 60, 22, '#93c5fd', 'p8')}`);

for (const p of Object.values(PATENTS_BY_ID)) {
  if (p.type !== 'freighter') continue;
  for (const side of ['primary', 'secondary']) {
    if (!ART[`${p.id}:${side}`]) throw new Error(`freighter art missing: ${p.id}:${side}`);
  }
}
