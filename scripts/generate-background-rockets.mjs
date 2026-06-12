// Background-vehicle concept generator: scientifically proportioned crewed
// rockets drawn as side-profile SVG illustrations at a shared scale.
// Scale: 7 px per meter. Light source from the left.
// Emits assets/background-rockets/*.svg plus a _contact-sheet.svg that lines
// every vehicle up baseline-aligned against a meter scale bar.
// Run: node scripts/generate-background-rockets.mjs
// CONCEPTS ONLY for now: nothing in the app loads these yet (pending art
// sign-off, see assets/background-rockets/README.md).
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'background-rockets');

const S = 7; // px per meter

function clamp(n) { return Math.max(0, Math.min(255, Math.round(n))); }
function shade(hex, amt) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
  else { const k = 1 + amt; r *= k; g *= k; b *= k; }
  return '#' + [clamp(r), clamp(g), clamp(b)].map(v => v.toString(16).padStart(2, '0')).join('');
}

// Horizontal cylinder-shading gradient (light from left).
function cylGrad(id, base) {
  return `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">` +
    `<stop offset="0" stop-color="${shade(base, -0.42)}"/>` +
    `<stop offset="0.17" stop-color="${shade(base, 0.16)}"/>` +
    `<stop offset="0.33" stop-color="${shade(base, 0.52)}"/>` +
    `<stop offset="0.62" stop-color="${base}"/>` +
    `<stop offset="1" stop-color="${shade(base, -0.55)}"/>` +
    `</linearGradient>`;
}

function makeCtx(prefix, widthM, heightM, depthM = 3) {
  // depthM: how far below the ground line content may extend (engine bells)
  const W = Math.ceil(widthM * S) + 10;
  const H = Math.ceil((heightM + depthM) * S) + 8;
  const cx = W / 2;
  const gy = 4 + heightM * S; // ground line y px
  const X = m => cx + m * S;
  const Y = m => gy - m * S;
  const px = m => m * S;
  const defs = new Map();
  const parts = [];
  function fillRef(base) {
    const key = base.replace('#', '');
    const id = `${prefix}-g${key}`;
    if (!defs.has(id)) defs.set(id, cylGrad(id, base));
    return `url(#${id})`;
  }
  const ctx = {
    W, H, X, Y, px, defs, parts,
    add(s) { parts.push(s); },
    // cylinder section: centered at cxM offset, from botM up hM, width wM
    cyl(botM, hM, wM, base, { cxM = 0, rx = 0 } = {}) {
      parts.push(`<rect x="${X(cxM - wM / 2).toFixed(1)}" y="${Y(botM + hM).toFixed(1)}" width="${px(wM).toFixed(1)}" height="${px(hM).toFixed(1)}" ${rx ? `rx="${rx}" ` : ''}fill="${fillRef(base)}"/>`);
    },
    // symmetric taper from wBot to wTop
    trap(botM, hM, wBotM, wTopM, base, { cxM = 0 } = {}) {
      const yb = Y(botM), yt = Y(botM + hM);
      const p = `M${X(cxM - wTopM / 2).toFixed(1)} ${yt.toFixed(1)} L${X(cxM + wTopM / 2).toFixed(1)} ${yt.toFixed(1)} L${X(cxM + wBotM / 2).toFixed(1)} ${yb.toFixed(1)} L${X(cxM - wBotM / 2).toFixed(1)} ${yb.toFixed(1)} Z`;
      parts.push(`<path d="${p}" fill="${fillRef(base)}"/>`);
    },
    // curved nose cone (quadratic sides), tip width wTipM
    nose(botM, hM, wBotM, wTipM, base, { cxM = 0, bow = 0.55 } = {}) {
      const yb = Y(botM), yt = Y(botM + hM);
      const xl = X(cxM - wBotM / 2), xr = X(cxM + wBotM / 2);
      const tl = X(cxM - wTipM / 2), tr = X(cxM + wTipM / 2);
      const cyy = yb - (yb - yt) * bow;
      const p = `M${xl.toFixed(1)} ${yb.toFixed(1)} Q${xl.toFixed(1)} ${cyy.toFixed(1)} ${tl.toFixed(1)} ${yt.toFixed(1)} L${tr.toFixed(1)} ${yt.toFixed(1)} Q${xr.toFixed(1)} ${cyy.toFixed(1)} ${xr.toFixed(1)} ${yb.toFixed(1)} Z`;
      parts.push(`<path d="${p}" fill="${fillRef(base)}"/>`);
    },
    // engine bell flaring down from topM
    bell(cxM, topM, hM, wTopM, wExitM, base = '#4a4f5a') {
      const yt = Y(topM), yb = Y(topM - hM);
      const tl = X(cxM - wTopM / 2), tr = X(cxM + wTopM / 2);
      const bl = X(cxM - wExitM / 2), br = X(cxM + wExitM / 2);
      const cyy = yt + (yb - yt) * 0.45;
      const p = `M${tl.toFixed(1)} ${yt.toFixed(1)} L${tr.toFixed(1)} ${yt.toFixed(1)} Q${tr.toFixed(1)} ${cyy.toFixed(1)} ${br.toFixed(1)} ${yb.toFixed(1)} L${bl.toFixed(1)} ${yb.toFixed(1)} Q${tl.toFixed(1)} ${cyy.toFixed(1)} ${tl.toFixed(1)} ${yt.toFixed(1)} Z`;
      parts.push(`<path d="${p}" fill="${fillRef(base)}"/>`);
      parts.push(`<ellipse cx="${X(cxM).toFixed(1)}" cy="${yb.toFixed(1)}" rx="${(px(wExitM) / 2).toFixed(1)}" ry="${(px(wExitM) * 0.10).toFixed(1)}" fill="#14161c"/>`);
    },
    // thin shadow line at a section joint
    seam(yM, wM, { cxM = 0, op = 0.28 } = {}) {
      parts.push(`<rect x="${X(cxM - wM / 2).toFixed(1)}" y="${(Y(yM) - 0.8).toFixed(1)}" width="${px(wM).toFixed(1)}" height="1.6" fill="#000" opacity="${op}"/>`);
    },
    // flat decal rect (markings)
    decal(botM, hM, wM, fill, { cxM = 0, op = 1 } = {}) {
      parts.push(`<rect x="${X(cxM - wM / 2).toFixed(1)}" y="${Y(botM + hM).toFixed(1)}" width="${px(wM).toFixed(1)}" height="${px(hM).toFixed(1)}" fill="${fill}" opacity="${op}"/>`);
    },
    vtext(cxM, midM, sizePx, str, fill = '#1c2230') {
      parts.push(`<text x="${X(cxM).toFixed(1)}" y="${Y(midM).toFixed(1)}" transform="rotate(90 ${X(cxM).toFixed(1)} ${Y(midM).toFixed(1)})" font-family="Helvetica, Arial, sans-serif" font-size="${sizePx}" font-weight="700" letter-spacing="1.5" fill="${fill}" text-anchor="middle">${str}</text>`);
    },
    htext(cxM, midM, sizePx, str, fill = '#1c2230') {
      parts.push(`<text x="${X(cxM).toFixed(1)}" y="${(Y(midM) + sizePx * 0.35).toFixed(1)}" font-family="Helvetica, Arial, sans-serif" font-size="${sizePx}" font-weight="700" letter-spacing="1" fill="${fill}" text-anchor="middle">${str}</text>`);
    },
    // arbitrary polygon in meter coords [[x,y],...] with cylinder shading
    poly(pts, base) {
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join(' ') + ' Z';
      parts.push(`<path d="${d}" fill="${fillRef(base)}"/>`);
    },
    flag(cxM, midM, wM) {
      const w = px(wM), h = w * 0.6;
      const x = X(cxM) - w / 2, y = Y(midM) - h / 2;
      let s = `<g>`;
      for (let i = 0; i < 5; i++) s += `<rect x="${x.toFixed(1)}" y="${(y + h * i / 5).toFixed(1)}" width="${w.toFixed(1)}" height="${(h / 5).toFixed(1)}" fill="${i % 2 ? '#e7ebf2' : '#b3322e'}"/>`;
      s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(w * 0.42).toFixed(1)}" height="${(h * 0.5).toFixed(1)}" fill="#26356b"/></g>`;
      parts.push(s);
    },
  };
  return ctx;
}

