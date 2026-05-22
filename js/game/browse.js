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
  getHandIds, isInHand, addToHand, removeFromHand, clearHand,
  onHandChange, typeInHand,
} from './hand.js';
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

export function mountBrowse() {
  const view = document.getElementById('view-browse');
  if (!view) return;
  wireSidebar();
  wireHandStrip();
  renderMap();
}

// Sandbox hand strip wiring: makes the bottom strip a drop
// target, renders the current hand into it, and keeps it in
// sync with the hand state via onHandChange.
let _handWired = false;
function wireHandStrip() {
  if (_handWired) return;
  _handWired = true;
  const strip   = document.getElementById('sandbox-hand');
  const host    = document.getElementById('sandbox-hand-cards');
  const countEl = document.getElementById('hand-count');
  const clearBtn = document.getElementById('hand-clear');
  if (!strip || !host) return;

  const lookup = (id) => PATENTS_BY_ID[id]
    || CREW.find((c) => c.id === id) || null;

  // Drop target: validates the dropped id, adds to hand if
  // there's no type-clash, and surfaces the reason on rejection.
  host.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('text/card-id')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    host.classList.add('is-drop-target');
  });
  host.addEventListener('dragleave', () => host.classList.remove('is-drop-target'));
  host.addEventListener('drop', (e) => {
    e.preventDefault();
    host.classList.remove('is-drop-target');
    const id = e.dataTransfer.getData('text/card-id');
    if (!id) return;
    const card = lookup(id);
    if (!card) return;
    const result = addToHand(card, lookup);
    if (!result.ok) {
      host.dataset.errorMsg = result.reason;
      host.classList.add('flash-error');
      setTimeout(() => host.classList.remove('flash-error'), 700);
    }
  });

  if (clearBtn) clearBtn.addEventListener('click', () => clearHand());

  const repaintHand = () => {
    const ids = getHandIds();
    host.innerHTML = '';
    if (countEl) countEl.textContent =
      `${ids.length} card${ids.length === 1 ? '' : 's'}`;
    for (const id of ids) {
      const card = lookup(id);
      if (!card) continue;
      const kind = CREW.find((c) => c.id === id) ? 'crew' : 'patent';
      const wrap = document.createElement('div');
      wrap.className = 'hand-slot';
      wrap.appendChild(renderCard(card, { type: kind }));
      const drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'hand-drop';
      drop.textContent = '×';
      drop.title = 'Remove from hand';
      drop.addEventListener('click', () => removeFromHand(id));
      wrap.appendChild(drop);
      host.appendChild(wrap);
    }
  };

  repaintHand();
  onHandChange(repaintHand);
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
  else if (pane === 'solo')       renderSolo();
}

// Route state: shared across renderer instances. Tapping the first
// site sets `from`, tapping the second sets `to` and triggers the
// pathfinder; tapping again starts a new route from that site.
let _routeFrom = null;
let _routeTo = null;
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
    wireDebugPanel(_renderer);
    syncSoloShipMarker();
  } catch (err) {
    canvas.innerHTML = `<div class="map-loading error">Map failed to load: ${err.message}</div>`;
  }
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
}

function onSiteSelect(site) {
  // Solo mode hijacks clicks: every site you tap becomes the
  // proposed destination for your ship's current position. The
  // multiplayer "two-tap route" planner stays available when no
  // solo game is active.
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
  populateSiteInfo(site);

  if (site.isDecorative) {
    setStatus(`Decorative routing node — not selectable.`);
    return;
  }
  showPane('info');

  if (!_routeFrom || (_routeFrom && _routeTo)) {
    _routeFrom = site;
    _routeTo = null;
    _renderer.setRoute(null);
    _renderer.setRouteEndpoints(site.id, null);
    setStatus(`From <strong>${esc(site.name)}</strong> — tap a destination.`);
    document.getElementById('route-clear').hidden = false;
    return;
  }

  if (site.id === _routeFrom.id) {
    setStatus(`Tap a different site to set the destination.`);
    return;
  }

  _routeTo = site;
  const result = findPath(_activeData, _routeFrom.id, _routeTo.id);
  if (!result) {
    setStatus(`No route from <strong>${esc(_routeFrom.name)}</strong> to <strong>${esc(site.name)}</strong>.`);
    _renderer.setRoute(null);
    _renderer.setRouteEndpoints(_routeFrom.id, site.id);
    return;
  }
  _renderer.setRoute(result.segments);
  _renderer.setRouteEndpoints(_routeFrom.id, _routeTo.id);
  const hops = result.segments.length;
  setStatus(
    `<strong>${esc(_routeFrom.name)}</strong> → <strong>${esc(_routeTo.name)}</strong>: ` +
    `<strong class="big">${result.totalBurns}</strong> burns over ${hops} hop${hops === 1 ? '' : 's'}.`
  );
}

function clearRoute() {
  _routeFrom = null;
  _routeTo = null;
  if (_renderer) {
    _renderer.setRoute(null);
    _renderer.setRouteEndpoints(null, null);
  }
  document.getElementById('route-clear').hidden = true;
  setStatus('Tap a site to plan a route.');
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

  // Wrap renderCard so each tile in the grid is draggable, gets
  // a data-card-id for hand operations, and shows the ✋ overlay
  // when it's already sitting in the player's hand.
  const decorateForHand = (card, asKind) => {
    const el = renderCard(card, { type: asKind });
    el.dataset.cardId  = card.id;
    el.dataset.cardKind = asKind;
    el.draggable = true;
    el.addEventListener('dragstart', (ev) => {
      ev.dataTransfer.setData('text/card-id', card.id);
      ev.dataTransfer.setData('text/card-kind', asKind);
      ev.dataTransfer.effectAllowed = 'move';
      el.classList.add('is-dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('is-dragging'));
    if (isInHand(card.id)) el.classList.add('is-grabbed');
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
      // Append crew at the end of "all" so the deck reads as
      // "everything you can build / staff".
      for (const c of CREW) grid.appendChild(decorateForHand(c, 'crew'));
    }
  };

  // Repaint the grid whenever the hand state changes so the ✋
  // overlay tracks reality. Subscription is cleaned up when the
  // patents pane is rebuilt; storing on the host element means
  // multiple mounts don't stack listeners.
  if (host._handUnsub) host._handUnsub();
  host._handUnsub = onHandChange(() => {
    const active = bar.querySelector('button.active');
    repaint(active ? active.dataset.type : 'all');
  });

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
      <button class="primary" id="solo-new">Start solo game</button>
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
    <button id="solo-abandon" class="danger" style="margin-top:10px">Abandon game</button>
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
