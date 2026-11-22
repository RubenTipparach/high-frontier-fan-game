// Colonist card marks, as printed (both faces, both decks): every Human carries
// the yellow humans-aboard triangle, a spaceborn Human also the baby-in-a-ball
// Spaceborn emblem, and every Robot the purple gear.
// Signed off by the owner 2026-11-20 (tracker A5a / A6); the curled-baby
// Spaceborn emblem replaced the first draft the same day (owner sign-off).
import { mannedGlyph } from './contract-glyphs.js';

export const SPACEBORN_EMBLEM = (size = 30) => `<svg class="col-mark-spaceborn" width="${size}" height="${size}" viewBox="0 0 26 26" data-tip="Spaceborn">
  <circle cx="12" cy="14" r="10.5" fill="#fff" stroke="#111" stroke-width="1.6"/>
  <circle cx="20.5" cy="5" r="3.2" fill="#fff" stroke="#111" stroke-width="1.4"/>
  <g transform="translate(4.6,5.6) scale(0.165)">
    <g fill="#111">
      <circle cx="44" cy="27" r="19.5"/>
      <path d="M33 38 C 19 50, 17 76, 30 89 C 39 97, 55 98, 64 93 L 66 84 C 60 76, 57 66, 57 56 C 52 48, 42 44, 37 40 Z"/>
      <ellipse cx="65" cy="71" rx="16" ry="10.5" transform="rotate(-38 65 71)"/>
      <ellipse cx="70" cy="89" rx="13" ry="6" transform="rotate(12 70 89)"/>
      <ellipse cx="58" cy="50" rx="6.5" ry="5" transform="rotate(20 58 50)"/></g>
  </g>
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
