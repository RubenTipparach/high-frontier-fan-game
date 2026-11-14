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
| Asteroids | 139 of 188 sites are asteroids, in every zone: main belt (Ceres zone) 43, Jupiter zone 26 (Trojans), Neptune zone 20 (Kuiper belt), Saturn 17, Mars 12, Earth 10, Uranus 10; plus 14 comets |
| Site spacing | nearest neighbour between sites: min 26 px, 25% within 33 px, median 38 px (board 1400 x 900) |
| Jupiter's moon system | its moons spread up to ~155 px from the +4 node; Saturn has 25 moon sites |
| Comets | 12 comet sites: 7 in the main-belt (Ceres) zone, then one or two each in the Jupiter, Saturn, Uranus and Neptune zones. Each hangs off a Hohmann pivot by its own route: 0 to 3 escape burns (more further out: Encke 1, Halley 2, McNaught 3), then 1 to 2 Lagrange points, then the site. Water-rich (hydration 4). Drawn as icy hexes with a tail streaming away from the Sun |
| Jupiter's moons | the +4 flyby node sits on the transfer layer: free to reach from the Hohmann pivots through radiation belts, a crossroads of 6 routes. No moon route passes through it: Ganymede and Callisto come down a shared burn ladder off Jupiter's pivot (Callisto leaves it one burn earlier), Io and Europa down their own ladders through the radiation belts (`node docs/ad-astra/analyze-moon-branch.mjs`) |

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
- **SM-1e. Multiple stars.** A **binary** board holds two star systems side by
  side, each with its own nested zones, rings, wells and radiation (Alpha
  Centauri A and B). A **distant companion** (Proxima, about 13,000 AU out) is
  its own small system of 2 to 3 zones at the board's edge, with its own
  planets. Brown dwarfs and gas giants that orbit inside a star's zones are
  giants (SM-7), not companions.
- **SM-1f. Planets per star (design target).** Each star has 4 to 15 planets
  (gas giants included; dwarf planets, moons, asteroids and comets are not
  planets). Its zone count follows: about one zone per two planets, 4 to 9 for
  a lone star; a binary partner or distant companion is drawn smaller and
  keeps to the low end of the range.

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
- **SM-4b.** A moon's well starts part way down its giant's escape ladder,
  so moons inherit the giant's well (Sol: Io 6 = Jupiter 3 + Io 2 + landing 1).
- **SM-4c.** Bigger bodies get a flyby boost on their Lagrange point: size 11
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
- **SM-5e.** Sites keep short labels (the body name plus a short region word;
  a moon or belt rock drops the star's name: `b-I Near`, `Belt C`), and sit at
  least 26 world px apart, sites on the same body included: the Sol board's
  own closest pair (SM-0). Labels fade in as you zoom, as on Sol.
- **SM-5i. Room to read (design rule, measured off Sol).** Route nodes
  (everything but curve bends) sit at least **10 px** apart (Sol: 99% do), and
  at every node the two closest connections are at least **30 degrees** apart
  (Sol: 95% are). The generator builds to this: wells lean off the radial line
  and get 13 px a stop; every body keeps its own ring pivot, clear of the
  spokes and its neighbours; a giant's moons branch through orbit hubs. A
  generated board must pass; a hand-edited board (SM-11) that breaks it shows
  a **warning**, with the places it happens, instead of a failure.
- **SM-5h. Placement.** Bodies are placed largest first. Each has a footprint
  (a giant's moon system, a planet and its sites, an asteroid group, a comet)
  and takes the first angle on its zone's ring where that footprint clears
  every footprint already placed, on any star. Bodies that come with an angle
  keep it.

- **SM-5f. Asteroids: 30 to 100 per board (design target).** Sol has about
  99 asteroids and small bodies (139 sites typed asteroid, 40 of them giant
  moons).
  A ring holds only as many asteroid groups as its length allows (a group
  needs about 90 px of ring; planets keep their share), so a big belt spills
  into the zones beside it, as Sol's main belt runs on into the Hildas, and a
  small board holds fewer: a lone yellow sun up to 100, a red dwarf about 85,
  a board with a distant companion about 80, a binary about 70.
  They come in groups:
  - a **main belt** in the zone between the rocky worlds and the giants;
  - **Trojans** at each gas giant, on its ring 60 degrees ahead and behind;
  - a few **near-star rocks** inside the habitable zone;
  - an **outer belt** (Kuiper belt) in the outermost zone.
  Each group is a cluster: a ring pivot, one escape burn, a Lagrange point,
  then 1 to 3 asteroid sites straight off it (no landing, SM-5c).

- **SM-5g. Comets: 10 per board (design target; Sol has 12).** Never in a
  star's innermost zone: about half in the main-belt zone (as on Sol, 7 of
  12), the rest in the outer zones. A comet is one
  water-rich site (size 1 to 3, hydration 3 to 5) on its own route: its ring
  pivot -> escape burns (1 in the inner half of the zones, 2 beyond, 3 in the
  outermost zone) -> a Lagrange orbit point -> a second Lagrange point (its
  far orbit) -> the site. Its tail points away from its own star. Comets are
  not counted in the gravity-well check (SM-4a): their burns buy an orbit,
  not a climb out of a well.
  - **Seasons.** Every comet has a season, red, yellow or blue (Sol's 12
    comets: 8 seasonal, coloured by the Sunspot season they can be reached
    in). The seasons are shared out evenly. The comet's whole route (its
    escape burns, both Lagrange points and the site) carries the season and is
    drawn in the season's colour, as Sol draws its seasonal comets.
  - **Out of the plane.** A comet's orbit is inclined, so its route leaves the
    orbital plane: from its ring pivot it climbs steeply toward the top of the
    board (60 degrees up, to one side), its stops 13+ px apart, the far orbit
    and the comet at the top of the climb. It never folds back on itself.

