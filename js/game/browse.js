// Browse view: map + patent deck + milestones + events.
//
// Read-only, no engine dependency. Lets a user inspect Stage 2 data
// without needing to start a multiplayer game. Reachable from the
// topbar; also acts as the "preview" surface that Stage 3 will
// replace with the live game.

import { MapRenderer, LEO_ANCHOR } from './render.js';
import { loadPlannerMap } from './planner-map.js';
import { findPath } from './nav.js';
import { consumeMove, getTurn } from './turn-clock.js';
import { triggerEndTurn, openTurnClockModal } from './turn-clock-ui.js';
import {
  getState as soloState, newGame as soloNewGame, abandonGame as soloAbandon,
  setTarget as soloSetTarget, commitMove as soloCommitMove,
  prospect as soloProspect, endRound as soloEndRound,
  bindData as soloBindData, onChange as soloOnChange, SOLO_CONFIG,
} from './solo.js';
import { PATENTS, PATENTS_BY_ID, PATENT_TYPES, patentsByType } from '../../data/patents.js';
import {
  getHandSlots, isInHand, addToHand, removeFromHandAt, removeFromHand,
  clearHand, onHandChange,
  isBoostMarked, getBoostMarked, toggleBoostMark, clearBoostMarks,
} from './hand.js';
import {
  getRocketStack, isInRocket, addToStack as rocketAddCard,
  removeFromStack as rocketRemoveCard, clearStack as rocketClearStack,
  onRocketChange, isRocketActive,
  getActiveThrusterId, setActiveThruster,
  getTankWater, addFuel, removeFuel, getTankMax,
  getStackTotals, getActiveThrusterStats,
} from './rocket.js';
import { CREW } from '../../data/crew.js';
import { MILESTONES } from '../../data/glory.js';
import { POLITICS } from '../../data/politics.js';
import { SITES_BY_ID } from '../../data/sites.js';
import { renderCard } from './card-ui.js';

// Only one map mode now (planner / "classic"); the old
// "Cleaned up" variant was disorienting next to the canonical
// planner graph and has been removed. Kept as a single function
// rather than a config object so future modes are easy to slot.
async function loadMap() {
  return loadPlannerMap();
}

let _renderer = null;
let _sidebarWired = false;

// Subscribe once: rocket state changes (cards added / removed)
// trigger a re-render of the sandbox rocket on the map.
let _rocketSubWired = false;

export function mountBrowse() {
  const view = document.getElementById('view-browse');
  if (!view) return;
  if (!_rocketSubWired) {
    _rocketSubWired = true;
    onRocketChange(syncSandboxRocket);
  }
  wireSidebar();
  wireHandStrip();
  renderMap();
}

// Sandbox hand strip wiring: drop target, slot rendering, +
// the grabber bar that lets the user drag the strip up to see
// more cards. Card-click opens the inspect modal instead of
// removing the slot directly — Discard lives in the modal.
// Touch-device check used to toggle UI between the desktop
// hover-driven flow and the mobile tap-to-select flow. Reads
// the standardised CSS media queries so an external keyboard
// or external mouse on a tablet still resolves to "hover".
function isTouchDevice() {
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

let _handWired = false;
function wireHandStrip() {
  if (_handWired) return;
  _handWired = true;
  const strip    = document.getElementById('sandbox-hand');
  const host     = document.getElementById('sandbox-hand-cards');
  const countEl  = document.getElementById('hand-count');
  const grabber  = document.getElementById('hand-grabber');
  if (!strip || !host) return;

  const lookup = (id) => PATENTS_BY_ID[id]
    || CREW.find((c) => c.id === id) || null;
  const kindOf = (id) =>
    CREW.some((c) => c.id === id) ? 'crew' : 'patent';

  // Drag from the deck → drop onto the strip → append slot.
  // preventDefault unconditionally on dragover — dataTransfer
  // .types is normalised differently across browsers and the
  // "includes" check was silently rejecting valid drags in
  // Firefox + Safari. The drop handler still validates the
  // payload before mutating state.
  host.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    host.classList.add('is-drop-target');
  });
  host.addEventListener('dragleave', () => host.classList.remove('is-drop-target'));
  host.addEventListener('drop', (e) => {
    e.preventDefault();
    host.classList.remove('is-drop-target');
    const id = e.dataTransfer.getData('text/card-id');
    const card = id && lookup(id);
    if (!card) return;
    const r = addToHand(card);
    if (!r.ok) {
      host.classList.add('flash-error');
      setTimeout(() => host.classList.remove('flash-error'), 700);
    }
  });

  // Grabber: drag vertically to resize the strip between a
  // collapsed default height (152px) and ~60% of viewport so
  // the player can audit a many-card hand without leaving the
  // sandbox view.
  if (grabber) wireHandGrabber(grabber, strip);

  const repaintHand = () => {
    const slots = getHandSlots();
    host.innerHTML = '';
    if (countEl) countEl.textContent =
      `${slots.length} card${slots.length === 1 ? '' : 's'}`;
    slots.forEach((id, idx) => {
      const card = lookup(id);
      if (!card) return;
      const wrap = document.createElement('div');
      wrap.className = 'hand-slot';
      if (isBoostMarked(id)) wrap.classList.add('is-boost-marked');
      wrap.dataset.slotIdx = String(idx);
      const cardEl = renderCard(card, { type: kindOf(id) });
      wrap.appendChild(cardEl);

      // Quick-action row appended INSIDE the card element so
      // it shares the same scale + transform as the Flip
      // button (which card-ui appends to the card root). Both
      // end up at the card's actual visible bottom edge —
      // previously the quick-icons sat at the slot's bottom
      // edge, which is way below the scaled card.
      const quick = document.createElement('div');
      quick.className = 'hand-quick-actions';
      const qBtn = (cls, glyph, title, handler) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `hand-q ${cls}`;
        b.textContent = glyph;
        b.title = title;
        b.addEventListener('click', (ev) => { ev.stopPropagation(); handler(); });
        return b;
      };
      quick.append(
        qBtn('q-discard', '🗑', 'Discard', () => removeFromHandAt(idx)),
        // Sell is functionally Discard until the Stage-3
        // economy lands (it'll pay out water/VP for sold cards
        // then). Same removal action; separate verb so the
        // intent is preserved when the economy ships.
        qBtn('q-sell',    '💰', 'Sell card', () => removeFromHandAt(idx)),
        qBtn('q-produce', '🏭', `Exo produce (spectral ${card.spectralType || '?'})`,
          () => setStatus(`Exo-produce needs a Stage-3 factory matching spectral ${card.spectralType || '?'}.`)),
        qBtn('q-boost',   '🚀', isBoostMarked(id) ? 'Unmark boost' : 'Mark for boost',
          () => toggleBoostMark(id)),
      );
      cardEl.appendChild(quick);

      // Mobile-only "View" button. On touch devices we drop
      // the hover affordances (no hover on touch) and replace
      // them with a two-step tap: first tap selects the card
      // (raised + ring); second tap on the View button opens
      // the inspect modal. Prevents accidental modal-opens on
      // a casual fingerprint.
      const viewBtn = document.createElement('button');
      viewBtn.type = 'button';
      viewBtn.className = 'hand-view-btn';
      viewBtn.textContent = 'View';
      viewBtn.title = 'Open this card';
      viewBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openCardModal(card, kindOf(id), idx);
      });
      wrap.appendChild(viewBtn);

      wrap.addEventListener('click', (ev) => {
        if (ev.target.closest('.card-flip, .card-rotate, .hand-q, .hand-view-btn')) return;
        if (isTouchDevice()) {
          // Tap toggles selection. Only one slot selected at a time.
          const wasSelected = wrap.classList.contains('is-selected');
          host.querySelectorAll('.hand-slot.is-selected').forEach((s) =>
            s.classList.remove('is-selected'));
          if (!wasSelected) wrap.classList.add('is-selected');
        } else {
          openCardModal(card, kindOf(id), idx);
        }
      });
      host.appendChild(wrap);
    });
    repaintBoostCommit();
  };

  // BOOST commit button next to the hand title. Lit when at
  // least one card is marked; pressing it transfers every
  // marked card from the hand to the rocket stack and pops the
  // stack modal so the player sees the cards land.
  const repaintBoostCommit = () => {
    const btn = document.getElementById('hand-boost-commit');
    if (!btn) return;
    const n = getBoostMarked().length;
    btn.dataset.armed = n > 0 ? '1' : '0';
    btn.disabled = n === 0;
    btn.textContent = n > 0 ? `🚀 BOOST (${n})` : '🚀 BOOST';
  };
  const commitBoost = () => {
    const marked = getBoostMarked();
    if (!marked.length) return;
    for (const id of marked) {
      const card = lookup(id);
      if (!card) continue;
      rocketAddCard(id, kindOf(id));
      removeFromHand(id);
    }
    clearBoostMarks();
    openRocketStackModal();
  };
  const commitBtn = document.getElementById('hand-boost-commit');
  if (commitBtn) commitBtn.addEventListener('click', commitBoost);

  // Stack button next to ✋ Hand: zooms the map to LEO (so the
  // rocket sprite is in view) AND pops the stack modal so the
  // player sees what's on the rocket immediately.
  const stackBtn = document.getElementById('hand-stack-open');
  if (stackBtn) stackBtn.addEventListener('click', () => {
    if (_renderer) _renderer.flyTo(LEO_ANCHOR, 4);
    openRocketStackModal();
  });

  repaintHand();
  onHandChange(repaintHand);
}

