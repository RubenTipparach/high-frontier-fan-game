// Detailed Fuel Strip Track - the SVG rendering of the published fuel/thrust
// ladder (the click-to-open modal behind the simplified strip). The pure node
// + connection model (shared with the server) lives in data/fuel-graph.js;
// this module imports it and adds the geometry + drawing. fuel-strip.md is a
// doc mirror of the model - update it there if the model changes.

import {
  NODES, nearestNode, BLACK, RED, BLACK_SUCC, blackStepsBetween, massLabel,
  MIN_DRY, MAX_DRY, MAX_WET,
} from '../../data/fuel-graph.js';
import { weightClassForMass } from '../../data/net-thrust-track.js';

// Re-export the pure helpers so existing importers (browse.js) keep working.
export { massLabel, blackStepsBetween };

// Band membership comes from the shared weightClassForMass (the single source
// of truth, with the published board's mid-ladder boundaries: WISP 1..1 8/9,
// PROBE 2..4 1/3, SCOUT 4 2/3..8, TRANSPORT 8 1/2..16, TUG 17..32). The colour
// here is presentation-only (this track's darker palette, not the band data's).
const BAND_COLORS = {
  WISP: '#7fb8e0', PROBE: '#6aa9d8', SCOUT: '#5b9fd0', TRANSPORT: '#4f96cc', TUG: '#3f8ec8',
};
function bandOf(mass) {
  const wc = weightClassForMass(mass);
  return { id: `${wc.id} ${wc.netThrust >= 0 ? '+' : ''}${wc.netThrust}`, color: BAND_COLORS[wc.id] };
}

