// Bernal cards (Module 2): the space-colony / city tiles. Like a colonist a
// Bernal carries a WHITE working face that flips to a PURPLE promoted face, built
// from the spreadsheet's Bernals tab through the SAME builder the patent deck
// uses (data/patents.js#buildPatent) - one card model. Bernals are big (mass ~10)
// and carry HOME abilities + Futures on their faces.
//
// Pure DATA: this always loads, but nothing SHOWS a Bernal unless M2 is on (the
// Library + toolbar gate on isM2()), so it never bleeds into a non-M2 game.
import { CARD_DATA } from './card-data.js';
import { buildPatent } from './patents.js';

function cleanField(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return (!s || s.toLowerCase() === 'n/a') ? null : s;
}

export const BERNALS = (CARD_DATA['Bernals'] || [])
  .filter((row) => row && row.Name)
  .map((row) => {
    const c = buildPatent('Bernals', row);
    c.ideology = cleanField(row['Ideology']);
    c.bernalKind = cleanField(row['Type']);   // 'Bernal'
    if (!c.spectralType || c.spectralType === 'n/a') c.spectralType = 'C';
    return c;
  });

export const BERNALS_BY_ID = Object.fromEntries(BERNALS.map((c) => [c.id, c]));
