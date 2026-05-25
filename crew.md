# Crew cards (player factions)

Reference + working notes for the HF4 **crew** deck. Read this
before touching `data/crew.js` or the starting-crew wizard.

## What crew IS (and isn't)

- **Crew = the player-faction cards.** Six double-faced physical
  cards, each carrying two factions (12 factions total). At the
  start of a game the player picks ONE faction face; that
  faction's privilege is their edge for the rest of the game.
- **Crew is NOT the Colonists deck.** The Colonists (Babbage
  Halbonauts, Biomechs, Botany Bay Convicts, ...) are a separate
  set of cards. An earlier build wrongly populated `data/crew.js`
  from the spreadsheet's Colonists sheet - that was the wrong
  data and has been replaced.

## Source

- Canonical card list + art: https://www.hf4map.com/cards/crew/
  (cards `card0`..`card5`, front + back JPGs).
- The site serves stats as images; all 12 faces were
  transcribed directly from those card images (May 2026), so
  the table below is the real printed data, not guesses.

## The 12 factions

Thrust triangle = **thrust** (magenta circle) / **FT-per-burn**
(blue circle) / **afterburn** (orange triangle, optional).

| Card | Face | Faction (promo) | M / R | Prospector | Thrust | FT/burn | Afterburn | Rocket | Privilege |
|------|------|-----------------|-------|------------|--------|---------|-----------|--------|-----------|
| card0 | front | United Nations Cosmonauts (A) | 1/4 | 🛺 4 | 12 | 9  | 2 | Liberty 1.34 MN | **SECRETARY GENERAL** - Start with +2 Aqua. (Module 2: after 1st anchor of Home Bernal.) |
| card0 | back  | B612 Foundation (H) | 1/3 | 🛺 4 | 15 | 10 | 2 | New Glenn 17.1 MN | **BLINK TELESCOPE** - 1 re-roll per prospecting op when using a Raygun. |
| card1 | front | Roscosmos (B) | 1/5 | 🛺 4 | 15 | 10 | 2 | Angara 5 13.4 MN | **TAXES** - +1 Aqua from the Pool after any player places/industrializes a Claim. |
| card1 | back  | Taikonauts (C) | 1/4 | 🔫 4 | 14 | 9  | 2 | Long March 9 8.27 MN | **FELONIOUS** - Your Humans may perform Felonious actions. Negotiable. |
| card2 | front | NASA Astronauts (D) | 1/4 | 🔫 4 | 14 | 8  | 2 | SLS 130t Block II 7.44 MN | **LAUNCH FEES** - +1 Aqua from the Pool after any player Boosts. |
| card2 | back  | ISRO Glavcosmonauts (G) | 1/4 | 🛺 4 | 11 | 14 | 2 | GSLV MkIII 0.80 MN | **DHARMA REFUEL** - If any of your Humans carry a glory chit, double yield from a Colocated refuel. |
| card3 | front | Anonymous P2P (E) | 1/4 | 🛺 4 | 14 | 8  | 2 | Skylon 5.88 MN | **OPEN SOURCE FINAO** - Failure Is Not An Option costs 3 Aqua. |
| card3 | back  | ESA Space Unionists (F) | 1/4 | 🔫 4 | 12 | 8  | 2 | Ariane 64 1.37 MN | **POWERSAT** - During any player's Turn, give +1 thrust to a Spacecraft with a push icon. Negotiable. |
| card4 | front | Shimizu Corp Entrepreneurs (M) | 1/3 | 🛺 4 | - | - | - | (lander - no thruster) | **SKUNKWORKS** - Ignore academia hand limit when bidding or starting an auction. |
| card4 | back  | NASRDA Astronauts (L) | 1/4 | 🔫 4 | 7  | 11 | - (dirt) | Pegasus XL 0.074 MN | **MOONCABLE** - Once/turn free: refuel a dirt thrust triangle at LEO/Home Bernal (7 tanks non-crew / 1 crew). Negotiable. |
| card5 | front | SpaceX (J) | 1/4 | 🔫 4 | 15 | 10 | 2 | Starship 12 MN | **MARKETEER** - If you make the highest bid in an auction, you win even if tied. |
| card5 | back  | Norse Astronauts (K) | 1/3 | 🛺 4 | 15 | 14 | - (dirt) | OmegA SE 12 MN | **SCRUM TROUBLESHOOTERS** - Perform Glitch repair anywhere (even without Humans). Negotiable. |

