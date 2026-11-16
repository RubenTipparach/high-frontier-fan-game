#!/usr/bin/env node
// Module 4 contract card foregrounds: ONE SVG PER CARD FACE, each drawing the
// subject of that face's own published illustration (a probe, a statue, a
// bootprint, a cryopod, a WANTED poster ...), layered over the face's rendered
// destination backdrop (assets/cards/contracts/<code>-3d.webp, Blender:
// scripts/card-art/blender/render_contracts.py). User 2026-11-15: "svg ships
// and stuff ... keep planets and asteroids as 3d backdrops", then "avoid
// reusing svg for the different cards ... examine the original art work".
// Planets, moons, asteroids and comets are NEVER drawn here: they are the
// rendered backdrop.
//
//   node scripts/gen-contract-craft.mjs   -> assets/cards/contracts/craft/<code>.svg
//
// Every subject is lit from the upper left (the backdrops' sun side) with a
// warm rim on the lower right. Shared parts (suit figure, dish, tank, wheel...)
// keep one drawing style; each card composes its own scene from them.
import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'cards', 'contracts', 'craft');
const W = 240, H = 150;

const DEFS = `<defs>
<linearGradient id="metal" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="#f6f7fa"/><stop offset="0.45" stop-color="#c3c9d2"/><stop offset="1" stop-color="#555d6b"/></linearGradient>
<linearGradient id="hull" x1="0" y1="0" x2="0.5" y2="1"><stop offset="0" stop-color="#8a93a3"/><stop offset="0.5" stop-color="#3b414d"/><stop offset="1" stop-color="#15181e"/></linearGradient>
<linearGradient id="white" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="0.55" stop-color="#dfe3ea"/><stop offset="1" stop-color="#8c94a2"/></linearGradient>
<linearGradient id="gold" x1="0" y1="0" x2="0.7" y2="1"><stop offset="0" stop-color="#fff0b0"/><stop offset="0.4" stop-color="#e2b13e"/><stop offset="1" stop-color="#7a4d0e"/></linearGradient>
<linearGradient id="solar" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a64c4"/><stop offset="0.5" stop-color="#173478"/><stop offset="1" stop-color="#0a1638"/></linearGradient>
<linearGradient id="stone" x1="0" y1="0" x2="0.5" y2="1"><stop offset="0" stop-color="#c9ccd1"/><stop offset="0.5" stop-color="#8d939c"/><stop offset="1" stop-color="#454a52"/></linearGradient>
<linearGradient id="rust" x1="0" y1="0" x2="0.5" y2="1"><stop offset="0" stop-color="#e0a070"/><stop offset="0.5" stop-color="#a55a30"/><stop offset="1" stop-color="#4a2210"/></linearGradient>
<linearGradient id="glass" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#e8f6ff" stop-opacity="0.85"/><stop offset="1" stop-color="#6aa8d8" stop-opacity="0.35"/></linearGradient>
<linearGradient id="ice" x1="0" y1="0" x2="0.5" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="0.5" stop-color="#bfe6ff"/><stop offset="1" stop-color="#5d9ccc"/></linearGradient>
<pattern id="cells" width="7" height="7" patternUnits="userSpaceOnUse"><rect width="7" height="7" fill="url(#solar)"/><path d="M7 0V7M0 7H7" stroke="#6f93e6" stroke-width="0.5" opacity="0.6"/></pattern>
<radialGradient id="plume" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff"/><stop offset="0.25" stop-color="#bfe3ff"/><stop offset="0.6" stop-color="#4f9dff" stop-opacity="0.5"/><stop offset="1" stop-color="#4f9dff" stop-opacity="0"/></radialGradient>
<radialGradient id="warm" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff7e0"/><stop offset="0.3" stop-color="#ffc46b"/><stop offset="1" stop-color="#ff8a2a" stop-opacity="0"/></radialGradient>
<radialGradient id="red" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff"/><stop offset="0.3" stop-color="#ff4a3d"/><stop offset="1" stop-color="#ff4a3d" stop-opacity="0"/></radialGradient>
<radialGradient id="green" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#f0fff0"/><stop offset="0.35" stop-color="#5ee07a"/><stop offset="1" stop-color="#1e8a3a" stop-opacity="0"/></radialGradient>
<radialGradient id="cyan" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff"/><stop offset="0.35" stop-color="#6ff0ff"/><stop offset="1" stop-color="#1ab4d8" stop-opacity="0"/></radialGradient>
<radialGradient id="dish" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#fff"/><stop offset="0.6" stop-color="#c9ced8"/><stop offset="1" stop-color="#5d6573"/></radialGradient>
<radialGradient id="ball" cx="0.35" cy="0.3" r="0.75"><stop offset="0" stop-color="#ffffff"/><stop offset="0.5" stop-color="#b9c0cb"/><stop offset="1" stop-color="#3d434e"/></radialGradient>
<filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2"/></filter>
</defs>`;

