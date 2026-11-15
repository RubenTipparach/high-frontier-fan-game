// Textured, rotating planet spheres (render-to-texture, phone-friendly).
//
// A body's surface is generated ONCE as a small equirectangular texture from a
// seeded 3D noise field (sampled on the unit sphere, so it wraps with no seam).
// Drawing a frame is then a table lookup: for a given pixel radius we cache,
// per disc pixel, its latitude row, its longitude and its surface normal; a
// frame shifts the longitude by the spin angle, samples the texture, lights it
// from the body's star and writes the result into an ImageData. No gradients,
// no per-frame allocation, so a phone can keep a few dozen visible bodies
// turning at a handful of frames a second.
//
// Pure apart from the canvas the caller hands in: no DOM lookups, no imports.

// ---------- seeded noise
const hash = (x, y, z, s) => {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + s * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const fade = (t) => t * t * (3 - 2 * t);
function vnoise(x, y, z, s) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash(xi + dx, yi + dy, zi + dz, s);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), xf), l(c(0, 1, 0), c(1, 1, 0), xf), yf),
    l(l(c(0, 0, 1), c(1, 0, 1), xf), l(c(0, 1, 1), c(1, 1, 1), xf), yf), zf);
}
function fbm(x, y, z, s, oct = 5) {
  let v = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { v += a * vnoise(x * f, y * f, z * f, s + i * 17); n += a; a *= 0.5; f *= 2.03; }
  return v / n;
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const hex = (h) => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
// a ramp through several colours, t in 0..1
const ramp = (cols, t) => { const x = clamp01(t) * (cols.length - 1); const i = Math.min(cols.length - 2, Math.floor(x)); return mix(cols[i], cols[i + 1], x - i); };

// ---------- surface styles. Each returns [r, g, b] for a point p on the unit
// sphere (lat in radians); `cloud` styles also return a cloud cover 0..1.
export const PLANET_STYLES = {
  // banded gas giant (Jupiter / Saturn family) with a storm oval
  gas: (pal, s) => { const cols = [hex(pal.dark), hex(pal.base), hex(pal.light), hex(pal.base), hex(pal.light)];
    const storm = { lat: -0.38 + (hash(s, 1, 2, 3) - 0.5) * 0.2, lon: hash(s, 4, 5, 6) * Math.PI * 2 };
    return (p, lat, lon) => {
      const turb = fbm(p[0] * 2.5, p[1] * 9, p[2] * 2.5, s, 5);
      const polar = smooth(0.85, 1.3, Math.abs(lat)); // bands give way to a mottled cap, no bullseye
      const band = (0.5 + 0.5 * Math.sin(lat * 13 + turb * 3.2 + Math.sin(lat * 5) * 1.5)) * (1 - polar) + fbm(p[0] * 4, p[1] * 4, p[2] * 4, s + 21, 4) * polar;
      let c = ramp(cols, band * 0.85 + fbm(p[0] * 6, p[1] * 18, p[2] * 6, s + 9, 3) * 0.3);
      const dl = Math.atan2(Math.sin(lon - storm.lon), Math.cos(lon - storm.lon));
      const e = (dl / 0.32) ** 2 + ((lat - storm.lat) / 0.11) ** 2;
      if (e < 1) c = mix(c, [196, 96, 64], (1 - e) * 0.85);
      const pole = smooth(0.95, 1.4, Math.abs(lat)); return mix(c, hex(pal.dark), pole * 0.55);
    }; },
  // ice giant (Uranus / Neptune): soft, faint banding, a dark spot
  'ice-giant': (pal, s) => (p, lat) => {
    const t = 0.5 + 0.5 * Math.sin(lat * 7 + fbm(p[0] * 2, p[1] * 6, p[2] * 2, s, 4) * 2);
    let c = mix(hex(pal.base), hex(pal.light), t * 0.35 + 0.15);
    c = mix(c, hex(pal.dark), smooth(0.9, 1.5, Math.abs(lat)) * 0.4);
    return c;
  },
  // cratered airless rock (Mercury / the Moon / most moons and asteroids)
  rock: (pal, s) => { const craters = Array.from({ length: 34 }, (_, i) => { const u = hash(s, i, 1, 7) * 2 - 1, th = hash(s, i, 2, 7) * Math.PI * 2, r = Math.sqrt(1 - u * u);
      return { c: [r * Math.cos(th), u, r * Math.sin(th)], R: 0.05 + hash(s, i, 3, 7) ** 2 * 0.22 }; });
    return (p) => {
      let v = fbm(p[0] * 3, p[1] * 3, p[2] * 3, s, 5); let rim = 0;
      for (const k of craters) { const d = Math.acos(Math.max(-1, Math.min(1, p[0] * k.c[0] + p[1] * k.c[1] + p[2] * k.c[2]))) / k.R; if (d < 1.25) { if (d < 1) v -= (1 - d * d) * 0.22; rim += Math.max(0, 1 - Math.abs(d - 1) * 6) * 0.25; } }
      const maria = smooth(0.52, 0.62, fbm(p[0] * 1.4, p[1] * 1.4, p[2] * 1.4, s + 5, 3));
      return ramp([hex(pal.dark), hex(pal.base), hex(pal.light)], clamp01(v * 1.3 - 0.15 + rim - maria * 0.18));
    }; },
  // dusty red world with dark albedo features and polar caps (Mars family)
  mars: (pal, s) => (p, lat) => {
    const v = fbm(p[0] * 2.4, p[1] * 2.4, p[2] * 2.4, s, 6);
    let c = ramp([hex(pal.dark), hex(pal.base), hex(pal.light)], v * 1.4 - 0.2);
    c = mix(c, [70, 40, 30], smooth(0.5, 0.62, fbm(p[0] * 1.6, p[1] * 1.6, p[2] * 1.6, s + 3, 4)) * 0.5);
    return mix(c, [245, 240, 235], smooth(1.12, 1.22, Math.abs(lat) + v * 0.2));
  },
  // ocean world with continents, ice caps and a cloud layer (Earth family)
  earth: (pal, s) => (p, lat) => {
    const h = fbm(p[0] * 1.8, p[1] * 1.8, p[2] * 1.8, s, 6);
    const land = h > 0.53;
    let c;
    if (land) { const dry = smooth(0.15, 0.55, 1 - Math.abs(Math.abs(lat) - 0.4) * 2.2 + fbm(p[0] * 5, p[1] * 5, p[2] * 5, s + 4, 3) * 0.6 - 0.3);
      c = mix([62, 118, 52], [176, 152, 96], dry); c = mix(c, [110, 96, 70], smooth(0.62, 0.75, h)); }
    else c = mix(hex(pal.dark), hex(pal.base), smooth(0.3, 0.53, h));
    c = mix(c, [240, 246, 250], smooth(1.15, 1.25, Math.abs(lat) + (h - 0.5) * 0.3));
    const cl = smooth(0.52, 0.72, fbm(p[0] * 3, p[1] * 7, p[2] * 3, s + 11, 5));
    return { c, cloud: cl * 0.85 };
  },
  // thick yellow cloud deck (Venus family)
  venus: (pal, s) => (p, lat) => {
    const sw = fbm(p[0] * 2 + Math.sin(lat * 4), p[1] * 5, p[2] * 2, s, 5);
    return ramp([hex(pal.dark), hex(pal.base), hex(pal.light)], 0.35 + sw * 0.7 + Math.cos(lat * 3) * 0.08);
  },
  // icy crust with rust-coloured cracks (Europa family)
  ice: (pal, s) => (p) => {
    const base = mix(hex(pal.base), hex(pal.light), fbm(p[0] * 3, p[1] * 3, p[2] * 3, s, 4));
    // long lineae: the zero lines of two low-frequency fields
    const n1 = Math.abs(vnoise(p[0] * 2.2, p[1] * 2.2, p[2] * 2.2, s + 2) - 0.5), n2 = Math.abs(vnoise(p[0] * 3.5 + 7, p[1] * 3.5, p[2] * 3.5, s + 8) - 0.5);
    const crack = Math.max(1 - smooth(0.004, 0.03, n1), (1 - smooth(0.003, 0.022, n2)) * 0.75);
    return mix(mix(base, [150, 110, 80], smooth(0.55, 0.7, fbm(p[0] * 1.5, p[1] * 1.5, p[2] * 1.5, s + 5, 3)) * 0.4), [140, 80, 50], crack * 0.8);
  },
  // sulphur-yellow volcanic moon (Io family)
  volcanic: (pal, s) => { const vents = Array.from({ length: 18 }, (_, i) => { const u = hash(s, i, 9, 1) * 2 - 1, th = hash(s, i, 8, 1) * Math.PI * 2, r = Math.sqrt(1 - u * u); return { c: [r * Math.cos(th), u, r * Math.sin(th)], R: 0.06 + hash(s, i, 7, 1) * 0.1 }; });
    return (p) => {
      let c = ramp([[190, 150, 40], hex(pal.base), hex(pal.light)], fbm(p[0] * 2.5, p[1] * 2.5, p[2] * 2.5, s, 5) * 1.2);
      for (const v of vents) { const d = Math.acos(Math.max(-1, Math.min(1, p[0] * v.c[0] + p[1] * v.c[1] + p[2] * v.c[2]))) / v.R; if (d < 2.2) c = mix(c, d < 0.5 ? [40, 25, 20] : [200, 80, 30], (1 - d / 2.2) * 0.8); }
      return c;
    }; },
  // a brown dwarf: dark, banded, glowing from inside
  brown: (pal, s) => (p, lat) => {
    const turb = fbm(p[0] * 2.5, p[1] * 8, p[2] * 2.5, s, 5);
    return ramp([[40, 10, 20], [120, 30, 50], [200, 80, 60], [120, 40, 70]], 0.5 + 0.5 * Math.sin(lat * 11 + turb * 4));
  },
};

// The look for a body: which style, by its kind and its HF palette name.
export function styleFor({ kind, art, cls }) {
  if (kind === 'brown') return 'brown';
  if (kind === 'gas' || art === 'jupiter' || art === 'saturn') return 'gas';
  if (kind === 'ice-giant' || art === 'neptune') return 'ice-giant';
  if (art === 'earth' || cls === 'Habitable' || cls === 'Garden') return 'earth';
  if (art === 'mars' || cls === 'Marginal') return 'mars';
  if (art === 'venus') return 'venus';
  if (art === 'europa') return 'ice';
  if (art === 'io') return 'volcanic';
  return 'rock';
}

// ---------- textures: generated once per body (W x H equirectangular)
export function makePlanetTexture(style, palette, seed = 1, W = 192, H = 96) {
  const f = (PLANET_STYLES[style] || PLANET_STYLES.rock)(palette, seed | 0);
  const rgb = new Uint8ClampedArray(W * H * 3); let cloud = null;
  for (let j = 0; j < H; j++) {
    const lat = (0.5 - (j + 0.5) / H) * Math.PI; const cl = Math.cos(lat), sl = Math.sin(lat);
    for (let i = 0; i < W; i++) {
      const lon = ((i + 0.5) / W) * Math.PI * 2;
      const out = f([cl * Math.cos(lon), sl, cl * Math.sin(lon)], lat, lon);
      const c = Array.isArray(out) ? out : out.c;
      const o = (j * W + i) * 3; rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2];
      if (!Array.isArray(out)) { cloud = cloud || new Uint8ClampedArray(W * H); cloud[j * W + i] = out.cloud * 255; }
    }
  }
  return { W, H, rgb, cloud, style, glow: style === 'brown' ? 0.6 : 0 };
}

