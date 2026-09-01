// Patent card POWERS - the structured engine effects behind the free-text
// Ability printed on each patent face.
//
// The ability TEXT and WHICH cards carry it are authoritative from the
// spreadsheet (reference/HF4-card-data.xlsx -> each face's `ability` field).
// This module is the IMPLEMENTATION layer: it maps each card face to the
// flags / values the engine + client act on. It does NOT invent card data -
// every entry here corresponds to an Ability cell in the sheet (see the text
// in the trailing comment on each line), it just gives that text a structured
// shape the code can branch on.
//
// Pure: no DOM, no `node:` imports. Imported by BOTH js/game/* and
// server/game/*, the same as data/fuel-graph.js and data/support-chain.js.
//
// Keyed by the card FACE NAME (the canonical per-face name from the sheet,
// e.g. 'Mag Sail', 'Project Valkyrie'). A face only grants its power when that
// face is the INSTALLED one, so read it off slotFace / installedFace and look
// the name up here - never off faces.primary unconditionally.

export const CARD_POWERS = {
  // ---- Subsystem 1: aerobrake / radiation immunity ----
  // Sails are huge, fragile light-pressure structures: immune to the radiation
  // events (they have no dense electronics to fry) but decommissioned if the
  // stack aerobrakes (the sail burns off).
  'Photon Heliogyro': { immuneFlare: true, immuneBelt: true, aerobrakeDecommission: true }, // "Aerobrake decommission. Immune to Flare & Belt Rolls."
  'Electric Sail':    { immuneFlare: true, immuneBelt: true, aerobrakeDecommission: true }, // "Aerobrake decommission. Immune to Flare & Belt Rolls."
  'Photon Kite Sail': { immuneFlare: true, immuneBelt: true, aerobrakeDecommission: true }, // "Aerobrake decommission. Immune to Flare & Belt Rolls."
  'Fusion Fragment Sail': { immuneFlare: true, immuneBelt: true },                          // "Immune to flares & radiation belts." (no aerobrake-decommission clause)
  'Mag Sail':         { aerobrakeDecommission: true, bonusBurnPerBelt: true },              // "Aerobrake decommission. Each Radiation Belt entered = Bonus Burn"
  // Parachute generators let the whole stack aerobrake safely.
  'Magnetoshell Plasma Parachute': { safeAerobrake: true, safeAerobrakeNoBernalOrIndustrialize: true }, // "This stack can safely enter aerobrakes. Cannot be used to support Bernals or during industrialization."
  'Granular Rainbow Corral':       { safeAerobrake: true },                                              // "This stack can safely enter aerobrakes."

  // ---- Freighter landing ability ----
  // Promoted freighter faces that can liftoff/land on Sites SMALLER than size 6
  // without factory-assist (card text). Read by the freighter move landing gate
  // (server engine + client planner), which otherwise gates a freighter on its
  // Net Thrust (2) and forces a factory-assist for size 2+.
  'Fission GCR':                { freighterNoAssistUnder6: true },   // "Can liftoff/land on Sites that are less than size 6 without factory-assist."
  'Magnetic Mirror Beam Rider': { freighterNoAssistUnder6: true },   // "Can liftoff/land on Sites that are less than size 6 without factory-assist."

  // ---- Freighter origin-thrust bonuses ----
  // Extra net thrust for THIS move only, when the freighter starts it parked at
  // a qualifying origin site. Read by the freighter move handler (server) off
  // the installed face's name, checked against the site the freighter is
  // leaving (not the destination).
  'Antiproton Sail and Harvester': { beltOriginThrust: 1 },    // "+1 net thrust if starting its move on a radiation belt."
  'Poodle Steam':                  { factoryOriginThrust: 2 }, // "+2 thrust if its move starts on a Factory."

  // ---- Freighter Solar-Heated zone cap ----
  // "If not using Powersat, may move out only as far as the X zone." Same
  // physical card (fre_inflatable_solar_heated): the white face caps at Ceres,
  // the promoted face extends the range to Jupiter. Read by the freighter move
  // handler (server) off the installed face's name; waived while Powersat-
  // pushed (Powersat supplies the extra push the sail alone can't).
  'Inflatable Solar-Heated': { solarHeatedZoneCap: 'Ceres' },   // "SOLAR HEATED: If not using Powersat, may move out only as far as the Ceres zone."
  'Archimedes Palmer Lens':  { solarHeatedZoneCap: 'Jupiter' }, // "SOLAR HEATED: If not using Powersat, may move out only as far as the Jupiter zone."

  // ---- Bernal crew "on-board reactor" ----
  // These Bernal faces give the CREW aboard an on-board reactor, so a crew member
  // acts as a reactor supplier in the Bernal's support chain (no separate reactor
  // card needed). The Nuclear "X" reactor supplies reactor-fission; the promoted
  // "ANY" reactor supplies every reactor kind. crewOnBoardReactorHome gates the
  // effect to a HOME Bernal (the "HOME:" prefix on the white face); the purple
  // Lab face has no HOME clause, so it applies whenever a crew is aboard.
  'L4 Antimatter Factory': { crewOnBoardReactor: ['reactor-fission'], crewOnBoardReactorHome: true }, // "HOME: Your Crew has an On-Board Nuclear X reactor."
  'Antimatter Lab':        { crewOnBoardReactor: ['reactor-fission', 'reactor-fusion', 'reactor-antimatter'] }, // "Your Crew has an On-Board Nuclear ANY reactor."

  // ---- Subsystem 2: colocated prospect size-roll modifiers ----
  'Lorentz-Propelled Microprobe': { nanitesReroll: true },                       // "NANITES: One re-roll if fail 1 or more size rolls."
  'Carbonyl Volatilization':      { sizeRollMod: -3, sizeRollSpectral: 'S' },    // "THORIUM BREEDER: -3 to Colocated size rolls on S Sites."
  'Biophytolytic Algal Farm':     { sizeRollMod: -2, sizeRollSpectral: 'D' },    // "COMET LICHEN: -2 to Colocated size rolls on D Sites."
  'Impact Mold Sinter':           { sizeRollMod: -1 },                           // "FOAMED NICKEL: -1 to Colocated size rolls."
  'Laser-Heated Pedestal Growth': { sizeRollMod: -1, sizeRollProspector: 'raygun' }, // "SUPERLENS: -1 to all Colocated raygun size rolls."

  // ---- Subsystem 3: ISRU modifiers ----
  'Von Neumann Santa Claus Machine': { isruMod: -1 },                            // "DIVINING NUBOTS: -1 ISRU for Colocated ISRU platform."
  'Mini-Mag RF Paul Trap':           { isruMod: -2, isruAerostatOnly: true },    // "SCOOP: -2 ISRU for Colocated ISRU platforms at Aerostat Sites."
  'Ultracold Neutrons':              { isruMod: -2, isruAerostatOnly: true },    // "SCOOP: -2 ISRU for Colocated ISRU platforms at Aerostat Sites."
  'MagBeam':                         { isruMod: -1, powersatPushThrust: 3 },     // "-1 ISRU, +3 thrust if pushed by Powersat."

  // ---- Subsystem 4: industrialize modifiers ----
  'Solar Carbotherm':          { noRobonautDecommissionZones: ['Mercury', 'Venus', 'Earth'] }, // "ARCOLOGY: Decommissioning of a robonaut is not needed when this is used to industrialize in the zones Mercury, Venus, Earth"
  'Solid Flame':               { industrializeFreeAction: true },                // "JELLYBOTS: Colocated industrialization is a free action."
  'Termite Nest':              { mineRevival: true },                            // "MINE REVIVAL: As an op, remove a busted disk and place Claim on a Colocated Site of Size 2+."
  'Ilmenite Semiconductor Film': { gainPowersatOnIndustrialize: 'nonAtmoSize8' }, // "POWER GIRDLE: If used to industrialize a non-atmospheric site of size 8+, you permanently gain the Powersat faction privilege."
  'Ionosphere Lasing':         { gainPowersatOnIndustrialize: 'atmospheric' },   // "IONOSAT: If used to industrialize an Atmospheric Site, permanently gain the Powersat faction privilege."

  // ---- Subsystem 5: site refuel modifiers ----
  'Atmospheric Scoop': { aerostatHydration2: true },                             // "SCOOP: If operational, this card makes adjacent or colocated aerostat sites into [2 hydration]"
  'Femtochemistry':    { doubleSiteRefuel: true },                               // "SCAVENGING: If Colocated, doubles FTs during site refuel."

  // ---- Subsystem 6: reactor activation hazard ----
  'Project Valkyrie': { purgeOnActivateRadHardBelow: 4 },                        // "When activated, Decommission colocated cards with Rad-Hard <4."

  // ---- Subsystem 7: radiator behavior ----
  'Li Heatsink Fountain':           { switchToLightAfterUse: true },             // "[Heavy] Switch to light side after 1st use."
  'Thermochemical Heatsink Fountain': { switchToLightAfterUse: true },           // "[Heavy] Switch to light side after 1st use."
  'Magnetocaloric Refrigerator':    { coolsOwnSupports: true },                  // "This card can cool its own supports."
};

