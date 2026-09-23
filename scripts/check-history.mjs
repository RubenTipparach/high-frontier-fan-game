// History store check: boards saved as diffs against the turn's base board
// (server/history.js), and the background compactor that converts old games,
// driven over the real routes against a live local server.
//
// What it proves:
//   - new ops store small diffs, turn-starting ops keep whole boards;
//   - every board still reads back EXACTLY (history route, undo, mission log);
//   - old full-board games are converted one turn at a time, and afterwards
//     every one of their boards still rebuilds exactly;
//   - the compactor never touches the turn in progress, logs each game, can be
//     paused, and players are served the whole time it runs.
//
// Needs the server's dependencies (cd server && npm install), so it is not in
// CI with the engine checks. Run before pushing a change to server/history.js,
// server/game/state-diff.js, or how index.js writes game_operations:
//
//   node scripts/check-history.mjs

import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const require = createRequire(ROOT + '/server/index.js');
const Database = require('better-sqlite3');
const PORT = 9840 + Math.floor(Math.random() * 60), BASE = `http://localhost:${PORT}`;
const DB = join(tmpdir(), `hf-hist-${process.pid}.db`);
// This process reads the database too (to compare boards in-process), so it
// must point at the test file before anything imports server/db.js.
process.env.DATABASE_PATH = DB;
const ADMIN_DISCORD_ID = '123456789012345678';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, l) => { (c ? pass++ : fail++); console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
async function api(m, p, { token, body, cookie } = {}) {
  const t0 = Date.now();
  const r = await fetch(BASE + p, { method: m, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let d = null; try { d = await r.json(); } catch {}
  return { ok: r.ok, status: r.status, data: d, ms: Date.now() - t0 };
}
const { sameState } = await import(ROOT + '/server/game/state-diff.js');
const isDiffRaw = (raw) => /^\{"_base":\d+,/.test(raw || '');
const fileMb = () => { let t = 0; for (const x of ['', '-wal']) try { t += statSync(DB + x).size; } catch {} return (t / 1048576).toFixed(1); };

let child;
function boot(extraEnv) {
  child = spawn('node', [ROOT + '/server/index.js'], {
    env: { ...process.env, PORT: String(PORT), DATABASE_PATH: DB, ADMIN_DISCORD_ID, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.logLines = [];
  child.stdout.on('data', (d) => { for (const l of String(d).split('\n')) if (l.includes('[history]')) child.logLines.push(l); });
  child.stderr.on('data', (d) => { const t = String(d); if (!/MODULE_TYPELESS|Reparsing|eliminate|trace-warnings|planner/.test(t)) process.stderr.write(t); });
}
async function up() { for (let i = 0; i < 300; i++) { try { if ((await fetch(BASE + '/lobbies')).ok) return; } catch {} await sleep(60); } throw new Error('server down'); }
async function down() { child.kill('SIGKILL'); await sleep(300); }
const cleanup = () => { try { child && child.kill('SIGKILL'); } catch {} for (const x of ['', '-wal', '-shm']) rmSync(DB + x, { force: true }); };

try {
  // ---------- part 1: live writes, compactor off ----------
  boot({ HF_COMPACT: '0' });
  await up();
  const { CREW } = await import(ROOT + '/data/crew.js');
  const toks = [randomBytes(32).toString('base64url'), randomBytes(32).toString('base64url')];
  const ids = [];
  for (const t of toks) { await api('POST', '/profiles', { body: { name: 'Hs' + randomBytes(3).toString('hex'), token: t } }); ids.push((await api('GET', '/profiles/me', { token: t })).data.id); }
  const lob = (await api('POST', '/lobbies', { token: toks[0], body: { name: 'hist', maxPlayers: 2, maxRounds: 7 } })).data.lobby;
  await api('POST', `/lobbies/${lob.id}/join`, { token: toks[1] });
  const gid = (await api('POST', `/lobbies/${lob.id}/start`, { token: toks[0] })).data.gameId;
  let g = (await api('GET', `/games/${gid}`, { token: toks[0] })).data.game;
  for (let k = 0; k < 4 && g.state.draftPhase !== 'play'; k++) {
    const pl = g.state.players.find((p) => !p.faction); if (!pl) break;
    const c = CREW.find((x) => x.color === pl.color) || CREW[k];
    await api('POST', `/games/${gid}/ops`, { token: toks[ids.indexOf(pl.profileId)], body: { kind: 'PICK_CREW', cardId: c.id, face: 'primary' } });
    g = (await api('GET', `/games/${gid}`, { token: toks[0] })).data.game;
  }
  // A round boundary can wait on the first-player pick; make it, like a table would.
  async function settle() {
    const st = (await api('GET', `/games/${gid}`, { token: toks[0] })).data.game.state;
    const pf = st.pendingFirstPlayer;
    if (pf) {
      const other = st.players.find((p) => String(p.profileId) !== String(pf.chooserId));
      await api('POST', `/games/${gid}/ops`, { token: toks[ids.indexOf(Number(pf.chooserId))], body: { kind: 'SET_FIRST_PLAYER', profileId: other.profileId } });
    }
  }
  // Play: each turn a few non-committing ops, sometimes an undo, then END_TURN.
  let undid = 0;
  for (let turn = 0; turn < 24; turn++) {
    await settle();
    g = (await api('GET', `/games/${gid}`, { token: toks[0] })).data.game;
    const me = g.state.players[g.state.activeIndex]; const t = toks[ids.indexOf(me.profileId)];
    await api('POST', `/games/${gid}/ops`, { token: t, body: { kind: 'INCOME' } });
    if ((me.aqua | 0) > 2) {
      await api('POST', `/games/${gid}/ops`, { token: t, body: { kind: 'REFUEL', amount: 1 } });
      await api('POST', `/games/${gid}/ops`, { token: t, body: { kind: 'CASH_WATER', amount: 1 } });
    }
    if (turn % 4 === 1) {
      const before = (await api('GET', `/games/${gid}`, { token: t })).data.game.state;
      const u = await api('POST', `/games/${gid}/ops`, { token: t, body: { kind: 'UNDO' } });
      const after = (await api('GET', `/games/${gid}`, { token: t })).data.game.state;
      if (u.ok && !sameState(before, after)) undid++;
    }
    const e = await api('POST', `/games/${gid}/ops`, { token: t, body: { kind: 'END_TURN' } });
    if (!e.ok && e.data && e.data.error === 'awaiting_event_choice') break;
  }
  ok(undid > 0, `undo works on a turn stored as diffs (${undid} undos changed the board)`);
  {
    const d = new Database(DB, { readonly: true });
    const rows = d.prepare('SELECT seq, kind, state_after FROM game_operations WHERE game_id = ? ORDER BY seq').all(gid);
    const cur = d.prepare('SELECT state FROM game_states WHERE game_id = ?').get(gid).state;
    d.close();
    const commits = rows.filter((r) => ['START', 'END_TURN', 'PICK_CREW'].includes(r.kind) || r.kind.startsWith('AUCTION_') || r.kind.startsWith('TRADE_'));
    const others = rows.filter((r) => !commits.includes(r));
    ok(commits.every((r) => !isDiffRaw(r.state_after)), `every turn-starting op kept its whole board (${commits.length})`);
    const diffs = others.filter((r) => isDiffRaw(r.state_after));
    ok(diffs.length >= others.length * 0.8, `other ops stored diffs (${diffs.length} of ${others.length})`);
    const avgFull = commits.reduce((n, r) => n + r.state_after.length, 0) / commits.length;
    const avgDiff = diffs.reduce((n, r) => n + r.state_after.length, 0) / Math.max(1, diffs.length);
    ok(avgDiff < avgFull * 0.2, `a diff is small: ${Math.round(avgDiff)} bytes vs ${Math.round(avgFull)} for a board`);
    // Every board reads back through the history route, and the last one is the current board.
    let exact = 0, last = null;
    for (const r of rows) {
      const h = await api('GET', `/games/${gid}/states/${r.seq}`, { token: toks[0] });
      if (h.ok) { exact++; last = h.data.state; }
    }
    ok(exact === rows.length, `every board reads back (${exact}/${rows.length})`);
    // The route redacts planned routes per viewer, so compare the unredacted
    // rebuild (the server's own reader, in-process) with the current board.
    const hist = await import(ROOT + '/server/history.js');
    ok(sameState(hist.loadStateAt(gid, rows[rows.length - 1].seq), JSON.parse(cur)), 'the last board rebuilt is exactly the current board');
  }
  const logBefore = (await api('GET', `/games/${gid}/ops`, { token: toks[0] })).data.entries;

  // ---------- part 2: make it an OLD game, plus a pile of old games ----------
  // Expand every row to a full board (what games recorded before diffs look
  // like), keeping the true boards to compare against after compaction.
  await down();
  const truth = new Map();   // `${game}:${seq}` -> board
  {
    const d = new Database(DB);
    // Rebuild the true boards through the server's own reader, in-process.
    const hist = await import(ROOT + '/server/history.js');
    const rows = d.prepare('SELECT seq FROM game_operations WHERE game_id = ? ORDER BY seq').all(gid);
    const upd = d.prepare('UPDATE game_operations SET state_after = ? WHERE game_id = ? AND seq = ?');
    const boards = rows.map((r) => [r.seq, hist.loadStateAt(gid, r.seq)]);
    d.transaction(() => { for (const [seq, b] of boards) { upd.run(JSON.stringify(b), gid, seq); truth.set(`${gid}:${seq}`, b); } })();
    // Copy the game into 12 more old games (finished / cancelled / active).
    const me = ids[0];
    const src = d.prepare('SELECT seq, profile_id, kind, payload, log, state_after, created_at FROM game_operations WHERE game_id = ? ORDER BY seq').all(gid);
    const gRow = d.prepare('SELECT * FROM games WHERE id = ?').get(gid);
    const ins = d.prepare('INSERT INTO game_operations (game_id,seq,profile_id,kind,payload,log,state_after,created_at) VALUES (?,?,?,?,?,?,?,?)');
    d.transaction(() => {
      for (let i = 0; i < 12; i++) {
        const st = ['finished', 'cancelled', 'active'][i % 3];
        const l = d.prepare('INSERT INTO lobbies (code,name,host_id,status,created_at) VALUES (?,?,?,?,?)').run('h' + randomBytes(4).toString('hex'), `old ${st} ${i}`, me, 'started', Date.now());
        const ng = d.prepare('INSERT INTO games (lobby_id,seed,status,committed_seq,created_at) VALUES (?,?,?,?,?)').run(l.lastInsertRowid, gRow.seed, st, gRow.committed_seq, Date.now()).lastInsertRowid;
        d.prepare('INSERT INTO game_states (game_id,state,seq,updated_at) VALUES (?,?,?,?)').run(ng, JSON.stringify(boards[boards.length - 1][1]), src[src.length - 1].seq, Date.now());
        for (const r of src) { ins.run(ng, r.seq, r.profile_id, r.kind, r.payload, r.log, r.state_after, r.created_at); truth.set(`${ng}:${r.seq}`, JSON.parse(r.state_after)); }
      }
    })();
    // A game already half in the NEW format, the shape the protection exists
    // for: a full board mid-turn (a trade) that later diffs point at. If the
    // compactor turned it into a diff, those diffs would lose their base.
    const { diffState } = await import(ROOT + '/server/game/state-diff.js');
    const pick = boards.slice(1, 7).map(([, b]) => JSON.parse(JSON.stringify(b)));
    pick.forEach((b, i) => { b.round = 1; b.turn = i < 5 ? 0 : 1; });
    const l = d.prepare('INSERT INTO lobbies (code,name,host_id,status,created_at) VALUES (?,?,?,?,?)').run('m' + randomBytes(4).toString('hex'), 'mixed', me, 'started', Date.now());
    const mg = d.prepare('INSERT INTO games (lobby_id,seed,status,committed_seq,created_at) VALUES (?,?,?,?,?)').run(l.lastInsertRowid, gRow.seed, 'finished', 5, Date.now()).lastInsertRowid;
    d.prepare('INSERT INTO game_states (game_id,state,seq,updated_at) VALUES (?,?,?,?)').run(mg, JSON.stringify(pick[5]), 5, Date.now());
    const layout = [['START', null], ['INCOME', null], ['TRADE_ACCEPT', null], ['INCOME', 2], ['INCOME', 2], ['END_TURN', null]];
    layout.forEach(([kind, base], seq) => {
      const b = pick[seq];
      const raw = base == null ? JSON.stringify(b)
        : JSON.stringify({ _base: base, round: b.round, turn: b.turn, _patch: diffState(pick[base], b) });
      ins.run(mg, seq, me, kind, '{}', kind, raw, Date.now());
      truth.set(`${mg}:${seq}`, b);
    });
    global.MIXED = mg;
    d.close();
  }
  const mbBefore = fileMb();

  // ---------- part 3: the compactor ----------
  const TURN_MS = 40;
  boot({ HF_COMPACT_START_MS: '0', HF_COMPACT_TURN_MS: String(TURN_MS), HF_COMPACT_GAME_MS: '100', HF_COMPACT_IDLE_MS: '500' });
  await up();
  const adminTok = randomBytes(32).toString('base64url');
  { const d = new Database(DB); d.prepare('INSERT INTO admin_sessions (token_hash, discord_id, created_at, expires_at) VALUES (?,?,?,?)').run(createHash('sha256').update(adminTok).digest('hex'), ADMIN_DISCORD_ID, Date.now(), Date.now() + 3600e3); d.close(); }
  const cookie = `hf_admin=${adminTok}`;
  // A player keeps playing the live game while it runs, and a pinger measures latency.
  let pinging = true, worst = 0, pings = 0;
  const pinger = (async () => { while (pinging) { const t = Date.now(); await fetch(BASE + '/lobbies'); worst = Math.max(worst, Date.now() - t); pings++; await sleep(5); } })();
  // Pause / resume.
  await sleep(300);
  const pz = await api('POST', '/admin/storage/compactor', { cookie, body: { action: 'pause' } });
  const turnsAtPause = pz.data.compactor.turnsDone;
  await sleep(TURN_MS * 8);
  const still = (await api('GET', '/admin/storage', { cookie })).data.report.compactor;
  ok(pz.ok && still.turnsDone <= turnsAtPause + 1, `pause stops it (turns ${turnsAtPause} -> ${still.turnsDone})`);
  await api('POST', '/admin/storage/compactor', { cookie, body: { action: 'resume' } });
  const t0 = Date.now();
  let c;
  for (let i = 0; i < 2400; i++) {
    c = (await api('GET', '/admin/storage', { cookie })).data.report.compactor;
    if (c.state === 'idle') break;
    await sleep(100);
  }
  const secs = (Date.now() - t0) / 1000;
  pinging = false; await pinger;
  ok(c.state === 'idle', `the compactor finishes (${c.gamesDone} games, ${c.turnsDone} turns, ${c.rowsConverted} boards in ${secs.toFixed(1)} s)`);
  ok(c.turnsDone / secs <= 1000 / TURN_MS * 1.2, `it paces itself: ${(c.turnsDone / secs).toFixed(1)} turns/s with a ${TURN_MS} ms rest (default rest 1000 ms = about 1 turn/s)`);
  ok(worst < 300, `players are served throughout (${pings} requests, slowest ${worst} ms)`);
  const perGame = child.logLines.filter((l) => /game \d+ .*: (starting|done)/.test(l));
  ok(perGame.filter((l) => l.includes(': done')).length >= 13, `it logs each game (${perGame.length} start/done lines)`);
  console.log('  ' + perGame.slice(-2).join('\n  '));
  ok(c.bytesAfter < c.bytesBefore * 0.25, `converted boards shrank: ${(c.bytesBefore / 1048576).toFixed(1)} MB -> ${(c.bytesAfter / 1048576).toFixed(1)} MB`);

  // Every board of every game still rebuilds exactly, in-process.
  await down();
  {
    const hist = await import(ROOT + '/server/history.js');
    const d = new Database(DB, { readonly: true });
    let exact = 0, diffs = 0, bad = [];
    for (const [key, want] of truth) {
      const [g2, seq] = key.split(':').map(Number);
      const got = hist.loadStateAt(g2, seq);
      if (got && sameState(got, want)) exact++; else bad.push(key);
      const raw = d.prepare('SELECT state_after FROM game_operations WHERE game_id = ? AND seq = ?').get(g2, seq).state_after;
      if (isDiffRaw(raw)) diffs++;
    }
    const committed = d.prepare('SELECT id, committed_seq AS c FROM games').all();
    const untouched = committed.every((x) => { const r = d.prepare('SELECT state_after FROM game_operations WHERE game_id = ? AND seq = ?').get(x.id, x.c); return !r || !isDiffRaw(r.state_after); });
    d.close();
    ok(bad.length === 0, `every board of every game rebuilds exactly after compaction (${exact}/${truth.size}${bad.length ? ', first bad ' + bad[0] : ''})`);
    ok(diffs > truth.size * 0.6, `most old boards are now diffs (${diffs}/${truth.size})`);
    ok(untouched, 'every game\'s undo base is still a whole board');
    const mixedOk = [3, 4].every((seq) => sameState(hist.loadStateAt(MIXED, seq), truth.get(`${MIXED}:${seq}`)));
    ok(mixedOk, 'a mid-turn board that later diffs point at stayed a base (those diffs still rebuild)');
  }
  boot({ HF_COMPACT_START_MS: '0', HF_COMPACT_IDLE_MS: '500' });
  await up();
  const logAfter = (await api('GET', `/games/${gid}/ops`, { token: toks[0] })).data.entries;
  ok(logAfter.length === logBefore.length && logAfter.every((e, i) => e.round === logBefore[i].round && e.slot === logBefore[i].slot && e.log === logBefore[i].log),
    'the mission log is identical, turn labels included');
  await settle();
  g = (await api('GET', `/games/${gid}`, { token: toks[0] })).data.game;
  const who = g.state.players[g.state.activeIndex]; const wt = toks[ids.indexOf(who.profileId)];
  const i1 = await api('POST', `/games/${gid}/ops`, { token: wt, body: { kind: 'INCOME' } });
  const u1 = await api('POST', `/games/${gid}/ops`, { token: wt, body: { kind: 'UNDO' } });
  ok(i1.ok && u1.ok, `the live game plays and undoes after compaction (${JSON.stringify([i1.data && i1.data.error, u1.data && u1.data.error])})`);
  console.log(`  file: ${mbBefore} MB before compaction (space is reused; Reclaim disk space shrinks the file)`);
  console.log(`\n${pass} passed, ${fail} failed`);
  cleanup(); process.exit(fail ? 1 : 0);
} catch (e) {
  console.error(e); cleanup(); process.exit(1);
}
