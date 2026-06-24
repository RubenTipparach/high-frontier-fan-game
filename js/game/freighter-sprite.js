// Freighter map sprite (M1). A chunky space cargo hauler tinted from the
// player's seat colour the same way the rocket sprite is: an aft three-bell
// engine cluster with exhaust glow, a hull spine carrying player-tinted cargo
// containers (the hold), radiator panels, and a flat-fronted bridge with a lit
// cockpit. Built as an SVG string (pure, testable) and cached as an <Image>
// per (colour, promoted) for the canvas renderer. No committed binaries, no
// build step: it tints to any seat colour at runtime.
//
// Design signed off 2026-06-24 (level, no nose/tilt). The promoted (Purple-
// Side) variant adds a bridge accent ring + a promotion star.

// ---- colour helpers ----
const _hx = (c) => { c = String(c).replace('#', ''); return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)]; };
const _rh = (a) => '#' + a.map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('');
const _blend = (a, b, t) => { const A = _hx(a), B = _hx(b); return _rh([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]); };
const _shade = (c, f) => { const [r, g, b] = _hx(c); return _rh([r * f, g * f, b * f]); };
const _lighten = (c, t) => _blend(c, '#ffffff', t);

// Named seat palettes (so a caller may pass a colour name); a hex passes
// through. Mirrors ROCKET_COLOURS' base hues.
export const FREIGHTER_COLOURS = {
  gold: '#fccc00', mauve: '#c09cc0', bone: '#e3e0d4',
  mint: '#a8d8c0', magenta: '#b40054', gray: '#9c9c9c',
  purple: '#a78bfa', white: '#e3e0d4',
};
function resolveBase(colour) {
  if (colour && FREIGHTER_COLOURS[colour]) return FREIGHTER_COLOURS[colour];
  if (/^#?[0-9a-f]{6}$/i.test(String(colour || '').trim())) return colour[0] === '#' ? colour : '#' + colour;
  return FREIGHTER_COLOURS.white;
}

// Oblique "cabinet" box: front face is a true rectangle (x,y,w,h); depth runs
// up-right by `dep`. Returns the three visible faces (right, top, front).
const DX = 0.56, DY = -0.42;
function box(x, y, w, h, dep, faceCol, k, opts = {}) {
  const ex = dep * DX, ey = dep * DY;
  const front = faceCol, top = _lighten(faceCol, 0.20), side = _shade(faceCol, 0.66);
  const sw = opts.sw != null ? opts.sw : 1.1;
  const st = (f) => `fill="${f}" stroke="${k}" stroke-width="${sw}" stroke-linejoin="round"`;
  let s = '';
  s += `<path d="M${x + w} ${y} L${x + w + ex} ${y + ey} L${x + w + ex} ${y + h + ey} L${x + w} ${y + h} Z" ${st(side)}/>`;
  s += `<path d="M${x} ${y} L${x + w} ${y} L${x + w + ex} ${y + ey} L${x + ex} ${y + ey} Z" ${st(top)}/>`;
  s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${opts.rx || 0}" ${st(front)}/>`;
  return s;
}

// The freighter body, drawn into the shared coordinate frame (see VIEWBOX).
function freighterBody(pcol, defsId, opts = {}) {
  const promoted = !!opts.promoted;
  const steel = '#586070';
  const hull = _blend(steel, pcol, 0.34);
  const dark = '#1a1d25';
  const k = '#0b0a14';
  const band = pcol;
  const glow = _lighten(pcol, 0.5);
  const win = _lighten(pcol, 0.35);
  let s = '';

  // exhaust plume glow (behind everything): one plume streaming out of EACH of
  // the three aft engines, fanned slightly (top up-left, bottom down-left).
  s += `<defs><radialGradient id="exg${defsId}" cx="0.5" cy="0.5" r="0.5">`
    + `<stop offset="0" stop-color="${_lighten(glow, 0.4)}" stop-opacity="0.95"/>`
    + `<stop offset="0.4" stop-color="${glow}" stop-opacity="0.6"/>`
    + `<stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient></defs>`;
  for (const [ny, ang] of [[64, -10], [78, 0], [92, 10]]) {
    s += `<ellipse cx="2" cy="${ny}" rx="24" ry="8" fill="url(#exg${defsId})" transform="rotate(${ang} 2 ${ny})"/>`;
  }

  // aft engine cluster: three nozzle bells
  for (const [ny, r] of [[64, 7.5], [78, 8.5], [92, 7.5]]) {
    s += `<path d="M30 ${ny - r} L12 ${ny - r * 0.7} L8 ${ny} L12 ${ny + r * 0.7} L30 ${ny + r} Z" fill="${_shade(hull, 0.5)}" stroke="${k}" stroke-width="1"/>`;
    s += `<ellipse cx="10" cy="${ny}" rx="3.2" ry="${r * 0.7}" fill="${dark}" stroke="${k}" stroke-width="0.8"/>`;
    s += `<ellipse cx="10.5" cy="${ny}" rx="1.6" ry="${r * 0.42}" fill="${glow}" opacity="0.9"/>`;
  }
  // engine block
  s += box(26, 58, 22, 40, 16, _shade(hull, 0.82), k, { rx: 3 });
  s += `<rect x="29" y="62" width="16" height="32" rx="2" fill="${_shade(hull, 0.6)}" stroke="${k}" stroke-width="0.8"/>`;

  // main spine / hull
  s += box(44, 60, 78, 34, 18, hull, k, { rx: 4 });
  for (const lx of [58, 74, 92, 108]) s += `<line x1="${lx}" y1="61" x2="${lx}" y2="93" stroke="${_shade(hull, 0.62)}" stroke-width="0.9"/>`;
  s += `<rect x="48" y="78" width="70" height="3" fill="${_shade(hull, 0.55)}"/>`;

  // cargo containers riding the top deck (the hold)
  const conts = [{ x: 52, col: band }, { x: 74, col: _shade(band, 0.78) }, { x: 96, col: _lighten(band, 0.18) }];
  for (const c of conts) {
    s += box(c.x, 40, 18, 22, 16, c.col, k, { rx: 1.5, sw: 1 });
    for (let i = 1; i < 5; i++) s += `<line x1="${c.x + i * 3.6}" y1="41" x2="${c.x + i * 3.6}" y2="61" stroke="${_shade(c.col, 0.7)}" stroke-width="0.8"/>`;
    s += `<rect x="${c.x}" y="40" width="18" height="2" fill="${_shade(c.col, 0.62)}"/>`;
    s += `<line x1="${c.x + 4}" y1="42" x2="${c.x + 4}" y2="61" stroke="${_shade(c.col, 0.55)}" stroke-width="0.9"/>`;
    s += `<line x1="${c.x + 14}" y1="42" x2="${c.x + 14}" y2="61" stroke="${_shade(c.col, 0.55)}" stroke-width="0.9"/>`;
  }

  // forward bridge / command module + cockpit (flat-fronted)
  s += box(122, 54, 24, 32, 16, _blend(hull, '#cfd6e0', 0.25), k, { rx: 5 });
  s += `<rect x="124" y="78" width="20" height="3" fill="${_shade(hull, 0.55)}"/>`;
  s += `<rect x="126" y="60" width="15" height="10" rx="2.5" fill="${win}" stroke="${k}" stroke-width="1"/>`;
  s += `<rect x="127.5" y="61.5" width="5" height="7" rx="1" fill="${_lighten(win, 0.5)}" opacity="0.8"/>`;

  if (promoted) {
    s += `<rect x="122" y="54" width="24" height="32" rx="5" fill="none" stroke="${glow}" stroke-width="1.4" opacity="0.8"/>`;
    const star = (cx, cy, rr) => { let p = ''; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5; const r = i % 2 ? rr * 0.42 : rr; p += (i ? 'L' : 'M') + (cx + Math.cos(a) * r).toFixed(1) + ' ' + (cy + Math.sin(a) * r).toFixed(1); } return `<path d="${p} Z" fill="${glow}" stroke="${k}" stroke-width="0.5"/>`; };
    s += star(105, 51, 6);
  }
  return s;
}

