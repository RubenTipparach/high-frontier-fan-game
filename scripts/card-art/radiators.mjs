// Radiator deck art: 12 cards x 2 faces. A radiator card is two-headed (light
// side up, heavy side up) and the whole card turns 180 degrees to flip it, so
// the art sits in the band BETWEEN the two half-cards (css .is-radiator
// .has-bg-art) and is drawn point-symmetric about the centre: it reads the same
// either way up. Each face draws ITS heat-rejection device from research (HF
// card texts reprinted on Atomic Rockets' heat-radiator page, plus the real
// technology). Thermal glow follows temperature: dull red ~900 K, orange
// ~1200 K, yellow-white 1450 K and up; X-ray faces use violet-white rays.
// See docs/card-art-guide.md.
import { PATENTS_BY_ID } from '../../data/patents.js';
import { f, lin, rad, stars, seeded } from './kit.mjs';

export const ART = {};
export const RIG = {};

const W = 300, H = 204, CX = 150, CY = 102;

function svg(defs, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7"/></filter>
  ${defs}
</defs>
${body}
</svg>
`;
}
// Black-face backdrop (stripped from white faces by the generator).
function back(c1, c2, seed) {
  return {
    defs: `<radialGradient id="bg" cx="50%" cy="50%" r="80%"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></radialGradient>`,
    body: `<rect width="300" height="204" fill="url(#bg)"/>${stars(30, seed)}`,
  };
}
// Draw `inner` and its 180-degree copy about the centre.
const both = (inner) => `${inner}<g transform="rotate(180 ${CX} ${CY})">${inner}</g>`;
const HOT = { red: '#b91c1c', orange: '#f97316', yellow: '#fde68a', white: '#fffbeb' };
const STEEL = (id) => lin(id, [[0, '#4b5563'], [0.45, '#d1d5db'], [1, '#374151']]);
function hub(r = 14, fill = '#64748b') {
  return `<circle cx="${CX}" cy="${CY}" r="${r}" fill="${fill}" stroke="#cbd5e1" stroke-width="1.5"/><circle cx="${CX}" cy="${CY}" r="${f(r * 0.4)}" fill="#1f2937"/>`;
}
function scene(card, face, seed, bg, defs, body) {
  const b = back(bg[0], bg[1], seed);
  return svg(b.defs + defs, b.body + body);
}

// 1. Bubble Membrane: a spinning balloon, hot liquid film running to a glowing
// equator band, on a spin shaft through the poles.
ART['rad_bubble_membrane:primary'] = () => scene('rad_bubble_membrane', 'primary', 301, ['#1a1428', '#05040a'],
  rad('bub', [[0, '#ffffff', 0.15], [0.7, '#e0f2fe', 0.25], [1, '#93c5fd', 0.5]], '40%', '35%') + lin('eq', [[0, '#7f1d1d'], [0.5, '#fb923c'], [1, '#7f1d1d']], 0, 0, 1, 0),
  `<line x1="${CX}" y1="6" x2="${CX}" y2="198" stroke="#64748b" stroke-width="4"/>
   <circle cx="${CX}" cy="${CY}" r="78" fill="url(#bub)" stroke="#bae6fd" stroke-width="1.5"/>
   <ellipse cx="${CX}" cy="${CY}" rx="78" ry="14" fill="none" stroke="url(#eq)" stroke-width="9" filter="url(#glow)"/>
   ${both(`<path d="M${CX - 60},${CY - 50} A78,78 0 0 1 ${CX + 60},${CY - 50}" stroke="#fdba74" stroke-width="1.5" fill="none" opacity="0.5"/><path d="M${CX - 88},${CY - 14} q-8,-6 -14,-2" stroke="#e0f2fe" stroke-width="1.5" fill="none"/>`)}
   <rect x="${CX - 8}" y="6" width="16" height="12" rx="3" fill="#475569"/><rect x="${CX - 8}" y="186" width="16" height="12" rx="3" fill="#475569"/>`);
// Electrostatic Membrane: a squashed spinning puck; the coolant film held to
// its inner walls by an electric field (concentric field lines).
ART['rad_bubble_membrane:secondary'] = () => scene('rad_bubble_membrane', 'secondary', 302, ['#101a2c', '#03050a'],
  rad('puck', [[0, '#fb923c', 0.85], [0.6, '#b91c1c', 0.5], [1, '#1e293b', 0.6]]),
  `<ellipse cx="${CX}" cy="${CY}" rx="128" ry="46" fill="url(#puck)" stroke="#cbd5e1" stroke-width="2"/>
   ${[100, 74, 48].map((rx) => `<ellipse cx="${CX}" cy="${CY}" rx="${rx}" ry="${f(rx * 0.36)}" fill="none" stroke="#a5b4fc" stroke-width="1.2" stroke-dasharray="4 3" opacity="0.8"/>`).join('')}
   ${hub(12)}
   ${both(`<path d="M${CX + 128},${CY} q8,-10 0,-20" stroke="#e0f2fe" stroke-width="1.5" fill="none"/>`)}`);

// 2. Dielectric X-Ray Window: an armoured reaction chamber; X-rays stream out
// through violet portholes on either side. No fins at all.
ART['rad_dielectric_x_ray_window:primary'] = () => scene('rad_dielectric_x_ray_window', 'primary', 303, ['#140f28', '#030208'],
  STEEL('arm'),
  `${both(`${[-24, 0, 24].map((d) => `<path d="M${CX + 36},${CY + d} L${CX + 146},${CY + d * 3.2 - 18} L${CX + 146},${CY + d * 3.2 + 18} Z" fill="#c4b5fd" opacity="0.22"/><line x1="${CX + 36}" y1="${CY + d}" x2="${CX + 146}" y2="${CY + d * 3.2}" stroke="#ede9fe" stroke-width="1.2" opacity="0.8"/>`).join('')}
     ${[-24, 0, 24].map((d) => `<circle cx="${CX + 34}" cy="${CY + d}" r="7" fill="#a78bfa" stroke="#e9d5ff" stroke-width="1.5" filter="url(#glow)"/>`).join('')}`)}
   <rect x="${CX - 36}" y="${CY - 46}" width="72" height="92" rx="16" fill="url(#arm)" stroke="#1f2937" stroke-width="2"/>
   ${both(`<rect x="${CX - 26}" y="${CY - 40}" width="52" height="5" fill="#374151"/>`)}`);
// Graphene Crystal X-Ray Mirror: nested grazing-incidence shells either side
// of the source, X-rays glancing off them at shallow angles.
ART['rad_dielectric_x_ray_window:secondary'] = () => scene('rad_dielectric_x_ray_window', 'secondary', 304, ['#140f28', '#030208'],
  '',
  `<circle cx="${CX}" cy="${CY}" r="12" fill="#ede9fe" filter="url(#glow)"/>
   ${both(`${[16, 26, 36].map((r) => `<path d="M${CX + 24},${CY - r} L${CX + 120},${CY - r * 1.5} M${CX + 24},${CY + r} L${CX + 120},${CY + r * 1.5}" stroke="#1f2937" stroke-width="4"/><path d="M${CX + 24},${CY - r} L${CX + 120},${CY - r * 1.5}" stroke="#475569" stroke-width="1.5"/>`).join('')}
     ${[-10, 4, 18].map((d) => `<path d="M${CX + 10},${CY} L${CX + 70},${CY - 22 - d * 0.4} L${CX + 146},${CY - 4 + d}" stroke="#c4b5fd" stroke-width="1.2" fill="none" opacity="0.85"/>`).join('')}`)}`);

// 3. ETHER Charged Dust: hot charged dust flung from an emitter flies elliptical
// loops out and back to a collector, glowing as it goes.
ART['rad_ether_charged_dust:primary'] = () => {
  const rnd = seeded(305);
  let dust = '';
  for (let i = 0; i < 110; i++) {
    const t = rnd() * Math.PI * 2, k = rnd() < 0.5 ? 1 : 0.62;
    const x = CX + Math.cos(t) * 130 * k, y = CY + Math.sin(t) * 64 * k;
    const heat = (Math.cos(t) + 1) / 2;
    dust += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(1 + rnd() * 1.4)}" fill="${heat > 0.5 ? '#fb923c' : '#b91c1c'}" opacity="${f(0.6 + rnd() * 0.4)}"/>`;
  }
  return scene('rad_ether_charged_dust', 'primary', 305, ['#1a1216', '#050304'], '',
    `${[1, 0.62].map((k) => `<ellipse cx="${CX}" cy="${CY}" rx="${130 * k}" ry="${64 * k}" fill="none" stroke="#fdba74" stroke-width="1" stroke-dasharray="3 4" opacity="0.5"/>`).join('')}
     ${dust}${hub(16)}`);
};
// Curie Point: iron dust flung out in a glowing two-armed spiral, cooling from
// yellow at the hub to grey at the rim, swept back in by the boom magnet.
ART['rad_ether_charged_dust:secondary'] = () => {
  let arms = '';
  for (let k = 0; k < 2; k++) for (let i = 0; i < 60; i++) {
    const t = i / 60, a = k * Math.PI + t * Math.PI * 2.4, r = 14 + t * 120;
    const col = t < 0.3 ? '#fde68a' : t < 0.6 ? '#f97316' : t < 0.85 ? '#991b1b' : '#57534e';
    arms += `<circle cx="${f(CX + Math.cos(a) * r)}" cy="${f(CY + Math.sin(a) * r * 0.5)}" r="${f(2.6 - t * 1.4)}" fill="${col}"/>`;
  }
  return scene('rad_ether_charged_dust', 'secondary', 306, ['#1a1410', '#050403'], '',
    `${arms}${hub(13)}${both(`<line x1="${CX + 12}" y1="${CY}" x2="${CX + 96}" y2="${CY}" stroke="#94a3b8" stroke-width="2"/><circle cx="${CX + 98}" cy="${CY}" r="6" fill="#475569" stroke="#e3954f" stroke-width="2"/>`)}`);
};

