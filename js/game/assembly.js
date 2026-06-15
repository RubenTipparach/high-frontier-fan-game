// Sol Political Assembly (Module 0) panel - our own functional UI for the
// assembly: a hex wheel of the six ideologies around a Centrist center, plus a
// card per ideology spelling out its Law + end-game VP award, the Centrist
// pad-insurance center, and the Lobby free action.
//
// This is a MOCKUP component for review (M0 is not wired into play yet). It
// renders from data/assembly.js and takes an optional `delegates` map
// { ideologyKey|'centrist': { seatColor: count } } to show placed delegates;
// with none it shows empty delegate slots.

import { IDEOLOGIES, CENTRIST, LOBBY_RULE, IDEOLOGY_ORDER, IDEOLOGY_BY_KEY } from '../../data/assembly.js';

const SVGNS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs) {
  const el = document.createElementNS(SVGNS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}
function polar(cx, cy, r, deg) {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
function pts(arr) { return arr.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '); }

// The hex wheel: 6 colored wedges (trapezoids between an inner + outer hexagon)
// around a Centrist center hex, each with the ideology name + a delegate slot.
function buildWheel(delegates) {
  const W = 360, C = W / 2, R = 168, r = 70;
  const root = svg('svg', { viewBox: `0 0 ${W} ${W}`, class: 'assembly-wheel', role: 'img', 'aria-label': 'Sol Political Assembly' });
  // Center angles clockwise from the top (y-down screen coords): -90 = top.
  const centers = { freedom: -90, honor: -30, unity: 30, authority: 90, equality: 150, individuality: 210 };

  IDEOLOGY_ORDER.forEach((key) => {
    const ide = IDEOLOGY_BY_KEY[key];
    const cAng = centers[key];
    const pIL = polar(C, C, r, cAng - 30);
    const pOL = polar(C, C, R, cAng - 30);
    const pOR = polar(C, C, R, cAng + 30);
    const pIR = polar(C, C, r, cAng + 30);
    const wedge = svg('polygon', { points: pts([pIL, pOL, pOR, pIR]), fill: ide.color, class: 'assembly-wedge', 'data-key': key });
    root.appendChild(wedge);

    // Ideology name, upright, at mid-radius.
    const [lx, ly] = polar(C, C, (r + R) / 2 - 14, cAng);
    const label = svg('text', { x: lx, y: ly, class: 'assembly-wedge-label', 'text-anchor': 'middle', 'dominant-baseline': 'middle' });
    label.textContent = ide.name.toUpperCase();
    root.appendChild(label);

    // Delegate slot (the mat's per-ideology circle). Filled pips if delegates.
    const [dx, dy] = polar(C, C, R - 30, cAng);
    root.appendChild(svg('circle', { cx: dx, cy: dy, r: 15, class: 'assembly-slot' }));
    const placed = delegates && delegates[key] ? delegates[key] : null;
    if (placed) {
      const colors = Object.keys(placed);
      let i = 0;
      for (const col of colors) {
        for (let k = 0; k < placed[col]; k += 1) {
          const ox = dx - 8 + (i % 3) * 8;
          const oy = dy - 6 + Math.floor(i / 3) * 8;
          root.appendChild(svg('rect', { x: ox, y: oy, width: 6, height: 6, rx: 1, fill: col, class: 'assembly-delegate' }));
          i += 1;
        }
      }
    }
  });

  // Center hex (Centrist).
  const innerCorners = [-60, 0, 60, 120, 180, 240].map((a) => polar(C, C, r, a));
  root.appendChild(svg('polygon', { points: pts(innerCorners), class: 'assembly-center' }));
  const ct = svg('text', { x: C, y: C - 8, class: 'assembly-center-label', 'text-anchor': 'middle' });
  ct.textContent = 'CENTRIST';
  root.appendChild(ct);
  const cs = svg('text', { x: C, y: C + 10, class: 'assembly-center-sub', 'text-anchor': 'middle' });
  cs.textContent = 'Pad Insurance';
  root.appendChild(cs);
  const [cdx, cdy] = [C, C + 26];
  root.appendChild(svg('circle', { cx: cdx, cy: cdy, r: 11, class: 'assembly-slot' }));
  return root;
}

// One ideology's law/award card.
function buildLawCard(ide) {
  const card = document.createElement('div');
  card.className = 'assembly-law';
  card.style.setProperty('--ide-color', ide.color);
  card.innerHTML = `
    <div class="assembly-law-head">
      <span class="assembly-law-ide">${ide.name}</span>
      <span class="assembly-law-name">${ide.law.name}</span>
    </div>
    <div class="assembly-law-text">${ide.law.text}</div>
    <div class="assembly-law-award">${ide.award.text}</div>
  `;
  return card;
}

// Build the full assembly panel content into a host element (or a new div).
export function renderAssemblyPanel({ delegates = null } = {}) {
  const root = document.createElement('div');
  root.className = 'assembly-panel';
  root.innerHTML = `
    <div class="assembly-head">
      <h2>Sol Political Assembly</h2>
      <span class="assembly-sub">Module 0</span>
    </div>
    <p class="assembly-lobby"><strong>Lobby (free action):</strong> ${LOBBY_RULE}</p>
  `;
  root.appendChild(buildWheel(delegates));

  const center = document.createElement('div');
  center.className = 'assembly-law assembly-law-center';
  center.innerHTML = `
    <div class="assembly-law-head">
      <span class="assembly-law-ide">${CENTRIST.name}</span>
      <span class="assembly-law-name">${CENTRIST.law.name}</span>
    </div>
    <div class="assembly-law-text">${CENTRIST.law.text}</div>
  `;
  root.appendChild(center);

  const grid = document.createElement('div');
  grid.className = 'assembly-laws';
  for (const key of IDEOLOGY_ORDER) grid.appendChild(buildLawCard(IDEOLOGY_BY_KEY[key]));
  root.appendChild(grid);
  return root;
}
