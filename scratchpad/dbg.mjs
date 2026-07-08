import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const req = createRequire(import.meta.url);
let chromium;
for (const c of ['playwright', execSync('npm root -g',{encoding:'utf8'}).trim()+'/playwright']) {
  try { ({ chromium } = req(c)); break; } catch {}
}
const b = await chromium.launch();
const p = await b.newPage();
p.on('pageerror', e => console.log('PAGEERR', e.message));
await p.goto('http://localhost:8137/scratchpad/buggy-roads-verify.html?site=mars_north_pole&zoom=8', { waitUntil: 'networkidle' });
await p.waitForFunction('window.__ready===true', { timeout: 8000 }).catch(()=>{});
const out = await p.evaluate(() => {
  const r = window.__r; const groups = r.constructor;
  // pull BUGGY_ROAD_GROUPS via the module the renderer used? re-import.
  return import('../data/buggy-roam.js').then(m => {
    const idxSites = (r.data && r.data.sites) || [];
    const byId2 = {}; for (const s of idxSites) if (s && s.id2) byId2[s.id2] = s;
    const byServer = {}; for (const s of idxSites) if (s && s.serverId) byServer[s.serverId] = s;
    return m.BUGGY_ROAD_GROUPS.map(g => ({
      group: g,
      resolved: g.map(id => {
        const n = byId2[id] || byServer[id] || (r.data.byId && r.data.byId[id]);
        return n ? { id, id2: n.id2, x: Math.round(n.x), y: Math.round(n.y) } : { id, MISS: true };
      }),
    }));
  });
});
console.log(JSON.stringify(out, null, 1));
await b.close();
