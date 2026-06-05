// Stage-3 factories + colonies.
//
// A Factory is a chit placed at a site after the I7 Industrialize
// op resolves. It inherits the site's spectral type (used to gate
// ET Production cards). A Colony is a dome token placed on top of
// a factory after the G3 Build Colony free action consumes a
// colocated Human card.
//
// Colonies are NOT cards in this variant - they are pure tokens
// (see industrialize.md "Colonies are tokens, not cards"). The
// Crew that gets consumed returns to LEO Hand; the colony record
// here only tracks the owner + the site it sits on.
//
// One factory + one colony per site, max. Per-player colony cap
// is 7 (matches rulebook B8). VPs are tallied at endgame only
// (rulebook M2), not at build time - this module exposes the
// records but does not award VP itself.
//
// Public surface:
//   getFactory(siteId)                       record | null
//   allFactories()                           record[]
//   createFactory(siteId, ownerId, spectral) boolean
//   removeFactory(siteId)                    boolean
//   onFactoryChange(cb)                      unsubscribe
//
//   getColony(siteId)                        record | null
//   allColonies()                            record[]
//   countColoniesByOwner(ownerId)            number
//   createColony(siteId, ownerId)            boolean
//   removeColony(siteId)                     boolean
//   onColonyChange(cb)                       unsubscribe
//
//   COLONY_CAP_PER_PLAYER                    7
//
// Factory record shape:
//   { siteId, ownerId, spectralType }
// Colony record shape:
//   { siteId, ownerId }

import { isOnline } from './online-mode.js';

const FACTORIES_KEY = 'hf-sandbox-factories';
const COLONIES_KEY  = 'hf-sandbox-colonies';

export const COLONY_CAP_PER_PLAYER = 7;

const VALID_SPECTRALS = new Set(['C', 'S', 'M', 'V', 'D', 'H']);

