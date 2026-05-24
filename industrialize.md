# Industrialize - requirements

Working doc for the factories / colonies slice. Treat the **Spec**
section as locked unless flagged otherwise; the **Open questions**
section below it is still negotiable.

## Spec (locked)

### Industrialize action (builds a factory)

- **Stack scope**: requires a **Rocket Stack** at the site.
  Outposts cannot industrialize on their own in this variant
  (see "Outpost capabilities" below).
- **Trigger**: a player-driven action on a site that already
  carries a successful prospect claim disc.
- **Prerequisites** (all colocated at the target site as part of
  the rocket stack):
  - one **active refinery** with its support requirements met by
    other cards in the stack;
  - one **active robonaut** with its support requirements met by
    other cards in the stack;
  - **nothing else** is required to industrialize.
- **Result**: a factory chit (🏭) is placed on the site. The
  factory IS the refinery for that site - there is no separate
  refinery upgrade, no two-tier model.
- **Decommission**: industrialize **decommissions** the refinery,
  the robonaut, and every card in their **support chains** -
  i.e. the supports that satisfied the refinery + robonaut's
  requirements, plus the supports of those supports, transitively.
  - **Radiators are exempt** from this decommission (house rule
    on top of published I7). Radiators stay in the stack even
    when they were part of a support chain.

### Colonize action (turns crew into colony domes)

- **Trigger**: a **free action** (no operation cost). Available
  whenever the prerequisites are met.
- **Prerequisites**:
  - a colocated **Human** card (Crew or Colonist) in the player's
    stack at a factory site;
  - the factory does **not** already host a colony (one-colony-
    per-factory cap, rulebook G3).
- **Result**: one colony dome (🌐) is placed on the factory. To
  colonize multiple factories the player runs the free action
  once per factory; multiple humans colocated at one factory do
  not stack into a single mega-colony.
- **Aftermath**: the consumed crew card **returns to the LEO
  Stack** (variant rule; overrides published G3a which would
  decommission). It is available to be re-boosted onto another
  rocket without paying a new Boost cost - it's already in LEO.

### Stack model

The player owns a small fixed set of stacks at any time:

- **LEO Stack** - fixed at Earth, no figure on the map. Holds
  cards that have been boosted but not yet flown. The player's
  Bank (aqua + isotopes) lives here.
- **Rocket Stack** - at most **one** active rocket figure per
  player on the map. The rocket can move once per turn.
- **Outpost Stacks** - up to **four** outpost chits per player,
  labelled `A`, `B`, `C`, `D`. Each chit lives at a specific
  site. The variant doubles the published cap of 2 (which was a
  pure component limit, see rulebook E3c-d).

Cargo Transfer (rulebook G1) is a **free action**, **unlimited**
times per turn, between any two **colocated** stacks owned by
the player. Special-case: the Rocket Stack is treated as
colocated with the LEO Stack whenever the rocket is at LEO; if
the player has no active rocket figure on the map, treat the
rocket as parked at LEO with an empty (possibly-zero-card)
stack, so LEO Stack transfers still work as the natural default.

**Movement-vs-transfer ordering** (variant rule, consistent with
published D1): the rocket may move before or after a transfer in
the same turn, but cannot move, transfer, then move again. Once
a transfer has been performed on the rocket, the rocket's per-
turn movement is locked.

### Rocket ↔ Outpost conversion

- **Rocket → Outpost**: the player may convert their active
  Rocket Stack into a new Outpost Stack at the rocket's current
  site at any time during their turn. This consumes one of the
  four outpost slots (A/B/C/D). The rocket figure returns to the
  player's reserve. The cards/fuel stay at the site as the
  outpost's contents.
- **Outpost → Rocket**: the player may convert an existing
  Outpost Stack into the active Rocket Stack, provided the
  outpost contains a thruster with all support requirements
  satisfied by other cards in the same outpost (i.e. an
  operational thruster). The outpost chit returns to the
  reserve, freeing its slot; the rocket figure moves to the
  outpost's site and inherits all its cards / fuel.
- **One rocket at a time**: locked at one Rocket Figure per
  player (matches published, see rulebook E3a). To convert an
  outpost into a rocket while a rocket is already active, the
  player must first convert the current rocket into an outpost
  (or dissolve it).

### Outpost capabilities

An outpost can support these operations on its own (no rocket
needed):

- **Factory-Refuel Op** (rulebook I5b): an outpost at a site
  with the player's factory produces 7 blue FTs (water) or 1
  gold FT (isotope) per op. The FTs land in the outpost (or any
  colocated stack via free transfer).
- **ISRU Refuel Op** (rulebook I5a): an outpost containing an
  **operational robonaut** (active, all supports met) can run
  ISRU at the site. Yield = 1 + site hydration - robonaut ISRU,
  per published.
- **ET Production Op** (rulebook I8): runnable at any of the
  player's factories. The produced card lands in an outpost
  stack at that location. If no outpost exists there yet, one
  of the four slots is consumed to create one; if an outpost is
  already there, the card joins it.

An outpost **cannot**:

- Industrialize (rocket-only in this variant).
- Move (outposts are stationary chits).
- Initiate a Prospect operation (rockets only; prospecting
  requires the spacecraft to fly to the site).

Cards in an outpost can be:

- Discarded (free action, G6).
- Delivered back to LEO at a water cost (rulebook I9 Delivery
  Op; specifics deferred to a later spec round).

### Visual language

