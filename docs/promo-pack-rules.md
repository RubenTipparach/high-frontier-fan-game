# Promo card pack rules

The extra rules printed on the promo packs' rules cards, transcribed word for
word, with notes on how they meet this implementation. The faction promo crew
already in `data/crew.js#PROMO_CREW` (BRIN, Cerulean, Makers Guild, ...) has
its own status board in `docs/promo-crew-plan.md`. Add each new pack here as
its rules cards turn up.

Photos of the printed cards live in `reference/promo-pack-<n>/`.

## Promo Card Pack 3: Ground Crew

Status: **rules transcribed; the icon rules are not built.** The 18 cards are
most likely the promo crew already in `data/crew.js#PROMO_CREW` (see "The cards,
one by one" below). What is missing is which face of each card carries the
Ground Crew and Memory icons.

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

### The cards, one by one

The 18 promo crew already in `data/crew.js#PROMO_CREW` (print-sheet cards
387-404) are most likely this pack: 18 cards, one per faction colour, with
per-face module tags matching "choose cards that match the modules you are
playing with". Each card's two faces are listed below as front / back, with
the modules each face needs.

The two icon columns are still OPEN. Our card data does not record the
icons, and the hf4map card gallery is gone (the domain is parked). Fill them
in from the physical cards: name the face that shows the Ground Crew icon
(front, back or both) and whether the card shows the Memory icon.

| Card (faction) | Front | Front needs | Back | Back needs | Ground Crew icon | Memory icon |
|---|---|---|---|---|---|---|
| BRIN (E) | **THERMAL RESEARCH**: Your radiators have 2 extra Rad-Hard during a Belt Roll. | - | **THERMAL LABS**: As a 1/turn free action, flip a radiator at your Colony/Bernal to its heavy side. | - | ? | ? |
| The Sea Peoples (H) | **COURIER**: Connections (4B2f). | M4 (coming soon) | **POWER BROKERS**: After you pay FINAO, gain 1 Aqua per Seniority Disk on the Assembly (max half FINAO paid, round down). | M0 | ? | ? |
| The Martian Way (D) | **ROCKETEERS**: Immune to pad explosions/space debris; -2 to Belt Rolls for Earth zone Radiation Belts. | - | **TAILINGS REMINING**: If this Crew is colocated, can produce ET products of Spectral Type C at any Factory. | - | ? | ? |
| JAXA (C) | **FUTURISTS**: When you start a contract auction, you may bid 6 years and immediately win the auction. | M4 (coming soon) | **STARCHILD**: Ignore BEO Colony requirements. As a 1/turn free action, flip one of your augmentations to its other side. | M4 (coming soon) | ? | ? |
| Space Force (C) | **LIFE RAFT**: May move as a Freighter (1B4) if the stack Wet Mass is less than 5 & doesn't contain a glory chit. | M1 | **LIFEBOAT**: May move as a Freighter (1B4) if the stack Wet Mass is less than 7. | M1 | ? | ? |
| AEB (B) | **AMBASSADOR**: During lobby, may move a delegate into centrist instead of Decommission. | M0 | **RABBLE-ROUSER**: When you lobby authority in season blue, you may end or initiate anarchy. | M0 | ? | ? |
| Explorers Without Borders (M) | **SHUTTLES**: 1/turn you may cargo transfer Aqua from your Bank to an operational thruster in a Home Orbit or LEO. | M2, not with M5 | **ISO-SHUTTLES**: If you have an isotope in your Bank or isovault, pay 10 less Aqua/1 less isotope when boosting (min 0). | M1, not with M5 | ? | ? |
| Baltimore Gun Club (L) | **WATER ARCJET**: Colocated thruster gets a bonus burn if it starts its move at LEO. | - | **HYDROGEN ARCJET**: Colocated thruster gets a bonus burn if it starts its move at LEO, your Anchored Bernal, or your Factory. | - | ? | ? |
| African Union Space Directorate (A) | **EMISSARIES**: On your turn, you may treat any or all Ideologies tied for the most delegates as the Active Law. | M0 | **ARBITER**: At the start of your turn you may perform a vote tally. Your vote tallies may treat your delegates as 2 delegates each. | M0 | ? | ? |
| LEO Workers’ Union (H) | **COLLECTIVE BARGAINING**: Receive 2 Aqua at game start. You may commit Murder/Suicide. | - | **SITDOWN**: Factory hijack; works even if another player’s Humans are present. You choose 1st Player. | - | ? | ? |
| Makers Guild (J) | **OFFWORLD TRADE NEXUS**: If you have either a Factory or Anchored Bernal, gain Bernal Profits. | M2, not with M5 | **TRADE PORT**: At the start of your turn, you may discard 2 cards to take the top card of a patent queue. | - | ? | ? |
| New Pilgrims (K) | **REFUGEE**: May industrialize an opponent's Claim (not a Felony); both may use the Factory (even if this card is flipped). | - | **IMMIGRANT**: When exomigrating, may first name a specialty to search the chosen queue for the 1st Human with that specialty (if any), then shuffle. | M2 | ? | ? |
| Utopia, Inc. (F) | **EXECUTIVE DISCOUNT**: When paying for a company service, you may use the price listed immediately to the right of the company’s current price. | M5 (coming soon) | **PIGGYBACK**: Whenever an opponent boosts cards, you may immediately boost cards up to the mass of the cards boosted, for free. | - | ? | ? |
| Galahad Group (G) | **HEROIC**: This character can carry any number of glory chits. You may lobby honor without losing a delegate. | - | **QUEST**: During exomigration, your Human Colonist may appear at any Colony in a zone for which you hold a glory chit. | M2 | ? | ? |
| Brotherhood of Cryptobankers (M) | **SILENT PARTNER**: You may angel a company by paying its minimum share value, instead of the usual double cost. | M5 (coming soon) | **CHAIRMAN’S CUT**: Each time you reinvest a company you chair, gain 1 dividend payout (not multiplied by the number of shares you own). | M5 (coming soon) | ? | ? |
| VerisAI (J) | **INCUBATOR**: When you splinter a company, you may place it on the same row of the stock market as its parent company. | M5 (coming soon) | **CAVITATION ENGINEERS**: [Ignore Aerobrake] once per turn. | - | ? | ? |
| Heliocentricity (F) | **WEAK STABILITY BOUNDARY**: After its Stack moves, you may activate this thruster to coast as a second movement. | - | **POWER SERIES CHAOS MODEL**: Immune to Hazards mentioning geysers, rings, spin, and winds. | - | ? | ? |
| Cerulean (D) | **BLUE PLANET**: If ending turn on an aerobrake Hazard, cost of FINAO = 1 Aqua, which gains 1 FT. | not with M5 | **DOWSERS**: When ISRU refueling for water, refuel at an ISRU = 0. | - | ? | ? |

What the icons will decide per card, once known:

- **Ground Crew icon on one face:** that face starts faceup, with no face pick
  at the draft. On both faces, the player picks as today.
- **Memory icon:** the card's privilege skips the M2 Home Bernal lock, and the
  card keeps its face through Decommission and a crew death. Without the icon a
  card behaves like any other crew card.
- **Flipping** (ground side to non-ground side and back) only exists for a card
  with the Ground Crew icon on exactly one face.

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
