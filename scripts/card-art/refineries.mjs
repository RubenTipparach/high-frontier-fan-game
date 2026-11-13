// Refinery deck art: 12 cards x 2 faces. A refinery is an ore-processing
// plant (HF4 rules B1: "ore purifiers"), so each face shows ITS process at
// work, drawn from what the process physically uses: furnaces and melts, gas
// chemistry (tanks and pipes, little glow), liquid baths and wells, light-
// driven processes, and the mobile / orbital ones. Plants stand on the
// asteroid's surface (ground in the card's spectral colour) in the open lower
// half of the card body; the rules note factories need no radiators because
// the night side does the cooling. See docs/card-art-guide.md.
import { PATENTS_BY_ID } from '../../data/patents.js';
import { H, W, f, lin, rad, space, stars, svg, ground, spectral, seeded, hcyl, ribs, finPanel, beam, irBeam } from './kit.mjs';

export const ART = {};
export const RIG = {};

const G = 232;   // ground line for surface plants

// A surface scene: night sky, starfield, the site's ground.
function site(card, face, seed, bg, y = G) {
  const b = space(bg[0], bg[1], '50%', '15%');
  return { defs: b.defs, base: `${b.body}${stars(55, seed)}${ground(spectral(card, face), seed, y)}` };
}
// A vertical tank / column standing on the ground: x centre, top y, width, fill.
function tank(x, top, w, fill, bottom = G + 4) {
  return `<rect x="${x - w / 2}" y="${top}" width="${w}" height="${bottom - top}" rx="${f(w / 2.6)}" fill="${fill}" stroke="#1f2430" stroke-width="1.2"/>`;
}
function pipe(d, color = '#9aa3b2', w = 3) {
  return `<path d="${d}" stroke="${color}" stroke-width="${w}" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`;
}
function valve(x, y, color = '#ef4444') {
  return `<path d="M${x - 4},${y - 4} L${x + 4},${y + 4} L${x + 4},${y - 4} L${x - 4},${y + 4} Z" fill="${color}"/>`;
}
function bubbles(x, y, w, h, n, seed, color = '#e0f2fe') {
  const rnd = seeded(seed);
  let out = '';
  for (let i = 0; i < n; i++) out += `<circle cx="${f(x + rnd() * w)}" cy="${f(y + rnd() * h)}" r="${f(1 + rnd() * 2.2)}" fill="none" stroke="${color}" stroke-width="0.9" opacity="${f(0.5 + rnd() * 0.5)}"/>`;
  return out;
}
const STEEL = (id) => lin(id, [[0, '#4b5563'], [0.45, '#d1d5db'], [1, '#374151']], 0, 0, 1, 0);

// ---- 1. Atomic Layer Deposition / Ilmenite Semiconductor Film --------------

// ALD: a squat vacuum reactor, cut away to show its stack of wafers; two gas
// lines pulse in turn, and the inset shows the film growing one atomic layer
// at a time.
ART['ref_atomic_layer_deposition:primary'] = () => {
  const s = site('ref_atomic_layer_deposition', 'primary', 101, ['#1d1a2c', '#05040a']);
  const wafers = [0, 1, 2, 3, 4, 5].map((i) => `<ellipse cx="128" cy="${168 + i * 9}" rx="30" ry="4" fill="#94a3b8" stroke="#e2e8f0" stroke-width="0.8"/>`).join('');
  const layers = [...Array(8)].map((_, i) => `<rect x="212" y="${132 + i * 5}" width="58" height="4" fill="${i % 2 ? '#38bdf8' : '#f59e0b'}"/>`).join('');
  return svg(s.defs + STEEL('aldS'), `${s.base}
    <rect x="82" y="150" width="92" height="84" rx="10" fill="url(#aldS)"/>
    <rect x="96" y="160" width="64" height="64" rx="6" fill="#0f172a"/>${wafers}
    <rect x="76" y="140" width="104" height="14" rx="6" fill="#9ca3af" stroke="#e5e7eb" stroke-width="1"/>
    ${pipe('M20,172 L60,172 L60,156 L84,156', '#38bdf8', 4)}${valve(44, 172, '#38bdf8')}
    ${pipe('M20,206 L66,206 L66,196 L84,196', '#f59e0b', 4)}${valve(44, 206, '#f59e0b')}
    <circle cx="241" cy="150" r="36" fill="#0b1020" stroke="#e2e8f0" stroke-width="1.5"/>
    <g clip-path="url(#aldC)">${layers}</g><defs><clipPath id="aldC"><circle cx="241" cy="150" r="34"/></clipPath></defs>
    <line x1="176" y1="186" x2="208" y2="170" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="3 3"/>`);
};

// Ilmenite Semiconductor Film: a low tracked paver melting regolith into glass
// and evaporating silicon onto it, laying a glossy belt of solar cell that
// runs off over the horizon; the belt beams its power up.
ART['ref_atomic_layer_deposition:secondary'] = () => {
  const s = site('ref_atomic_layer_deposition', 'secondary', 102, ['#0e1530', '#03040a'], 214);
  let grid = '';
  for (let i = 0; i < 12; i++) grid += `<line x1="${f(10 + i * 18)}" y1="${f(234 - i * 1.6)}" x2="${f(14 + i * 18)}" y2="${f(258 - i * 1.6)}" stroke="#60a5fa" stroke-width="0.8" opacity="0.7"/>`;
  return svg(s.defs + lin('cell', [[0, '#1e3a8a'], [1, '#0b1a44']]), `${s.base}
    <path d="M0,232 Q150,214 300,222 L300,240 Q150,232 0,262 Z" fill="url(#cell)" stroke="#93c5fd" stroke-width="1"/>
    ${grid}
    ${[0, 1, 2].map((i) => `<path d="M${120 + i * 30},${226 - i * 2} q-6,-10 0,-20 q6,-10 0,-20 q-6,-10 0,-20" stroke="#fde68a" stroke-width="1.4" fill="none" opacity="0.6"/>`).join('')}
    <g transform="translate(232 222)">
      <rect x="-30" y="-6" width="60" height="16" rx="8" fill="#22262e" stroke="#5b6475" stroke-width="2"/>
      <rect x="-28" y="-26" width="54" height="20" rx="3" fill="#cbd5e1" stroke="#64748b" stroke-width="1.5"/>
      <rect x="-40" y="-8" width="14" height="10" fill="#f97316" filter="url(#glow)"/>
      <rect x="-14" y="-34" width="22" height="8" fill="#1e3a8a"/>
    </g>`);
};

