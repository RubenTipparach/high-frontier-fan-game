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

// ----- channel webhooks -----
//
// A second, simpler notification path that needs NO bot: a Discord
// channel webhook URL posts a message to that channel. The operator
// creates one in Discord (Channel -> Edit -> Integrations -> Webhooks
// -> New Webhook -> Copy URL) and either sets DISCORD_WEBHOOK_URL or
// pastes it into the admin dashboard. Unlike the bot DM path this is
// server-wide (one channel for the whole deployment), not per-player.
//
// `getWebhookUrl` resolves the effective URL: the explicit argument
// wins (so a test can fire "whatever is filled" before saving), then
// the DB-stored value the caller passes in, then the env default.

const ENV_WEBHOOK = process.env.DISCORD_WEBHOOK_URL || '';

// Discord webhook URLs look like
// https://discord.com/api/webhooks/<id>/<token> (discordapp.com and
// the ptb/canary subdomains are also valid hosts).
const WEBHOOK_RE =
  /^https:\/\/(?:[\w-]+\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/\d+\/[\w-]+$/;

export function isWebhookUrl(url) {
  return WEBHOOK_RE.test(String(url || '').trim());
}

// True when SOME webhook URL is available (env or the stored value the
// caller hands in). Lets index.js gate dispatch the way discordEnabled
// gates DMs.
export function webhookEnabled(storedUrl) {
  return isWebhookUrl(storedUrl) || isWebhookUrl(ENV_WEBHOOK);
}

export function defaultWebhookUrl() {
  return ENV_WEBHOOK;
}

// Post a message to a channel webhook. `url` is the effective URL
// (explicit > stored > env, resolved by the caller). Returns { ok } or
// { ok:false, error }; never throws.
export async function sendWebhook(content, url) {
  const hook = (isWebhookUrl(url) ? url : ENV_WEBHOOK).trim();
  if (!isWebhookUrl(hook)) return { ok: false, error: 'webhook_disabled' };
  try {
    const r = await fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: String(content).slice(0, 1800) }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return { ok: false, error: `webhook ${r.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}
