// Reactor deck art: 12 cards x 2 faces. A reactor is the power plant a
// thruster or generator draws on, so each face draws ITS machine as a cutaway
// floating in the open lower half of the card, axis left-to-right with any
// exhaust leaving to the right. Shapes come from research (Eklund's card texts
// reprinted on Atomic Rockets, plus the real technology): NERVA hex fuel and
// control drums, a jar of pebbles, glass light bulbs, a torus with D coils, a
// needle mirror, railgun barrels, an Orion pusher plate. White faces sit on
// the cream card, so they use dark outlines and saturated glows (a pale
// device vanishes on cream). See docs/card-art-guide.md.
import { PATENTS_BY_ID } from '../../data/patents.js';
import { f, lin, rad, space, stars, svg, seeded, beam } from './kit.mjs';

export const ART = {};
export const RIG = {};

const INK = '#1f2937';
const METAL = (id) => lin(id, [[0, '#94a3b8'], [0.45, '#e2e8f0'], [1, '#475569']]);
const GLOW = (id, c0, c1) => rad(id, [[0, '#ffffff'], [0.35, c0], [1, c1, 0]]);
// Faces with no thrust triangle (the SCOOP trap backs) carry their text up top
// instead, so their device stays low.
const LOW = new Set([514]);
function scene(side, seed, defs, body) {
  const b = side === 'primary'
    ? { defs: `<radialGradient id="bg"><stop offset="0" stop-color="#000"/></radialGradient>`, body: `<rect width="300" height="288" fill="url(#bg)"/>` }
    : space('#151a2c', '#04050a');
  // The device is drawn centred on y=212, then lifted into the open band
  // around the thrust triangle: the supports box and ability text fill the
  // lower card, so art there hides behind them (same fix as the Bernals).
  return svg(b.defs + METAL('mt') + defs, `${b.body}${side === 'primary' ? '' : stars(40, seed)}<g transform="translate(15 ${LOW.has(seed) ? -20 : -112}) scale(0.9)">${body}</g>`);
}
// Bell nozzle opening RIGHT from (x, y).
function noz(x, y, len = 46, w0 = 10, w1 = 30) {
  return `<path d="M${x},${y - w0} Q${x + len * 0.6},${y - w0} ${x + len},${y - w1} L${x + len},${y + w1} Q${x + len * 0.6},${y + w0} ${x},${y + w0} Z" fill="url(#mt)" stroke="${INK}" stroke-width="1.4"/>`;
}
function plume(x, y, len, w, c, id) {
  return `<defs>${lin(id, [[0, c, 0.95], [1, c, 0]], 0, 0, 1, 0)}</defs><path d="M${x},${y - w * 0.6} Q${x + len * 0.5},${y - w} ${x + len},${y - w * 0.3} L${x + len},${y + w * 0.3} Q${x + len * 0.5},${y + w} ${x},${y + w * 0.6} Z" fill="url(#${id})"/>`;
}
function coil(cx, cy, rx, ry, c = '#b45309', w = 4) {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${INK}" stroke-width="${w + 2}"/><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${c}" stroke-width="${w}"/>`;
}
function caps(x, y, n, w = 12, h = 18) {
  return [...Array(n)].map((_, i) => `<rect x="${x + i * (w + 3)}" y="${y}" width="${w}" height="${h}" rx="2" fill="#475569" stroke="${INK}"/><rect x="${x + i * (w + 3) + 3}" y="${y - 3}" width="${w - 6}" height="3" fill="#cbd5e1"/>`).join('');
}
function hexCell(cx, cy, r, fill) {
  const p = [...Array(6)].map((_, i) => { const a = Math.PI / 3 * i; return `${f(cx + Math.cos(a) * r)},${f(cy + Math.sin(a) * r)}`; }).join(' ');
  return `<polygon points="${p}" fill="${fill}" stroke="${INK}" stroke-width="0.6"/>`;
}

// 1. Cermet NERVA: hydrogen tank, a core of hex fuel elements glowing
// orange-white inside a ring of control drums, then a long bell.
ART['rea_cermet_nerva_fission:primary'] = () => scene('primary', 501, GLOW('hx', '#fb923c', '#9a3412'),
  `<ellipse cx="62" cy="214" rx="40" ry="34" fill="url(#mt)" stroke="${INK}" stroke-width="1.4"/>
   <rect x="98" y="200" width="16" height="28" fill="#64748b" stroke="${INK}"/>
   <circle cx="150" cy="214" r="38" fill="#334155" stroke="${INK}" stroke-width="2"/>
   ${[...Array(8)].map((_, i) => { const a = i * Math.PI / 4; const x = 150 + Math.cos(a) * 32, y = 214 + Math.sin(a) * 32; return `<circle cx="${f(x)}" cy="${f(y)}" r="6" fill="#e2e8f0" stroke="${INK}"/><path d="M${f(x)},${f(y - 6)} A6,6 0 0 1 ${f(x)},${f(y + 6)} Z" fill="#111827"/>`; }).join('')}
   <circle cx="150" cy="214" r="24" fill="url(#hx)"/>
   ${[[0, 0], [9, 5], [-9, 5], [9, -5], [-9, -5], [0, 10], [0, -10]].map(([x, y]) => hexCell(150 + x, 214 + y, 5, 'none')).join('')}
   ${noz(188, 214, 70, 12, 36)}${plume(258, 214, 42, 28, '#93c5fd', 'p1')}`);
// Pulsed NTR: the same tank-core-bell, but the core is separate pulsed cells
// with fast rods, strobing Cherenkov blue.
ART['rea_cermet_nerva_fission:secondary'] = () => scene('secondary', 502, GLOW('cb', '#38bdf8', '#1e3a8a'),
  `<ellipse cx="62" cy="214" rx="40" ry="34" fill="url(#mt)" stroke="${INK}"/>
   <rect x="98" y="200" width="16" height="28" fill="#64748b"/>
   <rect x="114" y="174" width="74" height="80" rx="8" fill="#1e293b" stroke="#94a3b8" stroke-width="2"/>
   ${[...Array(5)].map((_, i) => `<rect x="${121 + i * 13}" y="184" width="8" height="60" rx="3" fill="url(#cb)"/><rect x="${122 + i * 13}" y="${170 - (i % 2) * 10}" width="6" height="${14 + (i % 2) * 10}" fill="#e2e8f0"/>`).join('')}
   <circle cx="151" cy="214" r="46" fill="#38bdf8" opacity="0.18" filter="url(#soft)"/>
   ${[0, 1, 2].map((i) => `<line x1="${110 - i * 6}" y1="${160 + i * 4}" x2="${120 + i * 4}" y2="${172 + i * 2}" stroke="#7dd3fc" stroke-width="1.4"/>`).join('')}
   ${noz(188, 214, 70, 12, 36)}${plume(258, 214, 42, 28, '#e0f2fe', 'p2')}`);

// 2. D-D Magneto-Inertial: a spherical chamber studded with plasma-gun
// barrels pointing in, jets converging on a bright point, magnetic nozzle out.
ART['rea_d_d_fusion_magneto_inertial:primary'] = () => scene('primary', 503, GLOW('mi', '#f472b6', '#9d174d'),
  `<circle cx="140" cy="212" r="56" fill="#e2e8f0" stroke="${INK}" stroke-width="2"/>
   ${[...Array(12)].map((_, i) => { const a = i * Math.PI / 6; const x1 = 140 + Math.cos(a) * 56, y1 = 212 + Math.sin(a) * 56, x2 = 140 + Math.cos(a) * 74, y2 = 212 + Math.sin(a) * 74; return `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${INK}" stroke-width="7"/><line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="#94a3b8" stroke-width="4"/><line x1="${f(140 + Math.cos(a) * 52)}" y1="${f(212 + Math.sin(a) * 52)}" x2="${f(140 + Math.cos(a) * 12)}" y2="${f(212 + Math.sin(a) * 12)}" stroke="#db2777" stroke-width="1.6" opacity="0.8"/>`; }).join('')}
   <circle cx="140" cy="212" r="14" fill="url(#mi)"/>
   ${coil(214, 212, 6, 26)}${coil(232, 212, 6, 32)}`);
// H-B Reciprocating Plasmoid: a mirror-symmetric barbell tube, two smoke-ring
// plasmoids flying at each other into a fat compression section.
ART['rea_d_d_fusion_magneto_inertial:secondary'] = () => scene('secondary', 504, '',
  `<rect x="20" y="198" width="260" height="28" rx="12" fill="#1e293b" stroke="#94a3b8" stroke-width="1.5"/>
   ${[...Array(9)].map((_, i) => `<rect x="${30 + i * 12}" y="190" width="6" height="44" rx="2" fill="#b45309"/><rect x="${264 - i * 12}" y="190" width="6" height="44" rx="2" fill="#b45309"/>`).join('')}
   <rect x="138" y="180" width="24" height="64" rx="6" fill="#b45309" stroke="#fbbf24"/>
   ${[100, 200].map((x) => `<ellipse cx="${x}" cy="212" rx="8" ry="11" fill="none" stroke="#c4b5fd" stroke-width="4" filter="url(#glow)"/>`).join('')}
   <path d="M114,212 l14,0 M186,212 l-14,0" stroke="#e9d5ff" stroke-width="1.5" stroke-dasharray="3 3"/>`);

// 3. D-T Tokamak: a cored-apple spherical torus - D-shaped field coils round a
// violet plasma doughnut, a central column, heavy shield, exhaust out a pole.
ART['rea_d_t_fusion_tokamak:primary'] = () => scene('primary', 505, GLOW('tk', '#c084fc', '#6b21a8'),
  `<ellipse cx="140" cy="212" rx="78" ry="44" fill="#475569" stroke="${INK}" stroke-width="2"/>
   <ellipse cx="140" cy="212" rx="60" ry="30" fill="url(#tk)"/>
   <ellipse cx="140" cy="212" rx="22" ry="12" fill="#1f2937"/>
   <rect x="134" y="164" width="12" height="96" fill="#cbd5e1" stroke="${INK}"/>
   ${[-60, -36, -12, 12, 36, 60].map((x) => `<path d="M${140 + x},${212 - 46} q${x > 0 ? 18 : -18},46 0,92" fill="none" stroke="#b45309" stroke-width="5"/>`).join('')}
   <rect x="58" y="196" width="10" height="32" fill="#334155"/>
   ${noz(218, 212, 40, 10, 24)}${plume(258, 212, 42, 20, '#d8b4fe', 'p3')}`);
// Antimatter GDM: a needle - a very long thin tube wrapped in ring coils,
// choke mirrors at both ends, an antiproton trap at the closed end.
ART['rea_d_t_fusion_tokamak:secondary'] = () => scene('secondary', 506, lin('gd', [[0, '#c084fc'], [1, '#f0abfc']], 0, 0, 1, 0),
  `<rect x="22" y="200" width="24" height="24" rx="6" fill="#334155" stroke="#e879f9" stroke-width="1.5"/><circle cx="34" cy="212" r="4" fill="#f0abfc" filter="url(#glow)"/>
   <rect x="46" y="208" width="210" height="8" fill="url(#gd)" filter="url(#glow)"/>
   ${[...Array(16)].map((_, i) => { const x = 54 + i * 13, ch = i < 2 || i > 13; return `<rect x="${x}" y="${ch ? 196 : 201}" width="${ch ? 7 : 5}" height="${ch ? 32 : 22}" rx="2" fill="#b45309"/>`; }).join('')}
   ${plume(256, 212, 44, 10, '#f0abfc', 'p4')}`);

// 4. D-T Gun Fusion: two long railgun barrels converge on a small cup, a
// flash under it, capacitor banks behind.
ART['rea_d_t_gun_fusion:primary'] = () => scene('primary', 507, GLOW('gf', '#facc15', '#c2410c'),
  `<path d="M20,160 L176,206" stroke="${INK}" stroke-width="10"/><path d="M20,160 L176,206" stroke="#94a3b8" stroke-width="6"/>
   <path d="M20,264 L176,218" stroke="${INK}" stroke-width="10"/><path d="M20,264 L176,218" stroke="#94a3b8" stroke-width="6"/>
   ${caps(24, 196, 4)}
   <path d="M196,190 A24,24 0 0 1 196,234" fill="#e2e8f0" stroke="${INK}" stroke-width="3"/>
   <circle cx="184" cy="212" r="16" fill="url(#gf)"/>
   ${coil(224, 212, 6, 26)}${coil(244, 212, 6, 32)}`);
// Macron Blowpipe: one enormously long spinal accelerator, a train of pellets
// streaking down it into a tiny target chamber.
ART['rea_d_t_gun_fusion:secondary'] = () => scene('secondary', 508, GLOW('mb', '#fde047', '#c2410c'),
  `<rect x="0" y="206" width="236" height="12" fill="#334155" stroke="#94a3b8"/>
   ${[...Array(10)].map((_, i) => `<rect x="${8 + i * 23}" y="202" width="4" height="20" fill="#64748b"/>`).join('')}
   ${[...Array(8)].map((_, i) => `<circle cx="${70 + i * 20}" cy="212" r="2" fill="#fde047" opacity="${f(0.4 + i * 0.08)}"/><line x1="${62 + i * 20}" y1="212" x2="${68 + i * 20}" y2="212" stroke="#fde047" stroke-width="1" opacity="0.5"/>`).join('')}
   <circle cx="250" cy="212" r="18" fill="#1e293b" stroke="#cbd5e1" stroke-width="2"/><circle cx="250" cy="212" r="9" fill="url(#mb)"/>
   ${plume(266, 212, 34, 16, '#fde68a', 'p5')}`);

// 5. Lyman Alpha Trap: a small vacuum cell where six violet UV laser beams
// cross on a tiny atom cloud, magnet coils at the poles.
ART['rea_lyman_alpha_trap:primary'] = () => scene('primary', 509, GLOW('ly', '#a78bfa', '#4c1d95'),
  `<rect x="96" y="168" width="108" height="88" rx="10" fill="#e2e8f0" stroke="${INK}" stroke-width="2"/>
   <rect x="108" y="180" width="84" height="64" rx="6" fill="#1e1b4b"/>
   ${[[30, 212, 270, 212], [150, 140, 150, 284], [60, 160, 240, 264], [60, 264, 240, 160]].map(([a, b, c, d]) => `<line x1="${a}" y1="${b}" x2="${c}" y2="${d}" stroke="#7c3aed" stroke-width="2.4" opacity="0.85"/>`).join('')}
   <circle cx="150" cy="212" r="9" fill="url(#ly)"/>
   ${coil(150, 172, 30, 6)}${coil(150, 252, 30, 6)}`);
// Free Radical H Trap: an Ioffe-Pritchard trap - four long current bars round
// a cell, pinch coils at each end, a cigar of condensate on the axis.
ART['rea_lyman_alpha_trap:secondary'] = () => scene('secondary', 510, GLOW('fr', '#7dd3fc', '#0c4a6e'),
  `<rect x="50" y="176" width="200" height="72" rx="30" fill="#0f172a" stroke="#64748b" stroke-width="2"/>
   ${[186, 200, 224, 238].map((y) => `<rect x="62" y="${y - 3}" width="176" height="6" rx="3" fill="#b45309"/>`).join('')}
   <ellipse cx="150" cy="212" rx="56" ry="8" fill="url(#fr)"/>
   ${coil(66, 212, 8, 34, '#b45309', 5)}${coil(234, 212, 8, 34, '#b45309', 5)}`);

// 6. Metallic Hydrogen: silvery-metallic fuel ingots feeding a white-hot
// chamber and short bell, water injected to cool the walls.
ART['rea_metallic_hydrogen:primary'] = () => scene('primary', 511, lin('mh', [[0, '#f8fafc'], [0.4, '#94a3b8'], [0.6, '#e2e8f0'], [1, '#475569']]) + GLOW('wh', '#fef9c3', '#f97316'),
  `${[0, 1, 2].map((i) => `<rect x="${26 + i * 28}" y="194" width="24" height="36" rx="3" fill="url(#mh)" stroke="${INK}" stroke-width="1.4"/>`).join('')}
   <rect x="110" y="206" width="30" height="12" fill="#64748b" stroke="${INK}"/>
   <ellipse cx="172" cy="212" rx="32" ry="26" fill="#334155" stroke="${INK}" stroke-width="2"/>
   <circle cx="172" cy="212" r="18" fill="url(#wh)"/>
   <path d="M160,180 q4,-14 12,-14 q8,0 12,14" stroke="#0284c7" stroke-width="3" fill="none"/>
   ${noz(204, 212, 40, 12, 30)}${plume(244, 212, 50, 26, '#fef3c7', 'p6')}`);
// Fission-Augmented Inertial Fusion: a layered bullseye target (D-T in a
// uranium sleeve in a lithium liner) between pinch electrodes, capacitors.
ART['rea_metallic_hydrogen:secondary'] = () => scene('secondary', 512, GLOW('fa', '#fef9c3', '#f97316'),
  `${caps(30, 160, 4)}${caps(30, 246, 4)}
   <rect x="140" y="150" width="20" height="30" fill="#cbd5e1"/><rect x="140" y="244" width="20" height="30" fill="#cbd5e1"/>
   <circle cx="150" cy="212" r="34" fill="url(#fa)" opacity="0.7"/>
   <circle cx="150" cy="212" r="22" fill="#94a3b8"/><circle cx="150" cy="212" r="15" fill="#65a30d"/><circle cx="150" cy="212" r="8" fill="#fde68a"/>
   ${coil(214, 212, 6, 28)}${coil(234, 212, 6, 34)}${plume(240, 212, 56, 28, '#fde68a', 'p7')}`);

// 7. Mini-Mag RF Paul Trap: a ring electrode between two endcaps holding a
// speck of antimatter, inside big thin scoop loops funnelling the belt.
ART['rea_mini_mag_rf_paul_trap:primary'] = () => scene('primary', 513, GLOW('pt', '#e879f9', '#86198f'),
  `${coil(150, 212, 120, 54, '#0e7490', 2)}${coil(150, 212, 90, 40, '#0e7490', 2)}
   <path d="M110,190 Q150,174 190,190" stroke="${INK}" stroke-width="10" fill="none"/><path d="M110,190 Q150,174 190,190" stroke="#cbd5e1" stroke-width="7" fill="none"/>
   <path d="M110,234 Q150,250 190,234" stroke="${INK}" stroke-width="10" fill="none"/><path d="M110,234 Q150,250 190,234" stroke="#cbd5e1" stroke-width="7" fill="none"/>
   <ellipse cx="150" cy="212" rx="44" ry="10" fill="none" stroke="#b45309" stroke-width="6"/>
   <circle cx="150" cy="212" r="6" fill="url(#pt)"/>`);
// Ultracold Neutrons: a heavy-water moderator tank feeds a bladed UCN turbine
// that pours slow neutrons into a polished diamond-lined bottle.
ART['rea_mini_mag_rf_paul_trap:secondary'] = () => scene('secondary', 514, rad('dw', [[0, '#1e3a8a'], [1, '#0b1640']]) + rad('db', [[0, '#e0e7ff', 0.4], [0.6, '#312e81'], [1, '#0f0a2e']], '35%', '35%'),
  `<rect x="18" y="176" width="70" height="72" rx="8" fill="url(#dw)" stroke="#93c5fd" stroke-width="1.5"/>
   <circle cx="126" cy="212" r="26" fill="#1e293b" stroke="#cbd5e1" stroke-width="2"/>
   ${[...Array(8)].map((_, i) => { const a = i * Math.PI / 4; return `<path d="M126,212 L${f(126 + Math.cos(a) * 22)},${f(212 + Math.sin(a) * 22)} L${f(126 + Math.cos(a + 0.4) * 20)},${f(212 + Math.sin(a + 0.4) * 20)} Z" fill="#94a3b8"/>`; }).join('')}
   <path d="M152,212 L184,212" stroke="#64748b" stroke-width="6"/>
   <path d="M184,190 Q184,170 210,170 L250,170 Q272,170 272,212 Q272,254 250,254 L210,254 Q184,254 184,234 Z" fill="url(#db)" stroke="#c7d2fe" stroke-width="2"/>
   ${[...Array(10)].map((_, i) => `<circle cx="${204 + (i * 37) % 60}" cy="${186 + (i * 23) % 52}" r="1.8" fill="#e0e7ff" opacity="0.7"/>`).join('')}`);

// 8. Pebble Bed: a cutaway vessel packed with graphite fuel pebbles like a jar
// of marbles, coolant threading between them, a nozzle below.
ART['rea_pebble_bed_fission:primary'] = () => scene('primary', 515, rad('pb', [[0, '#9ca3af'], [0.7, '#374151'], [1, '#111827']], '35%', '35%'),
  (() => {
    const rnd = seeded(515);
    let peb = '';
    for (let r = 0; r < 6; r++) for (let c = 0; c < 9; c++) peb += `<circle cx="${f(86 + c * 13 + (r % 2) * 6)}" cy="${182 + r * 11}" r="6" fill="url(#pb)"/>${rnd() < 0.25 ? `<circle cx="${f(86 + c * 13 + (r % 2) * 6)}" cy="${182 + r * 11}" r="2" fill="#fb923c"/>` : ''}`;
    return `<rect x="72" y="166" width="132" height="92" rx="16" fill="#e2e8f0" stroke="${INK}" stroke-width="2"/>
      <rect x="78" y="172" width="120" height="80" rx="12" fill="#fed7aa"/>${peb}
      <path d="M96,166 L96,150 L180,150 L180,166" stroke="#0284c7" stroke-width="4" fill="none"/>
      ${noz(204, 212, 50, 12, 30)}${plume(254, 212, 46, 24, '#93c5fd', 'p8')}`;
  })());
// VCR Light Bulb: seven glass bulbs in a hex cluster inside a moderator
// block, each holding a swirling violet-white plasma.
ART['rea_pebble_bed_fission:secondary'] = () => scene('secondary', 516, rad('bulb', [[0, '#ffffff'], [0.4, '#c4b5fd'], [0.8, '#7c3aed', 0.6], [1, '#e0e7ff', 0.3]]),
  `<rect x="66" y="160" width="168" height="104" rx="14" fill="#292524" stroke="#a8a29e" stroke-width="2"/>
   ${[[150, 212], [118, 194], [182, 194], [118, 230], [182, 230], [102, 212], [198, 212]].slice(0, 7).map(([x, y], i) => `<ellipse cx="${i === 5 ? 92 : i === 6 ? 208 : x}" cy="${y}" rx="15" ry="17" fill="url(#bulb)" stroke="#e0e7ff" stroke-width="1.2"/>`).join('')}
   ${noz(234, 212, 34, 10, 22)}${plume(268, 212, 32, 18, '#c4b5fd', 'p9')}`);

// 9. Penning Trap: a tall thermos - a stack of ring electrodes in a
// superconducting solenoid inside a cryogenic dewar, a vacuum line, a tiny
// antiparticle cloud on the axis.
ART['rea_penning_trap:primary'] = () => scene('primary', 517, GLOW('pn', '#e879f9', '#86198f'),
  `<rect x="60" y="182" width="180" height="60" rx="28" fill="url(#mt)" stroke="${INK}" stroke-width="2"/>
   <rect x="80" y="192" width="140" height="40" rx="14" fill="#334155"/>
   ${[...Array(9)].map((_, i) => `<rect x="${90 + i * 14}" y="198" width="8" height="28" rx="2" fill="#b45309" stroke="${INK}" stroke-width="0.6"/>`).join('')}
   <circle cx="150" cy="212" r="5" fill="url(#pn)"/>
   <path d="M240,212 L272,212 L272,180" stroke="#64748b" stroke-width="5" fill="none"/><circle cx="272" cy="176" r="6" fill="#94a3b8" stroke="${INK}"/>`);
// 3He-D Mirror Cell: identical mirror cells end to end, 11 T coils with choke
// coils at each cell end, a direct converter at one end, thrust at the other.
ART['rea_penning_trap:secondary'] = () => scene('secondary', 518, lin('mc', [[0, '#5eead4'], [1, '#a5f3fc']], 0, 0, 1, 0),
  `<rect x="22" y="192" width="32" height="40" rx="4" fill="#334155" stroke="#94a3b8"/>${[0, 1, 2].map((i) => `<line x1="${28 + i * 8}" y1="196" x2="${28 + i * 8}" y2="228" stroke="#fde047" stroke-width="1.4"/>`).join('')}
   <rect x="54" y="207" width="190" height="10" fill="url(#mc)" filter="url(#glow)"/>
   ${[0, 1, 2].map((c) => `${[0, 1, 2, 3].map((i) => `<rect x="${62 + c * 62 + i * 12}" y="198" width="6" height="28" rx="2" fill="#b45309"/>`).join('')}<rect x="${54 + c * 62}" y="190" width="8" height="44" rx="2" fill="#f59e0b"/>`).join('')}
   ${plume(244, 212, 52, 18, '#99f6e4', 'p10')}`);

// 10. Project Orion: a huge tapered pusher plate, shock-absorber pistons, a
// bomb ejected through its centre bursting into a plasma disc behind.
ART['rea_project_orion:primary'] = () => scene('primary', 519, GLOW('ob', '#fef08a', '#ea580c'),
  `${[184, 200, 224, 240].map((y) => `<rect x="70" y="${y - 3}" width="70" height="6" fill="#94a3b8" stroke="${INK}"/>`).join('')}
   <rect x="54" y="170" width="20" height="84" rx="4" fill="#475569" stroke="${INK}"/>
   <path d="M140,140 L150,140 L156,212 L150,284 L140,284 L146,212 Z" fill="url(#mt)" stroke="${INK}" stroke-width="2"/>
   <circle cx="214" cy="212" r="28" fill="url(#ob)"/>
   <ellipse cx="196" cy="212" rx="12" ry="56" fill="#fdba74" opacity="0.5"/>`);
// Project Valkyrie: the engine out FRONT - a magnetic ring and chandelier
// nozzle jetting forward - towing a small shadow shield and the ship on long
// tethers behind.
ART['rea_project_orion:secondary'] = () => scene('secondary', 520, GLOW('vk', '#f0abfc', '#9d174d'),
  `<path d="M60,212 L0,196 L0,228 Z" fill="#f0abfc" opacity="0.5" filter="url(#glow)"/>
   ${coil(76, 212, 8, 28, '#e879f9', 5)}<circle cx="86" cy="212" r="8" fill="url(#vk)"/>
   ${[198, 212, 226].map((y) => `<line x1="94" y1="212" x2="270" y2="${y}" stroke="#94a3b8" stroke-width="0.8"/>`).join('')}
   <ellipse cx="146" cy="212" rx="4" ry="16" fill="#57534e"/>
   <rect x="214" y="200" width="22" height="24" rx="3" fill="#cbd5e1"/><rect x="244" y="198" width="34" height="28" rx="6" fill="#e2e8f0"/><rect x="250" y="206" width="6" height="4" fill="#fde68a"/>`);

// 11. Rubbia Thin Film: an enclosed hohlraum lined with a shimmering
// americium film inside thick graphite walls; fragment tracks streak in from
// the walls and heat the hydrogen running through the middle.
ART['rea_rubbia_thin_film_fission_hohlraum:primary'] = () => scene('primary', 521, lin('am', [[0, '#fbbf24'], [0.5, '#f472b6'], [1, '#a78bfa']], 0, 0, 1, 0),
  `<rect x="54" y="160" width="160" height="104" rx="18" fill="#1f2937" stroke="${INK}" stroke-width="2"/>
   <rect x="70" y="176" width="128" height="72" rx="10" fill="#fff7ed" stroke="url(#am)" stroke-width="4"/>
   ${[...Array(10)].map((_, i) => { const x = 80 + i * 12, top = i % 2; return `<line x1="${x}" y1="${top ? 180 : 244}" x2="${x + 6}" y2="${top ? 204 : 220}" stroke="#ea580c" stroke-width="1.4"/>`; }).join('')}
   <path d="M30,212 L70,212" stroke="#0284c7" stroke-width="5"/>
   <rect x="80" y="207" width="108" height="10" fill="#fb923c" opacity="0.7"/>
   ${noz(214, 212, 40, 12, 28)}${plume(254, 212, 46, 24, '#fed7aa', 'p11')}`);
// Positronium Bottle: a photonic crystal lattice of tiny glowing cells inside
// a thick lead shell, gamma rays bursting where cells release.
ART['rea_rubbia_thin_film_fission_hohlraum:secondary'] = () => scene('secondary', 522, GLOW('ps', '#5eead4', '#0f766e'),
  `<rect x="78" y="152" width="144" height="120" rx="20" fill="#44403c" stroke="#a8a29e" stroke-width="3"/>
   <rect x="96" y="170" width="108" height="84" rx="6" fill="#0f172a"/>
   ${[...Array(5)].map((_, r) => [...Array(7)].map((_, c) => `<circle cx="${108 + c * 14}" cy="${180 + r * 16}" r="${(r * 7 + c) % 5 ? 3 : 5}" fill="url(#ps)"/>`).join('')).join('')}
   ${[[222, 170, 290, 140], [222, 254, 290, 286], [78, 200, 12, 180]].map(([a, b, c, d]) => `<line x1="${a}" y1="${b}" x2="${c}" y2="${d}" stroke="#a7f3d0" stroke-width="2" stroke-dasharray="6 3"/>`).join('')}`);

// 12. Supercritical Water: a thick-walled steel capsule with a square lattice
// of fuel assemblies, big blue inlets low, one hot outlet jetting white.
ART['rea_supercritical_water_fission:primary'] = () => scene('primary', 523, '',
  `<rect x="90" y="150" width="110" height="124" rx="44" fill="url(#mt)" stroke="${INK}" stroke-width="3"/>
   <rect x="110" y="178" width="70" height="70" fill="#334155"/>
   ${[...Array(4)].map((_, r) => [...Array(4)].map((_, c) => `<rect x="${114 + c * 17}" y="${182 + r * 17}" width="13" height="13" fill="#f59e0b" stroke="${INK}" stroke-width="0.6"/>`).join('')).join('')}
   <path d="M20,248 L92,248" stroke="${INK}" stroke-width="12"/><path d="M20,248 L92,248" stroke="#0284c7" stroke-width="8"/>
   <path d="M198,174 L236,174" stroke="${INK}" stroke-width="12"/><path d="M198,174 L236,174" stroke="#ef4444" stroke-width="8"/>
   ${plume(236, 174, 60, 20, '#94a3b8', 'p12')}
   <circle cx="145" cy="150" r="10" fill="#e2e8f0" stroke="${INK}" stroke-width="1.5"/><line x1="145" y1="150" x2="151" y2="144" stroke="${INK}" stroke-width="1.5"/>`);
// H-6Li Fusor: two charged concentric spheres - an outer shell and an inner
// geodesic wire grid, a star in a jar at the centre with plasma spokes.
ART['rea_supercritical_water_fission:secondary'] = () => scene('secondary', 524, GLOW('fu', '#a5f3fc', '#0e7490'),
  `<circle cx="150" cy="212" r="60" fill="#0f172a" stroke="#94a3b8" stroke-width="3"/>
   <circle cx="150" cy="212" r="34" fill="none" stroke="#cbd5e1" stroke-width="1.4"/>
   ${[0, 30, 60, 90, 120, 150].map((a) => `<ellipse cx="150" cy="212" rx="34" ry="${f(Math.abs(Math.cos(a * Math.PI / 180)) * 34 + 2)}" fill="none" stroke="#cbd5e1" stroke-width="1" transform="rotate(${a} 150 212)"/>`).join('')}
   ${[...Array(8)].map((_, i) => { const a = i * Math.PI / 4 + 0.2; return `<line x1="150" y1="212" x2="${f(150 + Math.cos(a) * 34)}" y2="${f(212 + Math.sin(a) * 34)}" stroke="#67e8f9" stroke-width="2" opacity="0.8"/>`; }).join('')}
   <circle cx="150" cy="212" r="10" fill="url(#fu)"/>
   ${[0, 1, 2].map((i) => `<circle cx="150" cy="212" r="${70 + i * 8}" fill="none" stroke="#b45309" stroke-width="2" stroke-dasharray="20 14" opacity="0.6"/>`).join('')}`);

// A face with no supports box and no ability text has open card below its
// triangle, so its device drops down into that space instead of sitting
// behind the triangle (user 2026-11-13).
for (const p of Object.values(PATENTS_BY_ID)) {
  if (p.type !== 'reactor') continue;
  for (const side of ['primary', 'secondary']) {
    const fc = p.faces[side], key = `${p.id}:${side}`, draw = ART[key];
    if (!draw || (fc.requires || []).length || fc.ability) continue;
    ART[key] = () => draw().replace('translate(15 -112) scale(0.9)', 'translate(15 26) scale(0.9)');
  }
}
for (const p of Object.values(PATENTS_BY_ID)) {
  if (p.type !== 'reactor') continue;
  for (const side of ['primary', 'secondary']) {
    if (!ART[`${p.id}:${side}`]) throw new Error(`reactor art missing: ${p.id}:${side}`);
  }
}
