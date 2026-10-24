// Leaderboards (user 2026-10-24: "we need leader board ... for each mode type
// there m1, 2, m0, solitaire etc, create a leaderboard ... add a button to post
// daily leader boards"), after rubens-solitare-collection's server/notifier.mjs
// summary: the top five of every board in one Discord embed, medals for the
// podium, posted on demand from /admin or once a day.
//
// Data: game_results holds one row per real player per finished game (final VP,
// placing, won). A game is recorded the moment it finishes (recordGame), and a
// background pass (startBackfill) fills in games that finished before this
// existed: ONE game per step with a rest between, because better-sqlite3 is
// synchronous and a long walk would freeze every player (CLAUDE.md, "Board
// history storage").
//
// Who counts: real profiles only. The tutorial (scripted bots) and hot-seat
// tables (one person playing every seat) are never recorded.

// The boards, in display order. A variant gets its own board; every other game
// sorts by the EXACT set of modules it was played with (Modules 0 + 1 + 2 is a
// different game from Module 1 alone), with one-seat games kept apart from
// tables because a solo score is not played against anyone. (User 2026-10-24:
// "modules 0,1,2 dont have a leader board? same with mod 0,1".)
const MODULE_NAMES = { 0: 'Politics', 1: 'Terawatt', 2: 'Colonization' };
// Every module set, most modules first. M2 always brings M0 in this game, but
// the other sets are listed too so no finished game can fall off the boards.
const MODULE_SETS = ['012', '02', '12', '2', '01', '1', '0', ''];
const setEmoji = (mods) => (mods.includes('2') ? '🪐' : mods.includes('1') ? '⚡' : mods.includes('0') ? '🏛' : '🚀');
const setName = (mods) => (!mods ? 'Base game'
  : mods.length === 1 ? `Module ${mods} · ${MODULE_NAMES[mods]}`
    : `Modules ${mods.split('').join(' + ')}`);
const setKey = (mods) => (mods ? `m${mods}` : 'base');
// Each board's colour on Discord (the left edge of its box): the module set's
// highest module, or the variant's own colour (The Sirens in their cyan).
const setColor = (mods) => (mods.includes('2') ? 0xa855f7 : mods.includes('1') ? 0xf97316 : mods.includes('0') ? 0xc09cc0 : 0x38bdf8);
const VARIANTS = [
  { id: 'sirens',   name: 'The Sirens',  emoji: '🌊', color: 0x5eead4 },
  { id: 'hermes',   name: 'Hermes Fall', emoji: '☄', color: 0xef4444 },
  { id: 'altruism', name: 'Altruism',    emoji: '🤝', color: 0x4ade80 },
];
// Two sections, as the Discord post shows them (user 2026-10-24: "a section
// just for SOLO and a section for Multiplayer"). A variant that can be played
// either way gets a board in each.
export const BOARDS = [
  ...MODULE_SETS.map((m) => ({ key: `table-${setKey(m)}`, name: setName(m), group: 'Multiplayer', emoji: setEmoji(m), color: setColor(m), variant: false })),
  ...VARIANTS.map((v) => ({ key: `table-${v.id}`, name: v.name, group: 'Multiplayer', emoji: v.emoji, color: v.color, variant: true })),
  { key: 'ceo', name: 'CEO Solitaire', group: 'Solo', emoji: '💼', color: 0xfbbf24, variant: true },
  ...MODULE_SETS.map((m) => ({ key: `solo-${setKey(m)}`, name: setName(m), group: 'Solo', emoji: setEmoji(m), color: setColor(m), variant: false })),
  ...VARIANTS.map((v) => ({ key: `solo-${v.id}`, name: v.name, group: 'Solo', emoji: v.emoji, color: v.color, variant: true })),
];
export const BOARDS_BY_KEY = Object.fromEntries(BOARDS.map((b) => [b.key, b]));
export const BOARD_GROUPS = ['Multiplayer', 'Solo'];

// Which board a finished game belongs to, or null when it is not ranked.
export function boardFor(state) {
  if (!state || state.tutorial || state.hotSeat) return null;
  const seats = (state.players || []).length;
  const side = seats === 1 ? 'solo' : 'table';
  // The variant comes first: a Sirens game played as CEO Solitaire is still a
  // Sirens game, and it lives on the Sirens board (it used to land on the CEO
  // board, which emptied the Sirens one).
  if (state.sirens) return `${side}-sirens`;
  if (state.hermes) return `${side}-hermes`;
  if (state.altruism) return `${side}-altruism`;
  if (state.ceoSolo) return 'ceo';
  const mods = `${state.m0 ? '0' : ''}${state.m1 ? '1' : ''}${state.m2 ? '2' : ''}`;
  return `${side}-${setKey(mods)}`;
}

// A real profile id (tutorial bots and hot-seat seats carry string ids).
const isRealProfile = (id) => Number.isInteger(id) && id > 0;

