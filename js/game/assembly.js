// Sol Political Assembly (Module 0) panel - our own functional UI for the
// assembly: a hex wheel of the six ideologies around a Centrist center, with
// each ideology's Law + end-game VP award in a callout box pointing at its
// delegate space by a little arrow. Delegates render as fake-3D (isometric)
// cubes in the spaces.
//
// MOCKUP for review (M0 is not wired into play yet). Renders from
// data/assembly.js; takes an optional `delegates` map
// { ideologyKey|'centrist': [seatColor, ...] } to show placed cubes.

import { IDEOLOGIES, CENTRIST, LOBBY_RULE, IDEOLOGY_ORDER, IDEOLOGY_BY_KEY, lawForIdeology } from '../../data/assembly.js';

// The ideology record to DISPLAY, swapping in the Solitaire (4G3) law when
// `solo` is set. Awards + colours are unchanged; only the law name/text differ.
function ideoForDisplay(key, solo) {
  const ide = IDEOLOGY_BY_KEY[key];
  if (!solo) return ide;
  return { ...ide, law: lawForIdeology(key, true) || ide.law };
}

const SVGNS = 'http://www.w3.org/2000/svg';
const XHTML = 'http://www.w3.org/1999/xhtml';

// Per-variant memory of the last render's star place + per-space cube counts, so
// the NEXT render can animate what changed: the active-law star slides from its
// old space to the new one, and freshly-placed cubes drop in. Keyed by variant
// because the sidebar glance and the modal render at the same time.
const _assemblyAnim = {};
const _prefersReduced = () => {
  try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch (_) { return false; }
};
// Run queued WAAPI animations after the panel is mounted (the caller appends
// `root` synchronously right after renderAssemblyPanel returns, so a single rAF
// lands once the elements are in the DOM and can paint).
function flushAssemblyAnims(anims) {
  if (!anims.length) return;
  if (typeof requestAnimationFrame !== 'function') return;
  requestAnimationFrame(() => { for (const fn of anims) { try { fn(); } catch (_) { /* ignore */ } } });
}
function svg(tag, attrs, parent) {
  const el = document.createElementNS(SVGNS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(el);
  return el;
}
function polar(cx, cy, r, deg) {
  const a = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}
function pts(arr) { return arr.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '); }

// hex -> shaded hex (factor >1 lighten, <1 darken).
function shade(hex, f) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => Math.max(0, Math.min(255, Math.round(v * f))));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

// One fake-3D (isometric) cube centered at (cx,cy), edge ~s, base colour.
function isoCube(root, cx, cy, s, color, faint) {
  const top = { x: cx, y: cy - s };
  const rgt = { x: cx + s, y: cy - s / 2 };
  const bot = { x: cx, y: cy };
  const lft = { x: cx - s, y: cy - s / 2 };
  const bl = { x: cx - s, y: cy + s / 2 };
  const bb = { x: cx, y: cy + s };
  const br = { x: cx + s, y: cy + s / 2 };
  const o = faint ? 0.28 : 1;
  const stroke = faint ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.45)';
  svg('polygon', { points: pts([top, rgt, bot, lft]), fill: faint ? 'none' : shade(color, 1.28), stroke, 'stroke-width': 0.8, opacity: o }, root); // top
  svg('polygon', { points: pts([lft, bot, bb, bl]), fill: faint ? 'none' : shade(color, 0.78), stroke, 'stroke-width': 0.8, opacity: o }, root); // left
  svg('polygon', { points: pts([rgt, bot, bb, br]), fill: faint ? 'none' : shade(color, 0.6), stroke, 'stroke-width': 0.8, opacity: o }, root); // right
}

// Where the box edge meets the line from box-center to a target point.
function edgePoint(box, t) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = t.x - cx;
  const dy = t.y - cy;
  const tx = dx !== 0 ? (box.w / 2) / Math.abs(dx) : Infinity;
  const ty = dy !== 0 ? (box.h / 2) / Math.abs(dy) : Infinity;
  const k = Math.min(tx, ty);
  return { x: cx + dx * k, y: cy + dy * k };
}

