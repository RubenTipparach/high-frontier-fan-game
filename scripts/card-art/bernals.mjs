// Bernal deck art (Module 2): 10 cards x 2 faces. A Bernal is a small space
// colony (rules fn 1: slimmed-down "Globus Bernals" of ~100 people, behind a
// rubble radiation shield) and every one is a dirt rocket that moves by
// flinging its own shield out of a mass driver (fn 5) - so each station wears
// a lumpy shield and vents a stream of grey regolith. Each card is a
// DIFFERENT real habitat architecture (user 2026-11-14: no more same-wheel
// drawings), picked for its location and job from a research pass: elevator
// bead, sunshade parasol, tethered bola, Lewis One on a launch loop,
// accelerator ring, Y pinwheel, Stanford torus, buried rubble mound, Bernal
// sphere, Aldrin's castle. Planets use kit.mjs#planetPaint. The white face is
// the working station; the purple face is its Lab: the same hull with its
// special equipment added. Purple faces wash through the deck's promoted
// purple (#655ca8 -> #652d91) like the colonist backs. See docs/card-art-guide.md.
import { BERNALS_BY_ID } from '../../data/bernals.js';
import { W, H, f, lin, rad, stars, svg, seeded, beam, planetPaint } from './kit.mjs';

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
  // Drawn straight in card coordinates: the station lives in the open band
  // around the thrust triangle (y 0-150); the supports box and HOME / Lab
  // text cover the lower half, so only backdrop (planets) goes there.
  return svg(b.defs + SHIELD + HULL + defs, `${b.body}${body}`);
}


const INK = '#1f2937';
// Deck signature on every white face: the little mass driver venting its own
// rubble shield, always low on the left (rules fn 5: Bernals are dirt rockets).
const SIG = (seed) => massDriver(70, 128, 40, 140, seed);
function pp(id, cx, cy, r, o) { const p = planetPaint(id, cx, cy, r, o); return `<defs>${p.defs}</defs>${p.body}`; }
function sun(x, y, r = 60) { return `<circle cx="${x}" cy="${y}" r="${r}" fill="#fde68a" opacity="0.35" filter="url(#soft)"/><circle cx="${x}" cy="${y}" r="${f(r * 0.35)}" fill="#fffbeb" opacity="0.9" filter="url(#soft)"/>`; }
function lumps(cx, cy, rx, ry, seed, n = 14, from = 0, to = Math.PI * 2) {
  const rnd = seeded(seed); let out = '';
  for (let i = 0; i < n; i++) { const a = from + rnd() * (to - from); out += `<ellipse cx="${f(cx + Math.cos(a) * rx)}" cy="${f(cy + Math.sin(a) * ry)}" rx="${f(2.5 + rnd() * 3)}" ry="${f(2 + rnd() * 2.4)}" fill="url(#shd)" stroke="${INK}" stroke-width="0.4"/>`; }
  return out;
}
const win = (x1, y, x2, step = 5) => { let o = ''; for (let x = x1; x < x2; x += step) o += `<rect x="${f(x)}" y="${f(y)}" width="2.4" height="2.4" fill="#fde68a"/>`; return o; };

// 1. GEO Elevator Bernal: a flat stacked-disc "bead" threaded onto the
// space-elevator ribbon, which drops into Earth's equator below and runs up
// to a counterweight - the vertical line is the read (fn 10: an electric car
// riding a carbon-nanotube tether).
function geo(side) {
  const lab = side === 'secondary';
  return `${pp('e' + side[0], 150, 560, 440, { kind: 'earth', seed: 4, light: [0.5, -0.8] })}
   <line x1="205" y1="0" x2="205" y2="140" stroke="${lab ? '#e2e8f0' : '#475569'}" stroke-width="2"/>
   <rect x="196" y="2" width="18" height="10" fill="#57534e" stroke="${INK}" stroke-width="0.8"/>
   ${[0, 1, 2].map((i) => `<ellipse cx="205" cy="${52 + i * 9}" rx="${46 - i * 6}" ry="9" fill="url(#hul)" stroke="${INK}" stroke-width="1"/>`).join('')}
   <path d="M161,58 Q205,66 249,58" stroke="#fde68a" stroke-width="2" stroke-dasharray="3 3" fill="none"/>
   ${lumps(205, 56, 46, 9, 401, 12, Math.PI * 0.9, Math.PI * 1.6)}
   ${lab ? `<rect x="198" y="100" width="14" height="16" rx="2" fill="#e2e8f0" stroke="${INK}"/><rect x="198" y="114" width="14" height="3" fill="#1e3a8a"/>
     <line x1="205" y1="150" x2="205" y2="118" stroke="#fde047" stroke-width="3" opacity="0.8" filter="url(#glow)"/>
     <line x1="205" y1="22" x2="240" y2="12" stroke="#cbd5e1" stroke-width="2.4"/><circle cx="246" cy="10" r="3" fill="#fde68a"/>
     <path d="M246,10 Q272,4 290,16" stroke="#fde68a" stroke-width="1.2" stroke-dasharray="2 3" fill="none"/>` : SIG(401)}`;
}

