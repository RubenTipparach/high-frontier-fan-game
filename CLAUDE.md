# High Frontier Fan Game - agent notes

Persistent project rules for future sessions. Read this first.

This is a fan implementation of **High Frontier 4: All** (Sierra Madre Games,
designed by Phil Eklund). Pure educational / fan project, not for sale, not
affiliated with the publisher.

## Design language - CRITICAL

The audience for this implementation is people who already play HF4 at the
table. **Every visual and interaction must feel like the published game.**
If a returning player can't tell at a glance what a glyph means, what a
hexagon represents, or what step of a turn they're in, the design is wrong.

Concretely:
- Card glyphs (thrust triangle + pink circle, water-droplet fuel,
  spectral hex, requirement-icon row, half-rocket for half-lander,
  ☠ skull, 🪂 aerobrake, 🛰 push-sat, the ⚡ pulse / 🌡 thermostat
  family for stack requirements) must use the same shapes / colour
  language as the published cards. If a glyph means N on the
  table, it must mean N here.
- Map idioms - flat-top hexagons over body halos, magenta burn
  pads with rockets, orange Lagrange rings, green Hohmann dots,
  Saturn ring tilt + Cassini gap, pulsing red hazards - exist
  because the published board uses them. Don't invent
  replacements that "look better"; align with the board.
- When you introduce a new affordance, ask: "would a tabletop
  player recognise this without a tutorial?" If no, redesign.
- Mechanics-only changes (engine, scoring, balance tuning) are
  fine to invent; visual language is not.
- **Generating an SVG? Show a rendered screenshot first.**
  Whenever you are asked to generate or hand-author an SVG (a card
  glyph, an icon, a map marker, a badge), render it to an image and
  show the user that screenshot for review BEFORE applying or using
  the SVG anywhere in code (wiring it into the UI, committing it as
  the applied asset, etc.). The visual is the user's call, not the
  agent's. The established workflow: write the SVG, render it (e.g.
  `rsvg-convert` to PNG), `SendUserFile` the preview, and wait for
  sign-off before wiring it in. Storing the raw SVG in the branch so
  the user can see it is fine; using it in the running app is what
  waits for approval.

- **You CAN render the app - use it.** This environment has headless
  Chromium (Playwright) wired up via `scripts/screenshot.mjs`, so there
  is NO excuse for "I can't see the web page." Use it to PREVIEW any
  UI / client change for the user (`SendUserFile` the PNG) AND to
  VALIDATE that a bug is actually fixed by observing the rendered
  result, not just the code. Typical loop:
  ```
  python3 -m http.server 8137            # serve the app (build-free)
  node scripts/screenshot.mjs http://localhost:8137/index.html /tmp/x.png --wait=1500
  # or render a card / component in isolation via a small HTML harness
  # that imports js/game/card-ui.js renderCard(...) from the served app
  ```
  Notes baked into the helper: Playwright is installed GLOBALLY, the
  browser binaries live at `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`
  (not `~/.cache/ms-playwright`), and the package is CommonJS (default
  import). If the browser binary is missing, run `npx playwright install
  chromium` to COMPLETION - never pipe it through `head`/`tail`, a closed
  pipe SIGPIPE-kills the download. The local build talks to the prod API,
  so `ERR_CERT_AUTHORITY_INVALID` console errors are expected and
  harmless for rendering. Default to showing a screenshot for any visual
  change instead of describing it.

- **EXERCISE every change BEFORE pushing - a push deploys to prod.**
  (User directive 2026-07-02, after a pushed ops-log change 500ed in
  prod on a query typo a single request would have caught.) Every
  branch push goes live within a minute, so "compiles + boot check"
  is NOT verification. Before pushing: a changed SERVER route gets
  hit with a real request against the local server (player AND
  spectator auth paths when both exist); a changed CLIENT flow gets
  rendered in headless Chromium and driven to the changed screen.
  After pushing, re-render / re-request once against the deployed
  build when the change is player-facing.

- Core rules PDF (publisher-hosted):
  https://gamers-hq.de/media/pdf/c5/f2/cf/HF4-Core-Rules.pdf
- Variants & scenarios appendix:
  https://geekach.com.ua/content/files/varanti-ta-scenar-high-frontier-4-all-anglyskou-movou-62879102.pdf
- BGG entry: https://boardgamegeek.com/boardgame/281837/high-frontier-4-all
- **HF gazetteer (heliocentric zones, site classifications):**
  https://www.iandrea.co.uk/sf/resources/hf/HFgazetteer.html
  - canonical reference for which solar zone (Mercury / Venus /
  Earth / Mars / Ceres / Jupiter / Saturn / etc.) each named
  site sits in, plus apparition / synodic season tags. The
  popup tags rendered in `js/game/render.js#_buildSitePopup`
  (`<site> zone`, `<season> season`) read from
  `data/sites.js`'s `solarZone` + `siteSynodic` fields, which
  are sourced from this gazetteer.
- **HF reference hub (iandrea):** https://www.iandrea.co.uk/sf/highfrontier/
  - the author's High Frontier index page: rules summaries, maps,
    the gazetteer above, and other play aids.
- **HF4 card image reference (hf4map):** https://www.hf4map.com/cards/<deck>/<n>
  - a browsable card gallery covering the full official card catalog (Bernal,
    Colonist, Contracts, Crew, Freighter, Generator, GW Thruster, Promo,
    Radiator, Reactor, Refinery, Robonaut, Thruster). Each numbered card shows
    both faces (front/back) with a "Flip Card" / "Split View" toggle. USE
    THIS as the visual + naming reference when hand-authoring new card art
    (e.g. colonist portraits) - it also covers cards from modules this
    implementation does NOT ship (per the gazetteer's numbering the Colonist
    deck runs 1-36, but this game's `data/colonists.js` only has the first 18
    - cards 19-36 are M4 content, out of scope, see "Variants we target").
    Cross-check any card pull against `data/` before assuming it's in scope.
- Reference repo for architecture/login/deploy patterns:
  https://github.com/RubenTipparach/murdoku-companion

See `reference/references.md` for this same link list alongside the
checked-in reference assets (manuals, maps, spreadsheets).

## Variants we target

Scope is intentionally narrow - only two play modes ship in this
implementation right now:

- **Standard** - the base multiplayer game described in the core
  rulebook. Drives the lobby / multiplayer engine.
