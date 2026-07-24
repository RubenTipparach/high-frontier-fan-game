// Crew deck - the published HF4 player-faction cards. Each
// physical card is double-sided and carries TWO factions, one
// per face. At game start the player picks ONE faction face
// (the starting-crew wizard); that faction's privilege is the
// player's edge for the game.
//
// Source: the card images at https://www.hf4map.com/cards/crew/
// (card0..card5, front + back), transcribed directly. NOTE:
// this is the CREW deck - distinct from the Colonists deck (a
// separate set of cards). Crews have NO spectral type.
//
// data/crew-stats.json is the matching human-audit file; keep
// the two in sync (no generator - crew isn't in the spreadsheet).
//
// Face shape (consumed by the crew renderer in
// js/game/card-ui.js + the starting-crew wizard):
//   name         faction name
//   role         short descriptor (the promotion letter (X))
//   bonus        privilege short title
//   blurb        privilege effect text
//   mass, radHardness
//   isru         ISRU rating (4 on every crew)
//
// Each physical card also carries a `color` - the faction band
// colour sampled straight off the printed card (gold / purple /
// silver / mint / crimson / gray). Both faces of a physical card
// share it (it is that player-colour slot). Picking a faction
// will set the player's colour to this in a future update; for
// now it just tints the crew card in the library.
//   prospector   'buggy' | 'raygun' (the top-left icon)
//   thruster     the thrust triangle, or null (Shimizu lander):
//     { name, thrustMN, specImpKs,   // real-rocket flavour
//       thrust,        // magenta circle - game thrust
//       fuelPerBurn,   // blue circle - FT consumed per burn
//       afterburn,     // orange triangle - OPTIONAL (null when
//                      //   the card shows no orange triangle)
//       dirt }         // true for a dirt thruster (gray
//                      //   triangle: NASRDA / Norse)

