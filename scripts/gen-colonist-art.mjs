// Generates the M2 Colonist deck's card-body background art (18 colonists,
// front White face + back Purple/promoted face = 36 SVGs) to
// assets/colonists/<id>-front.svg / <id>-back.svg, plus a contact sheet for
// review. Run: node scripts/gen-colonist-art.mjs
//
// Design recipe (locked in - see docs/colonist-art-guide.md for the full
// writeup consumed by css/cards.css + js/game/card-ui.js):
//   - Canvas: 300x330 (matches the real card-body's ~200x220 css-px content
//     box closely enough that background-size:cover never crops hard).
//   - NO ideology / delegate colour anywhere in the art - that palette is a
//     wholly separate system (the delegate cube), never mixed into card art.
//   - Front (White face): the colonist's own thematic palette, whatever
//     best reads the concept (object/scene OR a portrait bust - the official
//     cards use both, picked per subject).
//   - Back (Purple/promoted face): ALWAYS washes through this app's
//     established Tier-2 gradient (#655ca8 -> #652d91, the exact one
//     css/cards.css already uses for every promoted face) - a DIFFERENT
//     illustration than the front (new subject, or the same subject
//     transformed), never a recolour of the same shapes.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'colonists');
mkdirSync(OUT, { recursive: true });

export const W = 300, H = 330;

// ---- Shared template (frame/background plumbing every piece reuses) ----

function panel({ inner, defs = '' }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>${defs}</defs>
  ${inner}
</svg>`;
}

// Deterministic pseudo-random starfield (no Math.random() - keeps output
// reproducible across regenerations). `seed` varies the pattern per piece.
function starsField(n, seed) {
  const out = [];
  let s = 17 + seed * 101;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let i = 0; i < n; i++) {
    const x = rnd() * W, y = rnd() * H, r = rnd() < 0.2 ? 1.8 : 0.9;
    out.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="#eef0ff" opacity="${(0.25 + rnd() * 0.45).toFixed(2)}"/>`);
  }
  return out.join('');
}

// The ONE promoted-face background every colonist's back face shares -
// css/cards.css's exact Tier-2 purple (#655ca8 -> #652d91). `id` must be
// unique per <defs> block (SVG ids aren't scoped to the file).
function purpleBackDefs(id) {
  return `<radialGradient id="${id}" cx="50%" cy="44%" r="80%">
      <stop offset="0%" stop-color="#655ca8"/>
      <stop offset="100%" stop-color="#652d91"/>
    </radialGradient>`;
}

const manifest = [];
function emit(id, side, svg) {
  writeFileSync(join(OUT, `${id}-${side}.svg`), svg);
  manifest.push({ id, side });
}

// ---- Reusable silhouette primitives (shared shapes, varied by params so no
// two colonists look identical despite sharing a body-plan) ----

// A rounded space-helmet bust (Human colonists doing physical work).
function helmetBust({ cx, cy, suitColor, helmetColor = '#e7e2d8', visorColor, visorGlow, accentColor, collarAccent }) {
  return `
  <path d="M${cx-108},${H} Q${cx-96},${cy+220} ${cx-58},${cy+180} Q${cx},${cy+150} ${cx+58},${cy+180} Q${cx+96},${cy+220} ${cx+108},${H} Z" fill="${suitColor}"/>
  <path d="M${cx-58},${cy+180} Q${cx},${cy+150} ${cx+58},${cy+180}" fill="none" stroke="${accentColor}" stroke-width="4" opacity="0.9"/>
  <rect x="${cx-22}" y="${cy+92}" width="44" height="52" rx="10" fill="#b98f6c"/>
  <ellipse cx="${cx}" cy="${cy}" rx="98" ry="106" fill="${helmetColor}"/>
  <path d="M${cx-98},${cy} a98,106 0 0 1 196,0" fill="rgba(0,0,0,0.12)"/>
  <path d="M${cx-72},${cy-14} Q${cx},${cy-56} ${cx+72},${cy-14} Q${cx+68},${cy+66} ${cx},${cy+82} Q${cx-68},${cy+66} ${cx-72},${cy-14} Z" fill="${visorColor}"/>
  <path d="M${cx-66},${cy-16} Q${cx},${cy-48} ${cx+66},${cy-16} Q${cx+40},${cy-2} ${cx},${cy-2} Q${cx-40},${cy-2} ${cx-66},${cy-16} Z" fill="${visorGlow}" opacity="0.55"/>
  <ellipse cx="${cx+18}" cy="${cy+20}" rx="26" ry="40" fill="#0b1615" opacity="0.4"/>
  <ellipse cx="${cx}" cy="${cy+112}" rx="58" ry="16" fill="#20242f" stroke="${collarAccent || accentColor}" stroke-width="3"/>
  `;
}

// A hooded/robed figure (scholars, pilgrims, dynastic subjects).
function hoodedFigure({ cx, cy, robeColor, robeColor2, faceColor = '#0d0b12', trimColor }) {
  return `
  <path d="M${cx-118},${H} Q${cx-110},${cy+40} ${cx},${cy-10} Q${cx+110},${cy+40} ${cx+118},${H} Z" fill="${robeColor}"/>
  <path d="M${cx-70},${H} Q${cx-64},${cy+70} ${cx},${cy+30} Q${cx+64},${cy+70} ${cx+70},${H} Z" fill="${robeColor2}" opacity="0.7"/>
  <path d="M${cx-52},${cy-6} Q${cx},${cy-96} ${cx+52},${cy-6} Q${cx+50},${cy+58} ${cx},${cy+76} Q${cx-50},${cy+58} ${cx-52},${cy-6} Z" fill="${faceColor}"/>
  <path d="M${cx-52},${cy-6} Q${cx},${cy-96} ${cx+52},${cy-6}" fill="none" stroke="${trimColor}" stroke-width="5"/>
  `;
}

// A boxy sentry/drone robot chassis (Robot colonists).
function droneChassis({ cx, cy, bodyColor, bodyColor2, eyeColor, accentColor }) {
  return `
  <path d="M${cx-70},${H} L${cx-56},${cy+80} L${cx+56},${cy+80} L${cx+70},${H} Z" fill="${bodyColor2}"/>
  <rect x="${cx-64}" y="${cy-64}" width="128" height="150" rx="18" fill="${bodyColor}"/>
  <rect x="${cx-64}" y="${cy-64}" width="128" height="150" rx="18" fill="none" stroke="${accentColor}" stroke-width="3" opacity="0.8"/>
  <circle cx="${cx}" cy="${cy}" r="34" fill="#0c0f16"/>
  <circle cx="${cx}" cy="${cy}" r="20" fill="${eyeColor}"/>
  <circle cx="${cx}" cy="${cy}" r="7" fill="#fff" opacity="0.85"/>
  <rect x="${cx-40}" y="${cy+50}" width="80" height="10" rx="4" fill="${accentColor}" opacity="0.7"/>
  `;
}

