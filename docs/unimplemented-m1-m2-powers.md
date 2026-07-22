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

Last audited: 2026-07-22.

## Futures - standing effects defined but never consumed

The goal checklists, Epic Hazard op, `endgameVp`, `clearsTokensAt`, and costs
are all wired. These three standing effect keys are stamped onto
`player.futureEffects` (`data/future-goals.js`) but no code reads them:

- [ ] `freeMarketUnlimited` - ARTIFICIAL CONSCIOUSNESS Future (col_malcolm).
- [ ] `freeInspiration` - SETI Future (col_microgravity_pantrophists).
- [ ] `powersatPlus2` - MASS BEAM Future (gw-_levitated_dipole_6li_h_fusion).

(War of Independence / casus-belli consequences are deferred by design - see
`docs/module-m2-implementation.md`. That is Module 3 territory, not listed here.)

## Bernal powers - unimplemented

Several are the SECOND clause of a face whose main clause (a faction privilege)
IS wired; only the extra clause is missing. Face key: W = white/primary,
P = purple/promoted.

- [ ] **GEO Elevator Bernal (P)** + **L3 Lofstrom Loop (P)** - "Your
  factory-assisted landings/liftoffs anywhere treat lander burns as normal Burn
  Spaces." No handler; the lander-burn maneuver gate ignores it.
- [ ] **L1 Climate Control Bernal (W)** - "You are always the 1st player,
  superseding all other claimants." No override of `state.firstPlayerIndex`.
- [ ] **L2 Collimator Bernal (P)** - Powersat privilege is wired, but the extra
  "Powersat push includes a Bonus Pivot" is not.
- [ ] **L4s Pharmaceutics Bernal (P)** - Skunkworks privilege is wired, but
  "impose academia hand limit on all opponents" is not.
- [ ] **L5s Cancer Hospital (P)** - +1 Token VP per Colony Dome is wired
  (`bernalScoreVp`), but "Your Crew and Human Colonists have a rad-hard of at
  least 7" is not.
- [ ] **SSO Diplomatic (W + P)** - only the base 1 VP per placed delegate exists
  (`playerDelegatesPlaced`); the Bernal's EXTRA +1 VP per delegate (W: only in
  the faction-color ideology; P: all delegates) is not added. M0-gated.
- [ ] **Tourism Cycler (W)** - "Can designate any Spacecraft to forgo Belt Rolls
  in the Radiation Belts near Earth." No handler.

Wired Bernal powers (for reference, do NOT re-implement): GEO/Lofstrom
boost-without-doubling (W, `bernalBoostCost`), Collimator/Pharmaceutics faction
privilege (`bernalPrivilegeGrant`), Antimatter Factory crew on-board reactor
(W/P, `CARD_POWERS.crewOnBoardReactor`), Solar Cell net-thrust bonus (W/P,
`solarCellThrustBonus`), Cancer Hospital budget-cut immunity (W,
`immuneToBudgetCuts`) + VP/dome (P), Climate Control +2 VP/Dirtside (P),
Tourism Cycler +2 VP/Dirtside (P).

## Freighter powers - unimplemented

Four freighter faces have ability text but no `CARD_POWERS` entry and no
name-based handler:

- [ ] **Antiproton Sail and Harvester** - "+1 net thrust if starting its move on
  a radiation belt."
- [ ] **Inflatable Solar-Heated** - "SOLAR HEATED: If not using Powersat, may
  move out only as far as the Ceres zone." (a movement zone cap)
- [ ] **Archimedes Palmer Lens** - "SOLAR HEATED: If not using Powersat, may move
  out only as far as the Jupiter zone." (a movement zone cap)
- [ ] **Poodle Steam** - "RADIOISOTOPE: +2 thrust if its move starts on a
  Factory."

## Colonist powers - unimplemented

Flags exist in `COLONIST_POWERS` but are not consumed:

- [ ] `auctionDeckSearch` (Renaissance Man) - starting a research auction may
  search a deck for the card to auction. Needs its own picker UI.
- [ ] `etProduceCAnywhere` (Blue Goo Sybonts) - produce Spectral C at any
  Factory. No-op today because the engine does not gate ET spectral type; wiring
  it means gating ET spectral first, then exempting this power.
- [ ] `noAerobrake` (Calypso 2 Seed Sail / Wet-Nano Seed Sail) - the carrying
  stack cannot enter aerobrakes. The aerobrake maneuver gate does not check it.

## Doc fix (not a power)

- [ ] `docs/module-m2-implementation.md` lists Martian Assembly's
  `elevatorFreighter` as deferred, but it is now WIRED (engine
  `elevatorFreighterAt`, client `browse.js` ~4614). Correct that deferred-list
  line.
