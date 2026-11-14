// Ad Astra SYSTEM MAP BUILDER - add planets, giants, dwarfs and asteroids and
// the map rebuilds from the SM rules (docs/ad-astra/system-map-rules.md).
// Drawn by the game's ORIGINAL MapRenderer, with Sol's helio zone tint and
// HF's lander / hazard / aerobrake glyphs (via NODE_TAGS, as Rat Frontier does).
import { MapRenderer } from '../../../js/game/render.js';
import { buildChains } from '../../../js/game/planner-map.js';
import { NODE_TAGS } from '../../../data/node-tags.js';
import { buildMap, wellBurns, landingOf, GIANT_HALO, starLayout, radiusOf } from './mapgen.js';
import { rollSystem, seededRint } from './roll.js';

const $ = (s, r = document) => r.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
};

// HF body art (the renderer's BODY_PALETTES)
const ART = {
  earth: { base: '#3b7fc0', light: '#8fc1ee', dark: '#0e2c4b', atmosphere: 'rgba(135, 206, 250, 0.55)' },
  mars: { base: '#c1502e', light: '#f0a47e', dark: '#3c1408', atmosphere: 'rgba(220, 130, 90, 0.3)' },
  mercury: { base: '#9a8773', light: '#d4c0a8', dark: '#3d3326' },
  venus: { base: '#e8c87a', light: '#fff0c2', dark: '#7a5a1a', atmosphere: 'rgba(255, 220, 140, 0.5)' },
  jupiter: { base: '#c8a373', light: '#f3dab0', dark: '#5a3e22' },
  saturn: { base: '#dcc587', light: '#fbe9b8', dark: '#5e4f2b' },
  neptune: { base: '#3c66c7', light: '#9bb9f0', dark: '#0e1f55', atmosphere: 'rgba(120, 160, 240, 0.45)' },
  io: { base: '#e6c84a', light: '#fff2a6', dark: '#5a4a12' },
  europa: { base: '#d4cdb8', light: '#f3eee0', dark: '#5a5346' },
  ganymede: { base: '#a39788', light: '#dccfb8', dark: '#3a342c' },
  callisto: { base: '#6e6357', light: '#a89a87', dark: '#1f1c18' },
  ceres: { base: '#9c9387', light: '#d4cbbd', dark: '#2f2b25' },
};
const MOON_ART = ['io', 'europa', 'ganymede', 'callisto', 'ceres'];
// the painted, turning sphere each body art reads as (planet-texture.js)
const STYLE_OF = { earth: 'earth', mars: 'mars', mercury: 'rock', venus: 'venus', jupiter: 'gas', saturn: 'gas', neptune: 'ice-giant', io: 'volcanic', europa: 'ice', ganymede: 'rock', callisto: 'rock', ceres: 'rock' };
const styleOfArt = (pal) => STYLE_OF[Object.keys(ART).find((k) => ART[k] === pal)] || null;

// Presets are rolled by the same roller the game uses (roll.js), from a fixed
// seed so each preset is the same every load.
const ROLLS = {
  'Yellow sun, 15 planets': { seed: 11, star: { name: 'Tau Ceti', type: 'yellow' }, chits: { hz: 'Marginal', comps: [{ kind: 'gas', chit: 'Ocean' }] }, planets: 15 },
  'Yellow sun with a gas giant': { seed: 4, star: { name: 'Epsilon Eridani', type: 'yellow' }, chits: { hz: 'Habitable', comps: [{ kind: 'gas', chit: 'Ocean' }] } },
  'Red dwarf': { seed: 9, star: { name: "Barnard's Star", type: 'red' }, chits: { hz: 'Hostile', comps: [] } },
  'Alpha Centauri (binary + Proxima)': { seed: 3, star: { name: 'Alpha Centauri', type: 'yellow' }, chits: { hz: 'None', comps: [], stars: [{ name: 'Alpha Centauri B', type: 'yellow', role: 'binary', chit: 'Marginal' }, { name: 'Proxima Centauri', type: 'red', role: 'distant', chit: 'Hostile', known: 'Proxima b' }] } },
  'Epsilon Indi (giant + distant brown dwarf)': { seed: 5, star: { name: 'Epsilon Indi', type: 'yellow' }, chits: { hz: 'Habitable', comps: [{ kind: 'gas', chit: 'None' }], stars: [{ name: 'Epsilon Indi B', type: 'brown', role: 'distant', chit: 'Ocean' }] } },
};
const WORLDS = ['Verge', 'Haven', 'Cinder', 'Tethys', 'Morrow', 'Ashfall', 'Lumen', 'Brine', 'Kestrel', 'Halcyon'];
const rolled = ({ seed, star, chits, planets }, rint = seededRint(seed)) => {
  let w = 0; const r = rollSystem({ star, chits, rint, planets, worldName: () => WORLDS[(seed + w++) % WORLDS.length] });
  return r.spec;
};
const PRESETS = Object.fromEntries(Object.entries(ROLLS).map(([k, v]) => [k, rolled(v)]));
const FIRST = 'Yellow sun with a gas giant';
// bump when the presets or the rules change, so a saved map from an older
// builder doesn't hide them (the old one simply isn't loaded)
const SPEC_KEY = 'aa-mapgen-spec-v6';
// older saved specs had one star at the top level
const upgrade = (s) => (s.stars ? s : { name: s.name, stars: [{ name: s.name || 'Star', type: s.starType || 'yellow', zones: s.zones || 6 }], bodies: s.bodies || [] });
let SPEC = (() => { try { const s = JSON.parse(localStorage.getItem(SPEC_KEY)); if (s && s.bodies) return upgrade(s); } catch (e) { /* none */ } return structuredClone(PRESETS[FIRST]); })();
let MAP = null, RENDERER = null, PLANNER = null;
const save = () => { try { localStorage.setItem(SPEC_KEY, JSON.stringify(SPEC)); } catch (e) { /* storage off */ } };
const starOf = (bd) => SPEC.stars[Math.min(bd.star | 0, SPEC.stars.length - 1)];

