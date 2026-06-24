// Patent deck. Tradable/auctionable component cards installed on
// a rocket stack at build time. The deck is sourced from the
// published HF4 card spreadsheet via scripts/extract-card-data.py
// - re-run that script after editing reference/HF4-card-data.xlsx
// and the entries here regenerate automatically.
//
// Every physical card carries TWO independent technologies:
//   faces.primary    - the Tier-1 tech (the "white" face)
//   faces.secondary  - the Tier-2 tech (the "black" / installed
//                      face). Different name, different stats,
//                      different ability text; same card body.
// Both faces sit on the card object so the renderer can flip
// without re-querying.
//
// Card types come from the spreadsheet tabs. Labs and standalone
// "modifier" cards do not exist in HF4 - lab effects are
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
  // these - kept so old data still loads cleanly):
  'crew-quarters',
  'spin-grav',
  'pulse-generator',
  'thermostat',
  'sail',
];

// Map each Excel sheet name to the card type. Sheets we don't
// fold into the patent deck (Bernals are city tiles; Colonists
// are crew) sit in the skip set below.
const SHEET_TO_TYPE = {
  'Thrusters':    'thruster',
  'Reactors':     'reactor',
  'Radiators':    'radiator',
  'Refineries':   'refinery',
  'Robonauts':    'robonaut',
  'Generators':   'generator',
  // GW Thrusters (and the future TW class) and Freighters are an
  // upcoming expansion. They land in their own type so the UI can
  // group and gate them; right now the rest of the engine refuses
  // to hand them out or stack them (see EXPANSION_TYPES below).
  'GW Thrusters': 'gw-thruster',
  'Freighters':   'freighter',
};
const SHEETS_NOT_PATENTS = new Set(['Bernals', 'Colonists']);

// Columns under the spreadsheet's "Support Requirements" banner -
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
  'Push':           { key: 'push',           glyph: '🛰', label: 'Push-sat',
    desc: 'Push-sat: adds +1 to thrust for any card that carries this icon, and helps avoid needing factory assist to land or take off.' },
  'Solar':          { key: 'solar',          glyph: '☀',  label: 'Solar',
    desc: 'Solar-powered: output scales with how close you are to the Sun and falls off in the outer system / in shadow.' },
  'Air Eater':      { key: 'airEater',       glyph: '⛅', label: 'Air-eater',
    desc: 'Air-eater: scoops atmosphere at a gas giant or thick-atmosphere body for fuel or aerobraking.' },
  'Missile':        { key: 'missile',        glyph: '🚀', label: 'Missile',
    desc: 'Missile robonaut: a one-shot impactor prospector, consumed when it fires.' },
  'Raygun':         { key: 'raygun',         glyph: '🔫', label: 'Raygun',
    desc: 'Raygun robonaut: prospects every site within line of sight in a single op, not just the one you sit on.' },
  'Buggy':          { key: 'buggy',          glyph: '🛺', label: 'Buggy',
    desc: 'Buggy robonaut: a surface rover that may re-roll one failed prospect die.' },
};
const PROPERTY_COLUMNS_NUM = {
  'Afterburn':      { key: 'afterburn',      glyph: '🔥', label: 'Afterburn',
    desc: 'Afterburn: optional high-thrust mode that spends extra fuel for more thrust on a burn.' },
  'Bonus Pivots':   { key: 'bonusPivots',    glyph: '↺',  label: 'Bonus pivots',
    desc: 'Bonus pivots: extra free direction changes per turn that do not cost a burn.' },
  'ISRU':           { key: 'isru',           glyph: '🛢', label: 'ISRU rig', zeroMeaningful: true },
};

