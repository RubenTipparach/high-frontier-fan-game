// Bridge between a server game snapshot and the sandbox state modules.
//
// The sandbox UI renders entirely from the state modules (rocket.js,
// hand.js, discs.js, ...), so hydrating those modules from a server
// snapshot makes the classic map + panels show the live multiplayer
// game - no second renderer needed. This module is the one place that
// (a) maps site ids across the two worlds and (b) fans a snapshot out
// to the per-module hydrators.
//
// Site-id boundary: the server speaks data/sites.js slugs
// ("mercury_north_pole"); the classic planner map keys off its own node
// ids, with each matched site carrying a `serverId` (its sites.js id,
// stamped in planner-map.js). We translate site-keyed state here.
// Anything that doesn't translate (a server site with no matching
// planner node, or vice-versa) is dropped from the render rather than
// mis-placed; getUnmatchedServerSites() reports the gap for debugging.

import { hydrateRocket, setAqua } from './rocket.js';
import { hydrateHand } from './hand.js';
import { hydrateOutposts } from './stacks.js';
import { hydrateDiscs } from './discs.js';
import { hydrateFactories } from './factories.js';
import { hydrateGlory } from './glory.js';
import { hydrateDecks } from './decks.js';
import { hydrateLeo } from './leo-stack.js';
import { hydrateClock } from './turn-clock.js';

// Build server-slug <-> planner-node-id maps from loaded planner data.
export function buildIdMaps(mapData) {
  const serverToPlanner = new Map();
  const plannerToServer = new Map();
  for (const s of (mapData && mapData.sites) || []) {
    if (!s.serverId) continue;
    serverToPlanner.set(s.serverId, s.id);
    plannerToServer.set(s.id, s.serverId);
  }
  return { serverToPlanner, plannerToServer };
}

// planner node id -> server slug (for outgoing op payloads).
export function toServerId(maps, plannerId) {
  if (!maps || plannerId == null) return null;
  return maps.plannerToServer.get(plannerId) || null;
}

// server slug -> planner node id (for placing things on the map).
export function toPlannerId(maps, serverId) {
  if (!maps || serverId == null) return null;
  return maps.serverToPlanner.get(serverId) || null;
}

// Server site ids that have no planner node to render on (name-match
// gaps). Useful to log once so missing markers are explainable.
export function getUnmatchedServerSites(maps, snapshot) {
  if (!maps || !snapshot) return [];
  const ids = new Set();
  for (const k of Object.keys(snapshot.discs || {})) ids.add(k);
  for (const k of Object.keys(snapshot.factories || {})) ids.add(k);
  for (const k of Object.keys(snapshot.colonies || {})) ids.add(k);
  for (const p of snapshot.players || []) {
    if (p.rocket && p.rocket.siteId) ids.add(p.rocket.siteId);
  }
  return [...ids].filter((id) => !maps.serverToPlanner.has(id));
}

// Re-key a {[serverSiteId]: value} map onto planner node ids, dropping
// entries whose site has no planner node.
function rekeyToPlanner(maps, obj) {
  const out = {};
  for (const [serverId, val] of Object.entries(obj || {})) {
    const pid = maps.serverToPlanner.get(serverId);
    if (pid != null) out[pid] = val;
  }
  return out;
}

// Hydrate every sandbox module from one server snapshot, for player
// `myId`. Returns the planner-node id the player's rocket sits on, or
// null (render at LEO) when the server site has no planner node.
export function hydrateFromSnapshot(snapshot, myId, maps) {
  if (!snapshot) return null;
  const me = (snapshot.players || []).find((p) => p.profileId === myId);
  // Personal state (rocket / hand / outposts / glory / clock / LEO).
  // For a spectator (myId not in the roster) every personal hydrator
  // gets an empty payload so the side panels read "no rocket" /
  // "no hand" etc. instead of carrying stale solo state. The shared
  // board state still hydrates below so the spectator sees the
  // live map.
  const r = (me && me.rocket) || {};
  hydrateRocket({
    stack: r.stack || [],
    activeThrusterId: r.activeThrusterId || null,
    activeProspectorId: r.activeProspectorId || null,
    tank: r.tank | 0,
    afterburnEngaged: !!r.afterburnEngaged,
  });
  setAqua(me ? (me.aqua | 0) : 0);
  hydrateHand((me && me.hand) || []);

  // Outposts are keyed by letter; translate the site each one sits on.
  const outposts = {};
  for (const [letter, op] of Object.entries((me && me.outposts) || {})) {
    const siteId = op && op.siteId;
    outposts[letter] = {
      ...op,
      siteId: (siteId && maps.serverToPlanner.get(siteId)) || siteId || null,
    };
  }
  hydrateOutposts(outposts);

  hydrateGlory((me && me.glory) || {});
  hydrateClock({
    turn: snapshot.turn | 0,
    round: snapshot.round || 1,
    lastEvent: snapshot.lastEvent || null,
    opsRemaining: me ? (me.opsRemaining | 0) : 0,
    movesRemaining: me ? (me.movesRemaining | 0) : 0,
    discardsRemaining: me ? (me.discardsRemaining | 0) : 0,
  });

  // Shared, site-keyed board state -> re-key onto planner ids. This
  // is the live map every player + spectator sees.
  hydrateDiscs(rekeyToPlanner(maps, snapshot.discs));
  hydrateFactories(
    rekeyToPlanner(maps, snapshot.factories),
    rekeyToPlanner(maps, snapshot.colonies),
  );
  hydrateDecks(snapshot.decks || {});
  // LEO Stack: server carries a flat per-player slot array
  // (state.js#freshPlayer.leo). Spectators see no LEO stack (no
  // player slot of their own).
  hydrateLeo((me && me.leo) || []);

  return (me && r.siteId && maps.serverToPlanner.get(r.siteId)) || null;
}
