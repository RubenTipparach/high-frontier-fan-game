// Sol Political Assembly (Module 0) panel - our own functional UI for the
// assembly: a hex wheel of the six ideologies around a Centrist center, with
// each ideology's Law + end-game VP award in a callout box pointing at its
// delegate space by a little arrow. Delegates render as fake-3D (isometric)
// cubes in the spaces.
//
// MOCKUP for review (M0 is not wired into play yet). Renders from
// data/assembly.js; takes an optional `delegates` map
// { ideologyKey|'centrist': [seatColor, ...] } to show placed cubes.

import { IDEOLOGIES, CENTRIST, LOBBY_RULE, IDEOLOGY_ORDER, IDEOLOGY_BY_KEY } from '../../data/assembly.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const XHTML = 'http://www.w3.org/1999/xhtml';
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

export function renderAssemblyPanel({ delegates = null } = {}) {
  const root = document.createElement('div');
  root.className = 'assembly-panel';
  root.innerHTML = `
    <div class="assembly-head"><h2>Sol Political Assembly</h2><span class="assembly-sub">Module 0</span></div>`;

  const VB = { w: 980, h: 660 };
  const C = { x: 490, y: 318 };
  const R = 150, r = 62;
  const board = svg('svg', { viewBox: `0 0 ${VB.w} ${VB.h}`, class: 'assembly-board', role: 'img', 'aria-label': 'Sol Political Assembly' });

  // Arrowhead marker.
  const defs = svg('defs', {}, board);
  const marker = svg('marker', { id: 'assembly-arrowhead', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
  svg('path', { d: 'M0,0 L10,5 L0,10 z', class: 'assembly-arrowhead' }, marker);

  const centers = { freedom: -90, honor: -30, unity: 30, authority: 90, equality: 150, individuality: 210 };
  const slots = {};
  // Wedges + labels + slots.
  IDEOLOGY_ORDER.forEach((key) => {
    const ide = IDEOLOGY_BY_KEY[key];
    const cA = centers[key];
    const pIL = polar(C.x, C.y, r, cA - 30);
    const pOL = polar(C.x, C.y, R, cA - 30);
    const pOR = polar(C.x, C.y, R, cA + 30);
    const pIR = polar(C.x, C.y, r, cA + 30);
    svg('polygon', { points: pts([pIL, pOL, pOR, pIR]), fill: ide.color, class: 'assembly-wedge' }, board);
    const lab = polar(C.x, C.y, (r + R) / 2 - 16, cA);
    const t = svg('text', { x: lab.x, y: lab.y, class: 'assembly-wedge-label', 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, board);
    t.textContent = ide.name.toUpperCase();
    const slot = polar(C.x, C.y, R - 30, cA);
    slots[key] = slot;
  });

  // Center hex (Centrist).
  const innerCorners = [-60, 0, 60, 120, 180, 240].map((a) => polar(C.x, C.y, r, a));
  svg('polygon', { points: pts(innerCorners), class: 'assembly-center' }, board);
  let ct = svg('text', { x: C.x, y: C.y - 10, class: 'assembly-center-label', 'text-anchor': 'middle' }, board);
  ct.textContent = 'CENTRIST';
  ct = svg('text', { x: C.x, y: C.y + 7, class: 'assembly-center-sub', 'text-anchor': 'middle' }, board);
  ct.textContent = CENTRIST.law.name;

  // Delegate spaces: a faint iso-cube outline, filled iso-cubes for placed ones.
  const drawSpace = (pt, list) => {
    svg('circle', { cx: pt.x, cy: pt.y, r: 16, class: 'assembly-slot' }, board);
    const cubes = Array.isArray(list) ? list : [];
    if (!cubes.length) { isoCube(board, pt.x, pt.y + 2, 7, '#ffffff', true); return; }
    cubes.slice(0, 4).forEach((col, i) => {
      const ox = pt.x - 8 + (i % 2) * 14;
      const oy = pt.y - 3 + Math.floor(i / 2) * 11 + 2;
      isoCube(board, ox, oy, 6, col, false);
    });
  };
  IDEOLOGY_ORDER.forEach((key) => drawSpace(slots[key], delegates && delegates[key]));
  const centerSlot = { x: C.x, y: C.y + 26 };
  drawSpace(centerSlot, delegates && delegates.centrist);

  // Callout boxes around the wheel, each arrow -> its space.
  const boxes = {
    freedom:       { x: 384, y: 10,  w: 212, h: 92 },
    honor:         { x: 752, y: 110, w: 220, h: 110 },
    unity:         { x: 752, y: 322, w: 220, h: 122 },
    authority:     { x: 384, y: 566, w: 212, h: 92 },
    equality:      { x: 8,   y: 322, w: 220, h: 122 },
    individuality: { x: 8,   y: 110, w: 220, h: 120 },
  };
  IDEOLOGY_ORDER.forEach((key) => callout(board, boxes[key], IDEOLOGY_BY_KEY[key], slots[key]));

  // Centrist / Pad Insurance: a side box (top-right, mirroring Lobby top-left),
  // accented white to match the white center hex, with an arrow into the center.
  const cBox = { x: 740, y: 8, w: 232, h: 82 };
  const cTarget = polar(C.x, C.y, r, -32);   // top-right edge of the center hex
  const cStart = edgePoint(cBox, cTarget);
  const cdx = cTarget.x - cStart.x, cdy = cTarget.y - cStart.y;
  const cLen = Math.hypot(cdx, cdy) || 1;
  svg('line', {
    x1: cStart.x, y1: cStart.y,
    x2: cTarget.x - (cdx / cLen) * 16, y2: cTarget.y - (cdy / cLen) * 16,
    class: 'assembly-arrow', 'marker-end': 'url(#assembly-arrowhead)',
  }, board);
  const cFo = svg('foreignObject', { x: cBox.x, y: cBox.y, width: cBox.w, height: cBox.h }, board);
  const cDiv = document.createElementNS(XHTML, 'div');
  cDiv.setAttribute('class', 'assembly-callout assembly-callout-center');
  cDiv.innerHTML = `
    <div class="assembly-law-head"><span class="assembly-law-ide">${CENTRIST.name}</span><span class="assembly-law-name">${CENTRIST.law.name}</span></div>
    <div class="assembly-law-text">${CENTRIST.law.text}</div>`;
  cFo.appendChild(cDiv);

  const lFo = svg('foreignObject', { x: 8, y: 8, width: 240, height: 96 }, board);
  const lDiv = document.createElementNS(XHTML, 'div');
  lDiv.setAttribute('class', 'assembly-callout assembly-callout-lobby');
  lDiv.innerHTML = `<div class="assembly-law-head"><span class="assembly-law-name">Lobby (free action)</span></div><div class="assembly-law-text">${LOBBY_RULE}</div>`;
  lFo.appendChild(lDiv);

  root.appendChild(board);
  return root;
}
