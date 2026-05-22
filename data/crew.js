// Crew deck. Each physical card carries two FUNCTIONALLY
// INDEPENDENT crew on the two faces -- pick either by flipping.
// The two faces share a card body but not stats. Each face is a
// full crew record with their own role, mass, rad hardness, and
// special flavour.
//
// All names + roles are original to this implementation; they're
// designed to feel like a typical space-corp roster without
// transcribing anything from the published card list. Stats are
// my own balance choices; the engine will treat radHardness +
// roleBonus the same regardless of which crew you actually run.

export const CREW = [
  {
    id: 'crew_pioneers',
    faces: {
      primary:   { name: 'Vega Holst',     role: 'Pilot',      mass: 1, radHardness: 2, bonus: '+1 to MOVE',      blurb: 'Ex-orbital corps; nerves of tungsten.' },
      secondary: { name: 'Idris Okonkwo',  role: 'Engineer',   mass: 1, radHardness: 2, bonus: '+1 to BUILD',     blurb: 'Patents three thrusters; can repair anything with a soldering iron.' },
    },
  },
  {
    id: 'crew_xenobio',
    faces: {
      primary:   { name: 'Asla Bergmann',  role: 'Xenobiologist', mass: 1, radHardness: 1, bonus: 'Astrobiology auto-success', blurb: 'Hunts for hydrothermal life on icy moons.' },
      secondary: { name: 'Dr. Mateo Cruz', role: 'Medic',         mass: 1, radHardness: 2, bonus: 'Heal one hazard per round', blurb: 'Microgravity surgeon; carries the kit nobody admits they need.' },
    },
  },
  {
    id: 'crew_metallurgy',
    faces: {
      primary:   { name: 'Pilar Romero',   role: 'Metallurgist', mass: 1, radHardness: 2, bonus: '+1 VP at Psyche / Vesta', blurb: 'Refines anything from M-type slag.' },
      secondary: { name: 'Kestrel Mhlanga', role: 'Geophysicist', mass: 1, radHardness: 1, bonus: '+1 die to PROSPECT', blurb: 'Reads seismic charts like sheet music.' },
    },
  },
  {
    id: 'crew_command',
    faces: {
      primary:   { name: 'Cmdr. Yamazaki', role: 'Mission Commander', mass: 2, radHardness: 3, bonus: '+1 op per round', blurb: 'Veteran of the first Mars push.' },
      secondary: { name: 'Comms Officer Vaeli', role: 'Signals',     mass: 1, radHardness: 2, bonus: 'Free hand reset', blurb: 'Maintains the relay network even at Pluto delay.' },
    },
  },
  {
    id: 'crew_ops',
    faces: {
      primary:   { name: 'Lieut. Ramos',   role: 'Logistician', mass: 1, radHardness: 2, bonus: '+1 water income', blurb: 'Knows which bay actually has spare hydrogen.' },
      secondary: { name: 'Janitor Nyx',    role: 'Quartermaster', mass: 1, radHardness: 2, bonus: 'Reroll a failed PROSPECT', blurb: 'Keeps the airlock clean and the ledger cleaner.' },
    },
  },
  {
    id: 'crew_civilian',
    faces: {
      primary:   { name: 'Pilgrim Adler',  role: 'Settler',  mass: 1, radHardness: 0, bonus: 'Bernal seeds count +1', blurb: 'First boots-on-soil for a new habitat.' },
      secondary: { name: 'Botanist Linh',  role: 'Botanist', mass: 1, radHardness: 1, bonus: 'Hydration +1 at lander sites', blurb: 'Closed-loop greenhouse expertise.' },
    },
  },
  {
    id: 'crew_research',
    faces: {
      primary:   { name: 'Dr. Sólveig',    role: 'Physicist',   mass: 1, radHardness: 1, bonus: '+1 lab science',         blurb: 'Wrote the textbook on antimatter catalysts.' },
      secondary: { name: 'Dr. Owusu',      role: 'AI Operator', mass: 1, radHardness: 2, bonus: 'Robonauts act twice',   blurb: 'Whispers Latin to the swarm at midnight.' },
    },
  },
  {
    id: 'crew_outsider',
    faces: {
      primary:   { name: 'Veteran Quill',  role: 'Salvager',  mass: 1, radHardness: 3, bonus: 'Decommission for full value', blurb: 'Knows which derelicts still have working batteries.' },
      secondary: { name: 'Cartographer M.', role: 'Surveyor',  mass: 1, radHardness: 2, bonus: 'See one extra hop on MOVE',   blurb: 'Plots burns like origami.' },
    },
  },
];

export const CREW_BY_ID = Object.fromEntries(CREW.map((c) => [c.id, c]));
