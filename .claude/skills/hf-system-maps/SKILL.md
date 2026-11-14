---
name: hf-system-maps
description: Build, change or review a High Frontier style STAR SYSTEM MAP (helio zones, Hohmann pivots, burns, gravity wells, lander burns, hazards, giants with moons, sites). Use whenever an Ad Astra system map (or any non-Sol board) is generated, hand-authored, tuned or debugged, when someone says a map "looks wrong" / "lines go nowhere" / "labels overlap", or when the system map rules (SM) or docs/ad-astra/mapgen/ change.
---

# Building High Frontier system maps

A system map has to read like the published Sol board to a tabletop HF4
player. Every route, burn, pivot, hazard and hex on it exists for a reason
the Sol board also has. This skill is how to get there and how to prove it.

**Rules before code.** The rules live in `docs/ad-astra/system-map-rules.md`
(SM-0 .. SM-10). The generator `docs/ad-astra/mapgen/mapgen.js` implements
them and cites rule IDs in comments; `validateMap()` checks them. When the
rules and the code disagree, the code is wrong. To change map behaviour:
edit the rule first, then the generator, then the validator, then look at it.

## Files

| File | What it is |
|---|---|
| `docs/ad-astra/system-map-rules.md` | The SM rules. Source of truth. |
| `docs/ad-astra/analyze-sol-map.mjs` | Measures the real Sol board. Every SM number comes from here. |
| `docs/ad-astra/analyze-moon-branch.mjs` | Shows where Sol's moons join their giant's well (never at the +4 slingshot). |
| `docs/ad-astra/mapgen/mapgen.js` | Pure generator + validator (no DOM, no imports). `buildMap(spec)`, `validateMap(map)`. |
| `docs/ad-astra/mapgen/builder.js` + `index.html` + `builder.css` | The interactive builder: edit bodies, the map rebuilds in the game's own `MapRenderer`, rule checks listed live. |
| `docs/ad-astra/prototype/build-artifact.mjs` | `node ... build-artifact.mjs mapgen` bundles the builder into one page (`docs/ad-astra/mapgen/dist/map-builder.html`) for an Artifact. |
| `js/game/render.js` | The real HF map renderer. Do not fork it; feed it planner-shaped data. |
| `vendor/hf-mission-planner/assets/data-hf4.json` | The Sol board itself (1514 nodes). The reference. |

## What the Sol board measures (SM-0), and what each fact means

Run `node docs/ad-astra/analyze-sol-map.mjs` to re-measure. The numbers:

- **1514 nodes**: decorative 517, burn 282, hohmann 258, lagrange 214, site 188, radhaz 54.
- **Burns do three jobs**: orbit entry / escape 48%, helio zone transition 27%,
  landing 18%, anything else 7%. So: a burn USUALLY either crosses a helio
  zone or enters / leaves orbit of a planet or cluster, or lands.
- **More burns = bigger gravity well.** Burns from a site out to the Hohmann
  layer, by site size: 1: 1.1, 2: 1.4, 3: 1.1, 4: 1.4, 5: 1.8, 6: 2.1, 7: 2.8,
  8: 3.0, 9: 3.3, 11: 4.3. Galilean moons sit 5-6 deep because they inherit
  Jupiter's well.
- **Green dots are Hohmann transfers**: the slow, fuel-efficient layer.
  Degree 2-4 (87 / 67 / 92 nodes). Entering one is free.
- **Sites are leaves**: 149 of 188 have exactly one edge. They hang off a
  Lagrange point (114), a curve (81), a lander burn (27) or a burn (11).
- **Lander burns**: 50 (28 full, 22 half); 14 also hazardous.
- **Hazards** sit on Lagranges (95) and burns (18). Radiation clusters at the
  Sun (Mercury zone 14), the giants (Jupiter 19, Saturn 6) and Earth's belts (7).
- **Aerobrakes**: 31, only at atmosphere bodies.
- **Curves**: every decorative node has exactly 2 edges. **Dead ends**: 5 in
  1514, all map exits.
- **Asteroids are 139 of 188 sites**, in every zone: main belt 43, Jupiter zone
  (Trojans) 26, Neptune zone (Kuiper) 20, Saturn 17, Mars 12, Earth 10, Uranus 10.
- **Jupiter's +4 node is on the transfer layer**: free through radiation belts
  from the Hohmann pivots, a 6-route crossroads. No moon route passes it; the
  moons come down burn ladders off Jupiter's pivots.
- **Flyby boosts**: Jupiter +4; Venus, Earth, Saturn, Uranus, Neptune +2;
  Mars, Mercury +1.
