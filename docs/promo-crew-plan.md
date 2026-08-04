# Promo crew plan

Status board for the 18 promo crew cards (print-sheet cards 387-404) sitting in
`data/crew.js#PROMO_CREW`. Same purpose as `docs/variants-tracker.md`: one
place to see what's actually built versus what's just data sitting in the
Library, so a future session doesn't have to re-derive it from the card text.

## Where this stands today

**Eight faces across seven cards have engine rules.** Counted at FACE level,
which is the only count that means anything here: the 18 cards carry 36 faces
and the two faces of a card are independent abilities.

| Ability | Card / face | What it does now | Code |
|---|---|---|---|
| ROCKETEERS | The Martian Way, white | Immune to pad explosions: `exposedAtLeo` returns nothing for the player, so neither the LEO pile nor a stack parked on the pad is ever exposed. Plus -2 to Belt Rolls in the **Earth zone only**, looked up per hazard node. | `engine.js#exposedAtLeo`, the rad-roll loop in the MOVE resolver |
| THERMAL RESEARCH | BRIN, white | Radiators read +2 rad-hardness during a Belt Roll. A read-time modifier like the Sirenian rule beside it - the card's printed data is never rewritten. | `engine.js#effectiveRadHardness`, mirrored in the client's at-risk preview (`browse.js#radStackCards`) |
| WATER ARCJET | Baltimore Gun Club, white | A colocated thruster gets one bonus burn when the move starts at LEO. Read off the card being ABOARD, not off the player, because the printed text says "colocated"; Anarchy still suspends it, the M2 privilege lock deliberately does not apply (same exemption as the Nexus). | the arcjet credit in `engine.js#applyMove` |
| HYDROGEN ARCJET | Baltimore Gun Club, black | The same bonus burn, also credited at the player's own anchored Bernal or Factory. | same block |
| RABBLE-ROUSER | AEB, black | Lobbying authority in season blue may start or end Anarchy. Note the printed title keeps its HYPHEN through `privKey` (which only folds whitespace), so the gate reads `'RABBLE-ROUSER'`, not `RABBLE_ROUSER`. | `engine.js#applyLobby` |
| COLLECTIVE BARGAINING | LEO Workers' Union, white | +2 aqua when the crew draft closes (no Module 2 deferral, unlike Secretary General), and permission to commit Murder/Suicide - JUST that one felony, not the full Felonious privilege. | `engine.js#applyDecommission` colonist branch, plus the crew-draft-close grant |
| OFFWORLD TRADE NEXUS | Makers Guild, white | Bernal Profits (+1 aqua at turn start) from ANY anchored Bernal or any Factory, not just a Home Bernal. Same +1, wider set of holdings. | `engine.js#openTurnFor` |
| DOWSERS | Cerulean, black | ISRU refuel for **water** resolves at ISRU 0, so the rig's own rating and every colocated modifier stop mattering, and a rig can never be "too high" for the site. The isotope branch is untouched. | `engine.js#applySiteRefuel`, mirrored in `browse.js#pickRefiningSource` |

Each is covered by a check in `scripts/check-engine.mjs` that was shown to FAIL
when its rule is stubbed out.

**Two of these were reachable only on paper until 2026-08-04.** DOWSERS was
implemented server-side but the client's own `isru <= hydration` gate refused
the refuel before the op was ever posted, so the one case the ability exists to
allow could not be reached through the UI at all; and THERMAL RESEARCH was
missing from the client's belt-roll at-risk preview, so a BRIN player was shown
radiators as doomed that the belt would actually spare. Both now mirror the
server rule. The lesson generalises: **a promo ability is not done when the
engine honours it - the client has its own copy of every gate, and a rule that
only one side knows about is a rule the player cannot use.** Check the client
mirror for every ability below before calling it shipped.

