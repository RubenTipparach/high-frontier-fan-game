// Bernal deck art (Module 2): 10 cards x 2 faces. A Bernal is a small space
// colony (rules fn 1: slimmed-down "Globus Bernals" of ~100 people, behind a
// rubble radiation shield) and every one is a dirt rocket that moves by
// flinging its own shield out of a mass driver (fn 5) - so each station wears
// a lumpy shield and vents a stream of grey regolith. The two figure shapes
// are the Stanford torus and the Kalpana finned sphere (2A1). The white face is
// the working station; the purple face is its Lab: the same hull with its
// special equipment added. Purple faces wash through the deck's promoted
// purple (#655ca8 -> #652d91) like the colonist backs. See docs/card-art-guide.md.
import { BERNALS_BY_ID } from '../../data/bernals.js';
import { W, H, f, lin, rad, stars, svg, seeded, beam } from './kit.mjs';

export const ART = {};
export const RIG = {};

// White face: a plain backdrop rect the generator strips. Purple face: the
// promoted wash + a faint starfield.
function face(side, seed) {
  if (side === 'primary') {
    return { defs: `<radialGradient id="bg"><stop offset="0" stop-color="#000"/></radialGradient>`, body: `<rect width="300" height="288" fill="url(#bg)"/>` };
  }
  return {
    defs: `<radialGradient id="pw" cx="50%" cy="44%" r="80%"><stop offset="0%" stop-color="#655ca8"/><stop offset="100%" stop-color="#652d91"/></radialGradient>`,
    body: `<rect width="300" height="288" fill="url(#pw)"/>${stars(30, seed)}`,
  };
}
const SHIELD = rad('shd', [[0, '#a8a29e'], [0.6, '#78716c'], [1, '#44403c']], '35%', '30%', '80%');
const HULL = lin('hul', [[0, '#f1f5f9'], [0.5, '#cbd5e1'], [1, '#64748b']]);
function rubble(cx, cy, rx, ry, seed, n = 18) {
  const rnd = seeded(seed);
  let out = '';
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    out += `<circle cx="${f(cx + Math.cos(a) * rx * (0.9 + rnd() * 0.1))}" cy="${f(cy + Math.sin(a) * ry * (0.9 + rnd() * 0.1))}" r="${f(2 + rnd() * 3)}" fill="#57534e" opacity="0.8"/>`;
  }
  return out;
}
// Stanford torus: a shielded wheel, spokes to a hub, a band of lit windows.
function torus(cx, cy, R, seed, { tilt = 0.42, lights = '#fde68a' } = {}) {
  const r = R * tilt;
  return `<g>
    <ellipse cx="${cx}" cy="${cy}" rx="${R}" ry="${f(r)}" fill="none" stroke="url(#shd)" stroke-width="${f(R * 0.22)}"/>
    ${rubble(cx, cy, R, r, seed)}
    <ellipse cx="${cx}" cy="${cy}" rx="${R}" ry="${f(r)}" fill="none" stroke="${lights}" stroke-width="1.6" stroke-dasharray="3 4" opacity="0.9"/>
    ${[0, 60, 120].map((a) => { const t = a * Math.PI / 180; return `<line x1="${f(cx - Math.cos(t) * R * 0.9)}" y1="${f(cy - Math.sin(t) * r * 0.9)}" x2="${f(cx + Math.cos(t) * R * 0.9)}" y2="${f(cy + Math.sin(t) * r * 0.9)}" stroke="#94a3b8" stroke-width="2"/>`; }).join('')}
    <ellipse cx="${cx}" cy="${cy}" rx="${f(R * 0.16)}" ry="${f(R * 0.16)}" fill="url(#hul)" stroke="#475569" stroke-width="1"/>
  </g>`;
}
// Kalpana finned sphere: a shielded ball with radiator fins and a window band.
function kalpana(cx, cy, r, seed) {
  return `<g>
    ${[-1, 1].map((s) => `<path d="M${cx + s * r * 0.7},${cy - r * 0.2} L${cx + s * r * 1.7},${cy - r * 0.55} L${cx + s * r * 1.7},${cy + r * 0.55} L${cx + s * r * 0.7},${cy + r * 0.2} Z" fill="#334155" stroke="#94a3b8" stroke-width="1"/>`).join('')}
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#shd)"/>
    ${rubble(cx, cy, r * 0.96, r * 0.96, seed, 16)}
    <path d="M${cx - r * 0.92},${cy} Q${cx},${cy + r * 0.32} ${cx + r * 0.92},${cy}" stroke="#fde68a" stroke-width="2" stroke-dasharray="3 3" fill="none"/>
    <circle cx="${cx}" cy="${f(cy - r * 1.05)}" r="${f(r * 0.18)}" fill="url(#hul)"/><circle cx="${cx}" cy="${f(cy + r * 1.05)}" r="${f(r * 0.18)}" fill="url(#hul)"/>
  </g>`;
}
// The mass driver: a rail venting a stream of grey regolith (how it moves).
function massDriver(x1, y1, x2, y2, seed) {
  const rnd = seeded(seed);
  let dirt = '';
  for (let i = 0; i < 9; i++) {
    const t = 1 + (i + rnd()) * 0.12;
    dirt += `<circle cx="${f(x1 + (x2 - x1) * t)}" cy="${f(y1 + (y2 - y1) * t)}" r="${f(1.2 + rnd() * 1.4)}" fill="#a8a29e" opacity="${f(0.9 - i * 0.08)}"/>`;
  }
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#64748b" stroke-width="3"/><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#e3954f" stroke-width="1" stroke-dasharray="2 3"/>${dirt}`;
}
function planet(cx, cy, r, c1, c2, c3, id) {
  return `<defs>${rad(id, [[0, c1], [0.6, c2], [1, c3]], '35%', '25%', '85%')}</defs><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id})"/>`;
}
function solarWing(x, y, w, h) {
  let c = '';
  for (let i = 1; i < 5; i++) c += `<line x1="${f(x + (w * i) / 5)}" y1="${y}" x2="${f(x + (w * i) / 5)}" y2="${y + h}" stroke="#93c5fd" stroke-width="0.7"/>`;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#1e3a8a" stroke="#93c5fd" stroke-width="1"/>${c}`;
}
function scene(key, seed, defs, body) {
  const side = key.split(':')[1];
  const b = face(side, seed);
  // Each station is drawn centred near y=200, then lifted into the open band
  // around the thrust triangle: the supports box and the HOME / Lab text fill
  // the lower half of a Bernal card, so art there sits hidden behind them.
  return svg(b.defs + SHIELD + HULL + defs, `${b.body}<g transform="translate(15 -105) scale(0.9)">${body}</g>`);
}

