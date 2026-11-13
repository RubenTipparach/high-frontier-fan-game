# High Frontier: Ad Astra - Rulebook

**Draft v0.2 (2026-11-13).** A fan variant of High Frontier 4: All that
takes the game past the edge of the Sol map. Not affiliated with Sierra Madre
Games. Original rules; it borrows only the hooks HF4 already prints (TW
thrusters, the three Ad Astra exits, the Ad Astra and Sunlens Futures).

> **This rulebook is the source of truth.** Code follows the rules, never
> the other way round. Every rule has an ID (`AA-E3b`); code that implements a
> rule cites its ID in a comment. If the code and this book disagree, the code
> is wrong. Changing a rule means editing this book first (and the changelog
> at the bottom), then the code.

Rules marked **[TUNE]** carry placeholder numbers to be balanced in play.
Rules marked **[OPEN]** are undecided; see section Z.

---

## AA-A. Overview

**A1. The premise.** By the end of an M1 + M2 game, Sol is industrialized and
the first TW (terawatt) drives exist. Ad Astra begins there. You start with a
TW drive and a drydock. The game runs in three acts:

1. **Drydock (Act I).** A few turns in Sol, converting your TW drive into a
   starship: a drive, its propellant, a way to brake, and a tiny payload of
   crew, a prospector and a self-replicating Seed.
2. **Reaching the Stars (Act II).** Fly the star map, generation by
   generation, reach destinations and prospect them (flyby scans or a full
   stop).
3. **Landfall (Act III).** Let the Seed replicate, flip your patents to their
   Landfall side, and terraform a new world.

**A1a. Two theatres.** Life in Sol does not stop when the ship leaves. You
play two theatres the whole game:
- **Home (Sol).** Your Sol empire. There is NO movement in Sol: Sol is an
  economy you expand, not a map you fly (AA-S).
- **Frontier.** Your starship(s) on the star map and the system boards.

In Act I only Home exists. From launch on, every turn has a Home half and a
Frontier half (AA-D1).

**A2. The mass problem (design intent).** An interstellar starship is about
99% drive and propellant. Every unit of payload you add multiplies the
propellant you need. So the payload is tiny, and the Seed is how a tiny
payload becomes a civilization: it rebuilds industry at the destination out
of local rock and out of the drive itself.

**A3. Scope.** Single player first (AA-C). Multiplayer is out of scope until
the solo game plays well. This is NOT the published Module 4 (Exodus) or the
Interstellar combined game: no isobank, no isofuel vaults, no shared
starship. Each player builds and flies their own ship.

---

## AA-B. Components and glossary

**B1. Ad Astra patents.** All-new decks. Every card is double-sided, as in
HF4:
- **White side (Voyage face):** the technology as built in Sol and flown
  across the Crossing.
- **Black side (Landfall face):** a different technology the same card
  becomes once it is rebuilt at the destination (AA-H4). A spent drive
  becomes a terraforming tool; a cryo vault becomes a biosphere bank.

Card types: **Drive** (the TW thruster), **Brake**, **Payload** (Crew
mode), **Prospector**, **Seed**, plus the HF4 support types (reactor,
generator, radiator) that drives may require. Support chains follow the base
game's rules unchanged.

**B2. Propellant.** There is no single interstellar fuel. Each drive names a
**propellant family** (AA-F1), and propellant is tracked in units of that
family. Some families carry nothing at all (beams), some harvest the void
(ramscoops), some stockpile bombs (pulse). Water and Aqua still exist in
Sol for buying and boosting, but they are not starship propellant.

**B3. The Starship placard.** A player mat with slots for one Drive, one
Brake (optional), Payload, one Prospector, one Seed, any supports, and a
propellant track for the drive's family.

**B4. Velocity (V).** The starship's cruise speed on a 0 to 6 track. V is
measured in **light-years per Generation**. [TUNE] V1 is about 4% of light
speed, V3 about 12%, V6 about 24%.

**B5. Generation.** One turn of Acts II and III. About 25 years of ship time.

**B6. Star map.** The nearby stars, joined by **lanes** marked in
light-years and with an **ISM density** (thin / normal / dense). Each star
system is a face-down **System tile** until scouted.

**B7. System board.** A small map for one star system, in the same idiom as
the Sol map (hex sites with size, hydration and spectral type).

