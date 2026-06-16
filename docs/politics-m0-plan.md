# Module 0 - Sol Political Assembly (planning)

Planning doc for the M0 politics module. M0 is OUT of the current shipped scope
(see CLAUDE.md "Variants we target": Standard + CEO Solitaire only) - this is a
forward design we are choosing to start, not yet a committed stage.

Source: the published HF4 "Sol Political Assembly" mat (Module 0). Only the
FUNCTIONAL rules (mechanics + short labels) are captured here, in our own words;
the printed mat's layout / wording is copyrighted and is NOT reproduced.

NOTE on the file name: the deleted `data/politics.js` was a FABRICATED events
deck (CLAUDE.md), unrelated to this. The real assembly data lives in a new file
`data/assembly.js` so it is never confused with that removed fake.

## The assembly

A hexagon of six **ideologies** around a **Centrist** center. Each ideology has:
- a **Law** (an effect that is active when the ideology is "in power"), and
- an **end-game VP award** (scored once, at game end).

| key | ideology | law (effect) | vp award |
|---|---|---|---|
| freedom | Freedom | Free Market op may sell 2 cards for 5 aqua (base is 1 for 3) | +1 VP per factory cube |
| honor | Honor | on a Fundraise op, aqua gained = your glory-chit count | +1 VP per glory chit |
| unity | Unity | every ideology with 2+ delegates has its Law active; lobbying disallowed | +1 VP per ideology you have a delegate in |
| authority | Authority | on a Fundraise op, may discard an opponent's delegate | +1 VP per claim disc |
| equality | Equality | Research Auction op: pay 1 aqua, take the top card with NO support cards | +1 VP per colony dome |
| individuality | Individuality | treat an opponent's Factory / Bernal as your own for non-victory purposes | +1 VP per token on <site types TBD> |

Center: **Centrist / Pad Insurance** - with a delegate in the center, the boost
cost of any card you lose to a Pad Explosion event is instantly repaid.

## Components

- **Delegates**: a new per-player component, rendered as a cube (distinct from
  the factory cube; reuse the pip-row UI). Supply count per player is TBD (needs
  the M0 rules). A delegate sits in one ideology wedge (or the center).
- We already model factory cubes (7), colony domes (7), claim discs (9). Add a
  delegate supply to the same per-player component model + the MP-tab pip row.

## Rules to implement

