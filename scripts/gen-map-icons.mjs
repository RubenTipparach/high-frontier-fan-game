#!/usr/bin/env node
// Rasterise the solar-map routing-node markers (lander / hazard / aerobrake)
// into transparent PNG sprites under assets/map-icons/. The renderer
// (js/game/render.js) draws these sprites instead of hand-running the canvas
// paths every frame, so the icon art is a swappable image asset.
//
// Re-run this whenever the marker art changes:
//   python3 -m http.server 8137   # not needed; this runs headless on its own
//   node scripts/gen-map-icons.mjs
//
// Playwright is global here (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers); see
// scripts/screenshot.mjs for the environment notes.

import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

// Managed sandboxes keep the Playwright browsers at /opt/pw-browsers; default to
// it when the env var isn't set so `npm run icons` works without a prefix.
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/opt/pw-browsers')) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
}

function loadPlaywright() {
  const req = createRequire(import.meta.url);
  const candidates = ['playwright'];
  try { candidates.push(execSync('npm root -g', { encoding: 'utf8' }).trim() + '/playwright'); } catch {}
  candidates.push('/opt/node22/lib/node_modules/playwright');
  for (const c of candidates) { try { return req(c); } catch {} }
  console.error('Could not load Playwright.');
  process.exit(2);
}

// The base map radius each marker is authored against (matches render.js), and
// the supersample factor K: each sprite is drawn at radius*K in an SZ px canvas,
// and the renderer blits it back down at box = SZ / K screen pixels.
export const ICON_SUPERSAMPLE = 6.4;
export const ICON_PNG_SIZE = 128;
const MAP_R = 9.6;   // lander glyph radius  (TYPE_VIS.burn.r * 1.6)
const HAZ_R = 7.5;   // hazard ring radius
const VEN_R = 8;     // venus / aerobrake ring radius

const { chromium } = loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