export const CREW = [
  {
    id: 'crew_un_b612',
    color: '#fccc00',
    faces: {
      primary:   { name: 'United Nations Cosmonauts', role: 'Faction A', bonus: 'SECRETARY GENERAL', blurb: 'Start with +2 Aqua. (Module 2: after 1st anchor of your Home Bernal.)', mass: 1, radHardness: 4, isru: 4, prospector: 'buggy',  thruster: { name: 'Liberty',   thrustMN: 1.34, specImpKs: 0.43, thrust: 12, fuelPerBurn: 9,  afterburn: 2 } },
      secondary: { name: 'B612 Foundation',           role: 'Faction H', bonus: 'BLINK TELESCOPE',   blurb: '1 re-roll per prospecting operation when using a Raygun.',        mass: 1, radHardness: 3, isru: 4, prospector: 'raygun', thruster: { name: 'New Glenn', thrustMN: 17.1, specImpKs: 0.39, thrust: 15, fuelPerBurn: 10, afterburn: 2 } },
    },
  },
  {
    id: 'crew_roscosmos_taikonauts',
    color: '#c09cc0',
    faces: {
      primary:   { name: 'Roscosmos',  role: 'Faction B', bonus: 'TAXES',     blurb: '+1 Aqua from the Pool after any player places a Claim or industrializes a Claim.', mass: 1, radHardness: 5, isru: 4, prospector: 'buggy',  thruster: { name: 'Angara 5',        thrustMN: 13.4, specImpKs: 0.38, thrust: 15, fuelPerBurn: 10, afterburn: 2 } },
      secondary: { name: 'Taikonauts', role: 'Faction C', bonus: 'FELONIOUS', blurb: 'Your Humans may perform Felonious actions. Negotiable.',                          mass: 1, radHardness: 4, isru: 4, prospector: 'raygun', thruster: { name: 'The Long March 9', thrustMN: 8.27, specImpKs: 0.43, thrust: 14, fuelPerBurn: 9,  afterburn: 2 } },
    },
  },
  {
    id: 'crew_nasa_isro',
    color: '#e3e0d4',
    faces: {
      primary:   { name: 'NASA Astronauts',     role: 'Faction D', bonus: 'LAUNCH FEES',   blurb: '+1 Aqua from the Pool after any player performs a boost operation.',                                  mass: 1, radHardness: 4, isru: 4, prospector: 'raygun', thruster: { name: 'SLS, 130t Block II Crew', thrustMN: 7.44, specImpKs: 0.45, thrust: 14, fuelPerBurn: 8,  afterburn: 2 } },
      secondary: { name: 'ISRO Glavcosmonauts', role: 'Faction G', bonus: 'DHARMA REFUEL', blurb: 'If any of your Humans carry a glory chit, double yield from a Colocated site refuel operation.', mass: 1, radHardness: 4, isru: 4, prospector: 'buggy',  thruster: { name: 'GSLV MkIII (Vikas)',     thrustMN: 0.80, specImpKs: 0.27, thrust: 11, fuelPerBurn: 14, afterburn: 2 } },
    },
  },
  {
    id: 'crew_anonp2p_esa',
    color: '#a8d8c0',
    faces: {
      primary:   { name: 'Anonymous P2P',       role: 'Faction E', bonus: 'OPEN SOURCE FINAO', blurb: 'Failure Is Not An Option costs 3 Aqua.',                                                                                  mass: 1, radHardness: 4, isru: 4, prospector: 'buggy',  thruster: { name: 'Skylon',    thrustMN: 5.88, specImpKs: 0.46, thrust: 14, fuelPerBurn: 8, afterburn: 2 } },
      secondary: { name: 'ESA Space Unionists', role: 'Faction F', bonus: 'POWERSAT',          blurb: 'During any player\'s Turn, may give +1 thrust to any Spacecraft that has a push icon in its thruster triangle. Negotiable.', mass: 1, radHardness: 4, isru: 4, prospector: 'raygun', thruster: { name: 'Ariane 64', thrustMN: 1.37, specImpKs: 0.45, thrust: 12, fuelPerBurn: 8, afterburn: 2 } },
    },
  },
  {
    id: 'crew_shimizu_nasrda',
    color: '#b40054',
    faces: {
      primary:   { name: 'Shimizu Corp Entrepreneurs', role: 'Faction M', bonus: 'SKUNKWORKS', blurb: 'Ignore academia hand limit when bidding or starting an auction.', mass: 1, radHardness: 3, isru: 4, prospector: 'buggy',  thruster: null },
      secondary: { name: 'NASRDA Astronauts',          role: 'Faction L', bonus: 'MOONCABLE',  blurb: 'Free action 1/turn at LEO/Home Bernal: refuel an active dirt thruster (7 tanks, or 1 if a Crew thruster). Negotiable. Only 1 dirt tank refuel per turn.', mass: 1, radHardness: 4, isru: 4, prospector: 'raygun', thruster: { name: 'Pegasus XL', thrustMN: 0.074, specImpKs: 0.37, thrust: 7, fuelPerBurn: 11, afterburn: null, dirt: true } },
    },
  },
  {
    id: 'crew_spacex_norse',
    color: '#9c9c9c',
    faces: {
      primary:   { name: 'SpaceX',           role: 'Faction J', bonus: 'MARKETEER',             blurb: 'If you make the highest bid in an auction, you win even if tied.',                                                       mass: 1, radHardness: 4, isru: 4, prospector: 'raygun', thruster: { name: 'Starship', thrustMN: 12.0, specImpKs: 0.38, thrust: 15, fuelPerBurn: 10, afterburn: 2 } },
      secondary: { name: 'Norse Astronauts', role: 'Faction K', bonus: 'SCRUM TROUBLESHOOTERS', blurb: 'Perform Glitch repair anywhere, even without Humans present. Negotiable. Only 1 dirt tank refuel per turn.', mass: 1, radHardness: 3, isru: 4, prospector: 'buggy', thruster: { name: 'OmegA SE', thrustMN: 12.0, specImpKs: 0.30, thrust: 15, fuelPerBurn: 14, afterburn: null, dirt: true } },
    },
  },
];

