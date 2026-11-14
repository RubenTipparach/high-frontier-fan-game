// HIGH FRONTIER: AD ASTRA - playable solo prototype.
//
// Implements docs/ad-astra/rules.md (v0.5). The rulebook is the source of
// truth: every rule below cites its ID, and where this file and the book
// disagree, this file is wrong. Cards are drawn by the game's own renderer
// (js/game/card-ui.js#renderCard) so they look like the real cards.

import { renderCard } from '../../../js/game/card-ui.js';
import { MapRenderer, LEO_ANCHOR } from '../../../js/game/render.js';
import { loadPlannerMap, buildChains } from '../../../js/game/planner-map.js';
import { buildSystem, SYSTEM_LAYOUT, zoneLayer } from './systems.js';
import { GIANT_HALO } from '../mapgen/mapgen.js';
import { NODE_TAGS } from '../../../data/node-tags.js';
import {
  TUNE, SOURCES, HOLDINGS, CLASSES, PROP_PER_MASS, FAMILY_GLYPH, CARD_BY_ID, DECKS, DECK_LABEL,
  SPINOFFS, TERRAFORM, EVENTS, STARS, STAR_BY_ID, ANCHORS, SEGMENTS, SPECIAL,
  HZ_POOLS, COMP_POOL, CLASS_HYD, WORLD_NAMES,
} from './data.js';

// ================================================================ utils
const $ = (sel, root = document) => root.querySelector(sel);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
};
const SVGNS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
};
const d6 = () => 1 + Math.floor(Math.random() * 6);
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const poolFrom = (counts) => shuffle(Object.entries(counts).flatMap(([k, n]) => Array(n).fill(k)));
let _uid = 1;

// ================================================================ star map graph (AA-B6)
// World px per space, centred on Sol. The renderer never zooms out past 1 and
// the hand strip covers the bottom of the stage, so the neighbourhood is drawn
// as a tilted plane: wide, not tall. Distances are counted in spaces (dots).
const RX = 24, RY = 10.5;
function polar([deg, r]) { const a = deg * Math.PI / 180; return { x: 700 + Math.cos(a) * r * RX, y: 400 + Math.sin(a) * r * RY }; }
function buildMap() {
  const nodes = {}; const adj = {};
  const add = (id, o) => { nodes[id] = { id, ...o }; adj[id] = adj[id] || []; };
  const link = (a, b) => { adj[a].push(b); adj[b].push(a); };
  for (const [id, pos] of Object.entries(ANCHORS)) {
    const p = polar(pos);
    if (id === 'sol') add(id, { kind: 'sol', ...p, label: 'Sol' });
    else if (STAR_BY_ID[id]) add(id, { kind: 'star', star: id, ...p, label: STAR_BY_ID[id].name });
    else add(id, { kind: 'junction', ...p });
  }
  SEGMENTS.forEach(([a, b, steps], si) => {
    let prev = a;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const id = `s${si}_${i}`;
      add(id, { kind: 'space', x: nodes[a].x + (nodes[b].x - nodes[a].x) * t, y: nodes[a].y + (nodes[b].y - nodes[a].y) * t });
      // Oort spaces: the space next to a star or Sol (AA-B6).
      if (i === 1 && (a === 'sol' || STAR_BY_ID[a])) Object.assign(nodes[id], { kind: 'oort', of: a });
      if (i === steps - 1 && STAR_BY_ID[b]) Object.assign(nodes[id], { kind: 'oort', of: b });
      link(prev, id); prev = id;
    }
    link(prev, b);
  });
  for (const [si, i, kind, target] of SPECIAL) Object.assign(nodes[`s${si}_${i}`], { kind, target });
  // distance from Sol in spaces (beam range, lens range)
  const dist = { sol: 0 }; const q = ['sol'];
  while (q.length) { const n = q.shift(); for (const m of adj[n]) if (dist[m] == null) { dist[m] = dist[n] + 1; q.push(m); } }
  return { nodes, adj, dist };
}
const MAP = buildMap();
function bfs(from) {
  const dist = { [from]: 0 }; const q = [from];
  while (q.length) { const n = q.shift(); for (const m of MAP.adj[n]) if (dist[m] == null) { dist[m] = dist[n] + 1; q.push(m); } }
  return dist;
}
// Which star does the path from `from` via `next` lead to? (for labels)
function leadsTo(from, next) {
  let prev = from, cur = next, n = 0;
  while (n++ < 60) {
    const k = MAP.nodes[cur].kind;
    if (k === 'star' || k === 'sol' || k === 'junction') return { node: cur, steps: n };
    const opts = MAP.adj[cur].filter((x) => x !== prev);
    if (opts.length !== 1) return { node: cur, steps: n };
    prev = cur; cur = opts[0];
  }
  return { node: cur, steps: n };
}
const nodeName = (id) => {
  const nd = MAP.nodes[id];
  if (!nd) return id;
  if (nd.kind === 'star' || nd.kind === 'sol') return nd.label;
  if (nd.kind === 'junction') return `junction ${id}`;
  return 'deep space';
};

// ================================================================ state
let S = null;
const CLS_LETTER = { Garden: 'G', Habitable: 'H', Marginal: 'M', Hostile: 'X' };
function newGame() {
  const decks = {};
  for (const [role, ids] of Object.entries(DECKS)) decks[role] = shuffle(ids.slice());
  const stars = {};
  for (const st of STARS) stars[st.id] = { explored: false, hz: null, comps: [] };
  S = {
    v: 6, phase: 'setup', turn: 1, gen: 0, aqua: TUNE.startAqua,
    holdings: [], decks, hand: [],
    ship: { cards: [], prop: 0, family: null, pos: 'sol', prev: null, next: null, V: 0, orbit: null, sysNode: null,
      launched: false, lost: false, recycled: false, exit: null, stagedUsed: false, cryoRolled: false, ignoreDust: false,
      crew: true, magsailUsedGen: -1, sysBurnsGen: -1, sysBurns: 0 },
    stars, pools: { yellow: poolFrom(HZ_POOLS.yellow), red: poolFrom(HZ_POOLS.red), comp: poolFrom(COMP_POOL) },
    systems: {}, spinoffs: [], firstArrival: null, explorations: 0,
    ops: { home: 1, frontier: 0, boosted: false, prospected: false },
    pending: [], log: [], over: null, event: null, worldNames: shuffle(WORLD_NAMES.slice()),
    setupChoice: [decks.drive.pop(), decks.drive.pop()],
  };
  log('A new game. Sol is industrialized and the first TW drives exist (AA-A1).');
}
const inst = (id, extra = {}) => ({ uid: _uid++, id, face: 'white', glitched: false, ...(CARD_BY_ID[id].pop != null ? { pop: CARD_BY_ID[id].pop } : {}), ...extra });
const def = (c) => CARD_BY_ID[c.id];
function log(msg, kind = '') { S.log.unshift({ msg, kind, when: whenLabel() }); if (S.log.length > 200) S.log.length = 200; }
function whenLabel() { return S.phase === 'drydock' || S.phase === 'setup' ? `Drydock ${S.turn}` : `Gen ${S.gen}`; }
function save() { try { localStorage.setItem('ad-astra-proto', JSON.stringify({ S, _uid })); } catch (e) { /* storage off */ } }
function load() {
  try { const raw = localStorage.getItem('ad-astra-proto'); if (!raw) return false; const o = JSON.parse(raw); if (!o.S || o.S.v !== 6) return false; S = o.S; _uid = o._uid || 1000; return true; } catch (e) { return false; }
}

// ================================================================ ship derived values
const ship = () => S.ship;
const shipCards = (pred = () => true) => S.ship.cards.filter((c) => c.face === 'white' && pred(def(c), c));
const working = (pred) => shipCards((d, c) => !c.glitched && pred(d, c));
const driveCard = () => S.ship.cards.find((c) => c.face === 'white' && def(c).role === 'drive');
const driveDef = () => { const c = driveCard(); return c ? def(c) : null; };
const family = () => (driveDef() ? driveDef().family : null);
function dryMass() { return S.ship.cards.reduce((a, c) => a + (c.face === 'white' ? def(c).mass : def(c).lf.mass), 0); }
function propMass(p = S.ship.prop) { const f = family(); const per = PROP_PER_MASS[f] || Infinity; return per === Infinity ? 0 : Math.floor(p / per); }
const totalMass = (p) => dryMass() + propMass(p);
const classFor = (m) => CLASSES.find((c) => m >= c.lo && m <= c.hi);
function supplies() { const set = new Set(); for (const c of working((d) => d.supplies)) for (const k of def(c).supplies) set.add(k); return set; }
function payloadMass() { return shipCards((d) => d.role !== 'drive' && d.role !== 'support').reduce((a, c) => a + def(c).mass, 0); }
function driveProblem() { // AA-E5a, AA-F2
  const dc = driveCard();
  if (!dc) return 'No drive aboard';
  if (dc.glitched) return 'Drive is glitched';
  const sup = supplies();
  const miss = def(dc).requires.filter((k) => !sup.has(k));
  if (miss.length) {
    const glitchedSupplier = S.ship.cards.find((c) => c.glitched && c.face === 'white' && (def(c).supplies || []).some((k) => miss.includes(k)));
    if (glitchedSupplier) return `${def(glitchedSupplier).name} is glitched: repair it first (free with Crew)`;
    return `Drive needs ${miss.map(kindLabel).join(', ')}`;
  }
  if (payloadMass() > def(dc).payloadLimit) return `Payload mass ${payloadMass()} is over the drive's limit of ${def(dc).payloadLimit}`;
  return null;
}
const kindLabel = (k) => ({ 'gen-electric': 'an electric generator', 'reactor-fusion': 'a fusion reactor' }[k] || k);
const sysOf = (starId) => S.systems[starId];
const factoriesIn = (starId) => (sysOf(starId) ? sysOf(starId).sites.filter((x) => x.cubes > 0) : []);
function shipPop() { // AA-F5
  return shipCards((d) => d.role === 'payload').reduce((a, c) => a + effectivePop(c), 0);
}
function effectivePop(c) {
  const d = def(c);
  if (d.payloadKind === 'embryo') return S.ship.orbit && factoriesIn(S.ship.orbit).length ? (c.pop || 0) + (c.raised ? 0 : 2) : (c.pop || 0);
  return c.pop || 0;
}
const hasShield = () => working((d) => d.role === 'shield').length > 0;
const hasBrake = (kind) => working((d) => d.role === 'brake' && d.brakeKind === kind).length > 0;
const prospectorCard = () => working((d) => d.role === 'prospector')[0] || null;
const hasSeed = () => shipCards((d) => d.role === 'seed').length > 0;
const owns = (id) => S.holdings.includes(id);
const shipActive = () => S.ship.launched && !S.ship.lost && !S.ship.recycled;

// One Burn step's cost (AA-G3, AA-F3, AA-F1). dir +1 accelerate, -1 brake.
function burnStepCost(dir, V, prop) {
  const dd = driveDef(); if (!dd) return { ok: false, why: 'No drive' };
  const prob = driveProblem(); if (prob) return { ok: false, why: prob };
  const f = dd.family;
  if (dir < 0 && V <= 0) return { ok: false, why: 'Already at V0' };
  if (dir > 0 && V >= TUNE.maxV) return { ok: false, why: 'Top speed' };
  const inBeam = owns('beam') && (S.ship.launched ? (MAP.dist[S.ship.pos] ?? 99) <= TUNE.beamRangeSpaces : true);
  if (f === 'Beam') {
    if (dir < 0) return { ok: false, why: 'A beam sail cannot brake (AA-F1)' };
    if (!owns('beam')) return { ok: false, why: 'Needs your Beam Station in Sol (AA-F3)' };
    if (!inBeam) return { ok: false, why: 'Out of Beam Range (AA-F3)' };
    return { ok: true, aqua: TUNE.beamBurnAqua, prop: 0 };
  }
  if (f === 'Ramscoop') {
    if (dir < 0) return { ok: true, aqua: 0, prop: 0, note: 'scoop drag' };
    if (V >= 2) return { ok: true, aqua: 0, prop: 0, note: 'scooping' };
    if (!owns('beam') || !inBeam) return { ok: false, why: 'A ramscoop needs V2 to light; below that only your Beam Station can push it' };
    return { ok: true, aqua: TUNE.beamBurnAqua, prop: 0, note: 'beam ignition' };
  }
  if (dir < 0 && dd.brake !== true) return { ok: false, why: `${dd.name} cannot brake: use brakes, icebraking or a fryby (AA-F6)` };
  const cost = dd.fuel * classFor(totalMass(prop)).x;
  if (prop < cost) return { ok: false, why: `Needs ${cost} propellant, ${prop} aboard` };
  return { ok: true, aqua: 0, prop: cost };
}
function burnBudget() { // how many accelerate steps, then how many after?
  let p = S.ship.prop, V = S.ship.V, n = 0, aqua = S.aqua;
  for (let i = 0; i < 12; i++) { const c = burnStepCost(+1, V, p); if (!c.ok || aqua < c.aqua) break; p -= c.prop; aqua -= c.aqua; V++; n++; }
  return n;
}
function totalBurns() { // all Burns the propellant pays for, either direction (for display)
  const dd = driveDef(); if (!dd || ['Beam', 'Ramscoop'].includes(dd.family)) return null;
  let p = S.ship.prop, n = 0;
  while (n < 40) { const cost = dd.fuel * classFor(totalMass(p)).x; if (p < cost || cost <= 0) break; p -= cost; n++; }
  return n;
}

