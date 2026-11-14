// Generator deck art: 17 cards x 2 faces. A generator turns a reactor's (or
// the Sun's) energy into electricity (HF4 rules fn 29). Each face draws ITS
// device from research: converters with no moving parts (AMTEC tubes,
// thermoelectric couples, thermionic rods, PV), heat engines (Brayton,
// Stirling, Ericsson, Rankine), MHD ducts, pulsed stores (compulsator, Marx
// bank), exotic optics (O'Meara para-lens, Palmer aerosol lens) and the
// air-eater scoops. Devices float in the open lower half of the card body.
// See docs/card-art-guide.md.
import { PATENTS_BY_ID } from '../../data/patents.js';
import { H, W, f, lin, rad, space, stars, svg, seeded, hcyl, ribs, finPanel, beam, irBeam, magnetRow, solarWing } from './kit.mjs';

export const ART = {};
export const RIG = {};

function sky(seed, bg, c = ['50%', '40%']) {
  const b = space(bg[0], bg[1], c[0], c[1]);
  return { defs: b.defs, base: `${b.body}${stars(55, seed)}` };
}
function sun(x, y, r = 70) {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="#fde68a" opacity="0.22" filter="url(#soft)"/><circle cx="${x}" cy="${y}" r="${f(r * 0.32)}" fill="#fff7d6" opacity="0.8" filter="url(#soft)"/>`;
}
function pipe(d, color = '#9aa3b2', w = 3) {
  return `<path d="${d}" stroke="${color}" stroke-width="${w}" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`;
}
function bolt(x, y, s = 1) {
  return `<path d="M${x},${y} l${-6 * s},${12 * s} l${5 * s},0 l${-4 * s},${11 * s} l${11 * s},${-15 * s} l${-5 * s},0 l${4 * s},${-8 * s} Z" fill="#fde047" stroke="#a16207" stroke-width="0.8"/>`;
}
function dish(cx, cy, r, ang, fill = 'url(#dsh)') {
  return `<g transform="translate(${cx} ${cy}) rotate(${ang})"><path d="M0,${-r} Q${f(r * 0.55)},0 0,${r} L${-6},${r} Q${f(r * 0.5 - 6)},0 -6,${-r} Z" fill="${fill}" stroke="#57534e" stroke-width="1"/></g>`;
}
const DISH = lin('dsh', [[0, '#fef3c7'], [0.5, '#e7e5e4'], [1, '#a8a29e']], 0, 0, 1, 0);
const METAL = (id) => lin(id, [[0, '#4b5563'], [0.45, '#d1d5db'], [1, '#374151']], 0, 0, 1, 0);
const HOT = (id) => rad(id, [[0, '#fff7d6'], [0.45, '#fb923c'], [1, '#9a3412']]);
const PV = lin('pvg', [[0, '#1e3a8a'], [1, '#0f1d4a']]);
// A mounting strut + small bus, so devices read as spacecraft hardware.
function bus(x, y) {
  return `<rect x="${x - 14}" y="${y - 10}" width="28" height="20" rx="3" fill="#cbd5e1" stroke="#64748b" stroke-width="1.2"/><rect x="${x - 8}" y="${y - 5}" width="6" height="4" fill="#fde68a"/>`;
}

// 1. AMTEC: organ pipes of cream ceramic tubes on a glowing hot plate, a cool
// condenser cap above, sodium vapour glowing yellow-orange. No moving parts.
ART['gen_amtec_thermoelectric:primary'] = () => {
  const s = sky(201, ['#1d1424', '#050307']);
  const tubes = [0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="${102 + i * 14}" y="${168 - (i % 2) * 6}" width="9" height="${62 + (i % 2) * 6}" rx="4" fill="#fef3c7" stroke="#d6d3d1" stroke-width="0.8"/><rect x="${104 + i * 14}" y="${180 - (i % 2) * 6}" width="5" height="${44 + (i % 2) * 6}" fill="#fbbf24" opacity="0.45"/>`).join('');
  return svg(s.defs + METAL('am') + HOT('hp'), `${s.base}
    <rect x="94" y="152" width="112" height="12" rx="4" fill="#64748b" stroke="#cbd5e1" stroke-width="1"/>${tubes}
    <rect x="88" y="230" width="124" height="16" rx="4" fill="url(#hp)" filter="url(#glow)"/>
    ${pipe('M206,158 Q240,158 240,200 L212,238', '#94a3b8', 2)}
    ${finPanel(228, 130, 50, 30, 5)}${bus(60, 238)}<line x1="74" y1="238" x2="88" y2="238" stroke="#94a3b8" stroke-width="3"/>`);
};
// JTEC: two stacks of membrane plates, one red-hot, one cool blue, joined in a
// ring by twin hydrogen pipes, the hot stack at a small sun dish's focus.
ART['gen_amtec_thermoelectric:secondary'] = () => {
  const s = sky(202, ['#1a1430', '#040309'], ['10%', '30%']);
  const stack = (x, c1, c2) => [...Array(9)].map((_, i) => `<rect x="${x}" y="${164 + i * 7}" width="44" height="5" rx="1" fill="${i % 2 ? c1 : c2}"/>`).join('');
  return svg(s.defs + DISH, `${s.base}${sun(10, 120)}
    ${dish(56, 200, 44, 0)}
    ${[150, 180, 210, 240].map((y) => `<line x1="20" y1="${y - 30}" x2="80" y2="200" stroke="#fde68a" stroke-width="1" opacity="0.35"/>`).join('')}
    ${stack(96, '#ef4444', '#7f1d1d')}${stack(200, '#38bdf8', '#0c4a6e')}
    <rect x="94" y="160" width="48" height="70" rx="4" fill="none" stroke="#fca5a5" stroke-width="1.5" filter="url(#glow)"/>
    ${pipe('M140,170 Q170,150 200,170', '#e2e8f0', 3)}${pipe('M140,222 Q170,242 200,222', '#e2e8f0', 3)}
    <circle cx="170" cy="156" r="3" fill="#e0f2fe"/><circle cx="170" cy="236" r="3" fill="#e0f2fe"/>`);
};