**One structural finding fell out of building these.** M2 LOCKS faction
privileges until the player has an anchored Home Bernal (2B3b,
`engine.js#factionPrivilegesLocked`), and the promo gate FORCES m0+m1+m2 - so
in the only configuration where a promo card can be picked at all, its
privilege is dead until a Home Bernal is anchored. That is consistent (the lock
applies to every faction), and the three rules above live with it. The
exception is OFFWORLD TRADE NEXUS, which is read WITHOUT the lock: it only
widens who earns Bernal Profits, so under the lock it could not switch on until
a Home Bernal was anchored, at which point Home Bernal Profits is already
paying and the widening could never do anything. Anarchy still suspends it.

Worth deciding before more promo abilities land: should promo picks be exempt
from the M2 lock generally, or is "anchor first, then your privilege works" the
intended reading for these cards too?

**Everything else is data only.** Landed in `4cfa365` (2026-07-23), transcribed
from the "cool - crew cards" reference spreadsheet. What exists:

- All 18 cards render in the card **Library** (`CREW_FACES` in `data/crew.js`),
  browsable by anyone, with an informational badge when the card carries
  `requiresModule` or `notRecommendedWithModule`.
- **Nothing else.** They are deliberately kept out of `FACTIONS` and
  `PLAYER_COLORS` (`data/crew.js:97-103`), so the starting-crew wizard never
  offers one to a real player - the base six are still the only pickable
  factions in every game mode this project ships.

**How the admin gate works** (this is what "admin-gated" means for these
cards specifically - it is not the same shape as the Sirens/Hermes
admin-or-tester gate):

- `server/index.js:2729` sets `ctx.allowPromoCrew = profileIsAdmin(req.profile, req)`
  on every `PICK_CREW` op. There is no tester equivalent for this one.
- `server/game/engine.js:12160-12182` (`applyPickCrew`) then:
  1. Lets an admin's promo pick through the draft-window check at any time
     (`isPromoPick`), which a normal pick can't do.
  2. Refuses a promo `cardId` outright (`promo_crew_admin_only`) unless
     `ctx.allowPromoCrew` is set.
  3. **Even for an admin**, refuses it (`promo_crew_needs_modules`) unless the
     room runs the full `state.m0 && state.m1 && state.m2` stack.

That third rule is a **blanket** gate: every promo card needs all three
modules to be pick-able at all, regardless of what that specific card's
ability actually touches. Only 5 of the 18 cards declare a `requiresModule`
tag (see the table). The blanket gate is stricter than the per-card tags
suggest - see "Known gap" below.

This whole path exists so an admin can drop one of these into a real seat and
look at it, not as a release-readiness gate the way Sirens/Hermes's was. A
successful admin pick now DOES affect play for the eight faces in the table
at the top (and only those); every other promo face is still ability text with
nothing behind it. No ordinary player can reach any of it - the crew wizard
still offers the base six only.

## Status legend

| Mark | Meaning |
|---|---|
| DATA | Card text transcribed, nothing else |
| M4 | Ability needs Module 4 (Exodus) machinery this codebase doesn't have |
| M5 | Ability needs Module 5 (a stock-market economy) - **no rules text for M5 exists anywhere in this repo** (see below) |
| CORE-ISH | Ability reads as buildable against systems ALREADY in this codebase (M0/M1/M2/hazards/glory), once someone writes the engine rule |
| PART BUILT | At least one face has a real engine rule now - see the shipped table at the top for which |
| NEW | Ability needs an engine mechanic this codebase has never modeled, independent of any module |

## The 18 cards

