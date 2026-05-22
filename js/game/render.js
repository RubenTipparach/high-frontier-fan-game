// SVG renderer for the delta-v map.
//
// Inputs:
//   host         a target <div> the SVG mounts into
//   data         { sites, edges, byId } as returned by the
//                planner-map loader. Waypoint nodes (lagrange,
//                burn, hohmann) render small and unlabelled;
//                site nodes render with their full label.
//   onSelect     optional click handler; receives the site object.
//
// Pan/zoom + pinch are implemented with a manual transform (no
// external libs). Hover surfaces a tooltip.

const VIEW_W = 1400;
const VIEW_H = 900;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;

// SVG namespace shortcut.
const NS = 'http://www.w3.org/2000/svg';
function el(name, attrs, parent) {
  const node = document.createElementNS(NS, name);
  if (attrs) for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

// Visual treatment per node type. Matches the planner's palette
// (white-stroked nodes on a dark backdrop, magenta burn points,
// orange lagrange rings, green hohmann transfer nodes, black-
// filled hex sites) so the two views read the same.
const TYPE_VIS = {
  site:     { kind: 'hex',    r: 14, fill: '#0c0a16', stroke: '#ffffff' },
  planet:   { kind: 'hex',    r: 14, fill: '#0c0a16', stroke: '#ffffff' },
  moon:     { kind: 'hex',    r: 12, fill: '#0c0a16', stroke: '#cbd5e1' },
  dwarf:    { kind: 'hex',    r: 13, fill: '#0c0a16', stroke: '#a78bfa' },
  asteroid: { kind: 'hex',    r: 10, fill: '#0c0a16', stroke: '#94a3b8' },
  tno:      { kind: 'hex',    r: 11, fill: '#0c0a16', stroke: '#67e8f9' },
  lagrange: { kind: 'circle', r:  9, fill: 'transparent', stroke: '#c66932' },
  burn:     { kind: 'circle', r:  9, fill: '#d60f7a', stroke: '#fde0ee' },
  hohmann:  { kind: 'circle', r:  9, fill: '#10b981', stroke: '#a7f3d0' },
  venus:    { kind: 'circle', r: 10, fill: '#fb923c', stroke: '#fed7aa' },
  radhaz:   { kind: 'circle', r:  9, fill: '#fbbf24', stroke: '#fde68a' },
  orbit:    { kind: 'circle', r:  7, fill: '#0c0a16', stroke: '#7dd3fc' },
  surface:  { kind: 'hex',    r: 11, fill: '#0c0a16', stroke: '#fdba74' },
  unknown:  { kind: 'circle', r:  4, fill: '#0c0a16', stroke: '#475569' },
};

// Class -> small visual hint on the prospect badge.
const CLASS_FILL = {
  A: '#4ade80', B: '#7dd3fc', C: '#fbbf24', D: '#f87171', S: '#a78bfa', '': '#475569',
};

// Edge path string. Straight line from a to b, to match the
// planner's edge style. (Previous iteration used Bezier S-curves;
// the user preferred the planner's straight-line look.)
function curvePath(a, b) {
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} ` +
         `L ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

// Regular hexagon as an SVG points string, centred on (0,0) with
// the first vertex pointing right. Matches the site-node shape
// used by the planner.
function hexPoints(r) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const t = (i / 6) * Math.PI * 2;
    pts.push(`${(Math.cos(t) * r).toFixed(1)},${(Math.sin(t) * r).toFixed(1)}`);
  }
  return pts.join(' ');
}

