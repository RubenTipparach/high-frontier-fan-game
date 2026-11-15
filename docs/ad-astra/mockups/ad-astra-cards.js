// HIGH FRONTIER: AD ASTRA - MOCKUP card data (placeholder numbers).
//
// NOT game data. Rulebook open question Z4 decides where real Ad Astra card
// stats live (a spreadsheet tab, per the house rule, or a variant data file).
// Until then these records exist only so the mockups can draw cards with the
// ORIGINAL renderer (js/game/card-ui.js#renderCard), in the HF card model.
//
// White face = Voyage tech (AA-B1). Black face = Landfall tech (AA-H6).
// Drives use the HF4 'gw-thruster' type: the gold TW wedge on the table.

const face = (o) => ({ label: 'Tier 1', ability: null, future: null, requires: [], supplies: [], properties: [], ...o });

export const AA_DRIVES = [
  {
    id: 'aa_medusa', name: 'Solem Medusa Spinnaker', type: 'gw-thruster',
    spectralType: 'M', mass: 3, radHardness: 8, thrust: 2, fuel: 2, afterburn: 0,
    fuelType: 'Pulse',
    requires: [{ kind: 'gen-electric', count: 1 }],
    blurb: 'The nuclear parachute. Bombs burst between ship and canopy; the canopy tows you. Turn it forward to brake.',
    faces: {
      primary: face({ name: 'Solem Medusa Spinnaker', mass: 3, radHardness: 8, thrust: 2, fuel: 2, fuelType: 'Pulse',
        requires: [{ kind: 'gen-electric', count: 1 }],
        blurb: 'The nuclear parachute. Bombs burst between ship and canopy; the canopy tows you. Turn it forward to brake.' }),
      secondary: face({ label: 'Landfall', name: 'Canopy Mirror', mass: 2, radHardness: 6,
        blurb: 'The spent canopy, re-silvered: an orbital mirror that warms a cold world (Terraform: Mirror).' }),
    },
  },
  {
    id: 'aa_daedalus', name: 'Daedalus Pellet Fusion', type: 'gw-thruster',
    spectralType: 'S', mass: 4, radHardness: 7, thrust: 3, fuel: 2, afterburn: 0,
    fuelType: 'Fusion',
    requires: [{ kind: 'gen-electric', count: 1 }, { kind: 'thermostat', count: 1 }],
    blurb: 'He-3 and deuterium pellets lit by electron beams, 250 times a second. Built for a flyby.',
    faces: {
      primary: face({ name: 'Daedalus Pellet Fusion', mass: 4, radHardness: 7, thrust: 3, fuel: 2, fuelType: 'Fusion',
        requires: [{ kind: 'gen-electric', count: 1 }, { kind: 'thermostat', count: 1 }],
        blurb: 'He-3 and deuterium pellets lit by electron beams, 250 times a second. Built for a flyby.' }),
      secondary: face({ label: 'Landfall', name: 'Fusion Torch Lander', mass: 3, radHardness: 7,
        blurb: 'The reaction chamber, rebuilt small: lands and lifts cargo between moons.' }),
    },
  },
  {
    id: 'aa_starwisp', name: 'Starwisp Maser Sail', type: 'gw-thruster',
    spectralType: 'C', mass: 0, radHardness: 2, thrust: 2, fuel: 0, afterburn: 0,
    fuelType: 'Beam',
    properties: [{ key: 'push', glyph: '🛰', label: 'Beam-pushed', value: true }],
    blurb: 'A carbon mesh a kilometre wide and grams in mass, ridden on a maser beam from Sol. Cannot stop.',
    faces: {
      primary: face({ name: 'Starwisp Maser Sail', mass: 0, radHardness: 2, thrust: 2, fuel: 0, fuelType: 'Beam',
        properties: [{ key: 'push', glyph: '🛰', label: 'Beam-pushed', value: true }],
        blurb: 'A carbon mesh a kilometre wide and grams in mass, ridden on a maser beam from Sol. Cannot stop.' }),
      secondary: face({ label: 'Landfall', name: 'Rectenna Field', mass: 1, radHardness: 3,
        blurb: 'Unrolled on the ground: catches beamed power for a colony.' }),
    },
  },
  {
    id: 'aa_bussard', name: 'Bussard Ramscoop', type: 'gw-thruster',
    spectralType: 'H', mass: 5, radHardness: 6, thrust: 2, fuel: 0, afterburn: 0,
    fuelType: 'Ramscoop',
    requires: [{ kind: 'reactor-fusion', count: 1 }],
    blurb: 'A magnetic funnel thousands of km wide swallows interstellar hydrogen. Needs V2 to light.',
    faces: {
      primary: face({ name: 'Bussard Ramscoop', mass: 5, radHardness: 6, thrust: 2, fuel: 0, fuelType: 'Ramscoop',
        requires: [{ kind: 'reactor-fusion', count: 1 }],
        blurb: 'A magnetic funnel thousands of km wide swallows interstellar hydrogen. Needs V2 to light.' }),
      secondary: face({ label: 'Landfall', name: 'Atmosphere Scoop', mass: 3, radHardness: 6,
        blurb: 'Skims a gas giant to pour volatiles onto a dry world (Terraform: Atmosphere).' }),
    },
  },
];

