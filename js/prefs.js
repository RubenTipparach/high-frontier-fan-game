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

// Halloween is retired outside October: a player who switched it on keeps no
// bats in November (user 2026-11-13, "we are out of Halloween"). In October
// the calendar default and the player's choice apply as before.
export function isHalloweenTheme() {
  if (!halloweenSeason()) return false;
  return _halloween == null ? true : _halloween;
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

// Holiday theme: winter cheer over the app chrome (a Santa hat on the menu
// button, a string of twinkling lights along the top bar, light snowfall, a
// holly sprig in the side panel's corner, snow caps on panels and a sleigh
// that crosses the top now and then). Like Halloween it is chrome only: it
// never touches the map, the cards, hazard colours or a seat colour. Until the
// player chooses it is on from November 1 to January 6; the menu toggle is an
// explicit choice that sticks.
const HOLIDAY_KEY = 'hf.holiday';
let _holiday = null;   // null = follow the calendar; true / false = the player's choice
try {
  const raw = localStorage.getItem(HOLIDAY_KEY);
  if (raw === '1') _holiday = true;
  else if (raw === '0') _holiday = false;
} catch { /* localStorage unavailable */ }

function holidaySeason() {
  try {
    const d = new Date();
    const m = d.getMonth();
    return m === 10 || m === 11 || (m === 0 && d.getDate() <= 6);   // Nov 1 - Jan 6
  } catch { return false; }
}

export function isHolidayTheme() {
  return _holiday == null ? holidaySeason() : _holiday;
}

export function setHolidayTheme(on) {
  _holiday = !!on;
  try { localStorage.setItem(HOLIDAY_KEY, on ? '1' : '0'); } catch { /* ignore */ }
  applyHolidayClass();
}

// Reflect the theme onto <html> (CSS gates every piece on html.theme-holiday)
// and make sure the snow + sleigh layer exists.
export function applyHolidayClass() {
  try {
    const on = isHolidayTheme();
    document.documentElement.classList.toggle('theme-holiday', on);
    if (on && !document.querySelector('.xm-sleigh-layer')) {
      // The sleigh flies behind the top bar's buttons, so it gets its own
      // low layer.
      const sleighLayer = document.createElement('div');
      sleighLayer.className = 'xm-sky xm-sleigh-layer';
      sleighLayer.setAttribute('aria-hidden', 'true');
      sleighLayer.innerHTML = '<span class="xm-sleigh"></span>';
      document.body.appendChild(sleighLayer);
    }
    // Snow falls only inside the hand panel (user 2026-11-13), as real
    // flakes moved on the GPU so it stays smooth. The hand panel mounts later
    // and can be rebuilt, so a light check keeps one snow layer in it.
    if (on && !_handSnowTimer) {
      ensureHandSnow();
      _handSnowTimer = setInterval(ensureHandSnow, 1000);
    }
  } catch { /* no document (non-browser) */ }
}

let _handSnowTimer = null;
function ensureHandSnow() {
  try {
    const hand = document.querySelector('.sandbox-hand');
    if (!hand || hand.querySelector(':scope > .xm-hand-snow')) return;
    const snow = document.createElement('div');
    snow.className = 'xm-hand-snow';
    snow.setAttribute('aria-hidden', 'true');
    let flakes = '';
    for (let i = 0; i < 14; i++) flakes += '<span class="xm-flake"></span>';
    snow.innerHTML = flakes;
    hand.appendChild(snow);
  } catch { /* ignore */ }
}
