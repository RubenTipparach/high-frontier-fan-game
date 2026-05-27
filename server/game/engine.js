// Server-authoritative rules engine.
//
// applyOperation(state, op, ctx) is the single chokepoint for every
// game mutation. It validates the op against the current state and the
// caller (ctx.profileId), and on success returns a brand-new state
// (the input is never mutated) plus a short human log line. The HTTP /
// WS layer persists the returned state and appends the op to the log;
// the engine itself touches no I/O.
//
// Ops are split into two classes:
//   - FUNCTIONAL ops (MOVE, later PROSPECT/BUILD/...) change the game
//     and are pushed onto the active player's per-turn undo stack.
//   - META ops manage flow/history: END_TURN (commits the turn and
//     passes control), UNDO, REDO.
//
// Undo/redo model (see the PR that introduced it):
//   - Only the active player, only within their own turn, only before
//     END_TURN (which commits) and only back as far as the most recent
//     dice roll. A roll is detected by state.rng.cursor advancing, so
//     an op that consumed randomness is a hard barrier: you can rewind
//     forward-of-roll actions but never the roll itself or earlier
//     (which would leak the now-known outcome).
//   - UNDO/REDO recompute the state by replaying the surviving turn
//     actions on top of the turn-base snapshot (the state at the start
//     of this player's turn), which the caller supplies as
//     ctx.turnBaseState. This keeps the engine pure and avoids storing
//     nested snapshots inside the state blob.

import { PATENTS_BY_ID } from '../../data/patents.js';
import { CREW_BY_ID } from '../../data/crew.js';
import { siteById, findPath } from './graph.js';
import { makeRng } from './rng.js';
import {
  SLOTS, NEW_ROUND_SLOT, EVENT_SLOTS,
  OPS_PER_TURN, MOVES_PER_TURN, DISCARDS_PER_TURN,
  currentPlayer, isPlayersTurn,
} from './state.js';

function clone(state) {
  return (typeof structuredClone === 'function')
    ? structuredClone(state)
    : JSON.parse(JSON.stringify(state));
}

function fail(error) { return { ok: false, error }; }

// Base mass of one stack slot, resolved from the shared card data.
// Patents read their primary-face (or top-level) mass; crew read the
// mass of whichever face the slot is installed on. This is the
// simplified base-stat reading; the full modifier-aware costing from
// rocket.js#getActiveThrusterStats lands with the BUILD op.
function slotMass(slot) {
  if (!slot || !slot.id) return 0;
  const p = PATENTS_BY_ID[slot.id];
  if (p) {
    const f = (p.faces && p.faces.primary) || p;
    return (f.mass != null ? f.mass : p.mass) | 0;
  }
  const crew = CREW_BY_ID[slot.id];
  if (crew) {
    const key = slot.face === 'secondary' ? 'secondary' : 'primary';
    const cf = (crew.faces && (crew.faces[key] || crew.faces.primary)) || {};
    return (cf.mass | 0);
  }
  return 0;
}

// Water cost per unit of delta-v for this rocket. With an active
// thruster we scale by its ISP against wet mass (ship.js#burnCost
// model: ceil(wetMass / isp) water per burn). With no thruster yet
// (fresh ship, pre-BUILD) we fall back to 1 water per burn, matching
// the single-player solo.js move cost so MOVE is exercisable now.
function perBurnCost(rocket) {
  const wetMass = rocket.stack.reduce((m, s) => m + slotMass(s), 0) + (rocket.tank | 0);
  const tid = rocket.activeThrusterId;
  if (tid) {
    const p = PATENTS_BY_ID[tid];
    const f = p && ((p.faces && p.faces.primary) || p);
    const isp = f && (f.isp != null ? f.isp : p.isp);
    if (isp) return Math.max(1, Math.ceil(wetMass / isp));
  }
  return 1;
}

// First entry into a non-Earth heliocentric zone earns a glory chit
// (mirror of js/game/glory.js#awardChitForZone). Earth is home and
// never awards. Mutates the player's glory record in place.
function maybeAwardGlory(player, site, turn) {
  if (!site || !site.solarZone || site.solarZone === 'Earth') return null;
  if (player.glory.visited.includes(site.solarZone)) return null;
  player.glory.visited.push(site.solarZone);
  const chit = { zone: site.solarZone, earnedTurn: turn };
  player.glory.chits.push(chit);
  return chit;
}

