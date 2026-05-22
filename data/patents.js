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
//                 robonaut  | generator | lab
//   mass          wet mass added to the ship stack
//   power_req     power units this component consumes per burn (0 = self-powered)
//   blurb         one-line flavor
//
// Thruster-specific:
//   thrust        max wet-mass it can push in one burn (so a ship
//                 with stack mass M needs thrust >= M to MOVE)
//   isp           burns per fuel unit. Higher = more efficient
//                 (ion = 10, chemical = 2). Drives water consumption
//                 in MOVE.
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
  { id: 't_chemsust',   name: 'Chemical Sustainer',    type: 'thruster', mass: 2, thrust: 8,  isp: 2,  power_req: 0, blurb: 'LOX/methane workhorse. Burns fast, hauls a lot.' },
  { id: 't_chemtug',    name: 'Hydrazine Tug',         type: 'thruster', mass: 1, thrust: 5,  isp: 2,  power_req: 0, blurb: 'Storable monoprop. Cheap, reliable.' },
  { id: 't_solidkick',  name: 'Solid Kick Stage',      type: 'thruster', mass: 1, thrust: 10, isp: 1,  power_req: 0, blurb: 'One-shot motor for hard insertions.' },
  { id: 't_resistojet', name: 'Resistojet',            type: 'thruster', mass: 1, thrust: 2,  isp: 4,  power_req: 1, blurb: 'Electrically heated water. Slow but tidy.' },
  { id: 't_arcjet',     name: 'Arcjet',                type: 'thruster', mass: 1, thrust: 3,  isp: 5,  power_req: 2, blurb: 'Arc-heated propellant; needs juice.' },

  // ===== Thrusters: electric / ion (efficient, low thrust) =====
  { id: 't_iondrive',   name: 'Gridded Ion Drive',     type: 'thruster', mass: 1, thrust: 1,  isp: 10, power_req: 3, blurb: 'Pencil-thin thrust, glacial accelerations.' },
  { id: 't_hall',       name: 'Hall-Effect Thruster',  type: 'thruster', mass: 1, thrust: 2,  isp: 8,  power_req: 2, blurb: 'Solid workhorse for station tugs.' },
  { id: 't_mpd',        name: 'Magnetoplasmadynamic',  type: 'thruster', mass: 2, thrust: 3,  isp: 7,  power_req: 4, blurb: 'Lorentz-force accelerated plasma.' },
  { id: 't_vasimr',     name: 'VASIMR Engine',         type: 'thruster', mass: 2, thrust: 4,  isp: 8,  power_req: 4, blurb: 'Variable specific impulse, mode-switchable.' },
  { id: 't_pit',        name: 'Pulsed Inductive',      type: 'thruster', mass: 2, thrust: 3,  isp: 6,  power_req: 3, blurb: 'Capacitor-banked plasma rings.' },

  // ===== Thrusters: nuclear thermal =====
  { id: 't_nerva',      name: 'Nuclear Thermal',       type: 'thruster', mass: 3, thrust: 6,  isp: 4,  power_req: 0, blurb: 'Solid-core fission heater. NERVA heritage.' },
  { id: 't_lightbulb',  name: 'Gas-Core Nuclear',      type: 'thruster', mass: 3, thrust: 7,  isp: 6,  power_req: 0, blurb: 'Light-bulb topology: hot uranium, cool walls.' },
  { id: 't_saltwater',  name: 'Nuclear Salt-Water',    type: 'thruster', mass: 2, thrust: 9,  isp: 7,  power_req: 0, blurb: 'Continuous open-cycle fission. Mad and effective.' },
  { id: 't_fragment',   name: 'Fission Fragment',      type: 'thruster', mass: 3, thrust: 4,  isp: 9,  power_req: 1, blurb: 'Fission products as their own exhaust.' },

  // ===== Thrusters: fusion =====
  { id: 't_zpinch',     name: 'Z-Pinch Fusion',        type: 'thruster', mass: 4, thrust: 6,  isp: 8,  power_req: 2, blurb: 'Self-pinched plasma column. Loud.' },
  { id: 't_dpfusion',   name: 'D-He3 Fusion Drive',    type: 'thruster', mass: 4, thrust: 5,  isp: 11, power_req: 3, blurb: 'Aneutronic fuel. Needs Saturn-grade He3.' },
  { id: 't_icftorch',   name: 'ICF Torch Drive',       type: 'thruster', mass: 5, thrust: 8,  isp: 10, power_req: 4, blurb: 'Inertial confinement. Pulsed brilliance.' },
  { id: 't_orion',      name: 'Pulse Propulsion',      type: 'thruster', mass: 5, thrust: 12, isp: 6,  power_req: 0, blurb: 'External nuclear pulse. Pusher plate optional.' },

  // ===== Thrusters: sails / beam =====
  { id: 't_solarsail',  name: 'Solar Sail',            type: 'thruster', mass: 1, thrust: 1,  isp: 99, power_req: 0, blurb: 'Free fuel in the inner system. Useless past Mars.' },
  { id: 't_magsail',    name: 'Magnetic Sail',         type: 'thruster', mass: 2, thrust: 1,  isp: 99, power_req: 2, blurb: 'Rides the solar wind. Works further out.' },
  { id: 't_lasersail',  name: 'Laser-Pushed Sail',     type: 'thruster', mass: 1, thrust: 3,  isp: 99, power_req: 0, blurb: 'Needs a friendly laser station. Worth the trip.' },
  { id: 't_tether',     name: 'Electrodynamic Tether', type: 'thruster', mass: 1, thrust: 2,  isp: 99, power_req: 1, blurb: 'Lorentz reboost in any magnetosphere.' },

  // ===== Thrusters: aerobrake / atmospheric =====
  { id: 't_aerobrake',  name: 'Aerobrake Shroud',      type: 'thruster', mass: 2, thrust: 6,  isp: 99, power_req: 0, blurb: 'One-trick pony: only works on atmospheric arrivals.' },
  { id: 't_massdriver', name: 'Mass-Driver Catapult',  type: 'thruster', mass: 4, thrust: 15, isp: 1,  power_req: 6, blurb: 'Site-bound launcher. Brutal acceleration.' },

  // ===== Reactors =====
  { id: 'r_solar_s',    name: 'Solar Panel (small)',   type: 'reactor', mass: 1, power: 2, heat: 1, blurb: 'Inner-system only; output halved past Mars.' },
  { id: 'r_solar_l',    name: 'Solar Array',           type: 'reactor', mass: 2, power: 4, heat: 1, blurb: 'Full-spectrum collector. Bulky.' },
  { id: 'r_concentrator',name:'Concentrating Mirror',  type: 'reactor', mass: 1, power: 3, heat: 2, blurb: 'Focused sunlight on a tiny absorber.' },
  { id: 'r_rtg',        name: 'Plutonium RTG',         type: 'reactor', mass: 1, power: 1, heat: 1, blurb: 'Decay heat. Endless, anemic.' },
  { id: 'r_fission_s',  name: 'Compact Fission Pile',  type: 'reactor', mass: 2, power: 4, heat: 3, blurb: 'Kilopower-class reactor.' },
  { id: 'r_fission_l',  name: 'Gen-IV Fission',        type: 'reactor', mass: 3, power: 7, heat: 5, blurb: 'Closed-cycle, breeding-capable.' },
  { id: 'r_molten',     name: 'Molten-Salt Reactor',   type: 'reactor', mass: 3, power: 8, heat: 5, blurb: 'High-temp, walks away from prompt-critical.' },
  { id: 'r_tokamak',    name: 'Tokamak (D-T)',         type: 'reactor', mass: 4, power: 10, heat: 8, blurb: 'Tritium burner. Needs lithium blanket.' },
  { id: 'r_stellarator',name: 'Stellarator',           type: 'reactor', mass: 4, power: 11, heat: 8, blurb: 'Steady-state magnetic confinement.' },
  { id: 'r_polywell',   name: 'Polywell',              type: 'reactor', mass: 3, power: 9, heat: 6, blurb: 'Magnetic-grid inertial confinement.' },

  // ===== Radiators =====
  { id: 'h_pumped',     name: 'Pumped-Loop Radiator',  type: 'radiator', mass: 1, heat_cap: 3, blurb: 'Liquid-metal sweeper, off-the-shelf.' },
  { id: 'h_droplet',    name: 'Liquid Droplet Array',  type: 'radiator', mass: 1, heat_cap: 5, blurb: 'Spray a sheet of droplets; catch them downstream.' },
  { id: 'h_bubble',     name: 'Bubble-Membrane Radiator', type: 'radiator', mass: 2, heat_cap: 8, blurb: 'Foamed dome of vacuum-stable membrane.' },
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
const RAD_HARDNESS_BY_TYPE = {
  thruster:  2,
  reactor:   3,
  radiator:  1,
  refinery:  2,
  robonaut:  2,
  generator: 1,
  lab:       1,
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
  'thruster', 'reactor', 'radiator', 'refinery', 'robonaut', 'generator', 'lab',
];
