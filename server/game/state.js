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
//     maxRounds                         game length: finish after N rounds
//     lastEvent                         { turn, round, dieRoll } | null
//     decks                             { thruster:[id...], ... }  (decks.js)
//     discs                             { [siteId]: {outcome, ownerId, ts} } (discs.js)
//     factories                         { [siteId]: {ownerId, spectralType} } (factories.js)
//     colonies                          { [siteId]: {ownerId} }
//     auction                           open competitive auction | null
//     players[]                         turn order (randomised at start)
//     activeIndex                       whose turn it is (async turn passing)
//     firstPlayerIndex                  seat that leads the current round
//     firstPlayerRotation               round-end first-player handoff on?
//     pendingFirstPlayer                { chooserId } while a handoff is open
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
import { CREW } from '../../data/crew.js';
import { freshAssembly, IDEOLOGY_ORDER, seatStartingDelegate } from '../../data/assembly.js';
import { makeRng, shuffle } from './rng.js';
// (startSiteId import dropped: the rocket now opens at LEO, siteId null.)

// --- Sunspot Cube clock (mirror of js/game/turn-clock.js) ---
export const SLOTS = 12;
export const NEW_ROUND_SLOT = 0;
// Odd slots - an event fires when the cube LANDS here (every 2 turns);
// slot 0 is the new-round tick only and carries no event.
// Mirror of js/game/turn-clock.js; keep synced.
export const EVENT_SLOTS = [1, 3, 5, 7, 9, 11];
// Season wedges mirror js/game/turn-clock.js: the new-round marker
// (slot 0) sits in the middle of Season Blue, so Blue WRAPS slot 0
// (slots 10, 11, 0, 1). A `from > to` entry wraps past slot 0.
export const SEASONS = [
  { name: 'blue', from: 10, to: 1 },
  { name: 'yellow', from: 2, to: 5 },
  { name: 'red', from: 6, to: 9 },
];
function slotInSeason(slot, s) {
  return s.from <= s.to
    ? (slot >= s.from && slot <= s.to)
    : (slot >= s.from || slot <= s.to);
}
export function seasonForSlot(slot) {
  return (SEASONS.find((s) => slotInSeason(slot, s)) || SEASONS[0]).name;
}
// Sunspot event kind for a d6 roll in a season. Rolls 1-4 are universal;
// 5-6 depend on the season the cube lands in. Mirror of the client's
// EVENT_TABLE rolls in js/game/turn-clock.js (which carries the display
// text + icons); keep the two in sync.
export function eventKindForRoll(d6, seasonName) {
  if (d6 <= 2) return 'inspiration';
  if (d6 === 3) return 'glitch';
  if (d6 === 4) return 'pad_explosion';
  if (seasonName === 'blue') return 'anarchy';
  if (seasonName === 'yellow') return 'budget_cuts';
  return 'solar_flare';
}

// --- Per-turn budgets (mirror turn-clock placeholders) ---
// The rulebook grants 4 ops/turn; the sandbox still runs the Stage-2
// placeholder of 1/1/1. We keep parity with the sandbox so multiplayer
// feels identical, and bump these in the same PR that widens the op set.
export const OPS_PER_TURN = 1;
export const MOVES_PER_TURN = 1;
export const DISCARDS_PER_TURN = 1;

// --- Economy / ship defaults ---
// The rocket opens with an EMPTY tank, exactly like the sandbox: water
// is not free. It comes from converting aqua 1:1 at LEO via the REFUEL
// op (engine.js). The old code spawned a flat 20 water as a stopgap
// before refuel existed, which read as "magic water" - now removed.
export const STARTING_WATER = 0;
export const AQUA_DEFAULT = 6;
// M1 adds two patent decks (Terawatt: GW thrusters + Freighters). The starting
// bank is ~$1 per patent deck, so an M1 game opens with +2 aqua over the base.
export const M1_AQUA_BONUS = 2;

export const DECK_TYPES = [
  'thruster', 'reactor', 'radiator', 'refinery', 'robonaut', 'generator',
];
// Module 1 adds two decks (Terawatt & Futures). Only dealt when state.m1 is on;
// an M1-off game never builds or sees them (zero bleed-through).
export const M1_DECK_TYPES = ['gw-thruster', 'freighter'];

// Per-seat marker colours = the six crew-card colours. Each crew
// card is associated with one of these slots; a player assigned
// colour X must pick a crew face from the card whose `color === X`.
// Sourced from data/crew.js so the two stay in lockstep (if a crew
// colour ever changes there, this list updates automatically).
export const PLAYER_COLORS = CREW.map((c) => c.color);

