import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const req = createRequire(import.meta.url);
let chromium;
for (const c of ['playwright', execSync('npm root -g',{encoding:'utf8'}).trim()+'/playwright']) { try { ({chromium}=req(c)); break; } catch {} }
const mobile = process.argv.includes('--mobile');
const b = await chromium.launch();
const p = await b.newPage({ viewport: mobile?{width:390,height:840}:{width:900,height:900}, deviceScaleFactor:2 });
p.on('pageerror', e=>console.log('ERR',e.message));
await p.goto('http://localhost:8137/index.html',{waitUntil:'domcontentloaded'});
await p.waitForTimeout(1200);
await p.evaluate(() => {
  document.getElementById('new-game-modal')?.classList.remove('hidden');
  document.getElementById('new-game-mode')?.classList.add('hidden');
  document.getElementById('new-game-solo-opts')?.classList.remove('hidden');
});
// click Tutorial solo-type
await p.evaluate(() => document.getElementById('solo-mode-tutorial')?.click());
await p.waitForTimeout(400);
await p.screenshot({ path: mobile?'scratchpad/wiz-tutorial-mobile.png':'scratchpad/wiz-tutorial.png' });
// also capture the sandbox (regular) menu for contrast
await p.evaluate(() => document.querySelector('.solo-opt[data-solomode="sandbox"]')?.click());
await p.waitForTimeout(300);
await p.screenshot({ path: mobile?'scratchpad/wiz-sandbox-mobile.png':'scratchpad/wiz-sandbox.png' });
await b.close();
