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

### Colonies are tokens, not cards

Colonies are **dome tokens** placed on factories - there is no
"colony card" type. Each colony is a per-factory record
`{ siteId, ownerId }`. Cap per player: 7 domes (matches rulebook
B8). The published "promoted colonies" concept (which would award
+1 Astrobiology / +2 Submarine endgame, M2b) is part of the
**expansion** and is out of scope for this slice - crews cannot
be promoted ever in our variant.

The Colonists table's `Promotion Colony` column (D / H /
Atmospheric / Astrobiology / Submarine) is **reference data only**
- the field has no in-game effect in this variant. It's preserved
in the table so that future expansion work can wire it up.

### Operations budget (variant)

The player has **one Operation per turn, total**, regardless of
how many stacks they own. Matches published D1b. Four outposts
don't grant four ops - they grant four storage/staging nodes.

Each of the following consumes the single per-turn op:

- **Prospect** (I6)
- **Industrialize** (I7)
- **ET Production** (I8)
- **Factory-Refuel** (I5b)
- **ISRU Refuel** (I5a)
- **Boost** (I4) - one batch per turn, multi-card allowed
- **Income** (I1) - +1 aqua

Variant override: **Air-eater Refuel** (rulebook I5c) is a
**free action** in this variant, not an op. Easier to plumb
during aerobrake hazard rolls.

Deferred (will land after I7/I8):

- **Research Auction** (I2)
- **Free Market** (I3)
- **Delivery Op** (I9)

### Sandbox card-economy toggle (deferred)

A sandbox-only setting picks how the patent economy behaves:

- **Free Library (default)**: patents are free draws, auctions
  cost nothing, both still consume the 1-op-per-turn budget.
  Matches the current sandbox flow.
- **Card Market (on)**: Research Auction (I2) requires the
  player to consume a card from hand to participate; Free
  Market (I3) sells a card for $3 aqua. Both still consume the
  1-op-per-turn budget.

Toggling the setting **resets the game** (the patent decks and
aqua bank re-seed). Surfaces as a switch in the sandbox setup
panel.

**Not implemented yet.** Both Research Auction and Free Market
ops currently show a notice dialog: "Market cards not available
in this build." The toggle UI lands with the ops in the
follow-up PR after I7 / I8.

### Turn ordering (variant + rulebook)

Per rulebook D1: a turn is `[free actions] + (move + op in
either order) + [free actions]`. Move is atomic; no ops or
free actions during a move. Op is atomic; no free actions
during an op. Each is once per turn max.

Variant addition: once a Cargo Transfer (free action G1) has
been performed on the rocket, the rocket's per-turn move is
locked. So move-then-transfer is fine; transfer-then-move is
fine; move-then-transfer-then-move is forbidden.

### Op cost + commit UX (industrialize)

- Industrialize costs the player's **per-turn Operation** (matches
  rulebook I7). One op per turn means a player can either
  industrialize OR run another operation (Boost / Auction / Refuel
  / ET-Produce / etc.) - not both.
- The Industrialize commit UI **shows a confirm modal** listing
  every card about to be decommissioned (refinery + robonaut +
  full support chain), with radiators flagged as "kept" and a
  Cancel / Confirm pair. Protects against misclicks; the modal
  is also the place where the player picks which refinery /
  robonaut pair gets consumed when multiple valid options exist.

### Support-chain decommission semantics

Industrialize walks the support chain rooted at the chosen
refinery + robonaut and decommissions every card it visits,
**except radiators**.