// ---- 2. Basalt Fiber Spinning / Von Neumann Santa Claus Machine ------------

// Basalt fiber: a hopper feeds crushed rock to a glowing furnace pot; hundreds
// of incandescent filaments fan down from the bushing, cooling to bronze, onto
// a fat winding drum.
ART['ref_basalt_fiber_spinning:primary'] = () => {
  const s = site('ref_basalt_fiber_spinning', 'primary', 103, ['#211810', '#060403']);
  let threads = '';
  for (let i = 0; i < 16; i++) threads += `<path d="M${118 + i * 2.4},178 Q${130 + i * 2},${200} ${196 + i * 1.6},${206 + (i % 4)}" stroke="url(#thr)" stroke-width="0.9" fill="none"/>`;
  return svg(s.defs + rad('pot', [[0, '#fff7d6'], [0.4, '#fb923c'], [1, '#7c2d12']]) + lin('thr', [[0, '#fde68a'], [0.5, '#f97316'], [1, '#78350f']], 0, 0, 1, 0)
    + lin('drum', [[0, '#57534e'], [0.5, '#a8a29e'], [1, '#44403c']]), `${s.base}
    <path d="M100,96 L160,96 L146,126 L114,126 Z" fill="#78716c" stroke="#44403c" stroke-width="1.5"/>
    <path d="M110,100 L150,100 L142,116 L118,116 Z" fill="#a8a29e"/>
    <rect x="104" y="128" width="52" height="44" rx="8" fill="#44403c" stroke="#a8a29e" stroke-width="1.5"/>
    <rect x="110" y="134" width="40" height="32" rx="6" fill="url(#pot)" filter="url(#glow)"/>
    <rect x="114" y="172" width="34" height="6" fill="#d6d3d1"/>
    ${threads}
    <path d="M110,234 L120,170 L140,170 L150,234" stroke="#57534e" stroke-width="3" fill="none"/>
    <ellipse cx="216" cy="210" rx="24" ry="24" fill="url(#drum)"/>
    <ellipse cx="216" cy="210" rx="17" ry="17" fill="#92400e"/>
    ${[0, 1, 2, 3].map((i) => `<ellipse cx="216" cy="210" rx="${17 - i * 3}" ry="${17 - i * 3}" fill="none" stroke="#b45309" stroke-width="1"/>`).join('')}
    <path d="M200,234 L216,210 L232,234" stroke="#57534e" stroke-width="4" fill="none"/>`);
};

// Von Neumann Santa Claus Machine: rock in, plasma, and a giant magnet that
// sorts the ion beam into a rainbow of elements, each into its own bin; at the
// end a smaller copy of the machine is being built.
ART['ref_basalt_fiber_spinning:secondary'] = () => {
  const s = site('ref_basalt_fiber_spinning', 'secondary', 104, ['#16112a', '#040208']);
  const cols = ['#ef4444', '#f97316', '#facc15', '#4ade80', '#38bdf8', '#a78bfa'];
  const fan = cols.map((c, i) => `<path d="M124,170 Q${170 + i * 6},${160 - i * 4} ${168 + i * 20},${206}" stroke="${c}" stroke-width="3" fill="none" opacity="0.9" filter="url(#glow)"/>`).join('');
  const bins = cols.map((c, i) => `<rect x="${158 + i * 20}" y="206" width="16" height="26" fill="#334155" stroke="${c}" stroke-width="1.5"/><rect x="${160 + i * 20}" y="${216 - (i % 3) * 3}" width="12" height="${14 + (i % 3) * 3}" fill="${c}" opacity="0.7"/>`).join('');
  return svg(s.defs + rad('plas', [[0, '#ffffff'], [0.5, '#f0abfc'], [1, '#7e22ce']]), `${s.base}
    <path d="M14,150 L54,150 L46,176 L22,176 Z" fill="#78716c" stroke="#44403c" stroke-width="1.5"/>
    ${pipe('M34,176 L34,196 L66,196', '#78716c', 6)}
    <rect x="62" y="174" width="40" height="44" rx="8" fill="#334155" stroke="#94a3b8" stroke-width="1.5"/>
    <circle cx="82" cy="196" r="14" fill="url(#plas)" filter="url(#glow)"/>
    <path d="M100,150 L148,150 L148,162 L114,162 L114,184 L148,184 L148,196 L100,196 Z" fill="#1d4ed8" stroke="#93c5fd" stroke-width="1.5"/>
    ${pipe('M102,190 L124,170', '#f0abfc', 2)}
    ${fan}${bins}
    <g opacity="0.75" stroke="#94a3b8" stroke-width="1" fill="none" stroke-dasharray="3 2"><rect x="262" y="214" width="22" height="18"/><path d="M262,214 L273,202 L284,214"/></g>
    <rect x="262" y="222" width="22" height="10" fill="#475569" opacity="0.8"/>`);
};

// ---- 3. CVD Molding / Carbonyl Volatilization ------------------------------

// CVD Molding: a bell jar of nickel carbonyl gas, heater coils around a hollow
// mold, and a seamless mirror-bright nickel shell (a rocket nozzle) growing on it.
ART['ref_cvd_molding:primary'] = () => {
  const s = site('ref_cvd_molding', 'primary', 105, ['#151a24', '#040507']);
  const rnd = seeded(105);
  let wisps = '';
  for (let i = 0; i < 6; i++) wisps += `<path d="M${f(104 + rnd() * 90)},${f(150 + rnd() * 60)} q8,-6 16,0 q8,6 16,0" stroke="#cbd5e1" stroke-width="1" fill="none" opacity="0.45"/>`;
  return svg(s.defs + lin('nick', [[0, '#6b7280'], [0.35, '#f8fafc'], [0.6, '#9ca3af'], [1, '#e5e7eb']], 0, 0, 1, 0), `${s.base}
    <path d="M96,232 L96,154 Q96,108 150,108 Q204,108 204,154 L204,232 Z" fill="#bfdbfe" opacity="0.14" stroke="#e0f2fe" stroke-width="2"/>
    <path d="M104,124 Q150,104 196,124" stroke="#ffffff" stroke-width="2" fill="none" opacity="0.4"/>
    <rect x="84" y="228" width="132" height="10" rx="3" fill="#64748b"/>
    ${wisps}
    <path d="M134,136 L166,136 L164,160 Q176,196 190,224 L110,224 Q124,196 136,160 Z" fill="url(#nick)" stroke="#475569" stroke-width="1"/>
    ${[150, 172, 194].map((y) => `<ellipse cx="150" cy="${y}" rx="${f(26 + (y - 150) * 0.5)}" ry="4" fill="none" stroke="#f97316" stroke-width="1.6" opacity="0.8"/>`).join('')}
    ${pipe('M216,190 L250,190 L250,150', '#94a3b8', 4)}<circle cx="250" cy="140" r="12" fill="#475569" stroke="#cbd5e1"/>`);
};

