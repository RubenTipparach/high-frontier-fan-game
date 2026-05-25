# Fuel strip - Net Thrust track node model

Working data for the wet-mass "Net Thrust track" strip (the
`buildFuelStrip` renderer). The chit slides along this track:
**burning** spends fuel tanks and walks it toward dry mass,
**refuelling** loads tanks and walks it toward wet mass.

## Model

- The track is a **wet-mass** scale. Integer nodes are whole mass
  units 1..32. **MIN DRY MASS = 1, MAX DRY MASS = 23, MAX WET
  MASS = 32.**
- Between integer mass `N` and `N+1` there are **fuel-step**
  sub-nodes at `N + k/d` (k = 1..d-1), where `d` is the gap's
  fuel-step count (the grey ÷ digit on the board). Fractions
  **count up** toward the next integer.
- `d` shrinks as mass grows (one fuel tank buys a coarser mass
  step): 1→2 = ÷9, 2→3 = ÷6, 3→4 = ÷4, 4→5 & 5→6 = ÷3,
  6..22 = ÷2, 23..31 = ÷1 (whole steps, no sub-nodes).
- WISP / PROBE therefore stack tall (many fuel-steps); TUG is
  bare integers.

## Connections

Each adjacent pair of nodes (in mass order) carries two directed
edges:

- **RED = REFUEL** (load 1 FT): node → next-**higher** node
  (toward wet mass). Reversible - runs backward when transferring
  fuel out to an outpost / the LEO bank.
- **BLACK = BURN** (spend 1 FT, or FT discard): node →
  next-**lower** node (toward dry mass).

So black is exactly red reversed; both tables are listed below.

## Nodes (69)