// ---------- map -> the original planner-map shape
function toPlanner(map) {
  for (const k of Object.keys(NODE_TAGS)) if (k.startsWith('mg-')) delete NODE_TAGS[k];
  const sites = []; const moonArt = {};
  const short = (s) => {
    const sameBody = map.sites.filter((x) => x.body === s.body);
    return sameBody.length > 1 ? `${s.body} ${['N', 'E', 'W'][s.region] || s.region + 1}` : s.body;
  };
  const starById = Object.fromEntries(map.stars.map((x) => [x.id, x]));
  for (const n of map.nodes) {
    const id2 = `mg-${n.id}`;
    if (n.tags && Object.keys(n.tags).length) NODE_TAGS[id2] = { ...n.tags };
    const base = { id: n.id, id2, x: n.x, y: n.y, isDecorative: false, isWaypoint: true, solarZone: null, aeroLandable: false, hazard: !!(n.tags && n.tags.hazard), name: '', siteSynodic: n.season || null };
    if (n.kind === 'star') {
      const st = starById[n.id] || {};
      const r = (st.type === 'red' ? 20 : st.type === 'brown' || st.type === 'white' ? 12 : 26) * (st.role === 'distant' ? 0.6 : st.role === 'binary' ? 0.8 : 1);
      sites.push({ ...base, type: 'sun', isWaypoint: false, name: n.label || 'Star', sunR: r }); continue;
    }
    if (n.kind === 'site') {
      const type = n.bodyKind === 'planet' ? 'inner-planet' : n.bodyKind === 'moon' ? 'moon' : n.bodyKind === 'dwarf' ? 'dwarf' : n.bodyKind === 'comet' ? 'comet' : 'asteroid';
      const s = { ...base, isWaypoint: false, type, name: short(n), bodyKey: n.body, siteSize: `${n.size}`, hydration: n.ocean || n.bodyKind === 'comet' ? 4 : n.bodyKind === 'asteroid' ? 1 : n.size >= 7 ? 2 : 1, submarine: !!n.ocean,
        atmospheric: n.bodyKind === 'planet' && (SPEC.bodies.find((b) => b.name === n.body) || {}).atmosphere, astrobiology: ['Garden', 'Habitable'].includes(n.cls) };
      if (n.bodyKind === 'planet') s._palette = n.cls === 'Habitable' || n.cls === 'Garden' ? ART.earth : n.cls === 'Marginal' ? ART.mars : n.size >= 11 ? ART.venus : ART.mercury;
      if (n.bodyKind === 'moon') { if (!(n.body in moonArt)) moonArt[n.body] = Object.keys(moonArt).length; s._palette = n.ocean ? ART.europa : ART[MOON_ART[moonArt[n.body] % MOON_ART.length]]; }
      if (n.bodyKind === 'dwarf') { s._palette = ART.ceres; s.haloR = 12; } // a dwarf planet is Ceres-sized, not a giant
      if (s._palette) s.planetStyle = styleOfArt(s._palette);
      sites.push(s); continue;
    }
    const type = n.kind === 'decorative' ? 'decorative' : n.kind;
    sites.push({ ...base, type, isDecorative: n.kind === 'decorative', name: n.label || (n.kind === 'lagrange' && n.body ? (n.purpose === 'flyby' ? `${n.body} slingshot` : `${n.body} orbit`) : ''), flybyBoost: n.fly || null, landing: n.land ? (n.land === 'half' ? 0.5 : 1) : null, purpose: n.purpose });
  }
  for (const g of map.bodies) {
    const pal = g.size >= 11 ? ART.jupiter : ART.neptune;
    sites.push({ id: g.id, id2: `mg-${g.id}`, x: g.x, y: g.y, type: 'gas-giant', name: g.name, isWaypoint: false, isLandable: false, bodyKey: g.id, _palette: pal, planetStyle: styleOfArt(pal), solarZone: null, haloR: GIANT_HALO });
  }
  const byId = Object.fromEntries(sites.map((s) => [s.id, s]));
  const edges = map.edges.map(([a, b]) => [a, b]);
  const neighbors = new Map();
  for (const [a, b] of edges) { if (!neighbors.has(a)) neighbors.set(a, new Set()); if (!neighbors.has(b)) neighbors.set(b, new Set()); neighbors.get(a).add(b); neighbors.get(b).add(a); }
  const { chains, straightEdges } = buildChains(sites, edges, byId);
  return { sites, edges, byId, chains, straightEdges, edgeLabels: {}, directedEdges: [], neighbors, mode: 'classic' };
}

