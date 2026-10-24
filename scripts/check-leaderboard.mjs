// Leaderboards check, driven over the real routes against a live local server.
//
// Plays rooms of different modes over the API, finishes some of them on the
// server's own disk (the way an older finished game sits there), restarts so the
// background pass picks them up, finishes one more LIVE through END_TURN, and
// checks the standings: the right board per mode, best VP per player, wins,
// tutorial-free and hot-seat-free. Then the admin page and its two routes, and
// the Discord embed the "post" button sends as the bot (fetch stubbed, nothing leaves).
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
  const gM01 = await room(B, [C], { name: 'm0 m1 table', maxPlayers: 2, m0: true, m1: true });
  const gM1 = await room(C, [A], { name: 'm1 table', maxPlayers: 2, m1: true });
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
  finish(gM01, { [B.id]: 33, [C.id]: 38 });
  finish(gM1, { [C.id]: 20, [A.id]: 26 });
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
    return r.ok && ['table-m012', 'table-m01', 'table-m1', 'table-base', 'ceo'].every((k) => r.data.boards.some((b) => b.key === k));
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
  const m2 = board('table-m012');
  ok(m2 && m2.entries[0].name === A.name && m2.entries[0].best === 62 && m2.entries[0].wins === 1 && m2.entries[0].games === 2,
    'Modules 0 + 1 + 2 table: Ann leads on her best game (62), 1 win in 2 games');
  ok(m2 && m2.entries[1] && m2.entries[1].name === B.name && m2.entries[1].best === 55 && m2.entries[1].wins === 1,
    'Modules 0 + 1 + 2 table: Bea second on 55, 1 win');
  const m01 = board('table-m01'), m1 = board('table-m1');
  ok(m01 && m01.name === 'Modules 0 + 1' && m01.entries[0].name === C.name && m01.entries.length === 2,
    'Modules 0 + 1 has its own board (Cal 38 over Bea)');
  ok(m1 && m1.name === 'Module 1 · Terawatt' && m1.entries[0].name === A.name && !lb.some((b) => b.key === 'table-m2'),
    'Module 1 alone has its own board (Ann 26), apart from the 0 + 1 and 0 + 1 + 2 games');
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
  ok(page.data.includes('DISCORD_BOT_TOKEN'), 'with no bot token the admin page says how to turn posting on');
  // The admin page is one server-side template, so a quote escaped for the
  // server can come out broken in the browser. Every inline script must parse.
  const scripts = [...String(page.data).matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const broken = scripts.map((code, i) => { try { new Function(code); return null; } catch (e) { return `script ${i}: ${e.message}`; } }).filter(Boolean);
  ok(scripts.length > 0 && !broken.length, `every script on the admin page parses (${broken.join('; ') || scripts.length + ' scripts'})`);
  const post = await api('POST', '/admin/leaderboard/post', { cookie });
  ok(post.status === 503 && post.data.error === 'discord_disabled', 'posting with no bot says so instead of failing silently');
  const chans = await api('GET', '/admin/leaderboard/channels', { cookie });
  ok(chans.status === 503 && chans.data.error === 'discord_disabled', 'the channel list needs the bot');
  const badChan = await api('POST', '/admin/leaderboard/channel', { cookie, body: { id: 'general' } });
  ok(badChan.status === 400, 'a channel that is not a Discord channel id is refused');
  const goodChan = await api('POST', '/admin/leaderboard/channel', { cookie, body: { id: '987654321098765432', label: 'HF Club # leaderboards' } });
  ok(goodChan.ok && goodChan.data.label === 'HF Club # leaderboards', 'the picked channel is saved with its name');
  const anon = await api('POST', '/admin/leaderboard/post', {});
  ok(anon.status === 403, 'the post button is admin only');
  const anonChan = await api('POST', '/admin/leaderboard/channel', { body: { id: '987654321098765432' } });
  ok(anonChan.status === 403, 'picking the channel is admin only');
  await halt();

  // The Discord message itself, from the same standings, with fetch stubbed.
  const { leaderboards, summaryMessages } = await import(ROOT + '/server/leaderboard.js');
  process.env.DISCORD_BOT_TOKEN = 'test-bot-token';   // read when discord.js loads
  const { sendChannelMessage, botChannels } = await import(ROOT + '/server/discord.js');
  // "Load channels" must answer fast: reported locking up the admin page. A
  // stuck Discord call now fails after its time limit, the servers' channel
  // lists are asked for together, a rate limit says when to retry, and the
  // list is reused for a minute.
  {
    const realFetch = globalThis.fetch;
    let started = 0, inFlight = 0, maxInFlight = 0, calls = 0;
    globalThis.fetch = async (url, init) => {
      calls++;
      if (url.endsWith('/users/@me/guilds')) return { ok: true, status: 200, json: async () => [{ id: '1', name: 'Club' }, { id: '2', name: 'Lab' }, { id: '3', name: 'Ops' }] };
      started++; inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(150); inFlight--;
      const gid = url.match(/guilds\/(\d+)/)[1];
      return { ok: true, status: 200, json: async () => [
        { id: gid + '02', name: 'chat', type: 0, position: 2 }, { id: gid + '01', name: 'news', type: 5, position: 1 },
        { id: gid + '09', name: 'voice', type: 2, position: 0 } ] };
    };
    const t0 = Date.now();
    const list = await botChannels({ fresh: true });
    const took = Date.now() - t0;
    ok(list.length === 6 && list[0].name === 'news' && list.every((c) => c.name !== 'voice') && maxInFlight === 3 && took < 400,
      `the bot's channels come back together, text channels only, in Discord's order (${list.length} in ${took} ms, ${maxInFlight} at once)`);
    const before = calls; await botChannels();
    ok(calls === before, 'a second load within the minute asks Discord nothing');
    globalThis.fetch = (url, init) => new Promise((res, rej) => { init.signal.addEventListener('abort', () => rej(init.signal.reason)); });
    const keepAlive = setInterval(() => {}, 1000);   // AbortSignal.timeout does not hold the process open
    const t1 = Date.now(); let err = '';
    try { await botChannels({ fresh: true, timeoutMs: 300 }); } catch (e) { err = e.message; }
    clearInterval(keepAlive);
    ok(/did not answer in time/.test(err) && Date.now() - t1 < 1500, `a Discord call that never answers fails after its time limit ("${err}", ${Date.now() - t1} ms)`);
    globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({ retry_after: 2.4 }) });
    err = ''; try { await botChannels({ fresh: true }); } catch (e) { err = e.message; }
    ok(/rate-limiting.*3 s/.test(err), `a rate limit says when to try again ("${err}")`);
    globalThis.fetch = realFetch;
  }
  const db2 = new Database(DB);
  const msgs = summaryMessages(leaderboards(db2, { limit: 5 }), { date: new Date('2026-10-24T17:00:00Z'), gameUrl: 'https://example.test/' });
  db2.close();
  const titles = msgs.map((m) => m.embeds[0].title);
  ok(msgs.length === 2 && /MULTIPLAYER/.test(titles[0]) && /SOLO/.test(titles[1]),
    `the post is a Multiplayer section then a Solo section (${titles.join(' / ')})`);
  const boxes = msgs.flatMap((m) => m.embeds.slice(1));
  ok(boxes.length === 6 && boxes.every((b) => b.title && b.description && Number.isInteger(b.color)),
    `every board is its own box (${boxes.map((b) => b.title).join(', ')})`);
  const sizes = msgs.map((m) => JSON.stringify(m.embeds).length);
  ok(msgs.every((m) => m.embeds.length <= 10) && sizes.every((n) => n < 6000),
    `each message fits Discord's limits (${msgs.map((m) => m.embeds.length).join(' + ')} boxes, ${sizes.join(' / ')} chars)`);
  // Lots of boards: a section past nine boards carries on in a second message.
  const many = Array.from({ length: 14 }, (_, i) => ({ key: 'k' + i, name: 'Board ' + i, group: 'Multiplayer', emoji: '🚀', color: 1, players: 1, showsWins: true,
    entries: [{ rank: 1, name: 'P', best: 1, games: 1, wins: 0 }] }));
  const split = summaryMessages(many, { gameUrl: 'https://example.test/' });
  ok(split.length === 2 && split[0].embeds.length === 10 && split[1].embeds.length === 5, 'a long section splits at 10 boxes a message');
  let sent = null;
  globalThis.fetch = async (url, init) => { sent = { url, auth: init.headers.Authorization, body: JSON.parse(init.body) }; return { ok: true, text: async () => '' }; };
  const r = await sendChannelMessage('987654321098765432', msgs[0]);
  ok(r.ok && sent && sent.url.endsWith('/channels/987654321098765432/messages') && sent.auth === 'Bot test-bot-token'
    && sent.body.embeds[0].title.includes('LEADERBOARDS') && sent.body.allowed_mentions.parse.length === 0,
    'the post goes to the picked channel as the bot, and pings no one');
  console.log(`\n${pass} passed, ${fail} failed`);
  cleanup(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); cleanup(); process.exit(1); });