// 2. Brayton turbine: a squat turbo-alternator shaft - bladed turbine and
// compressor wheels either side of the alternator - a boxy recuperator, and
// ducts to a radiator panel far bigger than the machine.
ART['gen_brayton_turbine:primary'] = () => {
  const s = sky(203, ['#141c28', '#030508']);
  const wheel = (x) => `<ellipse cx="${x}" cy="196" rx="8" ry="24" fill="#94a3b8" stroke="#e2e8f0" stroke-width="1"/>${[...Array(8)].map((_, i) => `<line x1="${x}" y1="196" x2="${f(x + 6 * Math.cos(i * 0.8))}" y2="${f(196 + 22 * Math.sin(i * 0.8))}" stroke="#334155" stroke-width="1"/>`).join('')}`;
  return svg(s.defs + METAL('br'), `${s.base}
    ${finPanel(186, 132, 100, 56, 10)}${finPanel(186, 210, 100, 56, 10)}
    ${hcyl(70, 196, 70, 14, 'url(#br)')}${ribs(84, 196, 40, 14, 4, '#374151', 1.4)}
    ${wheel(66)}${wheel(144)}
    <rect x="40" y="226" width="56" height="30" rx="3" fill="#475569" stroke="#94a3b8" stroke-width="1"/>${[...Array(7)].map((_, i) => `<line x1="${44 + i * 7.5}" y1="228" x2="${44 + i * 7.5}" y2="254" stroke="#64748b" stroke-width="1"/>`).join('')}
    ${pipe('M150,186 L186,160 M150,206 L186,238', '#e2e8f0', 3)}${pipe('M66,220 L66,226', '#e2e8f0', 3)}`);
};
// O'Meara para-lens: a vast flat bullseye of thin transparent rings with empty
// rings between, held by spars, focusing a beam down to a glowing point.
ART['gen_brayton_turbine:secondary'] = () => {
  const s = sky(204, ['#0d1430', '#020309']);
  const rings = [18, 32, 46, 60, 74].map((r) => `<ellipse cx="110" cy="200" rx="${f(r * 0.32)}" ry="${r}" fill="none" stroke="#bae6fd" stroke-width="7" opacity="0.32"/>`).join('');
  return svg(s.defs, `${s.base}
    ${[0, 45, 90, 135].map((a) => `<line x1="${f(110 - 24 * Math.cos(a * Math.PI / 180))}" y1="${f(200 - 76 * Math.sin(a * Math.PI / 180))}" x2="${f(110 + 24 * Math.cos(a * Math.PI / 180))}" y2="${f(200 + 76 * Math.sin(a * Math.PI / 180))}" stroke="#94a3b8" stroke-width="1"/>`).join('')}
    ${rings}
    <path d="M0,124 L110,126 L254,200 L110,274 L0,276 Z" fill="#a78bfa" opacity="0.12"/>
    ${[-60, -30, 0, 30, 60].map((d) => `<line x1="0" y1="${200 + d * 1.2}" x2="110" y2="${200 + d}" stroke="#c4b5fd" stroke-width="1" opacity="0.5"/><line x1="110" y1="${200 + d}" x2="254" y2="200" stroke="#e9d5ff" stroke-width="1" opacity="0.55"/>`).join('')}
    <circle cx="254" cy="200" r="7" fill="#ffffff" filter="url(#glow)"/><circle cx="262" cy="200" r="4" fill="#cbd5e1"/>`);
};

// 3. Cascade photovoltaic: big rigid dark-blue wings with silver busbars on a
// truss, facing the sun; an inset shows the stacked junction layers.
ART['gen_cascade_photovoltaic:primary'] = () => {
  const s = sky(205, ['#141a30', '#03040a'], ['90%', '20%']);
  const wing = (x, y) => `<rect x="${x}" y="${y}" width="96" height="40" fill="url(#pvg)" stroke="#93c5fd" stroke-width="1"/>${[1, 2, 3, 4, 5].map((i) => `<line x1="${x + i * 16}" y1="${y}" x2="${x + i * 16}" y2="${y + 40}" stroke="#cbd5e1" stroke-width="1"/>`).join('')}<line x1="${x}" y1="${y + 20}" x2="${x + 96}" y2="${y + 20}" stroke="#cbd5e1" stroke-width="0.8"/>`;
  return svg(s.defs + PV, `${s.base}${sun(300, 120, 80)}
    <g transform="rotate(-10 150 200)">${wing(20, 150)}${wing(20, 196)}${wing(184, 150)}${wing(184, 196)}<line x1="116" y1="194" x2="184" y2="194" stroke="#94a3b8" stroke-width="4"/>${bus(150, 194)}</g>
    <circle cx="246" cy="254" r="22" fill="#0b1020" stroke="#e2e8f0" stroke-width="1.2"/>
    ${['#7c3aed', '#16a34a', '#dc2626'].map((c, i) => `<rect x="232" y="${244 + i * 7}" width="28" height="6" fill="${c}"/>`).join('')}`);
};
// Buckyball C60 photovoltaic: a thin, floppy, translucent amber film unrolled
// from a drum, a soccer-ball C60 molecule inset.
ART['gen_cascade_photovoltaic:secondary'] = () => {
  const s = sky(206, ['#1c1610', '#050403'], ['90%', '20%']);
  let ball = '';
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; ball += `<circle cx="${f(248 + 13 * Math.cos(a))}" cy="${f(244 + 13 * Math.sin(a))}" r="2.2" fill="#e5e7eb"/>`; }
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.3; ball += `<circle cx="${f(248 + 6 * Math.cos(a))}" cy="${f(244 + 6 * Math.sin(a))}" r="2" fill="#cbd5e1"/>`; }
  return svg(s.defs + lin('film', [[0, '#f59e0b', 0.6], [1, '#92400e', 0.35]]), `${s.base}${sun(300, 120, 80)}
    <ellipse cx="44" cy="190" rx="12" ry="34" fill="#78716c" stroke="#d6d3d1" stroke-width="1.5"/>
    <path d="M44,156 Q130,140 214,166 Q206,200 214,236 Q130,212 44,224 Z" fill="url(#film)" stroke="#fcd34d" stroke-width="1"/>
    ${[0, 1, 2, 3].map((i) => `<path d="M${70 + i * 36},${152 - i * 2} Q${74 + i * 36},190 ${70 + i * 36},${222 - i * 2}" stroke="#fde68a" stroke-width="0.8" fill="none" opacity="0.6"/>`).join('')}
    <circle cx="248" cy="244" r="24" fill="#0b0b10" stroke="#e5e7eb" stroke-width="1.2"/>${ball}`);
};

