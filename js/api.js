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
    const error = (data && data.error) || 'http_' + res.status;
    logApiError(method, path, body, res.status, data, error);
    return { ok: false, error, status: res.status, data };
  }
  return { ok: true, data, status: res.status };
}

// Surface a failed server call (403 / 409 / any 4xx-5xx) to the console so a
// dev - or the on-device Eruda console (Config -> Developer) - can read the
// request that was sent and the server's response. The auth token rides in
// the header, never the body, so logging the body leaks nothing. Wrapped so
// a missing console never breaks the call.
function logApiError(method, path, body, status, data, error) {
  try {
    console.warn(
      `[api] ${method} ${path} -> ${status} (${error})`,
      { request: body == null ? null : body, status, response: data == null ? null : data },
    );
  } catch { /* no console available */ }
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

// Whether this profile may use the admin-gated Rat Frontier variant.
export async function ratFrontierAccess(token) {
  return call('GET', '/rat-frontier/access', { token });
}

// Save authoritative server node-tags from the Rat Frontier map editor.
// tags = { "<id2>": { lander, half, hazard, aerobrake, season, site_name } }.
export async function ratSaveNodeTags(token, tags) {
  return call('POST', '/rat-frontier/node-tags', { token, body: { tags } });
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

// In-progress games whose lobby was open. Anyone signed in can watch.
export async function listPublicGames(token) {
  return call('GET', '/games/public', { token });
}

export async function getLobby(id) {
  return call('GET', '/lobbies/' + id);
}

// Resolve a lobby by its 6-char share code. Used by the ?room=<code>
// URL bootstrap so a refresh / reconnect-loss puts the player back
// into the same lobby instead of dropping them to the lobby list.
export async function getLobbyByCode(code) {
  return call('GET', '/lobbies/by-code/' + encodeURIComponent(code));
}

export async function createLobby({ name, maxPlayers, maxRounds, joinPolicy, idempotencyKey, startingAqua, economy, draftStart, randomDraft, m0 }, token) {
  return call('POST', '/lobbies', { body: { name, maxPlayers, maxRounds, joinPolicy, idempotencyKey, startingAqua, economy, draftStart, randomDraft, m0 }, token });
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

// Host-only: remove another player from the lobby (waiting state only).
export async function kickPlayer(id, targetProfileId, token) {
  return call('POST', `/lobbies/${id}/kick`, { body: { targetProfileId }, token });
}

export async function startLobby(id, token) {
  return call('POST', `/lobbies/${id}/start`, { token });
}

// Host-only: edit room config (maxRounds / draftStart / m0 / joinPolicy) while
// the lobby is still waiting. Returns the updated lobby row.
export async function updateLobbySettings(id, settings, token) {
  return call('POST', `/lobbies/${id}/settings`, { token, body: settings });
}

// Host-only: close (soft-delete) a solo room. Marks it cancelled server-side;
// restorable via restoreLobby. Moves the room to the player's "ended" list.
export async function closeLobby(id, token) {
  return call('POST', `/lobbies/${id}/close`, { token });
}

// Host-only: restore a room you previously closed (un-cancels it).
export async function restoreLobby(id, token) {
  return call('POST', `/lobbies/${id}/restore`, { token });
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
//
// Bounded by a timeout: without one, a hung POST (flaky network, dropped
// frame, Fly cold-start) never resolves, so the caller's `_onlineBusy`
// in-flight guard never clears and EVERY later action silently jams until
// a page refresh. On timeout the request aborts and surfaces as a normal
// network error, the busy guard clears, and the player can retry.
export async function submitGameOp(id, op, token, { timeoutMs = 15000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await call('POST', `/games/${id}/ops`, { body: op, token, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

// One page = the 100 most recent ops. No cursor = the newest page;
// { before: seq } pages DOWN into history (infinite scroll);
// { after: seq } catches up FORWARD from a known seq. The response
// carries { entries, hasMore } - hasMore = older history exists below
// the returned window.
export async function getGameOps(id, { after, before } = {}, token) {
  const qs = (after != null) ? '?after=' + after
    : (before != null) ? '?before=' + before
    : '';
  return call('GET', `/games/${id}/ops${qs}`, { token });
}

// Manual turn nudge. opts: { targetId } to nudge one player on the
// clock, { all: true } to nudge everyone on the clock (auction rounds),
// { waiting: true } to nudge only the players still owing a response
// (in an auction: the bidders who have not bid/passed yet), or {} for
// the primary actor. Server enforces the per-target cooldown and returns
// { ok, nudged:[{targetId,targetName,sentAt}], skipped:[...] }.
export async function remindTurn(id, token, opts = {}) {
  return call('POST', `/games/${id}/remind`, { body: opts, token });
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

// Global chat: lobby-list-wide channel, no membership required.
// Server broadcasts on the 'global' WS channel.
export async function fetchGlobalChat({ before } = {}, token) {
  const qs = before ? '?before=' + before : '';
  return call('GET', `/chat/global${qs}`, { token });
}

export async function sendGlobalChat(body, token) {
  return call('POST', '/chat/global', { body: { body }, token });
}

// --- Turn notification prefs (opt-in Discord DM) ---
export async function getNotifyPrefs(token) {
  return call('GET', '/me/notify', { token });
}
export async function setNotifyPrefs(prefs, token) {
  return call('PUT', '/me/notify', { body: prefs, token });
}
export async function testNotify(discordUserId, token, gameId) {
  return call('POST', '/me/notify/test', { body: { discordUserId, gameId }, token });
}
// Begin the one-click "Connect Discord" OAuth flow: returns { url } the
// client opens in a popup. The server-side callback links the account.
export async function startDiscordOauth(token) {
  return call('POST', '/me/notify/oauth/start', { token });
}

// ----- Sign in with Discord (unauthenticated) -----

// Whether this deployment offers Discord sign-in (so the signin view can
// show/hide the button). Returns { enabled } or a soft failure.
export async function discordSignInEnabled() {
  return call('GET', '/auth/discord/enabled');
}

// Full-page URL that kicks off the Discord sign-in redirect. Null when
// the API isn't configured (local-only mode).
export function discordLoginStartUrl() {
  const base = apiBaseUrl();
  return base ? base + '/auth/discord/login/start' : null;
}

// Exchange the handoff code from the sign-in redirect. Resolves to
// { status:'signedin', token, id, name } or { status:'needName', suggestedName }.
export async function discordExchange(code) {
  return call('POST', '/auth/discord/exchange', { body: { code } });
}

// Finalize a first-time Discord sign-up with the chosen name.
export async function discordSignup(code, name) {
  return call('POST', '/auth/discord/signup', { body: { code, name } });
}

// --- Server-wide announcement banner ---
export async function getAnnouncement() {
  return call('GET', '/announcement', {});
}

// --- Site notes + tags (player-driven location annotations) ---
// siteId is the location's display id (the popup "id: ..."). All require a
// profile token. The aggregate response is { tags:[{tag,count,mine}],
// messages:[{id,body,author,mine,createdAt}] }.
export async function getSiteAnnotations(siteId, token) {
  return call('GET', '/sites/' + encodeURIComponent(siteId) + '/annotations', { token });
}
export async function postSiteAnnotation(siteId, payload, token) {
  return call('POST', '/sites/' + encodeURIComponent(siteId) + '/annotations', { body: payload, token });
}
export async function removeSiteTag(siteId, tag, token) {
  return call('POST', '/sites/' + encodeURIComponent(siteId) + '/untag', { body: { tag }, token });
}
export async function deleteSiteAnnotation(siteId, annId, token) {
  return call('DELETE', '/sites/' + encodeURIComponent(siteId) + '/annotations/' + annId, { token });
}