// 1. GEO Elevator Bernal: threaded onto a space-elevator ribbon that runs
// down to Earth's equator; a climber rides the ribbon.
ART['ber_geo_elevator_bernal:primary'] = () => scene('ber_geo_elevator_bernal:primary', 401, '',
  `${planet(150, 470, 240, '#7dd3fc', '#1d4ed8', '#0b1640', 'e1')}
   <line x1="214" y1="0" x2="214" y2="240" stroke="#475569" stroke-width="1.6"/>
   ${torus(214, 150, 56, 401)}
   <rect x="208" y="196" width="12" height="16" rx="3" fill="#e2e8f0" stroke="#475569"/><rect x="211" y="200" width="6" height="4" fill="#fde68a"/>
   ${massDriver(160, 168, 120, 186, 401)}`);
// Space Elevator Lab: the same ribbon with a nanotube extrusion works at the
// hub and a catapult arm throwing a payload up off the top.
ART['ber_geo_elevator_bernal:secondary'] = () => scene('ber_geo_elevator_bernal:secondary', 402, '',
  `${planet(150, 470, 240, '#7dd3fc', '#1d4ed8', '#0b1640', 'e2')}
   <line x1="214" y1="0" x2="214" y2="240" stroke="#e2e8f0" stroke-width="1.6"/>
   ${torus(214, 160, 52, 402)}
   <rect x="196" y="140" width="36" height="16" rx="4" fill="#475569" stroke="#cbd5e1"/><circle cx="214" cy="148" r="5" fill="#94a3b8"/>
   <path d="M232,146 L276,100" stroke="#cbd5e1" stroke-width="4"/><circle cx="282" cy="92" r="4" fill="#fde68a" filter="url(#glow)"/><path d="M282,92 l12,-12" stroke="#fde68a" stroke-width="1.4" stroke-dasharray="2 2"/>
   <rect x="208" y="214" width="12" height="16" rx="3" fill="#e2e8f0"/>`);

