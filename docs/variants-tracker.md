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
| V1 Quick Start | any | DONE | Shipped 2026-07-28 as an OPENING (not a scenario), extending the existing draft-start rather than a second one. `quick_start` column -> `state.quickStart`; forces `draftStart` on and `randomDraft` off; refused with CEO Solitaire. No deck cycling, no flat draft-end bank, then a bonus round (`DRAFT_BONUS_SELL` / `DRAFT_BONUS_DONE`) selling cards back at 1 aqua each to the bottom of their own decks, and the first Seniority Disk is discarded (one Solar Cycle fewer). |
| V4 Altruism | 1, or 2+ co-op | TODO | Rules text captured 2026-07-28. No flag yet. Its V4c auction substitute is a shared dependency, see below. |
| V5 Hermes Fall | 1 | DONE | Shipped 2026-07-30. `data/hermes.js` carries the pure rules (shared client+server). Setup forces 2 Solar Cycles, cuts every deck's bottom half (V4b) and seeds the Mass Driver into the top five thrusters; auctions defer to V4c; prospecting the binary auto-succeeds at any ISRU with no die; industrializing a half additionally spends an operational dirt rocket; binary win/lose via `state.hermesVerdict`. |
| V6 CEO Solitaire | 1 | DONE | Shipped. See `docs/ceo-solitaire-plan.md`. Futures variant of V6 still unwired (CLAUDE.md). |
| V9 The Sirens | 1+ | WIP | Setup, species, and the home-base LEO gates in. See below. |

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
- [x] **DONE** - Client mode helpers. `isSirens()` and `isHermes()` both live in
      `js/game/online-mode.js`, pinned from the snapshot in `applySnapshot`
      before any hydrator runs.

---

# V4 Altruism

*by Phil Eklund.* Go it alone or go it together, for the future of the species.

**1 player, alternatively 2 or more COOPERATIVE.** This is the only co-op
variant in scope, and it is the only place a shared win condition exists.

Rules text captured 2026-07-28. **No flag yet** - V4 is not in `VARIANT_KEYS` and
has no room checkbox. Add those first if V4 itself is being built; the sections
other variants borrow (V4b setup, V4c auction) are written up here so V5 and V9
can implement against them without V4 shipping.

## Setup (V4b)

Core rulebook C with any modules, with three changes:

- [ ] **TODO** - Seniority: **4** disks short, **5** medium, **7** Futures. Same
      three lengths V9 uses, so `data/sirens.js#SIREN_ROUNDS` is the shape to
      copy (the disk clock runs off the ROUND count in this implementation).
- [ ] **TODO** - Patent decks: shuffle as normal, then **remove the bottom half
      of each deck, rounding up, sight unseen**. `buildShuffledDecks`
      (`server/game/state.js`) already shuffles from the seeded RNG, so this is a
      truncation applied after the shuffle and before the game starts. It MUST
      happen after shuffling, not by drawing fewer cards, or the removed cards
      are not random.
      The appendix's worked example is a useful assertion to test against:
      6 thrusters, 6 robonauts, 6 refineries, 8 generators, 6 radiators,
      6 reactors, 3 GW thrusters, 3 Freighters, 5 or 6 Bernals, 9 Colonists.
- [ ] **TODO** - Faction privilege (C5): in a SOLITAIRE game only, a faction with
      **Taxes**, **Secretary-General**, or **Felonious** starts with **6 extra
      aqua**.

## Special rule (V4c) - the substitute auction

This is the piece V5 and V9 both defer to, so it is worth stating precisely.

- [x] **DONE** - Instead of the Research Auction (I2g), your Operation is: take
      the **top card of a patent deck**, including its bonus supports (I2g), and
      pay **1 aqua per card taken**. So a card that pulls two bonus supports
      costs 3 aqua for 3 cards. Already shipped as part of V6 CEO Solitaire
      (`applyAuctionStart`); V9's single-species rule now reuses it unchanged.
- [x] **DONE** - The academia **hand limit** (I2a) still applies in solitaire.
- [x] **DONE** - **Marketeer** faction privilege: buy 3 cards for 2 aqua (a
      1-aqua rebate once three or more cards are taken).

## Game end + victory

- [ ] **TODO** - Ends when the **last** seniority disk is removed. Same condition
      as V9, and V6 already models the disk clock.
- [ ] **TODO** - **Solitaire** win at **40+** VP short, **60+** medium, **100+**
      Futures. Scoring itself is unchanged core rulebook M.
