# Crew faction ability audit (2026-11-14)

Every crew faction privilege (the `bonus` / `blurb` on each face in
`data/crew.js`) checked against the server engine.

**Status: every playable crew face is Implemented and Verified, with no known
bugs.** "Playable" means the 12 core faces plus every promo face not tagged
`requiresModule` M4 / M5 (39 faces in all: 12 core + 27 promo; the 4 faces
still tagged M5 are out of scope; JAXA's two M4 faces and Courier joined
2026-11-24). The second pass on 2026-11-14 built the 21 promo faces
that had no engine rule and fixed the 4 bugs the first pass found.

- Tests: `scripts/check-crew-abilities.mjs`, beside the CI engine smoke
  `scripts/check-engine.mjs`. Run `node scripts/check-crew-abilities.mjs
  --strict` (`--strict` makes any known bug fail the run). It needs the vendored
  map: `git submodule update --init vendor/hf-mission-planner`.
- Result, with `--strict`: **126 ok, 0 failed, 0 known bugs, exit 0.** The
  closing inventory reports **0 in-scope faces with no engine rule**.
  `check-engine.mjs` (253 ok), `check-boot.mjs` and `build.mjs` also pass.
- The script is NOT wired into CI (`.github/workflows/deploy.yml`). Add it next
  to `check-engine.mjs` if you want it gating.

## How the checks were made trustworthy

Each check compares a holder against a control: the SAME seat on the OTHER face
of the same physical card, or the holder on another seat. The disabled
conditions are covered for every face:
- Anarchy (K2e, `state.anarchy`);
- the Module 2 lock (2B3b: privileges dead until a Home Bernal is anchored, via
  `anchorHome`);
- solo vs multiplayer, and the C5 faction bank.

Mutation sweeps were run against scratch copies of the engine, never the repo:
- First pass: renaming each privilege key turned at least one check red for
  every implemented key; deleting the Anarchy line in `privilegeOf` turned 16
  red; making `factionPrivilegesLocked` always false turned 6 red.
- Second pass: renaming each new face's key turned 2 to 4 checks red per face,
  in all four groups.

Every face whose ability needs a player decision has a client control. Each one
was driven in headless Chromium against a local server and a scratch database,
never production, until its op was accepted and logged.

## Core crew (12 faces)

All references are `server/game/engine.js`.

| Faction / privilege | Rule (blurb) | Engine | Implemented? | Verified? | Bug? | Note |
|---|---|---|---|---|---|---|
| UN Cosmonauts / SECRETARY GENERAL | +2 aqua at start (M2: after the 1st Home Bernal anchor) | `:16148` (draft close), `:8986` (M2 anchor) | Yes | Yes | No | +2 once at draft close, no double pay on re-pick. Under M2 there is no opening credit and +2 on the first Home Bernal anchor only. |
| B612 Foundation / BLINK TELESCOPE | 1 re-roll per prospecting op with a Raygun | `:10070` | Yes | Yes | No | |
| Roscosmos / TAXES | +1 aqua when any player places or industrializes a Claim | `:1748` via `:10091`, `:10144`, `:10372`, `:10411` | Yes | Yes | No | |
| Taikonauts / FELONIOUS | Your Humans may commit Felonies | `:1908` (`mayCommitFelony`) | Yes | Yes | No | |
| NASA / LAUNCH FEES | +1 aqua after any player performs a boost operation | `:6417` | Yes | Yes | No (fixed) | LAUNCH-FEES-PER-OP fixed: pays once per turn's boost operation. |
| ISRO / DHARMA REFUEL | Humans carry a glory chit -> double site refuel | `:11399` (rocket), `:11241` (outpost) | Yes | Yes | No | |
| Anonymous P2P / OPEN SOURCE FINAO | FINAO costs 3 aqua | `:1579` (`finaoPerFor`) | Yes | Yes | No | |
| ESA / POWERSAT | +1 thrust to ANY push-icon spacecraft, any player's turn. Negotiable | `:1858` (`hasPowersat`), `:1871` (`powersatBeamedTo`), `:1887` (`applyPowersatBeam`) | Yes | Yes | No (fixed) | POWERSAT-ANY fixed: ESA trains a standing beam on any rival with the off-turn `POWERSAT_BEAM` op (roster 🛰 button). The rival's push-icon craft gets +1 thrust (thrust only, see rulings). Driven in a browser. |
| Shimizu / SKUNKWORKS | Ignore the hand limit when bidding or starting an auction | `:14874`, `:15057`, `:15219`, `:15381` | Yes | Yes | No | |
| NASRDA / MOONCABLE | Free 1/turn dirt refuel at LEO / Home Bernal | `:405` (`stackHasMoonCable`) | Yes | Yes | No | |
| SpaceX / MARKETEER | Highest bid wins even if tied | `:14848`, `:15120`, `:15242`, `:15371` | Yes | Yes | No (fixed) | MARKETEER-STRID fixed: the close compares ids as strings. |
| Norse / SCRUM TROUBLESHOOTERS | Glitch repair anywhere, no Human needed | `:2204`, `:2461` (`glitchTargetFor`) | Yes | Yes | No | |