- Factory: `🏭`
- Colony: `🌐` (a colonized factory renders both: `🌐🏭`).
- Outpost: `🏛` plus its slot letter, e.g. `🏛A`, `🏛B`, `🏛C`,
  `🏛D`. Each outpost chit moves to the site where the outpost
  is formed.
- Rocket: existing sandbox rocket sprite (unchanged).

### UI: stack-switcher in the hand bar

The hand bar gains a row of stack-buttons mapping to each of the
player's active stacks:

- `🌍 LEO` - always present (the LEO Stack always exists, even
  if empty / aqua-only).
- `🚀 Rocket` - present when a rocket figure is on the map.
- `🏛A`, `🏛B`, `🏛C`, `🏛D` - one button per active outpost
  slot, in slot order. Hidden slots fold up.

Tapping a stack button focuses that stack: the cards-in-stack
panel in the hand bar shows that stack's contents (instead of
the hand), the map flies to the stack's site, and follow-up
actions (transfer, ops) target it. The hand itself stays one
tap away (a separate `✋ Hand` chip or the existing default
view).

### Colony cards (new card type)

This version introduces **colony cards** as a new card type
distinct from patents and crew. A colony card is the persistent
representation of a colony dome dropped at a factory. Schema +
how it differs from crew / colonist cards is still open (see
section F).

## Open questions

The big ones are now locked in **Spec**. What's left are the
finer-grained UX / data-model decisions that gate the
implementation PR.

### A. Industrialize action

- [?] **A1.** Decommission destination - bottom of patent deck
  (matches rulebook G6), discard pile (lost forever), or back
  to player's hand?
- [?] **A2.** Op cost - does industrialize spend the per-turn
  Operation, or is it free given the prereqs?
- [?] **A3.** Factory production model - refuel-only (rulebook
  I5b), or does the factory also produce passive end-of-round
  aqua income?
- [?] **A4.** Spectral type on a factory chit - inherit from
  the refinery card, the site's dominant spectral, or chosen
  by the player at build time?
- [?] **A5.** VP - does industrialize award VP at build (and
  how many), or only via end-game token counting (rulebook M2a
  scores tokens at endgame)?
- [?] **A6.** Support-chain semantics - if card X supports the
  refinery and card Y supports X, and Y also supports a card
  still in the stack (not in the chain), is Y decommissioned?
- [?] **E1.** Confirm-modal on industrialize that lists exactly
  which cards will be decommissioned (with a Cancel)?
- [?] **E2.** If a stack has multiple valid refineries or
  robonauts, does the player pick the pair, or does the engine
  pick deterministically (e.g. lowest mass)?

### B. Colonize action

- [?] **B3.** Does the colonized crew's `Promotion Colony`
  field (D / H / Atmospheric / Astrobiology / Submarine, see
  Colonists table) gate which factory can accept it, or does
  any factory take any crew?
- [?] **B5.** VP - does colonize award VP at build, only at
  endgame (rulebook M2b lists Astrobiology +1 / Submarine +2),
  or both?

### C. Stacks & UI

- [?] **C1.** Active-stack indication - the focused stack
  highlights its button in the hand bar, but does the map also
  paint a ring around the focused stack's site?
- [?] **C2.** Hand sharing - confirm: one hand feeds all stacks
  (cards in hand can be boosted to LEO and then transferred to
  any stack via colocation).
- [?] **C3.** Aqua bank - confirm: one shared bank at LEO,
  per-stack water tanks for FTs (matches rulebook E3a / F3b).
- [?] **C4.** Outpost-slot reuse - when an outpost is dissolved
  (empty cards + empty FTs, rulebook G6), does its A/B/C/D
  slot label go back to the pool for re-use, or do slots
  permanently retain their original site assignment until end-
  of-game?
- [?] **C5.** Outpost slot assignment - first-empty wins
  (deterministic A → B → C → D), or does the player pick which
  slot a new outpost lands in?

### D. Map rendering

- [?] **D1.** Glyph stacking for 🌐 + 🏭 on the same factory -
  side-by-side `🌐🏭`, 🌐 above 🏭, or 🌐 as a small ring on
  top of the factory chit?
- [?] **D2.** Multi-card indicator at sites that host both an
  outpost and a rocket - render two sprites or one with a
  badge?
- [?] **D3.** Outpost chit visual: just `🏛A` etc. as text, or
  a styled chit (background + letter)?

### F. Colony cards as a card type

- [?] **F1.** Schema beyond `{ siteId, ownerId, spectralType }`
  - does a colony card carry its own Mass / Rad-Hard / Ability
  text, or just identity + location?
- [?] **F2.** Card-supply model - finite deck the colony cards
  are drawn from (capped supply), or minted on demand at
  colonize time?
- [?] **F3.** Crew Ability inheritance - does the colony
  retain the consumed crew's Ability text, or is that ability
  lost when the crew returns to LEO?
- [?] **F4.** Visibility - colony cards shown in a player-
  owned "Colonies" sidebar panel, on the site popup, both?
- [?] **F5.** Promotion - rulebook references "promoted
  colonies" (Astrobiology / Submarine give bonus VP at
  endgame, M2b). Is promotion automatic at colonize time, or
  a separate later action?

### G. Rocket ↔ Outpost conversion

- [?] **G1.** Rocket → Outpost: is the conversion itself a
  **free action**, or does it consume the per-turn op / move?
- [?] **G2.** Outpost → Rocket: same question - free, op, or
  uses the per-turn move budget? Can the newly-formed rocket
  also move on the same turn it converted?
- [?] **G3.** Outpost dissolves when empty (rulebook G6) -
  confirm this auto-frees the A/B/C/D slot in our variant?

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
