# Module 2 (Colonization + Futures) - implementation notes

What landed on 2026-07-02, what is deferred, and where each piece lives.
Everything below gates on `state.m2` (which forces `state.m0` on; the futures
cards themselves come from the M1 decks, so a full futures game runs M0+M1+M2).
M2 stays ADMIN-ONLY + experimental (see CLAUDE.md "Module gating").

## The colonist loop (rules 2A / 2C)

- **Colonist queue (2C2).** `state.colonistQueue` - a seeded shuffle of the 18
  colonist card ids, dealt at game start (after the decks, so a non-M2 deal is
  byte-identical). Face-down: the game view redacts the order and exposes only
  `colonistQueueCount`. Colonists enter play ONLY by exomigration; a retired
  HUMAN goes to the BOTTOM of the queue, a retired ROBOT returns to its
  owner's hand (2C2, see "Human vs Robot" below). The single retire funnel is
  `retireColonistId` (engine.js) - discharge, Build Colony, Homestead, the
  epic-hazard human loss, and the Ad Astra export all route through it.
- **Exomigration (2A6, reworked per user decision 2026-07-02).** `EXOMIGRATE`
  free action + the shared `exomigrateOne` helper (engine.js). The gain is
  never forced: anchoring a Bernal (2A5f) only OPENS the berth, and the player
  exomigrates when ready. The op carries `to` ('leo' or 'bernal<i>' naming an
  ANCHORED Bernal - the colonist boards the station directly; default Home
  Bernal else LEO) and `placeDelegate` (the M0 delegate is OPTIONAL: when
  true, a delegate of the owner's colour seats in the colonist's printed
  ideology via `IDEOLOGY_BY_COLOR_NAME` and a vote tally runs, auto when the
  winner is unique). The Colonists tab pulses (the shared `has-unread` star)
  while a berth is open on the player's turn; the pane's Exomigrate button
  opens a destination + delegate picker. Homesteading's refill and the
  ad-astra export exomigrations keep the defaults (auto-seat, home/LEO).
  Unanchoring discharges the excess back to the queue (2B6b Homeless).
- **Homesteading (2A4).** `HOMESTEAD` op: return a Black-Side product in LEO
  (or the Home Bernal) to the bottom of its deck, place a dome on one of your
  uncolonized factories (location class from data/site-categories.js), retire
  a colonist to the queue, exomigrate a replacement. The Aerostat / TNO / SETI
  Futures make it a free action.
- **Nanofacture (1A7, M1+M2).** `NANOFACTURE` op: with a promoted Freighter,
  an anchored non-Home Bernal decommissions a robonaut + refinery build set
  from its stack (returned to hand, the Industrialize model) and places a
  Mobile Factory cube at the colony.
- **Anchoring (2A5).** Orbital requirement enforced: a home orbit, or adjacent
  to a factory not already serving another Bernal as a Dirtside; never on a
  site / hazard / lander burn; one Bernal per space; no second home; Luna
  never a Dirtside. Optional supports decommission (`op.decommissionIds`).
  Anchoring is a Glitch Trigger.
- **Promotion (2A3).** `PROMOTE` covers all four unit classes: Freighter, GW
  thruster, Colonist (searched across every stack), and Bernal-to-Lab (2A5e:
  anchored + a dirtside + the promotion colony adjacent; raises the allowance
  to 2). `colonyPromotes` understands all 5 dome-icon classes (spectral /
  Submarine / Astrobiology / Atmospheric / Push), and a promoted anchored
  Bernal is itself a promotion colony for non-Bernal cards (2A5c).
- **Build Colony (G3).** A colonist may be the settler; it retires to the
  queue instead of respawning at LEO.
- **Dirtside cooperation (2A7).** An anchored Bernal cooperates with the
  Factories it is Dirtside to (the shared raygun reach, `bernalDirtsides`):
  - 2A7d dirtside refuel: `SITE_REFUEL` with `op.toBernal` fills the Bernal's
    tank from a Dirtside Factory refuel.
  - 2A7e dirtside production: `ET_PRODUCE` with `op.toBernal` lands the
    Black-Side product in the Bernal stack or an Outpost at the Bernal's Space.
  - 2A7f dirtside cargo ascent: the Bernal and its Dirtsides count as colocated
    for Cargo Transfer, so cards (`TRANSFER`) and water FTs (`TRANSFER_FUEL`)
    ride UP to the Bernal or DOWN to the Dirtside (`bernalDirtsideColocated`,
    both directions). The client offers the Bernal / Dirtside stack as a
    transfer target via the same reach (`dirtsideColoClient`).

## Futures (rules 1D + 1A6)

- **Goal data:** `data/future-goals.js` - the structured layer behind all 32
  printed Future texts (requirement checklists as pure testable items, star
  VP, endgame flags, casus belli, printed costs, standing effect keys,
  dynamic endgame VP). Shared by the engine and the client missions tracker;
  movement-graph reads go through an injected ctx (`neighborsOf` / `zoneOf`).
  Exclusivity keys off the printed NAME (the four Uplift cards race for one
  star). Site ids resolve BOTH forms (sites.js underscore + wire hyphen).
- **Location tags:** synodic sites / comets, centaurs, the Jovian Greek /
  Trojan camps (future-goals.js); astrobiology / submarine / atmospheric /
  space-elevator classes (`data/site-categories.js`, generated by
  `scripts/gen-site-categories.mjs`); Ad Astra exits + sunlenses
  (`data/ad-astra.js`) are modelled as ZONE-EDGE locations until the planner
  data gains real map-edge nodes - swap the zone fields for slugs there when
  they exist.