// ================================================================ systems (AA-B7, AA-B7a)
function drawChit(pool) { const p = S.pools[pool]; if (!p.length) S.pools[pool] = poolFrom(pool === 'comp' ? COMP_POOL : HZ_POOLS[pool]); return S.pools[pool].pop(); }
const SPEC = ['C', 'S', 'M', 'V'];
function explore(starId, how) { // AA-G12
  const st = S.stars[starId]; if (st.explored) return false;
  const star = STAR_BY_ID[starId];
  st.explored = true; st.how = how; S.explorations++;
  if (star.type !== 'brown') {
    let c = drawChit(star.type);
    if (c === 'None' && star.known) { c = drawChit(star.type); }
    st.hz = c;
  }
  st.comps = star.comp.map((k) => ({ kind: k, chit: drawChit('comp') }));
  // stellar companions (SM-1e): a sun or red dwarf draws its own habitable-zone
  // chit (a known planet is never "No world"); a white or brown dwarf a companion chit
  st.stars = (star.stars || []).map((c) => {
    if (c.type !== 'yellow' && c.type !== 'red') return { ...c, chit: drawChit('comp') };
    let ch = drawChit(c.type); if (ch === 'None' && c.known) ch = drawChit(c.type); if (ch === 'None' && c.known) ch = 'Hostile';
    return { ...c, chit: ch };
  });
  S.systems[starId] = genSystem(starId);
  const found = bodiesOf(starId).map((b) => `${b.body} (${b.kind === 'ocean' ? 'buried ocean' : b.cls})`);
  log(`Explored ${star.name} by ${how}: ${found.length ? found.join(', ') : 'no worlds of note'}. +1 VP (AA-G12).`, 'good');
  return true;
}
function genSystem(starId, keep = null) { // AA-B7a: built by the system map rules (systems.js -> mapgen)
  const st = S.stars[starId];
  const oldHz = keep && keep.find((x) => (x.role === 'hz') || x.id === 'hz');
  const keptName = oldHz ? String(oldHz.body || oldHz.name).split(':')[0] : null;
  if (!st.stars) st.stars = (STAR_BY_ID[starId].stars || []).map((c) => ({ ...c, chit: c.known ? 'Hostile' : 'None' })); // older saves
  return buildSystem({ star: STAR_BY_ID[starId], chits: { hz: st.hz, comps: st.comps, stars: st.stars }, rint, worldName: () => keptName || S.worldNames.pop() || 'World', keep });
}
// Saved games keep each system's map; rebuild older ones in the current layout,
// carrying their claims, cubes, colonies and terraform progress across.
function migrateSystems() {
  for (const [starId, sys] of Object.entries(S.systems || {})) {
    if (sys.layout === SYSTEM_LAYOUT) continue;
    const fresh = genSystem(starId, sys.sites);
    Object.assign(sys, { nodes: fresh.nodes, edges: fresh.edges, sites: fresh.sites, display: fresh.display, stars: fresh.stars, zones: fresh.zones, layout: SYSTEM_LAYOUT });
    if (S.ship.orbit === starId && !sys.nodes.some((n) => n.id === S.ship.sysNode)) S.ship.sysNode = 'high';
    delete _sysData[starId]; delete _adjCache[starId];
  }
}
const siteById = (starId, id) => sysOf(starId)?.sites.find((x) => x.id === id);
// one entry per body (a world's regions share it): its primary region
const bodiesOf = (starId) => (sysOf(starId) ? sysOf(starId).sites.filter((x) => x.primary && (x.kind === 'world' || x.kind === 'ocean' || x.kind === 'moon')) : []);
const _adjCache = {};
function sysAdjMap(starId) {
  const sys = sysOf(starId);
  const c = _adjCache[starId];
  if (c && c.edges === sys.edges) return c.map;
  const map = {};
  for (const [a, b] of sys.edges) { (map[a] = map[a] || []).push(b); (map[b] = map[b] || []).push(a); }
  _adjCache[starId] = { edges: sys.edges, map };
  return map;
}
const sysAdj = (starId, id) => sysAdjMap(starId)[id] || [];
function sysPathCost(starId, from, to) { // entering a magenta burn pad costs 1 burn, as on Sol
  const kind = {}; for (const n of sysOf(starId).nodes) kind[n.id] = n.kind;
  const adj = sysAdjMap(starId);
  const dist = { [from]: 0 }, prev = {}, done = new Set(), open = [from];
  while (open.length) {
    let bi = 0; for (let i = 1; i < open.length; i++) if (dist[open[i]] < dist[open[bi]]) bi = i;
    const best = open.splice(bi, 1)[0];
    if (done.has(best)) continue; done.add(best);
    if (best === to) break;
    for (const nb of adj[best] || []) {
      const nd = dist[best] + (kind[nb] === 'burn' ? 1 : 0);
      if (dist[nb] == null || nd < dist[nb]) { dist[nb] = nd; prev[nb] = best; open.push(nb); }
    }
  }
  if (dist[to] == null) return null;
  const path = [to]; while (path[0] !== from) path.unshift(prev[path[0]]);
  return { cost: dist[to], path };
}
function canSysMove(starId, to) { // AA-B7b
  const sh = S.ship; const f = family();
  if (!shipActive() || sh.orbit !== starId) return { ok: false, why: 'not here' };
  if (!['Pulse', 'Fusion', 'Antimatter'].includes(f)) return { ok: false, why: 'this drive cannot maneuver in a system' };
  const prob = driveProblem(); if (prob) return { ok: false, why: prob };
  const pc = sysPathCost(starId, sh.sysNode, to); if (!pc) return { ok: false, why: 'no route' };
  const used = sh.sysBurnsGen === S.gen ? sh.sysBurns : 0;
  const thrust = driveDef().thrust;
  if (used + pc.cost > thrust) {
    // multi-Generation trip, as on Sol: how far along the route this Generation's thrust reaches
    const kind = {}; for (const n of sysOf(starId).nodes) kind[n.id] = n.kind;
    let b = 0, stop = 0;
    for (let i = 1; i < pc.path.length; i++) { const add = kind[pc.path[i]] === 'burn' ? 1 : 0; if (used + b + add > thrust) break; b += add; stop = i; }
    let p2 = sh.prop, cost2 = 0;
    for (let i = 0; i < b; i++) { const c = driveDef().fuel * classFor(totalMass(p2)).x; cost2 += c; p2 -= c; }
    const partial = stop > 0 && cost2 <= sh.prop ? { node: pc.path[stop], burns: b, cost: cost2, path: pc.path.slice(0, stop + 1) } : null;
    return { ok: false, why: `${pc.cost} burns; Thrust ${thrust} per Generation (${used} used)`, burns: pc.cost, partial };
  }
  let p = sh.prop, cost = 0;
  for (let i = 0; i < pc.cost; i++) { const c = driveDef().fuel * classFor(totalMass(p)).x; cost += c; p -= c; }
  if (cost > sh.prop) return { ok: false, why: `needs ${cost} ${f}`, burns: pc.cost };
  return { ok: true, burns: pc.cost, cost, path: pc.path };
}
const rolesIn = (starId) => {
  const sys = sysOf(starId); const roles = {}; if (!sys) return roles;
  for (const c of sys.landfall) { const r = def(c).lf.role; if (r) roles[r] = (roles[r] || 0) + 1; }
  return roles;
};
function domeCap(starId) {
  const sys = sysOf(starId); if (!sys) return 0;
  const bonus = S.spinoffs.filter((x) => x === 'domeCap').length;
  return sys.landfall.filter((c) => def(c).lf.role === 'Dome').reduce((a, c) => a + (def(c).lf.cap || TUNE.domeCapDefault) + bonus, 0);
}
const isOpen = (site) => site.kind === 'world' && site.step >= 3; // Habitable or Garden (AA-H7, AA-H10)
function domedPop(starId) { return sysOf(starId).sites.filter((x) => x.pop > 0 && !isOpen(x)).reduce((a, x) => a + x.pop, 0); }
const colonySystems = () => Object.keys(S.systems).filter((id) => S.systems[id].sites.some((x) => x.pop > 0));
const hasLander = (starId) => rolesIn(starId).Lander > 0 || S.spinoffs.includes('aerospace');

// ================================================================ turn economy
function frontierOpsFor() { // AA-D1: one per ship still flying or parked, one per colony system
  return (shipActive() ? 1 : 0) + colonySystems().length;
}
function startGeneration() {
  S.gen++;
  S.ops = { home: 1, frontier: frontierOpsFor(), boosted: false, prospected: false };
  S.event = null;
  if (S.ship.launched && !S.ship.lost && S.ship.cards.length) rollEvent();
}
function rollEvent() { // AA-G7
  const r = d6(); const ev = EVENTS[r]; S.event = { r, ...ev };
  let note = '';
  if (r === 1) { if (hasShield()) note = 'The shield stops it.'; else if (S.ship.prop > 0) { S.ship.prop--; note = 'Lost 1 propellant.'; } else note = 'No propellant to lose.'; }
  if (r === 2) { const ring = shipCards((d) => d.payloadKind === 'ring').find((c) => c.pop > 0); if (ring) { ring.pop--; note = 'The Habitat Ring loses 1 Population.'; } else note = 'No Habitat Ring aboard.'; }
  if (r === 3) { const ok = S.ship.cards.filter((c) => !c.glitched && c.face === 'white'); if (ok.length) { const c = ok[rint(0, ok.length - 1)]; c.glitched = true; note = `${def(c).name} glitched.`; } }
  if (r === 5) { S.event.flipFree = true; note = 'Flip any one card aboard to its Landfall side, free.'; }
  if (r === 6) { const ring = shipCards((d) => d.payloadKind === 'ring').find((c) => c.pop < 4); if (ring) { ring.pop++; note = 'The Habitat Ring gains 1 Population.'; } else note = 'No Habitat Ring with room.'; }
  S.event.note = note;
  log(`Generation event (rolled ${r}): ${ev.name}. ${note}`, r === 4 ? '' : r >= 5 ? 'good' : 'bad');
}
function spendHome(label) {
  if (S.ops.home < 1) { toast('Your Home operation this turn is spent.'); return false; }
  S.ops.home--; return true;
}
function spendFrontier() {
  if (S.ops.frontier < 1) { toast('No Frontier operations left this Generation.'); return false; }
  S.ops.frontier--; return true;
}

// ================================================================ modal + toast
function modal({ title, body, buttons = [{ label: 'OK', value: true, primary: true }], wide }) {
  return new Promise((resolve) => {
    const back = h('div', { class: 'aa-modal-back' });
    const box = h('div', { class: 'aa-modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' },
      h('h3', {}, title),
      typeof body === 'string' ? h('div', { class: 'aa-modal-body', html: body }) : h('div', { class: 'aa-modal-body' }, body),
      h('div', { class: 'aa-modal-btns' }, buttons.map((b) => h('button', { class: 'aa-btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), disabled: b.disabled,
        onclick: () => { back.remove(); resolve(b.value); } }, b.label))));
    back.append(box); document.body.append(back);
    const first = box.querySelector('.aa-btn.primary') || box.querySelector('.aa-btn'); first && first.focus();
  });
}
let _toastT = null;
function toast(msg) {
  let t = $('#aa-toast'); if (!t) { t = h('div', { id: 'aa-toast', role: 'status' }); document.body.append(t); }
  t.textContent = msg; t.classList.add('show'); clearTimeout(_toastT); _toastT = setTimeout(() => t.classList.remove('show'), 3200);
}
async function rollDice(label, target, rule) {
  const r = d6();
  log(`${label}: rolled ${r}${target ? ` (${target})` : ''}${rule ? ` ${rule}` : ''}.`);
  return r;
}

// ================================================================ card rendering
const TYPE_MAP = { drive: 'gw-thruster', brake: 'radiator', payload: 'freighter', prospector: 'robonaut', seed: 'refinery', support: 'generator', shield: 'radiator' };
function renderInst(c, opts = {}) {
  const d = def(c);
  const props = [];
  if (d.raygun) props.push({ key: 'raygun', glyph: '🔫', label: 'Raygun', value: true });
  if (d.isru != null) props.push({ key: 'isru', glyph: '🛢', label: 'ISRU rig', value: d.isru });
  const blurbW = [d.blurb, d.payloadKind ? `Population ${c.pop != null ? c.pop : d.pop}.` : '', d.role === 'drive' ? `${FAMILY_GLYPH[d.family]} ${d.family}. Payload limit ${d.payloadLimit}.` : ''].filter(Boolean).join(' ');
  const lfRole = d.lf.role ? ` [Terraform: ${d.lf.role}${d.lf.cap ? `, holds ${d.lf.cap}` : ''}]` : '';
  const card = {
    id: `aa-${c.uid}`, name: d.name, type: d.id === 'fusioncore' ? 'reactor' : TYPE_MAP[d.role],
    mass: d.mass, radHardness: d.rad, spectralType: d.spec,
    thrust: d.thrust, fuel: d.fuel, afterburn: 0, fuelType: d.family,
    requires: (d.requires || []).map((k) => ({ kind: k, count: 1 })), supplies: d.supplies || [], properties: props, blurb: blurbW,
    faces: {
      primary: { label: 'Voyage', name: d.name, ability: null, future: null, mass: d.mass, radHardness: d.rad, thrust: d.thrust, fuel: d.fuel, fuelType: d.family,
        requires: (d.requires || []).map((k) => ({ kind: k, count: 1 })), supplies: d.supplies || [], properties: props, blurb: blurbW },
      secondary: { label: 'Landfall', name: d.lf.name, ability: null, future: null, mass: d.lf.mass, radHardness: d.rad, requires: [], supplies: [], properties: [], blurb: d.lf.blurb + lfRole },
    },
  };
  let el;
  const isDrive = d.role === 'drive';
  if (isDrive) { // HF4: a TW thruster is the purple face of the GW card. Voyage = that face.
    card.faces = { primary: { ...card.faces.secondary, label: 'Landfall' }, secondary: { ...card.faces.primary, label: 'TW' } };
  }
  const want = isDrive ? (c.face === 'white' ? 'secondary' : 'primary') : (c.face !== 'white' ? 'secondary' : 'primary');
  try {
    el = renderCard(card, { face: want });
    if (isDrive) el.querySelectorAll('.card-face[data-face="primary"] .card-typebar').forEach((tb) => { tb.textContent = 'LANDFALL'; });
  } catch (e) { el = h('div', { class: 'aa-cardfallback' }, d.name); }
  const wrap = h('div', { class: 'aa-card' + (c.glitched ? ' glitched' : '') + (opts.small ? ' small' : '') }, el);
  if (c.glitched) wrap.append(h('div', { class: 'aa-glitch-badge', title: 'Glitched: inactive until repaired (AA-G7)' }, 'GLITCH'));
  if (opts.actions && opts.actions.length) wrap.append(h('div', { class: 'aa-card-acts' }, opts.actions));
  return wrap;
}

// ================================================================ HOME operations (AA-S2)
async function opIncome() {
  if (!spendHome()) return;
  const n = 1 + (owns('market') ? 1 : 0);
  S.aqua += n; log(`Income: +${n} Aqua (AA-S2a).`); commit();
}
async function opResearch(target = 'hand') {
  // AA-S2b (Home, aqua) / AA-H9e (Frontier, replicator cubes into blueprints)
  const counts = Object.fromEntries(Object.keys(DECKS).map((k) => [k, 0]));
  const frontier = target !== 'hand';
  const sys = frontier ? sysOf(target) : null;
  const cubesAvail = frontier ? factoriesIn(target).reduce((a, x) => a + x.cubes, 0) : 0;
  const body = h('div', {});
  const cost = () => Object.values(counts).reduce((a, b) => a + b, 0) * TUNE.researchCost;
  const costEl = h('p', { class: 'aa-dim' });
  const upd = () => { costEl.textContent = frontier ? `Cost: ${cost()} replicator cubes (${cubesAvail} available).` : `Cost: ${cost()} Aqua (you have ${S.aqua}).`; };
  body.append(h('p', {}, frontier ? 'Take top cards of any decks into this system\'s blueprints, 1 replicator cube each (AA-H9e). They can be built by Landfall Production.' : 'Take the top cards of any decks, sight unseen, 1 Aqua each (AA-S2b).'));
  const grid = h('div', { class: 'aa-research' });
  for (const role of Object.keys(DECKS)) {
    const n = S.decks[role].length;
    const val = h('b', {}, '0');
    grid.append(h('div', { class: 'aa-research-row' }, h('span', {}, `${DECK_LABEL[role]} `, h('small', { class: 'aa-dim' }, `(${n} left)`)),
      h('span', { class: 'aa-stepper' },
        h('button', { class: 'aa-mini', 'aria-label': `fewer ${role}`, onclick: () => { counts[role] = Math.max(0, counts[role] - 1); val.textContent = counts[role]; upd(); } }, '-'),
        val,
        h('button', { class: 'aa-mini', 'aria-label': `more ${role}`, onclick: () => { if (counts[role] < n) counts[role]++; val.textContent = counts[role]; upd(); } }, '+'))));
  }
  body.append(grid, costEl); upd();
  const ok = await modal({ title: frontier ? 'Research (Frontier)' : 'Research', body, buttons: [{ label: 'Cancel', value: false }, { label: 'Take cards', value: true, primary: true }] });
  if (!ok || cost() === 0) return;
  if (!frontier && cost() > S.aqua) { toast('Not enough Aqua.'); return; }
  if (frontier && cost() > cubesAvail) { toast('Not enough replicator cubes.'); return; }
  if (frontier ? !spendFrontier() : !spendHome()) return;
  const got = [];
  for (const [role, n] of Object.entries(counts)) for (let i = 0; i < n; i++) { const id = S.decks[role].pop(); if (id) got.push(id); }
  if (frontier) { payCubes(target, cost()); for (const id of got) sys.blueprints.push(id); }
  else { S.aqua -= cost(); for (const id of got) S.hand.push(inst(id)); }
  log(`Research: took ${got.map((id) => CARD_BY_ID[id].name).join(', ')} for ${cost()} ${frontier ? 'cubes' : 'Aqua'}.`);
  commit();
}
function payCubes(starId, n) { for (const f of factoriesIn(starId)) { const t = Math.min(f.cubes, n); f.cubes -= t; n -= t; if (!n) break; } }
async function opBoost(c) { // AA-S2c: first Boost of the turn is the operation
  const d = def(c);
  if (S.ship.launched) { toast('Your starship has left. Boost reaches only the drydock (AA-E7).'); return; }
  if (S.aqua < d.mass) { toast(`Boosting ${d.name} costs ${d.mass} Aqua.`); return; }
  if (d.role === 'drive' && driveCard()) { toast('The placard holds one Drive. Jettison the current one first.'); return; }
  if (d.role === 'brake' && shipCards((x) => x.role === 'brake').length) { toast('The placard holds one Brake.'); return; }
  if (!S.ops.boosted) { if (!spendHome()) return; S.ops.boosted = true; }
  S.aqua -= d.mass; S.hand = S.hand.filter((x) => x.uid !== c.uid); S.ship.cards.push(c);
  if (d.role === 'drive') S.ship.family = d.family;
  log(`Boost: ${d.name} to the drydock for ${d.mass} Aqua${S.ops.boosted ? '' : ''} (AA-S2c).`); commit();
}
async function opExpand() {
  const body = h('div', { class: 'aa-hold-pick' });
  let choice = null;
  for (const hd of HOLDINGS) {
    const own = owns(hd.id);
    body.append(h('button', { class: 'aa-pick', disabled: own || S.aqua < hd.cost, onclick: (e) => { choice = hd.id; body.querySelectorAll('.aa-pick').forEach((b) => b.classList.remove('sel')); e.currentTarget.classList.add('sel'); } },
      h('b', {}, hd.name), h('span', {}, `${hd.cost} Aqua - ${hd.desc} - ${hd.vp} VP`), own ? h('em', {}, 'Owned') : null));
  }
  const ok = await modal({ title: 'Expand: buy a Holding (AA-S3)', body, buttons: [{ label: 'Cancel', value: false }, { label: 'Buy', value: true, primary: true }] });
  if (!ok || !choice) return;
  const hd = HOLDINGS.find((x) => x.id === choice);
  if (!spendHome()) return;
  S.aqua -= hd.cost; S.holdings.push(hd.id); log(`Expand: bought ${hd.name} for ${hd.cost} Aqua.`); commit();
}
async function opProduce() { // AA-S2e
  if (S.ship.launched) { toast('Follow-on launches are not in this prototype, so there is nothing to fill.'); return; }
  const f = family(); if (!f) { toast('Boost a Drive first: propellant is per drive family.'); return; }
  const srcs = Object.entries(SOURCES).filter(([id, src]) => src.family === f && owns(id));
  if (!srcs.length) { toast(f === 'Beam' || f === 'Ramscoop' ? `${f} drives carry no propellant (AA-F1).` : `Expand into a Sol Source for ${f} first (AA-E3).`); return; }
  const [id, src] = srcs.sort((a, b) => b[1].yield / b[1].cost - a[1].yield / a[1].cost)[0];
  if (S.aqua < src.cost) { toast(`${src.name} costs ${src.cost} Aqua.`); return; }
  if (!spendHome()) return;
  S.aqua -= src.cost; S.ship.prop += src.yield; log(`Produce: ${src.name}, ${src.cost} Aqua for ${src.yield} ${f} (AA-E3).`); commit();
}
async function opLensSurvey() { // AA-S2f
  if (!owns('lens')) { toast('Needs a Lens Observatory Holding.'); return; }
  const range = S.spinoffs.includes('optics') ? 999 : TUNE.lensRangeSpaces;
  const cands = STARS.filter((st) => !S.stars[st.id].explored && (MAP.dist[st.id] ?? 99) <= range);
  if (!cands.length) { toast('No unexplored star within lens range.'); return; }
  const body = h('div', { class: 'aa-hold-pick' }); let choice = null;
  for (const st of cands) body.append(h('button', { class: 'aa-pick', onclick: (e) => { choice = st.id; body.querySelectorAll('.aa-pick').forEach((b) => b.classList.remove('sel')); e.currentTarget.classList.add('sel'); } }, h('b', {}, st.name), h('span', {}, `${MAP.dist[st.id]} spaces from Sol`)));
  const ok = await modal({ title: 'Lens Survey', body, buttons: [{ label: 'Cancel', value: false }, { label: 'Survey', value: true, primary: true }] });
  if (!ok || !choice) return;
  if (!spendHome()) return;
  explore(choice, 'Lens Survey from Sol'); commit();
}
async function opTransmit() { // AA-S2g
  if (!S.ship.launched) { toast('Nothing has left Sol yet.'); return; }
  const targets = Object.keys(S.systems).filter((id) => S.ship.orbit === id || sysOf(id).sites.some((x) => x.pop > 0 || x.cubes > 0));
  if (!targets.length) { toast('Transmit needs a starship in orbit or a colony to receive it.'); return; }
  if (!S.hand.length) { toast('Your Hand is empty: Research first.'); return; }
  const body = h('div', { class: 'aa-hand-pick' }); let choice = null;
  for (const c of S.hand) { const el = renderInst(c, { small: true }); el.classList.add('pickable'); el.onclick = () => { choice = c.uid; body.querySelectorAll('.aa-card').forEach((x) => x.classList.remove('sel')); el.classList.add('sel'); }; body.append(el); }
  const ok = await modal({ title: `Transmit a design to ${STAR_BY_ID[targets[0]].name}`, body, wide: true, buttons: [{ label: 'Cancel', value: false }, { label: 'Transmit', value: true, primary: true }] });
  if (!ok || !choice) return;
  if (!spendHome()) return;
  const c = S.hand.find((x) => x.uid === choice);
  S.pending.push({ id: c.id, star: targets[0], gen: S.gen + 1 });
  log(`Transmit: the ${def(c).name} design is on its way to ${STAR_BY_ID[targets[0]].name}; it arrives next Generation (AA-G10b). The card stays in Sol.`);
  commit();
}

