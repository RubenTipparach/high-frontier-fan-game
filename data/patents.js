// Patent deck. Each patent is a tradable / auctionable card that can
// be installed on a rocket stack at build time. Cards are grouped by
// `type`; a complete ship needs one thruster + one reactor + one
// radiator at minimum, plus optional refinery / robonaut / lab /
// generator slots.
//
// Stats are designed for playability, not copied from any published
// source. Real-world propulsion concepts (NERVA, VASIMR, ion, etc.)
// are public-domain technical terminology; the numerical balance and
// flavor text here are original.
//
// Common fields:
//   id            stable key
//   name          display name
//   type          thruster | reactor | radiator | refinery |
//                 robonaut  | generator | lab | modifier
//   mass          wet mass added to the ship stack
//   radHardness   0..3 rad tolerance (auto-defaulted by type)
//   spectralType  single letter spectral class (C/S/M/V/B/D)
//                 -- drives the spectral hex glyph on every card
//   requires      array of { kind, count } the ship's stack must
//                 collectively supply for the card to fly.
//                 The card-decoration step can also accept a
//                 plain string array (e.g. ['push-sat',
//                 'pulse-generator']) which expands to count=1
//                 entries.
//   blurb         one-line flavor
//
// Thruster-specific:
//   thrust        max wet-mass the thruster can push in one burn
//                 (so a ship with stack mass M needs thrust >= M
//                 to MOVE). Rendered as the value inside the
//                 pink thrust circle on the card.
//   isp           burns per fuel unit. Higher = more efficient.
//                 Drives the water-droplet fuel cost in MOVE.
//
// Reactor-specific:
//   power         power units supplied to powered thrusters
//   heat          heat units generated; needs radiator >= heat
//
// Radiator-specific:
//   heat_cap      heat units it can dissipate per burn
//
// Refinery-specific:
//   water_out     water units produced per income phase at a
//                 hydrated site. Multiplied by site.hydration.
//
// Robonaut-specific:
//   prospect_bonus  +N pips on the prospect die roll
//
// Generator-specific:
//   science       science points per income phase (a future-stage
//                 currency for the tech tree)

