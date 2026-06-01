// Sqlite layer. Single file at the path in DATABASE_PATH (default
// /data/hf.db, mounted on the Fly volume). Schema migrations are
// idempotent CREATE statements run on every startup.
//
// Stage 1 tables: profiles, tokens, lobbies, lobby_members,
// chat_messages, invite_links, direct_invites.
// Stage 3 tables: games, game_players, game_states, game_operations.

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DATABASE_PATH = process.env.DATABASE_PATH || '/data/hf.db';

mkdirSync(dirname(DATABASE_PATH), { recursive: true });

export const db = new Database(DATABASE_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

db.exec(`
  -- Profiles. Mirrors murdoku-companion: case-insensitive unique name,
  -- a sha256(token) credential stored in the tokens table (one row per
  -- device the user has signed in on). Display name keeps the case
  -- the user typed; name_lower is the uniqueness key.
  CREATE TABLE IF NOT EXISTS profiles (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    name_lower    TEXT UNIQUE NOT NULL,
    created_at    INTEGER NOT NULL,
    last_seen_at  INTEGER NOT NULL,
    banned_at     INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_profiles_last_seen
    ON profiles(last_seen_at);

  -- Per-device tokens. The auth middleware looks up the caller's
  -- profile by sha256(token); both the admin "issue recovery code"
  -- flow and the user's "add new device" flow append a row here so
  -- the user's other devices keep working.
  CREATE TABLE IF NOT EXISTS tokens (
    id           INTEGER PRIMARY KEY,
    profile_id   INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    token_hash   TEXT NOT NULL UNIQUE,
    created_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tokens_profile ON tokens(profile_id);

  -- Per-profile out-of-band turn-notification prefs (opt-in; default off
  -- = backwards compatible). discord_user_id is the player's Discord
  -- snowflake; the bot DMs it on the enabled events. Empty / no row =
  -- no notifications.
  CREATE TABLE IF NOT EXISTS notify_prefs (
    profile_id      INTEGER PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    discord_user_id TEXT,
    notify_turn     INTEGER NOT NULL DEFAULT 1,
    notify_auction  INTEGER NOT NULL DEFAULT 1,
    updated_at      INTEGER NOT NULL
  );

  -- Server-wide key/value settings (e.g. the global announcement banner,
  -- and the admin Discord allowlist seeded from the ADMIN_DISCORD_ID
  -- secret on boot). Editable from /admin; surfaced to every client.
  CREATE TABLE IF NOT EXISTS server_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at INTEGER NOT NULL
  );

  -- Admin browser sessions. The /admin panel is gated behind Discord
  -- OAuth: only an allowlisted Discord account can sign in. On a
  -- successful login we mint a random session token, store ONLY its
  -- sha256 here (never the raw token, mirroring the profile tokens
  -- table), and hand the raw token back as an httpOnly cookie.
  CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash  TEXT PRIMARY KEY,
    discord_id  TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_admin_sessions_exp
    ON admin_sessions(expires_at);

  -- A lobby is a pre-game waiting room. Once status flips to 'started'
  -- the lobby becomes the home for an in-progress game; chat and
  -- members carry over. Stage 1 doesn't ship an engine yet, so
  -- "started" is just a flag the host can flip to demo the flow.
  --
  -- join_policy controls how strangers can find this lobby:
  --   open         : anyone can join from the public listing
  --   invite-only  : invisible to the public listing; only people with
  --                  a direct invite or an invite-link code can join
  -- max_rounds: game length in rounds (Sunspot Cube cycles). 5 = short
  -- (default), 6 = medium, 7 = extra long. Frozen into the engine state
  -- at game start; the game finishes once that many rounds have played.
  CREATE TABLE IF NOT EXISTS lobbies (
    id            INTEGER PRIMARY KEY,
    code          TEXT UNIQUE NOT NULL,
    name          TEXT NOT NULL,
    host_id       INTEGER NOT NULL REFERENCES profiles(id),
    max_players   INTEGER NOT NULL DEFAULT 5,
    max_rounds    INTEGER NOT NULL DEFAULT 5,
    join_policy   TEXT NOT NULL DEFAULT 'open',
    status        TEXT NOT NULL DEFAULT 'waiting',
    created_at    INTEGER NOT NULL,
    started_at    INTEGER,
    finished_at   INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_lobbies_status
    ON lobbies(status, created_at DESC);

  -- A lobby's roster. Joining a lobby inserts one row; leaving deletes
  -- it. The host is also a member (inserted by the create-lobby route).
  -- ready is a per-player "I'm ready to start" flag for the host UI.
  CREATE TABLE IF NOT EXISTS lobby_members (
    id            INTEGER PRIMARY KEY,
    lobby_id      INTEGER NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
    profile_id    INTEGER NOT NULL REFERENCES profiles(id),
    joined_at     INTEGER NOT NULL,
    ready         INTEGER NOT NULL DEFAULT 0,
    seat          INTEGER,
    UNIQUE(lobby_id, profile_id)
  );
  CREATE INDEX IF NOT EXISTS idx_lobby_members_lobby
    ON lobby_members(lobby_id);
  CREATE INDEX IF NOT EXISTS idx_lobby_members_profile
    ON lobby_members(profile_id);

  -- Chat. One row per message. Per-lobby channel: members of a lobby
  -- see lobby chat; a future "global" channel can use lobby_id = NULL.
  CREATE TABLE IF NOT EXISTS chat_messages (
    id           INTEGER PRIMARY KEY,
    lobby_id     INTEGER REFERENCES lobbies(id) ON DELETE CASCADE,
    profile_id   INTEGER NOT NULL REFERENCES profiles(id),
    body         TEXT NOT NULL,
    created_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chat_messages_lobby
    ON chat_messages(lobby_id, created_at);

  -- A shareable invite-link code. The host generates one; anyone with
  -- the code can join the lobby (even if the lobby is invite-only) so
  -- long as the link hasn't expired or been used up.
  --   single_use: 1 means the link burns on first claim
  --   used_count: how many distinct profiles have claimed it
  --   used_by:    if single_use, the profile id that claimed it
  CREATE TABLE IF NOT EXISTS invite_links (
    id            INTEGER PRIMARY KEY,
    lobby_id      INTEGER NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
    code          TEXT UNIQUE NOT NULL,
    created_by    INTEGER NOT NULL REFERENCES profiles(id),
    created_at    INTEGER NOT NULL,
    expires_at    INTEGER,
    single_use    INTEGER NOT NULL DEFAULT 0,
    used_count    INTEGER NOT NULL DEFAULT 0,
    used_by       INTEGER REFERENCES profiles(id)
  );
  CREATE INDEX IF NOT EXISTS idx_invite_links_lobby
    ON invite_links(lobby_id);

  -- Direct invite: profile-to-profile, scoped to a specific lobby.
  -- Created by the "Invite @name" flow. Pinged over WS to the target
  -- profile if they're online, otherwise sits in their /invites feed.
  CREATE TABLE IF NOT EXISTS direct_invites (
    id            INTEGER PRIMARY KEY,
    lobby_id      INTEGER NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
    from_id       INTEGER NOT NULL REFERENCES profiles(id),
    to_id         INTEGER NOT NULL REFERENCES profiles(id),
    status        TEXT NOT NULL DEFAULT 'pending',
    created_at    INTEGER NOT NULL,
    responded_at  INTEGER,
    UNIQUE(lobby_id, to_id)
  );
  CREATE INDEX IF NOT EXISTS idx_direct_invites_to
    ON direct_invites(to_id, status, created_at DESC);

  -- A game is created when the host starts a lobby. It pins the RNG
  -- seed (so the deck deal + every roll replays deterministically) and
  -- its lifecycle status. One game per lobby start; a lobby could be
  -- re-used for a rematch later, hence lobby_id is not unique.
  CREATE TABLE IF NOT EXISTS games (
    id           INTEGER PRIMARY KEY,
    lobby_id     INTEGER NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
    seed         INTEGER NOT NULL,
    status       TEXT NOT NULL DEFAULT 'active',
    committed_seq INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    finished_at  INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_games_lobby
    ON games(lobby_id, created_at DESC);

  -- Frozen roster for a game: the seat order + marker colour assigned
  -- when the game started. Turn order is seat order; the live engine
  -- state mirrors these but this table is the durable membership gate
  -- (who may read the game / submit ops).
  CREATE TABLE IF NOT EXISTS game_players (
    id           INTEGER PRIMARY KEY,
    game_id      INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    profile_id   INTEGER NOT NULL REFERENCES profiles(id),
    seat         INTEGER NOT NULL,
    color        TEXT,
    UNIQUE(game_id, profile_id)
  );
  CREATE INDEX IF NOT EXISTS idx_game_players_game
    ON game_players(game_id);
  CREATE INDEX IF NOT EXISTS idx_game_players_profile
    ON game_players(profile_id);

  -- The current authoritative state snapshot, one row per game. seq
  -- is the number of operations applied so far (the state version);
  -- it matches the highest game_operations.seq and lets a client tell
  -- whether its mirror is stale. The snapshot is derived from the op
  -- log and could be rebuilt from it.
  CREATE TABLE IF NOT EXISTS game_states (
    game_id      INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
    state        TEXT NOT NULL,
    seq          INTEGER NOT NULL DEFAULT 0,
    updated_at   INTEGER NOT NULL
  );

  -- Append-only operation log, git-style: every action (including the
  -- seq-0 START, plus UNDO / REDO) is recorded in order with the full
  -- state snapshot it produced (state_after). Nothing is ever deleted,
  -- so the whole game can be reviewed at any point (the snapshot at
  -- seq K is that row's state_after) and a reconnecting client can
  -- fetch just the ops it missed (seq > its last-seen).
  CREATE TABLE IF NOT EXISTS game_operations (
    id           INTEGER PRIMARY KEY,
    game_id      INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    seq          INTEGER NOT NULL,
    profile_id   INTEGER NOT NULL REFERENCES profiles(id),
    kind         TEXT NOT NULL,
    payload      TEXT,
    log          TEXT,
    state_after  TEXT,
    created_at   INTEGER NOT NULL,
    UNIQUE(game_id, seq)
  );
  CREATE INDEX IF NOT EXISTS idx_game_operations_game
    ON game_operations(game_id, seq);
`);

// Idempotent column adds for tables that predate a column. better-sqlite3
// has no "ADD COLUMN IF NOT EXISTS", so we check PRAGMA table_info first.
// Run on every boot; a no-op once the column exists.
function ensureColumn(table, column, ddl) {
  const exists = db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((c) => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
// Lobbies created before game-length was configurable get the default
// (5 rounds). New rows already carry it from the CREATE TABLE above.
ensureColumn('lobbies', 'max_rounds', 'max_rounds INTEGER NOT NULL DEFAULT 5');

export function nowMs() {
  return Date.now();
}