// Carbonyl Volatilization: the cool route for metal - a rotating kiln on the
// iron-nickel rock, a loop of carbon monoxide piping, and a decomposer tower
// dropping pellets of pure nickel and iron. Tanks and pipes, no glow.
ART['ref_cvd_molding:secondary'] = () => {
  const s = site('ref_cvd_molding', 'secondary', 106, ['#141820', '#040506']);
  const rnd = seeded(106);
  let pellets = '';
  for (let i = 0; i < 30; i++) pellets += `<circle cx="${f(228 + (rnd() - 0.5) * 44 * rnd())}" cy="${f(232 - rnd() * 14 * rnd())}" r="2.6" fill="url(#pel)"/>`;
  return svg(s.defs + STEEL('kiln') + rad('pel', [[0, '#ffffff'], [0.6, '#cbd5e1'], [1, '#64748b']], '35%', '35%'), `${s.base}
    <g transform="rotate(-10 90 196)">${hcyl(20, 196, 130, 20, 'url(#kiln)')}${ribs(20, 196, 130, 20, 5, '#374151', 3)}</g>
    ${[44, 120].map((x) => `<path d="M${x - 10},234 L${x},214 L${x + 10},234" fill="#475569"/>`).join('')}
    ${tank(228, 132, 30, 'url(#kiln)', 210)}
    <path d="M216,210 L240,210 L232,222 L224,222 Z" fill="#475569"/>
    ${pipe('M150,176 Q190,140 213,148', '#d1d5db', 4)}${pipe('M243,160 Q276,190 260,236', '#d1d5db', 3)}
    <rect x="172" y="146" width="18" height="10" rx="2" fill="#e5e7eb" stroke="#64748b"/>
    ${pellets}`);
};

// ---- 4. Carbo-Chlorination / Solar Carbotherm ------------------------------

// Carbo-Chlorination: a chlorinator fed yellow-green chlorine, a row of
// distillation columns separating the chlorides, and an electrolysis cell
// casting silver ingots.
ART['ref_carbo_chlorination:primary'] = () => {
  const s = site('ref_carbo_chlorination', 'primary', 107, ['#1b1a24', '#050407']);
  return svg(s.defs + STEEL('cc'), `${s.base}
    ${tank(52, 168, 40, '#57534e')}<rect x="38" y="182" width="28" height="22" rx="4" fill="#f97316" opacity="0.6"/>
    ${pipe('M10,150 L52,150 L52,168', '#a3e635', 4)}${valve(30, 150, '#a3e635')}
    ${[106, 132, 158].map((x, i) => tank(x, 120 + i * 10, 16, 'url(#cc)')).join('')}
    ${[106, 132, 158].map((x, i) => [0, 1, 2, 3].map((k) => `<line x1="${x - 7}" y1="${134 + i * 10 + k * 18}" x2="${x + 7}" y2="${134 + i * 10 + k * 18}" stroke="#374151" stroke-width="1.5"/>`).join('')).join('')}
    ${pipe('M72,180 L96,180 M114,150 L124,150 M140,160 L150,160', '#a3e635', 3)}
    ${pipe('M166,190 L196,190 L196,200', '#cbd5e1', 3)}
    <rect x="186" y="200" width="56" height="32" rx="3" fill="#334155" stroke="#94a3b8" stroke-width="1.5"/>
    <rect x="190" y="206" width="48" height="16" fill="#38bdf8" opacity="0.4"/>
    <rect x="198" y="194" width="4" height="22" fill="#f59e0b"/><rect x="226" y="194" width="4" height="22" fill="#94a3b8"/>
    ${[0, 1, 2].map((i) => `<path d="M${250 + i * 12},230 l4,-8 l10,0 l-4,8 Z" fill="#e5e7eb" stroke="#94a3b8" stroke-width="0.8"/>`).join('')}`);
};

// Solar Carbotherm: a big concentrator throws a white-hot spot into a crucible
// of molten regolith, methane bubbling through the melt; gas lines lead to tanks.
ART['ref_carbo_chlorination:secondary'] = () => {
  const s = site('ref_carbo_chlorination', 'secondary', 108, ['#2a1e10', '#070503']);
  const rays = [118, 140, 162, 184].map((y) => `<line x1="40" y1="${y}" x2="150" y2="206" stroke="#fde68a" stroke-width="1.2" opacity="0.5"/>`).join('');
  return svg(s.defs + rad('melt', [[0, '#ffffff'], [0.4, '#fde047'], [0.75, '#f97316'], [1, '#7c2d12']]) + lin('mir', [[0, '#fef3c7'], [1, '#a8a29e']], 0, 0, 1, 0), `${s.base}
    <circle cx="300" cy="40" r="90" fill="#fde68a" opacity="0.2" filter="url(#soft)"/>
    ${[80, 104, 128].map((y) => `<line x1="300" y1="${y - 40}" x2="40" y2="${y + 40}" stroke="#fde68a" stroke-width="1" opacity="0.25"/>`).join('')}
    <path d="M28,104 Q66,150 28,200 L18,200 Q54,150 18,104 Z" fill="url(#mir)"/>
    <path d="M24,200 L24,234" stroke="#78716c" stroke-width="4"/>
    ${rays}
    <path d="M124,206 L176,206 L170,232 L130,232 Z" fill="#292524" stroke="#a8a29e" stroke-width="1.5"/>
    <ellipse cx="150" cy="207" rx="24" ry="6" fill="url(#melt)" filter="url(#glow)"/>
    <circle cx="150" cy="206" r="6" fill="#ffffff" filter="url(#glow)"/>
    ${pipe('M174,214 L214,214 L214,190', '#9aa3b2', 3)}
    ${tank(222, 170, 22, '#cbd5e1')}${tank(254, 178, 22, '#94a3b8')}`);
};

