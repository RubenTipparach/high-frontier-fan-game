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
  'Mag Sail':         { aerobrakeDecommission: true, bonusBurnPerBelt: true },              // "Aerobrake decommission. Each Radiation Belt entered = Bonus Burn"
  // Parachute generators let the whole stack aerobrake safely.
  'Magnetoshell Plasma Parachute': { safeAerobrake: true, safeAerobrakeNoBernalOrIndustrialize: true }, // "This stack can safely enter aerobrakes. Cannot be used to support Bernals or during industrialization."
  'Granular Rainbow Corral':       { safeAerobrake: true },                                              // "This stack can safely enter aerobrakes."

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

