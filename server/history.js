// The board history, stored as DIFFS against a full base board.
//
// Every accepted operation writes a row to game_operations, and state_after
// used to hold a FULL copy of the board for every one of them - even an op
// that changed one number. That was nearly the whole 2.2 GB database
// (2026-09-23). Now:
//
//   - A full board is kept for every op that starts a turn (END_TURN, the
//     draft, auctions, trades: the `commitsTurn` ops in index.js). That is the
//     board UNDO rebuilds the turn from (games.committed_seq), so it is always
//     whole and never converted.
//   - Every other op stores only what changed against that base:
//       {"_base": <seq of a full board>, "round": R, "turn": T, "_patch": [...]}
//     round + turn ride at the top level because the mission log and the turn
//     log read exactly those two numbers off every row (annotateTurns).
//   - A background compactor converts the history of games recorded before
//     this, one game and one turn at a time (startCompactor below).
//
// A patch is only ever kept when rebuilding from it gives back exactly the
// board it describes (checked before it is written) and it is clearly smaller
// than the board. Anything else stays a full board: a full board is always a
// correct record, a diff is an optimisation.
//
// Reading goes through loadStateAt, the one place that turns a row back into a
// board. It answers null when the history is gone (a pruned stub, or a diff
// whose base was pruned) - the same answer a pruned row always gave.

import { db, nowMs } from './db.js';
import { diffState, applyPatch, sameState } from './game/state-diff.js';

// Keep a patch only when it is at most this fraction of the full board.
const MAX_PATCH_RATIO = 0.6;

const DIFF_PREFIX = /^\{"_base":(\d+),/;

// The ops that start a turn: their board is the undo base (games.committed_seq
// moves to them), so it is always stored whole, and every diff written live
// points at the latest one. index.js decides commitsTurn with this same test.
export function isCommitKind(kind) {
  const k = String(kind || '');
  return k === 'START' || k === 'END_TURN' || k === 'PICK_CREW' || k === 'SET_FIRST_PLAYER'
    || k === 'PLACE_SENIORITY' || k === 'DRAFT_PICK'
    || k === 'DRAFT_BONUS_SELL' || k === 'DRAFT_BONUS_DONE'
    || k.startsWith('AUCTION_') || k.startsWith('TRADE_');
}

export function isDiffRecord(rec) {
  return !!(rec && rec._base != null && Array.isArray(rec._patch));
}

function rawAt(gameId, seq) {
  const r = db.prepare('SELECT state_after FROM game_operations WHERE game_id = ? AND seq = ?').get(gameId, seq);
  return r && r.state_after ? r.state_after : null;
}
function parse(raw) {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

// The last base board parsed, per game. The live writer diffs every op of a
// turn against the same base, so this saves re-reading and re-parsing it on
// each one.
const baseCache = new Map();   // gameId -> { seq, raw, obj }
function fullBoardAt(gameId, seq) {
  const hit = baseCache.get(gameId);
  const raw = rawAt(gameId, seq);
  if (!raw) return null;
  if (hit && hit.seq === seq && hit.raw === raw) return hit.obj;
  const obj = parse(raw);
  if (!obj || obj._pruned || isDiffRecord(obj)) return null;
  baseCache.set(gameId, { seq, raw, obj });
  return obj;
}

// The board after op #seq, or null when that history is gone.
export function loadStateAt(gameId, seq) {
  const rec = parse(rawAt(gameId, seq));
  if (!rec || rec._pruned) return null;
  if (!isDiffRecord(rec)) return rec;
  const base = fullBoardAt(gameId, rec._base);
  if (!base) return null;
  try { return applyPatch(base, rec._patch); } catch { return null; }
}

// Encode `target` (a parsed board) as a diff against the full board `base`
// stored at baseSeq. Returns the record's JSON, or null when the board should
// be stored whole (the patch is not small enough, or does not rebuild exactly).
function encodeAgainst(baseSeq, base, target, fullLength) {
  const patch = diffState(base, target);
  const rec = JSON.stringify({ _base: baseSeq, round: target.round, turn: target.turn, _patch: patch });
  if (rec.length > fullLength * MAX_PATCH_RATIO) return null;
  let back;
  try { back = applyPatch(base, JSON.parse(rec)._patch); } catch { return null; }
  return sameState(back, target) ? rec : null;
}

// What to store in state_after for a new op. `fullJson` is the board as JSON;
// baseSeq is the turn's base (games.committed_seq) or null for a board that
// must be kept whole. Never throws: on any doubt it returns fullJson.
export function encodeForStorage(gameId, baseSeq, fullJson) {
  if (baseSeq == null) return fullJson;
  try {
    const base = fullBoardAt(gameId, baseSeq);
    if (!base) return fullJson;
    return encodeAgainst(baseSeq, base, JSON.parse(fullJson), fullJson.length) || fullJson;
  } catch (e) {
    console.error('[history] encode failed; storing the full board', e && e.message);
    return fullJson;
  }
}

// ---- the background compactor ---------------------------------------------
//
// Converts the history recorded before diffs existed. Fully async and gentle
// on purpose (user 2026-09-23): ONE game at a time, ONE turn per step, a rest
// of about a second after every turn and a longer one between games, so a
// player never waits on it. It logs what it does for each game.
//
// What it will never touch:
//   - anything at or after the game's committed_seq (the turn in progress and
//     its undo base);
//   - a full board that some diff points at (it stays a base);
//   - a diff or a pruned stub (already small).
// Progress per game lives in history_compaction, so a restart resumes.

const TURN_PAUSE_MS = Number(process.env.HF_COMPACT_TURN_MS) || 1000;
const GAME_PAUSE_MS = Number(process.env.HF_COMPACT_GAME_MS) || 5000;
const IDLE_PAUSE_MS = Number(process.env.HF_COMPACT_IDLE_MS) || 10 * 60 * 1000;
const START_DELAY_MS = process.env.HF_COMPACT_START_MS != null ? Number(process.env.HF_COMPACT_START_MS) : 2 * 60 * 1000;
// Most rows one step reads. A turn is usually far fewer; a longer one is
// simply finished over several steps.
const STEP_ROWS = 20;
// Inside a step, hand the server back to waiting requests at least this often.
const SLICE_MS = 8;
const yieldNow = () => new Promise((resolve) => setImmediate(resolve));
const LOG_LINES = 60;

const status = {
  enabled: process.env.HF_COMPACT !== '0',
  state: 'waiting',          // waiting | working | resting | idle | paused
  game: null,                // { id, name, code, status, through, committed }
  gamesDone: 0, turnsDone: 0, rowsConverted: 0,
  bytesBefore: 0, bytesAfter: 0,
  startedAt: null,
  log: [],                   // the most recent lines, newest last
};
function note(line) {
  const stamped = `${new Date().toISOString().slice(11, 19)} ${line}`;
  status.log.push(stamped);
  if (status.log.length > LOG_LINES) status.log.splice(0, status.log.length - LOG_LINES);
  console.log(`[history] ${line}`);
}

export function compactorStatus() {
  return { ...status, log: status.log.slice() };
}
export function setCompactorEnabled(on) {
  status.enabled = !!on;
  note(on ? 'resumed by an admin' : 'paused by an admin');
  if (on) wake();
  return compactorStatus();
}

const sleep = (ms) => new Promise((resolve) => { const t = setTimeout(resolve, ms); if (t.unref) t.unref(); });
let wakeUp = null;
function wake() { if (wakeUp) { const w = wakeUp; wakeUp = null; w(); } }
// Sleep that an admin's Resume can cut short.
function rest(ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { wakeUp = null; resolve(); }, ms);
    if (t.unref) t.unref();
    wakeUp = () => { clearTimeout(t); resolve(); };
  });
}

