// Server-side planner graph. Loads vendor/hf-mission-planner/assets/
// data-hf4.json at module init time and re-keys it against the SHARED
// slug rules in data/planner-ids.js (the browser builds the same
// slugs via planner-map.js). The result is:
//
//   NODES_BY_SLUG  Map<slug, { slug, x, y, type, name?, siteWater?, siteSize? }>
//   ADJ            Map<slug, [{ to: slug, burns: number }, ...]>
//
// Use findPath(fromSlug, toSlug) for shortest-path; siteExists(slug)
// to validate a destination. Static data, built once at boot.
//
// CLAUDE.md: "all nodes must be on server" + "SERVER MUST UNDERSTAND
// ROCKET TRAVEL". The engine resolves every MOVE through this graph,
// so a lagrange/burn/hohmann waypoint is a first-class destination -
// not just curated SITES entries.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRefId, normalizeSiteName } from '../../data/planner-ids.js';
import { SITES } from '../../data/sites.js';
import { raygunReachable } from '../../data/raygun-los.js';
import { buggyRoamReachable } from '../../data/buggy-roam.js';
import { NODE_TAGS } from '../../data/node-tags.js';
import { aerobrakeLandableSet } from '../../data/aerobrake-landing.js';

// The mission-planner data (vendor JSON) is the single source of truth
// for the movement graph - the SAME file the client renders from - and a
// node's id is the makeRefId slug the client also stamps (id2). The
// server does NOT invent its own ids. data/sites.js is layered on top as
// curated METADATA (class / hydration / vps / solarZone), matched to a
// planner node by name and looked up by slug via siteBySlug() below.
const SITE_BY_NAME = new Map();
for (const s of SITES) {
  if (s && s.name) SITE_BY_NAME.set(normalizeSiteName(s.name), s);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLANNER_JSON = join(
  __dirname, '..', '..', 'vendor', 'hf-mission-planner', 'assets', 'data-hf4.json'
);

function loadPlanner() {
  let raw;
  try {
    raw = JSON.parse(readFileSync(PLANNER_JSON, 'utf8'));
  } catch (err) {
    console.error('[planner-graph] failed to load', PLANNER_JSON, err.message);
    return { nodes: new Map(), adj: new Map(), rawKeyToSlug: new Map() };
  }
  const points = raw.points || {};
  const edges = Array.isArray(raw.edges) ? raw.edges : [];
  const edgeLabels = raw.edgeLabels || {};

  // First pass: compute every slug (makeRefId - identical to the client's
  // id2), disambiguating the rare post-rule collision the same way the
  // client does.
  const rawKeyToSlug = new Map();
  const slugCount = new Map();
  for (const key of Object.keys(points)) {
    const p = points[key];
    let slug = makeRefId(p, p.type || 'unknown');
    const n = (slugCount.get(slug) || 0) + 1;
    slugCount.set(slug, n);
    if (n > 1) slug = `${slug}-${n}`;
    rawKeyToSlug.set(key, slug);
  }

  // Second pass: build the node table by slug, attaching the curated
  // data/sites.js entry (matched by name) so siteBySlug() can answer
  // class / hydration / vps / solarZone for the engine. Waypoints
  // (lagrange / burn / hohmann / rad) match nothing -> site: null.
  const nodes = new Map();
  for (const key of Object.keys(points)) {
    const p = points[key];
    const slug = rawKeyToSlug.get(key);
    const site = (p.type === 'site' && p.siteName)
      ? (SITE_BY_NAME.get(normalizeSiteName(p.siteName)) || null)
      : null;
    nodes.set(slug, {
      slug,
      x: p.x, y: p.y,
      type: p.type || 'unknown',
      name: p.siteName || null,
      siteWater: p.siteWater != null ? Number(p.siteWater) : null,
      siteSize: p.siteSize || null,
      site,           // curated data/sites.js metadata, or null
      hazard: !!p.hazard,   // raw planner skull flag
      // Numeric landing rating off the raw planner point. A burnspace with
      // landing > 0 is itself a site, so the raygun beam passes through it
      // (see data/raygun-los.js); waypoints without one leave this null.
      landing: typeof p.landing === 'number' ? p.landing : null,
    });
  }

  // Build adjacency from the undirected edge list. Burn costs come
  // from edgeLabels[from][to] (string, parsed to int). Default = 1
  // when no label exists (the planner uses 1 for unlabelled edges).
  const adj = new Map();
  for (const slug of nodes.keys()) adj.set(slug, []);
  for (const e of edges) {
    if (typeof e !== 'string') continue;
    const [a, b] = e.split(':');
    const sa = rawKeyToSlug.get(a);
    const sb = rawKeyToSlug.get(b);
    if (!sa || !sb || sa === sb) continue;
    const labelAB = edgeLabels[a] && edgeLabels[a][b];
    const labelBA = edgeLabels[b] && edgeLabels[b][a];
    const burns = Number(labelAB || labelBA || 1) || 1;
    adj.get(sa).push({ to: sb, burns });
    adj.get(sb).push({ to: sa, burns });
  }

  return { nodes, adj, rawKeyToSlug };
}

const { nodes: NODES_BY_SLUG, adj: ADJ } = loadPlanner();
console.log(`[planner-graph] loaded ${NODES_BY_SLUG.size} nodes`);

export function siteExists(slug) {
  return slug != null && NODES_BY_SLUG.has(String(slug));
}

export function nodeBySlug(slug) {
  return NODES_BY_SLUG.get(String(slug)) || null;
}

// Resolve an admin-supplied node reference (a node slug/id OR a site name) to a
// canonical slug, or null when it matches no node. Exact slug wins; then a
// lowercased slug; then a normalized-name match against any named node, so
// "mars-north-pole", "Mars: north pole", and "mars north pole" all resolve.
// Backs the admin rocket-teleport tool, which requires a valid node.
export function resolveNodeRef(ref) {
  if (ref == null) return null;
  const s = String(ref).trim();
  if (!s) return null;
  if (NODES_BY_SLUG.has(s)) return s;
  const lower = s.toLowerCase();
  if (NODES_BY_SLUG.has(lower)) return lower;
  const norm = normalizeSiteName(s);
  if (!norm) return null;
  for (const n of NODES_BY_SLUG.values()) {
    if (n.name && normalizeSiteName(n.name) === norm) return n.slug;
  }
  return null;
}

// Curated data/sites.js metadata for a planner slug (class / hydration /
// vps / solarZone / name), or null for a waypoint / unmatched node. This
// is the engine's metadata accessor - the planner slug is the one id, so
// glory, prospect thresholds, and factory income all resolve through it.
export function siteBySlug(slug) {
  const n = NODES_BY_SLUG.get(String(slug));
  if (!n) return null;
  if (n.site) {
    // Attach the planner siteSize (e.g. "1M") so the engine reads the SAME
    // difficulty the client shows. It lives on the node, not the curated
    // data/sites.js entry; without it the prospect threshold falls back to the
    // class letter and disagrees with the popup (Oljato "1M" -> need a 1, not 3).
    return n.siteSize != null ? { ...n.site, siteSize: n.siteSize } : n.site;
  }
  // No curated data/sites.js row, but the planner node IS a real site: a
  // handful of obscure Trojan / Norse / KBO bodies (Thrymr, Phaethon,
  // Ultima-Thule, ...) live on the map and are clickable but were never added
  // to data/sites.js. The vendor JSON already carries their water + size, so
  // synthesize the metadata the engine needs (prospect / refuel) instead of
  // rejecting them as unknown_site. Curated rows still win above; this is only
  // the fallback. The spectral letter (from the size code) is the load-bearing
  // field - scoring is per Factory on a spectral-claimed site, not a per-site
  // VP - so vps is just a harmless shape field here.
  const isSite = n.type === 'site' || (typeof n.landing === 'number' && n.landing > 0);
  if (!isSite) return null;
  const ss = typeof n.siteSize === 'string' ? n.siteSize : null;
  const spectral = ss && /[A-Za-z]$/.test(ss) ? ss.slice(-1).toUpperCase() : 'C';
  return {
    id: n.slug,
    name: n.name || n.slug,
    body: n.name || null,
    type: 'asteroid',
    spectralType: spectral,
    hydration: Number.isFinite(n.siteWater) ? n.siteWater : 0,
    vps: 0,
    solarZone: zoneOfSlug(n.slug) || null,
    siteSize: n.siteSize != null ? n.siteSize : null,
    synthetic: true,
  };
}

// Numeric site size (the published "site number"), parsed from the
// planner's "1D" / "2C" style string. 0 for waypoints / unsized nodes.
// Mirror of browse.js#siteSizeNumber - drives the liftoff / landing
// thrust gate + factory assist.
export function nodeSizeNumber(slug) {
  const n = NODES_BY_SLUG.get(String(slug));
  const ss = n && n.siteSize;
  if (typeof ss === 'string') {
    const m = ss.match(/^(\d+)/);
    if (m) return Math.max(0, parseInt(m[1], 10));
  }
  if (typeof ss === 'number' && Number.isFinite(ss)) return Math.max(0, ss | 0);
  return 0;
}

// Slugs directly adjacent to a node (one edge away).
export function neighborSlugs(slug) {
  return (ADJ.get(String(slug)) || []).map((e) => e.to);
}

// Sites in the raygun's line of sight from `fromSlug`. Delegates to the
// SHARED beam walk (data/raygun-los.js) so the server accepts EXACTLY the
// raygun prospects the client offers - the beam traces transparent
// waypoints only and stops at the first real site, no divergent hop cap.
// Returns a Set of site slugs (excludes the origin).
export function lineOfSightSites(fromSlug) {
  const start = fromSlug == null ? leoSlug() : String(fromSlug);
  if (!ADJ.has(start)) return new Set();
  return raygunReachable(start, {
    neighbors: (slug) => neighborSlugs(slug),
    nodeOf: (slug) => NODES_BY_SLUG.get(slug) || null,
  });
}

// Curated body of a site slug (data/sites.js `body`, e.g. "Mars"), or null for
// a waypoint. Feeds the buggy-roam reach.
export function siteBodyOf(slug) {
  const s = siteBySlug(slug);
  return s ? (s.body || s.name || null) : null;
}

// Every real-site slug (waypoints excluded). Feeds the buggy-roam reach scan.
export function allSiteSlugs() {
  const out = [];
  for (const [slug, n] of NODES_BY_SLUG) if (n && n.site) out.push(slug);
  return out;
}

// Is this planner node a real Site (a landable body / surface), as opposed to
// a deep-space waypoint (lagrange / burn / hohmann transfer)? Used by the
// Solar Flare sweep for Bunker Shielding: cards on a Site are immune. Reads the
// node TYPE (not just curated metadata) so a site-type node that didn't match a
// data/sites.js name still counts as a site, and a burnspace that is itself a
// landing site (landing > 0) does too.
export function isSiteNode(slug) {
  const n = NODES_BY_SLUG.get(String(slug));
  if (!n) return false;
  return n.type === 'site' || (typeof n.landing === 'number' && n.landing > 0);
}

// Heliocentric solar zone for ANY planner node. A real site returns its curated
// solarZone; a deep-space waypoint inherits the zone of the nearest real site by
// map position, so an in-transit stack still reads a heliocentric-zone modifier
// for the Solar Flare sweep. Null only when the graph has no zoned sites.
let _zonedSites = null;
export function zoneOfSlug(slug) {
  const n = NODES_BY_SLUG.get(String(slug));
  if (!n) return null;
  if (n.site && n.site.solarZone) return n.site.solarZone;
  if (!_zonedSites) {
    _zonedSites = [];
    for (const node of NODES_BY_SLUG.values()) {
      if (node.site && node.site.solarZone && typeof node.x === 'number' && typeof node.y === 'number') {
        _zonedSites.push(node);
      }
    }
  }
  if (typeof n.x !== 'number' || typeof n.y !== 'number') return null;
  let best = null, bestD = Infinity;
  for (const s of _zonedSites) {
    const dx = s.x - n.x, dy = s.y - n.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = s; }
  }
  return best ? best.site.solarZone : null;
}