// 4. Li Heatsink Fountain: tanks of lithium that boil off once, venting
// silvery fountains of vapour - a one-shot heat sink.
ART['rad_li_heatsink_fountain:primary'] = () => scene('rad_li_heatsink_fountain', 'primary', 307, ['#141a24', '#030507'],
  // Slate-blue vapour (not white): this is the cream white face, where a pale
  // plume vanishes.
  STEEL('tk') + lin('plume', [[0, '#334155', 0.95], [0.6, '#64748b', 0.6], [1, '#94a3b8', 0]], 0, 0, 1, 0),
  `${both(`<path d="M${CX + 40},${CY - 6} Q${CX + 90},${CY - 40} ${CX + 148},${CY - 30} L${CX + 148},${CY + 20} Q${CX + 90},${CY + 10} ${CX + 40},${CY + 6} Z" fill="url(#plume)"/>
     <path d="M${CX + 44},${CY - 2} Q${CX + 92},${CY - 22} ${CX + 140},${CY - 14}" stroke="#1e293b" stroke-width="1.4" stroke-dasharray="4 4" fill="none" opacity="0.7"/>
     ${[[70, -16], [92, -8], [112, -20], [128, 4], [100, 6], [140, -6]].map(([x, y]) => `<circle cx="${CX + x}" cy="${CY + y}" r="2.2" fill="#334155" opacity="0.75"/>`).join('')}
     <rect x="${CX + 4}" y="${CY - 30}" width="34" height="60" rx="12" fill="url(#tk)"/><rect x="${CX + 36}" y="${CY - 5}" width="8" height="10" fill="#94a3b8"/>`)}`);