- [ ] **TODO** - **Cooperative** win is COLLECTIVE: EACH player must score
      **30+** short, **50+** medium, **75+** Futures. Note this is per player,
      not a pooled total, so one lagging player loses it for the table. Nothing
      in the engine models a shared win condition today.

---

# V5 Hermes Fall

*by Phil Eklund.* Earth is threatened by the binary asteroid hermes. Reach it and
build the infrastructure to deflect it: factories and embedded dirt thrusters
that use the asteroids' own regolith.

**1 player.**

## Dependency gap - CLOSED 2026-07-28

V5's setup is "as per Altruism (V4b)" and its auction rule defers to "V4c". Both
are now written up above, so nothing in V5 is blocked on missing rules any more.
Note V5 keeps its OWN disk count (2, below) rather than V4b's 4/5/7 - the shorter
clock is the whole shape of the scenario, so V4b is inherited for deck setup and
faction privilege, not for the disk count.

## Site ids - READ THIS FIRST

The two halves are addressed by their **planner slugs**, `hermes-a` / `hermes-b`
(hyphens). `siteBySlug('hermes_a')` does NOT resolve and `state.factories` /
`state.discs` are not keyed that way - the underscored `hermes_a` is only the
`data/sites.js` RECORD id. `data/hermes.js` folds the separator so either
spelling matches, the same guard `data/sirens.js` carries. The engine checks
caught this on their first run; do not "tidy" the ids back to underscores.

## Setup

- [x] **DONE** - Base setup as per V4b Altruism. The half-deck truncation is
      `truncateBottomHalf` (`data/hermes.js`), applied in `createInitialState`
      AFTER the shuffle so the removed cards are genuinely random. It reproduces
      the appendix's worked example exactly (6 thrusters / 6 robonauts /
      6 refineries / 8 generators / 6 radiators / 6 reactors, 3 GW, 3 Freighters),
      which is the assertion the check makes.
- [x] **DONE** - Two **seniority disks**: this implementation runs the disk clock
      off the ROUND count, so a Hermes room is FORCED to 2 rounds
      (`HERMES_ROUNDS`), overriding whatever length the host picked rather than
      merely defaulting.
- [x] **DONE** - The **Mass Driver** is set aside before deck setup
      (`buildShuffledDecks` skips it when hermes) so the half-deck cut cannot cull
      it, then shuffled back into the top five thrusters (`massDriverIndex`, off
      the seeded generator so the placement is replayable).
- [x] **DONE** - Faction privilege per V4b: solitaire Taxes / Secretary-General /
      Felonious start with 6 extra aqua. This was ALREADY the base-game solitaire
      rule (C5, B6a) in `applyPickCrew`, gated on `players.length === 1 &&
      !ceoSolo`, which a Hermes room satisfies - no new code, verified live.

## Special rules

- [x] **DONE** - Research Auction (I2): no auctions, use the V4c substitute.
      `state.hermes` joins `state.ceoSolo` / `sirenSoleOfSpecies` on the existing
      branch in `applyAuctionStart` - a 1-player mission has nobody to bid
      against, and V5's text defers to V4c explicitly.
- [x] **DONE** - Prospecting **auto-succeeds** on both halves with a robonaut of
      **any ISRU** (`applyProspect`, the `hermesAuto` branch). Both are hydration
      0, so the ordinary ISRU gate would refuse every prospector in the game and
      the mission could never start. The auto-success rolls NO die, which also
      leaves the scan undoable rather than tripping the roll barrier, and does not
      advance the RNG cursor. Mirrored client-side in the site popup's prospect
      gate (`browse.js`) so a scan the popup offers is never rejected.
- [x] **DONE** - Industrializing a half additionally decommissions an
      **operational dirt rocket** (grey thrust triangle). The marker is the
      `fuelType` column that already drives the grey triangle in the card
      renderer (`faceIsDirtFuelled`), read off the INSTALLED face, so it tracks
      the spreadsheet rather than a hand-kept card list. Rejects with
      `hermes_needs_dirt_rocket`.

## Game end + victory

- [x] **DONE** - Game ends when the **second seniority disk** is removed - the
      ordinary round cap, with `maxRounds` forced to 2 at setup.
