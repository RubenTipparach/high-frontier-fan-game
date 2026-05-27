// Client controller for a server-authoritative multiplayer game.
//
// REST is the source of truth: state arrives from GET /games/:id and
// every change is driven by POST /games/:id/ops, with the server
// broadcasting the resulting snapshot over the game:<id> WS channel.
// This module mirrors that snapshot, renders the shared map (the
// "clean" data/sites.js graph, whose site ids match what the server
// validates moves against), and exposes the two ops wired so far:
// MOVE (tap a site, then Move) and END_TURN.
//
// Hidden information: the snapshot is open today (empty hands until the
// BUILD op lands). When hands fill, the server will redact per-player
// and this renderer just shows whatever it is handed.

import { loadCleanMap } from './clean-map.js';
import { MapRenderer } from './render.js';
import { findPath } from './nav.js';
import { ws } from '../ws.js';
import { getGame, submitGameOp, getGameOps } from '../api.js';

let _gameId = null;
let _me = null;            // { id, name, token }
let _onToast = null;
let _data = null;          // clean-map graph
let _renderer = null;
let _state = null;         // engine state snapshot
let _players = [];         // frozen roster [{ profileId, name, seat, color }]
let _seq = -1;             // last applied op seq
let _pending = null;       // { toSiteId, path } selected move
let _offWS = null;
let _busy = false;

export async function mountNetGame({ gameId, me, onToast }) {
  unmountNetGame();
  _gameId = gameId;
  _me = me;
  _onToast = onToast || (() => {});

  // Subscribe before the first fetch so we don't miss an update that
  // lands between load and render.
  const channel = 'game:' + gameId;
  ws.subscribe(channel);
  const off = ws.on('game_update', onGameUpdate);
  _offWS = () => { off(); ws.unsubscribe(channel); };

  bindHudButtons();

  const host = document.getElementById('game-map');
  if (host) host.innerHTML = '<div class="map-loading">Loading game…</div>';

  let data;
  try {
    data = await loadCleanMap();
  } catch (err) {
    if (host) host.innerHTML = `<div class="map-loading error">Map failed: ${err.message}</div>`;
    return;
  }
  _data = data;

  const r = await getGame(gameId, me.token);
  if (!r.ok) {
    if (host) host.innerHTML = `<div class="map-loading error">Game failed to load (${r.error}).</div>`;
    return;
  }
  applyView(r.data.game);

  // Seed the log panel with recent history so a player who joins late
  // sees what happened.
  const ops = await getGameOps(gameId, {}, me.token);
  if (ops.ok) setLogFromOps(ops.data.entries);

  if (host) host.innerHTML = '';
  _renderer = new MapRenderer(host, {
    data,
    onSelect: onSiteSelect,
  });
  render();
}

export function unmountNetGame() {
  if (_offWS) { _offWS(); _offWS = null; }
  _renderer = null;
  _gameId = null;
  _state = null;
  _players = [];
  _seq = -1;
  _pending = null;
  _busy = false;
  const host = document.getElementById('game-map');
  if (host) host.innerHTML = '';
}

// ----- state plumbing -----

function applyView(view) {
  if (!view) return;
  // Ignore stale broadcasts (an op we already applied via the REST
  // response). seq is monotonic.
  if (typeof view.seq === 'number' && view.seq < _seq) return;
  _state = view.state;
  _players = view.players || [];
  _seq = typeof view.seq === 'number' ? view.seq : _seq;
}

function onGameUpdate(msg) {
  if (!msg || msg.gameId !== _gameId) return;
  if (typeof msg.seq === 'number' && msg.seq <= _seq) return;
  applyView(msg.game);
  if (msg.op && msg.op.log) appendLog(msg.op.log);
  // A move/turn-pass may move our ship or change whose turn it is;
  // clear any stale pending selection that no longer makes sense.
  if (_pending && me() && !isMyTurn()) clearPending();
  render();
}

function me() {
  return _state && _state.players.find((p) => p.profileId === _me.id);
}
function currentPlayer() {
  return _state && _state.players[_state.activeIndex];
}
function isMyTurn() {
  const c = currentPlayer();
  return !!c && c.profileId === _me.id;
}

// ----- map interaction -----

function onSiteSelect(site) {
  if (!site || site.isDecorative || !_state) return;
  const myp = me();
  if (!myp) return;
  const from = myp.rocket.siteId;
  if (site.id === from) { clearPending(); render(); return; }
  const path = findPath(_data, from, site.id);
  if (!path) {
    _pending = null;
    if (_renderer) { _renderer.setRoute(null); _renderer.setRouteEndpoints(from, null); }
    setMoveInfo(`No route to ${site.name}.`, true);
    updateButtons();
    return;
  }
  _pending = { toSiteId: site.id, path };
  if (_renderer) {
    _renderer.setRoute(path.segments);
    _renderer.setRouteEndpoints(from, site.id);
  }
  render();
}

function clearPending() {
  _pending = null;
  if (_renderer) { _renderer.setRoute(null); _renderer.setRouteEndpoints(null, null); }
}

// ----- ops -----

async function doMove() {
  if (_busy || !_pending || !isMyTurn()) return;
  _busy = true;
  updateButtons();
  setError('');
  const r = await submitGameOp(_gameId, { kind: 'MOVE', toSiteId: _pending.toSiteId }, _me.token);
  _busy = false;
  if (!r.ok) {
    setError(humanizeOpError(r.error));
    updateButtons();
    return;
  }
  applyView(r.data.game);
  if (r.data.log) appendLog(r.data.log);
  clearPending();
  render();
}

