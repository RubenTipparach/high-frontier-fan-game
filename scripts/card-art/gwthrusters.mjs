// GW / TW thruster deck art (Module 1): 7 cards x 2 faces. Gigawatt fronts
// promote to Terawatt backs. Each face bolts its drive to a kit ship (RIG,
// hull running LEFT, exhaust RIGHT) and draws the machine from Eklund's
// designer notes (M1 rules 1Z2): antimatter-sparked pellet cups, plasma-focus
// squirrel cages, a levitated dipole ring, Mini-Mag coil cages, the Medusa
// canopy towed AHEAD of its ship, a salt-water plume longer than the ship,
// spheromak smoke rings, colliding FRCs, the VISTA cone, Daedalus's orange
// bell. Engines sit across the thrust-triangle band; the supports box covers
// the lower card. Black fronts on the dark card, purple backs washed through
// the promoted purple. See docs/card-art-guide.md.
import { PATENTS_BY_ID } from '../../data/patents.js';
import { f, lin, rad, stars, svg, seeded } from './kit.mjs';

export const ART = {};
export const RIG = {};

const Y = 118;   // the engine axis, across the triangle band
function scene(key, seed, defs, body) {
  const side = key.split(':')[1];
  const bg = side === 'primary'
    // M1 front (black) faces keep a space backdrop (user 2026-11-14), unlike
    // the patent decks' white fronts which sit straight on the cream card.
    ? `<radialGradient id="bg" cx="50%" cy="45%" r="85%"><stop offset="0%" stop-color="#141a2c"/><stop offset="100%" stop-color="#04050a"/></radialGradient>`
    : `<radialGradient id="bg" cx="50%" cy="44%" r="80%"><stop offset="0%" stop-color="#655ca8"/><stop offset="100%" stop-color="#652d91"/></radialGradient>`;
  return svg(bg + lin('mt', [[0, '#94a3b8'], [0.45, '#e2e8f0'], [1, '#475569']]) + defs,
    `<rect width="300" height="288" fill="url(#bg)"/>${stars(36, seed)}${body}`);
}
const ship = (key, mount, kind = 'crewed', extra = {}) => { RIG[key] = { mount, back: -90, kind, s: 0.5, ...extra }; };
const GL = (id, c0, c1) => rad(id, [[0, '#ffffff'], [0.35, c0], [1, c1, 0]]);
function plume(x, y, len, w, c, id, a = 0.95) {
  return `<defs>${lin(id, [[0, c, a], [1, c, 0]], 0, 0, 1, 0)}</defs><path d="M${x},${y - w * 0.6} Q${x + len * 0.5},${y - w} ${x + len},${y - w * 0.3} L${x + len},${y + w * 0.3} Q${x + len * 0.5},${y + w} ${x},${y + w * 0.6} Z" fill="url(#${id})"/>`;
}
function coil(x, y, ry, c = '#d97706', w = 4) {
  return `<ellipse cx="${x}" cy="${y}" rx="${f(ry * 0.22)}" ry="${ry}" fill="none" stroke="#1f2937" stroke-width="${w + 2}"/><ellipse cx="${x}" cy="${y}" rx="${f(ry * 0.22)}" ry="${ry}" fill="none" stroke="${c}" stroke-width="${w}"/>`;
}
const spine = (x1, x2) => `<line x1="${x1}" y1="${Y}" x2="${x2}" y2="${Y}" stroke="#94a3b8" stroke-width="3"/>`;

// 1. Amat-Catalyzed Fission-Fusion: fuel rings behind a LiH shield disc, ion
// ports converging on one point inside an open ablative cup, a magenta flash.
ship('gw-_amat_catalyzed_fission_fusion:primary', [90, Y]);
ART['gw-_amat_catalyzed_fission_fusion:primary'] = () => scene('gw-_amat_catalyzed_fission_fusion:primary', 701, GL('ac', '#f0abfc', '#a21caf'),
  `${spine(90, 190)}${[118, 138].map((x) => `<ellipse cx="${x}" cy="${Y}" rx="5" ry="18" fill="none" stroke="#cbd5e1" stroke-width="3"/>`).join('')}
   <ellipse cx="162" cy="${Y}" rx="5" ry="26" fill="#475569" stroke="#94a3b8"/>
   <path d="M232,${Y - 50} Q186,${Y} 232,${Y + 50}" fill="none" stroke="#a8a29e" stroke-width="8"/>
   ${[-1, 1].map((s) => `<line x1="184" y1="${Y + s * 30}" x2="206" y2="${Y + s * 4}" stroke="#7dd3fc" stroke-width="1.6"/>`).join('')}
   <circle cx="212" cy="${Y}" r="20" fill="url(#ac)"/>${plume(232, Y, 60, 44, '#f0abfc', 'g1', 0.6)}`);
