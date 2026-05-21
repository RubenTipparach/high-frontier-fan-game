// Politics / Events deck. One card is drawn at the end of each
// round; its effect persists for the next round (unless noted). The
// engine maintains the current event and applies its modifier where
// relevant (move cost, refinery output, auction reserves, etc).
//
// Effects are tagged so the engine can route them without parsing
// flavor text:
//   kind: 'move_modifier'    + apply_to (zone)     + delta (int)
//   kind: 'refinery_modifier'+ delta (int)         (multiplier delta)
//   kind: 'auction_modifier' + multiplier (float)
//   kind: 'no_auction'                              (skips auction this round)
//   kind: 'income_modifier'  + delta (int)
//   kind: 'special'          + handler (string id; engine lookup)

export const POLITICS = [
  {
    id: 'p_solar_storm',
    name: 'Solar Storm',
    blurb: 'Heliosphere churn taxes inner-system trajectories.',
    kind: 'move_modifier',
    apply_to: 'inner',
    delta: 1,
  },
  {
    id: 'p_mining_boom',
    name: 'Mining Boom',
    blurb: 'Spot price collapses; refineries run flat-out.',
    kind: 'refinery_modifier',
    delta: 1,
  },
  {
    id: 'p_trade_war',
    name: 'Trade War',
    blurb: 'Reserve prices on every auction lot double.',
    kind: 'auction_modifier',
    multiplier: 2.0,
  },
  {
    id: 'p_armistice',
    name: 'Armistice',
    blurb: 'Lobby-invite restrictions waived for one round.',
    kind: 'special',
    handler: 'open_invites',
  },
  {
    id: 'p_belt_rush',
    name: 'Asteroid Rush',
    blurb: 'Belt sites yield +1 VP this round when first claimed.',
    kind: 'special',
    handler: 'belt_vp_bonus',
  },
  {
    id: 'p_breakthrough',
    name: 'Scientific Breakthrough',
    blurb: 'Auction houses draw 2 patents instead of 1.',
    kind: 'special',
    handler: 'extra_auction_draw',
  },
  {
    id: 'p_embargo',
    name: 'Embargo',
    blurb: 'No patent auctions this round.',
    kind: 'no_auction',
  },
  {
    id: 'p_pirates',
    name: 'Pirate Activity',
    blurb: 'Unstationed ships lose 1 water at end of round.',
    kind: 'special',
    handler: 'unstationed_decay',
  },
  {
    id: 'p_recession',
    name: 'Recession',
    blurb: 'Patent reserves halved (round down).',
    kind: 'auction_modifier',
    multiplier: 0.5,
  },
  {
    id: 'p_conjunction',
    name: 'Mars Conjunction',
    blurb: 'All Mars-bound corridors cost +1 burn this round.',
    kind: 'move_modifier',
    apply_to: 'mars',
    delta: 1,
  },
  {
    id: 'p_eclipse',
    name: 'Solar Eclipse',
    blurb: 'Solar panels and concentrators produce 0 power this round.',
    kind: 'special',
    handler: 'solar_offline',
  },
  {
    id: 'p_trojan_alliance',
    name: 'Trojan Compact',
    blurb: 'Trojan sites award +1 VP when prospected.',
    kind: 'special',
    handler: 'trojan_vp_bonus',
  },
];
