// Lobby UI: list, create, detail (roster + ready/start), and the
// "join by code" flow. Wires up the WS subscription for the active
// lobby so chat + roster updates land in real time.

import {
  listLobbies, listMyGames, listPublicGames, getLobby, createLobby, joinLobby, leaveLobby,
  startLobby, claimInviteLink, lookupInviteLink,
  fetchGlobalChat, sendGlobalChat, getAnnouncement,
} from './api.js';
import { activeProfile, onProfileChange } from './auth.js';
import { ws } from './ws.js';
import { saveLastLobbyId } from './storage.js';
import { mountChat, unmountChat } from './chat.js';
import { mountInvitesUI, unmountInvitesUI } from './invites.js';
import { mountBrowse, unmountBrowseOnline } from './game/browse.js';

let _activeLobby = null;
let _unsubWS = null;
// Polling fallback for the lobby view: WS push of lobby_update is
// the primary path, but if the WS is unreachable (user 2026-05-29:
// "Firefox can't establish a connection to the server at wss://...")
// or a broadcast is dropped, the other player wouldn't see the host's
// Start click. Same doctrine as the in-game polling (CLAUDE.md):
// poll on an interval, cache the last snapshot.
let _lobbyPoll = null;
const LOBBY_POLL_MS = 3000;
let _onShowView = null;
let _onToast = null;
let _gameMounted = false;

export function initLobby({ onShowView, onToast }) {
  _onShowView = onShowView;
  _onToast = onToast;

  document.getElementById('btn-refresh-lobbies').addEventListener('click', refreshLobbyList);
  // "+ New game" lives in main.js (initNewGameModal); it opens the
  // chooser modal that routes to either view-create-lobby (multiplayer)
  // or view-browse (sandbox). No btn-create-lobby in this view anymore.
  document.getElementById('create-cancel').addEventListener('click', () => {
    _onShowView('view-lobby-list');
  });
  document.getElementById('form-create-lobby').addEventListener('submit', onCreateSubmit);
  document.getElementById('form-claim-link').addEventListener('submit', onClaimLinkSubmit);
  document.getElementById('btn-leave-lobby').addEventListener('click', onLeaveLobby);
  document.getElementById('btn-start').addEventListener('click', onStartClick);

  // Invites chip in the lobby top row. Click toggles a small popover
  // with the pending-invite list; an outside click closes it. The badge
  // count is kept in sync with the live #invite-list (invites.js owns
  // the rendering; a MutationObserver here just recounts on each
  // render).
  const inviteBtn = document.getElementById('btn-pending-invites');
  const invitesPop = document.getElementById('pending-invites-popover');
  const inviteList = document.getElementById('invite-list');
  const badge = document.getElementById('pending-invites-count');
  if (inviteBtn && invitesPop) {
    // syncBodyClass: pair an `.invites-popover-open` class on <body>
    // with the popover's open state so the mobile backdrop pseudo
    // (body.invites-popover-open::before in style.css) tracks it.
    const syncBodyClass = () => {
      document.body.classList.toggle(
        'invites-popover-open',
        !invitesPop.classList.contains('hidden')
      );
    };
    inviteBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      invitesPop.classList.toggle('hidden');
      syncBodyClass();
    });
    document.addEventListener('click', (ev) => {
      if (invitesPop.classList.contains('hidden')) return;
      if (inviteBtn.contains(ev.target) || invitesPop.contains(ev.target)) return;
      invitesPop.classList.add('hidden');
      syncBodyClass();
    });
    // Close on Escape so the mobile modal behaves like a real modal.
    document.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') return;
      if (invitesPop.classList.contains('hidden')) return;
      invitesPop.classList.add('hidden');
      syncBodyClass();
    });
  }
  if (inviteList && badge) {
    const updateBadge = () => {
      const n = inviteList.querySelectorAll('li:not(.empty)').length;
      badge.textContent = String(n);
      if (inviteBtn) inviteBtn.classList.toggle('has-invites', n > 0);
    };
    new MutationObserver(updateBadge).observe(inviteList, { childList: true });
    updateBadge();
  }

  mountGlobalChat();
}

