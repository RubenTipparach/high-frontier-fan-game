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
//   - The history scrubber (GET /games/:id/states/:seq) is the only reader of
//     the full board at an arbitrary past op. No client code calls it today;
//     after a prune it answers "history_pruned" for those ops.
// Nothing else reads the column. The op log itself (kind / payload / log) and
// the CURRENT board (game_states) are never touched here.
//
// SQLite does not give space back to the disk when rows shrink - it keeps the
// freed pages for reuse. Pruning stops the file GROWING; VACUUM is what makes
// it SMALLER. VACUUM rewrites only the live data, so it is quick once the
// history is pruned, and slow and space-hungry before.
//
// Every scan here uses octet_length(), which SQLite answers from the record
// header without loading the value - the snapshots are never read just to be
// measured. better-sqlite3 is synchronous, so a scan that loaded every blob
// would freeze the server for every player while it ran.

import { statSync, statfsSync } from 'node:fs';
import { dirname } from 'node:path';
import { db, DATABASE_PATH, nowMs } from './db.js';

// Anything at or below this many bytes is already a pruned stub (a stub is
// ~40 bytes; a real board is kilobytes). Lets every query skip pruned rows by
// size alone, from the header, instead of parsing JSON to look for the flag.
const STUB_MAX_BYTES = 200;

// The stub a pruned snapshot becomes: the round + slot the turn log needs, and
// a flag that says the board itself is gone.
const PRUNE_SQL = `
  UPDATE game_operations
     SET state_after = json_object(
           'round', json_extract(state_after, '$.round'),
           'turn',  json_extract(state_after, '$.turn'),
           '_pruned', 1)
   WHERE game_id = ?
     AND seq < ?
     AND state_after IS NOT NULL
     AND octet_length(state_after) > ${STUB_MAX_BYTES}`;

// Is this parsed snapshot a pruned stub rather than a real board?
export function isPrunedSnapshot(state) {
  return !!(state && state._pruned);
}

function fileSize(path) {
  try { return statSync(path).size; } catch { return 0; }
}

// The whole picture, cheap enough to run on a live server.
export function storageReport({ topN = 25 } = {}) {
  const pageSize = db.pragma('page_size', { simple: true });
  const pageCount = db.pragma('page_count', { simple: true });
  const freePages = db.pragma('freelist_count', { simple: true });

  let volume = null;
  try {
    const fs = statfsSync(dirname(DATABASE_PATH));
    volume = { totalBytes: fs.blocks * fs.bsize, freeBytes: fs.bavail * fs.bsize };
  } catch { /* not every platform reports it */ }

  const mem = process.memoryUsage();

  // Where the history is, by game status.
  const byStatus = db.prepare(`
    SELECT g.status AS status,
           COUNT(DISTINCT g.id) AS games,
           COUNT(o.id) AS ops,
           COALESCE(SUM(octet_length(o.state_after)), 0) AS snapshotBytes,
           COALESCE(SUM(CASE WHEN o.seq < g.committed_seq
                              AND octet_length(o.state_after) > ${STUB_MAX_BYTES}
                             THEN octet_length(o.state_after) ELSE 0 END), 0) AS prunableBytes
      FROM games g
      LEFT JOIN game_operations o ON o.game_id = g.id
     GROUP BY g.status
     ORDER BY snapshotBytes DESC`).all();

  // The biggest individual games.
  const topGames = db.prepare(`
    SELECT g.id AS gameId, g.status AS status, l.name AS lobbyName, l.code AS lobbyCode,
           COUNT(o.id) AS ops,
           COALESCE(SUM(octet_length(o.state_after)), 0) AS snapshotBytes,
           COALESCE(SUM(CASE WHEN o.seq < g.committed_seq
                              AND octet_length(o.state_after) > ${STUB_MAX_BYTES}
                             THEN octet_length(o.state_after) ELSE 0 END), 0) AS prunableBytes,
           gs.updated_at AS lastActivity
      FROM games g
      JOIN lobbies l ON l.id = g.lobby_id
      LEFT JOIN game_states gs ON gs.game_id = g.id
      LEFT JOIN game_operations o ON o.game_id = g.id
     GROUP BY g.id
     ORDER BY snapshotBytes DESC
     LIMIT ?`).all(Math.max(1, Math.min(200, topN | 0)));

  return {
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
    byStatus,
    topGames,
  };
}

// Per-table breakdown. Walks every page of the file (dbstat), so it is kept
// OUT of the default report and only run when asked for.
export function tableBreakdown() {
  return db.prepare(`
    SELECT name, SUM(pgsize) AS bytes, COUNT(*) AS pages
      FROM dbstat
     GROUP BY name
     ORDER BY bytes DESC`).all();
}

// Prune one game's history: every snapshot BEFORE its committed_seq becomes a
// stub. Idempotent (already-pruned rows are skipped by size). Returns what it
// did. The undo base and everything after it are never touched.
export function pruneGame(gameId) {
  const g = db.prepare('SELECT id, committed_seq AS committedSeq FROM games WHERE id = ?').get(gameId);
  if (!g) return { ok: false, error: 'no_game' };
  const before = db.prepare(`
    SELECT COALESCE(SUM(octet_length(state_after)), 0) AS bytes
      FROM game_operations
     WHERE game_id = ? AND seq < ? AND octet_length(state_after) > ${STUB_MAX_BYTES}`)
    .get(g.id, g.committedSeq).bytes;
  const res = db.prepare(PRUNE_SQL).run(g.id, g.committedSeq);
  return { ok: true, gameId: g.id, rows: res.changes, bytesFreed: before };
}

// Which games a bulk prune would take, by scope:
//   finished  - games that ended
//   cancelled - tables an admin cancelled (restorable; undo still works if so)
//   idle      - still active, but nothing has happened in `idleDays`
// Only games that still have something to prune are returned.
export function pruneCandidates({ scope, idleDays = 30 } = {}) {
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
    SELECT g.id AS gameId
      FROM games g
      LEFT JOIN game_states gs ON gs.game_id = g.id
     WHERE ${where}
       AND EXISTS (SELECT 1 FROM game_operations o
                    WHERE o.game_id = g.id AND o.seq < g.committed_seq
                      AND octet_length(o.state_after) > ${STUB_MAX_BYTES})
     ORDER BY g.id`).all(...args).map((r) => r.gameId);
}

// Bulk prune, a game at a time, YIELDING between games so players' requests
// are served in between. Stops after `budgetMs` and reports what is left, so a
// huge backlog is worked through in several calls rather than one request that
// holds the server - and the proxy - for minutes.
export async function pruneMany({ scope, idleDays, budgetMs = 15000 } = {}) {
  const ids = pruneCandidates({ scope, idleDays });
  if (!ids) return { ok: false, error: 'bad_scope' };
  const started = Date.now();
  let games = 0, rows = 0, bytesFreed = 0;
  for (const id of ids) {
    const r = pruneGame(id);
    if (r.ok) { games++; rows += r.rows; bytesFreed += r.bytesFreed; }
    if (Date.now() - started > budgetMs) break;
    await new Promise((resolve) => setImmediate(resolve));
  }
  return { ok: true, scope, games, rows, bytesFreed, remaining: ids.length - games };
}

// Give the freed pages back to the disk. Blocks the database while it runs, so
// it refuses when the disk has no room for the rewrite (VACUUM writes a fresh
// copy of the live data before dropping the old one), and reports how long it
// took. Run it after pruning, when the live data is small and it is quick.
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
