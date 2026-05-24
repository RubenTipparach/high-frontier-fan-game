# Multiplayer follow-ups

Single-thread notes for behaviours that are deferred until the
multiplayer engine lands. Each entry is a stub the team can
flesh out later; the sandbox does not surface any of these
flows today.

## Deferred: `openAuctionModal` (auction-in-progress preview)

A second auction modal, distinct from the single-player
confirm dialog in `js/game/card-market.js#openAuctionConfirmModal`,
will be needed when bidding is live across multiple players.
The shape will probably look like:

- Shows the card being auctioned (full art) so every player
  can see what they're bidding on.
- Shows the bonus support-deck tops in full so the bidders
  evaluate the whole prize (single-player `Confirm` modal
  also reveals these now per the 2026-05-24 clarification).
- Bidding UI: aqua bid inputs per player, current high bid,
  pass / raise buttons. In sandbox today auctions cost 0 aqua
  and the player wins immediately; multiplayer is the real
  bidding loop.
- Hooks into a shared turn engine (server-authoritative once
  Stage-3 server lands) so bids are atomic across clients.

The previous implementation that lived here (deck tabs + per-
card picker + Hand-card sacrifice block) was the wrong shape:
sacrifice is not a published rule and the per-card picker
violated the "only top of each deck is auctionable" rule.
It was removed wholesale; the rebuild for multiplayer should
start clean.

When implementing, keep the file scoped to engagement-with-
opponents flows. Single-player surfaces stay in
`openAuctionConfirmModal`; they should never grow a bidding
UI.
