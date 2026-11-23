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
back across the palm (flat, the scalloped edge shows them), thumb straight up
and short. A look's
`hands.L` / `hands.R` take a pose name or a pose object. Never draw hands as
loose generated finger sticks; that was rejected twice.

## The code

| File | What it is |
|---|---|
| `scripts/rig2d/cutout.mjs` | The kit. `skeleton(body)` (rest joints + joint radii per build), `fk` / `aim` (forward kinematics, turn a bone toward a point), shape builders (`capsule`, `sleeve`, `blob`), the parts (`buildParts(look)`: head + hair + face, torso, pelvis, arms, hands, legs, shoes), `drawCutout({ id, look, pose, explode })`, `drawHead`, `drawHand`, `OPTIONS` (every swap), `DEFAULT_LOOK`, `POSES` (named poses). Pure ES module. |
| `scripts/rig2d/kit-sheet.mjs` | Lays a kit sheet out: rest figure, exploded parts, the expression row, the hair row, the hand set, posed examples. `node scripts/rig2d/kit-sheet.mjs` writes `docs/design/kits/kit-female.svg` and `kit-male.svg`; `node scripts/rig2d/kit-sheet.mjs look.json out.svg` builds one from a look. |
| `scripts/rig2d/hand.mjs` | The hand rig: rest skeletons (back, side), FK with joint limits, `handPieces(pose)`, `HAND_POSES`. |
| `tools/rig2d/hand.html` | The hand editor: drag a joint, fold sliders per finger, back / side view, copy the pose JSON. |
| `scripts/colonist-art-traced.mjs` | The colonist card FRONTS with people: `FIGS` (each card's people as `{ fid, look, pose(sk) }`) and the backdrop + props per card, hung off the posed joints. |
| `scripts/colonist-art-backs.mjs` | The promoted (purple) sides, second pass: kit people and the redrawn non-human subjects. |
| `scripts/gen-colonist-art.mjs` | Writes every `assets/colonists/<id>-<front|back>.svg` and `data/colonist-art.js`. Later passes override earlier ones per id (`emit` skips an id a later module owns). |
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
- **A new hand pose:** pose it in `tools/rig2d/hand.html`, copy the JSON, add it
  to `HAND_POSES` in `hand.mjs` and its name to `OPTIONS.hand`. Never hand-draw a
  one-off hand shape.
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

## Putting people on cards (colonist art)

1. Add the card to `FIGS` (fronts, `colonist-art-traced.mjs`) or `BACKS`
   (`colonist-art-backs.mjs` / `colonist-art-traced.mjs#BACKS`): one entry per
   person, `{ fid, look, pose: (sk) => pose }`. Get the skeleton with
   `skeletonFor(look)`, never `skeleton(body)` alone, or props land off the body.
2. Frame full figures on the 300 x 330 card at about 46 px a head, feet near
   y 324 (`at(x, foot, h, rot)`). Two people stand about 110 px apart.
3. Hang props off the posed joints: `F.m('<fid>.hand_r')`, `.head`, `.spine_03`
   (the MPFB names map to kit joints). Draw a prop held in a hand AFTER the
   figures and lay the gripping fingers back over it (the Teleoperators rose).
4. `node scripts/gen-colonist-art.mjs`, then render through the GAME's card
   renderer (`renderCard` from `js/game/card-ui.js`, no `type` option, so the
   card carries its real classes), not just the bare SVG.

### Pose cookbook

| Want | How |
|---|---|
| Hand on a target (a hologram, a knee, a screen) | `reach(sk, pose, 'L'|'R', [x, y], { bend })`; try both bend signs, keep the one whose elbow points out and down. |
| Handshake | both figures `reach` the SAME midpoint between them, about waist height, `hold` hands. Move the figures closer if `reach` cannot get there (it clamps). |
| Hands to the face (binoculars, chin) | foreshorten the upper arms (`len: { upperL: 0.5, upperR: 0.5 }`) then `reach`; without it the elbows fly up beside the head. |
| Hands on hips | `POSES.hipsHands` (upper -38 / 38, fore 78 / -78), fists. |
| Wave, cheer, point, shrug, think | `POSES.wave` / `cheer` / `point` / `shrug` / `think`, plus the matching hand pose. |
| Sitting cross-legged (levitating) | thighs -78 / 78, shins 150 / -150, hands `reach` the knees; drop the feet line to about y 300. |
| Stride | `POSES.stride`; a front view cannot sell a walk, so keep it small. |
| Two people meeting | each `reach`es toward the gap between them; draw the light / object over the hands. |
| Silhouettes (a family at dawn) | draw kit figures inside a flat-colour `feColorMatrix` filter with `color-interpolation-filters="sRGB"`. |
| Robots, armour | `ROBOT_LOOK` (same skeleton and poses). Robot hands are rigged hands in the joint colour. |

### What the owner rejected (do not repeat)

- Busts and figures generated procedurally, traced from renders, or fitted to 3D
  poses ("inspired drawings, not filters, not tracing"); anything posed that was
  not drawn at rest first.
- Skinny limbs (use `classic`), seams at joints, sleeves not attached, a broken
  hip / seat.
- Elbows in impossible places; a thumb bending backwards; generated finger
  sticks; shaded or outlined hands; a one-off drawn hand that skips the rig.
- Arms that do not meet in a handshake; a prop floating near a hand instead of
  held.
- A face half-covered by a plate that does not follow the head outline (split
  with a mask of the head, clipped at the centre line).
- Blur behind card text (a faint dark backing only).

## Comparing with the printed cards

Owner check before sign-off: a page with each colonist's printed front, ours,
printed promo side, ours. The printed scans live outside the repo (they are the
publisher's art); build the page in a temporary folder at the repo root, render it
full-page in Chromium, slice it into pages, and keep the result out of git. The
in-repo sheet of only OUR cards is `docs/design/kits/all-colonist-cards.jpg`.
