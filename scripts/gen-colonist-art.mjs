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

// A hooded/robed figure (scholars, pilgrims, dynastic subjects). Still used by
// the Eugenic Pilgrims (Vatican back). The earlier helmet-bust / drone-chassis
// / swarm-cluster primitives were removed once every colonist that leaned on
// them was redrawn with its own concept-specific art (no shared silhouettes).
function hoodedFigure({ cx, cy, robeColor, robeColor2, faceColor = '#0d0b12', trimColor }) {
  return `
  <path d="M${cx-118},${H} Q${cx-110},${cy+40} ${cx},${cy-10} Q${cx+110},${cy+40} ${cx+118},${H} Z" fill="${robeColor}"/>
  <path d="M${cx-70},${H} Q${cx-64},${cy+70} ${cx},${cy+30} Q${cx+64},${cy+70} ${cx+70},${H} Z" fill="${robeColor2}" opacity="0.7"/>
  <path d="M${cx-52},${cy-6} Q${cx},${cy-96} ${cx+52},${cy-6} Q${cx+50},${cy+58} ${cx},${cy+76} Q${cx-50},${cy+58} ${cx-52},${cy-6} Z" fill="${faceColor}"/>
  <path d="M${cx-52},${cy-6} Q${cx},${cy-96} ${cx+52},${cy-6}" fill="none" stroke="${trimColor}" stroke-width="5"/>
  `;
}

// A bearded man's HEAD + SHOULDERS bust (frontal). The hair is a SOLID cap
// mass and the beard a SOLID jaw mass with a mustache - not thin arcs (thin
// arcs read as a monobrow + a grin). A SHORT neck emerges from under the
// beard into a proper shoulder curve, so it reads as a realistic bust rather
// than a floating head on a long stalk. `body` is the shoulder/clothing
// colour. Shared by Renaissance Man (Malcolm back) + Josephson Implants
// (Siren back), differentiated by skin tone + surrounding scene.
function beardedManFace({ hcx, hcy, r, skin, hair, body = '#3a2c5c', eyeColor = '#160e08' }) {
  const s = r;
  const neckTop = hcy + s * 0.95;   // hidden behind the lower beard
  const neckBot = hcy + s * 1.5;    // short visible neck
  return `
  <!-- shoulders / upper body -->
  <path d="M${(hcx-s*2.5).toFixed(1)},${H} Q${(hcx-s*1.7).toFixed(1)},${(neckBot+s*0.15).toFixed(1)} ${(hcx-s*0.62).toFixed(1)},${neckBot.toFixed(1)} Q${hcx},${(neckBot+s*0.24).toFixed(1)} ${(hcx+s*0.62).toFixed(1)},${neckBot.toFixed(1)} Q${(hcx+s*1.7).toFixed(1)},${(neckBot+s*0.15).toFixed(1)} ${(hcx+s*2.5).toFixed(1)},${H} Z" fill="${body}"/>
  <!-- short neck -->
  <path d="M${(hcx-s*0.4).toFixed(1)},${neckTop.toFixed(1)} L${(hcx-s*0.46).toFixed(1)},${(neckBot+2).toFixed(1)} L${(hcx+s*0.46).toFixed(1)},${(neckBot+2).toFixed(1)} L${(hcx+s*0.4).toFixed(1)},${neckTop.toFixed(1)} Z" fill="${skin}"/>
  <ellipse cx="${hcx}" cy="${hcy}" rx="${s}" ry="${(s*1.12).toFixed(1)}" fill="${skin}"/>
  <!-- solid hair cap over the crown + temples -->
  <path d="M${hcx-s},${(hcy-s*0.05).toFixed(1)} Q${(hcx-s*1.04).toFixed(1)},${(hcy-s*1.2).toFixed(1)} ${hcx},${(hcy-s*1.24).toFixed(1)} Q${(hcx+s*1.04).toFixed(1)},${(hcy-s*1.2).toFixed(1)} ${hcx+s},${(hcy-s*0.05).toFixed(1)} Q${(hcx+s*0.62).toFixed(1)},${(hcy-s*0.5).toFixed(1)} ${(hcx+s*0.24).toFixed(1)},${(hcy-s*0.52).toFixed(1)} Q${hcx},${(hcy-s*0.44).toFixed(1)} ${(hcx-s*0.24).toFixed(1)},${(hcy-s*0.52).toFixed(1)} Q${(hcx-s*0.62).toFixed(1)},${(hcy-s*0.5).toFixed(1)} ${hcx-s},${(hcy-s*0.05).toFixed(1)} Z" fill="${hair}"/>
  <!-- solid full beard around the jaw, dipping up to the cheeks -->
  <path d="M${(hcx-s*0.95).toFixed(1)},${(hcy-s*0.05).toFixed(1)} Q${(hcx-s*1.0).toFixed(1)},${(hcy+s*0.62).toFixed(1)} ${(hcx-s*0.5).toFixed(1)},${(hcy+s).toFixed(1)} Q${hcx},${(hcy+s*1.24).toFixed(1)} ${(hcx+s*0.5).toFixed(1)},${(hcy+s).toFixed(1)} Q${(hcx+s*1.0).toFixed(1)},${(hcy+s*0.62).toFixed(1)} ${(hcx+s*0.95).toFixed(1)},${(hcy-s*0.05).toFixed(1)} Q${(hcx+s*0.5).toFixed(1)},${(hcy+s*0.34).toFixed(1)} ${(hcx+s*0.26).toFixed(1)},${(hcy+s*0.4).toFixed(1)} Q${hcx},${(hcy+s*0.28).toFixed(1)} ${(hcx-s*0.26).toFixed(1)},${(hcy+s*0.4).toFixed(1)} Q${(hcx-s*0.5).toFixed(1)},${(hcy+s*0.34).toFixed(1)} ${(hcx-s*0.95).toFixed(1)},${(hcy-s*0.05).toFixed(1)} Z" fill="${hair}"/>
  <!-- mustache bridging the beard under the nose -->
  <path d="M${(hcx-s*0.36).toFixed(1)},${(hcy+s*0.38).toFixed(1)} Q${hcx},${(hcy+s*0.24).toFixed(1)} ${(hcx+s*0.36).toFixed(1)},${(hcy+s*0.38).toFixed(1)} Q${hcx},${(hcy+s*0.5).toFixed(1)} ${(hcx-s*0.36).toFixed(1)},${(hcy+s*0.38).toFixed(1)} Z" fill="${hair}"/>
  <!-- two SEPARATE eyebrows -->
  <path d="M${(hcx-s*0.52).toFixed(1)},${(hcy-s*0.26).toFixed(1)} q${(s*0.16).toFixed(1)},-${(s*0.1).toFixed(1)} ${(s*0.34).toFixed(1)},${(s*0.02).toFixed(1)}" stroke="${hair}" stroke-width="3.5" fill="none" stroke-linecap="round"/>
  <path d="M${(hcx+s*0.18).toFixed(1)},${(hcy-s*0.24).toFixed(1)} q${(s*0.18).toFixed(1)},-${(s*0.1).toFixed(1)} ${(s*0.34).toFixed(1)},${(s*0.02).toFixed(1)}" stroke="${hair}" stroke-width="3.5" fill="none" stroke-linecap="round"/>
  <!-- eyes below the brows -->
  <circle cx="${(hcx-s*0.34).toFixed(1)}" cy="${(hcy-s*0.06).toFixed(1)}" r="${(s*0.1).toFixed(1)}" fill="${eyeColor}"/>
  <circle cx="${(hcx+s*0.34).toFixed(1)}" cy="${(hcy-s*0.06).toFixed(1)}" r="${(s*0.1).toFixed(1)}" fill="${eyeColor}"/>
  <!-- nose -->
  <path d="M${hcx},${(hcy-s*0.08).toFixed(1)} l-${(s*0.07).toFixed(1)},${(s*0.24).toFixed(1)} q${(s*0.07).toFixed(1)},${(s*0.06).toFixed(1)} ${(s*0.14).toFixed(1)},0" stroke="#000" stroke-width="1.4" fill="none" opacity="0.22"/>
  `;
}