The C5 faction bank (`:16170` area) is verified as in the first pass:
- a solo seat holding Taxes or Felonious opens +6;
- Secretary General opens +6 on top of its own +2;
- B612 and Marketeer open +0;
- a competitive 2-seat table pays nobody;
- co-op Altruism pays every qualifying seat.

## Promo crew

**Promo crew is released to every player (2026-11-14).** There is no admin
check and no blanket m0+m1+m2 gate any more. Each face needs only the modules
its own text uses (`needsModules` in `data/crew.js`):
- **M0:** Power Brokers, Ambassador, Rabble-Rouser, Emissaries, Arbiter.
- **M1:** Life Raft, Lifeboat, Iso-Shuttles.
- **M2:** Shuttles, Offworld Trade Nexus, Immigrant, Quest.
- **None:** the other in-scope faces.

A face whose module the room lacks is refused (`crew_face_needs_modules`) and
greyed in the picker with a "Needs M1" badge. An M4 / M5 face is refused
outright (`crew_face_needs_module`), which answers open question 4. Outside M2
the Home Bernal lock below does not apply. The rest of this section describes
an m0+m1+m2 game:
- **The M2 lock applies.** Because m2 is forced, every promo privilege read
  through `hasPrivilege` stays off until a Home Bernal is anchored. Every new
  face follows that convention, and each face's tests prove it.
- **Exempt from the M2 lock:** the Arcjets, the Nexus, Collective Bargaining's
  game-start +2 (it is paid when the draft closes, before any anchor is
  possible), and Refugee's shared Factory use (pinned to the Factory, because
  the card says "even if this card is flipped").
- **M4 (enabled 2026-11-24):** FUTURISTS, STARCHILD (JAXA) and COURIER (The
  Sea Peoples) are tagged `needsModules: ['M4']`, so they are pickable in an M4
  room only.
- **Out of scope** (tagged `requiresModule` M5): EXECUTIVE DISCOUNT, SILENT
  PARTNER, CHAIRMAN'S CUT, INCUBATOR.
- **Picker labels:** in a game a "Needs Mn" / "⚠ Mn" label shows only when the
  game lacks (or, for the caution, runs) that module; outside a game they
  always show.

