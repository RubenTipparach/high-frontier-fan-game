// Generates the support / requirement glyph SVGs into assets/support-icons/,
// plus a contact-sheet SVG for review. Run: node scripts/gen-support-icons.mjs
//
// Per the request (flat fills, no gradients):
//   reactor   = PURPLE SQUARE, white glyph
//   generator = ORANGE CIRCLE, white glyph
//   radiator  = BLUE thermometer(s) on a WHITE rounded badge; ×N therms is
//               drawn as N thermometers (🌡🌡🌡)
//   robonaut  = BLACK circle, PINK glyph (the game's robonaut pink)
// NOT yet wired into card-ui.js - this is the review pass.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'support-icons');
mkdirSync(OUT, { recursive: true });

const THERM_BLUE = '#2563eb';
const ROBO_PINK = '#f9a8d4';

// shape: 'square' | 'circle'. ink: glyph colour. fill/ring: flat coin colours.
const CAT = {
  reactor:   { shape: 'square', fill: '#8b5cf6', ring: '#6d28d9', ink: '#ffffff', name: 'Reactor (purple square)' },
  generator: { shape: 'circle', fill: '#f97316', ring: '#c2410c', ink: '#ffffff', name: 'Generator (orange circle)' },
  robonaut:  { shape: 'square', fill: '#0c0a16', ring: '#be185d', ink: ROBO_PINK, name: 'Robonaut (black + pink square)' },
};

// Glyphs use currentColor (set per category) + "__HOLE__" for negative space.
const GLYPH = {
  'reactor-fission': () => `
    <line x1="10.5" y1="10.5" x2="21.5" y2="21.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
    <line x1="21.5" y1="10.5" x2="10.5" y2="21.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
    <circle cx="16" cy="16" r="2.5" fill="currentColor"/>`,
  'reactor-fusion': () => `
    <path d="M5.5 16 C 7.7 9.6, 10.3 9.6, 12.5 16 C 14.7 22.4, 17.3 22.4, 19.5 16 C 21.7 9.6, 24.3 9.6, 26.5 16"
          fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`,
  'reactor-antimatter': () => `
    <circle cx="14.5" cy="19" r="7" fill="currentColor"/>
    <path d="M16.6 12.1 L19.5 9.2 L21.8 11.5 L18.9 14.4 Z" fill="currentColor"/>
    <path d="M20.7 10.5 Q 24 8.4, 23 4.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
    <g stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
      <line x1="23" y1="4.6" x2="23" y2="2.3"/>
      <line x1="23" y1="4.6" x2="25" y2="3.5"/>
      <line x1="23" y1="4.6" x2="21" y2="3.5"/>
    </g>
    <circle cx="11.8" cy="16.4" r="1.7" fill="__HOLE__" opacity="0.5"/>`,
  'gen-radioisotope': () => `
    <g fill="currentColor">
      <rect x="13.4" y="10.5" width="2.2" height="11" rx="0.4"/>
      <rect x="16.4" y="10.5" width="2.2" height="11" rx="0.4"/>
    </g>
    <g stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
      <line x1="7" y1="16" x2="13.4" y2="16"/>
      <line x1="18.6" y1="16" x2="25" y2="16"/>
    </g>`,
  'gen-electric': () => `
    <path d="M 20.8 19.9 A 6 6 0 1 1 21.9 16 L 10.1 16"
          fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  'missile': () => `
    <path d="M16 3.5 L19.3 11 L12.7 11 Z" fill="currentColor"/>
    <rect x="12.7" y="10.5" width="6.6" height="10.5" rx="0.7" fill="currentColor"/>
    <path d="M12.7 16 L8.6 22 L12.7 20.2 Z" fill="currentColor"/>
    <path d="M19.3 16 L23.4 22 L19.3 20.2 Z" fill="currentColor"/>
    <path d="M14.1 20.8 L16 25.8 L17.9 20.8 Z" fill="currentColor" opacity="0.85"/>
    <rect x="12.7" y="13.6" width="6.6" height="1.5" fill="__HOLE__"/>`,
  'raygun': () => `
    <path d="M7 13 H19 V15.8 H13.6 L11.8 21 H8.6 L10.4 15.8 H7 Z" fill="currentColor"/>
    <rect x="19" y="13.2" width="3.4" height="2.4" fill="currentColor"/>
    <g fill="currentColor"><circle cx="24.6" cy="14.4" r="1.05"/><circle cx="27.4" cy="14.4" r="0.8"/></g>`,
  'buggy': () => `
    <rect x="8.5" y="13" width="15" height="5" rx="1.6" fill="currentColor"/>
    <rect x="12" y="10.3" width="6.4" height="3.2" rx="1" fill="currentColor"/>
    <circle cx="12" cy="20" r="2.7" fill="currentColor"/>
    <circle cx="20" cy="20" r="2.7" fill="currentColor"/>
    <circle cx="12" cy="20" r="1.05" fill="__HOLE__"/>
    <circle cx="20" cy="20" r="1.05" fill="__HOLE__"/>
    <line x1="22.2" y1="13" x2="25.4" y2="7.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    <circle cx="25.4" cy="7.6" r="1.1" fill="currentColor"/>`,
};