// ---------- the sphere: a per-radius lookup table, then a cheap frame
const LUTS = new Map();
function lutFor(R, tilt, lean = 0.35) {
  const key = `${R}|${tilt.toFixed(2)}|${lean.toFixed(2)}`; let L = LUTS.get(key); if (L) return L;
  const size = R * 2 + 2; const n = [];
  const ct = Math.cos(tilt), st = Math.sin(tilt); const cl = Math.cos(lean), sl = Math.sin(lean); // the axis leans in the screen and a little toward you
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + 0.5 - (R + 1)) / R, dy = (y + 0.5 - (R + 1)) / R; const d2 = dx * dx + dy * dy;
    const edge = R * (1 - Math.sqrt(d2)) + 0.5; if (edge <= 0) continue;
    const nz = Math.sqrt(Math.max(0, 1 - d2)), nx = dx, ny = -dy; // view space: x right, y up, z toward you
    let bx = nx * ct + ny * st, by = -nx * st + ny * ct, bz = nz; // tilt the spin axis in the screen
    const by2 = by * cl - bz * sl, bz2 = by * sl + bz * cl; by = by2; bz = bz2; // and toward the viewer
    n.push(y * size + x, nx, ny, nz, Math.asin(Math.max(-1, Math.min(1, by))), Math.atan2(bx, bz), Math.min(1, edge));
  }
  L = { size, R, data: Float32Array.from(n) }; LUTS.set(key, L); return L;
}

