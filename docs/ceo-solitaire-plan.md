# CEO Solitaire (V6) - requirements & plan

Forward-design + build doc for **CEO Solitaire**, the published one-player
variant by Victor Caminha (rules "V6"), played on the **Solitaire Sol Political
Assembly** mat (the Module-0 solitaire variant "4G3" by Justin Grey).

Scope follows CLAUDE.md ("Variants we target": Standard + CEO Solitaire only).
CEO Solitaire runs as a **single-player SERVER game** (solo online mode), the
same server-authoritative engine and shared front-end multiplayer uses, with one
seat. The offline hot-seat `js/game/solo.js` stays FROZEN LEGACY and is never
touched for this.

The flavour: every 12 in-game years the company **Board** meets to decide
whether your space program continues, judging you against a rising **KPI**. You
are the CEO. Make money, hit the number, and don't rack up fatalities.

---

## Split: build now vs document now

The user (2026-06-30) drew a hard line:

- **BUILD NOW** (the presentational + setup scaffolding):
  1. CEO Solitaire as its **own category** in the solo room-creation wizard.
  2. Wizard gating: choosing CEO Solitaire **disables** card-economy, starting
     aqua, house rules, and game length pickers; **auto-checks and locks** M0
     (mandatory); leaves M1 / M2 / M4 as optional add-ons (M4 not implemented,
     shown disabled).
  3. CEO Solitaire mode is **admin preview only** for now (same gate as the M2
     checkbox / Rat Frontier).
  4. An **intro cutscene**: a slick, 1999-era PowerPoint-style boardroom pitch
     where the CEO presents a 40-70 year space plan to the Board. Staged so the
     player knows what to expect.
  5. A **Board Meeting screen**: an SVG of board members around a circular
     table deciding whether you remain CEO, an animation revealing whether you
     met expectations, and a chart of income vs. score over time.
  6. Plumb a `ceoSolo` flag end to end (db -> state) so the cutscene + board
     meeting know they are in CEO Solitaire, and so the V6 engine rules have a
     flag to gate on when they land.

- **DOCUMENT NOW, build later** (the V6 / 4G3 rules engine): everything in
  "V6 rules (engine - not yet built)" and "Solitaire Module 0 assembly (4G3)"
  below. None of this is wired into the engine yet; the gate flag exists so it
  can be.

The new mat is **M0 with a different law set** (see 4G3). We do not reproduce
the printed mat art; we capture the functional rules in our own words, the same
way `data/assembly.js` / `docs/politics-m0-plan.md` already do for base M0.

---

## What's implemented now

### Mode flag plumbing (`ceoSolo`)

Mirrors the m0/m1/m2 plumbing exactly:

- `lobbies.ceo_solo` column (db.js migration), read into `lobbyRow`.
- `POST /lobbies` + `/settings` accept `ceoSolo`, **admin-gated** server-side
  (`profileIsAdmin`), forced to 0 for non-admins regardless of the request -
  the same contract M2 uses. The hidden wizard category is only UI; the server
  admin check is the real gate.
- `createInitialState({ ceoSolo })` forces `m0 = true` when `ceoSolo` is set
  (M0 is mandatory for this mode, just as M2 already forces M0 on), and stores
  `state.ceoSolo`.
- Client: `api.createLobby` / `lobby.createSoloRoom` carry `ceoSolo`; the
  snapshot exposes `state.ceoSolo` so the front-end can branch.

### Solo wizard: CEO Solitaire category

In the "New game -> Solo room" flow (`index.html` `#new-game-solo-opts`,
`js/main.js#initNewGameModal`):

- A **mode toggle** at the top of the solo options: **Sandbox solo** (the
  existing free options) vs **CEO Solitaire** (admin preview).
- Selecting **CEO Solitaire**:
  - disables + dims the starting-aqua, card-economy, game-length, and
    house-rules groups (they are fixed by the variant);
  - auto-checks M0 and disables the checkbox (mandatory);
  - keeps M1 / M2 / M4 toggleable (M4 disabled, "not implemented yet").
- The CEO Solitaire toggle is revealed only for admins, via the existing
  `setAdminModuleRows` / `refreshRatAccess` path.

### Intro cutscene (`js/game/ceo-cutscene.js`)

A full-screen overlay (modeled on the `.card-modal-overlay` crew-wizard
pattern) styled as a **1999 corporate PowerPoint**: title slide, agenda, the
40-70 year plan, the Board's expectations, then "Begin". Advances slide by
slide; skippable. Fires once when a CEO Solitaire room starts. Player-facing
copy talks about the GAME (the company, the Board, the plan), never the
engine (Style rule).

