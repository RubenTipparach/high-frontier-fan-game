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

import { PATENTS_BY_ID, radiatorRadHardness } from '../../data/patents.js';
import { resolveSupportChain } from '../../data/support-chain.js';
import { CREW_BY_ID } from '../../data/crew.js';
// Structured patent card POWERS behind each face's free-text Ability (the
// sheet carries the text; this maps it to engine flags). Shared with the
// client, same as fuel-graph / support-chain.
import { facePower } from '../../data/card-abilities.js';
// Shared fuel-strip model (same module the client uses): a burn spends fuel
// STEPS (black connections), and the water it costs is the non-linear mass
// drop, leaving a possibly-fractional remainder.
import { blackStepsBetween, walkBlackDown } from '../../data/fuel-graph.js';
// Net-thrust band (weight class) + solar-zone modifiers, the same pure
// tables the client folds into rocket.js#getActiveThrusterStats. The
// engine reads them so the liftoff/landing gate uses the FINAL net thrust,
// not the printed base value.
import { weightClassForMass } from '../../data/net-thrust-track.js';
import { SOLAR_ZONE_INFO } from '../../data/sites.js';
import { ZONE_CHIT_VPS } from '../../data/zone-chits.js';
// Movement + metadata both come from the planner graph (the vendor
// mission-planner data the client also uses). siteBySlug layers the
// curated data/sites.js metadata onto a planner slug, so there is ONE
// id space across client + server. (data/graph.js is no longer used.)
import {
  siteExists as plannerSiteExists, findPath as plannerFindPath,
  leoSlug, siteBySlug as siteById, hazardKind,
  nodeSizeNumber, lineOfSightSites, siteBodyOf, buggyRoamSites,
} from './planner-graph.js';
import { isBuggyRoamBody } from '../../data/buggy-roam.js';
import { makeRng } from './rng.js';
import {
  SLOTS, NEW_ROUND_SLOT, EVENT_SLOTS, DECK_TYPES,
  OPS_PER_TURN, MOVES_PER_TURN, DISCARDS_PER_TURN,
  currentPlayer, isPlayersTurn,
  seasonForSlot, eventKindForRoll,
} from './state.js';

function clone(state) {
  return (typeof structuredClone === 'function')
    ? structuredClone(state)
    : JSON.parse(JSON.stringify(state));
}

// Trim float drift from fractional tank water (a burn can leave a sub-1
// remainder, so the tank is no longer an integer).
const round6 = (n) => Math.round((Number(n) || 0) * 1e6) / 1e6;

function fail(error, detail) { return detail ? { ok: false, error, detail } : { ok: false, error }; }