## SM-6. Hazards

- **SM-6a. Radiation.** Radiation nodes go in each star's innermost zone
  (on its ring, where an arc is long enough) and in each giant's belt: on the
  slingshot routes to its flyby point and on its escape ladder between the 1st
  and 2nd burns, so every moon lies inside the belt. Nowhere else.
- **SM-6b. Hazardous points.** Lagrange points in the star's zone are hazards.
- **SM-6c. Aerobrakes.** A body with an atmosphere (habitable-zone worlds that
  are not Hostile, giants) has an aerobrake on its landing path; every
  aerobrake is also a hazard. About a quarter of lander burns are hazardous.

## SM-7. Giants (gas giants, brown dwarfs, white dwarfs)

- **SM-7a. The slingshot.** A giant's flyby point (Lagrange, +4 / +2, SM-4c)
  sits on the transfer layer at the giant: free to reach from its departure
  pivot through a radiation belt, and free back out to a second pivot a little
  further along the same ring. Ships pass through it to slingshot to other
  planets. It leads to no moon: **you cannot slingshot into a moon's orbit.**
- **SM-7b. The escape ladder.** From the ladder pivot on the ring, the
  giant's well is a ladder of 3 escape burns curling round the outward side of
  the giant, with the radiation belt between the 1st and 2nd. Moons branch off
  the 2nd and 3rd burns (each takes the rung on its side) through **orbit
  hubs**: free Lagrange points that split the branches two ways, so no fork
  is tighter than SM-5i's 30 degrees (Sol's Jupiter and Saturn branch the same
  way). A moon's own route is its escape burns -> its Lagrange point -> landing
  -> sites.
- **SM-7c. Major and minor moons (design target).** A gas giant has 4 to 10
  **major moons** (size 4+, 1 to 2 sites each) and 10 to 15 **minor moons**
  (size 1-2, one site each; Sol's Himalia group), the minors in groups of up
  to 3 off one Lagrange point. Majors and minor groups alternate between two
  shells round the giant, so neighbours' sites stay apart. Brown and white
  dwarfs have fewer. The moon system spans about 200 px.
- **SM-7d.** The giant itself is a body you cannot land on.

## SM-8. Curves and routes

- **SM-8a.** Routes are drawn as curves: decorative nodes with exactly two
  edges bend them (ring arcs follow the zone ellipse; radial transfers bow
  gently).
- **SM-8b.** No dead ends: every non-site node has at least two edges, except
  the Ad Astra nodes at the system's edge.
- **SM-8c.** Every site is reachable from the arrival node.

## SM-9. Arrival

- **SM-9a. Ad Astra nodes.** Ships arrive and leave at **Ad Astra nodes**
  outside the primary star's outermost zone: one per star-map link of the
  star (AA-G4a), placed at the bearing of that neighbour on the star map.
  Entering the outermost zone's ring from one is a zone transition: one burn
  (SM-3a). A board with no links (the builder) has a single arrival node at
  the top.
- **SM-9b. Between stars.** A binary pair is joined outer ring to outer ring:
  leaving one star's outer zone and entering the other's are both zone
  transitions, so the trip costs 2 burns. A distant companion is reached the
  same way from the nearest outer ring: 2 burns, on a long route.

## SM-11. Hand edits (the map builder)

The builder lets a designer adjust a generated board by hand. Every edit is
stored in the spec, so a rebuild replays it, and none of them adds or removes a
node, burn or edge: the routes stay exactly what the rules made, so every
SM-10 check still runs on the edited board.
- **SM-11a. Moving a body** (drag any part of it) moves it with all its
  children: a giant's moons, Trojans, ladder and slingshot; a belt's rocks; a
  planet's sites and landing burns. The drop sets its star, zone and angle;
  the body is then laid out by the rules there.
- **SM-11b. Moving a star** (a binary partner or distant companion) moves its
  whole system: zones, rings and bodies. The primary stays put.
- **SM-11c. Bending a route** (Edit splines on a node): each route through
  the node has a handle; dragging it bends that curve. A bend is stored
  against the route's role (a body's well, a spoke, a moon's branch), so it
  follows the body when the body moves. Ring arcs follow their zone and
  cannot be bent (SM-2b).

 (the generator enforces these on every map)

1. No dead ends (SM-8b); decorative nodes have exactly 2 edges (SM-8a).
2. Every zone-crossing transfer carries exactly one burn (SM-3a).
3. Every burn is a zone transition, an escape burn or a landing burn (SM-3).
4. Worlds (planets, dwarfs, asteroids) get deeper wells with size (SM-4a); moon
   sites sit at least 4 burns deep, under their giant's well (SM-4b).
5. Every site has one edge and is reachable from every Ad Astra node (SM-5b, 8c).
6. Radiation only in a star's innermost zone and giant belts (SM-6a).
7. Sites at least 26 world px apart (SM-5e).
8. No moon route touches a flyby point; every moon branches off its giant's
   escape ladder (SM-7a, 7b).
9. Each star has 4 to 15 planets (SM-1f); the board has 30 to 100 asteroids
   (SM-5f) and 10 comets (SM-5g).
10. Every comet sits outside its star's innermost zone, on its own route with
    two Lagrange points, and its whole route carries one season; with 3 or
    more comets, all three seasons are used (SM-5g).
11. Each gas giant has 4 to 10 major and 10 to 15 minor moons (SM-7c).
12. Route nodes at least 10 px apart (SM-5i).
13. At every node, its two closest connections at least 30 degrees apart (SM-5i).
Checks 12 and 13 are warnings on a hand-edited board. Every check lists the
places it fails, so the builder can take you to each one.