### Law activation ("voting")
- An ideology's Law is **active** based on delegate counts in that wedge. The
  base activation threshold (majority? plurality? a fixed count?) is NOT fully
  on the mat - the only explicit rule shown is the Unity override ("2+ delegates
  => active, no lobbying"). **OPEN: confirm the base vote-tally rule from the M0
  rulebook.** Model it as a pure function `activeLaws(state)` so the threshold is
  swappable.
- `state.assembly` holds delegate placements: `{ [ideologyKey|'center']: { [profileId]: count } }`.

### Fundraise (operation - replaces Income)
Spends the turn's operation. Steps:
1. Place a new delegate, or move one of yours, into an ideology/center.
2. Gain 1 aqua (modified by active laws: Honor => aqua = your glory chits).
3. Run the vote tally (recompute `activeLaws`).
- Active-law hooks during a Fundraise: Authority (may discard an opponent's
  delegate), Honor (aqua amount). These fold in like the existing privilege
  hooks (`creditPrivilegeIncome` is the pattern).

### Lobby (free action)
- Pay 1 aqua + discard one of your delegates that sits in an **inactive**
  ideology to use that ideology's Law once this turn (once per turn).
- Disallowed while the Unity law is active (the "no lobbying" clause).

### Law effects wiring
Each law hooks an existing op:
- Freedom -> Free Market op (sell 2 for 5).
- Equality -> Research Auction start (pay 1, no support bonus draw).
- Honor / Authority -> Fundraise op.
- Individuality -> ownership checks for Factory/Bernal use (non-victory).
- Unity -> the activation resolver itself.
- Centrist -> Pad Explosion event resolution (repay boost cost).
Each effect is gated on `lawActive(state, player, key)` (active via vote OR a
Lobby use OR a held privilege), the same shape as `hasPrivilege`.

### End-game scoring
Add the six per-ideology VP awards to the final tally, counted only for players
who have a delegate in (or majority of?) that ideology. **OPEN: confirm whether
the award goes to delegate-holders, the controlling player, or everyone.**

## Anarchy interaction
The engine already has an Anarchy event that suspends faction privileges. M0
formalises this: confirm how Anarchy interacts with active laws (suspends them?)
when wiring the resolver.

## Open questions (need the M0 rules text, not the mat art)
1. Base vote-tally / law-activation threshold (the non-Unity case).
2. Delegate supply count per player.
3. Individuality VP: which two site types the tokens sit on.
4. End-game ideology VP: who scores each award.
5. Whether placing vs moving a delegate on Fundraise is a choice or forced.

## Implementation status (2026-06-15)

DONE (server + client):
- Room creation M0 checkbox wired end to end: lobby column -> start ->
  `state.m0` + `state.assembly`. Games in flight default to m0=false.
- `data/assembly.js`: `freshAssembly`, delegate-count helpers,
  `DELEGATES_PER_PLAYER` (default 5, TUNABLE), and the pure `activeLaws`
  resolver (plurality in power; Unity override activates every 2+ ideology and
  disables lobbying).
- Engine ops `FUNDRAISE` (place/move a delegate, gain aqua; Honor pays per
  glory chit; Authority may discard an opponent's delegate) and `LOBBY` (free,
  once/turn: pay 1 + discard a delegate in an inactive ideology to use its law
  this turn; blocked while Unity is in force). Both ride the undo stack.
- Client 🏛 Politics tab: the hex board with delegates in seat colour, the
  active-law read-out, delegates-in-hand, and Fundraise / Lobby controls.

DONE (law EFFECTS, server engine - 2026-06-15):
- Freedom (Free Trade Act): `applyFreeMarket` accepts `cardIds` and, when the
  player can use the law, sells 2 cards for 5 aqua (base stays 1 for 3). Guards:
  2 cards without the law -> `needs_freedom_law`; >2 -> `too_many_cards`.
- Equality (Research Grants): `applyAuctionStart` takes `useEquality`; with the
  law it skips the auction, pays 1 aqua, and takes the deck-top card straight to
  hand (commits the turn like an auction would).
- Centrist (Pad Insurance): the `pad_explosion` EVENT_CHOICE repays the lost
  card's boost cost (radiator side aware) when a delegate sits in the center.
  FULLY PLAYABLE now (automatic, no client trigger needed).
- Individuality (Freedom to Roam): `canUseFactoryNonVictory` lets a player use an
  opponent's Factory for the non-victory ops (Site Refuel, ET Produce, Delivery)
  when the law is in force. Homesteading (Build Colony) stays owner-only.
All four verified against the real engine (server/game/engine.js) via a crafted
m0 state (FREE_MARKET 2-for-5 + guard, AUCTION_START grant + guard, pad-explosion
refund + no-refund).

DONE (client surfacing - 2026-06-15):
- Shared client helpers in `js/game/browse.js`: `myActiveLaws()` / `iCanUseLaw()`
  (mirror of the server's playerCanUseLaw, read off the cached snapshot) and
  `iCanUseFactory()` (mirror of canUseFactoryNonVictory).
- Freedom: the Free Market flow (hand quick-action, card modal, AND the op-menu
  Free Market) opens a Free Trade picker when the law is usable - sell 1 for 3
  or pick a 2nd hand card and sell both for 5 (`cardIds`).
- Equality: the MP deck-tap auction picker adds a "Take <deck> for 1 (Research
  Grants)" row when the law is usable (`useEquality: true`).
- Individuality: Site Refuel / ET Produce / Delivery now accept an opponent's
  factory when the law is usable (the op-menu factory-site shortcut surfaces it
  too, labelled "Freedom to Roam"); Homesteading stays owner-only.
- Centrist needs no client trigger - it fires automatically server-side.

DONE (end-game scoring + seniority discs - 2026-06-15):
- Seniority discs: at every M0 round close the round's FIRST player drops one
  permanent neutral disc on an assembly space (server PLACE_SENIORITY lifecycle
  op + pendingSeniority freeze; client placement overlay mirrors the first-player
  handoff; discs render on the assembly board).
- Final political vote (data/assembly.js finalVote): per ideology, votes =
  delegate cubes + seniority discs; winner by votes, then disc count, then seat
  order.
- End-game scoring (server computeFinalScores, shown in the game-over screen):
  each player scores +1 VP per delegate cube, the WINNING ideology's award from
  their own holdings (all players, own holdings), plus factory / colony / glory
  VP. Ranked by total then aqua. The game-over overlay shows the winning ideology
  banner + per-player breakdown.

REMAINING:
- Individuality's end-game award counts "tokens on certain sites" - the two site
  icons on the mat are unreadable, so it scores 0 for now (flagged "award TBD" in
  the game-over screen). Confirm the site types from the M0 rules to finish it.
- A fuller end-game tally (Exploitation Track spectral pricing, Bernals) is the
  broader Stage-4 scoring; the M0 contributions already fold into the total.

## Build order (proposed)
1. `data/assembly.js`: ideology/law/award table + `activeLaws()` + `lawActive()`
   pure resolvers (shared client/server, like `data/support-chain.js`).
2. State: `state.assembly` delegate map + `player` delegate supply.
3. Engine ops: `FUNDRAISE` (op) and `LOBBY` (free action); fold law hooks into
   Free Market / Research Auction / Pad Explosion.
4. Client: assembly view (hex), Fundraise/Lobby controls, delegate pip row in
   the MP tab, end-game VP lines.
