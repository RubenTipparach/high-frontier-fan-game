// Game test sandbox setup (see SKILL.md). LOCAL ONLY.
//
//   node setup.mjs <out.json> <name:cardId:face> [...] [--db <scratch.db>] [--anchor]
//                  [--rocket <preset>] [--at <node slug>]
//
// Per entry: an admin profile (the name must be in the server's
// RAT_ADMIN_NAMES), a solo m0+m1+m2 Free Library game, started, with the crew
// picked through the real PICK_CREW op. Mints one local EDIT token for the admin
// game editor. --anchor gives each player an anchored Home Bernal at a real Home
// Bernal node so Module 2 faction privileges unlock (needs --db). --rocket builds
// a known stack from rockets.json through the admin game editor; --at parks it.
import { randomBytes, createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const API = process.env.HF_API || 'http://localhost:8790';
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(API)) throw new Error('local servers only');
const args = process.argv.slice(2);
const out = args.shift();
const dbAt = args.includes('--db') ? args[args.indexOf('--db') + 1] : null;
const anchor = args.includes('--anchor');
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const rocketName = opt('--rocket');
const at = opt('--at');
const entries = args.filter((a, i) => a.includes(':') && !['--db', '--rocket', '--at'].includes(args[i - 1]));

const call = async (token, method, path, body) => {
  const r = await fetch(API + path, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  try { return { s: r.status, d: JSON.parse(t) }; } catch { return { s: r.status, d: t }; }
};

const users = {};
for (const e of entries) {
  const [name, cardId, face] = e.split(':');
  const token = randomBytes(32).toString('base64url');
  const prof = await call(token, 'POST', '/profiles', { name, token });
  const lob = await call(token, 'POST', '/lobbies', { name: `${name} test`, maxPlayers: 1, joinPolicy: 'open', m0: true, m1: true, m2: true, economy: 'library' });
  const start = await call(token, 'POST', `/lobbies/${lob.d.lobby.id}/start`, {});
  const pick = await call(token, 'POST', `/games/${start.d.gameId}/ops`, { kind: 'PICK_CREW', cardId, face });
  users[name] = { token, profileId: prof.d.id, code: lob.d.lobby.code, gameId: start.d.gameId };
  console.log(name, 'game', start.d.gameId, 'pick', pick.s, pick.d.error || pick.d.log);
}

let editToken = null;
if (dbAt) {
  const require = createRequire(new URL('../../../server/index.js', import.meta.url));
  const DB = require('better-sqlite3')(dbAt);
  editToken = 'hfe_' + randomBytes(24).toString('base64url');
  DB.prepare('INSERT INTO read_tokens (token_hash,label,created_by,created_at,scope) VALUES (?,?,?,?,?)')
    .run(createHash('sha256').update(editToken).digest('hex'), 'local sandbox', 'local', Date.now(), 'edit');
  if (anchor) {
    for (const u of Object.values(users)) {
      const row = DB.prepare('SELECT state FROM game_states WHERE game_id = ?').get(u.gameId);
      const s = JSON.parse(row.state);
      // A REAL Home Bernal node: the client's isHomeBernalUnit reads the map tag,
      // not the server-only `home` flag.
      s.players[0].bernals = [{ cardId: 'ber_l1_climate_control_bernal', face: 'primary', siteId: 'burn-9b26i', anchored: true, stack: [] }];
      DB.prepare('UPDATE game_states SET state = ? WHERE game_id = ?').run(JSON.stringify(s), u.gameId);
    }
    console.log('anchored a Home Bernal for', Object.keys(users).join(', '));
  }
} else console.log('no --db: no edit token minted, no anchoring');

// Build the preset stack and park it, through the real admin game editor.
if (rocketName || at) {
  if (!editToken) throw new Error('--rocket / --at need --db (for the edit token)');
  const presets = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('./rockets.json', import.meta.url), 'utf8'));
  const preset = rocketName ? presets[rocketName] : null;
  if (rocketName && !preset) throw new Error('unknown rocket preset ' + rocketName);
  const edit = async (u, body) => {
    const r = await fetch(`${API}/admin/games/${u.gameId}/edit`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + editToken }, body: JSON.stringify({ profileId: u.profileId, ...body }) });
    const d = await r.json();
    if (!d.ok) throw new Error(`edit ${body.action} failed: ${JSON.stringify(d)}`);
    return d.log;
  };
  for (const [name, u] of Object.entries(users)) {
    if (preset) {
      for (const c of preset.cards) {
        await edit(u, { action: 'give_card', cardId: c.id, to: 'rocket' });
        if (c.face === 'secondary') await edit(u, { action: 'flip_card', cardId: c.id, from: 'rocket', face: 'secondary' });
      }
      await edit(u, { action: 'set_water', value: preset.water, grade: 'water' });
      // A thruster on the stack does nothing until it is the ACTIVE thruster
      // (otherwise net thrust reads 0 and only zero-burn coasts plan). Switch
      // it on the way a player does: the real SET_ACTIVE_THRUSTER op.
      if (preset.active) {
        const r = await call(u.token, 'POST', `/games/${u.gameId}/ops`, { kind: 'SET_ACTIVE_THRUSTER', cardId: preset.active });
        if (r.s !== 200) throw new Error('SET_ACTIVE_THRUSTER failed: ' + JSON.stringify(r.d));
      }
    }
    if (at) await edit(u, { action: 'teleport', node: at });
    console.log(name, 'rocket', rocketName || '(none)', 'at', at || '(LEO)');
  }
}

writeFileSync(out, JSON.stringify({ editToken, users }, null, 1));
console.log('wrote', out);
