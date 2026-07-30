// V5 "Hermes Fall" (Phil Eklund): a one-player mission. The binary asteroid
// Hermes is on an Earth-crossing path, and the only way to turn it is to reach
// both halves and plant factories that drive embedded dirt thrusters off the
// asteroids' own regolith. Two Seniority Disks are all the time there is.
// See docs/variants-tracker.md for the full rule list.
//
// Pure data + pure functions, imported by BOTH the server engine and the browser
// client (same contract as data/sirens.js and data/fuel-graph.js): no DOM, no
// `node:` imports. Every export answers a question about the variant; NONE of
// them do anything unless state.hermes is true, so a normal game is untouched.

// The two halves of the binary. Industrializing BOTH before the clock runs out
// is the whole victory condition, so this pair is the variant's spine: setup
// leaves them alone, prospecting auto-succeeds on them, industrializing them
// costs a dirt rocket, and the endgame reads them.
//
// Spelled as PLANNER SLUGS (hyphens), because that is the id space the engine
// actually runs on: `siteBySlug('hermes-a')` resolves, `siteBySlug('hermes_a')`
// does NOT, and `state.factories` / `state.discs` are keyed the same way. The
// `data/sites.js` RECORD for the same site carries the underscored id
// (`hermes_a`), so both spellings are in circulation - the same two-id-space
// hazard data/sirens.js documents. Rather than make every caller remember which
// one it is holding, fold the separator so either spelling matches.
export const HERMES_SITES = ['hermes-a', 'hermes-b'];

function canonicalSiteId(id) {
  return String(id || '').replace(/_/g, '-').toLowerCase();
}

export function isHermesSite(slug) {
  const want = canonicalSiteId(slug);
  return HERMES_SITES.some((s) => canonicalSiteId(s) === want);
}

// Is this game running the variant? Mirrors isSirensGame - the flag is absent
// (not false) in every other room, so a plain truthiness read is the contract.
export function isHermesGame(state) {
  return !!(state && state.hermes);
}

// ----- setup -----

// Two Seniority Disks in the centre of the Sunspot Cycle (V5 keeps its OWN disk
// count rather than inheriting V4b's 4/5/7 - the short clock IS the scenario).
// This implementation runs the disk clock off the ROUND count, one disk per
// Solar Cycle, so two disks means two rounds. Forced at setup, not offered as a
// length choice, because any other number is a different scenario.
export const HERMES_ROUNDS = 2;

// The Mass Driver is set aside BEFORE deck setup and then shuffled into the top
// five cards of the thruster deck, so the mission's signature dirt thruster is
// always reachable early and can never be culled by V4b's half-deck truncation.
export const MASS_DRIVER_ID = 'thr_mass_driver';
export const MASS_DRIVER_TOP_N = 5;

// V4b half-deck truncation, inherited by V5: shuffle as normal, then remove the
// BOTTOM half of each deck, ROUNDING UP, sight unseen. Rounding up applies to
// the number REMOVED, so an 11-card deck keeps 5 and loses 6.
//
// Pure on purpose: it takes an already-shuffled array and returns the kept
// prefix, so the caller controls the shuffle (and its RNG) and this stays
// testable without a generator.
export function truncateBottomHalf(deck) {
  const list = Array.isArray(deck) ? deck : [];
  const removed = Math.ceil(list.length / 2);
  return list.slice(0, Math.max(0, list.length - removed));
}

// Where in the thruster deck's top five the Mass Driver lands. `roll` is a
// 1..6 die from the caller's seeded generator, so the placement is replayable
// like every other setup decision. A deck shorter than five just takes the
// whole deck as its window.
export function massDriverIndex(deckLength, roll) {
  const window = Math.min(MASS_DRIVER_TOP_N, Math.max(1, (deckLength | 0) + 1));
  return Math.max(0, (Number(roll) || 1) - 1) % window;
}

// ----- special rules -----

// A "dirt rocket" is the grey thrust triangle on the published cards: a thruster
// face whose propellant is DIRT (regolith) rather than water. `fuelType` is the
// spreadsheet column that drives the grey triangle in the card renderer
// (js/game/card-ui.js reads the same field), so it is the marker here too rather
// than a hand-kept card list that could drift from the sheet.
export function faceIsDirtFuelled(face) {
  const ft = face && face.fuelType;
  return !!(ft && /dirt/i.test(String(ft)));
}

// Industrializing a Hermes site additionally requires decommissioning an
// OPERATIONAL dirt rocket: a card whose installed face is dirt-fuelled AND
// carries a thrust value (the triangle has to be there to be grey). The caller
// resolves each build-set card to its installed face; this decides the verdict.
export function buildSetHasDirtRocket(faces) {
  return (faces || []).some((f) => faceIsDirtFuelled(f) && f && f.thrust != null);
}

// ----- victory -----

// The mission succeeds when BOTH halves of the binary carry this player's
// factory when the clock runs out. Single binary win/lose, unlike V6's bands.
// `factories` is state.factories (keyed by server slug).
export function hermesSitesIndustrialized(factories, ownerId) {
  // Scan the factory map's OWN keys rather than indexing by the canonical slug,
  // so a factory stored under either spelling is counted. Reading `factories`
  // directly with one spelling was how this would silently report "0 of 2" on a
  // board that had actually been won.
  const seen = new Set();
  for (const [slug, f] of Object.entries(factories || {})) {
    if (!f || String(f.ownerId) !== String(ownerId)) continue;
    if (isHermesSite(slug)) seen.add(canonicalSiteId(slug));
  }
  return HERMES_SITES.filter((s) => seen.has(canonicalSiteId(s)));
}

export function hermesDeflected(factories, ownerId) {
  return hermesSitesIndustrialized(factories, ownerId).length === HERMES_SITES.length;
}
