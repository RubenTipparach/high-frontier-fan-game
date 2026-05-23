import { getRocketSprite, getRocketSpriteSize } from './rocket-sprite.js';

// Canvas-based renderer for the delta-v map.
//
// Why canvas: 1500 nodes + 1750 edges as SVG is ~12k DOM elements,
// which pays a per-element layout / paint / hit-test cost. Canvas
// is one drawing surface and one composite layer; the planner uses
// the same approach and scales effortlessly.
//
// The public surface matches the prior SVG renderer:
//   new MapRenderer(host, { data, onSelect })
//   r.setRoute(segments)
//   r.setRouteEndpoints(fromId, toId)
//   r.reset()
// so the callers in browse.js / lobby.js didn't need to change.
//
// Coordinate spaces:
//   data        the planner's coordinate system; sites have x,y in
//               this space (1400 x 900 normalised viewBox).
//   screen      CSS pixels relative to the canvas.
//   device      physical pixels (CSS * devicePixelRatio).
//
// The frame transform is: screen = pan + data * (zoom * fitScale).
// fitScale is recomputed on resize so the whole data viewport fits
// the available canvas; the user's zoom is a multiplier on top.

const VIEW_W = 1400;
const VIEW_H = 900;
const MIN_ZOOM = 1;
const MAX_ZOOM = 10;

// Zoom level at which the hex marker (and its size text /
// hydration droplets / centre flag glyphs) reaches its full
// HEX_R size. Below this threshold the hex shrinks
// proportionally so it doesn't dominate the small-scale,
// zoomed-out view — and so two adjacent hexes don't visually
// merge when the world spacing is compressed. At and above
// this zoom level the hex is rendered at full size.
const HEX_FULLSIZE_ZOOM = 2.5;

// World-space anchor of LEO — the sandbox rocket's home and
// the big yellow "LEO" label rendered on the map. Exported so
// the Sandbox "Stack" button in the hand header can centre
// the map on it. Coordinates match the LEO lagrange waypoint
// in the planner JSON (nx=0.8526, ny=0.8215) scaled to the
// 1400×900 view used by loadPlannerMap(), so the label sits on
// the actual LEO node rather than floating off near Itokawa.
export const LEO_ANCHOR = { x: 1193.6, y: 739.3 };

// Short, stable, copy-friendly reference for a planner node id.
// The upstream vendor data keys nodes by random floats like
// "0.9483763498218554" — useless as something a player can quote
// in a bug report. djb2-hash to a 7-char base36 string. Same input
// always yields the same output, so it's still a valid stable id;
// it just reads as "k3xq2pa" instead of a long decimal.
export function shortRefId(id) {
  const s = String(id == null ? '' : id);
  let h = 5381 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h.toString(36).padStart(7, '0').slice(-7);
}

// True for the planner's LEO lagrange waypoint. The LEO node is
// rendered larger than a normal lagrange because the sandbox
// rocket (and eventually multiple players' rockets) park here.
function isLeoWaypoint(w) {
  return w && w.type === 'lagrange' && w.name === 'LEO';
}
const DEFAULT_ZOOM = 1.8;
// Cap the celestial body halo at this many screen pixels so extreme
// zoom doesn't turn Saturn into the entire canvas.
const HALO_MAX_SCREEN_R = 110;

// Body styling. Sites render as shaded spheres; waypoints stay as
// flat-coloured circles since they're abstract routing nodes, not
// physical objects.
// Visual sizes per body class. Hex `r` is the gameplay marker
// (uniform across body classes via HEX_R). `haloR` is the absolute
// world-space radius of the body sprite (sphere or rocky polygon),
// independent of `r` -- changing the hex size never resizes the
// body, and tuning a body's apparent size never shrinks the hex.
// Hex marker size is the gameplay token and is INDEPENDENT of the
// body sphere size. Tuning one should never change the other:
//   r      = hex marker radius (screen pixels, uniform across types)
//   haloR  = body sphere radius (world units, per body class)
// HEX_R can be changed freely without affecting how big Jupiter or
// Luna looks behind its hex.
const HEX_R = 30;
const TYPE_VIS = {
  site:           { kind: 'hex',    r: HEX_R, haloR: 20 },
  'gas-giant':    { kind: 'hex',    r: HEX_R, haloR: 48 },
  'inner-planet': { kind: 'hex',    r: HEX_R, haloR: 11 },
  planet:         { kind: 'hex',    r: HEX_R, haloR: 11 },
  dwarf:          { kind: 'hex',    r: HEX_R, haloR: 24 },
  tno:            { kind: 'hex',    r: HEX_R, haloR: 18 },
  moon:           { kind: 'hex',    r: HEX_R, haloR:  9 },
  comet:          { kind: 'hex',    r: HEX_R, haloR: 10, rocky: true },
  asteroid:       { kind: 'hex',    r: HEX_R, haloR: 10, rocky: true },
  surface:        { kind: 'hex',    r: HEX_R, haloR: 20 },
  sun:            { kind: 'sun',    r: 30 },
  lagrange:       { kind: 'circle', r:  7, fill: 'transparent', stroke: '#c66932' },
  burn:           { kind: 'circle', r:  6, hitR: 8, fill: '#d60f7a', stroke: '#fde0ee', hideBelowZoom: 1.4 },
  hohmann:        { kind: 'circle', r:  4, hitR: 9, fill: '#10b981', stroke: '#a7f3d0', hideBelowZoom: 2.5 },
  venus:          { kind: 'circle', r:  8, fill: '#fb923c', stroke: '#fed7aa' },
  radhaz:         { kind: 'circle', r:  7, fill: '#fbbf24', stroke: '#fde68a' },
  orbit:          { kind: 'circle', r:  6, fill: '#0c0a16', stroke: '#7dd3fc' },
  decorative:     { kind: 'none' },
  unknown:        { kind: 'circle', r:  4, fill: '#0c0a16', stroke: '#475569' },
};

// Per-body palette. Each entry is {base, light, dark, atmosphere?}.
// base is the equator midtone, light is the highlight near the lit
// pole, dark is the terminator side. atmosphere (when set) draws a
// soft rim glow outside the disc.
const BODY_PALETTES = {
  mercury:  { base: '#9a8773', light: '#d4c0a8', dark: '#3d3326' },
  venus:    { base: '#e8c87a', light: '#fff0c2', dark: '#7a5a1a', atmosphere: 'rgba(255, 220, 140, 0.5)' },
  earth:    { base: '#3b7fc0', light: '#8fc1ee', dark: '#0e2c4b', atmosphere: 'rgba(135, 206, 250, 0.55)' },
  luna:     { base: '#9da3ad', light: '#dfe2e8', dark: '#3a3d44' },
  mars:     { base: '#c1502e', light: '#f0a47e', dark: '#3c1408', atmosphere: 'rgba(220, 130, 90, 0.3)' },
  jupiter:  { base: '#c8a373', light: '#f3dab0', dark: '#5a3e22' },
  io:       { base: '#e6c84a', light: '#fff2a6', dark: '#5a4a12' },
  europa:   { base: '#d4cdb8', light: '#f3eee0', dark: '#5a5346' },
  ganymede: { base: '#a39788', light: '#dccfb8', dark: '#3a342c' },
  callisto: { base: '#6e6357', light: '#a89a87', dark: '#1f1c18' },
  saturn:   { base: '#dcc587', light: '#fbe9b8', dark: '#5e4f2b' },
  titan:    { base: '#caa15a', light: '#fbdfa1', dark: '#3f2f15', atmosphere: 'rgba(255, 215, 130, 0.45)' },
  enceladus:{ base: '#e1ecf5', light: '#ffffff', dark: '#5a6878' },
  iapetus:  { base: '#7a6d5c', light: '#bcae97', dark: '#272118' },
  uranus:   { base: '#9fdcd6', light: '#dff7f5', dark: '#1f5e5a', atmosphere: 'rgba(150, 220, 230, 0.45)' },
  neptune:  { base: '#3c66c7', light: '#9bb9f0', dark: '#0e1f55', atmosphere: 'rgba(120, 160, 240, 0.45)' },
  pluto:    { base: '#b59c83', light: '#e6d4be', dark: '#3a2f24' },
  charon:   { base: '#7d7164', light: '#beb2a1', dark: '#241f19' },
  ceres:    { base: '#9c9387', light: '#d4cbbd', dark: '#2f2b25' },
  vesta:    { base: '#a89989', light: '#decec0', dark: '#352d24' },
  comet:    { base: '#cfe6f0', light: '#ffffff', dark: '#3a4a55', atmosphere: 'rgba(180, 220, 240, 0.5)' },
};
const PALETTE_DEFAULTS = {
  planet:   { base: '#a8967e', light: '#e1d2bc', dark: '#2f261a' },
  moon:     { base: '#9098a3', light: '#cfd4dc', dark: '#2c2f36' },
  dwarf:    { base: '#a6a09a', light: '#d6d2cd', dark: '#34302c' },
  asteroid: { base: '#7e6f5c', light: '#b8a78c', dark: '#26201a' },
  tno:      { base: '#9ec4d2', light: '#d8eaf1', dark: '#2c3f49' },
  surface:  { base: '#a8967e', light: '#e1d2bc', dark: '#2f261a' },
  site:     { base: '#a8967e', light: '#e1d2bc', dark: '#2f261a' },
};

// Pick the palette for a site by matching a known body name keyword
// first, then falling back to the type default. Cheap substring
// check on lowercased name; precompute once on first paint.
function paletteFor(site) {
  if (site._palette) return site._palette;
  const n = (site.name || '').toLowerCase();
  for (const key of Object.keys(BODY_PALETTES)) {
    if (n.includes(key)) { site._palette = BODY_PALETTES[key]; return site._palette; }
  }
  site._palette = PALETTE_DEFAULTS[site.type] || PALETTE_DEFAULTS.asteroid;
  return site._palette;
}

// Append a smooth polyline to the current path. Standard
// "quadratic-through-midpoints" technique: each intermediate
// control point is the original node position, and the curve
// passes through the midpoint of each adjacent pair. Produces
// a C1-continuous curve that hugs the original polyline closely.
// Used for both decorative-chained edges and the route overlay so
// they share the same visual idiom.
function appendSmoothPath(ctx, pts) {
  if (!pts || pts.length < 2) return;
  if (pts.length === 2) {
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[1].x, pts[1].y);
    return;
  }
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
}

// Water droplet glyph: teardrop with a pointed top and rounded
// bottom, traced as one closed sub-path. Caller controls fill +
// stroke. Drawn at (cx, cy) with total height `h` (the point sits
// at cy - h/2, the rounded bottom at cy + h/2).
function drawDroplet(ctx, cx, cy, h) {
  const r = h * 0.32;          // bottom-circle radius
  const top = cy - h / 2;
  const ctrlY = cy + h * 0.05; // pull the bezier in toward centre
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.bezierCurveTo(cx + r * 1.5, ctrlY, cx + r, cy + h * 0.5 - r, cx, cy + h * 0.5);
  ctx.bezierCurveTo(cx - r, cy + h * 0.5 - r, cx - r * 1.5, ctrlY, cx, top);
  ctx.closePath();
}