| id | mass | band | gap ÷ to next int | kind | marker |
|----|------|------|------------------|------|--------|
| n1 | 1 | WISP +2 | ÷9 | integer | MIN DRY MASS |
| n2 | 1 1/9 | WISP +2 |  | fuel-step |  |
| n3 | 1 2/9 | WISP +2 |  | fuel-step |  |
| n4 | 1 1/3 | WISP +2 |  | fuel-step |  |
| n5 | 1 4/9 | WISP +2 |  | fuel-step |  |
| n6 | 1 5/9 | WISP +2 |  | fuel-step |  |
| n7 | 1 2/3 | WISP +2 |  | fuel-step |  |
| n8 | 1 7/9 | WISP +2 |  | fuel-step |  |
| n9 | 1 8/9 | WISP +2 |  | fuel-step |  |
| n10 | 2 | PROBE +1 | ÷6 | integer |  |
| n11 | 2 1/6 | PROBE +1 |  | fuel-step |  |
| n12 | 2 1/3 | PROBE +1 |  | fuel-step |  |
| n13 | 2 1/2 | PROBE +1 |  | fuel-step |  |
| n14 | 2 2/3 | PROBE +1 |  | fuel-step |  |
| n15 | 2 5/6 | PROBE +1 |  | fuel-step |  |
| n16 | 3 | PROBE +1 | ÷4 | integer |  |
| n17 | 3 1/4 | PROBE +1 |  | fuel-step |  |
| n18 | 3 1/2 | PROBE +1 |  | fuel-step |  |
| n19 | 3 3/4 | PROBE +1 |  | fuel-step |  |
| n20 | 4 | PROBE +1 | ÷3 | integer |  |
| n21 | 4 1/3 | PROBE +1 |  | fuel-step |  |
| n22 | 4 2/3 | PROBE +1 |  | fuel-step |  |
| n23 | 5 | SCOUT +0 | ÷3 | integer |  |
| n24 | 5 1/3 | SCOUT +0 |  | fuel-step |  |
| n25 | 5 2/3 | SCOUT +0 |  | fuel-step |  |
| n26 | 6 | SCOUT +0 | ÷2 | integer |  |
| n27 | 6 1/2 | SCOUT +0 |  | fuel-step |  |
| n28 | 7 | SCOUT +0 | ÷2 | integer |  |
| n29 | 7 1/2 | SCOUT +0 |  | fuel-step |  |
| n30 | 8 | SCOUT +0 | ÷2 | integer |  |
| n31 | 8 1/2 | SCOUT +0 |  | fuel-step |  |
| n32 | 9 | TRANSPORT -1 | ÷2 | integer |  |
| n33 | 9 1/2 | TRANSPORT -1 |  | fuel-step |  |
| n34 | 10 | TRANSPORT -1 | ÷2 | integer |  |
| n35 | 10 1/2 | TRANSPORT -1 |  | fuel-step |  |
| n36 | 11 | TRANSPORT -1 | ÷2 | integer |  |
| n37 | 11 1/2 | TRANSPORT -1 |  | fuel-step |  |
| n38 | 12 | TRANSPORT -1 | ÷2 | integer |  |
| n39 | 12 1/2 | TRANSPORT -1 |  | fuel-step |  |
| n40 | 13 | TRANSPORT -1 | ÷2 | integer |  |
| n41 | 13 1/2 | TRANSPORT -1 |  | fuel-step |  |
| n42 | 14 | TRANSPORT -1 | ÷2 | integer |  |
| n43 | 14 1/2 | TRANSPORT -1 |  | fuel-step |  |
| n44 | 15 | TRANSPORT -1 | ÷2 | integer |  |
| n45 | 15 1/2 | TRANSPORT -1 |  | fuel-step |  |
| n46 | 16 | TRANSPORT -1 | ÷2 | integer |  |
| n47 | 16 1/2 | TRANSPORT -1 |  | fuel-step |  |
| n48 | 17 | TUG -2 | ÷2 | integer |  |
| n49 | 17 1/2 | TUG -2 |  | fuel-step |  |
| n50 | 18 | TUG -2 | ÷2 | integer |  |
| n51 | 18 1/2 | TUG -2 |  | fuel-step |  |
| n52 | 19 | TUG -2 | ÷2 | integer |  |
| n53 | 19 1/2 | TUG -2 |  | fuel-step |  |
| n54 | 20 | TUG -2 | ÷2 | integer |  |
| n55 | 20 1/2 | TUG -2 |  | fuel-step |  |
| n56 | 21 | TUG -2 | ÷2 | integer |  |
| n57 | 21 1/2 | TUG -2 |  | fuel-step |  |
| n58 | 22 | TUG -2 | ÷2 | integer |  |
| n59 | 22 1/2 | TUG -2 |  | fuel-step |  |
| n60 | 23 | TUG -2 | ÷1 | integer | MAX DRY MASS |
| n61 | 24 | TUG -2 | ÷1 | integer |  |
| n62 | 25 | TUG -2 | ÷1 | integer |  |
| n63 | 26 | TUG -2 | ÷1 | integer |  |
| n64 | 27 | TUG -2 | ÷1 | integer |  |
| n65 | 28 | TUG -2 | ÷1 | integer |  |
| n66 | 29 | TUG -2 | ÷1 | integer |  |
| n67 | 30 | TUG -2 | ÷1 | integer |  |
| n68 | 31 | TUG -2 | ÷1 | integer |  |
| n69 | 32 | TUG -2 |  | integer | MAX WET MASS |

## Red connections - REFUEL (load 1 FT, → higher mass)