function rebuild() { save(); draw(SPEC); renderPanel(); refreshHandles(); }
// draw a spec without saving or redrawing the panel: drags preview through this
function draw(spec) {
  MAP = buildMap(spec);
  PLANNER = toPlanner(MAP);
  const host = $('#mg-map');
  if (!RENDERER) {
    RENDERER = new MapRenderer(host, { data: PLANNER, onSelect: (hit) => popup(hit && typeof hit === 'object' ? hit.id : hit) });
    RENDERER.options.initialZoom = 1; RENDERER._initialViewDone = true;
    RENDERER.options.solDecor = false; RENDERER.options.texturedBodies = true; RENDERER.options.visualizeZones = true; RENDERER.options.zoneFill = true; RENDERER.options.zoneOpacity = 0.14;
    requestAnimationFrame(() => { try { RENDERER.reset(); } catch (e) { /* sizing */ } });
  } else {
    // swap the data in place (the renderer has no teardown, so keep one instance)
    RENDERER.data = PLANNER; RENDERER.clearSitePopup(); RENDERER._partitionSites();
  }
  RENDERER.setCanonicalZones({ polys: MAP.zones.polys, colors: MAP.zones.colors, order: MAP.zones.order, restart: MAP.zones.restart });
  RENDERER._invalidateStatic && RENDERER._invalidateStatic();
  RENDERER._scheduleDraw && RENDERER._scheduleDraw();
}
// one preview per animation frame, however fast the pointer moves
let _pending = null;
function previewSoon(spec) { const first = !_pending; _pending = spec; if (first) requestAnimationFrame(() => { const sp = _pending; _pending = null; if (sp) { draw(sp); refreshHandles(); } }); }

function popup(id) {
  const s = PLANNER.byId[id]; if (!s) return;
  const n = MAP.nodes.find((x) => x.id === id);
  const info = (label) => ({ label, disabled: true, variant: 'secondary' });
  const acts = [];
  if (n && n.kind === 'site') {
    acts.push(info(`${n.bodyKind} · size ${n.size}${n.belt ? ` · ${n.belt}` : ''}`));
    acts.push(info(n.bodyKind === 'moon' ? `Off ${n.moonOf}'s escape ladder (SM-7b)` : n.bodyKind === 'comet' ? `Comet, ${n.season} season: reachable only then (SM-5g)` : n.belt ? 'Asteroid group: one burn out (SM-5f)' : `${wellBurns(n.size)} escape, ${landingOf(n.size) === 'none' ? 'no' : landingOf(n.size)} lander (SM-4a)`));
  } else if (n) {
    const why = { transition: 'Zone transition (SM-3a)', escape: n.rung ? `${n.body} escape ladder, burn ${n.rung} (SM-7b)` : `${n.body} escape burn (SM-3b)`, landing: `${n.land === 'half' ? 'Half' : 'Full'} lander burn (SM-5c)`, orbit: `${n.body} orbit (SM-4a)`, flyby: `${n.body} slingshot: no moons from here (SM-7a)` }[n.purpose];
    acts.push(info(why || { hohmann: 'Hohmann pivot: free, slow (SM-2a)', radhaz: 'Radiation (SM-6a)', orbit: n.toward ? `Ad Astra toward ${n.toward}: arrive and leave here (SM-9a)` : 'Ad Astra: arrival (SM-9a)', star: 'A star' }[n.kind] || n.kind));
    if (n.season) acts.push(info(`${n.body}'s route: ${n.season} season, off the plane (SM-5g)`));
    if (n.star >= 0) acts.push(info(`${SPEC.stars.length > 1 ? `${SPEC.stars[n.star].name}, ` : ''}zone ${n.zone + 1}`));
    else acts.push(info('Between the stars'));
  }
  const through = routesThrough(id);
  if (through.length) acts.push({ label: `✏ Edit splines (${through.length})`, variant: 'rocket', onClick: () => { RENDERER.clearSitePopup(); startSplineEdit(through.map((r) => r.key)); } });
  RENDERER.setSitePopup(s, acts);
}

// ---------- spline editing (SM-11c): a handle per route through a node
const routesThrough = (id) => (MAP.routes || []).filter((r) => r.ids && r.ids.includes(id));
let SPLINE = null; // { keys: [...] }
const ROLE_NAME = (key) => { const [kind, ...rest] = key.split(':'); const what = rest.join(':');
  return ({ well: `${what} well`, far: `${what} far orbit`, spoke: 'zone transfer', arrival: 'arrival', between: 'between the stars', 'sling-in': `${what} slingshot in`, 'sling-out': `${what} slingshot out`, ladder: `${what} ladder`, moon: `${what} branch`, minors: `${what.split(':')[0]} minor moons`, group: `${what.replace(/#\d+$/, '')} group` })[kind] || key; };
