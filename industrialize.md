# Industrialize - requirements

Working doc for the factories / colonies slice. Treat the **Spec**
section as locked unless flagged otherwise; the **Open questions**
section below it is still negotiable.

## Spec (locked)

### Industrialize action (builds a factory)

- **Trigger**: a player-driven action on a site that already
  carries a successful prospect claim disc.
- **Prerequisites** (all colocated at the target site as part of
  the same ship stack):
  - one **active refinery** with its support requirements met by
    other cards in the stack;
  - one **active robonaut** with its support requirements met by
    other cards in the stack;
  - **nothing else** is required to industrialize.
- **Result**: a factory chit is placed on the site. The factory
  IS the refinery for that site - there is no separate refinery
  upgrade, no two-tier model.
- **Decommission**: industrialize **decommissions** the refinery,
  the robonaut, and every card in their **support chains** -
  i.e. the supports that satisfied the refinery + robonaut's
  requirements, plus the supports of those supports, transitively.
  - **Radiators are exempt** from this decommission. Radiators
    stay in the stack even when they were part of a support
    chain.

### Colonize action (turns crew into colony domes)

- **Trigger**: a **free action** (no operation cost). Available
  whenever the prerequisites are met.
- **Prerequisites**: one or more **crew cards colocated** at a
  factory site (in the same stack as the industrializing rocket,
  on the factory itself).
- **Result**: each colocated crew card converts into a **colony
  dome** at the factory site.
- **Aftermath**: the consumed crew card **returns to LEO**. (Exact
  destination - hand, LEO availability pool, an LEO stack - is
  an open question; see B4 below.)

### Visual language

- Factory: `🏭`
- Colony: `🌐`
- A factory hosting one or more colonies renders both: `🌐🏭`.

### Multi-stack (forward-looking)

A player can have more than one ship stack in play. Industrialize
and colonize ops target a specific stack at a specific site, not
"the rocket". Implementation of multi-stack is staged - see
"Open questions" section C - but the data model must not assume
single-stack from this slice onward.

### Colony cards (new card type)

This version introduces **colony cards** as a new card type
distinct from patents and crew. A colony card is the persistent
representation of a colony dome dropped at a factory. Schema +
how it differs from crew / colonist cards is still open (see
section F).

## Open questions

Marked `[?]` and grouped. Need answers before implementation.

### A. Industrialize action

- [?] **A1.** Decommission destination - does a decommissioned
  refinery / robonaut / support card go to the discard pile, to
  the player's hand, or vanish from the game entirely?
- [?] **A2.** Does industrialize cost an operation, water, or is
  it free given the prereqs?
- [?] **A3.** What does the factory chit produce, and when?
  (refuel? aqua income? exo-production capability matched on
  spectral? something else?)
- [?] **A4.** Spectral type on a factory chit - inherit from the
  refinery card, the site, the robonaut, or some combination?
- [?] **A5.** VP - does industrializing award VP at the moment
  of build, or do VPs come only through later glory hooks
  (e.g. industrialize the second site on a body for a chit)?
- [?] **A6.** "Support chain" decomposition - if card X
  supports the refinery, and card Y supports card X, do both
  X and Y get decommissioned, even if Y also supports something
  else still in the stack?

### B. Colonize action

- [?] **B1.** Where do colonies live in the data model?
  - on the factory site (one factory = many possible colonies),
  - on the body (one colony slot per body),
  - in a player-owned colony inventory referencing the site.
- [?] **B2.** Can multiple crews at the same factory be colonized
  in one free action, or one at a time?
- [?] **B3.** Does the colonized crew's Promotion Colony field
  (D / H / Atmospheric / Astrobiology / Submarine) constrain
  which sites can host the resulting colony, or does any factory
  accept any crew?
- [?] **B4.** "Returns to LEO" - which destination?
  - back to the player's hand at LEO,
  - into a LEO availability pool the player draws from,
  - into the LEO stack of an existing rocket.
- [?] **B5.** VP - colonize awards VP at the moment of
  conversion, at end-game scoring, or both?
- [?] **B6.** Does an existing colony at the factory block or
  enable further colonizes? (Multiple colonies stacked at one
  factory, or strict 1-per-site cap?)

### C. Multi-stack support

- [?] **C1.** Switching stacks - top-bar dropdown, click the
  rocket on the map, both?
- [?] **C2.** Are stacks named / numbered, or addressed only by
  current location?
- [?] **C3.** Hand sharing - one hand feeding all stacks, or per-
  stack hands?
