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
- The site serves stats as **images**, not text, so the per-face
  numbers + several privileges had to come from elsewhere (BGG
  threads, strategy guides) or remain TODO.

## The 12 factions

| Card | Face | Faction | Privilege | Effect |
|------|------|---------|-----------|--------|
| card0 | front | United Nations Cosmonauts | UN MANDATE | **TODO** |
| card0 | back  | B612 Foundation | B612 | **TODO** |
| card1 | front | Roscosmos | PROTECTION FEES | Gain 1 water after any player places a claim or industrializes. |
| card1 | back  | Taikonauts | TAIKONAUTS | **TODO** |
| card2 | front | NASA Astronauts | NASA LAUNCH FEES | Gain 1 aqua whenever any player performs a Boost. |
| card2 | back  | ISRO Glavcosmonauts | ISRO | **TODO** |
| card3 | front | Anonymous P2P | ANONYMOUS P2P | **TODO** |
| card3 | back  | ESA Space Unionists | ESA POWERSAT IN GEO | +1 thrust to any one spacecraft during any player turn. |
| card4 | front | Shimizu Corp Entrepreneurs | SHIMIZU SKUNKWORKS | May bid in research auctions with any number of hand cards. |
| card4 | back  | NASRDA Astronauts | NASRDA | **TODO** |
| card5 | front | SpaceX | SPACEX LAUNCH FEES | Gain 1 water whenever any player performs a Boost. |
| card5 | back  | Norse Astronauts | NORSE | **TODO** |

5 of 12 privileges are confirmed; **7 are TODO** (need a
transcription from the card images). Per-face **mass** and
**rad-hardness** are placeholders (0 / 3) until the printed
values are read off the cards.

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

- Transcribe the 7 TODO faction privileges from the card images.
- Replace the placeholder mass / rad-hardness with printed
  values.
- Wire the chosen faction's privilege into the engine (right now
  the pick is recorded + the card enters hand, but the privilege
  effect - e.g. NASA's "gain aqua on Boost" - isn't applied yet).