// 2. L1 Climate Control: a huge dark sunshade seen edge-on-ish with a bright
// sunlit rim, an inflatable habitat stack sheltering in its shadow. The Lab
// adds Roger Angel's sunshade: a coilgun firing a fanning cloud of tiny lens
// flyers toward the Sun.
function l1(side) {
  const lab = side === 'secondary';
  return `${sun(8, 20, 70)}
   ${lab ? [...Array(34)].map((_, i) => { const t = i / 34, a = -2.6 + (i * 0.37) % 0.9; const d = 30 + t * 140; return `<ellipse cx="${f(206 + Math.cos(a) * d)}" cy="${f(104 + Math.sin(a) * d * 0.7)}" rx="2.6" ry="1.2" fill="#e0f2fe" stroke="#a78bfa" stroke-width="0.4" opacity="${f(0.95 - t * 0.5)}"/>`; }).join('') : ''}
   <ellipse cx="172" cy="52" rx="86" ry="24" fill="#111827" stroke="#fde68a" stroke-width="2.2"/>
   ${[...Array(8)].map((_, i) => { const a = i * Math.PI / 8; return `<line x1="${f(172 - Math.cos(a) * 84)}" y1="${f(52 - Math.sin(a) * 22)}" x2="${f(172 + Math.cos(a) * 84)}" y2="${f(52 + Math.sin(a) * 22)}" stroke="#374151" stroke-width="0.6"/>`; }).join('')}
   <line x1="190" y1="62" x2="206" y2="92" stroke="#64748b" stroke-width="2.4"/>
   ${[0, 1, 2].map((i) => `<rect x="${190 + i * 10}" y="${88 + i * 4}" width="30" height="16" rx="8" fill="#f1f5f9" stroke="${INK}" stroke-width="1"/>${[1, 2, 3].map((k) => `<line x1="${190 + i * 10 + k * 7.5}" y1="${89 + i * 4}" x2="${190 + i * 10 + k * 7.5}" y2="${103 + i * 4}" stroke="#94a3b8" stroke-width="0.6"/>`).join('')}`).join('')}
   ${lab ? `<line x1="206" y1="104" x2="176" y2="86" stroke="#475569" stroke-width="4"/>` : SIG(403)}`;
}

