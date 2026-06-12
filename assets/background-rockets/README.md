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
