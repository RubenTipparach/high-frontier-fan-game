// The Lagrange-point number printed inside each numbered orange ring on the
// published board (L1 to L5, plus the two Sol-Earth "L4s" / "L5s" rings).
// Read off the board image (vendor/hf-mission-planner/assets/hf4.jpg) ring by
// ring; the planner data carries no Lagrange numbers. Rings printed with an
// orbit code (LEO, LMO, LVO ...), a "B", or nothing are not listed here.
// Keyed by the planner node's server slug (id2). Pure data.

export const LAGRANGE_LABELS = {
  // L1
  'lag-jkgud': 'L1', 'lag-vnzy7': 'L1', 'lag-3y19p': 'L1', 'lag-96ll6': 'L1',
  'lag-hj5gg': 'L1', 'lag-f1g82': 'L1', 'lag-wumzs': 'L1', 'lag-poseh': 'L1',
  'lag-uw5gn': 'L1', 'lag-3j8ro': 'L1', 'lag-699n8': 'L1', 'lag-qofv5': 'L1',
  // L2
  'lag-s1uqf': 'L2', 'lag-05yv6': 'L2', 'lag-5oj7a': 'L2', 'lag-hdx7e': 'L2',
  'lag-zmjny': 'L2',
  // L3
  'lag-rp2lu': 'L3', 'lag-i6c33': 'L3', 'lag-2x82u': 'L3', 'lag-skyvt': 'L3',
  'lag-ryqwd': 'L3',
  // L4
  'lag-yqx42': 'L4', 'lag-ii1qv': 'L4', 'lag-ylhys': 'L4', 'lag-gxbwh': 'L4',
  'lag-gmgeq': 'L4', 'lag-9yq8c': 'L4', 'lag-r67lh': 'L4', 'lag-o1fc5': 'L4',
  'lag-uflkk': 'L4s',
  // L5
  'lag-agd60': 'L5', 'lag-pyghs': 'L5', 'lag-ivtte': 'L5', 'lag-91lmy': 'L5',
  'lag-vxf0t': 'L5', 'lag-1blmp': 'L5', 'lag-lbbtn': 'L5', 'lag-3x0p0': 'L5',
  'lag-p2shq': 'L5', 'lag-qzppx': 'L5', 'lag-yj5z7': 'L5', 'lag-daa9p': 'L5',
  'lag-ogkwq': 'L5',
  'lag-ctnib': 'L5s',
};

export function lagrangeLabel(id2) {
  return (id2 && LAGRANGE_LABELS[id2]) || null;
}
