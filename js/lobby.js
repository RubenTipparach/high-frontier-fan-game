// Lobby UI: list, create, detail (roster + ready/start), and the
// "join by code" flow. Wires up the WS subscription for the active
// lobby so chat + roster updates land in real time.

import {
  listLobbies, getLobby, createLobby, joinLobby, leaveLobby,
  setReady, startLobby, claimInviteLink, lookupInviteLink,
} from './api.js';
import { activeProfile } from './auth.js';
import { ws } from './ws.js';
import { saveLastLobbyId } from './storage.js';
import { mountChat, unmountChat } from './chat.js';
import { mountInvitesUI, unmountInvitesUI } from './invites.js';
import { MapRenderer } from './game/render.js';
import { loadPlannerMap } from './game/planner-map.js';
import { findPath } from './game/nav.js';

async function loadLobbyMap() {
  return loadPlannerMap();
}

let _activeLobby = null;
let _unsubWS = null;
let _onShowView = null;
let _onToast = null;
let _mapRenderer = null;

export function initLobby({ onShowView, onToast }) {
  _onShowView = onShowView;
  _onToast = onToast;

  document.getElementById('btn-refresh-lobbies').addEventListener('click', refreshLobbyList);
  document.getElementById('btn-create-lobby').addEventListener('click', () => {
    _onShowView('view-create-lobby');
  });
  document.getElementById('create-cancel').addEventListener('click', () => {
    _onShowView('view-lobby-list');
  });
  document.getElementById('form-create-lobby').addEventListener('submit', onCreateSubmit);
  document.getElementById('form-claim-link').addEventListener('submit', onClaimLinkSubmit);
  document.getElementById('btn-leave-lobby').addEventListener('click', onLeaveLobby);
  document.getElementById('btn-ready').addEventListener('click', onReadyClick);
  document.getElementById('btn-start').addEventListener('click', onStartClick);
  document.getElementById('btn-back-to-lobby').addEventListener('click', () => {
    document.getElementById('game-overlay').classList.add('hidden');
  });
}

export async function refreshLobbyList() {
  const list = document.getElementById('lobby-list');
  list.innerHTML = '<li class="empty">Loading…</li>';
  const r = await listLobbies();
  if (!r.ok) {
    list.innerHTML = `<li class="empty">Failed to load (${r.error}).</li>`;
    return;
  }
  if (!r.data.entries.length) {
    list.innerHTML = '<li class="empty">No open tables. Create one!</li>';
    return;
  }
  list.innerHTML = '';
  for (const lobby of r.data.entries) {
    const li = document.createElement('li');
    li.innerHTML = `
      <div>
        <span class="name"></span>
        <span class="meta">hosted by @<span class="host"></span>
          · <span class="count"></span>/${lobby.maxPlayers}
          · <code></code></span>
      </div>
      <div class="row-actions">
        <button class="primary">Join</button>
      </div>
    `;
    li.querySelector('.name').textContent = lobby.name;
    li.querySelector('.host').textContent = lobby.hostName;
    li.querySelector('.count').textContent = lobby.memberCount;
    li.querySelector('code').textContent = lobby.code;
    li.querySelector('button').addEventListener('click', async () => {
      await openLobby(lobby.id, { join: true });
    });
    list.appendChild(li);
  }
}

async function onCreateSubmit(ev) {
  ev.preventDefault();
  const errEl = document.getElementById('create-error');
  errEl.textContent = '';
  const name = document.getElementById('create-name').value.trim();
  const maxPlayers = Number(document.getElementById('create-max').value);
  const joinPolicy = document.querySelector('input[name=policy]:checked').value;
  const me = activeProfile();
  if (!me) return;
  const r = await createLobby({ name, maxPlayers, joinPolicy }, me.token);
  if (!r.ok) { errEl.textContent = humanizeError(r.error); return; }
  await enterLobby(r.data.lobby);
}