// Sites a buggy can road to from `fromSlug` on a connected body (Mars / Luna /
// Io / Callisto / Ganymede / Europa). Delegates to the SHARED body-based reach
// (data/buggy-roam.js) so the server accepts EXACTLY the buggy prospects the
// client offers. Returns a Set of site slugs (excludes the origin); empty
// unless the buggy sits on a roam body.
export function buggyRoamSites(fromSlug) {
  return buggyRoamReachable(fromSlug == null ? null : String(fromSlug), {
    bodyOf: (slug) => siteBodyOf(slug),
    siteIds: () => allSiteSlugs(),
  });
}

// An aerobrake corridor node: carries the node-tags 'aerobrake' flag (the
// SAME flag the client renders the 🪂 sprite from, keyed by the slug == id2).
// Shared static source of truth so client + server agree byte-for-byte. Drives
// BOTH the atmospheric-entry hazard roll AND the landing-thrust-gate waiver
// (you parachute down). NOT the same as a Venus gravity-assist flyby.
export function isAerobrakeNode(slug) {
  const t = NODE_TAGS[String(slug)];
  return !!(t && t.aerobrake);
}

// Sites you can parachute onto: a real site within a few hops of an aerobrake
// corridor (the 🪂 symbol next to it). Landing there waives the thrust-to-land
// gate, since you descend by parachute. Memoised: built once from the static
// graph + node-tags via the SHARED helper the client also uses, so both agree.
let _aeroLandable = null;
export function isAerobrakeLandableSite(slug) {
  if (!_aeroLandable) {
    const aeroIds = [];
    for (const s of NODES_BY_SLUG.keys()) if (isAerobrakeNode(s)) aeroIds.push(s);
    _aeroLandable = aerobrakeLandableSet({
      aeroIds,
      neighborsOf: (s) => neighborSlugs(s),
      isSiteId: (s) => isSiteNode(s),
      maxHops: 3,
    });
  }
  return _aeroLandable.has(String(slug));
}

