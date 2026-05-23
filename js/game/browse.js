// Browse view: map + patent deck + milestones + events.
//
// Read-only, no engine dependency. Lets a user inspect Stage 2 data
// without needing to start a multiplayer game. Reachable from the
// topbar; also acts as the "preview" surface that Stage 3 will
// replace with the live game.

import { MapRenderer, LEO_ANCHOR } from './render.js';
import { loadPlannerMap } from './planner-map.js';
import { planRoute } from './planner-nav.js';
import {
  consumeMove, refundMove, getTurn, getMovesRemaining, onTurnChange,
  getEventForRoll, getSeasonForSlot, resetClock,
} from './turn-clock.js';
import { triggerEndTurn, openTurnClockModal, buildDie, rollDie } from './turn-clock-ui.js';
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
  getProspectorCards, getActiveProspectorId, setActiveProspector,
  clearActiveProspector, getActiveProspectorStats,
  isAfterburnEngaged, setAfterburn,
  getAqua, spendAqua, addAqua, onAquaChange,
} from './rocket.js';
import { canProspect, computeRaygunTargets } from './scan.js';
import {
  getDiscs, getDisc, placeDisc, removeDisc, resetDiscs,
  onChange as onDiscsChange,
} from './discs.js';
import { CREW } from '../../data/crew.js';
import { MILESTONES } from '../../data/glory.js';
import { POLITICS } from '../../data/politics.js';
import { SITES_BY_ID } from '../../data/sites.js';
import {
  renderCard, thrustVisual, attachTipsTo,
  REQUIREMENT_VIS, REQ_SUPPLIER_TYPE,
  svgSunChip, svgBallerinaChip,
} from './card-ui.js';
import {
  logAction, getActions, getHistory, popLastOfType,
  commitTurn as commitLogTurn, resetLog, onChange as onLogChange,
} from './mission-log.js';
import {
  awardChitForZone, revokeChitForZone, cashInChits, uncashChits,
  getChits, getVps, getChitVpValue, isZoneVisited, resetGlory,
  onChange as onGloryChange, ZONE_CHIT_VPS,
} from './glory.js';

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
    onRocketChange(refreshOpenSitePopup);
    onDiscsChange(syncDiscs);
    onDiscsChange(refreshOpenSitePopup);
    // Turn-clock changes (end-turn, consumeMove, refundMove)
    // shift per-turn budgets. Refresh any open site popup so
    // disabled labels like "Refueled this turn" flip back when
    // the turn advances.
    onTurnChange(refreshOpenSitePopup);
  }
  wireSidebar();
  wireHandStrip();
  renderMap();
}