// 4. Cascade thermoacoustic: a looped tube with bulging regenerator stages,
// red-hot one side, cool the other, each ending in a speaker-like linear
// alternator, sound-wave ripples in the gas. Plumbing like an instrument.
ART['gen_cascade_thermoacoustic:primary'] = () => {
  const s = sky(207, ['#16182a', '#040408']);
  const stage = (x) => `<rect x="${x}" y="178" width="30" height="36" rx="10" fill="#475569" stroke="#cbd5e1" stroke-width="1"/><rect x="${x + 2}" y="182" width="10" height="28" fill="#ef4444" opacity="0.8"/><rect x="${x + 18}" y="182" width="10" height="28" fill="#38bdf8" opacity="0.7"/>`;
  const alt = (x, y) => `<circle cx="${x}" cy="${y}" r="14" fill="#334155" stroke="#94a3b8" stroke-width="1.5"/><circle cx="${x}" cy="${y}" r="8" fill="#1f2937" stroke="#64748b"/><circle cx="${x}" cy="${y}" r="3" fill="#94a3b8"/>`;
  return svg(s.defs, `${s.base}
    <path d="M40,196 Q40,150 90,150 L210,150 Q260,150 260,196 Q260,244 210,244 L90,244 Q40,244 40,196 Z" fill="none" stroke="#94a3b8" stroke-width="8"/>
    ${stage(70)}${stage(136)}${stage(200)}
    ${alt(92, 248)}${alt(158, 248)}${alt(222, 248)}
    ${[0, 1, 2, 3].map((i) => `<path d="M${54 + i * 8},${168} q4,-6 0,-12" stroke="#e0f2fe" stroke-width="1" fill="none" opacity="0.6"/>`).join('')}
    <path d="M90,140 q10,-8 20,0 q10,8 20,0 q10,-8 20,0 q10,8 20,0" stroke="#fde68a" stroke-width="1.4" fill="none" opacity="0.7"/>`);
};
// Dusty plasma MHD: a sparkling cloud of charged fission dust held in a
// magnetic bottle; its fragment jet runs out through a ribbed MHD channel.
ART['gen_cascade_thermoacoustic:secondary'] = () => {
  const s = sky(208, ['#1a0f2a', '#040208']);
  const rnd = seeded(208);
  let dust = '';
  for (let i = 0; i < 60; i++) { const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 30; dust += `<circle cx="${f(96 + Math.cos(a) * d * 1.3)}" cy="${f(196 + Math.sin(a) * d)}" r="${f(0.8 + rnd() * 1.4)}" fill="#fef9c3" opacity="${f(0.5 + rnd() * 0.5)}"/>`; }
  return svg(s.defs, `${s.base}
    <ellipse cx="96" cy="196" rx="44" ry="34" fill="#f0abfc" opacity="0.2" filter="url(#soft)"/>${dust}
    ${[46, 146].map((x) => `<ellipse cx="${x}" cy="196" rx="8" ry="36" fill="none" stroke="#e3954f" stroke-width="6"/>`).join('')}
    <path d="M150,190 L268,186 L268,206 L150,202 Z" fill="#c084fc" opacity="0.5" filter="url(#glow)"/>
    <rect x="170" y="176" width="90" height="40" rx="3" fill="none" stroke="#94a3b8" stroke-width="2"/>${[...Array(8)].map((_, i) => `<rect x="${174 + i * 11}" y="172" width="5" height="48" fill="#64748b"/>`).join('')}`);
};

// 5. Catalyzed fission scintillator: a dense core inside a glowing violet
// crystal block, lined with dark PV tiles that read its light - a lantern.
ART['gen_catalyzed_fission_scintillator:primary'] = () => {
  const s = sky(209, ['#160f2a', '#040208']);
  return svg(s.defs + rad('scin', [[0, '#ffffff'], [0.3, '#c4b5fd'], [1, '#4c1d95']]), `${s.base}
    <rect x="96" y="150" width="108" height="100" rx="6" fill="#1e1b4b" stroke="#94a3b8" stroke-width="2"/>
    ${[...Array(5)].map((_, i) => `<rect x="${100 + i * 20}" y="154" width="18" height="8" fill="#1e3a8a" stroke="#60a5fa" stroke-width="0.5"/><rect x="${100 + i * 20}" y="238" width="18" height="8" fill="#1e3a8a" stroke="#60a5fa" stroke-width="0.5"/>`).join('')}
    <rect x="110" y="166" width="80" height="68" rx="4" fill="url(#scin)" opacity="0.85" filter="url(#glow)"/>
    <circle cx="150" cy="200" r="8" fill="#facc15" stroke="#a16207"/>
    ${[...Array(8)].map((_, i) => `<line x1="150" y1="200" x2="${f(150 + 30 * Math.cos(i * 0.785))}" y2="${f(200 + 26 * Math.sin(i * 0.785))}" stroke="#ede9fe" stroke-width="1" opacity="0.7"/>`).join('')}`);
};
// Diamonoid electrodynamic tether: a hair-thin diamond fibre hanging from the
// ship toward a banded giant planet, plasma contactors glowing at each end.
ART['gen_catalyzed_fission_scintillator:secondary'] = () => {
  const s = sky(210, ['#14102a', '#030208'], ['50%', '100%']);
  return svg(s.defs + rad('jup', [[0, '#fde68a'], [0.6, '#d97706'], [1, '#78350f']], '50%', '20%', '80%'), `${s.base}
    <ellipse cx="150" cy="420" rx="260" ry="200" fill="url(#jup)"/>
    ${[250, 264, 280].map((y) => `<path d="M-10,${y} Q150,${y - 30} 310,${y}" stroke="#92400e" stroke-width="5" fill="none" opacity="0.5"/>`).join('')}
    ${[60, 120, 180, 240].map((x) => `<path d="M${x},230 Q${x + 30},150 ${x + 6},110" stroke="#93c5fd" stroke-width="1" fill="none" opacity="0.35" stroke-dasharray="4 4"/>`).join('')}
    <line x1="150" y1="122" x2="150" y2="228" stroke="#e0f2fe" stroke-width="1.2"/>
    ${bus(150, 112)}<circle cx="150" cy="232" r="6" fill="#7dd3fc" filter="url(#glow)"/><circle cx="150" cy="232" r="3" fill="#475569"/>
    <circle cx="150" cy="122" r="5" fill="#7dd3fc" opacity="0.7" filter="url(#glow)"/>`);
};

// 6. Ericsson engine: two cylinders, hot red and cold blue, valve stems on
// top, joined by a finned regenerator duct, driving a crank and alternator.
ART['gen_ericsson_engine:primary'] = () => {
  const s = sky(211, ['#1a1410', '#050403']);
  const cyl = (x, c) => `<rect x="${x}" y="160" width="40" height="70" rx="5" fill="#475569" stroke="#cbd5e1" stroke-width="1.2"/><rect x="${x + 6}" y="166" width="28" height="40" fill="${c}" opacity="0.75"/><rect x="${x + 4}" y="206" width="32" height="10" fill="#9ca3af"/><line x1="${x + 12}" y1="160" x2="${x + 12}" y2="148" stroke="#e5e7eb" stroke-width="2"/><line x1="${x + 28}" y1="160" x2="${x + 28}" y2="144" stroke="#e5e7eb" stroke-width="2"/><circle cx="${x + 12}" cy="146" r="2.5" fill="#e5e7eb"/><circle cx="${x + 28}" cy="142" r="2.5" fill="#e5e7eb"/>`;
  return svg(s.defs, `${s.base}
    ${cyl(60, '#ef4444')}${cyl(200, '#38bdf8')}
    <rect x="102" y="176" width="96" height="18" rx="4" fill="#64748b"/>${[...Array(11)].map((_, i) => `<rect x="${106 + i * 8}" y="170" width="3" height="30" fill="#94a3b8"/>`).join('')}
    <circle cx="150" cy="248" r="18" fill="#334155" stroke="#94a3b8" stroke-width="2"/><line x1="80" y1="230" x2="150" y2="248" stroke="#cbd5e1" stroke-width="3"/><line x1="220" y1="230" x2="150" y2="248" stroke="#cbd5e1" stroke-width="3"/>
    <rect x="176" y="240" width="40" height="18" rx="3" fill="#b45309" stroke="#fde68a" stroke-width="1"/>${bolt(230, 238, 0.9)}`);
};
// Nanocomposite thermoelectric: a flat checkerboard of p/n legs between a
// glowing hot plate and a finned cold plate. Solid state, tile-like.
ART['gen_ericsson_engine:secondary'] = () => {
  const s = sky(212, ['#10161c', '#030405']);
  let legs = '';
  for (let i = 0; i < 12; i++) legs += `<rect x="${66 + i * 14}" y="186" width="10" height="34" fill="${i % 2 ? '#b45309' : '#374151'}" stroke="#111827" stroke-width="0.6"/>`;
  return svg(s.defs + HOT('tep'), `${s.base}
    <rect x="58" y="220" width="184" height="16" rx="3" fill="url(#tep)" filter="url(#glow)"/>
    ${legs}
    <rect x="58" y="176" width="184" height="10" fill="#94a3b8"/>
    ${[...Array(16)].map((_, i) => `<rect x="${60 + i * 11.4}" y="146" width="4" height="30" fill="#cbd5e1"/>`).join('')}
    ${bolt(258, 190, 1)}`);
};