export const PATENTS = [
  // ===== Thrusters: chemical / cold (cheap, plentiful) =====
  { id: 't_chemsust',   name: 'Chemical Sustainer',    type: 'thruster', mass: 2, thrust: 8,  isp: 2, radHardness: 1, spectralType: 'C', supports: ['aerobrake'],            blurb: 'LOX/methane workhorse. Burns fast, hauls a lot.' },
  { id: 't_chemtug',    name: 'Hydrazine Tug',         type: 'thruster', mass: 1, thrust: 5,  isp: 2, spectralType: 'C', supports: ['push-sat'],            blurb: 'Storable monoprop. Cheap, reliable.' },
  { id: 't_solidkick',  name: 'Solid Kick Stage',      type: 'thruster', mass: 1, thrust: 10, isp: 1, spectralType: 'C', supports: ['pulse'],               blurb: 'One-shot motor for hard insertions.' },
  { id: 't_resistojet', name: 'Resistojet',            type: 'thruster', mass: 1, thrust: 2,  isp: 4, spectralType: 'C', supports: ['isru'],                blurb: 'Electrically heated water. Slow but tidy.' },
  { id: 't_arcjet',     name: 'Arcjet',                type: 'thruster', mass: 1, thrust: 3,  isp: 5, spectralType: 'C', supports: ['isru'],                blurb: 'Arc-heated propellant; needs juice.' },

  // ===== Thrusters: electric / ion (efficient, low thrust) =====
  { id: 't_iondrive',   name: 'Gridded Ion Drive',     type: 'thruster', mass: 1, thrust: 1,  isp: 10, spectralType: 'M', supports: ['push-sat'],            blurb: 'Pencil-thin thrust, glacial accelerations.' },
  { id: 't_hall',       name: 'Hall-Effect Thruster',  type: 'thruster', mass: 1, thrust: 2,  isp: 8, spectralType: 'M', supports: ['push-sat'],            blurb: 'Solid workhorse for station tugs.' },
  { id: 't_mpd',        name: 'Magnetoplasmadynamic',  type: 'thruster', mass: 2, thrust: 3,  isp: 7, spectralType: 'M', supports: ['push-sat'],            blurb: 'Lorentz-force accelerated plasma.' },
  { id: 't_vasimr',     name: 'VASIMR Engine',         type: 'thruster', mass: 2, thrust: 4,  isp: 8, spectralType: 'M', supports: ['push-sat', 'crew'],    blurb: 'Variable specific impulse, mode-switchable.' },
  { id: 't_pit',        name: 'Pulsed Inductive',      type: 'thruster', mass: 1, thrust: 4,  isp: 6, spectralType: 'C', supports: ['push-sat', 'pulse'],   blurb: 'Capacitor-banked plasma rings.' },

  // ===== Thrusters: nuclear thermal =====
  { id: 't_nerva',      name: 'Nuclear Thermal',       type: 'thruster', mass: 3, thrust: 6,  isp: 4, radHardness: 3, spectralType: 'M', supports: ['crew'],                blurb: 'Solid-core fission heater. NERVA heritage.' },
  { id: 't_lightbulb',  name: 'Gas-Core Nuclear',      type: 'thruster', mass: 3, thrust: 7,  isp: 6, spectralType: 'M', supports: ['crew'],                blurb: 'Light-bulb topology: hot uranium, cool walls.' },
  { id: 't_saltwater',  name: 'Nuclear Salt-Water',    type: 'thruster', mass: 2, thrust: 9,  isp: 7, spectralType: 'M', supports: ['pulse'],               blurb: 'Continuous open-cycle fission. Mad and effective.' },
  { id: 't_fragment',   name: 'Fission Fragment',      type: 'thruster', mass: 3, thrust: 4,  isp: 9, spectralType: 'M', supports: ['push-sat'],            blurb: 'Fission products as their own exhaust.' },

  // ===== Thrusters: fusion =====
  { id: 't_zpinch',     name: 'Z-Pinch Fusion',        type: 'thruster', mass: 4, thrust: 6,  isp: 8, blurb: 'Self-pinched plasma column. Loud.' },
  { id: 't_dpfusion',   name: 'D-He3 Fusion Drive',    type: 'thruster', mass: 4, thrust: 5,  isp: 11, blurb: 'Aneutronic fuel. Needs Saturn-grade He3.' },
  { id: 't_icftorch',   name: 'ICF Torch Drive',       type: 'thruster', mass: 5, thrust: 8,  isp: 10, blurb: 'Inertial confinement. Pulsed brilliance.' },
  { id: 't_orion',      name: 'Pulse Propulsion',      type: 'thruster', mass: 5, thrust: 12, isp: 6, radHardness: 3, blurb: 'External nuclear pulse. Pusher plate optional.' },

  // ===== Thrusters: sails / beam =====
  { id: 't_solarsail',  name: 'Solar Sail',            type: 'thruster', mass: 1, thrust: 1,  isp: 99, radHardness: 0, spectralType: 'C', supports: ['sail', 'beam'],        blurb: 'Free fuel in the inner system. Useless past Mars.' },
  { id: 't_magsail',    name: 'Magnetic Sail',         type: 'thruster', mass: 2, thrust: 1,  isp: 99, spectralType: 'M', supports: ['sail'],                blurb: 'Rides the solar wind. Works further out.' },
  { id: 't_lasersail',  name: 'Laser-Pushed Sail',     type: 'thruster', mass: 1, thrust: 3,  isp: 99, spectralType: 'C', supports: ['sail', 'beam'],        blurb: 'Needs a friendly laser station. Worth the trip.' },
  { id: 't_tether',     name: 'Electrodynamic Tether', type: 'thruster', mass: 1, thrust: 2,  isp: 99, spectralType: 'M', supports: ['push-sat'],            blurb: 'Lorentz reboost in any magnetosphere.' },

  // ===== Thrusters: aerobrake / atmospheric =====
  { id: 't_aerobrake',  name: 'Aerobrake Shroud',      type: 'thruster', mass: 2, thrust: 6,  isp: 99, blurb: 'One-trick pony: only works on atmospheric arrivals.' },
  { id: 't_massdriver', name: 'Mass-Driver Catapult',  type: 'thruster', mass: 4, thrust: 15, isp: 1, blurb: 'Site-bound launcher. Brutal acceleration.' },

  // ===== Reactors =====
  { id: 'r_solar_s',    name: 'Solar Panel (small)',   type: 'reactor', mass: 1, power: 2, heat: 1, blurb: 'Inner-system only; output halved past Mars.' },
  { id: 'r_solar_l',    name: 'Solar Array',           type: 'reactor', mass: 2, power: 4, heat: 1, blurb: 'Full-spectrum collector. Bulky.' },
  { id: 'r_concentrator',name:'Concentrating Mirror',  type: 'reactor', mass: 1, power: 3, heat: 2, blurb: 'Focused sunlight on a tiny absorber.' },
  { id: 'r_rtg',        name: 'Plutonium RTG',         type: 'reactor', mass: 1, power: 1, heat: 1, blurb: 'Decay heat. Endless, anemic.' },
  { id: 'r_fission_s',  name: 'Compact Fission Pile',  type: 'reactor', mass: 2, power: 4, heat: 3, blurb: 'Kilopower-class reactor.' },
  { id: 'r_fission_l',  name: 'Gen-IV Fission',        type: 'reactor', mass: 3, power: 7, heat: 5, blurb: 'Closed-cycle, breeding-capable.' },
  { id: 'r_molten',     name: 'Molten-Salt Reactor',   type: 'reactor', mass: 3, power: 8, heat: 5, blurb: 'High-temp, walks away from prompt-critical.' },
  { id: 'r_tokamak',    name: 'Tokamak (D-T)',         type: 'reactor', mass: 4, power: 10, heat: 8, radHardness: 2, blurb: 'Tritium burner. Needs lithium blanket.' },
  { id: 'r_stellarator',name: 'Stellarator',           type: 'reactor', mass: 4, power: 11, heat: 8, blurb: 'Steady-state magnetic confinement.' },
  { id: 'r_polywell',   name: 'Polywell',              type: 'reactor', mass: 3, power: 9, heat: 6, blurb: 'Magnetic-grid inertial confinement.' },

  // ===== Radiators =====
  { id: 'h_pumped',     name: 'Pumped-Loop Radiator',  type: 'radiator', mass: 1, heat_cap: 3, blurb: 'Liquid-metal sweeper, off-the-shelf.' },
  { id: 'h_droplet',    name: 'Liquid Droplet Array',  type: 'radiator', mass: 1, heat_cap: 5, blurb: 'Spray a sheet of droplets; catch them downstream.' },
  { id: 'h_bubble',     name: 'Bubble-Membrane Radiator', type: 'radiator', mass: 2, heat_cap: 8, radHardness: 0, blurb: 'Foamed dome of vacuum-stable membrane.' },
  { id: 'h_curie',      name: 'Curie-Point Radiator',  type: 'radiator', mass: 2, heat_cap: 6, blurb: 'Magnetic-pumped working fluid.' },
  { id: 'h_heatpipe',   name: 'Heat-Pipe Array',       type: 'radiator', mass: 1, heat_cap: 4, blurb: 'Passive evaporation/condensation loops.' },

  // ===== Refineries =====
  { id: 'f_electro',    name: 'Electrolyzer Plant',    type: 'refinery', mass: 2, water_out: 1, blurb: 'Splits any water ice into H2 + O2.' },
  { id: 'f_sabatier',   name: 'Sabatier Reactor',      type: 'refinery', mass: 2, water_out: 1, blurb: 'CO2 + H2 -> methane + water.' },
  { id: 'f_centrifuge', name: 'Centrifugal Separator', type: 'refinery', mass: 2, water_out: 1, blurb: 'Spins ore slurry to recover volatiles.' },
  { id: 'f_cracker',    name: 'Hydrocarbon Cracker',   type: 'refinery', mass: 3, water_out: 2, blurb: 'Titan-grade hydrocarbon refinery.' },
  { id: 'f_isru_vol',   name: 'ISRU Volatiles Rig',    type: 'refinery', mass: 3, water_out: 2, blurb: 'Bake regolith, condense the steam.' },
  { id: 'f_slagspinner',name: 'Slag-Spinner',          type: 'refinery', mass: 3, water_out: 2, blurb: 'Smelt + spin in one box.' },

  // ===== Robonauts =====
  { id: 'b_telebot',    name: 'Telepresence Bot',      type: 'robonaut', mass: 1, prospect_bonus: 1, blurb: 'Remote-piloted from anywhere with a relay.' },
  { id: 'b_hopper',     name: 'Hopper Probe',          type: 'robonaut', mass: 1, prospect_bonus: 1, blurb: 'Bounces across low-g surfaces.' },
  { id: 'b_burrower',   name: 'Burrowing Mole',        type: 'robonaut', mass: 2, prospect_bonus: 2, blurb: 'Drills metres, samples deep ice.' },
  { id: 'b_geophys',    name: 'Geophysics Drone',      type: 'robonaut', mass: 2, prospect_bonus: 2, blurb: 'Active seismic + neutron spec.' },
  { id: 'b_sample',     name: 'Sample-Return Probe',   type: 'robonaut', mass: 2, prospect_bonus: 1, blurb: 'Brings actual rocks home.' },
  { id: 'b_swarm',      name: 'Cubesat Swarm',         type: 'robonaut', mass: 1, prospect_bonus: 1, blurb: 'Dozens of tiny mappers in parallel.' },

  // ===== Modifiers (attach to another card and adjust its stats) =====
  // These don't fly on their own. At BUILD time the engine
  // composes a modifier's `modifier.effect` onto a single attached
  // card of `modifier.target` type. A ship can carry as many
  // modifiers as can fit in its mass budget.
  { id: 'm_nozzle',     name: 'Magnetic Nozzle',     type: 'modifier', mass: 1, radHardness: 2, modifier: { target: 'thruster', effect: { thrust: 2 } },           blurb: 'Adds a magnetic nozzle to any plasma-class thruster. +2 thrust.' },
  { id: 'm_bell',       name: 'Bell Extension',      type: 'modifier', mass: 1, radHardness: 2, modifier: { target: 'thruster', effect: { isp: 1 } },               blurb: 'Larger expansion ratio. +1 ISP, no mass-flow change.' },
  { id: 'm_truss',      name: 'Composite Truss',     type: 'modifier', mass: 1, radHardness: 1, modifier: { target: 'any', effect: { mass: -1 } },                  blurb: 'Lightweight strongback shaves one mass off any attached card.' },
  { id: 'm_radshield',  name: 'Rad Shielding',       type: 'modifier', mass: 2, radHardness: 3, modifier: { target: 'any', effect: { radHardness: 2 } },            blurb: 'Tungsten + boron wrap. +2 RAD hardness on the attached card.' },
  { id: 'm_capacitor',  name: 'Capacitor Bank',      type: 'modifier', mass: 1, radHardness: 1, modifier: { target: 'thruster', effect: { thrust: 1 } }, blurb: 'Pulse-charging stack: +1 thrust at +1 power draw.' },
  { id: 'm_helium3',    name: 'Helium-3 Catalyst',   type: 'modifier', mass: 1, radHardness: 2, modifier: { target: 'thruster', effect: { isp: 2, mass: 1 } },      blurb: 'Aneutronic fuel boost. +2 ISP, +1 mass (tankage).' },

  // ===== Generators / Labs =====
  { id: 'g_micrograv',  name: 'Microgravity Lab',      type: 'lab',       mass: 2, science: 1, blurb: 'Pharmaceuticals, alloys, crystals.' },
  { id: 'g_centrifuge', name: 'Spin-Gravity Module',   type: 'generator', mass: 3, science: 1, blurb: 'Tether-spun lab section.' },
  { id: 'g_greenhouse', name: 'Greenhouse Module',     type: 'generator', mass: 2, science: 1, blurb: 'Closed-loop agriculture for crew.' },
  { id: 'g_3dprinter',  name: '3D Printer Bay',        type: 'generator', mass: 2, science: 1, blurb: 'Net-shape parts from regolith.' },
  { id: 'g_cyclotron',  name: 'Cyclotron',             type: 'lab',       mass: 3, science: 2, blurb: 'Isotopes-on-demand for medicine and science.' },
  { id: 'g_pbf',        name: 'Particle Beam Bench',   type: 'lab',       mass: 3, science: 2, blurb: 'Multi-GeV bench. Best at deep-space stations.' },
];