// Amat-Initiated H-B Magnetic-Inertial: a slimmer coil-ringed chamber, a pellet
// feed tube, a magnetic nozzle of rings, a white-magenta flash.
ship('gw-_amat_catalyzed_fission_fusion:secondary', [100, Y]);
ART['gw-_amat_catalyzed_fission_fusion:secondary'] = () => scene('gw-_amat_catalyzed_fission_fusion:secondary', 702, GL('ai', '#fbcfe8', '#db2777'),
  `${spine(100, 170)}${[...Array(5)].map((_, i) => `<circle cx="${120 + i * 9}" cy="${Y - 8}" r="2.4" fill="#64748b"/>`).join('')}
   <rect x="166" y="${Y - 16}" width="34" height="32" rx="8" fill="#334155" stroke="#cbd5e1"/>
   <circle cx="184" cy="${Y}" r="11" fill="url(#ai)"/>
   ${[206, 220, 234].map((x, i) => coil(x, Y, 18 + i * 8)).join('')}${plume(238, Y, 60, 26, '#fbcfe8', 'g2', 0.75)}`);

// 2. Dense Plasma H-B Focus: a squirrel cage of cathode rods round a central
// anode, a pinched plasmoid at the open tip, a capacitor bank, a narrow jet.
ship('gw-_dense_plasma_h_b_focus_fusion:primary', [92, Y]);
ART['gw-_dense_plasma_h_b_focus_fusion:primary'] = () => scene('gw-_dense_plasma_h_b_focus_fusion:primary', 703, GL('dp', '#a5f3fc', '#0891b2'),
  `${spine(92, 140)}${[0, 1, 2].map((i) => `<rect x="${110 + i * 12}" y="${Y - 26}" width="10" height="16" rx="2" fill="#475569" stroke="#cbd5e1"/>`).join('')}
   <rect x="150" y="${Y - 4}" width="70" height="8" rx="3" fill="#fbbf24"/>
   ${[-18, -9, 0, 9, 18].map((d) => `<line x1="150" y1="${Y + d}" x2="218" y2="${Y + d * 0.7}" stroke="#cbd5e1" stroke-width="2"/>`).join('')}
   <circle cx="224" cy="${Y}" r="9" fill="url(#dp)"/>${plume(230, Y, 70, 9, '#a5f3fc', 'g3')}`);
// Crossfire H-B Focus: six ion-gun arms like a 3D jack firing inward at a
// glowing magnetic cusp.
ship('gw-_dense_plasma_h_b_focus_fusion:secondary', [104, Y]);
ART['gw-_dense_plasma_h_b_focus_fusion:secondary'] = () => scene('gw-_dense_plasma_h_b_focus_fusion:secondary', 704, GL('cf', '#fef08a', '#ea580c'),
  `${spine(104, 160)}
   ${[...Array(6)].map((_, i) => { const a = i * Math.PI / 3 + Math.PI / 6, x = 196 + Math.cos(a) * 42, y = Y + Math.sin(a) * 42; return `<line x1="${f(x)}" y1="${f(y)}" x2="196" y2="${Y}" stroke="#fde047" stroke-width="1.2" stroke-dasharray="3 2"/><rect x="${f(x - 8)}" y="${f(y - 6)}" width="16" height="12" rx="3" fill="#475569" stroke="#cbd5e1" transform="rotate(${f(a * 180 / Math.PI)} ${f(x)} ${f(y)})"/>`; }).join('')}
   <circle cx="196" cy="${Y}" r="13" fill="url(#cf)"/>${plume(238, Y, 56, 14, '#fde68a', 'g4')}`);

