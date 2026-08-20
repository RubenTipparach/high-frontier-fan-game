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
//
// NOTE the Luna entries. This map has no site called plain 'luna' - the Moon is
// TWO landing sites (Aristarchus Plateau and the Shackleton polar rim), so
// "Luna is Busted" has to name both or the disc lands on a site that does not
// exist and silently does nothing. Every id here is asserted against the real
// site list by scripts/check-engine.mjs, which is how the missing one was
// caught.
export const SIREN_BUSTED_SITES = [
  'luna-aristarchus-plateau',
  'luna-shackleton-polar-rim',
  'uranus-aerostat',
  SIREN_HOME_SITE,
];

// No glory may be picked up on Cordelia or the Uranus Aerostat - a species does
// not get famous for standing on its own doorstep.
export const SIREN_NO_GLORY_SITES = [SIREN_HOME_SITE, 'uranus-aerostat'];

// A site is spelled TWO ways in this codebase and both reach these lists.
// state.discs is keyed by the PLANNER slug ('uranus-aerostat', hyphens), while a
// site RECORD out of data/sites.js carries the underscore id ('uranus_aerostat')
// - 61 of the 188 curated ids are not planner slugs at all. Rather than make
// every caller remember which one it is holding, fold the separator so either
// spelling matches. Single-word ids like 'cordelia' are identical in both and
// were the reason the mismatch went unnoticed.
function canonicalSiteId(id) {
  return String(id || '').replace(/_/g, '-').toLowerCase();
}
function siteListIncludes(list, id) {
  const want = canonicalSiteId(id);
  return list.some((s) => canonicalSiteId(s) === want);
}

// Is this game running the Sirens variant? One place to ask, so a caller never
// has to remember whether the flag is `sirens` or nested somewhere.
export function isSirensGame(state) {
  return !!(state && state.sirens);
}

// Can a glory chit be loaded at this site? False only in a Sirens game, and only
// at the two doorstep sites.
export function sirenGloryBlocked(state, siteId) {
  if (!isSirensGame(state)) return false;
  return siteListIncludes(SIREN_NO_GLORY_SITES, siteId);
}

