// Boot validation. Catches the class of bug that ships a blank page or the
// boot-failure banner: a syntax error, a duplicate declaration, a missing
// export, or a bad import path anywhere in the browser module graph.
//
// Two passes:
//   1. node --check every source file under js/ data/ server/ (parse errors
//      + duplicate declarations, with a clear per-file message).
//   2. Link the WHOLE browser graph by importing js/main.js with browser
//      globals stubbed, so a cross-module link error (missing export / bad
//      path) fails too - node --check on one file can't see those.
//
// Run it locally after any client edit; CI runs the same before deploy:
//   node scripts/check-boot.mjs
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'vendor') continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

// ----- pass 1: per-file parse check -----
let failed = 0;
for (const d of ['js', 'data', 'server'].map((x) => path.join(root, x))) {
  for (const f of walk(d)) {
    try {
      execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    } catch (e) {
      failed++;
      const out = (e.stderr && e.stderr.toString()) || e.message || '';
      console.error('SYNTAX ERROR: ' + path.relative(root, f));
      console.error(out.split('\n').slice(0, 3).join('\n'));
    }
  }
}
if (failed) {
  console.error(`\n${failed} file(s) failed the parse check.`);
  process.exit(1);
}
console.log('parse check: all source files OK');

// ----- pass 2: link the browser graph -----
// Permissive proxy so top-level module code can evaluate against browser
// globals; we only care that the graph PARSES and LINKS, not that it runs.
const any = new Proxy(function () {}, {
  get: (_t, k) => (k === Symbol.toPrimitive ? () => '' : k === Symbol.iterator ? function* () {} : any),
  apply: () => any,
  construct: () => any,
  has: () => true,
  set: () => true,
});
const GLOBALS = ['document', 'window', 'navigator', 'localStorage', 'sessionStorage',
  'location', 'history', 'WebSocket', 'fetch', 'requestAnimationFrame',
  'cancelAnimationFrame', 'getComputedStyle', 'matchMedia', 'ResizeObserver',
  'MutationObserver', 'IntersectionObserver', 'Image', 'crypto', 'self',
  'screen', 'customElements'];
for (const g of GLOBALS) {
  try { if (globalThis[g] === undefined) globalThis[g] = any; } catch { /* read-only */ }
}

try {
  await import(new URL('../js/main.js', import.meta.url).href);
  console.log('boot graph: parsed + linked OK');
} catch (e) {
  // A SyntaxError (parse / duplicate decl / missing named export) or a
  // missing module is a real link failure that would ship a blank page.
  const fatal = e instanceof SyntaxError || (e && e.code === 'ERR_MODULE_NOT_FOUND');
  const msg = (e && (e.stack || e.message)) || String(e);
  if (fatal) {
    console.error('\nBOOT GRAPH BROKEN (this would ship a blank page):\n' + msg);
    process.exit(1);
  }
  // Anything else is almost certainly a browser API our stub did not absorb
  // during top-level eval - NOT a link error. Warn, do not fail the build.
  console.warn('\nboot graph linked; top-level eval threw (likely a browser API, not a link error):\n' + msg);
}

console.log('\nboot validation passed');
// version-check.js sets a 60s poll timer at import; exit so CI does not hang.
process.exit(0);
