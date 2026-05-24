# Industrialize - requirements

Working doc for the factories / exo-production / colonization slice.
The previous WIP (now reverted) made several wrong assumptions about
the rules. This file restarts the design discussion from corrected
requirements so we don't ship the wrong mechanic again.

Edit freely. Lines marked `[?]` are open questions that need an answer
before code lands. Lines marked `[FIXED]` are decisions already made.

## What the previous attempt got wrong

For the record so we don't repeat:

- Treated **industrialize** and **build refinery** as two separate
  ops with two chits. They are the same action / the same chit.
- Added **Bernal stations** as the colonization endpoint. There are
  no Bernals in this design.
- Modelled **colonists** as a counter awarded by Bernal collapse.
  Colonies are produced by converting a crew card, not by a body-
  threshold collapse.
- Assumed a **single rocket stack** per player. The design needs
  multiple stack support from here forward.

Those concepts and the code that backed them are gone. Starting
clean from this doc.

## Corrected core mechanics

[FIXED] **Industrialize == build refinery.** One operation, one chit
type. A successfully prospected site can be industrialized; the
resulting "factory" IS the refinery. Whatever income / production
the chit grants, it grants from the moment it lands. No upgrade tier.

[FIXED] **No Bernal stations.** Drop from the design. The published
HF4 Bernal mechanic is not on the table for this sandbox slice.

[FIXED] **Crew -> Colony is the colonization path.**
- Trigger: a free action (does not cost an operation).
- Cost: one crew card from the player's available crew.
- Effect: a colony token is placed somewhere (see open Qs).
- Aftermath: the consumed crew card returns to LEO.

[FIXED] **Multiple ship stacks.** From this point on, a player can
have more than one stack in play. Industrialize and convert-crew
ops operate on a specific stack, not on "the rocket".

## Open questions that gate implementation

### A. Industrialize action

- [?] **A1.** What does the rocket stack need to carry to industrialize?
  The published rule wants a robonaut + something to power it.
  Should the sandbox match (any robonaut + any reactor in the
  stack), or simpler (any robonaut), or different?
- [?] **A2.** Does the industrialize action consume cards from the
  stack? In real HF4 the robonaut is delivered to the site. For
  the sandbox-lite slice, do we:
  - leave the cards in the stack (current convenience), or
  - move the robonaut card to the site (proper rules), or
  - return the robonaut to LEO / discard?
- [?] **A3.** Does industrialize cost an operation, water, or are
  both free given the stack gate?
- [?] **A4.** What does the factory chit produce, and when?
  - water income at end of round?
  - aqua income?
  - exo-production capability (matches card spectral type)?
  - other?
- [?] **A5.** Spectral type. The chit needs a spectral for exo-
  production matching. Where does it come from?
  - the site (data/sites.js does not yet carry per-site spectral),
  - the robonaut card used,
  - the player chooses at industrialize time,
  - derived from site.type as a sandbox fallback?
- [?] **A6.** VP. Does industrializing award VP directly, or does
  VP come only through later glory / scoring hooks?

### B. Crew -> Colony conversion

- [?] **B1.** Where do colonies live? Options:
  - on a specific factory (a factory site can host a colony),
  - on a body (one colony per body, not per site),
  - in a separate "colonies" inventory tied to the player.
- [?] **B2.** Is the colony a permanent state on the site/body, or
  a token that can move / be consumed later?
- [?] **B3.** What gates the action? Just "have a crew card with
  the colonize ability", or any crew card, or only crew currently
  parked at the target?
- [?] **B4.** "Returns to LEO" means the crew card is...
  - back in the player's hand at LEO,
  - in an at-LEO availability pool (separate from hand),
  - in the LEO stack of an existing rocket?
- [?] **B5.** Free action: free of operations AND free of water,
  or just free of operations?
- [?] **B6.** Reward for converting? Glory chit? VP? New ability
  unlocked at the site?
- [?] **B7.** Can a crew be converted only at an industrialized
  site, or anywhere?

### C. Multiple stacks

- [?] **C1.** How does the player switch the "active" stack in
  the UI? (top-bar dropdown, click the rocket on the map, ...)
- [?] **C2.** Are stacks named / numbered, or addressed by their
  current location?
- [?] **C3.** Hand sharing: does the player have one hand that
  feeds all stacks, or per-stack hands?
- [?] **C4.** Aqua / water bank: shared across stacks, or per-
  stack tank?
- [?] **C5.** Can ops target a stack the player isn't currently
  "viewing", or must the active stack be the one acted on?
- [?] **C6.** Starting state: does a player begin with one stack at
  LEO and grow, or several at LEO?
- [?] **C7.** Persistence: same `rocket.js` storage shape extended
  to a keyed map (`{stackId: {...}}`), or a parallel
  `stacks.js` module that wraps it?

### D. Map rendering

- [?] **D1.** Factory chit visual. The chit conflates the old
  factory + refinery roles, so we need one icon. Options:
  - hex with `⚙` glyph (production),
  - hex with `🏭` glyph,
  - droplet for water-producing visual,
  - something closer to the published HF4 factory token (look up).
- [?] **D2.** Colony visual. A small `🛖` or flag glyph anchored
  to the body / site.
- [?] **D3.** Multi-stack indication. When two stacks share a site,
  do we draw one rocket sprite with a count badge, or two
  staggered sprites?

### E. Stack-shaped engine changes (forward-looking)

Not strictly part of this slice but the design has to leave room:
- [?] **E1.** Do we lift `rocket.js` into a `stacks.js` module
  this PR, or stay single-stack for now and refactor next PR?
- [?] **E2.** The site popup currently asks "rocket parked here?"
  via `getRocketSite()`. With multiple stacks the question
  becomes "ANY of my stacks parked here?" / "WHICH of my stacks
  is parked here?". UI needs to disambiguate when more than one.

## What we keep from the existing sandbox

- Prospect discs (`discs.js`) - claim markers and exhausted-site
  markers stay as the precondition for industrialize.
- Aqua bank + per-stack tank (`rocket.js`) - the cost / income
  story for factories should plug in here.
- Mission log (`mission-log.js`) - new ops log here.
- Glory module (`glory.js`) - if industrialize awards VP, route
  through `addVps` so chit + raw VP totals stay reconciled.
- Turn clock - end-of-round hook already exists for income.

## What we throw away from the previous attempt

For context when reading the PR history:

- Any "factory vs refinery" two-tier model.
- The `factories.js` module that backed it.
- All Bernal collapse code, modal, and render layer.
- The colonist counter chip (replace with whatever the new colony
  inventory needs).

## Next steps

1. User answers the `[?]` questions above (or marks them
   "decide later, code minimal").
2. Decisions get hoisted into a short "Spec" section at the top
   of this file.
3. Implementation PR cites this doc and matches the spec.
