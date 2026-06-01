// High Frontier companion API. Stage 1: profiles, lobbies, chat,
// invites. Stage 3+ will add game ops; the protocol is designed so a
// future `op` message slots in without disturbing the social layer.
//
// HTTP and WebSocket share the same process so a single Fly machine
// can serve both. The WebSocket layer is a thin relay on top of the
// SQLite-backed REST routes: every event broadcast over WS is also
// the side-effect of a REST mutation, so a player who never opens a
// WS connection still gets a consistent view by polling REST.

import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { db, nowMs } from './db.js';
import { createInitialState } from './game/state.js';
import { applyOperation, SUPPORTED_OPS, NEEDS_TURN_BASE } from './game/engine.js';
import { randomSeed } from './game/rng.js';
import {
  sendDM, discordEnabled,
  sendWebhook, webhookEnabled, isWebhookUrl, defaultWebhookUrl,
  oauthEnabled, oauthClientId, buildAuthorizeUrl, completeOauth,
  oauthIdentifyEnabled, buildIdentifyAuthorizeUrl, identifyOauth,
} from './discord.js';

const PORT = Number(process.env.PORT) || 8080;

// ----- Config / constants -----

const RESERVED_NAMES = new Set([
  'admin', 'system', 'anonymous', 'guest',
  'highfrontier', 'hf', 'server', 'bot',
]);
const PROFILE_NAME_RE = /^[A-Za-z0-9_-]{3,20}$/;
// Two token formats, same as murdoku-companion:
//   - Legacy: 43-char base64url (32 random bytes), the client-generated
//     primary token.
//   - Short: 8-char Crockford base32, used for cross-device recovery.
const TOKEN_RE_LEGACY = /^[A-Za-z0-9_-]{43}$/;
const TOKEN_RE_SHORT  = /^[0-9a-hjkmnp-tv-z]{8}$/;

// Crockford base32 alphabet (drops I, L, O, U for human-friendliness).
const CODE_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
function generateShortCode(len = 8) {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % 32];
  return out;
}

// Strict shape check used at the route boundary so a bogus value
// (wrong alphabet, too long / short) is rejected with a typed error
// instead of round-tripping through the DB only to come back empty.
// Cap at 32 to keep error responses small.
const CODE_SHAPE_RE = /^[0-9a-hjkmnp-tv-z]{4,32}$/;
function normaliseCode(raw) {
  const s = String(raw || '').trim().toLowerCase();
  return CODE_SHAPE_RE.test(s) ? s : null;
}

// 12 chars for invite links: long enough to be unguessable, short
// enough to drop in a chat. Same alphabet as device codes.
function generateInviteCode() { return generateShortCode(12); }

// Tokens are stored as sha256(token) so a sqlite leak cannot be
// replayed as a bearer credential.
function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function isValidName(name) {
  return typeof name === 'string'
    && PROFILE_NAME_RE.test(name)
    && !RESERVED_NAMES.has(name.toLowerCase());
}

function isValidToken(token) {
  return typeof token === 'string'
    && (TOKEN_RE_LEGACY.test(token) || TOKEN_RE_SHORT.test(token));
}

// ----- App / HTTP server / WS server -----

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use(cors({
  origin: [
    /\.github\.io$/,
    /^http:\/\/localhost(:\d+)?$/,
    /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  ],
  credentials: false,
  maxAge: 86400,
}));
app.set('trust proxy', true);

// ----- Rate limit (in-memory, per process) -----

const RATE_WINDOW_MS = 60 * 60 * 1000;
const rateBuckets = new Map();

function rateLimit(ip, key, max) {
  const now = Date.now();
  let b = rateBuckets.get(ip);
  if (!b) { b = {}; rateBuckets.set(ip, b); }
  const arr = (b[key] = (b[key] || []).filter((t) => now - t < RATE_WINDOW_MS));
  if (arr.length >= max) return false;
  arr.push(now);
  return true;
}

setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW_MS;
  for (const [ip, b] of rateBuckets) {
    let alive = false;
    for (const k of Object.keys(b)) {
      b[k] = b[k].filter((t) => t > cutoff);
      if (b[k].length) alive = true;
    }
    if (!alive) rateBuckets.delete(ip);
  }
}, 10 * 60 * 1000).unref();

// ----- Auth middleware -----

function profileFromToken(token) {
  if (!isValidToken(token)) return null;
  const tokenHash = hashToken(token);
  const row = db
    .prepare(
      `SELECT p.id, p.name, p.banned_at
       FROM tokens t
       JOIN profiles p ON p.id = t.profile_id
       WHERE t.token_hash = ?`
    )
    .get(tokenHash);
  if (!row || row.banned_at) return null;
  db.prepare('UPDATE profiles SET last_seen_at = ? WHERE id = ?')
    .run(nowMs(), row.id);
  return { id: row.id, name: row.name };
}

function requireProfile(req, res, next) {
  const h = req.headers.authorization || '';
  const m = /^Bearer (.+)$/.exec(h);
  const profile = m ? profileFromToken(m[1]) : null;
  if (!profile) return res.status(401).json({ error: 'unauthorized' });
  req.profile = profile;
  next();
}

// ----- Profile routes -----

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, ts: nowMs() });
});

// Server-wide announcement banner (shown atop global chat). Seeded once
// with the current note; editable from /admin. A future build can expand
// this into a richer "post an update" box - it's already a settings row.
const DEFAULT_ANNOUNCEMENT =
  '@ruben-phone: discord integration and email notifications are being worked on, '
  + 'both require some leg work on my part to add 3rd party services\n'
  + '@ruben-phone: for now I\'ll just ping you when its your turn';
db.prepare('INSERT OR IGNORE INTO server_settings (key, value, updated_at) VALUES (?, ?, ?)')
  .run('announcement', DEFAULT_ANNOUNCEMENT, nowMs());

app.get('/announcement', (_req, res) => {
  const row = db.prepare('SELECT value, updated_at FROM server_settings WHERE key = ?').get('announcement');
  res.json({ message: (row && row.value) || '', updatedAt: (row && row.updated_at) || 0 });
});

// ===== Admin auth (Discord OAuth, allowlisted) =====
//
// The /admin panel is gated behind Discord OAuth: only an allowlisted
// Discord account may sign in. The allowlist is seeded from the
// ADMIN_DISCORD_ID secret into server_settings on boot (so the id stays
// out of source and rotates with the secret), and a successful login
// mints a DB-backed session - sha256 of the token is stored, the raw
// token rides in an httpOnly cookie (same posture as profile tokens).

const ADMIN_COOKIE = 'hf_admin';
const ADMIN_COOKIE_PATH = '/admin';
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

