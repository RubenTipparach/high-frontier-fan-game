// HIGH FRONTIER: AD ASTRA - playable solo prototype.
//
// Implements docs/ad-astra/rules.md (v0.5). The rulebook is the source of
// truth: every rule below cites its ID, and where this file and the book
// disagree, this file is wrong. Cards are drawn by the game's own renderer
// (js/game/card-ui.js#renderCard) so they look like the real cards.

import { renderCard } from '../../../js/game/card-ui.js';
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
const R = 18; // px per space
function polar([deg, r]) { const a = deg * Math.PI / 180; return { x: Math.cos(a) * r * R, y: Math.sin(a) * r * R }; }
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
function newGame() {
  const decks = {};
  for (const [role, ids] of Object.entries(DECKS)) decks[role] = shuffle(ids.slice());
  const stars = {};
  for (const st of STARS) stars[st.id] = { explored: false, hz: null, comps: [] };
  S = {
    v: 5, phase: 'setup', turn: 1, gen: 0, aqua: TUNE.startAqua,
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
  try { const raw = localStorage.getItem('ad-astra-proto'); if (!raw) return false; const o = JSON.parse(raw); if (!o.S || o.S.v !== 5) return false; S = o.S; _uid = o._uid || 1000; return true; } catch (e) { return false; }
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
  S.systems[starId] = genSystem(starId);
  const found = S.systems[starId].sites.filter((x) => x.kind === 'world' || x.kind === 'ocean').map((x) => `${x.name} (${x.cls})`);
  log(`Explored ${star.name} by ${how}: ${found.length ? found.join(', ') : 'no worlds of note'}. +1 VP (AA-G12).`, 'good');
  return true;
}
function genSystem(starId) { // AA-B7a: a small map in the Sol map idiom
  const star = STAR_BY_ID[starId]; const st = S.stars[starId];
  const nodes = [], edges = [], sites = [];
  const P = (deg, r) => ({ x: Math.cos(deg * Math.PI / 180) * r, y: Math.sin(deg * Math.PI / 180) * r });
  const node = (id, kind, pos, label) => nodes.push({ id, kind, ...pos, label });
  const site = (o) => sites.push({ claimed: false, cubes: 0, pop: 0, step: 0, startStep: 0, ...o });
  node('high', 'orbit', P(270, 250), 'High Orbit');
  // inner hot rock (always)
  node('rockLO', 'burn', P(200, 70), 'Low orbit');
  site({ id: 'rock', node: 'rockLO', kind: 'world', name: `${star.name} I`, cls: 'Hostile', size: rint(4, 6), hyd: rint(0, 1), spec: ['M', 'V'][rint(0, 1)], ring: 70, ang: 200, terra: true });
  edges.push(['high', 'rockLO', 2]);
  // habitable-zone world from its chit
  if (st.hz && st.hz.startsWith && st.hz !== 'None') {
    const [lo, hi] = CLASS_HYD[st.hz];
    node('hzLO', 'burn', P(330, 145), 'Low orbit');
    const nm = S.worldNames.pop() || 'World';
    site({ id: 'hz', node: 'hzLO', kind: 'world', name: `${nm}`, cls: st.hz, size: rint(6, 9), hyd: rint(lo, hi), spec: SPEC[rint(0, 3)], ring: 145, ang: 330, terra: true,
      step: st.hz === 'Marginal' ? 2 : st.hz === 'Habitable' ? 3 : st.hz === 'Garden' ? 4 : 0 });
    sites[sites.length - 1].startStep = sites[sites.length - 1].step;
    edges.push(['high', 'hzLO', 2]);
  }
  // asteroid belt mines
  node('belt', 'burn', P(80, 195), 'Belt');
  edges.push(['high', 'belt', 1]);
  const nMines = rint(2, 3);
  for (let i = 0; i < nMines; i++) {
    const ang = 40 + i * 45;
    node(`m${i}L`, 'lagrange', P(ang, 210), 'Mine');
    site({ id: `m${i}`, node: `m${i}L`, kind: 'mine', name: `${star.name.split(' ')[0]} belt ${String.fromCharCode(65 + i)}`, cls: null, size: rint(3, 6), hyd: rint(0, 4), spec: SPEC[rint(0, 3)], ring: 210, ang });
    edges.push(['belt', `m${i}L`, 1]);
  }
  // companions
  st.comps.forEach((cmp, i) => {
    const ang = i === 0 ? 20 : 150;
    const nid = `c${i}L`;
    node(nid, 'lagrange', P(ang, 265), cmp.kind === 'gas' ? 'Gas giant' : cmp.kind === 'brown' ? 'Brown dwarf' : 'White dwarf');
    nodes[nodes.length - 1].body = cmp.kind;
    edges.push(['high', nid, 2]);
    if (cmp.chit === 'Ocean') {
      const nm = cmp.kind === 'gas' ? `${star.name.split(' ')[0]} icy moon` : `${star.name.split(' ')[0]} dark world`;
      site({ id: `c${i}`, node: nid, kind: 'ocean', name: nm, cls: 'Hostile', size: rint(5, 7), hyd: rint(7, 9), spec: 'C', ring: 265, ang, terra: false, body: cmp.kind });
    }
  });
  return { nodes, edges, sites, landfall: [], blueprints: [] };
}
const siteById = (starId, id) => sysOf(starId)?.sites.find((x) => x.id === id);
function sysNeighbors(starId, nodeId) { return sysOf(starId).edges.filter((e) => e[0] === nodeId || e[1] === nodeId).map((e) => ({ to: e[0] === nodeId ? e[1] : e[0], burns: e[2] })); }
function sysPath(starId, from, to) { // cheapest burns (Dijkstra, tiny graph)
  const dist = { [from]: 0 }, prev = {}, done = new Set();
  while (true) {
    let best = null; for (const [k, v] of Object.entries(dist)) if (!done.has(k) && (best == null || v < dist[best])) best = k;
    if (best == null) return null; if (best === to) break; done.add(best);
    for (const nb of sysNeighbors(starId, best)) { const nd = dist[best] + nb.burns; if (dist[nb.to] == null || nd < dist[nb.to]) { dist[nb.to] = nd; prev[nb.to] = best; } }
  }
  return dist[to];
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
  try { el = renderCard(card, { face: c.face !== 'white' ? 'secondary' : 'primary' }); }
  catch (e) { el = h('div', { class: 'aa-cardfallback' }, d.name); }
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
  if (!(site.kind === 'world' || site.kind === 'ocean')) { toast('Mines are never homes (AA-H2).'); return; }
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
  site.step = next;
  const so = SPINOFFS[next]; S.spinoffs.push(so.effect);
  log(`Terraform: ${site.name} is now ${tf.reach}. Spin-off: ${so.name} (${so.text}) (AA-H10).`, 'good');
  if (next >= 3) site.cls = next === 4 ? 'Garden' : 'Habitable';
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
function freeSysMove(toNode) { // AA-H1: in-system moves pay propellant per burn
  const sh = S.ship; const starId = sh.orbit;
  const f = family();
  if (!['Pulse', 'Fusion', 'Antimatter'].includes(f) || driveProblem()) { toast('This drive cannot maneuver inside a system. Raygun from High Orbit, or use Landers.'); return; }
  const nb = sysNeighbors(starId, sh.sysNode).find((x) => x.to === toNode);
  if (!nb) { toast('Move one leg at a time along the lines.'); return; }
  if (sh.sysBurnsGen !== S.gen) { sh.sysBurnsGen = S.gen; sh.sysBurns = 0; }
  if (sh.sysBurns + nb.burns > driveDef().thrust) { toast(`Thrust ${driveDef().thrust}: no more burns this Generation.`); return; }
  let p = sh.prop, cost = 0;
  for (let i = 0; i < nb.burns; i++) { const c = driveDef().fuel * classFor(totalMass(p)).x; cost += c; p -= c; }
  if (cost > sh.prop) { toast(`That leg costs ${cost} propellant; ${sh.prop} aboard.`); return; }
  sh.prop -= cost; sh.sysBurns += nb.burns; sh.sysNode = toNode;
  const nd = sysOf(starId).nodes.find((n) => n.id === toNode);
  log(`Moved to ${nd.label} in ${nb.burns} burn${nb.burns > 1 ? 's' : ''} (${cost} ${f}).`); commit();
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
    if (sh.V > 0 && star.comp.some((c) => c === 'gas' || c === 'brown')) {
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
  sh.orbit = starId; sh.sysNode = 'high'; sh.V = 0; sh.next = null; sh.pos = starId;
  SEL.sysView = null; SEL.site = null;
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
async function loseLowestRad() {
  const cards = S.ship.cards.filter((c) => c.face === 'white'); if (!cards.length) return;
  const c = cards.sort((a, b) => def(a).rad - def(b).rad)[0];
  S.ship.cards = S.ship.cards.filter((x) => x.uid !== c.uid);
  log(`Flare: ${def(c).name} (rad hardness ${def(c).rad}) is fried.`, 'bad');
}

// ================================================================ SCORING (AA-I)
function score() {
  const rows = [];
  let tf = 0, popVp = 0, worldVp = 0, sysVp = 0, fact = 0;
  for (const [id, sys] of Object.entries(S.systems)) {
    let any = false;
    for (const x of sys.sites) {
      if (x.kind === 'world' && x.step > x.startStep) tf += (TERRAFORM[x.step]?.vp || 0) - (TERRAFORM[x.startStep]?.vp || 0);
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

// ================================================================ RENDER
let TAB = 'ship';
let SEL = { star: null, site: null };
function setTab(t) { TAB = t; render(); }
function commit() { save(); render(); }

function render() {
  const app = $('#aa-app'); if (!app) return;
  app.replaceChildren(topBar(), h('div', { class: 'aa-main' }, homePanel(), centerPanel(), sidePanel()));
}
function topBar() {
  const phase = S.phase === 'setup' ? 'Setup' : S.phase === 'drydock' ? `Act I - Drydock` : S.ship.orbit ? (colonySystems().length ? 'Act III - Colonies' : 'Act II - Reaching the Stars') : 'Act II - Reaching the Stars';
  const clock = S.phase === 'voyage'
    ? h('div', { class: 'aa-clock', title: `Generations Clock (AA-D3): the game ends after Generation ${TUNE.generations}` }, Array.from({ length: TUNE.generations }, (_, i) => h('span', { class: i + 1 < S.gen ? 'done' : i + 1 === S.gen ? 'now' : '' }, i + 1)))
    : h('div', { class: 'aa-clock', title: `Launch Window (AA-D2): launch by the end of turn ${TUNE.launchWindow}` }, Array.from({ length: TUNE.launchWindow }, (_, i) => h('span', { class: i + 1 < S.turn ? 'done' : i + 1 === S.turn ? 'now' : '' }, i + 1)));
  return h('header', { class: 'aa-top' },
    h('div', { class: 'aa-brand' }, h('span', { class: 'aa-title' }, 'HIGH FRONTIER: AD ASTRA'), h('span', { class: 'aa-phase' }, phase)),
    clock,
    h('div', { class: 'aa-chips' },
      h('span', { class: 'aa-chip', title: 'Aqua: your Sol treasury' }, 'Aqua ', h('b', {}, S.aqua)),
      h('span', { class: 'aa-chip' + (S.ops.home ? ' live' : ''), title: 'Home operation (AA-D1)' }, 'Home op ', h('b', {}, S.ops.home)),
      S.phase === 'voyage' ? h('span', { class: 'aa-chip' + (S.ops.frontier ? ' live' : ''), title: 'Frontier operations: one per starship and one per colony system (AA-D1)' }, 'Frontier ops ', h('b', {}, S.ops.frontier)) : null,
      h('button', { class: 'aa-btn primary', onclick: endTurn, disabled: S.phase === 'setup' || !!S.over || BUSY }, BUSY ? 'Moving...' : S.phase === 'voyage' ? 'End Generation' : 'End turn'),
      h('button', { class: 'aa-btn ghost', onclick: showScore }, 'Score'),
      h('button', { class: 'aa-btn ghost', onclick: async () => { if (await modal({ title: 'New game?', body: 'Start over from the drydock. This game is lost.', buttons: [{ label: 'Keep playing', value: false }, { label: 'New game', value: true, danger: true }] })) { newGame(); commit(); setupPick(); } } }, 'New game')));
}

function homePanel() {
  const launched = S.ship.launched;
  const hand = h('div', { class: 'aa-hand' });
  for (const c of S.hand) hand.append(renderInst(c, { small: true, actions: !launched ? [h('button', { class: 'aa-mini', onclick: () => opBoost(c) }, `Boost (${def(c).mass} Aqua)`)] : [] }));
  return h('section', { class: 'aa-panel aa-home', 'aria-label': 'Home theatre' },
    h('h2', {}, 'Home: Sol ', h('small', {}, 'no movement (AA-S1)')),
    h('div', { class: 'aa-holds' }, HOLDINGS.map((hd) => h('div', { class: 'aa-hold' + (owns(hd.id) ? ' own' : ''), title: hd.desc }, h('b', {}, hd.name), h('span', {}, owns(hd.id) ? 'Owned' : `${hd.cost} Aqua`)))),
    h('div', { class: 'aa-ops' },
      opBtn('Income', `+${1 + (owns('market') ? 1 : 0)} Aqua`, opIncome),
      opBtn('Research', '1 Aqua per card', () => opResearch('hand')),
      opBtn('Expand', 'Buy a Holding', opExpand),
      !launched ? opBtn('Produce', family() ? `${family()} propellant` : 'Needs a Drive', opProduce) : opBtn('Transmit', 'Send a design', opTransmit),
      opBtn('Lens Survey', owns('lens') ? 'Explore a star' : 'Needs Observatory', opLensSurvey, !owns('lens')),
      !launched ? h('button', { class: 'aa-op launch', onclick: opLaunch, disabled: S.phase !== 'drydock' }, 'Launch', h('small', {}, `${launchChecks().filter((x) => x.ok).length} of 4 checks pass`)) : null),
    h('h3', {}, `Hand (${S.hand.length})`),
    S.hand.length ? hand : h('p', { class: 'aa-dim' }, launched ? 'Research here, then Transmit designs to your colonies.' : 'Research to draw cards, then Boost them onto the starship.'));
}
const opBtn = (label, sub, fn, disabled) => h('button', { class: 'aa-op', onclick: fn, disabled: disabled || S.phase === 'setup' || !!S.over || S.ops.home < 1 }, label, h('small', {}, sub));

function centerPanel() {
  const tabs = [['ship', 'Starship'], ['map', 'Star map'], ['system', S.ship.orbit ? STAR_BY_ID[S.ship.orbit].name : 'System']];
  const body = TAB === 'ship' ? shipView() : TAB === 'map' ? mapView() : systemView();
  return h('section', { class: 'aa-panel aa-center' },
    h('div', { class: 'aa-tabs', role: 'tablist' }, tabs.map(([id, lb]) => h('button', { role: 'tab', 'aria-selected': TAB === id ? 'true' : 'false', class: 'aa-tab' + (TAB === id ? ' on' : ''), onclick: () => setTab(id) }, lb))),
    body);
}

function shipView() {
  const sh = S.ship; const dd = driveDef();
  const tm = totalMass(); const cl = classFor(tm);
  const wrap = h('div', { class: 'aa-shipview' });
  const slots = [['drive', 'Drive'], ['support', 'Supports'], ['brake', 'Brake'], ['payload', 'Payload'], ['prospector', 'Prospector'], ['seed', 'Seed'], ['shield', 'Shield']];
  const placard = h('div', { class: 'aa-placard' });
  for (const [role, label] of slots) {
    const cards = S.ship.cards.filter((c) => def(c).role === role);
    const col = h('div', { class: 'aa-slot' }, h('label', {}, label));
    if (!cards.length) col.append(h('div', { class: 'aa-ghost' }, role === 'brake' ? 'Optional. Some drives brake themselves.' : role === 'shield' ? 'Optional. Absorbs dust.' : role === 'support' ? 'What the drive requires.' : 'Empty'));
    for (const c of cards) {
      const acts = [];
      if (c.glitched && sh.crew) acts.push(h('button', { class: 'aa-mini', onclick: () => freeRepair(c) }, 'Repair'));
      if (S.event && S.event.flipFree && c.face === 'white') acts.push(h('button', { class: 'aa-mini good', onclick: () => freeFlipEvent(c) }, 'Flip free'));
      if (!S.over) acts.push(h('button', { class: 'aa-mini bad', onclick: () => freeJettison(c) }, 'Jettison'));
      col.append(renderInst(c, { small: true, actions: acts }));
    }
    placard.append(col);
  }
  const per = PROP_PER_MASS[family()] || Infinity;
  const pips = h('div', { class: 'aa-pips', 'aria-label': `${sh.prop} propellant` });
  if (per !== Infinity) for (let i = 1; i <= Math.max(sh.prop, 6); i++) pips.append(h('span', { class: 'aa-pip' + (i <= sh.prop ? ' full' : '') + (i % per === 0 ? ' mass' : '') }, i <= sh.prop ? FAMILY_GLYPH[family()] : ''));
  const ladder = h('table', { class: 'aa-ladder' }, CLASSES.map((c) => h('tr', { class: c === cl ? 'cur' : '' }, h('td', {}, c.name), h('td', {}, `${c.lo}${c.hi < 999 ? `-${c.hi}` : '+'}`), h('td', { class: 'x' }, `x${c.x}`))));
  const tb = totalBurns();
  const plan = h('div', { class: 'aa-plan' },
    dd ? h('div', {}, `${dd.name}: Thrust ${dd.thrust}, Fuel ${dd.fuel}, ${FAMILY_GLYPH[dd.family]} ${dd.family}. ${dd.brake === true ? 'Can brake.' : dd.brake === 'staged' ? 'Staged sail: one -2 V brake at a star.' : 'Cannot brake.'}`) : h('div', {}, 'No drive.'),
    h('div', {}, 'Mass: ', h('b', {}, `${dryMass()} dry + ${propMass()} propellant = ${tm}`), ` (${cl.name}, x${cl.x})`),
    tb != null ? h('div', {}, 'Propellant: ', h('b', {}, `${sh.prop}`), ` = `, h('b', {}, `${tb} Burns`), ' at today\'s mass.') : h('div', {}, dd ? (dd.family === 'Beam' ? `Beam: 1 Aqua per Burn while within ${TUNE.beamRangeSpaces} spaces of Sol, with a Beam Station.` : 'Ramscoop: free above V2; the Beam Station lights it.') : ''));
  const trip = h('table', { class: 'aa-trip' }, h('tr', {}, h('th', {}, 'Destination'), h('th', {}, 'Spaces'), h('th', {}, 'Gens at V1'), h('th', {}, 'V2'), h('th', {}, 'V3')),
    STARS.slice().sort((a, b) => MAP.dist[a.id] - MAP.dist[b.id]).slice(0, 8).map((st) => h('tr', {}, h('td', {}, st.name), h('td', {}, MAP.dist[st.id]), ...[1, 2, 3].map((v) => h('td', {}, Math.ceil(MAP.dist[st.id] / v))))));
  const checks = h('ul', { class: 'aa-check' }, launchChecks().map((c) => h('li', { class: c.ok ? 'ok' : 'no' }, c.ok ? '✓ ' : '✗ ', c.text, ' ', h('small', {}, c.id))));
  wrap.append(placard, h('div', { class: 'aa-shipside' },
    h('div', { class: 'aa-box' }, h('h3', {}, 'Mass ratio (AA-F4)'), plan, ladder, per !== Infinity ? h('div', {}, h('small', { class: 'aa-dim' }, `Every ${per} propellant weighs 1 Mass.`), pips) : null),
    !sh.launched ? h('div', { class: 'aa-box' }, h('h3', {}, 'Launch check (AA-E5)'), checks) : null,
    h('div', { class: 'aa-box' }, h('h3', {}, 'Trip planner'), h('p', { class: 'aa-dim' }, 'Spaces from Sol. Add Burns to speed up and to stop again.'), trip)));
  return wrap;
}

// ----- star map view
function mapView() {
  const sh = S.ship;
  const svg = s('svg', { viewBox: '-500 -480 1000 960', class: 'aa-starmap', role: 'img', 'aria-label': 'Star map' });
  const g = s('g');
  svg.append(s('defs', {}, s('radialGradient', { id: 'gSol' }, s('stop', { offset: '0%', 'stop-color': '#fff7d6' }), s('stop', { offset: '100%', 'stop-color': '#fbbf24' }))));
  // range rings
  for (const r of [TUNE.beamRangeSpaces, TUNE.lensRangeSpaces]) g.append(s('circle', { cx: 0, cy: 0, r: r * R, class: 'aa-range' }));
  g.append(s('text', { x: 4, y: -TUNE.beamRangeSpaces * R - 4, class: 'aa-rangelbl' }, 'beam range'));
  g.append(s('text', { x: 4, y: -TUNE.lensRangeSpaces * R - 4, class: 'aa-rangelbl' }, 'lens range'));
  // edges
  for (const [a, nbs] of Object.entries(MAP.adj)) for (const b of nbs) if (a < b) g.append(s('line', { x1: MAP.nodes[a].x, y1: MAP.nodes[a].y, x2: MAP.nodes[b].x, y2: MAP.nodes[b].y, class: 'aa-path' }));
  // predicted course
  if (sh.launched && !sh.orbit && !sh.lost && sh.V > 0) {
    let prev = sh.prev, cur = sh.pos, nxt = sh.next;
    for (let i = 0; i < sh.V; i++) {
      const opts = MAP.adj[cur].filter((n) => n !== prev);
      const n = nxt && opts.includes(nxt) ? nxt : opts.length === 1 ? opts[0] : null;
      if (!n) break;
      g.append(s('line', { x1: MAP.nodes[cur].x, y1: MAP.nodes[cur].y, x2: MAP.nodes[n].x, y2: MAP.nodes[n].y, class: 'aa-course' }));
      prev = cur; cur = n; nxt = null;
    }
  }
  // spaces
  for (const nd of Object.values(MAP.nodes)) {
    if (nd.kind === 'space') g.append(s('circle', { cx: nd.x, cy: nd.y, r: 2.6, class: 'aa-space' }));
    if (nd.kind === 'junction') g.append(s('circle', { cx: nd.x, cy: nd.y, r: 4.5, class: 'aa-junction' }));
    if (nd.kind === 'oort') g.append(s('circle', { cx: nd.x, cy: nd.y, r: 5, class: 'aa-oort' }, s('title', {}, `Oort cloud of ${nd.of === 'sol' ? 'Sol' : STAR_BY_ID[nd.of].name}: icebrake here`)));
    if (nd.kind === 'dust') g.append(s('g', {}, s('circle', { cx: nd.x, cy: nd.y, r: 6, class: 'aa-dust' }), s('title', {}, 'Dust: a strike costs a card unless shielded')));
    if (nd.kind === 'sunlens') {
      const t = MAP.nodes[nd.target]; const a = Math.atan2(t.y - nd.y, t.x - nd.x);
      g.append(s('g', {}, s('rect', { x: nd.x - 4, y: nd.y - 4, width: 8, height: 8, transform: `rotate(45 ${nd.x} ${nd.y})`, class: 'aa-lens' }),
        s('line', { x1: nd.x, y1: nd.y, x2: nd.x + Math.cos(a) * 16, y2: nd.y + Math.sin(a) * 16, class: 'aa-lensarrow' }),
        s('title', {}, `Sunlens aimed at ${STAR_BY_ID[nd.target].name}: passing here explores it`)));
    }
  }
  // stars
  const COL = { yellow: '#fbbf24', red: '#f87171', brown: '#b45309' };
  for (const st of STARS) {
    const nd = MAP.nodes[st.id]; const info = S.stars[st.id];
    const grp = s('g', { class: 'aa-star' + (SEL.star === st.id ? ' sel' : ''), tabindex: 0, role: 'button', 'aria-label': st.name, onclick: () => { SEL.star = st.id; render(); }, onkeydown: (e) => { if (e.key === 'Enter') { SEL.star = st.id; render(); } } });
    if (st.hazard === 'flare') grp.append(s('circle', { cx: nd.x, cy: nd.y, r: 19, class: 'aa-flare' }));
    if (st.hazard === 'debris') grp.append(s('circle', { cx: nd.x, cy: nd.y, r: 19, class: 'aa-debris' }));
    grp.append(s('circle', { cx: nd.x, cy: nd.y, r: 13, class: 'aa-starspace' }));
    grp.append(s('circle', { cx: nd.x, cy: nd.y, r: st.type === 'brown' ? 5 : 7, fill: COL[st.type] }));
    st.comp.forEach((c, i) => grp.append(s('circle', { cx: nd.x + 10 + i * 7, cy: nd.y - 10, r: 3.2, fill: c === 'gas' ? '#fdba74' : c === 'brown' ? '#92400e' : '#e5e7eb', stroke: '#0b0918' })));
    grp.append(s('text', { x: nd.x, y: nd.y + 27, class: 'aa-starlbl' }, st.name));
    if (info.explored) {
      const ws = sysOf(st.id).sites.filter((x) => x.kind === 'world' && x.id === 'hz' || x.kind === 'ocean');
      const badge = ws.length ? ws.map((x) => CLS_LETTER[x.cls]).join('') : '-';
      grp.append(s('g', {}, s('rect', { x: nd.x - 13, y: nd.y + 32, width: 26, height: 13, rx: 3, class: 'aa-chitbadge' }), s('text', { x: nd.x, y: nd.y + 42, class: 'aa-chittxt' }, badge)));
      if (sysOf(st.id).sites.some((x) => x.pop > 0)) grp.append(s('circle', { cx: nd.x - 15, cy: nd.y - 12, r: 4, class: 'aa-colonydot' }));
    } else grp.append(s('text', { x: nd.x, y: nd.y + 42, class: 'aa-unknown' }, '?'));
    g.append(grp);
  }
  // Sol
  g.append(s('circle', { cx: 0, cy: 0, r: 15, fill: 'url(#gSol)' }), s('text', { x: 0, y: 32, class: 'aa-starlbl' }, 'Sol'));
  // ship
  if (sh.launched && !sh.lost) {
    const at = MAP.nodes[sh.orbit || sh.pos];
    let ang = -90;
    const toward = sh.next || (sh.prev ? null : null);
    if (sh.prev) { const p = MAP.nodes[sh.prev]; ang = Math.atan2(at.y - p.y, at.x - p.x) * 180 / Math.PI; }
    else if (toward) { const t = MAP.nodes[toward]; ang = Math.atan2(t.y - at.y, t.x - at.x) * 180 / Math.PI; }
    g.append(s('g', { transform: `translate(${at.x} ${at.y + (sh.orbit ? -20 : 0)}) rotate(${ang})`, class: 'aa-shipmark' }, s('path', { d: 'M10 0 L-7 -6 L-4 0 L-7 6 Z' }), s('title', {}, `Your starship, V${sh.V}`)));
  }
  svg.append(g);
  // info under map
  const st = SEL.star && STAR_BY_ID[SEL.star];
  const fromShip = sh.launched && !sh.lost ? bfs(sh.orbit || sh.pos) : null;
  const panel = h('div', { class: 'aa-mapinfo' });
  if (st) {
    const info = S.stars[st.id];
    panel.append(h('h3', {}, st.name),
      h('p', {}, `${st.type === 'yellow' ? 'Yellow sun' : st.type === 'red' ? 'Red dwarf' : 'Brown dwarf'}${st.comp.length ? `, companions: ${st.comp.map((c) => ({ gas: 'gas giant', brown: 'brown dwarf', white: 'white dwarf' }[c])).join(', ')}` : ''}${st.hazard ? `, ${st.hazard === 'flare' ? 'flare star' : 'debris disk'}` : ''}${st.known ? `. Known planet: ${st.known}` : ''}.`),
      h('p', {}, `${MAP.dist[st.id]} spaces from Sol${fromShip ? `, ${fromShip[st.id]} from your starship` : ''}.`),
      info.explored ? h('p', {}, 'Explored: ', sysOf(st.id).sites.filter((x) => x.kind !== 'mine').map((x) => `${x.name} (${x.cls})`).join(', ')) : h('p', { class: 'aa-dim' }, 'Unexplored. Pass through it, sit at its sunlens, or Lens Survey it to learn what orbits there (AA-G12).'));
  } else panel.append(h('p', { class: 'aa-dim' }, 'Select a star. Dots are spaces, half a light-year each. Blue rings are Oort clouds (icebrake), brown blots are Dust, gold diamonds are sunlens points. Badges under explored stars list the worlds found: G Garden, H Habitable, M Marginal, X Hostile, - none.'));
  return h('div', { class: 'aa-mapwrap' }, h('div', { class: 'aa-svgbox' }, svg), panel);
}

// ----- system view (AA-B7a)
const CLS_LETTER = { Garden: 'G', Habitable: 'H', Marginal: 'M', Hostile: 'X' };
const SPEC_COL = { C: '#3f3f46', S: '#c2410c', M: '#9ca3af', V: '#7c3aed', D: '#7f1d1d', H: '#0ea5e9' };
const CLS_COL = { Garden: '#22c55e', Habitable: '#84cc16', Marginal: '#eab308', Hostile: '#ef4444' };
function hexPts(cx, cy, r) { return Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 3 * i; return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`; }).join(' '); }
function systemView() {
  const sh = S.ship; const starId = SEL.sysView || sh.orbit || colonySystems()[0] || Object.keys(S.systems)[0];
  if (!starId || !sysOf(starId)) return h('div', { class: 'aa-empty' }, h('p', {}, 'No system to show yet. Explore a star (fly through it, sunlens, or Lens Survey) to see its map; stop in orbit to work it.'));
  const sys = sysOf(starId); const star = STAR_BY_ID[starId];
  const here = sh.orbit === starId;
  const svg = s('svg', { viewBox: '-320 -300 640 600', class: 'aa-sysmap', role: 'img', 'aria-label': `${star.name} system map` });
  const COL = { yellow: '#fbbf24', red: '#f87171', brown: '#b45309' };
  svg.append(s('circle', { cx: 0, cy: 0, r: 34, fill: COL[star.type], class: 'aa-sysstar' }));
  for (const r of [70, 145, 210, 265]) svg.append(s('circle', { cx: 0, cy: 0, r, class: 'aa-orbit' }));
  // edges with burn labels
  const byId = Object.fromEntries(sys.nodes.map((n) => [n.id, n]));
  for (const [a, b, burns] of sys.edges) {
    const A = byId[a], B = byId[b];
    svg.append(s('line', { x1: A.x, y1: A.y, x2: B.x, y2: B.y, class: 'aa-sysedge' }));
    const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
    svg.append(s('g', {}, s('circle', { cx: mx, cy: my, r: 8, class: 'aa-burnchip' }), s('text', { x: mx, y: my + 3.5, class: 'aa-burntxt' }, burns)));
  }
  // companion bodies (gas giant, brown or white dwarf) sit behind their Lagrange ring
  for (const n of sys.nodes.filter((q) => q.body)) {
    const off = { x: n.x * 0.12, y: n.y * 0.12 };
    svg.append(s('circle', { cx: n.x + off.x, cy: n.y + off.y, r: n.body === 'gas' ? 24 : n.body === 'brown' ? 18 : 8, fill: n.body === 'gas' ? '#fdba74' : n.body === 'brown' ? '#92400e' : '#f1f5f9', class: 'aa-body' }));
    svg.append(s('text', { x: n.x + off.x, y: n.y + off.y + 36, class: 'aa-sitelbl' }, n.label));
  }
  // sites
  for (const x of sys.sites) {
    const n = byId[x.node];
    const bodyR = x.kind === 'mine' ? 0 : x.kind === 'ocean' ? 22 : x.id === 'hz' ? 26 : 16;
    const cx = n.x + (x.kind === 'mine' ? 0 : Math.cos(x.ang * Math.PI / 180) * 34);
    const cy = n.y + (x.kind === 'mine' ? 0 : Math.sin(x.ang * Math.PI / 180) * 34);
    if (bodyR) svg.append(s('circle', { cx, cy, r: bodyR, class: 'aa-halo', fill: CLS_COL[x.cls] || '#64748b' }));
    const g = s('g', { class: 'aa-site' + (SEL.site === x.id ? ' sel' : '') + (x.goo ? ' goo' : ''), tabindex: 0, role: 'button', 'aria-label': x.name, onclick: () => { SEL.site = x.id; SEL.sysView = starId; render(); } });
    g.append(s('polygon', { points: hexPts(cx, cy, 13), fill: SPEC_COL[x.spec], class: 'aa-hex' }));
    g.append(s('text', { x: cx, y: cy + 4, class: 'aa-hextxt' }, x.size));
    g.append(s('text', { x: cx, y: cy + 27, class: 'aa-sitelbl' }, x.name));
    if (x.claimed) g.append(s('rect', { x: cx + 7, y: cy - 16, width: 8, height: 8, class: 'aa-claim' }));
    if (x.cubes) g.append(s('g', {}, s('rect', { x: cx - 18, y: cy - 18, width: 14, height: 11, rx: 2, class: 'aa-cubes' }), s('text', { x: cx - 11, y: cy - 9.5, class: 'aa-cubetxt' }, x.cubes)));
    if (x.pop) g.append(s('g', {}, s('path', { d: `M${cx - 9} ${cy + 18} a9 9 0 0 1 18 0 z`, class: 'aa-dome' }), s('text', { x: cx, y: cy + 16.5, class: 'aa-cubetxt' }, x.pop)));
    svg.append(g);
  }
  // nodes (burn pads magenta, lagrange orange rings, high orbit)
  for (const n of sys.nodes) {
    const adjacent = here && shipActive() && sysNeighbors(starId, sh.sysNode).some((x) => x.to === n.id);
    const cls = n.kind === 'burn' ? 'aa-burnpad' : n.kind === 'lagrange' ? 'aa-lagrange' : 'aa-high';
    const el = s('g', { class: 'aa-sysnode' + (adjacent ? ' can' : ''), onclick: () => adjacent && freeSysMove(n.id) },
      n.kind === 'burn' ? s('rect', { x: n.x - 6, y: n.y - 6, width: 12, height: 12, rx: 2, class: cls }) : s('circle', { cx: n.x, cy: n.y, r: n.kind === 'orbit' ? 9 : 7, class: cls }),
      s('title', {}, `${n.label}${adjacent ? ': click to move here' : ''}`));
    svg.append(el);
  }
  svg.append(s('text', { x: byId.high.x, y: byId.high.y - 16, class: 'aa-sitelbl' }, 'High Orbit (arrival)'));
  if (here) { const n = byId[sh.sysNode]; svg.append(s('g', { transform: `translate(${n.x} ${n.y - 14})`, class: 'aa-shipmark' }, s('path', { d: 'M0 8 L-6 -6 L0 -3 L6 -6 Z' }))); }
  const others = Object.keys(S.systems).filter((id) => id !== starId);
  return h('div', { class: 'aa-syswrap' },
    h('div', { class: 'aa-syshead' }, h('h3', {}, star.name), here ? h('span', { class: 'aa-pill good' }, 'In orbit') : h('span', { class: 'aa-pill' }, 'Not here'),
      others.length ? h('select', { 'aria-label': 'Show another system', id: 'aa-syspick', onchange: (e) => { SEL.sysView = e.target.value; SEL.site = null; render(); } }, h('option', { value: starId }, 'Other explored systems...'), others.map((id) => h('option', { value: id }, STAR_BY_ID[id].name))) : null),
    h('div', { class: 'aa-svgbox' }, svg),
    h('p', { class: 'aa-dim' }, 'Hexes are sites: the number is Size, the colour is spectral type, the halo is the world class. Magenta squares are burn pads, orange rings Lagrange points; numbers on the lines are burns. ',
      here ? 'Click a highlighted node to move there (pays propellant, up to your Thrust per Generation).' : ''));
}

// ----- side panel: frontier status, site actions, log
function sidePanel() {
  const sh = S.ship;
  const kids = [];
  if (S.phase === 'voyage') {
    const st = h('div', { class: 'aa-box' }, h('h3', {}, 'Frontier'),
      sh.lost ? h('p', { class: 'aa-bad' }, 'Your starship is lost.') :
      h('div', {},
        h('div', { class: 'aa-vrow' }, h('span', { class: 'aa-v' }, `V${sh.V}`), h('span', {}, sh.orbit ? `In orbit at ${STAR_BY_ID[sh.orbit].name}` : `In ${nodeName(sh.pos)}`, sh.recycled ? ' (drive recycled)' : '')),
        !sh.orbit && sh.V > 0 ? h('p', { class: 'aa-dim' }, courseNote()) : null,
        h('p', { class: 'aa-dim' }, `Propellant ${sh.prop}${family() ? ` ${family()}` : ''}. Population aboard ${shipPop()}.`)));
    kids.push(st);
    if (S.event) kids.push(h('div', { class: 'aa-box ev' }, h('h3', {}, `Event: ${S.event.name}`), h('p', {}, S.event.text), S.event.note ? h('p', { class: 'aa-dim' }, S.event.note) : null));
    const acts = h('div', { class: 'aa-acts' });
    const fo = (label, fn, dis, tip) => acts.append(h('button', { class: 'aa-op', disabled: dis || !!S.over, onclick: fn, title: tip || '' }, label));
    if (shipActive()) {
      fo(sh.orbit ? 'Burn (leave orbit)' : 'Burn', opBurn, S.ops.frontier < 1);
      if (hasBrake('magsail') && !sh.orbit && sh.V > 0) fo('Magsail -1 V (free)', freeMagsail, sh.magsailUsedGen === S.gen);
      if (sh.orbit && STAR_BY_ID[sh.orbit].comp.includes('gas')) { const gasNode = sysOf(sh.orbit).nodes.find((n) => n.body === 'gas'); fo('Skim gas giant', opSkim, S.ops.frontier < 1 || sh.sysNode !== gasNode?.id, 'Move to the gas giant first'); }
    }
    const sysId = sh.orbit || colonySystems()[0];
    if (sysId && factoriesIn(sysId).length) {
      fo('Landfall Production', () => opBuild(sysId), S.ops.frontier < 1);
      fo('Research (cubes)', () => opResearch(sysId), S.ops.frontier < 1);
    }
    kids.push(h('div', { class: 'aa-box' }, h('h3', {}, `Frontier ops: ${S.ops.frontier}`), acts));
  }
  const siteBox = siteActions();
  if (siteBox) kids.push(siteBox);
  kids.push(h('div', { class: 'aa-box aa-logbox' }, h('h3', {}, 'Mission log'), h('ol', { class: 'aa-log' }, S.log.slice(0, 60).map((l) => h('li', { class: l.kind }, h('small', {}, l.when), ' ', l.msg)))));
  return h('section', { class: 'aa-panel aa-side' }, kids);
}
function courseNote() {
  const sh = S.ship;
  const opts = MAP.adj[sh.pos].filter((n) => n !== sh.prev);
  if (sh.next) return `Heading toward ${nodeName(leadsTo(sh.pos, sh.next).node)}, ${leadsTo(sh.pos, sh.next).steps} spaces.`;
  if (opts.length === 1) { const lt = leadsTo(sh.pos, opts[0]); const nd = MAP.nodes[lt.node]; const leaf = nd.kind === 'star' && MAP.adj[lt.node].length === 1; return `Next: ${nodeName(lt.node)} in ${lt.steps} spaces.${leaf ? ` It is a dead end: be at V0 there, or brake in its Oort cloud, or the ship flies off into the dark.` : ''}`; }
  return 'At a junction: you will choose the branch as you move.';
}
function siteActions() {
  const starId = SEL.sysView || S.ship.orbit; if (!starId || !SEL.site || TAB !== 'system') return null;
  const site = siteById(starId, SEL.site); if (!site) return null;
  const sh = S.ship; const here = sh.orbit === starId && shipActive();
  const fops = S.ops.frontier < 1 || !!S.over;
  const acts = h('div', { class: 'aa-acts' });
  const b = (label, fn, dis, tip) => acts.append(h('button', { class: 'aa-op', disabled: dis, onclick: fn, title: tip || '' }, label));
  const pc = prospectorCard();
  if (!site.goo) {
    if (here && !site.claimed) b(pc && def(pc).raygun && S.ops.prospected ? 'Prospect (free scan)' : 'Prospect', () => opProspect(site), (fops && !(pc && def(pc).raygun && S.ops.prospected)) || !pc);
    if (here && site.claimed && !site.cubes && hasSeed()) b('Deploy Seed', () => opDeploySeed(site), fops);
    if (here && site.claimed && (site.kind === 'world' || site.kind === 'ocean')) b('Found Colony', () => opFoundColony(site), fops || shipPop() < 1);
    const colonyHere = sysOf(starId).sites.some((x) => x.pop > 0);
    if ((here || colonyHere) && !site.claimed) b('Settle (claim)', () => opSettle(starId, site), fops);
    if (site.pop > 0) b('Grow', () => opGrow(Object.assign(site, { _star: starId })), fops);
    if (site.cubes > 0 && (here || colonyHere)) b('Industry +2 cubes', () => opIndustry(site), fops);
    if (site.kind === 'world' && site.terra && (here || colonyHere) && site.step < 4) b(`Terraform to ${TERRAFORM[site.step + 1].reach}`, () => opTerraform(starId, site), fops);
    if (here && site.cubes > 0 && driveCard() && !sh.recycled) b('Recycle drive here (free)', () => freeRecycle(site), !!S.over);
  }
  const roles = rolesIn(starId);
  return h('div', { class: 'aa-box' }, h('h3', {}, site.name),
    h('p', {}, `${site.kind === 'mine' ? 'Mine' : site.kind === 'ocean' ? 'Buried ocean (Hostile surface)' : site.cls} . Size ${site.size} . Hydration ${site.hyd} . Spectral ${site.spec}`),
    site.goo ? h('p', { class: 'aa-bad' }, 'Consumed by grey goo.') : null,
    h('p', { class: 'aa-dim' }, [site.claimed ? 'Claimed.' : 'Unclaimed.', site.cubes ? ` ${site.cubes} Replicator cubes (cap ${site.size}).` : '', site.pop ? ` Colony: ${site.pop} Population${isOpen(site) ? ' in the open' : ' under Domes'}.` : '', site.kind === 'world' && site.terra ? ` Terraform step ${site.step} of 4.` : ''].join('')),
    site.kind === 'world' && site.terra && site.step < 4 ? h('p', { class: 'aa-dim' }, `Next step needs: ${TERRAFORM[site.step + 1].needs.map((r) => `${r} ${roles[r] ? '✓' : '✗'}`).join(', ')}${TERRAFORM[site.step + 1].pop ? `, ${TERRAFORM[site.step + 1].pop} Population here` : ''}.`) : null,
    here || sysOf(starId).sites.some((x) => x.pop > 0) ? acts : h('p', { class: 'aa-dim' }, 'Bring your starship into orbit here to act.'),
    sysOf(starId).landfall.length ? h('p', { class: 'aa-dim' }, 'Landfall cards here: ', sysOf(starId).landfall.map((c) => `${def(c).lf.name}${def(c).lf.role ? ` (${def(c).lf.role})` : ''}`).join(', ')) : null,
    sysOf(starId).blueprints.length ? h('p', { class: 'aa-dim' }, 'Blueprints: ', sysOf(starId).blueprints.map((id) => CARD_BY_ID[id].name).join(', ')) : null);
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
  let app = $('#aa-app'); if (!app) { app = h('div', { id: 'aa-app' }); document.body.append(app); }
  render();
  if (S.phase === 'setup') setupPick();
  window.claude?.hot?.snapshot?.(() => ({ S, _uid }));
  window.__aa = { get state() { return S; }, get busy() { return BUSY; }, explore, enterOrbit, endTurn, render, setTab, opIncome, opExpand, opResearch, opProduce, opLaunch, opBoost, newGame: () => { newGame(); commit(); setupPick(); } };
}
if (window.claude?.hot?.ready) window.claude.hot.ready(start);
else start(window.claude?.hot?.data ?? null);