function callout(root, box, ide, slot) {
  // Leader line from the box edge to just outside the slot, arrowhead at the end.
  const start = edgePoint(box, slot);
  const dx = slot.x - start.x;
  const dy = slot.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  const end = { x: slot.x - (dx / len) * 20, y: slot.y - (dy / len) * 20 };
  svg('line', { x1: start.x, y1: start.y, x2: end.x, y2: end.y, class: 'assembly-arrow', 'marker-end': 'url(#assembly-arrowhead)' }, root);
  // The callout box itself, as foreignObject HTML so the text wraps.
  const fo = svg('foreignObject', { x: box.x, y: box.y, width: box.w, height: box.h }, root);
  const div = document.createElementNS(XHTML, 'div');
  div.setAttribute('class', 'assembly-callout');
  div.style.setProperty('--ide-color', ide.color);
  div.innerHTML = `
    <div class="assembly-law-head">
      <span class="assembly-law-ide">${ide.name}</span>
      <span class="assembly-law-name">${ide.law.name}</span>
    </div>
    <div class="assembly-law-text">${ide.law.text}</div>
    <div class="assembly-law-award">${ide.award.text}</div>`;
  fo.appendChild(div);
}

export function renderAssemblyPanel({
  delegates = null, seniority = null, variant = 'compact',
  onCellClick = null, highlight = null, selected = null,
  activeStar = null, interactive = false, cubeGlow = null,
  deferLaws = false, solo = false,
} = {}) {
  const root = document.createElement('div');
  root.className = 'assembly-panel assembly-panel-' + variant + (interactive ? ' assembly-interactive' : '');
  const hi = highlight && highlight.has ? highlight : new Set(Array.isArray(highlight) ? highlight : []);
  const glowSet = cubeGlow && cubeGlow.has ? cubeGlow : new Set(Array.isArray(cubeGlow) ? cubeGlow : []);
  // Make a cell (ideology wedge or the center) clickable / highlightable for the
  // interactive modal (Fundraise placement / move, click-to-lobby).
  const wireCell = (cell, key) => {
    if (hi.has(key)) cell.classList.add('assembly-cell-hi');
    if (selected === key) cell.classList.add('assembly-cell-sel');
    if (onCellClick) {
      cell.classList.add('assembly-cell-click');
      cell.addEventListener('click', (e) => { e.stopPropagation(); onCellClick(key); });
    }
  };
  root.innerHTML = `
    <div class="assembly-head"><h2>Sol Political Assembly</h2><span class="assembly-sub">Module 0</span></div>`;

  const VB = { w: 900, h: 600 };
  const C = { x: 450, y: 300 };
  const R = 150, r = 62;
  // The 900x600 viewBox is sized for the 'compact' variant's ring of callout
  // boxes. The 'simple' (sidebar glance) and 'large' (modal) variants drop
  // those, so crop tight to the wheel itself (centre 450,300, outer radius 150,
  // plus room for cubes/discs) so it fills its container instead of floating
  // tiny in the middle.
  const viewBox = variant === 'compact' ? `0 0 ${VB.w} ${VB.h}` : '292 144 316 322';
  const board = svg('svg', { viewBox, class: 'assembly-board', role: 'img', 'aria-label': 'Sol Political Assembly' });

  // Arrowhead marker.
  const defs = svg('defs', {}, board);
  const marker = svg('marker', { id: 'assembly-arrowhead', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
  svg('path', { d: 'M0,0 L10,5 L0,10 z', class: 'assembly-arrowhead' }, marker);

  const centers = { freedom: -90, honor: -30, unity: 30, authority: 90, equality: 150, individuality: 210 };
  const slots = {};

  // Animation bookkeeping for THIS render: what the same variant showed last
  // time, the new per-space cube counts we are about to draw, and a queue of
  // WAAPI animations to fire once mounted. `prev` is undefined on the first
  // render of a variant, so nothing animates on open (only on later changes).
  const prev = _assemblyAnim[variant];
  const counts = {};
  const anims = [];
  const animate = !_prefersReduced();

  // Delegate cubes live anywhere on the cell (no fixed slot): drop the iso-cubes
  // near `pt` in seat colours; nothing when empty. Drawn at 2x size. Cubes added
  // since the last render of this variant (index >= the previous count) drop in.
  // Up to 6 cubes pack into a centred 3-wide grid: each row is centred on `pt`
  // by its own cube count and the whole stack is centred vertically, so a lone
  // starter cube sits dead-centre in its wedge instead of drifting up-and-left
  // (which pushed the top wedge's cube out past the edge).
  const drawCubes = (parent, pt, list, glow, placeKey) => {
    const cubes = Array.isArray(list) ? list : [];
    counts[placeKey] = cubes.length;
    if (!cubes.length) return;
    const prevN = prev && prev.counts ? (prev.counts[placeKey] | 0) : null;
    const shown = Math.min(cubes.length, 6);
    const rows = Math.ceil(shown / 3);
    cubes.slice(0, 6).forEach((col, i) => {
      const row = Math.floor(i / 3);
      const inThisRow = Math.min(3, shown - row * 3);
      const ox = pt.x + ((i % 3) - (inThisRow - 1) / 2) * 20;
      const oy = pt.y + (row - (rows - 1) / 2) * 20;
      // When this space's cubes are "selectable" (the Fundraise move origin),
      // wrap them so a blue glow marks the cube itself as the click target.
      const host = glow ? svg('g', { class: 'assembly-cube-glow' }, parent) : parent;
      const cubeG = svg('g', { class: 'assembly-cube' }, host);
      isoCube(cubeG, ox, oy, 12, col, false);
      if (animate && prevN != null && i >= prevN) {
        anims.push(() => cubeG.animate(
          [{ opacity: 0, transform: 'translateY(-7px)' }, { opacity: 1, transform: 'translateY(0px)' }],
          { duration: 520, easing: 'cubic-bezier(0.34,1.3,0.6,1)' },
        ));
      }
    });
  };

  // Seniority discs: red translucent pucks with a black outline that sit BEHIND
  // the cubes / labels (drawn before them), clustered under the ideology name.
  // They count toward the end-game vote (and break its ties).
  const drawDiscs = (parent, pt, count) => {
    const n = count | 0;
    if (n <= 0) return;
    for (let i = 0; i < Math.min(n, 8); i += 1) {
      const ox = pt.x - 13 + (i % 4) * 9;
      const oy = pt.y + 2 + Math.floor(i / 4) * 9;
      svg('circle', { cx: ox, cy: oy, r: 5, class: 'assembly-disc' }, parent);
    }
  };

  // Active-law star: a faceted 3D gold star that sits on the in-power ideology
  // (or the Centrist center when there's no clear leader, its starting spot).
  // Each of the 10 triangles from the centre alternates a light / dark gold
  // facet for the 3D bevel; a black silhouette outline keeps it readable on any
  // wedge colour.
  const drawStar = (parent, pt, size = 15) => {
    const Ro = size;
    const Ri = size * 0.42;
    const verts = [];
    for (let k = 0; k < 10; k += 1) {
      const a = (-90 + k * 36) * Math.PI / 180;
      const rad = (k % 2 === 0) ? Ro : Ri;
      verts.push([pt.x + rad * Math.cos(a), pt.y + rad * Math.sin(a)]);
    }
    const g = svg('g', { class: 'assembly-star' }, parent);
    for (let i = 0; i < 10; i += 1) {
      const a = verts[i];
      const b = verts[(i + 1) % 10];
      svg('polygon', {
        points: `${pt.x},${pt.y} ${a[0]},${a[1]} ${b[0]},${b[1]}`,
        fill: i % 2 ? '#b8801a' : '#ffe066',
      }, g);
    }
    svg('polygon', {
      points: verts.map((v) => v.join(',')).join(' '),
      fill: 'none', stroke: '#000', 'stroke-width': 1.6, 'stroke-linejoin': 'round',
    }, g);
    return g;
  };
  // Star position for any place key (matches the drawStar call offsets below),
  // so the FLIP knows both the old and new screen spots.
  const starPosFor = (place) => {
    if (!place || place === 'centrist' || centers[place] == null) return { x: C.x, y: C.y - 28 };
    const lab = polar(C.x, C.y, (r + R) / 2 - 16, centers[place]);
    return { x: lab.x, y: lab.y - 17 };
  };

  // Each ideology is one hoverable cell: wedge + label + delegate space, grouped
  // so hovering anywhere on the cell lights the whole wedge.
  IDEOLOGY_ORDER.forEach((key) => {
    const ide = IDEOLOGY_BY_KEY[key];
    const cA = centers[key];
    const cell = svg('g', { class: 'assembly-cell', 'data-key': key }, board);
    const pIL = polar(C.x, C.y, r, cA - 30);
    const pOL = polar(C.x, C.y, R, cA - 30);
    const pOR = polar(C.x, C.y, R, cA + 30);
    const pIR = polar(C.x, C.y, r, cA + 30);
    svg('polygon', { points: pts([pIL, pOL, pOR, pIR]), fill: ide.color, class: 'assembly-wedge' }, cell);
    const lab = polar(C.x, C.y, (r + R) / 2 - 16, cA);
    // Discs first (behind), clustered just under where the name sits.
    drawDiscs(cell, { x: lab.x, y: lab.y + 6 }, seniority && seniority[key]);
    const t = svg('text', { x: lab.x, y: lab.y, class: 'assembly-wedge-label', 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, cell);
    t.textContent = ide.name.toUpperCase();
    const slot = polar(C.x, C.y, R - 40, cA);
    slots[key] = slot;
    drawCubes(cell, slot, delegates && delegates[key], glowSet.has(key), key);
    wireCell(cell, key);
  });

  // Center (Centrist) is its own hoverable cell.
  const centerCell = svg('g', { class: 'assembly-cell', 'data-key': 'centrist' }, board);
  const innerCorners = [-60, 0, 60, 120, 180, 240].map((a) => polar(C.x, C.y, r, a));
  svg('polygon', { points: pts(innerCorners), class: 'assembly-center' }, centerCell);
  // Discs behind, under the CENTRIST name.
  drawDiscs(centerCell, { x: C.x, y: C.y - 2 }, seniority && seniority.centrist);
  let ct = svg('text', { x: C.x, y: C.y - 10, class: 'assembly-center-label', 'text-anchor': 'middle' }, centerCell);
  ct.textContent = 'CENTRIST';
  ct = svg('text', { x: C.x, y: C.y + 7, class: 'assembly-center-sub', 'text-anchor': 'middle' }, centerCell);
  ct.textContent = CENTRIST.law.name;
  drawCubes(centerCell, { x: C.x, y: C.y + 30 }, delegates && delegates.centrist, glowSet.has('centrist'), 'centrist');
  wireCell(centerCell, 'centrist');

  // Active-law star: drawn once, on TOP of every cell (so it never hides behind
  // a neighbouring wedge), at the in-power space. When that space changed since
  // the last render, slide it there from its old spot.
  const starPlace = activeStar || 'centrist';
  const starPos = starPosFor(starPlace);
  const starG = drawStar(board, starPos);
  if (animate && prev && prev.star && prev.star !== starPlace) {
    const from = starPosFor(prev.star);
    const dx = from.x - starPos.x;
    const dy = from.y - starPos.y;
    anims.push(() => starG.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0px, 0px)' }],
      { duration: 900, easing: 'cubic-bezier(0.34,1.1,0.5,1)' },
    ));
  }

  // Callout boxes around the wheel, each arrow -> its space. Compact (sidebar
  // glance) variant only; the large (modal) variant lists the laws in rows
  // below the wheel instead, so the wheel itself can be much bigger.
  if (variant === 'compact') {
    const boxes = {
      freedom:       { x: 344, y: 44,  w: 212, h: 84 },
      honor:         { x: 636, y: 150, w: 210, h: 104 },
      unity:         { x: 636, y: 326, w: 210, h: 118 },
      authority:     { x: 344, y: 474, w: 212, h: 84 },
      equality:      { x: 54,  y: 326, w: 210, h: 118 },
      individuality: { x: 54,  y: 150, w: 210, h: 122 },
    };
    IDEOLOGY_ORDER.forEach((key) => callout(board, boxes[key], ideoForDisplay(key, solo), slots[key]));

    // Centrist / Pad Insurance: a side box (top-right, mirroring Lobby top-left),
    // accented white to match the white center hex. No arrow (it's the center).
    const cFo = svg('foreignObject', { x: 662, y: 8, width: 230, height: 80 }, board);
    const cDiv = document.createElementNS(XHTML, 'div');
    cDiv.setAttribute('class', 'assembly-callout assembly-callout-center');
    cDiv.innerHTML = `
      <div class="assembly-law-head"><span class="assembly-law-ide">${CENTRIST.name}</span><span class="assembly-law-name">${CENTRIST.law.name}</span></div>
      <div class="assembly-law-text">${CENTRIST.law.text}</div>`;
    cFo.appendChild(cDiv);

    const lFo = svg('foreignObject', { x: 8, y: 8, width: 230, height: 86 }, board);
    const lDiv = document.createElementNS(XHTML, 'div');
    lDiv.setAttribute('class', 'assembly-callout assembly-callout-lobby');
    lDiv.innerHTML = `<div class="assembly-law-head"><span class="assembly-law-name">Lobby (free action)</span></div><div class="assembly-law-text">${LOBBY_RULE}</div>`;
    lFo.appendChild(lDiv);
  }

  // Raise any highlighted / selected cell to the FRONT (SVG paints in document
  // order, so a later-drawn neighbouring wedge would otherwise cover the blue
  // glow). Re-appending moves them last = on top.
  board.querySelectorAll('.assembly-cell-hi, .assembly-cell-sel').forEach((el) => board.appendChild(el));
  // Keep the active-law star above any re-fronted cell.
  if (starG) board.appendChild(starG);

  root.appendChild(board);

  // Large variant: list every law in single-column rows beneath the (bigger)
  // wheel, instead of the cramped callouts that ring the compact version. The
  // modal sets deferLaws so it can place this reference BELOW its action buttons
  // (buttons sit right under the wheel; the verbose reference goes last) - it
  // calls renderAssemblyLaws() itself in that case.
  if (variant === 'large' && !deferLaws) {
    root.appendChild(renderAssemblyLaws(solo));
  }

  // Remember this render so the next one can animate the deltas, then fire the
  // queued drop-in / star-slide animations once mounted.
  _assemblyAnim[variant] = { star: starPlace, counts };
  flushAssemblyAnims(anims);

  return root;
}

// The laws reference: every ideology's Law + end-game award in single-column
// rows, then a divider and the non-voting Centrist + Lobby entries. This is the
// 'large'-variant reference list, extracted so the modal can place it BELOW its
// action buttons (next action first, verbose reference last) instead of wedged
// between the wheel and the buttons. renderAssemblyPanel calls this inline unless
// deferLaws is set.
export function renderAssemblyLaws(solo = false) {
  const lawsEl = document.createElement('div');
  lawsEl.className = 'assembly-laws';
  const row = (color, ide, lawName, text, award) => {
    const d = document.createElement('div');
    d.className = 'assembly-law-row';
    d.innerHTML =
      `<span class="assembly-law-swatch" style="background:${color}"></span>`
      + '<div class="assembly-law-body">'
      + `<div class="assembly-law-head"><span class="assembly-law-ide">${ide}</span>`
      + (lawName ? `<span class="assembly-law-name">${lawName}</span>` : '')
      + (award ? `<span class="assembly-law-award">${award}</span>` : '')
      + '</div>'
      + `<div class="assembly-law-text">${text}</div>`
      + '</div>';
    return d;
  };
  IDEOLOGIES.forEach((i) => {
    const law = lawForIdeology(i.key, solo) || i.law;
    lawsEl.appendChild(row(i.color, i.name, law.name, law.text, i.award.text));
  });
  // Centrist + Lobby are NOT ideologies (no vote / award); set them apart.
  const divider = document.createElement('div');
  divider.className = 'assembly-laws-divider';
  divider.textContent = 'Center & free action';
  lawsEl.appendChild(divider);
  lawsEl.appendChild(row('#f3f4fa', CENTRIST.name, CENTRIST.law.name, CENTRIST.law.text, ''));
  lawsEl.appendChild(row('#9aa0c4', 'Lobby', 'Free action', LOBBY_RULE, ''));
  return lawsEl;
}