// Sandbox hand strip wiring: drop target, slot rendering, +
// the grabber bar that lets the user drag the strip up to see
// more cards. Card-click opens the inspect modal instead of
// removing the slot directly - Discard lives in the modal.
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
  // preventDefault unconditionally on dragover - dataTransfer
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

      // Quick-action row appended as a sibling of the card so
      // it CAN'T be clipped by .card's overflow:hidden when it
      // floats above the card top edge on hover. The slot's
      // 1.18 hover-scale carries both the card and this row so
      // they grow together. Positioning + reveal handled in
      // CSS via .hand-slot:hover.
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
      wrap.appendChild(quick);

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

  // Stack button next to ✋ Hand: zooms the map to wherever the
  // rocket currently sits (so the sprite stays in view even after
  // the rocket has left LEO) AND pops the stack modal. Only falls
  // back to LEO when no rocket has been built yet - i.e. there's
  // no sprite to follow.
  const stackBtn = document.getElementById('hand-stack-open');
  if (stackBtn) stackBtn.addEventListener('click', () => {
    if (_renderer) {
      const stack = getRocketStack();
      const site = stack.length ? getRocketSite() : null;
      if (site && Number.isFinite(site.x) && Number.isFinite(site.y)) {
        _renderer.flyTo(site, 4);
      } else {
        _renderer.flyTo(LEO_ANCHOR, 4);
      }
    }
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

// Modals + the drag-ghost append to the live overlay root, which
// is the fullscreen element when one is active (e.g. the user
// pressed ⛶ on the map toolbar) and document.body otherwise.
// Anything appended outside the fullscreen root is invisible
// while the Fullscreen API is engaged - so a modal mounted in
// body would just silently not show up. The watcher below
// re-parents any open overlays on fullscreenchange so they
// follow the user in / out of fullscreen too.
function overlayRoot() {
  return document.fullscreenElement || document.body;
}
function mountOverlay(el) {
  overlayRoot().appendChild(el);
  return el;
}
document.addEventListener('fullscreenchange', () => {
  const root = overlayRoot();
  // Move every known overlay class into the new root so a modal
  // that was open when the user toggled fullscreen stays visible.
  // Selectors cover the card / fuel-tank / rocket-stack /
  // confirm / hazard / turn-clock modals + the drag ghost.
  const selectors = [
    '.card-modal-overlay',
    '.fuel-tank-overlay',
    '.confirm-modal-overlay',
    '.rocket-stack-overlay',
    '.hazard-confirm-overlay',
    '.drag-ghost',
    '.card-tip',
  ];
  for (const sel of selectors) {
    for (const el of document.querySelectorAll(sel)) {
      if (el.parentNode !== root) root.appendChild(el);
    }
  }
});

// Custom drag-image. The browser's default drag-image is a
// faded snapshot of the element with no animation; we replace
// it with a fixed-position clone that follows the pointer, casts
// a heavy drop shadow, and wiggles with spring-damped rotation
// driven by horizontal velocity. The native HTML5 drop event
// still handles the actual data transfer - this only changes
// the visual the user sees while dragging.
let _dragGhost = null;
let _dragGhostState = null;

function startCustomDragGhost(srcEl, ev) {
  endCustomDragGhost();
  // 1×1 transparent canvas. setDragImage on a freshly-constructed
  // <img src=data:…> raced the browser in Safari + Firefox -
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
  // user grabbed - feels less floaty than centring it.
  const offsetX = ev.clientX - rect.left;
  const offsetY = ev.clientY - rect.top;
  ghost.style.left = (ev.clientX - offsetX) + 'px';
  ghost.style.top  = (ev.clientY - offsetY) + 'px';
  mountOverlay(ghost);

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
  const cardEl = renderCard(card, {
    type: kind,
    onSupportClick: (kinds) => {
      close();
      openPatentsSupports(kinds);
    },
  });
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
  mountOverlay(overlay);
  // Tap the backdrop or press Escape to dismiss - no explicit ×
  // button. The card modal is small and the backdrop is the
  // obvious affordance.
  const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
}

// Inspect modal: enlarged copy of the clicked card with three
// actions - Discard (pop back to the deck), Exo produce (will
// need a factory location once Stage-3 builds them), and Add to
// stack (push onto the LEO rocket).
function openCardModal(card, kind, slotIdx) {
  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay';
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const panel = document.createElement('div');
  panel.className = 'card-modal-panel';
  const cardEl = renderCard(card, {
    type: kind,
    onSupportClick: (kinds) => {
      close();
      openPatentsSupports(kinds);
    },
  });
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
  sellBtn.title = 'Sell card - same as discard until the Stage-3 economy lands';
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
  mountOverlay(overlay);

  // Tap the backdrop or press Escape to dismiss - no explicit ×
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
  // Backdrop tracks panel state - visible whenever a pane is open
  // (CSS gates it behind the mobile breakpoint so desktop never
  // sees it).
  const backdrop = document.getElementById('browse-modal-backdrop');
  if (backdrop) backdrop.classList.toggle('hidden', !pane);
  // Render the pane lazily on first reveal.
  if      (pane === 'patents')    renderPatents();
  else if (pane === 'milestones') renderMilestones();
  else if (pane === 'events')     renderEvents();
  else if (pane === 'log')        renderMissionLog();
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

// Rocket position state. The sandbox rocket sprite is drawn at
// whichever site the rocket currently occupies; defaults to LEO
// when no id is stored. Persisted so a reload doesn't teleport
// the rocket back to LEO mid-journey. _plannedRoute mirrors the
// segments most recently passed to the renderer so moveRocket()
// can consume them turn-by-turn, and _moveSnapshot lets the 🛸
// toggle's undo restore the previous position + route.
const STORAGE_ROCKET_SITE  = 'hf-sandbox-rocket-site';
const STORAGE_ROCKET_TRAIL = 'hf-sandbox-rocket-trail';
const STORAGE_ROCKET_ROUTE = 'hf-sandbox-planned-route';
const STORAGE_ROUTE_PRIORITY = 'hf-sandbox-route-priority';
// Routing metric priority. 'turns' minimizes turn-ends first (the
// snap-to-adjacent default); 'burns' minimizes water spend first
// (favours long Hohmann coasts at the cost of more turns). User-
// togglable via the ⚙ gear in the site popup; persisted so the
// pick survives reloads.
let _routePriority = (() => {
  try {
    const s = localStorage.getItem(STORAGE_ROUTE_PRIORITY);
    return s === 'burns' || s === 'turns' ? s : 'turns';
  } catch { return 'turns'; }
})();
function setRoutePriority(mode) {
  if (mode !== 'turns' && mode !== 'burns') return;
  _routePriority = mode;
  try { localStorage.setItem(STORAGE_ROUTE_PRIORITY, mode); } catch {}
}
function routeMetricPriority() {
  return _routePriority === 'burns'
    ? ['burns', 'turns', 'hazards', 'radHazards']
    : ['turns', 'burns', 'hazards', 'radHazards'];
}
let _rocketSiteId = (() => {
  try { return localStorage.getItem(STORAGE_ROCKET_SITE) || null; }
  catch { return null; }
})();
// Planned route (turn-tagged segments) persists across reloads so
// a multi-turn plan survives the player putting the game down for
// a day and picking it back up. Reading it back is just JSON; we
// validate-on-use by checking that every endpoint resolves in the
// active data set before handing it to the renderer.
let _plannedRoute = (() => {
  try {
    const s = localStorage.getItem(STORAGE_ROCKET_ROUTE);
    const parsed = s ? JSON.parse(s) : null;
    return Array.isArray(parsed) && parsed.length ? parsed : null;
  } catch { return null; }
})();
let _moveSnapshot = null;
let _rocketTrail = (() => {
  try {
    const s = localStorage.getItem(STORAGE_ROCKET_TRAIL);
    return s ? JSON.parse(s) : [];
  } catch { return []; }
})();
// True while the rocket's animating along a path; blocks a second
// move/undo from racing with the in-flight tween.
let _rocketAnimating = false;

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
        <span id="aqua-chip" class="map-aqua-chip"
          title="Aqua balance - spend 4 aqua per hazard to bypass rolls, or convert 1:1 to water at LEO">
          💎 <strong id="aqua-chip-balance">${getAqua()}</strong>
        </span>
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
        <button id="game-settings" title="Game settings"
          aria-label="Game settings">⚙</button>
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
          <strong id="dbg-zoom">-</strong>
        </div>
        <div class="dbg-row">
          <span>FPS</span>
          <strong id="dbg-fps">-</strong>
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
  // Global game-settings gear on the toolbar. Opens the same
  // settings modal accessible from per-popup affordances; right
  // now only route options live there but future settings (UI
  // density, accessibility toggles, persistent dev flags) will
  // land in the same modal.
  host.querySelector('#game-settings').addEventListener('click', () => {
    openGameSettingsModal();
  });
  // Turn clock + rocket-movement controls. End turn pops a confirm
  // when the player still has unspent budget; if they confirm and
  // the new slot is an event, openTurnClockModal animates the d6.
  // Move rocket is a placeholder until the rocket-movement engine
  // lands - it just consumes the per-turn move budget for now so
  // the end-turn confirm reflects the spend.
  host.querySelector('#turn-end').addEventListener('click', async () => {
    // Capture the previous slot BEFORE advancing so the modal can
    // animate the Sunspot Cube sliding from old → new instead of
    // teleporting. If the player cancels the confirm, nothing
    // moved, so we skip the modal entirely.
    const prevTurn = getTurn();
    const result = await triggerEndTurn();
    if (!result) return;
    // Sunspot Cube landed on an event slot - apply the d6 outcome
    // (VP credit / debit + flavour log line) BEFORE we commit the
    // mission log so the event appears in this turn's record.
    if (result.event) {
      applyEventDieEffect(result.event);
    }
    // Commit the now-completed turn into the per-game history and
    // clear the live log for the next turn.
    commitLogTurn({
      turn: prevTurn,
      round: result.round,
      event: result.event,
    });
    // Wipe this turn's cyan rocket trail - each turn starts with a
    // clean slate so the ribbon reads as "where I went THIS turn",
    // not "everywhere I've ever been". Position + planned route
    // both stay put.
    _rocketTrail = [];
    persistRocketTrail();
    if (_renderer) _renderer.setRocketTrail(null);
    // A new turn refreshes per-turn operation budgets: move,
    // refuel-per-site, future ops. Any open site popup is now
    // stale (its disabled / "refueled this turn" labels were
    // computed from the previous turn's state); refresh it.
    refreshOpenSitePopup();
    openTurnClockModal({
      animateFrom: prevTurn,
      rolling: result.event ? { value: result.event.dieRoll } : null,
    });
  });
  host.querySelector('#turn-tracker').addEventListener('click', () => {
    openTurnClockModal();
  });
  // HF4: a turn is "operation, then move" OR "move, then operation"
  // - never split around the move. So the move stays reversible right
  // up until end-turn commits. The 🛸 button toggles between "Move"
  // and "↩ Undo move" based on whether the per-turn move budget has
  // been spent. End turn refills the budget, which calls back here
  // via onTurnChange and resets the button to "Move".
  const moveBtn = host.querySelector('#turn-move-rocket');
  function refreshMoveButton() {
    if (!moveBtn) return;
    const remaining = getMovesRemaining();
    if (remaining > 0) {
      moveBtn.textContent = '🛸';
      moveBtn.title = 'Move the rocket one step along its planned route';
      moveBtn.setAttribute('aria-label', 'Move rocket');
      moveBtn.dataset.state = 'move';
    } else {
      moveBtn.textContent = '↩ 🛸';
      moveBtn.title = 'Undo move (operations can happen before OR after the move, not in the middle)';
      moveBtn.setAttribute('aria-label', 'Undo move');
      moveBtn.dataset.state = 'undo';
    }
  }
  refreshMoveButton();
  onTurnChange(refreshMoveButton);
  moveBtn.addEventListener('click', () => {
    if (moveBtn.dataset.state === 'undo') undoRocketMove();
    else                                  moveRocket();
  });
  // Aqua balance chip - live-updates on any spend / income so the
  // player sees the number tick down when a hazard bypass or an
  // aqua → water transfer commits.
  const aquaChipBal = host.querySelector('#aqua-chip-balance');
  if (aquaChipBal) {
    const refreshAqua = () => { aquaChipBal.textContent = String(getAqua()); };
    refreshAqua();
    onAquaChange(refreshAqua);
  }
  host.querySelector('#dbg-close').addEventListener('click', () => {
    host.querySelector('#map-debug').classList.add('hidden');
    if (_renderer) _renderer.setOption('debug', false);
  });
  wireSearch(host);
  // Toolbar height drives where the side panel starts (panel is
  // top: var(--toolbar-h) so it sits flush below the toolbar
  // regardless of whether the toolbar has wrapped to a second row
  // on narrow viewports). Publish the measured height to the
  // browse shell so the CSS variable is in-scope for the sidepanel.
  const toolbarEl = host.querySelector('.map-toolbar');
  const shellEl   = host.closest('.browse-shell') || host;
  if (toolbarEl && shellEl && typeof ResizeObserver !== 'undefined') {
    const publishToolbarHeight = () => {
      const h = toolbarEl.getBoundingClientRect().height;
      shellEl.style.setProperty('--toolbar-h', `${Math.ceil(h)}px`);
    };
    publishToolbarHeight();
    new ResizeObserver(publishToolbarHeight).observe(toolbarEl);
  }
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
  // modal when .is-open is set. Desktop ignores all of this - the inline
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
    syncDiscs();
    // Push any persisted trail back into the renderer so a reload
    // mid-journey still shows the cyan ribbon for where the rocket
    // has already been.
    if (_rocketTrail && _rocketTrail.length) {
      _renderer.setRocketTrail(_rocketTrail);
    }
    // Restore the multi-turn planned route. Validate every segment
    // resolves in the active data set; if the dataset shape changed
    // (e.g. planner-map regeneration) drop the route so we don't
    // hand the renderer dangling ids that would draw to (0, 0).
    if (_plannedRoute && _plannedRoute.length) {
      const allValid = _plannedRoute.every((seg) =>
        _activeData.sites.find((s) => s.id === seg.from) &&
        _activeData.sites.find((s) => s.id === seg.to)
      );
      if (allValid) {
        _renderer.setRoute(_plannedRoute);
        const first = _plannedRoute[0];
        const last  = _plannedRoute[_plannedRoute.length - 1];
        _renderer.setRouteEndpoints(first.from, last.to);
        const fromSite = _activeData.sites.find((s) => s.id === first.from);
        const destSite = _activeData.sites.find((s) => s.id === last.to);
        _routeFrom = fromSite || null;
        _routeTo   = destSite || null;
        const clearBtn = document.getElementById('route-clear');
        if (clearBtn) clearBtn.hidden = false;
        if (destSite) {
          const burns = _plannedRoute.reduce((s, x) => s + (x.burns || 1), 0);
          const turns = _plannedRoute.reduce((m, x) => Math.max(m, x.turn || 1), 1);
          setStatus(
            `🛸 Resumed route to <strong>${esc(destSite.name)}</strong>: `
            + `<strong class="big">${burns}</strong> burns over `
            + `<strong>${turns}</strong> turn${turns === 1 ? '' : 's'}.`
          );
        }
      } else {
        _plannedRoute = null;
        persistPlannedRoute();
      }
    }
  } catch (err) {
    canvas.innerHTML = `<div class="map-loading error">Map failed to load: ${err.message}</div>`;
  }
}

// Paint the sandbox rocket on the map at LEO. Position is a
// fixed world-space coord that visually reads as "above Earth"
// on the cleaned-up zone-band layout. Colour stays yellow for
// now - multiplayer Stage 3 will pick from the 5-colour palette
// per player. canFly is recomputed from rocket.js on every
// rocket-state change.
// Centered modal that shows the rocket's stack - replaces the
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

  // Engagement is a transient UI flag - the player presses
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
    // the stack contributes - used both by isRocketActive() and
    // by renderCard() to mark each support chip ✓.
    const supplied = new Set();
    for (const s of stack) {
      if (s.id === activeId) continue;
      const c = lookup(s.id);
      if (!c) continue;
      const sup = (c.faces && c.faces.primary && c.faces.primary.supplies) || c.supplies || [];
      for (const k of sup) supplied.add(k);
    }
    // Engagement is meaningless when supports aren't satisfied -
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
      ? '<p class="rocket-status ok">✓ Active - rocket can move.</p>'
      : `<p class="rocket-status bad">🚫 Inactive - ${esc(r.reason)}.</p>
         ${r.missing.length
           ? `<ul class="rocket-issues">${r.missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>`
           : ''}`;

    // Totals row. Reorganized to surface the modified-thrust
    // triangle on the LEFT as the headline visual (the player
    // reads thrust-vs-wet-mass off it at a glance), with the
    // numeric cells stacked next to it. Fuel +/- buttons are
    // gone - refueling is the legitimate way to add water now;
    // the water droplet sits inside the wet-mass cell so the
    // current fuel value reads alongside the mass it's pushing.
    const fmt = (n) => Number.isFinite(n) ? (Math.round(n * 100) / 100) : '-';
    const tank = getTankWater();
    const tankMax = getTankMax();
    const fuelCapForRocket = Math.max(0, 32 - (totals.dryMass || 0));
    const wcLine = thrStats && thrStats.weightClassMod !== 0
      ? `<small>${thrStats.weightClass} ${thrStats.weightClassMod > 0 ? '+' : ''}${thrStats.weightClassMod}</small>`
      : (thrStats ? `<small>${thrStats.weightClass}</small>` : '');
    const modifierLines = thrStats && thrStats.modifiers.length
      ? thrStats.modifiers.map((m) => {
          if (m.kind === 'thrust') return `${m.delta > 0 ? '+' : ''}${m.delta} thrust from ${m.from}`;
          if (m.kind === 'fuel')   return `×${m.mult} fuel from ${m.from}`;
          return '';
        }).filter(Boolean).join(' · ')
      : 'no modifiers';
    const thrustHtml = thrStats
      ? `<div class="rocket-totals-cell"
              data-tip="Thrust = base ${fmt(thrStats.baseThrust)} ${modifierLines !== 'no modifiers' ? '+ ' + modifierLines : ''}. Net thrust must be ≥ wet mass to lift."
              title="Modified thrust breakdown">
           <span class="lbl">Thrust</span>
           <strong class="${thrStats.canLift ? 'ok' : 'bad'}">${fmt(thrStats.thrust)}</strong>
           ${thrStats.thrust !== thrStats.baseThrust
              ? `<small>(base ${fmt(thrStats.baseThrust)})</small>` : ''}
           ${wcLine}
         </div>
         <div class="rocket-totals-cell"
              data-tip="Fuel per burn = ${fmt(thrStats.fuel)} water per move."
              title="Fuel per burn">
           <span class="lbl">Fuel / burn</span>
           <strong>${thrStats.fuel != null ? fmt(thrStats.fuel) : '-'}</strong>
           ${thrStats.fuel != null && thrStats.fuel !== thrStats.baseFuel
              ? `<small>(base ${fmt(thrStats.baseFuel)})</small>` : ''}
         </div>`
      : '';
    // Afterburn toggle - only shown when the active thruster has
    // an afterburn capability. Engaging spends fuel up front, so
    // the click handler runs through a confirm.
    const afterburnHtml = (thrStats && thrStats.afterburnAvailable)
      ? `<button type="button" class="rocket-afterburn-btn ${thrStats.afterburnEngaged ? 'is-engaged' : ''}"
           id="rocket-afterburn"
           title="${thrStats.afterburnEngaged
             ? 'Afterburn engaged this turn - tap to disengage'
             : 'Engage afterburn: spends fuel for bonus thrust this turn'}">
           🔥 Afterburn ${thrStats.afterburnEngaged ? 'ON' : 'OFF'}
         </button>` : '';
    const totalsHtml = `
      <div class="rocket-totals">
        ${thrStats ? '<div class="rocket-totals-headliner" id="rocket-thrust-visual"></div>' : ''}
        <div class="rocket-totals-grid">
          <div class="rocket-totals-cell">
            <span class="lbl">Cards</span><strong>${totals.count}</strong>
          </div>
          <div class="rocket-totals-cell">
            <span class="lbl">Dry mass</span><strong>${totals.dryMass}</strong>
          </div>
          <div class="rocket-totals-cell rocket-wetmass-cell"
               role="button" tabindex="0"
               data-tip="Tap to open the fuel-tank view (max wet mass 32)"
               title="Tap to open the fuel-tank view (max wet mass 32)">
            <span class="lbl">Wet mass</span>
            <strong class="${thrStats && !thrStats.canLift ? 'bad' : ''}">${totals.wetMass}<small>/32</small></strong>
            <span class="rocket-water-readout" title="Water tank (refuel at hydrated sites)">
              💧 <b>${tank}</b><em>/${fuelCapForRocket}</em>
            </span>
          </div>
          <div class="rocket-totals-cell">
            <span class="lbl">Min rad-hard</span>
            <strong>${totals.minRadHard != null ? totals.minRadHard : '-'}</strong>
          </div>
          ${thrustHtml}
          ${afterburnHtml ? `<div class="rocket-totals-cell rocket-afterburn-cell">${afterburnHtml}</div>` : ''}
        </div>
      </div>
    `;

    // Locate / select-current-site buttons (top of the header).
    // "Find rocket" pans the camera to the sprite without
    // opening a popup; "Select site" (or "Select node" when the
    // rocket is parked on a routing waypoint) closes the modal,
    // pans the camera, and pops the site popup so the player can
    // immediately fire prospect / refuel / route from the
    // current location without hunting for it on the map.
    const here = getRocketSite();
    const hereIsSite = here && !here.isWaypoint
      && !['lagrange', 'burn', 'hohmann', 'decorative', 'radhaz'].includes(here.type);
    const hereLabel = hereIsSite ? 'Select site' : 'Select node';
    const hereDisabled = !here ? 'disabled' : '';
    body.innerHTML = `
      <div class="rocket-stack-header">
        <div class="rocket-stack-title-row">
          <h2 class="rocket-stack-title">🚀 LEO Rocket</h2>
          <div class="rocket-stack-locate">
            <button type="button" class="popup-btn popup-btn-secondary"
              id="rocket-find" ${hereDisabled}
              title="Pan the map to the rocket sprite">📍 Find rocket</button>
            <button type="button" class="popup-btn popup-btn-secondary"
              id="rocket-select-here" ${hereDisabled}
              title="Open the popup for the site / node the rocket is on">🎯 ${hereLabel}</button>
          </div>
        </div>
        ${totalsHtml}
        <div id="rocket-fuel-strip" class="rocket-fuel-strip"></div>
        ${status}
      </div>
      <div id="rocket-stack-cards">
        <div class="rocket-stack-row thrusters" id="rocket-stack-thrusters"></div>
        <div class="rocket-stack-row others" id="rocket-stack-others"></div>
      </div>
    `;
    panel.appendChild(body);

    // Find / select wiring.
    const findBtn = body.querySelector('#rocket-find');
    if (findBtn) findBtn.addEventListener('click', () => {
      if (!here || !_renderer) return;
      close();
      _renderer.flyTo(here, 4);
    });
    const selectBtn = body.querySelector('#rocket-select-here');
    if (selectBtn) selectBtn.addEventListener('click', () => {
      if (!here || !_renderer) return;
      close();
      _renderer.flyTo(here, 4);
      onSiteSelect(here);
    });

    // Fuel-strip diagram. Mirrors the published Net Thrust track:
    // cells 1..32 coloured by weight class (WISP / PROBE / SCOUT /
    // TRANSPORT / TUG) with chits drawn for the rocket's current
    // dry-mass + wet-mass positions. Each cell is hoverable for
    // its weight-class modifier. Future iterations can wire drag
    // to relocate chits + react to factory refuel patterns.
    const stripHost = body.querySelector('#rocket-fuel-strip');
    if (stripHost) buildFuelStrip(stripHost, totals);

    // Afterburn toggle. Confirms before engaging (spends fuel up
    // front per the rulebook's "Afterburn (+ thrust for 2 fuel
    // steps shown)" cost). Disengaging is free.
    const abBtn = body.querySelector('#rocket-afterburn');
    if (abBtn && thrStats) {
      abBtn.addEventListener('click', async () => {
        if (thrStats.afterburnEngaged) {
          setAfterburn(false);
          logAction({ type: 'afterburn', icon: '🔥', summary: 'Afterburn disengaged', undoable: false });
          return;
        }
        // Confirm. Default afterburn cost = 2 water tanks (the
        // "2 fuel steps shown" wording in the rulebook). Bail
        // when the tank can't cover it.
        const cost = 2;
        if (getTankWater() < cost) {
          setStatus(`Afterburn needs ${cost} water; tank has ${getTankWater()}.`);
          return;
        }
        const ok = await confirmModal({
          title: '🔥 Engage afterburn?',
          body: `Spends ${cost} water now for a +${(thrStats.card?.faces?.primary?.afterburn) || 1} `
            + `thrust boost this turn. Disengage manually next turn.`,
          yes: 'Engage',
          no: 'Cancel',
        });
        if (!ok) return;
        removeFuel(cost);
        setAfterburn(true);
        logAction({
          type: 'afterburn',
          icon: '🔥',
          summary: `Afterburn engaged (-${cost} water)`,
          undoable: false,
        });
      });
    }

    // "Modified final" thrust triangle - shows the active
    // thruster with modifier-applied thrust + fuel numbers
    // baked in (instead of the base values painted on the
    // card). Reuses card-ui.thrustVisual via a synthetic face
    // so the silhouette + arrow / droplet idiom is identical
    // to the cards.
    const thrustHost = body.querySelector('#rocket-thrust-visual');
    if (thrustHost && thrStats) {
      const card = PATENTS_BY_ID[thrStats.cardId] || null;
      const baseFace = (card && card.faces && card.faces.primary) || card || {};
      const syntheticFace = {
        ...baseFace,
        thrust: thrStats.thrust,
        fuel:   thrStats.fuel,
        // Keep the original afterburn / fuelType so the icons
        // (🔥 / 💧 / 🪨) stay accurate; only thrust + fuel are
        // overridden with the modified numbers.
      };
      // Build per-element breakdown text so tapping the 11 inside
      // the pink circle pops "11 = 6 base + 3 reactor mod + 2
      // WISP mass class" - the exact "where did each number come
      // from" trail the player wants. Fuel + afterburn glyphs get
      // their own tap-tips below.
      const thrustParts = [`${fmt(thrStats.baseThrust)} base`];
      const fuelParts   = [`${fmt(thrStats.baseFuel)} base`];
      for (const m of thrStats.modifiers) {
        if (m.kind === 'thrust') {
          thrustParts.push(`${m.delta > 0 ? '+' : ''}${fmt(m.delta)} ${m.from}`);
        } else if (m.kind === 'fuel') {
          fuelParts.push(`×${fmt(m.mult)} ${m.from}`);
        }
      }
      const breakdown = {
        thrust: `Thrust ${fmt(thrStats.thrust)} = ${thrustParts.join(' ')}`,
        fuel:   `Fuel per burn ${fmt(thrStats.fuel)} = ${fuelParts.join(' ')}`,
      };
      const abVal = baseFace.afterburn;
      if (Number.isFinite(abVal) && abVal > 0) {
        breakdown.afterburn = thrStats.afterburnEngaged
          ? `🔥 Afterburn ENGAGED - +${abVal} thrust this turn (cost 2 water already spent)`
          : `🔥 Afterburn: spend 2 water for +${abVal} thrust this turn`;
      }
      const tv = thrustVisual(card || {}, syntheticFace, { breakdown });
      // Wrap-level tip too, for tapping the triangle outside any
      // specific element (whitespace inside the SVG).
      tv.dataset.tip = `${breakdown.thrust}. ${breakdown.fuel}.`;
      thrustHost.appendChild(tv);
      // Wire the [data-tip] hover + tap-to-show tooltips on the
      // freshly-inserted SVG so clicking the thrust circle / fuel
      // droplet / afterburn flame pops the per-element breakdown.
      attachTipsTo(tv);
    }

    // Wet-mass cell is clickable: pops the fuel-tank visual in
    // its "view current state" mode (no animation - fromWater
    // omitted defaults to the live tank reading).
    const wmCell = body.querySelector('.rocket-wetmass-cell');
    if (wmCell) {
      const openTank = () => openFuelTankModal();
      wmCell.addEventListener('click', openTank);
      wmCell.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTank(); }
      });
    }

    // Engage button: greyed out until supports are satisfied; tap
    // to ignite the moving-rocket animation. Lives in the pinned
    // header so it stays on screen even on a tall stack.
    const engageBtn = document.createElement('button');
    engageBtn.type = 'button';
    engageBtn.className = 'rocket-engage' + (engaged ? ' is-engaged' : '');
    engageBtn.disabled = !r.active;
    engageBtn.textContent = engaged && r.active
      ? '🔥 Engaged - rocket is moving!'
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

    // Pre-compute the set of kinds the active thruster requires -
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
      // the rest of the stack - passing `supplied` for others would
      // mark chips ✓ that aren't actually contributing to flight.
      // Wire support-chip taps so the player can jump straight
      // from "this thruster needs X" to the library view of every
      // card that supplies X. We close the rocket-stack modal
      // first so the patents pane comes up on a clean surface.
      const cardOpts = { type: slot.kind || 'patent' };
      if (isThruster && slot.id === activeId) cardOpts.supplied = supplied;
      cardOpts.onSupportClick = (kinds) => {
        close();
        openPatentsSupports(kinds);
      };
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
      // Prospector toggle - same idiom as the thruster activator.
      // Cards qualify when their active face carries a missile /
      // raygun / buggy property. Clicking sets THIS card as the
      // active prospector for the turn.
      const prospKind = (() => {
        const f = (card.faces && card.faces.primary) || card;
        const props = f.properties || [];
        for (const k of ['raygun', 'missile', 'buggy']) {
          if (props.some((p) => p.key === k && p.value)) return k;
        }
        return null;
      })();
      if (prospKind) {
        const activeProspId = getActiveProspectorId();
        const isActiveProsp = slot.id === activeProspId;
        const glyph = { missile: '🚀', raygun: '🔫', buggy: '🛺' }[prospKind];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'rocket-activate'
          + (isActiveProsp ? ' is-active' : '');
        btn.textContent = isActiveProsp
          ? `${glyph} Active prospector`
          : `Set as ${prospKind} prospector`;
        btn.disabled = isActiveProsp;
        btn.addEventListener('click', () => setActiveProspector(slot.id));
        actions.appendChild(btn);
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

  mountOverlay(overlay);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
}
let _rocketModalUnsub = null;