// Vertical resize grabber for the hand strip. Tracks a CSS
// variable on the strip element so the height is restored
// between repaints + survives onHandChange rerenders.
function wireHandGrabber(grabber, strip) {
  let startY = 0;
  let startH = 0;
  // Publish the live hand height as a CSS custom property on the
  // browse-shell so the sidepanel can stop its `bottom` at the
  // hand's top edge instead of overdrawing it.
  const shell = document.querySelector('.browse-shell');
  const publishHeight = (h) => {
    if (shell) shell.style.setProperty('--hand-height', `${h}px`);
  };
  publishHeight(strip.getBoundingClientRect().height || 320);
  const onMove = (clientY) => {
    const dy = startY - clientY;            // drag up = positive
    const next = Math.max(120, Math.min(window.innerHeight * 0.7, startH + dy));
    strip.style.height = `${next}px`;
    publishHeight(next);
  };
  const onPointerDown = (e) => {
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    startY = cy;
    startH = strip.getBoundingClientRect().height;
    document.body.style.userSelect = 'none';
    const moveEv = e.touches ? 'touchmove' : 'pointermove';
    const upEv   = e.touches ? 'touchend'  : 'pointerup';
    const onMoveEv = (ev) => onMove(ev.touches ? ev.touches[0].clientY : ev.clientY);
    const onUpEv   = () => {
      document.body.style.userSelect = '';
      document.removeEventListener(moveEv, onMoveEv);
      document.removeEventListener(upEv, onUpEv);
    };
    document.addEventListener(moveEv, onMoveEv);
    document.addEventListener(upEv, onUpEv);
  };
  grabber.addEventListener('pointerdown', onPointerDown);
  grabber.addEventListener('touchstart', onPointerDown, { passive: true });
}

// Custom drag-image. The browser's default drag-image is a
// faded snapshot of the element with no animation; we replace
// it with a fixed-position clone that follows the pointer, casts
// a heavy drop shadow, and wiggles with spring-damped rotation
// driven by horizontal velocity. The native HTML5 drop event
// still handles the actual data transfer — this only changes
// the visual the user sees while dragging.
let _dragGhost = null;
let _dragGhostState = null;

function startCustomDragGhost(srcEl, ev) {
  endCustomDragGhost();
  // 1×1 transparent canvas. setDragImage on a freshly-constructed
  // <img src=data:…> raced the browser in Safari + Firefox —
  // the drag started before the image loaded and the native
  // ghost flickered in. A canvas is fully painted synchronously
  // at the moment we hand it off, so the swap is reliable.
  const blank = document.createElement('canvas');
  blank.width = 1; blank.height = 1;
  try { ev.dataTransfer.setDragImage(blank, 0, 0); } catch { /* IE */ }

  const rect = srcEl.getBoundingClientRect();
  const ghost = srcEl.cloneNode(true);
  ghost.classList.add('drag-ghost');
  ghost.style.width  = rect.width + 'px';
  ghost.style.height = rect.height + 'px';
  // Anchor the ghost so the pointer "holds" the spot where the
  // user grabbed — feels less floaty than centring it.
  const offsetX = ev.clientX - rect.left;
  const offsetY = ev.clientY - rect.top;
  ghost.style.left = (ev.clientX - offsetX) + 'px';
  ghost.style.top  = (ev.clientY - offsetY) + 'px';
  document.body.appendChild(ghost);

  _dragGhost = ghost;
  _dragGhostState = {
    offsetX,
    offsetY,
    lastX: ev.clientX,
    lastY: ev.clientY,
    lastT: performance.now(),
    rotTarget: 0,
    rotCurrent: 0,
    raf: 0,
  };

  // Track pointer via document-level dragover (the only
  // drag-event with reliable clientX/clientY across browsers).
  document.addEventListener('dragover', onDragGhostMove);
  _dragGhostState.raf = requestAnimationFrame(animateDragGhost);
}

function onDragGhostMove(ev) {
  const s = _dragGhostState;
  if (!s || !_dragGhost) return;
  ev.preventDefault();   // also acts as dropEffect: copy
  const now = performance.now();
  const dt = Math.max(1, now - s.lastT);
  const vx = (ev.clientX - s.lastX) / dt;   // px/ms
  s.lastX = ev.clientX;
  s.lastY = ev.clientY;
  s.lastT = now;
  // Rotation target tilts toward the direction of horizontal
  // motion. Capped so a fast flick doesn't spin the card past
  // legibility. Wiggle comes from the spring lerp in animate().
  s.rotTarget = Math.max(-18, Math.min(18, vx * 28));
  _dragGhost.style.left = (ev.clientX - s.offsetX) + 'px';
  _dragGhost.style.top  = (ev.clientY - s.offsetY) + 'px';
}

function animateDragGhost() {
  const s = _dragGhostState;
  if (!s || !_dragGhost) return;
  // Critically-damped spring toward rotTarget. rotTarget decays
  // on its own so the rotation eases back to 0 when the user
  // pauses, giving the "wiggle settling" feel.
  s.rotCurrent += (s.rotTarget - s.rotCurrent) * 0.20;
  s.rotTarget *= 0.86;
  _dragGhost.style.transform = `translate3d(0,0,0) rotate(${s.rotCurrent.toFixed(2)}deg)`;
  s.raf = requestAnimationFrame(animateDragGhost);
}

function endCustomDragGhost() {
  document.removeEventListener('dragover', onDragGhostMove);
  if (_dragGhostState) cancelAnimationFrame(_dragGhostState.raf);
  if (_dragGhost) _dragGhost.remove();
  _dragGhost = null;
  _dragGhostState = null;
}

// Tap modal for a card sitting in the deck. Confirms "add to
// hand" with a single primary action. Mobile-friendly because
// HTML5 drag-and-drop doesn't work reliably on touch; pointing
// + tapping is a more honest gesture for "I want this card."
function openDeckTapModal(card, kind) {
  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay';
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const panel = document.createElement('div');
  panel.className = 'card-modal-panel';
  const cardEl = renderCard(card, { type: kind });
  cardEl.classList.add('card-modal-card');
  panel.appendChild(cardEl);

  const actions = document.createElement('div');
  actions.className = 'card-modal-actions';

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'modal-btn stack';
  addBtn.textContent = '✋ Add to hand';
  addBtn.addEventListener('click', () => {
    const r = addToHand(card);
    if (!r.ok) setStatus(`Can't add: ${r.reason}.`);
    close();
  });

  actions.append(addBtn);
  panel.appendChild(actions);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  // Tap the backdrop or press Escape to dismiss — no explicit ×
  // button. The card modal is small and the backdrop is the
  // obvious affordance.
  const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
}

