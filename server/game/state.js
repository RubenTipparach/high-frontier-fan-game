// Authoritative game state: the shape, the constants, and the
// initial-state factory.
//
// The state mirrors the single-player sandbox so a multiplayer table
// holds the same things the local game does, just server-side and
// per-player. Field names track the sandbox modules they came from:
//
//   shared:
//     seed, rng.cursor                  deterministic RNG (rng.js)
//     turn (0..11), round (1..)         Sunspot Cube clock (turn-clock.js)
//     lastEvent                         { turn, round, dieRoll } | null
//     decks                             { thruster:[id...], ... }  (decks.js)
//     discs                             { [siteId]: {outcome, ownerId, ts} } (discs.js)
//     factories                         { [siteId]: {ownerId, spectralType} } (factories.js)
//     colonies                          { [siteId]: {ownerId} }
//     auction                           open competitive auction | null
//     players[]                         ordered by seat
//     activeIndex                       whose turn it is (async turn passing)
//     status                            'active' | 'finished'
//
//   per player (mirrors rocket.js / hand.js / stacks.js / glory.js):
//     profileId, name, seat, color
//     rocket   { siteId, stack:[{id,kind,face?}], activeThrusterId,
//                activeProspectorId, tank, afterburnEngaged }
//     outposts { A?|B?|C?|D?: {letter, siteId, cards:[], tank} }
//     hand     [id...]            boostMarks [id...]
//     aqua     number
//     glory    { chits:[], claimed:[], visited:[], vps }
//     opsRemaining / movesRemaining / discardsRemaining
//
// MOVE, END_TURN, and the AUCTION ops mutate this today (engine.js);
// the rest of the shape is carried now so later ops (BUILD / PROSPECT)
// slot in without a schema migration.

import { PATENTS } from '../../data/patents.js';
import { makeRng, shuffle } from './rng.js';
import { startSiteId } from './graph.js';

// --- Sunspot Cube clock (mirror of js/game/turn-clock.js) ---
export const SLOTS = 12;
export const NEW_ROUND_SLOT = 0;
export const EVENT_SLOTS = [1, 3, 5, 7, 9, 11];
export const SEASONS = [
  { name: 'blue', from: 0, to: 3 },
  { name: 'yellow', from: 4, to: 7 },
  { name: 'red', from: 8, to: 11 },
];
export function seasonForSlot(slot) {
  return (SEASONS.find((s) => slot >= s.from && slot <= s.to) || SEASONS[0]).name;
}

// --- Per-turn budgets (mirror turn-clock placeholders) ---
// The rulebook grants 4 ops/turn; the sandbox still runs the Stage-2
// placeholder of 1/1/1. We keep parity with the sandbox so multiplayer
// feels identical, and bump these in the same PR that widens the op set.
export const OPS_PER_TURN = 1;
export const MOVES_PER_TURN = 1;
export const DISCARDS_PER_TURN = 1;

// --- Economy / ship defaults ---
// The sandbox opens a rocket empty with a 0 tank and refuels at LEO.
// Multiplayer v1 has no BUILD / refuel op yet, so each ship opens with
// a starting water budget (akin to solo.js STARTING_WATER) so MOVE is
// playable immediately. This is a balance constant, revisited when the
// build + refuel ops land.
export const STARTING_WATER = 20;
export const AQUA_DEFAULT = 6;

export const DECK_TYPES = [
  'thruster', 'reactor', 'radiator', 'refinery', 'robonaut', 'generator',
];

// Per-seat marker colours (first six seats; cycles after that).
export const PLAYER_COLORS = [
  '#facc15', '#38bdf8', '#f87171', '#a78bfa', '#34d399', '#fb923c',
];

// Build the six shuffled patent decks from a seeded generator. Mirrors
// js/game/decks.js#buildShuffledFresh but driven by the game's RNG so
// the deal is reproducible. Expansion (gw-thruster) cards are excluded,
// same as the sandbox.
function buildShuffledDecks(gen) {
  const decks = {};
  for (const t of DECK_TYPES) decks[t] = [];
  for (const card of PATENTS) {
    if (card.type === 'gw-thruster') continue;
    if (!decks[card.type]) continue;
    decks[card.type].push(card.id);
  }
  for (const t of DECK_TYPES) decks[t] = shuffle(gen, decks[t]);
  return decks;
}

