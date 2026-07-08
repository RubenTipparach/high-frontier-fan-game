# Tutorial mission - design

A guided, fully-scripted solo mission that teaches the core loop: sell a card
for money, buy a card, boost cards to LEO, assemble + fuel a rocket, launch a
prospect mission, and industrialize a site. The worked mission is:

> Prospect + **industrialize Deimos**, use the Deimos factory to **ET-produce a
> robonaut and a refinery**, carry them one hop to Phobos, then prospect +
> **industrialize Phobos**.

Deimos and Phobos are the two Martian Moonlets: both class A (prospect threshold
3), 3.0 dv from LEO, and directly adjacent on the map (`['deimos','phobos',1]`),
so the teaching mission stays in one neighbourhood.

## Principles (what this design must NOT do)

1. **Reuse the engine, never rebuild it.** The tutorial is a normal
   server-authoritative solo game with a `state.tutorial` flag - the SAME
   `applyOperation` engine, the SAME ops (`FREE_MARKET`, `BUY_CARD` /
   `AUCTION_*`, `BOOST`, `BUILD_ROCKET`, `REFUEL`, `MOVE`, `PROSPECT`,
   `INDUSTRIALIZE`, `ET_PRODUCE`), the SAME snapshot + op-log. We do NOT author a
   second "tutorial engine" or per-step mutation handlers. The tutorial layer
   only (a) scripts the setup, (b) forces the dice, and (c) tracks which step
   the player is on.
2. **Zero bleed-through, like a module.** Everything tutorial-only gates on
   `state.tutorial`. A non-tutorial game is byte-for-byte unchanged.
3. **Deterministic.** A tutorial must play the same every time: scripted deck
   order (no shuffle) + forced die rolls (no chance). A returning player who
   restarts sees the identical board.

## Three scripted ingredients

### 1. Scripted deck + hand order (learn buy/sell)

`state.tutorial` swaps the shuffled decks for a FIXED order so the market top and
the opening hand are known. In `server/game/state.js#buildDecks`, when
`opts.tutorial` is set, return `TUTORIAL_DECKS` (a hand-authored ordering) INSTEAD
of `shuffle(gen, ...)`. The opening hand + market are then predictable, so the
tutorial copy can say "sell THIS card" and "buy THAT card" and be right.

The scripted setup must make every mission step reachable. Minimum contents
(exact card ids pinned at implementation time, all pulled from the real deck -
no hand-authored cards):

- **1 sellable hand card** the player is told to Free-Market for 3 aqua (teach
  selling / income).
- **1 market-top card** the player is told to buy (teach buying).
- **A rocket kit** to boost + assemble: a thruster, its reactor + radiator
  support, and a **robonaut** (the prospector; also the industrialize donor) and
  a **refinery** (the industrialize donor). Enough that Deimos can be prospected
  and industrialized.
- **ET-produce feedstock**: hand cards whose spectral type matches Deimos (**D**)
  so `ET_PRODUCE` can spit out the robonaut + refinery that go on to Phobos.
- **Starting aqua + fuel budget** sized so the scripted boosts + one refuel +
  the two short hops (LEO -> Deimos, Deimos -> Phobos) are exactly affordable.

### 2. Forced die rolls

Add a per-game forced-roll queue: `state.tutorial.rolls = [n, n, ...]`. Introduce
one helper the engine routes EVERY tutorial d6 through:

```
function tutorialD6(state, gen) {
  if (state.tutorial && state.tutorial.rolls && state.tutorial.rolls.length) {
    return state.tutorial.rolls.shift();     // scripted outcome
  }
  return gen.d6();                            // normal seeded chance
}
```

Replace the raw `gen.d6()` at every roll site the tutorial can hit (PROSPECT at
engine.js:663, and any hazard / event roll on the scripted route) with
`tutorialD6(state, gen)`. Queue `1`s for the prospects so both Deimos and Phobos
auto-succeed (roll <= 3 for class A). Because the queue is on `state`, it
replays deterministically through undo/rebuild just like `rng.cursor`.

> Alternative considered: seed-search for a seed that yields the wanted rolls.
> Rejected - brittle, and the scripted route hits several roll sites, so one seed
> can't pin them all. The queue is explicit and legible.

### 3. Mission script + progress

A server-side constant `TUTORIAL_SCRIPT` = an ordered array of steps. Progress
lives on `state.tutorial.step` (index) + `state.tutorial.done`. Each step:

