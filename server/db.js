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

  -- CSRF state for the admin "Sign in with Discord" flow. Like
  -- discord_login_states below it carries no profile (the admin
  -- authenticates against the Discord allowlist, not a game profile)
  -- and is persisted so it survives a Fly cold-start mid-login.
  CREATE TABLE IF NOT EXISTS admin_login_states (
    state      TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );

  -- One-time CSRF state for the Discord "Connect" OAuth flow. Persisted
  -- (not in-memory) so the token survives a Fly machine restart / cold
  -- start between the authorize redirect and the callback - on Fly the
  -- machine can auto-stop while the user is on Discord's consent screen,
  -- which would wipe an in-memory store and break every link.
  CREATE TABLE IF NOT EXISTS oauth_states (
    state      TEXT PRIMARY KEY,
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  -- CSRF state for the UNauthenticated "Sign in with Discord" flow.
  -- Separate from oauth_states because there is no profile yet (the
  -- callback either finds the linked profile or starts a signup), so it
  -- carries no profile_id. Same short TTL + prune discipline.
  CREATE TABLE IF NOT EXISTS discord_login_states (
    state      TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );

  -- Maps a Discord account to a profile for AUTH (distinct from the
  -- notify_prefs.discord_user_id used only for DM targeting). Linking
  -- via "Connect Discord" or signing up via Discord writes a row here;
  -- a later "Sign in with Discord" looks the profile up by discord_id.
  -- Both columns unique: one Discord account <-> one profile.
  CREATE TABLE IF NOT EXISTS discord_accounts (
    discord_id TEXT PRIMARY KEY,
    profile_id INTEGER NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
    username   TEXT,
    linked_at  INTEGER NOT NULL
  );

  -- One-time handoff from the server-side OAuth callback to the client.
  -- The callback can't hand the browser a session token directly (that
  -- would leak in the redirect URL / history), so it stashes a short-
  -- lived code here; the app exchanges the code for the token (login) or
  -- for a "pick your name" prompt (signup) via a normal API call.
  CREATE TABLE IF NOT EXISTS discord_auth_handoff (
    code       TEXT PRIMARY KEY,
    kind       TEXT NOT NULL,            -- 'login' | 'signup'
    token      TEXT,                     -- login: the minted session token
    profile_id INTEGER,                  -- login: the signed-in profile
    discord_id TEXT,                     -- signup: the Discord account
    username   TEXT,                     -- signup: suggested name
    expires_at INTEGER NOT NULL
  );

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

  -- Turn "nudge" reminders. NOT game state (a nudge changes nothing on
  -- the board), just a per-(game, target) cooldown record so the UI can
  -- show when a player was last reminded and the server can enforce the
  -- throttle. One row per (game, target), upserted on each nudge.
  CREATE TABLE IF NOT EXISTS turn_reminders (
    game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    target_id   INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    sender_id   INTEGER NOT NULL REFERENCES profiles(id),
    sent_at     INTEGER NOT NULL,
    PRIMARY KEY (game_id, target_id)
  );

  -- Player-driven location notes + tags, collected across ALL games (no game_id
  -- scope). kind = 'message' (free text) or 'tag' (a tag key). site_id is the
  -- location's stable display id (what the popup shows as "id: ..."). One row
  -- per message; one row per (site, author, tag) for tags.
  CREATE TABLE IF NOT EXISTS site_annotations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id     TEXT NOT NULL,
    site_name   TEXT,
    profile_id  INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
    author_name TEXT,
    kind        TEXT NOT NULL,
    body        TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_site_annotations_site ON site_annotations(site_id);
  CREATE INDEX IF NOT EXISTS idx_site_annotations_author ON site_annotations(profile_id);

  -- Admin-curated "server tags" for solar-map nodes: the canonical marker
  -- flags (lander / half / hazard / aerobrake) an admin sets on a node from
  -- the /admin/site-notes + /admin/site-tags pages. Distinct from the
  -- player-submitted site_annotations ("what players think"): this is the
  -- server's own authoritative marker tagging. Only EDITED nodes get a row,
  -- so the /admin/site-tags export ships exactly these rows back to
  -- data/node-tag-overrides.json for re-applying to git.
  CREATE TABLE IF NOT EXISTS node_tags (
    site_id    TEXT PRIMARY KEY,
    site_name  TEXT,
    lander     INTEGER NOT NULL DEFAULT 0,
    half       INTEGER NOT NULL DEFAULT 0,
    hazard     INTEGER NOT NULL DEFAULT 0,
    aerobrake  INTEGER NOT NULL DEFAULT 0,
    homeBernal INTEGER NOT NULL DEFAULT 0,
    season     TEXT,
    updated_at INTEGER NOT NULL
  );
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
// Solo-game setup options (honoured only for 1-player rooms; multiplayer is
// always market + the standard starting bank). Nullable: legacy rows and
// normal multiplayer rooms leave them unset and the start path uses defaults.
//   starting_aqua: the bank each player opens with (e.g. 100 free-play vs 6)
//   economy:       'library' (free draws) or 'market' (auctioned)
ensureColumn('lobbies', 'starting_aqua', 'starting_aqua INTEGER');
ensureColumn('lobbies', 'economy', 'economy TEXT');
// draft_start: opt-in "draft round" opening - everyone takes free deck-top
// picks until they hold 12 cards, then banks open at 6 and play begins.
// 0 = off (the default for every legacy + normal room).
ensureColumn('lobbies', 'draft_start', 'draft_start INTEGER NOT NULL DEFAULT 0');
// m0: opt-in Module 0 (Sol Political Assembly). 0 = off, the default for every
// legacy + normal room, so games already in flight stay m0=false (no retro
// apply). Chosen at room creation, carried into the game state at start.
ensureColumn('lobbies', 'm0', 'm0 INTEGER NOT NULL DEFAULT 0');
// m1: opt-in Module 1 (Terawatt & Futures). ADMIN-ONLY + experimental. 0 = off,
// the default for every legacy + normal room, so no game ever gets M1 mechanics
// unless an admin explicitly checked it at creation. The server only ever
// writes 1 when the host passes the admin gate (profileIsAdmin); a non-admin
// request is forced to 0. NOTHING in the engine may act on M1 rules unless
// state.m1 is true (see CLAUDE.md "Module gating").
ensureColumn('lobbies', 'm1', 'm1 INTEGER NOT NULL DEFAULT 0');
// m2: opt-in Module 2 (Futures). ADMIN-ONLY + experimental, mirrors m1. 0 = off,
// the default for every legacy + normal room, so no game ever gets M2 (Futures)
// mechanics unless an admin explicitly checked it at creation. The server only
// ever writes 1 when the host passes the admin gate (profileIsAdmin); a non-admin
// request is forced to 0. NOTHING M2 may activate unless state.m2 is true.
ensureColumn('lobbies', 'm2', 'm2 INTEGER NOT NULL DEFAULT 0');
// ceo_solo: opt-in CEO Solitaire variant (V6). ADMIN-PREVIEW only for now, so a
// non-admin request is forced to 0 (same gate as m2). 0 = off, the default for
// every legacy + normal room. CEO Solitaire forces M0 on at start (the variant
// runs the Solitaire Sol Political Assembly), so a ceo_solo room is always an m0
// game. The V6 engine rules (seniority disks, KPI, board meetings) are NOT wired
// yet; this flag exists so the intro cutscene + board-meeting screen know they
// are in CEO Solitaire, and so the engine has a flag to gate on when it lands.
ensureColumn('lobbies', 'ceo_solo', 'ceo_solo INTEGER NOT NULL DEFAULT 0');
// tutorial: opt-in guided tutorial (the Basic tier). A tutorial room is a solo
// game seated with the human + two scripted bots, market economy, no modules,
// scripted deck order, forced dice, and rails (server/game/tutorial.js). 0 = off,
// the default for every legacy + normal room.
ensureColumn('lobbies', 'tutorial', 'tutorial INTEGER NOT NULL DEFAULT 0');
// random_draft: opt-in "random draft" opening - instead of interactive picks,
// each player is dealt 12 random cards from random decks, then play begins
// (banks at 6). 0 = off (default). Independent of draft_start; random wins if
// both are set.
ensureColumn('lobbies', 'random_draft', 'random_draft INTEGER NOT NULL DEFAULT 0');
// When a lobby was cancelled (admin "Cancel"), so the admin panel can list
// cancelled rooms newest-cancelled-first. Nullable: only set on cancel,
// cleared on restore; legacy cancelled rows fall back to created_at for sort.
ensureColumn('lobbies', 'cancelled_at', 'cancelled_at INTEGER');
// Idempotency key for room creation: a client retry / double-submit carries
// the same key so the server returns the lobby it already made instead of a
// duplicate. Nullable (legacy rows + non-idempotent callers); the partial
// UNIQUE index enforces one lobby per key while letting NULLs coexist.
ensureColumn('lobbies', 'idempotency_key', 'idempotency_key TEXT');
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_lobbies_idem
  ON lobbies(idempotency_key) WHERE idempotency_key IS NOT NULL;`);
// sirens: opt-in V9 The Sirens. Players are Sirenian factions homed at Cordelia
// rather than LEO. 0 = off, the default for every legacy + normal room. Fixed at
// room creation like every other mode flag, and INDEPENDENT of M0/M1/M2 (it
// forces nothing on and nothing forces it on) - except that M0 is REFUSED
// alongside it at creation, because V9 excludes Module 0. The Sirenian Bernal
// home orbits are the SAME nodes as the existing homeBernal anchors (user
// 2026-07-28), so this flag adds no map markers of its own.
ensureColumn('lobbies', 'sirens', 'sirens INTEGER NOT NULL DEFAULT 0');
// hermes: opt-in V5 Hermes Fall, the 1-player deflect-the-asteroid mission.
// ADMIN-ONLY while it is built out (the server forces it to 0 for any non-admin
// request; the hidden checkbox is only UI). 0 = off, the default for every
// legacy + normal room. Like CEO Solitaire and the tutorial it only activates on
// a 1-player start. See docs/variants-tracker.md for what is wired vs pending.
ensureColumn('lobbies', 'hermes', 'hermes INTEGER NOT NULL DEFAULT 0');
// hot_seat: opt-in "pass the device" room. ONE account owns every seat and
// plays them all in turn from a single browser, the way a group shares a laptop
// at the table. The host holds seat 1 as their real profile; the remaining
// hot_seat_seats - 1 seats are LOCAL seats with pseudo profile ids (no profiles
// row, exactly like the tutorial's scripted bots), so the ops route maps the
// owner's calls onto whichever seat is currently active. 0 = off, the default
// for every legacy + normal room. Open to every host (no admin gate): the game
// is already open-information, so a shared device leaks nothing a normal table
// does not.
ensureColumn('lobbies', 'hot_seat', 'hot_seat INTEGER NOT NULL DEFAULT 0');
// hot_seat_seats: how many seats a hot-seat room deals (2..6). Ignored (and
// meaningless) when hot_seat is 0. Defaults to 2 so a legacy / malformed row
// still starts a coherent game.
ensureColumn('lobbies', 'hot_seat_seats', 'hot_seat_seats INTEGER NOT NULL DEFAULT 2');
// cloned_from_game_id: set on a lobby created by "Clone to hot seat", pointing
// at the game whose board was forked. Nullable (every normal room). Purely
// informational - the clone is a fully independent game from the moment it is
// made, and nothing reads back through this to the original.
ensureColumn('lobbies', 'cloned_from_game_id', 'cloned_from_game_id INTEGER');
// node_tags predates the synodic-season column on DBs that created the table
// before seasons shipped; add it idempotently. A space's season ('red' /
// 'yellow' / 'blue', or NULL) gates which Sunspot Cycle phase it can be entered.
ensureColumn('node_tags', 'season', 'season TEXT');
// home-bernal: a space flagged as a valid Home Bernal anchor site (where a
// colonist Bernal may anchor as the crew's home / spawn point). 0 = not a home
// site, the default for every legacy node; an admin sets it on /admin/site-tags.
ensureColumn('node_tags', 'homeBernal', 'homeBernal INTEGER NOT NULL DEFAULT 0');
// NOTE: a short-lived 'sirensAnchor' column lived here. Sirenian Bernal home
// orbits turned out to be the SAME nodes as the homeBernal anchors above (user
// 2026-07-28), so the category was redundant and is gone. Nothing reads or
// writes the column any more; it is left in place on existing databases rather
// than dropped, because sqlite column drops rewrite the table and there is no
// benefit to churning it.

export function nowMs() {
  return Date.now();
}
