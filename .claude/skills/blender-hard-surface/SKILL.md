---
name: blender-hard-surface
description: Render High Frontier card art (patent card backgrounds, thrusters first - read the In High Frontier note first) with Star Crew's scripted, headless Blender method - primitives, lathed profiles, named parts, Cycles on the CPU. Carries the full hard-surface method (CSG cutters through Exact booleans, chamfers, checks, glb export) from Fleet Command / Crab Breeze. Use when making or changing Blender-rendered card art, or asking about running Blender headless here ("Blender", "render card art", "hard surface", "lathe", "Cycles").
metadata:
  author: Star Crew (Claude Code)
  version: "1.0"
---

## In High Frontier

Copied from Fleet Command (`RubenTipparach/fleet-command`, `.claude/skills/blender-hard-surface`),
which copied it from Crab Breeze and Star Crew Bridge Simulator; their notes follow verbatim.
Here it is used for CARD ART, not game models: a scripted Blender scene per card face, rendered
with Cycles on the CPU to a transparent PNG and composited onto the card backdrop. Where the
notes below disagree with this one, this one wins.

- **Subjects**: patent card faces (thrusters first). Original designs only; each face draws its
  own technology. The render is ONLY the card body's background; the card layout never changes
  (docs/card-art-guide.md).
- **Running it**: Blender as a Python module in a throwaway virtualenv (Python 3.11,
  `uv venv -p 3.11 venv && VIRTUAL_ENV=venv uv pip install bpy`), then
  `venv/bin/python scripts/blender/render_thruster_art.py --out DIR`. No GPU needed; about 2 s a
  face at 436x418 and 48 samples on four cores.
- **The proof of concept** is `scripts/blender/render_thruster_art.py` (4 thruster faces, lathed
  profiles, emission plumes). It reuses this skill's lathe idea; it does not need the glb export,
  manifests, LODs or triangle budgets below.

---


## In Fleet Command

Copied from Crab Breeze (`.claude/skills/blender-hard-surface` at `69ce196`), which copied it from
Star Crew Bridge Simulator (`8b0bbf1`); provenance in `.claude/skills/PROVENANCE.md`. Below this note
are Crab Breeze's note and then Star Crew's text, both verbatim, kept for the method: primitives,
named cutters through Exact booleans, a shared kit, a check that refuses bad geometry, a
byte-reproducible glb with a manifest. Where they disagree with this note, this note wins.

- **Subjects**: starships (hull, saucer or spine, nacelles or drives, weapon mounts, shield
  emitters, bridge, hangar), stations, and small props. Original designs only (CLAUDE.md 10). A
  ship is blocked out low poly first and shown as a three.js mockup at true scale (survey `A1` sets
  the scale and detail level) before it is detailed.
- **Named nodes the game drives**: `MOUNT_<id>` (weapon mounts, facing along -Z, the arc in the
  manifest), `SHIELD_<facing>`, `ENGINE_<id>`, `LIGHT_<kind>_<n>` (hull lights, `light-baking`),
  `DMG_<zone>` (damage zones), `CAM_chase` (the chase camera's anchor). The manifest lists them, and
  a check fails a ship whose data names a mount the glb lacks.
- **Mobile budgets and LODs**: each ship ships LOD0 to LOD2, roughly halving triangles per step,
  each LOD's triangle and texture budget in its manifest; the build refuses one over budget.
  Numbers come with the renderer decision (survey `T2`, `T3`).
- **Materials**: PBR (base colour, normal, ORM, emission) wired by `tools/blender/pbr.py`, from
  Material Maker graphs and `panel-textures` maps. Godot's importer reads the glTF ORM image into
  `StandardMaterial3D`.
- **The engine is Godot**: the glb lands in `assets/models/` and Godot imports it (the import is a
  build product; the generator and the glb are committed). Generators go in `tools/blender/`.
  Blender 4.4.3 is installed by `scripts/install-blender.sh`.
- **Kit**: Star Crew's `hs_kit.py` is not in this repository yet (it lives in
  `RubenTipparach/Star-Crew-Bridge-Simulator`). The first ship change ports it with provenance into
  `tools/blender/hs_kit.py`; until then `tools/blender/panel_kit.py`, `pbr.py` and
  `check_zfight.py` are here.

