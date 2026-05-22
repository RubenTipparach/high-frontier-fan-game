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
// MIN_ZOOM allows a little zoom-out below the initial framing so a
// user can pinch all the way out to see the whole graph. The initial
// zoom (set in _fitToData) is higher than 1.0 so the default view
// isn't a smashed-together blob.
const MIN_ZOOM = 0.7;
const MAX_ZOOM = 8;
const DEFAULT_ZOOM = 1.8;

// Body styling. Sites render as shaded spheres; waypoints stay as
// flat-coloured circles since they're abstract routing nodes, not
// physical objects.
// Real sites: black hex marker on top of a shaded-sphere body halo.
// The hex is the actual gameplay token (carries the siteSize +
// hydration glyphs); the sphere underneath gives Mars-red /
// Jupiter-tan / Europa-icy character that reads even with the hex
// covering most of it. haloFactor sets how far the sphere extends
// past the hex edge.
const TYPE_VIS = {
  site:       { kind: 'hex',    r: 12, haloFactor: 1.7 },
  planet:     { kind: 'hex',    r: 16, haloFactor: 1.65 },
  moon:       { kind: 'hex',    r: 10, haloFactor: 1.7 },
  dwarf:      { kind: 'hex',    r: 12, haloFactor: 1.65 },
  asteroid:   { kind: 'hex',    r:  8, haloFactor: 1.8 },
  tno:        { kind: 'hex',    r: 10, haloFactor: 1.7 },
  surface:    { kind: 'hex',    r: 10, haloFactor: 1.7 },
  lagrange:   { kind: 'circle', r:  7, fill: 'transparent', stroke: '#c66932' },
  burn:       { kind: 'circle', r:  7, fill: '#d60f7a', stroke: '#fde0ee' },
  hohmann:    { kind: 'circle', r:  7, fill: '#10b981', stroke: '#a7f3d0' },
  venus:      { kind: 'circle', r:  8, fill: '#fb923c', stroke: '#fed7aa' },
  radhaz:     { kind: 'circle', r:  7, fill: '#fbbf24', stroke: '#fde68a' },
  orbit:      { kind: 'circle', r:  6, fill: '#0c0a16', stroke: '#7dd3fc' },
  decorative: { kind: 'dot',    r:  2.5, fill: '#3b4a6d' },
  unknown:    { kind: 'circle', r:  4, fill: '#0c0a16', stroke: '#475569' },
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

const ZONE_BAND_LIGHT = ['Venus', 'Mars', 'Jupiter', 'Uranus'];

// siteSynodic in the planner data is 'red' | 'yellow' | 'blue'. We
// translate to UI-tuned hex values; same intent, palette adapted
// to our darker backdrop.
const SYNODIC_COLOURS = {
  red:    '#f87171',
  yellow: '#facc15',
  blue:   '#60a5fa',
};

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
      labelFadeMin: 2.2,           // zoom at which labels start fading in
      labelFadeMax: 3.0,           // zoom at which labels are fully opaque
      showDecoratives: true,
      initialZoom: DEFAULT_ZOOM,
    };
    this._frameCount = 0;
    this._frameTimer = 0;
    this._fps = 0;
    this._onFrame = null;           // optional callback fired each frame
    this._partitionSites();
    this._buildStars();
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
    // Split STRAIGHT edges into normal and hazard for stroke colour.
    // Chains (decorative-smoothed routes) are pre-built by the loader.
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
    // Pre-resolve chains into arrays of {x,y} points so the draw
    // loop doesn't repeat the lookup every frame.
    this._chains = [];
    this._hazardChains = [];
    for (const chain of (this.data.chains || [])) {
      const pts = chain.map((id) => this.data.byId[id]).filter(Boolean);
      if (pts.length < 2) continue;
      const isHazard = pts.some((p) => p.hazard);
      (isHazard ? this._hazardChains : this._chains).push(pts);
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
    this._drawEdges(ctx);
    this._drawRoute(ctx);

    ctx.restore();

    this._drawWaypointsScreen(ctx);
    this._drawSiteBodiesScreen(ctx);
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
    // Heliocentric guide rings centred on the implicit Sun position
    // (left edge, vertically centred). Subtle infrastructure layer.
    ctx.strokeStyle = '#1e293b';
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 0.8 / (this.zoom * this.fitScale);
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath();
      ctx.arc(0, VIEW_H / 2, 220 * i, 0, Math.PI * 2);
      ctx.stroke();
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

  _drawSiteBodiesScreen(ctx) {
    const eff = this.zoom * this.fitScale;
    const { hostW, hostH } = this;
    for (const site of this._realSites) {
      const sx = this.pan.x + site.x * eff;
      const sy = this.pan.y + site.y * eff;
      const vis = TYPE_VIS[site.type] || TYPE_VIS.unknown;
      const r = vis.r;
      if (sx < -r - 20 || sx > hostW + r + 20 || sy < -r - 20 || sy > hostH + r + 20) continue;

      if (vis.kind === 'hex') {
        // Body halo: shaded sphere sits BEHIND the hex, slightly
        // larger so its colour peeks out around the marker. The
        // sphere gives Mars-red / Saturn-gold / Europa-icy
        // character while the hex stays the gameplay token.
        const haloR = r * (vis.haloFactor || 1.7);
        drawShadedSphere(ctx, sx, sy, haloR, paletteFor(site), site.hazard);
        // Black hex on top.
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const t = (i / 6) * Math.PI * 2 - Math.PI / 2;  // flat-top hex
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

      // siteSynodic from the planner: a coloured ring outside the
      // body halo indicating which synodic group the site belongs
      // to. Only ~15 sites carry one.
      if (site.siteSynodic) {
        const haloR = r * (vis.haloFactor || 1.7);
        ctx.strokeStyle = SYNODIC_COLOURS[site.siteSynodic] || '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, haloR + 3, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (site.id === this._routeFromId || site.id === this._routeToId) {
        const haloR = r * (vis.haloFactor || 1.7);
        ctx.strokeStyle = site.id === this._routeFromId ? '#4ade80' : '#f0abfc';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(sx, sy, haloR + 5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  _drawSiteLabelsScreen(ctx) {
    const eff = this.zoom * this.fitScale;
    const { hostW, hostH } = this;
    // Smooth alpha fade between labelFadeMin and labelFadeMax so the
    // labels don't pop in/out; configurable via the debug panel.
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

      // Inside-hex glyphs stay at full opacity at all zooms so the
      // "what is this" info is never lost.
      ctx.font = '600 9px ui-sans-serif, system-ui, sans-serif';
      if (site.siteSize) {
        ctx.fillStyle = '#ffffff';
        ctx.fillText(site.siteSize, sx, sy - 3);
      }
      if (site.hydration) {
        ctx.fillStyle = '#7dd3fc';
        ctx.fillText(String(site.hydration), sx, sy + 9);
      }
      if (site.hazard) {
        ctx.fillStyle = '#f87171';
        ctx.font = '14px ui-monospace, menlo, monospace';
        ctx.fillText('☠', sx, sy + 5);
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

  // JS hit-test against every site, preferring real sites within a
  // generous radius (so a tap on the hex always wins over a stray
  // waypoint hit). ~1500 distance computations is sub-millisecond.
  _hitTest(wx, wy) {
    const eff = this.zoom * this.fitScale;
    const sx = this.pan.x + wx * eff;
    const sy = this.pan.y + wy * eff;
    let best = null;
    let bestDist = 20 * 20;
    for (const s of this._realSites) {
      const dx = (this.pan.x + s.x * eff) - sx;
      const dy = (this.pan.y + s.y * eff) - sy;
      const d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; best = s; }
    }
    if (best) return best;
    bestDist = 14 * 14;
    for (const w of this._waypoints) {
      // Skip decorative dots in click hit-tests — they're routing
      // structure, not selectable destinations.
      if (w.isDecorative) continue;
      const dx = (this.pan.x + w.x * eff) - sx;
      const dy = (this.pan.y + w.y * eff) - sy;
      const d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; best = w; }
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
