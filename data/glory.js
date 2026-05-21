// Milestone cards (the "Glory" deck in the published game's language).
// Each milestone is a one-time achievement worth bonus VPs to the
// first player who triggers it. The engine checks `predicate` after
// every Operation, and awards `vps` to the player that triggered the
// trigger condition.
//
// Predicates are pure functions on game state and the triggering
// player; no DOM, no I/O. Engine wires them in via a registry.

export const MILESTONES = [
  {
    id: 'm_mars_landing',
    name: 'Boots on Mars',
    vps: 3,
    blurb: 'First crewed-capable surface stack to land on Mars.',
    trigger: 'op_complete',
  },
  {
    id: 'm_belt_pioneer',
    name: 'Belt Pioneer',
    vps: 2,
    blurb: 'First to claim a site in the main asteroid belt.',
    trigger: 'op_complete',
  },
  {
    id: 'm_jovian',
    name: 'Jovian Trailblazer',
    vps: 3,
    blurb: 'First ship to enter Jupiter orbit or land on a Galilean moon.',
    trigger: 'op_complete',
  },
  {
    id: 'm_saturnian',
    name: 'Ringworld Foothold',
    vps: 3,
    blurb: 'First ship to enter Saturn orbit or land on Titan / Enceladus.',
    trigger: 'op_complete',
  },
  {
    id: 'm_kbo',
    name: 'Cold Frontier',
    vps: 4,
    blurb: 'First ship to a Kuiper-belt object.',
    trigger: 'op_complete',
  },
  {
    id: 'm_fusion_era',
    name: 'Fusion Era',
    vps: 2,
    blurb: 'First player to fly a ship with a fusion-class thruster.',
    trigger: 'op_complete',
  },
  {
    id: 'm_first_habitat',
    name: 'First Habitat',
    vps: 4,
    blurb: 'First player to consolidate 3+ factories on a single body.',
    trigger: 'op_complete',
  },
  {
    id: 'm_refinery_baron',
    name: 'Refinery Baron',
    vps: 2,
    blurb: 'First player to operate three hydrated refineries simultaneously.',
    trigger: 'income',
  },
  {
    id: 'm_patent_hoarder',
    name: 'Patent Hoarder',
    vps: 1,
    blurb: 'Hold five unbuilt patents at the end of any round.',
    trigger: 'round_end',
  },
  {
    id: 'm_salvage_crown',
    name: 'Salvage Crown',
    vps: 2,
    blurb: 'Decommission a ship and reclaim three patents in one Op phase.',
    trigger: 'op_complete',
  },
  {
    id: 'm_diplomat',
    name: 'Solar Diplomat',
    vps: 2,
    blurb: 'Visit five distinct bodies with the same ship without refit.',
    trigger: 'op_complete',
  },
  {
    id: 'm_solar_economy',
    name: 'Sun Trader',
    vps: 2,
    blurb: 'Generate 10 cumulative water from a single Mercury refinery.',
    trigger: 'income',
  },
];

export const GLORY = MILESTONES; // alias for the deploy-yml smoke check