// Promo crew (cards 387-404 in the print sheet). Unlike the base six, each
// of these is ONE faction: both faces share the same name/mass/radHardness/
// isru/prospector/thruster (one physical engine), only the ability (bonus/
// blurb) differs front to back. Source: "cool - crew cards" reference
// spreadsheet (crew library import, see PR history).
//
// KEPT SEPARATE FROM `CREW` ON PURPOSE. `CREW` feeds PLAYER_COLORS (below)
// and FACTIONS - the seat-colour palette and the starting-crew wizard both
// assume exactly the six base HF4 factions (server/game/state.js shuffles
// PLAYER_COLORS into a 6-player seat palette). These promo cards are a
// LIBRARY-ONLY reference set: they are not selectable at game start and do
// not carry a seat colour slot. Only merge them into CREW_FACES (the
// library grid), never into CREW/FACTIONS/PLAYER_COLORS.
//
// `requiresModule` / `notRecommendedWithModule` are PLACEHOLDER data tags
// for Modules 4 and 5, which this codebase does not implement yet (see
// "Variants we target" in CLAUDE.md - only Standard + CEO Solitaire ship).
// They render as an informational badge in the Library only; no module
// flag exists to gate on, so they have no gameplay effect until M4/M5 are
// built.
export const PROMO_CREW = [
  {
    id: 'crew_brin',
    color: '#a8d8c0',
    faces: {
      primary:   { name: 'BRIN', role: 'Faction E', bonus: 'THERMAL RESEARCH', blurb: 'Your radiators have 2 extra Rad-Hard during a Belt Roll.', mass: 1, radHardness: 4, isru: 4, prospector: 'missile', thruster: { name: 'Pengorbitan RX-1000', thrustMN: 0.75, specImpKs: 0.29, thrust: 11, fuelPerBurn: 14, afterburn: 2, dirt: true } },
      secondary: { name: 'BRIN', role: 'Faction E', bonus: 'THERMAL LABS', blurb: 'As a 1/turn free action, flip a radiator at your Colony/Bernal to its heavy side.', mass: 1, radHardness: 4, isru: 4, prospector: 'missile', thruster: { name: 'Pengorbitan RX-1000', thrustMN: 0.75, specImpKs: 0.29, thrust: 11, fuelPerBurn: 14, afterburn: 2, dirt: true } },
    },
  },
  {
    id: 'crew_the_sea_peoples',
    color: '#fccc00',
    requiresModule: 'M4',
    faces: {
      primary:   { name: 'The Sea Peoples', role: 'Faction H', bonus: 'COURIER', blurb: 'Connections (4B2f).', mass: 1, radHardness: 4, isru: 4, prospector: 'buggy', thruster: { name: 'Fúú S010', thrustMN: 0.45, specImpKs: 0.46, thrust: 14, fuelPerBurn: 8, afterburn: 2 } },
      secondary: { name: 'The Sea Peoples', role: 'Faction H', bonus: 'POWER BROKERS', blurb: 'After you pay FINAO, gain 1 Aqua per Seniority Disk on the Assembly (max half FINAO paid, round down).', mass: 1, radHardness: 4, isru: 4, prospector: 'buggy', thruster: { name: 'Fúú S010', thrustMN: 0.45, specImpKs: 0.46, thrust: 14, fuelPerBurn: 8, afterburn: 2 } },
    },
  },
  {
    id: 'crew_the_martian_way',
    color: '#e3e0d4',
    faces: {
      primary:   { name: 'The Martian Way', role: 'Faction D', bonus: 'ROCKETEERS', blurb: 'Immune to pad explosions/space debris; -2 to Belt Rolls for Earth zone Radiation Belts.', mass: 1, radHardness: 4, isru: 3, prospector: 'missile', thruster: { name: 'Mabel-Dore', thrustMN: 6.2, specImpKs: 0.52, thrust: 14, fuelPerBurn: 7, afterburn: 2 } },
      secondary: { name: 'The Martian Way', role: 'Faction D', bonus: 'TAILINGS REMINING', blurb: 'If this Crew is colocated, can produce ET products of Spectral Type C at any Factory.', mass: 1, radHardness: 4, isru: 3, prospector: 'missile', thruster: { name: 'Mabel-Dore', thrustMN: 6.2, specImpKs: 0.52, thrust: 14, fuelPerBurn: 7, afterburn: 2 } },
    },
  },
  {
    id: 'crew_jaxa',
    color: '#c09cc0',
    requiresModule: 'M4',
    faces: {
      primary:   { name: 'JAXA', role: 'Faction C', bonus: 'FUTURISTS', blurb: 'When you start a contract auction, you may bid 6 years and immediately win the auction.', mass: 1, radHardness: 4, isru: 4, prospector: 'missile', thruster: { name: 'Omicron-S', thrustMN: 1.62, specImpKs: 0.46, thrust: 12, fuelPerBurn: 8, afterburn: 2 } },
      secondary: { name: 'JAXA', role: 'Faction C', bonus: 'STARCHILD', blurb: 'Ignore BEO Colony requirements. As a 1/turn free action, flip one of your augmentations to its other side.', mass: 1, radHardness: 4, isru: 4, prospector: 'missile', thruster: { name: 'Omicron-S', thrustMN: 1.62, specImpKs: 0.46, thrust: 12, fuelPerBurn: 8, afterburn: 2 } },
    },
  },
  {
    id: 'crew_space_force',
    color: '#c09cc0',
    faces: {
      primary:   { name: 'Space Force', role: 'Faction C', bonus: 'LIFE RAFT', blurb: 'May move as a Freighter (1B4) if the stack Wet Mass is less than 5 & doesn\'t contain a glory chit.', mass: 1, radHardness: 4, isru: 4, prospector: 'missile', thruster: { name: 'Falcon X', thrustMN: 7.13, specImpKs: 0.4, thrust: 14, fuelPerBurn: 10, afterburn: 2 } },
      secondary: { name: 'Space Force', role: 'Faction C', bonus: 'LIFEBOAT', blurb: 'May move as a Freighter (1B4) if the stack Wet Mass is less than 7.', mass: 1, radHardness: 4, isru: 4, prospector: 'missile', thruster: { name: 'Falcon X', thrustMN: 7.13, specImpKs: 0.4, thrust: 14, fuelPerBurn: 10, afterburn: 2 } },
    },
  },
  {
    id: 'crew_aeb',
    color: '#c09cc0',
    faces: {
      primary:   { name: 'AEB', role: 'Faction B', bonus: 'AMBASSADOR', blurb: 'During lobby, may move a delegate into centrist instead of Decommission.', mass: 1, radHardness: 5, isru: 4, prospector: 'missile', thruster: { name: 'O’Bean II-A', thrustMN: 0.92, specImpKs: 0.46, thrust: 11, fuelPerBurn: 8, afterburn: 2 } },
      secondary: { name: 'AEB', role: 'Faction B', bonus: 'RABBLE-ROUSER', blurb: 'When you lobby authority in season blue, you may end or initiate anarchy.', mass: 1, radHardness: 5, isru: 4, prospector: 'missile', thruster: { name: 'O’Bean III', thrustMN: 0.98, specImpKs: 0.52, thrust: 11, fuelPerBurn: 8, afterburn: 2 } },
    },
  },
  {
    id: 'crew_explorers_without_borders',
    color: '#b40054',
    notRecommendedWithModule: 'M5',
    faces: {
      primary:   { name: 'Explorers Without Borders', role: 'Faction M', bonus: 'SHUTTLES', blurb: '1/turn you may cargo transfer Aqua from your Bank to an operational thruster in a Home Orbit or LEO.', mass: 1, radHardness: 3, isru: 4, prospector: 'missile', thruster: { name: 'Vulcan Centaur RL10E', thrustMN: 0.215, specImpKs: 0.46, thrust: 9, fuelPerBurn: 8, afterburn: 2 } },
      secondary: { name: 'Explorers Without Borders', role: 'Faction M', bonus: 'ISO-SHUTTLES', blurb: 'If you have an isotope in your Bank or isovault, pay 10 less Aqua/1 less isotope when boosting (min 0).', mass: 1, radHardness: 3, isru: 4, prospector: 'missile', thruster: { name: 'Vulcan Centaur RL10E', thrustMN: 0.215, specImpKs: 0.46, thrust: 9, fuelPerBurn: 8, afterburn: 2 } },
    },
  },
  {
    id: 'crew_baltimore_gun_club',
    color: '#b40054',
    faces: {
      primary:   { name: 'Baltimore Gun Club', role: 'Faction L', bonus: 'WATER ARCJET', blurb: 'Colocated thruster gets a bonus burn if it starts its move at LEO.', mass: 2, radHardness: 5, isru: 4, prospector: 'raygun', thruster: null },
      secondary: { name: 'Baltimore Gun Club', role: 'Faction L', bonus: 'HYDROGEN ARCJET', blurb: 'Colocated thruster gets a bonus burn if it starts its move at LEO, your Anchored Bernal, or your Factory.', mass: 2, radHardness: 5, isru: 4, prospector: 'raygun', thruster: null },
    },
  },
  {
    id: 'crew_african_union_space_directorate',
    color: '#fccc00',
    faces: {
      primary:   { name: 'African Union Space Directorate', role: 'Faction A', bonus: 'EMISSARIES', blurb: 'On your turn, you may treat any or all Ideologies tied for the most delegates as the Active Law.', mass: 1, radHardness: 4, isru: 4, prospector: 'buggy', thruster: { name: 'Uru Anga A01', thrustMN: 1.51, specImpKs: 0.42, thrust: 12, fuelPerBurn: 9, afterburn: 2 } },
      secondary: { name: 'African Union Space Directorate', role: 'Faction A', bonus: 'ARBITER', blurb: 'At the start of your turn you may perform a vote tally. Your vote tallies may treat your delegates as 2 delegates each.', mass: 1, radHardness: 4, isru: 4, prospector: 'buggy', thruster: { name: 'Uru Anga A01', thrustMN: 1.51, specImpKs: 0.42, thrust: 12, fuelPerBurn: 9, afterburn: 2 } },
    },
  },
  {
    id: 'crew_leo_workers_union',
    color: '#a8d8c0',
    faces: {
      primary:   { name: 'LEO Workers’ Union', role: 'Faction H', bonus: 'COLLECTIVE BARGAINING', blurb: 'Receive 2 Aqua at game start. You may commit Murder/Suicide.', mass: 1, radHardness: 3, isru: 4, prospector: 'missile', thruster: { name: 'Angara A5', thrustMN: 7.68, specImpKs: 0.34, thrust: 14, fuelPerBurn: 11, afterburn: 2 } },
      secondary: { name: 'LEO Workers’ Union', role: 'Faction H', bonus: 'SITDOWN', blurb: 'Factory hijack; works even if another player’s Humans are present. You choose 1st Player.', mass: 1, radHardness: 3, isru: 4, prospector: 'missile', thruster: { name: 'Angara A6', thrustMN: 7.68, specImpKs: 0.34, thrust: 14, fuelPerBurn: 11, afterburn: 2 } },
    },
  },
  {
    id: 'crew_makers_guild',
    color: '#9c9c9c',
    notRecommendedWithModule: 'M5',
    faces: {
      primary:   { name: 'Makers Guild', role: 'Faction J', bonus: 'OFFWORLD TRADE NEXUS', blurb: 'If you have either a Factory or Anchored Bernal, gain Bernal Profits.', mass: 1, radHardness: 4, isru: 4, prospector: 'missile', thruster: { name: 'NCC 1702-A', thrustMN: 8.47, specImpKs: 0.4, thrust: 14, fuelPerBurn: 9, afterburn: 2 } },
      secondary: { name: 'Makers Guild', role: 'Faction J', bonus: 'TRADE PORT', blurb: 'At the start of your turn, you may discard 2 cards to take the top card of a patent queue.', mass: 1, radHardness: 4, isru: 4, prospector: 'missile', thruster: { name: 'NCC 1702-A', thrustMN: 8.47, specImpKs: 0.4, thrust: 14, fuelPerBurn: 9, afterburn: 2 } },
    },
  },
  {
    id: 'crew_new_pilgrims',
    color: '#9c9c9c',
    faces: {
      primary:   { name: 'New Pilgrims', role: 'Faction K', bonus: 'REFUGEE', blurb: 'May industrialize an opponent\'s Claim (not a Felony); both may use the Factory (even if this card is flipped).', mass: 1, radHardness: 5, isru: 4, prospector: 'buggy', thruster: { name: 'Liberty Rockoon', thrustMN: 1.34, specImpKs: 0.43, thrust: 12, fuelPerBurn: 9, afterburn: 2 } },
      secondary: { name: 'New Pilgrims', role: 'Faction K', bonus: 'IMMIGRANT', blurb: 'When exomigrating, may first name a specialty to search the chosen queue for the 1st Human with that specialty (if any), then shuffle.', mass: 1, radHardness: 5, isru: 4, prospector: 'buggy', thruster: { name: 'Liberty Rockoon', thrustMN: 1.34, specImpKs: 0.43, thrust: 12, fuelPerBurn: 9, afterburn: 2 } },
    },
  },
  {
    id: 'crew_utopia_inc',
    color: '#fccc00',
    requiresModule: 'M5',
    faces: {
      primary:   { name: 'Utopia, Inc.', role: 'Faction F', bonus: 'EXECUTIVE DISCOUNT', blurb: 'When paying for a company service, you may use the price listed immediately to the right of the company’s current price.', mass: 1, radHardness: 4, isru: 4, prospector: 'missile', thruster: { name: 'Meso-Pangea aerospike', thrustMN: 0.4, specImpKs: 0.44, thrust: 10, fuelPerBurn: 8, afterburn: 2 } },
      secondary: { name: 'Utopia, Inc.', role: 'Faction F', bonus: 'PIGGYBACK', blurb: 'Whenever an opponent boosts cards, you may immediately boost cards up to the mass of the cards boosted, for free.', mass: 1, radHardness: 4, isru: 4, prospector: 'missile', thruster: { name: 'Meso-Pangea aerospike', thrustMN: 0.4, specImpKs: 0.44, thrust: 10, fuelPerBurn: 8, afterburn: 2 } },
    },
  },
  {
    id: 'crew_galahad_group',
    color: '#e3e0d4',
    faces: {
      primary:   { name: 'Galahad Group', role: 'Faction G', bonus: 'HEROIC', blurb: 'This character can carry any number of glory chits. You may lobby honor without losing a delegate.', mass: 1, radHardness: 4, isru: 4, prospector: 'missile', thruster: { name: 'Nakamoto-1', thrustMN: 16.3, specImpKs: 0.39, thrust: 15, fuelPerBurn: 9, afterburn: 2 } },
      secondary: { name: 'Galahad Group', role: 'Faction G', bonus: 'QUEST', blurb: 'During exomigration, your Human Colonist may appear at any Colony in a zone for which you hold a glory chit.', mass: 1, radHardness: 4, isru: 4, prospector: 'missile', thruster: { name: 'Nakamoto-1', thrustMN: 16.3, specImpKs: 0.39, thrust: 15, fuelPerBurn: 9, afterburn: 2 } },
    },
  },
  {
    id: 'crew_brotherhood_of_cryptobankers',
    color: '#b40054',
    requiresModule: 'M5',
    faces: {
      primary:   { name: 'Brotherhood of Cryptobankers', role: 'Faction M', bonus: 'SILENT PARTNER', blurb: 'You may angel a company by paying its minimum share value, instead of the usual double cost.', mass: 1, radHardness: 4, isru: 4, prospector: 'missile', thruster: { name: 'Roton C-9 rotating annular aerospike', thrustMN: 2.2, specImpKs: 0.34, thrust: 12, fuelPerBurn: 11, afterburn: 2 } },
      secondary: { name: 'Brotherhood of Cryptobankers', role: 'Faction M', bonus: 'CHAIRMAN’S CUT', blurb: 'Each time you reinvest a company you chair, gain 1 dividend payout (not multiplied by the number of shares you own).', mass: 1, radHardness: 4, isru: 4, prospector: 'missile', thruster: { name: 'Roton C-9 rotating annular aerospike', thrustMN: 2.2, specImpKs: 0.34, thrust: 12, fuelPerBurn: 11, afterburn: 2 } },
    },
  },
  {
    id: 'crew_verisai',
    color: '#9c9c9c',
    requiresModule: 'M5',
    faces: {
      primary:   { name: 'VerisAI', role: 'Faction J', bonus: 'INCUBATOR', blurb: 'When you splinter a company, you may place it on the same row of the stock market as its parent company.', mass: 1, radHardness: 4, isru: 4, prospector: 'missile', thruster: { name: 'Launch-GPR 5e', thrustMN: 14.9, specImpKs: 0.4, thrust: 15, fuelPerBurn: 9, afterburn: 2 } },
      secondary: { name: 'VerisAI', role: 'Faction J', bonus: 'CAVITATION ENGINEERS', blurb: '[Ignore Aerobrake] once per turn.', mass: 1, radHardness: 4, isru: 4, prospector: 'missile', thruster: { name: 'Launch-GPR 5e', thrustMN: 14.9, specImpKs: 0.4, thrust: 15, fuelPerBurn: 9, afterburn: 2 } },
    },
  },
  {
    id: 'crew_heliocentricity',
    color: '#a8d8c0',
    faces: {
      primary:   { name: 'Heliocentricity', role: 'Faction F', bonus: 'WEAK STABILITY BOUNDARY', blurb: 'After its Stack moves, you may activate this thruster to coast as a second movement.', mass: 1, radHardness: 4, isru: 4, prospector: 'missile', thruster: { name: 'Sundiver', thrustMN: 12.2, specImpKs: 0.46, thrust: 15, fuelPerBurn: 8, afterburn: 2 } },
      secondary: { name: 'Heliocentricity', role: 'Faction F', bonus: 'POWER SERIES CHAOS MODEL', blurb: 'Immune to Hazards mentioning geysers, rings, spin, and winds.', mass: 1, radHardness: 4, isru: 4, prospector: 'missile', thruster: { name: 'Sundiver', thrustMN: 12.2, specImpKs: 0.46, thrust: 15, fuelPerBurn: 8, afterburn: 2 } },
    },
  },
  {
    id: 'crew_cerulean',
    color: '#e3e0d4',
    notRecommendedWithModule: 'M5',
    faces: {
      primary:   { name: 'Cerulean', role: 'Faction D', bonus: 'BLUE PLANET', blurb: 'If ending turn on an aerobrake Hazard, cost of FINAO = 1 Aqua, which gains 1 FT.', mass: 1, radHardness: 4, isru: 4, prospector: 'missile', thruster: { name: 'New Glenn', thrustMN: 17.1, specImpKs: 0.39, thrust: 15, fuelPerBurn: 9, afterburn: 2 } },
      secondary: { name: 'Cerulean', role: 'Faction D', bonus: 'DOWSERS', blurb: 'When ISRU refueling for water, refuel at an ISRU = 0.', mass: 1, radHardness: 4, isru: 4, prospector: 'missile', thruster: { name: 'New Glenn', thrustMN: 17.1, specImpKs: 0.39, thrust: 15, fuelPerBurn: 9, afterburn: 2 } },
    },
  },
];

