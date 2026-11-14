# Crew faction ability audit (2026-11-14)

Every crew faction privilege (the `bonus` / `blurb` on each face in
`data/crew.js`) checked against the server engine. Tests only: **no engine
behaviour was changed in this pass.** The fixes proposed below are for the user
to accept or reject.

- Tests: `scripts/check-crew-abilities.mjs` (sits beside the CI engine smoke
  `scripts/check-engine.mjs`, which is the repo's engine-test convention; there
  is no `tests/` folder). Run `node scripts/check-crew-abilities.mjs`. It needs
  the vendored map: `git submodule update --init vendor/hf-mission-planner`
  (without it the planner graph loads 0 nodes and dozens of checks in BOTH
  scripts fail for reasons unrelated to crew).
- Result: **57 ok, 0 failed, 4 known bugs.** A known bug is a check that
  asserts the correct behaviour and fails today; it prints `KNOWN BUG [id]` and
  does not fail the run. When the engine is fixed it prints `FIXED [id]` and
  should be promoted to a plain check. `--strict` makes known bugs fail the run.
- The script is NOT wired into CI (`.github/workflows/deploy.yml`). Add it next
  to `check-engine.mjs` if you want it gating.

## How the checks were made trustworthy

Each check compares a holder against a control: the SAME seat on the OTHER face
of the same physical card, or the holder on another seat. Disabled conditions
covered across the set: Anarchy (K2e, `state.anarchy`), the Module 2 lock
(2B3b, privileges dead until a Home Bernal is anchored), solo vs multiplayer,
and the C5 faction bank.

Mutation sweep (run against a scratch copy of the engine, never the repo):

- Renaming each privilege key in `engine.js` (e.g. `'TAXES'` -> `'TAXES_STUB'`)
  turns at least one check red for EVERY implemented key, plus the Baltimore Gun
  Club card-id read.
- Deleting the Anarchy line in `privilegeOf` turns 16 checks red; making
  `factionPrivilegesLocked` always false turns 6 red.
- Applying each proposed fix below turns its `KNOWN BUG` into `FIXED` with the
  other 57 checks still green.

## Core crew (12 faces)

| Faction / privilege | Rule (blurb) | Engine | Implemented? | Verified? | Bug? | Note |
|---|---|---|---|---|---|---|
| UN Cosmonauts / SECRETARY GENERAL | +2 aqua at start (M2: after the 1st Home Bernal anchor) | `engine.js:15416` (draft close), `:8586` (M2 anchor) | Yes | Yes | No | +2 once at draft close, no double pay on re-pick; under M2 no opening credit and +2 on the first Home Bernal anchor only. Anarchy at that anchor pays nothing and leaves it owed for a later anchor (ruling call, see Open questions). |
| B612 Foundation / BLINK TELESCOPE | 1 re-roll per prospecting op with a Raygun | `engine.js:9637` | Yes | Yes | No | Raygun scan marked re-rollable; UN face not; off under Anarchy and the M2 lock. |
| Roscosmos / TAXES | +1 aqua when any player places or industrializes a Claim | `engine.js:1828` via `:9658`, `:9711`, `:9920`, `:9959` | Yes | Yes | No | Pays on an opponent's Claim, on its own Claim, on an opponent's Industrialize; nobody else paid; off under Anarchy. |
| Taikonauts / FELONIOUS | Your Humans may commit Felonies | `engine.js:1821` (`mayCommitFelony`) | Yes | Yes | No | Claim Jump allowed for Taikonauts, refused for Roscosmos (`felonies_not_allowed`), still needs a Human (`felony_needs_human`); Anarchy opens it to everyone. |
| NASA / LAUNCH FEES | +1 aqua after any player performs a boost operation | `engine.js:6172` | Yes | Yes | **Yes** | Pays on any boost, own included, off under Anarchy and the M2 lock. Bug LAUNCH-FEES-PER-OP: pays per BOOST op, not per boost operation. |
| ISRO / DHARMA REFUEL | Humans carry a glory chit -> double site refuel | `engine.js:10790` (rocket), `:10632` (outpost) | Yes | Yes | No | Factory refuel doubled with a chit, not without, not for NASA, off under Anarchy. Reads "any chit carried anywhere", not "the chit-carrying Human is colocated" (see Open questions). |
| Anonymous P2P / OPEN SOURCE FINAO | FINAO costs 3 aqua | `engine.js:1566` (`finaoPerFor`) | Yes | Yes | No | 3 per hazard vs 4 for ESA, across a 2-hazard route; back to 4 under Anarchy. |
| ESA / POWERSAT | +1 thrust to ANY push-icon spacecraft, any player's turn. Negotiable | `engine.js:1813` (`hasPowersat`), `:3314` | Partial | Yes (own craft) | Gap | +1 to the ESA player's own push thruster, off under Anarchy. It cannot be offered to a rival's craft except by lending the ability through a trade. Recorded as POWERSAT-ANY. |
| Shimizu / SKUNKWORKS | Ignore the hand limit when bidding or starting an auction | `engine.js:14330`, `:14492`, `:14199`, `:14652` | Yes | Yes | No | Start and bid at 4 cards; NASRDA refused `hand_limit`; off under Anarchy. |
| NASRDA / MOONCABLE | Free 1/turn dirt refuel at LEO / Home Bernal | `engine.js:408` (`stackHasMoonCable`) | Yes | Yes | No | Free action (no op spent), 7 tanks; Shimizu refused; off under Anarchy and the M2 lock, back on with a Home Bernal. The 1-tank crew-thruster and 1/turn caps are covered in `check-engine.mjs`. |
| SpaceX / MARKETEER | Highest bid wins even if tied | `engine.js:14174` (leader), `:14645` (close), `:14237`, `:14515` | Yes | Yes | **Yes** | Wins a tie over the auctioneer, the auctioneer can't keep it (`marketeer_wins_tie`); Norse loses the tie; off under Anarchy. Bug MARKETEER-STRID: a non-numeric profileId can't be sold the lot. |
| Norse / SCRUM TROUBLESHOOTERS | Glitch repair anywhere, no Human needed | `engine.js:2027` (`autoFixGlitches`), `:2289` (`glitchTargetFor`) | Yes | Yes | No | Remote repair of an uncrewed glitch; the Glitch event never targets Norse; both off under Anarchy. The immunity goes beyond the printed text, but it works out the same as repairing right away. |