// Seed the allowlist from the ADMIN_DISCORD_ID(S) secret on every boot,
// so adding the secret on Fly + redeploy materialises it DB-side and
// rotating it updates the stored allowlist. Comma-separated ids
// supported; an absent env leaves whatever is already stored.
(function seedAdminAllowlist() {
  const raw = String(process.env.ADMIN_DISCORD_ID || process.env.ADMIN_DISCORD_IDS || '').trim();
  if (!raw) return;
  const ids = raw.split(',').map((s) => s.trim()).filter((s) => /^\d{5,25}$/.test(s));
  if (!ids.length) return;
  db.prepare(
    `INSERT INTO server_settings (key, value, updated_at) VALUES ('admin_discord_ids', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(ids.join(','), nowMs());
})();

function adminAllowlist() {
  const row = db.prepare("SELECT value FROM server_settings WHERE key = 'admin_discord_ids'").get();
  return new Set(String((row && row.value) || '').split(',').map((s) => s.trim()).filter(Boolean));
}
function isAdminDiscordId(id) {
  return adminAllowlist().has(String(id || ''));
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

// Mint a DB-backed admin session; returns the raw token for the cookie.
function createAdminSession(discordId) {
  const token = generateShortCode(24);
  const now = nowMs();
  db.prepare(
    `INSERT INTO admin_sessions (token_hash, discord_id, created_at, expires_at)
     VALUES (?, ?, ?, ?)`
  ).run(hashToken(token), String(discordId), now, now + ADMIN_SESSION_TTL_MS);
  return token;
}

// Resolve the admin from the request cookie. The session must be
// unexpired AND its Discord id still on the allowlist, so dropping an id
// from the secret + redeploy revokes any live session. Returns the
// Discord id or null; prunes the row when it has expired.
function adminFromRequest(req) {
  const token = readCookie(req, ADMIN_COOKIE);
  if (!token) return null;
  const hash = hashToken(token);
  const row = db.prepare('SELECT discord_id, expires_at FROM admin_sessions WHERE token_hash = ?').get(hash);
  if (!row) return null;
  if (row.expires_at <= nowMs()) {
    db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(hash);
    return null;
  }
  if (!isAdminDiscordId(row.discord_id)) return null;
  return row.discord_id;
}

function setAdminCookie(req, res, token) {
  res.cookie(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.protocol === 'https',
    maxAge: ADMIN_SESSION_TTL_MS,
    path: ADMIN_COOKIE_PATH,
  });
}
function clearAdminSession(req, res) {
  const token = readCookie(req, ADMIN_COOKIE);
  if (token) db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(hashToken(token));
  res.clearCookie(ADMIN_COOKIE, { path: ADMIN_COOKIE_PATH });
}

// Middleware for admin action routes: 403 unless a valid admin session.
function requireAdmin(req, res, next) {
  if (adminFromRequest(req)) return next();
  return res.status(403).json({ error: 'admin_auth_required' });
}

// Minimal styled HTML page (login screen + error notices), matching the
// OAuth callback's look.
function adminHtmlPage(title, bodyHtml, accent = '#f87171') {
  return `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(title)}</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:15px ui-sans-serif,system-ui,sans-serif;background:#07060f;color:#e6e9ff;
display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center;text-align:center;padding:24px}
.box{max-width:440px}h1{font-size:20px;color:${accent};margin:0 0 12px}
p{color:#8b90b8;line-height:1.55}
a.btn{display:inline-block;margin-top:18px;padding:11px 18px;border-radius:9px;
background:#5865F2;color:#fff;text-decoration:none;font-weight:700}
a.btn:hover{background:#4752c4}</style></head><body><div class="box">
<h1>${esc(title)}</h1>${bodyHtml}</div></body></html>`;
}
function adminLoginPage() {
  const ready = oauthIdentifyEnabled() && adminAllowlist().size > 0;
  if (!ready) {
    return adminHtmlPage('Admin locked',
      `<p>The admin panel is gated behind Discord, but it is not configured on this
       server yet. Set <code>DISCORD_CLIENT_ID</code> / <code>DISCORD_CLIENT_SECRET</code>
       and the <code>ADMIN_DISCORD_ID</code> secret, then redeploy.</p>`);
  }
  return adminHtmlPage('Admin sign-in',
    `<p>This panel is restricted. Sign in with the authorized Discord account to continue.</p>
     <a class="btn" href="/admin/login">Sign in with Discord</a>`, '#4ade80');
}

// Start admin sign-in: stash an admin OAuth state (persisted in SQLite,
// like the other no-profile Discord flows, so it survives a Fly
// cold-start mid-login) and bounce to Discord.
app.get('/admin/login', (req, res) => {
  if (!oauthIdentifyEnabled() || !adminAllowlist().size) {
    return res.status(503).type('html').send(adminLoginPage());
  }
  pruneDiscordAuth();
  const state = generateShortCode(16);
  db.prepare('INSERT INTO admin_login_states (state, expires_at) VALUES (?, ?)')
    .run(state, Date.now() + OAUTH_STATE_TTL_MS);
  res.redirect(buildIdentifyAuthorizeUrl(state, oauthRedirectUri(req)));
});

// Sign out: drop the session row and clear the cookie.
app.post('/admin/logout', (req, res) => {
  clearAdminSession(req, res);
  res.json({ ok: true });
});

// Set the announcement (lives under /admin like the other admin actions).
app.post('/admin/announcement', requireAdmin, (req, res) => {
  const message = String((req.body && req.body.message) || '');
  db.prepare(
    `INSERT INTO server_settings (key, value, updated_at) VALUES ('announcement', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(message, nowMs());
  res.json({ ok: true });
});

// Save the server-wide Discord channel webhook URL (or clear it with a
// blank value). Validated so a typo doesn't silently disable the feed.
// Same open-dashboard posture as the other /admin actions.
app.post('/admin/discord-webhook', requireAdmin, (req, res) => {
  const url = String((req.body && req.body.url) || '').trim();
  if (url && !isWebhookUrl(url)) return res.status(400).json({ error: 'bad_webhook_url' });
  db.prepare(
    `INSERT INTO server_settings (key, value, updated_at) VALUES ('discord_webhook_url', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(url, nowMs());
  res.json({ ok: true });
});

// Fire a test message to a webhook URL. Uses the URL in the request
// body if present (so the operator can verify before saving), else the
// saved / env URL. 503 if nothing is configured, 502 on a Discord error.
app.post('/admin/discord-webhook/test', requireAdmin, async (req, res) => {
  let url = String((req.body && req.body.url) || '').trim();
  if (!url) url = storedWebhookUrl();
  if (!isWebhookUrl(url)) return res.status(503).json({ error: 'webhook_disabled' });
  const r = await sendWebhook('✅ High Frontier webhook test - notifications will post here.', url);
  if (!r.ok) return res.status(502).json({ error: r.error });
  res.json({ ok: true });
});

// Create or re-claim a profile. Identical contract to murdoku:
//   201 -> new profile created
//   200 -> existing profile + matching token (idempotent re-claim)
//   409 -> name exists but the token doesn't match any device for that
//          profile. Caller should either pick a different name or
//          paste an existing device code.
app.post('/profiles', (req, res) => {
  const { name, token } = req.body || {};
  if (!isValidName(name)) return res.status(400).json({ error: 'invalid_name' });
  if (!isValidToken(token)) return res.status(400).json({ error: 'invalid_token' });
  if (!rateLimit(req.ip, 'profileCreate', 3)) {
    return res.status(429).json({ error: 'rate_limited' });
  }
  const nameLower = name.toLowerCase();
  const tokenHash = hashToken(token);
  const now = nowMs();

  const existing = db
    .prepare('SELECT id FROM profiles WHERE name_lower = ?')
    .get(nameLower);

  if (existing) {
    const tokenRow = db
      .prepare('SELECT id FROM tokens WHERE profile_id = ? AND token_hash = ?')
      .get(existing.id, tokenHash);
    if (!tokenRow) return res.status(409).json({ error: 'name_taken' });
    db.prepare('UPDATE profiles SET last_seen_at = ? WHERE id = ?')
      .run(now, existing.id);
    return res.status(200).json({ ok: true, id: existing.id, name, claimed: true });
  }

  const info = db
    .prepare(
      `INSERT INTO profiles (name, name_lower, created_at, last_seen_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(name, nameLower, now, now);
  db.prepare(
    `INSERT INTO tokens (profile_id, token_hash, created_at) VALUES (?, ?, ?)`
  ).run(info.lastInsertRowid, tokenHash, now);
  return res.status(201).json({ ok: true, id: info.lastInsertRowid, name, claimed: true });
});

app.get('/profiles/me', requireProfile, (req, res) => {
  // discordLinked drives the account-menu "Connect to Discord" button:
  // shown to a signed-in user only until their account has a Discord
  // identity, then hidden. oauthEnabled lets the client skip the button
  // entirely on a deployment with no Discord OAuth.
  const discordLinked = !!db
    .prepare('SELECT 1 FROM discord_accounts WHERE profile_id = ?')
    .get(req.profile.id);
  res.json({
    id: req.profile.id,
    name: req.profile.name,
    discordLinked,
    oauthEnabled: oauthEnabled(),
  });
});

// Add-a-device flow. The caller (already authenticated on this device)
// mints a new short code; the server adds it to the tokens table; the
// caller pastes the new code into "Claim now" on a second device.
app.post('/tokens', requireProfile, (req, res) => {
  const token = generateShortCode();
  db.prepare(
    'INSERT INTO tokens (profile_id, token_hash, created_at) VALUES (?, ?, ?)'
  ).run(req.profile.id, hashToken(token), nowMs());
  res.status(201).json({ ok: true, token });
});

// Search profiles by name prefix. Powers the "Invite @name" autocomplete.
// Public (no auth) so the invite dialog can render before the user
// commits to inviting. Hides banned profiles. Hard cap of 20 rows.
app.get('/profiles/search', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 1) return res.json({ entries: [] });
  if (q.length > 20) return res.status(400).json({ error: 'query_too_long' });
  const rows = db
    .prepare(
      `SELECT id, name, last_seen_at AS lastSeenAt
       FROM profiles
       WHERE name_lower LIKE ? AND banned_at IS NULL
       ORDER BY last_seen_at DESC
       LIMIT 20`
    )
    .all(q.replace(/[%_]/g, '\\$&') + '%');
  res.json({ entries: rows });
});

// ----- Lobby routes -----

function lobbyRow(lobbyId) {
  const row = db
    .prepare(
      `SELECT l.*, p.name AS host_name
       FROM lobbies l
       JOIN profiles p ON p.id = l.host_id
       WHERE l.id = ?`
    )
    .get(lobbyId);
  if (!row) return null;
  const members = db
    .prepare(
      `SELECT lm.profile_id AS id, p.name, lm.ready, lm.seat, lm.joined_at
       FROM lobby_members lm
       JOIN profiles p ON p.id = lm.profile_id
       WHERE lm.lobby_id = ?
       ORDER BY lm.joined_at ASC`
    )
    .all(lobbyId);
  // The most recent active game for this lobby, if started. Clients
  // mount the game surface off this id once status flips to 'started'.
  const game = db
    .prepare(
      `SELECT id FROM games
       WHERE lobby_id = ? AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(lobbyId);
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    hostId: row.host_id,
    hostName: row.host_name,
    maxPlayers: row.max_players,
    maxRounds: row.max_rounds,
    joinPolicy: row.join_policy,
    status: row.status,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    gameId: game ? game.id : null,
    members,
  };
}

function publishLobby(lobbyId) {
  const lobby = lobbyRow(lobbyId);
  if (!lobby) return;
  broadcast(`lobby:${lobbyId}`, { type: 'lobby_update', lobby });
}

// Cancel pending direct-invites for a lobby and notify each invitee
// so their notifications UI refreshes immediately. Used when the
// lobby transitions out of 'waiting' (started / disbanded / cancelled)
// or when a player joins through any path (their own invite to that
// lobby becomes moot). `exceptProfileId` skips the cancel for one
// profile - useful when the join is being recorded for someone whose
// invite is being accepted separately (so we don't race on the same
// row). Returns the list of notified profile ids.
function cancelLobbyInvites(lobbyId, exceptProfileId) {
  const rows = db
    .prepare(
      `SELECT to_id FROM direct_invites
       WHERE lobby_id = ? AND status = 'pending'
       ${exceptProfileId != null ? 'AND to_id != ?' : ''}`
    )
    .all(...(exceptProfileId != null ? [lobbyId, exceptProfileId] : [lobbyId]));
  if (!rows.length) return [];
  db.prepare(
    `UPDATE direct_invites
     SET status = 'cancelled', responded_at = ?
     WHERE lobby_id = ? AND status = 'pending'
     ${exceptProfileId != null ? 'AND to_id != ?' : ''}`
  ).run(...(exceptProfileId != null
    ? [nowMs(), lobbyId, exceptProfileId]
    : [nowMs(), lobbyId]));
  for (const r of rows) {
    broadcast(`me:${r.to_id}`, { type: 'invite_cancelled', lobbyId });
  }
  return rows.map((r) => r.to_id);
}

// Cancel one specific direct-invite (the joiner's invite to this
// lobby, regardless of source). Idempotent; quietly does nothing if
// no pending row exists.
function cancelInviteFor(profileId, lobbyId) {
  const info = db
    .prepare(
      `UPDATE direct_invites
       SET status = 'cancelled', responded_at = ?
       WHERE lobby_id = ? AND to_id = ? AND status = 'pending'`
    )
    .run(nowMs(), lobbyId, profileId);
  if (info.changes > 0) {
    broadcast(`me:${profileId}`, { type: 'invite_cancelled', lobbyId });
  }
}

// Create a new lobby. Caller becomes the host AND the first member.
// `code` is a 6-char short code so the host can read it over voice.
app.post('/lobbies', requireProfile, (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim().slice(0, 60) || `${req.profile.name}'s table`;
  const maxPlayers = Math.max(2, Math.min(5, Number(body.maxPlayers) || 5));
  // Game length: 5 (short, default) / 6 (medium) / 7 (extra long).
  const maxRounds = [5, 6, 7].includes(Number(body.maxRounds)) ? Number(body.maxRounds) : 5;
  const joinPolicy = body.joinPolicy === 'invite-only' ? 'invite-only' : 'open';
  const now = nowMs();
  let code, info;
  for (let attempt = 0; attempt < 5; attempt++) {
    code = generateShortCode(6);
    try {
      info = db
        .prepare(
          `INSERT INTO lobbies (code, name, host_id, max_players, max_rounds, join_policy, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?)`
        )
        .run(code, name, req.profile.id, maxPlayers, maxRounds, joinPolicy, now);
      break;
    } catch (err) {
      if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') continue;
      throw err;
    }
  }
  if (!info) return res.status(500).json({ error: 'code_collision' });
  db.prepare(
    `INSERT INTO lobby_members (lobby_id, profile_id, joined_at, seat)
     VALUES (?, ?, ?, 1)`
  ).run(info.lastInsertRowid, req.profile.id, now);
  const lobby = lobbyRow(info.lastInsertRowid);
  res.status(201).json({ ok: true, lobby });
});

// List open lobbies that are still waiting for players. Invite-only
// lobbies are hidden from this list (they're discovered via direct
// invite or via invite link).
app.get('/lobbies', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT l.id, l.code, l.name,
              l.max_players AS maxPlayers,
              l.status,
              l.created_at  AS createdAt,
              p.name        AS hostName,
              (SELECT COUNT(*) FROM lobby_members lm WHERE lm.lobby_id = l.id) AS memberCount
       FROM lobbies l
       JOIN profiles p ON p.id = l.host_id
       WHERE l.join_policy = 'open' AND l.status = 'waiting'
       ORDER BY l.created_at DESC
       LIMIT 50`
    )
    .all();
  res.json({ entries: rows });
});

// Lobbies the caller is a member of, across every status, with the
// game's id + status attached. Powers the "your games" (in progress)
// and "ended games" sections; GET /lobbies only lists joinable waiting
// tables. Registered BEFORE /lobbies/:id so "mine" isn't read as an id.
app.get('/lobbies/mine', requireProfile, (req, res) => {
  const rows = db
    .prepare(
      `SELECT l.id, l.code, l.name, l.status,
              l.max_players AS maxPlayers,
              l.created_at  AS createdAt,
              p.name        AS hostName,
              (SELECT COUNT(*) FROM lobby_members lm2 WHERE lm2.lobby_id = l.id) AS memberCount,
              g.id     AS gameId,
              g.status AS gameStatus
       FROM lobbies l
       JOIN lobby_members lm ON lm.lobby_id = l.id AND lm.profile_id = ?
       JOIN profiles p ON p.id = l.host_id
       LEFT JOIN games g ON g.lobby_id = l.id
       ORDER BY l.created_at DESC
       LIMIT 50`
    )
    .all(req.profile.id);
  // Decorate each in-progress game with whose turn it is, the round
  // progress, and when the last turn ended, so the dashboard can show
  // it without opening the board. Capped list (50), so the per-row
  // lookups are fine.
  const lastTurnStmt = db.prepare(
    "SELECT MAX(created_at) AS t FROM game_operations WHERE game_id = ? AND kind IN ('END_TURN', 'SET_FIRST_PLAYER')"
  );
  const stateStmt = db.prepare('SELECT state FROM game_states WHERE game_id = ?');
  for (const row of rows) {
    if (!row.gameId || row.gameStatus !== 'active') continue;
    try {
      const st = stateStmt.get(row.gameId);
      if (st) {
        const state = JSON.parse(st.state);
        const players = Array.isArray(state.players) ? state.players : [];
        const active = players[state.activeIndex];
        if (active) {
          row.activePlayerName = active.name;
          row.activePlayerColor = active.color || null;
          row.yourTurn = active.profileId === req.profile.id;
        }
        if (state.pendingFirstPlayer) {
          const chooser = players.find((pl) => pl.profileId === state.pendingFirstPlayer.chooserId);
          row.pendingFirstPlayerName = chooser ? chooser.name : null;
        }
        row.round = state.round;
        row.maxRounds = state.maxRounds;
      }
    } catch { /* ignore a malformed state blob */ }
    const last = lastTurnStmt.get(row.gameId);
    row.lastTurnEndedAt = (last && last.t) || null;
  }
  res.json({ entries: rows });
});

// Lobby detail. Members + full lobby record. Visible to anyone (so
// the invite-link landing page can render the lobby name before the
// user claims the invite), but starting / chatting / joining requires
// the relevant gate elsewhere.
app.get('/lobbies/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
  const lobby = lobbyRow(id);
  if (!lobby) return res.status(404).json({ error: 'not_found' });
  res.json({ lobby });
});

// Join an open lobby. Invite-only lobbies reject this with 403; the
// player must claim a direct invite or invite link instead.
app.post('/lobbies/:id/join', requireProfile, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
  const result = joinLobby(id, req.profile.id, { acceptedInvite: false });
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  publishLobby(id);
  res.json({ ok: true, lobby: lobbyRow(id) });
});

// Shared join routine, used by /join, by invite-link claim, and by
// direct-invite accept. acceptedInvite=true bypasses the join_policy
// gate (the invite IS the gate).
function joinLobby(lobbyId, profileId, { acceptedInvite }) {
  const lobby = db
    .prepare('SELECT id, join_policy, status, max_players FROM lobbies WHERE id = ?')
    .get(lobbyId);
  if (!lobby) return { error: 'not_found', status: 404 };
  if (lobby.status !== 'waiting') return { error: 'already_started', status: 409 };
  if (!acceptedInvite && lobby.join_policy === 'invite-only') {
    return { error: 'invite_required', status: 403 };
  }
  const existing = db
    .prepare('SELECT id FROM lobby_members WHERE lobby_id = ? AND profile_id = ?')
    .get(lobbyId, profileId);
  if (existing) return { ok: true, alreadyMember: true };
  const count = db
    .prepare('SELECT COUNT(*) AS n FROM lobby_members WHERE lobby_id = ?')
    .get(lobbyId).n;
  if (count >= lobby.max_players) return { error: 'lobby_full', status: 409 };
  db.prepare(
    `INSERT INTO lobby_members (lobby_id, profile_id, joined_at, seat)
     VALUES (?, ?, ?, ?)`
  ).run(lobbyId, profileId, nowMs(), count + 1);
  // Any pending invite this player had for this lobby is now moot -
  // they're in. Direct-invite ACCEPT runs its own UPDATE to 'accepted'
  // before getting here, so this cancel is a no-op in that path; for
  // every other join path (open join, invite-link claim) it cleans up
  // a stranded pending invite that would otherwise dangle.
  cancelInviteFor(profileId, lobbyId);
  return { ok: true, alreadyMember: false };
}

app.post('/lobbies/:id/leave', requireProfile, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
  const lobby = db.prepare('SELECT id, host_id, status FROM lobbies WHERE id = ?').get(id);
  if (!lobby) return res.status(404).json({ error: 'not_found' });
  db.prepare('DELETE FROM lobby_members WHERE lobby_id = ? AND profile_id = ?')
    .run(id, req.profile.id);
  // If the host leaves while waiting, disband the lobby (and rely on
  // ON DELETE CASCADE to clean up members, chat, and invites). Once a
  // game has started, leaving is just "go AFK" - host can't disband.
  if (lobby.host_id === req.profile.id && lobby.status === 'waiting') {
    // Broadcast invite_cancelled to each pending invitee BEFORE the
    // cascade fires so their notifications chip clears without a stale
    // row. The cascade will then physically remove the rows.
    cancelLobbyInvites(id);
    db.prepare('DELETE FROM lobbies WHERE id = ?').run(id);
    broadcast(`lobby:${id}`, { type: 'lobby_disbanded', lobbyId: id });
  } else {
    publishLobby(id);
  }
  res.json({ ok: true });
});

// Host-only. Remove another player from the lobby while it's still
// waiting. The kick deletes the target's membership row and re-
// publishes the lobby, so every client (including the kicked player,
// who is still in the lobby:<id> channel set) sees them drop off the
// roster; the kicked player's client detects its own absence and
// bounces to the lobby list. We also ping the kicked player's personal
// me:<id> channel for an immediate notice (best-effort - the roster /
// poll detection is the reliable path). Kicking is disabled once the
// game has started, mirroring the "leave is just go-AFK" rule.
app.post('/lobbies/:id/kick', requireProfile, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
  const targetId = Number(req.body && req.body.targetProfileId);
  if (!Number.isFinite(targetId)) return res.status(400).json({ error: 'bad_target' });
  const lobby = db.prepare('SELECT id, host_id, status FROM lobbies WHERE id = ?').get(id);
  if (!lobby) return res.status(404).json({ error: 'not_found' });
  if (lobby.host_id !== req.profile.id) return res.status(403).json({ error: 'not_host' });
  if (lobby.status !== 'waiting') return res.status(409).json({ error: 'already_started' });
  if (targetId === lobby.host_id) return res.status(400).json({ error: 'cant_kick_host' });
  const member = db
    .prepare('SELECT 1 FROM lobby_members WHERE lobby_id = ? AND profile_id = ?')
    .get(id, targetId);
  if (!member) return res.status(404).json({ error: 'not_a_member' });
  db.prepare('DELETE FROM lobby_members WHERE lobby_id = ? AND profile_id = ?')
    .run(id, targetId);
  publishLobby(id);
  publishToProfile(targetId, { type: 'lobby_kicked', lobbyId: id });
  res.json({ ok: true, lobby: lobbyRow(id) });
});

app.post('/lobbies/:id/ready', requireProfile, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
  const ready = req.body && req.body.ready ? 1 : 0;
  const info = db
    .prepare('UPDATE lobby_members SET ready = ? WHERE lobby_id = ? AND profile_id = ?')
    .run(ready, id, req.profile.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_a_member' });
  publishLobby(id);
  res.json({ ok: true });
});

// Host-only. Flips the lobby to 'started' AND spins up a server-
// authoritative game: pins an RNG seed, freezes the seat roster, and
// writes the initial engine state. Everything happens in one
// transaction so a lobby never ends up 'started' without a game (or
// vice versa).
app.post('/lobbies/:id/start', requireProfile, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
  const lobby = db.prepare('SELECT host_id, status, max_rounds FROM lobbies WHERE id = ?').get(id);
  if (!lobby) return res.status(404).json({ error: 'not_found' });
  if (lobby.host_id !== req.profile.id) return res.status(403).json({ error: 'not_host' });
  if (lobby.status !== 'waiting') return res.status(409).json({ error: 'already_started' });

  const members = db
    .prepare(
      `SELECT lm.profile_id AS profileId, p.name, lm.seat, lm.joined_at
       FROM lobby_members lm
       JOIN profiles p ON p.id = lm.profile_id
       WHERE lm.lobby_id = ?
       ORDER BY lm.seat ASC, lm.joined_at ASC`
    )
    .all(id);
  if (!members.length) return res.status(409).json({ error: 'no_players' });

  const seed = randomSeed();
  const players = members.map((m, i) => ({
    profileId: m.profileId,
    name: m.name,
    seat: m.seat || i + 1,
  }));
  // Lobbies predating the column come back null; default to 5.
  const maxRounds = [5, 6, 7].includes(lobby.max_rounds) ? lobby.max_rounds : 5;
  const state = createInitialState({ players, seed, maxRounds });

  const now = nowMs();
  const gameId = db.transaction(() => {
    db.prepare("UPDATE lobbies SET status = 'started', started_at = ? WHERE id = ?")
      .run(now, id);
    const info = db
      .prepare(
        `INSERT INTO games (lobby_id, seed, status, created_at)
         VALUES (?, ?, 'active', ?)`
      )
      .run(id, seed, now);
    const gid = info.lastInsertRowid;
    const insPlayer = db.prepare(
      `INSERT INTO game_players (game_id, profile_id, seat, color)
       VALUES (?, ?, ?, ?)`
    );
    for (const p of state.players) {
      insPlayer.run(gid, p.profileId, p.seat, p.color);
    }
    const stateJson = JSON.stringify(state);
    db.prepare(
      `INSERT INTO game_states (game_id, state, seq, updated_at)
       VALUES (?, ?, 0, ?)`
    ).run(gid, stateJson, now);
    // Seq-0 START op carries the initial snapshot so "state at seq K"
    // is uniform for every K (including the game's opening board, which
    // is the first turn's undo floor / committed_seq = 0).
    db.prepare(
      `INSERT INTO game_operations (game_id, seq, profile_id, kind, payload, log, state_after, created_at)
       VALUES (?, 0, ?, 'START', NULL, ?, ?, ?)`
    ).run(gid, req.profile.id, 'Game started.', stateJson, now);
    return gid;
  })();

  // Once a lobby starts, every pending invite for it is moot - the
  // joinLobby gate refuses 'started' lobbies anyway. Mark them
  // 'cancelled' and broadcast invite_cancelled so each invitee's
  // notification chip clears in real time.
  cancelLobbyInvites(id);
  publishLobby(id);
  // Out-of-band "the game started, pick your crew" DM to every seat
  // (opt-in, inert without a bot). The game opens in the crew-draft
  // phase, so the first thing each player owes the table is a faction
  // pick - notify them the same way a turn handoff does.
  try {
    const nm = gameDisplayName(gameId);
    const url = gameRoomUrl(gameId);
    const jump = url ? `\n▶ Play now: ${url}` : '';
    if (discordEnabled()) {
      for (const p of state.players) {
        notifyProfile(p.profileId, 'turn', `🧑‍🚀 ${nm} is starting - pick your crew.${jump}`);
      }
    }
    notifyWebhook(`🧑‍🚀 **${nm}** has started - crew draft is open.${jump}`);
  } catch (e) {
    console.warn('[notify] crew-draft dispatch error', e && e.message);
  }
  res.json({ ok: true, gameId });
});

// ----- Game (Stage 3 server-authoritative engine) -----

// Frozen roster + colours for a game.
function gamePlayers(gameId) {
  return db
    .prepare(
      `SELECT gp.profile_id AS profileId, gp.seat, gp.color, p.name
       FROM game_players gp
       JOIN profiles p ON p.id = gp.profile_id
       WHERE gp.game_id = ?
       ORDER BY gp.seat ASC`
    )
    .all(gameId);
}

function isGamePlayer(gameId, profileId) {
  return !!db
    .prepare('SELECT 1 FROM game_players WHERE game_id = ? AND profile_id = ?')
    .get(gameId, profileId);
}

// Spectator access: any signed-in profile can read a game whose
// underlying lobby is open (join_policy = 'open') AND whose game is
// 'active'. Mirrors the "public game" affordance the user asked for -
// view-only hop-in for in-progress public games. Players keep access
// for any join_policy, any game.status.
function canViewGame(gameId, profileId) {
  if (isGamePlayer(gameId, profileId)) return true;
  const row = db
    .prepare(
      `SELECT l.join_policy AS joinPolicy, g.status AS gameStatus
       FROM games g
       JOIN lobbies l ON l.id = g.lobby_id
       WHERE g.id = ?`
    )
    .get(gameId);
  if (!row) return false;
  return row.joinPolicy === 'open' && row.gameStatus === 'active';
}

// Full game view: meta + roster + current state snapshot. State is sent
// whole today (open information; hidden hands aren't populated until
// the BUILD op lands, at which point this redacts per-player).
// HF4 is OPEN-information for stacks (hands, LEO, rocket, outposts -
// all visible to every player). The ONE exception is the PLANNED
// ROUTE: a player's planned path is private (user 2026-05-29: "rocket
// path is secret between players ... each player can only see their
// own rocket path"). gameView strips opponents' rocket.route for
// each viewer. Spectators (viewerId null) see no routes.
function redactRoutes(rawState, viewerId) {
  if (!rawState || !Array.isArray(rawState.players)) return rawState;
  const clone = JSON.parse(JSON.stringify(rawState));
  for (const p of clone.players) {
    if (p.profileId === viewerId) continue;          // your own route stays
    if (p.rocket) p.rocket.route = [];               // opponents: hidden
  }
  return clone;
}

function gameView(gameId, viewerId = null) {
  const g = db
    .prepare('SELECT id, lobby_id, status, seed, committed_seq, created_at, finished_at FROM games WHERE id = ?')
    .get(gameId);
  if (!g) return null;
  const st = db.prepare('SELECT state, seq, updated_at FROM game_states WHERE game_id = ?').get(gameId);
  const rawState = st ? JSON.parse(st.state) : null;
  const viewState = redactRoutes(rawState, viewerId);
  // View-only: stitch the manual-nudge cooldown timestamps onto the
  // snapshot the client renders. These are NOT part of the persisted
  // game state (a nudge mutates no board state); the client reads
  // state.reminders to show the "reminded Xh ago" timer + cooldown.
  if (viewState) viewState.reminders = gameReminders(gameId);
  return {
    id: g.id,
    lobbyId: g.lobby_id,
    status: g.status,
    seq: st ? st.seq : 0,
    committedSeq: g.committed_seq,
    updatedAt: st ? st.updated_at : g.created_at,
    players: gamePlayers(gameId),
    state: viewState,
  };
}

// ----- out-of-band turn notifications (opt-in Discord DM) -----

// A game's display name (its lobby's name) for notification text.
function gameDisplayName(gameId) {
  const r = db
    .prepare('SELECT l.name FROM games g JOIN lobbies l ON l.id = g.lobby_id WHERE g.id = ?')
    .get(gameId);
  return (r && r.name) || 'your High Frontier game';
}

// Public base URL of the static frontend, used to build "jump into the
// room" deep links in notifications. Overridable via env for non-canonical
// deploys; defaults to the GitHub Pages site. Room URLs are
// `<base>/room/<code>` with the code lowercased (the form the SPA + the
// case-insensitive server route both resolve).
const PUBLIC_APP_URL = (process.env.PUBLIC_APP_URL
  || 'https://rubentipparach.github.io/high-frontier-fan-game').replace(/\/+$/, '');

function gameRoomUrl(gameId) {
  const r = db
    .prepare('SELECT l.code FROM games g JOIN lobbies l ON l.id = g.lobby_id WHERE g.id = ?')
    .get(gameId);
  const code = r && r.code;
  return code ? `${PUBLIC_APP_URL}/room/${String(code).toLowerCase()}` : '';
}

// DM one player IF they've opted into this event kind and Discord is on.
// Fire-and-forget: a send failure is logged, never blocks the op response.
function notifyProfile(profileId, kind, text) {
  if (!discordEnabled()) return;
  const pref = db
    .prepare('SELECT discord_user_id, notify_turn, notify_auction FROM notify_prefs WHERE profile_id = ?')
    .get(profileId);
  if (!pref || !pref.discord_user_id) return;
  if (kind === 'turn' && !pref.notify_turn) return;
  if (kind === 'auction' && !pref.notify_auction) return;
  sendDM(pref.discord_user_id, text).then((r) => {
    if (!r.ok && r.error !== 'discord_disabled') {
      console.warn('[notify] DM failed for profile', profileId, '-', r.error);
    }
  });
}

// The server-wide Discord channel webhook URL: the admin-saved value
// (server_settings) wins, else the DISCORD_WEBHOOK_URL env default.
// Empty string when neither is set.
function storedWebhookUrl() {
  const row = db
    .prepare("SELECT value FROM server_settings WHERE key = 'discord_webhook_url'")
    .get();
  const saved = (row && row.value) || '';
  return isWebhookUrl(saved) ? saved : defaultWebhookUrl();
}

// Post a game event to the channel webhook IF one is configured.
// Fire-and-forget, like notifyProfile. Server-wide (one channel for the
// whole deployment), so it's not gated on per-player opt-in.
function notifyWebhook(text) {
  const url = storedWebhookUrl();
  if (!webhookEnabled(url)) return;
  sendWebhook(text, url).then((r) => {
    if (!r.ok && r.error !== 'webhook_disabled') {
      console.warn('[notify] webhook failed -', r.error);
    }
  });
}

// The single player a manual "nudge" should remind: whoever the game is
// currently waiting on. First-player handoff -> the chooser; an auction
// in its decide phase -> the auctioneer; otherwise the active player
// whose turn it is. (During an open bidder round the auto-notifications
// already cover the bidders, so the nudge falls back to the active seat.)
function whoNeedsToAct(state) {
  if (!state || !Array.isArray(state.players)) return null;
  // During the crew draft any seat may pick (no single "turn"), so a
  // nudge has no well-defined target - the start DM already covers it.
  const draftDone = state.draftPhase === 'play'
    || (state.draftPhase == null && state.players.every((p) => !!p.faction));
  if (!draftDone) return null;
  if (state.pendingFirstPlayer) return state.pendingFirstPlayer.chooserId;
  if (state.auction && state.auction.awaiting === 'auctioneer') return state.auction.auctioneerId;
  const active = state.players[state.activeIndex];
  return active ? active.profileId : null;
}

// Most-recent nudge per target for a game, so the client can render the
// "reminded Xh ago" timer and grey out the button during the cooldown.
function gameReminders(gameId) {
  const rows = db
    .prepare('SELECT target_id AS targetId, sender_id AS senderId, sent_at AS sentAt FROM turn_reminders WHERE game_id = ?')
    .all(gameId);
  const out = {};
  for (const r of rows) out[r.targetId] = { sentAt: r.sentAt, senderId: r.senderId };
  return out;
}

// Manual turn-nudge throttle: at most one reminder per target per game
// inside this window.
const REMIND_COOLDOWN_MS = 3 * 60 * 60 * 1000; // 3 hours

// After an op commits: DM the newly-active player on END_TURN, and the
// other players when an auction opens. (One event => one DM each, so the
// natural cadence is the throttle.) A configured channel webhook also
// gets a one-line post per event so a play group can watch a channel
// instead of relying on per-player DMs.
function dispatchTurnNotifications(gameId, kind, state) {
  try {
    if (!state || !Array.isArray(state.players)) return;
    const dmOn = discordEnabled();
    const name = gameDisplayName(gameId);
    const url = gameRoomUrl(gameId);
    // A trailing deep link so a notified player can tap straight into the
    // room. Discord renders bare URLs as clickable links in both DMs and
    // channel posts. Empty (no code) just omits the line.
    const jump = url ? `\n▶ Play now: ${url}` : '';
    // Game over: one note to everyone, regardless of which op tripped it.
    if (state.status === 'finished') {
      if (dmOn) for (const p of state.players) notifyProfile(p.profileId, 'turn', `🏁 The game in ${name} is over.`);
      notifyWebhook(`🏁 **${name}** has ended - final standings are in.`);
      return;
    }
    // A round just closed and the leader must name the next first player.
    if (state.pendingFirstPlayer) {
      const chooser = state.players.find((p) => p.profileId === state.pendingFirstPlayer.chooserId);
      if (chooser) {
        if (dmOn) notifyProfile(chooser.profileId, 'turn', `⭐ Pick the next first player in ${name}.${jump}`);
        notifyWebhook(`⭐ ${chooser.name || 'A player'} is choosing the next first player in **${name}**.${jump}`);
      }
      return;
    }
    // END_TURN and SET_FIRST_PLAYER both hand the turn to a new player.
    if (kind === 'END_TURN' || kind === 'SET_FIRST_PLAYER') {
      const active = state.players[state.activeIndex];
      if (active) {
        if (dmOn) notifyProfile(active.profileId, 'turn', `🛸 It's your turn in ${name}.${jump}`);
        notifyWebhook(`🛸 ${active.name || 'A player'}'s turn in **${name}**.${jump}`);
      }
    } else if (kind === 'AUCTION_START') {
      const auctioneer = state.auction && state.auction.auctioneerId;
      if (dmOn) {
        for (const p of state.players) {
          if (p.profileId === auctioneer) continue;
          notifyProfile(p.profileId, 'auction', `🔨 An auction just opened in ${name} - place your bid.${jump}`);
        }
      }
      notifyWebhook(`🔨 An auction just opened in **${name}** - bidding is live.${jump}`);
    } else if (kind === 'AUCTION_BID' || kind === 'AUCTION_PASS' || kind === 'AUCTION_JOIN') {
      // The auction round just came back to someone (user: "whenever the
      // auction round comes to you - both the auctioneer and the
      // bidders"). The post-op auction state tells us who is on the clock.
      const a = state.auction;
      if (a && a.awaiting === 'auctioneer') {
        // Settled to the auctioneer's decide phase (sell to the high
        // bidder or keep the lot).
        const auctioneer = state.players.find((p) => p.profileId === a.auctioneerId);
        if (auctioneer) {
          if (dmOn) notifyProfile(auctioneer.profileId, 'auction', `🔨 The auction in ${name} is back to you - sell to the high bidder or keep the lot.${jump}`);
          notifyWebhook(`🔨 ${auctioneer.name || 'The auctioneer'} must decide the lot in **${name}**.${jump}`);
        }
      } else if (a && a.awaiting === 'bidders' && (kind === 'AUCTION_BID' || kind === 'AUCTION_JOIN')) {
        // A fresh high bid (or the auctioneer joining) reopens the floor
        // and resets the pass list - ping everyone who can still raise.
        // A PASS never reopens a round, so it does not re-notify the
        // bidders already on the clock from this same round.
        if (dmOn) {
          for (const p of state.players) {
            if (p.profileId === a.auctioneerId || p.profileId === a.highBidderId) continue;
            if (Array.isArray(a.passed) && a.passed.includes(p.profileId)) continue;
            notifyProfile(p.profileId, 'auction', `🔨 The auction round in ${name} is back to you - bid or pass.${jump}`);
          }
        }
        notifyWebhook(`🔨 A new bidding round opened in **${name}**.${jump}`);
      }
    }
  } catch (e) {
    console.warn('[notify] dispatch error', e && e.message);
  }
}

