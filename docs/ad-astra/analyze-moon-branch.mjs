// Where do a giant's moons join its well on the HF Sol board? Walks from each
// Galilean / Saturnian moon site toward its giant's flyby (slingshot) node and
// prints the real nodes on the way (curves skipped). Read-only.
// Run from the repo root: node docs/ad-astra/analyze-moon-branch.mjs
import { readFileSync } from 'node:fs';
const raw = JSON.parse(readFileSync('vendor/hf-mission-planner/assets/data-hf4.json', 'utf8'));
const P = raw.points; const ids = Object.keys(P);
const adj = {}; for (const k of ids) adj[k] = [];
for (const e of raw.edges) { const [a, b] = e.split(':'); if (adj[a] && adj[b]) { adj[a].push(b); adj[b].push(a); } }
const fly = ids.filter((k) => P[k].flybyBoost || P[k].flyby);
console.log('flyby nodes:', fly.map((k) => `${k}:${P[k].type}:${P[k].flybyBoost ?? P[k].flyby}`).join(' '));
const label = (k) => `${P[k].type}${P[k].siteName ? `(${P[k].siteName})` : ''}${P[k].flybyBoost ? `[+${P[k].flybyBoost}]` : ''}`;
const path = (from, goal) => { const prev = { [from]: null }; const q = [from]; while (q.length) { const n = q.shift(); if (goal(n)) { const out = []; for (let c = n; c != null; c = prev[c]) out.unshift(c); return out; } for (const m of adj[n]) if (!(m in prev)) { prev[m] = n; q.push(m); } } return null; };
for (const moon of ['Io', 'Europa', 'Ganymede', 'Callisto', 'Titan', 'Enceladus', 'Rhea', 'Luna', 'Phobos']) {
  const s = ids.find((k) => P[k].type === 'site' && new RegExp(`^${moon}`, 'i').test(P[k].siteName || ''));
  if (!s) { console.log(moon, 'not found'); continue; }
  const p = path(s, (n) => P[n].flybyBoost >= 2 || P[n].type === 'hohmann');
  console.log(`${moon}: ${p.filter((k) => P[k].type !== 'decorative').map(label).join(' > ')}`);
}

// Jupiter's ladder: the +4 flyby node out to its nearest Hohmann pivot. Where
// does each moon's route join that ladder, counted in burns from the pivot?
const jup = ids.find((k) => P[k].flybyBoost === 4 || P[k].flybyBoost === '4');
const ladder = path(jup, (n) => P[n].type === 'hohmann');
const burnsFromPivot = (k) => { const i = ladder.indexOf(k); return ladder.slice(i).filter((n) => P[n].type === 'burn').length; };
console.log('\nJupiter ladder (+4 node out to the pivot):', ladder.filter((k) => P[k].type !== 'decorative').map(label).join(' > '));
for (const moon of ['Io', 'Europa', 'Ganymede', 'Callisto', 'Amalthea', 'Himalia']) {
  const s = ids.find((k) => P[k].type === 'site' && new RegExp(`^${moon}`, 'i').test(P[k].siteName || ''));
  if (!s) { console.log(moon, 'not found'); continue; }
  const p = path(s, (n) => ladder.includes(n));
  const j = p[p.length - 1];
  console.log(`${moon}: joins the ladder at ${label(j)}, ${burnsFromPivot(j)} burns in from the pivot; ${ladder.indexOf(j) === 0 ? 'AT the flyby node' : 'below the flyby node'}`);
}
