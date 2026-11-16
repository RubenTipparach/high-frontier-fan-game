// Signposted routes, read off the published HF4 board (vendor/hf-mission-planner/
// assets/hf4.jpg). Every signposted route starts at LEO and runs to the site on its
// "LEO - <destination>" sign; the board draws it as a bold line in the sign's colour,
// and where several routes share a hop it draws them side by side, like a rainbow.
// GENERATED 2026-11-15 by sampling the board colour along every map edge, joined up
// to LEO along the board's own line, then checked by eye against the board (the
// Mercury route was hand-extended to the North Pole). The sampler missed DOTTED
// stretches (half gaps), so the Venus Aerostat-Xity approach was hand-added. Each entry is an UNORDERED pair
// of node server slugs (id2); a pair may sit in several colours.
// Pure data: no DOM, no node: imports.
export const SIGNPOST_COLORS = {
  purple: '#a24bd0', periwinkle: '#8f8fe0', blue: '#78ccf0', green: '#9cd848',
  yellow: '#fcf000', orange: '#f0840c', red: '#e40c3c',
};
// Stripe order across a shared hop (the board's rainbow, left to right).
export const SIGNPOST_ORDER = ['purple',  'periwinkle',  'blue',  'green',  'yellow',  'orange',  'red'];
// One-way hops (planner '0'-label) draw DOTTED, as the board draws a one-way
// move. These are the one-way hops the board nevertheless draws SOLID (measured
// on hf4.jpg: full colour, no gaps). Unordered node-slug pairs.
export const BOARD_SOLID_ONE_WAY = new Set(['lag-dzgne|lag-poseh']);
// Text on a light sign reads dark, as on the board.
export const SIGNPOST_DARK_TEXT = new Set(['green', 'yellow']);
export const SIGNPOST_EDGES = {
  purple: [
    'achilles|burn-b23t0', 'burn-0uy81|hoh-e3bcb', 'burn-0uy81|hoh-xyiqt', 'burn-20mae|burn-rdz0o',
    'burn-20mae|burn-ubjdf', 'burn-b23t0|lag-o1fc5', 'burn-e5cgw|dec-epo4z', 'burn-e5cgw|dec-rln5u',
    'burn-gxqyl|callisto-valhalla', 'burn-gxqyl|lag-nb87u', 'burn-rdz0o|burn-xyv1k', 'burn-ubjdf|hoh-jwbb8',
    'burn-ue3lc|lag-leo', 'burn-ue3lc|rad-18m8n', 'burn-umad9|dec-tcrye', 'burn-umad9|rad-18m8n',
    'burn-xyv1k|lag-nb87u', 'burn-zcbu4|dec-tepet', 'burn-zcbu4|hoh-jwbb8', 'dec-cjm2o|hoh-e3bcb',
    'dec-cjm2o|hoh-rfd9f', 'dec-cnkzq|hoh-rfd9f', 'dec-cnkzq|lag-ylhys', 'dec-dqhnz|dec-tepet',
    'dec-dqhnz|hoh-omo16', 'dec-epo4z|dec-p9lgw', 'dec-p9lgw|dec-rpgc0', 'dec-rln5u|hoh-qmz6v',
    'dec-rpgc0|dec-xv103', 'dec-tcrye|lag-iq24g', 'dec-xv103|lag-iq24g', 'hertha|lag-p831n',
    'hoh-2qi3x|hoh-6ksou', 'hoh-2qi3x|hoh-xyiqt', 'hoh-5dcmi|hoh-omo16', 'hoh-5dcmi|lag-9yq8c',
    'hoh-6ksou|hoh-jwbb8', 'hoh-aqm59|lag-9yq8c', 'hoh-aqm59|lag-o1fc5', 'hoh-ltgp6|hoh-xyiqt',
    'hoh-ltgp6|lag-p831n', 'hoh-qmz6v|lag-ylhys',
  ],
  periwinkle: [
    'burn-f805o|lag-ryqwd', 'burn-f805o|rad-ogb7r', 'burn-ue3lc|lag-leo', 'burn-ue3lc|rad-ogb7r',
    'dec-ct329|lag-dzgne', 'dec-ct329|lag-m0sea', 'dec-xczyh|hoh-ulj9x', 'dec-xczyh|lag-poseh',
    'hoh-ulj9x|lag-ryqwd', 'lag-dzgne|lag-poseh',
    // Hand-added 2026-11-16: the LEO - Venus line runs on from LV0 through the
    // acid clouds and the triangle, then a dotted arrow into Aerostat-Xity.
    'burn-5eobz|lag-m0sea', 'burn-5eobz|lag-c3cha', 'dec-nsxxd|lag-c3cha', 'dec-nsxxd|venus-aerostat-xity',
  ],
  blue: [
    'burn-6mef9|hoh-pd9d6', 'burn-6mef9|lag-93mxc', 'burn-94orx|ceres', 'burn-94orx|lag-93mxc',
    'burn-fz21i|dec-4kt48', 'burn-fz21i|hoh-xbtuq', 'burn-geo|dec-iafc8', 'burn-geo|rad-zkdhz',
    'burn-ue3lc|lag-leo', 'burn-ue3lc|rad-zkdhz', 'burn-zrwci|hoh-94pj6', 'burn-zrwci|hoh-um9zv',
    'dec-4kt48|lag-noz3h', 'dec-5yeu5|dec-7nndy', 'dec-5yeu5|dec-hc2pt', 'dec-7nndy|dec-rnsx5',
    'dec-hc2pt|hoh-94pj6', 'dec-iafc8|dec-rip4v', 'dec-n4mpj|dec-rip4v', 'dec-n4mpj|lag-05yv6',
    'dec-rnsx5|lag-noz3h', 'hoh-pd9d6|hoh-um9zv', 'hoh-xbtuq|lag-05yv6',
  ],
  green: [
    'burn-39iur|dec-c18sw', 'burn-39iur|rad-yhhqh', 'burn-3dde1|dec-2w1pd', 'burn-3dde1|dec-vgqgl',
    'burn-blta4|dec-cs9dw', 'burn-blta4|hoh-e4m98', 'burn-geo|lag-qofv5', 'burn-geo|rad-zkdhz',
    'burn-kc6iw|lag-qeogw', 'burn-kc6iw|rad-yhhqh', 'burn-lxfdo|dec-0ym2m', 'burn-lxfdo|hoh-x141z',
    'burn-ndc58|hoh-11gth', 'burn-ndc58|hoh-yr3z9', 'burn-o9i57|hoh-667nw', 'burn-o9i57|hoh-ggxr0',
    'burn-pmxwb|lag-ogkwq', 'burn-pmxwb|neas', 'burn-rdzn5|dec-vgqgl', 'burn-rdzn5|lag-f1g82',
    'burn-ue3lc|lag-leo', 'burn-ue3lc|rad-zkdhz', 'burn-wdm1l|hoh-ogdbd', 'burn-wdm1l|hoh-qfwpy',
    'dec-0ym2m|rad-enj00', 'dec-2w1pd|dec-c18sw', 'dec-7shbo|hoh-ggxr0', 'dec-7shbo|hoh-p0h7k',
    'dec-9jlgh|dec-hkqqe', 'dec-9jlgh|hoh-zdnro', 'dec-9rdnz|hoh-ogdbd', 'dec-9rdnz|hoh-yk1qu',
    'dec-b6ndn|dec-dkji2', 'dec-b6ndn|dec-dsa2q', 'dec-cs9dw|rad-3ozrf', 'dec-dkji2|hoh-zdnro',
    'dec-dsa2q|rad-njk8t', 'dec-hiv6r|dec-ipvob', 'dec-hiv6r|lag-okomr', 'dec-hkqqe|hoh-29v8f',
    'dec-ipvob|rad-5kjo6', 'dec-nbepq|dec-vwjq8', 'dec-nbepq|hoh-wtwwz', 'dec-o4irq|hoh-11gth',
    'dec-o4irq|hoh-pqp87', 'dec-vwjq8|hoh-29v8f', 'enceladus|lag-qeogw', 'hoh-667nw|hoh-x141z',
    'hoh-7pju2|hoh-qxrxi', 'hoh-7pju2|hoh-yk1qu', 'hoh-e4m98|hoh-jtacr', 'hoh-fgiat|hoh-pqp87',
    'hoh-fgiat|hoh-x141z', 'hoh-jqypg|hoh-p0h7k', 'hoh-jqypg|lag-ogkwq', 'hoh-jtacr|hoh-wtwwz',
    'hoh-qfwpy|lag-p2shq', 'hoh-qxrxi|hoh-vnwsk', 'hoh-vnwsk|hoh-yr3z9', 'lag-f1g82|lag-tspde',
    'lag-h1i9d|rad-lws0x', 'lag-h1i9d|rad-njk8t', 'lag-jox91|lag-tspde', 'lag-jox91|rad-lws0x',
    'lag-okomr|rad-lud4y', 'lag-p2shq|lag-qofv5', 'rad-3ozrf|rad-5kjo6', 'rad-enj00|rad-lud4y',
  ],
  yellow: [
    'burn-01qj7|hoh-6tt6n', 'burn-01qj7|hoh-q44oe', 'burn-a0kiq|dec-ctapb', 'burn-a0kiq|hoh-h5aoz',
    'burn-f805o|lag-ryqwd', 'burn-f805o|rad-ogb7r', 'burn-ue3lc|lag-leo', 'burn-ue3lc|rad-ogb7r',
    'dec-1c5mj|hoh-h5aoz', 'dec-1c5mj|lag-2x82u', 'dec-8bhk9|dec-pp1gk', 'dec-8bhk9|dec-t33aa',
    'dec-ctapb|dec-jqrqb', 'dec-jqrqb|hoh-sxtkx', 'dec-pp1gk|lag-ryqwd', 'dec-t33aa|dec-uswi4',
    'dec-uswi4|lag-hdx7e', 'hoh-6tt6n|lutetia', 'hoh-q44oe|lag-2x82u', 'hoh-sxtkx|lag-ctnib',
    'lag-ctnib|lag-hdx7e',
  ],
  orange: [
    'burn-4ulw8|burn-s9iv1', 'burn-4ulw8|hoh-9rbmp', 'burn-6b7dy|dec-8o181', 'burn-6b7dy|lag-jkgud',
    'burn-9b26i|lag-ii1qv', 'burn-9b26i|rad-rttd0', 'burn-hefaa|dec-8mhda', 'burn-hefaa|dec-8o181',
    'burn-p4xxi|lag-jkgud', 'burn-p4xxi|mercury-north-pole', 'burn-s9iv1|dec-8mhda', 'burn-ue3lc|lag-leo',
    'burn-ue3lc|rad-rttd0', 'dec-0uopb|dec-75mlf', 'dec-0uopb|lag-yqx42', 'dec-75mlf|lag-ii1qv',
    'hoh-9rbmp|rad-2ikel', 'lag-yqx42|rad-2ikel',
  ],
  red: [
    'burn-3ylxe|dec-buaxz', 'burn-3ylxe|lag-5bfh5', 'burn-geo|dec-iafc8', 'burn-geo|rad-zkdhz',
    'burn-ue3lc|lag-leo', 'burn-ue3lc|rad-zkdhz', 'dec-59ffo|hoh-jh9qf', 'dec-59ffo|hoh-xtaky',
    'dec-6906q|dec-js39g', 'dec-6906q|lag-5pmg4', 'dec-81wan|hoh-64wwa', 'dec-81wan|lag-05yv6',
    'dec-azavh|hoh-xtaky', 'dec-azavh|lag-s1uqf', 'dec-buaxz|dec-ej1lc', 'dec-ej1lc|lag-s1uqf',
    'dec-iafc8|dec-rip4v', 'dec-js39g|lag-5bfh5', 'dec-n4mpj|dec-rip4v', 'dec-n4mpj|lag-05yv6',
    'hoh-64wwa|hoh-jh9qf', 'lag-5pmg4|lag-fp0u6', 'lag-fp0u6|mars-hellas-basin-buried-glaciers',
  ],
};
// slug-pair -> the colours on it (in stripe order), either order.
const _BY_PAIR = new Map();
for (const col of SIGNPOST_ORDER) {
  for (const p of (SIGNPOST_EDGES[col] || [])) {
    const [a, b] = p.split('|');
    for (const k of [a + '|' + b, b + '|' + a]) {
      if (!_BY_PAIR.has(k)) _BY_PAIR.set(k, []);
      _BY_PAIR.get(k).push(col);
    }
  }
}
const NONE = Object.freeze([]);
export function signpostColorsOf(slugA, slugB) {
  return _BY_PAIR.get(slugA + '|' + slugB) || NONE;
}