// 3. Levitated Dipole 6Li-H: a superconducting ring floating inside a round
// chamber, a dipole halo of plasma around it like a mini magnetosphere.
ship('gw-_levitated_dipole_6li_h_fusion:primary', [110, Y]);
ART['gw-_levitated_dipole_6li_h_fusion:primary'] = () => scene('gw-_levitated_dipole_6li_h_fusion:primary', 705, '',
  `${spine(110, 150)}<circle cx="192" cy="${Y}" r="44" fill="#0f172a" stroke="#94a3b8" stroke-width="2"/>
   ${[1, 0.7].map((k) => `<path d="M192,${Y} C${f(192 + 46 * k)},${f(Y - 50 * k)} ${f(192 + 46 * k)},${f(Y + 50 * k)} 192,${Y} C${f(192 - 46 * k)},${f(Y - 50 * k)} ${f(192 - 46 * k)},${f(Y + 50 * k)} 192,${Y}" fill="#c084fc" fill-opacity="0.15" stroke="#e9d5ff" stroke-width="1"/>`).join('')}
   <ellipse cx="192" cy="${Y}" rx="22" ry="6" fill="none" stroke="#d97706" stroke-width="5"/>
   ${plume(236, Y, 60, 14, '#d8b4fe', 'g5')}`);
// Dusty Plasma: a sparkling cloud of uranium dust in a moderator vessel, ring
// coils for the nozzle, very large radiators.
ship('gw-_levitated_dipole_6li_h_fusion:secondary', [100, Y]);
ART['gw-_levitated_dipole_6li_h_fusion:secondary'] = () => scene('gw-_levitated_dipole_6li_h_fusion:secondary', 706, '',
  (() => {
    const rnd = seeded(706);
    let dust = '';
    for (let i = 0; i < 36; i++) dust += `<circle cx="${f(170 + (rnd() - 0.5) * 50)}" cy="${f(Y + (rnd() - 0.5) * 36)}" r="${f(0.8 + rnd())}" fill="#fde047" opacity="${f(0.5 + rnd() * 0.5)}"/>`;
    return `${spine(100, 140)}<rect x="122" y="${Y - 60}" width="20" height="40" fill="#334155" stroke="#64748b"/><rect x="122" y="${Y + 20}" width="20" height="40" fill="#334155" stroke="#64748b"/>
      <rect x="140" y="${Y - 24}" width="60" height="48" rx="12" fill="#1c1917" stroke="#a8a29e" stroke-width="2"/>${dust}
      ${[210, 224].map((x, i) => coil(x, Y, 18 + i * 8)).join('')}${plume(228, Y, 66, 18, '#fde68a', 'g6', 0.7)}`;
  })());

// 4. Mini-Mag Orion: a long truss, a pellet injector, a flared cage of
// superconducting rings at the stern in place of a pusher plate, a flash.
ship('gw-_mini_mag_orion_z_pinch_fission:primary', [90, Y]);
ART['gw-_mini_mag_orion_z_pinch_fission:primary'] = () => scene('gw-_mini_mag_orion_z_pinch_fission:primary', 707, GL('mm', '#fbcfe8', '#be185d'),
  `${spine(90, 190)}<rect x="150" y="${Y - 6}" width="30" height="12" rx="3" fill="#64748b" stroke="#cbd5e1"/>
   ${[0, 1, 2, 3].map((i) => coil(194 + i * 14, Y, 14 + i * 9, '#d97706', 3)).join('')}
   <circle cx="214" cy="${Y}" r="16" fill="url(#mm)"/>${plume(240, Y, 56, 36, '#fbcfe8', 'g7', 0.6)}`);
