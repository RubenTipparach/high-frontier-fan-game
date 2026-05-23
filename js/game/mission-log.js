// Mission log - a per-turn chronicle of every action the player
// took (move, undo, fuel, glory awarded, event rolled, etc.) plus
// a per-game history of completed turns. The log is the single
// source of truth for "what happened this turn"; individual
// features (rocket movement, glory, fuel, ...) own their own
// undo state and call back into us to pop log entries when an
// undo runs.
//
// The data model is deliberately dumb: each action is just a
// record with a type + summary + optional data blob. We don't
// store function pointers (can't be persisted), so undo lives in
// the feature module and the log just reflects what happened.
//
// API surface:
//   logAction({type, icon, summary, undoable?, data?}) → record
//   getActions()                                       → record[]
//   getHistory()                                       → turn[]
//   popLast()                                          → record | null
//   popLastOfType(type)                                → record | null
//   commitTurn(meta)                                   - moves
//                       currentTurn → history, resets log
//   resetLog()                                         - full wipe
//   onChange(cb)                                       → unsubscribe

const STORAGE_LOG     = 'hf-mission-log';
const STORAGE_HISTORY = 'hf-mission-history';

let _actions = (() => {
  try {
    const s = localStorage.getItem(STORAGE_LOG);
    return s ? JSON.parse(s) : [];
  } catch { return []; }
})();
let _history = (() => {
  try {
    const s = localStorage.getItem(STORAGE_HISTORY);
    return s ? JSON.parse(s) : [];
  } catch { return []; }
})();
let _listeners = [];
let _nextId = (_actions.reduce((m, a) => Math.max(m, a.id || 0), 0)) + 1;

function persist() {
  try {
    localStorage.setItem(STORAGE_LOG,     JSON.stringify(_actions));
    localStorage.setItem(STORAGE_HISTORY, JSON.stringify(_history));
  } catch { /* private mode */ }
}
function notify() {
  for (const cb of _listeners) {
    try { cb(); } catch (e) { console.error('mission-log listener:', e); }
  }
}

export function logAction({ type, icon = '·', summary, undoable = false, data = null }) {
  const action = {
    id: _nextId++,
    type,
    icon,
    summary: summary || '',
    undoable: !!undoable,
    data,
    ts: Date.now(),
  };
  _actions.push(action);
  persist();
  notify();
  return action;
}

export function getActions() { return _actions.slice(); }
export function getHistory() { return _history.slice(); }
export function getLastAction() {
  return _actions.length ? _actions[_actions.length - 1] : null;
}

// Pop the most recent action whose type matches. Returns the
// popped record (so callers can read its `data`) or null when
// no match exists. Used by per-feature undo to keep the log in
// sync after the feature reverts its own state.
export function popLastOfType(type) {
  for (let i = _actions.length - 1; i >= 0; i--) {
    if (_actions[i].type === type) {
      const [popped] = _actions.splice(i, 1);
      persist();
      notify();
      return popped;
    }
  }
  return null;
}
export function popLast() {
  if (!_actions.length) return null;
  const popped = _actions.pop();
  persist();
  notify();
  return popped;
}

// Move the current turn's actions into the per-game history and
// reset the live log. `meta` carries any per-turn context (turn
// number, round, season, d6 roll) the UI wants to render in the
// replay view. Called from the end-turn handler AFTER all the
// per-turn state has settled.
export function commitTurn(meta = {}) {
  if (_actions.length === 0 && !meta.event) return;
  _history.push({
    turn: meta.turn ?? null,
    round: meta.round ?? null,
    event: meta.event ?? null,
    actions: _actions.slice(),
    ts: Date.now(),
  });
  _actions = [];
  persist();
  notify();
}

export function resetLog() {
  _actions = [];
  _history = [];
  persist();
  notify();
}

export function onChange(cb) {
  _listeners.push(cb);
  return () => { _listeners = _listeners.filter((x) => x !== cb); };
}