### Board Meeting screen (`js/game/ceo-boardroom.js`)

A full-screen overlay shown at a Board Meeting (and reused at game end):

- A hand-authored **SVG of board members seated around a circular table**, in
  the dark-space palette, with the CEO seat highlighted.
- A **verdict animation**: gavel / spotlight reveal of "Expectations met" vs
  "not met" against the cycle's KPI.
- A **chart** of income (aqua) vs. score (VP) over the cycles so far - a
  simple inline SVG line/area chart driven by per-cycle snapshots (staged
  with demo data until the V6 engine records real per-cycle history).

Both screens are gated to CEO Solitaire games and are admin preview only for
now. Per CLAUDE.md, the hand-authored SVGs are rendered to screenshots and
shown for sign-off before they are considered final art.

---

## Implementation status (2026-06-30)

**V6 core loop - IMPLEMENTED** (server-authoritative, verified against the engine):
- State (`server/game/state.js`): a ceoSolo game carries `seniorityCycle`
  (Seniority Disks left in the cycle, init = chosen game length), `demandPile`
  (`{ seniority, fatality }`), `ceoBoardHistory` (one entry per meeting), and
  `ceoVerdict`.
- Board Meeting (`server/game/engine.js#runBoardMeeting`, hooked in
  `resolveRoundClose` for ceoSolo): each round close computes the KPI from the
  demand pile BEFORE the new disk lands (`seniority*(7+seniority) +
  fatality*3`), checks it against the player's accumulated VP
  (`ceoSoloScore`, the same `data/endgame-scoring.js` scorer the standings
  use, minus the end-game ideology award), records the cycle, clears
  fatalities, and moves one Seniority Disk into the pile. Verified KPI
  sequence `0, 8, 18, 30` and the rulebook's `21 = 2*(7+2)+1*3`.
- Game end: a missed KPI ends the game `fired`; the last Seniority Disk
  leaving the cycle ends it `completed`. `computeFinalScores` still runs;
  `ceoRating` maps the final VP to the no-Futures victory band.
- Client (`js/game/browse.js`): the Board Meeting screen fires at each cycle
  (mid-game continue) and at game end (final, with the real verdict), reading
  `ceoBoardHistory` for the tally rows + the income/score chart.

**Solitaire (4G3) assembly law set - IMPLEMENTED (setup + data + display + key effects):**
- Setup (4G3a): an ADDITIONAL faction-colour delegate starts in **Centrist**
  (`seatCeoSoloCentristDelegate`, in `createInitialState` + re-applied by
  `PICK_CREW`), so a ceoSolo game opens with TWO delegates (home ideology +
  Centrist). The Sunspot Cycle uses a **busted disk** (client `sunspotDiscSvg`).
  "Include all cards in each patent deck" is satisfied by default (the deck
  builder deals the full deck per type).
- `data/assembly.js#SOLO_LAWS` + `lawForIdeology(key, solo)`: the solo mat keeps
  the six base awards but swaps the LAWS. The politics mat renders the solitaire
  laws when `snapshot.ceoSolo` (client `assembly.js` `solo` flag, fed from
  `assemblyDelegatesView`); the per-ideology law LIST shows in every panel.
- Effects wired: **Unity / Sol Unification** zeroes the Lobby aqua cost (and the
  base-Unity cascade + lobbying-disable is skipped solo, via `activeLaws(.., solo)`);
  **Individuality / Launch Contracts** makes BOOST a free action (never spends the
  op). Freedom (sell 2), Honor (glory aqua), Centrist (pad insurance) already
  matched the base hooks. Authority's opponent-discard is a no-op solo.
- **Fatality disks - IMPLEMENTED**: a Crew killed by a hazard / rad / flare roll
  DIES and respawns in the LEO Stack (the crew is never removed from play - it
  always comes back to LEO, as in every mode). In CEO Solitaire that death is
  ALSO a fatality: `crewDeathToLeo(state, owner, slot)` keeps the LEO respawn and
  calls `addFatality` (a disk to the demand pile, +3 to the next KPI). Wired at
  the four roll-death points: solar flare (`applyFlareToPlayer`), the move
  rad-roll decommission (`applyMove`), a destroyed rocket (`destroyRocket`, from a
  failed move/aerobrake roll), and the aerobrake-crit destruction. NOT counted:
  the Glitch roll and the Valkyrie ability purge (neither is a hazard/rad/flare
  roll), and crew are ALWAYS immune to Pad Explosions. Voluntary crew moves
  (anarchy decommission, build colony, crew draft) are never fatalities.
  ceoSolo-gated, so non-solo games are byte-identical. Verified (1 fatality ->
  KPI 3).