// A geometric self-assembling swarm (nanite / fractal-matter Robots).
function swarmCluster({ cx, cy, cellColor, cellColor2, glowColor }) {
  const cells = [];
  const positions = [[0,-70,40],[64,-20,30],[-64,-20,30],[40,50,26],[-40,50,26],[0,90,32],[80,80,18],[-80,80,18]];
  for (const [dx, dy, r] of positions) {
    cells.push(`<circle cx="${cx+dx}" cy="${cy+dy}" r="${r}" fill="${(dx+dy)%2===0?cellColor:cellColor2}" opacity="0.92"/>`);
  }
  return `
  <circle cx="${cx}" cy="${cy+10}" r="150" fill="${glowColor}" opacity="0.18"/>
  ${cells.join('')}
  `;
}

// A kite/diamond solar sail drifting in a nebula (object-scene colonists).
function sailScene({ cx, cy, sailColor, sailColor2, ribColor, glyphColor, rx = 78, ry = 92 }) {
  const sail = `<path d="M${cx},${cy-ry} L${cx+rx},${cy} L${cx},${cy+ry} L${cx-rx},${cy} Z" fill="${sailColor}"/>
    <path d="M${cx},${cy-ry} L${cx},${cy+ry} M${cx-rx},${cy} L${cx+rx},${cy} M${cx},${cy-ry} L${cx-rx},${cy} M${cx},${cy-ry} L${cx+rx},${cy} M${cx},${cy+ry} L${cx-rx},${cy} M${cx},${cy+ry} L${cx+rx},${cy}" stroke="${ribColor}" stroke-width="1.2" opacity="0.6" fill="none"/>`;
  const glyph = `<g transform="translate(${cx},${cy-8})" fill="${glyphColor}" opacity="0.85">
    <ellipse cx="0" cy="0" rx="15" ry="24"/>
    <path d="M0,-24 Q10,-34 18,-30" stroke="${glyphColor}" stroke-width="3" fill="none"/>
  </g>`;
  return `${sail}${sailColor2 ? '' : ''}${glyph}`;
}

// A magnified nano-machine / bacteriophage (biotech promoted backs).
function nanite({ cx, cy, bodyGrad = 'url(#wn-body)' }) {
  const legs = [-50, -20, 20, 50].map((ang) => {
    const rad = (ang * Math.PI) / 180;
    const x2 = cx + Math.sin(rad) * 96, y2 = cy + 58 + Math.cos(rad) * 40;
    const midx = cx + Math.sin(rad) * 50, midy = cy + 40;
    return `<path d="M${cx},${cy+34} Q${midx.toFixed(1)},${midy} ${x2.toFixed(1)},${y2.toFixed(1)}" stroke="${bodyGrad}" stroke-width="3.4" fill="none" stroke-linecap="round"/>`;
  }).join('');
  return `${legs}
  <path d="M${cx-16},${cy+8} L${cx+16},${cy+8} L${cx+10},${cy+34} L${cx-10},${cy+34} Z" fill="${bodyGrad}"/>
  <path d="M${cx},${cy-58} L${cx+34},${cy-38} L${cx+34},${cy+2} L${cx},${cy+22} L${cx-34},${cy+2} L${cx-34},${cy-38} Z" fill="${bodyGrad}" stroke="#dbe6ff" stroke-width="1.5"/>
  <path d="M${cx},${cy-58} L${cx},${cy+22} M${cx-34},${cy-38} L${cx+34},${cy+2} M${cx+34},${cy-38} L${cx-34},${cy+2}" stroke="#7d95c9" stroke-width="1" opacity="0.6"/>`;
}

// ============================================================
// The 18 M2 colonists. Each front/back pair is genuinely distinct art
// (new subject or a transformed rendering of the same one), never a
// recolour. NO ideology colour anywhere - only the colonist's own concept
// palette on the front, and the fixed purple wash on every back.
// ============================================================

// A biomechatronic hand/forearm reaching in, fingers spread, with two chip
// modules embedded on the back and circuit traces running out to the edges
// (matches the Biomechs reference card almost beat for beat).
function biomechArm({ cx, cy, skinColor, skinColor2, chipColor, traceColor }) {
  const finger = (bx, by, len, ang) => {
    const rad = (ang * Math.PI) / 180;
    const tx = bx + Math.sin(rad) * len, ty = by - Math.cos(rad) * len;
    return `<path d="M${bx},${by} L${tx.toFixed(1)},${ty.toFixed(1)}" stroke="${skinColor}" stroke-width="15" stroke-linecap="round"/>
      <path d="M${bx},${by} L${tx.toFixed(1)},${ty.toFixed(1)}" stroke="${skinColor2}" stroke-width="5" stroke-linecap="round" opacity="0.6"/>`;
  };
  return `
  <g stroke="${traceColor}" stroke-width="1.4" opacity="0.5" fill="none">
    <path d="M20,${cy-40} h60 M20,${cy+10} h50 M20,${cy+60} h60 M${cx+70},${cy-30} h70 M${cx+70},${cy+40} h70"/>
    <circle cx="24" cy="${cy-40}" r="4"/><circle cx="24" cy="${cy+60}" r="4"/><circle cx="${W-24}" cy="${cy-30}" r="4"/>
  </g>
  <!-- forearm -->
  <path d="M${cx-30},${H} L${cx-46},${cy+40} Q${cx-30},${cy+10} ${cx+8},${cy+16} L${cx+40},${H} Z" fill="${skinColor}"/>
  <!-- palm -->
  <ellipse cx="${cx}" cy="${cy+20}" rx="52" ry="44" fill="${skinColor}"/>
  <ellipse cx="${cx-4}" cy="${cy+14}" rx="40" ry="34" fill="${skinColor2}" opacity="0.5"/>
  ${finger(cx-40, cy-4, 60, -40)}${finger(cx-16, cy-22, 72, -14)}${finger(cx+12, cy-24, 74, 6)}${finger(cx+38, cy-14, 62, 30)}
  <!-- thumb -->
  ${finger(cx-46, cy+30, 46, -78)}
  <!-- chip modules embedded on the back of the hand -->
  <rect x="${cx-30}" y="${cy}" width="24" height="18" rx="2" fill="${chipColor}" transform="rotate(-12 ${cx-18} ${cy+9})"/>
  <rect x="${cx+8}" y="${cy+6}" width="24" height="18" rx="2" fill="${chipColor}" transform="rotate(-12 ${cx+20} ${cy+15})"/>
  <path d="M${cx-30},${cy+4} h-6 M${cx-30},${cy+12} h-6 M${cx+32},${cy+10} h6 M${cx+32},${cy+18} h6" stroke="${traceColor}" stroke-width="1.4"/>
  `;
}