// A raised clenched fist on a SLEEVED forearm (New Attica Secessionists).
// The four folded fingers are TALL capsules whose knuckle tops arch unevenly
// (middle highest, pinky lowest) like a real fist; the thumb wraps the front;
// the lower forearm is a rolled shirt sleeve + cuff. Shading is left-lit (a
// horizontal fill gradient) so the palm centre doesn't go dark.
function raisedFist({ cx, topY, fill, crease, sleeve = '#2c2438', cuff = '#e6d6ff' }) {
  const fw = 17, gap = 2;
  const blockW = fw * 4 + gap * 3;
  const startX = cx - blockW / 2;
  const tops = [10, 0, 4, 16];        // knuckle-top offsets: uneven arch
  const baseY = topY + 60;            // where the visible fingers meet the hand
  const palmBottom = topY + 78;
  const fingers = tops.map((t, i) => {
    const x = startX + i * (fw + gap);
    const ty = topY + t;
    return `<path d="M${x},${baseY} L${x},${ty + 9} Q${x},${ty} ${x + fw / 2},${ty} Q${x + fw},${ty} ${x + fw},${ty + 9} L${x + fw},${baseY} Z" fill="${fill}"/>`
      + `<line x1="${x + 2}" y1="${ty + 24}" x2="${x + fw - 2}" y2="${ty + 24}" stroke="${crease}" stroke-width="1.5" opacity="0.35"/>`;
  }).join('');
  const fingerGaps = [1, 2, 3].map((i) => { const gx = (startX + i * (fw + gap) - gap / 2).toFixed(1); return `<line x1="${gx}" y1="${topY + 6}" x2="${gx}" y2="${baseY}" stroke="${crease}" stroke-width="1.6" opacity="0.4"/>`; }).join('');
  return `
  <!-- rolled shirt sleeve down the forearm -->
  <path d="M${cx-30},${H} L${cx-32},${palmBottom + 10} Q${cx},${palmBottom + 2} ${cx+32},${palmBottom + 10} L${cx+30},${H} Z" fill="${sleeve}"/>
  <!-- rolled cuff band -->
  <path d="M${cx-34},${palmBottom + 6} Q${cx},${palmBottom - 4} ${cx+34},${palmBottom + 6} L${cx+34},${palmBottom + 18} Q${cx},${palmBottom + 8} ${cx-34},${palmBottom + 18} Z" fill="${cuff}" opacity="0.9"/>
  <!-- back of hand behind + below the fingers -->
  <rect x="${cx-38}" y="${topY + 36}" width="76" height="${palmBottom - (topY + 36) + 6}" rx="16" fill="${fill}"/>
  <!-- folded fingers -->
  ${fingers}
  ${fingerGaps}
  <!-- thumb wrapping across the front lower-left -->
  <path d="M${cx-36},${topY + 46} q-11,3 -9,19 q3,13 17,11 q9,-2 9,-12 l-1,-17 z" fill="${fill}"/>
  <path d="M${cx-40},${topY + 50} q-6,8 2,19" stroke="${crease}" stroke-width="1.4" opacity="0.35" fill="none"/>
  <!-- soft top highlight following the knuckle arch -->
  <path d="M${startX + 4},${topY + 6} Q${cx},${topY - 8} ${startX + blockW - 4},${topY + 12}" stroke="#fff" stroke-width="3" opacity="0.16" fill="none"/>
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

// A CLEAN biomechatronic prosthetic ARM reaching up: a segmented metallic
// forearm, a wrist actuator ring, a mechanical palm plate with a knuckle bar,
// and five JOINTED fingers. NO face - the earlier version's two square palm
// chips read as eyes; the single chip now sits low on the forearm as an
// obvious port. Circuit traces run out to the card edges.
function biomechArm({ cx, cy, skinColor, skinColor2, chipColor, traceColor }) {
  // one jointed finger: capsule segments walking outward with dark knuckles.
  const mechFinger = (bx, by, ang, segs, w) => {
    const rad = (ang * Math.PI) / 180;
    const ux = Math.sin(rad), uy = -Math.cos(rad);
    let px = bx, py = by, out = '';
    segs.forEach((len, i) => {
      const nx = px + ux * len, ny = py + uy * len;
      out += `<line x1="${px.toFixed(1)}" y1="${py.toFixed(1)}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="${skinColor}" stroke-width="${w}" stroke-linecap="round"/>`
        + `<line x1="${px.toFixed(1)}" y1="${py.toFixed(1)}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="${skinColor2}" stroke-width="${(w * 0.3).toFixed(1)}" stroke-linecap="round" opacity="0.55"/>`;
      if (i < segs.length - 1) out += `<circle cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="${(w * 0.5).toFixed(1)}" fill="${chipColor}" opacity="0.85"/>`;
      px = nx + ux * 2; py = ny + uy * 2;
    });
    return out;
  };
  return `
  <g stroke="${traceColor}" stroke-width="1.4" opacity="0.5" fill="none">
    <path d="M20,${cy-40} h56 M20,${cy+20} h44 M${cx+70},${cy-24} h64 M${cx+64},${cy+40} h74"/>
    <circle cx="24" cy="${cy-40}" r="4"/><circle cx="24" cy="${cy+20}" r="4"/><circle cx="${W-24}" cy="${cy-24}" r="4"/><circle cx="${W-24}" cy="${cy+40}" r="4"/>
  </g>
  <!-- segmented metallic forearm -->
  <path d="M${cx-26},${H} L${cx-30},${cy+52} Q${cx},${cy+38} ${cx+30},${cy+52} L${cx+26},${H} Z" fill="${skinColor}"/>
  <path d="M${cx-24},${H} L${cx-27},${cy+54} Q${cx},${cy+42} ${cx+6},${cy+50} L${cx+6},${H} Z" fill="${skinColor2}" opacity="0.4"/>
  <!-- forearm panel seams -->
  <path d="M${cx-22},${cy+150} q22,-10 44,0 M${cx-24},${cy+210} q24,-10 48,0" stroke="${chipColor}" stroke-width="1.6" opacity="0.5" fill="none"/>
  <!-- circuit chip / port low on the forearm -->
  <rect x="${cx-16}" y="${cy+92}" width="32" height="22" rx="3" fill="${chipColor}"/>
  <rect x="${cx-9}" y="${cy+97}" width="18" height="3" fill="${traceColor}" opacity="0.7"/>
  <rect x="${cx-9}" y="${cy+104}" width="12" height="3" fill="${traceColor}" opacity="0.5"/>
  <path d="M${cx-16},${cy+98} h-6 M${cx-16},${cy+108} h-6 M${cx+16},${cy+98} h6 M${cx+16},${cy+108} h6" stroke="${traceColor}" stroke-width="1.4"/>
  <!-- continuous hand + wrist mass flowing straight out of the forearm -->
  <path d="M${cx-30},${cy+50} L${cx-34},${cy+18} Q${cx-38},${cy-8} ${cx-20},${cy-14} L${cx+20},${cy-14} Q${cx+38},${cy-8} ${cx+34},${cy+18} L${cx+30},${cy+50} Q${cx},${cy+58} ${cx-30},${cy+50} Z" fill="${skinColor}"/>
  <path d="M${cx-26},${cy+8} Q${cx-28},${cy-6} ${cx-14},${cy-10} L${cx+14},${cy-10} Q${cx+28},${cy-6} ${cx+26},${cy+8} Q${cx},${cy+22} ${cx-26},${cy+8} Z" fill="${skinColor2}" opacity="0.4"/>
  <!-- actuator ring band around the wrist (a seam, not a separating disc) -->
  <ellipse cx="${cx}" cy="${cy+36}" rx="34" ry="9" fill="${chipColor}" opacity="0.85"/>
  <ellipse cx="${cx}" cy="${cy+33}" rx="29" ry="6" fill="none" stroke="${skinColor2}" stroke-width="2" opacity="0.45"/>
  <!-- knuckle bar the fingers hinge from -->
  <rect x="${cx-30}" y="${cy-17}" width="60" height="8" rx="4" fill="${chipColor}" opacity="0.8"/>
  <!-- five jointed fingers spread from the knuckle bar (thumb last) -->
  ${mechFinger(cx - 26, cy - 14, -32, [28, 24, 18], 13)}
  ${mechFinger(cx - 11, cy - 16, -11, [34, 30, 20], 13)}
  ${mechFinger(cx + 5, cy - 16, 7, [36, 32, 22], 13)}
  ${mechFinger(cx + 22, cy - 14, 28, [30, 26, 18], 13)}
  ${mechFinger(cx - 34, cy + 6, -72, [24, 20], 14)}
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
// Front: a serene hairless face submerged in liquid, dissolving into a grid
// of glowing numerals (data-immersion). Back: a bearded man in 3/4 view with
// electrode leads curving off his skull (brain implants).
{
  const id = 'col_siren_cybernautics_inc';
  emit(id, 'front', panel({
    defs: `<radialGradient id="sc-bg" cx="55%" cy="35%" r="80%"><stop offset="0%" stop-color="#1c4a5e"/><stop offset="100%" stop-color="#06141c"/></radialGradient>
      <radialGradient id="sc-head" cx="45%" cy="35%" r="65%"><stop offset="0%" stop-color="#bfe9f2"/><stop offset="100%" stop-color="#2f7f96"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#sc-bg)"/>
      ${Array.from({length: 40}, (_, i) => { const c = i % 8, r = Math.floor(i / 8); return `<text x="${18 + c * 36}" y="${34 + r * 62}" font-family="monospace" font-size="13" fill="#7fd0e6" opacity="${(0.18 + ((i * 7) % 5) * 0.06).toFixed(2)}">${(i * 37 + 3) % 10}</text>`; }).join('')}
      <path d="M${CX-64},${CY+40} Q${CX-70},${CY-70} ${CX},${CY-92} Q${CX+70},${CY-70} ${CX+64},${CY+40} Q${CX+30},${CY+96} ${CX},${CY+104} Q${CX-30},${CY+96} ${CX-64},${CY+40} Z" fill="url(#sc-head)" opacity="0.92"/>
      <path d="M${CX-24},${CY-24} q10,-6 20,0 M${CX+8},${CY-28} q10,-6 20,0" stroke="#0a2530" stroke-width="2.5" fill="none" opacity="0.5"/>
      <path d="M${CX-28},${CY+22} Q${CX},${CY+40} ${CX+28},${CY+20}" stroke="#0a2530" stroke-width="3" fill="none" opacity="0.5"/>
      <path d="M${CX},${CY-14} l-6,22 8,0 z" fill="#0a2530" opacity="0.35"/>
    `,
  }));
  emit(id, 'back', panel({
    defs: `${purpleBackDefs('sc2-bg')}<linearGradient id="sc2-skin" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#8a5a3c"/><stop offset="100%" stop-color="#4a2c1c"/></linearGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#sc2-bg)"/>${starsField(8, 12)}
      <!-- bearded implantee bust (dark-skinned, distinct from Renaissance Man) -->
      ${beardedManFace({ hcx: CX, hcy: CY, r: 46, skin: 'url(#sc2-skin)', hair: '#1a1008', body: '#3a2c5c' })}
      <!-- electrode leads off the skull -->
      ${[-26, -6, 14].map((dx, i) => `<path d="M${CX+dx},${CY-56} q${4+i*4},-26 ${18+i*6},-34" stroke="#c8b8ff" stroke-width="2" fill="none" opacity="0.8"/><circle cx="${CX+dx}" cy="${CY-56}" r="4" fill="#e6d6ff"/><circle cx="${CX+dx+18+i*6}" cy="${CY-90}" r="3" fill="#9a80c8"/>`).join('')}
    `,
  }));
}

// --- 3. Heavy Water Survivalists / New Attica Secessionists ---
// Front: a defiant figure in a "don't tread" snake tee flanked by two white
// cryo-pods. Back: a raised clenched fist with a small owl-emblem pennant.
{
  const id = 'col_heavy_water_survivalists';
  emit(id, 'front', panel({
    defs: `<radialGradient id="hw-bg" cx="50%" cy="40%" r="80%"><stop offset="0%" stop-color="#28323a"/><stop offset="100%" stop-color="#080b0e"/></radialGradient>
      <linearGradient id="hw-pod" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#e8eef2"/><stop offset="50%" stop-color="#b8c4cc"/><stop offset="100%" stop-color="#8a969e"/></linearGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#hw-bg)"/>${starsField(10, 3)}
      <!-- two cryo-pods flanking -->
      <rect x="18" y="${CY-70}" width="46" height="200" rx="23" fill="url(#hw-pod)"/><rect x="26" y="${CY-56}" width="30" height="90" rx="15" fill="#3a5a66" opacity="0.6"/>
      <rect x="${W-64}" y="${CY-70}" width="46" height="200" rx="23" fill="url(#hw-pod)"/><rect x="${W-56}" y="${CY-56}" width="30" height="90" rx="15" fill="#3a5a66" opacity="0.6"/>
      <!-- standing figure -->
      <circle cx="${CX}" cy="${CY-52}" r="30" fill="#c9a888"/>
      <path d="M${CX-46},${H} L${CX-40},${CY-14} Q${CX},${CY-32} ${CX+40},${CY-14} L${CX+46},${H} Z" fill="#e6ebef"/>
      <!-- snake motif on the shirt -->
      <path d="M${CX-22},${CY+30} q10,-14 22,-4 q-10,10 4,18 q14,6 8,20" stroke="#1a1a1a" stroke-width="3" fill="none"/>
      <circle cx="${CX-22}" cy="${CY+30}" r="3" fill="#1a1a1a"/>
      <text x="${CX}" y="${CY+70}" text-anchor="middle" font-family="Georgia, serif" font-size="8" fill="#1a1a1a" opacity="0.8">DON'T TREAD</text>
    `,
  }));
  emit(id, 'back', panel({
    defs: `${purpleBackDefs('hw2-bg')}<linearGradient id="hw2-fist" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#eccce4"/><stop offset="55%" stop-color="#d09cc0"/><stop offset="100%" stop-color="#b078a0"/></linearGradient>
      <radialGradient id="hw2-globe" cx="40%" cy="35%" r="65%"><stop offset="0%" stop-color="#4a8fb0"/><stop offset="100%" stop-color="#1a3a5a"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#hw2-bg)"/>${starsField(10, 13)}
      <!-- globe behind the fist -->
      <circle cx="${CX}" cy="${CY+6}" r="108" fill="url(#hw2-globe)"/>
      <g opacity="0.5" fill="#4a7a6a">
        <path d="M${CX-70},${CY-30} q30,-10 54,6 q-20,20 -48,14 q-14,-16 -6,-20 z"/>
        <path d="M${CX+20},${CY+30} q34,-6 52,14 q-24,20 -50,8 q-10,-16 -2,-22 z"/>
        <path d="M${CX-40},${CY+50} q20,-4 30,10 q-16,12 -32,4 q-6,-10 2,-14 z"/>
      </g>
      <circle cx="${CX}" cy="${CY+6}" r="108" fill="none" stroke="#8fd0c0" stroke-width="1.5" opacity="0.4"/>
      <!-- pennant with owl emblem -->
      <path d="M${CX+44},${CY-84} L${CX+120},${CY-72} L${CX+44},${CY-60} Z" fill="#e6d6ff" opacity="0.9"/>
      <circle cx="${CX+66}" cy="${CY-72}" r="7" fill="none" stroke="#4a3a70" stroke-width="2"/><circle cx="${CX+63}" cy="${CY-73}" r="1.6" fill="#4a3a70"/><circle cx="${CX+69}" cy="${CY-73}" r="1.6" fill="#4a3a70"/>
      ${raisedFist({ cx: CX, topY: CY-70, fill: 'url(#hw2-fist)', crease: '#6a3a5a' })}
    `,
  }));
}

// --- 4. Malcolm / Renaissance Man ---
// Front: a young man in a pensive hand-on-chin pose lit by a bright window.
// Back: a bearded polymath at a glowing blueprint desk.
{
  const id = 'col_malcolm';
  emit(id, 'front', panel({
    defs: `<linearGradient id="mc-bg" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#0c0a14"/><stop offset="60%" stop-color="#1a1620"/><stop offset="100%" stop-color="#8fb8d8"/></linearGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#mc-bg)"/>
      <!-- bright window at right -->
      <rect x="${W-72}" y="30" width="60" height="180" rx="4" fill="#cfe4f4" opacity="0.85"/>
      <line x1="${W-42}" y1="30" x2="${W-42}" y2="210" stroke="#1a1620" stroke-width="3" opacity="0.5"/><line x1="${W-72}" y1="120" x2="${W-12}" y2="120" stroke="#1a1620" stroke-width="3" opacity="0.5"/>
      <!-- profile bust facing right toward the light -->
      <path d="M${CX-30},${H} L${CX-30},${CY+40} Q${CX-20},${CY+10} ${CX+18},${CY+14} L${CX+30},${H} Z" fill="#2a2630"/>
      <path d="M${CX-14},${CY+40} Q${CX-24},${CY-40} ${CX+18},${CY-48} Q${CX+46},${CY-42} ${CX+44},${CY-6} Q${CX+42},${CY+28} ${CX+10},${CY+34} Q${CX-10},${CY+30} ${CX-14},${CY+40} Z" fill="#b98f6c"/>
      <path d="M${CX-16},${CY-44} Q${CX+10},${CY-66} ${CX+38},${CY-48} Q${CX+20},${CY-40} ${CX-8},${CY-34} Z" fill="#3a2a1a"/>
      <circle cx="${CX+26}" cy="${CY-12}" r="3.5" fill="#1a1008"/>
      <!-- hand to chin -->
      <ellipse cx="${CX+12}" cy="${CY+34}" rx="14" ry="10" fill="#b98f6c"/>
      <path d="M${CX+2},${CY+30} q8,-8 18,-2" stroke="#8a6a4c" stroke-width="2" fill="none" opacity="0.6"/>
    `,
  }));
  emit(id, 'back', panel({
    defs: purpleBackDefs('mc2-bg'),
    inner: `<rect width="${W}" height="${H}" fill="url(#mc2-bg)"/>${starsField(6, 14)}
      <!-- floating blueprint linework -->
      <g stroke="#8fe0ff" stroke-width="1.2" fill="none" opacity="0.55">
        <circle cx="${CX-70}" cy="${CY-40}" r="26"/><path d="M${CX-96},${CY-40} h52 M${CX-70},${CY-66} v52"/>
        <rect x="${CX+40}" y="${CY-56}" width="50" height="36"/><path d="M${CX+40},${CY-38} h50 M${CX+65},${CY-56} v36"/>
        <path d="M${CX+38},${CY+30} l24,-14 24,14 -24,14 z"/>
      </g>
      <!-- seated bearded polymath -->
      ${beardedManFace({ hcx: CX, hcy: CY-8, r: 34, skin: '#c9a888', hair: '#241812', body: '#4a3a70' })}
    `,
  }));
}

// --- 5. Microgravity Pantrophists / Blue Goo Sybonts ---
// Front: a textbook biological cell cross-section (green rim membrane,
// organelles). Back: an open hand cradling a rising glowing DNA helix.
{
  const id = 'col_microgravity_pantrophists';
  emit(id, 'front', panel({
    defs: `<radialGradient id="mp-bg" cx="50%" cy="40%" r="80%"><stop offset="0%" stop-color="#12202a"/><stop offset="100%" stop-color="#060b10"/></radialGradient>
      <radialGradient id="mp-cyto" cx="45%" cy="40%" r="60%"><stop offset="0%" stop-color="#cfe8f2"/><stop offset="100%" stop-color="#7fb0c4"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#mp-bg)"/>${starsField(8, 5)}
      <circle cx="${CX}" cy="${CY}" r="104" fill="#3fb87a"/>
      <circle cx="${CX}" cy="${CY}" r="96" fill="url(#mp-cyto)"/>
      <!-- nucleus + organelles -->
      <circle cx="${CX-14}" cy="${CY-8}" r="34" fill="#c98a6a" opacity="0.85"/><circle cx="${CX-14}" cy="${CY-8}" r="12" fill="#8a4a3a"/>
      <ellipse cx="${CX+44}" cy="${CY+20}" rx="18" ry="10" fill="#b97a5a" opacity="0.8" transform="rotate(-30 ${CX+44} ${CY+20})"/>
      <ellipse cx="${CX+20}" cy="${CY-48}" rx="14" ry="8" fill="#b97a5a" opacity="0.8"/>
      <path d="M${CX-52},${CY+40} q14,-10 28,2 q-10,12 -28,-2 z" fill="#c98a6a" opacity="0.8"/>
      <!-- little blue star bodies -->
      ${[[30,50],[-40,-40],[54,-16]].map(([dx,dy]) => `<path d="M${CX+dx},${CY+dy-6} l3,6 6,1 -5,4 2,6 -6,-4 -6,4 2,-6 -5,-4 6,-1 z" fill="#5fb0e0"/>`).join('')}
    `,
  }));
  emit(id, 'back', panel({
    defs: `${purpleBackDefs('mp2-bg')}<linearGradient id="mp2-dna" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#bfeeff"/><stop offset="100%" stop-color="#6fa8e0"/></linearGradient>
      <radialGradient id="mp2-glow" cx="50%" cy="40%" r="50%"><stop offset="0%" stop-color="#8fd8ff" stop-opacity="0.5"/><stop offset="100%" stop-color="#8fd8ff" stop-opacity="0"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#mp2-bg)"/>${starsField(8, 15)}
      <circle cx="${CX}" cy="${CY-30}" r="90" fill="url(#mp2-glow)"/>
      <!-- rising DNA double helix -->
      ${Array.from({length: 7}, (_, i) => { const y = CY + 70 - i * 24; const ph = i * 0.9; const x1 = CX + Math.sin(ph) * 26, x2 = CX - Math.sin(ph) * 26; return `<line x1="${x1.toFixed(1)}" y1="${y}" x2="${x2.toFixed(1)}" y2="${y}" stroke="#bfeeff" stroke-width="2" opacity="0.7"/><circle cx="${x1.toFixed(1)}" cy="${y}" r="5" fill="url(#mp2-dna)"/><circle cx="${x2.toFixed(1)}" cy="${y}" r="5" fill="url(#mp2-dna)"/>`; }).join('')}
      <!-- open palm at the base -->
      <path d="M${CX-48},${H} Q${CX-40},${CY+92} ${CX-10},${CY+84} Q${CX},${CY+70} ${CX+10},${CY+84} Q${CX+40},${CY+92} ${CX+48},${H} Z" fill="#e6d6ff"/>
      ${[-30,-14,2,18].map((dx,i) => `<path d="M${CX+dx},${CY+82} q0,-${18-i*2} ${dx>0?4:-4},-${22-i*2}" stroke="#e6d6ff" stroke-width="9" stroke-linecap="round"/>`).join('')}
    `,
  }));
}

// --- 6. Botany Bay Convicts / Soldier Caste ---
// Front: a convict bust in horizontal-striped prison garb with a plain readable
// face and a high hair cap. Back: a forward-facing armored soldier bust
// (visored helmet, pauldrons, slung rifle).
{
  const id = 'col_botany_bay_convicts';
  emit(id, 'front', panel({
    defs: `<radialGradient id="bb-bg" cx="50%" cy="40%" r="80%"><stop offset="0%" stop-color="#2a2620"/><stop offset="100%" stop-color="#0a0806"/></radialGradient>
      <clipPath id="bb-torso"><path d="M${CX-52},${H} L${CX-44},${CY+6} q44,-22 88,0 L${CX+52},${H} Z"/></clipPath>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#bb-bg)"/>${starsField(10, 6)}
      <!-- striped prison torso -->
      <path d="M${CX-52},${H} L${CX-44},${CY+6} q44,-22 88,0 L${CX+52},${H} Z" fill="#3a3a44"/>
      <g clip-path="url(#bb-torso)">
        ${[0,1,2,3,4,5,6,7].map((i) => `<rect x="${CX-60}" y="${CY+16+i*26}" width="120" height="13" fill="#c8c0b0"/>`).join('')}
      </g>
      <!-- neck -->
      <rect x="${CX-12}" y="${CY-30}" width="24" height="34" fill="#b98f6c"/>
      <!-- head + a short hair cap sitting HIGH on the crown (clear forehead) -->
      <circle cx="${CX}" cy="${CY-52}" r="30" fill="#c9a888"/>
      <path d="M${CX-29},${CY-58} Q${CX-30},${CY-84} ${CX},${CY-84} Q${CX+30},${CY-84} ${CX+29},${CY-58} Q${CX+14},${CY-67} ${CX},${CY-67} Q${CX-14},${CY-67} ${CX-29},${CY-58} Z" fill="#2a2018"/>
      <!-- brows well below the hairline, eyes, nose, set mouth -->
      <path d="M${CX-17},${CY-55} l12,2 M${CX+5},${CY-53} l12,-2" stroke="#2a2018" stroke-width="2.6" stroke-linecap="round"/>
      <circle cx="${CX-11}" cy="${CY-48}" r="3.2" fill="#160e08"/>
      <circle cx="${CX+11}" cy="${CY-48}" r="3.2" fill="#160e08"/>
      <path d="M${CX},${CY-47} l-3,10 q3,2 6,0" stroke="#8a6a4c" stroke-width="1.6" fill="none" opacity="0.55"/>
      <path d="M${CX-9},${CY-33} q9,4 18,0" stroke="#7a4638" stroke-width="2.2" fill="none" stroke-linecap="round"/>
      <!-- jaw stubble -->
      <path d="M${CX-24},${CY-44} q4,26 24,30 q20,-4 24,-30" fill="#2a2018" opacity="0.16"/>
    `,
  }));
  emit(id, 'back', panel({
    defs: `${purpleBackDefs('bb2-bg')}<linearGradient id="bb2-arm" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#d0d6e4"/><stop offset="100%" stop-color="#5a5a7a"/></linearGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#bb2-bg)"/>${starsField(14, 16)}
      <!-- shoulder pauldrons -->
      <ellipse cx="${CX-58}" cy="${CY+36}" rx="34" ry="30" fill="url(#bb2-arm)"/>
      <ellipse cx="${CX+58}" cy="${CY+36}" rx="34" ry="30" fill="url(#bb2-arm)"/>
      <path d="M${CX-74},${CY+32} a20,20 0 0 1 30,0" stroke="#3a2c5c" stroke-width="2" fill="none" opacity="0.5"/>
      <path d="M${CX+44},${CY+32} a20,20 0 0 1 30,0" stroke="#3a2c5c" stroke-width="2" fill="none" opacity="0.5"/>
      <!-- torso armor -->
      <path d="M${CX-46},${H} L${CX-44},${CY+28} q44,-22 88,0 L${CX+46},${H} Z" fill="url(#bb2-arm)"/>
      <path d="M${CX},${CY+32} L${CX},${H}" stroke="#3a2c5c" stroke-width="2" opacity="0.4"/>
      <path d="M${CX-30},${CY+60} q30,16 60,0" stroke="#3a2c5c" stroke-width="2" fill="none" opacity="0.4"/>
      <!-- neck guard -->
      <rect x="${CX-14}" y="${CY-4}" width="28" height="26" rx="4" fill="#4a4a68"/>
      <!-- helmet -->
      <path d="M${CX-30},${CY-4} Q${CX-34},${CY-56} ${CX},${CY-58} Q${CX+34},${CY-56} ${CX+30},${CY-4} Q${CX},${CY+8} ${CX-30},${CY-4} Z" fill="url(#bb2-arm)"/>
      <!-- visor slit -->
      <path d="M${CX-24},${CY-26} q24,-10 48,0 l-2,12 q-22,8 -44,0 Z" fill="#160e2a"/>
      <path d="M${CX-20},${CY-22} q20,-6 40,0" stroke="#8fe0ff" stroke-width="1.6" opacity="0.6" fill="none"/>
      <!-- helmet crest -->
      <path d="M${CX},${CY-58} q-4,-14 0,-22 q4,8 0,22 Z" fill="#c01f6e"/>
      <!-- rifle slung across the chest -->
      <g transform="rotate(24 ${CX} ${CY+72})"><rect x="${CX-40}" y="${CY+68}" width="80" height="9" rx="2" fill="#2a2438"/><rect x="${CX+30}" y="${CY+64}" width="10" height="17" rx="2" fill="#3a3450"/></g>
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
// Front: a Soviet propaganda-poster cosmonaut raising a hammer & sickle over
// a bold red field. Back: ranks of blank rental android bodies, one lit
// operator standing behind them.
{
  const id = 'col_juiced_cosmonauts';
  emit(id, 'front', panel({
    defs: `<radialGradient id="jc-bg" cx="50%" cy="34%" r="85%"><stop offset="0%" stop-color="#d83828"/><stop offset="100%" stop-color="#7a1410"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#jc-bg)"/>
      <!-- radiating propaganda sunburst -->
      ${Array.from({length: 16}, (_, i) => { const a = (i / 16) * Math.PI * 2; return `<path d="M${CX},${CY-20} L${(CX+Math.cos(a)*260).toFixed(0)},${(CY-20+Math.sin(a)*260).toFixed(0)} L${(CX+Math.cos(a+0.16)*260).toFixed(0)},${(CY-20+Math.sin(a+0.16)*260).toFixed(0)} Z" fill="#e85a3a" opacity="${i%2?0.25:0}"/>`; }).join('')}
      <!-- cosmonaut body + raised arm -->
      <path d="M${CX-40},${H} L${CX-34},${CY+10} q34,-16 68,0 L${CX+40},${H} Z" fill="#f0ece2"/>
      <path d="M${CX+22},${CY+6} L${CX+70},${CY-84}" stroke="#f0ece2" stroke-width="20" stroke-linecap="round"/>
      <!-- helmet with CCCP band -->
      <circle cx="${CX}" cy="${CY-40}" r="34" fill="#f4f0e8"/>
      <path d="M${CX-34},${CY-46} a34,34 0 0 1 68,0 Z" fill="#cc2418"/>
      <text x="${CX}" y="${CY-52}" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="11" fill="#f4f0e8">CCCP</text>
      <path d="M${CX-20},${CY-32} q20,14 40,0" stroke="#8a2018" stroke-width="2.5" fill="none" opacity="0.5"/>
      <!-- hammer & sickle held aloft -->
      <g transform="translate(${CX+70},${CY-92})"><path d="M-8,10 A16,16 0 1 0 8,-6" fill="none" stroke="#f4d84a" stroke-width="5"/><rect x="-2" y="-14" width="5" height="26" fill="#f4d84a" transform="rotate(38)"/><rect x="-10" y="-16" width="20" height="7" rx="2" fill="#f4d84a" transform="rotate(38)"/></g>
    `,
  }));
  emit(id, 'back', panel({
    defs: `${purpleBackDefs('jc2-bg')}<radialGradient id="jc2-spot" cx="72%" cy="30%" r="30%"><stop offset="0%" stop-color="#ffe0b0" stop-opacity="0.6"/><stop offset="100%" stop-color="#ffe0b0" stop-opacity="0"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#jc2-bg)"/>
      <ellipse cx="${CX+70}" cy="${CY-60}" rx="70" ry="90" fill="url(#jc2-spot)"/>
      <!-- ranks of blank seated android bodies receding -->
      ${[[0,60,1],[1,60,1],[2,60,1],[0,20,0.82],[1,20,0.82],[2,20,0.82],[0.5,-16,0.66],[1.5,-16,0.66]].map(([col,dy,s]) => { const x = CX - 74 + col * 74; const y = CY + dy; return `<g transform="translate(${x},${y}) scale(${s})" opacity="${0.4+s*0.5}"><rect x="-20" y="0" width="40" height="46" rx="10" fill="#b8aed0"/><circle cx="0" cy="-14" r="16" fill="#cabfe0"/></g>`; }).join('')}
      <!-- the one lit operator standing behind -->
      <g transform="translate(${CX+66},${CY-70})"><circle cx="0" cy="0" r="16" fill="#f0d8b8"/><path d="M-20,80 L-16,20 q16,-10 32,0 L20,80 Z" fill="#e8d0a8"/></g>
    `,
  }));
}