// The result rows of one finished game: [{ profileId, name, vp, rank, won }].
// "Won" is what that mode calls a win: first place at a table, a completed
// tenure in CEO Solitaire, the deflection in Hermes Fall, the target in
// Altruism. A one-seat free-play game has no win, only a score.
export function resultsFor(state) {
  const board = boardFor(state);
  if (!board || state.status !== 'finished') return [];
  const scores = Array.isArray(state.finalScores) ? state.finalScores : [];
  const seats = (state.players || []).length;
  return scores
    .filter((s) => s && isRealProfile(s.profileId))
    .map((s) => {
      let won = 0;
      if (state.ceoSolo) won = state.ceoVerdict === 'completed' ? 1 : 0;
      else if (state.hermes) won = state.hermesVerdict === 'deflected' ? 1 : 0;
      else if (state.altruism) won = state.altruismVerdict === 'achieved' ? 1 : 0;
      else if (seats > 1) won = s.rank === 1 ? 1 : 0;
      return { profileId: s.profileId, name: String(s.name || ''), vp: s.total | 0, rank: s.rank | 0, won, seats };
    });
}

export function ensureLeaderboardTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS game_results (
      game_id     INTEGER NOT NULL,
      profile_id  INTEGER NOT NULL,
      name        TEXT NOT NULL,
      board       TEXT NOT NULL,
      vp          INTEGER NOT NULL,
      rank        INTEGER NOT NULL,
      seats       INTEGER NOT NULL,
      won         INTEGER NOT NULL DEFAULT 0,
      finished_at INTEGER NOT NULL,
      PRIMARY KEY (game_id, profile_id)
    );
    CREATE INDEX IF NOT EXISTS idx_game_results_board ON game_results(board, profile_id);
    -- Finished games the backfill already looked at, ranked or not, so it
    -- never parses the same board twice.
    CREATE TABLE IF NOT EXISTS game_results_scanned (
      game_id INTEGER PRIMARY KEY
    );
  `);
  // The board a game sits on is decided when it is recorded, so a change to
  // how boards are split re-reads every finished game: clear the results and
  // let the background pass record them again under the new boards.
  // v2 (2026-10-24): one board per exact module set, not per highest module.
  // v3 (2026-10-24): variants split into a multiplayer and a solo board.
  // v4 (2026-10-24): a variant played as CEO Solitaire stays on its variant's board.
  const SCHEMA = '4';
  const row = db.prepare("SELECT value FROM server_settings WHERE key = 'leaderboard_schema'").get();
  if (!row || row.value !== SCHEMA) {
    db.transaction(() => {
      db.prepare('DELETE FROM game_results').run();
      db.prepare('DELETE FROM game_results_scanned').run();
      db.prepare(
        `INSERT INTO server_settings (key, value, updated_at) VALUES ('leaderboard_schema', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).run(SCHEMA, Date.now());
    })();
  }
}

// Record (or re-record) one finished game. Safe to call twice.
export function recordGame(db, gameId, state, finishedAt) {
  const board = boardFor(state);
  const rows = resultsFor(state);
  const at = Number(finishedAt) || Number(state && state.finishedAt) || Date.now();
  const put = db.prepare(
    `INSERT INTO game_results (game_id, profile_id, name, board, vp, rank, seats, won, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(game_id, profile_id) DO UPDATE SET name = excluded.name, board = excluded.board,
       vp = excluded.vp, rank = excluded.rank, seats = excluded.seats, won = excluded.won,
       finished_at = excluded.finished_at`
  );
  db.transaction(() => {
    db.prepare('DELETE FROM game_results WHERE game_id = ?').run(gameId);
    for (const r of rows) put.run(gameId, r.profileId, r.name, board, r.vp, r.rank, r.seats, r.won, at);
    db.prepare('INSERT OR IGNORE INTO game_results_scanned (game_id) VALUES (?)').run(gameId);
  })();
  return rows.length;
}

// Fill in games that finished before game_results existed. One game per step,
// a rest between, logged as it goes; stops by itself when none are left.
export function startBackfill(db, { restMs = 250, log = console.log } = {}) {
  let done = 0;
  const next = db.prepare(
    `SELECT g.id, g.finished_at, s.state FROM games g JOIN game_states s ON s.game_id = g.id
     WHERE g.status = 'finished' AND g.id NOT IN (SELECT game_id FROM game_results_scanned)
     ORDER BY g.id LIMIT 1`
  );
  const step = () => {
    let row = null;
    try { row = next.get(); } catch (e) { log(`[leaderboard] backfill stopped: ${e.message}`); return; }
    if (!row) { if (done) log(`[leaderboard] backfill finished: ${done} game(s) recorded`); return; }
    try {
      const st = JSON.parse(row.state);
      const n = recordGame(db, row.id, st, row.finished_at);
      done++;
      log(`[leaderboard] backfilled game ${row.id}: ${n} ranked player(s)`);
    } catch (e) {
      db.prepare('INSERT OR IGNORE INTO game_results_scanned (game_id) VALUES (?)').run(row.id);
      log(`[leaderboard] skipped game ${row.id}: ${e.message}`);
    }
    setTimeout(() => setImmediate(step), restMs).unref?.();
  };
  setTimeout(step, 2000).unref?.();
}