// ================================================================ LAUNCH (AA-E5, AA-E7)
function launchChecks() {
  const prob = driveProblem();
  const firstBurn = burnStepCost(+1, 0, S.ship.prop);
  return [
    { ok: !prob, text: prob ? prob : 'Drive operational', id: 'E5a' },
    { ok: shipPop() >= 1, text: `Payload with Population (${shipPop()})`, id: 'E5b' },
    { ok: hasSeed(), text: 'Seed aboard', id: 'E5c' },
    { ok: firstBurn.ok && S.aqua >= (firstBurn.aqua || 0), text: firstBurn.ok ? 'Propellant for the launch Burn' : firstBurn.why, id: 'E5d' },
  ];
}
async function opLaunch() {
  if (S.ops.home < 1) { toast('Launch is your Home operation, and it is spent this turn.'); return; }
  const checks = launchChecks();
  if (checks.some((c) => !c.ok)) { await modal({ title: 'Not ready to launch', body: `<ul class="aa-check">${checks.map((c) => `<li class="${c.ok ? 'ok' : 'no'}">${c.ok ? '✓' : '✗'} ${c.text} <small>${c.id}</small></li>`).join('')}</ul>` }); return; }
  // exit (AA-E7)
  const exitBody = h('div', { class: 'aa-hold-pick' }); let exit = null;
  const EXITS = [
    ['jsj', 'Jupiter-Sol-Jupiter Exit', '+1 V free on launch (no propellant). You must lose it again before arrival.'],
    ['neptune', 'Sol Exit Neptune', 'Ignore Dust spaces on your first path out.'],
    ['oort', 'Sol Exit Oort', '+2 propellant from comet ice (Pulse and Fusion only).'],
  ];
  for (const [id, nm, tx] of EXITS) exitBody.append(h('button', { class: 'aa-pick', onclick: (e) => { exit = id; exitBody.querySelectorAll('.aa-pick').forEach((b) => b.classList.remove('sel')); e.currentTarget.classList.add('sel'); } }, h('b', {}, nm), h('span', {}, tx)));
  if (!(await modal({ title: 'Choose your exit (AA-E7)', body: exitBody, buttons: [{ label: 'Cancel', value: false }, { label: 'Next', value: true, primary: true }] })) || !exit) return;
  // first path
  const pathBody = h('div', { class: 'aa-hold-pick' }); let path = null;
  for (const nb of MAP.adj.sol) {
    const lt = leadsTo('sol', nb);
    const dest = MAP.nodes[lt.node];
    const via = dest.kind === 'junction' ? MAP.adj[lt.node].filter((x) => leadsTo(lt.node, x).node !== 'sol').map((x) => nodeName(leadsTo(lt.node, x).node)).join(' or ') : '';
    pathBody.append(h('button', { class: 'aa-pick', onclick: (e) => { path = nb; pathBody.querySelectorAll('.aa-pick').forEach((b) => b.classList.remove('sel')); e.currentTarget.classList.add('sel'); } },
      h('b', {}, dest.kind === 'junction' ? `Toward ${via}` : `Toward ${dest.label}`), h('span', {}, dest.kind === 'junction' ? `${lt.steps} spaces to a junction` : `${lt.steps} spaces`)));
  }
  if (!(await modal({ title: 'Choose your path out of Sol (AA-G2)', body: pathBody, buttons: [{ label: 'Cancel', value: false }, { label: 'Launch', value: true, primary: true }] })) || !path) return;
  spendHome();
  const sh = S.ship;
  sh.launched = true; sh.exit = exit; sh.next = path; sh.pos = 'sol'; sh.prev = null;
  if (exit === 'oort' && ['Pulse', 'Fusion'].includes(family())) sh.prop += 2;
  if (exit === 'neptune') sh.ignoreDust = true;
  const c = burnStepCost(+1, 0, sh.prop); sh.prop -= c.prop; S.aqua -= c.aqua; sh.V = 1;
  if (exit === 'jsj') sh.V += 1;
  log(`LAUNCH by the ${EXITS.find((x) => x[0] === exit)[1]}, toward ${nodeName(leadsTo('sol', path).node)}. Launch Burn to V1${exit === 'jsj' ? ', solar Oberth to V2' : ''} (AA-E7).`, 'good');
  S.phase = 'voyage'; S.turn = 0;
  startGeneration();
  commit();
  setTab('map');
}

// ================================================================ FRONTIER operations
async function opBurn() { // AA-G3
  const sh = S.ship; const dd = driveDef();
  if (!shipActive()) return;
  let steps = 0; const body = h('div', {}); const info = h('div', { class: 'aa-burn-info' });
  const upd = () => {
    let p = sh.prop, V = sh.V, aqua = S.aqua, lines = [], ok = true;
    for (let i = 0; i < Math.abs(steps); i++) {
      const c = burnStepCost(Math.sign(steps), V, p);
      if (!c.ok) { lines.push(`Step ${i + 1}: ${c.why}`); ok = false; break; }
      if (aqua < c.aqua) { lines.push(`Step ${i + 1}: needs ${c.aqua} Aqua`); ok = false; break; }
      p -= c.prop; aqua -= c.aqua; V += Math.sign(steps);
      lines.push(`Step ${i + 1}: V${V}, ${c.prop ? `${c.prop} ${dd.family}` : c.aqua ? `${c.aqua} Aqua (beam)` : 'free'}${c.note ? ` (${c.note})` : ''}`);
    }
    info.innerHTML = `<div class="aa-big">V${sh.V} to <b>V${V}</b></div><div class="aa-dim">${lines.join('<br>') || 'Choose how many steps.'}</div><div class="aa-dim">Thrust ${dd.thrust}: up to ${dd.thrust} steps. Each step costs Fuel ${dd.fuel} x weight class, recomputed as propellant burns off (AA-F4).</div>`;
    btnOk.disabled = !ok || steps === 0;
  };
  const btnOk = h('button', { class: 'aa-btn primary', onclick: () => done(true) }, 'Burn');
  const stepper = h('div', { class: 'aa-stepper big' },
    h('button', { class: 'aa-mini', 'aria-label': 'brake', onclick: () => { steps = Math.max(-dd.thrust, steps - 1); upd(); } }, '- brake'),
    h('button', { class: 'aa-mini', 'aria-label': 'accelerate', onclick: () => { steps = Math.min(dd.thrust, steps + 1); upd(); } }, '+ accelerate'));
  body.append(stepper, info);
  let done;
  const p = new Promise((r) => { done = r; });
  const back = h('div', { class: 'aa-modal-back' }, h('div', { class: 'aa-modal', role: 'dialog' }, h('h3', {}, `Burn: ${dd.name}`), body, h('div', { class: 'aa-modal-btns' }, h('button', { class: 'aa-btn', onclick: () => done(false) }, 'Cancel'), btnOk)));
  document.body.append(back); upd();
  const go = await p; back.remove();
  if (!go || !steps) return;
  if (!spendFrontier()) return;
  for (let i = 0; i < Math.abs(steps); i++) { const c = burnStepCost(Math.sign(steps), sh.V, sh.prop); sh.prop -= c.prop; S.aqua -= c.aqua; sh.V += Math.sign(steps); }
  if (sh.orbit && sh.V > 0) {
    // leaving orbit: pick a path out (AA-G4)
    const opts = MAP.adj[sh.orbit];
    sh.next = opts.length === 1 ? opts[0] : await chooseBranch(sh.orbit, opts, 'Leave orbit along which path?');
    sh.pos = sh.orbit; sh.prev = null; sh.orbit = null; sh.sysNode = null;
    log(`Burn: V${sh.V}. Leaving orbit toward ${nodeName(leadsTo(sh.pos, sh.next).node)}.`);
  } else {
    log(`Burn: now V${sh.V} (AA-G3).`);
    // Braking to V0 on a Star space, or in the Oort cloud next to one, is Orbit (AA-G4, AA-F6a).
    const nd = MAP.nodes[sh.pos];
    if (sh.V === 0 && !sh.orbit && nd.kind === 'star') await enterOrbit(nd.star);
    else if (sh.V === 0 && !sh.orbit && nd.kind === 'oort' && nd.of !== 'sol') await enterOrbit(nd.of);
  }
  commit();
}
async function chooseBranch(at, opts, title) {
  const body = h('div', { class: 'aa-hold-pick' }); let choice = null;
  for (const o of opts) {
    const lt = leadsTo(at, o);
    body.append(h('button', { class: 'aa-pick', onclick: (e) => { choice = o; body.querySelectorAll('.aa-pick').forEach((b) => b.classList.remove('sel')); e.currentTarget.classList.add('sel'); } },
      h('b', {}, `Toward ${nodeName(lt.node)}`), h('span', {}, `${lt.steps} spaces`)));
  }
  while (!choice) { await modal({ title, body, buttons: [{ label: 'Go', value: true, primary: true }] }); }
  return choice;
}
async function opProspect(site, free) { // AA-G11
  const sh = S.ship; const pc = prospectorCard(); const pd = pc && def(pc);
  if (!pd) { toast('No working Prospector aboard.'); return; }
  if (!pd.raygun && sh.sysNode !== site.node) { toast(`${pd.name} must be at the site: move there first.`); return; }
  if (site.claimed) { toast('Already claimed.'); return; }
  const freeScan = pd.raygun && S.ops.prospected;
  if (!free && !freeScan && !spendFrontier()) return;
  if (!free) S.ops.prospected = true;
  if (pd.isru > site.hyd) { log(`Prospect ${site.name}: ISRU ${pd.isru} is above its Hydration ${site.hyd}. No claim (AA-G11).`, 'bad'); commit(); return; }
  if (site.size > 5) { site.claimed = true; log(`Prospect ${site.name}: Size ${site.size} is over 5, claimed automatically.`, 'good'); commit(); return; }
  const r = await rollDice(`Prospect ${site.name}`, `need ${site.size} or less`);
  if (r <= site.size) { site.claimed = true; log(`Claimed ${site.name}.`, 'good'); } else log(`No claim at ${site.name}.`, 'bad');
  commit();
}
async function opDeploySeed(site) { // AA-H3
  const seed = shipCards((d) => d.role === 'seed')[0];
  if (!seed) { toast('No Seed aboard.'); return; }
  if (!site.claimed) { toast('Claim the site first (Prospect).'); return; }
  if (!spendFrontier()) return;
  S.ship.cards = S.ship.cards.filter((c) => c.uid !== seed.uid);
  site.cubes = 1;
  log(`Seed deployed at ${site.name}: 1 Replicator cube. It doubles every Generation up to Size ${site.size} (AA-H3, AA-H4).`, 'good');
  commit();
}
async function opFoundColony(site) { // AA-H7
  const sh = S.ship; const starId = sh.orbit;
  if (!site.claimed) { toast('Claim the world first.'); return; }
  if (!(site.kind === 'world' || site.kind === 'ocean' || site.kind === 'moon')) { toast('Mines are never homes (AA-H2).'); return; }
  if (sh.sysNode !== site.node && !hasLander(starId)) { toast('Move the ship to the world, or build a Lander there first.'); return; }
  const open = isOpen(site);
  const room = open ? 99 : domeCap(starId) - domedPop(starId);
  if (!open && room <= 0) { toast(`${site.name} is ${site.cls}: settlers need a Dome there (build one by Landfall Production) (AA-H7).`); return; }
  const avail = shipPop();
  if (avail < 1) { toast('No Population aboard to land.'); return; }
  const n = Math.min(avail, room);
  if (!spendFrontier()) return;
  let left = n;
  for (const c of shipCards((d) => d.role === 'payload')) {
    if (!left) break;
    if (def(c).payloadKind === 'embryo' && !c.raised && factoriesIn(starId).length) { c.pop = (c.pop || 0) + 2; c.raised = true; }
    const t = Math.min(c.pop || 0, left); c.pop -= t; left -= t;
  }
  site.pop += n;
  log(`Colony founded on ${site.name}: ${n} Population ${open ? 'in the open' : 'under a Dome'} (AA-H7).`, 'good');
  S.ops.frontier = Math.max(S.ops.frontier, 0);
  commit();
}
async function opSkim() { // AA-G13
  if (family() !== 'Fusion') { toast('Only Fusion drives burn what a gas giant gives.'); return; }
  if (!spendFrontier()) return;
  S.ship.prop += TUNE.skimYield; log(`Skim: +${TUNE.skimYield} Fusion pellets from the gas giant (AA-G13).`, 'good'); commit();
}
async function opBuild(starId) { // AA-H6
  const sys = sysOf(starId);
  const facts = factoriesIn(starId);
  if (!facts.length) { toast('Landfall Production needs a Replicator Factory here.'); return; }
  const items = [];
  if (S.ship.orbit === starId) for (const c of S.ship.cards.filter((x) => x.face === 'white' || x.face === 'landfallAboard')) items.push({ src: 'ship', c });
  sys.blueprints.forEach((id, i) => items.push({ src: 'bp', i, c: { uid: -1000 - i, id, face: 'white' } }));
  if (!items.length) { toast('Nothing here to rebuild.'); return; }
  const body = h('div', {}); let choice = null; let factory = null;
  body.append(h('p', { class: 'aa-dim' }, 'Spend Replicator cubes equal to the Landfall side\'s Mass at a factory whose spectral type matches the card (AA-H6). Population must leave a payload card before it is rebuilt.'));
  const list = h('div', { class: 'aa-hand-pick' });
  for (const it of items) {
    const d = def(it.c);
    const match = facts.filter((f) => f.spec === d.spec && f.cubes >= d.lf.mass);
    const blocked = (it.c.pop || 0) > 0 ? 'Still carries Population' : !match.length ? `Needs a ${d.spec} factory with ${d.lf.mass} cubes` : null;
    const el = renderInst(it.c, { small: true });
    el.append(h('div', { class: 'aa-card-note' + (blocked ? ' bad' : '') }, it.src === 'bp' ? 'Blueprint. ' : '', blocked || `${d.lf.mass} cubes at ${match[0].name}`, d.lf.role ? ` - ${d.lf.role}` : ''));
    if (!blocked) { el.classList.add('pickable'); el.onclick = () => { choice = it; factory = match[0]; list.querySelectorAll('.aa-card').forEach((x) => x.classList.remove('sel')); el.classList.add('sel'); }; }
    list.append(el);
  }
  body.append(list);
  const ok = await modal({ title: 'Landfall Production', body, wide: true, buttons: [{ label: 'Cancel', value: false }, { label: 'Build', value: true, primary: true }] });
  if (!ok || !choice) return;
  if (!spendFrontier()) return;
  const d = def(choice.c);
  factory.cubes -= d.lf.mass;
  let card;
  if (choice.src === 'ship') { card = choice.c; S.ship.cards = S.ship.cards.filter((x) => x.uid !== card.uid); }
  else { card = inst(choice.c.id); sys.blueprints.splice(choice.i, 1); }
  card.face = 'landfall'; card.glitched = false; sys.landfall.push(card);
  log(`Landfall Production: ${d.name} becomes ${d.lf.name}${d.lf.role ? ` (${d.lf.role})` : ''} for ${d.lf.mass} cubes (AA-H6).`, 'good');
  if (d.role === 'drive') log('With its drive rebuilt, the starship can no longer move.', 'bad');
  commit();
}
async function opGrow(site) { // AA-H9a
  const starId = S.ship.orbit || site._star;
  const n = S.spinoffs.includes('biotech') ? 2 : 1;
  if (!isOpen(site)) { const room = domeCap(starId) - domedPop(starId); if (room <= 0) { toast('The Domes are full. Build another Dome, or terraform.'); return; } }
  if (!spendFrontier()) return;
  const room = isOpen(site) ? n : Math.min(n, domeCap(starId) - domedPop(starId));
  site.pop += room; log(`Grow: ${site.name} +${room} Population (AA-H9a).`, 'good'); commit();
}
async function opIndustry(site) { // AA-H9b
  if (!spendFrontier()) return;
  site.cubes += TUNE.industryCubes; log(`Industry: +${TUNE.industryCubes} Replicator cubes at ${site.name}, past its Size (AA-H9b).`, 'good'); commit();
}
async function opSettle(starId, site) { // AA-H9c
  const lander = hasLander(starId);
  const cubes = factoriesIn(starId).reduce((a, x) => a + x.cubes, 0);
  if (!lander && cubes < 2) { toast('Settling needs a Lander here, or 2 Replicator cubes to build one.'); return; }
  if (!spendFrontier()) return;
  if (!lander) payCubes(starId, 2);
  site.claimed = true; log(`Settle: claimed ${site.name}${lander ? '' : ' (2 cubes for a lander)'} (AA-H9c).`, 'good'); commit();
}
async function opTerraform(starId, site) { // AA-H10
  if (site.step >= 4) { toast('Already a Garden.'); return; }
  const next = site.step + 1; const tf = TERRAFORM[next];
  const roles = rolesIn(starId);
  const miss = tf.needs.filter((r) => !roles[r]);
  if (miss.length) { toast(`Step ${next} (${tf.reach}) needs Landfall-side: ${miss.join(', ')}.`); return; }
  if (tf.pop && site.pop < tf.pop) { toast(`Garden needs ${tf.pop} Population on ${site.name}.`); return; }
  if (!spendFrontier()) return;
  for (const r of sysOf(starId).sites.filter((x) => x.body === site.body)) r.step = next; // every region of the world
  const so = SPINOFFS[next]; S.spinoffs.push(so.effect);
  log(`Terraform: ${site.name} is now ${tf.reach}. Spin-off: ${so.name} (${so.text}) (AA-H10).`, 'good');
  if (next >= 3) for (const r of sysOf(starId).sites.filter((x) => x.body === site.body)) r.cls = next === 4 ? 'Garden' : 'Habitable';
  commit();
}