// 7. Flywheel compulsator: a fat drum rotor spinning inside its ring of stator
// windings, motion arcs, small solar wings to spin it up, a pulse cable out.
ART['gen_flywheel_compulsator:primary'] = () => {
  const s = sky(213, ['#16182a', '#040408'], ['90%', '20%']);
  return svg(s.defs + METAL('fly'), `${s.base}${sun(300, 120, 70)}
    ${solarWing(20, 150, 50, 22)}${solarWing(230, 150, 50, 22)}
    <circle cx="150" cy="200" r="56" fill="#334155" stroke="#94a3b8" stroke-width="2"/>
    ${[...Array(16)].map((_, i) => { const a = i * Math.PI / 8; return `<rect x="${f(150 + 48 * Math.cos(a) - 4)}" y="${f(200 + 48 * Math.sin(a) - 4)}" width="8" height="8" fill="#c2621f" transform="rotate(${f(a * 180 / Math.PI)} ${f(150 + 48 * Math.cos(a))} ${f(200 + 48 * Math.sin(a))})"/>`; }).join('')}
    <circle cx="150" cy="200" r="38" fill="url(#fly)"/><circle cx="150" cy="200" r="8" fill="#475569"/>
    <path d="M118,178 A40,40 0 0 1 172,166" stroke="#e0f2fe" stroke-width="2" fill="none" opacity="0.7"/><path d="M182,222 A40,40 0 0 1 128,234" stroke="#e0f2fe" stroke-width="2" fill="none" opacity="0.7"/>
    <path d="M206,200 L240,200 L248,214 L262,190" stroke="#fde047" stroke-width="2.4" fill="none" filter="url(#glow)"/>`);
};
// Superconducting adductor (SMES): a toroidal coil in a frosted cryostat,
// glowing cold blue-white, a cryocooler box and a pulse line out.
ART['gen_flywheel_compulsator:secondary'] = () => {
  const s = sky(214, ['#0c1830', '#020409']);
  return svg(s.defs, `${s.base}
    <ellipse cx="150" cy="204" rx="80" ry="34" fill="none" stroke="#e0f2fe" stroke-width="26" opacity="0.18"/>
    <ellipse cx="150" cy="204" rx="80" ry="34" fill="none" stroke="#bfdbfe" stroke-width="18"/>
    ${[...Array(18)].map((_, i) => { const a = i * Math.PI / 9; return `<line x1="${f(150 + 72 * Math.cos(a))}" y1="${f(204 + 28 * Math.sin(a))}" x2="${f(150 + 88 * Math.cos(a))}" y2="${f(204 + 40 * Math.sin(a))}" stroke="#60a5fa" stroke-width="2"/>`; }).join('')}
    <ellipse cx="150" cy="204" rx="80" ry="34" fill="none" stroke="#ffffff" stroke-width="2" opacity="0.7" filter="url(#glow)"/>
    <rect x="128" y="130" width="44" height="30" rx="4" fill="#475569" stroke="#cbd5e1" stroke-width="1"/>${[0, 1, 2].map((i) => `<rect x="${132 + i * 13}" y="122" width="8" height="8" fill="#94a3b8"/>`).join('')}<line x1="150" y1="160" x2="150" y2="172" stroke="#94a3b8" stroke-width="4"/>
    <path d="M234,212 L262,212 L268,226 L280,200" stroke="#fde047" stroke-width="2.4" fill="none" filter="url(#glow)"/>`);
};

// 8. H2-O2 fuel cell: a ribbed cell stack between big spherical cryo tanks,
// white hydrogen and blue oxygen, a thin water line out.
ART['gen_h2_o2_fuel_cell:primary'] = () => {
  const s = sky(215, ['#101a28', '#030407']);
  return svg(s.defs + rad('h2', [[0, '#ffffff'], [0.6, '#e2e8f0'], [1, '#94a3b8']], '35%', '35%') + rad('o2', [[0, '#dbeafe'], [0.6, '#60a5fa'], [1, '#1e3a8a']], '35%', '35%'), `${s.base}
    <circle cx="66" cy="200" r="40" fill="url(#h2)"/><circle cx="234" cy="200" r="40" fill="url(#o2)"/>
    <rect x="114" y="170" width="72" height="60" rx="4" fill="#475569" stroke="#cbd5e1" stroke-width="1.2"/>
    ${[...Array(12)].map((_, i) => `<rect x="${118 + i * 5.6}" y="174" width="3" height="52" fill="#94a3b8"/>`).join('')}
    ${'<line x1="106" y1="200" x2="114" y2="200" stroke="#cbd5e1" stroke-width="4"/><line x1="186" y1="200" x2="194" y2="200" stroke="#cbd5e1" stroke-width="4"/>'}
    ${pipe('M150,230 L150,262 L120,262', '#7dd3fc', 2)}<circle cx="114" cy="262" r="4" fill="#7dd3fc"/>${bolt(158, 132, 1)}`);
};
// Microbial fuel cell: a two-chamber H-shaped bioreactor - murky green-brown
// with a fuzzy biofilm anode on one side, clear on the other - waste fed in.
ART['gen_h2_o2_fuel_cell:secondary'] = () => {
  const s = sky(216, ['#101a10', '#030503']);
  const rnd = seeded(216);
  let fuzz = '';
  for (let i = 0; i < 40; i++) fuzz += `<line x1="${f(94 + rnd() * 10)}" y1="${f(176 + rnd() * 56)}" x2="${f(90 + rnd() * 18)}" y2="${f(176 + rnd() * 56)}" stroke="#65a30d" stroke-width="1"/>`;
  return svg(s.defs, `${s.base}
    <rect x="60" y="160" width="76" height="86" rx="8" fill="#3f6212" opacity="0.8" stroke="#d9f99d" stroke-width="1.5"/>
    <rect x="164" y="160" width="76" height="86" rx="8" fill="#bae6fd" opacity="0.25" stroke="#e0f2fe" stroke-width="1.5"/>
    <rect x="136" y="196" width="28" height="14" fill="#e0f2fe" opacity="0.4" stroke="#e0f2fe"/>
    <rect x="96" y="172" width="8" height="64" fill="#1c1917"/>${fuzz}
    <rect x="198" y="172" width="6" height="64" fill="#94a3b8"/>
    ${pipe('M100,172 L100,134 L200,134 L200,172', '#fde047', 1.6)}<circle cx="150" cy="134" r="5" fill="#334155" stroke="#fde047"/>
    ${pipe('M30,180 L60,180', '#78716c', 4)}`);
};