// Advance the Sunspot Cube one slot. Bumps the round on wrap, rolls a
// d6 on event slots (recorded as lastEvent; effect resolution is a
// later PR, matching the sandbox which only records the roll today),
// and pays water income from hydrated factories. Mutates state.
function advanceClock(state) {
  state.turn = (state.turn + 1) % SLOTS;
  if (state.turn === NEW_ROUND_SLOT) state.round += 1;

  if (EVENT_SLOTS.includes(state.turn)) {
    const gen = makeRng(state.seed, state.rng.cursor);
    const dieRoll = gen.d6();
    state.rng.cursor = gen.cursor;
    state.lastEvent = { turn: state.turn, round: state.round, dieRoll };
  }

  // Income: each hydrated factory pays its site's hydration in water to
  // its owner. No factories exist until INDUSTRIALIZE lands, so this is
  // a no-op today, but it keeps the round boundary correct.
  for (const [siteId, fac] of Object.entries(state.factories)) {
    const site = siteById(siteId);
    if (!site || !site.hydration) continue;
    const owner = state.players.find((p) => p.profileId === fac.ownerId);
    if (owner) owner.rocket.tank += site.hydration;
  }
}

// ----- functional ops (undoable) -----

function applyMove(state, op, player) {
  if (player.movesRemaining <= 0) return fail('no_moves_left');
  const toSiteId = String(op.toSiteId || '');
  const dest = siteById(toSiteId);
  if (!dest) return fail('unknown_site');
  const from = player.rocket.siteId;
  if (toSiteId === from) return fail('already_here');

  const path = findPath(from, toSiteId);
  if (!path) return fail('no_route');

  const cost = perBurnCost(player.rocket) * path.totalBurns;
  if (cost > player.rocket.tank) return fail('insufficient_water');

  player.rocket.tank -= cost;
  player.rocket.siteId = toSiteId;
  player.movesRemaining -= 1;
  const chit = maybeAwardGlory(player, dest, state.turn);

  let log = `${player.name} burned ${cost} water to ${dest.name}.`;
  if (chit) log += ` First into the ${chit.zone} zone (+glory chit).`;
  return { ok: true, state, log };
}

// Ops that change the game and ride the per-turn undo stack. Each is a
// pure (state, op, player) -> { ok, state, log } transform; the
// dispatcher (not the handler) maintains turnActions / turnRedo.
const FUNCTIONAL = {
  MOVE: applyMove,
};

function pickPayload(op) {
  switch (op.kind) {
    case 'MOVE': return { toSiteId: op.toSiteId };
    default: return {};
  }
}

function describeAction(a) {
  if (a.kind === 'MOVE') {
    const s = siteById(a.payload.toSiteId);
    return `move to ${s ? s.name : a.payload.toSiteId}`;
  }
  return a.kind;
}

// Replay surviving turn actions on top of the turn-base snapshot. Used
// by UNDO / REDO so recomputation always derives from a known-good
// base rather than mutating in place. The active player does not change
// within a turn (END_TURN is never a turn action), so currentPlayer is
// stable across the replay.
function rebuildFromBase(baseState, actions) {
  const s = clone(baseState);
  s.turnActions = [];
  s.turnRedo = [];
  for (const a of actions) {
    const handler = FUNCTIONAL[a.kind];
    if (!handler) return null;
    const res = handler(s, { kind: a.kind, ...a.payload }, currentPlayer(s));
    if (!res.ok) return null;
  }
  return s;
}

// ----- meta ops -----

