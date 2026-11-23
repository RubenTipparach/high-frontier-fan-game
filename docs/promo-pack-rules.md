# Promo card pack rules

The extra rules printed on the promo packs' rules cards, transcribed word for
word, with notes on how they meet this implementation. The faction promo crew
already in `data/crew.js#PROMO_CREW` (BRIN, Cerulean, Makers Guild, ...) has
its own status board in `docs/promo-crew-plan.md`. Add each new pack here as
its rules cards turn up.

Photos of the printed cards live in `reference/promo-pack-<n>/`.

## Promo Card Pack 3: Ground Crew

Status: **rules transcribed; nothing built.** The 18 Ground Crew cards
themselves (names, faces, privileges, thrusters) are NOT in the repo yet: no
sheet tab, no `data/` records. They have to come into
`reference/HF4-card-data.xlsx` first, like every other card (see "Card data -
single source of truth" in `CLAUDE.md`).

Product SMG28-4p3. Design: Geoff Speare and Lou Wainwright. Photos:
`reference/promo-pack-3/0-pack-card.jpg` to `3-flip-occasions.jpg`.

### Pack card (verbatim)

> HIGH FRONTIER 4ALL | PROMO CARD PACK 3
>
> GROUND CREW
>
> Contains 18 new Ground Crew Cards that can be used instead of the Core Crew
> Card of the same color.
>
> The cards are ground crews so they do not need a Home Bernal to activate
> their Privilege, and have memory (retain their faceup or facedown status when
> Decommissioned).
>
> Needs Modules 0, 1 and 2 to be played.

### Rules card 1: Ground Crew Rules (verbatim)

> **Recommended Setup.** Randomly choose 2 Cards for each color from this deck
> that match the modules you are playing with (there should always be 2 but may
> be more). Players may choose either of those 2 cards for their color, or the
> Core Crew Card.
>
> **Ground Crew Icon** (a figure with two red batons). A Crew Card with this
> icon on one or more sides must start play with that icon faceup during setup.
> (If one side has the icon, that side starts faceup; if both sides have it, the
> player chooses.)

### Rules cards 2 and 3: Memory Icon (verbatim)

> **Memory Icon** (a chip). A Crew Card with this icon retains their faceup side
> even if Decommissioned or otherwise removed from a Stack. It also means that
> their faction privileges (B6a) are enabled by an Earth-based facility, and so
> do not need a Home Bernal to unlock them (2A7a, 2B3b). They are still
> inactivated by Anarchy or War.
>
> Ignore the card's facedown side unless explicitly mentioned. It may flip
> during the following occasions:
>
> - May flip to non-ground-side (free action) at your Anchored Home Bernal
>   (including ET Home Bernal or The Station from Promo Pack 1).
> - May flip to ground-side (free action) at LEO if you have no Anchored Home
>   Bernal (including ET Home Bernal).
> - Must flip to ground-side (immediate) if The Station is Discarded and you
>   have no Anchored Home Bernal (including ET Home Bernal), regardless of
>   location.
>
> Otherwise retains its faceup-side even if Decommissioned.

### How this meets our engine (notes for whoever builds it)

- **Module gate.** Needs M0 + M1 + M2. Our promo crew gate is per face
  (`needsModules` in `data/crew.js`, refused with `crew_face_needs_modules`), so
  each Ground Crew face would carry `needsModules: ['M0', 'M1', 'M2']`.
- **Setup.** "2 random cards per colour, or the Core Crew Card": the crew draft
  would offer three choices per colour instead of the base card's two faces.
  The draft today picks a crew card and a face (`PICK_CREW`).
- **Ground Crew icon.** It forces the starting face: a card with the icon on one
  side starts on that side (no face choice), and on both sides the player picks.
- **Memory icon and the M2 privilege lock.** Under M2 every faction privilege is
  locked until a Home Bernal is anchored (`engine.js#factionPrivilegesLocked`,
  2B3b). A memory-icon card is exempt from that lock, but Anarchy and War still
  suspend it (`privilegeOf` already handles Anarchy).
- **Memory icon and Decommission.** The card keeps its faceup side when
  Decommissioned or removed from a Stack. Our crew respawn at LEO after a death
  (`engine.js`, the "respawned at LEO" paths); a memory card must come back on
  the same face.
- **Flipping.** It is a free action at the player's anchored Home Bernal (to the
  non-ground side) or at LEO with no anchored Home Bernal (to the ground side).
  It is forced to the ground side when The Station is discarded and no Home
  Bernal is anchored. Otherwise the face never changes.
- **Out of scope pieces it names.** The ET Home Bernal is Module 3. The Station
  is Promo Pack 1, which is not in the repo either. Both can be ignored until
  those land; the plain anchored Home Bernal covers the rule for us.
