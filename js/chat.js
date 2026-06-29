// Lobby chat panel. Backfills history via REST, listens for new
// messages over WS, posts new messages via REST (the server then
// broadcasts back to all subscribers including this one).

import { fetchChat, sendChat } from './api.js';
import { activeProfile } from './auth.js';
import { ws } from './ws.js';

// The server returns at most this many messages per request (newest first,
// then reversed to oldest-first). The opening view shows just the latest page;
// older messages load on demand via the "load earlier" button at the top.
const PAGE = 100;

let _lobbyId = null;
let _unsubWS = null;
// Oldest message timestamp currently rendered (the cursor for "load earlier"),
// and whether the server might still have older messages to hand back.
let _oldestTs = null;
let _hasMore = false;
let _loadingMore = false;

export async function mountChat(lobby) {
  _lobbyId = lobby.id;
  _oldestTs = null;
  _hasMore = false;
  _loadingMore = false;
  const list = document.getElementById('chat-list');
  list.innerHTML = '<li class="system">Loading chat…</li>';
  const me = activeProfile();
  const r = await fetchChat(lobby.id, {}, me.token);
  list.innerHTML = '';
  if (r.ok) {
    const entries = r.data.entries || [];
    // A full page back means there are probably older messages to fetch.
    _hasMore = entries.length >= PAGE;
    if (entries.length) _oldestTs = entries[0].createdAt;
    for (const m of entries) appendMessage(m);
    renderLoadMore();
  } else {
    appendSystem('Could not load chat history.');
  }
  // Always land at the newest message on open.
  scrollToBottom();

  if (_unsubWS) _unsubWS();
  _unsubWS = ws.on('chat', (msg) => {
    if (!msg.message || msg.message.lobbyId !== _lobbyId) return;
    // Only yank the view to the bottom if the reader is already there; someone
    // scrolled up reading history shouldn't get dragged down by a new line.
    const atBottom = isNearBottom();
    appendMessage(msg.message);
    if (atBottom) scrollToBottom();
  });

  const form = document.getElementById('form-chat');
  form.onsubmit = onSubmit;
}

export function unmountChat() {
  _lobbyId = null;
  _oldestTs = null;
  _hasMore = false;
  _loadingMore = false;
  if (_unsubWS) { _unsubWS(); _unsubWS = null; }
  const form = document.getElementById('form-chat');
  if (form) form.onsubmit = null;
}

async function onSubmit(ev) {
  ev.preventDefault();
  const input = document.getElementById('chat-input');
  const body = input.value.trim();
  if (!body || !_lobbyId) return;
  const me = activeProfile();
  if (!me) return;
  input.value = '';
  // Send via REST. The server broadcasts over WS; the broadcast lands
  // in the 'chat' handler above which appends. We don't optimistically
  // append here to avoid double-rendering if the WS comes back fast.
  const r = await sendChat(_lobbyId, body, me.token);
  if (!r.ok) {
    appendSystem('Send failed (' + r.error + '). Restoring draft.');
    input.value = body;
    scrollToBottom();
  }
}

// Insert / refresh the "load earlier messages" control at the very top of the
// list. Present only while the server might still have older history.
function renderLoadMore() {
  const list = document.getElementById('chat-list');
  if (!list) return;
  let li = list.querySelector('.chat-load-more');
  if (!_hasMore) { if (li) li.remove(); return; }
  if (!li) {
    li = document.createElement('li');
    li.className = 'chat-load-more';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chat-load-more-btn';
    btn.textContent = '↑ Load earlier messages';
    btn.addEventListener('click', loadEarlier);
    li.appendChild(btn);
  }
  // Keep it pinned as the first child.
  if (list.firstChild !== li) list.insertBefore(li, list.firstChild);
}

// Fetch the page of messages older than the oldest one shown and splice them in
// above the current history, holding the reader's scroll position steady.
async function loadEarlier() {
  if (_loadingMore || !_hasMore || !_lobbyId || _oldestTs == null) return;
  _loadingMore = true;
  const list = document.getElementById('chat-list');
  const btn = list && list.querySelector('.chat-load-more-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
  const me = activeProfile();
  const r = await fetchChat(_lobbyId, { before: _oldestTs }, me ? me.token : null);
  if (!r.ok) {
    if (btn) { btn.disabled = false; btn.textContent = '↑ Load earlier messages'; }
    _loadingMore = false;
    return;
  }
  const entries = r.data.entries || [];
  _hasMore = entries.length >= PAGE;
  if (entries.length) _oldestTs = entries[0].createdAt;
  // Anchor: remember how tall the scrollback was so we can restore the reader's
  // spot after prepending taller content above it.
  const prevHeight = list.scrollHeight;
  const prevTop = list.scrollTop;
  const anchor = list.querySelector('.chat-load-more')
    ? list.querySelector('.chat-load-more').nextSibling
    : list.firstChild;
  for (const m of entries) list.insertBefore(buildMessage(m), anchor);
  renderLoadMore();
  // Restore scroll so the view doesn't jump when older lines appear on top.
  list.scrollTop = prevTop + (list.scrollHeight - prevHeight);
  if (btn && _hasMore) { btn.disabled = false; btn.textContent = '↑ Load earlier messages'; }
  _loadingMore = false;
}

// Build a message <li> (shared by initial render, live appends, and prepends).
function buildMessage(m) {
  const li = document.createElement('li');
  const me = activeProfile();
  const isYou = me && m.profileId === me.id;
  if (isYou) li.classList.add('you');
  li.innerHTML = `<span class="who"></span>`;
  li.querySelector('.who').textContent = '@' + (m.profileName || '?');
  const body = document.createElement('span');
  body.textContent = ' ' + m.body;
  li.appendChild(body);
  const ts = document.createElement('span');
  ts.className = 'ts';
  ts.textContent = ' ' + formatTime(m.createdAt);
  li.appendChild(ts);
  return li;
}

function appendMessage(m) {
  const list = document.getElementById('chat-list');
  list.appendChild(buildMessage(m));
}

function appendSystem(text) {
  const list = document.getElementById('chat-list');
  const li = document.createElement('li');
  li.className = 'system';
  li.textContent = text;
  list.appendChild(li);
}

function scrollToBottom() {
  const list = document.getElementById('chat-list');
  list.scrollTop = list.scrollHeight;
}

// Is the reader parked at (or within a line of) the newest message? Used to
// decide whether a freshly arrived message should auto-scroll into view.
function isNearBottom() {
  const list = document.getElementById('chat-list');
  if (!list) return true;
  return list.scrollHeight - list.scrollTop - list.clientHeight < 40;
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
