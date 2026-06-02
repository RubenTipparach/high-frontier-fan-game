# Card & Crew Powers

Every text-based ability written on a card or crew/faction face, plus
the Sunspot Cube events, that overrides or modifies the normal game
rules. Generated from the source data (`data/card-data.json` +
`data/crew.js` + `data/events.js`) by `scripts/list-powers.mjs` - do
not hand-edit; re-run the generator after a data change.

Scope note: "Negotiable" tags are listed verbatim where they appear but
are not yet wired to a trade prompt. Endgame **Future** goal cards are
listed in their own section at the end (they are card text but are
objective+reward cards, not always-on rule overrides).

## Crew faction privileges

Source: `data/crew.js`. Each physical crew card is double-sided; both
faces are independent factions with their own privilege.

| Faction | Role | Privilege | Effect |
| --- | --- | --- | --- |
| United Nations Cosmonauts | Faction A | SECRETARY GENERAL | Start with +2 Aqua. (Module 2: after 1st anchor of your Home Bernal.) |
| B612 Foundation | Faction H | BLINK TELESCOPE | 1 re-roll per prospecting operation when using a Raygun. |
| Roscosmos | Faction B | TAXES | +1 Aqua from the Pool after any player places a Claim or industrializes a Claim. |
| Taikonauts | Faction C | FELONIOUS | Your Humans may perform Felonious actions. Negotiable. |
| NASA Astronauts | Faction D | LAUNCH FEES | +1 Aqua from the Pool after any player performs a boost operation. |
| ISRO Glavcosmonauts | Faction G | DHARMA REFUEL | If any of your Humans carry a glory chit, double yield from a Colocated site refuel operation. |
| Anonymous P2P | Faction E | OPEN SOURCE FINAO | Failure Is Not An Option costs 3 Aqua. |
| ESA Space Unionists | Faction F | POWERSAT | During any player's Turn, may give +1 thrust to any Spacecraft that has a push icon in its thruster triangle. Negotiable. |
| Shimizu Corp Entrepreneurs | Faction M | SKUNKWORKS | Ignore academia hand limit when bidding or starting an auction. |
| NASRDA Astronauts | Faction L | MOONCABLE | Once-per-turn free action: refuel an activated dirt thrust triangle at LEO/Home Bernal with 7 tanks (non-crew thruster) or 1 tank (Crew thruster). Negotiable. An activated dirt thruster can accept 1 tank of dirt max per Turn. |
| SpaceX | Faction J | MARKETEER | If you make the highest bid in an auction, you win even if tied. |
| Norse Astronauts | Faction K | SCRUM TROUBLESHOOTERS | You may perform Glitch repair anywhere (even without Humans present). Negotiable. An activated dirt thruster can accept 1 tank of dirt max per Turn. |

## Sunspot Cube events

Source: `data/events.js`, the `EVENT_TABLE`. When the Sunspot Cube
lands on an event slot the player rolls 1d6 and consults this table.
Rolls 1-4 are universal; 5-6 depend on the season the cube is in
(Blue / Yellow / Red). These change game state (rotate decks, place
Glitch tokens, decommission cards, swap faction privileges, force
flare rolls); they never award or remove VP directly. The `effect`
column is the engine id resolved when the `eventEffects` feature flag
is on.

| Event | Trigger | Effect id | Rule text |
| --- | --- | --- | --- |
| 💡 Inspiration | d6 1-2, any season | rotate_decks | Put the topmost card of each patent deck (& the Colonist queue) at the bottom of the deck. |
| ⚠️ Glitch | d6 3, any season | place_glitch | Each player places a Glitch disk on their stack with the most cards that has neither a Glitch nor Humans. |
| 🧨 Pad Explosion / Space Debris | d6 4, any season | pad_explosion | Each player decommissions their card with the highest Mass in LEO, choosing one if tied. However, Crew, Black-Side, Purple-Side, Colonists, and Bernals are immune. |
| 🗽 Anarchy | d6 5-6, Blue season | anarchy | Until the Sunspot Cube exits season blue, each player’s listed faction privilege is replaced by the Felonious faction privilege. (Module 0) The Active Law is inactivated, and make a Purge Roll. |
| ✂️ Budget Cuts | d6 5-6, Yellow season | budget_cuts | Each player discards a card of their choice from their Hand to the bottom of the corresponding patent deck. |
| ☀️ Solar Flare | d6 5-6, Red season | solar_flare | Make a 1d6 Flare Roll and apply the result to every card in all non-LEO and unshielded stacks. Adjust the result by the modifier listed in the Heliocentric Zone the stack is in. If rad-hardness < modified result, then decommission the card. |

