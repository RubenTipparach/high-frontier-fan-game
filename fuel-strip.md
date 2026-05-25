# Fuel strip - Net Thrust track node model

Wet-mass track. Burning spends fuel (black, toward dry mass);
refuelling loads fuel (red, toward wet mass).

## Model
- Integer mass nodes 1..32. MIN DRY=1, MAX DRY=23, MAX WET=32.
- Fuel-step sub-nodes at N + k/d between integers; d: 1->2 9,
  2->3 6, 3->4 4, 4-5 3, 6-10 2, 11-31 1. 57 nodes.
- Layout: masses 1-11 on the baseline (1-10 with their fuel-steps
  stacked above); after 11 the track zigzags - EVEN masses on the
  upper row, ODD on the lower row.

## Connections
- RED = refuel (load 1 FT, toward higher mass). Diagonal fuel-step
  chains plus the linear integer chain 1..32 (linear through 11-32).
- BLACK = burn (spend 1 FT, toward lower mass). Linear through all
  nodes of mass <= 23 (greatest -> least); above 23 it splits by
  parity, both arms converging on 23 (MAX DRY):
  - evens: 32 -> 30 -> 28 -> 26 -> 24 -> 23
  - odds:  31 -> 29 -> 27 -> 25 -> 23

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
| n19 | 3 3/4 | -> | n22 | 4 2/3 |

## Black connections - BURN (spend 1 FT)

| from | mass | -> | to | mass |
|----|----|----|----|----|
| n48 | 23 | -> | n47 | 22 |
| n47 | 22 | -> | n46 | 21 |
| n46 | 21 | -> | n45 | 20 |
| n45 | 20 | -> | n44 | 19 |
| n44 | 19 | -> | n43 | 18 |
| n43 | 18 | -> | n42 | 17 |
| n42 | 17 | -> | n41 | 16 |
| n41 | 16 | -> | n40 | 15 |
| n40 | 15 | -> | n39 | 14 |
| n39 | 14 | -> | n38 | 13 |
| n38 | 13 | -> | n37 | 12 |
| n37 | 12 | -> | n36 | 11 |
| n36 | 11 | -> | n35 | 10 1/2 |
| n35 | 10 1/2 | -> | n34 | 10 |
| n34 | 10 | -> | n33 | 9 1/2 |
| n33 | 9 1/2 | -> | n32 | 9 |
| n32 | 9 | -> | n31 | 8 1/2 |
| n31 | 8 1/2 | -> | n30 | 8 |
| n30 | 8 | -> | n29 | 7 1/2 |
| n29 | 7 1/2 | -> | n28 | 7 |
| n28 | 7 | -> | n27 | 6 1/2 |
| n27 | 6 1/2 | -> | n26 | 6 |
| n26 | 6 | -> | n25 | 5 2/3 |
| n25 | 5 2/3 | -> | n24 | 5 1/3 |
| n24 | 5 1/3 | -> | n23 | 5 |
| n23 | 5 | -> | n22 | 4 2/3 |
| n22 | 4 2/3 | -> | n21 | 4 1/3 |
| n21 | 4 1/3 | -> | n20 | 4 |
| n20 | 4 | -> | n19 | 3 3/4 |
| n19 | 3 3/4 | -> | n18 | 3 1/2 |
| n18 | 3 1/2 | -> | n17 | 3 1/4 |
| n17 | 3 1/4 | -> | n16 | 3 |
| n16 | 3 | -> | n15 | 2 5/6 |
| n15 | 2 5/6 | -> | n14 | 2 2/3 |
| n14 | 2 2/3 | -> | n13 | 2 1/2 |
| n13 | 2 1/2 | -> | n12 | 2 1/3 |
| n12 | 2 1/3 | -> | n11 | 2 1/6 |
| n11 | 2 1/6 | -> | n10 | 2 |
| n10 | 2 | -> | n9 | 1 8/9 |
| n9 | 1 8/9 | -> | n8 | 1 7/9 |
| n8 | 1 7/9 | -> | n7 | 1 2/3 |
| n7 | 1 2/3 | -> | n6 | 1 5/9 |
| n6 | 1 5/9 | -> | n5 | 1 4/9 |
| n5 | 1 4/9 | -> | n4 | 1 1/3 |
| n4 | 1 1/3 | -> | n3 | 1 2/9 |
| n3 | 1 2/9 | -> | n2 | 1 1/9 |
| n2 | 1 1/9 | -> | n1 | 1 |
| n57 | 32 | -> | n55 | 30 |
| n55 | 30 | -> | n53 | 28 |
| n53 | 28 | -> | n51 | 26 |
| n51 | 26 | -> | n49 | 24 |
| n49 | 24 | -> | n48 | 23 |
| n56 | 31 | -> | n54 | 29 |
| n54 | 29 | -> | n52 | 27 |
| n52 | 27 | -> | n50 | 25 |
| n50 | 25 | -> | n48 | 23 |
