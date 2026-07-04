# Release notes

Fan implementation of **High Frontier 4: All**. This file tracks released
versions and their notes.

## Versioning scheme

We use **Semantic Versioning** (`MAJOR.MINOR.PATCH`), read for this project as:

- **MAJOR** - a game-generation / save-breaking overhaul. Stays `1` until a
  ground-up rework of the engine or data model.
- **MINOR** - a headline feature epic, or a module going public (e.g. M1
  Terawatt opening for playtest, CEO Solitaire, M2 Colonization + Futures).
- **PATCH** - bug fixes and UX polish within a release.

Notes:
- Modules (M0 / M1 / M2 / M4) are gameplay content gated per room; a module
  going PUBLIC bumps the MINOR. An admin-only experimental module (M2 today)
  does not bump a public version until it opens.
- CEO Solitaire is a play VARIANT, not a module, but it is a large enough body
  of work to be its own MINOR.
- Every push already deploys and injects the commit SHA into the client
  version-check; the versions here are the human-facing milestones on top of
  that continuous deploy.

Baselines (retroactively numbered so the history reads cleanly):

- **1.0.0** - the server-authoritative multiplayer engine + the shared sandbox
  UI (Stages 1-3: identity/lobby, static map + card data, the operations
  engine). The pre-versioning baseline.
- **1.1.0** - **Module 1 (Terawatt) opened for open playtesting** (the admin
  gate dropped). The starting point for this changelog.

---

## [1.3.0] - 2026-07-04 - Module 2: Colonization + Futures

### Headline: Module 2 opens for playtesting

The second half of HF4 goes live. M2 rooms run the full colonization loop -
the colonist queue + exomigration, Homesteading, Nanofacture, Lab / Colonist /
Bernal promotion, the colonist specialty operations and printed abilities - and
the Futures system: promote a colonist / GW thruster / Freighter to unlock its
Future, meet the printed requirements, and attempt the Epic Hazard for the
orange star (scored at endgame with the 1D2b re-check). The Colonists tab
carries the colony population, the Exomigrate free action, and the missions
tracker with live requirement checklists.

- **Released for every host** (the M1 open-release pattern): the admin gate is
  dropped, the room-creation + settings checkboxes show for everyone, and the
  server accepts M2 from any request. Still experimental and fixed at creation.
  Turn on **M0 + M1 + M2** together for the full game (M2 forces M0 on, but the
  Futures deck ships with M1). An M2 room defaults to the 7-round long game.
- **Futures are the 7-round long game** (rule 1D d): a short M2 room (5-6 rounds)
  runs the colonization loop WITHOUT Futures. Turning M2 on in the room setup
  defaults the length to 7 and warns on 5 / 6. CEO Solitaire may run Futures too
  (M2 + 7 rounds in solo), though the dedicated CEO Solitaire Futures VICTORY
  variant (win at the 7th board meeting, its own bands + 7 seniority disks) is
  still not wired.
- See docs/module-m2-implementation.md for the full landed-vs-deferred list and
  docs/module-m2-release-notes.md for the release companion.

### Added

- **Colonist loop.** A shuffled, face-down colonist queue (18 colonists, order
  redacted); Exomigration as the player's call (anchoring opens a berth, the
  Colonists tab pulses, you exomigrate when ready and pick the station + whether
  to seat the delegate); Human vs Robot colonists (robots to hand + slave
  market + ET-build, humans crew stations and are a felony to kill); colonist
  specialty operations (Miner / Prospector / Engineer / Industrialist) and the
  printed ability layer.
- **Bernals + colonies.** Anchor a Bernal (reaching a factory through lander
  burns / hazards), Promote it to a Lab (glowing purple dome) at a colocated
  matching-class site, Homestead, Nanofacture mobile factories, and Bernals
  building Bernals. Colony site classes (Submarine / Astrobiology / Atmospheric)
  are tagged in the site popup and score extra endgame VP.
- **Futures.** 32 printed Futures with live requirement checklists, the Epic
  Hazard attempt (roll or FINAO), the orange star on your card, and futures
  folded into the live scoring tracker + endgame re-check.
- **All 18 colonist card arts** drawn and wired in.

### Also this cycle (core rules, not M2-gated)

- **Luna Treaty** (base multiplayer): only the first player prospects Luna
  unless felonious; others request permission via a request / grant flow.
- **Acetylene Rocketplane Liftoff** (the High-Gravity Limit exception): a rocket
  at an atmospheric site behind lander burns lifts off with a factory assist,
  burning water equal to 2 x wet mass from tanks stored at the site; the first
  lander burn out rides free.
- **Auctions: priced-out bidders auto-pass**, trades are allowed while a lot is
  open, and a top-up re-enters the bidder automatically (the close re-checks the
  winner can pay).
- Correct GW/TW afterburn on the thrust triangle; fuel transfer at your Home
  Bernal as well as LEO; the Solo Individuality law text fix; map exit / special
  node markers + Home Bernal orbit stars.

---

## [1.2.0] - 2026-07-01 - CEO Solitaire

### Headline: CEO Solitaire (V6, the published one-player variant)