// Resolve the site the rocket is currently sitting on. Falls back
// to LEO when nothing is stored (fresh session) or when the stored
// id no longer resolves (data set changed). Side-effects: clears
// a stale stored id so subsequent calls don't keep retrying it.
// Glory + log glue used by moveRocket / undoRocketMove. Kept
// in browse.js so glory.js doesn't need to know site shapes.
function isLeoSite(site) {
  return !!site && site.type === 'lagrange' && site.name === 'LEO';
}

// Hazard classification. A node is a "hazard" when entering it
// forces a survival roll (or 4 aqua to bypass). Three flavours
// today, all drawn with their own glyph in render.js:
//   - explicit hazard flag → ☠ skull (burn / lagrange nodes
//     flagged by the planner JSON's `hazard:true`)
//   - radhaz waypoint type → ☢ radiation trefoil
//   - venus waypoint type  → 🪂 aerobrake corridor
// Returns the glyph + a short label so the confirm modal can list
// what the player is about to fly through.
const HAZARD_COST_PER = 4;
function classifyHazard(site) {
  if (!site) return null;
  if (site.type === 'radhaz') return { glyph: '☢', label: 'Radiation hazard' };
  if (site.type === 'venus')  return { glyph: '🪂', label: 'Aerobrake corridor' };
  if (site.hazard)            return { glyph: '☠', label: 'Hazard node' };
  return null;
}
function isHazardSite(site) {
  return classifyHazard(site) !== null;
}

// Walk every endpoint a route's turn-1 segments would touch,
// collecting the distinct hazard sites along the way. We check
// only `to` endpoints (the rocket is leaving `from` and arriving
// at `to`, so the starting node is already paid-for) plus any
// shared intermediate node, deduped by id so a hazard touched by
// two adjacent segments doesn't double-charge.
function routeHazards(segments) {
  if (!_activeData || !segments || !segments.length) return [];
  const seen = new Set();
  const out = [];
  for (const seg of segments) {
    const site = _activeData.sites.find((x) => x.id === seg.to);
    if (!site) continue;
    const h = classifyHazard(site);
    if (!h) continue;
    if (seen.has(site.id)) continue;
    seen.add(site.id);
    out.push({ site, ...h });
  }
  return out;
}

// Once-per-turn flag: a move that was paid-out or rolled for at
// a hazard cannot be undone. Persisted so a reload mid-turn
// preserves the lockout; cleared on end-turn via onTurnChange.
const STORAGE_HAZARDOUS_MOVE = 'hf-sandbox-hazardous-move';
let _lastMoveHazardous = (() => {
  try { return localStorage.getItem(STORAGE_HAZARDOUS_MOVE) === '1'; }
  catch { return false; }
})();
function setHazardousMove(on) {
  _lastMoveHazardous = !!on;
  try {
    if (_lastMoveHazardous) localStorage.setItem(STORAGE_HAZARDOUS_MOVE, '1');
    else                    localStorage.removeItem(STORAGE_HAZARDOUS_MOVE);
  } catch { /* private mode */ }
}
// End-of-turn always clears the lockout - a fresh turn refunds
// the move budget too, but the hazardous flag stays scoped to
// the turn that flew through the hazard.
onTurnChange(() => {
  if (getMovesRemaining() > 0 && _lastMoveHazardous) setHazardousMove(false);
});

// Three-button modal for the "your route crosses hazards" prompt.
// Resolves to one of:
//   'pay'    - player pays HAZARD_COST_PER × N aqua to bypass
//   'roll'   - player rolls a d6 per hazard, no undo allowed
//   'cancel' - back to planning; move not consumed
// Pay button is disabled (but still rendered, with a help line)
// when the balance can't cover the bill. The wording leans hard
// on "cannot be undone" because the rulebook commits the dice as
// soon as they hit the table - same idiom here.
function hazardConfirmModal(hazards) {
  return new Promise((resolve) => {
    document.querySelector('.confirm-modal-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'card-modal-overlay confirm-modal-overlay hazard-confirm-overlay';
    const close = (val) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close('cancel'); });
    const onKey = (e) => {
      if (e.key === 'Escape') close('cancel');
    };
    document.addEventListener('keydown', onKey);

    const n = hazards.length;
    const cost = n * HAZARD_COST_PER;
    const have = getAqua();
    const canPay = have >= cost;
    const list = hazards.map((h) =>
      `<li><span class="haz-glyph">${h.glyph}</span> `
      + `${esc(h.site.name || h.label)} <em class="muted">${esc(h.label)}</em></li>`
    ).join('');

    const panel = document.createElement('div');
    panel.className = 'turn-confirm-panel hazard-confirm-panel';
    panel.innerHTML = `
      <h3>⚠ Hazard zone ahead</h3>
      <p>Your planned route passes through
        <strong>${n}</strong> hazard${n === 1 ? '' : 's'}:</p>
      <ul class="hazard-list">${list}</ul>
      <p class="hazard-warning">
        <strong>Whatever you pick, this move CANNOT be undone</strong>
        - hazard rolls and aqua spends commit the moment the dice
        leave the cup. End the turn to clear the lockout.
      </p>
      <div class="hazard-cost-row">
        <span>💎 Aqua balance: <strong>${have}</strong></span>
        <span>Bypass cost: <strong>${cost}</strong>
          <em class="muted">(${HAZARD_COST_PER}/hazard)</em></span>
      </div>
      <div class="turn-confirm-actions hazard-actions">
        <button type="button" class="popup-btn primary" data-act="pay"
          ${canPay ? '' : 'disabled'}
          title="${canPay ? 'Spend ' + cost + ' aqua to skip the rolls' : 'Not enough aqua to bypass all hazards'}">
          💎 Pay ${cost} aqua to bypass
        </button>
        <button type="button" class="popup-btn" data-act="roll"
          title="Roll a d6 for each hazard. Cannot be undone.">
          🎲 Roll ${n} d6 (no undo)
        </button>
        <button type="button" class="popup-btn" data-act="cancel"
          title="Return to planning; no move spent">
          ✕ Cancel move
        </button>
      </div>
      ${canPay ? '' : '<p class="muted hazard-need-aqua">Pay disabled - need '
        + (cost - have) + ' more aqua. Roll or cancel instead.</p>'}
    `;
    for (const b of panel.querySelectorAll('button[data-act]')) {
      b.addEventListener('click', () => close(b.dataset.act));
    }
    overlay.appendChild(panel);
    mountOverlay(overlay);
  });
}

// Small info modal used when the player tries to undo a hazardous
// move. Single OK button; the lockout is informational only.
function blockedUndoModal() {
  return confirmModal({
    title: '⚠ Move locked',
    body: 'This turn\'s move flew through a hazard spot. '
      + 'Hazard rolls and aqua bypasses commit the move - it '
      + 'cannot be undone. End the turn to start fresh.',
    yes: 'OK',
    no: '',
  });
}

// Sunspot Cube d6 events. Rules text + lookup live in turn-clock.js
// (single source of truth - the tracker modal reads the same table).
// **Sandbox mode**: we DO NOT apply the event to game state. The
// d6 still rolls so the player sees what the cube would have
// triggered at the table, but no decks rotate, no cards
// decommission, no Glitch disks get placed. Log entries are
// prefixed "Would fire:" to keep that distinction obvious. When
// the engine ships (Stage 3+) the application path goes here.
function applyEventDieEffect(event) {
  if (!event || typeof event.dieRoll !== 'number') return;
  const season = getSeasonForSlot(event.turn);
  const e = getEventForRoll(event.dieRoll, season && season.name);
  if (!e) return;
  logAction({
    type: 'event_d6',
    icon: e.icon,
    summary: `Would fire: ${e.name} (d6 = ${event.dieRoll}) - ${e.text}`,
    undoable: false,
    data: {
      dieRoll: event.dieRoll,
      eventName: e.name,
      season: season && season.name,
      applied: false,
    },
  });
}

// Prospect roll. The site's `siteSize` from the planner data
// encodes the difficulty as "<n><spectral>" (e.g. "9H", "11C",
// "1S"); we parse the leading integer as the prospect threshold.
// Falls back to a class-letter -> number map when siteSize is
// absent (the curated SITES table uses A/B/C/D letters).
//
// Rules: roll 1d6. If roll <= threshold, SUCCESS - player's
// colour disc lands over the site (claim marker). If roll >
// threshold, FAIL - a red disc lands (site exhausted, can't be
// re-prospected in this sandbox session until the player
// manually clears the disc).
const CLASS_TO_NUMBER = { A: 3, B: 5, C: 7, D: 9 };
function siteProspectThreshold(site) {
  if (!site) return 4;
  const ss = site.siteSize;
  if (typeof ss === 'string') {
    const m = ss.match(/^(\d+)/);
    if (m) return Math.max(1, Math.min(11, parseInt(m[1], 10)));
  }
  const cls = String(site.class || '').toUpperCase();
  if (cls in CLASS_TO_NUMBER) return CLASS_TO_NUMBER[cls];
  return 4;
}

