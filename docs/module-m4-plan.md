# Module 4 (Exodus) - implementation plan

Handoff for the next session: `docs/m4-handoff.md` (state, next work, open
questions, how to test locally).

Status: **admin-only preview** (user 2026-11-15). Everything M4 gates on
`state.m4`, which only an admin can turn on at room creation. M4 requires M0
(4A1a), so turning M4 on forces M0 on, the same way M2 forces M0.

Rules sources, in order of trust:

1. `reference/HF4-branching-manuals-v0.3.zip` (`HF4 - M0+M4.pdf`,
   `HF4 - QS+M0+M1+M2+M4.pdf`): the full contract FLOW (auction, timepiece,
   late fees, fulfillment, default). `reference/manuals/branch-module-4.md` is
   an auto-extract of the same and is patchy.
2. The published Module 4 rulebook for the component sections the branching
   manuals leave out (4A2 components, 4A3 card anatomy, 4B1 decks / sides,
   4B2a-e, 4B7, 4B8). A paraphrase is on rulespal.com; the card text itself
   comes from the user's card data (below).

## Stages

| Stage | Scope |
|---|---|
| **1 Contracts** | decks, timepiece, contract auction, boost, fulfillment, late fees, default chit, endgame scoring, contract abilities |
| 2 | augmentations, enterprises / partner enterprises (4B8), the portfolio, augmentation requirements for M2 promotion |
| 3 | isotope monetization, the isobank + isobanker, gold-side upheaval (4B1b), Exodus (starship) contracts, the final starship launch |

Stage 1 lands in slices, each exercised and shippable on its own:

- **1a Gate.** `lobbies.m4` column, admin-only on create (server forces it off
  for anyone else), M4 forces M0, `state.m4`, the snapshot / lobby / admin
  chips, the create-form and solo-wizard checkboxes shown to admins only. No
  rule yet: an M4 game plays exactly like M0 until 1b.
- **1b Data.** A `Contracts` tab in `reference/HF4-card-data.xlsx`, imported by
  `scripts/extract-card-data.py` like every other deck (no hand-authored card
  stats). `createInitialState` builds the three ideology-pair decks when m4.
  Card rendering (blue / gold face) in `js/game/card-ui.js`.
- **1c Timepiece + contract auction.** At the end of a FUNDRAISE (4B3): if your
  timepiece is free, pick a deck that shares an ideology with an Active Law,
  optionally discard its top card, then start the auction or walk away.
  Descending bids in YEARS from 10 down to 0; the lowest bid wins; the
  initiator wins ties they are in, else picks; Marketeer always wins ties.
  Winner puts the timepiece that many years ahead on the Sunspot Cycle, takes
  the cash advance from the pool (minus the 1 Aqua finder's fee if the
  initiator lost), and takes the contract into hand, outside the academia hand
  limit. No contract auctions during War / Anarchy; no manned-contract bids
  while holding the default chit. This EXTENDS the existing research auction
  (`state.auction` with a contract kind and a years bid), it is not a second
  auction system.
- **1d Boost + fulfillment.** A contract boosts (paying its mass) on the side it
  was auctioned on, to LEO / your Bank. Each destination step is a free action
  when the Stack carrying it is there (or ENTERED it this turn, for "enter"
  steps); "return" needs it back at LEO / your Bank. A step is a Glitch
  trigger. Fulfilled: it moves to your fulfilled area, the timepiece comes
  home, its fulfilled abilities switch on.
- **1e Late + default.** The clock passing your timepiece flips it to deadbeat;
  each turn pay the late fee or default (Mishap Insurance pays the first one).
  Late fulfillment, debt repayment (advance, or twice it if never boosted),
  the single default chit (blue / gold side), manned-contract decommission =
  default, contracts immune to pad explosion and budget cuts.
- **1f Scoring + abilities.** Fulfilled VP, -3 / -6 for the default chit, -1 per
  unpaid Aqua on an unfulfilled contract. Then the contract abilities named in
  the rules: tophat (one free hazard per turn), Hazard / Aerobrake Ignore,
  Shielded (-2 belt and CME), Insight, Secured, Bailout, Connections, the
  cargo-transfer ability. Each gets a check in `scripts/check-engine.mjs`.