// ================================================================ FREE actions
async function freeJettison(c) {
  const ok = await modal({ title: 'Jettison', body: `Decommission <b>${def(c).name}</b>? It is gone for good. A lighter ship burns less per step (AA-F6).`, buttons: [{ label: 'Keep it', value: false }, { label: 'Jettison', value: true, danger: true }] });
  if (!ok) return;
  S.ship.cards = S.ship.cards.filter((x) => x.uid !== c.uid);
  if (def(c).role === 'drive') S.ship.family = null;
  log(`Jettisoned ${def(c).name}.`); commit();
}
function freeRepair(c) { // AA-G7 glitch repair needs Crew
  if (!S.ship.crew) { toast('Repair needs Crew aboard.'); return; }
  c.glitched = false; log(`Crew repaired ${def(c).name}.`); commit();
}
function freeMagsail() { // AA-F6 Magsail: -1 V at the end of any Generation you choose
  if (!hasBrake('magsail')) return;
  if (S.ship.magsailUsedGen === S.gen) { toast('Once per Generation.'); return; }
  if (S.ship.V <= 0) return;
  S.ship.V--; S.ship.magsailUsedGen = S.gen; log(`Magsail: -1 V, now V${S.ship.V} (AA-F6).`); commit();
}
async function freeFlipEvent(c) { // AA-G7 Breakthrough
  if (!S.event || !S.event.flipFree) return;
  S.event.flipFree = false;
  if (S.ship.orbit) { S.ship.cards = S.ship.cards.filter((x) => x.uid !== c.uid); c.face = 'landfall'; c.glitched = false; sysOf(S.ship.orbit).landfall.push(c); }
  else { c.face = 'landfallAboard'; }
  log(`Breakthrough: ${def(c).name} is now ${def(c).lf.name}.`, 'good'); commit();
}
function freeRecycle(site) { // AA-H5
  const dc = driveCard(); if (!dc) return;
  const add = def(dc).mass + Math.floor(S.ship.prop / 6);
  S.ship.cards = S.ship.cards.filter((x) => x.uid !== dc.uid);
  site.cubes += add; S.ship.prop = 0; S.ship.recycled = true;
  log(`Drive recycled into ${add} Replicator cubes at ${site.name}. The starship will never move again (AA-H5).`, 'good');
  S.ops.frontier = Math.max(0, S.ops.frontier - 0);
  commit();
}
async function freeSysMove(toNode, { toward = false } = {}) { // AA-B7b: in-system moves pay propellant per burn
  const sh = S.ship; const starId = sh.orbit;
  let c = canSysMove(starId, toNode);
  if (!c.ok && toward && c.partial) { c = { ok: true, ...c.partial }; toNode = c.node; } // as far as thrust allows this Generation
  if (!c.ok) { toast(`Can't move there: ${c.why}.`); return; }
  if (sh.sysBurnsGen !== S.gen) { sh.sysBurnsGen = S.gen; sh.sysBurns = 0; }
  sh.prop -= c.cost; sh.sysBurns += c.burns; sh.sysNode = toNode;
  const sys = sysOf(starId);
  const kindOf = Object.fromEntries(sys.nodes.map((n) => [n.id, n.kind]));
  const hz = c.path.slice(1).filter((id) => kindOf[id] === 'radhaz').length;
  const label = siteById(starId, toNode)?.name || sys.nodes.find((n) => n.id === toNode)?.label || 'there';
  log(`Moved to ${label} in ${c.burns} burn${c.burns === 1 ? '' : 's'}${c.cost ? ` (${c.cost} ${family()})` : ''} (AA-B7b).`);
  for (let i = 0; i < hz; i++) { // AA-B7c radiation belts
    const r = d6(); log(`Radiation belt: rolled ${r} (AA-B7c).`);
    if (r === 1) await loseLowestRad('Radiation belt');
  }
  commit();
}

// ================================================================ END OF TURN
let BUSY = false;
async function endTurn() {
  if (S.over || BUSY) return;
  BUSY = true; render();
  try { await endTurnInner(); } finally { BUSY = false; render(); }
}
async function endTurnInner() {
  if (S.phase === 'drydock') { // AA-D2
    if (S.ops.home > 0) { const ok = await modal({ title: 'End turn?', body: 'You have not used your Home operation.', buttons: [{ label: 'Back', value: false }, { label: 'End turn', value: true, primary: true }] }); if (!ok) return; }
    S.turn++;
    if (S.turn > TUNE.launchWindow) { log('The Launch Window closed with the starship still in the drydock. GROUNDED (AA-D2).', 'bad'); gameOver('Grounded'); return; }
    S.ops = { home: 1, frontier: 0, boosted: false, prospected: false };
    log(`Drydock turn ${S.turn} of ${TUNE.launchWindow}.`); commit(); return;
  }
  // Generation end sequence
  const sh = S.ship;
  if (shipActive() && !sh.orbit && sh.V > 0) await ballisticMove();
  // AA-H4 replication + Governor
  for (const [starId, sys] of Object.entries(S.systems)) {
    for (const site of sys.sites) {
      if (site.cubes <= 0) continue;
      if (site.cubes < site.size) { const before = site.cubes; site.cubes = Math.min(site.cubes * 2, site.size); if (site.cubes !== before) log(`Replication at ${site.name}: ${before} to ${site.cubes} cubes (AA-H4).`); }
      else {
        const governed = sys.sites.some((x) => x.pop > 0) || (sh.orbit === starId && sh.crew);
        if (!governed) {
          const r = d6();
          log(`Governor check at ${site.name} (no Crew or Colony here): rolled ${r}.`);
          if (r === 1) { site.cubes = 0; site.claimed = false; site.goo = true; log(`GREY GOO. ${site.name} is consumed and can never be claimed again (AA-H4).`, 'bad'); }
        }
      }
    }
  }
  // AA-G10 pulse decay, AA-G10a containment
  if (family() === 'Pulse' && sh.prop >= 6 && sh.launched && !sh.lost) { sh.prop--; log('Pulse decay: 1 bomb in storage is lost (AA-G10).'); }
  if (family() === 'Antimatter' && sh.prop > 0 && sh.launched && !sh.lost) { const r = d6(); if (r === 1) { const lost = Math.ceil(sh.prop / 2); sh.prop -= lost; log(`Containment failure: rolled 1, lost ${lost} antimatter (AA-G10a).`, 'bad'); } }
  // transmissions arrive (AA-S2g)
  for (const p of S.pending.filter((x) => x.gen <= S.gen + 1)) { sysOf(p.star)?.blueprints.push(p.id); log(`The ${CARD_BY_ID[p.id].name} blueprint arrived at ${STAR_BY_ID[p.star].name}.`); }
  S.pending = S.pending.filter((x) => x.gen > S.gen + 1);
  if (S.gen >= TUNE.generations) { gameOver('Time'); return; }
  startGeneration();
  commit();
}
async function ballisticMove() { // AA-G2
  const sh = S.ship;
  let moved = 0;
  setTab('map');
  while (moved < sh.V && !sh.lost && !sh.orbit) {
    let opts = MAP.adj[sh.pos].filter((n) => n !== sh.prev);
    let next;
    if (sh.next && opts.includes(sh.next)) next = sh.next;
    else if (opts.length === 1) next = opts[0];
    else if (!opts.length) {
      log(`${nodeName(sh.pos)} has no path onward. Still at V${sh.V}, the starship flies out into the dark and is lost.`, 'bad');
      sh.lost = true; break;
    } else { render(); next = await chooseBranch(sh.pos, opts, `Junction: which way? (V${sh.V}, ${sh.V - moved} spaces left this Generation)`); }
    sh.prev = sh.pos; sh.pos = next; sh.next = null; moved++;
    await enterSpace(next, sh.V - moved);
    render();
    await new Promise((r) => setTimeout(r, 120));
  }
  if (!sh.lost && !sh.orbit) log(`Coasted ${moved} space${moved === 1 ? '' : 's'} at V${sh.V}; now in ${nodeName(sh.pos)}.`);
}
async function enterSpace(id, remaining) {
  const sh = S.ship; const nd = MAP.nodes[id];
  if (nd.kind === 'dust') { // AA-G8
    if (sh.ignoreDust) log('Dust space: ignored on the Neptune exit path.');
    else { const sc = working((d) => d.role === 'shield')[0]; if (sc) { sc.glitched = true; log(`Dust strike: ${def(sc).name} absorbs it and glitches (AA-G8).`, 'bad'); } else await loseCard('Dust strike (AA-G8)'); }
  }
  if (nd.kind === 'sunlens') { if (explore(nd.target, `sunlens snapshot`)) render(); }
  const inbound = nd.kind === 'oort' && nd.of !== 'sol' && MAP.adj[id].includes(nd.of) && sh.prev !== nd.of;
  if (inbound) {
    // AA-F6 e-sail (space next to a Star space), icebrake
    if (hasBrake('esail') && sh.V > 0) { if (await modal({ title: 'E-sail', body: `The stellar wind of ${STAR_BY_ID[nd.of].name}: lower V by 1, free?`, buttons: [{ label: 'No', value: false }, { label: 'Brake -1 V', value: true, primary: true }] })) { sh.V--; log(`E-sail: -1 V, now V${sh.V}.`); } }
    if (sh.V > 0) {
      const ok = await modal({ title: `Oort cloud of ${STAR_BY_ID[nd.of].name}`, body: `Icebrake: lower V by 1, free. ${hasBrake('magsail') ? 'Your Magsail makes it safe.' : 'Roll 1d6: on a 1, ice debris destroys a card.'} (AA-F6)<br><br>Now V${sh.V}.`, buttons: [{ label: 'Fly on', value: false }, { label: 'Icebrake -1 V', value: true, primary: true }] });
      if (ok) {
        sh.V--; log(`Icebrake in the Oort cloud: now V${sh.V}.`);
        if (!hasBrake('magsail')) { const r = d6(); log(`Icebrake roll: ${r}.`); if (r === 1) await loseCard('Ice debris'); }
      }
    }
    if (sh.V === 0) { log(`Stopped in the Oort cloud of ${STAR_BY_ID[nd.of].name}; the cloud belongs to the star, so you fall into Orbit (AA-F6a).`); await enterOrbit(nd.of); }
  }
  if (nd.kind === 'star') {
    const star = STAR_BY_ID[nd.star];
    explore(nd.star, 'starship');
    render();
    if (star.hazard === 'flare') { const r = d6(); log(`Flare star: rolled ${r} (AA-G9).`); if (r === 1) await loseLowestRad(); }
    if (star.hazard === 'debris') { const r = d6(); log(`Debris disk: rolled ${r} (AA-G9).`); if (r === 1) { const sc = working((d) => d.role === 'shield')[0]; if (sc) { sc.glitched = true; log(`${def(sc).name} absorbs it.`); } else await loseCard('Debris'); } }
    if (driveDef() && driveDef().brake === 'staged' && !sh.stagedUsed && owns('beam') && sh.V > 0) {
      if (await modal({ title: 'Staged sail', body: 'Detach the outer ring and brake on your own beam, -2 V, one time only (AA-F6)?', buttons: [{ label: 'Not here', value: false }, { label: 'Brake -2 V', value: true, primary: true }] })) { sh.V = Math.max(0, sh.V - 2); sh.stagedUsed = true; log(`Staged sail: now V${sh.V}.`); }
    }
    if (sh.V > 0 && (star.comp.some((c) => c === 'gas' || c === 'brown') || (star.stars || []).some((c) => c.type === 'brown'))) {
      if (await modal({ title: 'Fryby', body: `Dive through the ${star.comp.includes('gas') ? 'gas giant' : 'brown dwarf'}'s atmosphere: -1 V, free. Roll 1d6: on a 1 or 2 lose a card (a Shield absorbs it once). Now V${sh.V}. (AA-F6)`, buttons: [{ label: 'No', value: false }, { label: 'Fryby -1 V', value: true, primary: true }] })) {
        sh.V--; const r = d6(); log(`Fryby: now V${sh.V}; rolled ${r}.`);
        if (r <= 2) { const sc = working((d) => d.role === 'shield')[0]; if (sc) { sc.glitched = true; log(`${def(sc).name} absorbs it.`); } else await loseCard('Fryby'); }
      }
    }
    if (sh.V === 0) await enterOrbit(nd.star);
    else await flybyScan(nd.star);
  }
}
async function flybyScan(starId) { // AA-G6
  const pc = prospectorCard(); if (!pc) return;
  const cands = sysOf(starId).sites.filter((x) => !x.claimed && !x.goo);
  if (!cands.length) return;
  const body = h('div', { class: 'aa-hold-pick' }); let choice = null;
  for (const st of cands) body.append(h('button', { class: 'aa-pick', onclick: (e) => { choice = st.id; body.querySelectorAll('.aa-pick').forEach((b) => b.classList.remove('sel')); e.currentTarget.classList.add('sel'); } },
    h('b', {}, st.name), h('span', {}, `${st.cls || 'Mine'}, Size ${st.size}, Hydration ${st.hyd}`)));
  const ok = await modal({ title: `Flyby scan of ${STAR_BY_ID[starId].name}`, body, buttons: [{ label: 'Skip', value: false }, { label: 'Scan', value: true, primary: true }] });
  if (!ok || !choice) return;
  const site = siteById(starId, choice);
  S.ship.sysNode = site.node; // the raygun or missile is on target for this pass
  await opProspect(site, true);
  S.ship.sysNode = null;
}
async function enterOrbit(starId) { // AA-G4
  const sh = S.ship;
  explore(starId, 'starship'); // stopping in its Oort cloud still shows you what orbits it (AA-G12)
  sh.orbit = starId; sh.sysNode = 'high'; sh.V = 0; sh.next = null; sh.pos = starId;
  SYSVIEW = starId; POPUP = null;
  log(`ORBIT at ${STAR_BY_ID[starId].name} (AA-G4).`, 'good');
  if (!S.firstArrival) { S.firstArrival = starId; log('First system entered: +3 VP (AA-I2).', 'good'); }
  for (const c of S.ship.cards.filter((x) => x.face === 'landfallAboard')) { S.ship.cards = S.ship.cards.filter((x) => x.uid !== c.uid); c.face = 'landfall'; sysOf(starId).landfall.push(c); }
  const cryo = shipCards((d) => d.payloadKind === 'cryo').find((c) => !c.thawed);
  if (cryo) { cryo.thawed = true; const r = d6(); log(`Cryo Vault revival roll: ${r}.`); if (r === 1 && cryo.pop > 0) { cryo.pop--; log('One sleeper berth failed: -1 Population (AA-F5).', 'bad'); } }
  setTab('system');
}
async function loseCard(why) {
  const cards = S.ship.cards.filter((c) => c.face === 'white'); if (!cards.length) return;
  const body = h('div', { class: 'aa-hand-pick' }); let choice = null;
  for (const c of cards) { const el = renderInst(c, { small: true }); el.classList.add('pickable'); el.onclick = () => { choice = c.uid; body.querySelectorAll('.aa-card').forEach((x) => x.classList.remove('sel')); el.classList.add('sel'); }; body.append(el); }
  while (!choice) await modal({ title: `${why}: lose a card of your choice`, body, wide: true, buttons: [{ label: 'Lose it', value: true, danger: true }] });
  const c = S.ship.cards.find((x) => x.uid === choice);
  S.ship.cards = S.ship.cards.filter((x) => x.uid !== choice);
  log(`${why}: ${def(c).name} destroyed.`, 'bad');
}
async function loseLowestRad(why = 'Flare') {
  const cards = S.ship.cards.filter((c) => c.face === 'white'); if (!cards.length) return;
  const c = cards.sort((a, b) => def(a).rad - def(b).rad)[0];
  S.ship.cards = S.ship.cards.filter((x) => x.uid !== c.uid);
  log(`${why}: ${def(c).name} (rad hardness ${def(c).rad}) is fried.`, 'bad');
}

