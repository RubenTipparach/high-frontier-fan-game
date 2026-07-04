# Card-pile hero render

How the ray-traced "pile of cards on a wooden table" promo shot is produced. It
is a one-off marketing/art render, NOT part of the app build. Everything lives
under `scripts/card-pile-render/` and writes to a scratch directory of your
choosing (nothing is committed except the scripts themselves).

The result: the real M2 colonist card fronts, given physical thickness and a
white trading-card border, dropped by a rigid-body simulation into a natural
pile (no clipping), lit by a soft area light for ray-traced shadows, on a
procedural walnut table, with a linen normal map on every card face.

## Pipeline overview

Two stages. Stage 1 runs in the browser (so the textures are the genuine
in-game cards); stage 2 runs in Blender/Cycles.

```
                stage 1 (Chromium)                    stage 2 (Blender/Cycles)
  renderCard() -> screenshot each .card  ->  textured rounded-box meshes
  -> assets/colonists art shows through      + rigid-body drop + area light
  -> 18 transparent PNG card fronts          -> path-traced 2400x1680 PNG
```

## Prerequisites

- Headless Chromium via Playwright (already configured in this repo; see
  `scripts/screenshot.mjs` for the environment notes).
- Blender 4.x with Cycles. On this box: `sudo apt-get install -y blender`
  (needs `sudo apt-get update` first if the index is stale). Blender uses the
  system Python, so `sudo apt-get install -y python3-numpy` makes numpy
  importable inside the render script.
- Note: the apt Blender is built WITHOUT OpenImageDenoise, so the script
  disables denoising and leans on a high sample count + adaptive sampling. On a
  build that ships OIDN you can drop samples and turn `use_denoising` back on.

## Stage 1: export the card fronts

Serve the repo root, then screenshot each card element (rendered by the real
`renderCard()`) to a transparent PNG at 3x scale.

```bash
python3 -m http.server 8137            # serve repo root (module imports need this)
mkdir -p /tmp/pile/cards
node scripts/card-pile-render/export-cards.mjs /tmp/pile/cards
# -> /tmp/pile/cards/<colonist_id>.png  (18 files, transparent rounded corners)
```

`export.html` is the harness: it imports `renderCard` + `COLONISTS` and lays out
every colonist front; `.card-flip` is hidden so no UI button leaks into the art.
`omitBackground: true` gives the transparent corners the 3D card mesh relies on.

## Stage 2: the Blender scene

```bash
# args: <cardsDir> <outPng> [samples] [seed]
blender -b --python scripts/card-pile-render/render_pile.py -- \
  /tmp/pile/cards /tmp/pile-final.png 440 4242
```

`render_pile.py` builds the whole scene from scratch (no .blend file):

- **Card mesh** - a rounded-rectangle prism built in `bmesh` with real
  thickness. The corner radius matches the card art's radius (`10/220`), so the
  art's transparent corners line up with the mesh edge. Top face = art
  material; sides + back = cream "card stock".
- **White border** - the art UVs are inset (a Mapping node scales the UV
  inward), the image is set to `CLIP`, and a Mix node paints white wherever the
  clipped texture has no coverage. Border width is `b` in `make_card`
  (`0.05` = a slim classic border; `0.085` was too thick).
- **Linen normal map** - `make_linen_normal` builds a plain-weave height field
  with numpy, converts it to a tangent-space normal image, and plugs it into
  every card face. That is the paper "tooth" you see catch the light.
- **Procedural walnut table** - `make_table` is all shader nodes: a
  noise-warped Wave texture for wandering grain lines, a large noise for
  per-plank tone variation, a low-relief grain bump, and a satin roughness
  ramp. No image textures.
- **Rigid-body physics** - the table is a passive collider; each card is an
  active box rigid body. Cards start clustered above the table at staggered
  low heights with a gentle tilt, then the sim is stepped ~170 frames so they
  collide and settle into a pile (this is why nothing clips). The settled pose
  is baked and frozen before rendering. Keep the initial tilt small and the
  drop low or cards tumble onto their blank backs.
- **Lighting** - a large rectangular area light (its size is what makes the
  ray-traced shadows soft) plus a cool fill and a dim world. Filmic view
  transform, ACES-ish look.
- **Camera** - a tracked camera above the table; tune `cam.location` and the
  target for framing.

## Tuning knobs (all in `render_pile.py`)

| Want | Change |
|---|---|
| Different pile arrangement | the `seed` arg (4th positional) |
| Thicker / thinner white border | `b` in `make_card` |
| More / less spread | `rad` multiplier + `location` in the placement loop |
| Fewer face-down cards | lower the drop height + reduce the tilt degrees |
| Tighter / wider framing | `cam.location`, `cam_d.lens`, the target empty |
| Warmer / darker mood | `view_settings.exposure`, the key light `energy` / colour |
| Less noise (slower) | raise the `samples` arg (no OIDN on this build) |
| Bigger output | `W, H` near the top |

## Reproducing the shipped shot

```bash
python3 -m http.server 8137
node scripts/card-pile-render/export-cards.mjs /tmp/pile/cards
blender -b --python scripts/card-pile-render/render_pile.py -- \
  /tmp/pile/cards /tmp/pile-final.png 440 4242
```

Output is 2400x1680, front faces only, deterministic for a given seed.