// Read the caller's notification prefs (+ whether the server even has a
// bot configured, so the UI can show "notifications unavailable").
app.get('/me/notify', requireProfile, (req, res) => {
  const pref = db
    .prepare('SELECT discord_user_id, notify_turn, notify_auction FROM notify_prefs WHERE profile_id = ?')
    .get(req.profile.id);
  res.json({
    discordEnabled: discordEnabled(),
    // When true, the client shows the one-click "Connect Discord" button
    // (OAuth identify + guilds.join) instead of the manual user-id field.
    oauthEnabled: oauthEnabled(),
    discordUserId: (pref && pref.discord_user_id) || '',
    notifyTurn: pref ? !!pref.notify_turn : true,
    notifyAuction: pref ? !!pref.notify_auction : true,
  });
});

// Save the caller's notification prefs. An empty discordUserId clears it.
app.put('/me/notify', requireProfile, (req, res) => {
  const b = req.body || {};
  const discordUserId = String(b.discordUserId || '').trim();
  if (discordUserId && !/^\d{5,25}$/.test(discordUserId)) {
    return res.status(400).json({ error: 'bad_discord_id' });
  }
  db.prepare(
    `INSERT INTO notify_prefs (profile_id, discord_user_id, notify_turn, notify_auction, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(profile_id) DO UPDATE SET
       discord_user_id = excluded.discord_user_id,
       notify_turn     = excluded.notify_turn,
       notify_auction  = excluded.notify_auction,
       updated_at      = excluded.updated_at`
  ).run(req.profile.id, discordUserId || null, b.notifyTurn ? 1 : 0, b.notifyAuction ? 1 : 0, nowMs());
  res.json({ ok: true });
});