---

*The source text, verbatim, below.*

## In Crab Breeze

Copied from Star Crew Bridge Simulator (`.claude/skills/blender-hard-surface` at `8b0bbf1`,
2026-10-23); provenance in `.claude/skills/PROVENANCE.md`. Everything below this note is the
source's text, kept so a later copy can be diffed. It is the method for the mech, its cockpit
and every hard-surface prop here: scripted Blender, cutters through Exact booleans, a shared kit,
a check that refuses bad geometry, and a byte-reproducible glb with a manifest.

What changes here:
- **Detail, not low poly.** Crab Breeze is high detail (CLAUDE.md section 1). Keep the CSG method
  and the cleaning, but bevel with as many segments as the silhouette needs, and bake a normal map
  from the high-detail model onto each LOD instead of baking relief into the colour.
- **Every hero asset ships LODs** (LOD0 at full detail, then roughly half the triangles per step),
  each with its triangle budget in its manifest, and the build refuses one over budget.
- **PBR materials.** Bevy's `StandardMaterial`: base colour, normal, and an ORM map
  (occlusion, roughness, metallic), from Material Maker (`material-maker`). No vertex-colour bake.
- **The cockpit is a set, built to the pilot's eye.** Every control a pilot touches is a named
  node in the glb, so the game can animate and hit-test it, and the seat's eye point is an empty
  (`EYE_pilot`) that the first-person camera is parented to.
- **The engine is Bevy.** The glb loads with `SceneRoot(asset_server.load("....glb#Scene0"))`;
  the source's shipkit and custom-engine notes do not apply. Paths go under `tools/blender/` and
  `assets/models/` as there.

# Hard-surface props in Blender, the CSG way

The owner, 2026-10-05, sharing Star Trek bridge cutaways: "look at how to do hard surface
modeling in blender with booleans and CSG". This skill is how a Star Crew prop is made that way:
the bridge furniture in `assets/models/bridge/` and the command suite's furniture in
`assets/models/suite/` are its worked examples. CLAUDE.md section 9 has the
art rules it serves (low poly, textured, lit by the bake, meshes built by committed generators,
every asset under a triangle budget that the build enforces) and section 8 the no-z-fighting
rule. Rooms and levels are a different job: see "Props here, rooms in blender-csg-levels" below.

## The parts

| File | What it is |
| --- | --- |
| `tools/blender/hs_kit.py` | The kit every prop set shares: materials (`ROLES`), primitives (`prism`, `obox`, `hull`, `ngon`, `lathe`, `frame`, `in_frame`, `clip_polygon`, `triangle_inset`), the `Prop` class (`cut`, `union`, `chamfer`, `recess`, and the named `box`, `prism`, `hull`), `clean`, `finish`, `check`, the glb export and its read-back (`read_glb`, `verify_glb`), the manifest writer and the command line (`PropSet`, `run`). `build_wall_panels.py` imports it too. Never copy it into a builder. |
| `tools/blender/build_bridge_props.py` | The bridge set: its props, their hand controls (`throttle`, `stick`, `guarded_button`, `toggle`, `slider_bank`), budgets, manifest status and rules. The script is the source; nothing else is. |
| `tools/blender/build_suite_props.py` | The command suite's set (see "Suite props"), the same way. |
| `tools/blender/render_props.py` | Stills of a set's exported glbs (not the build's scene), one per prop plus the set's contact sheet: `--set bridge` (the default) or `--set suite`. |
| `assets/models/<set>/<name>.glb` | One prop per file. |
| `assets/models/<set>/props.json` | The manifest (`starcrew.props/1`): per prop its file, dimensions, bounds, anchor, operator or seat points (and, for the suite, `operators_yaw_deg`), screens, triangles against budget, materials, its CSG steps and the glb's sha256; the generator and Blender versions. Written by the build, never by hand. |
| `docs/screenshots/props/` | `<name>.png`, the bridge's `contact-sheet.png` and the suite's `suite-props.png`. Look at them before anyone else does. |

