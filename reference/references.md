# Reference materials

These are reference materials for *High Frontier 4: All*
(Sierra Madre Games, Phil Eklund), both publisher-authored and
community-authored. They're checked in here strictly as
development reference for this fan implementation - they're not part of the
shipped product and the static GH Pages site does not link to them.

| File | What it covers |
|---|---|
| `HF4-site-manifest-and-locator-map.pdf` | Full canonical 188-site list with locator graph. Used to verify which bodies should be on the map and where they belong on the delta-v graph. |
| `HF4-outer-solar-system-maps.pdf` | Outer-system map plates (Jupiter / Saturn / Uranus / Neptune / Kuiper / Oort) with node labels and route segments. Used as the visual guide for the outer half of the map layout. |
| `HF4-site-list.xlsx` | Structured site list with one row per site: name, size, spectral type, hydration, group, solar zone, sol-clock position, burns-from-LEO, and a few capability flags. This is the authoritative input the `scripts/generate-sites.js` tool reads to keep `data/sites.js` in sync. |
| `HF4-branching-manuals-v0.3.zip` | Branching rulebooks (Core, QS, M0…M4, Futures, Sirens, AgeOfPiracy, Exodus, Panspermia). Reference for the rule details the engine will need in Stage 3+. |
| `HF4-victory-point-tracker.pdf` | Published end-of-game Victory Point tracker / scoring mat. Source for the scoring tab: the per-spectral exploitation track (factories built per spectral, marker steps 8 / 5 / 4), the glory-chit ticker tape (earn on first landing in a zone, flip for more on return home), and the VP category list. Expansion-module rows are out of scope. |
| `HF4-player-aid.pdf` | Community player aid by Geoff Speare (2019-04-29 revision), the single-sheet action reference. Canonical breakdown of the turn structure (move, any free actions, one operation), every Operation vs Free Action, felonies, the thrust / movement steps, map-space rules, threats, events, scoring, and the module summaries. Source for the "Operations & free actions" table in `CLAUDE.md` and the op-vs-free-action line the engine enforces. |

## External reference links

The web references the implementation is built against (mirrored from
`CLAUDE.md`):

- **Core rules PDF** (publisher-hosted): https://gamers-hq.de/media/pdf/c5/f2/cf/HF4-Core-Rules.pdf
- **Variants & scenarios appendix:** https://geekach.com.ua/content/files/varanti-ta-scenar-high-frontier-4-all-anglyskou-movou-62879102.pdf
- **BGG entry:** https://boardgamegeek.com/boardgame/281837/high-frontier-4-all
- **HF gazetteer** (heliocentric zones, site classifications): https://www.iandrea.co.uk/sf/resources/hf/HFgazetteer.html — canonical source for each named site's solar zone + synodic season tags, feeding `data/sites.js`'s `solarZone` / `siteSynodic` fields.
- **HF reference hub (iandrea):** https://www.iandrea.co.uk/sf/highfrontier/ — the author's High Frontier index page (rules summaries, maps, the gazetteer above, and other play aids).
- **HF4 card image reference (hf4map):** https://www.hf4map.com/cards/<deck>/<n> — a browsable card gallery of the full official catalog (Bernal, Colonist, Contracts, Crew, Freighter, Generator, GW Thruster, Promo, Radiator, Reactor, Refinery, Robonaut, Thruster), each card showing both faces. Covers modules this implementation doesn't ship (e.g. the Colonist deck runs 1-36 there but `data/colonists.js` only has the first 18 — cards 19-36 are M4, out of scope); cross-check against `data/` before assuming a pulled card is in scope.
- **Reference repo** for architecture / login / deploy patterns: https://github.com/RubenTipparach/murdoku-companion

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