- **Zone palette** (inner to outer, `data/sites.js` SOLAR_ZONE_INFO):
  `#fdf441 #fefab1 #f97316 #ffdd92 #97a0bf #585e90 #2b3534 #2a2d4c #1d102e`.

## The construction, rule by rule

`buildMap(spec)` builds in this order. Keep the order when extending it.

1. **Stars and zones (SM-1).** `starLayout(stars)` places each star: a lone
   star fills the 1400 x 900 board (inner 70, outer 420); a **binary** puts the
   primary left and partner right; a **distant** companion is a small 2-3 zone
   system at the top right (SM-1e). Each star has its own nested elliptical
   zones (`zoneBounds(n, L)`), coloured from the Sol palette inner to outer.
   Nodes carry `star` (index, -1 between stars) and `zone`. `zoneLayer(stars)`
   returns `restart`: pass it to `setCanonicalZones` so a second star's bands
   don't punch through the first's.
2. **Hohmann rings (SM-2).** One ring of pivots per zone at its middle radius:
   at the three spokes (270 = top, toward arrival; 30; 150) plus every body's
   angle in that zone. Pivots closer than 6 degrees merge. Ring arcs between
   pivots are decorative curve nodes every ~9 degrees; zone 0's arcs get a
   radiation node mid-arc (SM-6a).
3. **Zone transitions (SM-3a).** Along each spoke, neighbouring rings are linked
   by a route carrying EXACTLY ONE burn, placed on the zone boundary.
4. **Arrival and between stars (SM-9).** One `orbit` node `high` just outside
   the primary's outer zone at the top, one burn into the outer ring: the only
   legal dead end. Stars are joined outer ring to outer ring with 2 transition
   burns (pivots facing each other are added to the outer rings).
5. **Each body's well (SM-4).** From the body's departure pivot (its own ring
   pivot): escape burns (`wellBurns(size)`: 1-5 = 1, 6-7 = 2, 8-11 = 3; giants
   always 3), then its Lagrange point (`fly` = `flybyOf(size)`: 11 = +4, 10 = +2,
   8-9 = +1). Zone 0 Lagranges are hazards (SM-6b).
6. **Sites and landing (SM-5).** Planets 1-3 sites, moons 1-2, dwarfs and
   asteroids 1. Each site has ONE edge: its landing path from the body's
   Lagrange. `landingOf(size)`: 7+ full lander burn, 4-6 half lander burn,
   1-3 none (straight from orbit). An atmosphere planet gets an aerobrake +
   hazard on one landing (SM-6c). Sites fan out on the far side of the body,
   at least `SITE_GAP` (32) world px apart INCLUDING sites on the same body
   (SM-5e). Moons fan round the far side of the hub, alternating near / far.
7. **Giants (SM-7).** Three ring pivots ~70 px apart (`giantDelta`): ladder
   start (a - delta), slingshot in (a), slingshot out (a + delta).
   - **Slingshot** (`purpose: 'flyby'`, +4 / +2) at the giant's centre: free
     through a radiation node from the in and out pivots, plus one transition
     burn out to the next zone's ring. It never leads to a moon: you cannot
     slingshot into a moon's orbit.
   - **Escape ladder**: 3 burns (`rung` 1-3) curling round the -90 side at
     R 34 (giant sphere `GIANT_HALO` 24).
   - **Moons** fan over [outAng - 126, outAng - 18], alternating 64 / 96 px
     out, and branch off the rung nearer in angle (2 or 3; off rung 3 through
     a radiation node) -> `moonEscape(size)` burns -> moon Lagrange ->
     landing -> sites. Moonlets come off rung 1 with one burn.
8. **Asteroids (SM-5f).** `kind: 'belt'` (count, sizes) and a giant's
   `trojans: n` expand into clusters: ring pivot -> one escape burn ->
   Lagrange -> up to 3 asteroid sites, fanned 22 px out. At least 40% of
   sites must be asteroids; the game's systems run 50%+.
9. **Comets (SM-5g).** `kind: 'comet'` (never zone 0): ring pivot -> 1 / 2 / 3
   escape burns (inner half / outer half / outermost zone) -> Lagrange -> a
   second Lagrange -> the comet site (`bodyKind: 'comet'`, size 1-3). Name it
   "Comet ..." and the renderer's comet palette applies. Comets skip the
   well-depth check. The game puts one in the main-belt zone and 0-2 further
   out (Sol: 12 comets, 7 in the belt zone).

## The spec

