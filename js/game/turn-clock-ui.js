// Turn-clock UI: confirm-end-turn dialog, turn-tracker modal
// (12-slot Sol Sunspot wheel with seasons + event markers), and
// the 3D rolling die that fires on event slots.
//
// State lives in ./turn-clock.js. This module is purely the DOM
// + animation layer; we read state via the exported getters and
// drive it via endTurn() / consumeMove() / consumeOp().

import {
  getTurn, getRound, getSeason, getLastEvent,
  getOpsRemaining, getMovesRemaining,
  endTurn, formatTurnNumber, getFirstPlayerColor,
  SLOTS, SEASONS, NEW_ROUND_SLOT, EVENT_SLOTS,
  getEventForRoll, getSeasonForSlot, EVENT_TABLE,
} from './turn-clock.js';
import { PATENTS_BY_ID } from '../../data/patents.js';
import { renderCard } from './card-ui.js';
import { isBatterySave } from '../prefs.js';

// Small attr/text escapers shared by the event-outcome chips.
function escTc(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Deck glyphs for the Inspiration outcome (which patent deck cycled).
const DECK_GLYPHS = {
  thruster: '🔥', reactor: '☢️', radiator: '♨️',
  refinery: '💧', robonaut: '⛏', generator: '⚡',
};

// Inspiration outcome, rendered VISUAL: per cycled deck, the card that sank
// to the bottom and the card now on top, each an abbreviated, CLICKABLE chip
// (tap to see the full card) instead of a wall of sentences. Driven off
// lastEvent.cycled = [{ deck, out, in }] (card ids). Falls back to the text
// notes when cycled isn't present (older events / solo).
export function inspirationVisualHtml(cycled) {
  const chip = (id, cls, arrow) => {
    const c = PATENTS_BY_ID[id];
    const name = c ? c.name : id;
    return `<button type="button" class="tc-card-chip ${cls}" data-card-id="${escTc(id)}"
      title="${escTc(name)} - tap to view the card">
      <span class="tc-chip-name">${escTc(name)}</span><span class="tc-chip-arrow">${arrow}</span></button>`;
  };
  const rows = cycled.map((c) => `
    <li class="tc-insp-row">
      <span class="tc-insp-deck" title="${escTc(c.deck)} deck">${DECK_GLYPHS[c.deck] || '🃏'}</span>
      ${chip(c.out, 'is-sank', '↓')}
      <span class="tc-insp-to">→</span>
      ${chip(c.in, 'is-top', '↑')}
    </li>`).join('');
  return `<div class="tc-insp">
    <div class="tc-insp-legend"><span>↓ sank to bottom</span><span>↑ new top</span></div>
    <ul class="tc-insp-list">${rows}</ul>
  </div>`;
}

// Lightweight read-only card preview, layered over the turn-clock modal.
// Esc / click-away / Close dismiss only the preview.
function openCardPreview(cardId) {
  const card = PATENTS_BY_ID[cardId];
  if (!card) return;
  document.querySelector('.tc-card-preview-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay tc-card-preview-overlay';
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  };
  document.addEventListener('keydown', onKey, true);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const panel = document.createElement('div');
  panel.className = 'card-modal-panel';
  try {
    const el = renderCard(card, { type: card.type });
    el.classList.add('card-modal-card');
    panel.appendChild(el);
  } catch { panel.textContent = card.name || cardId; }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'modal-btn';
  btn.textContent = 'Close';
  btn.addEventListener('click', close);
  panel.appendChild(btn);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

// --------- Confirm end-turn dialog ---------

// Pops a yes/no modal. Resolves true if the player confirmed.
// The dialog ONLY appears when there's unspent budget on the
// current turn (moves remaining > 0 OR ops remaining > 0). If
// everything is spent, the caller should just end the turn
// directly without the prompt - see triggerEndTurn() below.
export function confirmEndTurn() {
  return new Promise((resolve) => {
    const moves = getMovesRemaining();
    const ops   = getOpsRemaining();
    const overlay = document.createElement('div');
    overlay.className = 'card-modal-overlay turn-confirm-overlay';
    const close = (answer) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(!!answer);
    };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
      else if (e.key === 'Enter') close(true);
    };
    document.addEventListener('keydown', onKey);
    const panel = document.createElement('div');
    panel.className = 'turn-confirm-panel';
    panel.innerHTML = `
      <h3>Are you sure you want to end turn?</h3>
      <ul class="turn-confirm-stats">
        <li><span>Ship moves remaining</span><strong>${moves}</strong></li>
        <li><span>Operations remaining</span><strong>${ops}</strong></li>
      </ul>
      <div class="turn-confirm-actions">
        <button type="button" class="popup-btn primary" data-act="yes">End Turn</button>
        <button type="button" class="popup-btn"         data-act="no">No</button>
      </div>
    `;
    panel.querySelector('[data-act="yes"]').addEventListener('click', () => close(true));
    panel.querySelector('[data-act="no"]').addEventListener('click',  () => close(false));
    overlay.appendChild(panel);
    (document.fullscreenElement || document.body).appendChild(overlay);
  });
}