// --- 9. Rock Rats Miners' Union / Alchemist Aviatrices ---
// Front: a smiling miner woman paired with a white-and-blue cobot, both
// wearing union patches. Back: an aviatrix face behind a glowing brow-band
// visor apparatus.
{
  const id = 'col_rock_rats_miners_union';
  emit(id, 'front', panel({
    defs: `<radialGradient id="rr-bg" cx="50%" cy="36%" r="80%"><stop offset="0%" stop-color="#3a4450"/><stop offset="100%" stop-color="#0c1014"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#rr-bg)"/>${starsField(8, 9)}
      <!-- miner woman (left) -->
      <path d="M${CX-92},${H} L${CX-88},${CY+30} q34,-16 66,0 L${CX-26},${H} Z" fill="#eef2f4"/>
      <circle cx="${CX-55}" cy="${CY-4}" r="30" fill="#8a5a3c"/>
      <!-- hair cap wrapping the crown + temples with a real hairline -->
      <path d="M${CX-84},${CY-2} Q${CX-85},${CY-38} ${CX-55},${CY-38} Q${CX-25},${CY-38} ${CX-26},${CY-2} Q${CX-32},${CY-16} ${CX-44},${CY-19} Q${CX-55},${CY-22} ${CX-66},${CY-19} Q${CX-78},${CY-16} ${CX-84},${CY-2} Z" fill="#2a1a10"/>
      <path d="M${CX-66},${CY+4} q11,9 22,0" stroke="#3a2418" stroke-width="2.5" fill="none"/>
      <circle cx="${CX-72}" cy="${CY+40}" r="7" fill="none" stroke="#e8c020" stroke-width="2"/>
      <!-- cobot (right): white + blue humanoid -->
      <path d="M${CX+26},${H} L${CX+22},${CY+30} q34,-16 66,0 L${CX+92},${H} Z" fill="#e8eef2"/>
      <rect x="${CX+34}" y="${CY+30}" width="48" height="8" fill="#3a7ac0"/>
      <circle cx="${CX+55}" cy="${CY-4}" r="30" fill="#f0f4f6"/>
      <rect x="${CX+38}" y="${CY-14}" width="34" height="16" rx="8" fill="#1a2430"/>
      <circle cx="${CX+47}" cy="${CY-6}" r="4" fill="#6cc6ff"/><circle cx="${CX+63}" cy="${CY-6}" r="4" fill="#6cc6ff"/>
      <circle cx="${CX+38}" cy="${CY+40}" r="7" fill="none" stroke="#3a7ac0" stroke-width="2"/>
    `,
  }));
  emit(id, 'back', panel({
    defs: `${purpleBackDefs('rr2-bg')}<radialGradient id="rr2-face" cx="45%" cy="38%" r="60%"><stop offset="0%" stop-color="#f0e4f8"/><stop offset="100%" stop-color="#9a86c0"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#rr2-bg)"/>${starsField(10, 19)}
      <path d="M${CX-70},${H} Q${CX-60},${CY+40} ${CX},${CY+34} Q${CX+60},${CY+40} ${CX+70},${H} Z" fill="#3a2c5c"/>
      <!-- face -->
      <path d="M${CX-38},${CY+40} Q${CX-46},${CY-42} ${CX},${CY-52} Q${CX+46},${CY-42} ${CX+38},${CY+40} Q${CX},${CY+66} ${CX-38},${CY+40} Z" fill="url(#rr2-face)"/>
      <path d="M${CX-14},${CY+14} q14,10 28,0" stroke="#6a5a8a" stroke-width="2.5" fill="none" opacity="0.6"/>
      <!-- glowing brow-band visor apparatus -->
      <rect x="${CX-42}" y="${CY-24}" width="84" height="18" rx="9" fill="#2a1f44"/>
      <rect x="${CX-38}" y="${CY-20}" width="76" height="10" rx="5" fill="#8fd0ff" opacity="0.8"/>
      <circle cx="${CX-46}" cy="${CY-15}" r="6" fill="#c8a8ff"/><circle cx="${CX+46}" cy="${CY-15}" r="6" fill="#c8a8ff"/>
      <path d="M${CX-38},${CY-15} l-14,-10 M${CX+38},${CY-15} l14,-10" stroke="#c8a8ff" stroke-width="2" opacity="0.7"/>
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
// Front: two traders bracketing a floating deal-hologram (yen sign, a robot
// head, exchange arrows). Back: a figure suspended in a glowing cryo-capsule
// wreathed in pink vapor.
{
  const id = 'col_lloyd_s_salvage_co';
  emit(id, 'front', panel({
    defs: `<radialGradient id="ls-bg" cx="50%" cy="42%" r="80%"><stop offset="0%" stop-color="#2c2a26"/><stop offset="100%" stop-color="#0a0908"/></radialGradient>
      <radialGradient id="ls-holo" cx="50%" cy="45%" r="55%"><stop offset="0%" stop-color="#4fd8d0" stop-opacity="0.35"/><stop offset="100%" stop-color="#4fd8d0" stop-opacity="0"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#ls-bg)"/>${starsField(6, 11)}
      <!-- two facing traders -->
      <circle cx="34" cy="${CY-10}" r="26" fill="#c9a888"/><path d="M4,${H} L2,${CY+20} q32,-14 64,0 L64,${H} Z" fill="#3a3a42"/>
      <circle cx="${W-34}" cy="${CY-10}" r="26" fill="#9a6a4a"/><path d="M${W-64},${H} L${W-66},${CY+20} q32,-14 64,0 L${W-4},${H} Z" fill="#2c3038"/>
      <!-- central floating trade hologram -->
      <ellipse cx="${CX}" cy="${CY}" rx="70" ry="80" fill="url(#ls-holo)"/>
      <rect x="${CX-42}" y="${CY-44}" width="84" height="72" rx="6" fill="none" stroke="#5fe0d6" stroke-width="2" opacity="0.8"/>
      <text x="${CX-22}" y="${CY-8}" text-anchor="middle" font-family="Arial" font-weight="700" font-size="30" fill="#7ff0e6">¥</text>
      <rect x="${CX+8}" y="${CY-24}" width="26" height="22" rx="4" fill="#7ff0e6" opacity="0.9"/><circle cx="${CX+16}" cy="${CY-13}" r="2.5" fill="#0a2028"/><circle cx="${CX+26}" cy="${CY-13}" r="2.5" fill="#0a2028"/>
      <path d="M${CX-26},${CY+14} h44 M${CX+14},${CY+8} l6,6 -6,6 M${CX+18},${CY+22} h-44 M${CX-22},${CY+16} l-6,6 6,6" stroke="#7ff0e6" stroke-width="2.5" fill="none"/>
      <!-- little potted plant -->
      <rect x="26" y="${CY+70}" width="16" height="12" fill="#8a5a3a"/><path d="M34,${CY+70} q-10,-14 -4,-24 M34,${CY+70} q10,-12 6,-22" stroke="#4a9a5a" stroke-width="2.5" fill="none"/>
    `,
  }));
  emit(id, 'back', panel({
    defs: `${purpleBackDefs('ls2-bg')}<radialGradient id="ls2-vapor" cx="50%" cy="45%" r="55%"><stop offset="0%" stop-color="#ffc8e0" stop-opacity="0.6"/><stop offset="100%" stop-color="#ffc8e0" stop-opacity="0"/></radialGradient>
      <linearGradient id="ls2-cap" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#d8c8f0" stop-opacity="0.5"/><stop offset="50%" stop-color="#f0e8ff" stop-opacity="0.25"/><stop offset="100%" stop-color="#d8c8f0" stop-opacity="0.5"/></linearGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#ls2-bg)"/>${starsField(8, 21)}
      <ellipse cx="${CX}" cy="${CY}" rx="90" ry="120" fill="url(#ls2-vapor)"/>
      <!-- upright cryo-capsule -->
      <rect x="${CX-46}" y="${CY-96}" width="92" height="216" rx="46" fill="url(#ls2-cap)" stroke="#e0d4f8" stroke-width="2.5"/>
      <!-- suspended figure inside -->
      <circle cx="${CX}" cy="${CY-40}" r="24" fill="#e6d6ff" opacity="0.85"/>
      <path d="M${CX-24},${CY+80} L${CX-20},${CY-16} q20,-10 40,0 L${CX+24},${CY+80} Z" fill="#e6d6ff" opacity="0.8"/>
      <!-- pink cryo-fog motes -->
      ${[[-24,-70],[30,-40],[-30,30],[24,60],[0,90]].map(([dx,dy]) => `<circle cx="${CX+dx}" cy="${CY+dy}" r="7" fill="#ffd0e4" opacity="0.5"/>`).join('')}
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
// Front: an atom with elliptical electron orbits beside a grid of alternating
// up/down field arrows. Back: a domed neoclassical capitol seen through a big
// translucent red Mars, with satellites.
{
  const id = 'col_boyle_engineering_collective';
  emit(id, 'front', panel({
    defs: `<radialGradient id="be-bg" cx="55%" cy="42%" r="80%"><stop offset="0%" stop-color="#26303a"/><stop offset="100%" stop-color="#080c10"/></radialGradient>
      <radialGradient id="be-nuc" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#dff6ff"/><stop offset="100%" stop-color="#3fb0e0"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#be-bg)"/>${starsField(6, 24)}
      <!-- grid of alternating up/down arrows (spin field) on the left -->
      ${Array.from({length: 12}, (_, i) => { const c = i % 3, r = Math.floor(i / 3); const x = 26 + c * 24, y = CY - 60 + r * 40; const up = (c + r) % 2 === 0; return `<path d="M${x},${up ? y+12 : y-12} L${x},${up ? y-12 : y+12} M${x},${up ? y-12 : y+12} l-4,${up ? 6 : -6} M${x},${up ? y-12 : y+12} l4,${up ? 6 : -6}" stroke="#7a8894" stroke-width="2" fill="none"/>`; }).join('')}
      <!-- atom: nucleus + 3 elliptical orbits -->
      <g transform="translate(${CX+40},${CY})">
        ${[0,60,120].map((rot) => `<ellipse cx="0" cy="0" rx="70" ry="26" fill="none" stroke="#c9a878" stroke-width="1.6" transform="rotate(${rot})" opacity="0.85"/>`).join('')}
        <circle cx="0" cy="0" r="18" fill="url(#be-nuc)"/>
        ${[0,120,240].map((rot) => { const a = rot * Math.PI / 180; return `<circle cx="${(Math.cos(a)*68).toFixed(1)}" cy="${(Math.sin(a)*22).toFixed(1)}" r="4" fill="#8fd8ff"/>`; }).join('')}
      </g>
    `,
  }));
  emit(id, 'back', panel({
    defs: `${purpleBackDefs('be2-bg')}<radialGradient id="be2-mars" cx="42%" cy="38%" r="60%"><stop offset="0%" stop-color="#ff8a6a"/><stop offset="100%" stop-color="#c03828"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#be2-bg)"/>${starsField(10, 25)}
      <!-- neoclassical capitol: dome + columns -->
      <g fill="#e6d6ff">
        <path d="M${CX-46},${CY+30} a46,46 0 0 1 92,0 Z"/>
        <rect x="${CX-4}" y="${CY-28}" width="8" height="14"/><circle cx="${CX}" cy="${CY-30}" r="5"/>
        <rect x="${CX-56}" y="${CY+30} " width="112" height="10"/>
        ${[-44,-26,-8,10,28].map((dx) => `<rect x="${CX+dx}" y="${CY+40}" width="9" height="60"/>`).join('')}
        <rect x="${CX-58}" y="${CY+100}" width="116" height="10"/>
      </g>
      <!-- big translucent red Mars overlapping -->
      <circle cx="${CX+8}" cy="${CY+16}" r="86" fill="url(#be2-mars)" opacity="0.5"/>
      <!-- satellites -->
      <circle cx="${CX+82}" cy="${CY-60}" r="5" fill="#e6d6ff"/><circle cx="${CX-78}" cy="${CY+70}" r="4" fill="#e6d6ff"/>
    `,
  }));
}

// --- 14. Transorbital Railworkers / Kaluga Naniteers ---
// Front: a cross-fin booster firing at a steep tilt over a red planet limb.
// Back: an all-over iridescent diamond-scale (nanocable mesh) texture field.
{
  const id = 'col_transorbital_railworkers';
  emit(id, 'front', panel({
    defs: `<radialGradient id="tr-bg" cx="50%" cy="30%" r="90%"><stop offset="0%" stop-color="#1a1a24"/><stop offset="100%" stop-color="#05050a"/></radialGradient>
      <linearGradient id="tr-planet" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#a85838"/><stop offset="100%" stop-color="#5a2818"/></linearGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#tr-bg)"/>${starsField(20, 26)}
      <!-- red planet limb at the bottom -->
      <path d="M-20,${H} Q${CX},${H-70} ${W+20},${H} Z" fill="url(#tr-planet)"/>
      ${[[60,20],[180,30],[240,10]].map(([x,dy]) => `<ellipse cx="${x}" cy="${H-40+dy}" rx="16" ry="6" fill="#7a3a24" opacity="0.6"/>`).join('')}
      <!-- tilted cross-fin booster -->
      <g transform="rotate(28 ${CX} ${CY})">
        <path d="M${CX-14},${CY-90} Q${CX},${CY-108} ${CX+14},${CY-90} L${CX+14},${CY+70} L${CX-14},${CY+70} Z" fill="#b0aca4"/>
        <path d="M${CX-14},${CY-90} Q${CX},${CY-108} ${CX+14},${CY-90} L${CX+8},${CY-70} L${CX-8},${CY-70} Z" fill="#7a766e"/>
        <!-- cross fins -->
        <path d="M${CX-14},${CY+40} l-26,30 26,0 Z" fill="#8a867e"/><path d="M${CX+14},${CY+40} l26,30 -26,0 Z" fill="#8a867e"/>
        <rect x="${CX-6}" y="${CY-20}" width="12" height="30" rx="2" fill="#4a4640"/>
        <!-- exhaust -->
        <path d="M${CX-10},${CY+70} Q${CX},${CY+120} ${CX+10},${CY+70} Z" fill="#ff9a4a" opacity="0.8"/><path d="M${CX-5},${CY+70} Q${CX},${CY+100} ${CX+5},${CY+70} Z" fill="#ffe08a"/>
      </g>
    `,
  }));
  emit(id, 'back', panel({
    defs: `${purpleBackDefs('tr2-bg')}<linearGradient id="tr2-scale" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#d8c8f0"/><stop offset="100%" stop-color="#7a5fa8"/></linearGradient>`,
    inner: (() => {
      const scales = [];
      const dx = 34, dy = 20;
      for (let r = -1; r < 12; r++) {
        for (let c = -1; c < 11; c++) {
          const x = c * dx + (r % 2 ? dx / 2 : 0);
          const y = 30 + r * dy;
          scales.push(`<path d="M${x},${y} L${x+dx/2},${y+dy/2} L${x},${y+dy} L${x-dx/2},${y+dy/2} Z" fill="url(#tr2-scale)" stroke="#4a2c6a" stroke-width="1" opacity="${(0.55 + ((r + c) % 3) * 0.15).toFixed(2)}"/>`);
        }
      }
      return `<rect width="${W}" height="${H}" fill="url(#tr2-bg)"/>${scales.join('')}`;
    })(),
  }));
}

// --- 15. Babbage Halbonauts / Utility Fog Halbonaut ---
// Front: a humanoid robot built from stacked cube modules each with a
// green-lit panel. Back: a utility-fog gripper pod with a splayed bundle of
// thin needle-filament manipulators.
{
  const id = 'col_babbage_halbonauts';
  emit(id, 'front', panel({
    defs: `<radialGradient id="bh-bg" cx="50%" cy="40%" r="80%"><stop offset="0%" stop-color="#1a2230"/><stop offset="100%" stop-color="#05070c"/></radialGradient>`,
    inner: (() => {
      const cube = (x, y, s) => `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="3" fill="#c8cdd6" stroke="#6a7280" stroke-width="1.5"/><rect x="${x+s*0.22}" y="${y+s*0.22}" width="${s*0.56}" height="${s*0.56}" rx="2" fill="#3ad07a" opacity="0.8"/>`;
      // head, torso (2x2), arms, legs from cube modules
      const parts = [];
      parts.push(cube(CX - 18, CY - 84, 36));                 // head
      for (const [c, r] of [[0,0],[1,0],[0,1],[1,1]]) parts.push(cube(CX - 34 + c * 34, CY - 40 + r * 34, 32)); // torso 2x2
      parts.push(cube(CX - 66, CY - 34, 28)); parts.push(cube(CX - 66, CY - 4, 28)); // left arm
      parts.push(cube(CX + 38, CY - 34, 28)); parts.push(cube(CX + 38, CY - 4, 28)); // right arm
      parts.push(cube(CX - 30, CY + 30, 30)); parts.push(cube(CX - 30, CY + 62, 30)); // left leg
      parts.push(cube(CX + 2, CY + 30, 30)); parts.push(cube(CX + 2, CY + 62, 30));   // right leg
      return `<rect width="${W}" height="${H}" fill="url(#bh-bg)"/>${starsField(14, 28)}${parts.join('')}`;
    })(),
  }));
  emit(id, 'back', panel({
    defs: `${purpleBackDefs('bh2-bg')}<radialGradient id="bh2-pod" cx="50%" cy="45%" r="50%"><stop offset="0%" stop-color="#f0e4ff"/><stop offset="100%" stop-color="#9a80c8"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#bh2-bg)"/>${starsField(10, 29)}
      <!-- splayed needle-filament manipulators -->
      ${Array.from({length: 22}, (_, i) => { const a = (i / 22) * Math.PI * 2; const len = 70 + (i % 3) * 18; const x2 = CX + Math.cos(a) * len, y2 = CY + Math.sin(a) * len; return `<line x1="${CX}" y1="${CY}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#d8c8f0" stroke-width="1.4" opacity="0.7"/><circle cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" r="2.4" fill="#e6d6ff"/>`; }).join('')}
      <!-- central gripper pod -->
      <circle cx="${CX}" cy="${CY}" r="26" fill="url(#bh2-pod)"/>
      <path d="M${CX-10},${CY} l-8,-10 M${CX+10},${CY} l8,-10 M${CX},${CY+10} l0,10" stroke="#4a3a70" stroke-width="3" stroke-linecap="round"/>
    `,
  }));
}

// --- 16. Security System / Frankenstein Navigator ---
// Front: a dark eye-shaped sentry lens with a single red laser dot (a HAL
// eye). Back: a half-flesh, half-machine cyborg skull in three-quarter view.
{
  const id = 'col_security_system';
  emit(id, 'front', panel({
    defs: `<radialGradient id="sec-bg" cx="50%" cy="45%" r="70%"><stop offset="0%" stop-color="#1a1416"/><stop offset="100%" stop-color="#050303"/></radialGradient>
      <radialGradient id="sec-lens" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#3a1414"/><stop offset="100%" stop-color="#0a0404"/></radialGradient>
      <radialGradient id="sec-dot" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#fff0f0"/><stop offset="35%" stop-color="#ff3838"/><stop offset="100%" stop-color="#ff3838" stop-opacity="0"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#sec-bg)"/>
      <!-- eye-shaped aperture -->
      <path d="M${CX-120},${CY} Q${CX},${CY-78} ${CX+120},${CY} Q${CX},${CY+78} ${CX-120},${CY} Z" fill="url(#sec-lens)" stroke="#2a1010" stroke-width="3"/>
      <circle cx="${CX}" cy="${CY}" r="46" fill="#160808"/>
      <circle cx="${CX}" cy="${CY}" r="44" fill="url(#sec-dot)"/>
      <circle cx="${CX}" cy="${CY}" r="9" fill="#ff5a5a"/>
      <circle cx="${CX}" cy="${CY}" r="3.5" fill="#fff"/>
    `,
  }));
  emit(id, 'back', panel({
    defs: `${purpleBackDefs('sec2-bg')}<linearGradient id="sec2-skin" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#e6d0e6"/><stop offset="55%" stop-color="#c0a0c0"/><stop offset="55%" stop-color="#c8cdd6"/><stop offset="100%" stop-color="#8a909c"/></linearGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#sec2-bg)"/>${starsField(8, 31)}
      <path d="M${CX-70},${H} Q${CX-60},${CY+40} ${CX},${CY+34} Q${CX+60},${CY+40} ${CX+70},${H} Z" fill="#3a2c5c"/>
      <!-- head: flesh left half, metal skull right half -->
      <path d="M${CX-40},${CY+40} Q${CX-48},${CY-46} ${CX},${CY-56} Q${CX+48},${CY-46} ${CX+40},${CY+40} Q${CX},${CY+66} ${CX-40},${CY+40} Z" fill="url(#sec2-skin)"/>
      <!-- segmented metal cranium plates on the right -->
      <path d="M${CX},${CY-56} Q${CX+48},${CY-46} ${CX+40},${CY+10}" fill="none" stroke="#6a7280" stroke-width="1.5"/>
      <path d="M${CX+8},${CY-50} q22,4 26,26 M${CX+14},${CY-30} q18,4 22,24" stroke="#6a7280" stroke-width="1.5" fill="none" opacity="0.7"/>
      <!-- eye on the flesh side, red sensor on the metal side -->
      <path d="M${CX-26},${CY-8} q8,-5 16,0" stroke="#2a1f44" stroke-width="2.5" fill="none"/>
      <circle cx="${CX+18}" cy="${CY-8}" r="5" fill="#ff4a4a"/>
      <path d="M${CX-6},${CY+8} q-4,10 4,14" stroke="#8a6a8a" stroke-width="2" fill="none" opacity="0.6"/>
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
// Front: a shapeless white matter droplet with blue magnetic field-line
// arrows arcing in from both sides. Back: a sea-urchin nanomachine, a spiky
// sphere with many straight node-tipped arms radiating outward.
{
  const id = 'col_programmable_matter';
  emit(id, 'front', panel({
    defs: `<radialGradient id="pm-bg" cx="50%" cy="42%" r="80%"><stop offset="0%" stop-color="#0f1830"/><stop offset="100%" stop-color="#03060e"/></radialGradient>
      <radialGradient id="pm-blob" cx="42%" cy="38%" r="60%"><stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#b8c4d8"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#pm-bg)"/>${starsField(8, 34)}
      <!-- magnetic field-line arrows sweeping around the blob -->
      ${[-1, 1].map((s) => [40, 74, 108].map((r) => `<path d="M${CX - s*130},${CY - r} Q${CX},${CY - r - 10} ${CX + s*130},${CY - r}" fill="none" stroke="#4aa8ff" stroke-width="2" opacity="0.7"/><path d="M${CX + s*130},${CY - r} l${-s*12},-6 M${CX + s*130},${CY - r} l${-s*12},6" stroke="#4aa8ff" stroke-width="2"/>`).join('')).join('')}
      <!-- amorphous lens-shaped matter droplet -->
      <path d="M${CX-84},${CY} Q${CX-40},${CY-46} ${CX+10},${CY-40} Q${CX+70},${CY-32} ${CX+84},${CY} Q${CX+50},${CY+44} ${CX-6},${CY+40} Q${CX-64},${CY+36} ${CX-84},${CY} Z" fill="url(#pm-blob)"/>
      <ellipse cx="${CX-24}" cy="${CY-12}" rx="26" ry="12" fill="#ffffff" opacity="0.6"/>
    `,
  }));
  emit(id, 'back', panel({
    defs: `${purpleBackDefs('pm2-bg')}<radialGradient id="pm2-core" cx="45%" cy="40%" r="55%"><stop offset="0%" stop-color="#f0e4ff"/><stop offset="100%" stop-color="#8a6ac0"/></radialGradient>`,
    inner: `<rect width="${W}" height="${H}" fill="url(#pm2-bg)"/>${starsField(8, 35)}
      <!-- radial spikes -->
      ${Array.from({length: 32}, (_, i) => { const a = (i / 32) * Math.PI * 2; const len = 74 + (i % 2) * 16; const x1 = CX + Math.cos(a) * 30, y1 = CY + Math.sin(a) * 30; const x2 = CX + Math.cos(a) * len, y2 = CY + Math.sin(a) * len; return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#d8c8f0" stroke-width="1.6" opacity="0.75"/><circle cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" r="2.6" fill="#e6d6ff"/>`; }).join('')}
      <circle cx="${CX}" cy="${CY}" r="34" fill="url(#pm2-core)"/>
      <circle cx="${CX-8}" cy="${CY-8}" r="10" fill="#fff" opacity="0.5"/>
    `,
  }));
}

console.log(`wrote ${manifest.length} SVGs to assets/colonists/`);

// ---- Display allow-list (single source of truth) ----
// Every colonist's art is drawn + saved above; this gate decides which ids are
// allowed to RENDER in the app. The user has reviewed + signed off on the whole
// deck, so all 18 are live. If a future colonist's art needs review before it
// ships, flip APPROVE_ALL off and list only the approved ids in the Set.
const APPROVE_ALL = true;
const DISPLAY_APPROVED = new Set([
  // (used only when APPROVE_ALL is false)
  'col_calypso_2_seed_sail',
]);

// ---- Manifest: which colonists actually PAINT their art in the app ----
// js/game/card-ui.js reads COLONIST_ART_IDS to decide whether to paint the
// per-colonist background. Generated = approved-and-on-disk, so it can never
// drift from either the allow-list or the SVGs actually written.
const allIds = [...new Set(manifest.map((m) => m.id))];
const isApproved = (id) => APPROVE_ALL || DISPLAY_APPROVED.has(id);
const ids = allIds.filter(isApproved);
const manifestJs = `// AUTO-GENERATED by scripts/gen-colonist-art.mjs - do not edit by hand.
// The set of M2 colonist ids whose card-body art (assets/colonists/<id>-front
// .svg + <id>-back.svg) is APPROVED to render. Every colonist has art drawn on
// disk, but only reviewed-and-approved ones appear here; add to the script's
// DISPLAY_APPROVED allow-list to enable more. Consumed by js/game/card-ui.js.
export const COLONIST_ART_IDS = new Set([
${ids.map((id) => `  '${id}',`).join('\n')}
]);
`;
writeFileSync(join(ROOT, 'data', 'colonist-art.js'), manifestJs);
console.log(`wrote data/colonist-art.js (${ids.length} of ${allIds.length} approved to render)`);

// ---- Contact sheet for review (shows ALL colonists, approved or not) ----
const rows = allIds.map((id) => {
  const front = readFileSyncSafe(join(OUT, `${id}-front.svg`));
  const back = readFileSyncSafe(join(OUT, `${id}-back.svg`));
  const badge = isApproved(id) ? ' [LIVE]' : ' [saved, hidden]';
  return `<div class="row"><div class="cell"><div class="tag">${id} (front)${badge}</div>${front}</div><div class="cell"><div class="tag">${id} (back)${badge}</div>${back}</div></div>`;
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
