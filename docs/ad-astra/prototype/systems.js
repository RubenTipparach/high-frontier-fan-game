// HIGH FRONTIER: AD ASTRA - star systems built by the system map rules (AA-B7a).
//
// An explored star's chits become a body list (mapgen/roll.js, at the design
// targets: 4 to 15 planets a star, 30 to 50 asteroids and 10 comets a board,
// gas giants with 4 to 10 major and 10 to 15 minor moons), and
// mapgen/mapgen.js builds the board by the SM rules
// (docs/ad-astra/system-map-rules.md). A map that fails an SM-10 check is
// re-placed with a fresh start angle for every body.
import { buildMap, zoneLayer } from '../mapgen/mapgen.js';
import { rollSystem, REGIONS } from '../mapgen/roll.js';

export const SYSTEM_LAYOUT = 10; // 10 = an Ad Astra node per star-map link (SM-9a)
export { zoneLayer };
const SPEC = ['C', 'S', 'M', 'V'];
const CLASS_HYD = { Garden: [6, 9], Habitable: [4, 7], Marginal: [2, 5], Hostile: [0, 3] };
const STEP_OF = { Marginal: 2, Habitable: 3, Garden: 4, Hostile: 0 };
const SHORT = { north: 'N', equator: 'Eq', south: 'S', 'day side': 'Day', 'night side': 'Night', 'near side': 'Near', 'far side': 'Far', 'ice shell': 'Ice', 'dark side': 'Dark' };

export function buildSystem({ star, chits, rint, worldName, keep, links = null }) {
  const short = star.name.split(' ')[0].replace(/'s$/, '');
  const { spec, meta } = rollSystem({ star, chits, rint, worldName, links });
  // SM-10: re-place with fresh start angles until every check passes
  let map = buildMap(spec);
  for (let tries = 1; tries < 12 && !map.report.every((r) => r.ok); tries++) map = buildMap({ ...spec, jitter: tries });

  const starIds = new Set(map.stars.map((x) => x.id));
  const nodes = map.nodes.filter((n) => n.kind !== 'star').map((n) => { // the stars are drawn on their own
    const out = { ...n };
    if (n.purpose === 'flyby') { // the slingshot point, also the skim point (AA-G13)
      out.skim = meta[n.body]?.giant === 'gas'; out.label = `${n.body} slingshot`;
    } else if (n.kind === 'lagrange' && n.body) out.label = `${n.body} orbit`;
    return out;
  });
  const edges = map.edges.filter(([a, b]) => !starIds.has(a) && !starIds.has(b));

  const sites = [];
  const site = (o) => sites.push({ claimed: false, cubes: 0, pop: 0, step: 0, startStep: 0, ...o });
  const seen = {};
  for (const n of map.sites) {
    const i = seen[n.body] = (seen[n.body] ?? -1) + 1;
    const m = meta[n.body] || meta[n.moonOf] || (n.belt ? meta[n.belt] : null) || {};
    const base = { id: n.id, node: n.id, body: n.body, size: n.size, spec: SPEC[rint(0, 3)], primary: i === 0 };
    if (n.bodyKind === 'planet' && m.role === 'ocean') {
      const region = m.regions[i] || 'surface';
      site({ ...base, kind: 'ocean', name: `${n.body}: ${region}`, label: `${n.body} ${SHORT[region] || ''}`.trim(), cls: 'Hostile', hyd: rint(7, 9), spec: 'C', terra: false });
    } else if (n.bodyKind === 'planet') {
      const region = m.regions[i] || `region ${i + 1}`;
      const [lo, hi] = CLASS_HYD[m.cls || 'Hostile'];
      site({ ...base, kind: 'world', role: m.role, name: `${n.body}: ${region}`, label: `${n.body} ${SHORT[region] || ''}`.trim(), cls: m.cls || 'Hostile', hyd: m.role === 'rock' ? rint(0, 1) : rint(lo, hi),
        spec: m.role === 'rock' ? ['M', 'V'][rint(0, 1)] : base.spec, terra: true, step: STEP_OF[m.cls] || 0, startStep: STEP_OF[m.cls] || 0 });
    } else if (n.bodyKind === 'moon' && n.size > 2) {
      const region = REGIONS.moon[i] || 'surface';
      site({ ...base, kind: n.ocean ? 'ocean' : 'moon', name: `${n.body}: ${region}`, label: `${n.body.replace(`${short} `, '')} ${SHORT[region]}`, cls: 'Hostile', hyd: n.ocean ? rint(7, 9) : rint(0, 4), spec: n.ocean ? 'C' : base.spec, terra: false, moonOf: n.moonOf });
    } else {
      const lbl = n.body.replace(`${short} `, '').replace(/^belt/, 'Belt').replace(/^near rocks/, 'Rock').replace(/^outer belt/, 'Outer');
      if (n.bodyKind === 'comet') { // SM-5g: a water-rich far orbit, mined like any small body
        site({ ...base, kind: 'mine', comet: true, name: n.body, label: n.body.replace(`${short} `, ''), cls: null, hyd: rint(3, 5), spec: 'C', primary: true });
        continue;
      }
      site({ ...base, kind: 'mine', big: !!m.big, name: n.body, label: lbl.charAt(0).toUpperCase() + lbl.slice(1), cls: null, hyd: rint(0, n.bodyKind === 'asteroid' ? 2 : 4), primary: true });
    }
  }
  // all regions of a world share one class and terraform track (AA-H10)
  for (const s of sites) if (s.kind === 'world') { const p = sites.find((q) => q.body === s.body && q.primary); s.cls = p.cls; }

  const display = map.bodies.map((g) => ({ id: g.id, kind: meta[g.name]?.giant || 'gas', name: g.name, x: g.x, y: g.y }));

  // ---- carry a saved system's game state across a relayout, by role
  if (keep && keep.length) {
    const roleOf = (s) => (s.kind === 'world' ? (s.role || (s.id === 'hz' ? 'hz' : 'rock')) : s.kind);
    const pool = sites.slice();
    for (const old of keep) {
      if (!old.claimed && !old.cubes && !old.pop && !(old.step > (old.startStep || 0))) continue;
      const role = roleOf(old);
      const i = pool.findIndex((s) => roleOf(s) === role && (role !== 'world' || s.primary));
      const j = i >= 0 ? i : pool.findIndex((s) => roleOf(s) === role);
      if (j < 0) continue;
      const s = pool.splice(j, 1)[0];
      Object.assign(s, { claimed: !!old.claimed, cubes: old.cubes || 0, pop: old.pop || 0, goo: !!old.goo });
      if (s.terra && old.step != null) for (const t of sites.filter((q) => q.body === s.body)) { t.step = Math.max(t.step, old.step); }
    }
  }
  const stars = map.stars.map((x) => ({ name: x.name, type: x.type, role: x.role, zones: x.zones, x: x.x, y: x.y }));
  return { nodes, edges, sites, display, stars, zones: stars[0].zones, report: map.report, landfall: [], blueprints: [], layout: SYSTEM_LAYOUT };
}