// Send a test DM (to the supplied id, or the saved one) so a player can
// confirm the bot can reach them before relying on it.
app.post('/me/notify/test', requireProfile, async (req, res) => {
  if (!discordEnabled()) return res.status(503).json({ error: 'discord_disabled' });
  let uid = String((req.body && req.body.discordUserId) || '').trim();
  if (!uid) {
    const pref = db
      .prepare('SELECT discord_user_id FROM notify_prefs WHERE profile_id = ?')
      .get(req.profile.id);
    uid = (pref && pref.discord_user_id) || '';
  }
  if (!/^\d{5,25}$/.test(uid)) return res.status(400).json({ error: 'bad_discord_id' });
  // Append a deep link: the specific room when the caller is testing from
  // inside a game (in-game button passes gameId), else the app home so a
  // menu test still carries a clickable URL.
  const gid = req.body && req.body.gameId;
  const url = (gid && gameRoomUrl(gid)) || PUBLIC_APP_URL;
  const jump = url ? `\n▶ Play now: ${url}` : '';
  const r = await sendDM(uid, `✅ High Frontier test DM - notifications are working for @${req.profile.name}.${jump}`);
  if (!r.ok) return res.status(502).json({ error: r.error });
  res.json({ ok: true });
});

// ----- OAuth2 "Connect Discord" flow -----
//
// One-click linking: the client (Bearer-authed) asks for an authorize
// URL, opens it in a popup, the user approves on Discord, and Discord
// redirects back to /auth/discord/callback. The callback reads the
// user's id (identify) AND adds them to the bot's guild (guilds.join)
// so the bot can DM them - no copy-paste, no manual server join.
//
// `state` is a one-time CSRF token mapped to the requesting profile,
// held in memory with a short TTL (the whole flow takes seconds; a
// process restart mid-flow just means the user clicks again).

// State is persisted in SQLite (oauth_states), NOT in process memory:
// on Fly the machine can auto-stop while the user is on Discord's consent
// screen, so an in-memory token would be gone by the time the callback
// cold-starts a fresh process - which presented as "Link expired" on
// every attempt. The DB lives on the volume and survives restarts.
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function pruneOauthStates() {
  db.prepare('DELETE FROM oauth_states WHERE expires_at <= ?').run(Date.now());
}

// The redirect URI must be byte-identical in the authorize request, the
// token exchange, AND the Developer Portal's Redirects list. Derive it
// from an explicit env when set (most robust behind proxies), else from
// the request host (trust proxy is on, so x-forwarded-proto is honored).
function oauthRedirectUri(req) {
  if (process.env.DISCORD_REDIRECT_URI) return process.env.DISCORD_REDIRECT_URI;
  return `${req.protocol}://${req.get('host')}/auth/discord/callback`;
}

// Begin linking: returns the Discord authorize URL for the client to open.
app.post('/me/notify/oauth/start', requireProfile, (req, res) => {
  if (!oauthEnabled()) return res.status(503).json({ error: 'oauth_disabled' });
  pruneOauthStates();
  const state = generateShortCode(16);
  db.prepare('INSERT INTO oauth_states (state, profile_id, expires_at) VALUES (?, ?, ?)')
    .run(state, req.profile.id, Date.now() + OAUTH_STATE_TTL_MS);
  res.json({ ok: true, url: buildAuthorizeUrl(state, oauthRedirectUri(req)) });
});

// Discord redirects here after the user approves. Validates state,
// completes the exchange + guild join, saves the discord_user_id to the
// initiating profile, and renders a tiny self-closing success page.
app.get('/auth/discord/callback', async (req, res) => {
  const sendPage = (title, body, ok) => {
    res.set('content-type', 'text/html; charset=utf-8');
    res.send(`<!doctype html><html><head><meta charset="utf-8">
<title>${esc(title)}</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:15px ui-sans-serif,system-ui,sans-serif;background:#07060f;color:#e6e9ff;
display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center;text-align:center;padding:24px}
.box{max-width:420px}h1{font-size:18px;color:${ok ? '#4ade80' : '#f87171'};margin:0 0 10px}
p{color:#8b90b8;line-height:1.5}</style></head><body><div class="box">
<h1>${esc(title)}</h1><p>${body}</p></div>
<script>try{setTimeout(function(){window.close();},2500);}catch(e){}</script>
</body></html>`);
  };
  // Bounce the browser back to the app with a result param (used by the
  // unauthenticated "Sign in with Discord" full-page flow).
  const appRedirect = (params) =>
    res.redirect(`${PUBLIC_APP_URL}/?${new URLSearchParams(params).toString()}`);

  pruneOauthStates();
  pruneDiscordAuth();
  const errParam = String(req.query.error || '');
  const state = String(req.query.state || '');
  const code = String(req.query.code || '');

  // The mode is determined by which state table holds the state: the
  // authenticated "Connect" flow stores it in oauth_states (popup, has a
  // profile); the unauthenticated "Sign in" flow stores it in
  // discord_login_states (full-page, no profile yet). Consume either.
  const linkEntry = state
    ? db.prepare('SELECT profile_id, expires_at FROM oauth_states WHERE state = ?').get(state)
    : null;
  if (linkEntry) db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);
  const loginEntry = (!linkEntry && state)
    ? db.prepare('SELECT expires_at FROM discord_login_states WHERE state = ?').get(state)
    : null;
  if (loginEntry) db.prepare('DELETE FROM discord_login_states WHERE state = ?').run(state);
  // Admin sign-in stores its state in admin_login_states (no profile;
  // gated on the Discord allowlist, not a game account).
  const adminEntry = (!linkEntry && !loginEntry && state)
    ? db.prepare('SELECT expires_at FROM admin_login_states WHERE state = ?').get(state)
    : null;
  if (adminEntry) db.prepare('DELETE FROM admin_login_states WHERE state = ?').run(state);

  // ---------- Admin sign-in (identify-only, Discord allowlist) ----------
  if (adminEntry) {
    if (errParam) return sendPage('Login cancelled', 'You can close this window and try again.', false);
    if (adminEntry.expires_at <= Date.now()) return sendPage('Login expired', 'That sign-in link expired. Reopen /admin and try again.', false);
    if (!code) return sendPage('Missing code', 'Discord did not return an authorization code. Please try again.', false);
    const a = await identifyOauth(code, oauthRedirectUri(req));
    if (!a.ok) {
      console.warn('[admin] oauth login failed -', a.error);
      return sendPage('Login failed', `Discord login failed (${esc(a.error)}). You can close this and try again.`, false);
    }
    if (!isAdminDiscordId(a.userId)) {
      console.warn('[admin] denied login for discord id', a.userId);
      return sendPage('Access denied', 'This Discord account is not authorized for the admin panel.', false);
    }
    setAdminCookie(req, res, createAdminSession(a.userId));
    return res.redirect('/admin');
  }

  // ---------- Sign in with Discord (unauthenticated, full-page) ----------
  if (loginEntry) {
    if (errParam) return appRedirect({ hf_discord: 'error', reason: 'cancelled' });
    if (loginEntry.expires_at <= Date.now()) return appRedirect({ hf_discord: 'error', reason: 'expired' });
    if (!code) return appRedirect({ hf_discord: 'error', reason: 'no_code' });
    const r = await completeOauth(code, oauthRedirectUri(req));
    if (!r.ok) {
      console.warn('[auth] discord sign-in failed -', r.error);
      return appRedirect({ hf_discord: 'error', reason: 'oauth' });
    }
    const handoff = generateShortCode(20);
    const exp = Date.now() + 5 * 60 * 1000;
    const acct = db.prepare('SELECT profile_id FROM discord_accounts WHERE discord_id = ?').get(r.userId);
    if (acct) {
      // Known Discord account -> mint a session token for that profile.
      const prof = db.prepare('SELECT id, name FROM profiles WHERE id = ?').get(acct.profile_id);
      if (!prof) return appRedirect({ hf_discord: 'error', reason: 'no_profile' });
      const token = randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO tokens (profile_id, token_hash, created_at) VALUES (?, ?, ?)')
        .run(prof.id, hashToken(token), nowMs());
      db.prepare('UPDATE discord_accounts SET username = ?, linked_at = ? WHERE discord_id = ?')
        .run(r.username || null, nowMs(), r.userId);
      // Keep the notify target current (re-link can update the DM id).
      db.prepare(
        `INSERT INTO notify_prefs (profile_id, discord_user_id, notify_turn, notify_auction, updated_at)
         VALUES (?, ?, 1, 1, ?)
         ON CONFLICT(profile_id) DO UPDATE SET discord_user_id = excluded.discord_user_id, updated_at = excluded.updated_at`
      ).run(prof.id, r.userId, nowMs());
      db.prepare('INSERT INTO discord_auth_handoff (code, kind, token, profile_id, expires_at) VALUES (?, \'login\', ?, ?, ?)')
        .run(handoff, token, prof.id, exp);
      return appRedirect({ hf_discord: 'login', code: handoff });
    }
    // New Discord account -> hand off for the "pick your name" prompt.
    db.prepare('INSERT INTO discord_auth_handoff (code, kind, discord_id, username, expires_at) VALUES (?, \'signup\', ?, ?, ?)')
      .run(handoff, r.userId, r.username || '', exp);
    return appRedirect({ hf_discord: 'signup', code: handoff });
  }

  // ---------- Connect Discord (authenticated, popup) ----------
  if (errParam) return sendPage('Discord connection cancelled', 'You can close this window and try again.', false);
  if (!linkEntry || linkEntry.expires_at <= Date.now()) {
    return sendPage('Link expired', 'That link expired or was already used. Reopen the menu and click Connect again.', false);
  }
  if (!code) return sendPage('Missing code', 'Discord did not return an authorization code. Please try again.', false);
  const profile = db.prepare('SELECT id, name FROM profiles WHERE id = ?').get(linkEntry.profile_id);
  if (!profile) return sendPage('Profile not found', 'Could not match this link to a profile. Please try again.', false);

  const r = await completeOauth(code, oauthRedirectUri(req));
  if (!r.ok) {
    console.warn('[notify] oauth callback failed for profile', linkEntry.profile_id, '-', r.error);
    return sendPage('Connection failed', `Discord linking failed (${esc(r.error)}). You can close this and try again.`, false);
  }
  // Persist the DM target (preserve existing notify_turn / notify_auction).
  db.prepare(
    `INSERT INTO notify_prefs (profile_id, discord_user_id, notify_turn, notify_auction, updated_at)
     VALUES (?, ?, 1, 1, ?)
     ON CONFLICT(profile_id) DO UPDATE SET
       discord_user_id = excluded.discord_user_id,
       updated_at      = excluded.updated_at`
  ).run(linkEntry.profile_id, r.userId, nowMs());
  // Also record the auth identity so this user can later SIGN IN with
  // Discord, not just receive DMs.
  linkDiscordAccount(r.userId, linkEntry.profile_id, r.username);
  // Fire a confirmation DM now that the guild membership exists.
  sendDM(r.userId, `✅ Discord connected for @${profile.name}. You'll get a DM when it's your turn.`)
    .then((d) => { if (!d.ok) console.warn('[notify] confirm DM failed -', d.error); });
  sendPage('Discord connected', 'You can close this window and return to the game. A confirmation DM is on its way.', true);
});