## Card abilities

Source: `data/card-data.json`, the `Ability` field. Cards are
double-sided (Tier 1 / Tier 2 = the "dark side"). Where both tiers carry
the same ability text it is listed once as "both"; where they differ each
is listed with its tier and face name.

### Thrusters

| Card | Ability |
| --- | --- |
| Photon Heliogyro / Electric Sail (both) | Aerobrake decommission. Immune to Flare & Belt Rolls. |
| Photon Kite Sail (Tier 1) | Aerobrake decommission. Immune to Flare & Belt Rolls. |
| Mag Sail (Tier 2) | Aerobrake decommission. Each Radiation Belt entered = Bonus Burn |

### Robonauts

| Card | Ability |
| --- | --- |
| Lorentz-Propelled Microprobe (Tier 2) | NANITES: One re-roll if fail 1 or more size rolls. |
| MagBeam (Tier 2) | -1 ISRU, +3 thrust if pushed by Powersat. |

### Refineries

| Card | Ability |
| --- | --- |
| Ilmenite Semiconductor Film (Tier 2) | POWER GIRDLE: If used to industrialize a non-atmospheric site of size 8+, you permanently gain the Powersat faction privilege. |
| Von Neumann Santa Claus Machine (Tier 2) | DIVINING NUBOTS: -1 ISRU for Colocated ISRU platform. |
| Carbonyl Volatilization (Tier 2) | THORIUM BREEDER: -3 to Colocated size rolls on S Sites. |
| Solar Carbotherm (Tier 2) | ARCOLOGY: Decommissioning of a robonaut is not needed when this is used to industrialize in the zones Mercury, Venus, Earth |
| Impact Mold Sinter (Tier 2) | FOAMED NICKEL: -1 to Colocated size rolls. |
| Atmospheric Scoop (Tier 2) | SCOOP: If operational, this card makes adjacent or colocated aerostat sites into [2 hydration] |
| Laser-Heated Pedestal Growth (Tier 2) | SUPERLENS: -1 to all Colocated raygun size rolls. |
| Femtochemistry (Tier 2) | SCAVENGING: If Colocated, doubles FTs during site refuel. |
| Biophytolytic Algal Farm (Tier 2) | COMET LICHEN: -2 to Colocated size rolls on D Sites. |
| Termite Nest (Tier 2) | MINE REVIVAL: As an op, remove a busted disk and place Claim on a Colocated Site of Size 2+. |
| Ionosphere Lasing (Tier 2) | IONOSAT: If used to industrialize an Atmospheric Site, permanently gain the Powersat faction privilege. |
| Solid Flame (Tier 2) | JELLYBOTS: Colocated industrialization is a free action. |

### Reactors

| Card | Ability |
| --- | --- |
| Mini-Mag RF Paul Trap / Ultracold Neutrons (both) | SCOOP: -2 ISRU for Colocated ISRU platforms at Aerostat Sites. |
| Project Valkyrie (Tier 2) | When activated, Decommission colocated cards with Rad-Hard <4. |

### Radiators

| Card | Ability |
| --- | --- |
| Li Heatsink Fountain / Thermochemical Heatsink Fountain (both) | [Heavy] Switch to light side after 1st use. |
| Magnetocaloric Refrigerator (Tier 1) | This card can cool its own supports. |

### Generators

| Card | Ability |
| --- | --- |
| Magnetoshell Plasma Parachute (Tier 1) | This stack can safely enter aerobrakes. Cannot be used to support Bernals or during industrialization. |
| Granular Rainbow Corral (Tier 2) | This stack can safely enter aerobrakes. |