// Global chat (lobby list). Posts via /chat/global, subscribes to the
// 'global' WS channel for live broadcasts. Mounted once at init; the
// list element + form live in index.html under .global-chat.
//
// Timing note: initLobby runs BEFORE restoreProfile() in boot(), so the
// initial activeProfile() is null. The form / live listener wire up
// immediately (cheap), and the history fetch is deferred until a
// profile actually arrives via onProfileChange so we don't silently
// no-op the backfill.
// Server-wide announcement banner (patches / updates), shown atop global
// chat. One current message that overrides; hidden when empty. Each line
// renders as its own row so multi-line posts read cleanly.
async function loadAnnouncement() {
  const box = document.getElementById('server-announcement');
  if (!box) return;
  const r = await getAnnouncement();
  const msg = (r.ok && r.data && r.data.message) ? String(r.data.message).trim() : '';
  if (!msg) { box.hidden = true; box.innerHTML = ''; return; }
  const lines = msg.split('\n').map((l) => l.trim()).filter(Boolean);
  box.innerHTML = '<span class="server-announcement-tag">📣 Server update</span>'
    + lines.map((l) => `<p class="server-announcement-line">${escapeHtml(l)}</p>`).join('');
  box.hidden = false;
}

function mountGlobalChat() {
  const form = document.getElementById('global-chat-form');
  const input = document.getElementById('global-chat-input');
  const list = document.getElementById('global-chat-messages');
  if (!form || !input || !list) return;
  loadAnnouncement();

  // Track which message ids we've already rendered so the live WS echo
  // doesn't double-print messages we just optimistically appended.
  const seenIds = new Set();
  const append = (msg) => {
    if (!msg) return;
    if (msg.id != null && seenIds.has(msg.id)) return;
    if (msg.id != null) seenIds.add(msg.id);
    const empty = list.querySelector('.empty');
    if (empty) empty.remove();
    const li = document.createElement('li');
    if (msg.id != null) li.dataset.mid = String(msg.id);
    const who = document.createElement('span');
    who.className = 'chat-who';
    who.textContent = '@' + (msg.profileName || '?') + ':';
    const body = document.createElement('span');
    body.className = 'chat-body';
    body.textContent = ' ' + (msg.body || '');
    li.append(who, body);
    list.appendChild(li);
    list.scrollTop = list.scrollHeight;
  };

  // Live broadcasts. Subscribed unconditionally; ws.subscribe queues
  // the channel and the WS layer replays it whenever a connection
  // (re)establishes. lobbyId == null narrows to global-only echoes
  // so per-lobby chat traffic doesn't bleed in here.
  ws.subscribe('global');
  ws.on('chat', (msg) => {
    if (!msg || !msg.message || msg.message.lobbyId != null) return;
    append(msg.message);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const profile = activeProfile();
    if (!profile) {
      _onToast('Sign in to chat.', 'error');
      return;
    }
    const body = input.value.trim();
    if (!body) return;
    input.value = '';
    const r = await sendGlobalChat(body, profile.token);
    if (!r || !r.ok) {
      _onToast('Could not send global chat.', 'error');
      input.value = body;
      return;
    }
    // Optimistic local append; the WS echo will arrive too but
    // append() dedupes by message id via seenIds.
    if (r.data && r.data.message) append(r.data.message);
  });

  // Backfill recent history every time a profile becomes available
  // (covers boot, sign-in, and re-sign-in after signout). Wipes the
  // seenIds set so a fresh backfill isn't blocked by stale ids.
  let _historyFetching = false;
  const loadHistory = async () => {
    const profile = activeProfile();
    if (!profile || _historyFetching) return;
    _historyFetching = true;
    try {
      const r = await fetchGlobalChat({}, profile.token);
      if (r && r.ok && r.data && Array.isArray(r.data.entries)) {
        for (const m of r.data.entries) append(m);
      }
    } finally {
      _historyFetching = false;
    }
  };
  loadHistory();
  onProfileChange((profile) => {
    if (!profile) return;
    loadHistory();
  });
}