// A bald head in PROFILE (facing right) with a small implant chip behind the
// ear and a tadpole/data glyph beside it (Group Mind Immortalists reference).
function profileHeadChip({ cx, cy, skinGrad, chipColor, glowColor }) {
  return `
  <path d="M${cx-40},${cy+80} Q${cx-58},${cy-40} ${cx+6},${cy-58} Q${cx+58},${cy-44} ${cx+56},${cy+12} Q${cx+54},${cy+44} ${cx+30},${cy+52} L${cx+34},${cy+80} Z" fill="${skinGrad}"/>
  <!-- brow + nose profile on the right edge -->
  <path d="M${cx+56},${cy+12} q10,6 4,20 q-6,8 -14,6" fill="${skinGrad}"/>
  <!-- closed eye -->
  <path d="M${cx+26},${cy-6} q10,-4 18,2" stroke="#2a1f44" stroke-width="2.5" fill="none" opacity="0.7"/>
  <!-- implant chip behind the ear -->
  <rect x="${cx-26}" y="${cy-6}" width="20" height="14" rx="2" fill="${chipColor}"/>
  <path d="M${cx-26},${cy-2} h-6 M${cx-26},${cy+4} h-6 M${cx-6},${cy-2} h6 M${cx-6},${cy+4} h6" stroke="${chipColor}" stroke-width="1.4"/>
  <!-- data tadpole drifting off the implant -->
  <circle cx="${cx-2}" cy="${cy-30}" r="6" fill="${glowColor}"/>
  <path d="M${cx-2},${cy-24} q-8,14 -20,20" stroke="${glowColor}" stroke-width="2" fill="none"/>
  `;
}

// A serene bowed royal figure in a light robe with a small chest emblem and a
// halo of warm light (House of Saud reference: a young dynast, head bowed).
function bowedRoyal({ cx, cy, robeColor, robeShadow, faceColor, emblemColor, glowColor }) {
  return `
  <g opacity="0.5"><path d="M${cx},${cy-40} m-90,0 l180,0 M${cx},${cy-40} m-70,-60 l140,120 M${cx},${cy-40} m70,-60 l-140,120" stroke="${glowColor}" stroke-width="2"/></g>
  <!-- shoulders / robe -->
  <path d="M${cx-96},${H} Q${cx-88},${cy+70} ${cx-46},${cy+40} Q${cx},${cy+16} ${cx+46},${cy+40} Q${cx+88},${cy+70} ${cx+96},${H} Z" fill="${robeColor}"/>
  <path d="M${cx},${cy+30} L${cx-18},${H} M${cx},${cy+30} L${cx+18},${H}" stroke="${robeShadow}" stroke-width="6" opacity="0.5"/>
  <!-- crossed forearms -->
  <path d="M${cx-52},${cy+70} Q${cx},${cy+96} ${cx+52},${cy+66}" stroke="${robeShadow}" stroke-width="16" fill="none" stroke-linecap="round" opacity="0.8"/>
  <!-- bowed head (face tipped down, so mostly crown + a hint of features) -->
  <ellipse cx="${cx}" cy="${cy-6}" rx="40" ry="44" fill="${faceColor}"/>
  <path d="M${cx-40},${cy-14} Q${cx},${cy-52} ${cx+40},${cy-14} Q${cx+34},${cy+6} ${cx},${cy+10} Q${cx-34},${cy+6} ${cx-40},${cy-14} Z" fill="${robeShadow}"/>
  <!-- chest emblem -->
  <circle cx="${cx}" cy="${cy+58}" r="12" fill="none" stroke="${emblemColor}" stroke-width="2.5"/>
  <path d="M${cx-6},${cy+58} l6,-6 6,6 -6,6 z" fill="${emblemColor}"/>
  `;
}

// An observatory orrery: a glowing tilted ring of planets around a bright
// central sun, with a small silhouetted observer figure at the lower edge
// (Vatican Observers reference: figures around a glowing orrery table).
function orreryScene({ cx, cy, ringColor, sunColor, figureColor }) {
  const planets = [0, 60, 120, 180, 240, 300].map((deg) => {
    const rad = (deg * Math.PI) / 180;
    const x = cx + Math.cos(rad) * 96, y = cy + Math.sin(rad) * 34;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${5 + (deg % 90 === 0 ? 3 : 0)}" fill="${ringColor}"/>`;
  }).join('');
  return `
  <ellipse cx="${cx}" cy="${cy}" rx="96" ry="34" fill="none" stroke="${ringColor}" stroke-width="2" opacity="0.7"/>
  <ellipse cx="${cx}" cy="${cy}" rx="60" ry="21" fill="none" stroke="${ringColor}" stroke-width="1.5" opacity="0.5"/>
  <circle cx="${cx}" cy="${cy}" r="120" fill="${sunColor}" opacity="0.12"/>
  <circle cx="${cx}" cy="${cy}" r="18" fill="${sunColor}"/>
  ${planets}
  <!-- observer figures silhouetted at the near edge -->
  <g fill="${figureColor}">
    <ellipse cx="${cx-70}" cy="${cy+70}" rx="18" ry="30"/><circle cx="${cx-70}" cy="${cy+40}" r="11"/>
    <ellipse cx="${cx+66}" cy="${cy+74}" rx="16" ry="28"/><circle cx="${cx+66}" cy="${cy+46}" r="10"/>
  </g>
  `;
}

// --- 1. Calypso 2 Seed Sail / Wet-Nano Seed Sail ---
{
  const id = 'col_calypso_2_seed_sail';
  const cx = W * 0.52, cy = H * 0.5;
  emit(id, 'front', panel({
    defs: `<radialGradient id="ss-neb" cx="55%" cy="45%" r="75%"><stop offset="0%" stop-color="#123a2e"/><stop offset="55%" stop-color="#0a2420"/><stop offset="100%" stop-color="#050b10"/></radialGradient>
      <linearGradient id="ss-sail" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#bff5d3"/><stop offset="45%" stop-color="#5fd99a"/><stop offset="100%" stop-color="#1f8f66"/></linearGradient>
      <radialGradient id="ss-glow" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#8ff0bd" stop-opacity="0.55"/><stop offset="100%" stop-color="#8ff0bd" stop-opacity="0"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#ss-neb)"/>${starsField(46, 1)}<circle cx="${cx}" cy="${cy}" r="120" fill="url(#ss-glow)"/>${sailScene({ cx, cy, sailColor: 'url(#ss-sail)', ribColor: '#0f5c3f', glyphColor: '#0d3d2c' })}`,
  }));
  emit(id, 'back', panel({
    defs: `${purpleBackDefs('wn-bg')}<radialGradient id="wn-cell" cx="40%" cy="35%" r="60%"><stop offset="0%" stop-color="#8f7fe0" stop-opacity="0.45"/><stop offset="100%" stop-color="#8f7fe0" stop-opacity="0"/></radialGradient>
      <linearGradient id="wn-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#f2f6ff"/><stop offset="100%" stop-color="#c8bdf2"/></linearGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#wn-bg)"/>${starsField(18, 7)}<ellipse cx="${cx-40}" cy="${cy-18}" rx="180" ry="140" fill="url(#wn-cell)"/>${nanite({ cx, cy: cy - 30, bodyGrad: 'url(#wn-body)' })}
      <circle cx="${cx+50}" cy="${cy-60}" r="5" fill="#bcd4ff" opacity="0.8"/><circle cx="${cx-58}" cy="${cy-12}" r="3.4" fill="#bcd4ff" opacity="0.7"/>`,
  }));
}

