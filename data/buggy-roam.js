// Buggy road networks. PURE + SHARED by the client scan gate (js/game/scan.js)
// and the server engine (server/game/planner-graph.js) so BOTH compute the SAME
// set of buggy-prospectable sites - one model, two callers, like raygun-los.js.
//
// Rule (user 2026-06-10): on a handful of large bodies every surface site is
// connected by buggy roads, so a buggy parked on one site can prospect ANY land
// site on the SAME body - it "acts as a raygun" there (extended reach AND the
// free-after-the-first-scan economy). Elsewhere a buggy must still land on its
// target. The shared body is the "<Body>:" prefix players read on the site name
// ("Mars: Hellas Basin" + "Mars: North Pole" are one road network).

// Canonical body key: first word of a body / site-name, lowercased. Matches
// js/game/planner-map.js#bodyKeyFor so the client (site name) and the server
// (curated site.body) reduce a body to the SAME key. "Mars" / "mars" /
// "Mars: North Pole" / "Mars Hellas Basin" all collapse to "mars".
export function bodyKey(body) {
  return String(body || '').toLowerCase().replace(/[:\-].*$/, '').split(/\s+/)[0] || '';
}

// The roam bodies, as canonical keys: Mars, Luna (the Moon), Io, Callisto,
// Ganymede, Europa.
export const BUGGY_ROAM_BODIES = new Set(['mars', 'luna', 'io', 'callisto', 'ganymede', 'europa']);

export function isBuggyRoamBody(body) {
  return BUGGY_ROAM_BODIES.has(bodyKey(body));
}

// Same-body land sites a buggy can road to from `fromId` (the origin is
// excluded - the at-site case is handled by the caller). Empty unless fromId
// sits on a roam body. Accessors are supplied in the caller's own id space
// (server slugs / client node ids), exactly like raygun-los.js:
//   bodyOf(id) -> the site's body string (or name) | null
//   siteIds()  -> iterable of every prospectable site id
export function buggyRoamReachable(fromId, { bodyOf, siteIds } = {}) {
  const out = new Set();
  if (fromId == null || typeof bodyOf !== 'function' || typeof siteIds !== 'function') return out;
  const key = bodyKey(bodyOf(fromId));
  if (!BUGGY_ROAM_BODIES.has(key)) return out;
  for (const id of siteIds() || []) {
    if (id === fromId) continue;
    if (bodyKey(bodyOf(id)) === key) out.add(id);
  }
  return out;
}
