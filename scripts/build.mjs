// Production build. Bundles + minifies the frontend and writes content-hashed
// filenames into dist/, so a changed file gets a new URL and browsers are
// forced to fetch it - the permanent fix for the stale-module problem that
// ?v= on the entry alone could not solve (deep imports carried no version).
//
// Local dev stays build-free: index.html (source) references the raw
// ./js/main.js, so `python3 -m http.server` serves the raw ES modules as
// before. This build only runs in CI (and whenever you want to inspect the
// output): `node scripts/build.mjs` -> dist/.
//
// Layout that matters: the entries are emitted UNDER dist/js/ (same depth as
// source js/), so base.js's import.meta.url '../' still resolves to the app
// root from inside the bundle. Runtime-fetched assets (rocket PNGs, planner
// JSON, site-flags) are copied to their app-root-relative paths; they are not
// imported, so the bundler never sees them.
import esbuild from 'esbuild';
import { rmSync, mkdirSync, cpSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = path.join(root, 'dist');
const abs = (p) => path.join(root, p);

const SHA = process.env.BUILD_SHA
  || (() => { try { return execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim(); } catch { return 'dev'; } })();

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const shared = {
  bundle: true,
  minify: true,
  sourcemap: true,
  metafile: true,
  target: ['es2020', 'chrome90', 'firefox90', 'safari14'],
  outdir: dist,
  outbase: root,                 // keep js/ + css/ subdirs in the output
  entryNames: '[dir]/[name]-[hash]',
  logLevel: 'warning',
};

// ESM app bundle. Entry lands at dist/js/main-<hash>.js (js/ depth preserved).
const main = await esbuild.build({ ...shared, entryPoints: [abs('js/main.js')], format: 'esm' });
// version-check is a CLASSIC script (uses document.currentScript, not a
// module), so bundle it as an IIFE. Inject the SHA as a define so the output
// hash reflects the build (a new SHA => new content => new filename).
const vcheck = await esbuild.build({
  ...shared, entryPoints: [abs('js/version-check.js')], format: 'iife',
  define: { __BUILD_SHA__: JSON.stringify(SHA) },
});
const css = await esbuild.build({ ...shared, entryPoints: ['css/style.css', 'css/map.css', 'css/cards.css'].map(abs) });

// Hashed output href (relative to dist root) for a given entry source.
function href(res, entryRel) {
  for (const [out, meta] of Object.entries(res.metafile.outputs)) {
    if (meta.entryPoint && abs(meta.entryPoint) === abs(entryRel)) {
      return './' + path.relative(dist, abs(out)).split(path.sep).join('/');
    }
  }
  throw new Error('build: no output for entry ' + entryRel);
}

// Rewrite index.html's entry references to the hashed bundles. Source keeps
// the raw ./js/main.js etc. (dev-friendly); only the dist copy is rewritten.
let html = readFileSync(abs('index.html'), 'utf8');
function swap(re, to) {
  if (!re.test(html)) throw new Error('build: index.html reference not found: ' + re);
  html = html.replace(re, to);
}
swap(/\.\/js\/version-check\.js(?:\?v=[^"']*)?/, href(vcheck, 'js/version-check.js'));
swap(/\.\/js\/main\.js(?:\?v=[^"']*)?/, href(main, 'js/main.js'));
swap(/\.\/css\/style\.css(?:\?v=[^"']*)?/, href(css, 'css/style.css'));
swap(/\.\/css\/map\.css(?:\?v=[^"']*)?/, href(css, 'css/map.css'));
swap(/\.\/css\/cards\.css(?:\?v=[^"']*)?/, href(css, 'css/cards.css'));
writeFileSync(path.join(dist, 'index.html'), html);

// SPA fallback (self-contained inline script, no hashed refs) + version feed.
cpSync(abs('404.html'), path.join(dist, '404.html'));
writeFileSync(path.join(dist, 'version.json'), JSON.stringify({ version: SHA }) + '\n');

// Runtime-fetched assets: copied verbatim to their app-root-relative paths,
// since base.js#assetUrl resolves them from the app root at runtime.
function copyInto(rel) {
  const src = abs(rel);
  if (!existsSync(src)) throw new Error('build: missing runtime asset ' + rel);
  const dest = path.join(dist, rel);
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
}
copyInto('assets');                                          // rocket PNGs (render.js#assetUrl)
copyInto('data/site-flags.json');                            // planner-map.js#assetUrl
copyInto('vendor/hf-mission-planner/assets/data-hf4.json');  // planner-map.js#assetUrl

// Sanity: every reference the page makes must exist in dist.
const mustExist = [
  'index.html', '404.html', 'version.json',
  href(main, 'js/main.js').slice(2), href(vcheck, 'js/version-check.js').slice(2),
  href(css, 'css/style.css').slice(2), href(css, 'css/map.css').slice(2), href(css, 'css/cards.css').slice(2),
  'assets/rockets/rocket-blue.png', 'data/site-flags.json',
  'assets/factory/factory-base-gray.png', 'assets/factory/colony-dome.png',
  'vendor/hf-mission-planner/assets/data-hf4.json',
];
const missing = mustExist.filter((p) => !existsSync(path.join(dist, p)));
if (missing.length) throw new Error('build: expected dist files missing:\n  ' + missing.join('\n  '));

console.log(`build ${SHA}: dist/ ready`);
console.log('  ' + href(main, 'js/main.js'));
console.log('  ' + href(vcheck, 'js/version-check.js'));
console.log('  ' + [href(css, 'css/style.css'), href(css, 'css/map.css'), href(css, 'css/cards.css')].join('\n  '));