// Build a `requires` array from the face's "Support
// Requirements" booleans. Just the power-source columns - see
// the BOOLEAN_TO_REQ comment for why this list is tight.
//
// Heat is a support too: a card that generates therms (reactors,
// generators, robonauts, the hotter thrusters) needs that many
// therms of radiator cooling in the stack to operate. We surface
// it as a counted `thermostat` requirement so it renders as 🌡️×N
// in the supports-required row and feeds the support-chain
// thermal-balance check (see thermsRequired / thermsSupplied).
// Radiators SUPPLY therms, they never require them, so the
// radiator type is skipped (its Light/Heavy therm columns are the
// cooling capacity, read via thermsSupplied).
function requiresFromFace(face, type) {
  const reqs = [];
  if (!face) return reqs;
  // Freighters carry a "Support Provided" matrix, not "Support Requirements"
  // (verified against the spreadsheet banner): they SUPPLY these supports to
  // the stack instead of needing them (mapped in suppliesFromFace). The
  // freighter sheet has no Therms column either, so no cooling requirement.
  if (type === 'freighter') return reqs;
  for (const [col, kind] of Object.entries(BOOLEAN_TO_REQ)) {
    if (face[col]) reqs.push({ kind, count: 1 });
  }
  // Radiators SUPPLY therms (their Light/Heavy therm columns are cooling
  // capacity, read via thermsSupplied), so they never REQUIRE therms - skip the
  // thermostat requirement for radiators. Power-source requirements (e.g. an
  // active refrigerator's "e Generator") DO apply to radiators and are kept.
  if (type !== 'radiator') {
    const therms = Number(face.Therms) || 0;
    if (therms > 0) reqs.push({ kind: 'thermostat', count: therms });
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
// the stack - i.e. which support chips a thruster/robonaut/etc
// is allowed to satisfy by including this card. Radiators
// always supply the thermostat chip; reactors and generators
// supply whichever Type-column boxes are ticked; other card
// types supply nothing (they don't show up as chips on other
// cards' supports rows).
function suppliesFromFace(face, type) {
  if (!face) return [];
  // Freighters' "Support Provided" matrix (same power-source columns as the
  // thruster "Support Requirements" matrix) are supplies: the freighter feeds
  // these reactor / generator chips into the stack.
  if (type === 'freighter') {
    return Object.entries(BOOLEAN_TO_REQ)
      .filter(([col]) => face[col])
      .map(([, kind]) => kind);
  }
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
  for (const [col, { zeroMeaningful, ...def }] of Object.entries(PROPERTY_COLUMNS_NUM)) {
    const v = face[col];
    // ISRU 0 is a real rating (the lowest = the best rig - it prospects /
    // refuels any site), so keep it. Afterburn / bonus-pivots of 0 mean
    // "none", so those still drop on falsiness.
    const present = zeroMeaningful ? (v != null && v !== '') : !!v;
    if (present) out.push({ ...def, value: v });
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
    // Each face carries its OWN name - the published HF4 cards
    // print different names on the two sides (Ablative Plate
    // flips to Ablative Nozzle). buildPatent still uses the
    // primary face's name for the card id and lookup.
    name:       tier.Name || null,
    ability:    tier.Ability || null,
    // Future mission: an end-game objective printed on the Tier-2 (purple /
    // promoted) side only. Reference-only for now (futures are expansion), but
    // the card renderer surfaces it as the blue callout on that face.
    future:     tier.Future || null,
    requires:   requiresFromFace(tier, type),
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
    // Freighters carry cargo, not thrust: their key stat is the Load-Limit (how
    // many cards/FTs they can haul) and whether they can only be loaded at a
    // Factory. Other card types leave these blank.
    base.loadLimit   = tier['Load-Limit'];
    base.factoryOnly = tier['Factory Loading Only'] || false;
    // Afterburn is the NUMBER of fuel steps you may expend to gain +1 net
    // thrust (rulebook MW Afterburn); 0 / blank = no afterburn. Keep it numeric
    // (it used to be flattened to a boolean, which dropped the cost and broke
    // the +1 thrust gate). The thrust gain is always +1, never this value.
    base.afterburn   = Number(tier.Afterburn) || 0;
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
    loadLimit:   primaryFace.loadLimit,
    factoryOnly: primaryFace.factoryOnly,
    // Colony type this card promotes (flips to its purple side) at. Card-level
    // (same for both faces); the renderer shows it on the FRONT face only.
    promotionColony: row['Promotion Colony'] || null,
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

// ---- Thermal-balance helpers (shared by every support-chain check) ----
//
// Therms a face DEMANDS: its heat output, surfaced as the counted
// `thermostat` requirement (see requiresFromFace). 0 for cards that
// generate no heat. Pass the INSTALLED face so a flipped card (Tier-2
// dark side) reports its own heat, not Tier-1's.
export function thermsRequired(face) {
  if (!face) return 0;
  const r = (face.requires || []).find((x) => x.kind === 'thermostat');
  return r ? (Number(r.count) || 0) : 0;
}

// Resolve a radiator face's DEPLOYED-side stats ({ mass, radHardness, therms }).
// `radSide` is 'light' | 'heavy'. Default 'heavy' - the bigger, max-cooling
// deployed side - so a legacy caller with no side gets the same value the old
// max() behaviour did (heavy therms >= light therms for every radiator). A
// radiator deploys on ONE side; the side is locked at construction (Boost) and
// only radiation damage (heavy -> light) flips it afterwards.
export function radiatorSide(face, radSide) {
  if (!face) return null;
  const light = face.light || null;
  const heavy = face.heavy || null;
  if (!light && !heavy) {
    return { mass: face.mass, radHardness: face.radHardness, therms: face.therms };
  }
  return radSide === 'light' ? (light || heavy) : (heavy || light);
}

// Rad-hardness of a radiator's deployed side (heavy by default). The heavy side
// is typically more radiation-fragile than the light side, which is what makes
// the heavy -> light radiation degrade meaningful.
export function radiatorRadHardness(face, radSide) {
  const side = radiatorSide(face, radSide);
  if (side && side.radHardness != null) return Number(side.radHardness) || 0;
  return Number(face && face.radHardness) || 0;
}

// Therms a radiator SUPPLIES: its cooling capacity on its DEPLOYED side. Pass
// the slot's `radSide` ('light' | 'heavy'); omitted defaults to the heavier
// (max-cooling) side, matching the legacy max() behaviour. Non-radiators
// supply 0.
export function thermsSupplied(card, face, radSide) {
  if (!card || card.type !== 'radiator') return 0;
  const f = face || (card.faces && card.faces.primary) || card;
  const side = radiatorSide(f, radSide);
  if (side && side.therms != null) return Number(side.therms) || 0;
  const light = Number(f.light && f.light.therms) || 0;
  const heavy = Number(f.heavy && f.heavy.therms) || 0;
  return Math.max(light, heavy, Number(f.therms) || 0);
}

export function patentsByType(type) {
  return PATENTS.filter((p) => p.type === type);
}

// Public catalogue of card types. Labs and standalone modifiers
// are not real HF4 cards - see the header note. Don't add them.
export const PATENT_TYPES = [
  'thruster', 'reactor', 'radiator', 'refinery',
  'robonaut', 'generator',
];

// Expansion-only card types. Surfaced in the library so the
// player can browse the future content, but the engine MUST
// refuse to let them into the hand or rocket stack. Adding a
// type here is enough to gate it - downstream code that filters
// the patent deck reads this set.
export const EXPANSION_TYPES = new Set(['gw-thruster', 'freighter']);
export function isExpansionType(type) {
  return EXPANSION_TYPES.has(type);
}
