# System map construction rules (SM)

How to build a star-system map that reads like the HF Sol board. These rules
are the source of truth for `docs/ad-astra/mapgen/mapgen.js` (the generator +
validator) and the `hf-system-maps` skill. Code cites rule IDs (`SM-4b`); when
code and this file disagree, the code is wrong.

Every rule is grounded in a measurement of the real Sol board
(`vendor/hf-mission-planner/assets/data-hf4.json` joined with
`data/zone-assignments.json` and `data/node-tags.js`). Re-run the measurement:
`node docs/ad-astra/analyze-sol-map.mjs`.

## SM-0. What the Sol board is (the measured facts)

| Fact | Sol |
|---|---|
| Nodes | 1514: decorative 517, burn 282, hohmann 258, lagrange 214, site 188, radhaz 54 |
| Helio zones | 9, nested around the Sun: Mercury, Venus, Earth, Mars, Ceres, Jupiter, Saturn, Uranus, Neptune |
| What burns do | orbit entry / escape 48%, helio zone transition 27%, lander 18%, anything else 7% |
| Gravity well (burns from surface out to the Hohmann layer), by site size | 1: 1.1, 2: 1.4, 3: 1.1, 4: 1.4, 5: 1.8, 6: 2.1, 7: 2.8, 8: 3.0, 9: 3.3, 11: 4.3 |
| Moons of giants | inherit the giant's well: Io, Europa, Ganymede 6; Callisto 5 |
| How sites attach | to a lagrange (114), a curve (81), a lander burn (27), a burn (11). 149 of 188 sites have exactly ONE edge |
| Lander burns | 50 (28 full, 22 half); 14 are also hazards |
| Hazards | tagged on lagranges (95) and burns (18); radiation nodes concentrate near the Sun (Mercury 14) and the giants (Jupiter 19, Saturn 6), plus Earth's belts (7) |
| Aerobrakes | 31, only at bodies with an atmosphere (Venus, Earth, Mars, the giants) |
| Hohmann pivots | the heliocentric transfer layer; degree 2-4 (87 / 67 / 92 nodes) |
| Curves | every decorative node has exactly 2 edges (517 of 517) |
| Dead ends | 5 non-site nodes with a single edge in 1514 (map exits / specials only) |

## SM-1. Helio zones

- **SM-1a.** A system is divided into nested helio zones around its star,
  innermost first. 4 to 9 zones; a typical exoplanet system uses 6.
- **SM-1b.** Every node belongs to exactly one zone, decided by its distance
  from the star.
- **SM-1c.** Zones are drawn as the Sol board draws them: nested closed
  outlines, each zone tinted with the Sol zone palette in the same inner to
  outer order (hot yellow inside, through orange and tan, to deep blue and
  violet outside).
- **SM-1d.** The innermost zone is the star's: radiation lives there (SM-6a).

## SM-2. Hohmann pivots (green dots): the transfer layer

- **SM-2a.** Green dots are Hohmann transfers: the slow but fuel-efficient way
  around a system. Entering one costs no burn.
- **SM-2b.** Each zone has a ring of pivots at its middle radius. Travel along
  a zone's ring (pivot to pivot) is free.
- **SM-2c.** Pivots are junctions: 2 to 4 edges each. A pivot never dead-ends.
- **SM-2d.** Every body's well starts from a pivot on its zone's ring (its
  departure pivot, SM-4a).

## SM-3. Burns (magenta pads)

A burn USUALLY does one of three things, and the generator never places a burn
for any other reason:
- **SM-3a. Zone transition.** Going from one zone's ring to the next costs
  exactly one burn, placed on the zone boundary. Radial transfers link
  neighbouring rings at 2 to 3 points around the system.
- **SM-3b. Orbit entry / escape.** Burns between a body's departure pivot and
  its Lagrange orbit point; how many depends on the body's gravity well (SM-4).
- **SM-3c. Landing.** Lander burns between a body's orbit and its surface
  (SM-5).
- **SM-3d.** No burns in the middle of a ring arc or a curve.

## SM-4. Gravity wells: more burns, bigger well

