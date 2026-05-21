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
  res.json({ id: req.profile.id, name: req.profile.name });
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
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    hostId: row.host_id,
    hostName: row.host_name,
    maxPlayers: row.max_players,
    joinPolicy: row.join_policy,
    status: row.status,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    members,
  };
}

function publishLobby(lobbyId) {
  const lobby = lobbyRow(lobbyId);
  if (!lobby) return;
  broadcast(`lobby:${lobbyId}`, { type: 'lobby_update', lobby });
}

// Create a new lobby. Caller becomes the host AND the first member.
// `code` is a 6-char short code so the host can read it over voice.
app.post('/lobbies', requireProfile, (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim().slice(0, 60) || `${req.profile.name}'s table`;
  const maxPlayers = Math.max(2, Math.min(5, Number(body.maxPlayers) || 5));
  const joinPolicy = body.joinPolicy === 'invite-only' ? 'invite-only' : 'open';
  const now = nowMs();
  let code, info;
  for (let attempt = 0; attempt < 5; attempt++) {
    code = generateShortCode(6);
    try {
      info = db
        .prepare(
          `INSERT INTO lobbies (code, name, host_id, max_players, join_policy, status, created_at)
           VALUES (?, ?, ?, ?, ?, 'waiting', ?)`
        )
        .run(code, name, req.profile.id, maxPlayers, joinPolicy, now);
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
  // game has started, leaving is just "go AFK" — host can't disband.
  if (lobby.host_id === req.profile.id && lobby.status === 'waiting') {
    db.prepare('DELETE FROM lobbies WHERE id = ?').run(id);
    broadcast(`lobby:${id}`, { type: 'lobby_disbanded', lobbyId: id });
  } else {
    publishLobby(id);
  }
  res.json({ ok: true });
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

// Host-only. Flips status to 'started'. Stage 1 doesn't ship a game
// engine yet, so for now this just toggles the flag — the client side
// renders a "Coming in Stage 2" splash. Stage 3 will wire this up to
// engine.newGame(lobby).
app.post('/lobbies/:id/start', requireProfile, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
  const lobby = db.prepare('SELECT host_id, status FROM lobbies WHERE id = ?').get(id);
  if (!lobby) return res.status(404).json({ error: 'not_found' });
  if (lobby.host_id !== req.profile.id) return res.status(403).json({ error: 'not_host' });
  if (lobby.status !== 'waiting') return res.status(409).json({ error: 'already_started' });
  db.prepare("UPDATE lobbies SET status = 'started', started_at = ? WHERE id = ?")
    .run(nowMs(), id);
  publishLobby(id);
  res.json({ ok: true });
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
app.get('/invites/links/:code', (req, res) => {
  const code = String(req.params.code || '').toLowerCase();
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
  const code = String(req.params.code || '').toLowerCase();
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
  const m = /^lobby:(\d+)$/.exec(channel);
  if (m) {
    const lobbyId = Number(m[1]);
    const isMember = db
      .prepare('SELECT 1 FROM lobby_members WHERE lobby_id = ? AND profile_id = ?')
      .get(lobbyId, profile.id);
    return !!isMember;
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

// ----- Admin dashboard (minimal) -----

app.get('/admin', (_req, res) => {
  const kpi = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM profiles)                             AS profiles,
         (SELECT COUNT(*) FROM lobbies WHERE status = 'waiting')     AS lobbies_waiting,
         (SELECT COUNT(*) FROM lobbies WHERE status = 'started')     AS lobbies_started,
         (SELECT COUNT(*) FROM chat_messages)                        AS chat_total,
         (SELECT COUNT(*) FROM direct_invites WHERE status = 'pending') AS invites_pending`
    )
    .get();
  const profiles = db
    .prepare(
      `SELECT id, name,
              datetime(created_at / 1000, 'unixepoch')   AS created,
              datetime(last_seen_at / 1000, 'unixepoch') AS seen
       FROM profiles
       ORDER BY last_seen_at DESC
       LIMIT 50`
    )
    .all();
  const lobbies = db
    .prepare(
      `SELECT l.id, l.code, l.name, l.status, l.join_policy,
              datetime(l.created_at / 1000, 'unixepoch') AS created,
              p.name AS host_name,
              (SELECT COUNT(*) FROM lobby_members lm WHERE lm.lobby_id = l.id) AS members
       FROM lobbies l
       JOIN profiles p ON p.id = l.host_id
       ORDER BY l.created_at DESC
       LIMIT 50`
    )
    .all();
  res.set('content-type', 'text/html; charset=utf-8');
  res.send(`<!doctype html>
<html><head><meta charset="utf-8"><title>HF admin</title>
<style>
  body{font:14px ui-sans-serif,system-ui,sans-serif;background:#0c0a16;color:#ece8ff;margin:0;padding:24px;max-width:1100px}
  h1{margin:0 0 8px;color:#7dd3fc}
  h2{margin:28px 0 8px;font-size:14px;color:#38bdf8;letter-spacing:1px;text-transform:uppercase}
  table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
  td,th{border-bottom:1px solid #1e293b;padding:6px 10px;text-align:left;vertical-align:top}
  th{color:#38bdf8;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:1px}
  .num{text-align:right}
  .kpis{display:flex;gap:14px;margin:12px 0;flex-wrap:wrap}
  .kpi{background:#0f172a;border:1px solid #1e293b;padding:10px 14px;border-radius:8px;min-width:90px}
  .kpi strong{font-size:18px;color:#7dd3fc;display:block}
  .kpi span{font-size:12px;color:#64748b}
  code{background:#0f172a;padding:1px 6px;border-radius:4px;font-size:12px}
</style></head>
<body>
  <h1>High Frontier admin</h1>
  <div class="kpis">
    <div class="kpi"><strong>${kpi.profiles}</strong><span>profiles</span></div>
    <div class="kpi"><strong>${kpi.lobbies_waiting}</strong><span>lobbies waiting</span></div>
    <div class="kpi"><strong>${kpi.lobbies_started}</strong><span>games started</span></div>
    <div class="kpi"><strong>${kpi.chat_total}</strong><span>chat messages</span></div>
    <div class="kpi"><strong>${kpi.invites_pending}</strong><span>invites pending</span></div>
  </div>
  <h2>Profiles</h2>
  <table>
    <thead><tr><th>Name</th><th>Created</th><th>Last seen</th></tr></thead>
    <tbody>${profiles.map((r) => `<tr><td>@${esc(r.name)}</td><td>${esc(r.created)}</td><td>${esc(r.seen)}</td></tr>`).join('') || '<tr><td colspan=3>None</td></tr>'}</tbody>
  </table>
  <h2>Lobbies</h2>
  <table>
    <thead><tr><th>Code</th><th>Name</th><th>Host</th><th>Policy</th><th>Status</th><th class="num">Members</th><th>Created</th></tr></thead>
    <tbody>${lobbies.map((r) => `<tr><td><code>${esc(r.code)}</code></td><td>${esc(r.name)}</td><td>@${esc(r.host_name)}</td><td>${esc(r.join_policy)}</td><td>${esc(r.status)}</td><td class="num">${r.members}</td><td>${esc(r.created)}</td></tr>`).join('') || '<tr><td colspan=7>None</td></tr>'}</tbody>
  </table>
</body></html>`);
});

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ----- Boot -----

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`high-frontier-fan-game listening on :${PORT} (HTTP + WS at /ws)`);
});
