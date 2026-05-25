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
    faces: {
      primary:   { name: 'United Nations Cosmonauts', role: 'Faction A', bonus: 'SECRETARY GENERAL', blurb: 'Start with +2 Aqua. (Module 2: after 1st anchor of your Home Bernal.)', mass: 1, radHardness: 4, isru: 4, prospector: 'buggy',  thruster: { name: 'Liberty',   thrustMN: 1.34, specImpKs: 0.43, thrust: 12, fuelPerBurn: 9,  afterburn: 2 } },
      secondary: { name: 'B612 Foundation',           role: 'Faction H', bonus: 'BLINK TELESCOPE',   blurb: '1 re-roll per prospecting operation when using a Raygun.',        mass: 1, radHardness: 3, isru: 4, prospector: 'buggy',  thruster: { name: 'New Glenn', thrustMN: 17.1, specImpKs: 0.39, thrust: 15, fuelPerBurn: 10, afterburn: 2 } },
    },
  },
  {
    id: 'crew_roscosmos_taikonauts',
    faces: {
      primary:   { name: 'Roscosmos',  role: 'Faction B', bonus: 'TAXES',     blurb: '+1 Aqua from the Pool after any player places a Claim or industrializes a Claim.', mass: 1, radHardness: 5, isru: 4, prospector: 'buggy',  thruster: { name: 'Angara 5',        thrustMN: 13.4, specImpKs: 0.38, thrust: 15, fuelPerBurn: 10, afterburn: 2 } },
      secondary: { name: 'Taikonauts', role: 'Faction C', bonus: 'FELONIOUS', blurb: 'Your Humans may perform Felonious actions. Negotiable.',                          mass: 1, radHardness: 4, isru: 4, prospector: 'raygun', thruster: { name: 'The Long March 9', thrustMN: 8.27, specImpKs: 0.43, thrust: 14, fuelPerBurn: 9,  afterburn: 2 } },
    },
  },
  {
    id: 'crew_nasa_isro',
    faces: {
      primary:   { name: 'NASA Astronauts',     role: 'Faction D', bonus: 'LAUNCH FEES',   blurb: '+1 Aqua from the Pool after any player performs a boost operation.',                                  mass: 1, radHardness: 4, isru: 4, prospector: 'raygun', thruster: { name: 'SLS, 130t Block II Crew', thrustMN: 7.44, specImpKs: 0.45, thrust: 14, fuelPerBurn: 8,  afterburn: 2 } },
      secondary: { name: 'ISRO Glavcosmonauts', role: 'Faction G', bonus: 'DHARMA REFUEL', blurb: 'If any of your Humans carry a glory chit, double yield from a Colocated site refuel operation.', mass: 1, radHardness: 4, isru: 4, prospector: 'buggy',  thruster: { name: 'GSLV MkIII (Vikas)',     thrustMN: 0.80, specImpKs: 0.27, thrust: 11, fuelPerBurn: 14, afterburn: 2 } },
    },
  },
  {
    id: 'crew_anonp2p_esa',
    faces: {
      primary:   { name: 'Anonymous P2P',       role: 'Faction E', bonus: 'OPEN SOURCE FINAO', blurb: 'Failure Is Not An Option costs 3 Aqua.',                                                                                  mass: 1, radHardness: 4, isru: 4, prospector: 'buggy',  thruster: { name: 'Skylon',    thrustMN: 5.88, specImpKs: 0.46, thrust: 14, fuelPerBurn: 8, afterburn: 2 } },
      secondary: { name: 'ESA Space Unionists', role: 'Faction F', bonus: 'POWERSAT',          blurb: 'During any player\'s Turn, may give +1 thrust to any Spacecraft that has a push icon in its thruster triangle. Negotiable.', mass: 1, radHardness: 4, isru: 4, prospector: 'raygun', thruster: { name: 'Ariane 64', thrustMN: 1.37, specImpKs: 0.45, thrust: 12, fuelPerBurn: 8, afterburn: 2 } },
    },
  },
  {
    id: 'crew_shimizu_nasrda',
    faces: {
      primary:   { name: 'Shimizu Corp Entrepreneurs', role: 'Faction M', bonus: 'SKUNKWORKS', blurb: 'Ignore academia hand limit when bidding or starting an auction.', mass: 1, radHardness: 3, isru: 4, prospector: 'buggy',  thruster: null },
      secondary: { name: 'NASRDA Astronauts',          role: 'Faction L', bonus: 'MOONCABLE',  blurb: 'Once-per-turn free action: refuel an activated dirt thrust triangle at LEO/Home Bernal with 7 tanks (non-crew thruster) or 1 tank (Crew thruster). Negotiable. An activated dirt thruster can accept 1 tank of dirt max per Turn.', mass: 1, radHardness: 4, isru: 4, prospector: 'raygun', thruster: { name: 'Pegasus XL', thrustMN: 0.074, specImpKs: 0.37, thrust: 7, fuelPerBurn: 11, afterburn: null, dirt: true } },
    },
  },
  {
    id: 'crew_spacex_norse',
    faces: {
      primary:   { name: 'SpaceX',           role: 'Faction J', bonus: 'MARKETEER',             blurb: 'If you make the highest bid in an auction, you win even if tied.',                                                       mass: 1, radHardness: 4, isru: 4, prospector: 'raygun', thruster: { name: 'Starship', thrustMN: 12.0, specImpKs: 0.38, thrust: 15, fuelPerBurn: 10, afterburn: 2 } },
      secondary: { name: 'Norse Astronauts', role: 'Faction K', bonus: 'SCRUM TROUBLESHOOTERS', blurb: 'You may perform Glitch repair anywhere (even without Humans present). Negotiable. An activated dirt thruster can accept 1 tank of dirt max per Turn.', mass: 1, radHardness: 3, isru: 4, prospector: 'buggy', thruster: { name: 'OmegA SE', thrustMN: 12.0, specImpKs: 0.30, thrust: 15, fuelPerBurn: 14, afterburn: null, dirt: true } },
    },
  },
];

export const CREW_BY_ID = Object.fromEntries(CREW.map((c) => [c.id, c]));

// Flat list of every selectable faction face, for the
// starting-crew wizard. Each entry points back at its physical
// card + which face it is.
export const FACTIONS = CREW.flatMap((card) => (
  ['primary', 'secondary'].map((faceKey) => ({
    cardId: card.id,
    face: faceKey,
    name: card.faces[faceKey].name,
    bonus: card.faces[faceKey].bonus,
    blurb: card.faces[faceKey].blurb,
  }))
));