function startSplineEdit(keys) { SPLINE = { keys }; refreshHandles(); renderPanel(); }
function stopSplineEdit() { SPLINE = null; refreshHandles(); renderPanel(); }
const toScreen = (p) => { const eff = RENDERER.zoom * RENDERER.fitScale; return { x: RENDERER.pan.x + p.x * eff, y: RENDERER.pan.y + p.y * eff }; };
function refreshHandles() {
  const layer = $('#mg-handles') || $('#mg-stage').appendChild(h('div', { id: 'mg-handles' }));
  if (!SPLINE) { layer.replaceChildren(); return; }
  const live = SPLINE.keys.map((k) => (MAP.routes || []).find((r) => r.key === k)).filter(Boolean);
  if (layer.children.length !== live.length) layer.replaceChildren(...live.map((r) => h('div', { class: 'mg-handle', 'data-key': r.key, title: `${ROLE_NAME(r.key)}: drag to bend, double-click to straighten` }, h('span', {}, ROLE_NAME(r.key)))));
  for (const el of layer.children) {
    const r = live.find((x) => x.key === el.dataset.key); if (!r) continue;
    const p = toScreen(r.mid); el.style.left = `${p.x}px`; el.style.top = `${p.y}px`; el.classList.toggle('bent', !!(SPEC.curves && SPEC.curves[r.key]));
  }
}
function wireHandles() {
  const stage = $('#mg-stage'); let hd = null;
  const pt = (ev) => (ev.touches && ev.touches[0]) || (ev.changedTouches && ev.changedTouches[0]) || ev;
  const bendAt = (key, ev) => {
    const r = MAP.routes.find((x) => x.key === key); if (!r) return;
    const A = MAP.nodes.find((n) => n.id === r.from), B = MAP.nodes.find((n) => n.id === r.to);
    const w = RENDERER.eventToWorld(pt(ev));
    const dx = B.x - A.x, dy = B.y - A.y, L2 = dx * dx + dy * dy || 1;
    // the handle is the curve's midpoint, so the control point is twice as far out
    const rx = 2 * (w.x - (A.x + B.x) / 2), ry = 2 * (w.y - (A.y + B.y) / 2);
    SPEC.curves = { ...(SPEC.curves || {}), [key]: { u: Math.round(((rx * dx + ry * dy) / L2) * 1000) / 1000, v: Math.round(((rx * -dy + ry * dx) / L2) * 1000) / 1000 } };
  };
  const down = (ev) => { const el = ev.target.closest && ev.target.closest('.mg-handle'); if (!el) return; ev.preventDefault(); ev.stopPropagation(); hd = el.dataset.key; el.classList.add('dragging'); };
  stage.addEventListener('mousedown', down, true);
  stage.addEventListener('touchstart', down, { capture: true, passive: false });
  const move = (ev) => { if (!hd) return; if (ev.cancelable) ev.preventDefault(); bendAt(hd, ev); previewSoon(SPEC); };
  window.addEventListener('mousemove', move); window.addEventListener('touchmove', move, { passive: false });
  const up = () => { if (!hd) return; hd = null; rebuild(); };
  window.addEventListener('mouseup', up); window.addEventListener('touchend', up);
  stage.addEventListener('dblclick', (ev) => { const el = ev.target.closest && ev.target.closest('.mg-handle'); if (!el || !SPEC.curves) return; const c = { ...SPEC.curves }; delete c[el.dataset.key]; SPEC.curves = c; rebuild(); });
  window.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && SPLINE) stopSplineEdit(); });
  // keep the handles on their curves as the map pans and zooms
  const tick = () => { if (SPLINE) refreshHandles(); requestAnimationFrame(tick); }; requestAnimationFrame(tick);
}

