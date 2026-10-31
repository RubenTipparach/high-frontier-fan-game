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

// Halloween theme: a light seasonal skin over the app chrome (a pumpkin on the
// menu button, a tinted top bar, a cobweb in the side panel's corner, a few bats
// drifting across the top). Purely cosmetic: it never touches the map, the
// cards, hazard colours or a seat colour, so nothing a player reads off the
// board changes. Until the player chooses, it is on through October 31 and off
// the rest of the year; the menu toggle is an explicit choice that sticks.
const HALLOWEEN_KEY = 'hf.halloween';
let _halloween = null;   // null = follow the calendar; true / false = the player's choice
try {
  const raw = localStorage.getItem(HALLOWEEN_KEY);
  if (raw === '1') _halloween = true;
  else if (raw === '0') _halloween = false;
} catch { /* localStorage unavailable */ }

function halloweenSeason() {
  try { return new Date().getMonth() === 9; } catch { return false; }   // October
}

export function isHalloweenTheme() {
  return _halloween == null ? halloweenSeason() : _halloween;
}

export function setHalloweenTheme(on) {
  _halloween = !!on;
  try { localStorage.setItem(HALLOWEEN_KEY, on ? '1' : '0'); } catch { /* ignore */ }
  applyHalloweenClass();
}

// Reflect the theme onto <html> (CSS gates every piece of it on
// html.theme-halloween) and make sure the bat layer exists.
export function applyHalloweenClass() {
  try {
    const on = isHalloweenTheme();
    document.documentElement.classList.toggle('theme-halloween', on);
    if (on && !document.querySelector('.hw-bats')) {
      const bats = document.createElement('div');
      bats.className = 'hw-bats';
      bats.setAttribute('aria-hidden', 'true');
      bats.innerHTML = '<span class="hw-bat"></span><span class="hw-bat"></span><span class="hw-bat"></span>';
      document.body.appendChild(bats);
    }
  } catch { /* no document (non-browser) */ }
}
