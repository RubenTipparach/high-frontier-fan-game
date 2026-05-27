# Multiplayer follow-ups

Design notes for multiplayer flows that build on the Stage 3
server-authoritative engine (`server/game/`). The async foundation
(turn passing, MOVE, END_TURN, undo/redo, history review) has landed;
the sections below are the next systems, captured here as the spec to
build against. Where a section says "draft", it is design only and is
explicitly deferred to a future update.

## Async auction (next build)

The HF4 auction is how a player acquires a patent: the active player
auctions a card and the table bids aqua for it. This is the
multiplayer bidding loop; the single-player sandbox shortcut (win
immediately for 0 aqua, see `openAuctionConfirmModal`) is not it.

Roles:
- Auctioneer: the active player whose turn it is. They open the
  auction and control when it closes.
- Bidders: every other player.

Rules (from the design owner):
- The auctioneer decides which round to close the auction on. An
  auction lasts at least one round.
- It is async: bidders can see the auction and change their bid (or
  pass) at any time while a round is open.
- A round can be closed once every bidder has acknowledged a decision
  for that round, i.e. each has either entered a bid or passed.
- When a round closes the auctioneer chooses to either:
  - End the auction and award it to a bidder, or
  - Continue: re-auction at a floor equal to or higher than the
    current highest other-player bid, opening a fresh round.
- The auctioneer wins (keeps the card) when all other bidders pass.
- A bidder wins when the auctioneer passes and accepts that bid.
- The auctioneer gains the winning bid in aqua when they award a
  bidder.
- Bids may tie; the auctioneer picks the winner among tied bids.

### State shape

A single live auction hangs off the game state while open
(`state.auction`, null otherwise):

```
auction: {
  auctioneerId,            // active player
  prize,                   // what is being auctioned (see open questions)
  round,                   // 1-based
  closeOnRound,            // auctioneer's intended last round (>= 1)
  floor,                   // minimum bid this round (0, or last continue floor)
  bids: { [profileId]: { amount: number|null, passed: bool, acked: bool } },
  status,                  // 'open' | 'awarding' | 'closed'
}
```

`acked` is the per-round "I have made my decision" flag. Changing a
bid before acking is free; the round is closable once every bidder is
acked. A `continue` resets `acked`/`bids` for the new round.

### Op vocabulary

Auction ops extend the engine's op set. Unlike MOVE, bidder ops are
NOT gated on whose turn it is (it is async), but they ARE gated on
"an auction is open and you are a bidder in it".

- `AUCTION_START { prize, closeOnRound }`   auctioneer opens.
- `AUCTION_BID { amount }`                   bidder sets/changes a bid (>= floor).
- `AUCTION_PASS`                             bidder passes.
- `AUCTION_ACK`                              bidder locks their decision for the round.
- `AUCTION_CLOSE_ROUND`                      auctioneer; only when all bidders acked.
- `AUCTION_CONTINUE { floor }`               auctioneer; floor >= current max other bid; new round.
- `AUCTION_AWARD { winnerId }`               auctioneer ends + awards (winner pays aqua to auctioneer).
- `AUCTION_KEEP`                             auctioneer keeps it (only legal when all bidders passed).

Resolution moves the prize to the winner and transfers aqua
(bidder -> auctioneer). Like every op it is validated server-side,
snapshotted, and broadcast on `game:<id>`; it also participates in the
undo/commit model (an auction that consumed no roll is undoable by its
own actor until committed, same rules as MOVE).

### Open questions for the build

- Prize model: in HF4 the prize is the top card of a chosen patent
  deck (plus the support-bonus deck draws the winner is owed). Confirm
  whether the auctioneer auctions one deck top of their choosing, and
  where the won card lands (winner's hand, per `hand.js`).
- Auctioneer economy: if the auctioneer keeps the card (all pass), do
  they pay the bank, and how much? The spec covers bidder-pays-
  auctioneer but not the keep cost.
- Does opening an auction cost the auctioneer one of their turn
  operations (`OPS_PER_TURN`)?
- Timeout / abandonment: async means a bidder may never ack. Likely
  needs an auctioneer override or a per-player turn timer; out of
  scope until basic flow works.

### Client surface

`openAuctionModal` (distinct from the single-player
`openAuctionConfirmModal` in `js/game/card-market.js`):
- Shows the card(s) being auctioned (full art) and the bonus
  support-deck tops so bidders evaluate the whole prize.
- Per-player bid inputs (aqua), current high bid, pass / raise, and a
  per-round "ready / acked" indicator.
- Auctioneer-only controls: close round, continue (with floor), award,
  keep.

The previous modal that lived here (deck tabs + per-card picker +
Hand-card sacrifice block) was the wrong shape: sacrifice is not a
published rule and the per-card picker violated the "only the top of
each deck is auctionable" rule. The rebuild starts clean. Single-player
surfaces stay in `openAuctionConfirmModal` and never grow a bidding UI.

## Trading API (draft, future update)

Player-to-player trading. Drafted here for a future update; not built
yet. Trades are async and turn-independent: any player may propose to
any other at any time, and proposals sit until answered.

### What can and cannot be traded

Tradeable:
- Claims (a prospected site / its success disc).
- Claims + factory (the claim with its built factory).
- Claims + factory + colony (the full improved site).
- Outposts (a parked outpost stack A-D and its contents).
- Hand cards (patents in a player's hand).
- Aqua (the liquid currency).
- FTS (futures contracts).

Not tradeable:
- Glory chits (career inventory, bound to the crew/player).
- Crew cards.
- The rocket stack as a unit.

Special case: individual items inside a rocket stack are not "traded"
but can be transferred to any other player when the two are
co-located: both at LEO, both on the same site, or both at the same
in-space node. This is a one-way move (cards travel between stacks),
separate from the propose/accept trade loop.

### Op vocabulary (draft)

Turn-independent ops (validated on ownership + asset existence, not on
whose turn it is):

- `TRADE_PROPOSE { toProfileId, offer: Asset[], request: Asset[] }`
- `TRADE_WITHDRAW { tradeId }`     proposer cancels.
- `TRADE_ACCEPT { tradeId }`       recipient accepts -> atomic swap.
- `TRADE_DECLINE { tradeId }`
- `TRADE_COUNTER { tradeId, offer, request }`   optional.
- `STACK_TRANSFER { toProfileId, fromStack, cardIndex }`
   move one stack card to a co-located player; gated on co-location.

### Asset descriptors (draft)

```
{ type: 'AQUA',          amount }
{ type: 'HAND_CARD',     cardId }
{ type: 'CLAIM',         siteId, includes?: ['factory','colony'] }
{ type: 'OUTPOST',       letter }      // A | B | C | D
{ type: 'FTS',           contractId }
```

### Persistence + validation (draft)

- A `game_trades` table (id, game_id, from_id, to_id, offer JSON,
  request JSON, status pending|accepted|declined|withdrawn,
  created_at, resolved_at), broadcast on `game:<id>` like ops.
- Accept performs an atomic swap inside one transaction: re-validate
  that every offered + requested asset is still owned by the right
  player (a stale proposal whose assets moved is rejected), then move
  ownership of each asset and adjust aqua.
- `STACK_TRANSFER` validates co-location at apply time
  (`a.rocket.siteId === b.rocket.siteId`, or both at LEO / the same
  in-space node) and that the target card is in the source stack.
- Reject any asset whose type is in the non-tradeable set.

This whole section is design only. Implementation follows the auction
and the card-market / BUILD ops, since trades operate on the assets
those systems create (claims, factories, hand cards, FTS).
