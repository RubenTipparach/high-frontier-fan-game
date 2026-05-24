// Crew deck. Each physical card carries TWO functionally
// independent crew on its two faces (primary + secondary).
//
// AUTO-GENERATED from reference/HF4-card-data.xlsx's
// Colonists sheet via scripts/extract-crew-data.py. Each
// pair of rows in the sheet is one physical card; the
// primary row carries name+type+specialty+mass+rad, the
// secondary row often carries an ability text plus its
// own mass+rad (and inherits type+specialty from the pair).
//
// The Promotion Colony + Ideology columns are reference
// data only - crew promotion is part of the expansion and
// is NEVER used in this variant (industrialize.md
// 'Colonies are tokens, not cards'). They are not emitted.
//
// Re-run the extractor when the spreadsheet changes:
//   python3 scripts/extract-crew-data.py

export const CREW = [
  {
    id: 'crew_babbage_halbonauts',
    faces: {
      primary:   { name: 'Babbage Halbonauts', type: 'Robot', role: 'Engineer', mass: 2, radHardness: 5 },
      secondary: { name: 'Utility Fog Halbonaut', type: 'Robot', role: 'Engineer', mass: 2, radHardness: 5, ability: 'All of your stacks are Glitch-free.' },
    },
  },
  {
    id: 'crew_biomechs',
    faces: {
      primary:   { name: 'Biomechs', type: 'Human', role: 'Miner', mass: 2, radHardness: 4 },
      secondary: { name: 'Group Mind Immortalists', type: 'Human', role: 'Miner', mass: 2, radHardness: 5, ability: 'May perform the faction privileges on both sides of your Crew card.' },
    },
  },
  {
    id: 'crew_botany_bay_convicts',
    faces: {
      primary:   { name: 'Botany Bay Convicts', type: 'Human', role: 'Miner', mass: 2, radHardness: 4 },
      secondary: { name: 'Soldier Caste', type: 'Human', role: 'Miner', mass: 2, radHardness: 9, ability: 'All your Humans can commit Felonies, even if defending Humans are present.' },
    },
  },
  {
    id: 'crew_boyle_engineering_collective',
    faces: {
      primary:   { name: 'Boyle Engineering Collective', type: 'Human', role: 'Prospector', mass: 3, radHardness: 5 },
      secondary: { name: 'Martian Assembly', type: 'Human', role: 'Prospector', mass: 3, radHardness: 6, ability: 'Acts as a Freighter when building a Space Elevator.' },
    },
  },
  {
    id: 'crew_calypso_2_seed_sail',
    faces: {
      primary:   { name: 'Calypso 2 Seed Sail', type: 'Human', role: 'Prospector', mass: 1, radHardness: 3, ability: "Can't enter aerobrakes." },
      secondary: { name: 'Wet-Nano Seed Sail', type: 'Human', role: 'Prospector', mass: 1, radHardness: 5, ability: "-2 to Colocated size rolls on Synodic Comets. Can't enter aerobrakes." },
    },
  },
  {
    id: 'crew_heavy_water_survivalists',
    faces: {
      primary:   { name: 'Heavy Water Survivalists', type: 'Human', role: 'Engineer', mass: 2, radHardness: 5 },
      secondary: { name: 'New Attica Secessionists', type: 'Human', role: 'Engineer', mass: 2, radHardness: 6, ability: 'Boost costs are doubled for all your opponents.' },
    },
  },
  {
    id: 'crew_house_of_saud',
    faces: {
      primary:   { name: 'House of Saud', type: 'Human', role: 'Miner', mass: 2, radHardness: 3 },
      secondary: { name: 'Iceworms', type: 'Human', role: 'Miner', mass: 2, radHardness: 4, ability: 'Performs epic hazard operation as a free action, & is not Decommissioned if it fails.' },
    },
  },
  {
    id: 'crew_juiced_cosmonauts',
    faces: {
      primary:   { name: 'Juiced Cosmonauts', type: 'Human', role: 'Prospector', mass: 1, radHardness: 4 },
      secondary: { name: 'Rental Body Guild', type: 'Human', role: 'Prospector', mass: 1, radHardness: 6, ability: '-1 to Colocated size rolls.' },
    },
  },
  {
    id: 'crew_lloyd_s_salvage_co',
    faces: {
      primary:   { name: "Lloyd's Salvage Co.", type: 'Human', role: 'Industrialist', mass: 1, radHardness: 5 },
      secondary: { name: 'Svalbard Caretakers', type: 'Human', role: 'Industrialist', mass: 1, radHardness: 6, ability: '-1 on all size rolls when prospecting Synodic Sites.' },
    },
  },
  {
    id: 'crew_malcolm',
    faces: {
      primary:   { name: 'Malcolm', type: 'Human', role: 'Industrialist', mass: 1, radHardness: 3 },
      secondary: { name: 'Renaissance Man', type: 'Human', role: 'Industrialist', mass: 1, radHardness: 4, ability: 'If initiating a research auction, can search through one patent deck and choose the card to be auctioned.' },
    },
  },
  {
    id: 'crew_microgravity_pantrophists',
    faces: {
      primary:   { name: 'Microgravity Pantrophists', type: 'Human', role: 'Engineer', mass: 3, radHardness: 5 },
      secondary: { name: 'Blue Goo Sybonts', type: 'Human', role: 'Engineer', mass: 3, radHardness: 6, ability: 'Can produce ET products of Spectral Type C at any Factory.' },
    },
  },
  {
    id: 'crew_programmable_matter',
    faces: {
      primary:   { name: 'Programmable Matter', type: 'Robot', role: 'Prospector', mass: 1, radHardness: 4 },
      secondary: { name: 'Neumann Matter', type: 'Robot', role: 'Prospector', mass: 1, radHardness: 5, ability: 'All of your stacks are Glitch-free.' },
    },
  },
  {
    id: 'crew_rock_rats_miners_union',
    faces: {
      primary:   { name: "Rock Rats Miners' Union", type: 'Human', role: 'Miner', mass: 3, radHardness: 5 },
      secondary: { name: 'Alchemist Aviatrices', type: 'Human', role: 'Miner', mass: 3, radHardness: 6, ability: 'During Factory Refuel, double the amount of isotope fuel.' },
    },
  },
  {
    id: 'crew_security_system',
    faces: {
      primary:   { name: 'Security System', type: 'Robot', role: 'Industrialist', mass: 1, radHardness: 4 },
      secondary: { name: 'Frankenstein Navigator', type: 'Robot', role: 'Industrialist', mass: 1, radHardness: 5, ability: 'FINAO costs are halved (drop fractions).' },
    },
  },
  {
    id: 'crew_siren_cybernautics_inc',
    faces: {
      primary:   { name: 'Siren Cybernautics Inc.', type: 'Human', role: 'Engineer', mass: 3, radHardness: 5 },
      secondary: { name: 'Josephson Implants', type: 'Human', role: 'Engineer', mass: 3, radHardness: 6, ability: 'FINAO costs are halved (drop fractions).' },
    },
  },
  {
    id: 'crew_smart_pets',
    faces: {
      primary:   { name: 'Smart Pets', type: 'Robot', role: 'Miner', mass: 0, radHardness: 3 },
      secondary: { name: 'Creeper Neogen', type: 'Robot', role: 'Miner', mass: 0, radHardness: 6, ability: 'All of your stacks are Glitch-free.' },
    },
  },
  {
    id: 'crew_transorbital_railworkers',
    faces: {
      primary:   { name: 'Transorbital Railworkers', type: 'Human', role: 'Engineer', mass: 2, radHardness: 4 },
      secondary: { name: 'Kaluga Naniteers', type: 'Human', role: 'Engineer', mass: 2, radHardness: 5, ability: 'Your Aqua from a Free Market is doubled.' },
    },
  },
  {
    id: 'crew_vatican_observers',
    faces: {
      primary:   { name: 'Vatican Observers', type: 'Human', role: 'Industrialist', mass: 1, radHardness: 4 },
      secondary: { name: 'Eugenic Pilgrims', type: 'Human', role: 'Industrialist', mass: 1, radHardness: 5, ability: 'Faction privilege not lost in Anarchy. -1 to Colocated size rolls on Synodic Comets.' },
    },
  },
];

export const CREW_BY_ID = Object.fromEntries(CREW.map((c) => [c.id, c]));