// ---- 5. Electroforming / Impact Mold Sinter --------------------------------

// Electroforming: a plating tank of blue-green electrolyte, bus bars across the
// top, cables from a rectifier, and a dark pattern slowly coating in copper.
ART['ref_electroforming:primary'] = () => {
  const s = site('ref_electroforming', 'primary', 109, ['#121a20', '#030506']);
  return svg(s.defs + lin('elec', [[0, '#5eead4', 0.75], [1, '#0f766e', 0.9]]), `${s.base}
    <rect x="80" y="160" width="140" height="74" rx="4" fill="#1f2937" stroke="#94a3b8" stroke-width="2"/>
    <rect x="84" y="170" width="132" height="60" fill="url(#elec)"/>
    <rect x="76" y="150" width="148" height="7" fill="#d97706"/><rect x="76" y="140" width="148" height="7" fill="#9ca3af"/>
    <rect x="96" y="147" width="10" height="70" fill="#b45309"/><rect x="194" y="147" width="10" height="70" fill="#b45309"/>
    <path d="M136,157 L136,176 L130,184 L130,214 L170,214 L170,184 L164,176 L164,157 Z" fill="#1c1917" stroke="#c2621f" stroke-width="3"/>
    ${bubbles(90, 176, 120, 50, 26, 109)}
    <rect x="18" y="182" width="40" height="50" rx="3" fill="#334155" stroke="#94a3b8" stroke-width="1.5"/>
    <rect x="24" y="190" width="28" height="10" fill="#0f172a"/><rect x="26" y="192" width="10" height="6" fill="#4ade80"/>
    ${pipe('M58,196 Q80,150 100,146', '#ef4444', 2.5)}${pipe('M58,210 Q140,110 198,146', '#111827', 2.5)}`);
};

// Impact Mold Sinter: a heavy die full of metal powder; a slug slams in with a
// white flash and a shock ring, and out comes a block of foamed metal.
ART['ref_electroforming:secondary'] = () => {
  const s = site('ref_electroforming', 'secondary', 110, ['#151821', '#040506']);
  const rnd = seeded(110);
  let pores = '';
  for (let i = 0; i < 26; i++) pores += `<circle cx="${f(214 + rnd() * 52)}" cy="${f(204 + rnd() * 24)}" r="${f(1 + rnd() * 2.5)}" fill="#475569"/>`;
  return svg(s.defs + STEEL('die'), `${s.base}
    <rect x="80" y="170" width="84" height="64" rx="3" fill="url(#die)" stroke="#1f2937" stroke-width="2"/>
    <rect x="108" y="170" width="28" height="44" fill="#1f2937"/>
    <rect x="110" y="190" width="24" height="22" fill="#9ca3af"/>${bubbles(110, 190, 24, 22, 10, 111, '#e5e7eb')}
    <rect x="112" y="120" width="20" height="30" rx="3" fill="#cbd5e1" stroke="#64748b" stroke-width="1.5"/>
    <path d="M122,106 L122,118" stroke="#e5e7eb" stroke-width="2" stroke-dasharray="3 3"/>
    <ellipse cx="122" cy="168" rx="34" ry="8" fill="none" stroke="#e0f2fe" stroke-width="2.5" opacity="0.8" filter="url(#glow)"/>
    <circle cx="122" cy="166" r="12" fill="#ffffff" opacity="0.9" filter="url(#glow)"/>
    <rect x="212" y="200" width="56" height="32" rx="3" fill="#9ca3af" stroke="#e5e7eb" stroke-width="1"/>${pores}`);
};

// ---- 6. Fluidized Bed / Atmospheric Scoop ----------------------------------

// Fluidized Bed: a tall three-stage column, cut away to show the ilmenite bed
// churning like boiling liquid in the hot hydrogen blown up through it; steam
// leaves the top for the condenser.
ART['ref_fluidized_bed:primary'] = () => {
  const s = site('ref_fluidized_bed', 'primary', 111, ['#1a1a26', '#050408']);
  const rnd = seeded(111);
  let bed = '';
  for (const y0 of [196, 160, 124]) for (let i = 0; i < 34; i++) bed += `<circle cx="${f(122 + rnd() * 56)}" cy="${f(y0 + rnd() * 26)}" r="${f(1 + rnd() * 2)}" fill="${rnd() < 0.5 ? '#a8a29e' : '#d6b36a'}"/>`;
  return svg(s.defs + STEEL('fb'), `${s.base}
    <rect x="114" y="100" width="72" height="134" rx="12" fill="url(#fb)"/>
    <rect x="120" y="108" width="60" height="120" rx="8" fill="#1c1917"/>
    ${[148, 184].map((y) => `<rect x="118" y="${y}" width="64" height="4" fill="#6b7280"/>`).join('')}
    ${bed}${bubbles(122, 112, 56, 112, 24, 112, '#fde68a')}
    ${pipe('M60,226 L114,226', '#93c5fd', 4)}<text x="0" y="0" opacity="0"></text>
    ${pipe('M150,100 L150,84 L226,84 L226,150', '#e2e8f0', 4)}
    ${tank(226, 150, 28, '#94a3b8')}
    ${[0, 1, 2].map((i) => `<path d="M${150 + i * 26},80 q-5,-8 0,-16" stroke="#e0f2fe" stroke-width="1.5" fill="none" opacity="0.6"/>`).join('')}`);
};