```
{
  id:          'industrialize-deimos',
  title:       'Industrialize Deimos',
  instruction: 'Decommission your robonaut + refinery at Deimos to build a Factory.',
  op:          'INDUSTRIALIZE',              // the op kind that advances it
  // Does an accepted op satisfy this step? (state = POST-op state)
  satisfiedBy: (op, state) => op.kind === 'INDUSTRIALIZE'
                 && !!state... factory at deimos owned by the player,
  // The exact payload the Hint endpoint hands back (highlight / autofill).
  hint:        (state) => ({ kind:'INDUSTRIALIZE', siteId:'deimos', cardIds:[...] }),
  forcedRolls: [1],                          // dice this step needs (queued on entry)
}
```

After the engine accepts an op (`applyOperation` returns ok) in a tutorial game,
a thin `advanceTutorial(state, op)` runs: if the current step's `satisfiedBy` is
true, bump `state.tutorial.step` and push the NEXT step's `forcedRolls` onto the
queue. `state.tutorial` rides the normal snapshot, so the client always sees the
live step.

**Rails vs guidance (open question, see below).** Two enforcement modes:

- **Rails (recommended for a first tutorial):** the engine REJECTS any op that
  isn't the current step's `op` with a guiding error (`tutorial_wrong_step` +
  the step's instruction), so a new player literally cannot wander off. Free
  actions (route planning, inspecting) stay allowed.
- **Guidance:** all ops allowed; the script just tracks progress and the UI
  nudges. More forgiving, less foolproof.

## The steps (worked mission)

| # | Step | Op | Teaches | Forced roll |
|---|------|----|---------|-------------|
| 0 | Sell a card | `FREE_MARKET` | Hand card -> 3 aqua (income) | - |
| 1 | Buy a card | `AUCTION_START` (solo buy) / `BUY_CARD` | Spend aqua on a patent | - |
| 2 | Boost to LEO | `BOOST` | Play white-side cards up, pay mass in aqua | - |
| 3 | Assemble the rocket | `BUILD_ROCKET` (x n) | Stack thruster + reactor + radiator + robonaut + refinery | - |
| 4 | Fuel up | `REFUEL` | Fill the tank from the aqua bank | - |
| 5 | Launch + prospect Deimos | `MOVE` then `PROSPECT` | Fly LEO -> Deimos, roll to claim | `1` (auto-claim) |
| 6 | Industrialize Deimos | `INDUSTRIALIZE` | Decommission robonaut + refinery -> Factory (1 VP) | - |
| 7 | ET-produce a robonaut | `ET_PRODUCE` | Factory turns a D-spectral hand card into a black-side robonaut | - |
| 8 | ET-produce a refinery | `ET_PRODUCE` | ... and a refinery | - |
| 9 | Hop to Phobos + prospect | `MOVE` then `PROSPECT` | One adjacent hop, roll to claim | `1` (auto-claim) |
| 10 | Industrialize Phobos | `INDUSTRIALIZE` | Decommission the produced robonaut + refinery -> Factory | - |

Step 1's "buy" uses whatever the solo purchase path is (the Research auction run
single-seat, or a direct `BUY_CARD` if we expose one for the tutorial) - pinned
during implementation to match how solo currently acquires a card.

## API endpoints (the specific set)

The mutation surface stays the existing `POST /games/:id/ops`. The tutorial adds
a thin control + read surface around it. All require the profile token; the
tutorial game is owned by the caller.

### `POST /tutorial/start`
Create the scripted solo tutorial game and return its opening state.
- Body: `{}` (optionally `{ restart: true }` to discard an in-progress tutorial).
- Server: `createInitialState({ players:[caller], tutorial:true, seed:<fixed> })`,
  which installs `TUTORIAL_DECKS`, `state.tutorial = { step:0, done:false,
  rolls:[...step0] }`, and the scripted aqua/fuel.
- Returns: `{ gameId, seq, tutorial:{ step, steps:[{id,title,instruction}],
  done }, snapshot }`.

### `GET /games/:id/tutorial`
Read the mission script + live progress for a tutorial game (mirrors how
`GET /games/:id` returns the snapshot, but scoped to the tutorial layer).
- Returns: `{ step, done, steps:[{id,title,instruction,complete}],
  current:{ id, title, instruction, op }, hint }`.
- Non-tutorial game -> `404 not_a_tutorial`.

### `POST /games/:id/ops`  *(existing, unchanged signature)*
The player performs each step's real op here. In a tutorial game the engine
additionally: (a) queues the current step's forced rolls, (b) in Rails mode
rejects an off-step op with `{ ok:false, error:'tutorial_wrong_step', step,
instruction }`, (c) on an accepted satisfying op advances `state.tutorial.step`.
The response snapshot carries the updated `state.tutorial`, so the client's step
tracker updates from the same poll it already runs.