// 3. L2 Collimator: a tethered bola - two shielded capsule pods spinning on a
// long tether about a small hub at the centre of mass. The Lab adds a big
// hex-tiled collimating mirror on the hub; its laser beam kinks once off a
// steering mirror (the Bonus Pivot).
function l2(side) {
  const lab = side === 'secondary';
  const pod = (x, y, a) => `<g transform="rotate(${a} ${x} ${y})"><rect x="${x - 16}" y="${y - 9}" width="32" height="18" rx="9" fill="url(#hul)" stroke="${INK}" stroke-width="1"/>${win(x - 10, y - 1.2, x + 10)}</g>${lumps(x, y, 16, 9, x, 7, Math.PI, Math.PI * 1.8)}`;
  let hex = '';
  if (lab) for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) { if (Math.abs(r) + Math.abs(c) > 3) continue; const x = 150 + c * 9 + (r % 2 ? 4.5 : 0), y = 82 + r * 8; hex += `<polygon points="${[...Array(6)].map((_, k) => `${f(x + Math.cos(k * Math.PI / 3 + Math.PI / 6) * 5)},${f(y + Math.sin(k * Math.PI / 3 + Math.PI / 6) * 5)}`).join(' ')}" fill="#fef3c7" stroke="#a16207" stroke-width="0.5"/>`; }
  return `${pp('m' + side[0], 40, 150, 34, { kind: 'moon', seed: 6 })}
   <line x1="44" y1="26" x2="256" y2="138" stroke="${lab ? '#e2e8f0' : '#475569'}" stroke-width="1.2"/>
   <path d="M20,44 A30,30 0 0 1 60,8" stroke="#94a3b8" stroke-width="1" stroke-dasharray="3 3" fill="none"/><path d="M280,120 A30,30 0 0 1 240,156" stroke="#94a3b8" stroke-width="1" stroke-dasharray="3 3" fill="none"/>
   ${pod(44, 26, 28)}${pod(256, 138, 28)}
   <circle cx="150" cy="82" r="6" fill="#64748b" stroke="${INK}"/>
   ${lab ? `${hex}${beam(160, 82, 236, 60, '#fde047', 2.4)}<rect x="234" y="52" width="6" height="16" fill="#e2e8f0" stroke="${INK}" transform="rotate(30 237 60)"/>${beam(238, 58, 300, 12, '#fde047', 2.2)}` : SIG(405)}`;
}

// 4. L3 Lofstrom Loop: a Lofstrom launch loop - a maglev sheath riding high
// above an ocean world, curving with the planet, held up by criss-crossed
// stay cables and ramping down to a station at each end (fn 8) - with a
// Lewis One habitat (flat-capped shielded cylinder, a non-rotating micro-g
// module out of one end) riding above it. The Lab adds a sled streaking
// along the loop and furnace racks glowing on the micro-g spine.
function l3(side) {
  const lab = side === 'secondary';
  const PCX = 150, PCY = 582, PR = 480, LR = 508;
  const surf = (x) => PCY - Math.sqrt(PR * PR - (x - PCX) ** 2);
  const arc = (x) => PCY - Math.sqrt(LR * LR - (x - PCX) ** 2);
  let d = '', cables = '';
  for (let x = 24; x <= 276; x += 6) d += `${x === 24 ? 'M' : 'L'}${x},${f(arc(x))} `;
  for (let x = 30; x <= 270; x += 16) cables += `<line x1="${x}" y1="${f(arc(x))}" x2="${x + 18}" y2="${f(surf(x + 18))}" stroke="#334155" stroke-width="0.6" opacity="0.7"/><line x1="${x}" y1="${f(arc(x))}" x2="${x - 18}" y2="${f(surf(x - 18))}" stroke="#334155" stroke-width="0.6" opacity="0.7"/>`;
  const ramp = (x0, x1) => `<path d="M${x0},${f(arc(x0))} Q${f((x0 + x1) / 2)},${f(arc(x0))} ${x1},${f(surf(x1) - 2)}" stroke="#475569" stroke-width="2.2" fill="none"/><rect x="${x1 - 6}" y="${f(surf(x1) - 7)}" width="12" height="7" fill="#64748b" stroke="${INK}" stroke-width="0.6"/>`;
  return `${pp('o' + side[0], PCX, PCY, PR, { kind: 'ocean', seed: 9, light: [0.6, -0.8] })}
   ${cables}${ramp(24, 6)}${ramp(276, 294)}
   <path d="${d}" stroke="${INK}" stroke-width="3.6" fill="none"/><path d="${d}" stroke="#cbd5e1" stroke-width="2" fill="none"/>
   <path d="${d}" stroke="#60a5fa" stroke-width="1" fill="none" stroke-dasharray="6 5" opacity="0.9"/>
   <line x1="236" y1="${f(arc(236))}" x2="236" y2="48" stroke="#475569" stroke-width="1.4"/>
   <rect x="206" y="18" width="62" height="28" rx="3" fill="url(#shd)" stroke="${INK}" stroke-width="1.2"/>${lumps(237, 32, 31, 14, 407, 12)}
   <rect x="213" y="29" width="48" height="5" fill="#fde68a" opacity="0.9"/>
   <rect x="172" y="27" width="34" height="9" fill="url(#hul)" stroke="${INK}"/>
   ${lab ? `${[0, 1, 2].map((i) => `<rect x="${175 + i * 10}" y="19" width="8" height="8" fill="#7c2d12" stroke="#fb923c" filter="url(#glow)"/>`).join('')}
     <circle cx="112" cy="${f(arc(112))}" r="4" fill="#e0f2fe" filter="url(#glow)"/><path d="M108,${f(arc(108))} L60,${f(arc(60))}" stroke="#bfdbfe" stroke-width="3" opacity="0.7" filter="url(#glow)"/>` : SIG(407)}`;
}