- [x] **DONE** - Victory: industrialize **both** halves before the end. Binary
      win/lose written to `state.hermesVerdict` ('deflected' | 'impact') in
      `resolveRoundClose`, mirroring V6's `ceoVerdict`. The game-over overlay
      leads with the verdict banner above the VP standings (which decide
      nothing here) and swaps the trophy for the asteroid on a loss.

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
- [x] **DONE** - Species: players are all **Siren** factions, or 1-2 players may
      be **Earthling** factions. Declared with the faction in the crew draft
      (`applyPickCrew`); at most 2 Earthlings sit at a table and everyone else
      resolves to Siren, which is also the default when the client names
      nothing. A re-pick re-homes the rocket, so switching species mid-draft is
      coherent. `player.species` is ABSENT entirely off-variant.
- [x] **DONE** - When both species are present, **split every patent deck and the
      colonist queue in two** (Earthling / Siren). Odd card goes to the Sirens.
      Earthlings cannot touch Siren decks and vice versa, except via trade or
      negotiation.
      The cut happens once, when the crew draft closes and every species is
      known (`splitLibrariesBySpecies`, engine.js). Decks are already shuffled by
      then, so each is cut into two contiguous halves - as random as dealing
      alternately, and trivially auditable. The Siren half lives in
      `state.sirenDecks` / `state.sirenColonistQueue`, ABSENT in every other
      game, so `decksFor(state, player)` is plain `state.decks` off-variant.
      An ALL-Siren table keeps ONE library: there is nobody to hide it from.
      Every player-facing draw routes through `decksFor` / `colonistQueueFor`
      (auction, draft pick + cycle, free market, ET produce, free-library
      acquire, discard, exomigration); the table-wide deck CYCLE moves both
      libraries. Bidding across the split is refused server-side
      (`other_species_deck`) AND the client hides the bid box with a reason,
      rather than letting the player click into an error.
  - [x] **DONE** - The Patent Market is **split by species** (user 2026-07-28):
        a tab strip shows my own research by default and the other species'
        behind a second tab, where every take button reads "Closed to your
        factions" and a note names the Technology Trade as the only way across.
        Decided as a UI split rather than server-side redaction, so the snapshot
        still carries both halves - decks were never secret before this variant,
        and four call sites use `sirenDecks`'s mere existence as the "libraries
        are split" flag, so deleting it would silently put the bid box back in
        front of an ineligible player.
- [x] **DONE** - Quick Start (V1) interaction: both species draw from the SAME
      decks for the 1st solar cycle, then the decks split during the bonus round,
      and sold patents discard into the appropriate deck. `splitLibrariesBySpecies`
      moves from crew-draft close to bonus-round start when `state.quickStart` is
      on, so the twelve picks before it come off one shared library and every sale
      after it routes by species (`decksFor`).
- [x] **DONE** - Solitaire path: use **CEO (V6)**, but the Sirens get all **D and
      V** patents and the Earthlings the remainder; the colonist queue still
      splits evenly.
      A **ONE-SEAT Sirens room auto-runs the CEO loop** - board meetings,
      seniority disks, the fired/promoted verdict, the victory bands - with no
      second checkbox (user decision 2026-07-28, chosen over making
      `sirens` + `ceoSolo` a legal pair). Solo-ness comes from the player count,
      so the one-variant-per-room rule is untouched.
      `createInitialState` sets `ceoSolo` when `sirens` and exactly one player.
  - **INTERPRETATION**: V9 says "any modules EXCEPT Module 0" and ceoSolo forces
        `m0` on. Not actually a conflict: what CEO turns on is the SOLITAIRE Sol
        Political Assembly (the 4G3 law set), part of the V6 scenario rather than
        Module 0 as an opt-in. A host still cannot TICK M0 alongside Sirens -
        that is refused at creation (`sirens_excludes_m0`).
  - [x] **DONE** - The solo cut is by SPECTRAL type, not by halves:
        `splitDeckForSoloSpecies` gives the Sirens every D and V patent (31 of
        91) and the Earthlings the rest. `splitLibrariesBySpecies` picks the cut
        by table shape - spectral in solo, halves in a mixed multiplayer game -
        and the colonist queue splits evenly in both.
  - [x] **DONE** - First Contact: the cycle in which this faction's Humans first
        land on a **Uranian moon** meets the Board's KPI automatically
        (`noteSirenUranianLanding` records the cycle; `runBoardMeeting` forces
        `met`). Note this trigger differs from the multiplayer Heroism trigger.
        A **true moon**, not merely a Uranus-zone site (user 2026-07-28): the
        zone holds 19 sites but only 13 are moons - the rest are four centaurs
        (chariklo, asbolus, hylonome, pholus), comet_halley and the aerostat.
        `data/sirens.js#URANIAN_MOONS` lists them explicitly rather than deriving
        from the zone, because "is this a moon" is not in the site data and the
        zone test quietly swept in two D-type centaurs - which would also have
        handed out the solitaire patent flip at the wrong places.
  - [x] **DONE** - Trade: landing a Human on any **D or V moon** in the Uranian
        system lets you flip any white patent in the landing stack to its black
        side. NOT the same rule as Technology Trade above - that one DRAWS a card
        from the other species' deck, this one FLIPS a card the player already
        holds - so it is its own op, `SIREN_TRADE_FLIP`, refused outside CEO
        Solitaire (`not_siren_solitaire`). Free action, repeatable while the
        stack stays on a qualifying moon, and a HUMAN must have made the landing.
        The qualifying set is the 10 D/V moons in `data/sirens.js#SIREN_TRADE_MOONS`;
        the four D-type CENTAURS in the same zone are deliberately excluded, and
        CI asserts chariklo is refused for exactly that reason. "The landing
        stack" covers the rocket, a freighter or an outpost - whichever of the
        player's stacks is standing on the moon.
  - Note CLAUDE.md's existing warning: the CEO Solitaire FUTURES variant is
        still unwired, and V9 + Futures would want the 7-disk / Futures victory
        bands. That review is a prerequisite for a `sirens` + Futures solo room.