// Power flags for a card FACE name (the installed face's name). Returns null
// when that face has no special power.
export function facePower(faceName) {
  return (faceName && CARD_POWERS[faceName]) || null;
}

// ---- Colocated modifier scans (subsystems 2 + 3) ----
//
// Each takes a list of POWER objects (facePower() of each colocated card's
// INSTALLED face; nulls are ignored) and the relevant site context, and folds
// the matching modifiers. "Colocated" = in the same stack as the active
// prospector / ISRU platform. Pure, shared by client + server so the gate they
// compute is identical.

// Sum of size-roll modifiers (subsystem 2): added to the prospect d6 (negative
// = easier, since success is roll <= threshold). Conditioned per power on the
// site's spectral type and/or the prospector kind.
export function sumColocatedSizeRollMod(powers, { spectral, prospectorKind } = {}) {
  let mod = 0;
  for (const p of powers) {
    if (!p || p.sizeRollMod == null) continue;
    if (p.sizeRollSpectral && p.sizeRollSpectral !== spectral) continue;
    if (p.sizeRollProspector && p.sizeRollProspector !== prospectorKind) continue;
    mod += p.sizeRollMod;
  }
  return mod;
}

// Sum of ISRU modifiers (subsystem 3): added to the colocated ISRU platform's
// rating (negative = lower ISRU, which helps both the prospect ISRU gate and
// the site-refuel yield). SCOOP variants apply only at aerostat sites.
export function sumColocatedIsruMod(powers, { isAerostat } = {}) {
  let mod = 0;
  for (const p of powers) {
    if (!p || p.isruMod == null) continue;
    if (p.isruAerostatOnly && !isAerostat) continue;
    mod += p.isruMod;
  }
  return mod;
}

// Does any colocated card grant a NANITES prospect re-roll (subsystem 2)?
export function anyColocatedNanitesReroll(powers) {
  return powers.some((p) => p && p.nanitesReroll);
}


// Has this player already spent their one per-OPERATION prospect re-roll this
// turn? BLINK TELESCOPE (B612 Foundation) prints "1 re-roll per prospecting
// operation" and NANITES prints "One re-roll if fail 1 or more size rolls":
// both grant ONE re-roll across every site the session scanned, taken on
// whichever disc the player likes once all the rolls are in. A raygun operation
// is the turn's whole scanning session (the first scan spends the op, later
// scans ride free), so the budget is turn-scoped. The BUGGY's re-roll is
// printed per prospect and is deliberately outside this budget.
// Shared so the server's gate and the client's affordance read the same rule.
export function rerollSpentThisTurn(discs, ownerId, turn) {
  return Object.values(discs || {}).some((d) => d
    && d.rerolled && d.kind !== 'buggy'
    && d.ownerId === ownerId && d.turn === turn);
}
