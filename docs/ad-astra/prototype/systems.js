// HIGH FRONTIER: AD ASTRA - star systems built by the system map rules (AA-B7a).
//
// An explored star's chits (habitable-zone world, companions) become a body
// list, and docs/ad-astra/mapgen/mapgen.js builds the board from it by the SM
// rules (docs/ad-astra/system-map-rules.md): nested helio zones, a Hohmann ring
// per zone, one burn per zone crossing, gravity wells by size, giants as hubs
// with their moons branching off, sites as one-edge leaves, radiation at the
// star and in the giants' belts. A map that fails any SM-10 check is rebuilt
// with fresh body angles.
import { buildMap, zoneLayer } from '../mapgen/mapgen.js';

export const SYSTEM_LAYOUT = 5; // 5 = built by the SM rules (mapgen)
export { zoneLayer };
const SPEC = ['C', 'S', 'M', 'V'];
const CLASS_HYD = { Garden: [6, 9], Habitable: [4, 7], Marginal: [2, 5], Hostile: [0, 3] };
const STEP_OF = { Marginal: 2, Habitable: 3, Garden: 4, Hostile: 0 };
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
const REGIONS = { hz: ['north', 'equator', 'south'], rock: ['day side', 'night side'], moon: ['near side', 'far side'] };
const SHORT = { north: 'N', equator: 'Eq', south: 'S', 'day side': 'Day', 'night side': 'Night', 'near side': 'Near', 'far side': 'Far' };

// Where each kind of body sits, by star type: zone counts (SM-1a) and zones.
const LAYOUT = {
  yellow: { zones: 6, rock: 0, hz: 2, belt: 3, giants: [4, 5] },
  red: { zones: 4, rock: 0, hz: 1, belt: 2, giants: [3, 3] },
  brown: { zones: 4, rock: 0, hz: 1, belt: 2, giants: [3, 3] },
};

// The chits as an SM body list (the generator's spec).
function specFor({ star, chits, rint, worldName, short }) {
  const L = LAYOUT[star.type] || LAYOUT.yellow;
  const bodies = []; const meta = {};
  const add = (bd, m) => { bodies.push({ angle: rint(0, 359), ...bd }); meta[bd.name] = m; };
  // the inner rocky world (2 regions, Hostile)
  add({ kind: 'planet', name: `${short} I`, zone: L.rock, size: rint(4, 6), sites: 2, cls: 'Hostile' }, { role: 'rock', regions: REGIONS.rock });
  // the habitable-zone world: 3 regions of one world, sharing class + terraform track
  if (chits.hz && chits.hz !== 'None') {
    const nm = worldName();
    add({ kind: 'planet', name: nm, zone: L.hz, size: rint(6, 9), sites: 3, cls: chits.hz, atmosphere: chits.hz !== 'Hostile' }, { role: 'hz', cls: chits.hz, regions: REGIONS.hz });
  }
  // the asteroid belt: a dwarf planet and small rocks, all mines
  add({ kind: 'dwarf', name: `${short} belt A`, zone: L.belt, size: rint(5, 7) }, { mine: true, big: true });
  const rocks = rint(1, 2);
  for (let i = 0; i < rocks; i++) add({ kind: 'asteroid', name: `${short} belt ${String.fromCharCode(66 + i)}`, zone: L.belt, size: rint(2, 4) }, { mine: true });
  // companions: giants are hubs, their moons branch off the hub (SM-7)
  chits.comps.forEach((cmp, ci) => {
    const giant = cmp.kind === 'gas' ? `${short} ${String.fromCharCode(98 + ci)}` : `${short} ${cmp.kind === 'brown' ? 'brown' : 'white'} dwarf`;
    const nBig = cmp.kind === 'gas' ? 4 : cmp.kind === 'brown' ? 2 : 1;
    const moons = Array.from({ length: nBig }, (_, j) => ({ name: `${giant}-${ROMAN[j]}`, size: rint(6, 9), sites: 2, ocean: cmp.chit === 'Ocean' && j === Math.min(1, nBig - 1) }));
    moons.push({ name: `${giant} moonlet`, size: 2 });
    add({ kind: 'giant', name: giant, giantKind: cmp.kind, zone: L.giants[ci] ?? L.zones - 1, size: cmp.kind === 'white' ? 10 : 11, moons }, { giant: cmp.kind });
  });
  return { spec: { name: star.name, starType: star.type === 'yellow' ? 'yellow' : 'red', zones: L.zones, bodies }, meta };
}

