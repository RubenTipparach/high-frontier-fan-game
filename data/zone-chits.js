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
  Ceres:   { front: 1, back: 2 },
  Jupiter: { front: 1, back: 3 },
  Saturn:  { front: 1, back: 4 },
  Uranus:  { front: 1, back: 5 },
  Neptune: { front: 1, back: 6 },
};

// Glory VP a player scores at game end (M2b: "as listed on its faceup side"):
// every banked chit at the side it was banked on, plus every chit a Human still
// CARRIES in the field, at its front (low) side - B3, "1 VP each when claimed by
// a Human". A V9 heroism chit carries its own flat value. Shared so the server's
// final score and the game-over screen add glory up the same way; the screen
// used to read only the banked total and dropped a chit still riding a crew.
export function gloryVpOf(glory) {
  if (!glory) return 0;
  const vpOf = (c, side) => (c && c.kind === 'heroism'
    ? (c.vp | 0)
    : ((ZONE_CHIT_VPS[c && c.zone] || { front: 1, back: 1 })[side === 'back' ? 'back' : 'front']) | 0);
  let vp = 0;
  for (const c of (Array.isArray(glory.claimed) ? glory.claimed : [])) vp += vpOf(c, c && c.side);
  for (const c of (Array.isArray(glory.chits) ? glory.chits : [])) vp += vpOf(c, 'front');
  return vp;
}