- **SM-4a.** A body's well is the chain departure pivot -> escape burns ->
  Lagrange orbit point. Its burn count comes from the body's size (Sol's
  measured averages, rounded):

  | Size | Escape burns |
  |---|---|
  | 1-3 (asteroids, moonlets) | 1 |
  | 4-5 (small worlds, dwarfs) | 1 |
  | 6-7 (Ceres to Mercury class moons and dwarfs) | 2 |
  | 8-9 (Mars to Earth class) | 3 |
  | 10-11 (giants, super-Earths) | 3 |

  Counted with landing (SM-5), a size 1 body is about 1 burn deep and a size 9
  world about 4: the Sol curve.
- **SM-4b.** A moon's well starts at its giant's Lagrange hub, so moons
  inherit the giant's well (Sol: Io 6 = Jupiter 3 + Io 2 + landing 1).
- **SM-4c.** Bigger bodies get a flyby boost on their Lagrange hub: size 11
  +4, size 10 +2, size 8-9 +1 (Jupiter +4, Saturn / Venus / Earth / Neptune
  +2, Mars / Mercury +1).

## SM-5. Sites and lander burns

- **SM-5a.** A site is a hex on a body. A planet has 1 to 3 surface sites
  (Mars 3, Luna 2); a moon 1 to 2; an asteroid or dwarf 1.
- **SM-5b.** A site has exactly ONE edge (149 of 188 on Sol): its landing path.
- **SM-5c.** Landing path from the body's Lagrange point to each site, by
  size: 7+ one full lander burn; 4-6 one HALF lander burn; 1-3 none (small
  bodies are reached straight from orbit).
- **SM-5d.** A body's sites sit around the body, close enough to share one
  sphere (one body = one sphere, however many sites).
- **SM-5e.** Sites keep short labels (the body name plus a short region word),
  and sit at least 28 world px apart, sites on the same body included, so hexes
  and labels never stack.

## SM-6. Hazards

- **SM-6a. Radiation.** Radiation nodes go in the star's zone (on its ring
  and transfers) and in each giant's belts (between its hub and its moons).
  Nowhere else.
- **SM-6b. Hazardous points.** Lagrange points in the star's zone are hazards.
- **SM-6c. Aerobrakes.** A body with an atmosphere (habitable-zone worlds that
  are not Hostile, giants) has an aerobrake on its landing path; every
  aerobrake is also a hazard. About a quarter of lander burns are hazardous.

## SM-7. Giants (gas giants, brown dwarfs, white dwarfs)

- **SM-7a.** A giant is a hub: its departure pivot -> 3 escape burns -> its
  Lagrange hub (flyby boost, SM-4c). The giant itself is a body you cannot
  land on.
- **SM-7b.** Moons branch out from the hub: hub -> radiation belt node ->
  the moon's own escape burns -> moon Lagrange -> landing -> sites.
- **SM-7c.** A giant has 2 to 5 large moons and may have moonlets (size 1-2,
  one site, no landing burn).

## SM-8. Curves and routes

- **SM-8a.** Routes are drawn as curves: decorative nodes with exactly two
  edges bend them (ring arcs follow the zone ellipse; radial transfers bow
  gently).
- **SM-8b.** No dead ends: every non-site node has at least two edges, except
  the single arrival node at the system's edge.
- **SM-8c.** Every site is reachable from the arrival node.

## SM-9. Arrival

- **SM-9a.** Ships arrive at one node outside the outermost zone (the system
  edge). Entering the outermost zone's ring from it is a zone transition: one
  burn (SM-3a).

## SM-10. Validation (the generator enforces these on every map)

1. No dead ends (SM-8b); decorative nodes have exactly 2 edges (SM-8a).
2. Every zone-crossing transfer carries exactly one burn (SM-3a).
3. Every burn is a zone transition, an escape burn or a landing burn (SM-3).
4. Worlds (planets, dwarfs, asteroids) get deeper wells with size (SM-4a); moon
   sites sit at least 4 burns deep, under their giant's well (SM-4b).
5. Every site has one edge and is reachable from arrival (SM-5b, 8c).
6. Radiation only in the star's zone and giant belts (SM-6a).
7. Sites at least 28 world px apart (SM-5e).