| from | mass | → | to | mass |
|----|----|----|----|----|
| n1 | 1 | → | n2 | 1 1/9 |
| n2 | 1 1/9 | → | n3 | 1 2/9 |
| n3 | 1 2/9 | → | n4 | 1 1/3 |
| n4 | 1 1/3 | → | n5 | 1 4/9 |
| n5 | 1 4/9 | → | n6 | 1 5/9 |
| n6 | 1 5/9 | → | n7 | 1 2/3 |
| n7 | 1 2/3 | → | n8 | 1 7/9 |
| n8 | 1 7/9 | → | n9 | 1 8/9 |
| n9 | 1 8/9 | → | n10 | 2 |
| n10 | 2 | → | n11 | 2 1/6 |
| n11 | 2 1/6 | → | n12 | 2 1/3 |
| n12 | 2 1/3 | → | n13 | 2 1/2 |
| n13 | 2 1/2 | → | n14 | 2 2/3 |
| n14 | 2 2/3 | → | n15 | 2 5/6 |
| n15 | 2 5/6 | → | n16 | 3 |
| n16 | 3 | → | n17 | 3 1/4 |
| n17 | 3 1/4 | → | n18 | 3 1/2 |
| n18 | 3 1/2 | → | n19 | 3 3/4 |
| n19 | 3 3/4 | → | n20 | 4 |
| n20 | 4 | → | n21 | 4 1/3 |
| n21 | 4 1/3 | → | n22 | 4 2/3 |
| n22 | 4 2/3 | → | n23 | 5 |
| n23 | 5 | → | n24 | 5 1/3 |
| n24 | 5 1/3 | → | n25 | 5 2/3 |
| n25 | 5 2/3 | → | n26 | 6 |
| n26 | 6 | → | n27 | 6 1/2 |
| n27 | 6 1/2 | → | n28 | 7 |
| n28 | 7 | → | n29 | 7 1/2 |
| n29 | 7 1/2 | → | n30 | 8 |
| n30 | 8 | → | n31 | 8 1/2 |
| n31 | 8 1/2 | → | n32 | 9 |
| n32 | 9 | → | n33 | 9 1/2 |
| n33 | 9 1/2 | → | n34 | 10 |
| n34 | 10 | → | n35 | 10 1/2 |
| n35 | 10 1/2 | → | n36 | 11 |
| n36 | 11 | → | n37 | 11 1/2 |
| n37 | 11 1/2 | → | n38 | 12 |
| n38 | 12 | → | n39 | 12 1/2 |
| n39 | 12 1/2 | → | n40 | 13 |
| n40 | 13 | → | n41 | 13 1/2 |
| n41 | 13 1/2 | → | n42 | 14 |
| n42 | 14 | → | n43 | 14 1/2 |
| n43 | 14 1/2 | → | n44 | 15 |
| n44 | 15 | → | n45 | 15 1/2 |
| n45 | 15 1/2 | → | n46 | 16 |
| n46 | 16 | → | n47 | 16 1/2 |
| n47 | 16 1/2 | → | n48 | 17 |
| n48 | 17 | → | n49 | 17 1/2 |
| n49 | 17 1/2 | → | n50 | 18 |
| n50 | 18 | → | n51 | 18 1/2 |
| n51 | 18 1/2 | → | n52 | 19 |
| n52 | 19 | → | n53 | 19 1/2 |
| n53 | 19 1/2 | → | n54 | 20 |
| n54 | 20 | → | n55 | 20 1/2 |
| n55 | 20 1/2 | → | n56 | 21 |
| n56 | 21 | → | n57 | 21 1/2 |
| n57 | 21 1/2 | → | n58 | 22 |
| n58 | 22 | → | n59 | 22 1/2 |
| n59 | 22 1/2 | → | n60 | 23 |
| n60 | 23 | → | n61 | 24 |
| n61 | 24 | → | n62 | 25 |
| n62 | 25 | → | n63 | 26 |
| n63 | 26 | → | n64 | 27 |
| n64 | 27 | → | n65 | 28 |
| n65 | 28 | → | n66 | 29 |
| n66 | 29 | → | n67 | 30 |
| n67 | 30 | → | n68 | 31 |
| n68 | 31 | → | n69 | 32 |

## Black connections - BURN (spend 1 FT, → lower mass)

