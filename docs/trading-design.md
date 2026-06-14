# Trading & negotiation - design plan

Next-phase design for player-to-player trading: consent-based deals, colocated
cargo transfers between players, and aqua transfers. This is the design doc the
implementation will follow; it is NOT yet built. Mechanics here are
engine-level (fair to invent per CLAUDE.md), but the UI must read like the
published game (no implementation language in player-facing copy).

## Goals (from the request)

- A trade is a **two-party deal that both players must consent to** before
  anything moves. No item leaves a player without their explicit agreement.
- Trades can be opened **at any point in the game**, regardless of whose turn
  it is. Trading is a side-channel negotiation, not the turn's operation.
- Cover the concrete cases:
  1. **Aqua transfer** (bank currency moves between players).
  2. **Colocated cargo transfer** (cards / tank water move between two players
     whose stacks sit at the same place).
  3. **Crew ability grants** (a player lends/grants a crew ability to another,
     for an agreed number of turns or permanently).
  4. **A negotiated bundle** that mixes any of the above (give X, receive Y,
     atomic).
- One **overarching Trade UI**, reached from a button in the multiplayer panel.

## Decisions (locked 2026-06-14)

- A trade is **free and off-turn**: it can be proposed/accepted at any point
  regardless of whose turn it is, and never consumes the turn's operation.
- **Only in-space cargo needs colocation.** Aqua, hand patents, and ability
  grants are abstract and trade anywhere; only stack cards and tank water
  require both players colocated.
- **v1 trades the full set**: aqua, hand patents, in-space cargo cards, tank
  water (whole units), and crew ability grants (timed or permanent).

## What is tradeable

| Item | Tradeable | Needs colocation? | Unit / rule |
|---|---|---|---|
| Aqua | yes | no (bank to bank) | whole aqua |
| Hand cards (undeployed patents) | yes | no (abstract paper patents) | respects receiver's 4-card hand limit |
| Crew ability grant | yes | no (a licensed expertise, not a physical object) | timed (N turns) or permanent; permanent is irreversible. See "Crew ability grants". |
| Stack cards (in LEO / rocket / outpost) | yes | yes | move into a colocated stack of the receiver |
| Tank water (fuel) | yes | yes | whole water units only (matches CASH_WATER / TRANSFER_FUEL); sub-1 remainder cannot move |
| Dirt fuel | no | - | field propellant has no trade value (matches CASH_WATER) |
| Glory chits / VPs / claims / factories | no (v1) | - | out of scope for first cut |

"Abstract" items (aqua, hand cards, ability grants) move regardless of where
the two ships are. "In-space" items (stack cards, tank water) require both
players' relevant stacks to be **colocated** at execution time. A bundle that
includes ANY in-space item requires colocation for the whole deal (the swap is
atomic).

## Colocation

Reuse the existing colocation notion from `TRANSFER` / `TRANSFER_FUEL` in
`server/game/engine.js`:

- **LEO**: a player's rocket at LEO (`siteId === null`) plus their LEO stack.
- **Site / outpost**: a player's rocket parked at a `siteId`, plus any of their
  outposts at that `siteId`.

Two players are **colocated** when they share a location: both rockets at LEO,
or both rockets parked at the same `siteId`, or one's rocket at the site where
the other has an outpost, etc. The trade builder shows the shared location and
disables in-space-cargo controls when there is none ("Bring your ships together
to trade cargo"). Colocation is re-validated on the server at finalize, because
either player may have moved between offer and accept.

## Crew ability grants

A player can put one of their **crew abilities** (the faction/crew-card
privileges) on the table as a grant. The recipient gains the ability for an
agreed term:

- **Timed**: the recipient holds it for N of their own upcoming turns, then it
  expires automatically.
- **Permanent**: the recipient holds it for the rest of the game. **Permanent
  grants are irreversible** - they can never be revoked, expired, or traded
  back.

Model:

- Grantable abilities = the lender's currently-held privileges (their crew
  faces plus any permanent grants they themselves already hold). The privilege
  keys already exist in the engine (e.g. the `grantedPrivileges` set + the
  faction privilege resolution); the grant list extends them.