## Running it headless

Two ways, the same script:

```sh
# Blender as a Python module (pip install bpy; matches Blender 4.5 LTS):
python tools/blender/build_bridge_props.py [--check] [--only a,b] [--blend out.blend]
python tools/blender/build_suite_props.py [--check] [--only a,b] [--blend out.blend]
python tools/blender/render_props.py [--set bridge|suite] [--only a,b] [--samples 24] [--no-sheet] [--no-stills] [--shots DIR]
# The Blender binary:
blender -b --factory-startup -P tools/blender/build_bridge_props.py -- [same options]
```

- **`import bpy` first.** With the pip module, `bmesh` and `mathutils` do not exist until `bpy`
  is imported; `import bmesh` on line one fails with ModuleNotFoundError.
- **Arguments.** Under the binary, the script's options follow `--`; as a module they are plain
  `sys.argv`. Every script accepts both (the builders through `hs_kit.run`).
- **Start empty.** `bpy.ops.wm.read_factory_settings(use_empty=True)`, so no user preference or
  startup file changes the result.
- **Rendering needs no GPU, but only Cycles works.** Workbench and EEVEE need an OpenGL context
  (`libEGL.so.1`); in a cloud session the process dies without one. Cycles on the CPU renders,
  denoising works, and Freestyle draws the edge lines (a new line set in an empty scene has no
  line style: create one). About 40 s a prop at 1024 x 768 and 24 samples on four cores.
- **`--blend` saves the scene** with every cutter collection, to look at the CSG in Blender. It
  is a debugging view: the steps are already applied and the file is not reproducible.

## Booleans or extrusion?

