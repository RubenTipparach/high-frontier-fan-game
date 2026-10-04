// Storage: what the database is holding, and tools to clear out what nothing
// needs any more. Backs the admin panel's Storage section.
//
// WHERE THE SPACE GOES. game_operations.state_after holds a FULL copy of the
// game state for every single operation, and nothing ever deleted one. A game
// runs to hundreds or thousands of ops, so a game's history is hundreds of
// copies of its board - that column is the database, near enough. (Reported
// 2026-09-23: the volume at 2,226 MB.)
//
// WHAT THOSE SNAPSHOTS ARE STILL FOR, which decides what is safe to clear:
//   - UNDO rebuilds the current turn from the snapshot at games.committed_seq
//     (stateAtSeq in index.js). That one snapshot, and everything after it, is
//     load-bearing for a game in progress. Pruning never touches them.
//   - The mission log and the admin turn log read ROUND + SLOT off each op's
//     snapshot to draw "Turn R.S" boundaries (annotateTurns). A pruned row
//     keeps exactly those two numbers in a tiny stub, so the logs still group.
//   - The history scrubber (GET /games/:id/states/:seq) and the admin's
//     "cards lost at op #" lookup read the full board at a past op. After a
//     prune they answer "history_pruned" for those ops.
// Nothing else reads the column. The op log itself (kind / payload / log) and
// the CURRENT board (game_states) are never touched here.
//
// NEVER ONE BIG QUERY. better-sqlite3 is synchronous: while a statement runs,
// the whole server - every player's request - waits for it. The first version
// of this report measured the history with a single GROUP BY over the whole
// table, and on the 2.2 GB production volume that froze the server outright
// (2026-09-23). So every scan and every prune here works a BATCH of rows of one
// game at a time and yields to the event loop between batches, and the size
// scan runs in the background with its result cached for the panel to poll.
//
// SQLite does not give space back to the disk when rows shrink - it keeps the
// freed pages for reuse. Pruning stops the file GROWING; VACUUM is what makes
// it SMALLER. VACUUM cannot be batched: it rewrites the whole file in one go,
// so it is only quick once the history is pruned.
//
// Sizes come from octet_length(), which SQLite answers from the record header
// without reading the value's overflow pages, so measuring never loads a board.

import { statSync, statfsSync } from 'node:fs';
import { dirname } from 'node:path';
import { db, DATABASE_PATH, nowMs } from './db.js';

// Anything at or below this many bytes is already a pruned stub (a stub is
// ~40 bytes; a real board is kilobytes). Lets every query skip pruned rows by
// size alone, from the header, instead of parsing JSON to look for the flag.
const STUB_MAX_BYTES = 200;
// Rows per batch. A full board is ~5-30 KB, so a prune batch rewrites at most a
// megabyte or two and a size batch reads only record headers.
const BATCH_ROWS = 100;
// Yield to waiting requests at least this often, whatever the batch size.
const SLICE_MS = 15;

const yieldNow = () => new Promise((resolve) => setImmediate(resolve));

// Is this parsed snapshot a pruned stub rather than a real board?
export function isPrunedSnapshot(state) {
  return !!(state && state._pruned);
}

function fileSize(path) {
  try { return statSync(path).size; } catch { return 0; }
}

// ---- the background size scan -------------------------------------------

// The last scan's result, kept for the panel. `games` maps gameId to that
// game's numbers so a prune can correct them in place instead of rescanning.
const scan = {
  status: 'idle',          // idle | running | done
  startedAt: null, finishedAt: null,
  gamesDone: 0, gamesTotal: 0,
  games: new Map(),        // gameId -> { gameId, status, ops, snapshotBytes, prunableBytes }
};

const opRange = () => db.prepare(
  'SELECT MIN(seq) AS lo, MAX(seq) AS hi FROM game_operations WHERE game_id = ?');
const sizeBatch = () => db.prepare(`
  SELECT COUNT(*) AS ops,
         COALESCE(SUM(octet_length(state_after)), 0) AS bytes,
         COALESCE(SUM(CASE WHEN seq < ? AND octet_length(state_after) > ${STUB_MAX_BYTES}
                           THEN octet_length(state_after) ELSE 0 END), 0) AS prunable
    FROM game_operations
   WHERE game_id = ? AND seq >= ? AND seq < ?`);

// Measure one game, a batch at a time, yielding between batches.
async function measureGame(g, stmts) {
  const r = stmts.range.get(g.id);
  const out = { gameId: g.id, status: g.status, ops: 0, snapshotBytes: 0, prunableBytes: 0 };
  if (!r || r.lo == null) return out;
  let t0 = Date.now();
  for (let lo = r.lo; lo <= r.hi; lo += BATCH_ROWS) {
    const b = stmts.size.get(g.committedSeq, g.id, lo, lo + BATCH_ROWS);
    out.ops += b.ops; out.snapshotBytes += b.bytes; out.prunableBytes += b.prunable;
    if (Date.now() - t0 > SLICE_MS) { await yieldNow(); t0 = Date.now(); }
  }
  return out;
}