function saveProgress(gameId, through) {
  db.prepare(`INSERT INTO history_compaction (game_id, through_seq, updated_at) VALUES (?, ?, ?)
              ON CONFLICT(game_id) DO UPDATE SET through_seq = excluded.through_seq, updated_at = excluded.updated_at`)
    .run(gameId, through, nowMs());
}

// The next game with history left to convert: finished and cancelled games
// first (nobody is playing them), then the rest.
function nextGame() {
  return db.prepare(`
    SELECT g.id, g.status, g.committed_seq AS committed, l.name, l.code,
           COALESCE(h.through_seq, 0) AS through
      FROM games g
      JOIN lobbies l ON l.id = g.lobby_id
      LEFT JOIN history_compaction h ON h.game_id = g.id
     WHERE COALESCE(h.through_seq, 0) < g.committed_seq
     ORDER BY CASE g.status WHEN 'finished' THEN 0 WHEN 'cancelled' THEN 1 ELSE 2 END, g.id
     LIMIT 1`).get() || null;
}

// Which boards do diffs point at, among the rows after `seq` up to the next
// turn-starting op? A live diff points at the turn's base and sits before the
// NEXT turn-starting op; a compactor diff sits in the same turn as its base.
// Only needed when a turn runs past one step's window; reads just the start of
// each record to learn its base.
function basesAfter(gameId, seq) {
  const out = new Set();
  const it = db.prepare(
    'SELECT kind, substr(state_after, 1, 24) AS head FROM game_operations WHERE game_id = ? AND seq > ? ORDER BY seq LIMIT 2000',
  ).iterate(gameId, seq);
  for (const r of it) {
    if (isCommitKind(r.kind)) { it.return(); break; }
    const m = DIFF_PREFIX.exec(r.head || '');
    if (m) out.add(Number(m[1]));
  }
  return out;
}

