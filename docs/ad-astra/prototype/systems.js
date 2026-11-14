// HIGH FRONTIER: AD ASTRA - star systems built by the system map rules (AA-B7a).
//
// An explored star's chits (habitable-zone worlds, companions) become a body
// list, and docs/ad-astra/mapgen/mapgen.js builds the board from it by the SM
// rules (docs/ad-astra/system-map-rules.md): nested helio zones, a Hohmann ring
// per zone, one burn per zone crossing, gravity wells by size, giants with a
// slingshot point and an escape ladder their moons branch off, asteroid belts
// and Trojans, radiation at each star and in the giants' belts. A binary star
// is two systems side by side; a distant companion is a small system at the
// board's edge (SM-1e). A map that fails any SM-10 check is rebuilt with fresh
// body angles.
import { buildMap, zoneLayer } from '../mapgen/mapgen.js';

export const SYSTEM_LAYOUT = 6; // 6 = SM rules with belts, slingshots, binaries
export { zoneLayer };
const SPEC = ['C', 'S', 'M', 'V'];
const CLASS_HYD = { Garden: [6, 9], Habitable: [4, 7], Marginal: [2, 5], Hostile: [0, 3] };
const STEP_OF = { Marginal: 2, Habitable: 3, Garden: 4, Hostile: 0 };
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
const REGIONS = { hz: ['north', 'equator', 'south'], rock: ['day side', 'night side'], moon: ['near side', 'far side'], ocean: ['ice shell', 'dark side'] };
const SHORT = { north: 'N', equator: 'Eq', south: 'S', 'day side': 'Day', 'night side': 'Night', 'near side': 'Near', 'far side': 'Far', 'ice shell': 'Ice', 'dark side': 'Dark' };

// Where each kind of body sits on the primary, by star type (SM-1a zones).
const LAYOUT = {
  yellow: { zones: 6, rock: 0, hz: 2, belt: 3, giants: [4, 5] },
  red: { zones: 4, rock: 0, hz: 1, belt: 2, giants: [3, 3] },
  brown: { zones: 4, rock: 0, hz: 1, belt: 2, giants: [3, 3] },
};
const BINARY_LAYOUT = { zones: 4, rock: 0, hz: 1, belt: 2, giants: [3, 3] }; // the primary of a binary

// The chits as an SM spec: stars + bodies.
function specFor({ star, chits, rint, worldName, short }) {
  const comps = chits.stars || [];
  const hasBinary = comps.some((c) => c.role === 'binary');
  const L = hasBinary ? BINARY_LAYOUT : (LAYOUT[star.type] || LAYOUT.yellow);
  const stars = [{ name: comps.length ? `${star.name} A` : star.name, type: star.type, zones: L.zones }];
  const bodies = []; const meta = {};
  const add = (bd, m = {}) => { bodies.push({ angle: rint(0, 359), ...bd }); meta[bd.name] = m; };
  const belt = (name, starIdx, zone, count) => add({ kind: 'belt', name, star: starIdx, zone, count, sizes: Array.from({ length: count }, () => rint(1, 4)) }, { belt: true });
  // the inner rocky world (2 regions, Hostile)
  add({ kind: 'planet', name: `${short} I`, zone: L.rock, size: rint(4, 6), sites: 2, cls: 'Hostile' }, { role: 'rock', regions: REGIONS.rock });
  // a few near-star rocks (SM-5f)
  belt(`${short} near rocks`, 0, Math.max(0, L.hz - 1), rint(1, 2));
  // the habitable-zone world: 3 regions of one world, sharing class + terraform track
  if (chits.hz && chits.hz !== 'None') {
    const nm = worldName();
    add({ kind: 'planet', name: nm, zone: L.hz, size: rint(6, 9), sites: 3, cls: chits.hz, atmosphere: chits.hz !== 'Hostile' }, { role: 'hz', cls: chits.hz, regions: REGIONS.hz });
  }
  // the main belt: a dwarf planet and a field of rocks, all mines (SM-5f)
  add({ kind: 'dwarf', name: `${short} dwarf`, zone: L.belt, size: rint(5, 7) }, { mine: true, big: true });
  belt(`${short} belt`, 0, L.belt, rint(5, 8));
  // giants inside the system: a slingshot point and an escape ladder its moons branch off (SM-7)
  chits.comps.forEach((cmp, ci) => {
    const giant = cmp.kind === 'gas' ? `${short} ${String.fromCharCode(98 + ci)}` : `${short} ${cmp.kind === 'brown' ? 'brown' : 'white'} dwarf`;
    const nBig = cmp.kind === 'gas' ? 4 : cmp.kind === 'brown' ? 2 : 1;
    const moons = Array.from({ length: nBig }, (_, j) => ({ name: `${giant}-${ROMAN[j]}`, size: rint(6, 9), sites: 2, ocean: cmp.chit === 'Ocean' && j === Math.min(1, nBig - 1) }));
    moons.push({ name: `${giant} moonlet`, size: 2 });
    add({ kind: 'giant', name: giant, giantKind: cmp.kind, zone: L.giants[ci] ?? L.zones - 1, size: cmp.kind === 'white' ? 10 : 11, moons, trojans: cmp.kind === 'gas' ? rint(1, 2) : 0 }, { giant: cmp.kind });
  });
  // the outer (Kuiper) belt in the outermost zone
  if (L.zones - 1 > L.belt) belt(`${short} outer belt`, 0, L.zones - 1, rint(3, 5));
  // stellar companions: a binary partner beside it, or a distant star at the edge (SM-1e)
  comps.forEach((c) => {
    const si = stars.length;
    const zones = c.role === 'distant' ? 2 : 3;
    stars.push({ name: c.name, type: c.type, zones, role: c.role });
    const cs = c.name.replace(`${star.name} `, '').replace(' Centauri', '');
    if (c.role === 'binary') add({ kind: 'planet', name: `${cs} I`, star: si, zone: 0, size: rint(3, 6), sites: 2, cls: 'Hostile' }, { role: 'rock', regions: REGIONS.rock });
    if ((c.type === 'yellow' || c.type === 'red') && c.chit && c.chit !== 'None') { // its own habitable-zone world
      const nm = c.known || worldName();
      add({ kind: 'planet', name: nm, star: si, zone: 1, size: rint(6, 9), sites: c.role === 'distant' ? 2 : 3, cls: c.chit, atmosphere: c.chit !== 'Hostile' }, { role: 'hz', cls: c.chit, regions: REGIONS.hz });
    } else if (c.chit === 'Ocean') { // a dark world with a buried ocean, round a dead or failed star
      add({ kind: 'planet', name: `${cs} b`, star: si, zone: 1, size: rint(5, 7), sites: 2, cls: 'Hostile' }, { role: 'ocean', regions: REGIONS.ocean });
    }
    belt(`${cs} belt`, si, zones - 1, c.role === 'distant' ? 2 : rint(3, 4));
  });
  return { spec: { name: star.name, stars, bodies }, meta };
}

export function buildSystem({ star, chits, rint, worldName, keep }) {
  const short = star.name.split(' ')[0].replace(/'s$/, '');
  const { spec, meta } = specFor({ star, chits, rint, worldName, short });
  // SM-10: rebuild with fresh angles until every check passes
  let map = buildMap(spec);
  for (let tries = 0; tries < 30 && !map.report.every((r) => r.ok); tries++) {
    for (const bd of spec.bodies) bd.angle = rint(0, 359);
    map = buildMap(spec);
  }

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
