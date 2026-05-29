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
// Movement + metadata both come from the planner graph (the vendor
// mission-planner data the client also uses). siteBySlug layers the
// curated data/sites.js metadata onto a planner slug, so there is ONE
// id space across client + server. (data/graph.js is no longer used.)
import {
  siteExists as plannerSiteExists, findPath as plannerFindPath,
  leoSlug, siteBySlug as siteById, hazardKind,
} from './planner-graph.js';
import { makeRng } from './rng.js';
import {
  SLOTS, NEW_ROUND_SLOT, EVENT_SLOTS, DECK_TYPES,
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

const TANK_MAX = 32; // wet-mass cap (mirror of rocket.js#TANK_MAX)

// Academia hand limit for auction participation: a player may not
// START or JOIN/BID in an auction while holding this many cards or
// more (winning a lot would overflow the hand). User 2026-05-29.
const AUCTION_HAND_LIMIT = 4;

// The active face of a stack slot: secondary when installed
// black-side-up, else primary. Mirror of rocket.js#installedFace.
function slotFace(slot, card) {
  const c = card || PATENTS_BY_ID[slot.id];
  if (!c) return {};
  const key = slot.face === 'secondary' ? 'secondary' : 'primary';
  return (c.faces && (c.faces[key] || c.faces.primary)) || c;
}

// A slot is a thruster if its card type is thruster or its active face
// exposes a thrust value (dark-side / robonaut thrusters).
function isThrusterSlot(slot) {
  const c = PATENTS_BY_ID[slot.id];
  if (!c) return false;
  if (c.type === 'thruster') return true;
  return slotFace(slot, c).thrust != null;
}

// Clip the tank down to the wet-mass ceiling after dry mass changes.
function clipTank(rocket) {
  const dry = rocket.stack.reduce((m, s) => m + slotMass(s), 0);
  const cap = Math.max(0, TANK_MAX - dry);
  if (rocket.tank > cap) rocket.tank = cap;
}

// Prospect threshold by site class (mirror of browse.js#siteProspectThreshold
// resolved against data/sites.js, which carries only `class`). Success is
// a single d6 roll AT OR BELOW the threshold, so a higher class is easier.
const PROSPECT_CLASS_THRESHOLD = { A: 3, B: 5, C: 7, D: 9 };
function prospectThreshold(site) {
  return PROSPECT_CLASS_THRESHOLD[String(site.class || '').toUpperCase()] || 4;
}
function faceProps(slot) {
  const f = slotFace(slot);
  return (f && Array.isArray(f.properties)) ? f.properties : [];
}
// Prospector kind from a slot's active face (mirror of
// rocket.js#getProspectorKind): first of raygun / missile / buggy present.
function prospectorKind(slot) {
  const props = faceProps(slot);
  for (const key of ['raygun', 'missile', 'buggy']) {
    if (props.some((p) => p.key === key && p.value)) return key;
  }
  return null;
}
function prospectorIsru(slot) {
  const p = faceProps(slot).find((x) => x.key === 'isru');
  return p ? (Number(p.value) | 0) : 0;
}
function isProspectorSlot(slot) {
  return prospectorKind(slot) != null;
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

// ----- hazard resolution (mirror of the sandbox move queue) -----

const HAZARD_COST_PER = 4;       // aqua to bypass one generic hazard
const RAD_BYPASS_THRUST = 6;     // thrust strictly above this skips rad rolls

// Active thruster's thrust value (the number in the pink circle). Drives
// the rad bypass + factory-assist gate. 0 when no thruster is active.
function activeThrust(rocket) {
  const tid = rocket.activeThrusterId;
  if (!tid) return 0;
  const slot = rocket.stack.find((s) => s.id === tid);
  if (!slot) return 0;
  const f = slotFace(slot);
  return Number.isFinite(f && f.thrust) ? f.thrust : 0;
}
// Rad-hardness of a stack slot's active face (0 when unrated).
function slotRadHardness(slot) {
  const p = PATENTS_BY_ID[slot.id];
  if (p) {
    const f = (p.faces && p.faces.primary) || p;
    return (f.radHardness != null ? f.radHardness : p.radHardness) | 0;
  }
  const crew = CREW_BY_ID[slot.id];
  if (crew) {
    const key = slot.face === 'secondary' ? 'secondary' : 'primary';
    const cf = (crew.faces && (crew.faces[key] || crew.faces.primary)) || {};
    return (cf.radHardness | 0);
  }
  return 0;
}
function isCrewSlot(slot) {
  return slot.kind === 'crew' || !!CREW_BY_ID[slot.id];
}
// Destroy the rocket: patents fall back to the hand, crew re-spawns in
// the LEO Stack (variant rule), tank is lost, ship recalls to LEO.
// Mirror of browse.js#explodeRocket's state half.
function destroyRocket(player) {
  for (const slot of player.rocket.stack) {
    if (isCrewSlot(slot)) {
      (player.leo = player.leo || []).push({ id: slot.id, kind: 'crew', face: slot.face });
    } else {
      player.hand.push(slot.id);
    }
  }
  player.rocket.stack = [];
  player.rocket.activeThrusterId = null;
  player.rocket.activeProspectorId = null;
  player.rocket.siteId = null;
  player.rocket.tank = 0;
}

// ----- functional ops (undoable) -----

function applyMove(state, op, player) {
  if (player.movesRemaining <= 0) return fail('no_moves_left');
  // An empty rocket has no thruster and can't burn, so it can't leave
  // LEO. Enforcing this keeps the "empty rocket == at LEO" invariant
  // true: the only way off LEO is to build/board a thruster first.
  if (player.rocket.stack.length === 0) return fail('empty_rocket');
  const toSlug = String(op.toSiteId || '');
  if (!plannerSiteExists(toSlug)) return fail('unknown_site');
  const from = player.rocket.siteId;       // null = LEO
  if (toSlug === from) return fail('already_here');

  // Path comes from the planner graph (full ~1500 nodes incl. lagrange
  // / burn / hohmann waypoints). null `from` => start at LEO. Cost is
  // the sum of edge burn-labels along the shortest path.
  const path = plannerFindPath(from, toSlug);
  if (!path) return fail('no_route');
  const totalBurns = path.totalBurns;

  const cost = perBurnCost(player.rocket) * totalBurns;
  if (cost > player.rocket.tank) return fail('insufficient_water');

  // Hazards along the path. We check every node the rocket ARRIVES at
  // (path.path[0] is the origin, already paid for), classified the same
  // way the sandbox does. Generic (skull / aerobrake) hazards are
  // aqua-payable (FINAO) or rolled; rad zones always roll (unpayable).
  const arrivals = path.path.slice(1);
  const generic = [];   // skull / aero slugs (in travel order)
  const rad = [];       // rad slugs
  for (const slug of arrivals) {
    const k = hazardKind(slug);
    if (k === 'rad') rad.push(slug);
    else if (k === 'skull' || k === 'aero') generic.push(slug);
  }
  const wantPay = !!op.hazardPay;
  // FINAO: pay aqua up front to skip the generic rolls. Validated before
  // anything mutates so a short balance rejects the whole move cleanly.
  const finaoCost = wantPay ? generic.length * HAZARD_COST_PER : 0;
  if (finaoCost > 0 && finaoCost > (player.aqua | 0)) return fail('insufficient_aqua');

  // Commit the burn + the FINAO payment, then resolve dice in travel
  // order. rolls[] is recorded on the rocket for the client to play
  // back (server is authoritative for every die).
  player.rocket.tank -= cost;
  if (finaoCost > 0) player.aqua -= finaoCost;

  const gen = makeRng(state.seed, state.rng.cursor);
  const rolls = [];
  let destroyed = false;
  let haltSlug = toSlug;          // where the rocket actually ends up
  const thrust = activeThrust(player.rocket);

  // Generic hazards: a rolled 1 is a critical that destroys the ship at
  // that node (unless paid past via FINAO).
  if (!wantPay) {
    for (const slug of generic) {
      const d6 = gen.d6();
      const crit = d6 === 1;
      rolls.push({ slug, kind: hazardKind(slug), d6, crit });
      if (crit) { destroyed = true; haltSlug = slug; break; }
    }
  }
  // Rad zones (only if the ship survived the generics). Thrust strictly
  // above the bypass bar outruns the radiation with no roll; otherwise
  // each zone rolls and the worst (d6 - thrust) decommissions any stack
  // card whose rad-hardness is below it.
  let decommissioned = [];
  if (!destroyed && rad.length) {
    if (thrust > RAD_BYPASS_THRUST) {
      for (const slug of rad) rolls.push({ slug, kind: 'rad', bypassed: true, thrust });
    } else {
      let worst = 0;
      for (const slug of rad) {
        const d6 = gen.d6();
        const radVal = Math.max(0, d6 - thrust);
        if (radVal > worst) worst = radVal;
        rolls.push({ slug, kind: 'rad', d6, rad: radVal, thrust });
      }
      if (worst > 0) {
        const survivors = [];
        for (const slot of player.rocket.stack) {
          if (slotRadHardness(slot) < worst) {
            decommissioned.push(slot.id);
            if (isCrewSlot(slot)) {
              (player.leo = player.leo || []).push({ id: slot.id, kind: 'crew', face: slot.face });
            } else {
              player.hand.push(slot.id);
            }
          } else {
            survivors.push(slot);
          }
        }
        player.rocket.stack = survivors;
        if (player.rocket.activeThrusterId
            && !survivors.some((s) => s.id === player.rocket.activeThrusterId)) {
          player.rocket.activeThrusterId = null;
        }
        if (player.rocket.activeProspectorId
            && !survivors.some((s) => s.id === player.rocket.activeProspectorId)) {
          player.rocket.activeProspectorId = null;
        }
      }
    }
  }
  state.rng.cursor = gen.cursor;
  player.movesRemaining -= 1;

  if (destroyed) {
    // The ship is lost at haltSlug; cards scatter, rocket recalls to LEO.
    const where = siteById(haltSlug);
    const whereName = (where && where.name) || haltSlug;
    player.rocket.route = [];
    player.rocket.lastMove = { rolls, destroyed: true, at: haltSlug, nonce: nextMoveNonce(player) };
    destroyRocket(player);
    return {
      ok: true, state,
      log: `${player.name} burned ${cost} water and was DESTROYED at ${whereName} (rolled a 1).`,
    };
  }

  player.rocket.siteId = toSlug;
  // Pop the executed segments off the planned route (if any).
  if (Array.isArray(player.rocket.route) && player.rocket.route.length) {
    const idx = player.rocket.route.findIndex((s) => s.to === toSlug);
    if (idx >= 0) player.rocket.route = player.rocket.route.slice(idx + 1);
  }
  const destSite = siteById(toSlug);
  const chit = destSite ? maybeAwardGlory(player, destSite, state.turn) : null;
  player.rocket.lastMove = {
    rolls, destroyed: false, decommissioned,
    at: toSlug, nonce: nextMoveNonce(player),
  };

  const destName = (destSite && destSite.name) || toSlug;
  let log = `${player.name} burned ${cost} water to ${destName}.`;
  if (finaoCost > 0) log += ` Paid ${finaoCost} aqua (FINAO) past ${generic.length} hazard${generic.length === 1 ? '' : 's'}.`;
  else if (generic.length) log += ` Rolled through ${generic.length} hazard${generic.length === 1 ? '' : 's'}.`;
  if (decommissioned.length) log += ` Radiation decommissioned ${decommissioned.length} card${decommissioned.length === 1 ? '' : 's'}.`;
  if (chit) log += ` First into the ${chit.zone} zone (+glory chit).`;
  return { ok: true, state, log };
}

// Monotonic per-move id so the client can tell a fresh move's dice from
// a re-applied snapshot (it plays the hazard dice only when this bumps).
function nextMoveNonce(player) {
  const n = (player.rocket.moveNonce | 0) + 1;
  player.rocket.moveNonce = n;
  return n;
}

// Play a card from the hand onto the rocket stack (rulebook Boost,
// simplified: no LEO-stack hop and no boost aqua cost yet). Mirrors
// rocket.js#addToStack: append the slot, auto-select the first
// thruster, clip the tank to the wet-mass cap. Costs 1 op.
function applyBuildRocket(state, op, player) {
  if (player.opsRemaining <= 0) return fail('no_ops_left');
  const cardId = String(op.cardId || '');
  const idx = player.hand.indexOf(cardId);
  if (idx < 0) return fail('not_in_hand');
  const card = PATENTS_BY_ID[cardId];
  if (!card) return fail('unknown_card');
  if (card.type === 'gw-thruster') return fail('expansion_card');

  player.hand.splice(idx, 1);
  const slot = { id: cardId, kind: 'patent' };
  if (op.face === 'secondary' && card.faces && card.faces.secondary) slot.face = 'secondary';
  player.rocket.stack.push(slot);
  if (!player.rocket.activeThrusterId && isThrusterSlot(slot)) {
    player.rocket.activeThrusterId = cardId;
  }
  if (!player.rocket.activeProspectorId && isProspectorSlot(slot)) {
    player.rocket.activeProspectorId = cardId;
  }
  clipTank(player.rocket);
  player.opsRemaining -= 1;
  return { ok: true, state, log: `${player.name} built ${card.name} onto the rocket.` };
}

// Boost: move marked HAND cards up to the LEO Stack (rulebook I4,
// the sandbox commitBoost flow). Costs 1 op + aqua equal to the total
// mass of the boosted cards. The cards land in player.leo; from there
// TRANSFER boards them onto the rocket while it's at LEO. This is the
// op the sandbox BOOST button fires in online mode - without it the
// boost was a purely local mutation the server never saw.
// op = { cardIds: [id, ...] }.
function applyBoost(state, op, player) {
  if (player.opsRemaining <= 0) return fail('no_ops_left');
  const ids = Array.isArray(op.cardIds) ? op.cardIds.map(String) : [];
  if (!ids.length) return fail('nothing_to_boost');
  // Every id must currently be in the hand.
  for (const id of ids) {
    if (player.hand.indexOf(id) < 0) return fail('not_in_hand');
  }
  // Cost = total mass of the boosted cards (aqua).
  let cost = 0;
  for (const id of ids) cost += slotMass({ id });
  if (cost > player.aqua) return fail('insufficient_aqua');
  // Move them hand -> LEO.
  for (const id of ids) {
    const idx = player.hand.indexOf(id);
    if (idx >= 0) player.hand.splice(idx, 1);
    player.leo.push({ id, kind: 'patent' });
  }
  player.aqua -= cost;
  player.opsRemaining -= 1;
  const n = ids.length;
  return {
    ok: true, state,
    log: `${player.name} boosted ${n} card${n === 1 ? '' : 's'} to LEO for ${cost} aqua.`,
  };
}

// Free Market sell (rulebook I3): drop a HAND card to the bottom of
// its deck for +FREE_MARKET_AQUA aqua. Costs 1 op. This was a client-
// only action before, so in MP the sale never persisted and the aqua
// was never credited (user 2026-05-29: "the sell didnt write to
// server" -> a later REFUEL failed insufficient_aqua).
const FREE_MARKET_AQUA = 3;  // mirror of card-market.js
function applyFreeMarket(state, op, player) {
  if (player.opsRemaining <= 0) return fail('no_ops_left');
  const cardId = String(op.cardId || '');
  const idx = player.hand.indexOf(cardId);
  if (idx < 0) return fail('not_in_hand');
  const card = PATENTS_BY_ID[cardId];
  if (!card) return fail('unknown_card');
  player.hand.splice(idx, 1);
  // Card returns to the BOTTOM of its deck so it can re-circulate.
  const deck = state.decks[card.type];
  if (Array.isArray(deck)) deck.push(cardId);
  player.aqua += FREE_MARKET_AQUA;
  player.opsRemaining -= 1;
  return {
    ok: true, state,
    log: `${player.name} sold ${card.name} for +${FREE_MARKET_AQUA} aqua (Free Market).`,
  };
}

// Convert aqua -> water 1:1, only while the rocket is at LEO (the Aqua
// Bank lives at LEO). Clamped by the requested amount, the aqua on
// hand, and the remaining wet-mass room in the tank. This is where
// rocket water comes from - ships open with an EMPTY tank now, so a
// player funds a burn by converting aqua here first. Free (no op
// cost), turn-gated. op = { amount }.
function applyRefuel(state, op, player) {
  if (player.rocket.siteId != null) return fail('rocket_not_at_leo');
  const want = Math.floor(Number(op.amount));
  if (!Number.isFinite(want) || want <= 0) return fail('bad_amount');
  const dry = player.rocket.stack.reduce((m, s) => m + slotMass(s), 0);
  const room = Math.max(0, TANK_MAX - dry - (player.rocket.tank | 0));
  const amt = Math.min(want, player.aqua | 0, room);
  if (amt <= 0) {
    if (room <= 0) return fail('tank_full');
    return fail('insufficient_aqua');
  }
  player.aqua -= amt;
  player.rocket.tank = (player.rocket.tank | 0) + amt;
  return { ok: true, state, log: `${player.name} converted ${amt} aqua to water (tank ${player.rocket.tank}).` };
}

// Planned route persistence. Stored as player.rocket.route, an array
// of { from, to, burns } segments. The full route is SECRET between
// players (server gameView redacts opponents' routes - they can see
// the rocket position but not what's being planned). Cleared on
// END_TURN naturally? No - the route can span turns (Hohmann waits),
// so it persists until the player clears it or completes it. The
// route is the source of truth; the client only computes shortest
// path via the planner graph and submits the segment list.
// op = { segments: [{ from, to, burns }, ...] }.
function applySetRoute(state, op, player) {
  const segs = Array.isArray(op.segments) ? op.segments : [];
  const norm = [];
  for (const s of segs) {
    if (!s || typeof s !== 'object') return fail('bad_route');
    const from = String(s.from || '');
    const to = String(s.to || '');
    const burns = Math.max(0, Math.floor(Number(s.burns) || 0));
    if (!plannerSiteExists(from) || !plannerSiteExists(to)) return fail('unknown_site');
    norm.push({ from, to, burns });
  }
  // Validate continuity: each segment's from must be the previous to,
  // and the first must start at the rocket's current position
  // (siteId, null = LEO). Prevents a client from sending a
  // disconnected path the engine couldn't actually execute.
  const startsFrom = norm.length ? norm[0].from : null;
  const here = player.rocket.siteId == null ? leoSlug() : player.rocket.siteId;
  if (norm.length && startsFrom !== here) return fail('route_not_from_here');
  for (let i = 1; i < norm.length; i++) {
    if (norm[i].from !== norm[i - 1].to) return fail('route_discontinuous');
  }
  player.rocket.route = norm;
  return { ok: true, state, log: '' };  // empty log: routes are secret
}

function applyClearRoute(state, _op, player) {
  player.rocket.route = [];
  return { ok: true, state, log: '' };
}

// Reverse of REFUEL: cash tank water back into the aqua bank 1:1, only
// at LEO. Clamped by the water on hand. Free, turn-gated. op={amount}.
function applyCashWater(state, op, player) {
  if (player.rocket.siteId != null) return fail('rocket_not_at_leo');
  const want = Math.floor(Number(op.amount));
  if (!Number.isFinite(want) || want <= 0) return fail('bad_amount');
  const amt = Math.min(want, player.rocket.tank | 0);
  if (amt <= 0) return fail('no_water');
  player.rocket.tank -= amt;
  player.aqua = (player.aqua | 0) + amt;
  return { ok: true, state, log: `${player.name} cashed ${amt} water back to aqua (aqua ${player.aqua}).` };
}

// Display name for a stack slot (patent or crew face). Used in
// TRANSFER log lines.
function slotName(slot) {
  if (!slot || !slot.id) return '?';
  const p = PATENTS_BY_ID[slot.id];
  if (p) return p.name || slot.id;
  const crew = CREW_BY_ID[slot.id];
  if (crew) {
    const key = slot.face === 'secondary' ? 'secondary' : 'primary';
    const f = (crew.faces && (crew.faces[key] || crew.faces.primary)) || {};
    return f.name || slot.id;
  }
  return slot.id;
}

// Free LEO <-> Rocket card transfer (rulebook G1 colocation), allowed
// only while the rocket is parked at LEO (siteId == null). This is how
// the crew that PICK_CREW staged in the LEO Stack boards the rocket,
// and how cards come back off before launch. No op cost (a free
// reconfiguration like SET_ACTIVE_*), but it IS turn-gated (FUNCTIONAL)
// since it mutates your own rocket. Accepts a BATCH:
// op = { cardIds: [...], to } (or legacy { cardId, to }). All ids must
// be valid for the direction or the whole op fails (atomic).
function applyTransfer(state, op, player) {
  if (player.rocket.siteId != null) return fail('rocket_not_at_leo');
  const to = op.to === 'rocket' ? 'rocket' : (op.to === 'leo' ? 'leo' : null);
  if (!to) return fail('bad_transfer');
  const ids = Array.isArray(op.cardIds)
    ? op.cardIds.map(String)
    : (op.cardId != null ? [String(op.cardId)] : []);
  if (!ids.length) return fail('bad_transfer');

  const src = to === 'rocket' ? (player.leo || []) : player.rocket.stack;
  // Validate every id is present in the source before mutating, so a
  // bad id rejects the batch atomically.
  for (const id of ids) {
    if (!src.some((s) => s.id === id)) {
      return fail(to === 'rocket' ? 'not_in_leo' : 'not_in_rocket');
    }
  }

  const moved = [];
  for (const id of ids) {
    if (to === 'rocket') {
      const idx = player.leo.findIndex((s) => s.id === id);
      const [slot] = player.leo.splice(idx, 1);
      player.rocket.stack.push(slot);
      if (!player.rocket.activeThrusterId && isThrusterSlot(slot)) {
        player.rocket.activeThrusterId = slot.id;
      }
      if (!player.rocket.activeProspectorId && isProspectorSlot(slot)) {
        player.rocket.activeProspectorId = slot.id;
      }
      moved.push(slot);
    } else {
      const idx = player.rocket.stack.findIndex((s) => s.id === id);
      const [slot] = player.rocket.stack.splice(idx, 1);
      if (player.rocket.activeThrusterId === slot.id) player.rocket.activeThrusterId = null;
      if (player.rocket.activeProspectorId === slot.id) player.rocket.activeProspectorId = null;
      (player.leo = player.leo || []).push(slot);
      moved.push(slot);
    }
  }

  if (to === 'rocket') {
    clipTank(player.rocket);
    const label = moved.length === 1 ? slotName(moved[0]) : `${moved.length} cards`;
    return { ok: true, state, log: `${player.name} boarded ${label} onto the rocket.` };
  }
  // An empty rocket is no longer a real ship - it can't burn without a
  // thruster, so it can't be anywhere but LEO. Recall it (user
  // 2026-05-29: "the rocket is empty therefore it is ... at leo").
  recallIfEmpty(player);
  const label = moved.length === 1 ? slotName(moved[0]) : `${moved.length} cards`;
  return { ok: true, state, log: `${player.name} returned ${label} to the LEO Stack.` };
}

// Invariant: an empty rocket stack sits at LEO with no active
// thruster / prospector. Called wherever the rocket can become empty.
function recallIfEmpty(player) {
  if (player.rocket.stack.length === 0) {
    player.rocket.siteId = null;
    player.rocket.activeThrusterId = null;
    player.rocket.activeProspectorId = null;
  }
}

// Pick which stacked thruster powers burns (rocket.js#setActiveThruster).
// A free reconfiguration, not an op.
function applySetActiveThruster(state, op, player) {
  const cardId = String(op.cardId || '');
  const slot = player.rocket.stack.find((s) => s.id === cardId);
  if (!slot) return fail('not_in_stack');
  if (!isThrusterSlot(slot)) return fail('not_a_thruster');
  player.rocket.activeThrusterId = cardId;
  const card = PATENTS_BY_ID[cardId];
  return { ok: true, state, log: `${player.name} set ${card ? card.name : cardId} as the active thruster.` };
}

// Pick which stacked prospector is used by PROSPECT (mirror of
// rocket.js#setActiveProspector). Free reconfiguration, not an op.
function applySetActiveProspector(state, op, player) {
  const cardId = String(op.cardId || '');
  const slot = player.rocket.stack.find((s) => s.id === cardId);
  if (!slot) return fail('not_in_stack');
  if (!isProspectorSlot(slot)) return fail('not_a_prospector');
  player.rocket.activeProspectorId = cardId;
  const card = PATENTS_BY_ID[cardId];
  return { ok: true, state, log: `${player.name} set ${card ? card.name : cardId} as the active prospector.` };
}

// Prospect the ship's current site: one seeded d6 vs the site-class
// threshold (success = roll <= threshold), placing a claim/exhausted
// disc. Mirrors browse.js#doProspect. v1 simplifications: the ship must
// be AT the site for every prospector kind (raygun line-of-sight is
// deferred), there is no buggy reroll, and the prospector's support
// requirements are not yet gated. missile/buggy cost 1 op; raygun is free.
function applyProspect(state, op, player) {
  const toSiteId = String(op.siteId || '');
  const site = siteById(toSiteId);
  if (!site) return fail('unknown_site');
  const provId = player.rocket.activeProspectorId;
  const provSlot = provId && player.rocket.stack.find((s) => s.id === provId);
  if (!provSlot) return fail('no_prospector');
  const kind = prospectorKind(provSlot);
  if (!kind) return fail('no_prospector');
  if (player.rocket.siteId !== toSiteId) return fail('not_at_site');
  if (state.discs[toSiteId]) return fail('already_prospected');
  if (prospectorIsru(provSlot) > (site.hydration | 0)) return fail('isru_too_high');
  const costsOp = kind !== 'raygun';
  if (costsOp && player.opsRemaining <= 0) return fail('no_ops_left');

  const threshold = prospectThreshold(site);
  const gen = makeRng(state.seed, state.rng.cursor);
  const roll = gen.d6();
  state.rng.cursor = gen.cursor;
  const success = roll <= threshold;
  state.discs[toSiteId] = {
    outcome: success ? 'success' : 'fail',
    roll, threshold, kind,
    by: player.name,
    ownerId: player.profileId,
    turn: state.turn,
  };
  if (costsOp) player.opsRemaining -= 1;
  const verb = success ? 'struck a claim at' : 'came up dry at';
  return {
    ok: true, state,
    log: `${player.name} rolled ${roll} vs ${threshold} and ${verb} ${site.name}.`,
  };
}

// Ops that change the game and ride the per-turn undo stack. Each is a
// pure (state, op, player) -> { ok, state, log } transform; the
// dispatcher (not the handler) maintains turnActions / turnRedo.
const FUNCTIONAL = {
  MOVE: applyMove,
  BUILD_ROCKET: applyBuildRocket,
  BOOST: applyBoost,
  TRANSFER: applyTransfer,
  REFUEL: applyRefuel,
  CASH_WATER: applyCashWater,
  FREE_MARKET: applyFreeMarket,
  SET_ROUTE: applySetRoute,
  CLEAR_ROUTE: applyClearRoute,
  SET_ACTIVE_THRUSTER: applySetActiveThruster,
  SET_ACTIVE_PROSPECTOR: applySetActiveProspector,
  PROSPECT: applyProspect,
};

function pickPayload(op) {
  switch (op.kind) {
    case 'MOVE': return { toSiteId: op.toSiteId, hazardPay: !!op.hazardPay };
    case 'BUILD_ROCKET': return { cardId: op.cardId, face: op.face };
    case 'BOOST': return { cardIds: op.cardIds };
    case 'TRANSFER': return { cardIds: op.cardIds, cardId: op.cardId, to: op.to };
    case 'REFUEL': return { amount: op.amount };
    case 'CASH_WATER': return { amount: op.amount };
    case 'FREE_MARKET': return { cardId: op.cardId };
    case 'SET_ACTIVE_THRUSTER': return { cardId: op.cardId };
    case 'SET_ACTIVE_PROSPECTOR': return { cardId: op.cardId };
    case 'PROSPECT': return { siteId: op.siteId };
    // Route ops ride the undo stack like every other functional op, so
    // an UNDO/REDO replay (rebuildFromBase) must carry their payload or
    // the replay would re-run SET_ROUTE with no segments and silently
    // wipe a route the player still has planned.
    case 'SET_ROUTE': return { segments: op.segments };
    case 'CLEAR_ROUTE': return {};
    default: return {};
  }
}

function describeAction(a) {
  if (a.kind === 'MOVE') {
    const s = siteById(a.payload.toSiteId);
    return `move to ${s ? s.name : a.payload.toSiteId}`;
  }
  if (a.kind === 'BUILD_ROCKET') {
    const c = PATENTS_BY_ID[a.payload.cardId];
    return `build ${c ? c.name : a.payload.cardId}`;
  }
  if (a.kind === 'SET_ACTIVE_THRUSTER') {
    const c = PATENTS_BY_ID[a.payload.cardId];
    return `set active thruster ${c ? c.name : a.payload.cardId}`;
  }
  if (a.kind === 'SET_ACTIVE_PROSPECTOR') {
    const c = PATENTS_BY_ID[a.payload.cardId];
    return `set active prospector ${c ? c.name : a.payload.cardId}`;
  }
  if (a.kind === 'PROSPECT') {
    const s = siteById(a.payload.siteId);
    return `prospect ${s ? s.name : a.payload.siteId}`;
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

// ----- auction ops (competitive, built fresh server-side) -----
//
// The auction is the one mechanic NOT ported from the sandbox (whose
// auction is a solo "win the deck top immediately" draw). Flow:
//   AUCTION_START  auctioneer spends 1 op and reserves a deck-top lot.
//   AUCTION_BID / AUCTION_PASS  the OTHER players bid ascending. A new
//     high reopens the floor (passes clear) so everyone gets a say.
//     When every other player has passed, control goes to the
//     auctioneer.
//   AUCTION_SELL  auctioneer accepts the high bid: the winner pays the
//     auctioneer that many aqua and takes the lot.
//   AUCTION_JOIN  auctioneer bids >= the current high (matching is
//     allowed). This reopens a fresh round so every other player can
//     bid again, looping until they all pass. If the auctioneer is the
//     standing high bid when that happens, they keep the lot and pay
//     the bank (the aqua leaves play; free if nobody ever bid).
// The won lot plus one card off the top of each of its support decks
// (supportBonusDecks, ported from js/game/decks.js) land in the
// winner's hand.

// supportBonusDecks port: map a card's `requires` kinds to deck types
// by supplier prefix (OR-alternatives within a prefix collapse to one
// draw); abstract kinds that aren't grounded in a deck contribute none.
const KIND_PREFIX_TO_DECK = {
  reactor: 'reactor', gen: 'generator', radiator: 'radiator',
  refinery: 'refinery', robonaut: 'robonaut', thruster: 'thruster',
};
function requireKindToDeckType(kind) {
  if (!kind) return null;
  return KIND_PREFIX_TO_DECK[String(kind).split('-')[0]] || null;
}
function supportBonusDecks(card) {
  if (!card) return [];
  const f = (card.faces && card.faces.primary) || card;
  const requires = Array.isArray(f.requires) ? f.requires : (card.requires || []);
  const out = new Set();
  for (const r of requires) {
    const t = requireKindToDeckType(r && r.kind);
    if (t) out.add(t);
  }
  return [...out];
}

function playerByProfile(state, profileId) {
  return state.players.find((p) => p.profileId === profileId) || null;
}

// Push the reserved lot + one card off the top of each support deck
// into the winner's hand. Returns { card, cardId, bonusIds } for logs.
function awardLot(state, winner) {
  const { cardId } = state.auction;
  winner.hand.push(cardId);
  const card = PATENTS_BY_ID[cardId];
  const bonusIds = [];
  for (const t of supportBonusDecks(card)) {
    const deck = state.decks[t];
    if (deck && deck.length) bonusIds.push(deck.shift());
  }
  for (const id of bonusIds) winner.hand.push(id);
  return { card, cardId, bonusIds };
}

function bonusNote(bonusIds) {
  if (!bonusIds.length) return '';
  const names = bonusIds.map((id) => (PATENTS_BY_ID[id] && PATENTS_BY_ID[id].name) || id);
  return ` Bonus: ${names.join(', ')}.`;
}

// True once every non-auctioneer player except the current high bidder
// has passed: nobody left who could raise, so the round is settled.
function biddersRoundComplete(state) {
  const a = state.auction;
  const toAct = state.players.filter(
    (p) => p.profileId !== a.auctioneerId && p.profileId !== a.highBidderId
  );
  return toAct.every((p) => a.passed.includes(p.profileId));
}

// Auctioneer wins the lot: pay the high bid to the bank (aqua leaves
// play; 0 when nobody bid) and award the lot. Closes the auction.
function resolveKeep(state, log) {
  const a = state.auction;
  const auctioneer = playerByProfile(state, a.auctioneerId);
  const paid = a.highBid;
  auctioneer.aqua -= paid;
  const awarded = awardLot(state, auctioneer);
  state.auction = null;
  const name = awarded.card ? awarded.card.name : awarded.cardId;
  const tail = paid > 0 ? ` and paid ${paid} aqua to the bank` : ' unopposed';
  return {
    ok: true, state,
    log: `${log} ${auctioneer.name} kept ${name}${tail}.${bonusNote(awarded.bonusIds)}`,
  };
}

// After a bid or pass, settle the round: auctioneer keeps (they hold
// the high bid), hand them the sell/join decision, or leave bidding open.
function settleBidders(state, log) {
  const a = state.auction;
  if (!biddersRoundComplete(state)) return { ok: true, state, log };
  if (a.highBidderId === a.auctioneerId) return resolveKeep(state, log);
  a.awaiting = 'auctioneer';
  const tail = a.highBidderId
    ? ` High bid ${a.highBid} aqua; the auctioneer decides.`
    : ' No bids; the auctioneer decides.';
  return { ok: true, state, log: log + tail };
}

function applyAuctionStart(state, op, ctx) {
  if (state.auction) return fail('auction_in_progress');
  const player = currentPlayer(state);
  if (!player || player.profileId !== ctx.profileId) return fail('not_your_turn');
  if (state.players.length < 2) return fail('need_opponent');
  if (player.opsRemaining <= 0) return fail('no_ops_left');
  if ((player.hand || []).length >= AUCTION_HAND_LIMIT) return fail('hand_limit');
  const deckType = String(op.deckType || '');
  if (!DECK_TYPES.includes(deckType)) return fail('bad_deck');
  const deck = state.decks[deckType];
  if (!deck || !deck.length) return fail('deck_empty');

  const cardId = deck.shift();
  player.opsRemaining -= 1;
  state.auction = {
    deckType, cardId,
    auctioneerId: player.profileId,
    highBid: 0, highBidderId: null,
    passed: [], awaiting: 'bidders',
  };
  // Opening commits prior turn actions: undo must not span an auction
  // (it moves other players' aqua / decks / hands, none of which the
  // undo replay would restore).
  state.turnActions = [];
  state.turnRedo = [];
  const card = PATENTS_BY_ID[cardId];
  return { ok: true, state, log: `${player.name} put ${card ? card.name : cardId} up for auction.` };
}

function applyAuctionBid(state, op, ctx) {
  const a = state.auction;
  if (!a) return fail('no_auction');
  if (a.awaiting !== 'bidders') return fail('not_bidding_phase');
  const bidder = playerByProfile(state, ctx.profileId);
  if (!bidder) return fail('not_a_player');
  if (bidder.profileId === a.auctioneerId) return fail('auctioneer_cannot_bid');
  if ((bidder.hand || []).length >= AUCTION_HAND_LIMIT) return fail('hand_limit');
  const amount = Number(op.amount);
  if (!Number.isInteger(amount) || amount <= 0) return fail('bad_amount');
  if (amount <= a.highBid) return fail('bid_too_low');
  if (amount > bidder.aqua) return fail('insufficient_aqua');

  a.highBid = amount;
  a.highBidderId = bidder.profileId;
  a.passed = []; // a new high reopens the floor to the other bidders
  return settleBidders(state, `${bidder.name} bid ${amount} aqua.`);
}

function applyAuctionPass(state, op, ctx) {
  const a = state.auction;
  if (!a) return fail('no_auction');
  if (a.awaiting !== 'bidders') return fail('not_bidding_phase');
  const passer = playerByProfile(state, ctx.profileId);
  if (!passer) return fail('not_a_player');
  if (passer.profileId === a.auctioneerId) return fail('auctioneer_cannot_pass');
  if (passer.profileId === a.highBidderId) return fail('cannot_pass_leading');
  if (!a.passed.includes(passer.profileId)) a.passed.push(passer.profileId);
  return settleBidders(state, `${passer.name} passed.`);
}

function applyAuctionJoin(state, op, ctx) {
  const a = state.auction;
  if (!a) return fail('no_auction');
  if (a.awaiting !== 'auctioneer') return fail('not_auctioneer_phase');
  if (ctx.profileId !== a.auctioneerId) return fail('not_auctioneer');
  const auctioneer = playerByProfile(state, a.auctioneerId);
  const amount = Number(op.amount);
  if (!Number.isInteger(amount) || amount < 0) return fail('bad_amount');
  // Joining the bidding (a raise) is participation, so the hand limit
  // applies. The unopposed keep (amount 0, no bids) is exempt - it
  // just finalises the lot the auctioneer already legally started.
  if (amount > 0 && (auctioneer.hand || []).length >= AUCTION_HAND_LIMIT) {
    return fail('hand_limit');
  }
  if (amount < a.highBid) return fail('must_match_or_raise');
  if (amount > auctioneer.aqua) return fail('insufficient_aqua');

  // No-bids keep: when no one has bid yet AND the auctioneer joins
  // at 0, that's "Keep (no bids)" - the lot is theirs unopposed.
  // Close the auction now instead of reopening a pass-round that
  // can only resolve the same way. User report 2026-05: "if the
  // auctioneer clicks keep (no bids) the auction should end.
  // currently it's treating it as if there is one more round".
  if (amount === 0 && a.highBid === 0) {
    a.highBidderId = a.auctioneerId;
    return resolveKeep(state, `${auctioneer.name} kept the lot unopposed.`);
  }

  a.highBid = amount;
  a.highBidderId = a.auctioneerId;
  a.passed = [];
  a.awaiting = 'bidders';
  return {
    ok: true, state,
    log: `${auctioneer.name} joined the bidding at ${amount} aqua; another round opens.`,
  };
}

function applyAuctionSell(state, op, ctx) {
  const a = state.auction;
  if (!a) return fail('no_auction');
  if (a.awaiting !== 'auctioneer') return fail('not_auctioneer_phase');
  if (ctx.profileId !== a.auctioneerId) return fail('not_auctioneer');
  if (!a.highBidderId || a.highBidderId === a.auctioneerId) return fail('no_bid_to_accept');
  const auctioneer = playerByProfile(state, a.auctioneerId);
  const winner = playerByProfile(state, a.highBidderId);
  if (!winner) return fail('winner_gone');
  const price = a.highBid;
  if (winner.aqua < price) return fail('winner_cannot_pay');

  winner.aqua -= price;
  auctioneer.aqua += price;
  const awarded = awardLot(state, winner);
  state.auction = null;
  const name = awarded.card ? awarded.card.name : awarded.cardId;
  return {
    ok: true, state,
    log: `${winner.name} won ${name} for ${price} aqua, paid to ${auctioneer.name}.${bonusNote(awarded.bonusIds)}`,
  };
}

const AUCTION = {
  AUCTION_START: applyAuctionStart,
  AUCTION_BID: applyAuctionBid,
  AUCTION_PASS: applyAuctionPass,
  AUCTION_JOIN: applyAuctionJoin,
  AUCTION_SELL: applyAuctionSell,
};

// ----- starting-crew pick (pre-game; any player, any time) -----
//
// Each player picks one of the 12 faction faces at session open. The
// pick is final and free (no op cost) - it's a session-setup step,
// not a turn action. PICK_CREW therefore bypasses the turn guard and
// the auction-in-progress freeze in the same way auction bids do
// (the caller is the player doing the picking, not the active turn
// holder). On commit the chosen crew card is also pushed into the
// player's LEO stack as their starting crew, mirroring the sandbox
// wizard which spawns the crew into the LEO Stack.
function applyPickCrew(state, op, ctx) {
  // Crew picks are open during the draft phase only. Once everyone
  // has committed, draftPhase flips to 'play' and PICK_CREW is locked.
  // Backwards compat: pre-migration games have state.draftPhase
  // undefined; derive it from "every player has a faction" so a
  // legacy game with both picks already in still rejects re-picks.
  const phase = state.draftPhase
    ?? (state.players.every((p) => !!p.faction) ? 'play' : 'crew');
  if (phase !== 'crew') return fail('crew_draft_closed');
  const player = playerByProfile(state, ctx.profileId);
  if (!player) return fail('not_a_player');
  const cardId = String(op.cardId || '');
  const face = op.face === 'secondary' ? 'secondary' : 'primary';
  const card = CREW_BY_ID[cardId];
  if (!card) return fail('unknown_crew');
  const faceData = card.faces && card.faces[face];
  if (!faceData) return fail('unknown_crew_face');
  // Each crew card carries one of the six PLAYER_COLORS (the
  // faction band colour). The player's assigned seat colour pins
  // them to that card - both faces of that card are valid picks,
  // every other card is forbidden. Reject mismatches so a client
  // bug can't bypass the colour gate.
  if (card.color && player.color && card.color !== player.color) {
    return fail('wrong_crew_colour');
  }
  const switching = !!player.faction;
  player.faction = { cardId, face };
  // Replace any previous crew slot in LEO with the new pick so a
  // re-pick during the draft doesn't leave a stale crew sitting in
  // the stack. First-time pickers just get one push.
  player.leo = (player.leo || []).filter((s) => s.kind !== 'crew');
  player.leo.push({ id: cardId, kind: 'crew', face });
  // Transition to 'play' the moment every player has a faction.
  // Server-side, not derived client-side, so spectators + future
  // joiners agree on the phase.
  if (state.players.every((p) => !!p.faction)) {
    state.draftPhase = 'play';
  }
  const verb = switching ? 'switched to' : 'picked';
  return {
    ok: true,
    state,
    log: `${player.name} ${verb} ${faceData.name || cardId}.`,
  };
}

const CREW = {
  PICK_CREW: applyPickCrew,
};

// Validate + apply one operation. ctx = { profileId, turnBaseState? }.
// turnBaseState (the snapshot at the start of the active player's turn)
// is required for UNDO / REDO and supplied by the caller from the op
// log. Returns { ok:true, state, log } or { ok:false, error }. Never
// mutates the state passed in.
export function applyOperation(prevState, op, ctx) {
  if (!prevState || prevState.status !== 'active') return fail('game_not_active');
  if (!op || typeof op.kind !== 'string') return fail('bad_op');

  // Crew-pick is its own class: it's the pre-game session-setup step
  // any player can run during the draft phase. PICK_CREW validates
  // the caller against their own player record + the draftPhase
  // gate. Runs BEFORE the AUCTION / functional gates so it can fire
  // even though no other ops are accepted during the draft.
  if (CREW[op.kind]) return CREW[op.kind](clone(prevState), op, ctx);

  // Everything else - auctions, functional ops, META - has to wait
  // for the crew draft to finish. Without this, the host could fire
  // END_TURN / AUCTION_START before some seat has picked their
  // faction. Backwards compat: games created BEFORE state.draftPhase
  // was introduced have it undefined; treat that as the derived
  // phase (play if everyone already has a faction, crew otherwise)
  // so existing tables don't lock up.
  const draftDone = prevState.draftPhase === 'play'
    || (prevState.draftPhase == null
        && prevState.players.every((p) => !!p.faction));
  if (!draftDone) return fail('awaiting_crew_picks');

  // Auction ops bypass the turn guard below - bids/passes are sent
  // by non-active players, and each handler validates its own caller
  // against the auction roles.
  if (AUCTION[op.kind]) return AUCTION[op.kind](clone(prevState), op, ctx);

  const isFunctional = !!FUNCTIONAL[op.kind];
  if (!isFunctional && !META[op.kind]) return fail('unknown_op');
  // An open auction freezes every other op (MOVE / END_TURN / undo)
  // until the lot resolves.
  if (prevState.auction) return fail('auction_in_progress');
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

// Ops accepted over the wire. Functional + meta + auction.
export const SUPPORTED_OPS = [
  ...Object.keys(FUNCTIONAL), ...Object.keys(META), ...Object.keys(AUCTION),
  ...Object.keys(CREW),
];
// Ops that require the caller to supply ctx.turnBaseState.
export const NEEDS_TURN_BASE = new Set(['UNDO', 'REDO']);
