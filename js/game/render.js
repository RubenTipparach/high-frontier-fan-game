import { getRocketSprite, getRocketSpriteSize } from './rocket-sprite.js';
import { thrustVisual } from './card-ui.js';
import { assetUrl } from '../base.js';

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

// Ray-casting point-in-polygon test (world coords). Used by the
// debug zone painter to decide which nodes a hand-drawn lasso
// contains.
function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Zoom level at which the hex marker (and its size text /
// hydration droplets / centre flag glyphs) reaches its full
// HEX_R size. Below this threshold the hex shrinks
// proportionally so it doesn't dominate the small-scale,
// zoomed-out view - and so two adjacent hexes don't visually
// merge when the world spacing is compressed. At and above
// this zoom level the hex is rendered at full size.
const HEX_FULLSIZE_ZOOM = 2.5;

// World-space anchor of LEO - the sandbox rocket's home and
// the big yellow "LEO" label rendered on the map. Exported so
// the Sandbox "Stack" button in the hand header can centre
// the map on it. Coordinates match the LEO lagrange waypoint
// in the planner JSON (nx=0.8526, ny=0.8215) scaled to the
// 1400×900 view used by loadPlannerMap(), so the label sits on
// the actual LEO node rather than floating off near Itokawa.
export const LEO_ANCHOR = { x: 1193.6, y: 739.3 };

// Short, stable, copy-friendly reference for a planner node id.
// The upstream vendor data keys nodes by random floats like
// "0.9483763498218554" - useless as something a player can quote
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
const DEFAULT_ZOOM        = 6;
const MOBILE_DEFAULT_ZOOM = 5;
// Remembered viewport (world-center + zoom), saved on every user pan / zoom
// so reopening the page lands where the player left off.
const LS_CAMERA = 'hf.mapCamera';
// Mobile viewports (≤720 px) open the map slightly farther
// out than desktop - the canvas is denser per pixel + a closer
// initial zoom hides too much of the system at a glance.
function _isMobileViewport() {
  try {
    // Touch devices count as "mobile" regardless of reported width:
    // tablets and landscape phones can exceed 720 CSS px, so a pure
    // width query misses them. pointer:coarse / maxTouchPoints catch
    // the touch hardware directly.
    return window.matchMedia('(max-width: 720px)').matches
      || window.matchMedia('(pointer: coarse)').matches
      || (navigator.maxTouchPoints || 0) > 1;
  } catch { return false; }
}
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

// Spectral colour key for factory chits. Mirrors the
// .industrialize-spectral-badge palette in css/map.css so the
// modal and the map use one visual vocabulary. C carbon /
// S stony / M metallic / V Vesta / D dark / H hydrous.
const SPECTRAL_FILL = {
  C: '#475569', S: '#ca8a04', M: '#9ca3af',
  V: '#b91c1c', D: '#1e3a8a', H: '#0ea5e9',
};
const SPECTRAL_INK = {
  C: '#f8fafc', S: '#fefce8', M: '#111827',
  V: '#fef2f2', D: '#dbeafe', H: '#f0f9ff',
};

// Stage-3 factory sprites (baked by scripts/gen-factory-sprites.mjs). The base
// art is one PNG per seat colour; the dome is a separate PNG baked at the SAME
// canvas + origin, so it composites onto the install pad just by drawing at the
// same destination rect. ANCHOR_F* is the baked ground-centre as a fraction of
// the sprite (pinned to the site); LABEL_FY is where the player-coloured
// {size}{spectral} | {outpost} label sits.
const FACTORY_SPRITE_W = 184, FACTORY_SPRITE_H = 214;
const FACTORY_ANCHOR_FX = 0.5753, FACTORY_ANCHOR_FY = 0.7196;
const FACTORY_CENTER_FY = 0.62;   // building's visual centre (for centring on a site)
const FACTORY_LABEL_FY = 0.7664;
const FACTORY_SPRITE_K = 4.2;   // on-screen sprite width = r * K (tune for scale)

// Darken a #rrggbb colour toward black (f < 1); returns rgb() so canvas reads it.
function shadeHex(c, f) {
  if (typeof c !== 'string' || c[0] !== '#' || c.length < 7) return c;
  const r = Math.round(parseInt(c.slice(1, 3), 16) * f);
  const g = Math.round(parseInt(c.slice(3, 5), 16) * f);
  const b = Math.round(parseInt(c.slice(5, 7), 16) * f);
  return `rgb(${r},${g},${b})`;
}
// Pick a legible ink (dark on light seat colours, white on dark ones).
function inkOn(c) {
  if (typeof c !== 'string' || c[0] !== '#' || c.length < 7) return '#ffffff';
  const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? '#15120f' : '#ffffff';
}

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
  venus:          { kind: 'circle', r:  8, fill: 'transparent', stroke: 'transparent' },
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

// Punch a hex colour up into a richer version for the zone fills:
// the canonical palette is pale/pastel and washes out under a low
// overlay alpha, so we cap lightness and floor saturation. Dark zones
// (Saturn / Neptune) also get lifted so their fill stays visible.
function vividHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  const d = max - min;
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  const nl = Math.max(0.40, Math.min(0.60, l));   // pull toward a mid lightness
  const ns = Math.max(0.62, s);                    // floor the saturation
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = nl < 0.5 ? nl * (1 + ns) : nl + ns - nl * ns;
  const p = 2 * nl - q;
  const to = (x) => Math.round(hue2rgb(p, q, x) * 255).toString(16).padStart(2, '0');
  return `#${to(h + 1 / 3)}${to(h)}${to(h - 1 / 3)}`;
}

// Smooth CLOSED loop through `pts` (quadratic midpoints, wrapping
// around). Renders a rounded blob through the polygon's edge
// midpoints with each vertex as a control point. Used for curved
// zone borders.
function appendSmoothClosedPath(ctx, pts) {
  const n = pts.length;
  if (n < 3) {
    if (!n) return;
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    return;
  }
  const sx = (pts[n - 1].x + pts[0].x) / 2;
  const sy = (pts[n - 1].y + pts[0].y) / 2;
  ctx.moveTo(sx, sy);
  for (let i = 0; i < n; i++) {
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    ctx.quadraticCurveTo(cur.x, cur.y, (cur.x + next.x) / 2, (cur.y + next.y) / 2);
  }
  ctx.closePath();
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

// Push-sat marker: a beamed-power relay drawn at (cx, cy), matching
// the card's push-sat glyph (card-ui.js#tvPushsat) - two solar panels
// flanking a body + dish, with two downward beam chevrons. `size` is
// the visual height in screen pixels; the glyph is centred on (cx, cy).
function drawPushSat(ctx, cx, cy, size) {
  // Native glyph units span roughly 19 wide x 15 tall; scale so the
  // height reads about `size`, then centre it vertically (the beams
  // hang below the body, so shift up a touch).
  const k = size / 15;
  ctx.save();
  ctx.translate(cx, cy - 2.6 * k);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // Solar panels (left + right).
  ctx.fillStyle = '#5aa0e0';
  ctx.strokeStyle = '#cde6ff';
  ctx.lineWidth = 0.8 * k;
  for (const px of [-9.5, 3.5]) {
    ctx.beginPath();
    ctx.rect(px * k, -3.2 * k, 6 * k, 6.4 * k);
    ctx.fill();
    ctx.stroke();
  }
  // Body (rounded) + dish.
  ctx.fillStyle = '#cbd5e1';
  ctx.strokeStyle = '#7b8aa3';
  const bx = -3 * k, by = -4.2 * k, bw = 6 * k, bh = 8.4 * k, br = 1.2 * k;
  ctx.beginPath();
  ctx.moveTo(bx + br, by);
  ctx.arcTo(bx + bw, by, bx + bw, by + bh, br);
  ctx.arcTo(bx + bw, by + bh, bx, by + bh, br);
  ctx.arcTo(bx, by + bh, bx, by, br);
  ctx.arcTo(bx, by, bx + bw, by, br);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -0.2 * k, 1.5 * k, 0, Math.PI * 2);
  ctx.fillStyle = '#7b8aa3';
  ctx.fill();
  // Two downward beam chevrons.
  ctx.strokeStyle = '#9fd0ff';
  ctx.lineWidth = 1.5 * k;
  for (const oy of [6.2, 8.8]) {
    ctx.beginPath();
    ctx.moveTo(-3 * k, oy * k);
    ctx.lineTo(0, (oy + 2.4) * k);
    ctx.lineTo(3 * k, oy * k);
    ctx.stroke();
  }
  ctx.restore();
}

// ----- Planet rings -----
//
// Each ring system is a list of concentric bands. Each band has:
//   r:     inner radius as a multiple of the planet radius
//   w:     band thickness (also in planet radii)
//   color: rgba fill - alpha tuned so a band sums with whatever it
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