// Hazard class of a planner node (mirror of browse.js#classifyHazard so
// the server resolves the SAME hazards the sandbox shows):
//   'rad'   - radiation zone (rolls, NOT aqua-payable)
//   'aero'  - aerobrake corridor (aqua-payable; parachute card waives it)
//   'skull' - any node the CURATED tags mark as a hazard (aqua-payable)
//   null    - safe (anything the tags don't mark)
export function hazardKind(slug) {
  const n = NODES_BY_SLUG.get(String(slug));
  if (!n) return null;
  if (n.type === 'radhaz') return 'rad';
  // Aerobrake corridors are atmospheric-entry hazard spaces - you parachute
  // through them (roll or pay). Checked before the skull case so they read
  // 'aero' (parachute-waivable) rather than a plain skull.
  if (isAerobrakeNode(slug)) return 'aero';
  // The CURATED node tags (data/node-tags.js) are the source of truth for skull
  // hazards, NOT the planner's own coarse flag (it marks nearly every inner
  // lagrange). A hazard can sit on ANY node type the tags mark - lagranges
  // included. Mirrors the client (planner-map sets site.hazard from the same
  // tag map). (User: engine should use my tags.)
  if (NODE_TAGS[String(slug)] && NODE_TAGS[String(slug)].hazard) return 'skull';
  return null;
}

