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

// UN Cosmonauts - Liberty: a five-segment solid first stage (white, black
// segment joints) under a slim Vulcain-powered core stage and a crew capsule
// with its escape tower; lifting off in a column of solid-rocket smoke.
ART['crew_un_b612:primary'] = () => svg('', `${pad(220, C.crew_un_b612)}
  ${stage(220, 140, 250, 16)}${stage(220, 250, 392, 20)}${[268, 296, 324, 352].map((y) => band(220, y, 20, 3, INK)).join('')}
  ${capsuleLES(220, 140, 18)}${bells(220, 392, 1, 14)}${liftoff(220, 400, 18, 11)}${crew(36, C.crew_un_b612)}`);
// B612 Foundation - New Glenn: the big reusable first stage settling onto its
// landing ship at sea, legs out, fins up top; the Sentinel-style infrared
// telescope the foundation flies watching for asteroids above.
ART['crew_un_b612:secondary'] = () => svg('', `<rect x="0" y="${G}" width="${W}" height="${H - G}" fill="#1e3a8a"/><path d="M0,${G + 6} q20,-4 40,0 t40,0 t40,0 t40,0 t40,0 t40,0 t40,0 t40,0" stroke="#93c5fd" fill="none"/>
  <rect x="150" y="${G - 12}" width="140" height="14" fill="#475569" stroke="${INK}"/>
  ${stage(222, 220, 382, 26)}${band(222, 222, 26, 6, INK)}
  ${[-1, 1].map((s) => `<path d="M${222 + s * 13},230 l${s * 10},-8 l0,18 Z" fill="#cbd5e1" stroke="${INK}"/><line x1="${222 + s * 12}" y1="370" x2="${222 + s * 30}" y2="${G - 12}" stroke="${INK}" stroke-width="2.4"/>`).join('')}
  ${bells(222, 382, 3, 8)}<path d="M206,390 Q222,420 238,390 Z" fill="url(#flm)" filter="url(#glow)"/>
  <g transform="translate(0 92)"><rect x="236" y="96" width="20" height="44" rx="3" fill="#0f172a" stroke="${INK}" transform="rotate(-30 246 118)"/><rect x="214" y="110" width="20" height="10" fill="#1e3a8a" stroke="#93c5fd" transform="rotate(-30 246 118)"/><rect x="258" y="110" width="20" height="10" fill="#1e3a8a" stroke="#93c5fd" transform="rotate(-30 246 118)"/></g>`);

// Roscosmos - Angara A5: a grey-white core flanked by four identical strap-on
// boosters of the same diameter, on a tall service tower at a snowy cosmodrome.
ART['crew_roscosmos_taikonauts:primary'] = () => svg('', `${pad(222, C.crew_roscosmos_taikonauts, { ground: '#e2e8f0', th: 250, tx: -46 })}
  ${[-24, -12, 12, 24].map((d) => booster(222 + d, 270, 392, 12)).join('')}
  ${stage(222, 190, 392, 13)}${fairing(222, 190, 17, 46, 13)}${band(222, 300, 13, 3, '#64748b')}
  ${bells(222, 392, 5, 11)}
  ${[30, 70, 110].map((x) => `<path d="M${x},${G} l14,-22 l14,22 Z" fill="#14532d" stroke="${INK}" stroke-width="0.8"/><path d="M${x + 8},${G - 12} l6,-10 l6,10 Z" fill="#f8fafc"/>`).join('')}`);
// Taikonauts - Long March 9: a fat super-heavy core with four boosters,
// white with grey bands, at a coastal pad lined with palms.
ART['crew_roscosmos_taikonauts:secondary'] = () => svg('', `${pad(222, C.crew_roscosmos_taikonauts, { th: 260, tx: -48 })}
  ${[-28, 28].map((d) => booster(222 + d, 260, 392, 14)).join('')}${[-17, 17].map((d) => booster(222 + d, 252, 392, 14)).join('')}
  ${stage(222, 170, 392, 24)}${fairing(222, 170, 26, 52, 24)}${[230, 300].map((y) => band(222, y, 24, 4, '#94a3b8')).join('')}
  ${bells(222, 392, 6, 10)}
  ${[24, 64].map((x) => `<line x1="${x}" y1="${G}" x2="${x + 6}" y2="${G - 54}" stroke="#78350f" stroke-width="3"/>${[-50, -20, 20, 50].map((a) => `<path d="M${x + 6},${G - 54} q${f(Math.sin(a * Math.PI / 180) * 18)},-6 ${f(Math.sin(a * Math.PI / 180) * 26)},6" stroke="#15803d" stroke-width="3" fill="none"/>`).join('')}`).join('')}`);

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

for (const card of CREW) {
  for (const side of ['primary', 'secondary']) {
    if (!ART[`${card.id}:${side}`]) throw new Error(`crew art missing: ${card.id}:${side}`);
  }
}
