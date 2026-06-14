#!/usr/bin/env node
// Render a web page (URL or local file) to a PNG with headless Chromium, so a
// change to the UI / a card glyph / a map marker can be reviewed visually
// (CLAUDE.md "Generating an SVG? Show a rendered screenshot first.").
//
// Usage:
//   node scripts/screenshot.mjs <url|file> [out.png] [--width=N] [--height=N]
//                               [--scale=2] [--wait=ms] [--full] [--ready=expr]
//
// Examples:
//   # serve the app first:  python3 -m http.server 8137
//   node scripts/screenshot.mjs http://localhost:8137/index.html /tmp/home.png
//   node scripts/screenshot.mjs ./some-card-preview.html out.png --scale=2 --full
//
// Notes on this environment (learned the hard way, documented so it isn't
// re-discovered): Playwright is installed GLOBALLY, the browser binaries live
// at PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers (NOT ~/.cache/ms-playwright), and
// `playwright` is CommonJS so it imports via the default export. If the browser
// is missing, run `npx playwright install chromium` to completion (do NOT pipe
// it through `head`/`tail` - a closed pipe SIGPIPE-kills the download).

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

function loadPlaywright() {
  const req = createRequire(import.meta.url);
  // 1) local node_modules, 2) the global install root.
  const candidates = ['playwright'];
  try { candidates.push(execSync('npm root -g', { encoding: 'utf8' }).trim() + '/playwright'); } catch {}
  candidates.push('/opt/node22/lib/node_modules/playwright');
  for (const c of candidates) {
    try { return req(c); } catch {}
  }
  console.error('Could not load Playwright. Install it (npm i -D playwright) or run');
  console.error('`npx playwright install chromium` if the browser binary is missing.');
  process.exit(2);
}

const args = process.argv.slice(2);
const flags = Object.fromEntries(
  args.filter((a) => a.startsWith('--')).map((a) => {
    const [k, v] = a.slice(2).split('=');
    return [k, v === undefined ? true : v];
  }),
);
const positional = args.filter((a) => !a.startsWith('--'));
let target = positional[0];
const out = positional[1] || '/tmp/screenshot.png';
if (!target) {
  console.error('Usage: node scripts/screenshot.mjs <url|file> [out.png] [--width=N] [--height=N] [--scale=2] [--wait=ms] [--full] [--ready=expr]');
  process.exit(1);
}
// Allow a bare local path.
if (!/^https?:\/\//.test(target) && !target.startsWith('file://')) {
  target = 'file://' + (existsSync(target) ? resolve(target) : target);
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: Number(flags.width) || 1280, height: Number(flags.height) || 800 },
  deviceScaleFactor: Number(flags.scale) || 1,
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(target, { waitUntil: 'networkidle' });
if (flags.ready) await page.waitForFunction(String(flags.ready), { timeout: 8000 }).catch(() => {});
if (flags.wait) await page.waitForTimeout(Number(flags.wait));

await page.screenshot({ path: out, fullPage: !!flags.full });
await browser.close();

console.log(`screenshot -> ${out}`);
if (errors.length) console.log(`page errors (first 5): ${JSON.stringify(errors.slice(0, 5))}`);