// A body that turns. `light` is the direction toward its star in screen space
// ({x, y}, any length; y down like the canvas); spin is radians.
export class PlanetSphere {
  // `ring`: a ring definition the planet must line up with (its equator in the
  // ring plane): the axis tilts with the rings and leans toward you as far as
  // the rings are opened
  // Planets turn west to east (prograde: seen with north up, the face moves
  // left to right); `retrograde` turns it the other way (Venus, Uranus).
  constructor(texture, { tilt = 0.25, ambient = 0.07, atmosphere = null, cloudDrift = 1.3, ring = null, retrograde = false } = {}) {
    this.dir = retrograde ? -1 : 1;
    if (ring) { tilt = -ring.tilt; this.lean = -Math.asin(Math.min(0.99, ring.flatten)); } else this.lean = 0.35;
    this.tex = texture; this.tilt = tilt; this.ambient = ambient; this.cloudDrift = cloudDrift;
    this.atmo = atmosphere ? atmosphere.match(/[\d.]+/g).map(Number) : null; // 'rgba(r, g, b, a)'
    this.canvas = null; this.img = null; this.R = 0;
  }
  // Render the sphere into its own small canvas (render-to-texture) and return it.
  // makeCanvas(w, h) lets a caller supply an OffscreenCanvas or a DOM canvas.
  render(R, spin, light, makeCanvas) {
    R = Math.max(2, Math.round(R)); const L = lutFor(R, this.tilt, this.lean); const size = L.size;
    if (!this.canvas || this.R !== R) { this.canvas = makeCanvas(size, size); this.ctx = this.canvas.getContext('2d'); this.img = this.ctx.createImageData(size, size); this.R = R; }
    const { W, H, rgb, cloud } = this.tex; const px = this.img.data; px.fill(0);
    let lx = light.x, ly = -light.y; const lz = 0.55; const ll = Math.hypot(lx, ly, lz) || 1; lx /= ll; ly /= ll; const lzn = lz / ll;
    const amb = this.ambient; const d = L.data; const TAU = Math.PI * 2;
    spin *= this.dir; const atmo = this.atmo; const cs = spin * this.cloudDrift;
    for (let k = 0; k < d.length; k += 7) {
      const idx = d[k], nx = d[k + 1], ny = d[k + 2], nz = d[k + 3], lat = d[k + 4], lon = d[k + 5], cov = d[k + 6];
      // bilinear: wraps in longitude, clamps at the poles
      const fy = Math.min(H - 1.001, Math.max(0, (0.5 - lat / Math.PI) * H - 0.5)); const v = fy | 0, ty = fy - v;
      const fx = ((((lon - spin) / TAU) % 1 + 1) % 1) * W - 0.5; const x0 = Math.floor(fx), tx = fx - x0; const ua = (x0 + W) % W, ub = (x0 + 1 + W) % W;
      const o00 = (v * W + ua) * 3, o01 = (v * W + ub) * 3, o10 = ((v + 1) * W + ua) * 3, o11 = ((v + 1) * W + ub) * 3;
      const w00 = (1 - tx) * (1 - ty), w01 = tx * (1 - ty), w10 = (1 - tx) * ty, w11 = tx * ty;
      let r = rgb[o00] * w00 + rgb[o01] * w01 + rgb[o10] * w10 + rgb[o11] * w11;
      let g = rgb[o00 + 1] * w00 + rgb[o01 + 1] * w01 + rgb[o10 + 1] * w10 + rgb[o11 + 1] * w11;
      let b = rgb[o00 + 2] * w00 + rgb[o01 + 2] * w01 + rgb[o10 + 2] * w10 + rgb[o11 + 2] * w11;
      if (cloud) { const cx = ((((lon - cs) / TAU) % 1 + 1) % 1) * W - 0.5; const c0 = Math.floor(cx), ct = cx - c0; const ca = (c0 + W) % W, cb = (c0 + 1 + W) % W;
        const c = ((cloud[v * W + ca] * (1 - ct) + cloud[v * W + cb] * ct) * (1 - ty) + (cloud[(v + 1) * W + ca] * (1 - ct) + cloud[(v + 1) * W + cb] * ct) * ty) / 255; r += (250 - r) * c; g += (252 - g) * c; b += (255 - b) * c; }
      const ndl = nx * lx + ny * ly + nz * lzn;
      const lit = Math.max(this.tex.glow, amb + (1 - amb) * smooth(-0.08, 0.35, ndl) * (0.55 + 0.45 * Math.max(0, ndl)));
      r *= lit; g *= lit; b *= lit;
      if (atmo) { const rim = (1 - nz) ** 2.5 * Math.max(0, ndl + 0.25) * atmo[3] * 1.6; r += (atmo[0] - r) * rim; g += (atmo[1] - g) * rim; b += (atmo[2] - b) * rim; }
      const p = idx * 4; px[p] = r; px[p + 1] = g; px[p + 2] = b; px[p + 3] = cov * 255;
    }
    this.ctx.putImageData(this.img, 0, 0);
    return this.canvas;
  }
}