**B8. Replicator cubes.** What the Seed becomes at Landfall: grey-goo
industry. Replicator cubes behave like Factory cubes that multiply.

---

## AA-C. Setup (solo)

**C1. Drydock.** Place your Starship placard. Your drydock is in LEO.

**C2. Starting TW drive.** Draw 2 Drive cards; keep 1 and put it in the
Drive slot, white side up. Shuffle the other back. Everyone starts with a TW
drive (A1).

**C3. Starting resources.** [TUNE] 12 Aqua. One Crew card (any face).

**C4. Scouting head start (Ad Astra Futures).** For each Future you
completed at the end of an M1 + M2 game, take its head start. For now this
is a setup choice (you declare what you completed); carry-over from a real
finished game comes later [OPEN Z3].

| Completed Future | Head start |
|---|---|
| Lithiated Ammonia Ice Starship | **Forerunner probe.** Place a probe token 2 ly out along any lane from Sol, at V2. Reveal the System tile at that lane's end. |
| Enzmann Starship | **Seasoned crew.** Start with 2 promoted Colonists as Crew. Reveal any 1 System tile. |
| Neutrino or EM Sunlens | **Lens survey.** Start owning a Lens Observatory Holding (S3), free. |

**C5. Star map.** Shuffle the System tiles and place one face down on each
star except Sol.

**C6. Clocks.** Drydock marker on turn 1 of the Launch Window (AA-D2).
Generation marker off the track until launch.

---

## AA-D. Turn structure and the clocks

**D1. A turn.** Each half of a turn follows the HF4 pattern: any number of
free actions and exactly ONE operation, in any order.
- **Act I:** Home half only (one Home operation, AA-S2).
- **From launch on:** a **Home half** (one Home operation, no movement) then a
  **Frontier half** (coast, plus one Frontier operation). [OPEN Z7] whether
  this is two operations a turn or one operation in a theatre of your choice.

**D2. Launch Window (Act I clock).** Act I lasts at most **6 Drydock turns**
[TUNE]. You may launch earlier (AA-E7). At the end of turn 6 you must launch
or the game ends in defeat ("Grounded").

**D3. Generations Clock (Acts II and III).** Every turn after launch is one
Generation. Advance the marker at the end of each turn. The game ends at the
end of **Generation 12** [TUNE].

**D4. Generation event.** At the start of each Generation turn, roll 1d6 on
the Generation Event table (AA-G7).

---

## AA-E. Act I - Drydock

**E1. Goal.** Convert your TW drive into a starship (AA-E5) and launch it
with enough propellant to reach a star system AND stop there (or plan a
flyby; AA-G6).

**E2. Operations in Act I.** The Home operations (AA-S2), plus Launch
(E7). Act I is simply the Home theatre before anything has left.

**E3. Sol Sources.** Sol is never flown (A1a). Propellant comes from Sol
Sources, one per propellant family, each with a production cost and yield
[TUNE]. You own a Source once you Expand into it (S3):

| Source | Family | Cost | Yield |
|---|---|---|---|
| Earth fissile works | Pulse units | 2 Aqua | 2 |
| Jupiter He-3 skimmers | Fusion pellets | 3 Aqua | 3 |
| Saturn He-3 skimmers | Fusion pellets | 2 Aqua | 2 |
| Mercury antimatter farm | Antimatter | 4 Aqua | 1 |
| Sun-facing Beam Station | Beam (no propellant) | see F3 | - |

Owning the Source is required to Produce from it.

**E4. Mass.** Each card has Mass as in HF4. **Starship dry mass** is the
total Mass of every card on the placard. Propellant also has mass: every 6
units of Pulse or Fusion propellant counts as 1 Mass; Antimatter counts 1
Mass per 20 units; beams and ramscoops carry none [TUNE].

**E5. Starship Conversion.** A starship is valid for launch when the placard
has ALL of:
- **a.** An operational Drive (its support chain satisfied, per the base game).
- **b.** A Payload with at least 1 Population (AA-B1 Crew modes, AA-F5).
- **c.** A Seed.
- **d.** Enough propellant to reach V1 at least once.

A Prospector and a Brake are optional but you will want both (G6, H2).

**E6. Scouting from home.** System tiles can be revealed from Sol with the
Lens Survey Home operation (S2f).

**E7. Launch.** Choose the Ad Astra exit you leave by. Your starship enters
its first lane at V0 and immediately takes one Burn (AA-G3) for free. The
exit choice grants a bonus [TUNE]:

