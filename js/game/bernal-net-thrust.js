// Bernal Net Thrust strip (M2). The published Bernal board track, rendered from
// the SAME fuel-graph node system the rocket strip uses (data/fuel-graph.js:
// NODES / BLACK / RED), cropped to the Bernal's mass range 10..32. The bands are
// the SHARED weight classes (net-thrust-track.js), not a Bernal-only relabeling
// - see bandOf. The "1/2" node is the 10.5 half-step (fuel-graph DENOM[10]=2).
//
// Presentation-only (pure SVG into a host element); the mass values come from
// the Bernal stack's dry/wet mass, the same way renderDetailTrack is driven for
// the rocket. Net-thrust value itself is shown elsewhere in the modal, so the
// 1-9 scale row is intentionally omitted here.
import { NODES, BLACK, RED, at, blackStepsBetween, MAX_DRY, MAX_WET } from '../../data/fuel-graph.js';
import { weightClassForMass } from '../../data/net-thrust-track.js';

const LO = 10;                                   // Bernal floor (dry mass)
const inRange = (mass) => Math.floor(mass + 1e-9) >= LO;
const W = 27;                                    // node pitch (squished ~20% vs the rocket strip)
const X = {}; { let cx = 26; for (let N = LO; N <= 32; N++) { X[N] = cx + W / 2; cx += W; } }
const TRACK_W = X[32] + W / 2 + 22;
const TOPPAD = 30, ZIG = 86, BASE_Y = TOPPAD + 6 + ZIG + 18, TRACK_H = BASE_Y + 34;
const yInt = (N) => (N >= 12 && N % 2 === 0 ? BASE_Y - ZIG : BASE_Y);
const xOf = (mass) => X[Math.floor(mass + 1e-9)];
const yOf = (n) => (n.kind === 'integer' ? yInt(n.N) : BASE_Y - ZIG);   // "1/2" sits on the top row, level with 12
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Bands from the SHARED track. The board prints the ladder twice - a Rocket
// copy and a Bernal copy - and net-thrust-track.js's transcription is explicit
// that "they share this structure; we model one track", so a Bernal's bands
// break where every other stack's do: TRANSPORT to 16, TUG from 17.
//
// This used to split at MAX DRY MASS (23) instead, which drew the WET chit at
// 17 plainly inside TRANSPORT while the thrust triangle above it - reading the
// real track - folded in TUG's -2. One colony, two different weight classes,
// a whole point of thrust apart (reported 2026-08-07). The label carries the
// band's own modifier now, so it cannot drift from the number again.
const bandOf = (N) => {
  const wc = weightClassForMass(N);
  return {
    id: `${wc.id} ${wc.netThrust > 0 ? '+' : ''}${wc.netThrust} net thrust`,
    color: wc.netThrust <= -2 ? '#c9ccd6' : '#8590ad',
  };
};

// Highest predecessor for the WET->DRY burn path (mirror of BLACK_SUCC).
const BSUCC = new Map();
for (const [a, b] of BLACK) if (a.mass > b.mass) { if (!BSUCC.has(a.id) || b.mass > BSUCC.get(a.id).mass) BSUCC.set(a.id, b); }

export function getBernalStripSize() { return { width: TRACK_W, height: TRACK_H }; }