// ---------- rings: a painted ring plane with ringlets, gaps and the planet's
// shadow, split into the half behind the planet and the half in front.
// `def` is the renderer's ring definition: { tilt (radians, in the screen),
// flatten (minor / major axis), bands: [{ r, w, color }] } in planet radii.
const parseRgba = (c) => { const m = String(c).match(/[\d.]+/g) || [200, 180, 140, 0.6]; return [+m[0], +m[1], +m[2], m[3] == null ? 1 : +m[3]]; };
function ringProfile(def, seed = 7) {
  const r1 = Math.max(...def.bands.map((b) => b.r + b.w / 2)) + 0.02;
  const N = 700; const r0 = 1; const rgb = new Float32Array(N * 3); const a = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const r = r0 + ((r1 - r0) * (i + 0.5)) / N;
    for (const b of def.bands) {
      const d = Math.abs(r - b.r) - b.w / 2; if (d > 0.01) continue;
      const [cr, cg, cb, ca] = parseRgba(b.color);
      const edge = d > 0 ? 1 - d / 0.01 : 1; // soft band edges
      // ringlets: fine density waves across the band
      const ring = 0.62 + 0.4 * vnoise(r * 90, 0.5, 0.5, seed) + 0.12 * Math.sin(r * 420) + 0.08 * vnoise(r * 300, 2.5, 0.5, seed + 9);
      const al = ca * edge * ring;
      if (al > a[i]) { a[i] = al; rgb[i * 3] = cr * (0.9 + 0.2 * vnoise(r * 40, 1.5, 0.5, seed + 3)); rgb[i * 3 + 1] = cg; rgb[i * 3 + 2] = cb; }
    }
  }
  return { r0, r1, N, rgb, a };
}
export class PlanetRings {
  constructor(def) { this.def = def; this.p = ringProfile(def); this.key = ''; this.out = null; }
  // R: the planet's radius in device px. light: screen direction toward the star.
  render(R, light, makeCanvas) {
    const Rq = Math.max(8, Math.min(128, Math.ceil(R / 16) * 16)); // repaint on zoom steps, not every frame
    const key = `${Rq}|${Math.round(Math.atan2(light.y, light.x) * 24)}`;
    if (this.key === key && this.out) return this.out;
    const { tilt, flatten } = this.def; const ci = Math.sqrt(Math.max(0, 1 - flatten * flatten));
    const { r0, r1, N, rgb, a } = this.p;
    const half = Math.ceil(r1 * Rq) + 2; const size = half * 2;
    const mk = () => { const c = makeCanvas(size, size); return { c, ctx: c.getContext('2d') }; };
    const B = this.out && this.out.size === size ? this.out.B : mk(), F = this.out && this.out.size === size ? this.out.F : mk();
    const ib = B.ctx.createImageData(size, size), iF = F.ctx.createImageData(size, size);
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    // the light in the ring's own (rotated) frame: x along the ring, y down, z toward you
    let lx = light.x, ly = light.y; const ll = Math.hypot(lx, ly) || 1; lx /= ll; ly /= ll;
    let Lx = lx * ct + ly * st, Ly = -lx * st + ly * ct, Lz = 0.55; const ln = Math.hypot(Lx, Ly, Lz); Lx /= ln; Ly /= ln; Lz /= ln;
    const nL = -ci * Ly + flatten * Lz; // the ring plane's normal against the light
    const face = nL > 0 ? 0.85 + 0.25 * Math.min(1, nL * 3) : 0.7; // the unlit face is a little dimmer (light through the ring)
    // 4 samples a pixel: the ring is squashed, so its edges are finer than a pixel
    const SUB = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let sb = [0, 0, 0, 0], sf = [0, 0, 0, 0];
      for (const [ox, oy] of SUB) {
        const X = x + ox - half, Y = y + oy - half;
        const xr = X * ct + Y * st, yr = -X * st + Y * ct;
        const u = xr / Rq, v = yr / (Rq * flatten); const r = Math.hypot(u, v);
        if (r < r0 || r >= r1) continue;
        const i = Math.min(N - 1, ((r - r0) / (r1 - r0)) * N | 0); const al = Math.min(1, a[i] * 1.1); if (al <= 0.01) continue;
        // the planet's shadow: the ray from this ring point toward the star meets the planet
        const Px = u, Py = v * flatten, Pz = v * ci; const d = Px * Lx + Py * Ly + Pz * Lz;
        const lit = d < 0 && Px * Px + Py * Py + Pz * Pz - d * d < 1 ? 0.25 : face;
        const acc = yr < 0 ? sb : sf; // premultiplied, so the halves blend cleanly at the edges
        acc[0] += rgb[i * 3] * lit * al; acc[1] += rgb[i * 3 + 1] * lit * al; acc[2] += rgb[i * 3 + 2] * lit * al; acc[3] += al;
      }
      const o = (y * size + x) * 4;
      for (const [acc, img] of [[sb, ib], [sf, iF]]) if (acc[3] > 0) { img.data[o] = acc[0] / acc[3]; img.data[o + 1] = acc[1] / acc[3]; img.data[o + 2] = acc[2] / acc[3]; img.data[o + 3] = (acc[3] / 4) * 255; }
    }
    B.ctx.putImageData(ib, 0, 0); F.ctx.putImageData(iF, 0, 0);
    this.key = key; this.out = { B, F, back: B.c, front: F.c, half, size, R: Rq };
    return this.out;
  }
}