- [x] **DONE** - **Busted claims** are seeded at setup (`createInitialState`,
      gated on sirens; a normal board still opens with no discs at all).
      Corrected 2026-07-28: the first pass named `luna` and `uranus_aerostat`,
      and only ONE of the three discs actually landed. There is no site called
      plain `luna` (the Moon is TWO landing sites), and the engine resolves
      through the PLANNER slug space (hyphens: `uranus-aerostat`), not
      data/sites.js's underscore ids - 61 of 188 curated ids are not planner
      slugs at all. The list is now `luna-aristarchus-plateau`,
      `luna-shackleton-polar-rim`, `uranus-aerostat`, `cordelia`, and
      `data/sirens.js#canonicalSiteId` folds the separator so either spelling
      matches whichever list a caller reaches. CI asserts every seeded id
      resolves, which is how the dead ones were found.
  - [x] **DONE** - "Cannot be re-prospected with special abilities": MINE_REVIVAL
        refuses them (`siren_busted_claim`, checked BEFORE the Termite Nest
        requirement, since the card would not help), and the Space Elevator's
        free auto-claim - which explicitly claims "even a Busted one" - skips
        them. A claim a player actually busted IN PLAY is untouched and stays
        revivable; the guard reads the `busted: 'sirens'` marker, not the site.
        PROSPECT_REROLL was already closed (it requires disc ownership, and a
        seeded disc has no owner) and Claim Jump requires a SUCCESSFUL claim.

## Special rules

