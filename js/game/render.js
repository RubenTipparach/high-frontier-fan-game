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
const HEX_R = 22;
const TYPE_VIS = {
  site:           { kind: 'hex',    r: HEX_R, haloR: 20 },
  'gas-giant':    { kind: 'hex',    r: HEX_R, haloR: 48 },
  'inner-planet': { kind: 'hex',    r: HEX_R, haloR: 22 },
  planet:         { kind: 'hex',    r: HEX_R, haloR: 22 },
  dwarf:          { kind: 'hex',    r: HEX_R, haloR: 24 },
  tno:            { kind: 'hex',    r: HEX_R, haloR: 18 },
  moon:           { kind: 'hex',    r: HEX_R, haloR: 18 },
  comet:          { kind: 'comet',  r:  5 },
  asteroid:       { kind: 'hex',    r: HEX_R, haloR: 10, rocky: true },
  surface:        { kind: 'hex',    r: HEX_R, haloR: 20 },
  sun:            { kind: 'sun',    r: 60 },
  lagrange:       { kind: 'circle', r:  7, fill: 'transparent', stroke: '#c66932' },
  burn:           { kind: 'circle', r:  6, hitR: 8, fill: '#d60f7a', stroke: '#fde0ee', hideBelowZoom: 1.4 },
  hohmann:        { kind: 'circle', r:  2, hitR: 8, fill: '#10b981', stroke: '#a7f3d0' },
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

// siteSynodic in the planner data is 'red' | 'yellow' | 'blue'. We
// translate to UI-tuned hex values; same intent, palette adapted
// to our darker backdrop.
const SYNODIC_COLOURS = {
  red:    '#f87171',
  yellow: '#facc15',
  blue:   '#60a5fa',
};

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
  }

  // ---- public surface ----

  setRoute(segments) {
    this._route = segments && segments.length ? segments : null;
    this._scheduleDraw();
  }

  setRouteEndpoints(fromId, toId) {
    this._routeFromId = fromId || null;
    this._routeToId = toId || null;
    this._scheduleDraw();
  }

  reset() {
    this._fitToData();
    this._scheduleDraw();
  }

  // ---- setup ----

  _buildAsteroidBelt() {
    // Seeded particle field placed in a torus-like band around the
    // Sun's position at the radial distance the asteroid belt
    // occupies in our layout. Particles are static; we just want a
    // textural cue.
    this._beltParticles = [];
    let seed = 54321;
    const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let i = 0; i < 220; i++) {
      const angle = rand() * Math.PI * 2;
      const r = 360 + rand() * 200;
      const x = SUN_X + Math.cos(angle) * r;
      const y = SUN_Y + Math.sin(angle) * r;
      this._beltParticles.push({
        x, y,
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
    const straight = this.data.straightEdges || this.data.edges;
    for (const [a, b, dv] of straight) {
      const sa = this.data.byId[a], sb = this.data.byId[b];
      if (!sa || !sb) continue;
      const seg = { sa, sb, dv };
      if (sa.hazard || sb.hazard) this._hazardEdges.push(seg);
      else this._normalEdges.push(seg);
    }
    this._chains = [];
    this._hazardChains = [];
    for (const chain of (this.data.chains || [])) {
      const pts = chain.map((id) => this.data.byId[id]).filter(Boolean);
      if (pts.length < 2) continue;
      const isHazard = pts.some((p) => p.hazard);
      (isHazard ? this._hazardChains : this._chains).push(pts);
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
    const rect = this.host.getBoundingClientRect();
    this.hostW = Math.max(1, rect.width);
    this.hostH = Math.max(1, rect.height);
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.hostW * this.dpr);
    this.canvas.height = Math.round(this.hostH * this.dpr);
    this.canvas.style.width = this.hostW + 'px';
    this.canvas.style.height = this.hostH + 'px';
    this.fitScale = Math.min(this.hostW / VIEW_W, this.hostH / VIEW_H);
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
      this._drawZoneBands(ctx, this.data.zones);
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
    // Static cloud of rocky particles in the belt zone. Cheap: one
    // path per tint colour, batched fill.
    const eff = this.zoom * this.fitScale;
    // Particle size is in world units; counter-scale so dots stay
    // small even when zoomed in.
    const counter = 1 / Math.max(1, eff * 0.5);
    for (const tint of ['#8e7c66', '#cbb89a']) {
      ctx.fillStyle = tint;
      ctx.beginPath();
      for (const p of this._beltParticles) {
        if (p.tint !== tint) continue;
        ctx.globalAlpha = p.alpha;
        const r = p.size * counter;
        ctx.moveTo(p.x + r, p.y);
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      }
      // Use stroke=0 fill; we accept that all dots in a batch share
      // the per-particle alpha being overwritten as we add each
      // sub-path. Visually fine because the alphas are close.
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  _drawZoneBands(ctx, zones) {
    const startY = 60;
    const bandH = (VIEW_H - 60 - 60) / zones.length;
    ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (let i = 0; i < zones.length; i++) {
      const y = startY + bandH * i;
      ctx.fillStyle = ZONE_BAND_LIGHT.includes(zones[i])
        ? 'rgba(17, 20, 42, 0.4)'
        : 'rgba(12, 13, 31, 0.3)';
      ctx.fillRect(0, y, VIEW_W, bandH);
      ctx.fillStyle = '#5b6688';
      ctx.fillText(zones[i].toUpperCase(), 14, y + bandH / 2 + 2);
    }
  }

  _drawEdges(ctx) {
    // One stroke call per category. Browser batches all the line
    // segments in the path into a single GPU command.
    const eff = this.zoom * this.fitScale;
    ctx.lineWidth = 1.4 / eff;

    ctx.strokeStyle = '#cbd5e1';
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    for (const { sa, sb } of this._normalEdges) {
      ctx.moveTo(sa.x, sa.y);
      ctx.lineTo(sb.x, sb.y);
    }
    // Decorative chains as smooth Bezier ribbons: planner uses
    // chains of decoratives to bend a straight line into a curve,
    // so we draw them as one continuous quadratic-through-midpoints
    // spline. Same path, no extra style change.
    for (const pts of this._chains) appendSmoothPath(ctx, pts);
    ctx.stroke();

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
        ctx.moveTo(w.x + r, w.y);
        ctx.arc(w.x, w.y, r, 0, Math.PI * 2);
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
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.9)';
    ctx.lineWidth = 4 / eff;
    ctx.lineCap = 'round';
    ctx.shadowBlur = 6 / eff;
    ctx.shadowColor = 'rgba(251, 191, 36, 0.6)';
    // Build a single polyline for the whole route, then run it
    // through the same smooth-Bezier helper so segments that pass
    // through decorative waypoints curve naturally instead of
    // zigzagging.
    const pts = this._routePoints();
    ctx.beginPath();
    if (pts.length >= 2) appendSmoothPath(ctx, pts);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  _routePoints() {
    const out = [];
    if (!this._route || !this._route.length) return out;
    const first = this.data.byId[this._route[0].from];
    if (first) out.push(first);
    for (const seg of this._route) {
      const sb = this.data.byId[seg.to];
      if (sb) out.push(sb);
    }
    return out;
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
          if (sx < -vis.r || sx > hostW + vis.r || sy < -vis.r || sy > hostH + vis.r) continue;
          ctx.moveTo(sx + vis.r, sy);
          ctx.arc(sx, sy, vis.r, 0, Math.PI * 2);
        }
        if (vis.fill !== 'transparent') { ctx.fillStyle = vis.fill; ctx.fill(); }
        ctx.strokeStyle = vis.stroke;
        ctx.stroke();
      }

      if (landings.length) {
        // Landing burns: short rect, width scaled by w.landing
        // (planner uses 1 or 0.5 to indicate full vs. half landing).
        ctx.fillStyle = vis.fill;
        ctx.strokeStyle = vis.stroke;
        for (const w of landings) {
          const sx = this.pan.x + w.x * eff;
          const sy = this.pan.y + w.y * eff;
          if (sx < -vis.r || sx > hostW + vis.r || sy < -vis.r || sy > hostH + vis.r) continue;
          const halfH = vis.r;
          const halfW = vis.r * w.landing;
          ctx.fillRect(sx - halfW, sy - halfH, halfW * 2, halfH * 2);
          ctx.strokeRect(sx - halfW, sy - halfH, halfW * 2, halfH * 2);
        }
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
      const worldR = Math.min(vis.haloR, capWorld);
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
    for (const site of this._realSites) {
      const sx = this.pan.x + site.x * eff;
      const sy = this.pan.y + site.y * eff;
      const vis = TYPE_VIS[site.type] || TYPE_VIS.unknown;
      // Flavour-only bodies (Sun, comets) and explicitly non-
      // landable synthetics (Earth, Jupiter) skip the hex marker.
      if (vis.kind === 'sun' || vis.kind === 'comet') continue;
      if (site.isLandable === false) continue;
      const r = vis.r;
      if (sx < -r - 20 || sx > hostW + r + 20 || sy < -r - 20 || sy > hostH + r + 20) continue;

      if (vis.kind === 'hex') {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const t = (i / 6) * Math.PI * 2 - Math.PI / 2;
          const px = sx + Math.cos(t) * r;
          const py = sy + Math.sin(t) * r;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = '#0c0a16';
        ctx.fill();
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = site.hazard ? '#f87171' : '#ffffff';
        ctx.stroke();
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

      // Synodic ring sits just outside the hex.
      if (site.siteSynodic) {
        ctx.strokeStyle = SYNODIC_COLOURS[site.siteSynodic] || '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Route endpoint highlight rings.
      if (site.id === this._routeFromId || site.id === this._routeToId) {
        ctx.strokeStyle = site.id === this._routeFromId ? '#4ade80' : '#f0abfc';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(sx, sy, r + 8, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  _drawSiteLabelsScreen(ctx) {
    const eff = this.zoom * this.fitScale;
    const { hostW, hostH } = this;
    const fadeMin = this.options.labelFadeMin;
    const fadeMax = this.options.labelFadeMax;
    const labelAlpha = Math.max(0, Math.min(1,
      (this.zoom - fadeMin) / Math.max(0.01, fadeMax - fadeMin)
    ));

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    for (const site of this._realSites) {
      const sx = this.pan.x + site.x * eff;
      const sy = this.pan.y + site.y * eff;
      if (sx < -40 || sx > hostW + 40 || sy < -40 || sy > hostH + 40) continue;
      const vis = TYPE_VIS[site.type] || TYPE_VIS.unknown;

      // Site size text in the upper half of the hex.
      if (site.siteSize) {
        ctx.font = `700 ${Math.round(vis.r * 0.55)}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(site.siteSize, sx, sy - vis.r * 0.32);
      }

      // Water droplets in the lower half of the hex, one teardrop
      // per hydration unit (capped at 4 so they fit). Cyan fill +
      // a darker outline so they read against the black hex.
      if (site.hydration) {
        const count = Math.min(4, site.hydration);
        const dropH = vis.r * 0.45;
        const dropW = dropH * 0.62;
        const gap   = Math.max(1, vis.r * 0.10);
        const totalW = count * dropW + (count - 1) * gap;
        const startX = sx - totalW / 2 + dropW / 2;
        const dropY  = sy + vis.r * 0.38;
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
        ctx.font = `${Math.round(vis.r * 0.9)}px ui-monospace, menlo, monospace`;
        ctx.fillText('☠', sx, sy);
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
      if (this._dragStart && this._dragStart.moved) return;
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
        if (Math.abs(dx) + Math.abs(dy) > 3) this._gesture.moved = true;
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
      const hitR = (vis.hitR != null ? vis.hitR : Math.max(vis.r, 8)) + 2;
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
    let lastId = null;
    this.canvas.addEventListener('mousemove', (ev) => {
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
