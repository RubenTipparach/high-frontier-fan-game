# Patent card art - guide

Background pictures for patent cards (thrusters first, other decks to follow).

## The rule: background only

The art is the `background-image` of the card's `.card-body` and NOTHING else.
No element moves, resizes, or changes colour: same thrust triangle, same
supports box, same blurb, same positions (user directive 2026-11-13: "pics are
just backgrounds like the colonist cards" / "don't change my layout").
The CSS is the single `.card-face.has-bg-art .card-body` rule in
`css/cards.css`. Do NOT reuse the colonist `.has-art` class for patent cards:
that recipe docks the thrust triangle lower-left, which is a layout change.

## Where it lives

- `scripts/card-art/<deck>.json` - the source manifest, one entry per card face
  (`primary` = white front, `secondary` = black back): the source (NASA Image
  Library id, or a Wikimedia Commons file + licence), an optional fractional
  pre-crop, the cover-fit gravity, and `approved`.
- `scripts/fetch-card-art.py` - downloads (cached in `$CARD_ART_CACHE`, default
  `/tmp/hf-card-art-cache`), crops to 436x418 (2x the ~218x209 card body), and
  writes `assets/cards/<deck>/<cardId>-<front|back>.webp`,
  `assets/cards/CREDITS.md`, and the generated `data/card-art.js`.
- `js/game/card-ui.js#buildFace` - reads `CARD_ART[card.id][face]` and paints it.

## Sourcing

Prefer NASA imagery (images-api.nasa.gov): it is not subject to US copyright.
Wikimedia Commons is fine for CC0 / public-domain files; record the licence and
author in the entry. Crop out agency logos / insignia and caption bars (NASA
meatball, GRC photo headers): the art must not read as an endorsement. Match
the face's actual technology as closely as the library allows; both faces of
a card are different technologies, so each gets its own picture.

## Approval gate

Only `approved: true` entries render in the game. Show the user a rendered
preview first (`scratchpad/thruster-art-preview.html` sets
`globalThis.HF_CARD_ART_PREVIEW = true` to show pending art), then flip the
approved entries and re-run the script.
