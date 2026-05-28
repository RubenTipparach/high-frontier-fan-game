// Thin fetch wrapper around the High Frontier companion API. Mirrors
// the murdoku-companion api.js pattern: base URL read from a meta tag
// so the frontend stays buildless. Every call returns a structured
// `{ ok, data?, error?, status }` so the caller can render errors
// without try/catch noise.

const META_NAME = 'hf-api-base';

function apiBase() {
  const meta = document.querySelector(`meta[name="${META_NAME}"]`);
  const v = meta && meta.getAttribute('content');
  return v && v.trim() ? v.trim().replace(/\/+$/, '') : null;
}

export function apiAvailable() {
  return !!apiBase();
}

export function apiBaseUrl() {
  return apiBase();
}

async function call(method, path, { body, token, signal } = {}) {
  const base = apiBase();
  if (!base) return { ok: false, error: 'api_unavailable', status: 0 };
  let res;
  try {
    res = await fetch(base + path, {
      method,
      signal,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: 'Bearer ' + token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      mode: 'cors',
    });
  } catch {
    return { ok: false, error: 'network', status: 0 };
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body is fine */ }
  if (!res.ok) {
    return { ok: false, error: (data && data.error) || 'http_' + res.status, status: res.status, data };
  }
  return { ok: true, data, status: res.status };
}

// ----- Health + profile -----

export async function probeServer(timeoutMs = 3000) {
  if (!apiAvailable()) return false;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await call('GET', '/healthz', { signal: ctl.signal });
    return r.ok;
  } finally { clearTimeout(t); }
}

export async function claimProfile(name, token) {
  return call('POST', '/profiles', { body: { name, token } });
}

export async function whoami(token) {
  return call('GET', '/profiles/me', { token });
}

export async function issueDeviceCode(token) {
  return call('POST', '/tokens', { token });
}

export async function searchProfiles(q) {
  const qs = encodeURIComponent(q || '');
  return call('GET', '/profiles/search?q=' + qs);
}

// ----- Lobbies -----

export async function listLobbies() {
  return call('GET', '/lobbies');
}

// Lobbies the caller is in, across all statuses (powers the "your
// games" + "ended games" sections). Requires the bearer token.
export async function listMyGames(token) {
  return call('GET', '/lobbies/mine', { token });
}

export async function getLobby(id) {
  return call('GET', '/lobbies/' + id);
}

export async function createLobby({ name, maxPlayers, joinPolicy }, token) {
  return call('POST', '/lobbies', { body: { name, maxPlayers, joinPolicy }, token });
}

export async function joinLobby(id, token) {
  return call('POST', `/lobbies/${id}/join`, { token });
}

export async function leaveLobby(id, token) {
  return call('POST', `/lobbies/${id}/leave`, { token });
}

export async function setReady(id, ready, token) {
  return call('POST', `/lobbies/${id}/ready`, { body: { ready: !!ready }, token });
}

export async function startLobby(id, token) {
  return call('POST', `/lobbies/${id}/start`, { token });
}

// ----- Invites -----

export async function createInviteLink(lobbyId, { singleUse, ttlMs }, token) {
  return call('POST', `/lobbies/${lobbyId}/invite-link`, {
    body: { singleUse: !!singleUse, ttlMs: ttlMs || null },
    token,
  });
}

export async function lookupInviteLink(code) {
  return call('GET', '/invites/links/' + encodeURIComponent(code));
}

export async function claimInviteLink(code, token) {
  return call('POST', `/invites/links/${encodeURIComponent(code)}/claim`, { token });
}

export async function inviteByName(lobbyId, name, token) {
  return call('POST', `/lobbies/${lobbyId}/invite`, { body: { name }, token });
}

export async function listInvites(token) {
  return call('GET', '/invites', { token });
}

export async function acceptInvite(id, token) {
  return call('POST', `/invites/${id}/accept`, { token });
}

export async function declineInvite(id, token) {
  return call('POST', `/invites/${id}/decline`, { token });
}

// ----- Games (Stage 3 server-authoritative engine) -----

export async function getGame(id, token) {
  return call('GET', '/games/' + id, { token });
}

// Submit one operation. `op` is { kind, ...payload }, e.g.
// { kind: 'MOVE', toSiteId } or { kind: 'END_TURN' }.
export async function submitGameOp(id, op, token) {
  return call('POST', `/games/${id}/ops`, { body: op, token });
}

export async function getGameOps(id, { after } = {}, token) {
  const qs = (after != null) ? '?after=' + after : '';
  return call('GET', `/games/${id}/ops${qs}`, { token });
}

// Read-only board snapshot at a given op seq (history review).
export async function getGameState(id, seq, token) {
  return call('GET', `/games/${id}/states/${seq}`, { token });
}

// ----- Chat -----

export async function fetchChat(lobbyId, { before } = {}, token) {
  const qs = before ? '?before=' + before : '';
  return call('GET', `/lobbies/${lobbyId}/chat${qs}`, { token });
}

export async function sendChat(lobbyId, body, token) {
  return call('POST', `/lobbies/${lobbyId}/chat`, { body: { body }, token });
}
