// Ad Astra SYSTEM MAP BUILDER - add planets, giants, dwarfs and asteroids and
// the map rebuilds from the SM rules (docs/ad-astra/system-map-rules.md).
// Drawn by the game's ORIGINAL MapRenderer, with Sol's helio zone tint and
// HF's lander / hazard / aerobrake glyphs (via NODE_TAGS, as Rat Frontier does).
import { MapRenderer } from '../../../js/game/render.js';
import { buildChains } from '../../../js/game/planner-map.js';
import { NODE_TAGS } from '../../../data/node-tags.js';
import { buildMap, wellBurns, landingOf, GIANT_HALO } from './mapgen.js';
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
const SPEC_KEY = 'aa-mapgen-spec-v4';
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
      if (n.bodyKind === 'dwarf') s._palette = ART.ceres;
      sites.push(s); continue;
    }
    const type = n.kind === 'decorative' ? 'decorative' : n.kind;
    sites.push({ ...base, type, isDecorative: n.kind === 'decorative', name: n.label || (n.kind === 'lagrange' && n.body ? (n.purpose === 'flyby' ? `${n.body} slingshot` : `${n.body} orbit`) : ''), flybyBoost: n.fly || null, landing: n.land ? (n.land === 'half' ? 0.5 : 1) : null, purpose: n.purpose });
  }
  for (const g of map.bodies) {
    const pal = g.size >= 11 ? ART.jupiter : ART.neptune;
    sites.push({ id: g.id, id2: `mg-${g.id}`, x: g.x, y: g.y, type: 'gas-giant', name: g.name, isWaypoint: false, isLandable: false, bodyKey: g.id, _palette: pal, solarZone: null, haloR: GIANT_HALO });
  }
  const byId = Object.fromEntries(sites.map((s) => [s.id, s]));
  const edges = map.edges.map(([a, b]) => [a, b]);
  const neighbors = new Map();
  for (const [a, b] of edges) { if (!neighbors.has(a)) neighbors.set(a, new Set()); if (!neighbors.has(b)) neighbors.set(b, new Set()); neighbors.get(a).add(b); neighbors.get(b).add(a); }
  const { chains, straightEdges } = buildChains(sites, edges, byId);
  return { sites, edges, byId, chains, straightEdges, edgeLabels: {}, directedEdges: [], neighbors, mode: 'classic' };
}

