// Admin map adapter. REUSES the client solar map (the same MapRenderer +
// loadPlannerMap the player sandbox mounts) inside the /admin "Manage state"
// modal - we do NOT build a second map. The admin only needs two interactions:
// teleport a chosen player's rocket, and place/remove a factory. Everything
// else (Lagrange rings, Hohmann dots, body halos, factory sprites, pan/zoom) is
// the real renderer's, unchanged.
//
// ID bridging: the client map keys nodes by the planner's raw point id, while
// the server state (factories, rocket.siteId) uses the disambiguated `id2`
// slug. Every client site carries BOTH (planner-map.js stamps `id2`), so we
// build slug<->clientId maps once and translate at the boundary: setFactories /
// setColonies / focus take client ids; onPickSite hands the admin back the id2
// slug the edit endpoints expect.

import { loadPlannerMap } from '../game/planner-map.js';
import { MapRenderer } from '../game/render.js';

let _data = null;        // shared planner map (loaded once)
let _slugToId = null;    // id2 slug -> client node id
let _idToSlug = null;    // client node id -> id2 slug

function buildIdMaps(data) {
  _slugToId = {};
  _idToSlug = {};
  for (const s of data.sites || []) {
    if (s && s.id2) { _slugToId[s.id2] = s.id; _idToSlug[s.id] = s.id2; }
  }
}

// Mount the real map into `host` (a sized container div). onPickSite(slug, site)
// fires when the admin clicks a real site/node, with the SERVER id2 slug.
export async function mountAdminMap(host, { onPickSite } = {}) {
  if (!_data) {
    _data = await loadPlannerMap({ viewW: 1200, viewH: 760 });
    buildIdMaps(_data);
  }
  const renderer = new MapRenderer(host, {
    data: _data,
    onSelect: (site) => {
      if (!onPickSite || !site) return;
      // Prefer the disambiguated slug; fall back to a lookup, then the raw id.
      const slug = site.id2 || _idToSlug[site.id] || site.id;
      onPickSite(slug, site);
    },
  });
  // Make WAYPOINTS clickable too (lagrange / burn / hohmann), not just landable
  // sites, so the admin can teleport a rocket to any node - same hit mode the
  // route planner uses.
  renderer.setRoutingHit(true);
  // Wide framing so the whole system is visible (admin overview, not a focused
  // play camera). Defer until the host actually has a size: mounting inside a
  // just-shown modal can leave clientWidth at 0 for a frame, which would make
  // the camera (and click hit-testing) resolve against a zero-size canvas.
  let cx = 0, cy = 0, k = 0;
  for (const s of _data.sites || []) {
    if (Number.isFinite(s.x) && Number.isFinite(s.y)) { cx += s.x; cy += s.y; k++; }
  }
  const frame = () => { if (k) renderer.flyTo({ x: cx / k, y: cy / k }, 1, { ms: 0 }); };
  let tries = 0;
  const waitForSize = () => {
    if (host.clientWidth > 0 && host.clientHeight > 0) { frame(); return; }
    if (tries++ > 60) { frame(); return; }
    requestAnimationFrame(waitForSize);
  };
  waitForSize();

  return {
    renderer,
    data: _data,
    // Push the current game state onto the map: factories (+ colony domes) tinted
    // by owner colour, and a focus ring on the acting player's rocket so the
    // admin can see where a teleport starts from.
    update(view, actorPid) {
      const facs = {}, cols = {};
      for (const f of (view && view.factories) || []) {
        const cid = _slugToId[f.slug];
        if (!cid) continue;   // a slug with no client node (shouldn't happen) is skipped
        facs[cid] = { ownerId: f.ownerId, spectralType: f.spectralType, color: f.ownerColor };
        if (f.hasColony) cols[cid] = { ownerId: f.ownerId };
      }
      renderer.setFactories(facs);
      renderer.setColonies(cols);
      const players = (view && view.players) || [];
      const me = players.find((p) => p.profileId === actorPid) || players[0] || null;
      const slug = me && me.rocket && me.rocket.siteId;
      renderer.setFocusedSiteId(slug ? (_slugToId[slug] || null) : null);
    },
    siteName(slug) { const id = _slugToId[slug]; const n = id && _data.byId[id]; return (n && n.name) || slug; },
    isSite(slug) { const id = _slugToId[slug]; const n = id && _data.byId[id]; return !!(n && n.name && n.isLandable !== false); },
  };
}