When a support card `Y` in that chain was ALSO supporting some
other card `Z` in the same stack (one that isn't part of the
industrialize op), `Y` is still decommissioned. `Z` is left in
the stack but loses its support and becomes **inactive** - any
op that depended on `Z` (e.g. the rocket's active thruster) is
now unavailable until the player fixes the support. The
confirm modal **flags `Z` to the player** as a side-effect of
the industrialize so the player isn't surprised when their
thruster goes dark after the build.

### Decommission / removal destinations

Two separate code paths:

- **Industrialize-decommission** (cards removed as the op cost
  of I7): refinery + robonaut + support chain go to the **bottom
  of their corresponding patent deck** (matches rulebook G6).
  They can re-enter play later via the auction / research
  mechanisms. This is the published cost-bite.
- **Card removal in every other scenario** (variant rule):
  - **Voluntary**: player decommissions cards from a stack -
    cards return to the player's **hand**.
  - **Involuntary**: rocket explosion / radiation blast / glitch
    trigger removes cards - they return to the player's **hand**.
  No bottom-of-deck loss outside the industrialize op. Mirrors
  the colonize-returns-to-LEO idiom: only specific, op-gated
  losses bite the patent economy.

### Factory production (no passive income)

A built factory produces **only** through explicit ops:

- **Factory-Refuel Op** (rulebook I5b): 7 blue FTs (water) or
  1 gold FT (isotope) per op, placed in a colocated stack (or
  creating an outpost there).
- **ET Production Op** (rulebook I8): produces a Hand card
  Black-Side-up at the factory, into the colocated outpost
  stack (creating a new outpost if needed - consumes one of
  the player's 4 outpost slots).

No passive end-of-round aqua income from factories. Tightens
the economy: factories are valuable because they ENABLE refuel
ops, not because they tick aqua on the clock.

### VP timing (endgame only)

Industrialize and Colonize award **no VP at build time**. All VP
is tallied at endgame per rulebook M2:

- +1 VP per wooden / plastic token in your colour on the map
  (rockets, claims, factories, colony domes, outposts).
- Spectral-based factory stock-price bonus (+4 / +5 / +8 per
  Exploitation Track, M2b).
- Glory & Heroism chits as printed.

End-of-round refinery income is therefore **aqua-only** (zero
VP delta), and the VP counter in glory.js only ticks at
end-of-game scoring.

### Outpost slot assignment

When the player creates a new outpost (rocket conversion or
ET production at a new site), they **pick** which free slot
(A / B / C / D) it takes via a small picker. Lets the player
keep stable visual mapping (e.g. "A is always my Mars outpost").
Slots return to the pool when an outpost dissolves (empty cards
+ empty FTs, rulebook G6) and can be re-used freely after.

## Open questions

The big mechanical decisions are now locked in **Spec**. What
remains are minor UX shape questions that can be defaulted in
the implementation PR and revisited if the defaults read wrong.

### UX defaults that the implementation will adopt

- **Active stack indication on the map**: the focused stack's
  site gets a thin ring overlay so the player can spot it
  without checking the hand bar.
- **Hand sharing**: one shared hand at LEO. Cards in hand are
  boosted to LEO and then transferred (G1) to any colocated
  stack.
- **Aqua bank**: one shared Bank at LEO. Each stack carries
  its own water-FT tank (matches rulebook E3a / F3b).
- **🌐 + 🏭 glyph layout**: 🌐 painted as a small ring on top
  of the 🏭 chit.
- **Rocket + outpost colocated**: two staggered sprites at the
  site, slightly offset.
- **Outpost chit visual**: styled chit (background + letter),
  not bare emoji text.

### Genuinely open (need answers eventually)

These have plausible defaults but aren't trivial; mark them as
"will adopt the default unless you object".

- [?] **CARD_RETURN.** When a stack physically dissolves
  (rocket explosion, etc), do its cards return to LEO Stack
  or get decommissioned? Default: return to LEO Stack (mirrors
  the colonize rule).
- [?] **TRANSFER_LOCK.** When an outpost is at a site with an
  active opponent's rocket, can the player still transfer
  cards into/out of their own outpost colocated there?
  Default: yes (transfers are between the player's own
  colocated stacks, opponent presence is irrelevant).
- [?] **STARTING_OUTPOSTS.** Does a player begin the game with
  any pre-placed outpost chits in reserve, or do they only
  appear once the player creates one? Default: only on
  creation (slots A/B/C/D start unassigned).
- [?] **MULTI_PROSPECT.** Can multiple of the player's stacks
  at the same site each run their own prospect / refuel ops
  in the same turn (within the 1-op-per-turn budget)? Default:
  no - the 1-op-per-turn budget applies to the player, not to
  each stack.

### Stage-4 (multiplayer / server) follow-ups

These are out of scope for this sandbox slice but worth flagging
so the data model leaves room:

- Opponent stack visibility on the map.
- Felony / Claim Jump (rulebook G4 / I7) - requires opponent
  state, deferred to multiplayer engine.
- Delivery Op (rulebook I9) - move a Black-Side card from a
  factory outpost back to LEO at a water cost. The user has
  noted "we'll talk about this in the future"; surfacing here
  so it lands somewhere in code review.

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