// 9. In-core thermionic: a bundle of concentric fuel rods - glowing core,
// thin violet caesium gap, dark sleeve - the reactor and generator one
// cylinder with a conical radiator skirt.
ART['gen_in_core_thermionic:primary'] = () => {
  const s = sky(217, ['#1a1410', '#050403']);
  const rod = (x) => `<rect x="${x - 7}" y="148" width="14" height="70" rx="3" fill="#374151"/><rect x="${x - 4.5}" y="150" width="9" height="66" rx="2" fill="#a78bfa" opacity="0.7"/><rect x="${x - 2.5}" y="152" width="5" height="62" rx="2" fill="#fb923c" filter="url(#glow)"/>`;
  return svg(s.defs + METAL('topz'), `${s.base}
    <path d="M100,218 L200,218 L240,272 L60,272 Z" fill="#334155" stroke="#94a3b8" stroke-width="1"/>${[...Array(9)].map((_, i) => `<line x1="${f(104 + i * 11.5)}" y1="218" x2="${f(66 + i * 21)}" y2="272" stroke="#475569" stroke-width="1.5"/>`).join('')}
    <rect x="96" y="140" width="108" height="82" rx="8" fill="url(#topz)" opacity="0.35"/>
    ${[110, 126, 142, 158, 174, 190].map(rod).join('')}
    <rect x="96" y="140" width="108" height="82" rx="8" fill="none" stroke="#cbd5e1" stroke-width="2"/>`);
};
// Z-pinch microfission: a ring of capacitor drums feeding a central electrode
// pair, a brilliant thin pinch column on the axis, inside magnetic-nozzle coils.
ART['gen_in_core_thermionic:secondary'] = () => {
  const s = sky(218, ['#140f2a', '#030208']);
  return svg(s.defs, `${s.base}
    ${[...Array(8)].map((_, i) => { const a = i * Math.PI / 4; return `<rect x="${f(150 + 76 * Math.cos(a) - 9)}" y="${f(200 + 38 * Math.sin(a) - 14)}" width="18" height="28" rx="4" fill="#1e3a8a" stroke="#93c5fd" stroke-width="1"/><line x1="${f(150 + 66 * Math.cos(a))}" y1="${f(200 + 32 * Math.sin(a))}" x2="${f(150 + 14 * Math.cos(a))}" y2="${f(200 + 8 * Math.sin(a))}" stroke="#94a3b8" stroke-width="2"/>`; }).join('')}
    <path d="M118,150 Q150,130 182,150 M110,256 Q150,280 190,256" stroke="#e3954f" stroke-width="6" fill="none"/>
    <rect x="142" y="150" width="16" height="12" fill="#cbd5e1"/><rect x="142" y="238" width="16" height="12" fill="#cbd5e1"/>
    <line x1="150" y1="162" x2="150" y2="238" stroke="#e0f2fe" stroke-width="8" opacity="0.4" filter="url(#glow)"/>
    ${[0, 1, 2, 3, 4, 5].map((i) => `<ellipse cx="150" cy="${170 + i * 12}" rx="${i % 2 ? 2 : 4}" ry="6" fill="#ffffff"/>`).join('')}`);
};

// 10. Magnetoshell plasma parachute: a small coil on a boom ahead of the ship,
// wrapped in a huge faint plasma bubble, a glowing bow-shock where it bites
// into the top of a planet's atmosphere.
ART['gen_magnetoshell_plasma_parachute:primary'] = () => {
  const s = sky(219, ['#0f1430', '#030409'], ['50%', '100%']);
  return svg(s.defs + rad('pl2', [[0, '#3b82f6'], [1, '#0b1640']], '50%', '0%', '90%'), `${s.base}
    <ellipse cx="150" cy="430" rx="320" ry="190" fill="url(#pl2)"/>
    <ellipse cx="150" cy="430" rx="326" ry="196" fill="none" stroke="#7dd3fc" stroke-width="6" opacity="0.4" filter="url(#soft)"/>
    <ellipse cx="96" cy="196" rx="56" ry="48" fill="#e879f9" opacity="0.14" stroke="#f0abfc" stroke-width="1.5"/>
    <path d="M44,170 Q30,200 46,234" stroke="#fdba74" stroke-width="5" fill="none" filter="url(#glow)"/>
    <ellipse cx="96" cy="196" rx="5" ry="10" fill="none" stroke="#e2e8f0" stroke-width="2.5"/>
    <line x1="101" y1="196" x2="196" y2="196" stroke="#94a3b8" stroke-width="2"/>${bus(210, 196)}${solarWing(196, 168, 28, 12)}`);
};
// Granular rainbow corral: a dish-shaped cloud of glittering grains, rainbow
// iridescent, held in shape by laser lines from small craft around it.
ART['gen_magnetoshell_plasma_parachute:secondary'] = () => {
  const s = sky(220, ['#121030', '#030208']);
  const rnd = seeded(220);
  const cols = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#38bdf8', '#a78bfa'];
  let grains = '';
  for (let i = 0; i < 160; i++) { const t = rnd() * 2 - 1, u = rnd(); const x = 150 + t * 92, y = 196 + (t * t) * 30 - 20 + u * 16; grains += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.7 + rnd())}" fill="${cols[Math.floor(rnd() * 6)]}" opacity="${f(0.6 + rnd() * 0.4)}"/>`; }
  const craft = [[40, 150], [260, 150], [150, 262]];
  return svg(s.defs, `${s.base}${grains}
    ${craft.map(([x, y]) => `<line x1="${x}" y1="${y}" x2="150" y2="196" stroke="#ef4444" stroke-width="1" opacity="0.5"/><rect x="${x - 6}" y="${y - 4}" width="12" height="8" rx="2" fill="#cbd5e1"/>`).join('')}`);
};

// 11. Marx capacitor bank: a tall ladder of capacitor cans with ball spark
// gaps between the rungs, arcs jumping up the stack.
ART['gen_marx_capacitor_bank:primary'] = () => {
  const s = sky(221, ['#14142a', '#030308']);
  let ladder = '';
  for (let i = 0; i < 5; i++) {
    const y = 250 - i * 24;
    ladder += `<rect x="112" y="${y - 10}" width="30" height="18" rx="4" fill="#1e3a8a" stroke="#93c5fd" stroke-width="1"/><rect x="158" y="${y - 22}" width="30" height="18" rx="4" fill="#1e3a8a" stroke="#93c5fd" stroke-width="1"/>`;
    ladder += `<circle cx="150" cy="${y - 4}" r="4" fill="#cbd5e1"/><circle cx="150" cy="${y - 14}" r="4" fill="#cbd5e1"/><path d="M150,${y - 8} l-3,-2 l5,-1 l-3,-2" stroke="#e0f2fe" stroke-width="1.4" fill="none" filter="url(#glow)"/>`;
  }
  return svg(s.defs, `${s.base}
    <rect x="104" y="138" width="4" height="122" fill="#64748b"/><rect x="192" y="138" width="4" height="122" fill="#64748b"/>
    ${ladder}
    <circle cx="150" cy="132" r="9" fill="#e5e7eb"/><path d="M150,122 l-6,-12 l8,4 l-4,-14" stroke="#e0f2fe" stroke-width="2" fill="none" filter="url(#glow)"/>`);
};
// Casimir battery: a stack of very thin, very closely spaced mirror plates,
// faint quantum-vacuum foam squeezed out of the gaps. Small and abstract.
ART['gen_marx_capacitor_bank:secondary'] = () => {
  const s = sky(222, ['#100c22', '#030208']);
  const rnd = seeded(222);
  let foam = '';
  for (let i = 0; i < 40; i++) foam += `<circle cx="${f(212 + rnd() * 40)}" cy="${f(156 + rnd() * 90)}" r="${f(0.6 + rnd() * 1.4)}" fill="#c4b5fd" opacity="${f(0.3 + rnd() * 0.6)}"/>`;
  return svg(s.defs + lin('mir', [[0, '#64748b'], [0.5, '#f8fafc'], [1, '#94a3b8']], 0, 0, 1, 0), `${s.base}
    ${[...Array(10)].map((_, i) => `<rect x="${100 + i * 10}" y="${156 - i * 1.5}" width="4" height="${90 + i * 3}" fill="url(#mir)"/>`).join('')}
    ${foam}${[...Array(9)].map((_, i) => `<rect x="${104.5 + i * 10}" y="168" width="5" height="70" fill="#a78bfa" opacity="0.18"/>`).join('')}`);
};