// 2. L1 Climate Control Bernal: tending a huge faint sunshade between the Sun
// and a planet, its soft shadow falling on the world.
ART['ber_l1_climate_control_bernal:primary'] = () => scene('ber_l1_climate_control_bernal:primary', 403, '',
  `<circle cx="-30" cy="150" r="70" fill="#fde68a" opacity="0.45" filter="url(#soft)"/>
   <ellipse cx="96" cy="170" rx="22" ry="92" fill="#1f2937" opacity="0.5" stroke="#cbd5e1" stroke-width="1.4"/>
   ${planet(300, 200, 70, '#93c5fd', '#2563eb', '#0b1640', 'e3')}<path d="M248,150 Q236,200 248,250" stroke="#0f172a" stroke-width="16" opacity="0.35" fill="none"/>
   ${kalpana(150, 196, 26, 403)}${massDriver(150, 222, 130, 262, 403)}`);
// Climate Control Lab: sampling dishes and a tilted mirror aimed at the
// planet, its atmosphere banded with a cooler colour.
ART['ber_l1_climate_control_bernal:secondary'] = () => scene('ber_l1_climate_control_bernal:secondary', 404, '',
  `<circle cx="-30" cy="150" r="70" fill="#fde68a" opacity="0.35" filter="url(#soft)"/>
   <ellipse cx="90" cy="170" rx="20" ry="88" fill="#0f172a" opacity="0.45" stroke="#e2e8f0" stroke-width="1.4"/>
   ${planet(300, 200, 70, '#a5f3fc', '#0891b2', '#083344', 'e4')}<path d="M240,186 Q270,176 300,186" stroke="#e0f2fe" stroke-width="5" fill="none" opacity="0.6"/>
   ${kalpana(150, 196, 24, 404)}
   <path d="M176,170 Q190,160 186,148" stroke="#e2e8f0" stroke-width="3" fill="none"/><path d="M174,206 l24,-6 l-4,16 Z" fill="#e5e7eb" stroke="#94a3b8"/>
   <line x1="198" y1="206" x2="232" y2="200" stroke="#a5f3fc" stroke-width="1.2" stroke-dasharray="3 3"/>`);

// 3. L2 Collimator Bernal: the habitat behind a huge collimating mirror fed by
// solar wings; a pencil-thin beam pushes a sail far away.
ART['ber_l2_collimator_bernal:primary'] = () => scene('ber_l2_collimator_bernal:primary', 405, lin('mir', [[0, '#fef3c7'], [1, '#a8a29e']], 0, 0, 1, 0),
  `${solarWing(14, 160, 48, 22)}${solarWing(14, 214, 48, 22)}
   ${kalpana(92, 200, 22, 405)}
   <path d="M150,138 Q118,200 150,262 L158,262 Q128,200 158,138 Z" fill="url(#mir)" stroke="#78716c"/>
   ${beam(156, 200, 300, 168, '#4ade80', 2)}
   <path d="M282,150 L298,170 L282,176 Z" fill="#e5e7eb" opacity="0.8"/>`);
