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

// The mission scales with the table (user 2026-08-07). More hands make the
// deflection easier, so more is asked of them:
//
//   1 seat  - both halves of the binary. Prospecting them is waived (see below).
//   2 seats - both halves, and the waiver is GONE: the halves are hydration 0,
//             so claiming one now takes a robonaut whose effective ISRU is 0.
//   3 seats - the above, plus Comet Neujmin 1 industrialized on the same terms.
//             Its own hydration (4) gates it the ordinary way.
//
// Capped at 3: past that the mission is not the scenario any more.
export const HERMES_MAX_PLAYERS = 3;

// The third target, added at three seats. A comet rather than a second rock:
// Neujmin is the volatile source the bigger crew is expected to secure while the
// binary is worked. Planner slug, like HERMES_SITES.
export const NEUJMIN_SITE = 'comet-neujmin-1';

// How many seats a table has, from whatever shape the caller is holding (a
// state, an array of players, or a plain number). Every rule below keys off this
// one reading so a state and a snapshot can never disagree about the mission.
export function hermesSeatCount(x) {
  if (x == null) return 1;
  if (typeof x === 'number') return Math.max(1, x | 0);
  if (Array.isArray(x)) return Math.max(1, x.length);
  if (Array.isArray(x.players)) return Math.max(1, x.players.length);
  return 1;
}

// The sites this table has to industrialize. THE mission definition - victory,
// the briefing, and the industrialize rules all read it, so the seat count is
// asked once here rather than re-derived at each call site.
export function hermesTargetSites(seats) {
  const n = hermesSeatCount(seats);
  return n >= 3 ? [...HERMES_SITES, NEUJMIN_SITE] : [...HERMES_SITES];
}

export function isHermesTargetSite(slug, seats) {
  const want = canonicalSiteId(slug);
  return hermesTargetSites(seats).some((s) => canonicalSiteId(s) === want);
}

// Does the ordinary "ISRU must be <= hydration" prospect gate apply?
//
// SOLO keeps the waiver it has always had: both halves are hydration 0, so
// without it no prospector in the game could claim one and the one-seat mission
// could never start. From TWO seats up the waiver is gone and the gate is the
// requirement - which at hydration 0 means a robonaut whose effective ISRU is 0
// (three faces in the deck carry one, all on their black side). At three seats
// it also gates Neujmin, the ordinary way, against its own hydration.
export function hermesProspectWaived(seats) {
  return hermesSeatCount(seats) < 2;
}

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

// Turn slots on the Sunspot Cube dial, one Solar Cycle's worth. Mirrors SLOTS in
// server/game/state.js and js/game/turn-clock.js; a cycle IS 12 turns, which is
// the unit the mission countdown speaks in (user 2026-07-30).
export const TURNS_PER_CYCLE = 12;

// Turns left before Hermes arrives. The clock the whole scenario runs on, phrased
// the way the briefing and the turn-bar chip both want it: a single falling
// number rather than "cycles and a bit".
//
// `turn` is the 0-based cube slot and `round` is 1-based, so the turns already
// spent are (round - 1) * 12 + turn. A 2-cycle mission therefore opens at 24 and
// reads 1 on the last playable turn; ending that turn pushes round past maxRounds,
// which is exactly when the engine writes the verdict, so 0 IS impact and the
// number never lies about how much game is left.
//
// Display-only: no rule reads this, and the engine decides the ending off the
// round cap as it always has. Floored at 0 so a finished game never shows a
// negative countdown.
export function turnsToImpact({ round = 1, turn = 0, maxRounds = HERMES_ROUNDS } = {}) {
  const total = (Number(maxRounds) || HERMES_ROUNDS) * TURNS_PER_CYCLE;
  const spent = ((Number(round) || 1) - 1) * TURNS_PER_CYCLE + (Number(turn) || 0);
  return Math.max(0, total - spent);
}

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

// The mission succeeds when BOTH halves of the binary carry a factory when the
// clock runs out. Single binary win/lose, unlike V6's bands.
//
// COOPERATIVE (user 2026-07-31: "hermes is cooperative", "it is both solo and
// co-op"). The deflection belongs to the TABLE, not to one player: turning a
// rock does not care whose name is on the factory, so any player's counts and
// everyone shares the verdict. Solo is simply the one-seat case of that rule.
//
// `ownerId` therefore defaults to ANYONE: pass null / omit it for the mission
// verdict. A concrete ownerId still filters to that player, which is what a
// per-seat readout wants ("halves YOU have planted"), but it must never decide
// the ending - that was the bug this fixes, where the engine scored
// state.players[0] alone, so a co-op table could plant both halves and still be
// told the asteroid hit.
//
// `factories` is state.factories (keyed by server slug).
// `seats` scales the target set (see hermesTargetSites). Omitting it keeps the
// two-half mission, which is what every pre-2026-08-07 caller meant.
export function hermesSitesIndustrialized(factories, ownerId = null, seats = 1) {
  // Scan the factory map's OWN keys rather than indexing by the canonical slug,
  // so a factory stored under either spelling is counted. Reading `factories`
  // directly with one spelling was how this would silently report "0 of 2" on a
  // board that had actually been won.
  const targets = hermesTargetSites(seats);
  const anyOwner = ownerId == null;
  const seen = new Set();
  for (const [slug, f] of Object.entries(factories || {})) {
    if (!f) continue;
    if (!anyOwner && String(f.ownerId) !== String(ownerId)) continue;
    if (targets.some((t) => canonicalSiteId(t) === canonicalSiteId(slug))) seen.add(canonicalSiteId(slug));
  }
  return targets.filter((s) => seen.has(canonicalSiteId(s)));
}

export function hermesDeflected(factories, ownerId, seats = 1) {
  return hermesSitesIndustrialized(factories, ownerId, seats).length === hermesTargetSites(seats).length;
}
