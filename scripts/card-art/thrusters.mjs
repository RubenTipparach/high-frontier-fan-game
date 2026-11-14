// Thruster deck art: 12 cards x 2 faces. Every engine is bolted to a
// spacecraft (the kit's shipBody, mounted through RIG). See
// docs/card-art-guide.md.
import { H, SHIP_DEFS, SUBJECT, W, bell, capsule, dish, f, lin, plume, rad, radiator, shipBody, solarWing, space, stars, svg, truss, windows } from './kit.mjs';

// ---- the 24 faces ----------------------------------------------------------

export const ART = {};

// Ablative Plate: a pusher plate. Each pulse detonates directly behind the
// plate, on the ship's axis; the blast ablates the plate's face and shoves the
// ship forward, debris spraying away behind it (user 2026-11-13: "the bomb
// should be directly behind the push plate").
ART['thr_ablative_plate:primary'] = () => {
  const bg = space('#2a1a2e', '#07060c', '30%', '75%');
  // Local frame of the vessel: plate across y 96-112, ship forward (-y),
  // the blast behind it (+y), all on the axis x = 210.
  const sparks = [...Array(24)].map((_, i) => {
    const a = (25 + (i * 37) % 130) * Math.PI / 180, d = 34 + (i * 53) % 70;
    return `<circle cx="${f(210 + Math.cos(a) * d)}" cy="${f(140 + Math.sin(a) * d)}" r="${1 + (i % 3)}" fill="#ffd27a" opacity="${f(0.95 - d / 120)}"/>`;
  }).join('');
  return svg(bg.defs + lin('plate', [[0, '#d9dde6'], [1, '#6b7280']], 0, 0, 1, 0)
    + rad('blast', [[0, '#ffffff'], [0.25, '#fff7d6'], [0.55, '#ffb347', 0.9], [1, '#ff5a1f', 0]]),
  `${bg.body}${stars(40, 1)}
  <g transform="rotate(-40 210 108)">
    <circle cx="210" cy="142" r="44" fill="url(#blast)"/>
    <circle cx="210" cy="140" r="11" fill="#ffffff" filter="url(#glow)"/>
    ${sparks}
    <path d="M152,113 Q210,128 268,113" stroke="#fde68a" stroke-width="5" fill="none" opacity="0.85" filter="url(#glow)"/>
    <rect x="150" y="96" width="120" height="16" rx="4" fill="url(#plate)"/>
    <rect x="196" y="40" width="28" height="56" rx="6" fill="#9aa3b5"/>
    <rect x="200" y="20" width="20" height="22" rx="4" fill="#c4cad6"/>
    <line x1="170" y1="96" x2="200" y2="70" stroke="#7d8597" stroke-width="3"/>
    <line x1="250" y1="96" x2="220" y2="70" stroke="#7d8597" stroke-width="3"/>
    <rect x="182" y="78" width="8" height="18" rx="2" fill="#6b7280"/><rect x="230" y="78" width="8" height="18" rx="2" fill="#6b7280"/>
  </g>`);
};

// Ablative Nozzle: a charred, layered ablative liner; the hot core fires out
// sideways in a long orange flame.
ART['thr_ablative_plate:secondary'] = () => {
  const bg = space('#1c1410', '#060505', '70%', '50%');
  return svg(bg.defs + lin('fl', [[0, '#fff3c4'], [0.3, '#ffb03a'], [1, '#ff4d1a', 0]], 0, 0, 1, 0)
    + lin('liner', [[0, '#3b2a20'], [0.5, '#6b4a33'], [1, '#2a1d16']]),
  `${bg.body}${stars(25, 2)}
  <path d="M0,104 L80,104 Q112,104 126,124 L300,60 L300,228 L126,164 Q112,184 80,184 L0,184 Z" fill="url(#liner)"/>
  ${[0, 1, 2, 3, 4, 5].map((i) => `<path d="M${140 + i * 26},${f(118 - i * 9.4)} L${140 + i * 26},${f(170 + i * 9.4)}" stroke="#1a110c" stroke-width="3" opacity="0.7"/>`).join('')}
  <path d="M126,124 L300,74 L300,214 L126,164 Z" fill="#1a110c" opacity="0.65"/>
  <path d="M110,144 L300,96 L300,192 Z" fill="url(#fl)" filter="url(#glow)"/>
  <path d="M110,144 L300,124 L300,164 Z" fill="#fff8de" opacity="0.8"/>
  ${[0, 1, 2, 3, 4].map((i) => `<circle cx="${180 + i * 24}" cy="144" r="${6 - i}" fill="#ffffff" opacity="0.7"/>`).join('')}`);
};