// Start a scan in the background unless one is already running. Returns at
// once; the panel polls storageReport() for progress.
export function startScan() {
  if (scan.status === 'running') return false;
  const games = db.prepare('SELECT id, status, committed_seq AS committedSeq FROM games ORDER BY id').all();
  scan.status = 'running';
  scan.startedAt = nowMs(); scan.finishedAt = null;
  scan.gamesDone = 0; scan.gamesTotal = games.length;
  const fresh = new Map();
  const stmts = { range: opRange(), size: sizeBatch() };
  (async () => {
    try {
      for (const g of games) {
        fresh.set(g.id, await measureGame(g, stmts));
        scan.gamesDone++;
        await yieldNow();
      }
      scan.games = fresh;
      scan.status = 'done';
    } catch (e) {
      console.error('[storage] scan failed', e);
      scan.status = scan.games.size ? 'done' : 'idle';
    } finally {
      scan.finishedAt = nowMs();
    }
  })();
  return true;
}

// ---- the report ------------------------------------------------------------

// Everything cheap, plus the cached scan. Never touches the history itself.
export function storageReport({ topN = 25, idleDays = 30 } = {}) {
  const pageSize = db.pragma('page_size', { simple: true });
  const pageCount = db.pragma('page_count', { simple: true });
  const freePages = db.pragma('freelist_count', { simple: true });

  let volume = null;
  try {
    const fs = statfsSync(dirname(DATABASE_PATH));
    volume = { totalBytes: fs.blocks * fs.bsize, freeBytes: fs.bavail * fs.bsize };
  } catch { /* not every platform reports it */ }

  const mem = process.memoryUsage();

  const report = {
    at: nowMs(),
    files: {
      dbBytes: fileSize(DATABASE_PATH),
      walBytes: fileSize(DATABASE_PATH + '-wal'),
      shmBytes: fileSize(DATABASE_PATH + '-shm'),
    },
    pages: {
      pageSize, pageCount, freePages,
      usedBytes: (pageCount - freePages) * pageSize,
      // Freed by pruning but still inside the file until a VACUUM.
      reclaimableBytes: freePages * pageSize,
    },
    volume,
    memory: { rssBytes: mem.rss, heapUsedBytes: mem.heapUsed },
    scan: {
      status: scan.status, startedAt: scan.startedAt, finishedAt: scan.finishedAt,
      gamesDone: scan.gamesDone, gamesTotal: scan.gamesTotal,
    },
    byStatus: [], topGames: [], candidates: null,
  };
  if (!scan.games.size) return report;

  // Aggregate the cached per-game numbers. The lobby names and last-move times
  // are one cheap indexed lookup each for the handful of games shown.
  const rows = [...scan.games.values()];
  const byStatus = new Map();
  for (const g of rows) {
    const s = byStatus.get(g.status) || { status: g.status, games: 0, ops: 0, snapshotBytes: 0, prunableBytes: 0 };
    s.games++; s.ops += g.ops; s.snapshotBytes += g.snapshotBytes; s.prunableBytes += g.prunableBytes;
    byStatus.set(g.status, s);
  }
  report.byStatus = [...byStatus.values()].sort((a, b) => b.snapshotBytes - a.snapshotBytes);

  const meta = db.prepare(`
    SELECT l.name AS lobbyName, l.code AS lobbyCode, g.status AS status,
           COALESCE(gs.updated_at, g.created_at) AS lastActivity
      FROM games g JOIN lobbies l ON l.id = g.lobby_id
      LEFT JOIN game_states gs ON gs.game_id = g.id
     WHERE g.id = ?`);
  report.topGames = rows
    .sort((a, b) => b.snapshotBytes - a.snapshotBytes)
    .slice(0, Math.max(1, Math.min(200, topN | 0)))
    .map((g) => ({ ...g, ...(meta.get(g.gameId) || {}) }));

  // What each Clear button would take, from the same cache.
  const idle = scopeGameIds({ scope: 'idle', idleDays });
  const idleSet = new Set(idle);
  const count = (pred) => rows.filter((g) => g.prunableBytes > 0 && pred(g)).length;
  report.candidates = {
    finished: count((g) => g.status === 'finished'),
    cancelled: count((g) => g.status === 'cancelled'),
    idle: count((g) => idleSet.has(g.gameId)),
    idleDays: Math.max(1, Number(idleDays) || 30),
  };
  return report;
}

// ---- pruning ---------------------------------------------------------------

// The stub a pruned snapshot becomes: the round + slot the turn log needs, and
// a flag that says the board itself is gone.
const pruneBatch = () => db.prepare(`
  UPDATE game_operations
     SET state_after = json_object(
           'round', json_extract(state_after, '$.round'),
           'turn',  json_extract(state_after, '$.turn'),
           '_pruned', 1)
   WHERE game_id = ? AND seq >= ? AND seq < ? AND seq < ?
     AND state_after IS NOT NULL
     AND octet_length(state_after) > ${STUB_MAX_BYTES}`);
