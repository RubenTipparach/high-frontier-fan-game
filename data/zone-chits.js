// Two-sided VP value of each heliocentric zone's glory chit, mirroring the
// published HF4 Victory Point Tracker ("GLORY & HEROISM CHITS"):
//   front = crew turned into a colony OR died (face-up, the small value)
//   back  = crew returned home ALIVE (the chit is flipped for the bigger payout)
// Inner zones pay little; the outer system (Uranus / Neptune) pays the most.
//
// Shared data so the client (js/game/glory.js) and the server engine
// (server/game/engine.js) score chits with the SAME table - home-scoring must
// agree in solo and multiplayer. Pure data: no DOM, no node imports.
export const ZONE_CHIT_VPS = {
  Mercury: { front: 1, back: 3 },
  Venus:   { front: 1, back: 2 },
  Earth:   { front: 1, back: 2 },
  Mars:    { front: 1, back: 2 },
  Ceres:   { front: 1, back: 3 },
  Jupiter: { front: 1, back: 3 },
  Saturn:  { front: 1, back: 4 },
  Uranus:  { front: 1, back: 5 },
  Neptune: { front: 1, back: 6 },
};
