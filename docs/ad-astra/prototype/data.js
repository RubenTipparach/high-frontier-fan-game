// HIGH FRONTIER: AD ASTRA - playable prototype data (placeholder numbers).
//
// Every number here is a [TUNE] value from docs/ad-astra/rules.md. Rule IDs in
// comments (AA-F4 etc.) point at the rule each table implements. This is NOT
// game data for the real app: rulebook open question Z4 decides where real
// Ad Astra card stats live.

// ---------------------------------------------------------------- tunables
export const TUNE = {
  startAqua: 16,          // AA-C3
  launchWindow: 6,        // AA-D2
  generations: 16,        // AA-D3
  cometSeasonGens: 2,     // AA-D3a: Generations per Comet Cycle season (red, yellow, blue)
  maxV: 6,                // AA-B4
  researchCost: 1,        // AA-S2b, aqua per card
  beamRangeSpaces: 8,     // AA-F3, 4 ly
  beamBurnAqua: 1,        // AA-F3
  lensRangeSpaces: 18,    // AA-G12
  skimYield: 3,           // AA-G13
  domeCapDefault: 2,      // AA-H7
  seedshipCubes: 6,       // AA-H9f
  industryCubes: 2,       // AA-H9b
};

// AA-E3 / AA-S3: Sol Sources (Produce needs the matching Source holding).
export const SOURCES = {
  fissile:   { name: 'Earth fissile works',     family: 'Pulse',      cost: 2, yield: 6 },
  jupiter:   { name: 'Jupiter He-3 skimmers',   family: 'Fusion',     cost: 3, yield: 6 },
  saturn:    { name: 'Saturn He-3 skimmers',    family: 'Fusion',     cost: 2, yield: 4 },
  antimatter:{ name: 'Mercury antimatter farm', family: 'Antimatter', cost: 4, yield: 6 },
};

// AA-S3: Holdings.
export const HOLDINGS = [
  { id: 'fissile',    name: 'Earth fissile works',     cost: 3, vp: 1, desc: 'Produce Pulse units' },
  { id: 'jupiter',    name: 'Jupiter He-3 skimmers',   cost: 3, vp: 1, desc: 'Produce Fusion pellets' },
  { id: 'saturn',     name: 'Saturn He-3 skimmers',    cost: 3, vp: 1, desc: 'Produce Fusion pellets' },
  { id: 'antimatter', name: 'Mercury antimatter farm', cost: 3, vp: 1, desc: 'Produce Antimatter' },
  { id: 'market',     name: 'Market',                  cost: 4, vp: 1, desc: '+1 Aqua on every Income' },
  { id: 'beam',       name: 'Beam Station',            cost: 5, vp: 1, desc: 'Pushes beam ships, lights ramscoops' },
  { id: 'lens',       name: 'Lens Observatory',        cost: 4, vp: 1, desc: 'Lens Survey from Sol' },
  { id: 'bernal',     name: 'Bernal Colony',           cost: 5, vp: 2, desc: 'Empire growth' },
];

// AA-F4: weight classes.
export const CLASSES = [
  { name: 'Wisp', lo: 0, hi: 4, x: 1 },
  { name: 'Hauler', lo: 5, hi: 8, x: 2 },
  { name: 'Ark', lo: 9, hi: 13, x: 3 },
  { name: 'Worldship', lo: 14, hi: 999, x: 4 },
];
// AA-E4: propellant units per 1 Mass.
export const PROP_PER_MASS = { Pulse: 6, Fusion: 6, Antimatter: 20, Beam: Infinity, Ramscoop: Infinity };

export const FAMILY_GLYPH = { Pulse: '☢', Fusion: '∿', Antimatter: '✸', Beam: '≋', Ramscoop: '◎' };