// CSS.escape polyfill-ish: site ids in the planner data are random
// floats so they contain '.', which CSS attribute selectors choke
// on without escaping.
function cssEsc(s) {
  if (window.CSS && CSS.escape) return CSS.escape(s);
  return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

export class MapRenderer {
  constructor(host, { data, onSelect } = {}) {
    this.host = host;
    this.data = data;        // { sites, edges, byId } from planner-map.js
    this.onSelect = onSelect || null;
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.tooltipEl = null;
    this.svg = null;
    this.viewport = null;
    this._dragStart = null;
    this._gesture = null;
    this._mount();
  }

  _mount() {
    this.host.innerHTML = '';
    this.host.classList.add('map-host');

    this.svg = el('svg', {
      viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
      preserveAspectRatio: 'xMidYMid meet',
      class: 'map-svg',
    }, this.host);

    // Static starfield as a backdrop. Just decorative; not interactive.
    this._renderStars();

    // Everything pan/zoomable goes inside a single group; transforming
    // it instead of mutating every child keeps interaction cheap.
    this.viewport = el('g', { class: 'viewport' }, this.svg);

    if (this.data) {
      // Cleaned-up mode renders zone bands as a subtle background;
      // classic mode skips them because the planner's layout doesn't
      // align with our zone lanes.
      if (this.data.mode === 'clean' && Array.isArray(this.data.zones)) {
        this._renderZoneBands(this.data.zones);
      }
      this._renderEdges();
      this._renderRouteLayer();
      // Partition nodes: routing waypoints (~1300) get combined into
      // a few typed <path> elements with no per-node DOM. Real sites
      // (~190) keep individual <g> wrappers so they retain
      // interactivity, CSS hit-testing, and tooltip targeting.
      this._waypoints = this.data.sites.filter((s) => s.isWaypoint);
      this._realSites = this.data.sites.filter((s) => !s.isWaypoint);
      this._renderWaypoints();
      this._renderRealSites();
      this._wireWaypointHitTest();
    }

    // Tooltip lives outside the SVG so it can use HTML.
    this.tooltipEl = document.createElement('div');
    this.tooltipEl.className = 'map-tooltip hidden';
    this.host.appendChild(this.tooltipEl);

    this._wirePanZoom();
  }

  _renderStars() {
    // Layered background: nebula gradients in <defs>, soft glow
    // halos around the densest star clusters, and ~280 stars seeded
    // deterministically so the layout is stable across renders.
    // All original SVG; we do not bundle the publisher's board art.
    const defs = el('defs', null, this.svg);

    // Three nebula gradients tucked into the corners. Each is a
    // radial gradient on a fullscreen rect; opacity sums to a faint
    // cosmic backdrop without overpowering the foreground graph.
    function nebula(id, cx, cy, color) {
      const grad = el('radialGradient', { id, cx, cy, r: '50%' }, defs);
      el('stop', { offset: '0%',   'stop-color': color, 'stop-opacity': 0.35 }, grad);
      el('stop', { offset: '60%',  'stop-color': color, 'stop-opacity': 0.06 }, grad);
      el('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': 0 }, grad);
    }
    nebula('neb-blue',   '20%', '15%', '#1e3a8a');
    nebula('neb-violet', '80%', '85%', '#581c87');
    nebula('neb-cyan',   '70%', '20%', '#155e75');
    nebula('neb-warm',   '15%', '85%', '#7c2d12');

    const bg = el('g', { class: 'stars' }, this.svg);
    el('rect', { x: 0, y: 0, width: VIEW_W, height: VIEW_H, fill: 'url(#neb-blue)' }, bg);
    el('rect', { x: 0, y: 0, width: VIEW_W, height: VIEW_H, fill: 'url(#neb-violet)' }, bg);
    el('rect', { x: 0, y: 0, width: VIEW_W, height: VIEW_H, fill: 'url(#neb-cyan)' }, bg);
    el('rect', { x: 0, y: 0, width: VIEW_W, height: VIEW_H, fill: 'url(#neb-warm)' }, bg);

    // Faint heliocentric guide rings centred near the Sun's
    // notional position (left of the canvas). Subtle enough to feel
    // like backdrop infrastructure, not a primary line.
    const sunX = 0, sunY = VIEW_H / 2;
    for (let i = 1; i <= 4; i++) {
      el('circle', {
        cx: sunX, cy: sunY, r: 220 * i,
        fill: 'none',
        stroke: '#1e293b',
        'stroke-width': 0.6,
        opacity: 0.4,
      }, bg);
    }

    // Three star layers at different sizes, with the bigger ones
    // sparser and a few given a soft outer glow so they read as
    // distant supergiants instead of pixels.
    let seed = 12345;
    const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    // Tiny pinprick stars (~200)
    let starsPath = '';
    for (let i = 0; i < 200; i++) {
      const x = (rand() * VIEW_W).toFixed(1);
      const y = (rand() * VIEW_H).toFixed(1);
      const r = (rand() * 0.6 + 0.2).toFixed(2);
      starsPath += `M ${x} ${y} m -${r} 0 a ${r} ${r} 0 1 0 ${r*2} 0 a ${r} ${r} 0 1 0 -${r*2} 0 `;
    }
    el('path', { d: starsPath, fill: '#cbd5e1', opacity: 0.55 }, bg);

    // Medium blue-white stars (~50)
    starsPath = '';
    for (let i = 0; i < 50; i++) {
      const x = (rand() * VIEW_W).toFixed(1);
      const y = (rand() * VIEW_H).toFixed(1);
      starsPath += `M ${x} ${y} m -1 0 a 1 1 0 1 0 2 0 a 1 1 0 1 0 -2 0 `;
    }
    el('path', { d: starsPath, fill: '#bae6fd', opacity: 0.7 }, bg);

    // Bright accent stars with a glow halo (~12)
    const glow = el('g', null, bg);
    for (let i = 0; i < 12; i++) {
      const x = rand() * VIEW_W;
      const y = rand() * VIEW_H;
      el('circle', { cx: x, cy: y, r: 4, fill: '#7dd3fc', opacity: 0.12 }, glow);
      el('circle', { cx: x, cy: y, r: 2, fill: '#7dd3fc', opacity: 0.4 }, glow);
      el('circle', { cx: x, cy: y, r: 1, fill: '#ffffff', opacity: 0.95 }, glow);
    }
  }

  // Subtle horizontal bands behind each solar zone. Only rendered for
  // the cleaned-up view, where the X-axis is burns-from-LEO and the
  // Y-axis is zone lane. Classic (planner) data has its own layout
  // that doesn't map onto those lanes.
  _renderZoneBands(zones) {
    const g = el('g', { class: 'zone-bands' }, this.viewport);
    const startY = 60;
    const bandH  = (900 - 60 - 60) / zones.length;
    for (let i = 0; i < zones.length; i++) {
      const y = startY + bandH * i;
      el('rect', {
        x: 0, y, width: 1400, height: bandH,
        class: 'zone-band',
        'data-zone': zones[i],
      }, g);
      el('text', {
        x: 14, y: y + bandH / 2 + 4,
        class: 'zone-label',
      }, g).textContent = zones[i];
    }
  }

  // A dedicated empty group that setRoute() repaints. Sits between
  // the static edges and the site discs so the highlighted route
  // covers the underlying edges but is itself covered by the nodes.
  _renderRouteLayer() {
    this.routeLayer = el('g', { class: 'route-layer' }, this.viewport);
  }

  // Public: paint a highlighted path on top of the static graph.
  // `segments` is what nav.findPath returns; pass null to clear.
  setRoute(segments) {
    if (!this.routeLayer) return;
    this.routeLayer.innerHTML = '';
    if (!segments || !segments.length) return;
    // Single combined path for the route, plus an inline burn-count
    // label per segment (typical route is < 20 hops so the label
    // count stays small).
    let d = '';
    for (const seg of segments) {
      const sa = this.data.byId[seg.from];
      const sb = this.data.byId[seg.to];
      if (!sa || !sb) continue;
      d += `M ${sa.x.toFixed(1)} ${sa.y.toFixed(1)} L ${sb.x.toFixed(1)} ${sb.y.toFixed(1)} `;
    }
    el('path', { d, class: 'route-edge' }, this.routeLayer);
    for (const seg of segments) {
      const sa = this.data.byId[seg.from];
      const sb = this.data.byId[seg.to];
      if (!sa || !sb) continue;
      const mx = (sa.x + sb.x) / 2;
      const my = (sa.y + sb.y) / 2;
      el('text', {
        x: mx.toFixed(1),
        y: (my - 4).toFixed(1),
        class: 'route-label',
        'text-anchor': 'middle',
      }, this.routeLayer).textContent = seg.dv;
    }
  }

  // Public: highlight the source / destination nodes by id so the
  // UI can show "you tapped here" feedback. Pass null to clear.
  setRouteEndpoints(fromId, toId) {
    if (!this.svg) return;
    for (const g of this.svg.querySelectorAll('.site')) {
      g.classList.remove('route-from', 'route-to');
    }
    if (fromId) {
      const a = this.svg.querySelector(`.site[data-id="${cssEsc(fromId)}"]`);
      if (a) a.classList.add('route-from');
    }
    if (toId) {
      const b = this.svg.querySelector(`.site[data-id="${cssEsc(toId)}"]`);
      if (b) b.classList.add('route-to');
    }
  }

  _renderEdges() {
    // Performance: 1758 edges × (1 line + 2 text labels) = 5274 DOM
    // nodes is the bulk of our paint cost. Collapse all non-hazard
    // edges into a single <path>; same for hazard edges. One DOM
    // node per category, browser does the line drawing.
    const g = el('g', { class: 'edges' }, this.viewport);
    let normalD = '';
    let hazardD = '';
    for (const [a, b] of this.data.edges) {
      const sa = this.data.byId[a];
      const sb = this.data.byId[b];
      if (!sa || !sb) continue;
      const seg = `M ${sa.x.toFixed(1)} ${sa.y.toFixed(1)} L ${sb.x.toFixed(1)} ${sb.y.toFixed(1)} `;
      if (sa.hazard || sb.hazard) hazardD += seg;
      else normalD += seg;
    }
    if (normalD) el('path', { d: normalD, class: 'edge' }, g);
    if (hazardD) el('path', { d: hazardD, class: 'edge hazard' }, g);
    // Burn-count labels are NOT pre-rendered (was 3516 text nodes,
    // most invisible at default zoom). The tooltip surfaces the dv
    // on hover; the route highlight surfaces it inline.
  }

  _renderSites() {
    this._waypoints = this.data.sites.filter((s) => s.isWaypoint);
    this._realSites = this.data.sites.filter((s) => !s.isWaypoint);
    this._renderWaypoints();
    this._renderRealSites();
  }

  // Combine each waypoint type into ONE <path> using arc subpath
  // commands. ~1300 DOM nodes -> 3-4 path elements. Hit-testing is
  // done in JS (like the planner's nearestPoint) so we don't need
  // per-node click handlers either.
  _renderWaypoints() {
    const g = el('g', { class: 'waypoints' }, this.viewport);
    const byType = new Map();
    for (const w of this._waypoints) {
      const arr = byType.get(w.type) || [];
      arr.push(w);
      byType.set(w.type, arr);
    }
    for (const [type, items] of byType) {
      const vis = TYPE_VIS[type] || TYPE_VIS.unknown;
      // Build a path of stamped circles. M cx,cy m -r,0 a r,r 0 1,0 2r,0 a r,r 0 1,0 -2r,0
      // is the standard SVG idiom for "draw a circle at cx,cy as a
      // sub-path".
      let d = '';
      for (const w of items) {
        const r = vis.r;
        d += `M ${w.x.toFixed(1)} ${w.y.toFixed(1)} ` +
             `m -${r} 0 a ${r} ${r} 0 1 0 ${r*2} 0 a ${r} ${r} 0 1 0 -${r*2} 0 `;
      }
      el('path', {
        d,
        class: 'waypoint-blob waypoint-' + type,
        fill: vis.fill,
        stroke: vis.stroke,
        'stroke-width': 2,
      }, g);
    }
  }

  // Real sites keep their <g> + per-node click listeners. ~190 of
  // these, which is well under any DOM perf cliff.
  _renderRealSites() {
    const g = el('g', { class: 'sites' }, this.viewport);
    for (const site of this._realSites) {
      const vis = TYPE_VIS[site.type] || TYPE_VIS.unknown;
      const groupNode = el('g', {
        class: 'site site-type-' + site.type,
        transform: `translate(${site.x.toFixed(1)},${site.y.toFixed(1)})`,
      }, g);
      groupNode.dataset.id = site.id;

      const stroke = site.hazard ? '#f87171' : vis.stroke;
      if (vis.kind === 'hex') {
        el('polygon', {
          points: hexPoints(vis.r),
          fill: vis.fill,
          stroke,
          'stroke-width': 2,
        }, groupNode);
      } else {
        el('circle', {
          r: vis.r,
          fill: vis.fill,
          stroke,
          'stroke-width': 2,
        }, groupNode);
      }

      if (site.siteSize) {
        el('text', {
          y: -3, class: 'site-size', 'text-anchor': 'middle',
        }, groupNode).textContent = site.siteSize;
      }
      const hyd = site.hydration | 0;
      if (hyd) {
        el('text', {
          y: 9, class: 'site-water', 'text-anchor': 'middle',
        }, groupNode).textContent = hyd;
      }
      if (site.hazard) {
        el('text', {
          y: 5, class: 'site-hazard', 'text-anchor': 'middle',
        }, groupNode).textContent = '☠';
      }
      el('text', {
        y: vis.r + 12, class: 'site-label', 'text-anchor': 'middle',
      }, groupNode).textContent = site.name;

      groupNode.addEventListener('mouseenter', () => this._showTooltip(site, groupNode));
      groupNode.addEventListener('mouseleave', () => this._hideTooltip());
      groupNode.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (this.onSelect) this.onSelect(site);
      });
    }
  }

  // Click handler on the SVG root: if the click landed on a real
  // site (DOM-routed), the per-node listener already fired. If not,
  // hit-test waypoints in JS and dispatch.
  _wireWaypointHitTest() {
    this.svg.addEventListener('click', (ev) => {
      // If the click landed inside a real-site <g>, that node's
      // own listener already fired and called stopPropagation.
      // Anything reaching here is on background or on a waypoint.
      const pt = this._eventToViewport(ev);
      const hit = this._nearestWaypoint(pt.x, pt.y, 14);
      if (hit && this.onSelect) this.onSelect(hit);
    });
  }

  // Convert a DOM event's clientX/Y into viewport (post-pan/zoom)
  // SVG coords. Required for JS hit-testing against the waypoint
  // positions stored in data-space units.
  _eventToViewport(ev) {
    const rect = this.svg.getBoundingClientRect();
    const sx = (ev.clientX - rect.left) / rect.width * VIEW_W;
    const sy = (ev.clientY - rect.top) / rect.height * VIEW_H;
    // Undo the viewport's translate + scale.
    const wx = (sx - this.pan.x) / this.zoom;
    const wy = (sy - this.pan.y) / this.zoom;
    return { x: wx, y: wy };
  }

  _nearestWaypoint(x, y, maxR) {
    let best = null;
    let bestDist = maxR * maxR;
    for (const w of this._waypoints || []) {
      const dx = w.x - x;
      const dy = w.y - y;
      const d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; best = w; }
    }
    return best;
  }

  _showTooltip(site, node) {
    const t = this.tooltipEl;
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
    t.querySelector('.t-hydr').textContent = site.hydration ? `${'💧'.repeat(site.hydration)}` : '';
    t.querySelector('.t-hazard').textContent = site.hazard ? '⚠ hazard' : '';
    t.classList.remove('hidden');
    const bb = node.getBoundingClientRect();
    const hb = this.host.getBoundingClientRect();
    t.style.left = (bb.left - hb.left + bb.width / 2) + 'px';
    t.style.top = (bb.top - hb.top - 8) + 'px';
  }

  _hideTooltip() {
    this.tooltipEl.classList.add('hidden');
  }

  _applyTransform() {
    this.viewport.setAttribute(
      'transform',
      `translate(${this.pan.x},${this.pan.y}) scale(${this.zoom})`
    );
  }

  _wirePanZoom() {
    // Mouse-wheel zoom anchored at cursor: scale, then re-center pan
    // so the point under the cursor stays put.
    this.svg.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const rect = this.svg.getBoundingClientRect();
      const sx = (ev.clientX - rect.left) / rect.width * VIEW_W;
      const sy = (ev.clientY - rect.top) / rect.height * VIEW_H;
      const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
      this._zoomAt(sx, sy, factor);
    }, { passive: false });

    // Drag-pan with the mouse. Touch is handled separately below so
    // pinch-zoom and pan can coexist on a phone or trackpad gesture.
    this.svg.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return;
      this._dragStart = { x: ev.clientX, y: ev.clientY, panX: this.pan.x, panY: this.pan.y };
      this.svg.classList.add('dragging');
    });
    window.addEventListener('mousemove', (ev) => {
      if (!this._dragStart) return;
      const rect = this.svg.getBoundingClientRect();
      const scaleX = VIEW_W / rect.width;
      const scaleY = VIEW_H / rect.height;
      this.pan.x = this._dragStart.panX + (ev.clientX - this._dragStart.x) * scaleX;
      this.pan.y = this._dragStart.panY + (ev.clientY - this._dragStart.y) * scaleY;
      this._applyTransform();
    });
    window.addEventListener('mouseup', () => {
      this._dragStart = null;
      this.svg.classList.remove('dragging');
    });

    // Touch handling: 1 finger pans, 2 fingers pinch-zoom anchored
    // at the midpoint between fingers (Google-Maps style). Page-level
    // pinch zoom is suppressed *only* within the SVG via CSS
    // touch-action: none, so the rest of the site still pinches
    // normally. We preventDefault on touchmove to stop iOS rubber-
    // banding while the gesture is in flight.
    this.svg.addEventListener('touchstart', (ev) => {
      this._snapshotGesture(ev);
    }, { passive: false });

    this.svg.addEventListener('touchmove', (ev) => {
      ev.preventDefault();
      if (!this._gesture) return;
      const rect = this.svg.getBoundingClientRect();
      const points = this._activeTouches(ev);
      if (points.length === 1 && this._gesture.touches.length === 1) {
        // Single-finger pan: translate the current pan by the touch
        // delta in viewBox units.
        const start = this._gesture.touches[0];
        const dx = (points[0].clientX - start.clientX) * (VIEW_W / rect.width);
        const dy = (points[0].clientY - start.clientY) * (VIEW_H / rect.height);
        this.pan.x = this._gesture.pan.x + dx;
        this.pan.y = this._gesture.pan.y + dy;
        this._applyTransform();
      } else if (points.length >= 2 && this._gesture.touches.length >= 2) {
        // Pinch zoom + pan: compute centroid and pairwise distance
        // at gesture-start vs. now; ratio drives zoom, centroid drift
        // drives pan, and we anchor the zoom at the centroid so the
        // pinch focus stays under the fingers.
        const startA = this._gesture.touches[0];
        const startB = this._gesture.touches[1];
        const startMidX = (startA.clientX + startB.clientX) / 2;
        const startMidY = (startA.clientY + startB.clientY) / 2;
        const startDist = Math.hypot(
          startA.clientX - startB.clientX,
          startA.clientY - startB.clientY
        ) || 1;

        const nowA = points[0];
        const nowB = points[1];
        const nowMidX = (nowA.clientX + nowB.clientX) / 2;
        const nowMidY = (nowA.clientY + nowB.clientY) / 2;
        const nowDist = Math.hypot(
          nowA.clientX - nowB.clientX,
          nowA.clientY - nowB.clientY
        ) || 1;

        const factor = nowDist / startDist;
        const targetZoom = Math.max(
          MIN_ZOOM,
          Math.min(MAX_ZOOM, this._gesture.zoom * factor)
        );
        // Centroid in viewBox coords:
        const sx = (startMidX - rect.left) / rect.width * VIEW_W;
        const sy = (startMidY - rect.top) / rect.height * VIEW_H;
        // World coords of the pinch-start centroid (relative to the
        // pre-zoom viewport):
        const wx = (sx - this._gesture.pan.x) / this._gesture.zoom;
        const wy = (sy - this._gesture.pan.y) / this._gesture.zoom;
        // Current centroid in viewBox coords:
        const cx = (nowMidX - rect.left) / rect.width * VIEW_W;
        const cy = (nowMidY - rect.top) / rect.height * VIEW_H;
        // Pan so the world point lands at the new centroid.
        this.pan.x = cx - wx * targetZoom;
        this.pan.y = cy - wy * targetZoom;
        this.zoom = targetZoom;
        this._applyTransform();
        this._updateLabelVisibility();
      }
    }, { passive: false });

    this.svg.addEventListener('touchend', (ev) => {
      // Re-snapshot remaining touches so a finger lifting off a
      // pinch becomes the new pan anchor without a jump.
      if (ev.touches.length === 0) {
        this._gesture = null;
      } else {
        this._snapshotGesture(ev);
      }
    });

    this.svg.addEventListener('touchcancel', () => {
      this._gesture = null;
    });
  }

  // Helper: zoom by `factor` anchored at the given viewBox-coord
  // point. Used by the wheel handler and could be reused by buttons.
  _zoomAt(sx, sy, factor) {
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
    const wx = (sx - this.pan.x) / this.zoom;
    const wy = (sy - this.pan.y) / this.zoom;
    this.pan.x = sx - wx * nextZoom;
    this.pan.y = sy - wy * nextZoom;
    this.zoom = nextZoom;
    this._applyTransform();
    this._updateLabelVisibility();
  }

  // Snapshot the current touch state at the start of a gesture. We
  // store the original pan/zoom so touchmove can compute deltas
  // relative to the gesture's origin rather than the previous frame
  // (avoids drift from rounding).
  _snapshotGesture(ev) {
    this._gesture = {
      touches: this._activeTouches(ev).slice(0, 2),
      pan: { x: this.pan.x, y: this.pan.y },
      zoom: this.zoom,
    };
  }

  _activeTouches(ev) {
    const out = [];
    for (const t of ev.touches) {
      out.push({ identifier: t.identifier, clientX: t.clientX, clientY: t.clientY });
    }
    return out;
  }

  reset() {
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this._applyTransform();
    this._updateLabelVisibility();
  }

  // Toggle the .minor labels in/out of view based on zoom. Keeps the
  // 188-site graph readable at default zoom (planets only) while
  // revealing the asteroid + moon labels when the user zooms in.
  _updateLabelVisibility() {
    const LABEL_ZOOM_THRESHOLD = 1.5;
    this.svg.classList.toggle('zoomed', this.zoom >= LABEL_ZOOM_THRESHOLD);
  }
}
