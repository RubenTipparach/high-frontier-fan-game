# Solar power and thrust

How the solar-power modifier from the Net Thrust track is applied to
thrust in this implementation. Generated from `data/patents.js` +
`data/sites.js` (run `scripts`/this dump to regenerate); do not hand-edit.

## The rule

A thruster is **solar-driven** when EITHER:

1. its active face carries the **Solar** ☀ badge (sail / photon / solar moth), OR
2. it is electric (`requires gen-electric`) AND a **solar generator** in the stack supplies that electric power.

A solar-driven thruster's net thrust shifts by the rocket's current
heliocentric zone modifier. From Neptune outward (`solar: null`) the
drive is **inert** (thrust 0 - no usable sunlight). Final thrust clamps
at >= 0. Non-solar thrusters ignore the zone entirely.

## Solar zone modifiers

| Zone | Thrust modifier |
|---|---|
| Mercury | +2 |
| Venus | +1 |
| Earth | 0 |
| Mars | -1 |
| Ceres | -2 |
| Jupiter | -3 |
| Saturn | -4 |
| Uranus | -5 |
| Neptune | **dead** (thrust 0) |

## Direct solar thrusters

Thrusters whose face has the Solar badge. (The engine currently reads
the **Tier-1 / primary** face for the active thruster, so the Tier-1
column is what drives gameplay today; Tier-2 is shown for completeness.)

| id | Tier-1 name | T1 thrust | T1 solar | Tier-2 name | T2 thrust | T2 solar |
|---|---|---|---|---|---|---|
| `thr_photon_heliogyro` | Photon Heliogyro | 0 | ✅ | Electric Sail | 2 | ✅ |
| `thr_photon_kite_sail` | Photon Kite Sail | 0 | ✅ | Mag Sail | 1 | ✅ |
| `thr_ponderomotive_vasimr` | Ponderomotive VASIMR | 3 | — | Pulsed Plasmoid | 3 | ✅ |
| `thr_re_solar_moth` | Re Solar Moth | 3 | ✅ | Colliding Beam H-B Fusion | 3 | — |

### Tier-1 solar thrusters: base thrust by zone

Illustrative `max(0, baseThrust + zoneMod)` (excludes weight-class /
afterburn, which also shift net thrust).

| Thruster | base | Mercury | Venus | Earth | Mars | Ceres | Jupiter | Saturn | Uranus | Neptune |
|---|---|---|---|---|---|---|---|---|---|---|
| Photon Heliogyro | 0 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | dead |
| Photon Kite Sail | 0 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | dead |
| Re Solar Moth | 3 | 5 | 4 | 3 | 2 | 1 | 0 | 0 | 0 | dead |

## Indirect: electric thrusters powered by a solar generator

These thrusters are not solar themselves but `require gen-electric`; they
become solar-driven when a **solar generator** in the stack supplies it.

| id | name | requires gen-electric (T1 / T2) |
|---|---|---|
| `thr_hall_effect` | Hall Effect | ✅ / ✅ |
| `thr_pulsed_inductive` | Pulsed Inductive | — / ✅ |
| `thr_re_solar_moth` | Re Solar Moth | — / ✅ |

### Solar generators that supply `gen-electric`

| id | name | T1 solar | T2 solar |
|---|---|---|---|
| `gen_amtec_thermoelectric` | AMTEC Thermoelectric | — | ✅ |
| `gen_brayton_turbine` | Brayton Turbine | — | ✅ |
| `gen_cascade_photovoltaic` | Cascade Photovoltaic | ✅ | ✅ |
| `gen_flywheel_compulsator` | Flywheel Compulsator | ✅ | — |
| `gen_h2_o2_fuel_cell` | H2-O2 Fuel Cell | ✅ | ✅ |
| `gen_magnetoshell_plasma_parachute` | Magnetoshell Plasma Parachute | ✅ | ✅ |
| `gen_photon_tether_rectenna` | Photon Tether Rectenna | ✅ | ✅ |
| `gen_rankine_solar_dynamic` | Rankine Solar Dynamic | ✅ | — |
| `gen_solar_stirling` | Solar Stirling | ✅ | ✅ |

## Other cards with a Solar badge (not propulsion thrusters)

Carry Solar in the data but are not the rocket's active thruster, so the
modifier does not apply to them today.

| id | name | type | T1 solar | T2 solar |
|---|---|---|---|---|
| `rob_kuck_mosquito` | Kuck Mosquito | robonaut | — | ✅ |
| `rob_rock_splitter` | Rock Splitter | robonaut | — | ✅ |