// Refueling at a hydrated site. Two distinct refining sources
// per the HF4 rules:
//
//   1. A Refinery card (card.type === 'refinery') with its
//      supports met: a FLAT +7 water per op. Refineries are
//      dedicated processing plants, not water-rated rigs.
//
//   2. An active ISRU rig (the prospector with an ISRU property,
//      until dedicated refinery support lands in Stage 3): yield
//      = site number - ISRU + 1. The site number is the same
//      value the prospect roll checks against.
//
// Either path needs the rocket parked ON the site and the site's
// number > 0. The refinery path is preferred when both are
// available because it produces more water (7 > typical formula).
// One refining op per (turn, site) so a player can't strip-mine.
const STORAGE_REFUEL_LOG = 'hf-sandbox-refuel-log';   // {turn: number, sites: [id]}
function getRefuelLog() {
  try {
    const s = localStorage.getItem(STORAGE_REFUEL_LOG);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}
function markRefueledThisTurn(siteId) {
  const turn = getTurn();
  let log = getRefuelLog();
  if (!log || log.turn !== turn) log = { turn, sites: [] };
  if (!log.sites.includes(siteId)) log.sites.push(siteId);
  try { localStorage.setItem(STORAGE_REFUEL_LOG, JSON.stringify(log)); } catch {}
}
function hasRefueledThisTurn(siteId) {
  const log = getRefuelLog();
  if (!log || log.turn !== getTurn()) return false;
  return log.sites.includes(siteId);
}

// Flat yield of a refinery card per the rules.
const REFINERY_YIELD = 7;

// Pick the best refining source available in the rocket stack.
// Returns either:
//   { kind: 'refinery', card, rawGain: 7 }
//   { kind: 'isru', card, rawGain: 1 + hydration - ISRU, isru }
//   null - nothing usable
//
// The ISRU formula is the published HF4 Site Refuel Op (I5a):
// "An Operational card with an ISRU platform produces a number
// of water FTs equal to one plus the Site's Hydration minus the
// card's ISRU rating." Gate: ISRU <= hydration (so gain >= 1).
//
// Refinery wins when both are present (factory-refuel is up to 7,
// always strictly better at low-hydration sites). The refinery
// branch validates supports with the same supplier-grouped OR
// rule isRocketActive() uses; the ISRU branch leans on
// getActiveProspectorStats so the prospector's chip math applies.
function pickRefiningSource(site) {
  const water = Number.isFinite(site.hydration) ? site.hydration : 0;
  // Refinery path: any stacked card whose type is 'refinery' AND
  // whose requires are satisfied by the rest of the stack.
  const stack = getRocketStack();
  for (const slot of stack) {
    const c = PATENTS_BY_ID[slot.id];
    if (!c || c.type !== 'refinery') continue;
    if (!refineryHasSupports(slot.id, stack)) continue;
    return { kind: 'refinery', card: c, rawGain: REFINERY_YIELD };
  }
  // ISRU rig path: the active prospector with a positive ISRU
  // value, supports met, and ISRU <= site hydration so the
  // 1 + hydration - ISRU formula gives at least 1 water.
  const prosp = getActiveProspectorStats();
  if (prosp && prosp.canActivate) {
    const isru = prospectorIsruValue(prosp.card);
    if (isru > 0 && isru <= water) {
      return { kind: 'isru', card: prosp.card, rawGain: 1 + water - isru, isru };
    }
  }
  return null;
}

// Same supplier-grouped OR check isRocketActive() uses, scoped to
// one refinery card. Returns true when every required-supplier
// group has at least one matching supplier in the rest of the
// stack.
function refineryHasSupports(cardId, stack) {
  const c = PATENTS_BY_ID[cardId];
  if (!c) return false;
  const f = (c.faces && c.faces.primary) || c;
  const reqs = Array.isArray(f.requires) ? f.requires : (c.requires || []);
  if (!reqs.length) return true;
  const supplied = new Set();
  for (const slot of stack) {
    if (slot.id === cardId) continue;
    const oc = PATENTS_BY_ID[slot.id];
    if (!oc) continue;
    const of = (oc.faces && oc.faces.primary) || oc;
    const sups = of.supplies || oc.supplies || [];
    for (const k of sups) supplied.add(k);
  }
  const groups = new Map();
  for (const r of reqs) {
    const supplier = r.kind.split('-')[0];
    if (!groups.has(supplier)) groups.set(supplier, []);
    groups.get(supplier).push(r.kind);
  }
  for (const [, kinds] of groups) {
    if (!kinds.some((k) => supplied.has(k))) return false;
  }
  return true;
}

function canRefuelAt(site) {
  const water = Number.isFinite(site.hydration) ? site.hydration : 0;
  const tank  = getTankWater();
  const tmax  = getTankMax();
  if (water <= 0) {
    return { ok: false, label: `💧 Refuel (dry site)`, reason: 'Site has no water (hydration 0).' };
  }
  if (tank >= tmax) {
    return { ok: false, label: `💧 Tank full (${tank}/${tmax})`, reason: 'Tank is already at max.' };
  }
  const source = pickRefiningSource(site);
  if (!source) {
    return {
      ok: false,
      label: `💧 Refuel (no rig)`,
      reason: 'Need an active refinery, OR an ISRU prospector with ISRU ≤ site water.',
    };
  }
  if (hasRefueledThisTurn(site.id)) {
    return { ok: false, label: `💧 Refueled this turn`, reason: 'Already refined here this turn. End turn to refresh.' };
  }
  const gain = Math.min(source.rawGain, tmax - tank);
  const label = source.kind === 'refinery'
    ? `💧 Refuel (+${gain} via refinery)`
    : `💧 Refuel (+${gain} via ISRU)`;
  return { ok: true, label, reason: null, source };
}

function doRefuel(site) {
  const chk = canRefuelAt(site);
  if (!chk.ok) {
    setStatus(`Refuel blocked: ${chk.reason}`);
    return;
  }
  const source = chk.source;
  const tankBefore = getTankWater();
  const tmax = getTankMax();
  const gain = Math.min(source.rawGain, tmax - tankBefore);
  if (gain <= 0) return;
  addFuel(gain);
  markRefueledThisTurn(site.id);
  const sourceName = source.card?.name || source.kind;
  const water = Number.isFinite(site.hydration) ? site.hydration : 0;
  const detail = source.kind === 'refinery'
    ? `flat +${REFINERY_YIELD} via <em>${esc(sourceName)}</em>`
    : `1 + water ${water} - ISRU ${source.isru} = ${source.rawGain}`;
  setStatus(
    `💧 Refined <strong>${gain}</strong> water at `
    + `<strong>${esc(site.name)}</strong> (${detail}). `
    + `Tank ${tankBefore} → <strong>${tankBefore + gain}</strong>/${tmax}.`
  );
  logAction({
    type: 'refuel',
    icon: '💧',
    summary: `Refined +${gain} water at ${site.name} via ${source.kind} (${sourceName}); tank ${tankBefore + gain}/${tmax}`,
    undoable: false,
    data: {
      siteId: site.id, gain, source: source.kind,
      tankAfter: tankBefore + gain,
    },
  });
  // Visual: pop the tank modal showing water flowing in. Player
  // can click to skip or dismiss whenever.
  openFuelTankModal({ fromWater: tankBefore, toWater: tankBefore + gain });
}

// Fuel-tank modal. SVG cylinder; water rect grows from
// `fromWater` to `toWater` over ~1100 ms. Capacity = active
// thruster's max-liftable fuel (thrust - dryMass) when present,
// falling back to the engine's hard tank cap. Tap / click /
// Escape closes; tapping mid-animation skips to the end-state
// without dismissing so the player sees the final level.
// Lightweight confirm modal. Returns a Promise<boolean> that
// resolves true on the "yes" path, false on cancel / Esc /
// backdrop tap. Used for the afterburn engage prompt; future
// destructive actions can reuse it.
function confirmModal({ title, body, yes = 'OK', no = 'Cancel' }) {
  return new Promise((resolve) => {
    document.querySelector('.confirm-modal-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'card-modal-overlay confirm-modal-overlay';
    const close = (val) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(!!val);
    };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
      else if (e.key === 'Enter') close(true);
    };
    document.addEventListener('keydown', onKey);
    const panel = document.createElement('div');
    panel.className = 'turn-confirm-panel';
    // Single-button (info) mode: pass no='' to hide the secondary
    // button so the modal reads as an acknowledge instead of a
    // yes/no. The remaining Yes resolves true on click + Enter.
    const noBtn = no
      ? `<button type="button" class="popup-btn" data-act="no">${esc(no)}</button>`
      : '';
    panel.innerHTML = `
      <h3>${esc(title)}</h3>
      <p>${body}</p>
      <div class="turn-confirm-actions">
        <button type="button" class="popup-btn primary" data-act="yes">${esc(yes)}</button>
        ${noBtn}
      </div>
    `;
    panel.querySelector('[data-act="yes"]').addEventListener('click', () => close(true));
    const noEl = panel.querySelector('[data-act="no"]');
    if (noEl) noEl.addEventListener('click', () => close(false));
    overlay.appendChild(panel);
    mountOverlay(overlay);
  });
}

// Interactive fuel-strip diagram for the rocket-stack header.
// Cells 1..32 are coloured by the published weight-class band:
//   1                       MIN DRY MASS marker
//   2-4 (under 2)           WISP   (+2)
//   2-4 (under 4 2/3)       PROBE  (+1)
//   5-6 (under 6 1/2)       SCOUT   (0)
//   7-16 (under 17)         TRANSPORT (-1)
//   17-32                   TUG    (-2)
// Two chits overlay the strip: DRY at the rocket's dry mass and
// WET at the current wet mass. Hovering any cell reveals its
// weight-class modifier. The strip is read-only for now; future
// patches will wire drag-to-relocate-chit, factory refuel
// patterns, etc.
function buildFuelStrip(host, totals) {
  host.innerHTML = '';
  const cap = 32;
  const wm = totals.wetMass | 0;
  const dm = totals.dryMass | 0;
  // Weight class for a given chit position. Mirrors the
  // getActiveThrusterStats logic so the strip stays a single
  // source of truth on the rule.
  function classify(pos) {
    if (pos <  2)       return { name: 'WISP',      mod: +2, color: '#f472b6' };
    if (pos < 14 / 3)   return { name: 'PROBE',     mod: +1, color: '#f9a8d4' };
    if (pos < 6.5)      return { name: 'SCOUT',     mod:  0, color: '#7dd3fc' };
    if (pos < 17)       return { name: 'TRANSPORT', mod: -1, color: '#67e8f9' };
    return                        { name: 'TUG',    mod: -2, color: '#5eead4' };
  }
  const wrap = document.createElement('div');
  wrap.className = 'rocket-fuel-strip-row';
  const label = document.createElement('div');
  label.className = 'rocket-fuel-strip-label';
  label.textContent = 'Net Thrust track';
  host.appendChild(label);
  for (let i = 1; i <= cap; i++) {
    const cell = document.createElement('div');
    const c = classify(i);
    cell.className = 'fuel-strip-cell';
    cell.style.backgroundColor = c.color;
    cell.dataset.tip = `Position ${i} - ${c.name} weight class (${c.mod >= 0 ? '+' : ''}${c.mod} thrust)`;
    cell.title = cell.dataset.tip;
    cell.textContent = String(i);
    if (i === dm) cell.classList.add('is-dry-chit');
    if (i === wm) cell.classList.add('is-wet-chit');
    if (i === dm && i === wm) cell.classList.add('is-co-chit');
    wrap.appendChild(cell);
  }
  host.appendChild(wrap);
  const legend = document.createElement('div');
  legend.className = 'rocket-fuel-strip-legend';
  legend.innerHTML = `
    <span><i class="chit-dot is-dry-chit"></i> Dry ${dm}</span>
    <span><i class="chit-dot is-wet-chit"></i> Wet ${wm}</span>
    <span class="muted">Max wet 32</span>
  `;
  host.appendChild(legend);
}

