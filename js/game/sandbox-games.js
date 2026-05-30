// Local sandbox-game registry: multiple solo games, each with an id, that
// show up in "Your games", route to /sandbox/<id>, and can be abandoned.
//
// The sandbox state modules persist to fixed localStorage keys (the "live"
// game). To support several games without refactoring every module, we
// snapshot the live keys into a per-id blob (hf-sb-save-<id>) when leaving
// a game and restore them when entering another. A reload then lets the
// modules re-read the restored live keys. Only GAME_KEYS are swapped, so
// global UI prefs (map / zone / route-priority) stay shared across games.

const META_GAMES = 'hf-sb-games';     // registry: [{id, createdAt, lastPlayedAt}]
const META_ACTIVE = 'hf-sb-active';   // id of the game currently in the live keys
const SAVE_PREFIX = 'hf-sb-save-';    // per-game snapshot blob

// The exact per-game state keys (everything a single sandbox game owns).
// NOT global prefs: map-*, zone-*, route-priority, fuel-consumption,
// starter-cash are deliberately excluded so they stay shared.
const GAME_KEYS = [
  'hf-sandbox-rocket', 'hf-sandbox-aqua', 'hf-sandbox-rocket-site',
  'hf-sandbox-rocket-trail', 'hf-sandbox-planned-route', 'hf-sandbox-pending-move',
  'hf-sandbox-hazardous-move', 'hf-sandbox-hand', 'hf-sandbox-leo-cards',
  'hf-sandbox-prospect-discs', 'hf-sandbox-factories', 'hf-sandbox-colonies',
  'hf-sandbox-outposts', 'hf-sandbox-focused-stack', 'hf-sandbox-market-decks',
  'hf-sandbox-card-market-mode', 'hf-sandbox-turn', 'hf-sandbox-round',
  'hf-sandbox-last-event', 'hf-sandbox-ops', 'hf-sandbox-moves',
  'hf-sandbox-discards', 'hf-sandbox-refuel-log', 'hf-sandbox-crew-faction',
  'hf-glory-chits', 'hf-glory-claimed', 'hf-glory-visited', 'hf-glory-vps',
  'hf-mission-log', 'hf-mission-history',
];

const ID_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';   // Crockford base32
function genId(len = 6) {
  let s = '';
  const a = new Uint8Array(len);
  (self.crypto || window.crypto).getRandomValues(a);
  for (let i = 0; i < len; i++) s += ID_ALPHABET[a[i] % ID_ALPHABET.length];
  return s;
}

function readGames() {
  try { return JSON.parse(localStorage.getItem(META_GAMES) || '[]') || []; }
  catch { return []; }
}
function writeGames(arr) {
  try { localStorage.setItem(META_GAMES, JSON.stringify(arr)); } catch { /* private mode */ }
}

export function currentSandboxId() {
  try { return localStorage.getItem(META_ACTIVE) || null; } catch { return null; }
}
function setActive(id) {
  try { id ? localStorage.setItem(META_ACTIVE, id) : localStorage.removeItem(META_ACTIVE); }
  catch { /* private mode */ }
}

// Games newest-played first, for the "Your games" list.
export function listSandboxGames() {
  ensureLegacyGame();
  return readGames().slice().sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0));
}

function snapshotLive() {
  const blob = {};
  for (const k of GAME_KEYS) {
    const v = localStorage.getItem(k);
    if (v != null) blob[k] = v;
  }
  return blob;
}
function clearLive() {
  for (const k of GAME_KEYS) {
    try { localStorage.removeItem(k); } catch { /* private mode */ }
  }
}
function restoreLive(blob) {
  clearLive();
  for (const [k, v] of Object.entries(blob || {})) {
    if (GAME_KEYS.includes(k)) {
      try { localStorage.setItem(k, v); } catch { /* private mode */ }
    }
  }
}
function writeBlob(id, blob) {
  try { localStorage.setItem(SAVE_PREFIX + id, JSON.stringify(blob)); } catch { /* private mode */ }
}
function readBlob(id) {
  try { return JSON.parse(localStorage.getItem(SAVE_PREFIX + id) || 'null'); }
  catch { return null; }
}

function touch(id) {
  const games = readGames();
  const g = games.find((x) => x.id === id);
  if (g) { g.lastPlayedAt = Date.now(); writeGames(games); }
}

// If a player has a pre-existing single sandbox game (live keys but no
// registry), adopt it so it isn't orphaned by the new multi-game system.
function ensureLegacyGame() {
  if (currentSandboxId()) return;
  const hasLive = GAME_KEYS.some((k) => localStorage.getItem(k) != null);
  if (!hasLive) return;
  const id = genId();
  const games = readGames();
  if (!games.some((g) => g.id === id)) {
    games.push({ id, createdAt: Date.now(), lastPlayedAt: Date.now() });
    writeGames(games);
  }
  setActive(id);
}

// Persist the active game's live state into its blob + bump lastPlayed.
// Call when leaving / switching so the blob can be restored later.
export function saveActiveSandbox() {
  const id = currentSandboxId();
  if (!id) return;
  writeBlob(id, snapshotLive());
  touch(id);
}

// Start a fresh sandbox game: snapshot the current one, register a new id,
// clear the live keys, make it active. Returns the new id. (The caller
// resets the state modules + mounts; clearLive here means a clean slate.)
export function newSandboxGame() {
  saveActiveSandbox();
  const id = genId();
  const games = readGames();
  games.push({ id, createdAt: Date.now(), lastPlayedAt: Date.now() });
  writeGames(games);
  setActive(id);
  clearLive();
  return id;
}

// Make `id` the live game (snapshot the current active into its blob,
// restore id's blob into the live keys). No-op if already active. Caller
// then reloads so the state modules re-read. Returns true if it switched.
export function activateSandboxGame(id) {
  if (!id) return false;
  const cur = currentSandboxId();
  if (cur === id) { touch(id); return false; }
  if (cur) writeBlob(cur, snapshotLive());
  const blob = readBlob(id) || {};
  restoreLive(blob);
  setActive(id);
  touch(id);
  return true;
}

// Forget a sandbox game (delete its blob + registry row). If it's the
// active game, clear the live keys too. Returns the next game's id to
// fall back to (most-recent remaining), or null.
export function abandonSandboxGame(id) {
  if (!id) return null;
  try { localStorage.removeItem(SAVE_PREFIX + id); } catch { /* private mode */ }
  writeGames(readGames().filter((g) => g.id !== id));
  if (currentSandboxId() === id) {
    clearLive();
    setActive(null);
  }
  const remaining = listSandboxGames();
  return remaining.length ? remaining[0].id : null;
}

// App base path (independent of the address bar, which may already be a
// deep /sandbox/<id>). Mirrors main.js#appBase.
function appBase() {
  return new URL('../../', import.meta.url).pathname;
}
// The /sandbox/<id> URL, preserving the ?v=<sha> version pin.
export function sandboxUrl(id) {
  const base = appBase();
  let v = '';
  try { v = new URL(window.location.href).searchParams.get('v') || ''; } catch { /* ignore */ }
  return base + 'sandbox/' + id + (v ? '?v=' + encodeURIComponent(v) : '');
}