- **CEO Solitaire** - the published one-player variant. A single
  player runs one ship against a round clock with no AI opponent.
  Only the structural concept (manage a FIXED water budget,
  prospect, claim, race the round clock) is taken from the
  variant's design; the engine is original. There is NO passive
  income (no end-of-round water, no per-lap aqua) anywhere in the
  base game OR the solo variant - water is a fixed budget plus what
  you actively refine, and aqua comes only from the active Income /
  Free Market operations. Do not add passive income.

  **Solo now runs as a single-player SERVER game ("solo online
  mode"): the same server-authoritative engine and the same shared
  front-end multiplayer uses, just with one seat.**

  **CEO Solitaire (V6) is implemented (board-meeting KPI loop,
  seniority disks, fatality disks, fired/promoted verdict, victory
  bands) on the SERVER, gated on `state.ceoSolo`. It runs the
  Solitaire Sol Political Assembly (4G3) law set, NOT the base M0
  laws. See `docs/ceo-solitaire-plan.md`. Futures are now implemented
  for M2 MULTIPLAYER rooms (see docs/module-m2-implementation.md),
  but the CEO SOLITAIRE Futures variant is STILL not wired: before a
  ceoSolo+m2 combination ships, REVIEW the CEO Solitaire Futures path -
  (1) the win condition flips from "VP >= KPI" to "complete a
  Future at the 7th board meeting", (2) the victory bands change
  (0-77 / 78-94 / 95-114 / 115+), (3) the short game uses 4
  seniority disks but a Futures game uses 7. None of that is wired;
  the current ceoSolo loop is the no-Futures variant only.**

  **The OFFLINE hot-seat solo (`js/game/solo.js`, the browser-only
  localStorage path) is FROZEN LEGACY. Do NOT touch it ever again.**
  The "+ New game" menu's entry point to START a new offline sandbox game
  was REMOVED (user directive 2026-07-23) - there is no more "Offline
  sandbox (legacy)" button. It is no longer maintained and never was
  reachable as a fresh-start path from that date forward: never update it,
  never bring it back into engine / rule / card parity, never "fix" it to
  match a new mechanic, never re-add a menu entry point for it, and never
  consider it when weighing a change. When a feature needs a solo path, add
  it to the server engine (like multiplayer) - the offline `solo.js` module
  itself is dead weight we still keep, ONLY so an existing bookmarked
  `/sandbox/<id>` URL from before the removal still loads (see
  `js/game/sandbox-games.js#activateSandboxGame` / `currentSandboxId`,
  still imported by `js/main.js` for exactly that resume path - do not
  remove those two functions).
  NOTE: this freeze is ONLY the offline `solo.js` orchestration. The
  shared sandbox FRONT-END (`js/game/browse.js`, `rocket.js`,
  `stacks.js`, `render.js`, etc.) is the live multiplayer UI and is
  very much maintained - see "The multiplayer UI IS the sandbox UI".

Other variants (campaign, scenarios) are explicitly out of scope
for now. Don't pull them in without a discussion first.

## Module gating - ZERO bleed-through

Optional HF4 modules (M0 Politics, M1 Terawatt, M2 Futures, ...) are opt-in
per room and carried into the game state as a boolean (`state.m0`,
`state.m1`, `state.m2`, ...). The hard rule:

- **NOTHING from a module may activate unless its flag is true.** No rule,
  op, free action, card, deck, board piece, UI affordance, or score effect
  from a module can be reachable when the module is off. An
  M\<n\>-off game must be byte-for-byte identical to the same game without
  that module. Every M\<n\> code path MUST gate on `state.m\<n\>` (engine)
  / `snapshot.state.m\<n\>` (client) - no exceptions, no "harmless" leaks.
- **The flag is fixed at room creation** (a checkbox -> the `lobbies.m\<n\>`
  column -> `createInitialState({ m\<n\> })` -> `state.m\<n\>`). Default
  OFF for every legacy + normal room, so games already in flight never
  retro-acquire a module.
- **M1 and M2 are BOTH open to every host. Both stay experimental.**
  (User decision 2026-06-25 released M1; M2 followed in v1.3.0.) Their
  room-creation / settings checkboxes are shown to every host and the server
  accepts `m1` / `m2` from any request - the create route reads them as a plain
  `body.m2 ? 1 : 0` with no admin check. This paragraph used to say M2 was
  admin-only and the server forced `m2 = 0` for non-admins; that has not been
  true since v1.3.0, and the stale text was still being quoted as if it were
  (corrected 2026-07-30). `m2` is plumbed as a structural mirror of `m1` (db
  column, `createInitialState` -> `state.m2`, client `isM2()`/`setM2()` + tags)
  but adds NO decks (unlike M1's two Terawatt decks). Both flags are still fixed
  at room creation, default OFF, with no retroactive apply. **Rat Frontier is
  the one feature still behind `profileIsAdmin`.**
- **Futures gate on `state.m2`.** The Futures deck physically ships in M1, but a
  Future is not playable until M2 (it needs Bernals / anchoring / the Epic-Hazard
  economy), so in this implementation futures are an M2 mechanic: every futures
  code path MUST gate on `state.m2` (practically M0+M1+M2; M2 forces M0 on).
  (User decision 2026-06-24.) LANDED 2026-07-02: the full M2 colonization loop
  (colonist queue + exomigration, Homesteading, Nanofacture, Lab / Colonist
  promotion, the EPIC_HAZARD futures op + orange stars + endgame re-check, and
  the colonist specialty / ability layer) is implemented behind `state.m2` -
  see `docs/module-m2-implementation.md` for what shipped vs what is still
  deferred (War of Independence, a few colonist powers, dirtside ops).
- When you build a module's mechanics, gate them behind the flag FIRST,
  then add the rule. New M1 cards/decks still come from the spreadsheet
  (see "Card data - single source of truth"); do not hand-author them.

M1 design lives in `docs/module-m1-plan.md` (incl. the Space Elevator + Big Cube
Swap + Futures-gating plan); the extracted module rules are in
`reference/manuals/`.

## Card data - single source of truth

**Card data MUST come from the spreadsheet.** The authoritative
source is `reference/HF4-card-data.xlsx` (kept in sync with the
shared Google Sheet). The importer
`scripts/extract-card-data.py` emits `data/card-data.json`
(for human audit) and `data/card-data.js` (for the browser).
`data/patents.js` consumes only the `.js` bridge - do not
hand-author patent records in `patents.js` and do not embed
literal stat tables in any other file.

If a card concept (a new column, a new card type, a balance
tweak) doesn't appear in the spreadsheet, it doesn't exist yet
- either edit the spreadsheet and re-run the importer, or push
back on the request. Don't paper over missing sheet data with
ad-hoc constants in JS.

Two structural rules that fall out of the sheet:
- **Labs and "modifier" cards aren't HF4 cards.** The
  spreadsheet has no Labs or Modifiers tab. Lab effects live
  as abilities on the parent card; modifier-style upgrades are
  the Tier-2 (dark-side) face of an existing card.
- **The "dark side" is a real second technology.** Every
  card-row in the spreadsheet is followed by a second row
  carrying a different name + different stats - that's the
  Tier-2 tech the same physical card flips to. Render both
  faces; don't treat the back as a re-skin of the front.
- **"Support Requirements" banner only.** Only the columns
  under that banner (the reactor/generator-type matrix) are
  stack supports. Other booleans like Push / Solar / Air Eater
  / ISRU describe what a card IS / DOES - render them as
  card-property badges, never as supports.

## Card model

Every card on the map / in a hand carries the same minimum set of
fields so the renderer + engine don't need per-card-type branches
for the common stats:

- `id` - stable string key
- `name` - display label
- `type` - `thruster | reactor | radiator | refinery | robonaut |
  generator | lab | crew | ...`
- `mass` - wet mass added to the ship stack (integer units)
- `radHardness` - rad-hardness rating (integer); cards with low
  values degrade faster near radiation hazards
- `faces` - `{ primary, secondary }`. Every component card is
  double-sided. By convention the **secondary face is the "black"
  / installed face**. Faces can carry their own stats so a
  flipped card behaves differently (e.g. a radiator opened vs
  stowed, or a thruster with a mode change).
  - **ALWAYS read the INSTALLED face for functional logic** (not
    `faces.primary`). A flipped card's mass, requires, supplies,
    thrustMod / fuelMod, therms, and prospector kind are the
    secondary face's, and 62 of 84 two-faced cards even differ in
    mass. Use `installedFace(slot)` (client, rocket.js) /
    `slotFace(slot, card)` (server, engine.js) keyed off
    `slot.face`; both must agree so a flipped card's weight-class
    band + fuel capacity match. Reading `faces.primary` for
    supports / thrust / prospecting / industrialize was a recurring
    bug (a black-side stack was checked against its white-side
    requirements); don't reintroduce it. Display-only reads (the
    card name, the Browse catalog grids) may stay on primary.
- `flipOrientation` - `'standard'` (default) or `'rotated180'`.
  Radiators are typically `'rotated180'`: their secondary face is
  drawn upside-down, matching the published cards.

Thruster-specific fields (carried on whichever face is active):
- `thrust` - push capacity (rendered as the value inside the pink
  thrust circle on the card). Triangle silhouette is fixed-size
  per the published convention; only the number inside the
  pink circle changes per card.
- `isp` - thrust per fuel step. The card's fuel droplet shows
  `ceil(thrust / isp)` (= the card's `fuel`), the FUEL STEPS one burn
  spends - NOT a water cost. See "Fuel steps vs water / aqua" below.
- `requires` - array of `{ kind, count }`. Stack constraints the
  ship's other cards must collectively satisfy. The card UI
  renders the requirement icons in a row (with an ×N badge for
  count > 1). `data/patents.js` exports `REQUIREMENT_KINDS` as
  the canonical enum (pulse-generator, thermostat,
  crew-quarters, sail, beam-receiver, push-sat, isru-rig,
  aerobrake-shroud, spin-grav). Other cards "supply" these
  kinds at BUILD time; thrusters consume them.
- `supports` (string array) is accepted as shorthand and auto-
  expanded into `requires` with count: 1 per entry.

**Fuel steps vs water / aqua - NOT the same unit.** A *fuel step* is
one black (burn) connection on the detailed fuel graph
(`js/game/net-thrust-detail.js`, the published net-thrust ladder).
Entering a burn node spends the thruster's `fuel` fuel steps, walking
the wet-mass chit that many black connections down toward dry mass. The
rocket's total burnable capacity is the count of black connections from
the WET chit to the DRY chit (`blackStepsBetween`). *Water* and *aqua*
are 1-to-1 mass units (tank water = wet mass - dry mass; aqua converts
1:1 to water). Fuel steps map to water only NON-linearly through the
ladder (a step buys less mass-fraction the heavier the ship: ninths in
WISP ... whole units in TUG), so "N fuel steps" is never "N water". Burn
costs in logs / UI are denominated in fuel steps, not water.

**Aqua IS water - the same substance, not an exchange.** The Aqua Bank
is the game's stock of water; converting Aqua to tank water (REFUEL /
`applyRefuel`) isn't a purchase of a different resource, it's drawing
water out of the shared bank. This is why the conversion is a flat 1:1
with no rate/fee. **The Aqua Bank is location-gated - it ONLY reaches
LEO and the player's own anchored Home Bernal** (`rocketAtRefuelDepot`,
server/game/engine.js), for the rocket / a Bernal unit. You can NEVER
draw Aqua at a remote outpost / factory / freighter - that would be
teleporting bank water into deep space, a hard no. To get water onto a
remote unit you must physically carry it there or refine it locally.
`LOAD_FREIGHTER_WATER` is exactly that kind of LOCAL move: it pumps an
OUTPOST's own tank water (not the bank) into a water fuel cargo card on
a colocated Freighter, the same stack-to-stack water rule as
`TRANSFER_FUEL`, subject to the Freighter's mass load limit (rule 1B).

**When the user says "FT", STOP and ask which they mean.** "FT" is
ambiguous - it can mean AQUA (the bank currency) or fuel steps. Don't
guess: say it's ambiguous and ask whether they mean aqua or fuel steps
before acting.

**Fuel economy rules (the target model):**
- **Burning** walks the BLACK connections (fuel steps). A burn spends
  the thruster's `fuel` fuel steps; the water that costs is the
  non-linear mass-drop of those steps, so the tank can end on a
  fractional position (a sub-1-unit *remainder*).