A full single-player scenario built on the server-authoritative engine (gated
on `state.ceoSolo`), run as a one-seat online game. **Open to every host** -
the admin-preview gate is dropped at this release (the M1 open-release
pattern). Verified end to end by an automated full-game playthrough (research
-> boost -> prospect -> industrialize -> three board meetings -> fired).

Known limitations shipped with this release (documented, not blockers): the
Futures victory path is deferred (needs M1+M2); some 4G3 law effects are
display-only for now (Equality's bonus-support economy, Authority's
inspiration cancel, Unity's Anarchy clause); the Ingenious faction's +6 aqua
start is not wired.

- **Board-meeting KPI loop.** Each Solar Cycle the Board reviews the program:
  deliver victory points against a rising KPI (seniority disks + fatality
  disks). Miss it and you are fired; clear the last disk and you have completed
  your tenure, scored against the V6 victory bands.
- **Intro cutscene** styled as a 1999 boardroom PowerPoint pitch: a plan
  horizon scaled to the chosen game length (12 in-game years per cycle), an
  agenda, the Board's expectations, the scoring rules, and the ask. Plays once
  ever; replayable from the turn bar.
- **Board Meeting screen**: the Board around a circular table, an animated
  score tally counted out one row at a time, a met / below-expectations verdict
  stamp, a fired (CEO out the skyscraper window) or promoted (CEO with stock
  options) illustration, and an income-vs-score trajectory chart. The game-over
  standings are held back until this animation finishes.
- **Scenario scoreboard** on the turn bar: the next KPI vs the VP delivered so
  far, the per-category breakdown, and a replay-intro button.
- **Solitaire (4G3) Sol Political Assembly law set** replaces the base M0 laws;
  seats an extra Centrist delegate at setup.
- **Research Auction as a direct take (V4c)**: with no rival bidders you take
  the deck top plus its bonus supports for aqua equal to the number of cards
  taken (Marketeer buys 3 for 2); the academia hand limit still applies.
- **Fatality disks**: a crew lost to a hazard / radiation / solar-flare roll
  respawns at LEO and adds a fatality to the Board's demand pile.
- Standard starting bank and Card Market economy are fixed by the variant.
- Solo room setup wizard: CEO Solitaire is its own category with the variant's
  setup locked in (Module 0 mandatory); game length stays selectable.

### Added

- **M1 Terawatt buildout** (now that the module is public):
  - **Space Elevator** (rule 1B9): server-authoritative build + ride, curved
    two-ended cable graphic, and the auto-built GEO elevator from an anchored
    GEO Bernal.
  - **Mobile Factories** (rule 1B6): Greek-letter fleets, a batch MOVE_FLEET
    op, and a shared fleet planner with the move-combo dropdown.
  - **Big Cube Swap**, **Freighter recall to hand**, Factory-Loading-Only
    cargo gating, and isotope (gold-bead) fuel as its own grade.
  - **Promotion**: flip a GW thruster to its Purple-Side at a matching colony
    dome, offered from the rocket-stack modal and the site popup.
  - Gold GW/TW rocket stripes; corrected GW/TW afterburn (1 fuel step for +N).
- **M2 Colonization** (still admin-only, built out): full Bernal stations
  (stack, cargo transfer, anchor / unanchor, figure lock, dirt-tank + movement,
  Bernals-building-Bernals), boost-direct-to-Bernal, and the colonists pane.
- **Factory access**: request -> standing grant so you can refuel / ET-produce
  at another player's factory.
- **Powersat** ability: push factories grant safe factory-assist and +1 push.
- **Move animation**: glide along the plotted route with a Skip button; a route
  toolbar with Save-route + Move-this-route and a per-room route setting.
- **ET Produce** accepts a colocated in-play white-side card, not only a Hand
  card.
- **Chat**: bounded lobby + global chat windows with load-more, stable
  per-author name colours, and @names tinted by seat colour.
- **Solo rooms** can be named, and "Your games" is split into separate
  Multiplayer and Solo lists.
- **M0 politics**: an active law is usable by every player; Anarchy also rolls
  an Assembly delegate purge.

### Fixed

- Isotope / factory / aerostat refuel wrongly greyed out across turns or
  against effective (not printed) hydration.
- `undo_replay_failed` when the commit floor advanced or a tightened rule
  rejected an already-made move on replay.
- Isotope tank grade collapsing to water through snapshot hydration; water
  could power an isotope thruster on afterburn.
- Move-animation crash (negative hop index) and full-canvas blink on resize.
- Glory-chit pickup firing in the wrong zone; Honor Fundraise counting claimed
  chits; SpaceX Marketeer now wins auction ties at close.
- Freighter / Bernal belt rolls now roll vs rad-hardness (+2 in red season).
- A faced card renders thrust from its own installed face, not the primary.

### UX

- Prospect is hidden on orbital space nodes (lagranges / waypoints), and a
  blocked prospect shows why inline with a ❗ flag + tap tooltip.
- Site-popup ISRU chip shows the effective rig rating; the thrust equation
  shows robonaut-thruster mods instead of hiding them.
- Colonies use the 🌐 globe consistently everywhere.
- Mobile: forms / modals scroll instead of clipping; the Your-games lists have
  a taller scroll box and chain-scroll to the page at their edges.