// Collimator Lab: a second gimballed steering mirror splits the beam - the
// bonus pivot.
ART['ber_l2_collimator_bernal:secondary'] = () => scene('ber_l2_collimator_bernal:secondary', 406, lin('mir2', [[0, '#fef3c7'], [1, '#a8a29e']], 0, 0, 1, 0),
  `${solarWing(14, 160, 48, 22)}${solarWing(14, 214, 48, 22)}
   ${kalpana(92, 200, 22, 406)}
   <path d="M150,138 Q118,200 150,262 L158,262 Q128,200 158,138 Z" fill="url(#mir2)" stroke="#78716c"/>
   ${beam(156, 200, 222, 200, '#4ade80', 2)}
   <circle cx="230" cy="200" r="12" fill="none" stroke="#cbd5e1" stroke-width="2"/><rect x="224" y="188" width="12" height="24" fill="#e2e8f0" transform="rotate(30 230 200)"/>
   ${beam(232, 196, 300, 150, '#4ade80', 1.6)}${beam(232, 204, 300, 250, '#4ade80', 1.6)}`);

// 4. L3 Lofstrom Loop Microgravity: the station above a launch loop - a
// maglev belt in a long flat sheath above the air, ramps down at both ends.
ART['ber_l3_lofstrom_loop_microgravity:primary'] = () => scene('ber_l3_lofstrom_loop_microgravity:primary', 407, '',
  `${planet(150, 520, 300, '#86efac', '#15803d', '#052e16', 'e5')}
   <path d="M0,250 L40,226 L260,226 L300,250" stroke="#64748b" stroke-width="4" fill="none"/>
   <line x1="40" y1="226" x2="260" y2="226" stroke="#60a5fa" stroke-width="2" filter="url(#glow)"/>
   <circle cx="246" cy="222" r="3" fill="#e0f2fe" filter="url(#glow)"/><path d="M250,220 L290,196" stroke="#e0f2fe" stroke-width="1.2" stroke-dasharray="3 3"/>
   ${torus(160, 166, 46, 407)}${massDriver(116, 160, 80, 150, 407)}`);
// Lofstrom Loop Lab: a small loop ring around the station itself plus
// microgravity process modules.
ART['ber_l3_lofstrom_loop_microgravity:secondary'] = () => scene('ber_l3_lofstrom_loop_microgravity:secondary', 408, '',
  `${planet(150, 520, 300, '#86efac', '#15803d', '#052e16', 'e6')}
   <path d="M0,250 L40,226 L260,226 L300,250" stroke="#94a3b8" stroke-width="3" fill="none"/>
   ${torus(160, 170, 44, 408)}
   <ellipse cx="160" cy="170" rx="74" ry="30" fill="none" stroke="#60a5fa" stroke-width="2.4" filter="url(#glow)"/>
   ${[0, 1, 2].map((i) => `<rect x="${204 + i * 14}" y="${118 - i * 6}" width="12" height="10" rx="2" fill="#e2e8f0" stroke="#64748b"/>`).join('')}`);

// 5. L4 Antimatter Factory: the habitat docked beside a big solar-powered
// accelerator ring of magnet segments, radiator fins for its waste heat.
ART['ber_l4_antimatter_factory:primary'] = () => scene('ber_l4_antimatter_factory:primary', 409, '',
  `<ellipse cx="190" cy="206" rx="88" ry="34" fill="none" stroke="#e879f9" stroke-width="3" opacity="0.7" filter="url(#glow)"/>
   ${[...Array(14)].map((_, i) => { const a = i * Math.PI / 7; return `<rect x="${f(190 + Math.cos(a) * 88 - 5)}" y="${f(206 + Math.sin(a) * 34 - 4)}" width="10" height="8" rx="1.5" fill="#1d4ed8" stroke="#93c5fd" stroke-width="0.8"/>`; }).join('')}
   ${solarWing(206, 120, 70, 22)}
   ${kalpana(98, 196, 24, 409)}${massDriver(98, 222, 74, 262, 409)}`);
