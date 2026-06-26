// Fuel-strip graph model - the published board's fuel/thrust ladder, as a
// PURE data module (no DOM, no node: imports) so the browser AND the server
// share one source of truth for fuel-step math. The SVG rendering of this
// graph lives in js/game/net-thrust-detail.js, which imports from here.
//
// Wet-mass nodes: integers 1..32 plus fuel-step sub-nodes at N + k/d
// (fractions count up). Per-gap fuel-steps d: 1->2 9, 2->3 6, 3->4 4, 4-5 3,
// 6-10 2, 11-31 1.
// Connections: RED = refuel (load 1 fuel step), BLACK = burn (spend 1 fuel
// step) - linear through mass <= 23, splitting by parity above 23 (both arms
// converge on 23).
//
// FUEL STEPS vs WATER/AQUA: one black connection == one fuel step. Water and
// aqua are 1-to-1 mass units; a fuel step maps to them only NON-linearly
// through this ladder (a step buys less mass-fraction the heavier the ship:
// ninths in WISP ... whole units in TUG). So "N fuel steps" is never "N water".

export const MIN_DRY = 1, MAX_DRY = 23, MAX_WET = 32;
const DENOM = { 1: 9, 2: 6, 3: 4, 4: 3, 5: 3, 6: 2, 7: 2, 8: 2, 9: 2, 10: 2 };
for (let n = 11; n <= 31; n++) DENOM[n] = 1;

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const frac = (k, d) => { const g = gcd(k, d); return `${k / g}/${d / g}`; };

// Ordered node list (ascending mass).
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
export const at = (mass) => BY_MASS.get(Math.round(mass * 1e6)) || null;
const snapNode = (mass) => at(mass) || at(Math.max(MIN_DRY, Math.min(MAX_WET, Math.round(mass))));

// Mixed-number label for a wet/dry mass value (e.g. "4 1/3").
export function massLabel(mass) {
  const n = at(mass);
  return n ? n.label : String(mass);
}

const m = (N, k, d) => N + k / d;

export const RED = (() => {
  const pairs = []; const chain = (...pts) => { for (let i = 0; i < pts.length - 1; i++) pairs.push([pts[i], pts[i + 1]]); };
  for (let N = 1; N < MAX_WET; N++) chain(N, N + 1);
  chain(m(1, 1, 9), m(2, 1, 6), m(3, 1, 4), m(4, 1, 3), m(5, 1, 3), 6);
  chain(m(1, 2, 9), m(2, 1, 6)); chain(m(1, 1, 3), m(2, 1, 3), m(3, 1, 4));
  chain(m(1, 4, 9), m(2, 1, 2), m(3, 1, 2), m(4, 2, 3), m(5, 2, 3), m(6, 1, 2), m(7, 1, 2), m(8, 1, 2), m(9, 1, 2), m(10, 1, 2), 11);
  chain(m(1, 5, 9), m(2, 1, 2)); chain(m(1, 2, 3), m(2, 2, 3), m(3, 3, 4));
  chain(m(1, 7, 9), m(2, 5, 6), m(3, 3, 4)); chain(m(1, 8, 9), m(2, 5, 6)); chain(m(3, 3, 4), m(4, 2, 3));
  return pairs.map(([a, b]) => [at(a), at(b)]).filter(([a, b]) => a && b);
})();

export const BLACK = (() => {
  const out = []; const seq = (arr) => { for (let i = 0; i < arr.length - 1; i++) { const a = at(arr[i]), b = at(arr[i + 1]); if (a && b) out.push([a, b]); } };
  const low = NODES.filter((n) => n.mass <= 23);
  for (let i = low.length - 1; i > 0; i--) out.push([low[i], low[i - 1]]);
  seq([32, 30, 28, 26, 24, 23]); seq([31, 29, 27, 25, 23]);
  return out;
})();

// Each node has exactly one BLACK successor toward dry, so a burn walk is
// deterministic.
export const BLACK_SUCC = new Map(BLACK.map(([a, b]) => [a.id, b]));

// HF rule: a rocket's DRY mass never drops below 1 - an all-0-mass stack still
// masses 1, so 1 water always reads as wet mass 2. Floor every rocket dry-mass
// computation through here (a no-op for normal stacks, where card mass >= 1) so
// the client + server fuel math stay byte-identical.
export function rocketDryMass(cardMassSum) {
  return Math.max(1, Number(cardMassSum) || 0);
}

// Fuel-step capacity: the number of BLACK (burn) connections from the WET
// node down to the DRY node = how many fuel steps the rocket can burn.
export function blackStepsBetween(dryMass, wetMass) {
  const dryN = snapNode(dryMass), wetN = snapNode(wetMass);
  if (!dryN || !wetN || wetN.mass <= dryN.mass) return 0;
  let steps = 0, cur = wetN, guard = 0;
  while (cur && cur.id !== dryN.id && guard++ < NODES.length + 5) {
    const next = BLACK_SUCC.get(cur.id);
    if (!next) break;
    steps++;
    cur = next;
  }
  return steps;
}

// Spend `steps` fuel steps: walk the WET chit down that many BLACK
// connections and return the resulting (possibly fractional) wet mass. Stops
// at the bottom of the ladder if `steps` would overshoot (callers gate on
// blackStepsBetween first, so that's only a safety clamp). The water spent is
// the NON-linear mass drop (old wet - returned wet); the remaining tank water
// = returned wet - dry mass, which can land on a sub-1 remainder.
export function walkBlackDown(wetMass, steps) {
  let cur = snapNode(wetMass);
  if (!cur) return wetMass;
  let n = Math.max(0, Math.floor(steps + 1e-9));
  let guard = 0;
  while (cur && n > 0 && guard++ < NODES.length + 5) {
    const next = BLACK_SUCC.get(cur.id);
    if (!next) break;
    cur = next;
    n--;
  }
  return cur.mass;
}