- **Fuelling / unfuelling** walks the RED (refuel) connections. Water
  moved to an outpost or back to the bank moves in WHOLE water units
  only; any sub-1-unit remainder CANNOT be transferred and stays in the
  source tank. Show that remainder in the fuel-tank modal.
- A stack can be **scrapped** when it has no cards AND less than 1 unit
  of water left.

RECONCILE LANDED (2026-06-04). The fuel-graph node model is now a shared
pure module `data/fuel-graph.js` (NODES / BLACK / RED + `blackStepsBetween`
+ `walkBlackDown`), imported by BOTH the client (`js/game/rocket.js`,
`js/game/net-thrust-detail.js` for rendering) AND the server
(`server/game/engine.js`). Capacity = `blackStepsBetween(dry, wet)` (the
black-connection count) everywhere - `getActiveThrusterStats().fuelSteps` +
`burnsAvailable` and the server's MOVE check agree. A burn spends fuel STEPS
(`ceil(fuelPerBurn * thisTurnBurns)`); MOVE is affordable iff that many black
steps fit before dry, and the deduction is `walkBlackDown(wet, steps)` so the
tank lands on the non-linear new mass and can hold a fractional remainder
(tank water is no longer floored client- or server-side). REFUEL / CASH_WATER
move WHOLE water units and preserve the remainder. `fuelStepsBetween` in
`data/net-thrust-track.js` is now UNUSED by the fuel path (kept only if some
other reader needs it). The `insufficient_water` op error carries a `detail`
breakdown ({thisTurnBurns, fuelPerBurn, fuelStepsNeeded, fuelStepsAvailable,
tank, dry/wetMass}); the Simulate dry-run + the `[move]` console log surface it.
Still TODO: show the fractional remainder explicitly in the fuel-tank modal,
and the no-cards-and-<1-water scrap rule.

NOTE: there is NO `power_req` field. Older drafts had one; it
was removed because requirements are gated through the kind/
count system instead.

Spectral type:
- Every card carries a `spectralType` (default 'C'). One of
  C / S / M / V / B / D. Rendered as a coloured hex glyph in
  the card's stat box; the engine (Stage 3+) can use it for
  refuelling / matching at sites.

Crew cards: still double-sided, but the two faces are
**functionally independent** - each face is its own crew member
with their own role / skills, sharing only the physical card.
Use `faces.primary` and `faces.secondary` as fully-formed crew
records; nothing should treat the "back" of a crew card as a
secondary mode of the front.

Some cards (boosters, augments, certain robonauts) **modify**
another card's stats while attached. The engine handles this via
a `modifier` block on the modifying card; see
`server/game/engine.js` (Stage 3+) for how those compose.

## Support chains - modifier + cooling rules

Cards power each other through a multi-hop **support chain**, not a
single hop. A thruster names a power requirement (a `reactor-*`
OR-group, or `gen-electric`); the card that supplies it may itself
require a further power source, so the real chain runs e.g.
THRUSTER -> GENERATOR -> REACTOR -> radiator. The reactor two hops
back still belongs to the thruster's chain, so a one-hop "does this
card directly supply the thruster" scan is WRONG: walk the whole chain.

Three rules govern how the chain feeds the active thruster:

1. **First reactor only.** The FIRST reactor encountered walking out
   from the thruster is the ONLY reactor that modifies the thruster
   (`thrustMod` / `fuelMod`). Reactors deeper in the chain power their
   part of the chain but do NOT shift the thruster's stats.
2. **Generators before that reactor modify.** Every generator in the
   chain BEFORE the first reactor also modifies the thruster. A
   generator AFTER the first reactor does not.
3. **Dedicated reactor cooling.** The therms a reactor consumes cannot
   be shared with any other therm requirement in the chain. Each
   reactor reserves its own radiator cooling; a radiator's therms
   counted toward one reactor can't also cover another. Dedicated
   cooling is a REACTOR-only rule; non-reactor heat draws the shared
   remainder.

Circular dependencies are REAL in the card set (e.g. a generator that
supplies `gen-radioisotope` feeding a reactor that requires it and
supplies the `reactor-*` the generator needs). The chain walk must
visit each card ONCE, so a cycle is detected and flagged but never
breaks the walk or double-counts: a chain with a cycle is still valid.

The resolver is pure + shared: `data/support-chain.js` (it lives in `data/`
so BOTH `js/game/rocket.js` and `server/game/engine.js` import it, the same
reason `data/fuel-graph.js` does). It is the single source of truth for these
rules.

INTEGRATION LANDED (2026-06-05). The resolver now drives the engine; the
one-hop modifier scan is gone. Rules 1+2 (the modifier path) fold into thrust
+ fuel on BOTH the client (`rocket.js#getActiveThrusterStats`) and the server
(`engine.js#activeNetThrust` + `thrusterFuelPerBurn`): each normalises the
stack into the resolver's card shape (supplies off the primary face; requires
/ thrustMod / fuelMod off the installed face) and folds the same
`modifierChain` in the same order, so a multi-hop reactor (THRUSTER ->
GENERATOR -> REACTOR) now modifies and the two sides stay byte-identical (a
move the client allows is never rejected for a different number). Rule 3
(dedicated reactor cooling) drives the client's `isRocketActive` cooling gate
via the resolver's `coolingOk` (each reactor reserves its own radiator therms;
the thruster + generators draw the remainder; the common single-reactor stack
is the same verdict as before). The SERVER does NOT gate cooling at all (it
trusts the client, like routes), so rule 3 is client-only.

COOLING NOW SPANS BOTH CHAINS (2026-06-06). The active thruster chain and the
active prospector (robonaut) chain share ONE stack-wide radiator pool, and
dedicated reactor cooling holds ACROSS them: a reactor in the prospector chain
cannot reuse therms a thruster-chain reactor already reserved. The pure
`data/support-chain.js#resolveCoolingAcross({cards, orders})` resolves cooling
over chains in PRIORITY order - the active thruster gets first claim (user
decision: prioritize thruster); the prospector reserves its reactor's dedicated
therms from the remainder and its active card reads INACTIVE (not the thruster)
if it can't. A reactor that powers BOTH chains is cooled ONCE (the higher-
priority chain reserves it; the other reads it shared). `resolveSupportChain`'s
own cooling is now just the one-chain case of this helper, so the single-chain
`isRocketActive` verdict is byte-identical to before. `getActiveProspectorStats`
reads the prospector's per-chain verdict off `coolingAllocation()` (replacing
the old `chainThermBalance` shared-pool helper, now deleted), and
`getSupportChainView` re-resolves the prospector root against the post-thruster
remainder so the visualizer pills match the gate. ONLY the active thruster and
active prospector are ever support-checked: inactive thrusters, inactive
robonauts, and refinery cards are never roots, so their supports are never
checked here (a refinery's supports are checked only at BUILD_FACTORY).

VISUALIZER + WIRING LANDED (2026-06-06). The support-chain visualizer is a
folder tree inside the rocket stack modal (`js/game/browse.js#buildSupportChainViz`),
one root per active card (the active thruster, then the active prospector),
drawn in the All-cards abbreviated-chip language. It walks OUT from the active
card to the cards that power it; a card reached a second time (a cycle back-edge
or a supplier shared within the tree) renders as a non-recursing reference leaf,
mirroring the resolver's visit-once walk, and cycles are flagged amber (never
broken). Rule 4 lands: every node shows a check / cross validity pill and notes
the modifier path (rules 1+2), dedicated reactor cooling (rule 3), and any
missing support. The read it drives off is the pure `rocket.js#getSupportChainView()`
(resolves both roots + per-node requirement-group satisfaction + the wirable
candidate suppliers).

PLAYER WIRING is now server-authoritative. The chain is player-wired through a
`wiring` map (`{ consumerId: { kind: supplierId } }`) that the resolver already
consumed; the visualizer now PRODUCES one. A consumer with more than one
candidate supplier for a kind gets a picker; choosing one updates the map. The
map persists per-player on the server (`player.rocket.wiring`, state.js) via the
turn-gated `SET_WIRING` op (engine.js, mirrors `SET_ROUTE`), and the client store
lives in `rocket.js` (`getWiring` / `setWiring`, localStorage solo, snapshot
hydrate online via net-bridge). CRITICAL: wiring picks which reactor is "first",
so it shifts thrust / fuel (rules 1+2) and therefore the MOVE cost. Both the
client (`rocket.js` getActiveThrusterStats + isRocketActive) AND the server
(engine.js activeNetThrust + thrusterFuelPerBurn) resolve with the SAME wiring,
so a move the client allows is never rejected for a different number, the same
byte-parity contract the modifier path already holds. Wiring is PUBLIC (it tunes
a stack opponents can already see), so `SET_WIRING` returns a real log line and
is not redacted. The resolver auto-falls-back to first-match for any wiring entry
whose supplier left the stack, so a stale map never breaks a chain.