All 12 privileges + stats are confirmed from the card images.
Notes:
- Crews have **no spectral type**.
- **Faction colour.** Each physical card carries a `color` -
  the faction band colour sampled straight off the printed card.
  Both faces of a physical card share it (it is that player's
  colour slot). The six colours: card0 gold `#fccc00`, card1
  purple `#c09cc0`, card2 silver `#e3e0d4` (NASA / ISRO read as
  near-white on the card), card3 mint `#a8d8c0`, card4 crimson
  `#b40054`, card5 gray `#9c9c9c`. The crew card renderer tints
  the typebar + frame to this; **picking a faction will set the
  player's colour to it in a future update** (not wired yet).
- **Thrust triangle** = thrust (magenta circle) / FT-per-burn
  (blue circle) / afterburn (orange triangle). Afterburn is
  **optional**: 2 on the nine standard thruster faces, absent
  on the dirt thrusters.
- **Shimizu (M)** has NO thruster (lander - no triangle).
  **NASRDA (L)** + **Norse (K)** are **dirt thrusters** (gray
  triangle): they keep thrust + FT-per-burn but have no
  afterburn (`afterburn: null, dirt: true`).
- The promotion letter (A/H/B/C/...) is the (X) after "Crew".

## Data files

- `data/crew-stats.json` - human-editable audit surface. Fill
  the `"effect": "TODO"` entries + real `mass` / `radHardness`
  here first.
- `data/crew.js` - the browser runtime module. Holds the same
  data inline (ES-module import; no JSON-assertion shim needed).
  **Keep it in sync with crew-stats.json by hand** - there's no
  generator for crew the way there is for patents (crew isn't in
  the spreadsheet). Exports:
  - `CREW` - the 6 cards, `{ id, color, faces: { primary,
    secondary } }`.
  - `CREW_BY_ID` - lookup.
  - `FACTIONS` - flat list of all 12 selectable faces for the
    wizard, each `{ cardId, face, color, name, bonus, blurb }`.
  - `CREW_FACES` - the 12 faces as standalone **single-face**
    card objects `{ id: '<cardId>__<face>', srcId, face, color,
    faces: { primary } }`. This is the **Card Library** view: it
    shows all 12 faction faces, each as its own flip-less card
    (no `faces.secondary`, so the renderer emits no Flip button).
    `srcId` maps a tile back to its physical card. Crew enters
    play only via the wizard, so library crew tiles are
    **inspect-only** (no add-to-hand / drag). The runtime hand /
    colonize pipeline still keys off the 6 physical `CREW` cards;
    `CREW_FACES` is purely a display projection.

Face shape (matches the crew renderer in `js/game/card-ui.js`):
`{ name, role, bonus, blurb, mass, radHardness, spectralType }`
- `bonus` = privilege short title, `blurb` = privilege effect.

## Starting-crew wizard

- `js/game/browse.js#openCrewWizard` - mandatory modal (no
  cancel / backdrop / Escape dismiss) that fires automatically
  after **New game**.
- Shows all 12 factions; the player picks ONE face.
- On confirm: the choice is recorded under
  `hf-sandbox-crew-faction` (so it rides along in saves) and the
  chosen crew card **spawns in the LEO Stack** (carrying the
  picked face) as the starting crew. `getPickedCrew` /
  `setPickedCrew` accessors.

## Crew never enters the hand

Crew cards can ONLY move stack-to-stack (LEO ↔ rocket ↔
outpost). They are never in the Hand and have no per-card hand /
stack actions (no Discard / Sell / Exo-produce / Boost / Flip):
- They **(re-)spawn in the LEO Stack** on (a) the starting-crew
  pick, (b) being consumed to build a colony, and (c) dying in a
  mishap (explosion / blast / glitch).
- `hand.js#addToHand` hard-rejects crew so the invariant holds.
- The crew slot carries the picked `face`; the renderer shows
  that single face with no Flip button.

## Open work

- **Faction privilege effects will be wired into the engine in a
  future update.** Right now the pick is recorded + the chosen
  crew card spawns in the LEO Stack, but the privilege effect
  (e.g. NASA's "+1 Aqua on any Boost") is NOT applied yet. The
  `bonus` (title) + `blurb` (effect text) are carried on each
  face purely for display until that update lands.
## Crew as thruster or robonaut (done)

A crew can serve as the ship's **thruster** OR its **robonaut**
(prospector). `rocket.js` synthesises a patent-like view of the
chosen crew face (`synthCrew`), so:
- a crew whose face carries a `thruster` block can be the active
  thruster (its thrust / FT-per-burn / afterburn feed the Net
  Thrust math; dirt thrusters read afterburn as absent);
- a crew whose face carries a `prospector` (buggy / raygun) can be
  the active prospector;
- the lander face (Shimizu, no `thruster`) is prospector-only;
- crew mass now counts toward the stack's dry/wet mass.

The rocket-stack modal shows the matching "Set as active
thruster" / "Set as prospector" buttons on crew, keyed off the
slot's picked face.
