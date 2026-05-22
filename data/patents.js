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

// Columns under the spreadsheet's "Support Requirements" banner —
// the ONLY columns that translate into stack-level support
// chips. Everything else (Push, Solar, ISRU, Air Eater,
// Afterburn, Bonus Pivots, Missile / Raygun / Buggy) describes
// what the card IS / DOES, not what it needs from other cards
// in the stack. Those surface as card-properties further down.
const BOOLEAN_TO_REQ = {
  'X Reactor':      'reactor-fission',
  '∿ Reactor':      'reactor-fusion',
  '💣 Reactor':     'reactor-antimatter',
  '⟛ Generator':   'gen-radioisotope',
  'e Generator':    'gen-electric',
  'Any Reactor':    'reactor-any',
};

// Columns that describe a per-card capability/property. Boolean
// keys gate the property's presence; numeric keys carry a count.
// These are surfaced as icon badges on the face, not as chips
// in the supports box.
const PROPERTY_COLUMNS_BOOL = {
  'Push':           { key: 'push',           glyph: '🛰', label: 'Push-sat' },
  'Solar':          { key: 'solar',          glyph: '☀',  label: 'Solar' },
  'Air Eater':      { key: 'airEater',       glyph: '⛅', label: 'Air-eater' },
  'Missile':        { key: 'missile',        glyph: '🚀', label: 'Missile' },
  'Raygun':         { key: 'raygun',         glyph: '🔫', label: 'Raygun' },
  'Buggy':          { key: 'buggy',          glyph: '🛺', label: 'Buggy' },
};
const PROPERTY_COLUMNS_NUM = {
  'Afterburn':      { key: 'afterburn',      glyph: '🔥', label: 'Afterburn' },
  'Bonus Pivots':   { key: 'bonusPivots',    glyph: '↺',  label: 'Bonus pivots' },
  'ISRU':           { key: 'isru',           glyph: '🛢', label: 'ISRU rig' },
};

// Build a `requires` array from the face's "Support
// Requirements" booleans. Just the power-source columns — see
// the BOOLEAN_TO_REQ comment for why this list is tight.
function requiresFromFace(face) {
  const reqs = [];
  if (!face) return reqs;
  for (const [col, kind] of Object.entries(BOOLEAN_TO_REQ)) {
    if (face[col]) reqs.push({ kind, count: 1 });
  }
  return reqs;
}

// Columns under the "Type" banner of Reactor / Generator sheets
// that say what THIS card supplies to the stack. A generator
// with ⟛=true supplies a radioisotope-generator chip, a fission
// reactor (X=true) supplies the reactor-fission chip, etc.
// Used to drive the per-card glyphs shown on the typebar.
const REACTOR_TYPE_COLS = {
  'X':  'reactor-fission',
  '∿':  'reactor-fusion',
  '💣': 'reactor-antimatter',
};
const GENERATOR_TYPE_COLS = {
  '⟛': 'gen-radioisotope',
  'e':  'gen-electric',
};

// Return the array of requirement-kinds this card SUPPLIES to
// the stack — i.e. which support chips a thruster/robonaut/etc
// is allowed to satisfy by including this card. Radiators
// always supply the thermostat chip; reactors and generators
// supply whichever Type-column boxes are ticked; other card
// types supply nothing (they don't show up as chips on other
// cards' supports rows).
function suppliesFromFace(face, type) {
  if (!face) return [];
  if (type === 'reactor') {
    return Object.entries(REACTOR_TYPE_COLS)
      .filter(([col]) => face[col])
      .map(([, kind]) => kind);
  }
  if (type === 'generator') {
    return Object.entries(GENERATOR_TYPE_COLS)
      .filter(([col]) => face[col])
      .map(([, kind]) => kind);
  }
  if (type === 'radiator') return ['thermostat'];
  return [];
}

// Build a `properties` array of { key, glyph, label, value }
// entries from the face's per-card capability columns. Boolean
// columns drop value=true; numeric columns drop the raw number.
function propertiesFromFace(face) {
  const out = [];
  if (!face) return out;
  for (const [col, def] of Object.entries(PROPERTY_COLUMNS_BOOL)) {
    if (face[col]) out.push({ ...def, value: true });
  }
  for (const [col, def] of Object.entries(PROPERTY_COLUMNS_NUM)) {
    if (face[col]) out.push({ ...def, value: face[col] });
  }
  return out;
}

// Stable slug for the card id. Tier-1 + Tier-2 share an id; both
// sides of the same physical card are one entity in the deck.
function slug(name, type) {
  const base = String(name).toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${type.slice(0, 3)}_${base}`;
}

// Build a face stat-block from one tier of the import. For
// radiators the same tier carries TWO stat sets (Light Side and
// Heavy Side) under qualified column names; we surface those
// as face.light / face.heavy. For every other card type the
// fields sit directly on the face.
function buildFace(label, tier, type) {
  if (!tier) return null;
  const isRadiator = type === 'radiator';
  const base = {
    label,
    ability:    tier.Ability || null,
    requires:   requiresFromFace(tier),
    supplies:   suppliesFromFace(tier, type),
    properties: propertiesFromFace(tier),
  };
  if (isRadiator) {
    base.light = {
      mass:        tier['Light Side: Mass'],
      radHardness: tier['Light Side: Rad-Hard'],
      therms:      tier['Light Side: Therms'],
    };
    base.heavy = {
      mass:        tier['Heavy Side: Mass'],
      radHardness: tier['Heavy Side: Rad-Hard'],
      therms:      tier['Heavy Side: Therms'],
    };
    // Mirror the Light Side at the face level so the generic
    // renderer paths still see mass / rad-hard when they ask.
    base.mass        = base.light.mass;
    base.radHardness = base.light.radHardness;
    base.therms      = base.light.therms;
  } else {
    base.mass        = tier.Mass;
    base.radHardness = tier['Rad-Hard'];
    base.thrust      = tier.Thrust;
    base.fuel        = tier['Fuel Consumption'];
    base.fuelType    = tier['Fuel Type'];
    base.afterburn   = !!tier.Afterburn;
    base.bonusPivots = tier['Bonus Pivots'] || 0;
    base.therms      = tier.Therms;
    // Reactors / generators that PAIR with a thruster have a
    // thrust modifier + fuel modifier (e.g. Cermet NERVA's +3
    // thrust mod). Surface those so the renderer can paint a
    // small "wrench" modifier triangle next to the typebar.
    base.thrustMod   = tier['Thrust Modifier'];
    base.fuelMod     = tier['Fuel Consumption Modifier'];
  }
  return base;
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
  const isRadiator = type === 'radiator';

  const primaryFace   = buildFace('Tier 1', t1, type);
  const secondaryFace = buildFace('Tier 2', t2, type);

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
    supplies:    primaryFace.supplies,
    properties:  primaryFace.properties,
    blurb:       primaryFace.ability || '',
    flipOrientation: isRadiator ? 'rotated180' : 'standard',
    rotatable:   isRadiator,
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