const CX = W * 0.5, CY = H * 0.46;

// --- 2. Siren Cybernautics Inc. / Josephson Implants ---
// (matches the actual reference art: a serene head submerged in liquid,
// data-stream overlay; promoted = the same head, implant circuitry, warmer
// violet lighting - the official card's own front/back pairing.)
{
  const id = 'col_siren_cybernautics_inc';
  emit(id, 'front', panel({
    defs: `<radialGradient id="sc-bg" cx="55%" cy="35%" r="80%"><stop offset="0%" stop-color="#1c4a5e"/><stop offset="100%" stop-color="#06141c"/></radialGradient>
      <radialGradient id="sc-head" cx="45%" cy="35%" r="65%"><stop offset="0%" stop-color="#bfe9f2"/><stop offset="100%" stop-color="#2f7f96"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#sc-bg)"/>${starsField(10, 2)}
      <ellipse cx="${CX}" cy="${CY+10}" rx="120" ry="150" fill="#0d3446" opacity="0.5"/>
      <path d="M${CX-64},${CY+40} Q${CX-70},${CY-70} ${CX},${CY-92} Q${CX+70},${CY-70} ${CX+64},${CY+40} Q${CX+30},${CY+96} ${CX},${CY+104} Q${CX-30},${CY+96} ${CX-64},${CY+40} Z" fill="url(#sc-head)"/>
      <path d="M${CX-30},${CY+10} Q${CX},${CY+34} ${CX+30},${CY+8}" stroke="#0a2530" stroke-width="3" fill="none" opacity="0.5"/>
      ${[0,1,2,3,4].map((i)=>`<text x="${40+i*50}" y="${40+((i*37)%220)}" font-family="monospace" font-size="10" fill="#9fe0f0" opacity="0.35">${(i*37+11)%10}${(i*53+3)%10}${(i*19+7)%10}</text>`).join('')}
    `,
  }));
  emit(id, 'back', panel({
    defs: `${purpleBackDefs('sc2-bg')}<radialGradient id="sc2-head" cx="45%" cy="35%" r="65%"><stop offset="0%" stop-color="#e6d6ff"/><stop offset="100%" stop-color="#5a3f8c"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#sc2-bg)"/>${starsField(10, 12)}
      <path d="M${CX-64},${CY+40} Q${CX-70},${CY-70} ${CX},${CY-92} Q${CX+70},${CY-70} ${CX+64},${CY+40} Q${CX+30},${CY+96} ${CX},${CY+104} Q${CX-30},${CY+96} ${CX-64},${CY+40} Z" fill="url(#sc2-head)"/>
      <circle cx="${CX-20}" cy="${CY-30}" r="4" fill="#fff" opacity="0.9"/><circle cx="${CX+18}" cy="${CY-40}" r="3" fill="#fff" opacity="0.8"/>
      <path d="M${CX-20},${CY-30} L${CX-40},${CY-60} M${CX+18},${CY-40} L${CX+42},${CY-64}" stroke="#c8b8ff" stroke-width="1.6" opacity="0.7"/>
      <rect x="${CX-30}" y="${CY-58}" width="16" height="10" rx="2" fill="#2a1f44" opacity="0.8"/><rect x="${CX+30}" y="${CY-70}" width="16" height="10" rx="2" fill="#2a1f44" opacity="0.8"/>
    `,
  }));
}

// --- 3. Heavy Water Survivalists / New Attica Secessionists ---
{
  const id = 'col_heavy_water_survivalists';
  emit(id, 'front', panel({
    defs: `<radialGradient id="hw-bg" cx="50%" cy="40%" r="80%"><stop offset="0%" stop-color="#173a3f"/><stop offset="100%" stop-color="#050f11"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#hw-bg)"/>${starsField(14, 3)}
      ${helmetBust({ cx: CX, cy: CY, suitColor: '#33474a', helmetColor: '#c7d4d2', visorColor: '#0d2426', visorGlow: '#5fd0c9', accentColor: '#e0a83c' })}
      <path d="M${CX-90},${CY+60} q90,-24 180,0" stroke="#3fa89e" stroke-width="2" fill="none" opacity="0.3"/>
    `,
  }));
  emit(id, 'back', panel({
    defs: purpleBackDefs('hw2-bg'),
    inner: `<rect width="${W}" height="${H}" fill="url(#hw2-bg)"/>${starsField(12, 13)}
      <path d="M${CX-70},${CY+110} L${CX-70},${CY-40} L${CX},${CY-80} L${CX+70},${CY-40} L${CX+70},${CY+110} Z" fill="#3a2a5c" opacity="0.85"/>
      <path d="M${CX-50},${CY+90} L${CX-50},${CY-10} L${CX},${CY-40} L${CX+50},${CY-10} L${CX+50},${CY+90} Z" fill="none" stroke="#e6d6ff" stroke-width="2"/>
      <circle cx="${CX}" cy="${CY+10}" r="14" fill="#e6d6ff"/>
    `,
  }));
}

// --- 4. Malcolm / Renaissance Man ---
{
  const id = 'col_malcolm';
  emit(id, 'front', panel({
    defs: `<radialGradient id="mc-bg" cx="50%" cy="35%" r="80%"><stop offset="0%" stop-color="#3a2a1a"/><stop offset="100%" stop-color="#0c0805"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#mc-bg)"/>${starsField(10, 4)}
      ${helmetBust({ cx: CX, cy: CY, suitColor: '#5c4326', helmetColor: '#d8c7a1', visorColor: '#241a0d', visorGlow: '#e0a83c', accentColor: '#c98a2c' })}
    `,
  }));
  emit(id, 'back', panel({
    defs: purpleBackDefs('mc2-bg'),
    inner: `<rect width="${W}" height="${H}" fill="url(#mc2-bg)"/>${starsField(10, 14)}
      ${hoodedFigure({ cx: CX, cy: CY, robeColor: '#4a3a70', robeColor2: '#6a5aa0', trimColor: '#e6d6ff' })}
      <circle cx="${CX-30}" cy="${CY+150}" r="18" fill="none" stroke="#e6d6ff" stroke-width="2.5"/>
      <path d="M${CX+16},${CY+150} l24,-6 -4,24 z" fill="#e6d6ff" opacity="0.85"/>
    `,
  }));
}