// Atmospheric Scoop: a craft skims the top of a planet's glowing atmosphere,
// a thin membrane funnel scooping and liquefying the air into frosted tanks,
// its engine holding it against the drag.
ART['ref_fluidized_bed:secondary'] = () => {
  const b = space('#0c1430', '#020309', '50%', '100%');
  return svg(b.defs + rad('planet', [[0, '#3b82f6'], [0.7, '#1e3a8a'], [1, '#0b1640']], '50%', '0%', '90%')
    + lin('mem', [[0, '#e0f2fe', 0.5], [1, '#93c5fd', 0.15]], 0, 0, 1, 0)
    + lin('scp', [[0, '#ffffff'], [0.4, '#fb923c', 0.8], [1, '#fb923c', 0]], 0, 0, 1, 0), `${b.body}${stars(50, 112)}
    <ellipse cx="150" cy="430" rx="330" ry="210" fill="url(#planet)"/>
    <ellipse cx="150" cy="430" rx="336" ry="216" fill="none" stroke="#7dd3fc" stroke-width="8" opacity="0.35" filter="url(#soft)"/>
    <ellipse cx="150" cy="430" rx="333" ry="213" fill="none" stroke="#bae6fd" stroke-width="2" opacity="0.7"/>
    <g transform="translate(160 200) rotate(-8)">
      <path d="M30,-4 L160,-14 L160,6 L30,4 Z" fill="url(#scp)"/>
      <path d="M-90,-34 L-20,-8 L-20,8 L-90,34 Z" fill="url(#mem)" stroke="#e0f2fe" stroke-width="1"/>
      <path d="M-92,-34 Q-98,0 -92,34" stroke="#fdba74" stroke-width="4" fill="none" filter="url(#glow)"/>
      <rect x="-20" y="-9" width="50" height="18" rx="4" fill="#cbd5e1" stroke="#64748b" stroke-width="1.5"/>
      ${[-8, 6].map((x) => `<ellipse cx="${x}" cy="-16" rx="8" ry="6" fill="#f1f5f9" stroke="#e0f2fe" stroke-width="1"/>`).join('')}
    </g>`);
};

// ---- 7. Foamglass Sintering / Laser-Heated Pedestal Growth -----------------

// Foamglass: a tunnel kiln with a belt of slabs swelling and glowing as they
// foam, and a stack of finished bubbly black blocks, honeycomb on the cut face.
ART['ref_foamglass_sintering:primary'] = () => {
  const s = site('ref_foamglass_sintering', 'primary', 113, ['#1c1414', '#050303']);
  const rnd = seeded(113);
  const block = (x, y) => {
    let p = '';
    for (let i = 0; i < 10; i++) p += `<circle cx="${f(x + 3 + rnd() * 26)}" cy="${f(y + 3 + rnd() * 14)}" r="${f(1.2 + rnd() * 2)}" fill="#3f3f46" stroke="#52525b" stroke-width="0.6"/>`;
    return `<rect x="${x}" y="${y}" width="32" height="20" fill="#18181b" stroke="#52525b" stroke-width="1"/>${p}`;
  };
  return svg(s.defs + lin('kil', [[0, '#57534e'], [1, '#292524']]), `${s.base}
    <rect x="10" y="196" width="170" height="8" fill="#44403c"/>
    <path d="M40,196 L40,156 Q90,128 140,156 L140,196 Z" fill="url(#kil)" stroke="#a8a29e" stroke-width="1.5"/>
    <path d="M56,196 L56,170 Q90,152 124,170 L124,196 Z" fill="#7c2d12"/>
    ${[60, 80, 100].map((x, i) => `<rect x="${x}" y="${188 - i * 4}" width="16" height="${8 + i * 4}" rx="3" fill="#fb923c" filter="url(#glow)"/>`).join('')}
    ${[14, 150].map((x) => `<rect x="${x}" y="190" width="20" height="6" rx="2" fill="#78716c"/>`).join('')}
    ${block(196, 210)}${block(230, 210)}${block(212, 190)}${block(246, 190)}${block(228, 170)}`);
};

// Laser-Heated Pedestal Growth: a ring of laser light, spread by a cone mirror,
// melts a bead on the tip of a source rod; a hair-thin crystal fibre is drawn
// up out of the melt onto a spool. No crucible.
ART['ref_foamglass_sintering:secondary'] = () => {
  const s = site('ref_foamglass_sintering', 'secondary', 114, ['#140f22', '#040208']);
  return svg(s.defs + lin('rod', [[0, '#a8a29e'], [0.5, '#e7e5e4'], [1, '#78716c']], 0, 0, 1, 0), `${s.base}
    <rect x="70" y="214" width="160" height="18" rx="3" fill="#334155" stroke="#94a3b8" stroke-width="1.2"/>
    <rect x="144" y="170" width="12" height="44" fill="url(#rod)"/>
    <path d="M110,186 L136,176 M190,186 L164,176" stroke="#cbd5e1" stroke-width="5"/>
    <path d="M102,190 L118,182 M198,190 L182,182" stroke="#64748b" stroke-width="3"/>
    ${[-1, 1].map((sd) => `<path d="M${150 + sd * 70},140 L${150 + sd * 40},180 L${150 + sd * 6},168" stroke="#ef4444" stroke-width="2" fill="none" filter="url(#glow)"/>`).join('')}
    <ellipse cx="150" cy="168" rx="8" ry="6" fill="#fde047" filter="url(#glow)"/><circle cx="150" cy="167" r="3" fill="#fff"/>
    <line x1="150" y1="162" x2="150" y2="104" stroke="#e0f2fe" stroke-width="1.4"/>
    <circle cx="150" cy="98" r="10" fill="#475569" stroke="#cbd5e1" stroke-width="2"/><circle cx="150" cy="98" r="3" fill="#cbd5e1"/>
    <rect x="66" y="132" width="20" height="14" rx="2" fill="#1f2937" stroke="#ef4444" stroke-width="1"/><rect x="214" y="132" width="20" height="14" rx="2" fill="#1f2937" stroke="#ef4444" stroke-width="1"/>`);
};

// ---- 8. Froth Flotation / Femtochemistry ----------------------------------

