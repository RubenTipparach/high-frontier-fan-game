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

STILL TO DO in Stage 1: the contract ABILITIES (tophat free hazard, Hazard /
Aerobrake Ignore, Shielded, Insight, Secured, Bailout, Connections deck choice,
"When Fulfilling" effects), negotiation of contracts (4B2g), a tie-winner picker
in the auction overlay, and Freighter / Bernal stacks carrying a contract.

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