// Drives the end-turn user gesture: confirm only when something
// is unspent, otherwise advance immediately. Returns the
// endTurn() result (turn + event) when the turn actually ends,
// or null if the player cancelled.
export async function triggerEndTurn(opts = {}) {
  // Confirm only when the player could still act: an operational rocket
  // (passed in by the caller, which knows the stack) plus an unspent move or
  // operation. Defaults to confirming on any leftover budget when the caller
  // doesn't specify (back-compat).
  const hasRocket = opts.hasRocket !== false;
  const needsConfirm = hasRocket && (getMovesRemaining() > 0 || getOpsRemaining() > 0);
  if (needsConfirm) {
    const ok = await confirmEndTurn();
    if (!ok) return null;
  }
  const result = endTurn();
  // If the new slot is an event, the dieRoll lives on result.event
  // - let the caller (or the turn-clock modal, see below) animate
  // the 3D die and surface the value.
  return result;
}

// --------- Turn-tracker modal ---------

const WHEEL_VIEW = 320;            // svg viewbox
const WHEEL_CX   = WHEEL_VIEW / 2;
const WHEEL_CY   = WHEEL_VIEW / 2;
const WHEEL_R    = 140;            // outer radius of the slot ring
const WHEEL_RING_W = 56;           // band thickness for the slots

// Position helpers - slot 0 sits at the top (12 o'clock); slots
// advance clockwise. Each slot is one of SLOTS arcs around the
// ring. We render slot boundaries as radial dividers, then label
// the season wedges + event markers + new round marker, then
// pin a "you are here" pointer to the active slot.
function slotAngle(slot, offset = 0) {
  // 0 → top, advancing clockwise. The half-slot (+15° at 12 slots) rotation
  // lands the slot-0 event boundary (slotAngle(-0.5)) straight up, so the
  // first event line reads vertical instead of tilted ~15° to the left. The
  // whole dial - numbers, season wedges, all six event lines, the pointer -
  // flows through here, so they rotate together.
  const HALF_SLOT = (360 / SLOTS) / 2;
  const deg = (slot + offset) * (360 / SLOTS) - 90 + HALF_SLOT;
  return (deg * Math.PI) / 180;
}
function pointOnRing(slot, radius, offset = 0) {
  const a = slotAngle(slot, offset);
  return { x: WHEEL_CX + Math.cos(a) * radius, y: WHEEL_CY + Math.sin(a) * radius };
}