Years: the engine already advances the Sunspot Cube one slot per turn
(`advanceClock`), so a timepiece is stored as an absolute clock position
(`round * 12 + turn`) and "late" is the clock passing it.

## Stage 1 status (2026-11-15)

LANDED, gated on `state.m4`, checked in `scripts/check-engine.mjs` and played
end to end in a local two-seat game (recordings: auction, boost + fly + fulfill,
late fee + default):

- Data: `data/contracts.js` from the sheet; the `Destination Steps` column makes
  52 of the 84 faces engine-checkable (`at:` / `site` filters / `enter:` /
  `flybys:` / `liftoff` / `return`). The rest are `manual:` and refused with
  `destination_not_yet_supported` until their module lands (Bernals, Colonies,
  Freighters, the isobank, a few map-geometry steps).
- 4B3 auction (`AUCTION_CONTRACT_START / BID / PASS / CLOSE`, in `state.auction`
  as kind `contract`), 4B4 boost + `FULFILL_CONTRACT` (a Glitch Trigger),
  4B5 `PAY_LATE_FEE` + deadbeat flip in `advanceClock` + default at END_TURN +
  debt repayment, 4B6 default chit + decommission (4B6a), pad-explosion and
  budget-cut immunity, Inspiration cycles the contract decks (K2a), 4E2 scoring.
- Client: contract cards render in stacks (`js/game/contract-card.js`), the
  Contracts panel + contract auction overlay (`js/game/contracts-ui.js`).
- A won contract is a Hand Card (4B3h): it draws in the Hand strip on its side
  and boost-marks like any card (user 2026-11-16). It stays OUT of
  `getHandSlots()` (hand limit, Free Market, ET Produce) and reads through
  `hand.js#getContractHandSlots()`, since it ignores the academia hand limit,
  pad explosions and budget cuts (4B2a,c). A default contract lies sideways in
  the hand (4B4d) and can't be boost-marked. The Contracts panel no longer
  lists in-hand contracts; their actions (boost, pay, abandon) sit on the card
  in the Hand area.
- 4B6a everywhere a contract leaves a stack involuntarily or by Decommission:
  the DECOMMISSION op, a destroyed rocket (hazard, parked aerobrake), a lost
  Freighter all route through `decommissionSlotTo`, so the contract returns to
  the contract hand (unmanned: upright, boostable again; manned: default).
