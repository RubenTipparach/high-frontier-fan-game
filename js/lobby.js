// Lobby UI: list, create, detail (roster + ready/start), and the
// "join by code" flow. Wires up the WS subscription for the active
// lobby so chat + roster updates land in real time.

import {
  listLobbies, listMyGames, listPublicGames, getLobby, createLobby, joinLobby, leaveLobby,
  startLobby, kickPlayer, claimInviteLink, lookupInviteLink,
  fetchGlobalChat, sendGlobalChat, getAnnouncement,
} from './api.js';
import { activeProfile, onProfileChange } from './auth.js';
import { ws } from './ws.js';
import { saveLastLobbyId } from './storage.js';
import { mountChat, unmountChat } from './chat.js';
import { mountInvitesUI, unmountInvitesUI } from './invites.js';
import { mountBrowse, unmountBrowseOnline } from './game/browse.js';
import { listSandboxGames, activateSandboxGame, sandboxUrl, abandonSandboxGame } from './game/sandbox-games.js';

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
// Any https:// URL in an announcement becomes a clickable link. We
// tokenize on URLs in the RAW text (so the regex matches real characters,
// not HTML entities), then escape each piece for its context: plain text
// via escapeHtml, the href via escapeAttr. That keeps the output
// injection-safe even though the admin is the only author. Match is
// https:// only (per request); a URL run ends at whitespace or an HTML
// delimiter, and trailing sentence punctuation is left out of the link.
const ANNOUNCE_URL_RE = /https:\/\/[^\s<>"']+/g;
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}
function linkifyAnnouncement(line) {
  let out = '';
  let last = 0;
  for (const m of line.matchAll(ANNOUNCE_URL_RE)) {
    let url = m[0];
    // Don't swallow a trailing period/comma/etc. into the link target.
    const tail = (url.match(/[.,!?;:]+$/) || [''])[0];
    if (tail) url = url.slice(0, url.length - tail.length);
    out += escapeHtml(line.slice(last, m.index));
    out += `<a class="server-announcement-link" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
    out += escapeHtml(tail);
    last = m.index + m[0].length;
  }
  out += escapeHtml(line.slice(last));
  return out;
}

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
    + lines.map((l) => `<p class="server-announcement-line">${linkifyAnnouncement(l)}</p>`).join('');
  box.hidden = false;
}

// Cap the on-screen global chat so the box doesn't grow without bound as
// live messages accumulate past the server's history window.
const MAX_GLOBAL_CHAT = 200;

// Styled yes/no confirm (reuses the in-game modal CSS so it matches the
// rest of the app rather than a native window.confirm, which some embeds
// suppress). Resolves true on Yes / Enter, false on Cancel / Esc / backdrop.
function confirmDialog({ title, body, yes = 'OK', no = 'Cancel' }) {
  return new Promise((resolve) => {
    document.querySelector('.confirm-modal-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'card-modal-overlay confirm-modal-overlay';
    const close = (v) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(!!v);
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
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(body)}</p>
      <div class="turn-confirm-actions">
        <button type="button" class="popup-btn primary" data-act="yes">${escapeHtml(yes)}</button>
        <button type="button" class="popup-btn" data-act="no">${escapeHtml(no)}</button>
      </div>
    `;
    panel.querySelector('[data-act="yes"]').addEventListener('click', () => close(true));
    panel.querySelector('[data-act="no"]').addEventListener('click', () => close(false));
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
  });
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
    // Keep only the most recent messages so the box doesn't grow forever.
    while (list.children.length > MAX_GLOBAL_CHAT) list.removeChild(list.firstChild);
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
        // Pin to the newest message once the rows have laid out (a
        // per-append scrollTop can fire before layout on a fresh load).
        requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
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
  // Local solo sandbox games live alongside the server games in
  // "Your games" - newest first, each Resume re-enters /sandbox/<id>.
  const sandboxRows = listSandboxGames().map(sandboxGameRow);
  renderMyGames(startedEl, started, 'Resume', 'No games in progress.', sandboxRows);
  renderMyGames(endedEl, ended, 'Review', 'No finished games.');
}

