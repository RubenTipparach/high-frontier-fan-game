// Colonist cards (Module 2). Like a base card a colonist carries a WHITE working
// face and flips to a PURPLE PROMOTED face - the half-and-half of a normal card's
// white front and an M1 card's purple back - promoting at a colony dome on its
// Promotion-Colony spectral (a dirt-side site). Built from the spreadsheet's
// Colonists tab through the SAME builder the patent deck uses
// (data/patents.js#buildPatent), so there is exactly one card model.
//
// This module is pure DATA and always loads; nothing SHOWS a colonist unless the
// M2 module is on (the Library catalog + the toolbar tab gate on isM2()), so it
// can sit here without bleeding M2 content into a non-M2 game.
import { CARD_DATA } from './card-data.js';
import { buildPatent } from './patents.js';

function cleanField(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return (!s || s.toLowerCase() === 'n/a') ? null : s;
}

export const COLONISTS = (CARD_DATA['Colonists'] || [])
  .filter((row) => row && row.Name)
  .map((row) => {
    const c = buildPatent('Colonists', row);
    // Carry the colonist-only spreadsheet columns the generic builder skips.
    c.specialty = cleanField(row['Specialty']);          // Engineer / Miner / ...
    c.ideology = cleanField(row['Ideology']);            // faction colour, or null
    c.colonistKind = cleanField(row['Type']);            // 'Human' | 'Robot'
    // Only ROBOTIC colonists carry a spectral type - it gates ET Production at a
    // matching-spectral factory. Humans have none (the sheet writes 'n/a'), so
    // null it out rather than inventing a 'C': no spectral hex renders.
    c.spectralType = cleanField(row['Spectral Type']);
    return c;
  });

export const COLONISTS_BY_ID = Object.fromEntries(COLONISTS.map((c) => [c.id, c]));