// Antimatter Lab: rows of Penning-trap canisters, a hand-carried trap flask,
// small magenta trap points glowing.
ART['ber_l4_antimatter_factory:secondary'] = () => scene('ber_l4_antimatter_factory:secondary', 410, '',
  `${kalpana(70, 196, 22, 410)}
   ${[...Array(3)].map((_, r) => [...Array(4)].map((_, c) => `<rect x="${130 + c * 38}" y="${150 + r * 34}" width="26" height="22" rx="5" fill="#334155" stroke="#cbd5e1" stroke-width="1"/>${[0, 1, 2].map((k) => `<line x1="${133 + c * 38 + k * 8}" y1="${150 + r * 34}" x2="${133 + c * 38 + k * 8}" y2="${172 + r * 34}" stroke="#e3954f" stroke-width="1.6"/>`).join('')}<circle cx="${143 + c * 38}" cy="${161 + r * 34}" r="3" fill="#f0abfc" filter="url(#glow)"/>`).join('')).join('')}`);

// 6. L4s Pharmaceutics Bernal: sealed clean-room lab modules docked to the
// habitat hub; clinical teal and white.
ART['ber_l4s_pharmaceutics_bernal:primary'] = () => scene('ber_l4s_pharmaceutics_bernal:primary', 411, '',
  `${torus(130, 200, 54, 411)}
   <line x1="130" y1="200" x2="230" y2="160" stroke="#94a3b8" stroke-width="3"/>
   ${[0, 1, 2].map((i) => `<rect x="${206 + i * 22}" y="${144 + (i % 2) * 18}" width="20" height="16" rx="4" fill="#f0fdfa" stroke="#0d9488" stroke-width="1.5"/><rect x="${210 + i * 22}" y="${149 + (i % 2) * 18}" width="12" height="5" fill="#5eead4"/>`).join('')}
   ${massDriver(84, 206, 50, 236, 411)}`);
// Pharmaceutics Lab: a magnified view of perfectly uniform microspheres (the
// first space-made product sold), a protein-crystal tray and a centrifuge.
ART['ber_l4s_pharmaceutics_bernal:secondary'] = () => scene('ber_l4s_pharmaceutics_bernal:secondary', 412, rad('bead', [[0, '#ffffff'], [0.6, '#99f6e4'], [1, '#0d9488']], '35%', '35%'),
  `<circle cx="200" cy="196" r="62" fill="#042f2e" stroke="#5eead4" stroke-width="2"/>
   ${[...Array(4)].map((_, r) => [...Array(4)].map((_, c) => `<circle cx="${170 + c * 20 + (r % 2) * 10}" cy="${166 + r * 20}" r="8" fill="url(#bead)"/>`).join('')).join('')}
   <rect x="34" y="228" width="80" height="22" rx="3" fill="#f0fdfa" stroke="#0d9488"/>${[...Array(6)].map((_, i) => `<path d="M${44 + i * 12},${244} l4,-10 l4,10 Z" fill="#a5f3fc" stroke="#0891b2" stroke-width="0.6"/>`).join('')}
   <circle cx="70" cy="180" r="22" fill="none" stroke="#e2e8f0" stroke-width="3"/><line x1="48" y1="180" x2="92" y2="180" stroke="#e2e8f0" stroke-width="2"/><line x1="70" y1="158" x2="70" y2="202" stroke="#e2e8f0" stroke-width="2"/>`);