// Inspect modal: enlarged copy of the clicked card with three
// actions — Discard (pop back to the deck), Exo produce (will
// need a factory location once Stage-3 builds them), and Add to
// stack (push onto the LEO rocket).
function openCardModal(card, kind, slotIdx) {
  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay';
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const panel = document.createElement('div');
  panel.className = 'card-modal-panel';
  const cardEl = renderCard(card, { type: kind });
  cardEl.classList.add('card-modal-card');
  panel.appendChild(cardEl);

  const actions = document.createElement('div');
  actions.className = 'card-modal-actions';

  // Four primary actions, emoji-led for the quick-icon row on
  // hand-slot hover (defined further down) to mirror the same
  // verbs. Boost flags the card for the next BOOST commit;
  // the commit lives on the hand strip's BOOST button (lit
  // when at least one card is marked).
  const discardBtn = document.createElement('button');
  discardBtn.type = 'button';
  discardBtn.className = 'modal-btn discard';
  discardBtn.textContent = '🗑 Discard';
  discardBtn.title = 'Return this card to the deck';
  discardBtn.addEventListener('click', () => {
    removeFromHandAt(slotIdx);
    close();
  });

  const sellBtn = document.createElement('button');
  sellBtn.type = 'button';
  sellBtn.className = 'modal-btn sell';
  sellBtn.textContent = '💰 Sell';
  sellBtn.title = 'Sell card — same as discard until the Stage-3 economy lands';
  sellBtn.addEventListener('click', () => {
    removeFromHandAt(slotIdx);
    close();
  });

  const produceBtn = document.createElement('button');
  produceBtn.type = 'button';
  produceBtn.className = 'modal-btn produce';
  produceBtn.textContent = `🏭 Exo produce (${card.spectralType || '?'})`;
  produceBtn.title = `Use a factory matching spectral type ${card.spectralType || '?'} to produce the dark-side resource`;
  produceBtn.addEventListener('click', () => {
    setStatus(
      `Exo-produce needs a factory matching spectral type `
      + `<strong>${card.spectralType || '?'}</strong>. `
      + `Factories aren't buildable yet (Stage 3).`
    );
    close();
  });

  const boostBtn = document.createElement('button');
  boostBtn.type = 'button';
  boostBtn.className = 'modal-btn stack';
  const marked = isBoostMarked(card.id);
  boostBtn.textContent = marked ? '🚀 Unmark boost' : '🚀 Boost';
  boostBtn.title = marked
    ? 'Remove the boost mark on this card'
    : 'Mark this card to be boosted to the LEO rocket on the next BOOST commit';
  boostBtn.addEventListener('click', () => {
    toggleBoostMark(card.id);
    close();
  });

  actions.append(discardBtn, sellBtn, produceBtn, boostBtn);
  panel.appendChild(actions);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  // Tap the backdrop or press Escape to dismiss — no explicit ×
  // button (the action row already crowds the bottom).
  const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
}

// Side panel: a vertical tab strip on the right edge of the
// browse view. Each tab pops a different pane in/out. Clicking the
// active tab closes the panel; clicking the × close button does
// the same. Pane content (patents / milestones / events) is
// rendered lazily on first open and then left mounted.
function wireSidebar() {
  if (_sidebarWired) return;
  _sidebarWired = true;
  const panel = document.getElementById('browse-sidepanel');
  const tabs  = document.getElementById('sidepanel-tabs');
  const close = document.getElementById('sidepanel-close');
  if (!panel || !tabs || !close) return;

  for (const btn of tabs.querySelectorAll('button')) {
    btn.addEventListener('click', () => {
      const pane = btn.dataset.pane;
      if (panel.dataset.active === pane) {
        // Toggle off if already active.
        showPane(null);
      } else {
        showPane(pane);
      }
    });
  }
  close.addEventListener('click', () => showPane(null));

  // Modal backdrop on mobile: tapping the dimmed area closes the
  // open pane. Backdrop is hidden on desktop via CSS so this is a
  // no-op there.
  const backdrop = document.getElementById('browse-modal-backdrop');
  if (backdrop) backdrop.addEventListener('click', () => showPane(null));
}

function showPane(pane) {
  const panel = document.getElementById('browse-sidepanel');
  if (!panel) return;
  panel.dataset.active = pane || '';
  for (const btn of panel.querySelectorAll('.sidepanel-tabs button')) {
    btn.classList.toggle('active', btn.dataset.pane === pane);
  }
  for (const el of panel.querySelectorAll('.panel-pane')) {
    el.classList.toggle('active', el.dataset.pane === pane);
  }
  // Backdrop tracks panel state — visible whenever a pane is open
  // (CSS gates it behind the mobile breakpoint so desktop never
  // sees it).
  const backdrop = document.getElementById('browse-modal-backdrop');
  if (backdrop) backdrop.classList.toggle('hidden', !pane);
  // Render the pane lazily on first reveal.
  if      (pane === 'patents')    renderPatents();
  else if (pane === 'milestones') renderMilestones();
  else if (pane === 'events')     renderEvents();
  else if (pane === 'solo')       renderSolo();
}

// Route state: shared across renderer instances. Tapping the first
// site sets `from`, tapping the second sets `to` and triggers the
// pathfinder; tapping again starts a new route from that site.
let _routeFrom = null;     // origin once a route has been plotted
let _routeTo = null;       // destination once a route has been plotted
let _selectedId = null;    // currently-highlighted site (just info, no routing)
let _routingMode = false;  // true while the user is picking a destination
let _activeData = null;

async function renderMap() {
  const host = document.getElementById('browse-map');
  if (!host) return;
  ensureMapShell(host);
  await mountMapFor();
}

// Build the toolbar + route panel skeleton once. Subsequent calls
// (e.g. after toggling view mode) reuse the same shell and just
// rebuild the map host inside it.
function ensureMapShell(host) {
  if (host.dataset.shellReady === '1') return;
  host.dataset.shellReady = '1';
  host.innerHTML = `
    <div class="map-toolbar">
      <div class="map-turn-controls">
        <button id="turn-move-rocket" title="Move the rocket one step along its planned route"
          aria-label="Move rocket">🛸</button>
        <button id="turn-end" title="End your turn"
          aria-label="End turn">⏭ End turn</button>
        <button id="turn-tracker" title="View turn tracker"
          aria-label="View turn tracker">🕐</button>
      </div>
      <button id="map-search-toggle" class="map-search-toggle"
        title="Search sites" aria-label="Search sites">🔍</button>
      <div class="map-search">
        <input id="map-search-input" type="text" autocomplete="off"
          spellcheck="false" placeholder="Find site…" />
        <button id="map-search-go" title="Fly to site"
          aria-label="Fly to site">🔍</button>
        <button id="map-search-close" class="map-search-close"
          title="Close search" aria-label="Close search">×</button>
        <ul id="map-search-suggestions" class="hidden"></ul>
      </div>
      <div id="map-search-backdrop" class="map-search-backdrop hidden"></div>
      <div class="map-route">
        <span id="route-status" class="muted">Tap a site to plan a route.</span>
        <button id="route-clear" hidden>Clear route</button>
        <button id="route-debug" title="Toggle debug panel"
          aria-label="Toggle debug panel">🔧</button>
        <button id="route-fullscreen" title="Toggle fullscreen map"
          aria-label="Toggle fullscreen">⛶</button>
      </div>
    </div>
    <div class="browse-map-stage">
      <div id="browse-map-canvas" class="browse-map-canvas"></div>
      <div id="map-debug" class="map-debug hidden">
        <div class="dbg-header">
          <span>Debug</span>
          <button id="dbg-close" aria-label="Close">×</button>
        </div>
        <div class="dbg-row">
          <span>Zoom</span>
          <strong id="dbg-zoom">—</strong>
        </div>
        <div class="dbg-row">
          <span>FPS</span>
          <strong id="dbg-fps">—</strong>
        </div>
        <label class="dbg-slider">
          <span>Initial zoom <em id="dbg-init-zoom-val"></em></span>
          <input id="dbg-init-zoom" type="range" min="0.5" max="6" step="0.1" />
        </label>
        <label class="dbg-slider">
          <span>Label fade start <em id="dbg-fade-min-val"></em></span>
          <input id="dbg-fade-min" type="range" min="0.5" max="6" step="0.1" />
        </label>
        <label class="dbg-slider">
          <span>Label fade end <em id="dbg-fade-max-val"></em></span>
          <input id="dbg-fade-max" type="range" min="0.5" max="6" step="0.1" />
        </label>
        <label class="dbg-check">
          <input id="dbg-show-decoratives" type="checkbox" />
          <span>Show decoratives</span>
        </label>
        <button id="dbg-reset" class="dbg-reset">Reset view</button>
      </div>
    </div>
  `;
  host.querySelector('#route-clear').addEventListener('click', clearRoute);
  host.querySelector('#route-fullscreen').addEventListener('click', () => {
    // Promote the whole browse shell to fullscreen, not just the
    // map host -- this way the sidebar comes along for the ride.
    const shell = document.querySelector('.browse-shell') || host;
    toggleFullscreen(shell);
  });
  host.querySelector('#route-debug').addEventListener('click', () => {
    const panel = host.querySelector('#map-debug');
    panel.classList.toggle('hidden');
    const open = !panel.classList.contains('hidden');
    if (_renderer) _renderer.setOption('debug', open);
  });
  // Turn clock + rocket-movement controls. End turn pops a confirm
  // when the player still has unspent budget; if they confirm and
  // the new slot is an event, openTurnClockModal animates the d6.
  // Move rocket is a placeholder until the rocket-movement engine
  // lands — it just consumes the per-turn move budget for now so
  // the end-turn confirm reflects the spend.
  host.querySelector('#turn-end').addEventListener('click', async () => {
    // Capture the previous slot BEFORE advancing so the modal can
    // animate the Sunspot Cube sliding from old → new instead of
    // teleporting. If the player cancels the confirm, nothing
    // moved, so we skip the modal entirely.
    const prevTurn = getTurn();
    const result = await triggerEndTurn();
    if (!result) return;
    openTurnClockModal({
      animateFrom: prevTurn,
      rolling: result.event ? { value: result.event.dieRoll } : null,
    });
  });
  host.querySelector('#turn-tracker').addEventListener('click', () => {
    openTurnClockModal();
  });
  host.querySelector('#turn-move-rocket').addEventListener('click', () => {
    // Stub for now — Stage 3's movement engine will actually walk
    // the rocket along its planned-route segments. Until then we
    // just spend the per-turn move budget so the end-turn confirm
    // can see "moves remaining: 0".
    if (!consumeMove()) {
      setStatus('No moves left this turn — end turn to refresh.');
      return;
    }
    setStatus('🛸 Rocket move queued (engine pending Stage 3).');
  });
  host.querySelector('#dbg-close').addEventListener('click', () => {
    host.querySelector('#map-debug').classList.add('hidden');
    if (_renderer) _renderer.setOption('debug', false);
  });
  wireSearch(host);
  document.addEventListener('fullscreenchange', () => {
    const btn = host.querySelector('#route-fullscreen');
    if (btn) btn.textContent = document.fullscreenElement ? '⤬' : '⛶';
  });
}