function applyEndTurn(state, _op, player) {
  const n = state.players.length;
  const wrapped = state.activeIndex + 1 >= n;
  state.activeIndex = (state.activeIndex + 1) % n;

  // The incoming player's per-turn budgets refill at the start of
  // their turn, and the undo stacks reset (their turn opens with a
  // clean, empty history; the prior turn is now committed).
  const next = state.players[state.activeIndex];
  next.opsRemaining = OPS_PER_TURN;
  next.movesRemaining = MOVES_PER_TURN;
  next.discardsRemaining = DISCARDS_PER_TURN;
  state.turnActions = [];
  state.turnRedo = [];

  let log = `${player.name} ended their turn.`;
  // A full pass around the table advances the shared clock once.
  if (wrapped) {
    const prevRound = state.round;
    advanceClock(state);
    log += state.round > prevRound
      ? ` Round ${state.round} begins.`
      : ` Sunspot Cube advances to slot ${state.turn}.`;
    if (state.lastEvent && state.lastEvent.turn === state.turn) {
      log += ` Event roll: ${state.lastEvent.dieRoll}.`;
    }
  } else {
    log += ` ${next.name} is up.`;
  }
  return { ok: true, state, log };
}

function applyUndo(state, _op, player, ctx) {
  if (!ctx || !ctx.turnBaseState) return fail('no_base');
  if (!state.turnActions.length) return fail('nothing_to_undo');
  const last = state.turnActions[state.turnActions.length - 1];
  // Dice-roll barrier: an action that consumed randomness cannot be
  // unwound (it would leak the now-known outcome). Undo stops here.
  if (last.rolled) return fail('roll_blocks_undo');

  const survivors = state.turnActions.slice(0, -1);
  const rebuilt = rebuildFromBase(ctx.turnBaseState, survivors);
  if (!rebuilt) return fail('undo_replay_failed');
  rebuilt.turnActions = survivors;
  rebuilt.turnRedo = [last, ...state.turnRedo];
  return { ok: true, state: rebuilt, log: `${player.name} undid ${describeAction(last)}.` };
}

function applyRedo(state, _op, player, ctx) {
  if (!ctx || !ctx.turnBaseState) return fail('no_base');
  if (!state.turnRedo.length) return fail('nothing_to_redo');
  const next = state.turnRedo[0];
  const actions = [...state.turnActions, next];
  const rebuilt = rebuildFromBase(ctx.turnBaseState, actions);
  if (!rebuilt) return fail('redo_replay_failed');
  rebuilt.turnActions = actions;
  rebuilt.turnRedo = state.turnRedo.slice(1);
  return { ok: true, state: rebuilt, log: `${player.name} redid ${describeAction(next)}.` };
}

const META = {
  END_TURN: applyEndTurn,
  UNDO: applyUndo,
  REDO: applyRedo,
};

// Validate + apply one operation. ctx = { profileId, turnBaseState? }.
// turnBaseState (the snapshot at the start of the active player's turn)
// is required for UNDO / REDO and supplied by the caller from the op
// log. Returns { ok:true, state, log } or { ok:false, error }. Never
// mutates the state passed in.
export function applyOperation(prevState, op, ctx) {
  if (!prevState || prevState.status !== 'active') return fail('game_not_active');
  if (!op || typeof op.kind !== 'string') return fail('bad_op');
  const isFunctional = !!FUNCTIONAL[op.kind];
  if (!isFunctional && !META[op.kind]) return fail('unknown_op');
  if (!isPlayersTurn(prevState, ctx.profileId)) return fail('not_your_turn');

  const state = clone(prevState);
  const player = currentPlayer(state);

  if (isFunctional) {
    const cursorBefore = state.rng.cursor;
    const res = FUNCTIONAL[op.kind](state, op, player);
    if (!res.ok) return res;
    // Record the action on the undo stack (a new action invalidates
    // any pending redo), tagging whether it consumed a die roll.
    res.state.turnActions = [
      ...res.state.turnActions,
      { kind: op.kind, payload: pickPayload(op), rolled: res.state.rng.cursor !== cursorBefore },
    ];
    res.state.turnRedo = [];
    return res;
  }
  return META[op.kind](state, op, player, ctx);
}

// Ops accepted over the wire. Functional + meta.
export const SUPPORTED_OPS = [...Object.keys(FUNCTIONAL), ...Object.keys(META)];
// Ops that require the caller to supply ctx.turnBaseState.
export const NEEDS_TURN_BASE = new Set(['UNDO', 'REDO']);
