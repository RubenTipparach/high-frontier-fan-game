// Crew deck art: each face is a FACTION and its launcher, so each face draws
// that launcher on (or leaving) its home pad. Real vehicles keep their real
// silhouettes (stage count, boosters, fairing, colours); no logos, flags or
// lettering. Both crew faces are cream, so there is no backdrop: the scene
// stands on the card with dark outlines. The canvas is the face below the
// name bar (300x440); the scene fills the lower part, rocket on the right so
// the privilege text (top) and thrust triangle (bottom centre) stay clear.
// See docs/card-art-guide.md.
import { CREW, PROMO_CREW } from '../../data/crew.js';
import { f, lin, rad, seeded } from './kit.mjs';

export const ART = {};
export const RIG = {};

const W = 300, H = 440, G = 412;   // G = ground line
const INK = '#1f2937';
function svg(defs, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
  ${lin('wht', [[0, '#94a3b8'], [0.35, '#ffffff'], [1, '#94a3b8']], 0, 0, 1, 0)}
  ${lin('ste', [[0, '#64748b'], [0.4, '#e2e8f0'], [0.7, '#cbd5e1'], [1, '#475569']], 0, 0, 1, 0)}
  ${lin('org', [[0, '#9a3412'], [0.4, '#fb923c'], [1, '#9a3412']], 0, 0, 1, 0)}
  ${lin('blk', [[0, '#111827'], [0.4, '#4b5563'], [1, '#111827']], 0, 0, 1, 0)}
  ${lin('flm', [[0, '#ffffff'], [0.25, '#fde68a'], [0.7, '#f97316', 0.8], [1, '#f97316', 0]])}
  ${defs}
</defs>
${body}
</svg>
`;
}
// A stage: a cylinder from y0 (top) to y1 at centre x, width w.
const stage = (x, y0, y1, w, fill = 'url(#wht)') => `<rect x="${f(x - w / 2)}" y="${y0}" width="${w}" height="${f(y1 - y0)}" fill="${fill}" stroke="${INK}" stroke-width="1.2"/>`;
const band = (x, y, w, h, c) => `<rect x="${f(x - w / 2)}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`;
// An ogive nose / fairing on top of a stage of width w at y.
const nose = (x, y, w, h, fill = 'url(#wht)') => `<path d="M${f(x - w / 2)},${y} Q${f(x - w / 2)},${f(y - h * 0.7)} ${x},${f(y - h)} Q${f(x + w / 2)},${f(y - h * 0.7)} ${f(x + w / 2)},${y} Z" fill="${fill}" stroke="${INK}" stroke-width="1.2"/>`;
// A payload fairing wider than the stage below (hammerhead).
const fairing = (x, y, w, h, wBelow, fill = 'url(#wht)') => `<path d="M${f(x - wBelow / 2)},${y} L${f(x - w / 2)},${f(y - 8)} L${f(x - w / 2)},${f(y - h * 0.55)} Q${f(x - w / 2)},${f(y - h)} ${x},${f(y - h)} Q${f(x + w / 2)},${f(y - h)} ${f(x + w / 2)},${f(y - h * 0.55)} L${f(x + w / 2)},${f(y - 8)} L${f(x + wBelow / 2)},${y} Z" fill="${fill}" stroke="${INK}" stroke-width="1.2"/>`;
const booster = (x, y0, y1, w, fill = 'url(#wht)') => `${stage(x, y0, y1, w, fill)}${nose(x, y0, w, w * 1.3, fill)}`;
const bells = (x, y, n, w) => [...Array(n)].map((_, i) => { const bx = x - ((n - 1) * w) / 2 + i * w; return `<path d="M${f(bx - w * 0.3)},${y} L${f(bx - w * 0.45)},${y + 8} L${f(bx + w * 0.45)},${y + 8} L${f(bx + w * 0.3)},${y} Z" fill="#475569" stroke="${INK}" stroke-width="0.8"/>`; }).join('');
// A launch escape tower + capsule on top at y (capsule base).
const capsuleLES = (x, y, w) => `<path d="M${f(x - w / 2)},${y} L${f(x - w * 0.22)},${f(y - w * 0.55)} L${f(x + w * 0.22)},${f(y - w * 0.55)} L${f(x + w / 2)},${y} Z" fill="url(#wht)" stroke="${INK}" stroke-width="1.2"/><line x1="${x}" y1="${f(y - w * 0.55)}" x2="${x}" y2="${f(y - w * 1.5)}" stroke="${INK}" stroke-width="2.2"/><path d="M${f(x - 3)},${f(y - w * 1.1)} L${f(x + 3)},${f(y - w * 1.1)} L${x},${f(y - w * 1.6)} Z" fill="#dc2626" stroke="${INK}" stroke-width="0.8"/>`;
// Liftoff: a flame under the engines and a billowing ground cloud.
function liftoff(x, y, w, seed, len = 60) {
  const rnd = seeded(seed);
  let cloud = '';
  for (let i = 0; i < 14; i++) cloud += `<circle cx="${f(x + (rnd() - 0.5) * 170)}" cy="${f(G - 4 - rnd() * 26)}" r="${f(10 + rnd() * 16)}" fill="#f1f5f9" stroke="#cbd5e1" stroke-width="1"/>`;
  return `<path d="M${f(x - w / 2)},${y} Q${x},${y + len * 1.2} ${f(x + w / 2)},${y} Z" fill="url(#flm)" filter="url(#glow)"/>${cloud}`;
}
// The pad: a ground strip, a flame trench and a launch tower beside the rocket.
function pad(x, color, { tower = true, th = 230, tx = -34, ground = '#a8a29e' } = {}) {
  const towerX = x + tx;
  let t = '';
  if (tower) {
    t = `<rect x="${towerX - 9}" y="${G - th}" width="18" height="${th}" fill="none" stroke="#475569" stroke-width="2"/>`;
    for (let y = G - th; y < G; y += 14) t += `<path d="M${towerX - 9},${y} L${towerX + 9},${y + 14} M${towerX + 9},${y} L${towerX - 9},${y + 14}" stroke="#64748b" stroke-width="1"/>`;
    t += [0.3, 0.55, 0.8].map((k) => `<line x1="${towerX + 9}" y1="${f(G - th * k)}" x2="${f(x - 6)}" y2="${f(G - th * k)}" stroke="#475569" stroke-width="2.4"/>`).join('');
  }
  return `<rect x="0" y="${G}" width="${W}" height="${H - G}" fill="${ground}"/><rect x="0" y="${G}" width="${W}" height="3" fill="${color}"/>
    <rect x="${x - 40}" y="${G - 6}" width="80" height="8" fill="#57534e" stroke="${INK}"/>${t}`;
}
// Small suited crew figures at the foot of the scene, in the faction colour.
function crew(x, color, n = 3) {
  return [...Array(n)].map((_, i) => { const cx = x + i * 13; return `<circle cx="${cx}" cy="${G - 20}" r="4.2" fill="#f8fafc" stroke="${INK}" stroke-width="1"/><rect x="${cx - 2.6}" y="${G - 22}" width="5.2" height="2.6" rx="1" fill="#0f172a"/><path d="M${cx - 5},${G - 2} L${cx - 4.5},${G - 15} Q${cx},${G - 18} ${cx + 4.5},${G - 15} L${cx + 5},${G - 2} Z" fill="${color}" stroke="${INK}" stroke-width="1"/>`; }).join('');
}
const C = Object.fromEntries([...CREW, ...PROMO_CREW].map((c) => [c.id, c.color]));

// ---- core crew (6 cards, 12 faces) --------------------------------------

// UN Cosmonauts - Liberty (ATK + Astrium, 2011-12): a five-segment Shuttle
// solid first stage (white, dark segment joints) with an Ariane 5 Vulcain 2
// core as the upper stage - and that upper stage (5.4 m) is WIDER than the
// solid below it (3.7 m), flaring out at the interstage: the stick's tell.
// A crew capsule and escape tower on top; lifting off in solid-rocket smoke.
ART['crew_un_b612:primary'] = () => svg('', `${pad(220, C.crew_un_b612)}
  ${stage(220, 150, 252, 26)}<path d="M207,252 L213,266 L227,266 L233,252 Z" fill="#94a3b8" stroke="${INK}" stroke-width="1.2"/>
  ${stage(220, 266, 392, 18)}${[290, 316, 342, 368].map((y) => band(220, y, 18, 3, INK)).join('')}
  <path d="M207,150 L211,138 L229,138 L233,150 Z" fill="url(#wht)" stroke="${INK}" stroke-width="1.2"/>${capsuleLES(220, 138, 18)}
  ${bells(220, 392, 1, 12)}${liftoff(220, 400, 16, 11)}${crew(36, C.crew_un_b612)}`);
// B612 Foundation - New Glenn on its pad at night: the big 7 m first stage
// with four aft fins, in an infrared false-colour glow - B612's Sentinel was
// an infrared asteroid hunter - with the telescope overhead and two faint
// asteroid streaks (the blink-comparator pair of its privilege).
ART['crew_un_b612:secondary'] = () => svg(rad('ir', [[0, '#f97316', 0.55], [1, '#7c2d12', 0]]), `<ellipse cx="222" cy="300" rx="90" ry="160" fill="url(#ir)"/>
  ${pad(222, C.crew_un_b612, { th: 270, tx: -46, ground: '#57534e' })}
  ${stage(222, 172, 392, 28)}${fairing(222, 172, 30, 54, 28)}${band(222, 300, 28, 3, INK)}
  ${[-1, 1].map((s2) => `<path d="M${222 + s2 * 14},360 l${s2 * 12},14 l0,18 l${-s2 * 12},0 Z" fill="#cbd5e1" stroke="${INK}"/>`).join('')}${bells(222, 392, 7, 4)}
  <g transform="translate(-60 120)"><rect x="236" y="96" width="20" height="44" rx="3" fill="#0f172a" stroke="${INK}" transform="rotate(-30 246 118)"/><rect x="214" y="110" width="20" height="10" fill="#1e3a8a" stroke="#93c5fd" transform="rotate(-30 246 118)"/><rect x="258" y="110" width="20" height="10" fill="#1e3a8a" stroke="#93c5fd" transform="rotate(-30 246 118)"/></g>
  ${[[60, 196], [86, 214]].map(([x, y]) => `<line x1="${x}" y1="${y}" x2="${x + 18}" y2="${y + 6}" stroke="#ea580c" stroke-width="2" stroke-linecap="round"/>`).join('')}`);

// Roscosmos - Angara A5: five IDENTICAL white URM-1 cylinders - a core plus
// four strap-ons of the SAME width, each strap-on capped by a plain conical
// nose - under a wider payload fairing, standing in the service tower at a
// snowbound Vostochny with bare birch trees.
ART['crew_roscosmos_taikonauts:primary'] = () => {
  const x = 222, d = 14;
  const cone = (cx, y) => `<path d="M${cx - d / 2},${y} L${cx},${y - 22} L${cx + d / 2},${y} Z" fill="url(#wht)" stroke="${INK}" stroke-width="1.2"/>`;
  const birch = (bx, h) => `<rect x="${bx}" y="${G - h}" width="4" height="${h}" fill="#f8fafc" stroke="${INK}" stroke-width="0.6"/>${[0.3, 0.55, 0.8].map((k) => `<rect x="${bx}" y="${f(G - h * k)}" width="4" height="2" fill="${INK}"/>`).join('')}${[[-12, 0.92], [12, 0.85], [-9, 0.7], [10, 0.62]].map(([dx, k]) => `<line x1="${bx + 2}" y1="${f(G - h * k)}" x2="${bx + 2 + dx}" y2="${f(G - h * k - 12)}" stroke="#57534e" stroke-width="1"/>`).join('')}`;
  return svg('', `${pad(x, C.crew_roscosmos_taikonauts, { ground: '#f1f5f9', th: 250, tx: -48 })}
    ${[20, 46, 74, 104].map((bx, i) => birch(bx, 60 + (i % 3) * 16)).join('')}
    ${[-d * 0.55, d * 0.55].map((o) => `${stage(x + o, 266, 392, d, 'url(#ste)')}${cone(x + o, 266)}`).join('')}
    ${[-d, d].map((o) => `${stage(x + o, 262, 392, d)}${cone(x + o, 262)}${band(x + o, 330, d, 2, '#64748b')}`).join('')}
    ${stage(x, 196, 392, d)}${band(x, 330, d, 2, '#64748b')}${stage(x, 172, 196, 10)}${fairing(x, 172, 22, 50, 10)}
    ${bells(x, 392, 5, 8)}${crew(30, C.crew_roscosmos_taikonauts, 2)}`);
};
// Taikonauts - Long March 9 (current design, since 2021): no boosters - one
// fat 10.6 m white core over a broad cluster of methane engines, at the
// Wenchang coastal pad among coconut palms; crew in red-trimmed white suits.
ART['crew_roscosmos_taikonauts:secondary'] = () => svg('', `${pad(222, C.crew_roscosmos_taikonauts, { th: 260, tx: -48 })}
  ${stage(222, 176, 392, 36)}${fairing(222, 176, 34, 56, 36)}${[236, 300, 350].map((y) => band(222, y, 36, 4, '#94a3b8')).join('')}${band(222, 270, 36, 3, '#dc2626')}
  ${bells(222, 392, 7, 5)}
  ${[24, 64].map((x) => `<line x1="${x}" y1="${G}" x2="${x + 6}" y2="${G - 54}" stroke="#78350f" stroke-width="3"/>${[-50, -20, 20, 50].map((a) => `<path d="M${x + 6},${G - 54} q${f(Math.sin(a * Math.PI / 180) * 18)},-6 ${f(Math.sin(a * Math.PI / 180) * 26)},6" stroke="#15803d" stroke-width="3" fill="none"/>`).join('')}`).join('')}
  ${crew(100, '#dc2626', 2)}`);

// NASA Astronauts - SLS Block II: the orange core stage between two white
// solid boosters, the crew capsule and escape tower up top; the big assembly
// building on the horizon, the crawler-transporter under the pad.
ART['crew_nasa_isro:primary'] = () => svg('', `${pad(222, C.crew_nasa_isro, { th: 280, tx: -46 })}
  <rect x="18" y="${G - 108}" width="78" height="108" fill="#cbd5e1" stroke="${INK}"/>${[0, 1, 2, 3].map((i) => `<rect x="${26 + i * 17}" y="${G - 100}" width="10" height="88" fill="#94a3b8"/>`).join('')}
  ${[-17, 17].map((d) => booster(222 + d, 230, 392, 12)).join('')}
  ${stage(222, 200, 392, 20, 'url(#org)')}${stage(222, 166, 200, 14)}${capsuleLES(222, 166, 18)}
  ${bells(222, 392, 4, 7)}
  <rect x="186" y="${G - 4}" width="72" height="6" fill="#64748b"/>${[0, 1, 2, 3].map((i) => `<rect x="${190 + i * 18}" y="${G - 1}" width="12" height="5" rx="1" fill="${INK}"/>`).join('')}`);
// ISRO Glavcosmonauts - GSLV Mk III: two huge solid boosters beside a
// slimmer liquid core, topped by a bulbous fairing wider than the core;
// the coastline launch range with a crew in faction colours.
ART['crew_nasa_isro:secondary'] = () => svg('', `${pad(222, C.crew_nasa_isro, { th: 240, tx: -44 })}
  ${[-19, 19].map((d) => `${booster(222 + d, 250, 392, 16)}${[290, 340].map((y) => band(222 + d, y, 16, 3, INK)).join('')}`).join('')}
  ${stage(222, 220, 392, 18)}${stage(222, 180, 220, 18)}${fairing(222, 180, 28, 54, 18)}
  ${bells(222, 392, 2, 9)}${crew(36, C.crew_nasa_isro)}
  <path d="M0,${G + 12} Q80,${G + 4} 150,${G + 14} T300,${G + 10} L300,${H} L0,${H} Z" fill="#0e7490" opacity="0.7"/>`);

// Anonymous P2P - Skylon: the single-stage spaceplane, white with its two
// wingtip engine nacelles and canards, climbing off a long runway.
ART['crew_anonp2p_esa:primary'] = () => svg('', `<rect x="0" y="${G}" width="${W}" height="${H - G}" fill="#78716c"/>${[0, 1, 2, 3, 4].map((i) => `<rect x="${10 + i * 60}" y="${G + 12}" width="30" height="3" fill="#f8fafc"/>`).join('')}
  <g transform="translate(206 300) rotate(-28)">
    <path d="M-90,0 Q-80,-9 -40,-10 L80,-10 Q100,-8 112,0 Q100,8 80,10 L-40,10 Q-80,9 -90,0 Z" fill="url(#wht)" stroke="${INK}" stroke-width="1.4"/>
    <path d="M-10,8 L30,40 L48,40 L40,8 Z" fill="#e2e8f0" stroke="${INK}" stroke-width="1.2"/>
    <rect x="18" y="34" width="40" height="10" rx="5" fill="url(#ste)" stroke="${INK}"/><path d="M-30,8 L-10,22 L0,22 L-10,8 Z" fill="#cbd5e1" stroke="${INK}"/>
    <path d="M70,-8 L84,-24 L92,-24 L84,-8 Z" fill="#cbd5e1" stroke="${INK}"/>
    <path d="M58,39 Q30,40 -10,46 Q30,50 58,47 Z" fill="url(#flm)" filter="url(#glow)"/>
  </g>${crew(30, C.crew_anonp2p_esa)}`);
// ESA Space Unionists - Ariane 64: a white core with four solid strap-ons and
// a tall fairing, rising out of the green coast of a tropical spaceport.
ART['crew_anonp2p_esa:secondary'] = () => svg('', `${pad(222, C.crew_anonp2p_esa, { tower: false, ground: '#166534' })}
  ${[-22, -11, 11, 22].map((d) => booster(222 + d, 296, 384, 10)).join('')}
  ${stage(222, 180, 384, 16)}${stage(222, 150, 180, 16)}${fairing(222, 150, 18, 46, 16)}
  ${bells(222, 384, 1, 12)}${liftoff(222, 392, 16, 61, 50)}
  ${[20, 50, 80, 110].map((x) => `<circle cx="${x}" cy="${G - 6}" r="16" fill="#15803d" stroke="${INK}" stroke-width="0.8"/>`).join('')}`);

// Shimizu Corp Entrepreneurs - a lander (no thruster): the Luna Ring idea, a
// belt of solar cells wrapped around the Moon's equator, under construction
// past a lunar base and a lander on its legs.
ART['crew_shimizu_nasrda:primary'] = () => svg(rad('moon', [[0, '#f1f5f9'], [1, '#94a3b8']], '40%', '30%'), `<path d="M0,${G - 30} Q150,${G - 70} 300,${G - 30} L300,${H} L0,${H} Z" fill="url(#moon)" stroke="${INK}"/>
  <path d="M0,${G - 20} Q150,${G - 58} 300,${G - 20}" stroke="#1e3a8a" stroke-width="10" fill="none"/>
  <path d="M0,${G - 20} Q150,${G - 58} 300,${G - 20}" stroke="#60a5fa" stroke-width="1" stroke-dasharray="4 3" fill="none"/>
  ${[40, 70, 230, 262].map((x) => `<circle cx="${x}" cy="${G - 4}" r="${x % 3 + 4}" fill="none" stroke="#64748b"/>`).join('')}
  <g transform="translate(210 ${G - 70})"><path d="M-18,0 L18,0 L12,-24 L-12,-24 Z" fill="url(#ste)" stroke="${INK}"/><path d="M-12,-24 L12,-24 L6,-34 L-6,-34 Z" fill="#fbbf24" stroke="${INK}"/>
    <line x1="-14" y1="0" x2="-26" y2="18" stroke="${INK}" stroke-width="2"/><line x1="14" y1="0" x2="26" y2="18" stroke="${INK}" stroke-width="2"/></g>
  <path d="M60,${G - 52} a24,14 0 0 1 48,0 Z" fill="#f8fafc" stroke="${INK}"/>${crew(122, C.crew_shimizu_nasrda, 2)}`);
// NASRDA Astronauts - Pegasus XL: the winged solid rocket just dropped from
// under its airliner carrier, igniting as it falls away.
ART['crew_shimizu_nasrda:secondary'] = () => svg('', `<rect x="0" y="${G}" width="${W}" height="${H - G}" fill="#a3a3a3"/>
  <g transform="translate(150 236) rotate(-4)">
    <path d="M-130,0 Q-120,-14 -80,-14 L100,-12 Q140,-10 148,0 Q140,10 100,12 L-80,12 Q-120,12 -130,0 Z" fill="url(#wht)" stroke="${INK}" stroke-width="1.4"/>
    <path d="M-10,8 L-60,46 L-30,46 L30,8 Z" fill="#e2e8f0" stroke="${INK}"/><path d="M-100,-8 L-122,-40 L-108,-40 L-84,-10 Z" fill="#e2e8f0" stroke="${INK}"/>
    ${[100, 112, 124].map((x) => `<rect x="${x - 112}" y="${-4}" width="6" height="4" fill="${INK}" transform="translate(${-100} 0)"/>`).join('')}
    <rect x="-46" y="32" width="18" height="10" rx="4" fill="#94a3b8" stroke="${INK}"/>
  </g>
  <g transform="translate(176 312) rotate(-8)">
    <path d="M-44,-6 L40,-6 Q52,-6 58,0 Q52,6 40,6 L-44,6 Z" fill="url(#blk)" stroke="${INK}"/><path d="M-4,6 L10,20 L18,6 Z" fill="#334155" stroke="${INK}"/><path d="M-40,-6 L-50,-16 L-42,-6 Z" fill="#334155"/>
    <path d="M-44,-5 Q-80,0 -44,5 Z" fill="url(#flm)" filter="url(#glow)"/>
  </g>`);

// SpaceX - Starship: the stainless super-heavy booster and ship stacked
// beside its tower, the two catch arms ("chopsticks") reaching for it, on a
// flat beach pad.
ART['crew_spacex_norse:primary'] = () => svg('', `${pad(220, C.crew_spacex_norse, { tower: false, ground: '#d6c7a1' })}
  <rect x="160" y="${G - 300}" width="22" height="300" fill="none" stroke="#475569" stroke-width="2.4"/>${[...Array(21)].map((_, i) => `<path d="M160,${G - 300 + i * 14} L182,${G - 286 + i * 14}" stroke="#64748b"/>`).join('')}
  <path d="M182,${G - 150} L206,${G - 156} M182,${G - 140} L206,${G - 134}" stroke="#334155" stroke-width="4"/>
  ${stage(220, 236, 392, 26, 'url(#ste)')}${stage(220, 126, 236, 26, 'url(#ste)')}${nose(220, 126, 26, 30, 'url(#ste)')}
  ${[-1, 1].map((s) => `<path d="M${220 + s * 13},140 l${s * 8},4 l0,16 l${-s * 8},0 Z" fill="#334155"/><path d="M${220 + s * 13},210 l${s * 10},6 l0,20 l${-s * 10},0 Z" fill="#334155"/><rect x="${s > 0 ? 233 : 201}" y="246" width="6" height="10" fill="#334155"/>`).join('')}
  ${bells(220, 392, 5, 6)}<path d="M80,${G} q20,-30 60,0" fill="#e5e7eb" stroke="${INK}" stroke-width="0.8"/>`);
// Norse Astronauts - OmegA SE (dirt): a slender all-solid launcher, black and
// white segmented stages, on an arctic coastal range under the aurora.
ART['crew_spacex_norse:secondary'] = () => svg('', `<path d="M-10,140 Q80,90 160,130 T320,110" stroke="#4ade80" stroke-width="10" fill="none" opacity="0.35" filter="url(#soft)"/>
  ${pad(222, C.crew_spacex_norse, { th: 220, tx: -40, ground: '#e2e8f0' })}
  <path d="M0,${G} L40,${G - 70} L70,${G - 40} L110,${G - 96} L150,${G} Z" fill="#334155" stroke="${INK}"/><path d="M40,${G - 70} L50,${G - 56} L32,${G - 58} Z M110,${G - 96} L122,${G - 78} L98,${G - 80} Z" fill="#f8fafc"/>
  ${stage(222, 270, 392, 18, 'url(#blk)')}${stage(222, 200, 270, 16)}${stage(222, 168, 200, 14, 'url(#blk)')}${fairing(222, 168, 18, 40, 14)}
  ${[300, 330, 360].map((y) => band(222, y, 18, 2, '#9ca3af')).join('')}${bells(222, 392, 1, 14)}${crew(40, C.crew_spacex_norse, 2)}`);


// ---- promo crew (Crew Card Promo Pack, 18 cards) ---------------------------
// No published lore exists for these: real organisations and launchers keep
// their real look; invented ones are drawn from the faction name, privilege
// and launcher name. Both faces of a promo card share one faction and one
// launcher, so each card is one scene with a small change between its faces.
const SEA = (c = '#0e7490') => `<rect x="0" y="${G}" width="${W}" height="${H - G}" fill="${c}"/><path d="M0,${G + 8} q20,-5 40,0 t40,0 t40,0 t40,0 t40,0 t40,0 t40,0 t40,0" stroke="#bae6fd" fill="none"/>`;
const promo = (id, draw) => { ART[`${id}:primary`] = () => draw('primary'); ART[`${id}:secondary`] = () => draw('secondary'); };

// BRIN (Indonesia's research agency, which absorbed LAPAN): a slim finned
// solid "RX" rocket on a rail launcher at an equatorial coral coast (the
// planned Biak spaceport), with big radiator panels for its thermal
// privileges - folded on the white face, deployed as a glowing wall on the back.
promo('crew_brin', (side) => svg('', `${SEA('#0891b2')}<path d="M0,${G} L120,${G} Q150,${G - 8} 300,${G - 4} L300,${G + 6} L0,${G + 6} Z" fill="#fde68a"/>
  <line x1="150" y1="${G - 4}" x2="262" y2="200" stroke="#475569" stroke-width="4"/><line x1="170" y1="${G - 4}" x2="190" y2="${G - 60}" stroke="#475569" stroke-width="3"/>
  <g transform="rotate(-56 230 270)"><rect x="160" y="262" width="120" height="14" fill="url(#wht)" stroke="${INK}"/><path d="M280,262 L300,269 L280,276 Z" fill="#dc2626" stroke="${INK}"/>${[-1, 1].map((s2) => `<path d="M160,${269 + s2 * 7} l14,${s2 * 10} l10,0 l-6,${-s2 * 10} Z" fill="#475569" stroke="${INK}"/>`).join('')}</g>
  ${side === 'primary'
    ? `<rect x="40" y="${G - 46}" width="44" height="40" fill="#334155" stroke="${INK}"/>${[0, 1, 2].map((i) => `<line x1="${44 + i * 14}" y1="${G - 44}" x2="${44 + i * 14}" y2="${G - 8}" stroke="#94a3b8"/>`).join('')}`
    : `${[0, 1, 2, 3].map((i) => `<rect x="${20 + i * 30}" y="${G - 110}" width="26" height="104" fill="#7f1d1d" stroke="#f97316" stroke-width="1.4" filter="url(#glow)"/>`).join('')}`}
  ${crew(92, C.crew_brin, 2)}`));

// The Sea Peoples (after the Bronze Age sea raiders): a stateless ocean
// faction launching their small "Fuu S010" off a semi-submersible sea-launch
// platform, their command ship alongside. The back face is the same rig at
// night, lit up like a floating casino for the Power Brokers.
promo('crew_the_sea_peoples', (side) => {
  const night = side === 'secondary';
  return svg('', `${night ? `<rect x="0" y="180" width="${W}" height="${G - 180}" fill="#0f172a" opacity="0.18"/>` : ''}${SEA(night ? '#1e3a5f' : '#0e7490')}
  <rect x="150" y="${G - 22}" width="140" height="12" fill="#57534e" stroke="${INK}"/>${[160, 190, 250, 280].map((x) => `<rect x="${x}" y="${G - 10}" width="8" height="18" fill="#57534e" stroke="${INK}"/>`).join('')}
  <rect x="246" y="${G - 140}" width="12" height="118" fill="none" stroke="#475569" stroke-width="2"/>
  ${stage(222, 250, G - 22, 12)}${nose(222, 250, 12, 22)}${band(222, 300, 12, 3, '#b45309')}
  <path d="M20,${G - 8} L120,${G - 8} L110,${G + 4} L30,${G + 4} Z" fill="#78350f" stroke="${INK}"/><rect x="50" y="${G - 26}" width="40" height="18" fill="#f8fafc" stroke="${INK}"/><line x1="70" y1="${G - 26}" x2="70" y2="${G - 70}" stroke="${INK}" stroke-width="2"/><path d="M70,${G - 68} L96,${G - 40} L70,${G - 36} Z" fill="#b45309" stroke="${INK}"/>
  ${night ? [...Array(10)].map((_, i) => `<circle cx="${156 + i * 13}" cy="${G - 16}" r="2.4" fill="#fde047" filter="url(#glow)"/>`).join('') : ''}
  <g transform="translate(0 -8)">${crew(56, C.crew_the_sea_peoples, 2)}</g>`);
});

// The Martian Way (Asimov, 1952): Mars-born Scavengers. White face: a
// battered scavenger ship grappling a tumbling spent booster with Mars and
// Phobos behind. Back face (Tailings Remining): their ships embedded in the
// end of a colossal block of Saturn-ring ice, burning it as reaction mass.
promo('crew_the_martian_way', (side) => svg(rad('mars', [[0, '#fdba74'], [0.6, '#c2410c'], [1, '#431407']], '35%', '30%') + lin('ice', [[0, '#e0f2fe'], [0.5, '#93c5fd'], [1, '#3b82f6']], 0, 0, 1, 0), side === 'primary'
  ? `<circle cx="70" cy="330" r="76" fill="url(#mars)" stroke="${INK}"/><circle cx="160" cy="250" r="8" fill="#78716c" stroke="${INK}"/>
     <g transform="rotate(30 200 300)">${stage(200, 250, 340, 18)}${band(200, 270, 18, 3, INK)}</g>
     <rect x="216" y="356" width="56" height="22" rx="5" fill="#78716c" stroke="${INK}"/><rect x="226" y="360" width="10" height="6" fill="#fde68a"/>
     <line x1="226" y1="356" x2="214" y2="330" stroke="${INK}" stroke-width="2"/><line x1="246" y1="356" x2="226" y2="324" stroke="${INK}" stroke-width="2"/>
     <path d="M272,367 L300,360 L300,374 Z" fill="url(#flm)" filter="url(#glow)"/>`
  : `<ellipse cx="150" cy="430" rx="220" ry="34" fill="none" stroke="#d6d3d1" stroke-width="10" opacity="0.6"/>
     <path d="M40,250 L250,230 L280,330 L70,360 Z" fill="url(#ice)" stroke="${INK}" stroke-width="1.4"/>
     ${[[90, 352], [140, 346], [190, 340]].map(([x, y]) => `<rect x="${x - 8}" y="${y - 6}" width="16" height="12" fill="#78716c" stroke="${INK}"/><path d="M${x - 6},${y + 6} Q${x},${y + 50} ${x + 6},${y + 6} Z" fill="url(#flm)" filter="url(#glow)"/>`).join('')}`));

// JAXA: a slim all-white Epsilon-style solid rocket ("Omicron-S") on the
// hilltop rail launcher of Uchinoura over the Pacific. Back face (Starchild):
// an augmented crew member with a soft bioluminescent glow at the foot of it.
promo('crew_jaxa', (side) => svg('', `${SEA('#1d4ed8')}<path d="M0,${G} L0,${G - 50} Q60,${G - 80} 160,${G - 60} L200,${G} Z" fill="#15803d" stroke="${INK}"/>
  <line x1="150" y1="${G - 58}" x2="232" y2="190" stroke="#475569" stroke-width="5"/>
  <g transform="rotate(-24 222 290)">${stage(222, 220, 360, 14)}${nose(222, 220, 14, 26)}${band(222, 300, 14, 2, '#94a3b8')}</g>
  <circle cx="260" cy="120" r="10" fill="#dc2626" opacity="0.8"/>
  ${side === 'secondary' ? `<circle cx="70" cy="${G - 78}" r="18" fill="#c4b5fd" opacity="0.6" filter="url(#soft)"/>` : ''}
  <g transform="translate(0 -58)">${crew(side === 'secondary' ? 70 : 50, side === 'secondary' ? '#a78bfa' : C.crew_jaxa, side === 'secondary' ? 1 : 2)}</g>`));

// Space Force - Falcon X (SpaceX's 2010 heavy-lift concept): a stubby wide
// white core over three big engine bells, on a fog-bound coastal pad. The
// privileges are rescue: a small orange lifeboat capsule pulls away.
promo('crew_space_force', (side) => svg('', `${pad(222, C.crew_space_force, { th: 200, tx: -40, ground: '#64748b' })}
  <rect x="0" y="${G - 40}" width="${W}" height="40" fill="#e2e8f0" opacity="0.6" filter="url(#soft)"/>
  ${stage(222, 220, 392, 30)}${fairing(222, 220, 30, 44, 30)}${bells(222, 392, 3, 10)}
  <g transform="translate(${side === 'primary' ? 0 : -60} ${side === 'primary' ? 0 : -50})"><path d="M120,250 L150,250 L144,234 L126,234 Z" fill="#ea580c" stroke="${INK}"/><circle cx="135" cy="244" r="3" fill="#fde68a"/></g>
  ${crew(36, '#4b5563', 3)}`));

// AEB (Brazil's space agency): a small solid rocket ringed with slim strap-ons
// (VLS style) at the Alcantara coast, red earth and mangroves. The white face
// flies O'Bean II-A; the back O'Bean III, taller with a bigger upper stage.
promo('crew_aeb', (side) => { const big = side === 'secondary'; return svg('', `${pad(222, C.crew_aeb, { th: 220, tx: -42, ground: '#9a3412' })}
  ${[16, 44, 72, 100].map((x) => `<path d="M${x},${G} q-8,-14 0,-26 q8,12 12,0 q8,14 0,26 Z" fill="#166534" stroke="${INK}" stroke-width="0.6"/>`).join('')}
  ${[-12, 12].map((d) => booster(222 + d, 316, 392, 9)).join('')}${[-6, 6].map((d) => booster(222 + d, 320, 392, 8)).join('')}
  ${stage(222, big ? 210 : 250, 392, 14)}${nose(222, big ? 210 : 250, 14, 26)}${band(222, 300, 14, 3, '#15803d')}${band(222, 340, 14, 2, '#eab308')}
  ${crew(130, C.crew_aeb, 2)}`); });

// Explorers Without Borders (a humanitarian NGO): in orbit, a Vulcan's
// Centaur V upper stage nosing supply pods toward a small shuttle; crew in
// field-medic white with a red stripe. The back face (Iso-Shuttles) shows
// two shuttles running the route.
promo('crew_explorers_without_borders', (side) => svg(rad('earth', [[0, '#93c5fd'], [0.6, '#1d4ed8'], [1, '#0b1640']], '40%', '30%'), `<circle cx="150" cy="560" r="220" fill="url(#earth)" stroke="${INK}"/>
  <g transform="rotate(-70 220 270)">${stage(220, 220, 320, 22)}${band(220, 240, 22, 4, '#ea580c')}${bells(220, 320, 2, 10)}</g>
  ${[0, 1, 2].map((i) => `<rect x="${130 - i * 26}" y="${244 + i * 10}" width="20" height="16" rx="3" fill="#f8fafc" stroke="${INK}"/><rect x="${130 - i * 26}" y="${250 + i * 10}" width="20" height="3" fill="#dc2626"/>`).join('')}
  ${(side === 'primary' ? [[40, 300]] : [[40, 300], [70, 210]]).map(([x, y]) => `<path d="M${x},${y} L${x + 40},${y - 6} L${x + 48},${y} L${x + 40},${y + 6} Z" fill="#f8fafc" stroke="${INK}"/><path d="M${x + 14},${y + 2} L${x + 24},${y + 14} L${x + 30},${y + 2} Z" fill="#cbd5e1" stroke="${INK}"/>`).join('')}`));

// Baltimore Gun Club (Verne, 1865): the Columbiad cannon pit at Stones Hill -
// a great iron muzzle in the ground - with a modern arcjet nozzle glowing at
// its mouth; gentlemen in top hats. Water face: a steam plume. Hydrogen face:
// a violet-blue plasma jet.
promo('crew_baltimore_gun_club', (side) => { const c1 = side === 'primary' ? '#f1f5f9' : '#a78bfa'; return svg(lin('jet', [[0, c1, 0.95], [1, c1, 0]], 0, 1, 0, 0), `<rect x="0" y="${G}" width="${W}" height="${H - G}" fill="#78716c"/>
  <path d="M150,${G} L190,${G - 30} L270,${G - 30} L300,${G} Z" fill="#a8a29e" stroke="${INK}"/>
  <ellipse cx="230" cy="${G - 30}" rx="40" ry="10" fill="#292524" stroke="${INK}" stroke-width="1.4"/><ellipse cx="230" cy="${G - 30}" rx="30" ry="7" fill="#0c0a09"/>
  <path d="M212,${G - 32} L248,${G - 32} L262,120 L198,120 Z" fill="url(#jet)"/>
  <circle cx="230" cy="${G - 34}" r="8" fill="${side === 'primary' ? '#fde68a' : '#c4b5fd'}" filter="url(#glow)"/>
  ${[30, 62, 94].map((x, i) => `<rect x="${x - 6}" y="${G - 40}" width="12" height="32" rx="3" fill="${['#1f2937', '#7f1d1d', '#334155'][i]}" stroke="${INK}"/><circle cx="${x}" cy="${G - 46}" r="6" fill="#fcd9b6" stroke="${INK}"/><rect x="${x - 6}" y="${G - 66}" width="12" height="14" fill="#111827"/><rect x="${x - 9}" y="${G - 53}" width="18" height="3" fill="#111827"/>`).join('')}`); });

// African Union Space Directorate: an equatorial launch off an offshore
// platform (the San Marco platform off Malindi, Kenya, is the real precedent)
// with a clean white mid-size "Uru Anga A01". The back face (Arbiter) adds a
// round council table of delegates on the shore.
promo('crew_african_union_space_directorate', (side) => svg('', `${SEA('#0369a1')}<path d="M0,${G} L110,${G} L120,${G + 6} L0,${G + 6} Z" fill="#d6c7a1"/>
  <rect x="170" y="${G - 16}" width="110" height="10" fill="#57534e" stroke="${INK}"/>${[178, 210, 240, 270].map((x) => `<rect x="${x}" y="${G - 6}" width="6" height="16" fill="#57534e" stroke="${INK}"/>`).join('')}
  ${stage(226, 200, G - 16, 18)}${fairing(226, 200, 20, 40, 18)}${band(226, 260, 18, 3, '#ca8a04')}${bells(226, G - 18, 2, 8)}
  ${side === 'secondary' ? `<ellipse cx="60" cy="${G - 18}" rx="40" ry="10" fill="#92400e" stroke="${INK}"/>${[24, 44, 76, 96].map((x) => `<circle cx="${x}" cy="${G - 34}" r="5" fill="#7c2d12" stroke="${INK}"/><rect x="${x - 5}" y="${G - 30}" width="10" height="12" fill="#ca8a04" stroke="${INK}"/>`).join('')}` : crew(40, C.crew_african_union_space_directorate, 3)}`));

// LEO Workers' Union: the people who build low orbit - welders in hard-shell
// EVA suits on an orbital truss, tool tethers out, an Angara small in the
// distance below. White face: on the job (Collective Bargaining). Back face
// (Sitdown): seated across the hatch, arms folded, tools down.
promo('crew_leo_workers_union', (side) => svg(rad('earth2', [[0, '#93c5fd'], [0.6, '#1d4ed8'], [1, '#0b1640']], '40%', '30%'), `<circle cx="150" cy="620" r="250" fill="url(#earth2)" stroke="${INK}"/>
  <path d="M0,300 L300,250 L300,272 L0,322 Z" fill="none" stroke="#475569" stroke-width="2"/>${[...Array(10)].map((_, i) => `<path d="M${i * 30},${300 - i * 5} L${i * 30 + 30},${272 - i * 5}" stroke="#64748b" stroke-width="1.4"/>`).join('')}
  ${(side === 'primary' ? [[90, 270], [190, 252]] : [[110, 280], [150, 274], [190, 266]]).map(([x, y]) => `<circle cx="${x}" cy="${y - 20}" r="8" fill="#f8fafc" stroke="${INK}"/><rect x="${x - 5}" y="${y - 23}" width="10" height="5" rx="2" fill="#0f172a"/><rect x="${x - 9}" y="${y - 12}" width="18" height="${side === 'primary' ? 22 : 14}" rx="4" fill="#f8fafc" stroke="${INK}"/><rect x="${x - 9}" y="${y - 6}" width="18" height="4" fill="#facc15"/>`).join('')}
  ${side === 'primary' ? `<circle cx="214" cy="258" r="5" fill="#fef9c3" filter="url(#glow)"/><path d="M90,258 q-30,30 -60,20" stroke="#facc15" fill="none" stroke-dasharray="3 2"/>` : ''}
  <g transform="translate(232 370) scale(0.25)">${[-14, 14].map((d) => booster(d, 262, 392, 14)).join('')}${stage(0, 196, 392, 14)}</g>`));

// Makers Guild: a boxy kit-bashed tug of mismatched printed modules (the
// "NCC 1702-A") docked at a busy trade-port station, cargo racks and a big
// 3D printer arm; guild craftspeople in aprons. Back face: the trade port.
promo('crew_makers_guild', (side) => svg('', `<rect x="0" y="300" width="${W}" height="16" fill="#475569" stroke="${INK}"/>${[...Array(6)].map((_, i) => `<rect x="${10 + i * 48}" y="316" width="40" height="${side === 'primary' ? 40 : 70}" fill="${['#b45309', '#64748b', '#0f766e', '#94a3b8', '#a16207', '#475569'][i]}" stroke="${INK}"/>`).join('')}
  <g transform="translate(180 200)"><rect x="0" y="0" width="36" height="28" fill="#94a3b8" stroke="${INK}"/><rect x="36" y="6" width="22" height="16" fill="#b45309" stroke="${INK}"/><rect x="-22" y="4" width="22" height="20" fill="#cbd5e1" stroke="${INK}"/><path d="M58,8 L72,4 L72,26 L58,22 Z" fill="#475569" stroke="${INK}"/><rect x="6" y="-14" width="10" height="14" fill="#0f766e" stroke="${INK}"/></g>
  <path d="M40,300 L40,240 L90,220 L100,236" stroke="#d97706" stroke-width="5" fill="none"/><rect x="94" y="232" width="12" height="10" fill="#475569" stroke="${INK}"/>`));

// New Pilgrims: settlers in plain dark coats and white collars watching a
// huge translucent stratospheric balloon lift a slim Liberty-style rocket on
// a long rig line at dawn - a rockoon. The back face: the rocket fires off
// the balloon.
promo('crew_new_pilgrims', (side) => svg(rad('bal', [[0, '#ffffff', 0.7], [0.8, '#e2e8f0', 0.4], [1, '#94a3b8', 0.6]], '40%', '35%'), `<rect x="0" y="${G}" width="${W}" height="${H - G}" fill="#a3a3a3"/><circle cx="40" cy="${G}" r="40" fill="#fbbf24" opacity="0.35" filter="url(#soft)"/>
  <ellipse cx="220" cy="${side === 'primary' ? 150 : 120}" rx="56" ry="66" fill="url(#bal)" stroke="#64748b"/>
  <line x1="220" y1="${side === 'primary' ? 216 : 186}" x2="220" y2="${side === 'primary' ? 270 : 230}" stroke="${INK}" stroke-width="1"/>
  <g transform="translate(0 ${side === 'primary' ? 0 : -40})">${stage(220, 270, 350, 10)}${nose(220, 270, 10, 18)}${side === 'secondary' ? `<path d="M215,350 Q220,400 225,350 Z" fill="url(#flm)" filter="url(#glow)"/>` : ''}</g>
  ${[30, 50, 70, 92].map((x, i) => `<circle cx="${x}" cy="${G - 30}" r="5" fill="#fcd9b6" stroke="${INK}"/><path d="M${x - 7},${G} L${x - 6},${G - 24} L${x + 6},${G - 24} L${x + 7},${G} Z" fill="#1f2937" stroke="${INK}"/><rect x="${x - 5}" y="${G - 25}" width="10" height="3" fill="#f8fafc"/>${i === 3 ? `<rect x="${x + 6}" y="${G - 14}" width="10" height="10" fill="#92400e" stroke="${INK}"/>` : ''}`).join('')}`));

// Utopia, Inc.: a sleek small launcher on a glowing aerospike (a crown-shaped
// base with the flame hugging the spike, no bell) over a pristine corporate
// garden-city campus. Back face (Piggyback): a small rocket riding on a
// bigger one's back.
promo('crew_utopia_inc', (side) => svg('', `<rect x="0" y="${G}" width="${W}" height="${H - G}" fill="#86efac"/>${[20, 60, 100].map((x, i) => `<rect x="${x}" y="${G - 40 - i * 12}" width="30" height="${40 + i * 12}" rx="4" fill="#f8fafc" stroke="${INK}"/><rect x="${x + 6}" y="${G - 34 - i * 12}" width="18" height="4" fill="#fbbf24"/><circle cx="${x + 15}" cy="${G - 44 - i * 12}" r="9" fill="#22c55e" stroke="${INK}" stroke-width="0.6"/>`).join('')}
  ${stage(222, 220, 382, 20)}${nose(222, 220, 20, 34)}${band(222, 300, 20, 3, '#ca8a04')}
  <path d="M212,382 L222,402 L232,382 Z" fill="#94a3b8" stroke="${INK}"/><path d="M210,384 Q222,${G + 10} 234,384" fill="none" stroke="#fde68a" stroke-width="3" filter="url(#glow)"/>
  ${side === 'secondary' ? `<g transform="translate(18 0)">${stage(222, 250, 320, 9)}${nose(222, 250, 9, 16)}</g>` : ''}`));

// Galahad Group (after the Grail knight): a heavy white-and-silver launcher
// rising into a shaft of sunlight; a crew member in a knightly tabard over
// the suit. Back face (Quest): a lone figure on a distant moon beside a
// grail-shaped dish antenna.
promo('crew_galahad_group', (side) => side === 'primary'
  ? svg(lin('ray', [[0, '#fef9c3', 0.9], [1, '#fef9c3', 0]]), `<path d="M190,0 L254,0 L270,${G} L174,${G} Z" fill="url(#ray)"/>${pad(222, C.crew_galahad_group, { tower: false })}
     ${[-18, 18].map((d) => booster(222 + d, 270, 392, 13, 'url(#ste)')).join('')}${stage(222, 180, 392, 22)}${fairing(222, 180, 24, 48, 22)}${bells(222, 392, 3, 8)}${liftoff(222, 400, 22, 41)}
     <circle cx="60" cy="${G - 46}" r="7" fill="#f8fafc" stroke="${INK}"/><path d="M50,${G} L52,${G - 38} L68,${G - 38} L70,${G} Z" fill="#e5e7eb" stroke="${INK}"/><path d="M54,${G - 36} L66,${G - 36} L66,${G - 8} L60,${G - 2} L54,${G - 8} Z" fill="#1e40af" stroke="${INK}"/><path d="M58,${G - 30} h4 v6 h4 v3 h-4 v10 h-4 v-10 h-4 v-3 h4 Z" fill="#fbbf24"/>`)
  : svg('', `<path d="M0,${G - 20} Q150,${G - 50} 300,${G - 20} L300,${H} L0,${H} Z" fill="#cbd5e1" stroke="${INK}"/>
     <path d="M190,${G - 104} Q220,${G - 70} 250,${G - 104} Z" fill="#e5e7eb" stroke="${INK}"/><rect x="216" y="${G - 86}" width="8" height="40" fill="#94a3b8" stroke="${INK}"/><path d="M204,${G - 46} L236,${G - 46} L228,${G - 34} L212,${G - 34} Z" fill="#94a3b8" stroke="${INK}"/>
     <circle cx="120" cy="${G - 60}" r="7" fill="#f8fafc" stroke="${INK}"/><path d="M110,${G - 14} L112,${G - 52} L128,${G - 52} L130,${G - 14} Z" fill="#1e40af" stroke="${INK}"/>`));

// Brotherhood of Cryptobankers - Roton C-9: the Rotary Rocket's squat cone
// with four helicopter rotor blades spread on its nose and a ring of jets
// round its rotating annular aerospike base, at night; cloaked figures.
// Back face (Chairman's Cut): the same with coins in hex tokens, no text.
promo('crew_brotherhood_of_cryptobankers', (side) => svg('', `<rect x="0" y="${G}" width="${W}" height="${H - G}" fill="#292524"/>
  <path d="M196,384 L248,384 L230,250 L214,250 Z" fill="url(#ste)" stroke="${INK}" stroke-width="1.2"/>
  ${[-1, 1].map((s2) => `<path d="M222,252 L${222 + s2 * 70},${238 + (s2 > 0 ? -6 : 6)} L${222 + s2 * 70},${244 + (s2 > 0 ? -6 : 6)} Z" fill="#475569" stroke="${INK}"/>`).join('')}<circle cx="222" cy="250" r="4" fill="#475569"/>
  ${[...Array(9)].map((_, i) => `<circle cx="${198 + i * 6}" cy="388" r="2.6" fill="#fde68a" filter="url(#glow)"/>`).join('')}
  ${[30, 62, 94].map((x) => `<path d="M${x - 10},${G} L${x - 6},${G - 40} Q${x},${G - 54} ${x + 6},${G - 40} L${x + 10},${G} Z" fill="#7f1d1d" stroke="${INK}"/>`).join('')}
  ${side === 'secondary' ? [...Array(5)].map((_, i) => `<path d="M${120 + i * 14},${G - 6} l6,-4 l6,4 l0,7 l-6,4 l-6,-4 Z" fill="#ca8a04" stroke="${INK}"/>`).join('') : ''}`));

// VerisAI: a heavy, pristine, sensor-studded launcher on a pad built like a
// data centre (server racks, cooling towers), an android crew member. Back
// face (Cavitation Engineers): the vehicle punching through an atmosphere in
// a bubble-like shock cavity.
promo('crew_verisai', (side) => side === 'primary'
  ? svg('', `${pad(222, C.crew_verisai, { tower: false, ground: '#334155' })}${[20, 54].map((x) => `<rect x="${x}" y="${G - 70}" width="28" height="70" fill="#1f2937" stroke="${INK}"/>${[...Array(6)].map((_, i) => `<rect x="${x + 4}" y="${G - 64 + i * 10}" width="20" height="3" fill="#22d3ee"/>`).join('')}`).join('')}
     <path d="M96,${G} L104,${G - 50} L124,${G - 50} L132,${G} Z" fill="#94a3b8" stroke="${INK}"/>
     ${[-17, 17].map((d) => booster(222 + d, 260, 392, 14)).join('')}${stage(222, 176, 392, 22)}${fairing(222, 176, 24, 48, 22)}${[220, 260, 300, 340].map((y) => `<circle cx="222" cy="${y}" r="2" fill="#22d3ee"/>`).join('')}${bells(222, 392, 3, 8)}`)
  : svg(rad('cav', [[0, '#cffafe', 0.1], [0.8, '#22d3ee', 0.25], [1, '#0e7490', 0.8]]), `<rect x="0" y="300" width="${W}" height="140" fill="#bae6fd" opacity="0.5"/>
     <ellipse cx="190" cy="250" rx="70" ry="100" fill="url(#cav)" stroke="#0e7490" stroke-width="1.4" transform="rotate(20 190 250)"/>
     <g transform="rotate(20 190 250)">${stage(190, 200, 320, 20)}${nose(190, 200, 20, 34)}</g>`));

// Heliocentricity: orbital-mechanics mystics. A sundiver craft behind a big
// white heat shield silhouetted against the solar disc and its prominences
// (the Parker Solar Probe look). Back face: looping chaotic transfer paths
// (the weak stability boundary) drawn as orbit spirographs.
promo('crew_heliocentricity', (side) => svg(rad('sun', [[0, '#ffffff'], [0.4, '#fde047'], [0.8, '#f97316'], [1, '#f97316', 0]]), side === 'primary'
  ? `<circle cx="150" cy="300" r="120" fill="url(#sun)"/>${[[60, 240], [250, 330]].map(([x, y]) => `<path d="M${x},${y} q10,-30 26,-4" stroke="#ea580c" stroke-width="4" fill="none"/>`).join('')}
     <rect x="186" y="230" width="10" height="70" fill="#f8fafc" stroke="${INK}"/><rect x="196" y="250" width="26" height="30" fill="#475569" stroke="${INK}"/><line x1="222" y1="265" x2="250" y2="265" stroke="${INK}" stroke-width="1.4"/>`
  : `<circle cx="150" cy="300" r="22" fill="url(#sun)"/>${[0, 40, 80, 120, 160].map((a) => `<ellipse cx="150" cy="300" rx="110" ry="40" fill="none" stroke="#ca8a04" stroke-width="1" transform="rotate(${a} 150 300)"/>`).join('')}<path d="M40,300 C80,200 220,420 260,300 S120,180 150,300" stroke="#16a34a" stroke-width="2" fill="none" stroke-dasharray="4 3"/>`));

// Cerulean (water-world people): New Glenn's first stage settling on its
// fins onto a landing ship in a cerulean ocean. Back face (Dowsers): a crew
// member with a forked dowsing rod over an icy moon surface.
promo('crew_cerulean', (side) => side === 'primary'
  ? svg('', `${SEA('#0284c7')}<rect x="150" y="${G - 12}" width="140" height="14" fill="#475569" stroke="${INK}"/>
     ${stage(222, 220, 382, 26)}${band(222, 222, 26, 6, INK)}
     ${[-1, 1].map((s2) => `<path d="M${222 + s2 * 13},230 l${s2 * 10},-8 l0,18 Z" fill="#cbd5e1" stroke="${INK}"/><line x1="${222 + s2 * 12}" y1="370" x2="${222 + s2 * 30}" y2="${G - 12}" stroke="${INK}" stroke-width="2.4"/>`).join('')}
     ${bells(222, 382, 3, 8)}<path d="M206,390 Q222,420 238,390 Z" fill="url(#flm)" filter="url(#glow)"/>`)
  : svg('', `<path d="M0,${G - 30} Q150,${G - 60} 300,${G - 30} L300,${H} L0,${H} Z" fill="#e0f2fe" stroke="${INK}"/>${[[40, G - 20], [200, G - 26], [260, G - 10]].map(([x, y]) => `<path d="M${x},${y} l30,6" stroke="#7dd3fc" stroke-width="1.4"/>`).join('')}
     <circle cx="160" cy="${G - 92}" r="8" fill="#f8fafc" stroke="${INK}"/><rect x="155" y="${G - 96}" width="10" height="5" rx="2" fill="#0f172a"/><path d="M150,${G - 30} L152,${G - 82} L168,${G - 82} L170,${G - 30} Z" fill="#e3e0d4" stroke="${INK}"/>
     <path d="M170,${G - 70} L196,${G - 56} M170,${G - 70} L194,${G - 74} M195,${G - 65} L214,${G - 52}" stroke="#78350f" stroke-width="2.4" fill="none"/>`));

for (const card of [...CREW, ...PROMO_CREW]) {
  for (const side of ['primary', 'secondary']) {
    if (!ART[`${card.id}:${side}`]) throw new Error(`crew art missing: ${card.id}:${side}`);
  }
}