// ---------- the GPU path: one shared WebGL2 canvas draws each sphere with a
// fragment shader (texture lookup, spin, the star's light, the atmosphere
// rim), and the map copies the result in. The texture goes to the GPU once;
// a frame is one draw call, so planets turn smoothly at the map's own frame
// rate. When WebGL2 is missing, callers fall back to PlanetSphere.render.
const VS = `#version 300 es
in vec2 aPos; out vec2 vUv; void main() { vUv = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }`;
const FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uTex; uniform sampler2D uCloud;
uniform float uHasCloud, uSpin, uCloudSpin, uAmb, uGlow, uPx, uScale;
uniform mat3 uRot; uniform vec3 uL; uniform vec4 uAtmo;
const float PI = 3.14159265;
void main() {
  vec2 p = vUv * uScale; float r2 = dot(p, p);
  float cov = clamp((1.0 - sqrt(r2)) / uPx + 0.5, 0.0, 1.0);
  if (cov <= 0.0) discard;
  vec3 n = vec3(p, sqrt(max(0.0, 1.0 - r2)));
  vec3 b = uRot * n;
  float v = 0.5 - asin(clamp(b.y, -1.0, 1.0)) / PI; float lon = atan(b.x, b.z);
  vec3 c = texture(uTex, vec2(fract((lon - uSpin) / (2.0 * PI)), v)).rgb;
  if (uHasCloud > 0.5) c = mix(c, vec3(0.98, 0.99, 1.0), texture(uCloud, vec2(fract((lon - uCloudSpin) / (2.0 * PI)), v)).r);
  float ndl = dot(n, uL);
  float lit = max(uGlow, uAmb + (1.0 - uAmb) * smoothstep(-0.08, 0.35, ndl) * (0.55 + 0.45 * max(0.0, ndl)));
  c *= lit;
  if (uAtmo.a > 0.0) c = mix(c, uAtmo.rgb, clamp(pow(1.0 - n.z, 2.5) * max(0.0, ndl + 0.25) * uAtmo.a * 1.6, 0.0, 1.0));
  o = vec4(c * cov, cov);
}`;
export class GLSpheres {
  constructor(makeCanvas) {
    this.ok = false;
    try {
      const cv = makeCanvas(256, 256); const gl = cv.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false });
      if (!gl) return;
      const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
      gl.useProgram(pr);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(pr, 'aPos'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      this.u = {}; for (const k of ['uTex', 'uCloud', 'uHasCloud', 'uSpin', 'uCloudSpin', 'uAmb', 'uGlow', 'uPx', 'uScale', 'uRot', 'uL', 'uAtmo']) this.u[k] = gl.getUniformLocation(pr, k);
      gl.uniform1i(this.u.uTex, 0); gl.uniform1i(this.u.uCloud, 1);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      this.gl = gl; this.cv = cv; this.ok = true;
      cv.addEventListener && cv.addEventListener('webglcontextlost', () => { this.ok = false; });
    } catch (e) { this.ok = false; }
  }
  // upload a texture once (the sphere keeps its GL handles)
  _upload(sphere) {
    const gl = this.gl; const t = sphere.tex;
    const mk = (data, fmt, ifmt) => { const tx = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tx); gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, t.W, t.H, 0, fmt, gl.UNSIGNED_BYTE, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return tx; };
    sphere._gl = { tex: mk(new Uint8Array(t.rgb.buffer, t.rgb.byteOffset, t.rgb.length), gl.RGB, gl.RGB8), cloud: t.cloud ? mk(new Uint8Array(t.cloud.buffer, t.cloud.byteOffset, t.cloud.length), gl.RED, gl.R8) : null, owner: this };
  }
  // Draw `sphere` at radius R device px; returns the source rectangle to copy
  // from this.cv ({ x, y, size }) or null on failure.
  draw(sphere, R, spin, light) {
    if (!this.ok) return null;
    const gl = this.gl; R = Math.max(2, Math.min(127, Math.round(R))); const S = R * 2 + 2;
    if (this.cv.width < S || this.cv.height < S) { this.cv.width = Math.max(this.cv.width, S); this.cv.height = Math.max(this.cv.height, S); }
    if (!sphere._gl || sphere._gl.owner !== this) this._upload(sphere);
    const H = this.cv.height; gl.viewport(0, 0, S, S);
    gl.enable(gl.SCISSOR_TEST); gl.scissor(0, 0, S, S); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.disable(gl.SCISSOR_TEST);
    const u = this.u; const t = sphere.tilt, ct = Math.cos(t), st = Math.sin(t), cl = Math.cos(sphere.lean), sl = Math.sin(sphere.lean);
    // view normal -> body frame: tilt in the screen, then lean toward the viewer (as lutFor)
    const T = [[ct, st, 0], [-st, ct, 0], [0, 0, 1]], Lm = [[1, 0, 0], [0, cl, -sl], [0, sl, cl]];
    const M = [0, 1, 2].map((i) => [0, 1, 2].map((j) => Lm[i][0] * T[0][j] + Lm[i][1] * T[1][j] + Lm[i][2] * T[2][j]));
    gl.uniformMatrix3fv(u.uRot, false, [M[0][0], M[1][0], M[2][0], M[0][1], M[1][1], M[2][1], M[0][2], M[1][2], M[2][2]]); // column-major
    let lx = light.x, ly = -light.y; const lz = 0.55; const ll = Math.hypot(lx, ly, lz) || 1;
    gl.uniform3f(u.uL, lx / ll, ly / ll, lz / ll);
    const s = spin * sphere.dir; gl.uniform1f(u.uSpin, s); gl.uniform1f(u.uCloudSpin, s * sphere.cloudDrift);
    gl.uniform1f(u.uAmb, sphere.ambient); gl.uniform1f(u.uGlow, sphere.tex.glow || 0); gl.uniform1f(u.uPx, 1 / R); gl.uniform1f(u.uScale, (R + 1) / R);
    const a = sphere.atmo; gl.uniform4f(u.uAtmo, a ? a[0] / 255 : 0, a ? a[1] / 255 : 0, a ? a[2] / 255 : 0, a ? a[3] : 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sphere._gl.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, sphere._gl.cloud || sphere._gl.tex); gl.uniform1f(u.uHasCloud, sphere._gl.cloud ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return { x: 0, y: H - S, size: S, R };
  }
}