// Thermochemical Heatsink Fountain: a can packed with salt capsules that
// absorb heat chemically, venting a white condensate plume.
ART['rad_li_heatsink_fountain:secondary'] = () => scene('rad_li_heatsink_fountain', 'secondary', 308, ['#141a24', '#030507'],
  lin('plume2', [[0, '#ffffff', 0.85], [1, '#e2e8f0', 0]], 0, 0, 1, 0),
  `${both(`<path d="M${CX + 54},${CY - 4} Q${CX + 100},${CY - 30} ${CX + 148},${CY - 22} L${CX + 148},${CY + 14} Q${CX + 100},${CY + 8} ${CX + 54},${CY + 4} Z" fill="url(#plume2)"/>`)}
   <rect x="${CX - 54}" y="${CY - 40}" width="108" height="80" rx="10" fill="#334155" stroke="#cbd5e1" stroke-width="2"/>
   ${[...Array(5)].map((_, r) => [...Array(9)].map((_, c) => `<circle cx="${CX - 44 + c * 11}" cy="${CY - 28 + r * 14}" r="4.4" fill="${(r + c) % 3 ? '#e2e8f0' : '#fbbf24'}" stroke="#64748b" stroke-width="0.6"/>`).join('')).join('')}`);

// 5. Magnetocaloric Refrigerator: a wheel of gadolinium beds turning through
// the gaps of two magnets - warm orange where magnetised, cold blue elsewhere.
ART['rad_magnetocaloric_refrigerator:primary'] = () => {
  let segs = '';
  for (let i = 0; i < 16; i++) {
    const a0 = i * Math.PI / 8, a1 = a0 + Math.PI / 8 - 0.05;
    const inGap = Math.abs(Math.cos(a0 + Math.PI / 16)) > 0.85;
    segs += `<path d="M${f(CX + 30 * Math.cos(a0))},${f(CY + 30 * Math.sin(a0))} L${f(CX + 70 * Math.cos(a0))},${f(CY + 70 * Math.sin(a0))} A70,70 0 0 1 ${f(CX + 70 * Math.cos(a1))},${f(CY + 70 * Math.sin(a1))} L${f(CX + 30 * Math.cos(a1))},${f(CY + 30 * Math.sin(a1))} Z" fill="${inGap ? '#f97316' : '#38bdf8'}" opacity="0.85" stroke="#1f2937" stroke-width="1"/>`;
  }
  return scene('rad_magnetocaloric_refrigerator', 'primary', 309, ['#101a2a', '#030509'], '',
    `${segs}${hub(18)}${both(`<path d="M${CX + 56},${CY - 40} L${CX + 96},${CY - 40} L${CX + 96},${CY + 40} L${CX + 56},${CY + 40} L${CX + 56},${CY + 26} L${CX + 82},${CY + 26} L${CX + 82},${CY - 26} L${CX + 56},${CY - 26} Z" fill="#b91c1c" stroke="#fecaca" stroke-width="1.5"/>`)}`);
};
// Nuclear Fuel Spin Polarizer: a glass cell where a polarised laser lines up
// the spins of the fuel nuclei (little arrows), so less of the burn ends as heat.
ART['rad_magnetocaloric_refrigerator:secondary'] = () => scene('rad_magnetocaloric_refrigerator', 'secondary', 310, ['#130f28', '#030208'],
  '',
  `<rect x="${CX - 70}" y="${CY - 34}" width="140" height="68" rx="20" fill="#a5b4fc" opacity="0.14" stroke="#c7d2fe" stroke-width="1.5"/>
   <line x1="4" y1="${CY}" x2="296" y2="${CY}" stroke="#f472b6" stroke-width="3" opacity="0.8" filter="url(#glow)"/>
   ${both(`${[[-50, -18], [-24, 14], [6, -14], [34, 16], [54, -6]].map(([dx, dy]) => `<circle cx="${CX + dx}" cy="${CY + dy}" r="5" fill="#e0e7ff"/><path d="M${CX + dx},${CY + dy + 6} L${CX + dx},${CY + dy - 12} M${CX + dx - 3},${CY + dy - 8} L${CX + dx},${CY + dy - 12} L${CX + dx + 3},${CY + dy - 8}" stroke="#fbbf24" stroke-width="1.5" fill="none"/>`).join('')}
     <rect x="${CX + 96}" y="${CY - 14}" width="40" height="28" rx="4" fill="#334155" stroke="#94a3b8" stroke-width="1"/>`)}`);