// ================================================================ SCORING (AA-I)
function score() {
  const rows = [];
  let tf = 0, popVp = 0, worldVp = 0, sysVp = 0, fact = 0;
  for (const [id, sys] of Object.entries(S.systems)) {
    let any = false;
    for (const x of sys.sites) {
      if (x.kind === 'world' && x.primary && x.step > x.startStep) tf += (TERRAFORM[x.step]?.vp || 0) - (TERRAFORM[x.startStep]?.vp || 0);
      if (x.pop > 0) { popVp += x.pop; worldVp += 2; any = true; }
      if (x.cubes > 0) fact++;
    }
    if (any) sysVp += 3;
  }
  rows.push(['Terraforming you completed', tf, 'H10']);
  rows.push(['Population in Colonies', popVp, 'I2']);
  rows.push(['Worlds with a Colony (2 each)', worldVp, 'I2']);
  rows.push(['Star systems with a Colony (3 each)', sysVp, 'I2']);
  rows.push(['Spin-off tech', S.spinoffs.length, 'H10']);
  rows.push(['Replicator Factories', fact, 'H3']);
  rows.push(['Stars explored', S.explorations, 'G12']);
  rows.push(['Sol Holdings', S.holdings.reduce((a, id) => a + HOLDINGS.find((x) => x.id === id).vp, 0), 'S3']);
  rows.push(['First system entered', S.firstArrival ? 3 : 0, 'I2']);
  const total = rows.reduce((a, r) => a + r[1], 0);
  const band = total >= 35 ? 'New Earth' : total >= 20 ? 'Colony' : total >= 10 ? 'Survivors' : 'Lost in the dark';
  return { rows, total, band };
}
function gameOver(reason) {
  const sc = score(); S.over = { reason, ...sc };
  if (reason === 'Grounded') S.over.band = 'Grounded';
  log(`GAME OVER (${reason}): ${sc.total} VP, ${S.over.band}.`, reason === 'Grounded' ? 'bad' : 'good');
  commit(); showScore();
}
function showScore() {
  const o = S.over || { ...score(), reason: 'so far' };
  const body = `<table class="aa-score">${o.rows.map((r) => `<tr><td>${r[0]} <small>${r[2]}</small></td><td>${r[1]}</td></tr>`).join('')}<tr class="tot"><td>Total</td><td>${o.total}</td></tr></table>
  <p class="aa-band">${o.band}</p><p class="aa-dim">Bands (AA-I3): 0-9 Lost in the dark, 10-19 Survivors, 20-34 Colony, 35+ New Earth.</p>`;
  modal({ title: S.over ? `Game over: ${S.over.reason === 'Time' ? `Generation ${TUNE.generations} has passed` : S.over.reason}` : 'Score so far', body });
}

// ================================================================ RENDER (the HF shell)
// The screen is the HF sandbox screen: the map toolbar on top, the ORIGINAL
// MapRenderer (js/game/render.js) filling the stage, the icon sidepanel on the
// right and the hand strip along the bottom, all styled by the app's own
// css/style.css + css/map.css + css/cards.css. Only the data is Ad Astra's.
let PANE = 'ship';                // open sidepanel pane ('' = closed)
let MAPMODE = 'stars';            // 'stars' | 'system'
let SYSVIEW = null;               // star whose system map is showing
let POPUP = null;                 // { map: 'stars'|starId, id } of the open popup
const MARKS = new Set();          // hand cards marked for BOOST (the HF hand idiom)
const RENDERERS = {};             // key -> { renderer, host, data }
let SHELL = false;

function commit() { save(); render(); }
function setMapMode(mode, starId) { MAPMODE = mode; if (starId) SYSVIEW = starId; render(); }
function setTab(t) { if (t === 'map') setMapMode('stars'); else if (t === 'system') setMapMode('system', S.ship.orbit || SYSVIEW); else { PANE = 'ship'; render(); } }

// ---------- map data in the original planner-map shape (as Rat Frontier does)
function plannerShape(sites, edgePairs) {
  const byId = Object.fromEntries(sites.map((x) => [x.id, x]));
  const neighbors = new Map();
  for (const [a, b] of edgePairs) {
    if (!neighbors.has(a)) neighbors.set(a, new Set());
    if (!neighbors.has(b)) neighbors.set(b, new Set());
    neighbors.get(a).add(b); neighbors.get(b).add(a);
  }
  const { chains, straightEdges } = buildChains(sites, edgePairs, byId); // hidden waypoints bend routes into arcs, as on Sol
  return { sites, edges: edgePairs, byId, chains, straightEdges, edgeLabels: {}, directedEdges: [], neighbors, mode: 'classic' };
}
// Hex sites and suns are REAL sites (they get the hex, size, droplets and name
// label); everything else is a waypoint marker (burn pad, Lagrange ring, ...).
const REAL_TYPES = new Set(['sun', 'planet', 'inner-planet', 'gas-giant', 'moon', 'asteroid', 'dwarf', 'tno', 'comet', 'surface', 'site']);
const baseSite = (o) => ({ id2: `aa-${o.id}`, isDecorative: false, solarZone: null, aeroLandable: false, hazard: false, isWaypoint: !REAL_TYPES.has(o.type), bodyKey: o.id, ...o });
// HF body art (the renderer's BODY_PALETTES), plus two the Sol board never needed
const BODY_ART = {
  earth: { base: '#3b7fc0', light: '#8fc1ee', dark: '#0e2c4b', atmosphere: 'rgba(135, 206, 250, 0.55)' },
  mars: { base: '#c1502e', light: '#f0a47e', dark: '#3c1408', atmosphere: 'rgba(220, 130, 90, 0.3)' },
  mercury: { base: '#9a8773', light: '#d4c0a8', dark: '#3d3326' },
  europa: { base: '#d4cdb8', light: '#f3eee0', dark: '#5a5346' },
  callisto: { base: '#6e6357', light: '#a89a87', dark: '#1f1c18' },
  io: { base: '#e6c84a', light: '#fff2a6', dark: '#5a4a12' },
  ganymede: { base: '#a39788', light: '#dccfb8', dark: '#3a342c' },
  jupiter: { base: '#c8a373', light: '#f3dab0', dark: '#5a3e22' },
  brownDwarf: { base: '#7c3f1d', light: '#c27a45', dark: '#2a1208', atmosphere: 'rgba(190, 90, 40, 0.35)' },
  whiteDwarf: { base: '#e8f1ff', light: '#ffffff', dark: '#8aa0c0', atmosphere: 'rgba(220, 235, 255, 0.6)' },
  ceres: { base: '#9c9387', light: '#d4cbbd', dark: '#2f2b25' },
};
let _starData = null;
function starMapData() { // AA-B6, drawn in HF node idioms
  if (_starData) return _starData;
  const sites = [];
  for (const nd of Object.values(MAP.nodes)) {
    let type = 'unknown', name = 'Deep space', hazard = false;
    if (nd.kind === 'sol') { type = 'orbit'; name = 'Sol'; sites.push(baseSite({ id: 'sun-sol', name: 'Sol', type: 'sun', x: nd.x, y: nd.y, sunR: 15 })); }
    else if (nd.kind === 'star') {
      // The renderer never picks a sun on click, so the star SPACE is a cyan
      // orbit ring (clickable, the HF "park here" marker) with the sun drawn
      // behind it as decoration. Brown dwarfs are hexes, clickable already.
      const st = STAR_BY_ID[nd.star]; name = st.name;
      if (st.type === 'brown') type = 'dwarf';
      else { type = 'orbit'; sites.push(baseSite({ id: `sun-${nd.star}`, name: st.name, type: 'sun', x: nd.x, y: nd.y, sunR: 15 })); }
    }
    else if (nd.kind === 'oort') { type = 'orbit'; name = `Oort cloud of ${nd.of === 'sol' ? 'Sol' : STAR_BY_ID[nd.of].name}`; }
    else if (nd.kind === 'dust') { type = 'radhaz'; name = 'Dust'; hazard = true; }
    else if (nd.kind === 'sunlens') { type = 'lagrange'; name = `Sunlens aimed at ${STAR_BY_ID[nd.target].name}`; }
    else if (nd.kind === 'junction') { name = 'Junction'; }
    sites.push(baseSite({ id: nd.id, name, type, x: nd.x, y: nd.y, hazard }));
  }
  const pairs = [];
  for (const [a, nbs] of Object.entries(MAP.adj)) for (const b of nbs) if (a < b) pairs.push([a, b]);
  _starData = plannerShape(sites, pairs);
  return _starData;
}
const _sysData = {};
function systemMapData(starId) { // AA-B7a, drawn exactly as the Sol board draws Sol
  if (_sysData[starId]) return _sysData[starId];
  const sys = sysOf(starId); const star = STAR_BY_ID[starId];
  const siteBy = Object.fromEntries(sys.sites.map((x) => [x.id, x]));
  const MOON_ART = ['io', 'ganymede', 'callisto'];
  const moonIdx = {};
  const sunR = (x) => (x.type === 'yellow' ? 24 : x.type === 'red' ? 18 : 12) * (x.role === 'distant' ? 0.6 : x.role === 'binary' ? 0.8 : 1);
  const sites = (sys.stars || [{ name: star.name, type: star.type, x: 700, y: 450 }]).map((x, i) => baseSite({ id: i ? `star${i}` : 'star', id2: `aa-${starId}-star${i}`, name: x.name, type: 'sun', x: x.x, y: x.y, sunR: sunR(x) }));
  for (const n of sys.nodes) {
    const st = siteBy[n.id];
    if (st) {
      const cls = st.cls;
      const type = st.kind === 'world' ? 'inner-planet' : st.kind === 'moon' || st.kind === 'ocean' ? 'moon' : st.big ? 'dwarf' : 'asteroid';
      const x = baseSite({ id: n.id, id2: `aa-${starId}-${n.id}`, name: st.label || st.name, type, x: n.x, y: n.y, siteSize: `${st.size}${st.spec}`, hydration: st.hyd, bodyKey: st.body,
        submarine: st.kind === 'ocean', astrobiology: st.kind === 'world' && (cls === 'Garden' || cls === 'Habitable'), atmospheric: st.role === 'hz' && cls !== 'Hostile' });
      x._palette = st.kind === 'world' ? (st.role === 'rock' ? BODY_ART.mercury : cls === 'Marginal' ? BODY_ART.mars : cls === 'Hostile' ? BODY_ART.mercury : BODY_ART.earth)
        : st.kind === 'ocean' ? BODY_ART.europa
        : st.kind === 'moon' ? BODY_ART[MOON_ART[(moonIdx[st.body] ??= Object.keys(moonIdx).length) % MOON_ART.length]]
        : st.big ? BODY_ART.ceres : undefined;
      if (st.role === 'hz') x.haloR = 20; // the habitable world reads bigger, like Earth
      sites.push(x);
    } else {
      const isDeco = n.kind === 'decorative';
      const id2 = `aa-${starId}-${n.id}`;
      if (n.tags && Object.keys(n.tags).length) NODE_TAGS[id2] = { ...n.tags }; // lander / half / hazard / aerobrake glyphs (SM-5c, 6c)
      sites.push(baseSite({ id: n.id, id2, name: n.label || '', type: isDeco ? 'decorative' : n.kind, isDecorative: isDeco, x: n.x, y: n.y, landing: n.land ? (n.land === 'half' ? 0.5 : 1) : null, hazard: n.kind === 'radhaz' || !!(n.tags && n.tags.hazard), flybyBoost: n.fly || null }));
    }
  }
  for (const b of sys.display || []) { // the giants themselves, as the Sol board draws Jupiter
    const g = baseSite({ id: b.id, name: b.name, type: 'gas-giant', x: b.x, y: b.y, isLandable: false });
    g._palette = b.kind === 'gas' ? BODY_ART.jupiter : b.kind === 'brown' ? BODY_ART.brownDwarf : BODY_ART.whiteDwarf;
    g.haloR = b.kind === 'white' ? 14 : GIANT_HALO; // SM-7: the ladder curls just outside the sphere
    sites.push(g);
  }
  _sysData[starId] = plannerShape(sites, sys.edges.map(([a, b]) => [a, b]));
  return _sysData[starId];
}
let SOL_DATA = null, _solLoading = null; // the real HF Sol board, loaded on first view
function rendererFor(key) {
  if (RENDERERS[key]) return RENDERERS[key];
  if (key === 'sol' && !SOL_DATA) { // the real HF Sol board (js/game/planner-map.js)
    if (!_solLoading) _solLoading = loadPlannerMap().then((d) => { SOL_DATA = d; render(); }).catch((e) => { toast(`The Sol map failed to load: ${e.message}`); MAPMODE = 'stars'; render(); });
    return null;
  }
  const host = h('div', { class: 'aa-maphost', 'data-map': key });
  $('#aa-maps').append(host);
  const data = key === 'stars' ? starMapData() : key === 'sol' ? SOL_DATA : systemMapData(key);
  // the renderer hands onSelect the clicked node OBJECT, not its id
  const renderer = new MapRenderer(host, { data, onSelect: (hit) => openPopup(key, hit && typeof hit === 'object' ? hit.id : hit) });
  renderer.options.initialZoom = 1;
  // open on the whole map (the star neighbourhood, or the whole system), not
  // zoomed onto the rocket the way the Sol board opens
  renderer._initialViewDone = true;
  // Sol's orbit rings and asteroid-belt dust belong only on the Sol board
  if (key !== 'sol') renderer.options.solDecor = false;
  // these maps are read zoomed out, so keep site names visible at fit zoom
  // (the Sol board keeps the HF default fade: it has hundreds of sites)
  // (system maps are as dense as Sol now, so they keep Sol's fade: names
  // appear as you zoom in; only the star map shows its names zoomed out)
  if (key === 'stars') { renderer.options.labelFadeMin = 0.4; renderer.options.labelFadeMax = 0.7; }
  if (key !== 'stars' && key !== 'sol' && sysOf(key)) { // a system board: tint its helio zones as Sol's are (SM-1c)
    Object.assign(renderer.options, { visualizeZones: true, zoneFill: true, zoneOpacity: 0.14 });
    const sy = sysOf(key);
    const z = zoneLayer(sy.stars ? sy.stars.map((x) => ({ zones: x.zones, role: x.role })) : (sy.zones || 6));
    renderer.setCanonicalZones({ polys: z.polys, colors: z.colors, order: z.order, restart: z.restart });
  }
  try { renderer.setAmbientRocketCount(0); } catch (e) { /* optional */ }
  RENDERERS[key] = { renderer, host, data, fresh: true };
  return RENDERERS[key];
}