### Freighters

| Card | Ability |
| --- | --- |
| Fission GCR (Tier 2) | Can liftoff/land on Sites that are less than size 6 without factory-assist. |
| Fusion Fragment Sail (Tier 1) | Immune to flares & radiation belts. |
| Antiproton Sail and Harvester (Tier 2) | +1 net thrust if starting its move on a radiation belt. |
| Magnetic Mirror Beam Rider (Tier 2) | Can liftoff/land on Sites that are less than size 6 without factory-assist. |
| Inflatable Solar-Heated (Tier 1) | SOLAR HEATED: If not using Powersat, may move out only as far as the Ceres zone. |
| Archimedes Palmer Lens (Tier 2) | SOLAR HEATED: If not using Powersat, may move out only as far as the Jupiter zone. |
| Poodle Steam (Tier 1) | RADIOISOTOPE: +2 thrust if its move starts on a Factory. |

### Bernals

| Card | Ability |
| --- | --- |
| GEO Elevator Bernal (Tier 1) | HOME: Boost direct to Home Bernal without doubling boost costs. |
| Space Elevator Lab (Tier 2) | Your factory-assisted landings/liftoffs anywhere treat lander burns as normal Burn Spaces. |
| L1 Climate Control Bernal (Tier 1) | HOME: You are always the 1st player, superseding all other claimants. |
| Climate Control Lab (Tier 2) | +2 VP per Dirtside for this Bernal. |
| L2 Collimator Bernal (Tier 1) | HOME: Gain the Powersat faction privilege. |
| Collimator Lab (Tier 2) | Gain the Powersat faction privilege. Powersat push includes a Bonus Pivot. |
| L3 Lofstrom Loop Microgravity (Tier 1) | HOME: Boost direct to Home Bernal without doubling boost costs. |
| Lofstrom Loop Microgravity Lab (Tier 2) | Your factory-assisted landings/liftoffs anywhere treat lander burns as normal Burn Spaces. |
| L4 Antimatter Factory (Tier 1) | HOME: Your Crew has an On-Board Nuclear X reactor. |
| Antimatter Lab (Tier 2) | Your Crew has an On-Board Nuclear "ANY" reactor. |
| L4s Pharmaceutics Bernal (Tier 1) | HOME: Gain the Skunkworks faction privilege. |
| Pharmaceutics Lab (Tier 2) | Gain the Skunkworks faction privilege & impose academia hand limit on all opponents. |
| L5 Solar Cell Factory (Tier 1) | HOME: +1 to the Net Thrust of your Spacecraft that use Solar-Power. |
| Solar Cell Lab (Tier 2) | +2 to the Net Thrust of your Spacecraft that use Solar-Power. |
| L5s Cancer Hospital (Tier 1) | HOME: You are immune to budget cuts. |
| Cancer Lab (Tier 2) | Gain +1 Token VP for each Colony Dome. Your Crew and Human Colonists have a rad-hard of at least 7. |
| SSO Diplomatic (Tier 1) | HOME: (Module 0) Your delegates in the Ideology of your Faction color are +1 VP each. |
| Diplomatic Lab (Tier 2) | (Module 0) Your delegates in the assembly are +1 VP each. |
| Tourism Cycler (Tier 1) | HOME: Can designate any Spacecraft to forgo Belt Rolls in the Radiation Belts near Earth. |
| Tourism Hotel (Tier 2) | +2 VP per Dirtside for this Bernal. |

### Colonists