// Look up patents by id and by type. The renderer uses these to group
// cards in the browser view; the engine will use them at BUILD time.

// Auto-derived radHardness defaults per type so we don't have to
// hand-write a value on every card. Hard numbers can be overridden
// by adding a `radHardness` field on the individual patent. Range
// 0..3; higher = more tolerant of radiation hazards on the route.
// Requirement-kind catalogue. Each kind is a single capability
// the engine tracks across the cards in your stack. Other cards
// "supply" a kind (e.g. a Pulse Bank reactor supplies 1
// pulse-generator); a thruster carries a `requires` row that the
// stack must collectively satisfy. Card-ui maps each kind to a
// glyph + label.
export const REQUIREMENT_KINDS = [
  'pulse-generator',  // capacitor banks / pulse drivers
  'thermostat',       // active cooling supplied by radiators
  'crew-quarters',    // crewed thruster: needs habitat space
  'sail',             // light or magnetic sail rigging
  'beam-receiver',    // works with a friendly laser/microwave station
  'push-sat',         // satellite carrier / fuel-pusher pairing
  'isru-rig',         // in-situ propellant intake
  'aerobrake-shroud', // atmospheric-entry aeroshell
  'spin-grav',        // spin-gravity tether or hub
];

// One-letter / string aliases that older card declarations used
// before we introduced explicit kinds. Auto-expanded in the
// decoration loop below.
const REQUIRE_ALIASES = {
  'push-sat':  'push-sat',
  'aerobrake': 'aerobrake-shroud',
  'crew':      'crew-quarters',
  'sail':      'sail',
  'pulse':     'pulse-generator',
  'isru':      'isru-rig',
  'beam':      'beam-receiver',
  'spin-grav': 'spin-grav',
  'thermo':    'thermostat',
};

