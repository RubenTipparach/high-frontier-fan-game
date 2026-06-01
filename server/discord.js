// Discord bot DM sender for out-of-band turn notifications.
//
// Uses the Discord REST API directly (no gateway / discord.js dependency):
// open a DM channel with the user, then post a message. Sending a DM needs
// only the bot token + the target's user id - BUT Discord only delivers if
// the bot shares a server with the user (and the user allows DMs), so the
// player must be in a server the bot is also in.
//
// Entirely inert when DISCORD_BOT_TOKEN is unset: discordEnabled() is false
// and sendDM() no-ops. That keeps the whole notification feature opt-in and
// backwards compatible - nothing changes for deployments without a bot.

const TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const API = 'https://discord.com/api/v10';

// userId -> DM channel id. Opening a DM channel is rate-limited, so we
// cache the channel once Discord hands it back.
const _dmChannel = new Map();

export function discordEnabled() {
  return !!TOKEN;
}

async function openDmChannel(userId) {
  if (_dmChannel.has(userId)) return _dmChannel.get(userId);
  const r = await fetch(`${API}/users/@me/channels`, {
    method: 'POST',
    headers: { Authorization: `Bot ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient_id: userId }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`open DM ${r.status}: ${body.slice(0, 200)}`);
  }
  const j = await r.json();
  _dmChannel.set(userId, j.id);
  return j.id;
}

// Send a DM. Returns { ok } or { ok:false, error }. Never throws.
export async function sendDM(userId, content) {
  if (!TOKEN) return { ok: false, error: 'discord_disabled' };
  const uid = String(userId || '').trim();
  if (!/^\d{5,25}$/.test(uid)) return { ok: false, error: 'bad_discord_id' };
  try {
    const channelId = await openDmChannel(uid);
    const r = await fetch(`${API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: String(content).slice(0, 1800) }),
    });
    if (!r.ok) {
      // A stale cached channel can 404/403; drop it so the next try reopens.
      _dmChannel.delete(uid);
      const body = await r.text().catch(() => '');
      return { ok: false, error: `send ${r.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// ----- OAuth2 "Connect Discord" (one-click linking + auto-join) -----
//
// The friction-free path: instead of asking a player to enable Developer
// Mode, copy their user id, and manually join the bot's server, they
// click "Connect Discord", approve once, and the callback does both
// steps automatically:
//   - `identify`    -> read their user id (no copy-paste)
//   - `guilds.join` -> the BOT adds them to DISCORD_GUILD_ID via the bot
//                      token, creating the mutual guild Discord requires
//                      for a bot DM. The player never has to open or use
//                      that server; it exists only to satisfy the DM rule.
//
// Requires three more env values (all alongside DISCORD_BOT_TOKEN):
//   DISCORD_CLIENT_ID     - the application id (public)
//   DISCORD_CLIENT_SECRET - the OAuth2 client secret (secret!)
//   DISCORD_GUILD_ID      - the bot's server, where players are auto-added
//
// Inert (oauthEnabled() === false) unless CLIENT_ID + CLIENT_SECRET +
// GUILD_ID + bot token are all set, so deployments without OAuth keep
// working on the manual user-id path.

const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const GUILD_ID = process.env.DISCORD_GUILD_ID || '';

export function oauthEnabled() {
  return !!(CLIENT_ID && CLIENT_SECRET && GUILD_ID && TOKEN);
}

export function oauthClientId() {
  return CLIENT_ID;
}

// Build the Discord authorize URL the browser is redirected to. `state`
// is an opaque CSRF token the caller persists; `redirectUri` must exactly
// match one registered in the Developer Portal (Redirects).
export function buildAuthorizeUrl(state, redirectUri) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    scope: 'identify guilds.join',
    state,
    redirect_uri: redirectUri,
    prompt: 'consent',
  });
  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

// Exchange the authorization code for an access token. Returns
// { ok, accessToken } or { ok:false, error }. Never throws.
async function exchangeCode(code, redirectUri) {
  try {
    const r = await fetch(`${API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }).toString(),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return { ok: false, error: `token ${r.status}: ${body.slice(0, 200)}` };
    }
    const j = await r.json();
    return { ok: true, accessToken: j.access_token };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// Read the authorized user's id via the access token (identify scope).
async function fetchUserId(accessToken) {
  try {
    const r = await fetch(`${API}/users/@me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return { ok: false, error: `me ${r.status}: ${body.slice(0, 200)}` };
    }
    const j = await r.json();
    return { ok: true, userId: String(j.id || '') };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// Add the user to the bot's guild (guilds.join scope + bot token).
// 201 = added, 204 = already a member - both are success.
async function addToGuild(userId, accessToken) {
  try {
    const r = await fetch(`${API}/guilds/${GUILD_ID}/members/${userId}`, {
      method: 'PUT',
      headers: { Authorization: `Bot ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: accessToken }),
    });
    if (r.status === 201 || r.status === 204) return { ok: true };
    const body = await r.text().catch(() => '');
    return { ok: false, error: `join ${r.status}: ${body.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// Full callback flow: code -> access token -> user id -> guild join.
// Returns { ok, userId } on success so the route can persist the id and
// confirm DMs will now reach the player. Never throws.
export async function completeOauth(code, redirectUri) {
  if (!oauthEnabled()) return { ok: false, error: 'oauth_disabled' };
  const tok = await exchangeCode(code, redirectUri);
  if (!tok.ok) return tok;
  const me = await fetchUserId(tok.accessToken);
  if (!me.ok) return me;
  if (!/^\d{5,25}$/.test(me.userId)) return { ok: false, error: 'bad_discord_id' };
  const joined = await addToGuild(me.userId, tok.accessToken);
  if (!joined.ok) return joined;
  return { ok: true, userId: me.userId };
}