function openFuelTankModal({ fromWater = null, toWater = null } = {}) {
  document.querySelector('.fuel-tank-overlay')?.remove();
  const tankNow = Number.isFinite(toWater) ? toWater : getTankWater();
  // fromWater default is null (not 0): no-arg opens snap to the
  // current level immediately, no fill animation. Refuel calls
  // still pass fromWater explicitly to play the fill tween.
  const fromW   = Number.isFinite(fromWater) ? fromWater : tankNow;
  const totals  = getStackTotals();
  const thrStats = getActiveThrusterStats();
  // Capacity model: thrust - dryMass (the HF4 wet-mass lift cap)
  // so the cylinder visually shows how much room is left under
  // the thruster's lift limit. When no thruster is active or the
  // ship is overweight, fall back to the engine's tank cap.
  const liftCap = (thrStats && Number.isFinite(thrStats.thrust))
    ? Math.max(0, thrStats.thrust - (totals.dryMass || 0))
    : null;
  const cap = liftCap != null && liftCap > 0 ? liftCap : getTankMax();

  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay fuel-tank-overlay';

  let animating = false;
  let raf = 0;
  let finalReached = (fromW === tankNow);

  const close = () => {
    if (raf) cancelAnimationFrame(raf);
    // Defensive - drops were appended to a child of the overlay
    // so they vanish with overlay.remove(), but null out the
    // array so a stale rAF can't touch detached nodes.
    activeDrops.length = 0;
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  const panel = document.createElement('div');
  panel.className = 'fuel-tank-panel';
  panel.innerHTML = `
    <button type="button" class="modal-x" aria-label="Close (Esc)" title="Close (Esc)">×</button>
    <h2 class="fuel-tank-title">💧 Water tank</h2>
    <p class="muted fuel-tank-sub">Tap outside or press Esc to close</p>
    <div class="fuel-tank-stage">
      <svg viewBox="0 0 120 220" class="fuel-tank-svg" preserveAspectRatio="xMidYMid meet">
        <!-- Outer cylinder (stroke only) -->
        <rect class="tank-shell" x="20" y="10" width="80" height="200" rx="14" ry="14" />
        <!-- Inner clip path so water doesn't bleed past the rim -->
        <defs>
          <clipPath id="tank-clip">
            <rect x="20" y="10" width="80" height="200" rx="14" ry="14" />
          </clipPath>
        </defs>
        <!-- Falling droplet + splash layer. Sits ABOVE the water
             but inside the clip so the droplets disappear at the
             rim. JS spawns the droplet + splash <path>s during
             the fill animation. -->
        <g class="tank-drops" clip-path="url(#tank-clip)"></g>
        <!-- Water level. y + height are recomputed on each frame; the
             reference height (200) corresponds to 100% full. -->
        <g clip-path="url(#tank-clip)">
          <rect class="tank-water" x="20" y="200" width="80" height="10" />
          <rect class="tank-water-foam" x="20" y="195" width="80" height="6" />
        </g>
        <!-- Capacity tick marks every 5 units. -->
        <g class="tank-ticks"></g>
      </svg>
      <div class="fuel-tank-readout">
        <strong class="tank-now">${fromW}</strong>
        <span>/</span>
        <strong class="tank-cap">${cap}</strong>
        <em class="muted">water</em>
      </div>
    </div>
    <div class="fuel-tank-actions">
      <button type="button" class="popup-btn popup-btn-secondary" id="tank-dump-1"
        title="Drain 1 water from the tank">💧⤓ Dump 1</button>
      <button type="button" class="popup-btn popup-btn-secondary" id="tank-dump-all"
        title="Drain everything (future: forms an outpost stack once factories land)">💧⤓ Dump all</button>
    </div>
    <div class="fuel-tank-aqua" id="tank-aqua-section" hidden>
      <div class="aqua-row">
        <span>💎 Aqua balance</span>
        <strong id="aqua-balance">${getAqua()}</strong>
      </div>
      <p class="muted aqua-help">
        Convert aqua to water 1:1. Only available at LEO.
      </p>
      <div class="aqua-actions">
        <button type="button" class="popup-btn popup-btn-secondary" id="aqua-buy-1"
          title="Convert 1 aqua into 1 water">💎→💧 +1</button>
        <button type="button" class="popup-btn popup-btn-secondary" id="aqua-buy-5"
          title="Convert 5 aqua into 5 water">💎→💧 +5</button>
        <button type="button" class="popup-btn" id="aqua-buy-max"
          title="Fill the tank to its cap by converting aqua">💎→💧 Max fill</button>
      </div>
    </div>
    <p class="muted fuel-tank-dump-note">
      Dumped water is destroyed for now. Stage 3+ turns this into
      an outpost-stack drop once factories land.
    </p>
    <div class="fuel-tank-foot muted">
      Cap = thrust ${thrStats ? thrStats.thrust : '-'} − dry mass ${totals.dryMass || 0}
      ${liftCap == null ? '(no active thruster)' : ''}
    </div>
  `;

  const waterRect = panel.querySelector('.tank-water');
  const foamRect  = panel.querySelector('.tank-water-foam');
  const nowReadout = panel.querySelector('.tank-now');
  const ticksG     = panel.querySelector('.tank-ticks');

  // Tick marks. One short hatch every 5 units on the right edge.
  const tickEvery = Math.max(1, Math.round(cap / 10));
  for (let v = tickEvery; v <= cap; v += tickEvery) {
    const t = v / cap;
    const ty = 210 - t * 200;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', 100); line.setAttribute('x2', 110);
    line.setAttribute('y1', ty);  line.setAttribute('y2', ty);
    line.setAttribute('stroke', 'rgba(125, 211, 252, 0.55)');
    line.setAttribute('stroke-width', '1.5');
    ticksG.appendChild(line);
  }

  // Current water surface y (svg coord). Drops use this to know
  // when they've hit the surface. setLevel writes it each frame.
  let _surfaceY = 210;
  function setLevel(level) {
    const clamped = Math.max(0, Math.min(cap, level));
    const frac = cap > 0 ? clamped / cap : 0;
    const h    = frac * 200;
    _surfaceY  = 210 - h;
    waterRect.setAttribute('y', String(210 - h));
    waterRect.setAttribute('height', String(h));
    foamRect.setAttribute('y',  String(210 - h - 3));
    foamRect.setAttribute('height', String(Math.min(6, h)));
    nowReadout.textContent = String(Math.round(clamped));
  }

  // Falling-droplet animation. Spawns teardrop <path>s at the
  // top of the tank and lets gravity drop them onto the water
  // surface. On impact, a quick splash ring expands + fades.
  // Two cadences:
  //   - fast (~110ms) while a fill / drain tween is running
  //   - ambient (~2-5s, random) while idle, so the modal has a
  //     bit of life without feeling like the tank is filling
  const dropsLayer = panel.querySelector('.tank-drops');
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const activeDrops = [];
  let lastSpawn = 0;
  let nextAmbient = 0;
  function spawnDrop(now, opts = {}) {
    const x = 30 + Math.random() * 60;      // within the tank interior
    const path = document.createElementNS(SVG_NS, 'path');
    // Teardrop shape ~6px tall, 4px wide at base.
    path.setAttribute('d', 'M 0 -3 C 2 0 2 3 0 3 C -2 3 -2 0 0 -3 Z');
    path.setAttribute('fill', '#7dd3fc');
    // Ambient drops are quieter (lower opacity, slower fall) so
    // the eye reads them as background pulse rather than fill.
    path.setAttribute('opacity', opts.ambient ? '0.55' : '0.9');
    path.setAttribute('transform', `translate(${x.toFixed(1)} 14)`);
    dropsLayer.appendChild(path);
    activeDrops.push({
      el: path, x, y: 14,
      vy: opts.ambient ? (20 + Math.random() * 15) : (60 + Math.random() * 30),
      bornAt: now,
    });
  }
  function spawnSplash(x, y) {
    const ring = document.createElementNS(SVG_NS, 'circle');
    ring.setAttribute('cx', String(x.toFixed(1)));
    ring.setAttribute('cy', String(y.toFixed(1)));
    ring.setAttribute('r', '1');
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', '#bae6fd');
    ring.setAttribute('stroke-width', '1.2');
    ring.setAttribute('opacity', '0.85');
    dropsLayer.appendChild(ring);
    const t0 = performance.now();
    const splashTick = (now) => {
      const t = Math.min(1, (now - t0) / 350);
      const r = 1 + t * 6;
      const op = 0.85 * (1 - t);
      ring.setAttribute('r', String(r.toFixed(2)));
      ring.setAttribute('opacity', String(op.toFixed(2)));
      if (t < 1) requestAnimationFrame(splashTick);
      else ring.remove();
    };
    requestAnimationFrame(splashTick);
  }
  function stepDrops(now, dtMs) {
    // Fill / drain mode: spawn rapidly so the column reads as
    // pouring water. Idle: spawn sparingly so the modal has a
    // bit of pulse without looking like the tank is refilling
    // on its own.
    if (animating) {
      if (now - lastSpawn > 110) {
        spawnDrop(now);
        lastSpawn = now;
      }
    } else if (nextAmbient && now >= nextAmbient) {
      spawnDrop(now, { ambient: true });
      nextAmbient = now + 2000 + Math.random() * 3000;
    } else if (!nextAmbient) {
      // First idle frame seeds the schedule so we don't spawn
      // a drop instantly on modal open - players see the still
      // tank first, then a quiet drop after a beat.
      nextAmbient = now + 1500 + Math.random() * 1500;
    }
    for (let i = activeDrops.length - 1; i >= 0; i--) {
      const d = activeDrops[i];
      const dts = dtMs / 1000;
      d.vy += 220 * dts;        // gravity (px/s^2)
      d.y  += d.vy * dts;
      // Landed on the water surface? Spawn splash + remove drop.
      if (d.y >= _surfaceY - 1) {
        spawnSplash(d.x, _surfaceY);
        d.el.remove();
        activeDrops.splice(i, 1);
        continue;
      }
      d.el.setAttribute('transform', `translate(${d.x.toFixed(1)} ${d.y.toFixed(1)})`);
    }
  }
  function clearDrops() {
    for (const d of activeDrops) d.el.remove();
    activeDrops.length = 0;
  }

  // Initial position.
  setLevel(fromW);

  // Skip / close. The first tap during animation jumps to the
  // final state; subsequent taps (or a tap when already final)
  // close the modal. Two-state click is intentional so the
  // player has a moment to read the result before dismissing.
  const onTap = (e) => {
    if (e.target.classList.contains('modal-x')) return;
    if (animating) {
      // Skip animation - snap the level to the active tween's
      // target and tear the tween down. The main rAF stays alive
      // (it's also driving ambient drops), so we only clear the
      // tween state + in-flight drops.
      const target = tween ? tween.to : tankNow;
      tween = null;
      animating = false;
      setLevel(target);
      clearDrops();
      finalReached = true;
      return;
    }
    if (finalReached) close();
  };
  overlay.addEventListener('click', onTap);
  panel.querySelector('.modal-x').addEventListener('click', close);

  overlay.appendChild(panel);
  mountOverlay(overlay);

  // Continuous tick. Runs from open to close so ambient drops
  // can fall while the modal sits idle. Level tweens (initial
  // refuel, drain on dump, aqua → water transfer) share this
  // loop via the `tween` slot below - they set { from, to, t0,
  // dur, onDone } and the step function handles the rest.
  // `animating` keys stepDrops's cadence so a running tween
  // pours drops fast and idle frames pour sparingly.
  let lastTick = performance.now();
  let tween = null;
  if (fromW !== tankNow) {
    tween = {
      from: fromW, to: tankNow,
      t0: performance.now(), dur: 1100,
    };
    animating = true;
  } else {
    finalReached = true;
  }
  const step = (now) => {
    const dt = now - lastTick;
    lastTick = now;
    if (tween) {
      const t = Math.min(1, (now - tween.t0) / tween.dur);
      const eased = 1 - Math.pow(1 - t, 3);  // ease-out cubic
      const v = tween.from + (tween.to - tween.from) * eased;
      setLevel(v);
      if (t >= 1) {
        const done = tween.onDone;
        tween = null;
        animating = false;
        finalReached = true;
        if (done) done();
      }
    }
    stepDrops(now, dt);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  // Note: close() already nulls activeDrops + removes the
  // overlay, so any in-flight drops vanish when the user
  // dismisses mid-animation.

  // Dump-fuel buttons. Drain water from the tank without forming
  // an outpost stack (that lands once factories ship in Stage
  // 3+). Each click: removeFuel(N), then animate the level
  // dropping from before-value to after-value over ~250ms. The
  // readout updates each frame; in-flight droplets are cleared
  // because dumping should feel like emptying, not filling.
  const dump1Btn   = panel.querySelector('#tank-dump-1');
  const dumpAllBtn = panel.querySelector('#tank-dump-all');
  const refreshDumpButtons = () => {
    const cur = getTankWater();
    if (dump1Btn)   dump1Btn.disabled   = cur <= 0;
    if (dumpAllBtn) dumpAllBtn.disabled = cur <= 0;
  };
  refreshDumpButtons();
  function drainTo(targetLevel, durationMs = 250) {
    // Hand off to the unified tween: the continuous step picks
    // it up next frame and animates setLevel without disturbing
    // ambient drops. Clearing in-flight drops keeps the visual
    // honest - emptying shouldn't look like pouring in.
    clearDrops();
    const fromLevel = parseFloat(nowReadout.textContent || String(getTankWater()));
    const toLevel = Math.max(0, targetLevel);
    if (fromLevel === toLevel) {
      refreshDumpButtons();
      return;
    }
    animating = true;
    tween = {
      from: fromLevel, to: toLevel,
      t0: performance.now(), dur: durationMs,
      onDone: () => refreshDumpButtons(),
    };
  }
  dump1Btn?.addEventListener('click', (e) => {
    // Stop the overlay's onTap handler from interpreting this
    // click as "skip animation / close" - that's why dump 1 / all
    // looked like it dismissed the modal.
    e.stopPropagation();
    if (getTankWater() <= 0) return;
    removeFuel(1);
    drainTo(getTankWater());
    logAction({
      type: 'dump',
      icon: '💧⤓',
      summary: `Dumped 1 water (tank ${getTankWater()}/${getTankMax()})`,
      undoable: false,
    });
  });
  dumpAllBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const drained = getTankWater();
    if (drained <= 0) return;
    removeFuel(drained);
    drainTo(0, 600);
    logAction({
      type: 'dump',
      icon: '💧⤓',
      summary: `Dumped ${drained} water (tank empty)`,
      undoable: false,
    });
  });

  // Aqua → water transfer panel. Gated behind LEO presence -
  // refilling water from the aqua reserve is a "back at port"
  // affordance, not something you can do mid-burn. Tank cap is
  // the lift-limit `cap` already computed above so the buttons
  // can't push past wet=32 or past thrust-mass.
  const aquaSection = panel.querySelector('#tank-aqua-section');
  const aquaBalEl   = panel.querySelector('#aqua-balance');
  const aquaBuy1Btn = panel.querySelector('#aqua-buy-1');
  const aquaBuy5Btn = panel.querySelector('#aqua-buy-5');
  const aquaBuyMaxBtn = panel.querySelector('#aqua-buy-max');
  const atLeo = isLeoSite(getRocketSite());
  if (atLeo && aquaSection) aquaSection.hidden = false;
  const refreshAquaButtons = () => {
    if (!aquaSection || aquaSection.hidden) return;
    const bal = getAqua();
    const cur = getTankWater();
    const room = Math.max(0, cap - cur);
    if (aquaBalEl) aquaBalEl.textContent = String(bal);
    if (aquaBuy1Btn)   aquaBuy1Btn.disabled   = bal < 1 || room < 1;
    if (aquaBuy5Btn)   aquaBuy5Btn.disabled   = bal < 5 || room < 1;
    if (aquaBuyMaxBtn) aquaBuyMaxBtn.disabled = bal < 1 || room < 1;
  };
  refreshAquaButtons();
  // Reuse the same drainTo-style animation in reverse: get the
  // visual "from" off the on-screen readout and tween up to the
  // new tank water level. Wraps the spend + addFuel pair so a
  // failed spend doesn't leave the level mid-animation.
  const fillFromAqua = (amount, e) => {
    e?.stopPropagation();
    if (!atLeo) return;
    const cur = getTankWater();
    const room = Math.max(0, cap - cur);
    const want = Math.min(amount, room, getAqua());
    if (want <= 0) { refreshAquaButtons(); return; }
    if (!spendAqua(want)) { refreshAquaButtons(); return; }
    addFuel(want);
    const fromLevel = parseFloat(nowReadout.textContent || String(cur));
    const toLevel = getTankWater();
    if (fromLevel === toLevel) {
      refreshAquaButtons();
      return;
    }
    // Hand off to the unified tween. animating=true makes
    // stepDrops pour rapidly while the level climbs.
    animating = true;
    tween = {
      from: fromLevel, to: toLevel,
      t0: performance.now(), dur: 400,
      onDone: () => { refreshAquaButtons(); refreshDumpButtons(); },
    };
    logAction({
      type: 'aqua_transfer',
      icon: '💎→💧',
      summary: `Converted ${want} aqua → ${want} water (tank ${getTankWater()}/${cap})`,
      undoable: false,
    });
  };
  aquaBuy1Btn?.addEventListener('click',   (e) => fillFromAqua(1, e));
  aquaBuy5Btn?.addEventListener('click',   (e) => fillFromAqua(5, e));
  aquaBuyMaxBtn?.addEventListener('click', (e) => fillFromAqua(cap, e));
  const unsubAqua = onAquaChange(refreshAquaButtons);
  const unsubRocket = onRocketChange(refreshAquaButtons);
  // Cleanup: detach listeners when the overlay tears down so a
  // closed modal doesn't keep responding to balance changes.
  const origRemove = overlay.remove.bind(overlay);
  overlay.remove = () => {
    unsubAqua();
    unsubRocket();
    origRemove();
  };
}

// Read the prospector's ISRU rating off the active face's
// properties. ISRU is a numeric property (1..N); missing /
// zero means "no water requirement". Returns the integer.
function prospectorIsruValue(card) {
  if (!card) return 0;
  const f = (card.faces && card.faces.primary) || card;
  const props = f.properties || card.properties || [];
  const e = props.find((p) => p.key === 'isru');
  if (!e) return 0;
  const v = typeof e.value === 'number' ? e.value : parseInt(e.value, 10);
  return Number.isFinite(v) ? v : 0;
}

function doProspect(site, prosp) {
  if (!prosp) return;
  // Already-prospected sites are off-limits in the sandbox; the UI
  // grays out the button when a disc is in place, but guard here
  // too so an autoclick can't double-spend.
  if (getDisc(site.id)) {
    setStatus(`This site already has a prospect disc - clear it first.`);
    return;
  }
  // ISRU rule re-validated against hydration (the "water" gate).
  // Defence-in-depth in case the popup button somehow ends up
  // enabled with a stale read.
  const prospIsru = prospectorIsruValue(prosp.card);
  const siteWater = Number.isFinite(site.hydration) ? site.hydration : 0;
  if (prospIsru > siteWater) {
    setStatus(
      `Prospect blocked: <em>${esc(prosp.card?.name || '')}</em> needs site water ≥ `
      + `${prospIsru}, site has ${siteWater}.`
    );
    return;
  }
  const threshold = siteProspectThreshold(site);
  const roll = 1 + Math.floor(Math.random() * 6);
  const success = roll <= threshold;
  const cardName = prosp.card?.name || prosp.id;
  const kindGlyph = { missile: '🚀', raygun: '🔫', buggy: '🛺' }[prosp.kind] || '🔬';
  openProspectRollModal({ site, threshold, roll, success, kindGlyph, cardName }, () => {
    placeDisc(site.id, success ? 'success' : 'fail', {
      roll, threshold, kind: prosp.kind, by: cardName,
    });
    setStatus(
      `${kindGlyph} Prospected <strong>${esc(site.name)}</strong> `
      + `(target ≤ ${threshold}) with <em>${esc(cardName)}</em>: `
      + `rolled <strong class="big">${roll}</strong> - `
      + `<strong>${success ? 'success - claim placed' : 'failed - site exhausted'}</strong>.`
    );
    logAction({
      type: 'prospect',
      icon: kindGlyph,
      summary: `${success ? 'Claimed' : 'Exhausted'} ${site.name} (${prosp.kind}, rolled ${roll} vs ≤${threshold})`,
      undoable: false,
      data: { siteId: site.id, kind: prosp.kind, roll, threshold, success },
    });
  });
}

