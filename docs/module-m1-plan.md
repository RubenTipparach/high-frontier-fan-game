# Module 1 - Terawatt & Futures (planning)

Forward design doc for the M1 module. M1 is OUT of the current shipped scope
(see CLAUDE.md "Variants we target": Standard + CEO Solitaire only) - this is a
planning sketch so we can start mocking UI / board pieces and the new modals,
NOT a committed stage.

Functional rules captured here in our OWN words. The verbatim manual text lives
in `reference/manuals/branch-module-1.md` (and `branch-futures.md`); section
codes below (1A, 1B6, 1C1a, 1D2, ...) point into those files / the master
`reference/manuals/hf4-branching-manual.md`. Card stats are NOT invented here -
they come from the spreadsheet (`reference/HF4-card-data.xlsx`) when we wire it.

## What M1 adds (1A)

Two new patent decks and an optional quest layer:

- **Freighters (1B)** - a new card type. A big cube on the map that hauls
  Black-Side factory goods (and isotope fuel) back toward LEO.
- **GW thrusters (1C)** - higher-thrust / higher-efficiency engines than the
  core MW thrusters; they reach the outer planets more easily and they burn
  **isotope (gold-bead) fuel**.
- **Isotope fuel** - "ISO fuel manufacturing": gold beads refined at a factory
  whose Spectral Type matches your GW thruster (1C1a). Doubles as currency.
- **Mobile Factories (1B6)** - a Promoted Freighter turns your Factory cubes
  mobile (they can move, land, lift off, claim-jump).
- **Space Elevator (1A6 / 1B9)** - a cable built between two map Spaces via an
  Epic Hazard roll.
- **Futures (1D)** - optional epic-achievement quests (needs M0+M1+M2 together,
  lengthens the game to 7 Solar Cycles).

New components: one **big cube per player** (the Freighter, 1A2), a **gray/gold
Wet-Mass chit** (1A2d), the freighter + GW-thruster decks (placed Black-Side
up), and orange **future-star tokens**.

## Freighters + the Freighter stack (1B)

- You may own **only one Freighter** and **one GW thruster** card (1A4); you
  can't even auction for a second while you hold one.
- The Freighter is its own **stack on the map, represented by your big cube**
  (1A "e."). It moves like a spacecraft but is a separate unit from your rocket.
- **Delivery** (core op already in our ops table) moves a Black-Side card from a
  Factory to LEO; the Freighter is the unit that does the hauling once M1 is in.
- **Promotion** (op): flip the Freighter to its **Purple-Side** at its promotion
  site. Promoting the Freighter (1B6) makes **all your Factory cubes Mobile
  Factories**, and unlocks the Freighter's **Future** (1D).
- **Big Cube Swap (1B8)** - free action: when your Promoted Freighter carries no
  Cargo or Glitch, swap its big cube with any small cube on the map. Does not
  spend the Freighter's move for the turn.
- Combat note (Module 3 territory): a Freighter can be a kamikaze weapon and
  uses **net thrust** as its fire value (1B "b.").

### Proposed UI / board

- **Freighter Stack modal** - same shape as the Rocket Stack modal (title bar +
  cards + net-thrust readout), but for the big-cube freighter. Freighters (and
  mobile freighters) **carry cards**; the hold capacity is a **MAX MASS HOLD**
  (a mass budget), not a fixed cargo-slot count - show carried mass vs the
  freighter's max (e.g. "mass hold 5 / 8"), the cards/gold beads it's carrying,
  its thruster + supports, and its current map node. The big cube is the map
  marker.
- A board marker distinct from the rocket sprite (the player-colour **big**
  cube vs the small rocket).
- White-Side vs Purple-Side faces in card rendering (we already render
  primary/secondary; Purple is a third face state to add for M1/M2 cards).

## Isotope (gold-bead) fuel manufacturing (1C / 3B5 / 4D1)

- A GW thruster runs on **isotope fuel** = gold beads, produced by
  **factory-refueling at a factory matching the GW thruster's Spectral Type**
  (1C1a). That matched spectral type is your **isostandard**.
- The first player to produce their first gold bead triggers **isotope
  monetization** (3B5 / 4D1): it permanently **doubles FINAO costs for everyone**
  and makes gold beads **spendable currency worth 10 Aqua each** (auctions,
  FINAO, etc.) once banked.
- So gold beads are a dual resource: GW-thruster fuel AND high-value money. This
  is distinct from the existing water/aqua economy (do not fold it into water).

### Proposed UI / board

- **Isotope fuel modal** (a Site-Refuel variant): when parked at a factory whose
  spectral type == your GW thruster's isostandard, refine gold beads into the
  GW thruster's tank. Show the spectral match check (pass/fail glyph, reusing
  the spectral hex language).
- Gold-bead **bank counter** alongside the aqua counter, with the "10 aqua each"
  conversion surfaced where aqua is spent.
