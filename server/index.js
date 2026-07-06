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
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { db, nowMs } from './db.js';
import { createInitialState } from './game/state.js';
import { applyOperation, SUPPORTED_OPS, NEEDS_TURN_BASE, slotMass, activeNetThrust, thrusterFuelPerBurn, rocketDryMass, ceoSoloView, bernalVpByPlayer, auctionWaitingOn } from './game/engine.js';
import { randomSeed, makeRng, shuffle } from './game/rng.js';
import { COLONISTS } from '../data/colonists.js';
import { siteBySlug, nodeBySlug, resolveNodeRef } from './game/planner-graph.js';
import { PATENTS_BY_ID as _BASE_PATENTS_BY_ID } from '../data/patents.js';
import { BERNALS_BY_ID } from '../data/bernals.js';
import { COLONISTS_BY_ID } from '../data/colonists.js';
// Same merged card lookup the engine uses (patents + M2 Bernals + Colonists),
// so admin labels / the give-card catalog resolve every card in play.
const PATENTS_BY_ID = { ..._BASE_PATENTS_BY_ID, ...BERNALS_BY_ID, ...COLONISTS_BY_ID };
import { ASSEMBLY_PLACES, IDEOLOGY_BY_KEY } from '../data/assembly.js';
import { normaliseTag } from '../data/site-tags.js';
import { NODE_TAGS as STATIC_NODE_TAGS } from '../data/node-tags.js';
import { makeRefId, disambiguate } from '../data/planner-ids.js';
import { classifyBody } from '../data/body-class.js';

// Snapshot of every marker-relevant solar-map node (id2 + type + planner
// flags), the same file gen-node-tags.mjs reads. Used by the admin site-tags
// search so an admin can tag ANY routing node, not only ones players noted.
const __dirname = dirname(fileURLToPath(import.meta.url));
let PLANNER_NODES = [];
try {
  PLANNER_NODES = JSON.parse(
    readFileSync(resolve(__dirname, '..', 'data', 'planner-nodes.json'), 'utf8')
  );
} catch { PLANNER_NODES = []; }

// Every NAMED site (planet / asteroid / moon / comet / dwarf) from the planner
// data, so the admin site-tags page can search + tag actual sites, not just
// routing waypoints. The id2 slug is derived the SAME way planner-map.js does
// (makeRefId + disambiguate in point order), so it matches the slug the client
// tags with. The Docker image copies vendor/ to the server (server/Dockerfile),
// so this file is present at runtime.
let NAMED_SITES = [];
try {
  const raw = JSON.parse(readFileSync(
    resolve(__dirname, '..', 'vendor', 'hf-mission-planner', 'assets', 'data-hf4.json'), 'utf8'));
  const entries = Object.entries(raw.points || {});
  const ids = disambiguate(entries.map(([, p]) => makeRefId(p, p.type || 'unknown')));
  entries.forEach(([, p], i) => {
    if (p.type === 'site' && p.siteName) {
      NAMED_SITES.push({ id2: ids[i], name: p.siteName, type: classifyBody(p.siteName) });
    }
  });
} catch { NAMED_SITES = []; }
import {
  sendDM, discordEnabled,
  sendWebhook, webhookEnabled, isWebhookUrl, defaultWebhookUrl,
  oauthEnabled, oauthClientId, buildAuthorizeUrl, completeOauth,
  oauthIdentifyEnabled, buildIdentifyAuthorizeUrl, identifyOauth,
} from './discord.js';

const PORT = Number(process.env.PORT) || 8080;

// Rat Frontier is an admin-gated experimental variant. The allowlist is a
// secret env flag: a comma-separated list of profile names that may see and
// open it. Re-read on every boot so rotating the secret takes effect on
// restart, the same way the admin-allowlist seed does.
const RAT_ADMIN_NAMES = new Set(
  (process.env.RAT_ADMIN_NAMES || process.env.RAT_FRONTIER_ADMINS || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
);
function isRatAdmin(name) {
  return RAT_ADMIN_NAMES.has(String(name || '').toLowerCase());
}

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

// Serve the shared client source so the /admin "Manage state" map can mount the
// SAME solar-map renderer the player sandbox uses (js/game/render.js +
// loadPlannerMap). These trees are already public on GH Pages; the Docker image
// copies them (server/Dockerfile) so the imports + runtime-fetched assets
// (vendor/.../data-hf4.json, data/site-flags.json, assets/factory PNGs) resolve
// against this origin too. Static, read-only, no secrets.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const dir of ['js', 'data', 'assets', 'vendor', 'css']) {
  app.use('/' + dir, express.static(resolve(REPO_ROOT, dir), { fallthrough: true, maxAge: '5m' }));
}

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

// Whether the calling profile may use the admin-gated Rat Frontier variant.
// The client hides the menu entry unless this returns { allowed: true }.
// Two ways in: the RAT_ADMIN_NAMES allowlist (a profile-name flag), or - the
// path the admin already has - a Discord account linked to this profile whose
// id is on the server admin allowlist (ADMIN_DISCORD_ID(S)). So whoever is
// already a server admin gets Rat Frontier with no extra secret.
// Is this profile a Rat Frontier admin? Three ways in: the RAT_ADMIN_NAMES
// name flag, a Discord account linked to this profile whose id is on the
// server admin allowlist (the cross-origin path - the game client sends a
// Bearer token, not the admin cookie), or a live admin-portal cookie session
// (same-origin). Shared by /rat-frontier/access, /profiles/me, and the
// node-tags save below.
function profileIsAdmin(profile, req) {
  if (profile && isRatAdmin(profile.name)) return true;
  if (profile) {
    const acct = db
      .prepare('SELECT discord_id FROM discord_accounts WHERE profile_id = ?')
      .get(profile.id);
    if (acct && isAdminDiscordId(acct.discord_id)) return true;
  }
  if (req && adminFromRequest(req)) return true;
  return false;
}

app.get('/rat-frontier/access', requireProfile, (req, res) => {
  res.json({ allowed: profileIsAdmin(req.profile, req), profile: req.profile.name });
});