// Prune expired sign-in states + handoffs (called opportunistically).
function pruneDiscordAuth() {
  const now = Date.now();
  db.prepare('DELETE FROM discord_login_states WHERE expires_at <= ?').run(now);
  db.prepare('DELETE FROM admin_login_states WHERE expires_at <= ?').run(now);
  db.prepare('DELETE FROM discord_auth_handoff WHERE expires_at <= ?').run(now);
}

// Bind a Discord account to a profile for AUTH. A profile holds at most
// one Discord identity and a Discord id maps to one profile, so clear any
// prior identity for this profile first, then claim the id (reassigning
// it from another profile if the same Discord owner re-links elsewhere).
function linkDiscordAccount(discordId, profileId, username) {
  db.prepare('DELETE FROM discord_accounts WHERE profile_id = ?').run(profileId);
  db.prepare('INSERT OR REPLACE INTO discord_accounts (discord_id, profile_id, username, linked_at) VALUES (?, ?, ?, ?)')
    .run(discordId, profileId, username || null, nowMs());
}

// Public: whether this deployment offers "Sign in with Discord", so the
// signin view can show/hide the button without an authed call.
app.get('/auth/discord/enabled', (_req, res) => {
  res.json({ enabled: oauthEnabled() });
});

// Begin "Sign in with Discord" (unauthenticated, full-page redirect).
// Creates a login state and 302s to Discord; the callback comes back in
// login mode. Disabled / unreachable bounces to the app with an error.
app.get('/auth/discord/login/start', (req, res) => {
  if (!oauthEnabled()) return res.redirect(`${PUBLIC_APP_URL}/?hf_discord=error&reason=disabled`);
  pruneDiscordAuth();
  const state = generateShortCode(16);
  db.prepare('INSERT INTO discord_login_states (state, expires_at) VALUES (?, ?)')
    .run(state, Date.now() + OAUTH_STATE_TTL_MS);
  res.redirect(buildAuthorizeUrl(state, oauthRedirectUri(req)));
});

// Exchange a handoff code from the sign-in redirect. A 'login' handoff
// returns the minted session token; a 'signup' handoff returns the
// suggested name (the code stays valid until /auth/discord/signup runs).
app.post('/auth/discord/exchange', (req, res) => {
  pruneDiscordAuth();
  const code = String((req.body && req.body.code) || '');
  const h = code ? db.prepare('SELECT * FROM discord_auth_handoff WHERE code = ?').get(code) : null;
  if (!h || h.expires_at <= Date.now()) return res.status(400).json({ error: 'handoff_expired' });
  if (h.kind === 'login') {
    db.prepare('DELETE FROM discord_auth_handoff WHERE code = ?').run(code); // one-time
    const prof = db.prepare('SELECT id, name FROM profiles WHERE id = ?').get(h.profile_id);
    if (!prof) return res.status(400).json({ error: 'no_profile' });
    return res.json({ ok: true, status: 'signedin', token: h.token, id: prof.id, name: prof.name });
  }
  // signup: keep the code; /signup consumes it once a name is chosen.
  return res.json({ ok: true, status: 'needName', suggestedName: h.username || '' });
});

// Finalize a first-time Discord sign-up: validate the chosen name, create
// the profile, link the Discord identity (+ notify target), mint a token.
app.post('/auth/discord/signup', (req, res) => {
  pruneDiscordAuth();
  const code = String((req.body && req.body.code) || '');
  const name = String((req.body && req.body.name) || '').trim();
  const h = code
    ? db.prepare("SELECT * FROM discord_auth_handoff WHERE code = ? AND kind = 'signup'").get(code)
    : null;
  if (!h || h.expires_at <= Date.now()) return res.status(400).json({ error: 'handoff_expired' });
  if (!isValidName(name)) return res.status(400).json({ error: 'invalid_name' });

  let profileId; let profileName;
  // If the Discord id got linked in the meantime (double submit / race),
  // just sign into that profile rather than erroring or duplicating.
  const already = db.prepare('SELECT profile_id FROM discord_accounts WHERE discord_id = ?').get(h.discord_id);
  if (already) {
    const prof = db.prepare('SELECT id, name FROM profiles WHERE id = ?').get(already.profile_id);
    if (!prof) return res.status(400).json({ error: 'no_profile' });
    profileId = prof.id; profileName = prof.name;
  } else {
    const nameLower = name.toLowerCase();
    if (db.prepare('SELECT id FROM profiles WHERE name_lower = ?').get(nameLower)) {
      return res.status(409).json({ error: 'name_taken' });
    }
    const now = nowMs();
    const info = db.prepare('INSERT INTO profiles (name, name_lower, created_at, last_seen_at) VALUES (?, ?, ?, ?)')
      .run(name, nameLower, now, now);
    profileId = info.lastInsertRowid; profileName = name;
    db.prepare('INSERT INTO discord_accounts (discord_id, profile_id, username, linked_at) VALUES (?, ?, ?, ?)')
      .run(h.discord_id, profileId, h.username || null, now);
    db.prepare('INSERT INTO notify_prefs (profile_id, discord_user_id, notify_turn, notify_auction, updated_at) VALUES (?, ?, 1, 1, ?)')
      .run(profileId, h.discord_id, now);
  }
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO tokens (profile_id, token_hash, created_at) VALUES (?, ?, ?)')
    .run(profileId, hashToken(token), nowMs());
  db.prepare('DELETE FROM discord_auth_handoff WHERE code = ?').run(code); // one-time
  return res.json({ ok: true, token, id: profileId, name: profileName });
});

// The state snapshot a given op produced (git-style "tree at commit").
// Used for read-only history review and as the undo turn-base.
function stateAtSeq(gameId, seq) {
  const row = db
    .prepare('SELECT state_after FROM game_operations WHERE game_id = ? AND seq = ?')
    .get(gameId, seq);
  return row && row.state_after ? JSON.parse(row.state_after) : null;
}

// Broadcast a game update to every subscriber, with PER-RECIPIENT
// route redaction (opponents' rocket.route is stripped). makePayload
// is a function (viewerId) => payload so each viewer's payload
// references their own viewable game state.
function publishGame(gameId, makePayload) {
  const set = channels.get(`game:${gameId}`);
  if (!set) return;
  for (const ws of set) {
    if (ws.readyState !== 1) continue;
    const viewerId = ws._profile ? ws._profile.id : null;
    try { ws.send(JSON.stringify(makePayload(viewerId))); } catch { /* dropped */ }
  }
}

// Public live games: open-lobby games currently in 'active' status,
// for the lobby-list "Live games" spectator section. Returns enough
// per-row info to render the chip without an extra fetch.
//
// Games the caller is ALREADY playing in are excluded - they show up
// under "Your games" instead, and listing them here just makes the
// player think they have two tabs into the same table (user 2026-05-
// 29: "if I'm in a game, do not show that game in the watch list,
// its my game, thats confusing").
app.get('/games/public', requireProfile, (req, res) => {
  const rows = db
    .prepare(
      `SELECT g.id          AS gameId,
              g.lobby_id    AS lobbyId,
              g.created_at  AS startedAt,
              l.name        AS lobbyName,
              l.code        AS lobbyCode,
              p.name        AS hostName,
              (SELECT COUNT(*) FROM game_players gp WHERE gp.game_id = g.id) AS playerCount
       FROM games g
       JOIN lobbies l ON l.id = g.lobby_id
       JOIN profiles p ON p.id = l.host_id
       WHERE g.status = 'active'
         AND l.join_policy = 'open'
         AND NOT EXISTS (
           SELECT 1 FROM game_players gp
           WHERE gp.game_id = g.id AND gp.profile_id = ?
         )
       ORDER BY g.created_at DESC
       LIMIT 50`
    )
    .all(req.profile.id);
  res.json({ entries: rows });
});

app.get('/games/:id', requireProfile, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
  if (!canViewGame(id, req.profile.id)) return res.status(403).json({ error: 'not_a_player' });
  // Per-viewer route redaction: own route stays, opponents' routes hidden.
  const view = gameView(id, req.profile.id);
  if (!view) return res.status(404).json({ error: 'not_found' });
  res.json({ game: view, isSpectator: !isGamePlayer(id, req.profile.id) });
});