// Bounding frame: includes the exhaust glow (left/bottom), the container tops,
// and the engine/hull extents.
const VB_X = -24, VB_Y = 30, VB_W = 182, VB_H = 76;

// Pure: the freighter as a standalone SVG string, tinted to `colour`.
export function freighterSvg(colour, opts = {}) {
  const pcol = resolveBase(colour);
  const id = (String(colour || 'x').replace(/[^a-z0-9]/gi, '') || 'x') + (opts.promoted ? 'p' : '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${VB_W}" height="${VB_H}" viewBox="${VB_X} ${VB_Y} ${VB_W} ${VB_H}">`
    + freighterBody(pcol, id, opts) + '</svg>';
}

// Natural sprite size (the viewBox), so the renderer can scale like the rocket.
export function getFreighterSpriteSize() { return { width: VB_W, height: VB_H }; }

// Renderer-facing: a cached <Image> per (colour, promoted). The image decodes
// async; callers must guard on `img.complete && img.naturalWidth` before
// drawing and re-render on the ready callback (set via onFreighterSpriteReady).
const _imgCache = new Map();
let _readyCb = null;
export function onFreighterSpriteReady(fn) { _readyCb = typeof fn === 'function' ? fn : null; }
export function getFreighterSprite(colour, opts = {}) {
  const key = (colour || 'white') + (opts.promoted ? '#p' : '');
  if (_imgCache.has(key)) return _imgCache.get(key);
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => { if (_readyCb) _readyCb(); };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(freighterSvg(colour, opts));
  _imgCache.set(key, img);
  return img;
}