// ---------- the editor panel
const KINDS = { planet: 'Planet', giant: 'Gas giant', dwarf: 'Dwarf', asteroid: 'Asteroid', belt: 'Asteroid belt', comet: 'Comet' };
function bodyRow(bd, i) {
  const upd = (k, v) => { bd[k] = v; rebuild(); };
  const num = (k, lo, hi, label) => h('label', { class: 'mg-f' }, label, h('input', { type: 'number', min: lo, max: hi, value: bd[k] ?? '', onchange: (e) => upd(k, Math.max(lo, Math.min(hi, +e.target.value || lo))) }));
  const st = starOf(bd);
  return h('div', { class: `mg-body mg-${bd.kind}` },
    h('div', { class: 'mg-bhead' },
      h('select', { 'aria-label': 'Kind', onchange: (e) => { bd.kind = e.target.value; if (bd.kind === 'giant' && !bd.moons) bd.moons = [{ name: `${bd.name}-I`, size: 8, sites: 2 }, { name: `${bd.name}-II`, size: 6, sites: 1 }]; if (bd.kind === 'belt' && !bd.count) bd.count = 6; rebuild(); } },
        Object.entries(KINDS).map(([k, v]) => h('option', { value: k, selected: bd.kind === k }, v))),
      h('input', { class: 'mg-name', value: bd.name, 'aria-label': 'Name', onchange: (e) => upd('name', e.target.value || 'Body') }),
      h('button', { class: 'mg-x', title: 'Remove', 'aria-label': `Remove ${bd.name}`, onclick: () => { SPEC.bodies.splice(i, 1); rebuild(); } }, '×')),
    h('div', { class: 'mg-fields' },
      SPEC.stars.length > 1 ? h('label', { class: 'mg-f' }, 'Star', h('select', { onchange: (e) => { bd.star = +e.target.value; bd.zone = Math.min(bd.zone | 0, starOf(bd).zones - 1); rebuild(); } }, SPEC.stars.map((x, k) => h('option', { value: k, selected: (bd.star | 0) === k }, ['A', 'B', 'C'][k])))) : null,
      h('label', { class: 'mg-f' }, 'Zone', h('select', { onchange: (e) => upd('zone', +e.target.value) }, Array.from({ length: st.zones }, (_, k) => h('option', { value: k, selected: (bd.zone | 0) === k }, k + 1)))),
      bd.kind === 'belt' ? num('count', 1, 12, 'Rocks') : num('size', 1, bd.kind === 'comet' ? 3 : 11, 'Size'),
      h('label', { class: 'mg-f wide' }, `Angle ${bd.angle ?? 'auto'}`, h('input', { type: 'range', min: 0, max: 359, value: bd.angle ?? 0, oninput: (e) => { bd.angle = +e.target.value; e.target.previousSibling.textContent = `Angle ${bd.angle}`; }, onchange: () => rebuild() })),
      bd.kind === 'comet' ? h('label', { class: 'mg-f' }, 'Season', h('select', { onchange: (e) => upd('season', e.target.value || undefined) }, ['', 'red', 'yellow', 'blue'].map((x) => h('option', { value: x, selected: (bd.season || '') === x }, x || 'auto')))) : null,
      bd.kind === 'planet' ? num('sites', 1, 3, 'Sites') : null,
      bd.kind === 'planet' ? h('label', { class: 'mg-f' }, 'Air', h('input', { type: 'checkbox', checked: !!bd.atmosphere, onchange: (e) => upd('atmosphere', e.target.checked) })) : null,
      bd.kind === 'planet' ? h('label', { class: 'mg-f' }, 'Class', h('select', { onchange: (e) => upd('cls', e.target.value) }, ['Hostile', 'Marginal', 'Habitable', 'Garden'].map((c) => h('option', { selected: (bd.cls || 'Hostile') === c }, c)))) : null,
      bd.kind === 'giant' ? h('label', { class: 'mg-f' }, 'Moons', h('input', { type: 'number', min: 0, max: 5, value: (bd.moons || []).length, onchange: (e) => {
        const n = Math.max(0, Math.min(5, +e.target.value | 0)); const sizes = [8, 7, 9, 6, 2];
        bd.moons = Array.from({ length: n }, (_, j) => (bd.moons || [])[j] || { name: `${bd.name}-${['I', 'II', 'III', 'IV', 'V'][j]}`, size: sizes[j], sites: sizes[j] >= 7 ? 2 : 1 }); rebuild();
      } })) : null,
      bd.kind === 'giant' ? num('trojans', 0, 3, 'Trojans') : null,
      bd.kind === 'giant' ? h('label', { class: 'mg-f' }, 'Ocean moon', h('input', { type: 'checkbox', checked: (bd.moons || []).some((m) => m.ocean), onchange: (e) => { (bd.moons || []).forEach((m, j) => { m.ocean = e.target.checked && j === 1; }); rebuild(); } })) : null));
}
function starRow(st, k) {
  const role = k === 0 ? 'primary' : st.role;
  const [lo, hi] = { primary: [4, 9], binary: [3, 6], distant: [2, 3] }[role];
  return h('div', { class: 'mg-body mg-star' },
    h('div', { class: 'mg-bhead' },
      h('b', { class: 'mg-tag' }, ['A', 'B', 'C'][k]),
      h('input', { class: 'mg-name', value: st.name, 'aria-label': 'Star name', onchange: (e) => { st.name = e.target.value || 'Star'; if (k === 0) SPEC.name = st.name; rebuild(); } }),
      k > 0 ? h('button', { class: 'mg-x', title: 'Remove', 'aria-label': `Remove ${st.name}`, onclick: () => { SPEC.stars.splice(k, 1); SPEC.bodies = SPEC.bodies.filter((b) => (b.star | 0) !== k).map((b) => ((b.star | 0) > k ? { ...b, star: b.star - 1 } : b)); rebuild(); } }, '×') : null),
    h('div', { class: 'mg-fields' },
      h('span', { class: 'mg-f' }, 'Role', h('span', { class: 'mg-role' }, { primary: 'Primary', binary: 'Binary companion', distant: 'Distant companion' }[role])),
      h('label', { class: 'mg-f' }, 'Type', h('select', { onchange: (e) => { st.type = e.target.value; rebuild(); } }, ['yellow', 'red', 'brown', 'white'].map((t) => h('option', { selected: (st.type || 'yellow') === t }, t)))),
      h('label', { class: 'mg-f' }, 'Zones', h('input', { type: 'number', min: lo, max: hi, value: st.zones, onchange: (e) => { st.zones = Math.max(lo, Math.min(hi, +e.target.value | 0)); SPEC.bodies.forEach((b) => { if ((b.star | 0) === k) b.zone = Math.min(b.zone | 0, st.zones - 1); }); rebuild(); } }))));
}
// ---------- a new body of a kind, with sensible defaults (the + buttons and palette drops)
const KIND_LABEL = { planet: 'Planet', giant: 'Giant', dwarf: 'Dwarf', asteroid: 'Rock', belt: 'Belt', comet: 'Comet' };
const KIND_EXTRA = {
  planet: () => ({ size: 7, sites: 2 }),
  giant: (name) => ({ size: 11, trojans: 2, moons: [...['I', 'II', 'III', 'IV'].map((r, j) => ({ name: `${name}-${r}`, size: [8, 6, 9, 7][j], sites: j % 2 ? 1 : 2 })), ...Array.from({ length: 10 }, (_, j) => ({ name: `${name} m${j + 1}`, size: 1 + (j % 2) }))] }),
  belt: () => ({ count: 6 }), dwarf: () => ({ size: 6 }), asteroid: () => ({ size: 2 }), comet: () => ({ size: 2 }),
};
function newBody(kind) {
  const S0 = SPEC.stars[0];
  const name = `${KIND_LABEL[kind]} ${SPEC.bodies.length + 1}`;
  return { kind, name, zone: Math.min(S0.zones - 1, kind === 'giant' || kind === 'comet' ? S0.zones - 2 : kind === 'belt' || kind === 'asteroid' ? Math.floor(S0.zones / 2) : 1), ...KIND_EXTRA[kind](name) };
}