// One turn of one game. Returns the next seq to start from. Yields every few
// milliseconds while it works, so even a long turn of big boards never holds a
// player's request for longer than a slice.
async function compactTurn(g) {
  const committed = db.prepare('SELECT committed_seq AS c FROM games WHERE id = ?').get(g.id).c;
  const rows = db.prepare(
    'SELECT seq, kind, state_after AS raw FROM game_operations WHERE game_id = ? AND seq >= ? AND seq < ? ORDER BY seq LIMIT ?',
  ).all(g.id, g.through, committed, STEP_ROWS);
  if (!rows.length) return { next: committed, rows: 0, before: 0, after: 0, label: null };
  const parsed = rows.map((r) => ({ seq: r.seq, kind: r.kind, raw: r.raw, rec: parse(r.raw) }));
  // The turn is the run of rows sharing the first row's round + slot.
  const head = parsed[0].rec || {};
  const key = `${head.round}.${head.turn}`;
  let end = parsed.findIndex((p) => `${(p.rec || {}).round}.${(p.rec || {}).turn}` !== key);
  if (end <= 0) end = parsed.length;
  const turn = parsed.slice(0, end);
  // Every board a diff points at stays whole. The diffs pointing into this turn
  // sit before the next turn-starting op after it: among the rows already read,
  // or - when no turn-starting op follows the turn inside the window - just
  // past it. (A trade mid-turn does not count: boards after it can still have
  // diffs further on.)
  const referenced = new Set();
  for (const p of parsed) if (isDiffRecord(p.rec)) referenced.add(p.rec._base);
  if (!parsed.slice(end).some((p) => isCommitKind(p.kind))) {
    for (const b of basesAfter(g.id, parsed[parsed.length - 1].seq)) referenced.add(b);
  }

  let base = null;          // { seq, obj } - the full board the turn's diffs point at
  let before = 0, after = 0, converted = 0;
  const writes = [];
  let t0 = Date.now();
  for (const p of turn) {
    if (Date.now() - t0 > SLICE_MS) { await yieldNow(); t0 = Date.now(); }
    const rec = p.rec;
    if (!rec || rec._pruned || isDiffRecord(rec)) continue;   // stub or already a diff
    if (!base || referenced.has(p.seq)) { base = { seq: p.seq, obj: rec }; continue; }
    const enc = encodeAgainst(base.seq, base.obj, rec, p.raw.length);
    if (!enc) { base = { seq: p.seq, obj: rec }; continue; }   // kept whole: it can serve as a base
    writes.push([enc, g.id, p.seq, Buffer.byteLength(p.raw, 'utf8')]);
    before += p.raw.length; after += enc.length; converted++;
  }
  const next = turn[turn.length - 1].seq + 1;
  // Only rewrite a row that is still what was read: an admin can clear history
  // between two slices of this step.
  const upd = db.prepare('UPDATE game_operations SET state_after = ? WHERE game_id = ? AND seq = ? AND octet_length(state_after) = ?');
  db.transaction(() => {
    for (const w of writes) upd.run(...w);
    saveProgress(g.id, next);
  })();
  return { next, rows: converted, before, after, label: key };
}

async function compactGame(g) {
  const label = `game ${g.id} (${g.name || 'untitled'} ${g.code || ''}, ${g.status})`;
  status.game = { id: g.id, name: g.name, code: g.code, status: g.status, through: g.through, committed: g.committed };
  note(`${label}: starting at op ${g.through} of ${g.committed}`);
  let turns = 0, rows = 0, before = 0, after = 0;
  let through = g.through;
  for (;;) {
    if (!status.enabled) { note(`${label}: paused at op ${through}`); return false; }
    const committed = db.prepare('SELECT committed_seq AS c FROM games WHERE id = ?').get(g.id).c;
    if (through >= committed) break;
    status.state = 'working';
    const r = await compactTurn({ ...g, through });
    through = r.next;
    status.game.through = through; status.game.committed = committed;
    turns++; rows += r.rows; before += r.before; after += r.after;
    status.turnsDone++; status.rowsConverted += r.rows;
    status.bytesBefore += r.before; status.bytesAfter += r.after;
    status.state = 'resting';
    await rest(TURN_PAUSE_MS);
  }
  const mb = (n) => (n / 1048576).toFixed(1);
  note(`${label}: done - ${turns} turns, ${rows} boards stored as diffs, ${mb(before)} MB -> ${mb(after)} MB`);
  status.gamesDone++;
  return true;
}

let started = false;
export function startCompactor() {
  if (started) return;
  started = true;
  (async () => {
    status.startedAt = nowMs();
    await sleep(START_DELAY_MS);
    note(status.enabled ? 'started' : 'paused (HF_COMPACT=0)');
    for (;;) {
      try {
        if (!status.enabled) { status.state = 'paused'; await rest(IDLE_PAUSE_MS); continue; }
        const g = nextGame();
        if (!g) {
          if (status.state !== 'idle') note('all game history is stored as diffs; checking again later');
          status.state = 'idle'; status.game = null;
          await rest(IDLE_PAUSE_MS);
          continue;
        }
        await compactGame(g);
        status.state = 'resting';
        await rest(GAME_PAUSE_MS);
      } catch (e) {
        note(`error: ${e && e.message}; resting before the next try`);
        status.state = 'resting';
        await rest(GAME_PAUSE_MS * 6);
      }
    }
  })();
}
