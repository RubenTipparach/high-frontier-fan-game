---
name: svg-human-rig
description: Pose and dress a 2D SVG human rig for card art - a front-facing character rigged with a 2D skeleton (pelvis to fingertips) whose body and clothing meshes bend smoothly at the joints, posed by ROTATING its bones from the rest pose (drag a joint in the browser app), with swappable skin, hair, faces, tops, sleeves, trousers, shoes and hand shapes, exported as SVG or as pose + look JSON. Use whenever a card or illustration needs a person in a specific pose ("draw a colonist", "pose a figure", "human rig", "2D rig", "swap the outfit", "the humans look like mannequins"), when the rig's assets need improving, or when porting the rig to another project.
metadata:
  author: High Frontier fan game (Claude Code), 2026-11-20
  version: "0.1"
---

# SVG human rig

The owner, 2026-11-20, after generated figures came out as mannequins and traced
renders were rejected ("'inspired drawings' not filters, not tracing"): "make a
2d human rig, and pose that, swap out assets etc ... I would make a javascript
app to do this, that way it can be saved as a skill for later use." And: "you
should rig a 2d front facing character, then pose them, you cant pose something
thats already posed." So the character is drawn ONCE, standing front-facing at
rest; a pose is only bone rotations away from that rest (forward kinematics).
Never fit the meshes onto an already-posed figure.

## Pieces

| File | What it is |
|---|---|
| `scripts/rig2d/rig.mjs` | The skeleton (`REST` joints, `BONES`, `PARENT`), forward kinematics (`fkJoints(pose)`: each bone rotates about its start joint, local angles add down the chain, lengths never change; `aimBone` turns a bone toward a point), skinning (inverse-distance weights per point over its chain; `makeRig` maps each rest bone frame onto the posed one), smooth curves (Catmull-Rom to cubic Bezier). Pure ES module, no DOM, no Node. |
| `scripts/rig2d/figure.mjs` | The assets (body, tops, sleeves, trousers, shoes, hands) as outlines in rest coordinates, `restPose()`, and `drawFigure({ id, pose, look, heads })`, which returns `{ defs, svg }`. |
| `tools/rig2d/` | The browser app: the character at rest; drag a joint to rotate the bone that ends there, drag the pelvis to move it; size, arms in front of or behind the body, every look option; download the SVG, copy or apply the figure JSON, load a saved figure by name. |
| `scripts/blender/colonist_people.py` | Optional: MakeHuman bodies posed in headless Blender, to LOOK at a pose while setting the rig's rotations by hand. Never fed into the rig. |

Faces are the card kit's drawn heads: `artKit().bust` (front and 3/4, by `turn`)
and `poseKit().profile` (true profile), passed in as `heads`.

## Run the app

```
python3 -m http.server 8137        # from the repository root
open http://localhost:8137/tools/rig2d/
```

Start from the rest pose, drag joints to rotate bones, pick the look, then
**Copy figure JSON** and save it as `scripts/rig2d/figures/<name>.json`; **Load
saved** brings it back by name.

## Conventions

- Rest units: one head = 1, origin at the pelvis, y down, the figure's LEFT at +x
  (`...L` bones). Front view, standing, arms down.
- A pose is `{ root: [x, y] (the pelvis on the card), scale (px per head), rot: {
  bone: local degrees }, armsBehind: ['L'|'R'] }`. All zeros is the rest pose.
  Positive degrees turn clockwise on screen.
- The face is a look option: front, three-quarter left or right, profile left or
  right, back of the head.
- Draw order: arms marked behind, legs, hip, neck, torso, head, the other arms.
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
