// Crew deck - the published HF4 player-faction cards. Each
// physical card is double-sided and carries TWO factions, one
// per face. At game start the player picks ONE faction face
// (the starting-crew wizard) and that faction's privilege is
// their edge for the game.
//
// Source: https://www.hf4map.com/cards/crew/ (the 6 crew
// cards, card0..card5, front + back). NOTE: this is the CREW
// deck - distinct from the Colonists deck (a separate set of
// cards). An earlier build wrongly populated this file from the
// spreadsheet's Colonists sheet; that was the wrong data.
//
// Faction PRIVILEGE text: 5 of the 12 were recoverable from
// published sources (BGG / strategy guides) and are filled in
// below. The other 7 are marked "TODO: privilege" pending a
// transcription from the card images (hf4map serves the stats
// as JPGs, not text). Per-face MASS / RAD-HARD are placeholders
// (crew are light, low-mass); replace with the printed values
// when available.
//
// Face shape matches the crew renderer in js/game/card-ui.js:
//   { name, role, bonus, blurb, mass, radHardness, spectralType }
//   - name  : faction name
//   - role  : short faction descriptor
//   - bonus : the privilege's short title (NASA LAUNCH FEES, ...)
//   - blurb : what the privilege does

const TODO_PRIV = 'TODO: faction privilege (transcribe from card).';

export const CREW = [
  {
    id: 'crew_un_b612',
    faces: {
      primary:   { name: 'United Nations Cosmonauts', role: 'Faction', bonus: 'UN MANDATE', blurb: TODO_PRIV, mass: 0, radHardness: 3, spectralType: 'C' },
      secondary: { name: 'B612 Foundation',           role: 'Faction', bonus: 'B612',       blurb: TODO_PRIV, mass: 0, radHardness: 3, spectralType: 'C' },
    },
  },
  {
    id: 'crew_roscosmos_taikonauts',
    faces: {
      primary:   { name: 'Roscosmos',  role: 'Faction', bonus: 'PROTECTION FEES', blurb: 'Gain 1 water after any player places a claim or industrializes.', mass: 0, radHardness: 3, spectralType: 'C' },
      secondary: { name: 'Taikonauts', role: 'Faction', bonus: 'TAIKONAUTS',      blurb: TODO_PRIV, mass: 0, radHardness: 3, spectralType: 'C' },
    },
  },
  {
    id: 'crew_nasa_isro',
    faces: {
      primary:   { name: 'NASA Astronauts',     role: 'Faction', bonus: 'NASA LAUNCH FEES', blurb: 'Gain 1 aqua whenever any player performs a Boost operation.', mass: 0, radHardness: 3, spectralType: 'C' },
      secondary: { name: 'ISRO Glavcosmonauts', role: 'Faction', bonus: 'ISRO',             blurb: TODO_PRIV, mass: 0, radHardness: 3, spectralType: 'C' },
    },
  },
  {
    id: 'crew_anonp2p_esa',
    faces: {
      primary:   { name: 'Anonymous P2P',       role: 'Faction', bonus: 'ANONYMOUS P2P',      blurb: TODO_PRIV, mass: 0, radHardness: 3, spectralType: 'C' },
      secondary: { name: 'ESA Space Unionists', role: 'Faction', bonus: 'ESA POWERSAT IN GEO', blurb: '+1 thrust to any one spacecraft during any player turn.', mass: 0, radHardness: 3, spectralType: 'C' },
    },
  },
  {
    id: 'crew_shimizu_nasrda',
    faces: {
      primary:   { name: 'Shimizu Corp Entrepreneurs', role: 'Faction', bonus: 'SHIMIZU SKUNKWORKS', blurb: 'May bid in research auctions with any number of hand cards.', mass: 0, radHardness: 3, spectralType: 'C' },
      secondary: { name: 'NASRDA Astronauts',          role: 'Faction', bonus: 'NASRDA',            blurb: TODO_PRIV, mass: 0, radHardness: 3, spectralType: 'C' },
    },
  },
  {
    id: 'crew_spacex_norse',
    faces: {
      primary:   { name: 'SpaceX',           role: 'Faction', bonus: 'SPACEX LAUNCH FEES', blurb: 'Gain 1 water whenever any player performs a Boost operation.', mass: 0, radHardness: 3, spectralType: 'C' },
      secondary: { name: 'Norse Astronauts', role: 'Faction', bonus: 'NORSE',              blurb: TODO_PRIV, mass: 0, radHardness: 3, spectralType: 'C' },
    },
  },
];

export const CREW_BY_ID = Object.fromEntries(CREW.map((c) => [c.id, c]));

// Flat list of every selectable faction face, for the
// starting-crew wizard. Each entry points back at its physical
// card + which face it is, so the picker can show all 12
// factions and the engine can record the single chosen one.
export const FACTIONS = CREW.flatMap((card) => (
  ['primary', 'secondary'].map((faceKey) => ({
    cardId: card.id,
    face: faceKey,
    name: card.faces[faceKey].name,
    bonus: card.faces[faceKey].bonus,
    blurb: card.faces[faceKey].blurb,
  }))
));
