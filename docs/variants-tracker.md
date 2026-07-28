# Variants tracker

Living status board for the published HF4 **variants** (the "V" numbers in the
variants & scenarios appendix). One row per rule, so we can see at a glance what
is wired, what is stubbed, and what has not been started.

Source: the variants appendix linked in CLAUDE.md
(`geekach.com.ua/.../varanti-ta-scenar-...pdf`) plus the rules text the user
pastes in. Where a variant references another variant we do not have written up
yet (V4b / V4c, for instance), that is called out as a **dependency gap** rather
than guessed at.

## How to use this

- Every rule below is a checkbox. Tick it only when the rule is implemented AND
  exercised (a real request against the server / a rendered screenshot), the
  same bar CLAUDE.md sets for a push.
- Keep the code pointer next to a ticked rule so the next session can find it.
- A variant's flag goes in FIRST, everything gates on it, then the rules land
  one at a time. Same discipline as the modules ("Module gating - ZERO
  bleed-through" in CLAUDE.md): an off-variant game must be byte-for-byte the
  game without it.

**Status legend**

| Mark | Meaning |
|---|---|
| DONE | Implemented and exercised |
| WIP | Partly implemented |
| TODO | Not started |
| GAP | Blocked on rules we do not have written up |
| N/A | Deliberately out of scope, with a reason |

## Variant index

| Variant | Players | Status | Notes |
|---|---|---|---|
| V1 Quick Start | any | TODO | Referenced by V9 setup. Rules text not captured yet. |
| V4 Altruism | 1 | GAP | V5 sets up "as per V4b" and both V5 + V9 defer auctions to "V4c". We do not have V4's text. **Blocks V5.** |
| V5 Hermes Fall | 1 | WIP | Flag + admin gate in. Rules pending, see below. |
| V6 CEO Solitaire | 1 | DONE | Shipped. See `docs/ceo-solitaire-plan.md`. Futures variant of V6 still unwired (CLAUDE.md). |
| V9 The Sirens | 1+ | WIP | Flag + admin gate + home-orbit node category + map marker in. Rules pending, see below. |

## One scenario per room

**A room runs AT MOST ONE variant, and CEO Solitaire counts as one of them**
(user directive 2026-07-27: "you can only select one variant at a time ... these
are basically scenarios"). Variants are not stacking options like the modules:
each one rewrites setup, victory conditions, and often what the map means, so
two at once has no defined behaviour.

The guided **tutorial** is in the exclusive set too. It is not a published "V"
number, but it is a scripted scenario in every way that matters here.

- [x] **DONE** - Server enforces it. `VARIANT_KEYS` in `server/index.js` is the
      canonical list (`ceoSolo`, `tutorial`, `sirens`, `hermes`); a create
      request naming more than one is REJECTED with `multiple_variants` rather
      than silently narrowed, because picking one for the host would hand them a
      different game than they asked for.
- [x] **DONE** - Neither UI can express a combination. The multiplayer create
      form uses **radios** (`name="variant"`), and the solo wizard's existing
      single-choice "Solo type" button group now carries every scenario, so
      picking V5 or V9 deselects CEO Solitaire / Tutorial automatically.
- **Add a new variant?** Put its key in `VARIANT_KEYS`, add it to the solo-type
  group and/or the create-form radios, and the exclusivity comes for free.

## Shared scaffolding (both variants)

- [x] **DONE** - Room flag, fixed at creation, default off, zero bleed-through
      when off. `lobbies.sirens` / `lobbies.hermes` (`server/db.js`) ->
      `createInitialState` (`server/game/state.js`) -> `state.sirens` /
      `state.hermes`. Both keys are ABSENT from the state when off, so a normal
      room's state is byte-identical to before the variants existed.
- [x] **DONE** - Admin gate. The server FORCES both flags to 0 for any non-admin
      request regardless of what the client sends (`profileIsAdmin`, the
      `/lobbies` create route). The hidden "Variants (in development)" fieldset
      is only the UI half. Never trust the client here.
- [x] **DONE** - Room tags so a table's variant is legible in the lobby list and
      the in-game config panel (`moduleTagsHtml` in `js/lobby.js`, the tag list
      in `js/game/browse.js`).
- [ ] **TODO** - `/lobbies/:id/settings` does not accept either flag yet, so a
      variant cannot be toggled after creation. That matches the modules (fixed
      at creation), so this is probably correct as-is - decide explicitly.
- [ ] **TODO** - Client mode helpers. `isSirens()` exists
      (`js/game/online-mode.js`); `isHermes()` does not.

---

# V5 Hermes Fall

*by Phil Eklund.* Earth is threatened by the binary asteroid hermes. Reach it and
build the infrastructure to deflect it: factories and embedded dirt thrusters
that use the asteroids' own regolith.

**1 player.**

## Dependency gap

V5's setup is "as per Altruism (V4b)" and its auction rule defers to "V4c". We do
not have V4's text, so the setup and the no-auction substitute cannot be
implemented faithfully yet. **Get V4 written up before starting V5's setup work.**
Everything below that does not depend on V4 can proceed.

## Setup

- [ ] **GAP** - Base setup as per V4b Altruism, with any modules.
- [ ] **TODO** - Place **2 seniority disks** in the centre of the Sunspot Cycle
      (V6 already models seniority disks; reuse that, do not build a second).
- [ ] **TODO** - Patent deck: set aside the **Mass Driver** thruster before deck
      setup, then shuffle it into the **top five cards** of the thruster deck.
      The card exists (`data/card-data.json`, "Mass Driver"); the deck builder is
      `buildShuffledDecks` in `server/game/state.js`.
- [ ] **GAP** - Faction privilege per V4b / V4c.

## Special rules

- [ ] **GAP** - Research Auction (I2): no auctions, use the V4c substitute.
- [ ] **TODO** - Prospecting **auto-succeeds** on `hermes_a` and `hermes_b` with
      a robonaut of **any ISRU** (normally ISRU must be <= hydration, and both
      hermes sites are hydration 0, so this bypasses the usual gate entirely).
      Both sites already exist in `data/sites.js`.
- [ ] **TODO** - Industrializing `hermes_a` / `hermes_b` additionally requires
      decommissioning an **operational dirt rocket** (grey thruster triangle).
      Needs a way to identify "dirt rocket" from card data - confirm which field
      marks the grey triangle before building this.

## Game end + victory

- [ ] **TODO** - Game ends when the **second seniority disk** is removed.
- [ ] **TODO** - Victory: industrialize **both** hermes sites before the end.
      Single binary win/lose, unlike V6's victory bands.

---

# V9 The Sirens

*by Pawel Garycki and Phil Eklund.* Carbon-based life from the supercritical
diamond oceans of Uranus. Players start as Sirenian factions the same way they
would as terrestrial ones, but with the Uranian moon **cordelia** used instead
of LEO.

**1 or more, competitive.** Any modules **except Module 0**.

## Setup

- [x] **DONE** - Seniority: **4** disks short game, **5** intermediate, **7** if
      playing Futures. This implementation runs the disk clock off the ROUND
      count (one disk per Solar Cycle), so those are the legal game lengths and
      6 is refused (`sirens_bad_rounds`). `data/sirens.js#SIREN_ROUNDS`.
- [x] **DONE** - Enforce **no Module 0**. REFUSED at room creation
      (`sirens_excludes_m0`) rather than silently forcing m0 off, so a host who
      asked for both is told, not quietly handed a different game.
- [ ] **TODO** - Species: players are all **Siren** factions, or 1-2 players may
      be **Earthling** factions.
- [ ] **TODO** - When both species are present, **split every patent deck and the
      colonist queue in two** (Earthling / Siren). Odd card goes to the Sirens.
      Earthlings cannot touch Siren decks and vice versa, except via trade or
      negotiation.
- [ ] **TODO** - Quick Start (V1) interaction: both species draw from the SAME
      decks for the 1st solar cycle, then the decks split during the bonus round,
      and sold patents discard into the appropriate deck. Blocked on V1.
- [ ] **TODO** - Solitaire path: use **CEO (V6)**, but the Sirens get all **D and
      V** patents and the Earthlings the remainder; the colonist queue still
      splits evenly. This is the SOLO route for V9 and it composes with the V6
      engine that already exists.
  - [ ] **TODO** - Trade: landing a Human on any **D or V moon** in the Uranian
        system lets you flip any white patent in the landing stack to its
        black side.
  - [ ] **TODO** - First Contact: you automatically meet the board's **KPI
        threshold** for the solar cycle in which your Humans first land on a
        Uranian moon. Hooks straight into V6's KPI check.
- [x] **DONE** - **Busted claims** on `luna`, `uranus_aerostat`, and `cordelia`
      are seeded at setup (`createInitialState`, gated on sirens; a normal board
      still opens with no discs at all).
  - [ ] **TODO** - The "cannot be re-prospected with special abilities" half is
        NOT wired - MINE_REVIVAL and any other special re-prospect still see
        these as ordinary busted discs. They carry `busted: 'sirens'` so the
        rule has something to gate on.

## Special rules

- [ ] **TODO** - Research Auction (I2): if you are the ONLY player of your
      species (so you alone can reach that species' deck), no auctions - use the
      V4c substitute. **GAP on V4c.**
- [ ] **TODO** - **Cordelia acts as LEO** for the Sirens, for every purpose:
      aqua storage (C5), crew decommission (E7), free market sales (I3), the
      destination for boosted cards (I4), and pad explosions / space debris
      (K2c). This is the single biggest change and it touches a lot: the aqua
      bank's location gate (`rocketAtRefuelDepot`, `server/game/engine.js`), the
      boost destination, `exposedAtLeo`, and the free-market op. Note also
      **no glory** may be picked up on `cordelia` or `uranus_aerostat` - that
      HALF is **DONE** (`sirenGloryBlocked`, checked in `applyLoadGlory`); the
      Cordelia-as-LEO half is not.
- [ ] **TODO** - **Diamonds Aren't Forever**: Sirenian crew and colonists are
      **rad-hard 0**. A glitch on a stack carrying Sirens does nothing if the
      stack is on a site, and decommissions the Sirens if it is in space.
- [ ] **TODO** - **Heroism** (Lc): with Earthlings in play, the first time Humans
      and Sirens meet at the end of a turn, the active player takes a heroism
      chit (C7). Both species can claim glory.
- [ ] **TODO** - **Technology Trade**: end your turn with one of your Humans
      colocated with a Siren (or vice versa) and take the top card of the other
      species' patent deck into hand.
- [ ] **TODO** - **Promotion colonies** (M1 / M2): regardless of dome icon, Siren
      cards promote ONLY at push colonies (2A3a) or promoted-and-anchored Bernals
      (2A3c).
- [x] **DONE** - **Sirenian Bernal home orbits are marked on the map.** New
      `sirensAnchor` node-tag category, drawn as the aqua 7-point anchor star
      (same silhouette as the Home Bernal star, transparent centre). Admin sets
      which nodes carry it on `/admin/site-tags`. Off-variant the node still
      renders and stays routable; only the anchor capability is gated.
      `js/game/render.js#drawSirensAnchorStar`, `server/db.js` node_tags.
  - [ ] **TODO** - **Nothing is tagged yet.** Pick the actual home-orbit nodes.
        Every existing home anchor is a `burn-*` / `lag-*` ORBITAL waypoint,
        never a named site, and the Uranus zone already has five Home Bernal
        anchors: `lag-bwrlc`, `lag-hj5gg`, `lag-zmjny`, `lag-96ll6`,
        `lag-wumzs`. Decide whether those become the Siren home orbits or
        whether the Sirens get their own set.
  - [ ] **TODO** - Any Bernal may go to any home orbit.
  - [ ] **TODO** - Sirenian Bernal dirtside hydration is NOT six; it depends on
        the hydration of the moons the Bernal is adjacent to.
  - [ ] **TODO** - The **Cycler Bernal** allows safe passage through the "mu dust
        ring" radiation belt.
  - [ ] **TODO** - **Uranus Elevator** can only be built by anchoring the GEO
        Elevator or Lofstrom Loop Bernal to a home orbit (2B4i).
- [ ] **TODO** - **Footfall Future** (1D5f) can be aimed at Earth OR Uranus,
      removing either the Earthlings or the Sirens from the game. If more than
      one faction survives they continue with War of Independence (which CLAUDE.md
      records as still unimplemented for M2).

## Game end + victory

- [ ] **TODO** - Game ends when the **last** seniority disk is removed.
- [ ] **TODO** - Scoring as core M2, except the dome bonus (M2b) for **Siren**
      domes is **+3** at push colonies or aerostats (solar energy matters to
      them) and **+1** anywhere else, including on Bernals.

---

## Suggested build order

Sequenced so each step is shippable and exercised on its own, cheapest and
least entangled first.

1. **Tag the Siren home orbits** (V9). Finishes the one piece already built and
   needs no engine work.
2. **V9 no-M0 enforcement** and the seniority disk counts. Small, and it stops
   an incoherent room being created.
3. **V5 auto-prospect on hermes** and the Mass Driver deck seeding. Both are
   self-contained and do not touch V4.
4. **Get V4 written up.** It blocks V5's setup, V5's auction rule, and V9's
   single-species auction rule - three separate places.
5. **Cordelia-as-LEO** (V9). Big and cross-cutting; do it as its own slice with
   its own verification pass, once the cheaper rules are in.
6. Everything else, in the order the table above lists it.