export async function refreshLobbyList() {
  refreshMyGames();
  refreshPublicGames();
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

// "Your games" (in progress) + "Ended games": the tables the player is
// a member of, which the open-tables list (waiting + open only) hides.
// In progress = lobby started and the game still active; ended = the
// game finished. Both Resume/Review by re-entering the lobby, which
// remounts the sandbox game view for a started game.
export async function refreshMyGames() {
  const startedEl = document.getElementById('mygames-started');
  const endedEl = document.getElementById('mygames-ended');
  if (!startedEl || !endedEl) return;
  const me = activeProfile();
  if (!me) return;
  const r = await listMyGames(me.token);
  if (!r.ok) return;
  const started = [];
  const ended = [];
  for (const g of r.data.entries) {
    // Cancelled lobbies/games land in "Ended" so the player still has
    // a record of them. gameStatus carries through to the renderer
    // which decorates the row with a "(cancelled)" tag and disables
    // Review (there's no recoverable terminal state).
    if (g.status === 'cancelled' || g.gameStatus === 'cancelled') ended.push(g);
    else if (g.gameStatus === 'finished') ended.push(g);
    else if (g.status === 'started') started.push(g);
  }
  renderMyGames(startedEl, started, 'Resume', 'No games in progress.');
  renderMyGames(endedEl, ended, 'Review', 'No finished games.');
}

// "Live games": in-progress public games anyone can hop into as a
// spectator. The list is profile-agnostic (server returns every
// open-lobby active game); the Watch button mounts the browse view
// in spectator mode so the viewer sees the live board without any
// actions.
export async function refreshPublicGames() {
  const listEl = document.getElementById('public-games-list');
  if (!listEl) return;
  const me = activeProfile();
  if (!me) {
    listEl.innerHTML = '<li class="empty">Sign in to watch live games.</li>';
    return;
  }
  const r = await listPublicGames(me.token);
  if (!r.ok) {
    listEl.innerHTML = `<li class="empty">Failed to load (${r.error}).</li>`;
    return;
  }
  const entries = (r.data && r.data.entries) || [];
  if (!entries.length) {
    listEl.innerHTML = '<li class="empty">No public games right now.</li>';
    return;
  }
  listEl.innerHTML = '';
  for (const g of entries) {
    const li = document.createElement('li');
    li.innerHTML = `
      <div>
        <span class="name"></span>
        <span class="meta">hosted by @<span class="host"></span>
          · <span class="count"></span> players
          · <code></code></span>
      </div>
      <div class="row-actions">
        <button class="primary">👁 Watch</button>
      </div>
    `;
    li.querySelector('.name').textContent = g.lobbyName;
    li.querySelector('.host').textContent = g.hostName;
    li.querySelector('.count').textContent = g.playerCount;
    li.querySelector('code').textContent = g.lobbyCode;
    li.querySelector('button').addEventListener('click', () => {
      watchGame(g);
    });
    listEl.appendChild(li);
  }
}

// Mount the browse view in spectator mode for the given public game.
// The viewer sees the live board (map / roster / turn) but every
// action submitter refuses with a "Spectator - view only" toast.
async function watchGame(g) {
  const me = activeProfile();
  if (!me) return;
  _onShowView('view-browse');
  mountBrowse({
    online: true,
    spectator: true,
    gameId: g.gameId,
    lobbyId: null,         // spectators don't get the lobby chat
    me,
    onToast: _onToast,
    room: g.lobbyName + ' (spectating)',
    onLeave: () => {
      unmountBrowseOnline();
      _onShowView('view-lobby-list');
    },
  });
}

function renderMyGames(listEl, games, actionLabel, emptyMsg) {
  listEl.innerHTML = '';
  if (!games.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = emptyMsg;
    listEl.appendChild(li);
    return;
  }
  for (const g of games) {
    const li = document.createElement('li');
    const cancelled = g.status === 'cancelled' || g.gameStatus === 'cancelled';
    if (cancelled) li.classList.add('is-cancelled');
    li.innerHTML = `
      <div>
        <span class="name"></span>
        <span class="meta">hosted by @<span class="host"></span>
          · <span class="count"></span>/${g.maxPlayers}
          · <code></code>
          <span class="tag-cancelled" hidden>· cancelled</span></span>
      </div>
      <div class="row-actions">
        <button class="primary"></button>
      </div>
    `;
    li.querySelector('.name').textContent = g.name;
    li.querySelector('.host').textContent = g.hostName;
    li.querySelector('.count').textContent = g.memberCount;
    li.querySelector('code').textContent = g.code;
    const btn = li.querySelector('button');
    if (cancelled) {
      li.querySelector('.tag-cancelled').hidden = false;
      // No recoverable terminal state for a cancelled lobby - the
      // lobby/game rows still exist for audit but the player can't
      // resume or review the board.
      btn.textContent = 'Cancelled';
      btn.disabled = true;
    } else {
      btn.textContent = actionLabel;
      btn.addEventListener('click', () => openLobby(g.id, { join: false }));
    }
    listEl.appendChild(li);
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
  // Encode the lobby's 6-char share code in the URL so a refresh or
  // a reconnection-loss puts the player back HERE instead of the
  // lobby list (user 2026-05-29: "encode game room in url string ...
  // if connection is lost the player isnt just booted back to the
  // lobby or if a refresh happens they arent booted to the lobby").
  // Boot reads ?room=<code> and re-opens this lobby.
  if (lobby.code) setRoomInUrl(lobby.code);
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
  // Polling fallback. The host's Start click writes lobby.status =
  // 'started' on the server and broadcasts lobby_update on WS; if
  // the other player's WS is down (Firefox failing the wss handshake,
  // tab backgrounded, server hiccup) the broadcast vanishes and the
  // lobby view sits on 'waiting' forever. Re-fetch the lobby every
  // LOBBY_POLL_MS while in this view and re-apply via renderLobby -
  // renderLobby is idempotent and will mount the game view itself
  // once status flips to 'started'. Cleared on leaveCurrent.
  if (_lobbyPoll) clearInterval(_lobbyPoll);
  _lobbyPoll = setInterval(async () => {
    if (!_activeLobby || _activeLobby.id !== lobby.id) return;
    const poll = await getLobby(lobby.id);
    if (!poll || !poll.ok) return;
    if (!_activeLobby || _activeLobby.id !== lobby.id) return;
    // getLobby returns { lobby: {...} } - unwrap before assignment
    // (matches enterLobby's r.data.lobby above). Earlier I assigned
    // poll.data directly which made _activeLobby a wrapper object and
    // every member-access (lobby.members.length) blew up on the next
    // render tick.
    const fresh = poll.data && poll.data.lobby;
    if (!fresh) return;
    _activeLobby = fresh;
    renderLobby(_activeLobby);
  }, LOBBY_POLL_MS);
  mountChat(lobby);
  mountInvitesUI(lobby);
  // A started game lives in the sandbox view (renderLobby mounts it +
  // navigates there); only show the lobby view while still waiting.
  if (lobby.status !== 'started') _onShowView('view-lobby');
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
    `;
    roster.appendChild(li);
  }

  const startBtn = document.getElementById('btn-start');
  const isHost = me && me.id === lobby.hostId;
  startBtn.classList.toggle('hidden', !isHost || lobby.status !== 'waiting');

  // A started game runs in the sandbox view (view-browse) in online
  // mode: the same classic map + panels as solo, driven by the server.
  // Mounted once; the sandbox manages its own game WS + op submission.
  if (lobby.status === 'started' && lobby.gameId && me) {
    if (!_gameMounted) {
      _gameMounted = true;
      mountBrowse({
        online: true,
        gameId: lobby.gameId,
        lobbyId: lobby.id,
        me,
        onToast: _onToast,
        room: lobby.name,
        // The pane's "Back to lobbies" button calls this. Non-destructive:
        // the online layer detaches and the player lands on the lobby
        // list (the game keeps running; Resume puts them back in).
        onLeave: () => {
          _gameMounted = false;
          unmountBrowseOnline();
          _onShowView('view-lobby-list');
          refreshLobbyList();
        },
      });
      _onShowView('view-browse');
    }
  } else if (_gameMounted) {
    // Game ended or the table reset: detach the online layer.
    unmountBrowseOnline();
    _gameMounted = false;
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
  if (_lobbyPoll) { clearInterval(_lobbyPoll); _lobbyPoll = null; }
  if (_gameMounted) { unmountBrowseOnline(); _gameMounted = false; }
  unmountChat();
  unmountInvitesUI();
  _activeLobby = null;
  saveLastLobbyId(null);
  setRoomInUrl(null);
  _onShowView('view-lobby-list');
  refreshLobbyList();
}

// Push / clear the /room/<CODE> path without triggering a navigation.
// Centralised so openLobby + leaveCurrent stay in sync. The room is a
// real path segment (user request), so the app base must be resolved
// independently of the address bar - import.meta.url always points at
// <base>/js/lobby.js, so '../' off it is the app base regardless of how
// deep the visible URL currently is. The ?v= version pin is preserved
// so a later version-check reload keeps the same build.
function setRoomInUrl(code) {
  try {
    const base = new URL('../', import.meta.url).pathname;   // /high-frontier-fan-game/
    const cur = new URL(window.location.href);
    const v = cur.searchParams.get('v');
    const search = v ? ('?v=' + encodeURIComponent(v)) : '';
    // Codes are stored lowercase server-side (CODE_ALPHABET is
    // lowercase + digits). Write the URL in the canonical lowercase
    // form so a copy-pasted link round-trips exactly. The server
    // handler is also case-insensitive as a belt-and-braces.
    const target = code
      ? base + 'room/' + encodeURIComponent(String(code).toLowerCase())
      : base;
    window.history.replaceState({}, '', target + search + cur.hash);
  } catch { /* private mode / file:// scheme */ }
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