- **EPIC_HAZARD op (1A6):** promoted card + a colocated Human (a Human
  Colonist future may attempt itself) + the checklist met; roll d6 (a 1 fails
  and the Human is involuntarily decommissioned - crew dies to LEO, colonists
  requeue) or pay FINAO. Success grants the orange star, stamps standing
  effects, settles printed costs (20 aqua for Uplift; the 7+ thruster for New
  Venus / Footfall), and plays out Ad Astra exits (the stack leaves the map,
  colonists requeue + exomigrate replacements, crew restarts at LEO).
- **Scoring:** `futuresVp` joins `scorePlayer`; `computeFinalScores` runs the
  1D2b endgame re-check (endgame-tagged stars whose requirements no longer
  hold are returned) and New Venus / Footfall clear their printed tokens
  before market prices are read. An M2 room with no explicit game length
  defaults to 7 rounds (1D d).
- **UI:** the Colonists sidepanel pane opens with the colony population - a
  badge row (colonists in space vs allowance, highlighted and amber when full;
  robots in hand; queue count) plus a colonist tracker listing every held
  colonist card and where it stands - then the Exomigrate button and the
  colonist deck piles. The missions tracker sits at the BOTTOM of the pane
  and lists ONLY unlocked futures - cards in play on their purple (promoted)
  side; an unpromoted or hand-held card shows no mission (user 2026-07-02).
  Exomigrating pops an arrival summary with every card gained rendered (the
  boarder plus any Handy robots drawn to the hand). The tracker is one box
  per owned future card with the live requirement checklist, printed text,
  location, and the Epic Hazard attempt button (roll / FINAO via the shared
  hazard modal). Homestead lives in the site popup at your uncolonized
  factory; Lab promotion + Nanofacture live in the Bernal unit modal; colonist
  promotion joins the site popup's promote candidates.

## Human vs Robot colonists (2C2)

`colonistKind` ('Human' | 'Robot') on each colonist card drives the split; a
robot's unpromoted side IS its black side (face 'primary' everywhere).

- **Handy (2C2a).** Exomigration skims ROBOTS off the top of the queue into
  the hand and keeps drawing until a Human surfaces - the Human is the one who
  boards the station (log notes the robots drawn). A queue that runs dry of
  Humans flips `state.robotsEmancipated` and the exomigration reports the
  emancipation instead of failing silently.
- **Robot hand cards.** A robot in the HAND does not count toward the
  colonist limit (`countColonists` scans in-play locations only). It can be
  discarded (`DISCARD` sends it to the BOTTOM of the colonist queue, not a
  patent deck), sold, or ET-built.
- **Slave market.** `FREE_MARKET` sells a robot from the hand for 3 aqua, or
  from LEO for its exploitation value like any black-side card. Humans are
  NEVER sellable from anywhere (`humans_not_for_sale`), even if one sneaks
  into the hand.
- **Murder / Suicide.** `DECOMMISSION` on an in-play robot is free and
  returns it to the hand. Decommissioning a HUMAN colonist is a Felony
  (needs Anarchy or the Felonious privilege via `mayCommitFelony`); the
  human goes home white-side to the anchored Home Bernal if there is one,
  else LEO. The log names the felony.
- **ET-building robots (Downsizing).** `ET_PRODUCE` accepts a hand robot at a
  factory matching its spectral type (client: `et-produce.js#blackFaceOf`
  treats colonists as black-face 'primary'; humans are `humans_not_buildable`).
  Building over the colonist limit demands `downsizeColonistId`
  (`colonist_limit_downsize`): the named in-play colonist retires through the
  normal funnel (human to queue, robot to hand) and the robot lands in the
  factory outpost. The client pre-checks the limit and opens a rendered-card
  downsize picker before submitting.

## Colonist powers + specialty operations (2C1 / 2C2)

- **Specialties** (each colonist's printed specialty, both faces):
  - Miner: one EXTRA site refuel per colocated miner (free repeats).
  - Prospector: one free Prospect OR Promotion per turn each.
  - Engineer: one extra ET product per colocated engineer (free repeats).
  - Industrialist: one free Industrialize or Anchoring per turn each.
- **Abilities** (`data/colonist-abilities.js`, keyed by face name): glitch-free
  stacks, Soldier Caste felonies, Eugenic privilege-in-Anarchy, Group Mind
  both crew faces, FINAO halved (Frankenstein / Josephson - `finaoPerFor`),
  Kaluga doubled Free Market, Alchemist doubled isotope refuel, Iceworms free
  Epic Hazard + survives failure, New Attica doubled opponent boosts, and the
  colocated size-roll modifiers folded into the prospect roll.
- Secretary General under M2 pays its +2 aqua on the first Home Bernal
  anchoring instead of at game start (living-rules note in crew.js data).

## Deferred (documented, NOT wired)

- **War of Independence** (casus belli consequences). A completed casus-belli
  Future sets `state.casusBelli` + logs the declaration, but the war rule set
  (no Earth ops, war grants, felonies-for-all, end-of-season peace) is Module
  3 territory and is NOT implemented. Do not half-implement it; design first.
- **Robot Emancipation** edge case: the flag flips if the queue ever runs dry
  (it cannot with 18 colonists and a 2-Bernal cap) or via the Uplift Future;
  the "discard all robot hands + redraw" ceremony is not modelled.
- Colonist powers catalogued but not consumed: Renaissance Man's auction deck
  search (needs its own picker UI), Blue Goo spectral-C production (the engine
  does not gate ET spectral), Martian Assembly as elevator-freighter, the two
  no-aerobrake movement gates, `powersatPlus2`, `freeMarketUnlimited`,
  `freeInspiration`.
- Epic-Hazard anchoring of the Lofstrom / GEO homes (4A7j living rule).
- ET Home Bernals (3F1) and everything else that needs Module 3.
- CEO Solitaire + Futures (see CLAUDE.md: the ceoSolo loop stays no-Futures).