- A grant is **shared, not surrendered** (v1 default): the recipient gains use
  of the ability while the lender keeps theirs. (Open: an "exclusive lease"
  variant where the lender loses use for the term - flagged below.)
- Per-player state grows a grant list:

  ```js
  player.borrowedAbilities = [
    { ability: 'PRIVILEGE_KEY', fromPlayerId, turnsRemaining: n | null }
    // turnsRemaining === null  => permanent (never decremented, never removed)
  ];
  ```

- **Expiry tick**: on the recipient's `END_TURN`, decrement each timed grant's
  `turnsRemaining`; drop it at 0 and log "borrowed <ability> from @lender
  expired". Permanent grants (`turnsRemaining === null`) are skipped. This is
  the one engine-side ongoing effect a trade introduces; everything else is a
  one-shot at finalize.
- **Privilege resolution** reads the union of a player's own privileges and
  their active `borrowedAbilities` everywhere privileges are checked, so a
  borrowed ability behaves exactly like an owned one for its term.

### Ability badge (multiplayer panel)

Each player's roster card shows a small row of **ability badges** in the
crew/support glyph language:

- The player's own crew abilities (always shown).
- **Borrowed** abilities, visually distinct, with a term marker:
  - timed: a turn counter (e.g. "3" turns left), counting down each of the
    holder's turns.
  - permanent: a lock / infinity marker (irreversible).