| The shape | Make it with | Why |
| --- | --- | --- |
| A body whose side view says it all (a console cabinet, a desk, an arm, a fin) | One extruded profile (`prism`), or a box carved by one convex profile cutter | One profile is one face loop: the cheapest correct mesh, and every corner is placed by a number |
| A recess (a screen, an access panel, a button band) or a hole (a fin's truss) | A cutter box or prism, Boolean Difference | The recess walls and floor come with their materials, and the panel around it is split exactly once |
| Pieces that meet (a pedestal under a desk, a back on a seat, fins on a cabinet) | Boolean Union of overlapping solids | Removes the hidden faces and leaves one closed solid; a plain join keeps every buried face and its triangles |
| A curve (the helm arc) | `lathe`: the profile swept in N steps | The profile carries the toe kicks, slope and rim in one go, and N sets the facet count directly. Measured: an Exact cylinder minus cylinder cut to a wedge gives the same 68 triangles and no slivers, but needs a 54-sided cylinder and one cutter per detail |
| A tapered or leaning block (a pedestal, a column, a hood) | `hull` of its corner points | Planar faces by construction |

Booleans earn their place where a shape is cut into another or two shapes meet. Do not use them
to make what one profile describes: every Boolean splits the faces it touches.

## The cutter workflow

Every prop follows the same order. Each step is applied at once (the evaluated mesh replaces the
object's mesh, `apply_modifiers`), because the next step selects real edges and faces.

1. **Block out** in prop space (below) with `prism`, `obox`, `hull`, `ngon`, `lathe`. Every
   primitive carries all the material slots in one fixed order (`ROLES`), and each face its role.
2. **Carve** with named cutters: `p.cut(body, "carve", [cutter, ...])` puts them in a collection
   `<prop>.carve` under `<prop>.cutters` (wire display, hidden in renders) and adds one Boolean
   modifier: operation Difference, operand type Collection, solver Exact, materials Transfer. The
   faces a cutter leaves behind take the cutter's own face roles, so a cutter's profile edges say
   what each new surface is (desk top `trim`, button band `accent`, display wall `machinery`).
3. **Chamfer** the silhouette edges that should catch light (next section), before anything
   else meets them.
4. **Make the other pieces the same way** (a fin is blocked out, chamfered, then pierced), and
   **union** them in: `p.union(body, "fins", [fin_l, fin_r])`.
5. **Cut the screens last** with `p.recess(...)`: a box whose floor, 12-20 mm behind the panel,
   becomes the `screen` face and whose sides become the recess walls. Last, so no bevel and no
   union ever touches a recess edge.
6. **Clean, check, finish, export, read back, render, look** (sections below).

Rules that keep the Exact solver's result clean (they are the level kit's, at prop scale):

- **No cutter face lies on a face it cuts.** A recess cutter reaches 5 cm out of its panel; a
  carve cutter runs 5 cm past the body on every side it crosses; a union piece overlaps 1 cm into
  what it joins (the fins start 1 cm inside the cabinet's ends).
- **No coplanar faces between union inputs either.** The headrest band's top sits 1 cm above the
  back's top; the fins stand 6 cm proud of the desk front rather than flush with it.
- **A hole must stay clear of the body behind it.** The fins' truss holes are confined to the
  region in front of the screen panel and above the desk, computed by clipping (`clip_polygon`),
  then inset by half a web (`triangle_inset`); a hole that overlapped the cabinet would show the
  cabinet's end face through it.
- **Name every cutter** `<prop>.<what>` and every collection `<prop>.<step>`: the `--blend` view
  and the manifest's `csg` list then read as the history of the prop.

## Chamfers that cost few triangles

- **Chamfer only the edges that catch light**: the desk's front edge, a fin's front and top edges,
  a plinth's or a foot's top edges, a seat cushion's front edge. `p.chamfer(ob, label, width,
  where)` marks the convex edges whose prop-space midpoint, direction and face normals `where`
  accepts with the `bevel_weight_edge` attribute, then applies a Bevel modifier: segments 1,
  limit method Weight, clamp overlap on, outer miter Sharp. A chamfer that matches no edge stops
  the build (a predicate that silently matches nothing is a chamfer you think you have).
- **Widths** 12-25 mm: 20 mm on a desk edge, 15 mm on fins and housings. Narrower vanishes at
  64 px per metre; wider reads as a rounded toy.
- **What one costs** (measured). A chamfer along an edge adds a 2-triangle strip; where it ends
  against an unchamfered face, that face gains a vertex (one more triangle). A closed loop has no
  ends: a hexagonal foot's six top edges cost exactly 12 (20 to 32). A box chamfered on all
  twelve edges is 44 triangles instead of 12.
- **A blanket Bevel explodes the count.** Measured on the finished props, one Angle-limited
  (30 degree) Bevel over everything at the end: wall_bank_core 304 to 792 triangles,
  crew_chair 154 to 470, standup_console 80 to 248. It also bevels every recess and hole edge.
- **A chamfer drawn into a profile** (an extra vertex in a `prism` profile) costs the same strip
  with no corner patches: use it where the edge is part of the profile anyway (the light strip's
  45 degree face is a profile cut, not a bevel).

## Cleaning after the booleans

`clean(ob)` runs, in this order:

1. Merge by distance, 0.1 mm (`deckc` welds at the same distance).
2. Dissolve degenerate (zero-length edges, zero-area faces), 0.1 mm.
3. Limited Dissolve, 1 degree, delimit Material: the Exact solver leaves coplanar faces split
   along its cut lines; this merges them back into one face per plane and material, and drops
   vertices left in the middle of straight edges. Delimit Material keeps a screen a separate face.
4. Delete loose vertices; triangulate (Beauty for quads and n-gons); dissolve degenerate again
   and re-triangulate anything it merged; recalculate normals outward.

Then `check(prop)` refuses the prop when it finds: an edge without exactly two faces or a
non-manifold vertex, a degenerate triangle, two triangles facing the same way within 1 cm of each
other's plane that overlap (coplanar z-fighting, CLAUDE.md 8), an upward face within 1 cm of the
floor, or (a wall-standing prop, `Prop(..., wall=True)`) a face toward the room within 1 cm of the
wall plane. The check is pinned:
a join of two overlapping boxes is caught (coplanar overlaps), an open box is caught (4
non-manifold edges), and the same boxes through an Exact union pass with 12 triangles.

## Triangle budgets

The bridge set's budgets came with the props' brief (2026-10-05), inside bridge-stations section
12's allowance (700 for a desk with its screen, 300 for a seat); the suite set's are under "Suite
props". The build refuses a prop over its budget, naming it and its count, and writes nothing at
all.

| Prop | Size (x, y, z) m | Triangles | Budget |
| --- | --- | ---: | ---: |
| `wall_bank_core` | 1.64 x 2.22 x 0.66 (desk 1.40) | 320 | 420 |
| `wall_bank_core_engineering` | the same, with five breaker toggles | 404 | 420 |
| `wall_bank` | 1.34 x 2.22 x 0.66 (desk 1.10) | 320 | 420 |
| `wall_bank_comms` | the same, with a bank of four faders | 408 | 420 |
| `wall_bank_double` | 2.64 x 2.22 x 0.66 (desk 2.40, two seats) | 400 | 700 |
| `free_console` | 1.40 x 1.23 x 0.64 | 184 | 420 |
| `free_console_helm` | the same, with a throttle lever and a stick | 284 | 420 |
| `free_console_tactical` | the same, with two guarded fire buttons | 272 | 420 |
| `helm_arc` | 2.57 x 1.02 x 0.82 (2.4 m arc at mid depth), helm's and tactical's controls | 478 | 600 |
| `captain_chair` | 0.86 x 1.18 x 0.78 | 258 | 300 |
| `crew_chair` | 0.55 x 1.04 x 0.67 | 154 | 160 |
| `standup_console` | 0.64 x 1.16 x 0.52 | 80 | 160 |

**A station's variant** (bridge-stations 11.6) is the shared prop with that station's hand
controls unioned on (the `throttle`, `stick`, `guarded_button`, `toggle` and `slider_bank`
helpers, each built in a desk frame and reaching 1-2 cm into the desk): the manifest row says
`variant_of` and `stations`, keeps its base's `operators_m` and budget, and
`tools/bridge_variants.py` (`prop_for`) and the variants page place it wherever the base would
stand at those stations. A small solid unioned onto a face costs its visible faces plus the hole
it makes: a box 16 triangles, a three-sided toggle about 17.

Where the triangles go, and what to do about it:

- **Holes, not pieces.** A union or a recess punches a hole in the face it passes through, and a
  face with a hole triangulates to (outer + hole) triangles instead of (outer - 2). On the crew
  chair the back shell's front face, holed by its cushion and crossed by the headrest band, is 15
  triangles; the foot's top and the seat's underside, holed by the column, are 12 and 10.
- **Separating parts can cost more, not less.** Stopping the seat cushion short of the backrest
  (so the back no longer notched it) took the crew chair from 158 to 162: the strip of seat shell
  now visible between them was a new face with two holes. Count, don't guess: `read_glb` and a
  per-plane tally show which faces are expensive.
- **Cut the cheapest detail first**: side chamfers before front chamfers, a chamfer before a
  cushion. The crew chair kept its cushions and lost the cushion's side chamfers (158 to 154).
- **A notch is no cheaper than a hole.** Standing the shelf's items against the sides of their
  bays (each then notched the shelf and the side instead of holing the shelf) left the shelf at
  168. Running the locker bank's door splits off both ends of its front (splitting the face, not
  holing it) took the front from 82 to 69 triangles, but notched the plinth's underside and the
  top chamfer by 12 each: 212 to 210.
- **Bury undersides, and groove with a V.** The bed's blanket and turned-down sheet hung 2 cm
  above the base, and their undersides cost 16 triangles; sunk 1 cm into the base they cost
  nothing (226 to 210). A V-groove (a triangular prism cutter, four faces) costs 6 triangles where
  a box groove costs 10 or more: the locker bank's door splits as Vs took it from 210 to 190. A
  louvre band cut across all four doors and crossed by the splits cost 270.

## Suite props

The command suite's rooms off the round bridge (the ready room, briefing room, captain's quarters,
head, bridge locker and computer core; `openspec/changes/command-suite` design section 5) are
furnished by a second set of fifteen props, built by `tools/blender/build_suite_props.py` into
`assets/models/suite/` with its own `props.json`: `briefing_table` 140 of 400 triangles,
`wall_screen` 76/120, `desk` 212/300, `sofa` 192/200, `low_table` 52/60, `shelf` 156/160, `bed`
194/200, `wardrobe` 72/80, `wet_cell` 110/140, `toilet_stall` 194/200, `wash_counter` 212/220,
`shower_stall` 144/160, `locker_bank` 190/200, `server_rack` 138/140, `workbench` 218/220. Its
conventions are the bridge set's, with +Z toward the user (a desk's sitter, a bed's foot, a door's
outside), every back at z = 0 (flat on the wall plane where the anchor says so; the read-back
checks it through `Prop(..., wall=True)` or `back_at_z0=True`), `accent` for upholstery, blankets,
binders and the suits behind the locker windows, a screen kind `strip` for the briefing table's
display, and `operators_yaw_deg` beside `operators_m` (the table's eight seats face +Z or -Z). The
toilet stall is one closed solid shaped as a tube, partitions open at the top and to the floor, so
a cutaway from above sees the toilet inside. Both builders hold only their own props and import
everything else from the shared module `tools/blender/hs_kit.py` (a `PropSet` handed to `run`), so
a fix to the kit reaches both; after one, every builder's `--check` must pass, and the bridge set
stays byte for byte the same. The set's contact sheet is `docs/screenshots/props/suite-props.png`
(`render_props.py --set suite`).

## The export conventions

| Convention | What the build does |
| --- | --- |
| Units | Metres |
| Prop space | The exported glTF frame: +Y up, +Z toward the operator (out of a console's working face; for a chair, the way the sitter faces), +X the operator's right. Every primitive is made in prop space and turned into Blender's Z-up frame as it is made (`PROP_TO_BLENDER`: x, y, z to x, -z, y); the glTF exporter's +Y Up turns it back. The read-back proves it: the floor is at y = 0, a wall bank's back at z = 0, and every screen faces +Z or up. |
| Origin | On the floor at the centre of the prop's back: the wall plane for a wall bank, the back of the pedestal for everything else |
| Materials | One per role: `machinery`, `trim`, `bulkhead`, `hazard`, `light_panel` (keys of `data/materials/materials.json`, checked at build time), `screen` (emissive, coloured by the page) and `accent` (the station's role colour). The glb's base colours are each layer's mean texel colour (and shipkit's `screen` and `engineering` for the page-coloured two), so a viewer shows something that reads |
| UV0 | Metres, per face, exactly shipkit.js `worldUv`: (x, z) where the face normal's \|y\| > 0.75, else (the horizontal tangent (-n.z, n.x) dotted with (x, z), y). The page divides by the material's `span_m`. The exporter stores 1 - v, so the build writes (u, 1 - v) and the read-back checks the file's UVs against the formula |
| Shading | Flat: every face its own normal; the exporter splits the vertices |
| Topology | Triangulated, one closed manifold solid per prop. Faces against the floor or a wall are kept: `deckc` drops faces pressed against another surface (deck-pipeline section 5) |
| Back faces | `use_backface_culling` on every material, so the glb says `doubleSided: false`. Blender's default exports `true`, which forbids culling on a solid that never shows its inside |
| Export options | GLB, selection only, +Y up, UVs and normals on, tangents, vertex colours, attributes, extras, cameras, lights, animation, skins and morphs off, images none |

**Determinism.** Two builds in separate processes write identical bytes (sha256 compared on every
glb and props.json). Nothing in the file varies: the exporter writes no images, no extras
and no timestamps, and its one free-text field is `asset.generator`, "Khronos glTF Blender I/O
v4.5.51", fixed per version. Everything that orders output is stable: prop order is the `PROPS`
table's (each builder's), material slots are `ROLES` order (the kit's), bmesh operators are deterministic. The manifest records
each glb's sha256 with the Blender and exporter versions; `--check` rebuilds in memory and fails
on any difference (so run it with the version the manifest names).

## How the kit and the mockups consume a prop

This is the contract the files are written to. `docs/mockups/bridge-variants.html` reads them
today: `python3 tools/mockups/inline.py` (its `models:bridge` block) copies props.json and every
glb, base64, into the page, so **re-run the inliner after a rebuild**, or `inline.py --check`
fails on the stale copy. No engine code loads them yet.

1. **Place it.** A layout station has `seat_m` (on the floor) and `yaw_deg`, its seat facing +Z
   at yaw 0. Every row's `operators_m` are floor points, so `seat_m` lands on one: a chair turns
   by `yaw_deg` (its `operators_m` is the floor under its seat), a console faces the seat and
   turns by `yaw_deg + 180`. A wall bank goes on the wall plane with its +Z into the room. The
   variants page reads `operators_m[0][2]` for consoles and chairs alike: keep the field on
   every row.
2. **Draw its faces.** Every recorded screen row says what it `shows` (`console`, `upper` with its
   `half`, or `keys`) and which way is `up`; the images and how to fit them are
   `assets/textures/screens/screens.json` (`tools/mockups/console_screens.py`). The variants page
   draws them 1 cm proud of the recess floor, one draw for the room.
3. **Texture it** the way `shipkit.js` `geometryOf` does the room's own geometry: a primitive's
   material name gives the layer (`materials.json` `layer`) and the span (`span_m`), the surface
   UV is UV0 over the span, and the vertex colour is the bake. `screen` and `accent` are not
   layers: the page colours them. The variants page (`loadProps`, `placeProp`) takes UV0 as
   metres as it is, draws `screen` faces on the `light_panel` layer tinted by the station's role
   colour, and tints `accent` faces with it.
4. **Merge it** into its compartment's one draw, as the bridge mockup's `Props` do (one draw per
   compartment, deck-pipeline section 5); its triangles count against the compartment.
5. **Light it**: `deckc` and the mockup baker light its vertices like any other surface; the
   screens and light strips are emissive.

The main bridge mockup still builds its own box furniture (`stationProps` in
`docs/mockups/bridge.html`). Moving it onto these glbs is a mockup change of its own (the
`threejs-mockups` skill).

## Common failures

| You see | Cause | Fix |
| --- | --- | --- |
| `ModuleNotFoundError: No module named 'bmesh'` | Imported before `bpy` (pip module) | `import bpy` first |
| The render process dies, "Couldn't open libEGL.so.1" | Workbench or EEVEE in a session without OpenGL | Cycles on the CPU |
| `'NoneType' object has no attribute 'color'` setting Freestyle | An empty scene's line set has no line style | `ls.linestyle = bpy.data.linestyles.new(...)` |
| Slivers or a missing face after a Boolean | A cutter face on the face it cuts | Overlap 5 cm (cutters) or 1 cm (union pieces) |
| Flicker where two pieces meet | Coplanar faces facing the same way survived (a plain join, or a union of coplanar inputs) | Union, and move one input 1 cm; `check` names the pair |
| An end face showing through a hole | The hole overlaps the body behind it | Clip the hole region against the body first |
| The triangle count triples | A Bevel over every sharp edge, or after the recesses were cut | Chamfer by weight, before the screens |
| A screen floor split into many triangles | The recess crosses facets or other cuts | One recess per flat panel; on a facet the cutter floor must sit below the lowest facet (the helm arc's 2 cm clears its 6 mm) |
| `non-manifold edges` | An open primitive, or a Boolean on one | Build closed solids; never delete hidden faces by hand |
| A shading seam or smeared light across a hard edge | Smooth shading or shared normals | `use_smooth = False` on every face; the read-back checks every normal is its face's |
| Texture scale wrong in the page | UVs not in metres, or V unflipped | Write (u, 1 - v); the read-back compares the file with `worldUv` |
| `doubleSided: true` in the glb | Blender's material default | `use_backface_culling = True` |
| A different glb from the same script | Another Blender or exporter version | Compare against the versions in `props.json` |
| A face's atlas detail baked as a skewed smear (a recess floor, a band) | The atlas layout unfolded a neighbour across one edge where the charts shared a third vertex, stretching it (fixed in `hs_kit._unfold`, 2026-10-08) | Fixed; if it recurs, look at the prop's atlas PNG: every chart must be its faces' true shape |
| A long face (over about 2 m) cut into triangles in the atlas | A chart longer than the atlas allows at its density is not kept whole | Seam the face (a V-groove or a band across it) so each part fits, as the pressure door's plate seams do |

## Checks before calling a prop done

| Check | How |
| --- | --- |
| Builds, inside its budget, manifold, no overlaps | `build_bridge_props.py` or `build_suite_props.py` (it refuses otherwise, and writes nothing) |
| The file is what it says | The build's read-back: floor at y 0, back at z 0, flat normals, UV0 equals `worldUv`, screens face +Z, every manifest screen on a screen face |
| Reproducible | The builder's `--check`; after a change to `hs_kit.py`, every builder's (the bridge set must stay byte for byte the same) |
| It reads | `render_props.py --set <set>`, then look at `<name>.png` and the contact sheet yourself: crisp, chamfered, purposeful, in the cutaway references' style |
| Dashes | CLAUDE.md 5 grep |
| On the Pi | Not from here: a cloud render is not a Pi measurement (CLAUDE.md 2) |

## Props here, rooms in blender-csg-levels

`blender-csg-levels` is Undercity's level kit: a solid shell carved by room-shaped air cutters
(the boolean leaves the room), trims generated from the room list, `ENT_` empties, one live
Boolean evaluated at export, a Godot import. This skill builds things that stand in a room: solids
built up from blocks, carved and joined, every step applied, one glb per prop in Star Crew's frame
and materials. What they share: cutters carry their faces' materials (Transfer), nothing
coincides (overlap or shorten), the build refuses z-fighting rather than hoping, and you render
the exported file and look at it. A deck's rooms come from `deck-pipeline` and `detailing.json`,
not from either skill.

## References

- Blender 4.5 manual, Boolean modifier:
  https://docs.blender.org/manual/en/4.5/modeling/modifiers/generate/booleans.html (operations,
  Collection operands, solvers Float, Exact and Manifold, Materials Index Based and Transfer, Self
  Intersection and Hole Tolerant; "only manifold meshes are guaranteed to give proper results").
  The Python names are `solver` `FAST`, `EXACT`, `MANIFOLD`.
- Bevel modifier: https://docs.blender.org/manual/en/4.5/modeling/modifiers/generate/bevel.html
  (Limit Method Weight reads `bevel_weight_edge`; Segments; Clamp Overlap; Miter Outer).
- Limited Dissolve:
  https://docs.blender.org/manual/en/4.5/modeling/meshes/editing/mesh/delete.html (Max Angle,
  All Boundaries, Delimit).
- glTF 2.0 add-on: https://docs.blender.org/manual/en/4.5/addons/import_export/scene_gltf2.html
  (+Y Up; meshes are triangulated and flat-shaded edges split vertices; Apply Modifiers; custom
  properties go to `extras` only when included).
- `docs/mockups/lib/shipkit.js` `worldUv`, `geometryOf`; `data/materials/materials.json`;
  `openspec/changes/deck-pipeline/design.md` sections 5 and 5a; `openspec/changes/bridge-stations/design.md`
  section 11.1 (desk and screen sizes).
