import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const req = createRequire(import.meta.url);
let chromium;
for (const c of ['playwright', execSync('npm root -g',{encoding:'utf8'}).trim()+'/playwright']) {
  try { ({ chromium } = req(c)); break; } catch {}
}
const mobile = process.argv.includes('--mobile');
const b = await chromium.launch();
const p = await b.newPage({ viewport: mobile ? { width:390, height:820 } : { width:1360, height:860 }, deviceScaleFactor: 2 });
p.on('pageerror', e => console.log('ERR', e.message));
await p.goto('http://localhost:8137/index.html', { waitUntil:'domcontentloaded' });
await p.waitForTimeout(1200);

const clickId = async (id) => p.evaluate((i)=>{ const e=document.getElementById(i); if(e){ e.click(); return true;} return false; }, id);
// Walk the sandbox creation flow by id (these mount view-browse locally).
for (const id of ['btn-new-game','btn-new-game-sandbox','btn-new-game-solo','btn-solo-create','btn-sandbox-create']) {
  const ok = await clickId(id); if (ok) console.log('clicked', id);
  await p.waitForTimeout(500);
}
await p.waitForTimeout(3500);
const info = await p.evaluate(() => ({ canvas: !!document.querySelector('canvas'),
  browseShown: !document.getElementById('view-browse')?.classList.contains('hidden'),
  topbarBtns: [...document.querySelectorAll('#browse-topbar button, .topbar button, [id*=topbar] button')].map(b=>(b.textContent||'').trim()).filter(Boolean).slice(0,20),
}));
console.log('MOUNT2:', JSON.stringify(info));
await p.screenshot({ path: mobile ? 'scratchpad/gp-play-mobile.png':'scratchpad/gp-play.png' });
await b.close();