- Tooltip names the ability and who it came from ("Dharma Refuel, on loan from
  @A, 3 turns left") in gameplay language.

The badge is the at-a-glance answer to "who currently has which crew power", so
a returning tabletop player can read the borrowed-power state without opening a
menu.

## The consent handshake

Consent is modelled exactly the way an offer/accept negotiation works at the
table, and it leans on the auction precedent (multi-party, off-turn,
caller-validated ops that bypass the turn gate).

```
A builds a deal  ──TRADE_OFFER──▶  awaiting: B
                                     │
        ┌────────────────────────────┼───────────────────────────┐
        ▼                            ▼                             ▼
   B: TRADE_ACCEPT            B: TRADE_COUNTER (new terms)   B/A: TRADE_DECLINE
   both consented →             awaiting: A                  trade cleared,
   execute atomic swap,         (A now accepts/counters/      nothing moves
   clear trade, log             declines) ... loop
```

Key rule: **an offer or counter IS the sender's consent to those exact terms.**
An accept is the receiver's consent to the same terms. So one ACCEPT always
means both sides have agreed to identical terms - that satisfies "both parties
must consent." A counter is a decline-and-re-offer in one step and flips who is
"awaiting", so the loop is symmetric and always terminates on an accept or a
decline. Either party may decline / withdraw at any time.

Terms are versioned so an accept can only land on the terms currently on the
table; any counter bumps the version and invalidates a stale accept.

## Server ops (engine.js)

New op kinds, handled in the **auction-style branch** of `applyOperation`
(any player, **bypass the turn gate**, validate the caller's role in the
handler). They do **not** ride the per-turn undo stack and they advance
`committed_seq` (a trade involves another player, so like auctions it cannot be
undone). Every handler returns a non-empty `log` (CLAUDE.md mission-log rule).

| Op | Caller | Effect |
|---|---|---|
| `TRADE_OFFER` | initiator | open/replace `state.trade` with terms; `awaiting = partner`. |
| `TRADE_COUNTER` | current `awaiting` party | replace terms, flip `awaiting`, bump version. |
| `TRADE_ACCEPT` | current `awaiting` party | re-validate, execute atomic swap, clear `state.trade`. |
| `TRADE_DECLINE` | either party | clear `state.trade`, nothing moves. |

Trade term shape on the wire / in state:

```js
state.trade = {
  initiatorId, partnerId,
  awaiting: 'initiator' | 'partner',   // who must accept/counter/decline now
  version: n,                          // bumped on every offer/counter
  // each side's promised items, from that player's perspective:
  give:    {
    aqua, water,
    handCardIds:[],
    stackCards:[{id, from:'leo'|'rocket'|'outpostA'..}],
    abilities:[{ ability:'PRIVILEGE_KEY', turns:n|null }],  // null turns = permanent
  },
  receive: { /* same shape */ },
  location,                            // resolved shared location for in-space items, or null
};
```

(`give`/`receive` are always written from the **initiator's** perspective; the
partner's overlay swaps the labels.)

### Finalize validation (TRADE_ACCEPT)

All-or-nothing on a clone (applyOperation already clones), reject the whole op
on any failure with a specific error so the UI can explain it:

- Both players still in the game and not spectators.
- Accept's `version` matches `state.trade.version` (else `trade_stale`).
- Each side still **owns** every promised item: aqua balance >= promised aqua,
  hand cards still in hand, stack cards still in the named stack, tank water >=
  promised water, and every promised ability is still held by the granter
  (else `ability_not_held`).
- If the bundle has any in-space item: both players still **colocated** at
  `location` (else `not_colocated`).
- Receiver hand-limit respected for incoming hand cards (else `hand_full`).
- Execute: move aqua, move hand cards, move stack cards into the receiver's
  colocated stack, move whole water units between tanks, and push ability
  grants onto each recipient's `borrowedAbilities`. Re-resolve each rocket's
  active thruster / prospector and clip/recall tanks exactly as `TRANSFER` does
  today.

On a validation failure the trade is **left open** (not auto-cleared) with the
reason surfaced, so players can counter or withdraw rather than silently losing
the negotiation.

### Concurrency (v1)

- **One open trade at a time** globally (single `state.trade` slot, mirrors the
  single `state.auction` slot). Simplest correct first cut; multi-trade keyed
  by player-pair is a later extension.
- A trade does **not** block the active player's normal ops (it is a
  side-channel; unlike the auction, it does not gate the turn).
- For v1, do not allow a trade to open while an auction is open, or vice versa,
  to avoid two competing modal overlays. (Both are the "interactive multi-party"
  surface.)

## Client

Mirror the auction wiring in `js/game/browse.js`.

- **Submitter**: `submitMpTradeOp(op)` modelled on `submitMpAuctionOp` - online,
  not spectator, **bypasses the turn check**, posts via `submitGameOp`, snaps
  back on failure with a humanized error.
- **Polling**: add `|| snapshot.trade` to the fast-poll cadence condition
  (`applyPollCadence`) so the partner sees an incoming offer within ~500ms.
- **Snapshot apply**: render the trade overlay from `snapshot.trade` in
  `applySnapshot`, parallel to the auction overlay - appears when non-null,
  clears when null, idempotent.
- **Errors**: add `trade_stale`, `not_colocated`, `hand_full`,
  `not_in_trade`, etc. to `humanizeOnlineOpError` in gameplay language.
- **Log icons**: add to `MP_LOG_ICONS` - `TRADE_OFFER: '🤝'`,
  `TRADE_COUNTER: '↔'`, `TRADE_ACCEPT: '✅'`, `TRADE_DECLINE: '🚫'`.
- **Net-bridge**: hydrate any trade-derived client state through the existing
  snapshot path (no new transport).

## The Trade UI

### Entry point

A **🤝 Trade** button in the multiplayer panel header (`renderMpPanel`), next to
"Start auction". Enabled whenever you are online and not a spectator, **on or
off your turn** (trading is allowed at any point). Disabled with a hint while an
auction or another trade is already open.

### Trade builder (modal)

Opened by the Trade button (or by Counter on an incoming offer, pre-filled).

- **Partner picker**: dropdown of the other seated players, each name tinted in
  its seat colour (the `.player-name` / `--player-color` convention).
- **Colocation banner**: "You and @partner are both at <site>" or "Not
  colocated - cargo and fuel are greyed out; aqua and patents can still trade."
- Two columns, **"You give"** and **"You receive"**, each with rows for:
  - **Aqua** - number stepper bounded by the giver's balance.
  - **Patents (hand)** - pick from the relevant player's hand (hand is open info
    in multiplayer); receiver-side limited to the 4-card hand cap.
  - **Cargo (cards in space)** - pick from colocated stacks (LEO / rocket /
    outpost); greyed out when not colocated.
  - **Fuel (water)** - number stepper, whole units, greyed out when not
    colocated.
  - **Crew ability** - pick one of the giver's abilities, then choose a term:
    a turn count, or Permanent (with an "irreversible" confirm).