// 7. L5 Solar Cell Factory: a robotic assembly truss rolling out huge dark-blue
// photovoltaic blankets beside the habitat; a mass-driver stream brings rock in.
ART['ber_l5_solar_cell_factory:primary'] = () => scene('ber_l5_solar_cell_factory:primary', 413, '',
  `${kalpana(80, 200, 24, 413)}
   <line x1="104" y1="200" x2="296" y2="200" stroke="#94a3b8" stroke-width="3"/>
   ${solarWing(130, 150, 150, 40)}${solarWing(130, 210, 150, 40)}
   ${[0, 1, 2, 3, 4].map((i) => `<circle cx="${10 + i * 12}" cy="${262 - i * 10}" r="2" fill="#a8a29e"/>`).join('')}`);
// Solar Cell Lab: a thin-film deposition drum, and a solar sail being finished.
ART['ber_l5_solar_cell_factory:secondary'] = () => scene('ber_l5_solar_cell_factory:secondary', 414, lin('film', [[0, '#fde68a'], [1, '#d6d3d1']], 0, 0, 1, 1),
  `${kalpana(70, 210, 22, 414)}
   <ellipse cx="140" cy="200" rx="14" ry="30" fill="#475569" stroke="#cbd5e1" stroke-width="2"/>
   <path d="M140,170 Q210,160 280,140 L280,260 Q210,240 140,230 Z" fill="#1e3a8a" stroke="#93c5fd" stroke-width="1"/>
   <path d="M200,110 L250,96 L262,140 L212,152 Z" fill="url(#film)" opacity="0.85" stroke="#a8a29e"/>`);

// 8. L5s Cancer Hospital: a spinning wheel marked with a red cross behind a
// thick regolith shield around the wards.
ART['ber_l5s_cancer_hospital:primary'] = () => scene('ber_l5s_cancer_hospital:primary', 415, '',
  `${torus(170, 198, 64, 415, { lights: '#fecaca' })}
   <rect x="160" y="182" width="20" height="32" fill="#ffffff"/><rect x="154" y="190" width="32" height="16" fill="#ffffff"/>
   <rect x="164" y="186" width="12" height="24" fill="#dc2626"/><rect x="158" y="192" width="24" height="12" fill="#dc2626"/>
   ${massDriver(110, 214, 70, 246, 415)}`);
// Cancer Lab: a proton-therapy beamline into a treatment couch inside a
// heavily shielded vault, the beam a soft blue.
ART['ber_l5s_cancer_hospital:secondary'] = () => scene('ber_l5s_cancer_hospital:secondary', 416, '',
  `<rect x="150" y="140" width="130" height="120" rx="8" fill="url(#shd)"/>
   <rect x="166" y="156" width="98" height="88" rx="4" fill="#1e1b4b"/>
   <ellipse cx="70" cy="200" rx="56" ry="18" fill="none" stroke="#94a3b8" stroke-width="6"/>
   ${beam(122, 200, 214, 200, '#7dd3fc', 2.2)}
   <rect x="196" y="206" width="56" height="8" rx="3" fill="#e2e8f0"/><circle cx="214" cy="200" r="6" fill="#bae6fd" filter="url(#glow)"/>
   <rect x="160" y="182" width="12" height="18" fill="#ffffff"/><rect x="157" y="188" width="18" height="6" fill="#dc2626"/>`);

// 9. SSO Diplomatic: a stately torus with an assembly dome at its hub, a ring
// of six faction banners, GPS satellites drifting nearby (semi-synchronous orbit).
ART['ber_sso_diplomatic:primary'] = () => scene('ber_sso_diplomatic:primary', 417, '',
  `${torus(160, 200, 62, 417)}
   <path d="M144,198 Q160,176 176,198 Z" fill="#e0f2fe" stroke="#64748b"/>
   ${['#b40054', '#eab308', '#9f7aea', '#34d399', '#9ca3af', '#f5f0dc'].map((c, i) => { const a = i * Math.PI / 3; const x = 160 + Math.cos(a) * 62, y = 200 + Math.sin(a) * 26; return `<line x1="${f(x)}" y1="${f(y)}" x2="${f(x)}" y2="${f(y - 18)}" stroke="#cbd5e1" stroke-width="1"/><rect x="${f(x)}" y="${f(y - 18)}" width="10" height="7" fill="${c}"/>`; }).join('')}
   ${[[40, 150], [262, 136]].map(([x, y]) => `<rect x="${x - 5}" y="${y - 4}" width="10" height="8" fill="#cbd5e1"/><rect x="${x - 17}" y="${y - 2}" width="10" height="4" fill="#1e3a8a"/><rect x="${x + 7}" y="${y - 2}" width="10" height="4" fill="#1e3a8a"/>`).join('')}`);
