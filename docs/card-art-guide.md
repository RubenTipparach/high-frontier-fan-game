# Patent card art - guide

Original background art for patent cards (thrusters first, other decks to follow).

## The rule: background only

The art is the `background-image` of the card's `.card-body` and NOTHING else.
No element moves, resizes, or changes colour: same thrust triangle, same
supports box, same blurb, same positions (user directive 2026-11-13: "pics are
just backgrounds like the colonist cards" / "don't change my layout"). Do not
add text outlines or backing panels for legibility either (user: "no dont do
that"). The CSS is the single `.card-face.has-bg-art .card-body` rule in
`css/cards.css`. Do NOT reuse the colonist `.has-art` class for patent cards:
that recipe docks the thrust triangle lower-left, which is a layout change.

## Original art only

Generate the art; do not use photos or other people's images (user 2026-11-13:
"you need to generate your own art"). A first pass with NASA photos was
dropped for that reason. Each face draws its own technology: the black back of
a card is a different engine, so it gets a different picture, never a recolour.

Two directions were mocked up for the user (vector vs Blender; see the
"Thruster Card Art" mockup artifact). **The user chose VECTOR (2026-11-13:
"I personally prefer the svg versions") and approved all 24 thruster faces
for the game.** Every engine is drawn bolted to a spacecraft (user: "you need
some kind of spaceship attached to your engines"): use the generator's ship
kit (`shipBody` tug / crewed / freighter / probe + the `RIG` mounts) for new
decks rather than drawing bare engines.

- **Vector** - `scripts/gen-card-art.mjs` (shared kit in
  `scripts/card-art/kit.mjs`, one module per deck: `thrusters.mjs`,
  `robonauts.mjs`) writes `assets/cards/<deck>/<id>-<front|back>.svg` and the
  generated manifest `data/card-art.js`. LIVE: all 24 thruster faces and all
  24 robonaut faces (user approved the robonauts 2026-11-13). Same idiom as the colonist art
  (`scripts/gen-colonist-art.mjs`): dark space gradient, seeded starfield,
  glowing subject. Deterministic, no `Math.random()`.
- **Blender** (comparison only, NOT shipped) - `scripts/blender/render_thruster_art.py`,
  all 24 faces using the `blender-hard-surface` skill's method (scripted scene,
  lathed profiles, Cycles on the CPU via `pip install bpy`). Renders a
  transparent PNG, composited onto the card backdrop.

## Approval gate

`data/card-art.js` carries `approved` per face; only approved faces render in
the game. Show the user rendered previews first (CLAUDE.md: SVGs are shown
before they are used). `scratchpad/thruster-art-preview.html` sets
`globalThis.HF_CARD_ART_PREVIEW = true` to show pending art on real cards. To
ship, add the approved keys (`'<cardId>:primary'`, or `'*'`) to the
generator's `APPROVED` set and re-run it.

## Where it is read

`js/game/card-ui.js#buildFace` reads `CARD_ART[card.id][face]` and paints it.
`assets/` is copied whole into the production build, so new art files need no
build change.

## Text and triangle over the art (user 2026-11-13)

On a `.has-bg-art` face the thrust triangle is 50% opaque, and the ability
text (`.card-blurb`) and the Supports Required panel follow the colonist-card
treatment: a 60% black box with light ink, no outline on the white face, a
faint light outline on the dark face, and an empty blurb collapses. Those are
the only styling changes; nothing moves.

## Research each card's real machine first (user 2026-11-13)

Every face is a real or seriously proposed technology. Look up what it
physically is before drawing it, and draw THAT anatomy: the first robonaut
pass used three templates (a ship firing a beam, a rocket with a plume, a
rover) and the user rejected it as generic. Each robonaut face now shows its
own machine (e.g. the FEL's striped undulator, Kuck's comet rig under its
water bag, the MagBeam plasma column into a magnetic bubble). The HF4 rules'
designer notes fix the roles: rayguns fire at the surface from orbit and read
the vapour's spectrum; buggies scoop and process regolith; missiles assay rock
by melting it with their exhaust, so a missile's exhaust or beam is aimed AT
its rock. Check every scene is aimed at its target. The published-card gallery
(hf4map.com) has lapsed; its robonaut images were never archived.
