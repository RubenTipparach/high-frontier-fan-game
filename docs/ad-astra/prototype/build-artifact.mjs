// Build the Ad Astra prototype into ONE page plus the few images the original
// map renderer loads, so it can be played from a private link without
// deploying. Usage (from the repo root):
//   node docs/ad-astra/prototype/build-artifact.mjs
// Output: docs/ad-astra/prototype/dist/ad-astra.html + dist/assets/...
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const dist = join(here, 'dist');
// js/base.js resolves runtime assets against import.meta.url. In one inline
// bundle there is no module URL, so point it at "<page dir>/js/" and ship the
// assets next to the page (assetUrl('assets/x') -> <page dir>/assets/x).
const out = await build({
  entryPoints: [join(here, 'game.js')], bundle: true, minify: !process.env.AA_DEBUG, format: 'iife', write: false, target: 'es2020',
  define: { 'import.meta.url': 'window.__AA_META' }, logLevel: 'error',
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = ['style.css', 'map.css', 'cards.css'].map((f) => readFileSync(join(root, 'css', f), 'utf8')).join('\n')
  + '\n' + readFileSync(join(here, 'proto.css'), 'utf8');
const html = `<title>Ad Astra Prototype</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
${css}
</style>
<div id="aa-app"></div>
<script>window.__AA_META = new URL('js/aa.js', document.baseURI).href;</script>
<script>
${js}
</script>
`;
mkdirSync(dist, { recursive: true });
writeFileSync(join(dist, 'ad-astra.html'), html);
const assets = [];
for (const dir of ['assets/factory', 'assets/map-icons']) {
  mkdirSync(join(dist, dir), { recursive: true });
  for (const f of readdirSync(join(root, dir))) if (/\.(png|svg)$/.test(f) && !f.startsWith('_')) { copyFileSync(join(root, dir, f), join(dist, dir, f)); assets.push(`${dir}/${f}`); }
}
// the real HF Sol board's data (js/game/planner-map.js fetches these)
for (const f of ['vendor/hf-mission-planner/assets/data-hf4.json', 'data/site-flags.json']) {
  mkdirSync(dirname(join(dist, f)), { recursive: true }); copyFileSync(join(root, f), join(dist, f)); assets.push(f);
}
writeFileSync(join(dist, 'assets.json'), JSON.stringify(assets, null, 1));
console.log(`dist/ad-astra.html ${(html.length / 1024).toFixed(0)} KB + ${assets.length} assets`);