function rebuild() {
  save();
  MAP = buildMap(SPEC);
  PLANNER = toPlanner(MAP);
  const host = $('#mg-map');
  if (!RENDERER) {
    RENDERER = new MapRenderer(host, { data: PLANNER, onSelect: (hit) => popup(hit && typeof hit === 'object' ? hit.id : hit) });
    RENDERER.options.initialZoom = 1; RENDERER._initialViewDone = true;
    RENDERER.options.solDecor = false; RENDERER.options.visualizeZones = true; RENDERER.options.zoneFill = true; RENDERER.options.zoneOpacity = 0.14;
    requestAnimationFrame(() => { try { RENDERER.reset(); } catch (e) { /* sizing */ } });
  } else {
    // swap the data in place (the renderer has no teardown, so keep one instance)
    RENDERER.data = PLANNER; RENDERER.clearSitePopup(); RENDERER._partitionSites();
  }
  RENDERER.setCanonicalZones({ polys: MAP.zones.polys, colors: MAP.zones.colors, order: MAP.zones.order, restart: MAP.zones.restart });
  RENDERER._invalidateStatic && RENDERER._invalidateStatic();
  RENDERER._scheduleDraw && RENDERER._scheduleDraw();
  renderPanel();
}

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
    acts.push(info(why || { hohmann: 'Hohmann pivot: free, slow (SM-2a)', radhaz: 'Radiation (SM-6a)', orbit: 'System edge arrival (SM-9a)', star: 'A star' }[n.kind] || n.kind));
    if (n.season) acts.push(info(`${n.body}'s route: ${n.season} season, off the plane (SM-5g)`));
    if (n.star >= 0) acts.push(info(`${SPEC.stars.length > 1 ? `${SPEC.stars[n.star].name}, ` : ''}zone ${n.zone + 1}`));
    else acts.push(info('Between the stars'));
  }
  RENDERER.setSitePopup(s, acts);
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
function renderPanel() {
  const p = $('#mg-panel');
  const S0 = SPEC.stars[0];
  const add = (kind, extra) => () => { SPEC.bodies.push({ kind, name: `${{ planet: 'Planet', giant: 'Giant', dwarf: 'Dwarf', asteroid: 'Rock', belt: 'Belt', comet: 'Comet' }[kind]} ${SPEC.bodies.length + 1}`, zone: Math.min(S0.zones - 1, kind === 'giant' || kind === 'comet' ? S0.zones - 2 : kind === 'belt' || kind === 'asteroid' ? Math.floor(S0.zones / 2) : 1), ...extra }); rebuild(); };
  const hasRole = (r) => SPEC.stars.some((x) => x.role === r);
  const addStar = (role) => () => { SPEC.stars.push(role === 'binary' ? { name: `${S0.name} B`, type: 'yellow', zones: 3, role } : { name: `${S0.name} C`, type: 'red', zones: 2, role }); rebuild(); };
  const pass = MAP.report.filter((r) => r.ok).length;
  p.replaceChildren(
    h('h2', {}, 'System map builder'),
    h('p', { class: 'muted' }, 'Add stars and bodies and the map rebuilds from the system map rules (SM). Tap a node on the map to see which rule placed it.'),
    h('div', { class: 'mg-adds' },
      h('select', { id: 'mg-roll-kind', 'aria-label': 'Kind of star to roll' }, [['yellow', 'Yellow sun'], ['red', 'Red dwarf'], ['binary', 'Binary + distant']].map(([v, l]) => h('option', { value: v }, l))),
      h('button', { onclick: () => rollRandom($('#mg-roll-kind').value) }, '🎲 Roll a system')),
    h('h3', {}, 'Stars'),
    h('div', { class: 'mg-bodies' }, SPEC.stars.map(starRow)),
    h('div', { class: 'mg-adds' },
      hasRole('binary') ? null : h('button', { onclick: addStar('binary') }, '+ Binary companion'),
      hasRole('distant') ? null : h('button', { onclick: addStar('distant') }, '+ Distant companion')),
    h('h3', {}, 'Bodies'),
    h('div', { class: 'mg-adds' },
      h('button', { onclick: add('planet', { size: 7, sites: 2 }) }, '+ Planet'),
      h('button', { onclick: add('giant', { size: 11, trojans: 2, moons: [{ name: 'I', size: 8, sites: 2 }, { name: 'II', size: 6, sites: 1 }] }) }, '+ Gas giant'),
      h('button', { onclick: add('belt', { count: 6 }) }, '+ Asteroid belt'),
      h('button', { onclick: add('dwarf', { size: 6 }) }, '+ Dwarf'),
      h('button', { onclick: add('asteroid', { size: 2 }) }, '+ Asteroid'),
      h('button', { onclick: add('comet', { size: 2 }) }, '+ Comet')),
    h('div', { class: 'mg-bodies' }, SPEC.bodies.map(bodyRow)),
    h('h3', {}, `Rule checks: ${pass}/${MAP.report.length}`),
    h('ul', { class: 'mg-report' }, MAP.report.map((r) => h('li', { class: r.ok ? 'ok' : 'no' }, r.ok ? '✓ ' : '✗ ', h('b', {}, r.rule), h('small', {}, r.detail)))),
    h('p', { class: 'muted' }, `${MAP.nodes.length} nodes, ${MAP.edges.length} edges, ${MAP.sites.length} sites.`),
    h('div', { class: 'mg-adds' },
      h('select', { 'aria-label': 'Load a preset', onchange: (e) => { if (PRESETS[e.target.value]) { SPEC = structuredClone(PRESETS[e.target.value]); rebuild(); } } },
        h('option', { value: '' }, 'Load a preset...'), Object.keys(PRESETS).map((k) => h('option', { value: k }, k)))));
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

window.__mg = { get spec() { return SPEC; }, set spec(s) { SPEC = upgrade(s); rebuild(); }, get map() { return MAP; }, get renderer() { return RENDERER; }, rebuild, popup, PRESETS, rollRandom };
rebuild();