- Discarding (user ruling 2026-11-16: "contract cannot be discarded unless in
  anarchy"): the only discard is 4B7d Abandonment, `ABANDON_CONTRACT`, legal
  only during Anarchy / War and never for a military contract. It works on a
  contract in hand, at LEO, or at any player's anchored Bernal: Discard to the
  deck bottom, timepiece home, no late fee or repayment, claim the default
  chit. (Reading: the hand counts as "at LEO" since your Bank is in LEO, 4A7a.)
- The ten destinations verified on the destinations page (owner approved all,
  2026-11-17) are written in the sheet's Destination Steps and checked by the
  engine: `site adjacent=hazard`, `space aero beyond=<zone>`, `at:<space>` for a
  hazard / Lagrange space, `sameturn` (the step before must hold this turn too),
  `site signposted unexplored orany`, `farthestglory`, `either=a,b`, and stack
  conditions `human`, `rolled` (a hazard roll by this rocket this turn),
  `ownfactory`, `busted`, `size=n`, `robonaut` / `refinery` (in an unglitched
  stack). Each has a pass and a refusal in check-engine.
- Gold sides need M1 (and M2); they are out of M0+M4. Isotope Monetization
  (and so the gold-side upheaval) is possible with M4+M1 (user 2026-11-17):
  that is the Stage 3 target.
- Augmentation sides built (no-M2 Colony placement): Splat 1 (Factory also
  C), Splat 2 (+1 hydration), Triangle 2 (+2 aqua on Site Refuel), Heart 2
  (second delegate move in a Fundraise). Open in the tracker: Jar 2 (A1) and
  the Colonist-only sides without M2 (A2). Heart 1 (Parenthood) is M2 only;
  Triangle 1 (+1 Isotope) waits for Stage 3.
- Augmentations without M2 (user ruling 2026-11-17: "augmentations without
  m2 use regular colonies instead of bernal"): IMPLANT takes `colony: <site>`
  and puts the chits on that Colony of yours (`augments[shape] = { colonySite,
  side }`); owning the Colony is the BEO Colony; juggling only off the same
  Colony. The 4C3 side abilities are still not wired either way.
- Unexplored Signposted Site (Planetary Protection, user ruling 2026-11-17):
  once every signposted site has been explored, any site will do. The open
  destinations are being verified on the destinations page
  (`docs/design/m4-destinations.html`, link in `docs/design/README.md`).

Contract ABILITIES (4B2e/f, landed 2026-11-16). Read off the printed text by
`data/contracts.js#parseFulfilledAbility` / `parseWhenFulfilling` (no card is
special-cased), counted from FULFILLED contracts by the engine's
`contractAbilityCount` (0 outside M4), each with a check in check-engine:
- **Shielded** (8 faces): -2 per copy on every Belt Roll (rocket, Freighter,
  Bernal) and on the Solar Flare (CME) roll.
- **Bailout** (6): immune to Budget Cuts.
- **Secured** (8): keeps the faction privilege in Anarchy, and a Claim Jump
  against the holder during Anarchy is refused (`target_secured`).
- **Connections** (7): a contract deck also opens when you hold a delegate in
  either of its ideologies (engine `contractPairsOpenTo` + the Contracts panel).
- **Insight** (6): the `INSIGHT` op announces the research auction and sends one
  patent deck's top card to the bottom; the turn cannot end until AUCTION_START
  runs (`insight_auction_due`), it is once per turn, cannot be undone, and is
  refused with Research Grants. Client: a button in the auction confirm modal.
- **Hazard Ignore** (4 faces, quoted words such as "ring", "spin", "outburst",
  "ice"): a Crash Hazard whose board caption (data/map-labels.js NODE_LABELS)
  mentions the word needs no roll or FINAO (rocket and Freighter moves; the
  client checklist mirrors it). Aerobrake Ignore with quoted words uses the same
  path; no printed face has one yet.
- **Tophat** (10 faces): a stack carrying a tophat contract that is not in
  default enters its first remaining hazard each turn safely and free (rocket;
  `player.tophatUsed.rocket`, cleared at turn start). The client checklist
  mirrors it.
- **Gain N Aquas** When Fulfilling (3 faces) pays on fulfilment; "Gain N
  additional Aqua when fundraising" (Rivalry) adds to the Fundraise.
- A contract in default has its abilities off (4B6b): the tophat check reads
  the contract's `default` flag; fulfilled contracts are never in default.

STILL TO DO in Stage 1: the conditional ignore abilities written as prose rather
than quoted words (New Horizons "Adjacent to industrialized Sites", HAVOC "Venus
zone", Inner Tour "Aerobrake Hazards leading to LEO", Ring Industrialization's
Mobile Factory clause), Transport (8 faces, rule text not found in the M4
manual excerpt), the other one-off fulfilled abilities (Luna permission, -1 ISRU
at Mercury, +1 VP per glory chit, flyby bonuses, Acetylene from Factories,
Murder/Suicide, the elevator lander-burn rule, implants at Colonies, the
air-eater), the non-aqua When Fulfilling effects (they are named in the log as
"not yet automated"), the tophat on Freighter / Bernal stacks, negotiation of
contracts (4B2g), a tie-winner picker in the auction overlay, and Freighter /
Bernal stacks carrying a contract.

## Stage 2 status (2026-11-15)

STARTED, gated on `state.m4 && state.m2`: the IMPLANT operation (4C4). Your
portfolio is the cybernetics icons on your fulfilled contracts; at your anchored
Bernal, with a BEO Colony (4C2a: with Module 2, a Bernal anchored Dirtside,
i.e. an anchored Bernal that is not your Home Bernal; user 2026-11-15), place one chit of each shape on Colonists
aboard, juggling chits between Colonists aboard first. An Industrialist Colonist
aboard makes it a free action once a turn. A Colonist needs one augmentation to
Promote (4C7e). Decommissioning a Colonist returns its chits. Recorded as
`player.augments[shape] = { colonistId, side }`.

STILL TO DO in Stage 2: the twelve augmentation ABILITIES (4C3, the two sides of
each chit), the heart's Parenthood side (4C5, child chit), enterprises and
partner enterprises (4B8), the Freighter / Bernal / GW promotion counts (4C7e),
and drawing the chits on the colonist card itself (a new glyph on the game's
card, so it waits for sign-off).

## Card data wanted (the `Contracts` tab)

Same layout as the other tabs: a banner row, a header row, then TWO rows per
card, the **blue** side first and the **gold** side second (the importer
already pairs rows this way). 36 cards, 12 per ideology pair. Columns:

| Column | Example / notes |
|---|---|
| Name | per side, as printed |
| Ideology Pair | the two ideologies the card's deck belongs to (4A3g); blue row only |
| Type | manned / unmanned / military (and anything else printed) |
| Mass | |
| Rad-Hard | |
| Cash Advance | Aqua |
| Late Fee | Aqua per turn |
| VP | as printed |
| Cybernetics | the augmentation icons (Stage 2 reads them, record them now) |
| Tophat | yes / blank |
| Felony | yes / blank |
| Destination | the printed text, verbatim |
| Destination Steps | the same route as map site names in order, one per step, separated by `;`; prefix `enter:` for an "enter" step; a final `return` for "return" (lets the engine check it without guessing from prose) |
| When Fulfilling | ability text, verbatim |
| Fulfilled Ability | ability text, verbatim |

Also useful: a card image link per side (hf4map has the Contracts deck) so the
art and layout can be matched.

## Stage 3 status (2026-11-18)

STARTED on `claude/nodeploy-m4-m2-isotopes` (owner 2026-11-18: "start building
m4 + m2 and iso monetization"):
- **M4 + M2 in one room.** The `m4_no_m2` refusal is gone from the create and
  settings routes. With M2 an augmentation chit rides a Colonist (4C4):
  `augmentSideAt` reads `colonistId`, and the Jar 1 / Hexagon / Battery marks
  go on the Colonist's slot (server `syncCrewAugmentMarks`, client
  `rocket.js#installedFace`).
- **Isotope monetization (3B5, 4D1).** `monetizeIsotope` runs on the first
  isotope refuel (both paths). In M4: FINAO doubles (`finaoPerFor`, client
  `finaoPer`; M1-only games are left alone so a game in flight does not
  double), and the free action `ISOTOPE_EXCHANGE` moves gold beads:
  `deposit` (an isotope can or the rocket's isotope tank, whole units, at your
  Bank) into `player.isotopes`; `sell` to `state.earthMarket` for 10 aqua;
  `buy` back for 10 aqua. Client: the Isotopes block on the Contracts panel,
  "To the Bank" on isotope cans.
- **Isobank Contract Upheaval (4B1b).** The same first gold bead flips the
  three non-Exodus decks (bottom on top) and sets `state.contractSide = 'gold'`;
  auctions deal that side. Gold faces the engine cannot check are dealt out.

BUILT 2026-11-22 (Stage 3, isotope monetization + the isobank):
- **Beads pay like aqua (4D1b).** Once monetized (M4), a payment the aqua cannot
  cover exchanges just enough Bank beads at 10 aqua each (to the Earth market):
  FINAO (`finaoFunds` / `chargeFinao`) and research auction bids and payment
  (`bankFunds` / `coverFromBeads`).
- **Isostandard (1Cb).** An isotope refuel for your GW/TW thruster adds its
  spectral (as does ET-producing one). **Debasement (4D1d):** without one, beads
  reaching your Bank turn into aqua and you cannot buy beads. **Withdraw
  (4D1e):** `ISOTOPE_EXCHANGE withdraw` takes beads out of the Bank as isotope
  fuel of your isostandard in the Bank's stack.
- **4D1a triggers:** anchoring the Lofstrom Loop, or the GEO Elevator at GEO, as a
  Home Bernal monetizes isotope. (The ET Home Bernal trigger is Module 3.)
- **The isobank (4D2), M4 + M2:** founded automatically on your turn (refuel,
  anchor, End turn) with an isostandard and an anchored BEO Bernal with a
  matching Dirtside. It opens the Exodus contract deck (`contractDecks.EX`, any
  law), never unanchors, gives the isobanker +1 isotope on refuels there or at
  its Dirtsides, and holds every player's isovault (`ISOTOPE_EXCHANGE vault`,
  carried there, never withdrawn).
- **Endgame (4E2e/f, 4E3, 4E4):** isobanker medal 4 VP; with a Reckless+ isototal
  and a TW thruster at the isobank, the starshot scores rank VP by isovault, the
  command and propulsion medals, and 1 VP per augmentation on each player's most
  augmented Colonist. Tables in `data/exodus.js`.
- **UI:** a Bank tab in the Contracts panel (Bank, beads, isostandard, Earth
  market, FINAO, exchange buttons, the isobank, every isovault and the isototal
  band). The Exodus deck shows in the market once open.

- **The six Exodus contracts (front faces), 2026-11-22.** Every destination is
  engine-checked (sheet `Destination Steps`; new `belt` verb and `space beo`
  filter), every When Fulfilling runs (`isoBank` / `isoSite` isotopes, debased
  without an isostandard; Life Support's optional Bernal card swap,
  `swapBernals`), and every Fulfilled Ability works: Atmospheric Iso-Refinery
  (`aeroIsotope`, rocket moves), Iso-Exchange (`isostandardAnyFactory`), TW Stress
  Test (`twBonusPivot`, client planner), Life Support Reconfig Team
  (`bernalLimitUnanchored`), Radiation Shield Prototype (`beltCmeImmune`, every
  belt roll path and the solar flare), Deep Freeze (`exomigrateDiscard`, a
  checkbox in the exomigrate dialog). Checks: "Exodus:" in check-engine.
  The Exodus deck plays the FRONT face; the backs (Isotope Fueling Station,
  Rival Isobank, TW Evaluation Committee, Life Support Test Protocol, Warden
  Proving Ground, Decanting Network) are not reachable yet.
- **Map:** the isobank draws over its space as a site-size hexagon (the starship
  behind the isovault cells, rim in the isobanker's colour), under the pieces;
  hovering fades the pieces, a small hex beside it peeks at the site, a tap opens
  the Bank tab.

- **Desperation starshot (4D3), 2026-11-23.** `state.starship`. STARSHIP_LAUNCH
  (free action, the commander: the most isofuel among Exodus contract holders,
  isobanker breaks ties): needs a Reckless+ isototal, the highest-thrust TW
  thruster at the isobank operational without afterburn (it and its support
  chain move aboard), and the commander's augmented Colonist; sets Anarchy until
  exit and ends the game this Solar Cycle (maxRounds = round). STARSHIP_BOARD:
  one augmented Colonist per player, or isotopes into your isovault.
  STARSHIP_MOVE (commander, once a turn): 1 burn, 2 on afterburn (1 isotope off
  the isovault), crash / aerobrake rolls with double FINAO, belts decommission
  cards. An Ad Astra exit freezes it (Jupiter-Sol-Jupiter waits 2 turns at the
  solar oberth). The Exodus deck closes in flight and "isobank" destinations
  read the starship. Scoring (4E4): command medal to the commander, propulsion to
  the TW owner, augmentation VP for passengers only; still in flight at the end
  = mutiny (-3, isobanker medal to the next passenger). UI: Launch / Board / Fly
  in the Bank tab's Starship Stack box; Fly plots with the route planner
  (budget 2, 3 Bonus Pivots); a starship token on the map.
- **Spaceborn colonist Futures (16), 2026-11-23** in `data/future-goals.js`.
- **FINAO doubles on monetization in M4 rooms only** (R8, `finaoDoubled`), and
  the Lofstrom Loop Home anchor rolls the Epic Hazard (4A7j).
- **Colony contracts** play on colony domes without M2, on anchored Bernals with
  M2 (owner 2026-11-23): `colony` / `isobank` step verbs.

STILL TO DO in Stage 3: trading isofuel between isovaults, beads in contract
payments other than FINAO and research auctions, the Exodus back faces, the
Atmospheric Iso-Refinery isotope for Freighter / Bernal GW moves (rocket only
today), the starship's combined-game cargo (Promoted Freighter / Bernal), and
a deck picker for the Interstellar Exploration research grant (it takes the
first deck with cards).