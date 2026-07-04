# Colonist card art - design guide

How the M2 Colonist deck's card-body illustrations are authored, generated,
and wired into the card renderer. Read this before touching colonist art or
adding art to any other card type.

## What it is

Each of the 18 M2 colonists (see `data/colonists.js`) has two background
illustrations:

- `assets/colonists/<id>-front.svg` - the **White (working) face**.
- `assets/colonists/<id>-back.svg` - the **Purple (promoted) face**.

They paint as the `background-image` of the card's `.card-body`, behind the
existing card content. The card **layout never changes** - the art sits
behind the same stats / blurb / supports / thrust the card always had.

## The locked-in recipe (agreed with the user)

1. **Card layout is unchanged.** No element is moved, resized, or restyled for
   the art except the two points below. The art shows through because the body
   content goes transparent, framed by the card's own solid header / stat box /
   footer (the "white side frame" look).
2. **Transparent body content.** On a `.card-face.has-art`, the `.card-stats`,
   `.card-properties`, `.card-blurb`, `.card-supports`, `.card-thrust`,
   `.card-thrust-mod`, and `.card-future` backgrounds are cleared so the art
   shows behind them.
3. **Front text gets a 1px outline.** Over the illustration the body text needs
   a thin outline to stay legible. A **Human** colonist has a parchment front
   with dark ink -> **white** outline; a **Robot** colonist has a black front
   with light ink -> **dark** outline. The promoted purple face reads fine with
   no outline.
4. **Thrust triangle docks lower-left.** On `.has-art` faces the thrust
   triangle keeps its **original size** but is absolutely positioned to the
   lower-left corner (`left:4px; bottom:-20px`) so the art has an open column
   and the triangle never blocks the Future-mission text.
5. **Back face always washes purple.** Every promoted-face SVG uses this app's
   established Tier-2 gradient `#655ca8 -> #652d91` - the exact one
   `css/cards.css` already paints for every promoted card - so the promoted
   side reads consistently "purple" like the rest of the game.
6. **No ideology / delegate colour in the art, ever.** The seat/ideology colour
   is a wholly separate visual system (the delegate cube). Colonist art keys
   only off the colonist's own concept palette (front) and the fixed purple
   wash (back).
7. **Front and back are genuinely different illustrations.** Not a recolour of
   the same shapes - a new subject, or the same subject visibly transformed
   (matching how the published cards pair front/back).

## Where it lives

- **`scripts/gen-colonist-art.mjs`** - the generator. Run
  `node scripts/gen-colonist-art.mjs`. It writes all 36 SVGs, a review contact
  sheet (`assets/colonists/_contact-sheet.html`), and the manifest
  `data/colonist-art.js`. It is TEMPLATED: shared frame/gradient/starfield
  plumbing (`panel`, `starsField`, `purpleBackDefs`) and reusable silhouette
  primitives (`helmetBust`, `hoodedFigure`, `droneChassis`, `swarmCluster`,
  `sailScene`, `nanite`, `biomechArm`, `profileHeadChip`, `bowedRoyal`,
  `orreryScene`) are defined once and composed per colonist. Add a new
  primitive rather than copy-pasting shapes.
- **`data/colonist-art.js`** - AUTO-GENERATED manifest, a `Set` of colonist ids
  that have art. Do not hand-edit; re-run the generator.
- **`js/game/card-ui.js`** - `buildFace` reads `COLONIST_ART_IDS`; for a
  colonist with art it sets the body `background-image` (via `assetUrl`) and
  adds `.has-art` to the face.
- **`css/cards.css`** - the `.card-face.has-art ...` block implements the
  recipe (points 2-4 above).

## Deterministic output

The generator uses NO `Math.random()` / `Date.now()` - the starfield is a
seeded PRNG keyed per piece - so regenerating produces byte-identical SVGs.
That keeps the checked-in art diff-clean unless a shape actually changed.

## Reference

Art is authored against the official card gallery at
`https://www.hf4map.com/cards/colonist/<n>` (front/back images at
`/cards/colonist/card<n-1>.jpg` and `card<n-1>b.jpg`). Cross-check the concept
and front/back pairing there; cards 19-36 are M4 and out of scope.

## Adding / reworking a colonist's art

1. Edit its block in `scripts/gen-colonist-art.mjs` (reuse a primitive or add a
   new one - never duplicate shape code).
2. `node scripts/gen-colonist-art.mjs`.
3. Review `assets/colonists/_contact-sheet.html` (render it to PNG and eyeball
   it) BEFORE relying on it in the app, per CLAUDE.md's "show a rendered
   screenshot first" rule.
4. The manifest + wiring pick it up automatically; no CSS or JS change needed
   for an existing colonist.
