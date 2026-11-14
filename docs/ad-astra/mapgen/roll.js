// HIGH FRONTIER: AD ASTRA - roll a star system's bodies (SM-1f, 5f, 5g, 7c).
//
// Turns a star, its companions and its chits into a mapgen spec at the design
// targets: 4 to 15 planets a star (gas giants included), 30 to 100 asteroids
// and 10 comets a board, gas giants with 4 to 10 major and 10 to 15 minor
// moons. Shared by the game (prototype/systems.js) and the map builder's
// "Roll a system". Pure: no DOM. `meta` carries what the game needs per body
// (role, class, regions); mapgen ignores it.
import { TARGETS, starLayout, zoneBounds } from './mapgen.js';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV'];
export const REGIONS = { hz: ['north', 'equator', 'south'], rock: ['day side', 'night side'], moon: ['near side', 'far side'], ocean: ['ice shell', 'dark side'] };

// a seeded integer roller (presets stay the same every load)
export function seededRint(seed) {
  let s = (seed >>> 0) || 1;
  return (a, b) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return a + Math.floor((s / 4294967296) * (b - a + 1)); };
}

// star: { name, type }; chits: { hz, comps: [{ kind, chit }], stars: [{ name, type, role, chit, known }] }
export function rollSystem({ star, chits = {}, rint, worldName = () => 'World', planets = null, links = null, asteroids = null }) {
  const short = star.name.split(' ')[0].replace(/'s$/, '');
  const comps = chits.stars || [];
  const hasB = comps.some((c) => c.role === 'binary');
  const hasD = comps.some((c) => c.role === 'distant');
  const bodies = []; const meta = {};
  const add = (bd, m = {}) => { bodies.push(bd); meta[bd.name] = m; return bd; };
  const pick = (arr) => arr[rint(0, arr.length - 1)];

  // ---- per-star plans (SM-1f): planets, zones, giants
  const plan = [];
  const primaryPlanets = planets ? Math.max(TARGETS.planets[0], Math.min(TARGETS.planets[1], planets)) : hasB ? rint(4, 6) : hasD ? (star.type === 'yellow' ? rint(5, 10) : rint(4, 7)) : star.type === 'yellow' ? rint(6, 15) : star.type === 'red' ? rint(4, 9) : rint(4, 6);
  const zonesFor = (n, role) => (role === 'primary' ? (hasB ? 4 : Math.max(4, Math.min(hasD ? 7 : 9, Math.ceil(n / 2) + 1))) : 3);
  plan.push({ i: 0, name: comps.length ? `${star.name} A` : star.name, type: star.type, role: 'primary', planets: primaryPlanets, hz: chits.hz, short, giants: chits.comps || [] });
  comps.forEach((c) => plan.push({ i: plan.length, name: c.name, type: c.type, role: c.role, planets: c.role === 'binary' ? rint(4, 5) : 4, hz: (c.type === 'yellow' || c.type === 'red') ? c.chit : null, ocean: c.chit === 'Ocean' && (c.type === 'white' || c.type === 'brown'), known: c.known, short: c.name.replace(`${star.name} `, '').replace(' Centauri', ''), giants: [] }));
  const stars = plan.map((p) => ({ name: p.name, type: p.type, role: p.role, zones: zonesFor(p.planets, p.role) }));

  let gasGiants = 0;
  for (const p of plan) {
    const Z = stars[p.i].zones;
    const hzZone = p.type === 'yellow' ? Math.max(1, Math.round(Z * 0.34)) : 1;
    const beltZone = Math.min(Z - 1, hzZone + 1);
    p.beltZone = beltZone; p.Z = Z;
    let left = p.planets;
    const zoneSlots = Array.from({ length: Z }, (_, k) => k);
    // the inner rocky world (2 regions, Hostile)
    add({ kind: 'planet', name: `${p.short} ${ROMAN[0]}`, star: p.i, zone: 0, size: rint(4, 6), sites: 2, cls: 'Hostile' }, { role: 'rock', regions: REGIONS.rock }); left--;
    // the habitable-zone world: 3 regions sharing class + terraform track
    if (p.hz && p.hz !== 'None') {
      add({ kind: 'planet', name: p.known || worldName(), star: p.i, zone: hzZone, size: rint(6, 9), sites: p.role === 'distant' ? 2 : 3, cls: p.hz, atmosphere: p.hz !== 'Hostile' }, { role: 'hz', cls: p.hz, regions: REGIONS.hz }); left--;
    } else if (p.ocean) { // a dark world with a buried ocean, round a dead or failed star
      add({ kind: 'planet', name: `${p.short} b`, star: p.i, zone: 1, size: rint(5, 7), sites: 2, cls: 'Hostile' }, { role: 'ocean', regions: REGIONS.ocean }); left--;
    }
    // giants: the chits' giants, plus more on a big lone system (SM-7c)
    const giantList = p.giants.map((g) => ({ kind: g.kind, chit: g.chit }));
    const extra = p.role !== 'primary' ? 0 : hasB ? 0 : p.type === 'yellow' ? Math.max(0, Math.min(3, Math.round(p.planets / 4)) - giantList.length) : p.type === 'red' ? Math.max(0, Math.round(p.planets / 6) - giantList.length) : 0;
    for (let g = 0; g < extra; g++) giantList.push({ kind: 'gas', chit: 'None' });
    const outerZones = zoneSlots.filter((k) => k > beltZone);
    giantList.slice(0, Math.max(0, left)).forEach((g, gi) => {
      const name = `${p.short} ${String.fromCharCode(98 + gi)}`;
      const nMaj = g.kind === 'gas' ? rint(TARGETS.majors[0], TARGETS.majors[1]) : g.kind === 'brown' ? rint(2, 3) : 1;
      const nMin = g.kind === 'gas' ? rint(TARGETS.minors[0], TARGETS.minors[1]) : g.kind === 'brown' ? rint(3, 6) : 2;
      const moons = [];
      for (let j = 0; j < nMaj; j++) { const sz = rint(4, 9); moons.push({ name: `${name}-${ROMAN[j]}`, size: sz, sites: sz >= 7 ? 2 : 1, ocean: g.chit === 'Ocean' && j === Math.min(1, nMaj - 1) }); }
      for (let j = 0; j < nMin; j++) moons.push({ name: `${name} m${j + 1}`, size: rint(1, 2) });
      const zone = outerZones.length ? outerZones[Math.min(outerZones.length - 1, outerZones.length - 1 - (gi % outerZones.length))] : Z - 1;
      (p.giantZones = p.giantZones || []).push(zone);
      add({ kind: 'giant', name, star: p.i, zone, giantKind: g.kind, size: g.kind === 'white' ? 10 : 11, moons, trojans: g.kind === 'gas' ? 2 : 0 }, { giant: g.kind });
      if (g.kind === 'gas') gasGiants++;
      left--;
    });
    // the rest are rocky worlds spread out through the zones
    for (let j = 0; j < left; j++) {
      const zone = zoneSlots[1 + ((j * 3 + 1) % Math.max(1, Z - 1))] ?? Z - 1;
      const sz = rint(3, 9);
      add({ kind: 'planet', name: `${p.short} ${ROMAN[1 + j] || `P${j + 2}`}`, star: p.i, zone, size: sz, sites: sz >= 6 ? 2 : 1, cls: 'Hostile' }, { role: 'rock', regions: REGIONS.rock });
    }
    // dwarf planets: one in the belt, one far out on a big system
    add({ kind: 'dwarf', name: `${p.short} dwarf planet`, star: p.i, zone: beltZone, size: rint(5, 7) }, { mine: true, big: true });
    if (Z >= 6) add({ kind: 'dwarf', name: `${p.short} far dwarf planet`, star: p.i, zone: Z - 1, size: rint(5, 7) }, { mine: true, big: true });
  }

  // ---- asteroids for the whole board (SM-5f): Trojans first, then belts.
  // A ring holds as many rock groups as its length allows (a group needs ~90 px
  // of ring, and planets keep their share), so a big belt spills into the zones
  // beside it, the way Sol's main belt runs on into the Hildas; a board short of
  // room gets as many as it can hold.
  const Ls = starLayout(stars.map((x, i) => ({ ...x, role: i === 0 ? 'primary' : x.role })));
  const ringRocks = (si, z) => { const L = Ls[si]; const b = zoneBounds(stars[si].zones, L); const r = z === 0 ? b[1] * 0.62 : (b[z] + b[z + 1]) / 2;
    const len = 2 * Math.PI * Math.sqrt(((r * L.kx) ** 2 + (r * L.ky) ** 2) / 2);
    const giants = (plan[si].giantZones || []).filter((gz) => Math.abs(gz - z) <= 2).length; // a giant's moon system takes ~440 px of the rings near it
    return Math.max(0, Math.floor((Math.max(0, len - 440 * giants) * 0.45) / 90)) * 3; };
  const room = {}; const roomOf = (si, z) => (room[`${si}:${z}`] ??= ringRocks(si, z));
  const wantTotal = asteroids ?? rint(TARGETS.asteroids[0], TARGETS.asteroids[1]);
  const belts = {}; // `${si}:${z}` -> { name, count }
  const pour = (si, z0, n, name) => { // fill zone z0, then its neighbours outward / inward
    const Z = stars[si].zones; const order = [z0]; for (let d = 1; d < Z; d++) { if (z0 + d < Z) order.push(z0 + d); if (z0 - d >= 1) order.push(z0 - d); }
    for (const z of order) { if (n <= 0) break; const take = Math.min(n, roomOf(si, z)); if (take <= 0) continue; room[`${si}:${z}`] -= take; const k = `${si}:${z}`; belts[k] = belts[k] || { si, z, name: z === z0 ? name : `${name} ${z > z0 ? 'outer' : 'inner'} reach`, count: 0 }; belts[k].count += take; n -= take; }
    return n;
  };
  let rest = Math.max(0, wantTotal - gasGiants * 4);
  const pB = plan.find((p) => p.role === 'binary'), pD = plan.find((p) => p.role === 'distant');
  const P0 = plan[0];
  const toB = pB ? Math.round(rest * 0.2) : 0, toD = pD ? Math.min(3, Math.round(rest * 0.06)) : 0;
  rest -= toB + toD;
  const near = Math.max(1, Math.round(rest * 0.1));
  const outer = P0.Z - 1 > P0.beltZone ? Math.round(rest * 0.32) : 0;
  pour(0, Math.max(0, P0.beltZone - 2), near, `${P0.short} near rocks`);
  pour(0, P0.Z - 1, outer, `${P0.short} outer belt`);
  pour(0, P0.beltZone, rest - near - outer, `${P0.short} belt`);
  if (pB) pour(pB.i, pB.Z - 1, toB, `${pB.short} belt`);
  if (pD) pour(pD.i, pD.Z - 1, toD, `${pD.short} rocks`);
  for (const b of Object.values(belts)) if (b.count > 0) add({ kind: 'belt', name: b.name, star: b.si, zone: b.z, count: b.count, sizes: Array.from({ length: b.count }, () => rint(1, 4)) }, { belt: true });

  // ---- comets for the whole board (SM-5g): half in the main-belt zone
  const cometHomes = [];
  for (let c = 0; c < TARGETS.comets; c++) {
    if (pB && c === TARGETS.comets - 1) { cometHomes.push([pB.i, pB.Z - 1]); continue; }
    if (c < TARGETS.comets / 2) cometHomes.push([0, P0.beltZone]);
    else cometHomes.push([0, rint(Math.min(P0.Z - 1, P0.beltZone + 1), P0.Z - 1)]);
  }
  const NAMES = ['Ardo', 'Vey', 'Ilse', 'Marrow', 'Tess', 'Quill', 'Orrin', 'Sable', 'Hale', 'Corin', 'Nyx', 'Pell'];
  cometHomes.forEach(([si, z], c) => add({ kind: 'comet', name: `Comet ${short} ${NAMES[c % NAMES.length]}`, star: si, zone: Math.max(1, z), size: rint(1, 3) }, { comet: true }));
  return { spec: { name: star.name, stars, bodies, ...(links ? { links } : {}) }, meta, pick };
}