| Exit | Bonus |
|---|---|
| Jupiter-Sol-Jupiter (solar Oberth) | +1 V on launch, free. |
| Sol Exit Neptune | Your first lane counts as Thin ISM for dust (G7). |
| Sol Exit Oort | Take 2 propellant of your family free (comet ice), Fusion and Pulse only. |

After launch, the starship can no longer receive cards or propellant from
Sol (it is gone). Sol reaches it only by Beam Station (F3), Lens Survey
(S2f) and Transmit (S2g). Your Hand stays in Sol and keeps playing in the
Home theatre.

---

## AA-F. Propulsion

**F1. Propellant families.**

| Family | Carries | Accelerate | Brake | Examples |
|---|---|---|---|---|
| **Beam** | Nothing | Only while your Beam Station is in range (F3) | No, unless the drive says staged | Starwisp maser sail, Forward staged lightsail |
| **Pellet stream** | Nothing | Like Beam, but range is longer and steps are smaller [TUNE] | No | Sunbeam pellet rider |
| **Pulse** | Pulse units | Yes | Only the Medusa canopy | Orion pusher plate, Medusa "nuclear parachute" |
| **Fusion** | Fusion pellets | Yes | Yes (flip and burn) | Daedalus, Icarus Firefly |
| **Antimatter** | Antimatter | Yes, very light propellant | Yes | Frisbee beam-core, Valkyrie |
| **Ramscoop** | Nothing (harvests ISM) | Only at V2 or more ("ignition") | Yes, scoop drag | Bussard ramjet, RAIR |

**F2. Drive stats.** Each Drive shows, on the published thruster idiom:
- **Thrust:** the most Burns (V steps) it may make in one Generation.
- **Fuel:** propellant spent per Burn, before the weight multiplier (F4).
- **Propellant glyph:** its family.
- **Payload limit:** the most Payload Mass it can carry at all.
- **Brake:** whether the drive itself can lower V.

**F3. Beam Station.** Built in Act I (E2e) for [TUNE] 5 Aqua, plus any card
supports the drive lists (a beam drive names `beam-receiver`). The station
pushes a beam ship only while the ship is within **Beam Range** of Sol:
4 ly for lasers and masers, 7 ly for pellet streams [TUNE]. Each Burn under
the beam costs 1 Aqua from your Sol account (Aqua earned before launch).

**F4. Weight class and the mass ratio.** Starship total mass (dry + propellant
mass, E4) sets the weight class. Each Burn costs Fuel x the class multiplier:

| Total Mass | Weight class | Multiplier |
|---|---|---|
| 0 - 4 | Wisp | x1 |
| 5 - 8 | Hauler | x2 |
| 9 - 13 | Ark | x3 |
| 14+ | Worldship | x4 |

This is the whole game in one table: every card you add to the payload can
push you up a class and multiply every Burn.

**F5. Crew modes (Payload cards).** [TUNE]

| Payload | Mass | Population | Notes |
|---|---|---|---|
| Generation Habitat Ring | 4 | 3 | Awake crew. Suffers Drift (G7). |
| Cryo Vault | 2 | 2 | Sleepers. Roll on arrival: a 1 loses 1 Population. |
| Embryo Bank | 1 | 0 | Becomes 2 Population once a Replicator Factory raises it (H3). |
| Upload Core | 0 | 1 | Minds on a chip. Needs replicator bodies to act (H3). |

**F6. Brakes.** A Brake card lowers V without spending propellant:
- **Magsail:** -1 V at the end of any Generation you choose, any ISM.
- **E-sail:** -1 V per Generation, but only on the last lane segment before a
  star (it brakes on the stellar wind).
- **Staged sail:** one time only, -2 V on arrival, IF your Beam Station is
  still operational.

---

## AA-G. Act II - Reaching the Stars

**G1. Position.** Your starship sits on a lane, a number of light-years from
the star it is heading for. Track it with the ly counter on the lane.

**G2. Coast.** At the end of each Generation, move V light-years along the
lane. Coasting is free.

**G3. Burn (operation).** Change V by up to your Drive's Thrust, one step at
a time, paying Fuel x weight multiplier per step in your family's propellant
(Beam: per F3). Raising and lowering V both count as Burns. Spending
propellant may drop your weight class mid-burn; recompute per step.