// Lookup keyed by id. Includes PROMO_CREW too (the library inspects promo
// tiles by id the same way it inspects the base six), but nothing else
// below this point pulls from PROMO_CREW - see the note above PROMO_CREW.
export const CREW_BY_ID = Object.fromEntries(
  [...CREW, ...PROMO_CREW].map((c) => [c.id, c])
);

// The six faction seat colours, in crew order. The server shuffles this per
// game (server/game/state.js#PLAYER_COLORS), but pre-game (lobby roster + lobby
// chat) there are no shuffled seats yet, so names tint by seat number against
// this stable order: seat 1 -> first colour, and so on.
export const PLAYER_COLORS = CREW.map((c) => c.color);

// Deterministic seat -> colour for the lobby (1-based seat number; wraps past
// six). Falls back to seat 1 when the number is missing.
export function seatColorForSeat(seat) {
  const n = Number(seat) || 1;
  return PLAYER_COLORS[((n - 1) % PLAYER_COLORS.length + PLAYER_COLORS.length) % PLAYER_COLORS.length];
}

// Flat list of every selectable faction face, for the
// starting-crew wizard. Each entry points back at its physical
// card + which face it is, and carries the card's faction colour.
export const FACTIONS = CREW.flatMap((card) => (
  ['primary', 'secondary'].map((faceKey) => ({
    cardId: card.id,
    face: faceKey,
    color: card.color,
    name: card.faces[faceKey].name,
    bonus: card.faces[faceKey].bonus,
    blurb: card.faces[faceKey].blurb,
  }))
));

// The 12 crew faces as standalone single-face card objects, for
// the Card Library. The library shows all 12 (not the 6 physical
// double-faced cards): each renders as its own flip-less card,
// since `faces.secondary` is absent the renderer emits no flip
// button. `srcId` + `face` map a tile back to its physical card
// for hand / rocket location markers; `color` is the faction
// band colour. The runtime hand/colonize pipeline still keys off
// the 6 physical CREW cards - these are a display projection.
//
// PROMO_CREW's 36 faces are appended here too (library reference only -
// see the note above PROMO_CREW for why they're excluded from CREW
// itself). Each carries the physical card's requiresModule /
// notRecommendedWithModule tag so the library tile can badge it.
export const CREW_FACES = [...CREW, ...PROMO_CREW].flatMap((card) => (
  ['primary', 'secondary'].map((faceKey) => ({
    id: `${card.id}__${faceKey}`,
    srcId: card.id,
    face: faceKey,
    color: card.color,
    requiresModule: card.requiresModule || null,
    notRecommendedWithModule: card.notRecommendedWithModule || null,
    faces: { primary: card.faces[faceKey] },
  }))
));
