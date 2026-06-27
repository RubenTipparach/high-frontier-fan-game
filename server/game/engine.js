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

import { PATENTS_BY_ID as _PATENTS_BY_ID, radiatorRadHardness } from '../../data/patents.js';
import { BERNALS_BY_ID } from '../../data/bernals.js';
// One card-lookup table for the engine: patents PLUS the M2 Bernal cards (which
// live in data/bernals.js, not PATENTS, because patents.js can't import them -
// circular). Bernals only ever ENTER play through m2-gated paths (the m2 deck +
// boosting), so a non-m2 game never queries one; the merged map is just a
// lookup, it activates nothing. Used for every PATENTS_BY_ID[id] read below.
const PATENTS_BY_ID = { ..._PATENTS_BY_ID, ...BERNALS_BY_ID };
import { resolveSupportChain } from '../../data/support-chain.js';
import { CREW_BY_ID } from '../../data/crew.js';
// Structured patent card POWERS behind each face's free-text Ability (the
// sheet carries the text; this maps it to engine flags). Shared with the
// client, same as fuel-graph / support-chain.
import {
  facePower, sumColocatedSizeRollMod, sumColocatedIsruMod, anyColocatedNanitesReroll,
} from '../../data/card-abilities.js';
// Shared fuel-strip model (same module the client uses): a burn spends fuel
// STEPS (black connections), and the water it costs is the non-linear mass
// drop, leaving a possibly-fractional remainder.
import { blackStepsBetween, walkBlackDown, rocketDryMass } from '../../data/fuel-graph.js';
import { aeroHopAllowed } from '../../data/aerobrake-direction.js';
// Endgame VP math, shared with the client live panel + game-over modal so the
// authoritative score can never drift from what players see.
import { scorePlayer, freeMarketBlackSideValue } from '../../data/endgame-scoring.js';
// Net-thrust band (weight class) + solar-zone modifiers, the same pure
// tables the client folds into rocket.js#getActiveThrusterStats. The
// engine reads them so the liftoff/landing gate uses the FINAL net thrust,
// not the printed base value.
import { weightClassForMass } from '../../data/net-thrust-track.js';
import { SOLAR_ZONE_INFO, adjacentSites } from '../../data/sites.js';
import { elevatorPairByKey, elevatorPairKey } from '../../data/space-elevators.js';
import { isFlareSheltered } from '../../data/flare-shelter.js';
import { ZONE_CHIT_VPS } from '../../data/zone-chits.js';
import {
  activeLaws, freshAssembly, ASSEMBLY_PLACES, IDEOLOGY_ORDER,
  delegatesRemaining, playerDelegatesInPlace, playerDelegatesPlaced,
  seniorityInPlace, finalVote, IDEOLOGY_BY_KEY, adjacentPlaces,
  voteWinners, seatStartingDelegate,
} from '../../data/assembly.js';
// Movement + metadata both come from the planner graph (the vendor
// mission-planner data the client also uses). siteBySlug layers the
// curated data/sites.js metadata onto a planner slug, so there is ONE
// id space across client + server. (data/graph.js is no longer used.)
import {
  siteExists as plannerSiteExists, findPath as plannerFindPath,
  leoSlug, siteBySlug as siteById, hazardKind, nodeBySlug,
  nodeSizeNumber, lineOfSightSites, siteBodyOf, buggyRoamSites,
  isSiteNode, zoneOfSlug, isAerobrakeNode, isAerobrakeLandableSite,
  neighborSlugs,
} from './planner-graph.js';
import { isBuggyRoamBody } from '../../data/buggy-roam.js';
import { makeRng } from './rng.js';
import {
  SLOTS, NEW_ROUND_SLOT, EVENT_SLOTS, DECK_TYPES, M1_DECK_TYPES, M2_DECK_TYPES, M1_AQUA_BONUS,
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
    // A radiator's mass depends on the side it deployed on (light vs heavy),
    // stored at faces.<installedFace>.{light,heavy}.mass - NOT the fixed
    // faces.*.mass, AND NOT always the PRIMARY face: a flipped radiator (its
    // black/Tier-2 tech) carries its OWN light/heavy masses. Read the INSTALLED
    // face's side block so dry/wet mass (and weight class) match the radiator's
    // actual tech + side. Mirror of rocket.js#slotMassValue.
    const f = slotFace(slot, p);
    if (p.type === 'radiator' && f) {
      const blk = f[slot.radSide === 'light' ? 'light' : 'heavy'];
      if (blk && blk.mass != null) return blk.mass | 0;
    }
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

// Mass a card adds when boosted (= its aqua cost). A radiator's deployed side
// changes its mass (light = the base, heavy is heavier), so the chosen side is
// honoured. Mirror of browse.js#boostMassOf.
function boostMass(id, radSide) {
  const card = PATENTS_BY_ID[id];
  if (card && card.type === 'radiator') {
    const f = card.faces && card.faces.primary;
    const side = radSide === 'light' ? 'light' : 'heavy';
    const blk = f && f[side];
    if (blk && blk.mass != null) return blk.mass | 0;
  }
  return slotMass({ id });
}

// Water cost per unit of delta-v for this rocket. With an active
// thruster we scale by its ISP against wet mass (ship.js#burnCost
// model: ceil(wetMass / isp) water per burn). With no thruster yet
// (fresh ship, pre-BUILD) we fall back to 1 water per burn, matching
// the single-player solo.js move cost so MOVE is exercisable now.
function perBurnCost(rocket) {
  const wetMass = rocketDryMass(rocket.stack.reduce((m, s) => m + slotMass(s), 0)) + (rocket.tank | 0);
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

// Physical component supply per player (HF4 wooden bits): 7 cubes = the factory
// limit, 7 domes = the colony limit. A player can never have more than this many
// of each in play at once. (Claim discs are NOT capped - they can exceed 9.)
// Mirrored client-side in browse.js (FACTORY_CUBES / COLONY_DOMES /
// CLAIM_DISCS); keep synced. Claim discs ARE capped (9), but at the cap a
// player may MOVE an existing disc to the new spot instead of being blocked.
const FACTORY_CUBES = 7;
const COLONY_DOMES = 7;
const CLAIM_DISCS = 9;
// Count a player's in-play factories / colonies (entries in the site-keyed map
// owned by them), for the component-supply limit.
function ownedSiteCount(map, profileId) {
  let n = 0;
  for (const k in (map || {})) if (map[k] && map[k].ownerId === profileId) n += 1;
  return n;
}
// Claim discs in play for a player = their SUCCESSFUL claims only. A busted
// prospect does not tie up a disc (the disc is spent on the roll, not parked),
// so failed discs never count toward the 9-disc supply.
function ownedClaimCount(discs, profileId) {
  let n = 0;
  for (const k in (discs || {})) {
    const d = discs[k];
    if (d && d.ownerId === profileId && d.outcome === 'success') n += 1;
  }
  return n;
}

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

// Is this an aerostat site (a floating atmospheric city)? Identified by the
// 'aerostat' marker in the site id - the 5 aerostat sites (Venus / Titan /
// Saturn / Uranus / Neptune) all carry it. Drives SCOOP aerostat-only powers.
function isAerostatSite(site) {
  return !!(site && /aerostat/i.test(String(site.id || '')));
}

// Does this player carry an Atmospheric Scoop (SCOOP power)? Carried in the
// rocket stack.
function playerHasAtmoScoop(player) {
  return !!(player && player.rocket && (player.rocket.stack || []).some((s) => {
    const pw = powerOfSlot(s);
    return pw && pw.aerostatHydration2;
  }));
}

// Effective hydration of a site for a player's prospect / refuel (subsystem 5).
// Atmospheric Scoop (SCOOP) makes an aerostat site COLOCATED with or ADJACENT
// to the scoop count as hydration 2. The scoop rides the rocket, so colocated =
// the rocket parked at the site, adjacent = parked one map edge away.
function effectiveHydration(site, player) {
  const base = Number.isFinite(site && site.hydration) ? site.hydration : 0;
  if (!isAerostatSite(site) || !playerHasAtmoScoop(player)) return base;
  const here = player.rocket.siteId;
  const near = here === site.id || adjacentSites(here).has(site.id);
  return near ? Math.max(base, 2) : base;
}

// Does this rocket carry the moon cable (a NASRDA crew card on its Mooncable
// face)? The cable is what lets dirt be piped up at LEO / Home Bernal; it need
// NOT be the active thruster - it just has to be aboard, and it refuels
// WHICHEVER dirt thrust triangle is activated (a separate non-crew dirt card
// included). Mirrors the client's stackHasMoonCable.
function stackHasMoonCable(rocket) {
  return !!(rocket && (rocket.stack || []).some(isMooncableThruster));
}

// Does the stack carry a safe-aerobrake card (a parachute generator:
// Magnetoshell Plasma Parachute / Granular Rainbow Corral)? The ability
// activates just by being ABOARD (no support-chain / operational requirement),
// and lets the whole stack ride out aerobrake hazards with no roll.
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
  // GW thrusters (M1) run on isotope (gold-bead) fuel, never water/dirt.
  const card = PATENTS_BY_ID[slot.id];
  if (card && card.type === 'gw-thruster') return 'isotope';
  return faceBurnsDirt(thrusterFaceOf(slot)) ? 'dirt' : 'water';
}
// Can a tank of grade `have` fuel an engine that needs grade `need`? A dirt
// engine burns dirt OR water; a water engine burns water only; a GW engine
// burns isotope only, and no chemical engine can burn isotope.
function fuelCompatible(need, have) {
  if (need === 'isotope') return have === 'isotope';
  if (have === 'isotope') return false;
  if (need === 'dirt') return have === 'dirt' || have === 'water';
  return have === 'water';
}

// The grade currently in the tank ('water' default; meaningless at tank 0).
function tankGradeOf(rocket) {
  if (rocket.tankGrade === 'dirt') return 'dirt';
  if (rocket.tankGrade === 'isotope') return 'isotope';   // M1 GW-thruster fuel
  return 'water';
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
  const dry = rocketDryMass(rocket.stack.reduce((m, s) => m + slotMass(s), 0));
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

// First entry into a heliocentric zone earns a glory chit (mirror of
// js/game/glory.js#awardChitForZone). LEO is the home base and never awards,
// but the rest of the Earth zone (Luna, near-Earth asteroids) does. Mutates the
// player's glory record in place.
function maybeAwardGlory(state, player, site, turn) {
  if (!site || !site.solarZone) return null;
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
// maybeAwardGlory enforces the zone / already-claimed / crew gates, so a null
// result means there is nothing here to load. LEO (home) never carries a chit.
function applyLoadGlory(state, _op, player) {
  const site = (player.rocket.siteId && !rocketAtLeo(player)) ? siteById(player.rocket.siteId) : null;
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

  // M1 Space Elevator decay (1B9f): an elevator whose BOTH ends have lost their
  // Factory collapses at the turn boundary. (No GEO pair in the current data, so
  // the GEO exception isn't needed yet.) Gated on m1 (zero-bleed).
  if (state.m1 && state.elevators) {
    for (const key of Object.keys(state.elevators)) {
      const pair = elevatorPairByKey(key);
      if (!pair) { delete state.elevators[key]; continue; }
      if (!state.factories[pair.a] && !state.factories[pair.b]) delete state.elevators[key];
    }
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
// Privileges a player has PERMANENTLY gained from a card power (POWER GIRDLE /
// IONOSAT grant Powersat). Unlike faction privileges these are NOT suspended by
// Anarchy - they're a permanent property of the player, not the crew face.
function hasGrantedPrivilege(player, key) {
  return !!(player && Array.isArray(player.grantedPrivileges) && player.grantedPrivileges.includes(key));
}
function grantPrivilege(player, key) {
  player.grantedPrivileges = Array.isArray(player.grantedPrivileges) ? player.grantedPrivileges : [];
  if (!player.grantedPrivileges.includes(key)) player.grantedPrivileges.push(key);
}
// Crew abilities borrowed through a trade behave like an owned privilege for
// their term. Like grantedPrivileges they are NOT suspended by Anarchy (they
// are a property of the player, not the live crew face).
function hasBorrowedAbility(player, key) {
  return !!(player && Array.isArray(player.borrowedAbilities)
    && player.borrowedAbilities.some((g) => g && g.ability === key));
}
// Does this player actually HOLD an ability they could grant? Their faction
// face's printed power (regardless of Anarchy - they still own the crew, it is
// only suspended for their own use) plus any permanent grants they hold.
function playerOwnsAbility(player, key) {
  if (!player || !key) return false;
  const card = player.faction && CREW_BY_ID[player.faction.cardId];
  const face = card && card.faces && card.faces[player.faction.face];
  const factionKey = face ? privKey(face.bonus) : null;
  return factionKey === key || hasGrantedPrivilege(player, key);
}
function hasPrivilege(state, player, key) {
  return privilegeOf(state, player) === key || hasGrantedPrivilege(player, key)
    || hasBorrowedAbility(player, key);
}
function playersWithPrivilege(state, key) {
  return (state.players || []).filter((p) => privilegeOf(state, p) === key
    || hasGrantedPrivilege(p, key) || hasBorrowedAbility(p, key));
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

// A card is immune to a Pad Explosion (K2c) if it is Crew, an ET / Black-Side
// card, or Promoted (its purple side): all of these read as the card's SECONDARY
// (non-white) face, plus an explicit promoted flag for safety. Only a White-Side
// card on the pad is exposed.
function padExplosionImmune(s) {
  return isCrewSlot(s) || s.face === 'secondary' || !!s.promoted;
}
// Cards exposed to a Pad Explosion: every White-Side (non-immune) card sitting
// at LEO. That is the loose LEO pile AND - when the rocket is parked at LEO - the
// rocket's OWN stack (a ship on the pad is just as exposed as loose cargo; this
// was the bug: a rocket assembled at LEO used to ride out a pad explosion). Each
// entry carries {slot, where} ('leo' | 'rocket') so the resolver decommissions
// from the stack the card actually sat in.
function exposedAtLeo(p) {
  const out = [];
  for (const s of (p.leo || [])) if (!padExplosionImmune(s)) out.push({ slot: s, where: 'leo' });
  if (rocketAtLeo(p)) {
    for (const s of ((p.rocket && p.rocket.stack) || [])) if (!padExplosionImmune(s)) out.push({ slot: s, where: 'rocket' });
  }
  return out;
}

// Apply the solar flare's toll to one player's EXPOSED stacks at the given
// flare roll. Per the Solar Flare rule, a flare hits cards in non-LEO stacks
// UNLESS shielded, and three shieldings make most stacks immune:
//   - Van Allen Shielding: cards at LEO (rocket.siteId == null) are immune.
//   - Bunker Shielding: cards on a Site are immune. That covers every outpost
//     (always built on a site) AND a rocket parked / landed at a site.
//   - Radiation belt shadow: a rocket sheltering inside a radiation space (a
//     rad-hazard node) is shielded from the flare too.
// So the ONLY thing a flare can reach in this engine is a rocket caught in deep
// space at a non-radiation transit waypoint (a lagrange / burn / hohmann node,
// isSiteNode == false, hazardKind != 'rad'). Each affected card adds its
// heliocentric-zone modifier before the
// rad-hardness check. Pushes gameplay sentences to notesArr; returns the number
// of cards affected.
function applyFlareToPlayer(state, p, flare, notesArr) {
  let touched = 0;
  const sweep = (slots, slug, where) => {
    const zone = zoneOfSlug(slug) || 'Earth';
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
  // Rocket: hit ONLY when caught in deep space (a transit waypoint that is not
  // a Site and not LEO). A rocket parked at a Site rides out the flare (Bunker
  // Shielding); a rocket at LEO is immune (Van Allen); a rocket sheltering in a
  // radiation belt - OR at a flare-sheltered node inside a belt (e.g. burn-ue3lc
  // inside Earth's belt) - rides out the flare too (the belt's own shadow
  // shields it), so a flare never reaches a ship there.
  if (p.rocket.siteId && !isSiteNode(p.rocket.siteId) && hazardKind(p.rocket.siteId) !== 'rad'
      && !isFlareSheltered(p.rocket.siteId)) {
    const before = p.rocket.stack.length;
    p.rocket.stack = sweep(p.rocket.stack, p.rocket.siteId, 'aboard the rocket');
    if (p.rocket.stack.length !== before) {
      if (!p.rocket.stack.some((s) => s.id === p.rocket.activeThrusterId)) p.rocket.activeThrusterId = null;
      if (!p.rocket.stack.some((s) => s.id === p.rocket.activeProspectorId)) p.rocket.activeProspectorId = null;
      clipTank(p.rocket);
      recallIfEmpty(p);
    }
  }
  // Outposts are always built on a Site, so Bunker Shielding makes every
  // outpost stack immune. No sweep.
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
    // event round sees exactly which cards rotated. The two M1 Terawatt decks
    // (GW thrusters + Freighters) cycle too when M1 is on, like the auction.
    const cycled = [];
    const cycleDecks = [...DECK_TYPES, ...(state.m1 ? M1_DECK_TYPES : []), ...(state.m2 ? M2_DECK_TYPES : [])];
    for (const t of cycleDecks) {
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
      const exposed = exposedAtLeo(p);
      if (!exposed.length) {
        notes.push(`Pad Explosion: nothing exposed on ${p.name}'s pad.`);
        continue;
      }
      const maxMass = Math.max(...exposed.map((e) => slotMass(e.slot)));
      const atMax = exposed.filter((e) => slotMass(e.slot) === maxMass);
      waiting.push(p.profileId);
      if (atMax.length > 1) {
        options[p.profileId] = atMax.map((e) => e.slot.id);
        notes.push(`Pad Explosion: ${p.name} must choose which mass-${maxMass} card to lose.`);
      } else {
        notes.push(`Pad Explosion: ${p.name} must confirm losing their mass-${maxMass} card.`);
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
    const exp = exposedAtLeo(player);
    valid = opts && opts.length
      ? opts.some((id) => exp.some((e) => e.slot.id === id))   // tie: a tied card still exposed (LEO pile or rocket)
      : exp.length > 0;                                        // single: something still exposed
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
    const exposed = exposedAtLeo(player);
    let entry = null;
    if (opts && opts.length) {
      // Tie: the player picks which of the tied cards to lose.
      if (!opts.includes(cardId)) return fail('not_a_tied_card');
      entry = exposed.find((e) => e.slot.id === cardId) || null;
    } else {
      // Single: re-derive the highest-mass exposed card (acknowledge).
      if (exposed.length) {
        const mm = Math.max(...exposed.map((e) => slotMass(e.slot)));
        entry = exposed.find((e) => slotMass(e.slot) === mm) || null;
      }
    }
    if (entry) {
      const lose = entry.slot.id;
      // Pad Insurance (Centrist - Pad Insurance law). Read the lost card's
      // boost cost off the slot (radiator side matters) BEFORE it leaves the pad.
      const refundAmt = boostMass(lose, entry.slot && entry.slot.radSide);
      const asm = assemblyOf(state);
      // When the Centrist law is the ACTIVE law, every player who loses cargo
      // is repaid automatically. When it is NOT active, a player who holds a
      // delegate on Centrist may LOBBY for it: pay 1 aqua and discard that
      // delegate to claim the repayment this once (standard M0 lobby cost).
      const lawActive = lawInForce(state, 'centrist');
      const hasCentristDelegate = placeCount(asm, 'centrist', player.profileId) > 0;
      let insured = false;
      let lobbied = false;
      if (lawActive) {
        insured = true;
      } else if (op.lobby && hasCentristDelegate && refundAmt >= 1 && (player.aqua | 0) >= 1) {
        player.aqua -= 1;
        setPlaceCount(asm, 'centrist', player.profileId, placeCount(asm, 'centrist', player.profileId) - 1);
        insured = true;
        lobbied = true;
      }
      const refund = insured ? refundAmt : 0;
      // Decommission from the stack the card sat in. A rocket parked at LEO loses
      // a stack card just like the loose LEO pile does; clear its active roles +
      // re-clip the tank if the lost card was carrying them.
      if (entry.where === 'rocket') {
        player.rocket.stack = (player.rocket.stack || []).filter((s) => s.id !== lose);
        if (!player.rocket.stack.some((s) => s.id === player.rocket.activeThrusterId)) player.rocket.activeThrusterId = null;
        if (!player.rocket.stack.some((s) => s.id === player.rocket.activeProspectorId)) player.rocket.activeProspectorId = null;
        clipTank(player.rocket);
        recallIfEmpty(player);
      } else {
        player.leo = (player.leo || []).filter((s) => s.id !== lose);
      }
      (player.hand = player.hand || []).push(lose);   // Decommission -> back to hand
      const fromWhere = entry.where === 'rocket' ? 'the rocket at LEO' : 'LEO';
      log = `${player.name} decommissioned ${cardNameOf(lose)} from ${fromWhere} to hand (Pad Explosion).`;
      if (refund > 0) {
        player.aqua += refund;
        log += lobbied
          ? ` Lobbied Centrist (1 aqua + a delegate) for Pad Insurance, repaid ${refund} aqua.`
          : ` Pad Insurance repaid ${refund} aqua.`;
      }
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
    const pw = powerOfSlot(s);
    return {
      id: s.id,
      type,
      supplies: (f && f.supplies) || (c && c.supplies) || [],
      requires: (f && f.requires) || (c && c.requires) || [],
      thrustMod: f ? f.thrustMod : undefined,
      fuelMod: f ? f.fuelMod : undefined,
      therms: 0,
      // Magnetocaloric Refrigerator: cools its own supports (subsystem 7).
      // (Cooling is client-gated; this keeps the descriptor parallel.)
      coolsOwnSupports: !!(pw && pw.coolsOwnSupports),
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
  const dry = rocketDryMass(rocket.stack.reduce((m, s) => m + slotMass(s), 0));
  const wet = dry + (Number(rocket.tank) || 0);
  thrust += weightClassForMass(wet).netThrust;
  // Solar-driven thrusters shift by the rocket's current zone modifier; a
  // null-solar zone (Neptune outward) kills solar thrust entirely.
  let solarDriven = faceHasSolar(f);
  if (!solarDriven) {
    // Mirror of rocket.js: the thruster runs on solar only if the generator
    // actually feeding its electric power in the RESOLVED chain is a solar
    // generator. Scanning the whole stack was the bug (an idle solar generator
    // that powers nothing flipped a thruster wired to a non-solar generator).
    const elecEdge = chain.edges.find((e) => e.from === tid && (e.kinds || []).includes('gen-electric'));
    if (elecEdge) {
      const s = rocket.stack.find((x) => x.id === elecEdge.to);
      const c = s && PATENTS_BY_ID[s.id];
      if (c) {
        const cf = slotFace(s, c);
        if (faceHasSolar(cf) && (cf.supplies || []).includes('gen-electric')) solarDriven = true;
      }
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
// thrust must exceed the site's size to lift off / land (a size-1 site needs
// net thrust >= 2). Otherwise a factory at the site can carry the maneuver
// (assist) - free if a colony is present, else a hazard roll. No factory +
// under-thrust = hard block. ONE exception: a Freighter (M1, opts.isFreighter)
// may settle onto a size-1 site under-thrust.
//   -> { ok, assist, needsRoll, size }
function maneuverGate(state, slug, thrust, opts = {}) {
  const size = nodeSizeNumber(slug);
  if (size <= 0 || thrust > size) return { ok: true, assist: false, needsRoll: false, size };
  if (size === 1 && opts.isFreighter && thrust > 0) return { ok: true, assist: false, needsRoll: false, size };
  if (!state.factories[slug]) return { ok: false, assist: false, needsRoll: false, size };
  const colony = !!state.colonies[slug];
  return { ok: true, assist: true, needsRoll: !colony, size };
}

// Liftoff hazard waiver (mirror of browse.js#liftoffColonyWaives). A
// factory that has a colony makes the launch pad safe: when the rocket
// LIFTS OFF from `from`, a skull / aerobrake hazard node on the immediate
// liftoff leg (adjacent to the launch site) is passed with no roll if a
// factory-with-colony sits on that hazard node or on a node adjacent to
// it. Liftoff only (never landing or deeper route hazards), and radiation
// zones still always roll (unwaivable, like FINAO). `from` null = LEO,
// which has no pad hazard so nothing to waive.
function liftoffColonyWaives(state, from, hazSlug) {
  if (!from) return false;
  const k = hazardKind(hazSlug);
  if (k !== 'skull' && k !== 'aero') return false;
  if (!neighborSlugs(from).includes(hazSlug)) return false;
  const around = [hazSlug, ...neighborSlugs(hazSlug)];
  return around.some((s) => state.factories[s] && state.colonies[s]);
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

// M1 Freighter movement (user spec, docs/module-m1-plan.md): the freighter is a
// SECOND mover with a simple model - 1 burn space per turn (no fuel; the sheet
// has no thrust/isp), free pivots up to the card's count, lands free on size-1
// sites (size > 1 needs factory assist), generic hazards + FINAO as normal, and
// a failed rad roll glitches the unit (a second rad fail while glitched explodes
// it).
function applyMoveFreighter(state, op, player) {
  if (!state.m1) return fail('m1_off');
  const fr = player.freighter;
  if (!fr) return fail('no_freighter');
  if (!op.debug && (player.freighterMovesRemaining | 0) <= 0) return fail('no_moves_left');
  const from = fr.siteId;                  // null = LEO
  const here = from == null ? leoSlug() : from;

  // This turn's segments (the client planner is the route source of truth, same
  // as the rocket). Fall back to a direct destination tap.
  let segs = null;
  const opSegs = Array.isArray(op.segments) ? op.segments : null;
  if (opSegs && opSegs.length) {
    segs = opSegs.map((s) => ({ from: String(s.from), to: String(s.to), burns: Math.max(0, Math.floor(Number(s.burns) || 0)) }));
  }
  let dest, thisTurnBurns, arrivals;
  if (segs && segs.length) {
    dest = segs[segs.length - 1].to;
    thisTurnBurns = segs.reduce((b, s) => b + s.burns, 0);
    arrivals = segs.map((s) => s.to);
  } else {
    const toSlug = String(op.toSiteId || '');
    if (!plannerSiteExists(toSlug)) return fail('unknown_site');
    if (toSlug === here) return fail('already_here');
    const path = plannerFindPath(from, toSlug);
    if (!path) return fail('no_route');
    dest = toSlug; thisTurnBurns = path.totalBurns; arrivals = path.path.slice(1);
  }
  if (dest === from) return fail('already_here');
  // One-way aerobrake (B7e / rule c): no traversal against the arrow.
  {
    const hopNodes = [here, ...arrivals];
    for (let i = 1; i < hopNodes.length; i++) {
      if (!aeroHopAllowed(hopNodes[i - 1], hopNodes[i])) {
        return fail('aero_wrong_way', { from: hopNodes[i - 1], to: hopNodes[i] });
      }
    }
  }
  // 1 burn space per turn (pivots are free and not counted as burns).
  if (thisTurnBurns > 1) return fail('freighter_one_burn');
  // A freighter may stop on an aerobrake corridor (user 2026-06-27); the aero
  // hazard still rolls on entry and each parked turn unless a parachute
  // generator is aboard.

  // Landing: free on a size-1 (or aerobrake-landable) site; size > 1 needs a
  // factory assist (roll, and only if a factory is present).
  const destSize = nodeSizeNumber(dest);
  const landG = (isAerobrakeLandableSite(dest) || destSize <= 1)
    ? { ok: true, needsRoll: false }
    : maneuverGate(state, dest, 0);
  if (!landG.ok) return fail('cannot_land', { siteSize: destSize, site: dest });

  // Hazards along the arrival nodes.
  const generic = [], rad = [];
  for (const slug of arrivals) {
    const k = hazardKind(slug);
    if (k === 'rad') rad.push(slug);
    else if (k === 'skull' || k === 'aero') generic.push(slug);
  }
  const rollItems = [];
  if (landG.needsRoll) rollItems.push({ slug: dest, kind: 'assist', phase: 'landing' });
  for (const slug of generic) rollItems.push({ slug, kind: hazardKind(slug) });

  if (op.debug) {
    return { ok: true, state, log: '', calc: { unit: 'freighter', dest, destSize, thisTurnBurns, glitched: !!fr.glitched, rollItems: rollItems.length, radZones: rad.length } };
  }

  // FINAO: pay aqua up front to skip the generic + assist rolls (rad always rolls).
  const wantPay = !!op.hazardPay;
  const finaoPer = hasPrivilege(state, player, 'OPEN_SOURCE_FINAO') ? 3 : HAZARD_COST_PER;
  const finaoCost = wantPay ? rollItems.length * finaoPer : 0;
  if (finaoCost > 0 && finaoCost > (player.aqua | 0)) return fail('insufficient_aqua');
  if (finaoCost > 0) player.aqua -= finaoCost;

  const gen = makeRng(state.seed, state.rng.cursor);
  const rolls = [];
  let destroyed = false;
  let haltSlug = dest;
  // Generic + assist rolls: a critical (a 1) destroys the freighter.
  if (!wantPay) {
    for (const item of rollItems) {
      const d6 = gen.d6();
      const crit = d6 === 1;
      rolls.push({ slug: item.slug, kind: item.kind, phase: item.phase, d6, crit });
      if (crit) { destroyed = true; haltSlug = item.slug; break; }
    }
  }
  // Rad rolls: a failed rad roll (a 1) glitches the freighter; a second rad fail
  // while already glitched explodes it.
  if (!destroyed) {
    for (const slug of rad) {
      const d6 = gen.d6();
      const radFail = d6 === 1;
      rolls.push({ slug, kind: 'rad', d6, fail: radFail });
      if (radFail) {
        if (fr.glitched) { destroyed = true; haltSlug = slug; break; }
        fr.glitched = true;
      }
    }
  }
  state.rng.cursor = gen.cursor;
  player.freighterMovesRemaining -= 1;
  fr.rolls = rolls;

  const nameOf = (slug) => (siteById(slug) && siteById(slug).name) || (slug === leoSlug() ? 'LEO' : slug);
  const rolled = rolls.some((r) => r.d6 != null);
  if (destroyed) {
    player.freighter = null;
    return { ok: true, state, rolled: true, log: `${player.name}'s Freighter was destroyed at ${nameOf(haltSlug)}.` };
  }
  fr.siteId = (dest === leoSlug()) ? null : dest;
  // Truncate the freighter's own planned route as it walks it (mirror the
  // rocket): drop this turn's leg, advancing later turns forward by one.
  if (Array.isArray(fr.route) && fr.route.length) {
    if (fr.route.some((s) => s.turn != null)) {
      fr.route = fr.route.filter((s) => (s.turn || 1) > 1).map((s) => ({ ...s, turn: (s.turn || 1) - 1 }));
    } else {
      const idx = fr.route.findIndex((s) => s.to === dest);
      if (idx >= 0) fr.route = fr.route.slice(idx + 1);
    }
  }
  const glitchTail = fr.glitched ? ' (glitched)' : '';
  return { ok: true, state, rolled, log: `${player.name} moved the Freighter to ${nameOf(dest)}${glitchTail}.` };
}

// M1 Mobile Factory movement (rule 1B6). Once your Freighter is PROMOTED, your
// factory cubes become Mobile Factories: each can move like the Freighter (1
// burn/turn), lifting off a Claim and landing on another. A cube is a Factory
// only while it sits on YOUR Claim disc (1B6c) - so lifting off ABANDONS the
// Factory (the Claim disc stays, so you can plug back in later) and landing on
// your own Claim re-ESTABLISHES it. Landing on an enemy Claim claim-jumps it (a
// Felony) when undefended, else the cube parks beside the Claim (not a Factory).
// Land/lift-off uses factory-assist with the cube AS the factory, Size <= 5 only
// (1B6b). A COLONY pins a Factory permanently (1B6d): no lift-off.
//
// A cube OFF a claim lives in state.mobileCubes; a cube on a claim is a normal
// state.factories entry. op.fromSiteId names the cube's current node.
function selfAssistGate(slug) {
  // Mobile-factory land/lift-off via self factory-assist: free on size <= 1,
  // an assist roll on size 2-5, impossible on size 6+ (Lander Burns, 1B6b).
  const size = nodeSizeNumber(slug);
  if (size <= 1) return { ok: true, needsRoll: false, size };
  if (size <= 5) return { ok: true, needsRoll: true, size };
  return { ok: false, needsRoll: false, size };
}

// Greek-letter fleet names (1B6): each of a player's Mobile Factory cubes carries
// a stable tag (alpha, beta, ...) so it keeps its name as it lifts off and lands.
const GREEK_TAGS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'omicron', 'pi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega'];
function nextFactoryTag(state, ownerId, existing) {
  if (existing) return existing;
  const used = new Set();
  for (const f of Object.values(state.factories || {})) if (f && f.ownerId === ownerId && f.tag) used.add(f.tag);
  for (const c of (state.mobileCubes || [])) if (c && c.ownerId === ownerId && c.tag) used.add(c.tag);
  return GREEK_TAGS.find((t) => !used.has(t)) || `f${used.size + 1}`;
}

function applyMoveFactory(state, op, player) {
  if (!state.m1) return fail('m1_off');
  const fr = player.freighter;
  // Mobility is unlocked the instant the Freighter is promoted (1B6).
  if (!fr || !(fr.promoted || fr.face === 'secondary')) return fail('freighter_not_promoted');
  const leo = leoSlug();
  const fromSlug = String(op.fromSiteId || '');
  const moveKey = `${state.round | 0}:${state.turn | 0}`;

  // Identify the cube: a Factory on a Claim (lift-off) or a cube already off a
  // claim (continue moving).
  const fac = state.factories[fromSlug];
  let cube = null, lifting = false;
  if (fac && fac.ownerId === player.profileId) {
    lifting = true;
    if (state.colonies[fromSlug]) return fail('colony_pinned');         // 1B6d
    if (!op.debug && fac.movedKey === moveKey) return fail('no_moves_left');
    const lg = selfAssistGate(fromSlug);
    if (!lg.ok) return fail('cannot_liftoff', { siteSize: lg.size, site: fromSlug });
  } else {
    const want = (fromSlug === leo || fromSlug === '') ? null : fromSlug;
    cube = (state.mobileCubes || []).find((c) => c.ownerId === player.profileId && (c.siteId == null ? want == null : c.siteId === want));
    if (!cube) return fail('no_mobile_factory_here');
    if (!op.debug && cube.movedKey === moveKey) return fail('no_moves_left');
  }

  const here = lifting ? fromSlug : (cube.siteId == null ? leo : cube.siteId);

  // This turn's segments (client planner is the route source of truth) or a
  // direct destination tap - mirror of applyMoveFreighter.
  let segs = null;
  const opSegs = Array.isArray(op.segments) ? op.segments : null;
  if (opSegs && opSegs.length) {
    segs = opSegs.map((s) => ({ from: String(s.from), to: String(s.to), burns: Math.max(0, Math.floor(Number(s.burns) || 0)) }));
  }
  let dest, thisTurnBurns, arrivals;
  if (segs && segs.length) {
    dest = segs[segs.length - 1].to;
    thisTurnBurns = segs.reduce((b, s) => b + s.burns, 0);
    arrivals = segs.map((s) => s.to);
  } else {
    const toSlug = String(op.toSiteId || '');
    if (!plannerSiteExists(toSlug)) return fail('unknown_site');
    if (toSlug === here) return fail('already_here');
    const path = plannerFindPath(here, toSlug);
    if (!path) return fail('no_route');
    dest = toSlug; thisTurnBurns = path.totalBurns; arrivals = path.path.slice(1);
  }
  if (dest === here) return fail('already_here');
  {
    const hopNodes = [here, ...arrivals];
    for (let i = 1; i < hopNodes.length; i++) {
      if (!aeroHopAllowed(hopNodes[i - 1], hopNodes[i])) return fail('aero_wrong_way', { from: hopNodes[i - 1], to: hopNodes[i] });
    }
  }
  if (thisTurnBurns > 1) return fail('factory_one_burn');
  // A mobile factory may stop on an aerobrake corridor (user 2026-06-27); the
  // aero hazard still rolls on entry and each parked turn unless a parachute
  // generator is aboard.

  // Landing self-assist gate (size <= 5).
  const landG = (isAerobrakeLandableSite(dest) || nodeSizeNumber(dest) <= 1)
    ? { ok: true, needsRoll: false }
    : selfAssistGate(dest);
  if (!landG.ok) return fail('cannot_land', { siteSize: nodeSizeNumber(dest), site: dest });

  // No two cubes / factories may share a node (the store is keyed by position).
  if (dest !== leo) {
    if (state.factories[dest] && !(lifting && dest === fromSlug)) return fail('dest_has_factory');
    if ((state.mobileCubes || []).some((c) => c !== cube && c.siteId === dest)) return fail('dest_occupied');
  }

  // Roll items: a liftoff assist (size>1 source), a landing assist, then generic
  // hazards along the arrivals. Rad rolls handled separately (rad-hardness =
  // Freighter's, same model as the freighter).
  const generic = [], rad = [];
  for (const slug of arrivals) {
    const k = hazardKind(slug);
    if (k === 'rad') rad.push(slug);
    else if (k === 'skull' || k === 'aero') generic.push(slug);
  }
  const rollItems = [];
  if (lifting) { const lg = selfAssistGate(fromSlug); if (lg.needsRoll) rollItems.push({ slug: fromSlug, kind: 'assist', phase: 'liftoff' }); }
  if (landG.needsRoll) rollItems.push({ slug: dest, kind: 'assist', phase: 'landing' });
  for (const slug of generic) rollItems.push({ slug, kind: hazardKind(slug) });

  if (op.debug) {
    return { ok: true, state, log: '', calc: { unit: 'factory', lifting, dest, destSize: nodeSizeNumber(dest), thisTurnBurns, rollItems: rollItems.length, radZones: rad.length } };
  }

  const wantPay = !!op.hazardPay;
  const finaoPer = hasPrivilege(state, player, 'OPEN_SOURCE_FINAO') ? 3 : HAZARD_COST_PER;
  const finaoCost = wantPay ? rollItems.length * finaoPer : 0;
  if (finaoCost > 0 && finaoCost > (player.aqua | 0)) return fail('insufficient_aqua');
  if (finaoCost > 0) player.aqua -= finaoCost;

  const gen = makeRng(state.seed, state.rng.cursor);
  const rolls = [];
  let destroyed = false, haltSlug = dest;
  const wasGlitched = lifting ? !!fac.glitched : !!cube.glitched;
  let glitched = wasGlitched;
  if (!wantPay) {
    for (const item of rollItems) {
      const d6 = gen.d6();
      const crit = d6 === 1;
      rolls.push({ slug: item.slug, kind: item.kind, phase: item.phase, d6, crit });
      if (crit) { destroyed = true; haltSlug = item.slug; break; }
    }
  }
  if (!destroyed) {
    for (const slug of rad) {
      const d6 = gen.d6();
      const radFail = d6 === 1;
      rolls.push({ slug, kind: 'rad', d6, fail: radFail });
      if (radFail) { if (glitched) { destroyed = true; haltSlug = slug; break; } glitched = true; }
    }
  }
  state.rng.cursor = gen.cursor;
  const rolled = rolls.some((r) => r.d6 != null);
  const nameOf = (slug) => (siteById(slug) && siteById(slug).name) || (slug === leo ? 'LEO' : slug);

  // Lift off: abandon the Factory (the Claim disc STAYS) and float the cube.
  if (lifting) {
    const spectral = fac.spectralType || 'C';
    delete state.factories[fromSlug];
    state.mobileCubeSeq = (state.mobileCubeSeq | 0) + 1;
    cube = { id: `mf${state.mobileCubeSeq}`, ownerId: player.profileId, siteId: here, spectralType: spectral, glitched: wasGlitched, tag: nextFactoryTag(state, player.profileId, fac.tag) };
    state.mobileCubes.push(cube);
  }

  if (destroyed) {
    state.mobileCubes = (state.mobileCubes || []).filter((c) => c !== cube);
    return { ok: true, state, rolled: true, log: `${player.name}'s Mobile Factory was destroyed at ${nameOf(haltSlug)}.` };
  }

  // Advance the cube.
  cube.siteId = (dest === leo) ? null : dest;
  cube.movedKey = moveKey;
  cube.glitched = glitched;

  // Landing resolution: establish on your own Claim; claim-jump an undefended
  // enemy Claim; otherwise park beside it (still a mobile cube, not a Factory).
  let tail = '';
  const here2 = cube.siteId;
  const disc = here2 != null ? state.discs[here2] : null;
  const landSite = here2 != null ? siteById(here2) : null;
  const establish = () => {
    state.mobileCubes = (state.mobileCubes || []).filter((c) => c !== cube);
    state.factories[here2] = { ownerId: player.profileId, spectralType: (landSite && landSite.spectralType) || cube.spectralType || 'C', movedKey: moveKey, tag: cube.tag };
  };
  if (disc && disc.outcome === 'success') {
    if (disc.ownerId === player.profileId) {
      establish();
      tail = ` and re-established a Factory`;
    } else if (mayCommitFelony(state, player) && !state.factories[here2] && !opposingHumanAtSite(state, here2, player.profileId)) {
      disc.ownerId = player.profileId;
      establish();
      tail = ` and claim-jumped ${landSite ? landSite.name : here2} (Felony)`;
    } else {
      tail = ` (parked beside the Claim)`;
    }
  }
  const glitchTail = cube.glitched && !tail.includes('Factory') ? ' (glitched)' : '';
  return { ok: true, state, rolled, log: `${player.name} moved a Mobile Factory to ${nameOf(dest)}${tail}${glitchTail}.` };
}

// The Mobile Factory FLEET moves with ONE action (1B6): the client plans a route
// per factory (op.moves = [{ fromSiteId, segments, hazardPay? }, ...]) and a
// single Move button fires them all. Each rides the shared applyMoveFactory; a
// move that can't go (no route, blocked) is skipped, the rest proceed.
function applyMoveFleet(state, op, player) {
  if (!state.m1) return fail('m1_off');
  const moves = Array.isArray(op.moves) ? op.moves : [];
  if (!moves.length) return fail('no_fleet_moves');
  const logs = [];
  let anyRolled = false, moved = 0;
  const skipped = [];
  for (const m of moves) {
    const res = applyMoveFactory(state, { kind: 'MOVE_FACTORY', fromSiteId: m.fromSiteId, segments: m.segments, hazardPay: m.hazardPay }, player);
    if (res && res.ok) { state = res.state; if (res.log) logs.push(res.log); anyRolled = anyRolled || !!res.rolled; moved += 1; }
    else skipped.push(res && res.error);
  }
  if (!moved) return fail(skipped[0] || 'no_fleet_move');
  return { ok: true, state, rolled: anyRolled, log: logs.join(' ') || `${player.name} moved the factory fleet.` };
}

function applyMove(state, op, player) {
  // M1: a MOVE tagged for the freighter drives the freighter unit instead of
  // the rocket (a separate mover with its own, simpler movement model).
  if (op.unit === 'freighter') return applyMoveFreighter(state, op, player);
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
  // One-way aerobrake (B7e / rule c): a route may not traverse an aerobrake
  // corridor against its arrow (you can't aerobrake to climb out of the well).
  // Check every hop in [from, ...arrivals]; corridors with no known arrow are
  // unrestricted (see data/aerobrake-direction.js).
  {
    const hopNodes = [from, ...arrivals];
    for (let i = 1; i < hopNodes.length; i++) {
      if (!aeroHopAllowed(hopNodes[i - 1], hopNodes[i])) {
        return fail('aero_wrong_way', { from: hopNodes[i - 1], to: hopNodes[i] });
      }
    }
  }
  // A rocket MAY stop on an aerobrake corridor (the 🪂 parachute space) - that
  // is the rule (user 2026-06-27). Entering one still rolls its aero hazard (the
  // node sits in `arrivals` and rolls below; a 1 destroys the ship) unless the
  // stack carries a parachute generator (stackSafeAerobrake). A stack that
  // STAYS parked on an aerobrake takes a fresh aero hazard as each later turn
  // opens too (resolved in aerobrakeParkingHazard, called from openTurnFor),
  // again waived only by a parachute generator.

  // Fuel-step model (shared with the client via data/fuel-graph.js): a burn
  // spends fuel STEPS - black connections on the ladder - NOT water 1-to-1.
  // The move is affordable iff the wet chit can walk that many black steps
  // before hitting dry mass. The water it costs is the non-linear mass drop
  // (applied when the burn commits, below), which can leave a sub-1 remainder.
  const perBurn = thrusterFuelPerBurn(player.rocket);            // fuel steps per burn
  const dryMass = rocketDryMass(player.rocket.stack.reduce((mm, s) => mm + slotMass(s), 0));
  const wetMass = dryMass + (Number(player.rocket.tank) || 0);
  // Mag Sail bonus burns: each Radiation Belt entered this turn is a FREE burn
  // (the sail rides the belt's field for thrust, like a flyby bonus spot), so
  // it cancels one burn's fuel cost. Only when the ACTIVE thruster is the Mag
  // Sail. Applied server-side (authoritative); charging fewer steps than the
  // client computed can never cause a false rejection. NOTE: the client planner
  // does not yet offer the extended bonus range - follow-up.
  const activeThrusterSlot = player.rocket.stack.find((s) => s.id === player.rocket.activeThrusterId);
  const activePower = activeThrusterSlot ? powerOfSlot(activeThrusterSlot) : null;
  const beltsEntered = arrivals.filter((a) => hazardKind(a) === 'rad').length;
  const bonusBurns = (activePower && activePower.bonusBurnPerBelt) ? beltsEntered : 0;
  const paidBurns = Math.max(0, thisTurnBurns - bonusBurns);
  const stepsNeeded = Math.ceil(perBurn * paidBurns);
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
    ...(bonusBurns ? { bonusBurns, paidBurns } : {}),
    fuelStepsNeeded: stepsNeeded,
    enough: stepsNeeded <= stepsAvail,
  };
  // Fuel-grade gate: a dirt thruster burns dirt OR water; a water thruster
  // burns water only; a GW thruster (M1) burns isotope only, and no chemical
  // thruster can burn isotope. An incompatible tank fails clearly (the fuel is
  // there, just wrong grade). Tank never mixes grades.
  if (stepsNeeded > 0 && (Number(player.rocket.tank) || 0) > 0) {
    const need = activeFuelGrade(player.rocket);
    const have = tankGradeOf(player.rocket);
    if (!fuelCompatible(need, have)) return fail('wrong_fuel_grade', { need, have });
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
  // Aerobrake landing: a destination that sits next to an aerobrake corridor
  // (the 🪂 symbol) can be reached by parachute - no thrust-to-land
  // requirement, no factory needed. Liftoff is never aerobraked (you can't
  // parachute UP), so only the landing gate is waived. The aero hazard roll
  // (above, for corridor nodes actually crossed this turn) is the descent risk.
  const landG = isAerobrakeLandableSite(dest)
    ? { ok: true, assist: false, needsRoll: false }
    : maneuverGate(state, dest, thrust);
  if (!landG.ok) return fail('cannot_land', { thrust, siteSize: landG.size, site: dest });
  // Ordered roll items: liftoff assist, route generics (skull/aero), then
  // landing assist. Each is aqua-payable (FINAO) or a d6 where a 1 is a
  // critical that destroys the ship.
  const rollItems = [];
  const safeAero = stackSafeAerobrake(player.rocket);
  const safeAeroSlugs = [];     // aero hazards the parachute waived (for playback)
  const colonyWaivedSlugs = []; // liftoff hazards a colony pad waived (for playback)
  if (liftG.needsRoll) rollItems.push({ slug: from, kind: 'assist', phase: 'liftoff' });
  for (const slug of generic) {
    const k = hazardKind(slug);
    // A safe-aerobrake card (parachute generator) carries the stack through
    // aerobrake hazards with no roll; skull hazards still roll.
    if (k === 'aero' && safeAero) { safeAeroSlugs.push(slug); continue; }
    // A factory-with-colony makes the launch pad safe: liftoff-leg skull /
    // aero hazards adjacent to the colony pass with no roll.
    if (liftoffColonyWaives(state, from, slug)) { colonyWaivedSlugs.push(slug); continue; }
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
  for (const slug of colonyWaivedSlugs) rolls.push({ slug, kind: hazardKind(slug), safe: true });

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

  // Project Valkyrie purge (subsystem 6): firing a thruster powered by a
  // Valkyrie reactor irradiates the stack - decommission colocated cards with
  // rad-hardness below its threshold. Fires on the burn (this move) only when
  // Valkyrie is actually in the active thruster's support chain. Self-limiting:
  // once the low-rad cards are gone, later moves find nothing.
  const valkyriePurged = [];
  if (!destroyed && player.rocket.activeThrusterId) {
    const vchain = resolveSupportChain({
      cards: chainCardsFromRocket(player.rocket),
      activeId: player.rocket.activeThrusterId,
      wiring: player.rocket.wiring || {},
    });
    let purgeBelow = 0;
    for (const cid of vchain.order) {
      const s = player.rocket.stack.find((x) => x.id === cid);
      const pw = s && powerOfSlot(s);
      if (pw && pw.purgeOnActivateRadHardBelow) purgeBelow = Math.max(purgeBelow, pw.purgeOnActivateRadHardBelow);
      // Li / Thermochemical Heatsink Fountain (subsystem 7): a heavy heatsink
      // radiator that COOLED the chain this burn switches to its light side
      // after its first use.
      if (pw && pw.switchToLightAfterUse && s && s.radSide !== 'light') s.radSide = 'light';
    }
    if (purgeBelow > 0) {
      const kept = [];
      for (const slot of player.rocket.stack) {
        if (slotRadHardness(slot) < purgeBelow) {
          valkyriePurged.push(cardNameOf(slot.id));
          if (isCrewSlot(slot)) (player.leo = player.leo || []).push({ id: slot.id, kind: 'crew', face: slot.face });
          else player.hand.push(slot.id);
        } else {
          kept.push(slot);
        }
      }
      if (valkyriePurged.length) {
        player.rocket.stack = kept;
        if (player.rocket.activeThrusterId && !kept.some((s) => s.id === player.rocket.activeThrusterId)) player.rocket.activeThrusterId = null;
        if (player.rocket.activeProspectorId && !kept.some((s) => s.id === player.rocket.activeProspectorId)) player.rocket.activeProspectorId = null;
        clipTank(player.rocket);
      }
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
  const chit = (destSite && op.pickupChit !== false && dest !== leoSlug())
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
  if (valkyriePurged.length) log += ` Project Valkyrie irradiated the stack: ${valkyriePurged.join(', ')} decommissioned (rad-hard < 4).`;
  if (bonusBurns) log += ` Mag Sail rode ${bonusBurns} radiation belt${bonusBurns === 1 ? '' : 's'} for a free burn each.`;
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
  // GW thrusters boost onto the rocket only in an M1 game (off = expansion-
  // locked). Freighters NEVER boost onto the rocket - they are a separate
  // big-cube unit (deployed by their own op in a later slice).
  if (card.type === 'gw-thruster' && !state.m1) return fail('expansion_card');
  if (card.type === 'freighter') return fail('freighter_not_stackable');

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
  // GW thrusters and Freighters can't be boosted (1A5d): they return to play
  // only by ET Production, not by boosting White-Side cards from hand.
  for (const id of ids) {
    const c = PATENTS_BY_ID[id];
    if (c && (c.type === 'gw-thruster' || c.type === 'freighter')) return fail('not_boostable');
  }
  // A boosted Bernal card ESTABLISHES a colony stack (it comes into play when
  // boosted - user 2026-06-27) instead of landing in LEO. Max TWO Bernals per
  // player (1st = Kalpana figure, 2nd = Stanford); reject a boost that would
  // exceed that. Only reachable when m2 (Bernals only reach a hand via the m2
  // deck), but gate defensively.
  const bernalIds = ids.filter((id) => { const c = PATENTS_BY_ID[id]; return !!(c && c.type === 'bernal'); });
  if (bernalIds.length && !state.m2) return fail('m2_off');
  if ((player.bernals || []).length + bernalIds.length > 2) return fail('bernal_limit');
  // Cost = total mass of the boosted cards (aqua). A radiator's mass depends on
  // its chosen deployed side (heavy is heavier), so factor that in per id.
  const radSides = (op.radSides && typeof op.radSides === 'object') ? op.radSides : {};
  let cost = 0;
  // Default to the light side (matches the slot assignment below) so the
  // charge and the locked side never disagree.
  for (const id of ids) cost += boostMass(id, radSides[id] === 'heavy' ? 'heavy' : 'light');
  if (cost > player.aqua) return fail('insufficient_aqua');
  // Move them hand -> LEO (or, for a Bernal, hand -> a new colony stack). A
  // radiator locks its deployed light/heavy side here (op.radSides[id]); default
  // light (lighter, cheapest to boost). Only radiation damage flips it afterward.
  player.bernals = player.bernals || [];
  for (const id of ids) {
    const idx = player.hand.indexOf(id);
    if (idx >= 0) player.hand.splice(idx, 1);
    const card = PATENTS_BY_ID[id];
    if (state.m2 && card && card.type === 'bernal') {
      // 1st Bernal is a Kalpana, 2nd a Stanford. Established at LEO (siteId null).
      const figure = player.bernals.length === 0 ? 'kalpana' : 'stanford';
      player.bernals.push({
        cardId: id, figure, face: 'primary', promoted: false,
        siteId: null, stack: [], tank: 0, wiring: {}, route: [],
      });
      continue;
    }
    const slot = { id, kind: 'patent' };
    if (card && card.type === 'radiator') {
      slot.radSide = radSides[id] === 'heavy' ? 'heavy' : 'light';
    }
    player.leo.push(slot);
  }
  player.aqua -= cost;
  if (!free) player.opsRemaining -= 1;
  const nLeo = ids.length - bernalIds.length;
  const tail = free ? ' (continued boost, no operation)' : '';
  let log;
  if (bernalIds.length) {
    const leoTail = nLeo ? ` and boosted ${nLeo} card${nLeo === 1 ? '' : 's'} to LEO` : '';
    log = `${player.name} established ${bernalIds.length} Bernal${bernalIds.length === 1 ? '' : 's'}${leoTail} for ${cost} aqua${tail}.`;
  } else {
    const n = ids.length;
    log = `${player.name} boosted ${n} card${n === 1 ? '' : 's'} to LEO for ${cost} aqua${tail}.`;
  }
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
const FREE_TRADE_AQUA = 5;   // Freedom (Free Trade Act): 2 cards for 5
function applyFreeMarket(state, op, player) {
  if (player.opsRemaining <= 0) return fail('no_ops_left');
  // (I3b) Sell a BLACK-SIDE card from the LEO Stack: it returns to your Hand
  // and you receive the Exploitation Track stock price for its Spectral Type
  // (8 / 5 / 4 by the GLOBAL count of that spectral's factories, or 10 when no
  // factory of the type exists anywhere). Costs the operation.
  if (op.leoCardId) {
    const id = String(op.leoCardId);
    player.leo = Array.isArray(player.leo) ? player.leo : [];
    const i = player.leo.findIndex((s) => s && s.id === id);
    if (i < 0) return fail('not_in_leo');
    const slot = player.leo[i];
    // Only manufactured goods (a card flipped to its Black/secondary face) sell
    // here; crew faces aren't goods, and Purple-Side (promoted) cards can't be
    // sold on the free market (1A5d / 2A3e).
    if (slot.kind === 'crew') return fail('not_black_side');
    if (slot.face !== 'secondary') return fail('not_black_side');
    if (slot.promoted) return fail('purple_no_sell');
    const card = PATENTS_BY_ID[id];
    if (!card) return fail('unknown_card');
    const spectral = card.spectralType || 'C';
    let globalCount = 0;
    for (const f of Object.values(state.factories || {})) {
      if ((f.spectralType || 'C') === spectral) globalCount += 1;
    }
    const value = freeMarketBlackSideValue(globalCount);
    player.leo.splice(i, 1);
    player.hand = Array.isArray(player.hand) ? player.hand : [];
    player.hand.push(id);              // the card returns to hand (White-Side)
    player.aqua += value;
    player.opsRemaining -= 1;
    return {
      ok: true, state,
      log: `${player.name} sold ${card.name} (Black-Side ${spectral}) on the Free Market for +${value} aqua; the card returns to hand.`,
    };
  }
  // Base: sell ONE hand card for FREE_MARKET_AQUA. Freedom (Free Trade Act): a
  // player who can use the law may sell TWO cards for FREE_TRADE_AQUA total.
  const ids = (Array.isArray(op.cardIds) && op.cardIds.length)
    ? op.cardIds.map(String)
    : (op.cardId ? [String(op.cardId)] : []);
  if (!ids.length) return fail('no_card');
  if (ids.length > 2) return fail('too_many_cards');
  if (ids.length === 2 && !playerCanUseLaw(state, player, 'freedom')) return fail('needs_freedom_law');
  // Validate every card is present (handling a duplicate id twice) before any
  // mutation, so a bad second card can't half-apply the sale.
  const remaining = [...player.hand];
  const cards = [];
  for (const id of ids) {
    const i = remaining.indexOf(id);
    if (i < 0) return fail('not_in_hand');
    remaining.splice(i, 1);
    const card = PATENTS_BY_ID[id];
    if (!card) return fail('unknown_card');
    cards.push(card);
  }
  for (const id of ids) {
    player.hand.splice(player.hand.indexOf(id), 1);
    const card = PATENTS_BY_ID[id];
    const deck = state.decks[card.type];
    if (Array.isArray(deck)) deck.push(id);   // back to the BOTTOM of its deck
  }
  const gain = (ids.length === 2) ? FREE_TRADE_AQUA : FREE_MARKET_AQUA;
  player.aqua += gain;
  player.opsRemaining -= 1;
  const names = cards.map((c) => c.name).join(' + ');
  const tag = (ids.length === 2) ? ', Free Trade Act' : '';
  return {
    ok: true, state,
    log: `${player.name} sold ${names} for +${gain} aqua (Free Market${tag}).`,
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
  const dry = rocketDryMass(player.rocket.stack.reduce((m, s) => m + slotMass(s), 0));
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
// op = { segments: [{ from, to, burns }, ...], unit?: 'rocket' | 'freighter' }.
// Each vehicle keeps its OWN secret route (rocket.route, freighter.route) so a
// freighter plan never overwrites the rocket's and vice versa.
function routeHolderForUnit(player, unit) {
  if (unit === 'freighter') return player.freighter || null;
  return player.rocket;
}
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
  const holder = routeHolderForUnit(player, op.unit);
  if (!holder) return fail('no_freighter');   // a freighter route with no freighter
  holder.route = norm;
  return { ok: true, state, log: '' };  // empty log: routes are secret
}

function applyClearRoute(state, op, player) {
  const holder = routeHolderForUnit(player, op.unit);
  if (holder) holder.route = [];
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
  if (id === 'freighter') return player.freighter ? (player.freighter.stack = player.freighter.stack || []) : null;
  if (id && id.startsWith('outpost')) {
    const op = player.outposts && player.outposts[id.slice('outpost'.length)];
    return op ? op.cards : null;
  }
  return null;
}

// Cargo capacity of a player's freighter unit (the installed face's loadLimit).
// 0 (no spare room) when there is no freighter.
function freighterLoadLimit(player) {
  if (!player.freighter) return 0;
  const card = PATENTS_BY_ID[player.freighter.cardId];
  if (!card) return 0;
  const face = player.freighter.face === 'primary' ? 'primary' : 'secondary';
  const fd = card.faces && card.faces[face];
  if (fd && fd.loadLimit != null) return fd.loadLimit | 0;
  return (card.loadLimit | 0) || 0;
}
// Some freighters carry the "Factory Loading Only" flag: they can only take on
// cargo while parked at a Factory (rule 1B). Reads the same installed face
// freighterLoadLimit does.
function freighterFactoryOnly(player) {
  if (!player.freighter) return false;
  const card = PATENTS_BY_ID[player.freighter.cardId];
  if (!card) return false;
  const face = player.freighter.face === 'primary' ? 'primary' : 'secondary';
  const fd = card.faces && card.faces[face];
  if (fd && fd.factoryOnly != null) return !!fd.factoryOnly;
  return !!card.factoryOnly;
}
// A BUILT Space Elevator joins its two ends into ONE location for cargo transfer
// (rule 1B9): cards (and water FTs) move between the ends as if colocated. It is
// NOT a mover and NOT on the routing graph - it only relaxes the colocation gate.
// M1-gated; a pair is only "joined" once it exists in state.elevators.
//
// M2 STUB (not implemented - not available in M1): the special GEO elevator
// (burn-geo, the `geo:true` pair) colocates the burn-geo node with the player's
// HAND, but ONLY when that player has anchored the GEO Elevator Bernal. That is
// an M2 mechanic (anchoring + Bernals), so it is intentionally left unbuilt here
// and must gate on state.m2 when it lands. GEO pairs are never put in
// state.elevators, so this helper never treats them as colocated today.
function elevatorColocated(state, a, b) {
  return !!(state.m1 && a && b && a !== b && state.elevators && state.elevators[elevatorPairKey(a, b)]);
}
function applyTransfer(state, op, player) {
  let to = op.to;
  let from = op.from;
  // Legacy shorthand: only `to` (rocket|leo) given -> the other is `from`.
  if (!from && (to === 'rocket' || to === 'leo')) from = (to === 'rocket' ? 'leo' : 'rocket');
  if (!from || !to || from === to) return fail('bad_transfer');
  const validEndpoint = (ep) => ep === 'leo' || ep === 'rocket' || ep === 'freighter'
    || (typeof ep === 'string' && ep.startsWith('outpost') && ['A', 'B', 'C', 'D'].includes(ep.slice('outpost'.length)));
  if (!validEndpoint(from) || !validEndpoint(to)) return fail('bad_transfer');
  // A freighter endpoint needs the unit in play.
  if ((from === 'freighter' || to === 'freighter') && !player.freighter) return fail('no_freighter');

  const ids = Array.isArray(op.cardIds)
    ? op.cardIds.map(String)
    : (op.cardId != null ? [String(op.cardId)] : []);
  if (!ids.length) return fail('bad_transfer');

  // Both stacks must exist (an outpost endpoint must be built).
  const outpostOf = (ep) => player.outposts && player.outposts[ep.slice('outpost'.length)];
  if (from.startsWith('outpost') && !outpostOf(from)) return fail('no_outpost');
  if (to.startsWith('outpost') && !outpostOf(to)) return fail('no_outpost');

  // Colocation: cards move between two stacks at the SAME location. LEO is the
  // null site; the rocket sits at its siteId (null = LEO); an outpost at its
  // siteId. Any colocated pair works (outpost <-> outpost, LEO <-> rocket,
  // outpost <-> rocket, ...), not just rocket-involving moves.
  const siteOf = (ep) => {
    if (ep === 'leo') return null;
    if (ep === 'rocket') return player.rocket.siteId == null ? null : player.rocket.siteId;
    if (ep === 'freighter') return player.freighter.siteId == null ? null : player.freighter.siteId;
    return outpostOf(ep).siteId;
  };
  const rocketEmpty = player.rocket.stack.length === 0;
  const involvesRocket = from === 'rocket' || to === 'rocket';
  if (involvesRocket && rocketEmpty) {
    // An empty rocket forms at the OTHER endpoint's location.
    const other = from === 'rocket' ? to : from;
    player.rocket.siteId = siteOf(other);
  } else if (siteOf(from) !== siteOf(to)
      && !elevatorColocated(state, siteOf(from), siteOf(to))) {
    return fail('not_colocated');
  }

  const srcArr = stackArrayOf(player, from);
  const dstArr = stackArrayOf(player, to);
  if (!srcArr || !dstArr) return fail('bad_transfer');
  for (const id of ids) {
    if (!srcArr.some((s) => s.id === id)) return fail('not_in_source');
  }
  // Freighter cargo can't exceed the unit's load limit (cards already aboard
  // that are being moved out don't count against the incoming room).
  if (to === 'freighter') {
    const aboard = dstArr.length - ids.filter((id) => dstArr.some((s) => s.id === id)).length;
    if (aboard + ids.length > freighterLoadLimit(player)) return fail('load_limit');
    // Factory-Loading-Only freighters can only take on cargo at a Factory (1B):
    // the freighter's site must hold a factory.
    if (freighterFactoryOnly(player)) {
      const frSite = player.freighter.siteId;
      if (!(frSite && state.factories && state.factories[frSite])) return fail('factory_only');
    }
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
    : to === 'leo' ? 'the LEO Stack'
    : to === 'freighter' ? 'the Freighter'
    : `Outpost ${to.slice('outpost'.length)}`;
  return { ok: true, state, log: `${player.name} moved ${label} to ${dstName}.` };
}

// The map-node a colocatable stack endpoint sits on (null = LEO). Mirrors the
// local siteOf in applyTransfer, lifted to module scope so the vehicle
// stow/deploy ops below can reuse it. Returns undefined for a non-existent
// endpoint (an unbuilt outpost / absent freighter).
function stackEndpointSite(player, ep) {
  if (ep === 'leo') return null;
  if (ep === 'rocket') return player.rocket.siteId == null ? null : player.rocket.siteId;
  if (ep === 'freighter') return (player.freighter && player.freighter.siteId != null) ? player.freighter.siteId : null;
  if (ep && ep.startsWith('outpost')) {
    const o = player.outposts && player.outposts[ep.slice('outpost'.length)];
    return o ? (o.siteId == null ? null : o.siteId) : undefined;
  }
  return undefined;
}

// A host endpoint a vehicle can ride inside (everything except 'freighter'
// itself - a freighter can't carry itself).
function isVehicleHost(ep) {
  return ep === 'leo' || ep === 'rocket'
    || (typeof ep === 'string' && ep.startsWith('outpost')
        && ['A', 'B', 'C', 'D'].includes(ep.slice('outpost'.length)));
}

// STOW_FREIGHTER: carry the standalone Freighter INSIDE a colocated stack. The
// Freighter is normally its own ship (the big cube), but a vehicle "is just a
// card" (user 2026-06-27), so it can ride inside the rocket / an outpost / LEO:
// its card AND all its cargo flatten into that host stack, and the standalone
// unit is gone. The reverse is DEPLOY_FREIGHTER. M1-gated.
function applyStowFreighter(state, op, player) {
  if (!state.m1) return fail('m1_off');
  const fr = player.freighter;
  if (!fr) return fail('no_freighter');
  if (fr.glitched) return fail('freighter_glitched');
  // v1: the cube's own water can't ride along (host tanks have their own
  // capacity). Unfuel the Freighter first.
  if ((fr.tank | 0) > 0) return fail('freighter_has_water');
  const to = op.to;
  if (!isVehicleHost(to)) return fail('bad_transfer');
  if (to.startsWith('outpost') && !(player.outposts && player.outposts[to.slice('outpost'.length)])) return fail('no_outpost');
  const dst = stackArrayOf(player, to);
  if (!dst) return fail('bad_transfer');
  // Colocation: the host must sit where the Freighter sits. An empty rocket
  // forms at the Freighter's site (mirrors applyTransfer).
  const frSite = fr.siteId == null ? null : fr.siteId;
  if (to === 'rocket' && player.rocket.stack.length === 0) {
    player.rocket.siteId = frSite;
  } else if (stackEndpointSite(player, to) !== frSite
      && !elevatorColocated(state, stackEndpointSite(player, to), frSite)) {
    return fail('not_colocated');
  }
  // The Freighter card itself, then its cargo, become slots in the host.
  const cargo = Array.isArray(fr.stack) ? fr.stack : [];
  const cargoN = cargo.length;
  dst.push({ id: fr.cardId, kind: 'patent', face: fr.face === 'secondary' ? 'secondary' : 'primary' });
  for (const s of cargo) dst.push(s);
  if (to === 'rocket') clipTank(player.rocket);
  player.freighter = null;
  player.freighterMovesRemaining = 0;
  const dstName = to === 'rocket' ? 'the rocket' : to === 'leo' ? 'the LEO Stack' : `Outpost ${to.slice('outpost'.length)}`;
  const tail = cargoN ? ` with ${cargoN} cargo card${cargoN === 1 ? '' : 's'}` : '';
  return { ok: true, state, log: `${player.name} stowed the Freighter${tail} into ${dstName}.` };
}

// DEPLOY_FREIGHTER: the reverse of STOW. Pull a carried Freighter card out of a
// host stack and re-establish the standalone Freighter unit at that location
// (just the card splits off; any cargo it was sitting with stays in the host).
// One Freighter per player, so this fails if one is already in play. M1-gated.
function applyDeployFreighter(state, op, player) {
  if (!state.m1) return fail('m1_off');
  if (player.freighter) return fail('already_have_freighter');
  const from = op.from;
  const cardId = op.cardId != null ? String(op.cardId) : null;
  if (!cardId) return fail('bad_transfer');
  if (!isVehicleHost(from)) return fail('bad_transfer');
  if (from.startsWith('outpost') && !(player.outposts && player.outposts[from.slice('outpost'.length)])) return fail('no_outpost');
  const src = stackArrayOf(player, from);
  if (!src) return fail('bad_transfer');
  const idx = src.findIndex((s) => s.id === cardId);
  if (idx < 0) return fail('not_in_source');
  const card = PATENTS_BY_ID[cardId];
  if (!card || card.type !== 'freighter') return fail('not_a_vehicle');
  const slot = src[idx];
  const siteId = stackEndpointSite(player, from);
  src.splice(idx, 1);
  if (from === 'rocket') {
    if (player.rocket.activeThrusterId === cardId) player.rocket.activeThrusterId = null;
    if (player.rocket.activeProspectorId === cardId) player.rocket.activeProspectorId = null;
    recallIfEmpty(player);
  }
  // Restore the promoted (purple) state if it was carried on its secondary face.
  const promoted = slot.face === 'secondary';
  player.freighter = {
    cardId, face: promoted ? 'secondary' : 'primary', promoted,
    siteId: siteId == null ? null : siteId, stack: [], tank: 0, wiring: {}, route: [],
  };
  const fromName = from === 'rocket' ? 'the rocket' : from === 'leo' ? 'the LEO Stack' : `Outpost ${from.slice('outpost'.length)}`;
  const where = siteId == null ? 'LEO' : ((siteById(siteId) || {}).name || siteId);
  return { ok: true, state, log: `${player.name} deployed the Freighter from ${fromName}; the big cube launches at ${where}.` };
}

// STOW_BERNAL / DEPLOY_BERNAL: the M2 Bernal mirror of STOW/DEPLOY_FREIGHTER.
// Same "a vehicle is just a card" mechanic, but a player can hold TWO Bernals
// (player.bernals[]), so the op names a specific colony by its cardId. M2-gated.
function applyStowBernal(state, op, player) {
  if (!state.m2) return fail('m2_off');
  const cardId = op.cardId != null ? String(op.cardId) : null;
  const list = player.bernals || (player.bernals = []);
  const bi = list.findIndex((b) => b && b.cardId === cardId);
  if (bi < 0) return fail('no_bernal');
  const bn = list[bi];
  if (bn.glitched) return fail('bernal_glitched');
  if ((bn.tank | 0) > 0) return fail('bernal_has_water');
  const to = op.to;
  if (!isVehicleHost(to)) return fail('bad_transfer');
  if (to.startsWith('outpost') && !(player.outposts && player.outposts[to.slice('outpost'.length)])) return fail('no_outpost');
  const dst = stackArrayOf(player, to);
  if (!dst) return fail('bad_transfer');
  const bnSite = bn.siteId == null ? null : bn.siteId;
  if (to === 'rocket' && player.rocket.stack.length === 0) {
    player.rocket.siteId = bnSite;
  } else if (stackEndpointSite(player, to) !== bnSite
      && !elevatorColocated(state, stackEndpointSite(player, to), bnSite)) {
    return fail('not_colocated');
  }
  const cargo = Array.isArray(bn.stack) ? bn.stack : [];
  const cargoN = cargo.length;
  dst.push({ id: bn.cardId, kind: 'patent', face: bn.face === 'secondary' ? 'secondary' : 'primary' });
  for (const s of cargo) dst.push(s);
  if (to === 'rocket') clipTank(player.rocket);
  list.splice(bi, 1);
  const dstName = to === 'rocket' ? 'the rocket' : to === 'leo' ? 'the LEO Stack' : `Outpost ${to.slice('outpost'.length)}`;
  const tail = cargoN ? ` with ${cargoN} cargo card${cargoN === 1 ? '' : 's'}` : '';
  return { ok: true, state, log: `${player.name} stowed a Bernal${tail} into ${dstName}.` };
}

function applyDeployBernal(state, op, player) {
  if (!state.m2) return fail('m2_off');
  const list = player.bernals || (player.bernals = []);
  if (list.length >= 2) return fail('bernal_limit');
  const from = op.from;
  const cardId = op.cardId != null ? String(op.cardId) : null;
  if (!cardId) return fail('bad_transfer');
  if (!isVehicleHost(from)) return fail('bad_transfer');
  if (from.startsWith('outpost') && !(player.outposts && player.outposts[from.slice('outpost'.length)])) return fail('no_outpost');
  const src = stackArrayOf(player, from);
  if (!src) return fail('bad_transfer');
  const idx = src.findIndex((s) => s.id === cardId);
  if (idx < 0) return fail('not_in_source');
  const card = PATENTS_BY_ID[cardId];
  if (!card || card.type !== 'bernal') return fail('not_a_vehicle');
  const slot = src[idx];
  const siteId = stackEndpointSite(player, from);
  src.splice(idx, 1);
  if (from === 'rocket') {
    if (player.rocket.activeThrusterId === cardId) player.rocket.activeThrusterId = null;
    if (player.rocket.activeProspectorId === cardId) player.rocket.activeProspectorId = null;
    recallIfEmpty(player);
  }
  // 1st Bernal is a Kalpana, 2nd a Stanford (by current count).
  const figure = list.length === 0 ? 'kalpana' : 'stanford';
  const promoted = slot.face === 'secondary';
  list.push({
    cardId, figure, face: promoted ? 'secondary' : 'primary', promoted,
    siteId: siteId == null ? null : siteId, stack: [], tank: 0, wiring: {}, route: [],
  });
  const fromName = from === 'rocket' ? 'the rocket' : from === 'leo' ? 'the LEO Stack' : `Outpost ${from.slice('outpost'.length)}`;
  const where = siteId == null ? 'LEO' : ((siteById(siteId) || {}).name || siteId);
  return { ok: true, state, log: `${player.name} established a ${figure === 'kalpana' ? 'Kalpana' : 'Stanford'} Bernal from ${fromName} at ${where}.` };
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
  const fromRaw = String(op.from || 'rocket');
  let from, src;
  if (fromRaw === 'leo') { from = 'leo'; src = (player.leo = player.leo || []); }
  else if (fromRaw === 'freighter') {
    if (!player.freighter) return fail('no_freighter');
    from = 'freighter'; src = (player.freighter.stack = player.freighter.stack || []);
  }
  else if (fromRaw.startsWith('outpost')) {
    const o = player.outposts && player.outposts[fromRaw.slice('outpost'.length)];
    if (!o) return fail('no_outpost');
    from = 'outpost'; src = (o.cards = o.cards || []);
  } else { from = 'rocket'; src = player.rocket.stack; }
  const ids = Array.isArray(op.cardIds)
    ? op.cardIds.map(String)
    : (op.cardId != null ? [String(op.cardId)] : []);
  if (!ids.length) return fail('bad_decommission');
  let returned = 0;
  let crewToLeo = 0;
  let blocked = 0;
  for (const id of ids) {
    const idx = src.findIndex((s) => s.id === id);
    if (idx < 0) continue;
    const slot = src[idx];
    // Decommissioning a Crew (a Human) is a FELONY, allowed only from the
    // ROCKET during Anarchy (the crew recalls to the LEO Stack). From LEO or an
    // outpost it's blocked - crew there have nowhere to recall to.
    if (isCrewSlot(slot)) {
      if (!mayCommitFelony(state, player) || from !== 'rocket') { blocked++; continue; }
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
  // Colocated = same site, OR the two ends of a built Space Elevator (M1).
  if (player.rocket.siteId == null
      || (player.rocket.siteId !== outpost.siteId
          && !elevatorColocated(state, player.rocket.siteId, outpost.siteId))) {
    return fail('not_colocated');
  }
  const want = Math.floor(Number(op.amount));
  if (!Number.isFinite(want) || want <= 0) return fail('bad_amount');
  // Rocket -> outpost: store the rocket's water at the outpost.
  if (op.direction === 'toOutpost') {
    if ((player.rocket.tank | 0) > 0 && tankGradeOf(player.rocket) === 'dirt') return fail('cannot_store_dirt');
    // Only WHOLE water units transfer; a sub-1 remainder stays in the tank.
    const tank = Math.floor(player.rocket.tank || 0);
    const amt = Math.min(want, tank);
    if (amt <= 0) return fail('no_water');
    player.rocket.tank = (player.rocket.tank || 0) - amt;
    outpost.tank = (outpost.tank | 0) + amt;
    return {
      ok: true, state,
      log: `${player.name} pumped ${amt} water from the rocket into Outpost ${letter} (outpost ${outpost.tank}).`,
    };
  }
  // Outpost -> rocket (default).
  if ((player.rocket.tank | 0) > 0 && tankGradeOf(player.rocket) === 'dirt') return fail('cannot_mix_fuel');
  const dry = rocketDryMass(player.rocket.stack.reduce((m, s) => m + slotMass(s), 0));
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
  const dryMass = rocketDryMass(player.rocket.stack.reduce((m, s) => m + slotMass(s), 0));
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
  // Colocated modifier cards (subsystems 2 + 3): scan the prospector's stack.
  const colocatedPowers = player.rocket.stack.map(powerOfSlot);
  const isruMod = sumColocatedIsruMod(colocatedPowers, { isAerostat: isAerostatSite(site) });
  const effIsru = Math.max(0, prospectorIsru(provSlot) + isruMod);   // isruMod <= 0 (easier), floored at 0
  // Atmospheric Scoop (subsystem 5) can raise an aerostat site to hydration 2.
  if (effIsru > (effectiveHydration(site, player) | 0)) return fail('isru_too_high');

  // Prospecting is one operation to BEGIN: the first prospect of the turn
  // (any kind) spends the operation. Once begun, a raygun's line-of-sight scan
  // is free and unlimited - and a roaming buggy (on a connected body) scans the
  // same body for free too, since it acts as a raygun there. A missile, or a
  // buggy NOT on a roam body, always costs the operation (it IS the operation),
  // so once the turn's op is spent it can never fire a free additional scan.
  const begun = hasProspectedThisTurn(state);
  const free = begun && (kind === 'raygun' || buggyRoams);
  if (!free && player.opsRemaining <= 0) return fail('no_ops_left');

  // Claim disc supply: 9 per player. At the cap a player may MOVE one of their
  // existing discs to this new spot (op.relocateFrom names it); the disc is
  // freed BEFORE the roll so the count stays 9. Without a valid relocation the
  // prospect is blocked (claim_limit) so the client can prompt for one. The
  // disc commits to the new site whatever the roll, exactly like placing it.
  let relocatedName = null;
  if (ownedClaimCount(state.discs, player.profileId) >= CLAIM_DISCS) {
    const relo = String(op.relocateFrom || '');
    const reloDisc = relo && state.discs[relo];
    // Only an active (successful) claim occupies a disc, so only one of those
    // can be moved to free a slot; a busted disc isn't holding a disc at all.
    if (!reloDisc || reloDisc.ownerId !== player.profileId || reloDisc.outcome !== 'success'
        || relo === toSiteId) return fail('claim_limit');
    // A disc with a factory built on it is locked in place - it can't be moved.
    if (state.factories[relo]) return fail('disc_has_factory');
    const reloSite = siteById(relo);
    relocatedName = reloSite ? reloSite.name : relo;
    delete state.discs[relo];
  }

  const threshold = prospectThreshold(site);
  // Size-roll modifier (subsystem 2): colocated cards subtract from the d6
  // (negative = easier), conditioned on the site's spectral type / prospector
  // kind. THORIUM BREEDER (-3 on S), COMET LICHEN (-2 on D), FOAMED NICKEL (-1),
  // SUPERLENS (-1 raygun).
  const sizeMod = sumColocatedSizeRollMod(colocatedPowers, { spectral: site.spectralType, prospectorKind: kind });
  const gen = makeRng(state.seed, state.rng.cursor);
  const roll = gen.d6();
  state.rng.cursor = gen.cursor;
  const effRoll = roll + sizeMod;            // sizeMod is <= 0
  const success = effRoll <= threshold;
  // NANITES (Lorentz-Propelled Microprobe): one re-roll if the size roll fails.
  const nanites = anyColocatedNanitesReroll(colocatedPowers);
  state.discs[toSiteId] = {
    outcome: success ? 'success' : 'fail',
    roll, threshold, kind,
    ...(sizeMod ? { sizeMod, effRoll } : {}),
    by: player.name,
    ownerId: player.profileId,
    turn: curTurn,
    round: curRound,
    // The buggy may re-roll once, this turn, by its owner.
    // Buggy may re-roll once; Blink Telescope (B612) grants a raygun the same;
    // NANITES grants any prospector one re-roll on a failed size roll.
    canReroll: kind === 'buggy'
      || (kind === 'raygun' && hasPrivilege(state, player, 'BLINK_TELESCOPE'))
      || (!success && nanites),
  };
  if (!free) player.opsRemaining -= 1;
  const verb = success ? 'struck a claim at' : 'came up dry at';
  const tail = free ? (buggyRoams ? ' with a free buggy road scan' : ' with a free raygun scan') : '';
  const rollText = sizeMod ? `${roll}${sizeMod > 0 ? '+' : ''}${sizeMod} = ${effRoll}` : `${roll}`;
  let log = `${player.name} rolled ${rollText} vs ${threshold} and ${verb} ${site.name}${tail}.`;
  if (relocatedName) log += ` (Moved a claim disc from ${relocatedName} - all 9 were placed.)`;
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
  // Eligibility is encoded in disc.canReroll at prospect time: buggy (always),
  // raygun with Blink Telescope, or any kind with a colocated NANITES card on a
  // failed size roll. False here means "not eligible OR already re-rolled".
  if (!disc.canReroll) return fail('cannot_reroll');
  if (disc.turn !== state.turn) return fail('reroll_window_closed');
  const site = siteById(toSiteId);
  const threshold = disc.threshold;
  const sizeMod = disc.sizeMod || 0;
  const gen = makeRng(state.seed, state.rng.cursor);
  const roll = gen.d6();
  state.rng.cursor = gen.cursor;
  const effRoll = roll + sizeMod;
  const success = effRoll <= threshold;
  state.discs[toSiteId] = {
    ...disc,
    outcome: success ? 'success' : 'fail',
    roll,
    ...(sizeMod ? { effRoll } : {}),
    canReroll: false,
    rerolled: true,
  };
  const verb = success ? 'struck a claim at' : 'came up dry at';
  const where = (site && site.name) || toSiteId;
  const how = disc.kind === 'buggy' ? 'the buggy' : 'the scan';
  const rollText = sizeMod ? `${roll}${sizeMod > 0 ? '+' : ''}${sizeMod} = ${effRoll}` : `${roll}`;
  let log = `${player.name} re-rolled ${how}: ${rollText} vs ${threshold} and ${verb} ${where}.`;
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
  // Cube supply: factories + assembly delegates share the 7 cubes. If the pool
  // is full you may FREE one by removing a delegate from the politics map
  // (op.freeDelegate = the place to pull it from); otherwise it's a hard cap.
  if (cubesInPlay(state, player.profileId) >= FACTORY_CUBES) {
    const asm = assemblyOf(state);
    const free = op.freeDelegate ? String(op.freeDelegate) : null;
    if (free && ASSEMBLY_PLACES.includes(free) && placeCount(asm, free, player.profileId) > 0) {
      setPlaceCount(asm, free, player.profileId, placeCount(asm, free, player.profileId) - 1);
    } else {
      return fail('no_factory_cubes');
    }
  }
  const ids = Array.isArray(op.cardIds) ? op.cardIds.map(String) : [];
  // Every id must be a non-crew card in the stack; the set must include a
  // refinery + a robonaut (the build needs both) - unless ARCOLOGY waives the
  // robonaut. Scan the build set's powers along the way.
  let hasRefinery = false, hasRobonaut = false, arcology = false, powersatGrant = false;
  const atmo = isAerostatSite(site);
  const size = prospectThreshold(site);
  for (const id of ids) {
    const slot = player.rocket.stack.find((s) => s.id === id && s.kind !== 'crew');
    if (!slot) return fail('not_in_stack');
    const c = PATENTS_BY_ID[id];
    if (c && c.type === 'refinery') hasRefinery = true;
    if (c && c.type === 'robonaut') hasRobonaut = true;
    const pw = powerOfSlot(slot);   // capture now (the slot is decommissioned below)
    if (!pw) continue;
    // Magnetoshell Plasma Parachute: "Cannot be used to support Bernals or
    // during industrialization." Reject it from the build set.
    if (pw.safeAerobrakeNoBernalOrIndustrialize) return fail('card_no_industrialize');
    // ARCOLOGY (Solar Carbotherm): no robonaut decommission needed in the
    // listed inner-system zones.
    if (Array.isArray(pw.noRobonautDecommissionZones)
        && pw.noRobonautDecommissionZones.includes(site.solarZone)) arcology = true;
    // POWER GIRDLE (Ilmenite, non-atmo size 8+) / IONOSAT (Ionosphere Lasing,
    // atmospheric): permanently grant Powersat on this industrialize.
    if (pw.gainPowersatOnIndustrialize === 'atmospheric' && atmo) powersatGrant = true;
    if (pw.gainPowersatOnIndustrialize === 'nonAtmoSize8' && !atmo && size >= 8) powersatGrant = true;
  }
  if (!hasRefinery || (!hasRobonaut && !arcology)) return fail('cannot_industrialize');
  // JELLYBOTS (Solid Flame): a colocated card makes industrialization a FREE
  // action (no operation spent). Colocated = anywhere in the stack.
  const freeAction = player.rocket.stack.some((s) => {
    const pw = powerOfSlot(s);
    return pw && pw.industrializeFreeAction;
  });
  if (!freeAction && player.opsRemaining <= 0) return fail('no_ops_left');
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
  // M1: name the cube for the Mobile Factory fleet (1B6); harmless field that
  // only the M1 mobile-factory UI reads (gated so an M1-off game is unchanged).
  if (state.m1) state.factories[siteId].tag = nextFactoryTag(state, player.profileId);
  if (!freeAction) player.opsRemaining -= 1;
  let log = `${player.name} industrialized ${site.name} (spectral ${spectral}); decommissioned ${ids.length} card${ids.length === 1 ? '' : 's'} to hand.`;
  if (arcology && !hasRobonaut) log += ' (Arcology: no robonaut needed.)';
  if (freeAction) log += ' (Jellybots: free action.)';
  // POWER GIRDLE (Ilmenite) / IONOSAT (Ionosphere Lasing): permanently grant
  // Powersat (captured above from the build set + site conditions).
  if (powersatGrant && !hasGrantedPrivilege(player, 'POWERSAT')) {
    grantPrivilege(player, 'POWERSAT');
    log += ` ${player.name} permanently gained the Powersat privilege.`;
  }
  // Taxes: industrializing a Claim also pays every Taxes holder +1 aqua.
  const tax = creditPrivilegeIncome(state, 'TAXES', 'Taxes');
  if (tax.length) log += ' ' + tax.join(' ');
  return { ok: true, state, log };
}

// Mine Revival (MINE REVIVAL, Termite Nest): as an operation, clear a BUSTED
// (failed) prospect disc at a colocated site of size 2+ and place your own
// Claim there. Needs a Termite Nest aboard. op = { siteId }.
function applyMineRevival(state, op, player) {
  const siteId = String(op.siteId || '');
  const site = siteById(siteId);
  if (!site) return fail('unknown_site');
  if (player.rocket.siteId !== siteId) return fail('not_at_site');
  const hasTermite = player.rocket.stack.some((s) => {
    const pw = powerOfSlot(s);
    return pw && pw.mineRevival;
  });
  if (!hasTermite) return fail('no_mine_revival');
  if (state.factories[siteId]) return fail('already_industrialized');
  const disc = state.discs[siteId];
  if (!disc || disc.outcome !== 'fail') return fail('no_busted_disc');
  if (prospectThreshold(site) < 2) return fail('site_too_small');
  if (player.opsRemaining <= 0) return fail('no_ops_left');
  state.discs[siteId] = {
    outcome: 'success', roll: 0, threshold: prospectThreshold(site), kind: 'mine-revival',
    by: player.name, ownerId: player.profileId,
    turn: state.turn | 0, round: state.round | 0,
    canReroll: false, revived: true,
  };
  player.opsRemaining -= 1;
  let log = `${player.name} revived the busted claim at ${site.name} (Mine Revival).`;
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
  // Individuality (Freedom to Roam) OR an owner's standing grant (Request ->
  // Grant) lets a player ET-produce at an opponent's factory legitimately (a
  // non-victory use), skipping the felony path.
  if (!canUseFactoryNonVictory(state, player, fac)) {
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
  const prodCard = PATENTS_BY_ID[cardId];
  // M1 Freighter: producing a freighter card spawns the player's Freighter
  // UNIT (the big cube) at this Factory's site, NOT a card in an outpost. One
  // freighter per player (1A4). Gated on M1 (zero bleed-through when off).
  if (prodCard && prodCard.type === 'freighter') {
    if (!state.m1) return fail('m1_off');
    if (player.freighter) return fail('already_have_freighter');
    player.hand.splice(hIdx, 1);
    // Produced on its BLACK side (the primary face for GW thrusters / freighters,
    // which carry the working card on the front and the PURPLE promoted card on
    // the back). Promotion later flips face -> 'secondary'.
    player.freighter = {
      cardId, face: 'primary', promoted: false,
      siteId, stack: [], tank: 0, wiring: {}, route: [],
    };
    player.opsRemaining -= 1;
    return {
      ok: true, state,
      log: `${player.name} ET-produced ${prodCard.name} (Freighter) at ${site.name}; the big cube launches.`,
    };
  }
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
  const card = PATENTS_BY_ID[cardId];
  // Produced on the card's BLACK installed side. For most cards that is the
  // secondary face; GW thrusters / freighters carry their working (black) card
  // on the PRIMARY face (the secondary is the PURPLE promoted side, reached via
  // Promotion), so they produce primary-side-up.
  const blackFace = (card && (card.type === 'gw-thruster' || card.type === 'freighter')) ? 'primary' : 'secondary';
  const produced = { id: cardId, kind: 'patent', face: blackFace };
  // Radiators deploy a Light or Heavy side; the producer picks it (default
  // Heavy = max cooling). Non-radiators carry no side.
  if (card && card.type === 'radiator') produced.radSide = op.radSide === 'light' ? 'light' : 'heavy';
  outpost.cards.push(produced);
  player.opsRemaining -= 1;
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

// ===== Module 0: Sol Political Assembly =====
//
// Mechanics implemented from the published mat (our own functional wording, no
// rulebook text reproduced). Delegate placements live in state.assembly; the
// active-law resolver is the shared pure data/assembly.js#activeLaws. Some
// per-law EFFECTS that hook other ops are wired where their host op exists; the
// rest are flagged in docs/politics-m0-plan.md.
function assemblyOf(state) {
  if (!state.assembly) state.assembly = freshAssembly();
  return state.assembly;
}
function placeCount(asm, place, profileId) {
  return playerDelegatesInPlace(asm, place, profileId);
}
function setPlaceCount(asm, place, profileId, count) {
  const m = asm.delegates[place] || (asm.delegates[place] = {});
  if (count > 0) m[profileId] = count; else delete m[profileId];
}
// Is ideology `key`'s law in force right now (resolver verdict)?
function lawInForce(state, key) {
  return activeLaws(assemblyOf(state), state.activeLawStar).active.has(key);
}
// May `player` benefit from ideology `key`'s law this turn? It's in force and
// they hold a delegate there, OR they spent a Lobby free action on it this turn.
function playerCanUseLaw(state, player, key) {
  const asm = assemblyOf(state);
  if (lawInForce(state, key) && placeCount(asm, key, player.profileId) > 0) return true;
  return Array.isArray(player.lobbiedLaws) && player.lobbiedLaws.includes(key);
}
// May `player` operate at this factory for a NON-VICTORY purpose (site refuel,
// ET production, delivery)? Their own always; an opponent's only when
// Individuality (Freedom to Roam) lets them treat it as their own. Victory
// builds (Homesteading a colony) do NOT get this and stay owner-only.
function canUseFactoryNonVictory(state, player, fac) {
  if (!fac) return false;
  if (fac.ownerId === player.profileId) return true;
  if (playerCanUseLaw(state, player, 'individuality')) return true;
  // Owner-granted standing access (Request -> Grant). Grants live on the factory
  // object, so they reset when the cube relocates (a new factory object).
  if (fac.grants && fac.grants[String(player.profileId)]) return true;
  return false;
}
// A player's 7 wooden cubes are ONE shared pool: each factory, each assembly
// delegate, AND the first player's Sunspot (first-player) marker is a cube.
// cubesInPlay counts all three; FACTORY_CUBES (7) caps the sum. Running out for
// a factory is freed by removing a delegate (INDUSTRIALIZE freeDelegate);
// placing a delegate is blocked when the pool is full.
function cubesInPlay(state, profileId) {
  let n = ownedSiteCount(state.factories, profileId)
    + playerDelegatesPlaced(assemblyOf(state), profileId);
  const fp = state.players[state.firstPlayerIndex || 0];
  if (fp && fp.profileId === profileId) n += 1;   // the Sunspot / first-player cube
  return n;
}

// Fundraise (M0 operation, replaces Income): OPTIONALLY place a new delegate
// from hand AND OPTIONALLY move one of YOUR delegates one ADJACENT space, then
// gain aqua (the vote tally is implicit - activeLaws is recomputed on read).
// Either sub-action may be skipped (skipping both just banks the income). Honor
// (Paleoconservative) makes the aqua gained equal your glory-chit count;
// Authority (Martial Law) may also discard an opponent's delegate.
function applyFundraise(state, op, player) {
  if (!state.m0) return fail('not_m0');
  if (player.opsRemaining <= 0) return fail('no_ops_left');
  const asm = assemblyOf(state);
  const pid = player.profileId;
  const placeName = (p) => (p === 'centrist' ? 'Centrist' : ((IDEOLOGY_BY_KEY[p] || {}).name || p));
  // Optional: place a NEW delegate from hand. It may only go on your HOME
  // ideology or a space where you already hold a delegate.
  const place = op.place ? String(op.place) : null;
  if (place && !ASSEMBLY_PLACES.includes(place)) return fail('bad_place');
  if (place) {
    const home = (state.homeIdeology || {})[pid];
    if (place !== home && placeCount(asm, place, pid) <= 0) return fail('bad_place_target');
  }
  // Optional: move one of MY delegates one ADJACENT space.
  const moveFrom = op.moveFrom ? String(op.moveFrom) : null;
  const moveTo = op.moveTo ? String(op.moveTo) : null;
  if ((moveFrom && !moveTo) || (!moveFrom && moveTo)) return fail('bad_move');
  if (moveFrom) {
    if (!ASSEMBLY_PLACES.includes(moveFrom) || !ASSEMBLY_PLACES.includes(moveTo)) return fail('bad_place');
    if (!adjacentPlaces(moveFrom).includes(moveTo)) return fail('not_adjacent');
  }
  if (place && cubesInPlay(state, pid) >= FACTORY_CUBES) return fail('no_cubes_left');
  if (moveFrom) {
    // The move source must hold one of MY delegates (a same-space placement this
    // op seeds one, so place-then-move from the new space is allowed).
    let have = placeCount(asm, moveFrom, pid);
    if (place === moveFrom) have += 1;
    if (have <= 0) return fail('no_delegate_there');
  }
  if (place) setPlaceCount(asm, place, pid, placeCount(asm, place, pid) + 1);
  if (moveFrom) {
    setPlaceCount(asm, moveFrom, pid, placeCount(asm, moveFrom, pid) - 1);
    setPlaceCount(asm, moveTo, pid, placeCount(asm, moveTo, pid) + 1);
  }
  // Authority (Martial Law): may discard an opponent's delegate.
  let martial = '';
  if (op.discard && playerCanUseLaw(state, player, 'authority')) {
    const oppId = Number(op.discard.profileId);
    const dplace = String(op.discard.place || '');
    if (ASSEMBLY_PLACES.includes(dplace) && oppId !== player.profileId
        && placeCount(asm, dplace, oppId) > 0) {
      setPlaceCount(asm, dplace, oppId, placeCount(asm, dplace, oppId) - 1);
      const opp = playerByProfile(state, oppId);
      martial = ` Martial Law discarded ${opp ? opp.name : 'an opponent'}'s delegate from ${dplace}.`;
    }
  }
  // Honor (Paleoconservative): aqua gained = your TOTAL glory-chit count, else
  // +1. Counts chits still aboard PLUS ones already claimed at LEO
  // (gloryChitCount), the same total the end-game Honor award uses - a chit you
  // hauled home and claimed still counts (the old code counted only carried
  // chits, so a player whose chits were all claimed fundraised for +0).
  const honor = playerCanUseLaw(state, player, 'honor');
  const gain = honor ? gloryChitCount(player) : INCOME_AQUA;
  player.aqua = (player.aqua | 0) + gain;
  player.opsRemaining -= 1;
  // Vote tally (the final step): move the active-law star onto the winner. One
  // winner -> auto; a tie -> the fundraiser's pick (op.star ∈ the tied winners);
  // no delegates anywhere -> the Centrist center.
  const winners = voteWinners(asm);
  let newStar;
  if (winners.length === 0) newStar = 'centrist';
  else if (winners.length === 1) [newStar] = winners;
  else {
    const pick = op.star ? String(op.star) : null;
    if (!pick || !winners.includes(pick)) return fail('star_choice_required', { winners });
    newStar = pick;
  }
  const starMoved = newStar !== state.activeLawStar;
  state.activeLawStar = newStar;
  const parts = [];
  if (place) parts.push(`placed a delegate on ${placeName(place)}`);
  if (moveFrom) parts.push(`moved a delegate ${placeName(moveFrom)} -> ${placeName(moveTo)}`);
  const did = parts.length ? parts.join(' and ') : 'took income';
  const starNote = starMoved
    ? ` The active-law star moves to ${newStar === 'centrist' ? 'the center' : placeName(newStar)}.`
    : '';
  return {
    ok: true, state,
    log: `${player.name} fundraised - ${did}, +${gain} aqua${honor ? ' (Honor: per glory chit)' : ''}.${martial}${starNote}`,
  };
}

// Lobby (M0 free action, once per turn): pay 1 aqua and discard a delegate in an
// INACTIVE ideology to use its Law this turn. Disabled while Unity's UN General
// Assembly law is in force.
function applyLobby(state, op, player) {
  if (!state.m0) return fail('not_m0');
  const asm = assemblyOf(state);
  const laws = activeLaws(asm, state.activeLawStar);
  if (laws.lobbyingDisabled) return fail('lobbying_disabled');
  if (player.lobbiedThisTurn) return fail('already_lobbied');
  const key = String(op.ideology || '');
  if (!IDEOLOGY_ORDER.includes(key)) return fail('bad_ideology');
  if (laws.active.has(key)) return fail('law_already_active');
  if (placeCount(asm, key, player.profileId) <= 0) return fail('no_delegate_there');
  if ((player.aqua | 0) < 1) return fail('insufficient_aqua');
  player.aqua -= 1;
  setPlaceCount(asm, key, player.profileId, placeCount(asm, key, player.profileId) - 1);
  player.lobbiedLaws = Array.isArray(player.lobbiedLaws) ? player.lobbiedLaws : [];
  if (!player.lobbiedLaws.includes(key)) player.lobbiedLaws.push(key);
  player.lobbiedThisTurn = true;
  return {
    ok: true, state,
    log: `${player.name} lobbied ${key} - paid 1 aqua and discarded a delegate to use its Law this turn.`,
  };
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

  // Outpost Factory-Refuel: a flat +7 water into an OUTPOST's own tank at a
  // usable factory here. The rocket need NOT be present - the outpost stores its
  // own fuel. Outposts can only FACTORY-refuel (ISRU refuel needs the rocket's
  // prospector). Still costs the operation + the one-per-site-per-turn lock.
  if (op.outpost) {
    const letter = String(op.outpost);
    const outpost = player.outposts && player.outposts[letter];
    if (!outpost || outpost.siteId !== siteId) return fail('no_outpost');
    const fac = state.factories[siteId];
    if (!canUseFactoryNonVictory(state, player, fac)) return fail('no_factory');
    if (player.opsRemaining <= 0) return fail('no_ops_left');
    player.refueledSites = Array.isArray(player.refueledSites) ? player.refueledSites : [];
    if (player.refueledSites.includes(siteId)) return fail('already_refueled');
    const odry = (outpost.cards || []).reduce((m, s) => m + slotMass(s), 0);
    const ocap = Math.max(0, TANK_MAX - odry);
    const otank = Number(outpost.tank) || 0;
    if (otank >= ocap) return fail('tank_full');
    const gain = Math.min(7, ocap - otank);
    if (gain <= 0) return fail('tank_full');
    outpost.tank = round6(otank + gain);
    player.refueledSites.push(siteId);
    player.opsRemaining -= 1;
    return {
      ok: true, state,
      log: `${player.name}: Factory-Refuel at ${site.name} (+${round6(gain)} water into Outpost ${letter}; tank ${round6(outpost.tank)}).`,
    };
  }

  if (player.rocket.siteId !== siteId) return fail('not_at_site');

  // Isotope Refuel (M1): a GW thruster runs on gold-bead isotope, refined at a
  // Factory whose spectral type matches the thruster. This fills the SAME tank
  // as water (reuse the water tank, just graded 'isotope'); a chemical engine
  // can never burn it and the tank never mixes grades. Gated hard on M1.
  if (op.mode === 'isotope') {
    if (!state.m1) return fail('m1_off');
    const tid = player.rocket.activeThrusterId;
    const tslot = tid && player.rocket.stack.find((s) => s.id === tid);
    const tcard = tslot && PATENTS_BY_ID[tslot.id];
    if (!tcard || tcard.type !== 'gw-thruster') return fail('no_gw_thruster');
    const fac = state.factories[siteId];
    if (!canUseFactoryNonVictory(state, player, fac)) return fail('no_factory');
    // The factory inherits the site's spectral type; isotope only refines where
    // it matches the GW thruster's spectral type.
    const thrSpectral = tcard.spectralType || 'C';
    const facSpectral = site.spectralType || 'C';
    if (thrSpectral !== facSpectral) return fail('spectral_mismatch', { need: thrSpectral, have: facSpectral });
    if (player.opsRemaining <= 0) return fail('no_ops_left');
    player.refueledSites = Array.isArray(player.refueledSites) ? player.refueledSites : [];
    if (player.refueledSites.includes(siteId)) return fail('already_refueled');
    const idry = rocketDryMass(player.rocket.stack.reduce((m, s) => m + slotMass(s), 0));
    const icap = Math.max(0, TANK_MAX - idry);
    const itank = Number(player.rocket.tank) || 0;
    // Isotope can't top up a water/dirt tank, and vice versa (no mixing).
    if (itank > 0 && tankGradeOf(player.rocket) !== 'isotope') return fail('cannot_mix_fuel');
    if (itank >= icap) return fail('tank_full');
    // Isotope refines slowly: at most 1 isotope FT per turn at a Factory (unlike
    // water's flat +7). The per-site-per-turn lock already caps it to one op.
    const igain = Math.min(1, icap - itank);
    if (igain <= 0) return fail('tank_full');
    player.rocket.tank = round6(itank + igain);
    player.rocket.tankGrade = 'isotope';
    player.refueledSites.push(siteId);
    player.opsRemaining -= 1;
    // First isotope ever refined monetizes the substance (M1 economy hook;
    // the price consequences land in a later slice).
    let monetizeNote = '';
    if (!state.isotopeMonetized) {
      state.isotopeMonetized = true;
      monetizeNote = ' Isotope is now monetized.';
    }
    return {
      ok: true, state,
      log: `${player.name}: Isotope Refuel at ${site.name} (+${round6(igain)} isotope; tank ${round6(player.rocket.tank)}).${monetizeNote}`,
    };
  }

  // Atmospheric Scoop (subsystem 5) can raise an aerostat site to hydration 2.
  const water = effectiveHydration(site, player);
  if (water <= 0) return fail('dry_site');
  if (player.opsRemaining <= 0) return fail('no_ops_left');
  player.refueledSites = Array.isArray(player.refueledSites) ? player.refueledSites : [];
  if (player.refueledSites.includes(siteId)) return fail('already_refueled');
  const dry = rocketDryMass(player.rocket.stack.reduce((m, s) => m + slotMass(s), 0));
  const cap = Math.max(0, TANK_MAX - dry);
  const tank = Number(player.rocket.tank) || 0;
  if (tank >= cap) return fail('tank_full');
  // Site refuel makes WATER; it can't top up a dirt tank (no mixing).
  if (tank > 0 && tankGradeOf(player.rocket) === 'dirt') return fail('cannot_mix_fuel');
  let rawGain, label;
  if (op.mode === 'factory') {
    const fac = state.factories[siteId];
    // Individuality (Freedom to Roam): an opponent's factory may be used to
    // refuel (a non-victory purpose).
    if (!canUseFactoryNonVictory(state, player, fac)) return fail('no_factory');
    rawGain = 7;
    label = 'Factory-Refuel';
  } else {
    const provId = player.rocket.activeProspectorId;
    const slot = provId && player.rocket.stack.find((s) => s.id === provId);
    if (!slot) return fail('no_prospector');
    // Colocated ISRU modifier (subsystem 3): a colocated card lowers the
    // platform's effective ISRU (DIVINING NUBOTS -1, SCOOP -2 at aerostats),
    // floored at 0 (the best rating). Lower ISRU = more water from the formula.
    const isruMod = sumColocatedIsruMod(player.rocket.stack.map(powerOfSlot), { isAerostat: isAerostatSite(site) });
    const isru = Math.max(0, prospectorIsru(slot) + isruMod);
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
  // SCAVENGING (Femtochemistry): a colocated card doubles FTs during site
  // refuel.
  if (player.rocket.stack.some((s) => { const pw = powerOfSlot(s); return pw && pw.doubleSiteRefuel; })) {
    rawGain *= 2;
    label += ' (Scavenging x2)';
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

// Free dirt refuel (Cargo Transfer / Internal Tankage free action): top the
// tank with grey dirt FTs. Loading dirt fuels the ACTIVE engine, so it's gated
// on the active thruster being a dirt thruster (a water thruster can't burn
// dirt - the same grade rule the MOVE fuel-grade gate enforces). Dirt can't mix
// with water (empty the tank first). Dirt needs NO ISRU rig.
//
// WHERE (HF4 MOONCABLE card + ISRU):
//   - At a real SITE: scooping dirt needs an ISRU source colocated - a FACTORY
//     at the site, or an ISRU platform (a card with an ISRU rating) aboard the
//     rocket. The active dirt thruster burns it; it does not scoop on its own.
//   - At LEO / Home Bernal: there's no ground, so it takes the MOON CABLE (a
//     NASRDA crew card aboard - negotiable) to pipe dirt up. The cable need NOT
//     be the active thruster - it just has to be in the stack, and it refuels
//     whichever triangle is active.
// It is a FREE ACTION (costs NO operation) with NO per-turn cap: load as much
// as the tank holds, in any increments, any number of times per turn.
// op = { amount? }.
function applyDirtRefuel(state, op, player) {
  const tid = player.rocket.activeThrusterId;
  const slot = tid && player.rocket.stack.find((s) => s.id === tid);
  if (!slot) return fail('no_thruster');
  if (!faceBurnsDirt(thrusterFaceOf(slot))) return fail('not_dirt_thruster');
  if (rocketAtLeo(player)) {
    if (!stackHasMoonCable(player.rocket)) return fail('dirt_needs_mooncable');
  } else {
    if (!siteById(player.rocket.siteId)) return fail('not_at_site');
    const factoryHere = !!state.factories[player.rocket.siteId];
    const isruAboard = player.rocket.stack.some(slotHasIsruRig);
    if (!factoryHere && !isruAboard) return fail('dirt_needs_isru');
  }
  const tank = Number(player.rocket.tank) || 0;
  if (tank > 0 && tankGradeOf(player.rocket) === 'water') return fail('cannot_mix_fuel');
  const dry = rocketDryMass(player.rocket.stack.reduce((m, s) => m + slotMass(s), 0));
  const cap = Math.max(0, TANK_MAX - dry);
  const room = cap - tank;
  if (room <= 0) return fail('tank_full');
  const want = Number(op && op.amount);
  let gain = Number.isFinite(want) && want > 0 ? Math.min(want, room) : room;
  // A CREW dirt thruster scoops only 1 dirt FT per turn; a card dirt thruster
  // scoops as much as the tank holds, any number of times. Track the crew load
  // per turn (reset in openTurnFor, replayed correctly on undo like
  // refueledSites) and cap the cumulative crew scoop at 1.
  const isCrewBurner = !!CREW_BY_ID[slot.id];
  if (isCrewBurner) {
    const already = Number(player.dirtTanksThisTurn) || 0;
    const allowance = Math.max(0, 1 - already);
    if (allowance <= 0) return fail('dirt_crew_cap');
    gain = Math.min(gain, allowance);
  }
  if (gain <= 0) return fail('tank_full');
  player.rocket.tank = round6(tank + gain);
  player.rocket.tankGrade = 'dirt';
  if (isCrewBurner) player.dirtTanksThisTurn = (Number(player.dirtTanksThisTurn) || 0) + gain;
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
  // Individuality (Freedom to Roam): deliver from an opponent's factory (a
  // non-victory use). The delivered card is still read from YOUR own outpost.
  if (!canUseFactoryNonVictory(state, player, fac)) return fail('no_factory');
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
  // Colony dome supply: a player has only 7 domes, so 7 colonies max.
  if (ownedSiteCount(state.colonies, player.profileId) >= COLONY_DOMES) return fail('no_colony_domes');
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
  // Store the colony's location type (sent by the client, which has the site
  // flags) so the endgame scorer can value it by type - a site bonus ABOVE the
  // +1 dome token: astrobiology +1, submarine / Bernal +2, plain colony none.
  const cType = ['astrobiology', 'submarine', 'bernal'].includes(op.colonyType) ? op.colonyType : 'other';
  state.colonies[siteId] = { ownerId: player.profileId, type: cType };
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
// M1 ownership cap (1A4): a player may own at most ONE GW thruster and ONE
// freighter card at a time, promoted or not. The card counts wherever it sits:
// hand, LEO, rocket, an outpost, or the freighter unit (its own card + cargo).
// This gates ACQUISITION (buy / auction win). Production and promotion never
// add a new card of the type, so they don't need the check.
const SINGLETON_CARD_TYPES = new Set(['gw-thruster', 'freighter']);
function* ownedCardIds(player) {
  for (const id of (player.hand || [])) if (id) yield id;
  for (const s of (player.leo || [])) if (s && s.id) yield s.id;
  if (player.rocket && Array.isArray(player.rocket.stack)) {
    for (const s of player.rocket.stack) if (s && s.id) yield s.id;
  }
  const ops = player.outposts || {};
  for (const k in ops) {
    const o = ops[k];
    if (o && Array.isArray(o.cards)) for (const s of o.cards) if (s && s.id) yield s.id;
  }
  if (player.freighter) {
    if (player.freighter.cardId) yield player.freighter.cardId;
    if (Array.isArray(player.freighter.stack)) {
      for (const s of player.freighter.stack) if (s && s.id) yield s.id;
    }
  }
  // M2 Bernal units: the colony card plus its cargo are in play.
  for (const b of (player.bernals || [])) {
    if (b && b.cardId) yield b.cardId;
    if (b && Array.isArray(b.stack)) for (const s of b.stack) if (s && s.id) yield s.id;
  }
}
function countOwnedOfType(player, type) {
  let n = 0;
  for (const id of ownedCardIds(player)) {
    const c = PATENTS_BY_ID[id];
    if (c && c.type === type) n += 1;
  }
  return n;
}
function ownsSingletonAlready(player, type) {
  return SINGLETON_CARD_TYPES.has(type) && countOwnedOfType(player, type) >= 1;
}

function applyBuyCard(state, op, player) {
  const cardId = String(op.cardId || '');
  const card = PATENTS_BY_ID[cardId];
  if (!card) return fail('unknown_card');
  if (card.type === 'gw-thruster' && !state.m1) return fail('expansion_card');
  if (card.type === 'freighter' && !state.m1) return fail('expansion_card');
  if (card.type === 'bernal' && !state.m2) return fail('expansion_card');
  if (CREW_BY_ID[cardId]) return fail('crew_card');
  if (ownsSingletonAlready(player, card.type)) {
    return fail(card.type === 'freighter' ? 'already_own_freighter' : 'already_own_gw');
  }
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
// Pac-Man (rule c): the stack contains an Operational card with the air-eater
// icon AND an Activated thruster. The air-eater card MAY share the thruster's
// support chain but need not. "Operational" here = the card is in the stack with
// the air-eater property on its installed face (air-eater cards are
// self-contained, carrying no supports of their own).
function faceHasAirEater(f) {
  return !!(f && Array.isArray(f.properties)
    && f.properties.some((p) => p.key === 'airEater' && p.value));
}
function stackHasAirEater(rocket) {
  for (const slot of rocket.stack) {
    const c = PATENTS_BY_ID[slot.id];
    if (!c) continue;
    if (faceHasAirEater(slotFace(slot, c))) return true;
  }
  return false;
}
function pacManReady(rocket) {
  return !!(rocket && rocket.activeThrusterId
    && rocket.stack.some((s) => s.id === rocket.activeThrusterId)
    && stackHasAirEater(rocket));
}

// Air-Eater Refuel Op (rule c). At the end of its movement a Spacecraft sitting
// on an Aerobrake Hazard with a Pac-Man stack scoops the atmosphere for fuel:
// the wet-mass chit moves up the red line by (5 - floor(activated fuel
// consumption)) tanks. Diver Orbit: each refuel counts as a Hazard requiring
// either a Hazard Roll (a 1 destroys the stack) or FINAO (pay aqua to skip).
// Costs the turn's single operation.
function applyAirEaterRefuel(state, op, player) {
  const here = player.rocket.siteId;
  if (!here || !isAerobrakeNode(here)) return fail('not_on_aerobrake');
  if (!pacManReady(player.rocket)) return fail('no_pacman');
  if (player.opsRemaining <= 0) return fail('no_ops_left');
  // Tanks gained = 5 - fuel consumption (drop fractions of fuel consumption
  // before subtracting). Non-positive = nothing to scoop with this engine.
  const fc = Math.floor(thrusterFuelPerBurn(player.rocket));
  const tanks = 5 - fc;
  if (tanks <= 0) return fail('no_air_eater_gain', { fuelConsumption: fc });
  // Scooped atmosphere counts as water; can't pour onto a dirt / isotope tank.
  const tank = Number(player.rocket.tank) || 0;
  if (tank > 0 && tankGradeOf(player.rocket) !== 'water') return fail('cannot_mix_fuel');
  const dry = rocketDryMass(player.rocket.stack.reduce((m, s) => m + slotMass(s), 0));
  const room = Math.floor(Math.max(0, TANK_MAX - dry - tank));
  if (room <= 0) return fail('tank_full');

  // Diver Orbit hazard: roll a d6 (a 1 destroys the stack) unless paid past with
  // FINAO. Validate the FINAO balance before mutating anything.
  const wantPay = !!op.hazardPay;
  const finaoPer = hasPrivilege(state, player, 'OPEN_SOURCE_FINAO') ? 3 : HAZARD_COST_PER;
  if (wantPay && finaoPer > (player.aqua | 0)) return fail('insufficient_aqua');
  const gen = makeRng(state.seed, state.rng.cursor);
  const rolls = [];
  let destroyed = false;
  if (wantPay) {
    player.aqua -= finaoPer;
  } else {
    const d6 = gen.d6();
    rolls.push({ slug: here, kind: 'aero', phase: 'diver', d6, crit: d6 === 1 });
    if (d6 === 1) destroyed = true;
  }
  state.rng.cursor = gen.cursor;
  player.rocket.rolls = rolls;

  const siteName = (siteById(here) && siteById(here).name) || here;
  if (destroyed) {
    for (const slot of player.rocket.stack) {
      if (isCrewSlot(slot)) (player.leo = player.leo || []).push({ id: slot.id, kind: 'crew', face: slot.face });
      else player.hand.push(slot.id);
    }
    player.rocket.stack = [];
    player.rocket.activeThrusterId = null;
    player.rocket.activeProspectorId = null;
    player.rocket.tank = 0;
    recallIfEmpty(player);
    player.opsRemaining -= 1;
    return { ok: true, state, rolled: true, log: `${player.name}'s air-eater scoop at ${siteName} burned up in the atmosphere (Diver Orbit roll 1); the stack was lost.` };
  }
  const gain = Math.min(tanks, room);
  player.rocket.tank = round6(tank + gain);
  player.rocket.tankGrade = 'water';
  player.opsRemaining -= 1;
  return {
    ok: true, state, rolled: !wantPay,
    log: `${player.name} air-eater scooped +${gain} water at ${siteName}${wantPay ? ' (FINAO)' : ''} (tank ${round6(player.rocket.tank)}).`,
  };
}

// A site is a valid Promotion Site for a card needing colony `need` (a spectral
// letter, or 'Push'): it must carry a colony dome, and (for a spectral need) the
// factory there must match that spectral. 'Push' / unspecified = any colony.
function colonyPromotes(state, siteId, need) {
  if (!siteId || !state.colonies[siteId]) return false;
  if (!need || need === 'Push') return true;
  const fac = state.factories[siteId];
  return !!(fac && (fac.spectralType || 'C') === need);
}

// Promotion Op (M1/M2, rules: Promotion). Flip a Freighter or GW thruster to its
// Purple-Side (secondary face) at its Promotion Site - a colony dome whose
// factory matches the card's promotion colony. Costs the turn's operation.
function applyPromote(state, op, player) {
  if (!state.m1) return fail('m1_off');
  if (player.opsRemaining <= 0) return fail('no_ops_left');
  if (op.unit === 'freighter') {
    const fr = player.freighter;
    if (!fr) return fail('no_freighter');
    if (fr.promoted || fr.face === 'secondary') return fail('already_promoted');
    const card = PATENTS_BY_ID[fr.cardId];
    if (!colonyPromotes(state, fr.siteId, card && card.promotionColony)) return fail('no_promotion_colony');
    fr.face = 'secondary'; fr.promoted = true;
    // The instant the Freighter promotes, the fleet is born (1B6): name every
    // one of this player's factory cubes so each can be planned + moved.
    for (const f of Object.values(state.factories)) {
      if (f && f.ownerId === player.profileId && !f.tag) f.tag = nextFactoryTag(state, player.profileId);
    }
    player.opsRemaining -= 1;
    const site = siteById(fr.siteId);
    const nm = card && card.faces && card.faces.secondary && card.faces.secondary.name;
    return { ok: true, state, log: `${player.name} promoted the Freighter${nm ? ` to ${nm}` : ''} at ${(site && site.name) || fr.siteId} - the factory fleet is now mobile.` };
  }
  // GW thruster in the rocket stack or an outpost.
  const cardId = String(op.cardId || '');
  const from = String(op.from || 'rocket');
  let slot = null, siteId = null;
  if (from === 'rocket') { slot = player.rocket.stack.find((s) => s.id === cardId); siteId = player.rocket.siteId; }
  else if (from.startsWith('outpost')) {
    const o = player.outposts && player.outposts[from.slice('outpost'.length)];
    if (o) { slot = (o.cards || []).find((s) => s.id === cardId); siteId = o.siteId; }
  }
  if (!slot) return fail('not_in_stack');
  const card = PATENTS_BY_ID[cardId];
  if (!card || card.type !== 'gw-thruster') return fail('not_promotable');
  if (slot.face === 'secondary') return fail('already_promoted');
  if (!colonyPromotes(state, siteId, card.promotionColony)) return fail('no_promotion_colony');
  slot.face = 'secondary';
  player.opsRemaining -= 1;
  const site = siteById(siteId);
  const nm = card.faces && card.faces.secondary && card.faces.secondary.name;
  return { ok: true, state, log: `${player.name} promoted ${nm || cardId} (GW thruster) at ${(site && site.name) || siteId}.` };
}

// Big Cube Swap (rule 1B8): a FREE action. When your Promoted Freighter carries
// no cargo and no glitch, swap its big cube with one of your Factory cubes - the
// Factory (with its colony + claim) moves to the Freighter's spot, the Freighter
// takes the Factory's old site. Does NOT spend the operation or the freighter's
// move. M1-gated. Mirrors the admin move_factory relocation.
function applySwapBigCube(state, op, player) {
  if (!state.m1) return fail('m1_off');
  const fr = player.freighter;
  if (!fr) return fail('no_freighter');
  if (!fr.promoted && fr.face !== 'secondary') return fail('not_promoted');
  if (fr.glitched) return fail('freighter_glitched');
  if ((fr.stack || []).length > 0) return fail('freighter_has_cargo');
  const factorySiteId = String(op.factorySiteId || '');
  const fac = state.factories[factorySiteId];
  if (!fac) return fail('no_factory_here');
  if (fac.ownerId !== player.profileId) return fail('not_your_factory');
  // The Freighter's current spot becomes the Factory's new home: it must be a
  // real Site (not a transit waypoint / LEO) and not already industrialized.
  const frSlug = fr.siteId;
  const frSite = frSlug ? siteById(frSlug) : null;
  if (!frSite) return fail('not_a_site');
  if (frSlug === factorySiteId) return fail('same_site');
  if (state.factories[frSlug]) return fail('target_has_factory');
  // Swap: Factory (+ colony + claim) -> Freighter's old site (spectral follows
  // the new site, like INDUSTRIALIZE); Freighter -> Factory's old site.
  fac.spectralType = frSite.spectralType || fac.spectralType || 'C';
  state.factories[frSlug] = fac;
  delete state.factories[factorySiteId];
  state.colonies = state.colonies || {};
  if (state.colonies[factorySiteId]) { state.colonies[frSlug] = state.colonies[factorySiteId]; delete state.colonies[factorySiteId]; }
  state.discs = state.discs || {};
  if (state.discs[factorySiteId]) { state.discs[frSlug] = state.discs[factorySiteId]; delete state.discs[factorySiteId]; }
  fr.siteId = factorySiteId;
  const facSite = siteById(factorySiteId);
  return { ok: true, state,
    log: `${player.name} swapped the Freighter big cube with the Factory at ${(facSite && facSite.name) || factorySiteId} - the Factory is now at ${frSite.name}.` };
}

// Build a Space Elevator (Epic Hazard operation, rule 1A6 / 1B9). Spends the
// turn's operation. One end must hold the caller's Factory; the caller's cube (a
// Factory or the promoted Freighter) sits at the OTHER end and performs an Epic
// Hazard roll (a single Hazard Roll, avoidable with FINAO). Rolling a 1 fails
// the build AND decommissions that performing unit. Success places the elevator
// and auto-claims any unclaimed connected Site. M1-gated.
function applyBuildElevator(state, op, player) {
  if (!state.m1) return fail('m1_off');
  if (player.opsRemaining <= 0) return fail('no_ops_left');
  const pair = elevatorPairByKey(String(op.pairKey || ''));
  if (!pair) return fail('unknown_elevator');
  state.elevators = state.elevators || {};
  if (state.elevators[pair.key]) return fail('elevator_exists');
  const facA = state.factories[pair.a];
  const facB = state.factories[pair.b];
  const myFacA = !!(facA && facA.ownerId === player.profileId);
  const myFacB = !!(facB && facB.ownerId === player.profileId);
  if (!myFacA && !myFacB) return fail('elevator_needs_factory');
  const factoryEnd = myFacA ? pair.a : pair.b;
  const otherEnd = myFacA ? pair.b : pair.a;
  const facOther = state.factories[otherEnd];
  const myFacOther = !!(facOther && facOther.ownerId === player.profileId);
  const fr = player.freighter;
  const frAtOther = !!(fr && (fr.promoted || fr.face === 'secondary') && fr.siteId === otherEnd);
  if (!myFacOther && !frAtOther) return fail('elevator_needs_cube');
  const nameOf = (slug) => (siteById(slug) && siteById(slug).name) || slug;

  const wantPay = !!op.hazardPay;
  const finaoPer = hasPrivilege(state, player, 'OPEN_SOURCE_FINAO') ? 3 : HAZARD_COST_PER;
  if (wantPay && finaoPer > (player.aqua | 0)) return fail('insufficient_aqua');
  if (op.debug) {
    return { ok: true, state, log: '', calc: { pair: pair.key, factoryEnd, otherEnd, wouldPay: wantPay, performer: frAtOther ? 'freighter' : 'factory' } };
  }

  let rolled = false, d6 = null, failed = false;
  if (wantPay) {
    player.aqua -= finaoPer;
  } else {
    const gen = makeRng(state.seed, state.rng.cursor);
    d6 = gen.d6();
    state.rng.cursor = gen.cursor;
    rolled = true;
    failed = d6 === 1;
  }
  player.opsRemaining -= 1;
  if (failed) {
    let lost = 'unit';
    if (frAtOther) { player.freighter = null; lost = 'Freighter'; }
    else { delete state.factories[otherEnd]; if (state.colonies) delete state.colonies[otherEnd]; lost = 'Factory'; }
    return { ok: true, state, rolled: true,
      log: `${player.name}'s Space Elevator build failed the Epic Hazard (rolled a 1) - the ${lost} at ${nameOf(otherEnd)} was lost.` };
  }
  state.elevators[pair.key] = { ownerId: player.profileId };
  // Auto-claim any unclaimed connected Site (even a Busted one).
  let claimed = false;
  for (const slug of [pair.a, pair.b]) {
    const d = state.discs[slug];
    if (!d || d.outcome !== 'success') {
      state.discs[slug] = { outcome: 'success', ownerId: player.profileId, roll: 1, canReroll: false };
      claimed = true;
    }
  }
  const via = wantPay ? ' (paid FINAO)' : ` (Epic Hazard rolled ${d6})`;
  return { ok: true, state, rolled,
    log: `${player.name} built a Space Elevator between ${nameOf(pair.a)} and ${nameOf(pair.b)}${via}.${claimed ? ' Connected Site claimed.' : ''}` };
}

// dispatcher (not the handler) maintains turnActions / turnRedo.
const FUNCTIONAL = {
  INCOME: applyIncome,
  FUNDRAISE: applyFundraise,
  PROMOTE: applyPromote,
  SWAP_BIG_CUBE: applySwapBigCube,
  BUILD_ELEVATOR: applyBuildElevator,
  LOBBY: applyLobby,
  SITE_REFUEL: applySiteRefuel,
  AIR_EATER_REFUEL: applyAirEaterRefuel,
  DIRT_REFUEL: applyDirtRefuel,
  DELIVERY: applyDelivery,
  BUILD_COLONY: applyBuildColony,
  MOVE: applyMove,
  MOVE_FACTORY: applyMoveFactory,
  MOVE_FLEET: applyMoveFleet,
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
  MINE_REVIVAL: applyMineRevival,
  ET_PRODUCE: applyEtProduce,
  LOAD_GLORY: applyLoadGlory,
  STOW_FREIGHTER: applyStowFreighter,
  DEPLOY_FREIGHTER: applyDeployFreighter,
  STOW_BERNAL: applyStowBernal,
  DEPLOY_BERNAL: applyDeployBernal,
};

function pickPayload(op) {
  switch (op.kind) {
    case 'MOVE': return { toSiteId: op.toSiteId, hazardPay: !!op.hazardPay, segments: op.segments, pickupChit: op.pickupChit !== false };
    case 'MOVE_FACTORY': return { fromSiteId: op.fromSiteId, toSiteId: op.toSiteId, hazardPay: !!op.hazardPay, segments: op.segments };
    case 'MOVE_FLEET': return { moves: op.moves };
    case 'AIR_EATER_REFUEL': return { hazardPay: !!op.hazardPay };
    case 'PROMOTE': return { unit: op.unit, cardId: op.cardId, from: op.from };
    case 'SWAP_BIG_CUBE': return { factorySiteId: op.factorySiteId };
    case 'BUILD_ELEVATOR': return { pairKey: op.pairKey, hazardPay: !!op.hazardPay };
    case 'LOAD_GLORY': return {};
    case 'BUILD_ROCKET': return { cardId: op.cardId, face: op.face, radSide: op.radSide };
    case 'BUY_CARD': return { cardId: op.cardId, free: op.free, cost: op.cost };
    case 'BOOST': return { cardIds: op.cardIds, radSides: op.radSides || {} };
    case 'TRANSFER': return { cardIds: op.cardIds, cardId: op.cardId, from: op.from, to: op.to };
    case 'STOW_FREIGHTER': return { to: op.to };
    case 'DEPLOY_FREIGHTER': return { from: op.from, cardId: op.cardId };
    case 'STOW_BERNAL': return { cardId: op.cardId, to: op.to };
    case 'DEPLOY_BERNAL': return { from: op.from, cardId: op.cardId };
    case 'TRANSFER_FUEL': return { letter: op.letter, amount: op.amount, direction: op.direction };
    case 'DISSOLVE_OUTPOST': return { letter: op.letter };
    case 'DECOMMISSION': return { cardIds: op.cardIds, cardId: op.cardId, from: op.from };
    case 'CLAIM_JUMP': return { siteId: op.siteId };
    case 'REFUEL': return { amount: op.amount };
    case 'CASH_WATER': return { amount: op.amount };
    case 'DUMP': return { amount: op.amount };
    case 'FREE_MARKET': return { cardId: op.cardId, cardIds: op.cardIds, leoCardId: op.leoCardId };
    case 'FUNDRAISE': return { place: op.place, moveFrom: op.moveFrom, moveTo: op.moveTo, discard: op.discard, star: op.star };
    case 'LOBBY': return { ideology: op.ideology };
    case 'DISCARD': return { cardId: op.cardId };
    case 'SET_ACTIVE_THRUSTER': return { cardId: op.cardId };
    case 'SET_ACTIVE_PROSPECTOR': return { cardId: op.cardId };
    case 'SET_RADIATOR_SIDE': return { cardId: op.cardId };
    case 'AFTERBURN': return {};
    case 'PROSPECT': return { siteId: op.siteId, turn: op.turn, round: op.round, relocateFrom: op.relocateFrom };
    case 'PROSPECT_REROLL': return { siteId: op.siteId };
    case 'SITE_REFUEL': return { siteId: op.siteId, mode: op.mode, outpost: op.outpost };
    case 'DIRT_REFUEL': return { amount: op.amount };
    case 'DELIVERY': return { siteId: op.siteId, letter: op.letter, cardId: op.cardId };
    case 'BUILD_COLONY': return { cardId: op.cardId, colonyType: op.colonyType };
    case 'INDUSTRIALIZE': return { siteId: op.siteId, cardIds: op.cardIds, freeDelegate: op.freeDelegate };
    case 'MINE_REVIVAL': return { siteId: op.siteId };
    case 'ET_PRODUCE': return { siteId: op.siteId, cardId: op.cardId, letter: op.letter, isNewOutpost: !!op.isNewOutpost, ...(op.radSide ? { radSide: op.radSide } : {}) };
    // Route ops ride the undo stack like every other functional op, so
    // an UNDO/REDO replay (rebuildFromBase) must carry their payload or
    // the replay would re-run SET_ROUTE with no segments and silently
    // wipe a route the player still has planned.
    case 'SET_ROUTE': return { segments: op.segments, ...(op.unit ? { unit: op.unit } : {}) };
    case 'SET_WIRING': return { wiring: op.wiring };
    case 'CLEAR_ROUTE': return op.unit ? { unit: op.unit } : {};
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
  // M1: the Freighter is a second independent mover - it gets its own one move
  // per turn, separate from the rocket's. Only consumable while a freighter is
  // in play; harmless to refill otherwise.
  player.freighterMovesRemaining = MOVES_PER_TURN;
  player.discardsRemaining = DISCARDS_PER_TURN;
  // One refuel per site per turn: clear the per-turn ledger so the
  // sites this player tapped last turn are refuellable again.
  player.refueledSites = [];
  // Dirt refuel is capped per turn (7 tanks via the moon cable for a non-crew
  // triangle, else 1); reset the per-turn tally.
  player.dirtTanksThisTurn = 0;
  // Afterburn lasts one turn: clear it as the player's next turn opens.
  if (player.rocket) player.rocket.afterburnEngaged = false;
  // M0 Lobby is once per turn and its law-use lasts only this turn.
  player.lobbiedThisTurn = false;
  player.lobbiedLaws = [];
  state.turnActions = [];
  state.turnRedo = [];
  // A rocket parked on an aerobrake corridor takes a fresh descent hazard as the
  // turn opens (user 2026-06-27); the entry turn is never double-rolled (the
  // arriving move ran its own descent roll, and at that turn's open the rocket
  // was not yet on the corridor).
  aerobrakeParkingHazard(state, player);
}

// A rocket PARKED on an aerobrake corridor (the 🪂 parachute space) is still
// falling through the atmosphere, so at the START of each of its turns it takes
// a fresh aero hazard: roll a d6, a 1 is a critical that burns up the whole
// stack (destroyRocket scatters the cards + recalls to LEO). A parachute
// generator aboard (stackSafeAerobrake) rides it out with no roll. (User
// 2026-06-27: you MAY stop on an aerobrake, but staying takes the hazard each
// turn unless a card negates it.)
function aerobrakeParkingHazard(state, player) {
  const r = player.rocket;
  if (!r || !(r.stack || []).length || !isAerobrakeNode(r.siteId)) return;
  if (stackSafeAerobrake(r)) {
    pushNews(state, '\u{1FA82}', `${player.name}'s parked stack rode out the aerobrake (parachute generator, no roll).`);
    return;
  }
  const gen = makeRng(state.seed, state.rng.cursor);
  const d6 = gen.d6();
  state.rng.cursor = gen.cursor;
  if (d6 === 1) {
    const at = (siteById(r.siteId) || {}).name || r.siteId;
    destroyRocket(player);
    pushNews(state, '☠️', `${player.name}'s stack burned up parked on the aerobrake at ${at} (rolled a 1).`);
  } else {
    pushNews(state, '\u{1FA82}', `${player.name}'s parked stack rode out the aerobrake descent (rolled ${d6}).`);
  }
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

  // Borrowed crew abilities run down on the holder's own END_TURN: each timed
  // grant loses a turn and drops at 0. Permanent grants (turnsRemaining null)
  // never expire. The lender's own ability is unaffected (a grant is shared).
  const expired = expireBorrowedAbilities(state, player);
  if (expired.length) log += ' ' + expired.join(' ');

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

  // M0: the round's FIRST player drops one permanent seniority disc on the
  // assembly before the round resolves (game finish + score, or first-player
  // handoff). Freeze the table on that pick (like the handoff). PLACE_SENIORITY
  // resolves it and then calls resolveRoundClose. Non-M0 games skip straight to
  // the resolve.
  if (state.m0) {
    const chooser = state.players[firstIdx];
    state.activeIndex = firstIdx;
    state.pendingSeniority = { chooserId: chooser.profileId };
    state.turnActions = [];
    state.turnRedo = [];
    log += ` ${chooser.name} places a seniority disc on the assembly.`;
    return { ok: true, state, log };
  }
  return resolveRoundClose(state, log);
}

// Finish the round once any M0 seniority placement is done: end the game (with
// scoring) once the round cap is passed, otherwise open the next round (the
// first-player handoff for rotation games, or the same leader again).
function resolveRoundClose(state, log) {
  const n = state.players.length;
  const firstIdx = state.firstPlayerIndex || 0;

  // Game-length cap: finish once the configured number of rounds has been
  // played. Legacy games get maxRounds backfilled (default 5).
  if (state.maxRounds && state.round > state.maxRounds) {
    state.status = 'finished';
    state.finishedAt = Date.now();
    state.pendingFirstPlayer = null;
    state.turnActions = [];
    state.turnRedo = [];
    computeFinalScores(state);
    log += ` Game over after ${state.maxRounds} rounds.` + finalScoreLog(state);
    return { ok: true, state, log };
  }

  log += ` Round ${state.round} begins.`;

  // First-player rotation (rotation-enabled games, 2+ players): the player who
  // led the round just finished names the next first player. Freeze the table on
  // that choice; SET_FIRST_PLAYER opens the new leader's turn.
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

// ----- end-game scoring -----

// Entries in an { [siteId]: { ownerId, ... } } map owned by a player.
function countOwnedBy(map, profileId) {
  let n = 0;
  for (const k in (map || {})) if (map[k] && map[k].ownerId === profileId) n += 1;
  return n;
}
// A player's SUCCESSFUL claim discs (busted scans don't count).
function countSuccessfulClaims(state, profileId) {
  let n = 0;
  for (const k in (state.discs || {})) {
    const d = state.discs[k];
    if (d && d.ownerId === profileId && d.outcome === 'success') n += 1;
  }
  return n;
}
// Total glory chits a player has earned (still aboard + already brought home).
function gloryChitCount(player) {
  const g = player.glory || {};
  return ((g.chits || []).length) + ((g.claimed || []).length);
}
// Does a site have a hazardous lander burn (the planner's landing skull)?
function siteHasHazardLanding(siteId) {
  const n = nodeBySlug(siteId);
  return !!(n && n.hazard);
}
// The winning ideology's end-game award, scored from THIS player's own holdings.
function ideologyAwardVp(state, player, key) {
  const pid = player.profileId;
  const asm = assemblyOf(state);
  switch (key) {
    case 'freedom': return countOwnedBy(state.factories, pid);                 // +1 / factory cube
    case 'authority': return countSuccessfulClaims(state, pid);               // +1 / claim disc
    case 'equality': return countOwnedBy(state.colonies, pid);                // +1 / colony dome
    case 'honor': return gloryChitCount(player);                              // +1 / glory chit
    case 'unity':                                                             // +1 / ideology you sit in
      return IDEOLOGY_ORDER.reduce((s, k) => s + (playerDelegatesInPlace(asm, k, pid) > 0 ? 1 : 0), 0);
    case 'individuality': {
      // +1 per wood/plastic token (claim disc / factory cube / colony dome) on a
      // Site with a hazardous lander burn. Outpost stacks do NOT count.
      let n = 0;
      for (const sid in (state.discs || {})) {
        const d = state.discs[sid];
        if (d && d.ownerId === pid && d.outcome === 'success' && siteHasHazardLanding(sid)) n += 1;
      }
      for (const sid in (state.factories || {})) {
        if (state.factories[sid] && state.factories[sid].ownerId === pid && siteHasHazardLanding(sid)) n += 1;
      }
      for (const sid in (state.colonies || {})) {
        if (state.colonies[sid] && state.colonies[sid].ownerId === pid && siteHasHazardLanding(sid)) n += 1;
      }
      return n;
    }
    default: return 0;
  }
}
// Compute + stash the end-game breakdown on state.finalScores and the assembly
// vote result on state.finalVote. M0 adds the per-cube VP and the winning-
// ideology award; the factory / colony / glory lines score in any game (an
// empty assembly just contributes 0). Ranking: total desc, ties by aqua.
function computeFinalScores(state) {
  const asm = assemblyOf(state);
  const vote = finalVote(asm);
  const winnerKey = vote.winner;
  const winnerName = winnerKey ? ((IDEOLOGY_BY_KEY[winnerKey] || {}).name || winnerKey) : null;
  const m0 = !!state.m0;
  // ALL factories on the map as the shared scorer's plain shape (the global
  // count of each spectral drives its Exploitation Track market price).
  const allFactories = Object.values(state.factories || {})
    .map((f) => ({ ownerId: f.ownerId, spectralType: f.spectralType || 'C' }));
  const firstIdx = state.firstPlayerIndex || 0;
  const scores = state.players.map((p, idx) => {
    const cubeVp = m0 ? playerDelegatesPlaced(asm, p.profileId) : 0;
    const awardVp = (m0 && winnerKey) ? ideologyAwardVp(state, p, winnerKey) : 0;
    const ownColonies = Object.values(state.colonies || {})
      .filter((c) => c && c.ownerId === p.profileId)
      .map((c) => ({ type: c.type || 'other' }));
    const claims = ownedClaimCount(state.discs, p.profileId);
    const outposts = p.outposts ? Object.keys(p.outposts).length : 0;
    const rocket = (p.rocket && Array.isArray(p.rocket.stack) && p.rocket.stack.length > 0) ? 1 : 0;
    const firstPlayer = idx === firstIdx ? 1 : 0;
    // Glory VP is derived from the claimed chits' zone + side via ZONE_CHIT_VPS
    // (the data source), not the running p.glory.vps snapshot, so a chit's value
    // edit revalues banked chits at scoring time.
    const gloryVp = (p.glory && Array.isArray(p.glory.claimed))
      ? p.glory.claimed.reduce((s, c) => s
        + (((ZONE_CHIT_VPS[c.zone] || { front: 1, back: 1 })[c.side === 'back' ? 'back' : 'front']) | 0), 0)
      : 0;
    const b = scorePlayer({
      ownerId: p.profileId, factories: allFactories, ownColonies,
      claims, outposts, rocket, firstPlayer, glory: gloryVp, cubeVp, awardVp,
    });
    return {
      profileId: p.profileId, name: p.name, color: p.color || null,
      cubeVp, awardVp, spectralVp: b.spectralVp, tokenVp: b.tokenVp,
      tokenBreakdown: b.tokenBreakdown, firstPlayer: b.firstPlayer,
      factoryVp: b.factoryCount, colonyVp: b.colonyVp, gloryVp, total: b.total, aqua: p.aqua | 0,
    };
  });
  const ranked = [...scores].sort((a, b) => b.total - a.total || b.aqua - a.aqua);
  ranked.forEach((s, i) => { s.rank = i + 1; });
  state.finalScores = scores;
  state.finalVote = {
    winner: winnerKey,
    winnerName,
    award: winnerKey ? (((IDEOLOGY_BY_KEY[winnerKey] || {}).award || {}).text || null) : null,
    awardTBD: false,
    totals: vote.totals,
    tied: vote.tied,
  };
}
// One-line game-over summary for the op log + galactic news.
function finalScoreLog(state) {
  const fs = state.finalScores || [];
  if (!fs.length) return '';
  const top = [...fs].sort((a, b) => b.total - a.total || b.aqua - a.aqua)[0];
  const fv = state.finalVote || {};
  const voteStr = fv.winnerName ? ` ${fv.winnerName} carried the assembly vote.` : '';
  return `${voteStr}${top ? ` ${top.name} wins with ${top.total} VP.` : ''}`;
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
// Random-draft deal: give each player DRAFT_HAND_SIZE cards drawn from RANDOM
// decks (the decks are pre-shuffled, so a random deck's top card is a random
// card). Uses the seeded RNG and advances state.rng.cursor so the deal replays
// identically from the op log.
function dealRandomDraft(state) {
  const gen = makeRng(state.seed, (state.rng && state.rng.cursor) || 0);
  const types = DECK_TYPES.filter((t) => Array.isArray(state.decks[t]));
  for (const p of state.players) {
    p.hand = p.hand || [];
    while (p.hand.length < DRAFT_HAND_SIZE) {
      const avail = types.filter((t) => state.decks[t].length);
      if (!avail.length) break;   // decks exhausted (only at absurd player counts)
      const t = avail[gen.int(avail.length)];
      p.hand.push(state.decks[t].shift());
    }
  }
  state.rng = state.rng || {};
  state.rng.cursor = gen.cursor;
}
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
    for (const p of state.players) p.aqua = DRAFT_END_AQUA + (state.m1 ? M1_AQUA_BONUS : 0);
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

  // Otherwise just pass the turn to the next seat. NO Sunspot Cube advance and
  // NO events during the draft (the cube is reset to slot 0 / round 1 when the
  // draft completes), so a draft round never fires Inspiration / Glitch / Pad
  // Explosion / etc. A new draft turn also clears the per-turn cycle.
  const n = state.players.length;
  const nextIndex = (state.activeIndex + 1) % n;
  const tail = '';
  state.activeIndex = nextIndex;
  state.draftCycledThisTurn = false;
  openTurnFor(state, state.players[state.activeIndex]);
  return {
    ok: true, state,
    log: `${player.name} drafted ${cardName}.${tail} ${state.players[state.activeIndex].name} is up.`,
  };
}

// Draft cycle: once per draft turn, the active player may CYCLE one deck of
// their choice - the current top card goes to the bottom, revealing the next -
// before they pick. Free (it doesn't take their pick), once per turn.
function applyDraftCycle(state, op, player) {
  if (state.draftCycledThisTurn) return fail('already_cycled');
  const deckType = String(op.deckType || '');
  const deck = state.decks[deckType];
  if (!Array.isArray(deck)) return fail('bad_deck');
  if (deck.length < 2) return fail('cannot_cycle');   // nothing new to reveal
  const top = deck.shift();
  deck.push(top);
  state.draftCycledThisTurn = true;
  const card = PATENTS_BY_ID[top];
  return {
    ok: true, state,
    log: `${player.name} cycled the ${deckType} deck (${card ? card.name : top} to the bottom).`,
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
    // Carry the freighter's separate route too (same secret, per-vehicle plan).
    if (lp && lp.freighter && rebuilt.players[i] && rebuilt.players[i].freighter) {
      rebuilt.players[i].freighter.route = lp.freighter.route;
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
  // M1 games may also auction the two Terawatt decks; an m1-off game is the
  // base six only (zero bleed-through).
  const auctionableDecks = [...DECK_TYPES, ...(state.m1 ? M1_DECK_TYPES : []), ...(state.m2 ? M2_DECK_TYPES : [])];
  if (!auctionableDecks.includes(deckType)) return fail('bad_deck');
  const deck = state.decks[deckType];
  if (!deck || !deck.length) return fail('deck_empty');

  // Equality (Research Grants): instead of opening an auction, pay 1 aqua and
  // take the deck-top card straight into hand (no bidding, no support draw).
  if (op.useEquality && playerCanUseLaw(state, player, 'equality')) {
    if (player.aqua < 1) return fail('insufficient_aqua');
    const grantId = deck.shift();
    player.aqua -= 1;
    (player.hand = player.hand || []).push(grantId);
    player.opsRemaining -= 1;
    // A research op commits the turn (it moves a deck + hand), like an auction.
    state.turnActions = [];
    state.turnRedo = [];
    const gc = PATENTS_BY_ID[grantId];
    return { ok: true, state, log: `${player.name} claimed ${gc ? gc.name : grantId} from the ${deckType} deck for 1 aqua (Research Grants).` };
  }

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
  // M1 ownership cap (1A4): can't bid on a GW thruster / freighter you already
  // own one of - winning it would give you a second, which is illegal.
  const lotCard = PATENTS_BY_ID[a.cardId];
  if (lotCard && ownsSingletonAlready(bidder, lotCard.type)) {
    return fail(lotCard.type === 'freighter' ? 'already_own_freighter' : 'already_own_gw');
  }
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
  // Skunkworks (Shimizu) ignores the academia hand limit when taking the lot.
  if ((winner.hand || []).length >= AUCTION_HAND_LIMIT && !hasPrivilege(state, winner, 'SKUNKWORKS')) return fail('hand_limit');
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

// ----- player-to-player trading (off-turn, both-party consent) -----
//
// A trade is a side-channel negotiation that both parties must consent to. It
// is FREE (never spends an operation) and can be opened AT ANY POINT, on or off
// turn, so like auction ops the TRADE handlers bypass the turn guard and
// validate their own caller. One open trade at a time (v1).
//
// Consent is an offer / counter / accept handshake: an OFFER or COUNTER is the
// sender's consent to those exact terms; an ACCEPT is the awaiting party's
// consent to the same terms - so one accept always means both sides agreed to
// identical (versioned) terms. A counter is a decline-and-re-offer that flips
// who is "awaiting". Either party may decline at any time.
//
// state.trade.give / .receive are stored from the INITIATOR's perspective:
//   give    = items the initiator hands to the partner
//   receive = items the partner hands to the initiator
// Each side has the shape:
//   { aqua, water, handCardIds:[], cargoCardIds:[], abilities:[{ability,turns}] }
// where water + cargoCardIds are IN-SPACE items that need the two rockets
// colocated; aqua, handCardIds, abilities are abstract and trade anywhere.

const TRADE_MAX_TERM = 99;   // sanity cap on a timed ability grant

// Both rockets share a location when both sit at LEO (siteId null) or at the
// same site. Returns 'leo' | <siteId> | null.
function sharedRocketLocation(a, b) {
  const sa = a.rocket ? a.rocket.siteId : undefined;
  const sb = b.rocket ? b.rocket.siteId : undefined;
  if (sa == null && sb == null) return 'leo';
  if (sa != null && sa === sb) return sa;
  return null;
}

function tankRoom(rocket) {
  const dry = rocketDryMass(rocket.stack.reduce((m, s) => m + slotMass(s), 0));
  return Math.max(0, (TANK_MAX - dry) - (rocket.tank || 0));
}

// Normalise one side of a deal off the wire into the canonical shape, dropping
// anything malformed. Caller-supplied, so be defensive.
function normTradeSide(raw) {
  raw = raw || {};
  const ints = (n) => { const v = Math.floor(Number(n)); return Number.isFinite(v) && v > 0 ? v : 0; };
  const ids = (arr) => (Array.isArray(arr) ? arr.map(String) : []);
  const abilities = (Array.isArray(raw.abilities) ? raw.abilities : [])
    .map((g) => {
      const ability = String((g && g.ability) || '');
      if (!ability) return null;
      // turns null/0/absent => permanent; otherwise a positive integer term.
      const t = g && g.turns != null ? Math.floor(Number(g.turns)) : null;
      const turns = Number.isFinite(t) && t > 0 ? Math.min(t, TRADE_MAX_TERM) : null;
      return { ability, turns };
    })
    .filter(Boolean);
  return {
    aqua: ints(raw.aqua),
    water: ints(raw.water),
    handCardIds: ids(raw.handCardIds),
    cargoCardIds: ids(raw.cargoCardIds),
    abilities,
  };
}

function sideHasInSpace(side) {
  return side.water > 0 || side.cargoCardIds.length > 0;
}
function sideIsEmpty(side) {
  return !side.aqua && !side.water && !side.handCardIds.length
    && !side.cargoCardIds.length && !side.abilities.length;
}

// Aqua a player can spend in a trade: their bank, plus - when parked at LEO -
// the water in their tank, which is 1:1 with aqua at the LEO bank (so at LEO
// fuel just IS aqua, for simplicity). Dirt has no cash value, so it never
// counts.
function spendableAqua(player) {
  let a = player.aqua | 0;
  const r = player.rocket;
  if (r && r.siteId == null && r.tankGrade !== 'dirt') a += Math.floor(r.tank || 0);
  return a;
}

// Validate that `owner` can currently deliver everything in `side`. Returns an
// error key, or null when the side is satisfiable. Re-run at accept time, since
// the board may have moved since the offer was made.
function validateTradeSide(state, owner, side) {
  if (spendableAqua(owner) < side.aqua) return 'insufficient_aqua';
  for (const id of side.handCardIds) {
    if (!(owner.hand || []).includes(id)) return 'card_not_in_hand';
  }
  for (const id of side.cargoCardIds) {
    if (!(owner.rocket.stack || []).some((s) => s.id === id)) return 'card_not_aboard';
  }
  if (side.water > 0) {
    if (owner.rocket.tankGrade === 'dirt' && owner.rocket.tank > 0) return 'cannot_trade_dirt';
    if (Math.floor(owner.rocket.tank || 0) < side.water) return 'insufficient_water';
  }
  for (const g of side.abilities) {
    if (!playerOwnsAbility(owner, g.ability)) return 'ability_not_held';
  }
  return null;
}

// Will `receiver` have room for everything `side` brings them? Hand cards are
// NOT limited on a trade (user request): a trade may take a hand OVER the
// auction limit of 4. That limit still gates auctions, so an over-full hand
// just can't start / join one until it's reduced. Water still needs tank room;
// in-space cargo lands in the rocket and is unbounded.
function validateTradeReceipt(receiver, side) {
  if (side.water > 0) {
    if (receiver.rocket.tankGrade === 'dirt' && receiver.rocket.tank > 0) return 'tank_grade_mismatch';
    if (tankRoom(receiver.rocket) < side.water) return 'tank_full';
  }
  return null;
}

// An empty rocket sits at LEO with no active cards; re-pick actives that left
// and clip the tank after a swap moved cards / water.
function reconcileRocketAfterTrade(player) {
  const stack = player.rocket.stack;
  if (!stack.some((s) => s.id === player.rocket.activeThrusterId)) {
    const t = stack.find(isThrusterSlot);
    player.rocket.activeThrusterId = t ? t.id : null;
  }
  if (!stack.some((s) => s.id === player.rocket.activeProspectorId)) {
    const p = stack.find(isProspectorSlot);
    player.rocket.activeProspectorId = p ? p.id : null;
  }
  clipTank(player.rocket);
  recallIfEmpty(player);
}

// Move one side's items from `giver` to `receiver`. Mutates both players.
function executeTradeSide(giver, receiver, side) {
  if (side.aqua) {
    // Pay aqua from the bank first; at LEO any shortfall comes from tank water
    // (1:1 at the bank). The receiver always banks it as aqua.
    let need = side.aqua;
    const fromBank = Math.min(giver.aqua | 0, need);
    giver.aqua = (giver.aqua | 0) - fromBank;
    need -= fromBank;
    if (need > 0) giver.rocket.tank = (giver.rocket.tank || 0) - need;  // LEO water-as-aqua
    receiver.aqua = (receiver.aqua | 0) + side.aqua;
  }
  for (const id of side.handCardIds) {
    const i = (giver.hand || []).indexOf(id);
    if (i >= 0) { giver.hand.splice(i, 1); receiver.hand.push(id); }
  }
  for (const id of side.cargoCardIds) {
    const i = giver.rocket.stack.findIndex((s) => s.id === id);
    if (i >= 0) { const [slot] = giver.rocket.stack.splice(i, 1); receiver.rocket.stack.push(slot); }
  }
  if (side.water > 0) {
    giver.rocket.tank = (giver.rocket.tank || 0) - side.water;
    receiver.rocket.tank = (receiver.rocket.tank || 0) + side.water;
    receiver.rocket.tankGrade = 'water';
  }
  for (const g of side.abilities) {
    receiver.borrowedAbilities = Array.isArray(receiver.borrowedAbilities) ? receiver.borrowedAbilities : [];
    receiver.borrowedAbilities.push({ ability: g.ability, fromPlayerId: giver.profileId, turnsRemaining: g.turns });
  }
}

// Decrement timed borrowed abilities on the holder's END_TURN; drop at 0.
// Returns gameplay notes for the log.
function expireBorrowedAbilities(state, player) {
  const notes = [];
  if (!Array.isArray(player.borrowedAbilities) || !player.borrowedAbilities.length) return notes;
  const keep = [];
  for (const g of player.borrowedAbilities) {
    if (g.turnsRemaining == null) { keep.push(g); continue; }   // permanent
    const left = g.turnsRemaining - 1;
    if (left > 0) { keep.push({ ...g, turnsRemaining: left }); }
    else notes.push(`${player.name}'s borrowed ${abilityLabel(g.ability)} expired.`);
  }
  player.borrowedAbilities = keep;
  return notes;
}

// Human label for a privilege key (TITLE_CASE -> "Title Case").
function abilityLabel(key) {
  return String(key || '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// One-line gameplay summary of a side, from the giver's voice ("2 aqua, Tug").
function tradeSideSummary(state, side) {
  const parts = [];
  if (side.aqua) parts.push(`${side.aqua} aqua`);
  if (side.water) parts.push(`${side.water} fuel`);
  for (const id of side.handCardIds) { const c = PATENTS_BY_ID[id]; parts.push(c ? c.name : id); }
  for (const id of side.cargoCardIds) { const c = PATENTS_BY_ID[id]; parts.push(c ? c.name : id); }
  for (const g of side.abilities) {
    parts.push(`${abilityLabel(g.ability)} (${g.turns == null ? 'permanent' : g.turns + ' turns'})`);
  }
  return parts.length ? parts.join(' + ') : 'nothing';
}

function applyTradeOffer(state, op, ctx) {
  if (state.auction) return fail('auction_in_progress');
  if (state.trade) return fail('trade_in_progress');
  const initiator = playerByProfile(state, ctx.profileId);
  if (!initiator) return fail('not_a_player');
  const partnerId = Number(op.partnerId);
  if (!Number.isInteger(partnerId) || partnerId === initiator.profileId) return fail('bad_partner');
  const partner = playerByProfile(state, partnerId);
  if (!partner) return fail('bad_partner');

  // Terms arrive from the OFFERER's (initiator's) perspective.
  const give = normTradeSide(op.give);
  const receive = normTradeSide(op.receive);
  if (sideIsEmpty(give) && sideIsEmpty(receive)) return fail('empty_trade');

  // In-space items (fuel / cargo) on EITHER side need the rockets colocated at
  // a SITE. At LEO fuel is just aqua (1:1 at the bank), so fuel/cargo can only
  // change hands when both ships are parked together out at a site/node.
  const needsColo = sideHasInSpace(give) || sideHasInSpace(receive);
  const location = needsColo ? sharedRocketLocation(initiator, partner) : null;
  if (needsColo && (!location || location === 'leo')) return fail('fuel_needs_site');

  // Light pre-validation so a malformed offer is rejected up front; accept
  // re-validates against the live board.
  let err = validateTradeSide(state, initiator, give) || validateTradeSide(state, partner, receive);
  if (err) return fail(err);

  state.trade = {
    initiatorId: initiator.profileId,
    partnerId: partner.profileId,
    awaiting: 'partner',
    version: 1,
    give, receive, location,
  };
  return {
    ok: true, state,
    log: `${initiator.name} offered ${partner.name} a trade: gives ${tradeSideSummary(state, give)} for ${tradeSideSummary(state, receive)}.`,
  };
}

function applyTradeCounter(state, op, ctx) {
  const t = state.trade;
  if (!t) return fail('no_trade');
  const caller = playerByProfile(state, ctx.profileId);
  if (!caller) return fail('not_a_player');
  if (caller.profileId !== t.initiatorId && caller.profileId !== t.partnerId) return fail('not_in_trade');
  const callerRole = caller.profileId === t.initiatorId ? 'initiator' : 'partner';
  // Only the party currently on the clock may counter (the one who received
  // the last offer); the sender is already waiting on a reply.
  if (t.awaiting !== callerRole) return fail('not_awaiting_you');

  // Counter terms arrive from the CALLER's perspective; store from the
  // initiator's. If the partner is countering, swap the sides.
  let give = normTradeSide(op.give);
  let receive = normTradeSide(op.receive);
  if (callerRole === 'partner') { const tmp = give; give = receive; receive = tmp; }
  if (sideIsEmpty(give) && sideIsEmpty(receive)) return fail('empty_trade');

  const initiator = playerByProfile(state, t.initiatorId);
  const partner = playerByProfile(state, t.partnerId);
  const needsColo = sideHasInSpace(give) || sideHasInSpace(receive);
  const location = needsColo ? sharedRocketLocation(initiator, partner) : null;
  if (needsColo && (!location || location === 'leo')) return fail('fuel_needs_site');
  let err = validateTradeSide(state, initiator, give) || validateTradeSide(state, partner, receive);
  if (err) return fail(err);

  t.give = give; t.receive = receive; t.location = location;
  t.version = (t.version || 1) + 1;
  t.awaiting = callerRole === 'initiator' ? 'partner' : 'initiator';
  return { ok: true, state, log: `${caller.name} countered the trade.` };
}

function applyTradeAccept(state, op, ctx) {
  const t = state.trade;
  if (!t) return fail('no_trade');
  const caller = playerByProfile(state, ctx.profileId);
  if (!caller) return fail('not_a_player');
  if (caller.profileId !== t.initiatorId && caller.profileId !== t.partnerId) return fail('not_in_trade');
  const callerRole = caller.profileId === t.initiatorId ? 'initiator' : 'partner';
  // Only the party who received the latest terms accepts; that one accept is
  // the second consent (the sender already consented by offering).
  if (t.awaiting !== callerRole) return fail('not_awaiting_you');
  // Accept must land on the terms currently on the table.
  if (op.version != null && Number(op.version) !== t.version) return fail('trade_stale');

  const initiator = playerByProfile(state, t.initiatorId);
  const partner = playerByProfile(state, t.partnerId);
  if (!initiator || !partner) return fail('not_in_trade');

  // Re-validate against the live board (someone may have moved or spent).
  const needsColo = sideHasInSpace(t.give) || sideHasInSpace(t.receive);
  if (needsColo && sharedRocketLocation(initiator, partner) !== t.location) return fail('not_colocated');
  let err = validateTradeSide(state, initiator, t.give) || validateTradeSide(state, partner, t.receive)
    || validateTradeReceipt(partner, t.give) || validateTradeReceipt(initiator, t.receive);
  if (err) return fail(err);

  // Atomic swap. Both sides resolved off the same pre-swap balances above.
  executeTradeSide(initiator, partner, t.give);
  executeTradeSide(partner, initiator, t.receive);
  reconcileRocketAfterTrade(initiator);
  reconcileRocketAfterTrade(partner);

  const giveSum = tradeSideSummary(state, t.give);
  const recvSum = tradeSideSummary(state, t.receive);
  state.trade = null;
  return {
    ok: true, state,
    log: `${initiator.name} traded ${giveSum} to ${partner.name} for ${recvSum}.`,
  };
}

function applyTradeDecline(state, op, ctx) {
  const t = state.trade;
  if (!t) return fail('no_trade');
  const caller = playerByProfile(state, ctx.profileId);
  if (!caller) return fail('not_a_player');
  if (caller.profileId !== t.initiatorId && caller.profileId !== t.partnerId) return fail('not_in_trade');
  const other = playerByProfile(state, caller.profileId === t.initiatorId ? t.partnerId : t.initiatorId);
  state.trade = null;
  return {
    ok: true, state,
    log: `${caller.name} called off the trade with ${other ? other.name : 'the other player'}.`,
  };
}

const TRADE = {
  TRADE_OFFER: applyTradeOffer,
  TRADE_COUNTER: applyTradeCounter,
  TRADE_ACCEPT: applyTradeAccept,
  TRADE_DECLINE: applyTradeDecline,
};

// ----- Factory access (Request -> standing Grant) -----
//
// A player may REQUEST to use another player's Factory (for ET Production / Site
// Refuel); the owner GRANTS a standing permission (honoured by
// canUseFactoryNonVictory until REVOKEd) or DENIES it. Free, consent-based, off
// turn - like trades these validate their own caller and bypass the turn guard.
// Requests + grants live on the factory object (fac.requests / fac.grants) so
// they reset when the cube relocates (a fresh factory object).
function facAccessCaller(state, op, ctx) {
  const caller = playerByProfile(state, ctx.profileId);
  if (!caller) return { err: 'not_a_player' };
  const siteId = String(op.siteId || '');
  const fac = state.factories[siteId];
  if (!fac) return { err: 'no_factory' };
  return { caller, fac, siteId, site: siteById(siteId) };
}
function applyRequestFactoryUse(state, op, ctx) {
  const r = facAccessCaller(state, op, ctx);
  if (r.err) return fail(r.err);
  const { caller, fac, siteId, site } = r;
  if (fac.ownerId === caller.profileId) return fail('your_own_factory');
  const key = String(caller.profileId);
  if (fac.grants && fac.grants[key]) return fail('already_granted');
  fac.requests = fac.requests || {};
  fac.requests[key] = true;
  const owner = state.players.find((p) => p.profileId === fac.ownerId);
  return { ok: true, state, log: `${caller.name} asked ${owner ? owner.name : 'the owner'} to use the Factory at ${(site && site.name) || siteId}.` };
}
function applyGrantFactoryUse(state, op, ctx) {
  const r = facAccessCaller(state, op, ctx);
  if (r.err) return fail(r.err);
  const { caller, fac, siteId, site } = r;
  if (fac.ownerId !== caller.profileId) return fail('not_your_factory');
  const key = String(op.granteeId == null ? '' : op.granteeId);
  const grantee = state.players.find((p) => String(p.profileId) === key);
  if (!grantee) return fail('bad_grantee');
  if (fac.requests) delete fac.requests[key];
  fac.grants = fac.grants || {};
  fac.grants[key] = true;
  return { ok: true, state, log: `${caller.name} granted ${grantee.name} access to the Factory at ${(site && site.name) || siteId}.` };
}
function applyDenyFactoryUse(state, op, ctx) {
  const r = facAccessCaller(state, op, ctx);
  if (r.err) return fail(r.err);
  const { caller, fac, siteId, site } = r;
  if (fac.ownerId !== caller.profileId) return fail('not_your_factory');
  const key = String(op.granteeId == null ? '' : op.granteeId);
  if (fac.requests) delete fac.requests[key];
  const grantee = state.players.find((p) => String(p.profileId) === key);
  return { ok: true, state, log: `${caller.name} declined ${grantee ? grantee.name : 'a'} request to use the Factory at ${(site && site.name) || siteId}.` };
}
function applyRevokeFactoryUse(state, op, ctx) {
  const r = facAccessCaller(state, op, ctx);
  if (r.err) return fail(r.err);
  const { caller, fac, siteId, site } = r;
  if (fac.ownerId !== caller.profileId) return fail('not_your_factory');
  const key = String(op.granteeId == null ? '' : op.granteeId);
  if (fac.grants) delete fac.grants[key];
  const grantee = state.players.find((p) => String(p.profileId) === key);
  return { ok: true, state, log: `${caller.name} revoked ${grantee ? grantee.name : 'a player'}'s access to the Factory at ${(site && site.name) || siteId}.` };
}
const FACTORY_ACCESS = {
  REQUEST_FACTORY_USE: applyRequestFactoryUse,
  GRANT_FACTORY_USE: applyGrantFactoryUse,
  DENY_FACTORY_USE: applyDenyFactoryUse,
  REVOKE_FACTORY_USE: applyRevokeFactoryUse,
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
  // Multiplayer (2+ seats): one colour only - a player may only pick crew of
  // their assigned seat colour (each colour is one double-sided card; they pick
  // one of its two faces). A 1-player room is a free pick of any crew.
  if (state.players.length > 1 && card.color && player.color && card.color !== player.color) {
    return fail('wrong_crew_color');
  }
  const switching = !!player.faction;
  player.faction = { cardId, face };
  // The picked crew card carries one of the six faction-band colours; that is
  // now the player's seat colour (the colour follows the crew, not the other
  // way round). Since each card is claimed by one player, seat colours stay
  // unique.
  if (card.color) player.color = card.color;
  // M0: a faction's colour IS its ideology, so seat the player's starting
  // delegate in the matching ideology - the cube's colour lines up with the
  // zone it sits in. createInitialState already seated by the seat colour, but
  // re-seat here off the actually-picked card colour so a re-pick (solo can pick
  // any colour; multiplayer is colour-locked) moves the cube to the right spot.
  if (state.m0) {
    const asm = state.assembly || (state.assembly = freshAssembly());
    const prev = state.homeIdeology && state.homeIdeology[player.profileId];
    const ide = seatStartingDelegate(asm, player.profileId, card.color, prev);
    if (ide) {
      state.homeIdeology = state.homeIdeology || {};
      state.homeIdeology[player.profileId] = ide;
    }
  }
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
    if (state.randomDraft) {
      // Random draft: deal each player a full hand from random decks and open
      // normal play immediately (banks at DRAFT_END_AQUA), no interactive draft.
      dealRandomDraft(state);
      for (const p of state.players) p.aqua = DRAFT_END_AQUA + (state.m1 ? M1_AQUA_BONUS : 0);
      state.draftPhase = 'play';
      state.turn = 0;
      state.round = 1;
      state.lastEvent = null;
      state.activeIndex = state.firstPlayerIndex || 0;
      openTurnFor(state, state.players[state.activeIndex]);
    } else if (state.draftStart) {
      state.draftPhase = 'draft';
      state.draftCycledThisTurn = false;
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
  // Compare ids type-agnostically (string-vs-number mismatches between the op
  // payload, the state, and the chooser id were making every pick bounce with
  // unknown_player - "I can't select the first player").
  const sameId = (a, b) => String(a) === String(b);
  if (!sameId(pending.chooserId, ctx.profileId)) return fail('not_first_player_chooser');
  const targetIdx = state.players.findIndex((p) => sameId(p.profileId, op.profileId));
  if (targetIdx < 0) return fail('unknown_player');
  // "another player": the first-player token must move off the chooser.
  if (sameId(state.players[targetIdx].profileId, pending.chooserId)) {
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

// ----- seniority disc (M0 round-end) -----
//
// When an M0 round closes, END_TURN sets pendingSeniority and freezes the
// table; the player who led that round drops ONE permanent neutral seniority
// disc on an assembly space of their choice (these count toward the end-game
// vote and break its ties). Like SET_FIRST_PLAYER it validates its own caller
// and runs while the table is frozen, then hands off to resolveRoundClose
// (which finishes + scores the game, or opens the first-player handoff).
function applyPlaceSeniority(state, op, ctx) {
  const pending = state.pendingSeniority;
  if (!pending) return fail('no_seniority_pending');
  const sameId = (a, b) => String(a) === String(b);
  if (!sameId(pending.chooserId, ctx.profileId)) return fail('not_seniority_chooser');
  const place = String(op.place || '');
  if (!ASSEMBLY_PLACES.includes(place)) return fail('bad_place');
  const asm = assemblyOf(state);
  asm.seniority = asm.seniority || {};
  asm.seniority[place] = (asm.seniority[place] | 0) + 1;
  state.pendingSeniority = null;
  const chooser = playerByProfile(state, pending.chooserId);
  const placeName = place === 'centrist' ? 'Centrist' : ((IDEOLOGY_BY_KEY[place] || {}).name || place);
  const log = `${chooser ? chooser.name : 'The first player'} placed a seniority disc on ${placeName}.`;
  return resolveRoundClose(state, log);
}

const LIFECYCLE = {
  SET_FIRST_PLAYER: applySetFirstPlayer,
  PLACE_SENIORITY: applyPlaceSeniority,
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
      if (op.kind !== 'DRAFT_PICK' && op.kind !== 'DRAFT_CYCLE') return fail('draft_in_progress');
      if (!isPlayersTurn(prevState, ctx.profileId)) return fail('not_your_turn');
      const st = clone(prevState);
      if (op.kind === 'DRAFT_CYCLE') return applyDraftCycle(st, op, currentPlayer(st));
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
  // Trades are a consensual side-channel (below) that never freeze the table,
  // so an unsettled event debt does not block them either - a player owing a
  // Budget Cuts discard can still deal cards while their dialog sits minimized.
  // Every OTHER op on their turn still waits on the choice.
  if (prevState.pendingEvent && !op.debug && !TRADE[op.kind]
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

  if (prevState.pendingSeniority) return fail('awaiting_seniority');
  if (prevState.pendingFirstPlayer) return fail('awaiting_first_player');

  // Auction ops bypass the turn guard below - bids/passes are sent
  // by non-active players, and each handler validates its own caller
  // against the auction roles.
  if (AUCTION[op.kind]) return AUCTION[op.kind](clone(prevState), op, ctx);

  // Trade ops are a side-channel deal: free, both-party consent, allowed at any
  // point on or off turn. Like auction ops they bypass the turn guard and
  // validate their own caller. They do NOT freeze the table - other players keep
  // playing - but they refuse to open while an auction is up (the handlers check
  // state.auction) to avoid two competing multi-party surfaces.
  if (TRADE[op.kind]) return TRADE[op.kind](clone(prevState), op, ctx);
  // Factory-access requests / grants are consent-based + inert (they only flip a
  // permission), so like trades they run off turn against the CALLER and bypass
  // the turn guard. An open auction does not block them (they touch no auction
  // state), matching trades.
  if (FACTORY_ACCESS[op.kind]) return FACTORY_ACCESS[op.kind](clone(prevState), op, ctx);

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
  ...Object.keys(TRADE), ...Object.keys(FACTORY_ACCESS),
  ...Object.keys(CREW), ...Object.keys(LIFECYCLE), 'DRAFT_PICK', 'DRAFT_CYCLE', 'EVENT_CHOICE',
];
// Ops that require the caller to supply ctx.turnBaseState.
export const NEEDS_TURN_BASE = new Set(['UNDO', 'REDO']);
