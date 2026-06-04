// Optional on-device debug console (Eruda), toggled from Config. Eruda is a
// dev console for mobile browsers, where there are no devtools: it surfaces
// console logs (incl. the [api] failed-call logs), DOM, storage, etc. We do
// NOT bundle it - the script is injected from a CDN at runtime only when the
// player turns it on, so it costs nothing otherwise. The preference persists
// so it survives reloads (handy while chasing a bug across deploys).
//
// Buildless-safe: plain ES module, no imports; the CDN URL is a runtime
// string the bundler never sees.

const ERUDA_KEY = 'hf-eruda-enabled';
const ERUDA_SRC = 'https://cdn.jsdelivr.net/npm/eruda@3';

export function erudaEnabled() {
  try { return localStorage.getItem(ERUDA_KEY) === '1'; } catch { return false; }
}

let _loading = null;
function loadEruda() {
  if (typeof window !== 'undefined' && window.eruda) return Promise.resolve(window.eruda);
  if (_loading) return _loading;
  _loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = ERUDA_SRC;
    s.async = true;
    s.onload = () => (window.eruda ? resolve(window.eruda) : reject(new Error('eruda missing')));
    s.onerror = () => { _loading = null; reject(new Error('eruda load failed')); };
    (document.head || document.documentElement).appendChild(s);
  });
  return _loading;
}

// Turn the console on/off and persist the choice. Resolves true once Eruda
// is up; rejects if the CDN couldn't load (caller surfaces that).
export async function setEruda(on) {
  try { localStorage.setItem(ERUDA_KEY, on ? '1' : '0'); } catch { /* private mode */ }
  if (on) {
    const eruda = await loadEruda();
    try { eruda.init(); } catch { /* already inited */ }
    return true;
  }
  if (typeof window !== 'undefined' && window.eruda) {
    try { window.eruda.destroy(); } catch { /* not inited */ }
  }
  return false;
}

// Boot hook: bring the console back up if it was left enabled. Silent on
// failure (a blocked CDN shouldn't break the app).
export function initErudaFromPref() {
  if (!erudaEnabled()) return;
  loadEruda()
    .then((eruda) => { try { eruda.init(); } catch { /* already inited */ } })
    .catch(() => { /* CDN blocked; the toggle will report it next time */ });
}
