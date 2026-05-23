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
  endTurn,
  SLOTS, SEASONS, NEW_ROUND_SLOT, EVENT_SLOTS,
} from './turn-clock.js';

// --------- Confirm end-turn dialog ---------

// Pops a yes/no modal. Resolves true if the player confirmed.
// The dialog ONLY appears when there's unspent budget on the
// current turn (moves remaining > 0 OR ops remaining > 0). If
// everything is spent, the caller should just end the turn
// directly without the prompt — see triggerEndTurn() below.
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
        <button type="button" class="popup-btn primary" data-act="yes">Yes — end turn</button>
        <button type="button" class="popup-btn"         data-act="no">No</button>
      </div>
    `;
    panel.querySelector('[data-act="yes"]').addEventListener('click', () => close(true));
    panel.querySelector('[data-act="no"]').addEventListener('click',  () => close(false));
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
  });
}

// Drives the end-turn user gesture: confirm only when something
// is unspent, otherwise advance immediately. Returns the
// endTurn() result (turn + event) when the turn actually ends,
// or null if the player cancelled.
export async function triggerEndTurn() {
  const needsConfirm = getMovesRemaining() > 0 || getOpsRemaining() > 0;
  if (needsConfirm) {
    const ok = await confirmEndTurn();
    if (!ok) return null;
  }
  const result = endTurn();
  // If the new slot is an event, the dieRoll lives on result.event
  // — let the caller (or the turn-clock modal, see below) animate
  // the 3D die and surface the value.
  return result;
}

// --------- Turn-tracker modal ---------

const WHEEL_VIEW = 320;            // svg viewbox
const WHEEL_CX   = WHEEL_VIEW / 2;
const WHEEL_CY   = WHEEL_VIEW / 2;
const WHEEL_R    = 140;            // outer radius of the slot ring
const WHEEL_RING_W = 56;           // band thickness for the slots

// Position helpers — slot 0 sits at the top (12 o'clock); slots
// advance clockwise. Each slot is one of SLOTS arcs around the
// ring. We render slot boundaries as radial dividers, then label
// the season wedges + event markers + new round marker, then
// pin a "you are here" pointer to the active slot.
function slotAngle(slot, offset = 0) {
  // 0 → -90° (top), advance clockwise.
  const deg = (slot + offset) * (360 / SLOTS) - 90;
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
  const a0 = slotAngle(from - 0.5);
  const a1 = slotAngle(to + 0.5);
  const largeArc = (to - from + 1) > (SLOTS / 2) ? 1 : 0;
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

function wheelSvg() {
  const outerR = WHEEL_R;
  const innerR = WHEEL_R - WHEEL_RING_W;
  const labelR = (outerR + innerR) / 2;
  const turn = getTurn();
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
      fill="${i === turn ? '#0c0a16' : 'rgba(15,16,35,0.6)'}">${i}</text>`;
  }
  // New round marker — small triangle on the inner edge of slot 0.
  const nrp = pointOnRing(NEW_ROUND_SLOT, innerR - 4);
  svg += `<text x="${nrp.x.toFixed(2)}" y="${nrp.y.toFixed(2)}"
    text-anchor="middle" dominant-baseline="middle"
    font-size="18" fill="#fde047">↻</text>`;
  // Event markers — diamond on each event slot's outer edge.
  for (const e of EVENT_SLOTS) {
    const ep = pointOnRing(e, outerR + 8);
    svg += `<text x="${ep.x.toFixed(2)}" y="${ep.y.toFixed(2)}"
      text-anchor="middle" dominant-baseline="middle"
      font-size="11" font-weight="800"
      fill="${lastEvent && lastEvent.turn === e ? '#fbbf24' : 'rgba(203,213,225,0.8)'}">EVENT</text>`;
  }
  // Active-turn pointer — bright pulsing ring on the current slot.
  const tp = pointOnRing(turn, labelR);
  svg += `<circle cx="${tp.x.toFixed(2)}" cy="${tp.y.toFixed(2)}" r="20"
    fill="#fde047" fill-opacity="0.35"
    stroke="#fde047" stroke-width="2" />`;
  svg += '</svg>';
  return svg;
}

// 3D CSS die. Six faces (cube), rotated to land on the requested
// pip count. The CSS `.die-3d.rolling` runs a quick tumble before
// settling on .face-N — see map.css.
function buildDie(value) {
  const wrap = document.createElement('div');
  wrap.className = 'die-3d';
  wrap.dataset.value = String(value || 1);
  wrap.innerHTML = `
    <div class="die-cube">
      <div class="face f1"><span>⚀</span></div>
      <div class="face f2"><span>⚁</span></div>
      <div class="face f3"><span>⚂</span></div>
      <div class="face f4"><span>⚃</span></div>
      <div class="face f5"><span>⚄</span></div>
      <div class="face f6"><span>⚅</span></div>
    </div>
  `;
  return wrap;
}

// Animate a roll: spin the cube for ~700 ms, then settle on
// `value`. Returns a promise that resolves when the animation
// finishes so the caller can update the result line right after.
function rollDie(dieEl, value) {
  return new Promise((resolve) => {
    dieEl.classList.add('rolling');
    dieEl.dataset.value = String(value);
    setTimeout(() => {
      dieEl.classList.remove('rolling');
      resolve();
    }, 700);
  });
}

let _turnModalEl = null;
let _turnModalUnsub = null;

export function openTurnClockModal({ rolling = null } = {}) {
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

  const repaint = (rollContext) => {
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
        Round <strong>${round}</strong> ·
        Turn <strong>${turn}</strong>/<strong>${SLOTS - 1}</strong> ·
        <span class="turn-clock-season" style="color:${season.color}">${season.label}</span>
      </p>
      <div class="turn-clock-wheel-host">
        ${wheelSvg()}
        <div class="turn-clock-die-host"></div>
      </div>
      <div class="turn-clock-event-host"></div>
    `;
    const dieHost = body.querySelector('.turn-clock-die-host');
    const eventHost = body.querySelector('.turn-clock-event-host');
    const dieValue = (lastEvent && lastEvent.dieRoll) || 1;
    const die = buildDie(dieValue);
    dieHost.appendChild(die);
    if (lastEvent) {
      eventHost.innerHTML = `
        <p class="turn-clock-event-line">
          Last event (round <strong>${lastEvent.round}</strong>,
          turn <strong>${lastEvent.turn}</strong>):
          d6 rolled <strong class="big">${lastEvent.dieRoll}</strong>.
        </p>
      `;
    } else {
      eventHost.innerHTML = `
        <p class="turn-clock-event-line muted">
          No event rolled this round yet — events fire on slots
          ${EVENT_SLOTS.join(', ')}.
        </p>
      `;
    }
    panel.appendChild(body);
    // If the modal was opened in response to a fresh end-turn that
    // landed on an event, animate the die roll right away. The
    // caller passes { rolling: dieRoll } so we know to spin.
    if (rollContext && typeof rollContext.value === 'number') {
      rollDie(die, rollContext.value);
    }
  };
  repaint(rolling);
  _turnModalEl = overlay;
  document.body.appendChild(overlay);
  return overlay;
}