- [x] **DONE** - Research Auction (I2): if you are the ONLY player of your
      species (so you alone can reach that species' deck), no auctions - use the
      V4c substitute (top card of a deck for 1 aqua per card taken, bonus
      supports included). The substitute was ALREADY implemented for CEO
      Solitaire, so this only widened its gate (`sirenSoleOfSpecies`): the take,
      the pricing and the Marketeer 3-for-2 rebate are the same code. The client
      market copy and the confirm modal follow the same gate, so a sole-species
      player is never offered an auction the engine resolves as a take.
      Note the consequence in a 2-player mixed table: BOTH seats are the only
      member of their species, so neither ever auctions.
- [~] **PARTIAL** - **Cordelia acts as LEO** for the Sirens, for every purpose:
      aqua storage (C5), crew decommission (E7), free market sales (I3), the
      destination for boosted cards (I4), and pad explosions / space debris
      (K2c).
  - [x] **DONE** - The "am I at LEO?" GATES all ask "am I at MY home base?"
        instead. `data/sirens.js#isAtHomeBase` backs `rocketAtLeo` /
        `rocketAtRefuelDepot` / `exposedAtLeo` (`server/game/engine.js`), which
        covers the aqua bank, REFUEL, CONVERT_OUTPOST, the pad-explosion and
        space-debris exposure checks, and the dirtside-Human scan. Verified in a
        MIXED table: each species draws the bank at its own home and is refused
        at the other's with the same `rocket_not_at_leo`.
  - [x] **DONE** - No glory may be picked up on `cordelia` or `uranus_aerostat`
        (`sirenGloryBlocked`, checked in `applyLoadGlory`).
  - [x] **DONE** - The remaining raw `siteId == null` LEO reads now ask about
        the player's home: glory cash-home on arrival (`applyMove`, so a Siren
        banks chits by returning to Cordelia), the home-stack half of
        `playerHumanAt`, and `spendableAqua`'s "tank counts while parked at
        home". Free Market's black-side sale needed NO change - it reads
        `player.leo`, which is a per-player pile rather than a location, so it
        already happens at whatever the player calls home.
  - [x] **DONE** - The CLIENT calls a Siren's home by its real name. The map
        already drew the rocket at Cordelia (it reads the snapshot), but the
        home stack tab, BOOST button, hand hint, stack inspector and All-cards
        list all said "LEO"; they now read the player's own home via
        `homeLabelForSpecies` (`data/sirens.js`) + `mySpecies`
        (`js/game/online-mode.js`), and the home-stack pin flies to Cordelia
        instead of Earth. The All-cards list labels from the SOURCE player, so
        each species sees the other's home named correctly.
  - **Regression cover**: `scripts/check-engine.mjs` runs a MIXED table in CI -
        the two species home apart, the aqua bank reaches each at its own home
        and refuses at the other's, convert-to-outpost mirrors it, and a full
        lap of turns survives. Verified to FAIL when `homeBaseSiteId` is
        stubbed back to null.
- [x] **DONE** - **Diamonds Aren't Forever.** Published text: *"Sirenian Crew and
      Colonists from the Siren queue (hereafter called SIRENS) are considered
      rad-hard 0. If a Stack with Sirens suffers a Glitch, nothing happens if the
      Stack is on a Site, and the Sirens are Decommissioned if the Stack is in
      space."* Note that is TWO rules sharing a defined term, not one rule with a
      consequence.
  - [x] **DONE** - Rad-hard 0 is a READ-TIME MODIFIER, never a change to the
        card's printed data (user 2026-07-28) - the spreadsheet owns that and
        nothing here rewrites it, which CI asserts directly.
        `effectiveRadHardness` applies it before the Cancer Hospital bump, which
        would otherwise hand a Siren a 7 and undo the rule, and the client's
        pre-roll belt-risk preview (`radStackCards`) applies the same modifier so
        its warning matches what the server will decommission.
  - [x] **DONE** - **ROBOTS ARE NOT SIRENS** (user 2026-07-28) - the rule covers
        Crew and Colonists, and a robot is hardware. The check reads
        `colonistKind` directly rather than the emancipation-aware helper, so a
        robot stays excluded even after Emancipation promotes robots to Human for
        other purposes. Verified through a real Solar Flare: at a roll of 3 the
        Siren crew (printed 4) and human colonist (printed 4) are both lost while
        the robot (printed 5) rides it out - and the check FAILS if the modifier
        is removed, since nothing would be lost at printed values.
  - [x] **DONE** - The GLITCH half (`glitchTargetFor`): a stack carrying Sirens
        is glitchable at all (normally a crewed stack is not, because humans fix
        glitches - Sirens cannot), and the outcome is nothing on a Site, the
        Sirens Decommissioned in space.
  - [x] **DONE** - PROVENANCE, not ownership (user 2026-07-29). The split now
        stamps every card it deals to the Sirens into `state.sirenOrigin`, once,
        permanently. A COLONIST is Sirenian by which queue it came out of, so a
        traded one stays rad-hard 0 in an Earthling's stack; CREW have no queue
        (a player's crew are their own faction's) so those stay keyed on the
        owner. Colonists fall back to the owner when no queue was split at all
        (a non-M2 game), which is the same answer with no trade to diverge on.
        The stamp also drives the aqua card edge below.
  - **RESOLVED** (user 2026-07-29): in space the Sirens die AND the stack takes
        the glitch disc - losing the crew does not also spare the hardware, and
        with the Sirens gone there is no Human left aboard to repair it.
        Dirtside the event still fizzles with no disc. Note that in the base game
        a crewed stack is never a glitch target at all (humans fix glitches); a
        Siren-crewed stack becomes a valid target purely so the event has
        somewhere to land.
