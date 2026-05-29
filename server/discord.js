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