// Froth Flotation: aerated tanks of crushed ore in water; the mineral grains
// ride the bubbles up into a heaping dark froth that spills over the lip and is
// skimmed off by paddles. In low gravity the cell spins.
ART['ref_froth_flotation:primary'] = () => {
  const s = site('ref_froth_flotation', 'primary', 115, ['#151a1c', '#040506']);
  const froth = (x, y, w, seed) => {
    const rnd = seeded(seed);
    let out = '';
    for (let i = 0; i < 26; i++) out += `<circle cx="${f(x + rnd() * w)}" cy="${f(y - rnd() * 14)}" r="${f(3 + rnd() * 4)}" fill="#3f3f46" stroke="#71717a" stroke-width="0.8"/>`;
    return out;
  };
  return svg(s.defs + lin('slur', [[0, '#57534e'], [1, '#292524']]), `${s.base}
    ${[60, 150].map((x, i) => `<rect x="${x - 36}" y="174" width="72" height="60" rx="4" fill="#475569" stroke="#94a3b8" stroke-width="1.5"/><rect x="${x - 32}" y="182" width="64" height="48" fill="url(#slur)"/>${bubbles(x - 30, 186, 60, 42, 14, 115 + i)}${froth(x - 34, 182, 68, 120 + i)}<line x1="${x}" y1="160" x2="${x}" y2="214" stroke="#cbd5e1" stroke-width="2"/><path d="M${x - 12},214 L${x + 12},214" stroke="#cbd5e1" stroke-width="3"/>`).join('')}
    <path d="M186,176 Q200,182 204,198 L214,234" stroke="#3f3f46" stroke-width="7" fill="none"/>
    ${froth(198, 230, 44, 130)}
    <g transform="translate(250 150)"><circle r="26" fill="none" stroke="#94a3b8" stroke-width="3"/>${[0, 60, 120].map((a) => `<line x1="${f(-24 * Math.cos(a * Math.PI / 180))}" y1="${f(-24 * Math.sin(a * Math.PI / 180))}" x2="${f(24 * Math.cos(a * Math.PI / 180))}" y2="${f(24 * Math.sin(a * Math.PI / 180))}" stroke="#94a3b8" stroke-width="2"/>`).join('')}<path d="M-30,-8 A32,32 0 0 1 -8,-30" stroke="#e0f2fe" stroke-width="1.5" fill="none"/></g>`);
};

// Femtochemistry: an optical bench where a mode-locked laser fires a train of
// femtosecond pulses into a gas cell, and one molecule is caught splitting.
ART['ref_froth_flotation:secondary'] = () => {
  const s = site('ref_froth_flotation', 'secondary', 116, ['#12122a', '#030308']);
  const pulses = [0, 1, 2, 3, 4, 5].map((i) => `<rect x="${104 + i * 14}" y="174" width="6" height="4" rx="2" fill="#f0abfc" filter="url(#glow)"/>`).join('');
  const atom = (x, y, r, c) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" stroke="#0f172a" stroke-width="1"/>`;
  return svg(s.defs, `${s.base}
    <rect x="20" y="200" width="260" height="14" rx="2" fill="#334155" stroke="#64748b" stroke-width="1"/>
    ${[...Array(12)].map((_, i) => `<circle cx="${32 + i * 21}" cy="207" r="1.6" fill="#1f2937"/>`).join('')}
    <rect x="30" y="160" width="66" height="36" rx="3" fill="#1e293b" stroke="#a78bfa" stroke-width="1.5"/><rect x="36" y="168" width="16" height="6" fill="#4ade80"/>
    <line x1="96" y1="176" x2="196" y2="176" stroke="#f0abfc" stroke-width="1" opacity="0.4"/>${pulses}
    <rect x="196" y="150" width="62" height="50" rx="6" fill="#a78bfa" opacity="0.14" stroke="#c4b5fd" stroke-width="1.5"/>
    <line x1="214" y1="176" x2="226" y2="170" stroke="#e2e8f0" stroke-width="2"/>
    ${atom(214, 176, 7, '#e2e8f0')}${atom(240, 164, 6, '#ef4444')}${atom(228, 170, 5, '#38bdf8')}
    <circle cx="234" cy="167" r="12" fill="#f0abfc" opacity="0.35" filter="url(#soft)"/>
    ${[0, 1, 2, 3, 4, 5].map((i) => `<line x1="234" y1="167" x2="${f(234 + Math.cos(i) * 18)}" y2="${f(167 + Math.sin(i) * 18)}" stroke="#fdf4ff" stroke-width="1" opacity="0.7"/>`).join('')}`);
};

// ---- 9. ISRU Sabatier / Biophytolytic Algal Farm ---------------------------

// ISRU Sabatier: carbon dioxide and hydrogen over a hot nickel catalyst in a
// finned reactor tube, a condenser, and tanks of methane and water out.
ART['ref_isru_sabatier:primary'] = () => {
  const s = site('ref_isru_sabatier', 'primary', 117, ['#2a1814', '#070403']);
  const fins = [...Array(10)].map((_, i) => `<rect x="${90 + i * 10}" y="166" width="3" height="32" fill="#9ca3af"/>`).join('');
  return svg(s.defs + STEEL('sab'), `${s.base}
    ${pipe('M14,174 L84,174', '#a8a29e', 4)}${pipe('M14,190 L84,190', '#93c5fd', 4)}${valve(40, 174, '#a8a29e')}${valve(40, 190, '#93c5fd')}
    ${fins}
    <rect x="84" y="170" width="110" height="24" rx="10" fill="url(#sab)"/>
    <rect x="96" y="176" width="86" height="12" rx="5" fill="#f97316" opacity="0.5"/>
    ${pipe('M194,182 L212,182 L212,160', '#cbd5e1', 4)}
    ${tank(212, 132, 16, '#64748b', 168)}${[0, 1, 2].map((i) => `<line x1="205" y1="${140 + i * 8}" x2="219" y2="${140 + i * 8}" stroke="#cbd5e1" stroke-width="1"/>`).join('')}
    ${pipe('M220,150 L246,150 L246,170 M212,168 L212,200 L270,200 L270,190', '#cbd5e1', 3)}
    ${tank(246, 170, 22, '#fde68a')}${tank(276, 180, 18, '#7dd3fc')}`);
};