// Submit one operation. REST is the source of truth: the engine
// validates against the current snapshot, the new snapshot + op-log
// row are written in one transaction, and the result is broadcast to
// any open WS clients on game:<id>.
app.post('/games/:id/ops', requireProfile, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
  if (!isGamePlayer(id, req.profile.id)) return res.status(403).json({ error: 'not_a_player' });

  const body = req.body || {};
  const kind = String(body.kind || '');
  if (!SUPPORTED_OPS.includes(kind)) return res.status(400).json({ error: 'unknown_op' });

  const meta = db.prepare('SELECT committed_seq FROM games WHERE id = ?').get(id);
  const row = db.prepare('SELECT state, seq FROM game_states WHERE game_id = ?').get(id);
  if (!row || !meta) return res.status(404).json({ error: 'not_found' });

  const prevState = JSON.parse(row.state);
  const op = { ...body, kind };
  const ctx = { profileId: req.profile.id };
  // UNDO / REDO recompute from the turn-base snapshot: the state at the
  // start of the active player's turn, i.e. the committed_seq op's
  // snapshot (the END_TURN that handed them the turn, or the seq-0
  // START for the opening turn).
  if (NEEDS_TURN_BASE.has(kind)) {
    ctx.turnBaseState = stateAtSeq(id, meta.committed_seq);
    if (!ctx.turnBaseState) return res.status(409).json({ error: 'no_turn_base' });
  }
  const result = applyOperation(prevState, op, ctx);
  if (!result.ok) return res.status(409).json({ error: result.error });

  const nextSeq = row.seq + 1;
  const now = nowMs();
  const stateJson = JSON.stringify(result.state);
  // Persist the op payload minus the (already-recorded) kind.
  const { kind: _k, ...payload } = op;
  db.transaction(() => {
    db.prepare(
      'UPDATE game_states SET state = ?, seq = ?, updated_at = ? WHERE game_id = ?'
    ).run(stateJson, nextSeq, now, id);
    db.prepare(
      `INSERT INTO game_operations (game_id, seq, profile_id, kind, payload, log, state_after, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, nextSeq, req.profile.id, kind, JSON.stringify(payload), result.log || null, stateJson, now);
    // END_TURN is the commit: it becomes the new undo floor (the next
    // player can never unwind into the turn that just ended). Auction
    // ops advance the floor too: an auction moves aqua / decks / hands
    // that are not on the per-turn undo stack, so letting undo replay
    // across one would silently drop those effects. PICK_CREW is also
    // permanent (session-setup), and SET_FIRST_PLAYER opens a fresh
    // round-leader turn, so both commit the same way.
    if (kind === 'END_TURN' || kind === 'PICK_CREW' || kind === 'SET_FIRST_PLAYER'
        || kind.startsWith('AUCTION_')) {
      db.prepare('UPDATE games SET committed_seq = ? WHERE id = ?').run(nextSeq, id);
    }
    if (result.state.status === 'finished') {
      db.prepare("UPDATE games SET status = 'finished', finished_at = ? WHERE id = ?").run(now, id);
    }
  })();

  const opMeta = { seq: nextSeq, kind, profileId: req.profile.id, log: result.log || null };
  publishGame(id, (viewerId) => ({
    type: 'game_update',
    gameId: id,
    seq: nextSeq,
    op: opMeta,
    game: gameView(id, viewerId),
  }));
  // Out-of-band turn / auction notifications (opt-in, inert without a bot).
  dispatchTurnNotifications(id, kind, result.state);
  res.json({ ok: true, seq: nextSeq, log: result.log || null, game: gameView(id, req.profile.id) });
});

// Manual turn nudge ("Remind"). A player who is NOT the one the game is
// waiting on can ping that player with a turn DM, throttled to one per
// target per REMIND_COOLDOWN_MS. Not a game op (no board mutation, no
// seq bump) - just a DM + a cooldown row the gameView surfaces so every
// client can show who was nudged and when.
app.post('/games/:id/remind', requireProfile, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
  if (!isGamePlayer(id, req.profile.id)) return res.status(403).json({ error: 'not_a_player' });
  const g = db.prepare('SELECT status FROM games WHERE id = ?').get(id);
  if (!g) return res.status(404).json({ error: 'not_found' });
  if (g.status !== 'active') return res.status(409).json({ error: 'not_active' });
  const st = db.prepare('SELECT state FROM game_states WHERE game_id = ?').get(id);
  const state = st ? JSON.parse(st.state) : null;
  const targetId = whoNeedsToAct(state);
  if (!targetId) return res.status(409).json({ error: 'nobody_to_nudge' });
  if (targetId === req.profile.id) return res.status(409).json({ error: 'your_turn' });

  const now = nowMs();
  const prev = db
    .prepare('SELECT sent_at AS sentAt FROM turn_reminders WHERE game_id = ? AND target_id = ?')
    .get(id, targetId);
  if (prev && now - prev.sentAt < REMIND_COOLDOWN_MS) {
    return res.status(429).json({
      error: 'cooldown', targetId, sentAt: prev.sentAt,
      retryAfterMs: REMIND_COOLDOWN_MS - (now - prev.sentAt),
    });
  }
  db.prepare(
    `INSERT INTO turn_reminders (game_id, target_id, sender_id, sent_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(game_id, target_id)
       DO UPDATE SET sender_id = excluded.sender_id, sent_at = excluded.sent_at`
  ).run(id, targetId, req.profile.id, now);

  const target = state.players.find((p) => p.profileId === targetId);
  const nm = gameDisplayName(id);
  const url = gameRoomUrl(id);
  const jump = url ? `\n▶ Play now: ${url}` : '';
  notifyProfile(targetId, 'turn', `👋 ${req.profile.name} nudged you - it's your turn in ${nm}.${jump}`);
  notifyWebhook(`👋 ${req.profile.name} nudged ${target ? target.name : 'a player'} in **${nm}**.${jump}`);
  res.json({
    ok: true, targetId, targetName: target ? target.name : null,
    sentAt: now, cooldownMs: REMIND_COOLDOWN_MS,
  });
});

// Operation log, optionally only the ops after a given seq (catch-up
// for a reconnecting client that missed broadcasts).
app.get('/games/:id/ops', requireProfile, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
  if (!isGamePlayer(id, req.profile.id)) return res.status(403).json({ error: 'not_a_player' });
  const after = Number(req.query.after) || 0;
  const rows = db
    .prepare(
      `SELECT go.seq, go.kind, go.payload, go.log, go.created_at AS createdAt,
              go.profile_id AS profileId, p.name AS profileName
       FROM game_operations go
       JOIN profiles p ON p.id = go.profile_id
       WHERE go.game_id = ? AND go.seq > ?
       ORDER BY go.seq ASC
       LIMIT 200`
    )
    .all(id, after);
  res.json({
    entries: rows.map((r) => ({
      seq: r.seq,
      kind: r.kind,
      payload: r.payload ? JSON.parse(r.payload) : {},
      log: r.log,
      profileId: r.profileId,
      profileName: r.profileName,
      createdAt: r.createdAt,
    })),
  });
});

// Read-only history review: the board state a given op produced. Local
// to the caller's session (changes nothing, broadcasts nothing); the
// client uses it to scrub back through the log to the start.
app.get('/games/:id/states/:seq', requireProfile, (req, res) => {
  const id = Number(req.params.id);
  const seq = Number(req.params.seq);
  if (!Number.isFinite(id) || !Number.isFinite(seq)) return res.status(400).json({ error: 'bad_id' });
  if (!isGamePlayer(id, req.profile.id)) return res.status(403).json({ error: 'not_a_player' });
  const state = stateAtSeq(id, seq);
  if (!state) return res.status(404).json({ error: 'not_found' });
  res.json({ seq, state });
});

// ----- Invite links -----

app.post('/lobbies/:id/invite-link', requireProfile, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
  const lobby = db.prepare('SELECT host_id FROM lobbies WHERE id = ?').get(id);
  if (!lobby) return res.status(404).json({ error: 'not_found' });
  const isMember = db
    .prepare('SELECT 1 FROM lobby_members WHERE lobby_id = ? AND profile_id = ?')
    .get(id, req.profile.id);
  if (!isMember) return res.status(403).json({ error: 'not_a_member' });
  const body = req.body || {};
  const singleUse = body.singleUse ? 1 : 0;
  const ttlMs = Number(body.ttlMs);
  const expiresAt = Number.isFinite(ttlMs) && ttlMs > 0 ? nowMs() + ttlMs : null;
  let code, info;
  for (let attempt = 0; attempt < 5; attempt++) {
    code = generateInviteCode();
    try {
      info = db
        .prepare(
          `INSERT INTO invite_links (lobby_id, code, created_by, created_at, expires_at, single_use)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(id, code, req.profile.id, nowMs(), expiresAt, singleUse);
      break;
    } catch (err) {
      if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') continue;
      throw err;
    }
  }
  if (!info) return res.status(500).json({ error: 'code_collision' });
  res.status(201).json({ ok: true, code, expiresAt, singleUse: !!singleUse });
});

// Look up an invite link (no claim yet) so the landing page can show
// "Join '<lobby name>' hosted by @X?". Anonymous: a fresh visitor with
// no profile yet can still see the lobby name and create a profile
// before claiming.
// Resolve a lobby by its short share code. Public (no auth) so the
// ?room=<code> URL bootstrap can find the lobby id before sign-in
// kicks in - same posture as GET /invites/links/:code below.
// Cancelled lobbies are excluded so a stale URL doesn't keep a
// player tied to a dead game.
app.get('/lobbies/by-code/:code', (req, res) => {
  // Codes are stored lowercase (CODE_ALPHABET is lowercase + digits)
  // and SQLite is case-sensitive on `=` - matching the existing
  // Codes are stored lowercase server-side and the URL form is
  // case-insensitive (user 2026-05-29: "url shouldnt be case
  // sensitive"). normaliseCode lowercases + alphabet-checks before
  // we hit the DB so a garbage path segment short-circuits cleanly.
  const code = normaliseCode(req.params.code);
  if (!code) return res.status(400).json({ error: 'bad_code' });
  const row = db
    .prepare(
      `SELECT id, code, name, status
       FROM lobbies
       WHERE code = ? AND status != 'cancelled'`
    )
    .get(code);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json({
    id: row.id, code: row.code, name: row.name, status: row.status,
  });
});

app.get('/invites/links/:code', (req, res) => {
  const code = normaliseCode(req.params.code);
  if (!code) return res.status(400).json({ error: 'bad_code' });
  const row = db
    .prepare(
      `SELECT il.lobby_id, il.expires_at, il.single_use, il.used_count, il.used_by,
              l.name AS lobby_name, l.status AS lobby_status,
              p.name AS host_name
       FROM invite_links il
       JOIN lobbies l ON l.id = il.lobby_id
       JOIN profiles p ON p.id = l.host_id
       WHERE il.code = ?`
    )
    .get(code);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const expired = row.expires_at && row.expires_at < nowMs();
  const used    = row.single_use === 1 && row.used_count > 0;
  res.json({
    lobbyId: row.lobby_id,
    lobbyName: row.lobby_name,
    lobbyStatus: row.lobby_status,
    hostName: row.host_name,
    expired,
    used,
  });
});

// Claim an invite link to join. Bumps used_count; if single_use,
// pins used_by to the first caller.
app.post('/invites/links/:code/claim', requireProfile, (req, res) => {
  const code = normaliseCode(req.params.code);
  if (!code) return res.status(400).json({ error: 'bad_code' });
  const row = db
    .prepare(
      `SELECT id, lobby_id, expires_at, single_use, used_count
       FROM invite_links WHERE code = ?`
    )
    .get(code);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (row.expires_at && row.expires_at < nowMs()) {
    return res.status(410).json({ error: 'expired' });
  }
  if (row.single_use === 1 && row.used_count > 0) {
    return res.status(410).json({ error: 'used' });
  }
  const result = joinLobby(row.lobby_id, req.profile.id, { acceptedInvite: true });
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  db.prepare(
    `UPDATE invite_links
     SET used_count = used_count + 1,
         used_by    = COALESCE(used_by, ?)
     WHERE id = ?`
  ).run(req.profile.id, row.id);
  publishLobby(row.lobby_id);
  res.json({ ok: true, lobbyId: row.lobby_id });
});

// ----- Direct invites -----

app.post('/lobbies/:id/invite', requireProfile, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
  const targetName = String((req.body && req.body.name) || '').trim().toLowerCase();
  if (!targetName) return res.status(400).json({ error: 'missing_name' });
  const isMember = db
    .prepare('SELECT 1 FROM lobby_members WHERE lobby_id = ? AND profile_id = ?')
    .get(id, req.profile.id);
  if (!isMember) return res.status(403).json({ error: 'not_a_member' });
  const target = db
    .prepare('SELECT id, name FROM profiles WHERE name_lower = ? AND banned_at IS NULL')
    .get(targetName);
  if (!target) return res.status(404).json({ error: 'profile_not_found' });
  if (target.id === req.profile.id) return res.status(400).json({ error: 'self_invite' });
  const alreadyMember = db
    .prepare('SELECT 1 FROM lobby_members WHERE lobby_id = ? AND profile_id = ?')
    .get(id, target.id);
  if (alreadyMember) return res.status(409).json({ error: 'already_member' });
  const now = nowMs();
  // Upsert: re-inviting the same person clears any previous declined
  // invite. UNIQUE(lobby_id, to_id) keeps the row count at 1.
  db.prepare(
    `INSERT INTO direct_invites (lobby_id, from_id, to_id, status, created_at)
     VALUES (?, ?, ?, 'pending', ?)
     ON CONFLICT(lobby_id, to_id) DO UPDATE
       SET from_id      = excluded.from_id,
           status       = 'pending',
           created_at   = excluded.created_at,
           responded_at = NULL`
  ).run(id, req.profile.id, target.id, now);
  // Ping the recipient if they're online over WS.
  publishToProfile(target.id, {
    type: 'invite',
    direct: true,
    lobbyId: id,
    from: req.profile.name,
    targetName: target.name,
  });
  res.status(201).json({ ok: true });
});

app.get('/invites', requireProfile, (req, res) => {
  const rows = db
    .prepare(
      `SELECT di.id,
              di.lobby_id  AS lobbyId,
              di.from_id   AS fromId,
              di.created_at AS createdAt,
              p.name       AS fromName,
              l.name       AS lobbyName,
              l.status     AS lobbyStatus
       FROM direct_invites di
       JOIN profiles p ON p.id = di.from_id
       JOIN lobbies  l ON l.id = di.lobby_id
       WHERE di.to_id = ? AND di.status = 'pending' AND l.status = 'waiting'
       ORDER BY di.created_at DESC
       LIMIT 50`
    )
    .all(req.profile.id);
  res.json({ entries: rows });
});

app.post('/invites/:id/accept', requireProfile, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
  const row = db
    .prepare(
      `SELECT id, lobby_id, status, to_id
       FROM direct_invites WHERE id = ?`
    )
    .get(id);
  if (!row || row.to_id !== req.profile.id) return res.status(404).json({ error: 'not_found' });
  if (row.status !== 'pending') return res.status(409).json({ error: 'already_resolved' });
  const result = joinLobby(row.lobby_id, req.profile.id, { acceptedInvite: true });
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  db.prepare(
    "UPDATE direct_invites SET status = 'accepted', responded_at = ? WHERE id = ?"
  ).run(nowMs(), id);
  publishLobby(row.lobby_id);
  res.json({ ok: true, lobbyId: row.lobby_id });
});

app.post('/invites/:id/decline', requireProfile, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
  const info = db
    .prepare(
      `UPDATE direct_invites
       SET status = 'declined', responded_at = ?
       WHERE id = ? AND to_id = ? AND status = 'pending'`
    )
    .run(nowMs(), id, req.profile.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

// ----- Chat -----

app.get('/lobbies/:id/chat', requireProfile, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
  const isMember = db
    .prepare('SELECT 1 FROM lobby_members WHERE lobby_id = ? AND profile_id = ?')
    .get(id, req.profile.id);
  if (!isMember) return res.status(403).json({ error: 'not_a_member' });
  const before = Number(req.query.before) || nowMs() + 1;
  const rows = db
    .prepare(
      `SELECT cm.id, cm.body, cm.created_at AS createdAt,
              p.name AS profileName, p.id AS profileId,
              cm.lobby_id AS lobbyId
       FROM chat_messages cm
       JOIN profiles p ON p.id = cm.profile_id
       WHERE cm.lobby_id = ? AND cm.created_at < ?
       ORDER BY cm.created_at DESC
       LIMIT 100`
    )
    .all(id, before);
  res.json({ entries: rows.reverse() });
});

app.post('/lobbies/:id/chat', requireProfile, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
  const body = String((req.body && req.body.body) || '').trim();
  if (!body) return res.status(400).json({ error: 'empty_body' });
  if (body.length > 500) return res.status(413).json({ error: 'too_long' });
  const isMember = db
    .prepare('SELECT 1 FROM lobby_members WHERE lobby_id = ? AND profile_id = ?')
    .get(id, req.profile.id);
  if (!isMember) return res.status(403).json({ error: 'not_a_member' });
  const now = nowMs();
  const info = db
    .prepare(
      `INSERT INTO chat_messages (lobby_id, profile_id, body, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(id, req.profile.id, body, now);
  const msg = {
    id: info.lastInsertRowid,
    lobbyId: id,
    profileId: req.profile.id,
    profileName: req.profile.name,
    body,
    createdAt: now,
  };
  broadcast(`lobby:${id}`, { type: 'chat', message: msg });
  res.status(201).json({ ok: true, message: msg });
});

// Global chat: lobby_id IS NULL rows in chat_messages, anyone signed
// in can read + post (no membership gate). Broadcast on the 'global'
// WS channel so every lobby-list session sees new messages live.
app.get('/chat/global', requireProfile, (req, res) => {
  const before = Number(req.query.before) || nowMs() + 1;
  const rows = db
    .prepare(
      `SELECT cm.id, cm.body, cm.created_at AS createdAt,
              p.name AS profileName, p.id AS profileId
       FROM chat_messages cm
       JOIN profiles p ON p.id = cm.profile_id
       WHERE cm.lobby_id IS NULL AND cm.created_at < ?
       ORDER BY cm.created_at DESC
       LIMIT 100`
    )
    .all(before);
  res.json({ entries: rows.reverse() });
});

app.post('/chat/global', requireProfile, (req, res) => {
  const body = String((req.body && req.body.body) || '').trim();
  if (!body) return res.status(400).json({ error: 'empty_body' });
  if (body.length > 500) return res.status(413).json({ error: 'too_long' });
  const now = nowMs();
  const info = db
    .prepare(
      `INSERT INTO chat_messages (lobby_id, profile_id, body, created_at)
       VALUES (NULL, ?, ?, ?)`
    )
    .run(req.profile.id, body, now);
  const msg = {
    id: info.lastInsertRowid,
    lobbyId: null,
    profileId: req.profile.id,
    profileName: req.profile.name,
    body,
    createdAt: now,
  };
  broadcast('global', { type: 'chat', message: msg });
  res.status(201).json({ ok: true, message: msg });
});

// ----- WebSocket layer -----

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

// channel -> Set<ws>
const channels = new Map();
// profileId -> Set<ws>
const profileSockets = new Map();

function subscribe(ws, channel) {
  let set = channels.get(channel);
  if (!set) { set = new Set(); channels.set(channel, set); }
  set.add(ws);
  ws._channels.add(channel);
}

function unsubscribe(ws, channel) {
  const set = channels.get(channel);
  if (set) {
    set.delete(ws);
    if (set.size === 0) channels.delete(channel);
  }
  ws._channels.delete(channel);
}

function broadcast(channel, payload) {
  const set = channels.get(channel);
  if (!set) return;
  const msg = JSON.stringify(payload);
  for (const ws of set) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

function publishToProfile(profileId, payload) {
  const set = profileSockets.get(profileId);
  if (!set) return;
  const msg = JSON.stringify(payload);
  for (const ws of set) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

wss.on('connection', (ws) => {
  ws._channels = new Set();
  ws._profile = null;
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); }
    catch { return ws.send(JSON.stringify({ type: 'error', error: 'bad_json' })); }
    if (!msg || typeof msg.type !== 'string') return;
    switch (msg.type) {
      case 'auth': {
        const profile = profileFromToken(msg.token);
        if (!profile) return ws.send(JSON.stringify({ type: 'auth_error' }));
        ws._profile = profile;
        let set = profileSockets.get(profile.id);
        if (!set) { set = new Set(); profileSockets.set(profile.id, set); }
        set.add(ws);
        ws.send(JSON.stringify({ type: 'auth_ok', profile }));
        return;
      }
      case 'sub': {
        if (!ws._profile) return ws.send(JSON.stringify({ type: 'error', error: 'auth_required' }));
        const channel = String(msg.channel || '');
        if (!isValidChannel(channel, ws._profile)) {
          return ws.send(JSON.stringify({ type: 'error', error: 'bad_channel' }));
        }
        subscribe(ws, channel);
        ws.send(JSON.stringify({ type: 'sub_ok', channel }));
        return;
      }
      case 'unsub': {
        const channel = String(msg.channel || '');
        unsubscribe(ws, channel);
        ws.send(JSON.stringify({ type: 'unsub_ok', channel }));
        return;
      }
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', ts: nowMs() }));
        return;
      default:
        ws.send(JSON.stringify({ type: 'error', error: 'unknown_type' }));
    }
  });
  ws.on('close', () => {
    for (const ch of ws._channels) {
      const set = channels.get(ch);
      if (set) { set.delete(ws); if (set.size === 0) channels.delete(ch); }
    }
    if (ws._profile) {
      const set = profileSockets.get(ws._profile.id);
      if (set) { set.delete(ws); if (set.size === 0) profileSockets.delete(ws._profile.id); }
    }
  });
});

// A channel name is allowed if it matches `lobby:<id>` and the
// caller is a member of that lobby, or `me:<profile_id>` and the id
// matches the caller. Anything else is rejected so a randomly
// generated channel name can't be used as a covert pubsub.
function isValidChannel(channel, profile) {
  // Global chat: any signed-in profile can subscribe.
  if (channel === 'global') return true;
  const m = /^lobby:(\d+)$/.exec(channel);
  if (m) {
    const lobbyId = Number(m[1]);
    const isMember = db
      .prepare('SELECT 1 FROM lobby_members WHERE lobby_id = ? AND profile_id = ?')
      .get(lobbyId, profile.id);
    return !!isMember;
  }
  const g = /^game:(\d+)$/.exec(channel);
  if (g) {
    const gameId = Number(g[1]);
    // Players always allowed; spectators allowed when the underlying
    // lobby is open and the game is active (read-only live updates).
    return canViewGame(gameId, profile.id);
  }
  const me = /^me:(\d+)$/.exec(channel);
  if (me) return Number(me[1]) === profile.id;
  return false;
}

// Heartbeat: clients that haven't pinged in 60s are dropped to free
// the in-memory channel sets.
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const ws of wss.clients) {
    if (ws._lastPong && ws._lastPong < cutoff) ws.terminate();
  }
}, 30_000).unref();