// ---- parts ----------------------------------------------------------------------
const RIM = 'stroke="#ffd7a3" stroke-opacity="0.55" stroke-width="1.2" fill="none"';
const f = (n) => +n.toFixed(1);
const wing = (x, y, w, h, skew = 0, rot = 0) => `<g transform="translate(${x} ${y}) rotate(${rot}) skewX(${skew})"><rect width="${w}" height="${h}" fill="url(#cells)" stroke="#9fb4e0" stroke-width="0.8"/></g>`;
const glow = (cx, cy, r, id = 'plume') => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id})"/>`;
const rod = (x1, y1, x2, y2, w = 2, paint = 'url(#metal)') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${paint}" stroke-width="${w}" stroke-linecap="round"/>`;
const ball = (cx, cy, r, paint = 'url(#ball)') => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${paint}"/>`;
const box = (x, y, w, h, paint = 'url(#metal)', rx = 2) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${paint}"/>`;
const win = (x, y, w = 5, h = 3) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1" fill="#ffe2a0"/>`;
const dish = (cx, cy, rx, ry, rot = 0) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(${rot} ${cx} ${cy})" fill="url(#dish)" stroke="#5d6573" stroke-width="0.8"/>`;
const wheel = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#hull)"/><circle cx="${cx}" cy="${cy}" r="${f(r * 0.45)}" fill="url(#metal)"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#7d8696" stroke-width="1.4" stroke-dasharray="2.5 2"/>`;
const bell = (x, y, w, h, flip = 1) => `<path d="M${x} ${y} L${x + flip * w} ${y - h / 2} L${x + flip * w} ${y + h / 2} Z" fill="url(#hull)"/>`;
const svg = (body, rot = 0) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${DEFS}
<g transform="rotate(${rot} ${W / 2} ${H / 2})">${body}</g></svg>
`;
// A suited figure, feet at (x, y), `s` = scale (about 50 px tall at 1).
function figure(x, y, s = 1, { suit = 'url(#white)', visor = '#d9a531', pose = 'stand', pack = true } = {}) {
  // A suited astronaut, feet on (x, y), about 54 units tall at s = 1: helmet
  // with a gold visor, life-support pack, jointed arms and legs, gloves, boots.
  const S = (v) => f(v * s);
  const X = (dx) => f(x + dx * s);
  const Y = (dy) => f(y - dy * s);
  const INK = '#283041';
  const arms = {
    stand: [[-9, 30, -12, 16], [9, 30, 12, 16]],
    wave: [[-9, 30, -12, 16], [9, 30, 17, 42]],
    reach: [[-9, 30, -12, 16], [9, 30, 24, 30]],
    selfie: [[-9, 30, -12, 16], [9, 30, 20, 44]],
    float: [[-9, 30, -20, 38], [9, 30, 20, 38]],
    hold: [[-9, 30, 4, 22], [9, 30, 14, 24]],
  }[pose] || [[-9, 30, -12, 16], [9, 30, 12, 16]];
  const legs = pose === 'walk' ? [[-4, 18, -12, 0], [4, 18, 9, 0]] : pose === 'kneel' ? [[-4, 18, -14, 8], [4, 18, 8, 0]] : [[-4, 18, -5, 0], [4, 18, 5, 0]];
  // A limb bends at its middle joint, away from the body's centre line.
  const limb = ([ax, ay, bx, by], w, bend) => {
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const side = (mx >= 0 ? 1 : -1) * bend;
    const jx = mx + ((by - ay) / len) * side, jy = my - ((bx - ax) / len) * side;
    const d = `M${X(ax)} ${Y(ay)} Q${X(jx)} ${Y(jy)} ${X(bx)} ${Y(by)}`;
    return { d, jx, jy, bx, by,
      svg: `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${S(w + 1.8)}" stroke-linecap="round"/>`
        + `<path d="${d}" fill="none" stroke="${suit}" stroke-width="${S(w)}" stroke-linecap="round"/>`
        + `<circle cx="${X((ax + 2 * jx + bx) / 4)}" cy="${Y((ay + 2 * jy + by) / 4)}" r="${S(w * 0.42)}" fill="none" stroke="#9aa3b2" stroke-width="${S(0.9)}"/>` };
  };
  const legSvg = legs.map((l) => {
    const L = limb(l, 7.4, 1.6);
    return L.svg + `<rect x="${X(l[2] - 4.6)}" y="${Y(l[3] + 1.4)}" width="${S(9.2)}" height="${S(4.2)}" rx="${S(1.6)}" fill="#5b6475" stroke="${INK}" stroke-width="${S(0.8)}"/>`;
  }).join('');
  const armSvg = arms.map((a) => {
    const A = limb(a, 6, 2.6);
    return A.svg + `<circle cx="${X(a[2])}" cy="${Y(a[3])}" r="${S(3.3)}" fill="#c9ced8" stroke="${INK}" stroke-width="${S(0.8)}"/>`;
  }).join('');
  const packSvg = pack ? `<rect x="${X(-13)}" y="${Y(42)}" width="${S(26)}" height="${S(23)}" rx="${S(4)}" fill="url(#metal)" stroke="${INK}" stroke-width="${S(0.9)}"/>`
    + `<rect x="${X(-11)}" y="${Y(45)}" width="${S(5)}" height="${S(4)}" rx="${S(1)}" fill="#8c94a2" stroke="${INK}" stroke-width="${S(0.6)}"/>` : '';
  return `<g>${packSvg}${legSvg}
    <rect x="${X(-9.5)}" y="${Y(39)}" width="${S(19)}" height="${S(23)}" rx="${S(6)}" fill="${suit}" stroke="${INK}" stroke-width="${S(1)}"/>
    <path d="M${X(4)} ${Y(38.4)} Q${X(9.5)} ${Y(36)} ${X(9.5)} ${Y(30)} L${X(9.5)} ${Y(22)} Q${X(9.5)} ${Y(16.6)} ${X(4)} ${Y(16.6)} Z" fill="#000" opacity="0.14"/>
    <line x1="${X(-9)}" y1="${Y(19.5)}" x2="${X(9)}" y2="${Y(19.5)}" stroke="#9aa3b2" stroke-width="${S(1.6)}"/>
    <rect x="${X(-5.5)}" y="${Y(33)}" width="${S(11)}" height="${S(6.5)}" rx="${S(1.2)}" fill="#e6e9ef" stroke="${INK}" stroke-width="${S(0.6)}"/>
    ${[[-3, '#e05252'], [0, '#ffd36b'], [3, '#4ea1ff']].map(([dx, c]) => `<circle cx="${X(dx)}" cy="${Y(29.8)}" r="${S(0.95)}" fill="${c}"/>`).join('')}
    ${armSvg}
    <ellipse cx="${X(0)}" cy="${Y(37.6)}" rx="${S(6.4)}" ry="${S(2.2)}" fill="#9aa3b2" stroke="${INK}" stroke-width="${S(0.7)}"/>
    <circle cx="${X(0)}" cy="${Y(45)}" r="${S(8.8)}" fill="${suit}" stroke="${INK}" stroke-width="${S(1)}"/>
    <ellipse cx="${X(1.2)}" cy="${Y(45)}" rx="${S(6.2)}" ry="${S(5.2)}" fill="${visor}" stroke="${INK}" stroke-width="${S(0.7)}"/>
    <path d="M${X(-4.4)} ${Y(44)} Q${X(-3.6)} ${Y(49)} ${X(1)} ${Y(49.4)}" fill="none" stroke="#fff" stroke-width="${S(1.3)}" stroke-linecap="round" opacity="0.85"/>
    <path d="M${X(-3)} ${Y(41.6)} Q${X(1.2)} ${Y(39.2)} ${X(6.6)} ${Y(42.6)}" fill="none" stroke="#000" stroke-width="${S(1.4)}" opacity="0.22"/></g>`;
}
const stars = (n, seed) => Array.from({ length: n }, (_, i) => {
  const a = Math.sin(seed * 31 + i * 12.9898) * 43758.5453, b = Math.sin(seed * 17 + i * 78.233) * 12345.678;
  return `<circle cx="${f((a - Math.floor(a)) * W)}" cy="${f((b - Math.floor(b)) * H)}" r="0.8" fill="#fff" opacity="0.7"/>`;
}).join('');