// Biophytolytic Algal Farm: flat translucent photobioreactor panels of vivid
// green algae splitting water with light into hydrogen, on a dark icy comet
// nucleus, green growth spreading over the black crust.
ART['ref_isru_sabatier:secondary'] = () => {
  const s = site('ref_isru_sabatier', 'secondary', 118, ['#0e1a12', '#020503']);
  const panel = (x, y, h) => `<g transform="skewX(-12)"><rect x="${x}" y="${y}" width="34" height="${h}" rx="2" fill="#22c55e" opacity="0.55" stroke="#bbf7d0" stroke-width="1.2"/>${bubbles(x + 3, y + 4, 28, h - 8, 10, x, '#f0fdf4')}</g>`;
  const rnd = seeded(118);
  let moss = '';
  for (let i = 0; i < 40; i++) moss += `<circle cx="${f(20 + rnd() * 260)}" cy="${f(236 + rnd() * 40)}" r="${f(1.5 + rnd() * 4)}" fill="#16a34a" opacity="${f(0.4 + rnd() * 0.5)}"/>`;
  return svg(s.defs, `${s.base}${moss}
    ${panel(110, 168, 64)}${panel(156, 160, 72)}${panel(202, 168, 64)}${panel(248, 176, 56)}
    ${pipe('M60,226 L120,226', '#bbf7d0', 3)}${tank(50, 196, 22, '#e2e8f0')}
    <path d="M40,190 q-6,-10 0,-20" stroke="#e0f2fe" stroke-width="1.5" fill="none" opacity="0.6"/>`);
};

// ---- 10. In-Situ Leaching / Termite Nest ----------------------------------

// In-Situ Leaching: a grid of wellheads on the surface, and a cut-away of the
// ore body below with the leach solution flowing from injector to producer.
ART['ref_in_situ_leaching:primary'] = () => {
  const b = space('#191420', '#050407', '50%', '15%');
  const pal = spectral('ref_in_situ_leaching', 'primary');
  const wells = [56, 120, 184, 248];
  return svg(b.defs + lin('cutg', [[0, pal[1]], [1, pal[2]]]), `${b.body}${stars(50, 119)}
    <rect x="0" y="176" width="${W}" height="${H}" fill="url(#cutg)"/>
    <path d="M0,176 Q150,168 300,176" stroke="${pal[0]}" stroke-width="2" fill="none"/>
    <path d="M0,232 Q150,220 300,236 L300,260 Q150,246 0,256 Z" fill="#a16207" opacity="0.5"/>
    ${wells.map((x, i) => `<line x1="${x}" y1="164" x2="${x}" y2="244" stroke="#9ca3af" stroke-width="3"/><rect x="${x - 7}" y="152" width="14" height="14" rx="2" fill="#64748b" stroke="#cbd5e1" stroke-width="1"/>${valve(x, 146, i % 2 ? '#22c55e' : '#38bdf8')}`).join('')}
    ${[0, 1, 2].map((i) => `<path d="M${wells[i] + 4},242 Q${wells[i] + 32},${250 + (i % 2) * 6} ${wells[i + 1] - 4},242" stroke="${i % 2 ? '#4ade80' : '#38bdf8'}" stroke-width="3" fill="none" opacity="0.85" stroke-dasharray="6 4"/>`).join('')}
    ${tank(30, 150, 16, '#38bdf8', 178)}`);
};

// Termite Nest: a ventilated spire of fused regolith riddled with tunnels,
// small beetle-like robots streaming in and out, a glint of ore at the top.
ART['ref_in_situ_leaching:secondary'] = () => {
  const s = site('ref_in_situ_leaching', 'secondary', 120, ['#1d1610', '#050403']);
  const pal = spectral('ref_in_situ_leaching', 'secondary');
  const bot = (x, y, r) => `<g transform="translate(${x} ${y}) rotate(${r})"><ellipse rx="5" ry="3.4" fill="#94a3b8"/><path d="M-3,-3 L-5,-6 M0,-3 L0,-6 M3,-3 L5,-6 M-3,3 L-5,6 M0,3 L0,6 M3,3 L5,6" stroke="#cbd5e1" stroke-width="0.8"/><circle cx="4" cy="0" r="1" fill="#5eead4"/></g>`;
  return svg(s.defs + lin('mound', [[0, pal[0]], [1, pal[2]]]), `${s.base}
    <path d="M100,236 Q112,190 128,150 Q140,104 150,90 Q162,104 172,150 Q188,190 200,236 Z" fill="url(#mound)" stroke="${pal[2]}" stroke-width="1.5"/>
    <path d="M140,236 Q146,170 150,96" stroke="${pal[2]}" stroke-width="1" fill="none" opacity="0.6"/>
    ${[[136, 150], [160, 136], [146, 184], [166, 196], [130, 210]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="5" ry="7" fill="#120a05"/>`).join('')}
    <circle cx="150" cy="92" r="5" fill="#fde047" filter="url(#glow)"/>
    ${bot(196, 228, 0)}${bot(214, 232, 10)}${bot(236, 226, -10)}${bot(176, 216, -60)}${bot(118, 226, 180)}${bot(92, 232, 170)}${bot(166, 166, -100)}`);
};

// ---- 11. Magma Electrolysis / Ionosphere Lasing ---------------------------

// Magma Electrolysis: a ceramic-lined crucible of glowing molten regolith, an
// electrode dipped in it, oxygen bubbling off, a tap pouring molten metal, and
// heavy power cables.
ART['ref_magma_electrolysis:primary'] = () => {
  const s = site('ref_magma_electrolysis', 'primary', 121, ['#24120c', '#060302']);
  return svg(s.defs + rad('magma', [[0, '#fff7d6'], [0.35, '#fde047'], [0.7, '#f97316'], [1, '#9a3412']]), `${s.base}
    <path d="M90,166 L210,166 L196,232 L104,232 Z" fill="#78716c" stroke="#d6d3d1" stroke-width="2"/>
    <path d="M100,172 L200,172 L188,224 L112,224 Z" fill="#44403c"/>
    <ellipse cx="150" cy="176" rx="50" ry="9" fill="url(#magma)" filter="url(#glow)"/>
    <rect x="144" y="112" width="12" height="70" fill="#9ca3af" stroke="#e5e7eb" stroke-width="1"/>
    ${bubbles(120, 140, 60, 30, 14, 121, '#fde68a')}
    ${pipe('M150,112 Q150,92 110,92 L40,92', '#111827', 5)}${pipe('M196,190 Q240,190 250,140 L280,140', '#111827', 5)}
    <rect x="196" y="210" width="20" height="8" fill="#78716c"/>
    <path d="M214,214 Q232,218 236,236" stroke="#fb923c" stroke-width="5" fill="none" filter="url(#glow)"/>
    <ellipse cx="240" cy="236" rx="16" ry="4" fill="#fb923c" filter="url(#glow)"/>`);
};

// Ionosphere Lasing: the CO2 upper atmosphere of a world lases naturally in
// sunlight; orbiting ring-mirrors gather the glow into a beam sent off to a
// receiver.
ART['ref_magma_electrolysis:secondary'] = () => {
  const b = space('#140c20', '#030207', '50%', '100%');
  return svg(b.defs + rad('vn', [[0, '#f5d0a1'], [0.7, '#c2410c'], [1, '#431407']], '30%', '20%', '90%'), `${b.body}${stars(50, 122)}
    <circle cx="96" cy="300" r="150" fill="url(#vn)"/>
    <circle cx="96" cy="300" r="160" fill="none" stroke="#f87171" stroke-width="10" opacity="0.4" filter="url(#soft)"/>
    <circle cx="96" cy="300" r="156" fill="none" stroke="#fca5a5" stroke-width="2" opacity="0.8"/>
    ${[[176, 116], [226, 152]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="16" ry="5" fill="none" stroke="#e5e7eb" stroke-width="3" transform="rotate(-30 ${x} ${y})"/>`).join('')}
    <line x1="150" y1="150" x2="176" y2="118" stroke="#f87171" stroke-width="1.5" opacity="0.7"/><line x1="196" y1="176" x2="226" y2="154" stroke="#f87171" stroke-width="1.5" opacity="0.7"/>
    ${beam(230, 150, 300, 108, '#ef4444', 2.5)}`);
};