**Still NOT built (documented below):**
- The Futures victory path (needs M1+M2+Futures, not wired) - see CLAUDE.md.
- Equality / Subsidized Research's bonus-support economy (the "+1 free support,
  pay 2 for a 2nd" nuance) - the base Research-Grant grant stands in for now.
- Authority / Regime Change's inspiration cancel (after an event roll) - the
  inspiration-event timing hook is not wired.
- Unity / Sol Unification's season-blue Anarchy -> International Assistance
  (FINAO-halving) clause - only the lobby-cost-0 half is wired.

## V6 rules (engine - documented; core now built, see status above)

Source: V6 "CEO Solitaire" (Victor Caminha). Captured functionally.

### Setup

- 1 player. Setup as per Altruism (V4b) with any Modules.
- **Seniority Disks**: place **4** for a short game, **7** if playing Futures.
- Faction Privilege per V4b / V4c.

### Special rules

- Can be played with **Futures** only if using Modules 1 AND 2.
- **Fatality (E7)**: every time a Crew or Human Colonist is **involuntarily**
  decommissioned, add a **fatality disk** (a disk in an unused player colour)
  to the **demand pile**.
- **Research Auction Operation (I2, V4c) - IMPLEMENTED**: no competitive auction
  with a single player. The Research Auction op is a DIRECT TAKE: take the top
  card of a patent deck for your operation, plus one card off the top of each of
  its bonus support decks (I2g). Cost = a number of Aquas equal to the number of
  cards taken. The academia hand limit (I2a, `< 4` hand cards) still applies.
  Marketeer (SpaceX) faction privilege: buy 3 cards for 2 aqua (a 1-aqua rebate
  once three or more cards are taken). Server: `applyAuctionStart` `state.ceoSolo`
  branch (no `state.auction` is created). Client: the Cart / deck-picker and the
  auction-confirm modal show the per-take aqua cost instead of the bidding flow.
  (The economy is forced to Card Market for any ceoSolo game so the decks exist.)

### Board Meetings (added to the Sunspot Cycle Phase, D2)

On passing the seniority threshold, BEFORE the Seniority Disk is removed in D2b:

1. Compute the Board's **KPI** for this cycle:
   - If there are any Seniority Disks **already in the demand pile**, each such
     disk is worth `7 + (number of Seniority Disks in the demand pile)`. So the
     KPI contribution is **8** for one disk in the pile, **18** for two
     (`2 * (7+2)`), **30** for three (`3 * (7+3)`).
   - Each **fatality disk** in the demand pile is worth **3**.
   - KPI = sum of the value of all disks in the demand pile.
2. **Remove all fatality disks** from the demand pile.
3. **Move one Seniority Disk** from the Sunspot Cycle onto the demand pile.

Worked examples (from the rules):
- End of the first Solar Cycle, before removing a Seniority Disk: demand pile
  has 0 Seniority Disks + 2 fatalities -> KPI = 6.
- After 36 years (3 cycles): 2 Seniority Disks + 1 fatality in the demand pile
  -> KPI = `2*(7+2)` ... wait, the rules' own example states the KPI is **21**
  for "two Seniority Disks and 1 fatality". Reconcile when implementing: the
  text's worked total (21) implies the per-disk value is read at the moment the
  example is taken, NOT after the new disk lands. **OPEN: lock the exact
  evaluation order against the rulebook before coding the KPI.**

### Game End

The game ends when EITHER:
- the **last Seniority Disk** is removed, OR
- the Board's KPI is **not met** at the end of a solar cycle.

To **meet** the KPI you must have accumulated VP (M2 scoring) **>=** the KPI
value over the course of the game. If met, play continues.

Worked example: demand pile has 1 Seniority Disk + 1 fatality -> KPI =
`(7+1) + 3 = 11`. Player has 2 Claims + 2 Factories = 4 VP, plus +8 VP for the
3rd and 4th D-type Factories = 12 VP total, which exceeds 11, so play
continues.

### Victory conditions - no Futures (score per M2)

- 30-34: Controversial
- 35-39: Good
- 40-59: Memorable
- 60+: Legendary

### Victory conditions - with Futures

To succeed at the 7th and final Board Meeting you must **complete a Future**
(VP alone does not suffice), then count endgame score (M2):

- 0-77: Controversial
- 78-94: Good
- 95-114: Memorable
- 115+: Legendary

