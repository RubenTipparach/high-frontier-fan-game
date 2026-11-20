---
name: character-kit
description: Generate flat vector "character constructor" kits - a front-facing cut-out character built from rigid parts with round joints, with swappable heads (expressions), hair, hands, tops and bottoms, posed by rotating bones, and laid out as a kit sheet (rest figure, exploded parts, expressions, hair, hands, posed examples) or exported as single posed figures (SVG / pose JSON) for card art. Use whenever someone asks for a character kit, a character constructor or creator, a cut-out or puppet character, a turnaround, a rigged 2D person, swappable faces / hands / outfits, or a flat-style person for a card or illustration ("make a kit", "character sheet", "pose a colonist", "cut-out rig", "flat character").
metadata:
  author: High Frontier fan game (Claude Code), 2026-11-20
  version: "1.0"
---

# Character kit (flat cut-out style)

The owner, 2026-11-20, after skinned and traced figures were rejected ("her butt is
messed up, legs and arms are all wrong, arm sleeves not attached to body, I can see
a seam with skin"), sent stock "character constructor" sheets as the target: a
flat vector person drawn at rest, the same person exploded into parts, a row of
heads with expressions, a set of hands, arm variants and a posed example. "Do some
more research on this art style and make a proper skill for generating kits."
This skill is that style, written down as rules plus the code that follows them.

## The style (what makes it read as a "kit")

These are the conventions the stock kits share (Freepik / GraphicMama /
Creative Market "constructor" and "creation kit" packs, and the cut-out puppet
pipelines in Adobe Character Animator, Duik and Godot's cutout tutorial):

1. **Flat colour, no outlines, no gradients.** Each material (skin, shirt,
   trousers, hair, shoes) has exactly two tones: the base and ONE darker shade.
   The shade is a crescent on the side away from a fixed light (screen left).
   No black line art; shapes are separated by colour alone.
2. **Rigid parts, one per bone.** Head, neck, torso, pelvis, upper arm, forearm,
   hand, thigh, shin, foot. Nothing bends inside a part; posing only rotates parts
   about their joints (forward kinematics from the pelvis).
3. **Round joints, centred on the pivot, equal radius on both sides.** A limb
   segment is a capsule whose end circles sit ON the joints. The child's start
   circle has the same radius as the parent's end circle, so at any angle the
   child covers the parent's end exactly: no gap, no notch, no seam. This is the
   single rule that makes a cut-out rig look whole. The kits' exploded view shows
   it: every limb piece has a rounded end where it plugs in.
4. **Overlap hides the rest.** Parts that do not share a colour at a joint
   overlap instead: the sleeve cap (cloth colour) laps over the torso (same
   cloth); thigh tops tuck under the pelvis piece (the trouser top); the neck
   tucks under the torso neckline and the head. Character Animator attaches parts
   the same way (a child must overlap its parent to stay welded).
5. **Clothes belong to the part they cover.** A short sleeve is a flared piece on
   the upper arm with a straight hem; trousers are the pelvis piece plus the
   thigh / shin capsules in cloth colour; shorts are a hem on the thigh.
6. **Proportions: about 6.3 heads, big head, slim limbs.** Stylised, not
   anatomical (stock flat kits sit between 5.5 and 7 heads). Shoulders a little
   wider than the hips on men, hips wider and waist narrower on women. Short neck.
7. **Simple face.** Dot eyes, short brow strokes, a tiny nose hook, a small
   mouth, optional blush ovals. Expressions are SWAPS of eyes / brows / mouth,
   never a deformation.
8. **Hands and heads are swaps.** Rotation alone cannot make a fist or a
   pointing finger, so each hand pose is its own drawing on the hand bone (the
   Godot cutout docs make the same point: use cel swaps for hands and feet).
9. **Draw order is part of the rig.** Back hair, arms marked behind, legs, pelvis,
   torso, neck, head, front arms, hands. Child-over-parent alone gets this wrong
   (a far arm over the torso), so order by layer, not by hierarchy.
10. **One view per part set.** Front first. A 3/4, side or back view is a new
    set of parts on its own rest skeleton (the kits draw a turnaround), not a
    rotation of the front parts.

## Builds and styles

- **Styles** (`look.style`, `STYLES` in cutout.mjs): `slim` (the first kit, too
  thin for the owner), `classic` (the default: thicker limbs, broader body, head
  1.12x, like the stock constructor kits), `chunky` (rounder, head 1.3x). Always
  get the skeleton with `skeletonFor(look)` so props land on the same joints the
  figure is drawn with.
- **Robot** (`body: 'robot'`, `ROBOT_LOOK`): the same skeleton in plates, with
  visible round joints, a visor and eye lights. Armour suits use it too.
- **Beard** (`look.beard`: short / full): a ring from the sideburns round the
  jaw, the mouth left open on top. Check beards on a big render; they go wrong
  easily.
- **Foreshortening** (`pose.len: { bone: factor }`): a limb pointing at the
  viewer is shortened along its bone (binoculars, a handshake toward the
  camera). A front view cannot bring hands to the face without it.
- **Reach** (`reach(sk, pose, side, [x, y], { limb, bend })`): two-bone IK for
  a hand or foot on a target. Try both `bend` signs and look: one usually
  crosses the body or folds the elbow backwards.

## Hands: the hand rig

`scripts/rig2d/hand.mjs` is a second rig with the body's rules: a skeleton
drawn once at rest (an open right hand, back view, fingers down; a side view
for grips), rigid round-jointed phalanges with matching radii at every joint,
and poses that only rotate bones (`rot`) or shorten a bone folded toward the
viewer (`len`). Joint limits: a thumb's outer joints only curl toward the palm,
and side-view finger joints only curl forward (the owner caught a thumb bent
backwards). `HAND_POSES` are settings of the rig (relaxed, open, wave, fist,
point, peace, thumb, ok, hold, pinch, flat). Pose new hands in
`tools/rig2d/hand.html` (drag joints, fold sliders, copy the JSON). Hands are
FLAT: one colour, no shade crescent, no crease lines (the owner asked whether
hands need shading at all; the kits' hands have none). A thumbs-up is POSED
from the rig, never drawn as a special shape (the owner: "that's violating every
rule"): the hand turned on its side (palm -90), palm to the viewer, each
finger's first bone folded toward the viewer (short), its middle bone turned
back across the palm (the stacked bars, finely outlined), thumb straight up. A look's
`hands.L` / `hands.R` take a pose name or a pose object. Never draw hands as
loose generated finger sticks; that was rejected twice.

## The code

| File | What it is |
|---|---|
| `scripts/rig2d/cutout.mjs` | The kit. `skeleton(body)` (rest joints + joint radii per build), `fk` / `aim` (forward kinematics, turn a bone toward a point), shape builders (`capsule`, `sleeve`, `blob`), the parts (`buildParts(look)`: head + hair + face, torso, pelvis, arms, hands, legs, shoes), `drawCutout({ id, look, pose, explode })`, `drawHead`, `drawHand`, `OPTIONS` (every swap), `DEFAULT_LOOK`, `POSES` (named poses). Pure ES module. |
| `scripts/rig2d/kit-sheet.mjs` | Lays a kit sheet out: rest figure, exploded parts, the expression row, the hair row, the hand set, posed examples. `node scripts/rig2d/kit-sheet.mjs` writes `docs/design/kits/kit-female.svg` and `kit-male.svg`; `node scripts/rig2d/kit-sheet.mjs look.json out.svg` builds one from a look. |
| `tools/rig2d/` | The browser app: the character at rest; drag a joint to rotate its bone (drag the pelvis to move), pose presets, every look option, arms behind, download SVG, copy / apply / load figure JSON (`scripts/rig2d/figures/<name>.json`). |

Units: one head = 1, origin at the pelvis, y down, the figure's LEFT at +x. A pose
is `{ root:[x,y] px, scale px per head, rot:{ bone: local degrees, root: deg },
armsBehind:['L'|'R'] }`; positive degrees turn clockwise on screen, so an arm on
screen right (`...L`) lifts outward with NEGATIVE degrees and the screen-left arm
(`...R`) with positive.

## Run it

```
node scripts/rig2d/kit-sheet.mjs                 # the two default kit sheets
python3 -m http.server 8137                      # then open /tools/rig2d/
```

Render to PNG with headless Chromium (no `rsvg-convert` here): load the SVG into a
page with Playwright (`NODE_PATH=$(npm root -g)`) and screenshot it.

## Making a new kit

1. Pick the look: `{ body, skin, hair, hairStyle, face, top, topColor, collar,
   bottom, bottomColor, shoes, hands:{L,R}, blush }`. Keep to a small palette
   (two tones per material, at most five materials).
2. Build the sheet and LOOK at it before anything else. Check the rest figure for
   seams at every joint, sleeves reading as attached, hips and seat as one piece.
3. Pose figures in the app or in code (`POSES` plus local tweaks). Rotate from
   rest only; never move a joint directly.
4. Save each figure's JSON under `scripts/rig2d/figures/` so it can be rebuilt.

## Adding a part or a swap

- **A new garment / limb piece:** write it in rest coordinates on ONE bone, with
  its round end on the joint (`capsule`) and the same radius as its neighbour at
  that joint. If two colours meet at a joint, make one piece overlap the other
  instead of butting them.
- **A new hand:** a list of shapes in hand-local coords (origin at the wrist, +y
  down the hand, +x toward the body for the RIGHT hand; the left is mirrored).
  Add the name to `OPTIONS.hand`.
- **A new expression or hair style:** a case in `faceShapes` / `hairShapes`,
  drawn on the face centre `cy`; hair that falls behind the body goes in `back`.
  Add the name to `OPTIONS`.
- **A new view (3/4, side, back):** a new skeleton and part set; keep the joint
  names so poses and the app carry over.

## Checks before showing anyone

- Render the kit sheet and at least three posed figures, and look: no seam or
  notch at any joint at any angle, no part floating free, arms behind are behind.
- Hands at the right size (about 0.4 head from wrist to fingertip); heads about
  1/6 of the height.
- CLAUDE.md: SVG art goes to the owner as a rendered screenshot first, and only
  goes into the game after sign-off.
