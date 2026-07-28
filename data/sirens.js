// V9 "The Sirens" (Pawel Garycki + Phil Eklund): players run Sirenian factions
// out of the Uranian system instead of Earth orbit. See docs/variants-tracker.md
// for the full rule list and what is wired vs still pending.
//
// Pure data + pure functions, imported by BOTH the server engine and the browser
// client (same contract as data/fuel-graph.js): no DOM, no `node:` imports. Every
// export here answers a question about the variant; NONE of them do anything
// unless state.sirens is true, so a normal game is untouched.

// Cordelia is the Sirens' LEO: aqua storage (C5), crew decommission (E7), free
// market sales (I3), the destination for boosted cards (I4), and pad explosions
// / space debris (K2c) all happen there for a Siren faction.
export const SIREN_HOME_SITE = 'cordelia';

// Sites that start under a Busted claim disc in a Sirens game. They grant no
// glory to their home species and cannot be re-prospected with special
// abilities. Luna is the Earthlings' doorstep; the Uranus Aerostat and Cordelia
// are the Sirens'.
export const SIREN_BUSTED_SITES = ['luna', 'uranus_aerostat', SIREN_HOME_SITE];

// No glory may be picked up on Cordelia or the Uranus Aerostat - a species does
// not get famous for standing on its own doorstep.
export const SIREN_NO_GLORY_SITES = [SIREN_HOME_SITE, 'uranus_aerostat'];

// Is this game running the Sirens variant? One place to ask, so a caller never
// has to remember whether the flag is `sirens` or nested somewhere.
export function isSirensGame(state) {
  return !!(state && state.sirens);
}

// Can a glory chit be loaded at this site? False only in a Sirens game, and only
// at the two doorstep sites.
export function sirenGloryBlocked(state, siteId) {
  if (!isSirensGame(state)) return false;
  return SIREN_NO_GLORY_SITES.includes(String(siteId || ''));
}

// Endgame dome bonus (M2b) for a Siren colony. The published rule: +3 VP at a
// push colony or an aerostat, because solar energy is what the Sirens are short
// of and those are where they get it, and +1 anywhere else INCLUDING on Bernals.
// Returns 0 outside a Sirens game so the caller can add it unconditionally.
export const SIREN_DOME_VP_SOLAR = 3;
export const SIREN_DOME_VP_OTHER = 1;
export function sirenDomeVp(state, { pushColony = false, aerostat = false } = {}) {
  if (!isSirensGame(state)) return 0;
  return (pushColony || aerostat) ? SIREN_DOME_VP_SOLAR : SIREN_DOME_VP_OTHER;
}

// A site is an "aerostat" for the dome bonus when its id says so - the map names
// them explicitly (venus_aerostat, uranus_aerostat, ...), so matching the id is
// exact rather than a guess about the site's type.
export function isAerostatSite(siteId) {
  return /(^|_)aerostat$/.test(String(siteId || ''));
}

// "Diamonds Aren't Forever": Sirenian crew and colonists are rad-hard 0. A
// glitch on a stack carrying them does NOTHING if the stack is on a site, and
// DECOMMISSIONS them if the stack is in space. Returns the verdict rather than
// mutating, so the engine keeps ownership of the state change.
export const SIREN_RAD_HARDNESS = 0;
export function sirenGlitchVerdict(state, { onSite }) {
  if (!isSirensGame(state)) return 'normal';
  return onSite ? 'harmless' : 'decommission';
}

// Seniority disks for the variant (V9b): 4 for a short game, 5 for an
// intermediate one, 7 when playing Futures. This implementation runs the disk
// clock off the round count (one disk per Solar Cycle), so these ARE the legal
// game lengths - 6 is not one of them.
export const SIREN_ROUNDS = { short: 4, intermediate: 5, futures: 7 };
export function isLegalSirenRounds(rounds) {
  return Object.values(SIREN_ROUNDS).includes(Number(rounds));
}

// ----- home base -----
//
// LEO is not a site row: across the engine it is encoded as `siteId === null`.
// For a Siren faction, Cordelia acts as LEO for every purpose (aqua storage,
// crew decommission, free market sales, where boosted cards land, pad
// explosions), so the engine cannot keep asking "is siteId null?" - it has to
// ask "is this player at THEIR home base?".
//
// The safety property that makes this refactor tractable: for anyone who is NOT
// a Siren, homeBaseSiteId returns null and isAtHomeBase reduces to exactly the
// `siteId == null` test the engine used before. A non-Sirens game is therefore
// unchanged by construction - which is directly testable, not merely asserted.

// Is this PLAYER a Siren? Species is chosen during the crew draft, so until it
// is set (and in every non-Sirens game) nobody is, and home stays LEO.
export function isSirenPlayer(state, player) {
  return isSirensGame(state) && !!player && player.species === 'siren';
}

// The site slug this player calls home. `null` means LEO - the canonical
// "at home, no site" value the rest of the engine already understands.
export function homeBaseSiteId(state, player) {
  return isSirenPlayer(state, player) ? SIREN_HOME_SITE : null;
}

// Is `siteId` this player's home base? Treats undefined like null so a caller
// that passes a missing value still reads as "at LEO" the way `== null` did.
// Callers that must distinguish an ABSENT endpoint from LEO (stackEndpointSite
// relies on that to stop an unbuilt outpost comparing equal to LEO) check for
// undefined themselves before calling here.
export function isAtHomeBase(state, player, siteId) {
  const home = homeBaseSiteId(state, player);
  if (home == null) return siteId == null;
  return siteId === home;
}
