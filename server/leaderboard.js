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
// sorts by its highest module, with one-seat games kept apart from tables
// because a solo score is not played against anyone.
export const BOARDS = [
  { key: 'table-m2',   name: 'Module 2 · Colonization', group: 'Table', emoji: '🪐' },
  { key: 'table-m1',   name: 'Module 1 · Terawatt',     group: 'Table', emoji: '⚡' },
  { key: 'table-m0',   name: 'Module 0 · Politics',     group: 'Table', emoji: '🏛' },
  { key: 'table-base', name: 'Base game',               group: 'Table', emoji: '🚀' },
  { key: 'sirens',     name: 'The Sirens',              group: 'Variant', emoji: '🌊' },
  { key: 'hermes',     name: 'Hermes Fall',             group: 'Variant', emoji: '☄' },
  { key: 'altruism',   name: 'Altruism',                group: 'Variant', emoji: '🤝' },
  { key: 'ceo',        name: 'CEO Solitaire',           group: 'Solo', emoji: '💼' },
  { key: 'solo-m2',    name: 'Module 2 · Colonization', group: 'Solo', emoji: '🪐' },
  { key: 'solo-m1',    name: 'Module 1 · Terawatt',     group: 'Solo', emoji: '⚡' },
  { key: 'solo-m0',    name: 'Module 0 · Politics',     group: 'Solo', emoji: '🏛' },
  { key: 'solo-base',  name: 'Base game',               group: 'Solo', emoji: '🚀' },
];
export const BOARDS_BY_KEY = Object.fromEntries(BOARDS.map((b) => [b.key, b]));

// Which board a finished game belongs to, or null when it is not ranked.
export function boardFor(state) {
  if (!state || state.tutorial || state.hotSeat) return null;
  if (state.sirens) return 'sirens';
  if (state.hermes) return 'hermes';
  if (state.altruism) return 'altruism';
  if (state.ceoSolo) return 'ceo';
  const tier = state.m2 ? 'm2' : state.m1 ? 'm1' : state.m0 ? 'm0' : 'base';
  const seats = (state.players || []).length;
  return `${seats === 1 ? 'solo' : 'table'}-${tier}`;
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
      if (board === 'ceo') won = state.ceoVerdict === 'completed' ? 1 : 0;
      else if (board === 'hermes') won = state.hermesVerdict === 'deflected' ? 1 : 0;
      else if (board === 'altruism') won = state.altruismVerdict === 'achieved' ? 1 : 0;
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
      showsWins: b.group !== 'Solo' || b.key === 'ceo',
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

// The daily summary as one Discord embed: a field per board, its top five.
export function summaryEmbed(boards, { date = new Date(), gameUrl } = {}) {
  const day = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const fields = boards.slice(0, 24).map((b) => ({
    name: `${b.emoji} ${b.group.toUpperCase()} · ${b.name.toUpperCase()}`,
    value: b.entries.slice(0, 5).map((e, i) => {
      const place = MEDALS[i] || `\`${i + 1}.\``;
      const tail = b.showsWins
        ? ` · ${plural(e.wins, 'win')} in ${plural(e.games, 'game')}`
        : ` · ${plural(e.games, 'game')}`;
      return `${place} **${clean(e.name, 40)}** · ${e.best} VP${tail}`;
    }).join('\n').slice(0, 1024),
  }));
  const ranked = boards.reduce((n, b) => n + b.players, 0);
  return {
    color: 0xf97316,
    title: '📋 HIGH FRONTIER · DAILY LEADERBOARD',
    url: gameUrl,
    description: boards.length
      ? `Best single-game VP on every board, ${day}. Ties go to more wins.`
      : `No finished games on the boards yet, ${day}. Be the first.`,
    fields,
    footer: { text: `High Frontier fan game · ${plural(ranked, 'ranked spot')} across ${plural(boards.length, 'board')}` },
    timestamp: date.toISOString(),
  };
}