// --- 5. Microgravity Pantrophists / Blue Goo Sybonts ---
{
  const id = 'col_microgravity_pantrophists';
  emit(id, 'front', panel({
    defs: `<radialGradient id="mp-bg" cx="50%" cy="40%" r="80%"><stop offset="0%" stop-color="#26313f"/><stop offset="100%" stop-color="#080b10"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#mp-bg)"/>${starsField(24, 5)}
      ${helmetBust({ cx: CX, cy: CY, suitColor: '#3a4356', helmetColor: '#e0e4ee', visorColor: '#101820', visorGlow: '#7dd3fc', accentColor: '#8b95b8' })}
    `,
  }));
  emit(id, 'back', panel({
    defs: `${purpleBackDefs('mp2-bg')}<radialGradient id="mp2-goo" cx="50%" cy="50%" r="60%"><stop offset="0%" stop-color="#7fd8ff" stop-opacity="0.7"/><stop offset="100%" stop-color="#7fd8ff" stop-opacity="0"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#mp2-bg)"/>${starsField(10, 15)}
      <ellipse cx="${CX}" cy="${CY}" rx="120" ry="120" fill="url(#mp2-goo)"/>
      <path d="M${CX-60},${CY} q30,-60 60,0 q30,60 60,0" fill="none" stroke="#bfeeff" stroke-width="4" opacity="0.8"/>
      <circle cx="${CX-40}" cy="${CY-10}" r="10" fill="#bfeeff" opacity="0.8"/><circle cx="${CX+44}" cy="${CY+16}" r="14" fill="#bfeeff" opacity="0.7"/>
    `,
  }));
}

// --- 6. Botany Bay Convicts / Soldier Caste ---
{
  const id = 'col_botany_bay_convicts';
  emit(id, 'front', panel({
    defs: `<radialGradient id="bb-bg" cx="50%" cy="40%" r="80%"><stop offset="0%" stop-color="#3f2f1a"/><stop offset="100%" stop-color="#0d0904"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#bb-bg)"/>${starsField(14, 6)}
      ${helmetBust({ cx: CX, cy: CY, suitColor: '#4a3f2c', helmetColor: '#b9ac8f', visorColor: '#1c1408', visorGlow: '#c98a2c', accentColor: '#8a7040' })}
      <path d="M${CX-40},${CY+150} L${CX+40},${CY+150}" stroke="#2a2216" stroke-width="6"/>
    `,
  }));
  emit(id, 'back', panel({
    defs: purpleBackDefs('bb2-bg'),
    inner: `<rect width="${W}" height="${H}" fill="url(#bb2-bg)"/>${starsField(10, 16)}
      ${droneChassis({ cx: CX, cy: CY, bodyColor: '#4a3a70', bodyColor2: '#3a2c5c', eyeColor: '#ff5a7a', accentColor: '#e6d6ff' })}
    `,
  }));
}

// --- 7. Vatican Observers / Eugenic Pilgrims ---
// Front: an OBSERVATORY orrery scene (the Vatican observatory: figures
// studying a glowing model of the heavens) - deliberately a SCENE, not a
// single figure, so it never reads like House of Saud's lone royal.
// Back (Eugenic Pilgrims): a robed pilgrim beneath a DNA double-helix halo.
{
  const id = 'col_vatican_observers';
  emit(id, 'front', panel({
    defs: `<radialGradient id="vo-bg" cx="50%" cy="42%" r="80%"><stop offset="0%" stop-color="#2a2418"/><stop offset="100%" stop-color="#0a0805"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#vo-bg)"/>${starsField(30, 7)}
      ${orreryScene({ cx: CX, cy: CY, ringColor: '#e0c878', sunColor: '#ffd86a', figureColor: '#141008' })}
    `,
  }));
  emit(id, 'back', panel({
    defs: purpleBackDefs('vo2-bg'),
    inner: `<rect width="${W}" height="${H}" fill="url(#vo2-bg)"/>${starsField(14, 17)}
      ${hoodedFigure({ cx: CX, cy: CY + 6, robeColor: '#4a3a70', robeColor2: '#6a5aa0', trimColor: '#f0e0ff' })}
      <!-- DNA double-helix halo above the pilgrim -->
      ${[0,1,2,3].map((i) => { const y = CY - 118 + i * 22; const ph = i * Math.PI / 2; const x1 = CX + Math.sin(ph) * 26, x2 = CX - Math.sin(ph) * 26; return `<circle cx="${x1.toFixed(1)}" cy="${y}" r="4" fill="#f0e0ff"/><circle cx="${x2.toFixed(1)}" cy="${y}" r="4" fill="#f0e0ff"/><line x1="${x1.toFixed(1)}" y1="${y}" x2="${x2.toFixed(1)}" y2="${y}" stroke="#c8a8ff" stroke-width="1.6" opacity="0.7"/>`; }).join('')}
    `,
  }));
}

// --- 8. Juiced Cosmonauts / Rental Body Guild ---
{
  const id = 'col_juiced_cosmonauts';
  emit(id, 'front', panel({
    defs: `<radialGradient id="jc-bg" cx="50%" cy="40%" r="80%"><stop offset="0%" stop-color="#3a1f2f"/><stop offset="100%" stop-color="#0c0509"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#jc-bg)"/>${starsField(12, 8)}
      ${helmetBust({ cx: CX, cy: CY, suitColor: '#4a2c3a', helmetColor: '#e8d8dc', visorColor: '#240c16', visorGlow: '#ff5a9c', accentColor: '#e0507c' })}
      <path d="M${CX-40},${CY-30} q40,90 80,0" stroke="#ff5a9c" stroke-width="2" fill="none" opacity="0.4"/>
    `,
  }));
  emit(id, 'back', panel({
    defs: purpleBackDefs('jc2-bg'),
    inner: `<rect width="${W}" height="${H}" fill="url(#jc2-bg)"/>${starsField(10, 18)}
      <path d="M${CX-70},${H} Q${CX-80},${CY} ${CX},${CY-100} Q${CX+80},${CY} ${CX+70},${H} Z" fill="#40305c" opacity="0.5"/>
      ${helmetBust({ cx: CX, cy: CY, suitColor: '#40305c', helmetColor: '#ded0f5', visorColor: '#1a1230', visorGlow: '#c8a8ff', accentColor: '#c8a8ff' })}
    `,
  }));
}

// --- 9. Rock Rats Miners' Union / Alchemist Aviatrices ---
{
  const id = 'col_rock_rats_miners_union';
  emit(id, 'front', panel({
    defs: `<radialGradient id="rr-bg" cx="50%" cy="40%" r="80%"><stop offset="0%" stop-color="#3a2f1a"/><stop offset="100%" stop-color="#0c0904"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#rr-bg)"/>${starsField(16, 9)}
      ${helmetBust({ cx: CX, cy: CY, suitColor: '#4a3f26', helmetColor: '#d8c88e', visorColor: '#1c1608', visorGlow: '#e8c020', accentColor: '#c99a2c' })}
      <path d="M${CX-14},${CY-92} L${CX+14},${CY-92} L${CX+8},${CY-70} L${CX-8},${CY-70} Z" fill="#e8c020"/>
    `,
  }));
  emit(id, 'back', panel({
    defs: purpleBackDefs('rr2-bg'),
    inner: `<rect width="${W}" height="${H}" fill="url(#rr2-bg)"/>${starsField(12, 19)}
      ${hoodedFigure({ cx: CX, cy: CY + 10, robeColor: '#4a3a70', robeColor2: '#6a5aa0', trimColor: '#e6d6ff' })}
      <path d="M${CX-52},${CY-20} Q${CX-110},${CY-60} ${CX-70},${CY+30} Z" fill="#e6d6ff" opacity="0.7"/>
      <path d="M${CX+52},${CY-20} Q${CX+110},${CY-60} ${CX+70},${CY+30} Z" fill="#e6d6ff" opacity="0.7"/>
    `,
  }));
}

