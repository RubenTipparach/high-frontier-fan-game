// Bernal map sprites (M2). The two physical Bernal figures, each tinted from the
// player's seat colour exactly the way the rocket + freighter sprites are:
//
//   - KALPANA  : a segmented spindle habitat (a stack of pressurised rings) with
//                a pair of radiator fins and a docking mast. Your FIRST Bernal,
//                placed in LEO (CLAUDE.md "Kalpana Bernal Stack").
//   - STANFORD : a tilted torus ring station with a hub + spokes. Your SECOND
//                Bernal, placed at your Home Bernal (CLAUDE.md "Stanford Bernal
//                Stack - a torus figure").
//
// Built as a pure SVG string (testable) and cached as an <Image> per (kind,
// colour, anchored) for the canvas renderer. No committed binaries, no build
// step: it tints to any seat colour at runtime, the same contract freighterSvg
// follows. An ANCHORED Bernal adds a teal colony dome on top (rule 2A5).

// ---- colour helpers (shared shape with freighter-sprite.js) ----
const _hx = (c) => { c = String(c).replace('#', ''); return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)]; };
const _rh = (a) => '#' + a.map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('');
const _blend = (a, b, t) => { const A = _hx(a), B = _hx(b); return _rh([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]); };
const _shade = (c, f) => { const [r, g, b] = _hx(c); return _rh([r * f, g * f, b * f]); };
const _lighten = (c, t) => _blend(c, '#ffffff', t);