function renderPanel() {
  const p = $('#mg-panel');
  const S0 = SPEC.stars[0];
  // a + button: click to add (placed automatically), or drag it onto the map to place it there
  const addBtn = (kind, label) => h('button', { draggable: 'true', title: `Click to add, or drag onto the map to place it`, onclick: () => { SPEC.bodies.push(newBody(kind)); rebuild(); },
    ondragstart: (e) => { e.dataTransfer.setData('text/x-mg-kind', kind); e.dataTransfer.effectAllowed = 'copy'; PALETTE_KIND = kind; } , ondragend: () => { PALETTE_KIND = null; hideGhost(); } }, label);
  const hasRole = (r) => SPEC.stars.some((x) => x.role === r);
  const addStar = (role) => () => { SPEC.stars.push(role === 'binary' ? { name: `${S0.name} B`, type: 'yellow', zones: 3, role } : { name: `${S0.name} C`, type: 'red', zones: 2, role }); rebuild(); };
  const pass = MAP.report.filter((r) => r.ok).length;
  p.replaceChildren(...[
    h('h2', {}, 'System map builder'),
    h('p', { class: 'muted' }, 'Add stars and bodies and the map rebuilds from the system map rules (SM). Tap a node on the map to see which rule placed it.'),
    h('div', { class: 'mg-adds' },
      h('select', { id: 'mg-roll-kind', 'aria-label': 'Kind of star to roll' }, [['yellow', 'Yellow sun'], ['red', 'Red dwarf'], ['binary', 'Binary + distant']].map(([v, l]) => h('option', { value: v }, l))),
      h('button', { onclick: () => rollRandom($('#mg-roll-kind').value) }, '🎲 Roll a system')),
    SPLINE ? h('div', { class: 'mg-splinebar' }, h('b', {}, `✏ Editing ${SPLINE.keys.length} spline${SPLINE.keys.length === 1 ? '' : 's'}`),
      h('span', { class: 'muted' }, 'Drag a handle to bend its route; double-click it to straighten.'),
      h('div', { class: 'mg-adds' }, h('button', { onclick: () => { const c = { ...(SPEC.curves || {}) }; SPLINE.keys.forEach((k) => delete c[k]); SPEC.curves = c; rebuild(); } }, 'Straighten these'), h('button', { onclick: stopSplineEdit }, 'Done'))) : null,
    h('h3', {}, 'Stars'),
    h('div', { class: 'mg-bodies' }, SPEC.stars.map(starRow)),
    h('div', { class: 'mg-adds' },
      hasRole('binary') ? null : h('button', { onclick: addStar('binary') }, '+ Binary companion'),
      hasRole('distant') ? null : h('button', { onclick: addStar('distant') }, '+ Distant companion')),
    h('h3', {}, 'Bodies'),
    h('div', { class: 'mg-adds' },
      addBtn('planet', '+ Planet'), addBtn('giant', '+ Gas giant'), addBtn('belt', '+ Asteroid belt'),
      addBtn('dwarf', '+ Dwarf'), addBtn('asteroid', '+ Asteroid'), addBtn('comet', '+ Comet')),
    h('p', { class: 'muted mg-hint' }, '✋ Drag a body on the map to move it to another zone, angle or star. Drag a + button onto the map to drop a new body there.'),
    h('div', { class: 'mg-bodies' }, SPEC.bodies.map(bodyRow)),
    h('h3', {}, `Rule checks: ${pass}/${MAP.report.length}`),
    h('ul', { class: 'mg-report' }, MAP.report.map((r) => h('li', { class: r.ok ? 'ok' : 'no' }, r.ok ? '✓ ' : '✗ ', h('b', {}, r.rule), h('small', {}, r.detail)))),
    h('p', { class: 'muted' }, `${MAP.nodes.length} nodes, ${MAP.edges.length} edges, ${MAP.sites.length} sites.`),
    h('div', { class: 'mg-adds' },
      h('select', { 'aria-label': 'Load a preset', onchange: (e) => { if (PRESETS[e.target.value]) { SPEC = structuredClone(PRESETS[e.target.value]); rebuild(); } } },
        h('option', { value: '' }, 'Load a preset...'), Object.keys(PRESETS).map((k) => h('option', { value: k }, k))))].filter(Boolean));
}

