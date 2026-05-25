// Detailed Net Thrust track - the full node graph (the published
// board's fuel/thrust ladder). This is the click-to-open modal
// view behind the simplified strip. The model + connections are
// documented in fuel-strip.md.
//
// Wet-mass nodes: integers 1..32 plus fuel-step sub-nodes at
// N + k/d (fractions count up). Per-gap fuel-steps d:
//   1->2 9, 2->3 6, 3->4 4, 4-5 3, 6-10 2, 11-31 1.
// Layout: masses 1-11 on the baseline (1-10 with their fuel-steps
// stacked above); after 11 the track zigzags - even masses upper
// row, odd lower.
// Connections: RED = refuel (load 1 FT, diagonal chains + linear
// integers); BLACK = burn (spend 1 FT) linear through mass <= 23,
// splitting by parity above 23 (both arms converge on 23).

const MIN_DRY = 1, MAX_DRY = 23, MAX_WET = 32;
const DENOM = { 1: 9, 2: 6, 3: 4, 4: 3, 5: 3, 6: 2, 7: 2, 8: 2, 9: 2, 10: 2 };
for (let n = 11; n <= 31; n++) DENOM[n] = 1;

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const frac = (k, d) => { const g = gcd(k, d); return `${k / g}/${d / g}`; };

function bandOf(mass) {
  const N = Math.floor(mass + 1e-9);
  if (N <= 1) return { id: 'WISP +2', color: '#7fb8e0' };
  if (N <= 4) return { id: 'PROBE +1', color: '#6aa9d8' };
  if (N <= 8) return { id: 'SCOUT +0', color: '#5b9fd0' };
  if (N <= 16) return { id: 'TRANSPORT -1', color: '#4f96cc' };
  return { id: 'TUG -2', color: '#3f8ec8' };
}

// Build the ordered node list (ascending mass).
export const NODES = (() => {
  const out = [];
  for (let N = 1; N <= MAX_WET; N++) {
    out.push({ N, mass: N, label: String(N), kind: 'integer' });
    const d = DENOM[N];
    if (N < MAX_WET && d > 1) {
      for (let k = 1; k < d; k++) out.push({ N, mass: N + k / d, label: `${N} ${frac(k, d)}`, kind: 'fuel-step' });
    }
  }
  out.forEach((n, i) => { n.id = 'n' + (i + 1); });
  return out;
})();

const BY_MASS = new Map(NODES.map((n) => [Math.round(n.mass * 1e6), n]));
const at = (mass) => BY_MASS.get(Math.round(mass * 1e6)) || null;

// The mixed-number label for a wet/dry mass value (e.g. "4 1/3").
export function massLabel(mass) {
  const n = at(mass);
  return n ? n.label : String(mass);
}

// ---- Geometry (shared by the renderer) ----
const widthFor = (N) => (N === 1 ? 100 : (N <= 11 ? 50 : 24));
const X = {}; { let cx = 44; for (let N = 1; N <= 32; N++) { X[N] = cx + widthFor(N) / 2; cx += widthFor(N); } }
const TRACK_W = (() => { let cx = 44; for (let N = 1; N <= 32; N++) cx += widthFor(N); return cx + 30; })();
const UNIT_H = 180, LABEL_BAND_H = 42, BASE_Y = LABEL_BAND_H + (8 / 9) * UNIT_H, ZIG = 44, TRACK_H = BASE_Y + 30;
const yInt = (N) => (N >= 12 ? (N % 2 === 0 ? BASE_Y - ZIG : BASE_Y) : BASE_Y);
const xOf = (mass) => X[Math.floor(mass + 1e-9)];
const yOf = (node) => (node.kind === 'integer' ? yInt(node.N) : BASE_Y - (node.mass - node.N) * UNIT_H);
const m = (N, k, d) => N + k / d;