// 5. L4 Antimatter Factory: a thin hubless accelerator ring of magnet
// segments filling the frame, with a short wide Kalpana Two drum (the
// detector hall) on its rim and two radiator wings (the card's Therms 2).
// The Lab adds a beamline spur feeding Penning-trap canisters, cores glowing.
function l4(side) {
  const lab = side === 'secondary';
  return `${pp('k' + side[0], 262, 140, 28, { kind: 'moon', seed: 12 })}
   <ellipse cx="150" cy="78" rx="136" ry="58" fill="none" stroke="#475569" stroke-width="3"/>
   ${[...Array(28)].map((_, i) => { const a = i * Math.PI / 14; return `<rect x="${f(150 + Math.cos(a) * 136 - 3)}" y="${f(78 + Math.sin(a) * 58 - 3)}" width="6" height="6" fill="#1d4ed8" stroke="${INK}" stroke-width="0.5"/>`; }).join('')}
   <ellipse cx="150" cy="78" rx="136" ry="58" fill="none" stroke="#e879f9" stroke-width="1" opacity="0.6"/>
   <rect x="214" y="14" width="44" height="30" rx="6" fill="url(#hul)" stroke="${INK}" stroke-width="1.2"/>${win(220, 27, 254)}${lumps(236, 29, 22, 15, 409, 8, Math.PI, Math.PI * 2)}
   ${[-1, 1].map((s2) => `<rect x="${s2 < 0 ? 188 : 258}" y="20" width="26" height="12" fill="#334155" stroke="#94a3b8" stroke-width="0.8"/>`).join('')}
   ${lab ? `<line x1="236" y1="44" x2="236" y2="70" stroke="#e879f9" stroke-width="2"/>${[0, 1, 2, 3].map((i) => `<rect x="${200 + i * 20}" y="70" width="14" height="22" rx="5" fill="#334155" stroke="${INK}"/><line x1="${200 + i * 20}" y1="76" x2="${214 + i * 20}" y2="76" stroke="#d97706" stroke-width="1.6"/><line x1="${200 + i * 20}" y1="86" x2="${214 + i * 20}" y2="86" stroke="#d97706" stroke-width="1.6"/><circle cx="${207 + i * 20}" cy="81" r="3" fill="#f0abfc" filter="url(#glow)"/>`).join('')}` : SIG(409)}`;
}

// 6. L4s Pharmaceutics: a three-armed Y pinwheel - spinning arms give the
// crew gravity in stubby shielded pods, the still hub gives microgravity
// for production. The Lab adds a drop column at the hub releasing a chain of
// perfectly uniform microspheres (fn 9, the first space pharmaceuticals).
function l4s(side) {
  const lab = side === 'secondary';
  const hx = 196, hy = 70;
  return `${pp('j' + side[0], 40, 140, 30, { kind: 'earth', seed: 21 })}
   ${[90, 210, 330].map((d) => { const a = d * Math.PI / 180, x = hx + Math.cos(a) * 62, y = hy + Math.sin(a) * 50; return `<line x1="${hx}" y1="${hy}" x2="${f(x)}" y2="${f(y)}" stroke="#64748b" stroke-width="4"/><ellipse cx="${f(x)}" cy="${f(y)}" rx="15" ry="11" fill="url(#hul)" stroke="${INK}" stroke-width="1"/>${lumps(x, y, 14, 10, d, 7)}<rect x="${f(x - 8)}" y="${f(y - 1)}" width="16" height="2.4" fill="#fde68a"/>`; }).join('')}
   <path d="M${hx - 74},${hy - 20} A80,64 0 0 1 ${hx + 30},${hy - 66}" stroke="#94a3b8" stroke-dasharray="3 4" fill="none"/>
   <circle cx="${hx}" cy="${hy}" r="10" fill="#e2e8f0" stroke="${INK}" stroke-width="1.2"/>
   ${lab ? `<rect x="${hx - 4}" y="${hy - 64}" width="8" height="54" rx="3" fill="#ccfbf1" fill-opacity="0.5" stroke="#0d9488"/>${[0, 1, 2, 3, 4, 5].map((i) => `<circle cx="${hx}" cy="${hy - 58 + i * 8}" r="3" fill="#5eead4" stroke="#0f766e" stroke-width="0.5"/>`).join('')}<path d="M${hx + 14},${hy + 4} l6,-10 l2,0 l0,6 l5,10 l-14,0 Z" fill="#ccfbf1" stroke="#0d9488"/>` : SIG(411)}`;
}