RULE 5 LANDED (2026-06-06, "may share" semantics). Parallel robonaut chains:
the thruster chain and the prospector (robonaut) chain run in PARALLEL and MAY
SHARE supplier cards freely - one reactor can power both at once with no
contention (user decision 2026-06-06). Because sharing is free, resolving each
root independently is already correct: a card reached by both is flagged
"shared with other chain" in the visualizer, not contended, so NO dedicated-pool
multi-root resolver was needed (that would only matter for a "dedicated per
chain" rule, which we did NOT adopt). The one real case rule 5 adds: a card that
is BOTH the active thruster AND the active prospector (a missile robonaut that
carries thrust) serves both roles with ONE chain - `getSupportChainView` detects
`_activeProspectorId === _activeThrusterId` and tags the single thruster root
`alsoProspector` instead of rooting a second identical tree; the visualizer
labels it "Thruster + prospector chain". Display-only: no move / activation /
fuel change (sharing means no new constraint to gate). `resolveSupportChain`
still walks a single chain per `activeId`, which is the right primitive here.

## Stages - build incrementally

Verify each stage before starting the next. Don't conflate stages in a
single PR.

- **Stage 1 (done):** Identity + social layer. Profiles, lobby
  (create / list / join), chat, friend search, invite links. Game
  surface was a placeholder.
- **Stage 2 (current):** Static data + read-only renderer. The
  solar-system map (`data/sites.js`), patent deck (`data/patents.js`),
  and milestones (`data/glory.js`); an SVG renderer with pan/zoom;
  a ship-card composer (validation rules + burn-cost math) ready
  for Stage 3 to call. A Browse view on the topbar lets anyone
  inspect the data; the lobby's game-overlay now mounts the map
  (read-only) when the host starts.

  NOTE: there is no separate "politics / events deck". The only
  events in this game are the Sunspot Cube events surfaced by the
  turn-clock modal (Inspiration / Glitch / Pad Explosion / Anarchy
  / Budget Cuts / Solar Flare - see `EVENT_TABLE` in
  `js/game/turn-clock.js`). An earlier `data/politics.js` with a
  "Solar Storm / Mining Boom / Trade War" deck was a fabrication
  and has been deleted; do not reintroduce it.
- **Stage 3:** Server-authoritative engine. Operations phase, MOVE /
  BURN / PROSPECT / INDUSTRIALIZE / AUCTION / BUILD ops. Validated
  on the server; optimistic mirror on the client. New tables in
  `server/db.js` for games, operations, and per-game state.
- **Stage 4:** Full coverage. Refineries, habitat / Bernal stations,
  Sunspot-Cube event resolution, milestone awards, futures market,
  end-of-game scoring.

If you're adding a feature, mark the stage it belongs to in the
commit message so the boundaries stay legible.

## Architecture

Mirrors the murdoku-companion split:

```
┌────────────────────────────────┐   HTTPS+CORS   ┌────────────────────────────────┐
│ GitHub Pages                   │ <------------> │ Fly.io app: high-frontier-fan-game  │
│ esbuild bundle -> dist/ (hashed)│  WS (wss://)  │  Express + ws + better-sqlite3│
│ index.html, css/*, js/*        │ <------------> │  volume: /data/hf.db          │
│ deployed on every branch       │                │  admin at /admin              │
└────────────────────────────────┘                └────────────────────────────────┘
```

- **Frontend**: plain HTML/CSS/ES modules, no framework. Local dev is
  build-free (serve the repo root; `index.html` loads the raw `./js/main.js`
  as ES modules). PRODUCTION runs one build step: `scripts/build.mjs` bundles
  + minifies with esbuild into `dist/` using content-hashed filenames, and CI
  deploys `dist/` to GH Pages on every push to every branch. The hash is the
  cache-bust: a changed module gets a new URL, so clients can never get stuck
  on a stale deep module (the failure that `?v=` on the entry alone could not
  fix - deep imports carried no version). See "Build + cache-busting" below.
- **Backend**: Node 20 Express server with `better-sqlite3` for persistence
  and the `ws` library for WebSocket gameplay. One SQLite file on a Fly
  volume (`/data/hf.db`). Single-writer; do not horizontally scale.
- **Deploy**: `.github/workflows/deploy.yml` runs on every push. Pages and
  Fly deploys are independent jobs; Fly job is gated on the canonical repo.

### Build + cache-busting

Production is bundled; local dev is not.

- **Local dev (no build):** serve the repo root (`python3 -m http.server`).
  `index.html` loads `./js/main.js` as raw ES modules - edit + refresh, no
  build. Keep the source runnable this way.
- **Production (`scripts/build.mjs`, esbuild):** bundles + minifies into
  `dist/` with content-hashed names (`js/main-<hash>.js`, `css/*-<hash>.css`).
  The build keeps the entry at `dist/js/` depth ON PURPOSE, so `base.js`'s
  `import.meta.url` `'../'` still resolves to the app root from inside the
  bundle. It rewrites the dist `index.html` to the hashed names, writes
  `version.json`, injects the commit SHA into version-check (esbuild
  `--define`), and copies the runtime-fetched assets (rocket PNGs, planner
  `data-hf4.json`, `site-flags.json`) to their app-root-relative paths - they
  are NOT imported, so the bundler never sees them; `base.js#assetUrl`
  resolves them at runtime.
- **Why hashing:** ES module imports carried no `?v=`, so a deploy only
  cache-busted `main.js`, never the modules it imported - clients got stuck on
  a stale deep module after a deploy. Content hashes make a changed module a
  new URL (always re-fetched); `version-check.js` still reloads kept-open tabs
  so they pick up the new `index.html`.
- **CI gates (both must pass before deploy):** `node scripts/check-boot.mjs`
  links the source module graph, and the esbuild build itself fails on any
  parse/link error. The deploy uploads `dist/`, not the repo root.
- Adding a runtime-fetched asset? Load it via `assetUrl(...)` AND add it to
  the copy list in `scripts/build.mjs`, or it will not exist in `dist/`.

### Site IDs - ONE wire id space (the SERVER slug)

There are TWO site id spaces and mixing them is a recurring bug (Homestead
`unknown_site`, the solar-zone regressions, etc.). Standardise on the SERVER
slug for anything that crosses the wire or is stored in game state.

- **Server slug** = `data/sites.js`'s `id` (e.g. `ceres`, `mercury_north_pole`).
  It is the ONLY id the server understands: `server/game/graph.js#siteById` is
  `SITES_BY_ID[id]`, and `state.factories` / `state.colonies` / `state.discs` /
  `rocket.siteId` are ALL keyed by it. A server snapshot therefore keys those maps
  by the server slug too. On the client, `data/sites.js#SITES_BY_ID` is the same
  map keyed the same way, so `SITES_BY_ID[id]` is a cheap "is this a server slug?"
  test.
- **Client planner id** = the map node's `s.id` in `_activeData.sites` (the
  vendored mission-planner graph). It is what the RENDERER and the planner use.
  Each planner node also carries `s.id2` = the server slug (`makeRefId`), and
  `net-bridge.js#buildIdMaps` builds `plannerToServer` (`s.id -> s.id2`) /
  `serverToPlanner` (`s.id2 -> s.id`) from it.
- **Rules (do not violate):**
  - **Every op payload siteId on the wire is the SERVER slug.** Convert a client
    planner id with `toServerId(_onlineMaps, plannerId)` right before submitting
    (`MOVE` does this in `browse.js#buildTurn1MoveOp`; `INDUSTRIALIZE` does
    `toServerId(_onlineMaps, site.id)`). Never send a raw planner id - the server
    rejects it as `unknown_site`.
  - **Snapshot maps (`snapshot.factories/colonies/discs`) are ALREADY server
    slugs** - iterate their keys directly for a wire id; `net-bridge.js`
    `rekeyToPlanner`s a COPY into planner ids only for the client render stores
    (`getFactory` is planner-keyed), it does not touch the snapshot.
  - **Robust resolve when the source id could be either:** a shared helper that
    might be handed a planner id OR a server slug resolves with
    `SITES_BY_ID[id] ? id : (toServerId(_onlineMaps, id) || id)` (see the Homestead
    picker). SITES_BY_ID-hit means it is already a server slug; otherwise convert.
  - Use `toPlannerId(_onlineMaps, serverSlug)` for the reverse (placing a
    server-keyed thing on the client map).

## Two play modes - async and realtime

The game supports both:

- **Async** (default): players submit one operation at a time via REST.
  When it's your turn the lobby/email/in-app notification flips. Games
  can sit dormant for days. State lives in SQLite.
- **Realtime**: when 2+ players are subscribed to the same game over
  WebSocket, operations broadcast immediately and the UI animates in
  the other player's session.

REST is the source of truth. WebSocket is a real-time relay on top of
the same operation log - every WS-applied operation is also written to
SQLite, and every REST operation is broadcast to any open WS clients.
A player who walks away and comes back gets the same state by REST as
if they'd been live the whole time.

### Async-multiplayer doctrine - WS is unreliable

WebSocket is for **fast updates, NOT async play**. It is a
best-effort optimisation that makes live sessions feel snappy; it
is NOT a reliable transport and it is NOT how async-multiplayer
events arrive at the other player. Treat every WS broadcast as a
nice-to-have. Failure modes we've actually observed:

- **Browsers fail the WSS handshake outright.** "Firefox can't
  establish a connection to the server at wss://..." - the player
  never receives any push for the whole session.
- **Mobile networks silently drop frames.** Backgrounded tabs,
  walking out of wifi range, captive portals - the socket stays
  "open" but no data arrives.
- **Server hiccups + proxy timeouts close the channel.** Reconnect
  fires eventually but the missed broadcasts are gone.
- **WS broadcasts cause desync.** A push that arrives at one player
  but not another leaves the two clients showing different boards;
  same for an op that the local client applied optimistically but
  the server rejected. Any UX decision that "the broadcast will
  arrive" is a bug waiting to fire.