function syncMaps() {
  const key = MAPMODE !== 'system' ? 'stars' : (SYSVIEW && sysOf(SYSVIEW)) ? SYSVIEW : 'sol';
  const cur = rendererFor(key);
  const loading = $('#aa-maploading');
  if (loading) loading.hidden = !!cur;
  if (!cur) { for (const r of Object.values(RENDERERS)) r.host.style.display = 'none'; return; }
  for (const [k, r] of Object.entries(RENDERERS)) r.host.style.display = k === key ? '' : 'none';
  const R = cur.renderer; const sh = S.ship;
  // insets: the hand strip and the open sidepanel cover part of the stage
  const hand = $('#aa-hand'); const side = $('#aa-side');
  // the map stops at the hand strip, so the whole board fits above it at fit
  // zoom (the renderer cannot zoom out past 1); the panel still overlays it
  const bottom = `${hand ? hand.offsetHeight : 0}px`;
  if (cur.host.style.bottom !== bottom) { cur.host.style.bottom = bottom; try { R._resize(); } catch (e) { /* sizing */ } }
  try { R.setInsets({ bottom: 0, right: side && PANE ? side.offsetWidth : 48 }); } catch (e) { /* older renderer */ }
  if (cur.fresh) {
    cur.fresh = false;
    // open framed on the whole map, inside the area the hand and panel leave free
    requestAnimationFrame(() => { try { R.reset(); if (key !== 'sol') R.flyToFit(cur.data.sites, { maxZoom: key === 'stars' ? 1.6 : 2.4, pad: 0.92 }); } catch (e) { /* sizing */ } });
  }
  if (key === 'sol') { // Sol: Home theatre, no movement (AA-S1); the drydock is at LEO
    R.setSandboxRocket(sh.launched ? null : { x: LEO_ANCHOR.x, y: LEO_ANCHOR.y });
    R.setRoute(null); R.setMoveTargets(null);
    return;
  }
  if (key === 'stars') {
    // explored stars carry their world badge as the hex label (G H M X, - none)
    for (const st of STARS) {
      const site = cur.data.byId[`sun-${st.id}`] || cur.data.byId[st.id];
      if (S.stars[st.id].explored) {
        const ws = bodiesOf(st.id).filter((x) => x.role === 'hz' || x.kind === 'ocean');
        site.siteSize = ws.length ? ws.map((x) => CLS_LETTER[x.cls]).join('') : '-';
      }
    }
    const at = sh.launched && !sh.lost ? MAP.nodes[sh.orbit || sh.pos] : MAP.nodes.sol;
    R.setSandboxRocket(sh.lost ? null : { x: at.x, y: at.y });
    R.setRoute(predictedCourse());
    R.setMoveTargets(null);
    R.setFactories(null);
    R.setColonies(null);
    const discs = {};
    for (const st of STARS) if (S.stars[st.id].explored) discs[st.id] = { outcome: sysOf(st.id).sites.some((x) => x.pop > 0) ? 'success' : 'success' };
    R.setDiscs(null);
  } else {
    const sys = sysOf(key);
    const here = sh.orbit === key && !sh.lost;
    const n = here ? sys.nodes.find((q) => q.id === sh.sysNode) : null;
    R.setSandboxRocket(n ? { x: n.x, y: n.y } : null);
    R.setRoute(null);
    const fac = {}, col = {}, discs = {};
    for (const x of sys.sites) {
      if (x.cubes > 0) fac[x.id] = { ownerId: 'me', spectralType: x.spec, color: '#b40054' };
      if (x.pop > 0) col[x.id] = { ownerId: 'me' };
      if (x.claimed && !x.cubes) discs[x.id] = { outcome: 'success' };
      if (x.goo) discs[x.id] = { outcome: 'fail' };
    }
    R.setFactories(fac); R.setColonies(col); R.setDiscs(discs);
    R.setMoveTargets(here && shipActive() ? moveTargets(key) : null);
  }
}
function predictedCourse() {
  const sh = S.ship; if (!sh.launched || sh.orbit || sh.lost || sh.V <= 0) return null;
  const segs = []; let prev = sh.prev, cur = sh.pos, nxt = sh.next;
  for (let i = 0; i < sh.V; i++) {
    const opts = MAP.adj[cur].filter((n) => n !== prev);
    const n = nxt && opts.includes(nxt) ? nxt : opts.length === 1 ? opts[0] : null;
    if (!n) break;
    segs.push({ from: cur, to: n, dv: 0, turn: 1 }); prev = cur; cur = n; nxt = null;
  }
  return segs.length ? segs : null;
}
function moveTargets(starId) {
  const sh = S.ship; const out = {};
  for (const nb of sysAdj(starId, sh.sysNode)) out[nb] = canSysMove(starId, nb).ok ? 'ok' : 'blocked';
  return out;
}

// ---------- popups (the HF site popup + its action buttons)
function openPopup(key, id, { center = true } = {}) {
  const ent = RENDERERS[key]; if (!ent || !id) return;
  if (key === 'stars' && String(id).startsWith('sun-')) id = String(id).slice(4);
  const site = ent.data.byId[id]; if (!site) return;
  POPUP = { key, id };
  const actions = key === 'stars' ? starActions(id) : key === 'sol' ? solActions(site) : systemActions(key, id);
  ent.renderer.setSitePopup(site, actions);
  // pan so the popup is on screen when a site near the edge is tapped (HF does the same)
  if (center) { try { ent.renderer.centerSitePopup({ ms: 280 }); } catch (e) { /* older renderer */ } }
}
function refreshPopup() {
  if (!POPUP) return;
  const ent = RENDERERS[POPUP.key];
  if (!ent || ent.host.style.display === 'none') return;
  openPopup(POPUP.key, POPUP.id, { center: false });
}
const act = (fn) => async (ev) => { if (ev) ev.stopPropagation(); await fn(); refreshPopup(); };
const info = (label) => ({ label, disabled: true, variant: 'secondary' });
function starActions(id) {
  const nd = MAP.nodes[id]; const sh = S.ship; const out = [];
  const fromShip = sh.launched && !sh.lost ? bfs(sh.orbit || sh.pos) : null;
  if (nd.kind === 'sol') {
    out.push({ label: '🪐 View system', variant: 'rocket', onClick: act(() => setMapMode('system', 'sol')) });
    out.push(info('Sol: your Home empire. Nothing moves here (AA-S1).'));
  }
  if (nd.kind === 'star') {
    const st = STAR_BY_ID[nd.star]; const ex = S.stars[nd.star].explored;
    out.push(ex
      ? { label: '🪐 View system', variant: 'rocket', onClick: act(() => setMapMode('system', nd.star)) }
      : { label: '🪐 View system (reveals it: debug)', variant: 'rocket', onClick: act(() => { explore(nd.star, 'debug'); log(`[debug] revealed ${st.name} from its popup`); commit(); setMapMode('system', nd.star); }) });
    const kindOf = (t) => ({ yellow: 'sun', red: 'red dwarf', brown: 'brown dwarf', white: 'white dwarf' }[t]);
    out.push(info(`${st.type === 'yellow' ? 'Yellow sun' : st.type === 'red' ? 'Red dwarf' : 'Brown dwarf'}${st.comp.length ? ` + ${st.comp.map((c) => ({ gas: 'gas giant', brown: 'brown dwarf', white: 'white dwarf' }[c])).join(', ')}` : ''}${st.hazard ? `, ${st.hazard === 'flare' ? 'flare star' : 'debris disk'}` : ''}`));
    for (const c of st.stars || []) out.push(info(`${c.role === 'binary' ? 'Binary' : 'Distant'} companion: ${c.name} (${kindOf(c.type)})`));
    out.push(info(`${MAP.dist[nd.star]} spaces from Sol${fromShip ? `, ${fromShip[nd.star]} from your starship` : ''}`));
    for (const kn of [st.known, ...(st.stars || []).map((c) => c.known && `${c.known}, round ${c.name}`)].filter(Boolean)) out.push(info(`Known planet: ${kn}`));
    if (ex) {
      out.push(info(`Bodies: ${bodiesOf(nd.star).map((b) => `${b.body} (${b.kind === 'ocean' ? 'buried ocean' : b.cls})`).join(', ')}`));
    } else {
      out.push(info('Unexplored: fly through it, sit at its sunlens, or Lens Survey it'));
      const range = S.spinoffs.includes('optics') ? 999 : TUNE.lensRangeSpaces;
      if (owns('lens') && (MAP.dist[nd.star] ?? 99) <= range) out.push({ label: '🔭 Lens Survey (Home op)', variant: 'rocket', disabled: S.ops.home < 1 || !!S.over, onClick: act(() => lensSurveyStar(nd.star)) });
    }
    if (MAP.adj[nd.star].length === 1) out.push(info('Dead end: arrive at V0 or fly off into the dark'));
  } else if (nd.kind === 'oort' && nd.of !== 'sol') out.push(info('Icebrake here: -1 V free, a roll for debris. V0 here is Orbit.'));
  else if (nd.kind === 'dust') out.push(info('Dust strike: lose a card unless a Shield absorbs it'));
  else if (nd.kind === 'sunlens') out.push(info(`Passing here explores ${STAR_BY_ID[nd.target].name}`));
  if (fromShip && nd.kind !== 'star') out.push(info(`${fromShip[id]} spaces from your starship`));
  return out;
}
function systemActions(starId, id) {
  const sh = S.ship; const here = sh.orbit === starId && shipActive();
  const site = siteById(starId, id); const out = [];
  const fops = S.ops.frontier < 1 || !!S.over;
  const colonyHere = sysOf(starId).sites.some((x) => x.pop > 0);
  if (site) {
    if (site.label && site.label !== site.name) out.push(info(site.name));
    out.push(info(site.kind === 'mine' ? 'Mine' : site.kind === 'ocean' ? 'Buried ocean, Hostile surface' : site.kind === 'moon' ? 'Moon, Hostile surface' : `${site.cls} world`));
    out.push(info(`Size ${site.size} · Hydration ${site.hyd} · Spectral ${site.spec}`));
    const status = [site.goo ? 'Consumed by grey goo' : site.claimed ? 'Claimed' : 'Unclaimed', site.cubes ? `${site.cubes} cubes (cap ${site.size})` : '', site.pop ? `Colony ${site.pop}${isOpen(site) ? ' (open)' : ' (domed)'}` : '', site.kind === 'world' && site.terra ? `Terraform ${site.step}/4` : ''].filter(Boolean).join(' · ');
    out.push(info(status));
    if (!site.goo) {
      const pc = prospectorCard();
      const freeScan = pc && def(pc).raygun && S.ops.prospected;
      if (here && !site.claimed) out.push({ label: freeScan ? '🔫 Prospect (free scan)' : '⛏ Prospect', variant: 'rocket', disabled: (fops && !freeScan) || !pc, onClick: act(() => opProspect(site)) });
      if (here && site.claimed && !site.cubes && hasSeed()) out.push({ label: '🌱 Deploy Seed', variant: 'rocket', disabled: fops, onClick: act(() => opDeploySeed(site)) });
      if (here && site.claimed && (site.kind === 'world' || site.kind === 'ocean' || site.kind === 'moon')) out.push({ label: '🏠 Found Colony', variant: 'rocket', disabled: fops || shipPop() < 1, onClick: act(() => opFoundColony(site)) });
      if ((here || colonyHere) && !site.claimed) out.push({ label: '🚩 Settle (claim)', disabled: fops, onClick: act(() => opSettle(starId, site)) });
      if (site.pop > 0) out.push({ label: '👶 Grow', disabled: fops, onClick: act(() => opGrow(Object.assign(site, { _star: starId }))) });
      if (site.cubes > 0 && (here || colonyHere)) out.push({ label: '🏭 Industry +2 cubes', disabled: fops, onClick: act(() => opIndustry(site)) });
      if (site.cubes > 0 && (here || colonyHere)) out.push({ label: '🛠 Landfall Production', disabled: fops, onClick: act(() => opBuild(starId)) });
      if (site.kind === 'world' && site.terra && (here || colonyHere) && site.step < 4) {
        const nx = TERRAFORM[site.step + 1]; const roles = rolesIn(starId);
        out.push({ label: `🌍 Terraform to ${nx.reach}`, disabled: fops, title: `Needs ${nx.needs.map((r) => `${r} ${roles[r] ? '✓' : '✗'}`).join(', ')}`, onClick: act(() => opTerraform(starId, site)) });
      }
      if (here && site.cubes > 0 && driveCard() && !sh.recycled) out.push({ label: '♻ Recycle drive here (free)', onClick: act(() => freeRecycle(site)) });
    }
  } else if ((sysOf(starId).display || []).some((b) => b.id === id)) {
    out.push(info('A giant at the centre of its own gravity well. Come in through its Lagrange points, then branch out to its moons. Skim fuel at its central Lagrange point.'));
  } else {
    const n = sysOf(starId).nodes.find((q) => q.id === id);
    const burnWhy = (x) => (x.land ? `${x.land === 'half' ? 'Half landing' : 'Landing'} burn${x.body ? ` onto ${x.body}` : ''}` : x.purpose === 'transition' ? 'Zone transition burn' : x.purpose === 'escape' ? (x.rung ? `${x.body}'s escape ladder, burn ${x.rung} of 3` : `Escape burn, ${x.body}'s well`) : 'Burn pad');
    if (n) out.push(info(n.kind === 'burn' ? `${burnWhy(n)}: entering it costs 1 burn` : n.kind === 'orbit' ? 'The system edge: where ships arrive' : n.kind === 'lagrange' ? (n.purpose === 'flyby' ? `${n.body} slingshot: free, +${n.fly || 0} flyby; no route to its moons from here` : (n.label || 'Lagrange point: free to enter')) : n.kind === 'hohmann' ? 'Hohmann transfer: free to enter' : n.kind === 'radhaz' ? 'Radiation belt: free, but roll for damage (AA-B7c)' : (n.label || '')));
    if (here && n && n.skim) out.push({ label: '⛽ Skim gas giant', disabled: fops || sh.sysNode !== id, onClick: act(opSkim) });
  }
  if (here && sh.sysNode !== id && (site || sysOf(starId).nodes.some((q) => q.id === id))) {
    const c = canSysMove(starId, id);
    if (c.ok) out.push({ label: `🚀 Move here (${c.burns} burn${c.burns === 1 ? '' : 's'})`, variant: 'rocket', onClick: act(() => freeSysMove(id)) });
    else if (c.partial) out.push({ label: `🚀 Move toward it: ${c.partial.burns} of ${c.burns} burns this Generation`, variant: 'rocket', title: 'Flies as far along the route as your Thrust allows; carry on next Generation', onClick: act(() => freeSysMove(id, { toward: true })) });
    else out.push({ label: `🚀 Move here: ${c.why}`, variant: 'rocket', disabled: true });
  }
  if (here && site && sh.sysNode === id) out.push(info('Your starship is here'));
  return out;
}
function solActions(site) {
  const out = [info('Sol is your Home empire: nothing moves here (AA-S1).')];
  if (site && site.name === 'LEO') out.push(info(S.ship.launched ? 'Your drydock, empty since launch.' : 'Your drydock: the starship is built here.'));
  out.push({ label: '☉ Open the Sol empire panel', variant: 'rocket', onClick: act(() => { PANE = 'sol'; render(); }) });
  return out;
}
async function lensSurveyStar(starId) { if (!spendHome()) return; explore(starId, 'Lens Survey from Sol'); commit(); }

