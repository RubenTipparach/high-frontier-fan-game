// Lobby chat panel. Backfills history via REST, listens for new
// messages over WS, posts new messages via REST (the server then
// broadcasts back to all subscribers including this one).

import { fetchChat, sendChat } from './api.js';
import { activeProfile } from './auth.js';
import { ws } from './ws.js';

let _lobbyId = null;
let _unsubWS = null;

export async function mountChat(lobby) {
  _lobbyId = lobby.id;
  const list = document.getElementById('chat-list');
  list.innerHTML = '<li class="system">Loading chat…</li>';
  const me = activeProfile();
  const r = await fetchChat(lobby.id, {}, me.token);
  list.innerHTML = '';
  if (r.ok) {
    for (const m of r.data.entries) appendMessage(m);
  } else {
    appendSystem('Could not load chat history.');
  }
  scrollToBottom();

  if (_unsubWS) _unsubWS();
  _unsubWS = ws.on('chat', (msg) => {
    if (!msg.message || msg.message.lobbyId !== _lobbyId) return;
    appendMessage(msg.message);
    scrollToBottom();
  });

  const form = document.getElementById('form-chat');
  form.onsubmit = onSubmit;
}

export function unmountChat() {
  _lobbyId = null;
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

function appendMessage(m) {
  const list = document.getElementById('chat-list');
  const li = document.createElement('li');
  const me = activeProfile();
  const isYou = me && m.profileId === me.id;
  if (isYou) li.classList.add('you');
  // The chat server stores both REST-derived (profileName) and WS-
  // broadcast (profileName) under the same field; either way we
  // render it.
  li.innerHTML = `<span class="who">@</span><span class="body"></span>`;
  li.querySelector('.who').textContent = '@' + (m.profileName || '?');
  const body = document.createElement('span');
  body.textContent = ' ' + m.body;
  li.appendChild(body);
  const ts = document.createElement('span');
  ts.className = 'ts';
  ts.textContent = ' ' + formatTime(m.createdAt);
  li.appendChild(ts);
  list.appendChild(li);
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

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