So: WS is a UX accelerator on top of REST. REST is the source of
truth. The client MUST NOT assume a WS event implies the
server's current state, and MUST NOT block a UX decision on
"the broadcast will arrive". Concrete rules:

- **Poll the server on an interval.** `js/game/browse.js` runs a
  snapshot poll while online: 5s normal, 500ms while an auction is
  open. The cadence switches in `applySnapshot` based on
  `snapshot.auction`. Don't disable polling because WS "should
  cover it".
- **Cache the last snapshot.** `_onlineSnapshot` holds the most
  recent server state; every turn-ownership check, action gate, and
  budget read goes through it instead of trusting transient WS
  events.
- **Polling must NOT invalidate local state unless the server
  actually advanced.** This is the rule, learned the hard way: a
  naive `applySnapshot` that re-hydrates every module on every poll
  tick stomps on in-progress local UI (it wiped the player's boost
  selection every 5s - boost marks were cleared inside `hydrateHand`
  on every snapshot). The fix is two-layered:
  1. **Seq-gate the whole apply.** `applySnapshot(state, seq)` takes
     the server op-log `seq` (from the game wrapper) and returns
     immediately when `seq === _lastAppliedSeq`. Every meaningful
     change (any op: MOVE / END_TURN / AUCTION_* / PICK_CREW)
     advances the seq, so a poll that returns the same seq is a
     genuine no-op: no module re-hydrate, no re-render, nothing
     touched. Error snap-back calls pass no seq to force a re-apply.
  2. **Make each hydrator idempotent + non-destructive.** Even when
     the seq DOES advance (an opponent moved), re-hydrating my own
     stacks must preserve my in-progress selections. `hydrateHand`
     keeps boost marks for cards still in the hand and only fires
     its change listeners when the hand or marks actually changed.
     Apply the same discipline to any new hydrator: diff, preserve
     local-only UI state, and only notify on a real delta.
- **Eager one-shot fetches** on phase transitions where latency
  matters (e.g. auction `bidders → auctioneer`) shave the
  worst-case wait below one tick.
- **Never let a player take a turn without server validation.**
  Action buttons (End turn, op menu, move, BUILD_ROCKET, PROSPECT,
  AUCTION_*) are disabled in the toolbar when `isOnlineMyTurn()`
  is false. `submitOnlineOp` re-checks turn ownership against the
  cached snapshot and refuses if it's stale. The server then
  re-validates and rejects any racing op with `not_your_turn` /
  `auction_in_progress`. UI + client + server all enforce the
  same rule.

If you're adding a new multiplayer action, follow the chain:
1. Disable the control in the toolbar when not my turn.
2. Gate the submit helper on the cached snapshot.
3. Validate again on the server in the engine handler.

### Room routing + version reload - DON'T kick players to the lobby

The active room lives in the URL as a real path segment:
`/<base>/room/<CODE>` (e.g.
`rubentipparach.github.io/high-frontier-fan-game/room/DPAT3R`). This
is load-bearing: it's what lets a refresh, a restored tab, a
dropped-WS reconnect, AND a **version-bump auto-reload** drop the
player back into the SAME room instead of the lobby list. Breaking
any link in this chain regresses to "every deploy kicks everyone
out mid-game", which is the exact failure we're guarding against.

The chain (do not sever any piece):

- **`setRoomInUrl(code)` (js/lobby.js)** writes `/<base>/room/<code>`
  via `history.replaceState` on `openLobby`, clears it on
  `leaveCurrent`. It preserves the `?v=<sha>` version pin. The app
  base is resolved from `import.meta.url`, NEVER from the address
  bar (the bar can already be a deep `/room/...` path).
- **Codes are lowercase + Crockford base32.** `CODE_ALPHABET` in
  `server/index.js` is `0123456789abcdefghjkmnpqrstvwxyz`, and the
  DB stores codes verbatim. SQLite's `=` is case-sensitive, so the
  URL form MUST be lowercase or the lookup misses. `setRoomInUrl`
  lowercases on write; the server's `/lobbies/by-code/:code` (and
  the two invite-link endpoints) run params through `normaliseCode`
  which lowercases + alphabet-validates before any query, so a
  mixed-case shared link still resolves and a garbage segment
  short-circuits with `bad_code`. Don't reintroduce
  `.toUpperCase()` on either side - cosmetic uppercase made the
  URL case-sensitive and broke `/room/DPAT3R` resume.
- **`404.html`** is the GitHub-Pages SPA fallback. GH Pages has no
  server routing, so a hard load / version reload of `/room/<CODE>`
  has no file and hits 404.html, which stashes the code in
  `sessionStorage['hf-room-redirect']` and redirects to the app
  root, carrying `?v=` + hash. Keep 404.html dependency-free (inline
  script, no module imports) - it runs before the app exists.
- **`maybeResumeRoomFromUrl()` (js/main.js)** runs on boot, reads
  the code via `readRoomCode()` (sessionStorage stash -> `/room/`
  path -> legacy `?room=` query), and re-opens the lobby. `openLobby`
  then calls `setRoomInUrl` to restore the visible `/room/<CODE>`.
- **`js/version-check.js`** force-navigates to `location.href` with
  a new `?v=<sha>` when a deploy lands. Because that keeps the
  `/room/<CODE>` path, the reload flows back through 404.html ->
  stash -> resume. CRITICAL: version.json is fetched against the
  SCRIPT's own URL (`new URL('../version.json', currentScript.src)`),
  NOT a relative `./version.json` - a relative fetch resolves against
  the deep `/room/...` address bar and 404s, silently disabling the
  version check.

Net: a `git push` that bumps the deployed SHA reloads every open
client AND keeps each one in its room. If you touch routing,
version-check, or the boot landing logic, re-verify this end to end.

## Lobby + social

- **Profiles** are token-based, mirroring murdoku-companion exactly:
  client generates 32 random bytes, server stores `sha256(token)` in
  the `tokens` table. Multi-device per profile via the "add device
  code" flow. Names are case-insensitive unique, 3-20 chars
  `[A-Za-z0-9_-]`, reserved list at the top of `server/index.js`.
- **Lobby**: a list of in-progress games. Each game has a host, a
  player count, a join policy (`open` / `invite-only`), a chat
  channel, and a join code.
- **Chat**: per-lobby (open chat) and per-game (table chat). Messages
  persist in SQLite, broadcast over WS to subscribed clients.
- **Invites**: two paths.
  1. **Search by name** - type a profile name; if it exists you can
     invite them directly. Invite shows up in their /notifications
     feed and pings any open WS session.
  2. **Invite link** - generate a 12-char share code (`/i/<code>`)
     that anyone can paste into the game lobby to join the table.
     Links can be single-use or unlimited; host picks at create.

### Snapshot apply is INTERPRETATION, not replacement