// Hook the debug-panel widgets to whichever renderer is currently
// active. Called from mountMapFor() each time the renderer is
// (re)built, so the panel's bound to the live instance.
function wireDebugPanel(renderer) {
  const panel = document.getElementById('map-debug');
  if (!panel) return;
  const zoomEl    = panel.querySelector('#dbg-zoom');
  const fpsEl     = panel.querySelector('#dbg-fps');
  const initZoom  = panel.querySelector('#dbg-init-zoom');
  const fadeMin   = panel.querySelector('#dbg-fade-min');
  const fadeMax   = panel.querySelector('#dbg-fade-max');
  const initZoomVal = panel.querySelector('#dbg-init-zoom-val');
  const fadeMinVal  = panel.querySelector('#dbg-fade-min-val');
  const fadeMaxVal  = panel.querySelector('#dbg-fade-max-val');
  const showDec   = panel.querySelector('#dbg-show-decoratives');
  const resetBtn  = panel.querySelector('#dbg-reset');

  initZoom.value = renderer.options.initialZoom;
  fadeMin.value  = renderer.options.labelFadeMin;
  fadeMax.value  = renderer.options.labelFadeMax;
  initZoomVal.textContent = Number(initZoom.value).toFixed(1) + 'x';
  fadeMinVal.textContent  = Number(fadeMin.value).toFixed(1) + 'x';
  fadeMaxVal.textContent  = Number(fadeMax.value).toFixed(1) + 'x';
  showDec.checked = renderer.options.showDecoratives;

  initZoom.oninput = () => {
    const v = Number(initZoom.value);
    renderer.setOption('initialZoom', v);
    initZoomVal.textContent = v.toFixed(1) + 'x';
  };
  fadeMin.oninput = () => {
    renderer.setOption('labelFadeMin', Number(fadeMin.value));
    fadeMinVal.textContent = Number(fadeMin.value).toFixed(1) + 'x';
  };
  fadeMax.oninput = () => {
    renderer.setOption('labelFadeMax', Number(fadeMax.value));
    fadeMaxVal.textContent = Number(fadeMax.value).toFixed(1) + 'x';
  };
  showDec.onchange = () => {
    renderer.setOption('showDecoratives', showDec.checked);
  };
  resetBtn.onclick = () => renderer.reset();

  // If the panel is currently open, the new renderer should also
  // log clicks. (mountMapFor rebuilds the renderer on every mode
  // toggle; without this the debug flag would reset to false.)
  const panelOpen = !panel.classList.contains('hidden');
  renderer.setOption('debug', panelOpen);

  let lastZoom = -1, lastFps = -1;
  renderer.onFrame(() => {
    const z = Math.round(renderer.getZoom() * 100) / 100;
    if (z !== lastZoom) { zoomEl.textContent = z.toFixed(2) + 'x'; lastZoom = z; }
    const f = renderer.getFps();
    if (f !== lastFps) { fpsEl.textContent = String(f); lastFps = f; }
  });
}

// Site search with reactive suggestions. Each keystroke filters the
// active dataset's named sites; the dropdown shows up to 8 matches
// ranked with starts-with first. Pressing Enter or the 🔍 button
// flies the renderer to the top hit at zoom 5. Suggestions hide
// when the user clicks outside the search area.
const SEARCH_FLY_ZOOM = 5;