// ---- Edges ----
const RED = (() => {
  const pairs = []; const chain = (...pts) => { for (let i = 0; i < pts.length - 1; i++) pairs.push([pts[i], pts[i + 1]]); };
  for (let N = 1; N < MAX_WET; N++) chain(N, N + 1);
  chain(m(1, 1, 9), m(2, 1, 6), m(3, 1, 4), m(4, 1, 3), m(5, 1, 3), 5);
  chain(m(1, 2, 9), m(2, 1, 6)); chain(m(1, 1, 3), m(2, 1, 3), m(3, 1, 4));
  chain(m(1, 4, 9), m(2, 1, 2), m(3, 1, 2), m(4, 2, 3), m(5, 2, 3), m(6, 1, 2), m(7, 1, 2), m(8, 1, 2), m(9, 1, 2), m(10, 1, 2), 11);
  chain(m(1, 5, 9), m(2, 1, 2)); chain(m(1, 2, 3), m(2, 2, 3), m(3, 3, 4));
  chain(m(1, 7, 9), m(2, 5, 6), m(3, 3, 4)); chain(m(1, 8, 9), m(2, 5, 6)); chain(m(3, 3, 4), m(4, 2, 3));
  return pairs.map(([a, b]) => [at(a), at(b)]).filter(([a, b]) => a && b);
})();
const BLACK = (() => {
  const out = []; const seq = (arr) => { for (let i = 0; i < arr.length - 1; i++) { const a = at(arr[i]), b = at(arr[i + 1]); if (a && b) out.push([a, b]); } };
  const low = NODES.filter((n) => n.mass <= 23);
  for (let i = low.length - 1; i > 0; i--) out.push([low[i], low[i - 1]]);
  seq([32, 30, 28, 26, 24, 23]); seq([31, 29, 27, 25, 23]);
  return out;
})();

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// Render the detailed track into `host` (a scroll container).
// Draws two chits: DRY at dryMass, WET at wetMass (snapped to the
// nearest node). Each node + chit carries a hover title with its
// mass value.
export function renderDetailTrack(host, { dryMass = 1, wetMass = 1 } = {}) {
  host.innerHTML = '';
  const p = [];
  p.push(`<rect x="0" y="0" width="${TRACK_W}" height="${TRACK_H}" rx="8" fill="#0e1525"/>`);
  // bands
  const bands = {}; for (let N = 1; N <= 32; N++) { const b = bandOf(N); (bands[b.id] = bands[b.id] || { color: b.color, ns: [] }).ns.push(N); }
  const bandTop = 20;
  for (const id in bands) {
    const { color, ns } = bands[id];
    const x1 = X[ns[0]] - widthFor(ns[0]) / 2 + 2, x2 = X[ns[ns.length - 1]] + widthFor(ns[ns.length - 1]) / 2 - 2;
    p.push(`<rect x="${x1}" y="${bandTop}" width="${x2 - x1}" height="${BASE_Y + 14 - bandTop}" rx="5" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-opacity="0.5"/>`);
    p.push(`<text x="${x1 + 4}" y="${bandTop + 13}" font-size="11" font-weight="800" fill="${color}">${esc(id)}</text>`);
  }
  // burn (black -> light slate on dark), straight
  for (const [a, b] of BLACK) {
    p.push(`<line x1="${xOf(a.mass).toFixed(1)}" y1="${yOf(a).toFixed(1)}" x2="${xOf(b.mass).toFixed(1)}" y2="${yOf(b).toFixed(1)}" stroke="#c3ccd9" stroke-width="1.4" opacity="0.85"/>`);
  }
  // refuel (red), curved dashed
  for (const [a, b] of RED) {
    const x1 = xOf(a.mass), y1 = yOf(a), x2 = xOf(b.mass), y2 = yOf(b);
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    const cx = mx + (-dy / len) * -9, cy = my + (dx / len) * -9;
    p.push(`<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="#ec5a96" stroke-width="1.4" stroke-dasharray="4 3" marker-end="url(#ntd-ar)" opacity="0.95"/>`);
  }
  // nodes
  for (const n of NODES) {
    const cx = xOf(n.mass), cy = yOf(n);
    if (n.kind !== 'integer') {
      p.push(`<g><title>${esc(n.label)}</title><ellipse cx="${cx}" cy="${cy}" rx="16" ry="8" fill="#f1f5f9" stroke="#334155"/><text x="${cx}" y="${cy + 2.6}" font-size="7.2" font-weight="700" text-anchor="middle" fill="#0c0a16">${esc(n.label)}</text></g>`);
      continue;
    }
    const dry = n.mass <= MAX_DRY; const fill = dry ? '#15131f' : '#f1f5f9', tx = dry ? '#f1f5f9' : '#0c0a16';
    let st = '#9fb0c4', sw = 1.1; if ([MIN_DRY, MAX_DRY, MAX_WET].includes(n.N)) { st = '#ec3f87'; sw = 2.4; }
    p.push(`<g><title>${esc(n.label)}</title><ellipse cx="${cx}" cy="${cy}" rx="11" ry="8" fill="${fill}" stroke="${st}" stroke-width="${sw}"/><text x="${cx}" y="${cy + 3}" font-size="9" font-weight="700" text-anchor="middle" fill="${tx}">${n.N}</text></g>`);
  }
  // chits: DRY + WET, snapped to nearest node
  const chit = (mass, fillCol, label) => {
    const node = at(mass) || at(Math.max(1, Math.min(32, Math.round(mass))));
    if (!node) return;
    const cx = xOf(node.mass), cy = yOf(node);
    p.push(`<g><title>${esc(label)} mass: ${esc(node.label)}</title>`
      + `<circle cx="${cx}" cy="${cy}" r="15" fill="none" stroke="${fillCol}" stroke-width="3"/>`
      + `<rect x="${cx - 10}" y="${cy - 26}" width="20" height="12" rx="3" fill="${fillCol}"/>`
      + `<text x="${cx}" y="${cy - 17}" font-size="8" font-weight="800" text-anchor="middle" fill="#0c0a16">${esc(label)}</text></g>`);
  };
  chit(dryMass, '#94a3b8', 'DRY');
  chit(wetMass, '#f5c518', 'WET');

  const svg = `<svg viewBox="0 0 ${TRACK_W} ${TRACK_H}" width="${TRACK_W}" height="${TRACK_H}" class="ntd-svg" role="img" aria-label="Detailed Net Thrust track">`
    + `<defs><marker id="ntd-ar" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 z" fill="#ec5a96"/></marker></defs>`
    + p.join('') + '</svg>';
  host.innerHTML = svg;
}
