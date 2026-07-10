import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const req = createRequire(import.meta.url);
let chromium;
for (const c of ['playwright', execSync('npm root -g',{encoding:'utf8'}).trim()+'/playwright']) {
  try { ({ chromium } = req(c)); break; } catch {}
}
const mobile = process.argv.includes('--mobile');
const b = await chromium.launch();
const p = await b.newPage({ viewport: mobile ? { width:390, height:800 } : { width:1360, height:860 }, deviceScaleFactor: 2 });
p.on('pageerror', ()=>{});
await p.goto('http://localhost:8137/index.html', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);

const clickByText = async (re) => {
  const els = await p.$$('button, a, [role=button], .menu-item');
  for (const el of els) {
    const t = ((await el.textContent())||'').trim();
    if (re.test(t) && await el.isVisible().catch(()=>false)) { await el.click().catch(()=>{}); return t; }
  }
  return null;
};

// Try to open a solo sandbox game (offline, localStorage - no API needed).
let clicked = await clickByText(/solo|sandbox/i);
if (!clicked) { await clickByText(/new game/i); await p.waitForTimeout(500); clicked = await clickByText(/solo|sandbox/i); }
await p.waitForTimeout(800);
// A solo game may open a "start" / difficulty confirm.
await clickByText(/^(start|play|begin|create|standard)/i);
await p.waitForTimeout(3500);

// Report what mounted.
const info = await p.evaluate(() => ({
  hasCanvas: !!document.querySelector('canvas'),
  ids: [...document.querySelectorAll('[id]')].map(e=>e.id).filter(x=>/browse|map|topbar|hand|rocket|op|panel|sidebar/i.test(x)).slice(0,20),
  visibleBtns: [...document.querySelectorAll('button')].filter(b=>b.offsetParent).map(b=>(b.textContent||'').trim()).filter(Boolean).slice(0,30),
}));
console.log('MOUNT:', JSON.stringify(info));
await p.screenshot({ path: mobile ? 'scratchpad/gp-play-mobile.png' : 'scratchpad/gp-play.png', fullPage:false });
await b.close();