function emit(prefix, label, heightM, ctx) {
  const defs = [...ctx.defs.values()].join('');
  const inner = ctx.parts.join('\n  ');
  return { prefix, label, heightM, W: ctx.W, H: ctx.H, defs, inner };
}

// ---------------- Saturn V (Apollo) ----------------
function saturnV() {
  const c = makeCtx('satv', 19.5, 111);
  const WHITE = '#e9edf3', BLACK = '#262a32', GRAY = '#9aa2af', SILVER = '#c7cdd8';
  // F-1 engine bells (center + 2 outboard visible)
  c.bell(0, 0.6, 3.1, 1.7, 3.5);
  c.bell(-3.3, 0.6, 3.1, 1.7, 3.5);
  c.bell(3.3, 0.6, 3.1, 1.7, 3.5);
  // S-IC stage 42.1 m x 10.1 m
  c.cyl(0, 42.1, 10.1, WHITE);
  // engine fairings + fins at base
  for (const sgn of [-1, 1]) {
    c.trap(0, 6.2, 2.6, 1.1, GRAY, { cxM: sgn * 5.6 });
    const xb = c.X(sgn * 6.8), xt = c.X(sgn * 5.3), xr = c.X(sgn * 9.3);
    c.add(`<path d="M${xt} ${c.Y(5.8)} L${xr} ${c.Y(0.4)} L${xb} ${c.Y(0)} L${xt} ${c.Y(0)} Z" fill="${shade(GRAY, -0.15)}"/>`);
  }
  // aft black roll-pattern stripes
  for (const x of [-3.8, -1.3, 1.3, 3.8]) c.decal(0.8, 8.4, 1.45, BLACK, { cxM: x });
  c.vtext(2.9, 21, 15, 'UNITED STATES');
  c.flag(-1.8, 27, 3.4);
  // intertank black corrugation rectangles
  for (const x of [-2.9, 2.9]) c.decal(31.5, 4.6, 2.5, BLACK, { cxM: x });
  // forward-skirt black quadrants
  for (const x of [-2.6, 2.6]) c.decal(39.9, 2.2, 3.4, BLACK, { cxM: x });
  c.seam(42.1, 10.1);
  // S-IC / S-II interstage
  c.cyl(42.1, 1.7, 10.1, GRAY);
  for (const x of [-2.6, 2.6]) c.decal(42.1, 1.7, 3.4, BLACK, { cxM: x });
  // S-II 24.7 m
  c.cyl(43.8, 24.7, 10.1, WHITE);
  c.seam(68.5, 10.1);
  // S-II / S-IVB tapered interstage
  c.trap(68.5, 5.7, 10.1, 6.6, WHITE);
  for (const x of [-1.9, 1.9]) c.decal(68.7, 1.8, 2.4, BLACK, { cxM: x });
  // S-IVB
  c.cyl(74.2, 12.0, 6.6, WHITE);
  c.seam(74.2, 6.6);
  c.decal(74.4, 1.4, 6.5, BLACK, { op: 0.92 });
  c.flag(0, 83.4, 2.2);
  c.htext(0, 81.0, 5.5, 'UNITED STATES');
  // Instrument Unit
  c.cyl(86.2, 0.9, 6.6, GRAY);
  // SLA taper
  c.trap(87.1, 8.5, 6.6, 3.9, WHITE);
  c.seam(87.1, 6.6);
  // Service Module
  c.cyl(95.6, 4.9, 3.9, SILVER);
  c.seam(95.6, 3.9);
  c.decal(97.6, 0.9, 0.7, '#3a4250', { cxM: -1.35 });
  c.decal(97.6, 0.9, 0.7, '#3a4250', { cxM: 1.35 });
  // Command Module (boost protective cover)
  c.trap(100.5, 3.5, 3.9, 0.9, SILVER);
  // LES tower (open truss)
  const ty0 = c.Y(104.0), ty1 = c.Y(106.8);
  c.add(`<path d="M${c.X(-1.1)} ${ty0} L${c.X(-0.33)} ${ty1} M${c.X(1.1)} ${ty0} L${c.X(0.33)} ${ty1} M${c.X(-1.05)} ${c.Y(104.9)} L${c.X(1.05)} ${c.Y(104.9)} M${c.X(-0.85)} ${c.Y(105.9)} L${c.X(0.85)} ${c.Y(105.9)} M${c.X(-1.1)} ${ty0} L${c.X(0.9)} ${c.Y(105.7)} M${c.X(1.1)} ${ty0} L${c.X(-0.9)} ${c.Y(105.7)}" stroke="#5b6270" stroke-width="1.6" fill="none"/>`);
  // escape motor + nozzles + Q-ball nose
  c.bell(-0.45, 107.1, 0.75, 0.3, 0.62, '#3c424e');
  c.bell(0.45, 107.1, 0.75, 0.3, 0.62, '#3c424e');
  c.cyl(106.8, 2.8, 0.66, WHITE);
  c.nose(109.6, 1.0, 0.66, 0.12, GRAY);
  return emit('satv', 'SATURN V · APOLLO', 110.6, c);
}

