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
    // Bernals cannot be ET-produced, so they carry NO spectral type / hex.
    c.spectralType = null;
    return c;
  });

export const BERNALS_BY_ID = Object.fromEntries(BERNALS.map((c) => [c.id, c]));

// L5 Solar Cell Factory Bernal: its card ability grants a NET-THRUST bonus to
// the player's Solar-Powered spacecraft while anchored - "+1 to the Net Thrust
// of your Spacecraft that use Solar-Power" on the white face, "+2" on the
// promoted (purple) face.
export const SOLAR_CELL_BERNAL_ID = 'ber_l5_solar_cell_factory';

// The net-thrust bonus a player's anchored Solar Cell Bernal grants to EVERY one
// of their solar-driven spacecraft: +1 anchored, +2 promoted. 0 if the player
// has none anchored. Shared by the client (rocket.js) and the server (engine.js)
// so the byte-parity thrust calc agrees. A player holds at most one Solar Cell
// Bernal, so this is just that card's bonus (Math.max guards against dupes).
export function solarCellThrustBonus(bernals) {
  let bonus = 0;
  for (const bn of (bernals || [])) {
    if (!bn || !bn.anchored || bn.cardId !== SOLAR_CELL_BERNAL_ID) continue;
    const promoted = !!(bn.promoted || bn.face === 'secondary');
    bonus = Math.max(bonus, promoted ? 2 : 1);
  }
  return bonus;
}

// The faction privilege an anchored Bernal grants, parsed off its ACTIVE face
// ability ("Gain the <Privilege> faction privilege"). Two Bernals grant one: the
// L2 Collimator Bernal grants Powersat, the L4s Pharmaceutics Bernal grants
// Skunkworks. Reads the active face (white primary, or purple secondary when
// promoted). Returns { privilege, homeOnly }: `privilege` is the uppercased key
// (POWERSAT / SKUNKWORKS / ...) or null when the face grants none; `homeOnly` is
// true for a "HOME:" ability (the white face), so the caller only grants it while
// the Bernal is the Home Bernal - the purple face grants it anchored anywhere.
// Shared by the client (browse.js) + server (engine.js) so the privilege check
// agrees on both sides.
export function bernalPrivilegeGrant(bn) {
  const none = { privilege: null, homeOnly: false };
  if (!bn || !bn.anchored) return none;
  const card = BERNALS_BY_ID[bn.cardId];
  if (!card) return none;
  const promoted = !!(bn.promoted || bn.face === 'secondary');
  const faceKey = promoted ? 'secondary' : 'primary';
  const ability = (card.faces && card.faces[faceKey] && card.faces[faceKey].ability)
    || (card.faces && card.faces.primary && card.faces.primary.ability)
    || card.ability || '';
  const m = /gain the ([a-z]+) faction privilege/i.exec(ability);
  if (!m) return none;
  return { privilege: m[1].toUpperCase(), homeOnly: /^\s*home\s*:/i.test(ability) };
}

// Back-compat: does the anchored Bernal grant the POWERSAT privilege specifically
// (so a factory-assist liftoff never rolls its hazard)? A thin wrapper over
// bernalPrivilegeGrant kept for readers that only care about Powersat.
export function bernalPowersatGrant(bn) {
  const g = bernalPrivilegeGrant(bn);
  return { grants: g.privilege === 'POWERSAT', homeOnly: g.homeOnly };
}
