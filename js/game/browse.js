// Browse view: map + patent deck + milestones + events.
//
// Read-only, no engine dependency. Lets a user inspect Stage 2 data
// without needing to start a multiplayer game. Reachable from the
// topbar; also acts as the "preview" surface that Stage 3 will
// replace with the live game.

import { MapRenderer } from './render.js';
import { loadPlannerMap } from './planner-map.js';
import { loadCleanMap } from './clean-map.js';
import { findPath } from './nav.js';
import {
  getState as soloState, newGame as soloNewGame, abandonGame as soloAbandon,
  setTarget as soloSetTarget, commitMove as soloCommitMove,
  prospect as soloProspect, endRound as soloEndRound,
  bindData as soloBindData, onChange as soloOnChange, SOLO_CONFIG,
} from './solo.js';
import { PATENTS, PATENTS_BY_ID, PATENT_TYPES, patentsByType } from '../../data/patents.js';
import {
  getHandSlots, addToHand, removeFromHandAt, clearHand, onHandChange,
} from './hand.js';
import {
  getRocketStack, addToStack as rocketAddCard, removeFromStack as rocketRemoveCard,
  onRocketChange, canRocketFly,
} from './rocket.js';
import { CREW } from '../../data/crew.js';
import { MILESTONES } from '../../data/glory.js';
import { POLITICS } from '../../data/politics.js';
import { SITES_BY_ID } from '../../data/sites.js';
import { renderCard } from './card-ui.js';

// User-selected map mode. Persists across sessions so the player
// keeps whichever view they prefer for playtesting. Default to the
// canonical planner graph since it routes more naturally.
const MAP_MODE_KEY = 'hf.mapMode';
function getMapMode() {
  const v = localStorage.getItem(MAP_MODE_KEY);
  return v === 'clean' ? 'clean' : 'classic';
}
function setMapMode(mode) {
  localStorage.setItem(MAP_MODE_KEY, mode);
}

async function loadMap(mode) {
  return mode === 'clean' ? loadCleanMap() : loadPlannerMap();
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
    onRocketChange(() => {
      syncSandboxRocket();
      // Re-render the rocket pane if it's currently open.
      const panel = document.getElementById('browse-sidepanel');
      if (panel && panel.dataset.active === 'rocket') renderRocketPane();
    });
  }
  wireSidebar();
  wireHandStrip();
  renderMap();
}

// Sandbox hand strip wiring: drop target, slot rendering, +
// the grabber bar that lets the user drag the strip up to see
// more cards. Card-click opens the inspect modal instead of
// removing the slot directly — Discard lives in the modal.
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
  host.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('text/card-id')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    host.classList.add('is-drop-target');
  });
  host.addEventListener('dragleave', () => host.classList.remove('is-drop-target'));
  host.addEventListener('drop', (e) => {
    e.preventDefault();
    host.classList.remove('is-drop-target');
    const id = e.dataTransfer.getData('text/card-id');
    const card = id && lookup(id);
    if (card) addToHand(card);
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
      wrap.dataset.slotIdx = String(idx);
      wrap.appendChild(renderCard(card, { type: kindOf(id) }));
      // Click anywhere on the slot opens the inspect modal —
      // discard / produce / add-to-stack live in there.
      wrap.addEventListener('click', (ev) => {
        // Allow the rotate / flip controls on the card itself
        // (which stopPropagation) to keep working without
        // opening the modal.
        if (ev.target.closest('.card-flip, .card-rotate')) return;
        openCardModal(card, kindOf(id), idx);
      });
      host.appendChild(wrap);
    });
  };

  repaintHand();
  onHandChange(repaintHand);
}