// Solem Medusa: a huge jellyfish canopy far AHEAD, thousands of tethers to a
// winch on a small ship, the blast flash in the gap - pulled, not pushed.
ship('gw-_mini_mag_orion_z_pinch_fission:secondary', [140, Y], 'crewed', { s: 0.38 });
ART['gw-_mini_mag_orion_z_pinch_fission:secondary'] = () => scene('gw-_mini_mag_orion_z_pinch_fission:secondary', 708, GL('md', '#fef9c3', '#f97316'),
  `<path d="M276,${Y - 96} Q232,${Y} 276,${Y + 96} Q300,${Y} 276,${Y - 96} Z" fill="#e2e8f0" fill-opacity="0.35" stroke="#f1f5f9" stroke-width="1.5"/>
   ${[...Array(11)].map((_, i) => `<line x1="146" y1="${Y}" x2="${f(262 + Math.abs(i - 5) * 2.4)}" y2="${Y - 90 + i * 18}" stroke="#cbd5e1" stroke-width="0.6"/>`).join('')}
   <rect x="140" y="${Y - 6}" width="10" height="12" fill="#64748b"/>
   <circle cx="208" cy="${Y}" r="16" fill="url(#md)"/>`);

// 5. Salt-Water Zubrin: a fat tank of boron-carbide capillary tubes feeding a
// long straight chamber, an enormous blinding plume longer than the ship.
ship('gw-_salt_water_zubrin:primary', [70, Y], 'tug', { s: 0.42 });
ART['gw-_salt_water_zubrin:primary'] = () => scene('gw-_salt_water_zubrin:primary', 709, '',
  `<rect x="70" y="${Y - 22}" width="52" height="44" rx="10" fill="url(#mt)" stroke="#1f2937"/>
   ${[...Array(7)].map((_, i) => `<line x1="${76 + i * 7}" y1="${Y - 18}" x2="${76 + i * 7}" y2="${Y + 18}" stroke="#334155" stroke-width="1.4"/>`).join('')}
   <rect x="122" y="${Y - 6}" width="44" height="12" fill="#cbd5e1" stroke="#1f2937"/>
   ${plume(166, Y, 134, 46, '#f0f9ff', 'g9', 1)}${plume(166, Y, 110, 22, '#ffffff', 'g9b', 1)}`);
// Zubrin-GDM: a long thin string of solenoid rings with stronger mirror coils
// at each end inside a fission blanket, a thin hot jet out one end.
ship('gw-_salt_water_zubrin:secondary', [90, Y]);
ART['gw-_salt_water_zubrin:secondary'] = () => scene('gw-_salt_water_zubrin:secondary', 710, '',
  `<rect x="94" y="${Y - 10}" width="150" height="20" rx="8" fill="#14532d" fill-opacity="0.6" stroke="#4ade80" stroke-width="1"/>
   <rect x="94" y="${Y - 3}" width="150" height="6" fill="#f0abfc" filter="url(#glow)"/>
   ${[...Array(12)].map((_, i) => { const end = i === 0 || i === 11; return `<rect x="${98 + i * 12}" y="${Y - (end ? 18 : 13)}" width="${end ? 7 : 4}" height="${end ? 36 : 26}" rx="2" fill="#d97706"/>`; }).join('')}
   ${plume(244, Y, 56, 8, '#f0abfc', 'g10')}`);

// 6. Spheromak 3He-D: a short flux-conserving can holding a glowing smoke
// ring, flaring into a nozzle of coils.
ship('gw-_spheromak_3he_d_magnetic_fusion:primary', [110, Y]);
ART['gw-_spheromak_3he_d_magnetic_fusion:primary'] = () => scene('gw-_spheromak_3he_d_magnetic_fusion:primary', 711, '',
  `${spine(110, 150)}<rect x="150" y="${Y - 30}" width="52" height="60" rx="10" fill="#1e293b" stroke="#cbd5e1" stroke-width="2"/>
   <ellipse cx="176" cy="${Y}" rx="12" ry="20" fill="none" stroke="#67e8f9" stroke-width="7" filter="url(#glow)"/>
   ${[0, 1, 2, 3].map((i) => `<path d="M${168 + i * 4},${Y - 16} q6,16 0,32" stroke="#ecfeff" stroke-width="0.8" fill="none"/>`).join('')}
   ${[214, 228, 242].map((x, i) => coil(x, Y, 22 + i * 8, '#d97706', 3)).join('')}${plume(246, Y, 54, 26, '#a5f3fc', 'g11', 0.7)}`);