// ----- Admin dashboard -----
//
// Admin dashboard at /admin: KPIs, profiles, lobbies, recent chat,
// pending invites, invite links. Mirrors the murdoku-companion admin in
// shape: a single HTML render with inline styles, no client framework.
//
// Gated behind Discord OAuth (see the "Admin auth" section above): only
// an allowlisted Discord account may sign in. Unauthenticated visitors
// get the sign-in screen; the mutating action routes below are wrapped
// in requireAdmin.

app.get('/admin', (req, res) => {
  // Gated behind Discord OAuth: unauthenticated visitors get the
  // sign-in screen instead of the dashboard.
  if (!adminFromRequest(req)) {
    return res.type('html').send(adminLoginPage());
  }
  const kpi = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM profiles)                                AS profiles,
         (SELECT COUNT(*) FROM tokens)                                  AS tokens,
         (SELECT COUNT(*) FROM lobbies WHERE status = 'waiting')        AS lobbies_waiting,
         (SELECT COUNT(*) FROM lobbies WHERE status = 'started')        AS lobbies_started,
         (SELECT COUNT(*) FROM lobby_members)                           AS seats_taken,
         (SELECT COUNT(*) FROM chat_messages)                           AS chat_total,
         (SELECT COUNT(*) FROM direct_invites WHERE status = 'pending') AS invites_pending,
         (SELECT COUNT(*) FROM invite_links)                            AS links_total`
    )
    .get();

  const profiles = db
    .prepare(
      `SELECT p.id, p.name,
              datetime(p.created_at   / 1000, 'unixepoch') AS created,
              datetime(p.last_seen_at / 1000, 'unixepoch') AS seen,
              (SELECT COUNT(*) FROM tokens t WHERE t.profile_id = p.id) AS devices,
              (SELECT COUNT(*) FROM lobby_members lm WHERE lm.profile_id = p.id) AS tables,
              (SELECT COUNT(*) FROM chat_messages cm WHERE cm.profile_id = p.id) AS chats
       FROM profiles p
       ORDER BY p.last_seen_at DESC
       LIMIT 100`
    )
    .all();

  const lobbies = db
    .prepare(
      `SELECT l.id, l.code, l.name, l.status, l.join_policy, l.max_players,
              datetime(l.created_at / 1000, 'unixepoch') AS created,
              p.name AS host_name,
              (SELECT COUNT(*) FROM lobby_members lm WHERE lm.lobby_id = l.id) AS members
       FROM lobbies l
       JOIN profiles p ON p.id = l.host_id
       ORDER BY l.created_at DESC
       LIMIT 50`
    )
    .all();

  const chats = db
    .prepare(
      `SELECT cm.id, cm.body,
              datetime(cm.created_at / 1000, 'unixepoch') AS sent,
              p.name AS profile_name,
              l.name AS lobby_name, l.code AS lobby_code
       FROM chat_messages cm
       JOIN profiles p ON p.id = cm.profile_id
       LEFT JOIN lobbies l ON l.id = cm.lobby_id
       ORDER BY cm.created_at DESC
       LIMIT 30`
    )
    .all();

  const invites = db
    .prepare(
      `SELECT di.id, di.status,
              datetime(di.created_at / 1000, 'unixepoch') AS sent,
              fp.name AS from_name, tp.name AS to_name,
              l.name AS lobby_name, l.code AS lobby_code
       FROM direct_invites di
       JOIN profiles fp ON fp.id = di.from_id
       JOIN profiles tp ON tp.id = di.to_id
       JOIN lobbies  l  ON l.id  = di.lobby_id
       ORDER BY di.created_at DESC
       LIMIT 30`
    )
    .all();

  const links = db
    .prepare(
      `SELECT il.code, il.single_use, il.used_count,
              datetime(il.created_at / 1000, 'unixepoch') AS created,
              CASE WHEN il.expires_at IS NULL THEN ''
                   ELSE datetime(il.expires_at / 1000, 'unixepoch') END AS expires,
              cp.name AS by_name, l.name AS lobby_name, l.code AS lobby_code
       FROM invite_links il
       JOIN profiles cp ON cp.id = il.created_by
       JOIN lobbies  l  ON l.id  = il.lobby_id
       ORDER BY il.created_at DESC
       LIMIT 30`
    )
    .all();

  const wsCount = wss ? wss.clients.size : 0;
  const wsAuthed = wss
    ? Array.from(wss.clients).filter((c) => c._profile).length
    : 0;

  const profileRows = profiles.map((r) => `
    <tr>
      <td>@${esc(r.name)}</td>
      <td>${esc(r.created)}</td>
      <td>${esc(r.seen)}</td>
      <td class="num">${r.devices}</td>
      <td class="num">${r.tables}</td>
      <td class="num">${r.chats}</td>
      <td>
        <button class="btn-add-token" data-pid="${r.id}" data-pname="${esc(r.name)}">Issue device code</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan=7><em>No profiles yet.</em></td></tr>';

  const lobbyRows = lobbies.map((r) => `
    <tr>
      <td><code>${esc(r.code)}</code></td>
      <td>${esc(r.name)}</td>
      <td>@${esc(r.host_name)}</td>
      <td><span class="pill pill-${esc(r.status)}">${esc(r.status)}</span></td>
      <td>${esc(r.join_policy)}</td>
      <td class="num">${r.members} / ${r.max_players}</td>
      <td>${esc(r.created)}</td>
      <td>
        ${r.status === 'cancelled'
          ? `<button class="btn-restore-lobby" data-lid="${r.id}" data-lname="${esc(r.name)}">Restore</button>`
          : `<button class="btn-del-lobby danger" data-lid="${r.id}" data-lname="${esc(r.name)}">Cancel</button>`}
      </td>
    </tr>
  `).join('') || '<tr><td colspan=8><em>No lobbies yet.</em></td></tr>';

  const chatRows = chats.map((r) => `
    <tr>
      <td>${esc(r.sent)}</td>
      <td>@${esc(r.profile_name)}</td>
      <td>${r.lobby_code ? `<code>${esc(r.lobby_code)}</code> ${esc(r.lobby_name)}` : '<em>(deleted)</em>'}</td>
      <td>${esc(r.body)}</td>
    </tr>
  `).join('') || '<tr><td colspan=4><em>No chat messages yet.</em></td></tr>';

  const inviteRows = invites.map((r) => `
    <tr>
      <td>${esc(r.sent)}</td>
      <td><span class="pill pill-${esc(r.status)}">${esc(r.status)}</span></td>
      <td>@${esc(r.from_name)} → @${esc(r.to_name)}</td>
      <td><code>${esc(r.lobby_code)}</code> ${esc(r.lobby_name)}</td>
    </tr>
  `).join('') || '<tr><td colspan=4><em>No direct invites yet.</em></td></tr>';

  const linkRows = links.map((r) => `
    <tr>
      <td><code>${esc(r.code)}</code></td>
      <td>${esc(r.created)}</td>
      <td>${esc(r.expires) || '-'}</td>
      <td>${r.single_use ? 'single-use' : 'unlimited'}</td>
      <td class="num">${r.used_count}</td>
      <td>@${esc(r.by_name)}</td>
      <td><code>${esc(r.lobby_code)}</code> ${esc(r.lobby_name)}</td>
    </tr>
  `).join('') || '<tr><td colspan=7><em>No invite links yet.</em></td></tr>';

  res.set('content-type', 'text/html; charset=utf-8');
  res.send(`<!doctype html>
<html><head><meta charset="utf-8"><title>High Frontier admin</title>
<style>
  :root { color-scheme: dark; }
  body{font:14px ui-sans-serif,system-ui,-apple-system,sans-serif;background:#07060f;color:#e6e9ff;margin:0;padding:24px;max-width:1200px}
  h1{margin:0 0 4px;color:#7dd3fc;font-size:22px}
  .sub{color:#5a5f80;font-size:12px;text-transform:uppercase;letter-spacing:2px;margin-bottom:18px}
  h2{margin:28px 0 8px;font-size:13px;color:#38bdf8;letter-spacing:1.5px;text-transform:uppercase}
  table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums;background:#0c0a16;border:1px solid #1e293b;border-radius:8px;overflow:hidden}
  td,th{border-bottom:1px solid #1e293b;padding:8px 12px;text-align:left;vertical-align:top}
  tr:last-child td{border-bottom:none}
  th{color:#38bdf8;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:1px;background:#0f172a}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  .kpis{display:flex;gap:10px;margin:12px 0 24px;flex-wrap:wrap}
  .kpi{background:#0c0a16;border:1px solid #1e293b;padding:12px 16px;border-radius:8px;min-width:110px}
  .kpi strong{font-size:22px;color:#7dd3fc;display:block;font-weight:600}
  .kpi span{font-size:11px;color:#5a5f80;text-transform:uppercase;letter-spacing:1px;margin-top:2px;display:block}
  code{background:#0f172a;padding:1px 6px;border-radius:4px;font-size:12px;color:#7dd3fc}
  em{color:#5a5f80;font-style:normal}
  .pill{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:600}
  .pill-waiting{background:#1e293b;color:#7dd3fc}
  .pill-started{background:#14532d;color:#86efac}
  .pill-finished{background:#451a03;color:#fdba74}
  .pill-cancelled{background:#450a0a;color:#fda4af}
  .pill-pending{background:#1e293b;color:#fbbf24}
  .pill-accepted{background:#14532d;color:#86efac}
  .pill-declined{background:#450a0a;color:#fda4af}
  button{font:inherit;background:#1a1830;color:#e6e9ff;border:1px solid #2a2740;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:12px}
  button:hover{background:#25223e;border-color:#3a3760}
  button:disabled{opacity:0.5;cursor:not-allowed}
  button.danger{background:#450a0a;border-color:#7f1d1d;color:#fda4af}
  button.danger:hover{background:#7f1d1d;color:#fff;border-color:#b91c1c}
  input[type=text]{background:#07060f;color:#e6e9ff;border:1px solid #2a2740;border-radius:4px;padding:4px 8px;font:inherit}
  .ws-info{display:inline-block;background:#0c0a16;border:1px solid #1e293b;padding:8px 14px;border-radius:6px;margin-left:auto;font-size:12px;color:#8b90b8}
  .ws-info strong{color:#4ade80;font-weight:600}
  .header-row{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
</style></head>
<body>
  <div class="header-row">
    <div>
      <h1>High Frontier admin</h1>
      <div class="sub">stage 2 · ${esc(new Date().toISOString())}</div>
    </div>
    <div class="ws-info">
      <strong>${wsCount}</strong> open sockets · <strong>${wsAuthed}</strong> authed
      · <a href="#" onclick="fetch('/admin/logout',{method:'POST'}).then(function(){location.href='/admin';});return false;">Sign out</a>
    </div>
  </div>

  <div class="kpis">
    <div class="kpi"><strong>${kpi.profiles}</strong><span>profiles</span></div>
    <div class="kpi"><strong>${kpi.tokens}</strong><span>devices</span></div>
    <div class="kpi"><strong>${kpi.lobbies_waiting}</strong><span>waiting</span></div>
    <div class="kpi"><strong>${kpi.lobbies_started}</strong><span>in progress</span></div>
    <div class="kpi"><strong>${kpi.seats_taken}</strong><span>seats</span></div>
    <div class="kpi"><strong>${kpi.chat_total}</strong><span>chat lines</span></div>
    <div class="kpi"><strong>${kpi.invites_pending}</strong><span>pending invites</span></div>
    <div class="kpi"><strong>${kpi.links_total}</strong><span>invite links</span></div>
  </div>

  <h2>Announcement banner</h2>
  <p>Shown atop global chat for every player. One current message (this
  overrides it). Blank to hide.</p>
  <form onsubmit="saveAnnouncement(event)">
    <textarea id="announce-text" rows="4" style="width:100%;box-sizing:border-box">${esc(
      (db.prepare("SELECT value FROM server_settings WHERE key='announcement'").get() || {}).value || ''
    )}</textarea>
    <div style="margin-top:6px"><button type="submit">Save announcement</button>
    <span id="announce-status"></span></div>
  </form>
  <script>
    function saveAnnouncement(e) {
      e.preventDefault();
      var msg = document.getElementById('announce-text').value;
      document.getElementById('announce-status').textContent = 'Saving…';
      fetch('/admin/announcement', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg }) })
        .then(function (r) { document.getElementById('announce-status').textContent = r.ok ? 'Saved.' : 'Failed.'; })
        .catch(function () { document.getElementById('announce-status').textContent = 'Failed.'; });
    }
  </script>

  <h2>Discord webhook</h2>
  <p>Optional. A Discord channel <strong>webhook URL</strong> (Channel -&gt;
  Edit -&gt; Integrations -&gt; Webhooks -&gt; New Webhook -&gt; Copy URL)
  posts turn / auction events to that channel - no bot required. Server-wide
  (one channel for the whole deployment). Blank to disable.${
    defaultWebhookUrl()
      ? ' A <code>DISCORD_WEBHOOK_URL</code> env default is set; a value saved here overrides it.'
      : ''
  }</p>
  <form onsubmit="saveWebhook(event)">
    <input id="webhook-url" type="text" placeholder="https://discord.com/api/webhooks/…"
      style="width:100%;box-sizing:border-box" value="${esc(
        ((db.prepare("SELECT value FROM server_settings WHERE key='discord_webhook_url'").get() || {}).value) || ''
      )}">
    <div style="margin-top:6px">
      <button type="submit">Save webhook</button>
      <button type="button" onclick="testWebhook()">Send test message</button>
      <span id="webhook-status"></span>
    </div>
  </form>
  <script>
    function saveWebhook(e) {
      e.preventDefault();
      var url = document.getElementById('webhook-url').value.trim();
      document.getElementById('webhook-status').textContent = 'Saving…';
      fetch('/admin/discord-webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url }) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
        .then(function (res) {
          document.getElementById('webhook-status').textContent =
            res.ok ? 'Saved.' : 'Failed: ' + (res.body && res.body.error || 'unknown');
        })
        .catch(function () { document.getElementById('webhook-status').textContent = 'Failed.'; });
    }
    // Fire whatever is currently in the box (saved or not), so the
    // operator can verify a URL before committing it.
    function testWebhook() {
      var url = document.getElementById('webhook-url').value.trim();
      document.getElementById('webhook-status').textContent = 'Sending…';
      fetch('/admin/discord-webhook/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url }) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
        .then(function (res) {
          document.getElementById('webhook-status').textContent =
            res.ok ? 'Test message sent.' : 'Failed: ' + (res.body && res.body.error || 'unknown');
        })
        .catch(function () { document.getElementById('webhook-status').textContent = 'Failed.'; });
    }
  </script>

  <h2>Profiles &amp; devices</h2>
  <table>
    <thead><tr>
      <th>Name</th><th>Created</th><th>Last seen</th>
      <th class="num">Devices</th><th class="num">Tables</th><th class="num">Chats</th>
      <th>Recovery</th>
    </tr></thead>
    <tbody>${profileRows}</tbody>
  </table>

  <h2>Lobbies</h2>
  <table>
    <thead><tr>
      <th>Code</th><th>Name</th><th>Host</th>
      <th>Status</th><th>Policy</th><th class="num">Players</th><th>Created</th><th>Manage</th>
    </tr></thead>
    <tbody>${lobbyRows}</tbody>
  </table>

  <h2>Recent chat</h2>
  <table>
    <thead><tr>
      <th>When</th><th>Who</th><th>Lobby</th><th>Body</th>
    </tr></thead>
    <tbody>${chatRows}</tbody>
  </table>

  <h2>Direct invites</h2>
  <table>
    <thead><tr>
      <th>Sent</th><th>Status</th><th>From → To</th><th>Lobby</th>
    </tr></thead>
    <tbody>${inviteRows}</tbody>
  </table>

  <h2>Invite links</h2>
  <table>
    <thead><tr>
      <th>Code</th><th>Created</th><th>Expires</th><th>Mode</th>
      <th class="num">Uses</th><th>Created by</th><th>Lobby</th>
    </tr></thead>
    <tbody>${linkRows}</tbody>
  </table>

<script>
// "Issue device code" - mints a fresh recovery code for the
// profile and replaces the button cell with the one-shot code so
// the operator can copy + send it out-of-band.
document.addEventListener('click', function (ev) {
  var btn = ev.target.closest('.btn-add-token');
  if (!btn) return;
  var pid = btn.getAttribute('data-pid');
  var pname = btn.getAttribute('data-pname');
  if (!confirm('Issue a new device code for @' + pname + '?\\n\\nThis lets the user sign in on another device. Their existing devices stay signed in.')) return;
  btn.disabled = true;
  btn.textContent = 'Working...';
  fetch('/admin/profiles/' + pid + '/add-token', { method: 'POST' })
    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
    .then(function (res) {
      if (!res.ok) {
        btn.disabled = false;
        btn.textContent = 'Issue device code';
        alert('Failed: ' + (res.body && res.body.error || 'unknown'));
        return;
      }
      var cell = btn.parentElement;
      cell.innerHTML = '';
      var input = document.createElement('input');
      input.type = 'text';
      input.readOnly = true;
      input.value = res.body.token;
      input.style.cssText = 'width:120px;font-family:ui-monospace,monospace;font-size:13px;letter-spacing:2px;text-align:center';
      var copy = document.createElement('button');
      copy.textContent = 'Copy';
      copy.style.marginLeft = '4px';
      copy.addEventListener('click', function () {
        input.select();
        if (navigator.clipboard) navigator.clipboard.writeText(input.value);
        else document.execCommand('copy');
        copy.textContent = 'Copied';
      });
      cell.appendChild(input);
      cell.appendChild(copy);
    })
    .catch(function () {
      btn.disabled = false;
      btn.textContent = 'Issue device code';
      alert('Network error.');
    });
});

// "Cancel" - marks the lobby and its game as 'cancelled' (kept in
// the DB for audit; pending invites are cancelled + broadcast to
// each invitee), then drops the row from the table.
document.addEventListener('click', function (ev) {
  var btn = ev.target.closest('.btn-del-lobby');
  if (!btn) return;
  var lid = btn.getAttribute('data-lid');
  var lname = btn.getAttribute('data-lname');
  if (!confirm('Cancel table "' + lname + '" and its game?\\n\\nThe lobby + game keep their op-log + state rows (status = cancelled), but the players lose access and pending invites are cleared.')) return;
  btn.disabled = true;
  btn.textContent = 'Cancelling...';
  fetch('/admin/lobbies/' + lid + '/delete', { method: 'POST' })
    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
    .then(function (res) {
      if (!res.ok) {
        btn.disabled = false;
        btn.textContent = 'Cancel';
        alert('Failed: ' + (res.body && res.body.error || 'unknown'));
        return;
      }
      var tr = btn.closest('tr');
      if (tr) tr.remove();
    })
    .catch(function () {
      btn.disabled = false;
      btn.textContent = 'Cancel';
      alert('Network error.');
    });
});

// "Restore" - un-cancels a lobby + its game so an accidentally-
// cancelled room reappears in the players' lists. Reloads the
// dashboard on success so the status pill + action button flip.
document.addEventListener('click', function (ev) {
  var btn = ev.target.closest('.btn-restore-lobby');
  if (!btn) return;
  var lid = btn.getAttribute('data-lid');
  var lname = btn.getAttribute('data-lname');
  if (!confirm('Restore table "' + lname + '"?\\n\\nThe lobby + its game go back to active so the players regain access.')) return;
  btn.disabled = true;
  btn.textContent = 'Restoring...';
  fetch('/admin/lobbies/' + lid + '/restore', { method: 'POST' })
    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
    .then(function (res) {
      if (!res.ok) {
        btn.disabled = false;
        btn.textContent = 'Restore';
        alert('Failed: ' + (res.body && res.body.error || 'unknown'));
        return;
      }
      location.reload();
    })
    .catch(function () {
      btn.disabled = false;
      btn.textContent = 'Restore';
      alert('Network error.');
    });
});
</script>
</body></html>`);
});