// ---------------------------------------------------------------- cards
// role: drive | brake | payload | prospector | seed | support | shield
// lf = Landfall (black) side: { name, mass, role, cap?, blurb }
//   lf.role in Dome | Mirror | Atmosphere | Biosphere | Lander | null (AA-H10)
const D = (o) => o;
export const CARD_DEFS = [
  // ---- Drives (AA-F1, AA-F2). type gw-thruster = the gold TW wedge.
  D({ id: 'medusa', name: 'Solem Medusa Spinnaker', role: 'drive', family: 'Pulse', thrust: 2, fuel: 2, brake: true, mass: 3, rad: 8, spec: 'M', payloadLimit: 7,
      requires: ['gen-electric'], blurb: 'The nuclear parachute. Bombs burst between ship and canopy; turn the canopy forward to brake.',
      lf: { name: 'Canopy Mirror', mass: 2, role: 'Mirror', blurb: 'The spent canopy, re-silvered into an orbital mirror.' } }),
  D({ id: 'orion', name: 'Orion Pusher Plate', role: 'drive', family: 'Pulse', thrust: 3, fuel: 3, brake: true, mass: 4, rad: 9, spec: 'V', payloadLimit: 9,
      requires: [], blurb: 'A steel plate, a shock absorber and a magazine of bombs. Crude, strong, brakes by flipping.',
      lf: { name: 'Pusher-Plate Dome', mass: 3, role: 'Dome', cap: 2, blurb: 'The plate makes a roof that shrugs off meteorites.' } }),
  D({ id: 'daedalus', name: 'Daedalus Pellet Fusion', role: 'drive', family: 'Fusion', thrust: 3, fuel: 2, brake: false, mass: 4, rad: 7, spec: 'S', payloadLimit: 7,
      requires: ['gen-electric'], blurb: 'Fusion pellets lit 250 times a second. Built for a flyby: it cannot brake.',
      lf: { name: 'Fusion Torch Lander', mass: 2, role: 'Lander', blurb: 'The chamber rebuilt small, to land and lift between moons.' } }),
  D({ id: 'icarus', name: 'Icarus Firefly Z-Pinch', role: 'drive', family: 'Fusion', thrust: 2, fuel: 2, brake: true, mass: 3, rad: 7, spec: 'C', payloadLimit: 6,
      requires: ['gen-electric'], blurb: 'A z-pinch fusion torch that can turn around and brake into orbit.',
      lf: { name: 'Comet Herder', mass: 2, role: 'Atmosphere', blurb: 'Nudges iceballs down onto a dry world.' } }),
  D({ id: 'frisbee', name: 'Frisbee Beam-Core', role: 'drive', family: 'Antimatter', thrust: 3, fuel: 1, brake: true, mass: 3, rad: 5, spec: 'M', payloadLimit: 6,
      requires: ['reactor-fusion'], blurb: 'Annihilation pions steered out a magnetic nozzle. Needs a fusion core to start.',
      lf: { name: 'Annihilation Lander', mass: 2, role: 'Lander', blurb: 'A pinch of antimatter lifts tonnes off a moon.' } }),
  D({ id: 'valkyrie', name: 'Valkyrie Tether Ship', role: 'drive', family: 'Antimatter', thrust: 2, fuel: 1, brake: true, mass: 2, rad: 6, spec: 'S', payloadLimit: 5,
      requires: [], blurb: 'Engine in front, payload trailing on a tether. Light and quick.',
      lf: { name: 'Tether Elevator', mass: 1, role: 'Lander', blurb: 'The tether hung down from a moon as a lift.' } }),
  D({ id: 'forward', name: 'Forward Staged Lightsail', role: 'drive', family: 'Beam', thrust: 2, fuel: 0, brake: 'staged', mass: 1, rad: 3, spec: 'C', payloadLimit: 4,
      requires: [], blurb: 'Ridden on a laser from Sol. At the end the outer ring detaches and reflects the beam back to brake you.',
      lf: { name: 'Sail Shade', mass: 1, role: 'Mirror', blurb: 'A sunshade at the inner Lagrange point.' } }),
  D({ id: 'bussard', name: 'Bussard Ramscoop', role: 'drive', family: 'Ramscoop', thrust: 2, fuel: 0, brake: true, mass: 5, rad: 6, spec: 'V', payloadLimit: 9,
      requires: ['reactor-fusion'], blurb: 'Swallows interstellar hydrogen. Needs V2 to light; the Beam Station gets you there. Brakes on scoop drag.',
      lf: { name: 'Atmosphere Scoop', mass: 3, role: 'Atmosphere', blurb: 'Skims a gas giant to pour air onto a dry world.' } }),
  // ---- Brakes (AA-F6)
  D({ id: 'magsail', name: 'Zubrin Magsail', role: 'brake', mass: 1, rad: 5, spec: 'M', brakeKind: 'magsail',
      blurb: 'A superconducting loop kilometres wide. -1 V any Generation, and safe icebraking.',
      lf: { name: 'Magnetosphere Ring', mass: 1, role: 'Atmosphere', blurb: 'Shields a new atmosphere from the stellar wind.' } }),
  D({ id: 'esail', name: 'Janhunen E-Sail', role: 'brake', mass: 0, rad: 4, spec: 'C', brakeKind: 'esail',
      blurb: 'Charged wires that brake on a stellar wind, once you are close.',
      lf: { name: 'Wire Antenna Farm', mass: 0, role: null, blurb: 'Talks to Sol.' } }),
  // ---- Payload / crew modes (AA-F5)
  D({ id: 'habring', name: 'Generation Habitat Ring', role: 'payload', pop: 3, mass: 4, rad: 6, spec: 'C', payloadKind: 'ring',
      blurb: 'Three thousand people born, living and dying aboard. Population 3. Suffers Drift.',
      lf: { name: 'Ring Dome', mass: 3, role: 'Dome', cap: 3, blurb: 'The spin ring laid flat and roofed.' } }),
  D({ id: 'cryo', name: 'Cryo Vault', role: 'payload', pop: 2, mass: 2, rad: 4, spec: 'S', payloadKind: 'cryo',
      blurb: 'Sleepers, thawed in shifts for repairs. Population 2. Roll on arrival.',
      lf: { name: 'Biosphere Bank', mass: 1, role: 'Biosphere', blurb: 'Frozen seeds, spores and gut flora for a whole ecology.' } }),
  D({ id: 'embryo', name: 'Embryo Bank', role: 'payload', pop: 0, mass: 1, rad: 3, spec: 'V', payloadKind: 'embryo',
      blurb: 'Population 0. Becomes 2 once replicators build the nursery.',
      lf: { name: 'Artificial Wombs', mass: 1, role: 'Biosphere', blurb: 'Every species of a living world, in jars.' } }),
  D({ id: 'upload', name: 'Upload Core', role: 'payload', pop: 1, mass: 0, rad: 2, spec: 'M', payloadKind: 'upload',
      blurb: 'Minds on a chip. Population 1, but they need replicator bodies to act.',
      lf: { name: 'Robot Bodies', mass: 1, role: 'Lander', blurb: 'Walkers and fliers for the uploaded crew.' } }),
  // ---- Prospectors (AA-G11)
  D({ id: 'lidar', name: 'Flyby Lidar Raygun', role: 'prospector', isru: 2, raygun: true, mass: 1, rad: 5, spec: 'S',
      blurb: 'Scans a whole system from orbit, even in the hours of a flyby.',
      lf: { name: 'Survey Rover', mass: 1, role: 'Lander', blurb: 'Rolls the regolith for ore and ice.' } }),
  D({ id: 'missile', name: 'Penetrator Missile', role: 'prospector', isru: 1, raygun: false, mass: 1, rad: 7, spec: 'V',
      blurb: 'Fired into the ground from close orbit. Must be at the site.',
      lf: { name: 'Seismic Net', mass: 0, role: null, blurb: 'Listens to the planet ring.' } }),
  D({ id: 'rover', name: 'Ice Mole Rover', role: 'prospector', isru: 0, raygun: false, mass: 2, rad: 6, spec: 'C',
      blurb: 'Melts down through ice to find the ocean. Must be at the site.',
      lf: { name: 'Dome Printer', mass: 2, role: 'Dome', cap: 2, blurb: 'Prints pressure domes out of regolith.' } }),
  // ---- Seeds (AA-H3)
  D({ id: 'seed', name: 'Von Neumann Seed', role: 'seed', mass: 1, rad: 3, spec: 'V',
      blurb: 'A fist of grey goo that builds a factory out of a rock, then another. Keep a human near it.',
      lf: { name: 'Replicator Swarm', mass: 0, role: null, blurb: 'Doubles every Generation.' } }),
  // ---- Supports
  D({ id: 'winch', name: 'Shroud Winch Dynamo', role: 'support', supplies: ['gen-electric'], mass: 1, rad: 6, spec: 'M',
      blurb: 'Reels the ship up its lines between pulses and banks the power.',
      lf: { name: 'Power Grid', mass: 1, role: null, blurb: 'Lights a colony.' } }),
  D({ id: 'fusioncore', name: 'Spheromak Fusion Core', role: 'support', supplies: ['reactor-fusion', 'gen-electric'], mass: 2, rad: 7, spec: 'S',
      blurb: 'A small fusion reactor. Starts beam-cores and ramscoops, and powers everything else.',
      lf: { name: 'Fusion Plant', mass: 2, role: null, blurb: 'Power for a city.' } }),
  // ---- Shields (AA-G8)
  D({ id: 'iceshield', name: 'Ice Dust Shield', role: 'shield', mass: 1, rad: 8, spec: 'C',
      blurb: 'Metres of ice up front. Absorbs one dust strike.',
      lf: { name: 'Ice Reservoir', mass: 1, role: null, blurb: 'Water for the first harvest.' } }),
  D({ id: 'whipple', name: 'Whipple Bumper', role: 'shield', mass: 1, rad: 6, spec: 'M',
      blurb: 'Layered foils that shred dust before it reaches the hull.',
      lf: { name: 'Dome Shell', mass: 1, role: 'Dome', cap: 1, blurb: 'A small bubble habitat.' } }),
];
export const CARD_BY_ID = Object.fromEntries(CARD_DEFS.map((c) => [c.id, c]));