// Diplomatic Lab: a great chamber with a ring of delegate seats, and antenna
// relay arrays for talking to every faction.
ART['ber_sso_diplomatic:secondary'] = () => scene('ber_sso_diplomatic:secondary', 418, '',
  `<ellipse cx="160" cy="210" rx="110" ry="40" fill="#1e1b4b" stroke="#c4b5fd" stroke-width="2"/>
   <ellipse cx="160" cy="210" rx="34" ry="12" fill="#312e81" stroke="#e0e7ff"/>
   ${[...Array(18)].map((_, i) => { const a = i * Math.PI / 9; const cols = ['#b40054', '#eab308', '#9f7aea', '#34d399', '#9ca3af', '#f5f0dc']; return `<rect x="${f(160 + Math.cos(a) * 82 - 4)}" y="${f(210 + Math.sin(a) * 28 - 3)}" width="8" height="6" rx="1.5" fill="${cols[i % 6]}"/>`; }).join('')}
   ${[60, 250].map((x) => `<line x1="${x}" y1="176" x2="${x}" y2="130" stroke="#cbd5e1" stroke-width="2"/><path d="M${x - 12},${136} Q${x},${118} ${x + 12},${136}" fill="none" stroke="#e2e8f0" stroke-width="2"/>`).join('')}`);

// 10. Tourism Cycler: Aldrin's castle, a wheel with a shielded storm shelter
// looping forever between Earth and Mars; taxis dock as it flies past.
ART['ber_tourism_cycler:primary'] = () => scene('ber_tourism_cycler:primary', 419, '',
  `<ellipse cx="150" cy="200" rx="140" ry="54" fill="none" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="4 4"/>
   ${planet(18, 200, 16, '#7dd3fc', '#1d4ed8', '#0b1640', 'e7')}${planet(286, 200, 11, '#fdba74', '#c2410c', '#431407', 'e8')}
   ${torus(170, 176, 42, 419)}
   <rect x="160" y="168" width="20" height="16" rx="3" fill="#57534e" stroke="#e5e7eb"/>
   <path d="M228,160 l10,-4 l2,6 Z" fill="#e2e8f0"/><path d="M110,196 l-10,4 l-2,-6 Z" fill="#e2e8f0"/>`);
// Tourism Hotel: a panoramic viewing deck - big warm-lit windows and a lounge -
// with Earth and Mars swinging by.
ART['ber_tourism_cycler:secondary'] = () => scene('ber_tourism_cycler:secondary', 420, '',
  `${planet(270, 140, 26, '#fdba74', '#c2410c', '#431407', 'e9')}
   <path d="M30,250 Q30,170 150,166 Q270,170 270,250 Z" fill="#334155" stroke="#cbd5e1" stroke-width="2"/>
   ${[...Array(7)].map((_, i) => `<rect x="${46 + i * 32}" y="${184 + Math.abs(3 - i) * 4}" width="24" height="34" rx="4" fill="#fde68a" opacity="0.85"/>`).join('')}
   <line x1="40" y1="232" x2="260" y2="232" stroke="#94a3b8" stroke-width="2"/>`);

for (const id of Object.keys(BERNALS_BY_ID)) {
  for (const side of ['primary', 'secondary']) {
    if (!ART[`${id}:${side}`]) throw new Error(`bernal art missing: ${id}:${side}`);
  }
}