---

## Solitaire Module 0 assembly (4G3) - NOT yet built, documented only

Source: 4G3 "Module 0 Solitaire Variant" (Justin Grey) + the printed
**Solitaire Sol Political Assembly** mat. Used by every solitaire game that
includes M0 (so always, in CEO Solitaire, since M0 is mandatory). Design goal:
make every Ideology relevant and reduce luck so the solo player can plan for
victory.

This **replaces the base M0 law set** in `data/assembly.js`. When we build it we
will gate the solitaire law set on `state.ceoSolo` (or a broader
`state.soloAssembly`) and leave the multiplayer M0 law set untouched.

### Setup (4G3a)

- Place an **additional delegate of your faction colour into Centrist** (so the
  solo player opens with a Centrist delegate on top of the normal seating).
- All Solitaire M0 games must include **all cards in each patent deck used**.
- Use a **busted disk instead of a cube** in the Sunspot Cycle.

### Lobby (4G3b)

- **Pay 1 Aqua and discard a delegate in an inactive Ideology** to use that
  Ideology's Law. (Unity's "Sol Unification" makes the lobby cost 0 Aqua.)

### Laws + end-game awards (the solitaire mat)

| Ideology | Law | Effect | Award |
|---|---|---|---|
| Freedom | Free Trade Act II | May sell **2** cards with a Free Market op. | +1 VP per Factory cube |
| Honor | Paleoconservative Directive | During a Fundraise op, Aqua gained = number of **glory chits brought back to LEO**. | +1 VP per glory chit |
| Unity | Sol Unification | **Lobby cost is 0 Aqua.** Replace the season-blue *Anarchy* Event Roll with *International Assistance*: FINAO cost is half until end of season blue. | +1 VP per Ideology with your delegate |
| Authority | Regime Change | After an Event Roll, **discard a delegate here to change or cancel inspiration** (may be the same delegate used for a lobby). | +1 VP per Claim disk |
| Equality | Subsidized Research | When initiating a Research Auction op, take the top card of a patent deck **and one bonus support for free**; may pay **2 Aqua** for a second bonus support. (4G3d says "pay one" then "one more aqua" for the second - reconcile the exact cost when coding; the mat shows 2.) | +1 VP per Colony dome |
| Individuality | Launch Contracts | **Boosting is a free action.** Does NOT earn NASA any Aqua (4G3c). | +1 VP per Token on ☠ or 🪂 Sites |
| Centrist | Mishap Insurance | With a delegate here, you are **instantly repaid boost costs** of any card lost during a pad explosion. | (passive, no award) |

Notes:
- These differ from base M0 (`data/assembly.js`): Freedom drops the "for 5
  aqua" clause to a flat "sell 2"; Unity becomes lobby-cost + Anarchy
  replacement instead of the UN-General-Assembly multi-law override; Authority
  becomes inspiration control instead of delegate discard on Fundraise;
  Equality gains the bonus-support economy; Individuality becomes free boost.
- Centrist (Mishap Insurance) is the same passive as base M0's Pad Insurance.
- Individuality's award finally pins the two site types base M0 left "TBD":
  **☠ (skull) and 🪂 (aerobrake/parachute) sites**.

### Open questions before building 4G3

1. Exact Equality second-support cost (4G3d "one more aqua" vs mat "2 Aquas").
2. KPI evaluation order in the Board Meeting (see the 21-vs-derived discrepancy
   above).
3. How "season blue" maps to our Sunspot-Cycle / round model for Unity's
   Anarchy replacement and the FINAO-cost-halving window.
4. Whether the solitaire law set should key off `state.ceoSolo` alone or a
   shared `state.soloAssembly` flag (so a future non-CEO solo + M0 also gets
   it).

---

## Build order (now)

1. **Doc** (this file). [done]
2. **`ceoSolo` flag** end to end (db, server create/settings/start, state,
   client api/lobby, snapshot). Admin-gated like M2.
3. **Wizard category** + gating in `index.html` + `js/main.js`.
4. **Intro cutscene** module + CSS; fire on CEO Solitaire room start.
5. **Board Meeting screen** module + SVG board + verdict animation + income/score
   chart; reuse at game end.
6. **Screenshots** of the cutscene + board meeting into a review folder; send
   for sign-off (SVG art per CLAUDE.md waits for approval before it's final).

The V6 engine (seniority disks, KPI, fatalities, board-meeting resolution,
victory bands) and the 4G3 solitaire law set are explicitly **out of this
pass** - documented above, gated behind `state.ceoSolo` when built.