// ----- Planet rings -----
//
// Each ring system is a list of concentric bands. Each band has:
//   r:     inner radius as a multiple of the planet radius
//   w:     band thickness (also in planet radii)
//   color: rgba fill — alpha tuned so a band sums with whatever it
//          overlaps without going opaque.
// `tilt` is the rotation in radians (Saturn's axial tilt vs. our
// viewport's horizontal). `flatten` is the vertical squash factor
// that gives the rings their viewed-from-above perspective.
//
// Saturn's bands are an approximation of the C / B / A / F ring
// system with the Cassini Division left as a gap; the other gas
// giants get a single faint dust ring tagged to their real-life
// inclinations (Uranus's rings stand nearly vertical because the
// planet rolls on its side).
const RING_DEFS = {
  saturn: {
    tilt: -0.42, flatten: 0.32,
    bands: [
      { r: 1.18, w: 0.10, color: 'rgba(110, 92, 64, 0.55)' },  // C ring
      { r: 1.30, w: 0.32, color: 'rgba(225, 195, 145, 0.92)' },// B ring (brightest)
      // Cassini Division: a deliberate gap between B and A
      { r: 1.72, w: 0.22, color: 'rgba(180, 150, 105, 0.78)' },// A ring
      { r: 1.96, w: 0.018, color: 'rgba(200, 175, 130, 0.55)' },// Encke gap edge / F ring trace
      { r: 2.04, w: 0.05, color: 'rgba(170, 145, 100, 0.40)' },// F ring (faint outer)
    ],
  },
  jupiter: {
    tilt: -0.05, flatten: 0.28,
    bands: [
      { r: 1.50, w: 0.14, color: 'rgba(140, 115, 80, 0.32)' }, // Main + halo ring (very faint)
    ],
  },
  uranus: {
    tilt: -1.48, flatten: 0.30,   // axial tilt ~98° -> rings nearly vertical
    bands: [
      { r: 1.30, w: 0.08, color: 'rgba(120, 170, 200, 0.45)' },// ε ring family
      { r: 1.48, w: 0.025,color: 'rgba(180, 220, 230, 0.30)' },
    ],
  },
  neptune: {
    tilt: -0.50, flatten: 0.30,
    bands: [
      { r: 1.40, w: 0.05, color: 'rgba(170, 195, 230, 0.30)' },
      { r: 1.62, w: 0.07, color: 'rgba(170, 195, 230, 0.45)' },// Adams ring
    ],
  },
};

// Which sites get rings: only the planet itself (matched by name
// prefix), not its moons. Site names in the data look like
// 'Saturn Aerostat', 'Jupiter Aerostat-XYZ' etc.
function ringDefFor(site) {
  const n = (site.name || '').toLowerCase();
  if (n.startsWith('saturn'))  return RING_DEFS.saturn;
  if (n.startsWith('jupiter')) return RING_DEFS.jupiter;
  if (n.startsWith('uranus'))  return RING_DEFS.uranus;
  if (n.startsWith('neptune')) return RING_DEFS.neptune;
  return null;
}

// Draw planet rings either behind or in front of the planet.
// `phase` is 'back' (clipped to the upper half of the rotated
// frame, drawn before the sphere) or 'front' (lower half, drawn
// after). Each band is an annulus stroked as one ellipse so the
// gap between bands shows through cleanly.
function drawPlanetRings(ctx, cx, cy, planetR, def, phase) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(def.tilt);

  // Clip the rotated plane to the half currently being drawn.
  ctx.save();
  ctx.beginPath();
  const clipH = planetR * 6;
  if (phase === 'back') ctx.rect(-clipH, -clipH, clipH * 2, clipH);
  else                  ctx.rect(-clipH,       0, clipH * 2, clipH);
  ctx.clip();

  for (const band of def.bands) {
    const ringR = planetR * band.r;
    const lineW = planetR * band.w;
    ctx.strokeStyle = band.color;
    ctx.lineWidth = Math.max(0.4, lineW);
    ctx.beginPath();
    ctx.ellipse(0, 0, ringR, ringR * def.flatten, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  ctx.restore();
}

// Implicit Sun anchor used by the heliocentric guide rings and the
// asteroid-belt particle field. Kept in sync with the synthetic
// Sun's position in planner-map.js (normalized 0.7443, 0.7267 in
// the 1400x900 viewport).
const SUN_X = 1042;
const SUN_Y = 654;

// Cleaned-up-view zone band: which zones get the slightly lighter
// alternating shade. Referenced only when data.mode === 'clean'.
const ZONE_BAND_LIGHT = ['Venus', 'Mars', 'Jupiter', 'Uranus'];

// Cross-platform emoji font stack. Apple Color Emoji on Mac/iOS,
// Segoe UI Emoji on Windows, Noto Color Emoji on Android / most
// Linux distros; fall through to "emoji" as a generic name. Used
// for landing 🚀 / aerobrake 🪂 / submarine 🌊 / astrobiology 🌿
// glyphs so the icons render in colour where supported and
// degrade to monochrome where they aren't.
const EMOJI_FONT = `"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", emoji`;
const EMOJI_PX   = 14;

// siteSynodic in the planner data is 'red' | 'yellow' | 'blue'. We
// translate to UI-tuned hex values; same intent, palette adapted
// to our darker backdrop.
const SYNODIC_COLOURS = {
  red:    '#f87171',
  yellow: '#facc15',
  blue:   '#60a5fa',
};

// Tiny "#rrggbb" → "rgba(r, g, b, a)" helper. Used to dim the
// canonical zone palette down to ~20% alpha so the lanes read
// as backdrop washes instead of dominating the orbital edges.
function hexToRgba(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// Irregular rocky polygon for asteroid bodies. Same offset-radial
// shading as the sphere, but the silhouette is a noisy 9-vertex
// polygon so it reads as a rock rather than a tiny planet. Each
// asteroid caches its own vertex offsets keyed off the site id so
// the silhouette is stable across frames.
// Comet: small icy nucleus, soft cyan-white coma, dust tail
// pointing away from the Sun. Drawn in world space alongside the
// other halos. r is the nucleus radius (small -- smaller than an
// asteroid).
function drawComet(ctx, cx, cy, r, site) {
  // Tail direction = unit vector from Sun to comet (so the tail
  // streams outward).
  const dx = cx - SUN_X;
  const dy = cy - SUN_Y;
  const dist = Math.hypot(dx, dy) || 1;
  const tx = dx / dist;
  const ty = dy / dist;
  const tailLen = r * 14;
  const tailEndX = cx + tx * tailLen;
  const tailEndY = cy + ty * tailLen;

  // Tail: narrow triangle from the nucleus outward, with a linear
  // gradient that fades to transparent at the tip.
  const tailGrad = ctx.createLinearGradient(cx, cy, tailEndX, tailEndY);
  tailGrad.addColorStop(0,    'rgba(195, 225, 245, 0.65)');
  tailGrad.addColorStop(0.4,  'rgba(180, 215, 240, 0.30)');
  tailGrad.addColorStop(1,    'rgba(180, 215, 240, 0)');
  ctx.fillStyle = tailGrad;
  // Perpendicular offset to give the tail width near the comet.
  const px = -ty, py = tx;
  ctx.beginPath();
  ctx.moveTo(cx + px * r * 1.0, cy + py * r * 1.0);
  ctx.lineTo(cx - px * r * 1.0, cy - py * r * 1.0);
  ctx.lineTo(tailEndX, tailEndY);
  ctx.closePath();
  ctx.fill();

  // Coma: soft glow around the nucleus.
  const coma = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 3.2);
  coma.addColorStop(0,    'rgba(220, 240, 255, 0.55)');
  coma.addColorStop(0.4,  'rgba(200, 230, 250, 0.20)');
  coma.addColorStop(1,    'rgba(200, 230, 250, 0)');
  ctx.fillStyle = coma;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 3.2, 0, Math.PI * 2);
  ctx.fill();

  // Nucleus: small icy disc with a touch of shading.
  const nuc = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r);
  nuc.addColorStop(0,    '#ffffff');
  nuc.addColorStop(0.5,  '#dbe7f0');
  nuc.addColorStop(1,    '#5e7280');
  ctx.fillStyle = nuc;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

// The Sun: a hot yellow disc with a bright core, a warm midband,
// and a wide corona haze. Drawn in world space with everything
// else; the halo extends well past the visible disc so it reads
// as "this is the star" rather than just another body. No hex
// marker -- the Sun isn't a destination.
function drawSun(ctx, cx, cy, r) {
  // Corona haze, wide and faint.
  const corona = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, r * 3.5);
  corona.addColorStop(0,    'rgba(254, 215, 100, 0.45)');
  corona.addColorStop(0.45, 'rgba(254, 180,  60, 0.12)');
  corona.addColorStop(1,    'rgba(254, 180,  60, 0)');
  ctx.fillStyle = corona;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 3.5, 0, Math.PI * 2);
  ctx.fill();

  // Disc with hot core in the centre.
  const disc = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  disc.addColorStop(0,    '#ffffff');
  disc.addColorStop(0.25, '#fff3a0');
  disc.addColorStop(0.7,  '#fbbf24');
  disc.addColorStop(1,    '#d97706');
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

// Standard radiation trefoil: three wedges at 120° around a tiny
// inner dot, centred at (cx, cy). Drawn dark against the yellow
// radhaz disc so the trefoil reads without needing a glyph font.
function drawRadiationGlyph(ctx, cx, cy, r) {
  const outerR  = r * 0.92;
  const innerR  = r * 0.28;
  const wedge   = Math.PI / 5;          // half-angle of each blade
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, a - wedge, a + wedge);
    ctx.arc(cx, cy, outerR, a + wedge, a - wedge, true);
    ctx.closePath();
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, innerR * 0.7, 0, Math.PI * 2);
  ctx.fill();
}