Faction bank (C5, `engine.js:15447`), verified: a solo seat on Taxes or
Felonious opens +6, Secretary General +6 on top of its own +2, B612 and
Marketeer +0. Under M2 the solo bank still pays (SG's own +2 waits for the
anchor). A competitive 2-seat table pays nobody. Co-op Altruism pays each
qualifying seat. CEO Solitaire is covered in `check-engine.mjs`.

## Promo crew

Promo picks need `ctx.allowPromoCrew` (admin) and m0+m1+m2. Verified:
non-admin -> `promo_crew_admin_only`, admin without m2 ->
`promo_crew_needs_modules`. **Because m2 is forced, the M2 lock applies to every
promo privilege read through `hasPrivilege`**: each one stays off until a Home
Bernal is anchored. That holds for ROCKETEERS, THERMAL RESEARCH, RABBLE-ROUSER,
COLLECTIVE BARGAINING and DOWSERS. The Arcjets and the Nexus are deliberately
exempt.

Module tags are judged PER FACE (`data/crew.js`, commit 9084b63, user
2026-11-14): each side of a promo card is in or out of scope on its own ability
text. Out of scope (`requiresModule` M4 / M5 on that face, "Coming soon", not
tested): The Sea Peoples / COURIER, JAXA / FUTURISTS, JAXA / STARCHILD,
Utopia Inc. / EXECUTIVE DISCOUNT, Brotherhood of Cryptobankers / SILENT PARTNER
and CHAIRMAN'S CUT, VerisAI / INCUBATOR. Their card-mates POWER BROKERS,
PIGGYBACK and CAVITATION ENGINEERS are in scope and listed below. Note: an admin
can still PICK a card with an out-of-scope face (the server gate is the blanket
m0+m1+m2 check, no per-card or per-face refusal); that face then does nothing.