// Curated Bernal hull tints per seat colour - the SAME values the freighter uses
// so a player's figures all read as one colour on the map (mint green, gray
// darker, mauve clearly purple). Callers may pass a colour NAME or a raw seat HEX.
export const BERNAL_COLOURS = {
  gold: '#fccc00', mauve: '#b079dd', bone: '#e3e0d4',
  mint: '#86efac', magenta: '#b40054', gray: '#6b6f76',
  purple: '#a78bfa', white: '#e3e0d4',
};
const SEAT_HEX_TINT = {
  '#fccc00': 'gold', '#c09cc0': 'mauve', '#e3e0d4': 'bone',
  '#a8d8c0': 'mint', '#b40054': 'magenta', '#9c9c9c': 'gray',
};
function resolveBase(colour) {
  if (colour && BERNAL_COLOURS[colour]) return BERNAL_COLOURS[colour];
  const hx = String(colour || '').trim().toLowerCase();
  const norm = hx[0] === '#' ? hx : '#' + hx;
  if (SEAT_HEX_TINT[norm]) return BERNAL_COLOURS[SEAT_HEX_TINT[norm]];
  if (/^#[0-9a-f]{6}$/i.test(norm)) return norm;
  return BERNAL_COLOURS.white;
}

// Teal colony dome (matches the map colony sprite + the card's colonyDomeGlyph),
// drawn small atop an anchored figure.
function colonyDome(cx, cy, k) {
  let s = `<ellipse cx="${cx}" cy="${cy + 2}" rx="13" ry="3.4" fill="#0c4554"/>`;
  s += `<path d="M ${cx - 12.5} ${cy + 2} A 12.5 12.5 0 0 1 ${cx + 12.5} ${cy + 2} Z" fill="#2aa7c0" stroke="${k}" stroke-width="1.3"/>`;
  s += `<path d="M ${cx - 12.5} ${cy + 2} A 12.5 12.5 0 0 1 ${cx + 12.5} ${cy + 2}" fill="none" stroke="#bdeef6" stroke-width="1.1" opacity="0.7"/>`;
  return s;
}

// ---- KALPANA: segmented spindle habitat ----
function kalpanaBody(pcol, id, opts = {}) {
  const steel = '#586070';
  const hull = _blend(steel, pcol, 0.58);
  const k = '#0b0a14';
  const lite = _lighten(hull, 0.5), mid = hull, dk = _shade(hull, 0.5);
  const fin = _shade(hull, 0.66);
  let s = '';
  s += `<defs><linearGradient id="kg${id}" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0" stop-color="${lite}"/><stop offset="0.5" stop-color="${mid}"/><stop offset="1" stop-color="${dk}"/></linearGradient>`
    + `<radialGradient id="kd${id}" cx="0.4" cy="0.32" r="0.75"><stop offset="0" stop-color="${lite}"/><stop offset="1" stop-color="${dk}"/></radialGradient></defs>`;

  // docking mast at the top
  s += `<line x1="80" y1="14" x2="80" y2="26" stroke="${dk}" stroke-width="2"/>`;
  s += `<circle cx="80" cy="13" r="2.4" fill="${lite}" stroke="${k}" stroke-width="0.8"/>`;

  // radiator fins behind the spindle (drawn first so the body overlaps them)
  s += `<path d="M62 60 L30 50 L30 70 L62 72 Z" fill="${fin}" stroke="${k}" stroke-width="1.1" stroke-linejoin="round"/>`;
  s += `<path d="M98 60 L130 50 L130 70 L98 72 Z" fill="${_shade(fin, 0.86)}" stroke="${k}" stroke-width="1.1" stroke-linejoin="round"/>`;
  for (const fx of [34, 42, 50]) s += `<line x1="${fx}" y1="52" x2="${fx}" y2="70" stroke="${_shade(fin, 0.7)}" stroke-width="0.8"/>`;
  for (const fx of [110, 118, 126]) s += `<line x1="${fx}" y1="52" x2="${fx}" y2="70" stroke="${_shade(fin, 0.7)}" stroke-width="0.8"/>`;

  // stacked pressurised segments (bottom-to-top so each overlaps the one below)
  const segs = [
    { cy: 100, rx: 12, ry: 8 },
    { cy: 86, rx: 21, ry: 14 },
    { cy: 64, rx: 25, ry: 16 },
    { cy: 44, rx: 21, ry: 14 },
    { cy: 28, rx: 13, ry: 10 },
  ];
  for (const sg of segs) {
    s += `<ellipse cx="80" cy="${sg.cy}" rx="${sg.rx}" ry="${sg.ry}" fill="url(#kg${id})" stroke="${k}" stroke-width="1.3"/>`;
    // equatorial seam highlight + a couple of hull bands
    s += `<ellipse cx="80" cy="${sg.cy - sg.ry * 0.35}" rx="${sg.rx * 0.82}" ry="${sg.ry * 0.3}" fill="${lite}" opacity="0.35"/>`;
    s += `<line x1="${80 - sg.rx}" y1="${sg.cy}" x2="${80 + sg.rx}" y2="${sg.cy}" stroke="${dk}" stroke-width="0.8" opacity="0.6"/>`;
  }
  if (opts.anchored) s += colonyDome(80, 18, k);
  return s;
}

// ---- STANFORD: tilted torus ring station ----
function stanfordBody(pcol, id, opts = {}) {
  const steel = '#586070';
  const tube = _blend(steel, pcol, 0.6);
  const k = '#0b0a14';
  const lite = _lighten(tube, 0.5), dk = _shade(tube, 0.5);
  const cx = 80, cy = 64, RX = 46, RY = 21;
  let s = '';
  s += `<defs><linearGradient id="tg${id}" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0" stop-color="${lite}"/><stop offset="0.55" stop-color="${tube}"/><stop offset="1" stop-color="${dk}"/></linearGradient>`
    + `<radialGradient id="th${id}" cx="0.4" cy="0.35" r="0.8"><stop offset="0" stop-color="${lite}"/><stop offset="1" stop-color="${dk}"/></radialGradient></defs>`;

  // spokes from hub to the tube centreline (drawn first; the front tube covers
  // their outer ends, so they read as joining the inner rim)
  const spoke = _shade(tube, 0.7);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    s += `<line x1="${cx}" y1="${cy}" x2="${(cx + Math.cos(a) * RX).toFixed(1)}" y2="${(cy + Math.sin(a) * RY).toFixed(1)}" stroke="${spoke}" stroke-width="2.2"/>`;
  }
  // the torus tube: a thick stroked ellipse, vertically shaded for 3D
  s += `<ellipse cx="${cx}" cy="${cy}" rx="${RX}" ry="${RY}" fill="none" stroke="url(#tg${id})" stroke-width="15"/>`;
  s += `<ellipse cx="${cx}" cy="${cy}" rx="${RX}" ry="${RY}" fill="none" stroke="${k}" stroke-width="15.8" opacity="0.0"/>`;
  // outer + inner rim lines to define the tube edges
  s += `<ellipse cx="${cx}" cy="${cy}" rx="${RX + 7.5}" ry="${RY + 7.5}" fill="none" stroke="${k}" stroke-width="1.1" opacity="0.55"/>`;
  s += `<ellipse cx="${cx}" cy="${cy}" rx="${RX - 7.5}" ry="${RY - 7.5}" fill="none" stroke="${k}" stroke-width="1.1" opacity="0.55"/>`;
  // specular line along the top of the tube
  s += `<ellipse cx="${cx}" cy="${cy - 1.5}" rx="${RX}" ry="${RY}" fill="none" stroke="${lite}" stroke-width="4.5" opacity="0.5"/>`;
  // window lights ringing the tube
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    s += `<circle cx="${(cx + Math.cos(a) * RX).toFixed(1)}" cy="${(cy + Math.sin(a) * RY).toFixed(1)}" r="1.2" fill="${_lighten(pcol, 0.55)}" opacity="0.9"/>`;
  }
  // central hub
  s += `<circle cx="${cx}" cy="${cy}" r="9.5" fill="url(#th${id})" stroke="${k}" stroke-width="1.2"/>`;
  s += `<circle cx="${cx - 2.5}" cy="${cy - 2.5}" r="3" fill="${lite}" opacity="0.6"/>`;
  if (opts.anchored) s += colonyDome(cx, cy - RY - 10, k);
  return s;
}