export const AA_SHIP = {
  generator: {
    id: 'aa_gen_winch', name: 'Canopy Winch Dynamo', type: 'generator',
    spectralType: 'M', mass: 1, radHardness: 6, supplies: ['gen-electric'],
    blurb: 'Reels the ship up the shroud lines between pulses and banks the power.',
  },
  payload: {
    id: 'aa_cryo', name: 'Cryo Vault', type: 'freighter',
    spectralType: 'C', mass: 2, radHardness: 4,
    blurb: 'Two thousand sleepers, thawed in shifts to repair radiation damage. Population 2.',
    faces: {
      primary: face({ name: 'Cryo Vault', mass: 2, radHardness: 4,
        blurb: 'Two thousand sleepers, thawed in shifts to repair radiation damage. Population 2.' }),
      secondary: face({ label: 'Landfall', name: 'Biosphere Bank', mass: 1, radHardness: 4,
        blurb: 'Frozen seeds, spores and gut flora for a whole ecology (Terraform: Biosphere).' }),
    },
  },
  prospector: {
    id: 'aa_lidar', name: 'Flyby Lidar Raygun', type: 'robonaut',
    spectralType: 'S', mass: 1, radHardness: 5,
    properties: [{ key: 'raygun', glyph: '🔫', label: 'Raygun', value: true }, { key: 'isru', glyph: '🛢', label: 'ISRU rig', value: 2 }],
    blurb: 'Scans a whole system in the hours of a flyby.',
    faces: {
      primary: face({ name: 'Flyby Lidar Raygun', mass: 1, radHardness: 5,
        properties: [{ key: 'raygun', glyph: '🔫', label: 'Raygun', value: true }, { key: 'isru', glyph: '🛢', label: 'ISRU rig', value: 2 }],
        blurb: 'Scans a whole system in the hours of a flyby.' }),
      secondary: face({ label: 'Landfall', name: 'Survey Rover', mass: 1, radHardness: 5,
        blurb: 'Rolls the regolith for ore and ice.' }),
    },
  },
  seed: {
    id: 'aa_seed', name: 'Von Neumann Seed', type: 'refinery',
    spectralType: 'V', mass: 1, radHardness: 3,
    blurb: 'A fist of grey goo that builds a factory out of a rock, then builds another. Keep a human near it.',
    faces: {
      primary: face({ name: 'Von Neumann Seed', mass: 1, radHardness: 3,
        blurb: 'A fist of grey goo that builds a factory out of a rock, then builds another. Keep a human near it.' }),
      secondary: face({ label: 'Landfall', name: 'Replicator Swarm', mass: 0, radHardness: 3,
        blurb: 'Doubles every generation, up to the size of the site.' }),
    },
  },
};