| Card / privilege | Engine (`server/game/engine.js`) | Client control (`js/game/browse.js`) | Implemented? | Verified? | Bug? | Tests / note |
|---|---|---|---|---|---|---|
| The Sea Peoples / COURIER (M4) | `contractPairsOpenTo`: Connections when `hasPrivilege(COURIER)` | the Fundraise contract step opens that deck ("Connections") | Yes | Yes | No | Same as the Connections contract ability (4B2f). Engine check. |
| JAXA / FUTURISTS (M4) | `applyContractAuctionStart` (`op.futurists`, `FUTURISTS_YEARS` 6) then `resolveContractAuction` | "Win at 6" beside Auction on each open deck in the Fundraise window's contract step | Yes | Yes | No | Wins the top card at 6 years at once, no rival bids, advance paid; `no_futurists` without it. Engine check + driven in a browser. |
| JAXA / STARCHILD (M4) | `hasStarchild`: `hasBeoColony` true, `applyImplantOnCrew` skips `crew_not_at_colony`, spaceborn exomigration skips 4C2a; `applyFlipAugment` (`FLIP_AUGMENT`, `starchildUsed` 1/turn) | Augment wizard lists every Crew; "🔄 <chit>" flip buttons in Augmentations | Yes | Yes | No | Free, 1/turn, undoable; heart to Parenthood needs M2. Engine check + driven in a browser. |
| BRIN / THERMAL RESEARCH | `:3641` (`effectiveRadHardness`, key at `:3677`) | at-risk preview mirror | Yes | Yes | No | Seeded Earth belt roll. |
| BRIN / THERMAL LABS | `:9716` `thermalLabsSite`, `:9729` `applyThermalLabsFlip` (via `SET_RADIATOR_SIDE radSide:'heavy'`) | "Open to heavy (Thermal Labs)" beside "Fold to light" | Yes | Yes | No | Free, 1/turn, radiator at your Colony or Bernal. Holder vs Thermal Research face; 1/turn cap; Anarchy; M2 lock. Driven in a browser. |
| The Sea Peoples / POWER BROKERS | `:1596` `payFinao` (key at `:1608`); every FINAO charge goes through it | none needed | Yes | Yes | No | +1 per Seniority Disk on the Assembly, capped at half the FINAO paid. Checks for 1 disk, the cap, 0 disks, the Courier face, Anarchy and the M2 lock. |
| The Martian Way / ROCKETEERS | `:2563` (pad), `:5899` (belt) | none | Yes | Yes | No | |
| The Martian Way / TAILINGS REMINING | `:10425` `tailingsRemining`, spectral gate in `applyEtProduce` `:10433` | ET Produce offers C products at any Factory (`myEtProduceAnyC`) | Yes | Yes | No | Crew colocated. Holder vs Rocketeers face; non-C refused; Anarchy; M2 lock. Driven in a browser. See ruling 12. |
| Space Force / LIFE RAFT | `:1940` `lifeRaftFail`, the `asFreighter` branch of `applyMove` `:5221` | "move as a Freighter" confirm in the move flow | Yes | Yes | No | Wet mass under 5, no glory chit. Flies as a Freighter burning no fuel; refused over Net Thrust 1, at wet mass 5+, or with a chit, while Lifeboat takes 5-6 and the chit; another seat and a stack without the crew refused; Anarchy; M2 lock. Driven in a browser. |
| Space Force / LIFEBOAT | same path (`:1942`) | same | Yes | Yes | No | Wet mass under 7. |
| AEB / AMBASSADOR | `applyLobby` `:10968` (`ambassador` flag, key at `:10986`) | "Move to Centrist / Discard" second confirm after a lobby | Yes | Yes | No | Holder vs Rabble-Rouser face; a plain lobby still discards; Anarchy; M2 lock. Driven in a browser. |
| AEB / RABBLE-ROUSER | `:10963` `mayRabbleRouse` | existing | Yes | Yes | No | |
| Explorers Without Borders / SHUTTLES | `applyRefuel` `:6747` (key at `:6790`) | fuel-tank bank section opens as "Shuttles" in a Home Orbit | Yes | Yes | No | 1/turn, needs an operational thruster. Holder vs Iso-Shuttles face; cap; Anarchy; M2 lock. Driven in a browser. |
| Explorers Without Borders / ISO-SHUTTLES | `applyBoost` `:6260` (key at `:6342`), `:6429` `playerBanksIsotope` | discounted price on the boost button and dialog | Yes | Yes | No | 10 aqua off a boost operation while an isotope is banked. Driven in a browser. |
| Baltimore Gun Club / WATER ARCJET | `:5480` | none | Yes | Yes | No | |
| Baltimore Gun Club / HYDROGEN ARCJET | `:5480` | none | Yes | Yes | No | |
| African Union / EMISSARIES | `:11045` `applyEmissaries` (op `EMISSARIES`), `:10778` `emissaryLawActive` read by `playerCanUseLaw` | one "Emissaries: X as Active Law" button per tied ideology in the Assembly modal | Yes | Yes | No | Free action, own turn only, tie must still stand. Holder vs Arbiter face; untied refused; the law reaches the real law gate (Equality grant past the hand limit); not carried to the next turn; Anarchy; M2 lock. Driven in a browser. |
| African Union / ARBITER | `:11096` `applyArbiterTally` (op `ARBITER_TALLY`), `:10744` `tallyWinnersFor` (the holder's own exomigration / colony / lobby tallies), FUNDRAISE `arbiterDouble` | "Arbiter vote tally" button (start of turn) with a count-twice choice; count-twice toggle on Fundraise | Yes | Yes | No | Start of turn, once a turn. Holder vs Emissaries face; doubled vs undoubled; once and start-only; Fundraise doubling; a lobby-triggered tally doubled; Anarchy; M2 lock. Driven in a browser. |
| LEO Workers' Union / COLLECTIVE BARGAINING | `:16161` (+2), `:9276` (Murder/Suicide) | none | Yes | Yes | No (fixed) | CB-M2LOCK fixed: the +2 reads the printed face, so it is paid in a real promo game. |
| LEO Workers' Union / SITDOWN | hijack in `applyEtProduce` `:10451`; first player in `resolveRoundClose` `:13866` and `applySetFirstPlayer` | "Sitdown: ET Produce" site-popup action; first-player overlay lets the holder name themselves | Yes | Yes | No | Hijack past defending Humans (own Human present); holder chooses the 1st player. Holder vs Collective Bargaining face; Taikonaut under Anarchy still stopped by defenders; Anarchy; M2 lock. Driven in a browser. |
| Makers Guild / OFFWORLD TRADE NEXUS | `:13321` | none | Yes | Yes | No | |
| Makers Guild / TRADE PORT | `:15006` `applyTradePort` (op `TRADE_PORT`) | "Trade Port (free)" in the Operations menu, picker for 2 hand cards and a deck | Yes | Yes | No | Start of turn, once, free, not undoable. Holder vs Nexus face; wrong card count; mid-turn refused; Anarchy; M2 lock. Driven in a browser. |
| New Pilgrims / REFUGEE | `applyIndustrialize` `:10187` (key at `:10209`) | "Industrialize (Refugee)" in the site popup | Yes | Yes | No | Not a Felony; the Claim owner keeps a standing, non-revocable Factory-use grant. Holder vs Immigrant face; Anarchy; M2 lock; the shared use survives a flip; the owner can refuel there. Driven in a browser. |
| New Pilgrims / IMMIGRANT | `exomigrateOne` `:8217` (key at `:8304`) | specialty selector in the exomigrate modal | Yes | Yes | No | The first Human with the named specialty arrives, then the queue shuffles (still an undo barrier). Holder vs Refugee face and a core faction; Anarchy; M2 lock. Driven in a browser. |
| Utopia, Inc. / PIGGYBACK | `:6446` `openPiggybackWindow`, `:6461` `applyPiggyback` (op `PIGGYBACK`, off turn), `:13040` `applyPiggybackReplay` | prompt when an opponent's boost opens the window; also in the Operations menu | Yes | Yes | No | Free, up to the boosted mass, any time before the booster's turn ends. The triggering boost then cannot be undone. Holder vs other face; mass cap; window closes; undo safety; Anarchy; M2 lock. Driven in a browser with two seats. |
| Galahad Group / HEROIC | `:747` `heroicCarrierId` (glory carry), honor lobby in `applyLobby` (`:10999`) | glory-carry count mirror; lobby text says the delegate stays | Yes | Yes | No | Holder vs Quest face; a freedom lobby still discards; Anarchy; M2 lock for both halves. Driven in a browser. |
| Galahad Group / QUEST | `exomigrateOne` `:8217` (key at `:8251`, `to: 'colony:<slug>'`) | Quest Colony destinations in the exomigrate modal | Yes | Yes | No | Any Colony in a zone where you hold a glory chit. Holder vs Heroic face; no-chit and no-Colony refusals; Anarchy; M2 lock. Driven in a browser. |
| VerisAI / CAVITATION ENGINEERS | `:1970` `cavitationIgnores`, in `applyMove` and `aerobrakeParkingHazard` `:13341` | hazard checklist drops the ignored aerobrake | Yes | Yes | No | First aerobrake each turn, rocket only. Holder vs Incubator face (out of scope, so it does nothing); once per turn; Anarchy; M2 lock. The checklist change was not driven in a browser. |
| Heliocentricity / WEAK STABILITY BOUNDARY | `applyMove` `wsb` path `:5239` (key at `:5241`) | "Coast again" confirm after a move | Yes | Yes | No | Coast only, once per turn, after the move is spent; the Sundiver becomes the active thruster. Holder vs Power Series face; must coast; once; Anarchy; M2 lock. Driven in a browser. |
| Heliocentricity / POWER SERIES CHAOS MODEL | `:1962` `chaosModelImmune` over `data/hazard-flavors.js` (flavours from the board captions in `data/map-labels.js`) | hazard checklist drops immune hazards | Yes | Yes | No | Rocket and Freighter moves plus parked descents. Holder vs WSB face; every captioned board hazard walked (39 immune, 43 roll); Anarchy; M2 lock. The checklist change was not driven in a browser. See ruling 9. |
| Cerulean / BLUE PLANET | `:1984` `applyBluePlanetFinao` via `END_TURN bluePlanet:true`, and the parked-descent skip in `aerobrakeParkingHazard` | Blue Planet choice before ending a turn on an aerobrake | Yes | Yes | No | Pays 1 aqua for the descent roll and loads 1 FT. Holder vs Dowsers face; Anarchy; M2 lock. Driven in a browser. |
| Cerulean / DOWSERS | `:11391` | existing | Yes | Yes | No | |

## Bugs found in the first pass (all FIXED 2026-11-14)

Each `KNOWN BUG` check was promoted to a plain check and now passes.

1. **LAUNCH-FEES-PER-OP** (`engine.js:6417`). Before: each BOOST op paid,
   so three one-card boosts paid NASA 3. Now: pays only when the turn has
   not boosted yet, i.e. once per boost operation.
   - Ruling: a solitaire Launch Contracts boost still counts as that
     operation.
   - A Piggyback is not a boost operation and pays nothing.
2. **CB-M2LOCK** (`engine.js:16161`). The draft-close +2 now reads the printed
   face (`playerOwnsAbility`, guarded against Anarchy) instead of
   `playersWithPrivilege`, whose M2 lock emptied the list in every legal promo
   game.
3. **MARKETEER-STRID** (`engine.js:15373`). Before: `Number(mktPid) !==
   buyerId`. Now: a `String()` comparison, so a non-numeric seat id (tutorial
   bots) can be sold the tied lot.
4. **POWERSAT-ANY** (`engine.js:1871` / `:1887`). The ESA holder now keeps a
   public, standing list of rivals they beam.
   - It is set with the off-turn `POWERSAT_BEAM { targetId, on }` op. Like
     `SET_CARD_GROUPS`, it runs against the caller on or off turn, stays off the
     undo stack, and is carried across an undo by `carryOffTurnRoutes`.
   - The client's roster row shows a 🛰 toggle beside the trade button for a
     holder whose privilege is live, and a "Beamed" badge on the beamed player.
   - The beamed player's own thrust read (rocket and Freighter) includes the +1,
     so client and server stay byte-identical.
   - Exercised over the real local route: the target's thrust read 2, then 3
     with the beam, then 2 after it was switched off; a non-holder was refused
     `no_powersat`. The button was also driven in headless Chromium.

## Other findings (not crew-engine bugs)

- **`scripts/check-engine.mjs` has 12 checks after its exit gate** (unchanged;
  still worth moving the gate to the end of the file).
- **ET Production now checks the product's spectral type against the Factory's
  for every player.** Before, only the client checked. The engine needed the
  check before Tailings Remining could relax it. It skips 'any' cards, a Factory
  with no spectral type on record, and undo replays. A table that relied on the
  server gap is now refused `wrong_spectral`.
- **Possible transcription error in `data/crew.js`:** the Norse blurb ends
  "Only 1 dirt tank refuel per turn.", copied from NASRDA. Not checked
  against the card image.
- **Arcjet vs Eugenic Pilgrims:** the Arcjet reads `state.anarchy` directly,
  so `privilegeInAnarchy` does not keep it. Not tested.

## Open questions (rulings for the user)

Carried over from the first pass:

1. Should promo privileges be exempt from the M2 lock? Today every new face
   follows the lock, as the first eight did. A real promo game therefore has
   them off until a Home Bernal anchors.
2. Secretary General under M2 with Anarchy at the first anchor: paid later
   (current), paid regardless, or forfeited?
3. Dharma Refuel: must the chit-carrying Human be colocated with the refuel?
4. ~~Should PICK_CREW refuse an out-of-scope (M4 / M5) face?~~ Done
   2026-11-14: refused per face (`crew_face_needs_module`).

Rulings made while building the 21 faces (most faithful reading taken; each
can be flipped):

5. **Powersat beam:** a beamed rival gets the +1 PUSH THRUST only, not the Safe
   Factory-Assist half. "Negotiable" is served by the trade system plus the
   on/off toggle; the engine never forces a payment. The ESA holder's own +1
   stays automatic.
6. **Life Raft / Lifeboat:** "the stack" is the stack carrying the Space Force
   card, so the card must be aboard. The move keeps the rocket's own per-card
   radiation rolls at thrust 1, instead of the Freighter's "cargo takes a
   glitch" rule.
7. **Weak Stability Boundary:** the second movement is allowed only after the
   normal move is spent this turn. It gets past the No Double Moves lock and
   leaves the Sundiver active afterwards.
8. **Cavitation Engineers:** applies to the rocket only, not a Freighter,
   Bernal or Mobile Factory. A parked turn-start descent uses that turn's
   ignore.
9. **Power Series Chaos Model:** the hazard's flavour is read off the caption
   the published board prints beside it. Every hazard, radiation-belt, aerobrake
   and lander-burn caption was transcribed from the board image into
   `data/map-labels.js` (reviewed by the user against an overlay of the board,
   2026-11-14).
   - Of the 82 captioned skull hazards, 39 mention geysers, rings, spin or winds
     and are immune; the other 43 roll as normal. A check walks every one.
   - Only Hazards count. A radiation belt captioned "dust ring" is a Belt Roll,
     not a Hazard, so it is not covered.
   - Immunity covers the rocket and Freighter, not Bernals.
10. **Blue Planet:** "ending turn on an aerobrake" settles the NEXT turn's
    descent roll at END_TURN for 1 aqua. The 1 FT is one refuel step and is lost
    if the tank is full. The arrival roll is not discounted.
11. **Shuttles:** a "Home Orbit" is any space tagged as a Home Bernal anchor
    site. At LEO and your own Home Bernal it adds nothing, because the bank
    already reaches them.
12. **Iso-Shuttles:** the isotope must be present but is not spent. The isovault
    and paying a boost in isotope are Module 4, so only the 10-aqua discount
    applies, once per boost operation.
13. **Piggyback:**
    - It takes ordinary cards only (no Bernals, colonists, GW thrusters or
      Freighters), landing in LEO.
    - "Immediately" means any time before the booster's turn ends; several
      boosts in one turn add up.
    - It pays no Launch Fees and does not open a further window.
    - A taken piggyback makes the triggering boost un-undoable.
14. **Trade Port:**
    - "Start of your turn" means operation and move both unspent, with only
      route, wiring, card groups, Arbiter or Emissaries taken so far.
    - It may draw from any auctionable deck, M1 and M2 decks included, within
      ownership limits.
15. **Thermal Labs:** a Bernal counts whether anchored or mobile. So does any
    stack sharing a Bernal's space.
16. **Tailings Remining:** see the spectral-gate note above. The card waives
    only the Factory's spectral match for a C product.
17. **Arbiter:**
    - Doubling covers the start-of-turn tally, Fundraise, and every tally the
      holder's own action triggers (exomigration, a Colony delegate, a Lobby).
      Those mid-op tallies cannot pause for a choice, so they always double.
    - The start-of-turn tally doubles by default; Fundraise doubling is opt-in.
18. **Emissaries:**
    - A tied Unity treated as the Active Law does not switch on Unity's
      knock-on laws.
    - Only rules read through `playerCanUseLaw` see the choice.
19. **Power Brokers:** counts only disks already on the Assembly, not ones
    still on the Sunspot track.
20. **Ambassador:** runs a quiet vote tally after the delegate crosses to
    Centrist (a tie leaves the star). A plain lobby still runs none.
21. **Heroic:** the carry limit lifts only for the Galahad crew card itself,
    not the crew's other Humans.
22. **Sitdown:**
    - "Factory hijack" grants that one felony outside Anarchy, the way
      Collective Bargaining grants Murder/Suicide.
    - The holder may name themselves first player. Climate Control and Martial
      Law still take priority.
23. **Quest:** an opponent's Colony counts too. "Hold a glory chit" counts
    carried and banked chits.
24. **Immigrant:** with no match the queue is still shuffled. A Robot counts as
    a Human only after Robot Emancipation.
25. **Refugee:** the Claim owner's share is not revocable. It rides the ordinary
    Factory-use grant and ends if the Factory cube relocates.