const KIND_CAT = {
  'reactor-fission': 'reactor', 'reactor-fusion': 'reactor', 'reactor-antimatter': 'reactor',
  'gen-radioisotope': 'generator', 'gen-electric': 'generator',
  'missile': 'robonaut', 'raygun': 'robonaut', 'buggy': 'robonaut',
};

// Reactor / generator / robonaut: a flat 32x32 square or circle + glyph.
function iconSvg(kind) {
  const c = CAT[KIND_CAT[kind]];
  const body = c.shape === 'square'
    ? `<rect x="1.5" y="1.5" width="29" height="29" rx="7" fill="${c.fill}" stroke="${c.ring}" stroke-width="1.5"/>`
    : `<circle cx="16" cy="16" r="15" fill="${c.fill}" stroke="${c.ring}" stroke-width="1.5"/>`;
  const glyph = GLYPH[kind]().replaceAll('__HOLE__', c.fill);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  ${body}
  <g color="${c.ink}">${glyph}</g>
</svg>`;
}

// One blue thermometer centred at x (32-tall coords).
function thermo(cx) {
  return `
    <path d="M${cx - 2.2} 9 a2.2 2.2 0 0 1 4.4 0 v8.6 a3.6 3.6 0 1 1 -4.4 0 Z"
          fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    <circle cx="${cx}" cy="21.6" r="2.4" fill="currentColor"/>
    <rect x="${cx - 0.8}" y="12.4" width="1.6" height="8.6" rx="0.8" fill="currentColor"/>`;
}

// Radiator therms: N blue thermometers on a WHITE rounded badge (the
// readable backing the cards use). Variable width SVG (0 0 W 32).
function thermBadgeSvg(n) {
  const slot = 13, w = n * slot + 8;
  let therms = '';
  for (let i = 0; i < n; i++) therms += thermo(4 + slot * i + slot / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 32" width="${w}" height="32">
  <rect x="1" y="3" width="${w - 2}" height="26" rx="9" fill="#ffffff" stroke="${THERM_BLUE}" stroke-width="1.2"/>
  <g color="${THERM_BLUE}">${therms}</g>
</svg>`;
}

// Write the reactor/generator/robonaut svgs + the single-therm thermostat.
const kinds = Object.keys(GLYPH);
for (const k of kinds) writeFileSync(join(OUT, `${k}.svg`), iconSvg(k) + '\n');
writeFileSync(join(OUT, 'thermostat.svg'), thermBadgeSvg(1) + '\n');
console.log(`wrote ${kinds.length + 1} svgs to assets/support-icons/`);

// ---- Contact sheet ----
const stripSvg = (s) => s.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
const ICON = 58, ROW_H = 88, PAD = 24, HEAD = 30, COL_W = 250;
const rows = [
  { name: CAT.reactor.name, items: ['reactor-fission', 'reactor-fusion', 'reactor-antimatter'].map((k) => ({ svg: iconSvg(k), w: ICON, label: LBL(k) })) },
  { name: CAT.generator.name, items: ['gen-radioisotope', 'gen-electric'].map((k) => ({ svg: iconSvg(k), w: ICON, label: LBL(k) })) },
  { name: 'Radiator (blue therms on white badge)', items: [1, 2, 3].map((n) => ({ svg: thermBadgeSvg(n), w: (n * 13 + 8) * (ICON / 32), label: `${n} therm${n === 1 ? '' : 's'}` })) },
  { name: CAT.robonaut.name, items: ['missile', 'raygun', 'buggy'].map((k) => ({ svg: iconSvg(k), w: ICON, label: LBL(k) })) },
];
function LBL(k) {
  return ({
    'reactor-fission': 'Fission (was X)', 'reactor-fusion': 'Fusion (∿)', 'reactor-antimatter': 'Antimatter (was 💣)',
    'gen-radioisotope': 'Radioisotope (⟛)', 'gen-electric': 'Electric (e)',
    'missile': 'Missile', 'raygun': 'Raygun', 'buggy': 'Buggy',
  })[k];
}
let y = PAD, body = '';
for (const row of rows) {
  body += `<text x="${PAD}" y="${y + 18}" fill="#cbd5e1" font-family="sans-serif" font-size="16" font-weight="700">${row.name}</text>`;
  y += HEAD;
  let x = PAD;
  for (const it of row.items) {
    body += `<g transform="translate(${x}, ${y})"><g transform="scale(${ICON / 32})">${stripSvg(it.svg)}</g>`
      + `<text x="${it.w + 12}" y="${ICON / 2 + 5}" fill="#e6e9ff" font-family="sans-serif" font-size="14">${it.label}</text></g>`;
    x += Math.max(COL_W, it.w + 120);
  }
  y += ROW_H;
}
const W = 980, H = y + PAD;
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#0c0a16"/>
  <text x="${PAD}" y="${PAD - 4}" fill="#7dd3fc" font-family="sans-serif" font-size="13">Support / requirement glyphs - REVIEW (not yet applied)</text>
  ${body}
</svg>`;
writeFileSync(join(OUT, '_contact-sheet.svg'), sheet + '\n');
console.log('wrote assets/support-icons/_contact-sheet.svg');