// Dark vs light ink for text over a #rrggbb fill, from its luminance.
// Used so an outpost chit's letter stays legible on any seat colour.
function _readableInkHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return '#dbeafe';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.6 ? '#0c0a16' : '#ffffff';
}

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
//
// The two radial gradients are built once (buildSunGrads) and reused
// every frame: they're defined in WORLD coordinates, which never change,
// and the canvas applies the live pan/zoom transform at fill time - so a
// cached gradient lands in the right place at any camera pose. That keeps
// drawSun off the per-frame createRadialGradient + addColorStop path
// (this draws 60x/s under the ambient animation loop) with zero change to
// the pixels. Sized/capped exactly like the old per-frame version.
function buildSunGrads(ctx, cx, cy, r) {
  // Corona haze, wide and faint.
  const corona = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, r * 3.5);
  corona.addColorStop(0,    'rgba(254, 215, 100, 0.45)');
  corona.addColorStop(0.45, 'rgba(254, 180,  60, 0.12)');
  corona.addColorStop(1,    'rgba(254, 180,  60, 0)');
  // Disc with hot core in the centre.
  const disc = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  disc.addColorStop(0,    '#ffffff');
  disc.addColorStop(0.25, '#fff3a0');
  disc.addColorStop(0.7,  '#fbbf24');
  disc.addColorStop(1,    '#d97706');
  return { corona, disc, cx, cy, r };
}
function drawSun(ctx, cx, cy, r, grads) {
  ctx.fillStyle = grads.corona;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 3.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = grads.disc;
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

// Solar-map routing-node markers (lander / hazard / aerobrake) are now PNG
// sprites under assets/map-icons/, generated by scripts/gen-map-icons.mjs and
// blitted by _drawWaypointsScreen below. Re-run that script to change the art.
const MAP_ICON_NAMES = ['lander', 'lander-half', 'lander-hazard', 'lander-half-hazard', 'hazard', 'aerobrake'];
// The sprites are authored at 6.4x (gen-map-icons.mjs ICON_SUPERSAMPLE) in a
// 128px canvas, so each blits back down to a 20px screen box centred on the node.
const MAP_ICON_BOX = 20;

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
    // Viewport insets that mark portions of the canvas overlaid by
    // chrome (the bottom hand strip, the right sidebar). Centering
    // operations - fit, flyTo, panTo, resize recentre - shift to
    // the midpoint of the UNOBSTRUCTED region instead of the raw
    // canvas centre so a focused site doesn't end up hidden under
    // an open panel. Updated externally via setInsets().
    this.insets = { left: 0, top: 0, right: 0, bottom: 0 };
    this._route = null;             // [{from,to,dv}]
    this._routeFromId = null;
    this._routeToId = null;
    // Manual-move candidate glow: Map<nodeId, 'ok' | 'blocked'>. Set while
    // the player is plotting a route by hand so the nodes one hop out from
    // the current tip light up green (a hop they can afford) or red (an
    // adjacent node that's over this turn's burn budget).
    this._moveTargets = null;
    this._rocketTrail = null;       // [{from,to}] history of segments
                                    // the rocket has actually traversed,
                                    // drawn under the planned route as
                                    // a bright cyan ribbon
    this._discs = null;             // { [siteId]: { outcome } } - prospect
                                    // discs (success/fail) drawn over sites
    this._factories = null;         // Stage-3: { [siteId]: { ownerId,
                                    // spectralType } } factory chits
    this._colonies = null;          // Stage-3: { [siteId]: { ownerId } }
                                    // colony rings (overlayed on factories)
    this._outposts = null;          // Stage-3: { A?, B?, C?, D? }
                                    // outpost letter chits
    this._focusedSiteId = null;     // Stage-3: site id of the focused
                                    // stack (rocket or outpost), drawn
                                    // with a dashed accent ring
    this._popupRocketInfo = null;   // { isru } - active rig info supplied
                                    // by browse.js for the popup chip
    this._prospectorBadgeBox = null; // last-drawn badge bounds for hover
                                    // hit-testing (set inside the sandbox
                                    // rocket draw, cleared when no badge)
    this._sandboxRocketBadge = null; // 'missile' | 'raygun' | 'buggy' or null
                                    // - small kind icon clipped to the
                                    // rocket sprite so the player sees
                                    // their active prospector at a glance
    this._dragStart = null;
    this._gesture = null;
    this._rafQueued = false;
    this._tooltipEl = null;
    // Static-layer cache. The heavy, non-animated geometry (zones,
    // guides, halos, edges, waypoints, hexes, labels) is baked into an
    // OVERSCAN offscreen canvas (viewport + margin) at a stored camera
    // pose. While panning we just blit it at an offset (no rebuild)
    // until the pan drifts past the margin; while zooming we blit it
    // scaled as a preview and rebuild crisp once the zoom settles. The
    // screen-fixed backdrop (nebula + stars) lives in its own cache.
    this._bgCanvas = null;
    this._bgCtx = null;
    this._bgKey = null;
    this._staticCanvas = null;
    this._staticCtx = null;
    this._staticEpoch = 0;
    this._cachePan = { x: 0, y: 0 };
    this._cacheZoom = 0;
    this._cacheEpoch = -1;
    this._cacheHostW = 0;
    this._cacheHostH = 0;
    this._cacheDpr = 0;
    this._cacheMarginX = 0;
    this._cacheMarginY = 0;
    this._cacheCssW = 0;
    this._cacheCssH = 0;
    this._prevFrameZoom = 0;
    // Debug zone-painter state. When `active` holds a zone name the
    // map enters polygon-draw mode: clicks drop vertices instead of
    // selecting sites. Finishing a polygon stamps every waypoint
    // node inside it with the active zone (real sites are skipped).
    // `assignments` accumulates across polygons so a zone can be
    // built from several lassos; `colors` is the per-zone palette
    // passed in from browse.js for the overlay.
    this._zonePaint = {
      active: null,            // zone currently being edited
      zonePolys: {},           // zone -> [{x,y}]: ONE polygon per zone
      assignments: new Map(),  // nodeId -> zone, DERIVED from polygons
      colors: {},              // zone -> hex colour
      order: [],               // zones inner -> outer (Mercury first)
    };
    this._zoneDragVertex = null;    // index of the poly vertex being dragged
    this._zoneGrabConsumed = false; // swallow the click after a vertex grab
    this._onZonePaintChange = null; // fired after poly / assignment edits
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
      initialZoom: _isMobileViewport() ? MOBILE_DEFAULT_ZOOM : DEFAULT_ZOOM,
      debug: false,
      // Zone-visualisation (config panel): draw the canonical solar-
      // zone polygons behind everything. On by default. Fill optional;
      // border opacity 0.01..1 (default 0.1); curved borders smooth the
      // polygon edges (on by default).
      visualizeZones: true,
      zoneFill: true,
      zoneOpacity: 0.1,
      zoneCurved: true,
      zoneEditMode: false,
    };
    // Canonical zone polygons (the frozen source-of-truth data),
    // wired in from browse.js: { polys: {zone:[[{x,y}]]}, colors, order }.
    this._canonicalZones = { polys: {}, colors: {}, order: [] };
    this._frameCount = 0;
    this._frameTimer = 0;
    this._fps = 0;
    this._onFrame = null;           // optional callback fired each frame
    // Per-step draw profiler. Only armed while the debug panel is open
    // (this._profileOn). _profAccum sums ms per named step over the fps
    // window; _profile holds the per-frame average snapshot the panel
    // polls via getProfile().
    this._profileOn = false;
    this._profAccum = {};
    this._profile = {};
    // Body-halo sprite cache. Each distinct body appearance (palette +
    // hazard + rings, or per-id for rocky/ringed bodies) is rendered to
    // an offscreen canvas once and blitted per frame, instead of
    // allocating a radial gradient per body every frame. Sprites are
    // only ever blitted downscaled (<= rendered size) so they stay
    // crisp; a body zoomed in past its sprite resolution triggers a
    // one-off re-render at a larger reference radius.
    this._spriteCache = new Map();
    // The Sun's two radial gradients, built once (buildSunGrads) and reused
    // every frame. World-space coords never change, so the cached gradient
    // stays correct under any pan/zoom (the CTM is applied at fill time).
    this._sunGrad = null;
    // Ambient decorative rockets: cosmetic sprites zipping between
    // random sites in the background. Count is driven externally
    // (setAmbientRocketCount) - 10 + 5 per factory built. Purely
    // visual; they ignore the delta-v graph and just lerp between
    // random site coords. The fleet is the chibi real-world spacecraft
    // set (assets/background-rockets, in-space configs, no boosters),
    // Project Orion included.
    this._ambientRockets = [];
    this._ambientLastT = 0;
    this._ambientSprites = [];
    // Camera persistence state: set by _restoreCamera / _noteUserCamera /
    // the first rocket placement, so the initial view resolves exactly once.
    this._initialViewDone = false;
    // Distinct from _initialViewDone: true ONLY once the player has manually
    // panned / zoomed. The first rocket placement also sets _initialViewDone
    // (an AUTO view), so that flag alone can't tell "we painted something" from
    // "the player took the wheel". focusRocketWhenKnown reads THIS flag so a
    // late re-focus (online: the real rocket site arrives after the mount
    // painted a stale LEO placeholder) can still land on the ship, while a
    // player who already grabbed the camera is never yanked.
    this._userAdjustedCamera = false;
    this._camSaveTimer = null;
    for (const name of ['chibi-apollo-csm', 'chibi-orion', 'chibi-crew-dragon',
      'chibi-space-shuttle', 'chibi-soyuz', 'chibi-shenzhou', 'chibi-mengzhou',
      'chibi-skylab', 'chibi-gemini', 'chibi-orion-pulse-ship']) {
      const img = new Image();
      // Resolve against THIS module's URL, not the address bar. With
      // room routing the visible URL can be a deep /room/<CODE> path,
      // and a bare 'assets/...' would resolve to /room/assets/... (404).
      // import.meta.url is always /js/game/render.js, so ../../assets
      // lands at the real app-root /assets.
      img.src = assetUrl(`assets/background-rockets/${name}.svg`);
      this._ambientSprites.push(img);
    }
    // Stage-3 factory sprites: one player-tinted base per seat colour + the
    // colony dome, keyed by lowercase seat-colour hex. Baked at a shared origin
    // so the dome composites on the base's install pad (same draw rect).
    this._factorySprites = {};
    const FACTORY_FILES = {
      '#fccc00': 'gold', '#c09cc0': 'mauve', '#e3e0d4': 'bone',
      '#a8d8c0': 'mint', '#b40054': 'magenta', '#9c9c9c': 'gray',
    };
    for (const [hex, name] of Object.entries(FACTORY_FILES)) {
      const img = new Image();
      img.src = assetUrl(`assets/factory/factory-base-${name}.png`);
      this._factorySprites[hex] = img;
    }
    this._factorySprites._default = this._factorySprites['#9c9c9c'];
    this._domeSprite = new Image();
    this._domeSprite.src = assetUrl('assets/factory/colony-dome.png');
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

  // Manual-move candidate nodes. `targets` is a plain object keyed by node
  // id whose value is 'ok' (a hop the player can afford this turn → green
  // glow) or 'blocked' (an adjacent node over the turn's burn budget → red
  // glow). Pass null / empty to clear the glow.
  setMoveTargets(targets) {
    const has = targets && Object.keys(targets).length;
    this._moveTargets = has ? targets : null;
    this._scheduleDraw();
  }

  // Rocket trail: a list of segments the rocket has already
  // traversed this game. Drawn as a cyan ribbon beneath the
  // planned-route overlay so the player sees where they've been
  // vs. where they're going.
  setRocketTrail(segments) {
    this._rocketTrail = segments && segments.length ? segments : null;
    this._scheduleDraw();
  }

  // Prospect discs by site id. Shape: { [siteId]: { outcome } }
  // where outcome is 'success' (player colour) or 'fail' (red).
  // Drawn over the site hex at the same world position.
  setDiscs(discs) {
    this._discs = (discs && Object.keys(discs).length) ? discs : null;
    this._scheduleDraw();
  }

  // Sandbox rocket: a single rocket sprite placed at a world-
  // space (x, y). canFly drives the "🚫 + transparent" overlay
  // - the renderer doesn't compute fly-ability itself; that's
  // js/game/rocket.js's canRocketFly().
  setSandboxRocket(opts) {
    this._sandboxRocket = opts || null;
    // First placement: fly to the player's rocket. This is the DEFAULT
    // opening view on every mount (page load, room entry, sandbox); the
    // restored viewport / whole-map fit is just the starting pose. Only a
    // user pan / zoom that already happened (_noteUserCamera set
    // _initialViewDone) suppresses it, so the camera is never yanked away
    // from a player who is already looking around.
    if (!this._initialViewDone && opts
        && Number.isFinite(opts.x) && Number.isFinite(opts.y)) {
      this._initialViewDone = true;
      this.flyTo({ x: opts.x, y: opts.y }, this._focusRocketZoom || 5, { ms: this._focusRocketMs || 420 });
      this._focusRocketMs = 0;
    }
    this._scheduleDraw();
  }

  // Opponent rockets in multiplayer. list = [{ x, y, colour, name }].
  // Drawn as smaller colour-coded sprites; the local player's own
  // rocket is still the full-featured _sandboxRocket draw. Colocation
  // offset (multiple ships at one site, e.g. everyone parked at LEO)
  // is computed at draw time so the pieces fan out instead of
  // stacking dead-on.
  setMpRockets(list) {
    this._mpRockets = Array.isArray(list) ? list : null;
    this._scheduleDraw();
  }

  // Horizontal offset for the LOCAL rocket so it takes its slot in a
  // colocation row (set alongside setMpRockets when other players share
  // the site). 0 = centred / alone.
  setSandboxRocketOffset(dx) {
    if (this._sandboxRocket) {
      this._sandboxRocket.offsetX = dx || 0;
      this._scheduleDraw();
    }
  }

  // Trigger a one-shot explosion at a world-space position. Used
  // when a hazard roll critical-fails on the sandbox rocket. The
  // animation is fully self-clearing - rings expand + fade and
  // particles fly outward for EXPLOSION_DURATION ms, then this
  // slot nulls itself on the next draw. Caller awaits the same
  // duration before returning cards to hand so the visual and
  // the state mutation land together.
  triggerExplosion(x, y, opts = {}) {
    this._explosion = {
      x, y,
      startTime: (this._animTime || performance.now()),
      seed: Math.random(),
      ...opts,
    };
    this._scheduleDraw();
  }
  clearExplosion() {
    this._explosion = null;
    this._scheduleDraw();
  }

  // Solo: pin a "player ship" marker to a specific site. Drawn as
  // a screen-space triangle floating above the site so it's
  // visible regardless of the underlying hex.
  setPlayerShipId(id) {
    this._playerShipId = id || null;
    this._scheduleDraw();
  }

  // Stage-3 factories. Shape: { [siteId]: { ownerId, spectralType } }
  // Each factory paints as a small square chit below the site
  // hex, tinted by spectral type. Colonies (if any) layer a
  // ring overlay on the same chit.
  setFactories(factories) {
    this._factories = (factories && Object.keys(factories).length) ? factories : null;
    this._scheduleDraw();
  }

  // Stage-3 colonies. Shape: { [siteId]: { ownerId } }. Colonies
  // are tokens that sit ON a factory; the renderer expects the
  // factory state to be set alongside (a colony without a factory
  // still draws its ring, but the canonical layout assumes both).
  setColonies(colonies) {
    this._colonies = (colonies && Object.keys(colonies).length) ? colonies : null;
    this._scheduleDraw();
  }

  // Stage-3 outposts. Shape: { A?, B?, C?, D? } where each entry
  // is { letter, siteId, cards, tank }. Outposts paint as styled
  // letter chits at their site, offset to the right of any
  // factory + rocket sprite at the same site.
  // Seat colour for the local player's outpost chits (so a cube reads as
  // "mine"). Falls back to the default blue when unset.
  setOutpostColor(color) {
    this._outpostColor = color || null;
    this._scheduleDraw();
  }

  setOutposts(outposts) {
    this._outposts = (outposts && Object.keys(outposts).length) ? outposts : null;
    this._scheduleDraw();
  }

  // Stage-3 focused-stack site id. When set the renderer paints
  // a thin accent ring around that site so the player can see at
  // a glance which stack the hand-bar + popup actions target.
  // Null when focus is the LEO stack (handled by the toolbar
  // chip, not the map).
  setFocusedSiteId(siteId) {
    this._focusedSiteId = siteId || null;
    this._scheduleDraw();
  }

  reset() {
    this._fitToData();
    // Reset means "start clean": forget the remembered viewport too, so
    // the next open re-centers on the rocket instead of the stale pose.
    try { localStorage.removeItem(LS_CAMERA); } catch { /* storage unavailable */ }
    clearTimeout(this._camSaveTimer);
    this._scheduleDraw();
  }

  // ---- camera persistence ----
  // DEFAULT VIEW IS THE ROCKET: whenever a map mounts and the player's
  // rocket position arrives (setSandboxRocket's first placement), the
  // camera flies to it - on every page load, room entry, or sandbox
  // mount. The remembered viewport (saved below on every user pan /
  // zoom) is only the pre-focus backdrop and the fallback when no
  // rocket ever appears (map browsing with no game). A user gesture
  // before the rocket lands disarms the fly so the camera is never
  // stolen mid-look.
  _noteUserCamera() {
    this._initialViewDone = true;  // never recenter out from under the player
    this._userAdjustedCamera = true;  // the player now owns the camera
    clearTimeout(this._camSaveTimer);
    this._camSaveTimer = setTimeout(() => this._saveCamera(), 500);
  }
  _saveCamera() {
    if (!(this.fitScale > 0) || !(this.hostW > 0)) return;
    const eff = this.zoom * this.fitScale;
    const cam = {
      x: (this._viewCenterX() - this.pan.x) / eff,
      y: (this._viewCenterY() - this.pan.y) / eff,
      zoom: this.zoom,
    };
    try { localStorage.setItem(LS_CAMERA, JSON.stringify(cam)); } catch { /* storage unavailable */ }
  }
  _restoreCamera() {
    let cam = null;
    try { cam = JSON.parse(localStorage.getItem(LS_CAMERA) || 'null'); } catch { cam = null; }
    if (!cam || !Number.isFinite(cam.x) || !Number.isFinite(cam.y) || !Number.isFinite(cam.zoom)) return false;
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cam.zoom));
    const eff = this.zoom * this.fitScale;
    this.pan.x = this._viewCenterX() - cam.x * eff;
    this.pan.y = this._viewCenterY() - cam.y * eff;
    // Deliberately NOT marking _initialViewDone: the restored pose is the
    // backdrop the rocket-focus fly starts from, not the final view. Only
    // a user gesture or the fly itself claims the initial view.
    return true;
  }

  // One-shot: focus the player's rocket as soon as its position is known
  // (immediately if it already is). Used by link-driven room entry - a
  // player following a notification / invite link lands looking at their
  // ship, overriding any remembered viewport. A later user pan / zoom
  // still wins: the pending focus only fires through setSandboxRocket's
  // first-placement path, which _noteUserCamera disarms.
  focusRocketWhenKnown({ zoom = 5, ms = 420 } = {}) {
    // The player has the wheel: never yank the camera, even if the rocket's
    // real position only just became known. (A mount-time placement that set
    // _initialViewDone does NOT count as the player taking control, which is
    // why this reads _userAdjustedCamera, not _initialViewDone.)
    if (this._userAdjustedCamera) return;
    const r = this._sandboxRocket;
    this._focusRocketZoom = zoom;
    if (r && Number.isFinite(r.x) && Number.isFinite(r.y)) {
      this._initialViewDone = true;
      this.flyTo({ x: r.x, y: r.y }, zoom, { ms });
      return;
    }
    this._initialViewDone = false;
    this._focusRocketMs = ms;
  }

  // Horizontal / vertical centre of the visible (uninsetted) region
  // of the canvas. Used everywhere centring needs to mean "centre of
  // the part the player can actually see" rather than "centre of the
  // raw canvas".
  _viewCenterX() {
    return (this.insets.left + (this.hostW - this.insets.right)) / 2;
  }
  _viewCenterY() {
    return (this.insets.top + (this.hostH - this.insets.bottom)) / 2;
  }

  // Update the overlaid-chrome insets. Re-pans so whatever world
  // point was at the OLD visible centre stays at the NEW visible
  // centre - opening a side panel slides the view, it doesn't make
  // the focused body jump.
  setInsets({ left = 0, top = 0, right = 0, bottom = 0 } = {}) {
    const prev = this.insets;
    if (prev.left === left && prev.top === top && prev.right === right && prev.bottom === bottom) return;
    let centerPoint = null;
    if (this.hostW > 0 && this.hostH > 0 && this.fitScale > 0) {
      const eff = this.zoom * this.fitScale;
      const cx = (prev.left + (this.hostW - prev.right)) / 2;
      const cy = (prev.top  + (this.hostH - prev.bottom)) / 2;
      centerPoint = { x: (cx - this.pan.x) / eff, y: (cy - this.pan.y) / eff };
    }
    this.insets = { left, top, right, bottom };
    if (centerPoint) {
      const eff = this.zoom * this.fitScale;
      this.pan.x = this._viewCenterX() - centerPoint.x * eff;
      this.pan.y = this._viewCenterY() - centerPoint.y * eff;
    }
    this._scheduleDraw();
  }

  // Smoothly pan + zoom to centre a specific site / waypoint in
  // the viewport. Used by the search box, the locator buttons,
  // and the explosion camera-pan. `zoom` defaults to 5x which
  // fills the cluster around a body without diving into the
  // hex's individual glyphs. Tween duration is ~420 ms with
  // ease-out cubic so the camera feels responsive without
  // jumping. Pass `{ ms: 0 }` to snap (legacy fast path).
  flyTo(target, zoom = 5, { ms = 420 } = {}) {
    if (!target || typeof target.x !== 'number' || typeof target.y !== 'number') return;
    this._cancelPanAnim();
    const endZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    const endEff  = endZoom * this.fitScale;
    const endPanX = this._viewCenterX() - target.x * endEff;
    const endPanY = this._viewCenterY() - target.y * endEff;
    if (!Number.isFinite(ms) || ms <= 0) {
      // Snap path - kept for code that explicitly wants the
      // instant version (rare; most call sites benefit from the
      // animated default).
      this.zoom = endZoom;
      this.pan.x = endPanX;
      this.pan.y = endPanY;
      this._scheduleDraw();
      return;
    }
    const startZoom = this.zoom;
    const startPanX = this.pan.x;
    const startPanY = this.pan.y;
    // No-op short circuit: if we're already exactly there,
    // skip the tween entirely so callers can flyTo redundantly
    // without paying for a frame loop.
    if (startZoom === endZoom && startPanX === endPanX && startPanY === endPanY) {
      return;
    }
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);   // ease-out cubic
      this.zoom  = startZoom + (endZoom  - startZoom) * e;
      this.pan.x = startPanX + (endPanX  - startPanX) * e;
      this.pan.y = startPanY + (endPanY  - startPanY) * e;
      this._scheduleDraw();
      if (k < 1) this._panAnimRaf = requestAnimationFrame(step);
      else this._panAnimRaf = null;
    };
    this._panAnimRaf = requestAnimationFrame(step);
  }

  // Smoothly pan (no zoom change) to centre a world-space point.
  // Used when the user taps a site so the camera follows the
  // selection instead of jumping or staying put.
  panTo(target, opts = {}) {
    if (!target || typeof target.x !== 'number' || typeof target.y !== 'number') return;
    const eff = this.zoom * this.fitScale;
    this._animatePan(this._viewCenterX() - target.x * eff, this._viewCenterY() - target.y * eff, opts);
  }

  // Low-level pan tween to an explicit screen-space pan target, shared by panTo
  // and centerSitePopup.
  _animatePan(targetPanX, targetPanY, { ms = 320 } = {}) {
    this._cancelPanAnim();
    const startX = this.pan.x;
    const startY = this.pan.y;
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      // ease-out cubic - gets you near the target fast, settles softly
      const e = 1 - Math.pow(1 - k, 3);
      this.pan.x = startX + (targetPanX - startX) * e;
      this.pan.y = startY + (targetPanY - startY) * e;
      this._scheduleDraw();
      if (k < 1) this._panAnimRaf = requestAnimationFrame(step);
      else this._panAnimRaf = null;
    };
    this._panAnimRaf = requestAnimationFrame(step);
  }

  // Pan so the OPEN site popup is centred in the viewport (rather than the node
  // it points at), so a tall popup near a screen edge doesn't clip off. The
  // popup is glued to the node by a fixed pixel offset, so we measure that
  // offset from the popup's current screen box - call this AFTER setSitePopup has
  // built + shown the popup.
  centerSitePopup({ ms = 320 } = {}) {
    const el = this._popupEl;
    const site = this._popupSite;
    if (!el || !site || el.classList.contains('hidden')) return;
    this._positionSitePopup();   // glue it to the node at the current frame first
    const hb = this.host.getBoundingClientRect();
    const pr = el.getBoundingClientRect();
    if (!pr.width || !pr.height) return;   // not laid out yet - nothing to centre
    const eff = this.zoom * this.fitScale;
    // Popup centre + node, both in host-relative screen px.
    const popupCx = pr.left - hb.left + pr.width / 2;
    const popupCy = pr.top - hb.top + pr.height / 2;
    const nodeSx = this.pan.x + site.x * eff;
    const nodeSy = this.pan.y + site.y * eff;
    const offX = popupCx - nodeSx;
    const offY = popupCy - nodeSy;
    // Solve for the pan that lands the popup centre on the viewport centre.
    this._animatePan(
      this._viewCenterX() - site.x * eff - offX,
      this._viewCenterY() - site.y * eff - offY,
      { ms },
    );
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

  // Set per-popup rocket info (the active rig's ISRU rating, etc.)
  // so the popup chip can render "Your ISRU 2 vs 4 water ✓" without
  // the renderer needing to import rocket state. Call before
  // setSitePopup; values stay until the next call.
  setPopupRocketInfo(info) {
    this._popupRocketInfo = info || null;
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

    // Routing-node marker sprites (lander / hazard / aerobrake), generated by
    // scripts/gen-map-icons.mjs. Loaded async; each load invalidates the static
    // layer (the markers bake into it) and schedules a redraw so they appear as
    // soon as they arrive.
    this._mapIcons = {};
    for (const name of MAP_ICON_NAMES) {
      const img = new Image();
      img.onload = () => { this._invalidateStatic(); this._scheduleDraw(); };
      img.src = assetUrl(`assets/map-icons/${name}.png`);
      this._mapIcons[name] = img;
    }

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
    this._restoreCamera();
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
        x: (this._viewCenterX() - this.pan.x) / prevEff,
        y: (this._viewCenterY() - this.pan.y) / prevEff,
      };
    }

    const rect = this.host.getBoundingClientRect();
    this.hostW = Math.max(1, rect.width);
    this.hostH = Math.max(1, rect.height);
    const prevDpr = this.dpr;
    this.dpr = window.devicePixelRatio || 1;
    // Body sprites are rasterised at this.dpr; a dpr change (e.g. window
    // moved to another monitor) invalidates them.
    if (this.dpr !== prevDpr && this._spriteCache) this._spriteCache.clear();
    this.canvas.width = Math.round(this.hostW * this.dpr);
    this.canvas.height = Math.round(this.hostH * this.dpr);
    this.canvas.style.width = this.hostW + 'px';
    this.canvas.style.height = this.hostH + 'px';
    this.fitScale = Math.min(this.hostW / VIEW_W, this.hostH / VIEW_H);

    if (prevCenter) {
      const eff = this.zoom * this.fitScale;
      this.pan.x = this._viewCenterX() - prevCenter.x * eff;
      this.pan.y = this._viewCenterY() - prevCenter.y * eff;
    }

    this._scheduleDraw();
  }

  _fitToData() {
    this.zoom = this.options.initialZoom;
    const eff = this.zoom * this.fitScale;
    this.pan.x = this._viewCenterX() - (VIEW_W * eff) / 2;
    this.pan.y = this._viewCenterY() - (VIEW_H * eff) / 2;
  }

  // Public hooks the debug panel uses to read/observe state.
  getZoom() { return this.zoom; }
  getFps()  { return this._fps; }
  onFrame(fn) { this._onFrame = fn; }
  setOption(key, value) {
    this.options[key] = value;
    this._invalidateStatic();
    this._scheduleDraw();
  }

  // Force the static-layer cache to rebuild on the next frame.
  _invalidateStatic() { this._staticEpoch++; }

  // ---- debug zone painter ----
  // Tools the debug panel drives to hand-label which solar zone each
  // waypoint node belongs to. The map's real sites already carry a
  // `solarZone`; the planner waypoints (burns / lagranges / hohmanns
  // / decoratives) don't, so this lets us paint them by region and
  // export the result for wiring into the data file.

  setZonePaintColors(colors) {
    this._zonePaint.colors = colors || {};
    this._scheduleDraw();
  }

  // The frozen source-of-truth zone polygons drawn behind the map
  // when `visualizeZones` is on. { polys: {zone:[[{x,y}]]}, colors,
  // order } - order is inner -> outer (drawn outer-first so inner
  // regions paint on top).
  setCanonicalZones({ polys, colors, order } = {}) {
    const cols = colors || {};
    const vivid = {};
    for (const z in cols) vivid[z] = vividHex(cols[z]);
    this._canonicalZones = {
      polys: polys || {},
      colors: cols,
      vivid,   // richer fill colours (the pale palette washes out)
      order: Array.isArray(order) ? order.slice() : [],
    };
    this._invalidateStatic();
    this._scheduleDraw();
  }

  // Zones nest inner -> outer (Mercury innermost). The order drives
  // the derived-assignment rule: a node belongs to the INNERMOST
  // polygon that contains it.
  setZoneOrder(order) {
    this._zonePaint.order = Array.isArray(order) ? order.slice() : [];
    this._recomputeDerivedAssignments();
    this._invalidateStatic();
    this._scheduleDraw();
  }

  // Notified (by browse.js) after any poly / assignment edit so it
  // can persist the work to localStorage.
  setZonePaintChangeHandler(fn) { this._onZonePaintChange = fn || null; }
  _emitZonePaintChange() {
    if (this._onZonePaintChange) { try { this._onZonePaintChange(); } catch { /* ignore */ } }
  }

  // The polygon (point array) for the active zone, creating it on
  // first use. null when no zone is selected.
  _activeZonePoly(create = false) {
    const z = this._zonePaint.active;
    if (!z) return null;
    if (!this._zonePaint.zonePolys[z] && create) this._zonePaint.zonePolys[z] = [];
    return this._zonePaint.zonePolys[z] || null;
  }

  // Select the zone to edit. Each zone owns ONE polygon; switching
  // zones just changes which polygon is editable - none are cleared.
  setZonePaintZone(zone) {
    this._zonePaint.active = zone || null;
    this._scheduleDraw();
    this._emitZonePaintChange();
  }

  isZonePainting() { return !!this._zonePaint.active; }

  // Append a point to the ACTIVE zone's single polygon.
  addZonePolyPoint(wx, wy) {
    const poly = this._activeZonePoly(true);
    if (!poly) return;
    poly.push({ x: wx, y: wy });
    this._recomputeDerivedAssignments();
    this._scheduleDraw();
    this._emitZonePaintChange();
  }

  // Index of the active zone's polygon vertex within a small screen-
  // space grab radius of (wx, wy), or -1. Used to pick up a vertex.
  _hitTestZoneVertex(wx, wy) {
    const poly = this._activeZonePoly();
    if (!poly || !poly.length) return -1;
    const eff = this.zoom * this.fitScale;
    const sx = this.pan.x + wx * eff;
    const sy = this.pan.y + wy * eff;
    const R2 = 12 * 12; // 12px grab radius
    let best = -1, bestD = R2;
    for (let i = 0; i < poly.length; i++) {
      const px = this.pan.x + poly[i].x * eff;
      const py = this.pan.y + poly[i].y * eff;
      const d = (px - sx) * (px - sx) + (py - sy) * (py - sy);
      if (d <= bestD) { bestD = d; best = i; }
    }
    return best;
  }

  // Move vertex `i` of the active zone's polygon (used while dragging).
  moveZoneVertex(i, wx, wy) {
    const poly = this._activeZonePoly();
    if (!poly || !poly[i]) return;
    poly[i].x = wx; poly[i].y = wy;
    this._scheduleDraw();
  }

  // Drop the last point of the active zone's polygon.
  undoZonePolyPoint() {
    const z = this._zonePaint.active;
    const poly = z && this._zonePaint.zonePolys[z];
    if (!poly || !poly.length) return;
    poly.pop();
    if (!poly.length) delete this._zonePaint.zonePolys[z];
    this._recomputeDerivedAssignments();
    this._scheduleDraw();
    this._emitZonePaintChange();
  }

  // Re-derive { nodeId: zone } from the zone polygons (>= 3 points).
  // Zones are concentric: an outer polygon (e.g. Venus) encloses the
  // inner ones (Mercury). A node belongs to the INNERMOST zone whose
  // polygon contains it - i.e. the first hit when zones are tested in
  // inner -> outer order. So everything inside Mercury is Mercury;
  // everything inside Venus that ISN'T Mercury is Venus; and so on.
  _recomputeDerivedAssignments() {
    const zp = this._zonePaint;
    zp.assignments = new Map();
    // Candidate polygons in inner -> outer order. Fall back to object
    // key order if no explicit zone order was supplied.
    const order = (zp.order && zp.order.length) ? zp.order : Object.keys(zp.zonePolys);
    const ordered = [];
    const seen = new Set();
    for (const zone of order) {
      const pts = zp.zonePolys[zone];
      if (Array.isArray(pts) && pts.length >= 3) { ordered.push({ zone, pts }); seen.add(zone); }
    }
    // Include any polygon zones missing from the order (after the
    // ordered ones) so nothing is silently dropped.
    for (const zone in zp.zonePolys) {
      if (seen.has(zone)) continue;
      const pts = zp.zonePolys[zone];
      if (Array.isArray(pts) && pts.length >= 3) ordered.push({ zone, pts });
    }
    for (const s of this._waypoints) {
      for (const o of ordered) {
        if (pointInPolygon(s.x, s.y, o.pts)) { zp.assignments.set(s.id, o.zone); break; }
      }
    }
  }

  // Clear EVERYTHING (all zone polygons + derived assignments).
  clearZoneAssignments() {
    this._zonePaint.zonePolys = {};
    this._zonePaint.assignments.clear();
    this._scheduleDraw();
    this._emitZonePaintChange();
  }

  // Clear just the active zone's polygon.
  clearActiveZonePolygon() {
    const z = this._zonePaint.active;
    if (!z || !this._zonePaint.zonePolys[z]) return;
    delete this._zonePaint.zonePolys[z];
    this._recomputeDerivedAssignments();
    this._scheduleDraw();
    this._emitZonePaintChange();
  }

  // Read / restore the per-zone polygons (the data the user exports).
  getZonePolygons() {
    const out = [];
    for (const zone in this._zonePaint.zonePolys) {
      const pts = this._zonePaint.zonePolys[zone];
      if (Array.isArray(pts) && pts.length) {
        out.push({ zone, points: pts.map((q) => ({ x: q.x, y: q.y })) });
      }
    }
    return out;
  }
  setZonePolygons(arr) {
    this._zonePaint.zonePolys = {};
    if (Array.isArray(arr)) {
      for (const p of arr) {
        if (p && p.zone && Array.isArray(p.points)) {
          this._zonePaint.zonePolys[p.zone] = p.points
            .filter((q) => q && Number.isFinite(+q.x) && Number.isFinite(+q.y))
            .map((q) => ({ x: +q.x, y: +q.y }));
        }
      }
    }
    this._recomputeDerivedAssignments();
    this._scheduleDraw();
  }

  zonePolygonCount() { return this.getZonePolygons().length; }
  zoneAssignmentCount() { return this._zonePaint.assignments.size; }

  // Export the accumulated labels as plain records. id2 is the stable
  // human-friendly reference (e.g. "lag-leo", "burn-3a2b9"); id is the
  // raw vendor key. Both are emitted so the result can be wired into
  // planner-map.js by whichever key is convenient.
  getZoneAssignments() {
    const out = [];
    for (const [id, zone] of this._zonePaint.assignments) {
      const s = this.data && this.data.byId[id];
      if (!s) continue;
      out.push({
        id: s.id,
        id2: s.id2,
        type: s.type,
        x: s.x,
        y: s.y,
        zone,
      });
    }
    return out;
  }

  // ---- drawing ----

  // Continuous animation loop: each rAF advances the shared anim
  // clock and queues a draw. Used by the asteroid-belt particle
  // sweep; cheap because the work per frame is dominated by the
  // (already batched) draw pass. Stops if the canvas is detached
  // from the DOM so we don't leak frames on view tear-down.
  // Set how many ambient decorative rockets fly around the map.
  // browse.js calls this with 10 + 10*factoryCount.
  setAmbientRocketCount(n) {
    const want = Math.max(0, n | 0);
    const sites = this._ambientSites();
    while (this._ambientRockets.length < want) this._ambientRockets.push(this._spawnAmbientRocket(sites));
    if (this._ambientRockets.length > want) this._ambientRockets.length = want;
    this._scheduleDraw();
  }

  _ambientSites() {
    if (this._realSites && this._realSites.length) return this._realSites;
    return (this.data && this.data.sites) || [];
  }

  _spawnAmbientRocket(sites) {
    const pick = () => (sites.length ? sites[(Math.random() * sites.length) | 0] : { x: 0, y: 0 });
    const a = pick(), b = pick();
    return {
      spr: (Math.random() * this._ambientSprites.length) | 0,
      fromX: a.x || 0, fromY: a.y || 0,
      toX: b.x || 0, toY: b.y || 0,
      t: Math.random(),                      // random start phase
      dur: 14000 + Math.random() * 18000,    // ms per leg (~50% slower)
      size: 8 + Math.random() * 6,           // world units (~50% smaller)
      flick: Math.random() * 1000,           // engine-flame flicker phase
    };
  }

  // Advance + draw the ambient rockets (world space). dt in ms.
  _drawAmbientRockets(ctx, dt) {
    if (!this._ambientRockets.length) return;
    const now = performance.now();
    const sites = this._ambientSites();
    for (const r of this._ambientRockets) {
      r.t += dt / r.dur;
      if (r.t >= 1) {
        // Arrived: start a new leg from here to a fresh random site.
        const nb = sites.length ? sites[(Math.random() * sites.length) | 0] : { x: r.toX, y: r.toY };
        r.fromX = r.toX; r.fromY = r.toY;
        r.toX = nb.x || 0; r.toY = nb.y || 0;
        r.t = 0; r.dur = 14000 + Math.random() * 18000;
      }
      const x = r.fromX + (r.toX - r.fromX) * r.t;
      const y = r.fromY + (r.toY - r.fromY) * r.t;
      const img = this._ambientSprites[r.spr];
      if (!img || !img.complete || !img.naturalWidth) continue;
      // Sprite nose points up (-y); rotate to face the travel vector.
      const ang = Math.atan2(r.toY - r.fromY, r.toX - r.fromX) + Math.PI / 2;
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.translate(x, y);
      ctx.rotate(ang);
      // Aspect-correct: the chibi spacecraft are taller than wide, so
      // size is the height and the width follows the sprite's ratio.
      const s = r.size;
      const w = s * (img.naturalWidth / img.naturalHeight || 1);
      // Little engine flame at the tail (+y is behind the nose after the
      // rotate above). Three nested teardrops - amber, gold, white-hot
      // core - whose length flickers on two unsynced sine waves with a
      // per-ship phase, drawn BEFORE the sprite so the hull covers the
      // flame root and the exhaust reads as coming from the engines.
      // The sprite boxes carry a few px of bell-depth padding under the
      // hull (the hull bottoms sit at ~0.29-0.40 of s below center, varying
      // per ship), so the flame roots at 0.26 s - safely INSIDE every hull -
      // and only its tip shows past the engines.
      const ft = now * 0.018 + r.flick;
      const len = s * (0.42 + 0.12 * Math.sin(ft) + 0.08 * Math.sin(ft * 2.63));
      const fy = s * 0.26;
      const flame = (halfW, l, color) => {
        ctx.beginPath();
        ctx.moveTo(-halfW, fy);
        ctx.quadraticCurveTo(-halfW * 0.55, fy + l * 0.55, 0, fy + l);
        ctx.quadraticCurveTo(halfW * 0.55, fy + l * 0.55, halfW, fy);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
      };
      flame(s * 0.13,  len,        'rgba(255,140,58,0.70)');
      flame(s * 0.085, len * 0.62, 'rgba(255,217,102,0.85)');
      flame(s * 0.05,  len * 0.34, 'rgba(255,247,224,0.95)');
      ctx.drawImage(img, -w / 2, -s / 2, w, s);
      ctx.restore();
    }
  }

  _startAnimation() {
    // The ambient drift (rockets crossing the map, asteroid-belt twinkle) now
    // targets ~60fps so the motion reads smoothly instead of stepping. The
    // ambient dt is elapsed-time based (and clamped), so sprite speed is
    // unchanged - only the redraw cadence went up. Keeping a cap (rather than
    // an uncapped per-rAF redraw) still bounds the full-scene repaint - and the
    // backdrop-filter panels re-blurring with it - on 120Hz+ displays.
    // Interaction (pan / zoom / hover) draws at the full rate through its own
    // _scheduleDraw calls.
    let lastAmbientDraw = 0;
    // A hair under one 60Hz frame (16.67ms) so vsync jitter never skips a
    // frame on a 60Hz panel; on 120Hz it redraws every other frame (~60fps).
    const AMBIENT_INTERVAL = 1000 / 60 - 2;   // ~14.7ms, ~60fps
    const tick = (t) => {
      if (!this.canvas || !this.canvas.isConnected) {
        this._animRaf = null;
        return;
      }
      this._animTime = t;
      if (t - lastAmbientDraw >= AMBIENT_INTERVAL) {
        lastAmbientDraw = t;
        this._scheduleDraw();
      }
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

  // Screen-fixed backdrop (nebula + stars) cache. Depends only on the
  // canvas size, so it's rebuilt on resize.
  _ensureBgCache() {
    const { hostW, hostH, dpr } = this;
    const dw = Math.max(1, Math.round(hostW * dpr));
    const dh = Math.max(1, Math.round(hostH * dpr));
    const key = `${dw}x${dh}`;
    if (this._bgKey === key) return;
    this._bgKey = key;
    if (!this._bgCanvas) this._bgCanvas = document.createElement('canvas');
    const cv = this._bgCanvas;
    if (cv.width !== dw || cv.height !== dh) { cv.width = dw; cv.height = dh; this._bgCtx = cv.getContext('2d'); }
    const bctx = this._bgCtx || (this._bgCtx = cv.getContext('2d'));
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bctx.clearRect(0, 0, hostW, hostH);
    this._drawBackdrop(bctx);
  }

  // Render the heavy, camera-anchored map layers (zones, guides,
  // halos, edges, waypoints, hexes, labels) into the OVERSCAN cache,
  // centred on the current camera pose with a margin on every side so
  // small pans can be served by an offset blit. Transparent bg so it
  // composites over the live backdrop.
  _rebuildStaticCache() {
    const { hostW, hostH, dpr } = this;
    const marginX = Math.round(hostW * 0.3);
    const marginY = Math.round(hostH * 0.3);
    const cssW = hostW + marginX * 2;
    const cssH = hostH + marginY * 2;
    const dw = Math.max(1, Math.round(cssW * dpr));
    const dh = Math.max(1, Math.round(cssH * dpr));
    if (!this._staticCanvas) this._staticCanvas = document.createElement('canvas');
    const cv = this._staticCanvas;
    if (cv.width !== dw || cv.height !== dh) { cv.width = dw; cv.height = dh; this._staticCtx = cv.getContext('2d'); }
    const sctx = this._staticCtx || (this._staticCtx = cv.getContext('2d'));

    // Record the pose this cache was rendered at (BEFORE shifting pan).
    this._cachePan = { x: this.pan.x, y: this.pan.y };
    this._cacheZoom = this.zoom;
    this._cacheEpoch = this._staticEpoch;
    this._cacheHostW = hostW; this._cacheHostH = hostH; this._cacheDpr = dpr;
    this._cacheMarginX = marginX; this._cacheMarginY = marginY;
    this._cacheCssW = cssW; this._cacheCssH = cssH;

    // Temporarily shift pan + grow the viewport bounds so the screen-
    // space layers (which read this.pan / this.hostW for placement +
    // culling) fill the whole overscan canvas, including the margin.
    const savePanX = this.pan.x, savePanY = this.pan.y;
    const saveHostW = this.hostW, saveHostH = this.hostH;
    this.pan.x = savePanX + marginX; this.pan.y = savePanY + marginY;
    this.hostW = cssW; this.hostH = cssH;
    try {
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sctx.clearRect(0, 0, cssW, cssH);
      const eff = this.zoom * this.fitScale;
      sctx.save();
      sctx.translate(this.pan.x, this.pan.y);
      sctx.scale(eff, eff);
      this._drawCanonicalZones(sctx, eff);
      if (this.data.mode === 'clean' && Array.isArray(this.data.zones)) {
        this._drawZoneBands(sctx, this.data.zones, this.data.zoneInfo);
      }
      sctx.restore();
      // NOTE: only the solar-zone fills are cached here. Edges, guides,
      // body halos / planets, waypoints, hexes and labels are all drawn
      // live every frame in _draw (with viewport culling) so they stay
      // crisp during zoom instead of being scaled up from this bitmap.
      // Edges in particular must draw live (over the planets) so the
      // delta-v lines aren't tucked behind the body spheres.
    } finally {
      this.pan.x = savePanX; this.pan.y = savePanY;
      this.hostW = saveHostW; this.hostH = saveHostH;
    }
  }

  // Decide whether the overscan cache can be reused (offset / scaled
  // blit) or must be rebuilt, then blit it. Drawn in DEVICE pixels
  // (identity transform) over the already-blitted backdrop.
  _blitStaticLayer(ctx) {
    const { hostW, hostH, dpr } = this;
    const sameStatic = this._staticCanvas
      && this._cacheEpoch === this._staticEpoch
      && this._cacheHostW === hostW && this._cacheHostH === hostH && this._cacheDpr === dpr
      && this._cacheZoom > 0;
    const dest = () => {
      const scale = this.zoom / this._cacheZoom;
      const x = this.pan.x - (this._cacheMarginX + this._cachePan.x) * scale;
      const y = this.pan.y - (this._cacheMarginY + this._cachePan.y) * scale;
      const w = this._cacheCssW * scale;
      const h = this._cacheCssH * scale;
      const covered = x <= 0.5 && y <= 0.5 && (x + w) >= hostW - 0.5 && (y + h) >= hostH - 0.5;
      return { x, y, w, h, scale, covered };
    };
    let rebuild = !sameStatic;
    if (!rebuild) {
      const d = dest();
      if (!d.covered) rebuild = true;                                   // panned/zoomed past the margin
      else if (this.zoom !== this._cacheZoom && this.zoom === this._prevFrameZoom) rebuild = true; // zoom settled -> crisp
    }
    if (rebuild) this._rebuildStaticCache();
    const d = dest();
    const cv = this._staticCanvas;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = (d.scale !== 1); // crisp when 1:1, smooth scaled preview
    ctx.drawImage(cv, 0, 0, cv.width, cv.height,
      d.x * dpr, d.y * dpr, d.w * dpr, d.h * dpr);
    ctx.imageSmoothingEnabled = true;
  }

  _draw() {
    const ctx = this.ctx;
    const { dpr } = this;

    // Screen-fixed backdrop, then the camera-anchored static map layer
    // (offset/scaled-blitted from the overscan cache, rebuilt only when
    // the pan drifts past the margin or the zoom settles), then the
    // animated / stateful layers on top.
    this._profileOn = !!this.options.debug;
    const drawStart = this._profileOn ? performance.now() : 0;

    this._ensureBgCache();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    this._step('backdrop', () => { ctx.drawImage(this._bgCanvas, 0, 0); });
    this._step('zones (blit)', () => this._blitStaticLayer(ctx));
    this._prevFrameZoom = this.zoom;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const eff = this.zoom * this.fitScale;

    // Guides + sun/comet draw in world space UNDER the planet sprites.
    // The Sun corona and comet tails point relative to the world Sun
    // anchor, so they stay live (and they're few). Everything else that
    // used to be a per-frame gradient (the body spheres) is now blitted
    // from the sprite cache in _drawSiteHalosScreen.
    ctx.save();
    ctx.translate(this.pan.x, this.pan.y);
    ctx.scale(eff, eff);
    this._step('guides', () => this._drawGuides(ctx));
    this._step('sun/comet', () => this._drawSiteSunCometWorld(ctx));
    ctx.restore();

    // Body spheres / rocky asteroids: blitted from the sprite cache in
    // screen space, viewport-culled. Drawn before the edges so the
    // delta-v lines sit over the planets, not behind them.
    this._step('planets (sprite)', () => this._drawSiteHalosScreen(ctx));

    ctx.save();
    ctx.translate(this.pan.x, this.pan.y);
    ctx.scale(eff, eff);
    // Delta-v edges over the planets; animated belt + cosmetic traffic +
    // the gameplay route/trail follow on top.
    this._step('edges', () => this._drawEdges(ctx));
    this._step('belt', () => this._drawAsteroidBelt(ctx));
    {
      const now = performance.now();
      const dt = this._ambientLastT ? Math.min(80, now - this._ambientLastT) : 16;
      this._ambientLastT = now;
      this._step('ambient', () => this._drawAmbientRockets(ctx, dt));
    }
    this._step('trail', () => this._drawRocketTrail(ctx));
    this._step('route', () => this._drawRoute(ctx));
    ctx.restore();

    // Crisp, viewport-culled, drawn live (not scaled from the cache) so
    // node markers / hexes / labels stay sharp at every zoom level.
    this._step('waypoints', () => this._drawWaypointsScreen(ctx));
    this._step('hexes', () => this._drawSiteHexesScreen(ctx));
    this._step('labels', () => this._drawSiteLabelsScreen(ctx));

    // Hazard pulses + gameplay overlays (prospects, factories, ships,
    // selection ring, route pills, zone painter). Grouped under one
    // profiler step so the breakdown total reconciles with the sum.
    this._step('overlays', () => {
      this._drawHazardPulseScreen(ctx);
      this._drawMoveTargetsScreen(ctx);
      this._drawProspectDiscsScreen(ctx);
      this._drawFactoriesScreen(ctx);
      this._drawOutpostsScreen(ctx);
      this._drawFocusedStackRingScreen(ctx);
      this._drawLeoAnchorScreen(ctx);
      this._drawPlayerShipScreen(ctx);
      if (this._mpRockets && this._mpRockets.length) this._drawMpRocketsScreen(ctx);
      if (this._sandboxRocket) this._drawSandboxRocketScreen(ctx);
      if (this._explosion)     this._drawExplosionScreen(ctx);
      // Selection ring drawn LAST so nothing - labels, ships, hexes
      // - paints over it. On mobile the in-hex orange/gold border is
      // easy to miss, so we layer a thick bright yellow ring + soft
      // halo just outside the selected node's body.
      this._drawSelectionRingScreen(ctx);
      // Turn-number pills (T2, T3, …) for planned rocket routes;
      // no-op for plain Navigate-to routes that have no turn tags.
      this._drawRouteTurnLabelsScreen(ctx);
      // Debug zone painter overlay sits on top of everything.
      this._drawZonePaintScreen(ctx);
    });
    if (this._popupSite) this._positionSitePopup();

    // FPS book-keeping. The debug panel polls getFps(); we update
    // ~twice per second so the readout doesn't flicker.
    if (this._profileOn) {
      this._profAccum.frame = (this._profAccum.frame || 0) + (performance.now() - drawStart);
    }
    this._frameCount++;
    const now = performance.now();
    if (!this._frameTimer) this._frameTimer = now;
    if (now - this._frameTimer >= 500) {
      const frames = this._frameCount || 1;
      this._fps = Math.round(this._frameCount * 1000 / (now - this._frameTimer));
      if (this._profileOn) {
        const snap = {};
        for (const k in this._profAccum) snap[k] = this._profAccum[k] / frames;
        this._profile = snap;
      } else {
        this._profile = {};
      }
      this._profAccum = {};
      this._frameCount = 0;
      this._frameTimer = now;
    }
    if (this._onFrame) this._onFrame();
  }

  // Run one named draw step, timing it only while the profiler is armed
  // (debug panel open). When off, this is a plain call with no overhead.
  _step(name, fn) {
    if (!this._profileOn) { fn(); return; }
    const t0 = performance.now();
    fn();
    this._profAccum[name] = (this._profAccum[name] || 0) + (performance.now() - t0);
  }

  // Per-step average ms-per-frame over the last fps window. Empty unless
  // the debug panel armed the profiler. 'frame' is the whole _draw body.
  getProfile() { return this._profile; }

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
    // their ship moves outward. Neptune+ shows "✕" - sails are
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
    // synodic season - red, yellow, or blue - so a glance at
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

  // Bright cyan ribbon tracing every segment the rocket has
  // already flown. Painted before _drawRoute so the planned-route
  // overlay (orange + dashed) sits on top at any shared junction.
  _drawRocketTrail(ctx) {
    if (!this._rocketTrail) return;
    const eff = this.zoom * this.fitScale;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 3.5 / eff;
    ctx.shadowBlur = 10 / eff;
    ctx.shadowColor = 'rgba(56, 189, 248, 0.55)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
    ctx.beginPath();
    for (const seg of this._rocketTrail) {
      const sa = this.data.byId[seg.from];
      const sb = this.data.byId[seg.to];
      if (!sa || !sb) continue;
      ctx.moveTo(sa.x, sa.y);
      ctx.lineTo(sb.x, sb.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  _drawRoute(ctx) {
    if (!this._route) return;
    const eff = this.zoom * this.fitScale;
    ctx.lineCap = 'round';
    // Segments tagged `turn: 1` (or untagged - plain Navigate-to
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
    // paints on top of them at any junction. Drawn as faint
    // yellow (matching the turn-1 gold-dash but at reduced
    // alpha) so the preview reads as "same route, just queued
    // for a future turn".
    const sortedLater = [...laterByTurn].sort((a, b) => b[0] - a[0]);
    for (const [turn, segs] of sortedLater) {
      const alpha = Math.max(0.22, 0.55 - (turn - 2) * 0.08);
      ctx.lineWidth = 2.5 / eff;
      ctx.strokeStyle = `rgba(251, 191, 36, ${alpha})`;
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

    // Turn 1 - bright orange + gold-dash highlight. Same look as
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
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.65)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(rx, ry, w, h, 4);
      else ctx.rect(rx, ry, w, h);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fde68a';
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
      // Plain burns stay as the pink circle batch. Lander burns (landing set)
      // and hazard burns both render as vector glyphs in the glyph pass below,
      // so drop them here.
      const circles  = type === 'burn'
        ? items.filter((w) => w.landing == null && !w.hazard)
        : items;

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

      // Lander burns no longer draw a magenta disc here - they render as a
      // transparent pink lander glyph (full, or half with a knife-cut line)
      // in the vector-glyph pass below.
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

    // (Hazard pulse moved to _drawHazardPulseScreen so it stays
    // animated on top of the cached static layer.)

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

    // (Flyby-boost "+N" labels are drawn LAST - after the node glyphs - so the
    // number sits in front of the glyph on a black background. See below.)

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

    // PNG sprite markers for the planner's flagged routing nodes (generated by
    // scripts/gen-map-icons.mjs):
    //   lander burn (landing>=1)  -> lander             (pink two-legged lander)
    //   half lander (landing<1)   -> lander-half        (+ white knife-cut line)
    //   full lander + hazard      -> lander-hazard      (skull on top of lander)
    //   half lander + hazard      -> lander-half-hazard (half lander | half skull)
    //   hazard burn (no landing)  -> hazard             (skull in a Lagrange ring)
    //   venus flyby               -> aerobrake          (parachute in a Lagrange ring)
    // radhaz keeps its trefoil; hazard-flagged lagrange points are flybys, not
    // hazards, so they get no skull. (Site flags 🌊 / 🌿 stay in the hex layer.)
    const icons = this._mapIcons;
    if (icons) {
      const box = MAP_ICON_BOX, ih = box / 2;
      for (const w of this._waypoints) {
        let name = null;
        if (w.type === 'burn' && w.landing != null) {
          if (w.hazard) name = w.landing < 1 ? 'lander-half-hazard' : 'lander-hazard';
          else name = w.landing < 1 ? 'lander-half' : 'lander';
        } else if (w.type === 'venus') {
          name = 'aerobrake';
        } else if (w.hazard && w.type !== 'radhaz' && w.type !== 'lagrange') {
          name = 'hazard';
        }
        if (!name) continue;
        const img = icons[name];
        if (!img || !img.complete || !img.naturalWidth) continue;
        const sx = this.pan.x + w.x * eff;
        const sy = this.pan.y + w.y * eff;
        if (sx < -24 || sx > hostW + 24 || sy < -24 || sy > hostH + 24) continue;
        ctx.drawImage(img, sx - ih, sy - ih, box, box);
      }
    }

    // Flyby-boost "+N" labels, drawn LAST so the number sits IN FRONT of any
    // node glyph. Each rides a black DISC sized to fit the number, so the
    // gravity-assist value stays readable over a busy node.
    ctx.font = '700 11px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    for (const w of this._waypoints) {
      if (!w.flybyBoost) continue;
      const sx = this.pan.x + w.x * eff;
      const sy = this.pan.y + w.y * eff;
      if (sx < -20 || sx > hostW + 20 || sy < -20 || sy > hostH + 20) continue;
      const txt = '+' + (w.flybyBoost === 'thrust' ? 'T' : w.flybyBoost);
      const tw = ctx.measureText(txt).width;
      // Radius = half the text-box diagonal + padding so the number always fits
      // inside the circle, with a minimum so single-char values aren't tiny.
      const rad = Math.max(9, Math.sqrt(tw * tw + 11 * 11) / 2 + 2);
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(sx, sy, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(txt, sx, sy + 0.5);
    }
  }

  // Fetch (or lazily render) the offscreen sprite for one body
  // appearance. `sr` is the screen radius the sphere needs this frame;
  // the sprite is (re)rendered at a rounded-up reference radius capped
  // at HALO_MAX_SCREEN_R, so it never has to be blitted upscaled (which
  // would blur). `extent` is the sprite half-size as a multiple of the
  // sphere radius (covers atmosphere glow / ring span). `paint(c, cx,
  // cy, r)` draws the body centred in the sprite with radius r.
  _bodySprite(key, sr, extent, paint) {
    let e = this._spriteCache.get(key);
    if (e && e.refR >= sr) return e;
    const refR = Math.min(HALO_MAX_SCREEN_R, Math.max(8, Math.ceil(sr / 16) * 16));
    if (e && e.refR >= refR) return e;
    const dpr = this.dpr;
    const half = Math.ceil(extent * refR) + 2;
    const cv = (e && e.canvas) || document.createElement('canvas');
    const dw = Math.max(1, Math.round(half * 2 * dpr));
    if (cv.width !== dw || cv.height !== dw) { cv.width = dw; cv.height = dw; }
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, half * 2, half * 2);
    paint(c, half, half, refR);
    e = { canvas: cv, refR, half };
    this._spriteCache.set(key, e);
    return e;
  }

  // Celestial body spheres + rocky asteroids, blitted from the sprite
  // cache in SCREEN space (viewport-culled). The on-screen sphere
  // radius is capped at HALO_MAX_SCREEN_R, matching the old world-space
  // path, so layout + proportions are unchanged - the only difference
  // is that each body's shaded gradient is rendered once into a sprite
  // instead of re-allocated every frame. Ring-bearing planets (Saturn /
  // Jupiter / Uranus / Neptune) bake back-rings + sphere + front-rings
  // into the one sprite. Sun + comets stay live (_drawSiteSunCometWorld).
  _drawSiteHalosScreen(ctx) {
    const eff = this.zoom * this.fitScale;
    const { hostW, hostH } = this;
    const cap = HALO_MAX_SCREEN_R;

    const blit = (key, wx, wy, haloR, extent, paint) => {
      const sr = Math.min(haloR * eff, cap);
      if (sr < 0.5) return;
      const sx = this.pan.x + wx * eff;
      const sy = this.pan.y + wy * eff;
      const m = extent * sr + 40;
      if (sx < -m || sx > hostW + m || sy < -m || sy > hostH + m) return;
      const e = this._bodySprite(key, sr, extent, paint);
      const scale = sr / e.refR;            // <= 1, downscale -> crisp
      const halfCss = e.half * scale;
      ctx.drawImage(e.canvas, sx - halfCss, sy - halfCss, halfCss * 2, halfCss * 2);
    };

    const palSig = (p) => `${p.light}|${p.base}|${p.dark}|${p.atmosphere || '-'}`;
    const sphereExtent = (p, rings) => (rings ? 2.3 : (p.atmosphere ? 1.55 : 1.12));
    const paintSphere = (pal, rings, hazard) => (c, cx, cy, r) => {
      if (rings) {
        drawPlanetRings(c, cx, cy, r, rings, 'back');
        drawShadedSphere(c, cx, cy, r, pal, hazard);
        drawPlanetRings(c, cx, cy, r, rings, 'front');
      } else {
        drawShadedSphere(c, cx, cy, r, pal, hazard);
      }
    };

    // Pass 1: shared halos for merged body groups (Mars / Luna /
    // Mercury / Jupiter system / etc.). One sphere at the group centroid.
    for (const g of this._bodyGroups.values()) {
      if (g.sites.length < 2) continue;
      const vis = TYPE_VIS[g.type] || TYPE_VIS.unknown;
      if (vis.kind !== 'hex' && vis.kind !== 'sun') continue;
      const haloR = vis.haloR || 20;
      const pal = paletteFor(g.exemplar);
      const rings = ringDefFor(g.exemplar);
      // Ring-bearing groups key per-group (rings differ per planet);
      // ring-free groups dedupe on palette so similar bodies share a
      // sprite.
      const key = rings ? `grp|${g.exemplar.id}` : `sph|${palSig(pal)}|-`;
      blit(key, g.cx, g.cy, haloR, sphereExtent(pal, rings), paintSphere(pal, rings, false));
    }

    // Pass 2: per-site spheres + rocky silhouettes for everything not in
    // a merged group. Sun + comets are handled live elsewhere.
    for (const site of this._realSites) {
      if (this._mergedSites.has(site.id)) continue;
      const vis = TYPE_VIS[site.type] || TYPE_VIS.unknown;
      if (vis.kind === 'sun' || vis.kind === 'comet') continue;
      if (vis.kind !== 'hex') continue;
      // Ceres punches above its dwarf-class default - shrink it 50% so
      // it doesn't dominate the belt next to Vesta / Pallas / Hygiea.
      const bodyScale = /(^|\s)ceres/i.test(site.name || '') ? 0.5 : 1;
      const haloR = vis.haloR * bodyScale;
      const pal = paletteFor(site);
      if (vis.rocky) {
        // Rocky silhouettes carry a per-site random vertex shape, so
        // they can't dedupe - key by id.
        blit(`rock|${site.id}`, site.x, site.y, haloR, 1.15,
          (c, cx, cy, r) => drawRockyAsteroid(c, cx, cy, r, pal, site));
        continue;
      }
      const rings = ringDefFor(site);
      const key = rings ? `ring|${site.id}` : `sph|${palSig(pal)}|${site.hazard ? 'h' : '-'}`;
      blit(key, site.x, site.y, haloR, sphereExtent(pal, rings), paintSphere(pal, rings, site.hazard));
    }
  }

  // The Sun + comets, drawn live in WORLD space. Their coronas / tails
  // are positioned relative to the world Sun anchor and there are only a
  // handful, so they skip the sprite cache.
  _drawSiteSunCometWorld(ctx) {
    const eff = this.zoom * this.fitScale;
    const { hostW, hostH } = this;
    const offscreen = (wx, wy, worldR) => {
      const sx = this.pan.x + wx * eff;
      const sy = this.pan.y + wy * eff;
      const m = worldR * eff * 2.5 + 80;
      return sx < -m || sx > hostW + m || sy < -m || sy > hostH + m;
    };
    for (const site of this._realSites) {
      if (this._mergedSites.has(site.id)) continue;
      const vis = TYPE_VIS[site.type] || TYPE_VIS.unknown;
      if (vis.kind === 'sun') {
        if (!offscreen(site.x, site.y, vis.r)) {
          let g = this._sunGrad;
          if (!g || g.cx !== site.x || g.cy !== site.y || g.r !== vis.r) {
            g = this._sunGrad = buildSunGrads(ctx, site.x, site.y, vis.r);
          }
          drawSun(ctx, site.x, site.y, vis.r, g);
        }
        continue;
      }
      if (vis.kind === 'comet') { if (!offscreen(site.x, site.y, vis.r)) drawComet(ctx, site.x, site.y, vis.r, site); }
    }
  }

  // Zoom-driven hex scale. Hexes reach full HEX_R at the full-size
  // zoom and shrink proportionally below it (so they don't dominate
  // the compressed view / overlap when zoomed out). Mobile pushes
  // the full-size threshold up to zoom 5 so the hexes keep shrinking
  // in step with zoom-out instead of "growing" relative to the map.
  _hexScale() {
    const full = _isMobileViewport() ? 5 : HEX_FULLSIZE_ZOOM;
    return Math.min(1, this.zoom / full);
  }

  // Hex markers + endpoint rings, drawn in SCREEN space so they
  // stay readable at any zoom level.
  _drawSiteHexesScreen(ctx) {
    const eff = this.zoom * this.fitScale;
    const { hostW, hostH } = this;
    // hexS: shrink the hex marker below HEX_FULLSIZE_ZOOM so it
    // doesn't dominate the compressed view at low zoom. At and
    // above the threshold the hex sits at its full HEX_R.
    const hexS = this._hexScale();
    for (const site of this._realSites) {
      const sx = this.pan.x + site.x * eff;
      const sy = this.pan.y + site.y * eff;
      const vis = TYPE_VIS[site.type] || TYPE_VIS.unknown;
      if (vis.kind === 'sun') continue;
      // Comets used to render as a pink disc + 🚀 marker. The
      // published HF4 board draws them as real hexes - same
      // shape as planets / asteroids - with a synodic-coloured
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
      // above - no separate outer ring needed.
      // Selected nodes are highlighted via their border + glow
      // above; no extra ring needed.
    }
  }

  // Manual-move candidate glow. While the player plots a route by hand,
  // every node one hop out from the current tip pulses: green if they can
  // afford the hop with this turn's remaining burns, red if it's adjacent
  // but over budget. Same world-position math as the selection ring, drawn
  // for sites AND waypoints (the contracted neighbours can be either).
  _drawMoveTargetsScreen(ctx) {
    if (!this._moveTargets || !this.data) return;
    const eff = this.zoom * this.fitScale;
    const { hostW, hostH } = this;
    const hexS = this._hexScale();
    // Pulse off the shared anim clock (no self-scheduling; the ambient
    // loop already redraws on its cadence, same as the selection ring).
    const t = (this._animTime || 0) / 1000;
    const pulse = (Math.sin(t * Math.PI * 1.6) + 1) * 0.5;
    ctx.save();
    ctx.lineWidth = 2.5;
    for (const id in this._moveTargets) {
      const node = this.data.byId[id];
      if (!node) continue;
      const sx = this.pan.x + node.x * eff;
      const sy = this.pan.y + node.y * eff;
      if (sx < -30 || sx > hostW + 30 || sy < -30 || sy > hostH + 30) continue;
      const vis = TYPE_VIS[node.type] || TYPE_VIS.unknown;
      let baseR = vis.r != null ? vis.r : 8;
      if (vis.kind === 'hex') baseR *= hexS;
      if (isLeoWaypoint(node)) baseR *= 2;
      const ringR = Math.max(baseR + 6, 11) + pulse * 3;
      const ok = this._moveTargets[id] === 'ok';
      const col = ok ? '52, 211, 153' : '248, 113, 113';   // emerald / red
      ctx.shadowBlur = 9 + pulse * 7;
      ctx.shadowColor = `rgba(${col}, 0.9)`;
      ctx.strokeStyle = `rgba(${col}, ${0.7 + pulse * 0.3})`;
      ctx.beginPath();
      ctx.arc(sx, sy, ringR, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Prospect discs. Draw a coloured disc centred on each site that's
  // been prospected: player colour = success (claim placed), red = fail
  // (site exhausted). Rendered AFTER site labels so the disc sits on top
  // of the hex without losing the site name behind it.
  _drawProspectDiscsScreen(ctx) {
    if (!this._discs) return;
    const eff = this.zoom * this.fitScale;
    ctx.save();
    for (const id in this._discs) {
      const site = this.data.byId[id];
      if (!site) continue;
      const sx = this.pan.x + site.x * eff;
      const sy = this.pan.y + site.y * eff;
      // Skip if offscreen.
      if (sx < -40 || sx > this.hostW + 40 || sy < -40 || sy > this.hostH + 40) continue;
      const outcome = this._discs[id].outcome;
      const radius = Math.max(7, Math.min(18, 10 * Math.sqrt(this.zoom)));
      // Success = player's yellow claim disc; fail = red exhausted.
      const fill = outcome === 'success' ? '#facc15' : '#ef4444';
      // Whole disc paints at 60% opacity so the underlying site
      // hex / label / halo stays legible through it.
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(sx, sy, radius, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = outcome === 'success' ? '#854d0e' : '#7f1d1d';
      ctx.stroke();
      // Inner pip glyph: ✓ for success, ✕ for fail.
      ctx.fillStyle = '#0c0a16';
      ctx.font = `700 ${Math.round(radius * 1.1)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(outcome === 'success' ? '✓' : '✕', sx, sy + 1);
    }
    ctx.restore();
  }

  // Stage-3 factory sprites. Each factory paints as a baked isometric base
  // tinted by the OWNER's seat colour, anchored just below the site. A colony
  // adds the dome sprite on the install pad (composited at the same rect), and
  // a player-coloured label reads {size}{spectral} | {outpost}. One per site.
  _drawFactoriesScreen(ctx) {
    if (!this._factories) return;
    const eff = this.zoom * this.fitScale;
    const r = Math.max(7, Math.min(18, 10 * Math.sqrt(this.zoom)));
    // Sprite footprint: the baked base sits at ANCHOR_F* inside the sprite; we
    // pin that ground-centre just below the site (where the old chit sat) and
    // size the whole sprite from r. dw/dh + offset are the tuning knobs.
    const dw = r * FACTORY_SPRITE_K;
    const dh = dw * (FACTORY_SPRITE_H / FACTORY_SPRITE_W);
    ctx.save();
    for (const id in this._factories) {
      const site = this.data.byId[id];
      if (!site) continue;
      const f = this._factories[id];
      // Centre the factory ART on the site: the building's horizontal centre
      // (ANCHOR_FX) and visual centre (CENTER_FY) sit on the site marker.
      const cxs = this.pan.x + site.x * eff;
      const cys = this.pan.y + site.y * eff;
      const dx = cxs - dw * FACTORY_ANCHOR_FX;
      const dy = cys - dh * FACTORY_CENTER_FY;
      if (dx > this.hostW + 60 || dx + dw < -60 || dy > this.hostH + 60 || dy + dh < -60) continue;
      // Base tinted by the OWNER's seat colour (fall back to gray).
      const base = this._factorySprites[(f.color || '').toLowerCase()] || this._factorySprites._default;
      if (base && base.complete && base.naturalWidth) ctx.drawImage(base, dx, dy, dw, dh);
      // Colony dome composites at the SAME rect, landing on the install pad.
      if (this._colonies && this._colonies[id]
          && this._domeSprite && this._domeSprite.complete && this._domeSprite.naturalWidth) {
        ctx.drawImage(this._domeSprite, dx, dy, dw, dh);
      }
      // Player-coloured label sits BELOW the site name (drawn at sy + HEX_R +
      // 12). {size}{spectral}, plus " | {outpost}" when an outpost is stationed
      // here; the colocated outpost's water / glory ride on the label.
      const op = this._outpostAt(id);
      // siteSize is a tag like "4C" (size + prospect class), so take only its
      // numeric part and append the spectral once -> "4C", not "4CC".
      const size = String(site.siteSize || '').replace(/[^0-9]/g, '');
      let text = `${size}${f.spectralType || ''}`;
      if (op && op.letter) text += ` | ${op.letter}`;
      if (text) this._drawFactoryLabel(ctx, cxs, cys + HEX_R + 30, text, f.color || '#9c9c9c', r, op);
    }
    ctx.restore();
  }

  // The outpost stationed at a site (letter + water + glory), or null. Drives
  // the " | {outpost}" suffix and the 💧 / 🏆 badges on the factory label.
  _outpostAt(siteId) {
    if (!this._outposts) return null;
    for (const L of ['A', 'B', 'C', 'D']) {
      const op = this._outposts[L];
      if (op && op.siteId === siteId) return { letter: L, tank: op.tank | 0, gloryChits: op.gloryChits | 0 };
    }
    return null;
  }

  // Player-coloured pill label below the site name: {size}{spectral} with
  // " | {outpost}" when one is here. The colocated outpost's 💧 water and
  // 🏆 glory badges flank the pill (they used to ride the now-removed square).
  _drawFactoryLabel(ctx, cx, cy, text, color, r, op) {
    const fontPx = Math.max(9, Math.min(15, r * 0.95));
    ctx.font = `800 ${fontPx}px ui-sans-serif, system-ui, sans-serif`;
    const tw = ctx.measureText(text).width;
    const h = fontPx + 7;
    const w = Math.max(h * 1.5, tw + fontPx);
    const x = cx - w / 2, y = cy - h / 2;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, h / 2);
    else ctx.rect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = shadeHex(color, 0.55);
    ctx.stroke();
    ctx.fillStyle = inkOn(color);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, cy + 0.5);
    // Water + glory badges flank the pill, fed by the colocated outpost.
    if (op) {
      const bs = Math.max(11, Math.round(fontPx * 1.2));
      ctx.textBaseline = 'middle';
      if (op.tank > 0) {
        ctx.font = `${bs}px ${EMOJI_FONT}`;
        ctx.textAlign = 'right';
        ctx.fillText('💧', x - 3, cy);
      }
      if (op.gloryChits > 0) {
        ctx.font = `${bs}px ${EMOJI_FONT}`;
        ctx.textAlign = 'left';
        ctx.fillText('🏆', x + w + 3, cy);
        if (op.gloryChits > 1) {
          ctx.font = `bold ${Math.round(bs * 0.8)}px ui-sans-serif, system-ui, sans-serif`;
          ctx.fillStyle = '#ffd54a';
          ctx.fillText(String(op.gloryChits), x + w + 3 + bs, cy);
        }
      }
    }
  }

  // Park a rocket beside the factory: when a ship sits at a site that has a
  // factory, shift it left of the centred factory art so the two don't overlap
  // (w = rocket on-screen width). Returns 0 when there's no factory at these
  // site coords, so a ship in flight (interpolated coords) is unaffected.
  _factoryParkShift(worldX, worldY, w) {
    if (!this._factories) return 0;
    for (const id in this._factories) {
      const site = this.data.byId[id];
      if (site && Math.abs(site.x - worldX) < 0.5 && Math.abs(site.y - worldY) < 0.5) {
        const rr = Math.max(7, Math.min(18, 10 * Math.sqrt(this.zoom)));
        return -(rr * FACTORY_SPRITE_K * 0.34 + w / 2 + 5);
      }
    }
    return 0;
  }

  // Stage-3 outpost chits. Drawn as small rounded squares with a
  // big letter (A/B/C/D) in them, offset to the upper-right of
  // the site center. When a factory is also present at the same
  // site the outpost chit shifts further right so the two chits
  // don't overlap.
  _drawOutpostsScreen(ctx) {
    if (!this._outposts) return;
    const eff = this.zoom * this.fitScale;
    const r = Math.max(7, Math.min(18, 10 * Math.sqrt(this.zoom)));
    const chitSize = r * 1.5;
    ctx.save();
    for (const letter of ['A', 'B', 'C', 'D']) {
      const op = this._outposts[letter];
      if (!op || !op.siteId) continue;
      const site = this.data.byId[op.siteId];
      if (!site) continue;
      // A factory at this site already shows the outpost letter in its label,
      // so skip the redundant lettered square here (the standalone chit still
      // marks outposts at sites without a factory).
      if (this._factories && this._factories[op.siteId]) continue;
      // Stagger by letter index so multiple outposts at the same
      // site don't overlap (rare, but possible). Each outpost is
      // pushed right by an extra chitSize per letter index.
      const idx = ['A', 'B', 'C', 'D'].indexOf(letter);
      const hasFactory = this._factories && this._factories[op.siteId];
      const xOffset = (hasFactory ? r * 2.0 : r * 1.2) + idx * chitSize * 1.05;
      const yOffset = -r * 1.6;
      const sx = this.pan.x + site.x * eff + xOffset;
      const sy = this.pan.y + site.y * eff + yOffset;
      if (sx < -40 || sx > this.hostW + 40 || sy < -40 || sy > this.hostH + 40) continue;
      const half = chitSize / 2;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(sx - half, sy - half, chitSize, chitSize, 3);
      } else {
        ctx.rect(sx - half, sy - half, chitSize, chitSize);
      }
      const fill = this._outpostColor || '#1e3a8a';
      ctx.fillStyle = fill;
      ctx.globalAlpha = 0.94;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = '#0c0a16';
      ctx.stroke();
      // Readable letter ink for light vs dark seat colours.
      ctx.fillStyle = _readableInkHex(fill);
      ctx.font = `800 ${Math.round(chitSize * 0.78)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(letter, sx, sy + 1);
      // 💧 badge when the outpost holds water, so a colocated rocket can
      // see at a glance there's fuel to pump.
      if ((op.tank | 0) > 0) {
        ctx.font = `${Math.round(chitSize * 0.6)}px ${EMOJI_FONT}`;
        ctx.fillText('💧', sx + half, sy - half);
      }
      // Gold glory-chit coin: the outpost's stationed crew is carrying a
      // glory chit (a chit follows the crew that picked it up, wherever they
      // station). Bottom-right corner so it never collides with the 💧 water
      // badge (top-right). The struck-gold + medal-star language matches the
      // chit coins in the scoring panel; the exact count lives in the outpost
      // inspector, not on the map.
      if (op.gloryChits > 0) {
        const bx = sx + half, by = sy + half;
        const cr = Math.max(4, chitSize * 0.32);
        ctx.beginPath();
        ctx.arc(bx, by, cr + 1.2, 0, Math.PI * 2);
        ctx.fillStyle = '#0c0a16';
        ctx.fill();
        const g = ctx.createRadialGradient(bx - cr * 0.34, by - cr * 0.44, cr * 0.1, bx, by, cr);
        g.addColorStop(0, '#fffbe6');
        g.addColorStop(0.16, '#ffe24a');
        g.addColorStop(0.46, '#ffc400');
        g.addColorStop(0.78, '#f59e0b');
        g.addColorStop(1, '#b9700a');
        ctx.beginPath();
        ctx.arc(bx, by, cr, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.lineWidth = Math.max(0.8, cr * 0.12);
        ctx.strokeStyle = '#ffe6a6';
        ctx.stroke();
        this._tracePentaStar(ctx, bx, by, cr * 0.62, cr * 0.27);
        ctx.fillStyle = '#b9810f';
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(bx - cr * 0.2, by - cr * 0.48, cr * 0.5, cr * 0.24, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.42)';
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // Trace a five-point star path (no fill/stroke). Shared by the glory-chit
  // coin marker; the caller sets fillStyle and calls fill().
  _tracePentaStar(ctx, cx, cy, ro, ri, points = 5, rot = -Math.PI / 2) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const r = (i % 2 === 0) ? ro : ri;
      const a = rot + (i * Math.PI) / points;
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  // Stage-3 focused-stack ring. A thin accent-cyan ring around
  // the focused stack's site so the player sees at a glance
  // which stack the popup actions + the cards-in-stack panel
  // target. Drawn AFTER the chits + sprites so nothing paints
  // over it, but BEFORE the selection ring (which is the user's
  // own per-click highlight).
  _drawFocusedStackRingScreen(ctx) {
    if (!this._focusedSiteId) return;
    const site = this.data.byId[this._focusedSiteId];
    if (!site) return;
    const eff = this.zoom * this.fitScale;
    const sx = this.pan.x + site.x * eff;
    const sy = this.pan.y + site.y * eff;
    if (sx < -60 || sx > this.hostW + 60 || sy < -60 || sy > this.hostH + 60) return;
    const r = Math.max(18, Math.min(34, 20 * Math.sqrt(this.zoom)));
    ctx.save();
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = '#7dd3fc';
    ctx.globalAlpha = 0.62;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

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
  // else - including labels and overlay sprites - has rendered.
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
    // visibly moves - important on mobile where a static thin
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
      const hexS = this._hexScale();
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
  // Opponent rockets, colour-coded by seat. Ships sharing a world
  // anchor (very common at LEO) fan out around it so they don't stack
  // dead-on. The local player's own rocket (_sandboxRocket) draws on
  // top afterwards and is NOT included here.
  _drawMpRocketsScreen(ctx) {
    const list = this._mpRockets;
    if (!list || !list.length) return;
    const eff = this.zoom * this.fitScale;
    const { width: spriteW, height: spriteH } = getRocketSpriteSize();
    // Same scale as the local rocket so every ship reads the same size.
    const scale = 0.55;
    const w = spriteW * scale;
    const h = spriteH * scale;
    // Each opponent carries a precomputed horizontal offset (browse.js
    // syncMpRockets lays out all ships at a site in a centred row, so
    // colocated ships line up side-by-side instead of stacking).
    for (const r of list) {
      const sx = this.pan.x + r.x * eff + (r.offsetX || 0) + this._factoryParkShift(r.x, r.y, w);
      const sy = this.pan.y + r.y * eff;
      const px = sx - w / 2;
      const py = sy - h - 2;
      ctx.save();
      if (r.inactive) ctx.globalAlpha = 0.5;
      ctx.drawImage(getRocketSprite(r.colour || 'white'), px, py, w, h);
      // 🚫 inactive badge, mirroring the local rocket's empty-stack cue.
      if (r.inactive) {
        ctx.globalAlpha = 1;
        const badge = Math.round(h * 0.35);
        ctx.font = `${badge}px ${EMOJI_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🚫', sx + w * 0.30, py + badge * 0.55);
      }
      // Loaded glory chits: a 🏆×N badge above the ship so an opponent's
      // haul is visible at a glance (chits ride home for VP).
      if (r.chits > 0) {
        ctx.globalAlpha = 1;
        const cs = Math.max(11, Math.round(h * 0.30));
        ctx.textBaseline = 'bottom';
        ctx.font = `${cs}px ${EMOJI_FONT}`;
        ctx.textAlign = 'right';
        ctx.fillText('🏆', sx + cs * 0.15, py - 1);
        ctx.font = `bold ${Math.round(cs * 0.85)}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillStyle = '#ffd54a';
        ctx.textAlign = 'left';
        ctx.fillText(String(r.chits), sx + cs * 0.2, py - 1);
      }
      ctx.restore();
    }
  }

  _drawSandboxRocketScreen(ctx) {
    const r = this._sandboxRocket;
    if (!r) return;
    const eff = this.zoom * this.fitScale;
    const { width: spriteW, height: spriteH } = getRocketSpriteSize();
    const scale = 0.55;     // map-scale; 35×53 px on screen.
    const w = spriteW * scale;
    const h = spriteH * scale;
    // offsetX shifts the local rocket sideways for the colocation row (set by
    // browse.js syncMpRockets); the park shift stands it next to a factory.
    const sx = this.pan.x + r.x * eff + (r.offsetX || 0) + this._factoryParkShift(r.x, r.y, w);
    const sy = this.pan.y + r.y * eff;
    const px = sx - w / 2;
    const py = sy - h - 2;  // foot of rocket above the anchor
    ctx.save();
    if (!r.canFly) ctx.globalAlpha = 0.5;
    ctx.drawImage(getRocketSprite(r.colour || 'yellow'), px, py, w, h);
    if (!r.canFly) {
      ctx.globalAlpha = 1;
      // 🚫 sits at 35% of the sprite height (half of the previous
      // 0.7) so it reads as an unobtrusive "not functional" badge
      // rather than swallowing the rocket sprite underneath.
      // Anchored top-right of the rocket so the sprite + indicator
      // both stay legible.
      const badge = Math.round(h * 0.35);
      ctx.font = `${badge}px ${EMOJI_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🚫', sx + w * 0.30, py + badge * 0.55);
    }
    ctx.restore();
    // Loaded glory chits: a 🏆xN badge above the ship (same cue as rivals),
    // so you can see your own haul at a glance.
    if (r.chits > 0) {
      const cs = Math.max(11, Math.round(h * 0.30));
      ctx.save();
      ctx.textBaseline = 'bottom';
      ctx.font = `${cs}px ${EMOJI_FONT}`;
      ctx.textAlign = 'right';
      ctx.fillText('🏆', sx + cs * 0.15, py - 1);
      ctx.font = `bold ${Math.round(cs * 0.85)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillStyle = '#ffd54a';
      ctx.textAlign = 'left';
      ctx.fillText(String(r.chits), sx + cs * 0.2, py - 1);
      ctx.restore();
    }
    // Active-prospector badge: emoji clipped to the rocket sprite's
    // bottom-right corner so the player sees their loadout at a
    // glance. Renders even when the rocket can't fly - prospectors
    // travel with the ship.
    if (r.prospectorKind) {
      const glyph = { missile: '🚀', raygun: '🔫', buggy: '🛺' }[r.prospectorKind] || '';
      if (glyph) {
        const badgeSize = Math.max(14, Math.round(w * 0.55));
        const bx = px + w - badgeSize * 0.25;
        const by = py + h - badgeSize * 0.25;
        ctx.save();
        ctx.beginPath();
        ctx.arc(bx, by, badgeSize * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
        ctx.fill();
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.font = `${Math.round(badgeSize * 0.7)}px ${EMOJI_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(glyph, bx, by + 1);
        ctx.restore();
        // Stash circle bounds + descriptor for hover-tooltip
        // hit-testing. Browse.js fills name + isru on the
        // sprite payload so the tooltip stays self-contained.
        this._prospectorBadgeBox = {
          x: bx, y: by, r: badgeSize * 0.5,
          kind: r.prospectorKind,
          name: r.prospectorName || null,
          isru: Number.isFinite(r.prospectorIsru) ? r.prospectorIsru : null,
        };
      }
    } else {
      this._prospectorBadgeBox = null;
    }
    // Glitch disc: a bold red token sitting ON the stack (Sunspot Glitch
    // event), mirroring the physical red glitch disc. Drawn last so it reads
    // as placed on top of the ship; the stack can't act until a Human clears
    // it (the stack modal carries the explanatory banner).
    if (r.glitch) {
      const gr = Math.max(7, Math.round(w * 0.42));
      const gx = sx;
      const gy = py + h * 0.42;
      ctx.save();
      // Semi-transparent (~50%) so the stack underneath stays visible through
      // the glitch token instead of being fully masked.
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(gx, gy, gr, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(220, 38, 38, 0.94)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#7f1d1d';
      ctx.stroke();
      // Inner highlight ring so it reads as a raised disc, not a flat dot.
      ctx.beginPath();
      ctx.arc(gx, gy, gr * 0.6, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(254, 202, 202, 0.85)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
    }
    // Stash the screen-space bounding box for hit-testing. The
    // active-thruster summary rides along for the rocket-hover
    // tooltip (browse.js fills r.thruster from
    // getActiveThrusterStats); no thruster = no tooltip.
    this._sandboxRocketBox = {
      x: px, y: py, w, h,
      thruster: r.thruster || null,
    };
  }

  // One-shot explosion at the rocket's world position. Painted
  // as three concentric rings (hot core → orange → smoke) +
  // a scattered particle burst, all fading + expanding over
  // ~1.4 s. The whole thing auto-clears at the end of its
  // lifetime so the caller doesn't need to schedule a teardown.
  _drawExplosionScreen(ctx) {
    const ex = this._explosion;
    if (!ex) return;
    const DURATION = 1400;
    const elapsed = (this._animTime || performance.now()) - ex.startTime;
    if (elapsed >= DURATION) {
      this._explosion = null;
      return;
    }
    const t = Math.max(0, elapsed / DURATION);     // 0..1
    const eff = this.zoom * this.fitScale;
    const sx = this.pan.x + ex.x * eff;
    const sy = this.pan.y + ex.y * eff;
    // Foot offset: same as the rocket sprite so the explosion
    // sits over where the rocket actually was, not at the anchor.
    const cy = sy - 18;
    ctx.save();
    // Three rings spaced in time so the burst has depth: each
    // starts a bit later and lasts the rest of the animation.
    const rings = [
      { delay: 0.00, color: '#fde047', maxR: 36 },
      { delay: 0.08, color: '#f97316', maxR: 56 },
      { delay: 0.18, color: '#7f1d1d', maxR: 78 },
    ];
    for (const ring of rings) {
      if (t < ring.delay) continue;
      const lt = Math.min(1, (t - ring.delay) / (1 - ring.delay));
      const r  = 4 + lt * ring.maxR;
      const a  = Math.max(0, 1 - lt) * 0.85;
      ctx.beginPath();
      ctx.arc(sx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = ring.color;
      ctx.globalAlpha = a;
      ctx.lineWidth = 3 - lt * 2;
      ctx.stroke();
    }
    // Hot fireball at the centre: solid disc that flares then
    // collapses to a smoke puff.
    ctx.globalAlpha = Math.max(0, 1 - t) * 0.9;
    ctx.beginPath();
    ctx.arc(sx, cy, 8 + Math.sin(t * Math.PI) * 14, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(sx, cy, 1, sx, cy, 22);
    grad.addColorStop(0, '#fffbeb');
    grad.addColorStop(0.4, '#fbbf24');
    grad.addColorStop(1, 'rgba(127, 29, 29, 0)');
    ctx.fillStyle = grad;
    ctx.fill();
    // Particles - 18 sparks flying outward, each on its own
    // angle + speed seeded from the explosion's RNG seed so the
    // burst is reproducible per-explosion (slightly varying so
    // they don't read as identical rings).
    const N = 18;
    const seed = ex.seed || 0;
    for (let i = 0; i < N; i++) {
      const ang  = (i / N) * Math.PI * 2 + seed * 0.7;
      const spd  = 70 + ((i * 37 + seed * 1000) % 50);  // px/s
      const dist = spd * (elapsed / 1000);
      const px = sx + Math.cos(ang) * dist;
      const py = cy + Math.sin(ang) * dist;
      const a  = Math.max(0, 1 - t) * 0.9;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(px, py, 2.4 * (1 - t * 0.5), 0, Math.PI * 2);
      ctx.fillStyle = i % 3 === 0 ? '#fde047'
                    : i % 3 === 1 ? '#f97316'
                                  : '#fca5a5';
      ctx.fill();
    }
    ctx.restore();
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
    const hexS = this._hexScale();

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

      // Site-flag glyphs ride on the hex centre - 🌊 submarine,
      // 🌿 astrobiology, ⛅ aerostat (atmospheric). One flag sits
      // dead-centre; multiples spread horizontally so they all
      // fit inside the larger HEX_R. Comets don't take a hex,
      // so for them we tuck the row above the lander disc to
      // keep the 🚀 glyph readable.
      const flags = [];
      if (site.submarine)    flags.push('🌊');
      if (site.astrobiology) flags.push('🌿');
      if (site.atmospheric)  flags.push('⛅');
      // Push-sat is a hand-drawn vector glyph (matching the card's
      // push-sat), so it takes its own slot in the centre row after
      // the emoji flags rather than being an emoji itself.
      const hasPush = !!site.push;
      const total = flags.length + (hasPush ? 1 : 0);
      if (total) {
        const emoji = Math.max(8, EMOJI_PX * hexS);
        const dy = vis.kind === 'comet' ? -emoji - 4 : 0;
        const spread = emoji * 0.7;
        const startX = sx - spread * (total - 1) / 2;
        let slot = 0;
        ctx.font = `${emoji}px ${EMOJI_FONT}`;
        for (let i = 0; i < flags.length; i++, slot++) {
          ctx.fillText(flags[i], startX + slot * spread, sy + dy);
        }
        if (hasPush) {
          drawPushSat(ctx, startX + slot * spread, sy + dy, emoji);
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
      // Zone-painter: grabbing an existing polygon vertex starts a
      // vertex drag instead of a pan, so points can be nudged into
      // place. A plain press anywhere else still pans.
      if (this._zonePaint.active && this.options.zoneEditMode) {
        const wp = this._eventToWorld(ev);
        const vi = this._hitTestZoneVertex(wp.x, wp.y);
        if (vi >= 0) {
          this._zoneDragVertex = vi;
          this._zoneGrabConsumed = true; // suppress the trailing click
          return;
        }
      }
      this._dragStart = {
        x: ev.clientX, y: ev.clientY,
        panX: this.pan.x, panY: this.pan.y,
        moved: false,
      };
    });
    window.addEventListener('mousemove', (ev) => {
      if (this._zoneDragVertex != null) {
        const wp = this._eventToWorld(ev);
        this.moveZoneVertex(this._zoneDragVertex, wp.x, wp.y);
        return;
      }
      if (!this._dragStart) return;
      const dx = ev.clientX - this._dragStart.x;
      const dy = ev.clientY - this._dragStart.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) this._dragStart.moved = true;
      this.pan.x = this._dragStart.panX + dx;
      this.pan.y = this._dragStart.panY + dy;
      if (this._dragStart.moved) this._noteUserCamera();
      this._scheduleDraw();
    });
    window.addEventListener('mouseup', () => {
      this._dragStart = null;
      if (this._zoneDragVertex != null) {
        this._zoneDragVertex = null;
        this._recomputeDerivedAssignments(); // moved vertex changed coverage
        this._scheduleDraw();
        this._emitZonePaintChange();         // persist the moved vertex
      }
    });

    // Click dispatched only if the mousedown→mouseup didn't drag.
    this.canvas.addEventListener('click', (ev) => {
      // Mobile browsers fire a synthesized `click` right after a
      // touchend even with `touch-action: none`. The touchend
      // handler already called onSelect for the tap; if we let
      // this click also call onSelect the second invocation
      // matches _selectedId and immediately DESELECTS - that's
      // why on mobile the popup + ring "show up and close right
      // away." Bail when a recent touch interaction owned the
      // event. _touchActive is set in _wireHover (same flag that
      // suppresses the hover tooltip on touch).
      if (this._touchActive) return;
      if (this._dragStart && this._dragStart.moved) return;
      // Zone-painter mode owns clicks: SHIFT+click drops a polygon
      // vertex; a plain click does nothing (so the map can be panned
      // / clicked freely). A click right after a vertex grab is
      // swallowed so it doesn't drop a duplicate point.
      if (this._zonePaint.active && this.options.zoneEditMode) {
        if (this._zoneGrabConsumed) { this._zoneGrabConsumed = false; return; }
        if (ev.shiftKey) {
          const wp = this._eventToWorld(ev);
          this.addZonePolyPoint(wp.x, wp.y);
        }
        return;
      }
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
        if (this._gesture.moved) this._noteUserCamera();
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
        this._noteUserCamera();
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
            if (this._zonePaint.active && this.options.zoneEditMode) {
              this.addZonePolyPoint(pt.x, pt.y);
            } else {
              const hit = this._hitTest(pt.x, pt.y);
              if (this.options.debug) this._emitDebugClick(pt, hit);
              if (hit && this.onSelect) this.onSelect(hit);
            }
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
    this._noteUserCamera();
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

  // Debug zone painter overlay (screen space). Paints a dot in the
  // zone colour over every already-assigned waypoint, plus the
  // in-progress lasso (dashed outline + translucent fill + vertex
  // handles). No-op unless something is assigned or being drawn.
  // Canonical zone regions (world space, behind everything). Outer
  // zones drawn first so the nested inner regions paint on top.
  // `visualizeZones` gates it; `zoneFill` toggles the fill; the border
  // opacity follows `zoneOpacity` (0.01..1).
  // Animated red pulse ring around hazard nodes the active route
  // crosses. Drawn live (on top of the cached static layer) so it
  // keeps pulsing without invalidating the cache. No route = no-op.
  _drawHazardPulseScreen(ctx) {
    if (!this._routeHazardIds || !this._routeHazardIds.size) return;
    const eff = this.zoom * this.fitScale;
    const hostW = this.hostW, hostH = this.hostH;
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

  _drawCanonicalZones(ctx, eff) {
    if (!this.options.visualizeZones) return;
    const cz = this._canonicalZones;
    const order = (cz.order && cz.order.length) ? cz.order : Object.keys(cz.polys);
    if (!order.length) return;
    // Inner -> outer list of zones that actually have a polygon.
    // fillCol uses the richer (vivid) palette so the colour reads even
    // at low opacity; the border keeps the canonical colour.
    const arr = [];
    for (const zone of order) {
      const polys = cz.polys[zone];
      if (polys && polys.length) {
        arr.push({
          polys,
          col: cz.colors[zone] || '#22d3ee',
          fillCol: (cz.vivid && cz.vivid[zone]) || cz.colors[zone] || '#22d3ee',
        });
      }
    }
    if (!arr.length) return;
    const op = Math.max(0.01, Math.min(1, this.options.zoneOpacity ?? 0.5));
    const curved = this.options.zoneCurved !== false;
    const addPath = (pts) => {
      if (curved) { appendSmoothClosedPath(ctx, pts); return; }
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y);
      ctx.closePath();
    };
    ctx.save();
    ctx.lineJoin = 'round';
    // FILLS: each zone is the RING between its polygon and the
    // next-inner zone's polygon (punched out with an even-odd hole),
    // so colours never stack - every pixel is exactly one zone's
    // colour, independent of what nests beneath it.
    if (this.options.zoneFill) {
      // Floor + slope so the fill still reads as a rich colour at low
      // opacity (10% default) instead of washing out to near-nothing.
      ctx.globalAlpha = Math.min(0.9, 0.12 + op * 0.7);
      for (let i = 0; i < arr.length; i++) {
        ctx.fillStyle = arr[i].fillCol;
        ctx.beginPath();
        for (const pts of arr[i].polys) if (pts && pts.length >= 2) addPath(pts);
        if (i > 0) for (const pts of arr[i - 1].polys) if (pts && pts.length >= 2) addPath(pts);
        ctx.fill('evenodd');
      }
    }
    // BORDERS: each zone strokes its own outline once.
    ctx.globalAlpha = Math.min(1, op + 0.2);
    ctx.lineWidth = 2.5 / eff; // ~2.5 screen px regardless of zoom
    for (const z of arr) {
      ctx.strokeStyle = z.col;
      for (const pts of z.polys) {
        if (!pts || pts.length < 2) continue;
        ctx.beginPath();
        addPath(pts);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  _drawZonePaintScreen(ctx) {
    // The live painter overlay only shows in zone-edit mode; the
    // canonical visualisation is handled separately behind the map.
    if (!this.options.zoneEditMode) return;
    const zp = this._zonePaint;
    const zones = Object.keys(zp.zonePolys);
    if (!zp.assignments.size && !zones.length) return;
    const eff = this.zoom * this.fitScale;
    const toS = (x, y) => ({ x: this.pan.x + x * eff, y: this.pan.y + y * eff });

    // One polygon per zone, filled + outlined in its colour. The
    // ACTIVE zone is dashed with draggable white vertex handles; the
    // others are solid with small colour dots.
    for (const zone of zones) {
      const poly = zp.zonePolys[zone];
      if (!poly || poly.length < 1) continue;
      const isActive = zone === zp.active;
      const col = zp.colors[zone] || '#22d3ee';
      const pts = poly.map((v) => toS(v.x, v.y));
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      if (pts.length >= 3) {
        ctx.closePath();
        ctx.globalAlpha = isActive ? 0.18 : 0.12;
        ctx.fillStyle = col;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.lineWidth = isActive ? 2 : 1.5;
      ctx.strokeStyle = col;
      if (isActive) ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, isActive ? 4 : 3, 0, Math.PI * 2);
        ctx.fillStyle = isActive ? '#fff' : col;
        ctx.fill();
        if (isActive) { ctx.lineWidth = 2; ctx.strokeStyle = col; ctx.stroke(); }
      }
    }

    if (zp.assignments.size) {
      for (const [id, zone] of zp.assignments) {
        const s = this.data && this.data.byId[id];
        if (!s) continue;
        const p = toS(s.x, s.y);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = zp.colors[zone] || '#22d3ee';
        ctx.globalAlpha = 0.9;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.stroke();
      }
    }

  }

  // JS hit-test against every site, preferring real sites within a
  // generous radius (so a tap on the hex always wins over a stray
  // waypoint hit). ~1500 distance computations is sub-millisecond.
  _hitTest(wx, wy) {
    const eff = this.zoom * this.fitScale;
    const sx = this.pan.x + wx * eff;
    const sy = this.pan.y + wy * eff;
    // Routing/manual mode: route waypoints (hohmann / lagrange / burn) ARE
    // valid targets, and the first hohmann dot of a transfer sits right next
    // to its origin site. Normally a real site's generous 22px pick radius
    // short-circuits and swallows that dot, so you can't tap into a Hohmann
    // transfer. In routing mode we tighten the site radius and pick whichever
    // of {closest site, closest waypoint} is genuinely nearer the tap.
    const routing = !!this.routingHit;
    let bestSite = null;
    let bestSiteDist = (routing ? 15 * 15 : 22 * 22);
    for (const s of this._realSites) {
      const vis = TYPE_VIS[s.type] || TYPE_VIS.unknown;
      if (vis.kind === 'sun')   continue;
      if (s.isLandable === false) continue;
      const dx = (this.pan.x + s.x * eff) - sx;
      const dy = (this.pan.y + s.y * eff) - sy;
      const d = dx * dx + dy * dy;
      if (d < bestSiteDist) { bestSiteDist = d; bestSite = s; }
    }
    if (bestSite && !routing) return bestSite;
    // Waypoints: hit radius can be larger than the visible disc
    // (e.g. hohmann is 2px painted but accepts a 10px click).
    let bestWp = null;
    let bestWpDist = Infinity;
    for (const w of this._waypoints) {
      if (w.isDecorative) continue;
      const vis = TYPE_VIS[w.type] || TYPE_VIS.unknown;
      if (vis.kind === 'none') continue;
      const baseR = isLeoWaypoint(w) ? vis.r * 2 : vis.r;
      const hitR = (vis.hitR != null ? vis.hitR : Math.max(baseR, 8)) + 2;
      const dx = (this.pan.x + w.x * eff) - sx;
      const dy = (this.pan.y + w.y * eff) - sy;
      const d = dx * dx + dy * dy;
      if (d <= hitR * hitR && d < bestWpDist) { bestWp = w; bestWpDist = d; }
    }
    if (!routing) return bestWp;
    // Routing: nearest node wins, whether it's a site or a waypoint.
    if (bestSite && (!bestWp || bestSiteDist <= bestWpDist)) return bestSite;
    return bestWp || bestSite;
  }

  // Toggle routing/manual hit-testing: when on, route waypoints (hohmann,
  // lagrange, burn) become tappable even right next to a site.
  setRoutingHit(on) { this.routingHit = !!on; }

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
      // Prospector-badge hover comes first - it's a small overlay
      // on top of the rocket sprite and would lose to the larger
      // site hit-test underneath if we checked sites first.
      const rect = this.canvas.getBoundingClientRect();
      const scx = ev.clientX - rect.left;
      const scy = ev.clientY - rect.top;
      const badge = this._prospectorBadgeBox;
      if (badge) {
        const dx = scx - badge.x;
        const dy = scy - badge.y;
        if (dx * dx + dy * dy <= badge.r * badge.r) {
          if (lastId !== '__prosp__') {
            lastId = '__prosp__';
            this._showProspectorBadgeTooltip(badge, ev);
          } else {
            this._positionTooltip(ev);
          }
          return;
        }
      }
      // Rocket sprite (the body, not the badge) - show the
      // modifier-baked thrust triangle so the player can see the
      // FINAL active thrust + fuel-per-burn without opening the
      // stack modal. Only renders when an active thruster is
      // present (browse.js fills the .thruster slot).
      const rb = this._sandboxRocketBox;
      if (rb && rb.thruster
          && scx >= rb.x && scx <= rb.x + rb.w
          && scy >= rb.y && scy <= rb.y + rb.h) {
        if (lastId !== '__rocket__') {
          lastId = '__rocket__';
          this._showRocketThrustTooltip(rb, ev);
        } else {
          this._positionTooltip(ev);
        }
        return;
      }
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
    // Tags row: season (only if the node requires a specific
    // apparition) + heliocentric zone. Each renders as its own
    // chip with a colour that matches the underlying game system
    // (synodic palette for the season, neutral grey for the zone).
    if (site.siteSynodic || site.solarZone || site.push) {
      const tags = document.createElement('div');
      tags.className = 't-tags';
      if (site.siteSynodic) {
        const chip = document.createElement('span');
        chip.className = `t-tag t-tag-season t-tag-season-${site.siteSynodic}`;
        chip.textContent = `${site.siteSynodic} season`;
        chip.title = `Only accessible during the ${site.siteSynodic} apparition window.`;
        tags.appendChild(chip);
      }
      if (site.solarZone) {
        const chip = document.createElement('span');
        chip.className = 't-tag t-tag-zone';
        chip.textContent = `${site.solarZone} zone`;
        chip.title = `Heliocentric zone (drives solar-power modifier).`;
        tags.appendChild(chip);
      }
      if (site.push) {
        const chip = document.createElement('span');
        chip.className = 't-tag t-tag-push';
        // Same push-sat glyph as the card + the map marker: panels +
        // body/dish + downward beams, as an inline SVG so the chip
        // reads identically to the hex flag.
        chip.innerHTML = '<svg viewBox="-11 -6 22 19" width="12" height="11" aria-hidden="true" style="vertical-align:-2px">'
          + '<rect x="-9.5" y="-3.2" width="6" height="6.4" rx="0.6" fill="#5aa0e0" stroke="#cde6ff" stroke-width="0.8"/>'
          + '<rect x="3.5" y="-3.2" width="6" height="6.4" rx="0.6" fill="#5aa0e0" stroke="#cde6ff" stroke-width="0.8"/>'
          + '<rect x="-3" y="-4.2" width="6" height="8.4" rx="1.2" fill="#cbd5e1" stroke="#7b8aa3" stroke-width="0.8"/>'
          + '<circle cx="0" cy="-0.2" r="1.5" fill="#7b8aa3"/>'
          + '<g stroke="#9fd0ff" stroke-width="1.5" stroke-linecap="round" fill="none"><path d="M-3 6.2 L0 8.6 L3 6.2"/><path d="M-3 8.8 L0 11.2 L3 8.8"/></g>'
          + '</svg> push-sat';
        chip.title = `A push-sat (beamed-power relay) covers this site: a stack here can draw the push-sat support for free.`;
        tags.appendChild(chip);
      }
      el.appendChild(tags);
    }
    // Your-ISRU chip. This shows the PLAYER'S active prospector
    // ISRU (NOT the site's number - that's the leading digit of
    // siteSize and reads from the meta row above). The chip
    // exists because the prospect / refuel gate keys on the
    // RIG'S ISRU vs the SITE'S water: rig.ISRU <= site.hydration
    // means you can prospect / refuel here. Tag the chip ✓ when
    // the gate passes, ✗ when it doesn't, so the player can
    // read pass/fail without doing the math themselves.
    if (this._popupRocketInfo) {
      const info = this._popupRocketInfo;
      const water = Number.isFinite(site.hydration) ? site.hydration : 0;
      const isru  = info.isru;
      // A rig is present whenever an ISRU rating is set, including 0 (the best
      // rig: ISRU 0 clears the gate at every site). null = no active rig.
      const hasRig = Number.isFinite(isru);
      const passes = hasRig && isru <= water;
      const chip = document.createElement('div');
      chip.className = 't-isru' + (hasRig
        ? (passes ? ' is-pass' : ' is-fail')
        : ' is-unknown');
      chip.innerHTML = hasRig
        ? `<strong>Your ISRU</strong><b>${isru}</b>`
          + `<em>vs ${water} water ${passes ? '✓' : '✗'}</em>`
        : `<strong>Your ISRU</strong><em>activate a rig to see</em>`;
      chip.title = hasRig
        ? `Your active rig has ISRU ${isru}. The site holds ${water} water. `
          + `Rig ISRU ≤ site water means you can prospect / refuel here.`
        : `Activate a missile / raygun / buggy prospector (or refinery) `
          + `to see your ISRU rating.`;
      el.appendChild(chip);
    }
    // Node id2 - a human-friendly stable reference generated at
    // data-load time (see planner-map.js#makeRefId). Reads as
    // e.g. "comet-borrelly", "dresda", "lag-leo", "burn-3a2b9".
    // The raw vendor float id stays on the title for the rare
    // case someone needs to grep the planner JSON directly.
    if (site.id2 || site.id) {
      const locId = site.id2 || shortRefId(site.id);
      const idRow = document.createElement('div');
      idRow.className = 't-id t-id-row';
      const idText = document.createElement('span');
      idText.className = 't-id-text';
      idText.textContent = `id: ${locId}`;
      idText.title = `raw key: ${site.id}`;
      idRow.appendChild(idText);
      // Copy the location id to the clipboard.
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 't-id-btn';
      copyBtn.title = 'Copy id';
      copyBtn.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">'
        + '<rect x="5" y="5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/>'
        + '<path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2H11" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        try { navigator.clipboard && navigator.clipboard.writeText(locId); } catch (_) { /* ignore */ }
        const prev = copyBtn.innerHTML;
        copyBtn.classList.add('is-ok');
        copyBtn.textContent = '✓';
        setTimeout(() => { copyBtn.classList.remove('is-ok'); copyBtn.innerHTML = prev; }, 900);
      });
      idRow.appendChild(copyBtn);
      // Open the player notes + tags modal for this location (wired by the host).
      const notesBtn = document.createElement('button');
      notesBtn.type = 'button';
      notesBtn.className = 't-id-btn t-id-notes';
      notesBtn.title = 'Notes & tags';
      notesBtn.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">'
        + '<rect x="3" y="2" width="10" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/>'
        + '<line x1="5.5" y1="6" x2="10.5" y2="6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'
        + '<line x1="5.5" y1="9" x2="9" y2="9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>'
        + '<span class="t-id-notes-badge" hidden></span>';
      notesBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof this.onSiteNotes === 'function') this.onSiteNotes(locId, site.name || site.label || locId);
      });
      idRow.appendChild(notesBtn);
      el.appendChild(idRow);
    }
    if (actions && actions.length) {
      const row = document.createElement('div');
      row.className = 'popup-actions';
      for (const a of actions) {
        if (!a || !a.label) continue;
        // Variant drives the per-button colour: 'rocket' is the
        // primary blue plan-route action, 'secondary' is the
        // dimmer Navigate-to inspection action. Legacy `primary:
        // true` still resolves to the rocket-blue style so old
        // callers don't break.
        const variant = a.variant || (a.primary ? 'rocket' : 'secondary');
        // Action descriptors may carry a `trailing` sub-action
        // (e.g. a ⚙ gear next to "Plan rocket route" that pops
        // route-config options). When present, wrap the main
        // button + the trailing button in a flex row so they
        // share one popup line and the gear takes its natural
        // square width instead of stretching.
        if (a.trailing && a.trailing.label) {
          // Inline styles win against the generic .popup-btn rule
          // no matter what CSS happens to load - the pair sat
          // invisible behind specificity wars before. Stylesheet
          // .popup-action-pair / .pair-main / .pair-trailing
          // still applies as a backup; the inline values just
          // guarantee the layout works first paint.
          const slot = document.createElement('div');
          slot.className = 'popup-action-pair';
          slot.style.display = 'flex';
          slot.style.gap = '6px';
          slot.style.alignItems = 'stretch';
          const b = document.createElement('button');
          b.type = 'button';
          b.className = `popup-btn popup-btn-${variant} pair-main`;
          b.textContent = a.label;
          b.disabled = !!a.disabled;
          b.style.flex = '1 1 auto';
          b.style.width = 'auto';
          b.style.minWidth = '0';
          if (a.title) b.title = a.title;
          if (a.onClick) b.addEventListener('click', a.onClick);
          const g = document.createElement('button');
          g.type = 'button';
          g.className = `popup-btn popup-btn-${a.trailing.variant || 'secondary'} pair-trailing`;
          g.textContent = a.trailing.label;
          g.disabled = !!a.trailing.disabled;
          g.style.flex = '0 0 auto';
          g.style.width = '40px';
          g.style.minWidth = '40px';
          g.style.padding = '0';
          g.style.fontSize = '16px';
          g.style.lineHeight = '1';
          if (a.trailing.title) g.title = a.trailing.title;
          if (a.trailing.onClick) g.addEventListener('click', a.trailing.onClick);
          slot.appendChild(b);
          slot.appendChild(g);
          row.appendChild(slot);
          continue;
        }
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `popup-btn popup-btn-${variant}`;
        b.textContent = a.label;
        b.disabled = !!a.disabled;
        if (a.title) b.title = a.title;
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

  // Hover tooltip for the rocket sprite (body, not badge). Renders
  // the card-ui thrust triangle with modifier-baked numbers so
  // the player sees the FINAL active thrust + fuel-per-burn at
  // a glance. We pass a synthetic face so the visual reuses the
  // exact same SVG idiom as on the cards.
  _showRocketThrustTooltip(box, ev) {
    const t = this._tooltipEl;
    const thr = box.thruster;
    if (!thr) { this._hideTooltip(); return; }
    t.innerHTML = `
      <div class="t-name">${thr.name || 'Active thruster'}</div>
      <div class="t-meta">
        <span>Modified final</span>
        <span class="${thr.canLift ? 'ok' : 'bad'}">· thrust ${thr.thrust} vs wet ${thr.wetMass}</span>
      </div>
      <div class="t-rocket-thrust"></div>
    `;
    const host = t.querySelector('.t-rocket-thrust');
    const tv = thrustVisual({}, {
      thrust: thr.thrust,
      fuel:   thr.fuel,
    });
    host.appendChild(tv);
    t.classList.remove('hidden');
    this._positionTooltip(ev);
  }

  // Hover tooltip for the prospector badge on the rocket sprite.
  // Shows the kind name + the rig's ISRU; ISRU is the prospect /
  // refuel gating value so it's the headline number.
  _showProspectorBadgeTooltip(badge, ev) {
    const t = this._tooltipEl;
    const kindLabel = {
      missile: 'Missile prospector',
      raygun:  'Raygun prospector',
      buggy:   'Buggy prospector',
    }[badge.kind] || 'Prospector';
    const isruStr = Number.isFinite(badge.isru) ? badge.isru : '-';
    const nameLine = badge.name
      ? `<div class="t-name">${badge.name}</div>` : '';
    t.innerHTML = `
      ${nameLine}
      <div class="t-meta">
        <span>${kindLabel}</span>
        <span>· ISRU <strong>${isruStr}</strong></span>
      </div>
    `;
    t.classList.remove('hidden');
    this._positionTooltip(ev);
  }
}