// ---------- the shell
function mountShell() {
  if (SHELL) return; SHELL = true;
  const app = $('#aa-app') || document.body.appendChild(h('div', { id: 'aa-app' }));
  app.innerHTML = `
  <div class="browse-shell aa-shell">
    <div class="browse-stage"><div class="browse-map">
      <div class="map-toolbar">
        <div class="map-turn-controls">
          <button id="aa-menu" title="Menu" aria-label="Menu">☰</button>
          <button id="aa-clock" title="Turn clock" aria-label="Turn clock">🕐</button>
          <button id="aa-news" title="This Generation's event" aria-label="Event">‼️</button>
          <button id="turn-end" title="End your turn" aria-label="End turn">⏭ End turn</button>
          <span id="aa-budget" class="map-turn-budget" aria-live="polite"></span>
          <span class="map-aqua-chip" title="Aqua: your Sol treasury">💧 <strong id="aa-aqua">0</strong></span>
        </div>
        <div class="map-route">
          <span id="route-status" class="muted"></span>
          <button id="aa-mode-stars" title="The nearby stars">🌌 Star map</button>
          <button id="aa-mode-sys" title="The system your starship is in">🪐 System</button>
        </div>
      </div>
      <div class="browse-map-stage"><div class="browse-map-canvas" id="aa-maps"><p id="aa-maploading" class="aa-maploading" hidden>Loading the Sol board...</p></div></div>
    </div></div>
    <aside id="aa-side" class="browse-sidepanel" data-active="">
      <nav class="sidepanel-tabs">
        <button data-pane="ship" title="Starship" aria-label="Starship">🚀</button>
        <button data-pane="sol" title="Home: Sol empire" aria-label="Sol empire">☉</button>
        <button data-pane="frontier" title="Frontier" aria-label="Frontier">🛰</button>
        <button data-pane="milestones" title="Scoring" aria-label="Scoring">🏆</button>
        <button data-pane="log" title="Mission log" aria-label="Mission log">📋</button>
        <button data-pane="rules" title="How to play" aria-label="How to play">📖</button>
        <button data-pane="debug" title="Debug tools (prototype)" aria-label="Debug tools">🔧</button>
      </nav>
      <div class="sidepanel-content">
        <button class="sidepanel-close" id="aa-side-close" aria-label="Close panel" title="Close">×</button>
        ${['ship', 'sol', 'frontier', 'milestones', 'log', 'rules', 'debug'].map((p) => `<div class="panel-pane" data-pane="${p}"></div>`).join('')}
      </div>
    </aside>
    <div id="aa-hand" class="sandbox-hand" aria-label="Your hand">
      <div class="hand-header">
        <span class="hand-title">✋ Hand</span>
        <span class="hand-count" id="aa-hand-count">0 cards</span>
        <button id="hand-boost-commit" type="button" title="Boost every marked card onto the starship in the drydock">🚀 BOOST to drydock</button>
        <button id="aa-research" class="hand-all-cards" type="button" title="Research: take top cards, 1 Aqua each">📚 Research</button>
      </div>
      <div id="aa-stacks" class="hand-stack-switcher" aria-label="Your stacks"></div>
      <div id="aa-hand-cards" class="hand-cards" data-empty="Research to draw cards, then mark them and BOOST them onto your starship"></div>
    </div>
  </div>`;
  $('#aa-menu').onclick = menuModal;
  $('#aa-clock').onclick = clockModal;
  $('#aa-news').onclick = () => S.event ? modal({ title: `Generation event: ${S.event.name}`, body: `<p>${S.event.text}</p><p class="muted">${S.event.note || ''}</p>` }) : toast('No event this turn.');
  $('#turn-end').onclick = endTurn;
  $('#aa-mode-stars').onclick = () => setMapMode('stars');
  $('#aa-mode-sys').onclick = pickSystem;
  $('#aa-side').querySelectorAll('.sidepanel-tabs button[data-pane]').forEach((b) => { b.onclick = () => { PANE = PANE === b.dataset.pane ? '' : b.dataset.pane; render(); }; });
  $('#aa-side-close').onclick = () => { PANE = ''; render(); };
  $('#hand-boost-commit').onclick = boostMarked;
  $('#aa-research').onclick = () => opResearch('hand');
  window.addEventListener('resize', () => syncMaps());
}

