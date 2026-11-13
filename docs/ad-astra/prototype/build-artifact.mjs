// Build the Ad Astra prototype into ONE self-contained HTML page (no imports,
// no fetches) so it can be played from a private link without deploying.
// Usage (from the repo root): node docs/ad-astra/prototype/build-artifact.mjs
// Output: docs/ad-astra/prototype/dist/ad-astra.html
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const out = await build({
  entryPoints: [join(here, 'game.js')], bundle: true, minify: true, format: 'iife', write: false, target: 'es2020',
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const styleCss = readFileSync(join(root, 'css', 'style.css'), 'utf8');
const rootVars = (styleCss.match(/:root\s*\{[\s\S]*?\n\}/) || [''])[0];
const cardsCss = readFileSync(join(root, 'css', 'cards.css'), 'utf8');
const protoCss = readFileSync(join(here, 'proto.css'), 'utf8');
const html = `<title>Ad Astra Prototype</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Inter:wght@400;500;600;700;800&display=swap">
<style>
${rootVars}
${cardsCss}
${protoCss}
</style>
<div id="aa-app"></div>
<script>
${js}
</script>
`;
mkdirSync(join(here, 'dist'), { recursive: true });
writeFileSync(join(here, 'dist', 'ad-astra.html'), html);
console.log(`dist/ad-astra.html ${(html.length / 1024).toFixed(0)} KB`);