// Every board with its standings: each player's best single-game VP, highest
// first (ties go to more wins, then fewer games). Only boards with results.
// game_results is one small row per player per game, so one grouped read is
// cheap; it never touches the board history.
export function leaderboards(db, { limit = 10 } = {}) {
  const rows = db.prepare(
    `SELECT r.board, r.profile_id AS profileId,
            COALESCE(p.name, MAX(r.name)) AS name,
            MAX(r.vp) AS best, COUNT(*) AS games, SUM(r.won) AS wins, MAX(r.finished_at) AS lastAt
       FROM game_results r LEFT JOIN profiles p ON p.id = r.profile_id
      GROUP BY r.board, r.profile_id`
  ).all();
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.board)) by.set(r.board, []);
    by.get(r.board).push(r);
  }
  const out = [];
  for (const b of BOARDS) {
    const list = by.get(b.key);
    if (!list || !list.length) continue;
    list.sort((x, y) => y.best - x.best || y.wins - x.wins || x.games - y.games || x.lastAt - y.lastAt);
    out.push({
      ...b,
      players: list.length,
      // A solo free-play game has no win, only a score.
      showsWins: b.group === 'Multiplayer' || b.variant,
      entries: list.slice(0, limit).map((r, i) => ({
        rank: i + 1, profileId: r.profileId, name: r.name, best: r.best, games: r.games, wins: r.wins | 0,
      })),
    });
  }
  return out;
}

// ----- the Discord post -----

const MEDALS = ['🥇', '🥈', '🥉'];
// A player name as one line of plain text: Discord formatting characters are
// escaped, not dropped, so "Delta_V" stays "Delta_V" (names may hold _ and -).
const clean = (s, max) => String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
  .replace(/([\\`*_~|>])/g, '\\$1');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The summary as Discord messages: one section for Multiplayer and one for Solo
// (user 2026-10-24: "I would post each of those as separate boxes ... a section
// just for SOLO and a section for Multiplayer"). Each section opens with a
// header box, then every board is its own box with its top five. A message
// holds at most 10 boxes, so a long section carries on in a second message.
// Returns [{ embeds }], in posting order.
export function summaryMessages(boards, { date = new Date(), gameUrl } = {}) {
  const day = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  if (!boards.length) {
    return [{ embeds: [{ color: 0xf97316, title: '📋 HIGH FRONTIER LEADERBOARDS', url: gameUrl,
      description: `No finished games on the boards yet, ${day}. Be the first.`, timestamp: date.toISOString() }] }];
  }
  const HEAD = {
    Multiplayer: { title: '👥 MULTIPLAYER LEADERBOARDS', color: 0xf97316, blurb: 'Tables of two or more' },
    Solo: { title: '🧑‍🚀 SOLO LEADERBOARDS', color: 0x38bdf8, blurb: 'One-seat games' },
  };
  const out = [];
  for (const group of BOARD_GROUPS) {
    const inGroup = boards.filter((b) => b.group === group);
    if (!inGroup.length) continue;
    const ranked = inGroup.reduce((n, b) => n + b.players, 0);
    const header = {
      color: HEAD[group].color, title: HEAD[group].title, url: gameUrl,
      description: `${HEAD[group].blurb}: each player's best single-game VP, ${day}. Ties go to more wins.`,
      footer: { text: `${plural(ranked, 'ranked spot')} across ${plural(inGroup.length, 'board')}` },
    };
    const boxes = inGroup.map((b) => ({
      color: b.color,
      title: `${b.emoji} ${b.name}`,
      description: b.entries.slice(0, 5).map((e, i) => {
        const place = MEDALS[i] || `\`${i + 1}.\``;
        const tail = b.showsWins ? ` · ${plural(e.wins, 'win')} in ${plural(e.games, 'game')}` : ` · ${plural(e.games, 'game')}`;
        return `${place} **${clean(e.name, 40)}** · ${e.best} VP${tail}`;
      }).join('\n').slice(0, 4000),
      footer: { text: `${group} · ${plural(b.players, 'player')} ranked` },
    }));
    // First message: the header + up to 9 boards; then 10 boards a message.
    let chunk = [header];
    for (const box of boxes) {
      if (chunk.length === 10) { out.push({ embeds: chunk }); chunk = []; }
      chunk.push(box);
    }
    out.push({ embeds: chunk });
  }
  out[out.length - 1].embeds[out[out.length - 1].embeds.length - 1].timestamp = date.toISOString();
  return out;
}
