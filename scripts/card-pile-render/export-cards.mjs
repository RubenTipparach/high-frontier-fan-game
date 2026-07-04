// Export every M2 colonist FRONT card to a transparent PNG by driving the real
// in-game renderCard() in headless Chromium. Serve the repo root first
// (python3 -m http.server 8137), then:  node export-cards.mjs <outDir>
// See docs/render.md.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const req = createRequire(import.meta.url);
let chromium;
for (const c of ['playwright', execSync('npm root -g',{encoding:'utf8'}).trim()+'/playwright', '/opt/node22/lib/node_modules/playwright']) {
  try { chromium = req(c).chromium; break; } catch {}
}
const outDir = process.argv[2];
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1200 }, deviceScaleFactor: 3 });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
await page.goto('http://localhost:8137/scripts/card-pile-render/export.html', { waitUntil: 'networkidle' });
await page.waitForFunction('window.__ready === true', { timeout: 8000 });
await page.waitForTimeout(800);
const ids = await page.evaluate(() => window.__cardIds);
for (const id of ids) {
  const el = await page.$(`.export-card[data-id="${id}"] .card`);
  if (!el) { console.log('MISSING', id); continue; }
  await el.screenshot({ path: `${outDir}/${id}.png`, omitBackground: true });
}
console.log('exported', ids.length, 'cards');
if (errs.length) console.log('errors:', JSON.stringify(errs.slice(0,5)));
await browser.close();