- [x] **DONE** - **Heroism** (Lc): with Earthlings in play, the first time Humans
      and Sirens meet at the end of a turn, the active player takes a heroism
      chit (C7). Recorded once per game on `state.sirenFirstContact`, so a later
      meeting does not repeat it. The chit comes from the glory pool - the
      published VP tracker calls them "Glory & Heroism chits", so a heroism chit
      IS a zone chit and `maybeAwardGlory` awards it.
- [x] **DONE** - **Technology Trade**: end your turn with one of your Humans
      colocated with a Siren (or vice versa) and take the top card of the other
      species' patent deck into hand. Resolved in `resolveSirenContact` on
      END_TURN alongside Heroism, since both share the trigger. A home stack does
      NOT count as a meeting - two factions sitting at their own bases have not
      met anybody.
  - **ASSUMPTION**: the rule says "the other species' patent deck" but this
        implementation has six-plus decks. The player may name one on the
        END_TURN op (`techTradeDeck`); with none named - the usual case, since
        ending a turn is one click - it draws from the FULLEST deck, which is
        deterministic, never a no-op while any card remains, and stable across
        an undo replay.
- [x] **DONE** - **Promotion colonies** (M1 / M2): regardless of dome icon, Siren
      cards promote ONLY at push colonies (2A3a) or promoted-and-anchored Bernals
      (2A3c). `promotionSiteAt` forces a Siren's dome need to 'Push', which in
      this implementation already means "any colony will do"; the
      promoted-and-anchored Bernal clause was already there. This can only ever
      be narrower or equal for a Siren - it drops the spectral / Submarine /
      Astrobiology / Atmospheric requirements and accepts any colony.
- [x] **DONE** - **Sirenian Bernal home orbits are the EXISTING home-Bernal
      anchors.** They are not a separate category (user 2026-07-28: "thats the
      same as home-bernal anchor positions"). The `homeBernal` node tag already
      marks them and the Uranus zone is already tagged (`lag-bwrlc`,
      `lag-hj5gg`, `lag-zmjny`, `lag-96ll6`, `lag-wumzs`), so there is nothing
      to tag and nothing to draw. The short-lived `sirensAnchor` tag category
      was a redundant second copy of `homeBernal` and has been removed.
  - [x] **DONE** - Home orbits are scoped by SOLAR ZONE (user 2026-07-28): the
        6 Uranus-zone anchor spaces are the Sirens', the other 9 (8 Earth plus
        `burn-umad9` at Venus) are the Earthlings'. Within your own set, **any
        Bernal may go to any free home orbit** - the existing one-Bernal-per-Space
        and one-anchored-Home-Bernal-per-player limits are unchanged.
        `homeOrbitAllowsSpecies` (`data/sirens.js`) keys off the zone rather than
        a node list, so an admin re-tagging a node cannot silently break it.
        A home orbit that is not yours is simply not a home orbit FOR you: you
        may still anchor there as an ordinary dirtside Bernal if you have the
        factory, which is what the anchor gate's other branch already handles.
  - **Design note**: `isHomeBernal(bn)` has 22 callers and none of them knew the
        species, so rather than thread it through all of them (a missed caller
        would be a silent wrong answer - the exact class of bug that took the API
        down earlier in this branch), `applyAnchorBernal` decides ONCE and records
        `bn.home`. Written only in a Sirens game, so every other room's state is
        byte-for-byte unchanged and falls through to the original map-only rule -
        which also means no boot migration. Cleared on unanchor.
        Side benefit: the flag settles a case the map-only rule got wrong -
        anchoring as an ordinary dirtside Bernal ON a home-orbit space is not a
        home anchor, and the site tag alone could not say so.
  - [x] **DONE** - Sirenian Bernal dirtside hydration is NOT six; it depends on
        the hydration of the moons the Bernal is adjacent to. One fork in
        `bernalScoreVp`: a Home Bernal normally scores a flat 6, but a SIRENIAN
        one takes the same dirtside-hydration sum every other station uses.
        `bernalDirtsides` already computed the adjacency, so no new machinery.
        Verified: from `lag-bwrlc` the beam reaches juliet / portia / belinda,
        all hydration 4, so one factory there scores the Siren 4 where an
        Earthling Home Bernal still scores 6.
  - [x] **DONE** - The **Cycler Bernal** allows safe passage through the "mu dust
        ring" radiation belt (`rad-y6b33`, the Uranus-zone rad node). Reuses the
        printed Tourism Cycler's existing waiver shape in `applyMove`'s belt
        sweep, as its own clause beside the Earth one rather than widening it -
        the printed card still says "near Earth". Scoped to a SIREN player: this
        is a Sirenian Bernal rule, so an Earthling sharing the table gets no free
        passage even with their own Cycler anchored (a first cut leaked it to
        both species and still looked right until the two were compared).
  - [x] **DONE** - **Uranus Elevator** can only be built by anchoring the GEO
        Elevator or Lofstrom Loop Bernal to a home orbit (2B4i). Routed through
        the SAME Epic Hazard path the Earth space elevator already uses in
        `applyAnchorBernal` - same d6, same FINAO opt-out, same "a failed roll
        spends the operation and does not anchor" - because it is the same build
        at the other end of the solar system. `homeOrbit` is already
        species-scoped, so it can only fire at a Uranus-zone space.
