// SVG renderer for the delta-v map.
//
// Inputs: a target <svg> element and (optionally) a game-state shape
// describing which sites are claimed and where ships are. Stage 2 only
// uses the static SITES + EDGES; Stage 3 will pass live state.
//
// Pan/zoom is implemented with a manual transform (no external libs).
// Hover surfaces a tooltip; click fires onSelect with the site id.

import { SITES, EDGES, SITES_BY_ID, SOLAR_ZONES } from '../../data/sites.js';

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

// Site type -> visual treatment. Larger radius for bigger
// gravitational players so the eye groups them; colors split
// rocky / icy / lagrangian.
const TYPE_VIS = {
  planet:   { r: 14, fill: '#fbbf24', stroke: '#facc15' },
  moon:     { r:  8, fill: '#94a3b8', stroke: '#cbd5e1' },
  dwarf:    { r: 10, fill: '#a78bfa', stroke: '#c4b5fd' },
  asteroid: { r:  6, fill: '#9ca3af', stroke: '#d1d5db' },
  tno:      { r:  9, fill: '#67e8f9', stroke: '#a5f3fc' },
  lagrange: { r:  6, fill: '#38bdf8', stroke: '#7dd3fc' },
  orbit:    { r:  5, fill: '#1e293b', stroke: '#7dd3fc' },
  surface:  { r:  7, fill: '#fb923c', stroke: '#fdba74' },
};

// Class -> small visual hint on the prospect badge.
const CLASS_FILL = {
  A: '#4ade80', B: '#7dd3fc', C: '#fbbf24', D: '#f87171', S: '#a78bfa', '': '#475569',
};

export class MapRenderer {
  constructor(host, { onSelect } = {}) {
    this.host = host;
    this.onSelect = onSelect || null;
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.tooltipEl = null;
    this.svg = null;
    this.viewport = null;
    this._dragStart = null;
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

    this._renderZoneBands();
    this._renderEdges();
    this._renderSites();

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

  // Faint horizontal bands behind each solar zone, with the zone name
  // pinned to the left margin. Makes the layered-tree structure
  // visually obvious: Mercury runs across the top, Neptune the bottom,
  // and the eye reads a body's delta-v at a glance from how far right
  // it is on its lane.
  _renderZoneBands() {
    const g = el('g', { class: 'zone-bands' }, this.viewport);
    const bandH = 90; // matches the generator's (SVG_H - margins) / 9
    const startY = 60;
    for (let i = 0; i < SOLAR_ZONES.length; i++) {
      const y = startY + bandH * i;
      el('rect', {
        x: 0, y, width: 1400, height: bandH,
        class: 'zone-band',
        'data-zone': SOLAR_ZONES[i],
      }, g);
      el('text', {
        x: 14, y: y + bandH / 2 + 4,
        class: 'zone-label',
      }, g).textContent = SOLAR_ZONES[i];
    }
  }

  _renderEdges() {
    const g = el('g', { class: 'edges' }, this.viewport);
    for (const [a, b, dv] of EDGES) {
      const sa = SITES_BY_ID[a];
      const sb = SITES_BY_ID[b];
      if (!sa || !sb) continue;
      const line = el('line', {
        x1: sa.x, y1: sa.y, x2: sb.x, y2: sb.y,
        class: 'edge',
        'data-dv': dv,
      }, g);
      line.dataset.from = a;
      line.dataset.to = b;
      // Mid-edge dv label, faint by default.
      const mx = (sa.x + sb.x) / 2;
      const my = (sa.y + sb.y) / 2;
      el('text', {
        x: mx, y: my, class: 'edge-label', 'text-anchor': 'middle',
      }, g).textContent = dv;
    }
  }

  _renderSites() {
    const g = el('g', { class: 'sites' }, this.viewport);
    for (const site of SITES) {
      const vis = TYPE_VIS[site.type] || TYPE_VIS.asteroid;
      const groupNode = el('g', {
        class: 'site',
        transform: `translate(${site.x},${site.y})`,
      }, g);
      groupNode.dataset.id = site.id;

      // Body disc.
      el('circle', { r: vis.r, fill: vis.fill, stroke: vis.stroke, 'stroke-width': 1.5 }, groupNode);

      // Class badge if prospectable.
      if (site.class) {
        const bx = vis.r + 2, by = -vis.r - 2;
        el('rect', {
          x: bx, y: by - 8, width: 14, height: 11, rx: 2,
          fill: CLASS_FILL[site.class],
          opacity: 0.85,
        }, groupNode);
        el('text', {
          x: bx + 7, y: by + 1, class: 'class-badge', 'text-anchor': 'middle',
        }, groupNode).textContent = site.class;
      }

      // Hydration drops to the right of the badge.
      for (let i = 0; i < site.hydration; i++) {
        el('circle', {
          cx: vis.r + 22 + i * 6, cy: -vis.r - 3, r: 2,
          fill: '#7dd3fc',
        }, groupNode);
      }

      // Label. The graph has ~190 sites, so we mark "minor" bodies
      // (asteroids, moons, lagrange points) as zoom-conditional and
      // only paint their names when the renderer's zoom crosses
      // LABEL_ZOOM_THRESHOLD. Planets / dwarfs / KBOs stay labeled
      // at all zooms so the eye has reliable landmarks.
      const lbl = el('text', {
        y: vis.r + 14,
        class: 'site-label',
        'text-anchor': 'middle',
      }, groupNode);
      lbl.textContent = site.name;
      const isMinor = ['asteroid', 'moon', 'lagrange', 'orbit', 'comet'].includes(site.type);
      if (isMinor) lbl.classList.add('minor');

      // Hover + click wiring.
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
        <span class="t-class"></span>
        <span class="t-hydr"></span>
        <span class="t-vps"></span>
      </div>
      <div class="t-blurb"></div>
    `;
    t.querySelector('.t-name').textContent = site.name;
    t.querySelector('.t-type').textContent = site.type;
    t.querySelector('.t-class').textContent = site.class ? `class ${site.class}` : '';
    t.querySelector('.t-hydr').textContent = site.hydration ? `${'💧'.repeat(site.hydration)}` : '';
    t.querySelector('.t-vps').textContent = site.vps ? `${site.vps} VP` : '';
    t.querySelector('.t-blurb').textContent = site.blurb;
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