// --- 10. Biomechs / Group Mind Immortalists ---
// Front: a blue biomechatronic HAND/ARM with embedded chips + circuit traces
// (biomechatronics = electronics for improved limbs). Back: a bald head in
// profile with a neural implant CHIP (Group Mind Immortalists).
{
  const id = 'col_biomechs';
  emit(id, 'front', panel({
    defs: `<radialGradient id="bm-bg" cx="50%" cy="40%" r="80%"><stop offset="0%" stop-color="#2a3242"/><stop offset="100%" stop-color="#0a0e14"/></radialGradient>
      <linearGradient id="bm-skin" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#7fb8e0"/><stop offset="100%" stop-color="#2f6a9c"/></linearGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#bm-bg)"/>${starsField(8, 10)}
      ${biomechArm({ cx: CX, cy: CY, skinColor: 'url(#bm-skin)', skinColor2: '#cfe8ff', chipColor: '#1a1a10', traceColor: '#e0a83c' })}
    `,
  }));
  emit(id, 'back', panel({
    defs: `${purpleBackDefs('bm2-bg')}<linearGradient id="bm2-skin" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#e6d6ff"/><stop offset="100%" stop-color="#9a80c8"/></linearGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#bm2-bg)"/>${starsField(10, 20)}
      ${profileHeadChip({ cx: CX, cy: CY, skinGrad: 'url(#bm2-skin)', chipColor: '#2a1f44', glowColor: '#f0e0ff' })}
    `,
  }));
}

// --- 11. Lloyd's Salvage Co. / Svalbard Caretakers ---
{
  const id = 'col_lloyd_s_salvage_co';
  emit(id, 'front', panel({
    defs: `<radialGradient id="ls-bg" cx="50%" cy="40%" r="80%"><stop offset="0%" stop-color="#2a2a2a"/><stop offset="100%" stop-color="#080808"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#ls-bg)"/>${starsField(20, 11)}
      ${helmetBust({ cx: CX, cy: CY, suitColor: '#3a3a3a', helmetColor: '#c0bfb8', visorColor: '#141414', visorGlow: '#ff9a3c', accentColor: '#ff9a3c' })}
      <rect x="${CX-16}" y="${CY-100}" width="32" height="10" fill="#1a1a1a" opacity="0.8"/>
    `,
  }));
  emit(id, 'back', panel({
    defs: purpleBackDefs('ls2-bg'),
    inner: `<rect width="${W}" height="${H}" fill="url(#ls2-bg)"/>${starsField(30, 21)}
      <path d="M${CX-100},${CY+60} L${CX},${CY-60} L${CX+100},${CY+60} Z" fill="#e6d6ff" opacity="0.85"/>
      <path d="M${CX-70},${CY+60} L${CX},${CY-20} L${CX+70},${CY+60} Z" fill="#4a3a70"/>
      <rect x="${CX-14}" y="${CY+20}" width="28" height="40" fill="#3a2c5c"/>
    `,
  }));
}

