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
      this._renderSites();
    }

    // Tooltip lives outside the SVG so it can use HTML.
    this.tooltipEl = document.createElement('div');
    this.tooltipEl.className = 'map-tooltip hidden';
    this.host.appendChild(this.tooltipEl);

    this._wirePanZoom();
  }

  _renderStars() {
    // ~120 random points, seeded once. Subtle parallax suggestion.
    const g = el('g', { class: 'stars' }, this.svg);
    let seed = 12345;
    const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let i = 0; i < 120; i++) {
      el('circle', {
        cx: rand() * VIEW_W,
        cy: rand() * VIEW_H,
        r: rand() * 1.2 + 0.3,
        fill: rand() < 0.1 ? '#7dd3fc' : '#cbd5e1',
        opacity: rand() * 0.6 + 0.2,
      }, g);
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
    for (const seg of segments) {
      const sa = this.data.byId[seg.from];
      const sb = this.data.byId[seg.to];
      if (!sa || !sb) continue;
      el('path', {
        d: curvePath(sa, sb),
        class: 'route-edge',
      }, this.routeLayer);
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
    const g = el('g', { class: 'edges' }, this.viewport);
    for (const [a, b, dv] of this.data.edges) {
      const sa = this.data.byId[a];
      const sb = this.data.byId[b];
      if (!sa || !sb) continue;
      // Straight line, planner-style. Edge labels (burn cost) get
      // drawn near each endpoint, not at the midpoint, so they
      // associate clearly with the node they belong to even when
      // edges bundle.
      const line = el('line', {
        x1: sa.x.toFixed(1), y1: sa.y.toFixed(1),
        x2: sb.x.toFixed(1), y2: sb.y.toFixed(1),
        class: sa.hazard || sb.hazard ? 'edge hazard' : 'edge',
        'data-dv': dv,
      }, g);
      line.dataset.from = a;
      line.dataset.to = b;
      // dv label nudged 14px along the edge from each endpoint
      // (matches the planner's edgeLabels presentation).
      const dx = sb.x - sa.x;
      const dy = sb.y - sa.y;
      const d = Math.hypot(dx, dy) || 1;
      const nx = dx / d;
      const ny = dy / d;
      const off = 14;
      el('text', {
        x: (sa.x + nx * off).toFixed(1),
        y: (sa.y + ny * off).toFixed(1),
        class: 'edge-label',
        'text-anchor': 'middle',
      }, g).textContent = dv;
      el('text', {
        x: (sb.x - nx * off).toFixed(1),
        y: (sb.y - ny * off).toFixed(1),
        class: 'edge-label',
        'text-anchor': 'middle',
      }, g).textContent = dv;
    }
  }

  _renderSites() {
    const g = el('g', { class: 'sites' }, this.viewport);
    for (const site of this.data.sites) {
      const vis = TYPE_VIS[site.type] || TYPE_VIS.unknown;
      const groupNode = el('g', {
        class: 'site site-type-' + site.type + (site.isWaypoint ? ' waypoint' : ''),
        transform: `translate(${site.x.toFixed(1)},${site.y.toFixed(1)})`,
      }, g);
      groupNode.dataset.id = site.id;

      // Body shape: hexagon for real sites, circle for waypoints.
      // Black fill + white stroke matches the planner's site idiom.
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

      // Inside the hex: siteSize on top, hydration (water) below.
      // The planner stamps these two short numbers inside the node
      // because the relevant info at a glance is "how hard to claim,
      // how wet is it". We do the same.
      if (!site.isWaypoint) {
        if (site.siteSize) {
          el('text', {
            y: -3,
            class: 'site-size',
            'text-anchor': 'middle',
          }, groupNode).textContent = site.siteSize;
        }
        const hyd = site.hydration | 0;
        if (hyd) {
          el('text', {
            y: 9,
            class: 'site-water',
            'text-anchor': 'middle',
          }, groupNode).textContent = hyd;
        }
      }

      // Hazard skull overlay for hazard waypoints (radhaz / lagrange
      // hazard zones).
      if (site.hazard) {
        el('text', {
          y: 5,
          class: 'site-hazard',
          'text-anchor': 'middle',
        }, groupNode).textContent = '☠';
      }

      // External label below the node for real sites. Routing
      // waypoints (lagrange / burn / hohmann) stay anonymous; tap
      // surfaces their type in the tooltip / route status.
      if (!site.isWaypoint) {
        el('text', {
          y: vis.r + 12,
          class: 'site-label',
          'text-anchor': 'middle',
        }, groupNode).textContent = site.name;
      }

      groupNode.addEventListener('mouseenter', () => this._showTooltip(site, groupNode));
      groupNode.addEventListener('mouseleave', () => this._hideTooltip());
      groupNode.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (this.onSelect) this.onSelect(site);
      });
    }
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
