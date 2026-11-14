// Fly a test ship in the real client (see SKILL.md). LOCAL ONLY.
//
//   node fly.cjs <setup-out.json> <name> <destSlug> [--roll] [--shots <dir>]
//
// Needs the scratch-worktree test hook (globalThis.__hz) in js/game/browse.js.
// Plans the rocket route to <destSlug> exactly as "Plan rocket route" does,
// presses Move, records every prompt that opens (radiation zone, hazard
// checklist, ...), with --roll accepts each one, then prints the server's
// mission-log line and the ship's position.
const pw = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const [setupPath, who, dest] = process.argv.slice(2);
const roll = process.argv.includes('--roll');
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
const SITE = process.env.HF_SITE || 'http://localhost:8137';
const API = process.env.HF_API || 'http://localhost:8790';
const { users } = JSON.parse(fs.readFileSync(setupPath, 'utf8'));
const u = users[who];

(async () => {
  const b = await pw.chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(([t, id, n]) => {
    localStorage.setItem('hf.profile', JSON.stringify({ name: n, token: t, id, createdAt: Date.now(), lastSeenAt: Date.now() }));
  }, [u.token, u.profileId, who]);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`${SITE}/?room=${u.code}`);
  await p.waitForFunction(() => globalThis.__hz && globalThis.__hz.data() && globalThis.__hz.data().sites.length > 100, null, { timeout: 30000 });
  await p.waitForTimeout(2500);
  const plan = await p.evaluate((dest) => {
    const H = globalThis.__hz, D = H.data();
    const slug = (id) => (D.byId[id] || {}).id2;
    const site = D.sites.find((s) => s.id2 === dest);
    if (!site) return { error: 'no such node ' + dest };
    H.plan(site.id);
    const r = H.route() || [];
    const t1 = r.filter((g) => (g.turn || 1) === 1);
    return {
      route: r.map((g) => `${slug(g.from)}>${slug(g.to)} burns${g.burns} turn${g.turn || 1}`),
      turn1Hazards: H.routeHazards(t1).map((h) => slug(h.site.id) + (h.aero ? ' (aero)' : '')),
      status: (document.querySelector('.map-status, #map-status, .browse-status') || {}).innerText || '',
    };
  }, dest);
  console.log('PLAN', JSON.stringify(plan));
  if (shots) await p.screenshot({ path: `${shots}/${who}-route.png` });
  await p.click('#turn-tag-move');
  await p.waitForTimeout(2500);
  // Move can raise a SEQUENCE of prompts (radiation zone, hazard checklist,
  // freighter / coast choices...). Record each one; with --roll, accept it
  // (roll / confirm) and continue until no prompt is left.
  const prompts = [];
  for (let i = 0; i < 6; i++) {
    const m = await p.evaluate(() => {
      const box = [...document.querySelectorAll('.card-modal-overlay')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && getComputedStyle(e).display !== 'none'; }).pop();
      return box ? box.innerText.replace(/\s+/g, ' ').slice(0, 300) : null;
    });
    if (!m) break;
    prompts.push(m);
    if (shots) await p.screenshot({ path: `${shots}/${who}-prompt${i + 1}.png` });
    if (!roll) break;
    const btn = await p.$('.card-modal-overlay button:has-text("Roll all now"), .card-modal-overlay button:has-text("Confirm"), .card-modal-overlay button:has-text("Roll")');
    if (!btn) break;
    await btn.click();
    await p.waitForTimeout(2000);
  }
  prompts.forEach((t, i) => console.log(`PROMPT ${i + 1}`, t));
  if (!prompts.length) console.log('PROMPT (none: Move went straight through)');
  await p.waitForTimeout(5000);
  const log = await fetch(`${API}/games/${u.gameId}/ops`, { headers: { authorization: 'Bearer ' + u.token } }).then((r) => r.json());
  const g = (await fetch(`${API}/games/${u.gameId}`, { headers: { authorization: 'Bearer ' + u.token } }).then((r) => r.json())).game;
  const me = g.state.players[0];
  console.log('SERVER LAST', JSON.stringify(log.entries.slice(-1).map((e) => `${e.kind}: ${e.log}`)));
  console.log('SERVER ship at', me.rocket.siteId, '| aqua', me.aqua, '| tank', me.rocket.tank);
  if (errs.length) console.log('PAGE ERRORS', errs.slice(0, 5));
  await b.close();
})();