- [?] **C4.** Aqua bank - shared across stacks, or per-stack tank?
- [?] **C5.** Starting state - one stack at LEO, or several at
  LEO?
- [?] **C6.** Refactor scope - lift `rocket.js` into a
  `stacks.js` keyed-by-id module in this PR, or stay single-
  stack and refactor next PR?

### D. Map rendering

- [?] **D1.** Factory + colony glyph layout - stacked, side by
  side, or 🌐 as a small ring over the 🏭?
- [?] **D2.** Multi-stack indicator at a site - count badge on
  one sprite, or two staggered sprites?

### E. Decommission UX

- [?] **E1.** When the player previews industrialize, do we show
  a confirm modal that lists exactly which cards are about to
  be decommissioned (so the player can back out)?
- [?] **E2.** If a stack has multiple valid refineries or
  multiple valid robonauts, who picks which pair gets consumed?

### F. Colony cards as a card type

- [?] **F1.** What fields does a colony card carry beyond
  `{ siteId, ownerId, spectralType }`? Does it have its own
  Mass / Rad-Hard / Ability text?
- [?] **F2.** Are colony cards drawn from a finite deck (limited
  supply), or minted on demand at colonize time?
- [?] **F3.** Inheritance from the consumed crew - does the
  colony retain the crew's Ability text, or is the ability
  banked elsewhere and the colony card is purely positional?
- [?] **F4.** Visibility - is the colony card shown in some
  player-owned "colonies" panel, on the site popup, or both?

## What we keep from the existing sandbox

- Prospect discs (`discs.js`) - claim markers are the precondition
  for industrialize.
- Aqua bank + per-stack tank (`rocket.js`) - any factory income
  routes through here.
- Mission log (`mission-log.js`) - new ops log here.
- Glory module (`glory.js`) - any VP award routes through
  `addVps` so totals stay reconciled.
- Turn clock - end-of-round hook is where refinery-style income
  fires.

## What we throw away from the previous attempt

For PR history reference:

- Any "factory vs refinery" two-tier model.
- The `factories.js` module that backed it.
- All Bernal collapse code, modal, and render layer.
- The colonist counter chip (replace with whatever the new colony
  inventory needs).

## Reference: the published HF4 Colonists deck

This is the canonical crew / colonist deck extracted from
`reference/HF4-card-data.xlsx`'s **Colonists** sheet. Every
physical card is double-sided: row `NA` is the primary (tier-1)
face, row `NB` is the secondary (tier-2 / dark-side) face. Each
face is a functionally independent crew member with its own
stats.

Column key:

- **Type** - `Robot` or `Human`. Robots double as robonauts when
  their `Robo kind` column is non-empty.
- **Specialty** - `Engineer / Miner / Prospector / Industrialist`.
- **Spec** - colonist's own spectral type (Robots: H/D; Humans:
  n/a). Used by exo-production matching.
- **Promo** - which type of colony this crew promotes into when
  colonized (`D` dirt, `H` habitat, `Atmospheric`, `Astrobiology`,
  `Submarine`).
- **Ideol** - human faction ideology colour (n/a for robots).
- **Mass / Rad** - wet mass + radiation hardness.
- **Thrust / Fuel** - non-empty only for crew cards that double
  as thrusters (e.g. Calypso 2 Seed Sail, Juiced Cosmonauts,
  Programmable Matter). `Fuel` shows consumption + fuel type.
- **ISRU** - water-rating gate (a non-empty value means this
  colonist is robonaut-capable).
- **Robo kind** - which prospector kinds this colonist can run
  (🚀 Missile, 🔫 Raygun, 🛺 Buggy). Empty means non-robonaut.
- **Reactor sup** - reactor-support chips this colonist supplies
  (X fission / ∿ fusion / 💣 antimatter). Lets crew satisfy a
  reactor support requirement on a stacked card.
- **Caps** - non-prospector capability flags (Push / Solar /
  AirEater / Bonus pivots).
- **Ability** - special-effect text printed on the card (tier-2
  only carries the printed Ability; tier-1 abilities are usually
  blank or just stat-based).