const VB = { width: 160, height: 124, x: 0, y: 4 };

// Pure: a Bernal figure as a standalone SVG string, tinted to `colour`.
// opts.kind = 'kalpana' | 'stanford' (default kalpana); opts.anchored adds a dome.
export function bernalSvg(colour, opts = {}) {
  const pcol = resolveBase(colour);
  const kind = opts.kind === 'stanford' ? 'stanford' : 'kalpana';
  const id = (String(colour || 'x').replace(/[^a-z0-9]/gi, '') || 'x') + kind[0] + (opts.anchored ? 'a' : '');
  const body = kind === 'stanford' ? stanfordBody(pcol, id, opts) : kalpanaBody(pcol, id, opts);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${VB.width}" height="${VB.height}" viewBox="${VB.x} ${VB.y} ${VB.width} ${VB.height}">`
    + body + '</svg>';
}

export function getBernalSpriteSize() { return { width: VB.width, height: VB.height }; }

// Renderer-facing: a cached <Image> per (kind, colour, anchored). Decodes async;
// callers guard on img.complete && img.naturalWidth and re-render on the ready cb.
const _imgCache = new Map();
let _readyCb = null;
export function onBernalSpriteReady(fn) { _readyCb = typeof fn === 'function' ? fn : null; }
export function getBernalSprite(colour, opts = {}) {
  const kind = opts.kind === 'stanford' ? 'stanford' : 'kalpana';
  const key = kind + '#' + (colour || 'white') + (opts.anchored ? '#a' : '');
  if (_imgCache.has(key)) return _imgCache.get(key);
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => { if (_readyCb) _readyCb(); };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(bernalSvg(colour, opts));
  _imgCache.set(key, img);
  return img;
}