// ----- Heroism chit (V9 Lc) -----
//
// The first time the two species meet, the active player takes a HEROISM chit
// worth 2 VP. It is its own kind of glory chit, introduced by this scenario
// (user 2026-07-28) - not one of the heliocentric ZONE chits, so it does not
// consume a zone, is not bound to a carrier, and does not need to ride home to
// score. The published VP tracker heads that column "Glory & Heroism chits",
// which is why it banks alongside them rather than in a separate pool.
export const SIREN_HEROISM_VP = 2;
export const HEROISM_CHIT_ZONE = 'Heroism';
export function isHeroismChit(chit) {
  return !!chit && chit.kind === 'heroism';
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

// ----- the Uranian moons -----
//
// Two V9 rules turn on landing a Human on a "Uranian moon": First Contact (the
// solo KPI waiver) and the solitaire D-or-V patent flip. The Uranus solar ZONE
// is not the same set - it holds 19 sites, of which only these 13 are moons.
// The rest are centaurs (chariklo, asbolus, hylonome, pholus), a comet
// (comet_halley) and the aerostat, none of which anybody would call a moon
// (user 2026-07-28: "True moons only").
//
// Listed explicitly rather than derived from the zone, because "is this a moon"
// is not a property the site data carries and a zone test quietly swept in four
// centaurs - two of them D-type, which would have handed out the patent flip at
// the wrong places.
export const URANIAN_MOONS = [
  'miranda', 'puck', 'juliet', 'belinda', 'portia', 'prospero', 'setebos',
  'sycorax', 'cordelia', 'oberon', 'titania', 'ariel', 'umbriel',
];
export function isUranianMoon(siteId) {
  return siteListIncludes(URANIAN_MOONS, siteId);
}

// The D and V moons of the Uranian system. NO LONGER a rule surface: the
// solitaire Technology Trade flip used to happen on any D or V moon, but the
// trade is with the OTHER people, so it now happens where the two meet - a
// Sirenian at Earth's LEO, an Earthling at a Siren colony in the Uranus zone
// (user 2026-08-19). Kept as data because the D/V split is what
// splitDeckForSoloSpecies hands the Sirens, and because the list is the audited
// answer to "which Uranian moons are D or V" if another rule ever needs it.
// NOTE four D-type CENTAURS sit in the same zone (chariklo, asbolus, hylonome,
// pholus) and are deliberately absent: they are not moons.
export const SIREN_TRADE_MOONS = [
  'miranda', 'juliet', 'belinda', 'portia', 'prospero', 'setebos', 'ariel',
  'oberon', 'titania', 'umbriel',
];
export function isSirenTradeMoon(siteId) {
  return siteListIncludes(SIREN_TRADE_MOONS, siteId);
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

// Player-only variant of the above. Species is ONLY ever set in a Sirens game
// (the engine's PICK_CREW gates on state.sirens and the field is absent
// otherwise), so this is safe without the state and saves threading it through
// hot paths like rad-hardness that never needed it before.
export function isSirenFaction(player) {
  return !!player && player.species === 'siren';
}

// Do these two players sit on opposite sides of the species line? C4 gives the
// two peoples no access to each other's decks "except during trade ... or
// negotiation", and that crossing is a PHYSICAL meeting: an Earthling and a
// Siren strike a deal only where they are standing in the same Space, with any
// of their units. Nothing crosses the line in the abstract - not a hand patent,
// not a coin from the bank, not a borrowed ability - because the two peoples
// keep their banks and their libraries half a solar system apart. A deal between
// two players of the SAME people is unchanged: their abstract terms still travel
// anywhere, and only fuel and cargo need a shared site. (User 2026-08-04.)
export function tradeCrossesSpecies(state, a, b) {
  if (!isSirensGame(state)) return false;
  return isSirenFaction(a) !== isSirenFaction(b);
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

// What a player CALLS their home base. The UI says "LEO" in a dozen places (the
// home stack tab, the boost destination, the hand hint, the roster location) and
// every one of them is a lie for a Siren, whose pile of boosted cards physically
// sits at Cordelia. Returns the display name, so the caller renders the player's
// own home rather than Earth's.
//
// Takes the RESOLVED species rather than a state + player pair, because the
// client knows its own species from the snapshot without carrying the whole
// player record around.
export const SIREN_HOME_LABEL = 'Cordelia';
export const EARTH_HOME_LABEL = 'LEO';
export function homeLabelForSpecies(species) {
  return species === 'siren' ? SIREN_HOME_LABEL : EARTH_HOME_LABEL;
}
export function homeSiteIdForSpecies(species) {
  return species === 'siren' ? SIREN_HOME_SITE : null;
}

// ----- species deck split (V9b) -----
//
// "When both species are present, split every patent deck and the colonist
// queue in two. The odd card goes to the Sirens. Earthlings cannot touch Siren
// decks and vice versa, except via trade or negotiation."
//
// The split happens ONCE, when the crew draft closes and every species is known,
// and only when BOTH species are actually at the table: an all-Siren game keeps
// a single shared library, because there is nobody to hide it from.
//
// The decks are already shuffled by then, so cutting each one into two
// contiguous halves is exactly as random as dealing alternately, and it keeps
// the cut trivially auditable: the Earthlings take the top floor(N/2), the
// Sirens take the rest (hence the odd card).
export function splitDeckForSpecies(cards) {
  const list = Array.isArray(cards) ? cards : [];
  const earthlingCount = Math.floor(list.length / 2);
  return {
    earthling: list.slice(0, earthlingCount),
    siren: list.slice(earthlingCount),
  };
}

// Does this table need split decks? Both species must actually be seated.
export function needsSpeciesSplit(state) {
  if (!isSirensGame(state)) return false;
  const players = (state && state.players) || [];
  return players.some((p) => p && p.species === 'siren')
    && players.some((p) => p && p.species === 'earthling');
}

// ----- solitaire deck split (V9b) -----
//
// The SOLO route for V9 is CEO Solitaire (V6), and its deck split is a different
// rule from the multiplayer one above: "the Sirens get all D and V patents and
// the Earthlings the remainder; the colonist queue still splits evenly."
//
// So this cut is by SPECTRAL TYPE, not by halves - the Sirens are carbon life
// out of a diamond ocean, so the D (diamond / carbonaceous) and V (volatile)
// technologies are theirs. Pure and card-shape agnostic: the caller passes a
// spectral lookup, because this module reads no card data of its own.
export const SIREN_SOLO_SPECTRALS = ['D', 'V'];
export function splitDeckForSoloSpecies(cards, spectralOf) {
  const list = Array.isArray(cards) ? cards : [];
  const siren = [];
  const earthling = [];
  for (const id of list) {
    (SIREN_SOLO_SPECTRALS.includes(spectralOf(id)) ? siren : earthling).push(id);
  }
  return { earthling, siren };
}

// ----- home orbits are scoped by species (V9) -----
//
// The map's home-Bernal anchor spaces are shared between the two species by
// SOLAR ZONE: the Uranus-zone ones are the Sirens' home orbits, the rest
// (Earth, plus the Venus one) are the Earthlings' (user 2026-07-28: "siren
// bernal is scoped to uranus home-bernal and human is scoped to human
// home-bernal spaces"). Within your own set, any of your Bernals may anchor at
// any free one.
//
// Keyed off the zone rather than a hardcoded node list so an admin re-tagging a
// node on /admin/site-tags does not silently break the rule. Returns true for
// anyone with no species - i.e. every non-Sirens game - so the caller can apply
// it unconditionally.
export const SIREN_HOME_ZONE = 'Uranus';
export function homeOrbitAllowsSpecies(species, zone) {
  if (species !== 'siren' && species !== 'earthling') return true;
  return species === 'siren' ? zone === SIREN_HOME_ZONE : zone !== SIREN_HOME_ZONE;
}
