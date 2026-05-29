// Pre-rendered rocket sprite. The peaked-silhouette path is
// drawn once into an offscreen <canvas> per colour and the
// resulting bitmap is reused as a single drawImage on the map.
// Far cheaper than rebuilding the path each frame; the bitmap
// is also resolution-independent (drawn at 2x DPR + downscaled
// on draw, so it stays crisp).
//
// Five paint colours so each sandbox player can be visually
// distinct. Yellow / mint / white / pink / purple were chosen
// to match the card-type palette idiom (warm thruster peach,
// reactor purple, refinery slate, robonaut pink, etc.).

const SPRITE_W = 64;
const SPRITE_H = 96;
const DPR = 2;

export const ROCKET_COLOURS = {
  yellow: { base: '#facc15', light: '#fde68a', dark: '#a16207' },
  mint:   { base: '#86efac', light: '#d1fae5', dark: '#15803d' },
  white:  { base: '#f1f5f9', light: '#ffffff', dark: '#64748b' },
  pink:   { base: '#f9a8d4', light: '#fce7f3', dark: '#a21caf' },
  purple: { base: '#a78bfa', light: '#ddd6fe', dark: '#5b21b6' },
};

// Lighten / darken a #rrggbb toward white / black by `amt` (0..1).
// Used to synthesise a {base, light, dark} palette from an arbitrary
// seat colour (the six crew-card hexes don't map to the named
// palettes above, so a multiplayer rocket paints straight from its
// player's assigned hex).
function _clamp(n) { return Math.max(0, Math.min(255, Math.round(n))); }
function _shade(hex, amt) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
  else { const k = 1 + amt; r *= k; g *= k; b *= k; }
  return '#' + [_clamp(r), _clamp(g), _clamp(b)]
    .map((v) => v.toString(16).padStart(2, '0')).join('');
}

// Resolve a colour token to a {base, light, dark} palette. Accepts a
// named palette key OR a raw #rrggbb (synthesised). Falls back to
// white when neither matches.
function resolvePalette(colour) {
  if (colour && ROCKET_COLOURS[colour]) return ROCKET_COLOURS[colour];
  if (/^#?[0-9a-f]{6}$/i.test(String(colour || '').trim())) {
    const base = colour[0] === '#' ? colour : '#' + colour;
    return { base, light: _shade(base, 0.45), dark: _shade(base, -0.45) };
  }
  return ROCKET_COLOURS.white;
}

const _cache = new Map();   // colourName -> HTMLCanvasElement

function paintRocket(ctx, w, h, palette) {
  // All coordinates relative to a [0..w, 0..h] box. Body is a
  // tapered silhouette (narrow at the top, slightly wider at
  // the base) with side fins flaring out near the bottom.
  const cx = w / 2;
  const noseY = h * 0.04;
  const shoulderY = h * 0.22;
  const finTopY = h * 0.72;
  const baseY = h * 0.92;
  const bodyTopHalf = w * 0.18;     // half-width at the shoulder
  const bodyBaseHalf = w * 0.22;
  const finHalf = w * 0.42;

  // Body (base fill)
  ctx.fillStyle = palette.base;
  ctx.strokeStyle = palette.dark;
  ctx.lineWidth = w * 0.04;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, noseY);
  ctx.lineTo(cx + bodyTopHalf, shoulderY);
  ctx.lineTo(cx + bodyBaseHalf, finTopY);
  ctx.lineTo(cx + finHalf, baseY);
  ctx.lineTo(cx - finHalf, baseY);
  ctx.lineTo(cx - bodyBaseHalf, finTopY);
  ctx.lineTo(cx - bodyTopHalf, shoulderY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Highlight strip on the left side of the body - sells the
  // "lit from one direction" 3D feel without raster lighting.
  ctx.fillStyle = palette.light;
  ctx.beginPath();
  ctx.moveTo(cx - bodyTopHalf * 0.55, shoulderY + (noseY - shoulderY) * 0.45);
  ctx.lineTo(cx - bodyTopHalf * 0.15, shoulderY * 0.45 + noseY * 0.55);
  ctx.lineTo(cx - bodyBaseHalf * 0.20, finTopY);
  ctx.lineTo(cx - bodyBaseHalf * 0.60, finTopY);
  ctx.closePath();
  ctx.fill();

  // Window porthole near the shoulder.
  ctx.fillStyle = palette.dark;
  ctx.beginPath();
  ctx.arc(cx, shoulderY + (finTopY - shoulderY) * 0.18, w * 0.07, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = palette.light;
  ctx.beginPath();
  ctx.arc(cx - w * 0.018, shoulderY + (finTopY - shoulderY) * 0.18 - w * 0.018,
          w * 0.034, 0, Math.PI * 2);
  ctx.fill();

  // Engine bell (darker base patch at the bottom centre)
  ctx.fillStyle = palette.dark;
  const bellW = w * 0.18;
  ctx.fillRect(cx - bellW / 2, baseY - h * 0.04, bellW, h * 0.04);
}

export function getRocketSprite(colourName) {
  if (_cache.has(colourName)) return _cache.get(colourName);
  const palette = resolvePalette(colourName);
  const cv = document.createElement('canvas');
  cv.width  = SPRITE_W * DPR;
  cv.height = SPRITE_H * DPR;
  const ctx = cv.getContext('2d');
  ctx.scale(DPR, DPR);
  paintRocket(ctx, SPRITE_W, SPRITE_H, palette);
  _cache.set(colourName, cv);
  return cv;
}

export function getRocketSpriteSize() {
  return { width: SPRITE_W, height: SPRITE_H };
}