// Build the six shuffled patent decks from a seeded generator. Mirrors
// js/game/decks.js#buildShuffledFresh but driven by the game's RNG so
// the deal is reproducible. Expansion (gw-thruster) cards are excluded,
// same as the sandbox.
function buildShuffledDecks(gen, m1 = false) {
  // The base six always; the two M1 decks ONLY when m1. The base decks are
  // built + shuffled first in the SAME order regardless of m1, so an m1-off
  // game's deal is byte-for-byte identical to before (the M1 decks just consume
  // extra RNG at the end of an m1 game).
  const types = m1 ? [...DECK_TYPES, ...M1_DECK_TYPES] : DECK_TYPES;
  const decks = {};
  for (const t of types) decks[t] = [];
  for (const card of PATENTS) {
    if (!m1 && M1_DECK_TYPES.includes(card.type)) continue;
    if (!decks[card.type]) continue;
    decks[card.type].push(card.id);
  }
  for (const t of types) decks[t] = shuffle(gen, decks[t]);
  return decks;
}

function freshPlayer({ profileId, name, seat, color, aqua }) {
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
    // Privileges permanently gained from a card power (POWER GIRDLE / IONOSAT
    // grant Powersat). NOT a faction privilege, so Anarchy does not suspend it.
    grantedPrivileges: [],
    // Crew abilities borrowed from another player through a trade. Each entry is
    // { ability, fromPlayerId, turnsRemaining } where turnsRemaining === null
    // means a PERMANENT (irreversible) grant. Timed grants are decremented at
    // the holder's END_TURN and dropped at 0 (engine.js). Privilege resolution
    // unions these with the player's own abilities, so a borrowed power works
    // exactly like an owned one for its term. A grant is SHARED, not surrendered:
    // the lender keeps their ability while the borrower also holds it.
    borrowedAbilities: [],
    rocket: {
      // siteId null = parked at LEO (the launch anchor). There is no
      // explicit LEO node in SITES, so null is the canonical "at LEO"
      // value the whole stack agrees on: the client renders the rocket
      // at the LEO lagrange node, LEO <-> Rocket transfers are enabled
      // (TRANSFER op requires siteId == null), and the first MOVE
      // launches from LEO using the destination's dvLeo (engine
      // applyMove special-cases a null origin). It used to start at
      // startSiteId() (a real Earth site), which left the rocket NOT
      // colocated with the LEO Stack so the crew could never board.
      siteId: null,
      stack: [],
      activeThrusterId: null,
      activeProspectorId: null,
      tank: STARTING_WATER,
      // Fuel grade in the tank: 'water' (blue) or 'dirt' (grey). Water and
      // dirt cannot mix - a refuel of the other grade is blocked until the
      // tank empties. A water thruster burns ONLY water; a dirt thruster burns
      // EITHER grade (water or dirt). Default water; meaningless while tank is 0.
      tankGrade: 'water',
      afterburnEngaged: false,
      // Player support-chain wiring: which supplier card powers each consumer
      // for each support kind. Shape: { consumerId: { kind: supplierId } }.
      // Empty = the resolver picks the first matching supplier (the default
      // for the common single-supplier stack); a player only wires when a
      // consumer has more than one candidate. data/support-chain.js auto-falls
      // back to first-match for any entry whose supplier left the stack.
      wiring: {},
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
    // M1 Freighter unit (the player's "big cube"): null until ET-produced at a
    // Factory (see engine.js#applyEtProduce). One per player (1A4). Shape when
    // live:
    //   { cardId, face:'secondary', promoted:false, siteId:<slug>|null,
    //     stack:[{id,kind,face?}], tank:<water>, wiring:{} }
    // siteId is the map node it sits on (null = LEO); stack is its cargo
    // (Black-Side goods + supports); tank is its water. Only reachable when
    // state.m1 is true (every freighter code path gates on it).
    freighter: null,
    hand: [],
    boostMarks: [],
    // Starting bank. Defaults to the standard AQUA_DEFAULT; a solo game may
    // seed a bigger free-play bank (createInitialState passes startingAqua).
    aqua: Number.isFinite(aqua) ? aqua : AQUA_DEFAULT,
    glory: { chits: [], claimed: [], visited: [], vps: 0 },
    opsRemaining: OPS_PER_TURN,
    movesRemaining: MOVES_PER_TURN,
    // M1: the Freighter unit's own one-move-per-turn budget, independent of the
    // rocket's (a player with a freighter has TWO movers). Only consumed when a
    // freighter is in play.
    freighterMovesRemaining: MOVES_PER_TURN,
    discardsRemaining: DISCARDS_PER_TURN,
  };
}