const result = await page.evaluate(({ SZ, K, MAP_R, HAZ_R, VEN_R }) => {
  const PINK = '#ec1f8d';
  const RING = '#c66932';
  const C = SZ / 2;

  function drawLanderGlyph(ctx, cx, cy, r, fill) {
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(r, r);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const legs = new Path2D('M-0.26 0.14L-0.64 0.70M0.26 0.14L0.64 0.70');
    const feet = new Path2D('M-0.80 0.70L-0.50 0.70M0.50 0.70L0.80 0.70');
    const body = new Path2D();
    body.moveTo(-0.48, 0.18); body.lineTo(-0.48, -0.14);
    body.quadraticCurveTo(-0.48, -0.72, 0, -0.72);
    body.quadraticCurveTo(0.48, -0.72, 0.48, -0.14);
    body.lineTo(0.48, 0.18); body.closePath();
    const nozzle = new Path2D('M-0.15 0.16L0.15 0.16L0.10 0.40L-0.10 0.40Z');
    ctx.strokeStyle = '#ffffff'; ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 0.36; ctx.stroke(legs);
    ctx.lineWidth = 0.34; ctx.stroke(feet);
    ctx.lineWidth = 0.30; ctx.fill(body); ctx.stroke(body);
    ctx.fill(nozzle); ctx.stroke(nozzle);
    ctx.strokeStyle = fill; ctx.fillStyle = fill;
    ctx.lineWidth = 0.16; ctx.stroke(legs);
    ctx.lineWidth = 0.15; ctx.stroke(feet);
    ctx.fill(body); ctx.fill(nozzle);
    ctx.restore();
  }
  function drawCutLine(ctx, cx, cy, r) {
    ctx.save();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1.3, 0.12 * r); ctx.lineCap = 'round';
    // Span the full lander (body top to footpads) so the "cut" reads cleanly.
    ctx.beginPath(); ctx.moveTo(cx, cy - 0.82 * r); ctx.lineTo(cx, cy + 0.82 * r); ctx.stroke();
    ctx.restore();
  }
  function drawHalfLanderGlyph(ctx, cx, cy, r, fill) {
    ctx.save(); ctx.beginPath(); ctx.rect(cx - 1.2 * r, cy - 1.6 * r, 1.2 * r, 3.2 * r); ctx.clip();
    drawLanderGlyph(ctx, cx, cy, r, fill); ctx.restore();
    drawCutLine(ctx, cx, cy, r);
  }
  function drawSkullGlyph(ctx, cx, cy, r, fill) {
    ctx.save(); ctx.translate(cx, cy); ctx.scale(r, r); ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(0, -0.16, 0.74, Math.PI * 0.86, Math.PI * 0.14, false);
    ctx.lineTo(0.40, 0.30); ctx.quadraticCurveTo(0.40, 0.62, 0.16, 0.66);
    ctx.lineTo(-0.16, 0.66); ctx.quadraticCurveTo(-0.40, 0.62, -0.40, 0.30); ctx.closePath();
    ctx.moveTo(-0.10, -0.10); ctx.arc(-0.30, -0.10, 0.20, 0, Math.PI * 2);
    ctx.moveTo(0.50, -0.10); ctx.arc(0.30, -0.10, 0.20, 0, Math.PI * 2);
    ctx.moveTo(0, 0.02); ctx.lineTo(0.12, 0.28); ctx.lineTo(-0.12, 0.28); ctx.closePath();
    ctx.rect(-0.22, 0.50, 0.10, 0.20); ctx.rect(-0.05, 0.50, 0.10, 0.20); ctx.rect(0.12, 0.50, 0.10, 0.20);
    ctx.fill('evenodd');
    ctx.restore();
  }
  // A skull with a thin dark outline so it still reads when it sits directly on
  // top of the pink lander (the full lander + hazard case).
  function drawSkullOutlined(ctx, cx, cy, r) {
    drawSkullGlyph(ctx, cx, cy, r * 1.06, '#3a0a22');
    drawSkullGlyph(ctx, cx, cy, r, '#ffffff');
  }
  function drawParachuteGlyph(ctx, cx, cy, r, fill, opts) {
    const payload = !opts || opts.payload !== false;
    ctx.save(); ctx.translate(cx, cy); ctx.scale(r, r); ctx.fillStyle = fill; ctx.strokeStyle = fill;
    ctx.beginPath();
    ctx.arc(0, -0.22, 0.80, Math.PI, 0, false);
    ctx.arc(0.533, -0.22, 0.267, 0, Math.PI, false);
    ctx.arc(0, -0.22, 0.267, 0, Math.PI, false);
    ctx.arc(-0.533, -0.22, 0.267, 0, Math.PI, false);
    ctx.closePath(); ctx.fill();
    ctx.lineWidth = 0.09; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-0.78, -0.22); ctx.lineTo(0, 0.62);
    ctx.moveTo(-0.267, 0.04); ctx.lineTo(0, 0.62);
    ctx.moveTo(0.267, 0.04); ctx.lineTo(0, 0.62);
    ctx.moveTo(0.78, -0.22); ctx.lineTo(0, 0.62);
    ctx.stroke();
    if (payload) {
      ctx.beginPath(); ctx.moveTo(-0.14, 0.62); ctx.lineTo(0.14, 0.62);
      ctx.lineTo(0.10, 0.82); ctx.lineTo(-0.10, 0.82); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  function drawLanderHazardGlyph(ctx, cx, cy, r, landerFill) {
    ctx.save(); ctx.beginPath(); ctx.rect(cx - 1.2 * r, cy - 1.6 * r, 1.2 * r, 3.2 * r); ctx.clip();
    drawLanderGlyph(ctx, cx, cy, r, landerFill); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(cx, cy - 1.6 * r, 1.2 * r, 3.2 * r); ctx.clip();
    drawSkullGlyph(ctx, cx, cy, r * 0.92, '#ffffff'); ctx.restore();
    drawCutLine(ctx, cx, cy, r);
  }
  function ring(ctx, cx, cy, r) {
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.lineWidth = r * 0.16; ctx.strokeStyle = RING; ctx.stroke();
  }

  function make(draw) {
    const cv = document.createElement('canvas');
    cv.width = SZ; cv.height = SZ;
    const ctx = cv.getContext('2d');
    draw(ctx, C, C);
    return cv.toDataURL('image/png');
  }
  const lr = MAP_R * K;
  return {
    'lander':              make((c, x, y) => drawLanderGlyph(c, x, y, lr, PINK)),
    'lander-half':         make((c, x, y) => drawHalfLanderGlyph(c, x, y, lr, PINK)),
    // Full lander + hazard: the skull sits ON TOP of the lander (centred).
    'lander-hazard':       make((c, x, y) => { drawLanderGlyph(c, x, y, lr, PINK); drawSkullOutlined(c, x, y - lr * 0.14, lr * 0.5); }),
    'lander-half-hazard':  make((c, x, y) => drawLanderHazardGlyph(c, x, y, lr, PINK)),
    'hazard':              make((c, x, y) => { ring(c, x, y, HAZ_R * K); drawSkullGlyph(c, x, y, HAZ_R * K * 0.78, '#ffffff'); }),
    // A parachute is itself a kind of hazard, so aerobrake sites (which the data
    // also marks hazard) use just the parachute - no skull.
    'aerobrake':           make((c, x, y) => { ring(c, x, y, VEN_R * K); drawParachuteGlyph(c, x, y, VEN_R * 0.9 * K, '#ffffff'); }),
  };
}, { SZ: ICON_PNG_SIZE, K: ICON_SUPERSAMPLE, MAP_R, HAZ_R, VEN_R });

await browser.close();

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '..', 'assets', 'map-icons');
mkdirSync(outDir, { recursive: true });
for (const [name, dataUrl] of Object.entries(result)) {
  const b64 = dataUrl.split(',')[1];
  writeFileSync(resolve(outDir, `${name}.png`), Buffer.from(b64, 'base64'));
  console.log(`wrote assets/map-icons/${name}.png`);
}