// ---- one scene per card face (code -> what its printed art shows) -----------------
const ART = {
  // New Horizons: the triangular flyby probe, its big dish and RTG boom.
  M4N217F: svg(`${rod(130, 84, 186, 112, 3)}${box(180, 106, 16, 10, 'url(#hull)', 2)}
    <path d="M96 70 L150 62 L144 100 L104 104 Z" fill="url(#gold)"/>${dish(112, 64, 30, 9, -20)}${rod(112, 64, 112, 50, 1.5)}
    <path d="M144 100 L104 104" ${RIM}/>`, -8),
  // Home on Lagrange: a habitat parked on the Lagrange ring, the points marked.
  M4N217R: svg(`<ellipse cx="120" cy="80" rx="96" ry="40" fill="none" stroke="#9fdcff" stroke-width="1" opacity="0.7"/>
    ${[[24, 80], [216, 80], [120, 40], [170, 112]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" fill="none" stroke="#ffd36b" stroke-width="1.4"/>`).join('')}
    <ellipse cx="120" cy="40" rx="14" ry="6" fill="none" stroke="url(#white)" stroke-width="4"/>${ball(120, 40, 3)}${glow(120, 40, 10, 'warm')}`),
  // Comet Adventure: a low-thrust ion ship with its long blue plume.
  M4N218F: svg(`<path d="M150 74 L236 60 L236 92 Z" fill="url(#plume)" opacity="0.8"/>
    ${box(96, 66, 56, 16, 'url(#white)', 6)}${wing(104, 40, 30, 22, -24)}${wing(100, 82, 30, 22, 24)}${bell(152, 74, 8, 12)}
    ${dish(92, 74, 5, 14)}${glow(160, 74, 12)}`, -16),
  // Pleasure Garden: a microgravity garden dome, the catwalk stair running in.
  M4N218R: svg(`<path d="M50 122 A70 70 0 0 1 190 122 Z" fill="url(#glass)" stroke="#e8f6ff" stroke-width="1.5"/>
    ${Array.from({ length: 9 }, (_, i) => `<ellipse cx="${66 + i * 13}" cy="${112 - (i % 3) * 8}" rx="${9 + (i % 2) * 4}" ry="${7 + (i % 3) * 3}" fill="${['#2f8f46', '#4fbf5f', '#1e6b34'][i % 3]}"/>`).join('')}
    <path d="M104 122 L112 70 L128 70 L136 122 Z" fill="url(#metal)" opacity="0.9"/>${Array.from({ length: 6 }, (_, i) => rod(106 + i * 0.6, 116 - i * 9, 134 - i * 0.6, 116 - i * 9, 1.2, '#555d6b')).join('')}
    <path d="M50 122 L190 122" stroke="url(#metal)" stroke-width="4"/>`),
  // Artemis: the crew capsule over its tall service module, flag stripe and all.
  M4N219F: svg(`${wing(40, 70, 44, 16, -10)}${wing(156, 70, 44, 16, 10)}
    ${box(100, 56, 40, 64, 'url(#white)', 4)}${box(100, 72, 40, 6, '#c22', 0)}${box(100, 78, 40, 3, '#fff', 0)}${box(100, 81, 40, 3, '#2347a8', 0)}
    <path d="M104 56 L112 28 L128 28 L136 56 Z" fill="url(#metal)"/>${win(114, 38)}${win(122, 38)}${bell(120, 128, 10, 16, 1)}
    <path d="M140 56 L140 120 L100 120" ${RIM}/>`, 6),
  // HAVOC: the Venus aerostat, a long solar-topped airship.
  M4N219R: svg(`<path d="M40 82 C 60 52, 170 50, 204 74 C 170 96, 60 102, 40 82 Z" fill="url(#white)"/>
    <path d="M60 66 C 100 56, 160 56, 196 70" stroke="url(#solar)" stroke-width="6" fill="none"/>
    <path d="M196 76 L222 62 L218 78 L222 92 Z" fill="url(#metal)"/>${box(104, 92, 34, 10, 'url(#hull)', 3)}${win(110, 95)}${win(118, 95)}${win(126, 95)}
    ${rod(112, 92, 108, 86, 1)}${rod(130, 92, 134, 86, 1)}<path d="M40 82 C 60 102, 170 96, 204 74" ${RIM}/>`, -4),
  // Closest Planet: a tourist hopper with a wraparound viewing deck.
  M4N220F: svg(`${[[84, 124, 96, 98], [156, 124, 144, 98]].map(([a, b, c, d]) => rod(c, d, a, b, 3) + `<ellipse cx="${a}" cy="${b + 2}" rx="8" ry="3" fill="url(#metal)"/>`).join('')}
    <path d="M86 98 L154 98 L146 66 L94 66 Z" fill="url(#white)"/><path d="M92 76 L148 76 L146 88 L94 88 Z" fill="#1d2433"/>
    ${Array.from({ length: 6 }, (_, i) => win(98 + i * 8, 79, 5, 5)).join('')}<path d="M100 66 C 104 50, 136 50, 140 66 Z" fill="url(#metal)"/>${glow(120, 108, 10, 'warm')}`),
  // Highest Cliff: a jumper leaping off the cliff edge, jetpack firing.
  M4N220R: svg(`<path d="M0 150 L0 96 L60 92 L74 150 Z" fill="url(#stone)"/>
    <g transform="rotate(-30 150 70)">${figure(150, 96, 1.05, { pose: 'float' })}</g>${glow(128, 92, 12, 'warm')}`),
  // Inner Tour: a flyby craft on its swinging trajectory.
  M4N221F: svg(`<path d="M10 130 C 60 20, 170 20, 232 110" fill="none" stroke="#9fdcff" stroke-width="1.4" stroke-dasharray="4 4"/>
    <g transform="rotate(22 160 50)">${box(140, 44, 40, 12, 'url(#white)', 5)}${wing(146, 26, 24, 16, -20)}${wing(146, 56, 24, 16, 20)}${bell(180, 50, 6, 10)}${glow(188, 50, 8)}</g>`),
  // Grand Tour: Voyager - the big dish, the magnetometer boom, the RTGs.
  M4N221R: svg(`${rod(120, 80, 214, 52, 1.2)}${rod(110, 92, 60, 128, 2.5)}${box(52, 124, 14, 8, 'url(#hull)')}${rod(132, 92, 160, 122, 2)}${box(152, 118, 16, 10, 'url(#gold)')}
    ${box(106, 80, 30, 16, 'url(#gold)', 1)}${dish(120, 66, 36, 12, 0)}${rod(120, 66, 120, 48, 1.4)}`, -6),
  // Hubris: the heroic astronaut statue on its plinth.
  M4N222F: svg(`${box(92, 116, 56, 22, 'url(#stone)', 1)}${box(86, 134, 68, 8, 'url(#stone)', 1)}
    ${figure(120, 118, 1.25, { suit: 'url(#stone)', visor: '#6d737c', pose: 'hold' })}`),
  // Fulgurite Hunt: a branching glass fulgurite, lightning still on it.
  M4N222R: svg(`<path d="M40 112 C 70 96, 110 100, 150 90 C 170 84, 196 92, 214 80" stroke="url(#rust)" stroke-width="12" fill="none" stroke-linecap="round"/>
    <path d="M110 98 C 116 116, 128 124, 140 132 M160 88 C 166 72, 178 64, 190 58" stroke="url(#rust)" stroke-width="6" fill="none" stroke-linecap="round"/>
    <path d="M150 10 L140 40 L152 42 L134 78" stroke="#e8f0ff" stroke-width="2.5" fill="none"/>${glow(134, 80, 14, 'cyan')}`),
  // Fool's Gold: a daredevil racer skimming an exploding iceflash.
  M4N223F: svg(`<path d="M150 76 L236 50 L236 70 Z" fill="url(#red)" opacity="0.7"/>
    <path d="M70 80 L150 64 L156 78 L150 88 Z" fill="url(#hull)"/><path d="M96 74 L126 68 L130 74 L100 78 Z" fill="#9fdcff"/>
    <path d="M128 66 L140 52 L146 66 Z" fill="#c22"/>${glow(158, 76, 10, 'warm')}`, -10),
  // Rivalry: one bootprint pressed into the dust.
  M4N223R: svg(`<g transform="rotate(-20 120 76)"><path d="M92 40 C 92 20, 148 20, 148 40 L148 74 C 148 84, 140 88, 136 98 L136 116 C 136 132, 104 132, 104 116 L104 98 C 100 88, 92 84, 92 74 Z" fill="#3a3530" opacity="0.8"/>
    ${Array.from({ length: 9 }, (_, i) => `<rect x="96" y="${28 + i * 10}" width="48" height="4" rx="2" fill="#7a7068" opacity="0.8"/>`).join('')}</g>`),
  // Chiron Quest: a survey probe with its spectrometer, scanning the ring arcs.
  M4N224F: svg(`<path d="M20 120 A110 40 0 0 1 230 110" fill="none" stroke="#9fdcff" stroke-width="1" stroke-dasharray="2 3"/>
    ${box(100, 60, 36, 26, 'url(#gold)', 2)}${wing(64, 64, 34, 16, 0)}${wing(138, 64, 34, 16, 0)}${box(108, 44, 18, 16, 'url(#hull)', 2)}<circle cx="117" cy="52" r="4" fill="#5fd8ff"/>${glow(117, 52, 8, 'cyan')}`, -8),
  // Cen Tour: a tour coach with a long window band.
  M4N224R: svg(`<path d="M56 70 L176 66 C 196 66, 204 80, 196 92 L64 96 C 50 96, 44 76, 56 70 Z" fill="url(#white)"/>
    ${Array.from({ length: 12 }, (_, i) => win(70 + i * 10, 76, 7, 6)).join('')}<path d="M176 66 C 190 68, 196 74, 198 80 L184 80 Z" fill="#1d2433"/>
    ${bell(58, 82, -10, 14)}${glow(44, 82, 12)}<path d="M196 92 L64 96" ${RIM}/>`, -6),
  // Vanity Project: a spacewalker taking a selfie against the flare.
  M4N225F: svg(`${glow(190, 30, 40, 'warm')}${figure(110, 132, 1.5, { pose: 'selfie' })}${rod(140, 64, 156, 40, 1.5)}${box(150, 30, 12, 16, '#1d2433', 2)}`),
  // Extreme Sports: an EVA athlete diving with streaming jet trails.
  M4N225R: svg(`<path d="M10 140 C 60 120, 110 100, 140 80" stroke="#9fdcff" stroke-width="3" opacity="0.5" fill="none"/>
    <path d="M10 120 C 60 104, 110 92, 140 76" stroke="#ffd36b" stroke-width="2" opacity="0.5" fill="none"/>
    <g transform="rotate(60 150 80)">${figure(150, 110, 1.1, { pose: 'float', suit: 'url(#white)', visor: '#c22' })}</g>`),
  // Mars Polar Walk: an astronaut walking, footprints trailing back.
  M4N226F: svg(`${Array.from({ length: 5 }, (_, i) => `<ellipse cx="${30 + i * 18}" cy="${136 - (i % 2) * 4}" rx="5" ry="2.5" fill="#3a2a20" opacity="0.7"/>`).join('')}
    ${figure(140, 138, 1.4, { pose: 'walk' })}${rod(170, 138, 170, 70, 1.5)}<rect x="170" y="70" width="24" height="15" fill="#c22"/><rect x="170" y="70" width="10" height="8" fill="#2347a8"/>`),
  // ET Holy Grail: the segmented alien artefact drifting in.
  M4N226R: svg(`<g transform="rotate(-35 120 76)">${Array.from({ length: 5 }, (_, i) => `<rect x="${70 + i * 22}" y="66" width="18" height="20" rx="3" fill="#15171c" stroke="#5e6a7a" stroke-width="1"/>`).join('')}
    ${rod(70, 76, 180, 76, 3, '#2a2e36')}${Array.from({ length: 5 }, (_, i) => `<rect x="${74 + i * 22}" y="74" width="10" height="4" fill="#7ad3ff" opacity="0.8"/>`).join('')}</g>`),
  // Aerover Blimp Explorer: striped scout blimps parachuting into the haze.
  M4N227F: svg(`${[[70, 50, 1], [120, 70, 1.3], [176, 44, 0.9], [150, 108, 0.8]].map(([x, y, k]) => `<path d="M${x - 14 * k} ${y - 12 * k} A${14 * k} ${12 * k} 0 0 1 ${x + 14 * k} ${y - 12 * k} Z" fill="#e8e2d0" opacity="0.8"/>
      ${rod(x - 13 * k, y - 12 * k, x - 3 * k, y + 2 * k, 0.6, '#ccc')}${rod(x + 13 * k, y - 12 * k, x + 3 * k, y + 2 * k, 0.6, '#ccc')}
      <ellipse cx="${x}" cy="${y + 10 * k}" rx="${9 * k}" ry="${11 * k}" fill="url(#gold)"/>${Array.from({ length: 3 }, (_, i) => `<line x1="${x - 8 * k}" y1="${y + (5 + i * 5) * k}" x2="${x + 8 * k}" y2="${y + (5 + i * 5) * k}" stroke="#7a4d0e" stroke-width="${f(0.8 * k)}"/>`).join('')}`).join('')}`),
  // Nuclear-Electric Airship: the long dark flying wing.
  M4N227R: svg(`<path d="M20 96 C 80 78, 150 70, 230 64 L226 72 C 160 82, 90 92, 26 104 Z" fill="url(#hull)"/>
    <path d="M110 80 L140 76 L150 90 L118 94 Z" fill="url(#hull)"/>${glow(150, 84, 6, 'red')}<path d="M26 104 C 90 92, 160 82, 226 72" ${RIM}/>`, -6),
  // Solar Observatory: a sun probe tucked behind its white heat shield.
  M4N228F: svg(`<ellipse cx="96" cy="72" rx="10" ry="40" fill="url(#white)" stroke="#9aa3b2"/>${box(106, 62, 40, 22, 'url(#gold)', 2)}
    ${wing(146, 50, 22, 12, -10)}${wing(146, 84, 22, 12, 10)}${rod(146, 72, 200, 72, 1.4)}${glow(200, 72, 4)}`, -12),
  // Golden Apples of the Sun: a sungrazer lab - a glowing core behind a cone shield.
  M4N228R: svg(`<path d="M70 40 L70 112 L112 92 L112 60 Z" fill="url(#white)"/>${ball(140, 76, 22, 'url(#gold)')}${glow(140, 76, 30, 'warm')}
    ${rod(162, 76, 210, 76, 2)}${box(206, 70, 10, 12, 'url(#hull)')}`, -10),
  // Submersible Prospector: a spherical sub, ribbed, its floodlights on.
  M4N229F: svg(`${ball(120, 76, 36, 'url(#hull)')}<circle cx="120" cy="76" r="36" fill="none" stroke="#7d8696" stroke-width="3"/>
    <ellipse cx="120" cy="76" rx="36" ry="12" fill="none" stroke="#7d8696" stroke-width="3"/><ellipse cx="120" cy="76" rx="12" ry="36" fill="none" stroke="#7d8696" stroke-width="3"/>
    <circle cx="108" cy="66" r="8" fill="#9fdcff"/>${glow(84, 96, 24, 'warm')}${glow(160, 98, 16, 'warm')}`),
  // Goldilocks Luna Terraform: an ice dropstone falling in, steam trailing.
  M4N229R: svg(`<path d="M190 20 C 160 40, 140 60, 120 84" stroke="#e8f6ff" stroke-width="18" opacity="0.25" fill="none" stroke-linecap="round"/>
    <path d="M100 74 L124 64 L140 80 L132 100 L106 102 L94 88 Z" fill="url(#ice)"/>${glow(118, 96, 18, 'cyan')}`),
  // Hexapod Explorer: the six-legged walker hauling its white tanks.
  M4N230F: svg(`${box(70, 52, 100, 26, 'url(#white)', 12)}${box(78, 36, 84, 18, 'url(#white)', 9)}
    ${[80, 104, 128, 152].map((x) => `${rod(x, 78, x - 6, 98, 3)}${rod(x - 6, 98, x + 2, 124, 3)}${wheel(x + 2, 126, 6)}`).join('')}`),
  // Amalthea Halbonaut: a halo balloon probe drifting over the dust.
  M4N230R: svg(`<ellipse cx="120" cy="70" rx="40" ry="14" fill="url(#hull)"/><ellipse cx="120" cy="66" rx="30" ry="9" fill="url(#metal)"/>
    ${glow(120, 82, 10, 'warm')}<ellipse cx="150" cy="128" rx="30" ry="5" fill="#000" opacity="0.4"/>`),
  // Mosquito: the drilling lander, seismometer dome beside it.
  M4N231F: svg(`${box(84, 76, 72, 14, 'url(#gold)', 2)}${wing(40, 72, 44, 18, 0)}${wing(156, 72, 44, 18, 0)}
    ${rod(96, 90, 88, 124, 3)}${rod(144, 90, 152, 124, 3)}${rod(120, 90, 120, 140, 2.5, '#9aa3b2')}
    <path d="M58 132 A14 14 0 0 1 86 132 Z" fill="url(#white)"/>${rod(126, 76, 140, 56, 1.5)}`),
  // Solar Nebula Mafics: four mottled mineral globes on a sample rack.
  M4N231R: svg(`${[[84, 52, '#4fbf5f'], [140, 50, '#3fae68'], [86, 104, '#2f9a8a'], [142, 104, '#6dcf4f']].map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="22" fill="${c}"/><circle cx="${x - 6}" cy="${y + 4}" r="7" fill="#d8402f" opacity="0.6"/><circle cx="${x - 7}" cy="${y - 8}" r="6" fill="#fff" opacity="0.35"/>`).join('')}`),
  // Sun-fired Laser: a swarm of laser sats, their beams fanning down.
  M4N232F: svg(`${[[60, 30], [110, 22], [160, 34], [200, 50], [80, 60]].map(([x, y]) => `<line x1="${x}" y1="${y}" x2="${x + 40}" y2="150" stroke="#ff9ad1" stroke-width="1.2" opacity="0.7"/>${box(x - 6, y - 4, 12, 8, 'url(#gold)', 1)}${wing(x - 16, y - 3, 9, 6)}${wing(x + 7, y - 3, 9, 6)}`).join('')}`),
  // Daedalus Starship Research: the Daedalus starship as a cyan blueprint.
  M4N232R: svg(`<g fill="none" stroke="#7fe3ff" stroke-width="1.1">
    <path d="M20 76 L200 76 M40 64 L40 88 M60 60 L60 92"/><circle cx="210" cy="76" r="22"/><path d="M188 76 L232 76 M210 54 L210 98"/>
    <circle cx="90" cy="66" r="10"/><circle cx="90" cy="86" r="10"/><circle cx="116" cy="66" r="10"/><circle cx="116" cy="86" r="10"/><circle cx="142" cy="66" r="10"/><circle cx="142" cy="86" r="10"/>
    <path d="M160 52 L190 60 L190 92 L160 100 Z"/><path d="M20 70 L10 76 L20 82"/></g>
    <text x="22" y="118" fill="#7fe3ff" font-family="monospace" font-size="8">DAEDALUS / STAGE 2</text>`),
  // Equatorial Launch Railway: a rocketplane riding the maglev ramp.
  M4N233F: svg(`<path d="M0 140 L240 60" stroke="url(#metal)" stroke-width="6"/>${Array.from({ length: 8 }, (_, i) => rod(20 + i * 28, 134 - i * 9.3, 20 + i * 28, 150, 2.5, '#555d6b')).join('')}
    <g transform="rotate(-18 130 92)"><path d="M80 92 L180 88 L200 96 L180 100 L80 100 Z" fill="url(#white)"/><path d="M110 90 L150 70 L160 90 Z" fill="url(#white)"/>${bell(80, 96, -8, 10)}${glow(70, 96, 12)}</g>`),
  // Fullerene Cable Spinner: a spinner hub paying out its long curved cable.
  M4N233R: svg(`<path d="M120 76 C 160 60, 200 40, 236 10" stroke="#cfd6e2" stroke-width="2" fill="none"/><path d="M120 76 C 80 92, 40 112, 4 140" stroke="#cfd6e2" stroke-width="2" fill="none"/>
    <ellipse cx="120" cy="76" rx="22" ry="22" fill="none" stroke="url(#hull)" stroke-width="7"/>${ball(120, 76, 9)}`),
  // Plasma Intrusion Laboratory: a field lab threaded by magnetic loops.
  M4N234F: svg(`${[16, 28, 40].map((r) => `<ellipse cx="120" cy="76" rx="${r * 2.4}" ry="${r}" fill="none" stroke="#ffcf4a" stroke-width="1" opacity="0.6"/>`).join('')}
    ${box(104, 64, 32, 24, 'url(#gold)', 2)}${wing(72, 68, 32, 14)}${wing(136, 68, 32, 14)}${rod(120, 64, 120, 38, 1.4)}${glow(120, 36, 6, 'warm')}`),
  // Triggered Decay Positrons: the positron trap - a glowing ring, red core.
  M4N234R: svg(`<ellipse cx="120" cy="76" rx="60" ry="22" fill="none" stroke="url(#hull)" stroke-width="10"/>
    <ellipse cx="120" cy="76" rx="60" ry="22" fill="none" stroke="#5ee07a" stroke-width="1.5" stroke-dasharray="3 3"/>${glow(120, 76, 26, 'red')}${glow(120, 76, 50, 'green')}`),
  // Mercury Forge: a foundry lander pouring a glowing melt.
  M4N235F: svg(`${box(76, 70, 88, 34, 'url(#hull)', 3)}<path d="M96 70 L104 40 L136 40 L144 70 Z" fill="url(#metal)"/>${rod(140, 46, 168, 30, 3)}
    <path d="M164 96 C 176 108, 180 124, 184 140" stroke="#ff8a2a" stroke-width="7" fill="none" stroke-linecap="round"/>${glow(184, 138, 18, 'warm')}${glow(150, 86, 8, 'warm')}`),
  // Topographic Ocean: a cryobot melting down, a vent plume rising past it.
  M4N235R: svg(`<path d="M150 150 C 146 110, 156 80, 150 30" stroke="#bfe6ff" stroke-width="16" opacity="0.3" fill="none"/>
    ${box(96, 50, 20, 60, 'url(#metal)', 9)}<path d="M96 110 L106 128 L116 110 Z" fill="url(#ice)"/>${glow(106, 126, 14, 'warm')}${rod(106, 50, 106, 20, 1)}`),
  // Beehive: the rotating hollow-world cylinder, lit window bands.
  M4N236F: svg(`<g transform="rotate(-20 120 76)">${box(50, 50, 140, 52, 'url(#white)', 26)}
    ${Array.from({ length: 3 }, (_, i) => box(60, 58 + i * 14, 120, 5, '#ffe2a0', 2)).join('')}<ellipse cx="190" cy="76" rx="8" ry="26" fill="url(#metal)"/>${rod(198, 76, 222, 76, 3)}</g>`),
  // Ring Industrialization: a moonlet mine with its collector drones.
  M4N236R: svg(`${box(90, 96, 60, 24, 'url(#hull)', 2)}${box(100, 80, 18, 18, 'url(#metal)')}${box(124, 72, 14, 26, 'url(#metal)')}${glow(131, 72, 6, 'warm')}
    ${[[56, 50], [176, 40], [196, 76], [40, 86]].map(([x, y]) => `${box(x - 6, y - 3, 12, 6, 'url(#white)', 2)}${rod(x - 10, y - 4, x + 10, y - 4, 1)}${glow(x, y + 4, 4)}`).join('')}`),
  // Planetary Protection: a sealed sample canister in its quarantine cage.
  M4N237F: svg(`${box(92, 46, 56, 70, 'url(#white)', 10)}${box(92, 64, 56, 6, '#e2b13e', 0)}${box(92, 92, 56, 6, '#e2b13e', 0)}
    <circle cx="120" cy="81" r="9" fill="none" stroke="#c22" stroke-width="2"/><path d="M114 75 L126 87 M126 75 L114 87" stroke="#c22" stroke-width="2"/>
    ${[80, 160].map((x) => rod(x, 40, x, 124, 2, '#9aa3b2')).join('')}${rod(80, 40, 160, 40, 2, '#9aa3b2')}${rod(80, 124, 160, 124, 2, '#9aa3b2')}`),
  // Planetary Rail Network: a light-rail car racing along the track.
  M4N237R: svg(`<path d="M0 120 L240 96" stroke="url(#metal)" stroke-width="4"/><path d="M0 128 L240 104" stroke="url(#metal)" stroke-width="2"/>
    <g transform="rotate(-6 120 100)">${box(70, 84, 110, 22, 'url(#white)', 8)}${Array.from({ length: 7 }, (_, i) => win(80 + i * 13, 89, 9, 6)).join('')}${box(64, 86, 12, 18, 'url(#solar)', 6)}</g>`),
  // Search for Life Center: a chirality lab - polariser telescope, helix sign.
  M4N238F: svg(`${box(70, 70, 70, 44, 'url(#white)', 4)}${rod(140, 80, 186, 46, 12, 'url(#hull)')}<ellipse cx="188" cy="44" rx="8" ry="10" fill="#9fdcff" opacity="0.8" transform="rotate(-36 188 44)"/>
    <g fill="none" stroke="#5ee07a" stroke-width="2"><path d="M84 76 C 96 84, 96 96, 84 104 M96 76 C 84 84, 84 96, 96 104"/></g>${win(108, 80, 22, 6)}`),
  // Sunrise Project: a camera probe with its big lens open to the dawn.
  M4N238R: svg(`${box(90, 60, 50, 34, 'url(#hull)', 4)}<circle cx="148" cy="77" r="16" fill="url(#hull)"/><circle cx="148" cy="77" r="10" fill="#1d3f8f"/><circle cx="144" cy="73" r="3" fill="#fff" opacity="0.8"/>
    ${wing(54, 64, 36, 14)}${glow(196, 74, 26, 'warm')}`),
  // Spin Control: a tumbling lander firing its spin thrusters, arcs showing the roll.
  M4N239F: svg(`<path d="M60 40 A70 70 0 0 1 200 60" fill="none" stroke="#ffd36b" stroke-width="1.5" stroke-dasharray="5 4"/><path d="M196 52 L202 62 L190 62 Z" fill="#ffd36b"/>
    <g transform="rotate(30 120 84)">${box(96, 70, 48, 28, 'url(#white)', 4)}${rod(100, 98, 90, 116, 2.5)}${rod(140, 98, 150, 116, 2.5)}${glow(94, 72, 7)}${glow(146, 96, 7)}</g>`),
  // Ring Rain: a ring monitor satellite, ice grains falling past.
  M4N239R: svg(`${Array.from({ length: 14 }, (_, i) => `<circle cx="${30 + i * 15}" cy="${20 + ((i * 37) % 110)}" r="1.6" fill="#cfe9ff"/>${rod(30 + i * 15, 20 + ((i * 37) % 110), 30 + i * 15 - 3, 20 + ((i * 37) % 110) - 10, 0.6, '#cfe9ff')}`).join('')}
    ${box(104, 64, 32, 22, 'url(#metal)', 3)}${wing(68, 68, 36, 14)}${wing(136, 68, 36, 14)}${dish(120, 98, 14, 5)}`),
  // Bio-Inspired Rover: a rotor drone, long blades over its solar panel.
  M4N240F: svg(`${rod(60, 52, 180, 44, 2.5, '#2a2e36')}${rod(70, 60, 170, 38, 2.5, '#2a2e36')}${rod(120, 48, 120, 76, 2)}
    ${box(104, 76, 32, 22, 'url(#white)', 3)}${wing(102, 70, 36, 6)}${rod(108, 98, 92, 124, 1.5)}${rod(132, 98, 148, 124, 1.5)}`),
  // Subnubilar Zeppelin: a ribbed zeppelin, gondola slung beneath.
  M4N240R: svg(`<path d="M30 70 C 50 40, 190 40, 214 66 C 190 92, 50 100, 30 70 Z" fill="url(#white)"/>
    ${Array.from({ length: 7 }, (_, i) => `<path d="M${56 + i * 22} 46 C ${50 + i * 22} 66, ${50 + i * 22} 80, ${56 + i * 22} 92" stroke="#9aa3b2" stroke-width="1" fill="none"/>`).join('')}
    ${box(100, 96, 40, 12, 'url(#metal)', 4)}${Array.from({ length: 4 }, (_, i) => win(106 + i * 8, 99, 5, 4)).join('')}<path d="M206 62 L228 52 L224 70 Z" fill="url(#metal)"/>`, -4),
  // Yarkovsky Research: a thermal-panel tug, heat arrows pushing off.
  M4N241F: svg(`${box(100, 64, 40, 24, 'url(#hull)', 3)}${box(60, 46, 40, 60, '#2a2e36', 2)}${box(140, 46, 40, 60, '#2a2e36', 2)}
    ${[60, 140].map((x) => Array.from({ length: 5 }, (_, i) => rod(x + 4, 52 + i * 11, x + 36, 52 + i * 11, 1, '#ff8a2a')).join('')).join('')}
    ${[[30, 76], [210, 76]].map(([x, y]) => `<path d="M${x} ${y - 6} L${x + (x < 120 ? -14 : 14)} ${y} L${x} ${y + 6} Z" fill="#ff8a2a"/>`).join('')}`),
  // Deep Space One: the ion-drive scooper on its long solar wings.
  M4N241R: svg(`${wing(14, 66, 70, 18)}${wing(156, 66, 70, 18)}${box(96, 60, 48, 32, 'url(#gold)', 2)}${dish(120, 54, 18, 6)}${bell(144, 76, 10, 14)}${glow(160, 76, 14)}`, -6),
  // Hardened Base: a buried bunker dome, only its airlock showing.
  M4N242F: svg(`<path d="M40 126 A80 60 0 0 1 200 126 Z" fill="url(#stone)"/><path d="M100 126 L100 98 A20 20 0 0 1 140 98 L140 126 Z" fill="url(#hull)"/>
    ${box(108, 104, 24, 22, '#1d2433', 2)}${glow(120, 100, 6, 'warm')}${rod(160, 92, 172, 62, 1.5)}${glow(172, 60, 5, 'red')}`),
  // Classified Security Payload: a black payload, its markings redacted.
  M4N242R: svg(`${box(72, 52, 96, 50, '#16181d', 4)}${box(82, 62, 60, 7, '#000', 0)}${box(82, 76, 76, 7, '#000', 0)}${box(82, 90, 44, 7, '#000', 0)}
    <rect x="72" y="52" width="96" height="50" rx="4" fill="none" stroke="#5ee07a" stroke-width="1" opacity="0.6"/>${glow(160, 58, 5, 'green')}
    <text x="120" y="118" fill="#5ee07a" font-family="monospace" font-size="9" text-anchor="middle">REDACTED</text>`),
  // Rescue Team: a rescuer reaching out on a tether.
  M4N243F: svg(`<path d="M10 40 C 60 50, 100 70, 126 84" stroke="#ffd36b" stroke-width="1.5" fill="none"/>${figure(140, 134, 1.6, { pose: 'reach', visor: '#e2b13e' })}`),
  // Mercury Sunset Convoy: three crawlers in a line, chasing the sunset.
  M4N243R: svg(`${[[40, 1], [112, 1.1], [188, 0.9]].map(([x, k]) => `${box(x - 26 * k, 98 - 18 * k, 52 * k, 18 * k, 'url(#white)', 3)}${wing(x - 22 * k, 98 - 24 * k, 44 * k, 5 * k)}${wheel(x - 16 * k, 104, 6 * k)}${wheel(x + 16 * k, 104, 6 * k)}${win(x + 14 * k, 98 - 14 * k, 6 * k, 4 * k)}`).join('')}`),
  // Tsiolkovsky Elevator Lab: a climber riding the ribbon.
  M4N244F: svg(`${rod(150, 0, 90, 150, 3, '#cfd6e2')}<g transform="rotate(22 120 76)">${box(100, 50, 40, 52, 'url(#white)', 6)}${win(108, 60)}${win(118, 60)}${win(128, 60)}${wing(70, 66, 30, 14)}${wing(140, 66, 30, 14)}</g>`),
  // Skyhook: a spinning tether, a payload riding each end.
  M4N244R: svg(`<path d="M30 120 C 80 80, 160 60, 214 30" stroke="#cfd6e2" stroke-width="2" fill="none"/><path d="M38 110 A110 110 0 0 1 210 24" fill="none" stroke="#ffd36b" stroke-width="1" stroke-dasharray="4 4"/>
    ${box(22, 114, 18, 12, 'url(#white)', 2)}${box(206, 22, 18, 12, 'url(#white)', 2)}${ball(122, 70, 7)}`),
  // SWIV Miner: a mining truck towing its spherical tanks.
  M4N245F: svg(`${box(40, 84, 54, 26, 'url(#white)', 3)}${box(48, 72, 26, 14, 'url(#hull)', 2)}${rod(94, 100, 104, 100, 3)}${box(104, 94, 110, 12, 'url(#hull)', 2)}
    ${[124, 156, 188].map((x) => ball(x, 82, 15, 'url(#gold)')).join('')}${[56, 80, 120, 150, 186, 206].map((x) => wheel(x, 116, 7)).join('')}`),
  // Refueling Trawler: a trawler dangling its scoop net into the air below.
  M4N245R: svg(`${box(84, 40, 72, 24, 'url(#white)', 8)}${wing(44, 44, 40, 14)}${wing(156, 44, 40, 14)}
    ${rod(110, 64, 96, 124, 1)}${rod(130, 64, 144, 124, 1)}<path d="M92 124 L148 124 L138 140 L102 140 Z" fill="none" stroke="#cfd6e2" stroke-width="1.5"/>${Array.from({ length: 4 }, (_, i) => rod(98 + i * 14, 124, 104 + i * 10, 140, 0.8, '#cfd6e2')).join('')}`),
  // Cancer Research Mission: a lab with its glowing isotope cells.
  M4N246F: svg(`${box(84, 56, 72, 40, 'url(#white)', 4)}${[[100, 76], [120, 70], [140, 78]].map(([x, y]) => `${ball(x, y, 7, '#ff9a3d')}${glow(x, y, 14, 'warm')}`).join('')}${wing(40, 64, 44, 16)}${wing(156, 64, 44, 16)}`),
  // Trojan Listening Posts: a listening post, dish wide open.
  M4N246R: svg(`${dish(108, 64, 36, 14, -30)}${rod(108, 64, 134, 90, 2)}${box(126, 84, 30, 24, 'url(#hull)', 3)}${wing(156, 88, 40, 14)}${glow(150, 90, 4, 'red')}`),
  // Largest Object: a comet chaser behind its dust shield.
  M4N247F: svg(`${box(84, 40, 10, 72, 'url(#white)', 3)}${box(94, 62, 40, 28, 'url(#gold)', 2)}${wing(134, 50, 50, 14)}${wing(134, 88, 50, 14)}${Array.from({ length: 8 }, (_, i) => `<circle cx="${50 + (i % 3) * 10}" cy="${40 + i * 10}" r="1.5" fill="#ffcf9a"/>`).join('')}`),
  // Cyborg Transhumans: a Robonaut torso, gold visor, one arm raised.
  M4N247R: svg(`${box(90, 70, 60, 70, 'url(#white)', 10)}<circle cx="120" cy="52" r="20" fill="url(#white)"/><ellipse cx="122" cy="54" rx="15" ry="11" fill="url(#gold)"/>
    ${rod(94, 80, 66, 50, 10, 'url(#white)')}${rod(146, 80, 160, 120, 10, 'url(#white)')}${box(102, 92, 36, 16, '#2347a8', 3)}`),
  // Robotic Facility: an industrial arm at work over a lander deck.
  M4N248F: svg(`${box(60, 110, 120, 14, 'url(#hull)', 2)}${rod(90, 110, 110, 70, 7, 'url(#white)')}${rod(110, 70, 160, 60, 6, 'url(#white)')}${ball(110, 70, 6, 'url(#hull)')}
    ${rod(160, 60, 172, 76, 3)}${rod(160, 60, 176, 64, 3)}${glow(170, 74, 8, 'warm')}`),
  // Goo Spores: a cluster of frothy self-replicating spores.
  M4N248R: svg(`${[[80, 70, 22], [118, 56, 18], [150, 80, 24], [104, 100, 16], [176, 50, 12], [60, 104, 12]].map(([x, y, r]) => `${ball(x, y, r, 'url(#stone)')}${Array.from({ length: 5 }, (_, i) => `<circle cx="${f(x + Math.cos(i * 1.3) * r * 0.55)}" cy="${f(y + Math.sin(i * 1.3) * r * 0.55)}" r="${f(r * 0.22)}" fill="#e0e3e8" opacity="0.8"/>`).join('')}`).join('')}`),
  // Junket: the touring politician waving from a spacewalk.
  M4N249F: svg(`${figure(120, 140, 1.7, { pose: 'wave' })}<path d="M114 80 L120 96 L126 80 Z" fill="#c22"/>`),
  // Spaceborn Political Rally: a gold-helmed robot holding up its placard.
  M4N249R: svg(`${figure(110, 140, 1.6, { pose: 'hold', visor: 'url(#gold)' })}${rod(152, 108, 152, 40, 2, '#8a6a4a')}${box(124, 18, 76, 34, '#f4ead2', 2)}
    <text x="162" y="34" fill="#222" font-family="sans-serif" font-size="8" font-weight="700" text-anchor="middle">WE ARE</text><text x="162" y="45" fill="#222" font-family="sans-serif" font-size="8" font-weight="700" text-anchor="middle">PEOPLE TOO</text>`),
  // Fugitive: a WANTED poster - alive or decommissioned.
  M4N250F: svg(`<g transform="rotate(-4 120 76)">${box(62, 6, 116, 140, '#e8dcc0', 1)}
    <text x="120" y="34" fill="#a01818" font-family="serif" font-size="24" font-weight="900" text-anchor="middle">WANTED</text>
    ${box(80, 42, 80, 10, '#222', 0)}<text x="120" y="50" fill="#e8dcc0" font-family="serif" font-size="7" text-anchor="middle">ALIVE OR DECOMMISSIONED</text>
    <circle cx="120" cy="86" r="22" fill="#cfa79a" opacity="0.8"/><circle cx="120" cy="86" r="16" fill="#3a2a26" opacity="0.7"/>
    <text x="120" y="132" fill="#a01818" font-family="serif" font-size="12" font-weight="900" text-anchor="middle">REWARD</text></g>`),
  // Refugees: two settlers in worn suits, one kneeling.
  M4N250R: svg(`${figure(90, 140, 1.4, { pose: 'stand', suit: 'url(#stone)' })}${figure(156, 140, 1.3, { pose: 'kneel', suit: 'url(#stone)' })}${box(170, 120, 26, 18, 'url(#rust)', 2)}`),
  // Drug Smuggling: a dish of contraband crystals under a lens.
  M4N251F: svg(`<ellipse cx="120" cy="80" rx="70" ry="50" fill="#1d2433" opacity="0.6" stroke="#cfd6e2" stroke-width="2"/>
    ${Array.from({ length: 18 }, (_, i) => `<path d="M${60 + (i * 37) % 120} ${50 + (i * 23) % 60} l6 -4 l6 4 l-2 7 l-8 0 Z" fill="#f0e6c8" opacity="0.85"/>`).join('')}`),
  // Chipjack: an implant chip with its pink contact pins.
  M4N251R: svg(`${box(84, 50, 72, 52, '#1f2a24', 3)}${box(98, 62, 44, 28, '#2f6b4a', 2)}
    ${Array.from({ length: 7 }, (_, i) => `${box(88 + i * 10, 42, 4, 8, '#ff6fb0', 1)}${box(88 + i * 10, 102, 4, 8, '#ff6fb0', 1)}`).join('')}${glow(120, 76, 10, 'green')}`),
  // Green Magnetosphere: the L1 magnet coil throwing its field lines.
  M4N252F: svg(`${[22, 36, 52].map((r) => `<ellipse cx="120" cy="76" rx="${r * 2}" ry="${r}" fill="none" stroke="#3fe0ff" stroke-width="1.2" opacity="0.7"/>`).join('')}
    <ellipse cx="120" cy="76" rx="16" ry="30" fill="none" stroke="url(#gold)" stroke-width="7"/>${glow(120, 76, 16, 'cyan')}`),
  // Ice Phase Research: a drill rig, its ice core lifted out.
  M4N252R: svg(`${rod(96, 140, 120, 30, 3)}${rod(144, 140, 120, 30, 3)}${rod(104, 100, 136, 100, 2)}${rod(120, 30, 120, 132, 2, '#9aa3b2')}
    ${box(150, 96, 50, 12, 'url(#ice)', 6)}${box(40, 124, 50, 16, 'url(#hull)', 2)}`),
  // Atmospheric Iso-Refinery: an aerostat refinery trailing its scoop.
  M4N253F: svg(`<ellipse cx="120" cy="50" rx="56" ry="26" fill="url(#white)"/>${box(96, 76, 48, 20, 'url(#hull)', 3)}${win(104, 82)}${win(116, 82)}${win(128, 82)}
    ${rod(120, 96, 120, 136, 1.2, '#cfd6e2')}<path d="M110 136 L130 136 L126 146 L114 146 Z" fill="url(#metal)"/>`),
  // Isotope Fueling Station: a tanker easing into the fuel depot.
  M4N253R: svg(`${box(60, 50, 60, 44, 'url(#hull)', 4)}${ball(90, 50, 16, 'url(#metal)')}${ball(90, 94, 16, 'url(#metal)')}${rod(120, 72, 150, 72, 4)}
    ${box(150, 62, 56, 20, 'url(#white)', 8)}${bell(206, 72, 8, 12)}${glow(150, 72, 6, 'warm')}`),
  // Iso-Exchange: the depot's stacked isotope canisters.
  M4N254F: svg(`${Array.from({ length: 8 }, (_, i) => box(70 + (i % 4) * 26, 50 + Math.floor(i / 4) * 40, 22, 36, 'url(#rust)', 8)).join('')}${rod(64, 46, 176, 46, 3)}${rod(64, 130, 176, 130, 3)}`),
  // Rival Isobank: the black vault sphere inside its ring.
  M4N254R: svg(`${ball(120, 76, 30, 'url(#hull)')}<ellipse cx="120" cy="76" rx="58" ry="12" fill="none" stroke="url(#metal)" stroke-width="5"/>${box(106, 40, 28, 8, '#c22', 2)}${glow(120, 76, 6, 'red')}`, -10),
  // TW Stress Test: a torch ship's long spine, drive blazing.
  M4N255F: svg(`${rod(20, 120, 190, 40, 6, 'url(#metal)')}${Array.from({ length: 6 }, (_, i) => box(40 + i * 24, 102 - i * 11, 12, 12, 'url(#hull)', 2)).join('')}
    ${box(186, 32, 18, 14, 'url(#white)', 3)}${glow(20, 122, 26, 'warm')}`),
  // TW Evaluation Committee: a cluster of test nozzles, a shuttle watching.
  M4N255R: svg(`${[[80, 70], [120, 60], [160, 70], [100, 104], [140, 104]].map(([x, y]) => `<path d="M${x - 14} ${y - 18} L${x + 14} ${y - 18} L${x + 20} ${y + 18} L${x - 20} ${y + 18} Z" fill="url(#hull)"/><ellipse cx="${x}" cy="${y + 18}" rx="20" ry="5" fill="#1d2433"/>`).join('')}
    <path d="M196 30 L222 26 L224 32 Z" fill="url(#white)"/>`),
  // Life Support Reconfig Team: a starship hab ring with its arrays.
  M4N256F: svg(`${rod(40, 76, 200, 76, 4)}<ellipse cx="120" cy="76" rx="14" ry="40" fill="none" stroke="url(#white)" stroke-width="8"/>${box(70, 66, 36, 20, 'url(#white)', 6)}
    ${wing(150, 40, 36, 14)}${wing(150, 98, 36, 14)}${Array.from({ length: 6 }, (_, i) => rod(114, 40 + i * 14, 126, 40 + i * 14, 1, '#ffe2a0')).join('')}`),
  // Life Support Test Protocol: the test module on its long solar wings.
  M4N256R: svg(`${wing(16, 40, 80, 18, 0, 20)}${box(98, 64, 60, 26, 'url(#white)', 10)}${box(158, 70, 24, 14, 'url(#metal)', 3)}${win(108, 72)}${win(118, 72)}${win(128, 72)}${glow(184, 77, 8)}`, -12),
  // Radiation Shield Prototype: a water-walled ship inside its field bubble.
  M4N257F: svg(`<ellipse cx="120" cy="76" rx="76" ry="40" fill="url(#cyan)" opacity="0.35"/>${box(70, 64, 100, 24, 'url(#ice)', 12)}${box(170, 70, 22, 12, 'url(#metal)', 3)}${bell(192, 76, 8, 12)}${glow(204, 76, 10, 'warm')}`, -8),
  // Warden Proving Ground: little autonomous rockets landing on the rock.
  M4N257R: svg(`${[[70, 60, -14], [130, 40, 8], [182, 76, 20]].map(([x, y, r]) => `<g transform="rotate(${r} ${x} ${y})">${box(x - 5, y - 18, 10, 30, 'url(#white)', 4)}<path d="M${x - 5} ${y - 18} L${x} ${y - 28} L${x + 5} ${y - 18} Z" fill="url(#white)"/>${rod(x - 5, y + 10, x - 10, y + 18, 1.5)}${rod(x + 5, y + 10, x + 10, y + 18, 1.5)}${glow(x, y + 16, 8, 'warm')}</g>`).join('')}`),
  // Deep Freeze: a cryopod, its sleeper under the frosted lid.
  M4N258F: svg(`<g transform="rotate(-10 120 80)">${box(44, 62, 152, 40, 'url(#white)', 20)}<rect x="58" y="66" width="124" height="22" rx="11" fill="url(#ice)"/>
    <ellipse cx="80" cy="77" rx="8" ry="7" fill="#e8c4b0" opacity="0.8"/><path d="M90 74 L170 74 L170 82 L90 82 Z" fill="#cfe6ff" opacity="0.8"/>${glow(120, 100, 20, 'cyan')}</g>`),
  // Decanting Network: a decanting pod open, its colonist stepping out.
  M4N258R: svg(`${box(132, 22, 52, 118, 'url(#white)', 18)}<rect x="140" y="32" width="36" height="96" rx="14" fill="url(#ice)" opacity="0.7"/>${glow(158, 80, 30, 'cyan')}
    ${figure(96, 140, 1.4, { pose: 'reach', suit: '#f4f4f6', visor: '#e8c4b0', pack: false })}`),
};

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(OUT, { recursive: true });
  for (const name of readdirSync(OUT)) if (name.endsWith('.svg') && !ART[name.slice(0, -4)]) unlinkSync(join(OUT, name));
  for (const [code, text] of Object.entries(ART)) writeFileSync(join(OUT, `${code}.svg`), text);
  console.log(`wrote ${Object.keys(ART).length} card foregrounds to assets/cards/contracts/craft/`);
}
export const CONTRACT_ART_CODES = Object.keys(ART);