**G4. Arrival.** You arrive when your ly counter reaches the star. If V is 0
on arrival, you enter the System board (AA-H). If V is above 0, it is a
**flyby** (G6).

**G5. Redirect.** At a star you may pick a new lane out (Burns as usual).

**G6. Flyby.** A flyby reveals the System tile and lets an operational
Prospector take one free raygun-style scan of one site there (as HF4
prospecting), then continues on the far lane at the same V. A Seed cannot
be deployed on a flyby.

**G7. Generation Event table** (roll at the start of each Generation) [TUNE]:

| Roll | Event | Effect |
|---|---|---|
| 1 | Dust strike | Dense ISM: lose 1 card of your choice unless a Shield is aboard. Normal: lose 1 propellant. Thin: no effect. |
| 2 | Drift | Habitat Ring only: lose 1 Population unless a Crew card is promoted. |
| 3 | Glitch | One card is inactive until repaired (a Crew free action). |
| 4 | Quiet years | No effect. |
| 5 | Breakthrough | Flip any one card on the placard to its Landfall side early, free. |
| 6 | Baby boom | Habitat Ring only: +1 Population (max ring capacity). |

**G8. Pulse decay.** Pulse units are bombs in storage. Each Generation, if
you carry 6 or more, lose 1 [TUNE].

**G9. Antimatter containment.** Each Generation you carry antimatter, roll
1d6; on a 1 lose half your antimatter (round up). A promoted Crew may reroll
once per game.

**G10. Light lag.** Sol cannot send mass after launch. Beams (F3), Lens
Survey (S2f) and Transmitted designs (S2g) still reach you. At game scale a
radio message crosses any lane within one Generation.

**G11. Prospect (Frontier operation).** At a star where you stopped (V0), as
HF4: an operational Prospector, ISRU <= Hydration, then 1d6 <= Site Size
claims the site. On a flyby, use G6 instead. Prospecting is the heart of Act
II: you are racing the Generations Clock to find a site worth seeding.

---

## AA-H. Act III - Landfall

**H1. Entering a system.** Place your starship on the System board's arrival
node. Movement on the System board uses your drive, at V-free in-system rules
[OPEN Z2]: for v0.1, any site on the board is one Burn away.

**H2. Prospect.** See G11. Act III starts the moment you hold a claim.

**H3. Deploy the Seed (operation).** At a claimed site, decommission the Seed
card to place **1 Replicator cube** there. That site is now your Replicator
Factory. Embryo Banks and Upload Cores become active here (F5).

**H4. Replication (free, end of every Generation).** Each Replicator Factory
doubles its cubes, up to the site's Size. Then the **Governor check**: if any
Replicator Factory is at its cap and no Crew is colocated, roll 1d6; on a 1,
**Grey Goo**: the site is consumed (remove its cubes and its claim, it can
never be claimed again).

**H5. Drive recycling (free action).** The drive is 99% of your ship; reuse
it. At your Replicator Factory, decommission your Drive (and any leftover
propellant) to add cubes equal to the drive's Mass plus 1 per 6 propellant.
You can no longer move after this.

**H6. Landfall Production (operation).** Spend Replicator cubes equal to a
card's Landfall-side Mass to flip one Ad Astra card on your placard (or in
the wreck of your ship) to its black Landfall side. The site's spectral type
must match the card's, as HF4 ET Production. This is how patents flip.
A design Transmitted from Sol (S2g) can be built this way too: it arrives as
a blueprint, and the replicators make the card here, black side up.

**H7. Terraform (operation).** Each terraformable world has a Terraform track:

| Step | State | Needs (Landfall-side cards colocated, [TUNE]) | VP |
|---|---|---|---|
| 0 | Hostile | - | 0 |
| 1 | Paraterraformed | a Dome | 2 |
| 2 | Marginal | + a Mirror or Shade | 4 |
| 3 | Habitable | + an Atmosphere card | 7 |
| 4 | Garden | + a Biosphere card, 3 Population present | 12 |

One Terraform operation advances a world one step if its needs are met.

**H8. Homestead (operation).** Place 1 Population on a world at step 1 or
more as a Colony (1 VP each, as M2 Homesteading).

---

## AA-S. The Home theatre (Sol empire)

**S1. No movement.** Sol is an economy board, not a map. You never move a
stack in Sol. You grow your empire by owning **Holdings**.

**S2. Home operations** (one per turn, Act I and after):

