// V4 "Altruism" (Phil Eklund): go it alone or go it together, for the future of
// the species. One player, or two-plus COOPERATIVE - the only variant where a
// table shares a win condition that is scored per seat.
//
// This is the BASE the other solo scenarios were written against: V5 Hermes
// Fall's setup is "as per Altruism (V4b)" and both V5 and V6 defer to V4c for
// their auction. Those pieces shipped ahead of V4 itself, so this module is
// partly a matter of giving them their proper home rather than writing new
// rules - `truncateBottomHalf` lives here now and V5 imports it.
//
// Pure data + pure functions, imported by BOTH the server engine and the browser
// client (same contract as data/hermes.js and data/sirens.js): no DOM, no
// `node:` imports. Nothing here does anything unless state.altruism is true.

// ----- setup (V4b) -----

// Seniority disks: 4 short, 5 intermediate, 7 with Futures. This implementation
// runs the disk clock off the ROUND count (one disk per Solar Cycle), so those
// are the legal game lengths and nothing else is. Same three lengths V9 uses -
// see data/sirens.js#SIREN_ROUNDS, deliberately the same shape.
export const ALTRUISM_ROUNDS = { short: 4, intermediate: 5, futures: 7 };

export function isLegalAltruismRounds(rounds) {
  return Object.values(ALTRUISM_ROUNDS).includes(Number(rounds));
}

// Which length a round count IS, for the victory table below. Anything
// unrecognised reads as the intermediate game rather than throwing: a legacy
// row with an odd max_rounds should still be scoreable.
export function altruismLength(maxRounds) {
  const n = Number(maxRounds);
  if (n === ALTRUISM_ROUNDS.short) return 'short';
  if (n === ALTRUISM_ROUNDS.futures) return 'futures';
  return 'intermediate';
}

// V4b patent decks: shuffle as normal, then remove the BOTTOM half of each deck,
// ROUNDING UP, sight unseen. Rounding up applies to the number REMOVED, so an
// 11-card deck keeps 5 and loses 6.
//
// Pure on purpose: it takes an already-shuffled array and returns the kept
// prefix, so the caller owns the shuffle (and its seeded RNG) and this stays
// testable without a generator.
//
// This function used to live in data/hermes.js, which is where it was first
// needed; V5 inherits the rule from V4b rather than owning it, so it sits here
// now and hermes.js re-exports it. Behaviour is unchanged.
export function truncateBottomHalf(deck) {
  const list = Array.isArray(deck) ? deck : [];
  const removed = Math.ceil(list.length / 2);
  return list.slice(0, Math.max(0, list.length - removed));
}

// ----- the faction bank (C5, B6a) -----

// Three faction privileges only pay out by READING THE REST OF THE TABLE, so
// they are close to dead with nobody to read:
//
//   TAXES (Roscosmos)             +1 Aqua after ANY player claims or industrializes
//   SECRETARY GENERAL (UN)        +2 Aqua, which Module 2 defers to a first anchor
//   FELONIOUS (Taikonauts)        your Humans may act Feloniously. "Negotiable."
//
// V4b's answer is a flat bank: a faction carrying one of them opens with an
// EXTRA 6 Aqua instead. Paid once, at crew-draft close, on top of whatever the
// privilege itself pays (a UN seat still takes its own +2 where Module 2 has
// not deferred it), and unconditionally - Module 2 does not defer this half.
export const FACTION_BANK_AQUA = 6;

export const FACTION_BANK_PRIVILEGES = ['TAXES', 'SECRETARY_GENERAL', 'FELONIOUS'];

// SpaceX is the fourth faction a table-less game blunts - MARKETEER only breaks
// auction ties, and these games hold no auctions - but it is deliberately NOT on
// the list above. V9c hands it a substitute of its own instead: "with the
// Marketeer faction privilege, during research auctions you are allowed to buy 3
// cards for 2 aqua", which applies to the V4c research take. That lives in the
// engine's research-take path, not here.

// Does this game pay the faction bank? Published V4b writes it as a SOLITAIRE
// setup rule, and this implementation widens it on a balance call (user
// 2026-09-10): every one-seat table, CEO Solitaire included, plus every Altruism
// game at any seat count - a cooperative table has no rivals to tax either.
//
// CEO Solitaire used to be carved out of this on the grounds that it runs its
// own fixed budget. That carve-out was overridden deliberately; do not put it
// back without asking.
export function paysFactionBank(state) {
  return seatCount(state) === 1 || isAltruismGame(state);
}

// Is this privilege one the bank pays for? Null / unknown keys read false, so an
// Anarchy-suppressed privilege (privilegeOf returns null during Anarchy) does
// not qualify.
export function factionBankApplies(privilegeKey) {
  return FACTION_BANK_PRIVILEGES.includes(String(privilegeKey || ''));
}

// ----- victory -----

// The VP each seat must reach. Solitaire is one player clearing a high bar;
// cooperative is EVERY player clearing a lower one. Note the co-op number is per
// player and NOT a pooled total: one lagging seat loses it for the whole table,
// which is the entire tension of the co-op game.
export const ALTRUISM_TARGETS = {
  solo: { short: 40, intermediate: 60, futures: 100 },
  coop: { short: 30, intermediate: 50, futures: 75 },
};

export function altruismTarget(seats, maxRounds) {
  const table = seatCount(seats) === 1 ? ALTRUISM_TARGETS.solo : ALTRUISM_TARGETS.coop;
  return table[altruismLength(maxRounds)];
}

// The verdict, from a list of `{ profileId, name, vp }`. Cooperative, so there
// is ONE outcome for the table and it is the AND of every seat: `won` is true
// only when nobody fell short. `shortfalls` names who did, so the endgame log
// can say why the table lost rather than just that it did.
//
// Solitaire is the one-seat case of the same rule, which is why there is no
// separate solo path here.
export function altruismVerdict(scores, seats, maxRounds) {
  const target = altruismTarget(seats, maxRounds);
  const list = Array.isArray(scores) ? scores : [];
  const shortfalls = list
    .filter((s) => (Number(s && s.vp) || 0) < target)
    .map((s) => ({ profileId: s.profileId, name: s.name, vp: Number(s.vp) || 0, short: target - (Number(s.vp) || 0) }));
  return { won: list.length > 0 && shortfalls.length === 0, target, shortfalls };
}

// ----- shared -----

// How many seats a table has, from whatever shape the caller is holding (a
// state, an array of players, or a plain number). Every rule above keys off this
// one reading so a state and a snapshot can never disagree about the mission.
// Mirrors data/hermes.js#hermesSeatCount.
function seatCount(x) {
  if (x == null) return 1;
  if (typeof x === 'number') return Math.max(1, x | 0);
  if (Array.isArray(x)) return Math.max(1, x.length);
  if (Array.isArray(x.players)) return Math.max(1, x.players.length);
  return 1;
}

export function altruismSeatCount(x) {
  return seatCount(x);
}

// Is this game running the variant? Mirrors isHermesGame / isSirensGame - the
// flag is absent (not false) in every other room, so a plain truthiness read is
// the contract.
export function isAltruismGame(state) {
  return !!(state && state.altruism);
}

// Is this a cooperative table rather than a solitaire run? Both are Altruism;
// they differ in the target and in whether the faction bank applies.
export function isAltruismCoop(state) {
  return isAltruismGame(state) && seatCount(state) > 1;
}