function readFactories() {
  try {
    const raw = localStorage.getItem(FACTORIES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out = {};
    for (const [siteId, rec] of Object.entries(parsed)) {
      if (!rec || !rec.ownerId || !rec.spectralType) continue;
      if (!VALID_SPECTRALS.has(rec.spectralType)) continue;
      out[siteId] = {
        siteId,
        ownerId: String(rec.ownerId),
        spectralType: rec.spectralType,
      };
    }
    return out;
  } catch { return {}; }
}

function readColonies() {
  try {
    const raw = localStorage.getItem(COLONIES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out = {};
    for (const [siteId, rec] of Object.entries(parsed)) {
      if (!rec || !rec.ownerId) continue;
      out[siteId] = { siteId, ownerId: String(rec.ownerId) };
    }
    return out;
  } catch { return {}; }
}

let _factories = readFactories();
let _colonies  = readColonies();

let _factoryListeners = [];
let _colonyListeners  = [];

function persistFactories() {
  if (isOnline()) return;
  try { localStorage.setItem(FACTORIES_KEY, JSON.stringify(_factories)); }
  catch { /* private mode */ }
}
function persistColonies() {
  if (isOnline()) return;
  try { localStorage.setItem(COLONIES_KEY, JSON.stringify(_colonies)); }
  catch { /* private mode */ }
}
function notifyFactories() {
  for (const cb of _factoryListeners) {
    try { cb(); } catch (err) { console.error('factory listener:', err); }
  }
}
function notifyColonies() {
  for (const cb of _colonyListeners) {
    try { cb(); } catch (err) { console.error('colony listener:', err); }
  }
}

// Replace the in-memory factory + colony maps from a server
// snapshot. Fires both subscriber sets.
export function hydrateFactories(factories = {}, colonies = {}) {
  let f;
  let c;
  try { f = structuredClone(factories); }
  catch { f = JSON.parse(JSON.stringify(factories)); }
  try { c = structuredClone(colonies); }
  catch { c = JSON.parse(JSON.stringify(colonies)); }
  _factories = (f && typeof f === 'object') ? f : {};
  _colonies  = (c && typeof c === 'object') ? c : {};
  notifyFactories();
  notifyColonies();
}

// --------- Factories ---------

export function getFactory(siteId) {
  if (!siteId) return null;
  const rec = _factories[siteId];
  return rec ? { ...rec } : null;
}

export function allFactories() {
  // Derive siteId from the KEY, never the record body. An online snapshot's
  // factory value is { ownerId, spectralType } with NO siteId field (the server
  // keys state.factories by site, so the id lives only in the key). Map
  // consumers key off f.siteId (browse.js#syncFactories -> the renderer chit
  // layer); without this every factory would collapse to map[undefined] and no
  // 🏭 chit would draw online. Solo's createFactory writes siteId into the value
  // too, so the key stays authoritative either way.
  return Object.entries(_factories).map(([siteId, r]) => ({ ...r, siteId }));
}

export function createFactory(siteId, ownerId, spectralType) {
  if (!siteId || !ownerId || !spectralType) return false;
  if (!VALID_SPECTRALS.has(spectralType)) return false;
  if (_factories[siteId]) return false;
  _factories[siteId] = {
    siteId: String(siteId),
    ownerId: String(ownerId),
    spectralType,
  };
  persistFactories();
  notifyFactories();
  return true;
}

// Removing a factory also removes the colony sitting on it (if
// any) - a colony cannot exist without its host factory.
export function removeFactory(siteId) {
  if (!_factories[siteId]) return false;
  delete _factories[siteId];
  persistFactories();
  if (_colonies[siteId]) {
    delete _colonies[siteId];
    persistColonies();
    notifyColonies();
  }
  notifyFactories();
  return true;
}

export function onFactoryChange(cb) {
  _factoryListeners.push(cb);
  return () => { _factoryListeners = _factoryListeners.filter((x) => x !== cb); };
}

// --------- Colonies ---------

export function getColony(siteId) {
  if (!siteId) return null;
  const rec = _colonies[siteId];
  return rec ? { ...rec } : null;
}

export function allColonies() {
  // Same as allFactories: an online colony value is { ownerId } with no siteId
  // field, so derive siteId from the key or the colony-ring layer collapses to
  // map[undefined] and never draws.
  return Object.entries(_colonies).map(([siteId, r]) => ({ ...r, siteId }));
}

export function countColoniesByOwner(ownerId) {
  if (!ownerId) return 0;
  let n = 0;
  for (const rec of Object.values(_colonies)) {
    if (rec.ownerId === ownerId) n++;
  }
  return n;
}

// Colonize requires (validated by the caller):
//   - a factory exists at siteId AND is owned by ownerId
//   - a Human (crew) card is colocated with the factory
//   - the player has not hit COLONY_CAP_PER_PLAYER
// This function performs ONLY the cap + duplicate checks;
// gating on factory ownership + colocated crew is the caller's
// responsibility (it has the stack context).
export function createColony(siteId, ownerId) {
  if (!siteId || !ownerId) return false;
  if (_colonies[siteId]) return false;
  if (countColoniesByOwner(ownerId) >= COLONY_CAP_PER_PLAYER) return false;
  _colonies[siteId] = { siteId: String(siteId), ownerId: String(ownerId) };
  persistColonies();
  notifyColonies();
  return true;
}

export function removeColony(siteId) {
  if (!_colonies[siteId]) return false;
  delete _colonies[siteId];
  persistColonies();
  notifyColonies();
  return true;
}

export function onColonyChange(cb) {
  _colonyListeners.push(cb);
  return () => { _colonyListeners = _colonyListeners.filter((x) => x !== cb); };
}

// Wipe every factory + colony. Called by the sandbox reset flow
// and the Card Market toggle reset. Fires both subscriber sets.
export function resetFactoriesAndColonies() {
  _factories = {};
  _colonies = {};
  persistFactories();
  persistColonies();
  notifyFactories();
  notifyColonies();
}