// roll a fresh random system with the game's own roller
function rollRandom(kind) {
  const r = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const hz = ['Garden', 'Habitable', 'Marginal', 'Hostile', 'None'][r(0, 4)];
  const def = kind === 'binary'
    ? { seed: r(1, 9999), star: { name: 'Rigel Kent', type: 'yellow' }, chits: { hz, comps: [], stars: [{ name: 'Rigel Kent B', type: 'yellow', role: 'binary', chit: ['Habitable', 'Marginal', 'Hostile', 'None'][r(0, 3)] }, { name: 'Rigel Kent C', type: 'red', role: 'distant', chit: 'Hostile' }] } }
    : { seed: r(1, 9999), star: { name: kind === 'red' ? 'Wolf 424' : 'Gliese 667', type: kind }, chits: { hz, comps: r(0, 1) ? [{ kind: 'gas', chit: r(0, 1) ? 'Ocean' : 'None' }] : [] } };
  SPEC = rolled(def, (a, b) => a + Math.floor(Math.random() * (b - a + 1)));
  rebuild(); try { RENDERER.reset(); } catch (e) { /* sizing */ }
}

// ---------- drag and drop on the map
// Which spec body a map node belongs to: a giant's moons, Trojans, slingshot and
// sphere all move the giant; a belt's rocks move the whole belt.
let PALETTE_KIND = null;
const bodyIdx = (name) => SPEC.bodies.findIndex((b) => b.name === name);
function bodyIndexForNode(id) {
  if (!id) return -1;
  const g = MAP.bodies.find((x) => x.id === id); if (g) return bodyIdx(g.name);
  const n = MAP.nodes.find((x) => x.id === id); if (!n || n.kind === 'star' || n.kind === 'hohmann' || n.kind === 'decorative' || n.purpose === 'transition') return -1;
  if (n.moonOf) return bodyIdx(n.moonOf);
  for (const nm of [n.belt, n.body]) {
    if (!nm) continue;
    const i = bodyIdx(nm); if (i >= 0) return i;
    const tro = /^(.*) L[45][a-z]?$/.exec(nm); if (tro && bodyIdx(tro[1]) >= 0) return bodyIdx(tro[1]); // a Trojan: its giant
  }
  return -1;
}
// where a drop lands: the star whose zones it falls in (or the nearest), the
// zone by distance from that star, and the angle round it
function placementAt(w) {
  const Ls = starLayout(SPEC.stars.map((x, i) => ({ ...x, role: i === 0 ? 'primary' : x.role })));
  let best = 0, bestR = Infinity;
  Ls.forEach((L, i) => { const r = radiusOf(w.x, w.y, L) / L.outer; if (r < bestR) { bestR = r; best = i; } });
  const L = Ls[best]; const b = MAP.zones.bounds[best]; const N = b.length - 1;
  const r = radiusOf(w.x, w.y, L);
  let zone = N - 1; for (let k = 0; k < N; k++) if (r < b[k + 1]) { zone = k; break; }
  const angle = Math.round(((Math.atan2((w.y - L.cy) / L.ky, (w.x - L.cx) / L.kx) * 180) / Math.PI + 360) % 360);
  return { star: best, zone, angle, starName: SPEC.stars[best].name };
}
function applyPlacement(bd, pl) {
  if (SPEC.stars.length > 1) bd.star = pl.star; else delete bd.star;
  bd.zone = bd.kind === 'comet' ? Math.max(1, pl.zone) : pl.zone; // SM-5g: never in the star's zone
  bd.angle = pl.angle;
}
const ghost = () => $('#mg-ghost') || $('#mg-stage').appendChild(h('div', { id: 'mg-ghost', class: 'mg-ghost', hidden: true }));
function showGhost(clientX, clientY, label, pl) {
  const el = ghost(); const box = $('#mg-stage').getBoundingClientRect();
  el.hidden = false; el.style.left = `${clientX - box.left}px`; el.style.top = `${clientY - box.top}px`;
  el.replaceChildren(h('b', {}, label), h('span', {}, pl ? `${SPEC.stars.length > 1 ? `${pl.starName}, ` : ''}zone ${pl.zone + 1}, ${pl.angle}°` : 'moving the whole system'));
}
function hideGhost() { const el = $('#mg-ghost'); if (el) el.hidden = true; }