| Card | Ability |
| --- | --- |
| Utility Fog Halbonaut (Tier 2) | All of your stacks are Glitch-free. |
| Group Mind Immortalists (Tier 2) | May perform the faction privileges on both sides of your Crew card. |
| Soldier Caste (Tier 2) | All your Humans can commit Felonies, even if defending Humans are present. |
| Martian Assembly (Tier 2) | Acts as a Freighter when building a Space Elevator. |
| Calypso 2 Seed Sail (Tier 1) | Can't enter aerobrakes. |
| Wet-Nano Seed Sail (Tier 2) | -2 to Colocated size rolls on Synodic Comets. Can't enter aerobrakes. |
| New Attica Secessionists (Tier 2) | Boost costs are doubled for all your opponents. |
| Iceworms (Tier 2) | Performs epic hazard operation as a free action, & is not Decommissioned if it fails. |
| Rental Body Guild (Tier 2) | -1 to Colocated size rolls. |
| Svalbard Caretakers (Tier 2) | -1 on all size rolls when prospecting Synodic Sites. |
| Renaissance Man (Tier 2) | If initiating a research auction, can search through one patent deck and choose the card to be auctioned. |
| Blue Goo Sybonts (Tier 2) | Can produce ET products of Spectral Type C at any Factory. |
| Neumann Matter (Tier 2) | All of your stacks are Glitch-free. |
| Alchemist Aviatrices (Tier 2) | During Factory Refuel, double the amount of isotope fuel. |
| Frankenstein Navigator (Tier 2) | FINAO costs are halved (drop fractions). |
| Josephson Implants (Tier 2) | FINAO costs are halved (drop fractions). |
| Creeper Neogen (Tier 2) | All of your stacks are Glitch-free. |
| Kaluga Naniteers (Tier 2) | Your Aqua from a Free Market is doubled. |
| Eugenic Pilgrims (Tier 2) | Faction privilege not lost in Anarchy. -1 to Colocated size rolls on Synodic Comets. |

## Future goal cards

Source: `data/card-data.json`, the `Future` field (Tier 2 only). These are
endgame objective+reward cards rather than always-on rule overrides, but
the text is printed on the card so it is catalogued here for completeness.

### GW Thrusters

| Card | Future |
| --- | --- |
| Amat-Initiated H-B Magnetic-Inertial | MINI-BLACK HOLE FUTURE: Req = Industrialized centaur with 10 isotope FTs. Effects = double all isotope refuel, 10 VP. |
| Crossfire H-B Focus Fusion | PROTIUM FUSION FUTURE: Req = Promoted Bernal with H Dirtside. Effects = double all isotope refuel, 10 VP. |
| Dusty Plasma | MASS BEAM FUTURE: Req = Promoted Bernal with Io or Triton Dirtside. Effects = your Powersat adds +2 thrust, 7 VP. |
| Solem Medusa Tugged Orion | LITHIATED AMMONIA ICE STARSHIP FUTURE: Req = Ad astra exit with 10 isotope fuel. Effect = 14 VP. |
| Zubrin-GDM | SPACEFARING FUTURE: Req = Bernal with 8+ dirtside hydration. Effects = Allowed 1 extra Colonist, 7 VP. |
| Colliding FRC 3He-D Fusion | ENZMANN STARSHIP FUTURE: Req = Ad astra exit with 2 Promoted Colonists + Mobile Factory. Effect = 12 VP. |
| Daedalus 3He-D Inertial Fusion | FUSION CANDLE FUTURE: Req = Triton Colony & Promoted Bernal with Neptune Aerostat Dirtside. Effects = double all isotope refuel, 14 VP. |

### Freighters

| Card | Future |
| --- | --- |
| Fission GCR | EXOPLANET HUNT FUTURE: Req = Claim Sedna. Effect = (Endgame) 12 VP. |
| Antiproton Sail and Harvester | ANTIMATTER FUTURE: Req = Promoted Bernal with S Dirtside. Effects = double isotope refuel, 10 VP. |
| Magnetic Mirror Beam Rider | STAR WISP FUTURE: Req = Promoted Freighter (End game) at either neutrino sunlens (6 VP) or EM sunlens = 11 VP. |
| Archimedes Palmer Lens | TERRAFORM FUTURE: Req = Promoted Bernal at a non-Martian Atmospheric Dirtside. Effect = 8 VP. |
| D-Nanotube Dirt Launcher | BEANSTALK FUTURE: Req = 3+ Space Elevators built by any player. Effect (Endgame) = +3 VP for each Factory connected to a Space Elevator. |
| KESTS Hoop Dirt Launcher | BEEHIVE ARK FUTURE: Req = Promoted Bernal anchored at a Synodic Comet. Effect = 7 VP. |
| Z-Pinch 3He-D Target Fusion | GOLDEN APPLES FUTURE: Req = Industrialize Kreutz Sungrazer. Effects = Ignore solar flares, 14 VP. |