// --- 12. House of Saud / Iceworms ---
// Front: a serene BOWED ROYAL (a young Saudi dynast, head bowed, olive-gold
// robe with a chest emblem, bathed in warm light) - a lone reverent figure
// with a VISIBLE face, distinct from Vatican's observatory scene.
{
  const id = 'col_house_of_saud';
  emit(id, 'front', panel({
    defs: `<radialGradient id="hs-bg" cx="50%" cy="30%" r="85%"><stop offset="0%" stop-color="#4a4020"/><stop offset="60%" stop-color="#2a220f"/><stop offset="100%" stop-color="#0c0904"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#hs-bg)"/>${starsField(10, 22)}
      ${bowedRoyal({ cx: CX, cy: CY, robeColor: '#6a5a2a', robeShadow: '#4a3d1a', faceColor: '#c9a878', emblemColor: '#3aa860', glowColor: '#f0d878' })}
    `,
  }));
  // Iceworms: a segmented, tapering worm boring through ice - built from a
  // chain of overlapping circles shrinking tail-ward along a sine path, with
  // two short drill mandibles at the head. Reads clearly as "worm", unlike
  // the vague blob silhouette this used before.
  emit(id, 'back', panel({
    defs: `${purpleBackDefs('hs2-bg')}<linearGradient id="hs2-worm" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#e6d6ff"/><stop offset="100%" stop-color="#a880e0"/></linearGradient>`,
    inner: (() => {
      const N = 14;
      const segs = [];
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1);
        const x = 250 - t * 190;
        const y = CY + Math.sin(t * Math.PI * 2.1) * 46;
        const r = 30 * (1 - t) + 6 * t;
        segs.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="url(#hs2-worm)" opacity="${(0.95 - t * 0.15).toFixed(2)}"/>`);
      }
      const headX = 250, headY = CY;
      return `<rect width="${W}" height="${H}" fill="url(#hs2-bg)"/>${starsField(16, 23)}
      <path d="M40,${CY+60} l30,-16 M50,${CY+90} l32,-10 M250,${CY-70} l20,-24 M270,${CY-40} l18,-30" stroke="#e6d6ff" stroke-width="2" opacity="0.35"/>
      ${segs.join('\n      ')}
      <path d="M${headX+18},${headY-14} l16,-14 M${headX+20},${headY+8} l18,4" stroke="#3a2c5c" stroke-width="4" stroke-linecap="round"/>
      <circle cx="${headX+10}" cy="${headY-6}" r="4" fill="#3a2c5c"/>`;
    })(),
  }));
}

// --- 13. Boyle Engineering Collective / Martian Assembly ---
{
  const id = 'col_boyle_engineering_collective';
  emit(id, 'front', panel({
    defs: `<radialGradient id="be-bg" cx="50%" cy="40%" r="80%"><stop offset="0%" stop-color="#2a3a1a"/><stop offset="100%" stop-color="#080d04"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#be-bg)"/>${starsField(10, 24)}
      ${helmetBust({ cx: CX, cy: CY, suitColor: '#3a4a2c', helmetColor: '#d0d8b8', visorColor: '#141c0c', visorGlow: '#a8e05f', accentColor: '#9ac93c' })}
      <g stroke="#9ac93c" stroke-width="1" opacity="0.5" fill="none">
        <path d="M${CX-70},${CY-40} h140 M${CX-70},${CY-20} h140"/>
        <path d="M${CX-50},${CY-60} v100 M${CX-10},${CY-60} v100 M${CX+30},${CY-60} v100"/>
      </g>
    `,
  }));
  emit(id, 'back', panel({
    defs: purpleBackDefs('be2-bg'),
    inner: `<rect width="${W}" height="${H}" fill="url(#be2-bg)"/>${starsField(10, 25)}
      <rect x="${CX-16}" y="${CY-90}" width="32" height="180" rx="8" fill="#e6d6ff"/>
      <rect x="${CX-70}" y="${CY-40}" width="60" height="18" rx="6" fill="#4a3a70" transform="rotate(-20 ${CX-40} ${CY-31})"/>
      <rect x="${CX+10}" y="${CY+10}" width="60" height="18" rx="6" fill="#4a3a70" transform="rotate(20 ${CX+40} ${CY+19})"/>
      <circle cx="${CX}" cy="${CY-100}" r="10" fill="#e6d6ff"/>
    `,
  }));
}

// --- 14. Transorbital Railworkers / Kaluga Naniteers ---
{
  const id = 'col_transorbital_railworkers';
  emit(id, 'front', panel({
    defs: `<radialGradient id="tr-bg" cx="50%" cy="40%" r="80%"><stop offset="0%" stop-color="#3a2a1a"/><stop offset="100%" stop-color="#0c0704"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#tr-bg)"/>${starsField(14, 26)}
      ${helmetBust({ cx: CX, cy: CY, suitColor: '#4a3a2c', helmetColor: '#e0c860', visorColor: '#1c1408', visorGlow: '#ff9a3c', accentColor: '#ff9a3c' })}
      <path d="M0,${H-30} h${W}" stroke="#8a7040" stroke-width="8" opacity="0.5"/>
      <path d="M0,${H-16} h${W}" stroke="#8a7040" stroke-width="8" opacity="0.5"/>
    `,
  }));
  emit(id, 'back', panel({
    defs: purpleBackDefs('tr2-bg'),
    inner: `<rect width="${W}" height="${H}" fill="url(#tr2-bg)"/>${starsField(28, 27)}
      ${swarmCluster({ cx: CX, cy: CY, cellColor: '#e6d6ff', cellColor2: '#c8a8ff', glowColor: '#a880ff' })}
    `,
  }));
}

// --- 15. Babbage Halbonauts / Utility Fog Halbonaut ---
{
  const id = 'col_babbage_halbonauts';
  emit(id, 'front', panel({
    defs: `<radialGradient id="bh-bg" cx="50%" cy="40%" r="80%"><stop offset="0%" stop-color="#1a2a3a"/><stop offset="100%" stop-color="#04080d"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#bh-bg)"/>${starsField(20, 28)}
      ${droneChassis({ cx: CX, cy: CY, bodyColor: '#3a4a5c', bodyColor2: '#2a3a4a', eyeColor: '#6cc6ff', accentColor: '#8fb8d8' })}
    `,
  }));
  emit(id, 'back', panel({
    defs: purpleBackDefs('bh2-bg'),
    inner: `<rect width="${W}" height="${H}" fill="url(#bh2-bg)"/>${starsField(40, 29)}
      ${swarmCluster({ cx: CX, cy: CY, cellColor: '#f0e0ff', cellColor2: '#c8a8ff', glowColor: '#e6d6ff' })}
    `,
  }));
}

// --- 16. Security System / Frankenstein Navigator ---
{
  const id = 'col_security_system';
  emit(id, 'front', panel({
    defs: `<radialGradient id="sec-bg" cx="50%" cy="40%" r="80%"><stop offset="0%" stop-color="#3a1a1a"/><stop offset="100%" stop-color="#0d0404"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#sec-bg)"/>${starsField(10, 30)}
      ${droneChassis({ cx: CX, cy: CY, bodyColor: '#4a2c2c', bodyColor2: '#3a2020', eyeColor: '#ff4a4a', accentColor: '#ff8a5c' })}
      <path d="M${CX}, ${CY-64} l0,-20 M${CX-10},${CY-84} l20,0" stroke="#ff8a5c" stroke-width="4" stroke-linecap="round"/>
    `,
  }));
  emit(id, 'back', panel({
    defs: purpleBackDefs('sec2-bg'),
    inner: `<rect width="${W}" height="${H}" fill="url(#sec2-bg)"/>${starsField(10, 31)}
      ${helmetBust({ cx: CX, cy: CY, suitColor: '#40305c', helmetColor: '#c8b0d8', visorColor: '#1a1230', visorGlow: '#8f6fd0', accentColor: '#8f6fd0' })}
      <path d="M${CX-30},${CY-40} l16,10 M${CX+20},${CY-20} l16,-8 M${CX-10},${CY+30} l10,14" stroke="#2a1f44" stroke-width="2.5" opacity="0.8"/>
    `,
  }));
}

// --- 17. Smart Pets / Creeper Neogen ---
// A cute rat in a little space helmet - the "pet" reading should be
// immediate and warm, not an abstract blob.
{
  const id = 'col_smart_pets';
  emit(id, 'front', panel({
    defs: `<radialGradient id="sp-bg" cx="50%" cy="40%" r="80%"><stop offset="0%" stop-color="#1a3a2a"/><stop offset="100%" stop-color="#040d08"/></radialGradient>
      <radialGradient id="sp-glass" cx="35%" cy="30%" r="70%"><stop offset="0%" stop-color="#eafff4" stop-opacity="0.55"/><stop offset="100%" stop-color="#eafff4" stop-opacity="0"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#sp-bg)"/>${starsField(16, 32)}
      <!-- tail curling off the lower-right of the body -->
      <path d="M${CX+52},${CY+120} Q${CX+118},${CY+100} ${CX+104},${CY+40}" fill="none" stroke="#c98a9c" stroke-width="8" stroke-linecap="round"/>
      <!-- sitting body: a pear that the head sits directly on top of -->
      <path d="M${CX-72},${CY+130} Q${CX-78},${CY+30} ${CX-30},${CY} Q${CX+30},${CY-16} ${CX+56},${CY+30} Q${CX+78},${CY+80} ${CX+66},${CY+130} Z" fill="#b7a89c"/>
      <ellipse cx="${CX-6}" cy="${CY+70}" rx="44" ry="52" fill="#cabbae" opacity="0.6"/>
      <!-- front paws resting on the belly -->
      <ellipse cx="${CX-24}" cy="${CY+118}" rx="14" ry="10" fill="#d8cec2"/><ellipse cx="${CX+18}" cy="${CY+120}" rx="14" ry="10" fill="#d8cec2"/>
      <!-- ears sit on top of the head -->
      <circle cx="${CX-40}" cy="${CY-52}" r="21" fill="#c9bcae"/><circle cx="${CX+22}" cy="${CY-58}" r="21" fill="#c9bcae"/>
      <circle cx="${CX-40}" cy="${CY-52}" r="11" fill="#e0a8b8"/><circle cx="${CX+22}" cy="${CY-58}" r="11" fill="#e0a8b8"/>
      <!-- head, overlapping the body's shoulders so the two clearly join -->
      <circle cx="${CX-8}" cy="${CY-8}" r="50" fill="#c9bcae"/>
      <!-- snout to the left -->
      <ellipse cx="${CX-50}" cy="${CY+8}" rx="22" ry="15" fill="#d8cec2"/>
      <circle cx="${CX-68}" cy="${CY+6}" r="5" fill="#3a3128"/>
      <path d="M${CX-78},${CY} l-16,-4 M${CX-80},${CY+6} l-18,0 M${CX-78},${CY+12} l-16,4" stroke="#8a8072" stroke-width="1" opacity="0.7"/>
      <!-- eye -->
      <circle cx="${CX-12}" cy="${CY-14}" r="7" fill="#241a14"/><circle cx="${CX-10}" cy="${CY-16}" r="2.4" fill="#fff"/>
      <!-- glass helmet bubble over the head only; thin collar arc at the neck -->
      <ellipse cx="${CX-8}" cy="${CY-12}" rx="72" ry="76" fill="url(#sp-glass)" stroke="#dfe6e2" stroke-width="3.5" opacity="0.92"/>
      <path d="M${CX-72},${CY+32} Q${CX-8},${CY+58} ${CX+56},${CY+30}" fill="none" stroke="#dfe6e2" stroke-width="4" opacity="0.85"/>
      <path d="M${CX-40},${CY-56} q22,-16 52,-6" stroke="#eafff4" stroke-width="3" fill="none" opacity="0.5"/>
    `,
  }));
  // Creeper Neogen: a mutated creeping vine, not a blob - a curling stem
  // with alternating leaf nodes and a glowing mutant bud-eye at the growing
  // tip, reading clearly as a plant creature instead of an abstract shape.
  emit(id, 'back', panel({
    defs: `${purpleBackDefs('sp2-bg')}<radialGradient id="sp2-eye" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#e6ffe0"/><stop offset="100%" stop-color="#6cffb0"/></radialGradient>`,
    inner: (() => {
      const stem = `M60,${CY+110} C60,${CY+40} 140,${CY+60} 130,${CY} C120,${CY-60} 200,${CY-40} 210,${CY-110}`;
      const leaf = (x, y, rot, s = 1) => `<ellipse cx="${x}" cy="${y}" rx="${26*s}" ry="${13*s}" fill="#e6d6ff" opacity="0.85" transform="rotate(${rot} ${x} ${y})"/>`;
      return `<rect width="${W}" height="${H}" fill="url(#sp2-bg)"/>${starsField(18, 33)}
      <path d="${stem}" fill="none" stroke="#c8a8ff" stroke-width="10" stroke-linecap="round" opacity="0.9"/>
      <path d="${stem}" fill="none" stroke="#e6d6ff" stroke-width="3" stroke-linecap="round" opacity="0.6"/>
      ${leaf(84, CY+70, -30)}${leaf(150, CY+20, 40)}${leaf(102, CY-30, -50)}${leaf(190, CY-70, 30, 0.8)}
      <circle cx="210" cy="${CY-110}" r="16" fill="url(#sp2-eye)"/>
      <circle cx="210" cy="${CY-110}" r="6" fill="#0d3d2c"/>`;
    })(),
  }));
}

// --- 18. Programmable Matter / Neumann Matter ---
{
  const id = 'col_programmable_matter';
  emit(id, 'front', panel({
    defs: `<radialGradient id="pm-bg" cx="50%" cy="40%" r="80%"><stop offset="0%" stop-color="#1a2a3a"/><stop offset="100%" stop-color="#04080d"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#pm-bg)"/>${starsField(20, 34)}
      ${swarmCluster({ cx: CX, cy: CY, cellColor: '#7dd3fc', cellColor2: '#38bdf8', glowColor: '#7dd3fc' })}
    `,
  }));
  // Neumann Matter: a recursive branching tree of self-similar squares -
  // reads as "self-replicating machine" rather than the front's cluster of
  // circles (same concept, genuinely different geometry, not a recolour).
  emit(id, 'back', panel({
    defs: purpleBackDefs('pm2-bg'),
    inner: (() => {
      const nodes = [];
      function branch(x, y, len, ang, depth) {
        if (depth === 0 || len < 8) return;
        const rad = (ang * Math.PI) / 180;
        const x2 = x + Math.sin(rad) * len, y2 = y - Math.cos(rad) * len;
        nodes.push(`<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#c8a8ff" stroke-width="${1.4 * depth}" opacity="0.7"/>`);
        const s = 4 + depth * 2.6;
        nodes.push(`<rect x="${(x2-s/2).toFixed(1)}" y="${(y2-s/2).toFixed(1)}" width="${s.toFixed(1)}" height="${s.toFixed(1)}" fill="#e6d6ff" opacity="0.92"/>`);
        branch(x2, y2, len * 0.72, ang - 26, depth - 1);
        branch(x2, y2, len * 0.72, ang + 26, depth - 1);
      }
      branch(CX, CY + 110, 74, 0, 5);
      return `<rect width="${W}" height="${H}" fill="url(#pm2-bg)"/>${starsField(20, 35)}${nodes.join('\n      ')}`;
    })(),
  }));
}

console.log(`wrote ${manifest.length} SVGs to assets/colonists/`);

// ---- Manifest (single source of truth for which colonists have art) ----
// js/game/card-ui.js reads COLONIST_ART_IDS to decide whether to paint the
// per-colonist background; keeping it generated here means it can never
// drift from the SVGs actually written above.
const ids = [...new Set(manifest.map((m) => m.id))];
const manifestJs = `// AUTO-GENERATED by scripts/gen-colonist-art.mjs - do not edit by hand.
// The set of M2 colonist ids that have card-body art in assets/colonists/
// (<id>-front.svg + <id>-back.svg). Consumed by js/game/card-ui.js.
export const COLONIST_ART_IDS = new Set([
${ids.map((id) => `  '${id}',`).join('\n')}
]);
`;
writeFileSync(join(ROOT, 'data', 'colonist-art.js'), manifestJs);
console.log(`wrote data/colonist-art.js (${ids.length} ids)`);

// ---- Contact sheet for review ----
const rows = ids.map((id) => {
  const front = readFileSyncSafe(join(OUT, `${id}-front.svg`));
  const back = readFileSyncSafe(join(OUT, `${id}-back.svg`));
  return `<div class="row"><div class="cell"><div class="tag">${id} (front)</div>${front}</div><div class="cell"><div class="tag">${id} (back)</div>${back}</div></div>`;
}).join('\n');

function readFileSyncSafe(p) {
  try { return readFileSync(p, 'utf8'); } catch { return ''; }
}

const sheet = `<!doctype html><html><head><meta charset="utf-8"><style>
body{background:#05040a;font-family:sans-serif;color:#ccc;padding:20px;}
.row{display:flex;gap:16px;margin-bottom:16px;align-items:flex-start;}
.cell{border:1px solid #222;border-radius:6px;overflow:hidden;}
.cell svg{display:block;width:220px;height:auto;}
.tag{font-size:11px;color:#888;padding:4px 8px;background:#111;}
</style></head><body><h2>Colonist art contact sheet (${ids.length} colonists)</h2>${rows}</body></html>`;
writeFileSync(join(OUT, '_contact-sheet.html'), sheet);
console.log(`wrote contact sheet to assets/colonists/_contact-sheet.html`);