// Vertical resize grabber for the hand strip. Tracks a CSS
// variable on the strip element so the height is restored
// between repaints + survives onHandChange rerenders.
function wireHandGrabber(grabber, strip) {
  let startY = 0;
  let startH = 0;
  const onMove = (clientY) => {
    const dy = startY - clientY;            // drag up = positive
    const next = Math.max(120, Math.min(window.innerHeight * 0.7, startH + dy));
    strip.style.height = `${next}px`;
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
  endCustomDragGhost();  // belt-and-braces cleanup
  // 1px transparent GIF so the browser's default drag image
  // shows nothing — our ghost replaces it.
  const blank = new Image();
  blank.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
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
  addBtn.textContent = 'Add to hand';
  addBtn.addEventListener('click', () => {
    addToHand(card);
    close();
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'modal-btn cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', close);

  actions.append(addBtn, cancelBtn);
  panel.appendChild(actions);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
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

  const discardBtn = document.createElement('button');
  discardBtn.type = 'button';
  discardBtn.className = 'modal-btn discard';
  discardBtn.textContent = 'Discard';
  discardBtn.title = 'Return this card to the deck';
  discardBtn.addEventListener('click', () => {
    removeFromHandAt(slotIdx);
    close();
  });

  const produceBtn = document.createElement('button');
  produceBtn.type = 'button';
  produceBtn.className = 'modal-btn produce';
  produceBtn.textContent = `Exo produce (${card.spectralType || '?'})`;
  produceBtn.title = `Use a factory matching spectral type ${card.spectralType || '?'} to produce the dark-side resource`;
  produceBtn.addEventListener('click', () => {
    // Factories don't exist yet — Stage 3 will let the player
    // build one matching the card's spectral type. Surface the
    // intent so the player knows what's coming.
    setStatus(
      `Exo-produce needs a factory matching spectral type `
      + `<strong>${card.spectralType || '?'}</strong>. `
      + `Factories aren't buildable yet (Stage 3).`
    );
    close();
  });

  const stackBtn = document.createElement('button');
  stackBtn.type = 'button';
  stackBtn.className = 'modal-btn stack';
  stackBtn.textContent = 'Add to LEO stack';
  stackBtn.title = 'Add this card to your rocket parked in LEO';
  stackBtn.addEventListener('click', () => {
    rocketAddCard(card.id, kind);
    removeFromHandAt(slotIdx);
    close();
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'modal-btn cancel';
  cancelBtn.textContent = 'Close';
  cancelBtn.addEventListener('click', close);

  actions.append(discardBtn, produceBtn, stackBtn, cancelBtn);
  panel.appendChild(actions);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  // Escape closes too.
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
  // Render the pane lazily on first reveal.
  if      (pane === 'patents')    renderPatents();
  else if (pane === 'milestones') renderMilestones();
  else if (pane === 'events')     renderEvents();
  else if (pane === 'rocket')     renderRocketPane();
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
  await mountMapFor(getMapMode());
}

// Build the toolbar + route panel skeleton once. Subsequent calls
// (e.g. after toggling view mode) reuse the same shell and just
// rebuild the map host inside it.
function ensureMapShell(host) {
  if (host.dataset.shellReady === '1') return;
  host.dataset.shellReady = '1';
  host.innerHTML = `
    <div class="map-toolbar">
      <div class="map-mode-toggle">
        <button data-mode="clean">Cleaned up</button>
        <button data-mode="classic">Classic</button>
      </div>
      <div class="map-search">
        <input id="map-search-input" type="text" autocomplete="off"
          spellcheck="false" placeholder="Find site…" />
        <button id="map-search-go" title="Fly to site"
          aria-label="Fly to site">🔍</button>
        <ul id="map-search-suggestions" class="hidden"></ul>
      </div>
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
  for (const btn of host.querySelectorAll('.map-mode-toggle button')) {
    btn.addEventListener('click', async () => {
      const mode = btn.dataset.mode;
      if (mode === getMapMode()) return;
      setMapMode(mode);
      await mountMapFor(mode);
    });
  }
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
  const input  = host.querySelector('#map-search-input');
  const goBtn  = host.querySelector('#map-search-go');
  const list   = host.querySelector('#map-search-suggestions');
  if (!input || !goBtn || !list) return;
  let activeIndex = -1;
  let currentItems = [];

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

async function mountMapFor(mode) {
  // Mark the active toggle.
  const host = document.getElementById('browse-map');
  for (const btn of host.querySelectorAll('.map-mode-toggle button')) {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  }
  const canvas = host.querySelector('#browse-map-canvas');
  canvas.innerHTML = '<div class="map-loading">Loading map…</div>';
  _renderer = null;
  _routeFrom = null;
  _routeTo = null;
  updateRouteStatus();
  try {
    _activeData = await loadMap(mode);
    soloBindData(_activeData);
    _renderer = new MapRenderer(canvas, {
      data: _activeData,
      onSelect: onSiteSelect,
    });
    _renderer.onSandboxRocketClick = () => showPane('rocket');
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
// Stack panel: lists every card in the rocket, shows fly-status,
// and lets the player pull any card back into their hand.
function renderRocketPane() {
  const host = document.getElementById('rocket-panel');
  if (!host) return;
  const stack = getRocketStack();
  const flyable = canRocketFly();
  const lookup = (id) => PATENTS_BY_ID[id]
    || CREW.find((c) => c.id === id) || null;

  if (!stack.length) {
    host.innerHTML = `
      <p class="muted">Your rocket is empty. Add cards from your
      hand modal ("Add to LEO stack") to build a flyable ship.</p>
    `;
    return;
  }
  const statusHtml = flyable.ok
    ? `<p class="rocket-status ok">✓ Flyable — all supports satisfied.</p>`
    : `<p class="rocket-status bad">🚫 Cannot fly:</p>
       <ul class="rocket-issues">
         ${flyable.missing.map((m) => `<li>${esc(m)}</li>`).join('')}
       </ul>`;
  host.innerHTML = `${statusHtml}<div id="rocket-stack-cards"></div>`;
  const cards = host.querySelector('#rocket-stack-cards');
  stack.forEach((slot, idx) => {
    const card = lookup(slot.id);
    if (!card) return;
    const wrap = document.createElement('div');
    wrap.className = 'rocket-slot';
    wrap.appendChild(renderCard(card, { type: slot.kind || 'patent' }));
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'rocket-back-to-hand';
    back.textContent = '↩ Back to hand';
    back.addEventListener('click', () => {
      rocketRemoveCard(idx);
      addToHand(card);
    });
    wrap.appendChild(back);
    cards.appendChild(wrap);
  });
}

function syncSandboxRocket() {
  if (!_renderer) return;
  const stack = getRocketStack();
  if (!stack.length) {
    _renderer.setSandboxRocket(null);
    return;
  }
  const flyable = canRocketFly();
  _renderer.setSandboxRocket({
    x: 460, y: 270,         // LEO-ish anchor in cleaned-up coords
    colour: 'yellow',
    canFly: flyable.ok,
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

function populateSiteInfo(site) {
  const info = document.getElementById('browse-map-info');
  if (!info) return;
  info.innerHTML = `
    <h4 class="site-name"></h4>
    <ul class="kv">
      <li><span>Type</span><strong class="type"></strong></li>
      <li><span>Size / class</span><strong class="size"></strong></li>
      <li><span>Hydration</span><strong class="hyd"></strong></li>
      <li><span>Hazard</span><strong class="hazard"></strong></li>
      <li class="row-sub" hidden><span>Submarine</span><strong>🌊</strong></li>
      <li class="row-astro" hidden><span>Astrobiology</span><strong>🌿</strong></li>
      <li class="row-aero" hidden><span>Aerobrakes</span><strong class="aero">—</strong></li>
    </ul>
    <div class="site-actions">
      <button id="site-navigate-to" type="button" class="primary">
        Navigate to here →
      </button>
    </div>
  `;
  info.querySelector('.site-name').textContent = site.name;
  info.querySelector('.type').textContent = site.type;
  info.querySelector('.size').textContent = site.siteSize || '—';
  info.querySelector('.hyd').textContent = '💧'.repeat(site.hydration) || '—';
  info.querySelector('.hazard').textContent = site.hazard ? 'yes' : 'no';
  if (site.submarine)    info.querySelector('.row-sub').hidden   = false;
  if (site.astrobiology) info.querySelector('.row-astro').hidden = false;
  if (site.aerobrakes) {
    info.querySelector('.row-aero').hidden = false;
    info.querySelector('.aero').textContent = String(site.aerobrakes);
  }
  // "Navigate to" arms the routing-pick mode. The next site the
  // user taps becomes the destination of a route originating
  // from this one. Disabled on decorative / non-landable sites.
  const navBtn = info.querySelector('#site-navigate-to');
  if (site.isDecorative || site.isLandable === false) {
    navBtn.disabled = true;
    navBtn.title = 'This site is not landable.';
  } else {
    navBtn.addEventListener('click', () => enterRoutingMode(site));
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
    populateSiteInfo(site);
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
  // route and exit routing mode.
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
    const hops = result.segments.length;
    setStatus(
      `<strong>${esc(_routeFrom.name)}</strong> → <strong>${esc(_routeTo.name)}</strong>: ` +
      `<strong class="big">${result.totalBurns}</strong> burns over ${hops} hop${hops === 1 ? '' : 's'}.`
    );
    exitRoutingMode();
    return;
  }

  // Default tap behaviour: tap a site to select + show info;
  // tap the SAME site again to deselect. No route is started by
  // simple clicks — the user has to press "Navigate to" in the
  // info panel to begin routing.
  if (_selectedId === site.id) {
    _selectedId = null;
    if (_renderer) _renderer.setRouteEndpoints(null, null);
    setStatus('Tap a site to see its info. Press "Navigate to" to plan a route.');
    showPane(null);
    return;
  }

  _selectedId = site.id;
  if (_renderer) _renderer.setRouteEndpoints(site.id, null);

  if (site.isDecorative) {
    setStatus(`Decorative routing node — not selectable.`);
    return;
  }

  populateSiteInfo(site);
  showPane('info');
  setStatus(`Selected <strong>${esc(site.name)}</strong>.`);
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
  bar.innerHTML = `<button class="active" data-type="all">All (${PATENTS.length + CREW.length})</button>`;
  for (const t of PATENT_TYPES) {
    const n = patentsByType(t).length;
    bar.innerHTML += `<button data-type="${t}">${cap(t)} (${n})</button>`;
  }
  bar.innerHTML += `<button data-type="crew">Crew (${CREW.length})</button>`;
  host.appendChild(bar);

  const grid = document.createElement('div');
  grid.className = 'card-grid';
  host.appendChild(grid);

  // Each tile in the grid is draggable AND tappable. Multi-
  // copies allowed (the hand state stores duplicates as
  // separate slots), so we no longer mark grabbed cards —
  // every grab just appends a fresh slot. On mobile (where
  // HTML5 drag-and-drop is unreliable) clicking a card pops a
  // confirm prompt to add it to the hand.
  const decorateForHand = (card, asKind) => {
    const el = renderCard(card, { type: asKind });
    el.dataset.cardId  = card.id;
    el.dataset.cardKind = asKind;
    el.draggable = true;
    el.addEventListener('dragstart', (ev) => {
      ev.dataTransfer.setData('text/card-id', card.id);
      ev.dataTransfer.setData('text/card-kind', asKind);
      ev.dataTransfer.effectAllowed = 'copy';
      el.classList.add('is-dragging');
      startCustomDragGhost(el, ev);
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('is-dragging');
      endCustomDragGhost();
    });
    el.addEventListener('click', (ev) => {
      // Let the card's own Flip / Rotate buttons keep working.
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
      if (filter !== 'all' && p.type !== filter) continue;
      grid.appendChild(decorateForHand(p, 'patent'));
    }
    if (filter === 'all') {
      for (const c of CREW) grid.appendChild(decorateForHand(c, 'crew'));
    }
  };

  bar.querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      bar.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      repaint(b.dataset.type);
    };
  });
  repaint('all');
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
      <button class="primary" id="solo-new" title="Start a new solo game">Reset</button>
    `;
    host.querySelector('#solo-new').onclick = () => {
      soloNewGame();
      paintSolo();
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