// Mint a fresh device code for a profile and ADD it to the tokens
// table. The user's existing devices keep working; this just adds
// another credential. Returns the plaintext once - only chance to
// see it before it's hashed for storage. requireAdmin-gated.
app.post('/admin/profiles/:id/add-token', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
  const row = db.prepare('SELECT id, name FROM profiles WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const token = generateShortCode();
  db.prepare(
    'INSERT INTO tokens (profile_id, token_hash, created_at) VALUES (?, ?, ?)'
  ).run(id, hashToken(token), nowMs());
  res.json({ ok: true, name: row.name, token });
});

// Cancel a lobby and its game (formerly a hard DELETE; user 2026-05:
// "update server to cancel games instead of deleting them to avoid
// dangling data" - keep the audit trail). Sets lobbies.status and
// games.status to 'cancelled', cancels pending invites + broadcasts
// invite_cancelled, then broadcasts lobby_disbanded so anyone still
// on the channel drops. requireAdmin-gated.
//
// Endpoint path is still .../delete so the existing admin button
// keeps working without a UI change.
app.post('/admin/lobbies/:id/delete', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
  const row = db.prepare('SELECT id FROM lobbies WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const now = nowMs();
  db.transaction(() => {
    cancelLobbyInvites(id);
    db.prepare(
      "UPDATE lobbies SET status = 'cancelled' WHERE id = ? AND status != 'cancelled'"
    ).run(id);
    db.prepare(
      "UPDATE games SET status = 'cancelled', finished_at = COALESCE(finished_at, ?) WHERE lobby_id = ? AND status != 'cancelled'"
    ).run(now, id);
  })();
  broadcast(`lobby:${id}`, { type: 'lobby_disbanded', lobbyId: id });
  res.json({ ok: true });
});

// Restore an accidentally-cancelled lobby. Un-cancels the lobby + its
// game so the room reappears in the player-facing lists (all of which
// filter on status). A cancelled game row means the lobby had already
// started, so both are revived (lobby -> started, game -> active, and
// the finished_at stamp the cancel set is cleared); no game row means
// it was cancelled while still waiting, so the lobby goes back to
// waiting. Pending invites are NOT auto-restored (they were resolved
// at cancel time); the host can re-invite.
app.post('/admin/lobbies/:id/restore', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
  const row = db.prepare('SELECT id, status FROM lobbies WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (row.status !== 'cancelled') return res.status(409).json({ error: 'not_cancelled' });
  db.transaction(() => {
    const game = db.prepare(
      "SELECT id FROM games WHERE lobby_id = ? AND status = 'cancelled'"
    ).get(id);
    if (game) {
      db.prepare(
        "UPDATE games SET status = 'active', finished_at = NULL WHERE lobby_id = ? AND status = 'cancelled'"
      ).run(id);
      db.prepare("UPDATE lobbies SET status = 'started' WHERE id = ?").run(id);
    } else {
      db.prepare("UPDATE lobbies SET status = 'waiting' WHERE id = ?").run(id);
    }
  })();
  res.json({ ok: true });
});

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ----- Boot -----

// One-time cleanup of dangling pending-invites for lobbies that have
// since left the 'waiting' state (started / cancelled / finished /
// orphaned). New gameplay paths cancel invites at the right time,
// but earlier builds left stranded rows that the /invites listing
// already hides via the lobby-status join - this just stops them
// accumulating in the table forever.
(() => {
  const before = db.prepare(
    `SELECT COUNT(*) AS n FROM direct_invites di
     LEFT JOIN lobbies l ON l.id = di.lobby_id
     WHERE di.status = 'pending'
       AND (l.id IS NULL OR l.status != 'waiting')`
  ).get().n;
  if (!before) return;
  db.prepare(
    `UPDATE direct_invites
     SET status = 'cancelled', responded_at = ?
     WHERE status = 'pending' AND id IN (
       SELECT di.id FROM direct_invites di
       LEFT JOIN lobbies l ON l.id = di.lobby_id
       WHERE di.status = 'pending'
         AND (l.id IS NULL OR l.status != 'waiting')
     )`
  ).run(nowMs());
  console.log(`cleaned up ${before} stranded pending invite(s)`);
})();

// Idempotent normalisation: recall stranded EMPTY rockets to LEO.
// Games created before "rocket opens at LEO" started every ship at
// startSiteId() (Itokawa), so an empty rocket that never launched is
// stranded at a real site. An empty rocket can't burn, so it can only
// ever be at LEO - this matches the invariant the engine now enforces
// (applyMove rejects empty_rocket, recallIfEmpty keeps it at LEO), so
// re-running on already-correct state is a no-op.
//
// NOTE: we deliberately do NOT touch rocket.tank here. New rockets
// spawn with 0 water (STARTING_WATER), which is the real fix for
// "magic 20 water". A boot-time tank reset would also wipe water a
// player legitimately converted from aqua at LEO every time the
// server restarts (user 2026-05-29: "I dont want this to happen every
// time going forward, just prevent water spawning with brand new
// rockets"). Pre-fix games keep their old water; start a fresh game
// for a clean tank.
(() => {
  const rows = db.prepare('SELECT game_id, state FROM game_states').all();
  let fixed = 0;
  for (const row of rows) {
    let st;
    try { st = JSON.parse(row.state); } catch { continue; }
    if (!st || !Array.isArray(st.players)) continue;
    let changed = false;
    for (const p of st.players) {
      const r = p && p.rocket;
      if (r && Array.isArray(r.stack) && r.stack.length === 0 && r.siteId != null) {
        r.siteId = null;
        r.activeThrusterId = null;
        r.activeProspectorId = null;
        changed = true;
      }
    }
    if (changed) {
      db.prepare('UPDATE game_states SET state = ? WHERE game_id = ?')
        .run(JSON.stringify(st), row.game_id);
      fixed += 1;
    }
  }
  if (fixed) console.log(`recalled empty rockets to LEO in ${fixed} game(s)`);
})();

// Backfill the game-length cap on in-progress games that predate it.
// Per product decision, existing games default to 5 rounds. This only
// adds the field; it does NOT reshuffle turn order or switch on the
// first-player handoff (those are new-game-only), so a running game is
// otherwise untouched - it simply now finishes at round 5.
(() => {
  const rows = db.prepare('SELECT game_id, state FROM game_states').all();
  let filled = 0;
  for (const row of rows) {
    let st;
    try { st = JSON.parse(row.state); } catch { continue; }
    if (!st || typeof st !== 'object') continue;
    if (st.maxRounds != null) continue;
    st.maxRounds = 5;
    db.prepare('UPDATE game_states SET state = ? WHERE game_id = ?')
      .run(JSON.stringify(st), row.game_id);
    filled += 1;
  }
  if (filled) console.log(`backfilled maxRounds=5 on ${filled} in-progress game(s)`);
})();

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`high-frontier-fan-game listening on :${PORT} (HTTP + WS at /ws)`);
});