// ---------------- Titan II GLV (Gemini) ----------------
function geminiTitan() {
  const c = makeCtx('gt', 6.5, 34);
  const WHITE = '#eaeef4', BLACK = '#23272f', CHAR = '#34383f';
  c.bell(-0.8, 0.5, 2.1, 0.9, 1.45);
  c.bell(0.8, 0.5, 2.1, 0.9, 1.45);
  // stage 1, 3.05 m dia
  c.cyl(0, 21.4, 3.05, WHITE);
  for (const x of [-0.95, 0.95]) c.decal(1.0, 5.4, 0.55, BLACK, { cxM: x });
  c.vtext(0.55, 12.5, 9, 'UNITED STATES');
  c.flag(-0.7, 18.4, 1.5);
  c.decal(20.6, 0.5, 3.05, BLACK);
  c.seam(21.4, 3.05);
  // stage 2
  c.cyl(21.4, 5.9, 3.05, WHITE);
  c.decal(22.0, 3.6, 0.5, BLACK, { cxM: -1.0 });
  c.seam(27.3, 3.05);
  // Gemini adapter (white) + retro section
  c.trap(27.3, 2.3, 3.05, 2.32, WHITE);
  c.seam(29.0, 2.5, { op: 0.2 });
  // re-entry module: charcoal Rene-41 cone
  c.trap(29.6, 2.3, 2.32, 0.98, CHAR);
  c.cyl(31.9, 0.85, 0.98, CHAR);
  c.nose(32.75, 0.55, 0.98, 0.55, '#5a6068');
  // windows
  c.decal(30.9, 0.32, 0.26, '#9fd3e8', { cxM: -0.42 });
  c.decal(30.9, 0.32, 0.26, '#9fd3e8', { cxM: 0.42 });
  return emit('gt', 'TITAN II · GEMINI', 33.2, c);
}

// ---------------- SLS Block 1 (Artemis) ----------------
function slsArtemis() {
  const c = makeCtx('sls', 16.5, 99);
  const ORANGE = '#c05a20', WHITE = '#e9edf3', CREAM = '#e6e3d5', DARK = '#3a3f49';
  const bx = 6.06; // booster centerline offset
  // boosters first (behind core edges)
  for (const sgn of [-1, 1]) {
    const x = sgn * bx;
    c.bell(x, 0.2, 1.6, 1.6, 2.6, '#4a4f5a');
    c.trap(0.2, 3.0, 4.4, 3.71, DARK, { cxM: x });        // aft skirt
    c.cyl(3.2, 42.0, 3.71, WHITE, { cxM: x });            // segments
    for (const yy of [11.4, 19.6, 27.8, 36.0]) c.seam(yy, 3.71, { cxM: x, op: 0.22 });
    c.trap(45.2, 5.6, 3.71, 1.55, WHITE, { cxM: x });     // frustum
    c.nose(50.8, 3.2, 1.55, 0.2, WHITE, { cxM: x });      // nose cone
    c.seam(45.2, 3.71, { cxM: x });
  }
  // core RS-25s
  c.bell(-1.6, 1.6, 2.6, 1.3, 2.3);
  c.bell(1.6, 1.6, 2.6, 1.3, 2.3);
  c.bell(0, 1.5, 2.5, 1.3, 2.3);
  // core stage, 8.4 m dia orange
  c.trap(1.5, 4.0, 6.6, 8.4, shade(ORANGE, -0.18)); // boattail
  c.cyl(5.5, 59.5, 8.4, ORANGE);
  c.seam(5.5, 8.4, { op: 0.2 });
  c.decal(26.0, 3.4, 8.4, shade(ORANGE, -0.14));    // intertank band
  c.seam(26.0, 8.4, { op: 0.18 }); c.seam(29.4, 8.4, { op: 0.18 });
  c.flag(-2.4, 47, 2.8);
  c.decal(3.0, 56.0, 0.55, shade(ORANGE, -0.3), { cxM: 3.6 }); // systems tunnel
  // LVSA
  c.trap(65.0, 7.5, 8.4, 5.1, WHITE);
  c.seam(65.0, 8.4);
  // ICPS
  c.cyl(72.5, 9.8, 5.1, CREAM);
  c.seam(82.3, 5.1);
  // Orion stage adapter + ESM fairing
  c.trap(82.3, 1.5, 5.1, 4.8, WHITE);
  c.cyl(83.8, 4.7, 4.8, WHITE);
  c.seam(83.8, 4.8, { op: 0.2 });
  c.decal(84.0, 4.3, 0.12, '#9aa2af', { cxM: -1.2 });
  c.decal(84.0, 4.3, 0.12, '#9aa2af', { cxM: 1.2 });
  // LAS ogive over the crew module
  c.nose(88.5, 5.2, 4.8, 1.0, WHITE, { bow: 0.45 });
  // abort motor + nozzles + nose
  c.bell(-0.62, 93.9, 1.0, 0.4, 0.85, '#3c424e');
  c.bell(0.62, 93.9, 1.0, 0.4, 0.85, '#3c424e');
  c.cyl(93.5, 3.5, 1.0, '#cfd4dd');
  c.nose(97.0, 1.1, 1.0, 0.16, '#262a32');
  return emit('sls', 'SLS BLOCK 1 · ARTEMIS', 98.1, c);
}

