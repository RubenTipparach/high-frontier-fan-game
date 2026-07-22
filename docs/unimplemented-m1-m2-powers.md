# Unimplemented M1 / M2 card powers + futures

Audit of Module 1 (Terawatt) and Module 2 (Colonists / Bernals / Futures)
card abilities whose text is in the card data but whose EFFECT is not yet wired
into the engine. Everything below is defined in `data/` (so it renders and the
sheet is the source of truth) but has no code path that acts on it.

**As each one is implemented, DELETE its row / bullet from this file** so the
list only ever shows what is still outstanding. When the file is empty, M1/M2
power + future coverage is complete.

Verification method (repeatable): grep the engine + client for the flag name
(CARD_POWERS / COLONIST_POWERS key) or a name-based handler, and confirm the
value is read somewhere, not just stamped. Futures also need their standing
`effects` key CONSUMED, not merely pushed onto `player.futureEffects`.

Last audited: 2026-07-22. The full list from the previous pass (3 future
effects, 7 Bernal ability clauses, 4 Freighter powers, 3 colonist powers) is
now implemented and verified (see "Landed this pass" below). Nothing is
currently outstanding from that list.

## Known scope narrowing (read before assuming a gap)

- **Tourism Cycler's "forgo Belt Rolls near Earth" is wired for the ROCKET
  only.** The freighter and Bernal each roll radiation differently from the
  rocket's per-card decommission model (freighter: `unitRadHardness` +
  glitch/explode; Bernal: no rad roll at all today), so "any Spacecraft" was
  narrowed to the one unit whose rad-roll model actually supports a per-zone
  waiver. Extending it to the freighter would mean adding a
  `player.freighter.tourismCyclerWaived`-style check into
  `applyMoveFreighter`'s glitch-roll branch (engine.js, the `frRad`/`rolls`
  loop) - straightforward if it's ever asked for, just not done yet.
- **The client's rad-confirm modal does not yet mirror the Tourism Cycler
  Earth-belt bypass.** The SERVER correctly skips the roll (verified), but the
  pre-move confirm preview (`radConfirmModal` / `routeHazards` in
  `js/game/browse.js`) may still list an Earth-zone rad crossing as "will
  roll" since none of its `site.type === 'radhaz'` filters check the ability
  yet. Cosmetic only - the move genuinely bypasses server-side - but worth
  fixing if it reads as a discrepancy in play.

## Landed this pass (2026-07-22)

For reference / to avoid re-litigating - all verified against the real engine
handler (temp-export node tests, removed after passing) or a live local
server round-trip:

- Futures: `freeMarketUnlimited` (unlimited Free Market sale, no op cost),
  `freeInspiration` (new FREE_INSPIRATION op, cycles market decks as a free
  action), `powersatPlus2` (+2 Powersat push thrust, server + client mirror).
- Bernal: GEO Elevator / L3 Lofstrom Loop (lander burns treated as normal Burn
  Spaces, server `maneuverGate` + client mirror), L1 Climate Control (always
  first player at round-close, supersedes the normal handoff), L2 Collimator
  (Bonus Pivot on a Powersat-pushed leg, client planner only), L4s
  Pharmaceutics (imposes the academia hand limit on opponents even through
  their own Skunkworks, server + client), L5s Cancer Hospital (Crew / Human
  Colonist rad-hard floored at 7 against every rad threat: belt rolls, Glitch
  Roll, solar flares, Project Valkyrie purge), SSO Diplomatic (+1 VP per
  delegate: faction-color ideology only when white/HOME, every ideology when
  promoted-anchored-anywhere), Tourism Cycler (forgo Earth-zone belt rolls on
  the rocket - see scope note above).
- Freighter: Antiproton Sail and Harvester (+1 thrust starting on a
  radiation belt), Poodle Steam (+2 thrust starting on a Factory), Inflatable
  Solar-Heated / Archimedes Palmer Lens (Ceres / Jupiter outward zone cap
  unless Powersat-pushed, enforced server-side in `applyMoveFreighter`).
- Colonist: `noAerobrake` (Calypso 2 / Wet-Nano Seed Sail - hard-blocks MOVE
  through any aerobrake node), `etProduceCAnywhere` (Blue Goo Sybonts -
  client-side relaxation of the Spectral-C factory-match filter; the server
  never gated ET spectral in the first place, so this was purely a UI fix),
  `auctionDeckSearch` (Renaissance Man - new `GET /games/:id/deck/:type`
  endpoint gated on the power, a deck-search picker modal, and
  `AUCTION_START`'s `deckSearchCardId` splicing the chosen card instead of a
  blind top-draw).

## Doc fix

- [x] `docs/module-m2-implementation.md`'s stale `elevatorFreighter` deferred
  note was corrected to point at this file instead of duplicating a list.
