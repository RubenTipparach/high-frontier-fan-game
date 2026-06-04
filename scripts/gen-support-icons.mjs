// Generates the support / requirement glyph SVGs (a coloured category circle
// + a custom white glyph) into assets/support-icons/, plus a contact-sheet
// SVG for review. Run: node scripts/gen-support-icons.mjs
//
// Categories (per the request): reactor = purple, generator = orange,
// radiator = blue, robonaut = card fuchsia. NOT yet wired into card-ui.js - this is
// the review pass.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'support-icons');
mkdirSync(OUT, { recursive: true });

const CAT = {
  reactor:   { fill: '#8b5cf6', ring: '#6d28d9', name: 'Reactor (purple)' },
  generator: { fill: '#f97316', ring: '#c2410c', name: 'Generator (orange)' },
  radiator:  { fill: '#3b82f6', ring: '#1d4ed8', name: 'Radiator (blue)' },
  robonaut:  { fill: '#d946ef', ring: '#a21caf', name: 'Robonaut (card fuchsia)' },
};

const rad = (d) => (d * Math.PI) / 180;
const pt = (r, a, cx = 16, cy = 16) =>
  `${(cx + r * Math.cos(rad(a))).toFixed(2)} ${(cy + r * Math.sin(rad(a))).toFixed(2)}`;

// Radioactive trefoil: central disc + three 60deg blades at 60deg gaps.
function trefoil() {
  const ri = 3.2, ro = 13;
  let blades = '';
  for (const a0 of [-90, 30, 150]) {
    const a1 = a0 - 30, a2 = a0 + 30;
    blades += `<path d="M ${pt(ri, a1)} L ${pt(ro, a1)} A ${ro} ${ro} 0 0 1 ${pt(ro, a2)} `
      + `L ${pt(ri, a2)} A ${ri} ${ri} 0 0 0 ${pt(ri, a1)} Z" fill="#fff"/>`;
  }
  return `${blades}<circle cx="16" cy="16" r="3.2" fill="#fff"/>`;
}

// Each glyph = the white inner shapes over the category circle.
const GLYPH = {
  // ---- Reactor (purple) ----
  'reactor-fission': () => `
    <line x1="10.5" y1="10.5" x2="21.5" y2="21.5" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>
    <line x1="21.5" y1="10.5" x2="10.5" y2="21.5" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>
    <circle cx="16" cy="16" r="2.5" fill="#fff"/>`,
  'reactor-fusion': () => `
    <path d="M5.5 16 C 7.7 9.6, 10.3 9.6, 12.5 16 C 14.7 22.4, 17.3 22.4, 19.5 16 C 21.7 9.6, 24.3 9.6, 26.5 16"
          fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>`,
  'reactor-antimatter': () => `
    <g stroke="#fff" stroke-width="2.1" stroke-linecap="round">
      <line x1="16" y1="6.5" x2="16" y2="25.5"/>
      <line x1="6.5" y1="16" x2="25.5" y2="16"/>
      <line x1="9.4" y1="9.4" x2="22.6" y2="22.6"/>
      <line x1="22.6" y1="9.4" x2="9.4" y2="22.6"/>
    </g>
    <circle cx="16" cy="16" r="3.2" fill="#8b5cf6"/>
    <circle cx="16" cy="16" r="3.2" fill="none" stroke="#fff" stroke-width="1.8"/>`,
  // ---- Generator (orange) ----  (published markers: ⟛ and E)
  'gen-radioisotope': () => `
    <text x="18.5" y="22" text-anchor="middle"
          fill="#fff" font-family="DejaVu Sans, sans-serif" font-size="21" font-weight="700">⟛</text>`,
  'gen-electric': () => `
    <g fill="#fff">
      <rect x="11" y="8.5" width="2.6" height="15" rx="0.6"/>
      <rect x="11" y="8.5" width="9.6" height="2.6" rx="0.6"/>
      <rect x="11" y="14.7" width="7.6" height="2.4" rx="0.6"/>
      <rect x="11" y="20.9" width="9.6" height="2.6" rx="0.6"/>
    </g>`,
  // ---- Radiator (blue) ----  (therms / cooling)
  'thermostat': () => `
    <path d="M13.6 7.2 a2.4 2.4 0 0 1 4.8 0 v9.8 a4 4 0 1 1 -4.8 0 Z"
          fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="16" cy="21.4" r="2.7" fill="#fff"/>
    <rect x="15.1" y="11" width="1.8" height="9.5" rx="0.9" fill="#fff"/>`,
  // ---- Robonaut (card fuchsia) ----
  'missile': () => `
    <path d="M16 4.8 C 19.2 9, 19.2 14, 16 18 C 12.8 14, 12.8 9, 16 4.8 Z" fill="#fff"/>
    <path d="M13.4 14.5 L10.6 19 L13.4 17.3 Z" fill="#fff"/>
    <path d="M18.6 14.5 L21.4 19 L18.6 17.3 Z" fill="#fff"/>
    <circle cx="16" cy="10.5" r="1.5" fill="#a21caf"/>
    <path d="M14.7 18 L16 23.5 L17.3 18 Z" fill="#fff" opacity="0.9"/>`,
  'raygun': () => `
    <path d="M7 13 H19 V15.8 H13.6 L11.8 21 H8.6 L10.4 15.8 H7 Z" fill="#fff"/>
    <rect x="19" y="13.2" width="3.4" height="2.4" fill="#fff"/>
    <g fill="#fff"><circle cx="24.6" cy="14.4" r="1.05"/><circle cx="27.4" cy="14.4" r="0.8"/></g>`,
  'buggy': () => `
    <rect x="8.5" y="13" width="15" height="5" rx="1.6" fill="#fff"/>
    <rect x="12" y="10.3" width="6.4" height="3.2" rx="1" fill="#fff"/>
    <circle cx="12" cy="20" r="2.7" fill="#fff"/>
    <circle cx="20" cy="20" r="2.7" fill="#fff"/>
    <circle cx="12" cy="20" r="1.05" fill="#a21caf"/>
    <circle cx="20" cy="20" r="1.05" fill="#a21caf"/>
    <line x1="22.2" y1="13" x2="25.4" y2="7.6" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>
    <circle cx="25.4" cy="7.6" r="1.1" fill="#fff"/>`,
};