// Spectral types per HF4 convention: C (carbonaceous), S
// (silicate), M (metallic), V (basaltic/volcanic), B (alkaline),
// D (icy/cometary). Defaulted to 'C' if the card doesn't carry
// one explicitly. Used to render the small spectral hex on every
// card; later (Stage 3+) the engine can require / reward
// matching site spectral types when building or refuelling.
const SPECTRAL_DEFAULT = 'C';

// Support icons that may appear in the bottom-right of a thruster
// card (and a few non-thrusters). One-letter / short codes;
// card-ui.js maps each to a glyph + label.
//   'push-sat'   -> 🛰 satellite carrier
//   'aerobrake'  -> 🪂 atmospheric entry
//   'lab-bonus'  -> 🧪 lab science boost
//   'crew'       -> 👤 carries crew quarters
//   'spin-grav'  -> 🌀 spin gravity capable
//   'beam'       -> ☀ beam-pushed
//   'pulse'      -> ⚡ pulse propulsion
//   'sail'       -> ⛵ light/magnetic sail
//   'isru'       -> 🛢 in-situ propellant
// `supports` lives directly on the card; default is empty.
//
// Both shapes are accepted at decoration time:
//   supports: ['push-sat', 'pulse']
//   requires: [{ kind: 'pulse-generator', count: 1 }]
// The decoration pass below normalises both into a single
// `requires` array of { kind, count } records.