| # | Card (face) | Type | Specialty | Spec | Promo | Ideol | Mass | Rad | Thrust | Fuel | ISRU | Robo kind | Reactor sup | Caps | Ability |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1A | Babbage Halbonauts | Robot | Engineer | H | D | n/a | 2 | 5 | - | - | 4 | 🛺B | - | - |  |
| 1B | Utility Fog Halbonaut | Robot | Engineer | H | D | n/a | 2 | 5 | - | - | 2 | 🛺B | - | - | All of your stacks are Glitch-free. |
| 2A | Biomechs | Human | Miner | n/a | H | Yellow | 2 | 4 | - | - | 3 | 🛺B | - | - |  |
| 2B | Group Mind Immortalists | Human | Miner | n/a | H | Yellow | 2 | 5 | - | - | 2 | 🛺B | - | - | May perform the faction privileges on both sides of your Crew card. |
| 3A | Botany Bay Convicts | Human | Miner | n/a | H | Purple | 2 | 4 | - | - | 4 | 🛺B | - | - |  |
| 3B | Soldier Caste | Human | Miner | n/a | H | Purple | 2 | 9 | - | - | 2 | 🔫R 🛺B | 💣 | - | All your Humans can commit Felonies, even if defending Humans are present. |
| 4A | Boyle Engineering Collective | Human | Prospector | n/a | Atmospheric | Yellow | 3 | 5 | - | - | 3 | 🛺B | - | - |  |
| 4B | Martian Assembly | Human | Prospector | n/a | Atmospheric | Yellow | 3 | 6 | - | - | 2 | 🛺B | - | - | Acts as a Freighter when building a Space Elevator. |
| 5A | Calypso 2 Seed Sail | Human | Prospector | n/a | Astrobiology | Green | 1 | 3 | 0 | 0 Water | 4 | 🚀M 🔫R | - | Push Solar +1piv | Can't enter aerobrakes. |
| 5B | Wet-Nano Seed Sail | Human | Prospector | n/a | Astrobiology | Green | 1 | 5 | 1 | 0 Water | 1 | 🚀M 🔫R | - | Push Solar +1piv | -2 to Colocated size rolls on Synodic Comets. Can't enter aerobrakes. |
| 6A | Heavy Water Survivalists | Human | Engineer | n/a | Submarine | Red | 2 | 5 | - | - | 4 | 🔫R | - | - |  |
| 6B | New Attica Secessionists | Human | Engineer | n/a | Submarine | Red | 2 | 6 | - | - | 2 | 🔫R | - | - | Boost costs are doubled for all your opponents. |
| 7A | House of Saud | Human | Miner | n/a | H | Purple | 2 | 3 | - | - | 3 | 🛺B | - | - |  |
| 7B | Iceworms | Human | Miner | n/a | H | Purple | 2 | 4 | - | - | 1 | 🛺B | - | - | Performs epic hazard operation as a free action, & is not Decommissioned if it fails. |
| 8A | Juiced Cosmonauts | Human | Prospector | n/a | H | Purple | 1 | 4 | 10 | 4 Water | 3 | 🚀M | - | - |  |
| 8B | Rental Body Guild | Human | Prospector | n/a | H | Purple | 1 | 6 | 12 | 4 Water | 2 | 🚀M | ∿ | AirEater | -1 to Colocated size rolls. |
| 9A | Lloyd's Salvage Co. | Human | Industrialist | n/a | Astrobiology | Grey | 1 | 5 | - | - | - | - | - | - |  |
| 9B | Svalbard Caretakers | Human | Industrialist | n/a | Astrobiology | Grey | 1 | 6 | - | - | - | - | - | - | -1 on all size rolls when prospecting Synodic Sites. |
| 10A | Malcolm | Human | Industrialist | n/a | H | Red | 1 | 3 | - | - | - | - | - | - |  |
| 10B | Renaissance Man | Human | Industrialist | n/a | H | Red | 1 | 4 | - | - | - | - | - | - | If initiating a research auction, can search through one patent deck and choose the card to be auctioned. |
| 11A | Microgravity Pantrophists | Human | Engineer | n/a | H | Grey | 3 | 5 | - | - | - | - | - | - |  |
| 11B | Blue Goo Sybonts | Human | Engineer | n/a | H | Grey | 3 | 6 | - | - | - | - | - | - | Can produce ET products of Spectral Type C at any Factory. |
| 12A | Programmable Matter | Robot | Prospector | D | D | n/a | 1 | 4 | 2 | 4 Water | 3 | 🚀M | ∿ | Push |  |
| 12B | Neumann Matter | Robot | Prospector | D | D | n/a | 1 | 5 | 4 | 4 Water | 1 | 🚀M | ∿ | Push | All of your stacks are Glitch-free. |
| 13A | Rock Rats Miners' Union | Human | Miner | n/a | H | Green | 3 | 5 | - | - | 3 | 🔫R | 💣 | AirEater |  |
| 13B | Alchemist Aviatrices | Human | Miner | n/a | H | Green | 3 | 6 | - | - | 0 | 🔫R | 💣 | - | During Factory Refuel, double the amount of isotope fuel. |
| 14A | Security System | Robot | Industrialist | D | D | n/a | 1 | 4 | - | - | - | - | - | - |  |
| 14B | Frankenstein Navigator | Robot | Industrialist | D | D | n/a | 1 | 5 | - | - | - | - | X | AirEater | FINAO costs are halved (drop fractions). |
| 15A | Siren Cybernautics Inc. | Human | Engineer | n/a | Submarine | Green | 3 | 5 | - | - | - | 🚀M 🔫R 🛺B | - | Push Solar AirEater |  |
| 15B | Josephson Implants | Human | Engineer | n/a | Submarine | Green | 3 | 6 | - | - | - | 🚀M 🔫R 🛺B | - | Push Solar AirEater | FINAO costs are halved (drop fractions). |
| 16A | Smart Pets | Robot | Miner | D | D | n/a | 0 | 3 | - | - | 3 | 🛺B | - | - |  |
| 16B | Creeper Neogen | Robot | Miner | D | D | n/a | 0 | 6 | - | - | 2 | 🛺B | - | - | All of your stacks are Glitch-free. |
| 17A | Transorbital Railworkers | Human | Engineer | n/a | H | White | 2 | 4 | - | - | - | - | - | - |  |
| 17B | Kaluga Naniteers | Human | Engineer | n/a | H | White | 2 | 5 | - | - | - | - | - | Push | Your Aqua from a Free Market is doubled. |
| 18A | Vatican Observers | Human | Industrialist | n/a | Astrobiology | White | 1 | 4 | - | - | - | - | - | - |  |
| 18B | Eugenic Pilgrims | Human | Industrialist | n/a | Astrobiology | White | 1 | 5 | - | - | - | - | - | - | Faction privilege not lost in Anarchy. -1 to Colocated size rolls on Synodic Comets. |