| from | mass | → | to | mass |
|----|----|----|----|----|
| n69 | 32 | → | n68 | 31 |
| n68 | 31 | → | n67 | 30 |
| n67 | 30 | → | n66 | 29 |
| n66 | 29 | → | n65 | 28 |
| n65 | 28 | → | n64 | 27 |
| n64 | 27 | → | n63 | 26 |
| n63 | 26 | → | n62 | 25 |
| n62 | 25 | → | n61 | 24 |
| n61 | 24 | → | n60 | 23 |
| n60 | 23 | → | n59 | 22 1/2 |
| n59 | 22 1/2 | → | n58 | 22 |
| n58 | 22 | → | n57 | 21 1/2 |
| n57 | 21 1/2 | → | n56 | 21 |
| n56 | 21 | → | n55 | 20 1/2 |
| n55 | 20 1/2 | → | n54 | 20 |
| n54 | 20 | → | n53 | 19 1/2 |
| n53 | 19 1/2 | → | n52 | 19 |
| n52 | 19 | → | n51 | 18 1/2 |
| n51 | 18 1/2 | → | n50 | 18 |
| n50 | 18 | → | n49 | 17 1/2 |
| n49 | 17 1/2 | → | n48 | 17 |
| n48 | 17 | → | n47 | 16 1/2 |
| n47 | 16 1/2 | → | n46 | 16 |
| n46 | 16 | → | n45 | 15 1/2 |
| n45 | 15 1/2 | → | n44 | 15 |
| n44 | 15 | → | n43 | 14 1/2 |
| n43 | 14 1/2 | → | n42 | 14 |
| n42 | 14 | → | n41 | 13 1/2 |
| n41 | 13 1/2 | → | n40 | 13 |
| n40 | 13 | → | n39 | 12 1/2 |
| n39 | 12 1/2 | → | n38 | 12 |
| n38 | 12 | → | n37 | 11 1/2 |
| n37 | 11 1/2 | → | n36 | 11 |
| n36 | 11 | → | n35 | 10 1/2 |
| n35 | 10 1/2 | → | n34 | 10 |
| n34 | 10 | → | n33 | 9 1/2 |
| n33 | 9 1/2 | → | n32 | 9 |
| n32 | 9 | → | n31 | 8 1/2 |
| n31 | 8 1/2 | → | n30 | 8 |
| n30 | 8 | → | n29 | 7 1/2 |
| n29 | 7 1/2 | → | n28 | 7 |
| n28 | 7 | → | n27 | 6 1/2 |
| n27 | 6 1/2 | → | n26 | 6 |
| n26 | 6 | → | n25 | 5 2/3 |
| n25 | 5 2/3 | → | n24 | 5 1/3 |
| n24 | 5 1/3 | → | n23 | 5 |
| n23 | 5 | → | n22 | 4 2/3 |
| n22 | 4 2/3 | → | n21 | 4 1/3 |
| n21 | 4 1/3 | → | n20 | 4 |
| n20 | 4 | → | n19 | 3 3/4 |
| n19 | 3 3/4 | → | n18 | 3 1/2 |
| n18 | 3 1/2 | → | n17 | 3 1/4 |
| n17 | 3 1/4 | → | n16 | 3 |
| n16 | 3 | → | n15 | 2 5/6 |
| n15 | 2 5/6 | → | n14 | 2 2/3 |
| n14 | 2 2/3 | → | n13 | 2 1/2 |
| n13 | 2 1/2 | → | n12 | 2 1/3 |
| n12 | 2 1/3 | → | n11 | 2 1/6 |
| n11 | 2 1/6 | → | n10 | 2 |
| n10 | 2 | → | n9 | 1 8/9 |
| n9 | 1 8/9 | → | n8 | 1 7/9 |
| n8 | 1 7/9 | → | n7 | 1 2/3 |
| n7 | 1 2/3 | → | n6 | 1 5/9 |
| n6 | 1 5/9 | → | n5 | 1 4/9 |
| n5 | 1 4/9 | → | n4 | 1 1/3 |
| n4 | 1 1/3 | → | n3 | 1 2/9 |
| n3 | 1 2/9 | → | n2 | 1 1/9 |
| n2 | 1 1/9 | → | n1 | 1 |