// Deck composition (copies). AA-B1. Decks are by role.
export const DECKS = {
  drive: ['medusa', 'orion', 'daedalus', 'icarus', 'frisbee', 'valkyrie', 'forward', 'bussard'],
  brake: ['magsail', 'magsail', 'esail'],
  payload: ['habring', 'habring', 'cryo', 'cryo', 'embryo', 'embryo', 'upload'],
  prospector: ['lidar', 'lidar', 'missile', 'rover'],
  seed: ['seed', 'seed', 'seed'],
  support: ['winch', 'winch', 'fusioncore', 'fusioncore'],
  shield: ['iceshield', 'whipple'],
};
export const DECK_LABEL = { drive: 'TW Drives', brake: 'Brakes', payload: 'Payload', prospector: 'Prospectors', seed: 'Seeds', support: 'Supports', shield: 'Shields' };

// AA-H10 spin-off decks.
export const SPINOFFS = {
  1: { name: 'Habitat Engineering', effect: 'domeCap', text: 'Domes hold +1 Population.' },
  2: { name: 'Optics', effect: 'optics', text: 'Lens Survey reaches any distance.' },
  3: { name: 'Aerospace', effect: 'aerospace', text: 'Settle needs no lander.' },
  4: { name: 'Biotech', effect: 'biotech', text: 'Grow adds 2 Population.' },
};
export const TERRAFORM = [ // AA-H10
  null,
  { reach: 'Paraterraformed', needs: ['Dome'], vp: 2 },
  { reach: 'Marginal', needs: ['Dome', 'Mirror'], vp: 4 },
  { reach: 'Habitable', needs: ['Dome', 'Mirror', 'Atmosphere'], vp: 7 },
  { reach: 'Garden', needs: ['Dome', 'Mirror', 'Atmosphere', 'Biosphere'], vp: 12, pop: 3 },
];