// ---- Geometry (rendering only) ----
// Columns 5 and 9 are wider: each hosts an INCOMING boundary node from the gap
// below it (4 2/3 opens SCOUT, 8 1/2 opens TRANSPORT - see xOf), drawn at the
// cell's left edge, so the column needs room for two ladders side by side.
const widthFor = (N) => (N === 1 ? 100 : (N === 5 || N === 9 ? 104 : (N <= 11 ? 50 : 24)));
const X = {}; { let cx = 44; for (let N = 1; N <= 32; N++) { X[N] = cx + widthFor(N) / 2; cx += widthFor(N); } }
const TRACK_W = (() => { let cx = 44; for (let N = 1; N <= 32; N++) cx += widthFor(N); return cx + 30; })();
const UNIT_H = 180, LABEL_BAND_H = 42, BASE_Y = LABEL_BAND_H + (8 / 9) * UNIT_H, ZIG = 44, TRACK_H = BASE_Y + 42;
const yInt = (N) => (N >= 12 ? (N % 2 === 0 ? BASE_Y - ZIG : BASE_Y) : BASE_Y);
// A fuel-step node normally stacks above its floor cell - but a node whose
// weight class is the NEXT band (4 2/3 is SCOUT, 8 1/2 is TRANSPORT) is
// maneuvered INTO that band's rectangle: it draws at the left edge of the next
// cell, so the plain band rectangles below always contain their own nodes.
const xOf = (mass) => {
  const N = Math.floor(mass + 1e-9);
  const frac = mass - N;
  if (frac > 1e-6 && weightClassForMass(mass).id !== weightClassForMass(N).id) {
    return X[N + 1] - widthFor(N + 1) / 2 + 18;
  }
  return X[N];
};
const yOf = (node) => (node.kind === 'integer' ? yInt(node.N) : BASE_Y - (node.mass - node.N) * UNIT_H);

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// Render the detailed track into `host` (a scroll container).
// Draws two chits: DRY at dryMass, WET at wetMass (snapped to the
// nearest node). Each node + chit carries a hover title with its
// mass value.
export function renderDetailTrack(host, { dryMass = 1, wetMass = 1 } = {}) {
  host.innerHTML = '';
  const p = [];
  p.push(`<rect x="0" y="0" width="${TRACK_W}" height="${TRACK_H}" rx="8" fill="#0e1525"/>`);
  // Weight-class bands: plain full-height rectangles, one per class. The
  // column spans follow the published boundaries because the two nodes that
  // cross a band line mid-ladder (4 2/3 -> SCOUT, 8 1/2 -> TRANSPORT) are
  // drawn inside their band's first column (see xOf), so every rectangle
  // contains exactly its own nodes: WISP holds 1 + the ninths, PROBE ends at
  // 4 1/3, SCOUT opens with 4 2/3 and ends at 8, TRANSPORT opens with 8 1/2.
  const bandTop = 20;
  const spanX = (lo, hi) => [X[lo] - widthFor(lo) / 2 + 2, X[hi] + widthFor(hi) / 2 - 2];
  const BANDS = [
    ['WISP +2', BAND_COLORS.WISP, 1, 1],
    ['PROBE +1', BAND_COLORS.PROBE, 2, 4],
    ['SCOUT +0', BAND_COLORS.SCOUT, 5, 8],
    ['TRANSPORT -1', BAND_COLORS.TRANSPORT, 9, 16],
    ['TUG -2', BAND_COLORS.TUG, 17, 32],
  ];
  for (const [id, color, lo, hi] of BANDS) {
    const [x1, x2] = spanX(lo, hi);
    p.push(`<rect x="${x1}" y="${bandTop}" width="${x2 - x1}" height="${BASE_Y + 14 - bandTop}" rx="5" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-opacity="0.5"/>`);
    p.push(`<text x="${x1 + 4}" y="${bandTop + 13}" font-size="11" font-weight="800" fill="${color}">${esc(id)}</text>`);
  }
  // Burn path WET -> DRY: the fuel-step segments the rocket will actually
  // spend, highlighted blue and numbered by how many fuel steps remain from
  // that segment down to dry (top segment = total, bottom segment = 1).
  const pathSeg = new Map();   // "aId>bId" -> steps remaining at that segment
  const pathLabels = [];
  {
    const dryN = nearestNode(dryMass), wetN = nearestNode(wetMass);
    let remaining = blackStepsBetween(dryMass, wetMass);
    let cur = wetN, guard = 0;
    while (cur && dryN && cur.id !== dryN.id && remaining > 0 && guard++ < NODES.length + 5) {
      const next = BLACK_SUCC.get(cur.id);
      if (!next) break;
      pathSeg.set(cur.id + '>' + next.id, remaining);
      remaining--;
      cur = next;
    }
  }
  // burn (black -> light slate on dark); WET->DRY path drawn blue on top
  for (const [a, b] of BLACK) {
    const x1 = xOf(a.mass), y1 = yOf(a), x2 = xOf(b.mass), y2 = yOf(b);
    const remain = pathSeg.get(a.id + '>' + b.id);
    if (remain != null) {
      p.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#38bdf8" stroke-width="3.2" opacity="0.95" stroke-linecap="round"/>`);
      pathLabels.push({ mx: (x1 + x2) / 2, my: (y1 + y2) / 2, n: remain });
    } else {
      p.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#c3ccd9" stroke-width="1.4" opacity="0.85"/>`);
    }
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
  // Fuel-steps-remaining number centred on each highlighted burn segment.
  for (const { mx, my, n } of pathLabels) {
    p.push(`<g><title>${n} fuel step${n === 1 ? '' : 's'} left to dry from here</title>`
      + `<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="6.6" fill="#0b1220" stroke="#38bdf8" stroke-width="1"/>`
      + `<text x="${mx.toFixed(1)}" y="${(my + 2.4).toFixed(1)}" font-size="7" font-weight="800" text-anchor="middle" fill="#bae6fd">${n}</text></g>`);
  }
  // chits: DRY + WET, snapped to nearest node
  const chit = (mass, fillCol, label) => {
    const node = nearestNode(mass);
    if (!node) return;
    const cx = xOf(node.mass), cy = yOf(node);
    p.push(`<g><title>${esc(label)} mass: ${esc(node.label)}</title>`
      + `<circle cx="${cx}" cy="${cy}" r="15" fill="none" stroke="${fillCol}" stroke-width="3"/>`
      + `<rect x="${cx - 10}" y="${cy - 26}" width="20" height="12" rx="3" fill="${fillCol}"/>`
      + `<text x="${cx}" y="${cy - 17}" font-size="8" font-weight="800" text-anchor="middle" fill="#0c0a16">${esc(label)}</text></g>`);
  };
  chit(dryMass, '#94a3b8', 'DRY');
  chit(wetMass, '#7dd3fc', 'WET');   // light blue: lighter than the #38bdf8 burn path so the marker reads apart from the lines

  // Fuel-step readout under the WET chit: how many black burn connections
  // separate wet from dry (the rocket's burnable fuel steps). Counted off the
  // graph above, so it always matches the black line the player can trace.
  {
    const wetNode = nearestNode(wetMass);
    if (wetNode) {
      const wx = xOf(wetNode.mass), wy = yOf(wetNode);
      const ft = blackStepsBetween(dryMass, wetMass);
      const label = `${ft} fuel step${ft === 1 ? '' : 's'}`;
      const bw = 12 + label.length * 5.2;
      p.push(`<g><title>${esc(label)} from dry to wet (count of black burn connections)</title>`
        + `<rect x="${(wx - bw / 2).toFixed(1)}" y="${(wy + 19).toFixed(1)}" width="${bw.toFixed(1)}" height="15" rx="4" fill="#f5c518" stroke="#0c0a16" stroke-opacity="0.3"/>`
        + `<text x="${wx.toFixed(1)}" y="${(wy + 29.6).toFixed(1)}" font-size="8.5" font-weight="800" text-anchor="middle" fill="#0c0a16">${esc(label)}</text></g>`);
    }
  }

  const svg = `<svg viewBox="0 0 ${TRACK_W} ${TRACK_H}" width="${TRACK_W}" height="${TRACK_H}" class="ntd-svg" role="img" aria-label="Detailed Net Thrust track">`
    + `<defs><marker id="ntd-ar" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 z" fill="#ec5a96"/></marker></defs>`
    + p.join('') + '</svg>';
  host.innerHTML = svg;
}
