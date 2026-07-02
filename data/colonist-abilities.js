// Structured COLONIST powers (Module 2) - the engine flags behind each
// colonist face's printed ability text, the exact pattern of
// data/card-abilities.js for patent faces. The sheet carries the text; this
// maps it to flags the engine (and the client's gates) consume. Keyed by the
// FACE name (almost all abilities live on the promoted / purple face; Calypso
// 2 Seed Sail is the one white-face entry).
//
// Flags:
//   glitchFree            - all of this player's stacks are glitch-free
//   bothCrewFaces         - may use the faction privileges on BOTH crew faces
//   felonious             - all their Humans may commit Felonies
//   elevatorFreighter     - acts as a Freighter when building a Space Elevator
//   sizeRollMod           - modifier to Colocated prospect size rolls
//   sizeRollSynodicOnly   - the mod applies only on Synodic Sites
//   sizeRollSynodicComets - the mod applies only on Synodic Comets
//   noAerobrake           - the carrying stack cannot enter aerobrakes
//   opponentsBoostDoubled - boost costs double for all OPPONENTS
//   epicHazardFree        - performs the Epic Hazard operation as a free action
//   epicHazardSurvives    - not decommissioned if the Epic Hazard fails
//   auctionDeckSearch     - starting a research auction may search a deck
//                           (not yet consumed - needs its own picker UI)
//   etProduceCAnywhere    - may ET-produce Spectral C products at any Factory
//                           (informational: the engine does not gate spectral)
//   doubleIsotopeRefuel   - factory isotope refuel is doubled (Colocated)
//   finaoHalved           - FINAO costs are halved, fractions dropped
//   freeMarketDoubled     - aqua from a Free Market sale is doubled
//   privilegeInAnarchy    - faction privilege is not lost in Anarchy

export const COLONIST_POWERS = {
  // "All of your stacks are Glitch-free."
  'Utility Fog Halbonaut': { glitchFree: true },
  'Neumann Matter': { glitchFree: true },
  'Creeper Neogen': { glitchFree: true },
  // "May perform the faction privileges on both sides of your Crew card."
  'Group Mind Immortalists': { bothCrewFaces: true },
  // "All your Humans can commit Felonies, even if defending Humans are present."
  'Soldier Caste': { felonious: true },
  // "Acts as a Freighter when building a Space Elevator."
  'Martian Assembly': { elevatorFreighter: true },
  // "Can't enter aerobrakes." (white face)
  'Calypso 2 Seed Sail': { noAerobrake: true },
  // "-2 to Colocated size rolls on Synodic Comets. Can't enter aerobrakes."
  'Wet-Nano Seed Sail': { sizeRollMod: -2, sizeRollSynodicComets: true, noAerobrake: true },
  // "Boost costs are doubled for all your opponents."
  'New Attica Secessionists': { opponentsBoostDoubled: true },
  // "Performs epic hazard operation as a free action, & is not Decommissioned
  // if it fails."
  'Iceworms': { epicHazardFree: true, epicHazardSurvives: true },
  // "-1 to Colocated size rolls."
  'Rental Body Guild': { sizeRollMod: -1 },
  // "-1 on all size rolls when prospecting Synodic Sites."
  'Svalbard Caretakers': { sizeRollMod: -1, sizeRollSynodicOnly: true },
  // "If initiating a research auction, can search through one patent deck and
  // choose the card to be auctioned."
  'Renaissance Man': { auctionDeckSearch: true },
  // "Can produce ET products of Spectral Type C at any Factory."
  'Blue Goo Sybonts': { etProduceCAnywhere: true },
  // "During Factory Refuel, double the amount of isotope fuel."
  'Alchemist Aviatrices': { doubleIsotopeRefuel: true },
  // "FINAO costs are halved (drop fractions)."
  'Frankenstein Navigator': { finaoHalved: true },
  'Josephson Implants': { finaoHalved: true },
  // "Your Aqua from a Free Market is doubled."
  'Kaluga Naniteers': { freeMarketDoubled: true },
  // "Faction privilege not lost in Anarchy. -1 to Colocated size rolls on
  // Synodic Comets."
  'Eugenic Pilgrims': { privilegeInAnarchy: true, sizeRollMod: -1, sizeRollSynodicComets: true },
};

export function colonistPower(faceName) {
  return (faceName && COLONIST_POWERS[faceName]) || null;
}