// Assign authoritative server node-tags from the Rat Frontier map editor.
// Bearer-authed + admin-checked (the editor runs on GitHub Pages and can't
// use the admin cookie), so the editor writes the real node_tags store with
// the admin's login - applied immediately. Body: { tags: { "<id2>": { lander,
// half, hazard, aerobrake, season, site_name } } }. An entry with every flag
// off and no season clears the override (reverts to the baseline tag).
app.post('/rat-frontier/node-tags', requireProfile, (req, res) => {
  if (!profileIsAdmin(req.profile, req)) return res.status(403).json({ error: 'not_admin' });
  const tags = (req.body && req.body.tags) || {};
  let saved = 0, cleared = 0;
  for (const siteId of Object.keys(tags)) {
    if (!SITE_ID_RE.test(siteId)) continue;
    const t = tags[siteId] || {};
    const empty = !t.lander && !t.half && !t.hazard && !t.aerobrake
      && !SEASON_KEYS.includes(t.season);
    if (empty) {
      db.prepare('DELETE FROM node_tags WHERE site_id = ?').run(siteId);
      cleared++;
    } else {
      saveNodeTag(siteId, String(t.site_name || ''), t);
      saved++;
    }
  }
  res.json({ ok: true, saved, cleared });
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
const ADMIN_SESSION_TTL_MS = 48 * 60 * 60 * 1000; // 48h, slides on use

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
//
// SLIDING SESSION: when `res` is supplied (every gated request has one), a
// valid session is renewed in place - its expiry is pushed out to
// now + TTL and the cookie's maxAge is refreshed - so active use never
// expires. The 48h clock only runs out after a full window of inactivity,
// which preserves the allowlist-revoke-on-redeploy property.
function adminFromRequest(req, res = null) {
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
  if (res) {
    // Slide the window: extend the DB expiry and re-stamp the cookie.
    db.prepare('UPDATE admin_sessions SET expires_at = ? WHERE token_hash = ?')
      .run(nowMs() + ADMIN_SESSION_TTL_MS, hash);
    setAdminCookie(req, res, token);
  }
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
// Passing res slides the session (renews expiry + cookie) on each action.
function requireAdmin(req, res, next) {
  if (adminFromRequest(req, res)) return next();
  return res.status(403).json({ error: 'admin_auth_required' });
}

// Public game URL (GitHub Pages). Surfaced on the admin login / notice
// pages so a player who wandered into the admin portal has a one-tap way
// back to the game.
const GAME_URL = 'https://rubentipparach.github.io/high-frontier-fan-game/';

// Minimal styled HTML page (login screen + error notices), matching the
// OAuth callback's look.
function adminHtmlPage(title, bodyHtml, accent = '#f87171') {
  return `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(title)}</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:15px ui-sans-serif,system-ui,sans-serif;background:#07060f;color:#e6e9ff;
display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center;text-align:center;padding:24px}
.box{max-width:440px}h1{font-size:20px;color:${accent};margin:0 0 12px}
p{color:#8b90b8;line-height:1.55}
a.play{display:inline-block;margin-top:22px;color:#7dd3fc;text-decoration:none;font-size:13px}
a.play:hover{text-decoration:underline}
a.btn{display:inline-block;margin-top:18px;padding:11px 18px;border-radius:9px;
background:#5865F2;color:#fff;text-decoration:none;font-weight:700}
a.btn:hover{background:#4752c4}</style></head><body><div class="box">
<h1>${esc(title)}</h1>${bodyHtml}
<p><a class="play" href="${GAME_URL}">Play High Frontier 4: All -&gt;</a></p></div></body></html>`;
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
  const acct = db
    .prepare('SELECT discord_id FROM discord_accounts WHERE profile_id = ?')
    .get(req.profile.id);
  const discordLinked = !!acct;
  // Admin status, server-derived on every page load (restoreProfile calls
  // this): the secret admin id lives in GitHub secrets -> ADMIN_DISCORD_ID(S)
  // -> the allowlist, and we match it against THIS profile's linked Discord
  // id (or the RAT_ADMIN_NAMES name flag, or a live admin-portal cookie).
  // The raw Discord id is never sent to the client, so this can't be spoofed.
  const isAdmin = profileIsAdmin(req.profile, req);
  res.json({
    id: req.profile.id,
    name: req.profile.name,
    discordLinked,
    isAdmin,
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
      `SELECT id, status FROM games
       WHERE lobby_id = ? AND status != 'cancelled'
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
    draftStart: !!row.draft_start,
    randomDraft: !!row.random_draft,
    m0: !!row.m0,
    m1: !!row.m1,
    m2: !!row.m2,
    ceoSolo: !!row.ceo_solo,
    status: row.status,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    gameId: game ? game.id : null,
    gameStatus: game ? game.status : null,
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
  // Idempotency key: a retry / double-submit of the SAME create intent
  // carries the same key, so a slow or lost response never spawns a
  // duplicate room. Optional; absent = legacy behaviour (always create).
  const idemKey = (typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim())
    ? body.idempotencyKey.trim().slice(0, 64) : null;
  if (idemKey) {
    const existing = db
      .prepare('SELECT id FROM lobbies WHERE idempotency_key = ? AND host_id = ?')
      .get(idemKey, req.profile.id);
    if (existing) return res.status(200).json({ ok: true, lobby: lobbyRow(existing.id), deduped: true });
  }
  const name = String(body.name || '').trim().slice(0, 60) || `${req.profile.name}'s table`;
  // Min 1 so a "solo room" (a private 1-player table for testing the
  // multiplayer engine alone) can be created; the normal create form still
  // asks for 2+. Start only requires >=1 member, so a solo room can begin.
  const maxPlayers = Math.max(1, Math.min(6, Number(body.maxPlayers) || 5));
  // Game length: 5 (short, default) / 6 (medium) / 7 (extra long).
  const maxRounds = [4, 5, 6, 7].includes(Number(body.maxRounds)) ? Number(body.maxRounds) : 5;
  const joinPolicy = body.joinPolicy === 'invite-only' ? 'invite-only' : 'open';
  // Solo-game setup options. Stored on the lobby and honoured at start ONLY for
  // 1-player rooms (multiplayer is always market + the standard bank). Null when
  // unset, so the start path falls back to defaults.
  //   startingAqua: 0..100 free-play bank (e.g. 100 sandbox-style vs 6 standard)
  //   economy:      'library' (free draws) or 'market' (auctioned)
  const startingAqua = Number.isFinite(Number(body.startingAqua))
    ? Math.max(0, Math.min(100, Math.floor(Number(body.startingAqua)))) : null;
  const economy = (body.economy === 'library' || body.economy === 'market') ? body.economy : null;
  // Opt-in draft-round opening (any player count). Stored on the lobby, applied
  // at start.
  const draftStart = body.draftStart ? 1 : 0;
  // Opt-in random-draft opening: each player is dealt 12 random cards (no
  // interactive pick). Stored on the lobby, applied at start.
  const randomDraft = body.randomDraft ? 1 : 0;
  // Opt-in Module 0 (Sol Political Assembly). Fixed at creation; games already
  // running default to off (no retroactive apply).
  const m0 = body.m0 ? 1 : 0;
  // Opt-in Module 1 (Terawatt & Futures). Released for OPEN playtesting: any
  // host may turn it on (the admin gate was removed). Still experimental, and
  // still fixed at creation. M2 remains admin-only below.
  const m1 = body.m1 ? 1 : 0;
  // Opt-in Module 2 (Colonization + Futures). RELEASED for every host (v1.3.0,
  // the M1 open-release pattern - the admin gate is dropped). Still experimental
  // and fixed at creation. A ceoSolo room may carry M2 too (Futures in solo).
  const m2 = body.m2 ? 1 : 0;
  // Opt-in CEO Solitaire (V6). RELEASED for every host (v1.2.0, user decision
  // 2026-07-01) - the admin preview gate is dropped, mirroring the M1 open
  // release. Fixed at creation. A 2+ player lobby can carry the flag but the
  // variant only activates on a 1-player start (see the start route).
  const ceoSolo = body.ceoSolo ? 1 : 0;
  const now = nowMs();
  let code, info;
  for (let attempt = 0; attempt < 5; attempt++) {
    code = generateShortCode(6);
    try {
      info = db
        .prepare(
          `INSERT INTO lobbies (code, name, host_id, max_players, max_rounds, join_policy, status, created_at, idempotency_key, starting_aqua, economy, draft_start, random_draft, m0, m1, m2, ceo_solo)
           VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(code, name, req.profile.id, maxPlayers, maxRounds, joinPolicy, now, idemKey, startingAqua, economy, draftStart, randomDraft, m0, m1, m2, ceoSolo);
      break;
    } catch (err) {
      if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        // The clash is either the random code (retry with a fresh one) or
        // the idempotency key (a concurrent request with the same key won
        // the race - return ITS lobby so both callers see one room).
        if (idemKey) {
          const raced = db
            .prepare('SELECT id FROM lobbies WHERE idempotency_key = ? AND host_id = ?')
            .get(idemKey, req.profile.id);
          if (raced) return res.status(200).json({ ok: true, lobby: lobbyRow(raced.id), deduped: true });
        }
        continue;
      }
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
              l.draft_start AS draftStart,
              l.random_draft AS randomDraft,
              l.m0          AS m0,
              l.m1          AS m1,
              l.m2          AS m2,
              l.created_at  AS createdAt,
              p.name        AS hostName,
              (SELECT COUNT(*) FROM lobby_members lm WHERE lm.lobby_id = l.id) AS memberCount,
              (SELECT group_concat(nm) FROM (
                 SELECT p2.name AS nm FROM lobby_members lmx
                 JOIN profiles p2 ON p2.id = lmx.profile_id
                 WHERE lmx.lobby_id = l.id
                 ORDER BY lmx.joined_at ASC)) AS memberNames
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
  // Two separate queries, NO limit on either (user decision 2026-07-01): the
  // dashboard carries in-progress rooms plus ended rooms (cancelled ones to
  // Restore, finished ones to Review - the user reviews past solo games from
  // here). The old single created_at-DESC LIMIT 50 window let a burst of new
  // rooms push a player's OLDER still-running games out of the list entirely
  // (the "my game disappeared" bug once someone had 50+ lobbies).
  const MINE_SELECT = `SELECT l.id, l.code, l.name, l.status,
              l.max_players AS maxPlayers,
              l.join_policy AS joinPolicy,
              l.host_id     AS hostId,
              l.draft_start AS draftStart,
              l.random_draft AS randomDraft,
              l.m0          AS m0,
              l.m1          AS m1,
              l.m2          AS m2,
              l.ceo_solo    AS ceoSolo,
              l.created_at  AS createdAt,
              p.name        AS hostName,
              (SELECT COUNT(*) FROM lobby_members lm2 WHERE lm2.lobby_id = l.id) AS memberCount,
              (SELECT group_concat(nm) FROM (
                 SELECT p2.name AS nm FROM lobby_members lmx
                 JOIN profiles p2 ON p2.id = lmx.profile_id
                 WHERE lmx.lobby_id = l.id
                 ORDER BY lmx.joined_at ASC)) AS memberNames,
              g.id     AS gameId,
              g.status AS gameStatus,
              gs.updated_at AS lastActionAt
       FROM lobbies l
       JOIN lobby_members lm ON lm.lobby_id = l.id AND lm.profile_id = ?
       JOIN profiles p ON p.id = l.host_id
       LEFT JOIN games g ON g.lobby_id = l.id
       LEFT JOIN game_states gs ON gs.game_id = g.id`;
  // In-progress: not cancelled and no finished game. Uncapped.
  const activeRows = db
    .prepare(
      `${MINE_SELECT}
       WHERE l.status != 'cancelled'
         AND NOT EXISTS (SELECT 1 FROM games gf WHERE gf.lobby_id = l.id AND gf.status = 'finished')
       ORDER BY l.created_at DESC`
    )
    .all(req.profile.id);
  // Ended rooms: cancelled (restorable) or finished (reviewable), most
  // recently ended first.
  const endedRows = db
    .prepare(
      `${MINE_SELECT}
       WHERE l.status = 'cancelled'
          OR EXISTS (SELECT 1 FROM games gf WHERE gf.lobby_id = l.id AND gf.status = 'finished')
       ORDER BY COALESCE(gs.updated_at, l.cancelled_at, l.created_at) DESC`
    )
    .all(req.profile.id);
  const rows = [...activeRows, ...endedRows];
  // Decorate each in-progress game with whose turn it is, the round
  // progress, and when the last turn ended, so the dashboard can show
  // it without opening the board.
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
        // Seated-player count of the STARTED game (not lobby membership). A
        // 1-seat game is a solo table where it is always "your turn", so the
        // "Next table" jump list filters these out - only real multiplayer
        // tables waiting on you should be offered.
        row.playerCount = players.length;
        row.solo = players.length <= 1 || !!state.ceoSolo;
        if (state.pendingFirstPlayer) {
          const chooser = players.find((pl) => pl.profileId === state.pendingFirstPlayer.chooserId);
          row.pendingFirstPlayerName = chooser ? chooser.name : null;
        }
        row.round = state.round;
        row.maxRounds = state.maxRounds;
        row.turn = state.turn | 0;   // 0-based slot within the round (12 per round)
        // Open research auction: list who still needs to respond so the
        // dashboard can nudge them ("auction needed: @a, @b"), tinted by seat
        // colour, and flag the row when the viewer is one of them.
        const waiting = auctionWaitingOn(state);
        if (waiting.length) {
          row.auctionWaiting = waiting.map((p) => ({ name: p.name, color: p.color || null }));
          row.yourAuction = waiting.some((p) => p.profileId === req.profile.id);
        }
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

// Player-facing close (soft delete) of a room you host. Mirrors the admin
// cancel: marks the lobby + its game 'cancelled' (kept for audit / restore),
// never a hard delete. Host-only, allowed for any room the host owns (solo
// OR a live multiplayer table) so the host can shut a game down from the
// in-game settings. Everyone else at the table is dropped back to the lobby
// (the lobby_disbanded broadcast). The room moves to the host's "ended" list,
// restorable below.
app.post('/lobbies/:id/close', requireProfile, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
  const lobby = db.prepare('SELECT id, host_id FROM lobbies WHERE id = ?').get(id);
  if (!lobby) return res.status(404).json({ error: 'not_found' });
  if (lobby.host_id !== req.profile.id) return res.status(403).json({ error: 'not_host' });
  const now = nowMs();
  db.transaction(() => {
    cancelLobbyInvites(id);
    db.prepare("UPDATE lobbies SET status = 'cancelled', cancelled_at = ? WHERE id = ? AND status != 'cancelled'").run(now, id);
    db.prepare("UPDATE games SET status = 'cancelled', finished_at = COALESCE(finished_at, ?) WHERE lobby_id = ? AND status != 'cancelled'").run(now, id);
  })();
  broadcast(`lobby:${id}`, { type: 'lobby_disbanded', lobbyId: id });
  res.json({ ok: true });
});

// Player-facing restore of a room you host that was closed. Un-cancels the
// lobby + its game so the room reappears in your active list (a cancelled game
// row means it had started -> lobby 'started' + game 'active'; otherwise the
// lobby goes back to 'waiting'). Mirrors the admin restore.
app.post('/lobbies/:id/restore', requireProfile, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
  const lobby = db.prepare('SELECT id, host_id, status FROM lobbies WHERE id = ?').get(id);
  if (!lobby) return res.status(404).json({ error: 'not_found' });
  if (lobby.host_id !== req.profile.id) return res.status(403).json({ error: 'not_host' });
  if (lobby.status !== 'cancelled') return res.status(409).json({ error: 'not_cancelled' });
  db.transaction(() => {
    const game = db.prepare("SELECT id FROM games WHERE lobby_id = ? AND status = 'cancelled'").get(id);
    if (game) {
      db.prepare("UPDATE games SET status = 'active', finished_at = NULL WHERE lobby_id = ? AND status = 'cancelled'").run(id);
      db.prepare("UPDATE lobbies SET status = 'started', cancelled_at = NULL WHERE id = ?").run(id);
    } else {
      db.prepare("UPDATE lobbies SET status = 'waiting', cancelled_at = NULL WHERE id = ?").run(id);
    }
  })();
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

// Host edits the room config while WAITING (before start): game length,
// draft-start, M0, and visibility. Lets the host fix settings (e.g. turn on
// M0) without recreating the room. Host-only; rejected once started.
app.post('/lobbies/:id/settings', requireProfile, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
  const lobby = db.prepare('SELECT host_id, status FROM lobbies WHERE id = ?').get(id);
  if (!lobby) return res.status(404).json({ error: 'not_found' });
  if (lobby.host_id !== req.profile.id) return res.status(403).json({ error: 'not_host' });
  if (lobby.status !== 'waiting') return res.status(409).json({ error: 'already_started' });
  const body = req.body || {};
  const sets = [];
  const args = [];
  if (body.maxPlayers !== undefined) {
    // Can't drop below the players already seated.
    const seated = db.prepare('SELECT COUNT(*) AS n FROM lobby_members WHERE lobby_id = ?').get(id).n | 0;
    const mp = Math.max(seated, 1, Math.min(6, Number(body.maxPlayers) || seated));
    sets.push('max_players = ?'); args.push(mp);
  }
  if (body.maxRounds !== undefined) {
    const mr = [4, 5, 6, 7].includes(Number(body.maxRounds)) ? Number(body.maxRounds) : 5;
    sets.push('max_rounds = ?'); args.push(mr);
  }
  if (body.draftStart !== undefined) { sets.push('draft_start = ?'); args.push(body.draftStart ? 1 : 0); }
  if (body.randomDraft !== undefined) { sets.push('random_draft = ?'); args.push(body.randomDraft ? 1 : 0); }
  if (body.m0 !== undefined) { sets.push('m0 = ?'); args.push(body.m0 ? 1 : 0); }
  // M1 is open for playtesting: any host may toggle it (admin gate removed).
  if (body.m1 !== undefined) { sets.push('m1 = ?'); args.push(body.m1 ? 1 : 0); }
  // M2 is released (v1.3.0): any host may toggle it pre-start (a ceoSolo room may
  // carry it too - Futures in solo).
  if (body.m2 !== undefined) { sets.push('m2 = ?'); args.push(body.m2 ? 1 : 0); }
  // CEO Solitaire is released (v1.2.0): any host may toggle it pre-start.
  if (body.ceoSolo !== undefined) { sets.push('ceo_solo = ?'); args.push(body.ceoSolo ? 1 : 0); }
  if (body.joinPolicy !== undefined) {
    sets.push('join_policy = ?'); args.push(body.joinPolicy === 'invite-only' ? 'invite-only' : 'open');
  }
  if (!sets.length) return res.json({ ok: true, lobby: lobbyRow(id) });
  args.push(id);
  db.prepare(`UPDATE lobbies SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  publishLobby(id);
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
  const lobby = db.prepare('SELECT host_id, status, max_rounds, starting_aqua, economy, draft_start, random_draft, m0, m1, m2, ceo_solo FROM lobbies WHERE id = ?').get(id);
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
  const maxRounds = [4, 5, 6, 7].includes(lobby.max_rounds) ? lobby.max_rounds : 5;
  // Solo-game setup options are honoured only for a 1-player game; multiplayer
  // is always market + the standard starting bank. Unset (or non-solo) leaves
  // them undefined so createInitialState uses its defaults.
  const solo = players.length === 1;
  const startingAqua = solo && Number.isFinite(lobby.starting_aqua) ? lobby.starting_aqua : undefined;
  const economy = solo && (lobby.economy === 'library' || lobby.economy === 'market') ? lobby.economy : undefined;
  // Draft-start mode applies at any player count (it's a setup-flow choice, not
  // a solo-only one like the bank / economy above).
  const draftStart = !!lobby.draft_start;
  const randomDraft = !!lobby.random_draft;
  const m0 = !!lobby.m0;
  const m1 = !!lobby.m1;
  const m2 = !!lobby.m2;
  // CEO Solitaire forces M0 on (createInitialState enforces it too); only a
  // 1-player room can actually be the variant.
  const ceoSolo = !!lobby.ceo_solo && solo;
  const state = createInitialState({ players, seed, maxRounds, startingAqua, economy, draftStart, randomDraft, m0, m1, m2, ceoSolo });

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
  // pick - notify them the same way a turn handoff does. Skipped for a
  // solo table (no one else to tell; you're already here).
  try {
    if (!isSoloGame(state)) {
      const nm = gameDisplayName(gameId);
      const url = gameRoomUrl(gameId);
      const jump = url ? `\n▶ Play now: ${url}` : '';
      if (discordEnabled()) {
        for (const p of state.players) {
          notifyProfile(p.profileId, 'turn', `🧑‍🚀 **${nm}** is starting - pick your crew.${jump}`);
        }
      }
      notifyWebhook(`🧑‍🚀 **${nm}** has started - crew draft is open.${jump}`);
    }
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
    if (p.profileId === viewerId) continue;          // your own routes stay
    if (p.rocket) p.rocket.route = [];               // opponents: hidden
    if (p.freighter) p.freighter.route = [];         // freighter route also secret
    for (const bn of (p.bernals || [])) bn.route = []; // Bernal crawl route also secret
  }
  // M2 colonist queue: the queue is VISIBLE (user 2026-07-04 - it is no longer
  // hidden). Send the full ordered line plus its size so the Colonists tab can
  // show the actual cards; exomigration still resolves against the raw state.
  if (Array.isArray(clone.colonistQueue)) {
    clone.colonistQueueCount = clone.colonistQueue.length;
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
  // CEO Solitaire always runs the card Market (Research Auction / Free Market
  // need the shuffled decks). Force it in the view so the client's market-mode
  // pin flips to Card Market even for a game whose PERSISTED economy is a stale
  // 'library' (it was created before the wizard forced market), and stitch the
  // live scoreboard (current VP + next KPI) on for the turn-bar score modal.
  if (viewState && viewState.ceoSolo) {
    viewState.economy = 'market';
    viewState.ceoLive = ceoSoloView(viewState);
  }
  // Stamp each player's anchored-Bernal VP onto the view so the client's live
  // scoring panel can score anchored Bernals without re-deriving map adjacency
  // (the authoritative math lives in the engine). M2 games only.
  if (viewState && viewState.m2 && Array.isArray(viewState.players)) {
    const bvp = bernalVpByPlayer(viewState);
    for (const p of viewState.players) p.bernalVp = bvp[p.profileId] | 0;
  }
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

// ----- Admin game-state editor helpers -----
//
// Powers the per-room "Manage state" modal in /admin: a flattened, fully
// un-redacted view of every player's card locations + aqua + tank, plus the
// mutations the admin can apply (move / give / remove a card, set aqua / fuel).
// Every mutation persists through the SAME seq + op-log + broadcast path the
// engine uses (persistAdminEdit), so clients re-hydrate exactly as they do for
// a normal op - no second state model.

function cardLabel(id) {
  const c = PATENTS_BY_ID[id];
  return (c && c.name) || String(id);
}
function slotInfo(slot) {
  const c = PATENTS_BY_ID[slot.id];
  return {
    id: slot.id,
    name: cardLabel(slot.id),
    face: slot.face || 'primary',
    kind: slot.kind || 'patent',
    // Card type (thruster / colonist / gw-thruster / ...) so the editor can
    // pick the right flip label (black side vs purple promotion).
    type: (c && c.type) || '',
    // Installed-face mass of this card, so the admin breakdown can show each
    // card's mass contribution and the per-unit dry/wet totals.
    mass: slotMass(slot),
  };
}
// Which optional module a card belongs to: colonists + Bernals ship with M2,
// GW thrusters + Freighters with M1. null = core, always available.
function cardModule(card) {
  if (!card) return null;
  if (card.type === 'colonist' || card.type === 'bernal') return 'm2';
  if (card.type === 'gw-thruster' || card.type === 'freighter') return 'm1';
  return null;
}
// The slot kind a card carries when it enters a stack (the engine tags
// colonist and crew slots so per-kind reads work).
function slotKindFor(cardId) {
  const c = PATENTS_BY_ID[cardId];
  if (c && c.type === 'colonist') return 'colonist';
  if (c && c.type === 'crew') return 'crew';
  return 'patent';
}
// Dry + wet mass for any unit stack (rocket / freighter / Bernal), via the SAME
// engine helpers the move math uses. dry = stack mass sum (min 1); wet = dry +
// tank. round3 keeps a fractional tank readable.
function unitMassInfo(unit) {
  if (!unit) return { dryMass: null, wetMass: null };
  const dry = rocketDryMass((unit.stack || []).reduce((m, s) => m + slotMass(s), 0));
  const wet = dry + (Number(unit.tank) || 0);
  return { dryMass: dry, wetMass: Math.round(wet * 1000) / 1000 };
}
function siteNameOf(slug) {
  if (!slug) return 'LEO';
  const s = siteBySlug(slug);
  return (s && s.name) || String(slug);
}
function locLabel(loc) {
  if (loc === 'hand') return 'Hand';
  if (loc === 'leo') return 'LEO';
  if (loc === 'rocket') return 'Rocket';
  if (loc === 'freighter') return 'Freighter';
  const mb = /^bernal:(\d+)$/.exec(loc || '');
  if (mb) return `Bernal ${Number(mb[1]) + 1}`;
  const m = /^outpost:(.+)$/.exec(loc || '');
  return m ? `Outpost ${m[1]}` : String(loc);
}

// The card list for a location, by reference, so a push/splice mutates state.
// hand is an array of ids; every other location is an array of slot objects.
function listFor(player, loc) {
  if (loc === 'leo') return (player.leo = player.leo || []);
  if (loc === 'rocket') {
    player.rocket = player.rocket || {};
    return (player.rocket.stack = player.rocket.stack || []);
  }
  if (loc === 'freighter') {
    return player.freighter ? (player.freighter.stack = player.freighter.stack || []) : null;
  }
  const mb = /^bernal:(\d+)$/.exec(loc || '');
  if (mb) {
    const bn = (player.bernals || [])[Number(mb[1])];
    return bn ? (bn.stack = bn.stack || []) : null;
  }
  const m = /^outpost:(.+)$/.exec(loc || '');
  if (m) {
    const o = (player.outposts || {})[m[1]];
    return o ? (o.cards = o.cards || []) : null;
  }
  return null;
}
// Remove ONE card matching cardId from a location; returns a normalized slot
// {id, kind, face} or null when not present.
function takeCardFrom(player, loc, cardId) {
  if (loc === 'hand') {
    const i = (player.hand || []).indexOf(cardId);
    if (i < 0) return null;
    player.hand.splice(i, 1);
    // Kind follows the card (a hand robot entering a stack is a colonist
    // slot, like the engine's own ET-produce / exomigrate paths tag it).
    return { id: cardId, kind: slotKindFor(cardId), face: 'primary' };
  }
  const arr = listFor(player, loc);
  if (!arr) return null;
  const i = arr.findIndex((s) => s.id === cardId);
  if (i < 0) return null;
  const [slot] = arr.splice(i, 1);
  return { id: slot.id, kind: slot.kind || 'patent', face: slot.face || 'primary' };
}
function addCardTo(player, loc, entry) {
  if (loc === 'hand') { (player.hand = player.hand || []).push(entry.id); return true; }
  const arr = listFor(player, loc);
  if (!arr) return false;
  arr.push({ id: entry.id, kind: entry.kind || 'patent', face: entry.face || 'primary' });
  return true;
}
// After a card leaves the rocket, drop any active-slot pointer that no longer
// resolves so the engine doesn't reference a card that isn't there.
function fixupRocketPointers(player) {
  const r = player.rocket;
  if (!r || !Array.isArray(r.stack)) return;
  if (r.activeThrusterId && !r.stack.some((s) => s.id === r.activeThrusterId)) r.activeThrusterId = null;
  if (r.activeProspectorId && !r.stack.some((s) => s.id === r.activeProspectorId)) r.activeProspectorId = null;
}

// Flatten one game's state for the admin modal: every player's locations with
// resolved card names, plus aqua + rocket tank. Un-redacted (admin only).
function adminGameStateView(gameId) {
  const st = db.prepare('SELECT state, seq FROM game_states WHERE game_id = ?').get(gameId);
  if (!st) return null;
  const state = JSON.parse(st.state);
  const players = (state.players || []).map((p) => {
    const r = p.rocket || {};
    return {
      profileId: p.profileId,
      name: p.name,
      color: p.color || null,
      aqua: p.aqua || 0,
      // Permanent card-power grants (e.g. POWERSAT from IONOSAT / Power Girdle),
      // so the manage-state editor can show + toggle them.
      grantedPrivileges: Array.isArray(p.grantedPrivileges) ? p.grantedPrivileges.slice() : [],
      rocket: {
        siteId: r.siteId || null,
        siteName: siteNameOf(r.siteId),
        tank: r.tank || 0,
        tankGrade: r.tankGrade || 'water',
        stack: (r.stack || []).map(slotInfo),
        ...unitMassInfo(r),
        // Thrust calc (the same activeNetThrust the move/lift gate uses): net
        // thrust after support-chain + weight-class + solar modifiers, and the
        // fuel steps each burn spends. null when no active thruster.
        netThrust: r.activeThrusterId ? activeNetThrust(r) : null,
        fuelPerBurn: r.activeThrusterId ? thrusterFuelPerBurn(r) : null,
        thrusterName: r.activeThrusterId ? cardLabel(r.activeThrusterId) : null,
      },
      leo: (p.leo || []).map(slotInfo),
      // M1 Freighter big cube + M2 Bernal colonies: same shape as the rocket
      // (siteId/siteName/tank/grade/stack) so the admin map overlay + the
      // manage-state breakdown can read + edit them like any other stack.
      freighter: p.freighter ? {
        cardId: p.freighter.cardId || null,
        name: cardLabel(p.freighter.cardId),
        face: p.freighter.face || 'primary',
        promoted: !!p.freighter.promoted,
        siteId: p.freighter.siteId || null,
        siteName: siteNameOf(p.freighter.siteId),
        tank: p.freighter.tank || 0,
        tankGrade: p.freighter.tankGrade || 'dirt',
        stack: (p.freighter.stack || []).map(slotInfo),
        ...unitMassInfo(p.freighter),
      } : null,
      bernals: (p.bernals || []).map((bn, i) => ({
        index: i,
        cardId: bn.cardId || null,
        name: cardLabel(bn.cardId),
        figure: bn.figure || 'kalpana',
        face: bn.face || 'primary',
        promoted: !!bn.promoted,
        anchored: !!bn.anchored,
        siteId: bn.siteId || null,
        siteName: siteNameOf(bn.siteId),
        tank: bn.tank || 0,
        tankGrade: bn.tankGrade || 'dirt',
        stack: (bn.stack || []).map(slotInfo),
        ...unitMassInfo(bn),
      })),
      outposts: Object.fromEntries(
        Object.entries(p.outposts || {}).map(([k, o]) => [k, {
          letter: o.letter || k,
          siteId: o.siteId || null,   // planner slug, for the admin map overlay
          siteName: siteNameOf(o.siteId),
          tank: o.tank || 0,
          cards: (o.cards || []).map(slotInfo),
        }])
      ),
      hand: (p.hand || []).map((id) => ({ id, name: cardLabel(id) })),
    };
  });
  const assembly = (state.m0 && state.assembly) ? adminAssemblyView(state) : null;
  // Factories (+ colony domes) for the map overlay. Keyed by planner slug, the
  // same id the rocket position + create_factory edit use. Owner name/colour
  // come from the player roster so the marker can be tinted by seat colour.
  const pById = Object.fromEntries((state.players || []).map((p) => [String(p.profileId), p]));
  const colonies = state.colonies || {};
  const factories = Object.entries(state.factories || {}).map(([slug, f]) => {
    const owner = pById[String(f.ownerId)] || null;
    return {
      slug,
      name: siteNameOf(slug),
      ownerId: f.ownerId,
      ownerName: owner ? owner.name : `#${f.ownerId}`,
      ownerColor: (owner && owner.color) || '#888',
      spectralType: f.spectralType || 'C',
      hasColony: !!colonies[slug],
    };
  });
  return {
    seq: st.seq, round: state.round, status: state.status, players, assembly, factories,
    // Module flags, so the editor only offers module content (colonists,
    // Freighter / GW promotion) in rooms that actually run the module.
    m0: !!state.m0, m1: !!state.m1, m2: !!state.m2,
  };
}
// Politics-space label + colour for the admin cube manager. Ideology spaces
// pull their name + colour from the canonical map; Centrist is the neutral hub.
function assemblyPlaceMeta(key) {
  if (key === 'centrist') return { key, name: 'Centrist', color: '#d8d3c4' };
  const ide = IDEOLOGY_BY_KEY[key];
  return { key, name: (ide && ide.name) || key, color: (ide && ide.color) || '#888' };
}
// Assembly cubes grouped by space, each cube tinted with its owner's seat
// colour, for the admin "move a cube" tool. One entry per cube (a space may
// hold several of a player's cubes once factories/Fundraise come into play).
function adminAssemblyView(state) {
  const asm = state.assembly;
  const byId = Object.fromEntries(
    (state.players || []).map((p) => [String(p.profileId), { name: p.name, color: p.color || '#888' }])
  );
  const places = ASSEMBLY_PLACES.map((key) => {
    const meta = assemblyPlaceMeta(key);
    const seats = (asm.delegates && asm.delegates[key]) || {};
    const cubes = [];
    for (const pid of Object.keys(seats)) {
      const n = seats[pid] | 0;
      const who = byId[pid] || { name: `#${pid}`, color: '#888' };
      for (let i = 0; i < n; i++) cubes.push({ profileId: Number(pid), name: who.name, color: who.color });
    }
    return { ...meta, cubes };
  });
  return { places };
}
// Sorted catalog of every card id for the "give arbitrary card" picker,
// filtered to the room's modules: colonists / Bernals only in M2 rooms,
// GW thrusters / Freighters only in M1 rooms.
function cardCatalog(flags = {}) {
  return Object.values(PATENTS_BY_ID)
    .filter((c) => {
      const mod = cardModule(c);
      if (mod === 'm1') return !!flags.m1;
      if (mod === 'm2') return !!flags.m2;
      return true;
    })
    .map((c) => ({ id: c.id, name: c.name || c.id, type: c.type || '' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
// Persist an admin edit through the engine's own seq + op-log + broadcast path
// so every client re-hydrates the change like any other op. The op is attributed
// to the affected player (game_operations.profile_id is NOT NULL); ADMIN_EDIT
// carries a player-facing "Correction:" log line.
function persistAdminEdit(gameId, state, log, actorProfileId) {
  const row = db.prepare('SELECT seq FROM game_states WHERE game_id = ?').get(gameId);
  const nextSeq = (row ? row.seq : 0) + 1;
  const now = nowMs();
  const stateJson = JSON.stringify(state);
  db.transaction(() => {
    db.prepare('UPDATE game_states SET state = ?, seq = ?, updated_at = ? WHERE game_id = ?')
      .run(stateJson, nextSeq, now, gameId);
    db.prepare(
      `INSERT INTO game_operations (game_id, seq, profile_id, kind, payload, log, state_after, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(gameId, nextSeq, actorProfileId, 'ADMIN_EDIT', '{}', log, stateJson, now);
  })();
  publishGame(gameId, (viewerId) => ({
    type: 'game_update',
    gameId,
    seq: nextSeq,
    op: { seq: nextSeq, kind: 'ADMIN_EDIT', log },
    game: gameView(gameId, viewerId),
  }));
  return nextSeq;
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

// Everyone the game is currently waiting on. Nobody during the crew
// draft (any seat may pick; the start DM covers it). A first-player
// handoff -> the chooser. During an auction -> the auctioneer once all
// bidders have acted, else every bidder still on the clock (so a nudge
// can hit one of them or all). Otherwise -> the active seat.
function actorsNeeded(state) {
  if (!state || !Array.isArray(state.players)) return [];
  // Card-draft phase (draft-start): the active seat is on the clock to pick a
  // card, so the game IS waiting on them (unlike the crew draft, where any
  // seat may pick simultaneously and nobody is singled out).
  if (state.draftPhase === 'draft') {
    const d = state.players[state.activeIndex];
    return d ? [d.profileId] : [];
  }
  const draftDone = state.draftPhase === 'play'
    || (state.draftPhase == null && state.players.every((p) => !!p.faction));
  if (!draftDone) return [];
  if (state.pendingFirstPlayer) {
    return state.pendingFirstPlayer.chooserId != null ? [state.pendingFirstPlayer.chooserId] : [];
  }
  const a = state.auction;
  if (a) {
    if (a.awaiting === 'auctioneer') return [a.auctioneerId];
    const acted = a.acted || [];
    return state.players
      .filter((p) => p.profileId !== a.auctioneerId && !acted.includes(p.profileId))
      .map((p) => p.profileId);
  }
  const active = state.players[state.activeIndex];
  return active ? [active.profileId] : [];
}
// The single primary actor (first of actorsNeeded), for the default nudge.
function whoNeedsToAct(state) {
  const n = actorsNeeded(state);
  return n.length ? n[0] : null;
}

// Who a player may MANUALLY nudge. Normally just whoever the game is
// genuinely waiting on (actorsNeeded). During an auction EVERY other
// player is fair game (user: "all players are nudgable during auctions"):
// bids fly in any order and the on-the-clock set churns as people act,
// so let anyone ping anyone - the auctioneer and already-acted bidders
// included - to keep the lot moving.
function nudgeTargets(state) {
  if (state && state.auction) return (state.players || []).map((p) => p.profileId);
  return actorsNeeded(state);
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
// inside this window. One 3h window for everything, auctions included.
const REMIND_COOLDOWN_MS = 3 * 60 * 60 * 1000; // 3 hours

// A single-seat game has no one else to hand off to, so turn / auction / start
// notifications would only ping the player about their own game. Suppress every
// out-of-band notification (DM + webhook) when the table is solo.
function isSoloGame(state) {
  return !state || !Array.isArray(state.players) || state.players.length <= 1;
}

// After an op commits: DM the newly-active player on END_TURN, and the
// other players when an auction opens. (One event => one DM each, so the
// natural cadence is the throttle.) A configured channel webhook also
// gets a one-line post per event so a play group can watch a channel
// instead of relying on per-player DMs.
function dispatchTurnNotifications(gameId, kind, state) {
  try {
    if (!state || !Array.isArray(state.players)) return;
    if (isSoloGame(state)) return;
    const dmOn = discordEnabled();
    const name = gameDisplayName(gameId);
    const url = gameRoomUrl(gameId);
    // A trailing deep link so a notified player can tap straight into the
    // room. Discord renders bare URLs as clickable links in both DMs and
    // channel posts. Empty (no code) just omits the line.
    const jump = url ? `\n▶ Play now: ${url}` : '';
    // Game over: one note to everyone, regardless of which op tripped it.
    if (state.status === 'finished') {
      // Link straight to the finished room so a notified player can tap in
      // and see the final standings.
      const results = url ? `\n🏆 Final standings: ${url}` : '';
      if (dmOn) for (const p of state.players) notifyProfile(p.profileId, 'turn', `🏁 The game in **${name}** is over.${results}`);
      notifyWebhook(`🏁 **${name}** has ended - final standings are in.${results}`);
      return;
    }
    // A round just closed and the leader must name the next first player.
    if (state.pendingFirstPlayer) {
      const chooser = state.players.find((p) => p.profileId === state.pendingFirstPlayer.chooserId);
      if (chooser) {
        if (dmOn) notifyProfile(chooser.profileId, 'turn', `⭐ Pick the next first player in **${name}**.${jump}`);
        notifyWebhook(`⭐ ${chooser.name || 'A player'} is choosing the next first player in **${name}**.${jump}`);
      }
      return;
    }
    // END_TURN and SET_FIRST_PLAYER both hand the turn to a new player.
    if (kind === 'END_TURN' || kind === 'SET_FIRST_PLAYER') {
      const active = state.players[state.activeIndex];
      if (active) {
        if (dmOn) notifyProfile(active.profileId, 'turn', `🛸 It's your turn in **${name}**.${jump}`);
        notifyWebhook(`🛸 ${active.name || 'A player'}'s turn in **${name}**.${jump}`);
      }
    } else if (kind === 'TRADE_OFFER' || kind === 'TRADE_COUNTER') {
      // A trade offer / counter just landed: ping the player now on the clock
      // (the awaiting party) so they can accept, counter, or decline. DM under
      // the 'turn' pref (it's a "your move" nudge), plus a channel post.
      const t = state.trade;
      if (t) {
        const awaitingId = t.awaiting === 'initiator' ? t.initiatorId : t.partnerId;
        const fromId = t.awaiting === 'initiator' ? t.partnerId : t.initiatorId;
        const awaiting = state.players.find((p) => p.profileId === awaitingId);
        const from = state.players.find((p) => p.profileId === fromId);
        const verb = kind === 'TRADE_OFFER' ? 'offered you a trade' : 'sent a counteroffer';
        const cverb = kind === 'TRADE_OFFER' ? 'offered a trade' : 'sent a counteroffer';
        if (awaiting) {
          if (dmOn) notifyProfile(awaiting.profileId, 'turn', `🤝 ${from ? from.name : 'A player'} ${verb} in **${name}**.${jump}`);
          notifyWebhook(`🤝 ${from ? from.name : 'A player'} ${cverb} to ${awaiting.name || 'a player'} in **${name}**.${jump}`);
        }
      }
    } else if (kind === 'AUCTION_START') {
      // Nudge only players the lot is actually waiting on: skips anyone
      // auto-passed, priced out of the bidding, at the hand limit, or at the
      // lot type's ownership cap (auctionWaitingOn's done-set).
      if (dmOn) {
        for (const p of auctionWaitingOn(state)) {
          notifyProfile(p.profileId, 'auction', `🔨 An auction just opened in **${name}** - place your bid.${jump}`);
        }
      }
      notifyWebhook(`🔨 An auction just opened in **${name}** - bidding is live.${jump}`);
    } else if (kind === 'AUCTION_BID' || kind === 'AUCTION_PASS' || kind === 'AUCTION_RESET') {
      // The auction round just came back to someone (user: "whenever the
      // auction round comes to you - both the auctioneer and the
      // bidders"). The post-op auction state tells us who is on the clock.
      const a = state.auction;
      if (a && a.awaiting === 'auctioneer') {
        // Every bidder has acted (bid or passed): nudge the auctioneer to
        // close (user: "if all bidders have bid or passed, nudge the
        // auctioneer to go").
        const auctioneer = state.players.find((p) => p.profileId === a.auctioneerId);
        if (auctioneer) {
          if (dmOn) notifyProfile(auctioneer.profileId, 'auction', `🔨 Every bidder has acted in **${name}** - close the lot (sell to a bidder or keep it).${jump}`);
          notifyWebhook(`🔨 ${auctioneer.name || 'The auctioneer'} can close the lot in **${name}**.${jump}`);
        }
      } else if (a && a.awaiting === 'bidders' && (kind === 'AUCTION_BID' || kind === 'AUCTION_RESET')) {
        // A bid (or an auctioneer reset) reopened the floor: ping everyone
        // who still has to respond (auctionWaitingOn's set, below).
        const isReset = kind === 'AUCTION_RESET';
        const msg = isReset
          ? `🔨 The auctioneer reset the bidding in **${name}** - bid again (higher) or pass.`
          : `🔨 The bid in **${name}** moved - bid again or pass.`;
        if (dmOn) {
          // auctionWaitingOn excludes the auctioneer, everyone who already
          // acted at this floor, the auto-passed, and anyone priced out of
          // the bidding - a player who can no longer afford to respond is
          // never pinged (and never holds up the close).
          for (const p of auctionWaitingOn(state)) {
            notifyProfile(p.profileId, 'auction', `${msg}${jump}`);
          }
        }
        notifyWebhook(`🔨 ${isReset ? 'The auctioneer reset the bidding' : 'The bidding reopened'} in **${name}**.${jump}`);
      }
    } else if (kind === 'PICK_CREW') {
      // The crew draft just closed into the next phase. Ping whoever is now on
      // the clock - the first card-drafter (draft-start) or the first player
      // (random / normal). During the crew draft itself nobody is singled out
      // (any seat may pick), so this only fires on the transition.
      if (state.draftPhase === 'draft') {
        const drafter = state.players[state.activeIndex];
        if (drafter) {
          if (dmOn) notifyProfile(drafter.profileId, 'turn', `🎴 The card draft has begun in **${name}** - pick your first card.${jump}`);
          notifyWebhook(`🎴 The card draft has begun in **${name}** - ${drafter.name || 'the first player'} drafts first.${jump}`);
        }
      } else if (state.draftPhase === 'play') {
        const active = state.players[state.activeIndex];
        if (active) {
          if (dmOn) notifyProfile(active.profileId, 'turn', `🛸 The draft is done in **${name}** - it's your turn.${jump}`);
          notifyWebhook(`🛸 Play has begun in **${name}** - ${active.name || 'the first player'} is up.${jump}`);
        }
      }
    } else if (kind === 'DRAFT_PICK') {
      // Card draft (draft-start): each pick hands the draft to the next seat,
      // or, on the final pick, opens normal play for the first player.
      const active = state.players[state.activeIndex];
      if (active) {
        if (state.draftPhase === 'draft') {
          if (dmOn) notifyProfile(active.profileId, 'turn', `🎴 It's your card-draft pick in **${name}**.${jump}`);
          notifyWebhook(`🎴 ${active.name || 'A player'} is up to draft in **${name}**.${jump}`);
        } else if (state.draftPhase === 'play') {
          if (dmOn) notifyProfile(active.profileId, 'turn', `🛸 The draft is done in **${name}** - it's your turn.${jump}`);
          notifyWebhook(`🛸 Play has begun in **${name}** - ${active.name || 'the first player'} is up.${jump}`);
        }
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
      return sendPage('Access denied',
        'This Discord account is not authorized for the admin panel.'
        + `<br><br><a href="${GAME_URL}" style="color:#7dd3fc;text-decoration:none">Play High Frontier 4: All -&gt;</a>`,
        false);
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
              l.max_rounds  AS maxRounds,
              l.m0 AS m0, l.m1 AS m1, l.m2 AS m2,
              p.name        AS hostName,
              (SELECT COUNT(*) FROM game_players gp WHERE gp.game_id = g.id) AS playerCount,
              (SELECT group_concat(nm) FROM (
                 SELECT p2.name AS nm FROM game_players gpx
                 JOIN profiles p2 ON p2.id = gpx.profile_id
                 WHERE gpx.game_id = g.id
                 ORDER BY gpx.seat ASC)) AS playerNames
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
  // Decorate with whose turn it is + round progress (same as /lobbies/mine) so
  // the Live games list shows the same status without opening the board.
  const pubLastTurn = db.prepare(
    "SELECT MAX(created_at) AS t FROM game_operations WHERE game_id = ? AND kind IN ('END_TURN', 'SET_FIRST_PLAYER')"
  );
  const pubState = db.prepare('SELECT state FROM game_states WHERE game_id = ?');
  for (const row of rows) {
    try {
      const st = pubState.get(row.gameId);
      if (st) {
        const state = JSON.parse(st.state);
        const players = Array.isArray(state.players) ? state.players : [];
        const active = players[state.activeIndex];
        if (active) { row.activePlayerName = active.name; row.activePlayerColor = active.color || null; }
        if (state.pendingFirstPlayer) {
          const chooser = players.find((pl) => pl.profileId === state.pendingFirstPlayer.chooserId);
          row.pendingFirstPlayerName = chooser ? chooser.name : null;
        }
        row.round = state.round;
        row.maxRounds = state.maxRounds != null ? state.maxRounds : row.maxRounds;
        row.turn = state.turn | 0;   // 0-based slot within the round (12 per round)
      }
    } catch { /* ignore a malformed state blob */ }
    const last = pubLastTurn.get(row.gameId);
    row.lastTurnEndedAt = (last && last.t) || null;
  }
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
  // Debug dry-run: with debug:true the client previews what an op WOULD do
  // (the human-readable log carries the fuel-step cost + origin/dest, plus
  // the actor's tank before/after) WITHOUT persisting or broadcasting it.
  // applyOperation works on a clone, so prevState is still the before-state.
  if (body.debug === true) {
    if (!result.ok) return res.json({ ok: false, debug: true, error: result.error, detail: result.detail });
    const find = (st) => (Array.isArray(st.players) ? st.players.find((p) => p.profileId === req.profile.id) : null);
    const before = find(prevState), after = find(result.state);
    return res.json({
      ok: true, debug: true, log: result.log || '',
      tankBefore: before && before.rocket ? before.rocket.tank : null,
      tankAfter:  after  && after.rocket  ? after.rocket.tank  : null,
      siteAfter:  after  && after.rocket  ? after.rocket.siteId : null,
      calc: result.calc || null,   // full burn-math breakdown
    });
  }
  if (!result.ok) return res.status(409).json({ error: result.error, detail: result.detail });

  const nextSeq = row.seq + 1;
  const now = nowMs();
  // END_TURN is the commit: it becomes the new undo floor (the next
  // player can never unwind into the turn that just ended). Auction
  // ops advance the floor too: an auction moves aqua / decks / hands
  // that are not on the per-turn undo stack, so letting undo replay
  // across one would silently drop those effects. TRADE ops are the
  // same - a finalized trade moves two players' aqua / cards / water /
  // abilities off the active player's undo stack. PICK_CREW is also
  // permanent (session-setup), and SET_FIRST_PLAYER opens a fresh
  // round-leader turn, so both commit the same way.
  const commitsTurn = kind === 'END_TURN' || kind === 'PICK_CREW' || kind === 'SET_FIRST_PLAYER'
    || kind === 'PLACE_SENIORITY'
    || kind.startsWith('AUCTION_') || kind.startsWith('TRADE_');
  // When the floor moves up to THIS op, every action the active player took
  // earlier this turn is now below it and can no longer be undone. Clear the
  // per-turn undo stack in the SAME snapshot we persist, so a later UNDO
  // rebuilds from a base whose turnActions match what is actually replayable.
  // Without this, an UNDO rebuilds from this snapshot (which already contains
  // those committed actions) yet still tries to replay them on top, double-
  // applying and failing with undo_replay_failed - e.g. a committed SITE_REFUEL
  // replayed onto a base that already refueled rejects with already_refueled,
  // which is exactly the "undo is stuck" report. (AUCTION_START already clears
  // the stack engine-side; this covers the rest of the committing ops uniformly,
  // including TRADE_* and the later auction ops.)
  if (commitsTurn) {
    result.state.turnActions = [];
    result.state.turnRedo = [];
  }
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
    if (commitsTurn) {
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
// target per REMIND_COOLDOWN_MS window (auctions included). Not a game op
// (no board mutation, no seq bump) - just a DM + a cooldown row the gameView
// surfaces so every client can show who was nudged and when.
app.post('/games/:id/remind', requireProfile, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
  if (!isGamePlayer(id, req.profile.id)) return res.status(403).json({ error: 'not_a_player' });
  const g = db.prepare('SELECT status FROM games WHERE id = ?').get(id);
  if (!g) return res.status(404).json({ error: 'not_found' });
  if (g.status !== 'active') return res.status(409).json({ error: 'not_active' });
  const st = db.prepare('SELECT state FROM game_states WHERE game_id = ?').get(id);
  const state = st ? JSON.parse(st.state) : null;
  // Who the sender may nudge (never themselves). Normally whoever is on
  // the clock; during an auction it's every other player.
  const needed = nudgeTargets(state).filter((pid) => pid !== req.profile.id);
  if (!needed.length) return res.status(409).json({ error: 'nobody_to_nudge' });
  const inAuction = !!(state && state.auction);
  const cd = REMIND_COOLDOWN_MS;

  // Resolve the requested set: one specific player (must be nudgable),
  // everyone (all=true, for auction rounds), or the primary actor by
  // default.
  const body = req.body || {};
  let targets;
  if (body.all) {
    targets = needed;
  } else if (body.waiting) {
    // Only the players the round is genuinely waiting on. During an
    // auction that's the bidders who have not bid, passed, or auto-passed
    // this lot (a.acted holds everyone who has responded; autoPassed
    // survives a floor reopen). Off-auction it's just the active seat.
    // Always a subset of `needed`.
    const a = state.auction;
    if (a) {
      const acted = a.acted || [];
      const auto = a.autoPassed || [];
      targets = needed.filter((pid) =>
        pid !== a.auctioneerId && !acted.includes(pid) && !auto.includes(pid));
    } else {
      targets = [needed[0]];
    }
  } else if (body.targetId != null) {
    const tid = Number(body.targetId);
    if (!needed.includes(tid)) return res.status(409).json({ error: 'not_actionable' });
    targets = [tid];
  } else {
    targets = [needed[0]];
  }

  const now = nowMs();
  const nm = gameDisplayName(id);
  const url = gameRoomUrl(id);
  const jump = url ? `\n▶ Play now: ${url}` : '';
  const ins = db.prepare(
    `INSERT INTO turn_reminders (game_id, target_id, sender_id, sent_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(game_id, target_id)
       DO UPDATE SET sender_id = excluded.sender_id, sent_at = excluded.sent_at`
  );
  const getPrev = db.prepare('SELECT sent_at AS sentAt FROM turn_reminders WHERE game_id = ? AND target_id = ?');
  const nudged = [];
  const skipped = [];
  for (const tid of targets) {
    const target = state.players.find((p) => p.profileId === tid);
    const tname = target ? target.name : null;
    const prev = getPrev.get(id, tid);
    if (prev && now - prev.sentAt < cd) {
      skipped.push({ targetId: tid, targetName: tname, sentAt: prev.sentAt, retryAfterMs: cd - (now - prev.sentAt) });
      continue;
    }
    ins.run(id, tid, req.profile.id, now);
    const why = inAuction ? `the auction is waiting on you in **${nm}**` : `it's your turn in **${nm}**`;
    notifyProfile(tid, 'turn', `👋 ${req.profile.name} nudged you - ${why}.${jump}`);
    nudged.push({ targetId: tid, targetName: tname, sentAt: now });
  }
  if (nudged.length) {
    const names = nudged.map((n) => n.targetName || 'a player').join(', ');
    notifyWebhook(`👋 ${req.profile.name} nudged ${names} in **${nm}**.${jump}`);
  }
  res.json({ ok: true, nudged, skipped, cooldownMs: cd });
});

// Operation log, optionally only the ops after a given seq (catch-up
// for a reconnecting client that missed broadcasts).
app.get('/games/:id/ops', requireProfile, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
  // Spectators may read the mission log of any public (open, active) game -
  // the same visibility rule as the game snapshot itself. HF4 is open
  // information; the one secret (planned routes) never enters this list.
  if (!canViewGame(id, req.profile.id)) return res.status(403).json({ error: 'not_a_player' });
  // One page = the 100 most recent ops. Three reads:
  //   (none)    - the newest page (the mission log's first load / poll).
  //   ?before=N - the next page DOWN: the newest 100 ops with seq < N
  //               (drives the mission log's infinite scroll into history).
  //   ?after=N  - catch-up: the oldest 100 ops with seq > N, ascending
  //               (for a client resuming from a known seq; unused today).
  // The old query was ORDER BY seq ASC LIMIT - in a long game (> one page)
  // that returned only the FIRST ops ever, so the mission log froze on
  // early-game entries and recent activity never loaded.
  const PAGE = 100;
  const after = Number(req.query.after) || 0;
  const before = Number(req.query.before) || 0;
  const SELECT = `SELECT go.seq, go.kind, go.payload, go.log, go.created_at AS createdAt,
            go.profile_id AS profileId, p.name AS profileName
     FROM game_operations go
     JOIN profiles p ON p.id = go.profile_id`;
  // Planned-route bookkeeping never enters the mission log: a route is the
  // one piece of SECRET information in the game (the payload carries the
  // path), and even the owner's own entries are just planner chatter.
  const SKIP = `go.kind NOT IN ('SET_ROUTE', 'CLEAR_ROUTE')`;
  let rows;
  if (after > 0) {
    rows = db
      .prepare(`${SELECT} WHERE go.game_id = ? AND ${SKIP} AND go.seq > ? ORDER BY go.seq ASC LIMIT ${PAGE}`)
      .all(id, after);
  } else if (before > 0) {
    rows = db
      .prepare(`${SELECT} WHERE go.game_id = ? AND ${SKIP} AND go.seq < ? ORDER BY go.seq DESC LIMIT ${PAGE}`)
      .all(id, before);
    rows.reverse();   // back to ASC - entries are always oldest-first on the wire
  } else {
    rows = db
      .prepare(`${SELECT} WHERE go.game_id = ? AND ${SKIP} ORDER BY go.seq DESC LIMIT ${PAGE}`)
      .all(id);
    rows.reverse();
  }
  // Does history continue below this window? Drives the client's
  // infinite scroll ("load older" stops when the log bottoms out).
  const oldestSeq = rows.length ? rows[0].seq : null;
  const hasMore = oldestSeq != null && !!db
    .prepare(`SELECT 1 FROM game_operations go WHERE go.game_id = ? AND ${SKIP} AND go.seq < ? LIMIT 1`)
    .get(id, oldestSeq);
  res.json({
    hasMore,
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
  // Spectators may scrub public games like they read the snapshot; the
  // per-viewer route redaction below keeps the one secret (planned routes)
  // out of the history for spectators AND opponents alike.
  if (!canViewGame(id, req.profile.id)) return res.status(403).json({ error: 'not_a_player' });
  const state = stateAtSeq(id, seq);
  if (!state) return res.status(404).json({ error: 'not_found' });
  res.json({ seq, state: redactRoutes(state, req.profile.id) });
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
  // Liveness: the heartbeat sweep below pings every socket and drops any
  // that didn't answer since the last sweep. Seed alive on connect and
  // refresh on every protocol PONG (browsers and the ws client answer
  // server pings automatically, so no client change is needed).
  ws.isAlive = true;
  ws._lastPong = Date.now();
  ws.on('pong', () => { ws.isAlive = true; ws._lastPong = Date.now(); });
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
        // App-level keepalive from js/ws.js; also refreshes liveness.
        ws.isAlive = true;
        ws._lastPong = nowMs();
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

// Heartbeat: PING every socket on an interval and terminate any that did
// not answer since the last sweep. A half-open connection (a silently
// dropped mobile link, a backgrounded tab, a proxy timeout) otherwise sits
// in the channel sets forever, receiving broadcasts into the void and
// leaking memory. The previous version read ws._lastPong, which nothing
// ever set, so it never dropped anyone. Interval is configurable so tests
// can run it fast.
const WS_HEARTBEAT_MS = Number(process.env.WS_HEARTBEAT_MS) || 30_000;
const wsHeartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* socket already closing */ }
  }
}, WS_HEARTBEAT_MS);
wsHeartbeat.unref();
wss.on('close', () => clearInterval(wsHeartbeat));

// ----- Site notes + tags (player-driven location annotations) -----
//
// Pooled across ALL games (no game scope). site_id is the location's display id
// (the popup "id: ..."). Any signed-in player can read the aggregate, post a
// message or stamp a tag, and remove their own. Admin endpoints (below) view /
// edit / delete everything and export.
const SITE_ID_RE = /^[\w.\-:]{1,80}$/;

function aggregateSiteAnnotations(siteId, meId) {
  const rows = db.prepare(
    `SELECT id, kind, body, profile_id, author_name, created_at
       FROM site_annotations WHERE site_id = ? ORDER BY created_at ASC`
  ).all(siteId);
  const tagMap = new Map();
  const messages = [];
  for (const r of rows) {
    if (r.kind === 'tag') {
      const t = tagMap.get(r.body) || { tag: r.body, count: 0, mine: false };
      t.count += 1;
      if (meId != null && r.profile_id === meId) t.mine = true;
      tagMap.set(r.body, t);
    } else {
      messages.push({
        id: r.id, body: r.body, author: r.author_name || 'player',
        mine: meId != null && r.profile_id === meId, createdAt: r.created_at,
      });
    }
  }
  return { tags: [...tagMap.values()].sort((a, b) => b.count - a.count), messages };
}

app.get('/sites/:siteId/annotations', requireProfile, (req, res) => {
  const siteId = String(req.params.siteId || '');
  if (!SITE_ID_RE.test(siteId)) return res.status(400).json({ error: 'bad_site' });
  res.json(aggregateSiteAnnotations(siteId, req.profile.id));
});

app.post('/sites/:siteId/annotations', requireProfile, (req, res) => {
  const siteId = String(req.params.siteId || '');
  if (!SITE_ID_RE.test(siteId)) return res.status(400).json({ error: 'bad_site' });
  const body = req.body || {};
  const kind = body.kind === 'tag' ? 'tag' : 'message';
  const siteName = String(body.siteName || '').slice(0, 80) || null;
  if (kind === 'tag') {
    const tag = normaliseTag(body.tag != null ? body.tag : body.body);
    if (!tag) return res.status(400).json({ error: 'bad_tag' });
    const dup = db.prepare(
      `SELECT id FROM site_annotations WHERE site_id=? AND profile_id=? AND kind='tag' AND body=?`
    ).get(siteId, req.profile.id, tag);
    if (!dup) {
      db.prepare(
        `INSERT INTO site_annotations (site_id, site_name, profile_id, author_name, kind, body, created_at)
         VALUES (?,?,?,?,'tag',?,?)`
      ).run(siteId, siteName, req.profile.id, req.profile.name, tag, nowMs());
    }
  } else {
    const text = String(body.body || '').trim().slice(0, 500);
    if (!text) return res.status(400).json({ error: 'empty' });
    db.prepare(
      `INSERT INTO site_annotations (site_id, site_name, profile_id, author_name, kind, body, created_at)
       VALUES (?,?,?,?,'message',?,?)`
    ).run(siteId, siteName, req.profile.id, req.profile.name, text, nowMs());
  }
  res.json(aggregateSiteAnnotations(siteId, req.profile.id));
});

// Remove one of MY tags from a site.
app.post('/sites/:siteId/untag', requireProfile, (req, res) => {
  const siteId = String(req.params.siteId || '');
  if (!SITE_ID_RE.test(siteId)) return res.status(400).json({ error: 'bad_site' });
  const tag = normaliseTag((req.body || {}).tag);
  if (tag) {
    db.prepare(`DELETE FROM site_annotations WHERE site_id=? AND profile_id=? AND kind='tag' AND body=?`)
      .run(siteId, req.profile.id, tag);
  }
  res.json(aggregateSiteAnnotations(siteId, req.profile.id));
});

// Delete one of MY messages.
app.delete('/sites/:siteId/annotations/:annId', requireProfile, (req, res) => {
  const siteId = String(req.params.siteId || '');
  const annId = Number(req.params.annId);
  db.prepare(`DELETE FROM site_annotations WHERE id=? AND site_id=? AND profile_id=?`)
    .run(annId, siteId, req.profile.id);
  res.json(aggregateSiteAnnotations(siteId, req.profile.id));
});

// ----- Admin: site notes viewer / editor / export -----
function allSiteAnnotationRows() {
  return db.prepare(
    `SELECT id, site_id, site_name, author_name, kind, body, created_at, updated_at
       FROM site_annotations ORDER BY created_at DESC, id DESC`
  ).all();
}

// ----- Admin: server tags (canonical solar-map marker flags per node) -----
//
// "Server tags" are the authoritative marker flags the map renderer reads from
// data/node-tags.js (lander / half / hazard / aerobrake), as opposed to the
// player-submitted site_annotations ("what players think"). An admin edits them
// on /admin/site-notes + /admin/site-tags; the edit persists in the node_tags
// table (DB) and is exported back to data/node-tag-overrides.json for git.

// The editable marker flags and the data/site-tags.js tag body each maps to.
const SERVER_TAG_FIELDS = [
  { key: 'lander',     body: 'lander-burn', label: 'Lander-burn' },
  { key: 'half',       body: 'half-burn',   label: 'Half-burn' },
  { key: 'hazard',     body: 'hazard',      label: 'Hazard' },
  { key: 'aerobrake',  body: 'aero-break',  label: 'Aero-break' },
  // A valid Home Bernal anchor site: where a colonist Bernal may anchor as the
  // crew's home / spawn point. Not a burn marker - a site-capability flag.
  { key: 'homeBernal', body: 'home-bernal', label: 'Home Bernal' },
];

// A space's synodic season: it can only be ENTERED during that phase of the
// Sunspot Cycle turn clock. Single-select (a space has one season, or none).
// Colours mirror js/game/render.js SYNODIC_COLOURS so the picker reads like
// the board.
const SEASON_OPTIONS = [
  { key: 'red',    label: 'Red',    color: '#ef4444' },
  { key: 'yellow', label: 'Yellow', color: '#facc15' },
  { key: 'blue',   label: 'Blue',   color: '#60a5fa' },
  // Rat Frontier adds two seasons.
  { key: 'green',  label: 'Green',       color: '#22c55e' },
  { key: 'beige',  label: 'Brown-beige', color: '#c2a878' },
];
const SEASON_KEYS = SEASON_OPTIONS.map((s) => s.key);

// Shared CSS for the server-tag checkbox editor, injected into both admin pages.
const SERVER_TAG_CSS = `
.st-edit{margin:8px 0 2px;padding:8px 10px;background:#0b1120;border:1px solid #243049;border-radius:8px}
.st-row{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:8px;align-items:center}
.stbox{display:flex;gap:5px;align-items:center;font-size:13px;color:#cdd6f4;background:none;border:0;padding:0;cursor:pointer}
.st-season{display:flex;gap:12px;align-items:center;font-size:13px;color:#8fa6d8}
.st-dot{display:inline-block;width:10px;height:10px;border-radius:50%;border:1px solid #00000055}
.st-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.st-save{background:#16324a;border-color:#2b557a;color:#cfe8ff}
.st-reset{background:#2a1622;border-color:#5a2436;color:#f6b8c8;font-size:12px;padding:3px 8px}
.st-edited{color:#7dd3fc;font-size:12px}
.node{border:1px solid #2a3450;border-radius:10px;padding:10px 14px;margin:10px 0;background:#0e1322}
.node h3{margin:0 0 2px}
.pager{display:flex;gap:16px;align-items:center;margin:12px 0}`;

// The admin-edited override row for a node, or null if never edited.
function nodeTagRow(siteId) {
  return db.prepare(
    `SELECT site_id, site_name, lander, half, hazard, aerobrake, homeBernal, season, updated_at
       FROM node_tags WHERE site_id=?`
  ).get(siteId) || null;
}

// Effective server tags for a node: the admin override if it exists (edited),
// else the baseline flags from the generated data/node-tags.js (default).
function effectiveServerTags(siteId) {
  const row = nodeTagRow(siteId);
  const src = row || STATIC_NODE_TAGS[siteId] || {};
  return {
    lander: !!src.lander, half: !!src.half, hazard: !!src.hazard, aerobrake: !!src.aerobrake,
    homeBernal: !!src.homeBernal,
    season: SEASON_KEYS.includes(src.season) ? src.season : '',
    edited: !!row, updated_at: row ? row.updated_at : null,
  };
}

// Upsert a node's server tags from posted checkbox flags. Aerobrake implies
// hazard, the same rule scripts/gen-node-tags.mjs enforces. Season is a single
// optional value ('red' / 'yellow' / 'blue').
function saveNodeTag(siteId, siteName, body) {
  const f = {
    lander: body.lander ? 1 : 0, half: body.half ? 1 : 0,
    hazard: body.hazard ? 1 : 0, aerobrake: body.aerobrake ? 1 : 0,
    homeBernal: body.homeBernal ? 1 : 0,
  };
  if (f.aerobrake) f.hazard = 1;
  const season = SEASON_KEYS.includes(body.season) ? body.season : null;
  db.prepare(
    `INSERT INTO node_tags (site_id, site_name, lander, half, hazard, aerobrake, homeBernal, season, updated_at)
       VALUES (@site_id,@site_name,@lander,@half,@hazard,@aerobrake,@homeBernal,@season,@updated_at)
     ON CONFLICT(site_id) DO UPDATE SET
       site_name=excluded.site_name, lander=excluded.lander, half=excluded.half,
       hazard=excluded.hazard, aerobrake=excluded.aerobrake, homeBernal=excluded.homeBernal,
       season=excluded.season, updated_at=excluded.updated_at`
  ).run({ site_id: siteId, site_name: (siteName || '').slice(0, 80) || null, ...f, season, updated_at: nowMs() });
}

// Only the admin-EDITED overrides, as the data/node-tag-overrides.json shape:
// id2 -> { lander, half, hazard, aerobrake, season } with only the set values
// kept (an empty {} means the node was explicitly cleared to no marker/season).
function editedNodeTagOverrides() {
  const rows = db.prepare(
    `SELECT site_id, lander, half, hazard, aerobrake, homeBernal, season FROM node_tags ORDER BY site_id ASC`
  ).all();
  const out = {};
  for (const r of rows) {
    const rec = {};
    if (r.lander) rec.lander = true;
    if (r.half) rec.half = true;
    if (r.hazard) rec.hazard = true;
    if (r.aerobrake) rec.aerobrake = true;
    if (r.homeBernal) rec.homeBernal = true;
    if (SEASON_KEYS.includes(r.season)) rec.season = r.season;
    out[r.site_id] = rec;
  }
  return out;
}

// Render the per-node server-tag checkbox editor. Both admin pages share it;
// `back` is the same-origin path to return to after save/reset.
function serverTagEditor(siteId, siteName, back) {
  const t = effectiveServerTags(siteId);
  const boxes = SERVER_TAG_FIELDS.map((f) =>
    `<label class="stbox"><input type="checkbox" name="${f.key}"${t[f.key] ? ' checked' : ''}> ${f.label}</label>`).join('');
  const seasons = `<span class="st-season">Season (Sunspot phase):
    <label class="stbox"><input type="radio" name="season" value=""${!t.season ? ' checked' : ''}> none</label>
    ${SEASON_OPTIONS.map((s) =>
      `<label class="stbox"><input type="radio" name="season" value="${s.key}"${t.season === s.key ? ' checked' : ''}> <span class="st-dot" style="background:${s.color}"></span>${s.label}</label>`).join('')}
    </span>`;
  const when = t.updated_at ? ' · ' + new Date(t.updated_at).toISOString().slice(0, 16).replace('T', ' ') : '';
  const badge = t.edited
    ? `<span class="st-edited">edited${when}</span>`
    : `<span class="muted">default (from map data)</span>`;
  const reset = t.edited
    ? `<form method="post" action="/admin/node-tags/reset" style="display:inline">
         <input type="hidden" name="site_id" value="${esc(siteId)}">
         <input type="hidden" name="back" value="${esc(back)}">
         <button class="st-reset" title="Remove this override; revert to the map-data default">reset</button></form>`
    : '';
  return `<form method="post" action="/admin/node-tags/save" class="st-edit">
      <input type="hidden" name="site_id" value="${esc(siteId)}">
      <input type="hidden" name="site_name" value="${esc(siteName || '')}">
      <input type="hidden" name="back" value="${esc(back)}">
      <div class="st-row">${boxes}</div>
      <div class="st-row">${seasons}</div>
      <div class="st-actions"><button class="st-save">Save node</button> ${badge} ${reset}</div>
    </form>`;
}

// Save / reset a node's server tags (shared by both admin pages; `back` returns
// the caller to the page + query they came from).
function safeAdminBack(v) {
  return (typeof v === 'string' && /^\/admin\/site-(notes|tags)(\?|#|$)/.test(v)) ? v : '/admin/site-tags';
}
app.post('/admin/node-tags/save', requireAdmin, (req, res) => {
  const b = req.body || {};
  const siteId = String(b.site_id || '').trim();
  if (SITE_ID_RE.test(siteId)) saveNodeTag(siteId, String(b.site_name || ''), b);
  res.redirect(safeAdminBack(b.back));
});
app.post('/admin/node-tags/reset', requireAdmin, (req, res) => {
  const b = req.body || {};
  db.prepare(`DELETE FROM node_tags WHERE site_id=?`).run(String(b.site_id || '').trim());
  res.redirect(safeAdminBack(b.back));
});

// Export ONLY the admin-edited server tags, in the data/node-tag-overrides.json
// shape scripts/gen-node-tags.mjs merges. Commit that file + re-run the
// generator to bake these edits into data/node-tags.js.
app.get('/admin/site-tags/export.json', requireAdmin, (req, res) => {
  res.set('content-disposition', 'attachment; filename="node-tag-overrides.json"')
    .json(editedNodeTagOverrides());
});

// JSON export of every annotation (for programmatic use).
app.get('/admin/site-notes.json', requireAdmin, (req, res) => {
  res.json({ annotations: allSiteAnnotationRows() });
});

// CSV export.
app.get('/admin/site-notes.csv', requireAdmin, (req, res) => {
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const head = 'id,site_id,site_name,author,kind,body,created_at,updated_at';
  const lines = allSiteAnnotationRows().map((r) =>
    [r.id, r.site_id, r.site_name, r.author_name, r.kind, r.body, r.created_at, r.updated_at].map(cell).join(','));
  res.type('text/csv').set('content-disposition', 'attachment; filename="site-notes.csv"')
    .send([head, ...lines].join('\n'));
});

// Admin actions: edit a body, delete a row, or add a tag/message to a site.
app.post('/admin/site-notes/:annId/edit', requireAdmin, (req, res) => {
  const annId = Number(req.params.annId);
  const text = String((req.body || {}).body || '').trim().slice(0, 500);
  if (text) db.prepare(`UPDATE site_annotations SET body=?, updated_at=? WHERE id=?`).run(text, nowMs(), annId);
  res.redirect('/admin/site-notes');
});
app.post('/admin/site-notes/:annId/delete', requireAdmin, (req, res) => {
  db.prepare(`DELETE FROM site_annotations WHERE id=?`).run(Number(req.params.annId));
  res.redirect('/admin/site-notes');
});
app.post('/admin/site-notes/wipe', requireAdmin, (req, res) => {
  db.prepare(`DELETE FROM site_annotations`).run();
  res.redirect('/admin/site-notes');
});
app.post('/admin/site-notes/add', requireAdmin, (req, res) => {
  const b = req.body || {};
  const siteId = String(b.site_id || '').trim();
  if (!SITE_ID_RE.test(siteId)) return res.redirect('/admin/site-notes');
  const kind = b.kind === 'tag' ? 'tag' : 'message';
  const value = kind === 'tag' ? normaliseTag(b.body) : String(b.body || '').trim().slice(0, 500);
  if (value) {
    db.prepare(
      `INSERT INTO site_annotations (site_id, site_name, profile_id, author_name, kind, body, created_at)
       VALUES (?,?,NULL,'admin',?,?,?)`
    ).run(siteId, String(b.site_name || '').slice(0, 80) || null, kind, value, nowMs());
  }
  res.redirect('/admin/site-notes');
});

// Admin HTML page: every site WITH data (no empty sites), tags + messages, with
// inline edit / delete / add forms and the JSON / CSV download links.
app.get('/admin/site-notes', (req, res) => {
  if (!adminFromRequest(req, res)) return res.type('html').send(adminLoginPage());
  const rows = allSiteAnnotationRows();
  const bySite = new Map();
  for (const r of rows) {
    if (!bySite.has(r.site_id)) bySite.set(r.site_id, { name: r.site_name, tags: [], messages: [] });
    const g = bySite.get(r.site_id);
    if (!g.name && r.site_name) g.name = r.site_name;
    (r.kind === 'tag' ? g.tags : g.messages).push(r);
  }
  const when = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : '');
  const sections = [...bySite.entries()].map(([siteId, g]) => {
    const tagRows = g.tags.map((t) =>
      `<li><code>${esc(t.body)}</code> <span class="muted">by ${esc(t.author_name || '?')} · ${when(t.created_at)}</span>
        <form method="post" action="/admin/site-notes/${t.id}/delete" style="display:inline"><button>delete</button></form></li>`).join('');
    const msgRows = g.messages.map((m) =>
      `<li><form method="post" action="/admin/site-notes/${m.id}/edit" style="display:flex;gap:6px;align-items:center">
          <input name="body" value="${esc(m.body)}" style="flex:1;min-width:280px">
          <span class="muted">${esc(m.author_name || '?')} · ${when(m.created_at)}${m.updated_at ? ' (edited)' : ''}</span>
          <button>save</button></form>
        <form method="post" action="/admin/site-notes/${m.id}/delete" style="display:inline"><button>delete</button></form></li>`).join('');
    return `<section class="site">
      <h3>${esc(g.name || siteId)} <code>${esc(siteId)}</code></h3>
      <h4>Server tags <span class="muted">(map markers)</span></h4>${serverTagEditor(siteId, g.name, '/admin/site-notes')}
      <h4>Player tags (${g.tags.length})</h4><ul>${tagRows || '<li class="muted">none</li>'}</ul>
      <h4>Messages (${g.messages.length})</h4><ul>${msgRows || '<li class="muted">none</li>'}</ul>
      <form method="post" action="/admin/site-notes/add" style="margin-top:6px">
        <input type="hidden" name="site_id" value="${esc(siteId)}">
        <input type="hidden" name="site_name" value="${esc(g.name || '')}">
        <select name="kind"><option value="tag">tag</option><option value="message">message</option></select>
        <input name="body" placeholder="value" style="min-width:240px"><button>add</button>
      </form>
    </section>`;
  }).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Site notes</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:14px ui-sans-serif,system-ui,sans-serif;background:#07060f;color:#e6e9ff;margin:0;padding:24px}
h1{color:#7dd3fc;margin:0 0 4px}.muted{color:#8b90b8;font-size:12px}
a{color:#7dd3fc}code{background:#161d33;padding:1px 5px;border-radius:4px;color:#a8d8c0}
.site{border:1px solid #2a3450;border-radius:10px;padding:12px 14px;margin:14px 0;background:#0e1322}
h3{margin:0 0 8px}h4{margin:10px 0 4px;color:#8fa6d8;font-size:12px;text-transform:uppercase}
ul{list-style:none;margin:0;padding:0}li{margin:3px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
input,select,button{font:inherit;background:#161d33;color:#e6e9ff;border:1px solid #2a3450;border-radius:6px;padding:5px 8px}
button{cursor:pointer}.dl{margin:10px 0;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.dl .wipe button{background:#5a1620;border-color:#7a2230;color:#ffd0d0}${SERVER_TAG_CSS}</style></head><body>
<h1>Site notes &amp; tags</h1>
<p class="muted">${bySite.size} location${bySite.size === 1 ? '' : 's'} with player data (empty locations are hidden), newest first. Edit a node's <b>server tags</b> (the map markers) inline, or <a href="/admin/site-tags">search every node on the site-tags page</a>.</p>
<div class="dl"><a href="/admin/site-notes.json">⬇ JSON</a> <a href="/admin/site-notes.csv">⬇ CSV</a> <a href="/admin">← dashboard</a>
  <form class="wipe" method="post" action="/admin/site-notes/wipe" style="display:inline;margin-left:auto" onsubmit="return confirm('Wipe ALL site notes? This deletes every tag and message and cannot be undone.')"><button>🗑 Wipe all</button></form></div>
${sections || '<p class="muted">No site notes yet.</p>'}
<script>
(function(){
  function flash(el){ if(!el) return; var o=el.textContent; el.textContent='✓'; setTimeout(function(){ el.textContent=o; },900); }
  // Intercept every admin form on this page so an edit / delete never navigates
  // (which dumped the admin back at the top of a long list). delete removes its
  // row in place, a message save flashes, and the structural actions (add / wipe
  // / server-tag save+reset) re-render from the server response while KEEPING the
  // scroll position. Delegated on document so it survives the in-place re-render.
  document.addEventListener('submit', async function(e){
    var form = e.target;
    if (!form || form.tagName !== 'FORM') return;
    var action = form.getAttribute('action') || '';
    if (!/^\\/admin\\/(site-notes|node-tags)\\b/.test(action)) return;
    if (e.defaultPrevented) return;            // a confirm() (wipe) was cancelled
    e.preventDefault();
    var y = window.scrollY, btn = form.querySelector('button');
    if (btn) btn.disabled = true;
    var r;
    try { r = await fetch(action, { method:'POST', body:new URLSearchParams(new FormData(form)) }); }
    catch (_){ if (btn) btn.disabled = false; alert('Network error - not saved.'); return; }
    if (btn) btn.disabled = false;
    if (!r.ok){ alert('Action failed (' + r.status + ').'); return; }
    if (/\\/delete$/.test(action)){ var li = form.closest('li'); (li || form.closest('.site') || form).remove(); return; }
    if (/\\/edit$/.test(action)){ flash(btn); return; }
    // add / wipe / node-tags save+reset: re-render from the server HTML in place,
    // preserving the scroll position so the admin stays where they were.
    var html = await r.text();
    var nb = new DOMParser().parseFromString(html, 'text/html').body;
    if (nb){ document.body.innerHTML = nb.innerHTML; window.scrollTo(0, y); }
  });
})();
</script>
</body></html>`;
  res.type('html').send(html);
});

// Admin HTML page: search ANY solar-map node and edit its server tags. Lists
// the edited overrides at the top, plus a search box over every node id; the
// export link downloads ONLY the edited overrides for re-applying to git.
app.get('/admin/site-tags', (req, res) => {
  if (!adminFromRequest(req, res)) return res.type('html').send(adminLoginPage());
  const q = String(req.query.q || '').trim().toLowerCase().slice(0, 40);
  let page = Math.max(0, parseInt(req.query.page, 10) || 0);

  // Name + type for the searchable nodes: NAMED_SITES (planets / asteroids /
  // comets) as the base, then any names players / admins gave via annotations.
  const nameById = new Map();
  const typeById = new Map();
  for (const s of NAMED_SITES) { nameById.set(s.id2, s.name); typeById.set(s.id2, s.type); }
  for (const n of PLANNER_NODES) typeById.set(n.id2, n.type);
  for (const r of db.prepare(`SELECT site_id, site_name FROM site_annotations WHERE site_name IS NOT NULL`).all())
    if (!nameById.has(r.site_id)) nameById.set(r.site_id, r.site_name);
  for (const r of db.prepare(`SELECT site_id, site_name FROM node_tags WHERE site_name IS NOT NULL`).all())
    nameById.set(r.site_id, r.site_name);

  const editedIds = db.prepare(`SELECT site_id FROM node_tags ORDER BY site_id ASC`).all().map((r) => r.site_id);

  // Bulk effective-tags lookup (override row if any, else the static map-data
  // baseline) so we can filter all nodes without a per-node query.
  const overrideRows = new Map(db.prepare(
    `SELECT site_id, lander, half, hazard, aerobrake, homeBernal, season FROM node_tags`).all().map((r) => [r.site_id, r]));
  const effOf = (id) => {
    const src = overrideRows.get(id) || STATIC_NODE_TAGS[id] || {};
    return { lander: !!src.lander, half: !!src.half, hazard: !!src.hazard, aerobrake: !!src.aerobrake,
      homeBernal: !!src.homeBernal,
      season: SEASON_KEYS.includes(src.season) ? src.season : '' };
  };

  // Tag filters (the f= checkboxes). Markers are AND-ed; seasons are OR-ed.
  // Search can be blank when filters are selected.
  const selected = [].concat(req.query.f || []).map(String).filter(Boolean);
  const markerFilters = SERVER_TAG_FIELDS.map((x) => x.key).filter((k) => selected.includes(k));
  const seasonFilters = selected.filter((v) => v.startsWith('season-')).map((v) => v.slice(7)).filter((s) => SEASON_KEYS.includes(s));
  const filterQS = selected.map((v) => '&f=' + encodeURIComponent(v)).join('');
  const passesFilter = (id) => {
    if (!markerFilters.length && !seasonFilters.length) return true;
    const e = effOf(id);
    for (const m of markerFilters) if (!e[m]) return false;
    if (seasonFilters.length && !seasonFilters.includes(e.season)) return false;
    return true;
  };

  // Candidate universe: every routing node + every named site, plus any
  // annotation / override id not in either. Empty query = browse them all.
  const seen = new Set();
  const allIds = [];
  for (const n of PLANNER_NODES) if (!seen.has(n.id2)) { allIds.push(n.id2); seen.add(n.id2); }
  for (const s of NAMED_SITES) if (!seen.has(s.id2)) { allIds.push(s.id2); seen.add(s.id2); }
  for (const id of nameById.keys()) if (!seen.has(id)) { allIds.push(id); seen.add(id); }
  // Search matches the node id OR its name (so "mars" finds "Mars: Arsia Mons").
  const matchIds = (q
    ? allIds.filter((id) => id.toLowerCase().includes(q) || (nameById.get(id) || '').toLowerCase().includes(q))
    : allIds).filter(passesFilter).sort();

  const PAGE_SIZE = 50;
  const total = matchIds.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (page >= pages) page = pages - 1;
  const shown = matchIds.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const baseQS = 'q=' + encodeURIComponent(q) + filterQS;
  const pageUrl = (p) => '/admin/site-tags?' + baseQS + '&page=' + p;
  const back = pageUrl(page);

  const nodeCard = (siteId) => {
    const type = typeById.get(siteId);
    const nm = nameById.get(siteId) || '';
    return `<section class="node">
      <h3>${nm ? esc(nm) + ' ' : ''}<code>${esc(siteId)}</code>${type ? ' <span class="muted">' + esc(type) + '</span>' : ''}</h3>
      ${serverTagEditor(siteId, nm, back)}
    </section>`;
  };

  const pager = pages > 1
    ? `<div class="pager">
        ${page > 0 ? `<a href="${pageUrl(page - 1)}">‹ prev</a>` : '<span class="muted">‹ prev</span>'}
        <span class="muted">page ${page + 1} of ${pages}</span>
        ${page < pages - 1 ? `<a href="${pageUrl(page + 1)}">next ›</a>` : '<span class="muted">next ›</span>'}
      </div>`
    : '';

  // Filter checkboxes (markers + the three seasons), carrying current state.
  const filterChips = [
    ...SERVER_TAG_FIELDS.map((f) => ({ value: f.key, label: f.label, dot: '' })),
    ...SEASON_OPTIONS.map((s) => ({ value: 'season-' + s.key, label: s.label + ' season', dot: s.color })),
  ].map((c) =>
    `<label class="stbox"><input type="checkbox" name="f" value="${c.value}"${selected.includes(c.value) ? ' checked' : ''}>${c.dot ? ` <span class="st-dot" style="background:${c.dot}"></span>` : ' '}${c.label}</label>`).join('');

  const editedBlock = editedIds.length
    ? `<h2>Edited server tags (${editedIds.length})</h2>${editedIds.map(nodeCard).join('')}`
    : '';
  const filterNote = selected.length ? ' · filtered by ' + selected.length + ' tag' + (selected.length === 1 ? '' : 's') : '';
  const browseBlock = `<h2>${q ? 'Search "' + esc(q) + '"' : 'All nodes'}${filterNote}: ${total} node${total === 1 ? '' : 's'}</h2>
       ${pager}
       ${shown.length ? shown.map(nodeCard).join('') : '<p class="muted">No nodes match.</p>'}
       ${shown.length ? pager : ''}`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Site tags</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:14px ui-sans-serif,system-ui,sans-serif;background:#07060f;color:#e6e9ff;margin:0;padding:24px}
h1{color:#7dd3fc;margin:0 0 4px}h2{color:#8fa6d8;font-size:14px;margin:18px 0 6px}.muted{color:#8b90b8;font-size:12px}
a{color:#7dd3fc}code{background:#161d33;padding:1px 5px;border-radius:4px;color:#a8d8c0}
input,select,button{font:inherit;background:#161d33;color:#e6e9ff;border:1px solid #2a3450;border-radius:6px;padding:5px 8px}
button{cursor:pointer}.dl{margin:10px 0;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.search{margin:12px 0;display:flex;gap:8px;align-items:center}.search input{min-width:240px}${SERVER_TAG_CSS}</style></head><body>
<h1>Site tags</h1>
<p class="muted">Set the canonical <b>server tags</b> on any node: the map markers (lander / hazard / aerobrake) and the <b>season</b> (a Sunspot-phase space, enterable only in its Red / Yellow / Blue phase). Edits save per node and persist on the server; they reach the game only once exported and committed to git.</p>
<div class="dl"><a href="/admin/site-tags/export.json">⬇ Export edited server tags (JSON)</a> <a href="/admin/site-notes">← site notes</a> <a href="/admin">← dashboard</a></div>
<p class="muted">Re-apply to git: save the export as <code>data/node-tag-overrides.json</code>, run <code>node scripts/gen-node-tags.mjs</code>, then commit <code>data/node-tags.js</code>.</p>
<form class="search" method="get" action="/admin/site-tags">
  <input name="q" value="${esc(q)}" placeholder="search by id or name (e.g. mars, icarus, ceres, burn-0hh45); blank = all" autofocus>
  <button>Search</button>${q ? ' <a href="/admin/site-tags">clear</a>' : ''}</form>
${editedBlock}
${browseBlock}
</body></html>`;
  res.type('html').send(html);
});

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
  // sign-in screen instead of the dashboard. Loading the dashboard slides
  // the session, so an admin who keeps the tab active never gets bounced.
  if (!adminFromRequest(req, res)) {
    return res.type('html').send(adminLoginPage());
  }
  // Timestamps render in US Central time (CST/CDT, DST-aware via the IANA zone)
  // instead of UTC. Queries return raw ms; this formats at render time.
  const CT_FMT = new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false,timeZoneName:'short'});
  const fmtCt = (ms) => (ms==null ? '' : CT_FMT.format(new Date(Number(ms))));
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

  // Tabbed dashboard: each table paginates server-side (OFFSET). 10 rows/page on
  // mobile, 20 elsewhere. A COUNT per dataset drives the pager's page totals.
  const isMobileUA = /Mobi|Android|iPhone|iPad|iPod/i.test(req.headers['user-agent'] || '');
  const PER = isMobileUA ? 10 : 20;
  const pageNum = (key) => Math.max(1, parseInt(req.query[key], 10) || 1);
  const ppN = pageNum('pp'); // players
  const rpN = pageNum('rp'); // multiplayer rooms
  const spN = pageNum('sp'); // solo rooms
  const cpN = pageNum('cp'); // chat
  const ipN = pageNum('ip'); // direct invites
  const lpN = pageNum('lp'); // invite links
  const epN = pageNum('ep'); // ended (cancelled / finished) games
  // Player sort: 'joined' (newest account first, default) or 'seen' (last seen).
  const ps = req.query.ps === 'seen' ? 'seen' : 'joined';

  // pageHref(param, n): rebuild the current query string, override one page
  // param (or ps), and append the tab hash so the link lands on the right tab.
  const pageHref = (param, n, tab) => {
    const params = new URLSearchParams();
    ['pp', 'rp', 'cp', 'ip', 'lp', 'ps'].forEach((k) => {
      if (req.query[k] != null && req.query[k] !== '') params.set(k, String(req.query[k]));
    });
    params.set(param, String(n));
    return `/admin?${params.toString()}#${tab}`;
  };
  // pager(param, n, total, tab): First / Prev / "page X of Y · N results" /
  // Next / Last under a table, computed from the dataset's total row count.
  const pager = (param, n, total, tab) => {
    const pages = Math.max(1, Math.ceil(total / PER));
    const cur = Math.min(n, pages);
    const link = (p, label, disabled) => disabled
      ? `<span class="pg-btn pg-off">${label}</span>`
      : `<a class="pg-btn" href="${esc(pageHref(param, p, tab))}">${label}</a>`;
    return `<nav class="pager">`
      + link(1, '« First', cur<=1) + link(cur-1, '‹ Prev', cur<=1)
      + `<span class="pg-info">Page ${cur} of ${pages} · ${total} result${total===1?'':'s'}</span>`
      + link(cur+1, 'Next ›', cur>=pages) + link(pages, 'Last »', cur>=pages)
      + `</nav>`;
  };

  const profilesTotal = db.prepare(`SELECT COUNT(*) c FROM profiles`).get().c;
  const profilesRaw = db
    .prepare(
      `SELECT p.id, p.name,
              p.created_at   AS created_ms,
              p.last_seen_at AS seen_ms,
              (SELECT COUNT(*) FROM tokens t WHERE t.profile_id = p.id) AS devices,
              (SELECT COUNT(*) FROM lobby_members lm WHERE lm.profile_id = p.id) AS tables,
              (SELECT COUNT(*) FROM chat_messages cm WHERE cm.profile_id = p.id) AS chats,
              (SELECT da.username   FROM discord_accounts da WHERE da.profile_id = p.id) AS discord_name,
              (SELECT da.discord_id FROM discord_accounts da WHERE da.profile_id = p.id) AS discord_id
       FROM profiles p
       ORDER BY ${ps === 'seen' ? 'p.last_seen_at' : 'p.created_at'} DESC
       LIMIT ${PER + 1} OFFSET ${(ppN - 1) * PER}`
    )
    .all();
  const profilesHasNext = profilesRaw.length > PER;
  const profiles = profilesRaw.slice(0, PER);

  // Active rooms only - cancelled ones live in their own modal (below). Split
  // into Multiplayer (max_players > 1) and Solo (max_players = 1) and order each
  // by LAST ACTIVITY (the game's latest state update = last move/op made; falls
  // back to room-created for rooms with no game yet).
  const LAST_ACTIVE = `COALESCE((SELECT gs.updated_at FROM game_states gs JOIN games g ON g.id = gs.game_id
                WHERE g.lobby_id = l.id ORDER BY gs.updated_at DESC LIMIT 1), l.created_at)`;
  const ROOM_SELECT = `SELECT l.id, l.code, l.name, l.status, l.join_policy, l.max_players,
              l.max_rounds, l.m0, l.m1, l.m2, l.ceo_solo,
              ${LAST_ACTIVE} AS active_ms,
              p.name AS host_name,
              (SELECT COUNT(*) FROM lobby_members lm WHERE lm.lobby_id = l.id) AS members,
              (SELECT g.id FROM games g WHERE g.lobby_id = l.id AND g.status = 'active'
               ORDER BY g.created_at DESC LIMIT 1) AS game_id
       FROM lobbies l
       JOIN profiles p ON p.id = l.host_id
       WHERE l.status != 'cancelled'
         AND NOT EXISTS (SELECT 1 FROM games g2 WHERE g2.lobby_id = l.id AND g2.status = 'finished')`;
  const mpLobbiesRaw = db.prepare(
    `${ROOM_SELECT} AND l.max_players > 1 ORDER BY ${LAST_ACTIVE} DESC LIMIT ${PER + 1} OFFSET ${(rpN - 1) * PER}`
  ).all();
  const mpLobbiesHasNext = mpLobbiesRaw.length > PER;
  const mpLobbies = mpLobbiesRaw.slice(0, PER);
  const soloLobbiesRaw = db.prepare(
    `${ROOM_SELECT} AND l.max_players = 1 ORDER BY ${LAST_ACTIVE} DESC LIMIT ${PER + 1} OFFSET ${(spN - 1) * PER}`
  ).all();
  const soloLobbiesHasNext = soloLobbiesRaw.length > PER;
  const soloLobbies = soloLobbiesRaw.slice(0, PER);
  // Decorate each room that has a live game with its round + whose turn it is,
  // parsed from the game state (same read as the Live games list).
  const roomStateStmt = db.prepare('SELECT state FROM game_states WHERE game_id = ?');
  const decorateRoom = (r) => {
    if (!r.game_id) return;
    try {
      const st = roomStateStmt.get(r.game_id);
      if (!st) return;
      const state = JSON.parse(st.state);
      const players = Array.isArray(state.players) ? state.players : [];
      const active = players[state.activeIndex];
      r.round = state.round;
      r.maxRounds = state.maxRounds != null ? state.maxRounds : r.max_rounds;
      r.turn = state.turn | 0;   // 0-based slot within the round (12 per round)
      r.activeName = active ? active.name : null;
    } catch { /* ignore a malformed state blob */ }
  };
  mpLobbies.forEach(decorateRoom);
  soloLobbies.forEach(decorateRoom);
  const mpTotal = db.prepare(
    `SELECT COUNT(*) c FROM lobbies l WHERE l.status!='cancelled' AND NOT EXISTS (SELECT 1 FROM games g2 WHERE g2.lobby_id=l.id AND g2.status='finished') AND l.max_players>1`
  ).get().c;
  const soloTotal = db.prepare(
    `SELECT COUNT(*) c FROM lobbies l WHERE l.status!='cancelled' AND NOT EXISTS (SELECT 1 FROM games g2 WHERE g2.lobby_id=l.id AND g2.status='finished') AND l.max_players=1`
  ).get().c;

  // Ended games: cancelled rooms OR rooms whose game finished. Most-recently
  // ended first (cancelled -> cancelled_at; finished -> the game's finished_at;
  // legacy rows fall back to created_at). Shown in a popup modal, not the main
  // list. PAGINATED like every other admin list (it used to hard-cap at the
  // last 10, hiding older ended games). A cancelled lobby's game is also
  // cancelled (never 'finished'), so the two cases don't overlap.
  const endedWhere = `WHERE l.status = 'cancelled'
          OR EXISTS (SELECT 1 FROM games g WHERE g.lobby_id = l.id AND g.status = 'finished')`;
  const endedTotal = db.prepare(`SELECT COUNT(*) c FROM lobbies l ${endedWhere}`).get().c;
  const endedRaw = db
    .prepare(
      `SELECT l.id, l.code, l.name, l.max_players, p.name AS host_name,
              (SELECT g.id FROM games g WHERE g.lobby_id = l.id AND g.status = 'finished'
                 ORDER BY g.finished_at DESC LIMIT 1) AS game_id,
              CASE WHEN l.status = 'cancelled' THEN 'cancelled' ELSE 'finished' END AS kind,
              COALESCE(
                l.cancelled_at,
                (SELECT MAX(g.finished_at) FROM games g WHERE g.lobby_id = l.id AND g.status = 'finished'),
                l.created_at) AS ended_ms
       FROM lobbies l
       JOIN profiles p ON p.id = l.host_id
       ${endedWhere}
       ORDER BY COALESCE(
         l.cancelled_at,
         (SELECT MAX(g.finished_at) FROM games g WHERE g.lobby_id = l.id AND g.status = 'finished'),
         l.created_at) DESC
       LIMIT ${PER + 1} OFFSET ${(epN - 1) * PER}`
    )
    .all();
  const endedHasNext = endedRaw.length > PER;
  const endedLobbies = endedRaw.slice(0, PER);

  const chatTotal = db.prepare(`SELECT COUNT(*) c FROM chat_messages`).get().c;
  const chatsRaw = db
    .prepare(
      `SELECT cm.id, cm.body,
              cm.created_at AS sent_ms,
              p.name AS profile_name,
              l.name AS lobby_name, l.code AS lobby_code
       FROM chat_messages cm
       JOIN profiles p ON p.id = cm.profile_id
       LEFT JOIN lobbies l ON l.id = cm.lobby_id
       ORDER BY cm.created_at DESC
       LIMIT ${PER + 1} OFFSET ${(cpN - 1) * PER}`
    )
    .all();
  const chatsHasNext = chatsRaw.length > PER;
  const chats = chatsRaw.slice(0, PER);

  const invitesTotal = db.prepare(
    `SELECT COUNT(*) c
       FROM direct_invites di
       JOIN profiles fp ON fp.id = di.from_id
       JOIN profiles tp ON tp.id = di.to_id
       JOIN lobbies  l  ON l.id  = di.lobby_id`
  ).get().c;
  const invitesRaw = db
    .prepare(
      `SELECT di.id, di.status,
              di.created_at AS sent_ms,
              fp.name AS from_name, tp.name AS to_name,
              l.name AS lobby_name, l.code AS lobby_code
       FROM direct_invites di
       JOIN profiles fp ON fp.id = di.from_id
       JOIN profiles tp ON tp.id = di.to_id
       JOIN lobbies  l  ON l.id  = di.lobby_id
       ORDER BY di.created_at DESC
       LIMIT ${PER + 1} OFFSET ${(ipN - 1) * PER}`
    )
    .all();
  const invitesHasNext = invitesRaw.length > PER;
  const invites = invitesRaw.slice(0, PER);

  const linksTotal = db.prepare(`SELECT COUNT(*) c FROM invite_links`).get().c;
  const linksRaw = db
    .prepare(
      `SELECT il.code, il.single_use, il.used_count,
              il.created_at AS created_ms,
              il.expires_at AS expires_ms,
              cp.name AS by_name, l.name AS lobby_name, l.code AS lobby_code
       FROM invite_links il
       JOIN profiles cp ON cp.id = il.created_by
       JOIN lobbies  l  ON l.id  = il.lobby_id
       ORDER BY il.created_at DESC
       LIMIT ${PER + 1} OFFSET ${(lpN - 1) * PER}`
    )
    .all();
  const linksHasNext = linksRaw.length > PER;
  const links = linksRaw.slice(0, PER);

  const wsCount = wss ? wss.clients.size : 0;
  const wsAuthed = wss
    ? Array.from(wss.clients).filter((c) => c._profile).length
    : 0;

  const profileRows = profiles.map((r) => {
    const linked = !!r.discord_id;
    // The name is the entry point: click it to open the user settings modal,
    // which holds every edit action (device code / Discord reassign / unlink /
    // delete). The Discord cell is display-only now.
    const discordCell = linked
      ? `🔗 ${esc(r.discord_name || r.discord_id)}`
      : '<span class="muted">not linked</span>';
    return `
    <tr>
      <td data-label="Name"><button class="btn-user linklike" data-pid="${r.id}" data-pname="${esc(r.name)}" data-linked="${linked ? 1 : 0}" data-dname="${esc(r.discord_name || r.discord_id || '')}">@${esc(r.name)}</button></td>
      <td data-label="Created">${esc(fmtCt(r.created_ms))}</td>
      <td data-label="Last seen">${esc(fmtCt(r.seen_ms))}</td>
      <td data-label="Devices" class="num">${r.devices}</td>
      <td data-label="Tables" class="num">${r.tables}</td>
      <td data-label="Chats" class="num">${r.chats}</td>
      <td data-label="Discord" class="discord-cell">${discordCell}</td>
    </tr>
  `;
  }).join('') || '<tr><td colspan=7><em>No profiles yet.</em></td></tr>';

  // Scenario + module chips for a room. The scenario (CEO Solitaire) leads with
  // its own gold chip so "who is playing what" reads at a glance; the module
  // flags (M0 / M1 / M2) follow, shown only for those that are on.
  const roomModulesHtml = (r) => {
    const mods = [];
    if (r.ceo_solo) mods.push('<span class="mod-chip mod-ceo">👔 CEO</span>');
    if (r.m0) mods.push('<span class="mod-chip">M0</span>');
    if (r.m1) mods.push('<span class="mod-chip">M1</span>');
    if (r.m2) mods.push('<span class="mod-chip">M2</span>');
    return mods.length ? mods.join(' ') : '<span class="muted">base</span>';
  };
  // Turn cell: round X / Y plus whose turn it is, or a dash when no game yet.
  const roomTurnHtml = (r) => {
    if (!r.game_id || r.round == null) return '<span class="muted">-</span>';
    // round.slot/maxRounds.totalSlots (slot 1-based, 12 slots per round), e.g. 1.1/5.12.
    const slot = (r.turn | 0) + 1;
    const tn = r.maxRounds ? `${r.round}.${slot}/${r.maxRounds}.12` : `${r.round}.${slot}`;
    const who = r.activeName ? ` <span class="muted">@${esc(r.activeName)}</span>` : '';
    return `${esc(tn)}${who}`;
  };
  const roomRowsHtml = (arr, emptyMsg) => arr.map((r) => `
    <tr class="room-row" data-search="${esc((String(r.name || '') + ' ' + String(r.code || '')).toLowerCase())}">
      <td data-label="Code"><code>${esc(r.code)}</code></td>
      <td data-label="Name"><button class="btn-room linklike" data-lid="${r.id}" data-gid="${r.game_id || ''}" data-lname="${esc(r.name)}" data-lcode="${esc(r.code)}" data-status="active">${esc(r.name)}</button></td>
      <td data-label="Host">@${esc(r.host_name)}</td>
      <td data-label="Status"><span class="pill pill-${esc(r.status)}">${esc(r.status)}</span></td>
      <td data-label="Turn">${roomTurnHtml(r)}</td>
      <td data-label="Modules">${roomModulesHtml(r)}</td>
      <td data-label="Policy">${esc(r.join_policy)}</td>
      <td data-label="Players" class="num">${r.members} / ${r.max_players}</td>
      <td data-label="Last active">${esc(fmtCt(r.active_ms))}</td>
    </tr>
  `).join('') || `<tr class="empty-row"><td colspan=9><em>${esc(emptyMsg)}</em></td></tr>`;
  const mpLobbyRows = roomRowsHtml(mpLobbies, 'No active multiplayer rooms.');
  const soloLobbyRows = roomRowsHtml(soloLobbies, 'No active solo rooms.');

  const endedRows = endedLobbies.map((r) => `
    <tr>
      <td data-label="Code"><code>${esc(r.code)}</code></td>
      <td data-label="Name"><button class="btn-room linklike" data-lid="${r.id}" data-gid="${r.game_id || ''}" data-lname="${esc(r.name)}" data-lcode="${esc(r.code)}" data-status="${r.kind === 'finished' ? 'finished' : 'cancelled'}">${esc(r.name)}</button></td>
      <td data-label="Host">@${esc(r.host_name)}</td>
      <td data-label="Players" class="num">${r.max_players}</td>
      <td data-label="Status"><span class="pill pill-${r.kind === 'finished' ? 'finished' : 'cancelled'}">${r.kind}</span></td>
      <td data-label="Ended">${esc(fmtCt(r.ended_ms))}</td>
    </tr>
  `).join('') || '<tr><td colspan=6><em>No canceled or finished games.</em></td></tr>';

  const chatRows = chats.map((r) => `
    <tr>
      <td data-label="When">${esc(fmtCt(r.sent_ms))}</td>
      <td data-label="Who">@${esc(r.profile_name)}</td>
      <td data-label="Lobby">${r.lobby_code ? `<code>${esc(r.lobby_code)}</code> ${esc(r.lobby_name)}` : '<em>(deleted)</em>'}</td>
      <td data-label="Body">${esc(r.body)}</td>
    </tr>
  `).join('') || '<tr><td colspan=4><em>No chat messages yet.</em></td></tr>';

  const inviteRows = invites.map((r) => `
    <tr>
      <td data-label="Sent">${esc(fmtCt(r.sent_ms))}</td>
      <td data-label="Status"><span class="pill pill-${esc(r.status)}">${esc(r.status)}</span></td>
      <td data-label="From / To">@${esc(r.from_name)} → @${esc(r.to_name)}</td>
      <td data-label="Lobby"><code>${esc(r.lobby_code)}</code> ${esc(r.lobby_name)}</td>
    </tr>
  `).join('') || '<tr><td colspan=4><em>No direct invites yet.</em></td></tr>';

  const linkRows = links.map((r) => `
    <tr>
      <td data-label="Code"><code>${esc(r.code)}</code></td>
      <td data-label="Created">${esc(fmtCt(r.created_ms))}</td>
      <td data-label="Expires">${r.expires_ms ? esc(fmtCt(r.expires_ms)) : '-'}</td>
      <td data-label="Mode">${r.single_use ? 'single-use' : 'unlimited'}</td>
      <td data-label="Uses" class="num">${r.used_count}</td>
      <td data-label="Created by">@${esc(r.by_name)}</td>
      <td data-label="Lobby"><code>${esc(r.lobby_code)}</code> ${esc(r.lobby_name)}</td>
    </tr>
  `).join('') || '<tr><td colspan=7><em>No invite links yet.</em></td></tr>';

  res.set('content-type', 'text/html; charset=utf-8');
  res.send(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>High Frontier admin</title>
<link rel="stylesheet" href="/css/cards.css">
<style>
  :root { color-scheme: dark; }
  *{box-sizing:border-box}
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
  .tabbar{display:flex;gap:6px;flex-wrap:wrap;margin:14px 0}
  .tabbar button{background:#15122a;border:1px solid #2a2740;color:#cdd7f0;border-radius:8px;padding:7px 14px;font:inherit;cursor:pointer}
  .tabbar button.tab-active{background:#2a2150;color:#fff;border-color:#5a4a9a}
  .tab-panel[hidden]{display:none}
  .pager{display:flex;gap:8px;align-items:center;margin:8px 0;font-size:13px}
  .pager a{color:#7dd3fc}
  .sort-active{font-weight:700;text-decoration:underline}
  code{background:#0f172a;padding:1px 6px;border-radius:4px;font-size:12px;color:#7dd3fc}
  em{color:#5a5f80;font-style:normal}
  .pill{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:600}
  .mod-chip{display:inline-block;padding:1px 6px;border-radius:6px;font-size:10px;font-weight:700;letter-spacing:.5px;background:#312a52;color:#c4b5fd;border:1px solid #4c3f7a}
  .mod-chip.mod-ceo{background:#3a2f14;color:#fbbf24;border-color:#6b5416}
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
  .muted{color:#6b7194}
  input[type=text]{background:#07060f;color:#e6e9ff;border:1px solid #2a2740;border-radius:4px;padding:4px 8px;font:inherit}
  .ws-info{display:inline-block;background:#0c0a16;border:1px solid #1e293b;padding:8px 14px;border-radius:6px;margin-left:auto;font-size:12px;color:#8b90b8}
  .ws-info strong{color:#4ade80;font-weight:600}
  .header-row{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
  .discord-link{background:none;border:none;padding:0;margin:0;color:#7dd3fc;cursor:pointer;font:inherit;font-size:13px;text-decoration:underline;text-underline-offset:2px}
  .discord-link:hover{background:none;border:none;color:#a5e4ff}
  .reassign-picker select{background:#07060f;color:#e6e9ff;border:1px solid #2a2740;border-radius:4px;padding:3px 6px;font:inherit;font-size:12px}
  .rooms-toolbar{display:flex;align-items:center;gap:10px;margin:6px 0 10px;flex-wrap:wrap}
  #room-search{flex:1 1 240px;max-width:340px;background:#07060f;color:#e6e9ff;border:1px solid #2a2740;border-radius:6px;padding:6px 10px;font:inherit}
  #show-cancelled{background:#1a1430;color:#cdd7f0;border:1px solid #3a2740;border-radius:6px;padding:6px 12px;font:inherit;cursor:pointer}
  #show-cancelled:hover{background:#26193f}
  .modal-overlay{position:fixed;inset:0;background:rgba(3,2,10,.72);display:flex;align-items:center;justify-content:center;padding:24px;z-index:50}
  .modal-overlay[hidden]{display:none}
  .modal-box{background:#0c0a16;border:1px solid #2a2740;border-radius:12px;width:min(820px,94vw);max-height:86vh;display:flex;flex-direction:column;overflow:hidden}
  /* Full-screen state-management modal. */
  .modal-box-full{width:100vw;max-width:100vw;height:100vh;max-height:100vh;border-radius:0;border:none}
  .modal-overlay:has(.modal-box-full){padding:0}
  /* Clickable name links (open the user / room modal). */
  .linklike{background:none;border:none;padding:0;margin:0;color:#7dd3fc;cursor:pointer;font:inherit;text-decoration:underline;text-underline-offset:2px}
  .linklike:hover{color:#a5e4ff}
  /* User / room modal action lists. */
  .um-line{margin:0 0 12px;color:#aab0d4}
  .um-actions{display:flex;flex-direction:column;gap:8px;align-items:stretch}
  .um-actions button{width:100%;text-align:left;padding:10px 12px;font-size:14px}
  .um-actions .reassign-picker{flex-wrap:wrap}
  .modal-head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #1e1b2e}
  .modal-head h3{margin:0;font-size:16px}
  .modal-x{background:none;border:none;color:#9aa0c4;font-size:22px;line-height:1;cursor:pointer;padding:0 4px}
  .modal-x:hover{color:#fff}
  .modal-body{overflow:auto;padding:8px 16px 16px}
  .ge-player{border:1px solid #26233c;border-radius:10px;padding:10px 12px;margin:0 0 12px}
  .ge-player>h4{margin:0 0 8px;font-size:14px;display:flex;align-items:center;gap:8px}
  .ge-dot{width:10px;height:10px;border-radius:50%;display:inline-block;border:1px solid #00000055}
  .ge-stats{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 10px;font-size:12px}
  .ge-stats input{width:64px;background:#0a0814;border:1px solid #2a2740;color:#e6e9ff;border-radius:6px;padding:3px 6px}
  .ge-stats select{background:#0a0814;border:1px solid #2a2740;color:#e6e9ff;border-radius:6px;padding:3px 6px}
  .ge-teleport{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 10px;font-size:12px}
  .ge-teleport strong{color:#7dd3fc}
  .ge-teleport input{flex:1 1 200px;min-width:140px;background:#0a0814;border:1px solid #2a2740;color:#e6e9ff;border-radius:6px;padding:3px 6px}
  .ge-loc{margin:6px 0}
  .ge-loc>.ge-loc-h{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#7dd3fc;margin:0 0 3px}
  .ge-loc-mass{font-size:11px;color:#a7b0d8;margin:0 0 4px;font-variant-numeric:tabular-nums}
  .ge-card-mass{font-size:11px;color:#8a93bd;font-variant-numeric:tabular-nums}
  .ge-card{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:3px 0;border-bottom:1px solid #16142400}
  .ge-card .ge-name{flex:1 1 180px;min-width:120px;cursor:pointer;text-decoration:underline dotted #3a3f63;text-underline-offset:2px}
  .ge-card .ge-name:hover{color:#7dd3fc;text-decoration-color:#7dd3fc}
  .ge-card select{background:#0a0814;border:1px solid #2a2740;color:#e6e9ff;border-radius:6px;padding:2px 5px;font-size:12px}
  /* Card preview popup: renders the REAL client card (both faces) so an admin
     can read the full card, not just its name. */
  .ge-cardview-overlay{position:fixed;inset:0;background:rgba(4,3,12,.74);display:flex;align-items:center;justify-content:center;z-index:120;padding:18px}
  .ge-cardview-box{background:#0c0a18;border:1px solid #2a2740;border-radius:12px;padding:16px;max-width:min(640px,96vw);max-height:92vh;overflow:auto;box-shadow:0 18px 60px rgba(0,0,0,.6)}
  .ge-cardview-h{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}
  .ge-cardview-h strong{color:#e6e9ff;font-size:15px}
  .ge-cardview-faces{display:flex;gap:14px;flex-wrap:wrap;justify-content:center}
  .ge-cardview-face{display:flex;flex-direction:column;align-items:center;gap:6px}
  .ge-cardview-face>span{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#5a5f80}
  .ge-cardview-close{background:#1a1730;border:1px solid #2a2740;color:#e6e9ff;border-radius:7px;padding:5px 12px;cursor:pointer;font-size:13px}
  .ge-empty{color:#6b7194;font-size:12px;font-style:italic}
  .ge-give{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px;padding-top:8px;border-top:1px dashed #2a2740}
  .ge-give select{flex:1 1 200px;background:#0a0814;border:1px solid #2a2740;color:#e6e9ff;border-radius:6px;padding:3px 6px}
  #game-edit-body button{font-size:12px;padding:3px 8px}
  .ge-msg{font-size:12px;margin:0 0 8px;min-height:14px}
  .ge-msg.ok{color:#86efac}
  .ge-msg.err{color:#fda4af}
  .ge-asm{border:1px solid #26233c;border-radius:10px;padding:10px 12px;margin:0 0 12px}
  .ge-asm>h4{margin:0 0 4px;font-size:14px}
  .ge-asm-hint{margin:0 0 10px;font-size:12px;color:#8b90b8}
  .ge-asm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
  .ge-asm-space{border:1px solid #2a2740;border-radius:8px;overflow:hidden;cursor:pointer;background:#0a0814}
  .ge-asm-space:hover{border-color:#7dd3fc}
  .ge-asm-space-h{font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#10101a;padding:4px 8px;text-shadow:0 1px 0 rgba(255,255,255,.35)}
  .ge-asm-cubes{display:flex;flex-wrap:wrap;gap:5px;padding:8px;min-height:34px}
  .ge-asm-empty{color:#6b7194;font-size:11px;font-style:italic;align-self:center}
  .ge-asm-cube{border:1px solid #00000066;border-radius:5px;color:#0c0a16;font-weight:700;font-size:11px !important;padding:4px 8px !important;cursor:pointer;text-shadow:0 1px 0 rgba(255,255,255,.4);box-shadow:0 1px 2px rgba(0,0,0,.4)}
  .ge-asm-cube:hover{filter:brightness(1.12)}
  .ge-asm-cube.sel{outline:3px solid #7dd3fc;outline-offset:1px;transform:translateY(-1px)}
  /* Admin map: mounts the REAL client MapRenderer (js/admin/admin-map.js). The
     host needs an explicit size; clicking a node pops the .ge-wiz wizard. */
  .ge-map{border:1px solid #26233c;border-radius:10px;padding:10px 12px;margin:0 0 12px;background:#0a0814}
  .ge-map h4{margin:0 0 8px;font-size:14px}
  .ge-map-tools{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:0 0 8px;font-size:12px;color:#9aa0c8}
  .ge-locate{display:inline-flex;gap:5px;align-items:center}
  .ge-locate button{background:#1a1730;border:1px solid #2a2740;color:#e6e9ff;border-radius:6px;padding:3px 8px;font-size:12px;cursor:pointer}
  .ge-locate button:hover{background:#262247}
  .ge-actor{display:flex;flex-wrap:wrap;gap:5px;align-items:center}
  .ge-actor-chip{border:1px solid #00000066;border-radius:5px;color:#0c0a16;font-weight:700;font-size:11px;padding:3px 8px;cursor:pointer;text-shadow:0 1px 0 rgba(255,255,255,.4);opacity:.5}
  .ge-actor-chip.sel{opacity:1;outline:2px solid #7dd3fc;outline-offset:1px}
  .ge-map-wrap{position:relative;width:100%;overflow:hidden;border-radius:8px;border:1px solid #1c1930}
  #ge-map-host{width:100%;height:520px;background:radial-gradient(120% 90% at 50% 45%,#141232 0%,#070611 75%)}
  /* Map action wizard (popped on a node click). Above the manage-state modal. */
  .ge-wiz-overlay{position:fixed;inset:0;z-index:60;background:rgba(4,3,10,.6);display:flex;align-items:center;justify-content:center}
  .ge-wiz-box{background:#12101f;border:1px solid #3a3760;border-radius:12px;padding:14px;min-width:280px;max-width:min(360px,92vw);box-shadow:0 12px 40px rgba(0,0,0,.6)}
  .ge-wiz-h{font-size:15px;font-weight:700;color:#eef0ff;margin-bottom:2px}
  .ge-wiz-sub{font-size:12px;color:#9aa0c8;margin:0 0 10px}
  .ge-wiz-loc{font-size:12px;color:#7fe3f5;margin:0 0 8px;font-weight:600}
  .ge-locate-item .muted{font-weight:400}
  .ge-wiz-box button{display:block;width:100%;text-align:left;background:#1a1730;border:1px solid #2a2740;color:#e6e9ff;border-radius:8px;padding:9px 12px;font-size:13px;margin:6px 0;cursor:pointer}
  .ge-wiz-box button:hover{background:#262247}
  .ge-wiz-box button.danger{background:#3a1620;border-color:#5a2230;color:#ffd0d0}
  .ge-wiz-box button.ge-wiz-cancel{background:transparent;border-color:#2a2740;color:#9aa0c8;text-align:center}
  /* Mobile: stack each table row as a card (each cell shows its column label),
     give controls real tap targets, and let the modal use the full width. */
  @media (max-width:700px){
    body{padding:12px}
    h1{font-size:19px}
    .sub{margin-bottom:12px}
    table{display:block;width:100%;border:none}
    thead{position:absolute;left:-9999px}              /* hide header row visually */
    tbody{display:block}
    tbody tr{display:block;border:1px solid #2a2740;border-radius:10px;padding:6px 10px;margin:0 0 10px;background:#0c0a16}
    tbody td{display:flex;justify-content:space-between;gap:12px;border:none;padding:5px 0;white-space:normal;text-align:right}
    tbody td::before{content:attr(data-label);color:#8b90b8;font-size:12px;font-weight:600;text-align:left;flex:0 0 auto}
    tbody td:empty,tbody td:not([data-label]){display:block;text-align:left}   /* empty-state rows stay simple */
    .num{justify-content:space-between}
    .kpis{gap:8px}
    .kpi{flex:1 1 calc(50% - 8px);min-width:0}
    .kpi strong{font-size:19px}
    button{padding:8px 12px;font-size:14px}
    input,select,textarea{font-size:16px}   /* 16px stops iOS zoom-on-focus */
    .rooms-toolbar{gap:8px}
    #room-search{flex:1 1 100%;max-width:none}
    .ws-info{margin-left:0;width:100%}
    .modal-overlay{padding:8px}
    .modal-box{width:100%;max-height:94vh}
    /* The state-management modal stays edge-to-edge full screen on phones. */
    .modal-box-full{width:100vw;max-width:100vw;height:100vh;max-height:100vh}
    .modal-overlay:has(.modal-box-full){padding:0}
    .modal-body{padding:8px 10px 14px}
    .um-actions button{padding:11px 12px}
    #ge-map-host{height:60vh}
    /* Manage-state modal: stack each control so it's readable + tappable on a
       phone instead of wrapping into a cramped row. */
    .ge-player{padding:10px}
    .ge-player>h4{font-size:15px}
    .ge-card{gap:8px}
    .ge-card .ge-name{flex:1 1 100%;min-width:0}
    .ge-card select{flex:1 1 auto}
    .ge-give select,.ge-give-card,.ge-give-loc{flex:1 1 100%}
    .ge-teleport input{flex:1 1 100%}
    #game-edit-body button{padding:8px 12px;font-size:14px}
  }
  /* ===== Custom mobile-first theme (user pick) - additive override layer ===== */
  :root{--acc:#6366f1;--acc2:#22d3ee;--accgrad:linear-gradient(135deg,#6366f1,#7c74f2);--surf:#141826;--surf2:#1b2030;--line:#2a3146;--ink:#e8ebf5;--mut:#93a0b8}
  body{font-family:-apple-system,system-ui,"Segoe UI",Roboto,sans-serif;font-size:15px;background:#0a0b12;color:var(--ink);margin:0 auto;padding:16px}
  h1{color:#eef1ff;font-size:21px;font-weight:800;letter-spacing:.2px}
  .sub{color:var(--mut)}
  h2{color:var(--acc2)}
  .room-cat{font-size:12px;letter-spacing:.6px;text-transform:uppercase;color:var(--mut);margin:18px 0 8px;display:flex;align-items:center;gap:7px}
  .header-row .ws-info{background:var(--surf);border-color:var(--line)}
  /* KPI stat cards with a gradient accent bar */
  /* KPI stat cards: a compact auto-fit grid (many small panels per row) */
  .kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(108px,1fr));gap:8px}
  .kpi{position:relative;overflow:hidden;background:var(--surf);border:1px solid var(--line);border-radius:12px;padding:9px 10px 8px 13px;min-width:0}
  .kpi::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:linear-gradient(var(--acc),var(--acc2))}
  .kpi strong{font-size:20px;font-weight:800;color:#fff}
  .kpi span{color:var(--mut);font-size:10px}
  .kpi span{color:var(--mut)}
  /* Tabs as gradient pills */
  .tabbar{gap:8px}
  .tabbar button{background:var(--surf2);border:1px solid var(--line);color:var(--mut);border-radius:999px;padding:9px 17px;font-weight:700}
  .tabbar button.tab-active{background:var(--accgrad);border-color:#7c74f2;color:#fff;box-shadow:0 4px 14px rgba(99,102,241,.35)}
  /* Status badges */
  .pill{border-radius:999px;padding:4px 10px;border:1px solid transparent}
  .pill-waiting{background:rgba(34,211,238,.14);color:#7fe3f5;border-color:rgba(34,211,238,.32)}
  .pill-started,.pill-accepted{background:rgba(52,211,153,.14);color:#6ee7b7;border-color:rgba(52,211,153,.32)}
  .pill-finished,.pill-pending{background:rgba(251,191,36,.14);color:#fcd34d;border-color:rgba(251,191,36,.32)}
  .pill-cancelled,.pill-declined{background:rgba(248,113,113,.14);color:#fca5a5;border-color:rgba(248,113,113,.32)}
  /* Inputs */
  input[type=text],input[type=search],#room-search{background:var(--surf);border:1px solid var(--line);border-radius:12px;padding:11px 13px;color:var(--ink)}
  input:focus{outline:none;border-color:var(--acc)}
  /* Buttons (generic), then primary actions get the gradient */
  button{background:var(--surf2);border:1px solid var(--line);color:var(--ink);border-radius:10px;padding:9px 14px;font-weight:600}
  button:hover{background:#232a3d;border-color:#3a445e}
  button.danger{background:transparent;border-color:#5a2230;color:#ff9aa6}
  button.danger:hover{background:#3a1620;color:#fff;border-color:#7a2230}
  .btn-manage-game,.btn-restore-lobby,.um-actions .btn-add-token{background:var(--accgrad);border-color:#7c74f2;color:#fff}
  .btn-manage-game:hover,.btn-restore-lobby:hover,.um-actions .btn-add-token:hover{filter:brightness(1.08);background:var(--accgrad)}
  #show-cancelled{background:var(--surf2);border:1px solid var(--line);border-radius:10px;padding:9px 14px;color:#cdd7f0}
  /* Admin turn log: the game's op log, styled like the in-game mission log. */
  .admin-turnlog-h{margin:16px 0 6px;font-size:15px;color:#cdd7f0}
  .admin-turnlog{max-height:340px;overflow-y:auto;background:var(--surf);border:1px solid var(--line);border-radius:12px}
  .tl-list{list-style:none;margin:0;padding:4px}
  .tl-row{display:flex;gap:8px;align-items:baseline;padding:5px 8px;border-bottom:1px solid rgba(255,255,255,.04);font-size:13px}
  .tl-row:last-child{border-bottom:none}
  .tl-icon{flex:0 0 auto;width:1.4em;text-align:center}
  .tl-body{flex:1 1 auto;min-width:0}
  .tl-who{font-weight:700}
  .tl-sum{color:#c7cee6;overflow-wrap:anywhere}
  .tl-when{flex:0 0 auto;color:#8890b0;font-variant-numeric:tabular-nums;font-size:12px}
  /* Tables: themed surface + clickable name links */
  table{background:var(--surf);border:1px solid var(--line);border-radius:14px}
  td,th{border-bottom:1px solid var(--line)}
  th{background:#10141f;color:var(--acc2)}
  .linklike{color:#a9b4ff;text-decoration:none;font-weight:700}
  .linklike:hover{color:#fff;text-decoration:underline}
  .pager a{color:var(--acc2)}
  .room-toggle{display:inline-flex;gap:0;margin:0 0 12px;border:1px solid var(--line);border-radius:10px;overflow:hidden}
  .room-toggle button{background:var(--surf2);border:none;border-radius:0;color:var(--mut);padding:9px 16px;font:inherit;font-weight:700;cursor:pointer}
  .room-toggle button.on{background:var(--accgrad);color:#fff}
  .pager{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:10px 0}
  .pg-btn{font-size:13px;padding:6px 10px;border:1px solid var(--line);border-radius:8px;color:var(--acc2);text-decoration:none;background:var(--surf2)}
  .pg-off{opacity:.4;color:var(--mut)}
  .pg-info{font-size:13px;color:var(--mut);padding:0 6px}
  @media (max-width:700px){
    body{padding:12px}
    .kpis{grid-template-columns:repeat(auto-fill,minmax(92px,1fr))}
    .kpi strong{font-size:18px}
    /* polished stacked cards (label muted/uppercase, value bold) */
    tbody tr{border:1px solid var(--line);border-radius:14px;padding:10px 14px;margin:0 0 12px;background:var(--surf)}
    tbody td{padding:6px 0;font-weight:600}
    tbody td::before{color:var(--mut);text-transform:uppercase;font-size:10px;letter-spacing:.5px;font-weight:700}
  }
</style></head>
<body>
  <div class="header-row">
    <div>
      <h1>High Frontier admin</h1>
      <div class="sub">${esc(new Date().toISOString())}</div>
    </div>
    <div class="ws-info">
      <strong>${wsCount}</strong> open sockets · <strong>${wsAuthed}</strong> authed
      · <a href="/admin/site-notes">Site notes</a>
      · <a href="/admin/site-tags">Site tags</a>
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

  <div class="tabbar" id="admin-tabs">
    <button type="button" data-tab="players">Players</button>
    <button type="button" data-tab="rooms">Rooms</button>
    <button type="button" data-tab="chat">Chat</button>
    <button type="button" data-tab="invites">Invites</button>
    <button type="button" data-tab="tools">Tools</button>
  </div>

  <section class="tab-panel" id="tab-tools" hidden>
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
  </section>

  <section class="tab-panel" id="tab-players" hidden>
  <h2>Profiles &amp; devices</h2>
  <div class="pager">Sort:
    <a href="${esc(pageHref('ps', 'joined', 'players'))}" class="${ps === 'joined' ? 'sort-active' : ''}">Joined</a>
    <a href="${esc(pageHref('ps', 'seen', 'players'))}" class="${ps === 'seen' ? 'sort-active' : ''}">Last seen</a>
  </div>
  <table>
    <thead><tr>
      <th>Name</th><th>Created</th><th>Last seen</th>
      <th class="num">Devices</th><th class="num">Tables</th><th class="num">Chats</th>
      <th>Discord</th><th>Actions</th>
    </tr></thead>
    <tbody>${profileRows}</tbody>
  </table>
  ${pager('pp', ppN, profilesTotal, 'players')}
  </section>

  <section class="tab-panel" id="tab-rooms" hidden>
  <h2>Rooms</h2>
  <div class="rooms-toolbar">
    <input id="room-search" type="search" placeholder="Search room name or code…" autocomplete="off" />
    <button id="show-cancelled" type="button">🗑 Canceled / finished games (${endedTotal})</button>
  </div>
  <div class="room-toggle"><button type="button" data-room-mode="mp" class="on">👥 Multiplayer (${mpTotal})</button><button type="button" data-room-mode="solo">🎲 Solo (${soloTotal})</button></div>
  <div id="rooms-mp">
  <table>
    <thead><tr>
      <th>Code</th><th>Name</th><th>Host</th>
      <th>Status</th><th>Turn</th><th>Modules</th><th>Policy</th><th class="num">Players</th><th>Last active</th>
    </tr></thead>
    <tbody>${mpLobbyRows}</tbody>
  </table>
  ${pager('rp', rpN, mpTotal, 'rooms')}
  </div>
  <div id="rooms-solo" hidden>
  <table>
    <thead><tr>
      <th>Code</th><th>Name</th><th>Host</th>
      <th>Status</th><th>Turn</th><th>Modules</th><th>Policy</th><th class="num">Players</th><th>Last active</th>
    </tr></thead>
    <tbody>${soloLobbyRows}</tbody>
  </table>
  ${pager('sp', spN, soloTotal, 'rooms')}
  </div>
  <script>
  (function () {
    var btns = document.querySelectorAll('[data-room-mode]');
    var mp = document.getElementById('rooms-mp');
    var solo = document.getElementById('rooms-solo');
    if (!btns.length || !mp || !solo) return;
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        var mode = this.getAttribute('data-room-mode');
        for (var j = 0; j < btns.length; j++) {
          btns[j].classList.toggle('on', btns[j].getAttribute('data-room-mode') === mode);
        }
        mp.hidden = mode !== 'mp';
        solo.hidden = mode !== 'solo';
      });
    }
  })();
  </script>
  </section>

  <div id="cancelled-modal" class="modal-overlay" hidden>
    <div class="modal-box">
      <div class="modal-head">
        <h3>🗑 Canceled / finished games <span class="muted" style="font-size:12px">(${endedTotal} total)</span></h3>
        <button id="cancelled-close" type="button" class="modal-x" aria-label="Close">×</button>
      </div>
      <div class="modal-body">
        <table>
          <thead><tr>
            <th>Code</th><th>Name</th><th>Host</th><th class="num">Players</th><th>Status</th><th>Ended</th>
          </tr></thead>
          <tbody>${endedRows}</tbody>
        </table>
        ${pager('ep', epN, endedTotal, 'rooms')}
      </div>
    </div>
  </div>

  <div id="game-edit-modal" class="modal-overlay" hidden>
    <div class="modal-box modal-box-full">
      <div class="modal-head">
        <h3 id="game-edit-title">Manage game state</h3>
        <button id="game-edit-close" type="button" class="modal-x" aria-label="Close">×</button>
      </div>
      <div class="modal-body" id="game-edit-body">
        <p><em>Loading…</em></p>
      </div>
    </div>
  </div>

  <div id="user-modal" class="modal-overlay" hidden>
    <div class="modal-box" style="width:min(460px,96vw)">
      <div class="modal-head">
        <h3 id="user-modal-title">User</h3>
        <button id="user-modal-close" type="button" class="modal-x" aria-label="Close">×</button>
      </div>
      <div class="modal-body" id="user-modal-body"></div>
    </div>
  </div>

  <div id="room-modal" class="modal-overlay" hidden>
    <div class="modal-box" style="width:min(460px,96vw)">
      <div class="modal-head">
        <h3 id="room-modal-title">Room</h3>
        <button id="room-modal-close" type="button" class="modal-x" aria-label="Close">×</button>
      </div>
      <div class="modal-body" id="room-modal-body"></div>
    </div>
  </div>

  <section class="tab-panel" id="tab-chat" hidden>
  <h2>Recent chat</h2>
  <table>
    <thead><tr>
      <th>When</th><th>Who</th><th>Lobby</th><th>Body</th>
    </tr></thead>
    <tbody>${chatRows}</tbody>
  </table>
  ${pager('cp', cpN, chatTotal, 'chat')}
  </section>

  <section class="tab-panel" id="tab-invites" hidden>
  <h2>Direct invites</h2>
  <table>
    <thead><tr>
      <th>Sent</th><th>Status</th><th>From → To</th><th>Lobby</th>
    </tr></thead>
    <tbody>${inviteRows}</tbody>
  </table>
  ${pager('ip', ipN, invitesTotal, 'invites')}

  <h2>Invite links</h2>
  <table>
    <thead><tr>
      <th>Code</th><th>Created</th><th>Expires</th><th>Mode</th>
      <th class="num">Uses</th><th>Created by</th><th>Lobby</th>
    </tr></thead>
    <tbody>${linkRows}</tbody>
  </table>
  ${pager('lp', lpN, linksTotal, 'invites')}
  </section>

<script>
// The profiles currently shown in the table (id + name + whether they
// already hold a Discord link), used to populate the reassign picker -
// which offers only accounts with NO link - without another round-trip.
var ADMIN_PROFILES = ${JSON.stringify(profiles.map((p) => ({ id: p.id, name: p.name, linked: !!p.discord_id })))};

// Small HTML escaper for values we re-insert into modal markup (Discord names
// can carry anything; profile names are restricted but escape them too).
function admEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// User settings modal: clicking a username opens it; it holds EVERY per-user
// edit action (the inline buttons moved here). The action buttons reuse the
// existing classes/data-attrs so the existing delegated handlers fire.
(function () {
  var modal = document.getElementById('user-modal');
  var body = document.getElementById('user-modal-body');
  var title = document.getElementById('user-modal-title');
  if (!modal) return;
  function hide() { modal.hidden = true; }
  document.getElementById('user-modal-close').addEventListener('click', hide);
  modal.addEventListener('click', function (e) { if (e.target === modal) hide(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !modal.hidden) hide(); });
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('.btn-user');
    if (!b) return;
    var pid = b.getAttribute('data-pid');
    var pname = b.getAttribute('data-pname');
    var linked = b.getAttribute('data-linked') === '1';
    var dname = b.getAttribute('data-dname');
    title.textContent = '@' + pname;
    var h = '<p class="um-line">Discord: ' + (linked ? ('🔗 ' + admEsc(dname)) : '<span class="muted">not linked</span>') + '</p>';
    h += '<div class="um-actions">';
    h += '<button class="btn-add-token" data-pid="' + pid + '" data-pname="' + admEsc(pname) + '">Issue device code</button>';
    if (linked) {
      h += '<button class="btn-reassign-discord" data-pid="' + pid + '" data-pname="' + admEsc(pname) + '" data-dname="' + admEsc(dname) + '">Reassign Discord</button>';
      h += '<button class="btn-unlink-discord" data-pid="' + pid + '" data-pname="' + admEsc(pname) + '">Unlink Discord</button>';
    }
    h += '<button class="btn-del-profile danger" data-pid="' + pid + '" data-pname="' + admEsc(pname) + '">Delete account</button>';
    h += '</div>';
    body.innerHTML = h;
    modal.hidden = false;
  });
})();

// Room modal: clicking a room name opens it with the room's actions (Manage
// state / Cancel for an active room, Restore for a cancelled one). Buttons reuse
// the existing classes so the existing handlers fire.
(function () {
  var modal = document.getElementById('room-modal');
  var body = document.getElementById('room-modal-body');
  var title = document.getElementById('room-modal-title');
  if (!modal) return;
  // Deep-link a room into the URL as #rooms/<code> so a refresh (or a shared
  // link) reopens the same room instead of dropping back to the bare table.
  function setRoomHash(code) { if (code) location.hash = '#rooms/' + code; }
  function clearRoomHash() {
    var h = (location.hash || '').replace(/^#/, '');
    if (h.indexOf('rooms/') === 0) location.hash = '#rooms';
  }
  function hide() { modal.hidden = true; clearRoomHash(); }
  document.getElementById('room-modal-close').addEventListener('click', hide);
  modal.addEventListener('click', function (e) { if (e.target === modal) hide(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !modal.hidden) hide(); });
  function openRoom(b) {
    var lid = b.getAttribute('data-lid');
    var gid = b.getAttribute('data-gid');
    var lname = b.getAttribute('data-lname');
    var lcode = b.getAttribute('data-lcode');
    var status = b.getAttribute('data-status');
    title.textContent = lname + ' (' + lcode + ')';
    var h = '';
    // Copyable room identifiers up top - the room code (join / deep-link key)
    // and the internal lobby id, so an operator can grab either.
    h += '<p class="muted room-ids">Room code: <code>' + admEsc(lcode) + '</code>'
      + ' &middot; Lobby id: <code>' + admEsc(lid) + '</code>'
      + (gid ? ' &middot; Game id: <code>' + admEsc(gid) + '</code>' : '') + '</p>';
    h += '<div class="um-actions">';
    if (status === 'active') {
      if (gid) h += '<button class="btn-manage-game" data-gid="' + gid + '" data-lname="' + admEsc(lname) + '" data-lcode="' + admEsc(lcode) + '">🛠 Manage state</button>';
      else h += '<p class="muted">No game started yet.</p>';
      h += '<button class="btn-del-lobby danger" data-lid="' + lid + '" data-lname="' + admEsc(lname) + '">Cancel table</button>';
    } else if (status === 'cancelled') {
      h += '<button class="btn-restore-lobby" data-lid="' + lid + '" data-lname="' + admEsc(lname) + '">Restore table</button>';
    } else {
      // Finished game: let an admin INSPECT (and, if needed, edit) the final
      // state - the state manager reads game_states regardless of status.
      if (gid) h += '<button class="btn-manage-game" data-gid="' + gid + '" data-lname="' + admEsc(lname) + '" data-lcode="' + admEsc(lcode) + '">🛠 Inspect final state</button>';
      else h += '<p class="muted">This game is finished. No saved state to inspect.</p>';
    }
    h += '</div>';
    // Turn log: the game's op log, rendered like the in-game mission log
    // (op-kind glyph + seat-coloured @name + summary + relative time).
    if (gid) {
      h += '<div class="admin-turnlog-wrap"><h3 class="admin-turnlog-h">📋 Turn log</h3>'
        + '<div id="admin-turnlog" class="admin-turnlog"><p class="muted">Loading…</p></div></div>';
    }
    body.innerHTML = h;
    modal.hidden = false;
    setRoomHash(lcode);
    if (gid) loadTurnLog(gid);
  }
  // Op-kind glyphs, mirroring the client MP_LOG_ICONS so the admin turn log
  // reads the same as the in-game mission log. Missing kinds fall back to a dot.
  var TL_ICONS = {
    AUCTION_START:'🎯',AUCTION_BID:'💰',AUCTION_PASS:'🚫',AUCTION_RESET:'↺',AUCTION_SELL:'✅',
    PICK_CREW:'🧑‍🚀',SET_FIRST_PLAYER:'🥇',END_TURN:'⏭',MOVE:'🛸',BURN:'🔥',
    BUILD_ROCKET:'🚀',PROSPECT:'⛏',PROSPECT_REROLL:'🎲',INDUSTRIALIZE:'🏭',BUILD_FACTORY:'🏭',
    BUILD_REFINERY:'💧',ET_PRODUCE:'🏭',SITE_REFUEL:'💧',PROMOTE:'🟣',EVENT_CHOICE:'☄️',
    HOMESTEAD:'🏠',NANOFACTURE:'🏭',EXOMIGRATE:'🧑‍🚀',EPIC_HAZARD:'🌟',SET_LAW_STAR:'🏛',
    INCOME:'💰',FREE_MARKET:'🏪',BOOST:'🚀',DELIVERY:'📦',BUILD_COLONY:'🌐',
    REFUEL:'💧',CASH_WATER:'💎',DISCARD:'🗑',CLAIM_JUMP:'🗽',TRANSFER:'🔀',
    CONVERT_OUTPOST:'🏛',DECOMMISSION:'🗑',BUY_FUTURE:'📈',
    STOW_BERNAL:'🏙',DEPLOY_BERNAL:'🏙',ANCHOR_BERNAL:'⚓',UNANCHOR_BERNAL:'⚓',BUILD_BERNAL_ONTO_HOME:'🏙',
    LOAD_GLORY:'🎖',SURRENDER_GLORY:'🎖',SET_WIRING:'🔗',AFTERBURN:'🔥',
    TRADE_OFFER:'🤝',TRADE_COUNTER:'↔',TRADE_ACCEPT:'✅',TRADE_DECLINE:'🚫',
    DRAFT_PICK:'🃏',DRAFT_CYCLE:'♻',UNDO:'↩',REDO:'↪',FUNDRAISE:'🗳',LOBBY:'📜',
    ADMIN_REPAIR:'🔧',ADMIN_EDIT:'🔧',
    REQUEST_FACTORY_USE:'🙋',GRANT_FACTORY_USE:'🤝',DENY_FACTORY_USE:'🚫',REVOKE_FACTORY_USE:'🔒',
    REQUEST_LUNA_PROSPECT:'🌙',GRANT_LUNA_PROSPECT:'🤝',DENY_LUNA_PROSPECT:'🚫',REVOKE_LUNA_PROSPECT:'🔒',
  };
  function tlRelTime(ms) {
    if (!ms) return '';
    var d = Date.now() - ms;
    if (d < 0) return 'now';
    if (d < 60000) return Math.max(1, Math.round(d / 1000)) + 's';
    if (d < 3600000) return Math.round(d / 60000) + 'm';
    if (d < 86400000) return Math.round(d / 3600000) + 'h';
    return Math.round(d / 86400000) + 'd';
  }
  // The engine's log already starts with the actor's name; strip it so the
  // @name column does not duplicate it (mirrors the client mission log).
  function tlStripLead(line, name) {
    if (!line || !name) return line;
    if (line.indexOf(name) !== 0) return line;
    return line.slice(name.length).replace(/^\s+/, '');
  }
  function loadTurnLog(gid) {
    var host = document.getElementById('admin-turnlog');
    if (!host) return;
    fetch('/admin/games/' + gid + '/ops').then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.ok || !d.ops || !d.ops.length) { host.innerHTML = '<p class="muted">No turn log yet.</p>'; return; }
      var rows = d.ops.map(function (e) {
        var col = e.color ? ' style="color:' + admEsc(e.color) + '"' : '';
        var sum = tlStripLead(e.log, e.playerName);
        var when = e.createdAt ? new Date(e.createdAt).toLocaleString() : '';
        return '<li class="tl-row"><span class="tl-icon">' + admEsc(TL_ICONS[e.kind] || '·') + '</span>'
          + '<span class="tl-body"><span class="tl-who"' + col + '>@' + admEsc(e.playerName || '?') + '</span> '
          + '<span class="tl-sum">' + admEsc(sum) + '</span></span>'
          + '<span class="tl-when" title="' + admEsc(when) + '">' + admEsc(tlRelTime(e.createdAt)) + '</span></li>';
      }).join('');
      host.innerHTML = '<ul class="tl-list">' + rows + '</ul>';
    }).catch(function () { host.innerHTML = '<p class="muted">Failed to load turn log.</p>'; });
  }
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('.btn-room');
    if (!b) return;
    openRoom(b);
  });
  // Reopen a room from a #rooms/<code> deep link on load (refresh / shared URL).
  // Match the code case-insensitively against a room button in either table.
  (function resumeRoomFromHash() {
    var h = (location.hash || '').replace(/^#/, '');
    if (h.indexOf('rooms/') !== 0) return;
    var code = h.slice('rooms/'.length).toLowerCase();
    if (!code) return;
    var btns = Array.prototype.slice.call(document.querySelectorAll('.btn-room'));
    var match = btns.filter(function (b) {
      return String(b.getAttribute('data-lcode') || '').toLowerCase() === code;
    })[0];
    if (match) openRoom(match);
  })();
})();

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
        btn.textContent = 'Cancel table';
        alert('Failed: ' + (res.body && res.body.error || 'unknown'));
        return;
      }
      location.reload();   // refresh the rooms table (button now lives in a modal)
    })
    .catch(function () {
      btn.disabled = false;
      btn.textContent = 'Cancel table';
      alert('Network error.');
    });
});

// "Unlink Discord" - removes the discord_accounts row for a profile so
// the Discord ID is free to link to a different (correct) account. Keeps
// the profile and all its data; only the link is dropped.
document.addEventListener('click', function (ev) {
  var btn = ev.target.closest('.btn-unlink-discord');
  if (!btn) return;
  var pid = btn.getAttribute('data-pid');
  var pname = btn.getAttribute('data-pname');
  if (!confirm('Unlink Discord from @' + pname + '?\\n\\nThe Discord account becomes free to link to a different game account. @' + pname + ' itself is kept.')) return;
  btn.disabled = true;
  btn.textContent = 'Unlinking...';
  fetch('/admin/profiles/' + pid + '/unlink-discord', { method: 'POST' })
    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
    .then(function (res) {
      if (!res.ok) {
        btn.disabled = false;
        btn.textContent = 'Unlink Discord';
        alert('Failed: ' + (res.body && res.body.error || 'unknown'));
        return;
      }
      location.reload();   // refresh the table + modal (button now lives in a modal)
    })
    .catch(function () {
      btn.disabled = false;
      btn.textContent = 'Unlink Discord';
      alert('Network error.');
    });
});

// "Reassign Discord" - clicking a Discord link opens an inline picker of the
// accounts that have NO Discord link yet; choosing one and confirming frees
// the Discord from THIS account and links it to the chosen one (and moves the
// turn-DM target with it). Reloads on success so both the source row (now
// "not linked") and the destination row update.
document.addEventListener('click', function (ev) {
  var btn = ev.target.closest('.btn-reassign-discord');
  if (!btn) return;
  var pid = btn.getAttribute('data-pid');
  var pname = btn.getAttribute('data-pname');
  var dname = btn.getAttribute('data-dname');
  var cell = btn.parentElement;
  if (cell.querySelector('.reassign-picker')) return; // already open
  var others = ADMIN_PROFILES.filter(function (p) { return String(p.id) !== String(pid) && !p.linked; });
  if (!others.length) { alert('No account is free to receive this Discord - every account already has one linked. Unlink an account first.'); return; }
  var wrap = document.createElement('span');
  wrap.className = 'reassign-picker';
  wrap.style.cssText = 'display:inline-flex;gap:4px;align-items:center';
  var sel = document.createElement('select');
  others.forEach(function (p) {
    var opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = '@' + p.name;
    sel.appendChild(opt);
  });
  var go = document.createElement('button');
  go.textContent = 'Move';
  var cancel = document.createElement('button');
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', function () { wrap.remove(); btn.style.display = ''; });
  go.addEventListener('click', function () {
    var toId = sel.value;
    var toName = sel.options[sel.selectedIndex].textContent;
    if (!confirm('Move the Discord link (' + dname + ') from @' + pname + ' to ' + toName + '?\\n\\n@' + pname + ' loses the Discord link and ' + toName + ' gains it. If ' + toName + ' already had a different Discord linked, that prior link is dropped.')) return;
    go.disabled = true; cancel.disabled = true; go.textContent = 'Moving...';
    fetch('/admin/profiles/' + pid + '/reassign-discord', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toId: Number(toId) })
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (!res.ok) {
          go.disabled = false; cancel.disabled = false; go.textContent = 'Move';
          var code = res.body && res.body.error;
          var msg = code === 'not_linked'
            ? 'That account no longer has a Discord link to move.'
            : code === 'same_profile'
              ? 'Pick a different destination account.'
              : ('Failed: ' + (code || 'unknown'));
          alert(msg);
          return;
        }
        location.reload();
      })
      .catch(function () {
        go.disabled = false; cancel.disabled = false; go.textContent = 'Move';
        alert('Network error.');
      });
  });
  wrap.appendChild(sel);
  wrap.appendChild(go);
  wrap.appendChild(cancel);
  btn.style.display = 'none';
  cell.appendChild(wrap);
});

// "Delete account" - hard-deletes the profile and all its data (device
// tokens, Discord link, memberships, chat, invites). Refused by the
// server if the account is in any game or hosts a table, to avoid
// corrupting other players' games.
document.addEventListener('click', function (ev) {
  var btn = ev.target.closest('.btn-del-profile');
  if (!btn) return;
  var pid = btn.getAttribute('data-pid');
  var pname = btn.getAttribute('data-pname');
  if (!confirm('Permanently DELETE account @' + pname + ' and all of its data?\\n\\nThis removes the profile, its device codes, its Discord link, lobby memberships, chat, and invites. This cannot be undone.')) return;
  btn.disabled = true;
  btn.textContent = 'Deleting...';
  fetch('/admin/profiles/' + pid + '/delete', { method: 'POST' })
    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
    .then(function (res) {
      if (!res.ok) {
        btn.disabled = false;
        btn.textContent = 'Delete account';
        var code = res.body && res.body.error;
        var msg = code === 'in_games'
          ? 'This account is in one or more games. Cancel those tables first.'
          : code === 'hosts_tables'
            ? 'This account hosts one or more tables. Cancel those tables first.'
            : ('Failed: ' + (code || 'unknown'));
        alert(msg);
        return;
      }
      location.reload();   // refresh the table (button now lives in a modal)
    })
    .catch(function () {
      btn.disabled = false;
      btn.textContent = 'Delete account';
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

// Room search: filter the active-rooms table by the row's data-search
// (lowercased name + code), so a code substring matches too.
(function () {
  var search = document.getElementById('room-search');
  if (!search) return;
  search.addEventListener('input', function () {
    var q = search.value.trim().toLowerCase();
    var rows = document.querySelectorAll('#tab-rooms tr.room-row');   // both MP + Solo tables
    for (var i = 0; i < rows.length; i++) {
      var tr = rows[i];
      var hay = tr.getAttribute('data-search') || '';
      tr.style.display = (!q || hay.indexOf(q) !== -1) ? '' : 'none';
    }
  });
})();

// Tabs: show one panel at a time, keep the active tab in location.hash so the
// pagination / sort links (which carry #<tab>) land back on the right tab.
(function () {
  var bar = document.getElementById('admin-tabs');
  if (!bar) return;
  var btns = Array.prototype.slice.call(bar.querySelectorAll('button[data-tab]'));
  function show(id) {
    var found = false;
    btns.forEach(function (b) {
      var on = b.getAttribute('data-tab') === id;
      b.classList.toggle('tab-active', on);
      if (on) found = true;
    });
    document.querySelectorAll('.tab-panel').forEach(function (p) {
      p.hidden = p.id !== 'tab-' + id;
    });
    return found;
  }
  function fromHash() {
    // The hash may carry a sub-path (e.g. #rooms/<code> deep-links a room); the
    // tab is the segment before the first slash.
    var h = (location.hash || '').replace(/^#/, '').split('/')[0];
    return h || (btns[0] && btns[0].getAttribute('data-tab')) || 'players';
  }
  btns.forEach(function (b) {
    b.addEventListener('click', function () {
      var id = b.getAttribute('data-tab');
      location.hash = '#' + id;
      show(id);
    });
  });
  var start = fromHash();
  if (!show(start)) show((btns[0] && btns[0].getAttribute('data-tab')) || 'players');
})();

// Canceled-rooms modal: open / close. Restore buttons inside it are handled by
// the existing .btn-restore-lobby click delegation (it reloads on success).
(function () {
  var openBtn = document.getElementById('show-cancelled');
  var modal = document.getElementById('cancelled-modal');
  var closeBtn = document.getElementById('cancelled-close');
  if (!modal) return;
  function open() { modal.hidden = false; }
  function close() {
    modal.hidden = true;
    // Drop the ?ep page param on close so a later reload or another tab's
    // pager (which preserve existing query params) doesn't re-open this modal.
    // Keep the rest of the URL (tab hash, other pagers).
    try {
      var u = new URL(location.href);
      if (u.searchParams.has('ep')) {
        u.searchParams.delete('ep');
        history.replaceState(null, '', u.pathname + u.search + u.hash);
      }
    } catch (e) { /* ignore */ }
  }
  if (openBtn) openBtn.addEventListener('click', open);
  if (closeBtn) closeBtn.addEventListener('click', close);
  modal.addEventListener('click', function (ev) { if (ev.target === modal) close(); });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && !modal.hidden) close();
  });
  // A pager link inside the modal reloads the whole admin page with ?ep=N, so
  // re-open the modal on load when that param is present - paging through the
  // ended list then keeps the modal up across the reload.
  try {
    if (new URLSearchParams(location.search).has('ep')) open();
  } catch (e) { /* ignore */ }
})();

// Game-state editor modal: per-room view of every player's card locations,
// aqua and tank, with move / give / remove / set actions. All mutations POST
// to /admin/games/:id/edit and re-render from the server's response.
(function () {
  var modal = document.getElementById('game-edit-modal');
  if (!modal) return;
  var body = document.getElementById('game-edit-body');
  var title = document.getElementById('game-edit-title');
  var closeBtn = document.getElementById('game-edit-close');
  var current = { gid: null, state: null, catalog: [] };
  var actorPid = null;     // which player a map click acts on (factory owner / teleport target)
  var mapApi = null;       // mounted client-map adapter (js/admin/admin-map.js) - the REAL renderer
  var mapMounting = false;
  var pickedSlug = null;   // site/node currently selected on the map
  var pendingMove = null;  // slug of a factory awaiting a move-destination click

  function close() { modal.hidden = true; }
  closeBtn.addEventListener('click', close);
  modal.addEventListener('click', function (ev) { if (ev.target === modal) close(); });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && !modal.hidden) close();
  });

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function locsFor(p) {
    var arr = ['hand', 'leo', 'rocket'];
    if (p.freighter) arr.push('freighter');
    (p.bernals || []).forEach(function (bn, i) { arr.push('bernal:' + i); });
    Object.keys(p.outposts || {}).forEach(function (k) { arr.push('outpost:' + k); });
    return arr;
  }
  function locLabel(loc, p) {
    if (loc === 'hand') return 'Hand';
    if (loc === 'leo') return 'LEO';
    if (loc === 'rocket') return 'Rocket' + (p && p.rocket ? ' (' + esc(p.rocket.siteName) + ')' : '');
    if (loc === 'freighter') {
      var f = p && p.freighter;
      return '🚚 Freighter' + (f && f.promoted ? ' 🟣' : '') + (f ? ' (' + esc(f.siteName || 'LEO') + ')' : '');
    }
    var mb = /^bernal:(\\d+)$/.exec(loc);
    if (mb) {
      var bn = p && p.bernals ? p.bernals[Number(mb[1])] : null;
      var fig = bn ? (bn.figure === 'stanford' ? 'Stanford' : 'Kalpana') : '';
      return '🛰 Bernal ' + (Number(mb[1]) + 1)
        + (bn ? ' ' + fig + (bn.anchored ? ' ⚓' : '') + (bn.promoted ? ' 🟣' : '') + ' (' + esc(bn.siteName || 'LEO') + ')' : '');
    }
    var m = /^outpost:(.+)$/.exec(loc);
    if (m) {
      var o = p && p.outposts ? p.outposts[m[1]] : null;
      return 'Outpost ' + m[1] + (o ? ' (' + esc(o.siteName) + ')' : '');
    }
    return loc;
  }
  function cardsAt(p, loc) {
    if (loc === 'hand') return p.hand || [];
    if (loc === 'leo') return p.leo || [];
    if (loc === 'rocket') return (p.rocket && p.rocket.stack) || [];
    if (loc === 'freighter') return (p.freighter && p.freighter.stack) || [];
    var mb = /^bernal:(\\d+)$/.exec(loc);
    if (mb) { var bn = (p.bernals || [])[Number(mb[1])]; return bn ? (bn.stack || []) : []; }
    var m = /^outpost:(.+)$/.exec(loc);
    if (m) { var o = (p.outposts || {})[m[1]]; return o ? (o.cards || []) : []; }
    return [];
  }
  function moveOptions(locs, cur, p) {
    return locs.filter(function (l) { return l !== cur; }).map(function (l) {
      return '<option value="' + l + '">' + esc(locLabel(l, p)) + '</option>';
    }).join('');
  }
  // The vehicle object behind a location (rocket / freighter / bernal:N), or
  // null for hand / leo / outpost (no single mass-bearing stack to summarise).
  function unitFor(p, loc) {
    if (loc === 'rocket') return p.rocket || null;
    if (loc === 'freighter') return p.freighter || null;
    var mb = /^bernal:(\\d+)$/.exec(loc);
    if (mb) return (p.bernals || [])[Number(mb[1])] || null;
    return null;
  }
  function fmtMass(n) { return (n == null) ? '?' : (Math.round(Number(n) * 1000) / 1000); }
  // One-line dry/wet mass (+ rocket thrust + lift check) summary for a vehicle
  // location. Reads the fields adminGameStateView computed from the engine's own
  // mass/thrust helpers, so it matches the move math exactly.
  function unitSummary(p, loc) {
    var u = unitFor(p, loc);
    if (!u || u.dryMass == null) return '';
    var s = '⚖ dry ' + fmtMass(u.dryMass) + ' · wet ' + fmtMass(u.wetMass) + '/32';
    if (u.netThrust != null) {
      var lift = (u.netThrust >= u.wetMass) ? '✅' : '❌';
      s += ' · 🔺 thrust ' + u.netThrust + ' (lift ' + lift + ')';
      if (u.fuelPerBurn != null) s += ' · ' + fmtMass(u.fuelPerBurn) + ' FT/burn';
      if (u.thrusterName) s += ' · ' + esc(u.thrusterName);
    }
    return '<div class="ge-loc-mass">' + s + '</div>';
  }
  // The map section mounts the REAL client solar map (js/admin/admin-map.js ->
  // loadPlannerMap + MapRenderer, the SAME renderer the player sandbox uses).
  // It is built ONCE per modal open (so re-rendering the player/card list below
  // never tears down the live canvas); buildMapSection() returns its static
  // shell, mountMap() loads the renderer into the host, and refreshMap() pushes
  // the current factories / colonies / rocket-focus onto it.
  function actorList() { return (current.state && current.state.players) || []; }
  function actor() {
    var ps = actorList();
    return ps.filter(function (p) { return p.profileId === actorPid; })[0] || ps[0] || null;
  }
  function buildMapSection() {
    var players = actorList();
    if (actorPid == null && players[0]) actorPid = players[0].profileId;
    var chips = players.map(function (p) {
      var sel = (p.profileId === actorPid) ? ' sel' : '';
      return '<button type="button" class="ge-actor-chip' + sel + '" data-pid="' + p.profileId + '" style="background:' + esc(p.color || '#888') + '">@' + esc(p.name) + '</button>';
    }).join('');
    var tools = '<div class="ge-map-tools"><span class="ge-actor">Acting as: ' + chips + '</span>'
      + '<span class="ge-locate">Locate: '
      + '<button type="button" data-loc="rocket">🚀 Rocket</button>'
      + '<button type="button" data-loc="factories">🏭 Factories</button>'
      + '<button type="button" data-loc="outposts">📦 Outposts</button></span>'
      + '<span style="opacity:.7">Click a site to build / teleport; click any node to teleport.</span></div>';
    return '<div class="ge-map"><h4>🗺 Solar map</h4>' + tools
      + '<div class="ge-map-wrap"><div id="ge-map-host"></div></div></div>';
  }
  // Re-highlight the acting-player chips (after a chip click changes actorPid).
  function refreshActorChips() {
    var chips = document.querySelectorAll('.ge-actor-chip');
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList.toggle('sel', Number(chips[i].getAttribute('data-pid')) === actorPid);
    }
  }
  // Mount the real renderer once; subsequent opens reuse the cached planner map.
  function mountMap() {
    var host = document.getElementById('ge-map-host');
    if (!host || mapApi || mapMounting) { refreshMap(); return; }
    mapMounting = true;
    import('/js/admin/admin-map.js').then(function (mod) {
      return mod.mountAdminMap(host, { onPickSite: openWizard });
    }).then(function (api) {
      mapApi = api; mapMounting = false; refreshMap();
    }).catch(function (e) {
      mapMounting = false;
      host.innerHTML = '<p class="ge-msg err" style="padding:10px">Map failed to load: ' + esc(e && e.message || e) + '</p>';
    });
  }
  // Push current factories / colonies / rocket-focus onto the live map.
  function refreshMap() { if (mapApi) mapApi.update(current.state, actorPid); }
  function closeWizard() { var w = document.getElementById('ge-wiz'); if (w) w.parentNode.removeChild(w); }
  // Locate picker: a popup list of every factory / outpost to jump to.
  function openLocatePicker(kind) {
    closeWizard();
    var items = kind === 'factories' ? mapApi.listFactories() : mapApi.listOutposts();
    var ov = document.createElement('div'); ov.id = 'ge-wiz'; ov.className = 'ge-wiz-overlay';
    var box = document.createElement('div'); box.className = 'ge-wiz-box';
    var title = kind === 'factories' ? '🏭 Factories' : '📦 Outposts';
    var h = '<div class="ge-wiz-h">' + title + ' <span class="muted">(' + items.length + ')</span></div>';
    if (!items.length) {
      h += '<p class="ge-wiz-sub">None to locate.</p>';
    } else {
      items.forEach(function (it) {
        var sub = kind === 'factories'
          ? ('@' + esc(it.owner) + (it.hasColony ? ' · 🏠 colony' : ''))
          : ('outpost ' + esc(it.letter));
        h += '<button class="ge-locate-item" data-slug="' + esc(it.slug) + '" data-name="' + esc(it.name) + '">'
          + (kind === 'factories' ? '🏭 ' : '📦 ') + esc(it.name) + ' <span class="muted">' + sub + '</span></button>';
      });
    }
    h += '<button class="ge-wiz-cancel" data-w="cancel">Close</button>';
    box.innerHTML = h;
    // Wire the row clicks DIRECTLY here: this popup is appended to document.body,
    // outside the modal-body element that carries the delegated click handler, so
    // a delegated listener never sees these rows. Clicking a row pans/zooms the
    // map to that site and replaces this picker with the site's action wizard.
    box.addEventListener('click', function (e) {
      if (e.target.closest('[data-w="cancel"]')) { closeWizard(); return; }
      var row = e.target.closest('.ge-locate-item');
      if (!row) return;
      var slug = row.getAttribute('data-slug');
      if (mapApi) mapApi.flyToSlug(slug);
      openWizard(slug, { name: row.getAttribute('data-name'), id2: slug });
    });
    ov.addEventListener('click', function (e) { if (e.target === ov) closeWizard(); });
    ov.appendChild(box); document.body.appendChild(ov);
  }
  // A site/node was clicked on the map -> pop a wizard with the relevant actions
  // for the acting player. Sites can build / teleport / manage a factory; any
  // node (incl. waypoints) can teleport. Building asks the colony-dome question
  // as a second step.
  function openWizard(slug, site) {
    closeWizard();
    pickedSlug = slug;
    var a = actor();
    var who = a ? ('@' + a.name) : 'player';
    var isSite = !!(site && site.name && site.isLandable !== false);
    var hasFactory = (current.state.factories || []).some(function (f) { return f.slug === slug; });
    var label = (site && site.name) ? site.name : slug;
    // Target-location detail line for the popup: slug + spectral/type + size + zone.
    var bits = [];
    if (slug) bits.push(esc(site && site.id2 ? site.id2 : slug));
    if (site && site.spectralType) bits.push('spectral ' + esc(site.spectralType));
    else if (site && site.type) bits.push(esc(site.type));
    if (site && site.siteSize) bits.push('size ' + esc(site.siteSize));
    if (site && site.solarZone) bits.push(esc(site.solarZone) + ' zone');
    var locLine = '<p class="ge-wiz-loc">📍 ' + bits.join(' · ') + '</p>';
    var ov = document.createElement('div'); ov.id = 'ge-wiz'; ov.className = 'ge-wiz-overlay';
    var box = document.createElement('div'); box.className = 'ge-wiz-box';
    function home() {
      var h = '<div class="ge-wiz-h">' + esc(label) + '</div>' + locLine + '<p class="ge-wiz-sub">Acting as <strong>' + esc(who) + '</strong></p>';
      h += '<button data-w="tp" data-unit="rocket">🛸 Teleport rocket here</button>';
      var a2 = actor();
      if (a2 && a2.freighter) h += '<button data-w="tp" data-unit="freighter">🚚 Teleport freighter here</button>';
      if (a2 && a2.bernals) a2.bernals.forEach(function (bn, i) {
        var fig = bn.figure === 'stanford' ? 'Stanford' : 'Kalpana';
        h += '<button data-w="tp" data-unit="bernal:' + i + '">🛰 Teleport Bernal ' + (i + 1) + ' (' + esc(fig) + ') here</button>';
      });
      if (isSite && !hasFactory) h += '<button data-w="build">🏭 Build factory here</button>';
      if (hasFactory) {
        h += '<button data-w="reassign">👤 Reassign factory to ' + esc(who) + '</button>';
        h += '<button data-w="move">↔ Move this factory…</button>';
        h += '<button class="danger" data-w="remove">× Remove factory</button>';
      }
      if (pendingMove && pendingMove !== slug && isSite && !hasFactory) {
        h += '<button data-w="moveHere">📦 Move pending factory here</button>';
      }
      h += '<button class="ge-wiz-cancel" data-w="cancel">Cancel</button>';
      box.innerHTML = h;
    }
    box.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-w]'); if (!b) return;
      var w = b.getAttribute('data-w');
      if (w === 'cancel') { closeWizard(); return; }
      if (w === 'tp') {
        var unit = b.getAttribute('data-unit') || 'rocket';
        var what = unit === 'freighter' ? 'Freighter' : (/^bernal:/.test(unit) ? 'Bernal' : 'Rocket');
        closeWizard();
        postEdit({ action: 'teleport', profileId: actorPid, node: slug, unit: unit }, what + ' teleported.');
        return;
      }
      if (w === 'build') {
        box.innerHTML = '<div class="ge-wiz-h">Build factory at ' + esc(label) + '</div>'
          + '<p class="ge-wiz-sub">Add a colony dome?</p>'
          + '<button data-w="domeYes">🏭 + 🏠 Yes, with colony dome</button>'
          + '<button data-w="domeNo">🏭 No dome</button>'
          + '<button class="ge-wiz-cancel" data-w="cancel">Cancel</button>';
        return;
      }
      if (w === 'domeYes' || w === 'domeNo') { closeWizard(); postEdit({ action: 'create_factory', profileId: actorPid, siteId: slug, colony: w === 'domeYes' }, 'Factory placed.'); return; }
      if (w === 'reassign') { closeWizard(); postEdit({ action: 'reassign_factory', profileId: actorPid, siteId: slug }, 'Factory reassigned.'); return; }
      if (w === 'remove') { closeWizard(); postEdit({ action: 'remove_factory', profileId: actorPid, siteId: slug }, 'Factory removed.'); return; }
      if (w === 'move') { pendingMove = slug; closeWizard(); msg('Move started - click the destination site for this factory.', true); return; }
      if (w === 'moveHere') { var from = pendingMove; pendingMove = null; closeWizard(); postEdit({ action: 'move_factory', fromSiteId: from, toSiteId: slug }, 'Factory moved.'); return; }
    });
    ov.addEventListener('click', function (ev) { if (ev.target === ov) closeWizard(); });
    ov.appendChild(box); document.body.appendChild(ov);
    home();
  }
  function render() {
    // Only the dynamic section (players / cards / assembly) is rebuilt here; the
    // map host lives in #ge-map-section and is preserved across re-renders.
    var st = current.state;
    var dyn = document.getElementById('ge-dynamic') || body;
    var html = '<p class="ge-msg" id="ge-msg"></p>';
    (st.players || []).forEach(function (p) {
      var locs = locsFor(p);
      html += '<div class="ge-player" data-pid="' + p.profileId + '">';
      html += '<h4><span class="ge-dot" style="background:' + esc(p.color || '#888') + '"></span> @' + esc(p.name) + '</h4>';
      html += '<div class="ge-stats">Aqua <input type="number" class="ge-aqua" min="0" value="' + (p.aqua || 0) + '">'
        + '<button data-act="set_aqua">Set</button>'
        + ' &middot; Tank <input type="number" class="ge-water" min="0" step="0.001" value="' + (p.rocket ? p.rocket.tank : 0) + '">'
        + '<select class="ge-grade"><option value="water"' + (p.rocket && p.rocket.tankGrade === 'water' ? ' selected' : '') + '>water</option>'
        + '<option value="dirt"' + (p.rocket && p.rocket.tankGrade === 'dirt' ? ' selected' : '') + '>dirt</option></select>'
        + '<button data-act="set_water">Set</button></div>';
      html += '<div class="ge-teleport">🛸 Rocket at <strong>' + esc(p.rocket ? (p.rocket.siteName || 'LEO') : 'LEO') + '</strong>'
        + ' &rarr; <input type="text" class="ge-tp-node" placeholder="node id or name" autocomplete="off">'
        + '<button data-act="teleport">Teleport</button></div>';
      // Permanent card-power privileges (IONOSAT / Power Girdle grant Powersat).
      var hasPS = (p.grantedPrivileges || []).indexOf('POWERSAT') >= 0;
      html += '<div class="ge-teleport">⚡ Powersat: <strong>' + (hasPS ? 'granted' : 'no') + '</strong>'
        + '<button data-act="grant_powersat"' + (hasPS ? ' disabled' : '') + '>Grant Powersat</button>'
        + '<button data-act="revoke_powersat"' + (hasPS ? '' : ' disabled') + '>Revoke</button></div>';
      locs.forEach(function (loc) {
        var cards = cardsAt(p, loc);
        html += '<div class="ge-loc"><div class="ge-loc-h">' + esc(locLabel(loc, p)) + ' (' + cards.length + ')</div>';
        html += unitSummary(p, loc);
        // Deployed-unit promotion (M1 Freighter big cube / M2 Bernal colony):
        // the unit-level purple flag, separate from any stack card's face.
        var u = unitFor(p, loc);
        if (u && loc !== 'rocket' && ((loc === 'freighter' && st.m1) || (/^bernal:/.test(loc) && st.m2))) {
          html += '<div class="ge-loc-mass"><button data-act="promote_unit" data-unit="' + loc + '" data-on="' + (u.promoted ? '0' : '1') + '">'
            + (u.promoted ? '⚪ Return unit to white side' : '🟣 Promote unit (purple side)') + '</button></div>';
        }
        if (!cards.length) { html += '<div class="ge-empty">empty</div>'; }
        else cards.forEach(function (c) {
          // Flip control: promo-class cards (colonist / GW thruster / Freighter
          // / Bernal) flip to their purple promoted side and follow the room's
          // module; every other card flips white <-> black. Hand cards carry no
          // face, so no flip there.
          var promoMod = (c.type === 'colonist' || c.type === 'bernal') ? 'm2'
            : (c.type === 'gw-thruster' || c.type === 'freighter') ? 'm1' : null;
          var modOk = promoMod === 'm2' ? !!st.m2 : (promoMod === 'm1' ? !!st.m1 : true);
          var isSec = c.face === 'secondary';
          var badge = isSec ? (promoMod ? ' 🟣' : ' ⬛') : '';
          var flipBtn = '';
          if (loc !== 'hand' && modOk) {
            var flabel = promoMod ? (isSec ? '⚪ Demote' : '🟣 Promote') : (isSec ? '⬜ White' : '⬛ Black');
            flipBtn = '<button data-act="flip" title="Flip the card face">' + flabel + '</button>';
          }
          html += '<div class="ge-card" data-cid="' + esc(c.id) + '" data-loc="' + loc + '">'
            + '<span class="ge-name">' + esc(c.name || c.id) + badge + (c.mass != null ? ' <span class="ge-card-mass" title="card mass">⚖' + c.mass + '</span>' : '') + '</span>'
            + '<select class="ge-move">' + moveOptions(locs, loc, p) + '</select>'
            + '<button data-act="move">Move</button>'
            + flipBtn
            + '<button data-act="remove" class="danger">&times;</button></div>';
        });
        html += '</div>';
      });
      var opts = current.catalog.map(function (c) {
        return '<option value="' + esc(c.id) + '">' + esc(c.name) + (c.type ? (' (' + esc(c.type) + ')') : '') + '</option>';
      }).join('');
      var locOpts = locs.map(function (l) { return '<option value="' + l + '">' + esc(locLabel(l, p)) + '</option>'; }).join('');
      html += '<div class="ge-give">Give <select class="ge-give-card">' + opts + '</select> to <select class="ge-give-loc">' + locOpts + '</select><button data-act="give">Give</button></div>';
      html += '</div>';
    });
    if (st.assembly && st.assembly.places) {
      html += '<div class="ge-asm"><h4>🏛 Political Assembly cubes</h4>';
      html += '<p class="ge-asm-hint">Click a cube to pick it up, then click a space to drop it there. Cube colour = player; space colour = ideology.</p>';
      html += '<div class="ge-asm-grid">';
      st.assembly.places.forEach(function (pl) {
        html += '<div class="ge-asm-space" data-place="' + pl.key + '">';
        html += '<div class="ge-asm-space-h" style="background:' + esc(pl.color) + '">' + esc(pl.name) + '</div>';
        html += '<div class="ge-asm-cubes">';
        if (!pl.cubes.length) html += '<span class="ge-asm-empty">empty</span>';
        pl.cubes.forEach(function (c) {
          html += '<button type="button" class="ge-asm-cube" data-place="' + pl.key + '" data-pid="' + c.profileId + '" '
            + 'title="' + esc(c.name) + '" style="background:' + esc(c.color) + '">' + esc(c.name) + '</button>';
        });
        html += '</div></div>';
      });
      html += '</div></div>';
    }
    dyn.innerHTML = html;
    refreshMap();
  }
  function msg(text, ok) {
    var el = document.getElementById('ge-msg');
    if (!el) return;
    el.textContent = text;
    el.className = 'ge-msg ' + (ok ? 'ok' : 'err');
  }
  // Lazy-load the REAL client card renderer + every card-data store once, then
  // resolve any card id (patent / freighter / Bernal / colonist / crew) to its
  // full record so the admin can preview the actual card, not just its name.
  var _cardLib = null;
  function loadCardLib() {
    if (_cardLib) return _cardLib;
    _cardLib = Promise.all([
      import('/js/game/card-ui.js'),
      import('/data/patents.js'),
      import('/data/crew.js'),
      import('/data/bernals.js'),
      import('/data/colonists.js')
    ]).then(function (m) {
      var byId = Object.assign({}, m[1].PATENTS_BY_ID, m[3].BERNALS_BY_ID, m[4].COLONISTS_BY_ID, m[2].CREW_BY_ID);
      return { renderCard: m[0].renderCard, attachTipsTo: m[0].attachTipsTo, byId: byId };
    });
    return _cardLib;
  }
  // Pop a preview of one card: BOTH faces side by side (left = white / primary,
  // right = black / secondary), so the right face shows its text too. Uses the
  // same renderCard the player UI does, so the admin sees exactly what players do.
  function openCardPreview(cardId, label) {
    loadCardLib().then(function (lib) {
      var card = lib.byId[cardId];
      var ov = document.createElement('div'); ov.className = 'ge-cardview-overlay';
      var box = document.createElement('div'); box.className = 'ge-cardview-box';
      var head = document.createElement('div'); head.className = 'ge-cardview-h';
      head.innerHTML = '<strong>' + esc(label || (card && card.name) || cardId) + '</strong>';
      var closeBtn = document.createElement('button'); closeBtn.className = 'ge-cardview-close'; closeBtn.textContent = 'Close';
      head.appendChild(closeBtn); box.appendChild(head);
      if (!card) {
        var miss = document.createElement('p'); miss.style.color = '#f99';
        miss.textContent = 'No card data for id "' + cardId + '".'; box.appendChild(miss);
      } else {
        var faces = document.createElement('div'); faces.className = 'ge-cardview-faces';
        [['primary', 'White / front'], ['secondary', 'Black / back']].forEach(function (pair) {
          if (!(card.faces && card.faces[pair[0]])) return;
          var col = document.createElement('div'); col.className = 'ge-cardview-face';
          var cap = document.createElement('span'); cap.textContent = pair[1]; col.appendChild(cap);
          col.appendChild(lib.renderCard(card, { face: pair[0] }));
          faces.appendChild(col);
        });
        box.appendChild(faces);
        if (lib.attachTipsTo) lib.attachTipsTo(box);
      }
      function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); document.removeEventListener('keydown', onKey); }
      function onKey(e) { if (e.key === 'Escape') close(); }
      closeBtn.addEventListener('click', close);
      ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
      document.addEventListener('keydown', onKey);
      ov.appendChild(box); document.body.appendChild(ov);
    }).catch(function (e) { msg('Card preview failed to load: ' + (e && e.message || e), false); });
  }
  function reload(after) {
    fetch('/admin/games/' + current.gid + '/state').then(function (r) { return r.json(); }).then(function (d) {
      if (d.ok) { current.state = d.state; current.catalog = d.catalog || current.catalog; render(); if (after) after(); }
    });
  }
  function load(gid, label) {
    current.gid = gid;
    var rm = document.getElementById('room-modal'); if (rm) rm.hidden = true;   // close the room modal behind it
    title.textContent = 'Manage state: ' + label;
    body.innerHTML = '<p><em>Loading…</em></p>';
    modal.hidden = false;
    mapApi = null; pickedSlug = null; pendingMove = null;   // fresh modal -> remount the map
    fetch('/admin/games/' + gid + '/state').then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) { body.innerHTML = '<p class="ge-msg err">Failed: ' + esc(d.error || 'error') + '</p>'; return; }
      current.state = d.state; current.catalog = d.catalog || [];
      actorPid = null;   // reset acting player to the first on a fresh load
      // Skeleton: the map section (built once, holds the live canvas) + a
      // dynamic section render() rewrites for the player / card / cube tools.
      body.innerHTML = buildMapSection() + '<div id="ge-dynamic"></div>';
      mountMap();
      render();
    }).catch(function () { body.innerHTML = '<p class="ge-msg err">Network error.</p>'; });
  }
  function postEdit(payload, okText) {
    fetch('/admin/games/' + current.gid + '/edit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.ok) { reload(function () { msg(okText || 'Applied.', true); }); }
      else msg('Failed: ' + (d.error || 'error'), false);
    }).catch(function () { msg('Network error.', false); });
  }
  var pickedCube = null;   // { pid, from } for the assembly cube move tool
  function clearCubeSel() {
    var el = body.querySelector('.ge-asm-cube.sel');
    if (el) el.classList.remove('sel');
    pickedCube = null;
  }
  body.addEventListener('click', function (ev) {
    // Card name clicked -> preview the real rendered card (both faces). Lives
    // first so it wins over the row's move/remove controls.
    var nameEl = ev.target.closest('.ge-card .ge-name');
    if (nameEl) {
      var cardRow = nameEl.closest('.ge-card');
      if (cardRow) { openCardPreview(cardRow.getAttribute('data-cid'), nameEl.textContent); return; }
    }
    // Map: acting-player chip -> set who map clicks act on (re-highlight + the
    // rocket focus ring follow; the player/card list below is unaffected).
    var chip = ev.target.closest('.ge-actor-chip');
    if (chip) { actorPid = Number(chip.getAttribute('data-pid')); refreshActorChips(); refreshMap(); return; }
    // Map: "Locate" buttons. Rocket flies straight to the single ship; factories
    // and outposts open a picker listing each one so you can jump to a specific
    // site (and act on it).
    var loc = ev.target.closest('.ge-locate button[data-loc]');
    if (loc) {
      if (!mapApi) return;
      var which = loc.getAttribute('data-loc');
      if (which === 'rocket') mapApi.focusRocket();
      else if (which === 'factories') openLocatePicker('factories');
      else if (which === 'outposts') openLocatePicker('outposts');
      return;
    }
    // (Locate-picker rows wire their own click handler in openLocatePicker; the
    // popup is appended to document.body, outside this delegated listener.)
    // (Map node clicks are handled by the renderer's onSelect -> openWizard; the
    // wizard popup wires its own buttons.)
    // Assembly cube manager: click a cube to pick it up, click a space to drop.
    var cube = ev.target.closest('.ge-asm-cube');
    if (cube) {
      if (cube.classList.contains('sel')) { clearCubeSel(); return; }   // toggle off
      clearCubeSel();
      cube.classList.add('sel');
      pickedCube = { pid: Number(cube.getAttribute('data-pid')), from: cube.getAttribute('data-place') };
      msg('Cube picked up - click a space to move it there.', true);
      return;
    }
    var space = ev.target.closest('.ge-asm-space');
    if (space && pickedCube) {
      var to = space.getAttribute('data-place');
      var sel = pickedCube;
      if (to === sel.from) { clearCubeSel(); return; }
      clearCubeSel();
      postEdit({ action: 'move_cube', profileId: sel.pid, from: sel.from, to: to }, 'Cube moved.');
      return;
    }
    var btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    var act = btn.getAttribute('data-act');
    var pEl = btn.closest('.ge-player');
    if (!pEl) return;
    var pid = Number(pEl.getAttribute('data-pid'));
    if (act === 'set_aqua') {
      postEdit({ action: 'set_aqua', profileId: pid, value: Number(pEl.querySelector('.ge-aqua').value) }, 'Aqua set.');
    } else if (act === 'set_water') {
      postEdit({ action: 'set_water', profileId: pid, value: Number(pEl.querySelector('.ge-water').value), grade: pEl.querySelector('.ge-grade').value }, 'Tank set.');
    } else if (act === 'teleport') {
      var node = (pEl.querySelector('.ge-tp-node').value || '').trim();
      if (!node) { msg('Enter a node id or name to teleport to.', false); return; }
      postEdit({ action: 'teleport', profileId: pid, node: node }, 'Rocket teleported.');
    } else if (act === 'grant_powersat') {
      postEdit({ action: 'set_privilege', profileId: pid, key: 'POWERSAT', on: true }, 'Powersat granted.');
    } else if (act === 'revoke_powersat') {
      postEdit({ action: 'set_privilege', profileId: pid, key: 'POWERSAT', on: false }, 'Powersat revoked.');
    } else if (act === 'give') {
      postEdit({ action: 'give_card', profileId: pid, cardId: pEl.querySelector('.ge-give-card').value, to: pEl.querySelector('.ge-give-loc').value }, 'Card granted.');
    } else if (act === 'promote_unit') {
      postEdit({ action: 'promote_unit', profileId: pid, unit: btn.getAttribute('data-unit'), on: btn.getAttribute('data-on') === '1' }, 'Unit updated.');
    } else if (act === 'move' || act === 'remove' || act === 'flip') {
      var cardEl = btn.closest('.ge-card');
      if (!cardEl) return;
      var cid = cardEl.getAttribute('data-cid');
      var from = cardEl.getAttribute('data-loc');
      if (act === 'move') postEdit({ action: 'move_card', profileId: pid, cardId: cid, from: from, to: cardEl.querySelector('.ge-move').value }, 'Card moved.');
      else if (act === 'flip') postEdit({ action: 'flip_card', profileId: pid, cardId: cid, from: from }, 'Card flipped.');
      else postEdit({ action: 'remove_card', profileId: pid, cardId: cid, from: from }, 'Card removed.');
    }
  });
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('.btn-manage-game');
    if (!b) return;
    load(b.getAttribute('data-gid'), b.getAttribute('data-lname') + ' (' + b.getAttribute('data-lcode') + ')');
  });
})();
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

// Unlink the Discord account from a profile. Use when someone linked the
// WRONG game account to their Discord: dropping the discord_accounts row
// frees the Discord ID so they can link the correct account. The profile
// (and all its other data) is untouched.
app.post('/admin/profiles/:id/unlink-discord', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
  const row = db.prepare('SELECT id, name FROM profiles WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const info = db.prepare('DELETE FROM discord_accounts WHERE profile_id = ?').run(id);
  res.json({ ok: true, name: row.name, unlinked: info.changes > 0 });
});

// Reassign (move) a Discord link from one profile to another. Use when the
// Discord owner linked the WRONG game account: instead of unlink + re-auth,
// move the existing discord_accounts row to the correct profile in one step.
// :id is the SOURCE profile (currently holds the link); body.toId is the
// DESTINATION. The source is freed (its Discord link + DM target cleared) and
// the destination receives the Discord identity + DM target. If the
// destination already had a DIFFERENT Discord linked, that prior link is
// dropped (its Discord id is freed) so the destination ends with exactly the
// moved identity. Reuses linkDiscordAccount so the result matches the OAuth
// linking path. requireAdmin-gated.
app.post('/admin/profiles/:id/reassign-discord', requireAdmin, (req, res) => {
  const fromId = Number(req.params.id);
  const toId = Number(req.body && req.body.toId);
  if (!Number.isFinite(fromId) || !Number.isFinite(toId)) return res.status(400).json({ error: 'bad_id' });
  if (fromId === toId) return res.status(400).json({ error: 'same_profile' });
  const from = db.prepare('SELECT id, name FROM profiles WHERE id = ?').get(fromId);
  const to = db.prepare('SELECT id, name FROM profiles WHERE id = ?').get(toId);
  if (!from || !to) return res.status(404).json({ error: 'not_found' });
  const link = db.prepare('SELECT discord_id, username FROM discord_accounts WHERE profile_id = ?').get(fromId);
  if (!link) return res.status(409).json({ error: 'not_linked' });
  db.transaction(() => {
    // Move the auth identity onto the destination. linkDiscordAccount clears
    // any prior link the destination held, then INSERT OR REPLACE reclaims
    // the discord_id from the source (discord_id is the PK) - so the source
    // row is dropped automatically.
    linkDiscordAccount(link.discord_id, toId, link.username);
    // Move the turn-DM target too: clear the source's, set the destination's.
    db.prepare('UPDATE notify_prefs SET discord_user_id = NULL, updated_at = ? WHERE profile_id = ?')
      .run(nowMs(), fromId);
    db.prepare(
      `INSERT INTO notify_prefs (profile_id, discord_user_id, notify_turn, notify_auction, updated_at)
       VALUES (?, ?, 1, 1, ?)
       ON CONFLICT(profile_id) DO UPDATE SET discord_user_id = excluded.discord_user_id, updated_at = excluded.updated_at`
    ).run(toId, link.discord_id, nowMs());
  })();
  res.json({ ok: true, fromName: from.name, toName: to.name, discordName: link.username || link.discord_id });
});

// Hard-delete a profile and everything it owns. Cascade tables (tokens,
// notify_prefs, oauth_states, discord_accounts, turn_reminders.target_id)
// clear automatically; the non-cascade references are removed here in one
// transaction so the FK-enforced DELETE succeeds. Refused when the account
// is in any game or hosts a table - those rows are shared state whose
// removal would corrupt other players' games, so the admin must cancel
// those tables first.
app.post('/admin/profiles/:id/delete', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
  const row = db.prepare('SELECT id, name FROM profiles WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const games = db.prepare(
    `SELECT (SELECT COUNT(*) FROM game_players WHERE profile_id = ?)
          + (SELECT COUNT(*) FROM game_operations WHERE profile_id = ?) AS n`
  ).get(id, id);
  if (games.n > 0) return res.status(409).json({ error: 'in_games' });
  const hosts = db.prepare('SELECT COUNT(*) AS n FROM lobbies WHERE host_id = ?').get(id);
  if (hosts.n > 0) return res.status(409).json({ error: 'hosts_tables' });
  db.transaction(() => {
    db.prepare('DELETE FROM direct_invites WHERE from_id = ? OR to_id = ?').run(id, id);
    db.prepare('DELETE FROM invite_links WHERE created_by = ?').run(id);
    db.prepare('UPDATE invite_links SET used_by = NULL WHERE used_by = ?').run(id);
    db.prepare('DELETE FROM chat_messages WHERE profile_id = ?').run(id);
    db.prepare('DELETE FROM lobby_members WHERE profile_id = ?').run(id);
    db.prepare('DELETE FROM turn_reminders WHERE sender_id = ?').run(id);
    db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
  })();
  res.json({ ok: true, name: row.name });
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
      "UPDATE lobbies SET status = 'cancelled', cancelled_at = ? WHERE id = ? AND status != 'cancelled'"
    ).run(now, id);
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
      db.prepare("UPDATE lobbies SET status = 'started', cancelled_at = NULL WHERE id = ?").run(id);
    } else {
      db.prepare("UPDATE lobbies SET status = 'waiting', cancelled_at = NULL WHERE id = ?").run(id);
    }
  })();
  res.json({ ok: true });
});

// Admin game-state editor: read the flattened state for a room's active game.
app.get('/admin/games/:gameId/state', requireAdmin, (req, res) => {
  const gameId = Number(req.params.gameId);
  if (!Number.isFinite(gameId)) return res.status(400).json({ error: 'bad_id' });
  const view = adminGameStateView(gameId);
  if (!view) return res.status(404).json({ error: 'no_game_state' });
  res.json({ ok: true, gameId, state: view, catalog: cardCatalog(view) });
});

// Turn log for the admin room modal: the game's op log, the same record the
// in-game mission log renders. Each row carries the actor's name + seat colour
// (parsed from the current state) so the admin view can tint @names like the
// client. Newest-first, capped so a long game does not dump megabytes.
app.get('/admin/games/:gameId/ops', requireAdmin, (req, res) => {
  const gameId = Number(req.params.gameId);
  if (!Number.isFinite(gameId)) return res.status(400).json({ error: 'bad_id' });
  // profileId -> seat colour, from the live state (colours are fixed at pick).
  const colourById = {};
  try {
    const strow = db.prepare('SELECT state FROM game_states WHERE game_id = ?').get(gameId);
    if (strow) {
      const st = JSON.parse(strow.state);
      for (const p of (st.players || [])) if (p && p.color) colourById[p.profileId] = p.color;
    }
  } catch { /* ignore a malformed blob */ }
  const rows = db.prepare(
    `SELECT go.seq, go.kind, go.log, go.profile_id AS profileId,
            go.created_at AS createdAt, p.name AS playerName
     FROM game_operations go
     LEFT JOIN profiles p ON p.id = go.profile_id
     WHERE go.game_id = ? AND go.log IS NOT NULL AND go.log != ''
     ORDER BY go.seq DESC
     LIMIT 500`
  ).all(gameId);
  const ops = rows.map((r) => ({
    seq: r.seq, kind: r.kind, log: r.log, playerName: r.playerName,
    color: colourById[r.profileId] || null, createdAt: r.createdAt,
  }));
  res.json({ ok: true, gameId, ops });
});

// Admin game-state editor: apply one mutation to a player's state. Actions:
//   move_card   { profileId, cardId, from, to }
//   give_card   { profileId, cardId, to }        (module-gated per card type)
//   remove_card { profileId, cardId, from }
//   flip_card   { profileId, cardId, from, face? }  (toggle white/black or
//                 promote to purple; promo card types gate on the module)
//   promote_unit { profileId, unit: 'freighter'|'bernal:<i>', on }
//   set_aqua    { profileId, value }
//   set_water   { profileId, value, grade? }
//   teleport    { profileId, node }              (node id/slug OR site name)
//   create_factory   { profileId, siteId, colony }  (+ claim disc; colony = bool)
//   reassign_factory { profileId, siteId }           (give factory+colony+claim)
//   move_factory     { fromSiteId, toSiteId }        (relocate to another site)
//   remove_factory   { siteId }
// `from` / `to` are 'hand' | 'leo' | 'rocket' | 'outpost:<letter>'.
app.post('/admin/games/:gameId/edit', requireAdmin, (req, res) => {
  const gameId = Number(req.params.gameId);
  if (!Number.isFinite(gameId)) return res.status(400).json({ error: 'bad_id' });
  const body = req.body || {};
  const st = db.prepare('SELECT state FROM game_states WHERE game_id = ?').get(gameId);
  if (!st) return res.status(404).json({ error: 'no_game_state' });
  const state = JSON.parse(st.state);
  const player = (state.players || []).find((p) => p.profileId === Number(body.profileId));
  if (!player) return res.status(400).json({ error: 'no_player' });
  const name = player.name;
  let log = '';

  if (body.action === 'move_card') {
    const entry = takeCardFrom(player, body.from, body.cardId);
    if (!entry) return res.status(400).json({ error: 'card_not_in_from' });
    if (!addCardTo(player, body.to, entry)) {
      addCardTo(player, body.from, entry);   // restore on a bad target
      return res.status(400).json({ error: 'bad_to' });
    }
    fixupRocketPointers(player);
    log = `Correction: ${name}'s ${cardLabel(body.cardId)} moved from ${locLabel(body.from)} to ${locLabel(body.to)}.`;
  } else if (body.action === 'give_card') {
    const card = PATENTS_BY_ID[body.cardId];
    if (!card) return res.status(400).json({ error: 'unknown_card' });
    // Module content stays out of rooms that do not run the module.
    const mod = cardModule(card);
    if (mod === 'm1' && !state.m1) return res.status(400).json({ error: 'm1_off' });
    if (mod === 'm2' && !state.m2) return res.status(400).json({ error: 'm2_off' });
    if (!addCardTo(player, body.to, { id: body.cardId, kind: slotKindFor(body.cardId) })) return res.status(400).json({ error: 'bad_to' });
    log = `Correction: ${name} was granted ${cardLabel(body.cardId)} into ${locLabel(body.to)}.`;
  } else if (body.action === 'flip_card') {
    // Flip a stacked card's face: white <-> black, or a promo-class card
    // (colonist / GW thruster / Freighter / Bernal) to its purple side.
    if (body.from === 'hand') return res.status(400).json({ error: 'hand_has_no_face' });
    const arr = listFor(player, body.from);
    const slot = arr && arr.find((s) => s.id === body.cardId);
    if (!slot) return res.status(400).json({ error: 'card_not_in_from' });
    const card = PATENTS_BY_ID[slot.id];
    const mod = cardModule(card);
    if (mod === 'm1' && !state.m1) return res.status(400).json({ error: 'm1_off' });
    if (mod === 'm2' && !state.m2) return res.status(400).json({ error: 'm2_off' });
    const face = (body.face === 'primary' || body.face === 'secondary')
      ? body.face
      : (slot.face === 'secondary' ? 'primary' : 'secondary');
    if (face === (slot.face || 'primary')) return res.status(400).json({ error: 'already_that_face' });
    slot.face = face;
    fixupRocketPointers(player);
    const promo = mod != null;   // colonist / gw-thruster / freighter / bernal flip = promotion
    const sideName = face === 'secondary' ? (promo ? 'purple (promoted)' : 'black') : 'white';
    log = `Correction: ${name}'s ${cardLabel(slot.id)} in ${locLabel(body.from)} flipped to its ${sideName} side.`;
  } else if (body.action === 'promote_unit') {
    // Promote / demote a deployed unit (the Freighter big cube or a Bernal
    // colony) - the unit-level promoted flag, not a stack slot.
    const on = body.on !== false;
    const unit = String(body.unit || '');
    if (unit === 'freighter') {
      if (!state.m1) return res.status(400).json({ error: 'm1_off' });
      if (!player.freighter) return res.status(400).json({ error: 'no_freighter' });
      player.freighter.promoted = on;
      player.freighter.face = on ? 'secondary' : 'primary';
      log = `Correction: ${name}'s Freighter ${on ? 'promoted to its purple side' : 'returned to its white side'}.`;
    } else {
      const mb = /^bernal:(\d+)$/.exec(unit);
      const bn = mb && (player.bernals || [])[Number(mb[1])];
      if (!mb) return res.status(400).json({ error: 'bad_unit' });
      if (!state.m2) return res.status(400).json({ error: 'm2_off' });
      if (!bn) return res.status(400).json({ error: 'no_bernal' });
      bn.promoted = on;
      bn.face = on ? 'secondary' : 'primary';
      log = `Correction: ${name}'s ${cardLabel(bn.cardId)} ${on ? 'promoted to its Lab side' : 'returned to its white side'}.`;
    }
  } else if (body.action === 'remove_card') {
    const entry = takeCardFrom(player, body.from, body.cardId);
    if (!entry) return res.status(400).json({ error: 'card_not_in_from' });
    fixupRocketPointers(player);
    log = `Correction: ${name}'s ${cardLabel(body.cardId)} was removed from ${locLabel(body.from)}.`;
  } else if (body.action === 'set_aqua') {
    const v = Math.max(0, Math.floor(Number(body.value) || 0));
    player.aqua = v;
    log = `Correction: ${name}'s aqua set to ${v}.`;
  } else if (body.action === 'set_water') {
    const v = Math.max(0, Number(body.value) || 0);
    player.rocket = player.rocket || {};
    player.rocket.tank = v;
    if (body.grade === 'water' || body.grade === 'dirt') player.rocket.tankGrade = body.grade;
    log = `Correction: ${name}'s rocket tank set to ${v} ${player.rocket.tankGrade || 'water'}.`;
  } else if (body.action === 'teleport') {
    // Move a unit (rocket / freighter / bernal:N) to an arbitrary node. The
    // reference may be a node id (slug) or a site name; it MUST resolve to a real
    // graph node. A teleport invalidates that unit's planned route. `unit`
    // defaults to 'rocket' so existing callers keep working.
    const slug = resolveNodeRef(body.node);
    if (!slug) return res.status(400).json({ error: 'unknown_node' });
    const node = nodeBySlug(slug);
    const where = (node && node.name) ? node.name : slug;
    const unit = body.unit || 'rocket';
    if (unit === 'freighter') {
      if (!player.freighter) return res.status(400).json({ error: 'no_freighter' });
      player.freighter.siteId = slug;
      player.freighter.route = [];
      log = `Correction: ${name}'s freighter teleported to ${where} (${slug}).`;
    } else {
      const mb = /^bernal:(\d+)$/.exec(unit);
      if (mb) {
        const bn = (player.bernals || [])[Number(mb[1])];
        if (!bn) return res.status(400).json({ error: 'no_bernal' });
        bn.siteId = slug;
        bn.route = [];
        log = `Correction: ${name}'s Bernal ${Number(mb[1]) + 1} teleported to ${where} (${slug}).`;
      } else {
        player.rocket = player.rocket || {};
        player.rocket.siteId = slug;
        player.rocket.route = [];
        log = `Correction: ${name}'s rocket teleported to ${where} (${slug}).`;
      }
    }
  } else if (body.action === 'create_factory') {
    // Place a factory (optionally with a colony dome) at a real site for testing.
    // Factories sit on sites only - a waypoint (lagrange / burn) has no site
    // record, so reject those. Spectral type follows the site, like INDUSTRIALIZE.
    // A factory always carries the owner's CLAIM disc (a real factory is built on
    // a successful claim), so place a success disc too.
    const slug = resolveNodeRef(body.siteId);
    const site = slug ? siteBySlug(slug) : null;
    if (!site) return res.status(400).json({ error: 'not_a_site' });
    state.factories = state.factories || {};
    state.discs = state.discs || {};
    state.factories[slug] = { ownerId: player.profileId, spectralType: site.spectralType || 'C' };
    state.discs[slug] = { outcome: 'success', ownerId: player.profileId, roll: 1, canReroll: false };
    let tail = '';
    if (body.colony) {
      state.colonies = state.colonies || {};
      state.colonies[slug] = { ownerId: player.profileId };
      tail = ' with a colony dome';
    }
    log = `Correction: Factory${tail} (+ claim) placed at ${site.name || slug} (spectral ${site.spectralType || 'C'}) for ${name}.`;
  } else if (body.action === 'reassign_factory') {
    // Give an existing factory (and its colony + claim) to the chosen player.
    const slug = resolveNodeRef(body.siteId);
    if (!slug || !(state.factories && state.factories[slug])) return res.status(400).json({ error: 'no_factory_here' });
    state.factories[slug].ownerId = player.profileId;
    if (state.colonies && state.colonies[slug]) state.colonies[slug].ownerId = player.profileId;
    if (state.discs && state.discs[slug]) state.discs[slug].ownerId = player.profileId;
    log = `Correction: Factory at ${siteNameOf(slug)} reassigned to ${name}.`;
  } else if (body.action === 'move_factory') {
    // Relocate a factory (with its colony + claim) to another real site - e.g.
    // when components run out and the admin wants to reposition it for testing.
    const from = resolveNodeRef(body.fromSiteId);
    const to = resolveNodeRef(body.toSiteId);
    if (!from || !(state.factories && state.factories[from])) return res.status(400).json({ error: 'no_factory_here' });
    const toSite = to ? siteBySlug(to) : null;
    if (!toSite) return res.status(400).json({ error: 'not_a_site' });
    if (from === to) return res.status(400).json({ error: 'same_site' });
    if (state.factories[to]) return res.status(400).json({ error: 'target_has_factory' });
    const fac = state.factories[from];
    fac.spectralType = toSite.spectralType || fac.spectralType || 'C';   // spectral follows the new site
    state.factories[to] = fac;
    delete state.factories[from];
    state.colonies = state.colonies || {};
    if (state.colonies[from]) { state.colonies[to] = state.colonies[from]; delete state.colonies[from]; }
    state.discs = state.discs || {};
    if (state.discs[from]) { state.discs[to] = state.discs[from]; delete state.discs[from]; }
    log = `Correction: Factory moved from ${siteNameOf(from)} to ${toSite.name || to}.`;
  } else if (body.action === 'remove_factory') {
    const slug = resolveNodeRef(body.siteId);
    if (!slug) return res.status(400).json({ error: 'unknown_node' });
    const had = !!(state.factories && state.factories[slug]);
    if (state.factories) delete state.factories[slug];
    if (state.colonies) delete state.colonies[slug];
    if (state.discs) delete state.discs[slug];
    if (!had) return res.status(400).json({ error: 'no_factory_here' });
    log = `Correction: Factory removed at ${siteNameOf(slug)}.`;
  } else if (body.action === 'move_cube') {
    // Move one of this player's Assembly delegates from one politics space to
    // another. Admin-only correction; does not touch homeIdeology.
    const asm = state.assembly;
    if (!asm || !asm.delegates) return res.status(400).json({ error: 'no_assembly' });
    const from = String(body.from || '');
    const to = String(body.to || '');
    if (!ASSEMBLY_PLACES.includes(from) || !ASSEMBLY_PLACES.includes(to)) return res.status(400).json({ error: 'bad_place' });
    if (from === to) return res.status(400).json({ error: 'same_place' });
    const fromM = asm.delegates[from] || {};
    if ((fromM[player.profileId] | 0) <= 0) return res.status(400).json({ error: 'no_cube_in_from' });
    fromM[player.profileId] -= 1;
    if (fromM[player.profileId] <= 0) delete fromM[player.profileId];
    asm.delegates[to] = asm.delegates[to] || {};
    asm.delegates[to][player.profileId] = (asm.delegates[to][player.profileId] | 0) + 1;
    log = `Correction: ${name}'s delegate moved from ${assemblyPlaceMeta(from).name} to ${assemblyPlaceMeta(to).name}.`;
  } else if (body.action === 'set_privilege') {
    // Grant or revoke a PERMANENT card-power privilege (e.g. POWERSAT from
    // IONOSAT / POWER GIRDLE). These live on player.grantedPrivileges and are
    // not suspended by Anarchy. `key` is the upper-snake privilege key, `on`
    // toggles it. Used to grant Powersat directly when the IONOSAT/Power-Girdle
    // industrialize couldn't be wired in a live game.
    const key = String(body.key || '').trim().toUpperCase().replace(/\s+/g, '_');
    if (!key) return res.status(400).json({ error: 'bad_key' });
    player.grantedPrivileges = Array.isArray(player.grantedPrivileges) ? player.grantedPrivileges : [];
    const had = player.grantedPrivileges.includes(key);
    const want = body.on !== false;   // default ON (grant) unless explicitly off
    if (want && !had) player.grantedPrivileges.push(key);
    else if (!want && had) player.grantedPrivileges = player.grantedPrivileges.filter((k) => k !== key);
    const pretty = key.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    log = `Correction: ${name} ${want ? 'granted' : 'stripped of'} the ${pretty} privilege.`;
  } else {
    return res.status(400).json({ error: 'bad_action' });
  }

  const seq = persistAdminEdit(gameId, state, log, player.profileId);
  res.json({ ok: true, seq, log });
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

// Backfill the colonist queue on m2 games that predate it. An m2 room
// created before the colonization loop shipped has no state.colonistQueue,
// so an anchored Bernal's berth can never be filled (the queue reads 0 and
// Exomigrate never offers). Deal the queue now - a seeded shuffle off the
// game's own seed, minus any colonist somehow already in play - exactly the
// shape createInitialState deals at setup.
(() => {
  const rows = db.prepare('SELECT game_id, state FROM game_states').all();
  let dealt = 0;
  for (const row of rows) {
    let st;
    try { st = JSON.parse(row.state); } catch { continue; }
    if (!st || typeof st !== 'object') continue;
    if (!st.m2) continue;
    if (Array.isArray(st.colonistQueue) && st.colonistQueue.length) continue;
    if (st.status && st.status !== 'active') continue;
    const inPlay = new Set();
    for (const p of (st.players || [])) {
      const scan = (slots) => { for (const s of (slots || [])) if (s && s.kind === 'colonist') inPlay.add(s.id); };
      scan(p.leo);
      scan(p.rocket && p.rocket.stack);
      for (const o of Object.values(p.outposts || {})) if (o) scan(o.cards);
      if (p.freighter) scan(p.freighter.stack);
      for (const bn of (p.bernals || [])) if (bn) scan(bn.stack);
    }
    const gen = makeRng(String(st.seed || row.game_id) + ':colonist-queue-backfill', 0);
    st.colonistQueue = shuffle(gen, COLONISTS.map((c) => c.id).filter((id) => !inPlay.has(id)));
    db.prepare('UPDATE game_states SET state = ? WHERE game_id = ?')
      .run(JSON.stringify(st), row.game_id);
    dealt += 1;
  }
  if (dealt) console.log(`dealt the colonist queue into ${dealt} legacy m2 game(s)`);
})();

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`high-frontier-fan-game listening on :${PORT} (HTTP + WS at /ws)`);
});
