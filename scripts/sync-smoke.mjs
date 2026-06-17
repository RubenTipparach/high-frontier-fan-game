// Realtime sync integration smoke test.
//
//   node scripts/sync-smoke.mjs
//
// Boots a throwaway server (own temp DB + random port), drives real
// profiles into one room over real WebSockets, and asserts the sync
// guarantees multiplayer relies on. Self-contained: it starts and stops
// its own server, so it is safe to run locally any time. Exits non-zero
// if any assertion fails.
//
// Scenarios:
//   1. Live broadcast      an op by one player pushes to every socket in
//                          the room (the happy path).
//   2. Dropped-frame heal  a player who MISSES the WebSocket push (mobile
//                          drop, backgrounded tab) catches back up on its
//                          next REST poll, because REST is the source of
//                          truth and serves the current state at a
//                          monotonic seq regardless of WS delivery.
//   3. Out-of-order guard  a late / duplicate poll that resolves with an
//                          OLDER seq must NOT clobber newer applied state
//                          (the seq <= lastApplied gate in browse.js
//                          #applySnapshot). Guards the documented revert
//                          bug where a stale poll silently undid a newer op.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

// ws lives in server/node_modules; resolve it from there regardless of cwd.
const require = createRequire(new URL('../server/index.js', import.meta.url));
const WebSocket = require('ws');
const crewMod = await import(new URL('../data/crew.js', import.meta.url));

const PORT = 8800 + Math.floor(Math.random() * 150);
const BASE = `http://localhost:${PORT}`;
const WSURL = `ws://localhost:${PORT}/ws`;
const DB = join(tmpdir(), `hf-sync-smoke-${process.pid}.db`);
const SERVER = new URL('../server/index.js', import.meta.url).pathname;

let pass = 0, fail = 0;
const ok = (c, label) => { (c ? pass++ : fail++); console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(30); } return false; };

async function api(method, path, { token, body, xff } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      ...(xff ? { 'x-forwarded-for': xff } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, ok: res.ok, data };
}

const colorToCard = {};
for (const c of (crewMod.CREW || [])) if (c && c.color && !colorToCard[c.color]) colorToCard[c.color] = c.id;

// A client model mirroring browse.js#applySnapshot's seq gate: apply a
// snapshot only when its seq ADVANCES past the last one applied. Both the
// WS push and the REST poll feed through this same gate, exactly as the
// real client routes ws.on('game_update') and the poll setInterval through
// applySnapshot.
function makeClient(token, gameId) {
  const sock = new WebSocket(WSURL);
  const c = {
    sock, subbed: false, dropMode: false, dropped: 0,
    applied: -1, state: null,
    apply(state, seq) {
      if (seq != null && seq <= this.applied) return false; // gated: stale / out-of-order
      if (seq != null) this.applied = seq;
      this.state = state;
      return true;
    },
  };
  sock.on('open', () => sock.send(JSON.stringify({ type: 'auth', token })));
  sock.on('message', (raw) => {
    let m; try { m = JSON.parse(String(raw)); } catch { return; }
    if (m.type === 'auth_ok') sock.send(JSON.stringify({ type: 'sub', channel: 'game:' + gameId }));
    else if (m.type === 'sub_ok') c.subbed = true;
    else if (m.type === 'game_update') {
      if (c.dropMode) { c.dropped++; return; }      // simulate a missed WS frame
      c.apply(m.game && m.game.state, m.seq);
    }
  });
  // A REST poll, identical to the client's snapshot poll: fetch current
  // game and feed it through the same seq gate.
  c.poll = async () => { const r = await api('GET', `/games/${gameId}`, { token }); if (r.ok) return c.apply(r.data.game.state, r.data.game.seq); return false; };
  return c;
}