- [x] **DONE** - **Card display.** A Sirenian card is legible at a glance without
      opening anything: every card the Siren library / queue dealt carries an aqua
      edge (`#5eead4`, the dark-surface Sirens colour) for the whole game, in
      whoever's hands it ends up, and a card considered rad-hard 0 prints its own
      number struck through with the effective `0` beside it in `#0e7490` (the
      light-surface value, since it sits on the card's cream face). The card DATA
      is never rewritten. One registry in `card-ui.js` feeds every render site.
- [ ] **TODO** - **Footfall Future** (1D5f) can be aimed at Earth OR Uranus,
      removing either the Earthlings or the Sirens from the game. If more than
      one faction survives they continue with War of Independence (which CLAUDE.md
      records as still unimplemented for M2).

## Game end + victory

- [x] **DONE** - Game ends when the **last** seniority disk is removed. Satisfied
      by construction rather than by new code: this implementation runs the disk
      clock off the ROUND count (one disk per Solar Cycle), and a Sirens room's
      `maxRounds` IS its disk count - 4 / 5 / 7, with anything else refused at
      creation (`sirens_bad_rounds`). The game already ends at
      `round > maxRounds` (`resolveRoundClose`), so the last round closing and
      the last disk leaving the cycle are the same event. A ONE-SEAT Sirens room
      runs the CEO loop, where the disk clock is explicit (`seniorityCycle`) and
      ends the game the same way.
- [x] **DONE** - Scoring as core M2, except the dome bonus (M2b) for **Siren**
      domes is **+3** at push colonies or aerostats (solar energy matters to
      them) and **+1** anywhere else, including on Bernals. This REPLACES the
      astrobiology-2 / submarine-3 / bernal-3 table rather than stacking with it.
      Implemented in the SHARED scorer (`data/endgame-scoring.js#scorePlayer`,
      `sirenDomes`), so the client panel and the server tally agree by
      construction; each caller classifies its own domes (`solar`) because
      deciding what is an aerostat needs the map and that module reads no data.
      Verified live: a Siren's aerostat dome scored 3 and their submarine dome 1,
      while an Earthling's submarine dome in the same game still scored 3; and a
      Siren colony with a push-sat outpost scored 3 while a plain one scored 1.
  - [x] **DONE** - A **push colony is a push-sat colony** (user 2026-07-28), so
        the `push` card property IS the marker: a colony counts when its owner
        has a push-sat card standing at that site, in any unit they have there
        (rocket / outpost / freighter / Bernal, reading the INSTALLED face).
        Read live at scoring time rather than stamped on the colony at build
        time, because a push-sat can arrive or leave afterwards.
        `pushSatAtSite` (engine) / `snapshotPushSatAt` (client).

---

## Suggested build order

Sequenced so each step is shippable and exercised on its own, cheapest and
least entangled first.

1. **Tag the Siren home orbits** (V9). Finishes the one piece already built and
   needs no engine work.
2. **V9 no-M0 enforcement** and the seniority disk counts. Small, and it stops
   an incoherent room being created.
3. ~~**V5 auto-prospect on hermes** and the Mass Driver deck seeding.~~ DONE
   2026-07-30, along with the rest of V5 (see the V5 section).
4. **Get V4 written up.** It blocks V5's setup, V5's auction rule, and V9's
   single-species auction rule - three separate places.
5. **Cordelia-as-LEO** (V9). Big and cross-cutting; do it as its own slice with
   its own verification pass, once the cheaper rules are in.
6. Everything else, in the order the table above lists it.