// ---------------- Project Orion (nuclear pulse) ----------------
function projectOrion() {
  const c = makeCtx('orion', 11.5, 41.5, 1);
  const STEEL = '#8a93a3', DKSTEEL = '#646d7c', COPPER = '#b4713d', RUBBER = '#4a4e57';
  // pusher plate: shallow copper dome
  c.add(`<path d="M${c.X(-5)} ${c.Y(1.5)} Q${c.X(0)} ${c.Y(-0.6)} ${c.X(5)} ${c.Y(1.5)} L${c.X(4.7)} ${c.Y(1.8)} L${c.X(-4.7)} ${c.Y(1.8)} Z" fill="url(#orion-g${COPPER.slice(1)})"/>`);
  c.cyl(0.0, 1.5, 10.0, COPPER, { rx: 3 }); // plate rim
  c.seam(1.5, 9.6, { op: 0.35 });
  // first-stage shock absorbers: two gas-bag tori
  c.cyl(1.8, 1.25, 8.2, RUBBER, { rx: 5 });
  c.cyl(3.15, 1.25, 7.7, RUBBER, { rx: 5 });
  // second-stage telescoping pistons
  for (const x of [-2.9, -1.0, 1.0, 2.9]) {
    c.cyl(4.4, 3.1, 0.42, '#aeb6c2', { cxM: x });
    c.cyl(4.4, 1.5, 0.62, DKSTEEL, { cxM: x });
  }
  // lower hull: pulse-unit magazines, flaring toward the plate
  c.trap(7.5, 8.0, 8.7, 6.9, STEEL);
  c.seam(7.5, 8.5, { op: 0.32 });
  for (const yy of [9.4, 11.3, 13.2]) c.seam(yy, 7.9, { op: 0.2 });
  c.decal(8.3, 1.1, 1.0, '#3c424e', { cxM: -2.4 });
  c.decal(8.3, 1.1, 1.0, '#3c424e', { cxM: 2.4 });
  // mid hull: propellant + stores
  c.trap(15.5, 10.5, 6.9, 5.7, STEEL);
  c.seam(15.5, 6.9, { op: 0.25 });
  for (const yy of [18.8, 22.4]) c.seam(yy, 6.3, { op: 0.16 });
  c.decal(16.5, 8.4, 0.4, shade(STEEL, -0.32), { cxM: 2.3 });
  // crew decks with a lit window band
  c.trap(26.0, 7.0, 5.7, 3.9, DKSTEEL);
  c.seam(26.0, 5.7, { op: 0.25 });
  for (const x of [-1.5, -0.75, 0, 0.75, 1.5]) c.decal(29.6, 0.5, 0.42, '#bfe9f5', { cxM: x });
  // nose: rounded shoulder + escape capsule
  c.nose(33.0, 5.0, 3.9, 1.4, STEEL, { bow: 0.5 });
  c.trap(38.0, 2.2, 1.4, 0.6, '#cfd4dd');
  c.nose(40.2, 1.0, 0.6, 0.1, DKSTEEL);
  // antenna boom
  c.add(`<path d="M${c.X(2.0)} ${c.Y(31.5)} L${c.X(3.6)} ${c.Y(34.5)}" stroke="#aeb6c2" stroke-width="1.4"/><circle cx="${c.X(3.6)}" cy="${c.Y(34.5)}" r="2.6" fill="none" stroke="#aeb6c2" stroke-width="1.2"/>`);
  return emit('orion', 'PROJECT ORION · NUCLEAR PULSE', 41.2, c);
}