- A one-time **"isotope monetization triggered"** event banner (FINAO x2).

## Mobile Factories / mobile freighters (1B6)

- Promoting the Freighter makes your Factory cubes **mobile**: they can move,
  **land / lift off** a Claim using **factory-assist with themselves as the
  factory** (Site size <= 5; size 6+ has lander burns) (1B6b).
- A Mobile Factory on a Site **defends as a Factory**; off a Claim it defends as
  a Spacecraft using the Freighter card's values (1B "f.").
- With felonies allowed, a Mobile Factory can **Claim-Jump by landing** on an
  enemy Claim (1B6 "a.").

### Proposed UI / board

- Factory cubes gain a **mobile state** (movable marker + a route, like the
  rocket) once the Freighter is promoted.
- Reuse the planner/route UI for mobile-factory movement; reuse factory-assist
  burn math (it already exists for landers).
- A clear board distinction between a **fixed** factory cube and a **mobile**
  one (e.g. an outline / glow), plus the landing/lift-off affordance in the site
  popup.

## Futures - tracking completion (1D)

- A **Future** is a private quest unlocked when you **Promote** a Colonist, GW
  thruster, or Freighter; the requirements + effects + endgame VP are printed on
  the card's **Purple-Side** (1D).
- Only available with **M0 + M1 + M2 together** (1D "a."); the game runs **7
  Solar Cycles** (1D "d.").
- **Private** to the owner; each named Future can be completed **once per game**
  (1D "b."). Lose the Purple-Side card and the Future is unavailable until you
  rebuild + re-promote it.
- **Requirements (1D1):** the Futures card AND a Human (Crew or Colonist) must be
  Operational and **Colocated** (at the named location if one is specified).
  Some Futures are "Ad Astra" (exit the map on an interstellar mission, then
  decommission the stack) or "Manifest Destiny" (let you Claim-Jump a named Site
  even without felonies).
- **Completion (1A6 Epic Hazard):** with requirements met, a Crew/Colonist runs
  an **Epic Hazard operation** - a Hazard Roll (avoidable by paying FINAO). Roll
  a "1" and the Future fails and the Human is **decommissioned** (the Purple
  card survives).
- **Effects (1D2):** success grants an **orange future star** (permanent VP at
  endgame, M2b). "Endgame"-tagged effects re-check requirements at scoring (card
  Operational + Colocated with a Human) or the star is returned. Some are
  **Casus Belli** futures that start a War of Independence.

### Proposed UI / board

- **Futures tracker modal** - the key new screen. For each Future you own
  (Purple-Side cards): a **requirements checklist** (card + Human colocated,
  location, any per-Future conditions) with live pass/fail ticks, an **Epic
  Hazard** action button (enabled only when reqs are met) showing the
  roll / FINAO option, and the **earned star + VP** once complete.
- A compact **futures strip** (orange stars earned vs available) in the
  scoreboard, mirroring how glory chits read today.
- Endgame scoring needs a **re-check pass** for Endgame-tagged stars.

## New operations / free actions (M1 rows of the CLAUDE.md ops table)

- **Promotion (op)** - flip Freighter / GW thruster / Colonist to Purple-Side at
  its promotion site (M1/M2).
- **Epic Hazard (op)** - complete a Future or build a Space Elevator via a Hazard
  Roll (M1).
- **Big Cube Swap (free)** - swap a Freighter big cube with a Factory cube (M1).
- **Space Elevator (free)** - move between the two ends of a built elevator (M1).
- **Delivery (op, already core)** - Factory -> LEO; the Freighter hauls it.

## Engine / data notes (when we build it)

- Two new decks come from the spreadsheet (`reference/HF4-card-data.xlsx`):
  Freighters and GW thrusters. Do NOT hand-author stats (CLAUDE.md "single
  source of truth"). They are double-sided like every card; M1/M2 add a
  **Purple-Side** face state on top of primary/secondary.
- New per-player state: the freighter big cube (its own stack + map node + cargo
  hold), gold-bead bank + GW-thruster isotope tank, mobile-factory flags, owned
  Futures + earned stars, isostandard spectral type.
- New global state: isotope-monetization-triggered flag (FINAO x2), space
  elevator tokens, war-of-independence state (only if we ever pull in the combat
  edges).
- Movement reuses the existing planner + fuel-graph (the big cube and mobile
  factories move on the same graph as the rocket).

## Open questions (confirm against rulebook + spreadsheet before building)

- Exact Freighter max-mass-hold value + how net thrust scales with carried mass.
- Delivery FT cost interaction once the Freighter (not the rocket) hauls.
- Isotope tank size / how many gold beads a GW burn spends (the fuel-step ladder
  for isotope vs water).
- Which Futures exist and their printed reqs/effects/VP (all on the cards -> the
  spreadsheet, not invented here).
- Whether we scope Futures at all before M0 + M2 land (Futures need all three).