// Base mass of one stack slot, resolved from the shared card data.
// Patents read their primary-face (or top-level) mass; crew read the
// mass of whichever face the slot is installed on. This is the
// simplified base-stat reading; the full modifier-aware costing from
// rocket.js#getActiveThrusterStats lands with the BUILD op.
function slotMass(slot) {
  if (!slot || !slot.id) return 0;
  const p = PATENTS_BY_ID[slot.id];
  if (p) {
    const f = slotFace(slot, p);
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

// The active thruster face of a slot, normalized so patents and crew read
// the same shape (.thrust / .fuel / .afterburn / .requires / .properties).
// Crew nest their rocket under face.thruster.{thrust, fuelPerBurn, afterburn}
// (mirror of rocket.js#synthCrew); a crew face with no rocket (Shimizu)
// returns {}. Patents pass straight through slotFace.
function thrusterFaceOf(slot) {
  if (!slot || !slot.id) return {};
  const p = PATENTS_BY_ID[slot.id];
  if (p) return slotFace(slot, p);
  const crew = CREW_BY_ID[slot.id];
  if (crew) {
    const key = slot.face === 'secondary' ? 'secondary' : 'primary';
    const cf = (crew.faces && (crew.faces[key] || crew.faces.primary)) || {};
    if (!cf.thruster) return {};
    return {
      thrust: cf.thruster.thrust,
      fuel: cf.thruster.fuelPerBurn,
      afterburn: cf.thruster.afterburn || 0,
      dirt: !!cf.thruster.dirt,   // a crew dirt thruster (grey fuel)
      requires: [],   // crew thrusters are self-contained (no support chain)
      properties: cf.prospector ? [{ key: cf.prospector, value: true }] : [],
    };
  }
  return {};
}

// A thruster face burns DIRT (grey) fuel rather than WATER (blue) when its
// fuelType is Dirt (patents / robonauts, from the card sheet) or its crew
// rocket is flagged dirt. Everything else burns water.
function faceBurnsDirt(face) {
  return !!(face && (face.fuelType === 'Dirt' || face.dirt === true));
}

// Is this slot the NASRDA moon-cable crew thruster (the only card that can take
// on dirt at LEO)? Keyed off the CARD's installed crew face printing the
// Mooncable bonus, NOT off the player holding the Mooncable PRIVILEGE: the
// privilege is suspendable / negotiable, but the card's own moon-cable ability
// rides with the card wherever it sits in the stack.
function isMooncableThruster(slot) {
  const crew = slot && CREW_BY_ID[slot.id];
  if (!crew || !crew.faces) return false;
  const key = slot.face === 'secondary' ? 'secondary' : 'primary';
  const face = crew.faces[key] || crew.faces.primary;
  return !!face && privKey(face.bonus) === 'MOONCABLE';
}

// The structured POWER of a slot's INSTALLED face (null for crew / no power /
// a face with no Ability). Keyed off the installed face's name so a flipped
// card grants the right side's power.
function powerOfSlot(slot) {
  const c = slot && PATENTS_BY_ID[slot.id];
  if (!c) return null;
  return facePower(slotFace(slot, c).name);
}

// Does this rocket carry the moon cable (a NASRDA crew card on its Mooncable
// face)? The cable is what lets dirt be piped up at LEO / Home Bernal; it need
// NOT be the active thruster - it just has to be aboard, and it refuels
// WHICHEVER dirt thrust triangle is activated (a separate non-crew dirt card
// included). Mirrors the client's stackHasMoonCable.
function stackHasMoonCable(rocket) {
  return !!(rocket && (rocket.stack || []).some(isMooncableThruster));
}

// Does the stack carry an OPERATIONAL safe-aerobrake card (a parachute
// generator: Magnetoshell Plasma Parachute / Granular Rainbow Corral)? Such a
// card lets the whole stack ride out aerobrake hazards with no roll.
function stackSafeAerobrake(rocket) {
  return !!(rocket && (rocket.stack || []).some((s) => {
    const pw = powerOfSlot(s);
    return pw && pw.safeAerobrake;
  }));
}

// The fuel grade the active thruster needs: 'dirt' for a dirt thruster, else
// 'water'. 'water' when there is no active thruster.
function activeFuelGrade(rocket) {
  const tid = rocket.activeThrusterId;
  if (!tid) return 'water';
  const slot = rocket.stack.find((s) => s.id === tid);
  if (!slot) return 'water';
  return faceBurnsDirt(thrusterFaceOf(slot)) ? 'dirt' : 'water';
}

// The grade currently in the tank ('water' default; meaningless at tank 0).
function tankGradeOf(rocket) {
  return rocket.tankGrade === 'dirt' ? 'dirt' : 'water';
}

// Heliocentric-zone distance from Earth (Delivery cost driver). Earth = 0,
// Mars/Venus = 1, Ceres = 2, ... Neptune = 6. Unknown zone = 0.
const ZONE_ORDER = ['Mercury', 'Venus', 'Earth', 'Mars', 'Ceres', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];
function zonesFromEarth(zone) {
  const i = ZONE_ORDER.indexOf(zone);
  if (i < 0) return 0;
  return Math.abs(i - ZONE_ORDER.indexOf('Earth'));
}

// A slot is a thruster if its card type is thruster, its active face exposes
// a thrust value (dark-side / robonaut thrusters), or it is a crew member
// whose chosen face carries a rocket (a crew thruster).
function isThrusterSlot(slot) {
  const c = PATENTS_BY_ID[slot.id];
  if (c) {
    if (c.type === 'thruster') return true;
    return slotFace(slot, c).thrust != null;
  }
  return thrusterFaceOf(slot).thrust != null;
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
  // Mirror the client (browse.js#siteProspectThreshold): the planner siteSize
  // encodes difficulty as "<n><spectral>" (e.g. "1M", "9H"); the leading digit
  // IS the threshold. Only fall back to the class letter when there's no
  // siteSize, so the server roll matches the difficulty the popup shows.
  const ss = site && site.siteSize;
  if (typeof ss === 'string') {
    const m = ss.match(/^(\d+)/);
    if (m) return Math.max(1, Math.min(11, parseInt(m[1], 10)));
  }
  return PROSPECT_CLASS_THRESHOLD[String((site && site.class) || '').toUpperCase()] || 4;
}
function faceProps(slot) {
  const f = slotFace(slot);
  return (f && Array.isArray(f.properties)) ? f.properties : [];
}
// Normalized prospector face for a slot, for BOTH patents and crew. Patents
// carry raygun / missile / buggy + isru in the installed face's `properties`;
// crew nest them on the face directly (face.prospector + face.isru), exactly
// like thrusterFaceOf / the client's synthCrew. slotFace() resolves PATENTS
// only, so without this crew branch a crew prospector reads as "not a
// prospector" - the server rejected SET_ACTIVE_PROSPECTOR / PROSPECT for a
// crew buggy/raygun that the client correctly offered (the not_a_prospector
// bug on crew_nasa_isro's ISRO Glavcosmonauts buggy face).
function prospectorFace(slot) {
  if (!slot || !slot.id) return { properties: [], isru: 0 };
  const crew = CREW_BY_ID[slot.id];
  if (crew) {
    const key = slot.face === 'secondary' ? 'secondary' : 'primary';
    const cf = (crew.faces && (crew.faces[key] || crew.faces.primary)) || {};
    return {
      properties: cf.prospector ? [{ key: cf.prospector, value: true }] : [],
      isru: Number(cf.isru) | 0,
    };
  }
  const props = faceProps(slot);
  const isruP = props.find((x) => x.key === 'isru');
  return { properties: props, isru: isruP ? (Number(isruP.value) | 0) : 0 };
}
// Prospector kind from a slot's active face (mirror of
// rocket.js#getProspectorKind): first of raygun / missile / buggy present.
function prospectorKind(slot) {
  const props = prospectorFace(slot).properties;
  for (const key of ['raygun', 'missile', 'buggy']) {
    if (props.some((p) => p.key === key && p.value)) return key;
  }
  return null;
}
function prospectorIsru(slot) {
  return prospectorFace(slot).isru;
}
// Does this slot's installed face carry an ISRU rating at all? Rating 0
// COUNTS (it's the best rig) - presence of the rating is what matters,
// so this can't read prospectorIsru (0 also means "no rig" there).
function slotHasIsruRig(slot) {
  if (!slot || !slot.id) return false;
  const crew = CREW_BY_ID[slot.id];
  if (crew) {
    const key = slot.face === 'secondary' ? 'secondary' : 'primary';
    const cf = (crew.faces && (crew.faces[key] || crew.faces.primary)) || {};
    return cf.isru != null && Number.isFinite(Number(cf.isru));
  }
  return faceProps(slot).some((x) => x && x.key === 'isru');
}
function isProspectorSlot(slot) {
  return prospectorKind(slot) != null;
}

// True when this zone's glory chit has already been retrieved by ANY player
// at this table. Only one player may ever claim a given zone's chit, so once
// anyone has picked it up (it lands in their glory.visited list) the chit is
// gone for everyone else. Reading it off live player state means undo / replay
// (rebuildFromBase) reconstructs it for free, with no extra state field.
function zoneChitTaken(state, zone) {
  if (!zone) return false;
  return (state.players || []).some(
    (p) => p.glory && Array.isArray(p.glory.visited) && p.glory.visited.includes(zone)
  );
}

// First entry into a non-Earth heliocentric zone earns a glory chit
// (mirror of js/game/glory.js#awardChitForZone). Earth is home and
// never awards. Mutates the player's glory record in place.
function maybeAwardGlory(state, player, site, turn) {
  if (!site || !site.solarZone || site.solarZone === 'Earth') return null;
  if (player.glory.visited.includes(site.solarZone)) return null;
  // Game-wide single-claim rule: if any player already retrieved this zone's
  // chit there is nothing left here to pick up. Without this gate two rockets
  // that both reach a new zone each award themselves the same chit (the
  // reported bug); the per-player visited check above only stops a player from
  // re-claiming their own.
  if (zoneChitTaken(state, site.solarZone)) return null;
  // A glory chit is loaded by a Human: only claim it (and only mark the
  // zone visited) when a crew is aboard. Mirror of the client's
  // willAwardChit `crewAboard` gate - a crewless rocket leaves the chit on
  // the site for a later, crewed visit to load.
  if (!player.rocket.stack.some(isCrewSlot)) return null;
  player.glory.visited.push(site.solarZone);
  const chit = { zone: site.solarZone, earnedTurn: turn };
  player.glory.chits.push(chit);
  return chit;
}

// Free action: load the still-unclaimed glory chit for the zone the
// rocket is parked in (a crew must be aboard). The explicit counterpart to
// declining the on-arrival pick-up; mirrors the client's claimGloryHere.
// maybeAwardGlory enforces the zone / Earth / already-claimed / crew gates,
// so a null result means there is nothing here to load.
function applyLoadGlory(state, _op, player) {
  const site = player.rocket.siteId ? siteById(player.rocket.siteId) : null;
  const chit = site ? maybeAwardGlory(state, player, site, state.turn) : null;
  if (!chit) return fail('no_chit_to_load');
  return { ok: true, state, log: `${player.name} loaded the ${chit.zone} glory chit.` };
}

// Advance the Sunspot Cube one slot. Bumps the round on wrap and rolls a
// d6 on event slots (recorded as lastEvent; effect resolution is a later PR,
// matching the sandbox which only records the roll today). Mutates state.
function advanceClock(state) {
  state.turn = (state.turn + 1) % SLOTS;
  if (state.turn === NEW_ROUND_SLOT) state.round += 1;

  // Anarchy lapses the moment the cube exits season blue.
  if (state.anarchy && seasonForSlot(state.turn) !== 'blue') {
    state.anarchy = false;
    state.anarchyLifted = true; // one-shot note for the END_TURN log
  }

  if (EVENT_SLOTS.includes(state.turn)) {
    const gen = makeRng(state.seed, state.rng.cursor);
    const dieRoll = gen.d6();
    state.rng.cursor = gen.cursor;
    const season = seasonForSlot(state.turn);
    const kind = eventKindForRoll(dieRoll, season);
    state.lastEvent = { turn: state.turn, round: state.round, dieRoll, kind, notes: [] };
    resolveSunspotEvent(state, kind);
  }

  // NOTE: there is deliberately NO passive "factory income" here. An earlier
  // draft paid every hydrated factory's hydration in water straight into the
  // owner's tank each lap; that had no basis in the HF4 rules (water comes from
  // the Site Refuel / Factory Refuel OPERATIONS, which cost an op) and turned
  // factories into a free-water-then-cash money fountain. Removed per user
  // decision (it was the "ghost water" source). Do not reintroduce it.
  return {};
}

// The clock tick's contribution to the END_TURN log: the event roll, what
// it did (lastEvent.notes), whether play is paused on player choices, and
// the one-shot "anarchy lifted" notice when the cube exits season blue.
function clockEventLog(state) {
  let log = '';
  if (state.anarchyLifted) {
    delete state.anarchyLifted;
    log += ' The cube left season blue; faction privileges resume.';
  }
  const ev = state.lastEvent;
  if (ev && ev.turn === state.turn && Array.isArray(ev.notes)) {
    // Headline only - the blow-by-blow goes out on the news feed
    // (state.news), which the toolbar broadcast button surfaces.
    log += ` Event roll: ${ev.dieRoll} - ${EVENT_HEADLINES[ev.kind] || ev.kind}.`;
    if (state.pendingEvent) log += ' Affected players choose on their turns.';
  }
  return log;
}

// ----- Sunspot event resolution -----
//
// Each event's mechanical effect, applied the moment the cube lands on an
// event slot (inside END_TURN's advanceClock). Outcomes append to
// state.lastEvent.notes (gameplay text the END_TURN log + the turn-clock
// modal both surface). Two events pause for player input via
// state.pendingEvent (Budget Cuts' discard pick; Pad Explosion when the
// highest-mass tie needs a choice); everything else resolves instantly.

function cardNameOf(id) {
  const p = PATENTS_BY_ID[id];
  if (p) return p.name || id;
  const c = CREW_BY_ID[id];
  if (c) return (c.faces && c.faces.primary && c.faces.primary.name) || id;
  return id;
}

// True decommission: the card leaves play to the BOTTOM of its patent
// deck (unlike the voluntary DECOMMISSION free action, which returns the
// card to the hand for dirt-fuel bookkeeping). Crew never route here.
function destroyToDeckBottom(state, cardId) {
  const p = PATENTS_BY_ID[cardId];
  const deck = p && state.decks[p.type];
  if (deck) deck.push(cardId);
}

function stackHasCrew(slots) {
  return (slots || []).some((s) => isCrewSlot(s));
}

// Humans co-located with a site: a colony dome, any player's rocket
// parked there with crew aboard, or any outpost there holding crew.
function humansAtSite(state, siteId) {
  if (!siteId) return true; // LEO: mission control is right there
  if (state.colonies[siteId]) return true;
  for (const p of state.players) {
    if (p.rocket.siteId === siteId && stackHasCrew(p.rocket.stack)) return true;
    for (const o of Object.values(p.outposts || {})) {
      if (o && o.siteId === siteId && stackHasCrew(o.cards)) return true;
    }
  }
  return false;
}

// ---- Felony helpers (Felonious privilege; active during Anarchy / War) ----
// A felony requires the actor to have a Human present; the target is defended
// by a colocated OPPOSING Human (crew or colony dome) or a Factory.
function actorCrewAtSite(state, siteId, actorId) {
  const p = state.players.find((x) => x.profileId === actorId);
  if (!p) return false;
  if (p.rocket.siteId === siteId && stackHasCrew(p.rocket.stack)) return true;
  for (const o of Object.values(p.outposts || {})) {
    if (o && o.siteId === siteId && stackHasCrew(o.cards)) return true;
  }
  return false;
}
function opposingHumanAtSite(state, siteId, actorId) {
  const col = state.colonies[siteId];
  if (col && col.ownerId !== actorId) return true;
  for (const p of state.players) {
    if (p.profileId === actorId) continue;
    if (p.rocket.siteId === siteId && stackHasCrew(p.rocket.stack)) return true;
    for (const o of Object.values(p.outposts || {})) {
      if (o && o.siteId === siteId && stackHasCrew(o.cards)) return true;
    }
  }
  return false;
}

// ---- Faction privileges (the crew bonus) ----
// The player's chosen faction face carries one privilege. privilegeOf returns
// its KEY (e.g. 'TAXES'), or null - and null DURING ANARCHY, when every
// faction privilege is suspended (replaced by the universal Felonious ability,
// K2e). Keys are the printed bonus title upper-snake-cased.
function privKey(bonus) {
  return String(bonus || '').trim().toUpperCase().replace(/\s+/g, '_');
}
function privilegeOf(state, player) {
  if (!player || !player.faction) return null;
  if (state && state.anarchy) return null;
  const card = CREW_BY_ID[player.faction.cardId];
  const face = card && card.faces && card.faces[player.faction.face];
  return face ? privKey(face.bonus) : null;
}
function hasPrivilege(state, player, key) {
  return privilegeOf(state, player) === key;
}
function playersWithPrivilege(state, key) {
  return (state.players || []).filter((p) => privilegeOf(state, p) === key);
}
// May this player commit a Felony? Yes during Anarchy (everyone gains
// Felonious, K2e), OR if they hold the Felonious privilege (Taikonauts) the
// rest of the time. (Anarchy suspends privilegeOf, but state.anarchy covers
// that case directly.)
function mayCommitFelony(state, player) {
  return !!state.anarchy || hasPrivilege(state, player, 'FELONIOUS');
}
// "+1 Aqua to every holder of <key>" passive-income trigger (Taxes on a claim,
// Launch Fees on a boost). Returns gameplay notes for the op log.
function creditPrivilegeIncome(state, key, label) {
  const notes = [];
  for (const p of playersWithPrivilege(state, key)) {
    p.aqua = (p.aqua | 0) + 1;
    notes.push(`${p.name} collected +1 aqua (${label}).`);
  }
  return notes;
}


// Operations that are GLITCH TRIGGERS (HF4 core): performing one with a
// glitched stack forces a Glitch Roll. Movement, Boost, Income, ET Produce,
// Delivery etc. are NOT triggers - a glitched stack does those freely.
const GLITCH_TRIGGER_OPS = new Set(['PROSPECT', 'SITE_REFUEL', 'INDUSTRIALIZE']);

// Glitch Roll: a glitched stack that performs a trigger op rolls 1d6, and
// every colocated card whose rad-hardness EXACTLY EQUALS the roll is
// decommissioned (crew evacuate to LEO; patents go to their deck bottom).
// The glitch disc persists until a Human clears it (G7), so each trigger
// re-rolls. Mutates state; returns { roll, lost } or null when not glitched.
function resolveGlitchTrigger(state, profileId) {
  const player = state.players.find((p) => p.profileId === profileId);
  if (!player || !player.rocket || !player.rocket.glitch) return null;
  const gen = makeRng(state.seed, state.rng.cursor);
  const roll = gen.d6();
  state.rng.cursor = gen.cursor;
  const lost = [];
  const degraded = [];
  const survivors = [];
  for (const slot of player.rocket.stack) {
    if (slotRadHardness(slot) === roll) {
      // A heavy-side radiator DEGRADES to its light side instead of being
      // destroyed - radiation NEVER destroys a radiator, it just folds it to
      // the lighter orientation (same exception the radiation-belt and solar-
      // flare sweeps already make). It survives with reduced cooling.
      const c = PATENTS_BY_ID[slot.id];
      if (c && c.type === 'radiator' && slot.radSide !== 'light') {
        slot.radSide = 'light';
        degraded.push(cardNameOf(slot.id));
        survivors.push(slot);
        continue;
      }
      // Decommission returns the card to its owner's HAND (HF4 decommission
      // is "back to hand", not destroyed to the deck), so it can be re-boosted
      // later. Crew aren't hand cards, so they evacuate to LEO instead.
      if (isCrewSlot(slot)) {
        (player.leo = player.leo || []).push({ id: slot.id, kind: 'crew', face: slot.face });
      } else {
        (player.hand = player.hand || []).push(slot.id);
      }
      lost.push(cardNameOf(slot.id));
    } else {
      survivors.push(slot);
    }
  }
  player.rocket.stack = survivors;
  if (lost.length) {
    if (!survivors.some((s) => s.id === player.rocket.activeThrusterId)) player.rocket.activeThrusterId = null;
    if (!survivors.some((s) => s.id === player.rocket.activeProspectorId)) player.rocket.activeProspectorId = null;
    clipTank(player.rocket);
  }
  const parts = [];
  if (lost.length) parts.push(`${lost.join(', ')} decommissioned to hand`);
  if (degraded.length) parts.push(`${degraded.join(', ')} degraded to its light side`);
  const log = parts.length
    ? `Glitch roll ${roll}: ${parts.join('; ')} (rad-hardness ${roll}).`
    : `Glitch roll ${roll}: nothing aboard matched - the stack got lucky.`;
  pushNews(state, EVENT_ICONS.glitch || '⚠️', `${player.name} (glitched stack): ${log}`);
  return { roll, lost, log };
}

// Runs after every functional op and after event resolution; returns
// gameplay notes for the log.
function autoFixGlitches(state) {
  const notes = [];
  for (const p of state.players) {
    // Scrum Troubleshooters (Norse): repair Glitches anywhere, even with no
    // Human present.
    const scrum = hasPrivilege(state, p, 'SCRUM_TROUBLESHOOTERS');
    const fixWord = scrum ? 'cleared remotely (Scrum Troubleshooters)' : 'fixed by nearby humans';
    if (p.rocket.glitch
        && (scrum || stackHasCrew(p.rocket.stack) || humansAtSite(state, p.rocket.siteId))) {
      p.rocket.glitch = false;
      notes.push(`${p.name}'s rocket glitch was ${fixWord}.`);
    }
    for (const o of Object.values(p.outposts || {})) {
      if (o && o.glitch
          && (scrum || stackHasCrew(o.cards) || humansAtSite(state, o.siteId))) {
        o.glitch = false;
        notes.push(`${p.name}'s Outpost ${o.letter} glitch was ${fixWord}.`);
      }
    }
  }
  return notes;
}

// A glory chit must be carried by a CREWED stack. If a rocket holds chits but
// has no crew aboard (the crew left, died, colonised, or was decommissioned),
// the chits can no longer be carried: they return home to LEO at FRONT (low /
// "1") value, exactly as if returned without a crew. Runs after every
// functional op and after event resolution, so it also RETROACTIVELY rescues
// chits already stuck on a crewless rocket the next time any op is applied.
function homeOrphanedGloryChits(state) {
  const notes = [];
  for (const p of state.players) {
    if (!p.glory || !Array.isArray(p.glory.chits) || !p.glory.chits.length) continue;
    if (p.rocket.stack.some(isCrewSlot)) continue;   // a crew is aboard to carry them
    p.glory.claimed = p.glory.claimed || [];
    let vps = 0;
    const zones = [];
    for (const c of p.glory.chits) {
      const vp = ((ZONE_CHIT_VPS[c.zone] || { front: 1, back: 1 }).front) | 0;
      p.glory.claimed.push({ zone: c.zone, side: 'front', vp, turn: state.turn });
      vps += vp;
      zones.push(c.zone);
    }
    p.glory.vps = (p.glory.vps | 0) + vps;
    p.glory.chits = [];
    const note = `${p.name}'s glory chit${zones.length === 1 ? '' : 's'} (${zones.join(', ')}) returned to LEO at front value (+${vps} VP) - no crew aboard to carry it.`;
    notes.push(note);
    pushNews(state, '🎖', note);
  }
  return notes;
}

const EVENT_HEADLINES = {
  inspiration: 'Inspiration (market decks cycled)',
  glitch: 'Glitch',
  pad_explosion: 'Pad Explosion',
  anarchy: 'Anarchy',
  budget_cuts: 'Budget Cuts',
  solar_flare: 'Solar Flare',
};
const NEWS_CAP = 40;
// Galactic news broadcast: a shared, capped feed of "what just
// happened" items every player sees via the toolbar news button.
function pushNews(state, icon, text, cards) {
  state.news = state.news || [];
  const item = { round: state.round, turn: state.turn, icon, text };
  // Card ids the item is about (the card that sank / was lost / was chosen),
  // so the news modal can render clickable chips to view them.
  if (Array.isArray(cards) && cards.length) item.cards = cards.filter(Boolean);
  state.news.push(item);
  if (state.news.length > NEWS_CAP) state.news.splice(0, state.news.length - NEWS_CAP);
}
const EVENT_ICONS = {
  inspiration: '\u{1F4A1}', glitch: '\u26A0\uFE0F', pad_explosion: '\u{1F9E8}',
  anarchy: '\u{1F5FD}', budget_cuts: '\u2702\uFE0F', solar_flare: '\u2600\uFE0F',
};

// ---- deferred destructive-event helpers ----
// Destructive Sunspot events (Glitch / Pad Explosion / Solar Flare) are
// MANDATORY EVENT ACTIONS: the effect commits only when the affected player
// confirms it on their turn (applyEventChoice), never silently at clock time.
// The affected player is blocked from acting until they confirm, so their own
// stacks don't change between the roll and the confirmation - which lets the
// effect be (re)computed at confirm time from the same state.

// The biggest human-less stack that would take a glitch disc, or null.
function glitchTargetFor(state, p) {
  const candidates = [];
  if (p.rocket.stack.length && !p.rocket.glitch
      && !stackHasCrew(p.rocket.stack) && !humansAtSite(state, p.rocket.siteId)) {
    candidates.push({ count: p.rocket.stack.length, apply: () => { p.rocket.glitch = true; }, label: `${p.name}'s rocket` });
  }
  for (const o of Object.values(p.outposts || {})) {
    if (o && (o.cards || []).length && !o.glitch
        && !stackHasCrew(o.cards) && !humansAtSite(state, o.siteId)) {
      candidates.push({ count: o.cards.length, apply: () => { o.glitch = true; }, label: `${p.name}'s Outpost ${o.letter}` });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.count - a.count);
  return candidates[0];
}

// Exposed (vulnerable) LEO cards: not crew, not flipped Black-Side.
function exposedLeo(p) {
  return (p.leo || []).filter((s) => !isCrewSlot(s) && s.face !== 'secondary');
}

// Apply the solar flare's toll to one player's non-LEO stacks (rocket +
// outposts) at the given flare roll. Pushes gameplay sentences to notesArr.
// Returns the number of cards affected. (Mirror of the old inline sweep.)
function applyFlareToPlayer(state, p, flare, notesArr) {
  let touched = 0;
  const sweep = (slots, siteId, where) => {
    const site = siteId ? siteById(siteId) : null;
    const zone = (site && site.solarZone) || 'Earth';
    const info = SOLAR_ZONE_INFO[zone];
    const mod = info ? info.solar : 0;
    if (mod === null) return slots;
    const hit = flare + mod;
    if (hit <= 0) return slots;
    const survivors = [];
    for (const slot of slots) {
      if (slotRadHardness(slot) >= hit) { survivors.push(slot); continue; }
      // Sails (Photon Heliogyro / Electric Sail / Photon Kite Sail) are immune
      // to Flare Rolls - they ride out the flare untouched.
      if (powerOfSlot(slot) && powerOfSlot(slot).immuneFlare) { survivors.push(slot); continue; }
      const c = PATENTS_BY_ID[slot.id];
      if (c && c.type === 'radiator' && slot.radSide !== 'light') {
        slot.radSide = 'light'; survivors.push(slot); touched++;
        notesArr.push(`${cardNameOf(slot.id)} ${where} degraded to its light side.`);
        continue;
      }
      touched++;
      if (isCrewSlot(slot)) {
        (p.leo = p.leo || []).push({ id: slot.id, kind: 'crew', face: slot.face });
        notesArr.push(`${cardNameOf(slot.id)} ${where} was overcome and evacuated to LEO.`);
      } else {
        (p.hand = p.hand || []).push(slot.id);   // Decommission -> back to hand
        notesArr.push(`${cardNameOf(slot.id)} ${where} decommissioned to hand (rad ${slotRadHardness(slot)} vs ${hit}).`);
      }
    }
    return survivors;
  };
  if (p.rocket.siteId) {
    const before = p.rocket.stack.length;
    p.rocket.stack = sweep(p.rocket.stack, p.rocket.siteId, 'aboard the rocket');
    if (p.rocket.stack.length !== before) {
      if (!p.rocket.stack.some((s) => s.id === p.rocket.activeThrusterId)) p.rocket.activeThrusterId = null;
      if (!p.rocket.stack.some((s) => s.id === p.rocket.activeProspectorId)) p.rocket.activeProspectorId = null;
      clipTank(p.rocket);
      recallIfEmpty(p);
    }
  }
  for (const o of Object.values(p.outposts || {})) {
    if (o) o.cards = sweep(o.cards || [], o.siteId, `at Outpost ${o.letter}`);
  }
  return touched;
}
// Would the flare touch this player at all? Dry run on a clone so we only
// block players who actually have something at stake.
function flareWouldAffect(state, p, flare) {
  return applyFlareToPlayer(state, clone(p), flare, []) > 0;
}

function resolveSunspotEvent(state, kind) {
  const rawNotes = state.lastEvent.notes;
  // Every detail line lands in BOTH the event record (clock modal) and
  // the news feed (toolbar broadcast).
  const notes = {
    push: (t, cards) => { rawNotes.push(t); pushNews(state, EVENT_ICONS[kind] || '\u2604\uFE0F', t, cards); },
  };

  if (kind === 'inspiration') {
    // Cycle every market deck: topmost card to the bottom. Record what
    // left and what surfaced so a player opening their turn during the
    // event round sees exactly which cards rotated.
    const cycled = [];
    for (const t of DECK_TYPES) {
      const deck = state.decks[t];
      if (!deck || deck.length < 2) continue;
      const out = deck.shift();
      deck.push(out);
      cycled.push({ deck: t, out, in: deck[0] });
      notes.push(`Inspiration: ${cardNameOf(out)} sank to the bottom of the ${t} deck; ${cardNameOf(deck[0])} is the new top.`, [out, deck[0]]);
    }
    state.lastEvent.cycled = cycled;
    if (!cycled.length) notes.push('Inspiration: the market decks were too thin to cycle.');
    return;
  }

  if (kind === 'glitch') {
    // Each affected player's biggest human-less stack will take a glitch disc,
    // but it's a mandatory event action: the disc lands only when the player
    // confirms it on their turn (applyEventChoice). Mark who's affected.
    const waiting = [];
    for (const p of state.players) {
      if (glitchTargetFor(state, p)) {
        waiting.push(p.profileId);
        notes.push(`Glitch: ${p.name} must confirm the glitch disc.`);
      } else {
        notes.push(`Glitch: ${p.name} had no uncrewed stack to glitch.`);
      }
    }
    if (waiting.length) state.pendingEvent = { kind: 'glitch', waiting, options: {} };
    return;
  }

  if (kind === 'pad_explosion') {
    // Each player decommissions their highest-mass exposed LEO card (crew and
    // Black-Side cards immune). Mandatory event action: it commits only on
    // the player's confirmation. A tie carries the tied ids so they pick;
    // a single highest card is just acknowledged.
    const waiting = [];
    const options = {};
    for (const p of state.players) {
      const exposed = exposedLeo(p);
      if (!exposed.length) {
        notes.push(`Pad Explosion: nothing exposed in ${p.name}'s LEO stack.`);
        continue;
      }
      const maxMass = Math.max(...exposed.map((s) => slotMass(s)));
      const atMax = exposed.filter((s) => slotMass(s) === maxMass);
      waiting.push(p.profileId);
      if (atMax.length > 1) {
        options[p.profileId] = atMax.map((s) => s.id);
        notes.push(`Pad Explosion: ${p.name} must choose which mass-${maxMass} card to lose from LEO.`);
      } else {
        notes.push(`Pad Explosion: ${p.name} must confirm losing their mass-${maxMass} LEO card.`);
      }
    }
    if (waiting.length) state.pendingEvent = { kind: 'pad_explosion', waiting, options };
    return;
  }

  if (kind === 'anarchy') {
    state.anarchy = true;
    notes.push('Anarchy: faction privileges are suspended until the Sunspot Cube exits season blue.');
    return;
  }

  if (kind === 'budget_cuts') {
    // Every player with hand cards picks one to send to the bottom of its
    // deck. Pauses until all picks land; empty hands are spared.
    const waiting = state.players
      .filter((p) => (p.hand || []).length > 0)
      .map((p) => p.profileId);
    if (!waiting.length) {
      notes.push('Budget Cuts: every hand was already empty.');
      return;
    }
    state.pendingEvent = { kind: 'budget_cuts', waiting };
    for (const p of state.players) {
      if (waiting.includes(p.profileId)) notes.push(`Budget Cuts: ${p.name} must discard a hand card.`);
    }
    return;
  }

  if (kind === 'solar_flare') {
    // One flare roll, applied to every card in every non-LEO stack, shifted by
    // the stack's heliocentric-zone modifier. Mandatory event action: the toll
    // commits only when each affected player confirms on their turn
    // (applyFlareToPlayer in applyEventChoice). Only players the flare would
    // actually touch are made to wait. The roll is fixed now (state.lastEvent
    // .flareRoll) so every player resolves against the same flare.
    const gen = makeRng(state.seed, state.rng.cursor);
    const flare = gen.d6();
    state.rng.cursor = gen.cursor;
    state.lastEvent.flareRoll = flare;
    notes.push(`Solar Flare: flare roll ${flare}.`);
    const waiting = [];
    for (const p of state.players) {
      if (flareWouldAffect(state, p, flare)) {
        waiting.push(p.profileId);
        notes.push(`Solar Flare: ${p.name} must confirm the flare's toll on their stacks.`);
      }
    }
    if (waiting.length) state.pendingEvent = { kind: 'solar_flare', waiting, options: {}, flareRoll: flare };
    return;
  }
}

// A waiting player answers an open Sunspot event (Budget Cuts discard or
// Pad Explosion tie-break). Validates its own caller, so it runs ahead of
// the turn guard - every affected player answers regardless of whose turn
// it is, like auction bids.
// Does this player still owe the open event a choice?
function eventDebtFor(state, profileId) {
  const pe = state.pendingEvent;
  return !!(pe && pe.waiting.includes(profileId));
}
// Drop a debt whose action no longer has anything to do (Budget Cuts with an
// empty hand, a Pad Explosion target that already left LEO). Acknowledge-only
// events (glitch / flare / pad-single) re-derive their own validity. Returns
// true when the debt was cleared; mutates state.
function clearStaleEventDebt(state, profileId) {
  const pe = state.pendingEvent;
  if (!pe || !pe.waiting.includes(profileId)) return false;
  const player = state.players.find((p) => p.profileId === profileId);
  if (!player) return false;
  const opts = pe.options && pe.options[profileId];
  let valid;
  if (pe.kind === 'budget_cuts') valid = (player.hand || []).length > 0;
  else if (pe.kind === 'pad_explosion') {
    valid = opts && opts.length
      ? opts.some((id) => (player.leo || []).some((s) => s.id === id))   // tie: a tied card still in LEO
      : exposedLeo(player).length > 0;                                   // single: something still exposed
  } else if (pe.kind === 'glitch') valid = !!glitchTargetFor(state, player);
  else if (pe.kind === 'solar_flare') valid = flareWouldAffect(state, player, pe.flareRoll);
  else valid = true;
  if (valid) return false;
  pe.waiting = pe.waiting.filter((id) => id !== profileId);
  if (pe.options) delete pe.options[profileId];
  if (!pe.waiting.length) state.pendingEvent = null;
  return true;
}

function applyEventChoice(state, op, ctx) {
  const pending = state.pendingEvent;
  if (!pending) return fail('no_event_pending');
  const player = state.players.find((p) => p.profileId === ctx.profileId);
  if (!player) return fail('not_a_player');
  if (!pending.waiting.includes(player.profileId)) return fail('not_waiting_on_you');
  const cardId = String(op.cardId || '');
  let log = '';
  const newsCards = [];

  if (pending.kind === 'budget_cuts') {
    const idx = (player.hand || []).indexOf(cardId);
    if (idx < 0) return fail('card_not_in_hand');
    player.hand.splice(idx, 1);
    destroyToDeckBottom(state, cardId);
    log = `${player.name} sent ${cardNameOf(cardId)} to the bottom of its deck (Budget Cuts).`;
    newsCards.push(cardId);
  } else if (pending.kind === 'pad_explosion') {
    const opts = (pending.options && pending.options[player.profileId]) || null;
    let lose;
    if (opts && opts.length) {
      // Tie: the player picks which of the tied cards to lose.
      if (!opts.includes(cardId)) return fail('not_a_tied_card');
      lose = cardId;
    } else {
      // Single: re-derive the highest-mass exposed LEO card (acknowledge).
      const exposed = exposedLeo(player);
      if (exposed.length) {
        const mm = Math.max(...exposed.map((s) => slotMass(s)));
        lose = (exposed.find((s) => slotMass(s) === mm) || {}).id;
      }
    }
    if (lose) {
      player.leo = (player.leo || []).filter((s) => s.id !== lose);
      (player.hand = player.hand || []).push(lose);   // Decommission -> back to hand
      log = `${player.name} decommissioned ${cardNameOf(lose)} from LEO to hand (Pad Explosion).`;
      newsCards.push(lose);
    } else {
      log = `${player.name} had nothing exposed to the Pad Explosion.`;
    }
  } else if (pending.kind === 'glitch') {
    const tgt = glitchTargetFor(state, player);
    if (tgt) { tgt.apply(); log = `${player.name}: a glitch disc lands on ${tgt.label} (${tgt.count} cards).`; }
    else log = `${player.name}: nothing left to glitch.`;
  } else if (pending.kind === 'solar_flare') {
    const arr = [];
    applyFlareToPlayer(state, player, pending.flareRoll, arr);
    log = arr.length
      ? `${player.name} (Solar Flare): ${arr.join(' ')}`
      : `${player.name}: the Solar Flare passed harmlessly.`;
  } else {
    return fail('unknown_event');
  }

  pending.waiting = pending.waiting.filter((id) => id !== player.profileId);
  if (pending.options) delete pending.options[player.profileId];
  if (!pending.waiting.length) {
    state.pendingEvent = null;
    log += ' The event is resolved.';
  }
  pushNews(state, EVENT_ICONS[pending.kind] || '\u2604\uFE0F', log, newsCards);
  // A flare that evacuated this player's last crew can orphan their chits.
  const homed = homeOrphanedGloryChits(state);
  if (homed.length) log += ' ' + homed.join(' ');
  return { ok: true, state, log };
}

// ----- hazard resolution (mirror of the sandbox move queue) -----

const HAZARD_COST_PER = 4;       // aqua to bypass one generic hazard
const RAD_BYPASS_THRUST = 6;     // thrust strictly above this skips rad rolls

// Does a (normalized) face carry the solar capability badge? Mirror of
// rocket.js#faceHasSolar.
function faceHasSolar(face) {
  return !!(face && Array.isArray(face.properties)
    && face.properties.some((p) => p.key === 'solar' && p.value));
}
function faceHasPush(face) {
  return !!(face && Array.isArray(face.properties)
    && face.properties.some((p) => p.key === 'push' && p.value));
}

// Normalise a rocket's stack into the support-chain resolver's card shape
// (mirror of rocket.js#chainCardsFromStack). Everything (supplies / requires /
// thrustMod / fuelMod) reads the INSTALLED face, so a flipped dark-side card's
// own stats drive the chain. Crew aren't power sources (no requires), so they
// pull no chain. `therms` is unused server-side (the server does not gate
// cooling), so it stays 0.
function chainCardsFromRocket(rocket) {
  return rocket.stack.map((s) => {
    const c = PATENTS_BY_ID[s.id];
    const f = c ? slotFace(s, c) : {};
    const type = c ? c.type : (s.kind || 'crew');
    return {
      id: s.id,
      type,
      supplies: (f && f.supplies) || (c && c.supplies) || [],
      requires: (f && f.requires) || (c && c.requires) || [],
      thrustMod: f ? f.thrustMod : undefined,
      fuelMod: f ? f.fuelMod : undefined,
      therms: 0,
    };
  });
}

// Net thrust of the active thruster after ALL deterministic modifiers
// (mirror of rocket.js#getActiveThrusterStats's thrust folding): base face
// thrust + support-chain reactor/generator thrustMod + weight-class band
// (from wet mass) + solar-zone shift for solar-driven thrusters. This - NOT
// the printed base thrust - is what the liftoff/landing gate and the rad
// bypass must use. Afterburn is a client-engaged one-shot the server does
// not track, so it is intentionally omitted here. 0 when no thruster.
function activeNetThrust(rocket, powersat = false) {
  const tid = rocket.activeThrusterId;
  if (!tid) return 0;
  const slot = rocket.stack.find((s) => s.id === tid);
  if (!slot) return 0;
  const f = thrusterFaceOf(slot);
  let thrust = Number.isFinite(f.thrust) ? f.thrust : null;
  if (thrust == null) return 0;
  // Powersat (ESA): +1 thrust to a push-icon thruster for the privilege holder.
  if (powersat && faceHasPush(f)) thrust += 1;
  // Support-chain thrust modifiers (rules 1+2, data/support-chain.js): mirror of
  // rocket.js#getActiveThrusterStats. Walk the full chain that powers this
  // thruster and add the thrustMod of the modifier path only (generators before
  // the first reactor + that first reactor, including reactors multiple hops
  // back). Must match the client exactly so a move it allows isn't rejected.
  const chain = resolveSupportChain({ cards: chainCardsFromRocket(rocket), activeId: tid, wiring: rocket.wiring || {} });
  for (const cid of chain.modifierChain) {
    const s = rocket.stack.find((x) => x.id === cid);
    const c = s && PATENTS_BY_ID[s.id];
    if (!c) continue;
    const cf = slotFace(s, c);
    if (cf.thrustMod != null && cf.thrustMod !== 0) thrust += cf.thrustMod;
  }
  // Weight-class band, keyed off current wet mass (dry + tank).
  const dry = rocket.stack.reduce((m, s) => m + slotMass(s), 0);
  const wet = dry + (Number(rocket.tank) || 0);
  thrust += weightClassForMass(wet).netThrust;
  // Solar-driven thrusters shift by the rocket's current zone modifier; a
  // null-solar zone (Neptune outward) kills solar thrust entirely.
  let solarDriven = faceHasSolar(f);
  if (!solarDriven && (f.requires || []).some((r) => (r.kind || r) === 'gen-electric')) {
    for (const s of rocket.stack) {
      if (s.id === tid) continue;
      const c = PATENTS_BY_ID[s.id];
      if (!c) continue;
      const cf = slotFace(s, c);
      if (faceHasSolar(cf) && (cf.supplies || []).includes('gen-electric')) { solarDriven = true; break; }
    }
  }
  if (solarDriven) {
    const site = rocket.siteId ? siteById(rocket.siteId) : null;
    const zone = (site && site.solarZone) || 'Earth';
    const info = SOLAR_ZONE_INFO[zone];
    const z = info ? info.solar : 0;
    if (z === null) thrust = 0;
    else thrust += z;
  }
  // Afterburn engaged this turn: +1 net thrust for the whole rocket (rulebook
  // MW Afterburn; the gain is always +1). Mirror of rocket.js. The fuel-step
  // cost was paid at engage (applyAfterburn).
  if (rocket.afterburnEngaged && f.afterburn > 0) thrust += 1;
  return thrust < 0 ? 0 : thrust;
}
// Water spent per burn = the active thruster face's `fuel` value, scaled
// by any other card's fuelMod (mirror of rocket.js#getActiveThrusterStats,
// the "N FT per burn" the client shows). The engine must charge the SAME
// so a move the client says it can afford isn't rejected. The move cost is
// ceil(fuelPerBurn * burns) (ceil applied to the whole move, as the client
// does), so free Hohmann coasting (0 burns) costs 0. Falls back to 1.
function thrusterFuelPerBurn(rocket) {
  const tid = rocket.activeThrusterId;
  if (!tid) return 1;
  const slot = rocket.stack.find((s) => s.id === tid);
  if (!slot) return 1;
  // Crew-aware: a crew thruster reads fuelPerBurn off its rocket face.
  const f = thrusterFaceOf(slot);
  const p = PATENTS_BY_ID[tid];
  let fuel = f.fuel != null ? f.fuel : (p && p.fuel);
  if (fuel == null) return 1;
  // Support-chain fuel modifiers (rules 1+2, data/support-chain.js): mirror of
  // rocket.js#getActiveThrusterStats. Scale fuel-per-burn by the fuelMod of the
  // modifier path only (generators before the first reactor + that first
  // reactor), folded in chain order so the client + server agree to the bit. A
  // self-powered thruster (requiring nothing) pulls no chain and is untouched.
  const chain = resolveSupportChain({ cards: chainCardsFromRocket(rocket), activeId: tid, wiring: rocket.wiring || {} });
  for (const cid of chain.modifierChain) {
    const s = rocket.stack.find((x) => x.id === cid);
    const c = s && PATENTS_BY_ID[s.id];
    if (!c) continue;
    const cf = slotFace(s, c);
    if (cf.fuelMod != null && cf.fuelMod !== 1) fuel *= cf.fuelMod;
  }
  return fuel;
}
// Rad-hardness of a stack slot's active face (0 when unrated).
function slotRadHardness(slot) {
  const p = PATENTS_BY_ID[slot.id];
  if (p) {
    const f = slotFace(slot, p);
    // A radiator's rad-hardness is its DEPLOYED side's (heavy is more fragile).
    if (p.type === 'radiator') return radiatorRadHardness(f, slot.radSide) | 0;
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
// Liftoff / landing thrust gate (mirror of browse.js#maneuverGate). Net
// thrust must exceed the site's size to lift off / land; a size-1 site is
// always doable with any operational thruster. Otherwise a factory at the
// site can carry the maneuver (assist) - free if a colony is present,
// else a hazard roll. No factory + under-thrust = hard block.
//   -> { ok, assist, needsRoll, size }
function maneuverGate(state, slug, thrust) {
  const size = nodeSizeNumber(slug);
  if (size <= 0 || thrust > size) return { ok: true, assist: false, needsRoll: false, size };
  if (size === 1 && thrust > 0) return { ok: true, assist: false, needsRoll: false, size };
  if (!state.factories[slug]) return { ok: false, assist: false, needsRoll: false, size };
  const colony = !!state.colonies[slug];
  return { ok: true, assist: true, needsRoll: !colony, size };
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

// "Parked at LEO" canonically means siteId == null (the never-launched
// state), but a rocket that MOVEs home lands on the LEO node's own slug
// instead. Both are the same spot on the board, so treat them identically -
// otherwise REFUEL / CASH_WATER / LEO transfers reject a rocket that flew
// back. MOVE also normalises arrival-at-LEO back to null (see applyMove) so
// new games keep to the canonical form.
function rocketAtLeo(player) {
  const s = player.rocket && player.rocket.siteId;
  return s == null || s === leoSlug();
}

function applyMove(state, op, player) {
  // A dry-run (op.debug) skips the per-turn budget gate so the fuel breakdown
  // can be previewed any time (even with the move already spent / off-turn).
  // One move per turn: spending it (movesRemaining -> 0) is the ONLY thing
  // that blocks a second move - prospecting does NOT forfeit a move you have
  // not taken yet. If you moved BEFORE a raygun scan, that move is spent and
  // further movement is blocked (no_moves_left); if you scanned WITHOUT moving
  // first, you may still take your one move afterward. (A move taken before a
  // prospect also can't be undone once the prospect rolls - that's the roll
  // barrier in applyUndo, not a move-after-prospect gate.)
  if (!op.debug && player.movesRemaining <= 0) return fail('no_moves_left');
  // An empty rocket has no thruster and can't burn, so it can't leave
  // LEO. Enforcing this keeps the "empty rocket == at LEO" invariant
  // true: the only way off LEO is to build/board a thruster first.
  if (player.rocket.stack.length === 0) return fail('empty_rocket');
  const from = player.rocket.siteId;       // null = LEO
  const here = from == null ? leoSlug() : from;

  // The CLIENT's mission-planner is the source of truth for routing: it
  // splits a journey into turns and counts Hohmann-aware burns (free
  // coasting along a transfer). MOVE executes ONLY this turn's segments -
  // sent on the op (preferred, race-free) or read from the stored route's
  // turn-1 - so a multi-turn transfer's later legs are NOT charged now.
  // Each segment is { from, to, burns }.
  let segs = null;
  const opSegs = Array.isArray(op.segments) ? op.segments : null;
  if (opSegs && opSegs.length) {
    segs = opSegs.map((s) => ({
      from: String(s.from), to: String(s.to),
      burns: Math.max(0, Math.floor(Number(s.burns) || 0)),
    }));
  } else if (Array.isArray(player.rocket.route) && player.rocket.route.length
             && player.rocket.route.some((s) => s.turn != null)) {
    segs = player.rocket.route
      .filter((s) => (s.turn || 1) === 1)
      .map((s) => ({ from: s.from, to: s.to, burns: Math.max(0, Math.floor(Number(s.burns) || 0)) }));
  }

  let dest, thisTurnBurns, arrivals;
  if (segs && segs.length) {
    // The server does NOT verify the route's geometry (continuity from the
    // rocket, segment-to-segment chaining, node existence). Routing is the
    // CLIENT's job via the shared mission-planner; re-validating it here means
    // maintaining a second route model that drifts and spuriously rejects a
    // route that IS connected (route_not_from_here). The server's job on a
    // MOVE is to validate + charge the BURNS (the fuel-step cost, below). It
    // trusts the client's segments for the destination + arrival nodes.
    // (TODO: real server-side route verification, when added, MUST reuse the
    // client planner model - see CLAUDE.md "Movement authority".)
    dest = segs[segs.length - 1].to;
    thisTurnBurns = segs.reduce((b, s) => b + s.burns, 0);
    arrivals = segs.map((s) => s.to);
  } else {
    // Direct mode: a bare destination tap with no per-turn plan. Falls
    // back to the planner-graph shortest path for the WHOLE journey - only
    // reached when the client didn't send segments (e.g. a quick adjacent
    // hop), so the over-count risk is bounded to short moves.
    const toSlug = String(op.toSiteId || '');
    if (!plannerSiteExists(toSlug)) return fail('unknown_site');
    if (toSlug === here) return fail('already_here');
    const path = plannerFindPath(from, toSlug);
    if (!path) return fail('no_route');
    dest = toSlug;
    thisTurnBurns = path.totalBurns;
    arrivals = path.path.slice(1);
  }
  if (dest === from) return fail('already_here');

  // Fuel-step model (shared with the client via data/fuel-graph.js): a burn
  // spends fuel STEPS - black connections on the ladder - NOT water 1-to-1.
  // The move is affordable iff the wet chit can walk that many black steps
  // before hitting dry mass. The water it costs is the non-linear mass drop
  // (applied when the burn commits, below), which can leave a sub-1 remainder.
  const perBurn = thrusterFuelPerBurn(player.rocket);            // fuel steps per burn
  const dryMass = player.rocket.stack.reduce((mm, s) => mm + slotMass(s), 0);
  const wetMass = dryMass + (Number(player.rocket.tank) || 0);
  const stepsNeeded = Math.ceil(perBurn * thisTurnBurns);
  const stepsAvail = blackStepsBetween(dryMass, wetMass);
  // Full burn-math breakdown - returned on a reject (detail) AND on the debug
  // dry-run (result.calc) so the client can show every intermediate value
  // instead of just tank before/after.
  const moveCalc = {
    finalThrust: activeNetThrust(player.rocket, hasPrivilege(state, player, 'POWERSAT')),
    fuelStepsPerBurn: perBurn,
    dryMass,
    wetMass,
    tank: round6(player.rocket.tank),
    fuelStepsInShip: stepsAvail,
    canBurn: perBurn > 0 ? Math.floor(stepsAvail / perBurn) : null,
    burnsNeeded: thisTurnBurns,
    fuelStepsNeeded: stepsNeeded,
    enough: stepsNeeded <= stepsAvail,
  };
  // Fuel-grade gate: a dirt thruster can burn EITHER grade (dirt or water); a
  // water thruster can burn ONLY water. So the lone incompatible case is a
  // water engine drawing on a dirt tank (clearer than "insufficient" - the
  // fuel is there, just incompatible). Tank still never mixes the two grades.
  if (stepsNeeded > 0 && (Number(player.rocket.tank) || 0) > 0) {
    const need = activeFuelGrade(player.rocket);
    const have = tankGradeOf(player.rocket);
    if (need === 'water' && have === 'dirt') return fail('wrong_fuel_grade', { need, have });
  }
  if (stepsNeeded > stepsAvail) {
    return fail('insufficient_water', moveCalc);
  }

  // Hazards along the nodes we ARRIVE at this turn, classified the same
  // way the sandbox does. Generic (skull / aerobrake) hazards are
  // aqua-payable (FINAO) or rolled; rad zones always roll (unpayable).
  const generic = [];   // skull / aero slugs (in travel order)
  const rad = [];       // rad slugs
  for (const slug of arrivals) {
    const k = hazardKind(slug);
    if (k === 'rad') rad.push(slug);
    else if (k === 'skull' || k === 'aero') generic.push(slug);
  }
  const thrust = activeNetThrust(player.rocket, hasPrivilege(state, player, 'POWERSAT'));
  // Factory-assist liftoff / landing gate. A maneuver where net thrust
  // <= site size is only legal if a factory carries it (assist), which
  // is a hazard roll unless a colony waives it. No factory => hard block.
  // Liftoff gates the origin (skipped at LEO, siteId null); landing gates
  // the destination.
  const liftG = from ? maneuverGate(state, from, thrust) : { ok: true, needsRoll: false };
  if (!liftG.ok) return fail('cannot_liftoff', { thrust, siteSize: liftG.size, site: from });
  const landG = maneuverGate(state, dest, thrust);
  if (!landG.ok) return fail('cannot_land', { thrust, siteSize: landG.size, site: dest });
  // Ordered roll items: liftoff assist, route generics (skull/aero), then
  // landing assist. Each is aqua-payable (FINAO) or a d6 where a 1 is a
  // critical that destroys the ship.
  const rollItems = [];
  const safeAero = stackSafeAerobrake(player.rocket);
  const safeAeroSlugs = [];   // aero hazards the parachute waived (for playback)
  if (liftG.needsRoll) rollItems.push({ slug: from, kind: 'assist', phase: 'liftoff' });
  for (const slug of generic) {
    const k = hazardKind(slug);
    // A safe-aerobrake card (parachute generator) carries the stack through
    // aerobrake hazards with no roll; skull hazards still roll.
    if (k === 'aero' && safeAero) { safeAeroSlugs.push(slug); continue; }
    rollItems.push({ slug, kind: k });
  }
  if (landG.needsRoll) rollItems.push({ slug: dest, kind: 'assist', phase: 'landing' });

  const wantPay = !!op.hazardPay;
  // FINAO: pay aqua up front to skip the generic + assist rolls. Validated
  // before anything mutates so a short balance rejects the move cleanly. Open
  // Source FINAO (Anonymous P2P) discounts the per-hazard cost to 3.
  const finaoPer = hasPrivilege(state, player, 'OPEN_SOURCE_FINAO') ? 3 : HAZARD_COST_PER;
  const finaoCost = wantPay ? rollItems.length * finaoPer : 0;
  if (finaoCost > 0 && finaoCost > (player.aqua | 0)) return fail('insufficient_aqua');

  // Commit the burn + the FINAO payment, then resolve dice in travel
  // order. rolls[] is recorded on the rocket for the client to play
  // back (server is authoritative for every die).
  // Spend the fuel: walk the wet chit down `stepsNeeded` black connections;
  // the new tank water is whatever mass is left above dry (often fractional).
  player.rocket.tank = round6(walkBlackDown(wetMass, stepsNeeded) - dryMass);
  if (finaoCost > 0) player.aqua -= finaoCost;

  const gen = makeRng(state.seed, state.rng.cursor);
  const rolls = [];
  let destroyed = false;
  let haltSlug = dest;            // where the rocket actually ends up

  // Aerobrakes the parachute waived: recorded as safely passed (no roll) so
  // the client plays them back as a clean pass rather than a missing node.
  for (const slug of safeAeroSlugs) rolls.push({ slug, kind: 'aero', safe: true });

  // Generic + assist rolls: a rolled 1 is a critical that destroys the
  // ship at that node (unless paid past via FINAO).
  if (!wantPay) {
    for (const item of rollItems) {
      const d6 = gen.d6();
      const crit = d6 === 1;
      rolls.push({ slug: item.slug, kind: item.kind, phase: item.phase, d6, crit });
      if (crit) { destroyed = true; haltSlug = item.slug; break; }
    }
  }
  // Rad zones (only if the ship survived the generics). Thrust strictly
  // above the bypass bar outruns the radiation with no roll; otherwise
  // each zone rolls and the worst (d6 - thrust) decommissions any stack
  // card whose rad-hardness is below it.
  let decommissioned = [];
  const degradedRadiators = [];
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
          // Sails (Photon Heliogyro / Electric Sail / Photon Kite Sail) are
          // immune to Belt Rolls - the belt never decommissions them.
          const pw = powerOfSlot(slot);
          if (pw && pw.immuneBelt) { survivors.push(slot); continue; }
          if (slotRadHardness(slot) < worst) {
            // A heavy-side radiator DEGRADES to its light side instead of being
            // destroyed - the one exception to the no-flip-after-construction
            // rule. It survives (reduced cooling); a radiator already on light
            // is destroyed normally.
            const c = PATENTS_BY_ID[slot.id];
            if (c && c.type === 'radiator' && slot.radSide !== 'light') {
              slot.radSide = 'light';
              degradedRadiators.push(slot.id);
              survivors.push(slot);
              continue;
            }
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

  // Sail aerobrake decommission: a sail (Photon Heliogyro / Electric Sail /
  // Photon Kite Sail / Mag Sail) burns off if the stack passes ANY aerobrake
  // hazard on this move. Decommissioned back to hand. (Skipped if the ship was
  // destroyed - the whole stack is already gone.)
  const sailDecommissioned = [];
  if (!destroyed && generic.some((s) => hazardKind(s) === 'aero')) {
    const kept = [];
    for (const slot of player.rocket.stack) {
      const pw = powerOfSlot(slot);
      if (pw && pw.aerobrakeDecommission) {
        sailDecommissioned.push(cardNameOf(slot.id));
        player.hand.push(slot.id);   // sails are patents -> back to hand
      } else {
        kept.push(slot);
      }
    }
    if (sailDecommissioned.length) {
      player.rocket.stack = kept;
      if (player.rocket.activeThrusterId && !kept.some((s) => s.id === player.rocket.activeThrusterId)) player.rocket.activeThrusterId = null;
      if (player.rocket.activeProspectorId && !kept.some((s) => s.id === player.rocket.activeProspectorId)) player.rocket.activeProspectorId = null;
      clipTank(player.rocket);
    }
  }

  if (destroyed) {
    // The ship is lost at haltSlug; cards scatter, rocket recalls to LEO.
    const where = siteById(haltSlug);
    const whereName = (where && where.name) || haltSlug;
    player.rocket.route = [];
    player.rocket.lastMove = { rolls, destroyed: true, at: haltSlug, nonce: nextMoveNonce(player) };
    destroyRocket(player);
    return {
      ok: true, state,
      log: `${player.name} burned ${stepsNeeded} fuel steps and was DESTROYED at ${whereName} (rolled a 1).`,
    };
  }

  // Arriving back at LEO normalises to the canonical null position (LEO is
  // "no site"), so the at-LEO ops recognise it without special-casing the slug.
  player.rocket.siteId = (dest === leoSlug()) ? null : dest;
  // Advance the stored route past this turn. A turn-tagged route drops its
  // turn-1 legs and shifts the rest down (T2 -> T1, ...); a legacy untagged
  // route pops everything up to the node we reached.
  if (Array.isArray(player.rocket.route) && player.rocket.route.length) {
    if (player.rocket.route.some((s) => s.turn != null)) {
      player.rocket.route = player.rocket.route
        .filter((s) => (s.turn || 1) > 1)
        .map((s) => ({ ...s, turn: (s.turn || 1) - 1 }));
    } else {
      const idx = player.rocket.route.findIndex((s) => s.to === dest);
      if (idx >= 0) player.rocket.route = player.rocket.route.slice(idx + 1);
    }
  }
  const destSite = siteById(dest);
  // Loading the chit is the player's call (pickupChit). Default true so a
  // client that omits the flag still auto-loads; "Leave it" sends false and
  // the chit stays on the site for a later LOAD_GLORY (Claim glory chit).
  const chit = (destSite && op.pickupChit !== false)
    ? maybeAwardGlory(state, player, destSite, state.turn) : null;
  // Arriving home (LEO == null siteId): a crew hauls its carried glory chits
  // back to score them. The server doesn't track which crew carried which chit,
  // so all carried chits score together - BACK (flipped, the big value) when a
  // crew is aboard to have brought them home alive, FRONT otherwise. Resolved
  // chits move to glory.claimed and add to glory.vps. Mirrors the sandbox
  // cashHomeArrival; until now MP never scored chits at home.
  let homeScored = 0;
  let homeVps = 0;
  let homeSide = null;
  if (player.rocket.siteId === null && (player.glory.chits || []).length) {
    homeSide = player.rocket.stack.some(isCrewSlot) ? 'back' : 'front';
    player.glory.claimed = player.glory.claimed || [];
    for (const c of player.glory.chits) {
      const vp = ((ZONE_CHIT_VPS[c.zone] || { front: 1, back: 1 })[homeSide]) | 0;
      player.glory.claimed.push({ zone: c.zone, side: homeSide, vp, turn: state.turn });
      player.glory.vps = (player.glory.vps | 0) + vp;
      homeScored += 1;
      homeVps += vp;
    }
    player.glory.chits = [];
  }
  player.rocket.lastMove = {
    rolls, destroyed: false, decommissioned,
    at: dest, nonce: nextMoveNonce(player),
  };

  const destName = (destSite && destSite.name) || dest;
  // Origin captured before the move (siteId was already advanced to dest).
  // null == LEO. Fuel steps (not water): a burn spends fuel steps, which
  // are non-linear with the water/aqua loaded onto the rocket.
  const originName = from == null ? 'LEO' : ((siteById(from) || {}).name || from);
  let log = `${player.name} burned ${stepsNeeded} fuel steps from ${originName} to ${destName}.`;
  const nItems = rollItems.length;
  if (finaoCost > 0) log += ` Paid ${finaoCost} aqua (FINAO) past ${nItems} hazard${nItems === 1 ? '' : 's'}.`;
  else if (nItems) log += ` Rolled through ${nItems} hazard${nItems === 1 ? '' : 's'}.`;
  if (decommissioned.length) log += ` Radiation decommissioned ${decommissioned.length} card${decommissioned.length === 1 ? '' : 's'}.`;
  if (degradedRadiators.length) log += ` Radiation degraded ${degradedRadiators.length} radiator${degradedRadiators.length === 1 ? '' : 's'} to its light side.`;
  if (sailDecommissioned.length) log += ` Aerobraking burned off ${sailDecommissioned.join(', ')} (decommissioned to hand).`;
  if (chit) log += ` First into the ${chit.zone} zone (+glory chit).`;
  if (homeScored) {
    log += ` Scored ${homeScored} glory chit${homeScored === 1 ? '' : 's'}`
      + ` ${homeSide === 'back' ? 'brought home (back)' : '(front)'} for ${homeVps} VP.`;
  }
  return { ok: true, state, log, calc: moveCalc };
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
  // A radiator built straight onto the rocket locks its deployed side here too
  // (default heavy / max cooling).
  if (card.type === 'radiator') slot.radSide = op.radSide === 'light' ? 'light' : 'heavy';
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

// Has the active player already boosted this turn? Reads this turn's action
// history (reset every turn, like the raygun-scan check) so the first boost
// spends the operation and the rest ride free. The dispatcher records the
// CURRENT op only after its handler returns, so this sees PRIOR boosts, not
// the one in flight (mirrors hasProspectedThisTurn).
function hasBoostedThisTurn(state) {
  return Array.isArray(state.turnActions)
    && state.turnActions.some((a) => a && a.kind === 'BOOST');
}

// Boost: move marked HAND cards up to the LEO Stack (rulebook I4,
// the sandbox commitBoost flow). Costs aqua equal to the total mass of the
// boosted cards. Like the raygun scan, the FIRST boost of the turn spends the
// turn's single operation to "open the launch window"; every later boost this
// same turn rides up FREE (no operation), so a player can keep boosting once
// they have begun. The cards land in player.leo; from there TRANSFER boards
// them onto the rocket while it's at LEO. This is the op the sandbox BOOST
// button fires in online mode - without it the boost was a purely local
// mutation the server never saw.
// op = { cardIds: [id, ...] }.
function applyBoost(state, op, player) {
  const ids = Array.isArray(op.cardIds) ? op.cardIds.map(String) : [];
  if (!ids.length) return fail('nothing_to_boost');
  // Free once the turn's boosting has begun (same economy as the raygun).
  const free = hasBoostedThisTurn(state);
  if (!free && player.opsRemaining <= 0) return fail('no_ops_left');
  // Every id must currently be in the hand.
  for (const id of ids) {
    if (player.hand.indexOf(id) < 0) return fail('not_in_hand');
  }
  // Cost = total mass of the boosted cards (aqua).
  let cost = 0;
  for (const id of ids) cost += slotMass({ id });
  if (cost > player.aqua) return fail('insufficient_aqua');
  // Move them hand -> LEO. A radiator locks its deployed light/heavy side here
  // (op.radSides[id]); default heavy (max cooling). Only radiation damage flips
  // it afterward.
  const radSides = (op.radSides && typeof op.radSides === 'object') ? op.radSides : {};
  for (const id of ids) {
    const idx = player.hand.indexOf(id);
    if (idx >= 0) player.hand.splice(idx, 1);
    const slot = { id, kind: 'patent' };
    const card = PATENTS_BY_ID[id];
    if (card && card.type === 'radiator') {
      slot.radSide = radSides[id] === 'light' ? 'light' : 'heavy';
    }
    player.leo.push(slot);
  }
  player.aqua -= cost;
  if (!free) player.opsRemaining -= 1;
  const n = ids.length;
  const tail = free ? ' (continued boost, no operation)' : '';
  let log = `${player.name} boosted ${n} card${n === 1 ? '' : 's'} to LEO for ${cost} aqua${tail}.`;
  // Launch Fees: a boost pays every Launch Fees holder +1 aqua from the pool.
  const fees = creditPrivilegeIncome(state, 'LAUNCH_FEES', 'Launch Fees');
  if (fees.length) log += ' ' + fees.join(' ');
  return { ok: true, state, log };
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

// Discard one Hand card to the BOTTOM of its deck. A FREE action (no op cost)
// and UNLIMITED per turn: voluntary card discard is a "any number per turn"
// free action (only discarding a Human/crew figure is capped, and crew aren't
// discarded from the hand here). Was client-only before, so in MP the discard
// never persisted and the next snapshot reverted it.
function applyDiscard(state, op, player) {
  const cardId = String(op.cardId || '');
  const idx = player.hand.indexOf(cardId);
  if (idx < 0) return fail('not_in_hand');
  player.hand.splice(idx, 1);
  const card = PATENTS_BY_ID[cardId];
  // Patents recirculate to the bottom of their type's deck; crew (no deck)
  // just leave the hand.
  if (card) {
    const deck = state.decks[card.type];
    if (Array.isArray(deck)) deck.push(cardId);
  }
  const name = card ? card.name : cardId;
  return {
    ok: true, state,
    log: `${player.name} discarded ${name} to the bottom of the ${card ? card.type : 'crew'} deck.`,
  };
}

// Convert aqua -> water 1:1, only while the rocket is at LEO (the Aqua
// Bank lives at LEO). Clamped by the requested amount, the aqua on
// hand, and the remaining wet-mass room in the tank. This is where
// rocket water comes from - ships open with an EMPTY tank now, so a
// player funds a burn by converting aqua here first. Free (no op
// cost), turn-gated. op = { amount }.
function applyRefuel(state, op, player) {
  if (!rocketAtLeo(player)) return fail('rocket_not_at_leo');
  const want = Math.floor(Number(op.amount));
  if (!Number.isFinite(want) || want <= 0) return fail('bad_amount');
  const tank = Number(player.rocket.tank) || 0;
  // Water and dirt can't mix: refuse to pour water onto a dirt tank. Empty
  // the dirt first (burn it off) before taking on water.
  if (tank > 0 && tankGradeOf(player.rocket) === 'dirt') return fail('cannot_mix_fuel');
  const dry = player.rocket.stack.reduce((m, s) => m + slotMass(s), 0);
  // Whole water units only; any sub-1 remainder left by a burn stays put
  // (don't floor the tank away when topping up).
  const room = Math.floor(Math.max(0, TANK_MAX - dry - tank));
  const amt = Math.min(want, player.aqua | 0, room);
  if (amt <= 0) {
    if (room <= 0) return fail('tank_full');
    return fail('insufficient_aqua');
  }
  player.aqua -= amt;
  player.rocket.tank = round6(tank + amt);
  player.rocket.tankGrade = 'water';
  return { ok: true, state, log: `${player.name} converted ${amt} aqua to water (tank ${round6(player.rocket.tank)}).` };
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
    const turn = Math.max(1, Math.floor(Number(s.turn) || 1));
    norm.push({ from, to, burns, turn });   // turn drives per-turn MOVE execution
  }
  // The server does NOT validate the route's geometry (continuity / node
  // existence) - routing is the client's planner job; this op just persists
  // the (secret) plan. MOVE trusts these segments and validates only the
  // burns. See CLAUDE.md "Movement authority".
  player.rocket.route = norm;
  return { ok: true, state, log: '' };  // empty log: routes are secret
}

function applyClearRoute(state, _op, player) {
  player.rocket.route = [];
  return { ok: true, state, log: '' };
}

// Player support-chain wiring persistence. Stored as player.rocket.wiring, a
// map { consumerId: { kind: supplierId } } that names which supplier card the
// player chose to power each consumer for each support kind. Like SET_ROUTE
// this just persists the client's choice; the resolver (data/support-chain.js)
// already auto-falls-back to the first matching supplier for any entry whose
// supplier is no longer in the stack, so a stale wiring never breaks a chain.
// Wiring tunes a stack opponents can already see, so it is NOT secret and
// returns a real log line. op = { wiring: { consumerId: { kind: supplierId } } }.
function applySetWiring(state, op, player) {
  const raw = (op && op.wiring && typeof op.wiring === 'object') ? op.wiring : {};
  const stackIds = new Set((player.rocket.stack || []).map((s) => s.id));
  const norm = {};
  for (const consumerId of Object.keys(raw)) {
    if (!stackIds.has(consumerId)) continue;            // consumer must be aboard
    const byKind = raw[consumerId];
    if (!byKind || typeof byKind !== 'object') continue;
    const clean = {};
    for (const kind of Object.keys(byKind)) {
      const supplierId = String(byKind[kind] || '');
      // The supplier must be a real other card in the stack; a self-wire or a
      // ghost id is dropped (the resolver would ignore it anyway).
      if (supplierId && supplierId !== consumerId && stackIds.has(supplierId)) {
        clean[String(kind)] = supplierId;
      }
    }
    if (Object.keys(clean).length) norm[consumerId] = clean;
  }
  player.rocket.wiring = norm;
  return { ok: true, state, log: `${player.name} rewired the rocket support chain.` };
}

// Reverse of REFUEL: cash tank water back into the aqua bank 1:1, only
// at LEO. Clamped by the water on hand. Free, turn-gated. op={amount}.
function applyCashWater(state, op, player) {
  if (!rocketAtLeo(player)) return fail('rocket_not_at_leo');
  // Only water is worth aqua; dirt is free field propellant with no cash
  // value. Burn dirt off to empty the tank, then it can take water again.
  if (tankGradeOf(player.rocket) === 'dirt' && (Number(player.rocket.tank) || 0) > 0) {
    return fail('not_water_fuel');
  }
  const want = Math.floor(Number(op.amount));
  if (!Number.isFinite(want) || want <= 0) return fail('bad_amount');
  // Whole water units only; the sub-1 remainder can't be cashed and stays.
  const amt = Math.min(want, Math.floor(Number(player.rocket.tank) || 0));
  if (amt <= 0) return fail('no_water');
  player.rocket.tank = round6((Number(player.rocket.tank) || 0) - amt);
  player.aqua = (player.aqua | 0) + amt;
  return { ok: true, state, log: `${player.name} cashed ${amt} water back to aqua (aqua ${player.aqua}).` };
}

// Jettison fuel from the tank (Internal Tankage free action - destroyed for
// now; Stage 3+ drops it as an outpost stack). Grade-agnostic: dumps water
// OR dirt, no aqua credit. No op cost; turn-gated like the other tank ops.
// op = { amount? }: a specific amount jettisons that much (clamped to the
// tank); omitted / >= tank clears the whole tank, sub-1 remainder included.
function applyDump(state, op, player) {
  const tank = Number(player.rocket.tank) || 0;
  if (tank <= 0) return fail('no_fuel');
  const want = Number(op && op.amount);
  const amt = (!Number.isFinite(want) || want <= 0 || want >= tank) ? tank : want;
  player.rocket.tank = round6(tank - amt);
  const word = tankGradeOf(player.rocket) === 'dirt' ? 'dirt' : 'water';
  return { ok: true, state, log: `${player.name} dumped ${round6(amt)} ${word} (tank ${round6(player.rocket.tank)}).` };
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
// Colocated card transfer to/from the rocket. Endpoints: 'leo', 'rocket',
// or 'outpostA'..'outpostD'. One side MUST be the rocket (it's the mobile
// carrier). Colocation:
//   - leo <-> rocket: rocket parked at LEO (siteId null)
//   - outpostX <-> rocket: rocket parked at the outpost's site (or, if the
//     rocket is empty, it FORMS at the outpost's site - "lift off later")
// All ids must be present in the source or the whole batch rejects.
// op = { cardIds | cardId, from, to }. Backward-compat: when only `to` is
// given it's the old LEO<->rocket op (from is the other of leo/rocket).
function stackArrayOf(player, id) {
  if (id === 'leo') return (player.leo = player.leo || []);
  if (id === 'rocket') return player.rocket.stack;
  if (id && id.startsWith('outpost')) {
    const op = player.outposts && player.outposts[id.slice('outpost'.length)];
    return op ? op.cards : null;
  }
  return null;
}
function applyTransfer(state, op, player) {
  let to = op.to;
  let from = op.from;
  // Legacy shorthand: only `to` (rocket|leo) given -> the other is `from`.
  if (!from && (to === 'rocket' || to === 'leo')) from = (to === 'rocket' ? 'leo' : 'rocket');
  if (!from || !to || from === to) return fail('bad_transfer');
  if (from !== 'rocket' && to !== 'rocket') return fail('bad_transfer');

  const ids = Array.isArray(op.cardIds)
    ? op.cardIds.map(String)
    : (op.cardId != null ? [String(op.cardId)] : []);
  if (!ids.length) return fail('bad_transfer');

  // The non-rocket endpoint + its colocation requirement.
  const other = from === 'rocket' ? to : from;
  const rocketEmpty = player.rocket.stack.length === 0;
  if (other === 'leo') {
    if (!rocketAtLeo(player) && !rocketEmpty) return fail('rocket_not_at_leo');
  } else if (other.startsWith('outpost')) {
    const opp = player.outposts && player.outposts[other.slice('outpost'.length)];
    if (!opp) return fail('no_outpost');
    if (rocketEmpty) {
      // Forming the rocket at the outpost: it adopts the outpost's site.
      player.rocket.siteId = opp.siteId;
    } else if (player.rocket.siteId !== opp.siteId) {
      return fail('not_colocated');
    }
  } else {
    return fail('bad_transfer');
  }

  const srcArr = stackArrayOf(player, from);
  const dstArr = stackArrayOf(player, to);
  if (!srcArr || !dstArr) return fail('bad_transfer');
  for (const id of ids) {
    if (!srcArr.some((s) => s.id === id)) return fail('not_in_source');
  }

  const moved = [];
  for (const id of ids) {
    const idx = srcArr.findIndex((s) => s.id === id);
    const [slot] = srcArr.splice(idx, 1);
    dstArr.push(slot);
    if (to === 'rocket') {
      if (!player.rocket.activeThrusterId && isThrusterSlot(slot)) player.rocket.activeThrusterId = slot.id;
      if (!player.rocket.activeProspectorId && isProspectorSlot(slot)) player.rocket.activeProspectorId = slot.id;
    }
    if (from === 'rocket') {
      if (player.rocket.activeThrusterId === slot.id) player.rocket.activeThrusterId = null;
      if (player.rocket.activeProspectorId === slot.id) player.rocket.activeProspectorId = null;
    }
    moved.push(slot);
  }

  if (to === 'rocket') clipTank(player.rocket);
  if (from === 'rocket') recallIfEmpty(player);
  const label = moved.length === 1 ? slotName(moved[0]) : `${moved.length} cards`;
  const dstName = to === 'rocket' ? 'the rocket'
    : to === 'leo' ? 'the LEO Stack' : `Outpost ${to.slice('outpost'.length)}`;
  return { ok: true, state, log: `${player.name} moved ${label} to ${dstName}.` };
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

// Voluntary decommission: send selected cards from the rocket stack (or
// LEO Stack) back to the HAND (mirror of browse.js#decommissionSelectedToHand).
// Crew never enters the hand, so any crew in the selection is skipped.
// op = { cardIds: [...], from: 'rocket' | 'leo' }. Turn-gated (functional).
function applyDecommission(state, op, player) {
  const from = op.from === 'leo' ? 'leo' : 'rocket';
  const ids = Array.isArray(op.cardIds)
    ? op.cardIds.map(String)
    : (op.cardId != null ? [String(op.cardId)] : []);
  if (!ids.length) return fail('bad_decommission');
  const src = from === 'leo' ? (player.leo || []) : player.rocket.stack;
  let returned = 0;
  let crewToLeo = 0;
  let blocked = 0;
  for (const id of ids) {
    const idx = src.findIndex((s) => s.id === id);
    if (idx < 0) continue;
    const slot = src[idx];
    // Decommissioning a Crew (a Human) is a FELONY. Normally blocked; during
    // Anarchy it's allowed (Felonious privilege, G6) and the crew returns to
    // the LEO Stack rather than the patent hand (crew aren't hand cards).
    if (isCrewSlot(slot)) {
      if (!mayCommitFelony(state, player) || from === 'leo') { blocked++; continue; }
      src.splice(idx, 1);
      (player.leo = player.leo || []).push({ id: slot.id, kind: 'crew', face: slot.face === 'secondary' ? 'secondary' : 'primary' });
      if (player.rocket.activeThrusterId === id) player.rocket.activeThrusterId = null;
      if (player.rocket.activeProspectorId === id) player.rocket.activeProspectorId = null;
      crewToLeo++;
      continue;
    }
    src.splice(idx, 1);
    player.hand.push(id);
    if (player.rocket.activeThrusterId === id) player.rocket.activeThrusterId = null;
    if (player.rocket.activeProspectorId === id) player.rocket.activeProspectorId = null;
    returned++;
  }
  if (!returned && !crewToLeo) return fail('nothing_decommissioned');
  if (from === 'rocket') { clipTank(player.rocket); recallIfEmpty(player); }
  const parts = [];
  if (returned) parts.push(`${returned} card${returned === 1 ? '' : 's'} to hand`);
  if (crewToLeo) parts.push(`${crewToLeo} crew to LEO (Felony)`);
  let log = `${player.name} decommissioned ${parts.join(' and ')}.`;
  if (blocked) log += ` (${blocked} crew stayed - decommissioning a Human needs Anarchy.)`;
  return { ok: true, state, log };
}

// Claim Jump (Felony, G4). During Anarchy, replace an opponent's Claim (a
// success disc with no Factory) with your own, provided you have a Human at
// the Site and no OPPOSING Human/colony defends it. Free action (no op).
function applyClaimJump(state, op, player) {
  const siteId = String(op.siteId || '');
  const site = siteById(siteId);
  if (!site) return fail('unknown_site');
  if (!mayCommitFelony(state, player)) return fail('felonies_not_allowed');
  const disc = state.discs[siteId];
  if (!disc || disc.outcome !== 'success') return fail('no_claim_here');
  if (disc.ownerId === player.profileId) return fail('already_your_claim');
  if (state.factories[siteId]) return fail('claim_has_factory');
  if (!actorCrewAtSite(state, siteId, player.profileId)) return fail('felony_needs_human');
  if (opposingHumanAtSite(state, siteId, player.profileId)) return fail('claim_defended');
  const prev = state.players.find((p) => p.profileId === disc.ownerId);
  disc.ownerId = player.profileId;
  const log = `${player.name} claim-jumped ${site.name}${prev ? ` from ${prev.name}` : ''} (Felony).`;
  pushNews(state, '\u{1F5FD}', log);
  return { ok: true, state, log };
}

// Convert the rocket to an Outpost at its current site (mirror of
// browse.js#doConvertToOutpost). The whole stack + tank park as a new
// outpost in the first free slot (A-D); the rocket empties and recalls to
// LEO. Allowed anywhere in space EXCEPT LEO (at LEO, cards live in the LEO
// Stack). Turn-gated, free. op = {} (slot + site are derived from state).
const OUTPOST_LETTERS = ['A', 'B', 'C', 'D'];
function applyConvertOutpost(state, op, player) {
  if (player.rocket.stack.length === 0) return fail('empty_rocket');
  const siteId = player.rocket.siteId;
  if (rocketAtLeo(player)) return fail('rocket_at_leo');     // use the LEO Stack instead
  const taken = new Set(Object.keys(player.outposts || {}));
  const letter = OUTPOST_LETTERS.find((l) => !taken.has(l));
  if (!letter) return fail('no_outpost_slot');
  player.outposts = player.outposts || {};
  // Outposts can't store dirt fuel: a dirt tank is DESTROYED on conversion;
  // only water carries over.
  const isDirt = tankGradeOf(player.rocket) === 'dirt' && (player.rocket.tank | 0) > 0;
  const carried = isDirt ? 0 : (player.rocket.tank | 0);
  const dirtLost = isDirt ? (player.rocket.tank | 0) : 0;
  player.outposts[letter] = {
    letter,
    siteId,
    cards: player.rocket.stack.map((s) => ({ id: s.id, kind: s.kind, ...(s.face ? { face: s.face } : {}), ...(s.radSide ? { radSide: s.radSide } : {}) })),
    tank: carried,
  };
  const n = player.rocket.stack.length;
  const water = carried;
  // Empty the rocket back to LEO (same wipe as a recall).
  player.rocket.stack = [];
  player.rocket.tank = 0;
  player.rocket.tankGrade = 'water';
  player.rocket.siteId = null;
  player.rocket.activeThrusterId = null;
  player.rocket.activeProspectorId = null;
  player.rocket.route = [];
  const where = siteById(siteId);
  const whereName = (where && where.name) || siteId;
  let log = `${player.name} converted the rocket to Outpost ${letter} at ${whereName} (${n} card${n === 1 ? '' : 's'}, ${water} water).`;
  if (dirtLost) log += ` ${dirtLost} dirt fuel was destroyed (outposts can't store dirt).`;
  return { ok: true, state, log };
}

// Decommission (dissolve) an EMPTY outpost - frees the slot. Requires the
// outpost to hold no cards (pump its water out / move its cards first).
// op = { letter }.
function applyDissolveOutpost(state, op, player) {
  const letter = String(op.letter || '');
  const outpost = player.outposts && player.outposts[letter];
  if (!outpost) return fail('no_outpost');
  if (outpost.cards && outpost.cards.length > 0) return fail('outpost_not_empty');
  // Scrap rule: only when there's no usable water left. Whole units (>=1) must
  // be pumped out first so they aren't lost; a sub-1 remainder can't be
  // transferred (whole units only), so it's discardable and doesn't block.
  if ((Number(outpost.tank) || 0) >= 1) return fail('outpost_has_water');
  delete player.outposts[letter];
  return { ok: true, state, log: `${player.name} decommissioned Outpost ${letter}.` };
}

// Pump water from a colocated Outpost into the rocket tank. The rocket
// must be parked at the outpost's site. Clamped by the outpost's water and
// the rocket's remaining wet-mass room. Free, turn-gated.
// op = { letter, amount }.
function applyTransferFuel(state, op, player) {
  const letter = String(op.letter || '');
  const outpost = player.outposts && player.outposts[letter];
  if (!outpost) return fail('no_outpost');
  if (player.rocket.siteId == null || player.rocket.siteId !== outpost.siteId) {
    return fail('not_colocated');
  }
  const want = Math.floor(Number(op.amount));
  if (!Number.isFinite(want) || want <= 0) return fail('bad_amount');
  // Outposts only hold water; pumping it into a dirt rocket tank would mix
  // the grades, which is never allowed.
  if ((player.rocket.tank | 0) > 0 && tankGradeOf(player.rocket) === 'dirt') return fail('cannot_mix_fuel');
  const dry = player.rocket.stack.reduce((m, s) => m + slotMass(s), 0);
  const room = Math.max(0, TANK_MAX - dry - (player.rocket.tank | 0));
  const amt = Math.min(want, outpost.tank | 0, room);
  if (amt <= 0) {
    if (room <= 0) return fail('tank_full');
    return fail('no_water');
  }
  outpost.tank = (outpost.tank | 0) - amt;
  player.rocket.tank = (player.rocket.tank | 0) + amt;
  player.rocket.tankGrade = 'water';
  return {
    ok: true, state,
    log: `${player.name} pumped ${amt} water from Outpost ${letter} into the rocket (tank ${player.rocket.tank}).`,
  };
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

// Voluntarily fold a deployed radiator down to its LIGHT side (heavy -> light):
// less cooling, but hardier - light is the more rad-resistant side, so it can
// shrug off radiation that would degrade a heavy one. The deployed side
// otherwise LOCKS at construction; this is the one player-initiated exception
// (rad damage also flips heavy -> light, never back). One-way: a radiator
// already on light stays light. Finds the card in the player's rocket stack,
// LEO Stack, or any outpost. Free reconfiguration, turn-gated. op = { cardId }.
function applySetRadiatorSide(state, op, player) {
  const cardId = String(op.cardId || '');
  const card = PATENTS_BY_ID[cardId];
  if (!card || card.type !== 'radiator') return fail('not_a_radiator');
  let slot = (player.rocket.stack || []).find((s) => s.id === cardId)
    || (player.leo || []).find((s) => s.id === cardId);
  if (!slot && player.outposts) {
    for (const o of Object.values(player.outposts)) {
      const s = (o.cards || []).find((x) => x.id === cardId);
      if (s) { slot = s; break; }
    }
  }
  if (!slot) return fail('not_in_stack');
  if (slot.radSide === 'light') return fail('already_light');
  slot.radSide = 'light';
  return { ok: true, state, log: `${player.name} folded ${card.name} down to its light side.` };
}

// Engage afterburn (rulebook MW Afterburn). The active thruster, if it carries
// the afterburn icon, may expend its afterburn-count FUEL STEPS to gain +1 net
// thrust for the whole rocket this turn (always +1, regardless of the count),
// plus 1 Therm of rocket-wide Open-Cycle cooling (applied client-side, where
// cooling is gated). Once per turn - it lasts the turn and clears when the
// player's next turn opens (openTurnFor). Free action (no operation), turn-
// gated. op = {}.
function applyAfterburn(state, _op, player) {
  if (player.rocket.afterburnEngaged) return fail('already_afterburned');
  const tid = player.rocket.activeThrusterId;
  const slot = tid && player.rocket.stack.find((s) => s.id === tid);
  if (!slot) return fail('no_thruster');
  const f = thrusterFaceOf(slot);
  const steps = Number(f.afterburn) || 0;
  if (steps <= 0) return fail('no_afterburn');
  // Cost: walk the wet chit `steps` black connections down the fuel ladder
  // (same fuel-step model as a burn), leaving a fractional remainder.
  const dryMass = player.rocket.stack.reduce((m, s) => m + slotMass(s), 0);
  const wetMass = dryMass + (Number(player.rocket.tank) || 0);
  const stepsAvail = blackStepsBetween(dryMass, wetMass);
  if (steps > stepsAvail) {
    return fail('insufficient_water', { fuelStepsNeeded: steps, fuelStepsAvailable: stepsAvail });
  }
  player.rocket.tank = round6(walkBlackDown(wetMass, steps) - dryMass);
  player.rocket.afterburnEngaged = true;
  const card = PATENTS_BY_ID[tid];
  return {
    ok: true, state,
    log: `${player.name} engaged afterburn on ${card ? card.name : tid} (spent ${steps} fuel step${steps === 1 ? '' : 's'} for +1 net thrust + Open-Cycle cooling this turn).`,
  };
}

// Prospect a site: one seeded d6 vs the site-class threshold (success =
// roll <= threshold), placing a claim/exhausted disc. Mirrors
// browse.js#doProspect. Prospect IS the turn's operation for EVERY
// prospector kind (raygun extends the reach to a line-of-sight site, but it
// still spends the op - it is not free).
// Has the active player already prospected this turn? The undo stack holds
// this turn's functional ops (reset every turn) and a PROSPECT can't be
// undone (it rolled), so a PROSPECT entry means prospecting has begun. The
// dispatcher records the CURRENT op only after its handler returns, so this
// reads PRIOR prospects, not the one in flight.
function hasProspectedThisTurn(state) {
  return Array.isArray(state.turnActions)
    && state.turnActions.some((a) => a && a.kind === 'PROSPECT');
}

function applyProspect(state, op, player) {
  const toSiteId = String(op.siteId || '');
  const site = siteById(toSiteId);
  if (!site) return fail('unknown_site');
  const provId = player.rocket.activeProspectorId;
  const provSlot = provId && player.rocket.stack.find((s) => s.id === provId);
  if (!provSlot) return fail('no_prospector');
  const kind = prospectorKind(provSlot);
  if (!kind) return fail('no_prospector');

  // The op carries the turn it was planned for. A relayed or re-fired request
  // that lands a turn late must not apply to a different board, so reject it
  // as stale when the posted turn no longer matches the live one. (Older
  // clients that omit it simply skip the guard.)
  const curTurn = state.turn | 0;
  const curRound = state.round | 0;
  if (op.turn != null && Number(op.turn) !== curTurn) return fail('stale_turn');

  // Idempotent retry: the SAME player scanning the SAME site on the SAME turn
  // is a duplicate (a relayed or double-fired request). The claim is already
  // on the board, so return it as valid instead of erroring, and never roll a
  // second time. Empty log: the original scan already wrote the record.
  const existing = state.discs[toSiteId];
  if (existing
      && existing.ownerId === player.profileId
      && existing.turn === curTurn
      && existing.round === curRound) {
    return { ok: true, state, log: '' };
  }

  // Reach by prospector kind. Raygun fires through line of sight (the rocket's
  // own site or any site the beam reaches). A buggy on a connected body (Mars /
  // Luna / Io / Callisto / Ganymede / Europa) roads to any same-body land site,
  // acting as a raygun there. Every other missile / buggy must park on the
  // target. Both reach checks delegate to the SAME shared modules the client
  // gates on, so the server never rejects a prospect the client offered.
  const here = player.rocket.siteId;
  const buggyRoams = kind === 'buggy' && isBuggyRoamBody(siteBodyOf(here));
  if (kind === 'raygun') {
    const reachable = toSiteId === here || lineOfSightSites(here).has(toSiteId);
    if (!reachable) return fail('raygun_out_of_range');
  } else if (buggyRoams) {
    const reachable = toSiteId === here || buggyRoamSites(here).has(toSiteId);
    if (!reachable) return fail('buggy_out_of_range');
  } else if (player.rocket.siteId !== toSiteId) {
    return fail('not_at_site');
  }
  if (existing) return fail('already_prospected');
  if (prospectorIsru(provSlot) > (site.hydration | 0)) return fail('isru_too_high');

  // Prospecting is one operation to BEGIN: the first prospect of the turn
  // (any kind) spends the operation. Once begun, a raygun's line-of-sight scan
  // is free and unlimited - and a roaming buggy (on a connected body) scans the
  // same body for free too, since it acts as a raygun there. A missile, or a
  // buggy NOT on a roam body, always costs the operation (it IS the operation),
  // so once the turn's op is spent it can never fire a free additional scan.
  const begun = hasProspectedThisTurn(state);
  const free = begun && (kind === 'raygun' || buggyRoams);
  if (!free && player.opsRemaining <= 0) return fail('no_ops_left');

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
    turn: curTurn,
    round: curRound,
    // The buggy may re-roll once, this turn, by its owner.
    // Buggy may re-roll once; Blink Telescope (B612) grants a raygun the same.
    canReroll: kind === 'buggy' || (kind === 'raygun' && hasPrivilege(state, player, 'BLINK_TELESCOPE')),
  };
  if (!free) player.opsRemaining -= 1;
  const verb = success ? 'struck a claim at' : 'came up dry at';
  const tail = free ? (buggyRoams ? ' with a free buggy road scan' : ' with a free raygun scan') : '';
  let log = `${player.name} rolled ${roll} vs ${threshold} and ${verb} ${site.name}${tail}.`;
  // Taxes: a placed Claim pays every Taxes holder +1 aqua from the pool.
  if (success) {
    const tax = creditPrivilegeIncome(state, 'TAXES', 'Taxes');
    if (tax.length) log += ' ' + tax.join(' ');
  }
  return { ok: true, state, log };
}

// Buggy re-roll (rulebook: the buggy may re-roll its prospect once). The
// owner re-rolls the disc it just placed, same turn; the new roll stands.
function applyProspectReroll(state, op, player) {
  const toSiteId = String(op.siteId || '');
  const disc = state.discs[toSiteId];
  if (!disc) return fail('no_disc');
  if (disc.ownerId !== player.profileId) return fail('not_owner');
  // Buggy re-rolls; a raygun re-rolls only with Blink Telescope (B612).
  if (disc.kind !== 'buggy' && !(disc.kind === 'raygun' && hasPrivilege(state, player, 'BLINK_TELESCOPE'))) return fail('not_buggy');
  if (!disc.canReroll) return fail('already_rerolled');
  if (disc.turn !== state.turn) return fail('reroll_window_closed');
  const site = siteById(toSiteId);
  const threshold = disc.threshold;
  const gen = makeRng(state.seed, state.rng.cursor);
  const roll = gen.d6();
  state.rng.cursor = gen.cursor;
  const success = roll <= threshold;
  state.discs[toSiteId] = {
    ...disc,
    outcome: success ? 'success' : 'fail',
    roll,
    canReroll: false,
    rerolled: true,
  };
  const verb = success ? 'struck a claim at' : 'came up dry at';
  const where = (site && site.name) || toSiteId;
  let log = `${player.name} re-rolled the buggy: ${roll} vs ${threshold} and ${verb} ${where}.`;
  // Taxes fire only if the re-roll newly placed a Claim (fail -> success).
  if (success && disc.outcome !== 'success') {
    const tax = creditPrivilegeIncome(state, 'TAXES', 'Taxes');
    if (tax.length) log += ' ' + tax.join(' ');
  }
  return { ok: true, state, log };
}

// Industrialize (rulebook I7). Flip the player's claim at the parked site
// into a factory. The client (industrialize.js#findIndustrializeOptions) is the
// source of truth for the valid refinery + robonaut + support chain; the server
// trusts the chosen `cardIds` (like it trusts routes) and validates the
// essentials: parked at the site, owns the claim, no factory yet, an op to
// spend, and the chain is actually in the stack and includes a refinery + a
// robonaut. The chain is decommissioned back to the player's HAND (variant
// rule, industrialize.md). The factory inherits the site's spectral type.
function applyIndustrialize(state, op, player) {
  const siteId = String(op.siteId || '');
  const site = siteById(siteId);
  if (!site) return fail('unknown_site');
  if (player.rocket.siteId !== siteId) return fail('not_at_site');
  const disc = state.discs[siteId];
  if (!disc || disc.outcome !== 'success' || disc.ownerId !== player.profileId) return fail('not_claimed');
  if (state.factories[siteId]) return fail('already_industrialized');
  if (player.opsRemaining <= 0) return fail('no_ops_left');
  const ids = Array.isArray(op.cardIds) ? op.cardIds.map(String) : [];
  // Every id must be a non-crew card in the stack; the set must include a
  // refinery + a robonaut (the build needs both).
  let hasRefinery = false, hasRobonaut = false;
  for (const id of ids) {
    const slot = player.rocket.stack.find((s) => s.id === id && s.kind !== 'crew');
    if (!slot) return fail('not_in_stack');
    const c = PATENTS_BY_ID[id];
    if (c && c.type === 'refinery') hasRefinery = true;
    if (c && c.type === 'robonaut') hasRobonaut = true;
  }
  if (!hasRefinery || !hasRobonaut) return fail('cannot_industrialize');
  // Decommission the chain to the hand.
  for (const id of ids) {
    const idx = player.rocket.stack.findIndex((s) => s.id === id);
    if (idx >= 0) {
      player.rocket.stack.splice(idx, 1);
      player.hand.push(id);
    }
  }
  if (player.rocket.activeThrusterId && !player.rocket.stack.some((s) => s.id === player.rocket.activeThrusterId)) {
    player.rocket.activeThrusterId = null;
  }
  if (player.rocket.activeProspectorId && !player.rocket.stack.some((s) => s.id === player.rocket.activeProspectorId)) {
    player.rocket.activeProspectorId = null;
  }
  const spectral = site.spectralType || 'C';
  state.factories[siteId] = { ownerId: player.profileId, spectralType: spectral };
  player.opsRemaining -= 1;
  let log = `${player.name} industrialized ${site.name} (spectral ${spectral}); decommissioned ${ids.length} card${ids.length === 1 ? '' : 's'} to hand.`;
  // Taxes: industrializing a Claim also pays every Taxes holder +1 aqua.
  const tax = creditPrivilegeIncome(state, 'TAXES', 'Taxes');
  if (tax.length) log += ' ' + tax.join(' ');
  return { ok: true, state, log };
}

// ET Produce (rulebook): a factory turns a hand card into an installed
// (Black-Side-up) card at a colocated Outpost. op = { siteId, cardId, letter,
// isNewOutpost }. Mirrors browse.js#doEtProduce: the FACTORY does the producing,
// so the rocket need NOT be parked here (owning the factory is the presence).
// The card leaves the hand and lands face='secondary' in the outpost at the
// site (created there if new). Costs an op.
function applyEtProduce(state, op, player) {
  const siteId = String(op.siteId || '');
  const site = siteById(siteId);
  if (!site) return fail('unknown_site');
  const fac = state.factories[siteId];
  if (!fac) return fail('no_factory');
  if (fac.ownerId !== player.profileId) {
    // Factory Hijack (Felony, N6a): ET-produce at an opponent's Factory during
    // Anarchy, with your own Human colocated, unless an opposing Human or
    // colony defends it. The product still lands in YOUR outpost here.
    if (!mayCommitFelony(state, player)) return fail('not_your_factory');
    if (!actorCrewAtSite(state, siteId, player.profileId)) return fail('felony_needs_human');
    if (opposingHumanAtSite(state, siteId, player.profileId)) return fail('factory_defended');
  }
  if (player.opsRemaining <= 0) return fail('no_ops_left');
  const cardId = String(op.cardId || '');
  const hIdx = player.hand.indexOf(cardId);
  if (hIdx < 0) return fail('not_in_hand');
  const letter = String(op.letter || '');
  if (!OUTPOST_LETTERS.includes(letter)) return fail('bad_outpost');
  player.outposts = player.outposts || {};
  let outpost = player.outposts[letter];
  if (!outpost) {
    outpost = player.outposts[letter] = { letter, siteId, cards: [], tank: 0 };
  } else if (outpost.siteId !== siteId) {
    return fail('not_colocated');
  }
  player.hand.splice(hIdx, 1);
  outpost.cards.push({ id: cardId, kind: 'patent', face: 'secondary' });
  player.opsRemaining -= 1;
  const card = PATENTS_BY_ID[cardId];
  return {
    ok: true, state,
    log: `${player.name} ET-produced ${card ? card.name : cardId} (Black-Side) at ${site.name} into Outpost ${letter}.`,
  };
}

// Income (rulebook I1): spend the op to take +1 aqua from the pool into your
// bank. Mirrors browse.js#doIncomeOp.
const INCOME_AQUA = 1;
function applyIncome(state, op, player) {
  if (player.opsRemaining <= 0) return fail('no_ops_left');
  player.aqua = (player.aqua | 0) + INCOME_AQUA;
  player.opsRemaining -= 1;
  return { ok: true, state, log: `${player.name} took income (+${INCOME_AQUA} aqua; bank ${player.aqua}).` };
}

// Site refuel (rulebook I5): refine local water into the tank, one per site
// per turn, costs an op. Two sources (op.mode), both computed authoritatively:
//   isru    - the active prospector's rig: 1 + site water - ISRU rating
//             (gate ISRU <= water, so gain >= 1). Mirrors doRefuel.
//   factory - your own factory here: a flat +7. Mirrors doFactoryRefuel.
// Gain is clamped by the tank's wet-mass room; the leftover is lost.
function applySiteRefuel(state, op, player) {
  const siteId = String(op.siteId || '');
  const site = siteById(siteId);
  if (!site) return fail('unknown_site');
  if (player.rocket.siteId !== siteId) return fail('not_at_site');
  const water = Number.isFinite(site.hydration) ? site.hydration : 0;
  if (water <= 0) return fail('dry_site');
  if (player.opsRemaining <= 0) return fail('no_ops_left');
  player.refueledSites = Array.isArray(player.refueledSites) ? player.refueledSites : [];
  if (player.refueledSites.includes(siteId)) return fail('already_refueled');
  const dry = player.rocket.stack.reduce((m, s) => m + slotMass(s), 0);
  const cap = Math.max(0, TANK_MAX - dry);
  const tank = Number(player.rocket.tank) || 0;
  if (tank >= cap) return fail('tank_full');
  // Site refuel makes WATER; it can't top up a dirt tank (no mixing).
  if (tank > 0 && tankGradeOf(player.rocket) === 'dirt') return fail('cannot_mix_fuel');
  let rawGain, label;
  if (op.mode === 'factory') {
    const fac = state.factories[siteId];
    if (!fac || fac.ownerId !== player.profileId) return fail('no_factory');
    rawGain = 7;
    label = 'Factory-Refuel';
  } else {
    const provId = player.rocket.activeProspectorId;
    const slot = provId && player.rocket.stack.find((s) => s.id === provId);
    if (!slot) return fail('no_prospector');
    const isru = prospectorIsru(slot);
    if (!(isru >= 0 && isru <= water)) return fail('isru_too_high');
    rawGain = 1 + water - isru;
    label = 'ISRU Refuel';
  }
  // Dharma Refuel (ISRO): while you carry a glory chit, a colocated site
  // refuel yields double.
  if (hasPrivilege(state, player, 'DHARMA_REFUEL') && (player.glory && (player.glory.chits || []).length)) {
    rawGain *= 2;
    label += ' (Dharma x2)';
  }
  const gain = Math.min(rawGain, cap - tank);
  if (gain <= 0) return fail('tank_full');
  player.rocket.tank = round6(tank + gain);
  player.rocket.tankGrade = 'water';
  player.refueledSites.push(siteId);
  player.opsRemaining -= 1;
  return {
    ok: true, state,
    log: `${player.name}: ${label} at ${site.name} (+${round6(gain)} water; tank ${round6(player.rocket.tank)}).`,
  };
}

// Free dirt refuel (Cargo Transfer free action / moon-cable crew bonus): top
// the tank with grey dirt FTs. Loading dirt fuels the ACTIVE engine, so it's
// gated on the active thruster being a dirt thruster (a water thruster can't
// burn dirt - the same grade rule the MOVE fuel-grade gate enforces). Dirt
// can't mix with water (empty the tank first). Dirt needs NO ISRU rig.
//
// WHERE and HOW MUCH (HF4 MOONCABLE card):
//   - At a real SITE: any activated dirt thruster scoops from the ground,
//     1 tank max per turn (the general "1 tank of dirt max per Turn" throttle).
//   - At LEO / Home Bernal: there's no ground, so it takes the MOON CABLE (a
//     NASRDA crew card aboard - negotiable) to pipe dirt up. A non-crew dirt
//     thrust triangle takes up to 7 tanks this turn; the crew dirt triangle
//     (NASRDA's own) takes 1. The cable need NOT be the active thruster - it
//     just has to be in the stack, and it refuels whichever triangle is active.
// The per-turn allotment is cumulative (load it in any increments up to the
// cap) and resets each turn. Costs NO operation. op = { amount? }.
function applyDirtRefuel(state, op, player) {
  const tid = player.rocket.activeThrusterId;
  const slot = tid && player.rocket.stack.find((s) => s.id === tid);
  if (!slot) return fail('no_thruster');
  if (!faceBurnsDirt(thrusterFaceOf(slot))) return fail('not_dirt_thruster');
  const isCrew = isCrewSlot(slot);
  let perTurnMax;
  if (rocketAtLeo(player)) {
    if (!stackHasMoonCable(player.rocket)) return fail('dirt_needs_mooncable');
    perTurnMax = isCrew ? 1 : 7;
  } else {
    if (!siteById(player.rocket.siteId)) return fail('not_at_site');
    perTurnMax = 1;
  }
  const tank = Number(player.rocket.tank) || 0;
  if (tank > 0 && tankGradeOf(player.rocket) === 'water') return fail('cannot_mix_fuel');
  const loaded = Number(player.dirtTanksThisTurn) || 0;
  const allow = perTurnMax - loaded;
  if (allow <= 0) return fail('already_dirt_refueled');
  const dry = player.rocket.stack.reduce((m, s) => m + slotMass(s), 0);
  const cap = Math.max(0, TANK_MAX - dry);
  const room = cap - tank;
  if (room <= 0) return fail('tank_full');
  const want = Number(op && op.amount);
  const gain = Number.isFinite(want) && want > 0
    ? Math.min(want, allow, room)
    : Math.min(allow, room);
  if (gain <= 0) return fail('tank_full');
  player.rocket.tank = round6(tank + gain);
  player.rocket.tankGrade = 'dirt';
  player.dirtTanksThisTurn = loaded + gain;
  return {
    ok: true, state,
    log: `${player.name} loaded +${round6(gain)} dirt FT${gain === 1 ? '' : 's'} (tank ${round6(player.rocket.tank)} dirt).`,
  };
}

// Delivery (rulebook): ship a Black-Side card from one of your Factories'
// outposts back to LEO. Costs FT (water) FROM THAT OUTPOST'S tank, not the
// bank: zones-from-Earth x2, +1 if the site number is over 7. Spends the
// turn's operation. op = { siteId, letter, cardId }.
function applyDelivery(state, op, player) {
  const siteId = String(op.siteId || '');
  const letter = String(op.letter || '');
  const cardId = String(op.cardId || '');
  const site = siteById(siteId);
  if (!site) return fail('unknown_site');
  const fac = state.factories[siteId];
  if (!fac || fac.ownerId !== player.profileId) return fail('no_factory');
  if (player.opsRemaining <= 0) return fail('no_ops_left');
  const outpost = player.outposts && player.outposts[letter];
  if (!outpost || outpost.siteId !== siteId) return fail('no_outpost');
  const idx = (outpost.cards || []).findIndex((c) => c.id === cardId);
  if (idx < 0) return fail('not_in_outpost');
  const slot = outpost.cards[idx];
  if (slot.face !== 'secondary') return fail('not_black_side');
  const zones = zonesFromEarth(site.solarZone);
  const cost = zones * 2 + (nodeSizeNumber(siteId) > 7 ? 1 : 0);
  const have = Number(outpost.tank) || 0;
  if (have < cost) return fail('insufficient_outpost_water', { cost, have });
  outpost.tank = round6(have - cost);
  outpost.cards.splice(idx, 1);
  player.leo = player.leo || [];
  player.leo.push({ id: slot.id, kind: slot.kind || 'patent', face: 'secondary' });
  player.opsRemaining -= 1;
  const card = PATENTS_BY_ID[cardId];
  return {
    ok: true, state,
    log: `${player.name} delivered ${card ? card.name : cardId} from ${site.name} to LEO (cost ${cost} water from Outpost ${letter}).`,
  };
}

// Build Colony (free action): consume a Crew that is colocated with your
// Factory to found a permanent Colony there. The Colony waives the
// factory-assist hazard roll for everyone landing/lifting there and scores
// at game end. The crew is spent (it settles), not returned to hand. Costs
// NO operation. op = { cardId } (the crew to settle; defaults to the first
// crew in the stack).
function applyBuildColony(state, op, player) {
  const siteId = player.rocket.siteId;
  if (!siteId) return fail('not_at_site');
  const site = siteById(siteId);
  if (!site) return fail('unknown_site');
  const fac = state.factories[siteId];
  if (!fac || fac.ownerId !== player.profileId) return fail('no_factory');
  if (state.colonies[siteId]) return fail('already_colony');
  const cardId0 = String(op.cardId || '');
  // The colonising crew is colocated with the factory whether it's ABOARD the
  // rocket OR in an OUTPOST stack at this site (a crew cargo-transferred to
  // the outpost still counts, rulebook G3). Search the rocket first, then any
  // outpost here, honouring the requested cardId when given.
  const match = (s) => cardId0 ? (s.id === cardId0 && isCrewSlot(s)) : isCrewSlot(s);
  let slot = player.rocket.stack.find(match);
  let fromOutpost = null;
  if (!slot) {
    for (const [letter, o] of Object.entries(player.outposts || {})) {
      if (!o || o.siteId !== siteId) continue;
      const s = (o.cards || []).find(match);
      if (s) { slot = s; fromOutpost = letter; break; }
    }
  }
  if (!slot) return fail('no_crew');
  const cardId = slot.id;
  // The colonising crew leaves its stack and re-spawns in the LEO Stack (the
  // same variant rule destroyRocket + the sandbox doColonize use: crew is
  // never lost, it returns to LEO).
  if (fromOutpost) {
    const o = player.outposts[fromOutpost];
    o.cards = (o.cards || []).filter((s) => s.id !== cardId);
  } else {
    player.rocket.stack = player.rocket.stack.filter((s) => s.id !== cardId);
    if (player.rocket.activeThrusterId === cardId) player.rocket.activeThrusterId = null;
    if (player.rocket.activeProspectorId === cardId) player.rocket.activeProspectorId = null;
    clipTank(player.rocket);
  }
  player.leo = player.leo || [];
  player.leo.push({ id: cardId, kind: 'crew', face: slot.face === 'secondary' ? 'secondary' : 'primary' });
  state.colonies[siteId] = { ownerId: player.profileId };
  const crew = CREW_BY_ID[cardId];
  const crewName = crew ? ((crew.faces && crew.faces[slot.face === 'secondary' ? 'secondary' : 'primary'] || {}).name || crew.id) : cardId;
  return {
    ok: true, state,
    log: `${player.name} founded a Colony at ${site.name} (settled ${crewName}).`,
  };
}

// Ops that change the game and ride the per-turn undo stack. Each is a
// Take a card from the library into the hand. Free Library / solo: a FREE
// action at no aqua cost (op.free defaults true, op.cost defaults 0). M1's "Buy
// Card" reuses this as the turn's OPERATION - send free:false to spend one op,
// and op.cost to charge a price. Mirrors the sandbox addToHand guards (no crew,
// no expansion card, no duplicates, not currently on the rocket) and also pulls
// the card out of its shuffled deck so the library stays consistent.
function applyBuyCard(state, op, player) {
  const cardId = String(op.cardId || '');
  const card = PATENTS_BY_ID[cardId];
  if (!card) return fail('unknown_card');
  if (card.type === 'gw-thruster') return fail('expansion_card');
  if (CREW_BY_ID[cardId]) return fail('crew_card');
  if ((player.hand || []).includes(cardId)) return fail('already_in_hand');
  if ((player.rocket.stack || []).some((s) => s.id === cardId)) return fail('on_rocket');
  const free = op.free !== false;             // default: free action (no op spent)
  const cost = Math.max(0, Number(op.cost) | 0);  // default: 0 aqua
  if (!free && player.opsRemaining <= 0) return fail('no_ops_left');
  if (cost > 0 && (player.aqua | 0) < cost) return fail('cannot_pay');
  // Pull it out of its deck if present (keeps the shuffled library consistent;
  // a no-op in pure Free Library, where the deck is never drawn from).
  const deck = state.decks[card.type];
  if (deck) { const i = deck.indexOf(cardId); if (i >= 0) deck.splice(i, 1); }
  player.hand.push(cardId);
  if (cost > 0) player.aqua = (player.aqua | 0) - cost;
  if (!free) player.opsRemaining -= 1;
  const aquaTail = cost > 0 ? ` for ${cost} aqua` : '';
  const opTail = free ? '' : ' (operation)';
  return { ok: true, state, log: `${player.name} took ${card.name} from the library${aquaTail}${opTail}.` };
}

// pure (state, op, player) -> { ok, state, log } transform; the
// dispatcher (not the handler) maintains turnActions / turnRedo.
const FUNCTIONAL = {
  INCOME: applyIncome,
  SITE_REFUEL: applySiteRefuel,
  DIRT_REFUEL: applyDirtRefuel,
  DELIVERY: applyDelivery,
  BUILD_COLONY: applyBuildColony,
  MOVE: applyMove,
  BUILD_ROCKET: applyBuildRocket,
  BUY_CARD: applyBuyCard,
  BOOST: applyBoost,
  TRANSFER: applyTransfer,
  TRANSFER_FUEL: applyTransferFuel,
  DISSOLVE_OUTPOST: applyDissolveOutpost,
  DECOMMISSION: applyDecommission,
  CLAIM_JUMP: applyClaimJump,
  CONVERT_OUTPOST: applyConvertOutpost,
  REFUEL: applyRefuel,
  CASH_WATER: applyCashWater,
  DUMP: applyDump,
  FREE_MARKET: applyFreeMarket,
  DISCARD: applyDiscard,
  SET_ROUTE: applySetRoute,
  CLEAR_ROUTE: applyClearRoute,
  SET_WIRING: applySetWiring,
  SET_ACTIVE_THRUSTER: applySetActiveThruster,
  SET_ACTIVE_PROSPECTOR: applySetActiveProspector,
  SET_RADIATOR_SIDE: applySetRadiatorSide,
  AFTERBURN: applyAfterburn,
  PROSPECT: applyProspect,
  PROSPECT_REROLL: applyProspectReroll,
  INDUSTRIALIZE: applyIndustrialize,
  ET_PRODUCE: applyEtProduce,
  LOAD_GLORY: applyLoadGlory,
};

function pickPayload(op) {
  switch (op.kind) {
    case 'MOVE': return { toSiteId: op.toSiteId, hazardPay: !!op.hazardPay, segments: op.segments, pickupChit: op.pickupChit !== false };
    case 'LOAD_GLORY': return {};
    case 'BUILD_ROCKET': return { cardId: op.cardId, face: op.face, radSide: op.radSide };
    case 'BUY_CARD': return { cardId: op.cardId, free: op.free, cost: op.cost };
    case 'BOOST': return { cardIds: op.cardIds, radSides: op.radSides || {} };
    case 'TRANSFER': return { cardIds: op.cardIds, cardId: op.cardId, from: op.from, to: op.to };
    case 'TRANSFER_FUEL': return { letter: op.letter, amount: op.amount };
    case 'DISSOLVE_OUTPOST': return { letter: op.letter };
    case 'DECOMMISSION': return { cardIds: op.cardIds, cardId: op.cardId, from: op.from };
    case 'CLAIM_JUMP': return { siteId: op.siteId };
    case 'REFUEL': return { amount: op.amount };
    case 'CASH_WATER': return { amount: op.amount };
    case 'DUMP': return { amount: op.amount };
    case 'FREE_MARKET': return { cardId: op.cardId };
    case 'DISCARD': return { cardId: op.cardId };
    case 'SET_ACTIVE_THRUSTER': return { cardId: op.cardId };
    case 'SET_ACTIVE_PROSPECTOR': return { cardId: op.cardId };
    case 'SET_RADIATOR_SIDE': return { cardId: op.cardId };
    case 'AFTERBURN': return {};
    case 'PROSPECT': return { siteId: op.siteId, turn: op.turn, round: op.round };
    case 'PROSPECT_REROLL': return { siteId: op.siteId };
    case 'SITE_REFUEL': return { siteId: op.siteId, mode: op.mode };
    case 'DIRT_REFUEL': return { amount: op.amount };
    case 'DELIVERY': return { siteId: op.siteId, letter: op.letter, cardId: op.cardId };
    case 'BUILD_COLONY': return { cardId: op.cardId };
    case 'INDUSTRIALIZE': return { siteId: op.siteId, cardIds: op.cardIds };
    case 'ET_PRODUCE': return { siteId: op.siteId, cardId: op.cardId, letter: op.letter, isNewOutpost: !!op.isNewOutpost };
    // Route ops ride the undo stack like every other functional op, so
    // an UNDO/REDO replay (rebuildFromBase) must carry their payload or
    // the replay would re-run SET_ROUTE with no segments and silently
    // wipe a route the player still has planned.
    case 'SET_ROUTE': return { segments: op.segments };
    case 'SET_WIRING': return { wiring: op.wiring };
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
  let s = clone(baseState);
  s.turnActions = [];
  s.turnRedo = [];
  for (const a of actions) {
    const handler = FUNCTIONAL[a.kind];
    if (!handler) return null;
    const cursorBefore = s.rng.cursor;
    const res = handler(s, { kind: a.kind, ...a.payload }, currentPlayer(s));
    if (!res.ok) return null;
    s = res.state;
    // Re-record each replayed action onto the turn history AS we go, exactly
    // like the dispatcher does, so handlers that read turnActions during the
    // replay see the same prior actions they saw the first time. This is what
    // makes the "free after the first" economy (BOOST + the raygun PROSPECT
    // scan) replay correctly: without it every replayed boost/scan would look
    // like the turn's first and demand an operation that was already spent,
    // failing the rebuild. The caller overwrites turnActions afterward.
    s.turnActions.push({ kind: a.kind, payload: a.payload, rolled: s.rng.cursor !== cursorBefore });
  }
  return s;
}

// ----- meta ops -----

// Open a player's turn: refill their per-turn budgets and reset the
// shared undo/redo stacks (the new turn starts with a clean history;
// the prior turn is committed). Used both when a turn passes and when
// a first-player handoff lands.
function openTurnFor(state, player) {
  player.opsRemaining = OPS_PER_TURN;
  player.movesRemaining = MOVES_PER_TURN;
  player.discardsRemaining = DISCARDS_PER_TURN;
  // One refuel per site per turn: clear the per-turn ledger so the
  // sites this player tapped last turn are refuellable again.
  player.refueledSites = [];
  // Dirt refuel is capped per turn (7 tanks via the moon cable for a non-crew
  // triangle, else 1); reset the per-turn tally.
  player.dirtTanksThisTurn = 0;
  // Afterburn lasts one turn: clear it as the player's next turn opens.
  if (player.rocket) player.rocket.afterburnEngaged = false;
  state.turnActions = [];
  state.turnRedo = [];
}

function applyEndTurn(state, _op, player) {
  const n = state.players.length;
  // The first player leads each round; a "lap" is one trip around the
  // table from there, and it closes when the next seat would be the
  // first player again. Legacy games carry no firstPlayerIndex - it
  // defaults to 0, which reduces the test to the original "wrap when
  // the last seat ends", unchanged.
  const firstIdx = state.firstPlayerIndex || 0;
  const nextIndex = (state.activeIndex + 1) % n;
  const lapDone = nextIndex === firstIdx;

  let log = `${player.name} ended their turn.`;

  // Passing without spending the turn's operation defaults to Income: the
  // player banks +1 aqua rather than wasting the operation. This also
  // safety-nets a lost Income click - ending the turn always grants the
  // income if none was taken. (Mirrors the client pass-with-income path.)
  if (player.opsRemaining >= OPS_PER_TURN) {
    player.aqua = (player.aqua | 0) + INCOME_AQUA;
    player.opsRemaining -= 1;
    log = `${player.name} passed and took income (+${INCOME_AQUA} aqua; bank ${player.aqua}).`;
  }

  // No auto-load on end turn: picking up a zone's glory chit is now an
  // explicit choice (the on-arrival prompt, or the LOAD_GLORY op via the
  // site menu), so a chit the player chose to leave stays on the site.

  // Mid-lap: the turn simply passes to the next seat.
  if (!lapDone) {
    state.activeIndex = nextIndex;
    openTurnFor(state, state.players[nextIndex]);
    log += ` ${state.players[nextIndex].name} is up.`;
    return { ok: true, state, log };
  }

  // Lap complete: advance the Sunspot Cube one slot (event roll, and the
  // round counter ticks on a full 12-slot cycle). No passive factory income.
  const prevRound = state.round;
  advanceClock(state);
  const roundEnded = state.round > prevRound;

  if (!roundEnded) {
    // Still inside the round: the cube moved a slot, next lap reopens
    // from the same first player.
    log += ` Sunspot Cube advances to slot ${state.turn}.`;
    log += clockEventLog(state);
    state.activeIndex = firstIdx;
    openTurnFor(state, state.players[firstIdx]);
    return { ok: true, state, log };
  }

  // A full round (Sunspot cycle) just closed.
  log += clockEventLog(state);
  log += ` Round ${prevRound} complete.`;

  // Game-length cap: finish once the configured number of rounds has
  // been played. Legacy games get maxRounds backfilled (default 5);
  // a game with no cap at all just keeps going.
  if (state.maxRounds && state.round > state.maxRounds) {
    state.status = 'finished';
    state.finishedAt = Date.now();
    state.pendingFirstPlayer = null;
    state.turnActions = [];
    state.turnRedo = [];
    log += ` Game over after ${state.maxRounds} rounds.`;
    return { ok: true, state, log };
  }

  log += ` Round ${state.round} begins.`;

  // First-player rotation (rotation-enabled games, 2+ players): the
  // player who led the round just finished names the next first
  // player. Freeze the table on that choice - the active pointer rests
  // on the chooser and budgets are NOT refilled until the pick lands
  // (SET_FIRST_PLAYER opens the new leader's turn). Mirrors the auction
  // freeze: every other op is rejected while pendingFirstPlayer is set.
  if (state.firstPlayerRotation && n >= 2) {
    const chooser = state.players[firstIdx];
    state.activeIndex = firstIdx;
    state.pendingFirstPlayer = { chooserId: chooser.profileId };
    state.turnActions = [];
    state.turnRedo = [];
    log += ` ${chooser.name} names the next first player.`;
    return { ok: true, state, log };
  }

  // Legacy / single-player: the same first player simply leads again.
  state.activeIndex = firstIdx;
  openTurnFor(state, state.players[firstIdx]);
  return { ok: true, state, log };
}

// ----- draft-start mode -----

// The opening "draft round": each player, on their turn, takes the TOP card of
// one market deck for FREE into their hand, then the turn passes (the Sunspot
// Cube advances on a completed lap, like a normal turn minus income). The draft
// ends the instant EVERY player holds DRAFT_HAND_SIZE cards - all banks are set
// to DRAFT_END_AQUA and normal play begins from the first player. (User mode,
// 2026-06-10.)
const DRAFT_HAND_SIZE = 12;
const DRAFT_END_AQUA = 6;
function applyDraftPick(state, op, player) {
  const deckType = String(op.deckType || '');
  const deck = state.decks[deckType];
  if (!Array.isArray(deck)) return fail('bad_deck');
  if (!deck.length) return fail('deck_empty');
  if ((player.hand || []).length >= DRAFT_HAND_SIZE) return fail('draft_hand_full');
  // Take the top of the chosen deck (free) into the caller's hand.
  const cardId = deck.shift();
  player.hand = player.hand || [];
  player.hand.push(cardId);
  const card = PATENTS_BY_ID[cardId];
  const cardName = card ? card.name : cardId;

  // Draft over the moment EVERYONE holds a full hand: set banks, reset the
  // Sunspot Cube so normal play gets the full game length (the draft only used
  // the tracker cosmetically), and open the first player's normal turn.
  if (state.players.every((p) => (p.hand || []).length >= DRAFT_HAND_SIZE)) {
    state.draftPhase = 'play';
    for (const p of state.players) p.aqua = DRAFT_END_AQUA;
    state.turn = 0;
    state.round = 1;
    state.lastEvent = null;
    state.activeIndex = state.firstPlayerIndex || 0;
    openTurnFor(state, state.players[state.activeIndex]);
    return {
      ok: true, state,
      log: `${player.name} drafted ${cardName}. Draft complete - everyone holds ${DRAFT_HAND_SIZE} cards and banks open at ${DRAFT_END_AQUA} aqua. Play begins.`,
    };
  }

  // Otherwise pass the turn (cube advances on a completed lap), like END_TURN
  // minus income / first-player handoff / game-end.
  const n = state.players.length;
  const firstIdx = state.firstPlayerIndex || 0;
  const nextIndex = (state.activeIndex + 1) % n;
  let tail = '';
  if (nextIndex === firstIdx) {
    advanceClock(state);
    state.activeIndex = firstIdx;
    tail = ` Sunspot Cube advances to slot ${state.turn}.`;
  } else {
    state.activeIndex = nextIndex;
  }
  openTurnFor(state, state.players[state.activeIndex]);
  return {
    ok: true, state,
    log: `${player.name} drafted ${cardName}.${tail} ${state.players[state.activeIndex].name} is up.`,
  };
}

// A rebuild (undo/redo) reverts the WHOLE state to the active player's turn
// base, which predates any route a DIFFERENT player planned off-turn during
// this turn - so the rebuild would silently wipe those private plans. Carry
// each non-active player's CURRENT route across from the live state. The active
// player's own route is rebuilt from their turnActions (their on-turn
// SET_ROUTE), so it is left exactly as the replay produced it.
function carryOffTurnRoutes(rebuilt, live) {
  if (!rebuilt || !live || !Array.isArray(rebuilt.players)) return rebuilt;
  const activeIdx = rebuilt.activeIndex;
  for (let i = 0; i < rebuilt.players.length; i++) {
    if (i === activeIdx) continue;
    const lp = live.players && live.players[i];
    if (lp && lp.rocket && rebuilt.players[i] && rebuilt.players[i].rocket) {
      rebuilt.players[i].rocket.route = lp.rocket.route;
    }
  }
  return rebuilt;
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
  carryOffTurnRoutes(rebuilt, state);
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
  carryOffTurnRoutes(rebuilt, state);
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
// auction is a solo "win the deck top immediately" draw). Open-bid flow:
//   AUCTION_START  auctioneer spends 1 op and reserves a deck-top lot.
//   AUCTION_BID    ANY player (the auctioneer included) places or raises
//     a public standing bid. A bid must at least tie the current high
//     (>= highBid); ties are allowed. A raise (or any auctioneer bid)
//     reopens the floor (passes clear) so everyone gets another say; a
//     player may re-bid (always >= the floor) at any time.
//   AUCTION_PASS   a non-auctioneer declines to raise further; their
//     standing bid (if any) stays in the running. When every other
//     player has passed or sits at the floor, control is the
//     auctioneer's (the server nudges them to close).
//   AUCTION_SELL   auctioneer CLOSES by naming a buyer - a top bidder,
//     which may be themselves on a tie (they win ties). The buyer pays
//     their bid to the auctioneer, or to the bank if the auctioneer
//     keeps it (free when nobody bid).
// The won lot plus one card off the top of each of its support decks
// (supportBonusDecks, ported from js/game/decks.js) land in the
// winner's hand.

// supportBonusDecks port: map a card's `requires` kinds to deck types
// by supplier prefix (OR-alternatives within a prefix collapse to one
// draw); abstract kinds that aren't grounded in a deck contribute none.
const KIND_PREFIX_TO_DECK = {
  reactor: 'reactor', gen: 'generator', radiator: 'radiator',
  refinery: 'refinery', robonaut: 'robonaut', thruster: 'thruster',
  // A heat card's cooling requirement (the 🌡️ thermostat support) is
  // satisfied by a radiator, so a lot that needs cooling comes with one
  // off the radiator deck.
  thermostat: 'radiator',
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

// Recompute the public tallies from the per-player bids: the high bid
// (the floor every new bid must at least tie), a leading bidder (the
// auctioneer wins ties, so they lead whenever they sit at the floor),
// and the "auctioneer may close" hint - true once no non-auctioneer
// will raise again (all passed or already at the floor). The hint
// drives the auto-nudge + UI.
function recomputeAuction(state) {
  const a = state.auction;
  a.bids = a.bids || {};
  const entries = Object.entries(a.bids);
  let high = 0;
  for (const [, amt] of entries) if (amt > high) high = amt;
  a.highBid = high;
  // Leader = whoever sits at the high bid; the auctioneer wins ties, but
  // only if they actually placed a bid. Bids can be 0, so the leader is
  // computed whenever ANY bid exists (not just when high > 0).
  let leader = null;
  if (entries.length) {
    // Marketeer (SpaceX) wins ties even over the auctioneer: a top-bid holder
    // of the privilege takes the lead. Else the auctioneer wins ties; else the
    // first bidder at the floor.
    const mktE = entries.find(([k, amt]) =>
      amt === high && hasPrivilege(state, playerByProfile(state, Number(k)), 'MARKETEER'));
    const aucBid = a.bids[a.auctioneerId];
    if (mktE) leader = Number(mktE[0]);
    else if (aucBid != null && aucBid === high) leader = a.auctioneerId;
    else { const e = entries.find(([, amt]) => amt === high); leader = e ? Number(e[0]) : null; }
  }
  a.highBidderId = leader;
  a.awaiting = allBiddersActed(state) ? 'auctioneer' : 'bidders';
}

// A player whose hand is already at the limit can't take the lot (they
// can neither bid nor be sold to), so they're auto-passed: they never
// hold up the auctioneer and don't need to act. Their hand can't change
// mid-auction (an open lot freezes every other op), so this is stable
// for the life of the lot.
function biddingBlockedByHand(state, player) {
  if (hasPrivilege(state, player, 'SKUNKWORKS')) return false;   // ignores the limit
  return ((player.hand || []).length >= AUCTION_HAND_LIMIT);
}

// Every non-auctioneer has responded to the current floor (bid or
// passed since it last reopened) - nobody left who will raise, so the
// auctioneer may close. `acted` resets to just the actor whenever the
// floor reopens (a raise or any auctioneer bid), which is what makes an
// auctioneer tie force the others to respond again. Full-hand players
// count as already-acted (auto-passed) so they never block the close.
function allBiddersActed(state) {
  const a = state.auction;
  const acted = a.acted || [];
  const auto = a.autoPassed || [];
  const others = state.players.filter((p) => p.profileId !== a.auctioneerId);
  // Solo game: no rival bidders, so the (zero) bidders have all trivially
  // acted and the auctioneer may keep the lot unopposed right away. In any
  // 2+ player game there is always at least one other, so this never fires.
  if (!others.length) return true;
  // Auto-passed players have opted out for the rest of the lot, and
  // full-hand players can't take it - both count as already acted so
  // they never hold up the close, even after a reopen resets `acted`.
  return others.every((p) =>
    acted.includes(p.profileId) || auto.includes(p.profileId) || biddingBlockedByHand(state, p));
}

// Highest standing bid that is NOT this player's own. The auctioneer wins
// ties, so this is the least they must match to lead - and therefore the
// floor they may walk an overbid back down to.
function highestOtherBid(state, profileId) {
  const bids = (state.auction && state.auction.bids) || {};
  let hi = 0;
  for (const [pid, amt] of Object.entries(bids)) {
    if (Number(pid) !== profileId) hi = Math.max(hi, amt | 0);
  }
  return hi;
}

function applyAuctionStart(state, op, ctx) {
  if (state.auction) return fail('auction_in_progress');
  const player = currentPlayer(state);
  if (!player || player.profileId !== ctx.profileId) return fail('not_your_turn');
  // A solo game CAN auction: with no rival bidders the auctioneer keeps the lot
  // unopposed for free (see applyAuctionSell's no-bids path). Multiplayer always
  // has 2+ players, so this once-required opponent check is no longer needed.
  if (player.opsRemaining <= 0) return fail('no_ops_left');
  // Skunkworks (Shimizu) ignores the academia hand limit when starting.
  if ((player.hand || []).length >= AUCTION_HAND_LIMIT && !hasPrivilege(state, player, 'SKUNKWORKS')) return fail('hand_limit');
  const deckType = String(op.deckType || '');
  if (!DECK_TYPES.includes(deckType)) return fail('bad_deck');
  const deck = state.decks[deckType];
  if (!deck || !deck.length) return fail('deck_empty');

  const cardId = deck.shift();
  player.opsRemaining -= 1;
  state.auction = {
    deckType, cardId,
    auctioneerId: player.profileId,
    bids: {}, passed: [], acted: [], autoPassed: [],
    highBid: 0, highBidderId: null, awaiting: 'bidders',
  };
  // Opening commits prior turn actions: undo must not span an auction
  // (it moves other players' aqua / decks / hands, none of which the
  // undo replay would restore).
  state.turnActions = [];
  state.turnRedo = [];
  // Compute the phase so `awaiting` reflects full-hand auto-passes right
  // away. Without this the auctioneer's close button never enables when
  // every opponent's hand is full (no bid/pass op ever fires to recompute),
  // leaving the lot stuck. With it, a no-contest lot opens already in the
  // auctioneer's phase, so the "Keep (no bids)" button is live immediately.
  recomputeAuction(state);
  const card = PATENTS_BY_ID[cardId];
  return { ok: true, state, log: `${player.name} put ${card ? card.name : cardId} up for auction.` };
}

function applyAuctionBid(state, op, ctx) {
  const a = state.auction;
  if (!a) return fail('no_auction');
  // ANY player may bid now, the auctioneer included. A bidder can place
  // or change their standing bid at any time while the lot is open.
  const bidder = playerByProfile(state, ctx.profileId);
  if (!bidder) return fail('not_a_player');
  // Skunkworks (Shimizu) ignores the academia hand limit when bidding.
  if ((bidder.hand || []).length >= AUCTION_HAND_LIMIT && !hasPrivilege(state, bidder, 'SKUNKWORKS')) return fail('hand_limit');
  const amount = Number(op.amount);
  // Bids can be 0 (claim it free); only negatives are invalid.
  if (!Number.isInteger(amount) || amount < 0) return fail('bad_amount');

  a.bids = a.bids || {};
  const isAuctioneer = bidder.profileId === a.auctioneerId;
  const prevBid = (bidder.profileId in a.bids) ? a.bids[bidder.profileId] : null;
  // Floor: a non-auctioneer must at least tie the current high (ties are
  // allowed). The auctioneer wins ties, so their floor excludes their own
  // bid - they only need to match the top RIVAL bid to lead. That lets them
  // walk an accidental overbid back down to the real competition instead of
  // being trapped above it.
  const rivalHigh = highestOtherBid(state, bidder.profileId);
  const floorBefore = isAuctioneer ? rivalHigh : (a.highBid || 0);
  if (amount < floorBefore) return fail('bid_too_low');
  if (amount > bidder.aqua) return fail('insufficient_aqua');

  a.bids[bidder.profileId] = amount;
  a.passed = (a.passed || []).filter((id) => id !== bidder.profileId);
  // Placing a bid opts the bidder back in - it cancels both a plain pass
  // and a permanent auto-pass.
  a.autoPassed = (a.autoPassed || []).filter((id) => id !== bidder.profileId);

  // A LOWER by the auctioneer (reducing a standing overbid toward the top
  // rival) only drops the price-to-beat, so it puts nobody new on the clock:
  // everyone who already took a position goes back to acknowledged and the
  // lot stays closeable. Anyone who never responded stays pending.
  const isLower = isAuctioneer && prevBid != null && amount < prevBid;
  if (isLower) {
    const acked = state.players
      .filter((p) => p.profileId !== a.auctioneerId)
      .filter((p) => (p.profileId in a.bids)
        || (a.passed || []).includes(p.profileId)
        || (a.autoPassed || []).includes(p.profileId)
        || biddingBlockedByHand(state, p))
      .map((p) => p.profileId);
    a.acted = [a.auctioneerId, ...acked];
  } else {
    // A raise (or ANY fresh/equal auctioneer bid) reopens the floor: clear
    // the pass list and reset the responded set to just this bidder, so
    // every other player must bid or pass again (this is what makes an
    // auctioneer tie force the others to respond). A plain tie by a
    // non-auctioneer just adds them to the responded set.
    const reopen = amount > floorBefore || isAuctioneer;
    if (reopen) {
      a.passed = [];
      a.acted = [bidder.profileId];
    } else if (!(a.acted || []).includes(bidder.profileId)) {
      a.acted = [...(a.acted || []), bidder.profileId];
    }
  }
  recomputeAuction(state);
  const tie = !isLower && amount === floorBefore && floorBefore > 0;
  const verb = isLower ? 'lowered the bid to' : tie ? 'tied the bid at' : 'bid';
  return {
    ok: true, state,
    log: `${bidder.name} ${verb} ${amount} aqua.`,
  };
}

function applyAuctionPass(state, op, ctx) {
  const a = state.auction;
  if (!a) return fail('no_auction');
  // The auctioneer closes the lot, they never "pass".
  if (ctx.profileId === a.auctioneerId) return fail('auctioneer_cannot_pass');
  const passer = playerByProfile(state, ctx.profileId);
  if (!passer) return fail('not_a_player');
  // Pass = "I won't raise further" - any standing bid stays in the
  // running (the auctioneer can still sell it to them at that price).
  if (!a.passed.includes(passer.profileId)) a.passed.push(passer.profileId);
  if (!(a.acted || []).includes(passer.profileId)) {
    a.acted = [...(a.acted || []), passer.profileId];
  }
  // Permanent ("auto") pass: stay out for the rest of the lot, so an
  // auctioneer's raise (which reopens the floor and resets `acted`)
  // never puts this player back on the clock. A later bid by them
  // cancels it. Their standing bid, if any, still stands.
  if (op.permanent) {
    a.autoPassed = a.autoPassed || [];
    if (!a.autoPassed.includes(passer.profileId)) a.autoPassed.push(passer.profileId);
  }
  recomputeAuction(state);
  return {
    ok: true, state,
    log: `${passer.name} ${op.permanent ? 'auto-passed (out for this lot)' : 'passed'}.`,
  };
}

// The auctioneer CLOSES the lot by naming a buyer. The buyer must be a
// top bidder (one of the players tied at the high bid); the auctioneer
// may name themselves on a tie (they win ties), which keeps the lot and
// pays the bank. With no bids at all, only the auctioneer can be named
// (a free keep). The named buyer pays their bid; the lot + bonuses go
// to them.
function applyAuctionSell(state, op, ctx) {
  const a = state.auction;
  if (!a) return fail('no_auction');
  if (ctx.profileId !== a.auctioneerId) return fail('not_auctioneer');
  // The lot can't close until every other player has acted at the
  // current floor (bid or passed). Bidders are still on the clock until
  // then, so the auctioneer can't snatch the card - even a free keep
  // with no bids - out from under someone who hasn't responded yet.
  // AUCTION_RESET deliberately reopens the clock when the auctioneer
  // wants another round.
  if (!allBiddersActed(state)) return fail('bidders_pending');
  const auctioneer = playerByProfile(state, a.auctioneerId);
  const high = a.highBid || 0;
  const buyerId = Number(op.buyerId);
  if (!Number.isInteger(buyerId)) return fail('bad_buyer');

  // "No bids" means nobody placed one - NOT high === 0, since 0 is now a
  // valid bid. With no bids the only legal close is the auctioneer keeping
  // it free; otherwise the buyer must be a top bidder (price may be 0).
  const anyBids = Object.keys(a.bids || {}).length > 0;
  let winner;
  let price;
  if (!anyBids) {
    if (buyerId !== a.auctioneerId) return fail('no_bid_to_accept');
    winner = auctioneer;
    price = 0;
  } else {
    if (!(buyerId in a.bids) || a.bids[buyerId] !== high) return fail('not_top_bidder');
    winner = playerByProfile(state, buyerId);
    if (!winner) return fail('winner_gone');
    price = high;
  }
  if ((winner.hand || []).length >= AUCTION_HAND_LIMIT) return fail('hand_limit');
  if (winner.aqua < price) return fail('winner_cannot_pay');

  if (winner.profileId === a.auctioneerId) {
    auctioneer.aqua -= price; // keep: aqua leaves play to the bank
  } else {
    winner.aqua -= price;
    auctioneer.aqua += price;
  }
  const awarded = awardLot(state, winner);
  state.auction = null;
  const name = awarded.card ? awarded.card.name : awarded.cardId;
  let log;
  if (winner.profileId === a.auctioneerId) {
    const tail = price > 0 ? ` and paid ${price} aqua to the bank` : ' unopposed';
    log = `${auctioneer.name} kept ${name}${tail}.${bonusNote(awarded.bonusIds)}`;
  } else {
    log = `${winner.name} won ${name} for ${price} aqua, paid to ${auctioneer.name}.${bonusNote(awarded.bonusIds)}`;
  }
  return { ok: true, state, log };
}

// Auctioneer resets the bidding: clear every OTHER player's standing
// bid + pass so they must bid again (or pass), prompting them to go
// higher. The auctioneer's own bid stays as the floor. If everyone then
// passes, the auctioneer is the standing top bid and keeps the lot.
function applyAuctionReset(state, op, ctx) {
  const a = state.auction;
  if (!a) return fail('no_auction');
  if (ctx.profileId !== a.auctioneerId) return fail('not_auctioneer');
  a.bids = a.bids || {};
  for (const pid of Object.keys(a.bids)) {
    if (Number(pid) !== a.auctioneerId) delete a.bids[pid];
  }
  a.passed = [];
  a.acted = [];
  recomputeAuction(state);
  const auctioneer = playerByProfile(state, a.auctioneerId);
  return {
    ok: true, state,
    log: `${auctioneer ? auctioneer.name : 'The auctioneer'} reset the bidding - everyone must bid again or pass.`,
  };
}

const AUCTION = {
  AUCTION_START: applyAuctionStart,
  AUCTION_BID: applyAuctionBid,
  AUCTION_PASS: applyAuctionPass,
  AUCTION_RESET: applyAuctionReset,
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
  // Any crew card is a legal pick as long as no OTHER player has already
  // claimed it: each physical crew card is one player's faction, so a card
  // taken by someone else is off the board. Both faces of an unclaimed card
  // are valid (it's a single double-sided card); the player chooses which
  // face is their faction.
  if (state.players.some((p) => p !== player && p.faction && p.faction.cardId === cardId)) {
    return fail('crew_taken');
  }
  const switching = !!player.faction;
  player.faction = { cardId, face };
  // The picked crew card carries one of the six faction-band colours; that is
  // now the player's seat colour (the colour follows the crew, not the other
  // way round). Since each card is claimed by one player, seat colours stay
  // unique.
  if (card.color) player.color = card.color;
  // Replace any previous crew slot in LEO with the new pick so a
  // re-pick during the draft doesn't leave a stale crew sitting in
  // the stack. First-time pickers just get one push.
  player.leo = (player.leo || []).filter((s) => s.kind !== 'crew');
  player.leo.push({ id: cardId, kind: 'crew', face });
  // The moment every player has a faction the crew draft is done. In a
  // draft-start game the card draft comes next ('draft'); otherwise play
  // begins ('play'). Server-side, not derived client-side, so spectators +
  // future joiners agree on the phase.
  if (state.players.every((p) => !!p.faction)) {
    // Secretary General: start the game with +2 Aqua. Applied once, the moment
    // the crew draft closes (re-picks during the draft don't double it).
    for (const sg of playersWithPrivilege(state, 'SECRETARY_GENERAL')) {
      sg.aqua = (sg.aqua | 0) + 2;
    }
    if (state.draftStart) {
      state.draftPhase = 'draft';
      state.activeIndex = state.firstPlayerIndex || 0;
      openTurnFor(state, state.players[state.activeIndex]);
    } else {
      state.draftPhase = 'play';
    }
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

// ----- first-player rotation (round-end handoff) -----
//
// When a round (Sunspot cycle) closes, END_TURN sets pendingFirstPlayer
// and freezes the table; the player who led that round must name the
// next first player ("another player" - never themselves) before play
// resumes. SET_FIRST_PLAYER is the only op accepted while the handoff
// is open. Like crew/auction ops it validates its own caller (against
// pendingFirstPlayer.chooserId) rather than the active-turn guard, so
// it runs even though every other op is frozen. Only rotation-enabled
// games (2+ players) ever reach this path.
function applySetFirstPlayer(state, op, ctx) {
  const pending = state.pendingFirstPlayer;
  if (!pending) return fail('no_first_player_choice');
  if (pending.chooserId !== ctx.profileId) return fail('not_first_player_chooser');
  const targetId = String(op.profileId || '');
  const targetIdx = state.players.findIndex((p) => p.profileId === targetId);
  if (targetIdx < 0) return fail('unknown_player');
  // "another player": the first-player token must move off the chooser.
  if (state.players[targetIdx].profileId === pending.chooserId) {
    return fail('must_choose_another');
  }
  const chooser = playerByProfile(state, pending.chooserId);
  const next = state.players[targetIdx];
  state.firstPlayerIndex = targetIdx;
  state.activeIndex = targetIdx;
  state.pendingFirstPlayer = null;
  openTurnFor(state, next);
  return {
    ok: true,
    state,
    log: `${chooser ? chooser.name : 'The first player'} named ${next.name} first player.`,
  };
}

const LIFECYCLE = {
  SET_FIRST_PLAYER: applySetFirstPlayer,
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
  if (!draftDone) {
    // Card-draft phase (draft-start mode): the ONLY allowed action is a free
    // deck-top pick, taken by the active player on their turn. Everything else
    // is blocked - no moves, no other ops, no turn passing (the pick passes the
    // turn itself).
    if (prevState.draftPhase === 'draft') {
      if (op.kind !== 'DRAFT_PICK') return fail('draft_in_progress');
      if (!isPlayersTurn(prevState, ctx.profileId)) return fail('not_your_turn');
      const st = clone(prevState);
      return applyDraftPick(st, op, currentPlayer(st));
    }
    return fail('awaiting_crew_picks');
  }

  // First-player handoff: when a round closes the chooser must name the
  // next first player before anyone acts. SET_FIRST_PLAYER validates
  // its own caller (the chooser), so like auction ops it runs ahead of
  // the turn guard; while the handoff is pending every other op is
  // frozen, mirroring the auction freeze below.
  if (LIFECYCLE[op.kind]) return LIFECYCLE[op.kind](clone(prevState), op, ctx);

  // Open Sunspot event: affected players answer via EVENT_CHOICE
  // (validates its own caller; answering EARLY, off-turn, is welcome).
  // The table is NOT frozen (user decision 2026-06-12): only a player
  // who still owes a choice is blocked, and only ON THEIR OWN TURN -
  // they must settle the event before doing anything else (END_TURN
  // included, so the debt can't be dodged). A debt whose options
  // vanished (hand emptied, tied card already gone) clears itself.
  if (op.kind === 'EVENT_CHOICE') return applyEventChoice(clone(prevState), op, ctx);
  if (prevState.pendingEvent && !op.debug
      && isPlayersTurn(prevState, ctx.profileId)
      && eventDebtFor(prevState, ctx.profileId)) {
    const st0 = clone(prevState);
    if (clearStaleEventDebt(st0, ctx.profileId)) {
      // Debt evaporated (no valid options remain): let the op proceed
      // against the cleaned state.
      return applyOperation(st0, op, ctx);
    }
    return fail('awaiting_event_choice');
  }

  if (prevState.pendingFirstPlayer) return fail('awaiting_first_player');

  // Auction ops bypass the turn guard below - bids/passes are sent
  // by non-active players, and each handler validates its own caller
  // against the auction roles.
  if (AUCTION[op.kind]) return AUCTION[op.kind](clone(prevState), op, ctx);

  // Off-turn route planning. A planned route is PRIVATE (redacted from
  // opponents) and INERT (only the owner's own MOVE ever executes it), so a
  // player may set / clear THEIR OWN route while waiting for their turn. When
  // it is NOT the caller's turn, SET_ROUTE / CLEAR_ROUTE run against the CALLER
  // and skip the turn guard + the per-turn undo stack. On the caller's OWN turn
  // they fall through to the functional path below (recorded on turnActions, so
  // an in-turn undo still restores the route). An open auction still freezes
  // them, like every other op; applyUndo / applyRedo carry other players'
  // off-turn routes across a rebuild so the active player's undo never wipes
  // them.
  if ((op.kind === 'SET_ROUTE' || op.kind === 'CLEAR_ROUTE')
      && !op.debug && !isPlayersTurn(prevState, ctx.profileId)) {
    if (prevState.auction) return fail('auction_in_progress');
    const st = clone(prevState);
    const caller = playerByProfile(st, ctx.profileId);
    if (!caller) return fail('not_a_player');
    return FUNCTIONAL[op.kind](st, op, caller);
  }

  const isFunctional = !!FUNCTIONAL[op.kind];
  if (!isFunctional && !META[op.kind]) return fail('unknown_op');
  // A debug dry-run (op.debug) is READ-ONLY - the endpoint computes it on a
  // clone and never persists or broadcasts - so it skips the turn + auction
  // gates and runs against the CALLER's OWN player. Lets a player simulate
  // their own move any time, even off-turn or during an auction (it's
  // inconsequential).
  if (!op.debug) {
    // An open auction freezes every other op (MOVE / END_TURN / undo)
    // until the lot resolves.
    if (prevState.auction) return fail('auction_in_progress');
    if (!isPlayersTurn(prevState, ctx.profileId)) return fail('not_your_turn');
  }

  const state = clone(prevState);
  const player = op.debug
    ? (playerByProfile(state, ctx.profileId) || currentPlayer(state))
    : currentPlayer(state);
  if (!player) return fail('not_a_player');

  if (isFunctional) {
    const cursorBefore = state.rng.cursor;
    const res = FUNCTIONAL[op.kind](state, op, player);
    if (!res.ok) return res;
    // Glitch trigger: if this op is a trigger and the stack is glitched, roll
    // 1d6 and decommission every colocated card whose rad-hardness matches.
    // Done BEFORE autoFixGlitches so a human arriving on this same op doesn't
    // pre-empt the roll the trigger already incurred.
    if (GLITCH_TRIGGER_OPS.has(op.kind)) {
      const gl = resolveGlitchTrigger(res.state, player.profileId);
      if (gl) res.log = (res.log ? res.log + ' ' : '') + gl.log;
    }
    // Co-located humans fix glitches: any op that moved cards or ships
    // may have put a crew next to a glitched stack, so sweep after every
    // functional op and narrate any fix in the same log line.
    const fixed = autoFixGlitches(res.state);
    if (fixed.length && res.log) res.log += ' ' + fixed.join(' ');
    // A glory chit can't ride a crewless rocket: any op that left the rocket
    // without crew (decommission, colonise, a flare/glitch loss) sends its
    // carried chits home to LEO at front value. Also rescues already-stuck
    // chits retroactively on the next op.
    const homed = homeOrphanedGloryChits(res.state);
    if (homed.length && res.log) res.log += ' ' + homed.join(' ');
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

// Ops accepted over the wire. Functional + meta + auction + lifecycle + the
// draft-start pick (dispatched specially in applyOperation, so it's listed
// explicitly rather than via a group).
export const SUPPORTED_OPS = [
  ...Object.keys(FUNCTIONAL), ...Object.keys(META), ...Object.keys(AUCTION),
  ...Object.keys(CREW), ...Object.keys(LIFECYCLE), 'DRAFT_PICK', 'EVENT_CHOICE',
];
// Ops that require the caller to supply ctx.turnBaseState.
export const NEEDS_TURN_BASE = new Set(['UNDO', 'REDO']);