// ---------------- Soyuz (crewed) ----------------
function soyuz() {
  const c = makeCtx('soyuz', 9.5, 50);
  const GRAYG = '#a9b1a0', DGRAY = '#7d8576', WHITE = '#e9edf3', TAN = '#a98358';
  // core (Blok A) first, boosters overlap it
  c.bell(-0.7, 0.4, 1.2, 0.5, 0.85, '#4a4f5a');
  c.bell(0.7, 0.4, 1.2, 0.5, 0.85, '#4a4f5a');
  c.trap(0.4, 27.4, 2.95, 2.66, GRAYG);
  c.seam(10.0, 2.8, { op: 0.15 }); c.seam(20.0, 2.7, { op: 0.15 });
  // strap-on boosters (2 visible): conical 19.6 m, hugging the core;
  // outer edge slants in toward the top, inner edge rides the core line
  for (const sgn of [-1, 1]) {
    const m = v => sgn * v;
    c.bell(m(3.05), 0.35, 1.1, 0.55, 0.9, '#4a4f5a');
    c.bell(m(2.0), 0.35, 1.1, 0.55, 0.9, '#4a4f5a');
    c.poly([[m(1.52), 0.35], [m(3.95), 0.35], [m(2.0), 19.6], [m(1.45), 19.6]], sgn < 0 ? GRAYG : shade(GRAYG, -0.12));
    // booster nose cone leaning into the core
    c.add(`<path d="M${c.X(m(1.45))} ${c.Y(19.6)} L${c.X(m(2.0))} ${c.Y(19.6)} Q${c.X(m(1.75))} ${c.Y(20.9)} ${c.X(m(1.5))} ${c.Y(21.3)} Z" fill="${shade(DGRAY, sgn < 0 ? 0.15 : -0.1)}"/>`);
    c.seam(13.0, 1.4, { cxM: m(2.35), op: 0.16 });
    c.seam(6.0, 1.9, { cxM: m(2.65), op: 0.16 });
  }
  // lattice interstage (truss)
  const ly0 = c.Y(27.8), ly1 = c.Y(30.0);
  let truss = '';
  for (let i = -3; i < 3; i++) {
    const x0 = c.X(i * 0.44), x1 = c.X((i + 1) * 0.44);
    truss += `M${x0} ${ly0} L${x1} ${ly1} M${x1} ${ly0} L${x0} ${ly1} `;
  }
  c.add(`<path d="${truss}" stroke="${TAN}" stroke-width="1.6" fill="none"/>`);
  c.add(`<path d="M${c.X(-1.33)} ${ly0} L${c.X(1.33)} ${ly0} M${c.X(-1.33)} ${ly1} L${c.X(1.33)} ${ly1}" stroke="${shade(TAN, -0.25)}" stroke-width="2"/>`);
  // Blok I third stage
  c.cyl(30.0, 6.7, 2.66, GRAYG);
  c.seam(36.7, 2.66);
  // payload fairing with boattail
  c.trap(36.7, 1.2, 2.66, 3.0, WHITE);
  c.cyl(37.9, 4.6, 3.0, WHITE);
  c.nose(42.5, 3.0, 3.0, 1.0, WHITE, { bow: 0.5 });
  c.seam(40.4, 3.0, { op: 0.16 });
  // SAS escape tower
  c.cyl(45.5, 1.1, 1.0, WHITE);
  c.bell(-0.42, 47.4, 0.8, 0.3, 0.6, '#3c424e');
  c.bell(0.42, 47.4, 0.8, 0.3, 0.6, '#3c424e');
  c.trap(46.6, 1.6, 1.0, 0.62, WHITE);
  c.cyl(48.2, 0.9, 0.62, WHITE);
  c.nose(49.1, 0.6, 0.62, 0.1, DGRAY);
  return emit('soyuz', 'SOYUZ', 49.5, c);
}

// ---------------- Falcon 9 + Crew Dragon ----------------
function falcon9() {
  const c = makeCtx('f9', 6.5, 70);
  const WHITE = '#eaeef4', BLACK = '#23272f';
  for (const x of [-1.2, -0.4, 0.4, 1.2]) c.bell(x, 0.3, 1.1, 0.5, 0.8, '#3c424e');
  // octaweb band + booster
  c.cyl(0.3, 2.0, 3.66, BLACK);
  c.cyl(2.3, 36.2, 3.66, WHITE);
  // landing legs
  for (const sgn of [-1, 1]) {
    const xb = c.X(sgn * 1.83), xt = c.X(sgn * 1.55);
    c.add(`<path d="M${xt} ${c.Y(14.5)} L${c.X(sgn * 2.25)} ${c.Y(1.0)} L${xb} ${c.Y(0.8)} L${xb} ${c.Y(13.5)} Z" fill="#1d2026"/>`);
  }
  c.vtext(0.4, 24, 8, 'FALCON 9', '#3a4250');
  c.flag(-0.8, 31.5, 1.5);
  // grid fins (folded)
  c.decal(36.6, 1.7, 0.35, '#454b55', { cxM: -1.95 });
  c.decal(36.6, 1.7, 0.35, '#454b55', { cxM: 1.95 });
  // interstage
  c.cyl(38.5, 6.0, 3.66, BLACK);
  // stage 2
  c.cyl(44.5, 16.5, 3.66, WHITE);
  c.seam(44.5, 3.66);
  // Dragon trunk: solar-array half + fins
  c.cyl(61.0, 3.7, 3.66, WHITE);
  c.decal(61.2, 3.3, 1.7, '#1b2540', { cxM: -0.92 });
  for (const sgn of [-1, 1]) {
    c.add(`<path d="M${c.X(sgn * 1.83)} ${c.Y(61.2)} L${c.X(sgn * 2.5)} ${c.Y(61.0)} L${c.X(sgn * 1.83)} ${c.Y(63.2)} Z" fill="#cfd4dd"/>`);
  }
  c.seam(61.0, 3.66);
  // capsule
  c.seam(64.7, 3.66, { op: 0.35 });
  c.trap(64.7, 3.6, 3.66, 2.0, WHITE);
  c.decal(64.75, 0.45, 3.5, '#454b55');
  c.decal(66.6, 0.5, 0.42, '#2a3a4c', { cxM: -0.62 });
  c.decal(66.6, 0.5, 0.42, '#2a3a4c', { cxM: 0.62 });
  c.nose(68.3, 1.2, 2.0, 0.7, WHITE, { bow: 0.6 });
  return emit('f9', 'FALCON 9 · CREW DRAGON', 69.5, c);
}

// ================= chibi spacecraft =================
// Super-deformed in-space configurations: no launch boosters (those stay on
// the pad; these are the vehicles as they cruise between worlds). Not to
// scale with each other on purpose: chibi proportions are squat + chunky,
// with fat noses and oversized windows.

function win(c, xM, yM, rM = 0.42) {
  const x = c.X(xM).toFixed(1), y = c.Y(yM).toFixed(1), r = c.px(rM).toFixed(1);
  c.add(`<circle cx="${x}" cy="${y}" r="${r}" fill="#0e1726" stroke="#5b6270" stroke-width="1.2"/>` +
    `<circle cx="${(c.X(xM) - c.px(rM) * 0.32).toFixed(1)}" cy="${(c.Y(yM) - c.px(rM) * 0.32).toFixed(1)}" r="${(c.px(rM) * 0.28).toFixed(1)}" fill="#bfe9f5" opacity="0.9"/>`);
}