const prunableBatch = () => db.prepare(`
  SELECT COALESCE(SUM(octet_length(state_after)), 0) AS bytes
    FROM game_operations
   WHERE game_id = ? AND seq >= ? AND seq < ? AND seq < ?
     AND octet_length(state_after) > ${STUB_MAX_BYTES}`);

// Prune one game's history: every snapshot BEFORE its committed_seq becomes a
// stub, a batch at a time with a yield between batches. Idempotent (pruned rows
// are skipped by size). The undo base and everything after it are never touched.
export async function pruneGame(gameId) {
  const g = db.prepare('SELECT id, committed_seq AS committedSeq FROM games WHERE id = ?').get(gameId);
  if (!g) return { ok: false, error: 'no_game' };
  const r = opRange().get(g.id);
  let rows = 0, bytesFreed = 0;
  if (r && r.lo != null) {
    const upd = pruneBatch(), sz = prunableBatch();
    const hi = Math.min(r.hi, g.committedSeq - 1);
    for (let lo = r.lo; lo <= hi; lo += BATCH_ROWS) {
      bytesFreed += sz.get(g.id, lo, lo + BATCH_ROWS, g.committedSeq).bytes;
      rows += upd.run(g.id, lo, lo + BATCH_ROWS, g.committedSeq).changes;
      await yieldNow();
    }
  }
  // Keep the cached scan honest without rescanning.
  const cached = scan.games.get(g.id);
  if (cached) {
    cached.snapshotBytes = Math.max(0, cached.snapshotBytes - bytesFreed + rows * 45);
    cached.prunableBytes = 0;
  }
  return { ok: true, gameId: g.id, rows, bytesFreed };
}

// Which games a scope covers - read off the games table alone, never the history:
//   finished  - games that ended
//   cancelled - tables an admin cancelled
//   idle      - still active, but nothing has happened in `idleDays`
function scopeGameIds({ scope, idleDays = 30 } = {}) {
  let where;
  const args = [];
  if (scope === 'finished') where = "g.status = 'finished'";
  else if (scope === 'cancelled') where = "g.status = 'cancelled'";
  else if (scope === 'idle') {
    const days = Math.max(1, Number(idleDays) || 30);
    where = "g.status = 'active' AND COALESCE(gs.updated_at, g.created_at) < ?";
    args.push(nowMs() - days * 24 * 60 * 60 * 1000);
  } else {
    return null;
  }
  return db.prepare(`
    SELECT g.id AS gameId FROM games g
      LEFT JOIN game_states gs ON gs.game_id = g.id
     WHERE ${where} ORDER BY g.id`).all(...args).map((r) => r.gameId);
}

// Bulk prune. Skips games the cached scan already knows have nothing to clear,
// and stops after `budgetMs`, reporting what is left, so a huge backlog is
// worked through in several short calls rather than one long request.
export async function pruneMany({ scope, idleDays, budgetMs = 15000 } = {}) {
  let ids = scopeGameIds({ scope, idleDays });
  if (!ids) return { ok: false, error: 'bad_scope' };
  if (scan.games.size) ids = ids.filter((id) => !scan.games.has(id) || scan.games.get(id).prunableBytes > 0);
  const started = Date.now();
  let games = 0, rows = 0, bytesFreed = 0, visited = 0;
  for (const id of ids) {
    const r = await pruneGame(id);
    visited++;
    if (r.ok && r.rows) { games++; rows += r.rows; bytesFreed += r.bytesFreed; }
    if (Date.now() - started > budgetMs) break;
  }
  return { ok: true, scope, games, rows, bytesFreed, remaining: ids.length - visited };
}

// Give the freed pages back to the disk. This one CANNOT be batched: VACUUM
// rewrites the whole file and blocks the database until it is done, so it
// refuses when the disk has no room for the rewrite (it writes a fresh copy of
// the live data before dropping the old one), and reports how long it took.
export function vacuum() {
  const report = storageReport({ topN: 1 });
  const live = report.pages.usedBytes;
  if (report.volume && report.volume.freeBytes < live * 1.2) {
    return { ok: false, error: 'not_enough_disk', needBytes: Math.ceil(live * 1.2), freeBytes: report.volume.freeBytes };
  }
  const beforeBytes = report.files.dbBytes + report.files.walBytes;
  const t0 = Date.now();
  db.exec('VACUUM');
  // In WAL mode the rewrite passes through the WAL; truncate it so the file
  // on disk actually shrinks too.
  db.pragma('wal_checkpoint(TRUNCATE)');
  const afterBytes = fileSize(DATABASE_PATH) + fileSize(DATABASE_PATH + '-wal');
  return { ok: true, beforeBytes, afterBytes, ms: Date.now() - t0 };
}