function freshPlayer({ profileId, name, seat, color }) {
  return {
    profileId,
    name,
    seat,
    color,
    // Starting crew faction. Each player picks one face of the 12
    // crew-card faces via the PICK_CREW op (engine.js) at session
    // open. Null until the player has picked; the client
    // (browse.js#bootstrapOnlineGame) opens the crew wizard for
    // any player whose faction is null on snapshot. Once committed
    // it is final - PICK_CREW rejects re-picks.
    faction: null,
    rocket: {
      siteId: startSiteId(),
      stack: [],
      activeThrusterId: null,
      activeProspectorId: null,
      tank: STARTING_WATER,
      afterburnEngaged: false,
    },
    // LEO Stack: a per-player parking lot of cards staged at LEO.
    // Always at LEO by construction (no siteId field needed - LEO
    // has no real site id). Flat array of { id, kind, face? } slots
    // matching js/game/leo-stack.js's slot shape, so hydrateLeo
    // (net-bridge.js) can hand the array straight to the sandbox
    // module. Starts empty; PICK_CREW pushes the player's chosen
    // crew here. Future BUILD ops will move cards Hand -> LEO and
    // LEO -> Rocket.
    leo: [],
    // Outposts A-D: keyed by single-letter id when built. Each entry
    // mirrors the sandbox shape (js/game/stacks.js) so net-bridge's
    // spread hands the object straight to hydrateOutposts:
    //   { letter, siteId, cards: [{id, kind, face?}, ...], tank }
    // Empty until a future BUILD_OUTPOST op fires; the siteId is
    // the data/sites.js slug the outpost was built at (any non-LEO
    // node the player chose).
    outposts: {},
    hand: [],
    boostMarks: [],
    aqua: AQUA_DEFAULT,
    glory: { chits: [], claimed: [], visited: [], vps: 0 },
    opsRemaining: OPS_PER_TURN,
    movesRemaining: MOVES_PER_TURN,
    discardsRemaining: DISCARDS_PER_TURN,
  };
}

// players: [{ profileId, name, seat }] (seat 1-based, any order).
export function createInitialState({ players, seed }) {
  const ordered = [...players].sort((a, b) => (a.seat || 0) - (b.seat || 0));
  const gen = makeRng(seed, 0);
  // Per-game random colour palette: same six PLAYER_COLORS, shuffled
  // by the seeded RNG so each session deals a different palette while
  // still being reproducible from (seed). Colours are then assigned
  // in seat order so seat 1 = palette[0], seat 2 = palette[1], etc -
  // which keeps the "colour = turn order" reading the turn banner +
  // map markers rely on, while making the specific seat -> colour
  // mapping fresh every game (so no one is always "the yellow
  // player").
  const palette = shuffle(gen, PLAYER_COLORS);
  const decks = buildShuffledDecks(gen);
  return {
    version: 2,
    seed,
    rng: { cursor: gen.cursor },
    status: 'active',
    turn: 0,
    round: 1,
    lastEvent: null,
    activeIndex: 0,
    // Per-turn functional-op stacks for undo/redo. Only the active
    // player has an in-progress turn, so these live at the top level
    // and reset every time a turn passes (see engine END_TURN). They
    // hold tiny op descriptors ({ kind, payload, rolled }), never
    // nested snapshots, so the state blob stays flat.
    turnActions: [],
    turnRedo: [],
    decks,
    discs: {},
    factories: {},
    colonies: {},
    auction: null,
    players: ordered.map((p, i) =>
      freshPlayer({
        profileId: p.profileId,
        name: p.name,
        seat: p.seat || i + 1,
        color: palette[i % palette.length],
      })
    ),
    startedAt: Date.now(),
  };
}

export function currentPlayer(state) {
  return state.players[state.activeIndex] || null;
}

export function playerIndexByProfile(state, profileId) {
  return state.players.findIndex((p) => p.profileId === profileId);
}

export function isPlayersTurn(state, profileId) {
  const p = currentPlayer(state);
  return !!p && p.profileId === profileId;
}
