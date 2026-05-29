// Auto-refresh on new deploy.
//
// Browsers cache ES module imports + CSS by URL, so once main.js has
// loaded ./game/render.js the only way to pick up changes is to
// navigate to a different URL. We do that by appending a `?v=<sha>`
// query string at deploy time (see .github/workflows/deploy.yml's
// "Inject build version" step, which sed-replaces both the BUILD
// placeholder below and every `?v=...` in index.html with the short
// commit SHA, and writes the same SHA into ./version.json).
//
// At runtime we poll version.json with `cache: 'no-store'`. If the
// deployed SHA no longer matches the one baked into this file, we
// force-navigate to the same URL with the new SHA - that URL change
// makes the browser re-fetch index.html (and therefore re-fetch every
// asset whose `?v=...` now points at the new SHA).
//
// Local dev keeps the literal placeholder so the check is a no-op:
// nothing fetches, nothing reloads.

const BUILD = '__BUILD_SHA__';
const DEV_PLACEHOLDER = '__BUILD' + '_SHA__';
const POLL_MS = 60_000;

// Resolve version.json against THIS SCRIPT's location, not the address
// bar. With room routing the address bar can be a deeper path
// (/high-frontier-fan-game/room/DPAT3R), and a relative './version.json'
// would resolve to /room/version.json (404) - silently disabling the
// version check. The script always lives at <base>/js/version-check.js,
// so '../version.json' off its own src is the real <base>/version.json
// regardless of how deep the visible URL is.
const SCRIPT_SRC = (document.currentScript && document.currentScript.src) || location.href;
const VERSION_URL = new URL('../version.json', SCRIPT_SRC).toString();

async function check() {
  if (BUILD === DEV_PLACEHOLDER) return;
  let r;
  try {
    r = await fetch(VERSION_URL, { cache: 'no-store' });
  } catch {
    return;
  }
  if (!r.ok) return;
  const j = await r.json().catch(() => null);
  if (!j || !j.version || j.version === BUILD) return;
  const u = new URL(location.href);
  u.searchParams.set('v', j.version);
  location.replace(u.toString());
}

check();
setInterval(check, POLL_MS);