// players: [{ profileId, name, seat }] (seat 1-based, any order).
// maxRounds: game length (rounds = Sunspot Cube cycles); default 5.
export function createInitialState({ players, seed, maxRounds = 5, startingAqua, economy, draftStart, randomDraft, m0, m1, m2 } = {}) {
  // Sort by the incoming (lobby) seat first so the shuffle has a
  // deterministic base regardless of how the caller ordered the array,
  // then randomise the turn order with the seeded RNG. Turn order IS
  // the array order, so we renumber `seat` to the shuffled position
  // (seat 1 = leads first) and assign colours by that same index -
  // which keeps the "seat = colour = turn order" reading the turn
  // banner + map markers rely on, just fresh every game. Reproducible
  // from (seed) for replay.
  const base = [...players].sort((a, b) => (a.seat || 0) - (b.seat || 0));
  const gen = makeRng(seed, 0);
  const ordered = shuffle(gen, base);
  // Per-game random colour palette: same six PLAYER_COLORS, shuffled
  // by the seeded RNG so each session deals a different palette while
  // still being reproducible from (seed). Colours are assigned in the
  // shuffled turn order so no one is always "the yellow player".
  const palette = shuffle(gen, PLAYER_COLORS);
  const decks = buildShuffledDecks(gen, !!m1);
  const rounds = [4, 5, 6, 7].includes(maxRounds) ? maxRounds : 5;
  // Card economy + starting bank. Standard multiplayer is always 'market' +
  // AQUA_DEFAULT (the caller enforces that for 2+ player games); a solo game
  // may pick Free Library and a free-play bank. Anything unrecognised falls
  // back to the standard values.
  const econ = economy === 'library' ? 'library' : 'market';
  // Draft-start mode: the whole opening is a card draft (each player takes the
  // top of a market deck for free until everyone holds DRAFT_HAND_SIZE cards),
  // then banks are set to 6 and normal play begins. During the draft players
  // hold 0 aqua (picks are free), so the starting bank is withheld here.
  const draft = !!draftStart;
  // M1 adds two patent decks (the Terawatt GW-thruster + Freighter decks), and
  // the starting bank is ~$1 per patent deck, so an M1 game opens with +2 aqua.
  const m1AquaBonus = m1 ? M1_AQUA_BONUS : 0;
  const startAqua = draft ? 0
    : ((Number.isFinite(startingAqua) ? Math.max(0, Math.floor(startingAqua)) : AQUA_DEFAULT) + m1AquaBonus);
  // M0: every player opens with one delegate already seated in "their" ideology,
  // assigned by turn-order position around the hex (seat 1 -> first ideology, and
  // so on, wrapping past 6). Leaves DELEGATES_PER_PLAYER-1 in hand.
  const assembly = m0 ? freshAssembly() : null;
  // Each player's HOME ideology - where their starting delegate sits and the one
  // space a new delegate may always be placed on (Fundraise rule). A faction's
  // colour IS its ideology, so the opening cube starts in the ideology matching
  // the player's seat colour (the same colour they'll pick crew in), keeping the
  // cube colour aligned with the zone it sits in. The seat-order ideology is
  // only a fallback if a colour has no mapping. PICK_CREW re-seats via the same
  // helper. Keyed by profileId.
  const homeIdeology = {};
  if (assembly) {
    ordered.forEach((p, i) => {
      const color = palette[i % palette.length];
      const fallback = IDEOLOGY_ORDER[i % IDEOLOGY_ORDER.length];
      homeIdeology[p.profileId] = seatStartingDelegate(assembly, p.profileId, color, fallback);
    });
  }
  return {
    version: 2,
    seed,
    rng: { cursor: gen.cursor },
    status: 'active',
    // Draft-start mode flag (see startAqua above). applyPickCrew flips the
    // phase to 'draft' instead of 'play' when this is set.
    draftStart: draft,
    // Random-draft mode: applyPickCrew deals 12 random cards per player and goes
    // straight to play (no interactive draft). Independent of draftStart.
    randomDraft: !!randomDraft,
    // Draft phase. Every game opens in 'crew' - all players pick a
    // faction and may re-pick freely until everyone has chosen. The
    // engine's applyPickCrew flips this to 'play' the moment the
    // last player commits, and from then on PICK_CREW is locked and
    // the regular gameplay ops (MOVE / BURN / AUCTION_* / END_TURN
    // / etc.) start being accepted.
    draftPhase: 'crew',
    // Draft-start only: tracks whether the active player has used their one
    // per-turn deck cycle yet (reset each draft turn). Inert outside the draft.
    draftCycledThisTurn: false,
    // Card economy. Multiplayer is always 'market' (Card Market mode is
    // mandatory in MP - patents are auctioned, not free draws, and the Free
    // Market sell op is available); a solo game may choose 'library'. Server-
    // owned so the client can't fall back to Free Library by wiping
    // localStorage; net-bridge reads it on every snapshot and pins the
    // client's MARKET_MODE.
    economy: econ,
    turn: 0,
    round: 1,
    // Game length. The game finishes once `round` passes maxRounds
    // (rounds are full Sunspot Cube cycles - see engine advanceClock).
    maxRounds: rounds,
    lastEvent: null,
    activeIndex: 0,
    // First-player token. Each round runs one lap of the table starting
    // from firstPlayerIndex; when the round (Sunspot cycle) closes, the
    // player who led it picks the next first player (engine END_TURN +
    // SET_FIRST_PLAYER). firstPlayerRotation gates that handoff so it
    // applies to games created from this version on - older saved games
    // have neither field and keep the legacy "seat 0 always leads,
    // rounds auto-advance" flow untouched. pendingFirstPlayer holds the
    // open handoff ({ chooserId }) and freezes every other op until the
    // pick lands, the way an open auction does.
    firstPlayerIndex: 0,
    firstPlayerRotation: true,
    pendingFirstPlayer: null,
    // M0: while set, the round's first player owes a seniority-disc placement
    // before the round resolves. { chooserId }. Null otherwise.
    pendingSeniority: null,
    // Open Sunspot-event choice, when an event needs input from one or
    // more players (Budget Cuts discard pick, Pad Explosion tie-break).
    // { kind, waiting: [profileId...], options?: { [profileId]: [cardId...] } }
    // Freezes every other op (except EVENT_CHOICE) until all answers land,
    // the way an open auction does. Cleared when `waiting` empties.
    pendingEvent: null,
    // Anarchy event flag: set when the cube rolls Anarchy in season blue,
    // cleared by the engine when the cube exits blue. Flavor-level for now
    // (faction privileges are Module 0, out of current scope); surfaced in
    // logs + UI so the table knows the event is live.
    anarchy: false,
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
    // M1 Mobile Factories (rule 1B6): factory cubes that lifted off a Claim and
    // are now moving like the Freighter. Each entry is a cube in transit / parked
    // OFF a claim: { id, ownerId, siteId, spectralType, route, glitched, movedKey }.
    // A cube on a Claim is a normal `factories` entry; lifting off moves it here,
    // landing on the owner's Claim moves it back. Default [] so an M1-off game
    // carries none (zero-bleed); only reachable when state.m1 is true.
    mobileCubes: [],
    // M1 Space Elevators (rule 1B9): { [pairKey]: { ownerId } }. Default {} so an
    // M1-off game carries none (zero-bleed); only reachable when state.m1 is true.
    elevators: {},
    // Module 0 (Sol Political Assembly). m0 is fixed at game start (chosen at
    // room creation); games already in flight default to false (no retro apply).
    // `assembly` holds delegate placements + drives the active-law resolver.
    m0: !!m0,
    // Module 1 (Terawatt & Futures). ADMIN-ONLY + experimental, fixed at game
    // start. Defaults false. NOTHING M1 (freighters, GW thrusters, isotope fuel,
    // mobile factories, Futures) may activate unless state.m1 is true - every
    // M1 rule/op/UI path MUST gate on this flag so an M1-off game is byte-for-
    // byte the base game (see CLAUDE.md "Module gating").
    m1: !!m1,
    // Module 2 (Futures). ADMIN-ONLY + experimental, fixed at game start. Defaults
    // false. NOTHING M2 (Futures) may activate unless state.m2 is true.
    m2: !!m2,
    assembly,
    homeIdeology,
    // Active-law star: the marker for the in-power ideology, moved by the
    // fundraiser on each vote tally. Starts at the Centrist center (no law).
    activeLawStar: 'centrist',
    auction: null,
    // Open player-to-player trade negotiation, or null. A side-channel deal that
    // both parties must consent to (offer / counter / accept handshake); it does
    // NOT cost the turn's operation and may be opened at any point, on or off
    // turn. One open trade at a time (v1). See engine.js TRADE ops + the shape
    // they write: { initiatorId, partnerId, awaiting, version, give, receive,
    // location }. give/receive are always written from the initiator's
    // perspective. Not redacted (a negotiation is open info, like hands in MP).
    trade: null,
    players: ordered.map((p, i) =>
      freshPlayer({
        profileId: p.profileId,
        name: p.name,
        seat: i + 1,
        color: palette[i % palette.length],
        aqua: startAqua,
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