Critical lesson (user 2026-05-29: "you are eagerly updating the
simulation/game state ... server will give you the state, but you
must interpret state gracefully and smoothly without doing abrupt
updates").

REST is the source of truth, but `applySnapshot` is NOT licensed to
slam the new state into every module and call it done. The user sees
each diff as a CHANGE that needs an animation - the rocket sliding
along its route, the dice tumbling on a prospect, the cards drifting
between stacks. A direct hydrate from a server snapshot SKIPS every
one of those, and play feels jarring and disconnected from intent.

Doctrine:

- **Diff first, apply second.** Before re-hydrating from a new
  snapshot, compare the relevant slice to `_onlineSnapshot` (the
  last applied state) and identify what changed at the granularity
  the player perceives: a rocket move, a card transfer, a dice roll
  outcome, a deck top consumed, etc.
- **Animate the transition, then commit.** Drive the same animation
  the sandbox does (e.g. `animateRocketAlong`, the prospect dice
  modal, the fuel-tank tween) FROM the previous state TO the new
  state. The hydrators run AFTER the animation completes, so the
  final DOM matches the server. If the player skips / interrupts,
  jump to the final state at once but never *start* by snapping.
- **Guard against double-animation.** A poll tick that returns the
  same `seq` as `_lastAppliedSeq` is a no-op; only a real seq
  advance triggers an animation pass. Sandbox-style "consume your
  own move locally first then await server" is fine when the
  server response confirms; the snapshot diff just re-uses the
  animation infrastructure for OPPONENTS' moves and for any move
  the client didn't initiate (a refresh-resume, a spectator view).
- **Animation reads from the op log when needed.** The snapshot
  state has the final position but not the intermediate hops; for
  multi-segment MOVE the server publishes the planned route
  segments alongside the snapshot (or the client recomputes via
  the same planner graph). For dice (PROSPECT, hazard), the op
  payload carries the roll value(s) so the animation plays the
  same outcome the engine resolved.
- **Default to in-place layout updates** for everything else (turn
  banner, roster, mp panel, mission log). Those aren't "events" in
  the player's mind, they're status reads; treat them as live but
  passive.

When you wire a new op in multiplayer, the question to answer is
NEVER "does the snapshot apply correctly?" - the engine already
guarantees that. The question is "what does the player SEE happen,
and does my code reproduce that motion before the state snaps?"

## High Frontier - implementation scope

We aim for **maximum coverage** of the HF4 core rules in `server/game/`
and `js/game/`. Authoritative tables in `data/`:

- `data/sites.js` - solar system map. Each site has `{id, name, body,
  class, hydration, type, vps, dvFromLEO, isSurface}`. Class drives
  the prospect die roll; hydration tells the refinery how much water
  it makes per turn; `dvFromLEO` and adjacency edges feed the
  delta-v movement engine. Covers inner planets, Mars system, main
  belt (Ceres, Vesta, Pallas, Hygiea, Psyche, ~12 more), Jupiter
  Trojans, Galilean moons, Saturn system, KBOs.
- `data/patents.js` - patent deck. Each patent is one of:
  `thruster`, `reactor`, `radiator`, `refinery`, `robonaut`,
  `generator`, `lab`. Thrusters carry `{thrust, isp, mass}`. The
  deck is shuffled per game from a seeded RNG so replays match.
- `data/glory.js` - glory cards (first-to-X awards).

**The server engine mirrors the sandbox.** Other than the auction
(built fresh server-side) and the future M0 + trading mechanics, almost
all of the stack, build, transfer, and move logic is the same as the
single-player sandbox (`js/game/*`, e.g. `stacks.js`, `rocket.js`,
`hand.js`). Don't re-derive those rules on the server; port the sandbox
logic so the two modes stay in lockstep. `server/game/state.js` already
carries the same per-player shape for exactly this reason.

**The multiplayer UI IS the sandbox UI - reuse it, never rebuild it.**
Learned the hard way: do NOT build a separate or "simpler" multiplayer
front-end. Multiplayer must mount the SAME view as the single-player
sandbox - the classic solar-system map (the sandbox renderer + map
data, not a stripped-down delta-v graph), the same rocket-stack / hand /
outpost / factory / disc panels, the same card rendering and site
popups. The ONLY differences are that actions route through the
multiplayer server API (`submitGameOp`) instead of mutating local state,
and the board hydrates from the server snapshot each update. The
competitive auction is the lone exception (the sandbox auction is solo),
so it gets bespoke multiplayer UI layered on top of the shared sandbox
surface; everything else is sandbox code driven by the multiplayer API.

**Operations and free actions (canonical action economy).** Sourced from
the Geoff Speare HF4 Player Aid (`reference/HF4-player-aid.pdf`). A turn
is: move the spacecraft, take any number of free actions, and take
exactly ONE operation, in any order. This table is the authoritative
answer to "does X cost the turn's operation, or is it free?" For example
Site Refuel is the Operation (it spends the op), while topping up dirt /
water for free at LEO, a Factory, or an anchored Bernal rides the Cargo
Transfer free action. The Scope column: `core` ships in Standard mode;
`M0` / `M1` / `M2` rows are module-gated and OUT of current scope (see
"Variants we target"), listed only so the core / module boundary stays
legible.

Operations (each one spends the turn's single operation):

| Operation | What it does | Scope |
|---|---|---|
| Income | Gain 1 Aqua. | core |
| Research Auction | Auction the top card of any deck (need fewer than 4 hand cards to start or bid; auctioneer wins ties). | core |
| Free Market | Sell a Hand card for 3 Aqua, or a Black-Side LEO card for its Exploitation-Track value. | core |
| Boost | Play White-Side cards from Hand to LEO, paying Mass in Aqua. | core |
| Site Refuel | Refine local water into the tank. ISRU: 1 + Hydration - ISRU. Factory: a flat 7. | core |
| Prospect | Evaluate and claim a site: ISRU <= Hydration, then roll 1d6 <= Site Size (Size > 5 auto-succeeds). | core |
| Industrialize | Build a Factory: decommission a robonaut + refinery (plus supports) at a claimed site. | core |
| ET Production | Produce a Black-Side card from Hand into a Factory matching the site's Spectral Type. | core |
| Delivery | Move a Black-Side card from a Factory to LEO. Cost: FT = zones-from-Earth x2 (+1 if Site > 7). | core |
| Fundraise | Replaces Income: place or move a delegate, gain 1 Aqua, run a vote tally. | M0 |
| Promotion | Flip a Freighter / GW thruster / Colonist to its Purple-Side at its Promotion Site. | M1/M2 |
| Nanofacture | Create a Mobile Factory at an anchored non-Home Bernal. | M1+M2 |
| Anchor | Anchor a Bernal as a space station; gain its ability. | M2 |
| Homesteading | Build a Colony at a Factory that has none. | M2 |
| Epic Hazard (Space Elevator) | Build a Space Elevator (Epic Hazard roll). | M1 |
| Epic Hazard (Future) | Complete a Future (Epic Hazard roll). | M2 |

Free actions (no operation cost; any number per turn):

| Free action | What it does | Scope |
|---|---|---|
| Cargo Transfer | Move cards / FTs between colocated stacks; free dirt refuel with any ISRU card at a Factory or Site. | core |
| Internal Tankage | Convert between FTs and Fuel; decommission cards for dirt fuel. | core |
| Build Colony | Create a permanent Colony at a Factory (decommission a Crew / Colonist). | core |
| Claim Jump | Replace an opponent's Claim with yours (Human present, no opposing Factory / Human). Felony. | core |
| Load Glory Chit | Load a glory chit from a site no Human has visited (Human present). | core |
| Voluntary Discard | Discard cards / figures (1 Human per turn max). Felony for Humans. | core |
| Glitch Repair | Remove a Glitch token from a colocated stack (Human present). | core |
| The Martian | Move a Crew / Colonist along a buggy road (needs an operational buggy). | core |
| Lobby | Remove a delegate to gain an inactive Law's benefit (once per turn). | M0 |
| Big Cube Swap | Swap a Freighter cube with a Factory cube. | M1 |
| Exomigration | Gain the topmost Colonist when below the Colonist limit. House rule (user 2026-07-02): never forced - anchoring only opens the berth; the player exomigrates when ready, picks the station it boards (anchored Bernal or LEO), and the delegate seat is optional. | M2 |
| Unanchor | An anchored Bernal becomes mobile again. | M2 |
| Space Elevator | Move between the ends of a Space Elevator. | M1 |

Server-authoritative engine in `server/game/engine.js`:

- Round structure: **Income → Operations (each player, 4 ops) →
  Politics → Hand reset**.
- Operation kinds: `MOVE`, `BURN`, `PROSPECT`, `INDUSTRIALIZE`,
  `BUILD_FACTORY`, `BUILD_REFINERY`, `AUCTION_START`, `AUCTION_BID`,
  `AUCTION_PASS`, `BUILD_ROCKET`, `DECOMMISSION`, `BUY_FUTURE`,
  `END_TURN`.
- **Debug dry-run.** `POST /games/:id/ops` with `debug: true` on the body
  SIMULATES the op: the engine runs it on a throwaway clone (applyOperation
  already clones, so the live state is untouched) and returns
  `{ ok, log, tankBefore, tankAfter, siteAfter }` (or `{ ok:false, error }`)
  WITHOUT persisting or broadcasting. The route-options modal's "Simulate
  planned move" button uses it to preview a move's fuel-step cost before the
  player commits. Read-only; safe to call anytime.
- Movement uses the delta-v graph; each "burn" consumes 1 tank unit
  scaled by the active thruster's ISP. Aerobrakes and pivots have
  special edges.

  **Movement authority - server validates FUEL, not ROUTES.** The CLIENT
  (the vendored mission-planner port, `js/game/planner-nav.js` +
  `planner-dijkstra.js`) owns routing: the Hohmann-aware burn counts (free
  coasting along a transfer = 0 burns, pivots cost extra) and the per-turn
  split (which legs fire on which turn, bounded by thrust burns/turn). MOVE
  sends the SERVER this turn's segments `[{from, to, burns, turn}]`. The
  server does NOT verify the route's geometry (continuity from the rocket,
  segment chaining, node existence) - re-validating it meant maintaining a
  second route model that drifted and spuriously rejected a route that IS
  connected (`route_not_from_here`). Instead the server does the SAME fuel
  calculation the client does, off the shared `data/fuel-graph.js`: capacity =
  `blackStepsBetween(dry, wet)`, a burn spends `ceil(fuelPerBurn * burns)` fuel
  STEPS, the move is rejected (`insufficient_water` + a fuel-step `detail`)
  only when those steps don't fit, and the spend walks the wet chit
  (`walkBlackDown`) leaving a fractional remainder. It then resolves hazards /
  factory-assist / dice authoritatively and executes only that one turn. The
  ids on the wire are SERVER slugs: the client converts planner ids ->
  slugs in ONE place (`browse.js#buildTurn1MoveOp`, used by the real move AND
  the debug Simulate, so they're byte-identical).
  Consequence: a modified client could send fake burns (e.g. 0) and move for
  free, or send a disconnected route. Fine for friends, not cheat-hardened.
  **TODO (route verification, later): make movement fully
  server-authoritative.** Port `planner-nav.js` + `planner-dijkstra.js` into a
  shared module both import, have the engine independently recompute the route
  `from -> dest` with the SAME Hohmann/pivot/per-turn semantics as the client,
  and reject any MOVE whose route/burns don't match. It MUST reuse the client
  planner model (not a second server-only one) - that drift is exactly what we
  just removed. Until then, the server trusts the client's route + burns and
  validates only the fuel. (User: server validates burns not routes, 2026-06-04.)
- Prospect: roll Nd6 (N = site class size); thresholds defined per
  site type. Success = place prospect marker; site becomes claimable
  by the prospector for industrialization.
  - **Prospect economy (engine rule, do NOT revert to one-op-per-scan).**
    The FIRST prospect of the turn (any kind) spends the turn's single
    operation to BEGIN prospecting. Once begun, a raygun's line-of-sight
    scan is FREE and UNLIMITED: a player keeps scanning in-sight sites at
    no extra operation. Missile / buggy still spend the operation (they
    ARE the operation) and can't fire a free extra scan. Movement is the
    normal one-move-per-turn resource and prospecting does NOT forfeit it:
    if you have NOT moved yet you may still take your one move AFTER a
    raygun scan; if you HAD already moved, that move is spent
    (`no_moves_left`) so there is no further move, and it can no longer be
    undone once the prospect rolls (the roll barrier in `applyUndo`, NOT a
    move-after-prospect gate - that gate was removed). "Has begun" reads
    off this turn's undo stack (a PROSPECT entry, reset each turn). The
    PROSPECT op carries `turn` + `round`; a same-site, same-turn re-submit
    is idempotent (no second roll), a stale turn is rejected. (User
    decisions 2026-06-05: raygun is 1 op to activate then unlimited free
    scans; movement is blocked only when already moved this turn, otherwise
    still allowed after a scan.)
    Canonical move/prospect cases the engine is verified against (one move
    per turn; a raygun scan never blocks a move you have not yet taken):
    - Raygun scan first, NOT yet moved: the one move is still allowed
      after the scan.
    - Moved, THEN raygun scan: no further move (`no_moves_left`), and that
      move can no longer be undone once the prospect rolled.
    - No prospect, not yet moved: the move runs normally.
    - Moved, no prospect: no further move (`no_moves_left`) - one move per
      turn holds with or without a scan.
- **Boost economy (engine rule, do NOT revert to one-op-per-boost).**
  Boost mirrors the raygun: the FIRST boost of the turn spends the turn's
  single operation; every later boost THIS SAME turn rides up FREE (no
  operation), so a player can keep boosting once begun. "Has begun" reads off
  this turn's undo stack (`hasBoostedThisTurn`, a BOOST entry, reset each
  turn), exactly like `hasProspectedThisTurn`. Aqua (= total mass) is charged
  on every boost, free or not. Client (`browse.js#commitBoost`) labels the
  confirm + the BOOST button accordingly online; the solo sandbox still treats
  every boost as the operation (the free-after-first rule is server-backed).
  (User decision 2026-06-09.)
- **Undo doctrine.** Functional ops ride a per-turn `turnActions` stack and the
  `UNDO` op rebuilds the turn from `turnBaseState` minus the last action
  (`applyUndo` + `rebuildFromBase`). So BOOST / INDUSTRIALIZE (factory) /
  ET_PRODUCE / MOVE undo, but a dice roll is a hard barrier (`last.rolled` ->
  `roll_blocks_undo`): PROSPECT and a hazardous MOVE can't be taken back.
  Auctions never sit on the stack and advance `committed_seq`, so they can't be
  undone either (user: auctions involve multiple people). `rebuildFromBase`
  re-records each replayed action onto `turnActions` AS it replays, so the
  free-after-first economy (BOOST + raygun PROSPECT) re-accounts correctly on
  undo instead of demanding an already-spent operation. The client exposes undo
  online via the toolbar `#turn-tag-undo` tag + the mission-log undo button
  (`describeTurnAction` names what will be taken back); the solo move tag keeps
  its own move-only rewind. (User decision 2026-06-09: boost/factory/ET-produce
  undo, prospect/auction do not.)
- Industrialize: deliver a robonaut or crew + reactor to the site;
  flip prospect to factory (1 VP).
- **NO passive income ANYWHERE (removed 2026-06-10, do NOT reintroduce).**
  Two invented passive-income mechanics were removed: (1) `advanceClock` paid
  every hydrated factory's hydration in water straight into the owner's tank
  each lap (server engine), and (2) `solo.js#endRound` added each claimed site's
  hydration as "water from refineries" each round (CEO Solitaire). Neither has
  any basis in the HF4 rules and the factory one was a free-water-then-cash
  money fountain (the "ghost water" players reported). The base game has NO
  passive income: a factory's water is harvested by PARKING there and spending
  the Site Refuel / Factory Refuel OPERATION (costs an op), and aqua comes only
  from the active Income / Free Market operations. Solo runs on a FIXED water
  budget. Do not hand out water or aqua at a round / lap boundary.
- Bernal station: 5 factories on the same body collapse into a
  Bernal (5 VP + colonist promotion).
- VPs at game end: factories + refineries + Bernals + glory cards.

Random-numbered seeds are stored per game so replays are deterministic.

### Mission log captures every server mutation

The mission log is the player-visible record of WHAT HAPPENED, and it is
load-bearing: every operation that changes game state on the server MUST
produce a log line that lands in it. This is not console logging - a
`console.log` is invisible to players and does not count. The rule:

- **Every functional/meta/auction/crew op handler returns a non-empty
  `log` string.** The server persists it to `game_operations.log` on
  every accepted op (`POST /games/:id/ops`), and the client mission log
  hydrates from that op log via `GET /games/:id/ops` (online) or the
  local `logAction` history (solo). If you add an op, it MUST return a
  gameplay-accurate `log` (talk about the game, not the code, per Style)
  or it silently vanishes from the record. Income, Site Refuel,
  Industrialize, and ET Produce each return a log for exactly this
  reason.
- **The ONLY intentional exception is the two route ops** (`SET_ROUTE` /
  `CLEAR_ROUTE`), which return `log: ''` because a planned route is
  secret between players (the gameView redacts opponents' routes). Do
  not add other silent ops; if a mutation must stay private, document why
  here. These two are also the ONLY ops a player may submit OFF their turn:
  a planned route is private + inert (only the owner's own MOVE executes it),
  so `applyOperation` runs them against the CALLER (not the active player) and
  skips the turn guard + per-turn undo stack when it isn't the caller's turn
  (on their own turn they ride the functional/undo path as before). The active
  player's undo/redo (`carryOffTurnRoutes`) carries every OTHER player's current
  route across the rebuild so an in-turn undo never wipes a waiting player's
  plan. Client syncs them via `submitGameOp` (not the turn-gated
  `submitOnlineOp`), so the off-turn sync is allowed. (User decision 2026-06-10.)
- **A third silent op: `SET_CARD_GROUPS`** (`log: ''`). It persists a player's
  purely COSMETIC rocket-stack organizer (`player.rocket.groups`: ordered
  `{ id, name, cardIds:[] }` labels the player made to sort their stack view).
  It changes NO rule (card order, wiring, activation, fuel are all untouched),
  so it would be noise in the mission log on every drag. Like a route it can be
  submitted OFF turn: `applyOperation` early-dispatches it against the CALLER
  regardless of whose turn it is, and it never rides the undo stack;
  `carryOffTurnRoutes` carries EVERY player's groups (including the active one's)
  across an undo so a rebuild never wipes a relabel. Client syncs via
  `submitGameOp`; the groups ride the normal (un-redacted) snapshot, hydrate in
  `net-bridge.js`, and the store lives in `rocket.js`
  (`getCardGroups`/`setCardGroups`, localStorage solo). The rocket-stack modal
  (`browse.js`) renders collapsible label sections with drag-and-drop + a
  per-card "Group" menu. (User decision 2026-07-07: visual-only, server-synced,
  custom labels.)
- **Every op kind has an entry in `MP_LOG_ICONS`** (js/game/browse.js).
  A missing icon falls back to a bare `·`, which reads as "something
  unlabeled happened" - give each new op a glyph in the published-card
  language so the log is scannable.
- **Routing an op online MUST NOT drop it from the log.** When a client
  handler routes through `submitOnlineOp` and returns early (skipping its
  solo `logAction`), the op still appears because the server logs it and
  the online mission log reads the server op log. Never assume "the
  snapshot will show it" - the snapshot carries state, the op log carries
  the narrative; both must update.

## Style

- **Game text describes GAMEPLAY, never implementation.** Player-
  facing copy (modal body text, tooltips / `data-tip`, status
  toasts, button labels, info blurbs) must talk about the game -
  what a card does, what an action costs, whose turn it is, what
  a glyph means. It must NOT narrate the architecture: don't say
  "the server" does X, don't mention snapshots, WebSockets,
  decks-as-data-structures, op logs, validation, or any
  client/server split. A returning tabletop player reads these
  strings; "the server puts the top of the deck up for auction"
  is wrong - "the top of the deck goes up for auction" is right.
  Tooltips in particular MUST be gameplay hints, not notes about
  what the code is doing. (Legitimate exceptions: genuine
  connection / account / service messages like "Server is
  unreachable" or "name taken on this server" - those are about
  the live service the player is interacting with, not gameplay
  mechanics narrated as implementation.)
- **No em dashes (`-`).** Anywhere. Source code, comments,
  commit messages, UI strings, docs. Use a period, a hyphen
  with spaces (` - `), a colon, or parentheses depending on
  what the sentence wants. Em dashes are a tic that betrays
  AI-generated prose and the project explicitly disowns them.
  When you find existing ones, replace them.
- **No unicode arrow characters either.** The same "no funny
  characters" directive covers arrow glyphs in NEW prose:
  commit messages, PR titles/bodies, release notes, docs, chat
  summaries, Discord posts. Write "to", "then", or the ASCII
  "->" (the established comment idiom) instead. Emojis are
  fine. Pre-existing arrows in old comments / UI labels are not
  worth a rewrite sweep; just do not add new ones. (User
  directive 2026-07-01.)
- **Navigate-to is always the LAST button in a site popup.** It's
  a pure inspection affordance (no game state changes), so any
  real game actions (Plan rocket route, Prospect, Refuel, etc.)
  must precede it. New site-popup buttons land before
  Navigate-to, never after.
- **A faction's colour IS its ideology (colour = ideology theme).**
  Each of the six factions carries one of six seat-band colours, and that
  colour maps 1:1 to an Assembly ideology. The two palettes pair by HUE even
  though the hex values differ between them (crew `#b40054` / ideology
  `#c01f6e` = Freedom; gold = Unity; mauve = Authority; mint = Equality; grey
  = Individuality; cream/silver = Honor). The canonical map lives in
  `data/assembly.js` (`IDEOLOGY_BY_FACTION_COLOR` / `ideologyForFactionColor`).
  Used to seat every player's starting delegate in the ideology matching their
  seat/faction colour, so the cube's colour lines up with the zone it sits in -
  in BOTH solo AND multiplayer (the old "multiplayer seats randomly by seat
  order" behaviour was the cube-colour-mismatch bug and is gone; seat order is
  only a fallback when a colour has no mapping). The single seating helper is
  `data/assembly.js#seatStartingDelegate`, called by `createInitialState`
  (server/game/state.js) at setup and by `PICK_CREW` (server/game/engine.js) on
  (re)pick. This colour=ideology pairing recurs in later modules - reuse the
  same map, don't re-derive it.
- **The Sirens' colour is a TWO-VALUE cyan, by background.** Anything that
  reads as Sirenian - a V9 rule modifier on a card, a heroism chit, a
  Siren-only badge, a map marker, a panel accent - is coloured from this
  pair, so every Sirenian affordance reads as one family:
  - **On DARK surfaces (the map): `#5eead4`**, the aqua the Uranus
    home-Bernal anchor spots already use (`data/site-tags.js`'s
    `home-bernal` entry). The Sirens live in the Uranian system, so their
    colour is the colour of the places they anchor.
  - **On LIGHT surfaces (a card's cream face, a light panel): `#0e7490`.**
    The aqua washes out on light backgrounds; this is a darker, bluer
    cousin in the same cyan family, so it still reads as the same colour
    without losing contrast. (User directive 2026-07-28: "darken that
    color a bit, its hard to read" / "make it more blue".)
  Do NOT reach for the hazard red for a Siren rule just because the rule is
  bad for the player - red is the map's "this will hurt you" language and
  borrowing it makes a species read as a warning. Rad-hard 0 under
  "Diamonds Aren't Forever" is a SIREN trait, so it is cyan.
- **Player names track the player's seat colour.** Every render
  of `@<name>` in the multiplayer UI tints the text in that
  player's server-assigned seat colour (the same six crew-card
  colours, see PLAYER_COLORS). Use the shared `.player-name`
  CSS class and set `--player-color` on the element from
  `player.color`. Falls back to currentColor when the seat
  colour isn't known. Touches every surface: turn banner, mp
  roster, mp chat, mission log who-name, auction overlay
  (auctioneer / high bidder), crew-draft roster. Add the class
  + the var on any new "@name" render so the convention holds.
- **Sidebar panes stay where the user put them.** Sidepanel
  navigation is user-driven: bootstrap can open the MP pane
  once, but no automatic path (snapshot apply, market-mode
  flip, op response, WS event) is allowed to switch panes out
  from under the player. If you need to draw attention to a
  pane, use the existing tab-strip badge / pulse affordances,
  never showPane(...).

## Don'ts

- **Don't use the `send_later` tool (claude-code-remote) to schedule
  self check-ins.** No recurring "re-check the PR in an hour" wake-ups.
  When watching a PR, react to webhook events as they arrive and stop;
  do not arm a timer to poll. (User directive 2026-06-30.)
- **NEVER rebuild a feature that already exists. Improve / extend the
  existing code instead.** Before adding a new mode, flow, planner, panel,
  or UI affordance, FIND the current implementation and parameterize it.
  If the rocket already has a route planner, the freighter rides the SAME
  one with different inputs; you do not author a second planner. Adding a
  parallel implementation of something we already have is the single most
  wasteful mistake here. Search first, extend second, rebuild never.
  (User directive 2026-06-24.)
- **Don't build a separate multiplayer UI.** Multiplayer reuses the
  sandbox front-end (classic map + all panels + card rendering); only
  the data source (server snapshot) and action sink (`submitGameOp`)
  change. See "The multiplayer UI IS the sandbox UI" above. The
  competitive auction is the sole bespoke-MP exception.
- Don't break local dev's build-free flow. The SOURCE stays plain ES
  modules + CSS + HTML: `index.html` references the raw `./js/main.js`, so
  `python3 -m http.server` runs the app with no build. The esbuild build
  (`scripts/build.mjs`) is PRODUCTION-only and reads the same source. Don't
  introduce framework/JSX/TS syntax that only works after a build, or import
  CSS/assets into JS - keep the source runnable raw. See "Build +
  cache-busting".
- Don't recompute the app base or asset paths inline. Import `appBase()` /
  `assetUrl()` from `js/base.js`. It is the ONLY `import.meta.url`-relative
  path computation in the app (besides version-check.js's sibling
  `version.json`); inline `new URL('../', import.meta.url)` breaks under
  bundling because the bundle collapses every module to one depth.
- Don't trust client moves. Every game mutation goes through
  `server/game/engine.js#applyOperation`, validated against the
  current `state`. WS clients send operation intents; the server
  validates, persists, then broadcasts the resulting state diff.
- Don't store raw tokens. Always `sha256(token)`.
- Don't horizontally scale the API process - single-writer sqlite.
- **UI scale coordinate contract (js/ui-scale.js).** The app zooms the
  document root on very wide viewports (4K at 100% OS scaling) so the UI
  keeps 1080p proportions. Under that zoom, getBoundingClientRect() and
  clientX/Y are VISUAL (zoomed) pixels while CSS px values you WRITE paint
  scale-times bigger. Two rules for new code: (1) any style.left/top/width
  computed from gBCR or clientX must pass through `toLayoutPx()` from
  js/ui-scale.js; (2) never write raw `vh`/`dvh`/`vw` in CSS - viewport
  units are NOT compensated by zoom, so use the swept pattern
  `calc(var(--vhpx, 1vh) * N)` (same for --dvhpx / --vwpx) that the
  stylesheets already follow.
- Don't break the murdoku-style "every branch deploys" promise.
- **Hexagons are independent entities.** When the user says "hex"
  or "hexagon" they mean the gameplay-token marker drawn for each
  site. Its size lives at `TYPE_VIS[type].r` (or the shared
  `HEX_R` constant in `js/game/render.js`) and is independent of
  everything else - body sphere size (`haloR`), halo glow,
  asteroid silhouette, ring radius, edge width, label font size.
  Tuning the hex must never resize the bodies behind them, and
  vice versa. Same goes when the user mentions "halos" / "bodies"
  / "rings" - those are their own knobs.
- **Every hexagon is the same size.** All `TYPE_VIS` entries with
  `kind: 'hex'` use the shared `HEX_R` constant for their `r`
  field - planets, moons, dwarfs, asteroids, sites, surface sites,
  everything. Body class differentiation lives in `haloR` and the
  palette; the hex marker itself is uniform. Don't ship per-type
  hex sizes again.
  The point is that any commit pushed to any branch is live at the
  GH Pages URL within ~1 minute.

## File layout

```
/                       static frontend (deployed to GH Pages)
  index.html            shell: menu, lobby, game, chat panels
  css/style.css         dark space theme
  js/
    main.js             bootstrap
    api.js              REST wrapper
    ws.js               WebSocket client + reconnect
    storage.js          localStorage helpers
    auth.js             profile create / claim / device codes
    lobby.js            lobby UI, game list, create-game flow
    chat.js             chat panel
    invites.js          invite-by-name + invite-link UI
    game/
      render.js         canvas map renderer (1500 nodes as SVG was too many DOM nodes)
      controls.js       op buttons + side panels
      state.js          client mirror of server state
  data/
    sites.js            solar system sites (server reads via import)
    patents.js          patent deck
    glory.js            glory cards
/server/                Fly.io node app
  package.json
  Dockerfile
  fly.toml
  index.js              Express + WS routes
  db.js                 SQLite schema + migrations
  game/
    engine.js           authoritative rules engine
    state.js            empty-state + helpers
    rng.js              seeded RNG
/.github/workflows/
  deploy.yml            Pages + Fly, every branch
```

The `data/` directory is imported by both the frontend (ES modules) and
the server (Node ESM). Keep it pure data - no DOM, no `node:` imports.

## Local dev

```
# Frontend (any static server works)
python3 -m http.server 8000

# Backend (writes to ./server/hf-dev.db locally)
cd server
npm install
DATABASE_PATH=./hf-dev.db npm run dev
```

Frontend points at the API via `<meta name="hf-api-base">` in
`index.html`. Empty value = local-only mode (no lobby, no multiplayer).
The offline hot-seat path (`js/game/solo.js`) is FROZEN LEGACY and has NO
menu entry point anymore (removed - see "CEO Solitaire" under "Variants we
target"): do not maintain, update, or re-add a way to start one.
