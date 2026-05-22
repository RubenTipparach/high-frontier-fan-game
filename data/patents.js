// Patent deck. Tradable/auctionable component cards installed on
// a rocket stack at build time. The deck is sourced from the
// published HF4 card spreadsheet via scripts/extract-card-data.py
// — re-run that script after editing reference/HF4-card-data.xlsx
// and the entries here regenerate automatically.
//
// Every physical card carries TWO independent technologies:
//   faces.primary    — the Tier-1 tech (the "white" face)
//   faces.secondary  — the Tier-2 tech (the "black" / installed
//                      face). Different name, different stats,
//                      different ability text; same card body.
// Both faces sit on the card object so the renderer can flip
// without re-querying.
//
// Card types come from the spreadsheet tabs. Labs and standalone
// "modifier" cards do not exist in HF4 — lab effects are
// abilities on the parent card (a reactor with a science
// rider, etc.) and modifiers are encoded as the dark-side
// (Tier-2) face of an existing card. Don't reintroduce either.

import { CARD_DATA } from './card-data.js';

// Requirement-kind catalogue. Each kind is a single capability
// the engine tracks across the cards in your stack. Other cards
// "supply" a kind (e.g. a fission Reactor supplies 1
// reactor-fission); a thruster or robonaut carries a `requires`
// row that the stack must collectively satisfy. Card-ui maps
// each kind to a glyph + label.
export const REQUIREMENT_KINDS = [
  // power-source supports (matched against the reactor/generator
  // slotted in the stack):
  'reactor-fission',        // X marker on the published cards
  'reactor-fusion',         // ∿ wave
  'reactor-antimatter',     // 💣 antimatter pulse
  'gen-radioisotope',       // ⟛ RTG / radioisotope generator
  'gen-electric',           // e electric / photovoltaic
  // operational supports:
  'beam-receiver',          // ☀ solar / beam-pushed
  'isru-rig',               // 🛢 in-situ propellant intake
  'aerobrake-shroud',       // 🪂 atmospheric entry (Air Eater)
  // role / hardware supports (legacy hand-written cards used
  // these — kept so old data still loads cleanly):
  'crew-quarters',
  'spin-grav',
  'pulse-generator',
  'thermostat',
  'sail',
];

// Map each Excel sheet name to the card type. Sheets we don't
// fold into the patent deck (Bernals are city tiles; Colonists
// are crew; Freighters are logistics, surfaced separately if
// Stage 3 wants them) sit in the skip set below.
const SHEET_TO_TYPE = {
  'Thrusters':    'thruster',
  'Reactors':     'reactor',
  'Radiators':    'radiator',
  'Refineries':   'refinery',
  'Robonauts':    'robonaut',
  'Generators':   'generator',
  'GW Thrusters': 'thruster',  // gigawatt-class thruster
};
const SHEETS_NOT_PATENTS = new Set(['Bernals', 'Colonists', 'Freighters']);

// Boolean columns on every face-row whose presence translates to
// a single requirement-kind. Multiple keys can map to the same
// kind (the spreadsheet uses several columns for the same idea
// across different sheets).
const BOOLEAN_TO_REQ = {
  'X Reactor':      'reactor-fission',
  '∿ Reactor':      'reactor-fusion',
  '💣 Reactor':     'reactor-antimatter',
  '⟛ Generator':   'gen-radioisotope',
  'e Generator':    'gen-electric',
  'Solar':          'beam-receiver',
  'ISRU':           'isru-rig',
  'Air Eater':      'aerobrake-shroud',
};

// Build a `requires` array from a face's boolean support flags.
function requiresFromFace(face) {
  const reqs = [];
  if (!face) return reqs;
  for (const [col, kind] of Object.entries(BOOLEAN_TO_REQ)) {
    if (face[col]) reqs.push({ kind, count: 1 });
  }
  return reqs;
}

// Stable slug for the card id. Tier-1 + Tier-2 share an id; both
// sides of the same physical card are one entity in the deck.
function slug(name, type) {
  const base = String(name).toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${type.slice(0, 3)}_${base}`;
}

// Translate one Excel row (card) into a PATENT object.
function buildPatent(sheet, row) {
  const type = SHEET_TO_TYPE[sheet];
  const t1   = row.tier1 || {};
  const t2   = row.tier2 || null;
  const name = row.Name;
  const id   = slug(name, type);
  const spectral = row['Spectral Type']
    || (type === 'radiator' ? null : 'C');

  const primaryFace = {
    label: 'Tier 1',
    mass:        t1.Mass,
    radHardness: t1['Rad-Hard'],
    thrust:      t1.Thrust,
    fuel:        t1['Fuel Consumption'],
    fuelType:    t1['Fuel Type'],
    afterburn:   !!t1.Afterburn,
    bonusPivots: t1['Bonus Pivots'] || 0,
    therms:      t1.Therms,
    ability:     t1.Ability || null,
    requires:    requiresFromFace(t1),
  };

  const secondaryFace = t2 ? {
    label: 'Tier 2',
    mass:        t2.Mass,
    radHardness: t2['Rad-Hard'],
    thrust:      t2.Thrust,
    fuel:        t2['Fuel Consumption'],
    fuelType:    t2['Fuel Type'],
    afterburn:   !!t2.Afterburn,
    bonusPivots: t2['Bonus Pivots'] || 0,
    therms:      t2.Therms,
    ability:     t2.Ability || null,
    requires:    requiresFromFace(t2),
  } : null;

  // Top-level convenience fields mirror the primary face so
  // existing renderer / ship-engine code that reads card.thrust /
  // card.mass directly keeps working.
  return {
    id,
    name,
    type,
    spectralType: spectral || 'C',
    mass:        primaryFace.mass ?? 1,
    radHardness: primaryFace.radHardness ?? 5,
    thrust:      primaryFace.thrust,
    fuel:        primaryFace.fuel,
    afterburn:   primaryFace.afterburn,
    requires:    primaryFace.requires,
    blurb:       primaryFace.ability || '',
    flipOrientation: type === 'radiator' ? 'rotated180' : 'standard',
    faces: { primary: primaryFace, secondary: secondaryFace },
  };
}

// Build the deck from the spreadsheet bundle.
const _deck = [];
for (const [sheet, rows] of Object.entries(CARD_DATA)) {
  if (SHEETS_NOT_PATENTS.has(sheet)) continue;
  if (!SHEET_TO_TYPE[sheet]) continue;
  for (const row of rows) {
    if (!row.Name) continue;
    _deck.push(buildPatent(sheet, row));
  }
}

export const PATENTS = _deck;

export const PATENTS_BY_ID = Object.fromEntries(
  PATENTS.map((p) => [p.id, p]),
);

export function patentsByType(type) {
  return PATENTS.filter((p) => p.type === type);
}

// Public catalogue of card types. Labs and standalone modifiers
// are not real HF4 cards — see the header note. Don't add them.
export const PATENT_TYPES = [
  'thruster', 'reactor', 'radiator', 'refinery',
  'robonaut', 'generator',
];