| Card / privilege | Engine | Implemented? | Verified? | Bug? | Note |
|---|---|---|---|---|---|
| BRIN / THERMAL RESEARCH | `engine.js:3505` | Yes | Yes | No | A radiator the Thermal Labs face loses on a seeded Earth belt roll survives with it; lost again under Anarchy. |
| BRIN / THERMAL LABS | - | No | - | - | No engine rule. |
| The Sea Peoples / POWER BROKERS | - | No | - | - | No engine rule. In scope since 9084b63 (its card-mate COURIER needs M4). Hook: the FINAO payment sites via `finaoPerFor` (`engine.js:1566`), seniority disks in `asm.seniority`. |
| The Martian Way / ROCKETEERS | `engine.js:2395` (pad), `:5687` (belt) | Yes | Yes | No | Survives a Pad Explosion, the other face does not; off under Anarchy; in an m0+m1+m2 game off until a Home Bernal. Belt -2 is covered in `check-engine.mjs`. |
| The Martian Way / TAILINGS REMINING | - | No | - | - | No engine rule. |
| Space Force / LIFE RAFT | - | No | - | - | No engine rule. |
| Space Force / LIFEBOAT | - | No | - | - | No engine rule. |
| AEB / AMBASSADOR | - | No | - | - | No engine rule. |
| AEB / RABBLE-ROUSER | `engine.js:10454` | Yes | Yes | No | Starts and ends Anarchy (ending works through the Anarchy suspension); Ambassador face refused; m0+m1+m2 locked until a Home Bernal. |
| Explorers Without Borders / SHUTTLES | - | No | - | - | No engine rule (M5 tag is only "not recommended", so in scope). |
| Explorers Without Borders / ISO-SHUTTLES | - | No | - | - | No engine rule. |
| Baltimore Gun Club / WATER ARCJET | `engine.js:5279` | Yes | Yes | No | +1 burn leaving LEO with the card aboard, none when left behind, none under Anarchy, NOT locked by M2 (deliberate). |
| Baltimore Gun Club / HYDROGEN ARCJET | `engine.js:5279` | Yes | Yes | No | +1 burn leaving your own Factory and LEO; the white face gets none at a Factory; none at a bare site. |
| African Union / EMISSARIES | - | No | - | - | No engine rule. |
| African Union / ARBITER | - | No | - | - | No engine rule. |
| LEO Workers' Union / COLLECTIVE BARGAINING | `engine.js:15423` (+2), `:8876` (Murder/Suicide) | Yes | Yes | **Yes** | The +2 and the Human decommission both work in an engine-level core game. Bug CB-M2LOCK: the +2 is never paid in a real promo game. The felony clause is locked the same way until a Home Bernal. |
| LEO Workers' Union / SITDOWN | - | No | - | - | No engine rule. |
| Makers Guild / OFFWORLD TRADE NEXUS | `engine.js:12682` | Yes | Yes | No | +1 aqua at turn start off a plain Factory with no Bernal, in an m0+m1+m2 game; Trade Port face none; none under Anarchy. |
| Makers Guild / TRADE PORT | - | No | - | - | No engine rule. |
| New Pilgrims / REFUGEE | - | No | - | - | No engine rule. |
| New Pilgrims / IMMIGRANT | - | No | - | - | No engine rule. |
| Utopia, Inc. / PIGGYBACK | - | No | - | - | No engine rule. In scope since 9084b63. Needs an out-of-turn reaction to an opponent's BOOST (`engine.js:6038`), which no op has today. |
| Galahad Group / HEROIC | - | No | - | - | No engine rule. |
| Galahad Group / QUEST | - | No | - | - | No engine rule. |
| VerisAI / CAVITATION ENGINEERS | - | No | - | - | No engine rule. In scope since 9084b63 (its card-mate INCUBATOR needs M5). Hook: the aerobrake hazard waiver (`stackSafeAerobrake`) with a once-per-turn flag. |
| Heliocentricity / WEAK STABILITY BOUNDARY | - | No | - | - | No engine rule. |
| Heliocentricity / POWER SERIES CHAOS MODEL | - | No | - | - | No engine rule. |
| Cerulean / BLUE PLANET | - | No | - | - | No engine rule. |
| Cerulean / DOWSERS | `engine.js:10782` | Yes | Yes | No | An out-rated rig refuels at ISRU 0; Blue Planet face `isru_too_high`; off under Anarchy; m0+m1+m2 locked until a Home Bernal. |

The script prints the 21 unimplemented in-scope faces as an `info` list at the
end, so this column can be re-derived after future work.
`docs/promo-crew-plan.md` has the per-face hooks for building them.

## Bugs found

### 1. LAUNCH-FEES-PER-OP: Launch Fees pays per BOOST op, not per boost operation

