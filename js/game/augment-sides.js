// Module 4 augmentation chit SIDES (4C3). Each of the six chits is two-sided,
// and each side carries its own picture: the chit's white shape in the corner
// and the side's ability as a pictogram, drawn in the game's existing glyph
// language (the support coins for raygun / buggy / pulse / X exotic, the
// water droplet, the hazard skull). Pure SVG strings, no DOM.
import { supportIconSvg } from './support-icons.js';
import { AUGMENTS } from './contract-glyphs.js';

const SHAPE_PATH = {
  heart: '<path d="M12 21.2C6.6 17.6 2.2 13.6 2.2 8.9 2.2 5.9 4.5 3.6 7.4 3.6c1.9 0 3.6 1 4.6 2.6 1-1.6 2.7-2.6 4.6-2.6 2.9 0 5.2 2.3 5.2 5.3 0 4.7-4.4 8.7-9.8 12.3z"/>',
  jar: '<path d="M8.2 2.4h7.6v3.1H8.2z"/><path d="M7.4 5.5h9.2c.6 0 1 .4 1 1v.8c1 .7 1.6 1.8 1.6 3V20c0 1-.8 1.8-1.8 1.8H6.6c-1 0-1.8-.8-1.8-1.8v-9.7c0-1.2.6-2.3 1.6-3v-.8c0-.6.4-1 1-1z"/>',
  triangle: '<path d="M12 3.2 21.6 20H2.4z" stroke-linejoin="round"/>',
  hexagon: '<path d="M7 3.6h10l5 8.4-5 8.4H7L2 12z" stroke-linejoin="round"/>',
  splat: '<path d="M12 2.4c1.3 0 2 1.4 3.2 1.3 1.4-.1 2.1-1.5 3.5-.9 1.3.6.7 2.3 1.6 3.3.9 1 2.6.7 3 2 .4 1.4-1.1 2.1-1 3.5.1 1.3 1.6 2 1.2 3.4-.4 1.3-2 1.2-2.7 2.2-.8 1.1-.3 2.7-1.5 3.4-1.2.7-2.4-.5-3.7-.3-1.3.2-2 1.8-3.4 1.6-1.4-.2-1.6-1.8-2.8-2.4-1.2-.6-2.9 0-3.6-1.2-.7-1.2.6-2.4.4-3.7-.2-1.3-1.8-2-1.5-3.4.3-1.4 2-1.4 2.6-2.6.6-1.2-.2-2.8.9-3.6 1.1-.8 2.5.2 3.8-.2C10 3.6 10.7 2.4 12 2.4z"/>',
  battery: '<path d="M2.6 7.4h18.8v12.4H2.6z"/><path d="M5.4 4.2h4.2v3.2H5.4zM14.4 4.2h4.2v3.2h-4.2z"/>',
};

const AQUA = '#38bdf8';
const ISO_GOLD = '#e0aa2c';
const drop = (x, y, s, fill = AQUA, stroke = '#0b1220') => `<path transform="translate(${x} ${y}) scale(${s})" d="M0 -9 C 4 -3, 6.5 0.5, 6.5 3.4 A 6.5 6.5 0 0 1 -6.5 3.4 C -6.5 0.5, -4 -3, 0 -9 Z" fill="${fill}" stroke="${stroke}" stroke-width="0.8"/>`;
// A number written inside a drop.
const inDrop = (x, y, t) => `<text x="${x}" y="${y}" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="800" font-size="9.5" fill="#fff" stroke="#0b1220" stroke-width="1.5" paint-order="stroke">${t}</text>`;
const INK = '#1f2937';
const label = (x, y, t, size = 9, fill = INK, stroke = '#fff') => `<text x="${x}" y="${y}" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="${size}" fill="${fill}" stroke="${stroke}" stroke-width="2.2" paint-order="stroke">${t}</text>`;
// An embedded support coin (raygun, buggy, pulse, X exotic), placed at x,y.
const coin = (kind, x, y, s) => {
  const svg = supportIconSvg(kind, { size: 32, cls: '' }) || '';
  const inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  return `<g transform="translate(${x} ${y}) scale(${s})">${inner}</g>`;
};

// The grey "ISRU: N" chip a robonaut card shows beside its prospector coin.
const isruChip = (x, y, n) => `<g transform="translate(${x} ${y})"><rect x="0" y="-8" width="19" height="16" rx="1.6" fill="#6b6f78" stroke="#4b5563" stroke-width="0.6"/>
  <text x="2" y="-1" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="5.2" fill="#f1f5f9">ISRU:</text>
  <text x="9.5" y="6.4" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="800" font-size="8.5" fill="#f1f5f9">${n}</text></g>`;