// One "Your games" row for a local sandbox game. Resume snapshots the
// current active game, restores this one to the live keys, and reloads
// into /sandbox/<id> so the state modules re-read it.
function sandboxGameRow(sg) {
  const li = document.createElement('li');
  li.className = 'sandbox-game-row';
  const when = new Date(sg.lastPlayedAt || sg.createdAt || Date.now());
  li.innerHTML = `
    <div>
      <span class="name">🗺 Sandbox game</span>
      <span class="meta">solo · <code></code> · <span class="when"></span></span>
    </div>
    <div class="row-actions">
      <button class="primary sb-resume">Resume</button>
      <button class="danger sb-delete" title="Delete this sandbox game">🗑 Delete</button>
    </div>
  `;
  li.querySelector('code').textContent = sg.id;
  // Compact date (no seconds) so the row isn't dominated by the timestamp.
  li.querySelector('.when').textContent = when.toLocaleDateString([], { month: 'short', day: 'numeric' })
    + ' ' + when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  li.querySelector('.sb-resume').addEventListener('click', () => {
    activateSandboxGame(sg.id);
    window.location.assign(sandboxUrl(sg.id));
  });
  li.querySelector('.sb-delete').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: '🗑 Delete sandbox game',
      body: 'Delete this sandbox game? This can\'t be undone.',
      yes: '🗑 Delete', no: 'Cancel',
    });
    if (!ok) return;
    abandonSandboxGame(sg.id);
    refreshMyGames();   // re-render the list without it
  });
  return li;
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
        <button class="primary">Watch</button>
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

// Compact relative time ("just now" / "5m ago" / "3h ago" / "2d ago")
// for the dashboard's "last turn ended" hint.
function timeAgo(ms) {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// A seat-colour-tinted @name span, matching the in-game .player-name
// convention (colour falls back to currentColor when unknown).
function mkPlayerName(text, color) {
  const span = document.createElement('span');
  span.className = 'player-name';
  if (color) span.style.setProperty('--player-color', color);
  span.textContent = text;
  return span;
}

function renderMyGames(listEl, games, actionLabel, emptyMsg, prependRows = []) {
  listEl.innerHTML = '';
  for (const li of prependRows) listEl.appendChild(li);
  if (!games.length) {
    if (!prependRows.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = emptyMsg;
      listEl.appendChild(li);
    }
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
        <span class="meta turn-meta" hidden></span>
      </div>
      <div class="row-actions">
        <button class="primary"></button>
      </div>
    `;
    li.querySelector('.name').textContent = g.name;
    li.querySelector('.host').textContent = g.hostName;
    li.querySelector('.count').textContent = g.memberCount;
    li.querySelector('code').textContent = g.code;
    // In-progress games show whose turn it is, the round, and how long
    // ago the last turn ended (from /lobbies/mine). The active player's
    // name is tinted with their seat colour, matching the in-game UI.
    const turnMeta = li.querySelector('.turn-meta');
    if (!cancelled && g.gameStatus === 'active' && (g.activePlayerName || g.pendingFirstPlayerName)) {
      const tail = [];
      if (g.round && g.maxRounds) tail.push(`Round ${g.round}/${g.maxRounds}`);
      if (g.lastTurnEndedAt) tail.push(`last turn ended ${timeAgo(g.lastTurnEndedAt)}`);
      const tailText = tail.length ? ` · ${tail.join(' · ')}` : '';
      if (g.pendingFirstPlayerName) {
        if (g.yourTurn) turnMeta.append(`⭐ Pick the first player${tailText}`);
        else turnMeta.append('⭐ ', mkPlayerName('@' + g.pendingFirstPlayerName, g.activePlayerColor), ` picking first player${tailText}`);
      } else if (g.yourTurn) {
        turnMeta.append('🎯 ', mkPlayerName('Your turn', g.activePlayerColor), tailText);
        li.classList.add('is-your-turn');
      } else {
        turnMeta.append('🎯 ', mkPlayerName('@' + g.activePlayerName, g.activePlayerColor), `'s turn${tailText}`);
      }
      turnMeta.hidden = false;
    }
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
  const maxRounds = Number(document.getElementById('create-rounds').value);
  const joinPolicy = document.querySelector('input[name=policy]:checked').value;
  const me = activeProfile();
  if (!me) return;
  const r = await createLobby({ name, maxPlayers, maxRounds, joinPolicy }, me.token);
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
  // The host kicked me. Arrives on my personal me:<id> channel; the
  // roster / poll absence detection in renderLobby is the reliable
  // fallback, this just makes the bounce immediate with a clear toast.
  const offKicked = ws.on('lobby_kicked', (msg) => {
    if (!_activeLobby || msg.lobbyId !== _activeLobby.id) return;
    _onToast('The host removed you from the table.', 'error');
    leaveCurrent();
  });
  _unsubWS = () => { offUpdate(); offDisband(); offKicked(); ws.unsubscribe(channel); };
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
  const me = activeProfile();
  // Kicked-out detection: if I'm holding this lobby but the fresh
  // roster no longer lists me (and the game hasn't started, where the
  // roster freezes), the host removed me. This is the RELIABLE path -
  // it fires off both the WS lobby_update and the 3s poll, so even if
  // the immediate me:<id> kick ping is dropped I still bounce. Guarded
  // by _activeLobby so the initial enter render (I'm present) and any
  // post-leave render don't trip it.
  if (me && _activeLobby && _activeLobby.id === lobby.id
      && lobby.status === 'waiting'
      && Array.isArray(lobby.members)
      && !lobby.members.some((m) => m.id === me.id)) {
    _onToast('The host removed you from the table.', 'error');
    leaveCurrent();
    return;
  }

  document.getElementById('lobby-name').textContent = lobby.name;
  document.getElementById('lobby-code-pill').textContent = lobby.code;
  document.getElementById('lobby-meta').innerHTML =
    `Hosted by <strong>@${escapeHtml(lobby.hostName)}</strong> · ` +
    `${lobby.members.length}/${lobby.maxPlayers} seats · ` +
    `${lobby.joinPolicy === 'open' ? 'open' : 'invite-only'}`;

  const iAmHost = me && me.id === lobby.hostId;
  const canKick = iAmHost && lobby.status === 'waiting';
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
    // Host sees a Kick button on every other player while waiting.
    if (canKick && !isHost && !isYou) {
      const kickBtn = document.createElement('button');
      kickBtn.type = 'button';
      kickBtn.className = 'lobby-kick-btn';
      kickBtn.textContent = '✖ Kick';
      kickBtn.title = `Remove @${member.name} from the table`;
      kickBtn.addEventListener('click', () => onKickClick(member));
      li.appendChild(kickBtn);
    }
    roster.appendChild(li);
  }

  const startBtn = document.getElementById('btn-start');
  startBtn.classList.toggle('hidden', !iAmHost || lobby.status !== 'waiting');

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