// 12. Optoelectric nuclear battery: a thick-walled high-pressure gas lamp,
// glowing UV-violet inside, lined with photovoltaic cells.
ART['gen_optoelectric_nuclear_battery:primary'] = () => {
  const s = sky(223, ['#160f28', '#040208']);
  return svg(s.defs + rad('ex', [[0, '#ffffff'], [0.4, '#c4b5fd'], [1, '#5b21b6']]), `${s.base}
    <rect x="96" y="140" width="108" height="112" rx="26" fill="#374151" stroke="#cbd5e1" stroke-width="3"/>
    <rect x="110" y="154" width="80" height="84" rx="18" fill="url(#ex)" filter="url(#glow)"/>
    ${[...Array(5)].map((_, i) => `<rect x="${112 + i * 16}" y="156" width="12" height="10" fill="#1e3a8a" stroke="#60a5fa" stroke-width="0.6"/><rect x="${112 + i * 16}" y="226" width="12" height="10" fill="#1e3a8a" stroke="#60a5fa" stroke-width="0.6"/>`).join('')}
    <circle cx="150" cy="196" r="5" fill="#facc15"/>
    ${[100, 200].map((x) => `<rect x="${x - 6}" y="132" width="12" height="10" fill="#9ca3af"/>`).join('')}`);
};
// Nuclear-pumped excimer flashlamp: a reactor core sleeved in glowing violet
// gas tubes, reflectors funnelling the light onto photovoltaic panels.
ART['gen_optoelectric_nuclear_battery:secondary'] = () => {
  const s = sky(224, ['#160f28', '#040208']);
  return svg(s.defs + METAL('rx'), `${s.base}
    <rect x="124" y="148" width="52" height="96" rx="10" fill="url(#rx)"/>
    ${[-1, 1].map((sd) => [0, 1, 2].map((k) => `<rect x="${150 + sd * (32 + k * 10) - 3}" y="152" width="6" height="88" rx="3" fill="#c4b5fd" filter="url(#glow)"/>`).join('')).join('')}
    ${[-1, 1].map((sd) => `<path d="M${150 + sd * 64},146 Q${150 + sd * 86},196 ${150 + sd * 64},246" stroke="#e5e7eb" stroke-width="3" fill="none"/><rect x="${sd < 0 ? 22 : 238}" y="160" width="40" height="72" fill="#1e3a8a" stroke="#93c5fd" stroke-width="1"/>`).join('')}
    <circle cx="150" cy="196" r="10" fill="#facc15" opacity="0.8" filter="url(#glow)"/>`);
};

// 13. Photon tether rectenna: two craft facing each other with mirror discs,
// a bright many-bounce laser bar trapped between them, a gridded rectenna on one.
ART['gen_photon_tether_rectenna:primary'] = () => {
  const s = sky(225, ['#101830', '#030409']);
  return svg(s.defs, `${s.base}
    <line x1="56" y1="210" x2="244" y2="210" stroke="#94a3b8" stroke-width="1"/>
    ${[0, 1, 2, 3].map((i) => `<line x1="58" y1="${190 + i * 4}" x2="242" y2="${194 + i * 4}" stroke="#4ade80" stroke-width="1.2" opacity="0.8" filter="url(#glow)"/>`).join('')}
    <ellipse cx="54" cy="196" rx="5" ry="18" fill="#e5e7eb"/><ellipse cx="246" cy="196" rx="5" ry="18" fill="#e5e7eb"/>
    ${bus(34, 196)}${bus(266, 196)}
    <rect x="252" y="140" width="40" height="34" fill="#1f2937" stroke="#94a3b8" stroke-width="1"/>${[...Array(5)].map((_, i) => `<line x1="${256 + i * 8}" y1="144" x2="${256 + i * 8}" y2="170" stroke="#facc15" stroke-width="1.4"/>`).join('')}${bolt(240, 136, 0.8)}`);
};
// Palmer aerosol lens: a soft lens-shaped haze of tiny bright droplets bending
// a beam to a glowing laser-sustained plasma spark at its focus; a faint scoop
// membrane for gathering the air it feeds on.
ART['gen_photon_tether_rectenna:secondary'] = () => {
  const s = sky(226, ['#0e1430', '#020309']);
  const rnd = seeded(226);
  let mist = '';
  for (let i = 0; i < 150; i++) { const y = rnd() * 120 - 60, w = Math.sqrt(1 - (y / 60) ** 2) * 16; mist += `<circle cx="${f(100 + (rnd() * 2 - 1) * w)}" cy="${f(196 + y)}" r="${f(0.6 + rnd())}" fill="#e0f2fe" opacity="${f(0.4 + rnd() * 0.5)}"/>`; }
  return svg(s.defs, `${s.base}
    ${[-48, -24, 0, 24, 48].map((d) => `<line x1="0" y1="${196 + d}" x2="100" y2="${196 + d}" stroke="#fca5a5" stroke-width="1" opacity="0.45"/><line x1="100" y1="${196 + d}" x2="220" y2="196" stroke="#fecaca" stroke-width="1" opacity="0.6"/>`).join('')}
    <ellipse cx="100" cy="196" rx="18" ry="62" fill="#bae6fd" opacity="0.12"/>${mist}
    <circle cx="220" cy="196" r="9" fill="#ffffff" filter="url(#glow)"/>
    <path d="M232,170 L282,150 L282,242 L232,222 Z" fill="#e0f2fe" opacity="0.1" stroke="#e0f2fe" stroke-width="1"/>`);
};