**Source**: `reference/HF4-card-data.xlsx` -> `Colonists` sheet
(extracted via `scripts/extract-card-data.py`). 18 physical cards
× 2 faces = 36 distinct crew members.

### Promotion Colony distribution

Tally of `Promo` values across the 18 cards (primary face), so we
can size the "colony cards" deck appropriately:

| Promotion | Count | Notes |
|---|---|---|
| H (Habitat / generic) | 8 | the default colony type |
| D (Dirtside) | 4 | all Robot cards |
| Astrobiology | 3 | Lloyd's, Calypso 2, Vatican Observers |
| Atmospheric | 1 | Boyle Engineering Collective |
| Submarine | 2 | Heavy Water Survivalists, Siren Cybernautics |

Most colonies will be the generic H type; the four specialised
types (D, Atmospheric, Astrobiology, Submarine) gate specific
faction-future requirements.

### Robonaut-capable crew

Subset of the deck whose primary face exposes a `Robo kind` chip
(can run as an active robonaut for industrialize):

| Card (primary) | Type | Robo | ISRU | Reactor sup | Notes |
|---|---|---|---|---|---|
| Babbage Halbonauts | Robot | 🛺B | 4 | - | high-ISRU buggy |
| Biomechs | Human | 🛺B | 3 | - |  |
| Botany Bay Convicts | Human | 🛺B | 4 | - | high-ISRU buggy |
| Boyle Engineering Collective | Human | 🛺B | 3 | - |  |
| Calypso 2 Seed Sail | Human | 🚀M 🔫R | 4 | - | dual-kind sail-thruster |
| Heavy Water Survivalists | Human | 🔫R | 4 | - |  |
| House of Saud | Human | 🛺B | 3 | - |  |
| Juiced Cosmonauts | Human | 🚀M | 3 | - | also thrusts (10/4) |
| Programmable Matter | Robot | 🚀M | 3 | ∿ | also thrusts (2/4) |
| Rock Rats Miners' Union | Human | 🔫R | 3 | 💣 | supplies antimatter |
| Siren Cybernautics Inc. | Human | 🚀M 🔫R 🛺B | - | - | all three kinds |
| Smart Pets | Robot | 🛺B | 3 | - |  |

11 of 18 cards expose at least one robonaut kind on their primary
face. The rest (Lloyd's Salvage Co., Malcolm, Microgravity
Pantrophists, Security System, Transorbital Railworkers, Vatican
Observers, plus the no-ISRU column on Lloyd's etc.) are pure-
colonist cards with no prospecting role.

## Next steps

1. User answers the `[?]` questions above (or marks them
   "decide later, code minimal").
2. Locked decisions move up into the Spec section.
3. Implementation PR cites this doc and matches the spec.