// 7. L5 Solar Cell Factory: the deck's one classic Stanford torus (NASA
// SP-413 sited it at L5): a fat shielded wheel, six spokes to a hub, a big
// flat primary mirror tilted above the hub and chevron mirror tabs round the
// tube. The Lab unrolls deep-blue PV blankets off a mill on the hub.
function l5(side) {
  const lab = side === 'secondary';
  const cx = 168, cy = 86, R = 84, r = 30;
  return `${sun(292, 8, 50)}
   <ellipse cx="${cx}" cy="${cy}" rx="${R}" ry="${r}" fill="none" stroke="url(#shd)" stroke-width="16"/>${lumps(cx, cy, R, r, 413, 20)}
   <ellipse cx="${cx}" cy="${cy}" rx="${R}" ry="${r}" fill="none" stroke="#fde68a" stroke-width="1.4" stroke-dasharray="3 4"/>
   ${[0, 30, 60, 90, 120, 150].map((a) => { const t = a * Math.PI / 180; return `<line x1="${f(cx - Math.cos(t) * R)}" y1="${f(cy - Math.sin(t) * r)}" x2="${f(cx + Math.cos(t) * R)}" y2="${f(cy + Math.sin(t) * r)}" stroke="#94a3b8" stroke-width="1.6"/>`; }).join('')}
   <circle cx="${cx}" cy="${cy}" r="9" fill="url(#hul)" stroke="${INK}"/>
   <line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - 52}" stroke="#64748b" stroke-width="2"/>
   <path d="M${cx - 46},${cy - 60} L${cx + 26},${cy - 74} L${cx + 46},${cy - 46} L${cx - 26},${cy - 32} Z" fill="#e5e7eb" stroke="${INK}" stroke-width="1"/>
   ${[...Array(10)].map((_, i) => { const a = i * Math.PI / 5; return `<path d="M${f(cx + Math.cos(a) * (R + 10) - 3)},${f(cy + Math.sin(a) * (r + 6))} l3,-4 l3,4" stroke="#cbd5e1" fill="none" stroke-width="1.2"/>`; }).join('')}
   ${lab ? `<rect x="${cx - 8}" y="${cy - 6}" width="16" height="12" fill="#475569" stroke="${INK}"/>${[-1, 1].map((s2) => `<rect x="${s2 < 0 ? cx - 108 : cx + 12}" y="${cy + 24}" width="96" height="26" fill="#1e3a8a" stroke="#93c5fd"/>${[1, 2, 3, 4, 5].map((k) => `<line x1="${(s2 < 0 ? cx - 108 : cx + 12) + k * 16}" y1="${cy + 24}" x2="${(s2 < 0 ? cx - 108 : cx + 12) + k * 16}" y2="${cy + 50}" stroke="#93c5fd" stroke-width="0.6"/>`).join('')}`).join('')}` : SIG(413)}`;
}