### Colonists

| Card | Future |
| --- | --- |
| Utility Fog Halbonaut | UPLIFT FUTURE: Req = Robots not Emancipated, Human at a promoted Bernal & spend 20 Aqua. Effects = Every Robot becomes Emancipated, Casus belli for War, 12 VP. |
| Group Mind Immortalists | PAN SAPIENS FUTURE: Req = Have 3 Factories connected to Space Elevators. Effect = Casus belli for War. (Endgame) +2 VP for each glory chit owned. |
| Soldier Caste | SECESSION FUTURE: Req = 2 Promoted Human Colonists at an Anchored Bernal with Dirtside 5+. Effects = Casus belli for War, 10 VP. |
| Martian Assembly | BEANSTALK FUTURE: Req = Have 3+ Space Elevators built by any player. Effect (Endgame) = +3 VP for each Factory connected to a Space Elevator. |
| Wet-Nano Seed Sail | NEW VENUS FUTURE: Req = Decommission operational 7+ net thrust thruster on industrialized Synodic Comet (yours). 12 VP + (Endgame) remove all tokens on Venus & comet. |
| New Attica Secessionists | SECESSION FUTURE: Req = 2 Promoted Human Colonists at a promoted Anchored Bernal. Effects = Casus belli for War, 7 VP. |
| Iceworms | SUBMARINER FUTURE: Req = Build 3 Submarines. Effect = Doubles your dirtside hydration, not cumulative with other modifiers. |
| Rental Body Guild | ET LIFE FUTURE: Req = Have 2 or more Astrobiological Colonies. Effect (Endgame): +2 VP per Astrobiological Colony. |
| Svalbard Caretakers | DYSON BUBBLE FUTURE: Req = Both Sites of Mercury industrialized by any player. Effects = 5 VP per Factory owned on Mercury. |
| Renaissance Man | ARTIFICIAL CONSCIOUSNESS FUTURE: Req = 2 promoted Colonists at an Astrobiology Dirtside. Effects = May free market any number of cards, 10 VP. |
| Blue Goo Sybonts | SETI FUTURE: Req = Industrialize 2 Jovian Tojans, 1 each in the Greek & Trojan camps. Effects = As a free action perform 1 inspiration + 1 homestead, 10 VP. |
| Neumann Matter | UPLIFT FUTURE: Req = Robots not Emancipated, Human at a promoted Bernal & spend 20 Aqua. Effects = Every Robot becomes Emancipated, Casus belli for War, 12 VP. |
| Alchemist Aviatrices | AEROSTAT FUTURE: Req = Promoted Bernal with Aerostat Dirtside. Effects = Can homestead as a free action, 14 VP. |
| Frankenstein Navigator | UPLIFT FUTURE: Req = Robots not Emancipated, Human at a promoted Bernal & spend 20 Aqua. Effects = Every Robot becomes Emancipated, Casus belli for War, 12 VP. |
| Josephson Implants | SUPREME CULT FUTURE: Req = Active Law in authority. Effects (Module 0) = May lobby w/o removing the delegate used. All Seniority Disks migrate to authority. (Endgame): 10 VP. |
| Creeper Neogen | UPLIFT FUTURE: Req = Robots not Emancipated, Human at a promoted Bernal & spend 20 Aqua. Effects = Every Robot becomes Emancipated, Casus belli for War, 12 VP. |
| Kaluga Naniteers | TNO FUTURE: Req = Industrialize 2 Sites in the Neptune Zone. Effects = Can homestead as a free action, 12 VP. |
| Eugenic Pilgrims | FOOTFALL FUTURE: Req = Decommission operational 7+ net thrust thruster on Industrialized Synodic Comet (yours). Effects = 10 VP + Casus belli. (Endgame) All tokens on the comet eliminated. |

---

Totals: 12 crew faction privileges, 6 Sunspot events, 69 card abilities, 32 future goal cards.
