// Colonist card marks, as printed (both faces, both decks): every Human carries
// the yellow humans-aboard triangle, a spaceborn Human also the baby-in-a-ball
// Spaceborn emblem, and every Robot the purple gear.
// Signed off by the owner 2026-11-20 (tracker A5a / A6).
import { mannedGlyph } from './contract-glyphs.js';

export const SPACEBORN_EMBLEM = (size = 30) => `<svg class="col-mark-spaceborn" width="${size}" height="${size}" viewBox="0 0 26 26" data-tip="Spaceborn">
  <circle cx="12" cy="14" r="10.5" fill="#fff" stroke="#111" stroke-width="1.6"/>
  <circle cx="20.5" cy="5" r="3.2" fill="#fff" stroke="#111" stroke-width="1.4"/>
  <circle cx="14.6" cy="9.4" r="2.9" fill="#111"/>
  <path d="M12.6 12.2c-3.2.2-5.6 2.4-5.6 5.2 0 2.3 1.9 3.6 4.4 3.6h4.8c1.3 0 1.9-1.3 1.1-2.2l-1.9-1.8 1.6-.6c1-.4 1.1-1.6.2-2.1l-2.4-1.5z" fill="#111"/>
  <path d="M8.6 19.6l-2.4 1.6M15.6 15.2l3 .6" stroke="#111" stroke-width="1.6" stroke-linecap="round"/>
</svg>`;

function gearPath(cx, cy, r, teeth) {
  let d = '';
  for (let i = 0; i < teeth * 2; i++) {
    const a0 = (i / (teeth * 2)) * Math.PI * 2, a1 = ((i + 1) / (teeth * 2)) * Math.PI * 2;
    const rr = i % 2 ? r : r * 1.22;
    d += `${i ? 'L' : 'M'}${(cx + Math.cos(a0) * rr).toFixed(1)} ${(cy + Math.sin(a0) * rr).toFixed(1)} L${(cx + Math.cos(a1) * rr).toFixed(1)} ${(cy + Math.sin(a1) * rr).toFixed(1)} `;
  }
  return d + 'Z';
}
const GEAR_D = gearPath(24, 24, 16, 10);
export const ROBOT_GEAR = (size = 34) => `<svg class="col-mark-robot" width="${size}" height="${size}" viewBox="0 0 48 48" data-tip="Robot">
  <path d="${GEAR_D}" fill="#7d6a9e" stroke="#4b3d66" stroke-width="1.2"/>
  <circle cx="24" cy="24" r="7" fill="#2b2238" stroke="#4b3d66" stroke-width="1.2"/>
</svg>`;

// The marks row for a colonist card, as printed on both decks: every Robot the
// gear, every Human the humans-aboard triangle, and a spaceborn Human the
// Spaceborn emblem too (owner 2026-11-20, from the M2 card scans). '' for any
// other card.
export function colonistMarksHtml(card) {
  if (!card || card.type !== 'colonist') return '';
  if (card.colonistKind === 'Robot') return ROBOT_GEAR();
  return `${mannedGlyph({ size: 26 })}${card.spaceborn ? SPACEBORN_EMBLEM() : ''}`;
}