// 8. L5s Cancer Hospital: the heaviest-shielded habitat in the deck - a
// lumpy, cratered regolith mound with the wards buried inside; only a
// docking collar and deep-set lit window slits show. The Lab adds a proton
// therapy cyclotron and beam pipe, a white-on-green medical cross, and a
// faint bright rim for the rad-hard 7 protection.
function l5s(side) {
  const lab = side === 'secondary';
  const rnd = seeded(415);
  const pts = [...Array(14)].map((_, i) => { const a = i * Math.PI / 7, rr = 1 + (rnd() - 0.5) * 0.18; return `${f(178 + Math.cos(a) * 70 * rr)},${f(74 + Math.sin(a) * 48 * rr)}`; });
  return `<polygon points="${pts.join(' ')}" fill="url(#shd)" stroke="${lab ? '#bbf7d0' : INK}" stroke-width="${lab ? 2.4 : 1.2}" stroke-linejoin="round"/>
   ${[[150, 60, 9], [206, 92, 7], [196, 50, 5], [140, 96, 6]].map(([x, y, rr]) => `<ellipse cx="${x}" cy="${y}" rx="${rr}" ry="${f(rr * 0.6)}" fill="#44403c" opacity="0.6"/>`).join('')}
   ${[0, 1, 2].map((i) => `<rect x="${166 + i * 14}" y="72" width="7" height="3" fill="#fde68a"/>`).join('')}
   <rect x="242" y="66" width="18" height="14" rx="3" fill="url(#hul)" stroke="${INK}"/>
   ${lab ? `<circle cx="160" cy="34" r="13" fill="#94a3b8" stroke="${INK}"/><path d="M160,34 m0,-9 a9,9 0 1 1 -1,0 m1,4 a5,5 0 1 1 -1,0" stroke="#1d4ed8" fill="none" stroke-width="1"/>
     <line x1="172" y1="36" x2="212" y2="48" stroke="#7dd3fc" stroke-width="2.4" filter="url(#glow)"/><path d="M210,40 Q222,46 214,58 Z" fill="#e2e8f0" stroke="${INK}"/>
     <rect x="104" y="40" width="22" height="22" rx="3" fill="#15803d"/><rect x="113" y="43" width="4" height="16" fill="#fff"/><rect x="107" y="49" width="16" height="4" fill="#fff"/>` : SIG(415)}`;
}

// 9. SSO Diplomatic: a stately Bernal sphere (Island One) with a lit
// equatorial window band, stacks of thin agricultural rings at each pole,
// concentric mirror rings off one pole and radiator fins - in the 12-hour
// GPS orbit over Earth. The Lab cuts the sphere open on the Assembly: a
// tiered bowl of seats in the six ideology colours, comm dishes on the poles.
function sso(side) {
  const lab = side === 'secondary';
  const cx = 186, cy = 70, R = 44;
  const ideo = ['#c01f6e', '#eab308', '#9f7aea', '#34d399', '#9ca3af', '#f5f0dc'];
  return `${pp('s' + side[0], 30, 170, 70, { kind: 'earth', seed: 33, light: [0.7, -0.7] })}
   ${[-1, 1].map((s2) => [0, 1, 2].map((i) => `<ellipse cx="${cx + s2 * (R + 6 + i * 8)}" cy="${cy}" rx="4" ry="${26 - i * 3}" fill="url(#hul)" stroke="${INK}" stroke-width="0.8"/>`).join('')).join('')}
   ${[0, 1].map((i) => `<ellipse cx="${cx + R + 44 + i * 10}" cy="${cy}" rx="3" ry="${34 + i * 6}" fill="none" stroke="#e5e7eb" stroke-width="2"/>`).join('')}
   <rect x="${cx - 6}" y="${cy - R - 18}" width="12" height="16" fill="#334155" stroke="#94a3b8" stroke-width="0.6"/>
   <circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#shd)" stroke="${INK}" stroke-width="1.2"/>${lumps(cx, cy, R * 0.92, R * 0.92, 417, 14)}
   ${lab ? `<path d="M${cx - R + 6},${cy - 4} A${R - 6},${R - 6} 0 0 0 ${cx + R - 6},${cy - 4} Z" fill="#1e1b4b" stroke="#c4b5fd"/>${[0, 1, 2].map((t) => ideo.map((c, i) => { const a = Math.PI * (0.12 + i * 0.15), rr = R - 12 - t * 8; return `<rect x="${f(cx + Math.cos(a) * rr - 3)}" y="${f(cy - 4 + Math.sin(a) * rr * 0.75 - 2)}" width="6" height="4" fill="${c}"/>`; }).join('')).join('')}
     ${[-1, 1].map((s2) => `<path d="M${cx + s2 * (R + 30) - 8},${cy - 36} Q${cx + s2 * (R + 30)},${cy - 46} ${cx + s2 * (R + 30) + 8},${cy - 36}" fill="none" stroke="#e2e8f0" stroke-width="2"/>`).join('')}`
    : `<path d="M${cx - R + 2},${cy} Q${cx},${cy + 14} ${cx + R - 2},${cy}" stroke="#fde68a" stroke-width="2.4" stroke-dasharray="3 3" fill="none"/>${SIG(417)}`}`;
}