function wireDrag() {
  const host = $('#mg-map');
  let drag = null; let swallowClick = false;
  const pointOf = (ev) => (ev.touches && ev.touches[0]) || (ev.changedTouches && ev.changedTouches[0]) || ev;
  const start = (ev) => {
    if (ev.button != null && ev.button !== 0) return;
    const pt = pointOf(ev);
    const w = RENDERER.eventToWorld(pt);
    const hit = RENDERER.hitTestNode(w.x, w.y);
    const idx = bodyIndexForNode(hit && typeof hit === 'object' ? hit.id : hit);
    // SM-11b: a companion star's centre picks up its whole system
    const si = MAP.stars.findIndex((x, i) => i > 0 && Math.hypot(x.x - w.x, x.y - w.y) < 22);
    if (idx < 0 && si > 0) { ev.stopPropagation(); if (ev.cancelable) ev.preventDefault(); drag = { star: si, x: pt.clientX, y: pt.clientY, moved: false }; return; }
    if (idx < 0) return; // empty space: the map pans as usual
    ev.stopPropagation(); // the press belongs to the body, not the camera
    if (ev.cancelable) ev.preventDefault();
    drag = { idx, x: pt.clientX, y: pt.clientY, moved: false, id: hit && typeof hit === 'object' ? hit.id : hit };
  };
  const move = (ev) => {
    if (!drag) return;
    const pt = pointOf(ev);
    if (!drag.moved && Math.hypot(pt.clientX - drag.x, pt.clientY - drag.y) < 6) return;
    drag.moved = true; host.style.cursor = 'grabbing';
    if (ev.cancelable) ev.preventDefault();
    const w = RENDERER.eventToWorld(pt);
    if (drag.star) { // the star and everything round it follows the pointer
      const sp = structuredClone(SPEC); Object.assign(sp.stars[drag.star], { cx: Math.round(Math.max(80, Math.min(1320, w.x))), cy: Math.round(Math.max(80, Math.min(820, w.y))) });
      drag.spec = sp; previewSoon(sp); showGhost(pt.clientX, pt.clientY, SPEC.stars[drag.star].name, null); return;
    }
    // SM-11a: the body and all its children follow the pointer, laid out by the rules
    const pl = placementAt(w);
    const sp = structuredClone(SPEC); applyPlacement(sp.bodies[drag.idx], pl);
    drag.spec = sp; previewSoon(sp);
    showGhost(pt.clientX, pt.clientY, SPEC.bodies[drag.idx].name, pl);
  };
  const end = (ev) => {
    if (!drag) return;
    const d = drag; drag = null; host.style.cursor = ''; hideGhost();
    if (!d.moved) { if (d.id) popup(d.id); return; } // a plain tap still opens the popup
    swallowClick = true;
    if (d.spec) SPEC = d.spec;
    rebuild();
  };
  host.addEventListener('mousedown', start, true);
  host.addEventListener('touchstart', start, { capture: true, passive: false });
  window.addEventListener('mousemove', move);
  window.addEventListener('touchmove', move, { passive: false });
  window.addEventListener('mouseup', end);
  window.addEventListener('touchend', end);
  host.addEventListener('click', (ev) => { if (swallowClick) { swallowClick = false; ev.stopPropagation(); } }, true);
  // hover: a hand over anything you can pick up
  host.addEventListener('mousemove', (ev) => {
    if (drag) return;
    const w = RENDERER.eventToWorld(ev); const hit = RENDERER.hitTestNode(w.x, w.y);
    const onStar = MAP.stars.some((x, i) => i > 0 && Math.hypot(x.x - w.x, x.y - w.y) < 22);
    host.style.cursor = onStar || bodyIndexForNode(hit && typeof hit === 'object' ? hit.id : hit) >= 0 ? 'grab' : '';
  });
  // palette drops: a + button dragged onto the map
  host.addEventListener('dragover', (ev) => {
    if (!PALETTE_KIND) return;
    ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy';
    showGhost(ev.clientX, ev.clientY, `New ${KIND_LABEL[PALETTE_KIND].toLowerCase()}`, placementAt(RENDERER.eventToWorld(ev)));
  });
  host.addEventListener('dragleave', (ev) => { if (!host.contains(ev.relatedTarget)) hideGhost(); });
  host.addEventListener('drop', (ev) => {
    const kind = ev.dataTransfer.getData('text/x-mg-kind') || PALETTE_KIND; if (!KIND_EXTRA[kind]) return;
    ev.preventDefault(); hideGhost(); PALETTE_KIND = null;
    const bd = newBody(kind); applyPlacement(bd, placementAt(RENDERER.eventToWorld(ev)));
    SPEC.bodies.push(bd); rebuild();
  });
}

window.__mg = { get spec() { return SPEC; }, set spec(s) { SPEC = upgrade(s); rebuild(); }, get map() { return MAP; }, get renderer() { return RENDERER; }, rebuild, popup, PRESETS, rollRandom, placementAt, bodyIndexForNode, startSplineEdit, stopSplineEdit, routesThrough };
rebuild();
wireDrag();
wireHandles();