async function doEndTurn() {
  if (_busy || !isMyTurn()) return;
  _busy = true;
  updateButtons();
  setError('');
  const r = await submitGameOp(_gameId, { kind: 'END_TURN' }, _me.token);
  _busy = false;
  if (!r.ok) {
    setError(humanizeOpError(r.error));
    updateButtons();
    return;
  }
  applyView(r.data.game);
  if (r.data.log) appendLog(r.data.log);
  clearPending();
  render();
}

// ----- render -----

function render() {
  if (!_state) return;
  const myp = me();
  if (_renderer && myp) _renderer.setPlayerShipId(myp.rocket.siteId);
  renderBanner();
  renderRoster();
  renderMoveInfo();
  updateButtons();
}

function renderBanner() {
  const el = document.getElementById('game-turn-banner');
  if (!el) return;
  const c = currentPlayer();
  const slot = `round ${_state.round} · slot ${_state.turn}`;
  if (isMyTurn()) {
    el.textContent = `Your turn (${slot})`;
    el.className = 'game-turn-banner your-turn';
  } else {
    el.textContent = `Waiting for @${c ? c.name : '?'} (${slot})`;
    el.className = 'game-turn-banner muted';
  }
}

function renderRoster() {
  const ul = document.getElementById('hud-roster');
  if (!ul) return;
  ul.innerHTML = '';
  const activeId = currentPlayer()?.profileId;
  for (const p of _state.players) {
    const site = _data.byId[p.rocket.siteId];
    const li = document.createElement('li');
    if (p.profileId === activeId) li.classList.add('active');
    const you = p.profileId === _me.id;
    li.innerHTML = `
      <span class="dot" style="background:${p.color}"></span>
      <span class="who"></span>
      <span class="where muted"></span>
      <span class="water"></span>
    `;
    li.querySelector('.who').textContent = '@' + p.name + (you ? ' (you)' : '');
    li.querySelector('.where').textContent = site ? site.name : (p.rocket.siteId || 'LEO');
    const glory = p.glory && p.glory.vps ? ` · ${p.glory.vps}vp` : '';
    li.querySelector('.water').textContent = `${p.rocket.tank}💧${glory}`;
    ul.appendChild(li);
  }
}

function renderMoveInfo() {
  if (!_pending) {
    setMoveInfo(isMyTurn() ? 'Tap a site to plan a burn.' : 'Not your turn.', false);
    return;
  }
  const dest = _data.byId[_pending.toSiteId];
  const cost = _pending.path.totalBurns; // perBurn=1 until BUILD lands
  const hops = _pending.path.segments.length;
  setMoveInfo(
    `→ ${dest ? dest.name : _pending.toSiteId}: ${cost} burn${cost === 1 ? '' : 's'} `
    + `over ${hops} hop${hops === 1 ? '' : 's'} (needs ${cost}💧).`,
    false
  );
}

function setMoveInfo(text, isWarn) {
  const el = document.getElementById('hud-move-info');
  if (!el) return;
  el.textContent = text;
  el.className = 'hud-move-info ' + (isWarn ? 'warn' : 'muted');
}

function setError(text) {
  const el = document.getElementById('hud-move-error');
  if (el) el.textContent = text || '';
}

function updateButtons() {
  const moveBtn = document.getElementById('btn-game-move');
  const endBtn = document.getElementById('btn-game-endturn');
  const myTurn = isMyTurn();
  const myp = me();
  if (moveBtn) {
    const canMove = !!(myTurn && !_busy && _pending && myp
      && myp.movesRemaining > 0
      && _pending.path.totalBurns <= myp.rocket.tank);
    moveBtn.disabled = !canMove;
  }
  if (endBtn) endBtn.disabled = !(myTurn && !_busy);
}

let _hudBound = false;
function bindHudButtons() {
  if (_hudBound) return;
  _hudBound = true;
  document.getElementById('btn-game-move')?.addEventListener('click', doMove);
  document.getElementById('btn-game-endturn')?.addEventListener('click', doEndTurn);
}

// ----- log -----

function appendLog(line) {
  const ul = document.getElementById('hud-log');
  if (!ul || !line) return;
  const li = document.createElement('li');
  li.textContent = line;
  ul.insertBefore(li, ul.firstChild);
  while (ul.children.length > 40) ul.removeChild(ul.lastChild);
}

function setLogFromOps(entries) {
  const ul = document.getElementById('hud-log');
  if (!ul) return;
  ul.innerHTML = '';
  for (const e of entries) {
    if (!e.log) continue;
    const li = document.createElement('li');
    li.textContent = e.log;
    ul.insertBefore(li, ul.firstChild);
  }
}

function humanizeOpError(code) {
  return ({
    not_your_turn: 'It is not your turn.',
    no_moves_left: 'No moves left this turn. End your turn.',
    insufficient_water: 'Not enough water for that burn.',
    no_route: 'No route to that site.',
    unknown_site: 'Unknown site.',
    already_here: 'Your ship is already there.',
    game_not_active: 'This game has ended.',
    not_a_player: 'You are not in this game.',
    unknown_op: 'Unsupported operation.',
  })[code] || code;
}
