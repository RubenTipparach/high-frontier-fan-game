// Net Thrust track - transcribed from the published HF4 "All"
// board image (the magenta-and-blue fuel/thrust ladder). This is
// pure data: no DOM, no node: imports (imported by both the
// browser strip renderer and, later, the engine).
//
// HOW THE TRACK READS
// -------------------
// "Net Thrust track | Place Rocket figure to indicate net thrust.
//  Thrust modified by afterburn, weight class, solar power and
//  beamed power."
//
// The rocket figure sits on the NET-THRUST READOUT (the pink
// circles, "<1 coast only" then 1..15). Net thrust =
//   base thrust (the pink circle on the thruster card)
//   + afterburn (orange triangle: +1 net thrust, costs X fuel steps)
//   + weight-class modifier (below)
//   + solar / beamed power bonuses.
//
// WEIGHT CLASS is set by WET MASS, in doubling brackets. Heavier
// stacks are slower (lower net-thrust modifier):
//   WISP      +2   mass 1
//   PROBE     +1   mass 2-4
//   SCOUT      0   mass 5-8
//   TRANSPORT -1   mass 9-16
//   TUG       -2   mass 17-32
//
// MASS CHITS: MIN DRY MASS = 1, MAX DRY MASS = 23, MAX WET MASS = 32.
// Two chits ride the track: a DRY-mass chit and a WET-mass chit.
//
// LINE SEMANTICS (how a chit walks the track)
// -------------------------------------------
//   black line  = FT SPEND. A fuel burn (or an FT discard) walks
//                 the wet-mass chit toward dry mass (left / down
//                 the ladder). The fraction ladder in each band is
//                 the sub-step granularity of that spend.
//   red dotted  = REFUEL. Adding fuel tanks walks the wet-mass
//                 chit the other way (right / up). Red lines may
//                 also run BACKWARD when transferring fuel out to
//                 an outpost or to the LEO Aqua bank.
//
// FRACTION LADDERS: the white sub-step ovals between whole mass
// units. The denominator coarsens as mass grows (a fuel step buys
// less mass-fraction at high mass): ninths in WISP, sixths/quarters
// in PROBE, thirds/halves in SCOUT, halves in TRANSPORT, whole
// steps in TUG.
//
// The board prints the track twice: a Rocket copy (blue, top) and
// a Bernal copy (gray, bottom - the STANFORD / KALPANA cylinders).
// They share this structure; we model one track.

// The net-thrust readout scale (the pink circles along the top).
export const NET_THRUST_READOUT = ['<1', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

// Weight classes, low mass -> high mass. `fractions` is the band's
// fuel-step ladder (steepest descent, read top-to-bottom on the
// board). `color` mirrors the blue band shades on the Rocket copy.
export const WEIGHT_CLASSES = [
  { id: 'WISP',      label: 'WISP',      netThrust: +2, massMin: 1,  massMax: 1,  color: '#bfe6f7',
    fractions: ['8/9', '7/9', '2/3', '5/9', '4/9', '1/3', '2/9', '1/9'] },
  { id: 'PROBE',     label: 'PROBE',     netThrust: +1, massMin: 2,  massMax: 4,  color: '#9fd8f2',
    fractions: ['5/6', '3/4', '2/3', '1/2', '1/3', '1/4', '1/6'] },
  { id: 'SCOUT',     label: 'SCOUT',     netThrust:  0, massMin: 5,  massMax: 8,  color: '#7dcdee',
    fractions: ['2/3', '1/2', '1/3'] },
  { id: 'TRANSPORT', label: 'TRANSPORT', netThrust: -1, massMin: 9,  massMax: 16, color: '#54bfe8',
    fractions: ['1/2'] },
  { id: 'TUG',       label: 'TUG',       netThrust: -2, massMin: 17, massMax: 32, color: '#2fb3e6',
    fractions: [] },
];

export const MIN_DRY_MASS = 1;
export const MAX_DRY_MASS = 23;
export const MAX_WET_MASS = 32;

// The weight class (and its net-thrust modifier) for a given wet
// mass. Single source of truth for the band rule; the strip
// renderer and the engine both read this.
export function weightClassForMass(mass) {
  const m = Math.max(1, Math.round(mass || 1));
  for (const wc of WEIGHT_CLASSES) {
    if (m >= wc.massMin && m <= wc.massMax) return wc;
  }
  return WEIGHT_CLASSES[WEIGHT_CLASSES.length - 1];
}

// Flat list of the 32 mass nodes, each tagged with its band, the
// net-thrust modifier in force there, and any chit marker.
export const MASS_NODES = (() => {
  const nodes = [];
  for (let m = 1; m <= MAX_WET_MASS; m++) {
    const wc = weightClassForMass(m);
    let marker = null;
    if (m === MIN_DRY_MASS) marker = 'min-dry';
    else if (m === MAX_DRY_MASS) marker = 'max-dry';
    else if (m === MAX_WET_MASS) marker = 'max-wet';
    nodes.push({ mass: m, band: wc.id, netThrust: wc.netThrust, marker });
  }
  return nodes;
})();

// Legend glyphs printed in the centre of the board, for the modal.
export const TRACK_LEGEND = [
  { glyph: 'base',     label: 'Base thrust', note: 'The number in the pink thrust circle on the thruster card.' },
  { glyph: 'afterburn', label: 'Afterburn',   note: 'Orange triangle: +1 net thrust, costs X fuel steps.' },
  { glyph: 'solar',    label: 'Solar-powered', note: 'Net thrust scales with solar power (the sun glyph).' },
  { glyph: 'beamed',   label: 'Beamed power', note: 'Net thrust gains from a beam-station push.' },
  { glyph: 'push',     label: 'Pushable',    note: 'The thruster can be pushed by a powersat / beam.' },
  { glyph: 'water',    label: 'Water fuel',  note: 'Blue droplet: the fuel consumption is water.' },
  { glyph: 'dirt',     label: 'Dirt fuel',   note: 'Gray droplet: the fuel consumption is dirt.' },
  { glyph: 'isotope',  label: 'Isotope fuel thruster', note: 'Gold triangle: GW afterburn (+X net thrust & 1 Therm per fuel step); must burn isotope FT of the correct spectral type.' },
];
