// Two invite paths:
//   1. Direct invite by name. Autocompletes from /profiles/search.
//      Sends a direct invite that the recipient sees in their pending
//      invites list (and as a WS push if they're online).
//   2. Invite link. Host generates a 12-char code; anyone with the
//      code can paste it into "Join by link" on the lobby list view.
//
// Also: pending invite list on the lobby-list view, accept/decline
// affordances, and the WS handler that pops a toast when a fresh
// invite arrives.

import {
  searchProfiles, inviteByName, createInviteLink,
  listInvites, acceptInvite, declineInvite,
} from './api.js';
import { activeProfile } from './auth.js';
import { ws } from './ws.js';
import { openLobby } from './lobby.js';

let _lobby = null;
let _searchTimer = null;
let _onToast = null;

export function initInvites({ onToast }) {
  _onToast = onToast;
  // Personal-channel subscription so invites pushed by the server
  // arrive in real time. The 'me:' channel is auto-claimable for the
  // owning profile only.
  ws.on('invite', (msg) => {
    _onToast(`Invite to "${msg.lobbyName || ('lobby ' + msg.lobbyId)}" from @${msg.from}`, 'invite');
    refreshInvitesList();
  });
  // Server cancels invites when the lobby starts, is disbanded, or
  // when the player joins through any path. Refresh so the chip
  // badge + the dropdown list clear without a manual reload.
  ws.on('invite_cancelled', () => {
    refreshInvitesList();
  });
  ws.on('state', (s) => {
    const me = activeProfile();
    if (s.ready && me) ws.subscribe('me:' + me.id);
  });
}

// Sub the personal channel as soon as we know the profile id.
export function subscribeInvitesForProfile(profile) {
  if (profile && profile.id) ws.subscribe('me:' + profile.id);
}

// Lobby-detail invite controls.
export function mountInvitesUI(lobby) {
  _lobby = lobby;
  const search = document.getElementById('invite-search-input');
  const results = document.getElementById('invite-search-results');
  search.value = '';
  results.innerHTML = '';
  search.oninput = () => {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => runSearch(search.value), 200);
  };
  document.getElementById('btn-make-link').onclick = onMakeLink;
  document.getElementById('btn-copy-link').onclick = onCopyLink;
  document.getElementById('invite-link-result').classList.add('hidden');
}

export function unmountInvitesUI() {
  _lobby = null;
  const search = document.getElementById('invite-search-input');
  if (search) search.oninput = null;
}

async function runSearch(q) {
  const results = document.getElementById('invite-search-results');
  const me = activeProfile();
  q = (q || '').trim();
  if (!q) { results.innerHTML = ''; return; }
  const r = await searchProfiles(q);
  if (!r.ok) { results.innerHTML = ''; return; }
  results.innerHTML = '';
  const filtered = r.data.entries.filter((p) => !me || p.id !== me.id);
  if (!filtered.length) {
    results.innerHTML = '<li class="empty">No matching profiles.</li>';
    return;
  }
  for (const p of filtered) {
    const li = document.createElement('li');
    const alreadyMember = _lobby && _lobby.members.some((m) => m.id === p.id);
    li.innerHTML = `
      <span>@<strong></strong>
        <span class="seen"></span>
      </span>
      <button class="primary"></button>
    `;
    li.querySelector('strong').textContent = p.name;
    li.querySelector('.seen').textContent = ' · seen ' + relativeTime(p.lastSeenAt);
    const btn = li.querySelector('button');
    btn.textContent = alreadyMember ? 'At table' : 'Invite';
    btn.disabled = alreadyMember;
    btn.onclick = async () => {
      if (alreadyMember) return;
      btn.disabled = true; btn.textContent = '…';
      const r2 = await inviteByName(_lobby.id, p.name, me.token);
      if (r2.ok) { btn.textContent = 'Invited ✓'; }
      else { btn.disabled = false; btn.textContent = 'Retry'; _onToast(`Invite failed: ${r2.error}`, 'error'); }
    };
    results.appendChild(li);
  }
}

async function onMakeLink() {
  if (!_lobby) return;
  const me = activeProfile();
  const singleUse = document.getElementById('link-single-use').checked;
  const r = await createInviteLink(_lobby.id, { singleUse }, me.token);
  if (!r.ok) { _onToast(`Couldn't generate link: ${r.error}`, 'error'); return; }
  const box = document.getElementById('invite-link-result');
  const input = document.getElementById('invite-link-url');
  input.value = inviteUrl(r.data.code);
  box.classList.remove('hidden');
  input.select();
}

function onCopyLink() {
  const input = document.getElementById('invite-link-url');
  input.select();
  if (navigator.clipboard) navigator.clipboard.writeText(input.value);
  else document.execCommand('copy');
  document.getElementById('btn-copy-link').textContent = 'Copied';
  setTimeout(() => { document.getElementById('btn-copy-link').textContent = 'Copy'; }, 1200);
}

function inviteUrl(code) {
  const u = new URL(window.location.href);
  u.search = '?invite=' + encodeURIComponent(code);
  u.hash = '';
  return u.toString();
}

// ----- Pending invites pane (on the lobby-list view) -----

export async function refreshInvitesList() {
  const me = activeProfile();
  const list = document.getElementById('invite-list');
  if (!me) { list.innerHTML = '<li class="empty">Sign in to see invites.</li>'; return; }
  const r = await listInvites(me.token);
  if (!r.ok) { list.innerHTML = '<li class="empty">Couldn\'t load invites.</li>'; return; }
  if (!r.data.entries.length) {
    list.innerHTML = '<li class="empty">No pending invites.</li>';
    return;
  }
  list.innerHTML = '';
  for (const inv of r.data.entries) {
    const li = document.createElement('li');
    li.innerHTML = `
      <div>
        <strong></strong>
        <div class="meta">from @<span class="from"></span></div>
      </div>
      <div class="row-actions">
        <button class="primary acc">Accept</button>
        <button class="dec">Decline</button>
      </div>
    `;
    li.querySelector('strong').textContent = inv.lobbyName;
    li.querySelector('.from').textContent = inv.fromName;
    li.querySelector('.acc').onclick = async () => {
      const r2 = await acceptInvite(inv.id, me.token);
      if (!r2.ok) { _onToast(`Couldn't accept: ${r2.error}`, 'error'); return; }
      await openLobby(r2.data.lobbyId, { join: false });
      refreshInvitesList();
    };
    li.querySelector('.dec').onclick = async () => {
      await declineInvite(inv.id, me.token);
      refreshInvitesList();
    };
    list.appendChild(li);
  }
}

function relativeTime(ts) {
  if (!ts) return '?';
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return min + 'm ago';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + 'h ago';
  const day = Math.floor(hr / 24);
  return day + 'd ago';
}