// Find the LEO lagrange node once - that's the canonical "at LEO"
// destination when player.rocket.siteId is null. Falls back to
// scanning for a lagrange named "LEO".
let _leoSlug = null;
export function leoSlug() {
  if (_leoSlug) return _leoSlug;
  for (const n of NODES_BY_SLUG.values()) {
    if (n.type === 'lagrange' && n.name && n.name.toLowerCase() === 'leo') {
      _leoSlug = n.slug;
      return _leoSlug;
    }
  }
  return null;
}

// Dijkstra over the slug-keyed adjacency. Treats null `from` as the
// LEO lagrange slug so a fresh rocket can launch from LEO without
// special-casing in every caller. Returns { path, totalBurns,
// segments } or null when unreachable / unknown ids.
export function findPath(fromSlug, toSlug) {
  const f = fromSlug == null ? leoSlug() : String(fromSlug);
  const t = String(toSlug);
  if (!ADJ.has(f) || !ADJ.has(t)) return null;
  if (f === t) return { path: [f], totalBurns: 0, segments: [] };

  const dist = new Map([[f, 0]]);
  const prev = new Map();
  const heap = new MinHeap();
  heap.push(0, f);
  while (heap.size) {
    const cur = heap.pop();
    if (cur === t) break;
    const d = dist.get(cur);
    for (const { to, burns } of ADJ.get(cur) || []) {
      const nd = d + burns;
      if (nd < (dist.get(to) ?? Infinity)) {
        dist.set(to, nd);
        prev.set(to, { from: cur, burns });
        heap.push(nd, to);
      }
    }
  }
  if (!dist.has(t)) return null;
  const path = [t];
  const segments = [];
  let cur = t;
  while (prev.has(cur)) {
    const { from, burns } = prev.get(cur);
    segments.unshift({ from, to: cur, burns });
    path.unshift(from);
    cur = from;
  }
  return { path, totalBurns: dist.get(t), segments };
}

class MinHeap {
  constructor() { this.h = []; }
  get size() { return this.h.length; }
  push(k, v) { this.h.push([k, v]); this._up(this.h.length - 1); }
  pop() {
    const top = this.h[0][1];
    const last = this.h.pop();
    if (this.h.length) { this.h[0] = last; this._down(0); }
    return top;
  }
  _up(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.h[p][0] <= this.h[i][0]) break;
      [this.h[p], this.h[i]] = [this.h[i], this.h[p]];
      i = p;
    }
  }
  _down(i) {
    const n = this.h.length;
    for (;;) {
      const l = i * 2 + 1, r = l + 1; let s = i;
      if (l < n && this.h[l][0] < this.h[s][0]) s = l;
      if (r < n && this.h[r][0] < this.h[s][0]) s = r;
      if (s === i) break;
      [this.h[s], this.h[i]] = [this.h[i], this.h[s]];
      i = s;
    }
  }
}
