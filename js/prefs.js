// Display preferences.
//
// Battery saver: a player-toggleable "calm/static" mode. It stops the map's
// ambient redraw loop (js/game/render.js) and disables motion app-wide - CSS
// animations/transitions (via the html.battery-save class below) and the dice
// tumble. The map stays fully interactive (pan / zoom / hover and state
// changes still repaint on demand), it just no longer animates on its own,
// which is the main battery cost on mobile.
//
// EXCEPTION: rocket MOVEMENT stays animated even in battery saver - a smoothly
// sliding ship is load-bearing for reading the board, so animateRocketAlong
// (js/game/browse.js) is NOT gated here. It self-schedules its own frames, so
// it animates fine with the ambient loop off.
//
// State: persisted in localStorage. Until the player makes an explicit choice
// it follows the OS "reduce motion" accessibility setting.

const LS_KEY = 'hf.batterySave';
const listeners = new Set();

function osReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
}

// null = follow the OS setting; true / false = an explicit player choice.
let _override = null;
try {
  const raw = localStorage.getItem(LS_KEY);
  if (raw === '1') _override = true;
  else if (raw === '0') _override = false;
} catch { /* localStorage unavailable */ }

export function isBatterySave() {
  return _override == null ? osReducedMotion() : _override;
}

export function setBatterySave(on) {
  _override = !!on;
  try { localStorage.setItem(LS_KEY, on ? '1' : '0'); } catch { /* ignore */ }
  applyBatterySaveClass();
  for (const fn of listeners) { try { fn(isBatterySave()); } catch (e) { /* ignore */ } }
}

export function onBatterySaveChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Reflect the current state onto <html> so CSS can gate every
// animation / transition. Call once on boot, and setBatterySave keeps it live.
export function applyBatterySaveClass() {
  try { document.documentElement.classList.toggle('battery-save', isBatterySave()); }
  catch { /* no document (non-browser) */ }
}
