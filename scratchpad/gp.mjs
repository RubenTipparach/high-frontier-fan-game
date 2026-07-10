import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const req = createRequire(import.meta.url);
let chromium;
for (const c of ['playwright', execSync('npm root -g',{encoding:'utf8'}).trim()+'/playwright']) {
  try { ({ chromium } = req(c)); break; } catch {}
}
const b = await chromium.launch();
const mobile = process.argv.includes('--mobile');
const p = await b.newPage({ viewport: mobile ? { width:390, height:800 } : { width:1360, height:860 }, deviceScaleFactor: 2 });
p.on('pageerror', e => {});
await p.goto('http://localhost:8137/index.html', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);

// Open the top-left hamburger menu.
await p.click('button:has-text("☰"), .menu-toggle, #menu-toggle, header button').catch(()=>{});
await p.waitForTimeout(600);
// Dump the visible clickable labels so we know the menu structure.
const labels = await p.evaluate(() => [...document.querySelectorAll('button, a, [role=button], .menu-item, li')]
  .map(e => (e.textContent||'').trim()).filter(t => t && t.length < 40));
console.log('LABELS:', JSON.stringify([...new Set(labels)].slice(0, 40)));
await p.screenshot({ path: mobile ? 'scratchpad/gp-menu-open-mobile.png' : 'scratchpad/gp-menu-open.png' });

// Try to reach the Browse map (read-only, offline-friendly).
for (const sel of ['text=Browse', 'text=Sandbox', 'text=Solo', 'text=Explore', 'text=Map']) {
  const el = await p.$(sel);
  if (el) { await el.click().catch(()=>{}); await p.waitForTimeout(2500); break; }
}
await p.screenshot({ path: mobile ? 'scratchpad/gp-view-mobile.png' : 'scratchpad/gp-view.png' });
console.log('done');
await b.close();