function render() {
  if (!S) return;
  mountShell();
  const sh = S.ship;
  // toolbar
  $('#aa-aqua').textContent = S.aqua;
  const endB = $('#turn-end');
  endB.textContent = BUSY ? '⏳ Moving' : S.phase === 'voyage' ? '⏭ End Generation' : '⏭ End turn';
  endB.disabled = S.phase === 'setup' || !!S.over || BUSY;
  $('#aa-clock').textContent = S.phase === 'voyage' ? `🕐 Gen ${S.gen}/${TUNE.generations}` : `🕐 Drydock ${S.turn}/${TUNE.launchWindow}`;
  $('#aa-news').hidden = !S.event;
  const tags = [`<span class="turn-tag${S.ops.home ? '' : ' is-spent'}" title="Home operation (AA-D1)">☉ Home op:${S.ops.home}</span>`];
  if (S.phase === 'voyage') tags.push(`<span class="turn-tag${S.ops.frontier ? '' : ' is-spent'}" title="Frontier operations: one per starship and one per colony system (AA-D1)">🛰 Frontier:${S.ops.frontier}</span>`);
  if (sh.launched && !sh.lost) tags.push(`<span class="turn-tag" title="Velocity: spaces moved each Generation (AA-B4)">🚀 V${sh.V}</span>`);
  $('#aa-budget').innerHTML = tags.join('');
  $('#route-status').textContent = statusLine();
  $('#aa-mode-stars').classList.toggle('is-active', MAPMODE === 'stars');
  $('#aa-mode-sys').classList.toggle('is-active', MAPMODE === 'system');
  // sidepanel
  const side = $('#aa-side');
  side.dataset.active = PANE || '';
  side.querySelectorAll('.sidepanel-tabs button[data-pane]').forEach((b) => b.classList.toggle('active', b.dataset.pane === PANE));
  side.querySelectorAll('.panel-pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === PANE));
  const pane = PANE && side.querySelector(`.panel-pane[data-pane="${PANE}"]`);
  if (pane) pane.replaceChildren(...paneContent(PANE));
  renderHand();
  syncMaps();
  refreshPopup();
}
function courseNote() {
  const sh = S.ship;
  const opts = MAP.adj[sh.pos].filter((n) => n !== sh.prev);
  if (sh.next) { const lt = leadsTo(sh.pos, sh.next); return `V${sh.V}, heading for ${nodeName(lt.node)}, ${lt.steps} spaces.`; }
  if (opts.length === 1) {
    const lt = leadsTo(sh.pos, opts[0]); const nd = MAP.nodes[lt.node];
    const leaf = nd.kind === 'star' && MAP.adj[lt.node].length === 1;
    return `V${sh.V}. Next: ${nodeName(lt.node)} in ${lt.steps} spaces.${leaf ? ' A dead end: be at V0 there, or brake in its Oort cloud, or fly off into the dark.' : ''}`;
  }
  if (!opts.length) return `V${sh.V} at a dead end: brake to V0 now or be lost.`;
  return `V${sh.V} at a junction: you choose the branch as you move.`;
}
function statusLine() {
  const sh = S.ship;
  if (S.over) return `Game over: ${S.over.total} VP, ${S.over.band}.`;
  if (S.phase === 'setup') return 'Choose your starting TW drive.';
  if (S.phase === 'drydock') return `Drydock: convert your TW drive into a starship and launch by turn ${TUNE.launchWindow}. ${launchChecks().filter((x) => x.ok).length}/4 launch checks pass.`;
  if (sh.lost) return 'Your starship is lost. Sol plays on.';
  if (sh.orbit) return `In orbit at ${STAR_BY_ID[sh.orbit].name}. Tap a site for its actions.`;
  return courseNote();
}

// ---------- hand strip (HF hand: click to mark, BOOST commits)
function cardEl(c) { const el = renderInst(c); const card = el.querySelector('.card'); return card || el; }
function renderHand() {
  const launched = S.ship.launched;
  const box = $('#aa-hand-cards');
  for (const uid of [...MARKS]) if (!S.hand.some((c) => c.uid === uid)) MARKS.delete(uid);
  box.replaceChildren(...S.hand.map((c) => {
    const slot = h('div', { class: 'hand-slot' + (MARKS.has(c.uid) ? ' is-boost-marked' : ''), title: launched ? `${def(c).name}: Transmit it from the Sol panel` : `${def(c).name}: tap to mark for BOOST (${def(c).mass} Aqua)` });
    slot.append(cardEl(c));
    slot.onclick = (e) => { if (e.target.closest('.card-flip')) return; if (launched) return; MARKS.has(c.uid) ? MARKS.delete(c.uid) : MARKS.add(c.uid); renderHand(); };
    return slot;
  }));
  $('#aa-hand-count').textContent = `${S.hand.length} card${S.hand.length === 1 ? '' : 's'}`;
  const cost = S.hand.filter((c) => MARKS.has(c.uid)).reduce((a, c) => a + def(c).mass, 0);
  const bb = $('#hand-boost-commit');
  bb.disabled = launched || !MARKS.size || !!S.over;
  bb.textContent = MARKS.size ? `🚀 BOOST ${MARKS.size} to drydock (${cost} Aqua)` : '🚀 BOOST to drydock';
  bb.hidden = launched;
  $('#aa-research').disabled = S.ops.home < 1 || !!S.over || S.phase === 'setup';
  // stack chips: the starship (+ find pin), then each colony system
  const chips = [];
  const shipLabel = S.ship.lost ? 'Starship (lost)' : S.ship.recycled ? 'Starship (wreck)' : 'Starship';
  chips.push(h('div', { class: 'hand-stack-group is-focused' },
    h('button', { class: 'hand-stack-chip', title: 'Open the starship placard', onclick: () => { PANE = 'ship'; render(); } }, h('span', { class: 'chip-glyph' }, '🚀'), ` ${shipLabel} . ${dryMass() + propMass()} Mass`),
    h('button', { class: 'hand-stack-pin', title: 'Find it on the map', 'aria-label': 'Find the starship', onclick: findShip }, '📍')));
  for (const id of colonySystems()) chips.push(h('div', { class: 'hand-stack-group' }, h('button', { class: 'hand-stack-chip', onclick: () => setMapMode('system', id) }, h('span', { class: 'chip-glyph' }, '🏠'), ` ${STAR_BY_ID[id].name}`)));
  $('#aa-stacks').replaceChildren(...chips);
}
function findShip() {
  const sh = S.ship;
  if (sh.orbit) setMapMode('system', sh.orbit); else setMapMode('stars');
  const ent = RENDERERS[MAPMODE === 'system' ? sh.orbit : 'stars']; if (!ent) return;
  const node = MAPMODE === 'system' ? sysOf(sh.orbit).nodes.find((n) => n.id === sh.sysNode) : MAP.nodes[sh.pos || 'sol'];
  if (node) ent.renderer.flyTo({ x: node.x, y: node.y }, 3);
}
async function boostMarked() { // AA-S2c: first Boost of the turn is the operation, later ones free
  const cards = S.hand.filter((c) => MARKS.has(c.uid));
  for (const c of cards) { await opBoost(c); MARKS.delete(c.uid); }
  render();
}

// ---------- sidepanel panes
function paneContent(p) {
  if (p === 'ship') return [h('h3', {}, '🚀 Starship'), shipPane()];
  if (p === 'sol') return [h('h3', {}, '☉ Home: Sol empire'), solPane()];
  if (p === 'frontier') return [h('h3', {}, '🛰 Frontier'), frontierPane()];
  if (p === 'milestones') { const sc = score(); return [h('h3', {}, '🏆 Scoring'), h('table', { class: 'aa-score' }, sc.rows.map((r) => h('tr', {}, h('td', {}, r[0], ' ', h('small', {}, r[2])), h('td', {}, r[1]))), h('tr', { class: 'tot' }, h('td', {}, 'Total'), h('td', {}, sc.total))), h('p', { class: 'aa-band' }, S.over ? S.over.band : sc.band), h('p', { class: 'muted' }, 'Bands (AA-I3): 0-9 Lost in the dark, 10-19 Survivors, 20-34 Colony, 35+ New Earth.')]; }
  if (p === 'log') return [h('h3', {}, '📋 Mission log'), h('ol', { class: 'aa-log' }, S.log.slice(0, 120).map((l) => h('li', { class: l.kind }, h('small', {}, l.when), ' ', l.msg)))];
  if (p === 'debug') return [h('h3', {}, '🔧 Debug tools'), debugPane()];
  if (p === 'rules') return [h('h3', {}, '📖 How to play'), h('div', { class: 'aa-rules', html: RULES_HTML })];
  return [];
}
function opButton(label, sub, fn, disabled) { return h('button', { class: 'aa-op', onclick: fn, disabled: disabled || !!S.over }, label, h('small', {}, sub)); }
function solPane() {
  const launched = S.ship.launched; const homeLeft = S.ops.home > 0 && S.phase !== 'setup';
  return h('div', {},
    h('p', { class: 'muted' }, 'Sol is an economy you grow, not a map you fly (AA-S1). One Home operation each turn.'),
    h('div', { class: 'aa-holds' }, HOLDINGS.map((hd) => h('div', { class: 'aa-hold' + (owns(hd.id) ? ' own' : ''), title: hd.desc }, h('b', {}, hd.name), h('span', {}, owns(hd.id) ? 'Owned' : `${hd.cost} Aqua . ${hd.vp} VP`)))),
    h('div', { class: 'aa-ops' },
      opButton('Income', `+${1 + (owns('market') ? 1 : 0)} Aqua`, opIncome, !homeLeft),
      opButton('Research', '1 Aqua per card', () => opResearch('hand'), !homeLeft),
      opButton('Expand', 'Buy a Holding', opExpand, !homeLeft),
      !launched ? opButton('Produce', family() ? `${family()} propellant` : 'Needs a Drive', opProduce, !homeLeft) : opButton('Transmit', 'Send a design', opTransmit, !homeLeft),
      opButton('Lens Survey', owns('lens') ? 'Explore a star' : 'Needs Observatory', opLensSurvey, !homeLeft || !owns('lens')),
      !launched ? h('button', { class: 'aa-op launch', onclick: opLaunch, disabled: S.phase !== 'drydock' || !!S.over }, '🚀 LAUNCH', h('small', {}, `${launchChecks().filter((x) => x.ok).length} of 4 checks pass`)) : null));
}
function shipPane() {
  const sh = S.ship; const dd = driveDef(); const tm = totalMass(); const cl = classFor(tm);
  const slots = [['drive', 'TW Drive'], ['support', 'Supports'], ['brake', 'Brake'], ['payload', 'Payload'], ['prospector', 'Prospector'], ['seed', 'Seed'], ['shield', 'Shield']];
  const placard = h('div', { class: 'aa-placard' });
  for (const [role, label] of slots) {
    const cards = S.ship.cards.filter((c) => def(c).role === role);
    if (!cards.length && (role === 'brake' || role === 'shield') ) continue;
    const col = h('div', { class: 'aa-slot' }, h('label', {}, label));
    if (!cards.length) col.append(h('div', { class: 'aa-ghost' }, role === 'support' ? 'What the drive requires' : 'Empty'));
    for (const c of cards) {
      const acts = [];
      if (c.glitched && sh.crew) acts.push(h('button', { class: 'aa-mini good', onclick: () => freeRepair(c) }, 'Repair'));
      if (S.event && S.event.flipFree && c.face === 'white') acts.push(h('button', { class: 'aa-mini good', onclick: () => freeFlipEvent(c) }, 'Flip free'));
      if (!S.over) acts.push(h('button', { class: 'aa-mini bad', onclick: () => freeJettison(c) }, 'Jettison'));
      col.append(renderInst(c, { small: true, actions: acts }));
    }
    placard.append(col);
  }
  const per = PROP_PER_MASS[family()] || Infinity;
  const pips = h('div', { class: 'aa-pips', 'aria-label': `${sh.prop} propellant` });
  if (per !== Infinity) for (let i = 1; i <= Math.max(sh.prop, 6); i++) pips.append(h('span', { class: 'aa-pip' + (i <= sh.prop ? ' full' : '') + (i % per === 0 ? ' mass' : '') }, i <= sh.prop ? FAMILY_GLYPH[family()] : ''));
  const tb = totalBurns();
  return h('div', {},
    placard,
    h('div', { class: 'aa-box' }, h('h4', {}, 'Mass ratio (AA-F4)'),
      dd ? h('div', {}, `${dd.name}: Thrust ${dd.thrust}, Fuel ${dd.fuel}, ${FAMILY_GLYPH[dd.family]} ${dd.family}. ${dd.brake === true ? 'Can brake.' : dd.brake === 'staged' ? 'Staged sail: one -2 V brake at a star.' : 'Cannot brake.'}`) : h('div', {}, 'No drive.'),
      h('div', {}, 'Mass ', h('b', {}, `${dryMass()} dry + ${propMass()} propellant = ${tm}`), ` (${cl.name}, x${cl.x})`),
      tb != null ? h('div', {}, 'Propellant ', h('b', {}, `${sh.prop}`), ' = ', h('b', {}, `${tb} Burns`), ' at this mass') : null,
      h('table', { class: 'aa-ladder' }, CLASSES.map((c) => h('tr', { class: c === cl ? 'cur' : '' }, h('td', {}, c.name), h('td', {}, `${c.lo}${c.hi < 999 ? `-${c.hi}` : '+'}`), h('td', { class: 'x' }, `x${c.x}`)))),
      per !== Infinity ? pips : null),
    !sh.launched ? h('div', { class: 'aa-box' }, h('h4', {}, 'Launch check (AA-E5)'), h('ul', { class: 'aa-check' }, launchChecks().map((c) => h('li', { class: c.ok ? 'ok' : 'no' }, c.ok ? '✓ ' : '✗ ', c.text, ' ', h('small', {}, c.id))))) : null,
    h('div', { class: 'aa-box' }, h('h4', {}, 'Trip planner'), h('table', { class: 'aa-trip' }, h('tr', {}, h('th', {}, 'Star'), h('th', {}, 'Spaces'), h('th', {}, 'V1'), h('th', {}, 'V2'), h('th', {}, 'V3')),
      STARS.slice().sort((a, b) => MAP.dist[a.id] - MAP.dist[b.id]).slice(0, 8).map((st) => h('tr', {}, h('td', {}, st.name), h('td', {}, MAP.dist[st.id]), ...[1, 2, 3].map((v) => h('td', {}, `${Math.ceil(MAP.dist[st.id] / v)} gen`)))))));
}
function frontierPane() {
  const sh = S.ship;
  if (!sh.launched) return h('p', { class: 'muted' }, 'Nothing has left Sol yet. Launch from the Sol panel when the starship passes its checks.');
  const box = h('div', {});
  box.append(h('div', { class: 'aa-vrow' }, h('span', { class: 'aa-v' }, sh.lost ? 'LOST' : `V${sh.V}`), h('span', {}, sh.lost ? 'Your starship is lost.' : sh.orbit ? `In orbit at ${STAR_BY_ID[sh.orbit].name}` : `In ${nodeName(sh.pos)}`)));
  if (!sh.orbit && !sh.lost && sh.V > 0) box.append(h('p', { class: 'muted' }, courseNote()));
  box.append(h('p', { class: 'muted' }, `Propellant ${sh.prop}${family() ? ` ${family()}` : ''}. Population aboard ${shipPop()}. Frontier operations left: ${S.ops.frontier}.`));
  if (S.event) box.append(h('div', { class: 'aa-box ev' }, h('h4', {}, `Event: ${S.event.name}`), h('p', {}, S.event.text), S.event.note ? h('p', { class: 'muted' }, S.event.note) : null));
  const ops = h('div', { class: 'aa-ops' });
  if (shipActive()) {
    ops.append(opButton(sh.orbit ? 'Burn (leave orbit)' : 'Burn', 'Change V (Frontier op)', opBurn, S.ops.frontier < 1));
    if (hasBrake('magsail') && !sh.orbit && sh.V > 0) ops.append(opButton('Magsail', '-1 V, free, once per Gen', freeMagsail, sh.magsailUsedGen === S.gen));
  }
  const sysId = sh.orbit || colonySystems()[0];
  if (sysId && factoriesIn(sysId).length) {
    ops.append(opButton('Landfall Production', 'Flip a card (AA-H6)', () => opBuild(sysId), S.ops.frontier < 1));
    ops.append(opButton('Research (cubes)', 'Blueprints here', () => opResearch(sysId), S.ops.frontier < 1));
  }
  box.append(ops);
  const known = Object.keys(S.systems);
  if (known.length) box.append(h('h4', {}, 'Explored systems'), h('div', { class: 'aa-ops' }, known.map((id) => opButton(STAR_BY_ID[id].name, sysOf(id).sites.some((x) => x.pop > 0) ? 'Colony' : sh.orbit === id ? 'In orbit' : 'View map', () => setMapMode('system', id)))));
  return box;
}
const RULES_HTML = `
<p><b>A turn</b> is one Home operation in Sol (no movement there) and, once launched, one Frontier operation per starship and per colony system. Free actions are unlimited.</p>
<p><b>Act I, Drydock (6 turns).</b> Research cards (1 Aqua each), mark them in your hand and BOOST them onto the starship. A starship needs a working TW drive, Population, a Seed and propellant. Buy the Sol Source for your drive's propellant (Expand), then Produce. Every card you add raises the weight class and multiplies every Burn.</p>
<p><b>Act II, Reaching the Stars.</b> Each dot is a space, half a light-year. At the end of each Generation the starship moves V spaces. Burn to change V. Brake with your drive, a Brake card, an icebrake in a star's Oort cloud (blue rings) or a fryby through a gas giant. Reach V0 at a star or in its Oort cloud to enter orbit. Passing through a star explores it. Many stars are dead ends.</p>
<p><b>Act III, Colonies.</b> On a system map, entering a magenta burn pad costs a burn. Prospect, deploy the Seed (it doubles every Generation), rebuild cards into their Landfall side, found Colonies, grow, and terraform a hostile world step by step for spin-off tech.</p>
<p class="muted">Full rules: docs/ad-astra/rules.md. Rule IDs like AA-G3 appear in the log.</p>`;

// ---------- System picker: Sol (the real HF board) and every explored system
async function pickSystem() {
  const ids = ['sol', ...Object.keys(S.systems)];
  if (S.ship.orbit) ids.sort((a, b) => (b === S.ship.orbit) - (a === S.ship.orbit));
  if (ids.length === 1) { setMapMode('system', 'sol'); return; }
  const body = h('div', { class: 'aa-hold-pick' }); let choice = null;
  for (const id of ids) {
    const label = id === 'sol' ? 'Sol' : STAR_BY_ID[id].name;
    const note = id === 'sol' ? 'Home: your empire and the drydock' : S.ship.orbit === id ? 'Your starship is in orbit here' : sysOf(id).sites.some((x) => x.pop > 0) ? 'Colony' : 'Explored';
    body.append(h('button', { class: 'aa-pick', onclick: (e) => { choice = id; body.querySelectorAll('.aa-pick').forEach((b) => b.classList.remove('sel')); e.currentTarget.classList.add('sel'); } }, h('b', {}, label), h('span', {}, note)));
  }
  const ok = await modal({ title: 'Which system?', body, buttons: [{ label: 'Cancel', value: false }, { label: 'Show', value: true, primary: true }] });
  if (ok && choice) setMapMode('system', choice);
}

// ---------- Debug tools (prototype only)
function debugPane() {
  const unexplored = STARS.filter((st) => !S.stars[st.id].explored);
  const dlog = (m) => { log(`[debug] ${m}`); commit(); };
  const starSel = (id) => h('select', { id, 'aria-label': 'Star' }, STARS.map((st) => h('option', { value: st.id }, `${st.name}${S.stars[st.id].explored ? ' (explored)' : ''}`)));
  const btn = (label, fn) => h('button', { class: 'aa-op', onclick: fn, disabled: !!S.over && !/New/.test(label) }, label);
  return h('div', { class: 'aa-debug' },
    h('p', { class: 'muted' }, 'Prototype tools for testing. They bend the rules, and the log marks every use with [debug].'),
    h('h4', {}, 'Reveal'),
    h('div', { class: 'aa-ops' },
      btn(`Reveal all stars (${unexplored.length} left)`, () => { for (const st of unexplored) explore(st.id, 'debug'); dlog(`revealed ${unexplored.length} stars`); }),
      btn('Show every system map', () => { for (const st of STARS) if (!S.stars[st.id].explored) explore(st.id, 'debug'); dlog('revealed all'); pickSystem(); })),
    h('div', { class: 'aa-dbgrow' }, starSel('aa-dbg-reveal'), btn('Reveal', () => { const id = $('#aa-dbg-reveal').value; explore(id, 'debug'); dlog(`revealed ${STAR_BY_ID[id].name}`); setMapMode('system', id); })),
    h('h4', {}, 'Starship'),
    h('div', { class: 'aa-dbgrow' }, starSel('aa-dbg-orbit'), btn('Put in orbit', async () => {
      const id = $('#aa-dbg-orbit').value; const sh = S.ship;
      if (!sh.launched) { sh.launched = true; sh.exit = 'neptune'; S.phase = 'voyage'; S.turn = 0; startGeneration(); }
      sh.lost = false; sh.recycled = false; sh.prev = null; sh.next = null; sh.pos = id;
      await enterOrbit(id); dlog(`starship placed in orbit at ${STAR_BY_ID[id].name}`);
    })),
    h('div', { class: 'aa-ops' },
      btn('Starter ship (Medusa)', () => {
        const mk = (id, x = {}) => inst(id, x);
        S.ship.cards = [mk('medusa'), mk('winch'), mk('habring'), mk('lidar'), mk('seed'), mk('rover'), mk('magsail')]; S.ship.prop = 36; dlog('fitted a starter Medusa ship with 36 Pulse');
      }),
      btn('+12 propellant', () => { S.ship.prop += 12; dlog('+12 propellant'); }),
      btn('Repair all cards', () => { S.ship.cards.forEach((c) => { c.glitched = false; }); dlog('repaired every card'); }),
      btn('V +1', () => { S.ship.V = Math.min(TUNE.maxV, S.ship.V + 1); dlog(`V${S.ship.V}`); }),
      btn('V 0', () => { S.ship.V = 0; dlog('V0'); }),
      btn('+1 Seed', () => { S.ship.cards.push(inst('seed')); dlog('+1 Seed aboard'); })),
    h('h4', {}, 'Economy and clock'),
    h('div', { class: 'aa-ops' },
      btn('+10 Aqua', () => { S.aqua += 10; dlog('+10 Aqua'); }),
      btn('+1 Home op', () => { S.ops.home++; dlog('+1 Home op'); }),
      btn('+1 Frontier op', () => { S.ops.frontier++; dlog('+1 Frontier op'); }),
      btn('Gen -4 (more time)', () => { S.gen = Math.max(1, S.gen - 4); dlog(`Generation set to ${S.gen}`); }),
      btn('+4 cubes everywhere', () => { for (const sys of Object.values(S.systems)) for (const x of sys.sites) if (x.cubes > 0) x.cubes += 4; dlog('+4 cubes at every factory'); }),
      btn('All spin-offs', () => { for (const k of [1, 2, 3, 4]) if (!S.spinoffs.includes(SPINOFFS[k].effect)) S.spinoffs.push(SPINOFFS[k].effect); dlog('all spin-off tech'); })));
}

async function menuModal() {
  const v = await modal({ title: 'High Frontier: Ad Astra', body: '<p>A fan variant prototype. Your game saves in this browser.</p>', buttons: [{ label: 'Close', value: 0 }, { label: '🏆 Score', value: 1 }, { label: 'New game', value: 2, danger: true }] });
  if (v === 1) showScore();
  if (v === 2 && await modal({ title: 'New game?', body: 'Start over from the drydock. This game is lost.', buttons: [{ label: 'Keep playing', value: false }, { label: 'New game', value: true, danger: true }] })) { newGame(); MAPMODE = 'stars'; commit(); setupPick(); }
}
function clockModal() {
  const voyage = S.phase === 'voyage';
  const n = voyage ? TUNE.generations : TUNE.launchWindow; const cur = voyage ? S.gen : S.turn;
  const cells = Array.from({ length: n }, (_, i) => `<span class="aa-clockcell${i + 1 < cur ? ' done' : i + 1 === cur ? ' now' : ''}">${i + 1}</span>`).join('');
  modal({ title: voyage ? 'Generations Clock (AA-D3)' : 'Launch Window (AA-D2)', body: `<div class="aa-clockrow">${cells}</div><p class="muted">${voyage ? `The game ends after Generation ${n}. Each Generation is about 25 years.` : `Launch by the end of turn ${n}, or the starship is Grounded.`}</p>` });
}

// ================================================================ setup (AA-C2)
async function setupPick() {
  if (S.phase !== 'setup') return;
  const body = h('div', {}, h('p', {}, 'Draw 2 TW drives; keep one. Everyone starts with a TW drive (AA-C2). The other goes back into the deck.'));
  const row = h('div', { class: 'aa-hand-pick' });
  let choice = null;
  for (const id of S.setupChoice) {
    const c = { uid: -1, id, face: 'white' };
    const el = renderInst(c); el.classList.add('pickable');
    el.onclick = () => { choice = id; row.querySelectorAll('.aa-card').forEach((x) => x.classList.remove('sel')); el.classList.add('sel'); };
    row.append(el);
  }
  body.append(row);
  while (!choice) await modal({ title: 'Your starting TW drive', body, wide: true, buttons: [{ label: 'Keep this drive', value: true, primary: true }] });
  const other = S.setupChoice.find((x) => x !== choice);
  S.decks.drive.unshift(other);
  const c = inst(choice); S.ship.cards.push(c); S.ship.family = def(c).family;
  S.phase = 'drydock'; S.turn = 1; S.ops = { home: 1, frontier: 0, boosted: false, prospected: false };
  log(`Kept the ${def(c).name}. Drydock turn 1 of ${TUNE.launchWindow}: launch before the window closes (AA-D2).`, 'good');
  commit();
}

// ================================================================ boot
function start(data) {
  if (data && data.S) { S = data.S; _uid = data._uid || 1000; }
  else if (!load()) newGame();
  migrateSystems();
  if (S.ship.orbit) { MAPMODE = 'system'; SYSVIEW = S.ship.orbit; }
  render();
  if (S.phase === 'setup') setupPick();
  window.claude?.hot?.snapshot?.(() => ({ S, _uid }));
  window.__aa = { get state() { return S; }, get busy() { return BUSY; }, explore, enterOrbit, openPopup, setMapMode, get renderers() { return RENDERERS; }, get mode() { return MAPMODE; },
    setPane: (p) => { PANE = p; render(); }, endTurn, render, setTab, opIncome, opExpand, opResearch, opProduce, opLaunch, opBoost, newGame: () => { newGame(); commit(); setupPick(); } };
}
if (window.claude?.hot?.ready) window.claude.hot.ready(start);
else start(window.claude?.hot?.data ?? null);
