// UI scale: keep the interface readable on very wide viewports. A 4K monitor
// at 100% OS scaling reports a 3840px-wide viewport, which renders every
// panel, popup, and card at half the physical size they have at 1080p. The
// fix is a zoom factor on the document root sized so the layout matches a
// 1920-wide view ("auto"), or whatever the player picks in Settings.
//
// Zoom semantics (verified against Chromium's standardized CSS zoom):
// getBoundingClientRect() and mouse clientX/Y stay in VISUAL (zoomed)
// coordinates, while CSS pixel values written to elements inside the zoomed
// tree paint scale-times bigger. So code that measures with gBCR and writes
// the result back as style.left/top must divide by uiScale() first -
// toLayoutPx() below. The map canvas keeps its own visual-space math and
// stays crisp because its backing store is sized from gBCR (visual) pixels.

const STORAGE_KEY = 'hf-ui-scale';   // 'auto' (default) or a number like 1.5
const AUTO_BASE_WIDTH = 1920;        // auto matches this layout width
const AUTO_MIN_WIDTH = 2400;         // narrower viewports stay at 1:1
const MAX_SCALE = 2.5;

let _scale = 1;
let _resizeTimer = null;

export function uiScalePref() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (!v || v === 'auto') return 'auto';
    const n = Number(v);
    return Number.isFinite(n) && n >= 0.5 && n <= MAX_SCALE ? n : 'auto';
  } catch { return 'auto'; }
}

export function setUiScalePref(v) {
  try {
    if (v === 'auto' || v == null) localStorage.setItem(STORAGE_KEY, 'auto');
    else localStorage.setItem(STORAGE_KEY, String(v));
  } catch {}
  applyUiScale();
}

// The zoom factor currently applied to the document root.
export function uiScale() { return _scale; }

// Convert a visual-space pixel measure (gBCR / clientX math) into the CSS
// pixel value that paints at that visual position inside the zoomed tree.
export function toLayoutPx(n) { return n / _scale; }

function computeAuto() {
  const w = window.innerWidth || 0;
  if (w < AUTO_MIN_WIDTH) return 1;
  return Math.min(MAX_SCALE, w / AUTO_BASE_WIDTH);
}

export function applyUiScale() {
  const pref = uiScalePref();
  const next = pref === 'auto' ? computeAuto() : pref;
  _scale = Math.round(next * 100) / 100;
  const root = document.documentElement;
  if (_scale === 1) {
    root.style.removeProperty('zoom');
    // Native viewport units are correct again - drop the compensated vars so
    // the stylesheet falls back to its 1vh / 1dvh / 1vw paths (byte-identical
    // to the pre-scale behavior, incl. the iOS dynamic-viewport handling).
    root.style.removeProperty('--vhpx');
    root.style.removeProperty('--dvhpx');
    root.style.removeProperty('--vwpx');
    return;
  }
  root.style.zoom = String(_scale);
  // Viewport units resolve against the REAL viewport and are NOT divided by
  // zoom, so 100vh inside the zoomed tree paints scale-times the screen
  // height. The stylesheets therefore use calc(var(--vhpx, 1vh) * N) - when
  // scaled we publish 1% of the LAYOUT viewport per var.
  const vv = window.visualViewport;
  root.style.setProperty('--vhpx', `${window.innerHeight / _scale / 100}px`);
  root.style.setProperty('--dvhpx', `${((vv && vv.height) || window.innerHeight) / _scale / 100}px`);
  root.style.setProperty('--vwpx', `${window.innerWidth / _scale / 100}px`);
}

export function initUiScale() {
  applyUiScale();
  const requeue = () => {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(applyUiScale, 200);
  };
  // Re-apply on resize both to recompute the auto factor and to keep the
  // compensated viewport-unit vars tracking the window while scaled.
  window.addEventListener('resize', requeue);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', requeue);
}