function wireSearch(host) {
  const input    = host.querySelector('#map-search-input');
  const goBtn    = host.querySelector('#map-search-go');
  const list     = host.querySelector('#map-search-suggestions');
  const toggle   = host.querySelector('#map-search-toggle');
  const closeBtn = host.querySelector('#map-search-close');
  const backdrop = host.querySelector('#map-search-backdrop');
  const searchEl = host.querySelector('.map-search');
  if (!input || !goBtn || !list) return;
  let activeIndex = -1;
  let currentItems = [];

  // Mobile: search lives in a modal triggered by the toolbar 🔍 button.
  // CSS hides .map-search by default at <720px and shows it as a fixed
  // modal when .is-open is set. Desktop ignores all of this — the inline
  // search stays in the toolbar and the toggle/close/backdrop are hidden.
  function openSearchModal() {
    searchEl?.classList.add('is-open');
    backdrop?.classList.remove('hidden');
    // Defer focus so the keyboard pops AFTER layout settles.
    setTimeout(() => input.focus(), 0);
  }
  function closeSearchModal() {
    searchEl?.classList.remove('is-open');
    backdrop?.classList.add('hidden');
    list.classList.add('hidden');
  }
  toggle?.addEventListener('click', () => {
    if (searchEl?.classList.contains('is-open')) closeSearchModal();
    else openSearchModal();
  });
  closeBtn?.addEventListener('click', closeSearchModal);
  backdrop?.addEventListener('click', closeSearchModal);

  function searchSites(q) {
    if (!_activeData || !q) return [];
    const ql = q.toLowerCase().trim();
    if (!ql) return [];
    const startsWith = [];
    const includes   = [];
    for (const s of _activeData.sites) {
      if (s.isWaypoint || !s.name) continue;
      const nl = s.name.toLowerCase();
      if (nl.startsWith(ql))       startsWith.push(s);
      else if (nl.includes(ql))    includes.push(s);
      if (startsWith.length + includes.length >= 32) break;
    }
    return startsWith.concat(includes).slice(0, 8);
  }

  function renderList(items) {
    currentItems = items;
    activeIndex = items.length ? 0 : -1;
    list.innerHTML = '';
    if (!items.length) { list.classList.add('hidden'); return; }
    items.forEach((s, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<strong></strong> <em></em>`;
      li.querySelector('strong').textContent = s.name;
      li.querySelector('em').textContent = s.type;
      li.classList.toggle('active', i === activeIndex);
      li.addEventListener('mousedown', (e) => {
        // mousedown not click so the input doesn't blur before we
        // can read the selection.
        e.preventDefault();
        pickItem(s);
      });
      list.appendChild(li);
    });
    list.classList.remove('hidden');
  }

  function updateActive() {
    [...list.children].forEach((li, i) => {
      li.classList.toggle('active', i === activeIndex);
    });
  }

  function pickItem(site) {
    if (!site || !_renderer) return;
    _renderer.flyTo(site, SEARCH_FLY_ZOOM);
    input.value = site.name;
    list.classList.add('hidden');
    closeSearchModal();
  }

  function commit() {
    const hit = activeIndex >= 0 ? currentItems[activeIndex] : currentItems[0];
    if (hit) pickItem(hit);
  }

  input.addEventListener('input', () => {
    renderList(searchSites(input.value));
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (currentItems.length) {
        activeIndex = (activeIndex + 1) % currentItems.length;
        updateActive();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (currentItems.length) {
        activeIndex = (activeIndex - 1 + currentItems.length) % currentItems.length;
        updateActive();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      list.classList.add('hidden');
      if (searchEl?.classList.contains('is-open')) closeSearchModal();
    }
  });
  input.addEventListener('focus', () => {
    if (input.value) renderList(searchSites(input.value));
  });
  goBtn.addEventListener('click', commit);

  // Outside-click closes the dropdown.
  document.addEventListener('mousedown', (e) => {
    if (!host.querySelector('.map-search').contains(e.target)) {
      list.classList.add('hidden');
    }
  });
}

// Promote the map host into the browser's fullscreen mode. The
// ResizeObserver in the renderer picks up the new dimensions and
// re-fits the canvas. Falls back gracefully on browsers without
// the Fullscreen API.
function toggleFullscreen(host) {
  if (document.fullscreenElement) {
    document.exitFullscreen?.();
    return;
  }
  const req = host.requestFullscreen
    || host.webkitRequestFullscreen
    || host.mozRequestFullScreen;
  if (req) req.call(host).catch(() => {});
}

async function mountMapFor() {
  const host = document.getElementById('browse-map');
  const canvas = host.querySelector('#browse-map-canvas');
  canvas.innerHTML = '<div class="map-loading">Loading map…</div>';
  _renderer = null;
  _routeFrom = null;
  _routeTo = null;
  updateRouteStatus();
  try {
    _activeData = await loadMap();
    soloBindData(_activeData);
    _renderer = new MapRenderer(canvas, {
      data: _activeData,
      onSelect: onSiteSelect,
    });
    _renderer.onSandboxRocketClick = () => openRocketStackModal();
    wireDebugPanel(_renderer);
    syncSoloShipMarker();
    syncSandboxRocket();
  } catch (err) {
    canvas.innerHTML = `<div class="map-loading error">Map failed to load: ${err.message}</div>`;
  }
}

// Paint the sandbox rocket on the map at LEO. Position is a
// fixed world-space coord that visually reads as "above Earth"
// on the cleaned-up zone-band layout. Colour stays yellow for
// now — multiplayer Stage 3 will pick from the 5-colour palette
// per player. canFly is recomputed from rocket.js on every
// rocket-state change.
// Centered modal that shows the rocket's stack — replaces the
// old sidepanel "rocket" pane. Same data, same actions (pull a
// card back to the hand), just opens in the middle of the map
// like the other inspect modals. Press × or Esc to dismiss.
function openRocketStackModal() {
  // Close any existing instance first so the modal doesn't
  // stack up if the player clicks the rocket twice fast.
  document.querySelector('.rocket-stack-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay rocket-stack-overlay';
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (_rocketModalUnsub) { _rocketModalUnsub(); _rocketModalUnsub = null; }
  };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const panel = document.createElement('div');
  panel.className = 'rocket-stack-panel';
  overlay.appendChild(panel);

  const xBtn = document.createElement('button');
  xBtn.type = 'button';
  xBtn.className = 'modal-x';
  xBtn.textContent = '×';
  xBtn.title = 'Close (Esc)';
  xBtn.addEventListener('click', close);
  panel.appendChild(xBtn);

  // Engagement is a transient UI flag — the player presses
  // "Engage" once supports are met to trigger the moving-rocket
  // animation. Any stack change (add / remove / re-pick active)
  // resets it so a freshly-flyable stack still needs the user to
  // confirm "yes, engage" before the animation runs.
  let engaged = false;
  const repaint = () => {
    const stack = getRocketStack();
    const r = isRocketActive();
    const activeId = getActiveThrusterId();
    // The active thruster's "supplied" set is what the rest of
    // the stack contributes — used both by isRocketActive() and
    // by renderCard() to mark each support chip ✓.
    const supplied = new Set();
    for (const s of stack) {
      if (s.id === activeId) continue;
      const c = lookup(s.id);
      if (!c) continue;
      const sup = (c.faces && c.faces.primary && c.faces.primary.supplies) || c.supplies || [];
      for (const k of sup) supplied.add(k);
    }
    // Engagement is meaningless when supports aren't satisfied —
    // clear the flag so the button text + animation don't lie if
    // the player removes a card mid-flight.
    if (!r.active) engaged = false;
    const totals = getStackTotals();
    const thrStats = getActiveThrusterStats();
    panel.querySelector('.rocket-stack-body')?.remove();
    const body = document.createElement('div');
    body.className = 'rocket-stack-body';
    if (engaged && r.active) body.classList.add('is-engaged');
    // Status banner: active + green when all three rules hold,
    // grounded + red otherwise with the specific reason inline.
    const status = r.active
      ? '<p class="rocket-status ok">✓ Active — rocket can move.</p>'
      : `<p class="rocket-status bad">🚫 Inactive — ${esc(r.reason)}.</p>
         ${r.missing.length
           ? `<ul class="rocket-issues">${r.missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>`
           : ''}`;

    // Totals row: dry + wet mass, min rad-hard, fuel +/-, plus
    // (when a thruster is active) the modifier-applied thrust and
    // fuel-per-burn numbers. Rocket can lift iff thrust >= wetMass.
    const fmt = (n) => Number.isFinite(n) ? (Math.round(n * 100) / 100) : '—';
    const thrustHtml = thrStats
      ? `<div class="rocket-totals-cell">
           <span class="lbl">Thrust</span>
           <strong class="${thrStats.canLift ? 'ok' : 'bad'}">${fmt(thrStats.thrust)}</strong>
           ${thrStats.thrust !== thrStats.baseThrust
              ? `<small>(base ${fmt(thrStats.baseThrust)})</small>` : ''}
         </div>
         <div class="rocket-totals-cell">
           <span class="lbl">Fuel / burn</span>
           <strong>${thrStats.fuel != null ? fmt(thrStats.fuel) : '—'}</strong>
           ${thrStats.fuel != null && thrStats.fuel !== thrStats.baseFuel
              ? `<small>(base ${fmt(thrStats.baseFuel)})</small>` : ''}
         </div>`
      : '';
    const tank = getTankWater();
    const tankMax = getTankMax();
    const totalsHtml = `
      <div class="rocket-totals">
        <div class="rocket-totals-cell">
          <span class="lbl">Cards</span><strong>${totals.count}</strong>
        </div>
        <div class="rocket-totals-cell">
          <span class="lbl">Dry mass</span><strong>${totals.dryMass}</strong>
        </div>
        <div class="rocket-totals-cell">
          <span class="lbl">Wet mass</span>
          <strong class="${thrStats && !thrStats.canLift ? 'bad' : ''}">${totals.wetMass}</strong>
        </div>
        <div class="rocket-totals-cell">
          <span class="lbl">Min rad-hard</span>
          <strong>${totals.minRadHard != null ? totals.minRadHard : '—'}</strong>
        </div>
        <div class="rocket-totals-cell rocket-fuel">
          <span class="lbl">Fuel 💧</span>
          <button type="button" class="rocket-fuel-btn"
            data-act="dec" ${tank <= 0 ? 'disabled' : ''}
            aria-label="Remove 1 fuel">−</button>
          <strong>${tank}<small>/${tankMax}</small></strong>
          <button type="button" class="rocket-fuel-btn"
            data-act="inc" ${tank >= tankMax ? 'disabled' : ''}
            aria-label="Add 1 fuel">+</button>
        </div>
        ${thrustHtml}
      </div>
    `;

    body.innerHTML = `
      <div class="rocket-stack-header">
        <h2 class="rocket-stack-title">🚀 LEO Rocket</h2>
        ${totalsHtml}
        ${status}
      </div>
      <div id="rocket-stack-cards">
        <div class="rocket-stack-row thrusters" id="rocket-stack-thrusters"></div>
        <div class="rocket-stack-row others" id="rocket-stack-others"></div>
      </div>
    `;
    panel.appendChild(body);

    // Fuel +/- wiring on the totals row.
    body.querySelectorAll('.rocket-fuel-btn').forEach((b) => {
      b.addEventListener('click', () => {
        if (b.dataset.act === 'inc') addFuel(1);
        else removeFuel(1);
      });
    });

    // Engage button: greyed out until supports are satisfied; tap
    // to ignite the moving-rocket animation. Lives in the pinned
    // header so it stays on screen even on a tall stack.
    const engageBtn = document.createElement('button');
    engageBtn.type = 'button';
    engageBtn.className = 'rocket-engage' + (engaged ? ' is-engaged' : '');
    engageBtn.disabled = !r.active;
    engageBtn.textContent = engaged && r.active
      ? '🔥 Engaged — rocket is moving!'
      : r.active ? '🔥 Engage rocket' : '🔥 Engage rocket (supports unmet)';
    engageBtn.addEventListener('click', () => {
      if (!r.active) return;
      engaged = !engaged;
      repaint();
    });
    body.querySelector('.rocket-stack-header').appendChild(engageBtn);

    const cards = body.querySelector('#rocket-stack-cards');
    const thrustersHost = body.querySelector('#rocket-stack-thrusters');
    const othersHost    = body.querySelector('#rocket-stack-others');
    if (!stack.length) {
      cards.innerHTML = '<p class="muted">Your rocket is empty. Mark cards 🚀 in your hand, then press BOOST to launch them up here.</p>';
      return;
    }

    // Pre-compute the set of kinds the active thruster requires —
    // any other card whose supplies intersect this set is an
    // "active supporter" and gets the supporting-card highlight in
    // sync with the thruster's ✓ chips. Robonauts that double as
    // thrusters (card.thrust != null) are treated as thrusters
    // too, both for the top-row layout and for active selection.
    const requiredKinds = new Set();
    if (thrStats) {
      const active = lookup(thrStats.cardId);
      const f = (active && active.faces && active.faces.primary) || active || {};
      const reqs = f.requires || (active && active.requires) || [];
      for (const r of reqs) if (r && r.kind) requiredKinds.add(r.kind);
    }

    stack.forEach((slot, idx) => {
      const card = lookup(slot.id);
      if (!card) return;
      const isThruster = card.type === 'thruster' || card.thrust != null;
      const wrap = document.createElement('div');
      wrap.className = 'rocket-slot';
      if (isThruster && slot.id === activeId) wrap.classList.add('is-active-thruster');
      // Non-thruster cards whose supplies satisfy any of the
      // active thruster's requires get an "is-supporting" wash so
      // the player can trace which specific cards are powering
      // their active thruster, not just see the ✓ chips on the
      // thruster card.
      if (!isThruster && requiredKinds.size) {
        const cf = (card.faces && card.faces.primary) || card;
        const supplies = cf.supplies || card.supplies || [];
        if (supplies.some((k) => requiredKinds.has(k))) {
          wrap.classList.add('is-supporting');
        }
      }
      // Only the active thruster's supports are validated against
      // the rest of the stack — passing `supplied` for others would
      // mark chips ✓ that aren't actually contributing to flight.
      const cardOpts = { type: slot.kind || 'patent' };
      if (isThruster && slot.id === activeId) cardOpts.supplied = supplied;
      wrap.appendChild(renderCard(card, cardOpts));

      const actions = document.createElement('div');
      actions.className = 'rocket-slot-actions';

      // Thrusters get a "Set as active" / "Active" toggle so
      // the player can pick which thruster the rocket runs on.
      // Non-thrusters skip this control.
      if (isThruster) {
        const activate = document.createElement('button');
        activate.type = 'button';
        activate.className = 'rocket-activate'
          + (slot.id === activeId ? ' is-active' : '');
        activate.textContent = slot.id === activeId
          ? '⚡ Active thruster'
          : 'Set as active';
        activate.disabled = slot.id === activeId;
        activate.addEventListener('click', () => setActiveThruster(slot.id));
        actions.appendChild(activate);
      }

      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'rocket-back-to-hand';
      back.textContent = '↩ Back to hand';
      back.addEventListener('click', () => {
        rocketRemoveCard(idx);
        addToHand(card);
      });
      actions.appendChild(back);

      wrap.appendChild(actions);
      // Thrusters (including missile-class robonauts that carry a
      // thrust value) live in the top row; everything else falls
      // through to the lower row.
      (isThruster ? thrustersHost : othersHost).appendChild(wrap);
    });
    // Hide the row containers when empty so we don't leave dead
    // grid space between sections.
    if (!thrustersHost.children.length) thrustersHost.style.display = 'none';
    if (!othersHost.children.length)    othersHost.style.display    = 'none';
  };
  const lookup = (id) => PATENTS_BY_ID[id]
    || CREW.find((c) => c.id === id) || null;
  repaint();
  _rocketModalUnsub = onRocketChange(repaint);

  document.body.appendChild(overlay);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
}
let _rocketModalUnsub = null;

function syncSandboxRocket() {
  if (!_renderer) return;
  const stack = getRocketStack();
  // Rocket model is present in LEO whenever the player has ≥1
  // card in the stack — even when it isn't yet activatable.
  // The 🚫 overlay distinguishes active vs inactive states.
  if (!stack.length) {
    _renderer.setSandboxRocket(null);
    return;
  }
  const r = isRocketActive();
  _renderer.setSandboxRocket({
    x: LEO_ANCHOR.x,
    y: LEO_ANCHOR.y,
    colour: 'yellow',
    canFly: r.active,       // drives the 🚫 + transparency overlay
  });
}

// Solo state change -> refresh the panel + the ship marker on the
// map. The listener is hooked once (sidebar wire-up time) and
// dispatches whenever solo.js calls emit().
function syncSoloShipMarker() {
  if (!_renderer) return;
  const s = soloState();
  if (s && !s.gameOver) {
    _renderer.setPlayerShipId(s.ship.at);
    _renderer.setRoute(s.pendingPath ? s.pendingPath.segments : null);
    _renderer.setRouteEndpoints(s.ship.at, s.pendingTargetId || null);
  } else {
    _renderer.setPlayerShipId(null);
  }
}


function enterRoutingMode(origin) {
  _routingMode = true;
  _routeFrom = origin;
  _routeTo = null;
  if (_renderer) {
    _renderer.setRoute(null);
    _renderer.setRouteEndpoints(origin.id, null);
  }
  document.querySelector('.browse-shell')?.classList.add('is-routing');
  document.getElementById('route-clear').hidden = false;
  setStatus(
    `Picking destination from <strong>${esc(origin.name)}</strong> — `
    + `tap any landable site. Press Clear route to cancel.`
  );
}

function exitRoutingMode() {
  _routingMode = false;
  document.querySelector('.browse-shell')?.classList.remove('is-routing');
}

function onSiteSelect(site) {
  // Solo mode hijacks clicks: every site you tap becomes the
  // proposed destination for your ship's current position.
  const s = soloState();
  if (s && !s.gameOver) {
    if (site.id === s.ship.at) {
      soloSetTarget(null);
    } else if (site.isLandable === false || site.isDecorative) {
      // Sun, Earth-as-flavour-body, decoratives -- not pickable.
    } else {
      soloSetTarget(site.id);
    }
    showPane('solo');
    return;
  }

  // Routing-pick mode: the user already pressed "Navigate to" on
  // an origin and now the next tap is the destination. Plot the
  // route and exit routing mode. The destination becomes the
  // currently-selected site so the popup + highlight stay in sync
  // with what the player most recently tapped.
  if (_routingMode && _routeFrom) {
    if (site.isDecorative || site.isLandable === false) {
      setStatus(`<strong>${esc(site.name)}</strong> is not landable — pick another site.`);
      return;
    }
    if (site.id === _routeFrom.id) {
      setStatus(`Destination must differ from <strong>${esc(_routeFrom.name)}</strong>.`);
      return;
    }
    _routeTo = site;
    const result = findPath(_activeData, _routeFrom.id, _routeTo.id);
    if (!result) {
      setStatus(`No route from <strong>${esc(_routeFrom.name)}</strong> to <strong>${esc(site.name)}</strong>.`);
      _renderer.setRoute(null);
      _renderer.setRouteEndpoints(_routeFrom.id, site.id);
      exitRoutingMode();
      return;
    }
    _renderer.setRoute(result.segments);
    _renderer.setRouteEndpoints(_routeFrom.id, _routeTo.id);
    _selectedId = _routeTo.id;
    showSitePopupFor(_routeTo);
    const hops = result.segments.length;
    setStatus(
      `<strong>${esc(_routeFrom.name)}</strong> → <strong>${esc(_routeTo.name)}</strong>: ` +
      `<strong class="big">${result.totalBurns}</strong> burns over ${hops} hop${hops === 1 ? '' : 's'}.`
    );
    exitRoutingMode();
    return;
  }

  // Default tap behaviour: tap a site to select + show popup;
  // tap the SAME site again to deselect. The on-map popup carries
  // the site stats + the "Navigate to" button, replacing the old
  // side-panel info pane.
  if (_selectedId === site.id) {
    _selectedId = null;
    if (_renderer) {
      _renderer.setRouteEndpoints(null, null);
      _renderer.clearSitePopup();
    }
    setStatus('Tap a site to see its info. Press "Navigate to" in the popup to plan a route.');
    return;
  }

  // Defensive: clear any stale popup BEFORE updating selection so
  // we can't end up with a popup pointing to the previous site
  // while the highlight has moved on. If the new tap turns out to
  // be a decorative (no popup needed), the stale one is already
  // gone instead of leaking forward.
  if (_renderer) _renderer.clearSitePopup();

  _selectedId = site.id;
  if (_renderer) {
    _renderer.setRouteEndpoints(site.id, null);
    // Smooth-pan the camera so the selected hex sits at the centre
    // of the map. Keeps the existing zoom — jumping zoom on every
    // tap would be disorienting.
    _renderer.panTo(site);
  }

  if (site.isDecorative) {
    setStatus(`Decorative routing node — not selectable.`);
    return;
  }

  showSitePopupFor(site);
  setStatus(`Selected <strong>${esc(site.name)}</strong>.`);
}

// Build the on-map popup for a selected site. Carries the same
// info the old "Site info" sidebar pane used to show, plus the
// "Navigate to" action that arms routing-pick mode.
function showSitePopupFor(site) {
  if (!_renderer) return;
  const canNavigate = !(site.isDecorative || site.isLandable === false);
  const rocketReady = canPlanRocketRoute();
  // Order: rocket-plan FIRST — it's the game action and the one
  // the player will reach for most. Navigate-to is the secondary
  // "check distance" affordance. Rocket-plan is enabled whenever
  // the destination is landable; the turn breakdown uses a fixed
  // per-turn budget so we don't need an active thruster to draw
  // the route (the engage button on the stack modal is where
  // missing-rocket gating lives).
  const actions = [
    {
      // Plan the rocket's actual flight from LEO to this site,
      // broken into turns based on its active-thruster burn
      // budget. Turn-1 segments paint as the bright highlight;
      // later turns get a "T2 / T3" pill at midpoint so the
      // player can read the trip plan at a glance.
      label: '🛸 Plan rocket route',
      variant: 'rocket',
      disabled: !canNavigate,
      onClick: () => {
        if (!canNavigate) return;
        const ok = planRocketRouteTo(site);
        if (ok) _renderer.clearSitePopup();
      },
    },
    {
      label: 'Navigate to →',
      variant: 'secondary',
      disabled: !canNavigate,
      onClick: () => {
        if (!canNavigate) return;
        enterRoutingMode(site);
        _renderer.clearSitePopup();
      },
    },
  ];
  _renderer.setSitePopup(site, actions);
  _renderer.onPopupClose(() => {
    _selectedId = null;
    if (_renderer) _renderer.setRouteEndpoints(null, null);
  });
}

// True when there's an active thruster (or missile-class robonaut
// with a thrust value) the player can fly from LEO. Doesn't
// require all supports satisfied yet — if the route is plannable
// in principle, show it even if the rocket can't actually engage
// today; the totals row in the stack modal still flags wet-mass
// vs thrust separately.
function canPlanRocketRoute() {
  const stack = getRocketStack();
  const activeId = getActiveThrusterId();
  if (!activeId) return false;
  return stack.some((s) => s.id === activeId);
}

// Build a per-turn rocket plan from LEO to the destination. Each
// edge costs ceil(dv) burns; the per-turn burn budget is BURNS_PER_TURN
// (4 — matches HF4's 4 operations per turn). Segments are tagged
// with the turn number they belong to; the renderer paints turn 1
// in the bright highlight and labels later turns with T2/T3 pills.
const BURNS_PER_TURN = 4;
function planRocketRouteTo(destSite) {
  if (!_renderer || !_activeData) return false;
  // LEO origin = the lagrange waypoint named "LEO" in the planner
  // data (loaded once at data-load time, same node MapRenderer
  // anchors the sandbox rocket sprite to).
  const leo = _activeData.sites.find(
    (s) => s.type === 'lagrange' && s.name === 'LEO'
  );
  if (!leo) {
    setStatus('Could not find the LEO node to launch from.');
    return false;
  }
  if (destSite.id === leo.id) {
    setStatus('Pick a destination other than LEO.');
    return false;
  }
  const result = findPath(_activeData, leo.id, destSite.id);
  if (!result) {
    setStatus(
      `No rocket route from <strong>LEO</strong> to `
      + `<strong>${esc(destSite.name)}</strong>.`
    );
    _renderer.setRoute(null);
    _renderer.setRouteEndpoints(leo.id, destSite.id);
    return false;
  }
  let turn = 1;
  let burnsThisTurn = 0;
  const segments = result.segments.map((seg) => {
    const cost = Math.max(1, Math.ceil(seg.dv || 1));
    if (burnsThisTurn + cost > BURNS_PER_TURN && burnsThisTurn > 0) {
      turn += 1;
      burnsThisTurn = 0;
    }
    burnsThisTurn += cost;
    return { ...seg, turn, burns: cost };
  });
  _routeFrom = leo;
  _routeTo = destSite;
  _renderer.setRoute(segments);
  _renderer.setRouteEndpoints(leo.id, destSite.id);
  document.getElementById('route-clear').hidden = false;
  setStatus(
    `🛸 <strong>LEO</strong> → <strong>${esc(destSite.name)}</strong>: `
    + `<strong class="big">${result.totalBurns}</strong> burns over `
    + `<strong>${turn}</strong> turn${turn === 1 ? '' : 's'}.`
  );
  return true;
}

function clearRoute() {
  _routeFrom = null;
  _routeTo = null;
  _selectedId = null;
  exitRoutingMode();
  if (_renderer) {
    _renderer.setRoute(null);
    _renderer.setRouteEndpoints(null, null);
  }
  document.getElementById('route-clear').hidden = true;
  setStatus('Tap a site to see its info. Press "Navigate to" to plan a route.');
}

function setStatus(html) {
  const el = document.getElementById('route-status');
  if (el) el.innerHTML = html;
}
function updateRouteStatus() {
  setStatus('Tap a site to plan a route.');
  const btn = document.getElementById('route-clear');
  if (btn) btn.hidden = true;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderPatents() {
  const host = document.getElementById('browse-patents');
  if (!host) return;
  host.innerHTML = '';

  // Filter bar: All / per-type / Crew. Crew lives in its own
  // deck (data/crew.js) but the card UI handles both.
  const bar = document.createElement('div');
  bar.className = 'patent-filter';
  bar.innerHTML = '';
  const types = [...PATENT_TYPES, 'crew'];
  const counts = Object.fromEntries(PATENT_TYPES.map((t) => [t, patentsByType(t).length]));
  counts.crew = CREW.length;
  types.forEach((t, i) => {
    bar.innerHTML += `<button${i === 0 ? ' class="active"' : ''} data-type="${t}">${cap(t)} (${counts[t]})</button>`;
  });
  host.appendChild(bar);

  const grid = document.createElement('div');
  grid.className = 'card-grid';
  host.appendChild(grid);

  // Each physical card exists in exactly one location: deck,
  // hand, or rocket. The library grid decorates every tile with
  // its current location so the player can see where each card
  // is at a glance — ✋ overlay for hand, 🛸 overlay for rocket.
  // Cards not in the deck have drag + tap disabled (no
  // duplicates allowed; pull them back from hand/rocket first).
  const decorateForHand = (card, asKind) => {
    const el = renderCard(card, { type: asKind });
    el.dataset.cardId  = card.id;
    el.dataset.cardKind = asKind;
    const inHand   = isInHand(card.id);
    const inRocket = isInRocket(card.id);
    if (inHand)   el.classList.add('in-hand');
    if (inRocket) el.classList.add('in-rocket');
    if (inHand || inRocket) return el;   // placeholder — not interactive

    el.draggable = true;
    el.addEventListener('dragstart', (ev) => {
      ev.dataTransfer.setData('text/card-id', card.id);
      ev.dataTransfer.setData('text/card-kind', asKind);
      ev.dataTransfer.effectAllowed = 'move';
      el.classList.add('is-dragging');
      startCustomDragGhost(el, ev);
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('is-dragging');
      endCustomDragGhost();
    });
    el.addEventListener('click', (ev) => {
      if (ev.target.closest('.card-flip, .card-rotate')) return;
      openDeckTapModal(card, asKind);
    });
    return el;
  };

  const repaint = (filter) => {
    grid.innerHTML = '';
    if (filter === 'crew') {
      for (const c of CREW) grid.appendChild(decorateForHand(c, 'crew'));
      return;
    }
    for (const p of PATENTS) {
      if (p.type !== filter) continue;
      grid.appendChild(decorateForHand(p, 'patent'));
    }
  };

  // Subscribe to hand + rocket changes so the library tiles'
  // ✋ / 🛸 location markers update as the player moves cards
  // around. Storing the unsubs on the host element means
  // remounting the pane doesn't stack listeners.
  if (host._libUnsubs) host._libUnsubs.forEach((u) => u());
  const repaintActive = () => {
    const active = bar.querySelector('button.active');
    repaint(active ? active.dataset.type : types[0]);
  };
  host._libUnsubs = [
    onHandChange(repaintActive),
    onRocketChange(repaintActive),
  ];

  bar.querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      bar.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      repaint(b.dataset.type);
    };
  });
  repaint(types[0]);
}

// Legacy patent-card builder kept for now (unused after switch to
// renderCard; will be removed in a follow-up commit once nothing
// imports it). Pruning aggressively to keep the bundle small.
function legacyPatentCard(p) {
  const card = document.createElement('div');
  card.className = 'patent-card type-' + p.type;
  card.innerHTML = `
    <div class="pc-header">
      <span class="pc-type"></span>
      <span class="pc-name"></span>
    </div>
    <div class="pc-stats"></div>
    <p class="pc-blurb"></p>
  `;
  card.querySelector('.pc-type').textContent = p.type.toUpperCase();
  card.querySelector('.pc-name').textContent = p.name;
  card.querySelector('.pc-blurb').textContent = p.blurb;
  const stats = card.querySelector('.pc-stats');
  const rows = [];
  rows.push(`<span>Mass</span><strong>${p.mass}</strong>`);
  if (p.type === 'thruster') {
    rows.push(`<span>Thrust</span><strong>${p.thrust}</strong>`);
    rows.push(`<span>ISP</span><strong>${p.isp}</strong>`);
    if (p.power_req) rows.push(`<span>Power req</span><strong>${p.power_req}</strong>`);
  }
  if (p.type === 'reactor') {
    rows.push(`<span>Power</span><strong>${p.power}</strong>`);
    rows.push(`<span>Heat</span><strong>${p.heat}</strong>`);
  }
  if (p.type === 'radiator') {
    rows.push(`<span>Heat cap</span><strong>${p.heat_cap}</strong>`);
  }
  if (p.type === 'refinery') {
    rows.push(`<span>Water out</span><strong>${p.water_out}</strong>`);
  }
  if (p.type === 'robonaut') {
    rows.push(`<span>+Prospect</span><strong>${p.prospect_bonus}</strong>`);
  }
  if (p.type === 'lab' || p.type === 'generator') {
    rows.push(`<span>Science</span><strong>${p.science}</strong>`);
  }
  stats.innerHTML = rows.map((r) => `<div>${r}</div>`).join('');
  return card;
}

function renderMilestones() {
  const host = document.getElementById('browse-milestones');
  if (!host) return;
  host.innerHTML = '<ul class="ms-list"></ul>';
  const list = host.querySelector('ul');
  for (const m of MILESTONES) {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="ms-head">
        <strong></strong>
        <span class="ms-vp">+${m.vps} VP</span>
      </div>
      <p class="muted"></p>
    `;
    li.querySelector('strong').textContent = m.name;
    li.querySelector('p').textContent = m.blurb;
    list.appendChild(li);
  }
}

// Solo panel: stats + per-round actions when a game is running,
// "New game" button otherwise. Re-rendered on every solo state
// change via the soloOnChange listener wired in mountBrowse.
let _soloListenerHooked = false;
function renderSolo() {
  if (!_soloListenerHooked) {
    _soloListenerHooked = true;
    soloOnChange(() => {
      // Re-render only if the solo pane is currently visible; the
      // ship marker is updated separately.
      const panel = document.getElementById('browse-sidepanel');
      if (panel && panel.dataset.active === 'solo') paintSolo();
      syncSoloShipMarker();
    });
  }
  paintSolo();
}

function paintSolo() {
  const host = document.getElementById('solo-panel');
  if (!host) return;
  const s = soloState();
  if (!s) {
    host.innerHTML = `
      <p class="muted">A solo game pits one ship against the round
      clock. ${SOLO_CONFIG.STARTING_WATER} water, ${SOLO_CONFIG.OPS_PER_ROUND}
      operations per round, ${SOLO_CONFIG.MAX_ROUNDS} rounds,
      target ${SOLO_CONFIG.TARGET_VP} VP.</p>
      <div class="solo-actions">
        <button class="primary" id="solo-new" title="Start a new solo game">Start solo game</button>
        <button class="danger" id="sandbox-reset"
          title="Empty the hand, the rocket stack, and any board components">Reset sandbox</button>
      </div>
    `;
    host.querySelector('#solo-new').onclick = () => {
      soloNewGame();
      paintSolo();
    };
    host.querySelector('#sandbox-reset').onclick = () => {
      if (!confirm('Reset sandbox? This clears your hand, your rocket’s stack, and every component on the board.')) return;
      clearHand();
      rocketClearStack();
      // Future: clear factories / refineries / claimed sites as
      // those land in Stage 3.
      setStatus('Sandbox reset — hand and rocket stack cleared.');
    };
    return;
  }
  const here   = _activeData && _activeData.byId[s.ship.at];
  const target = s.pendingTargetId && _activeData && _activeData.byId[s.pendingTargetId];
  const ops    = Math.max(0, SOLO_CONFIG.OPS_PER_ROUND - s.turn);
  const claimedHere = here && s.claimed.includes(here.id);
  const canProspect = !!here && !here.isWaypoint && !s.gameOver
    && ops > 0 && !claimedHere && here.isLandable !== false;
  const moveCost = s.pendingPath ? s.pendingPath.totalBurns : null;
  const canMove = !s.gameOver && ops > 0 && moveCost != null && moveCost <= s.water;
  host.innerHTML = `
    <div class="solo-stats">
      <span>Round</span><strong>${s.round}/${SOLO_CONFIG.MAX_ROUNDS}</strong>
      <span>Ops</span><strong>${ops}/${SOLO_CONFIG.OPS_PER_ROUND}</strong>
      <span>Water</span><strong>${s.water}</strong>
      <span>Score</span><strong>${s.score}/${SOLO_CONFIG.TARGET_VP}</strong>
      <span>Claimed</span><strong>${s.claimed.length}</strong>
    </div>
    <p class="solo-here muted">At: <strong></strong></p>
    <p class="solo-target muted"></p>
    <div class="solo-actions">
      <button class="primary" id="solo-move" ${canMove ? '' : 'disabled'}>Move</button>
      <button id="solo-prospect" ${canProspect ? '' : 'disabled'}>Prospect</button>
      <button id="solo-end">End round</button>
    </div>
    ${s.gameOver ? '<p class="solo-end-banner"></p>' : ''}
    <details class="solo-log"><summary>Log</summary><ol></ol></details>
    <button id="solo-abandon" class="danger" style="margin-top:10px">Abandon</button>
  `;
  host.querySelector('.solo-here strong').textContent = here ? here.name : '—';
  const targetEl = host.querySelector('.solo-target');
  if (target && moveCost != null) {
    targetEl.innerHTML = `→ <strong></strong> (${moveCost} burns, ${s.pendingPath.segments.length} hops)`;
    targetEl.querySelector('strong').textContent = target.name;
  } else if (s.pendingTargetId && !s.pendingPath) {
    targetEl.textContent = `No route to ${target ? target.name : 'target'}.`;
  } else {
    targetEl.textContent = 'Tap a site on the map to plan a move.';
  }
  const log = host.querySelector('.solo-log ol');
  for (const line of s.log.slice(0, 30)) {
    const li = document.createElement('li');
    li.textContent = line;
    log.appendChild(li);
  }
  if (s.gameOver) {
    host.querySelector('.solo-end-banner').textContent =
      s.score >= SOLO_CONFIG.TARGET_VP ? '🏆 Victory!' : '⏱ Time up.';
  }
  host.querySelector('#solo-move').onclick = () => { soloCommitMove(); paintSolo(); syncSoloShipMarker(); };
  host.querySelector('#solo-prospect').onclick = () => { soloProspect(); paintSolo(); };
  host.querySelector('#solo-end').onclick = () => { soloEndRound(); paintSolo(); };
  host.querySelector('#solo-abandon').onclick = () => {
    if (confirm('Abandon this solo game? Progress is lost.')) {
      soloAbandon();
      paintSolo();
      syncSoloShipMarker();
    }
  };
}

function renderEvents() {
  const host = document.getElementById('browse-events');
  if (!host) return;
  host.innerHTML = '<ul class="ev-list"></ul>';
  const list = host.querySelector('ul');
  for (const e of POLITICS) {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="ev-head">
        <strong></strong>
        <span class="ev-kind"></span>
      </div>
      <p class="muted"></p>
    `;
    li.querySelector('strong').textContent = e.name;
    li.querySelector('.ev-kind').textContent = e.kind;
    li.querySelector('p').textContent = e.blurb;
    list.appendChild(li);
  }
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// Site count and edge count for debug surfaces.
export const STATS = {
  siteCount: Object.keys(SITES_BY_ID).length,
  patentCount: PATENTS.length,
  milestoneCount: MILESTONES.length,
  eventCount: POLITICS.length,
};