// Animated prospect-roll modal. Shows a 3D die on the left, the
// site's prospect target (≤ N) on the right, rolls the die for
// ~700 ms, then settles on the rolled value. The die's outer
// border tints green on success / red on fail so the player reads
// the outcome at a glance. Player then clicks "Place disc" to
// commit the result; onPlace fires once the disc lands.
function openProspectRollModal({ site, threshold, roll, success, kindGlyph, cardName }, onPlace) {
  document.querySelector('.prospect-roll-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay prospect-roll-overlay';
  const close = (placed) => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (placed && onPlace) onPlace();
  };
  // Roll animation isn't dismissible by clicking outside / Esc -
  // the player has to acknowledge the result with the Place button.
  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const btn = overlay.querySelector('.prospect-place-btn');
      if (btn && !btn.disabled) { e.preventDefault(); close(true); }
    }
  };
  document.addEventListener('keydown', onKey);

  const panel = document.createElement('div');
  panel.className = 'prospect-roll-panel';
  panel.innerHTML = `
    <h2 class="prospect-roll-title">${kindGlyph} Prospecting ${esc(site.name)}</h2>
    <p class="muted prospect-roll-sub">with <em>${esc(cardName)}</em></p>
    <div class="prospect-roll-stage">
      <div class="prospect-die-host"></div>
      <div class="prospect-roll-vs">≤</div>
      <div class="prospect-target">
        <strong>${threshold}</strong>
        <em>site size</em>
      </div>
    </div>
    <p class="prospect-roll-result muted">Rolling…</p>
    <div class="prospect-roll-actions">
      <button type="button" class="popup-btn primary prospect-place-btn" disabled>
        Place disc
      </button>
    </div>
  `;
  const dieHost = panel.querySelector('.prospect-die-host');
  const resultLine = panel.querySelector('.prospect-roll-result');
  const placeBtn = panel.querySelector('.prospect-place-btn');
  const die = buildDie(1);
  dieHost.appendChild(die);

  overlay.appendChild(panel);
  mountOverlay(overlay);

  rollDie(die, roll).then(() => {
    die.classList.add(success ? 'die-success' : 'die-fail');
    resultLine.innerHTML = success
      ? `Rolled <strong>${roll}</strong> ≤ ${threshold} - <strong class="ok">success</strong>. Claim disc ready.`
      : `Rolled <strong>${roll}</strong> > ${threshold} - <strong class="bad">failed</strong>. Site exhausted.`;
    resultLine.classList.remove('muted');
    placeBtn.disabled = false;
    placeBtn.textContent = success ? 'Place yellow claim disc' : 'Place red disc';
  });
  placeBtn.addEventListener('click', () => close(true));
}

function getRocketSite() {
  if (!_activeData) return null;
  if (_rocketSiteId) {
    const s = _activeData.sites.find((x) => x.id === _rocketSiteId);
    if (s) return s;
    _rocketSiteId = null;
    persistRocketSite();
  }
  return _activeData.sites.find(
    (x) => x.type === 'lagrange' && x.name === 'LEO'
  ) || null;
}
function persistRocketSite() {
  try {
    if (_rocketSiteId) localStorage.setItem(STORAGE_ROCKET_SITE, _rocketSiteId);
    else localStorage.removeItem(STORAGE_ROCKET_SITE);
  } catch { /* private mode */ }
}
function persistRocketTrail() {
  try {
    if (_rocketTrail && _rocketTrail.length) {
      localStorage.setItem(STORAGE_ROCKET_TRAIL, JSON.stringify(_rocketTrail));
    } else {
      localStorage.removeItem(STORAGE_ROCKET_TRAIL);
    }
  } catch { /* private mode */ }
}
// Planned route persistence. Called from every assignment to
// _plannedRoute so the multi-turn plan survives reloads - critical
// because the player might queue a 4-turn journey, end one turn,
// close the tab, come back tomorrow and expect to continue.
function persistPlannedRoute() {
  try {
    if (_plannedRoute && _plannedRoute.length) {
      localStorage.setItem(STORAGE_ROCKET_ROUTE, JSON.stringify(_plannedRoute));
    } else {
      localStorage.removeItem(STORAGE_ROCKET_ROUTE);
    }
  } catch { /* private mode */ }
}

// Tween the sandbox rocket sprite along a polyline derived from a
// list of segments. Each frame writes a new (x, y) to the renderer
// via setSandboxRocket. Resolves when the tween finishes; rejects
// silently if another animation pre-empts this one. Distance-
// weighted so longer segments take proportionally more time.
function animateRocketAlong(segments, totalMs = 700) {
  return new Promise((resolve) => {
    if (!_renderer || !_activeData || !segments || !segments.length) {
      resolve(); return;
    }
    // Build the polyline: start at segments[0].from, then walk
    // through each .to in order. Skip any segments whose endpoints
    // we can't resolve (data drift safety).
    const pts = [];
    const first = _activeData.sites.find((s) => s.id === segments[0].from);
    if (first && typeof first.x === 'number') {
      pts.push({ x: first.x, y: first.y });
    }
    for (const seg of segments) {
      const s = _activeData.sites.find((x) => x.id === seg.to);
      if (s && typeof s.x === 'number') pts.push({ x: s.x, y: s.y });
    }
    if (pts.length < 2) { resolve(); return; }
    const lens = [];
    let totalLen = 0;
    for (let i = 1; i < pts.length; i++) {
      const L = Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);
      lens.push(L);
      totalLen += L;
    }
    if (totalLen === 0) { resolve(); return; }
    const r = isRocketActive();
    const t0 = performance.now();
    _rocketAnimating = true;
    const step = (now) => {
      const t = Math.min(1, (now - t0) / totalMs);
      // ease-in-out cubic - accelerates off the launch site,
      // decelerates into the landing site.
      const eased = t < 0.5
        ? 4 * t * t * t
        : 1 - Math.pow(-2 * t + 2, 3) / 2;
      let traveled = eased * totalLen;
      let i = 0;
      while (i < lens.length - 1 && traveled > lens[i]) {
        traveled -= lens[i];
        i += 1;
      }
      const k = lens[i] > 0 ? traveled / lens[i] : 0;
      const pos = {
        x: pts[i].x + (pts[i+1].x - pts[i].x) * k,
        y: pts[i].y + (pts[i+1].y - pts[i].y) * k,
      };
      _renderer.setSandboxRocket({
        x: pos.x, y: pos.y,
        colour: 'yellow',
        canFly: r.active,
      });
      if (t < 1) requestAnimationFrame(step);
      else {
        _rocketAnimating = false;
        resolve();
      }
    };
    requestAnimationFrame(step);
  });
}

function syncSandboxRocket() {
  if (!_renderer) return;
  const stack = getRocketStack();
  // Rocket model is present whenever the player has ≥1 card in
  // the stack - even when it isn't yet activatable. The 🚫
  // overlay distinguishes active vs inactive states.
  if (!stack.length) {
    _renderer.setSandboxRocket(null);
    return;
  }
  const r = isRocketActive();
  const site = getRocketSite();
  const x = site && typeof site.x === 'number' ? site.x : LEO_ANCHOR.x;
  const y = site && typeof site.y === 'number' ? site.y : LEO_ANCHOR.y;
  // Active prospector kind is forwarded to the renderer so it can
  // badge the rocket sprite with the right glyph (🚀 / 🔫 / 🛺).
  // Only badged when the prospector's supports are met - otherwise
  // it's just dead weight and shouldn't read as "active".
  const prosp = getActiveProspectorStats();
  const prospectorKind = (prosp && prosp.canActivate) ? prosp.kind : null;
  // Card name + ISRU travel with the sprite so the renderer's
  // badge-hover tooltip can show them without having to import
  // rocket state itself.
  const prospectorName = prosp && prosp.card ? prosp.card.name : null;
  const prospectorIsru = prosp ? prospectorIsruValue(prosp.card) : null;
  // Active thruster summary for the rocket-hover tooltip
  // (modifier-baked thrust + fuel-per-burn so the player sees
  // the "final" numbers, not the printed ones).
  const thrStats = getActiveThrusterStats();
  const thrusterSummary = thrStats ? {
    name:       thrStats.name,
    thrust:     thrStats.thrust,
    fuel:       thrStats.fuel,
    baseThrust: thrStats.baseThrust,
    baseFuel:   thrStats.baseFuel,
    canLift:    thrStats.canLift,
    wetMass:    thrStats.wetMass,
  } : null;
  _renderer.setSandboxRocket({
    x, y,
    colour: 'yellow',
    canFly: r.active,       // drives the 🚫 + transparency overlay
    prospectorKind,
    prospectorName,
    prospectorIsru,
    thruster: thrusterSummary,
  });
}

// Push the current disc state into the renderer so already-
// prospected sites paint a coloured chit. Subscribed once at
// mount time + on every disc change.
function syncDiscs() {
  if (!_renderer) return;
  _renderer.setDiscs(getDiscs());
}

// Step the rocket through its planned route's "turn 1" segments
// (one move per turn, capped at BURNS_PER_TURN burns of cumulative
// dv). The remaining segments shift down a turn so the next move
// walks what was previously turn 2. Returns true on success.
async function moveRocket() {
  if (!_renderer || !_activeData) return false;
  if (_rocketAnimating) return false;
  if (!_plannedRoute || !_plannedRoute.length) {
    setStatus('No planned route - tap a site and pick "Plan rocket route" first.');
    return false;
  }
  const turn1 = _plannedRoute.filter((s) => s.turn === 1);
  if (!turn1.length) {
    setStatus('Planned route has no current-turn segments.');
    return false;
  }
  // Hazard pre-flight check. If the route crosses skull / radhaz /
  // aerobrake nodes, force a player decision BEFORE consuming the
  // move - paying or rolling locks out undo for the rest of the
  // turn. Cancelling returns to the planning state with the
  // move budget untouched.
  const hazards = routeHazards(turn1);
  let hazardChoice = null;
  if (hazards.length) {
    hazardChoice = await hazardConfirmModal(hazards);
    if (hazardChoice === 'cancel' || hazardChoice == null) {
      setStatus('Move cancelled - no aqua spent, no rolls made.');
      return false;
    }
    if (hazardChoice === 'pay') {
      const cost = hazards.length * HAZARD_COST_PER;
      if (!spendAqua(cost)) {
        // Race-condition guard: the balance changed between modal
        // open and confirm. Bail with a status line instead of
        // silently leaving the player out-of-pocket.
        setStatus(`Need ${cost} aqua to bypass - balance only ${getAqua()}.`);
        return false;
      }
      logAction({
        type: 'hazard_pay',
        icon: '💎',
        summary: `Paid ${cost} aqua to bypass ${hazards.length} hazard`
          + `${hazards.length === 1 ? '' : 's'}`,
        undoable: false,
        data: { cost, hazards: hazards.map((h) => h.site.id) },
      });
    } else if (hazardChoice === 'roll') {
      // Sandbox: roll 1d6 per hazard, log each result. Threshold +
      // ship-destruction kicks in once Stage 3 wires the engine;
      // for now the dice surface in the log so the player can see
      // what would have fired at the table.
      const rolls = hazards.map((h) => ({
        site: h.site, label: h.label, glyph: h.glyph,
        d6: 1 + Math.floor(Math.random() * 6),
      }));
      for (const r of rolls) {
        const verdict = r.d6 >= 3 ? '✓ survived (≥ 3)' : '✗ critical (< 3)';
        logAction({
          type: 'hazard_roll',
          icon: r.glyph,
          summary: `${r.glyph} ${esc(r.site.name)} d6=${r.d6} ${verdict}`,
          undoable: false,
          data: { siteId: r.site.id, d6: r.d6 },
        });
      }
    }
  }
  if (!consumeMove()) {
    setStatus('No moves left this turn - end turn to refresh.');
    return false;
  }
  // Snapshot for undo BEFORE mutating - both the rocket's site
  // and the full route shape + the segments we're about to walk,
  // so an undo can slide back along the exact path.
  const newSiteId = turn1[turn1.length - 1].to;
  const arrived = _activeData.sites.find((x) => x.id === newSiteId);
  const arrivedName = arrived ? arrived.name : newSiteId;
  const arrivedZone = arrived && arrived.solarZone ? arrived.solarZone : null;
  // Record everything we'll need to undo BEFORE mutating - site,
  // route, segments walked, the chit (if any) we're about to
  // award for first-time zone entry, and the auto-cash payload
  // (if we're landing back at LEO with chits in hand).
  const willAwardChit = arrivedZone && arrivedZone !== 'Earth' && !isZoneVisited(arrivedZone);
  const willCashIn = isLeoSite(arrived) && getChits().length > 0;
  const chitsToCash = willCashIn ? getChits() : [];
  _moveSnapshot = {
    siteId: _rocketSiteId,
    route: _plannedRoute.map((s) => ({ ...s })),
    movedSegments: turn1.map((s) => ({ ...s })),
    awardedZone: willAwardChit ? arrivedZone : null,
    cashedChits: null,        // filled in below if a cash-in fires
    cashedVps:   0,
  };
  // Animate first - tweens position over ~700 ms, ease-in-out.
  setStatus(`🛸 Moving rocket to <strong>${esc(arrivedName)}</strong>…`);
  await animateRocketAlong(turn1);
  _rocketSiteId = newSiteId;
  persistRocketSite();
  // Add the walked segments to the persistent trail (drawn cyan).
  _rocketTrail = _rocketTrail.concat(turn1.map((s) => ({ from: s.from, to: s.to })));
  persistRocketTrail();
  _renderer.setRocketTrail(_rocketTrail);
  // Log the move + award glory chit on first-time zone entry +
  // auto-cash any chits if we just landed at LEO. Each side-
  // effect appends to the mission log so the player can audit
  // (and undo) the whole sequence as one move.
  // Hazardous moves (paid OR rolled) lock undo for the turn -
  // both the log entry's undoable flag and a separate flag the
  // undo button consults so the lockout dialog can explain WHY
  // the move is sticky.
  if (hazardChoice === 'pay' || hazardChoice === 'roll') {
    setHazardousMove(true);
  }
  logAction({
    type: 'move',
    icon: '🛸',
    summary: hazardChoice === 'pay'
      ? `Moved to ${arrivedName} (paid past ${hazards.length} hazard${hazards.length === 1 ? '' : 's'})`
      : hazardChoice === 'roll'
        ? `Moved to ${arrivedName} (rolled through ${hazards.length} hazard${hazards.length === 1 ? '' : 's'})`
        : `Moved to ${arrivedName}`,
    undoable: hazardChoice !== 'pay' && hazardChoice !== 'roll',
    data: { siteId: newSiteId, zone: arrivedZone, hazardous: !!hazardChoice && hazardChoice !== 'cancel' },
  });
  if (willAwardChit) {
    awardChitForZone(arrivedZone, getTurn());
    const vp = getChitVpValue(arrivedZone);
    logAction({
      type: 'glory_award',
      icon: '🏆',
      summary: `Glory chit earned - ${arrivedZone} (${vp} VP at cash-in)`,
      undoable: false,
    });
  }
  if (willCashIn) {
    const res = cashInChits(`returned to ${arrivedName}`);
    _moveSnapshot.cashedChits = chitsToCash;
    _moveSnapshot.cashedVps   = res.vps;
    logAction({
      type: 'glory_cash',
      icon: '💰',
      summary: `Cashed ${chitsToCash.length} chit${chitsToCash.length === 1 ? '' : 's'} for ${res.vps} VP`,
      undoable: false,
    });
  }
  // Shift remaining segments down a turn (T2→T1, T3→T2, …).
  const remaining = _plannedRoute
    .filter((s) => s.turn > 1)
    .map((s) => ({ ...s, turn: s.turn - 1 }));
  if (remaining.length) {
    _plannedRoute = remaining;
    persistPlannedRoute();
    _renderer.setRoute(remaining);
    const nextBurns = remaining.filter((s) => s.turn === 1).length;
    setStatus(
      `🛸 Moved to <strong>${esc(arrivedName)}</strong>. `
      + `${nextBurns} burn${nextBurns === 1 ? '' : 's'} queued for next turn.`
    );
  } else {
    _plannedRoute = null;
    persistPlannedRoute();
    _renderer.setRoute(null);
    _renderer.setRouteEndpoints(null, null);
    _routeFrom = null;
    _routeTo = null;
    const clearBtn = document.getElementById('route-clear');
    if (clearBtn) clearBtn.hidden = true;
    setStatus(`🛸 Arrived at <strong>${esc(arrivedName)}</strong>.`);
  }
  // Final sync - the animation left the sprite at the destination's
  // pixel coords; this pins it back to the canonical site (x, y)
  // and ensures canFly reflects the live stack state.
  syncSandboxRocket();
  refreshOpenSitePopup();
  return true;
}