export function renderBernalNetThrust(host, { dryMass = 10, wetMass = 10 } = {}) {
  const p = [];
  p.push(`<rect x="0" y="0" width="${TRACK_W}" height="${TRACK_H}" rx="8" fill="#0e1525"/>`);

  // bands (TRANSPORT / TUG)
  const bands = {};
  for (let N = LO; N <= 32; N++) { const b = bandOf(N); (bands[b.id] = bands[b.id] || { color: b.color, ns: [] }).ns.push(N); }
  for (const id in bands) {
    const { color, ns } = bands[id];
    const x1 = X[ns[0]] - W / 2 + 2, x2 = X[ns[ns.length - 1]] + W / 2 - 2;
    p.push(`<rect x="${x1}" y="${TOPPAD - 8}" width="${x2 - x1}" height="${BASE_Y + 16 - (TOPPAD - 8)}" rx="6" fill="${color}" fill-opacity="0.14" stroke="${color}" stroke-opacity="0.55"/>`);
    p.push(`<text x="${x1 + 6}" y="${TOPPAD + 6}" font-size="10.5" font-weight="800" fill="#dfe6f2">${esc(id)}</text>`);
  }

  // burn path WET->DRY (blue), the fuel steps actually spent
  const pathSeg = new Map();
  { const dryN = at(dryMass), wetN = at(wetMass); let remaining = blackStepsBetween(dryMass, wetMass), cur = wetN, g = 0;
    while (cur && dryN && cur.id !== dryN.id && remaining > 0 && g++ < NODES.length + 5) { const nx = BSUCC.get(cur.id); if (!nx) break; pathSeg.set(cur.id + '>' + nx.id, remaining); remaining--; cur = nx; } }
  for (const [a, b] of BLACK) {
    if (!inRange(a.mass) || !inRange(b.mass)) continue;
    const x1 = xOf(a.mass), y1 = yOf(a), x2 = xOf(b.mass), y2 = yOf(b); const rem = pathSeg.get(a.id + '>' + b.id);
    if (rem != null) p.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#38bdf8" stroke-width="3.6" stroke-linecap="round"/>`);
    else p.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#c3ccd9" stroke-width="1.6" opacity="0.85"/>`);
  }
  // refuel (red dashed, curved)
  for (const [a, b] of RED) {
    if (!inRange(a.mass) || !inRange(b.mass)) continue;
    const x1 = xOf(a.mass), y1 = yOf(a), x2 = xOf(b.mass), y2 = yOf(b), mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    const cx = mx + (-dy / len) * -12, cy = my + (dx / len) * -12;
    p.push(`<path d="M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}" fill="none" stroke="#ec5a96" stroke-width="1.7" stroke-dasharray="4 3" marker-end="url(#bn-ar)" opacity="0.95"/>`);
  }
  // nodes (integer 10-32 + the 10.5 "1/2")
  for (const n of NODES) {
    if (!inRange(n.mass) || n.mass > MAX_WET + 1e-9) continue;
    const cx = xOf(n.mass), cy = yOf(n);
    if (n.kind !== 'integer') {
      p.push(`<g><title>${esc(n.label)}</title><ellipse cx="${cx}" cy="${cy}" rx="12.5" ry="11" fill="#f1f5f9" stroke="#334155"/><text x="${cx}" y="${cy + 3.8}" font-size="10" font-weight="800" text-anchor="middle" fill="#0c0a16">1/2</text></g>`);
      continue;
    }
    const top = yInt(n.N) === BASE_Y - ZIG;
    const fill = top ? '#f1f5f9' : '#15131f', tx = top ? '#0c0a16' : '#f1f5f9';
    let st = '#9fb0c4', sw = 1.3; if ([MAX_DRY, MAX_WET].includes(n.N)) { st = '#ec3f87'; sw = 2.8; }
    p.push(`<g><title>${esc(n.label)}</title><ellipse cx="${cx}" cy="${cy}" rx="12.5" ry="11" fill="${fill}" stroke="${st}" stroke-width="${sw}"/><text x="${cx}" y="${cy + 4}" font-size="11.5" font-weight="800" text-anchor="middle" fill="${tx}">${n.N}</text></g>`);
  }
  // MAX DRY / MAX WET pink tags (box sized to cover the text, clamped inside the track)
  const tag = (N, label, below) => {
    const cy = yInt(N); const w = 22 + label.length * 6.2, ty = below ? cy + 16 : cy - 30;
    const cx = Math.max(w / 2 + 3, Math.min(TRACK_W - w / 2 - 3, X[N]));
    p.push(`<g><rect x="${cx - w / 2}" y="${ty}" width="${w}" height="16" rx="4" fill="#e3197d"/><text x="${cx}" y="${ty + 11.5}" font-size="9" font-weight="800" text-anchor="middle" fill="#fff">${label}</text></g>`);
  };
  tag(MAX_DRY, 'MAX DRY MASS', true);
  tag(MAX_WET, 'MAX WET MASS', false);
  // chits DRY + WET
  const chit = (mass, col, label) => {
    const node = at(mass) || at(Math.max(LO, Math.min(MAX_WET, Math.round(mass)))); if (!node) return;
    const cx = xOf(node.mass), cy = yOf(node);
    p.push(`<g><title>${esc(label)} mass: ${esc(node.label)}</title><circle cx="${cx}" cy="${cy}" r="17" fill="none" stroke="${col}" stroke-width="3.6"/>`
      + `<rect x="${cx - 13}" y="${cy - 31}" width="26" height="14" rx="3" fill="${col}"/><text x="${cx}" y="${cy - 20.5}" font-size="9" font-weight="800" text-anchor="middle" fill="#0c0a16">${label}</text></g>`);
  };
  chit(dryMass, '#94a3b8', 'DRY');
  chit(wetMass, '#7dd3fc', 'WET');

  // No width/height ATTRIBUTES: they make the SVG keep a fixed intrinsic height
  // on mobile (so CSS height:auto can't scale it and it renders off-screen /
  // collapsed). viewBox + preserveAspectRatio + CSS width:100% is the reliable
  // responsive pattern. (user 2026-06-27: strip was invisible on phones.)
  host.innerHTML = `<svg viewBox="0 0 ${TRACK_W} ${TRACK_H}" preserveAspectRatio="xMidYMid meet" class="bernal-strip-svg" role="img" aria-label="Bernal Net Thrust track">`
    + `<defs><marker id="bn-ar" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 z" fill="#ec5a96"/></marker></defs>`
    + p.join('') + '</svg>';
}