// De Laval Nozzle: the classic convergent-divergent bell, shown as a cutaway
// with the throat, and shock diamonds in the exhaust.
ART['thr_de_laval_nozzle:primary'] = () => {
  const bg = space('#1b2440', '#06070e');
  return svg(bg.defs + lin('metal', [[0, '#5b6474'], [0.45, '#d6dbe4'], [1, '#4a5260']], 0, 0, 1, 0)
    + lin('ex', [[0, '#e8f4ff'], [0.4, '#7cc4ff', 0.8], [1, '#3a7bd5', 0]]),
  `${bg.body}${stars(40, 3)}
  ${plume(150, 196, 0, 110, 58, 90, 'url(#ex)', 0.85)}
  ${[0, 1, 2, 3].map((i) => `<path d="M${150},${206 + i * 22} l${12 - i * 2},11 l-${12 - i * 2},11 l-${12 - i * 2},-11 Z" fill="#ffffff" opacity="${f(0.9 - i * 0.18)}"/>`).join('')}
  ${bell(150, 10, { chamberW: 64, chamberH: 46, throatW: 26, exitW: 128, len: 126, fill: 'url(#metal)' })}
  <path d="M150,10 L150,196" stroke="#2a3140" stroke-width="1.5" stroke-dasharray="4 4" opacity="0.6"/>
  ${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<path d="M${f(150 - 16 - i * 6)},${84 + i * 14} L${f(150 + 16 + i * 6)},${84 + i * 14}" stroke="#3c4452" stroke-width="1" opacity="0.5"/>`).join('')}`);
};

// Magnetic Nozzle: no walls - a stack of superconducting coils whose flaring
// field lines shape the plasma jet.
ART['thr_de_laval_nozzle:secondary'] = () => {
  const bg = space('#1a1236', '#05040b');
  const coils = [0, 1, 2, 3, 4].map((i) => {
    const y = 40 + i * 30, rx = 34 + i * 16;
    return `<ellipse cx="150" cy="${y}" rx="${rx}" ry="${f(rx * 0.22)}" fill="none" stroke="url(#cu)" stroke-width="9"/>`;
  }).join('');
  const field = [-1, 1].map((s) => [0, 1, 2].map((k) =>
    `<path d="M${150 + s * (10 + k * 10)},0 Q${150 + s * (24 + k * 22)},120 ${150 + s * (80 + k * 50)},288" fill="none" stroke="#7fb3ff" stroke-width="1.4" opacity="${0.75 - k * 0.2}" stroke-dasharray="6 5"/>`).join('')).join('');
  return svg(bg.defs + lin('cu', [[0, '#7a3d12'], [0.5, '#f0a35c'], [1, '#7a3d12']], 0, 0, 1, 0)
    + lin('pl', [[0, '#ffffff'], [0.3, '#c08bff', 0.9], [1, '#6d28d9', 0]]),
  `${bg.body}${stars(40, 4)}
  ${plume(150, 30, 0, 250, 14, 110, 'url(#pl)', 0.85)}
  ${field}${coils}`);
};

// Dumbo: the Los Alamos folded-flow reactor - a stack of grooved fuel
// washers glowing inside the pressure vessel, over a regenerative bell.
ART['thr_dumbo:primary'] = () => {
  const bg = space('#2b2010', '#070604');
  const disks = [...Array(9)].map((_, i) => {
    const y = 34 + i * 13;
    return `<rect x="104" y="${y}" width="92" height="8" rx="3" fill="url(#hot)"/><rect x="138" y="${y}" width="24" height="8" fill="#2b1608"/>`;
  }).join('');
  return svg(bg.defs + lin('vessel', [[0, '#4b4f58'], [0.5, '#a7adb8'], [1, '#3e424a']], 0, 0, 1, 0)
    + lin('hot', [[0, '#ff6a00'], [0.5, '#ffe08a'], [1, '#ff6a00']], 0, 0, 1, 0)
    + lin('ex', [[0, '#fff6e0'], [1, '#ffd08a', 0]]),
  `${bg.body}${stars(25, 5)}
  ${plume(150, 238, 0, 70, 50, 80, 'url(#ex)', 0.7)}
  ${bell(150, 168, { chamberW: 70, chamberH: 4, throatW: 30, exitW: 110, len: 52, fill: 'url(#vessel)' })}
  <rect x="88" y="18" width="124" height="158" rx="18" fill="url(#vessel)"/>
  <rect x="100" y="28" width="100" height="128" rx="8" fill="#1d1208"/>
  ${disks}
  <rect x="96" y="20" width="108" height="10" rx="4" fill="#d3d7de"/>
  <g transform="translate(150 190)" opacity="0.85">
    <circle r="6" fill="#ffd400"/>
    ${[0, 120, 240].map((a) => `<path d="M0,0 L${f(18 * Math.sin((a - 30) * Math.PI / 180))},${f(-18 * Math.cos((a - 30) * Math.PI / 180))} A18,18 0 0 1 ${f(18 * Math.sin((a + 30) * Math.PI / 180))},${f(-18 * Math.cos((a + 30) * Math.PI / 180))} Z" fill="#ffd400"/>`).join('')}
    <circle r="3" fill="#1a1a1a"/>
  </g>`);
};

// Timberwind: a particle-bed reactor - a cutaway canister packed with tiny
// glowing fuel spheres around a central hydrogen channel.
ART['thr_dumbo:secondary'] = () => {
  const bg = space('#0f2236', '#04070b');
  let beads = '';
  let s = 7;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let i = 0; i < 240; i++) {
    const a = rnd() * Math.PI * 2, r = 30 + rnd() * 48;
    const x = 150 + Math.cos(a) * r, y = 40 + rnd() * 140;
    if (Math.abs(x - 150) < 16) continue;
    beads += `<circle cx="${f(x)}" cy="${f(y)}" r="3.2" fill="url(#bead)"/>`;
  }
  return svg(bg.defs + rad('bead', [[0, '#fffbe6'], [0.5, '#ffb84d'], [1, '#c2410c']])
    + lin('can', [[0, '#334155'], [0.5, '#94a3b8'], [1, '#334155']], 0, 0, 1, 0)
    + lin('ex', [[0, '#e0f2ff'], [0.5, '#60a5fa', 0.7], [1, '#1d4ed8', 0]]),
  `${bg.body}${stars(35, 6)}
  ${plume(150, 228, 0, 80, 40, 80, 'url(#ex)', 0.85)}
  ${bell(150, 186, { chamberW: 60, chamberH: 2, throatW: 22, exitW: 86, len: 40, fill: 'url(#can)' })}
  <rect x="64" y="26" width="172" height="166" rx="22" fill="url(#can)"/>
  <rect x="72" y="34" width="156" height="150" rx="14" fill="#0b1220"/>
  ${beads}
  <rect x="136" y="34" width="28" height="150" fill="#7dd3fc" opacity="0.35"/>
  <rect x="146" y="34" width="8" height="150" fill="#e0f2fe" opacity="0.7"/>`);
};

// Hall Effect: a Hall thruster seen three-quarter on. It is a squat disc,
// not a can: four copper outer magnet coils ring the face, the annular
// discharge channel glows between the outer and inner poles, the cathode sits
// at the centre, and the plume is a soft glow that is brightest at the ring
// and fades as it spreads. Gimballed to the stern of a tug.
ART['thr_hall_effect:primary'] = () => {
  const bg = space('#0c1830', '#03050a', '30%', '45%');
  const RX = 30, RY = 78;           // the face ellipse (foreshortened disc)
  const D = 22;                     // body depth - Hall thrusters are shallow
  const at = (deg, k) => [f(Math.cos(deg * Math.PI / 180) * RX * k), f(Math.sin(deg * Math.PI / 180) * RY * k)];
  const coils = [45, 135, 225, 315].map((deg) => {
    const [x, y] = at(deg, 1.12);
    return `<g transform="translate(${x} ${y})">
      <rect x="-${D}" y="-11" width="${D + 4}" height="22" rx="3" fill="url(#hcoilSide)"/>
      <ellipse cx="4" cy="0" rx="5" ry="11" fill="url(#hcoil)" stroke="#7c2d12" stroke-width="1"/>
      <ellipse cx="4.5" cy="0" rx="2" ry="4.5" fill="#3b1d0e"/>
    </g>`;
  }).join('');
  return svg(bg.defs
    + lin('hside', [[0, '#d5dbe4'], [0.4, '#8d96a6'], [1, '#353b47']])
    + rad('hface', [[0, '#3c4352'], [0.8, '#596274'], [1, '#9aa4b5']])
    + lin('hcoil', [[0, '#f6b26b'], [0.5, '#c2621f'], [1, '#7c2d12']])
    + lin('hcoilSide', [[0, '#e3954f'], [1, '#6b2a0e']])
    + lin('hplume', [[0, '#dbe7ff', 0.95], [0.18, '#8fb0ff', 0.7], [0.55, '#6a52e0', 0.28], [1, '#3b1d8f', 0]], 0, 0, 1, 0)
    + rad('hring', [[0.6, '#7aa0ff', 0], [0.82, '#c9dcff', 1], [0.9, '#ffffff', 1], [1, '#5b7cff', 0]])
    + '<filter id="hblur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="7"/></filter>',
  `${bg.body}${stars(45, 7)}
  <g transform="translate(100 166) rotate(38) scale(0.68)">
    <!-- gimbal to the ship -->
    <g transform="translate(-${D + 30} 0) rotate(-90)">${shipBody('tug')}</g>
    <rect x="-${D + 32}" y="-8" width="16" height="16" fill="#4b5260"/>
    <path d="M-${D + 18},-40 L-${D},-30 M-${D + 18},40 L-${D},30" stroke="#8e97a6" stroke-width="5"/>
    <!-- soft plume: a wide diffuse fan, a brighter inner cone, a hot axial spike -->
    <path d="M0,-60 Q120,-120 360,-210 L360,210 Q120,120 0,60 Z" fill="url(#hplume)" filter="url(#hblur)" opacity="0.85"/>
    <path d="M0,-52 Q90,-60 300,-100 L300,100 Q90,60 0,52 Z" fill="url(#hplume)" filter="url(#hblur)"/>
    <path d="M6,-6 L260,-14 L260,14 L6,6 Z" fill="#eef4ff" opacity="0.35" filter="url(#hblur)"/>
    <!-- body: back rim, shallow side, outer coils, then the face -->
    <ellipse cx="-${D}" cy="0" rx="${RX}" ry="${RY}" fill="#262b35"/>
    <path d="M-${D},-${RY} L0,-${RY} L0,${RY} L-${D},${RY} Z" fill="url(#hside)"/>
    ${coils}
    <ellipse cx="0" cy="0" rx="${RX}" ry="${RY}" fill="url(#hface)" stroke="#b7c0cf" stroke-width="2"/>
    <ellipse cx="1" cy="0" rx="${f(RX * 0.74)}" ry="${f(RY * 0.74)}" fill="none" stroke="#5b7cff" stroke-width="22" opacity="0.55" filter="url(#hblur)"/>
    <ellipse cx="1" cy="0" rx="${f(RX * 0.74)}" ry="${f(RY * 0.74)}" fill="none" stroke="#9fbcff" stroke-width="10"/>
    <ellipse cx="1" cy="0" rx="${f(RX * 0.74)}" ry="${f(RY * 0.74)}" fill="none" stroke="#ffffff" stroke-width="3.5"/>
    <ellipse cx="1" cy="0" rx="${f(RX * 0.5)}" ry="${f(RY * 0.5)}" fill="#4a5262" stroke="#8f99ab" stroke-width="1.5"/>
    <!-- centre-mounted hollow cathode -->
    <rect x="1" y="-6" width="12" height="12" rx="2" fill="#a3acbc"/>
    <circle cx="14" cy="0" r="5" fill="#eaf1ff" filter="url(#glow)"/>
  </g>`);
};

// Ion Drive: a gridded ion engine in profile - the perforated grid glows and
// a long cool-blue beam streams out.
ART['thr_hall_effect:secondary'] = () => {
  const bg = space('#0a1630', '#02040a', '20%', '50%');
  let holes = '';
  for (let y = 70; y <= 218; y += 12) holes += `<circle cx="104" cy="${y}" r="3.2" fill="#bae6fd"/>`;
  return svg(bg.defs + lin('beam', [[0, '#e0f7ff'], [0.25, '#38bdf8', 0.85], [1, '#0ea5e9', 0]], 0, 0, 1, 0)
    + lin('shell', [[0, '#cbd5e1'], [0.5, '#64748b'], [1, '#334155']]),
  `${bg.body}${stars(45, 8)}
  <path d="M104,64 L300,20 L300,268 L104,224 Z" fill="url(#beam)" filter="url(#glow)" opacity="0.9"/>
  <path d="M104,104 L300,96 L300,192 L104,184 Z" fill="#f0fbff" opacity="0.35"/>
  <path d="M8,92 L92,60 L104,60 L104,228 L92,228 L8,196 Z" fill="url(#shell)"/>
  <rect x="96" y="58" width="12" height="172" rx="4" fill="#94a3b8"/>
  ${holes}
  <rect x="20" y="132" width="48" height="24" rx="4" fill="#1e293b"/>
  <rect x="26" y="138" width="10" height="12" fill="#f59e0b"/>`);
};

// Mass Driver (O'Neill / Kolm): a long straight linear accelerator - drive
// coils evenly spaced around a guide tube, magnetic buckets racing down it,
// and slugs of regolith flung out of the muzzle as reaction mass. Fed from
// a hopper at the breech, bolted to a freighter. The thrust is the recoil.
ART['thr_mass_driver:primary'] = () => {
  const bg = space('#1b1a2a', '#050409', '80%', '20%');
  const x0 = 70, y0 = 222, x1 = 262, y1 = 78, ang = Math.atan2(y1 - y0, x1 - x0) * 180 / Math.PI;
  const at = (t) => [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
  const coils = [...Array(12)].map((_, i) => { const [x, y] = at(0.06 + i * 0.08); return `<rect x="${f(x - 3)}" y="${f(y - 14)}" width="6" height="28" rx="2" fill="#d97706" stroke="#1f2937" stroke-width="1" transform="rotate(${f(ang)} ${f(x)} ${f(y)})"/>`; }).join('');
  const buckets = [0.3, 0.62].map((t) => { const [x, y] = at(t); return `<rect x="${f(x - 7)}" y="${f(y - 5)}" width="14" height="10" rx="3" fill="#94a3b8" stroke="#1f2937" stroke-width="1" transform="rotate(${f(ang)} ${f(x)} ${f(y)})"/><circle cx="${f(x)}" cy="${f(y)}" r="2.6" fill="#78716c"/>`; }).join('');
  const slugs = [...Array(6)].map((_, i) => { const [x, y] = at(1.06 + i * 0.07); return `<line x1="${f(x - 9 * Math.cos(ang * Math.PI / 180))}" y1="${f(y - 9 * Math.sin(ang * Math.PI / 180))}" x2="${f(x)}" y2="${f(y)}" stroke="#a8a29e" stroke-width="1" opacity="${f(0.8 - i * 0.1)}"/><circle cx="${f(x)}" cy="${f(y)}" r="${f(3.2 - i * 0.3)}" fill="#78716c" stroke="#1f2937" stroke-width="0.6"/>`; }).join('');
  return svg(bg.defs + lin('tube', [[0, '#64748b'], [0.5, '#e2e8f0'], [1, '#475569']]),
  `${bg.body}${stars(50, 9)}
  <line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="#1f2937" stroke-width="12" stroke-linecap="round"/>
  <line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="url(#tube)" stroke-width="9" stroke-linecap="round"/>
  ${buckets}${coils}
  <path d="M${x0 - 16},${y0 - 30} L${x0 + 14},${y0 - 30} L${x0 + 4},${y0 - 8} L${x0 - 6},${y0 - 8} Z" fill="#57534e" stroke="#1f2937" stroke-width="1.2"/>
  ${[0, 1, 2, 3].map((i) => `<circle cx="${x0 - 10 + i * 6}" cy="${y0 - 33}" r="3" fill="#78716c"/>`).join('')}
  ${slugs}`);
};

// MPD T-wave: a magnetoplasmadynamic thruster - a central cathode rod inside
// an anode ring, current spokes arcing between them and twisting the plasma
// into a travelling-wave jet.
ART['thr_mass_driver:secondary'] = () => {
  const bg = space('#1e0f33', '#05030a', '30%', '50%');
  const waves = [0, 1, 2, 3, 4, 5].map((i) => {
    const x = 140 + i * 28;
    return `<ellipse cx="${x}" cy="144" rx="${8 + i * 2}" ry="${36 + i * 12}" fill="none" stroke="#e9d5ff" stroke-width="${f(3 - i * 0.35)}" opacity="${f(0.9 - i * 0.13)}"/>`;
  }).join('');
  return svg(bg.defs + lin('jet', [[0, '#ffffff'], [0.3, '#c084fc', 0.9], [1, '#7e22ce', 0]], 0, 0, 1, 0)
    + lin('anode', [[0, '#9ca3af'], [0.5, '#e5e7eb'], [1, '#6b7280']]),
  `${bg.body}${stars(40, 10)}
  <path d="M120,110 L300,30 L300,258 L120,178 Z" fill="url(#jet)" filter="url(#glow)" opacity="0.9"/>
  ${waves}
  <path d="M30,70 L120,96 L120,192 L30,218 Z" fill="url(#anode)"/>
  <path d="M40,86 L112,104 L112,184 L40,202 Z" fill="#1b1030"/>
  <rect x="34" y="138" width="96" height="12" rx="6" fill="#f3f4f6"/>
  ${[-1, 1].map((s) => [0, 1, 2].map((k) => `<path d="M${70 + k * 18},144 q6,${s * 14} -2,${s * 34}" stroke="#f0abfc" stroke-width="2" fill="none" filter="url(#glow)"/>`).join('')).join('')}`);
};

// Metastable Helium: excited-state helium held in a frosted cryo-dewar; the
// atom diagram shows one electron raised to the metastable orbit, and the
// yellow helium-line exhaust.
ART['thr_metastable_helium:primary'] = () => {
  const bg = space('#1f2a1a', '#050705');
  return svg(bg.defs + rad('tank', [[0, '#f8fafc'], [0.6, '#cbd5e1'], [1, '#64748b']], '35%', '30%', '75%')
    + lin('ex', [[0, '#fffbe0'], [0.4, '#fde047', 0.8], [1, '#eab308', 0]]),
  `${bg.body}${stars(35, 11)}
  ${plume(150, 214, 0, 90, 22, 70, 'url(#ex)', 0.85)}
  <rect x="140" y="196" width="20" height="22" fill="#94a3b8"/>
  <ellipse cx="150" cy="120" rx="96" ry="84" fill="url(#tank)"/>
  ${[...Array(18)].map((_, i) => `<circle cx="${f(70 + (i * 47) % 160)}" cy="${f(60 + (i * 29) % 120)}" r="${1 + (i % 3)}" fill="#ffffff" opacity="0.8"/>`).join('')}
  <g transform="translate(150 120)">
    <circle r="11" fill="#facc15" filter="url(#glow)"/>
    <ellipse rx="34" ry="14" fill="none" stroke="#1e293b" stroke-width="2"/>
    <ellipse rx="66" ry="28" fill="none" stroke="#ca8a04" stroke-width="2.5" stroke-dasharray="5 4"/>
    <circle cx="34" cy="0" r="5" fill="#1e293b"/>
    <circle cx="-62" cy="-10" r="6" fill="#facc15" filter="url(#glow)"/>
  </g>`);
};

// n-6Li Microfission: lithium-6 pellets are shot into a pulse chamber and
// detonated by a neutron flash, one bright burst after another.
ART['thr_metastable_helium:secondary'] = () => {
  const bg = space('#2a0f14', '#060203');
  const bursts = [0, 1, 2, 3].map((i) => {
    const y = 210 + i * 26, r = 36 - i * 7;
    return `<circle cx="150" cy="${y}" r="${r}" fill="url(#burst)" opacity="${f(1 - i * 0.22)}"/>`;
  }).join('');
  return svg(bg.defs + rad('burst', [[0, '#ffffff'], [0.3, '#fef08a'], [0.7, '#f97316', 0.6], [1, '#dc2626', 0]])
    + lin('ch', [[0, '#3f3f46'], [0.5, '#a1a1aa'], [1, '#3f3f46']], 0, 0, 1, 0),
  `${bg.body}${stars(30, 12)}
  ${bursts}
  <path d="M60,20 L240,20 L240,90 Q240,150 150,170 Q60,150 60,90 Z" fill="url(#ch)"/>
  <path d="M80,36 L220,36 L220,92 Q220,134 150,150 Q80,134 80,92 Z" fill="#18181b"/>
  ${[0, 1, 2, 3].map((i) => `<circle cx="${110 + i * 26}" cy="${56 + (i % 2) * 14}" r="5" fill="#a7f3d0" stroke="#34d399" stroke-width="1.5"/>`).join('')}
  <circle cx="150" cy="118" r="18" fill="url(#burst)" filter="url(#glow)"/>
  ${[...Array(10)].map((_, i) => { const a = i * 36 * Math.PI / 180; return `<line x1="150" y1="118" x2="${f(150 + Math.cos(a) * 34)}" y2="${f(118 + Math.sin(a) * 34)}" stroke="#fde68a" stroke-width="1.5" opacity="0.8"/>`; }).join('')}`);
};

// Monoatomic Plug Nozzle: an aerospike - the exhaust hugs a central plug
// instead of a bell; the atomic-hydrogen stream is drawn as fine dots.
ART['thr_monoatomic_plug_nozzle:primary'] = () => {
  const bg = space('#13233a', '#04070b');
  let dots = '';
  for (let i = 0; i < 70; i++) {
    const t = (i * 0.618) % 1, side = i % 2 ? 1 : -1;
    const y = 120 + t * 160, x = 150 + side * (18 + t * 40 + ((i * 13) % 20));
    dots += `<circle cx="${f(x)}" cy="${f(y)}" r="1.6" fill="#e0f2fe" opacity="${f(0.9 - t * 0.6)}"/>`;
  }
  return svg(bg.defs + lin('spike', [[0, '#475569'], [0.5, '#e2e8f0'], [1, '#475569']], 0, 0, 1, 0)
    + lin('ex', [[0, '#fff1d6'], [0.4, '#fb923c', 0.75], [1, '#ea580c', 0]]),
  `${bg.body}${stars(35, 13)}
  <path d="M96,96 Q120,180 128,288 L172,288 Q180,180 204,96 Z" fill="url(#ex)" filter="url(#glow)" opacity="0.85"/>
  ${dots}
  <rect x="60" y="30" width="180" height="56" rx="10" fill="url(#spike)"/>
  <path d="M100,86 L200,86 Q168,170 150,250 Q132,170 100,86 Z" fill="url(#spike)"/>
  <rect x="88" y="84" width="16" height="10" fill="#fb923c" filter="url(#glow)"/>
  <rect x="196" y="84" width="16" height="10" fill="#fb923c" filter="url(#glow)"/>`);
};

// Vortex Confined Nozzle: propellant spirals down the chamber wall in a cold
// outer vortex, keeping the hot core off the walls.
ART['thr_monoatomic_plug_nozzle:secondary'] = () => {
  const bg = space('#0c1f2a', '#030608');
  let spiral = '';
  for (let i = 0; i < 7; i++) {
    const y = 34 + i * 20;
    spiral += `<path d="M84,${y} Q150,${y + 22} 216,${y + 10}" fill="none" stroke="#67e8f9" stroke-width="3" opacity="0.85"/>`
      + `<path d="M216,${y + 10} Q150,${y - 4} 84,${y + 20}" fill="none" stroke="#0e7490" stroke-width="2" opacity="0.6"/>`;
  }
  return svg(bg.defs + lin('core', [[0, '#fff7ed'], [0.5, '#fb923c'], [1, '#ef4444', 0]])
    + lin('wall', [[0, '#1e3a46'], [0.5, '#64748b'], [1, '#1e3a46']], 0, 0, 1, 0),
  `${bg.body}${stars(30, 14)}
  ${plume(150, 214, 0, 80, 30, 80, 'url(#core)', 0.8)}
  <path d="M70,20 L230,20 L230,170 Q230,190 180,214 L120,214 Q70,190 70,170 Z" fill="url(#wall)"/>
  <path d="M80,28 L220,28 L220,168 Q220,184 176,206 L124,206 Q80,184 80,168 Z" fill="#071820"/>
  <path d="M150,30 Q168,110 150,210 Q132,110 150,30 Z" fill="url(#core)" filter="url(#glow)"/>
  ${spiral}`);
};

// Photon Heliogyro: long ribbon blades spun out from a central hub like a
// rotor, stiffened by their own rotation, riding sunlight.
ART['thr_photon_heliogyro:primary'] = () => {
  const bg = space('#1a1530', '#040309', '90%', '10%');
  const blades = [...Array(10)].map((_, i) => {
    const a = i * 36 + 8;
    return `<g transform="rotate(${a} 150 150)"><path d="M150,146 L300,140 Q304,150 300,160 L150,154 Z" fill="url(#film)" opacity="0.92"/><line x1="150" y1="150" x2="300" y2="150" stroke="#fef3c7" stroke-width="0.8" opacity="0.6"/></g>`;
  }).join('');
  return svg(bg.defs + lin('film', [[0, '#cbd5e1'], [0.5, '#fef9c3'], [1, '#94a3b8']], 0, 0, 1, 0)
    + rad('sun', [[0, '#fffbeb'], [0.3, '#fcd34d', 0.8], [1, '#f59e0b', 0]]),
  `${bg.body}${stars(40, 15)}
  <circle cx="300" cy="0" r="110" fill="url(#sun)"/>
  ${blades}
  <circle cx="150" cy="150" r="16" fill="#475569" stroke="#e2e8f0" stroke-width="3"/>
  <circle cx="150" cy="150" r="6" fill="#facc15"/>`);
};

// Electric Sail: a hub trailing dozens of long charged tethers; their blue
// electric sheath pushes against the solar wind streaming past.
ART['thr_photon_heliogyro:secondary'] = () => {
  const bg = space('#0b1a2e', '#020409');
  const wires = [...Array(16)].map((_, i) => {
    const a = (i * 22.5) * Math.PI / 180;
    const x = 150 + Math.cos(a) * 220, y = 144 + Math.sin(a) * 220;
    return `<line x1="150" y1="144" x2="${f(x)}" y2="${f(y)}" stroke="#60a5fa" stroke-width="7" opacity="0.18"/><line x1="150" y1="144" x2="${f(x)}" y2="${f(y)}" stroke="#dbeafe" stroke-width="1"/>`;
  }).join('');
  const wind = [...Array(14)].map((_, i) => {
    const y = 12 + i * 20, x = (i * 71) % 160;
    return `<line x1="${x}" y1="${y}" x2="${x + 34}" y2="${y + 6}" stroke="#fde68a" stroke-width="1.6" opacity="0.55" stroke-linecap="round"/>`;
  }).join('');
  return svg(bg.defs,
  `${bg.body}${stars(30, 16)}${wind}${wires}
  <circle cx="150" cy="144" r="24" fill="#3b82f6" opacity="0.3" filter="url(#soft)"/>
  <rect x="136" y="130" width="28" height="28" rx="5" fill="#94a3b8" stroke="#e2e8f0" stroke-width="2"/>
  <rect x="112" y="139" width="22" height="10" fill="#1d4ed8"/><rect x="166" y="139" width="22" height="10" fill="#1d4ed8"/>`);
};

// Photon Kite Sail: a square reflective film on four diagonal booms, bellied
// by sunlight, with its payload hanging from the shrouds like a kite.
ART['thr_photon_kite_sail:primary'] = () => {
  const bg = space('#231a33', '#050309', '10%', '10%');
  return svg(bg.defs + lin('film', [[0, '#fff7d6'], [0.45, '#e5e7eb'], [1, '#9ca3af']], 0, 0, 1, 1)
    + rad('sun', [[0, '#fffbeb'], [0.35, '#fde68a', 0.7], [1, '#f59e0b', 0]]),
  `${bg.body}${stars(40, 17)}
  <circle cx="0" cy="0" r="120" fill="url(#sun)"/>
  ${[0, 1, 2, 3, 4].map((i) => `<line x1="0" y1="${10 + i * 26}" x2="${120 + i * 10}" y2="${80 + i * 34}" stroke="#fde68a" stroke-width="1.2" opacity="0.4"/>`).join('')}
  <path d="M150,24 Q206,92 270,124 Q200,150 150,236 Q110,156 30,124 Q100,98 150,24 Z" fill="url(#film)"/>
  <path d="M150,24 L150,236 M30,124 L270,124" stroke="#6b7280" stroke-width="2.5"/>
  <path d="M150,24 L150,124 L30,124 Z" fill="#ffffff" opacity="0.18"/>
  <path d="M30,124 L150,260 L270,124 M150,236 L150,260" stroke="#d1d5db" stroke-width="0.8" fill="none" opacity="0.7"/>
  <rect x="140" y="258" width="20" height="16" rx="3" fill="#475569" stroke="#cbd5e1" stroke-width="1.5"/>`);
};

// Mag Sail: a huge superconducting loop whose magnetic bubble deflects the
// solar wind; the payload trails on shroud lines.
ART['thr_photon_kite_sail:secondary'] = () => {
  const bg = space('#0c1630', '#02040a', '50%', '50%');
  const flow = [...Array(9)].map((_, i) => {
    const y = 18 + i * 32, dy = (y - 144) * 0.9;
    const bend = Math.abs(dy) < 110 ? (dy >= 0 ? 1 : -1) * (120 - Math.abs(dy)) * 0.8 : 0;
    return `<path d="M0,${y} Q120,${f(y + bend)} 300,${y}" fill="none" stroke="#fde68a" stroke-width="1.4" opacity="0.5" stroke-dasharray="8 6"/>`;
  }).join('');
  const field = [40, 70, 100].map((r) => `<ellipse cx="170" cy="144" rx="${r}" ry="${f(r * 1.25)}" fill="none" stroke="#818cf8" stroke-width="1.6" opacity="${f(0.9 - r / 160)}"/>`).join('');
  return svg(bg.defs + rad('bubble', [[0.6, '#6366f1', 0], [0.95, '#818cf8', 0.35], [1, '#818cf8', 0]]),
  `${bg.body}${stars(40, 18)}${flow}
  <ellipse cx="170" cy="144" rx="130" ry="150" fill="url(#bubble)"/>
  ${field}
  <ellipse cx="170" cy="144" rx="22" ry="60" fill="none" stroke="#c7d2fe" stroke-width="6" filter="url(#glow)"/>
  <path d="M170,84 L248,144 L170,204" stroke="#94a3b8" stroke-width="0.8" fill="none"/>
  <rect x="246" y="136" width="18" height="16" rx="3" fill="#64748b" stroke="#e2e8f0" stroke-width="1.5"/>`);
};

// Ponderomotive VASIMR: a long magnetic bottle in stages - helicon source,
// RF booster, then the flared magnetic nozzle - the plasma heating from
// violet to white as it goes.
ART['thr_ponderomotive_vasimr:primary'] = () => {
  const bg = space('#1a0f2e', '#040208', '10%', '50%');
  const coils = [...Array(9)].map((_, i) => {
    const x = 26 + i * 22, r = i < 7 ? 46 : 46 + (i - 6) * 18;
    return `<ellipse cx="${x}" cy="144" rx="7" ry="${r}" fill="none" stroke="${i < 3 ? '#a78bfa' : i < 7 ? '#f472b6' : '#e5e7eb'}" stroke-width="6" opacity="0.9"/>`;
  }).join('');
  return svg(bg.defs + lin('pl', [[0, '#6d28d9'], [0.45, '#f0abfc'], [0.7, '#ffffff'], [1, '#c4b5fd', 0]], 0, 0, 1, 0)
    + lin('tube', [[0, '#475569'], [0.5, '#94a3b8'], [1, '#334155']]),
  `${bg.body}${stars(40, 19)}
  <rect x="14" y="110" width="170" height="68" rx="10" fill="url(#tube)" opacity="0.5"/>
  <path d="M18,128 L170,124 Q230,124 300,40 L300,248 Q230,164 170,164 L18,160 Z" fill="url(#pl)" filter="url(#glow)" opacity="0.92"/>
  ${coils}
  <text x="40" y="94" fill="#c4b5fd" font-family="sans-serif" font-size="11" opacity="0">.</text>
  ${[0, 1, 2].map((i) => `<path d="M${76 + i * 8},90 q6,-10 0,-20 q-6,-10 0,-20" stroke="#f9a8d4" stroke-width="2" fill="none" opacity="0.7"/>`).join('')}`);
};

// Pulsed Plasmoid: a conical theta-pinch coil fires self-contained plasma
// rings (field-reversed plasmoids) out one after another.
ART['thr_ponderomotive_vasimr:secondary'] = () => {
  const bg = space('#0e1a2c', '#030509', '20%', '40%');
  const rings = [0, 1, 2, 3].map((i) => {
    const x = 170 + i * 36, r = 30 - i * 3;
    return `<ellipse cx="${x}" cy="144" rx="${f(r * 0.38)}" ry="${r}" fill="none" stroke="url(#ring)" stroke-width="${8 - i}" opacity="${f(1 - i * 0.2)}" filter="url(#glow)"/>`;
  }).join('');
  return svg(bg.defs + lin('ring', [[0, '#a5f3fc'], [0.5, '#ffffff'], [1, '#22d3ee']])
    + lin('cone', [[0, '#64748b'], [0.5, '#cbd5e1'], [1, '#475569']]),
  `${bg.body}${stars(40, 20)}
  <path d="M10,60 L150,110 L150,178 L10,228 Z" fill="url(#cone)"/>
  ${[...Array(8)].map((_, i) => { const x = 22 + i * 16, h = 84 - (x - 10) / 140 * 50 + 2; return `<line x1="${x}" y1="${f(144 - h)}" x2="${x}" y2="${f(144 + h)}" stroke="#b45309" stroke-width="5" stroke-linecap="round"/>`; }).join('')}
  <ellipse cx="150" cy="144" rx="10" ry="34" fill="#0b1220"/>
  ${rings}`);
};

// Pulsed Inductive: a flat spiral coil fires a current pulse; the induced
// current sheet of gas flashes off its face as a bright plasma pancake.
ART['thr_pulsed_inductive:primary'] = () => {
  const bg = space('#1c1426', '#050307');
  let d = '';
  for (let t = 0; t < 7 * Math.PI * 2; t += 0.12) {
    const r = 6 + t * 2.4;
    d += `${d ? 'L' : 'M'}${f(150 + Math.cos(t) * r)},${f(186 + Math.sin(t) * r * 0.3)}`;
  }
  return svg(bg.defs + lin('sheet', [[0, '#ffffff'], [0.5, '#fbcfe8', 0.8], [1, '#db2777', 0]])
    + lin('base', [[0, '#3f3f46'], [1, '#18181b']]),
  `${bg.body}${stars(35, 21)}
  <ellipse cx="150" cy="198" rx="128" ry="44" fill="url(#base)"/>
  <path d="${d}" fill="none" stroke="#e7a15a" stroke-width="3"/>
  <ellipse cx="150" cy="150" rx="122" ry="30" fill="url(#sheet)" filter="url(#glow)" opacity="0.9"/>
  <ellipse cx="150" cy="104" rx="104" ry="22" fill="url(#sheet)" opacity="0.45"/>
  ${[[40, 130, 60, 160], [250, 128, 236, 162], [90, 120, 104, 158], [206, 116, 192, 160]].map(([a, b, c, e]) => `<path d="M${a},${b} L${(a + c) / 2 + 6},${(b + e) / 2} L${c},${e}" stroke="#fdf2f8" stroke-width="1.6" fill="none" filter="url(#glow)"/>`).join('')}`);
};

// Dual-Stage 4-Grid: four grids in a row - the first pair extracts the ions,
// the second pair accelerates them - into a pencil-thin, very fast beam.
ART['thr_pulsed_inductive:secondary'] = () => {
  const bg = space('#081a24', '#020507', '20%', '50%');
  const grids = [0, 1, 2, 3].map((i) => {
    const x = 90 + i * 18;
    let holes = '';
    for (let y = 72; y <= 216; y += 9) holes += `<rect x="${x - 1.5}" y="${y}" width="3" height="4" fill="#020507"/>`;
    return `<rect x="${x - 4}" y="64" width="8" height="160" rx="2" fill="${i < 2 ? '#94a3b8' : '#fbbf24'}"/>${holes}`;
  }).join('');
  let ions = '';
  for (let i = 0; i < 40; i++) {
    const x = 160 + (i * 37) % 140, y = 144 + (((i * 53) % 30) - 15) * (1 - (x - 160) / 300);
    ions += `<line x1="${x}" y1="${f(y)}" x2="${x + 10}" y2="${f(y)}" stroke="#e0f2fe" stroke-width="1.4" opacity="0.8"/>`;
  }
  return svg(bg.defs + lin('beam', [[0, '#ffffff'], [0.3, '#5eead4', 0.85], [1, '#0d9488', 0]], 0, 0, 1, 0)
    + lin('src', [[0, '#1e293b'], [1, '#475569']], 0, 0, 1, 0),
  `${bg.body}${stars(40, 22)}
  <path d="M146,126 L300,132 L300,156 L146,162 Z" fill="url(#beam)" filter="url(#glow)"/>
  ${ions}
  <rect x="8" y="56" width="78" height="176" rx="10" fill="url(#src)"/>
  <rect x="22" y="80" width="50" height="128" rx="6" fill="#0f766e" opacity="0.5"/>
  ${grids}`);
};

// Re Solar Moth: two great parabolic mirror "wings" focus sunlight onto a
// rhenium heat-exchanger body, which heats hydrogen out of a small nozzle.
ART['thr_re_solar_moth:primary'] = () => {
  const bg = space('#2a1d0e', '#060403', '50%', '0%');
  return svg(bg.defs + lin('wing', [[0, '#fde68a'], [0.5, '#e5e7eb'], [1, '#9ca3af']])
    + rad('focus', [[0, '#ffffff'], [0.4, '#fdba74'], [1, '#ea580c', 0]])
    + lin('ex', [[0, '#fff7ed'], [1, '#fb923c', 0]]),
  `${bg.body}${stars(30, 23)}
  ${[30, 90, 150, 210, 270].map((x) => `<line x1="${x}" y1="0" x2="${f(150 + (x - 150) * 0.15)}" y2="150" stroke="#fde68a" stroke-width="1.2" opacity="0.35"/>`).join('')}
  <path d="M150,150 Q60,40 6,70 Q40,180 150,150 Z" fill="url(#wing)"/>
  <path d="M150,150 Q240,40 294,70 Q260,180 150,150 Z" fill="url(#wing)"/>
  <path d="M150,150 Q60,40 6,70 M150,150 Q240,40 294,70" stroke="#78716c" stroke-width="1.5" fill="none"/>
  ${[0.3, 0.55, 0.8].map((t) => `<path d="M150,150 Q${f(150 - 90 * t)},${f(150 - 110 * t)} ${f(150 - 144 * t)},${f(150 - 80 * t)}" stroke="#a8a29e" stroke-width="0.8" fill="none"/><path d="M150,150 Q${f(150 + 90 * t)},${f(150 - 110 * t)} ${f(150 + 144 * t)},${f(150 - 80 * t)}" stroke="#a8a29e" stroke-width="0.8" fill="none"/>`).join('')}
  ${plume(150, 200, 0, 90, 10, 40, 'url(#ex)', 0.8)}
  <path d="M140,140 L160,140 L164,196 L136,196 Z" fill="#57534e"/>
  <circle cx="150" cy="150" r="22" fill="url(#focus)" filter="url(#glow)"/>`);
};

// Colliding Beam H-B Fusion: two counter-rotating ion beams (hydrogen and
// boron) collide in a ring; the fusion flash sends helium nuclei out the
// magnetic nozzle.
ART['thr_re_solar_moth:secondary'] = () => {
  const bg = space('#170d2b', '#030208');
  return svg(bg.defs + rad('flash', [[0, '#ffffff'], [0.3, '#fef08a'], [0.7, '#f472b6', 0.5], [1, '#7c3aed', 0]])
    + lin('ex', [[0, '#fdf4ff'], [0.4, '#e879f9', 0.8], [1, '#a21caf', 0]]),
  `${bg.body}${stars(40, 24)}
  ${plume(150, 190, 0, 100, 30, 90, 'url(#ex)', 0.85)}
  <ellipse cx="150" cy="120" rx="124" ry="62" fill="none" stroke="#334155" stroke-width="18"/>
  <ellipse cx="150" cy="120" rx="124" ry="62" fill="none" stroke="#38bdf8" stroke-width="3" stroke-dasharray="40 14" filter="url(#glow)"/>
  <ellipse cx="150" cy="120" rx="112" ry="54" fill="none" stroke="#f472b6" stroke-width="3" stroke-dasharray="30 18" stroke-dashoffset="20" filter="url(#glow)"/>
  <circle cx="150" cy="120" r="46" fill="url(#flash)"/>
  ${[0, 1, 2, 3, 4, 5].map((i) => `<circle cx="${f(150 + Math.sin(i * 1.1) * 16)}" cy="${170 + i * 18}" r="3" fill="#fde68a" filter="url(#glow)"/>`).join('')}
  ${[-1, 1].map((s) => `<path d="M${150 + s * 40},176 Q${150 + s * 60},230 ${150 + s * 120},288" stroke="#c4b5fd" stroke-width="1.5" fill="none" stroke-dasharray="6 5"/>`).join('')}`);
};

export const DOWN = 'translate(18 4) rotate(-48 150 144) translate(150 144) scale(0.6) translate(-150 -144)';
export const RIGHT = 'translate(118 44) rotate(16) scale(0.62)';
export const RIG = {
  'thr_ablative_plate:primary': { mount: [206, 96], back: -40, kind: 'crewed', s: 0.8, comp: 'translate(-18 4) scale(0.8)' },
  'thr_ablative_plate:secondary': { mount: [0, 144], back: -90, kind: 'tug', s: 1.2, comp: 'translate(120 70) rotate(18) scale(0.55)' },
  'thr_de_laval_nozzle:primary': { mount: [150, 10], back: 0, kind: 'tug', s: 1.1, comp: DOWN },
  'thr_de_laval_nozzle:secondary': { mount: [150, 34], back: 0, kind: 'crewed', s: 1.1, comp: DOWN },
  'thr_dumbo:primary': { mount: [150, 18], back: 0, kind: 'tug', s: 1.1, comp: DOWN },
  'thr_dumbo:secondary': { mount: [150, 26], back: 0, kind: 'freighter', s: 1.1, comp: DOWN },
  'thr_hall_effect:secondary': { mount: [8, 144], back: -90, kind: 'probe', s: 1.2, comp: RIGHT },
  'thr_mass_driver:primary': { mount: [66, 226], back: -127, kind: 'freighter', s: 0.6, comp: 'translate(6 -42)' },
  'thr_mass_driver:secondary': { mount: [30, 144], back: -90, kind: 'crewed', s: 1.2, comp: RIGHT },
  'thr_metastable_helium:primary': { mount: [150, 38], back: 0, kind: 'crewed', s: 1.1, comp: DOWN },
  'thr_metastable_helium:secondary': { mount: [150, 20], back: 0, kind: 'crewed', s: 1.2, comp: DOWN },
  'thr_monoatomic_plug_nozzle:primary': { mount: [150, 30], back: 0, kind: 'tug', s: 1.1, comp: DOWN },
  'thr_monoatomic_plug_nozzle:secondary': { mount: [150, 20], back: 0, kind: 'freighter', s: 1.1, comp: DOWN },
  'thr_photon_heliogyro:primary': { mount: [150, 150], back: -140, kind: 'probe', s: 0.6, front: true },
  'thr_photon_heliogyro:secondary': { mount: [150, 156], back: -150, kind: 'probe', s: 0.6, front: true },
  'thr_photon_kite_sail:primary': { mount: [150, 252], back: 180, kind: 'probe', s: 0.45, front: true },
  'thr_photon_kite_sail:secondary': { mount: [242, 144], back: 90, kind: 'probe', s: 0.45, front: true },
  'thr_ponderomotive_vasimr:primary': { mount: [16, 144], back: -90, kind: 'crewed', s: 1.2, comp: RIGHT },
  'thr_ponderomotive_vasimr:secondary': { mount: [10, 144], back: -90, kind: 'tug', s: 1.2, comp: RIGHT },
  'thr_pulsed_inductive:primary': { mount: [150, 242], back: 180, kind: 'tug', s: 1.0, comp: 'translate(150 144) rotate(128) scale(0.58) translate(-150 -144) translate(-10 30)' },
  'thr_pulsed_inductive:secondary': { mount: [8, 144], back: -90, kind: 'probe', s: 1.2, comp: RIGHT },
  'thr_re_solar_moth:primary': { mount: [150, 140], back: 0, kind: 'probe', s: 0.7, comp: 'translate(0 40) scale(0.9) translate(16 0)' },
  'thr_re_solar_moth:secondary': { mount: [150, 58], back: 0, kind: 'crewed', s: 1.0, comp: DOWN },
};