// 10. Tourism Cycler: Aldrin's "castle" - a keep of a tall central tower
// flanked by shorter towers on a spine, a domed observation cap, looping
// forever between Earth and Mars on its cycler orbit inside a pale magnetic
// bubble (its belt protection). The Lab turns it into the hotel: a glowing
// panoramic window ring and glass cupola, rows of windows, a taxi docking.
function cycler(side) {
  const lab = side === 'secondary';
  return `${pp('c1' + side[0], 22, 112, 16, { kind: 'earth', seed: 41 })}${pp('c2' + side[0], 282, 40, 10, { kind: 'mars', seed: 42 })}
   <ellipse cx="152" cy="76" rx="134" ry="44" fill="none" stroke="#94a3b8" stroke-width="1" stroke-dasharray="4 4" transform="rotate(-14 152 76)"/>
   <ellipse cx="190" cy="70" rx="58" ry="60" fill="#bfdbfe" fill-opacity="0.12" stroke="#93c5fd" stroke-width="1" stroke-dasharray="3 5"/>
   <rect x="148" y="84" width="84" height="12" fill="url(#hul)" stroke="${INK}"/>
   ${[[160, 48, 18], [214, 54, 18], [182, 20, 26]].map(([x, y, w]) => `<rect x="${x}" y="${y}" width="${w}" height="${96 - y}" rx="3" fill="url(#hul)" stroke="${INK}" stroke-width="1"/>${lab ? [...Array(Math.floor((84 - y) / 9))].map((_, k) => win(x + 3, y + 8 + k * 9, x + w - 3)).join('') : ''}`).join('')}
   <path d="M182,20 Q195,2 208,20 Z" fill="${lab ? '#fde68a' : '#cbd5e1'}" stroke="${INK}" ${lab ? 'filter="url(#glow)"' : ''}/>
   ${lab ? `<rect x="180" y="36" width="30" height="7" fill="#fde68a" filter="url(#glow)"/><path d="M262,92 l14,-4 l2,8 Z" fill="#e2e8f0" stroke="${INK}"/><line x1="232" y1="90" x2="262" y2="92" stroke="#94a3b8" stroke-dasharray="2 2"/>` : `${lumps(195, 60, 38, 40, 419, 10, Math.PI * 0.8, Math.PI * 1.3)}${SIG(419)}`}`;
}

const DRAW = { ber_geo_elevator_bernal: geo, ber_l1_climate_control_bernal: l1, ber_l2_collimator_bernal: l2, ber_l3_lofstrom_loop_microgravity: l3, ber_l4_antimatter_factory: l4, ber_l4s_pharmaceutics_bernal: l4s, ber_l5_solar_cell_factory: l5, ber_l5s_cancer_hospital: l5s, ber_sso_diplomatic: sso, ber_tourism_cycler: cycler };
let seed = 400;
for (const [id, draw] of Object.entries(DRAW)) {
  for (const side of ['primary', 'secondary']) { const s2 = seed++; ART[`${id}:${side}`] = () => scene(`${id}:${side}`, s2, '', draw(side)); }
}

for (const id of Object.keys(BERNALS_BY_ID)) {
  for (const side of ['primary', 'secondary']) {
    if (!ART[`${id}:${side}`]) throw new Error(`bernal art missing: ${id}:${side}`);
  }
}