// 6. Microtube Array: wide wings of hair-thin tubes between header manifolds,
// a faint platinum sheen.
ART['rad_microtube_array:primary'] = () => scene('rad_microtube_array', 'primary', 311, ['#16141c', '#040305'],
  lin('mt', [[0, '#f97316', 0.9], [1, '#7f1d1d', 0.9]], 0, 0, 1, 0),
  `${both(`<rect x="${CX + 14}" y="${CY - 50}" width="130" height="100" fill="url(#mt)" opacity="0.25"/>
     ${[...Array(26)].map((_, i) => `<line x1="${CX + 14}" y1="${CY - 48 + i * 3.8}" x2="${CX + 144}" y2="${CY - 48 + i * 3.8}" stroke="url(#mt)" stroke-width="1.6"/>`).join('')}
     <rect x="${CX + 10}" y="${CY - 54}" width="8" height="108" rx="2" fill="#94a3b8"/><rect x="${CX + 140}" y="${CY - 54}" width="8" height="108" rx="2" fill="#94a3b8"/>
     ${[0, 1].map((k) => `<circle cx="${CX + 60 + k * 40}" cy="${CY - 52}" r="3" fill="#e5e7eb"/>`).join('')}`)}
   ${hub(12)}`);
// Marangoni Flow: grape clusters of glowing liquid-metal bubbles, surface
// colour running hot to cool, pumped by surface tension alone.
ART['rad_microtube_array:secondary'] = () => {
  const rnd = seeded(312);
  let grapes = '';
  for (let i = 0; i < 9; i++) { const x = CX + 44 + rnd() * 90, y = CY - 40 + rnd() * 80; grapes += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(10 + rnd() * 9)}" fill="url(#mar)"/><line x1="${CX + 16}" y1="${CY}" x2="${f(x)}" y2="${f(y)}" stroke="#64748b" stroke-width="1.2"/>`; }
  return scene('rad_microtube_array', 'secondary', 312, ['#1a1214', '#050304'],
    rad('mar', [[0, '#fffbeb'], [0.35, '#fb923c'], [1, '#7f1d1d']], '30%', '30%'),
    `${both(grapes)}${hub(14)}`);
};

// 7. Mo/Li Heat Pipe: a fan of thick molybdenum pipes from a hot manifold,
// white-hot at the root fading to orange at the tips.
ART['rad_mo_li_heat_pipe:primary'] = () => scene('rad_mo_li_heat_pipe', 'primary', 313, ['#1c1410', '#050302'],
  lin('hp', [[0, '#fffbeb'], [0.35, '#fde68a'], [1, '#ea580c']], 0, 0, 1, 0),
  `${both([...Array(7)].map((_, i) => { const a = (-36 + i * 12) * Math.PI / 180; return `<line x1="${CX + 16}" y1="${CY}" x2="${f(CX + 16 + Math.cos(a) * 128)}" y2="${f(CY + Math.sin(a) * 128)}" stroke="url(#hp)" stroke-width="6" stroke-linecap="round" filter="url(#glow)"/>`; }).join(''))}
   ${hub(20, '#fbbf24')}`);
// Tin Droplet: a nozzle bar sprays sheets of molten tin drops, black-coated
// and dull red, out to collector cups at each end.
ART['rad_mo_li_heat_pipe:secondary'] = () => {
  let drops = '';
  for (let k = 0; k < 9; k++) for (let i = 1; i < 14; i++) {
    const t = i / 14, y0 = CY - 40 + k * 10;
    drops += `<circle cx="${f(CX + 18 + t * 110)}" cy="${f(y0 + (CY - y0) * t)}" r="1.5" fill="#dc2626" opacity="${f(0.95 - t * 0.4)}"/>`;
  }
  return scene('rad_mo_li_heat_pipe', 'secondary', 314, ['#160f12', '#040203'], '',
    `${both(`<path d="M${CX + 16},${CY - 44} L${CX + 132},${CY - 4} L${CX + 132},${CY + 4} L${CX + 16},${CY + 44} Z" fill="#fca5a5" opacity="0.08" stroke="#fecaca" stroke-width="0.6"/>${drops}
       <path d="M${CX + 126},${CY - 10} q16,10 0,20 q8,-10 0,-20 Z" fill="#475569" stroke="#cbd5e1" stroke-width="1.5"/>`)}
     <rect x="${CX - 10}" y="${CY - 48}" width="20" height="96" rx="4" fill="#475569" stroke="#cbd5e1" stroke-width="1.5"/>`);
};

// 8. Qu Tube: slim polished copper rods with an uncannily EVEN glow along their
// whole length (no hot-to-cold gradient) - the claimed superconducting pipe.
ART['rad_qu_tube:primary'] = () => scene('rad_qu_tube', 'primary', 315, ['#1a1410', '#050403'],
  lin('cu', [[0, '#fdba74'], [0.5, '#fff7ed'], [1, '#c2621f']]),
  `${both([-36, -12, 12, 36].map((d) => `<rect x="${CX + 16}" y="${CY + d - 4}" width="128" height="8" rx="4" fill="url(#cu)"/><rect x="${CX + 16}" y="${CY + d - 4}" width="128" height="8" rx="4" fill="#fb923c" opacity="0.35" filter="url(#glow)"/>`).join(''))}
   ${hub(18, '#b45309')}`);
// ANDR / In Dream Pipe: a bundle of fine capillaries of liquid indium between
// two reservoirs, sloshed back and forth by a driven piston.
ART['rad_qu_tube:secondary'] = () => scene('rad_qu_tube', 'secondary', 316, ['#111827', '#030507'],
  STEEL('res'),
  `${[...Array(9)].map((_, i) => { const y = CY - 32 + i * 8; return `<line x1="${CX - 110}" y1="${y}" x2="${CX + 110}" y2="${y}" stroke="#64748b" stroke-width="3"/><line x1="${CX - 40 + (i % 3) * 14}" y1="${y}" x2="${CX + 30 + (i % 3) * 14}" y2="${y}" stroke="#e5e7eb" stroke-width="2.4"/>`; }).join('')}
   ${both(`<rect x="${CX + 110}" y="${CY - 44}" width="30" height="88" rx="8" fill="url(#res)"/><path d="M${CX + 70},${CY + 52} q6,-8 12,0 q6,8 12,0 q6,-8 12,0" stroke="#fde68a" stroke-width="1.6" fill="none"/>`)}`);

// 9. SS/NaK Pumped Loop: ladder panels of steel tubes carrying liquid metal at
// a dull red glow; a little crawler robot patrols a tube for meteoroid leaks.
ART['rad_ss_nak_pumped_loop:primary'] = () => scene('rad_ss_nak_pumped_loop', 'primary', 317, ['#1a1214', '#050304'], '',
  `${both(`<rect x="${CX + 18}" y="${CY - 46}" width="124" height="92" fill="#7f1d1d" opacity="0.25"/>
     ${[...Array(8)].map((_, i) => `<line x1="${CX + 18 + i * 17.5}" y1="${CY - 46}" x2="${CX + 18 + i * 17.5}" y2="${CY + 46}" stroke="#b91c1c" stroke-width="3"/>`).join('')}
     <rect x="${CX + 14}" y="${CY - 50}" width="132" height="6" rx="2" fill="#9ca3af"/><rect x="${CX + 14}" y="${CY + 44}" width="132" height="6" rx="2" fill="#9ca3af"/>
     <rect x="${CX + 66}" y="${CY - 8}" width="12" height="9" rx="2" fill="#facc15" stroke="#1f2937" stroke-width="1"/>`)}
   ${hub(14)}`);
// Hula-Hoop: two huge thin washer rings of braided cermet run through a drum
// exchanger and radiate as they turn - orange-white leaving the drum, deep red
// around the far side.
ART['rad_ss_nak_pumped_loop:secondary'] = () => scene('rad_ss_nak_pumped_loop', 'secondary', 318, ['#170f12', '#040203'],
  lin('ring', [[0, '#fde68a'], [0.3, '#f97316'], [0.7, '#991b1b'], [1, '#450a0a']], 0, 0, 1, 0),
  `${[0, 1].map((k) => `<ellipse cx="${CX}" cy="${CY}" rx="${140 - k * 24}" ry="${f((140 - k * 24) * 0.36)}" fill="none" stroke="url(#ring)" stroke-width="7" transform="rotate(${k ? -8 : 8} ${CX} ${CY})"/>`).join('')}
   <rect x="${CX - 16}" y="${CY - 24}" width="32" height="48" rx="8" fill="#475569" stroke="#cbd5e1" stroke-width="1.5"/>`);

// 10. Salt-Cooled Reflux Tube: spokes of fabric-wrapped tubes off a spinning
// hub, molten salt flung out and returned by the spin; hot near the hub.
ART['rad_salt_cooled_reflux_tube:primary'] = () => scene('rad_salt_cooled_reflux_tube', 'primary', 319, ['#16141c', '#040305'],
  lin('cc', [[0, '#f97316'], [0.4, '#44403c'], [1, '#1c1917']], 0, 0, 1, 0),
  `${both([-30, 0, 30].map((deg) => `<g transform="rotate(${deg} ${CX} ${CY})"><rect x="${CX + 16}" y="${CY - 5}" width="124" height="10" rx="5" fill="url(#cc)"/>${[...Array(10)].map((_, i) => `<line x1="${CX + 26 + i * 11}" y1="${CY - 5}" x2="${CX + 32 + i * 11}" y2="${CY + 5}" stroke="#57534e" stroke-width="1"/>`).join('')}</g>`).join(''))}
   ${hub(18, '#9a3412')}`);
// Buckytube Filament: a spinning drum flings out a halo of thin black nanotube
// loops, glowing near the drum and fading out along the loops.
ART['rad_salt_cooled_reflux_tube:secondary'] = () => scene('rad_salt_cooled_reflux_tube', 'secondary', 320, ['#14121c', '#040305'],
  lin('bt', [[0, '#fb923c'], [0.35, '#57534e'], [1, '#27272a']], 0, 0, 1, 0),
  `${both([...Array(7)].map((_, i) => { const a = (-60 + i * 20); return `<g transform="rotate(${a} ${CX} ${CY})"><path d="M${CX + 16},${CY - 3} Q${CX + 100},${CY - 22} ${CX + 126},${CY} Q${CX + 100},${CY + 22} ${CX + 16},${CY + 3}" fill="none" stroke="url(#bt)" stroke-width="1.8"/></g>`; }).join(''))}
   ${hub(16, '#78350f')}`);

// 11. Steel/Pb-Bi Pumped Loop: heavier plumbing than NaK - a pump housing,
// bulky manifolds and dark panels with a dull red glow of lead-bismuth.
ART['rad_steel_pb_bi_pumped_loop:primary'] = () => scene('rad_steel_pb_bi_pumped_loop', 'primary', 321, ['#161212', '#040303'],
  STEEL('pump'),
  `${both(`<rect x="${CX + 34}" y="${CY - 42}" width="108" height="84" fill="#292524" stroke="#57534e" stroke-width="1.5"/>
     ${[...Array(5)].map((_, i) => `<rect x="${CX + 42 + i * 20}" y="${CY - 38}" width="10" height="76" rx="3" fill="#7f1d1d" stroke="#b91c1c" stroke-width="1"/>`).join('')}
     <rect x="${CX + 22}" y="${CY - 50}" width="14" height="100" rx="4" fill="#78716c"/>`)}
   <circle cx="${CX}" cy="${CY}" r="24" fill="url(#pump)" stroke="#1f2937" stroke-width="2"/><circle cx="${CX}" cy="${CY}" r="8" fill="#334155"/>`);
// Pulsating Heat Pipe: one capillary tube snaking across a fin in a meander,
// liquid slugs and vapour plugs oscillating inside - no wick, no pump.
ART['rad_steel_pb_bi_pumped_loop:secondary'] = () => {
  let d = `M${CX + 14},${CY - 44}`;
  for (let i = 0; i < 7; i++) { const x = CX + 20 + i * 18; d += ` L${x},${CY + 44} L${x + 9},${CY + 44} L${x + 9},${CY - 44} L${x + 18},${CY - 44}`; }
  let beads = '';
  for (let i = 0; i < 7; i++) beads += `<rect x="${CX + 18 + i * 18}" y="${CY - 20 + (i % 3) * 14}" width="4" height="12" rx="2" fill="#fb923c"/>`;
  return scene('rad_steel_pb_bi_pumped_loop', 'secondary', 322, ['#121620', '#030406'], '',
    `${both(`<rect x="${CX + 12}" y="${CY - 50}" width="134" height="100" fill="#334155" opacity="0.5"/><path d="${d}" stroke="#cbd5e1" stroke-width="3" fill="none"/>${beads}`)}${hub(12)}`);
};

// 12. Ti/K Heat Pipe: potassium heat pipes in a fuzzy carbon-foam sheath,
// carrying heat to finned plates; orange.
ART['rad_ti_k_heat_pipe:primary'] = () => scene('rad_ti_k_heat_pipe', 'primary', 323, ['#1a1410', '#050403'], '',
  `${both([-26, 26].map((d) => `<rect x="${CX + 16}" y="${CY + d - 9}" width="128" height="18" rx="9" fill="#292524"/>${[...Array(24)].map((_, i) => `<circle cx="${CX + 20 + i * 5.2}" cy="${CY + d + ((i % 3) - 1) * 6}" r="2.6" fill="#44403c"/>`).join('')}<rect x="${CX + 16}" y="${CY + d - 2.5}" width="128" height="5" rx="2.5" fill="#f97316" filter="url(#glow)"/>${[...Array(6)].map((_, i) => `<rect x="${CX + 30 + i * 20}" y="${CY + d - 18}" width="3" height="36" fill="#78716c"/>`).join('')}`).join(''))}
   ${hub(16, '#9a3412')}`);
// Flux-Pinned Superthermal: separate dark radiator tiles hovering apart in a
// grid, held in formation by flux-pinned superconductors and threaded with
// glowing "superthermal" ribbons - no struts at all.
ART['rad_ti_k_heat_pipe:secondary'] = () => scene('rad_ti_k_heat_pipe', 'secondary', 324, ['#0e1428', '#020309'], '',
  `${both(`${[[40, -50], [86, -50], [40, 6], [86, 6], [128, -22]].map(([dx, dy]) => `<rect x="${CX + dx}" y="${CY + dy}" width="36" height="40" rx="3" fill="#1e293b" stroke="#475569" stroke-width="1.2"/><circle cx="${CX + dx + 18}" cy="${CY + dy + 20}" r="4" fill="#bae6fd"/><circle cx="${CX + dx + 18}" cy="${CY + dy + 20}" r="9" fill="none" stroke="#7dd3fc" stroke-width="0.8" opacity="0.6"/>`).join('')}
     <path d="M${CX + 14},${CY} Q${CX + 40},${CY - 30} ${CX + 58},${CY - 30} M${CX + 14},${CY} Q${CX + 40},${CY + 26} ${CX + 58},${CY + 26} M${CX + 76},${CY - 30} L${CX + 104},${CY - 30} M${CX + 76},${CY + 26} L${CX + 104},${CY + 26} M${CX + 122},${CY - 30} L${CX + 146},${CY - 2}" stroke="#fb923c" stroke-width="1.6" fill="none" filter="url(#glow)"/>`)}
   ${hub(14)}`);

for (const id of Object.keys(PATENTS_BY_ID).filter((k) => PATENTS_BY_ID[k].type === 'radiator')) {
  for (const face of ['primary', 'secondary']) {
    if (!ART[`${id}:${face}`]) throw new Error(`radiator art missing: ${id}:${face}`);
  }
}
