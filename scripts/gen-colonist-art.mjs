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

function frontDefs(extra = '') { return extra; }

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
{
  const id = 'col_vatican_observers';
  emit(id, 'front', panel({
    defs: `<radialGradient id="vo-bg" cx="50%" cy="35%" r="80%"><stop offset="0%" stop-color="#241f3a"/><stop offset="100%" stop-color="#08070f"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#vo-bg)"/>${starsField(30, 7)}
      ${hoodedFigure({ cx: CX, cy: CY, robeColor: '#3a3350', robeColor2: '#524a72', trimColor: '#e0c878' })}
      <circle cx="${CX}" cy="${CY-70}" r="60" fill="none" stroke="#e0c878" stroke-width="1.5" opacity="0.5"/>
    `,
  }));
  emit(id, 'back', panel({
    defs: purpleBackDefs('vo2-bg'),
    inner: `<rect width="${W}" height="${H}" fill="url(#vo2-bg)"/>${starsField(14, 17)}
      ${hoodedFigure({ cx: CX, cy: CY, robeColor: '#4a3a70', robeColor2: '#6a5aa0', trimColor: '#f0e0ff' })}
      <ellipse cx="${CX}" cy="${CY-96}" rx="66" ry="16" fill="none" stroke="#f0e0ff" stroke-width="2.5" opacity="0.8"/>
      <path d="M${CX-14},${CY-84} q14,-14 28,0" stroke="#f0e0ff" stroke-width="2" fill="none" opacity="0.7"/>
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
{
  const id = 'col_biomechs';
  emit(id, 'front', panel({
    defs: `<radialGradient id="bm-bg" cx="50%" cy="40%" r="80%"><stop offset="0%" stop-color="#1f3a2f"/><stop offset="100%" stop-color="#050f0a"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#bm-bg)"/>${starsField(12, 10)}
      ${helmetBust({ cx: CX, cy: CY, suitColor: '#2c4a3a', helmetColor: '#c8d8cc', visorColor: '#0c1c14', visorGlow: '#5fe0a0', accentColor: '#3fd08a' })}
      <path d="M${CX+70},${CY+40} L${CX+96},${CY+20} M${CX+96},${CY+20} L${CX+112},${CY+50}" stroke="#8ab8a0" stroke-width="6" fill="none" stroke-linecap="round"/>
    `,
  }));
  emit(id, 'back', panel({
    defs: purpleBackDefs('bm2-bg'),
    inner: `<rect width="${W}" height="${H}" fill="url(#bm2-bg)"/>${starsField(10, 20)}
      ${[[-60,-20,0.5],[60,-20,0.5],[0,50,0.7],[0,-70,1]].map(([dx,dy,op]) => `<g transform="translate(${dx},${dy})" opacity="${op}">${helmetBust({ cx: CX, cy: CY - 10, suitColor: '#40305c', helmetColor: '#ded0f5', visorColor: '#1a1230', visorGlow: '#c8a8ff', accentColor: '#c8a8ff' })}</g>`).join('')}
      <path d="M${CX-60},${CY-30} L${CX},${CY-80} L${CX+60},${CY-30} M${CX},${CY-80} L${CX},${CY+40}" stroke="#f0e0ff" stroke-width="1.4" opacity="0.5" fill="none"/>
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
{
  const id = 'col_house_of_saud';
  emit(id, 'front', panel({
    defs: `<radialGradient id="hs-bg" cx="50%" cy="35%" r="80%"><stop offset="0%" stop-color="#3a2f1a"/><stop offset="100%" stop-color="#0c0904"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#hs-bg)"/>${starsField(20, 22)}
      ${hoodedFigure({ cx: CX, cy: CY, robeColor: '#4a3d20', robeColor2: '#6a5a30', trimColor: '#e0c060' })}
      <path d="M${CX-40},${CY-70} q40,-20 80,0" stroke="#e0c060" stroke-width="3" fill="none"/>
    `,
  }));
  emit(id, 'back', panel({
    defs: purpleBackDefs('hs2-bg'),
    inner: `<rect width="${W}" height="${H}" fill="url(#hs2-bg)"/>${starsField(14, 23)}
      <path d="M${CX-60},${CY+90} Q${CX-90},${CY} ${CX-40},${CY-90} Q${CX+10},${CY-20} ${CX-10},${CY+40} Q${CX+30},${CY-10} ${CX+20},${CY-80} Q${CX+80},${CY-10} ${CX+60},${CY+90} Z" fill="#e6d6ff" opacity="0.85"/>
      <circle cx="${CX-40}" cy="${CY-90}" r="7" fill="#3a2c5c"/><circle cx="${CX+20}" cy="${CY-80}" r="7" fill="#3a2c5c"/>
    `,
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
{
  const id = 'col_smart_pets';
  emit(id, 'front', panel({
    defs: `<radialGradient id="sp-bg" cx="50%" cy="40%" r="80%"><stop offset="0%" stop-color="#1a3a2a"/><stop offset="100%" stop-color="#040d08"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#sp-bg)"/>${starsField(16, 32)}
      <ellipse cx="${CX}" cy="${CY+60}" rx="70" ry="46" fill="#3a5c4a"/>
      <circle cx="${CX-40}" cy="${CY-10}" r="44" fill="#4a7a5c"/>
      <circle cx="${CX-56}" cy="${CY-46}" r="14" fill="#4a7a5c"/><circle cx="${CX-20}" cy="${CY-50}" r="14" fill="#4a7a5c"/>
      <circle cx="${CX-50}" cy="${CY-14}" r="6" fill="#6cffb0"/>
    `,
  }));
  emit(id, 'back', panel({
    defs: purpleBackDefs('sp2-bg'),
    inner: `<rect width="${W}" height="${H}" fill="url(#sp2-bg)"/>${starsField(20, 33)}
      <path d="M${CX-60},${CY+80} Q${CX-90},${CY} ${CX-30},${CY-90} Q${CX+20},${CY-40} ${CX-10},${CY+20} Q${CX+50},${CY-20} ${CX+40},${CY+70} Z" fill="#e6d6ff" opacity="0.85"/>
      <circle cx="${CX-30}" cy="${CY-90}" r="6" fill="#3a2c5c"/>
    `,
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
  emit(id, 'back', panel({
    defs: purpleBackDefs('pm2-bg'),
    inner: `<rect width="${W}" height="${H}" fill="url(#pm2-bg)"/>${starsField(30, 35)}
      ${[0,1,2].map((i) => `<g transform="translate(${(i-1)*70},${(i-1)*40}) scale(${1-i*0.28})">${swarmCluster({ cx: CX, cy: CY, cellColor: '#e6d6ff', cellColor2: '#c8a8ff', glowColor: '#e6d6ff' })}</g>`).join('')}
    `,
  }));
}

console.log(`wrote ${manifest.length} SVGs to assets/colonists/`);

// ---- Contact sheet for review ----
const ids = [...new Set(manifest.map((m) => m.id))];
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