export function buildSystem({ star, chits, rint, worldName, keep }) {
  const short = star.name.split(' ')[0].replace(/'s$/, '');
  const { spec, meta } = specFor({ star, chits, rint, worldName, short });
  // SM-10: rebuild with fresh angles until every check passes
  let map = buildMap(spec);
  for (let tries = 0; tries < 12 && !map.report.every((r) => r.ok); tries++) {
    for (const bd of spec.bodies) bd.angle = rint(0, 359);
    map = buildMap(spec);
  }

  const nodes = map.nodes.map((n) => {
    const out = { ...n };
    if (n.kind === 'star') out.kind = 'starnode';
    if (n.kind === 'lagrange' && meta[n.body] && meta[n.body].giant) { // the skim point (AA-G13)
      out.skim = meta[n.body].giant === 'gas'; out.label = `${n.body} (Lagrange)`;
    } else if (n.kind === 'lagrange' && n.body) out.label = `${n.body} orbit`;
    return out;
  }).filter((n) => n.kind !== 'starnode'); // the star is drawn on its own
  const edges = map.edges.filter(([a, b]) => a !== 'star' && b !== 'star');

  const sites = [];
  const site = (o) => sites.push({ claimed: false, cubes: 0, pop: 0, step: 0, startStep: 0, ...o });
  const seen = {};
  for (const n of map.sites) {
    const i = seen[n.body] = (seen[n.body] ?? -1) + 1;
    const m = meta[n.body] || meta[n.moonOf] || {};
    const base = { id: n.id, node: n.id, body: n.body, size: n.size, spec: SPEC[rint(0, 3)], primary: i === 0 };
    if (n.bodyKind === 'planet') {
      const region = m.regions[i] || `region ${i + 1}`;
      const [lo, hi] = CLASS_HYD[m.cls || 'Hostile'];
      site({ ...base, kind: 'world', role: m.role, name: `${n.body}: ${region}`, label: `${n.body} ${SHORT[region] || ''}`.trim(), cls: m.cls || 'Hostile', hyd: m.role === 'rock' ? rint(0, 1) : rint(lo, hi),
        spec: m.role === 'rock' ? ['M', 'V'][rint(0, 1)] : base.spec, terra: true, step: STEP_OF[m.cls] || 0, startStep: STEP_OF[m.cls] || 0 });
    } else if (n.bodyKind === 'moon' && n.size > 2) {
      const region = REGIONS.moon[i] || 'surface';
      site({ ...base, kind: n.ocean ? 'ocean' : 'moon', name: `${n.body}: ${region}`, label: `${n.body.replace(`${short} `, '')} ${SHORT[region]}`, cls: 'Hostile', hyd: n.ocean ? rint(7, 9) : rint(0, 4), spec: n.ocean ? 'C' : base.spec, terra: false, moonOf: n.moonOf });
    } else {
      site({ ...base, kind: 'mine', big: !!m.big, name: n.body, label: n.body.replace(`${short} `, '').replace(/^belt/, 'Belt'), cls: null, hyd: rint(0, n.bodyKind === 'asteroid' ? 2 : 4), primary: true });
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
  return { nodes, edges, sites, display, zones: spec.zones, report: map.report, landfall: [], blueprints: [], layout: SYSTEM_LAYOUT };
}