### `POST /games/:id/tutorial/hint`
Return the exact op payload the current step expects, so the UI can highlight the
control or offer a one-tap "do it for me". Read-only (no mutation).
- Returns: `{ step, op, payload, instruction }` (e.g. `{ op:'PROSPECT',
  payload:{ siteId:'deimos' }, instruction:'Roll to claim Deimos.' }`).

### `POST /games/:id/tutorial/skip`
Advance the current step WITHOUT performing its op (for testing / an impatient
player). Applies the step's canonical op server-side via the same engine, or
just bumps the step in a pure-guidance build. Gated to tutorial games + the
owner.

### `POST /games/:id/tutorial/reset`
Rebuild the tutorial from step 0 (fresh scripted game, same fixed seed). Same
result as `POST /tutorial/start { restart:true }`; offered as its own verb for a
clear "restart mission" button.

> Why not one POST endpoint per step (`/tutorial/:id/boost`, `/tutorial/:id/prospect`, ...)?
> That re-implements the op system behind a second door and would drift from the
> real engine (the exact failure the project's "never rebuild" rule guards
> against). Reusing `/games/:id/ops` means the tutorial teaches the REAL buttons,
> so the skills transfer straight to a live game. The step-walk-through the
> player experiences comes from the mission script + `GET .../tutorial` +
> `.../hint`, not from bespoke per-step mutations.

## Client flow (sketch)

The tutorial mounts the SAME sandbox UI (per "the multiplayer UI IS the sandbox
UI"): the classic map, hand, rocket-stack, factory panels. A tutorial overlay
reads `state.tutorial` from the snapshot and shows the current step's
instruction + a "Show me" button (calls `.../hint` and pulses the relevant
control). The player clicks the real controls; each accepted op advances the
banner. A completed mission shows a "you're ready - start a real game" card.

## Decisions (locked 2026-07-08)

1. **Hard rails.** The engine rejects any op that isn't the current step's op
   with a guiding error; free actions (inspect, plan route) stay allowed.
2. **Scripted bot opponents run the auction.** The tutorial game is seated with
   the human plus a few FAKE players. They auto-pass by default (so the human
   wins the lot and learns to buy), and the auction can be scripted server-side
   to have a bot drive the price up for teaching. No AI: their moves are a
   scripted table keyed off the current step, run by the server when it's a
   bot's turn. **No Module 0** (no politics) in the tutorial.
3. **Full 11-step mission** ships in one piece (economy + rocket + both
   industrializations + ET-produce).

## Economy via the auction (start: 6 Aqua)

The human opens with **6 Aqua** and 2 bot rivals. The economy is taught entirely
through the real Research auction, in both directions (the auctioneer banks the
winning bid, and wins ties - engine.js applyAuctionSell):

- **Earn (step `sell`).** The human auctions a card. The two bots bid it UP in
  +3 jumps to **6**; the human closes to the top bot and banks **+6 Aqua**.
- **Buy (step `buy`).** A bot auctions a Deimos-spectral (**D**) card the human
  needs. The bidder bots sit at the floor, so the human **bids 1 to beat them**
  and wins the card for 1.

So the human ends the economy phase with ~11 Aqua (6 start + 6 earned - 1 per D
card) plus the D feedstock, enough to boost + fuel + fly the two hops.

## Scripted opponents (bots)

`state.tutorial.bots = [profileId, ...]` marks the fake seats. A bot never
belongs to a real account, so it can only be driven by the server. Two hooks,
both gated on `state.tutorial`:

- **Auto-advance bot turns.** After any accepted op leaves it a bot's turn, the
  server runs `botMove(state, botId)` (default `END_TURN`) until the turn returns
  to the human, so the round never stalls waiting on a fake seat.
- **Scripted auction behaviour.** `botMove` returns an op INTENT the server
  resolves into a real op (which deck to auction, the buyerId to close to): bid
  the human's earn-lot up to 6, pass on a buy-lot so the human wins at 1, and on
  a bot's own turn during `buy` start the auction of the next needed card. All
  through the SAME `AUCTION_*` ops - never a bespoke auction path.

## Rails feedback (client)

Hard rails reject any off-step op with `{ error:'tutorial_wrong_step', step,
instruction }`. The client MUST surface this as a **popup modal** advising the
player what the current step wants (reusing `confirmModal` in acknowledge mode),
not a silent toast - a new player who clicks the wrong control gets told exactly
what to do next.

## Open questions (non-blocking)

- **Persistence.** One tutorial game per profile (reset overwrites) vs. replays
  as separate games. Defaulting to one-per-profile; `reset` rebuilds it.
