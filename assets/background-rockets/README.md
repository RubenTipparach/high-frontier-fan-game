# Background rockets - CONCEPT ART, not yet in the app

Side-profile illustrations of historical and concept crewed launch
vehicles, intended as decorative background vehicles for the game.
Nothing in the running app loads these yet: per the project's SVG
workflow they stay concept-only until the art gets explicit sign-off.

All six vehicles share one scale (7 px per meter), so they can sit in
the same scene with true relative sizes. `_contact-sheet.svg` lines
them up baseline-aligned against a meter scale bar; `_preview.png` is
its render.

| File | Vehicle | Height |
|---|---|---|
| `saturn-v-apollo.svg` | Saturn V (Apollo lunar stack with CSM + LES) | 110.6 m |
| `sls-block-1-artemis.svg` | SLS Block 1 (Artemis: core + SRBs + ICPS + Orion/LAS) | 98.1 m |
| `falcon-9-crew-dragon.svg` | Falcon 9 Block 5 with Crew Dragon | 69.5 m |
| `soyuz.svg` | Soyuz (crewed config: R-7 strap-ons, fairing + SAS tower) | 49.5 m |
| `project-orion.svg` | Project Orion nuclear-pulse concept (pusher plate + shock absorbers) | 41.2 m |
| `titan-2-gemini.svg` | Titan II GLV with Gemini spacecraft | 33.2 m |

## Chibi spacecraft

Super-deformed in-space configurations: squat proportions, fat noses,
oversized windows. These carry NO launch boosters - they are the
vehicles as they cruise between worlds, so they fit interplanetary
scenes where a first stage would be nonsense. Not to a shared scale.
`_chibi-sheet.svg` / `_chibi-preview.png` show the set.

| File | Vehicle |
|---|---|
| `chibi-apollo-csm.svg` | Apollo command + service module |
| `chibi-orion.svg` | Orion spacecraft (crew module + ESM with X-wing solar arrays) |
| `chibi-crew-dragon.svg` | Crew Dragon (capsule + trunk) |
| `chibi-soyuz.svg` | Soyuz spacecraft (orbital module + descent module + service module) |
| `chibi-skylab.svg` | Skylab (gold parasol, surviving solar wing, ATM windmill) |
| `chibi-gemini.svg` | Gemini spacecraft (re-entry module + adapter) |
| `chibi-orion-pulse-ship.svg` | Project Orion pulse ship (it IS its own interplanetary vehicle) |

## Media homages

Original designs INSPIRED BY popular sci-fi vehicles (fan homages,
not replicas). Shared scale 3.5 px per meter; `_media-sheet.svg` /
`_media-preview.png` line them up against a 150 m scale bar.

| File | Vehicle | Inspiration | Length |
|---|---|---|---|
| `media-shield-ship.svg` | Shield ship: gold sun shield leading a module spine with a glowing greenhouse | Sunshine | 174 m |
| `media-ring-ship.svg` | Ring ship: liner-turned-Mars-ship, rotating hotel ring on a central spine | For All Mankind | 126 m |
| `media-ion-cruiser.svg` | Ion cruiser: truss spine, rotating hab ring, solar wings, blue-glow ion drives | The Martian | 130 m |
| `media-deep-space-stack.svg` | Deep space stack: slender utilitarian stack with a conical crew cabin | Ad Astra | 64 m |
| `media-torch-corvette.svg` | Torch corvette: tail-lander military hull with hazard-orange accents | The Expanse | 46 m |

## Future concepts (TABLED for now)

Crewed interplanetary concepts from the Atomic Rockets "Realistic
Designs" catalogue (https://projectrho.com/public_html/rocket/).
Tabled by design review 2026-06-12 (they read more interstellar than
this game's solar-system setting); kept in `future-concepts/` as
reference docs, NOT candidates for the app right now. Shared scale
2.5 px per meter; `future-concepts/_futures-sheet.svg` lines them up
against a 200 m scale bar.

| File | Vehicle | Length |
|---|---|---|
| `future-concepts/future-discovery-2.svg` | Discovery II (NASA GRC He3-D fusion, centrifuge hab sphere + tank spine + radiator petals) | 236 m |
| `future-concepts/future-umbrella-ship.svg` | Stuhlinger ion "umbrella ship" (nuclear-electric, radiator dish + hanging crew pod) | 149 m |
| `future-concepts/future-medusa.svg` | Medusa (nuclear pulse charges tow the ship by a giant sail; compact survey size) | 166 m |
| `future-concepts/future-vista.svg` | VISTA (LLNL laser inertial-confinement fusion cone, crew ring at the rim) | 97 m |

The SVGs are emitted by `scripts/generate-background-rockets.mjs`
(geometry, shading gradients, and roll-pattern markings are all
parametric there). Edit the script and re-run it rather than hand
editing the SVGs:

```
node scripts/generate-background-rockets.mjs
```

Re-render the preview with:

```
rsvg-convert -o assets/background-rockets/_preview.png assets/background-rockets/_contact-sheet.svg
```