// AA-G7
export const EVENTS = {
  1: { name: 'Micrometeoroid', text: 'Lose 1 propellant (a Shield aboard stops it).' },
  2: { name: 'Drift', text: 'Habitat Ring: lose 1 Population unless your Crew is promoted.' },
  3: { name: 'Glitch', text: 'One card glitches: inactive until your Crew repairs it (free).' },
  4: { name: 'Quiet years', text: 'Nothing happens.' },
  5: { name: 'Breakthrough', text: 'Flip any one card aboard to its Landfall side, free.' },
  6: { name: 'Baby boom', text: 'Habitat Ring: +1 Population (max 4).' },
};

// ---------------------------------------------------------------- stars (AA-B6, AA-Y)
// The 94 star systems within 20 light-years (starcat.js, from the public "List
// of nearest stars"). type: yellow (A-K) | red (M) | white (white dwarf) |
// brown (L/T/Y). comp: giants inside the system. stars: stellar companions with
// their own systems on the same board (SM-1e), role 'binary' or 'distant'.
// known: a known HZ planet. HAND gives the stars the game already knew their
// ids and hand-made details, so saves and rules text keep working.
import { STARCAT } from './starcat.js';
const TYPE_OF = (c) => ('AFGK'.includes(c) ? 'yellow' : c === 'M' ? 'red' : c === 'D' ? 'white' : 'brown');
const RANK = (c) => 'OBAFGKMDLTY'.indexOf(c);
const HAND = {
  'Alpha Centauri': { id: 'alphacen', hazard: 'flare', stars: [{ name: 'Alpha Centauri B', type: 'yellow', role: 'binary' }, { name: 'Proxima Centauri', type: 'red', role: 'distant', known: 'Proxima b' }] },
  "Barnard's Star": { id: 'barnard' },
  'Luhman 16': { id: 'luhman16', stars: [{ name: 'Luhman 16 B', type: 'brown', role: 'binary' }] },
  'WISE 0855−0714': { id: 'wise0855', name: 'WISE 0855-0714' },
  'Wolf 359': { id: 'wolf359', hazard: 'flare' },
  'Lalande 21185': { id: 'lalande' },
  Sirius: { id: 'sirius', stars: [{ name: 'Sirius B', type: 'white', role: 'binary' }] },
  'Gliese 65': { id: 'uvceti', name: 'Luyten 726-8', hazard: 'flare', stars: [{ name: 'Luyten 726-8 B', type: 'red', role: 'binary' }] },
  'Ross 154': { id: 'ross154', hazard: 'flare' },
  'Epsilon Eridani': { id: 'epseri', comp: ['gas'], hazard: 'debris' },
  'Ross 128': { id: 'ross128', known: 'Ross 128 b' },
  '61 Cygni': { id: 'cyg61', stars: [{ name: '61 Cygni B', type: 'yellow', role: 'binary' }] },
  Procyon: { id: 'procyon', stars: [{ name: 'Procyon B', type: 'white', role: 'binary' }] },
  'Epsilon Indi': { id: 'epsind', comp: ['gas'], stars: [{ name: 'Epsilon Indi B', type: 'brown', role: 'distant' }] },
  'Tau Ceti': { id: 'tauceti', hazard: 'debris', known: 'Tau Ceti e' },
  "Luyten's Star": { id: 'luyten', known: 'GJ 273 b' },
  "Teegarden's Star": { id: 'teegarden', known: 'Teegarden b' },
};
const slug = (n) => n.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '').slice(0, 18);
export const STARS = STARCAT.map((c) => {
  const comps = [...c.stars].sort((p, q) => RANK(p.cls) - RANK(q.cls)); // the primary is the hottest
  const hand = HAND[c.name] || {};
  const name = hand.name || c.name;
  const auto = comps.slice(1, 3).map((x, i) => ({ name: `${name} ${'BC'[i]}`, type: TYPE_OF(x.cls), role: i === 0 ? 'binary' : 'distant' }));
  return { id: hand.id || slug(c.name), name, ly: c.ly, x: c.x, y: c.y, z: c.z, type: TYPE_OF(comps[0].cls), comp: hand.comp || [], hazard: hand.hazard || null, known: hand.known, stars: hand.stars || auto };
});
export const STAR_BY_ID = Object.fromEntries(STARS.map((s) => [s.id, s]));

// ---------------------------------------------------------------- chits (AA-B7, AA-H2)
export const HZ_POOLS = {
  yellow: { Garden: 1, Habitable: 3, Marginal: 4, Hostile: 4, None: 4 },
  red: { Garden: 0, Habitable: 2, Marginal: 3, Hostile: 5, None: 6 },
};
export const COMP_POOL = { Ocean: 6, None: 6 };
export const CLASS_HYD = { Garden: [6, 9], Habitable: [4, 7], Marginal: [2, 5], Hostile: [0, 3] };

export const WORLD_NAMES = ['Verge', 'Haven', 'Cinder', 'Tethys', 'Morrow', 'Ashfall', 'Lumen', 'Brine', 'Kestrel', 'Halcyon', 'Ember', 'Rime', 'Solace', 'Drift'];
