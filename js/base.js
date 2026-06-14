// Single source of the app's base path and of static-asset URLs, resolved
// from THIS module's own location rather than the address bar.
//
// Why this exists: the visible URL can be a deep /room/<CODE> or
// /sandbox/<id> path, so a bare 'assets/...' or a '../' off the address bar
// resolves wrong. This module's import.meta.url always sits in the js/
// directory - as raw js/base.js in local dev, or as the bundled
// js/<entry>-<hash>.js in production (the build deliberately keeps the
// bundle at js/ depth). Either way '../' off it is the app root, so routing
// every base/asset lookup through here makes them behave identically whether
// the app runs as raw ES modules or as one bundled file.
//
// Keep this the ONLY import.meta.url-relative path computation in the app
// (version-check.js keeps its own sibling version.json lookup, also at js/
// depth). If a new call site needs the base or an asset, import from here -
// do NOT recompute '../' / '../../' inline, or bundling will split the depth
// assumptions apart again.

// App root as an absolute path, e.g. "/high-frontier-fan-game/" on Pages or
// "/" in local dev. Always ends in a slash.
export function appBase() {
  return new URL('../', import.meta.url).pathname;
}

// Build stamp for cache-busting runtime assets. Production bundles inject
// __BUILD_SHA__ via esbuild define (scripts/build.mjs); local dev runs the
// raw module where the identifier is undefined, so the typeof guard skips
// the pin. Why: runtime-fetched assets keep their app-root path across
// deploys (only JS/CSS get content-hashed names), so when an asset's
// CONTENT changes - a redrawn sprite - browsers and the Pages CDN keep
// serving the stale copy for their max-age even after version-check reloads
// the app. Pinning ?v= to the build SHA makes every deploy a fresh URL.
const ASSET_VERSION = typeof __BUILD_SHA__ !== 'undefined' ? __BUILD_SHA__ : '';

// Full URL for a static runtime asset addressed from the app root, e.g.
// assetUrl('assets/rockets/foo.png') or assetUrl('data/site-flags.json').
// These are loaded/fetched at runtime (not bundled), so the build copies
// them into the deploy at the same app-root-relative paths.
export function assetUrl(pathFromRoot) {
  const u = new URL('../' + String(pathFromRoot).replace(/^\/+/, ''), import.meta.url);
  if (ASSET_VERSION) u.searchParams.set('v', ASSET_VERSION);
  return u.toString();
}