`server/game/engine.js:6172`. A boost is one operation per turn; every later
boost that turn rides free as part of it (`hasBoostedThisTurn`, the "boost
economy" rule in CLAUDE.md). `creditPrivilegeIncome(state, 'LAUNCH_FEES', ...)`
runs on every BOOST op, so a rival who boosts three cards one at a time (1
operation spent) pays NASA 3 aqua.

Proposed fix: credit only when this BOOST is the one that spent the operation:

```js
const fees = (free && !launchContracts) ? [] : creditPrivilegeIncome(state, 'LAUNCH_FEES', 'Launch Fees');
```

Open call: should a solitaire Launch Contracts boost (a free action by law)
count as "a boost operation"? This fix keeps paying for it. Solo has no rival
to pay, so only the holder's own boost is affected.

### 2. CB-M2LOCK: Collective Bargaining's +2 is never paid in a legal game

`server/game/engine.js:15423`. The payout iterates
`playersWithPrivilege(state, 'COLLECTIVE_BARGAINING')`, which goes through
`privilegeOf` and its M2 lock. A promo card can only be picked under m0+m1+m2,
and nobody has a Home Bernal when the draft closes, so the payout list is always
empty. There is no later hook. The comment above it says "pays out
unconditionally". This is the same mistake the faction bank comment
(`:15445`) describes fixing for its own payout.

Proposed fix: read the printed face, as the faction bank does:

```js
for (const cb of state.players.filter((p) => playerOwnsAbility(p, 'COLLECTIVE_BARGAINING'))) {
```

### 3. MARKETEER-STRID: Marketeer close compares a Number against a string id

`server/game/engine.js:14645`:
`if (mktPid != null && Number(mktPid) !== buyerId) return fail('marketeer_wins_tie');`.
With a non-numeric profileId (the tutorial's bot seats use strings, which the
comments at `:14164` and `:14620` say must be supported), `Number('beta')` is
`NaN`. The auctioneer then can't sell a tied lot even to the Marketeer.
Reachable only where seats have string ids. Real lobby seats are numeric today.

Proposed fix: `String(mktPid) !== String(buyerId)`.

### 4. POWERSAT-ANY (rules gap, not a crash): Powersat only beams the holder's own craft

`server/game/engine.js:1813` / `:5195`. The card reads "During any player's
Turn, may give +1 thrust to any Spacecraft that has a push icon. Negotiable."
The engine only ever asks `hasPowersat(mover)`, so ESA can't give the +1 to a
rival's spacecraft except by lending the ability through a trade
(`borrowedAbilities`). The holder's own +1 is also applied automatically,
though the card says "may" (harmless). Fixing this means a per-move opt-in from
the ESA player (an off-turn grant), so it is a design decision, not a one-liner.

## Other findings (not crew-engine bugs)

- **`scripts/check-engine.mjs` has 12 checks after its exit gate.** The
  pass/fail decision (`process.exit(1)` / "engine smoke passed") is at line
  ~9615, but 12 `check(...)` calls follow it (Blink Telescope's per-operation
  re-roll, Footfall, Femtochemistry, two Pad Explosion checks, ...). If one of
  those fails, the script still exits 0 and CI stays green. Fix: move the gate
  to the end of the file.
- **Fresh checkouts lack the map submodule.** Without
  `vendor/hf-mission-planner` both scripts fail ~70 unrelated checks. CI
  initialises it. A local session must run `git submodule update --init`.
- **Possible transcription error in `data/crew.js`:** the Norse (SCRUM
  TROUBLESHOOTERS) blurb ends "Only 1 dirt tank refuel per turn.", the same
  sentence as on its card-mate NASRDA (Mooncable). It reads like a copy-paste.
  Not checked against the card image.
- **Arcjet vs Eugenic Pilgrims.** The Arcjet reads `state.anarchy` directly
  (`engine.js:5279`) instead of going through `privilegeOf`. So the
  `privilegeInAnarchy` colonist power (which keeps faction privileges through
  Anarchy) keeps every privilege except this one. Noticed by reading the code,
  not tested.

## Open questions (rulings for the user)

1. Should promo privileges be exempt from the M2 lock? Today they are dead in
   every legal promo game until a Home Bernal anchors. Also raised in
   `docs/promo-crew-plan.md`.
2. Secretary General under M2: if Anarchy is running at the first Home Bernal
   anchor, the +2 is skipped and paid at a LATER anchor (`sgHomePaid` stays
   false). Should it be paid regardless, forfeited, or paid later as now?
3. Dharma Refuel: must the chit-carrying Human be colocated with the refuel
   ("Colocated site refuel operation")? The engine doubles the refuel if the
   player has any chit anywhere.
4. Should a promo card be refused at PICK_CREW when a face is M4 / M5? With
   per-face tags, only JAXA has BOTH faces out of scope. The other four cards
   have one playable face, so a per-face refusal (allow the pick only on an
   in-scope face) is the natural rule.