// The pictogram for each side, drawn in a 48 x 48 box (centre ~ 26,28).
const PICT = {
  heart: {
    // Parenthood: an adult and a child.
    1: `<g fill="${INK}">
          <circle cx="20" cy="17" r="4.4"/><path d="M13 36 Q13 23 20 23 Q27 23 27 36 Z"/>
          <circle cx="32.5" cy="24" r="3.2"/><path d="M27.6 37 Q27.6 29 32.5 29 Q37.4 29 37.4 37 Z"/></g>`,
    // +1 delegate move: a delegate cube and an arrow.
    2: `<g stroke="#0b1220" stroke-width="0.9" stroke-linejoin="round">
          <path d="M13 22 L21 18 L29 22 L21 26 Z" fill="#e5e7eb"/><path d="M13 22 V31 L21 35 V26 Z" fill="#9ca3af"/><path d="M29 22 V31 L21 35 V26 Z" fill="#cbd5e1"/></g>
        <path d="M30 30 H40 M36 26 L40 30 L36 34" fill="none" stroke="#d97706" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
        ${label(35, 22, '+1', 9, '#b45309')}`,
  },
  jar: {
    // This Colonist is 0 Mass: a weight with a 0.
    1: `<path d="M17 20 H33 L37 37 H13 Z" fill="#9ca3af" stroke="#0b1220" stroke-width="0.9" stroke-linejoin="round"/>
        <circle cx="25" cy="17" r="3.3" fill="none" stroke="#9ca3af" stroke-width="2.2"/>
        ${label(25, 34, '0', 13, '#fff', INK)}`,
    // FTs may be spent for FINAO: the blue FT oval over "pays FINAO", after the
    // original chit (owner approved 2026-11-19).
    2: `<ellipse cx="25" cy="17" rx="12.5" ry="6.4" fill="#0ea5e9"/><text x="25" y="21.2" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="900" font-size="11.5" fill="#0b1220">FT</text><text x="25" y="32" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="8.5" fill="#0b1220">pays</text><text x="25" y="42" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="900" font-size="9.5" fill="#0b1220">FINAO</text>`,
  },
  hexagon: {
    // The robonaut card's read (owner approved 2026-11-19): the prospector coin
    // and a grey "ISRU: N" chip beside it.
    1: `${coin('raygun', 6, 19, 0.56)}${isruChip(25, 28, 1)}`,
    2: `${coin('buggy', 6, 19, 0.56)}${isruChip(25, 28, 2)}`,
  },
  splat: {
    // Factory is also Carbon: the card's black spectral hexagon with a white C
    // (owner pick B, 2026-11-19).
    1: `<polygon points="43.40,28.45 37.40,38.84 25.40,38.84 19.40,28.45 25.40,18.06 37.40,18.06" fill="#0c0a16" stroke="#1f1b2e" stroke-width="0.8"/>
        <text x="31.4" y="33.49" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="13.8" fill="#fff">C</text>`,
    // +1 Hydration: the black hexagon with +1 and a small drop (after the
    // original chit; owner approved 2026-11-19).
    2: `<polygon points="48.40,28.45 39.90,43.17 22.90,43.17 14.40,28.45 22.90,13.73 39.90,13.73" fill="#0c0a16"/><text x="27.4" y="33" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="800" font-size="11.5" fill="#fff">+1</text><path transform="translate(39.4 30.2) scale(0.62)" d="M0 -9 C 4 -3, 6.5 0.5, 6.5 3.4 A 6.5 6.5 0 0 1 -6.5 3.4 C -6.5 0.5, -4 -3, 0 -9 Z" fill="#38bdf8"/>`,
  },
  battery: {
    // On-board pulse generator: the pulse generator coin (owner 2026-11-19).
    1: coin('gen-radioisotope', 11, 12, 0.9),
    // On-board exotic reactor: the X exotic reactor coin.
    2: coin('reactor-fission', 11, 12, 0.9),
  },
  triangle: {
    // Site refuel yields +1 Isotope: the gold isotope drop (as on a GW thruster),
    // +1 inside it (owner 2026-11-19).
    1: `${drop(24, 24.5, 1.8, ISO_GOLD, '#a8761a')}${inDrop(24, 34, '+1')}`,
    // Site refuel yields +2 Aqua: the water drop, +2 inside it.
    2: `${drop(24, 24.5, 1.8)}${inDrop(24, 34, '+2')}`,
  },
};

// Where the picture sits inside each shape (the shape fills the 48 box): the
// centre and the scale of the 48-box pictogram.
const FIT = {
  heart: { cx: 24, cy: 21, k: 0.7 },
  jar: { cx: 24, cy: 29, k: 0.62 },
  hexagon: { cx: 24, cy: 24, k: 0.72 },
  splat: { cx: 24, cy: 24, k: 0.66 },
  battery: { cx: 24, cy: 27.5, k: 0.62 },
  triangle: { cx: 24, cy: 31, k: 0.6 },
};

// "Jar, side 1: This Colonist is 0 Mass."
export function augmentSideTip(shape, side) {
  const a = AUGMENTS[shape];
  if (!a) return '';
  const t = ((a.tip || '').split(' / ')[side - 1] || '').trim();
  return `${a.name}, side ${side}: ${t}`;
}

// One side of a chit: the chit IS its white shape (as the Cybernetics icons
// print on a contract), with the side's ability drawn inside it.
export function augmentSideSvg(shape, side, { size = 48, title = true } = {}) {
  const a = AUGMENTS[shape];
  if (!a || !PICT[shape]) return '';
  const tip = ((a.tip || '').split(' / ')[side - 1] || '').trim();
  const f = FIT[shape];
  return `<svg class="m4-aug-side" viewBox="0 0 48 48" width="${size}" height="${size}" role="img" aria-label="${a.name} side ${side}: ${tip}">`
    + (title ? `<title>${a.name} side ${side}: ${tip}</title>` : '')
    + `<g transform="scale(2)" fill="#f8fafc" stroke="#111" stroke-width="0.7" stroke-linejoin="round">${SHAPE_PATH[shape]}</g>`
    + `<g transform="translate(${f.cx} ${f.cy}) scale(${f.k}) translate(-25 -28)">${PICT[shape][side]}</g>`
    + `</svg>`;
}