async function onClaimLinkSubmit(ev) {
  ev.preventDefault();
  const input = document.getElementById('claim-link-code');
  const code = input.value.trim().toLowerCase();
  if (!code) return;
  const me = activeProfile();
  if (!me) return;
  const r = await claimInviteLink(code, me.token);
  if (!r.ok) {
    _onToast(`Couldn't claim: ${humanizeError(r.error)}`, 'error');
    return;
  }
  input.value = '';
  await openLobby(r.data.lobbyId, { join: false });
}

// Open a lobby by id, optionally joining first. Used by both the
// "Join" buttons in the list and by direct/link invite acceptance.
export async function openLobby(id, { join } = { join: false }) {
  const me = activeProfile();
  if (!me) return;
  if (join) {
    const r = await joinLobby(id, me.token);
    if (!r.ok && r.error !== 'already_member' /* never actually returned, but defensive */) {
      _onToast(`Couldn't join: ${humanizeError(r.error)}`, 'error');
      return;
    }
  }
  const r = await getLobby(id);
  if (!r.ok) {
    _onToast('Lobby not found.', 'error');
    return;
  }
  await enterLobby(r.data.lobby);
}

export async function enterLobby(lobby) {
  _activeLobby = lobby;
  saveLastLobbyId(lobby.id);
  renderLobby(lobby);
  // WS subscription so chat + roster updates land immediately.
  const channel = 'lobby:' + lobby.id;
  ws.subscribe(channel);
  if (_unsubWS) _unsubWS();
  const offUpdate = ws.on('lobby_update', (msg) => {
    if (!_activeLobby || msg.lobby.id !== _activeLobby.id) return;
    _activeLobby = msg.lobby;
    renderLobby(_activeLobby);
  });
  const offDisband = ws.on('lobby_disbanded', (msg) => {
    if (!_activeLobby || msg.lobbyId !== _activeLobby.id) return;
    _onToast('Lobby was disbanded.', 'error');
    leaveCurrent();
  });
  _unsubWS = () => { offUpdate(); offDisband(); ws.unsubscribe(channel); };
  mountChat(lobby);
  mountInvitesUI(lobby);
  _onShowView('view-lobby');
}

function renderLobby(lobby) {
  document.getElementById('lobby-name').textContent = lobby.name;
  document.getElementById('lobby-code-pill').textContent = lobby.code;
  document.getElementById('lobby-meta').innerHTML =
    `Hosted by <strong>@${escapeHtml(lobby.hostName)}</strong> · ` +
    `${lobby.members.length}/${lobby.maxPlayers} seats · ` +
    `${lobby.joinPolicy === 'open' ? 'open' : 'invite-only'}`;

  const me = activeProfile();
  const roster = document.getElementById('lobby-roster');
  roster.innerHTML = '';
  for (const member of lobby.members) {
    const li = document.createElement('li');
    const isYou = me && member.id === me.id;
    const isHost = member.id === lobby.hostId;
    li.innerHTML = `
      <span>
        <span class="seat">#${member.seat || '-'}</span>
        <strong class="${isYou ? 'you' : ''}">@${escapeHtml(member.name)}</strong>
        ${isHost ? '<span class="host-badge">host</span>' : ''}
      </span>
      <span class="${member.ready ? 'ready' : 'muted'}">${member.ready ? '✓ ready' : 'not ready'}</span>
    `;
    roster.appendChild(li);
  }

  const startBtn = document.getElementById('btn-start');
  const isHost = me && me.id === lobby.hostId;
  startBtn.classList.toggle('hidden', !isHost || lobby.status !== 'waiting');

  const overlay = document.getElementById('game-overlay');
  const justStarted = lobby.status === 'started' && overlay.classList.contains('hidden');
  overlay.classList.toggle('hidden', lobby.status !== 'started');
  if (lobby.status === 'started') {
    const title = document.getElementById('game-title');
    if (title) title.textContent = lobby.name;
    // Mount the map on first reveal so we don't pay the cost of
    // building 36 SVG nodes when the user is still picking seats.
    if (justStarted || !_mapRenderer) {
      const host = document.getElementById('game-map');
      if (host) {
        host.innerHTML = '<div class="map-loading">Loading map…</div>';
        loadLobbyMap().then((data) => {
          // Click-to-route: same state machine as the Browse view.
          // Stage 3 will replace this with engine ops (MOVE / BURN).
          let from = null, to = null;
          _mapRenderer = new MapRenderer(host, {
            data,
            onSelect: (site) => {
              if (site.isDecorative) {
                _onToast('Decorative routing node - not selectable.');
                return;
              }
              if (!from || (from && to)) {
                from = site; to = null;
                _mapRenderer.setRoute(null);
                _mapRenderer.setRouteEndpoints(site.id, null);
                _onToast(`From ${site.name}. Tap destination.`);
                return;
              }
              if (site.id === from.id) return;
              to = site;
              const r = findPath(data, from.id, to.id);
              if (!r) {
                _onToast(`No route to ${site.name}.`, 'error');
                return;
              }
              _mapRenderer.setRoute(r.segments);
              _mapRenderer.setRouteEndpoints(from.id, to.id);
              _onToast(`${from.name} → ${to.name}: ${r.totalBurns} burns, ${r.segments.length} hops.`, 'success');
            },
          });
        }).catch((err) => {
          host.innerHTML = `<div class="map-loading error">Map failed: ${err.message}</div>`;
        });
      }
    }
  } else if (_mapRenderer) {
    // Game over (or never started). Tear down so a future start gets
    // a fresh renderer with up-to-date state.
    document.getElementById('game-map').innerHTML = '';
    _mapRenderer = null;
  }
}