// ---- 12. Supercritical Drying / Solid Flame -------------------------------

// Supercritical Drying: a thick-walled bolted pressure vessel with its gauge,
// venting, and the result beside it - a block of aerogel, ghostly pale blue,
// so light it rests on a hair-thin stand.
ART['ref_supercritical_drying:primary'] = () => {
  const b = space('#0d1426', '#030409', '70%', '30%');
  return svg(b.defs + STEEL('pv2') + rad('gas', [[0, '#fde68a'], [0.6, '#d97706'], [1, '#78350f']], '40%', '40%'), `${b.body}${stars(50, 123)}
    <circle cx="270" cy="70" r="56" fill="url(#gas)"/><path d="M216,62 Q270,52 324,66 M218,80 Q270,72 322,84" stroke="#92400e" stroke-width="3" fill="none" opacity="0.6"/>
    <rect x="0" y="232" width="${W}" height="56" fill="#1f2937"/>${[...Array(10)].map((_, i) => `<line x1="${i * 32}" y1="232" x2="${i * 32 + 16}" y2="${H}" stroke="#374151" stroke-width="2"/>`).join('')}
    <rect x="60" y="140" width="72" height="92" rx="14" fill="url(#pv2)" stroke="#1f2937" stroke-width="2"/>
    <rect x="54" y="134" width="84" height="12" rx="3" fill="#6b7280"/>${[62, 78, 94, 110, 126].map((x) => `<circle cx="${x}" cy="140" r="2.4" fill="#d1d5db"/>`).join('')}
    <circle cx="146" cy="168" r="11" fill="#f8fafc" stroke="#475569" stroke-width="2"/><path d="M146,168 L152,162" stroke="#ef4444" stroke-width="1.6"/>
    ${pipe('M96,134 L96,116 L112,116', '#9ca3af', 4)}<path d="M116,112 q10,-8 20,-4 q10,4 20,-4" stroke="#e5e7eb" stroke-width="2" fill="none" opacity="0.6"/>
    <line x1="214" y1="232" x2="214" y2="206" stroke="#cbd5e1" stroke-width="1"/>
    <rect x="186" y="170" width="56" height="36" rx="3" fill="#bae6fd" opacity="0.32" stroke="#e0f2fe" stroke-width="1.2"/>
    <rect x="186" y="170" width="56" height="36" rx="3" fill="#7dd3fc" opacity="0.15" filter="url(#soft)"/>`);
};

// Solid Flame: self-propagating combustion synthesis - a pressed powder bar lit
// at one end; a thin white-hot front sweeps along it, grey powder ahead, dark
// fused ceramic behind, everything staying solid. No furnace.
ART['ref_supercritical_drying:secondary'] = () => {
  const b = space('#120d22', '#030208', '30%', '30%');
  return svg(b.defs + rad('gas2', [[0, '#c4b5fd'], [0.6, '#6d28d9'], [1, '#2e1065']], '40%', '40%') + lin('front', [[0, '#1c1917'], [0.55, '#292524'], [0.62, '#fb923c'], [0.66, '#ffffff'], [0.7, '#fde047'], [0.78, '#a8a29e'], [1, '#a8a29e']], 0, 0, 1, 0), `${b.body}${stars(50, 124)}
    <circle cx="40" cy="60" r="50" fill="url(#gas2)"/><path d="M-6,52 Q40,44 88,56 M-4,70 Q40,64 86,74" stroke="#4c1d95" stroke-width="3" fill="none" opacity="0.6"/>
    <rect x="0" y="232" width="${W}" height="56" fill="#1f2937"/>
    <rect x="60" y="214" width="200" height="8" rx="2" fill="#475569"/>
    <rect x="70" y="176" width="180" height="38" rx="4" fill="url(#front)"/>
    <rect x="70" y="176" width="180" height="38" rx="4" fill="none" stroke="#57534e" stroke-width="1.5"/>
    <rect x="182" y="172" width="8" height="46" fill="#fff7ed" opacity="0.7" filter="url(#glow)"/>
    <path d="M54,186 q4,-6 8,0 q4,6 8,0 q4,-6 8,0" stroke="#f97316" stroke-width="2" fill="none" filter="url(#glow)"/>
    ${[0, 1, 2, 3, 4, 5].map((i) => `<circle cx="${f(190 + Math.cos(i) * 12)}" cy="${f(194 + Math.sin(i) * 26)}" r="1.4" fill="#fde68a"/>`).join('')}`);
};

for (const id of Object.keys(PATENTS_BY_ID).filter((k) => PATENTS_BY_ID[k].type === 'refinery')) {
  for (const face of ['primary', 'secondary']) {
    if (!ART[`${id}:${face}`]) throw new Error(`refinery art missing: ${id}:${face}`);
  }
}