// 14. Radioisotope Stirling: a finned plutonium heat-source block between two
// opposed Stirling cylinders - a dumbbell - glowing pale orange at the core.
ART['gen_radioisotope_stirling:primary'] = () => {
  const s = sky(227, ['#1a1410', '#050403']);
  return svg(s.defs + METAL('asrg') + HOT('pu'), `${s.base}
    ${hcyl(40, 200, 70, 18, 'url(#asrg)')}<rect x="190" y="182" width="70" height="36" fill="url(#asrg)"/><ellipse cx="190" cy="200" rx="6" ry="18" fill="#2b313c"/>
    ${[...Array(10)].map((_, i) => `<rect x="${118 + i * 6.4}" y="160" width="3" height="80" fill="#cbd5e1"/>`).join('')}
    <rect x="124" y="176" width="52" height="48" rx="6" fill="url(#pu)" filter="url(#glow)"/>
    <rect x="110" y="190" width="80" height="20" fill="#64748b" opacity="0.5"/>`);
};
// Triggered decay nuclear battery: a small dense hafnium pellet in a shielded
// cup, an X-ray tube aimed at it, gamma rays fanning out, a converter jacket.
ART['gen_radioisotope_stirling:secondary'] = () => {
  const s = sky(228, ['#120e24', '#030208']);
  return svg(s.defs, `${s.base}
    <path d="M110,176 L190,176 L182,246 L118,246 Z" fill="#374151" stroke="#94a3b8" stroke-width="2"/>
    <rect x="120" y="186" width="60" height="50" rx="6" fill="#1e1b4b" stroke="#a78bfa" stroke-width="1.5"/>
    <circle cx="150" cy="208" r="9" fill="#d1d5db" stroke="#ffffff" stroke-width="1"/>
    <rect x="200" y="140" width="56" height="20" rx="8" fill="#475569" stroke="#cbd5e1" stroke-width="1" transform="rotate(30 228 150)"/>
    <line x1="210" y1="166" x2="160" y2="202" stroke="#a78bfa" stroke-width="2" stroke-dasharray="4 3"/>
    ${[...Array(8)].map((_, i) => { const a = -Math.PI * 0.9 + i * 0.25; return `<line x1="150" y1="208" x2="${f(150 + 70 * Math.cos(a))}" y2="${f(208 + 70 * Math.sin(a))}" stroke="#4ade80" stroke-width="1" opacity="0.6"/>`; }).join('')}`);
};

// 15. Rankine MHD: a boiler, a straight duct between big magnet poles with
// electrodes on its walls, a condenser - a silvery liquid-metal loop, no
// spinning parts.
ART['gen_rankine_mhd:primary'] = () => {
  const s = sky(229, ['#141a24', '#030507']);
  return svg(s.defs + lin('lm', [[0, '#e5e7eb'], [0.5, '#9ca3af'], [1, '#e5e7eb']]), `${s.base}
    <rect x="30" y="170" width="44" height="60" rx="8" fill="#7c2d12" stroke="#fb923c" stroke-width="1.5"/><rect x="38" y="180" width="28" height="40" fill="#f97316" opacity="0.6"/>
    <rect x="74" y="190" width="140" height="20" fill="url(#lm)"/>
    <rect x="110" y="166" width="70" height="20" rx="3" fill="#1d4ed8" stroke="#93c5fd" stroke-width="1"/><rect x="110" y="214" width="70" height="20" rx="3" fill="#b91c1c" stroke="#fca5a5" stroke-width="1"/>
    ${[...Array(6)].map((_, i) => `<rect x="${116 + i * 11}" y="186" width="5" height="4" fill="#facc15"/><rect x="${116 + i * 11}" y="210" width="5" height="4" fill="#facc15"/>`).join('')}
    ${pipe('M214,200 L250,200 L250,250 L52,250 L52,230', '#cbd5e1', 5)}
    ${finPanel(232, 140, 54, 44, 6)}${bolt(140, 132, 1)}`);
};
// MHD open-cycle: a flared channel with saddle magnet coils and electrode
// strips, hot seeded plasma blasting through and vented out the back.
ART['gen_rankine_mhd:secondary'] = () => {
  const s = sky(230, ['#1a1028', '#040208']);
  return svg(s.defs + lin('opc', [[0, '#ffffff'], [0.3, '#fb923c', 0.9], [1, '#f97316', 0]], 0, 0, 1, 0), `${s.base}
    <rect x="22" y="182" width="40" height="36" rx="6" fill="#475569" stroke="#cbd5e1" stroke-width="1"/>
    <path d="M62,186 L200,174 L200,226 L62,214 Z" fill="#334155" stroke="#94a3b8" stroke-width="1.5"/>
    <path d="M62,192 L300,170 L300,230 L62,208 Z" fill="url(#opc)" opacity="0.85" filter="url(#glow)"/>
    ${[90, 130, 170].map((x) => `<path d="M${x},168 Q${x + 14},158 ${x + 28},168 L${x + 28},232 Q${x + 14},242 ${x},232 Z" fill="none" stroke="#e3954f" stroke-width="5"/>`).join('')}
    ${[...Array(7)].map((_, i) => `<rect x="${72 + i * 18}" y="${184 - i * 1.6}" width="6" height="3" fill="#facc15"/>`).join('')}`);
};