| Card | Data tag | Verdict | Notes |
|---|---|---|---|
| BRIN | - | PART BUILT | Both faces lean on the existing Belt Roll / radiator-flip mechanics (rad-hard bonus during a roll; free flip to heavy at a Colony/Bernal). |
| The Sea Peoples | `requiresModule: M4` | M4 | "Connections (4B2f)" is a **Contract Ability** - M4's contract-deck/contract-auction sub-system (`reference/manuals/branch-module-4.md:77`), which this codebase does not implement at all. |
| The Martian Way | - | PART BUILT | Rocketeers uses the existing hazard system (pad explosion/debris immunity, Belt Roll modifier); Tailings Remining is a variant of the existing `ET_PRODUCE` op (produce Spectral C anywhere while colocated). |
| JAXA | `requiresModule: M4` | M4 | Futurists names a "contract auction" (same M4 contract-deck system as Sea Peoples); Starchild references BEO Colony requirements and "augmentations", neither of which exist in this codebase. |
| Space Force | - | CORE-ISH (M1) | Both faces are a Freighter-style move (1B4) gated on stack wet mass - the Freighter move mechanic already exists under M1. |
| AEB | - | CORE-ISH (M0) | Both faces are Sol Political Assembly plays (lobby, delegate placement, anarchy) - M0 politics already ships. |
| Explorers Without Borders | `notRecommendedWithModule: M5` | CORE-ISH (M1) | Shuttles/Iso-Shuttles use cargo transfer + the isotope bank/isovault from M1 Terawatt. The M5 tag here is a BALANCE warning (M5 changes the Aqua economy), not a hard requirement - unlike the 5 `requiresModule` cards, this one doesn't need a module that doesn't exist. |
| Baltimore Gun Club | - | CORE-ISH | A bonus-burn-from-LEO/Bernal/Factory modifier on a colocated thruster; no thruster of its own (mirrors the Shimizu pattern). No module dependency legible in the text. |
| African Union Space Directorate | - | CORE-ISH (M0) | Emissaries/Arbiter are Active-Law and vote-tally plays - M0 politics already ships. |
| LEO Workers' Union | - | NEW | Collective Bargaining's aqua bonus is easy (mirrors the existing Secretary-General/base-solitaire aqua grants), but "may commit Murder/Suicide" and Sitdown's "Factory hijack, even with an opponent's Humans present" are mechanics this codebase has never modeled. `Murder` shows up in the core rulebook as a Felony category (`reference/manuals/branch-shared-core.md:105`, defined by contrast with Workforce) but there's no engine op for it yet. |
| Makers Guild | `notRecommendedWithModule: M5` | PART BUILT | Offworld Trade Nexus widens the ALREADY-IMPLEMENTED Home Bernal Profits rule (2B3d, `server/game/engine.js:9801`) from "Home Bernal only" to "any Factory or Anchored Bernal" - genuinely small. Trade Port (discard 2 for a deck's top card) is a new but simple op. |
| New Pilgrims | - | CORE-ISH (M2) | Immigrant's specialty-search exomigration builds on the M2 colonist-specialty system already in place. Refugee's "industrialize an opponent's Claim, shared Factory use" has a head start: `REQUEST_FACTORY_USE` / `GRANT_FACTORY_USE` / `DENY_FACTORY_USE` / `REVOKE_FACTORY_USE` ops already exist (see `MP_LOG_ICONS` in `js/game/browse.js`) for shared factory use - the "industrialize a Claim you don't own, without it being a Felony" half is new. |
| Utopia, Inc. | `requiresModule: M5` | M5 | Company "price" tiers - the stock-market economy. |
| Galahad Group | - | CORE-ISH (M0+M2) | Heroic (unlimited glory-chit carry, honor-lobby without losing a delegate) and Quest (exomigrate into a zone you hold a glory chit) both compose existing glory-chit + M0 + M2 machinery. |
| Brotherhood of Cryptobankers | `requiresModule: M5` | M5 | "Angel a company", "chair a company", "dividend payout" - stock-market economy. |
| VerisAI | `requiresModule: M5` | M5 | Incubator ("splinter a company") is pure M5. Cavitation Engineers (ignore one Aerobrake/turn) is CORE-ISH on its own (aerobrake handling already exists) but the card is a package deal. |
| Heliocentricity | - | NEW | Weak Stability Boundary ("activate this thruster to coast as a second movement" after the stack already moved) and Power Series Chaos Model (hazard-category immunity: geysers/rings/spin/winds) are both mechanics this codebase hasn't modeled - a second move-phase and a hazard-tag immunity system. |
| Cerulean | `notRecommendedWithModule: M5` | PART BUILT | Blue Planet (FINAO cost/yield tweak on an aerobrake hazard) and Dowsers (ISRU refuel at ISRU 0) both read as small modifiers to existing FINAO/ISRU rules. |

**This card-level split is superseded** by the face-level table below, which was
audited against the source. It is kept only because the per-card notes are still
useful reading. Where the two disagree, the face-level one is right.

## Face-level triage (2026-08-04)

The per-card table above is a first read. This one is the audited version, done
at FACE level with the concrete hook named for each, every claim checked against
the source. **36 faces = 8 implemented + 18 buildable now + 4 need M4 + 4 need
M5 + 2 need a mechanic this codebase has never modeled.** At CARD level: 1 card
is finished on both faces (Baltimore Gun Club), 6 have one face done, and 11
have nothing yet, so **17 of the 18 cards are still incomplete** (Heliocentricity's
Power Series Chaos Model, which wants a hazard FLAVOUR - geysers / rings / spin
/ winds - that the map data does not carry, `hazardKind` returning only
rad/aero/skull; and Utopia Inc.'s Piggyback, which wants a reactive out-of-turn
interrupt window that no op has ever had).

Where the card-level table above and this one disagree, this one is right:
it was checked by computing the `privKey` of all 36 faces, grepping the engine
for each, and grepping all 18 card ids to catch anything wired by card id
instead of by privilege.

**Buildable now, with the hook each one extends:**

| Card / face | Ability | Hook it extends |
|---|---|---|
| BRIN, black | THERMAL LABS | `applySetRadiatorSide` is one-way (light only); add the heavy direction plus colocation and a once-per-turn flag |
| The Sea Peoples, black | POWER BROKERS | `finaoPerFor` and the three sites that charge FINAO; seniority disks already sit in `asm.seniority` |
| The Martian Way, black | TAILINGS REMINING | its twin already ships as the `etProduceCAnywhere` colonist power (client-side gate only today) |
| Space Force, both | LIFE RAFT / LIFEBOAT | `applyMoveFreighter` plus the freighter landing exception in `maneuverGate`; one path, threshold differs by face |
| AEB, white | AMBASSADOR | `applyLobby`'s delegate removal, which already has a keep-the-delegate variant |
| Explorers Without Borders, white | SHUTTLES | `applyRefuel` is already bank-aqua-to-tank; widen the location set, add a 1/turn cap |
| African Union, white | EMISSARIES | `playerCanUseLaw`; the tie set is already computed by `voteWinners` / `finalVote().tied` |
| African Union, black | ARBITER | `quietVoteTally` plus `playerDelegatesInPlace` for the doubling |
| LEO Workers' Union, black | SITDOWN | the `factory_defended` check in `applyEtProduce`; first-player choice already exists |
| Makers Guild, black | TRADE PORT | the Equality Research Grants branch of `applyAuctionStart` is the same "pay, take the top card" shape |
| New Pilgrims, white | REFUGEE | the `not_claimed` owner check in `applyIndustrialize`; shared use already rides `fac.grants` |
| New Pilgrims, black | IMMIGRANT | `exomigrateOne` off `colonistQueueFor`; the hidden-pile search precedent is Renaissance Man |
| Galahad Group, white | HEROIC | the `gloryCarriers` limit in `applyLoadGlory`; keep-a-delegate lobby already exists for a Future |
| Galahad Group, black | QUEST | `exomigrateOne`'s destination switch, which today accepts only LEO and a Bernal |
| VerisAI, black | CAVITATION ENGINEERS | `stackSafeAerobrake`; once-per-turn flag pattern is `afterburnEngaged`. NOTE the card's OTHER face is M5, but this one needs nothing from it |
| Heliocentricity, white | WEAK STABILITY BOUNDARY | a `movesRemaining` bump, not a new move phase; per-unit precedents already exist |
| Cerulean, white | BLUE PLANET | `finaoPerFor` already stacks two modifiers; parking on an aerobrake is modelled by `aerobrakeParkingHazard` |

Two corrections to the card table above that fall out of this: **LEO Workers'
Union is not NEW** (both COLLECTIVE BARGAINING clauses ship, and SITDOWN has a
concrete hook), and **Heliocentricity is only half NEW** (Weak Stability
Boundary is a counter bump).

## An important fact for anyone picking this up

**M5 has no transcribed rules text anywhere in this repository.**
`reference/manuals/` has a `branch-module-4.md` (Exodus: augmentation,
cybernetics, isotope/starship economy - the module these promo cards actually
reference), but no `branch-module-5.md`. The 4 M5-tagged cards (Utopia Inc.,
Brotherhood of Cryptobankers, VerisAI, and Explorers Without Borders /
Makers Guild / Cerulean's "not recommended with" warning) are gesturing at a
whole economic layer (companies, shares, dividends, splintering, angeling)
that isn't documented here at all. Building M5 support starts with sourcing
those rules, not with this card set.

M4 (`branch-module-4.md`) at least has real rules text checked in, so the
5 M4-tagged cards have somewhere to start.

## Known gap: blanket gate vs. per-card tags

The engine's `promo_crew_needs_modules` check (`server/game/engine.js:12181`)
requires `state.m0 && state.m1 && state.m2` for **any** promo pick, but only 5
of the 18 cards carry a `requiresModule` tag, and none of the tags are
`m0`/`m1`/`m2` (they're all `M4`/`M5`, modules that don't exist in this
codebase's flag scheme at all - `state.m4`/`state.m5` don't exist). So today:

- A CORE-ISH card like BRIN or Baltimore Gun Club is blocked behind M0+M1+M2
  even though its ability doesn't obviously need any of them.
- An M4/M5-tagged card is blocked behind M0+M1+M2, which is the WRONG set of
  modules for what it actually needs (M4 requires M0 per the manual, per
  `branch-module-4.md:5`; M5's requirements aren't documented here).

This was presumably a "good enough for an admin's own test pick" shortcut
when the card set landed, not a considered per-card gate. Worth a decision
before this goes any further: keep the blanket gate (simplest, and arguably
correct since none of these cards are reachable by a real player anyway), or
move to a real per-card `requiresModule` check once `state.m4`/`state.m5`
exist.

## Open questions

Nothing below has been decided - these are the calls a future session (or the
user) needs to make before promo crew becomes more than Library decoration:

1. **Is Module 4 in scope at all?** `CLAUDE.md`'s "Variants we target" section
   scopes this project to Standard + CEO Solitaire; M0/M1/M2 shipped as
   incremental widenings of that scope, but M3 (Conflict) and M4 (Exodus)
   have never been discussed as a target. If M4 is out of scope, the 5
   M4-tagged cards (plus JAXA's augmentation half) stay Library-only
   indefinitely, which is a fine outcome - just needs saying explicitly the
   way V4 Altruism's "no flag yet" status is said in the variants tracker.
2. **Is Module 5 even wanted?** Given there's no rules text for it in the
   repo, building it means transcribing/sourcing the M5 rulebook section
   first. That's a bigger ask than anything else in this doc.
3. **The CORE-ISH cards are a first read, not a verified reading.** Each one
   needs its rule text checked against the actual HF4 core rules PDF (see
   `CLAUDE.md`'s reference links) before anyone writes engine code against my
   "CORE-ISH" label above - a couple of these (Baltimore Gun Club, LEO
   Workers' Union's "Murder/Suicide") are guesses from the card text alone.
4. **If any of these ship, do they get a seventh+ faction slot, or replace one
   of the six?** `PLAYER_COLORS`/`FACTIONS` assume exactly six seats
   (`data/crew.js:97-103`, `server/game/state.js`'s seat-colour shuffle) - a
   promo faction becoming pickable is a bigger structural change than adding
   a card, since the whole seat-colour pipeline is sized to six.
5. **Should the blanket `promo_crew_needs_modules` gate be replaced with a
   real per-card one?** See "Known gap" above.

## Verification note

Nothing in this doc has shipped a rule - it's a status snapshot + triage, not
an implementation record. When any of these cards move past Library-only,
follow the same discipline as everything else in this repo: land the flag
first, gate every code path on it, and exercise the change against a real
server before it's called done (see CLAUDE.md's "EXERCISE every change BEFORE
pushing").
