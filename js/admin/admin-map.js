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
  // No ambient redraw loop on the admin map (user 2026-07-31). This is a
  // diagnostic surface, so the drifting rockets / belt twinkle / hazard pulse
  // buy nothing and cost a full-scene repaint ~60 times a second while the
  // modal is open. Interaction still repaints on demand, so pan, zoom and
  // clicking a node all behave exactly as before.
  renderer.setStaticMap(true);
  // LEO's world position, memoised. Declared HERE rather than further down
  // because the framing below calls it, and `waitForSize` can run frame()
  // synchronously - a later `const` would still be in its temporal dead zone.
  let _leoPos;
  const leoWorld = () => {
    if (_leoPos === undefined) {
      const leo = (_data.sites || []).find((s) => s.name && String(s.name).toLowerCase() === 'leo');
      _leoPos = (leo && Number.isFinite(leo.x)) ? { x: leo.x, y: leo.y } : null;
    }
    return _leoPos;
  };
  // Open ZOOMED IN rather than on the whole-system overview (user 2026-07-31):
  // at the wide framing every node is a few pixels across, so the admin's first
  // action was always to zoom anyway - and the wide view is the most expensive
  // one to draw (every body, halo and label in the scene at once).
  //
  // Centre on LEO, where a game's pieces start and most corrections are needed,
  // falling back to the centroid of the map when LEO has no position. ADMIN_ZOOM
  // is the renderer's own default play zoom, so this frames the board the way a
  // player sees it.
  const ADMIN_ZOOM = 6;
  let cx = 0, cy = 0, k = 0;
  for (const s of _data.sites || []) {
    if (Number.isFinite(s.x) && Number.isFinite(s.y)) { cx += s.x; cy += s.y; k++; }
  }
  const frame = () => {
    const leo = leoWorld();
    if (leo) { renderer.flyTo(leo, ADMIN_ZOOM, { ms: 0 }); return; }
    if (k) renderer.flyTo({ x: cx / k, y: cy / k }, ADMIN_ZOOM, { ms: 0 });
  };
  let tries = 0;
  const waitForSize = () => {
    if (host.clientWidth > 0 && host.clientHeight > 0) { frame(); return; }
    if (tries++ > 60) { frame(); return; }
    requestAnimationFrame(waitForSize);
  };
  waitForSize();

  // Suppress the renderer's auto-fly-to-rocket: we frame the whole map above and
  // re-point the rocket sprite on every acting-player switch, so it must NOT
  // yank the camera each time setSandboxRocket runs.
  renderer._initialViewDone = true;

  // World (x,y) of a server slug, or null (waypoint with no position / unknown).
  const worldOf = (slug) => {
    const id = slug && _slugToId[slug];
    const n = id && _data.byId[id];
    return (n && Number.isFinite(n.x) && Number.isFinite(n.y)) ? { x: n.x, y: n.y } : null;
  };
  let _view = null, _actor = null;
  const actingPlayer = () => {
    const players = (_view && _view.players) || [];
    return players.find((p) => p.profileId === _actor) || players[0] || null;
  };

  return {
    renderer,
    data: _data,
    // Push the current game state onto the map: ALL factories (+ colony domes)
    // tinted by owner, plus the ACTING player's rocket sprite + outpost chits
    // (the renderer carries one ship + one outpost set, so they follow the
    // acting-player selector) and a focus ring on the rocket's site.
    // Push the current game state onto the map: ALL factories (+ colony domes),
    // ALL players' rockets, and ALL players' outposts, each tinted by owner, so
    // the admin sees every piece at once. The acting-player selector only
    // chooses WHO map clicks act on (teleport / build), not what's visible.
    update(view, actorPid) {
      _view = view; _actor = actorPid;
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
      // Every player's rocket, Freighter big cube, and Bernal colonies, drawn via
      // the multi-piece paths (each seat-colored). All three share ONE colocation
      // counter per node so a rocket + freighter + Bernal at the same site fan out
      // beside each other instead of stacking dead-on (mirrors the sandbox's
      // shared colocation row).
      const rockets = [];
      const freighters = [];
      const bernalsOut = [];
      const seenAt = {};
      const stagger = (slug) => {
        const key = slug || 'leo';
        return ((seenAt[key] = (seenAt[key] || 0) + 1) - 1) * 22;
      };
      for (const p of players) {
        const rSlug = (p.rocket && p.rocket.siteId) || null;
        const pos = worldOf(rSlug) || leoWorld();
        if (!pos) continue;
        rockets.push({ x: pos.x, y: pos.y, colour: p.color || 'white', name: p.name, offsetX: stagger(rSlug) });
      }
      for (const p of players) {
        const fr = p.freighter;
        if (fr) {
          const pos = worldOf(fr.siteId) || leoWorld();
          if (pos) freighters.push({
            profileId: p.profileId, x: pos.x, y: pos.y,
            colour: p.color || 'white', promoted: !!fr.promoted, offsetX: stagger(fr.siteId),
          });
        }
        for (const bn of (p.bernals || [])) {
          const pos = worldOf(bn.siteId) || leoWorld();
          if (!pos) continue;
          bernalsOut.push({
            profileId: p.profileId, index: bn.index | 0, x: pos.x, y: pos.y,
            colour: p.color || 'white', kind: bn.figure === 'stanford' ? 'stanford' : 'kalpana',
            anchored: !!bn.anchored, offsetX: stagger(bn.siteId),
          });
        }
      }
      renderer.setSandboxRocket(null);     // no single "acting" ship - show them all
      renderer.setMpRockets(rockets);
      // Freighters + Bernals: the admin shows ALL via the opponent (mp) paths, the
      // same way it shows all rockets; the local-only setters stay null.
      if (typeof renderer.setMpFreighters === 'function') renderer.setMpFreighters(freighters);
      if (typeof renderer.setMpBernals === 'function') renderer.setMpBernals(bernalsOut);
      // Focus ring on the ACTING player's rocket so the selector still reads.
      const me = actingPlayer();
      const meSlug = (me && me.rocket && me.rocket.siteId) || null;
      renderer.setFocusedSiteId(meSlug ? (_slugToId[meSlug] || null) : null);
      // Every player's outposts, keyed uniquely (pid+letter) with the owner color.
      const outs = {};
      for (const p of players) {
        const oin = (p && p.outposts) || {};
        for (const k of Object.keys(oin)) {
          const o = oin[k]; const cid = o && o.siteId && _slugToId[o.siteId];
          if (!cid) continue;
          outs[`${p.profileId}${o.letter || k}`] = {
            letter: o.letter || k, siteId: cid, cards: o.cards || [], tank: o.tank || 0, color: p.color || null,
          };
        }
      }
      renderer.setOutposts(outs);
    },
    // Camera helpers for the "Locate" buttons. Each flies to the relevant spot.
    focusRocket() {
      const me = actingPlayer();
      const pos = worldOf(me && me.rocket && me.rocket.siteId) || leoWorld();
      if (pos) renderer.flyTo(pos, 5, { ms: 400 });
    },
    focusOutposts() {
      const me = actingPlayer();
      const pts = Object.values((me && me.outposts) || {}).map((o) => worldOf(o && o.siteId)).filter(Boolean);
      this._flyToPoints(pts);
    },
    focusFactories() {
      const pts = ((_view && _view.factories) || []).map((f) => worldOf(f.slug)).filter(Boolean);
      this._flyToPoints(pts);
    },
    _flyToPoints(pts) {
      if (!pts.length) return;
      let cx = 0, cy = 0; for (const p of pts) { cx += p.x; cy += p.y; }
      renderer.flyTo({ x: cx / pts.length, y: cy / pts.length }, pts.length === 1 ? 5 : 2.5, { ms: 400 });
    },
    // Fly to a single slug (used by the Locate pickers).
    flyToSlug(slug) { const p = worldOf(slug) || (slug ? null : leoWorld()); if (p) renderer.flyTo(p, 5, { ms: 400 }); },
    // Option lists for the Locate pickers (all factories; the acting player's outposts).
    listFactories() {
      return ((_view && _view.factories) || []).map((f) => ({
        slug: f.slug, name: this.siteName(f.slug), owner: f.ownerName || ('#' + f.ownerId), color: f.ownerColor, hasColony: !!f.hasColony,
      }));
    },
    listOutposts() {
      const me = actingPlayer();
      return Object.keys((me && me.outposts) || {}).map((k) => {
        const o = me.outposts[k];
        return { letter: o.letter || k, slug: o.siteId, name: this.siteName(o.siteId) };
      }).filter((o) => o.slug);
    },
    siteName(slug) { const id = _slugToId[slug]; const n = id && _data.byId[id]; return (n && n.name) || slug; },
    isSite(slug) { const id = _slugToId[slug]; const n = id && _data.byId[id]; return !!(n && n.name && n.isLandable !== false); },
  };
}
