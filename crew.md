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

Format: Mass / Rad-Hard, ISRU prospector, thruster (triangle +
rocket flavour).

| Card | Face | Faction (promo) | M / R | Prospector | Thrust triangle | Rocket | Privilege |
|------|------|-----------------|-------|------------|-----------------|--------|-----------|
| card0 | front | United Nations Cosmonauts (A) | 1/4 | 🛺 4 | 2 | Liberty 1.34 MN | **SECRETARY GENERAL** - Start with +2 Aqua. (Module 2: after 1st anchor of Home Bernal.) |
| card0 | back  | B612 Foundation (H) | 1/3 | 🛺 4 | 2 | New Glenn 17.1 MN | **BLINK TELESCOPE** - 1 re-roll per prospecting op when using a Raygun. |
| card1 | front | Roscosmos (B) | 1/5 | 🛺 4 | 2 | Angara 5 13.4 MN | **TAXES** - +1 Aqua from the Pool after any player places/industrializes a Claim. |
| card1 | back  | Taikonauts (C) | 1/4 | 🔫 4 | 2 | Long March 9 8.27 MN | **FELONIOUS** - Your Humans may perform Felonious actions. Negotiable. |
| card2 | front | NASA Astronauts (D) | 1/4 | 🔫 4 | 2 | SLS 130t Block II 7.44 MN | **LAUNCH FEES** - +1 Aqua from the Pool after any player Boosts. |
| card2 | back  | ISRO Glavcosmonauts (G) | 1/4 | 🛺 4 | 2 | GSLV MkIII 0.80 MN | **DHARMA REFUEL** - If any of your Humans carry a glory chit, double yield from a Colocated refuel. |
| card3 | front | Anonymous P2P (E) | 1/4 | 🛺 4 | 2 | Skylon 5.88 MN | **OPEN SOURCE FINAO** - Failure Is Not An Option costs 3 Aqua. |
| card3 | back  | ESA Space Unionists (F) | 1/4 | 🔫 4 | 2 | Ariane 64 1.37 MN | **POWERSAT** - During any player's Turn, give +1 thrust to a Spacecraft with a push icon. Negotiable. |
| card4 | front | Shimizu Corp Entrepreneurs (M) | 1/3 | 🛺 4 | none (lander) | - | **SKUNKWORKS** - Ignore academia hand limit when bidding or starting an auction. |
| card4 | back  | NASRDA Astronauts (L) | 1/4 | 🔫 4 | dirt | Pegasus XL 0.074 MN | **MOONCABLE** - Once/turn free: refuel a dirt thrust triangle at LEO/Home Bernal (7 tanks non-crew / 1 crew). Negotiable. |
| card5 | front | SpaceX (J) | 1/4 | 🔫 4 | 2 | Starship 12 MN | **MARKETEER** - If you make the highest bid in an auction, you win even if tied. |
| card5 | back  | Norse Astronauts (K) | 1/3 | 🛺 4 | dirt | OmegA SE 12 MN | **SCRUM TROUBLESHOOTERS** - Perform Glitch repair anywhere (even without Humans). Negotiable. |

All 12 privileges + stats are confirmed from the card images.
Notes:
- Crews have **no spectral type**.
- **Thrust triangle**: the orange triangle's game-thrust is **2**
  on every thruster crew. **Shimizu (M)** has NO thruster (it's
  a lander). **NASRDA (L)** and **Norse (K)** have a **dirt
  thruster** (gray triangle; modelled as `dirt: true`, game-
  thrust 2 inferred since the number wasn't legible in the
  image).
- The promotion letter (A/H/B/C/...) is the (X) after "Crew".
- The two foot badges (magenta + blue circles) are captured in
  `crew-stats.json` as `bottomBadges` - meaning still TBD.

## Data files

- `data/crew-stats.json` - human-editable audit surface. Fill
  the `"effect": "TODO"` entries + real `mass` / `radHardness`
  here first.
- `data/crew.js` - the browser runtime module. Holds the same
  data inline (ES-module import; no JSON-assertion shim needed).
  **Keep it in sync with crew-stats.json by hand** - there's no
  generator for crew the way there is for patents (crew isn't in
  the spreadsheet). Exports:
  - `CREW` - the 6 cards, `{ id, faces: { primary, secondary } }`.
  - `CREW_BY_ID` - lookup.
  - `FACTIONS` - flat list of all 12 selectable faces for the
    wizard, each `{ cardId, face, name, bonus, blurb }`.

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
  chosen crew card is dropped into the player's Hand as the
  starting crew. `getPickedCrew` / `setPickedCrew` accessors.

## Open work

- The `bottomBadges` pair (magenta + blue foot circles) is
  captured but its meaning is unconfirmed - resolve + name it.
- Wire each faction's privilege into the engine (right now the
  pick is recorded + the card enters hand, but the privilege
  effect - e.g. NASA's "+1 Aqua on any Boost" - isn't applied
  yet).
- Decide how a crew's thruster (rocket name + MN) maps to the
  game thrust value; the card foot triangle shows a game-thrust
  of ~2 for most, with the MN / ks as flavour.
