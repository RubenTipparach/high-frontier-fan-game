// Sqlite layer. Single file at the path in DATABASE_PATH (default
// /data/hf.db, mounted on the Fly volume). Schema migrations are
// idempotent CREATE statements run on every startup.
//
// Stage 1 tables: profiles, tokens, lobbies, lobby_members,
// chat_messages, invite_links, direct_invites.
// Stage 3+ will add: games, game_states, game_operations.

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

  -- A lobby is a pre-game waiting room. Once status flips to 'started'
  -- the lobby becomes the home for an in-progress game; chat and
  -- members carry over. Stage 1 doesn't ship an engine yet, so
  -- "started" is just a flag the host can flip to demo the flow.
  --
  -- join_policy controls how strangers can find this lobby:
  --   open         : anyone can join from the public listing
  --   invite-only  : invisible to the public listing; only people with
  --                  a direct invite or an invite-link code can join
  CREATE TABLE IF NOT EXISTS lobbies (
    id            INTEGER PRIMARY KEY,
    code          TEXT UNIQUE NOT NULL,
    name          TEXT NOT NULL,
    host_id       INTEGER NOT NULL REFERENCES profiles(id),
    max_players   INTEGER NOT NULL DEFAULT 5,
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
`);

export function nowMs() {
  return Date.now();
}
