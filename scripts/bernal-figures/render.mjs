// Render the M2 Bernal figures (scene.html) to player-colour PNGs in
// assets/bernal/. Headless three.js (WebGL via swiftshader) -> el.screenshot.
// three.js is fetched to a temp file on first run (not vendored). See README.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../../assets/bernal');
const THREE_VER = '0.161.0';
const THREE_TMP = path.join(os.tmpdir(), `three-${THREE_VER}.module.js`);

function loadPlaywright() {
  const req = createRequire(import.meta.url);
  const cands = ['playwright'];
  try { cands.push(execSync('npm root -g', { encoding: 'utf8' }).trim() + '/playwright'); } catch {}
  cands.push('/opt/node22/lib/node_modules/playwright');
  for (const c of cands) { try { return req(c); } catch {} }
  throw new Error('Playwright not found. Install it or run `npx playwright install chromium`.');
}

if (!fs.existsSync(THREE_TMP)) {
  console.log(`fetching three@${THREE_VER} -> ${THREE_TMP}`);
  execSync(`curl -sSL -o "${THREE_TMP}" "https://unpkg.com/three@${THREE_VER}/build/three.module.js"`, { stdio: 'inherit' });
}

const { chromium } = loadPlaywright();
const MIME = { '.html': 'text/html', '.js': 'text/javascript' };
const srv = http.createServer((rq, rs) => {
  let p = decodeURIComponent(rq.url.split('?')[0]);
  if (p === '/') p = '/scene.html';
  const file = p === '/three.module.js' ? THREE_TMP : path.join(HERE, p);
  fs.readFile(file, (e, b) => {
    if (e) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    rs.end(b);
  });
});
await new Promise((r) => srv.listen(8242, r));

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
await page.goto('http://localhost:8242/scene.html', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__ready, { timeout: 8000 });
await page.evaluate(() => { document.documentElement.style.background = 'transparent'; document.body.style.background = 'transparent'; });

// Curated per-seat tints (match FREIGHTER_COLOURS so all player figures agree).
const COLOURS = { gold: '#fccc00', magenta: '#b40054', mint: '#86efac', mauve: '#b079dd', gray: '#6b6f76', bone: '#e3e0d4' };
let n = 0;
for (const kind of ['stanford', 'kalpana']) {
  for (const [name, hex] of Object.entries(COLOURS)) {
    for (const anchored of [false, true]) {
      await page.evaluate(([k, c, a]) => window.renderModel(k, c, a), [kind, hex, anchored]);
      await page.waitForTimeout(60);
      const el = await page.$('#c');
      await el.screenshot({ path: path.join(OUT, `${kind}-${name}${anchored ? '-anchored' : ''}.png`), omitBackground: true });
      n++;
    }
  }
}
console.log(`rendered ${n} PNGs -> ${OUT}`);
await browser.close();
srv.close();