// Colliding FRC: a symmetric barbell of ring coils, two plasmoids meeting in a
// hot centre, exhaust out one end.
ship('gw-_spheromak_3he_d_magnetic_fusion:secondary', [86, Y]);
ART['gw-_spheromak_3he_d_magnetic_fusion:secondary'] = () => scene('gw-_spheromak_3he_d_magnetic_fusion:secondary', 712, GL('fr', '#a5f3fc', '#0e7490'),
  `<rect x="90" y="${Y - 8}" width="160" height="16" rx="6" fill="#1e293b" stroke="#94a3b8"/>
   ${[...Array(13)].map((_, i) => { const d = Math.abs(i - 6), h = 16 + (6 - d) * 2; return `<rect x="${96 + i * 12}" y="${Y - h}" width="5" height="${h * 2}" rx="2" fill="#d97706"/>`; }).join('')}
   <circle cx="170" cy="${Y}" r="14" fill="url(#fr)"/>
   ${[130, 210].map((x) => `<ellipse cx="${x}" cy="${Y}" rx="7" ry="9" fill="none" stroke="#67e8f9" stroke-width="3"/>`).join('')}
   ${plume(250, Y, 50, 14, '#a5f3fc', 'g12')}`);

// 7. VISTA D-T Inertial: a wide cone, point aft, its surface heat-pipe
// radiators; the target flashes just behind the point, plasma streams out.
ship('gw-_vista_d_t_inertial_fusion:primary', [110, Y], 'crewed', { s: 0.42 });
ART['gw-_vista_d_t_inertial_fusion:primary'] = () => scene('gw-_vista_d_t_inertial_fusion:primary', 713, GL('vi', '#fef08a', '#ea580c'),
  `<path d="M110,${Y - 80} L210,${Y - 6} L210,${Y + 6} L110,${Y + 80} Z" fill="#334155" stroke="#cbd5e1" stroke-width="1.5"/>
   ${[...Array(7)].map((_, i) => `<line x1="110" y1="${Y - 72 + i * 24}" x2="208" y2="${Y}" stroke="#64748b" stroke-width="1"/>`).join('')}
   <rect x="200" y="${Y - 10}" width="14" height="20" rx="3" fill="#d97706"/>
   <circle cx="226" cy="${Y}" r="14" fill="url(#vi)"/>${plume(234, Y, 66, 22, '#fde68a', 'g13', 0.7)}`);
// Daedalus: the two-stage starship - a huge orange-hot molybdenum bell, a ring
// of big spherical propellant tanks, an erosion shield disc up front.
ship('gw-_vista_d_t_inertial_fusion:secondary', [60, Y], 'probe', { s: 0.45 });
ART['gw-_vista_d_t_inertial_fusion:secondary'] = () => scene('gw-_vista_d_t_inertial_fusion:secondary', 714, rad('tk', [[0, '#f8fafc'], [0.6, '#94a3b8'], [1, '#334155']], '35%', '35%') + lin('mo', [[0, '#fed7aa'], [0.5, '#f97316'], [1, '#7c2d12']]),
  `<ellipse cx="60" cy="${Y}" rx="5" ry="26" fill="#94a3b8"/>${spine(60, 180)}
   ${[-1, 1].map((s) => [0, 1, 2].map((i) => `<circle cx="${104 + i * 24}" cy="${Y + s * 22}" r="11" fill="url(#tk)"/>`).join('')).join('')}
   <path d="M180,${Y - 10} Q214,${Y - 14} 272,${Y - 66} L272,${Y + 66} Q214,${Y + 14} 180,${Y + 10} Z" fill="url(#mo)" stroke="#fdba74" filter="url(#glow)"/>
   ${plume(272, Y, 28, 50, '#fef3c7', 'g14', 0.6)}`);

for (const p of Object.values(PATENTS_BY_ID)) {
  if (p.type !== 'gw-thruster') continue;
  for (const side of ['primary', 'secondary']) {
    if (!ART[`${p.id}:${side}`]) throw new Error(`gw art missing: ${p.id}:${side}`);
  }
}
