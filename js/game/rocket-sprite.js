// Pre-rendered rocket sprite. A small CPU 3D model (a surface-of-revolution
// core + four Soyuz-style strap-on boosters) is lit from real surface normals,
// depth-sorted, and drawn as shaded polygons into an offscreen <canvas> ONCE
// per colour, then reused as a single drawImage on the map. The bitmap is
// drawn at 2x DPR and downscaled on draw so it stays crisp. The rocket tints
// from the player's seat hex (no per-colour assets). View: "lean toward
// camera" (matches the option signed off in the design pass). No windows.

const SPRITE_W = 64;
const SPRITE_H = 96;
const DPR = 2;

// Named palettes kept for any caller that still passes a colour name; the 3D
// render only needs the base colour (it derives its own shading).
export const ROCKET_COLOURS = {
  yellow: { base: '#facc15', light: '#fde68a', dark: '#a16207' },
  mint:   { base: '#86efac', light: '#d1fae5', dark: '#15803d' },
  white:  { base: '#f1f5f9', light: '#ffffff', dark: '#64748b' },
  pink:   { base: '#f9a8d4', light: '#fce7f3', dark: '#a21caf' },
  purple: { base: '#a78bfa', light: '#ddd6fe', dark: '#5b21b6' },
};

function _clamp(n) { return Math.max(0, Math.min(255, Math.round(n))); }
function _shade(hex, amt) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
  else { const k = 1 + amt; r *= k; g *= k; b *= k; }
  return '#' + [_clamp(r), _clamp(g), _clamp(b)].map((v) => v.toString(16).padStart(2, '0')).join('');
}
function resolveBase(colour) {
  if (colour && ROCKET_COLOURS[colour]) return ROCKET_COLOURS[colour].base;
  if (/^#?[0-9a-f]{6}$/i.test(String(colour || '').trim())) return colour[0] === '#' ? colour : '#' + colour;
  return ROCKET_COLOURS.white.base;
}
function hexRgb(hex) { const m = /([0-9a-f]{6})/i.exec(hex); const n = m ? parseInt(m[1], 16) : 0xffffff; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

// ---- vec3 + geometry (CPU 3D model: surface-of-revolution core + 4 booster cones) ----
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const rotZ = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]]; };
const rotX = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c]; };

const RH = 150, RMAX = 23;
// Two gold bands wrapping the upper-mid body, shown only when the rocket flies a
// TW/GW (Terawatt/Gigawatt) thruster. z in [0,1] (0 = base, 1 = tip); placed
// above the strap-on boosters so they read clearly. The bands ride the core
// facets so they wrap the 3D form instead of sitting flat.
const GW_STRIPE_BANDS = [[0.52, 0.60], [0.68, 0.76]];
function inGwStripe(z) {
  for (const [a, b] of GW_STRIPE_BANDS) if (z >= a && z <= b) return true;
  return false;
}
function coreRadius(z) {                       // z in [0,1]; NO mid-bulge
  if (z <= 0.5) return RMAX * (1 - 0.08 * (z / 0.5));
  const t = (z - 0.5) / 0.5; return RMAX * 0.92 * Math.pow(1 - t, 0.82);
}
function coreFaces(nz = 26, nt = 36, gold = false) {
  const f = [];
  for (let i = 0; i < nz; i++) {
    const z0 = i / nz, z1 = (i + 1) / nz, r0 = coreRadius(z0), r1 = coreRadius(z1);
    const isGold = gold && inGwStripe((z0 + z1) / 2);
    for (let j = 0; j < nt; j++) {
      const a0 = 2 * Math.PI * j / nt, a1 = 2 * Math.PI * (j + 1) / nt;
      f.push({ gold: isGold, v: [[r0 * Math.cos(a0), r0 * Math.sin(a0), z0 * RH], [r0 * Math.cos(a1), r0 * Math.sin(a1), z0 * RH],
              [r1 * Math.cos(a1), r1 * Math.sin(a1), z1 * RH], [r1 * Math.cos(a0), r1 * Math.sin(a0), z1 * RH]] });
    }
  }
  return f;
}
function coneFaces(apex, baseC, baseR, nseg = 18) {
  const d = norm(sub(baseC, apex)); const up = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = norm(cross(d, up)), v = cross(d, u); const ring = [];
  for (let i = 0; i < nseg; i++) { const a = 2 * Math.PI * i / nseg; ring.push(add(baseC, add(scl(u, baseR * Math.cos(a)), scl(v, baseR * Math.sin(a))))); }
  const f = [];
  for (let i = 0; i < nseg; i++) f.push([apex, ring[i], ring[(i + 1) % nseg]]);
  const cap = []; for (let i = nseg - 1; i >= 0; i--) cap.push(ring[i]); f.push(cap);
  return f;
}
function rocketFaces(gw = false) {
  const f = coreFaces(26, 36, gw);             // { gold, v } per face
  const apex0 = [RMAX * 0.82, 0, 0.46 * RH], baseC0 = [RMAX * 1.48, 0, 0], baseR = RMAX * 0.62;
  for (const phi of [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75]) {
    // Boosters stay the seat colour (the stripes are a core-body band).
    for (const face of coneFaces(rotZ(apex0, phi), rotZ(baseC0, phi), baseR)) f.push({ gold: false, v: face });
  }
  return f;
}

