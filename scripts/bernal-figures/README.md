# Bernal figures (M2)

The two physical Bernal models, rendered from 3D (three.js) to player-colour
PNGs in `assets/bernal/`. Consumed at runtime by `js/game/bernal-sprite.js`
(loads `<kind>-<colour>[-anchored].png`), exactly like the factory-base PNGs.

- **Stanford**: two parallel torus rings on a tilted axle (yawed so they read
  at a 3/4 angle), star stand. Anchored adds a teal colony dome on the top
  ring's hub.
- **Kalpana**: two ribbed cones pointing inward with a sphere in the middle,
  star stand. Anchored adds a teal colony dome on top.

Both are rendered at the SAME view as the rocket sprite (orthographic, azimuth
0.5 + "lean toward camera" 0.42), so all the player figures sit at one angle.

## Regenerate the PNGs

`scene.html` is the scene (it exposes `window.renderModel(kind, colourHex,
anchored)`). `render.mjs` fetches three.js, serves the scene headlessly, and
writes all 24 PNGs (2 kinds x 6 seat colours x plain/anchored) to
`assets/bernal/`:

```
node scripts/bernal-figures/render.mjs
```

Edit `scene.html` to tweak a model, then re-run to refresh the assets.