// solar-array wing attached at (xM, yM), rotated angleDeg, dir +1 right / -1 left
function wing(c, xM, yM, angleDeg, lenM, widM, dir) {
  const x = c.X(xM), y = c.Y(yM);
  const L = c.px(lenM) * dir, Wd = c.px(widM);
  const x0 = Math.min(x, x + L).toFixed(1), w = Math.abs(L).toFixed(1);
  let segs = '';
  for (let i = 1; i < 3; i++) {
    const sx = (x + L * i / 3).toFixed(1);
    segs += `<line x1="${sx}" y1="${(y - Wd / 2).toFixed(1)}" x2="${sx}" y2="${(y + Wd / 2).toFixed(1)}" stroke="#c9a86a" stroke-width="1.2"/>`;
  }
  c.add(`<g transform="rotate(${angleDeg} ${x.toFixed(1)} ${y.toFixed(1)})">` +
    `<rect x="${x0}" y="${(y - Wd / 2).toFixed(1)}" width="${w}" height="${Wd.toFixed(1)}" rx="3" fill="#24386b" stroke="#0f1830" stroke-width="1.2"/>${segs}` +
    `<rect x="${x0}" y="${(y - Wd / 2).toFixed(1)}" width="${w}" height="${(Wd * 0.3).toFixed(1)}" rx="2" fill="#fff" opacity="0.14"/></g>`);
}

function chibiApolloCsm() {
  const c = makeCtx('cap', 6.5, 13.0);
  const SILVER = '#c7cdd8', BRIGHT = '#dde3ec';
  c.bell(0, 1.9, 2.4, 1.3, 2.9);
  c.cyl(1.9, 5.6, 4.8, SILVER);
  c.seam(7.5, 4.8);
  // RCS quads
  for (const sgn of [-1, 1]) {
    c.decal(4.6, 0.5, 0.9, '#3a4250', { cxM: sgn * 1.85 });
    c.decal(4.2, 1.3, 0.32, '#3a4250', { cxM: sgn * 1.85 });
  }
  c.decal(2.4, 0.5, 4.8, shade(SILVER, -0.25));
  // command module: fat cone
  c.nose(7.5, 4.3, 4.8, 1.5, BRIGHT, { bow: 0.4 });
  win(c, -0.85, 8.8, 0.46);
  win(c, 0.85, 8.8, 0.46);
  // docking probe
  c.cyl(11.8, 0.6, 1.2, '#9aa2af');
  c.nose(12.4, 0.6, 0.8, 0.2, '#646d7c');
  return emit('cap', 'APOLLO CSM', 13.0, c);
}

function chibiOrionMpcv() {
  const c = makeCtx('cor', 14.5, 12.5);
  const WHITE = '#e9edf3', HULL = '#b9c2cf';
  c.bell(0, 1.7, 2.2, 1.1, 2.5);
  // X-wing solar arrays behind the ESM
  for (const dir of [-1, 1]) {
    wing(c, dir * 2.0, 4.6, dir * -24, 4.9, 1.5, dir);
    wing(c, dir * 2.0, 3.4, dir * 14, 4.6, 1.4, dir);
  }
  c.cyl(1.7, 4.6, 4.6, WHITE);
  for (const yy of [2.7, 3.7, 4.7]) c.seam(yy, 4.4, { op: 0.12 });
  c.seam(6.3, 4.6);
  // crew module
  c.nose(6.3, 4.4, 4.8, 1.7, HULL, { bow: 0.42 });
  c.decal(6.35, 0.5, 4.7, '#8d6b4a'); // heatshield lip
  win(c, -0.85, 7.9, 0.44);
  win(c, 0.85, 7.9, 0.44);
  c.cyl(10.7, 0.7, 1.3, '#9aa2af');
  c.nose(11.4, 0.5, 1.0, 0.3, '#646d7c');
  return emit('cor', 'ORION', 12.0, c);
}

function chibiCrewDragon() {
  const c = makeCtx('cdr', 7.0, 12.5);
  const WHITE = '#eaeef4';
  // trunk with solar skin + fins
  for (const dir of [-1, 1]) {
    c.add(`<path d="M${c.X(dir * 2.3).toFixed(1)} ${c.Y(0.4).toFixed(1)} L${c.X(dir * 3.1).toFixed(1)} ${c.Y(0.0).toFixed(1)} L${c.X(dir * 2.3).toFixed(1)} ${c.Y(2.6).toFixed(1)} Z" fill="#cfd4dd" stroke="#646d7c" stroke-width="1"/>`);
  }
  c.cyl(0, 4.6, 4.6, WHITE);
  c.add(`<rect x="${c.X(-2.18).toFixed(1)}" y="${c.Y(4.25).toFixed(1)}" width="${c.px(2.0).toFixed(1)}" height="${c.px(3.9).toFixed(1)}" rx="3" fill="#1b2540" stroke="#0f1830" stroke-width="1"/>`);
  for (const yy of [1.65, 2.95]) c.add(`<line x1="${c.X(-2.18).toFixed(1)}" y1="${c.Y(yy).toFixed(1)}" x2="${c.X(-0.18).toFixed(1)}" y2="${c.Y(yy).toFixed(1)}" stroke="#c9a86a" stroke-width="1"/>`);
  c.seam(4.6, 4.6);
  // capsule with heatshield band + SuperDraco pods
  c.decal(4.65, 0.55, 4.7, '#454b55');
  c.nose(4.6, 4.7, 4.8, 1.9, WHITE, { bow: 0.5 });
  for (const sgn of [-1, 1]) c.decal(5.6, 1.0, 0.75, '#454b55', { cxM: sgn * 1.85 });
  win(c, -0.8, 6.9, 0.44);
  win(c, 0.8, 6.9, 0.44);
  // rounded nose cap
  c.nose(9.3, 1.3, 1.9, 0.9, '#cfd4dd', { bow: 0.75 });
  return emit('cdr', 'CREW DRAGON', 10.6, c);
}