| ID | Operation | Effect |
|---|---|---|
| S2a | Income | Gain 1 Aqua, plus 1 per Market Holding you own. |
| S2b | Research | Take the top card of any Ad Astra deck, paying 1 Aqua per card taken [TUNE]. No auction in solo. |
| S2c | Boost | Play White-side cards from Hand to your drydock, paying their Mass in Aqua. The first Boost of the turn is the operation; later Boosts that turn are free (as HF4). |
| S2d | Expand | Buy one Holding (S3). |
| S2e | Produce | At a Source you own, pay its cost for its yield of propellant, into the drydock. |
| S2f | Lens Survey | Needs a Lens Observatory Holding. Reveal one System tile. |
| S2g | Transmit | Send one card design from your Hand to a starship or colony. The card stays in Sol; the Frontier may build it by Landfall Production (H6). |
| S2h | Launch | Act I: launch the starship (E7). Later: launch a follow-on ship or probe that you have converted in the drydock (S4). |

**S3. Holdings** [TUNE]:

| Holding | Cost | Effect | VP |
|---|---|---|---|
| Sol Source (one per family) | 3 Aqua | Allows Produce for that family (E3). | 1 |
| Market | 4 Aqua | +1 Aqua on every Income. | 1 |
| Beam Station | 5 Aqua | Pushes beam ships (F3). | 1 |
| Lens Observatory | 4 Aqua | Allows Lens Survey. Free with the Sunlens head start (C4). | 1 |
| Shipyard | 6 Aqua | A second drydock: convert a follow-on ship (S4). | 2 |
| Bernal Colony | 5 Aqua | Pure empire growth. | 2 |

**S4. Follow-on launches.** Once your first starship has launched, you may
build another in the drydock (or a Shipyard) with the same rules (AA-E5).
A **probe** is a starship with no Payload and no Seed: it may only fly by
(G6), but it is cheap.

**S5. No passive income.** As in HF4, nothing pays you at the end of a
round or Generation. Aqua comes only from the Income operation (Markets make
that operation bigger).

---

## AA-I. Scoring and solo victory

**I1. Endgame.** At the end of Generation 12, or as soon as your only world
reaches Garden.

**I2. VP.**
- Terraform track VP (H7), best world counts in full, others half.
- 1 VP per Colony (H8).
- 1 VP per Replicator Factory.
- 1 VP per System tile you revealed (scouting glory).
- Holding VP (S3).
- 3 VP for the first system entered (V0 arrival).

**I3. Victory bands** [TUNE]:

| VP | Verdict |
|---|---|
| 0 - 9 | Lost in the dark |
| 10 - 19 | Survivors |
| 20 - 34 | Colony |
| 35+ | New Earth |

"Grounded" (D2) is a defeat regardless of VP.

---

## AA-Z. Open questions and design log

- **Z1.** Settled in v0.2: Sol is never flown, it is an empire board (S1).
- **Z2.** In-system movement at Landfall: one Burn per site (v0.1), or a
  real delta-v graph on each System board?
- **Z3.** Real carry-over of Ad Astra Futures from a finished M1 + M2 game.
- **Z4.** Do Ad Astra card stats live in a new tab of
  `reference/HF4-card-data.xlsx` (house rule: card data comes from the
  spreadsheet), or in a variant data file like Rat Frontier? Mockups use
  placeholder numbers until this is decided.
- **Z5.** Multiplayer: race to the same stars, shared Beam Stations, claim
  jumping across light-years.
- **Z7.** Home + Frontier each turn: two operations (v0.2 default), or one
  operation in a theatre of your choice? Two keeps both alive; one makes
  every turn a real trade-off.
- **Z6.** New glyphs needed (propellant families, Payload limit, Population,
  Replicator cube). Each gets a rendered preview for sign-off before use.

### Changelog
- **v0.2 (2026-11-13):** Act II is now Reaching the Stars (arrival +
  prospecting). New Home theatre (AA-S): Sol keeps going all game as an
  empire with no movement (Holdings, Expand, Produce, Lens Survey, Transmit,
  follow-on launches). Turns split into Home and Frontier halves.
- **v0.1 (2026-11-13):** First draft. Three acts; propellant families; weight
  class mass ratio; crew modes; Seed + replication + Grey Goo; drive
  recycling; Landfall flip; terraform track; head starts from Ad Astra and
  Sunlens Futures.
