// Writes the support-icon SVGs to assets/support-icons/ + a review contact
// sheet, using the SHARED builders in js/game/support-icons.js (the same
// source the card UI renders from). Run: node scripts/gen-support-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPPORT_KIND_CAT, supportIconSvg, thermBadgeSvg, typeIconSvg } from '../js/game/support-icons.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'support-icons');
mkdirSync(OUT, { recursive: true });

const opt = { size: 32, cls: '' };   // clean, classless 32x32 asset files
const kinds = Object.keys(SUPPORT_KIND_CAT);
for (const k of kinds) writeFileSync(join(OUT, `${k}.svg`), supportIconSvg(k, opt) + '\n');
writeFileSync(join(OUT, 'thermostat.svg'), thermBadgeSvg(1, opt) + '\n');
// Card-type header icons (thruster / refinery / generic robonaut).
const types = ['thruster', 'refinery', 'robonaut'];
for (const t of types) writeFileSync(join(OUT, `type-${t}.svg`), typeIconSvg(t, opt) + '\n');
console.log(`wrote ${kinds.length + 1 + types.length} svgs to assets/support-icons/`);

// ---- Contact sheet ----
const CAT_NAME = {
  reactor: 'Reactor (purple square)',
  generator: 'Generator (orange circle)',
  robonaut: 'Robonaut (black + pink square)',
};
const LBL = {
  'reactor-fission': 'Fission (was X)', 'reactor-fusion': 'Fusion (∿)', 'reactor-antimatter': 'Antimatter (bomb)',
  'gen-radioisotope': 'Radioisotope (⟛)', 'gen-electric': 'Electric (e)',
  'missile': 'Missile', 'raygun': 'Raygun', 'buggy': 'Buggy',
  'thruster': 'Thruster (rocket bell)', 'refinery': 'Refinery (green flask)', 'robonaut': 'Robonaut (generic head)',
};
const stripSvg = (s) => s.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
const ICON = 58, ROW_H = 88, PAD = 24, HEAD = 30, COL_W = 250;
const rows = [
  { name: CAT_NAME.reactor, items: ['reactor-fission', 'reactor-fusion', 'reactor-antimatter'].map((k) => ({ svg: supportIconSvg(k, opt), w: ICON, label: LBL[k] })) },
  { name: CAT_NAME.generator, items: ['gen-radioisotope', 'gen-electric'].map((k) => ({ svg: supportIconSvg(k, opt), w: ICON, label: LBL[k] })) },
  { name: 'Radiator (blue therms on white badge)', items: [1, 2, 3].map((n) => ({ svg: thermBadgeSvg(n, opt), w: (n * 13 + 8) * (ICON / 32), label: `${n} therm${n === 1 ? '' : 's'}` })) },
  { name: CAT_NAME.robonaut, items: ['missile', 'raygun', 'buggy'].map((k) => ({ svg: supportIconSvg(k, opt), w: ICON, label: LBL[k] })) },
  { name: 'Card-type header icons (NEW)', items: ['thruster', 'refinery', 'robonaut'].map((t) => ({ svg: typeIconSvg(t, opt), w: ICON, label: LBL[t] })) },
];
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
  <text x="${PAD}" y="${PAD - 4}" fill="#7dd3fc" font-family="sans-serif" font-size="13">Support / requirement glyphs</text>
  ${body}
</svg>`;
writeFileSync(join(OUT, '_contact-sheet.svg'), sheet + '\n');
console.log('wrote assets/support-icons/_contact-sheet.svg');
