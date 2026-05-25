# Fuel strip - Net Thrust track node model

Wet-mass track for the `buildFuelStrip` strip. Burning spends fuel
and walks the chit toward dry mass; refuelling loads fuel and walks
it toward wet mass.

## Model
- Integer mass nodes 1..32. MIN DRY = 1, MAX DRY = 23, MAX WET = 32.
- Between mass N and N+1 there are fuel-step sub-nodes at N + k/d
  (fractions count up). Per-gap fuel-steps d: 1->2 9, 2->3 6,
  3->4 4, 4->5 & 5->6 3, 6..10 2, 11..31 1 (whole, no sub-nodes).
- 57 nodes total (32 integer + 25 fuel-step).

## Connections
- RED = refuel (load 1 FT, toward higher mass). Defined explicitly
  below - the refuel hop is diagonal (mass +1, the fuel-step lands
  on the next weight class's nearest step).
- BLACK = burn (spend 1 FT, toward lower mass) = every red edge
  reversed.

## Nodes (57)
| id | mass | band | gap d | kind | marker |
|----|------|------|-------|------|--------|
| n1 | 1 | WISP +2 | 9 | integer | MIN DRY |
| n2 | 1 1/9 | WISP +2 |  | fuel-step |  |
| n3 | 1 2/9 | WISP +2 |  | fuel-step |  |
| n4 | 1 1/3 | WISP +2 |  | fuel-step |  |
| n5 | 1 4/9 | WISP +2 |  | fuel-step |  |
| n6 | 1 5/9 | WISP +2 |  | fuel-step |  |
| n7 | 1 2/3 | WISP +2 |  | fuel-step |  |
| n8 | 1 7/9 | WISP +2 |  | fuel-step |  |
| n9 | 1 8/9 | WISP +2 |  | fuel-step |  |
| n10 | 2 | PROBE +1 | 6 | integer |  |
| n11 | 2 1/6 | PROBE +1 |  | fuel-step |  |
| n12 | 2 1/3 | PROBE +1 |  | fuel-step |  |
| n13 | 2 1/2 | PROBE +1 |  | fuel-step |  |
| n14 | 2 2/3 | PROBE +1 |  | fuel-step |  |
| n15 | 2 5/6 | PROBE +1 |  | fuel-step |  |
| n16 | 3 | PROBE +1 | 4 | integer |  |
| n17 | 3 1/4 | PROBE +1 |  | fuel-step |  |
| n18 | 3 1/2 | PROBE +1 |  | fuel-step |  |
| n19 | 3 3/4 | PROBE +1 |  | fuel-step |  |
| n20 | 4 | PROBE +1 | 3 | integer |  |
| n21 | 4 1/3 | PROBE +1 |  | fuel-step |  |
| n22 | 4 2/3 | PROBE +1 |  | fuel-step |  |
| n23 | 5 | SCOUT +0 | 3 | integer |  |
| n24 | 5 1/3 | SCOUT +0 |  | fuel-step |  |
| n25 | 5 2/3 | SCOUT +0 |  | fuel-step |  |
| n26 | 6 | SCOUT +0 | 2 | integer |  |
| n27 | 6 1/2 | SCOUT +0 |  | fuel-step |  |
| n28 | 7 | SCOUT +0 | 2 | integer |  |
| n29 | 7 1/2 | SCOUT +0 |  | fuel-step |  |
| n30 | 8 | SCOUT +0 | 2 | integer |  |
| n31 | 8 1/2 | SCOUT +0 |  | fuel-step |  |
| n32 | 9 | TRANSPORT -1 | 2 | integer |  |
| n33 | 9 1/2 | TRANSPORT -1 |  | fuel-step |  |
| n34 | 10 | TRANSPORT -1 | 2 | integer |  |
| n35 | 10 1/2 | TRANSPORT -1 |  | fuel-step |  |
| n36 | 11 | TRANSPORT -1 | 1 | integer |  |
| n37 | 12 | TRANSPORT -1 | 1 | integer |  |
| n38 | 13 | TRANSPORT -1 | 1 | integer |  |
| n39 | 14 | TRANSPORT -1 | 1 | integer |  |
| n40 | 15 | TRANSPORT -1 | 1 | integer |  |
| n41 | 16 | TRANSPORT -1 | 1 | integer |  |
| n42 | 17 | TUG -2 | 1 | integer |  |
| n43 | 18 | TUG -2 | 1 | integer |  |
| n44 | 19 | TUG -2 | 1 | integer |  |
| n45 | 20 | TUG -2 | 1 | integer |  |
| n46 | 21 | TUG -2 | 1 | integer |  |
| n47 | 22 | TUG -2 | 1 | integer |  |
| n48 | 23 | TUG -2 | 1 | integer | MAX DRY |
| n49 | 24 | TUG -2 | 1 | integer |  |
| n50 | 25 | TUG -2 | 1 | integer |  |
| n51 | 26 | TUG -2 | 1 | integer |  |
| n52 | 27 | TUG -2 | 1 | integer |  |
| n53 | 28 | TUG -2 | 1 | integer |  |
| n54 | 29 | TUG -2 | 1 | integer |  |
| n55 | 30 | TUG -2 | 1 | integer |  |
| n56 | 31 | TUG -2 | 1 | integer |  |
| n57 | 32 | TUG -2 |  | integer | MAX WET |

## Red connections - REFUEL (load 1 FT)

| from | mass | -> | to | mass |
|----|----|----|----|----|
| n1 | 1 | -> | n10 | 2 |
| n10 | 2 | -> | n16 | 3 |
| n16 | 3 | -> | n20 | 4 |
| n20 | 4 | -> | n23 | 5 |
| n23 | 5 | -> | n26 | 6 |
| n26 | 6 | -> | n28 | 7 |
| n28 | 7 | -> | n30 | 8 |
| n30 | 8 | -> | n32 | 9 |
| n32 | 9 | -> | n34 | 10 |
| n34 | 10 | -> | n36 | 11 |
| n36 | 11 | -> | n37 | 12 |
| n37 | 12 | -> | n38 | 13 |
| n38 | 13 | -> | n39 | 14 |
| n39 | 14 | -> | n40 | 15 |
| n40 | 15 | -> | n41 | 16 |
| n41 | 16 | -> | n42 | 17 |
| n42 | 17 | -> | n43 | 18 |
| n43 | 18 | -> | n44 | 19 |
| n44 | 19 | -> | n45 | 20 |
| n45 | 20 | -> | n46 | 21 |
| n46 | 21 | -> | n47 | 22 |
| n47 | 22 | -> | n48 | 23 |
| n48 | 23 | -> | n49 | 24 |
| n49 | 24 | -> | n50 | 25 |
| n50 | 25 | -> | n51 | 26 |
| n51 | 26 | -> | n52 | 27 |
| n52 | 27 | -> | n53 | 28 |
| n53 | 28 | -> | n54 | 29 |
| n54 | 29 | -> | n55 | 30 |
| n55 | 30 | -> | n56 | 31 |
| n56 | 31 | -> | n57 | 32 |
| n2 | 1 1/9 | -> | n11 | 2 1/6 |
| n11 | 2 1/6 | -> | n17 | 3 1/4 |
| n17 | 3 1/4 | -> | n21 | 4 1/3 |
| n21 | 4 1/3 | -> | n24 | 5 1/3 |
| n24 | 5 1/3 | -> | n23 | 5 |
| n3 | 1 2/9 | -> | n11 | 2 1/6 |
| n4 | 1 1/3 | -> | n12 | 2 1/3 |
| n12 | 2 1/3 | -> | n17 | 3 1/4 |
| n5 | 1 4/9 | -> | n13 | 2 1/2 |
| n13 | 2 1/2 | -> | n18 | 3 1/2 |
| n18 | 3 1/2 | -> | n22 | 4 2/3 |
| n22 | 4 2/3 | -> | n25 | 5 2/3 |
| n25 | 5 2/3 | -> | n27 | 6 1/2 |
| n27 | 6 1/2 | -> | n29 | 7 1/2 |
| n29 | 7 1/2 | -> | n31 | 8 1/2 |
| n31 | 8 1/2 | -> | n33 | 9 1/2 |
| n33 | 9 1/2 | -> | n35 | 10 1/2 |
| n35 | 10 1/2 | -> | n36 | 11 |
| n6 | 1 5/9 | -> | n13 | 2 1/2 |
| n7 | 1 2/3 | -> | n14 | 2 2/3 |
| n14 | 2 2/3 | -> | n19 | 3 3/4 |
| n8 | 1 7/9 | -> | n15 | 2 5/6 |
| n15 | 2 5/6 | -> | n19 | 3 3/4 |
| n9 | 1 8/9 | -> | n15 | 2 5/6 |

## Black connections - BURN (spend 1 FT) = red reversed

| from | mass | -> | to | mass |
|----|----|----|----|----|
| n10 | 2 | -> | n1 | 1 |
| n16 | 3 | -> | n10 | 2 |
| n20 | 4 | -> | n16 | 3 |
| n23 | 5 | -> | n20 | 4 |
| n26 | 6 | -> | n23 | 5 |
| n28 | 7 | -> | n26 | 6 |
| n30 | 8 | -> | n28 | 7 |
| n32 | 9 | -> | n30 | 8 |
| n34 | 10 | -> | n32 | 9 |
| n36 | 11 | -> | n34 | 10 |
| n37 | 12 | -> | n36 | 11 |
| n38 | 13 | -> | n37 | 12 |
| n39 | 14 | -> | n38 | 13 |
| n40 | 15 | -> | n39 | 14 |
| n41 | 16 | -> | n40 | 15 |
| n42 | 17 | -> | n41 | 16 |
| n43 | 18 | -> | n42 | 17 |
| n44 | 19 | -> | n43 | 18 |
| n45 | 20 | -> | n44 | 19 |
| n46 | 21 | -> | n45 | 20 |
| n47 | 22 | -> | n46 | 21 |
| n48 | 23 | -> | n47 | 22 |
| n49 | 24 | -> | n48 | 23 |
| n50 | 25 | -> | n49 | 24 |
| n51 | 26 | -> | n50 | 25 |
| n52 | 27 | -> | n51 | 26 |
| n53 | 28 | -> | n52 | 27 |
| n54 | 29 | -> | n53 | 28 |
| n55 | 30 | -> | n54 | 29 |
| n56 | 31 | -> | n55 | 30 |
| n57 | 32 | -> | n56 | 31 |
| n11 | 2 1/6 | -> | n2 | 1 1/9 |
| n17 | 3 1/4 | -> | n11 | 2 1/6 |
| n21 | 4 1/3 | -> | n17 | 3 1/4 |
| n24 | 5 1/3 | -> | n21 | 4 1/3 |
| n23 | 5 | -> | n24 | 5 1/3 |
| n11 | 2 1/6 | -> | n3 | 1 2/9 |
| n12 | 2 1/3 | -> | n4 | 1 1/3 |
| n17 | 3 1/4 | -> | n12 | 2 1/3 |
| n13 | 2 1/2 | -> | n5 | 1 4/9 |
| n18 | 3 1/2 | -> | n13 | 2 1/2 |
| n22 | 4 2/3 | -> | n18 | 3 1/2 |
| n25 | 5 2/3 | -> | n22 | 4 2/3 |
| n27 | 6 1/2 | -> | n25 | 5 2/3 |
| n29 | 7 1/2 | -> | n27 | 6 1/2 |
| n31 | 8 1/2 | -> | n29 | 7 1/2 |
| n33 | 9 1/2 | -> | n31 | 8 1/2 |
| n35 | 10 1/2 | -> | n33 | 9 1/2 |
| n36 | 11 | -> | n35 | 10 1/2 |
| n13 | 2 1/2 | -> | n6 | 1 5/9 |
| n14 | 2 2/3 | -> | n7 | 1 2/3 |
| n19 | 3 3/4 | -> | n14 | 2 2/3 |
| n15 | 2 5/6 | -> | n8 | 1 7/9 |
| n19 | 3 3/4 | -> | n15 | 2 5/6 |
| n15 | 2 5/6 | -> | n9 | 1 8/9 |