- **Send offer** -> `TRADE_OFFER`.

### Pending-trade overlay

Shown to **both** involved players (like the auction overlay), minimizable to a
chip like the crew draft:

- Restates the deal from the viewer's perspective ("You give ... / You receive
  ..."), partner name tinted.
- **Party who is `awaiting`**: Accept / Counter / Decline.
- **Party who is waiting**: "Waiting for @partner ..." + Withdraw (sends
  `TRADE_DECLINE`).
- Live colocation/validity hint; if the deal has gone invalid (someone moved or
  spent an item) it says so and offers Counter / Withdraw.

Non-involved players are not interrupted; the negotiation is open info but does
not pop a modal for them. (Optional later: a quiet "@A and @B are negotiating"
line in the roster.)

### Mission log

Finalize writes one log line both directions, e.g.
`@A traded 2 aqua + Tug to @B for Ion Drive` (icon 🤝 / ✅). Decline/withdraw
log a brief "trade called off" line so the record is complete.

## Files to touch (implementation map)

| Area | File | Change |
|---|---|---|
| Engine ops | `server/game/engine.js` | `TRADE_OFFER/COUNTER/ACCEPT/DECLINE` in the auction-style (off-turn, caller-validated) branch; finalize validation + atomic swap; reuse `TRANSFER` card-move + active-card re-resolve helpers. Decrement `borrowedAbilities` on `END_TURN`; union them into privilege resolution. |
| State shape | `server/game/state.js` | add `state.trade` slot (top-level, single open trade) + `player.borrowedAbilities` list. |
| Ability badges | `js/game/browse.js` (`renderMpPlayer`) | per-player ability badge row (own + borrowed, with term marker), crew/support glyph language. |
| Submitter | `js/game/browse.js` | `submitMpTradeOp` (mirror `submitMpAuctionOp`). |
| Panel button | `js/game/browse.js` (`renderMpPanel`) | 🤝 Trade button + enable/disable logic. |
| Builder + overlay | `js/game/browse.js` | trade builder modal + pending-trade overlay (mirror auction overlay / crew-draft chip). |
| Snapshot + poll | `js/game/browse.js` (`applySnapshot`, `applyPollCadence`) | render overlay from `snapshot.trade`; add to fast-poll condition. |
| Errors + icons | `js/game/browse.js` | `humanizeOnlineOpError` entries + `MP_LOG_ICONS` entries. |

## Open decisions

Resolved (see "Decisions (locked 2026-06-14)"): op cost (free/off-turn),
colocation scope (in-space cargo only), and v1 scope (aqua + hand patents +
in-space cargo + tank water + crew ability grants).

Still to confirm before building:

1. **Ability grant: shared or exclusive?** v1 default is **shared** (the
   recipient gains the ability for the term while the lender keeps theirs). The
   alternative is an **exclusive lease** where the lender loses use for the term
   (and forever, for a permanent grant). Shared is simpler and matches
   "licensing your expertise"; exclusive is a stronger negotiation lever.
2. **Concurrency.** Recommended: single open trade at a time for v1; revisit
   multi-trade keyed by player-pair later.
3. **Grantable ability set.** Need to enumerate exactly which crew/faction
   privileges are eligible to grant (some may be identity-bound and should be
   excluded). Pull from the privilege registry / `docs/card-powers.md` during
   implementation.