function chibiSoyuz() {
  const c = makeCtx('csz', 14.5, 13.5);
  const GRAYG = '#a9b1a0', BRONZE = '#9d8468';
  c.bell(0, 1.4, 2.0, 1.0, 2.3);
  for (const dir of [-1, 1]) wing(c, dir * 2.0, 3.6, dir * -6, 4.9, 1.7, dir);
  // service module
  c.cyl(1.4, 4.4, 4.2, GRAYG);
  c.decal(1.7, 0.6, 4.2, shade(GRAYG, -0.28));
  c.seam(5.8, 4.2);
  // descent module: headlight shape
  c.trap(5.8, 0.7, 4.2, 3.7, BRONZE);
  c.nose(6.5, 2.7, 3.7, 2.5, BRONZE, { bow: 0.72 });
  win(c, 0, 7.6, 0.45);
  // orbital module: sphere
  c.cyl(9.2, 3.7, 3.7, GRAYG, { rx: 12 });
  c.seam(9.25, 2.6, { op: 0.2 });
  win(c, 0, 11.0, 0.4);
  // rendezvous antenna boom + dish
  c.add(`<path d="M${c.X(1.6).toFixed(1)} ${c.Y(12.2).toFixed(1)} L${c.X(2.6).toFixed(1)} ${c.Y(13.2).toFixed(1)}" stroke="#aeb6c2" stroke-width="1.4"/>` +
    `<circle cx="${c.X(2.6).toFixed(1)}" cy="${c.Y(13.2).toFixed(1)}" r="3" fill="none" stroke="#aeb6c2" stroke-width="1.2"/>`);
  return emit('csz', 'SOYUZ', 12.9, c);
}

function chibiGemini() {
  const c = makeCtx('cgm', 5.5, 10.5);
  const WHITE = '#eaeef4', CHAR = '#34383f';
  // equipment adapter with retro thruster dots
  c.trap(0, 2.9, 4.5, 3.8, WHITE);
  for (const x of [-1.2, 0, 1.2]) c.decal(0.25, 0.5, 0.5, '#3a4250', { cxM: x });
  c.seam(2.9, 3.8);
  c.trap(2.9, 1.3, 3.8, 3.4, '#cfd4dd');
  c.seam(4.2, 3.4);
  // re-entry module: charcoal fat cone with big windows
  c.nose(4.2, 4.0, 3.4, 1.5, CHAR, { bow: 0.38 });
  win(c, -0.72, 5.6, 0.46);
  win(c, 0.72, 5.6, 0.46);
  c.cyl(8.2, 1.0, 1.5, '#8a93a3');
  c.nose(9.2, 0.9, 1.5, 0.5, '#646d7c', { bow: 0.6 });
  return emit('cgm', 'GEMINI', 10.1, c);
}

function chibiOrionPulse() {
  const c = makeCtx('cop', 10.5, 14.5, 1);
  const STEEL = '#8a93a3', DKSTEEL = '#646d7c', COPPER = '#b4713d', RUBBER = '#4a4e57';
  // chunky copper pusher plate
  c.add(`<path d="M${c.X(-4.6).toFixed(1)} ${c.Y(1.4).toFixed(1)} Q${c.X(0).toFixed(1)} ${c.Y(-0.7).toFixed(1)} ${c.X(4.6).toFixed(1)} ${c.Y(1.4).toFixed(1)} Z" fill="url(#cop-g${COPPER.slice(1)})"/>`);
  c.cyl(0, 1.4, 9.2, COPPER, { rx: 4 });
  c.seam(1.4, 8.8, { op: 0.35 });
  // shock absorbers: fat tori + stubby pistons
  c.cyl(1.6, 1.2, 7.6, RUBBER, { rx: 6 });
  c.cyl(2.8, 1.2, 7.0, RUBBER, { rx: 6 });
  for (const x of [-2.0, 0, 2.0]) c.cyl(4.0, 1.4, 0.7, '#aeb6c2', { cxM: x });
  // squat hull
  c.trap(5.4, 4.2, 7.2, 5.4, STEEL);
  c.seam(5.4, 7.0, { op: 0.3 });
  for (const yy of [6.7, 8.1]) c.seam(yy, 6.4, { op: 0.16 });
  c.trap(9.6, 2.8, 5.4, 4.0, DKSTEEL);
  win(c, -1.1, 10.6, 0.42);
  win(c, 0, 10.7, 0.42);
  win(c, 1.1, 10.6, 0.42);
  c.nose(12.4, 1.7, 4.0, 1.1, STEEL, { bow: 0.5 });
  c.nose(14.1, 0.6, 1.1, 0.2, DKSTEEL);
  c.add(`<path d="M${c.X(1.6).toFixed(1)} ${c.Y(12.6).toFixed(1)} L${c.X(2.9).toFixed(1)} ${c.Y(13.8).toFixed(1)}" stroke="#aeb6c2" stroke-width="1.4"/>` +
    `<circle cx="${c.X(2.9).toFixed(1)}" cy="${c.Y(13.8).toFixed(1)}" r="2.6" fill="none" stroke="#aeb6c2" stroke-width="1.2"/>`);
  return emit('cop', 'ORION PULSE SHIP', 14.7, c);
}

// ---------------- output ----------------
const rockets = [saturnV(), slsArtemis(), falcon9(), soyuz(), projectOrion(), geminiTitan()];
const chibis = [chibiApolloCsm(), chibiOrionMpcv(), chibiCrewDragon(), chibiSoyuz(), chibiGemini(), chibiOrionPulse()];
const FILE_NAMES = {
  satv: 'saturn-v-apollo.svg',
  sls: 'sls-block-1-artemis.svg',
  f9: 'falcon-9-crew-dragon.svg',
  soyuz: 'soyuz.svg',
  orion: 'project-orion.svg',
  gt: 'titan-2-gemini.svg',
  cap: 'chibi-apollo-csm.svg',
  cor: 'chibi-orion.svg',
  cdr: 'chibi-crew-dragon.svg',
  csz: 'chibi-soyuz.svg',
  cgm: 'chibi-gemini.svg',
  cop: 'chibi-orion-pulse-ship.svg',
};