```js
{ name: 'Epsilon Indi', starType: 'yellow' | 'red', zones: 6,
  stars: [{ name: 'A', type: 'yellow', zones: 4 }, { name: 'B', type: 'yellow', zones: 3, role: 'binary' }, { name: 'Proxima', type: 'red', zones: 2, role: 'distant' }],
  bodies: [
    { kind: 'planet', name: 'Haven', zone: 2, size: 8, sites: 3, atmosphere: true, cls: 'Marginal', angle: 40 },
    { kind: 'belt', name: 'Belt', zone: 3, count: 8 },
    { kind: 'planet', name: 'Proxima b', star: 2, zone: 1, size: 7, sites: 2 },
    { kind: 'dwarf', name: 'Vesper', zone: 3, size: 6 },
    { kind: 'giant', name: 'Epsilon b', zone: 4, size: 11, trojans: 2,
      moons: [{ name: 'b-I', size: 8, sites: 2 }, { name: 'b-II', size: 7, sites: 2, ocean: true }, { name: 'b-iv', size: 2 }] },
  ] }
```

- `stars` is optional (one star from `name` / `starType` / `zones` otherwise).
  `star` on a body is the star index (default 0).
- `zone` is 0-based (0 = the star's zone). `angle` is optional; bodies in a
  zone auto-spread when it is missing.
- `size` 1..11 (the HF site size, which drives wells and landing).
- `cls` (planets): Hostile / Marginal / Habitable / Garden. Drives the body art
  in the builder and the astrobiology flag.

## The map it returns

`{ spec, nodes, edges, sites, bodies, zones: { order, colors, polys, bounds }, report }`

Node: `{ id, kind, x, y, zone, tags, purpose?, land?, body?, bodyKind?, size?, region?, fly?, moonOf?, ocean?, cls? }`

| kind | Meaning | Move cost |
|---|---|---|
| `star` | the star (not a stop) | - |
| `hohmann` | green pivot, SM-2 | free |
| `decorative` | curve bend, always 2 edges | free |
| `burn` | magenta pad; `purpose` = `transition` / `escape` / `landing` | 1 burn |
| `lagrange` | body orbit point; `purpose: 'orbit'`; `fly` = flyby boost | free |
| `radhaz` | radiation; roll on entry | free + hazard |
| `orbit` | the `high` arrival node | free |
| `site` | a hex; `bodyKind` = planet / moon / dwarf / asteroid | - |

`tags` on burns: `lander`, `half`, `hazard`, `aerobrake` (the Sol `NODE_TAGS`
vocabulary). `bodies` lists the giants (sphere positions, no sites).

## Drawing it with the real renderer

Never write a second renderer. `builder.js#toPlanner(map)` is the reference
conversion to the planner-map shape `MapRenderer` already draws:

- `burn` -> type `burn`; set `NODE_TAGS['mg-' + id] = tags` at runtime so the
  renderer draws the lander / half-lander / hazard / aerobrake glyphs.
- `hohmann`, `lagrange` (with `flybyBoost: fly`), `radhaz` (`hazard: true`),
  `decorative` (`isDecorative: true`), `orbit` -> same type names, all `isWaypoint: true`.
- `star` -> type `sun`, `sunR` 20 (red) / 26 (yellow).
- sites: planet -> `inner-planet`, moon -> `moon`, dwarf -> `dwarf`, asteroid ->
  `asteroid`; `isWaypoint: false`, `bodyKey: body` (one sphere per body),
  `siteSize`, short `name` (`Haven N`), `_palette` from the renderer's
  `BODY_PALETTES` look.
- giants -> type `gas-giant`, `isLandable: false`, own `_palette`.
- curves: `buildChains(sites, edges, byId)` from `js/game/planner-map.js`.
- renderer options: `solDecor = false` (no Sol orbit rings, asteroid dust or
  LEO label on a non-Sol map), `visualizeZones = true`, `zoneFill = true`,
  then `setCanonicalZones({ polys, colors, order })` with the map's zones.
- `onSelect` receives the node OBJECT: `hit && typeof hit === 'object' ? hit.id : hit`.
- In a game, `REAL_TYPES` must include `inner-planet` and `gas-giant` or the
  giants render as waypoint rings.

## Workflow (do every step)

1. **Rule first.** If the change is new behaviour, write or edit the SM rule
   in `system-map-rules.md`, with the Sol measurement that justifies it. Add a
   measurement to `analyze-sol-map.mjs` if the number isn't there.
2. **Generator.** Change `mapgen.js`, citing the rule ID in a comment.
3. **Validator.** Add or adjust the SM-10 check in `validateMap()`. A rule
   that isn't checked will drift.
4. **Node check.** All checks must pass on the presets and on a random-ish spec:
   ```bash
   node -e "import('./docs/ad-astra/mapgen/mapgen.js').then(m => { const r = m.buildMap({ name: 'T', zones: 6, bodies: [{ kind: 'planet', name: 'A', zone: 2, size: 8, sites: 3, atmosphere: true }, { kind: 'giant', name: 'G', zone: 4, size: 11, moons: [{ name: 'I', size: 8, sites: 2 }, { name: 'II', size: 2 }] }] }); console.log(r.nodes.length, r.report.map(x => (x.ok ? 'ok ' : 'NO ') + x.rule + ': ' + x.detail).join('\n')); })"
   ```
5. **Look at it.** Serve the repo and screenshot the builder whole AND zoomed
   onto the densest body (usually the giant):
   ```bash
   python3 -m http.server 8137
   ```
   ```bash
   node scripts/screenshot.mjs http://localhost:8137/docs/ad-astra/mapgen/index.html /tmp/mg.png --wait=1500
   ```
   To zoom in Playwright: `window.__mg.renderer.flyTo({ x, y }, 4, { ms: 0 })`
   with a body's position from `window.__mg.map`. `window.__mg.spec = {...}`
   loads a spec; `window.__mg.map.report` is the rule check.
6. **Visual checklist** (the validator can't see these):
   - no line ends in empty space; every route reaches a pivot, a body or a site;
   - no two hexes overlap and no label sits on another label, zoomed in;
   - moons hang off their giant's escape ladder, never off the slingshot or a ring;
   - each zone is one even tint band; no Sol orbit rings / belt dust / LEO;
   - lander glyphs (full / half rocket), skulls, aerobrake parachutes appear
     where the rules put them and nowhere else.
7. **Show the user** the screenshots (`SendUserFile`) before wiring a map
   change into the game, the same as the SVG rule in CLAUDE.md.
8. **Publish** when asked: `node docs/ad-astra/prototype/build-artifact.mjs mapgen`,
   then publish `docs/ad-astra/mapgen/dist/map-builder.html` with
   `files` = every path in `dist/assets.json`.

## Failure modes already hit (don't repeat them)

- **Cutting templates out of the Sol board** (the first approach) left stubs
  that went nowhere and long Sol labels piled on top of each other. Maps are
  GENERATED from the rules, never cut from Sol.
- **Moons reachable straight from a ring.** Wrong: SM-7b, through the hub.
- **Burn chains that don't mean anything** (a row of burns along a route).
  Every burn has a `purpose`; SM-10 check 3 fails otherwise.
- **The spacing check skipped same-body sites**, so a moon's two hexes sat
  on each other while the check said "clear". It now checks every pair. At
  28 px, neighbouring moons of a 4-moon giant still touched in about 8% of
  rolls, and long labels (`Epsilon b-I Far`) ran together: 32 px and short
  labels fixed both. Stress test every change across many seeds, not one.
- **Moons hung off the giant's flyby point.** Wrong (user, 2026-11-14): a
  slingshot is for reaching other planets; moon orbits take ordinary burns
  down the escape ladder. The validator checks no moon route touches a flyby
  point (SM-10 check 8).
- **Too few asteroids.** Sol is 74% asteroids; boards with 2-3 rocks read as
  empty. SM-10 check 9.
- **Binaries drawn as one star.** Alpha Centauri is two systems on one board
  with Proxima far out; 61 Cygni, Luyten 726-8, Sirius, Procyon and Luhman 16
  are binaries too.
- **Splicing the generator by a substring anchor** that also matched a new
  line deleted half of `buildMap`. Anchor on something unique, or rewrite the
  file whole, then run the node check.
- **"Where are the asteroids?"** The builder stores the spec in the
  viewer's browser. After a rules change an old saved map hid the new presets
  (no belts). Bump `SPEC_KEY` in builder.js whenever presets or rules change.
- **No comets.** Sol has 12; boards had none until SM-5g.
- **Moons in the well-depth check against planets.** A size 9 moon is deeper
  than a size 10 planet by design (SM-4b). Worlds and moons are checked apart.
- **Sol decor on other maps.** `solDecor = false` hides Sol's orbit guides,
  asteroid dust and the LEO label.
- **Map wider than fit.** The renderer's MIN_ZOOM is 1 on a 1400 x 900 world;
  stay inside `WORLD` or the map can't be zoomed out to see it all.
- **Saved games keep old layouts.** When the generator changes, bump the
  prototype's `SYSTEM_LAYOUT` so `migrateSystems` rebuilds stored systems.