const RAD_HARDNESS_BY_TYPE = {
  thruster:  2,
  reactor:   3,
  radiator:  1,
  refinery:  2,
  robonaut:  2,
  generator: 1,
  lab:       1,
  modifier:  2,
};

// Radiators flip rotated 180° (the published cards show a
// "stowed" face that reads upside-down when installed). Everything
// else flips with the same orientation as the front.
const ROTATED_TYPES = new Set(['radiator']);

// Decorate every patent with the new schema fields lazily so we
// don't have to repeat them on each record. Faces are minimal --
// the secondary face is the "installed / black" side and carries
// the same numbers by default; component-specific overrides go
// straight on the patent record (modifier, flippedMass, etc.).
for (const p of PATENTS) {
  if (!('radHardness' in p)) p.radHardness = RAD_HARDNESS_BY_TYPE[p.type] ?? 1;
  if (!p.spectralType) p.spectralType = SPECTRAL_DEFAULT;
  // Normalise supports/requires into a single requires array of
  // { kind, count } records. A bare `supports` string is taken to
  // mean count=1 of the corresponding kind.
  if (!p.requires) {
    const fromSupports = Array.isArray(p.supports)
      ? p.supports.map((s) => ({ kind: REQUIRE_ALIASES[s] || s, count: 1 }))
      : [];
    p.requires = fromSupports;
  } else {
    p.requires = p.requires.map((r) => (typeof r === 'string'
      ? { kind: REQUIRE_ALIASES[r] || r, count: 1 }
      : { kind: REQUIRE_ALIASES[r.kind] || r.kind, count: r.count || 1 }));
  }
  delete p.supports;
  if (!p.flipOrientation) {
    p.flipOrientation = ROTATED_TYPES.has(p.type) ? 'rotated180' : 'standard';
  }
  if (!p.faces) {
    p.faces = {
      primary: { label: 'Stowed', blurb: p.blurb },
      secondary: { label: 'Installed', blurb: 'Installed face — black side.' },
    };
  }
}

export const PATENTS_BY_ID = Object.fromEntries(PATENTS.map((p) => [p.id, p]));

export function patentsByType(type) {
  return PATENTS.filter((p) => p.type === type);
}

export const PATENT_TYPES = [
  'thruster', 'reactor', 'radiator', 'refinery', 'robonaut',
  'generator', 'lab', 'modifier',
];