// 16. Rankine solar dynamic (the Space Station solar-dynamic module): a big
// offset dish tiled with HEXAGONAL mirror facets, a cavity receiver ringed
// with thermal-storage canisters (it runs through eclipse), a fluid loop
// piping hot toluene to a SEPARATE turbo-alternator, and big radiator panels.
// The plumbing is what sets it apart from the Solar Stirling dish.
ART['gen_rankine_solar_dynamic:primary'] = () => {
  const s = sky(231, ['#1a1610', '#050403'], ['90%', '30%']);
  let hex = '';
  const R = 9, dx = R * 1.5, dy = R * Math.sqrt(3);
  for (let c = -5; c <= 5; c++) for (let r = -6; r <= 6; r++) {
    const x = c * dx, y = r * dy + (c % 2 ? dy / 2 : 0);
    if ((x / 46) ** 2 + (y / 80) ** 2 > 1) continue;
    const pts = [...Array(6)].map((_, i) => `${f(x + Math.cos(i * Math.PI / 3) * R * 0.92)},${f(y + Math.sin(i * Math.PI / 3) * R * 0.92)}`).join(' ');
    hex += `<polygon points="${pts}" fill="url(#hxf)" stroke="#57534e" stroke-width="0.8"/>`;
  }
  return svg(s.defs + lin('hxf', [[0, '#fef3c7'], [0.5, '#d6d3d1'], [1, '#a8a29e']], 0, 0, 1, 1), `${s.base}${sun(300, 150, 80)}
    ${[150, 180, 210, 240].map((y) => `<line x1="300" y1="${y - 10}" x2="82" y2="${y}" stroke="#fde68a" stroke-width="1" opacity="0.25"/><line x1="82" y1="${y}" x2="150" y2="200" stroke="#f59e0b" stroke-width="1" opacity="0.5"/>`).join('')}
    <g transform="translate(70 200) rotate(-14) scale(0.62 1)">${hex}</g>
    <line x1="74" y1="118" x2="146" y2="192" stroke="#57534e" stroke-width="2"/><line x1="66" y1="282" x2="146" y2="208" stroke="#57534e" stroke-width="2"/>
    <rect x="146" y="184" width="30" height="32" rx="5" fill="#475569" stroke="#1f2937" stroke-width="1.5"/>
    <circle cx="150" cy="200" r="6" fill="#fff7d6" filter="url(#glow)"/>
    ${[0, 1, 2].map((i) => `<rect x="${178}" y="${186 + i * 10}" width="12" height="8" rx="2" fill="#b45309" stroke="#1f2937" stroke-width="0.8"/>`).join('')}
    <path d="M190,192 L212,192 L212,156 L236,156" stroke="#dc2626" stroke-width="3" fill="none"/>
    <path d="M190,210 L222,210 L222,176 L236,176" stroke="#2563eb" stroke-width="3" fill="none"/>
    <rect x="236" y="148" width="22" height="36" rx="4" fill="#94a3b8" stroke="#1f2937" stroke-width="1.5"/>
    <path d="M258,152 L276,146 L276,186 L258,180 Z" fill="#64748b" stroke="#1f2937"/>
    ${[0, 1, 2, 3].map((i) => `<line x1="${262 + i * 4}" y1="${151 - i * 1.5}" x2="${262 + i * 4}" y2="${181 + i * 1.5}" stroke="#cbd5e1" stroke-width="1"/>`).join('')}
    <line x1="230" y1="214" x2="230" y2="232" stroke="#1f2937" stroke-width="2"/>
    ${finPanel(196, 232, 100, 38, 9)}`);
};
// Rankine multiphase: a reactor feeding a boiler drum where liquid metal boils
// - bubbles in clear pipes - a turbine and a condenser radiator.
ART['gen_rankine_solar_dynamic:secondary'] = () => {
  const s = sky(232, ['#141a14', '#030503']);
  const rnd = seeded(232);
  let bub = '';
  for (let i = 0; i < 24; i++) bub += `<circle cx="${f(104 + rnd() * 52)}" cy="${f(168 + rnd() * 54)}" r="${f(1.5 + rnd() * 3)}" fill="none" stroke="#f1f5f9" stroke-width="1"/>`;
  return svg(s.defs + METAL('rm'), `${s.base}
    <rect x="22" y="168" width="44" height="64" rx="10" fill="url(#rm)"/><rect x="34" y="184" width="20" height="32" fill="#facc15" opacity="0.6" filter="url(#glow)"/>
    <rect x="98" y="160" width="64" height="70" rx="12" fill="#cbd5e1" opacity="0.25" stroke="#e5e7eb" stroke-width="2"/>
    <rect x="102" y="196" width="56" height="30" fill="#9ca3af" opacity="0.7"/>${bub}
    ${pipe('M66,200 L98,200', '#e5e7eb', 4)}${pipe('M162,176 L196,176', '#e5e7eb', 4)}
    <path d="M196,166 L222,158 L222,194 L196,186 Z" fill="#64748b" stroke="#cbd5e1" stroke-width="1"/>
    ${finPanel(232, 150, 52, 90, 6)}${pipe('M222,176 L232,176', '#e5e7eb', 3)}`);
};

// 17. Solar Stirling: a parabolic dish with a boxy Stirling engine and
// alternator on a tripod at its focus, the heater head glowing.
ART['gen_solar_stirling:primary'] = () => {
  const s = sky(233, ['#1a1610', '#050403'], ['90%', '30%']);
  // Dish-Stirling: a smooth (inflatable) dish, and the free-piston Stirling
  // engine + alternator hung RIGHT AT the focus on a tripod boom, its hot head
  // facing into the dish and a finned cold end behind. No pipes, no turbine.
  return svg(s.defs + DISH + lin('stc', [[0, '#e2e8f0'], [0.5, '#94a3b8'], [1, '#475569']]), `${s.base}${sun(300, 150, 80)}
    ${[150, 180, 210, 240].map((y) => `<line x1="300" y1="${y - 10}" x2="70" y2="${y}" stroke="#fde68a" stroke-width="1" opacity="0.2"/>`).join('')}
    ${dish(64, 200, 80, 180)}
    <path d="M60,124 Q100,200 60,276" fill="none" stroke="#e0f2fe" stroke-width="3" opacity="0.6"/>
    ${[140, 170, 200, 230, 260].map((y) => `<line x1="74" y1="${y}" x2="150" y2="200" stroke="#f59e0b" stroke-width="1" opacity="0.5"/>`).join('')}
    <line x1="68" y1="126" x2="152" y2="190" stroke="#57534e" stroke-width="2"/><line x1="68" y1="274" x2="152" y2="210" stroke="#57534e" stroke-width="2"/><line x1="78" y1="200" x2="146" y2="200" stroke="#57534e" stroke-width="2"/>
    <circle cx="150" cy="200" r="11" fill="#fb923c" filter="url(#glow)"/>
    <rect x="150" y="188" width="18" height="24" rx="4" fill="#7c2d12" stroke="#1f2937" stroke-width="1.2"/>
    <rect x="168" y="186" width="40" height="28" rx="6" fill="url(#stc)" stroke="#1f2937" stroke-width="1.4"/>
    ${[...Array(7)].map((_, i) => `<rect x="${210 + i * 5}" y="180" width="3" height="40" rx="1" fill="#64748b" stroke="#1f2937" stroke-width="0.5"/>`).join('')}
    <rect x="246" y="192" width="16" height="16" rx="3" fill="#94a3b8" stroke="#1f2937"/>
    ${bolt(270, 178, 0.9)}`);
};
// Thermo-photovoltaic: a glowing ember of an emitter in a box lined with dark
// PV cells, sun-heated through a small lens window.
ART['gen_solar_stirling:secondary'] = () => {
  const s = sky(234, ['#1c1210', '#050303'], ['10%', '30%']);
  return svg(s.defs + HOT('emit'), `${s.base}${sun(0, 150, 70)}
    ${[170, 190, 210].map((y) => `<line x1="0" y1="${y - 20}" x2="96" y2="200" stroke="#fde68a" stroke-width="1" opacity="0.45"/>`).join('')}
    <ellipse cx="98" cy="200" rx="5" ry="14" fill="#bae6fd" opacity="0.8"/>
    <rect x="102" y="150" width="120" height="100" rx="6" fill="#111827" stroke="#cbd5e1" stroke-width="2"/>
    ${[...Array(5)].map((_, i) => `<rect x="${108 + i * 22}" y="154" width="20" height="12" fill="#1e3a8a" stroke="#60a5fa" stroke-width="0.6"/><rect x="${108 + i * 22}" y="234" width="20" height="12" fill="#1e3a8a" stroke="#60a5fa" stroke-width="0.6"/>`).join('')}
    <rect x="140" y="182" width="50" height="36" rx="6" fill="url(#emit)" filter="url(#glow)"/>
    ${[...Array(6)].map((_, i) => `<line x1="165" y1="200" x2="${f(165 + 40 * Math.cos(i * 1.05))}" y2="${f(200 + 34 * Math.sin(i * 1.05))}" stroke="#f87171" stroke-width="1" opacity="0.5"/>`).join('')}`);
};

for (const id of Object.keys(PATENTS_BY_ID).filter((k) => PATENTS_BY_ID[k].type === 'generator')) {
  for (const face of ['primary', 'secondary']) {
    if (!ART[`${id}:${face}`]) throw new Error(`generator art missing: ${id}:${face}`);
  }
}