// Restore the pre-move state captured in _moveSnapshot. Wired to
// the 🛸 toggle's "undo" face (yellow ↩ 🛸) - the player can step
// back as long as they haven't ended the turn yet. The rocket
// slides backwards along the exact segments it walked.
async function undoRocketMove() {
  if (!_renderer) return false;
  if (_rocketAnimating) return false;
  // Hazard-lockout: if the last move spent aqua or rolled dice,
  // the undo is blocked for the rest of the turn. Show a clear
  // "why" dialog so the player isn't confused by the dead button.
  if (_lastMoveHazardous) {
    await blockedUndoModal();
    return false;
  }
  if (!_moveSnapshot) {
    // No snapshot but the budget is spent - just refund so the
    // button flips back to the move face. Rare path (e.g. moved
    // before a reload that dropped the snapshot).
    refundMove();
    return false;
  }
  // Animate back along the segments we walked, in reverse.
  const moved = _moveSnapshot.movedSegments || [];
  const reverseSegs = moved
    .slice()
    .reverse()
    .map((s) => ({ from: s.to, to: s.from }));
  // Pop the moved segments off the trail immediately so it doesn't
  // visually overshoot the rocket during the rewind tween.
  if (moved.length && _rocketTrail.length >= moved.length) {
    _rocketTrail = _rocketTrail.slice(0, _rocketTrail.length - moved.length);
    persistRocketTrail();
    _renderer.setRocketTrail(_rocketTrail);
  }
  // Unwind glory side-effects in reverse order: cash-in first
  // (restore chits to inventory + refund VPs), then revoke the
  // first-time-zone chit that was earned by the move. Each pops
  // its matching log entry so the audit trail stays consistent.
  if (_moveSnapshot.cashedChits && _moveSnapshot.cashedChits.length) {
    uncashChits(_moveSnapshot.cashedChits, _moveSnapshot.cashedVps || 0);
    popLastOfType('glory_cash');
  }
  if (_moveSnapshot.awardedZone) {
    revokeChitForZone(_moveSnapshot.awardedZone);
    popLastOfType('glory_award');
  }
  popLastOfType('move');
  setStatus('🛸 Rewinding rocket move…');
  await animateRocketAlong(reverseSegs);
  _rocketSiteId = _moveSnapshot.siteId;
  persistRocketSite();
  _plannedRoute = _moveSnapshot.route;
  persistPlannedRoute();
  if (_plannedRoute && _plannedRoute.length) {
    _renderer.setRoute(_plannedRoute);
    const first = _plannedRoute[0];
    const last  = _plannedRoute[_plannedRoute.length - 1];
    _renderer.setRouteEndpoints(first.from, last.to);
    const clearBtn = document.getElementById('route-clear');
    if (clearBtn) clearBtn.hidden = false;
  }
  _moveSnapshot = null;
  refundMove();
  syncSandboxRocket();
  refreshOpenSitePopup();
  setStatus('🛸 Rocket move undone.');
  return true;
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
    `Picking destination from <strong>${esc(origin.name)}</strong> - `
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
      setStatus(`<strong>${esc(site.name)}</strong> is not landable - pick another site.`);
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
    // of the map. Keeps the existing zoom - jumping zoom on every
    // tap would be disorienting.
    _renderer.panTo(site);
  }

  if (site.isDecorative) {
    setStatus(`Decorative routing node - not selectable.`);
    return;
  }

  showSitePopupFor(site);
  setStatus(`Selected <strong>${esc(site.name)}</strong>.`);
}

// Build the on-map popup for a selected site. Carries the same
// info the old "Site info" sidebar pane used to show, plus the
// "Navigate to" action that arms routing-pick mode.
// Re-render the currently-open site popup, if any. Called after
// per-turn state changes (end-turn refills budgets; refuel-this-
// turn log resets) and after rocket-state changes (new prospector
// active, tank empty/full, supports change) so the popup's
// enabled / disabled buttons stay in sync with reality. No-op when
// nothing is selected.
// Route-options modal: lets the player flip the metric priority
// the planner uses (turns-first vs burns-first). Persisted via
// setRoutePriority. onClose fires after the player picks so the
// site popup can re-render its gear tooltip.
// Top-level game-settings modal. Wraps the route-options chooser
// and reserves room for any future sandbox settings (display
// density, accessibility toggles, dev flags). Reachable from the
// toolbar ⚙ button as well as inline gears scattered through
// the popups; everything ends up here.
function openGameSettingsModal() {
  // For now the only setting block IS the route options; reuse
  // the same modal so the player sees one familiar surface.
  // When more settings land, this becomes the parent surface
  // and route-options collapses into a section heading.
  openRouteOptionsModal(() => {
    if (_selectedId) refreshOpenSitePopup();
  });
}

function openRouteOptionsModal(onClose) {
  document.querySelector('.route-options-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay route-options-overlay';
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (onClose) onClose();
  };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  const panel = document.createElement('div');
  panel.className = 'route-options-panel';
  panel.innerHTML = `
    <button type="button" class="modal-x" aria-label="Close (Esc)" title="Close (Esc)">×</button>
    <h2 class="route-options-title">⚙ Route options</h2>
    <p class="muted route-options-sub">
      Which metric should the planner minimize first? The other
      one becomes the tiebreaker.
    </p>
    <div class="route-options-choices">
      <label class="route-options-choice ${_routePriority === 'turns' ? 'is-active' : ''}">
        <input type="radio" name="route-priority" value="turns"
          ${_routePriority === 'turns' ? 'checked' : ''}>
        <div>
          <strong>Fewer turns first</strong>
          <em>Default. Adjacent nodes go in 1 hop even when a longer
          Hohmann path would be free in burns.</em>
        </div>
      </label>
      <label class="route-options-choice ${_routePriority === 'burns' ? 'is-active' : ''}">
        <input type="radio" name="route-priority" value="burns"
          ${_routePriority === 'burns' ? 'checked' : ''}>
        <div>
          <strong>Fewer burns first</strong>
          <em>Save water by riding free Hohmann transfers, even if it
          costs extra turn-ends to coast.</em>
        </div>
      </label>
    </div>
  `;
  panel.querySelector('.modal-x').addEventListener('click', close);
  panel.querySelectorAll('input[name="route-priority"]').forEach((el) => {
    el.addEventListener('change', () => {
      if (el.checked) {
        setRoutePriority(el.value);
        // Repaint highlight state on the labels.
        panel.querySelectorAll('.route-options-choice').forEach((c) => {
          c.classList.toggle('is-active',
            c.querySelector('input').value === _routePriority);
        });
      }
    });
  });

  overlay.appendChild(panel);
  mountOverlay(overlay);
}

function refreshOpenSitePopup() {
  if (!_selectedId || !_activeData) return;
  const site = _activeData.byId && _activeData.byId[_selectedId];
  if (site) showSitePopupFor(site);
}

function showSitePopupFor(site) {
  if (!_renderer) return;
  const canNavigate = !(site.isDecorative || site.isLandable === false);
  const rocketReady = canPlanRocketRoute();
  // Order: rocket-plan FIRST - it's the game action and the one
  // the player will reach for most. Navigate-to is the secondary
  // "check distance" affordance. Rocket-plan is enabled whenever
  // the destination is landable; the turn breakdown uses a fixed
  // per-turn budget so we don't need an active thruster to draw
  // the route (the engage button on the stack modal is where
  // missing-rocket gating lives).
  // Build the action list in priority order. Navigate-to is the
  // pure-inspection affordance (no game state changes) and goes
  // LAST per the CLAUDE.md style rule - all real game actions
  // (Plan rocket route, Prospect, Refuel) precede it.
  const openRouteOptions = () => openRouteOptionsModal(() => {
    if (_selectedId) refreshOpenSitePopup();
  });
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
      // Inline ⚙ gear next to the plan-route button. Opens the
      // route-options modal so the player can flip the metric
      // priority (turns vs burns) without leaving the popup.
      // Same modal is also reachable from the toolbar's ⚙
      // game-settings button.
      trailing: {
        label: '⚙',
        variant: 'secondary',
        title: `Route options (current priority: ${_routePriority} first)`,
        onClick: openRouteOptions,
      },
    },
  ];
  // Prospect action - only show when there's an active prospector
  // in the stack AND it's eligible to scan this site. Missile /
  // buggy require the rocket to be parked on the target; raygun
  // does a line-of-sight check through transparent waypoints.
  // Disabled-but-visible when an active prospector exists but
  // can't reach, so the player gets a tooltip explaining why
  // (vs. silently dropping the button).
  const prosp = getActiveProspectorStats();
  const rocketSite = getRocketSite();
  if (prosp) {
    const check = canProspect(_activeData, rocketSite?.id, site.id, prosp.kind);
    const supportsOk = prosp.canActivate;
    const existingDisc = getDisc(site.id);
    // ISRU rule: the rig's ISRU must be <= the site's water
    // (hydration). ISRU 0 / missing clears the gate. This is the
    // "rig sensitivity" gate - a low-ISRU rig handles even dry
    // sites; a high-ISRU rig only works on wet ones. Note the
    // site's "number" (siteSize leading digit) is a DIFFERENT
    // value used for the prospect-roll threshold + the refining-
    // yield formula; don't confuse them.
    const prospIsru   = prospectorIsruValue(prosp.card);
    const siteWater   = Number.isFinite(site.hydration) ? site.hydration : 0;
    const isruOk      = prospIsru <= siteWater;
    const ok = check.ok && supportsOk && !existingDisc && isruOk;
    const kindGlyph = { missile: '🚀', raygun: '🔫', buggy: '🛺' }[prosp.kind] || '🔬';
    const reason = existingDisc
      ? `This site already has a ${existingDisc.outcome === 'success' ? 'claim' : 'failed-prospect'} disc.`
      : !supportsOk
        ? `Prospector needs ${(prosp.missingSuppliers || []).join(' + ')} support.`
        : !isruOk
          ? `Rig ISRU ${prospIsru} > site water ${siteWater}. Need a rig with ISRU ≤ water.`
          : check.reason;
    actions.push({
      label: `${kindGlyph} Prospect (${prosp.kind})`,
      // Blue rocket variant when the action is actually
      // available; dim secondary when something blocks. Reads
      // as a real game-action when live.
      variant: ok ? 'rocket' : 'secondary',
      disabled: !ok,
      title: reason || undefined,
      onClick: () => {
        if (!ok) return;
        doProspect(site, prosp);
        _renderer.clearSitePopup();
      },
    });
  }
  // Refuel action. The rocket can pull water from a hydrated site
  // when it's parked on it AND the site's water rating meets the
  // active prospector's ISRU floor (the ISRU rig drives both
  // prospecting AND refining capability in this sandbox until
  // dedicated refinery cards land in Stage 3+). Each refuel adds
  // water = site.hydration to the tank, capped at the tank max.
  // One refuel per (turn, site) so the player can't strip-mine
  // the site by hammering the button.
  if (rocketSite && site.id === rocketSite.id) {
    const refuelChk = canRefuelAt(site);
    actions.push({
      label: refuelChk.label,
      // Blue rocket variant when the action is actually
      // available; dim secondary when blocked. Same idiom as
      // the prospect button so live ops read as live ops.
      variant: refuelChk.ok ? 'rocket' : 'secondary',
      disabled: !refuelChk.ok,
      title: refuelChk.reason || undefined,
      onClick: () => {
        if (!refuelChk.ok) return;
        doRefuel(site);
        _renderer.clearSitePopup();
      },
    });
  }
  // Navigate-to ALWAYS sits last (CLAUDE.md style rule). It's a
  // pure inspection affordance - no state mutation - so any new
  // game-action buttons land above it.
  actions.push({
    label: 'Navigate to →',
    variant: 'secondary',
    disabled: !canNavigate,
    onClick: () => {
      if (!canNavigate) return;
      enterRoutingMode(site);
      _renderer.clearSitePopup();
    },
  });
  // Push the player's current rig info so the popup can render
  // the ISRU chip ("Your ISRU 2 vs 4 water ✓") without the
  // renderer needing to import rocket state directly.
  _renderer.setPopupRocketInfo(prosp
    ? { isru: prospectorIsruValue(prosp.card), kind: prosp.kind }
    : null);
  _renderer.setSitePopup(site, actions);
  _renderer.onPopupClose(() => {
    _selectedId = null;
    if (_renderer) _renderer.setRouteEndpoints(null, null);
  });
}

// True when there's an active thruster (or missile-class robonaut
// with a thrust value) the player can fly from LEO. Doesn't
// require all supports satisfied yet - if the route is plannable
// in principle, show it even if the rocket can't actually engage
// today; the totals row in the stack modal still flags wet-mass
// vs thrust separately.
function canPlanRocketRoute() {
  const stack = getRocketStack();
  const activeId = getActiveThrusterId();
  if (!activeId) return false;
  return stack.some((s) => s.id === activeId);
}

// Plan a rocket route from the rocket's current site to `destSite`,
// using the ported vendor mission planner (planner-nav.js). The
// planner knows about Hohmann pivots, direction-change costs,
// burn budgets, hazard avoidance, and Venus flyby bonuses; our
// old nav.js was a flat Dijkstra over dv values and got all of
// those wrong. Per-turn burn budget = the active thruster's
// thrust value (defaults to 4 when no thruster is active).
function planRocketRouteTo(destSite) {
  if (!_renderer || !_activeData) return false;
  // Origin = wherever the rocket currently is (default LEO). Once
  // the rocket has moved, plans should start from its actual
  // position, not snap back to LEO.
  const origin = getRocketSite();
  if (!origin) {
    setStatus('Could not find a launch origin.');
    return false;
  }
  if (destSite.id === origin.id) {
    setStatus(`Rocket is already at ${esc(origin.name)} - pick a different destination.`);
    return false;
  }
  // Active-thruster thrust drives the per-turn burn budget. When
  // no thruster is selected we fall back to 4 (HF4's stock LEO
  // budget) so the route still computes - the rocket simply
  // won't be flyable until a thruster is assigned.
  const thrStats = getActiveThrusterStats();
  const thrust = thrStats && Number.isFinite(thrStats.thrust) ? thrStats.thrust : 4;
  const result = planRoute(_activeData, origin.id, destSite.id, {
    thrust,
    metricPriority: routeMetricPriority(),
  });
  if (!result || !result.segments.length) {
    setStatus(
      `No rocket route from <strong>${esc(origin.name)}</strong> to `
      + `<strong>${esc(destSite.name)}</strong>.`
    );
    _renderer.setRoute(null);
    _renderer.setRouteEndpoints(origin.id, destSite.id);
    return false;
  }
  _routeFrom = origin;
  _routeTo = destSite;
  _plannedRoute = result.segments;
  persistPlannedRoute();
  _renderer.setRoute(result.segments);
  _renderer.setRouteEndpoints(origin.id, destSite.id);
  document.getElementById('route-clear').hidden = false;
  const turns = result.totalTurns;
  setStatus(
    `🛸 <strong>${esc(origin.name)}</strong> → <strong>${esc(destSite.name)}</strong>: `
    + `<strong class="big">${result.totalBurns}</strong> burn${result.totalBurns === 1 ? '' : 's'} over `
    + `<strong>${turns}</strong> turn${turns === 1 ? '' : 's'} `
    + `(thrust ${thrust}).`
  );
  return true;
}