async function onLeaveLobby() {
  if (!_activeLobby) return;
  const me = activeProfile();
  if (!me) return;
  await leaveLobby(_activeLobby.id, me.token);
  leaveCurrent();
}

function leaveCurrent() {
  if (_unsubWS) { _unsubWS(); _unsubWS = null; }
  unmountChat();
  unmountInvitesUI();
  _activeLobby = null;
  saveLastLobbyId(null);
  _onShowView('view-lobby-list');
  refreshLobbyList();
}

async function onReadyClick() {
  if (!_activeLobby) return;
  const me = activeProfile();
  if (!me) return;
  const myRow = _activeLobby.members.find((m) => m.id === me.id);
  const next = myRow ? !myRow.ready : true;
  await setReady(_activeLobby.id, next, me.token);
  const r = await getLobby(_activeLobby.id);
  if (r.ok) { _activeLobby = r.data.lobby; renderLobby(_activeLobby); }
}

async function onStartClick() {
  if (!_activeLobby) return;
  const me = activeProfile();
  if (!me) return;
  const errEl = document.getElementById('lobby-start-error');
  errEl.textContent = '';
  const r = await startLobby(_activeLobby.id, me.token);
  if (!r.ok) { errEl.textContent = humanizeError(r.error); return; }
  const r2 = await getLobby(_activeLobby.id);
  if (r2.ok) { _activeLobby = r2.data.lobby; renderLobby(_activeLobby); }
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function humanizeError(code) {
  return ({
    invalid_name: 'That name is not allowed. Use 3-20 letters / numbers / _ / -.',
    name_taken: 'That name is taken on this server.',
    rate_limited: 'Too many attempts. Wait an hour and try again.',
    not_found: 'Not found.',
    expired: 'That invite link expired.',
    used: 'That invite link has already been used.',
    lobby_full: 'That table is full.',
    already_started: 'That game has already started.',
    invite_required: 'That table is invite-only.',
    not_a_member: 'You\'re not in that lobby.',
    not_host: 'Only the host can do that.',
    profile_not_found: 'No profile with that name.',
    self_invite: 'Can\'t invite yourself.',
    already_member: 'They\'re already at the table.',
    api_unavailable: 'Server unreachable.',
    network: 'Network error.',
  })[code] || code;
}