mkdirSync(OUT_DIR, { recursive: true });
for (const r of [...rockets, ...chibis]) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r.W} ${r.H}" width="${r.W}" height="${r.H}">\n<defs>${r.defs}</defs>\n  ${r.inner}\n</svg>\n`;
  writeFileSync(join(OUT_DIR, FILE_NAMES[r.prefix]), svg);
}

// chibi sheet: in-space spacecraft, baseline-aligned (not to a shared scale)
{
  const GAP = 36, PADL = 50, PADR = 50, PADT = 56, PADB = 64;
  const maxH = Math.max(...chibis.map(r => r.H));
  const sheetGround = PADT + maxH - 8;
  let x = PADL, placed = [], defsAll = [];
  for (const r of chibis) {
    const labelW = r.label.length * 8.4;
    const stride = Math.max(r.W, labelW);
    placed.push({ r, tx: x + stride / 2 - r.W / 2, cxCol: x + stride / 2, ty: sheetGround - (4 + r.heightM * S) });
    defsAll.push(r.defs);
    x += stride + GAP;
  }
  const W = x - GAP + PADR, H = sheetGround + PADB;
  let stars = '';
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 70; i++) {
    stars += `<circle cx="${(rnd() * W).toFixed(1)}" cy="${(rnd() * H).toFixed(1)}" r="${(rnd() * 1.1 + 0.3).toFixed(2)}" fill="#aab4d0" opacity="${(rnd() * 0.5 + 0.15).toFixed(2)}"/>`;
  }
  let body = `<rect width="${W}" height="${H}" fill="#0c0a16"/>${stars}`;
  for (const { r, tx, cxCol, ty } of placed) {
    body += `<g transform="translate(${tx.toFixed(1)},${ty.toFixed(1)})">${r.inner}</g>`;
    body += `<text x="${cxCol.toFixed(1)}" y="${sheetGround + 28}" font-family="Helvetica, Arial, sans-serif" font-size="13" font-weight="600" letter-spacing="1" fill="#aab4d0" text-anchor="middle">${r.label}</text>`;
  }
  body += `<text x="${W - 12}" y="${H - 10}" font-family="Helvetica, Arial, sans-serif" font-size="10" fill="#666f86" text-anchor="end">chibi in-space configs, not to scale</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">\n<defs>${defsAll.join('')}</defs>\n${body}\n</svg>\n`;
  writeFileSync(join(OUT_DIR, '_chibi-sheet.svg'), svg);
}

// contact sheet on the game's dark theme, baseline-aligned, with scale bar
{
  const GAP = 40, PADL = 110, PADR = 40, PADT = 70, PADB = 64;
  const maxH = Math.max(...rockets.map(r => r.heightM));
  const sheetGround = PADT + maxH * S;
  let x = PADL, placed = [], defsAll = [];
  for (const r of rockets) {
    const labelW = r.label.length * 8.4; // keep label columns from colliding
    const stride = Math.max(r.W, labelW);
    const cxCol = x + stride / 2;
    const ty = sheetGround - (4 + r.heightM * S); // local ground = 4 + heightM*S
    placed.push({ r, tx: cxCol - r.W / 2, cxCol, ty });
    defsAll.push(r.defs);
    x += stride + GAP;
  }
  const W = x - GAP + PADR, H = sheetGround + PADB;
  let stars = '';
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 130; i++) {
    stars += `<circle cx="${(rnd() * W).toFixed(1)}" cy="${(rnd() * H).toFixed(1)}" r="${(rnd() * 1.1 + 0.3).toFixed(2)}" fill="#aab4d0" opacity="${(rnd() * 0.5 + 0.15).toFixed(2)}"/>`;
  }
  let body = `<rect width="${W}" height="${H}" fill="#0c0a16"/>${stars}`;
  body += `<line x1="0" y1="${sheetGround + 1}" x2="${W}" y2="${sheetGround + 1}" stroke="#2a2742" stroke-width="2"/>`;
  // 50 m scale bar with 10 m ticks
  const sbX = 48, sbY1 = sheetGround, sbY0 = sheetGround - 50 * S;
  body += `<line x1="${sbX}" y1="${sbY0}" x2="${sbX}" y2="${sbY1}" stroke="#5a567e" stroke-width="2"/>`;
  for (let m = 0; m <= 50; m += 10) {
    const yy = sheetGround - m * S;
    body += `<line x1="${sbX - 6}" y1="${yy}" x2="${sbX + 6}" y2="${yy}" stroke="#5a567e" stroke-width="2"/>`;
    body += `<text x="${sbX - 11}" y="${yy + 4}" font-family="Helvetica, Arial, sans-serif" font-size="12" fill="#8b93a8" text-anchor="end">${m}</text>`;
  }
  body += `<text x="${sbX}" y="${sbY0 - 14}" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="#8b93a8" text-anchor="middle">meters</text>`;
  for (const { r, tx, cxCol, ty } of placed) {
    body += `<g transform="translate(${tx.toFixed(1)},${ty.toFixed(1)})">${r.inner}</g>`;
    body += `<text x="${cxCol.toFixed(1)}" y="${sheetGround + 26}" font-family="Helvetica, Arial, sans-serif" font-size="13" font-weight="600" letter-spacing="1" fill="#aab4d0" text-anchor="middle">${r.label}</text>`;
    body += `<text x="${cxCol.toFixed(1)}" y="${sheetGround + 44}" font-family="Helvetica, Arial, sans-serif" font-size="11" fill="#666f86" text-anchor="middle">${r.heightM} m</text>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">\n<defs>${defsAll.join('')}</defs>\n${body}\n</svg>\n`;
  writeFileSync(join(OUT_DIR, '_contact-sheet.svg'), svg);
}
console.log(`wrote ${rockets.length} rockets + contact sheet to ${OUT_DIR}`);