// Build an SVG arc <path d="..."> string from slot `from` (inclusive)
// to slot `to` (inclusive), at the given inner + outer radii.
function seasonArc(from, to, innerR, outerR) {
  // Add 0.5 to span the slot's full wedge (centered on the slot index).
  // The wedge is drawn clockwise from `from` to `to`; the angle math
  // wraps naturally, so a season that crosses slot 0 (from > to, e.g.
  // Blue = 10..1) renders as the top wedge. `span` is the wedge width
  // in slots, computed modulo SLOTS so the large-arc flag is correct
  // for wrapping wedges too.
  const a0 = slotAngle(from - 0.5);
  const a1 = slotAngle(to + 0.5);
  const span = ((to - from + SLOTS) % SLOTS) + 1;
  const largeArc = span > (SLOTS / 2) ? 1 : 0;
  const outerStart = { x: WHEEL_CX + Math.cos(a0) * outerR, y: WHEEL_CY + Math.sin(a0) * outerR };
  const outerEnd   = { x: WHEEL_CX + Math.cos(a1) * outerR, y: WHEEL_CY + Math.sin(a1) * outerR };
  const innerStart = { x: WHEEL_CX + Math.cos(a1) * innerR, y: WHEEL_CY + Math.sin(a1) * innerR };
  const innerEnd   = { x: WHEEL_CX + Math.cos(a0) * innerR, y: WHEEL_CY + Math.sin(a0) * innerR };
  return [
    `M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)}`,
    `L ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
    'Z',
  ].join(' ');
}

// `displayTurn` lets us render the pointer at an arbitrary slot
// (used by the end-turn animation: we paint the wheel with the
// pointer still at the OLD slot, then a JS tween moves it to the
// new slot). Without it, the pointer would flash at the new slot
// for one frame before snapping back to animate.
function wheelSvg(displayTurn = null) {
  const outerR = WHEEL_R;
  const innerR = WHEEL_R - WHEEL_RING_W;
  const labelR = (outerR + innerR) / 2;
  const turn = getTurn();
  const pointerSlot = displayTurn !== null ? displayTurn : turn;
  const lastEvent = getLastEvent();

  let svg = `<svg class="turn-wheel" viewBox="0 0 ${WHEEL_VIEW} ${WHEEL_VIEW}">`;
  // Season wedges.
  for (const season of SEASONS) {
    svg += `<path d="${seasonArc(season.from, season.to, innerR, outerR)}"
      fill="${season.color}" fill-opacity="0.22"
      stroke="${season.color}" stroke-opacity="0.75" stroke-width="1.4" />`;
  }
  // Slot dividers + numbers.
  for (let i = 0; i < SLOTS; i++) {
    const a = slotAngle(i - 0.5);
    const x1 = WHEEL_CX + Math.cos(a) * innerR;
    const y1 = WHEEL_CY + Math.sin(a) * innerR;
    const x2 = WHEEL_CX + Math.cos(a) * outerR;
    const y2 = WHEEL_CY + Math.sin(a) * outerR;
    svg += `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"
      stroke="rgba(15,16,35,0.45)" stroke-width="1" />`;
    const lp = pointOnRing(i, labelR);
    svg += `<text x="${lp.x.toFixed(2)}" y="${lp.y.toFixed(2)}"
      text-anchor="middle" dominant-baseline="middle"
      font-size="14" font-weight="700"
      fill="${i === turn ? '#0c0a16' : 'rgba(15,16,35,0.6)'}">${i + 1}</text>`;
  }
  // Event marker lines - bold WHITE radial line on the leading
  // boundary of each event slot. This is the line the Sunspot
  // Cube crosses to ENTER the event, so the player visually reads
  // "crossing this fires a d6". Drawn after season wedges + slot
  // dividers so it sits on top, before the pointer so the pointer
  // overlays it when the cube is parked on the event.
  for (const e of EVENT_SLOTS) {
    const a = slotAngle(e - 0.5);
    const x1 = WHEEL_CX + Math.cos(a) * (innerR - 2);
    const y1 = WHEEL_CY + Math.sin(a) * (innerR - 2);
    const x2 = WHEEL_CX + Math.cos(a) * (outerR + 2);
    const y2 = WHEEL_CY + Math.sin(a) * (outerR + 2);
    svg += `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"
      stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-opacity="0.95" />`;
  }
  // New round marker - small triangle on the inner edge of slot 0.
  const nrp = pointOnRing(NEW_ROUND_SLOT, innerR - 4);
  svg += `<text x="${nrp.x.toFixed(2)}" y="${nrp.y.toFixed(2)}"
    text-anchor="middle" dominant-baseline="middle"
    font-size="18" fill="#fde047">↻</text>`;
  // Event slot labels - small "EVENT" tag outside the ring.
  for (const e of EVENT_SLOTS) {
    const ep = pointOnRing(e, outerR + 14);
    svg += `<text x="${ep.x.toFixed(2)}" y="${ep.y.toFixed(2)}"
      text-anchor="middle" dominant-baseline="middle"
      font-size="9" font-weight="800"
      fill="${lastEvent && lastEvent.turn === e ? '#fbbf24' : 'rgba(203,213,225,0.8)'}">EVENT</text>`;
  }
  // Active-turn pointer - bright pulsing ring on the current slot.
  // `.turn-pointer` is the hook the end-turn animation tweens via
  // cx/cy in openTurnClockModal.
  const tp = pointOnRing(pointerSlot, labelR);
  svg += `<circle class="turn-pointer" cx="${tp.x.toFixed(2)}" cy="${tp.y.toFixed(2)}" r="20"
    fill="#fde047" fill-opacity="0.35"
    stroke="#fde047" stroke-width="2" />`;
  // The Sunspot Cube: the FIRST PLAYER's coloured cube parked on the cycle (it
  // is one of their 7 cubes). Drawn on top of the pointer ring, and tweened
  // ALONGSIDE the ring (tweenPointer moves both) so it slides, not teleports.
  const fpc = getFirstPlayerColor();
  if (fpc) svg += sunspotCubeSvg(tp.x, tp.y, 11, fpc);
  svg += '</svg>';
  return svg;
}

// An isometric 3D cube as an SVG string. Drawn at the origin and positioned via
// a translate transform so the tween can slide it; top face in the seat colour,
// left/right faces darkened for the bevel, black outline for visibility.
function sunspotCubeSvg(cx, cy, s, color) {
  const top = `0,${-s} ${s},${-s / 2} 0,0 ${-s},${-s / 2}`;
  const left = `${-s},${-s / 2} 0,0 0,${s} ${-s},${s / 2}`;
  const right = `${s},${-s / 2} 0,0 0,${s} ${s},${s / 2}`;
  return `<g class="sunspot-cube" transform="translate(${cx.toFixed(2)},${cy.toFixed(2)})">`
    + `<polygon points="${top}" fill="${color}" stroke="#000" stroke-width="1"/>`
    + `<polygon points="${left}" fill="${color}" stroke="#000" stroke-width="1"/>`
    + `<polygon points="${left}" fill="#000" fill-opacity="0.22"/>`
    + `<polygon points="${right}" fill="${color}" stroke="#000" stroke-width="1"/>`
    + `<polygon points="${right}" fill="#000" fill-opacity="0.42"/>`
    + '</g>';
}

// Tween the active-turn pointer from `fromSlot` to `toSlot` along
// the wheel's circular path. Goes the SHORT way around (forward,
// matching the direction the cube advances). Used by the end-turn
// modal so the player sees the Sunspot Cube physically slide into
// the new slot rather than teleporting.
function tweenPointer(pointer, fromSlot, toSlot, durationMs = 650) {
  return new Promise((resolve) => {
    const labelR = WHEEL_R - WHEEL_RING_W / 2;
    // The Sunspot Cube slides with the pointer ring (same slot path).
    const cube = pointer.ownerSVGElement && pointer.ownerSVGElement.querySelector('.sunspot-cube');
    // Forward distance in slots - endTurn always advances by 1, but
    // we generalise so multi-step tweens (e.g. event replays) work.
    let forward = ((toSlot - fromSlot) % SLOTS + SLOTS) % SLOTS;
    if (forward === 0) forward = SLOTS;
    const startTime = performance.now();
    function frame(now) {
      const t = Math.min(1, (now - startTime) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);  // ease-out cubic
      const interp = (fromSlot + forward * eased) % SLOTS;
      const pos = pointOnRing(interp, labelR);
      pointer.setAttribute('cx', pos.x.toFixed(2));
      pointer.setAttribute('cy', pos.y.toFixed(2));
      if (cube) cube.setAttribute('transform', `translate(${pos.x.toFixed(2)},${pos.y.toFixed(2)})`);
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });
}

// 3D CSS die. Six faces (cube), rotated to land on the requested
// pip count. Each face is a 3x3 grid; pips are circular divs
// placed on canonical d6 positions (1=centre, 2=opposite corners,
// 3=diagonal, 4=corners, 5=corners+centre, 6=two columns of 3).
// The CSS .die-3d.rolling tumbles for ~700ms then settles via
// .die-3d[data-value]. Tapping the die pops the event legend.
// Pip indices use a 3x3 grid:
//   1 2 3
//   4 5 6
//   7 8 9
const FACE_PIPS = {
  1: [5],
  2: [3, 7],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};
function pipHtmlFor(value) {
  return FACE_PIPS[value].map((p) => `<span class="pip pip-${p}"></span>`).join('');
}
export function buildDie(value) {
  const wrap = document.createElement('div');
  wrap.className = 'die-3d';
  wrap.dataset.value = String(value || 1);
  wrap.setAttribute('role', 'button');
  wrap.setAttribute('tabindex', '0');
  wrap.title = 'Tap to see what each pip does';
  wrap.innerHTML = `
    <div class="die-cube">
      <div class="face f1">${pipHtmlFor(1)}</div>
      <div class="face f2">${pipHtmlFor(2)}</div>
      <div class="face f3">${pipHtmlFor(3)}</div>
      <div class="face f4">${pipHtmlFor(4)}</div>
      <div class="face f5">${pipHtmlFor(5)}</div>
      <div class="face f6">${pipHtmlFor(6)}</div>
    </div>
  `;
  const open = () => openEventLegend();
  wrap.addEventListener('click', open);
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });
  return wrap;
}

// d6 legend popup. One row per face (1-6) showing the icon +
// name + verbatim rulebook text for that outcome. Faces 5-6
// fan out into three season variants (Anarchy / Budget Cuts /
// Solar Flare) since the effect depends on which season the
// cube is in when the d6 is rolled.
const DIE_GLYPHS = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
export function openEventLegend() {
  document.querySelector('.event-legend-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay event-legend-overlay';
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  const panel = document.createElement('div');
  panel.className = 'event-legend-panel';
  // Build one row per UNIQUE pip group. Faces that share an event
  // collapse into a single row labelled with both glyphs (1-2
  // Inspiration, 5-6 season-dependent). The d6 only has six
  // outcomes really, but three of them straddle pairs of faces.
  const groups = [
    { faces: [1, 2], rolls: [1] },     // Inspiration covers 1 + 2
    { faces: [3],    rolls: [3] },     // Glitch
    { faces: [4],    rolls: [4] },     // Pad Explosion
    { faces: [5, 6], rolls: [5] },     // Anarchy / Budget Cuts / Solar Flare
  ];
  const all = Object.values(EVENT_TABLE);
  const rowHtml = (group) => {
    const evs = all.filter((e) => group.rolls.some((r) => e.rolls.includes(r)));
    if (!evs.length) return '';
    const pipsHtml = group.faces.map((f) => DIE_GLYPHS[f - 1]).join('');
    const facesLabel = group.faces.join('-');
    const isMulti = evs.length > 1;
    const body = isMulti
      ? `<ul class="ev-legend-seasons">${evs.map((e) => `
          <li>
            <span class="ev-legend-season ev-season-${e.season}">Season ${e.season}</span>
            <strong>${e.icon} ${e.name}</strong>
            <p>${e.text}</p>
          </li>`).join('')}</ul>`
      : `<p><strong>${evs[0].icon} ${evs[0].name}</strong><br>${evs[0].text}</p>`;
    return `
      <li class="ev-legend-row" data-faces="${facesLabel}">
        <div class="ev-legend-pip">
          <span class="ev-legend-glyphs">${pipsHtml}</span>
          <em>${facesLabel}</em>
        </div>
        <div class="ev-legend-body">${body}</div>
      </li>
    `;
  };
  panel.innerHTML = `
    <button type="button" class="modal-x" aria-label="Close (Esc)" title="Close (Esc)">×</button>
    <h2 class="event-legend-title">🎲 Sunspot Cube d6 Events</h2>
    <p class="muted event-legend-sub">
      The d6 fires every time the cube crosses an event threshold
      (slots ${EVENT_SLOTS.join(', ')}). Faces 5-6 vary by season.
    </p>
    <ol class="event-legend-list">
      ${groups.map(rowHtml).join('')}
    </ol>
  `;
  panel.querySelector('.modal-x').addEventListener('click', close);
  overlay.appendChild(panel);
  (document.fullscreenElement || document.body).appendChild(overlay);
  return overlay;
}

// Animate a roll: spin the cube for ~700 ms, then settle on
// `value`. Returns a promise that resolves when the animation
// finishes so the caller can update the result line right after.
export function rollDie(dieEl, value) {
  return new Promise((resolve) => {
    dieEl.dataset.value = String(value);
    // Battery saver: show the result immediately, no tumble.
    if (isBatterySave()) { resolve(); return; }
    dieEl.classList.add('rolling');
    setTimeout(() => {
      dieEl.classList.remove('rolling');
      resolve();
    }, 700);
  });
}

let _turnModalEl = null;
let _turnModalUnsub = null;

export function openTurnClockModal({ rolling = null, animateFrom = null } = {}) {
  // Close any existing instance first (don't stack modals).
  document.querySelector('.turn-clock-overlay')?.remove();
  if (_turnModalUnsub) { _turnModalUnsub(); _turnModalUnsub = null; }

  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay turn-clock-overlay';
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (_turnModalUnsub) { _turnModalUnsub(); _turnModalUnsub = null; }
    _turnModalEl = null;
  };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  const panel = document.createElement('div');
  panel.className = 'turn-clock-panel';
  overlay.appendChild(panel);

  const xBtn = document.createElement('button');
  xBtn.type = 'button';
  xBtn.className = 'modal-x';
  xBtn.textContent = '×';
  xBtn.title = 'Close (Esc)';
  xBtn.addEventListener('click', close);
  panel.appendChild(xBtn);

  const repaint = (rollContext, startSlot) => {
    const season = getSeason();
    const turn = getTurn();
    const round = getRound();
    const lastEvent = getLastEvent();
    panel.querySelector('.turn-clock-body')?.remove();
    const body = document.createElement('div');
    body.className = 'turn-clock-body';
    body.innerHTML = `
      <h2 class="turn-clock-title">🕐 Sol Sunspot Cycle</h2>
      <p class="turn-clock-sub">
        Turn <strong>${formatTurnNumber(round, turn)}</strong>
        <span class="muted">(round.slot/rounds)</span> ·
        <span class="turn-clock-season" style="color:${season.color}">${season.label}</span>
      </p>
      <div class="turn-clock-wheel-host">
        ${wheelSvg(startSlot)}
        <div class="turn-clock-die-host"></div>
      </div>
      <div class="turn-clock-event-host"></div>
    `;
    const dieHost = body.querySelector('.turn-clock-die-host');
    const eventHost = body.querySelector('.turn-clock-event-host');
    const dieValue = (lastEvent && lastEvent.dieRoll) || 1;
    const die = buildDie(dieValue);
    dieHost.appendChild(die);
    // The Solar Flare's second (strength) die, if any. Built static here; it
    // only animates AFTER the event die settles (see the rollContext block).
    let flareDieEl = null;
    let flareDieVal = null;
    if (lastEvent) {
      const eventSeason = getSeasonForSlot(lastEvent.turn);
      const ev = getEventForRoll(lastEvent.dieRoll, eventSeason && eventSeason.name);
      // Resolved outcomes (what the event actually DID) ride along on the
      // event record as plain gameplay sentences; render them in place of
      // the old "resolve at the table" note when present.
      const escNote = (t) => String(t)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      // Inspiration cycles every deck; show it VISUAL (clickable card chips)
      // off the structured cycled list. Other events keep their text notes.
      const inspVisual = (ev && ev.name === 'Inspiration'
        && Array.isArray(lastEvent.cycled) && lastEvent.cycled.length)
        ? inspirationVisualHtml(lastEvent.cycled)
        : '';
      const notesHtml = inspVisual
        || (Array.isArray(lastEvent.notes) && lastEvent.notes.length
          ? `<ul class="ev-notes">${lastEvent.notes.map((n) => `<li>${escNote(n)}</li>`).join('')}</ul>`
          : '');
      const evBlock = ev
        ? `<div class="turn-clock-event-card" data-season="${ev.season || 'any'}">
             <header>
               <span class="ev-icon">${ev.icon}</span>
               <strong>${ev.name}</strong>
               ${ev.season ? `<em class="ev-season ev-season-${ev.season}">Season ${ev.season}</em>` : ''}
             </header>
             <p class="ev-text">${ev.text}</p>
             ${notesHtml || `<p class="ev-sandbox-note">
               <span class="ev-sandbox-badge">Sandbox preview</span>
               Not applied automatically - resolve at the table if
               you're using the cube as a play-along clock.
             </p>`}
           </div>`
        : '';
      // Solar Flare carries a SECOND roll (the flare-strength d6) separate from
      // the event-roll die. Surface it as its own rolling die + face value so a
      // player sees how hard the flare hit, not just that one happened.
      const isFlare = !!(ev && ev.name === 'Solar Flare');
      const flareRoll = (isFlare && typeof lastEvent.flareRoll === 'number')
        ? lastEvent.flareRoll : null;
      const flareLineHtml = flareRoll
        ? `<p class="turn-clock-flare-line">
             ☀️ Flare strength:
             <span class="flare-die-host"></span>
             <strong class="big">${flareRoll}</strong>
           </p>`
        : '';
      eventHost.innerHTML = `
        <p class="turn-clock-event-line">
          Last event (round <strong>${lastEvent.round}</strong>,
          turn <strong>${lastEvent.turn}</strong>):
          d6 rolled <strong class="big">${lastEvent.dieRoll}</strong>.
        </p>
        ${flareLineHtml}
        ${evBlock}
      `;
      // Mount the flare-strength die (shows the result statically). It rolls
      // only after the event die finishes its tumble - wired below where the
      // event die's own roll is scheduled.
      if (flareRoll) {
        const flareHost = eventHost.querySelector('.flare-die-host');
        if (flareHost) {
          flareDieEl = buildDie(flareRoll);
          flareDieVal = flareRoll;
          flareHost.appendChild(flareDieEl);
        }
      }
      // Card chips in the Inspiration outcome open a read-only preview.
      eventHost.querySelectorAll('.tc-card-chip[data-card-id]').forEach((b) => {
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          openCardPreview(b.getAttribute('data-card-id'));
        });
      });
    } else {
      eventHost.innerHTML = `
        <p class="turn-clock-event-line muted">
          No event rolled this round yet - events fire on slots
          ${EVENT_SLOTS.join(', ')}.
        </p>
      `;
    }
    panel.appendChild(body);
    // If we were given a starting slot, the pointer is currently
    // painted at THAT slot - tween it to the live turn so the
    // player sees the Sunspot Cube slide into its new home.
    if (startSlot !== null && startSlot !== undefined && startSlot !== turn) {
      const pointer = body.querySelector('.turn-pointer');
      if (pointer) tweenPointer(pointer, startSlot, turn);
    }
    // If the modal was opened in response to a fresh end-turn that
    // landed on an event, animate the die roll right away. The
    // caller passes { rolling: dieRoll } so we know to spin.
    if (rollContext && typeof rollContext.value === 'number') {
      // Slight delay so the pointer animation kicks off first and
      // the cube-arriving-on-event reads as the cause of the roll.
      const delay = startSlot !== null ? 400 : 0;
      setTimeout(() => {
        rollDie(die, rollContext.value).then(() => {
          // The flare-strength die tumbles only once the event die has settled.
          if (flareDieEl) rollDie(flareDieEl, flareDieVal);
        });
      }, delay);
    }
  };
  repaint(rolling, animateFrom);
  _turnModalEl = overlay;
  (document.fullscreenElement || document.body).appendChild(overlay);
  return overlay;
}