let child;
function startServer() {
  child = spawn('node', [SERVER], { env: { ...process.env, PORT: String(PORT), DATABASE_PATH: DB, WS_HEARTBEAT_MS: '30000' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', (d) => { const s = String(d); if (/Error|throw|undefined/.test(s)) process.stderr.write('[server] ' + s); });
}
function stopServer() { try { child && child.kill('SIGKILL'); } catch {} try { rmSync(DB, { force: true }); } catch {} }

(async () => {
  startServer();
  const up = await waitFor(async () => { try { const r = await fetch(BASE + '/lobbies'); return r.ok; } catch { return false; } }, 15000);
  ok(up, `throwaway server is listening on :${PORT}`);
  if (!up) { stopServer(); process.exit(1); }

  // setup: two profiles, one room, a started game, crew picked so play is open
  const sfx = randomBytes(3).toString('hex');
  const tokA = randomBytes(32).toString('base64url');
  const tokB = randomBytes(32).toString('base64url');
  const pa = await api('POST', '/profiles', { body: { name: 'SyncA' + sfx, token: tokA }, xff: '10.7.0.1' });
  const pb = await api('POST', '/profiles', { body: { name: 'SyncB' + sfx, token: tokB }, xff: '10.7.0.2' });
  const lob = await api('POST', '/lobbies', { token: tokA, body: { name: 'sync', maxPlayers: 2 } });
  const lobbyId = lob.data.lobby.id;
  await api('POST', `/lobbies/${lobbyId}/join`, { token: tokB });
  const start = await api('POST', `/lobbies/${lobbyId}/start`, { token: tokA });
  const gameId = start.data.gameId;
  ok(pa.ok && pb.ok && gameId, `two profiles in a started game (${gameId})`);

  const view = await api('GET', `/games/${gameId}`, { token: tokA });
  const players = view.data.game.players;
  const colorById = {}; players.forEach((p) => { colorById[p.profileId] = p.color; });

  const A = makeClient(tokA, gameId);
  const B = makeClient(tokB, gameId);
  ok(await waitFor(() => A.subbed && B.subbed), 'both clients subscribed to the room');

  // crew picks (so the game is in play); also primes each client's seq
  for (const [tok, id] of [[tokA, pa.data.id], [tokB, pb.data.id]]) {
    await api('POST', `/games/${gameId}/ops`, { token: tok, body: { kind: 'PICK_CREW', cardId: colorToCard[colorById[id]], face: 'primary' } });
  }
  await waitFor(() => A.state && B.state && A.state.draftPhase === 'play');

  // --- scenario 1: live broadcast reaches every socket ---
  const seqBefore = B.applied;
  const activeId = B.state.players[B.state.activeIndex].profileId;
  const activeTok = activeId === pa.data.id ? tokA : tokB;
  const op1 = await api('POST', `/games/${gameId}/ops`, { token: activeTok, body: { kind: 'INCOME' } });
  ok(op1.ok, `active player submitted an op (seq ${op1.data && op1.data.seq})`);
  const bothLive = await waitFor(() => A.applied >= op1.data.seq && B.applied >= op1.data.seq);
  ok(bothLive, 'both clients received the op live over WS');

  // --- scenario 2: a DROPPED WS frame heals on the next poll ---
  // Capture the pre-op state/seq so scenario 3 can replay it as a stale poll.
  const staleState = JSON.parse(JSON.stringify(B.state));
  const staleSeq = B.applied;
  B.dropMode = true;                          // B will miss the next push
  const appliedBeforeDrop = B.applied;
  const enderId = B.state.players[B.state.activeIndex].profileId;
  const enderTok = enderId === pa.data.id ? tokA : tokB;
  const op2 = await api('POST', `/games/${gameId}/ops`, { token: enderTok, body: { kind: 'END_TURN' } });
  ok(op2.ok, `another op landed while B's WS was dropping (seq ${op2.data && op2.data.seq})`);
  // Give the (dropped) broadcast time to arrive and be ignored.
  const sawDrop = await waitFor(() => B.dropped > 0, 3000);
  ok(sawDrop && B.applied === appliedBeforeDrop, `B MISSED the WS push (dropped=${B.dropped}, still at seq ${B.applied})`);
  ok(A.applied >= op2.data.seq, `A (healthy WS) is current at seq ${A.applied}`);
  // The poll: B fetches REST truth and catches up through the same gate.
  B.dropMode = false;
  const healed = await B.poll();
  ok(healed && B.applied === op2.data.seq, `B's REST poll caught it up to seq ${B.applied}`);
  const serverState = (await api('GET', `/games/${gameId}`, { token: tokB })).data.game.state;
  ok(B.state.activeIndex === serverState.activeIndex && B.state.turn === serverState.turn,
     `B's healed state matches server truth (activeIndex ${B.state.activeIndex}, cube slot ${B.state.turn})`);

  // --- scenario 3: a stale / out-of-order poll must NOT revert newer state ---
  const appliedNow = B.applied;
  const beforeIndex = B.state.activeIndex;
  const reverted = B.apply(staleState, staleSeq);   // a late poll resolving with the OLD seq
  ok(reverted === false && B.applied === appliedNow && B.state.activeIndex === beforeIndex,
     `out-of-order poll (seq ${staleSeq} <= ${appliedNow}) was ignored, newer state kept`);

  for (const c of [A, B]) { try { c.sock.terminate(); } catch {} }
  console.log(`\n${fail === 0 ? 'ALL GREEN' : 'SOME RED'}: ${pass} passed, ${fail} failed`);
  stopServer();
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('HARNESS ERROR', e); stopServer(); process.exit(2); });