// Which category each kind belongs to.
const KIND_CAT = {
  'reactor-fission': 'reactor', 'reactor-fusion': 'reactor',
  'reactor-antimatter': 'reactor',
  'gen-radioisotope': 'generator', 'gen-electric': 'generator',
  'thermostat': 'radiator',
  'missile': 'robonaut', 'raygun': 'robonaut', 'buggy': 'robonaut',
};
const LABEL = {
  'reactor-fission': 'Fission  (was X)',
  'reactor-fusion': 'Fusion  (was ∿)',
  'reactor-antimatter': 'Antimatter  (was 💣)',
  'gen-radioisotope': 'Radioisotope  (⟛)',
  'gen-electric': 'Electric  (E)',
  'thermostat': 'Radiator therms  (was 🌡)',
  'missile': 'Missile  (was 🚀)',
  'raygun': 'Raygun  (was 🔫)',
  'buggy': 'Buggy  (was 🛺)',
};

// One glyph as a standalone 32x32 SVG. The gradient id is per-kind so many
// icons can be inlined into one contact sheet without id collisions.
function iconSvg(kind) {
  const c = CAT[KIND_CAT[kind]];
  const gid = `grad-${kind}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <defs><radialGradient id="${gid}" cx="36%" cy="30%" r="72%">
    <stop offset="0%" stop-color="${c.fill}" stop-opacity="1"/>
    <stop offset="70%" stop-color="${c.fill}"/>
    <stop offset="100%" stop-color="${c.ring}"/>
  </radialGradient></defs>
  <circle cx="16" cy="16" r="15" fill="url(#${gid})" stroke="${c.ring}" stroke-width="1.5"/>
  <path d="M16 2.5 a13.5 13.5 0 0 1 11 5.6" fill="none" stroke="#fff" stroke-opacity="0.4" stroke-width="2" stroke-linecap="round"/>
  ${GLYPH[kind]()}
</svg>`;
}

// Write the individual SVGs.
const kinds = Object.keys(GLYPH);
for (const k of kinds) writeFileSync(join(OUT, `${k}.svg`), iconSvg(k) + '\n');
console.log(`wrote ${kinds.length} svgs to assets/support-icons/`);

// Contact sheet: rows grouped by category, each glyph at 58px + label.
const cats = ['reactor', 'generator', 'radiator', 'robonaut'];
const COL_W = 230, ICON = 58, ROW_H = 86, PAD = 24, HEAD = 30;
let maxCols = 0;
for (const cat of cats) maxCols = Math.max(maxCols, kinds.filter((k) => KIND_CAT[k] === cat).length);
const W = PAD * 2 + maxCols * COL_W;
let y = PAD;
let body = '';
for (const cat of cats) {
  body += `<text x="${PAD}" y="${y + 18}" fill="#cbd5e1" font-family="sans-serif" font-size="16" font-weight="700">${CAT[cat].name}</text>`;
  y += HEAD;
  let x = PAD;
  for (const k of kinds.filter((kk) => KIND_CAT[kk] === cat)) {
    body += `<g transform="translate(${x}, ${y})">`
      + `<g transform="translate(0,0) scale(${ICON / 32})">${iconSvg(k).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</g>`
      + `<text x="${ICON + 12}" y="${ICON / 2 + 5}" fill="#e6e9ff" font-family="sans-serif" font-size="14">${LABEL[k]}</text>`
      + `</g>`;
    x += COL_W;
  }
  y += ROW_H;
}
const H = y + PAD;
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#0c0a16"/>
  <text x="${PAD}" y="${PAD - 4}" fill="#7dd3fc" font-family="sans-serif" font-size="13">Support / requirement glyphs - REVIEW (not yet applied)</text>
  ${body}
</svg>`;
writeFileSync(join(OUT, '_contact-sheet.svg'), sheet + '\n');
console.log('wrote assets/support-icons/_contact-sheet.svg');
