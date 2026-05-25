// Sandbox save / load.
//
// A save is a snapshot of every game-state localStorage key
// (hf-sandbox-* / hf-glory-* / hf-mission-*) EXCEPT the map
// debug / view-preference keys (hf-sandbox-map-*) and the
// saves list itself. Loading restores those keys and reloads
// the page so every state module re-reads from localStorage
// cleanly (the modules cache their state in module-level
// variables on import, so an in-place restore wouldn't take).
//
// Saves persist under one key as a JSON array. The list is
// always returned sorted by timestamp DESC (newest first).
//
// Public surface:
//   defaultSaveName()              -> "Rocket flight MM-DD-YYYY HH:MM"
//   listSaves()                    -> [{ id, name, timestamp }] (desc)
//   createSave(name)               -> save record
//   overwriteSave(id, name?)       -> save record | null
//   renameSave(id, name)           -> boolean
//   deleteSave(id)                 -> boolean
//   loadSave(id)                   -> boolean (triggers reload on success)
//   onSavesChange(cb)              -> unsubscribe

const SAVES_KEY = 'hf-sandbox-saves';

// Prefixes that constitute game state. hf-sandbox-map-* are
// view/debug preferences (zoom, fade, decorations, debug-panel
// open state) - they're the player's display settings, not the
// game, so they stay put across a load.
const SAVE_PREFIXES = ['hf-sandbox-', 'hf-glory-', 'hf-mission-'];
const EXCLUDE_PREFIXES = ['hf-sandbox-map-'];

function isGameStateKey(key) {
  if (!key || key === SAVES_KEY) return false;
  if (EXCLUDE_PREFIXES.some((p) => key.startsWith(p))) return false;
  return SAVE_PREFIXES.some((p) => key.startsWith(p));
}

let _listeners = [];
function notify() {
  for (const cb of _listeners) {
    try { cb(); } catch (err) { console.error('saves listener:', err); }
  }
}

function readSaves() {
  try {
    const raw = localStorage.getItem(SAVES_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr.filter((s) => s && s.id && s.data);
  } catch { return []; }
}

function writeSaves(saves) {
  try { localStorage.setItem(SAVES_KEY, JSON.stringify(saves)); }
  catch (err) { console.error('saves persist failed (quota?):', err); }
  notify();
}

// Two-digit pad helper for the default name's date/time.
function pad(n) { return String(n).padStart(2, '0'); }

export function defaultSaveName(d = new Date()) {
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const yyyy = d.getFullYear();
  const hh = pad(d.getHours());
  const min = pad(d.getMinutes());
  return `Rocket flight ${mm}-${dd}-${yyyy} ${hh}:${min}`;
}

// Snapshot every game-state key into a plain object.
function snapshotGameState() {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!isGameStateKey(key)) continue;
    data[key] = localStorage.getItem(key);
  }
  return data;
}

// Restore a snapshot: clear the current game-state keys (so a
// key absent from the save doesn't linger from the live game),
// then write the save's keys back.
function restoreGameState(data) {
  const toClear = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (isGameStateKey(key)) toClear.push(key);
  }
  for (const k of toClear) localStorage.removeItem(k);
  for (const [k, v] of Object.entries(data || {})) {
    if (v != null) localStorage.setItem(k, v);
  }
}

// Saves sorted newest-first. The stored `data` blob is omitted
// from the public list (callers only need id / name / time);
// loadSave reads the full record internally.
export function listSaves() {
  return readSaves()
    .map((s) => ({ id: s.id, name: s.name, timestamp: s.timestamp || 0 }))
    .sort((a, b) => b.timestamp - a.timestamp);
}

export function createSave(name) {
  const saves = readSaves();
  const now = Date.now();
  const rec = {
    id: 'save_' + now.toString(36) + '_' + Math.random().toString(36).slice(2, 7),
    name: (name && String(name).trim()) || defaultSaveName(),
    timestamp: now,
    data: snapshotGameState(),
  };
  saves.push(rec);
  writeSaves(saves);
  return { id: rec.id, name: rec.name, timestamp: rec.timestamp };
}

export function overwriteSave(id, name) {
  const saves = readSaves();
  const idx = saves.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  const now = Date.now();
  saves[idx] = {
    ...saves[idx],
    name: (name && String(name).trim()) || saves[idx].name,
    timestamp: now,
    data: snapshotGameState(),
  };
  writeSaves(saves);
  return { id: saves[idx].id, name: saves[idx].name, timestamp: now };
}

export function renameSave(id, name) {
  const trimmed = name && String(name).trim();
  if (!trimmed) return false;
  const saves = readSaves();
  const idx = saves.findIndex((s) => s.id === id);
  if (idx === -1) return false;
  saves[idx].name = trimmed;
  writeSaves(saves);
  return true;
}

export function deleteSave(id) {
  const saves = readSaves();
  const next = saves.filter((s) => s.id !== id);
  if (next.length === saves.length) return false;
  writeSaves(next);
  return true;
}

// Restore a save into localStorage. Returns true on success.
// The caller is expected to reload the page afterwards (we do
// NOT reload here so the caller can confirm first / show a
// status message). loadSaveAndReload is the convenience
// wrapper that does both.
export function loadSave(id) {
  const saves = readSaves();
  const rec = saves.find((s) => s.id === id);
  if (!rec) return false;
  restoreGameState(rec.data);
  return true;
}

export function loadSaveAndReload(id) {
  if (!loadSave(id)) return false;
  // Full reload so every state module re-reads localStorage.
  try { location.reload(); } catch { /* non-browser */ }
  return true;
}

export function onSavesChange(cb) {
  _listeners.push(cb);
  return () => { _listeners = _listeners.filter((x) => x !== cb); };
}
