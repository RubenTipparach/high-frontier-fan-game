// Leaderboards check, driven over the real routes against a live local server.
//
// Plays rooms of different modes over the API, finishes some of them on the
// server's own disk (the way an older finished game sits there), restarts so the
// background pass picks them up, finishes one more LIVE through END_TURN, and
// checks the standings: the right board per mode, best VP per player, wins,
// tutorial-free and hot-seat-free. Then the admin page and its two routes, and
// the Discord embed the "post" button sends (fetch stubbed, nothing leaves).
//
// Needs the server's dependencies (cd server && npm install), so it is NOT in
// CI with the engine checks. Run it before pushing a change to
// server/leaderboard.js or the leaderboard routes:
//
//   node scripts/check-leaderboard.mjs
import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const require = createRequire(ROOT + '/server/index.js');
const Database = require('better-sqlite3');
const PORT = 9660 + Math.floor(Math.random() * 40), BASE = `http://localhost:${PORT}`;
const DB = join(tmpdir(), `hf-lb-${process.pid}.db`);
const ADMIN_DISCORD_ID = '123456789012345678';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms = 25000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(80); } return false; };
let pass = 0, fail = 0; const ok = (c, l) => { (c ? pass++ : fail++); console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
async function api(m, p, { token, body, cookie } = {}) {
  const r = await fetch(BASE + p, { method: m, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let d = null; const text = await r.text(); try { d = JSON.parse(text); } catch { d = text; }
  return { ok: r.ok, status: r.status, data: d };
}
let child;
const boot = async () => {
  child = spawn('node', [ROOT + '/server/index.js'], { env: { ...process.env, PORT: String(PORT), DATABASE_PATH: DB, ADMIN_DISCORD_ID, DISCORD_WEBHOOK_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => { const s = String(d); if (/\[leaderboard\]/.test(s)) process.stdout.write('  ' + s); });
  child.stderr.on('data', (d) => process.stderr.write(d));
  if (!await waitFor(async () => { try { return (await fetch(BASE + '/lobbies')).ok; } catch { return false; } })) throw new Error('server down');
};
const halt = async () => { child.kill('SIGKILL'); await sleep(300); };
const cleanup = () => { try { child && child.kill('SIGKILL'); } catch {} for (const x of ['', '-wal', '-shm']) try { rmSync(DB + x, { force: true }); } catch {} };

(async () => {
  await boot();
  const { CREW } = await import(ROOT + '/data/crew.js');
  const mk = async (pfx) => { const token = randomBytes(32).toString('base64url'); const name = pfx + randomBytes(2).toString('hex');
    await api('POST', '/profiles', { body: { name, token } }); return { token, name, id: (await api('GET', '/profiles/me', { token })).data.id }; };
  const A = await mk('Ann'), B = await mk('Bea'), C = await mk('Cal');
  const room = async (host, guests, body) => {
    const lob = (await api('POST', '/lobbies', { token: host.token, body: { name: body.name, maxRounds: 7, ...body } })).data.lobby;
    for (const g of guests) await api('POST', `/lobbies/${lob.id}/join`, { token: g.token, body: {} });
    const gid = (await api('POST', `/lobbies/${lob.id}/start`, { token: host.token })).data.gameId;
    for (let k = 0; k < 3; k++) {
      const st = (await api('GET', `/games/${gid}`, { token: host.token })).data.game.state;
      for (const who of [host, ...guests]) {
        const p = st.players.find((x) => x.profileId === who.id);
        if (p && !p.faction) await api('POST', `/games/${gid}/ops`, { token: who.token, body: { kind: 'PICK_CREW', cardId: (CREW.find((c) => c.color === p.color) || CREW[0]).id, face: 'primary' } });
      }
    }
    return gid;
  };
  const gM2 = await room(A, [B], { name: 'm2 table', maxPlayers: 2, m1: true, m2: true });
  const gM2b = await room(A, [B], { name: 'm2 table again', maxPlayers: 2, m1: true, m2: true });
  const gBase = await room(A, [C], { name: 'base table', maxPlayers: 2 });
  const gCeo = await room(B, [], { name: 'ceo', maxPlayers: 1, ceoSolo: true });
  const gHot = await room(C, [], { name: 'hot seat', maxPlayers: 1, hotSeat: true, hotSeatSeats: 2 });
  const gLive = await room(A, [], { name: 'solo live', maxPlayers: 1 });
  await halt();

  // Finish the older games on disk with final scores, as a game that ended
  // before the leaderboards existed would sit there.
  const db = new Database(DB);
  const finish = (gid, scores, extra = {}) => {
    const row = db.prepare('SELECT state FROM game_states WHERE game_id = ?').get(gid);
    const st = JSON.parse(row.state);
    Object.assign(st, { status: 'finished', finishedAt: Date.now() }, extra);
    st.finalScores = st.players.map((p) => ({ profileId: p.profileId, name: p.name, total: scores[p.profileId] ?? 7 }));
    [...st.finalScores].sort((a, b) => b.total - a.total).forEach((s, i) => { s.rank = i + 1; });
    db.prepare('UPDATE game_states SET state = ? WHERE game_id = ?').run(JSON.stringify(st), gid);
    db.prepare("UPDATE games SET status = 'finished', finished_at = ? WHERE id = ?").run(Date.now(), gid);
  };
  finish(gM2, { [A.id]: 41, [B.id]: 55 });
  finish(gM2b, { [A.id]: 62, [B.id]: 30 });
  finish(gBase, { [A.id]: 24, [C.id]: 29 });
  finish(gCeo, { [B.id]: 47 }, { ceoVerdict: 'completed' });
  finish(gHot, {});
  // The live solo game: put it on its last round so a few END_TURNs finish it.
  {
    const row = db.prepare('SELECT state FROM game_states WHERE game_id = ?').get(gLive);
    const st = JSON.parse(row.state); st.round = st.maxRounds;
    db.prepare('UPDATE game_states SET state = ? WHERE game_id = ?').run(JSON.stringify(st), gLive);
  }
  const adminTok = randomBytes(24).toString('hex');
  db.prepare('INSERT INTO admin_sessions (token_hash, discord_id, created_at, expires_at) VALUES (?,?,?,?)')
    .run(createHash('sha256').update(adminTok).digest('hex'), ADMIN_DISCORD_ID, Date.now(), Date.now() + 3600e3);
  db.close();

  await boot();
  const backfilled = await waitFor(async () => {
    const r = await api('GET', '/leaderboards');
    return r.ok && ['table-m2', 'table-base', 'ceo'].every((k) => r.data.boards.some((b) => b.key === k));
  }, 20000);
  ok(backfilled, 'the background pass puts games that finished earlier onto the boards');

  let finished = false;
  for (let i = 0; i < 40 && !finished; i++) {
    await api('POST', `/games/${gLive}/ops`, { token: A.token, body: { kind: 'END_TURN' } });
    finished = (await api('GET', `/games/${gLive}`, { token: A.token })).data.game.state.status === 'finished';
  }
  ok(finished, 'the live solo game finishes through END_TURN');

  const lb = (await api('GET', '/leaderboards')).data.boards;
  const board = (k) => lb.find((b) => b.key === k);
  console.log('  boards:', lb.map((b) => `${b.key}[${b.entries.map((e) => `${e.name}:${e.best}/${e.wins}W/${e.games}G`).join(', ')}]`).join('  '));
  const m2 = board('table-m2');
  ok(m2 && m2.entries[0].name === A.name && m2.entries[0].best === 62 && m2.entries[0].wins === 1 && m2.entries[0].games === 2,
    'Module 2 table: Ann leads on her best game (62), 1 win in 2 games');
  ok(m2 && m2.entries[1] && m2.entries[1].name === B.name && m2.entries[1].best === 55 && m2.entries[1].wins === 1,
    'Module 2 table: Bea second on 55, 1 win');
  const base = board('table-base');
  ok(base && base.entries[0].name === C.name && base.entries[0].best === 29 && base.entries.length === 2,
    'Base table: Cal leads 29 over Ann, and the hot-seat game added no one');
  const ceo = board('ceo');
  ok(ceo && ceo.entries.length === 1 && ceo.entries[0].name === B.name && ceo.entries[0].wins === 1, 'CEO Solitaire: Bea, a completed tenure counted as a win');
  const solo = board('solo-base');
  ok(solo && solo.entries.length === 1 && solo.entries[0].name === A.name, 'Solo base game: the live finish was recorded the moment it ended');
  ok(!lb.some((b) => b.entries.some((e) => typeof e.profileId !== 'number')), 'no hot-seat or bot seat on any board');

  const cookie = `hf_admin=${adminTok}`;
  const page = await api('GET', '/admin', { cookie });
  ok(typeof page.data === 'string' && page.data.includes('Post leaderboard to Discord now') && page.data.includes(A.name), 'the admin page shows the leaderboards and the post button');
  const daily = await api('POST', '/admin/leaderboard/daily', { cookie, body: { enabled: true, hour: 18 } });
  ok(daily.ok && daily.data.enabled === true && daily.data.hour === 18, 'the daily post can be switched on with an hour');
  const post = await api('POST', '/admin/leaderboard/post', { cookie });
  ok(post.status === 503 && post.data.error === 'webhook_disabled', 'posting with no webhook set says so instead of failing silently');
  const anon = await api('POST', '/admin/leaderboard/post', {});
  ok(anon.status === 403, 'the post button is admin only');
  await halt();

  // The Discord message itself, from the same standings, with fetch stubbed.
  const { leaderboards, summaryEmbed } = await import(ROOT + '/server/leaderboard.js');
  const { sendWebhookPayload } = await import(ROOT + '/server/discord.js');
  const db2 = new Database(DB);
  const embed = summaryEmbed(leaderboards(db2, { limit: 5 }), { date: new Date('2026-10-24T17:00:00Z'), gameUrl: 'https://example.test/' });
  db2.close();
  const size = JSON.stringify(embed).length;
  ok(embed.fields.length >= 4 && embed.fields.length <= 25 && embed.fields.every((f) => f.value.length <= 1024) && size < 6000,
    `the embed fits Discord's limits (${embed.fields.length} fields, ${size} chars)`);
  let sent = null;
  globalThis.fetch = async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return { ok: true, text: async () => '' }; };
  const r = await sendWebhookPayload({ username: 'High Frontier', embeds: [embed] }, 'https://discord.com/api/webhooks/123456/abcDEF');
  ok(r.ok && sent && /wait=true/.test(sent.url) && sent.body.embeds[0].title.includes('LEADERBOARD') && sent.body.allowed_mentions.parse.length === 0,
    'the post sends the embed to the webhook and pings no one');
  console.log('\n' + JSON.stringify(embed, null, 1).slice(0, 900));
  console.log(`\n${pass} passed, ${fail} failed`);
  cleanup(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); cleanup(); process.exit(1); });
