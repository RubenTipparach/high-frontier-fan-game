// Print the rulebook's star catalogue table (AA-Y) from the game data: every
// system within 20 ly, its distance, spaces from Sol along the star map (AA-B6),
// type, companions, links. Run: node docs/ad-astra/stars/catalogue-table.mjs
import { STARS } from '../prototype/data.js';
import { buildStarMap } from '../prototype/starmap.js';
const M = buildStarMap([{ id: 'sol', name: 'Sol', x: 0, y: 0, z: 0 }, ...STARS]);
const T = { yellow: 'Sun-like', red: 'Red dwarf', white: 'White dwarf', brown: 'Brown dwarf' };
const rows = ['| Star | ly | Spaces from Sol | Type | Companions | Links | Notes |', '|---|---|---|---|---|---|---|'];
for (const s of STARS) {
  const comps = [...s.comp.map((c) => ({ gas: 'gas giant' }[c] || c)), ...(s.stars || []).map((c) => `${c.role === 'binary' ? 'binary' : 'distant'} ${T[c.type].toLowerCase()}`)].join(', ') || '-';
  const notes = [s.hazard === 'flare' ? 'flare star' : s.hazard === 'debris' ? 'debris disk' : '', s.known ? `known planet ${s.known}` : '', ...(s.stars || []).filter((c) => c.known).map((c) => `known planet ${c.known}`)].filter(Boolean).join('; ') || '-';
  const links = M.links.filter((l) => l.from === s.id || l.to === s.id).length;
  rows.push(`| ${s.name} | ${s.ly.toFixed(1)} | ${M.dist[s.id]} | ${T[s.type]} | ${comps} | ${links}${links === 1 ? ' (dead end)' : ''} | ${notes} |`);
}
console.log(rows.join('\n'));
