# Module 2: Colonization + Futures - Release Notes (draft)

Prep notes for opening Module 2 to playtesting. M2 is the colonization +
Futures layer of HF4. It is currently ADMIN-ONLY + experimental; "releasing" it
means opening the gate the way M1 was opened for open playtesting. This doc is
the player-facing summary plus the readiness checklist.

Implementation detail (for maintainers) lives in
`docs/module-m2-implementation.md`; this is the release-facing companion.

## What Module 2 adds

Module 2 turns a race for patents into a race to settle the solar system. Once
your factories are producing, you ship colonists out, anchor space stations,
grow colonies, and chase Futures for the biggest endgame swings.

### Colonists
- A shuffled, face-down **colonist queue** (18 colonists). Colonists never draw
  into your hand for free; they arrive by **Exomigration**.
- **Exomigrate** (free action) once you have room: the top colonist boards your
  **Home Bernal** or your **LEO Stack**. A colonist berth opens when you anchor
  a Bernal, and the Colonists tab pulses to remind you.
- **Human vs Robot** colonists play differently: Robots ride to your hand and
  are built at a matching factory (and can be sold on the market); Humans crew
  your stations and count as Humans for presence and felonies. Killing a Human
  colonist is a Felony.
- **Colonist specialties** grant extra actions: Miner (extra refuels),
  Prospector (a free prospect/promotion), Engineer (extra ET products),
  Industrialist (a free industrialize/anchor).

### Bernals (space stations)
- **Anchor** a Bernal at a home orbit or beside a factory to turn it into a
  fixed colony and gain its ability. Anchoring reaches a factory even through a
  lander burn or a hazard between you and it.
- **Promote to Lab** flips a Bernal to its purple side at a colocated site
  matching its dome class, raising your colonist limit to 2. A promoted Bernal
  shows a glowing purple dome on the map.
- **Homesteading**, **Nanofacture** (mobile factories), and **Bernals building
  Bernals** round out the colony economy.

### Colonies
- Build colony domes at your factories. A colony's site **class** (Submarine,
  Astrobiology, Atmospheric/Aerostat) scores extra endgame VP - the site popup
  now tags each class so you can see what a colony there is worth at a glance.

### Futures (missions)
- 32 printed **Futures**: long-horizon goals (Uplift, New Venus, Footfall, Ad
  Astra exits, and more) with live requirement checklists.
- Unlock a Future by promoting its card, then attempt the **Epic Hazard** with a
  Human present to earn its **orange star** (roll the d6, or pay FINAO). Stars
  score at the endgame and your card shows the star once earned.
- The **Colonists** side pane tracks your colony population, allowance, and one
  live mission box per unlocked Future; the **scoring tracker** now counts your
  completed Futures in your live VP.

## How to play it (once released)

- Turn on **Module 0 (Politics)**, **Module 1 (Terawatt)**, and **Module 2
  (Colonization)** together when you create the room. M2 forces M0 on
  automatically, but **Futures need M1** (the Futures deck ships with M1), so a
  full Futures game is M0 + M1 + M2.
- An M2 room runs the long game: **7 rounds** by default.

## Polish landed this cycle

- Bernal + Colonist mass now counts in the rocket's dry mass (fixes fuel/weight
  math when carrying a Bernal).
- Bernal-stack cards get a **Back to hand** button; Bernal Lab promotion works
  from the rocket stack in one step.
- **Exomigration** boards only your Home Bernal or LEO (a Dirtside Bernal raises
  your limit but is not a boarding station; one Home Bernal ever).
- The colonist queue pile now shows a **face-down** back with the live remaining
  count (the order is secret) instead of a static card.
- Bernal Lab promotion matches the colocated site's **class** and no longer
  requires a colony dome or an anchor first; the card flips in place.
- **Futures**: a star appears on your card on completion and links to the
  Futures tracker; futures count in the live scoring tracker.
- Fuel transfer works at your **Home Bernal** as well as LEO.
- All **18 colonist card arts** are drawn and wired in.
- **Luna Treaty** (base multiplayer rule): only the first player may prospect
  Luna unless felonious; others request permission.

## Known limitations (deferred, by design)

- **War of Independence** is not implemented - a casus-belli Future is flagged
  and logged only (Module 3 territory).
- **CEO Solitaire + Futures** is not wired: the solo CEO loop is the no-Futures
  variant. Do not enable Futures for a `ceoSolo` room without the review in
  CLAUDE.md.
- A handful of colonist powers are catalogued but inert (Renaissance Man deck
  search, Blue Goo spectral gate, a few movement/market modifiers), and some
  dirtside cooperation ops are deferred. See
  `docs/module-m2-implementation.md#deferred` for the full list.

## Release-readiness checklist

- [ ] **Decide the gate.** M2 is admin-only today (server forces `m2 = 0` for
      non-admins on `/lobbies` create and `/settings`, and the checkbox is hidden
      from non-admin hosts). Opening it for playtesting means relaxing that gate
      and revealing the checkbox to every host, exactly as M1 was opened. This is
      a deliberate call - confirm before flipping.
- [ ] Keep the **CEO Solitaire + Futures** gate closed (see above) until that
      path is reviewed.
- [ ] Play a full **M0 + M1 + M2** game end to end (anchor -> exomigrate ->
      colony -> Lab promote -> unlock a Future -> Epic Hazard -> endgame scoring)
      and confirm the scores read correctly.
- [ ] Confirm a **module-off** game is byte-for-byte unchanged (zero bleed-through
      of any M2 rule/op/UI when the flag is off).
- [ ] Confirm the GitHub Pages + Fly deploy is green on the release commit.
- [ ] Sanity-check the colonist art and the Bernal/Lab map sprites render on the
      deployed build.

_Draft - adjust audience/scope as needed before publishing._