// Host action: remove a player from the table. Confirms first, then
// the server deletes their membership and re-publishes the lobby; the
// roster re-renders without them on the next update.
async function onKickClick(member) {
  if (!_activeLobby) return;
  const me = activeProfile();
  if (!me) return;
  if (!confirm(`Remove @${member.name} from the table?`)) return;
  const r = await kickPlayer(_activeLobby.id, member.id, me.token);
  if (!r.ok) {
    _onToast(humanizeError(r.error) || 'Could not remove that player.', 'error');
    return;
  }
  if (r.data && r.data.lobby) {
    _activeLobby = r.data.lobby;
    renderLobby(_activeLobby);
  }
  _onToast(`Removed @${member.name} from the table.`);
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

// Public "exit the current room back to the lobby list" used by the
// top-menu Lobby button. Detaches the online game layer and clears the
// /room/<CODE> path so the URL returns to the lobby list, letting the
// player pick another room or start a sandbox. The server-side lobby
// membership is kept (no leaveLobby API call), so Resume puts them back
// in. A no-op when there's nothing to leave.
export function exitToLobbyList() {
  if (_activeLobby || _gameMounted) {
    leaveCurrent();
  } else {
    _onShowView('view-lobby-list');
  }
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
    cant_kick_host: 'The host can\'t be removed.',
    bad_target: 'No such player at the table.',
    profile_not_found: 'No profile with that name.',
    self_invite: 'Can\'t invite yourself.',
    already_member: 'They\'re already at the table.',
    api_unavailable: 'Server unreachable.',
    network: 'Network error.',
  })[code] || code;
}
