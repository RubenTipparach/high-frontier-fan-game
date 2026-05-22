# Reference materials

These are **publisher-authored** reference materials for *High Frontier 4: All*
(Sierra Madre Games, Phil Eklund). They're checked in here strictly as
development reference for this fan implementation — they're not part of the
shipped product and the static GH Pages site does not link to them.

| File | What it covers |
|---|---|
| `HF4-site-manifest-and-locator-map.pdf` | Full canonical 188-site list with locator graph. Used to verify which bodies should be on the map and where they belong on the delta-v graph. |
| `HF4-outer-solar-system-maps.pdf` | Outer-system map plates (Jupiter / Saturn / Uranus / Neptune / Kuiper / Oort) with node labels and route segments. Used as the visual guide for the outer half of the map layout. |
| `HF4-site-list.xlsx` | Structured site list with one row per site: name, size, spectral type, hydration, group, solar zone, sol-clock position, burns-from-LEO, and a few capability flags. This is the authoritative input the `scripts/generate-sites.js` tool reads to keep `data/sites.js` in sync. |
| `HF4-branching-manuals-v0.3.zip` | Branching rulebooks (Core, QS, M0…M4, Futures, Sirens, AgeOfPiracy, Exodus, Panspermia). Reference for the rule details the engine will need in Stage 3+. |

## Licensing posture

This repository is a fan implementation distributed under no license that
suggests ownership of the game's design. The reference files above are the
publisher's IP, redistributed here under the same fan-project posture as the
rest of the repo: development reference for personal / educational play, with
takedown-on-request from the publisher. If you fork this repo and intend to
distribute it elsewhere, remove this directory first.

## How the sites.js gets generated

`data/sites.js` is hand-curated, but it should track the canonical manifest.
When the spreadsheet changes (new edition, errata), re-run:

```
python3 scripts/generate-sites.py
```

…to regenerate the data block, then hand-edit the layout coords + blurb text
as needed. The script reads `reference/HF4-site-list.xlsx`, normalises the
site names + group memberships, and maps Burns-from-LEO + Sol Clock Position
into polar layout coordinates that feed the renderer.
