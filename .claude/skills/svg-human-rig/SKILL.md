---
name: svg-human-rig
description: Pose and dress a 2D SVG human rig for card art - a skinned 2D skeleton (pelvis to fingertips) whose body and clothing meshes bend smoothly at the joints, posed by dragging joints in a browser app or from a posed 3D (MPFB / Blender) reference, with swappable skin, hair, faces, tops, sleeves, trousers, shoes and hand shapes, exported as SVG or as pose + look JSON. Use whenever a card or illustration needs a person in a specific pose ("draw a colonist", "pose a figure", "human rig", "2D rig", "swap the outfit", "the humans look like mannequins"), when the rig's assets need improving, or when porting the rig to another project.
metadata:
  author: High Frontier fan game (Claude Code), 2026-11-20
  version: "0.1"
---

# SVG human rig

The owner, 2026-11-20, after generated figures came out as mannequins and traced
renders were rejected ("'inspired drawings' not filters, not tracing"): "make a
2d human rig, and pose that, swap out assets etc ... I would make a javascript
app to do this, that way it can be saved as a skill for later use."

## Pieces

| File | What it is |
|---|---|
| `scripts/rig2d/rig.mjs` | The skeleton (`REST` joints, `BONES`), skinning (inverse-distance weights per point over its chain), posing (`makeRig`: each bone maps its rest frame onto the posed one; along-bone stretch for foreshortening, across-bone scale by the figure scale), smooth curves (Catmull-Rom to cubic Bezier). Pure ES module, no DOM, no Node. |
| `scripts/rig2d/figure.mjs` | The assets (body, tops, sleeves, trousers, shoes, hands) as outlines in rest coordinates, and `drawFigure({ id, pose, look, heads })`, which returns `{ defs, svg }`. `poseFromMarks` turns a 3D pose export into a pose; `restPose` places the rest pose on a card. |
| `tools/rig2d/` | The browser app: load a pose, drag joints (optionally with their children), set body and head yaw and the near arm and leg, change every look option, download the SVG, copy or apply the figure JSON. |
| `scripts/blender/colonist_people.py` + `.json` | Optional pose source: MakeHuman (MPFB2) bodies posed in headless Blender, exporting projected joints, head and chest yaw and the near side to `scripts/blender/poses/<scene>.json`. Reference only; nothing from the render is traced. Setup and method: the `blender-humanoid-characters` skill in fps-game-demo / Crab Breeze. |

Faces are the card kit's drawn heads: `artKit().bust` (front and 3/4, by `turn`)
and `poseKit().profile` (true profile), passed in as `heads`.

## Run the app

```
python3 -m http.server 8137        # from the repository root
open http://localhost:8137/tools/rig2d/
```

Load a pose (or start from the rest pose), drag joints, pick the look, then
**Copy figure JSON** and save it as `scripts/rig2d/figures/<scene>.<figure>.json`
(the app loads a saved figure for that scene automatically next time).

## Conventions

- Rest units: one head = 1, origin at the pelvis, y down, the figure's LEFT at +x
  (`...L` bones). Front view, standing, arms down.
- A pose is `{ joints: { name: [x, y] } (card units), yaw, headYaw, nearArm, nearLeg }`.
  Yaw is in degrees: 0 faces the viewer, +90 faces screen right. `headYaw` picks
  the face (front/3-4 under 55, profile to 125, back of the head beyond); the
  look's `face` can force one.
- Draw order: far arm, legs, hip, neck, torso, head, near arm.
- Adding an asset: write its outline in rest coordinates, give it the bones it
  follows (its chain), and add it to `drawFigure`. Points near a joint are
  blended automatically; never cap a joint with a circle (the owner flagged the
  round shoulders).

## Checks

- Render in the app and in headless Chromium (`scripts/screenshot.mjs`), and
  look before saying a figure is done. Show the owner a screenshot before any
  figure goes into the game (CLAUDE.md: SVG art needs a rendered preview first).
- Proportions: compare against the pose reference or the printed card. Heads
  too small and long thin necks are the usual faults.