function clearRoute() {
  _routeFrom = null;
  _routeTo = null;
  _plannedRoute = null;
  persistPlannedRoute();
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

// Kinds whose supplier is implicit ("any reactor", "any
// generator") - clicking the chip means filter to all members of
// the family. Used both by the card-grid filter and the sub-tab
// auto-select when a card chip points the library here.
const SUPPORT_KIND_EXPANSIONS = {
  'reactor-any': ['reactor-fission', 'reactor-fusion', 'reactor-antimatter'],
};
function expandSupportKinds(kinds) {
  const out = new Set();
  for (const k of kinds) {
    const exp = SUPPORT_KIND_EXPANSIONS[k];
    if (exp) for (const e of exp) out.add(e);
    else out.add(k);
  }
  return [...out];
}

// Build the canonical list of support kinds that have at least
// one supplier card. Driven off the live deck so the sub-tab row
// stays in sync with whatever the spreadsheet ships - new
// supplies show up automatically.
function listSupplyKinds() {
  const order = [
    'reactor-fission', 'reactor-fusion', 'reactor-antimatter',
    'gen-radioisotope', 'gen-electric',
    'thermostat',
    'beam-receiver', 'aerobrake-shroud', 'crew-quarters',
    'spin-grav', 'pulse-generator', 'sail',
  ];
  const present = new Set();
  for (const p of PATENTS) {
    const sup = (p.faces && p.faces.primary && p.faces.primary.supplies) || p.supplies || [];
    for (const k of sup) present.add(k);
  }
  // Sort: known order first, anything new appended.
  const known = order.filter((k) => present.has(k));
  for (const k of present) if (!order.includes(k)) known.push(k);
  return known;
}

// Cards whose primary face supplies at least one of the given
// kinds. Used to populate the grid under the supports tab.
function patentsThatSupply(kinds) {
  if (!kinds || !kinds.length) return [];
  const want = new Set(expandSupportKinds(kinds));
  const out = [];
  for (const p of PATENTS) {
    const sup = (p.faces && p.faces.primary && p.faces.primary.supplies) || p.supplies || [];
    if (sup.some((k) => want.has(k))) out.push(p);
  }
  return out;
}

// Inline glyph for a support kind, matching the card chip idiom
// (SVG for sun / ballerina, emoji for the rest). Wrapped <em> so
// CSS rules that key off `.req em` apply unchanged.
function supportKindGlyphHtml(kind) {
  if (kind === 'beam-receiver')  return svgSunChip(14);
  if (kind === 'spin-grav')      return svgBallerinaChip(14);
  const vis = REQUIREMENT_VIS[kind];
  return `<em>${(vis && vis.glyph) || '◇'}</em>`;
}

// Module-level seed for openPatentsSupports - lets the rocket-
// stack modal hand the library a starting selection. Consumed
// once by renderPatents.
let _pendingPatentSelection = null;
export function openPatentsSupports(kinds) {
  const want = expandSupportKinds(kinds || []);
  _pendingPatentSelection = { type: 'supports', kinds: want };
  showPane('patents');
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
  // Expansion types (currently 'gw-thruster') get their own tab
  // at the end so the player can preview the unlocked content
  // without it cluttering the buildable list. The tab label
  // marks it as soon-only so there's no surprise when grab
  // buttons refuse to engage.
  const expansionTypes = ['gw-thruster'];
  // 'supports' is a synthetic filter that groups every card
  // whose primary face SUPPLIES a stack-support chip (reactors,
  // generators, radiators today). A sub-row of kind chips lets
  // the player narrow to a single requirement. The rocket-stack
  // modal jumps directly here when the player taps a support
  // chip on a card so they can see what would fill that slot.
  const supplyKinds = listSupplyKinds();
  const types = [...PATENT_TYPES, 'supports', 'crew', ...expansionTypes];
  const counts = Object.fromEntries(PATENT_TYPES.map((t) => [t, patentsByType(t).length]));
  for (const t of expansionTypes) counts[t] = patentsByType(t).length;
  counts.crew = CREW.length;
  counts.supports = patentsThatSupply(supplyKinds).length;
  const TYPE_LABEL = {
    'gw-thruster': 'GW thrusters (soon)',
    'supports': 'Supports',
  };
  // Seed initial active tab from a pending programmatic open
  // (openPatentsSupports), falling back to the first type.
  const seed = _pendingPatentSelection;
  const initialType = (seed && types.includes(seed.type)) ? seed.type : types[0];
  types.forEach((t) => {
    const label = TYPE_LABEL[t] || cap(t);
    const active = t === initialType ? ' class="active"' : '';
    bar.innerHTML += `<button${active} data-type="${t}">${label} (${counts[t]})</button>`;
  });
  host.appendChild(bar);

  // Sub-filter row for the Supports tab: one chip per supply
  // kind, multi-select. Hidden when any other type tab is
  // active so the row doesn't clutter the non-supports views.
  const supportRow = document.createElement('div');
  supportRow.className = 'patent-supports-filter';
  const activeSupportKinds = new Set();
  if (seed && seed.type === 'supports' && seed.kinds) {
    for (const k of seed.kinds) if (supplyKinds.includes(k)) activeSupportKinds.add(k);
  }
  const renderSupportRow = () => {
    supportRow.innerHTML = '';
    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'patent-support-chip is-all'
      + (activeSupportKinds.size === 0 ? ' is-active' : '');
    allBtn.textContent = `All (${counts.supports})`;
    allBtn.addEventListener('click', () => {
      activeSupportKinds.clear();
      renderSupportRow();
      repaintActive();
    });
    supportRow.appendChild(allBtn);
    for (const k of supplyKinds) {
      const supplier = REQ_SUPPLIER_TYPE[k] || null;
      const vis = REQUIREMENT_VIS[k] || { label: k };
      const n = patentsThatSupply([k]).length;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'patent-support-chip';
      if (supplier) chip.dataset.supplier = supplier;
      if (activeSupportKinds.has(k)) chip.classList.add('is-active');
      chip.dataset.kind = k;
      chip.title = vis.label;
      chip.innerHTML = `${supportKindGlyphHtml(k)}<span class="lbl">${vis.label}</span><b>${n}</b>`;
      chip.addEventListener('click', () => {
        if (activeSupportKinds.has(k)) activeSupportKinds.delete(k);
        else activeSupportKinds.add(k);
        renderSupportRow();
        repaintActive();
      });
      supportRow.appendChild(chip);
    }
  };
  renderSupportRow();
  host.appendChild(supportRow);
  supportRow.classList.toggle('is-visible', initialType === 'supports');

  // Consume the programmatic seed so a later manual reopen of
  // the pane doesn't snap back to the supports tab.
  _pendingPatentSelection = null;

  const grid = document.createElement('div');
  grid.className = 'card-grid';
  host.appendChild(grid);

  // Each physical card exists in exactly one location: deck,
  // hand, or rocket. The library grid decorates every tile with
  // its current location so the player can see where each card
  // is at a glance - ✋ overlay for hand, 🛸 overlay for rocket.
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
    if (inHand || inRocket) return el;   // placeholder - not interactive
    // Expansion-only cards (GW thrusters today) preview but
    // can't be played. Mark + return early so the drag /
    // tap-to-add handlers don't bind. A CSS overlay tells the
    // player why.
    if (card.type === 'gw-thruster') {
      el.classList.add('is-expansion');
      const badge = document.createElement('div');
      badge.className = 'card-expansion-badge';
      badge.textContent = 'Coming soon';
      el.appendChild(badge);
      return el;
    }

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
    if (filter === 'supports') {
      // No sub-chip selected = every card with a non-empty
      // supplies list. Sub-chips narrow further; multiple
      // selected chips OR together.
      const want = activeSupportKinds.size
        ? [...activeSupportKinds]
        : supplyKinds;
      for (const p of patentsThatSupply(want)) {
        grid.appendChild(decorateForHand(p, 'patent'));
      }
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
      // Show the sub-filter chip row only on the Supports tab -
      // every other tab hides it so the row doesn't take vertical
      // space when it's meaningless.
      supportRow.classList.toggle('is-visible', b.dataset.type === 'supports');
      repaint(b.dataset.type);
    };
  });
  repaint(initialType);
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

// Glory pane: live HF4-style ticker-tape readout plus the legacy
// milestone deck below for reference. Re-renders on every glory
// state change so the chit row + VP counter stay live.
let _gloryListenerHooked = false;
function renderMilestones() {
  if (!_gloryListenerHooked) {
    _gloryListenerHooked = true;
    onGloryChange(() => {
      const panel = document.getElementById('browse-sidepanel');
      if (panel && panel.dataset.active === 'milestones') paintGlory();
    });
  }
  paintGlory();
}
function paintGlory() {
  const host = document.getElementById('browse-milestones');
  if (!host) return;
  const chits = getChits();
  const vps   = getVps();
  const zonesEarned = chits.length
    ? chits.map((c) => `<span class="glory-chit" data-zone="${esc(c.zone)}">
          <strong>${esc(c.zone)}</strong>
          <em>+${getChitVpValue(c.zone)} VP</em>
        </span>`).join('')
    : '<p class="muted">No glory chits carried. Land the rocket on a new heliocentric zone to earn one.</p>';
  const zoneTableRows = Object.entries(ZONE_CHIT_VPS)
    .filter(([z]) => z !== 'Earth')
    .map(([z, v]) => `<li><span>${esc(z)}</span><strong>+${v} VP</strong></li>`)
    .join('');
  host.innerHTML = `
    <section class="glory-summary">
      <h3>🏆 Glory</h3>
      <div class="glory-vp-row">
        <span class="muted">Career VP</span>
        <strong class="glory-vp">${vps}</strong>
      </div>
      <h4>Chits in hand</h4>
      <div class="glory-chits">${zonesEarned}</div>
      <h4>Ticker-tape table</h4>
      <ul class="glory-table">${zoneTableRows}</ul>
      <p class="muted glory-rules">
        Land the rocket in a heliocentric zone for the first time to
        earn a chit. Return to LEO to convert all chits to VP.
      </p>
    </section>
  `;
}

// Mission log pane: every action the player took this turn, plus
// the per-turn history below. Undo Last calls the matching
// per-feature undo (currently only `move` is wired); the log entry
// is popped by the feature itself so we stay consistent. Re-paints
// on every log change.
let _logListenerHooked = false;
function renderMissionLog() {
  if (!_logListenerHooked) {
    _logListenerHooked = true;
    onLogChange(() => {
      const panel = document.getElementById('browse-sidepanel');
      if (panel && panel.dataset.active === 'log') paintMissionLog();
    });
  }
  paintMissionLog();
}
function paintMissionLog() {
  const host = document.getElementById('browse-log');
  if (!host) return;
  const actions = getActions();
  const history = getHistory();
  const lastUndoableIdx = (() => {
    for (let i = actions.length - 1; i >= 0; i--) {
      if (actions[i].type === 'move') return i;
    }
    return -1;
  })();
  const turnActions = actions.length
    ? actions.map((a, i) => `
        <li class="log-row ${i === lastUndoableIdx ? 'is-undoable-now' : ''}">
          <span class="log-icon">${esc(a.icon || '·')}</span>
          <span class="log-summary">${esc(a.summary)}</span>
        </li>`).join('')
    : '<li class="muted log-empty">No actions yet this turn.</li>';
  const historyRows = history.length
    ? history.slice().reverse().slice(0, 8).map((h) => {
        const ev = h.event ? ` · d6 = ${h.event.dieRoll}` : '';
        return `<li class="hist-row">
          <header>Round ${h.round ?? '?'} · Turn ${h.turn ?? '?'}${ev}</header>
          <ol>${
            h.actions.map((a) => `<li>${esc(a.icon)} ${esc(a.summary)}</li>`).join('')
          }</ol>
        </li>`;
      }).join('')
    : '';
  host.innerHTML = `
    <section class="log-current">
      <h3>📋 This turn</h3>
      <div class="log-actions-bar">
        <button class="popup-btn primary"
          id="log-undo-last" ${lastUndoableIdx < 0 ? 'disabled' : ''}>
          ↩ Undo last move
        </button>
        <button class="popup-btn"
          id="log-undo-all" ${actions.filter((a) => a.type === 'move').length === 0 ? 'disabled' : ''}>
          ⏪ Undo all moves this turn
        </button>
      </div>
      <ul class="log-list">${turnActions}</ul>
    </section>
    ${history.length ? `
      <section class="log-history">
        <h4>Past turns (${history.length})</h4>
        <ol class="hist-list">${historyRows}</ol>
      </section>` : ''
    }
  `;
  host.querySelector('#log-undo-last')?.addEventListener('click', () => {
    undoRocketMove();
  });
  host.querySelector('#log-undo-all')?.addEventListener('click', async () => {
    // Repeatedly undo while there are move entries. Each call
    // awaits the rewind animation before kicking the next so the
    // user can watch the rocket trace its way back home.
    while (getActions().some((a) => a.type === 'move')) {
      const ok = await undoRocketMove();
      if (!ok) break;
    }
  });
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
      if (!confirm('Reset sandbox? This clears your hand, your rocket’s stack, position, planned route, discs, glory, mission log, and the turn clock.')) return;
      clearHand();
      rocketClearStack();
      // Rocket position + trail + planned route + the move
      // snapshot that backs undo. Clearing _rocketSiteId via the
      // helper persists the empty state so reload doesn't restore
      // the prior journey.
      _rocketSiteId = null;
      persistRocketSite();
      _rocketTrail = [];
      persistRocketTrail();
      _plannedRoute = null;
      persistPlannedRoute();
      _moveSnapshot = null;
      if (_renderer) {
        _renderer.setRoute(null);
        _renderer.setRouteEndpoints(null, null);
        _renderer.setRocketTrail(null);
      }
      // Game-state systems.
      try { localStorage.removeItem(STORAGE_REFUEL_LOG); } catch {}
      resetDiscs();
      resetGlory();
      resetLog();
      resetClock();
      setStatus('Sandbox reset - hand, rocket, position, discs, glory, log, and clock cleared.');
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
  host.querySelector('.solo-here strong').textContent = here ? here.name : '-';
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