const L = norm([-0.5, -0.5, 0.62]);            // light: upper-left, toward viewer
const AZ = 0.5, EL = 0.42;                      // "lean toward camera"
const view = (p) => rotX(rotZ(p, AZ), EL);

const _cache = new Map();   // colour token -> HTMLCanvasElement

// GW stripe colour (a warm metallic gold), shaded by the same lighting as the
// hull so the band reads as part of the model, not a decal.
const GW_GOLD = [228, 178, 38];
function paintRocket(ctx, w, h, base, gw = false) {
  const rgb = hexRgb(base);
  const faces = rocketFaces(gw).map((f) => ({ gold: f.gold, v: f.v.map(view) }));
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const f of faces) for (const p of f.v) {
    const x = p[0], y = -p[2];
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const s = Math.min((w * 0.92) / (maxX - minX), (h * 0.94) / (maxY - minY));
  const ox = w / 2 - ((minX + maxX) / 2) * s;
  const oy = h * 0.97 - maxY * s;               // base near the bottom of the box
  const drawn = [];
  const goldGlow = [];   // front-facing gold facet polylines, for the bloom pass
  for (const f of faces) {
    const vp = f.v;
    const fc = f.gold ? GW_GOLD : rgb;
    let N = norm(cross(sub(vp[1], vp[0]), sub(vp[2], vp[0])));
    const frontFacing = N[1] < 0;               // normal points toward camera (-y)
    if (N[1] > 0) N = scl(N, -1);               // orient toward camera (-y)
    const diff = Math.max(0, dot(N, L));
    const rd = sub(scl(N, 2 * dot(N, L)), L); const spec = Math.pow(Math.max(0, dot(rd, [0, -1, 0])), 18);
    // Gold (GW) facets are emissive: a high light floor keeps the band vivid
    // even on the shadow side, so it never sinks into a yellow / purple hull.
    const I = (f.gold ? 0.86 : 0.42) + (f.gold ? 0.40 : 0.72) * diff, sp = 0.5 * spec * 255;
    const col = `rgb(${_clamp(fc[0] * I + sp)},${_clamp(fc[1] * I + sp)},${_clamp(fc[2] * I + sp)})`;
    const depth = vp.reduce((a, p) => a + p[1], 0) / vp.length;
    const pts = vp.map((p) => [ox + p[0] * s, oy + (-p[2]) * s]);
    drawn.push({ depth, pts, col });
    if (f.gold && frontFacing) goldGlow.push(pts);
  }
  drawn.sort((a, b) => b.depth - a.depth);       // painter's: far first
  for (const d of drawn) {
    ctx.beginPath();
    ctx.moveTo(d.pts[0][0], d.pts[0][1]);
    for (let i = 1; i < d.pts.length; i++) ctx.lineTo(d.pts[i][0], d.pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = d.col; ctx.fill();
    ctx.strokeStyle = d.col; ctx.lineWidth = 0.6; ctx.stroke();   // seal facet seams
  }
  // Bloom pass: re-draw the visible gold band with additive light + a soft halo
  // so the GW stripes read as GLOWING, not painted - obvious on any hull colour
  // (the flat band sank into yellow / purple ships). Two passes: a wide soft
  // halo, then a tighter brighter core.
  if (goldGlow.length) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const paintGlow = (fill, blur, shadow) => {
      ctx.shadowColor = shadow;
      ctx.shadowBlur = blur;
      ctx.fillStyle = fill;
      for (const pts of goldGlow) {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.closePath();
        ctx.fill();
      }
    };
    paintGlow('rgba(255, 186, 44, 0.45)', 6, 'rgba(255, 198, 70, 0.95)');   // soft outer halo
    paintGlow('rgba(255, 224, 130, 0.55)', 2, 'rgba(255, 214, 96, 0.9)');   // bright core
    ctx.restore();
  }
}

// opts.gw paints the two gold TW/GW-thruster stripes. The gw variant caches
// under a separate key so a striped and an unstriped ship of the same colour
// can both be on the board at once.
export function getRocketSprite(colourName, opts) {
  const gw = !!(opts && opts.gw);
  const key = gw ? `${colourName}|gw` : colourName;
  if (_cache.has(key)) return _cache.get(key);
  const cv = document.createElement('canvas');
  cv.width = SPRITE_W * DPR;
  cv.height = SPRITE_H * DPR;
  const ctx = cv.getContext('2d');
  ctx.scale(DPR, DPR);
  paintRocket(ctx, SPRITE_W, SPRITE_H, resolveBase(colourName), gw);
  _cache.set(key, cv);
  return cv;
}

export function getRocketSpriteSize() {
  return { width: SPRITE_W, height: SPRITE_H };
}
