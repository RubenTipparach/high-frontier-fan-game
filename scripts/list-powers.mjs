// Generate docs/card-powers.md: a catalogue of every text-based ability
// written on a card or crew/faction face that overrides or modifies the
// normal game rules. Reads the single sources of truth
// (data/card-data.json + data/crew.js) and emits Markdown.
//
// Run: node scripts/list-powers.mjs
// Re-run after any card-data change; do not hand-edit the output.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CREW } from '../data/crew.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(ROOT, 'data/card-data.json'), 'utf8'));

const lines = [];
const w = (s = '') => lines.push(s);
// Markdown table-cell escape: pipes break columns, newlines break rows.
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

w('# Card & Crew Powers');
w('');
w('Every text-based ability written on a card or crew/faction face that');
w('overrides or modifies the normal game rules. Generated from the source');
w('data (`data/card-data.json` + `data/crew.js`) by');
w('`scripts/list-powers.mjs` - do not hand-edit; re-run the generator after');
w('a card-data change.');
w('');
w('Scope note: "Negotiable" tags are listed verbatim where they appear but');
w('are not yet wired to a trade prompt. Endgame **Future** goal cards are');
w('listed in their own section at the end (they are card text but are');
w('objective+reward cards, not always-on rule overrides).');
w('');

// ---- Crew / faction privileges ----
w('## Crew faction privileges');
w('');
w('Source: `data/crew.js`. Each physical crew card is double-sided; both');
w('faces are independent factions with their own privilege.');
w('');
w('| Faction | Role | Privilege | Effect |');
w('| --- | --- | --- | --- |');
for (const card of CREW) {
  for (const key of ['primary', 'secondary']) {
    const f = card.faces[key];
    if (!f) continue;
    w(`| ${esc(f.name)} | ${esc(f.role)} | ${esc(f.bonus)} | ${esc(f.blurb)} |`);
  }
}
w('');

// ---- Card abilities, by sheet ----
w('## Card abilities');
w('');
w('Source: `data/card-data.json`, the `Ability` field. Cards are');
w('double-sided (Tier 1 / Tier 2 = the "dark side"). Where both tiers carry');
w('the same ability text it is listed once as "both"; where they differ each');
w('is listed with its tier and face name.');
w('');

let abilityCount = 0;
for (const [sheet, rows] of Object.entries(data)) {
  if (!Array.isArray(rows)) continue;
  const entries = [];
  for (const r of rows) {
    const t1 = r.tier1 || {};
    const t2 = r.tier2 || {};
    const a1 = t1.Ability;
    const a2 = t2.Ability;
    if (!a1 && !a2) continue;
    const n1 = t1.Name || r.Name;
    const n2 = t2.Name || r.Name;
    if (a1 && a2 && a1 === a2) {
      entries.push([`${n1}${n2 && n2 !== n1 ? ' / ' + n2 : ''} (both)`, a1]);
    } else {
      if (a1) entries.push([`${n1} (Tier 1)`, a1]);
      if (a2) entries.push([`${n2} (Tier 2)`, a2]);
    }
  }
  if (!entries.length) continue;
  w(`### ${sheet}`);
  w('');
  w('| Card | Ability |');
  w('| --- | --- |');
  for (const [name, text] of entries) { w(`| ${esc(name)} | ${esc(text)} |`); abilityCount++; }
  w('');
}

// ---- Future goal cards ----
w('## Future goal cards');
w('');
w('Source: `data/card-data.json`, the `Future` field (Tier 2 only). These are');
w('endgame objective+reward cards rather than always-on rule overrides, but');
w('the text is printed on the card so it is catalogued here for completeness.');
w('');
let futureCount = 0;
for (const [sheet, rows] of Object.entries(data)) {
  if (!Array.isArray(rows)) continue;
  const entries = [];
  for (const r of rows) {
    const t2 = r.tier2 || {};
    if (t2.Future) entries.push([t2.Name || r.Name, t2.Future]);
  }
  if (!entries.length) continue;
  w(`### ${sheet}`);
  w('');
  w('| Card | Future |');
  w('| --- | --- |');
  for (const [name, text] of entries) { w(`| ${esc(name)} | ${esc(text)} |`); futureCount++; }
  w('');
}

const crewCount = CREW.reduce(
  (n, c) => n + (c.faces.primary ? 1 : 0) + (c.faces.secondary ? 1 : 0), 0,
);
w('---');
w('');
w(`Totals: ${crewCount} crew faction privileges, ${abilityCount} card abilities, ${futureCount} future goal cards.`);
w('');

writeFileSync(join(ROOT, 'docs/card-powers.md'), lines.join('\n'));
console.log(`wrote docs/card-powers.md (${crewCount} crew, ${abilityCount} abilities, ${futureCount} futures)`);