function drawRockyAsteroid(ctx, cx, cy, r, palette, site) {
  if (!site._rockShape) {
    const VERTS = 9;
    let seed = 0;
    for (let i = 0; i < site.id.length; i++) seed = ((seed * 31) ^ site.id.charCodeAt(i)) | 0;
    if (seed < 0) seed = -seed;
    const rand = () => {
      seed = (seed * 9301 + 49297) & 0x7fffffff;
      return (seed % 1000) / 1000;
    };
    const shape = [];
    for (let i = 0; i < VERTS; i++) {
      shape.push(0.72 + rand() * 0.36);   // 0.72..1.08 of r
    }
    site._rockShape = shape;
  }
  const verts = site._rockShape;
  const lx = cx - r * 0.35, ly = cy - r * 0.35;
  const grad = ctx.createRadialGradient(lx, ly, r * 0.05, cx, cy, r * 1.05);
  grad.addColorStop(0,    palette.light);
  grad.addColorStop(0.45, palette.base);
  grad.addColorStop(1,    palette.dark);

  ctx.beginPath();
  for (let i = 0; i < verts.length; i++) {
    const t = (i / verts.length) * Math.PI * 2;
    const vr = r * verts[i];
    const px = cx + Math.cos(t) * vr;
    const py = cy + Math.sin(t) * vr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = site.hazard ? '#f87171' : 'rgba(255,255,255,0.32)';
  ctx.stroke();
}

// Standard 2D planet shading recipe: optional outer atmosphere
// rim, a base disc, an offset-centre radial gradient for the lit
// hemisphere (light source assumed at upper-left), and a thin
// outer stroke so the disc reads against the starfield.
//
// Cheap enough at ~190 nodes per frame; no external library.
function drawShadedSphere(ctx, cx, cy, r, palette, hazard) {
  // Atmosphere glow (skipped for airless bodies).
  if (palette.atmosphere) {
    const halo = ctx.createRadialGradient(cx, cy, r * 0.85, cx, cy, r * 1.5);
    halo.addColorStop(0, palette.atmosphere);
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Base disc fills the dark side first so the gradient blends
  // into a flat colour at the terminator rather than turning
  // transparent. Light source: upper-left of the body.
  const lx = cx - r * 0.35;
  const ly = cy - r * 0.35;
  const grad = ctx.createRadialGradient(lx, ly, r * 0.05, cx, cy, r * 1.05);
  grad.addColorStop(0,    palette.light);
  grad.addColorStop(0.45, palette.base);
  grad.addColorStop(1,    palette.dark);

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Subtle outer stroke so the disc has a definite edge against
  // the dark background. Hazard bodies get a red ring instead.
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = hazard ? '#f87171' : 'rgba(255,255,255,0.4)';
  ctx.stroke();
}

export class MapRenderer {
  constructor(host, { data, onSelect } = {}) {
    this.host = host;
    this.data = data;
    this.onSelect = onSelect || null;
    this.pan = { x: 0, y: 0 };
    this.zoom = 1;
    this.fitScale = 1;
    this.dpr = window.devicePixelRatio || 1;
    this.hostW = 0;
    this.hostH = 0;
    this._route = null;             // [{from,to,dv}]
    this._routeFromId = null;
    this._routeToId = null;
    this._dragStart = null;
    this._gesture = null;
    this._rafQueued = false;
    this._tooltipEl = null;
    // Public-ish tuneables. Mutating them and calling _scheduleDraw
    // is enough for the debug panel to take effect; nothing else
    // caches them.
    this.options = {
      labelFadeMin: 2.2,
      labelFadeMax: 3.0,
      // Decoratives are routing-only (chain bend points); rendering
      // them as dots clutters the map and adds nothing the user can
      // act on. Off by default; debug panel can flip it back on.
      showDecoratives: false,
      initialZoom: DEFAULT_ZOOM,
      debug: false,
    };
    this._frameCount = 0;
    this._frameTimer = 0;
    this._fps = 0;
    this._onFrame = null;           // optional callback fired each frame
    this._partitionSites();
    this._buildStars();
    this._buildAsteroidBelt();
    this._mount();
    this._startAnimation();
  }

  // ---- public surface ----

  setRoute(segments) {
    this._route = segments && segments.length ? segments : null;
    // Pre-compute the set of hazard node ids the route crosses,
    // so the per-frame hazard-pulse pass only animates the
    // hazards the player actually needs to worry about.
    this._routeHazardIds = new Set();
    if (this._route) {
      for (const seg of this._route) {
        const sa = this.data && this.data.byId[seg.from];
        const sb = this.data && this.data.byId[seg.to];
        if (sa && sa.hazard) this._routeHazardIds.add(sa.id);
        if (sb && sb.hazard) this._routeHazardIds.add(sb.id);
      }
    }
    this._scheduleDraw();
  }

  setRouteEndpoints(fromId, toId) {
    this._routeFromId = fromId || null;
    this._routeToId = toId || null;
    this._scheduleDraw();
  }

  // Sandbox rocket: a single rocket sprite placed at a world-
  // space (x, y). canFly drives the "🚫 + transparent" overlay
  // — the renderer doesn't compute fly-ability itself; that's
  // js/game/rocket.js's canRocketFly().
  setSandboxRocket(opts) {
    this._sandboxRocket = opts || null;
    this._scheduleDraw();
  }

  // Solo: pin a "player ship" marker to a specific site. Drawn as
  // a screen-space triangle floating above the site so it's
  // visible regardless of the underlying hex.
  setPlayerShipId(id) {
    this._playerShipId = id || null;
    this._scheduleDraw();
  }

  reset() {
    this._fitToData();
    this._scheduleDraw();
  }

  // Pan + zoom to centre a specific site / waypoint in the
  // viewport. Used by the search box's "fly to" affordance.
  // `zoom` defaults to 5x which fills the cluster around a body
  // without diving into the hex's individual glyphs.
  flyTo(target, zoom = 5) {
    if (!target || typeof target.x !== 'number' || typeof target.y !== 'number') return;
    this._cancelPanAnim();
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    const eff = this.zoom * this.fitScale;
    this.pan.x = this.hostW / 2 - target.x * eff;
    this.pan.y = this.hostH / 2 - target.y * eff;
    this._scheduleDraw();
  }

  // Smoothly pan (no zoom change) to centre a world-space point.
  // Used when the user taps a site so the camera follows the
  // selection instead of jumping or staying put.
  panTo(target, { ms = 320 } = {}) {
    if (!target || typeof target.x !== 'number' || typeof target.y !== 'number') return;
    this._cancelPanAnim();
    const eff = this.zoom * this.fitScale;
    const targetPanX = this.hostW / 2 - target.x * eff;
    const targetPanY = this.hostH / 2 - target.y * eff;
    const startX = this.pan.x;
    const startY = this.pan.y;
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      // ease-out cubic — gets you near the target fast, settles softly
      const e = 1 - Math.pow(1 - k, 3);
      this.pan.x = startX + (targetPanX - startX) * e;
      this.pan.y = startY + (targetPanY - startY) * e;
      this._scheduleDraw();
      if (k < 1) this._panAnimRaf = requestAnimationFrame(step);
      else this._panAnimRaf = null;
    };
    this._panAnimRaf = requestAnimationFrame(step);
  }

  _cancelPanAnim() {
    if (this._panAnimRaf) {
      cancelAnimationFrame(this._panAnimRaf);
      this._panAnimRaf = null;
    }
  }

  // Pin a popup card to a world-space site. The renderer keeps
  // the popup's screen position in sync each frame so it tracks
  // the underlying hex as the camera pans / zooms. `actions` is
  // an optional array of { label, onClick } rendered as buttons
  // at the bottom of the popup.
  setSitePopup(site, actions = []) {
    if (!site) { this.clearSitePopup(); return; }
    this._popupSite = site;
    this._buildSitePopup(site, actions);
    // Place it at the current frame's screen position immediately
    // so the popup doesn't briefly render at (0, 0) while the
    // first draw cycle is pending.
    this._positionSitePopup();
    this._scheduleDraw();
  }

  clearSitePopup() {
    this._popupSite = null;
    if (this._popupEl) this._popupEl.classList.add('hidden');
    this._scheduleDraw();
  }

  // ---- setup ----

  _buildAsteroidBelt() {
    // Seeded particle field placed in an orbital band around the
    // Sun. Each particle stores its base angle, orbital radius, and
    // angular speed (Keplerian r^-1.5 baseline, then a per-rock
    // jitter so even rocks sharing a radius drift at noticeably
    // different rates). A small fraction get retrograde motion for
    // chaos -- captured-Trojan / family-collision flavour.
    this._beltParticles = [];
    let seed = 54321;
    const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let i = 0; i < 220; i++) {
      const angle0 = rand() * Math.PI * 2;
      const r = 360 + rand() * 200;
      const base  = 0.022 / Math.pow(r / 460, 1.5);
      const jitter = 0.45 + rand() * 1.10;       // 0.45..1.55 of baseline
      const sign  = rand() < 0.08 ? -1 : 1;       // 8% retrograde
      this._beltParticles.push({
        angle0,
        r,
        omega: base * jitter * sign,
        size: 0.6 + rand() * 1.2,
        alpha: 0.25 + rand() * 0.5,
        tint: rand() < 0.15 ? '#cbb89a' : '#8e7c66',
      });
    }
  }

  _partitionSites() {
    if (!this.data) { this._waypoints = []; this._realSites = []; return; }
    this._waypoints = this.data.sites.filter((s) => s.isWaypoint);
    this._realSites = this.data.sites.filter((s) => !s.isWaypoint);
    this._waypointsByType = new Map();
    for (const w of this._waypoints) {
      const arr = this._waypointsByType.get(w.type) || [];
      arr.push(w);
      this._waypointsByType.set(w.type, arr);
    }
    this._normalEdges = [];
    this._hazardEdges = [];
    // Seasonal edges are bucketed by the synodic season
    // ('red'|'yellow'|'blue'). Any site with siteSynodic
    // (comets AND seasonal asteroids like Icarus / Phaethon /
    // Pholus / Hermes / Bee-Zed / Asbolus) propagates its season
    // to the edges that touch it; the BFS in planner-map.js
    // extends that to adjacent lagrange / burn waypoints so the
    // whole approach corridor reads as one colour.
    this._cometEdgesBySeason = new Map();
    const straight = this.data.straightEdges || this.data.edges;
    for (const [a, b, dv] of straight) {
      const sa = this.data.byId[a], sb = this.data.byId[b];
      if (!sa || !sb) continue;
      const seg = { sa, sb, dv };
      if (sa.hazard || sb.hazard) this._hazardEdges.push(seg);
      else {
        const season = sa.siteSynodic || sb.siteSynodic;
        if (season) {
          if (!this._cometEdgesBySeason.has(season)) this._cometEdgesBySeason.set(season, []);
          this._cometEdgesBySeason.get(season).push(seg);
        }
        else this._normalEdges.push(seg);
      }
    }
    this._chains = [];
    this._hazardChains = [];
    this._cometChainsBySeason = new Map();
    for (const chain of (this.data.chains || [])) {
      const pts = chain.map((id) => this.data.byId[id]).filter(Boolean);
      if (pts.length < 2) continue;
      if (pts.some((p) => p.hazard)) this._hazardChains.push(pts);
      else {
        const seasonal = pts.find((p) => p.siteSynodic);
        if (seasonal) {
          const season = seasonal.siteSynodic;
          if (!this._cometChainsBySeason.has(season)) this._cometChainsBySeason.set(season, []);
          this._cometChainsBySeason.get(season).push(pts);
        }
        else this._chains.push(pts);
      }
    }

    // Body groups: every real site picks up a `bodyKey` in the
    // loader. We collect groups here so the renderer can draw a
    // single shared halo at the centroid of each multi-site body
    // (Mars / Luna / Mercury / Jupiter system / Saturn system).
    // The body class for the group inherits from the member with
    // the most informative type (gas-giant > inner-planet > dwarf
    // > moon > comet > asteroid > site).
    const TYPE_RANK = { 'gas-giant': 7, 'inner-planet': 6, dwarf: 5, moon: 4, comet: 3, asteroid: 2, surface: 1, site: 0 };
    this._bodyGroups = new Map();
    for (const s of this._realSites) {
      const key = s.bodyKey;
      if (!key) continue;
      let g = this._bodyGroups.get(key);
      if (!g) {
        g = { key, sites: [], sumX: 0, sumY: 0, type: s.type };
        this._bodyGroups.set(key, g);
      }
      g.sites.push(s);
      g.sumX += s.x;
      g.sumY += s.y;
      if ((TYPE_RANK[s.type] ?? -1) > (TYPE_RANK[g.type] ?? -1)) g.type = s.type;
    }
    // Pick the exemplar site (closest to centroid) for palette lookup.
    for (const g of this._bodyGroups.values()) {
      g.cx = g.sumX / g.sites.length;
      g.cy = g.sumY / g.sites.length;
      let best = g.sites[0], bestD = Infinity;
      for (const s of g.sites) {
        const dx = s.x - g.cx, dy = s.y - g.cy;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = s; }
      }
      g.exemplar = best;
    }
    // Any site whose group has 2+ members renders only its hex, not
    // its individual halo -- the group's shared halo takes over.
    this._mergedSites = new Set();
    for (const g of this._bodyGroups.values()) {
      if (g.sites.length < 2) continue;
      for (const s of g.sites) this._mergedSites.add(s.id);
    }
  }

  _buildStars() {
    // Seeded deterministic backdrop: three star size tiers + a few
    // bright glow stars. Stored as plain arrays so we can iterate
    // them straight into the canvas per frame.
    let seed = 12345;
    const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    this._stars = { small: [], med: [], bright: [] };
    for (let i = 0; i < 220; i++) {
      this._stars.small.push({ x: rand(), y: rand(), r: rand() * 0.6 + 0.2 });
    }
    for (let i = 0; i < 50; i++) {
      this._stars.med.push({ x: rand(), y: rand(), r: 1 });
    }
    for (let i = 0; i < 12; i++) {
      this._stars.bright.push({ x: rand(), y: rand() });
    }
  }

  _mount() {
    this.host.innerHTML = '';
    this.host.classList.add('map-host');

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'map-canvas';
    this.host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this._tooltipEl = document.createElement('div');
    this._tooltipEl.className = 'map-tooltip hidden';
    this.host.appendChild(this._tooltipEl);

    // Tap popup: persistent variant of the tooltip that anchors to
    // a site in world space and stays put through pan/zoom. Built
    // on demand by setSitePopup(); positioned each frame in _draw().
    this._popupEl = document.createElement('div');
    this._popupEl.className = 'map-popup hidden';
    this.host.appendChild(this._popupEl);
    this._popupSite = null;

    // Resize observer keeps the canvas pixel-perfect with whatever
    // CSS-driven size the host gets. Triggers a redraw on every
    // change including the initial mount.
    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(this.host);

    this._wirePanZoom();
    this._wireHover();

    this._resize();
    this._fitToData();
    this._scheduleDraw();
  }

  _resize() {
    // Snapshot the world-space point currently under the screen
    // centre BEFORE the host dimensions change, so we can re-pan
    // afterwards and keep that point centred. Without this, dragging
    // the sandbox hand strip up makes the visible map scroll
    // downward (the canvas shrank from the bottom but the pan didn't
    // compensate). prevFitScale > 0 gates the very first call where
    // we haven't measured yet.
    let prevCenter = null;
    if (this.hostW > 0 && this.hostH > 0 && this.fitScale > 0) {
      const prevEff = this.zoom * this.fitScale;
      prevCenter = {
        x: (this.hostW / 2 - this.pan.x) / prevEff,
        y: (this.hostH / 2 - this.pan.y) / prevEff,
      };
    }

    const rect = this.host.getBoundingClientRect();
    this.hostW = Math.max(1, rect.width);
    this.hostH = Math.max(1, rect.height);
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.hostW * this.dpr);
    this.canvas.height = Math.round(this.hostH * this.dpr);
    this.canvas.style.width = this.hostW + 'px';
    this.canvas.style.height = this.hostH + 'px';
    this.fitScale = Math.min(this.hostW / VIEW_W, this.hostH / VIEW_H);

    if (prevCenter) {
      const eff = this.zoom * this.fitScale;
      this.pan.x = this.hostW / 2 - prevCenter.x * eff;
      this.pan.y = this.hostH / 2 - prevCenter.y * eff;
    }

    this._scheduleDraw();
  }

  _fitToData() {
    this.zoom = this.options.initialZoom;
    const eff = this.zoom * this.fitScale;
    this.pan.x = (this.hostW - VIEW_W * eff) / 2;
    this.pan.y = (this.hostH - VIEW_H * eff) / 2;
  }

  // Public hooks the debug panel uses to read/observe state.
  getZoom() { return this.zoom; }
  getFps()  { return this._fps; }
  onFrame(fn) { this._onFrame = fn; }
  setOption(key, value) {
    this.options[key] = value;
    this._scheduleDraw();
  }

  // ---- drawing ----

  // Continuous animation loop: each rAF advances the shared anim
  // clock and queues a draw. Used by the asteroid-belt particle
  // sweep; cheap because the work per frame is dominated by the
  // (already batched) draw pass. Stops if the canvas is detached
  // from the DOM so we don't leak frames on view tear-down.
  _startAnimation() {
    const tick = (t) => {
      if (!this.canvas || !this.canvas.isConnected) {
        this._animRaf = null;
        return;
      }
      this._animTime = t;
      this._scheduleDraw();
      this._animRaf = requestAnimationFrame(tick);
    };
    this._animRaf = requestAnimationFrame(tick);
  }

  _scheduleDraw() {
    if (this._rafQueued) return;
    this._rafQueued = true;
    requestAnimationFrame(() => {
      this._rafQueued = false;
      this._draw();
    });
  }

  _draw() {
    const ctx = this.ctx;
    const { hostW, hostH, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this._drawBackdrop(ctx);

    const eff = this.zoom * this.fitScale;

    ctx.save();
    ctx.translate(this.pan.x, this.pan.y);
    ctx.scale(eff, eff);

    if (this.data.mode === 'clean' && Array.isArray(this.data.zones)) {
      this._drawZoneBands(ctx, this.data.zones, this.data.zoneInfo);
    }
    this._drawGuides(ctx);
    this._drawAsteroidBelt(ctx);
    // Planet halos render BEFORE edges so the body sphere sits
    // behind every other map element. The hex markers (drawn in
    // screen space later) sit on top.
    this._drawSiteHalosWorld(ctx);
    this._drawEdges(ctx);
    this._drawRoute(ctx);

    ctx.restore();

    this._drawWaypointsScreen(ctx);
    this._drawSiteHexesScreen(ctx);
    this._drawSiteLabelsScreen(ctx);
    this._drawLeoAnchorScreen(ctx);
    this._drawPlayerShipScreen(ctx);
    if (this._sandboxRocket) this._drawSandboxRocketScreen(ctx);
    // Selection ring drawn LAST so nothing — labels, ships, hexes
    // — paints over it. On mobile the in-hex orange/gold border is
    // easy to miss, so we layer a thick bright yellow ring + soft
    // halo just outside the selected node's body.
    this._drawSelectionRingScreen(ctx);
    // Turn-number pills (T2, T3, …) for planned rocket routes;
    // no-op for plain Navigate-to routes that have no turn tags.
    this._drawRouteTurnLabelsScreen(ctx);
    if (this._popupSite) this._positionSitePopup();

    // FPS book-keeping. The debug panel polls getFps(); we update
    // ~twice per second so the readout doesn't flicker.
    this._frameCount++;
    const now = performance.now();
    if (!this._frameTimer) this._frameTimer = now;
    if (now - this._frameTimer >= 500) {
      this._fps = Math.round(this._frameCount * 1000 / (now - this._frameTimer));
      this._frameCount = 0;
      this._frameTimer = now;
    }
    if (this._onFrame) this._onFrame();
  }

  _drawBackdrop(ctx) {
    const { hostW, hostH } = this;
    ctx.fillStyle = '#03020a';
    ctx.fillRect(0, 0, hostW, hostH);

    // Nebula radial gradients. Cheap to recreate each frame
    // (canvas pools them) but if profiling shows a hotspot we can
    // pre-bake an offscreen canvas.
    const nebulae = [
      { x: 0.20, y: 0.15, r: 0.55, c: '30, 58, 138' },   // blue
      { x: 0.80, y: 0.85, r: 0.55, c: '88, 28, 135' },   // violet
      { x: 0.70, y: 0.20, r: 0.50, c: '21, 94, 117' },   // cyan
      { x: 0.15, y: 0.85, r: 0.55, c: '124, 45, 18' },   // warm
    ];
    for (const n of nebulae) {
      const cx = n.x * hostW;
      const cy = n.y * hostH;
      const r = n.r * Math.max(hostW, hostH);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0,    `rgba(${n.c}, 0.35)`);
      g.addColorStop(0.6,  `rgba(${n.c}, 0.05)`);
      g.addColorStop(1,    `rgba(${n.c}, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, hostW, hostH);
    }

    // Stars in screen space so they don't pan/zoom with the universe.
    ctx.fillStyle = '#cbd5e1';
    ctx.globalAlpha = 0.55;
    for (const s of this._stars.small) {
      ctx.beginPath();
      ctx.arc(s.x * hostW, s.y * hostH, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#bae6fd';
    for (const s of this._stars.med) {
      ctx.beginPath();
      ctx.arc(s.x * hostW, s.y * hostH, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const s of this._stars.bright) {
      const sx = s.x * hostW, sy = s.y * hostH;
      ctx.fillStyle = 'rgba(125, 211, 252, 0.12)';
      ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(125, 211, 252, 0.4)';
      ctx.beginPath(); ctx.arc(sx, sy, 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(sx, sy, 1, 0, Math.PI * 2); ctx.fill();
    }
  }

  _drawGuides(ctx) {
    // Heliocentric guide rings centred on the Sun. Subtle
    // infrastructure layer.
    ctx.strokeStyle = '#1e293b';
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 0.8 / (this.zoom * this.fitScale);
    for (let i = 1; i <= 5; i++) {
      ctx.beginPath();
      ctx.arc(SUN_X, SUN_Y, 140 * i, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  _drawAsteroidBelt(ctx) {
    // Static cloud of rocky particles in the belt zone, animated:
    // each particle is sweeping around the Sun on its own orbital
    // angle. Cheap: one path per tint colour, batched fill.
    const eff = this.zoom * this.fitScale;
    // Particle size is in world units; counter-scale so dots stay
    // small even when zoomed in.
    const counter = 1 / Math.max(1, eff * 0.5);
    const t = (this._animTime || 0) / 1000;
    for (const tint of ['#8e7c66', '#cbb89a']) {
      ctx.fillStyle = tint;
      ctx.beginPath();
      for (const p of this._beltParticles) {
        if (p.tint !== tint) continue;
        const angle = p.angle0 + p.omega * t;
        const x = SUN_X + Math.cos(angle) * p.r;
        const y = SUN_Y + Math.sin(angle) * p.r;
        ctx.globalAlpha = p.alpha;
        const radius = p.size * counter;
        ctx.moveTo(x + radius, y);
        ctx.arc(x, y, radius, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  _drawZoneBands(ctx, zones, zoneInfo) {
    // Heliocentric zone lanes. Each zone gets its published
    // tint (from the iandrea gazetteer palette) at ~18% alpha so
    // it reads as a backdrop wash rather than fighting with the
    // orbital edges drawn over the top. The label calls out the
    // solar-thrust modifier (e.g. "MARS −1") so the player can
    // see at a glance how a sail's effective thrust shifts as
    // their ship moves outward. Neptune+ shows "✕" — sails are
    // dead past Uranus.
    const startY = 60;
    const bandH = (VIEW_H - 60 - 60) / zones.length;
    ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (let i = 0; i < zones.length; i++) {
      const y = startY + bandH * i;
      const info = (zoneInfo && zoneInfo[zones[i]]) || null;
      ctx.fillStyle = info
        ? hexToRgba(info.color, 0.18)
        : 'rgba(17, 20, 42, 0.30)';
      ctx.fillRect(0, y, VIEW_W, bandH);
      const mod = info && info.solar !== null
        ? (info.solar > 0 ? `+${info.solar}` : `${info.solar}`)
        : (info ? '✕' : '');
      ctx.fillStyle = '#9aa4c4';
      ctx.fillText(`${zones[i].toUpperCase()}  ${mod}`, 14, y + bandH / 2 + 2);
    }
  }

  _drawEdges(ctx) {
    // One stroke call per category. Browser batches all the line
    // segments in the path into a single GPU command.
    // - normal (sign-posted) paths : pale grey
    // - comet paths               : icy cyan-blue
    // - hazard paths              : red dashed
    const eff = this.zoom * this.fitScale;
    ctx.lineWidth = 1.4 / eff;

    // Normal "sign-posted" board routes.
    ctx.strokeStyle = '#cbd5e1';
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    for (const { sa, sb } of this._normalEdges) {
      ctx.moveTo(sa.x, sa.y);
      ctx.lineTo(sb.x, sb.y);
    }
    for (const pts of this._chains) appendSmoothPath(ctx, pts);
    ctx.stroke();

    // Comet routes are coloured by the destination comet's
    // synodic season — red, yellow, or blue — so a glance at
    // an outer-system itinerary tells you which apparition you'd
    // be chasing. One stroke pass per season.
    const seasonKeys = new Set([
      ...this._cometEdgesBySeason.keys(),
      ...this._cometChainsBySeason.keys(),
    ]);
    for (const season of seasonKeys) {
      const segs = this._cometEdgesBySeason.get(season) || [];
      const chains = this._cometChainsBySeason.get(season) || [];
      if (!segs.length && !chains.length) continue;
      ctx.strokeStyle = SYNODIC_COLOURS[season] || '#7dd3fc';
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      for (const { sa, sb } of segs) {
        ctx.moveTo(sa.x, sa.y);
        ctx.lineTo(sb.x, sb.y);
      }
      for (const pts of chains) appendSmoothPath(ctx, pts);
      ctx.stroke();
    }

    if (this._hazardEdges.length || this._hazardChains.length) {
      ctx.strokeStyle = '#f87171';
      ctx.globalAlpha = 0.7;
      ctx.setLineDash([4 / eff, 3 / eff]);
      ctx.beginPath();
      for (const { sa, sb } of this._hazardEdges) {
        ctx.moveTo(sa.x, sa.y);
        ctx.lineTo(sb.x, sb.y);
      }
      for (const pts of this._hazardChains) appendSmoothPath(ctx, pts);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  }

  _drawWaypoints(ctx) {
    const eff = this.zoom * this.fitScale;
    ctx.lineWidth = 2 / eff;
    for (const [type, items] of this._waypointsByType) {
      const vis = TYPE_VIS[type] || TYPE_VIS.unknown;
      const r = vis.r;
      ctx.beginPath();
      for (const w of items) {
        // LEO is enlarged so multiple parked rockets fit on the
        // single lagrange node without overlapping.
        const wr = isLeoWaypoint(w) ? r * 2 : r;
        ctx.moveTo(w.x + wr, w.y);
        ctx.arc(w.x, w.y, wr, 0, Math.PI * 2);
      }
      if (vis.fill !== 'transparent') {
        ctx.fillStyle = vis.fill;
        ctx.fill();
      }
      ctx.strokeStyle = vis.stroke;
      ctx.stroke();
    }
  }

  _drawSiteBodies(ctx) {
    const eff = this.zoom * this.fitScale;
    ctx.lineWidth = 2 / eff;
    // Group sites by stroke colour so we can stroke once per group.
    // Sites are ~190 so this is a small optimisation; even per-site
    // stroking is fast enough.
    for (const site of this._realSites) {
      const vis = TYPE_VIS[site.type] || TYPE_VIS.unknown;
      const r = vis.r;
      ctx.beginPath();
      if (vis.kind === 'hex') {
        for (let i = 0; i < 6; i++) {
          const t = (i / 6) * Math.PI * 2;
          const px = site.x + Math.cos(t) * r;
          const py = site.y + Math.sin(t) * r;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
      } else {
        ctx.moveTo(site.x + r, site.y);
        ctx.arc(site.x, site.y, r, 0, Math.PI * 2);
      }
      ctx.fillStyle = vis.fill;
      ctx.fill();
      ctx.strokeStyle = site.hazard ? '#f87171' : vis.stroke;
      ctx.stroke();

      // Route endpoint rings: drawn around the body, only one extra
      // stroke per highlighted endpoint.
      if (site.id === this._routeFromId || site.id === this._routeToId) {
        ctx.strokeStyle = site.id === this._routeFromId ? '#4ade80' : '#f0abfc';
        ctx.lineWidth = 3 / eff;
        ctx.beginPath();
        ctx.arc(site.x, site.y, r + 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 2 / eff;
      }
    }
  }

  _drawRoute(ctx) {
    if (!this._route) return;
    const eff = this.zoom * this.fitScale;
    ctx.lineCap = 'round';
    // Segments tagged `turn: 1` (or untagged — plain Navigate-to
    // routes have no turn data) render as the bright orange/gold
    // highlight. Segments on later turns render as a dimmer
    // dashed line; the turn number gets painted on each segment's
    // midpoint in the screen-space pass (_drawRouteTurnLabelsScreen).
    const turn1 = [];
    const laterByTurn = new Map();
    for (const seg of this._route) {
      const t = seg.turn || 1;
      if (t === 1) turn1.push(seg);
      else {
        if (!laterByTurn.has(t)) laterByTurn.set(t, []);
        laterByTurn.get(t).push(seg);
      }
    }

    // Later turns first so the bright turn-1 highlight always
    // paints on top of them at any junction.
    const sortedLater = [...laterByTurn].sort((a, b) => b[0] - a[0]);
    for (const [turn, segs] of sortedLater) {
      const alpha = Math.max(0.25, 0.65 - (turn - 2) * 0.1);
      ctx.lineWidth = 2.5 / eff;
      ctx.strokeStyle = `rgba(148, 163, 184, ${alpha})`;
      ctx.setLineDash([6 / eff, 5 / eff]);
      ctx.beginPath();
      for (const seg of segs) {
        const sa = this.data.byId[seg.from];
        const sb = this.data.byId[seg.to];
        if (!sa || !sb) continue;
        ctx.moveTo(sa.x, sa.y);
        ctx.lineTo(sb.x, sb.y);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Turn 1 — bright orange + gold-dash highlight. Same look as
    // a Navigate-to inspection route, but here it specifically
    // means "you can fly this much this turn."
    if (turn1.length) {
      ctx.lineWidth = 4 / eff;
      ctx.shadowBlur = 6 / eff;
      ctx.shadowColor = 'rgba(249, 115, 22, 0.65)';
      ctx.beginPath();
      for (const seg of turn1) {
        const sa = this.data.byId[seg.from];
        const sb = this.data.byId[seg.to];
        if (!sa || !sb) continue;
        ctx.moveTo(sa.x, sa.y);
        ctx.lineTo(sb.x, sb.y);
      }
      ctx.strokeStyle = 'rgba(249, 115, 22, 0.95)';
      ctx.stroke();
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.95)';
      ctx.setLineDash([8 / eff, 8 / eff]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
    }
  }

  // Screen-space "T2", "T3" labels at the midpoint of each later-
  // turn segment. Drawn in the screen pass so labels stay legible
  // even when zoomed out. Skipped entirely for plain Navigate-to
  // routes (they have no .turn tags).
  _drawRouteTurnLabelsScreen(ctx) {
    if (!this._route) return;
    const eff = this.zoom * this.fitScale;
    const { hostW, hostH } = this;
    ctx.save();
    ctx.font = '700 11px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const seg of this._route) {
      const t = seg.turn || 1;
      if (t <= 1) continue;
      const sa = this.data.byId[seg.from];
      const sb = this.data.byId[seg.to];
      if (!sa || !sb) continue;
      const sx = this.pan.x + ((sa.x + sb.x) / 2) * eff;
      const sy = this.pan.y + ((sa.y + sb.y) / 2) * eff;
      if (sx < -20 || sx > hostW + 20 || sy < -20 || sy > hostH + 20) continue;
      const text = `T${t}`;
      const pad = 5;
      const w = ctx.measureText(text).width + pad * 2;
      const h = 16;
      const rx = sx - w / 2, ry = sy - h / 2;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.75)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(rx, ry, w, h, 4);
      else ctx.rect(rx, ry, w, h);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText(text, sx, sy + 0.5);
    }
    ctx.restore();
  }

  _drawWaypointsScreen(ctx) {
    const eff = this.zoom * this.fitScale;
    const { hostW, hostH } = this;

    for (const [type, items] of this._waypointsByType) {
      const vis = TYPE_VIS[type] || TYPE_VIS.unknown;
      if (vis.kind === 'none') continue;     // decoratives = invisible
      // Per-type zoom gating: burn nodes only appear once zoomed
      // past their threshold so they don't speckle the wide view.
      if (vis.hideBelowZoom && this.zoom < vis.hideBelowZoom) continue;
      if (vis.kind === 'dot') {
        if (!this.options.showDecoratives) continue;
        ctx.fillStyle = vis.fill;
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        for (const w of items) {
          const sx = this.pan.x + w.x * eff;
          const sy = this.pan.y + w.y * eff;
          if (sx < -vis.r || sx > hostW + vis.r || sy < -vis.r || sy > hostH + vis.r) continue;
          ctx.moveTo(sx + vis.r, sy);
          ctx.arc(sx, sy, vis.r, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.globalAlpha = 1;
        continue;
      }
      ctx.lineWidth = 1.5;
      // Burns may carry a `landing` flag → draw as a rectangle
      // (planner-style), so split landing burns out of the normal
      // circle batch.
      const landings = type === 'burn' ? items.filter((w) => w.landing != null) : [];
      const circles  = type === 'burn' ? items.filter((w) => w.landing == null) : items;

      if (circles.length) {
        ctx.beginPath();
        for (const w of circles) {
          const sx = this.pan.x + w.x * eff;
          const sy = this.pan.y + w.y * eff;
          // LEO is enlarged to fit multiple parked rockets; bump
          // the cull margin so the bigger ring isn't clipped.
          const wr = isLeoWaypoint(w) ? vis.r * 2 : vis.r;
          if (sx < -wr || sx > hostW + wr || sy < -wr || sy > hostH + wr) continue;
          ctx.moveTo(sx + wr, sy);
          ctx.arc(sx, sy, wr, 0, Math.PI * 2);
        }
        if (vis.fill !== 'transparent') { ctx.fillStyle = vis.fill; ctx.fill(); }
        ctx.strokeStyle = vis.stroke;
        ctx.stroke();
      }

      // Pink lander rings: every burn node that carries a landing
      // flag gets a magenta disc behind the rocket glyph. Landing=1
      // paints a full disc; landing<1 paints a half disc clipped on
      // the left, matching the half-rocket glyph drawn on top.
      if (landings.length) {
        ctx.fillStyle = vis.fill;
        ctx.strokeStyle = vis.stroke;
        ctx.lineWidth = 1.5;
        const fullLandings = landings.filter((w) => w.landing >= 1);
        const halfLandings = landings.filter((w) => w.landing < 1);
        if (fullLandings.length) {
          ctx.beginPath();
          for (const w of fullLandings) {
            const sx = this.pan.x + w.x * eff;
            const sy = this.pan.y + w.y * eff;
            if (sx < -vis.r * 2 || sx > hostW + vis.r * 2 || sy < -vis.r * 2 || sy > hostH + vis.r * 2) continue;
            const ringR = vis.r * 1.4;
            ctx.moveTo(sx + ringR, sy);
            ctx.arc(sx, sy, ringR, 0, Math.PI * 2);
          }
          ctx.fill();
          ctx.stroke();
        }
        if (halfLandings.length) {
          // Half-lander disc: a half-moon — left semicircle
          // filled solid pink, right semicircle empty, with a
          // full circular outline + diameter line splitting the
          // two. The full rocket glyph rides on top in the
          // emoji pass below.
          for (const w of halfLandings) {
            const sx = this.pan.x + w.x * eff;
            const sy = this.pan.y + w.y * eff;
            if (sx < -vis.r * 2 || sx > hostW + vis.r * 2 || sy < -vis.r * 2 || sy > hostH + vis.r * 2) continue;
            const ringR = vis.r * 1.4;
            // Fill: left semicircle (top → left → bottom, close
            // with the diameter).
            ctx.beginPath();
            ctx.moveTo(sx, sy - ringR);
            ctx.arc(sx, sy, ringR, -Math.PI / 2, Math.PI / 2, true);
            ctx.closePath();
            ctx.fill();
            // Outline: full circle.
            ctx.beginPath();
            ctx.arc(sx, sy, ringR, 0, Math.PI * 2);
            ctx.stroke();
            // Diameter line separating the two halves.
            ctx.beginPath();
            ctx.moveTo(sx, sy - ringR);
            ctx.lineTo(sx, sy + ringR);
            ctx.stroke();
          }
        }
      }
      // Landing burns are now drawn as a 🚀 glyph (full or half)
      // in the per-emoji pass below; we just paint the lander disc
      // underneath here.
    }

    // Selected waypoint highlight: same yellow border + glow used
    // on selected hexes. Routed after the main waypoint fills so
    // the selection ring layers on top.
    const selectedIds = new Set();
    if (this._routeFromId) selectedIds.add(this._routeFromId);
    if (this._routeToId)   selectedIds.add(this._routeToId);
    if (selectedIds.size) {
      ctx.shadowBlur = 14;
      ctx.shadowColor = 'rgba(253, 224, 71, 0.9)';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#fde047';
      for (const w of this._waypoints) {
        if (!selectedIds.has(w.id)) continue;
        const vis = TYPE_VIS[w.type] || TYPE_VIS.unknown;
        if (vis.kind === 'none') continue;
        const sx = this.pan.x + w.x * eff;
        const sy = this.pan.y + w.y * eff;
        if (sx < -24 || sx > hostW + 24 || sy < -24 || sy > hostH + 24) continue;
        const wr = isLeoWaypoint(w) ? vis.r * 2 : vis.r;
        ctx.beginPath();
        ctx.arc(sx, sy, wr + 3, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }

    // Hazard pulse: animated red ring around hazard nodes that
    // the ACTIVE ROUTE crosses. The map already paints a red
    // border on every hazard for static identification; the
    // pulse is reserved for "your trajectory goes through this".
    // No route, no pulse.
    if (this._routeHazardIds && this._routeHazardIds.size) {
      const phase = ((this._animTime || 0) / 1000) * Math.PI;
      const pulse = (Math.sin(phase) + 1) * 0.5;
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(248, 113, 113, ${0.4 + pulse * 0.5})`;
      ctx.beginPath();
      for (const w of this._waypoints) {
        if (!this._routeHazardIds.has(w.id)) continue;
        const vis = TYPE_VIS[w.type] || TYPE_VIS.unknown;
        if (vis.kind === 'none') continue;
        const sx = this.pan.x + w.x * eff;
        const sy = this.pan.y + w.y * eff;
        if (sx < -24 || sx > hostW + 24 || sy < -24 || sy > hostH + 24) continue;
        const ringR = vis.r + 4 + pulse * 4;
        ctx.moveTo(sx + ringR, sy);
        ctx.arc(sx, sy, ringR, 0, Math.PI * 2);
      }
      ctx.stroke();
    }

    // Radhaz radiation glyph: three wedges + a centre dot drawn
    // by hand so we don't depend on the ☢ font character being
    // present. Fills only the radhaz-type waypoints.
    const radhazItems = this._waypointsByType.get('radhaz');
    if (radhazItems) {
      ctx.fillStyle = '#0c0a16';
      for (const w of radhazItems) {
        const sx = this.pan.x + w.x * eff;
        const sy = this.pan.y + w.y * eff;
        if (sx < -20 || sx > hostW + 20 || sy < -20 || sy > hostH + 20) continue;
        drawRadiationGlyph(ctx, sx, sy, TYPE_VIS.radhaz.r);
      }
    }

    // Flyby boost glyphs (~15 nodes across the map). One pass with
    // bold text labels so the gravity-assist markers from the planner
    // come through.
    ctx.font = '700 11px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(5, 4, 16, 0.85)';
    ctx.lineWidth = 3;
    for (const w of this._waypoints) {
      if (!w.flybyBoost) continue;
      const sx = this.pan.x + w.x * eff;
      const sy = this.pan.y + w.y * eff;
      if (sx < -20 || sx > hostW + 20 || sy < -20 || sy > hostH + 20) continue;
      const txt = '+' + (w.flybyBoost === 'thrust' ? 'T' : w.flybyBoost);
      ctx.strokeText(txt, sx, sy);
      ctx.fillText(txt, sx, sy);
    }

    // Lagrange "L" label inside each Lagrange ring. Small + bold so
    // the orange ring stays the dominant cue and the L just tags it.
    const lagrangeItems = this._waypointsByType.get('lagrange');
    if (lagrangeItems) {
      ctx.fillStyle = '#fdba74';
      for (const w of lagrangeItems) {
        const sx = this.pan.x + w.x * eff;
        const sy = this.pan.y + w.y * eff;
        if (sx < -20 || sx > hostW + 20 || sy < -20 || sy > hostH + 20) continue;
        // LEO's "L" scales with the enlarged node so the letter
        // doesn't look lost inside the bigger circle.
        const fontPx = isLeoWaypoint(w) ? 18 : 10;
        ctx.font = `700 ${fontPx}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillText('L', sx, sy + 0.5);
      }
    }

    // Emoji indicators for the planner's flagged routing nodes:
    //   landing == 1   -> 🚀 over a solid pink disc
    //   landing  < 1   -> 🚀 over a pink disc with a striped right half
    //   venus flyby    -> 🪂 (aerobrake)
    //   hazard nodes   -> ☠
    // Real-site emoji overlays (🌊 submarine, 🌿 astrobiology) are
    // drawn in the screen-space hex layer where the icons can sit
    // adjacent to the hex without colliding with the routing-node
    // graphics here.
    ctx.font = `${Math.max(12, EMOJI_PX)}px ${EMOJI_FONT}`;
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    for (const w of this._waypoints) {
      const sx = this.pan.x + w.x * eff;
      const sy = this.pan.y + w.y * eff;
      if (sx < -24 || sx > hostW + 24 || sy < -24 || sy > hostH + 24) continue;
      if (w.type === 'burn' && w.landing != null) {
        // Full rocket on both full and half landers — half-status
        // is now conveyed by the striped half of the pink disc
        // drawn underneath, not by a clipped glyph.
        ctx.fillText('🚀', sx, sy);
      } else if (w.type === 'venus') {
        ctx.fillText('🪂', sx, sy);
      } else if (w.hazard && w.type !== 'radhaz') {
        // radhaz already gets the trefoil; the skull marks generic
        // hazard nodes (hazard-flagged burns or lagrange points).
        ctx.fillText('☠', sx, sy);
      }
    }
  }

  // Celestial body halos drawn in WORLD space so they scale with
  // zoom and stay proportional to the surrounding layout. Capped
  // at HALO_MAX_SCREEN_R screen pixels so very high zooms don't
  // make a single body swallow the canvas. Ring-bearing planets
  // (Saturn / Jupiter / Uranus / Neptune) get the back-half of
  // their rings drawn before the sphere, then the sphere, then
  // the front-half on top so the planet sits realistically
  // through its own ring plane.
  _drawSiteHalosWorld(ctx) {
    const eff = this.zoom * this.fitScale;
    const capWorld = HALO_MAX_SCREEN_R / eff;

    // Pass 1: shared halos for merged body groups (Mars / Luna /
    // Mercury / Jupiter system / etc.). One big sphere positioned at
    // the group's centroid; the individual member sites contribute
    // only their hexes in the screen-space pass.
    for (const g of this._bodyGroups.values()) {
      if (g.sites.length < 2) continue;
      const vis = TYPE_VIS[g.type] || TYPE_VIS.unknown;
      if (vis.kind !== 'hex' && vis.kind !== 'sun') continue;
      const worldR = Math.min(vis.haloR || 20, capWorld);
      const palette = paletteFor(g.exemplar);
      const rings = ringDefFor(g.exemplar);
      if (rings) {
        drawPlanetRings(ctx, g.cx, g.cy, worldR, rings, 'back');
        drawShadedSphere(ctx, g.cx, g.cy, worldR, palette, false);
        drawPlanetRings(ctx, g.cx, g.cy, worldR, rings, 'front');
      } else {
        drawShadedSphere(ctx, g.cx, g.cy, worldR, palette, false);
      }
    }

    // Pass 2: per-site halos for everything not part of a merged
    // group, plus the special sun + comet renderings and the rocky
    // asteroid silhouettes. Synthetic flavour bodies (Earth /
    // Jupiter / Sun) draw their sphere too -- they just skip the
    // hex marker pass later.
    for (const site of this._realSites) {
      if (this._mergedSites.has(site.id)) continue;
      const vis = TYPE_VIS[site.type] || TYPE_VIS.unknown;
      if (vis.kind === 'sun')   { drawSun(ctx, site.x, site.y, vis.r); continue; }
      if (vis.kind === 'comet') { drawComet(ctx, site.x, site.y, vis.r, site); continue; }
      if (vis.kind !== 'hex') continue;
      // Per-body halo overrides. Ceres punches above its dwarf-
      // class default — shrink it 50% so it doesn't dominate the
      // belt next to Vesta / Pallas / Hygiea.
      const bodyScale = /(^|\s)ceres/i.test(site.name || '') ? 0.5 : 1;
      const worldR = Math.min(vis.haloR * bodyScale, capWorld);
      const rings = ringDefFor(site);
      if (vis.rocky) {
        drawRockyAsteroid(ctx, site.x, site.y, worldR, paletteFor(site), site);
      } else if (rings) {
        drawPlanetRings(ctx, site.x, site.y, worldR, rings, 'back');
        drawShadedSphere(ctx, site.x, site.y, worldR, paletteFor(site), site.hazard);
        drawPlanetRings(ctx, site.x, site.y, worldR, rings, 'front');
      } else {
        drawShadedSphere(ctx, site.x, site.y, worldR, paletteFor(site), site.hazard);
      }
    }
  }

  // Hex markers + endpoint rings, drawn in SCREEN space so they
  // stay readable at any zoom level.
  _drawSiteHexesScreen(ctx) {
    const eff = this.zoom * this.fitScale;
    const { hostW, hostH } = this;
    // hexS: shrink the hex marker below HEX_FULLSIZE_ZOOM so it
    // doesn't dominate the compressed view at low zoom. At and
    // above the threshold the hex sits at its full HEX_R.
    const hexS = Math.min(1, this.zoom / HEX_FULLSIZE_ZOOM);
    for (const site of this._realSites) {
      const sx = this.pan.x + site.x * eff;
      const sy = this.pan.y + site.y * eff;
      const vis = TYPE_VIS[site.type] || TYPE_VIS.unknown;
      if (vis.kind === 'sun') continue;
      // Comets used to render as a pink disc + 🚀 marker. The
      // published HF4 board draws them as real hexes — same
      // shape as planets / asteroids — with a synodic-coloured
      // outline (red / yellow / blue per season). The hex path
      // below handles them. TYPE_VIS.comet was switched to
      // kind: 'hex' so no special-case here.
      if (site.isLandable === false) continue;
      const r = vis.r * hexS;
      if (sx < -r - 20 || sx > hostW + r + 20 || sy < -r - 20 || sy > hostH + r + 20) continue;

      const isSelected = site.id === this._routeFromId || site.id === this._routeToId;
      if (vis.kind === 'hex') {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          // Flat-top hex: first vertex points right (0°), giving
          // horizontal flats on top + bottom. Text and water drops
          // are positioned separately so they stay upright.
          const t = (i / 6) * Math.PI * 2;
          const px = sx + Math.cos(t) * r;
          const py = sy + Math.sin(t) * r;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = '#0c0a16';
        ctx.fill();
        if (isSelected) {
          // Selected hex border = gold/orange stripe outline.
          // Two passes: solid orange first, then gold dashes on
          // top so the gold reads as bars between orange. We
          // moved away from solid yellow because yellow-season
          // comet rings already use that hue.
          ctx.shadowBlur = 14;
          ctx.shadowColor = 'rgba(249, 115, 22, 0.85)';
          ctx.lineWidth = 3;
          ctx.strokeStyle = '#f97316';
          ctx.setLineDash([]);
          ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = '#fbbf24';
          ctx.setLineDash([5, 5]);
          ctx.lineDashOffset = 0;
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          ctx.lineWidth = 1.6;
          // Stroke priority: hazard (red) > synodic season
          // (red / yellow / blue per the published-card colour
          // language for comets + similar season-keyed sites) >
          // default white outline.
          ctx.strokeStyle = site.hazard
            ? '#f87171'
            : (site.siteSynodic ? SYNODIC_COLOURS[site.siteSynodic] : '#ffffff');
          // Synodic-coloured hexes carry a thicker outline so
          // the season reads from across the map.
          if (site.siteSynodic) ctx.lineWidth = 2.4;
          ctx.stroke();
        }
      } else {
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(sx + r, sy);
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fillStyle = vis.fill || '#0c0a16';
        ctx.fill();
        ctx.strokeStyle = site.hazard ? '#f87171' : (vis.stroke || '#cbd5e1');
        ctx.stroke();
      }

      // Synodic colour is painted on the hex border itself
      // above — no separate outer ring needed.
      // Selected nodes are highlighted via their border + glow
      // above; no extra ring needed.
    }
  }

  // "LEO" letters anchoring the sandbox rocket's home position
  // so the player can find the launch site at a glance. Lives
  // in world space (so it pans / zooms with the map) but uses a
  // fixed pixel font size that doesn't shrink below the
  // hex-fullsize zoom threshold. Sized to read as a label and
  // offset below the anchor so the lagrange node itself stays
  // visible above the text.
  _drawLeoAnchorScreen(ctx) {
    const eff = this.zoom * this.fitScale;
    const sx = this.pan.x + LEO_ANCHOR.x * eff;
    const sy = this.pan.y + LEO_ANCHOR.y * eff;
    const fontPx = 14 * Math.max(0.6, Math.min(1.2, this.zoom / 2.5));
    const labelY = sy + fontPx * 1.4;   // sit below the node
    ctx.save();
    ctx.font = `900 ${fontPx}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.lineWidth = 4;
    ctx.strokeText('LEO', sx, labelY);
    ctx.fillStyle = '#fde047';
    ctx.fillText('LEO', sx, labelY);
    ctx.restore();
  }

  // Top-layer selection halo. The hex / waypoint passes paint a
  // subtle in-border highlight that's easy to miss on a phone, so
  // we also draw a bright outer pulse ring here AFTER everything
  // else — including labels and overlay sprites — has rendered.
  // Hits any currently-selected route endpoint (the routed `from`
  // hex is the player's "I just tapped this" target in browse.js).
  _drawSelectionRingScreen(ctx) {
    const ids = [];
    if (this._routeFromId) ids.push(this._routeFromId);
    if (this._routeToId)   ids.push(this._routeToId);
    if (!ids.length || !this.data) return;
    const eff = this.zoom * this.fitScale;
    const { hostW, hostH } = this;
    // Pulse 0..1 driven by the same anim clock the asteroid belt
    // uses. Modulates ring radius + glow alpha so the highlight
    // visibly moves — important on mobile where a static thin
    // ring fades into the map's busy background.
    const t = (this._animTime || 0) / 1000;
    const pulse = (Math.sin(t * Math.PI * 1.6) + 1) * 0.5;
    ctx.save();
    for (const id of ids) {
      const node = this.data.byId[id];
      if (!node) continue;
      const vis = TYPE_VIS[node.type] || TYPE_VIS.unknown;
      if (vis.kind === 'none') continue;
      const sx = this.pan.x + node.x * eff;
      const sy = this.pan.y + node.y * eff;
      if (sx < -60 || sx > hostW + 60 || sy < -60 || sy > hostH + 60) continue;
      // Base radius: hex marker shrinks at low zoom (see hexS),
      // so mirror that here for the ring to track the visible hex.
      const hexS = Math.min(1, this.zoom / HEX_FULLSIZE_ZOOM);
      const baseR = (vis.kind === 'hex' ? vis.r * hexS : vis.r);
      // Single bright yellow pulse ring, well outside the hex.
      // No shadow (silently dropped by some mobile GPU paths).
      // The hex's own border styling stays subtle inside the ring.
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#fde047';
      ctx.beginPath();
      ctx.arc(sx, sy, baseR + 16 + pulse * 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawPlayerShipScreen(ctx) {
    if (!this._playerShipId || !this.data) return;
    const here = this.data.byId[this._playerShipId];
    if (!here) return;
    const eff = this.zoom * this.fitScale;
    const sx = this.pan.x + here.x * eff;
    const sy = this.pan.y + here.y * eff - HEX_R - 6;
    // Down-pointing chevron so the apex anchors the site.
    ctx.fillStyle = '#fde047';
    ctx.strokeStyle = '#0c0a16';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx, sy + 6);
    ctx.lineTo(sx - 7, sy - 6);
    ctx.lineTo(sx + 7, sy - 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // Draw the sandbox rocket sprite at world-space (x, y).
  // canFly drives a transparency + 🚫 overlay; the renderer
  // doesn't compute fly-ability itself.
  _drawSandboxRocketScreen(ctx) {
    const r = this._sandboxRocket;
    if (!r) return;
    const eff = this.zoom * this.fitScale;
    const sx = this.pan.x + r.x * eff;
    const sy = this.pan.y + r.y * eff;
    const { width: spriteW, height: spriteH } = getRocketSpriteSize();
    const scale = 0.55;     // map-scale; 35×53 px on screen.
    const w = spriteW * scale;
    const h = spriteH * scale;
    const px = sx - w / 2;
    const py = sy - h - 2;  // foot of rocket above the anchor
    ctx.save();
    if (!r.canFly) ctx.globalAlpha = 0.5;
    ctx.drawImage(getRocketSprite(r.colour || 'yellow'), px, py, w, h);
    if (!r.canFly) {
      ctx.globalAlpha = 1;
      ctx.font = `${Math.round(h * 0.7)}px ${EMOJI_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🚫', sx, py + h / 2);
    }
    ctx.restore();
    // Stash the screen-space bounding box for hit-testing.
    this._sandboxRocketBox = {
      x: px, y: py, w, h,
    };
  }

  // Returns true if (sx, sy) screen-space pixel lies inside the
  // last-drawn rocket sprite. Used by the click handler to open
  // the stack panel.
  hitTestSandboxRocket(sx, sy) {
    const b = this._sandboxRocketBox;
    if (!b) return false;
    return sx >= b.x && sx <= b.x + b.w
        && sy >= b.y && sy <= b.y + b.h;
  }

  _drawSiteLabelsScreen(ctx) {
    const eff = this.zoom * this.fitScale;
    const { hostW, hostH } = this;
    const fadeMin = this.options.labelFadeMin;
    const fadeMax = this.options.labelFadeMax;
    const labelAlpha = Math.max(0, Math.min(1,
      (this.zoom - fadeMin) / Math.max(0.01, fadeMax - fadeMin)
    ));
    // Same proportional shrink as _drawSiteHexesScreen so the
    // size text / droplets / flag glyphs ride with the hex they
    // sit inside instead of floating loose when the hex shrinks
    // below the HEX_FULLSIZE_ZOOM threshold.
    const hexS = Math.min(1, this.zoom / HEX_FULLSIZE_ZOOM);

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    for (const site of this._realSites) {
      const sx = this.pan.x + site.x * eff;
      const sy = this.pan.y + site.y * eff;
      if (sx < -40 || sx > hostW + 40 || sy < -40 || sy > hostH + 40) continue;
      const vis = TYPE_VIS[site.type] || TYPE_VIS.unknown;
      const r = vis.r * hexS;

      // Site size text in the upper half of the hex. Tuned so it
      // clears the centre flag glyphs (🌊 / 🌿 / ⛅) with a small
      // gap; previous 0.55-of-radius / 0.32-offset overlapped.
      if (site.siteSize) {
        ctx.font = `700 ${Math.max(8, Math.round(r * 0.42))}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(site.siteSize, sx, sy - r * 0.50);
      }

      // Water droplets in the lower half of the hex, one teardrop
      // per hydration unit (capped at 4 so they fit). Smaller +
      // pushed further down for the same reason as the size text:
      // gives the centre flag glyphs breathing room.
      if (site.hydration) {
        const count = Math.min(4, site.hydration);
        const dropH = r * 0.32;
        const dropW = dropH * 0.62;
        const gap   = Math.max(1, r * 0.08);
        const totalW = count * dropW + (count - 1) * gap;
        const startX = sx - totalW / 2 + dropW / 2;
        const dropY  = sy + r * 0.52;
        ctx.fillStyle = '#60a5fa';
        ctx.strokeStyle = 'rgba(15, 30, 60, 0.85)';
        ctx.lineWidth = 0.8;
        for (let i = 0; i < count; i++) {
          drawDroplet(ctx, startX + i * (dropW + gap), dropY, dropH);
          ctx.fill();
          ctx.stroke();
        }
      }

      if (site.hazard) {
        ctx.fillStyle = '#f87171';
        ctx.font = `${Math.max(8, Math.round(r * 0.9))}px ui-monospace, menlo, monospace`;
        ctx.fillText('☠', sx, sy);
      }

      // Site-flag glyphs ride on the hex centre — 🌊 submarine,
      // 🌿 astrobiology, ⛅ aerostat (atmospheric). One flag sits
      // dead-centre; multiples spread horizontally so they all
      // fit inside the larger HEX_R. Comets don't take a hex,
      // so for them we tuck the row above the lander disc to
      // keep the 🚀 glyph readable.
      const flags = [];
      if (site.submarine)    flags.push('🌊');
      if (site.astrobiology) flags.push('🌿');
      if (site.atmospheric)  flags.push('⛅');
      if (flags.length) {
        const emoji = Math.max(8, EMOJI_PX * hexS);
        ctx.font = `${emoji}px ${EMOJI_FONT}`;
        const dy = vis.kind === 'comet' ? -emoji - 4 : 0;
        const spread = emoji * 0.7;
        const startX = sx - spread * (flags.length - 1) / 2;
        for (let i = 0; i < flags.length; i++) {
          ctx.fillText(flags[i], startX + i * spread, sy + dy);
        }
      }

      if (labelAlpha > 0) {
        ctx.globalAlpha = labelAlpha;
        const labelOffset = vis.r + 12;
        ctx.font = '500 11px ui-sans-serif, system-ui, sans-serif';
        ctx.strokeStyle = 'rgba(5, 4, 16, 0.85)';
        ctx.lineWidth = 3;
        ctx.strokeText(site.name, sx, sy + labelOffset);
        ctx.fillStyle = '#cbd5e1';
        ctx.fillText(site.name, sx, sy + labelOffset);
        ctx.globalAlpha = 1;
      }
    }

    if (this._route) {
      ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = '#fde047';
      ctx.strokeStyle = 'rgba(5, 4, 16, 0.85)';
      ctx.lineWidth = 3;
      for (const seg of this._route) {
        const sa = this.data.byId[seg.from];
        const sb = this.data.byId[seg.to];
        if (!sa || !sb) continue;
        const mx = this.pan.x + ((sa.x + sb.x) / 2) * eff;
        const my = this.pan.y + ((sa.y + sb.y) / 2) * eff - 4;
        ctx.strokeText(String(seg.dv), mx, my);
        ctx.fillText(String(seg.dv), mx, my);
      }
    }
  }

  // ---- input ----

  _wirePanZoom() {
    this.canvas.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const sx = ev.clientX - rect.left;
      const sy = ev.clientY - rect.top;
      const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
      this._zoomAt(sx, sy, factor);
    }, { passive: false });

    this.canvas.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return;
      this._dragStart = {
        x: ev.clientX, y: ev.clientY,
        panX: this.pan.x, panY: this.pan.y,
        moved: false,
      };
    });
    window.addEventListener('mousemove', (ev) => {
      if (!this._dragStart) return;
      const dx = ev.clientX - this._dragStart.x;
      const dy = ev.clientY - this._dragStart.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) this._dragStart.moved = true;
      this.pan.x = this._dragStart.panX + dx;
      this.pan.y = this._dragStart.panY + dy;
      this._scheduleDraw();
    });
    window.addEventListener('mouseup', () => { this._dragStart = null; });

    // Click dispatched only if the mousedown→mouseup didn't drag.
    this.canvas.addEventListener('click', (ev) => {
      // Mobile browsers fire a synthesized `click` right after a
      // touchend even with `touch-action: none`. The touchend
      // handler already called onSelect for the tap; if we let
      // this click also call onSelect the second invocation
      // matches _selectedId and immediately DESELECTS — that's
      // why on mobile the popup + ring "show up and close right
      // away." Bail when a recent touch interaction owned the
      // event. _touchActive is set in _wireHover (same flag that
      // suppresses the hover tooltip on touch).
      if (this._touchActive) return;
      if (this._dragStart && this._dragStart.moved) return;
      // Rocket sits on top of the map so test it first; if the
      // click landed inside the rocket sprite we fire a
      // sandbox-rocket event instead of a site select.
      const rect = this.canvas.getBoundingClientRect();
      const scx = ev.clientX - rect.left;
      const scy = ev.clientY - rect.top;
      if (this.hitTestSandboxRocket(scx, scy)) {
        if (this.onSandboxRocketClick) this.onSandboxRocketClick();
        return;
      }
      const pt = this._eventToWorld(ev);
      const hit = this._hitTest(pt.x, pt.y);
      if (this.options.debug) this._emitDebugClick(pt, hit);
      if (hit && this.onSelect) this.onSelect(hit);
    });

    // Touch: 1 finger pan, 2 fingers pinch.
    this.canvas.addEventListener('touchstart', (ev) => {
      this._gesture = {
        touches: this._activeTouches(ev).slice(0, 2),
        pan: { x: this.pan.x, y: this.pan.y },
        zoom: this.zoom,
        moved: false,
      };
    }, { passive: false });
    this.canvas.addEventListener('touchmove', (ev) => {
      ev.preventDefault();
      if (!this._gesture) return;
      const rect = this.canvas.getBoundingClientRect();
      const points = this._activeTouches(ev);
      if (points.length === 1 && this._gesture.touches.length === 1) {
        const t0 = this._gesture.touches[0];
        const dx = points[0].clientX - t0.clientX;
        const dy = points[0].clientY - t0.clientY;
        // Manhattan threshold for "this is a drag, not a tap".
        // A finger naturally wobbles a few pixels when tapping a
        // small target on a phone screen; 3 px was rejecting
        // legitimate taps as drags. 10 px is conservative enough
        // that intentional drags still register.
        if (Math.abs(dx) + Math.abs(dy) > 10) this._gesture.moved = true;
        this.pan.x = this._gesture.pan.x + dx;
        this.pan.y = this._gesture.pan.y + dy;
        this._scheduleDraw();
      } else if (points.length >= 2 && this._gesture.touches.length >= 2) {
        this._gesture.moved = true;
        const sa = this._gesture.touches[0];
        const sb = this._gesture.touches[1];
        const startMidX = (sa.clientX + sb.clientX) / 2;
        const startMidY = (sa.clientY + sb.clientY) / 2;
        const startDist = Math.hypot(sa.clientX - sb.clientX, sa.clientY - sb.clientY) || 1;
        const na = points[0], nb = points[1];
        const midX = (na.clientX + nb.clientX) / 2;
        const midY = (na.clientY + nb.clientY) / 2;
        const dist = Math.hypot(na.clientX - nb.clientX, na.clientY - nb.clientY) || 1;
        const factor = dist / startDist;
        const targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this._gesture.zoom * factor));
        const eff0 = this._gesture.zoom * this.fitScale;
        const wx = (startMidX - rect.left - this._gesture.pan.x) / eff0;
        const wy = (startMidY - rect.top - this._gesture.pan.y) / eff0;
        const eff1 = targetZoom * this.fitScale;
        this.pan.x = (midX - rect.left) - wx * eff1;
        this.pan.y = (midY - rect.top) - wy * eff1;
        this.zoom = targetZoom;
        this._scheduleDraw();
      }
    }, { passive: false });
    this.canvas.addEventListener('touchend', (ev) => {
      if (ev.touches.length === 0) {
        // Treat a no-drift tap as a click.
        if (this._gesture && !this._gesture.moved) {
          const last = this._gesture.touches[0];
          if (last) {
            const pt = this._eventToWorld(last);
            const hit = this._hitTest(pt.x, pt.y);
            if (this.options.debug) this._emitDebugClick(pt, hit);
            if (hit && this.onSelect) this.onSelect(hit);
          }
        }
        this._gesture = null;
      } else {
        this._gesture = {
          touches: this._activeTouches(ev).slice(0, 2),
          pan: { x: this.pan.x, y: this.pan.y },
          zoom: this.zoom,
          moved: this._gesture ? this._gesture.moved : false,
        };
      }
    });
    this.canvas.addEventListener('touchcancel', () => { this._gesture = null; });
  }

  _activeTouches(ev) {
    const out = [];
    const list = ev.touches || [ev];
    for (const t of list) out.push({ clientX: t.clientX, clientY: t.clientY });
    return out;
  }

  _zoomAt(sx, sy, factor) {
    const eff0 = this.zoom * this.fitScale;
    const wx = (sx - this.pan.x) / eff0;
    const wy = (sy - this.pan.y) / eff0;
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
    const eff1 = next * this.fitScale;
    this.pan.x = sx - wx * eff1;
    this.pan.y = sy - wy * eff1;
    this.zoom = next;
    this._scheduleDraw();
  }

  _eventToWorld(ev) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = ev.clientX - rect.left;
    const sy = ev.clientY - rect.top;
    const eff = this.zoom * this.fitScale;
    return { x: (sx - this.pan.x) / eff, y: (sy - this.pan.y) / eff };
  }

  // Console output for debug mode taps. Logs the world-space click,
  // the normalised 0..1 coords (matches the planner's storage
  // format, so it's easy to cross-reference data-hf4.json), and any
  // node hit. Real sites get their full record dumped.
  _emitDebugClick(pt, hit) {
    const info = {
      world: { x: Math.round(pt.x * 10) / 10, y: Math.round(pt.y * 10) / 10 },
      normalized: {
        x: Math.round((pt.x / VIEW_W) * 10000) / 10000,
        y: Math.round((pt.y / VIEW_H) * 10000) / 10000,
      },
      zoom: Math.round(this.zoom * 100) / 100,
    };
    if (hit) {
      info.hit = {
        id: hit.id,
        name: hit.name,
        type: hit.type,
        siteSize: hit.siteSize,
        hydration: hit.hydration,
        hazard: hit.hazard,
      };
    }
    // eslint-disable-next-line no-console
    console.log('[map debug] click', info);
  }

  // JS hit-test against every site, preferring real sites within a
  // generous radius (so a tap on the hex always wins over a stray
  // waypoint hit). ~1500 distance computations is sub-millisecond.
  _hitTest(wx, wy) {
    const eff = this.zoom * this.fitScale;
    const sx = this.pan.x + wx * eff;
    const sy = this.pan.y + wy * eff;
    let best = null;
    let bestDist = 22 * 22;
    for (const s of this._realSites) {
      const vis = TYPE_VIS[s.type] || TYPE_VIS.unknown;
      if (vis.kind === 'sun')   continue;
      if (s.isLandable === false) continue;
      const dx = (this.pan.x + s.x * eff) - sx;
      const dy = (this.pan.y + s.y * eff) - sy;
      const d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; best = s; }
    }
    if (best) return best;
    // Waypoints: hit radius can be larger than the visible disc
    // (e.g. hohmann is 2px painted but accepts a 10px click).
    let bestRad = 0;
    for (const w of this._waypoints) {
      if (w.isDecorative) continue;
      const vis = TYPE_VIS[w.type] || TYPE_VIS.unknown;
      if (vis.kind === 'none') continue;
      const baseR = isLeoWaypoint(w) ? vis.r * 2 : vis.r;
      const hitR = (vis.hitR != null ? vis.hitR : Math.max(baseR, 8)) + 2;
      const dx = (this.pan.x + w.x * eff) - sx;
      const dy = (this.pan.y + w.y * eff) - sy;
      const d = dx * dx + dy * dy;
      if (d <= hitR * hitR && (best == null || d < bestRad)) {
        best = w; bestRad = d;
      }
    }
    return best;
  }

  _wireHover() {
    // Mouse hover -> tooltip. Throttled by mousemove cadence which is
    // already capped by the browser; we do the hit-test work cheaply
    // and update DOM only on identity change.
    //
    // Mobile browsers synthesize mousemove/mouseover events from touch
    // taps even with `touch-action: none` (Chrome on Android does this
    // reliably). That fired the hover tooltip on top of the tap popup,
    // producing the "two popups" bug. _touchActive is set true on
    // touchstart and cleared with a short tail after touchend; while
    // it's true we skip the tooltip entirely so the tap popup is the
    // only thing the player sees.
    this._touchActive = false;
    let touchTailTimer = null;
    const markTouch = () => {
      this._touchActive = true;
      this._hideTooltip();
      if (touchTailTimer) clearTimeout(touchTailTimer);
    };
    const releaseTouch = () => {
      if (touchTailTimer) clearTimeout(touchTailTimer);
      // Keep the lockout for a moment after touchend so the
      // synthesized mousemove that fires right after the tap is
      // still suppressed.
      touchTailTimer = setTimeout(() => {
        this._touchActive = false;
      }, 800);
    };
    this.canvas.addEventListener('touchstart',  markTouch,   { passive: true });
    this.canvas.addEventListener('touchmove',   markTouch,   { passive: true });
    this.canvas.addEventListener('touchend',    releaseTouch);
    this.canvas.addEventListener('touchcancel', releaseTouch);

    let lastId = null;
    this.canvas.addEventListener('mousemove', (ev) => {
      if (this._touchActive) return;       // tap path owns the popup
      const pt = this._eventToWorld(ev);
      const hit = this._hitTest(pt.x, pt.y);
      const id = hit ? hit.id : null;
      if (id === lastId) {
        if (hit) this._positionTooltip(ev);
        return;
      }
      lastId = id;
      if (!hit) { this._hideTooltip(); return; }
      this._showTooltipFor(hit, ev);
    });
    this.canvas.addEventListener('mouseleave', () => {
      lastId = null;
      this._hideTooltip();
    });
  }

  _buildSitePopup(site, actions) {
    const el = this._popupEl;
    if (!el) return;
    el.innerHTML = '';
    const name = document.createElement('div');
    name.className = 't-name';
    name.textContent = site.name || '';
    const meta = document.createElement('div');
    meta.className = 't-meta';
    const parts = [];
    if (site.type)     parts.push(site.type);
    if (site.siteSize) parts.push(site.siteSize);
    if (site.hydration) parts.push('💧'.repeat(site.hydration));
    if (site.hazard)   parts.push('⚠ hazard');
    meta.textContent = parts.join(' · ');
    el.appendChild(name);
    if (meta.textContent) el.appendChild(meta);
    // Node id2 — a human-friendly stable reference generated at
    // data-load time (see planner-map.js#makeRefId). Reads as
    // e.g. "comet-borrelly", "dresda", "lag-leo", "burn-3a2b9".
    // The raw vendor float id stays on the title for the rare
    // case someone needs to grep the planner JSON directly.
    if (site.id2 || site.id) {
      const idRow = document.createElement('div');
      idRow.className = 't-id';
      idRow.textContent = `id: ${site.id2 || shortRefId(site.id)}`;
      idRow.title = `Tap to select, then copy. (raw key: ${site.id})`;
      el.appendChild(idRow);
    }
    if (actions && actions.length) {
      const row = document.createElement('div');
      row.className = 'popup-actions';
      for (const a of actions) {
        if (!a || !a.label) continue;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = a.primary ? 'popup-btn primary' : 'popup-btn';
        b.textContent = a.label;
        b.disabled = !!a.disabled;
        if (a.onClick) b.addEventListener('click', a.onClick);
        row.appendChild(b);
      }
      el.appendChild(row);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'popup-close';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    close.addEventListener('click', () => {
      this.clearSitePopup();
      if (this._onPopupClose) this._onPopupClose();
    });
    el.appendChild(close);
    el.classList.remove('hidden');
  }

  // Re-anchor the popup to its site's current screen position.
  // Called from _draw so it tracks pan + zoom + smooth animations.
  _positionSitePopup() {
    const el = this._popupEl;
    if (!el || !this._popupSite) return;
    const eff = this.zoom * this.fitScale;
    const sx = this.pan.x + this._popupSite.x * eff;
    const sy = this.pan.y + this._popupSite.y * eff;
    el.style.left = `${sx}px`;
    el.style.top  = `${sy}px`;
  }

  onPopupClose(fn) { this._onPopupClose = fn || null; }

  _showTooltipFor(site, ev) {
    const t = this._tooltipEl;
    t.innerHTML = `
      <div class="t-name"></div>
      <div class="t-meta">
        <span class="t-type"></span>
        <span class="t-size"></span>
        <span class="t-hydr"></span>
        <span class="t-hazard"></span>
      </div>
    `;
    t.querySelector('.t-name').textContent = site.name;
    t.querySelector('.t-type').textContent = site.type;
    t.querySelector('.t-size').textContent = site.siteSize || '';
    t.querySelector('.t-hydr').textContent = site.hydration ? '💧'.repeat(site.hydration) : '';
    t.querySelector('.t-hazard').textContent = site.hazard ? '⚠ hazard' : '';
    t.classList.remove('hidden');
    this._positionTooltip(ev);
  }

  _positionTooltip(ev) {
    const t = this._tooltipEl;
    const hb = this.host.getBoundingClientRect();
    t.style.left = (ev.clientX - hb.left) + 'px';
    t.style.top  = (ev.clientY - hb.top - 8) + 'px';
  }

  _hideTooltip() {
    this._tooltipEl.classList.add('hidden');
  }
}
