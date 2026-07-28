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
import { BERNALS_BY_ID, solarCellThrustBonus, bernalPrivilegeGrant } from '../../data/bernals.js';
import { COLONISTS_BY_ID } from '../../data/colonists.js';
// One card-lookup table for the engine: patents PLUS the M2 Bernal + Colonist
// cards (which live in data/bernals.js / data/colonists.js, not PATENTS,
// because patents.js can't import them - circular). Both only ever ENTER play
// through m2-gated paths (the m2 deck / the colonist queue), so a non-m2 game
// never queries one; the merged map is just a lookup, it activates nothing.
// Used for every PATENTS_BY_ID[id] read below.
const PATENTS_BY_ID = { ..._PATENTS_BY_ID, ...BERNALS_BY_ID, ...COLONISTS_BY_ID };
import { resolveSupportChain } from '../../data/support-chain.js';
import { CREW_BY_ID, PROMO_CREW } from '../../data/crew.js';
const PROMO_CREW_IDS = new Set(PROMO_CREW.map((c) => c.id));
// Structured patent card POWERS behind each face's free-text Ability (the
// sheet carries the text; this maps it to engine flags). Shared with the
// client, same as fuel-graph / support-chain.
import {
  facePower, sumColocatedSizeRollMod, sumColocatedIsruMod, anyColocatedNanitesReroll,
} from '../../data/card-abilities.js';
// Shared fuel-strip model (same module the client uses): a burn spends fuel
// STEPS (black connections), and the water it costs is the non-linear mass
// drop, leaving a possibly-fractional remainder.
import { blackStepsBetween, walkBlackDown, walkRedUp, redStepsBetween, rocketDryMass } from '../../data/fuel-graph.js';
import { aeroHopAllowed } from '../../data/aerobrake-direction.js';
// Endgame VP math, shared with the client live panel + game-over modal so the
// authoritative score can never drift from what players see.
import { scorePlayer, freeMarketBlackSideValue } from '../../data/endgame-scoring.js';
// Net-thrust band (weight class) + solar-zone modifiers, the same pure
// tables the client folds into rocket.js#getActiveThrusterStats. The
// engine reads them so the liftoff/landing gate uses the FINAL net thrust,
// not the printed base value.
import { weightClassForMass, freighterNetThrust } from '../../data/net-thrust-track.js';
import { SOLAR_ZONE_INFO, adjacentSites } from '../../data/sites.js';
// Site location classes (astrobiology / submarine / atmospheric / elevator),
// shared with the client (colony types + promotion colonies + futures).
import { colonyClassOfSite, isAtmosphericSite, isAerostatSiteId } from '../../data/site-categories.js';
// M2 Futures: the structured goals behind each purple face's printed Future
// text (requirement checklists, star VP, endgame re-checks, standing effects).
import { futureGoalForCard, checkFutureGoal, SYNODIC_SITE_IDS, SYNODIC_COMET_IDS } from '../../data/future-goals.js';
// M2 Colonists: the structured powers behind each colonist face's printed
// ability text (the card-abilities.js pattern).
import { colonistPower } from '../../data/colonist-abilities.js';
import { elevatorPairByKey, elevatorPairKey } from '../../data/space-elevators.js';
import { isFlareSheltered } from '../../data/flare-shelter.js';
import { ZONE_CHIT_VPS } from '../../data/zone-chits.js';
import {
  activeLaws, freshAssembly, ASSEMBLY_PLACES, IDEOLOGY_ORDER,
  delegatesRemaining, playerDelegatesInPlace, playerDelegatesPlaced,
  seniorityInPlace, finalVote, IDEOLOGY_BY_KEY, adjacentPlaces,
  voteWinners, seatStartingDelegate, seatCeoSoloCentristDelegate,
  ideologyForColorName, ideologyForFactionColor,
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
  neighborSlugs, siteHasLanderBurn, isLanderBurnNode, isHomeBernalSite,
} from './planner-graph.js';
import { siteHasHazardousLanderBurn } from '../../data/lander-burn.js';
import { isBuggyRoamBody, isBuggyRoadPair } from '../../data/buggy-roam.js';
import {
  railsBlock as tutorialRailsBlock, tutorialD6, advanceTutorial,
  botMove as tutorialBotMove, TUTORIAL_MISSION_CARDS, TUTORIAL_STACK_PARTS,
  currentStep as tutorialCurrentStep,
  grantRemainingParts as tutorialGrantParts,
} from './tutorial.js';
import { makeRng, shuffle } from './rng.js';
// isAerostatSite is NOT imported: the engine already has one of its own below.
import { sirenGloryBlocked, isAtHomeBase, homeBaseSiteId, isSirenPlayer, isSirenFaction,
  splitDeckForSpecies, splitDeckForSoloSpecies, needsSpeciesSplit,
  SIREN_RAD_HARDNESS, SIREN_HEROISM_VP, HEROISM_CHIT_ZONE, isHeroismChit,
  isUranianMoon, homeOrbitAllowsSpecies } from '../../data/sirens.js';
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
  // A fuel cargo card weighs the fuel it holds (fuel has mass), so hauling it
  // costs burns like any cargo. Loading it into a tank is mass-neutral.
  if (slot.kind === 'fuel') return Math.max(0, Math.floor(Number(slot.amount) || 0));
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

// Loading fuel into a rocket / Bernal tank walks UP the red (refuel) line one
// step per unit of fuel, the mirror of a burn walking DOWN the black line. Each
// red step lands the wet chit on the next node, gaining the ladder's (non-
// linear) mass - heavier stacks gain less per step, the intended "more fuel,
// less efficiency" curve. Never a straight linear add: that left the wet mass
// BETWEEN nodes so the tank number and the fuel strip disagreed. Outpost tanks
// are a plain off-ladder water store and keep their linear add. `dry` is the
// vehicle's dry mass, `tank` its current fuel (wet - dry), `steps` how many
// fuel steps to load (pass Infinity to fill to the cap). Returns the new tank
// value and how many steps actually loaded (clamped at the top of the ladder).
// Shared byte-for-byte with the client via data/fuel-graph.js so a load the
// client shows is the load the server records.
function loadFuelUpLadder(dry, tank, steps) {
  const wet = (Number(dry) || 0) + (Number(tank) || 0);
  const room = redStepsBetween(wet);
  const k = Math.min(Math.max(0, Math.floor(Number(steps) || 0)), room);
  if (k <= 0) return { tank: round6(Number(tank) || 0), steps: 0 };
  return { tank: round6(walkRedUp(wet, k) - (Number(dry) || 0)), steps: k };
}

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

// Does a stack carry an Atmospheric Scoop (SCOOP power)? Defaults to the rocket
// stack; a prospect from another stack (freighter / bernal / outpost) passes
// that stack's cards so the scoop must ride the PROSPECTING stack, not the
// rocket.
function playerHasAtmoScoop(player, stack) {
  const cards = stack || (player && player.rocket && player.rocket.stack) || [];
  return cards.some((s) => {
    const pw = powerOfSlot(s);
    return pw && pw.aerostatHydration2;
  });
}

// Effective hydration of a site for a player's prospect / refuel (subsystem 5).
// Atmospheric Scoop (SCOOP) makes an aerostat site COLOCATED with or ADJACENT
// to the scoop count as hydration 2. The scoop rides the stack doing the work,
// so colocated = that stack parked at the site, adjacent = parked one map edge
// away. `unit` = { stack, siteId } for a non-rocket prospect; defaults to the
// rocket so every existing caller is unchanged.
function effectiveHydration(site, player, unit) {
  const base = Number.isFinite(site && site.hydration) ? site.hydration : 0;
  const stack = unit ? unit.stack : (player.rocket && player.rocket.stack);
  const here = unit ? unit.siteId : (player.rocket && player.rocket.siteId);
  if (!isAerostatSite(site) || !playerHasAtmoScoop(player, stack)) return base;
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

// ----- Bernal (M2 colony) fuel-tank helpers. A Bernal is a dirt crawler that
// carries its OWN tank (bn.tank) on top of the colony card + its cargo. These
// mirror the rocket helpers (rocketDryMass / tankGradeOf / clipTank) so the
// Bernal dump / scoop / transfer ops reuse the same logic the rocket uses. -----
function bernalDryMass(bn) {
  if (!bn) return 1;
  const cardMass = slotMass({ id: bn.cardId, face: bn.face === 'secondary' ? 'secondary' : 'primary' });
  const cargo = (bn.stack || []).reduce((m, s) => m + slotMass(s), 0);
  return rocketDryMass(cardMass + cargo);
}
function bernalTankGrade(bn) {
  // Default DIRT: a Bernal is a dirt crawler, so an empty tank reads + behaves
  // as dirt (the grade it scoops next). It CAN hold water too (a dirt crawler
  // burns water), in which case the grade is water. Isotope never applies.
  if (bn && bn.tankGrade === 'water') return 'water';
  return 'dirt';
}
function clipBernalTank(bn) {
  const cap = Math.max(0, TANK_MAX - bernalDryMass(bn));
  if ((Number(bn.tank) || 0) > cap) bn.tank = round6(cap);
}
// Resolve the bernal unit a fuel op targets: op.unit is 'bernal0' | 'bernal1'.
function bernalForUnit(player, unit) {
  if (typeof unit !== 'string' || !unit.startsWith('bernal')) return null;
  return (player.bernals || [])[Number(unit.slice('bernal'.length)) || 0] || null;
}
// Uniform handle for a fuel-holding endpoint (rocket / bernalN / outpostX), so
// the generalised TRANSFER_FUEL can move water between any colocated pair the
// same way (read/write its tank, its room, its grade, its site). Returns null
// for an unknown or absent endpoint.
function fuelEndpoint(state, player, id) {
  if (id === 'rocket') {
    const dry = rocketDryMass(player.rocket.stack.reduce((m, s) => m + slotMass(s), 0));
    return {
      label: 'the rocket', kind: 'rocket',
      getTank: () => Number(player.rocket.tank) || 0,
      setTank: (v) => { player.rocket.tank = round6(v); },
      grade: () => tankGradeOf(player.rocket),
      setGrade: (g) => { player.rocket.tankGrade = g; },
      cap: Math.max(0, TANK_MAX - dry),
      site: player.rocket.siteId == null ? null : player.rocket.siteId,
    };
  }
  if (typeof id === 'string' && id.startsWith('bernal')) {
    const bn = bernalForUnit(player, id);
    if (!bn) return null;
    return {
      label: 'the Bernal', kind: 'bernal',
      getTank: () => Number(bn.tank) || 0,
      setTank: (v) => { bn.tank = round6(v); },
      grade: () => bernalTankGrade(bn),
      setGrade: (g) => { bn.tankGrade = g; },
      cap: Math.max(0, TANK_MAX - bernalDryMass(bn)),
      site: bn.siteId == null ? null : bn.siteId,
    };
  }
  if (typeof id === 'string' && id.startsWith('outpost')) {
    const o = player.outposts && player.outposts[id.slice('outpost'.length)];
    if (!o) return null;
    return {
      label: `Outpost ${id.slice('outpost'.length)}`, kind: 'outpost',
      getTank: () => Number(o.tank) || 0,
      setTank: (v) => { o.tank = round6(v); },
      grade: () => 'water',            // outposts only ever store water
      setGrade: () => {},
      cap: Infinity,                   // a water store has no wet-mass cap
      site: o.siteId == null ? null : o.siteId,
    };
  }
  return null;
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
// `stack` is whichever of the player's units is actually parked at `site` -
// the rocket, the freighter, or (in principle) a Bernal - defaulting to the
// rocket's stack so the existing rocket-arrival call site is unchanged.
function maybeAwardGlory(state, player, site, turn, stack = player.rocket.stack) {
  if (!site || !site.solarZone) return null;
  if (player.glory.visited.includes(site.solarZone)) return null;
  // Game-wide single-claim rule: if any player already retrieved this zone's
  // chit there is nothing left here to pick up. Without this gate two rockets
  // that both reach a new zone each award themselves the same chit (the
  // reported bug); the per-player visited check above only stops a player from
  // re-claiming their own.
  if (zoneChitTaken(state, site.solarZone)) return null;
  // A glory chit is loaded by a Human: only claim it (and only mark the
  // zone visited) when a Human is aboard whichever unit sits at the site. A
  // Human is either a Crew or a Human Colonist (1D1a), so a colonist can load
  // a chit too - and it's not rocket-only, since a Freighter (or a Bernal)
  // can carry a Human just as well. Mirror of the client's willAwardChit
  // `crewAboard` gate - a Human-less stack leaves the chit on the site for a
  // later, crewed visit to load.
  if (!stackHasHuman(state, stack)) return null;
  // Glory Carry Limit (rule a): each Crew or Colonist carries at most ONE glory
  // chit, so the number of carried chits can't exceed the Humans aboard. When
  // every carrier already holds a chit there is no free hand to take this one,
  // so it stays on its Glory space (the player must surrender one first).
  if ((player.glory.chits || []).length >= gloryCarriers(state, player)) return null;
  player.glory.visited.push(site.solarZone);
  // Bind the chit to the specific Human that grabbed it (mirror of the client's
  // awardChitForZone crewId). The chit then FOLLOWS that card between stacks and
  // resolves off it: back (high) only when that crew rides home alive, front
  // (low) when it colonises / dies / the game ends still carrying it.
  const crewId = pickGloryCarrier(state, player, stack);
  const chit = { zone: site.solarZone, earnedTurn: turn, crewId: crewId || null };
  player.glory.chits.push(chit);
  return chit;
}

// Glory Carry Limit (rule a): how many glory chits a player may carry at once =
// the number of Humans (Crew + Human Colonists) in play, since each Human carries
// at most one chit. A chit follows its crew into any stack the player controls
// (rocket, LEO, outposts, freighter, Bernals), so every one of those Humans is a
// potential carrier, not just the ones aboard the rocket.
function gloryCarriers(state, player) {
  let n = 0;
  const count = (slots) => { for (const s of (slots || [])) if (isHumanSlot(state, s)) n += 1; };
  count(player.leo);
  count(player.rocket && player.rocket.stack);
  for (const o of Object.values(player.outposts || {})) if (o) count(o.cards);
  if (player.freighter) count(player.freighter.stack);
  for (const bn of (player.bernals || [])) if (bn) count(bn.stack);
  return n;
}

// Which Human aboard the rocket should carry a newly loaded glory chit: the
// first Crew / Human Colonist whose card is not already holding one (Glory Carry
// Limit: one chit per Human). The chit binds to THAT card id and follows it into
// any stack the player moves it to. Returns a card id, or null if none is free.
// `stack` is whichever unit is actually loading the chit (rocket by default,
// or the Freighter / a Bernal when THAT unit is the one at the site) - the
// carrier must be a Human physically aboard the loading unit, not just
// anywhere in the player's tableau.
function pickGloryCarrier(state, player, stack = player.rocket && player.rocket.stack) {
  const taken = new Set(((player.glory && player.glory.chits) || [])
    .map((c) => c && c.crewId).filter(Boolean));
  for (const s of (stack || [])) {
    if (isHumanSlot(state, s) && !taken.has(s.id)) return s.id;
  }
  return null;
}

// Is the Human card `cardId` still in play anywhere in this player's stacks
// (LEO, rocket, an outpost / factory, the freighter, a Bernal)? Used to tell
// whether a glory chit's carrier is still around, or has died / colonised / been
// decommissioned (in which case the chit is orphaned home at front value).
function humanCardInPlay(state, player, cardId) {
  if (!cardId) return false;
  const inArr = (slots) => (slots || []).some((s) => s && s.id === cardId && isHumanSlot(state, s));
  if (inArr(player.leo)) return true;
  if (inArr(player.rocket && player.rocket.stack)) return true;
  for (const o of Object.values(player.outposts || {})) if (o && inArr(o.cards)) return true;
  if (player.freighter && inArr(player.freighter.stack)) return true;
  for (const bn of (player.bernals || [])) if (bn && inArr(bn.stack)) return true;
  return false;
}

// Migrate + reconcile ownerless glory chits so an in-progress game (whose chits
// were carried as an anonymous count, no crewId) starts following a real crew:
//  - bind each ownerless carried chit to a Human ON THE ROCKET STACK (that is
//    who is carrying it), one chit per Human;
//  - any ownerless chit with NO free rocket crew to carry it is scored at FRONT
//    (low) value and banked home to LEO (glory.claimed).
// Bound chits (crewId set) are left alone: they follow their specific crew and
// resolve via homeOrphanedGloryChits / cashHomeGloryChits. `commit` gates the
// scoring + news: the op path commits (persists + logs), the read-only snapshot
// view binds for display only and never scores. Returns the log notes.
export function migrateGloryCrewBindings(state, { commit = false } = {}) {
  const notes = [];
  for (const p of (state.players || [])) {
    if (!p.glory || !Array.isArray(p.glory.chits) || !p.glory.chits.length) continue;
    const taken = new Set(p.glory.chits.map((c) => c && c.crewId).filter(Boolean));
    const rocketHumans = ((p.rocket && p.rocket.stack) || [])
      .filter((s) => isHumanSlot(state, s)).map((s) => s.id);
    const unbound = [];
    for (const c of p.glory.chits) {
      if (!c || c.crewId) continue;                 // already bound: leave it
      const free = rocketHumans.find((id) => !taken.has(id));
      if (free) { c.crewId = free; taken.add(free); }
      else unbound.push(c);
    }
    if (!commit || !unbound.length) continue;
    // No crew on the rocket to carry these: score at FRONT (low) and bank home.
    p.glory.claimed = p.glory.claimed || [];
    let vps = 0;
    const zones = [];
    for (const c of unbound) {
      const vp = ((ZONE_CHIT_VPS[c.zone] || { front: 1, back: 1 }).front) | 0;
      p.glory.claimed.push({ zone: c.zone, side: 'front', vp, turn: state.turn, crewId: null });
      vps += vp;
      zones.push(c.zone);
    }
    p.glory.vps = (p.glory.vps | 0) + vps;
    p.glory.chits = p.glory.chits.filter((c) => !unbound.includes(c));
    const note = `${p.name}'s glory chit${zones.length === 1 ? '' : 's'} (${zones.join(', ')}) scored at front value (+${vps} VP) and returned to LEO - no crew on the rocket to carry ${zones.length === 1 ? 'it' : 'them'}.`;
    notes.push(note);
    pushNews(state, '🎖', note);
  }
  return notes;
}

// Free action: load the still-unclaimed glory chit for the zone the
// rocket is parked in (a crew must be aboard). The explicit counterpart to
// declining the on-arrival pick-up; mirrors the client's claimGloryHere.
// maybeAwardGlory enforces the zone / already-claimed / crew gates, so a null
// result means there is nothing here to load. LEO (home) never carries a chit.
function applyLoadGlory(state, _op, player) {
  // A glory chit is loaded by whichever of the player's units is actually
  // parked at a site carrying a Human - the rocket OR the Freighter (a
  // Freighter can crew a Human just as well, and a colonist riding it is no
  // less a Human than one riding the rocket). Try the rocket first (matches
  // prior behavior when both happen to qualify), then the freighter.
  const candidates = [];
  if (player.rocket.siteId != null && !rocketAtLeo(state, player)) {
    candidates.push({ site: siteById(player.rocket.siteId), stack: player.rocket.stack });
  }
  if (player.freighter && player.freighter.siteId != null) {
    candidates.push({ site: siteById(player.freighter.siteId), stack: player.freighter.stack || [] });
  }
  const eligible = candidates.find((c) => c.site && c.site.solarZone
    // V9 The Sirens: no glory is picked up on Cordelia or the Uranus Aerostat -
    // a species gets no fame for standing on its own doorstep. No-op elsewhere.
    && !sirenGloryBlocked(state, c.site.id)
    && !player.glory.visited.includes(c.site.solarZone)
    && !zoneChitTaken(state, c.site.solarZone)
    && stackHasHuman(state, c.stack));
  if (!eligible) return fail('no_chit_to_load');
  // Glory Carry Limit (rule a): if every Human aboard already carries a chit,
  // there is no free carrier for another - report it distinctly so the client
  // can offer to surrender one first.
  if ((player.glory.chits || []).length >= gloryCarriers(state, player)) return fail('glory_carry_full');
  const chit = maybeAwardGlory(state, player, eligible.site, state.turn, eligible.stack);
  if (!chit) return fail('no_chit_to_load');
  return { ok: true, state, log: `${player.name} loaded the ${chit.zone} glory chit.` };
}

// Surrender a carried glory chit (rule a): a Crew / Colonist gives up the chit,
// which returns to its Glory space (the zone becomes claimable again). Frees a
// carrier so the player can hold a different chit, and the way to shed excess
// chits down to the carry limit. Free action. op = { zone }.
function applySurrenderGlory(state, op, player) {
  const zone = op.zone != null ? String(op.zone) : null;
  if (!zone) return fail('bad_zone');
  const chits = (player.glory && player.glory.chits) || [];
  const idx = chits.findIndex((c) => c && c.zone === zone);
  if (idx < 0) return fail('no_such_chit');
  chits.splice(idx, 1);
  // Un-mark the zone visited so its chit is claimable again (its Glory space),
  // unless the player somehow still carries another chit of the same zone.
  if (Array.isArray(player.glory.visited) && !chits.some((c) => c && c.zone === zone)) {
    const vIdx = player.glory.visited.indexOf(zone);
    if (vIdx >= 0) player.glory.visited.splice(vIdx, 1);
  }
  return { ok: true, state, log: `${player.name} surrendered the ${zone} glory chit; it returns to its Glory space.` };
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
  // International Assistance (solitaire Sol Unification) lapses with the
  // season too - FINAO returns to full price outside season blue.
  if (state.internationalAssistance && seasonForSlot(state.turn) !== 'blue') {
    state.internationalAssistance = false;
    state.assistanceLifted = true; // one-shot note for the END_TURN log
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
  if (state.assistanceLifted) {
    delete state.assistanceLifted;
    log += ' The cube left season blue; International Assistance ends (FINAO back to full price).';
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

// ----- V9 Sirens: species-split libraries -----
//
// With both species at the table the patent decks and the colonist queue are
// split in two and neither species may draw from the other's (V9b). The split
// piles live in state.sirenDecks / state.sirenColonistQueue, which are ABSENT in
// every other game - so `decksFor` returns state.decks unchanged and a non-split
// game is byte-for-byte what it was.
//
// state.decks stays the EARTHLING library rather than being renamed, so the
// dozen table-wide reads that have no player in scope keep working untouched.
function decksFor(state, player) {
  return (state.sirenDecks && isSirenPlayer(state, player)) ? state.sirenDecks : state.decks;
}
function colonistQueueFor(state, player) {
  if (state.sirenColonistQueue && isSirenPlayer(state, player)) return state.sirenColonistQueue;
  return (state.colonistQueue = state.colonistQueue || []);
}
// Every deck map in play, for the table-wide operations (deck cycling) that act
// on the library as a whole rather than on one player's share.
function allDeckMaps(state) {
  return state.sirenDecks ? [state.decks, state.sirenDecks] : [state.decks];
}
// Cut the libraries in two when the crew draft closes. Idempotent by
// construction (it only runs when sirenDecks does not exist yet).
function splitLibrariesBySpecies(state) {
  if (state.sirenDecks) return;
  // TWO different cuts, and which one applies depends on the table:
  //
  //  - SOLITAIRE (V9b's "use CEO (V6)" route): the Sirens get all D and V
  //    patents and the Earthlings the remainder - a cut by SPECTRAL type, not by
  //    halves. There is only one player, so needsSpeciesSplit is false and this
  //    is the only trigger that fires.
  //  - MULTIPLAYER with both species seated: every deck is cut in half, odd card
  //    to the Sirens.
  //
  // Either way the colonist queue splits EVENLY (the solo rule says so
  // explicitly), and an all-one-species multiplayer table gets no split at all.
  const solo = !!(state.sirens && state.ceoSolo);
  if (!solo && !needsSpeciesSplit(state)) return;
  const spectralOf = (id) => (PATENTS_BY_ID[id] || {}).spectralType || 'C';
  const siren = {};
  for (const [type, cards] of Object.entries(state.decks || {})) {
    const cut = solo
      ? splitDeckForSoloSpecies(cards, spectralOf)
      : splitDeckForSpecies(cards);
    state.decks[type] = cut.earthling;
    siren[type] = cut.siren;
  }
  state.sirenDecks = siren;
  // The colonist queue splits evenly in BOTH modes; it only exists under M2.
  if (Array.isArray(state.colonistQueue) && state.colonistQueue.length) {
    const cut = splitDeckForSpecies(state.colonistQueue);
    state.colonistQueue = cut.earthling;
    state.sirenColonistQueue = cut.siren;
  }
}

// True decommission: the card leaves play to the BOTTOM of its patent
// deck (unlike the voluntary DECOMMISSION free action, which returns the
// card to the hand for dirt-fuel bookkeeping). Crew never route here.
// `player` is the card's owner, so a Siren's wreckage returns to the Siren
// library; omitted (or in any non-split game) it goes to state.decks.
function destroyToDeckBottom(state, cardId, player) {
  const p = PATENTS_BY_ID[cardId];
  const deck = p && decksFor(state, player)[p.type];
  if (deck) deck.push(cardId);
}

function stackHasCrew(slots) {
  return (slots || []).some((s) => isCrewSlot(s));
}

// ---- M2 Colonists (rule 2C) ----
// A colonist is a card (data/colonists.js) riding a stack slot with
// kind 'colonist'. Robots are colonists too, but count as HUMAN only after
// Robot Emancipation (2C2b). Colonist slots only ever exist in an m2 game
// (the queue is the only entry path), so these helpers activate nothing in a
// non-m2 game.
function isColonistSlot(slot) {
  const c = slot && PATENTS_BY_ID[slot.id];
  return !!(c && c.type === 'colonist');
}
function isHumanColonistSlot(state, slot) {
  const c = slot && PATENTS_BY_ID[slot.id];
  if (!c || c.type !== 'colonist') return false;
  return c.colonistKind === 'Human' || !!state.robotsEmancipated;
}
// A HUMAN slot: crew, or a Human colonist (1D1a "a Human - either Crew or
// Human Colonist").
function isHumanSlot(state, slot) {
  return isCrewSlot(slot) || isHumanColonistSlot(state, slot);
}
function stackHasHuman(state, slots) {
  return (slots || []).some((s) => isHumanSlot(state, s));
}

// Every colonist slot a player owns, with where it sits. Containers: the LEO
// Stack, the rocket, outposts, the Freighter's hold, and each Bernal's stack.
function* colonistLocations(player) {
  for (const s of (player.leo || [])) {
    if (isColonistSlot(s)) yield { slot: s, siteId: null, from: 'leo' };
  }
  for (const s of (player.rocket.stack || [])) {
    if (isColonistSlot(s)) yield { slot: s, siteId: player.rocket.siteId, from: 'rocket' };
  }
  for (const [letter, o] of Object.entries(player.outposts || {})) {
    if (!o) continue;
    for (const s of (o.cards || [])) {
      if (isColonistSlot(s)) yield { slot: s, siteId: o.siteId, from: `outpost${letter}` };
    }
  }
  if (player.freighter) {
    for (const s of (player.freighter.stack || [])) {
      if (isColonistSlot(s)) yield { slot: s, siteId: player.freighter.siteId, from: 'freighter' };
    }
  }
  const bernals = player.bernals || [];
  for (let i = 0; i < bernals.length; i++) {
    const bn = bernals[i];
    if (!bn) continue;
    for (const s of (bn.stack || [])) {
      if (isColonistSlot(s)) yield { slot: s, siteId: bn.siteId, from: `bernal${i}` };
    }
  }
}
function countColonists(player) {
  let n = 0;
  for (const _ of colonistLocations(player)) n += 1;
  return n;
}
// Retire a colonist OUT of play (2C2a Decommission): a Human goes to the
// bottom of the queue; a Robot returns to its owner's HAND (a hand Robot is
// patent-like - sellable, buildable, and no longer counted against the
// colonist limit). Returns a short log phrase.
function retireColonistId(state, player, cardId) {
  const id = String(cardId);
  const card = PATENTS_BY_ID[id];
  if (card && card.colonistKind === 'Robot') {
    // Post-Emancipation, a Robot counts as Human and "cannot enter a hand"
    // (2C2b) - it is removed from the game for good instead, never cycling
    // back to hand or the queue. (User 2026-07-23: every robot retirement
    // after emancipation is removed from the deck, not returned to circulation -
    // this is the SAME rule the emancipation sweep itself follows below.)
    if (state.robotsEmancipated) {
      return `${(card && card.name) || id} (emancipated Robot) is retired from the game`;
    }
    (player.hand = player.hand || []).push(id);
    return `${(card && card.name) || id} (Robot) returned to the hand`;
  }
  colonistQueueFor(state, player).push(id);
  return `${(card && card.name) || id} returned to the colonist queue`;
}
// Colonist allowance (rule 2Ca): 1 per Anchored Bernal, 2 if that Bernal is
// promoted (a Lab). No anchored Bernals = no colonists. The Spacefaring
// Future grants one extra colonist on top.
function colonistAllowance(player) {
  let n = 0;
  for (const bn of (player.bernals || [])) {
    if (bn && bn.anchored) n += (bn.promoted || bn.face === 'secondary') ? 2 : 1;
  }
  if (n > 0 && hasFutureEffect(player, 'extraColonist')) n += 1;
  return n;
}

// ---- Colonist powers + specialty operations (rules 2C1 / 2C2) ----

// The power flags on ONE colonist slot's active face (promoted abilities live
// on the purple face; Calypso 2's rides the white face).
function colonistSlotPower(slot) {
  const c = slot && PATENTS_BY_ID[slot.id];
  if (!c || c.type !== 'colonist') return null;
  const face = slot.face === 'secondary' ? (c.faces && c.faces.secondary) : (c.faces && c.faces.primary);
  return colonistPower(face && face.name);
}
// Does the player hold an in-play colonist granting a GLOBAL power flag
// (glitch-free stacks, FINAO halved, doubled free market, ...)? Location-
// conditioned flags (sizeRollMod) use colonistSizeRollModAt instead.
function playerHasColonistPower(state, player, key) {
  if (!state.m2) return false;
  for (const e of colonistLocations(player)) {
    const pw = colonistSlotPower(e.slot);
    if (pw && pw[key]) return true;
  }
  return false;
}
// Colocated colonist size-roll modifier for a prospect at `siteId` (negative =
// easier): Rental Body Guild -1 anywhere, Svalbard -1 on Synodic Sites,
// Wet-Nano -2 / Eugenic Pilgrims -1 on Synodic Comets.
function colonistSizeRollModAt(state, player, siteId) {
  if (!state.m2 || !siteId) return 0;
  let mod = 0;
  for (const e of colonistLocations(player)) {
    if (e.siteId !== siteId) continue;
    const pw = colonistSlotPower(e.slot);
    if (!pw || !pw.sizeRollMod) continue;
    if (pw.sizeRollSynodicComets && !SYNODIC_COMET_IDS.includes(siteId)) continue;
    if (pw.sizeRollSynodicOnly && !SYNODIC_SITE_IDS.includes(siteId)) continue;
    mod += pw.sizeRollMod;
  }
  return mod;
}
// FINAO cost per hazard for this player: 4 base, 3 with Open Source FINAO,
// halved while International Assistance runs (solitaire Sol Unification's
// season-blue event), halved again (fractions dropped) by a Frankenstein
// Navigator / Josephson Implants colonist in play. Mirror the client's
// finaoPer (browse.js) if the order ever changes.
function finaoPerFor(state, player) {
  let per = hasPrivilege(state, player, 'OPEN_SOURCE_FINAO') ? 3 : HAZARD_COST_PER;
  if (state.internationalAssistance) per = Math.floor(per / 2);
  if (playerHasColonistPower(state, player, 'finaoHalved')) per = Math.floor(per / 2);
  return Math.max(1, per);
}

// A colonist COLOCATED with an operation's site (2C1): at the site itself, OR on
// an anchored Bernal that is Dirtside to a Factory at that site ("including on an
// Anchored Bernal ... at the Anchored Bernal of the Factory"). Lets a Miner /
// Engineer / Industrialist / Prospector riding a Dirtside Bernal act for the
// Factory it services.
function colonistColocatedWithSite(state, player, e, siteId) {
  if (e.siteId === siteId) return true;
  if (typeof e.from === 'string' && e.from.startsWith('bernal')) {
    const bn = (player.bernals || [])[Number(e.from.slice('bernal'.length)) || 0];
    if (bn && bn.anchored && bernalDirtsides(state, bn, player).includes(siteId)) return true;
  }
  return false;
}
// Colonist SPECIALISTS of one specialty colocated with a site (both faces carry
// the specialty - it is a card-level column; a promoted colonist keeps it).
function colonistSpecialistsAt(state, player, siteId, specialty) {
  if (!state.m2 || siteId == null) return 0;
  let n = 0;
  for (const e of colonistLocations(player)) {
    if (!colonistColocatedWithSite(state, player, e, siteId)) continue;
    const c = PATENTS_BY_ID[e.slot.id];
    if (c && c.specialty === specialty) n += 1;
  }
  return n;
}
// Per-turn free-operation budgets granted by colonist specialists (2C1):
// each Prospector colonist gives one free prospect OR promotion per turn;
// each Industrialist one free industrialize OR anchoring. Counters live on
// the player and reset at turn open (they replay correctly through undo).
function colonistOpsUsed(player) {
  if (!player.colonistOpsUsed || typeof player.colonistOpsUsed !== 'object') {
    player.colonistOpsUsed = { prospector: 0, industrialist: 0 };
  }
  return player.colonistOpsUsed;
}
function canColonistFreeOp(state, player, siteId, specialty) {
  const n = colonistSpecialistsAt(state, player, siteId, specialty);
  if (!n) return false;
  const key = specialty === 'Prospector' ? 'prospector' : 'industrialist';
  return (colonistOpsUsed(player)[key] | 0) < n;
}
function spendColonistFreeOp(player, specialty) {
  const key = specialty === 'Prospector' ? 'prospector' : 'industrialist';
  const used = colonistOpsUsed(player);
  used[key] = (used[key] | 0) + 1;
}
// One refuel per site per turn, plus one EXTRA per colocated Miner colonist
// (2C1 / 4A7k). The extras ride the same operation (they are free repeats).
function siteRefuelGate(state, player, siteId) {
  player.refueledSites = Array.isArray(player.refueledSites) ? player.refueledSites : [];
  const uses = player.refueledSites.filter((s) => s === siteId).length;
  const miners = colonistSpecialistsAt(state, player, siteId, 'Miner');
  if (uses >= 1 + miners) return { ok: false };
  return { ok: true, freeRepeat: uses >= 1 };
}

// Humans co-located with a site: a colony dome, any player's rocket
// parked there with crew (or a Human colonist) aboard, any outpost there
// holding one, or an M1/M2 vehicle stack (freighter / Bernal) holding one.
function humansAtSite(state, siteId) {
  if (!siteId) return true; // LEO: mission control is right there
  if (state.colonies[siteId]) return true;
  for (const p of state.players) {
    if (p.rocket.siteId === siteId
        && (stackHasCrew(p.rocket.stack) || stackHasHuman(state, p.rocket.stack))) return true;
    for (const o of Object.values(p.outposts || {})) {
      if (o && o.siteId === siteId
          && (stackHasCrew(o.cards) || stackHasHuman(state, o.cards))) return true;
    }
    if (p.freighter && p.freighter.siteId === siteId
        && stackHasHuman(state, p.freighter.stack)) return true;
    for (const bn of (p.bernals || [])) {
      if (bn && bn.siteId === siteId && stackHasHuman(state, bn.stack)) return true;
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
  if (p.rocket.siteId === siteId && stackHasHuman(state, p.rocket.stack)) return true;
  for (const o of Object.values(p.outposts || {})) {
    if (o && o.siteId === siteId && stackHasHuman(state, o.cards)) return true;
  }
  if (p.freighter && p.freighter.siteId === siteId && stackHasHuman(state, p.freighter.stack)) return true;
  for (const bn of (p.bernals || [])) {
    if (bn && bn.siteId === siteId && stackHasHuman(state, bn.stack)) return true;
  }
  return false;
}
function opposingHumanAtSite(state, siteId, actorId) {
  const col = state.colonies[siteId];
  if (col && col.ownerId !== actorId) return true;
  for (const p of state.players) {
    if (p.profileId === actorId) continue;
    if (p.rocket.siteId === siteId && stackHasHuman(state, p.rocket.stack)) return true;
    for (const o of Object.values(p.outposts || {})) {
      if (o && o.siteId === siteId && stackHasHuman(state, o.cards)) return true;
    }
    if (p.freighter && p.freighter.siteId === siteId && stackHasHuman(state, p.freighter.stack)) return true;
    for (const bn of (p.bernals || [])) {
      if (bn && bn.siteId === siteId && stackHasHuman(state, bn.stack)) return true;
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
// M2 Core Rule Addenda (a): unlike Core, faction privileges (B6a) are LOCKED
// at the start of an M2 game and only unlock once the player has a Bernal
// Anchored in a Home Orbit (2B3b) - i.e. a Home Bernal. Non-M2 games are
// unaffected (privileges work from the start, as in Core rules).
function factionPrivilegesLocked(state, player) {
  if (!state || !state.m2) return false;
  return !(player && (player.bernals || []).some((bn) => bn && bn.anchored && isHomeBernal(bn)));
}
function privilegeOf(state, player) {
  if (!player || !player.faction) return null;
  if (factionPrivilegesLocked(state, player)) return null;
  // Eugenic Pilgrims (colonist power): the faction privilege is not lost in
  // Anarchy.
  if (state && state.anarchy && !playerHasColonistPower(state, player, 'privilegeInAnarchy')) return null;
  const card = CREW_BY_ID[player.faction.cardId];
  const face = card && card.faces && card.faces[player.faction.face];
  return face ? privKey(face.bonus) : null;
}
// Group Mind Immortalists (colonist power): the player may also use the
// privilege printed on the OTHER side of their crew card.
function secondFacePrivilege(state, player) {
  if (!player || !player.faction) return null;
  if (!playerHasColonistPower(state, player, 'bothCrewFaces')) return null;
  if (factionPrivilegesLocked(state, player)) return null;
  if (state && state.anarchy && !playerHasColonistPower(state, player, 'privilegeInAnarchy')) return null;
  const card = CREW_BY_ID[player.faction.cardId];
  const other = player.faction.face === 'primary' ? 'secondary' : 'primary';
  const face = card && card.faces && card.faces[other];
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
    || hasBorrowedAbility(player, key) || secondFacePrivilege(state, player) === key
    || hasPrivilegeBernal(state, player, key);
}
function playersWithPrivilege(state, key) {
  return (state.players || []).filter((p) => privilegeOf(state, p) === key
    || hasGrantedPrivilege(p, key) || hasBorrowedAbility(p, key)
    || secondFacePrivilege(state, p) === key || hasPrivilegeBernal(state, p, key));
}
// An anchored Bernal whose ability grants the faction privilege `key` (the L2
// Collimator Bernal grants POWERSAT, the L4s Pharmaceutics Bernal grants
// SKUNKWORKS). A "HOME:" grant (white face) counts only while the Bernal is the
// Home Bernal; the promoted (purple) face grants it anchored anywhere. Like a
// card grant this is an Ability, NOT a faction privilege, so it is NOT suspended
// by Anarchy.
function hasPrivilegeBernal(state, player, key) {
  for (const bn of ((player && player.bernals) || [])) {
    const g = bernalPrivilegeGrant(bn);
    if (g.privilege === key && (!g.homeOnly || isHomeBernal(bn))) return true;
  }
  return false;
}
// Powersat (B6a / H3d): +1 push thrust to a push-icon thruster (any range) AND
// Safe Factory-Assist (rule e: factory-assist with no Hazard Roll). Its sources,
// with the Anarchy gating of rule h:
//   - faction privilege (privilegeOf, SUSPENDED by Anarchy),
//   - a permanent card grant (POWER GIRDLE / IONOSAT) or a borrowed ability
//     (hasPrivilege, NOT suspended),
//   - a Push Factory (rule c): a Factory the player owns on a push-icon Site. It
//     is an Ability, so it is NOT suspended by Anarchy.
function hasPushFactory(state, player) {
  if (!player || !state.factories) return false;
  for (const slug in state.factories) {
    const f = state.factories[slug];
    if (!f || f.ownerId !== player.profileId) continue;
    const site = siteById(slug);
    if (site && site.push) return true;
  }
  return false;
}
// An anchored Bernal whose ability grants the Powersat privilege (e.g. the L2
// Collimator Bernal). A "HOME:" grant (white face) only counts while the Bernal
// is the Home Bernal; the promoted (purple) face grants it anchored anywhere.
function hasPowersatBernal(state, player) {
  return hasPrivilegeBernal(state, player, 'POWERSAT');
}
function hasPowersat(state, player) {
  return hasPrivilege(state, player, 'POWERSAT') || hasPushFactory(state, player)
    || hasPowersatBernal(state, player);
}
// May this player commit a Felony? Yes during Anarchy (everyone gains
// Felonious, K2e), OR if they hold the Felonious privilege (Taikonauts) the
// rest of the time. (Anarchy suspends privilegeOf, but state.anarchy covers
// that case directly.)
function mayCommitFelony(state, player) {
  return !!state.anarchy || hasPrivilege(state, player, 'FELONIOUS')
    // Soldier Caste (colonist power): all their Humans may commit Felonies.
    || playerHasColonistPower(state, player, 'felonious');
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
// Anchoring a Bernal is a Glitch Trigger too (rule 2A5d, m2-only op).
const GLITCH_TRIGGER_OPS = new Set(['PROSPECT', 'SITE_REFUEL', 'INDUSTRIALIZE', 'ANCHOR_BERNAL']);

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
    if (effectiveRadHardness(player, slot) === roll) {
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
// gameplay notes for the log. Covers every stack that can carry a Glitch: the
// rocket + outposts (the Sunspot Cube K2b event target list), and the M1/M2
// Freighter / Bernal / Mobile Factory (which take a Glitch from a failed rad
// roll instead, but it is the SAME token, so G7 Glitch Repair clears it the
// same way once a Human is colocated). Without this the rad-roll Glitch on a
// Freighter/Bernal/Mobile Factory could never be repaired at all (only ever
// cleared by a second failed roll destroying the unit).
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
    // Freighter / Bernal: these hold no Crew slot of their own (unmanned
    // vehicles), so "Human aboard" reads the same stackHasHuman check
    // humansAtSite already applies to them - a colonist riding the cargo, or
    // anyone (any player's) colocated at the unit's site.
    if (p.freighter && p.freighter.glitched
        && (scrum || stackHasHuman(state, p.freighter.stack) || humansAtSite(state, p.freighter.siteId))) {
      p.freighter.glitched = false;
      notes.push(`${p.name}'s Freighter glitch was ${fixWord}.`);
    }
    for (const bn of (p.bernals || [])) {
      if (bn && bn.glitched
          && (scrum || stackHasHuman(state, bn.stack) || humansAtSite(state, bn.siteId))) {
        bn.glitched = false;
        notes.push(`${p.name}'s Bernal glitch was ${fixWord}.`);
      }
    }
  }
  // Mobile Factory cubes carry no card stack of their own (a bare cube token),
  // so only site presence (anyone's Human, or the owner's Scrum Troubleshooters)
  // can clear one.
  for (const cube of (state.mobileCubes || [])) {
    if (!cube || !cube.glitched) continue;
    const owner = state.players.find((p) => p.profileId === cube.ownerId);
    const scrumC = !!(owner && hasPrivilege(state, owner, 'SCRUM_TROUBLESHOOTERS'));
    if (scrumC || humansAtSite(state, cube.siteId)) {
      cube.glitched = false;
      notes.push(`${(owner && owner.name) || 'A player'}'s Mobile Factory glitch was ${scrumC ? 'cleared remotely (Scrum Troubleshooters)' : 'fixed by nearby humans'}.`);
    }
  }
  return notes;
}

// Scrum Troubleshooters (Norse) repair Glitches anywhere with no Human present,
// so a glitch riding any of this player's stacks is cleared as their turn opens
// (the post-op autoFixGlitches would otherwise leave it sitting there until they
// took an action). Norse also cannot RECEIVE a glitch (glitchTargetFor), so this
// only bites for a glitch taken before the faction was Norse, or one that landed
// during Anarchy and is now repairable again.
function repairNorseGlitchesAtTurnStart(state, player) {
  if (!player || !player.rocket) return;
  if (!hasPrivilege(state, player, 'SCRUM_TROUBLESHOOTERS')) return;
  let any = false;
  if (player.rocket.glitch) { player.rocket.glitch = false; any = true; }
  for (const o of Object.values(player.outposts || {})) {
    if (o && o.glitch) { o.glitch = false; any = true; }
  }
  if (player.freighter && player.freighter.glitched) { player.freighter.glitched = false; any = true; }
  for (const bn of (player.bernals || [])) {
    if (bn && bn.glitched) { bn.glitched = false; any = true; }
  }
  for (const cube of (state.mobileCubes || [])) {
    if (cube && cube.ownerId === player.profileId && cube.glitched) { cube.glitched = false; any = true; }
  }
  if (any) {
    pushNews(state, EVENT_ICONS.glitch || '⚠️',
      `${player.name}'s glitch was cleared remotely (Scrum Troubleshooters) as their turn opened.`);
  }
}

// A glory chit is carried by a Human (Crew or Human Colonist), and a chit
// FOLLOWS its Human into ANY of the player's stacks - the rocket, an outpost /
// factory, the freighter, a Bernal (this is exactly what gloryCarriers counts
// as the carry capacity). So a chit is only orphaned when there are MORE chits
// than Humans left to carry them (a carrier died / colonised / was
// decommissioned): the excess return home to LEO at FRONT (low / "1") value.
// It used to orphan EVERY chit whenever no Human sat on the ROCKET specifically,
// which wrongly sent a chit home the moment its crew moved off the rocket to a
// new outpost (e.g. Industrialize) even though that crew was still carrying it.
// Runs after every functional op + event resolution, so it also retroactively
// settles a genuinely orphaned chit (all carriers gone) on the next op.
function homeOrphanedGloryChits(state) {
  const notes = [];
  for (const p of state.players) {
    if (!p.glory || !Array.isArray(p.glory.chits) || !p.glory.chits.length) continue;
    p.glory.claimed = p.glory.claimed || [];
    const kept = [];
    const returned = [];
    // A chit bound to a Human is orphaned the moment THAT card leaves play (died
    // / colonised / decommissioned): it settles home at FRONT value.
    for (const c of p.glory.chits) {
      if (c && c.crewId && !humanCardInPlay(state, p, c.crewId)) returned.push(c);
      else kept.push(c);
    }
    // Legacy fallback for ownerless chits (pre-binding saves): keep the old count
    // rule so they still orphan when carriers run out. Only ever removes chits
    // with no crewId, from the tail, so a bound-and-present chit is never touched.
    const carriers = gloryCarriers(state, p);
    for (let i = kept.length - 1; i >= 0 && kept.length > carriers; i--) {
      if (!kept[i] || !kept[i].crewId) { returned.push(kept[i]); kept.splice(i, 1); }
    }
    if (!returned.length) continue;
    p.glory.chits = kept;
    let vps = 0;
    const zones = [];
    for (const c of returned) {
      const vp = ((ZONE_CHIT_VPS[c.zone] || { front: 1, back: 1 }).front) | 0;
      p.glory.claimed.push({ zone: c.zone, side: 'front', vp, turn: state.turn, crewId: (c && c.crewId) || null });
      vps += vp;
      zones.push(c.zone);
    }
    p.glory.vps = (p.glory.vps | 0) + vps;
    const note = `${p.name}'s glory chit${zones.length === 1 ? '' : 's'} (${zones.join(', ')}) returned to LEO at front value (+${vps} VP) - no crew left to carry ${zones.length === 1 ? 'it' : 'them'}.`;
    notes.push(note);
    pushNews(state, '🎖', note);
  }
  return notes;
}

// Score the glory chits a rocket brings home to LEO. Each chit rides home with
// the SPECIFIC Human that grabbed it, so only chits whose carrier is aboard THIS
// rocket score now, at BACK (flipped, the big value: brought home alive). A chit
// whose crew is parked elsewhere in play (an outpost / Bernal) stays carried and
// rides home later with THAT crew. A legacy ownerless chit scores with the
// rocket (BACK if any crew aboard, else FRONT). Mirrors the client cashHomeArrival.
function cashHomeGloryChits(state, player) {
  const out = { scored: 0, vps: 0, side: null };
  if (!player.glory || !Array.isArray(player.glory.chits) || !player.glory.chits.length) return out;
  const aboard = new Set((player.rocket.stack || [])
    .filter((s) => isHumanSlot(state, s)).map((s) => s.id));
  const anyCrewAboard = (player.rocket.stack || []).some(isCrewSlot);
  player.glory.claimed = player.glory.claimed || [];
  const kept = [];
  for (const c of player.glory.chits) {
    let side = null;
    if (c && c.crewId) {
      if (aboard.has(c.crewId)) side = 'back';   // its carrier brought it home alive
      // else: carrier is elsewhere in play - leave the chit carried
    } else {
      side = anyCrewAboard ? 'back' : 'front';   // legacy ownerless chit
    }
    if (!side) { kept.push(c); continue; }
    const vp = ((ZONE_CHIT_VPS[c.zone] || { front: 1, back: 1 })[side]) | 0;
    player.glory.claimed.push({ zone: c.zone, side, vp, turn: state.turn, crewId: (c && c.crewId) || null });
    player.glory.vps = (player.glory.vps | 0) + vp;
    out.scored += 1;
    out.vps += vp;
    out.side = side;
  }
  player.glory.chits = kept;
  return out;
}

// The Home Bernal is a second "home" for glory: a chit whose carrier reaches it
// scores at BACK (high) value, exactly like riding home to LEO. So any carried
// chit whose Human is now on one of the player's Home Bernals is banked at back.
// Runs after every functional op, so transferring / boarding a chit-carrying
// crew onto the Home Bernal (or anchoring one that boards LEO crew) cashes it in.
function cashGloryAtHomeBernal(state) {
  const notes = [];
  for (const p of state.players) {
    if (!p.glory || !Array.isArray(p.glory.chits) || !p.glory.chits.length) continue;
    const homeBernals = (p.bernals || []).filter((bn) => bn && isHomeBernal(bn));
    if (!homeBernals.length) continue;
    // Which of this player's Humans count as "home" right now: any crew boarded
    // ON a Home Bernal, OR any crew aboard the rocket while the rocket is parked
    // at a Home Bernal's site (the rocket reached the Home Bernal - you don't
    // have to physically move the crew onto the station for it to count home).
    const atHome = new Set();
    for (const bn of homeBernals) {
      for (const s of (bn.stack || [])) if (isHumanSlot(state, s)) atHome.add(s.id);
    }
    const homeSites = new Set(homeBernals.map((bn) => bn.siteId));
    if (p.rocket && homeSites.has(p.rocket.siteId)) {
      for (const s of (p.rocket.stack || [])) if (isHumanSlot(state, s)) atHome.add(s.id);
    }
    if (!atHome.size) continue;
    p.glory.claimed = p.glory.claimed || [];
    const kept = [];
    let vps = 0;
    const zones = [];
    for (const c of p.glory.chits) {
      if (c && c.crewId && atHome.has(c.crewId)) {
        const vp = ((ZONE_CHIT_VPS[c.zone] || { front: 1, back: 1 }).back) | 0;
        p.glory.claimed.push({ zone: c.zone, side: 'back', vp, turn: state.turn, crewId: c.crewId });
        p.glory.vps = (p.glory.vps | 0) + vp;
        vps += vp;
        zones.push(c.zone);
      } else {
        kept.push(c);
      }
    }
    if (!zones.length) continue;
    p.glory.chits = kept;
    const note = `${p.name}'s glory chit${zones.length === 1 ? '' : 's'} (${zones.join(', ')}) reached the Home Bernal and scored at back value (+${vps} VP).`;
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
  // Scrum Troubleshooters (Norse): this player's stacks cannot RECEIVE a Glitch
  // at all, so they are never a valid target. (Suspended during Anarchy, when
  // every faction privilege is, so a Norse stack can be glitched only then.)
  if (hasPrivilege(state, p, 'SCRUM_TROUBLESHOOTERS')) return null;
  // Utility Fog Halbonaut / Neumann Matter / Creeper Neogen (colonist power):
  // all of this player's stacks are Glitch-free.
  if (playerHasColonistPower(state, p, 'glitchFree')) return null;
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
  // V9 Sirens, "Diamonds Aren't Forever": a stack CARRYING Sirens is not
  // protected the way a crewed stack normally is - Sirens cannot fix a glitch.
  // "A glitch on a stack carrying Sirens does nothing if the stack is on a site,
  // and decommissions the Sirens if it is in space."
  //
  // INTERPRETATION (flagged in docs/variants-tracker.md): the sentence describes
  // what befalls the Sirens, not the stack, so neither outcome lands a glitch
  // DISC - on a site the event fizzles, in space the Sirens die. A crewed Siren
  // stack therefore becomes a valid target only so that the event has somewhere
  // to land; the base human-fixes-glitches rule is untouched for Earthlings.
  const sirenCandidates = [];
  if (isSirenFaction(p)) {
    const consider = (slots, siteId, setLabel) => {
      if (!slots || !slots.length) return;
      const humans = slots.filter((sl) => isHumanSlot(state, sl));
      if (!humans.length) return;
      const onSite = siteId != null && !!siteById(siteId);
      sirenCandidates.push({
        count: slots.length,
        label: setLabel,
        sirenGlitch: true,
        onSite,
        apply: () => {
          if (onSite) return;                       // harmless dirtside
          for (const h of humans) decommissionHuman(state, p, h);
        },
      });
    };
    consider(p.rocket.stack, p.rocket.siteId, `${p.name}'s rocket`);
    for (const o of Object.values(p.outposts || {})) {
      consider(o && o.cards, o && o.siteId, `${p.name}'s Outpost ${o && o.letter}`);
    }
  }
  candidates.push(...sirenCandidates);
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.count - a.count);
  return candidates[0];
}

// A card is immune to a Pad Explosion (K2c) if it is Crew, an ET / Black-Side
// card, or Promoted (its purple side): all of these read as the card's SECONDARY
// (non-white) face, plus an explicit promoted flag for safety. A Colonist or a
// Bernal card is ALSO immune outright (M2 Core Rule Addenda f), regardless of
// face - a settler / station isn't exposed hardware on the pad the way a
// White-Side component is. Only a White-Side component card on the pad is
// exposed.
function padExplosionImmune(s) {
  if (isCrewSlot(s) || s.face === 'secondary' || !!s.promoted || isColonistSlot(s)) return true;
  const card = s && PATENTS_BY_ID[s.id];
  return !!(card && card.type === 'bernal');
}
// Cards exposed to a Pad Explosion: every White-Side (non-immune) card sitting
// at LEO. That is the loose LEO pile AND - when the rocket is parked at LEO - the
// rocket's OWN stack (a ship on the pad is just as exposed as loose cargo; this
// was the bug: a rocket assembled at LEO used to ride out a pad explosion). Each
// entry carries {slot, where} ('leo' | 'rocket') so the resolver decommissions
// from the stack the card actually sat in.
function exposedAtLeo(state, p) {
  const out = [];
  for (const s of (p.leo || [])) if (!padExplosionImmune(s)) out.push({ slot: s, where: 'leo' });
  if (rocketAtLeo(state, p)) {
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
// A rocket docked at (colocated with) one of the player's OWN anchored Bernals
// is sheltered from the flare - the station's mass shadows the node the way a
// Site's Bunker Shielding does. This is what protects a ship parked at the Home
// Bernal: the Home Bernal anchors at a Home Orbit (a burn node, not a Site), so
// without this a colocated rocket would read as "deep space" and get swept.
function rocketShelteredByBernal(player) {
  const s = player.rocket && player.rocket.siteId;
  if (s == null) return false;
  return (player.bernals || []).some((bn) => bn && bn.anchored && bn.siteId === s);
}
function applyFlareToPlayer(state, p, flare, notesArr) {
  let touched = 0;
  // Golden Apples Future: the completing player ignores solar flares entirely.
  if (hasFutureEffect(p, 'ignoreSolarFlares')) return 0;
  const sweep = (slots, slug, where) => {
    const zone = zoneOfSlug(slug) || 'Earth';
    const info = SOLAR_ZONE_INFO[zone];
    const mod = info ? info.solar : 0;
    if (mod === null) return slots;
    const hit = flare + mod;
    if (hit <= 0) return slots;
    const survivors = [];
    for (const slot of slots) {
      if (effectiveRadHardness(p, slot) >= hit) { survivors.push(slot); continue; }
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
        crewDeathToLeo(state, p, slot);   // flare roll: a fatality in ceoSolo
        notesArr.push(`${cardNameOf(slot.id)} ${where} was overcome and respawned at LEO.`);
      } else {
        (p.hand = p.hand || []).push(slot.id);   // Decommission -> back to hand
        notesArr.push(`${cardNameOf(slot.id)} ${where} decommissioned to hand (rad ${effectiveRadHardness(p, slot)} vs ${hit}).`);
      }
    }
    return survivors;
  };
  // Rocket: hit ONLY when caught in deep space (a transit waypoint that is not
  // a Site and not LEO). A rocket parked at a Site rides out the flare (Bunker
  // Shielding); a rocket at LEO is immune (Van Allen); a rocket sheltering in a
  // radiation belt - OR at a flare-sheltered node inside a belt (e.g. burn-ue3lc
  // inside Earth's belt) - rides out the flare too (the belt's own shadow
  // shields it); and a rocket docked at one of the player's own anchored Bernals
  // (the Home Bernal at its Home Orbit, or a dirtside Bernal) shelters behind the
  // station's mass. So a flare never reaches a ship in any of those cases.
  if (p.rocket.siteId && !isSiteNode(p.rocket.siteId) && hazardKind(p.rocket.siteId) !== 'rad'
      && !isFlareSheltered(p.rocket.siteId) && !rocketShelteredByBernal(p)) {
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

// Regime Change (solitaire Authority law): can the CEO invoke it right now?
// Needs a delegate sitting in Authority, and either the law active (free) or
// 1 aqua on hand to lobby the inactive law with that same delegate.
function regimeChangeAvailable(state) {
  if (!state.ceoSolo) return false;
  const solo = state.players && state.players[0];
  if (!solo) return false;
  const asm = assemblyOf(state);
  if (placeCount(asm, 'authority', solo.profileId) <= 0) return false;
  return lawInForce(state, 'authority') || (solo.aqua | 0) >= 1;
}

// Shared core of the Inspiration event (rulebook): cycle every open market
// deck (patent decks + M1/M2 decks when those modules are on) - the topmost
// card sinks to the bottom, the next card becomes the new top. Returns
// [{ deck, out, in }] for whichever caller wants to log it: the dice-driven
// Sunspot event (resolveSunspotEvent below) or a player's free Inspiration
// from a completed Future (applyFreeInspiration).
function cycleMarketDecks(state) {
  const cycled = [];
  const cycleDecks = [...DECK_TYPES, ...(state.m1 ? M1_DECK_TYPES : []), ...(state.m2 ? M2_DECK_TYPES : [])];
  // A market shake-up is a TABLE event, so under a Sirens species split it
  // cycles BOTH libraries - otherwise only the Earthlings' market would move.
  // Each cycled entry names its library so the Regime Change undo below can put
  // the right card back.
  for (const [mapIdx, deckMap] of allDeckMaps(state).entries()) {
    for (const t of cycleDecks) {
      const deck = deckMap[t];
      if (!deck || deck.length < 2) continue;
      const out = deck.shift();
      deck.push(out);
      cycled.push({ deck: t, out, in: deck[0], ...(mapIdx ? { lib: 'siren' } : {}) });
    }
  }
  return cycled;
}

function resolveSunspotEvent(state, kind, opts = {}) {
  const rawNotes = state.lastEvent.notes;
  // Every detail line lands in the event record (clock modal). `push` ALSO
  // emits a news-feed item; `detail` records only the clock-modal line (used by
  // the per-player events, which emit ONE combined `news` item for the whole
  // roll instead of one item per player, so the news feed reads as a single
  // event, not N separate ones). `news` pushes that combined item.
  const notes = {
    push: (t, cards) => { rawNotes.push(t); pushNews(state, EVENT_ICONS[kind] || '\u2604\uFE0F', t, cards); },
    detail: (t) => { rawNotes.push(t); },
    news: (t, cards) => { pushNews(state, EVENT_ICONS[kind] || '\u2604\uFE0F', t, cards); },
  };
  // "@a, @b and @c" for a combined news line (Oxford-free, keeps names legible).
  const nameList = (arr) => (arr.length <= 1 ? (arr[0] || '')
    : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1]);

  // Regime Change (solitaire Authority law): when a NON-inspiration event rolls
  // and the CEO can invoke Regime Change, DEFER the event and prompt to change
  // it into an Inspiration. Deferring - not resolving the rolled event here -
  // keeps the swap clean: the Glitch / Pad Explosion / Anarchy / Budget Cuts /
  // Solar Flare never fires unless the CEO lets it stand, so nothing has to be
  // reversed. Resolved via EVENT_CHOICE (choice = keep | change). The
  // inspiration roll keeps its own resolve-then-reverse prompt below.
  if (kind !== 'inspiration' && !opts.skipRegime && regimeChangeAvailable(state)) {
    state.pendingEvent = { kind: 'regime_change', rolledKind: kind, waiting: [state.players[0].profileId] };
    notes.push(`Regime Change: a delegate in Authority may be discarded to change the ${EVENT_HEADLINES[kind] || kind} into an Inspiration.`);
    return;
  }

  if (kind === 'inspiration') {
    // Cycle every market deck: topmost card to the bottom. Record what
    // left and what surfaced so a player opening their turn during the
    // event round sees exactly which cards rotated. The two M1 Terawatt decks
    // (GW thrusters + Freighters) cycle too when M1 is on, like the auction.
    const cycled = cycleMarketDecks(state);
    for (const c of cycled) {
      // Per-deck detail lands in the clock-modal event record ONLY, not the
      // news feed: all decks collapse into the ONE Inspiration news line below
      // so the notifications badge counts Inspiration as a single event (user
      // 2026-07-05), not one-per-deck.
      rawNotes.push(`Inspiration: ${cardNameOf(c.out)} sank to the bottom of the ${c.deck} deck; ${cardNameOf(c.in)} is the new top.`);
    }
    state.lastEvent.cycled = cycled;
    if (cycled.length) {
      notes.push(
        `Inspiration: ${cycled.length} market deck${cycled.length === 1 ? '' : 's'} cycled the top card to the bottom.`,
        cycled.flatMap((c) => [c.out, c.in]),
      );
    } else {
      notes.push('Inspiration: the market decks were too thin to cycle.');
    }
    // Regime Change (solitaire Authority law): after an event roll the CEO may
    // discard a delegate in authority to CHANGE or CANCEL the inspiration
    // (lobbying with that same delegate + 1 aqua when the law is not active).
    // Only offered when the choice is actually available; resolved via
    // EVENT_CHOICE with op.choice = keep | cancel | change.
    if (!opts.skipRegime && cycled.length && regimeChangeAvailable(state)) {
      const solo = state.players[0];
      state.pendingEvent = { kind: 'inspiration', waiting: [solo.profileId], options: {}, cycled };
      notes.push('Regime Change: a delegate in Authority may be discarded to change or cancel the inspiration.');
    }
    return;
  }

  if (kind === 'glitch') {
    // Each affected player's biggest human-less stack will take a glitch disc,
    // but it's a mandatory event action: the disc lands only when the player
    // confirms it on their turn (applyEventChoice). Mark who's affected.
    const waiting = [];
    const confirm = [], immune = [], none = [];
    for (const p of state.players) {
      if (glitchTargetFor(state, p)) {
        waiting.push(p.profileId); confirm.push(p.name);
        notes.detail(`Glitch: ${p.name} must confirm the glitch disc.`);
      } else if (hasPrivilege(state, p, 'SCRUM_TROUBLESHOOTERS')) {
        immune.push(p.name);
        notes.detail(`Glitch: ${p.name}'s stacks are immune (Scrum Troubleshooters).`);
      } else {
        none.push(p.name);
        notes.detail(`Glitch: ${p.name} had no uncrewed stack to glitch.`);
      }
    }
    const gp = [];
    if (confirm.length) gp.push(`${nameList(confirm)} must confirm a glitch disc`);
    if (immune.length) gp.push(`${nameList(immune)} immune (Scrum Troubleshooters)`);
    if (none.length) gp.push(`no uncrewed stack for ${nameList(none)}`);
    notes.news(`Glitch: ${gp.join('; ')}.`);
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
    const lose = [], choose = [], none = [];
    for (const p of state.players) {
      const exposed = exposedAtLeo(state, p);
      if (!exposed.length) {
        none.push(p.name);
        notes.detail(`Pad Explosion: nothing exposed on ${p.name}'s pad.`);
        continue;
      }
      const maxMass = Math.max(...exposed.map((e) => slotMass(e.slot)));
      const atMax = exposed.filter((e) => slotMass(e.slot) === maxMass);
      waiting.push(p.profileId);
      if (atMax.length > 1) {
        options[p.profileId] = atMax.map((e) => e.slot.id);
        choose.push(p.name);
        notes.detail(`Pad Explosion: ${p.name} must choose which mass-${maxMass} card to lose.`);
      } else {
        lose.push(p.name);
        notes.detail(`Pad Explosion: ${p.name} must confirm losing their mass-${maxMass} card.`);
      }
    }
    const pp = [];
    if (lose.length) pp.push(`${nameList(lose)} lose their top-mass card`);
    if (choose.length) pp.push(`${nameList(choose)} choose which card to lose`);
    if (none.length) pp.push(`nothing exposed for ${nameList(none)}`);
    notes.news(`Pad Explosion: ${pp.join('; ')}.`);
    if (waiting.length) state.pendingEvent = { kind: 'pad_explosion', waiting, options };
    return;
  }

  if (kind === 'anarchy') {
    // Sol Unification (solitaire Unity law): the season-blue Anarchy event
    // becomes INTERNATIONAL ASSISTANCE - FINAO costs are halved until the
    // Sunspot Cube exits season blue. No privilege suspension, no purge.
    if (state.ceoSolo && lawInForce(state, 'unity')) {
      state.internationalAssistance = true;
      notes.push('International Assistance (Sol Unification): FINAO costs are halved until the Sunspot Cube exits season blue.');
      return;
    }
    state.anarchy = true;
    const anarchyBits = ['faction privileges are suspended until the Sunspot Cube exits season blue'];
    notes.detail('Anarchy: faction privileges are suspended until the Sunspot Cube exits season blue.');
    // M0 purge: with the Assembly in play, Anarchy also purges one delegate
    // space. Roll 1d6 -> an ideology clockwise from Freedom (1) through
    // Individuality (6) (IDEOLOGY_ORDER is exactly that order); every player
    // loses ONE of their delegate cubes on that space. Centrist cubes are immune
    // (the roll never maps to the centre). Purged cubes free up in their owners'
    // pools automatically (cubesInPlay counts placements, so no refund needed).
    if (state.m0) {
      const asm = assemblyOf(state);
      const gen = makeRng(state.seed, state.rng.cursor);
      const roll = gen.d6();
      state.rng.cursor = gen.cursor;
      const ideology = IDEOLOGY_ORDER[(roll - 1) % IDEOLOGY_ORDER.length];
      const ideName = (IDEOLOGY_BY_KEY[ideology] || {}).name || ideology;
      const space = asm.delegates[ideology] || {};
      const purged = [];
      for (const pid of Object.keys(space)) {
        const n = placeCount(asm, ideology, pid);
        if (n <= 0) continue;
        setPlaceCount(asm, ideology, pid, n - 1);
        const pl = state.players.find((p) => String(p.profileId) === String(pid));
        purged.push(pl ? pl.name : ('#' + pid));
      }
      state.lastEvent.purgeRoll = roll;
      state.lastEvent.purgeIdeology = ideology;
      state.lastEvent.purgedPlayers = purged;
      const purgeLine = purged.length
        ? `Anarchy purge (rolled ${roll}): ${ideName} loses a delegate cube from ${nameList(purged)}.`
        : `Anarchy purge (rolled ${roll}): ${ideName} had no delegate cubes to purge.`;
      notes.detail(purgeLine);
      anarchyBits.push(purged.length
        ? `${ideName} loses a delegate cube from ${nameList(purged)} (purge roll ${roll})`
        : `${ideName} had no cubes to purge (purge roll ${roll})`);
      // Vote tally AFTER the purge (user 2026-07-08): the purge can flip which
      // ideology holds the majority, so re-run the tally to move the active-law
      // star. A single clear winner moves it automatically; a TIE is the FIRST
      // PLAYER's call - record a pendingLawStar they break with SET_LAW_STAR at
      // the top of their turn (openTurnFor keeps a pick that belongs to the player
      // whose turn is opening). No delegates anywhere leaves the star put.
      const voteWon = voteWinners(asm);
      if (voteWon.length === 1 && voteWon[0] !== state.activeLawStar) {
        state.activeLawStar = voteWon[0];
        const starName = (IDEOLOGY_BY_KEY[voteWon[0]] || {}).name || voteWon[0];
        anarchyBits.push(`the vote tally moves the active-law star to ${starName}`);
        notes.detail(`Anarchy vote tally: the active-law star moves to ${starName}.`);
      } else if (voteWon.length > 1) {
        const fp = state.players[state.firstPlayerIndex || 0];
        state.pendingLawStar = { chooserId: fp.profileId, winners: voteWon };
        anarchyBits.push(`the vote tally is tied - ${fp.name} (first player) breaks it`);
        notes.detail(`Anarchy vote tally: the vote is tied; ${fp.name} (first player) chooses which ideology holds the active-law star.`);
      }
    }
    notes.news(`Anarchy: ${anarchyBits.join('; ')}.`);
    return;
  }

  if (kind === 'budget_cuts') {
    // Every player with hand cards picks one to send to the bottom of its
    // deck. Pauses until all picks land; empty hands are spared - and so is
    // anyone whose HOME Bernal grants budget-cut immunity ("HOME: You are
    // immune to budget cuts", the L5s Cancer Hospital). The HOME: prefix
    // means the Bernal must actually BE the Home Bernal (anchored at its
    // Home Orbit), and the immunity reads off the INSTALLED face - the
    // promoted Cancer Lab face drops it.
    const waiting = state.players
      .filter((p) => (p.hand || []).length > 0 && !immuneToBudgetCuts(state, p))
      .map((p) => p.profileId);
    for (const p of state.players) {
      if ((p.hand || []).length > 0 && !waiting.includes(p.profileId)) {
        notes.detail(`Budget Cuts: ${p.name} is immune (Home Bernal ability).`);
      }
    }
    if (!waiting.length) {
      notes.push('Budget Cuts: no hand owes a discard.');
      return;
    }
    state.pendingEvent = { kind: 'budget_cuts', waiting };
    const bc = [];
    for (const p of state.players) {
      if (waiting.includes(p.profileId)) { bc.push(p.name); notes.detail(`Budget Cuts: ${p.name} must discard a hand card.`); }
    }
    notes.news(`Budget Cuts: ${nameList(bc)} must discard a hand card.`);
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
    notes.detail(`Solar Flare: flare roll ${flare}.`);
    const waiting = [];
    const affected = [];
    for (const p of state.players) {
      if (flareWouldAffect(state, p, flare)) {
        waiting.push(p.profileId); affected.push(p.name);
        notes.detail(`Solar Flare: ${p.name} must confirm the flare's toll on their stacks.`);
      }
    }
    notes.news(affected.length
      ? `Solar Flare (roll ${flare}): ${nameList(affected)} must confirm the flare's toll on their stacks.`
      : `Solar Flare (roll ${flare}): no stacks in flight to scorch.`);
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
    const exp = exposedAtLeo(state, player);
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
    const exposed = exposedAtLeo(state, player);
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
    if (tgt && tgt.sirenGlitch) {
      // Diamonds Aren't Forever: no disc either way - the glitch fizzles on a
      // site, and kills the Sirens aboard in space.
      tgt.apply();
      log = tgt.onSite
        ? `${player.name}: the glitch passes harmlessly over ${tgt.label} - the Sirens aboard are dirtside.`
        : `${player.name}: the glitch kills the Sirens aboard ${tgt.label} - carbon life has no radiation tolerance in the open.`;
    } else if (tgt) { tgt.apply(); log = `${player.name}: a glitch disc lands on ${tgt.label} (${tgt.count} cards).`; }
    else log = `${player.name}: nothing left to glitch.`;
  } else if (pending.kind === 'solar_flare') {
    const arr = [];
    applyFlareToPlayer(state, player, pending.flareRoll, arr);
    log = arr.length
      ? `${player.name} (Solar Flare): ${arr.join(' ')}`
      : `${player.name}: the Solar Flare passed harmlessly.`;
  } else if (pending.kind === 'inspiration') {
    // Regime Change (solitaire Authority law): keep the inspiration, or
    // discard an authority delegate (lobbying with 1 aqua when the law is
    // not active) to CANCEL it (decks restored) or CHANGE it (cycle again).
    const choice = String(op.choice || 'keep');
    if (choice === 'keep') {
      log = `${player.name} let the inspiration stand.`;
    } else if (choice === 'cancel' || choice === 'change') {
      const asm = assemblyOf(state);
      if (placeCount(asm, 'authority', player.profileId) <= 0) return fail('no_delegate_there');
      const active = lawInForce(state, 'authority');
      if (!active && (player.aqua | 0) < 1) return fail('insufficient_aqua');
      if (!active) player.aqua -= 1;
      setPlaceCount(asm, 'authority', player.profileId, placeCount(asm, 'authority', player.profileId) - 1);
      const lobbyTail = active ? '' : ' (lobbied: 1 aqua + the delegate)';
      if (choice === 'cancel') {
        // Restore each cycled deck: the card that sank returns to the top.
        for (const c of (pending.cycled || [])) {
          const map = (c.lib === 'siren' && state.sirenDecks) ? state.sirenDecks : state.decks;
          const deck = map[c.deck];
          if (deck && deck.length >= 2 && deck[deck.length - 1] === c.out) deck.unshift(deck.pop());
        }
        log = `${player.name} discarded an Authority delegate to cancel the inspiration (Regime Change)${lobbyTail}; the deck tops are restored.`;
      } else {
        const cycleDecks = [...DECK_TYPES, ...(state.m1 ? M1_DECK_TYPES : []), ...(state.m2 ? M2_DECK_TYPES : [])];
        const names = [];
        // Table-wide, so both libraries move under a Sirens species split.
        for (const deckMap of allDeckMaps(state)) {
        for (const t of cycleDecks) {
          const deck = deckMap[t];
          if (!deck || deck.length < 2) continue;
          const out = deck.shift();
          deck.push(out);
          names.push(`${t}: ${cardNameOf(deck[0])} surfaces`);
        }
        }
        log = `${player.name} discarded an Authority delegate to change the inspiration (Regime Change)${lobbyTail}. ${names.join('; ')}.`;
      }
    } else {
      return fail('unknown_event');
    }
  } else if (pending.kind === 'regime_change') {
    // Regime Change (solitaire Authority law): a non-inspiration event was rolled
    // and deferred. Let it stand (resolve the rolled event now), or discard an
    // Authority delegate (lobbying 1 aqua when the law is not active) to change
    // it into an Inspiration instead. Returns directly: resolving the chosen
    // event may set its OWN pendingEvent (e.g. Budget Cuts' discard pick), which
    // the shared tail below would otherwise clobber.
    const choice = String(op.choice || 'keep');
    const rolled = String(pending.rolledKind || '');
    if (choice === 'keep') {
      state.pendingEvent = null;
      resolveSunspotEvent(state, rolled, { skipRegime: true });
      const kept = `${player.name} let the ${EVENT_HEADLINES[rolled] || rolled} stand.`;
      pushNews(state, EVENT_ICONS[rolled] || '☄️', kept, []);
      return { ok: true, state, log: kept };
    }
    if (choice === 'change') {
      const asm = assemblyOf(state);
      if (placeCount(asm, 'authority', player.profileId) <= 0) return fail('no_delegate_there');
      const active = lawInForce(state, 'authority');
      if (!active && (player.aqua | 0) < 1) return fail('insufficient_aqua');
      if (!active) player.aqua -= 1;
      setPlaceCount(asm, 'authority', player.profileId, placeCount(asm, 'authority', player.profileId) - 1);
      const lobbyTail = active ? '' : ' (lobbied: 1 aqua + the delegate)';
      state.pendingEvent = null;
      state.lastEvent.kind = 'inspiration';
      state.lastEvent.regimeChangedFrom = rolled;
      resolveSunspotEvent(state, 'inspiration', { skipRegime: true });
      const changed = `${player.name} discarded an Authority delegate to change the ${EVENT_HEADLINES[rolled] || rolled} into an Inspiration (Regime Change)${lobbyTail}.`;
      pushNews(state, EVENT_ICONS.inspiration || '☄️', changed, []);
      return { ok: true, state, log: changed };
    }
    return fail('unknown_event');
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

// Compact d6-value summary of a move/build's hazard + rad rolls, for the mission
// log (user 2026-07-20: hazard and rad rolls should show). Lists only ACTUAL d6
// rolls (skips items paid via FINAO, safe-waived, or bypassed by thrust). The
// outcomes (a crit destroying the ship, a belt decommissioning cards) are
// narrated elsewhere; this just surfaces the numbers rolled.
function describeHazardRolls(rolls) {
  const haz = [];
  const rads = [];
  for (const r of (rolls || [])) {
    if (r == null || r.d6 == null) continue;
    if (r.kind === 'rad') rads.push(String(r.d6));
    else haz.push(String(r.d6));
  }
  const parts = [];
  if (haz.length) parts.push(`hazard d6 ${haz.join(', ')}`);
  if (rads.length) parts.push(`rad d6 ${rads.join(', ')}`);
  return parts.length ? ` [${parts.join('; ')}]` : '';
}

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
function chainCardsFromRocket(rocket, crewReactorKinds = null) {
  return rocket.stack.map((s) => {
    const c = PATENTS_BY_ID[s.id];
    const f = c ? slotFace(s, c) : {};
    const type = c ? c.type : (s.kind || 'crew');
    const pw = powerOfSlot(s);
    let supplies = (f && f.supplies) || (c && c.supplies) || [];
    if (isCrewSlot(s) && crewReactorKinds) supplies = [...supplies, ...crewReactorKinds];
    return {
      id: s.id,
      type,
      supplies,
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

// "Your Crew has an On-Board Nuclear X reactor" (L4 Antimatter Factory, HOME-
// gated) / "...ANY reactor" (the promoted Antimatter Lab, unconditional): the
// printed text says "Your Crew", not "Crew aboard THIS Bernal" - so this is a
// STANDING ability that applies to every Crew card the player owns, in ANY of
// their stacks (the rocket, the freighter, every Bernal's own cargo), not just
// cargo loaded onto the granting Bernal itself. Scans every anchored Bernal the
// player holds and unions the reactor kinds any of them grant. Returns null
// when the player has no such ability active anywhere.
//
// opts.pendingAnchorBn: applyAnchorBernal checks the Bernal's own support
// chain BEFORE flipping bn.anchored to true (a Bernal must be Operational to
// Anchor in the first place), so isHomeBernal(bn) - which requires anchored
// - would always read false for the very Bernal trying to anchor at a
// legitimate home-orbit site. Naming that one Bernal here lets its HOME gate
// fall back to the site's own homeBernal tag instead of requiring anchored.
function playerCrewReactorKinds(player, { pendingAnchorBn = null } = {}) {
  let kinds = null;
  for (const bn of ((player && player.bernals) || [])) {
    if (!bn) continue;
    const isPending = bn === pendingAnchorBn;
    if (!bn.anchored && !isPending) continue;
    const card = PATENTS_BY_ID[bn.cardId];
    const face = card && card.faces && card.faces[bn.face === 'secondary' ? 'secondary' : 'primary'];
    const pw = facePower(face && face.name);
    if (!pw || !Array.isArray(pw.crewOnBoardReactor)) continue;
    if (pw.crewOnBoardReactorHome) {
      const atHome = bn.anchored ? isHomeBernal(bn) : (bn.siteId != null && isHomeBernalSite(bn.siteId));
      if (!atHome) continue;
    }
    kinds = kinds ? Array.from(new Set([...kinds, ...pw.crewOnBoardReactor])) : [...pw.crewOnBoardReactor];
  }
  return kinds;
}

// Normalise a Bernal's stack into the support-chain resolver's card shape,
// with the Bernal card ITSELF as the chain root (its colony card is the
// active "thruster" that names the Bernal's power requirement, e.g.
// gen-electric). The Bernal card lives in `bn.cardId`, not in `bn.stack`, so
// it's prepended here. Used to check the Bernal is operational (its supports
// are satisfied) before it can Anchor. `crewReactorKinds` is the PLAYER-wide
// on-board-reactor grant (playerCrewReactorKinds), not just this Bernal's own -
// a Crew card sitting in THIS Bernal's cargo benefits from ANY Bernal the
// player owns granting the ability, same as the rocket / freighter.
function bernalChainCards(bn, crewReactorKinds = null) {
  const cards = [];
  const bc = PATENTS_BY_ID[bn.cardId];
  const bf = bc ? slotFace({ id: bn.cardId, face: bn.face }, bc) : null;
  if (bc) {
    cards.push({
      id: bn.cardId,
      type: bc.type,
      supplies: (bf && bf.supplies) || bc.supplies || [],
      requires: (bf && bf.requires) || bc.requires || [],
      thrustMod: bf ? bf.thrustMod : undefined,
      fuelMod: bf ? bf.fuelMod : undefined,
      therms: 0,
    });
  }
  for (const s of (bn.stack || [])) {
    const c = PATENTS_BY_ID[s.id];
    const f = c ? slotFace(s, c) : {};
    const type = c ? c.type : (s.kind || 'crew');
    // A card flagged "cannot be used to support Bernals" (Magnetoshell Plasma
    // Parachute) contributes NO supplies to the Bernal's support chain, so it
    // can't satisfy the Bernal's power requirement even though it is a
    // generator - the same restriction industrialize enforces. (User 2026-07-06.)
    const pw = powerOfSlot(s);
    const noBernalSupport = !!(pw && pw.safeAerobrakeNoBernalOrIndustrialize);
    let supplies = noBernalSupport ? [] : ((f && f.supplies) || (c && c.supplies) || []);
    if (isCrewSlot(s) && crewReactorKinds) supplies = [...supplies, ...crewReactorKinds];
    cards.push({
      id: s.id,
      type,
      supplies,
      requires: (f && f.requires) || (c && c.requires) || [],
      thrustMod: f ? f.thrustMod : undefined,
      fuelMod: f ? f.fuelMod : undefined,
      therms: 0,
    });
  }
  return cards;
}

// Is the Bernal operational: does every card in its resolved support chain
// have all of its requirement OR-groups satisfied by a supplier in the stack?
// Mirrors the resolver's prefix-grouping (an edge from a consumer means that
// group was met). Cooling is NOT checked here (the server never gates cooling,
// like the rest of the engine). Returns { operational, supportIds } where
// supportIds are the power cards feeding the Bernal (chain order minus the
// Bernal itself).
function bernalSupportStatus(bn, player = null, { pendingAnchor = false } = {}) {
  const cards = bernalChainCards(bn, playerCrewReactorKinds(player, { pendingAnchorBn: pendingAnchor ? bn : null }));
  const chain = resolveSupportChain({ cards, activeId: bn.cardId, wiring: bn.wiring || {} });
  const byId = new Map(cards.map((c) => [c.id, c]));
  let operational = true;
  for (const id of chain.order) {
    const c = byId.get(id);
    if (!c) continue;
    const groups = new Map();
    for (const r of (c.requires || [])) {
      const k = (r && typeof r === 'object') ? r.kind : r;
      if (!k) continue;
      const p = String(k).split('-')[0];
      if (!groups.has(p)) groups.set(p, []);
      groups.get(p).push(k);
    }
    for (const [, kinds] of groups) {
      const groupKey = kinds[0];
      if (!chain.edges.some((e) => e.from === id && e.kind === groupKey)) {
        operational = false;
      }
    }
  }
  const supportIds = new Set(chain.order.filter((id) => id !== bn.cardId));
  // 2A5b: anchoring decommissions ALL the Bernal's cooling radiators, not just
  // the one the KIND-based chain walk pulls per thermostat requirement. The walk
  // stops at the FIRST thermostat supplier, so a chain whose reactors + generators
  // need more THERMS than one radiator supplies (e.g. a 1-therm + a 2-therm for a
  // 3-therm demand) leaves the extra radiators out of `order`. Radiators are
  // single-purpose cooling cards, so in an operational Bernal every radiator in
  // the stack is part of its cooling support - add them all. (User bug: a needed
  // cooling radiator was left aboard after anchoring.)
  for (const c of cards) {
    if (c.id !== bn.cardId && c.type === 'radiator') supportIds.add(c.id);
  }
  return { operational, supportIds: [...supportIds] };
}

// Net thrust of the active thruster after ALL deterministic modifiers
// (mirror of rocket.js#getActiveThrusterStats's thrust folding): base face
// thrust + support-chain reactor/generator thrustMod + weight-class band
// (from wet mass) + solar-zone shift for solar-driven thrusters + an engaged
// afterburn's gain. This - NOT the printed base thrust - is what the
// The heliocentric zone that drives a solar sail's thrust modifier: LOCKED to
// the slug the ship began the turn on (rocket.turnStartSiteId, stamped in
// openTurnFor), resolved fresh via zoneOfSlug so a WAYPOINT (Hohmann / lagrange
// / burn) reports its real zone. A rocket with no stamp yet (an in-flight game
// mid-turn) falls back to its live position - which, for a ship that has not
// moved, IS its turn-start position. Exported so the gameView can stamp the
// resolved zone onto the snapshot for the client.
function rocketSolarZone(rocket) {
  if (!rocket) return 'Earth';
  const slug = Object.prototype.hasOwnProperty.call(rocket, 'turnStartSiteId')
    ? rocket.turnStartSiteId : rocket.siteId;
  return (slug != null ? zoneOfSlug(slug) : null) || 'Earth';
}
// liftoff/landing gate and the rad bypass must use. 0 when no thruster.
function activeNetThrust(rocket, powersat = false, solarBonus = 0, powersatFutureBonus = 0, crewReactorKinds = null) {
  const tid = rocket.activeThrusterId;
  if (!tid) return 0;
  const slot = rocket.stack.find((s) => s.id === tid);
  if (!slot) return 0;
  const f = thrusterFaceOf(slot);
  let thrust = Number.isFinite(f.thrust) ? f.thrust : null;
  if (thrust == null) return 0;
  // J5d Movement-Modifying Supports: an activated GW/TW thruster's movement is
  // NOT affected by movement-modifying supports (reactor/generator thrustMod +
  // fuelMod, and a chain solar generator's zone shift). Mirror of
  // rocket.js#getActiveThrusterStats (byte-parity contract).
  const isGwThruster = !!(PATENTS_BY_ID[tid] && PATENTS_BY_ID[tid].type === 'gw-thruster');
  // Powersat (ESA): extra thrust to a push-icon thruster for the privilege
  // holder. The standard beam adds +1, but a card can print its own push bonus
  // (MagBeam: +3 thrust if pushed by Powersat), read off the installed face's
  // power. MASS BEAM Future (powersatFutureBonus, caller-computed from
  // hasFutureEffect(player, 'powersatPlus2')): "your Powersat adds +2 thrust",
  // stacking on top of the card's own push bonus. Mirror of
  // rocket.js#getActiveThrusterStats.
  if (powersat && faceHasPush(f)) {
    const pw = facePower(f.name);
    thrust += ((pw && pw.powersatPushThrust != null) ? pw.powersatPushThrust : 1) + powersatFutureBonus;
  }
  // Support-chain thrust modifiers (rules 1+2, data/support-chain.js): mirror of
  // rocket.js#getActiveThrusterStats. Walk the full chain that powers this
  // thruster and add the thrustMod of the modifier path only (generators before
  // the first reactor + that first reactor, including reactors multiple hops
  // back). Must match the client exactly so a move it allows isn't rejected.
  const chain = resolveSupportChain({ cards: chainCardsFromRocket(rocket, crewReactorKinds), activeId: tid, wiring: rocket.wiring || {} });
  if (!isGwThruster) for (const cid of chain.modifierChain) {
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
    // Mirror of rocket.js: solar-driven when any generator in the RESOLVED
    // modifier chain is a solar electric generator, INCLUDING a multi-hop chain
    // (thruster -> radioisotope generator -> solar electric generator). The old
    // check only saw the thruster's DIRECT electric supplier, missing a solar
    // generator at depth 2. modifierChain already excludes idle + post-reactor
    // generators, so scanning it keeps the "idle solar generator" guard.
    if (!isGwThruster) for (const cid of chain.modifierChain) {
      const s = rocket.stack.find((x) => x.id === cid);
      const c = s && PATENTS_BY_ID[s.id];
      if (!c) continue;
      const cf = slotFace(s, c);
      if (faceHasSolar(cf) && (cf.supplies || []).includes('gen-electric')) { solarDriven = true; break; }
    }
  }
  if (solarDriven) {
    // Locked at turn start (rocketSolarZone reads turnStartSiteId), resolving a
    // waypoint's zone too, and falling back to the live position pre-stamp.
    const zone = rocketSolarZone(rocket);
    const info = SOLAR_ZONE_INFO[zone];
    const z = info ? info.solar : 0;
    if (z === null) thrust = 0;   // no sunlight - solar drive (and its bonus) is inert
    else thrust += z + (solarBonus || 0);   // Solar Cell Bernal: +1/+2 to solar spacecraft
  }
  // Afterburn engaged this turn: net thrust gain for the whole rocket. MW
  // afterburn is a fixed +1; GW/TW afterburn (card.type 'gw-thruster') gains
  // +afterburn-count (the card number is the thrust gained, not the cost).
  // Mirror of rocket.js. The fuel-step cost was paid at engage (applyAfterburn).
  if (rocket.afterburnEngaged && f.afterburn > 0) {
    const abCard = PATENTS_BY_ID[tid];
    thrust += (abCard && abCard.type === 'gw-thruster') ? f.afterburn : 1;
  }
  return thrust < 0 ? 0 : thrust;
}
// Water spent per burn = the active thruster face's `fuel` value, scaled
// by any other card's fuelMod (mirror of rocket.js#getActiveThrusterStats,
// the "N FT per burn" the client shows). The engine must charge the SAME
// so a move the client says it can afford isn't rejected. The move cost is
// ceil(fuelPerBurn * burns) (ceil applied to the whole move, as the client
// does), so free Hohmann coasting (0 burns) costs 0. Falls back to 1.
function thrusterFuelPerBurn(rocket, crewReactorKinds = null) {
  const tid = rocket.activeThrusterId;
  if (!tid) return 1;
  const slot = rocket.stack.find((s) => s.id === tid);
  if (!slot) return 1;
  // Crew-aware: a crew thruster reads fuelPerBurn off its rocket face.
  const f = thrusterFaceOf(slot);
  const p = PATENTS_BY_ID[tid];
  let fuel = f.fuel != null ? f.fuel : (p && p.fuel);
  if (fuel == null) return 1;
  // J5d: an activated GW/TW thruster ignores movement-modifying supports, so its
  // fuel-per-burn is not scaled by any support-chain fuelMod. Mirror of
  // rocket.js#getActiveThrusterStats.
  if (p && p.type === 'gw-thruster') return fuel;
  // Support-chain fuel modifiers (rules 1+2, data/support-chain.js): mirror of
  // rocket.js#getActiveThrusterStats. Scale fuel-per-burn by the fuelMod of the
  // modifier path only (generators before the first reactor + that first
  // reactor), folded in chain order so the client + server agree to the bit. A
  // self-powered thruster (requiring nothing) pulls no chain and is untouched.
  const chain = resolveSupportChain({ cards: chainCardsFromRocket(rocket, crewReactorKinds), activeId: tid, wiring: rocket.wiring || {} });
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
// Could ANY card in the stack be lost to a radiation belt roll at this thrust? A
// card is at risk only when it is NOT rad-immune (sails carry immuneBelt), NOT
// inert fuel cargo, and its rad-hardness is below the WORST possible roll result
// (d6 = 6, so 6 - thrust). When nothing is at risk the roll can only be a clean
// pass, so the move skips it (no die spent, so it stays undoable).
function someCardAtRadRisk(player, stack, thrust) {
  const maxRad = Math.max(0, 6 - thrust);
  if (maxRad <= 0) return false;
  return (stack || []).some((slot) => {
    const pw = powerOfSlot(slot);
    if (pw && pw.immuneBelt) return false;
    if (isFuelCardSlot(slot)) return false;
    return effectiveRadHardness(player, slot) < maxRad;
  });
}
function isCrewSlot(slot) {
  return slot.kind === 'crew' || !!CREW_BY_ID[slot.id];
}
// L5s Cancer Hospital (promoted, anchored): "Your Crew and Human Colonists
// have a rad-hard of at least 7." A survivability floor, not a real card stat
// change - applied by every caller that decides a Crew/Human-Colonist card's
// fate against radiation (belt rolls, the Glitch Roll, solar flares, Project
// Valkyrie's purge), never a raw slotRadHardness() read for those slots.
function hasPromotedCancerHospital(player) {
  return ((player && player.bernals) || []).some((bn) => bn && bn.anchored
    && bn.cardId === 'ber_l5s_cancer_hospital' && (bn.promoted || bn.face === 'secondary'));
}
// Tourism Cycler (white/HOME): "Can designate any Spacecraft to forgo Belt
// Rolls in the Radiation Belts near Earth." White-face-only ability (the
// promoted Lab face scores +2 VP/Dirtside instead, see bernalScoreVp).
function hasTourismCyclerWaiver(player) {
  return ((player && player.bernals) || []).some((bn) => bn
    && isHomeBernal(bn) && bn.cardId === 'ber_tourism_cycler');
}
function effectiveRadHardness(player, slot) {
  const base = slotRadHardness(slot);
  const col = COLONISTS_BY_ID[slot.id];
  const isHumanColonist = !!(col && col.colonistKind === 'Human');
  // V9 Sirens, "Diamonds Aren't Forever": Sirenian Crew and Colonists are
  // "CONSIDERED rad-hard 0" - a read-time rule modifier, NOT a change to the
  // card's printed data (which comes from the spreadsheet and is never rewritten
  // here). Carbon life out of a diamond ocean has no radiation tolerance, so any
  // roll above 0 takes them.
  // ROBOTS ARE EXCLUDED: the rule covers Crew and COLONISTS, and a robot is
  // hardware. Note this reads colonistKind directly rather than the
  // emancipation-aware isHumanColonistSlot, so a robot stays excluded even after
  // Emancipation promotes robots to Human for other purposes.
  // Checked BEFORE the Cancer Hospital bump, which would otherwise hand a Siren
  // a 7 and undo the rule.
  if (isSirenFaction(player) && (isCrewSlot(slot) || isHumanColonist)) return SIREN_RAD_HARDNESS;
  if (!hasPromotedCancerHospital(player)) return base;
  if (isCrewSlot(slot) || isHumanColonist) return Math.max(base, 7);
  return base;
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
  // High-Gravity Limit (H5e / H6c): factory-assist cannot carry a maneuver into
  // or out of a lander-burn space. A site behind a burn pad in its well needs
  // real net thrust > size, an aerobrake landing, or an Acetylene Rocketplane
  // Liftoff (opts.acetylene - the MOVE handler validates the atmospheric site +
  // factory + site-water cost before granting it). Skipped on an UNDO/REDO
  // replay (opts.replay): a move that was legal when the player made it must
  // still reconstruct, even though this rule was tightened mid-game, or the
  // replay fails and the undo dies. Also skipped for a promoted, anchored GEO
  // Elevator / Lofstrom Loop Bernal holder (opts.bernalLanderBurnWaived,
  // caller-computed): "factory-assisted landings/liftoffs anywhere treat
  // lander burns as normal Burn Spaces" - falls through to the plain
  // factory-assist gate below instead of the hard block.
  if (siteHasLanderBurn(slug) && !opts.acetylene && !opts.replay && !opts.bernalLanderBurnWaived) {
    return { ok: false, assist: false, needsRoll: false, size, landerBurn: true };
  }
  if (!state.factories[slug]) return { ok: false, assist: false, needsRoll: false, size };
  const colony = !!state.colonies[slug];
  // Safe Factory-Assist (Powersat rule e): a Powersat holder's factory-assist
  // needs no Hazard Roll, the same waiver a colony pad grants.
  return { ok: true, assist: true, needsRoll: !colony && !opts.powersat, size };
}
const LOFSTROM_LOOP_BERNAL_ID = 'ber_l3_lofstrom_loop_microgravity';
// GEO Elevator Bernal / L3 Lofstrom Loop (promoted, anchored anywhere - no
// HOME clause on this face): "Your factory-assisted landings/liftoffs
// anywhere treat lander burns as normal Burn Spaces." Feeds
// maneuverGate's opts.bernalLanderBurnWaived.
function bernalWaivesLanderBurn(player) {
  return ((player && player.bernals) || []).some((bn) => bn && bn.anchored
    && (bn.cardId === GEO_ELEVATOR_BERNAL_ID || bn.cardId === LOFSTROM_LOOP_BERNAL_ID)
    && (bn.promoted || bn.face === 'secondary'));
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
  // Never over a lander burn (or half-lander burn): factory-assist / colony pad
  // safety cannot carry a maneuver through a lander burn (the H5e/H6c high-
  // gravity limit), so a Hazard sitting on a lander-burn space always rolls even
  // with a colony pad. (User 2026-07-19: seen at Triton + a couple sites.)
  if (isLanderBurnNode(hazSlug)) return false;
  if (!neighborSlugs(from).includes(hazSlug)) return false;
  const around = [hazSlug, ...neighborSlugs(hazSlug)];
  return around.some((s) => state.factories[s] && state.colonies[s]);
}

// Destroy the rocket: patents fall back to the hand, crew re-spawns in
// the LEO Stack (variant rule), tank is lost, ship recalls to LEO.
// Mirror of browse.js#explodeRocket's state half.
function destroyRocket(player, state) {
  for (const slot of player.rocket.stack) {
    if (isCrewSlot(slot)) {
      // A destroyed rocket (failed hazard / aerobrake roll) kills its crew, who
      // respawn at LEO - a fatality in ceoSolo.
      if (state) crewDeathToLeo(state, player, slot);
      else (player.leo = player.leo || []).push({ id: slot.id, kind: 'crew', face: slot.face });
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
function rocketAtLeo(state, player) {
  const s = player.rocket && player.rocket.siteId;
  // V9 Sirens: a Siren faction's home base is Cordelia, not LEO, so this asks
  // "is the rocket at THIS player's home?" rather than "is siteId null?". For
  // everyone else homeBaseSiteId is null and this reduces to the original
  // `s == null || s === leoSlug()` exactly.
  if (isAtHomeBase(state, player, s === leoSlug() ? null : s)) return true;
  return false;
}

// Where the rocket may draw on the aqua bank (REFUEL / CASH_WATER): at LEO, and
// also while docked at one of the player's OWN anchored Home Bernals - a home
// base doubles as a fuel depot (user 2026-07-04). isHomeBernal is a hoisted
// function declaration, so calling it here (before its definition) is fine.
function rocketAtRefuelDepot(state, player) {
  if (rocketAtLeo(state, player)) return true;
  const s = player.rocket && player.rocket.siteId;
  if (s == null) return false;
  return (player.bernals || []).some((bn) => bn && bn.anchored && isHomeBernal(bn) && bn.siteId === s);
}

// A freighter / Bernal unit's rad-hardness: its card's installed-face rating. A
// belt / flare roll fails (glitches the unit) when the d6 is ABOVE this, so a
// rad-hardness >= 6 unit is immune to belt rolls (a d6 can't exceed it).
function unitRadHardness(unit) {
  const card = unit && PATENTS_BY_ID[unit.cardId];
  if (!card) return 0;
  const f = (card.faces && card.faces[unit.face === 'secondary' ? 'secondary' : 'primary']) || card;
  return (f.radHardness != null ? f.radHardness : card.radHardness) | 0;
}

// M1 Freighter movement (user spec, docs/module-m1-plan.md): the freighter is a
// SECOND mover with a simple model - 1 burn space per turn (no fuel; the sheet
// has no thrust/isp), free pivots up to the card's count, lands free on size-1
// sites (size > 1 needs factory assist), generic hazards + FINAO as normal, and
// a belt roll ABOVE the freighter's rad-hardness glitches the unit (a second
// such fail while glitched explodes it).
// ---- No Double Moves (rule I4b) ----
// No component (a card / figure aboard a vehicle) may move more than once per
// turn. A component that traverses at least one Space on ANY vehicle this turn
// is stamped movedThisTurn; because a TRANSFER carries the SAME slot object
// (not a fresh copy), the stamp rides the card, so it cannot hop onto another
// vehicle and move a second time the same turn. The stamp clears at the start
// of the owner's next turn (openTurnFor). Boosting is NOT movement (I4), so a
// boosted card is unstamped and may still ride a move that same turn.
// NOTE: the Fuel-Tank half of I4b (an FT that moved can't move again even if
// converted to Wet Mass Fuel and back) is not modeled here - tank water is not
// a discrete slot in this implementation. This enforces the cards + figures.
function stampStackMoved(stack) {
  for (const s of (stack || [])) if (s && typeof s === 'object') s.movedThisTurn = true;
}
function firstMovedComponent(stack) {
  return (stack || []).find((s) => s && typeof s === 'object' && s.movedThisTurn) || null;
}
function clearMovedStamps(player) {
  const wipe = (arr) => { for (const s of (arr || [])) if (s && typeof s === 'object') delete s.movedThisTurn; };
  if (player.rocket) wipe(player.rocket.stack);
  if (player.freighter) wipe(player.freighter.stack);
  for (const bn of (player.bernals || [])) wipe(bn && bn.stack);
  wipe(player.leo);
  for (const k of Object.keys(player.outposts || {})) wipe(player.outposts[k] && player.outposts[k].cards);
}

function applyMoveFreighter(state, op, player) {
  if (!state.m1) return fail('m1_off');
  const fr = player.freighter;
  if (!fr) return fail('no_freighter');
  if (!op.debug && (player.freighterMovesRemaining | 0) <= 0) return fail('no_moves_left');
  // I4b No Double Moves: a card that already moved this turn (e.g. on the rocket,
  // then transferred here) can't ride a second move on the freighter.
  if (!op.debug) {
    const dm = firstMovedComponent(fr.stack);
    if (dm) return fail('component_already_moved', { cardId: dm.id });
  }
  const from = fr.siteId;                  // null = LEO
  const here = from == null ? leoSlug() : from;

  // This turn's segments (the client planner is the route source of truth, same
  // as the rocket). Fall back to a direct destination tap.
  let segs = null;
  const opSegs = Array.isArray(op.segments) ? op.segments : null;
  if (opSegs && opSegs.length) {
    segs = opSegs.map((s) => ({ from: String(s.from), to: String(s.to), burns: Math.max(0, Number(s.burns) || 0) }));
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
  // A Freighter counts as Net Thrust 1 for all movement purposes (its per-turn
  // burn budget + the landing gate), +1 while its owner holds Powersat (it is a
  // beam-pushed craft, so it always benefits from Powersat). Bonus Pivots are
  // free; paid pivots come out of this burn budget, same as the rocket.
  const powersat = hasPowersat(state, player);
  const frCard0 = PATENTS_BY_ID[fr.cardId];
  const frFace0 = frCard0 && frCard0.faces && frCard0.faces[fr.face === 'secondary' ? 'secondary' : 'primary'];
  const frPw0 = frFace0 && facePower(frFace0.name);
  // Antiproton Sail and Harvester: +1 net thrust if starting the move on a
  // radiation belt. Poodle Steam: +2 thrust if starting the move on a Factory.
  // Checked against the freighter's site BEFORE this move (here/from).
  let originThrustBonus = 0;
  if (frPw0 && frPw0.beltOriginThrust && hazardKind(here) === 'rad') originThrustBonus += frPw0.beltOriginThrust;
  if (frPw0 && frPw0.factoryOriginThrust && state.factories[here]) originThrustBonus += frPw0.factoryOriginThrust;
  const frThrust = freighterNetThrust(powersat) + originThrustBonus;
  if (thisTurnBurns > frThrust) return fail('freighter_over_thrust', { thrust: frThrust, burns: thisTurnBurns });
  // Inflatable Solar-Heated / Archimedes Palmer Lens: "If not using Powersat,
  // may move out only as far as the [Ceres|Jupiter] zone." An OUTWARD cap
  // (Mercury/Venus, being inward of Earth, are never capped) checked against
  // the destination's zone only - not a full route re-derivation, just a fact
  // about where this move lands (same spirit as the fuel-step check above).
  if (frPw0 && frPw0.solarHeatedZoneCap && !powersat) {
    const capIdx = ZONE_ORDER.indexOf(frPw0.solarHeatedZoneCap);
    const destIdx = ZONE_ORDER.indexOf(zoneOfSlug(dest));
    if (capIdx >= 0 && destIdx > capIdx) {
      return fail('solar_heated_zone_cap', { capZone: frPw0.solarHeatedZoneCap, destZone: zoneOfSlug(dest) });
    }
  }
  // A freighter may stop on an aerobrake corridor (user 2026-06-27); the aero
  // hazard still rolls on entry and each parked turn unless a parachute
  // generator is aboard.

  // Landing: free on a size-1 (or aerobrake-landable) site, or when the
  // freighter's Net Thrust exceeds the site size; otherwise a size > 1 needs a
  // factory assist (roll, and only if a factory is present). Powersat both
  // raises the thrust (so it can settle a size-2 site on its own) and waives the
  // assist Hazard Roll. A promoted freighter face with the "liftoff/land on Sites
  // smaller than size 6 without factory-assist" ability (Fission GCR / Magnetic
  // Mirror Beam Rider) lands free on any site smaller than size 6.
  const destSize = nodeSizeNumber(dest);
  const frNoAssistUnder6 = !!(frPw0 && frPw0.freighterNoAssistUnder6);
  const landG = (isAerobrakeLandableSite(dest) || destSize <= 1 || (frNoAssistUnder6 && destSize < 6))
    ? { ok: true, needsRoll: false }
    : maneuverGate(state, dest, frThrust, { powersat, isFreighter: true, replay: !!op._replay, bernalLanderBurnWaived: bernalWaivesLanderBurn(player) });
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
  const finaoPer = finaoPerFor(state, player);
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
  // Rad rolls (belt / flare): the SAME formula the rocket uses (Player Aid
  // Threats table: "1d6, subtract net thrust, +2 if in Sunspot Cycle in red:
  // Decommission cards with lower rad-hardness") - a d6 minus the Freighter's
  // own net thrust (the SAME frThrust the movement gate above used: base 1,
  // +1 Powersat, plus any origin-thrust card ability) that still exceeds the
  // Freighter's rad-hardness fails. The freighter-specific consequence is
  // "Freighter Cargo: Stack receives a Glitch token instead" of decommissioning
  // individual cards - a second such fail while already glitched explodes it.
  // The RED season (solar flare) adds +2 to a belt roll, so even a hard
  // freighter can fail in red season - EXCEPT the belt the freighter STOPS in
  // (the destination): a unit ending its move inside a belt is sheltered from
  // the flare by the belt's own magnetic shadow (the same shelter a parked
  // rocket gets in applyFlareToPlayer), so its roll drops the +2. Belts merely
  // crossed still take it.
  if (!destroyed) {
    const frRad = unitRadHardness(fr);
    const seasonBonus = seasonForSlot(state.turn) === 'red' ? 2 : 0;
    // Skip the rad roll entirely (no die spent, so the move stays UNDOABLE)
    // when the crossing can't produce a consequence: a glitch-free stack
    // ignores every fail, and a freighter hard enough that no belt can fail
    // has nothing at stake. Mirrors the rocket's someCardAtRadRisk bypass so a
    // harmless rad crossing never seals the whole turn out of undo. (User: safe
    // rad moves stay undoable.)
    const frGlitchFree = playerHasColonistPower(state, player, 'glitchFree');
    const frCanFail = rad.some((slug) => {
      const flareBonus = (slug === dest) ? 0 : seasonBonus;
      return (6 + flareBonus - frThrust) > frRad;
    });
    if (frGlitchFree || !frCanFail) {
      for (const slug of rad) rolls.push({ slug, kind: 'rad', bypassed: true, radHard: frRad, thrust: frThrust });
    } else for (const slug of rad) {
      const flareBonus = (slug === dest) ? 0 : seasonBonus;
      const d6 = gen.d6();
      const radVal = Math.max(0, d6 + flareBonus - frThrust);
      const radFail = radVal > frRad;
      rolls.push({ slug, kind: 'rad', d6, fail: radFail, radHard: frRad, thrust: frThrust, seasonBonus: flareBonus });
      if (radFail) {
        if (playerHasColonistPower(state, player, 'glitchFree')) continue;   // glitch-free stacks
        if (fr.glitched) { destroyed = true; haltSlug = slug; break; }
        fr.glitched = true;
      }
    }
  }
  state.rng.cursor = gen.cursor;
  player.freighterMovesRemaining -= 1;
  fr.rolls = rolls;
  // I4b: the surviving cargo just moved a space - stamp it so it can't be
  // transferred to another vehicle and moved again this turn.
  if (!destroyed) stampStackMoved(fr.stack);

  const nameOf = (slug) => (siteById(slug) && siteById(slug).name) || (slug === leoSlug() ? 'LEO' : slug);
  const rolled = rolls.some((r) => r.d6 != null);
  if (destroyed) {
    // Decommission convention (like destroyRocket): a destroyed Freighter is NOT
    // gone for good - the Freighter card AND its cargo cards return to the
    // owner's hand so they can be re-boosted, rather than vanishing. Crew aboard
    // respawn at LEO (a fatality in ceoSolo); colonists retire to the queue.
    player.hand = player.hand || [];
    const returned = [];
    for (const s of (fr.stack || [])) {
      if (isCrewSlot(s)) { crewDeathToLeo(state, player, s); continue; }
      if (isColonistSlot(s)) { retireColonistId(state, player, s.id); continue; }
      player.hand.push(s.id);
      returned.push((PATENTS_BY_ID[s.id] && PATENTS_BY_ID[s.id].name) || s.id);
    }
    player.hand.push(fr.cardId);
    const lostCard = PATENTS_BY_ID[fr.cardId];
    player.freighter = null;
    player.freighterMovesRemaining = 0;
    const cargoNote = returned.length
      ? ` The Freighter card and its cargo (${returned.join(', ')}) return to hand.`
      : ' The Freighter card returns to hand.';
    return { ok: true, state, rolled: true, log: `${player.name}'s ${(lostCard && lostCard.name) || 'Freighter'} was destroyed at ${nameOf(haltSlug)}.${cargoNote}${describeHazardRolls(rolls)}` };
  }
  fr.siteId = (dest === leoSlug()) ? null : dest;
  // Echo this move's node path so the client glides the cube along it with the
  // SAME node-by-node animation the rocket uses (VISUAL ONLY; not redacted). Own
  // nonce so it never disturbs the rocket's dice-replay nonce.
  fr.lastMove = { at: fr.siteId, nonce: (fr.moveNonce | 0) + 1, path: [here, ...arrivals] };
  fr.moveNonce = fr.lastMove.nonce;
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
  return { ok: true, state, rolled, log: `${player.name} moved the Freighter to ${nameOf(dest)}${glitchTail}.${describeHazardRolls(rolls)}` };
}

// Fuel steps a Bernal spends per burn: the colony card's installed-face `fuel`
// (the dirt-crawler's steps-per-burn), defaulting to 1 if the card omits it.
function bernalFuelPerBurn(bn) {
  const card = PATENTS_BY_ID[bn.cardId];
  const face = slotFace({ id: bn.cardId, face: bn.face === 'secondary' ? 'secondary' : 'primary' }, card);
  const f = face && face.fuel != null ? Math.max(1, Math.floor(Number(face.fuel))) : 1;
  return f;
}

// M2 Bernal movement: a Bernal is a dirt CRAWLER (a slow cycler). It moves like a
// rocket for FUEL - it burns dirt fuel STEPS from its own tank along the shared
// fuel graph (data/fuel-graph.js), so the move is affordable iff the wet chit can
// walk that many black steps before dry mass - and like the Freighter for HAZARDS
// (generic crit destroys the unit, a rad fail glitches it, a second rad fail while
// glitched explodes it). One move per turn per Bernal (bn.movesRemaining). An
// anchored Bernal is a fixed station and cannot crawl. op.unit = 'bernal0'|'bernal1'.
function applyMoveBernal(state, op, player) {
  if (!state.m2) return fail('m2_off');
  const idx = Number(String(op.unit || '').slice('bernal'.length)) || 0;
  const bn = (player.bernals || [])[idx];
  if (!bn) return fail('no_bernal');
  if (bn.anchored) return fail('bernal_anchored');
  if (bn.movesRemaining == null) bn.movesRemaining = MOVES_PER_TURN;
  if (!op.debug && (bn.movesRemaining | 0) <= 0) return fail('no_moves_left');
  // I4b No Double Moves: a card already moved this turn (transferred aboard the
  // Bernal after moving elsewhere) can't ride the Bernal's crawl too.
  if (!op.debug) {
    const dm = firstMovedComponent(bn.stack);
    if (dm) return fail('component_already_moved', { cardId: dm.id });
  }
  // The colony card is the crawler: with no thrust value it can't move.
  const card = PATENTS_BY_ID[bn.cardId];
  const face = slotFace({ id: bn.cardId, face: bn.face === 'secondary' ? 'secondary' : 'primary' }, card);
  if (!face || face.thrust == null) return fail('no_thruster');
  // A Bernal crawls under its own thruster, and a thruster only fires when its
  // support chain is satisfied (a generator feeding it, that generator's reactor,
  // and so on) - the SAME power requirement that gates anchoring. An unpowered
  // Bernal can't burn, so it can't move. (User 2026-07-06.)
  if (!op.debug && !bernalSupportStatus(bn, player).operational) return fail('bernal_unsupported');
  const from = bn.siteId;                 // null = LEO
  const here = from == null ? leoSlug() : from;

  // This turn's segments (the client planner is the route source of truth).
  let segs = null;
  const opSegs = Array.isArray(op.segments) ? op.segments : null;
  if (opSegs && opSegs.length) {
    segs = opSegs.map((s) => ({ from: String(s.from), to: String(s.to), burns: Math.max(0, Number(s.burns) || 0) }));
  } else if (Array.isArray(bn.route) && bn.route.length && bn.route.some((s) => s.turn != null)) {
    segs = bn.route.filter((s) => (s.turn || 1) === 1).map((s) => ({ from: s.from, to: s.to, burns: Math.max(0, Number(s.burns) || 0) }));
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
  // One-way aerobrake (no traversal against the arrow).
  {
    const hopNodes = [here, ...arrivals];
    for (let i = 1; i < hopNodes.length; i++) {
      if (!aeroHopAllowed(hopNodes[i - 1], hopNodes[i])) return fail('aero_wrong_way', { from: hopNodes[i - 1], to: hopNodes[i] });
    }
  }
  // Fuel-step model against the Bernal's DIRT tank (rocket-shared fuel graph).
  const perBurn = bernalFuelPerBurn(bn);
  const dryMass = bernalDryMass(bn);
  const wetMass = dryMass + (Number(bn.tank) || 0);
  const stepsNeeded = Math.ceil(perBurn * thisTurnBurns);
  const stepsAvail = blackStepsBetween(dryMass, wetMass);
  const moveCalc = {
    unit: op.unit, dest, fuelStepsPerBurn: perBurn, dryMass, wetMass,
    tank: round6(bn.tank), fuelStepsInShip: stepsAvail, burnsNeeded: thisTurnBurns,
    fuelStepsNeeded: stepsNeeded, enough: stepsNeeded <= stepsAvail,
  };
  if (!op.debug && stepsNeeded > stepsAvail) {
    return fail('insufficient_water', { thisTurnBurns, fuelPerBurn: perBurn, fuelStepsNeeded: stepsNeeded, fuelStepsAvailable: stepsAvail, tank: round6(bn.tank), dryMass, wetMass });
  }
  // Landing: free on a size-1 (or aerobrake-landable) site; size > 1 needs assist.
  const destSize = nodeSizeNumber(dest);
  const landG = (isAerobrakeLandableSite(dest) || destSize <= 1) ? { ok: true, needsRoll: false } : maneuverGate(state, dest, 0, { powersat: hasPowersat(state, player), replay: !!op._replay, bernalLanderBurnWaived: bernalWaivesLanderBurn(player) });
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
    return { ok: true, state, log: '', calc: { ...moveCalc, destSize, glitched: !!bn.glitched, rollItems: rollItems.length, radZones: rad.length } };
  }

  // FINAO: pay aqua up front to skip the generic + assist rolls (rad always rolls).
  const wantPay = !!op.hazardPay;
  const finaoPer = finaoPerFor(state, player);
  const finaoCost = wantPay ? rollItems.length * finaoPer : 0;
  if (finaoCost > 0 && finaoCost > (player.aqua | 0)) return fail('insufficient_aqua');
  if (finaoCost > 0) player.aqua -= finaoCost;

  const gen = makeRng(state.seed, state.rng.cursor);
  const rolls = [];
  let destroyed = false, haltSlug = dest;
  if (!wantPay) {
    for (const item of rollItems) {
      const d6 = gen.d6();
      const crit = d6 === 1;
      rolls.push({ slug: item.slug, kind: item.kind, phase: item.phase, d6, crit });
      if (crit) { destroyed = true; haltSlug = item.slug; break; }
    }
  }
  if (!destroyed) {
    const bnRad = unitRadHardness(bn);
    const seasonBonus = seasonForSlot(state.turn) === 'red' ? 2 : 0;   // red season: solar flare +2
    // Skip the rad roll (no die → move stays UNDOABLE) when nothing can come of
    // it: a glitch-free stack ignores every fail, and a Bernal hard enough that
    // no belt can fail has nothing at stake. Same safe-rad bypass the rocket +
    // freighter use. (User: safe rad moves stay undoable.)
    const bnGlitchFree = playerHasColonistPower(state, player, 'glitchFree');
    const bnCanFail = rad.some((slug) => (6 + ((slug === dest) ? 0 : seasonBonus)) > bnRad);
    if (bnGlitchFree || !bnCanFail) {
      for (const slug of rad) rolls.push({ slug, kind: 'rad', bypassed: true, radHard: bnRad });
    } else for (const slug of rad) {
      // Stopping in a belt shelters from the flare (the belt's magnetic shadow),
      // so the destination belt drops the +2; belts merely crossed still take it.
      const flareBonus = (slug === dest) ? 0 : seasonBonus;
      const d6 = gen.d6();
      const radFail = (d6 + flareBonus) > bnRad;
      rolls.push({ slug, kind: 'rad', d6, fail: radFail, radHard: bnRad, seasonBonus: flareBonus });
      if (radFail) {
        if (playerHasColonistPower(state, player, 'glitchFree')) continue;   // glitch-free stacks
        if (bn.glitched) { destroyed = true; haltSlug = slug; break; }
        bn.glitched = true;
      }
    }
  }
  state.rng.cursor = gen.cursor;
  bn.movesRemaining -= 1;
  bn.rolls = rolls;
  // I4b: the surviving stack just crawled a space - stamp it against a second
  // move on another vehicle this turn.
  if (!destroyed) stampStackMoved(bn.stack);
  const nameOf = (slug) => (siteById(slug) && siteById(slug).name) || (slug === leoSlug() ? 'LEO' : slug);
  const rolled = rolls.some((r) => r.d6 != null);
  if (destroyed) {
    // The colony figure is lost, but the Bernal CARD returns to the owner's
    // hand (the decommission convention - a destroyed Bernal is not gone for
    // good, it can be re-boosted). Its cargo (crew / cards aren't destroyed with
    // the figure) scatters to the LEO Stack.
    player.leo = player.leo || [];
    // Whole slots again (see applyConvertOutpost): a fuel cargo card in the lost
    // Bernal's hold must arrive at LEO still carrying its grade + amount, not as
    // an empty husk. kind / face keep their defaults for older slots that lack them.
    for (const s of (bn.stack || [])) {
      player.leo.push({ ...s, kind: s.kind || 'patent', face: s.face === 'secondary' ? 'secondary' : 'primary' });
    }
    player.bernals = (player.bernals || []).filter((b) => b !== bn);
    (player.hand = player.hand || []).push(bn.cardId);
    const lostCard = PATENTS_BY_ID[bn.cardId];
    return { ok: true, state, rolled: true, log: `${player.name}'s ${(lostCard && lostCard.name) || 'Bernal'} was lost at ${nameOf(haltSlug)}; the card returns to hand and its cargo returns to LEO.${describeHazardRolls(rolls)}` };
  }
  // Spend the dirt: walk the wet chit down the fuel ladder (non-linear), so the
  // tank can end on a sub-1 remainder (whole-unit transfers can't move it out).
  bn.tank = round6(Math.max(0, walkBlackDown(wetMass, stepsNeeded) - dryMass));
  bn.siteId = (dest === leoSlug()) ? null : dest;
  // Record this crawl so the client glides the Bernal along the same node path
  // the rocket + freighter animate (its own nonce counter, mirror of the
  // freighter's fr.lastMove). A produce / recall / undo never bumps the nonce,
  // so those just snap.
  bn.lastMove = { at: bn.siteId, nonce: (bn.moveNonce | 0) + 1, path: [here, ...arrivals] };
  bn.moveNonce = bn.lastMove.nonce;
  // Truncate the Bernal's own planned route as it walks it (mirror the rocket).
  if (Array.isArray(bn.route) && bn.route.length) {
    if (bn.route.some((s) => s.turn != null)) {
      bn.route = bn.route.filter((s) => (s.turn || 1) > 1).map((s) => ({ ...s, turn: (s.turn || 1) - 1 }));
    } else {
      const i = bn.route.findIndex((s) => s.to === dest);
      if (i >= 0) bn.route = bn.route.slice(i + 1);
    }
  }
  const glitchTail = bn.glitched ? ' (glitched)' : '';
  return { ok: true, state, rolled, log: `${player.name} crawled the Bernal to ${nameOf(dest)}${glitchTail}.${describeHazardRolls(rolls)}` };
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
    segs = opSegs.map((s) => ({ from: String(s.from), to: String(s.to), burns: Math.max(0, Number(s.burns) || 0) }));
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
  const finaoPer = finaoPerFor(state, player);
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
    // A glitch-free stack ignores every rad fail, so the roll (a flat d6===1
    // fail here) can't matter - skip it entirely so the move stays UNDOABLE.
    // (A non-glitch-free factory always risks a 1/6 glitch, a real random
    // outcome, so that roll legitimately still blocks undo.)
    const facGlitchFree = playerHasColonistPower(state, player, 'glitchFree');
    if (facGlitchFree) {
      for (const slug of rad) rolls.push({ slug, kind: 'rad', bypassed: true });
    } else for (const slug of rad) {
      const d6 = gen.d6();
      const radFail = d6 === 1;
      rolls.push({ slug, kind: 'rad', d6, fail: radFail });
      if (radFail) {
        if (glitched) { destroyed = true; haltSlug = slug; break; }
        glitched = true;
      }
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
    return { ok: true, state, rolled: true, log: `${player.name}'s Mobile Factory was destroyed at ${nameOf(haltSlug)}.${describeHazardRolls(rolls)}` };
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
  return { ok: true, state, rolled, log: `${player.name} moved a Mobile Factory to ${nameOf(dest)}${tail}${glitchTail}.${describeHazardRolls(rolls)}` };
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
  // M2: a MOVE tagged for a Bernal drives that colony's dirt-crawl instead.
  if (typeof op.unit === 'string' && op.unit.startsWith('bernal')) return applyMoveBernal(state, op, player);
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
  // I4b No Double Moves: a card that already moved this turn (on the freighter
  // or a Bernal, then transferred aboard) can't ride the rocket's move too.
  if (!op.debug) {
    const dm = firstMovedComponent(player.rocket.stack);
    if (dm) return fail('component_already_moved', { cardId: dm.id });
  }
  const from = player.rocket.siteId;       // null = LEO
  const here = from == null ? leoSlug() : from;

  // The CLIENT's mission-planner is the source of truth for routing: it
  // splits a journey into turns and counts Hohmann-aware burns (free
  // coasting along a transfer). MOVE executes ONLY this turn's segments -
  // sent on the op (preferred, race-free) or read from the stored route's
  // turn-1 - so a multi-turn transfer's later legs are NOT charged now.
  // Each segment is { from, to, burns }.
  // NOTE: burns are NOT floored to an integer. A HALF-LANDER burn costs 0.5
  // burns (22 nodes in the planner graph carry landing: 0.5), and flooring it
  // made the half-lander free - the move charged 0 fuel steps even though the
  // plotter correctly showed 0.5. Keep the fraction: the cost only becomes an
  // integer at the end, via ceil(fuelPerBurn * burns) in stepsNeeded below.
  let segs = null;
  const opSegs = Array.isArray(op.segments) ? op.segments : null;
  if (opSegs && opSegs.length) {
    segs = opSegs.map((s) => ({
      from: String(s.from), to: String(s.to),
      burns: Math.max(0, Number(s.burns) || 0),
    }));
  } else if (Array.isArray(player.rocket.route) && player.rocket.route.length
             && player.rocket.route.some((s) => s.turn != null)) {
    segs = player.rocket.route
      .filter((s) => (s.turn || 1) === 1)
      .map((s) => ({ from: s.from, to: s.to, burns: Math.max(0, Number(s.burns) || 0) }));
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
    // Calypso 2 / Wet-Nano Seed Sail (colonist power, noAerobrake): "Can't
    // enter aerobrakes." A hard block, not a hazard-roll waiver - the stack
    // may never cross OR stop on an aerobrake corridor node at all.
    if (playerHasColonistPower(state, player, 'noAerobrake')) {
      const hit = hopNodes.find((n) => n && isAerobrakeNode(n));
      if (hit) return fail('no_aerobrake_entry', { site: hit });
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
  const powersat = hasPowersat(state, player);   // +1 push thrust + Safe Factory-Assist
  const solarBonus = solarCellThrustBonus(player.bernals);   // anchored Solar Cell Bernal: +1/+2 to solar craft
  const powersatFutureBonus = hasFutureEffect(player, 'powersatPlus2') ? 2 : 0;   // MASS BEAM Future
  const perBurn = thrusterFuelPerBurn(player.rocket, playerCrewReactorKinds(player));            // fuel steps per burn
  const dryMass = rocketDryMass(player.rocket.stack.reduce((mm, s) => mm + slotMass(s), 0));
  const wetMass = dryMass + (Number(player.rocket.tank) || 0);
  // Mag Sail bonus burns: each Radiation Belt entered this turn is a FREE burn
  // (the sail rides the belt's field for thrust, like a flyby bonus spot), so it
  // cancels one burn's fuel cost. Only when the ACTIVE thruster is the Mag Sail.
  // The CLIENT planner now credits this directly in the segment burns it sends
  // (beltBonusBurn in planner-nav.js), so when the client supplied segments the
  // credit is ALREADY baked into thisTurnBurns - the server must NOT subtract it
  // again (that double-credit was ghost fuel). Only the direct-mode fallback (no
  // client segments, the server's own planner does not model belts) still needs
  // the server to apply the credit. bonusBurns stays for the mission-log line.
  const activeThrusterSlot = player.rocket.stack.find((s) => s.id === player.rocket.activeThrusterId);
  const activePower = activeThrusterSlot ? powerOfSlot(activeThrusterSlot) : null;
  const beltsEntered = arrivals.filter((a) => hazardKind(a) === 'rad').length;
  const bonusBurns = (activePower && activePower.bonusBurnPerBelt) ? beltsEntered : 0;
  const clientSuppliedSegments = !!(segs && segs.length);
  const serverBeltCredit = clientSuppliedSegments ? 0 : bonusBurns;
  // Acetylene Rocketplane Liftoff (H6c, the High-Gravity Limit exception):
  // from an ATMOSPHERIC site with a usable factory, the ship may factory-assist
  // into the lander burn without thrust above the site size, by expending blue
  // FTs stored AT the site equal to 2 x the ship's initial wet mass (winged
  // boosters fueled from the atmosphere - the cost never touches the ship's
  // own tank or mass). The lander burn itself is still PAID like any burn, and
  // movement then continues treating lander burns as burns the ship cannot
  // halt on. op.acetyleneLiftoff opts in; validated fully here.
  let acetylene = false;
  let acetyleneCost = 0;
  if (op.acetyleneLiftoff && from) {
    if (!(isAtmosphericSite(from) || isAerostatSiteId(from))) return fail('not_atmospheric');
    if (!canUseFactoryNonVictory(state, player, state.factories[from])) return fail('no_factory');
    acetyleneCost = Math.ceil(2 * wetMass);
    const siteTanks = Object.values(player.outposts || {}).filter((o) => o && o.siteId === from);
    const availWater = siteTanks.reduce((s, o) => s + Math.floor(Number(o.tank) || 0), 0);
    if (availWater < acetyleneCost) return fail('insufficient_site_water', { need: acetyleneCost, have: availWater });
    // Lander burns cannot be halted on: the turn's movement must end past
    // them, never sitting on the pad.
    if (isLanderBurnNode(dest)) return fail('cannot_halt_lander_burn', { site: dest });
    acetylene = true;
  }
  // Baltimore Gun Club (WATER/HYDROGEN ARCJET): a colocated thruster gets a
  // bonus burn if the move starts at a qualifying departure site. WATER
  // ARCJET (primary) only credits LEO; the flipped HYDROGEN ARCJET
  // (secondary) also credits the player's own Anchored Bernal or Factory.
  // The card carries no thruster of its own (thruster: null on both faces),
  // so this only matters when a DIFFERENT active thruster is doing the
  // burning - same "colocated" pattern as data/support-chain.js's modifier
  // cards.
  const baltimoreSlot = player.rocket.stack.find((s) => s.id === 'crew_baltimore_gun_club');
  let arcjetCredit = 0;
  if (baltimoreSlot) {
    const atLeo = from == null;
    const hydrogenFace = baltimoreSlot.face === 'secondary';
    const atOwnedBernal = hydrogenFace && (player.bernals || []).some((bn) => bn && bn.anchored && bn.siteId === here);
    const atOwnedFactory = hydrogenFace && !!(state.factories[here] && state.factories[here].ownerId === player.profileId);
    if (atLeo || atOwnedBernal || atOwnedFactory) arcjetCredit = 1;
  }
  const paidBurns = Math.max(0, thisTurnBurns - serverBeltCredit - arcjetCredit);
  const stepsNeeded = Math.ceil(perBurn * paidBurns);
  const stepsAvail = blackStepsBetween(dryMass, wetMass);
  // Full burn-math breakdown - returned on a reject (detail) AND on the debug
  // dry-run (result.calc) so the client can show every intermediate value
  // instead of just tank before/after.
  const moveCalc = {
    finalThrust: activeNetThrust(player.rocket, powersat, solarBonus, powersatFutureBonus, playerCrewReactorKinds(player)),
    fuelStepsPerBurn: perBurn,
    dryMass,
    wetMass,
    tank: round6(player.rocket.tank),
    fuelStepsInShip: stepsAvail,
    canBurn: perBurn > 0 ? Math.floor(stepsAvail / perBurn) : null,
    burnsNeeded: thisTurnBurns,
    ...(bonusBurns ? { bonusBurns, paidBurns } : {}),
    ...(arcjetCredit ? { arcjetCredit, paidBurns } : {}),
    ...(acetylene ? { acetylene: true, acetyleneCost } : {}),
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
    // No spectral gate on burning: a player's own isotope always matches their
    // own GW/TW thruster. The game tracks no per-tank spectral for your own fuel,
    // so any isotope in your tank fuels your engine.
  }
  if (stepsNeeded > stepsAvail) {
    return fail('insufficient_water', moveCalc);
  }

  // Hazards along the nodes we ARRIVE at this turn, classified the same
  // way the sandbox does. Generic (skull / aerobrake) hazards are
  // aqua-payable (FINAO) or rolled; rad zones always roll (unpayable).
  const generic = [];   // skull / aero slugs (in travel order)
  const rad = [];       // rad slugs
  // Tourism Cycler (white/HOME): "Can designate any Spacecraft to forgo Belt
  // Rolls in the Radiation Belts near Earth." Scoped to the rocket (the only
  // unit with a per-card rad-roll model); Earth-zone rad hops are pulled out
  // of `rad` here so they never roll at all, logged as bypassed below.
  const radWaived = [];
  const tourismWaives = hasTourismCyclerWaiver(player);
  for (const slug of arrivals) {
    const k = hazardKind(slug);
    if (k === 'rad') {
      if (tourismWaives && zoneOfSlug(slug) === 'Earth') radWaived.push(slug);
      else rad.push(slug);
    } else if (k === 'skull' || k === 'aero') generic.push(slug);
  }
  const thrust = activeNetThrust(player.rocket, powersat, solarBonus, powersatFutureBonus, playerCrewReactorKinds(player));
  // Factory-assist liftoff / landing gate. A maneuver where net thrust
  // <= site size is only legal if a factory carries it (assist), which
  // is a hazard roll unless a colony waives it. No factory => hard block.
  // Liftoff gates the origin (skipped at LEO, siteId null); landing gates
  // the destination.
  const liftG = from ? maneuverGate(state, from, thrust, { powersat, acetylene, replay: !!op._replay, bernalLanderBurnWaived: bernalWaivesLanderBurn(player) }) : { ok: true, needsRoll: false };
  if (!liftG.ok) return fail('cannot_liftoff', { thrust, siteSize: liftG.size, site: from, landerBurn: !!liftG.landerBurn });
  // Aerobrake landing: a destination that sits next to an aerobrake corridor
  // (the 🪂 symbol) can be reached by parachute - no thrust-to-land
  // requirement, no factory needed. Liftoff is never aerobraked (you can't
  // parachute UP), so only the landing gate is waived. The aero hazard roll
  // (above, for corridor nodes actually crossed this turn) is the descent risk.
  const landG = isAerobrakeLandableSite(dest)
    ? { ok: true, assist: false, needsRoll: false }
    : maneuverGate(state, dest, thrust, { powersat, replay: !!op._replay, bernalLanderBurnWaived: bernalWaivesLanderBurn(player) });
  if (!landG.ok) return fail('cannot_land', { thrust, siteSize: landG.size, site: dest, landerBurn: !!landG.landerBurn });
  // Ordered roll items: liftoff assist, route generics (skull/aero), then
  // landing assist. Each is aqua-payable (FINAO) or a d6 where a 1 is a
  // critical that destroys the ship.
  const rollItems = [];
  const safeAero = stackSafeAerobrake(player.rocket);
  const safeAeroSlugs = [];     // aero hazards the parachute waived (for playback)
  const colonyWaivedSlugs = []; // liftoff hazards a colony pad waived (for playback)
  const crashIgnoredSlugs = []; // H6c: first-space hazard ignored on a factory-assist liftoff
  // H6c Crash Hazard: the FIRST space moved into with a factory-assist liftoff
  // has its hazard IGNORED. Only the immediate liftoff-leg node (arrivals[0]),
  // and only when the liftoff actually uses factory-assist (liftG.assist). The
  // assist's own roll is handled separately (liftG.needsRoll, waived by a colony
  // or Powersat), so a factory-assist liftoff + Powersat clears with no roll.
  const crashSpace = (liftG.assist && from && arrivals.length) ? String(arrivals[0]) : null;
  if (liftG.needsRoll) rollItems.push({ slug: from, kind: 'assist', phase: 'liftoff' });
  for (const slug of generic) {
    const k = hazardKind(slug);
    // A safe-aerobrake card (parachute generator) carries the stack through
    // aerobrake hazards with no roll; skull hazards still roll.
    if (k === 'aero' && safeAero) { safeAeroSlugs.push(slug); continue; }
    // Factory-assist liftoff ignores the hazard on the first space entered
    // (H6c) - but NEVER when that space is a lander burn (or half-lander burn).
    // Factory-assist can't carry a maneuver into a lander burn (the H5e/H6c
    // high-gravity limit); only an Acetylene Rocketplane liftoff enters one, and
    // even then the lander burn's own Hazard still rolls. So a Hazard sitting on
    // a lander-burn space is never crash-ignored. (User 2026-07-19: seen at
    // Triton + a couple sites.)
    if (crashSpace && slug === crashSpace && !isLanderBurnNode(slug)) { crashIgnoredSlugs.push(slug); continue; }
    // A factory-with-colony makes the launch pad safe: liftoff-leg skull /
    // aero hazards adjacent to the colony pass with no roll.
    if (liftoffColonyWaives(state, from, slug)) { colonyWaivedSlugs.push(slug); continue; }
    rollItems.push({ slug, kind: k });
  }
  if (landG.needsRoll) rollItems.push({ slug: dest, kind: 'assist', phase: 'landing' });

  const wantPay = !!op.hazardPay;
  // Per-hazard choice: op.hazardChoices is an array of 'pay'|'roll', one
  // entry per rollItem in TRAVEL order (liftoff assist, then route generics,
  // then landing assist - matches the order the client lists them in). Lets
  // a player pay FINAO for SOME hazards and roll the rest in one move,
  // instead of an all-or-nothing choice (player report: "I don't see a
  // choice to pay only for some of them and roll for the rest"). Falls back
  // to the single hazardPay boolean (pay-all / roll-all) when hazardChoices
  // is absent or the wrong length, so older callers (freighter / Bernal
  // moves, which still send one flag) keep working unchanged.
  const hazardChoices = (Array.isArray(op.hazardChoices) && op.hazardChoices.length === rollItems.length)
    ? op.hazardChoices.map((c) => (c === 'pay' ? 'pay' : 'roll'))
    : rollItems.map(() => (wantPay ? 'pay' : 'roll'));
  // FINAO: pay aqua up front to skip a hazard's roll. Validated before
  // anything mutates so a short balance rejects the move cleanly. Open
  // Source FINAO (Anonymous P2P) discounts the per-hazard cost to 3.
  const finaoPer = finaoPerFor(state, player);
  const paidCount = hazardChoices.filter((c) => c === 'pay').length;
  const finaoCost = paidCount * finaoPer;
  if (finaoCost > 0 && finaoCost > (player.aqua | 0)) return fail('insufficient_aqua');

  // Commit the burn + the FINAO payment, then resolve dice in travel
  // order. rolls[] is recorded on the rocket for the client to play
  // back (server is authoritative for every die).
  // Spend the fuel: walk the wet chit down `stepsNeeded` black connections;
  // the new tank water is whatever mass is left above dry (often fractional).
  player.rocket.tank = round6(walkBlackDown(wetMass, stepsNeeded) - dryMass);
  if (finaoCost > 0) player.aqua -= finaoCost;
  // Acetylene liftoff: burn the site's stored water (the player's outpost
  // tank(s) here), oldest outpost first. Whole units; validated above.
  if (acetylene) {
    let owed = acetyleneCost;
    for (const o of Object.values(player.outposts || {})) {
      if (!o || o.siteId !== from || owed <= 0) continue;
      const take = Math.min(Math.floor(Number(o.tank) || 0), owed);
      o.tank = round6((Number(o.tank) || 0) - take);
      owed -= take;
    }
  }

  const gen = makeRng(state.seed, state.rng.cursor);
  const rolls = [];
  let destroyed = false;
  let haltSlug = dest;            // where the rocket actually ends up

  // Aerobrakes the parachute waived: recorded as safely passed (no roll) so
  // the client plays them back as a clean pass rather than a missing node.
  for (const slug of safeAeroSlugs) rolls.push({ slug, kind: 'aero', safe: true });
  for (const slug of colonyWaivedSlugs) rolls.push({ slug, kind: hazardKind(slug), safe: true });
  for (const slug of crashIgnoredSlugs) rolls.push({ slug, kind: hazardKind(slug), safe: true });
  for (const slug of radWaived) rolls.push({ slug, kind: 'rad', bypassed: true, tourismCycler: true });

  // Generic + assist rolls, per-hazard: a 'pay' choice skips the roll (FINAO
  // already charged above); a 'roll' choice rolls a d6, and a 1 is a
  // critical that destroys the ship at that node and halts the sequence.
  for (let i = 0; i < rollItems.length; i++) {
    const item = rollItems[i];
    if (hazardChoices[i] === 'pay') {
      rolls.push({ slug: item.slug, kind: item.kind, phase: item.phase, paid: true });
      continue;
    }
    const d6 = gen.d6();
    // The guided tutorial never punishes a hazard roll: the die still shows, but
    // a critical does NOT destroy the ship (nothing is lost to a roll in the
    // tutorial). (User 2026-07-10.)
    const crit = d6 === 1 && !state.tutorial;
    rolls.push({ slug: item.slug, kind: item.kind, phase: item.phase, d6, crit });
    if (crit) { destroyed = true; haltSlug = item.slug; break; }
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
    } else if (!someCardAtRadRisk(player, player.rocket.stack, thrust)) {
      // Nothing in the stack can be lost regardless of the roll (every rad-
      // sensitive card out-hardens the worst possible result), so skip the roll:
      // no die is spent, so the move stays UNDOABLE. (User: bypass the rad roll +
      // allow undo when no cards are at risk.)
      for (const slug of rad) rolls.push({ slug, kind: 'rad', bypassed: true, thrust });
    } else {
      let worst = 0;
      for (const slug of rad) {
        const d6 = gen.d6();
        const radVal = Math.max(0, d6 - thrust);
        if (radVal > worst) worst = radVal;
        rolls.push({ slug, kind: 'rad', d6, rad: radVal, thrust });
      }
      // The guided tutorial never decommissions or degrades a card to a
      // radiation belt roll - the rolls play, but the ship rides through
      // unscathed. (User 2026-07-10.)
      if (worst > 0 && !state.tutorial) {
        const survivors = [];
        for (const slot of player.rocket.stack) {
          // Sails (Photon Heliogyro / Electric Sail / Photon Kite Sail) are
          // immune to Belt Rolls - the belt never decommissions them.
          const pw = powerOfSlot(slot);
          if (pw && pw.immuneBelt) { survivors.push(slot); continue; }
          // Fuel cargo cards are inert propellant, not rad-sensitive hardware:
          // the belt never degrades them (and they're not hand cards, so they
          // must never be "decommissioned to hand").
          if (isFuelCardSlot(slot)) { survivors.push(slot); continue; }
          if (effectiveRadHardness(player, slot) < worst) {
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
              crewDeathToLeo(state, player, slot);   // rad roll: a fatality in ceoSolo
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
      cards: chainCardsFromRocket(player.rocket, playerCrewReactorKinds(player)),
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
        if (effectiveRadHardness(player, slot) < purgeBelow) {
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
    // Record the crew that evacuate to LEO so the client can offer to relocate
    // them to the player's Home Bernal (post-death choice, user 2026-07-07).
    const evac = player.rocket.stack.filter(isCrewSlot).map((s) => s.id);
    player.rocket.lastMove = { rolls, destroyed: true, at: haltSlug, nonce: nextMoveNonce(player), evac };
    destroyRocket(player, state);
    return {
      ok: true, state,
      log: `${player.name} burned ${stepsNeeded} fuel steps and was DESTROYED at ${whereName} (rolled a 1).${describeHazardRolls(rolls)}`,
    };
  }

  // Arriving back at LEO normalises to the canonical null position (LEO is
  // "no site"), so the at-LEO ops recognise it without special-casing the slug.
  player.rocket.siteId = (dest === leoSlug()) ? null : dest;
  // I4b No Double Moves: every card still aboard just moved at least one space,
  // so stamp it - it cannot be transferred to another vehicle and moved again
  // until this player's next turn.
  stampStackMoved(player.rocket.stack);
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
  // Arriving home: each chit rides home with the SPECIFIC Human that grabbed it
  // - see cashHomeGloryChits. Only chits whose carrier is aboard THIS rocket
  // score now (BACK, brought home alive); a chit whose crew is parked elsewhere
  // in play stays carried and rides home later with THAT crew.
  // "Home" is the player's OWN home base, so a Siren cashes glory by returning
  // to Cordelia. Off-Sirens homeBaseSiteId is null and this is the same
  // `siteId === null` test it has always been.
  const home = rocketAtLeo(state, player) ? cashHomeGloryChits(state, player) : null;
  const homeScored = home ? home.scored : 0;
  const homeVps = home ? home.vps : 0;
  const homeSide = home ? home.side : null;
  // Echo the exact node path the move walked (origin slug, then each segment's
  // destination) so the CLIENT can animate the ship along the real plotted nodes
  // instead of re-deriving a path from the planner. Pure presentation: no rule
  // reads this. A teleport-style move (no segments) leaves it as just the
  // destination, so the client slides one node in that direction.
  const movePath = (segs && segs.length)
    ? [segs[0].from].concat(segs.map((s) => s.to))
    : (dest != null ? [dest] : []);
  player.rocket.lastMove = {
    rolls, destroyed: false, decommissioned,
    at: dest, nonce: nextMoveNonce(player), path: movePath,
  };

  const destName = (destSite && destSite.name) || dest;
  // Origin captured before the move (siteId was already advanced to dest).
  // null == LEO. Fuel steps (not water): a burn spends fuel steps, which
  // are non-linear with the water/aqua loaded onto the rocket.
  const originName = from == null ? 'LEO' : ((siteById(from) || {}).name || from);
  let log = `${player.name} burned ${stepsNeeded} fuel steps from ${originName} to ${destName}.`;
  if (acetylene) log += ` Acetylene Rocketplane Liftoff: ${acetyleneCost} water burned from the site's tanks (2 x wet mass).`;
  const nItems = rollItems.length;
  const rolledCount = nItems - paidCount;
  if (finaoCost > 0 && rolledCount > 0) {
    log += ` Paid ${finaoCost} aqua (FINAO) past ${paidCount} hazard${paidCount === 1 ? '' : 's'} and rolled through ${rolledCount}.`;
  } else if (finaoCost > 0) {
    log += ` Paid ${finaoCost} aqua (FINAO) past ${nItems} hazard${nItems === 1 ? '' : 's'}.`;
  } else if (nItems) {
    log += ` Rolled through ${nItems} hazard${nItems === 1 ? '' : 's'}.`;
  }
  log += describeHazardRolls(rolls);
  if (decommissioned.length) log += ` Radiation decommissioned ${decommissioned.length} card${decommissioned.length === 1 ? '' : 's'}.`;
  if (degradedRadiators.length) log += ` Radiation degraded ${degradedRadiators.length} radiator${degradedRadiators.length === 1 ? '' : 's'} to its light side.`;
  if (sailDecommissioned.length) log += ` Aerobraking burned off ${sailDecommissioned.join(', ')} (decommissioned to hand).`;
  if (valkyriePurged.length) log += ` Project Valkyrie irradiated the stack: ${valkyriePurged.join(', ')} decommissioned (rad-hard < 4).`;
  if (bonusBurns) log += ` Mag Sail rode ${bonusBurns} radiation belt${bonusBurns === 1 ? '' : 's'} for a free burn each.`;
  if (arcjetCredit) log += ' Arcjet bonus burn from the departure site.';
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
// The GEO node (server slug): the GEO Elevator Bernal anchored HERE is a space
// elevator. Mirror of data/space-elevators.js's `geo` pair (a = 'burn-geo').
const GEO_NODE = 'burn-geo';
// Aqua cost to boost white-side cards DIRECT to an anchored Home Bernal. Normally
// it DOUBLES the boost (mass) cost - the cards climb higher up the well - but a
// Boosting direct to an anchored Bernal normally DOUBLES the mass cost. The
// waiver ("without doubling boost costs") is a HOME-Bernal ability - both cards
// that carry it (the GEO Elevator + the L3 Lofstrom Loop) print it as "HOME:
// ...", so it only applies while that Bernal actually IS the Home Bernal
// (anchored at its Home Orbit). A GEO Elevator / Lofstrom anchored anywhere else
// is NOT a Home Bernal, so it doubles like every other Bernal. (Reading the card
// text alone waived the doubling for a GEO Elevator parked off-GEO - the bug.)
// (The GEO Elevator boost used to be FREE; nerfed back to plain cost 2026-07-04.)
function bernalBoostCost(baseCost, bn, card) {
  const ability = (card && card.faces && card.faces.primary && card.faces.primary.ability)
    || (card && card.ability) || '';
  if (isHomeBernal(bn) && /without doubling/i.test(ability)) return baseCost;
  return baseCost * 2;
}
function applyBoost(state, op, player) {
  const ids = Array.isArray(op.cardIds) ? op.cardIds.map(String) : [];
  if (!ids.length) return fail('nothing_to_boost');
  // Free once the turn's boosting has begun (same economy as the raygun). The
  // solitaire Individuality law (Launch Contracts) makes boosting a free action
  // outright - it never spends the turn's operation.
  const launchContracts = !!state.ceoSolo && playerCanUseLaw(state, player, 'individuality');
  const free = hasBoostedThisTurn(state) || launchContracts;
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
  // Optional destination: boost DIRECT to one of your ANCHORED Bernals instead of
  // LEO (user 2026-06-27). The boosted white-side cards land in that colony's
  // stack; the cost follows the Bernal's boost rule (bernalBoostCost). A Bernal
  // CARD establishes its own colony, so it can't ride into another Bernal.
  const toRaw = op.to != null ? String(op.to) : 'leo';
  let destBernal = null;
  if (toRaw.startsWith('bernal')) {
    if (!state.m2) return fail('m2_off');
    destBernal = (player.bernals || [])[Number(toRaw.slice('bernal'.length)) || 0] || null;
    if (!destBernal) return fail('no_bernal');
    if (!destBernal.anchored) return fail('bernal_not_anchored');
    // Only the HOME Bernal is a valid boost destination (rule): a Dirtside
    // (non-home) anchored Bernal raises the colonist allowance but is not a
    // boarding / boost station.
    if (!isHomeBernal(destBernal)) return fail('not_home_bernal');
    if (bernalIds.length) return fail('cannot_boost_bernal_to_bernal');
  }
  // Cost = total mass of the boosted cards (aqua). A radiator's mass depends on
  // its chosen deployed side (heavy is heavier), so factor that in per id.
  const radSides = (op.radSides && typeof op.radSides === 'object') ? op.radSides : {};
  let cost = 0;
  // Default to the light side (matches the slot assignment below) so the
  // charge and the locked side never disagree.
  for (const id of ids) cost += boostMass(id, radSides[id] === 'heavy' ? 'heavy' : 'light');
  // Boosting to an anchored Bernal re-prices the whole boost (doubled / waived /
  // free) instead of the flat LEO mass cost.
  if (destBernal) cost = bernalBoostCost(cost, destBernal, PATENTS_BY_ID[destBernal.cardId]);
  // New Attica Secessionists (colonist power): boost costs are doubled for
  // every OPPONENT of the colonist's owner.
  let atticaTax = false;
  if (state.m2 && cost > 0) {
    for (const opp of state.players) {
      if (opp.profileId === player.profileId) continue;
      if (playerHasColonistPower(state, opp, 'opponentsBoostDoubled')) { atticaTax = true; break; }
    }
    if (atticaTax) cost *= 2;
  }
  if (cost > player.aqua) return fail('insufficient_aqua');
  // Move them hand -> LEO (or, for a Bernal, hand -> a new colony stack). A
  // radiator locks its deployed light/heavy side here (op.radSides[id]); default
  // light (lighter, cheapest to boost). Only radiation damage flips it afterward.
  player.bernals = player.bernals || [];
  // Figure is chosen at CREATION (user 2026-06-27): the boost op may carry a
  // per-card figure pick (op.figures[cardId] = 'kalpana' | 'stanford'). Falls
  // back to the old count-based default (1st Kalpana, 2nd Stanford) so a client
  // that sends none still works.
  const boostFigures = (op.figures && typeof op.figures === 'object') ? op.figures : {};
  for (const id of ids) {
    const idx = player.hand.indexOf(id);
    if (idx >= 0) player.hand.splice(idx, 1);
    const card = PATENTS_BY_ID[id];
    if (state.m2 && card && card.type === 'bernal') {
      // Player's chosen figure for THIS card. Each figure (Kalpana / Stanford)
      // is UNIQUE to a player, so a request for one already built falls through
      // to the free figure. Reads player.bernals, which already includes any
      // Bernal pushed earlier in this same boost.
      const figure = pickBernalFigure(player, boostFigures[id]);
      player.bernals.push({
        cardId: id, figure, face: 'primary', promoted: false,
        siteId: null, stack: [], tank: 0, wiring: {}, route: [],
        movesRemaining: MOVES_PER_TURN,
      });
      continue;
    }
    const slot = { id, kind: 'patent' };
    if (card && card.type === 'radiator') {
      slot.radSide = radSides[id] === 'heavy' ? 'heavy' : 'light';
    }
    // Boost direct to an anchored Bernal: the card lands in its colony stack.
    if (destBernal) { destBernal.stack = destBernal.stack || []; destBernal.stack.push(slot); }
    else player.leo.push(slot);
  }
  player.aqua -= cost;
  if (!free) player.opsRemaining -= 1;
  const nLeo = ids.length - bernalIds.length;
  const tail = free ? ' (continued boost, no operation)' : '';
  let log;
  if (destBernal) {
    const destName = (PATENTS_BY_ID[destBernal.cardId] || {}).name || 'Bernal';
    log = `${player.name} boosted ${ids.length} card${ids.length === 1 ? '' : 's'} direct to the ${destName} for ${cost} aqua${tail}.`;
  } else if (bernalIds.length) {
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
// The BLACK / installed face of a card. Most cards' black (ET-produced) good is
// their SECONDARY face. GW thrusters + Freighters are the exception: they carry
// the working black card on the PRIMARY face, and their SECONDARY face is the
// PURPLE promoted side (TW thruster / promoted freighter, reached via Promotion).
// So delivery + free-market + any "is this the black good" test must read this,
// not a hard-coded 'secondary'.
function blackSideFace(card) {
  return (card && (card.type === 'gw-thruster' || card.type === 'freighter')) ? 'primary' : 'secondary';
}
function applyFreeMarket(state, op, player) {
  // ARTIFICIAL CONSCIOUSNESS Future: "May free market any number of cards" -
  // every Free Market this player runs is a free action (no operation spent),
  // and the base 1-card / Freedom-law 2-card caps below no longer apply.
  const marketUnlimited = hasFutureEffect(player, 'freeMarketUnlimited');
  if (!marketUnlimited && player.opsRemaining <= 0) return fail('no_ops_left');
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
    const card = PATENTS_BY_ID[id];
    if (!card) return fail('unknown_card');
    // Only manufactured goods (a card on its BLACK face) sell here; crew faces
    // aren't goods, and Purple-Side (promoted) cards can't be sold (1A5d / 2A3e).
    // The black face is the SECONDARY face for most cards, but the PRIMARY face
    // for GW thrusters / Freighters (whose secondary is the purple promoted side).
    if (slot.kind === 'crew') return fail('not_black_side');
    // Slave Market (2C2a): a ROBOT colonist is hardware - its unpromoted side
    // IS its black side, and even its Purple-Side is treated as Black-Side for
    // the sale. A HUMAN colonist can never be sold.
    if (card.type === 'colonist') {
      if (card.colonistKind !== 'Robot') return fail('humans_not_for_sale');
    } else {
      if (slot.promoted) return fail('purple_no_sell');
      if (slot.face !== blackSideFace(card)) return fail('not_black_side');
    }
    const spectral = card.spectralType || 'C';
    let globalCount = 0;
    for (const f of Object.values(state.factories || {})) {
      if ((f.spectralType || 'C') === spectral) globalCount += 1;
    }
    // Kaluga Naniteers (colonist power): Free Market aqua is doubled.
    const kaluga = playerHasColonistPower(state, player, 'freeMarketDoubled');
    const value = freeMarketBlackSideValue(globalCount) * (kaluga ? 2 : 1);
    player.leo.splice(i, 1);
    player.hand = Array.isArray(player.hand) ? player.hand : [];
    player.hand.push(id);              // the card returns to hand (White-Side)
    player.aqua += value;
    if (!marketUnlimited) player.opsRemaining -= 1;
    return {
      ok: true, state,
      log: `${player.name} sold ${card.name} (Black-Side ${spectral}) on the Free Market for +${value} aqua${kaluga ? ' (Kaluga x2)' : ''}; the card returns to hand.`,
    };
  }
  // Base: sell ONE hand card for FREE_MARKET_AQUA. Freedom (Free Trade Act): a
  // player who can use the law may sell TWO cards for FREE_TRADE_AQUA total.
  const ids = (Array.isArray(op.cardIds) && op.cardIds.length)
    ? op.cardIds.map(String)
    : (op.cardId ? [String(op.cardId)] : []);
  if (!ids.length) return fail('no_card');
  if (!marketUnlimited) {
    if (ids.length > 2) return fail('too_many_cards');
    if (ids.length === 2 && !playerCanUseLaw(state, player, 'freedom')) return fail('needs_freedom_law');
  }
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
    // Slave Market (2C2a): a hand ROBOT sells like any patent; a Human
    // colonist can never be sold.
    if (card.type === 'colonist' && card.colonistKind !== 'Robot') return fail('humans_not_for_sale');
    cards.push(card);
  }
  for (const id of ids) {
    player.hand.splice(player.hand.indexOf(id), 1);
    const card = PATENTS_BY_ID[id];
    const deck = decksFor(state, player)[card.type];
    if (Array.isArray(deck)) deck.push(id);   // back to the BOTTOM of its deck
  }
  // Kaluga Naniteers (colonist power): Free Market aqua is doubled.
  const kaluga2 = playerHasColonistPower(state, player, 'freeMarketDoubled');
  // Two-card pricing differs by law set: the base Free Trade Act discounts the
  // pair to 5, while the solitaire Free Trade Act II simply lifts the one-card
  // limit - both cards sell at the full 3 each (6 total). A marketUnlimited
  // sale of 3+ cards (only reachable via that Future) has no discount pairing -
  // every card sells at the flat per-card rate.
  const pairGain = state.ceoSolo ? FREE_MARKET_AQUA * 2 : FREE_TRADE_AQUA;
  const gain = ((ids.length === 2) ? pairGain : FREE_MARKET_AQUA * ids.length) * (kaluga2 ? 2 : 1);
  player.aqua += gain;
  if (!marketUnlimited) player.opsRemaining -= 1;
  const names = cards.map((c) => c.name).join(' + ');
  const tag = (ids.length === 2) ? (state.ceoSolo ? ', Free Trade Act II' : ', Free Trade Act')
    : (marketUnlimited && ids.length > 1) ? ' (Artificial Consciousness: unlimited)' : '';
  return {
    ok: true, state,
    log: `${player.name} sold ${names} for +${gain} aqua (Free Market${tag}${kaluga2 ? ', Kaluga x2' : ''}).`,
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
  // A hand ROBOT colonist recirculates to the bottom of the colonist QUEUE
  // (colonists have no market deck); patents go to the bottom of their
  // type's deck; crew (no deck) just leave the hand.
  if (card && card.type === 'colonist') {
    colonistQueueFor(state, player).push(cardId);
    return {
      ok: true, state,
      log: `${player.name} discarded ${card.name} to the bottom of the colonist queue.`,
    };
  }
  if (card) {
    const deck = decksFor(state, player)[card.type];
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
  // A Bernal at LEO (op.unit = 'bernalN') takes aqua into its tank, like the
  // rocket. A Bernal crawls on dirt but burns water too, so water is welcome.
  if (op && typeof op.unit === 'string' && op.unit.startsWith('bernal')) {
    const bn = bernalForUnit(player, op.unit);
    if (!bn) return fail('no_bernal');
    if (bn.siteId != null) return fail('bernal_not_at_leo');   // the aqua bank is at LEO only
    const bwant = Math.floor(Number(op.amount));
    if (!Number.isFinite(bwant) || bwant <= 0) return fail('bad_amount');
    const btank = Number(bn.tank) || 0;
    if (btank > 0 && bernalTankGrade(bn) === 'dirt') return fail('cannot_mix_fuel');
    const bdry = bernalDryMass(bn);
    // Fuel loads walk UP the red line one step per aqua; the mass gained is the
    // ladder's (non-linear) amount, so the wet chit lands on a node.
    const broom = redStepsBetween(bdry + btank);
    const bsteps = Math.min(bwant, player.aqua | 0, broom);
    if (bsteps <= 0) { if (broom <= 0) return fail('tank_full'); return fail('insufficient_aqua'); }
    const bres = loadFuelUpLadder(bdry, btank, bsteps);
    player.aqua -= bres.steps;
    bn.tank = bres.tank;
    bn.tankGrade = 'water';
    return { ok: true, state, log: `${player.name} converted ${bres.steps} aqua to water in the Bernal (tank ${round6(bn.tank)}).` };
  }
  if (!rocketAtRefuelDepot(state, player)) return fail('rocket_not_at_leo');
  const want = Math.floor(Number(op.amount));
  if (!Number.isFinite(want) || want <= 0) return fail('bad_amount');
  const tank = Number(player.rocket.tank) || 0;
  // Water and dirt can't mix: refuse to pour water onto a dirt tank. Empty
  // the dirt first (burn it off) before taking on water.
  if (tank > 0 && tankGradeOf(player.rocket) === 'dirt') return fail('cannot_mix_fuel');
  const dry = rocketDryMass(player.rocket.stack.reduce((m, s) => m + slotMass(s), 0));
  // Fuel loads walk UP the red (refuel) line one step per aqua, the mirror of a
  // burn walking DOWN the black line. Each step lands the wet chit on a node and
  // gains the ladder's (non-linear) mass, so the tank always matches the strip.
  // Any sub-step remainder left by a prior burn stays put.
  const room = redStepsBetween(dry + tank);
  const steps = Math.min(want, player.aqua | 0, room);
  if (steps <= 0) {
    if (room <= 0) return fail('tank_full');
    return fail('insufficient_aqua');
  }
  const res = loadFuelUpLadder(dry, tank, steps);
  player.aqua -= res.steps;
  player.rocket.tank = res.tank;
  player.rocket.tankGrade = 'water';
  return { ok: true, state, log: `${player.name} converted ${res.steps} aqua to water (tank ${round6(player.rocket.tank)}).` };
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
  // A Bernal keeps its OWN secret route (bn.route), like the rocket + freighter.
  if (typeof unit === 'string' && unit.startsWith('bernal')) {
    return (player.bernals || [])[Number(unit.slice('bernal'.length)) || 0] || null;
  }
  return player.rocket;
}
function applySetRoute(state, op, player) {
  const segs = Array.isArray(op.segments) ? op.segments : [];
  const norm = [];
  for (const s of segs) {
    if (!s || typeof s !== 'object') return fail('bad_route');
    const from = String(s.from || '');
    const to = String(s.to || '');
    const burns = Math.max(0, Number(s.burns) || 0);
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

// Player card groups: a purely COSMETIC organizer for the rocket-stack view.
// Ordered list of { id, name, cardIds } labels the player created to sort their
// stack. It affects NOTHING in the rules (card order, wiring, activation, fuel
// are all untouched), so like SET_ROUTE it can be set off-turn and, being noise
// if it logged on every drag, it is one of the few SILENT ops (log ''). The
// server sanitises: labels capped, names trimmed + length-capped, cardIds must
// be real cards aboard, and a card lands in at most ONE group (first wins).
// op = { groups: [{ id, name, cardIds:[] }] }.
const MAX_CARD_GROUPS = 16;
const MAX_GROUP_NAME = 32;
function applySetCardGroups(state, op, player) {
  const raw = Array.isArray(op && op.groups) ? op.groups : [];
  const stackIds = new Set((player.rocket.stack || []).map((s) => s.id));
  const assigned = new Set();   // a card belongs to at most one group
  const out = [];
  for (const g of raw) {
    if (out.length >= MAX_CARD_GROUPS) break;
    if (!g || typeof g !== 'object') continue;
    const id = String(g.id || '').slice(0, 40);
    if (!id) continue;
    const name = String(g.name == null ? '' : g.name).trim().slice(0, MAX_GROUP_NAME);
    const cardIds = [];
    for (const cid of (Array.isArray(g.cardIds) ? g.cardIds : [])) {
      const c = String(cid || '');
      if (c && stackIds.has(c) && !assigned.has(c)) { assigned.add(c); cardIds.push(c); }
    }
    out.push({ id, name, cardIds });
  }
  player.rocket.groups = out;
  return { ok: true, state, log: '' };
}

// Reverse of REFUEL: cash tank water back into the aqua bank 1:1, only
// at LEO. Clamped by the water on hand. Free, turn-gated. op={amount}.
function applyCashWater(state, op, player) {
  // A Bernal at LEO (op.unit = 'bernalN') cashes its WATER back to aqua, like
  // the rocket. Dirt has no aqua value, so a dirt tank can't cash out.
  if (op && typeof op.unit === 'string' && op.unit.startsWith('bernal')) {
    const bn = bernalForUnit(player, op.unit);
    if (!bn) return fail('no_bernal');
    if (bn.siteId != null) return fail('bernal_not_at_leo');
    if (bernalTankGrade(bn) === 'dirt' && (Number(bn.tank) || 0) > 0) return fail('not_water_fuel');
    const bwant = Math.floor(Number(op.amount));
    if (!Number.isFinite(bwant) || bwant <= 0) return fail('bad_amount');
    const bamt = Math.min(bwant, Math.floor(Number(bn.tank) || 0));
    if (bamt <= 0) return fail('no_water');
    bn.tank = round6((Number(bn.tank) || 0) - bamt);
    player.aqua = (player.aqua | 0) + bamt;
    return { ok: true, state, log: `${player.name} cashed ${bamt} water from the Bernal to aqua (aqua ${player.aqua}).` };
  }
  if (!rocketAtRefuelDepot(state, player)) return fail('rocket_not_at_leo');
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
  // Cashing the rocket's last water from an empty stack decommissions it.
  recallIfEmpty(player);
  return { ok: true, state, log: `${player.name} cashed ${amt} water back to aqua (aqua ${player.aqua}).` };
}

// Jettison fuel from the tank (Internal Tankage free action - destroyed for
// now; Stage 3+ drops it as an outpost stack). Grade-agnostic: dumps water
// OR dirt, no aqua credit. No op cost; turn-gated like the other tank ops.
// op = { amount? }: a specific amount jettisons that much (clamped to the
// tank); omitted / >= tank clears the whole tank, sub-1 remainder included.
function applyDump(state, op, player) {
  // A Bernal unit (op.unit = 'bernal0' | 'bernal1') jettisons its OWN tank; the
  // default target is the rocket. Same grade-agnostic jettison for both (no aqua
  // credit, sub-1 remainder included).
  const wantsBernal = op && typeof op.unit === 'string' && op.unit.startsWith('bernal');
  const bn = wantsBernal ? bernalForUnit(player, op.unit) : null;
  if (wantsBernal && !bn) return fail('no_bernal');
  const holder = bn || player.rocket;
  const tank = Number(holder.tank) || 0;
  if (tank <= 0) return fail('no_fuel');
  const want = Number(op && op.amount);
  const amt = (!Number.isFinite(want) || want <= 0 || want >= tank) ? tank : want;
  holder.tank = round6(tank - amt);
  const grade = bn ? bernalTankGrade(bn) : tankGradeOf(player.rocket);
  const word = grade === 'dirt' ? 'dirt' : (grade === 'isotope' ? 'isotope' : 'water');
  const where = bn ? ' from the Bernal' : '';
  // Dumping the rocket's last fuel from an empty stack decommissions it (scraps
  // back to LEO), so it can then be re-formed at a new site.
  if (!bn) recallIfEmpty(player);
  return { ok: true, state, log: `${player.name} dumped ${round6(amt)} ${word}${where} (tank ${round6(holder.tank)}).` };
}

// ----- Fuel cargo cards (house rule) -----
// A fuel card packages tank fuel (water OR isofuel, never dirt) into a movable
// card so it can be carried between stacks like any card, then poured back into
// a tank or dumped. Its mass equals the fuel it holds, so hauling it costs burns
// (fuel-as-cargo must be physically carried, which keeps the location-lock
// honest). CAN / LOAD act on the ROCKET tank (which fully supports the water +
// isotope grades); the card then transfers between colocated stacks (the normal
// TRANSFER op) and dumps from any stack.
function isFuelCardSlot(slot) { return !!(slot && slot.kind === 'fuel'); }
function nextFuelCardId(state) {
  state.fuelCardSeq = (state.fuelCardSeq | 0) + 1;
  return `fuel_${state.fuelCardSeq}`;
}

// CAN_FUEL: convert `amount` whole units of the rocket tank into a new fuel
// cargo card in the rocket stack. Only water or isofuel can be canned (dirt is
// field propellant with no cargo value). Mass-neutral (tank down, card mass up).
function applyCanFuel(state, op, player) {
  const grade = tankGradeOf(player.rocket);
  const tank = Number(player.rocket.tank) || 0;
  if (tank < 1) return fail('no_fuel');
  if (grade === 'dirt') return fail('cannot_can_dirt');
  const g = grade === 'isotope' ? 'isotope' : 'water';
  const want = Math.floor(Number(op.amount));
  const amt = (!Number.isFinite(want) || want <= 0) ? Math.floor(tank) : Math.min(want, Math.floor(tank));
  if (amt < 1) return fail('no_fuel');
  player.rocket.tank = round6(tank - amt);
  // Isotope carries its spectral type onto the card (a spectral-S tank cans a
  // spectral-S card); water has none.
  const spectral = g === 'isotope' ? (player.rocket.tankSpectral || 'C') : null;
  const slot = { id: nextFuelCardId(state), kind: 'fuel', grade: g, amount: amt, face: 'primary' };
  if (spectral) slot.spectral = spectral;
  player.rocket.stack.push(slot);
  const word = g === 'isotope' ? `spectral-${spectral} isotope` : 'water';
  return { ok: true, state, log: `${player.name} canned ${amt} ${word} into a fuel cargo card.` };
}

// LOAD_FREIGHTER_WATER: pump water out of an OUTPOST's own tank (op.letter)
// into a water fuel cargo card aboard the colocated Freighter, so it can be
// hauled home. This is a local stack-to-stack water move (the SAME rule as
// TRANSFER_FUEL), NOT an aqua-bank draw - the Aqua Bank only reaches LEO /
// a Home Bernal, never a remote outpost. Whole units only; merges into an
// existing water card on the Freighter so it stays one card, not a pile.
// Subject to the Freighter's mass load limit like any cargo (rule 1B), and a
// Factory-Loading-Only freighter still needs a Factory at its site.
function applyLoadFreighterWater(state, op, player) {
  const fr = player.freighter;
  if (!fr) return fail('no_freighter');
  const letter = String(op.letter || '');
  const outpost = player.outposts && player.outposts[letter];
  if (!outpost) return fail('no_outpost');
  // Colocated = same site, or the two ends of a built Space Elevator (M1).
  if (fr.siteId !== outpost.siteId && !elevatorColocated(state, fr.siteId, outpost.siteId)) {
    return fail('not_colocated');
  }
  if (freighterFactoryOnly(player)) {
    const frSite = fr.siteId;
    if (!(frSite && state.factories && state.factories[frSite])) return fail('factory_only');
  }
  const want = Math.floor(Number(op.amount));
  if (!Number.isFinite(want) || want <= 0) return fail('bad_amount');
  const stack = fr.stack = fr.stack || [];
  const aboardMass = stack.reduce((m, s) => m + slotMass(s), 0);
  const room = Math.max(0, freighterLoadLimit(player) - aboardMass);
  // Whole water units only; any sub-1 remainder stays in the outpost.
  const available = Math.floor(Number(outpost.tank) || 0);
  const amt = Math.min(want, available, room);
  if (amt <= 0) {
    if (room <= 0) return fail('load_limit', { limit: freighterLoadLimit(player), aboardMass });
    return fail('no_water');
  }
  outpost.tank = round6((Number(outpost.tank) || 0) - amt);
  // Merge into an existing water fuel card so the Freighter carries ONE water
  // card, not one per pump; otherwise start a fresh card.
  const existing = stack.find((s) => isFuelCardSlot(s) && s.grade === 'water');
  if (existing) existing.amount = (existing.amount | 0) + amt;
  else stack.push({ id: nextFuelCardId(state), kind: 'fuel', grade: 'water', amount: amt, face: 'primary' });
  return { ok: true, state, log: `${player.name} pumped ${amt} Water FT from Outpost ${letter} onto the Freighter.` };
}

// TRANSFER_FUEL_CARD: move `amount` fuel out of a fuel cargo card (op.cardId in
// stack op.from) into a fuel card on the colocated stack op.to - SPLITTING the
// source card so a partial amount can move. This is what lets a big fuel card
// load onto a mass-limited Freighter: send only as much as fits, the rest
// stays behind. Whole units only; merges into a matching same-grade fuel card
// at the destination, else starts a new one. Honors the Freighter's mass load
// limit + Factory-Loading-Only, same as any cargo (rule 1B).
function applyTransferFuelCard(state, op, player) {
  const from = String(op.from || '');
  const to = String(op.to || '');
  if (!from || !to || from === to) return fail('bad_transfer');
  const srcArr = stackArrayOf(player, from);
  const dstArr = stackArrayOf(player, to);
  if (!srcArr || !dstArr) return fail('bad_transfer');
  const idx = srcArr.findIndex((s) => isFuelCardSlot(s) && s.id === String(op.cardId));
  if (idx < 0) return fail('no_fuel_card');
  const card = srcArr[idx];
  const srcSite = stackEndpointSite(player, from);
  const dstSite = stackEndpointSite(player, to);
  if (srcSite === undefined || dstSite === undefined) return fail('bad_transfer');
  if (srcSite !== dstSite && !elevatorColocated(state, srcSite, dstSite)) return fail('not_colocated');
  const grade = card.grade === 'isotope' ? 'isotope' : 'water';
  const spectral = grade === 'isotope' ? (card.spectral || 'C') : null;
  const want = Math.floor(Number(op.amount));
  if (!Number.isFinite(want) || want <= 0) return fail('bad_amount');
  const have = Math.max(0, Math.floor(Number(card.amount) || 0));
  let amt = Math.min(want, have);
  if (to === 'freighter') {
    if (!player.freighter) return fail('no_freighter');
    if (freighterFactoryOnly(player)) {
      const frSite = player.freighter.siteId;
      if (!(frSite && state.factories && state.factories[frSite])) return fail('factory_only');
    }
    const aboard = dstArr.reduce((m, s) => m + slotMass(s), 0);
    const room = Math.max(0, freighterLoadLimit(player) - aboard);
    amt = Math.min(amt, room);
    if (amt <= 0) return fail('load_limit', { limit: freighterLoadLimit(player), aboardMass: aboard });
  }
  if (amt <= 0) return fail('bad_amount');
  // Split the source card; remove it when drained.
  card.amount = have - amt;
  if (card.amount <= 0) srcArr.splice(idx, 1);
  // Merge into a matching fuel card at the destination (same grade, and for
  // isotope the same spectral), else start a fresh card.
  const existing = dstArr.find((s) => isFuelCardSlot(s) && s.grade === grade
    && (grade !== 'isotope' || (s.spectral || 'C') === spectral));
  if (existing) existing.amount = (existing.amount | 0) + amt;
  else {
    const slot = { id: nextFuelCardId(state), kind: 'fuel', grade, amount: amt, face: 'primary' };
    if (spectral) slot.spectral = spectral;
    dstArr.push(slot);
  }
  if (from === 'rocket') recallIfEmpty(player);
  const word = grade === 'isotope' ? `spectral-${spectral} isotope` : 'water';
  const toLabel = to === 'freighter' ? 'the Freighter'
    : to === 'rocket' ? 'the rocket'
    : to === 'leo' ? 'the LEO Stack'
    : to.startsWith('outpost') ? `Outpost ${to.slice('outpost'.length)}`
    : to.startsWith('bernal') ? 'the Bernal' : to;
  return { ok: true, state, log: `${player.name} transferred ${amt} ${word} fuel to ${toLabel}.` };
}

// LOAD_FUEL: pour a fuel cargo card back into the tank of the unit HOLDING it.
// op.holder is 'rocket' (the default, and the only value older clients send) /
// 'bernalN' / 'outpostX'. Grades never mix (a water card only onto an empty or
// water tank, an isotope card only onto an empty or isotope tank). Mass-neutral,
// so it never overfills: a fuel card's mass IS its amount (slotMass), so the
// mass leaving the stack equals the water entering the tank.
//
// This used to be hardcoded to the rocket on both sides - the stack array, the
// tank, and the grade - so a fuel card sitting in a BERNAL could be carried
// there and then never unloaded. Every unit with a tank is a valid holder now;
// fuelEndpoint already knew how to reach each one (it is what TRANSFER_FUEL
// uses), this op just was not asking it.
function applyLoadFuel(state, op, player) {
  const holderId = typeof op.holder === 'string' && op.holder ? op.holder : 'rocket';
  const arr = stackArrayOf(player, holderId);
  const dst = fuelEndpoint(state, player, holderId);
  // A freighter carries fuel cards but has no tank of its own, so it resolves as
  // a stack yet not as a fuel endpoint. Report that as a bad holder rather than
  // crashing on a null endpoint.
  if (!arr || !dst) return fail('bad_holder');
  const idx = arr.findIndex((s) => isFuelCardSlot(s) && s.id === String(op.cardId));
  if (idx < 0) return fail('no_fuel_card');
  const card = arr[idx];
  const g = card.grade === 'isotope' ? 'isotope' : 'water';
  // An outpost is a WATER store (fuelEndpoint reports grade 'water' for one
  // unconditionally), so isotope has nowhere to go there. Caught explicitly:
  // the mixing check below would let it through into an EMPTY outpost and then
  // silently read back as water.
  if (dst.kind === 'outpost' && g !== 'water') return fail('cannot_store_isotope');
  const tank = dst.getTank();
  if (tank > 0 && dst.grade() !== g) return fail('cannot_mix_fuel');
  // A player's own isotope always matches their own GW/TW thruster (the game
  // tracks no per-card spectral for your own fuel), so loading it into the tank
  // never mismatches. Spectral only matters at PRODUCTION (which spectral you can
  // refine) and cross-player trade, not when pouring your own card into your tank.
  const cardSpectral = g === 'isotope' ? (card.spectral || 'C') : null;
  const amt = Math.max(0, Math.floor(Number(card.amount) || 0));
  arr.splice(idx, 1);
  dst.setTank(tank + amt);
  dst.setGrade(g);
  // tankSpectral is a rocket-only field (only the rocket burns isotope), so it
  // is still keyed off the rocket rather than the endpoint.
  if (holderId === 'rocket') {
    if (g === 'isotope') player.rocket.tankSpectral = cardSpectral;
    else delete player.rocket.tankSpectral;
  }
  const word = g === 'isotope' ? `spectral-${cardSpectral} isotope` : 'water';
  return { ok: true, state, log: `${player.name} loaded ${amt} ${word} from a fuel cargo card into ${dst.label} tank.` };
}

// DUMP_FUEL_CARD: jettison a fuel cargo card from whatever stack it sits in
// (rocket / bernalN / outpostX / leo). The fuel is destroyed, no aqua credit.
function applyDumpFuelCard(state, op, player) {
  const holderId = typeof op.holder === 'string' ? op.holder : 'rocket';
  const arr = stackArrayOf(player, holderId);
  if (!arr) return fail('bad_holder');
  const idx = arr.findIndex((s) => isFuelCardSlot(s) && s.id === String(op.cardId));
  if (idx < 0) return fail('no_fuel_card');
  const card = arr[idx];
  const word = card.grade === 'isotope' ? 'isotope' : 'water';
  const amt = Math.max(0, Math.floor(Number(card.amount) || 0));
  arr.splice(idx, 1);
  if (holderId === 'rocket') recallIfEmpty(player);
  return { ok: true, state, log: `${player.name} jettisoned a fuel cargo card (${amt} ${word}).` };
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
  if (id && id.startsWith('bernal')) {
    const bn = (player.bernals || [])[Number(id.slice('bernal'.length)) || 0];
    return bn ? (bn.stack = bn.stack || []) : null;
  }
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
// The GEO Space Elevator is BUILT for free by the anchored GEO Elevator Bernal:
// when a player has 'ber_geo_elevator_bernal' anchored at GEO (burn-geo), the
// Earth<->GEO cable exists with NO Epic-Hazard BUILD_ELEVATOR. Returns that
// player's profileId (the elevator's owner) or null. M2-gated (Bernals +
// anchoring are M2). The GEO pair is never written into state.elevators - it is
// derived live from the anchor, so unanchoring takes the elevator down too.
const GEO_ELEVATOR_BERNAL_ID = 'ber_geo_elevator_bernal';
const GEO_ELEVATOR_PAIR_KEY = elevatorPairKey('burn-geo', 'lag-pr6v8');
function geoElevatorOwnerId(state) {
  if (!state || !state.m2) return null;
  for (const p of (state.players || [])) {
    for (const bn of (p.bernals || [])) {
      if (bn && bn.cardId === GEO_ELEVATOR_BERNAL_ID && bn.anchored && bn.siteId === GEO_NODE) {
        return p.profileId;
      }
    }
  }
  return null;
}
function elevatorColocated(state, a, b) {
  if (state.m1 && a && b && a !== b && state.elevators && state.elevators[elevatorPairKey(a, b)]) return true;
  // The GEO elevator is built implicitly by the anchored GEO Bernal, so its
  // ends (burn-geo <-> the Earth/LEO node) colocate like any joined elevator.
  if (a && b && a !== b && elevatorPairKey(a, b) === GEO_ELEVATOR_PAIR_KEY
      && geoElevatorOwnerId(state) != null) return true;
  return false;
}
// Factory site-slugs connected by a Space Elevator. Rulebook M2b endgame: such a
// Factory's stock price DOUBLES, regardless of who built the elevator. Both ends
// of every BUILT elevator (state.elevators, M1) count, plus the GEO elevator
// derived live from an anchored GEO Bernal (M2). Only slugs that actually carry a
// factory are included, so a bare elevator endpoint adds nothing.
function elevatorConnectedFactorySet(state) {
  const set = new Set();
  const mark = (slug) => {
    if (slug != null && state.factories && state.factories[slug]) set.add(String(slug));
  };
  if (state.m1 && state.elevators) {
    for (const key of Object.keys(state.elevators)) {
      const pair = elevatorPairByKey(key);
      if (pair) { mark(pair.a); mark(pair.b); }
    }
  }
  if (geoElevatorOwnerId(state) != null) {
    const pair = elevatorPairByKey(GEO_ELEVATOR_PAIR_KEY);
    if (pair) { mark(pair.a); mark(pair.b); }
  }
  return set;
}
// A space-elevator PAIR (data/space-elevators.js) links two Spaces; when the
// player owns a Factory at EITHER end, they may spin an Outpost off across the
// cable - a Lagrange end plus a Factory at the site end is enough, even without
// a separately built (Epic Hazard) elevator. (User: allow outpost creation if a
// space elevator is between a Lagrange and a factory on either side.) M1-gated.
function elevatorFactoryColocated(state, player, a, b) {
  if (!state.m1 || !a || !b || a === b) return false;
  const pair = elevatorPairByKey(elevatorPairKey(a, b));
  if (!pair) return false;
  const mine = (slug) => {
    const f = state.factories && state.factories[slug];
    return !!(f && f.ownerId === player.profileId);
  };
  return mine(pair.a) || mine(pair.b);
}
function applyTransfer(state, op, player) {
  let to = op.to;
  let from = op.from;
  // "New outpost" target (cargo spin-off): create a fresh Outpost at the SOURCE
  // stack's location - out in space - then drop the selected cards into it. The
  // source (e.g. the rocket) stays put; only the picked cards move. Auto-picks a
  // free slot, then falls through to the normal colocated transfer below. LEO has
  // the LEO Stack instead, so a null (LEO) source is rejected. Replay-safe: the
  // op payload stays `to: 'newOutpost'` and an undo/redo recreates the same slot
  // because rebuildFromBase replays from the same base (slots picked in order).
  let createdOutpost = null;
  if (to === 'newOutpost') {
    const srcSite = stackEndpointSite(player, from);
    if (srcSite === undefined) return fail('bad_transfer');
    if (srcSite == null) return fail('outpost_needs_site');
    // Optional target: either end of a Space Elevator that touches the source's
    // site. Both ends are colocated, so an outpost at the FAR end is a valid drop
    // point (this is how a player seeds a stack across the cable). Accept a built
    // elevator OR an elevator pair with the player's Factory at an end (a Lagrange
    // end + a factory at the site end). Defaults to the source's own site.
    let site = srcSite;
    if (op.newOutpostSite != null) {
      const want = String(op.newOutpostSite);
      if (want !== srcSite
          && !elevatorColocated(state, srcSite, want)
          && !elevatorFactoryColocated(state, player, srcSite, want)) return fail('outpost_not_colocated');
      site = want;
    }
    const taken = new Set(Object.keys(player.outposts || {}));
    const letter = OUTPOST_LETTERS.find((l) => !taken.has(l));
    if (!letter) return fail('no_outpost_slot');
    player.outposts = player.outposts || {};
    player.outposts[letter] = { letter, siteId: site, cards: [], tank: 0 };
    to = `outpost${letter}`;
    createdOutpost = { letter, site };
  }
  // "New Bernal" target (cargo spin-off): a Bernal card riding in a colocated
  // cargo stack (an outpost, the rocket, the freighter) out in space is popped
  // out into its OWN colony stack at that spot - the Bernal card becomes the
  // colony's identity and the rest of the selection loads into it. The LEO path
  // to a fresh colony is a hand Boost; this is the in-space analog, the mirror of
  // "New outpost". Free action (a Cargo Transfer), like New outpost.
  let createdBernal = null;
  if (to === 'newBernal') {
    if (!state.m2) return fail('m2_off');
    const site = stackEndpointSite(player, from);
    if (site === undefined) return fail('bad_transfer');
    if ((player.bernals || []).length >= 2) return fail('bernal_limit');
    const ids0 = Array.isArray(op.cardIds) ? op.cardIds.map(String)
      : (op.cardId != null ? [String(op.cardId)] : []);
    const bernalCardIds = ids0.filter((id) => { const c = PATENTS_BY_ID[id]; return !!(c && c.type === 'bernal'); });
    if (!bernalCardIds.length) return fail('need_bernal_card');
    if (bernalCardIds.length > 1) return fail('one_bernal_per_colony');
    const bernalCardId = bernalCardIds[0];
    const srcArr0 = stackArrayOf(player, from);
    if (!srcArr0) return fail('bad_transfer');
    const bIdx = srcArr0.findIndex((s) => s.id === bernalCardId);
    if (bIdx < 0) return fail('not_in_source');
    // The Bernal card BECOMES the colony (like a boosted Bernal card), so pull it
    // out of the source; it is NOT one of the cards loaded into the stack.
    srcArr0.splice(bIdx, 1);
    const figure = pickBernalFigure(player, op.figure);
    player.bernals = player.bernals || [];
    const newIdx = player.bernals.length;
    player.bernals.push({
      cardId: bernalCardId, figure, face: 'primary', promoted: false,
      siteId: site, stack: [], tank: 0, wiring: {}, route: [],
      movesRemaining: MOVES_PER_TURN,
    });
    to = `bernal${newIdx}`;
    createdBernal = { idx: newIdx, site, cardId: bernalCardId };
    const rest = ids0.filter((id) => id !== bernalCardId);
    const bname = (PATENTS_BY_ID[bernalCardId] || {}).name || 'Bernal';
    const whereName = site == null ? 'LEO' : ((siteById(site) || {}).name || site);
    if (!rest.length) {
      // Only the Bernal card was deployed - nothing else to load into it.
      return { ok: true, state, log: `${player.name} deployed the ${bname} colony at ${whereName}.` };
    }
    op = { ...op, cardIds: rest, cardId: undefined };
  }
  // Legacy shorthand: only `to` (rocket|leo) given -> the other is `from`.
  if (!from && (to === 'rocket' || to === 'leo')) from = (to === 'rocket' ? 'leo' : 'rocket');
  if (!from || !to || from === to) return fail('bad_transfer');
  const validEndpoint = (ep) => ep === 'leo' || ep === 'rocket' || ep === 'freighter'
    || (typeof ep === 'string' && ep.startsWith('bernal') && ['0', '1'].includes(ep.slice('bernal'.length)))
    || (typeof ep === 'string' && ep.startsWith('outpost') && ['A', 'B', 'C', 'D'].includes(ep.slice('outpost'.length)));
  if (!validEndpoint(from) || !validEndpoint(to)) return fail('bad_transfer');
  // A freighter endpoint needs the unit in play.
  if ((from === 'freighter' || to === 'freighter') && !player.freighter) return fail('no_freighter');
  // A Bernal endpoint needs that colony in play.
  for (const ep of [from, to]) {
    if (typeof ep === 'string' && ep.startsWith('bernal')
        && !(player.bernals || [])[Number(ep.slice('bernal'.length)) || 0]) return fail('no_bernal');
  }

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
    if (ep.startsWith('bernal')) {
      const bn = (player.bernals || [])[Number(ep.slice('bernal'.length)) || 0];
      return bn && bn.siteId != null ? bn.siteId : null;
    }
    return outpostOf(ep).siteId;
  };
  const rocketEmpty = player.rocket.stack.length === 0;
  const involvesRocket = from === 'rocket' || to === 'rocket';
  if (involvesRocket && rocketEmpty) {
    const other = from === 'rocket' ? to : from;
    const otherSite = siteOf(other);
    if ((Number(player.rocket.tank) || 0) >= 1) {
      // The empty rocket still holds fuel, so it is LOCATION-LOCKED at its
      // current site (null = LEO). Cards may only join from a colocated stack;
      // forming the rocket at a new site would teleport the fuel. Dump or
      // transfer the fuel out first, then the rocket can re-form anywhere.
      const rSite = player.rocket.siteId == null ? null : player.rocket.siteId;
      if (rSite !== otherSite && !elevatorColocated(state, rSite, otherSite)) {
        return fail('rocket_fuel_locked');
      }
      // colocated: the rocket re-forms in place, siteId unchanged (no teleport).
    } else {
      // Decommissioned (no fuel): the rocket forms fresh at the other endpoint.
      player.rocket.siteId = otherSite;
    }
    // A rocket FORMING this turn (an empty stack that gains cards, e.g. re-formed
    // from an outpost out in a far zone) anchors its solar-sail zone lock to WHERE
    // IT FORMS, not the stale turn-start stamp from when it was an empty stack at
    // LEO. Without this a solar thruster built out in the Uranus zone reads the
    // Earth zone (full sunlight) until the next turn re-stamps it - the reported
    // "solar not affecting the rocket on creation" bug.
    if (to === 'rocket') player.rocket.turnStartSiteId = player.rocket.siteId != null ? player.rocket.siteId : null;
  } else if (siteOf(from) !== siteOf(to)
      && !elevatorColocated(state, siteOf(from), siteOf(to))
      && !elevatorFactoryColocated(state, player, siteOf(from), siteOf(to))) {
    return fail('not_colocated');
  }

  const srcArr = stackArrayOf(player, from);
  const dstArr = stackArrayOf(player, to);
  if (!srcArr || !dstArr) return fail('bad_transfer');
  for (const id of ids) {
    if (!srcArr.some((s) => s.id === id)) return fail('not_in_source');
  }
  // Freighter cargo is limited by MASS, not card count (rule 1B): the load
  // limit is a wet-mass capacity, so sum the mass already aboard plus the
  // incoming cards' mass. A card can't be in both the source and the freighter,
  // so every incoming id adds its mass.
  if (to === 'freighter') {
    const incomingMass = ids.reduce((m, id) => {
      const slot = srcArr.find((s) => s.id === id);
      return m + (slot ? slotMass(slot) : 0);
    }, 0);
    const aboardMass = dstArr.reduce((m, s) => m + slotMass(s), 0);
    const limit = freighterLoadLimit(player);
    if (aboardMass + incomingMass > limit) return fail('load_limit', { limit, aboardMass, incomingMass });
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
  if (createdOutpost) {
    const whereName = (siteById(createdOutpost.site) || {}).name || createdOutpost.site;
    return { ok: true, state, log: `${player.name} spun off a new Outpost ${createdOutpost.letter} at ${whereName} (${label}).` };
  }
  if (createdBernal) {
    const bname = (PATENTS_BY_ID[createdBernal.cardId] || {}).name || 'Bernal';
    const whereName = createdBernal.site == null ? 'LEO' : ((siteById(createdBernal.site) || {}).name || createdBernal.site);
    return { ok: true, state, log: `${player.name} deployed the ${bname} colony at ${whereName} and loaded ${label}.` };
  }
  const dstName = to === 'rocket' ? 'the rocket'
    : to === 'leo' ? 'the LEO Stack'
    : to === 'freighter' ? 'the Freighter'
    : to.startsWith('bernal') ? 'the Bernal'
    : `Outpost ${to.slice('outpost'.length)}`;
  return { ok: true, state, log: `${player.name} moved ${label} to ${dstName}.` };
}

// The Martian (H9b): a FREE action, once per turn. With an Operational card
// carrying a buggy platform at a Site, drive ONE Crew or Colonist along a buggy
// road (yellow dashed line) to a road-connected Site, forming an Outpost there.
// The buggy itself does NOT move; a Crew / Colonist that carries its own buggy
// platform may transport itself (no separate buggy needed). Connectivity uses
// the explicit road network (isBuggyRoadPair), so it never leaks to an off-road
// same-body site like an atmospheric aerostat.
function applyMartian(state, op, player) {
  // Once per turn (free action): a prior Martian this turn blocks another.
  if ((state.turnActions || []).some((a) => a && a.kind === 'THE_MARTIAN')) {
    return fail('martian_used');
  }
  const from = op.from;
  const humanId = op.humanCardId != null ? String(op.humanCardId) : null;
  const toSiteId = op.toSiteId;
  if (!from || !humanId || !toSiteId) return fail('bad_martian');
  const srcArr = stackArrayOf(player, from);
  if (!srcArr) return fail('bad_martian');
  const fromSiteId = stackEndpointSite(player, from);
  if (fromSiteId === undefined) return fail('bad_martian');
  if (fromSiteId == null) return fail('martian_needs_site');   // not from LEO
  // Destination must be joined to the source by a buggy road.
  if (!isBuggyRoadPair(fromSiteId, toSiteId)) return fail('no_buggy_road');
  const destSite = siteById(toSiteId);
  if (!destSite) return fail('bad_site');
  // The Crew / Colonist being driven.
  const humanSlot = srcArr.find((s) => s.id === humanId);
  if (!humanSlot) return fail('not_in_source');
  if (!isCrewSlot(humanSlot) && !isColonistSlot(humanSlot)) return fail('not_a_human');
  // Buggy-platform requirement: an operational buggy platform in the source
  // stack, OR the mover carries its own buggy platform.
  const humanIsBuggy = prospectorKind(humanSlot) === 'buggy';
  const stackBuggy = srcArr.some((s) => prospectorKind(s) === 'buggy');
  if (!humanIsBuggy && !stackBuggy) return fail('no_buggy_platform');
  // Form (or join) the player's Outpost at the destination.
  player.outposts = player.outposts || {};
  let letter = Object.keys(player.outposts)
    .find((l) => player.outposts[l] && player.outposts[l].siteId === toSiteId);
  let created = false;
  if (!letter) {
    const taken = new Set(Object.keys(player.outposts));
    letter = OUTPOST_LETTERS.find((l) => !taken.has(l));
    if (!letter) return fail('no_outpost_slot');
    player.outposts[letter] = { letter, siteId: toSiteId, cards: [], tank: 0 };
    created = true;
  }
  // Drive the mover over: pull from the source stack, drop in the outpost.
  const idx = srcArr.findIndex((s) => s.id === humanId);
  const [slot] = srcArr.splice(idx, 1);
  if (from === 'rocket') {
    if (player.rocket.activeThrusterId === slot.id) player.rocket.activeThrusterId = null;
    if (player.rocket.activeProspectorId === slot.id) player.rocket.activeProspectorId = null;
  }
  player.outposts[letter].cards.push(slot);
  const toName = destSite.name || toSiteId;
  const who = slotName(slot);
  const where = created ? `forming Outpost ${letter}` : `joining Outpost ${letter}`;
  return { ok: true, state, log: `${player.name} drove ${who} along the buggy road to ${toName}, ${where}.` };
}

// The map-node a colocatable stack endpoint sits on (null = LEO). Mirrors the
// local siteOf in applyTransfer, lifted to module scope so the vehicle
// stow/deploy ops below can reuse it. Returns undefined for a non-existent
// endpoint (an unbuilt outpost / absent freighter).
function stackEndpointSite(player, ep) {
  if (ep === 'leo') return null;
  if (ep === 'rocket') return player.rocket.siteId == null ? null : player.rocket.siteId;
  if (ep === 'freighter') return (player.freighter && player.freighter.siteId != null) ? player.freighter.siteId : null;
  if (ep && ep.startsWith('bernal')) {
    const bn = (player.bernals || [])[Number(ep.slice('bernal'.length)) || 0];
    return bn ? (bn.siteId == null ? null : bn.siteId) : undefined;
  }
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
  let to = op.to;
  // "New outpost" target: form a fresh Outpost at the Freighter's own location
  // (or a valid Space-Elevator end that touches it) and stow the cube into it.
  // Mirrors applyTransfer's newOutpost block, keyed off the Freighter's site
  // instead of a source stack. LEO (null site) has the LEO Stack, so a null
  // Freighter site is rejected here (stow into 'leo' directly instead).
  const frSiteSrc = fr.siteId == null ? null : fr.siteId;
  if (to === 'newOutpost') {
    if (frSiteSrc == null) return fail('outpost_needs_site');
    let site = frSiteSrc;
    if (op.newOutpostSite != null) {
      const want = String(op.newOutpostSite);
      if (want !== frSiteSrc
          && !elevatorColocated(state, frSiteSrc, want)
          && !elevatorFactoryColocated(state, player, frSiteSrc, want)) return fail('outpost_not_colocated');
      site = want;
    }
    const taken = new Set(Object.keys(player.outposts || {}));
    const letter = OUTPOST_LETTERS.find((l) => !taken.has(l));
    if (!letter) return fail('no_outpost_slot');
    player.outposts = player.outposts || {};
    player.outposts[letter] = { letter, siteId: site, cards: [], tank: 0 };
    to = `outpost${letter}`;
  }
  if (!isVehicleHost(to)) return fail('bad_transfer');
  if (to.startsWith('outpost') && !(player.outposts && player.outposts[to.slice('outpost'.length)])) return fail('no_outpost');
  const dst = stackArrayOf(player, to);
  if (!dst) return fail('bad_transfer');
  // Colocation: the host must sit where the Freighter sits. An empty rocket
  // forms at the Freighter's site (mirrors applyTransfer).
  const frSite = fr.siteId == null ? null : fr.siteId;
  if (to === 'rocket' && player.rocket.stack.length === 0) {
    player.rocket.siteId = frSite;
    // Formed this turn: anchor the solar-sail zone lock to where it forms.
    player.rocket.turnStartSiteId = frSite;
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

// RIDE_ELEVATOR (free action, rule "Space Elevator: move between the ends"): a
// unit (the Freighter, the rocket, or an Outpost) parked at one end of a BUILT
// Space Elevator rides the cable to the other end, carrying its WHOLE stack +
// fuel with it. No operation, no fuel step, no normal move consumed - the unit
// just changes ends, up or down. M1-gated. The cable must actually be BUILT
// (state.elevators) or be the implicit GEO cable (an anchored GEO Elevator
// Bernal); a mere factory link is not a cable you can ride.
function applyRideElevator(state, op, player) {
  if (!state.m1) return fail('m1_off');
  const rawUnit = typeof op.unit === 'string' ? op.unit : '';
  let ship, unitName;
  if (rawUnit === 'rocket') {
    ship = player.rocket;
    if (!ship || !Array.isArray(ship.stack) || ship.stack.length === 0) return fail('no_rocket');
    unitName = 'rocket';
  } else if (rawUnit.startsWith('outpost')) {
    const letter = rawUnit.slice('outpost'.length);
    ship = player.outposts && player.outposts[letter];
    if (!ship) return fail('no_outpost');
    unitName = `Outpost ${letter}`;
  } else {
    ship = player.freighter;
    if (!ship) return fail('no_freighter');
    unitName = 'Freighter';
  }
  const curSite = ship.siteId == null ? null : String(ship.siteId);
  if (curSite == null) return fail('not_at_elevator');
  const dest = op.to != null ? String(op.to) : '';
  if (!dest) return fail('bad_transfer');
  if (dest === curSite) return fail('already_here');
  // The cable must be BUILT between these two ends (elevatorColocated also covers
  // the implicit GEO cable); a factory link alone is not a ridable cable.
  if (!elevatorColocated(state, curSite, dest)) return fail('no_elevator');
  ship.siteId = dest;
  const pair = elevatorPairByKey(elevatorPairKey(curSite, dest));
  const body = pair && pair.body ? `${pair.body} ` : '';
  const destName = (siteById(dest) || {}).name || dest;
  return { ok: true, state, log: `${player.name} rode the ${body}Space Elevator; the ${unitName} (and its stack) moved to ${destName}.` };
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
  if (bn.anchored) return fail('bernal_anchored');
  if (bn.glitched) return fail('bernal_glitched');
  if ((bn.tank | 0) > 0) return fail('bernal_has_water');
  let to = op.to;
  // "New outpost" target: an unanchored Bernal can convert directly into its
  // own Outpost at its current site, the same free action the rocket gets
  // (CONVERT_OUTPOST). Mirrors applyStowFreighter's newOutpost block, keyed
  // off the Bernal's own location instead of a source stack.
  const bnSiteSrc = bn.siteId == null ? null : bn.siteId;
  if (to === 'newOutpost') {
    if (bnSiteSrc == null) return fail('outpost_needs_site');
    let site = bnSiteSrc;
    if (op.newOutpostSite != null) {
      const want = String(op.newOutpostSite);
      if (want !== bnSiteSrc
          && !elevatorColocated(state, bnSiteSrc, want)
          && !elevatorFactoryColocated(state, player, bnSiteSrc, want)) return fail('outpost_not_colocated');
      site = want;
    }
    const taken = new Set(Object.keys(player.outposts || {}));
    const letter = OUTPOST_LETTERS.find((l) => !taken.has(l));
    if (!letter) return fail('no_outpost_slot');
    player.outposts = player.outposts || {};
    player.outposts[letter] = { letter, siteId: site, cards: [], tank: 0 };
    to = `outpost${letter}`;
  }
  if (!isVehicleHost(to)) return fail('bad_transfer');
  if (to.startsWith('outpost') && !(player.outposts && player.outposts[to.slice('outpost'.length)])) return fail('no_outpost');
  const dst = stackArrayOf(player, to);
  if (!dst) return fail('bad_transfer');
  const bnSite = bn.siteId == null ? null : bn.siteId;
  if (to === 'rocket' && player.rocket.stack.length === 0) {
    player.rocket.siteId = bnSite;
    // Formed this turn: anchor the solar-sail zone lock to where it forms.
    player.rocket.turnStartSiteId = bnSite;
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
  // A stowed Bernal Card can be separated into its own colony from ANY host it
  // sits in: the rocket / LEO / an outpost (isVehicleHost), OR a Home Bernal's
  // own stack (rule 2B3 - a second Bernal can split off from the home it was
  // built onto). stackArrayOf / stackEndpointSite already resolve a bernalN id.
  const fromIsBernal = typeof from === 'string' && from.startsWith('bernal');
  if (!isVehicleHost(from) && !fromIsBernal) return fail('bad_transfer');
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
  // Figure chosen at creation (op.figure), forced UNIQUE: each figure (Kalpana /
  // Stanford) can back only one of a player's Bernals, so a request for one
  // already built falls through to the free figure.
  const figure = pickBernalFigure(player, op.figure);
  const promoted = slot.face === 'secondary';
  list.push({
    cardId, figure, face: promoted ? 'secondary' : 'primary', promoted,
    siteId: siteId == null ? null : siteId, stack: [], tank: 0, wiring: {}, route: [],
  });
  const fromName = from === 'rocket' ? 'the rocket'
    : from === 'leo' ? 'the LEO Stack'
    : from.startsWith('bernal') ? 'the Home Bernal'
    : `Outpost ${from.slice('outpost'.length)}`;
  const where = siteId == null ? 'LEO' : ((siteById(siteId) || {}).name || siteId);
  return { ok: true, state, log: `${player.name} established a ${figure === 'kalpana' ? 'Kalpana' : 'Stanford'} Bernal from ${fromName} at ${where}.` };
}

// ---- Exomigration (rule 2A6, M2) ----
// Draw the TOPMOST colonist from the queue into the player's LEO Stack (or
// their Home Bernal's stack). Fired automatically by Anchoring (2A5f) and
// Homesteading (2A4c), and player-invoked as the EXOMIGRATE free action
// whenever their colonist count sits below what their Anchored Bernals allow.
// M0: the arriving colonist may seat a delegate of the player's colour in the
// colonist's printed ideology (O2a), then a vote tally runs (auto when the
// winner is unique; a tie leaves the star where it is).
function exomigrateOne(state, player, opts = {}) {
  // Under a Sirens species split each species migrates from its OWN half of the
  // queue; one shared queue in every other game.
  const queue = colonistQueueFor(state, player);
  if (countColonists(player) >= colonistAllowance(player)) return { ok: false, error: 'no_colonist_slot' };
  // Destination (opts.to): 'leo', or 'bernal<i>' naming one of the player's
  // ANCHORED Bernals - the colonist boards the station directly (user decision
  // 2026-07-02: an anchored Bernal is where the crew transfers to). Default
  // (no opts.to): the Home Bernal when anchored, else the LEO Stack.
  let dest = null;   // { arr, where }
  const to = opts.to != null ? String(opts.to) : null;
  if (to === 'leo') {
    player.leo = player.leo || [];
    dest = { arr: player.leo, where: 'the LEO Stack' };
  } else if (to && to.startsWith('bernal')) {
    const bn = (player.bernals || [])[Number(to.slice('bernal'.length)) || 0];
    if (!bn) return { ok: false, error: 'no_bernal' };
    if (!bn.anchored) return { ok: false, error: 'not_anchored' };
    // A colonist boards only the LEO Stack or a HOME Bernal (rule 2A6). A
    // Dirtside (non-home) anchored Bernal raises the colonist allowance but is
    // never a boarding station, and a player has at most one Home Bernal ever
    // (user 2026-07-04).
    if (!isHomeBernal(bn)) return { ok: false, error: 'not_home_bernal' };
    bn.stack = bn.stack || [];
    const bnCard = PATENTS_BY_ID[bn.cardId];
    dest = { arr: bn.stack, where: `the ${(bnCard && bnCard.name) || 'Bernal'}` };
  } else if (to) {
    return { ok: false, error: 'bad_transfer' };
  } else {
    const home = (player.bernals || []).find(isHomeBernal);
    if (home) {
      home.stack = home.stack || [];
      dest = { arr: home.stack, where: 'the Home Bernal' };
    } else {
      player.leo = player.leo || [];
      dest = { arr: player.leo, where: 'the LEO Stack' };
    }
  }
  // Robot Emancipation (2C2b): an exomigration that finds the queue empty frees
  // every Robot. It fires ONCE per game (also via the Uplift Future). See
  // emancipateRobots: all hand-robots are discarded, one is drawn at random for
  // THIS exomigration (boards `dest`), the rest re-seed the queue, and Robots
  // count as Human from here on. If nothing was freed, there is no colonist.
  if (!queue.length) {
    if (!state.robotsEmancipated) {
      const freed = emancipateRobots(state, dest);
      if (freed) {
        const fc = PATENTS_BY_ID[freed] || {};
        return placeExomigrant(state, player, freed, fc, dest,
          `🕊 Robot Emancipation! Every Robot is freed; ${fc.name || freed} boards ${dest.where}`, opts);
      }
    }
    return { ok: false, error: 'colonist_queue_empty' };
  }
  // Handy (2C2a): a HUMAN goes into space at the chosen station, but a ROBOT
  // goes into the HAND (it enters play later via ET production) and the
  // exomigration immediately draws again, until a colonist lands in space or
  // the queue runs dry.
  const robotsDrawn = [];
  let cardId = null;
  let card = null;
  while (queue.length) {
    const id = queue.shift();
    const c = PATENTS_BY_ID[id] || {};
    // Handy (2C2a): an unemancipated Robot goes to the HAND (it enters play via
    // ET production later). But AFTER emancipation a Robot is a Human Colonist
    // and "cannot enter player Hands" (2C2b), so it boards the station directly
    // like any Human - don't skim it to the hand.
    if (c.colonistKind === 'Robot' && !state.robotsEmancipated) {
      (player.hand = player.hand || []).push(String(id));
      robotsDrawn.push(c.name || id);
      continue;
    }
    cardId = id; card = c;
    break;
  }
  const robotNote = robotsDrawn.length
    ? `${robotsDrawn.join(' and ')} (Robot${robotsDrawn.length === 1 ? '' : 's'}) joined the hand; `
    : '';
  if (!cardId) {
    // The queue drained mid-draw (Handy skimmed the rest to hand). This is the
    // empty-queue exomigration, so Robot Emancipation fires: one freed Robot
    // boards the station (as a Human now), the rest re-seed the queue.
    if (!state.robotsEmancipated) {
      const freed = emancipateRobots(state, dest);
      if (freed) {
        const fc = PATENTS_BY_ID[freed] || {};
        return placeExomigrant(state, player, freed, fc, dest,
          `${robotNote}🕊 Robot Emancipation! ${fc.name || freed} boards ${dest.where}`, opts);
      }
    }
    if (robotsDrawn.length) return { ok: true, log: `${robotNote}the colonist queue ran dry.` };
    return { ok: false, error: 'colonist_queue_empty' };
  }
  return placeExomigrant(state, player, cardId, card, dest,
    `${robotNote}${card.name || cardId} exomigrated to ${dest.where}`, opts);
}

// Push the exomigrated colonist onto its destination stack and seat its delegate
// (M0, optional). Shared by the normal draw and the Robot Emancipation draw.
function placeExomigrant(state, player, cardId, card, dest, baseLog, opts) {
  dest.arr.push({ id: cardId, kind: 'colonist', face: 'primary' });
  let log = baseLog;
  // The delegate is OPTIONAL (user decision 2026-07-02): the player may seat it
  // or keep the cube in reserve. Callers that don't ask (Homesteading's refill,
  // ad-astra exports) keep the default and seat it.
  if (opts.placeDelegate === false) return { ok: true, log: `${log}.` };
  if (state.m0 && card && card.ideology) {
    const ideo = ideologyForColorName(card.ideology);
    if (ideo && cubesInPlay(state, player.profileId) < FACTORY_CUBES) {
      const asm = assemblyOf(state);
      setPlaceCount(asm, ideo, player.profileId, placeCount(asm, ideo, player.profileId) + 1);
      const ideoName = (IDEOLOGY_BY_KEY[ideo] || {}).name || ideo;
      log += `; a delegate joins ${ideoName}`;
      // Vote tally (O3a) after the delegate seats. A single clear winner moves
      // the active-law star automatically. A TIE is the player's call: since the
      // colonist's ideology is only revealed on landing, the pick can't be
      // pre-resolved the way a Fundraise is, so an interactive exomigration
      // (allowTiePick) records a pendingLawStar the player resolves with
      // SET_LAW_STAR; automatic exomigrations leave the star put (quiet tally).
      const winners = voteWinners(asm);
      if (winners.length === 1 && winners[0] !== state.activeLawStar) {
        state.activeLawStar = winners[0];
        const starName = (IDEOLOGY_BY_KEY[winners[0]] || {}).name || winners[0];
        log += ` (the active-law star moves to ${starName})`;
      } else if (winners.length > 1 && opts.allowTiePick) {
        state.pendingLawStar = { chooserId: player.profileId, winners };
        log += ' (the vote is tied - choose which ideology holds the active-law star)';
      }
    }
  }
  return { ok: true, log: `${log}.` };
}

// Robot Emancipation (2C2b). Fires ONCE per game: when an exomigration finds the
// queue empty, or when the Uplift Future (1D5n) completes. Every Robot Colonist
// in every player's HAND is swept up; if this was triggered by an exomigration
// (dest given) ONE is drawn at random to board that station (the one exception
// - it still enters play, same as any other exomigration draw), and the REST
// are removed from the game for good instead of re-entering circulation (user
// 2026-07-23: emancipated robots are retired from the deck, not returned to the
// queue - the same rule retireColonistId now follows for every later robot
// retirement). From this moment on Robots cannot enter a hand and count as
// Human Colonists (isHumanColonistSlot reads state.robotsEmancipated). Returns
// the drawn card id, or null when there was no exomigration draw / no Robots to
// free.
function emancipateRobots(state, dest) {
  const robots = [];
  for (const p of state.players) {
    const keep = [];
    for (const id of (p.hand || [])) {
      const c = PATENTS_BY_ID[id];
      if (c && c.type === 'colonist' && c.colonistKind === 'Robot') robots.push(String(id));
      else keep.push(id);
    }
    p.hand = keep;
  }
  state.robotsEmancipated = true;
  if (!robots.length) return null;
  if (!dest) return null;
  const gen = makeRng(state.seed, state.rng.cursor);
  const bag = shuffle(gen, robots);
  state.rng.cursor = gen.cursor;
  return bag.shift();
}

// EXOMIGRATE (M2 free action, rule 2A6): gain the topmost queue colonist when
// your Anchored Bernals allow more colonists than you have. The gain is the
// player's call (never forced at anchor time), the colonist may board an
// anchored Bernal directly, and the delegate is optional.
// op = { to?: 'leo' | 'bernal<i>', placeDelegate?: boolean }.
function applyExomigrate(state, op, player) {
  if (!state.m2) return fail('m2_off');
  const res = exomigrateOne(state, player, {
    to: op.to,
    placeDelegate: op.placeDelegate !== false,
    // Player-invoked exomigration CAN pause for a tie pick (unlike the automatic
    // mid-op exomigrations, which resolve ties quietly): a tied vote after the
    // arriving delegate seats leaves the active-law star for the player to set
    // via SET_LAW_STAR (see placeExomigrant + pendingLawStar).
    allowTiePick: true,
  });
  if (!res.ok) return fail(res.error);
  // Exomigration reveals the topmost face-down colonist off the secret queue, so
  // it is a hard undo barrier (undoing it would leak the queue order / robot
  // count). (User 2026-07-06.)
  return { ok: true, state, log: `${player.name}: ${res.log}`, noUndo: true };
}

// SET_LAW_STAR (M0): resolve a tied vote tally that an exomigration's delegate
// seat opened (pendingLawStar). The active player picks which of the tied
// ideologies holds the active-law star. op = { star }.
function applySetLawStar(state, op, player) {
  const pending = state.pendingLawStar;
  if (!pending) return fail('no_pending_star');
  if (pending.chooserId !== player.profileId) return fail('not_your_choice');
  const star = op.star != null ? String(op.star) : '';
  if (!Array.isArray(pending.winners) || !pending.winners.includes(star)) {
    return fail('bad_star_choice', { winners: pending.winners || [] });
  }
  state.activeLawStar = star;
  state.pendingLawStar = null;
  const starName = (IDEOLOGY_BY_KEY[star] || {}).name || star;
  return { ok: true, state, log: `${player.name} broke the tied vote: the active-law star holds on ${starName}.` };
}

// Discard this player's furthest-from-home colonists back to the bottom of the
// queue until they fit their allowance (2B6b Homeless, after an unanchor). The
// player may name the colonists (cardIds); unnamed excess auto-picks the most
// recently gained ones (the tail of the scan).
function dischargeExcessColonists(state, player, preferredIds) {
  const notes = [];
  const wanted = new Set((preferredIds || []).map(String));
  while (countColonists(player) > colonistAllowance(player)) {
    const all = [...colonistLocations(player)];
    if (!all.length) break;
    const pick = all.find((e) => wanted.has(String(e.slot.id))) || all[all.length - 1];
    wanted.delete(String(pick.slot.id));
    removeColonistSlot(player, pick);
    notes.push(retireColonistId(state, player, pick.slot.id));
  }
  return notes;
}
// Pull one located colonist slot ({ slot, from }) out of its container.
function removeColonistSlot(player, loc) {
  const takeFrom = (arr) => {
    const i = (arr || []).findIndex((s) => s === loc.slot || (s.id === loc.slot.id && isColonistSlot(s)));
    if (i >= 0) arr.splice(i, 1);
    return i >= 0;
  };
  if (loc.from === 'leo') return takeFrom(player.leo);
  if (loc.from === 'rocket') {
    const ok = takeFrom(player.rocket.stack);
    if (ok) recallIfEmpty(player);
    return ok;
  }
  if (loc.from === 'freighter') return takeFrom(player.freighter && player.freighter.stack);
  if (loc.from.startsWith('outpost')) {
    const o = player.outposts && player.outposts[loc.from.slice('outpost'.length)];
    return takeFrom(o && o.cards);
  }
  if (loc.from.startsWith('bernal')) {
    const bn = (player.bernals || [])[Number(loc.from.slice('bernal'.length)) || 0];
    return takeFrom(bn && bn.stack);
  }
  return false;
}

// Factory sites "adjacent" to a Bernal space for the Dirtside rule (2A5a), with
// the raygun-style relaxation the player uses (user 2026-07-04): a lander burn
// or a Hazard sitting between the orbital space and a surface Factory is
// TRANSPARENT, so a Factory reached only through a lander burn / Hazard still
// counts as adjacent (regolith + ores are railgunned up past it, the same way a
// raygun scan skips lander burns + Hazards for line of sight). Plain burns,
// Hohmann transfers, and lagranges still BLOCK. A Factory node is terminal
// (collected, never traced through, so a Factory two Factories away never
// counts). Origin excluded.
function adjacentFactorySlugs(state, fromSlug) {
  if (fromSlug == null) return new Set();
  const out = new Set();
  // Anchoring reaches a Factory the way a raygun does: the beam leaves the
  // Bernal's space and passes through transparent waypoints (decorative bends,
  // sparse hazard belts, lander burnspaces), ignoring atmosphere, stopping at
  // the first real site. So a Bernal at an orbital node can Dirtside to a
  // Factory whose only approach is through a hazard / decorative waypoint (user
  // 2026-07-10: anchoring works like raygun line-of-sight, ignoring atmosphere).
  // Plain burns / hohmann / lagrange still block the beam - one shared model
  // (data/raygun-los.js). Unlike a prospect scan, an AEROSTAT factory still
  // counts: the beam only has to TOUCH the factory to serve it, so
  // includeBouncedSites keeps e.g. a Venus Aerostat-Xity factory dirtside-able
  // from the Venus lagrange (the atmosphere bounced the old walk and made
  // every aerostat factory silently un-anchorable - the lag-m0sea bug).
  for (const siteSlug of lineOfSightSites(String(fromSlug), { includeBouncedSites: true })) {
    if (state.factories[siteSlug]) out.add(siteSlug);
  }
  return out;
}
// Factory sites already serving as a Dirtside: adjacent to (or under) ANY
// player's anchored Bernal. Used by the Anchoring orbital requirement (2A5a:
// the adjacent Factory must not be a Dirtside already).
function dirtsideFactorySlugs(state, exceptBernal) {
  const used = new Set();
  for (const p of state.players) {
    for (const bn of (p.bernals || [])) {
      if (!bn || !bn.anchored || bn === exceptBernal || bn.siteId == null) continue;
      for (const nb of bernalDirtsides(state, bn, p)) used.add(nb);
    }
  }
  return used;
}
// The Dirtsides of ONE anchored Bernal: factory sites in the Bernal's raygun
// line of sight (any owner, rule 2A5a), excluding Luna (2Ba: Luna can never be
// a Dirtside). Reachability is the shared raygun beam (see adjacentFactorySlugs).
// Pick a Bernal FIGURE (Kalpana / Stanford) for a player, forced unique: each
// figure backs at most one of a player's Bernals. Honour the requested figure
// when it is still free; otherwise take the other free one. With max two Bernals
// and two figures, this always yields a distinct figure. (User 2026-07-06.)
function pickBernalFigure(player, requested) {
  const used = new Set((player.bernals || []).map((bn) => bn && bn.figure).filter(Boolean));
  const want = requested === 'stanford' ? 'stanford' : requested === 'kalpana' ? 'kalpana' : null;
  if (want && !used.has(want)) return want;
  if (!used.has('kalpana')) return 'kalpana';
  if (!used.has('stanford')) return 'stanford';
  return 'kalpana';   // both already built (shouldn't happen: two Bernals max)
}
// A Luna Factory normally CANNOT be a Dirtside (2Ba), with one exception: when
// BOTH Module 1 and Module 2 are in play and the Factory's Spectral Type is one
// of the player's isostandards (the spectral value of a GW/TW thruster they have
// ET-produced, 1Cb). The same isostandard clause that lets a Bernal anchor AT a
// Luna Site also lets a Luna Factory count as a Dirtside for a Bernal anchored
// beside it. Needs the owning player's isostandards, so callers pass `player`.
function lunaFactoryIsostandardOk(state, player, slug) {
  if (!player || !state.m1 || !state.m2) return false;
  const f = state.factories[slug];
  if (!f) return false;
  return (player.isostandards || []).includes(f.spectralType || 'C');
}
function bernalDirtsides(state, bn, player) {
  if (!bn || bn.siteId == null) return [];
  const out = [];
  for (const nb of adjacentFactorySlugs(state, bn.siteId)) {
    // Luna is never a Dirtside unless the isostandard exception (2Ba) applies.
    if (String(siteBodyOf(nb) || '') === 'Luna' && !lunaFactoryIsostandardOk(state, player, nb)) continue;
    out.push(nb);
  }
  return out;
}
// M2 Bernal endgame VP (rulebook 2Bd / M2b): every ANCHORED Bernal a player
// owns scores. A Home Bernal is a flat 6 VP; any other anchored (Dirtside)
// Bernal scores its Dirtside Hydration (the summed hydration of its Dirtside
// factory sites). Three specific Bernals add a bonus: a PROMOTED Cancer Hospital
// (+1 VP per Colony dome the player owns), a PROMOTED Climate Control (+2 VP per
// Dirtside), and the Tourism Cycler (+2 VP per Dirtside). Non-M2 games score 0.
function bernalScoreVp(state, player) {
  if (!state.m2) return 0;
  let vp = 0;
  const ownDomes = Object.values(state.colonies || {})
    .filter((c) => c && c.ownerId === player.profileId).length;
  // SSO Diplomatic (Module 0 only - the ability text is printed "(Module 0)"):
  // read the assembly WITHOUT creating one on a non-M0 game (assemblyOf would
  // otherwise stamp a fresh, unused state.assembly onto every scoring read).
  const asm = state.m0 ? assemblyOf(state) : null;
  for (const bn of (player.bernals || [])) {
    if (!bn || !bn.anchored) continue;
    const dirtsides = bernalDirtsides(state, bn, player);
    // A Home Bernal is normally worth a flat 6. V9: a SIRENIAN Home Bernal is
    // not - it scores like any other station, off the hydration of the moons it
    // is dirtside to (user 2026-07-28). The Uranian moons are mostly hydration
    // 4, so this is a real change either way rather than a rounding.
    if (isHomeBernal(bn) && !isSirenPlayer(state, player)) {
      vp += 6;
    } else {
      for (const slug of dirtsides) {
        const site = siteById(slug);
        vp += (site && Number(site.hydration)) | 0;
      }
    }
    const promoted = bn.promoted || bn.face === 'secondary';
    if (bn.cardId === 'ber_l5s_cancer_hospital' && promoted) vp += ownDomes;
    if (bn.cardId === 'ber_l1_climate_control_bernal' && promoted) vp += 2 * dirtsides.length;
    if (bn.cardId === 'ber_tourism_cycler') vp += 2 * dirtsides.length;
    // SSO Diplomatic: "(Module 0) Your delegates in the assembly are +1 VP
    // each" (promoted, anchored anywhere) or "...in the Ideology of your
    // Faction color are +1 VP each" (white, HOME only) - an EXTRA +1 VP per
    // delegate on top of the base 1 VP/delegate (cubeVp) every player already
    // scores.
    if (bn.cardId === 'ber_sso_diplomatic' && asm) {
      if (promoted) {
        vp += playerDelegatesPlaced(asm, player.profileId);
      } else if (isHomeBernal(bn)) {
        const ideology = ideologyForFactionColor(player.color);
        if (ideology) vp += playerDelegatesInPlace(asm, ideology, player.profileId);
      }
    }
  }
  return vp;
}
// The player's OWN Anchored Bernal (if any) for which `siteId` is a Dirtside.
// M2 Core Rule Addenda (d/e): a Factory Refuel or ET Production performed at
// a Dirtside Factory may deliver straight to this Bernal's stack instead of
// the rocket / the Factory outpost.
function playerBernalDirtsideAt(state, player, siteId) {
  for (const bn of (player.bernals || [])) {
    if (bn && bn.anchored && bernalDirtsides(state, bn, player).includes(siteId)) return bn;
  }
  return null;
}
// The rocket COLOCATED with a Factory Site for the purpose of running that
// Factory's operations (2A7): parked on the site itself, OR docked at one of the
// player's own Anchored Bernals that is Dirtside to it. Mirrors the colonist
// colocation rule (colonistColocatedWithSite) for the spacecraft, so a rocket
// tucked in at a Dirtside Bernal may refuel from the Factory it services.
function rocketColocatedWithSite(state, player, siteId) {
  const s = player.rocket && player.rocket.siteId;
  if (s == null || siteId == null) return false;
  if (s === siteId) return true;
  return (player.bernals || []).some((bn) =>
    bn && bn.anchored && bn.siteId === s && bernalDirtsides(state, bn, player).includes(siteId));
}

// ANCHOR (rule 2A5, M2 operation): anchor a Bernal as a fixed space station at
// its current location. It stops being a mobile cycler (no more thrust / fuel
// ladder) and the player gains its colony ability. Costs the turn's operation.
// Orbital requirement (2A5a): a Home Orbit, or adjacent to at least one
// Factory not already serving another Bernal as a Dirtside; never on a Site,
// hazard, or lander burn; never sharing a Space with another Bernal; no second
// Bernal in a Home Orbit; Luna never counts as the qualifying Dirtside.
// Anchoring immediately gains a colonist by exomigration (2A5f) and is a
// Glitch Trigger (2A5d). op = { cardId, decommissionIds? } - decommissionIds
// optionally names support cards in the Bernal's stack consumed by the build
// (2A5b), returned to hand like an Industrialize build set.
function applyAnchorBernal(state, op, player) {
  if (!state.m2) return fail('m2_off');
  const cardId = op.cardId != null ? String(op.cardId) : null;
  const bn = cardId ? (player.bernals || []).find((b) => b && b.cardId === cardId) : null;
  if (!bn) return fail('no_bernal');
  if (bn.anchored) return fail('already_anchored');
  // Industrialist colonist (2C1): a colocated one grants one free
  // Industrialize / Anchoring per turn.
  const freeViaColonist = canColonistFreeOp(state, player, bn.siteId, 'Industrialist');
  if (!freeViaColonist && player.opsRemaining <= 0) return fail('no_ops_left');
  const slug = bn.siteId;
  // Home Orbit: GEO for the GEO Elevator Bernal, or an admin-flagged Home
  // Bernal anchor site.
  // V9 Sirens scopes the home orbits by species: a Siren's are the Uranus-zone
  // anchor spaces, an Earthling's are the rest. A home orbit that is not YOURS
  // is simply not a home orbit for you - you may still anchor there as an
  // ordinary dirtside Bernal if you have the factory for it, which is what the
  // branch below handles. No-op in every non-Sirens game.
  const homeOrbit = ((cardId === GEO_ELEVATOR_BERNAL_ID && slug === GEO_NODE) || isHomeBernalSite(slug))
    && homeOrbitAllowsSpecies(player.species, zoneOfSlug(slug));
  // 2Ba Luna exception. You may NOT anchor to Luna, EXCEPT when playing BOTH
  // Module 1 and Module 2 and a Site at Luna is your isostandard (1Cb: the
  // spectral value of a GW/TW thruster you have ET-produced). This is the ONLY
  // way to anchor at a Luna Site (normally "cannot be a Site" blocks it).
  const anchorSite = slug != null ? siteById(slug) : null;
  const isLunaSite = !!(anchorSite && String(anchorSite.body || '') === 'Luna');
  const lunaIsoOk = isLunaSite && !!state.m1 && !!state.m2
    && (player.isostandards || []).includes(anchorSite.spectralType);
  if (lunaIsoOk) {
    // A valid isostandard Luna anchor: it is a Site, but 2Ba permits it here.
    // The one-Bernal-per-Space + operational checks below still apply; no
    // factory adjacency is required (the isostandard qualifies the location).
  } else if (isLunaSite) {
    // A Luna Site that does NOT qualify: spell out why (2Ba).
    if (!(state.m1 && state.m2)) return fail('luna_needs_modules');
    return fail('luna_needs_isostandard');
  } else if (!homeOrbit) {
    if (slug == null) return fail('bad_anchor_spot');
    if (isSiteNode(slug)) return fail('bad_anchor_spot');
    // 2A5a "cannot be a Hazard" means the deadly discrete hazards you roll /
    // parachute through (skull, aerobrake). A radiation BELT is a continuous
    // field, not one of those hazard spaces, so it is a LEGAL anchor spot (user
    // 2026-07-06: rad belts near Io etc. should register as legal). rad is
    // allowed here; skull / aero still block.
    const hk = hazardKind(slug);
    if (hk === 'skull' || hk === 'aero') return fail('bad_anchor_spot');
    const node = nodeBySlug(slug);
    if (node && node.landing) return fail('bad_anchor_spot');
    const used = dirtsideFactorySlugs(state, bn);
    const reachable = bernalDirtsides(state, bn, player);
    const fresh = reachable.filter((s) => !used.has(s));
    // Split the refusal so the player learns WHY: a factory IS in reach but
    // every one is already the Dirtside of another anchored Bernal (each
    // factory serves only one station, 2A5a) vs no factory in reach at all.
    // Attach what the engine actually SEES - the station's recorded space and
    // the factory sites its Dirtside walk found - so the message can spell it
    // out and a wrong recorded position / missing factory is visible to the
    // player instead of reading as a bare "needs a factory".
    if (!fresh.length) {
      const nameOfSlug = (s) => (siteById(s) && siteById(s).name) || s;
      // Name the claiming station for each in-reach factory, so the "in use"
      // refusal says WHO holds it (it may be an opponent's station the player
      // never considered).
      const claims = [];
      for (const p of state.players) {
        for (const other of (p.bernals || [])) {
          if (!other || !other.anchored || other === bn || other.siteId == null) continue;
          for (const nb of bernalDirtsides(state, other, p)) {
            if (reachable.includes(nb)) {
              const card = PATENTS_BY_ID[other.cardId];
              claims.push(`${nameOfSlug(nb)} serves ${p.name}'s ${(card && card.name) || 'Bernal'}`);
            }
          }
        }
      }
      return fail(reachable.length ? 'anchor_factory_in_use' : 'anchor_needs_factory', {
        at: slug,
        atName: nameOfSlug(slug),
        reachable: reachable.map(nameOfSlug),
        claims,
      });
    }
  } else if ((player.bernals || []).some((b) => b && b !== bn && isHomeBernal(b))) {
    // One Home Bernal at a TIME (user 2026-07-07, relaxing the earlier
    // one-ever rule): a player may swap which Bernal card is their Home Bernal
    // by unanchoring the current one and anchoring a DIFFERENT card (with its
    // own stack) at a home orbit. The only bar is a Home Bernal that is STILL
    // anchored: you cannot hold two at once.
    return fail('home_bernal_exists');
  }
  // One Bernal per Space (any player's, anchored or not).
  for (const p of state.players) {
    for (const other of (p.bernals || [])) {
      if (other && other !== bn && other.siteId != null && other.siteId === slug) return fail('space_has_bernal');
    }
  }
  // Anchoring turns an OPERATIONAL Bernal into a colony: the Bernal must be
  // powered (its support chain satisfied - e.g. a generator supplying its
  // gen-electric, that generator's own reactor, and so on) before it can
  // Anchor. An unpowered Bernal has no colony ability to switch on.
  const support = bernalSupportStatus(bn, player, { pendingAnchor: true });
  if (!support.operational) return fail('bernal_not_operational');
  // GEO Elevator Bernal anchoring at GEO BUILDS the Earth space elevator, which
  // is an Epic Hazard operation (1A6): roll a d6 and fail on a 1, or pay FINAO to
  // skip the roll. A FAILED roll does NOT anchor (the operation is spent, the
  // Bernal stays mobile, retry later - user 2026-07-04). Other home orbits and
  // Dirtside anchors raise no elevator, so they never roll. Runs before the
  // supports decommission + the anchor commit so a failed roll mutates nothing
  // but the spent operation (and FINAO, if paid).
  const isGeoElevatorBuild = (cardId === GEO_ELEVATOR_BERNAL_ID && slug === GEO_NODE);
  let opSpent = false;
  let didRoll = false;
  let hazardNote = '';
  if (isGeoElevatorBuild) {
    const wantPay = !!op.hazardPay;
    const finaoPer = finaoPerFor(state, player);
    if (wantPay && finaoPer > (player.aqua | 0)) return fail('insufficient_aqua');
    // The attempt spends the operation regardless of the roll's outcome.
    if (freeViaColonist) spendColonistFreeOp(player, 'Industrialist');
    else player.opsRemaining -= 1;
    opSpent = true;
    if (wantPay) {
      player.aqua -= finaoPer;
      hazardNote = ` (paid ${finaoPer} FINAO to skip the Epic Hazard)`;
    } else {
      const gen = makeRng(state.seed, state.rng.cursor);
      const d6 = gen.d6();
      state.rng.cursor = gen.cursor;
      didRoll = true;
      if (d6 === 1) {
        const card0 = PATENTS_BY_ID[cardId];
        const name0 = (card0 && card0.name) || 'Bernal';
        return {
          ok: true, state, rolled: true,
          log: `${player.name}'s attempt to anchor the ${name0} at GEO failed the Epic Hazard (rolled a 1); the space elevator was not raised, so the Bernal stays mobile. Try again next turn.`,
        };
      }
      hazardNote = ` (Epic Hazard rolled ${d6})`;
    }
  }
  // Supports decommission (2A5b): the Operational Bernal is built into a
  // colony using its own infrastructure, so every reactor, generator, AND
  // radiator (user 2026-07-05: "including radiators") powering / cooling it is
  // Decommissioned back to the hand. Crew, colonists, and cargo stay aboard.
  // Only the ACTIVE supports go: like INDUSTRIALIZE decommissions just its
  // build set, we take only the cards in the resolved support chain that feeds
  // the Bernal (support.supportIds), NOT every support-type card in the stack -
  // a spare generator supplying nothing the Bernal needs is never walked into
  // the chain, so it stays aboard. (User 2026-07-06.)
  const SUPPORT_TYPES = new Set(['reactor', 'generator', 'radiator']);
  const activeSupportIds = new Set(support.supportIds || []);
  let decoN = 0;
  for (let i = (bn.stack || []).length - 1; i >= 0; i--) {
    const s = bn.stack[i];
    const c = PATENTS_BY_ID[s.id];
    if (c && SUPPORT_TYPES.has(c.type) && activeSupportIds.has(s.id)) {
      bn.stack.splice(i, 1);
      player.hand.push(s.id);
      decoN += 1;
    }
  }
  bn.anchored = true;
  // V9 Sirens: record whether this anchor made it the player's HOME Bernal, so
  // isHomeBernal can answer without knowing the species. Written only in a
  // Sirens game (see isHomeBernal) so every other room's state is untouched.
  // Note this also settles a case the map-only rule got wrong: anchoring as an
  // ordinary dirtside Bernal ON a home-orbit space is NOT a home anchor, and the
  // flag says so where the site tag alone could not.
  if (state.sirens) bn.home = !!homeOrbit;
  // Crew waiting in the LEO Stack board the newly anchored Home Bernal (2A5):
  // the colony is now a habitable station, so a crew originally in LEO rides up
  // to it automatically. Only a Home Bernal pulls the LEO crew up; a Dirtside
  // anchor does not. (User 2026-07-05.)
  let crewMoved = 0;
  if (homeOrbit) {
    const crew = (player.leo || []).filter(isCrewSlot);
    if (crew.length) {
      player.leo = player.leo.filter((s) => !isCrewSlot(s));
      for (const s of crew) bn.stack.push(s);
      crewMoved = crew.length;
    }
  }
  // The GEO Elevator build already spent the operation (win or lose) in the Epic
  // Hazard block above; every other anchor spends it here.
  if (!opSpent) {
    if (freeViaColonist) spendColonistFreeOp(player, 'Industrialist');
    else player.opsRemaining -= 1;
  }
  const card = PATENTS_BY_ID[cardId];
  const name = (card && card.name) || 'Bernal';
  const where = slug == null ? 'LEO' : ((siteById(slug) || {}).name || slug);
  let log = `${player.name} anchored the ${name} as a space station at ${where}${hazardNote}; its colony ability is active.`;
  if (freeViaColonist) log += ' (Industrialist colonist: free action.)';
  if (decoN) log += ` ${decoN} support card${decoN === 1 ? '' : 's'} decommissioned in the build.`;
  if (crewMoved) log += ` ${crewMoved} crew boarded the Home Bernal from LEO.`;
  // Secretary General under Module 2: the +2 aqua lands on the FIRST anchoring
  // of the player's Home Bernal (instead of at game start).
  if (state.m2 && isHomeBernal(bn) && !player.sgHomePaid
      && hasPrivilege(state, player, 'SECRETARY_GENERAL')) {
    player.sgHomePaid = true;
    player.aqua = (player.aqua | 0) + 2;
    log += ' Secretary General: +2 aqua for servicing Earth.';
  }
  // 2A5f reworked (user decision 2026-07-02): anchoring OPENS a colonist
  // berth but does not force the gain. The player exomigrates when ready,
  // as a free action, from the Colonists tab (which highlights while a
  // berth is open).
  if (countColonists(player) < colonistAllowance(player) && colonistQueueFor(state, player).length) {
    log += ' A colonist berth is open - exomigrate the topmost colonist as a free action when ready.';
  }
  // A GEO anchor that actually ROLLED the Epic Hazard is a roll barrier: like any
  // dice roll it can't be undone (a FINAO-paid anchor didn't roll, so it can).
  return didRoll ? { ok: true, state, rolled: true, log } : { ok: true, state, log };
}

// UNANCHOR (M2 free action, rule 2B6): an anchored Bernal becomes a mobile
// cycler again. No operation cost. Homeless (2B6b): colonists above the new
// allowance return to the bottom of the queue - the player may name which
// (op.discardColonistIds), else the most recent go. Dirt Refuel (2B6c): you may
// set a grey dirt wet-mass chit to any value, provisioned from the Bernal's
// Dirtside factories - a Home Bernal has no Dirtsides (no dirt in Earth orbit,
// 2B6d), so it cannot. op = { cardId, discardColonistIds?, dirtFuel? }.
function applyUnanchorBernal(state, op, player) {
  if (!state.m2) return fail('m2_off');
  const cardId = op.cardId != null ? String(op.cardId) : null;
  const bn = cardId ? (player.bernals || []).find((b) => b && b.cardId === cardId) : null;
  if (!bn) return fail('no_bernal');
  if (!bn.anchored) return fail('not_anchored');
  // 2B6c Dirt Refuel: resolved WHILE still anchored, so the Home / Dirtside
  // checks read the anchored state. "Set it to any value" - dirt is abundant, so
  // the wet-mass chit lands directly on the chosen amount (capped by the tank).
  // A Home Bernal dirt-refuels under the SAME rule as any other Bernal (user
  // 2026-07-22): it just needs a Dirtside factory in line of sight to scoop from.
  // A Home Bernal with no such factory (e.g. bare Earth orbit) still fails with
  // no_dirtside_factory, which is the real reason - not a blanket home ban.
  let dirtNote = '';
  const dirtWant = Number(op.dirtFuel);
  if (Number.isFinite(dirtWant) && dirtWant > 0) {
    const hasDirtsideFactory = bernalDirtsides(state, bn, player).some((s) => state.factories[s]);
    if (!hasDirtsideFactory) return fail('no_dirtside_factory');
    // Dirt can't mix with water already in the tank (empty it first).
    if ((Number(bn.tank) || 0) > 0 && bernalTankGrade(bn) === 'water') return fail('cannot_mix_fuel');
    const cap = Math.max(0, TANK_MAX - bernalDryMass(bn));
    const set = Math.min(dirtWant, cap);
    bn.tank = round6(set);
    bn.tankGrade = 'dirt';
    dirtNote = ` Dirt-refueled to ${round6(set)} (wet mass ${round6(bernalDryMass(bn) + set)}).`;
  }
  bn.anchored = false;
  // Drop the V9 home flag with the anchor: home-ness is a property of BEING
  // anchored at your own home orbit, so a mobile Bernal carries no answer and
  // the next anchor decides afresh (it may well be a different space).
  if ('home' in bn) delete bn.home;
  const card = PATENTS_BY_ID[cardId];
  const name = (card && card.name) || 'Bernal';
  let log = `${player.name} unanchored the ${name}; it is mobile again.${dirtNote}`;
  const homeless = dischargeExcessColonists(state, player, op.discardColonistIds);
  if (homeless.length) log += ` Homeless: ${homeless.join('; ')}.`;
  return { ok: true, state, log };
}

// Choose the colony FIGURE a Bernal is built on (Kalpana spindle / Stanford
// torus) and lock it in. Free action; cosmetic but persisted so the map sprite
// + modal show the figure the player picked. op = { cardId, figure }.
function applySetBernalFigure(state, op, player) {
  if (!state.m2) return fail('m2_off');
  const cardId = op.cardId != null ? String(op.cardId) : null;
  const figure = op.figure === 'stanford' ? 'stanford' : 'kalpana';
  const bn = cardId ? (player.bernals || []).find((b) => b && b.cardId === cardId) : null;
  if (!bn) return fail('no_bernal');
  bn.figure = figure;
  const card = PATENTS_BY_ID[cardId];
  const name = (card && card.name) || 'Bernal';
  return { ok: true, state, log: `${player.name} built the ${name} on the ${figure === 'kalpana' ? 'Kalpana spindle' : 'Stanford torus'}.` };
}

// A Home Bernal = an ANCHORED Bernal that is the crew's home: the GEO Elevator
// Bernal anchored at GEO (by card identity), or any Bernal anchored at a site
// the admin flagged as a Home Bernal anchor.
function isHomeBernal(bn) {
  if (!bn || !bn.anchored) return false;
  // V9 Sirens: home orbits are scoped by species, so "is this space a home
  // orbit" is no longer a question the MAP alone can answer - it depends on who
  // anchored. applyAnchorBernal is the only place that knows both, so it decides
  // ONCE and records the answer here. Reading a stored flag rather than
  // threading species through all 22 callers of this function is deliberate: a
  // missed caller would be a silent wrong answer, and that is the exact class of
  // mistake that has bitten this engine before.
  //
  // The flag is written ONLY in a Sirens game, so every other room's state stays
  // byte-for-byte what it was and falls through to the original map-only rule
  // below. That also means no boot migration: a legacy Bernal simply has no flag
  // and resolves the old way.
  if (typeof bn.home === 'boolean') return bn.home;
  if (bn.cardId === GEO_ELEVATOR_BERNAL_ID && bn.siteId === GEO_NODE) return true;
  return isHomeBernalSite(bn.siteId);
}
// Budget Cuts immunity: a HOME-Bernal ability ("HOME: You are immune to budget
// cuts", the L5s Cancer Hospital). The HOME: prefix means the Bernal must
// actually BE the Home Bernal (anchored at its Home Orbit) - same gating as
// bernalBoostCost's "without doubling". Read the INSTALLED face's ability: the
// promoted Cancer Lab face is a different tech and drops the immunity. M2-gated
// (Bernals only exist in M2 games; the flag check keeps the zero-bleed rule
// explicit).
function immuneToBudgetCuts(state, player) {
  if (!state.m2) return false;
  for (const bn of ((player && player.bernals) || [])) {
    if (!bn || !isHomeBernal(bn)) continue;
    const card = PATENTS_BY_ID[bn.cardId];
    const face = card && card.faces && (bn.face === 'secondary' ? card.faces.secondary : card.faces.primary);
    const ability = (face && face.ability) || (card && card.ability) || '';
    if (/immune to budget cuts/i.test(ability)) return true;
  }
  return false;
}
// "Bernals Building Bernals" (rule 2B3, M2 FREE action): with a Home Bernal in
// play and a SECOND Bernal Card in hand, move that card from the hand into the
// Home Bernal's stack for 10 Aqua. FREE when the Home Bernal is the GEO Elevator
// Bernal anchored at GEO - its space elevator hauls the colony up at no cost. No
// operation spent. op = { cardId }.
const BERNAL_BUILD_AQUA = 10;
function applyBuildBernalOntoHome(state, op, player) {
  if (!state.m2) return fail('m2_off');
  const home = (player.bernals || []).find(isHomeBernal);
  if (!home) return fail('no_home_bernal');
  const cardId = op.cardId != null ? String(op.cardId) : null;
  if (!cardId) return fail('bad_card');
  const card = PATENTS_BY_ID[cardId];
  if (!card || card.type !== 'bernal') return fail('not_a_bernal');
  const idx = (player.hand || []).indexOf(cardId);
  if (idx < 0) return fail('not_in_hand');
  // A flat 10 Aqua onto ANY Home Bernal. The GEO Elevator no longer waives this
  // (user 2026-07-04), matching the boost nerf: the card only waives boost
  // doubling, not this second-Bernal build.
  const cost = BERNAL_BUILD_AQUA;
  if ((player.aqua | 0) < cost) return fail('cannot_pay');
  player.hand.splice(idx, 1);
  player.aqua = (player.aqua | 0) - cost;
  home.stack = home.stack || [];
  home.stack.push({ id: cardId, kind: 'patent', face: 'primary' });
  const homeName = (PATENTS_BY_ID[home.cardId] || {}).name || 'Home Bernal';
  return { ok: true, state, log: `${player.name} moved ${card.name} onto the ${homeName} for ${cost} aqua (Bernals Building Bernals).` };
}

// Invariant: an empty rocket stack sits at LEO with no active
// thruster / prospector. Called wherever the rocket can become empty.
// An emptied rocket either fully DECOMMISSIONS or stays LOCATION-LOCKED by its
// fuel. A rocket and its fuel are tied to a location: you cannot teleport fuel
// by emptying the stack here and re-forming the rocket elsewhere. So an empty
// rocket with LESS THAN 1 fuel is scrapped back to LEO with a fresh water tank
// (decommissioned - it can be re-formed anywhere by sending it the first card);
// an empty rocket that still holds >= 1 fuel keeps its site + tank (locked in
// place) until the fuel is dumped or transferred out. Call this after any op
// that empties the stack OR drains the tank.
function recallIfEmpty(player) {
  if (player.rocket.stack.length !== 0) return;
  player.rocket.activeThrusterId = null;
  player.rocket.activeProspectorId = null;
  player.rocket.afterburnEngaged = false;
  if ((Number(player.rocket.tank) || 0) < 1) {
    player.rocket.siteId = null;
    player.rocket.tank = 0;
    player.rocket.tankGrade = 'water';
    player.rocket.wiring = {};
    // The spacecraft that began the turn out there is gone (fully
    // decommissioned), so the turn-start zone lock must follow it back to LEO -
    // otherwise a freshly boosted solar sail keeps the OLD zone's thrust modifier
    // (e.g. a stale Mars -1 after re-boosting at Earth). rocketSolarZone reads
    // turnStartSiteId, so reset it to LEO here.
    player.rocket.turnStartSiteId = null;
  }
}

// Voluntary decommission: send selected cards from the rocket stack (or
// LEO Stack) back to the HAND (mirror of browse.js#decommissionSelectedToHand).
// Crew never enters the hand, so any crew in the selection is skipped.
// op = { cardIds: [...], from: 'rocket' | 'leo' }. Turn-gated (functional).
function applyDecommission(state, op, player) {
  const fromRaw = String(op.from || 'rocket');
  // Recall the Freighter UNIT itself back to hand: the big cube leaves the map
  // and its card returns to the player's hand (re-producible later). A vehicle
  // "is just a card" (user 2026-06-27), so reclaiming it is a free-action
  // decommission like any other card returning to hand. It must be EMPTY first:
  // no cargo aboard and an empty water tank (offload / unfuel before recalling),
  // and not glitched. M1-gated.
  if (fromRaw === 'freighter-unit') {
    if (!state.m1) return fail('m1_off');
    const fr = player.freighter;
    if (!fr) return fail('no_freighter');
    if (fr.glitched) return fail('freighter_glitched');
    if (Array.isArray(fr.stack) && fr.stack.length) return fail('freighter_has_cargo');
    if ((fr.tank | 0) > 0) return fail('freighter_has_water');
    const cardId = fr.cardId;
    const card = PATENTS_BY_ID[cardId];
    player.freighter = null;
    player.freighterMovesRemaining = 0;
    (player.hand = player.hand || []).push(cardId);
    return { ok: true, state, log: `${player.name} recalled the Freighter${card ? ` (${card.name})` : ''} to hand; the big cube leaves the map.` };
  }
  // Recall a Bernal UNIT to hand: the colony leaves the map, its card returns to
  // hand. Same empty-first discipline as the Freighter (no cargo, no water, not
  // glitched). op = { from: 'bernal-unit', cardId }. M2-gated.
  if (fromRaw === 'bernal-unit') {
    if (!state.m2) return fail('m2_off');
    const cardId = op.cardId != null ? String(op.cardId) : null;
    const list = player.bernals || [];
    const bi = cardId ? list.findIndex((b) => b && b.cardId === cardId) : -1;
    if (bi < 0) return fail('no_bernal');
    const bn = list[bi];
    if (bn.glitched) return fail('bernal_glitched');
    if (Array.isArray(bn.stack) && bn.stack.length) return fail('bernal_has_cargo');
    if ((bn.tank | 0) > 0) return fail('bernal_has_water');
    const card = PATENTS_BY_ID[cardId];
    list.splice(bi, 1);
    (player.hand = player.hand || []).push(cardId);
    return { ok: true, state, log: `${player.name} recalled the ${(card && card.name) || 'Bernal'} to hand; the colony leaves the map.` };
  }
  let from, src;
  let srcBernal = null;   // the source Bernal unit, for the crew home-stack gate
  if (fromRaw === 'leo') { from = 'leo'; src = (player.leo = player.leo || []); }
  else if (fromRaw === 'freighter') {
    if (!player.freighter) return fail('no_freighter');
    from = 'freighter'; src = (player.freighter.stack = player.freighter.stack || []);
  }
  else if (fromRaw.startsWith('bernal')) {
    const bn = (player.bernals || [])[Number(fromRaw.slice('bernal'.length)) || 0];
    if (!bn) return fail('no_bernal');
    from = 'bernal'; src = (bn.stack = bn.stack || []);
    srcBernal = bn;
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
  let robotsToHand = 0;
  let humansHome = 0;
  let fuelDestroyed = 0;        // total fuel units lost (water / isotope)
  let fuelCardsDestroyed = 0;   // how many fuel cargo cards were scrapped
  for (const id of ids) {
    const idx = src.findIndex((s) => s.id === id);
    if (idx < 0) continue;
    const slot = src[idx];
    // Decommissioning a Crew (a Human) is a FELONY (Anarchy, or the Felonious
    // privilege): the crew recalls to the LEO Stack from the rocket, an
    // outpost, the freighter, or a mobile / non-Home Bernal. Only LEO and the
    // Home Bernal are blocked - the crew is already home there, so there is
    // nothing to recall. (User 2026-07-15: decommissionable from any non-LEO /
    // non-Home-Bernal stack during a felony.)
    if (isCrewSlot(slot)) {
      const atHome = from === 'leo' || (from === 'bernal' && srcBernal && isHomeBernal(srcBernal));
      if (!mayCommitFelony(state, player) || atHome) { blocked++; continue; }
      src.splice(idx, 1);
      (player.leo = player.leo || []).push({ id: slot.id, kind: 'crew', face: slot.face === 'secondary' ? 'secondary' : 'primary' });
      if (player.rocket.activeThrusterId === id) player.rocket.activeThrusterId = null;
      if (player.rocket.activeProspectorId === id) player.rocket.activeProspectorId = null;
      crewToLeo++;
      continue;
    }
    // Colonists (2C2a Murder/Suicide): a Robot may be scrapped freely - the
    // chassis returns to the hand. A Human is a FELONY (Anarchy / Felonious
    // only), and the human is not lost: they return to the LEO Stack (or the
    // anchored Home Bernal) on their unpromoted face, with NO replacement
    // exomigration.
    if (isColonistSlot(slot)) {
      const cCard = PATENTS_BY_ID[slot.id];
      if (cCard && cCard.colonistKind === 'Robot') {
        src.splice(idx, 1);
        player.hand.push(String(slot.id));
        robotsToHand++;
      } else {
        // Collective Bargaining (LEO Workers' Union promo crew): "You may
        // commit Murder/Suicide" grants JUST this one felony (2C2a), not the
        // full Felonious privilege - it must NOT also unlock Claim Jump, Luna
        // prospecting, Factory Hijack, or Crew (Human) decommission above, so
        // it's checked here directly rather than folded into mayCommitFelony.
        if (!mayCommitFelony(state, player) && !hasPrivilege(state, player, 'COLLECTIVE_BARGAINING')) {
          blocked++; continue;
        }
        src.splice(idx, 1);
        const home = (player.bernals || []).find((b) => b && b.anchored && isHomeBernal(b));
        const targetArr = home ? (home.stack = home.stack || []) : (player.leo = player.leo || []);
        targetArr.push({ id: slot.id, kind: 'colonist', face: 'primary' });
        humansHome++;
      }
      continue;
    }
    // A FUEL cargo card is bulk propellant, not a patent - it has no hand card
    // to return to (its id is a generated `fuel_N`, not a catalog id), so
    // pushing it to the hand would inject a phantom card that renders as
    // nothing. Decommissioning fuel DESTROYS it: the water/isotope is gone for
    // good, exactly like DUMP_FUEL_CARD. Counted separately so the log (and the
    // client's confirm) says "destroyed", never "returned to hand".
    if (isFuelCardSlot(slot)) {
      src.splice(idx, 1);
      fuelDestroyed += Math.max(0, Math.floor(Number(slot.amount) || 0));
      fuelCardsDestroyed++;
      continue;
    }
    src.splice(idx, 1);
    player.hand.push(id);
    if (player.rocket.activeThrusterId === id) player.rocket.activeThrusterId = null;
    if (player.rocket.activeProspectorId === id) player.rocket.activeProspectorId = null;
    returned++;
  }
  if (!returned && !crewToLeo && !robotsToHand && !humansHome && !fuelCardsDestroyed) return fail('nothing_decommissioned');
  if (from === 'rocket') { clipTank(player.rocket); recallIfEmpty(player); }
  const parts = [];
  if (returned) parts.push(`${returned} card${returned === 1 ? '' : 's'} to hand`);
  if (crewToLeo) parts.push(`${crewToLeo} crew to LEO (Felony)`);
  if (robotsToHand) parts.push(`${robotsToHand} Robot colonist${robotsToHand === 1 ? '' : 's'} scrapped to hand`);
  if (humansHome) parts.push(`${humansHome} Human colonist${humansHome === 1 ? '' : 's'} sent home (Felony)`);
  if (fuelCardsDestroyed) {
    parts.push(`${fuelCardsDestroyed} fuel cargo card${fuelCardsDestroyed === 1 ? '' : 's'}`
      + ` DESTROYED (${fuelDestroyed} FT lost for good)`);
  }
  let log = `${player.name} decommissioned ${parts.join(' and ')}.`;
  if (blocked) log += ` (${blocked} stayed - a Human decommission is a felony needing Anarchy, and crew already home at LEO / the Home Bernal cannot be recalled.)`;
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
  if (rocketAtLeo(state, player)) return fail('rocket_at_leo');     // use the LEO Stack instead
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
    // Copy each slot WHOLE. This used to whitelist id / kind / face / radSide,
    // which silently destroyed every other field a slot carries - most visibly a
    // fuel cargo card's `grade` and `amount`, so converting a rocket that was
    // holding canned water turned each fuel card into a 0-amount, 0-mass husk and
    // the water was simply gone. A whitelist here is also a trap for any field
    // added later, so copy the slot and let it carry everything it has (this is
    // what TRANSFER does - it splices the slot out and pushes the same object).
    cards: player.rocket.stack.map((s) => ({ ...s })),
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
  // Any water left in the tank (whole units or a sub-1 remainder) is
  // DESTROYED with the outpost rather than blocking the decommission - the
  // client warns before submitting so it's never a silent loss.
  const lostWater = Number(outpost.tank) || 0;
  delete player.outposts[letter];
  const waterTail = lostWater >= 1 ? ` (${Math.floor(lostWater)} water lost)`
    : lostWater > 0 ? ` (a ${Math.round(lostWater * 100) / 100} water remainder lost)` : '';
  return { ok: true, state, log: `${player.name} decommissioned Outpost ${letter}.${waterTail}` };
}

// Seed an EMPTY outpost at a site where you own a Factory (a free action). The
// cargo spin-off ("New outpost here") needs cards to move; this lets you set up
// a receiving cache at a factory you hold with no card in hand, e.g. to catch a
// unit riding down a Space Elevator. One outpost per site; capped at 4 total.
function applyCreateOutpost(state, op, player) {
  const siteId = op.siteId != null ? String(op.siteId) : null;
  if (!siteId) return fail('bad_outpost');
  const fac = state.factories && state.factories[siteId];
  if (!fac || String(fac.ownerId) !== String(player.profileId)) return fail('need_factory');
  if (Object.values(player.outposts || {}).some((o) => o && o.siteId === siteId)) return fail('outpost_exists_here');
  const taken = new Set(Object.keys(player.outposts || {}));
  const letter = OUTPOST_LETTERS.find((l) => !taken.has(l));
  if (!letter) return fail('no_outpost_slot');
  player.outposts = player.outposts || {};
  player.outposts[letter] = { letter, siteId, cards: [], tank: 0 };
  const where = (siteById(siteId) || {}).name || siteId;
  return { ok: true, state, log: `${player.name} set up Outpost ${letter} at ${where}.` };
}

// Pump water from a colocated Outpost into the rocket tank. The rocket
// must be parked at the outpost's site. Clamped by the outpost's water and
// the rocket's remaining wet-mass room. Free, turn-gated.
// op = { letter, amount }.
function applyTransferFuel(state, op, player) {
  // Generalised water transfer between any two colocated fuel endpoints
  // (rocket / bernalN / outpostX). Backward-compat: the rocket fuel-tank's
  // outpost section sends { letter, direction, amount } - map it onto from/to
  // so the existing rocket<->outpost path is unchanged.
  let from = op.from, to = op.to;
  if (!from && !to && op.letter != null) {
    const opp = 'outpost' + String(op.letter);
    if (op.direction === 'toOutpost') { from = 'rocket'; to = opp; }
    else { from = opp; to = 'rocket'; }
  }
  if (!from || !to || from === to) return fail('bad_transfer');
  const src = fuelEndpoint(state, player, from);
  const dst = fuelEndpoint(state, player, to);
  if (!src || !dst) return fail('bad_transfer');           // unknown / absent endpoint (e.g. no_bernal / no_outpost)
  // Colocated = same site, OR the two ends of a built Space Elevator (M1). Two
  // units both at LEO (site null) are colocated.
  if (src.site !== dst.site && !elevatorColocated(state, src.site, dst.site)) return fail('not_colocated');
  const want = Math.floor(Number(op.amount));
  if (!Number.isFinite(want) || want <= 0) return fail('bad_amount');
  // Only WATER moves stack-to-stack: dirt is field propellant that can't be
  // transferred, and water can't pour onto a dirt (or isotope) tank.
  if (src.getTank() > 0 && src.grade() !== 'water') return fail('cannot_store_dirt');
  if (dst.getTank() > 0 && dst.grade() !== 'water') return fail('cannot_mix_fuel');
  // Whole water units only; any sub-1 remainder stays in the source.
  const srcWhole = Math.floor(src.getTank());
  const room = Math.floor(Math.max(0, dst.cap - dst.getTank()));
  const amt = Math.min(want, srcWhole, room);
  if (amt <= 0) {
    if (room <= 0) return fail('tank_full');
    return fail('no_water');
  }
  src.setTank(src.getTank() - amt);
  dst.setTank(dst.getTank() + amt);
  if (dst.getTank() > 0) dst.setGrade('water');
  // Transferring the rocket's last water out of an empty stack decommissions it
  // (scraps back to LEO), so it can then be re-formed at a new site.
  if (from === 'rocket') recallIfEmpty(player);
  return {
    ok: true, state,
    log: `${player.name} pumped ${amt} water from ${src.label} into ${dst.label} (${dst.label} ${round6(dst.getTank())}).`,
  };
}

// Dirtside Ascent Operation (rule 2A7f). Move ANY AND ALL cards from a stack
// standing on a Dirtside UP to its cooperating anchored Bernal. This is an
// OPERATION (it spends the turn's operation), NOT a free Cargo Transfer.
// op = { from, bernalUnit? }:
//   from       - the source stack on the Dirtside: 'rocket' | 'freighter' |
//                'outpostA'..'outpostD'.
//   bernalUnit - optional target 'bernal0' | 'bernal1'; defaults to the anchored
//                Bernal the source's site is Dirtside to.
function applyDirtsideAscent(state, op, player) {
  if (!state.m2) return fail('m2_off');
  const from = String(op.from || '');
  const validSource = from === 'rocket' || from === 'freighter'
    || (from.startsWith('outpost') && ['A', 'B', 'C', 'D'].includes(from.slice('outpost'.length)));
  if (!validSource) return fail('bad_source');
  if (from === 'freighter' && !player.freighter) return fail('no_freighter');
  if (from.startsWith('outpost') && !(player.outposts && player.outposts[from.slice('outpost'.length)])) return fail('no_outpost');
  const srcArr = stackArrayOf(player, from);
  if (!srcArr) return fail('bad_source');
  // The source's current site (null = LEO, which is never a Dirtside).
  const srcSite = from === 'rocket' ? (player.rocket.siteId == null ? null : player.rocket.siteId)
    : from === 'freighter' ? (player.freighter.siteId == null ? null : player.freighter.siteId)
      : ((player.outposts[from.slice('outpost'.length)] || {}).siteId || null);
  if (srcSite == null) return fail('not_dirtside');
  // The cooperating Bernal: an anchored Bernal the source's site is Dirtside to.
  let bn = null;
  if (op.bernalUnit != null) {
    bn = (player.bernals || [])[Number(String(op.bernalUnit).slice('bernal'.length)) || 0] || null;
    if (!bn || !bn.anchored || !bernalDirtsides(state, bn, player).includes(srcSite)) return fail('not_dirtside');
  } else {
    bn = playerBernalDirtsideAt(state, player, srcSite);
    if (!bn) return fail('not_dirtside');
  }
  if (!srcArr.length) return fail('nothing_to_ascend');
  if (player.opsRemaining <= 0) return fail('no_ops_left');
  // Move ALL cards up to the Bernal stack (order preserved).
  bn.stack = bn.stack || [];
  const moved = srcArr.splice(0, srcArr.length);
  for (const s of moved) bn.stack.push(s);
  // If the rocket was emptied, drop its now-dangling active pointers and let it
  // scrap / re-form per the normal empty-stack rule.
  if (from === 'rocket') {
    if (player.rocket.activeThrusterId && !srcArr.some((s) => s.id === player.rocket.activeThrusterId)) player.rocket.activeThrusterId = null;
    if (player.rocket.activeProspectorId && !srcArr.some((s) => s.id === player.rocket.activeProspectorId)) player.rocket.activeProspectorId = null;
    recallIfEmpty(player);
  }
  player.opsRemaining -= 1;
  const site = siteById(srcSite);
  const bnName = (PATENTS_BY_ID[bn.cardId] || {}).name || 'the Bernal';
  return {
    ok: true, state,
    log: `${player.name} ascended ${moved.length} card${moved.length === 1 ? '' : 's'} from ${(site && site.name) || srcSite} up to ${bnName}.`,
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

// Engage afterburn. The active thruster, if it carries the afterburn icon, may
// expend fuel steps to gain net thrust for the whole rocket this turn, plus 1
// Therm of rocket-wide Open-Cycle cooling (applied client-side, where cooling
// is gated). Two flavours, keyed off the thruster type:
//   - MW (normal) afterburn: spend the card's afterburn-count FUEL STEPS for a
//     fixed +1 net thrust (the count is the COST).
//   - GW/TW afterburn (card.type 'gw-thruster'): spend exactly 1 fuel step EVER
//     for +afterburn-count net thrust (the count is the THRUST GAINED, not the
//     cost). This inverts the MW formula.
// Once per turn - it lasts the turn and clears when the player's next turn opens
// (openTurnFor). Free action (no operation), turn-gated. op = {}.
function applyAfterburn(state, _op, player) {
  if (player.rocket.afterburnEngaged) return fail('already_afterburned');
  const tid = player.rocket.activeThrusterId;
  const slot = tid && player.rocket.stack.find((s) => s.id === tid);
  if (!slot) return fail('no_thruster');
  const f = thrusterFaceOf(slot);
  const n = Number(f.afterburn) || 0;
  if (n <= 0) return fail('no_afterburn');
  const card = PATENTS_BY_ID[tid];
  const isGw = !!(card && card.type === 'gw-thruster');
  // Afterburn spends from the tank, so it must be the thruster's OWN fuel grade:
  // a GW/TW (isotope) thruster can't afterburn on water or dirt, and a chemical
  // thruster can't burn isotope. MOVE already enforces this; the afterburn is a
  // second fuel spend that must too (water must never power an isotope thruster).
  const need = activeFuelGrade(player.rocket);
  const have = tankGradeOf(player.rocket);
  if (!fuelCompatible(need, have)) return fail('wrong_fuel_grade', { need, have });
  // GW/TW spend exactly 1 fuel step for +n thrust; MW spend n steps for +1.
  const cost = isGw ? 1 : n;
  const gain = isGw ? n : 1;
  // Cost: walk the wet chit `cost` black connections down the fuel ladder
  // (same fuel-step model as a burn), leaving a fractional remainder.
  const dryMass = rocketDryMass(player.rocket.stack.reduce((m, s) => m + slotMass(s), 0));
  const wetMass = dryMass + (Number(player.rocket.tank) || 0);
  const stepsAvail = blackStepsBetween(dryMass, wetMass);
  if (cost > stepsAvail) {
    return fail('insufficient_water', { fuelStepsNeeded: cost, fuelStepsAvailable: stepsAvail });
  }
  player.rocket.tank = round6(walkBlackDown(wetMass, cost) - dryMass);
  player.rocket.afterburnEngaged = true;
  return {
    ok: true, state,
    log: `${player.name} engaged afterburn on ${card ? card.name : tid} (spent ${cost} fuel step${cost === 1 ? '' : 's'} for +${gain} net thrust + Open-Cycle cooling this turn).`,
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

// Resolve which of the player's stacks a prospect is fired from. Returns a
// normalized unit { stackId, stack, siteId, activeId } or null (unknown /
// module-off / missing stack). Only the rocket persists an activeProspectorId;
// every other stack names its prospector explicitly on the op (op.prospectorId),
// so no per-stack active field / hydration migration is needed. Freighter is
// M1, bernals are M2 - a null unit for an off-module stack is the server gate
// (never trust the client for the module gate).
function resolveProspectUnit(state, player, stackId) {
  const sid = String(stackId || 'rocket');
  if (sid === 'rocket') {
    return { stackId: 'rocket', stack: player.rocket.stack, siteId: player.rocket.siteId,
      activeId: player.rocket.activeProspectorId };
  }
  if (sid === 'freighter') {
    if (!state.m1 || !player.freighter) return null;
    return { stackId: 'freighter', stack: player.freighter.stack || [],
      siteId: player.freighter.siteId, activeId: null };
  }
  if (sid.startsWith('bernal')) {
    if (!state.m2) return null;
    const bn = (player.bernals || [])[Number(sid.slice('bernal'.length)) || 0];
    if (!bn) return null;
    return { stackId: sid, stack: bn.stack || [], siteId: bn.siteId, activeId: null };
  }
  if (sid.startsWith('outpost')) {
    const letter = sid.slice('outpost'.length);
    const outp = (player.outposts || {})[letter];
    if (!outp) return null;
    // Outposts store their cards under `.cards` (not `.stack`) and have no wiring.
    return { stackId: sid, stack: outp.cards || [], siteId: outp.siteId, activeId: null };
  }
  return null;
}

function applyProspect(state, op, player) {
  const toSiteId = String(op.siteId || '');
  const site = siteById(toSiteId);
  if (!site) return fail('unknown_site');
  const unit = resolveProspectUnit(state, player, op.stackId);
  if (!unit) return fail('no_prospector');
  // The rocket falls back to its persisted active prospector; every other stack
  // names the prospector card explicitly on the op.
  const provId = String(op.prospectorId || unit.activeId || '');
  const provSlot = provId && unit.stack.find((s) => s.id === provId);
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
  const here = unit.siteId;
  const buggyRoams = kind === 'buggy' && isBuggyRoamBody(siteBodyOf(here));
  if (kind === 'raygun') {
    const reachable = toSiteId === here || lineOfSightSites(here).has(toSiteId);
    if (!reachable) return fail('raygun_out_of_range');
  } else if (buggyRoams) {
    const reachable = toSiteId === here || buggyRoamSites(here).has(toSiteId);
    if (!reachable) return fail('buggy_out_of_range');
  } else if (here !== toSiteId) {
    return fail('not_at_site');
  }
  if (existing) return fail('already_prospected');
  // Colocated modifier cards (subsystems 2 + 3): scan the PROSPECTING stack (the
  // rocket, or the freighter / bernal / outpost the prospect fires from).
  const colocatedPowers = unit.stack.map(powerOfSlot);
  const isruMod = sumColocatedIsruMod(colocatedPowers, { isAerostat: isAerostatSite(site) });
  const effIsru = Math.max(0, prospectorIsru(provSlot) + isruMod);   // isruMod <= 0 (easier), floored at 0
  // Atmospheric Scoop (subsystem 5) can raise an aerostat site to hydration 2.
  if (effIsru > (effectiveHydration(site, player, unit) | 0)) return fail('isru_too_high');

  // Luna Treaty (base multiplayer rule): only the FIRST PLAYER may prospect a
  // Luna-body site freely. Any other player needs the first player's granted
  // permission (LUNA_ACCESS ops), or must do it as a Felony. A no-op in solo -
  // the sole player is always the first player.
  let lunaFelony = false;
  if ((state.players || []).length >= 2 && String(site.body || '') === 'Luna') {
    const fp = state.players[state.firstPlayerIndex || 0];
    const isFirst = fp && fp.profileId === player.profileId;
    const granted = !!(state.lunaGrants && state.lunaGrants[String(player.profileId)]);
    if (!isFirst && !granted) {
      if (mayCommitFelony(state, player)) lunaFelony = true;
      else return fail('luna_treaty');
    }
  }

  // Prospecting is one operation to BEGIN: the first prospect of the turn
  // (any kind) spends the operation. Once begun, a raygun's line-of-sight scan
  // is free and unlimited - and a roaming buggy (on a connected body) scans the
  // same body for free too, since it acts as a raygun there. A missile, or a
  // buggy NOT on a roam body, always costs the operation (it IS the operation),
  // so once the turn's op is spent it can never fire a free additional scan.
  const begun = hasProspectedThisTurn(state);
  let free = begun && (kind === 'raygun' || buggyRoams);
  // Prospector colonist (2C1b): each one colocated with the PROSPECTING stack
  // performs one free prospect (or promotion) per turn. The colonist grants the
  // free operation from where it sits (with the raygun / buggy); the prospector
  // card's own reach picks the target, so a raygun scanning a line-of-sight site
  // or a buggy road-scanning a connected site (the yellow dashed roads) is still
  // free - the colonist need not be at the remote target, only with the
  // prospector at `here`. Prefer the freebie so the turn's operation stays open.
  let freeViaColonist = false;
  if (!free && canColonistFreeOp(state, player, here, 'Prospector')) {
    free = true; freeViaColonist = true;
  }
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
  const sizeMod = sumColocatedSizeRollMod(colocatedPowers, { spectral: site.spectralType, prospectorKind: kind })
    // Colonist size-roll powers (M2): Rental Body Guild -1, Svalbard -1 on
    // Synodic Sites, Wet-Nano -2 / Eugenic Pilgrims -1 on Synodic Comets.
    + colonistSizeRollModAt(state, player, toSiteId);
  const gen = makeRng(state.seed, state.rng.cursor);
  // Tutorial forces the prospect die (a queued 1 auto-claims); a normal game
  // rolls the seeded generator. tutorialD6 only diverts when state.tutorial.
  const roll = tutorialD6(state, gen);
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
  else if (freeViaColonist) spendColonistFreeOp(player, 'Prospector');
  const verb = success ? 'struck a claim at' : 'came up dry at';
  const tail = freeViaColonist ? ' with a prospector colonist\'s free scan'
    : free ? (buggyRoams ? ' with a free buggy road scan' : ' with a free raygun scan') : '';
  const rollText = sizeMod ? `${roll}${sizeMod > 0 ? '+' : ''}${sizeMod} = ${effRoll}` : `${roll}`;
  let log = `${player.name} rolled ${rollText} vs ${threshold} and ${verb} ${site.name}${tail}.`;
  if (lunaFelony) log += ' (Luna Treaty Felony - prospected Luna without the first player\'s leave.)';
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
  // The build set may live on the ROCKET stack or in an OUTPOST parked at the
  // site (op.from = 'rocket' | 'outpostX'), mirroring PROMOTE. Whichever stack
  // holds the cards must itself be AT the site.
  const from = String(op.from || 'rocket');
  let srcStack = null, srcSiteId = null;
  if (from === 'rocket') { srcStack = player.rocket.stack; srcSiteId = player.rocket.siteId; }
  else if (from.startsWith('outpost')) {
    const o = player.outposts && player.outposts[from.slice('outpost'.length)];
    if (o) { srcStack = o.cards; srcSiteId = o.siteId; }
  }
  if (!srcStack) return fail('no_outpost');
  if (srcSiteId !== siteId) return fail('not_at_site');
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
    const slot = srcStack.find((s) => s.id === id && s.kind !== 'crew');
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
  // action (no operation spent). Colocated = anywhere in the building stack.
  let freeAction = srcStack.some((s) => {
    const pw = powerOfSlot(s);
    return pw && pw.industrializeFreeAction;
  });
  // Industrialist colonist (2C1): each one colocated grants one free
  // Industrialize (or Anchoring) per turn.
  let freeViaColonist = false;
  if (!freeAction && canColonistFreeOp(state, player, siteId, 'Industrialist')) {
    freeAction = true; freeViaColonist = true;
  }
  if (!freeAction && player.opsRemaining <= 0) return fail('no_ops_left');
  // Decommission the chain to the hand (from whichever stack held it).
  for (const id of ids) {
    const idx = srcStack.findIndex((s) => s.id === id);
    if (idx >= 0) {
      srcStack.splice(idx, 1);
      player.hand.push(id);
    }
  }
  // Only the rocket carries active thruster / prospector pointers; clear them if
  // a rocket build decommissioned the active card. An outpost build never does.
  if (from === 'rocket') {
    if (player.rocket.activeThrusterId && !player.rocket.stack.some((s) => s.id === player.rocket.activeThrusterId)) {
      player.rocket.activeThrusterId = null;
    }
    if (player.rocket.activeProspectorId && !player.rocket.stack.some((s) => s.id === player.rocket.activeProspectorId)) {
      player.rocket.activeProspectorId = null;
    }
  }
  const spectral = site.spectralType || 'C';
  state.factories[siteId] = { ownerId: player.profileId, spectralType: spectral };
  // M1: name the cube for the Mobile Factory fleet (1B6); harmless field that
  // only the M1 mobile-factory UI reads (gated so an M1-off game is unchanged).
  if (state.m1) state.factories[siteId].tag = nextFactoryTag(state, player.profileId);
  if (!freeAction) player.opsRemaining -= 1;
  else if (freeViaColonist) spendColonistFreeOp(player, 'Industrialist');
  let log = `${player.name} industrialized ${site.name} (spectral ${spectral}); decommissioned ${ids.length} card${ids.length === 1 ? '' : 's'} to hand.`;
  if (arcology && !hasRobonaut) log += ' (Arcology: no robonaut needed.)';
  if (freeViaColonist) log += ' (Industrialist colonist: free action.)';
  else if (freeAction) log += ' (Jellybots: free action.)';
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
  // V9 Sirens: the claims the variant seeds at setup (both Luna sites, the
  // Uranus Aerostat, Cordelia) "cannot be re-prospected with special abilities".
  // Checked BEFORE the Termite Nest requirement, because "this claim can never
  // be revived" is the more useful answer than "you lack the card" - the card
  // would not help. They carry busted:'sirens' so a claim a player actually
  // busted in play is unaffected and stays revivable.
  const seededDisc = state.discs[siteId];
  if (seededDisc && seededDisc.busted === 'sirens') return fail('siren_busted_claim');
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
  // Engineer colonist (2C1d): one EXTRA product per engineer colocated with
  // this factory - repeats of the operation ride free this turn, up to that
  // count. The first produce still spends the turn's operation.
  const priorProduces = (state.turnActions || []).filter((a) => a && a.kind === 'ET_PRODUCE'
    && a.payload && String(a.payload.siteId) === siteId).length;
  const engineerN = colonistSpecialistsAt(state, player, siteId, 'Engineer');
  const engineerRepeat = priorProduces >= 1 && priorProduces <= engineerN;
  if (!engineerRepeat && player.opsRemaining <= 0) return fail('no_ops_left');
  const cardId = String(op.cardId || '');
  const hIdx = player.hand.indexOf(cardId);
  const prodCard = PATENTS_BY_ID[cardId];
  // M1 Freighter: producing a freighter card spawns the player's Freighter
  // UNIT (the big cube) at this Factory's site, NOT a card in an outpost. One
  // freighter per player (1A4). Gated on M1 (zero bleed-through when off). A
  // Freighter is only ever produced from a HAND card (it spawns the big cube).
  if (prodCard && prodCard.type === 'freighter') {
    if (hIdx < 0) return fail('not_in_hand');
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
  // M2: ET-producing a hand ROBOT colonist BUILDS the colonist (2C2b
  // Downsizing): it enters play Black-Side-up at this factory and counts
  // toward the colonist limit - if that puts you over, name a colonist to
  // downsize (op.downsizeColonistId; a retired Human queues, a Robot returns
  // to hand). Humans are never hand cards, so only Robots build this way.
  if (prodCard && prodCard.type === 'colonist') {
    if (!state.m2) return fail('m2_off');
    if (hIdx < 0) return fail('not_in_hand');
    if (prodCard.colonistKind !== 'Robot') return fail('humans_not_buildable');
    const cLetter = String(op.letter || '');
    if (!OUTPOST_LETTERS.includes(cLetter)) return fail('bad_outpost');
    player.outposts = player.outposts || {};
    let cOutpost = player.outposts[cLetter];
    if (!cOutpost) cOutpost = player.outposts[cLetter] = { letter: cLetter, siteId, cards: [], tank: 0 };
    else if (cOutpost.siteId !== siteId) return fail('not_colocated');
    let downNote = '';
    if (countColonists(player) + 1 > colonistAllowance(player)) {
      const downId = op.downsizeColonistId != null ? String(op.downsizeColonistId) : null;
      if (!downId) return fail('colonist_limit_downsize');
      let loc = null;
      for (const e of colonistLocations(player)) {
        if (e.slot.id === downId) { loc = e; break; }
      }
      if (!loc) return fail('bad_downsize');
      removeColonistSlot(player, loc);
      downNote = ` Downsized: ${retireColonistId(state, player, downId)}.`;
    }
    player.hand.splice(hIdx, 1);
    cOutpost.cards.push({ id: cardId, kind: 'colonist', face: 'primary' });
    if (!engineerRepeat) player.opsRemaining -= 1;
    return {
      ok: true, state,
      log: `${player.name} ET-produced ${prodCard.name} (Robot colonist) at ${site.name} into Outpost ${cLetter}.${downNote}`,
    };
  }
  // ET Produce consumes a WHITE-side card from the HAND or from any card
  // COLOCATED at this factory: the player's rocket parked here, or a colocated
  // outpost. The product lands Black-Side-up in the target outpost. (User
  // 2026-07-01: a colocated card can be ET-produced, not only a hand card.)
  let removeSource = null;
  let fromRocket = false;
  if (hIdx >= 0) {
    removeSource = () => player.hand.splice(hIdx, 1);
  } else {
    const rk = player.rocket;
    if (rk && rk.siteId === siteId && Array.isArray(rk.stack)) {
      const i = rk.stack.findIndex((s) => s.id === cardId && s.face !== 'secondary');
      if (i >= 0) { removeSource = () => rk.stack.splice(i, 1); fromRocket = true; }
    }
    if (!removeSource) {
      for (const o of Object.values(player.outposts || {})) {
        if (o.siteId !== siteId) continue;
        const i = (o.cards || []).findIndex((c) => c.id === cardId && c.face !== 'secondary');
        if (i >= 0) { removeSource = () => o.cards.splice(i, 1); break; }
      }
    }
  }
  if (!removeSource) return fail('not_colocated_card');
  // M2 Core Rule Addenda (e) + I8: producing at a Dirtside Factory may deliver
  // the Black-Side product UP to one of the player's own Anchored Bernals the
  // Factory is Dirtside to. The player chooses where it lands:
  //   op.toBernal, no op.letter  -> the Bernal's own component stack.
  //   op.toBernal + op.letter    -> an Outpost at the Bernal's Space (its own
  //                                 Space, created there if new).
  //   default + op.letter        -> an Outpost at the Factory's site (as before).
  let bernalDest = null;
  let toBernalStack = false;
  let letter = null;
  let outpost = null;
  if (op.toBernal && state.m2) {
    bernalDest = playerBernalDirtsideAt(state, player, siteId);
    if (!bernalDest) return fail('not_dirtside');
  }
  if (bernalDest && !op.letter) {
    toBernalStack = true;
  } else {
    // An outpost destination: the Bernal's Space (bernalDest) or the Factory's
    // site (default). Same slot resolution; only the required colocation differs.
    const outpostSite = bernalDest ? bernalDest.siteId : siteId;
    letter = String(op.letter || '');
    if (!OUTPOST_LETTERS.includes(letter)) return fail('bad_outpost');
    player.outposts = player.outposts || {};
    outpost = player.outposts[letter];
    if (!outpost) {
      outpost = player.outposts[letter] = { letter, siteId: outpostSite, cards: [], tank: 0 };
    } else if (outpost.siteId !== outpostSite) {
      return fail('not_colocated');
    }
  }
  removeSource();
  // Pulling a card out of the rocket may orphan the active thruster / prospector
  // pointer - clear it if it named the produced card, matching DECOMMISSION.
  if (fromRocket) {
    const rk = player.rocket;
    if (rk.activeThrusterId === cardId) rk.activeThrusterId = null;
    if (rk.activeProspectorId === cardId) rk.activeProspectorId = null;
  }
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
  if (toBernalStack) { bernalDest.stack = bernalDest.stack || []; bernalDest.stack.push(produced); }
  else outpost.cards.push(produced);
  if (!engineerRepeat) player.opsRemaining -= 1;
  // Isostandard (1Cb): ET-producing a GW/TW thruster in space sets that
  // thruster's spectral value as one of the player's isostandards, which is what
  // later unlocks a Luna anchor (2Ba). Dedup; harmless when the card has no
  // spectral type.
  let isoNote = '';
  if (card && card.type === 'gw-thruster' && card.spectralType) {
    player.isostandards = player.isostandards || [];
    if (!player.isostandards.includes(card.spectralType)) {
      player.isostandards.push(card.spectralType);
      isoNote = ` Spectral ${card.spectralType} is now an isostandard.`;
    }
  }
  const engineerTail = engineerRepeat ? ' (Engineer colonist: extra product)' : '';
  const destNote = toBernalStack ? 'the Bernal Stack'
    : (bernalDest ? `Outpost ${letter} at the Bernal` : `Outpost ${letter}`);
  return {
    ok: true, state,
    log: `${player.name} ET-produced ${card ? card.name : cardId} (Black-Side) at ${site.name} into ${destNote}${engineerTail}.${isoNote}`,
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
// Move every Seniority Disk on the assembly onto a single space (Supreme Cult
// Future: "All Seniority Disks migrate to authority"). Returns the number of
// discs moved. Centrist has no discs; the total is preserved.
function migrateSeniorityTo(state, place) {
  const asm = assemblyOf(state);
  asm.seniority = asm.seniority || {};
  let total = 0;
  for (const p of ASSEMBLY_PLACES) total += (asm.seniority[p] | 0);
  for (const p of ASSEMBLY_PLACES) asm.seniority[p] = 0;
  asm.seniority[place] = total;
  return total;
}
function placeCount(asm, place, profileId) {
  return playerDelegatesInPlace(asm, place, profileId);
}
function setPlaceCount(asm, place, profileId, count) {
  const m = asm.delegates[place] || (asm.delegates[place] = {});
  if (count > 0) m[profileId] = count; else delete m[profileId];
}
// Place ONE delegate of `ideo` for `player`, respecting the 7-cube supply
// limit (silently a no-op once the supply is exhausted, same as the
// exomigration delegate below). Shared by any M0 rule that grants a
// delegate outside the Fundraise operation - Colony Build's G3c delegate.
function grantDelegate(state, player, ideo) {
  if (!ideo || cubesInPlay(state, player.profileId) >= FACTORY_CUBES) return false;
  const asm = assemblyOf(state);
  setPlaceCount(asm, ideo, player.profileId, placeCount(asm, ideo, player.profileId) + 1);
  return true;
}
// Move the active-law star onto a single clear winner, silently (no player
// choice on a tie - mid-op rule triggers can't pause for a pick). This is the
// "quiet" half of the vote tally (O3a); the full Fundraise-style tally that
// resolves ties via the fundraiser's own choice lives in applyFundraise.
function quietVoteTally(state) {
  const asm = assemblyOf(state);
  const winners = voteWinners(asm);
  if (winners.length === 1 && winners[0] !== state.activeLawStar) {
    state.activeLawStar = winners[0];
    return (IDEOLOGY_BY_KEY[winners[0]] || {}).name || winners[0];
  }
  return null;
}
// Is ideology `key`'s law in force right now (resolver verdict)? A solo game
// runs the Solitaire assembly, so the resolver skips the base-Unity cascade.
function lawInForce(state, key) {
  return activeLaws(assemblyOf(state), state.activeLawStar, !!state.ceoSolo, !!state.anarchy).active.has(key);
}
// May `player` benefit from ideology `key`'s law this turn? Per O3b/O5 an ACTIVE
// law (the gold star, plus every Law Unity also activates) "may be used by any
// Faction on their Turn" and "modifies rules for all players": no delegate in
// the wedge is required to USE it (delegates decide which law is ACTIVE, via the
// vote tally, and drive end-game awards). The only other path is an INACTIVE
// law the player Lobbied this turn (O4: pay 1 aqua + discard a delegate there).
function playerCanUseLaw(state, player, key) {
  if (lawInForce(state, key)) return true;
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
  // The Sunspot / first-player cube occupies one of the holder's 7. CEO
  // Solitaire has no first-player race, so no cube sits on the marker - the
  // solo CEO keeps all 7 for factories + delegates.
  if (!state.ceoSolo) {
    const fp = state.players[state.firstPlayerIndex || 0];
    if (fp && fp.profileId === profileId) n += 1;
  }
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
  // Cube supply: factories + assembly delegates share the 7 cubes. If the pool
  // is full when you want to PLACE a new delegate, you may FREE a cube by
  // removing one of your delegates from ANY space on the politics mat
  // (op.freeDelegate = the place to pull it from), the same escape hatch the
  // factory build offers. Without it a full pool is a hard cap. (User 2026-07-07.)
  let freedPlace = null;
  if (place && cubesInPlay(state, pid) >= FACTORY_CUBES) {
    const free = op.freeDelegate ? String(op.freeDelegate) : null;
    if (free && ASSEMBLY_PLACES.includes(free) && placeCount(asm, free, pid) > 0) {
      setPlaceCount(asm, free, pid, placeCount(asm, free, pid) - 1);
      freedPlace = free;
    } else {
      return fail('no_cubes_left');
    }
  }
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
  // Authority (Martial Law) discard is applied AFTER the vote tally below (O3a):
  // the discarded cube still counts in the tally, and moving the Active Law INTO
  // Authority via this fundraise enables the discard that same turn.
  let martial = '';
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
  // Martial Law (Authority): RIGHT AFTER the tally (O3a), the fundraiser may
  // additionally discard one opponent's delegate. Eligibility is checked against
  // the NEW Active Law, so a fundraise that just moved the star INTO Authority
  // (or a lobbied Authority) lets you remove a delegate this same turn. The
  // discarded cube already counted in the tally above.
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
  const parts = [];
  if (place) {
    parts.push(freedPlace
      ? `moved a delegate from ${placeName(freedPlace)} to ${placeName(place)}`
      : `placed a delegate on ${placeName(place)}`);
  }
  if (moveFrom) parts.push(`moved a delegate ${placeName(moveFrom)} -> ${placeName(moveTo)}`);
  const did = parts.length ? parts.join(' and ') : 'took income';
  const starNote = starMoved
    ? ` The active-law star moves to ${newStar === 'centrist' ? 'the center' : placeName(newStar)}.`
    : '';
  return {
    ok: true, state,
    log: `${player.name} fundraised - ${did}, +${gain} aqua${honor ? ' (Honor: per glory chit)' : ''}.${starNote}${martial}`,
  };
}

// Lobby (M0 free action, once per turn): pay 1 aqua and discard a delegate in an
// INACTIVE ideology to use its Law this turn. Disabled while Unity's UN General
// Assembly law is in force.
function applyLobby(state, op, player) {
  if (!state.m0) return fail('not_m0');
  const asm = assemblyOf(state);
  const solo = !!state.ceoSolo;
  const laws = activeLaws(asm, state.activeLawStar, solo, !!state.anarchy);
  if (laws.lobbyingDisabled) return fail('lobbying_disabled');
  if (player.lobbiedThisTurn) return fail('already_lobbied');
  const key = String(op.ideology || '');
  if (!IDEOLOGY_ORDER.includes(key)) return fail('bad_ideology');
  if (laws.active.has(key)) return fail('law_already_active');
  if (placeCount(asm, key, player.profileId) <= 0) return fail('no_delegate_there');
  // Solitaire Unity (Sol Unification): lobbying costs 0 aqua while it is in force.
  const freeLobby = solo && laws.active.has('unity');
  if (!freeLobby && (player.aqua | 0) < 1) return fail('insufficient_aqua');
  if (!freeLobby) player.aqua -= 1;
  // Supreme Cult Future: lobby without removing the delegate used.
  const keepDelegate = hasFutureEffect(player, 'lobbyKeepDelegate');
  if (!keepDelegate) setPlaceCount(asm, key, player.profileId, placeCount(asm, key, player.profileId) - 1);
  player.lobbiedLaws = Array.isArray(player.lobbiedLaws) ? player.lobbiedLaws : [];
  if (!player.lobbiedLaws.includes(key)) player.lobbiedLaws.push(key);
  player.lobbiedThisTurn = true;
  return {
    ok: true, state,
    log: `${player.name} lobbied ${key} - ${freeLobby ? 'free (Sol Unification)' : 'paid 1 aqua'} and ${keepDelegate ? 'kept the delegate (Supreme Cult)' : 'discarded a delegate'} to use its Law this turn.`,
  };
}

// Does the player currently OWN a GW/TW thruster of this spectral type anywhere
// in play (it need NOT be aboard the rocket)? Gates isotope-CARD production: you
// can only refine a spectral you have an engine for. GW thrusters promote to a
// TW on their purple back but keep the same card + spectral, so type
// 'gw-thruster' covers both faces.
function playerOwnsGwOfSpectral(player, spectral) {
  const spec = spectral || 'C';
  const scan = (slots) => (slots || []).some((s) => {
    const c = s && PATENTS_BY_ID[s.id];
    return c && c.type === 'gw-thruster' && (c.spectralType || 'C') === spec;
  });
  if (scan(player.rocket && player.rocket.stack)) return true;
  if (scan(player.leo)) return true;
  if (player.freighter && scan(player.freighter.stack)) return true;
  for (const o of Object.values(player.outposts || {})) if (o && scan(o.cards)) return true;
  for (const bn of (player.bernals || [])) if (bn && scan(bn.stack)) return true;
  return false;
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

  // Isotope-CARD production (M1): the SAME refined-isotope action as the tank
  // Isotope Refuel below, but the output is a movable fuel CARGO CARD placed in
  // the outpost here - so the GW/TW thruster need NOT be present (stockpile it,
  // transfer it to the rocket later). Reuses the Miner/Alchemist/Futures
  // modifiers via siteRefuelGate + the same spectral gate; the factory's spectral
  // IS the fuel's spectral, and the player must OWN a GW/TW of that spectral.
  // Additional production increments the existing same-spectral card by the gain.
  // op = { siteId, mode:'isotope', outpost:<letter> }.
  if (op.mode === 'isotope' && op.outpost) {
    if (!state.m1) return fail('m1_off');
    const letter = String(op.outpost);
    const outpost = player.outposts && player.outposts[letter];
    if (!outpost || outpost.siteId !== siteId) return fail('no_outpost');
    const fac = state.factories[siteId];
    if (!canUseFactoryNonVictory(state, player, fac)) return fail('no_factory');
    const facSpectral = site.spectralType || 'C';
    if (!playerOwnsGwOfSpectral(player, facSpectral)) return fail('no_matching_gw', { spectral: facSpectral });
    const gate = siteRefuelGate(state, player, siteId);
    if (!gate.ok) return fail('already_refueled');
    if (!gate.freeRepeat && player.opsRemaining <= 0) return fail('no_ops_left');
    // Same yield as the tank Isotope Refuel: base 1, doubled by the relevant
    // Futures and again by a colocated Alchemist Aviatrices colonist.
    let iBase = hasFutureEffect(player, 'doubleIsotopeRefuel') ? 2 : 1;
    const alchemist = (state.m2 && [...colonistLocations(player)].some((e) => {
      const pw = colonistSlotPower(e.slot);
      return e.siteId === siteId && pw && pw.doubleIsotopeRefuel;
    }));
    if (alchemist) iBase *= 2;
    outpost.cards = outpost.cards || [];
    // Increment an existing isotope card of THIS spectral in the outpost, else
    // mint a new one (grades / spectrals never merge).
    const existing = outpost.cards.find((s) => s && s.kind === 'fuel'
      && s.grade === 'isotope' && (s.spectral || 'C') === facSpectral);
    if (existing) existing.amount = (Number(existing.amount) || 0) + iBase;
    else outpost.cards.push({ id: nextFuelCardId(state), kind: 'fuel', grade: 'isotope', spectral: facSpectral, amount: iBase, face: 'primary' });
    player.refueledSites.push(siteId);
    if (!gate.freeRepeat) player.opsRemaining -= 1;
    let monetizeNote = '';
    if (!state.isotopeMonetized) { state.isotopeMonetized = true; monetizeNote = ' Isotope is now monetized.'; }
    const minerTail = gate.freeRepeat ? ' (Miner colonist: extra production)' : '';
    return {
      ok: true, state,
      log: `${player.name} refined +${iBase} spectral-${facSpectral} isotope into a fuel card at ${site.name} (Outpost ${letter})${minerTail}.${monetizeNote}`,
    };
  }

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
    const gateO = siteRefuelGate(state, player, siteId);
    if (!gateO.ok) return fail('already_refueled');
    if (!gateO.freeRepeat && player.opsRemaining <= 0) return fail('no_ops_left');
    const odry = (outpost.cards || []).reduce((m, s) => m + slotMass(s), 0);
    const ocap = Math.max(0, TANK_MAX - odry);
    const otank = Number(outpost.tank) || 0;
    if (otank >= ocap) return fail('tank_full');
    const gain = Math.min(7, ocap - otank);
    if (gain <= 0) return fail('tank_full');
    outpost.tank = round6(otank + gain);
    player.refueledSites.push(siteId);
    if (!gateO.freeRepeat) player.opsRemaining -= 1;
    const minerTailO = gateO.freeRepeat ? ' (Miner colonist: extra refuel)' : '';
    return {
      ok: true, state,
      log: `${player.name}: Factory-Refuel at ${site.name} (+${round6(gain)} water into Outpost ${letter}; tank ${round6(outpost.tank)})${minerTailO}.`,
    };
  }

  // 2A7: the rocket may run a Factory's operations either parked on the site or
  // docked at one of its own Anchored Bernals that is Dirtside to it.
  if (!rocketColocatedWithSite(state, player, siteId)) return fail('not_at_site');

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
    const gateI = siteRefuelGate(state, player, siteId);
    if (!gateI.ok) return fail('already_refueled');
    if (!gateI.freeRepeat && player.opsRemaining <= 0) return fail('no_ops_left');
    const idry = rocketDryMass(player.rocket.stack.reduce((m, s) => m + slotMass(s), 0));
    const icap = Math.max(0, TANK_MAX - idry);
    const itank = Number(player.rocket.tank) || 0;
    // Isotope can't top up a water/dirt tank, and vice versa (no mixing).
    if (itank > 0 && tankGradeOf(player.rocket) !== 'isotope') return fail('cannot_mix_fuel');
    if (itank >= icap) return fail('tank_full');
    // Isotope refines slowly: at most 1 isotope FT per turn at a Factory (unlike
    // water's flat +7). The per-site-per-turn lock already caps it to one op.
    // Several completed Futures (Mini-Black Hole / Protium Fusion / Fusion
    // Candle / Antimatter) double every isotope refuel, and a colocated
    // Alchemist Aviatrices colonist doubles it again.
    let iBase = hasFutureEffect(player, 'doubleIsotopeRefuel') ? 2 : 1;
    const alchemist = (state.m2 && [...colonistLocations(player)].some((e) => {
      const pw = colonistSlotPower(e.slot);
      return e.siteId === siteId && pw && pw.doubleIsotopeRefuel;
    }));
    if (alchemist) iBase *= 2;
    const iroom = redStepsBetween(idry + itank);
    const isteps = Math.min(iBase, iroom);
    if (isteps <= 0) return fail('tank_full');
    const ires = loadFuelUpLadder(idry, itank, isteps);   // walk the red line, land on a node
    const igain = round6(ires.tank - itank);
    player.rocket.tank = ires.tank;
    player.rocket.tankGrade = 'isotope';
    player.rocket.tankSpectral = thrSpectral;   // the tank now holds this spectral's isotope
    player.refueledSites.push(siteId);
    if (!gateI.freeRepeat) player.opsRemaining -= 1;
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

  // M2 Core Rule Addenda (d): a Factory Refuel at a site Dirtside to one of
  // the player's own Anchored Bernals may deliver the water straight into
  // that Bernal's tank instead of the rocket's - the crawler tops up without
  // a separate cargo-transfer trip. Opt-in via op.toBernal; only the FACTORY
  // mode qualifies (ISRU / isotope refuel, handled above, keep filling the
  // rocket - they need the rocket's own prospector or GW thruster present).
  let bernalDest = null;
  if (op.mode === 'factory' && op.toBernal && state.m2) {
    bernalDest = playerBernalDirtsideAt(state, player, siteId);
    if (!bernalDest) return fail('not_dirtside');
  }
  const gateW = siteRefuelGate(state, player, siteId);
  if (!gateW.ok) return fail('already_refueled');
  if (!gateW.freeRepeat && player.opsRemaining <= 0) return fail('no_ops_left');
  const dry = bernalDest ? bernalDryMass(bernalDest)
    : rocketDryMass(player.rocket.stack.reduce((m, s) => m + slotMass(s), 0));
  const cap = Math.max(0, TANK_MAX - dry);
  const tank = bernalDest ? (Number(bernalDest.tank) || 0) : (Number(player.rocket.tank) || 0);
  if (tank >= cap) return fail('tank_full');
  // Site refuel makes WATER; it can't top up a dirt tank (no mixing).
  const destGrade = bernalDest ? bernalTankGrade(bernalDest) : tankGradeOf(player.rocket);
  if (tank > 0 && destGrade === 'dirt') return fail('cannot_mix_fuel');
  let rawGain, label;
  if (op.mode === 'factory') {
    const fac = state.factories[siteId];
    // Individuality (Freedom to Roam): an opponent's factory may be used to
    // refuel (a non-victory purpose). A Factory produces a FLAT 7 water FTs (the
    // published "Factory: a flat 7"), independent of the site's hydration, so
    // there is NO dry-site gate here: a factory on a hydration-0 site (e.g. an
    // aerostat) still refines its flat 7.
    if (!canUseFactoryNonVictory(state, player, fac)) return fail('no_factory');
    rawGain = 7;
    label = 'Factory-Refuel';
  } else {
    // ISRU-rig refuel refines the site's LOCAL water through the prospector, so
    // it needs water to refine: a dry site (hydration 0) yields nothing. An
    // Atmospheric Scoop (subsystem 5) raises an aerostat site to hydration 2.
    const water = effectiveHydration(site, player);
    if (water <= 0) return fail('dry_site');
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
  // Load the refined water UP the red line (one node per fuel step), so the
  // wet chit lands on the ladder instead of between nodes.
  const room = redStepsBetween(dry + tank);
  const steps = Math.min(Math.floor(rawGain), room);
  if (steps <= 0) return fail('tank_full');
  const res = loadFuelUpLadder(dry, tank, steps);
  const gain = round6(res.tank - tank);
  if (bernalDest) {
    bernalDest.tank = res.tank;
    bernalDest.tankGrade = 'water';
  } else {
    player.rocket.tank = res.tank;
    player.rocket.tankGrade = 'water';
  }
  player.refueledSites.push(siteId);
  if (!gateW.freeRepeat) player.opsRemaining -= 1;
  if (gateW.freeRepeat) label += ' (Miner colonist: extra refuel)';
  const destTank = bernalDest ? bernalDest.tank : player.rocket.tank;
  const destNote = bernalDest ? ' into the Bernal Stack' : '';
  return {
    ok: true, state,
    log: `${player.name}: ${label} at ${site.name} (+${round6(gain)} water${destNote}; tank ${round6(destTank)}).`,
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
  // Bernal scoop (op.unit = 'bernalN'): a Bernal IS a dirt crawler, so the
  // colony card is the engine - no active-thruster / crew-cap logic. It scoops
  // dirt at a site that has a factory OR an ISRU-rated card in its stack. A
  // fixed (anchored) station doesn't crawl, so it can't scoop.
  if (op && typeof op.unit === 'string' && op.unit.startsWith('bernal')) {
    const bn = bernalForUnit(player, op.unit);
    if (!bn) return fail('no_bernal');
    if (bn.anchored) return fail('bernal_anchored');
    if (!siteById(bn.siteId)) return fail('not_at_site');           // no ground at LEO
    const factoryHere = !!state.factories[bn.siteId];
    const isruAboard = (bn.stack || []).some(slotHasIsruRig);
    if (!factoryHere && !isruAboard) return fail('dirt_needs_isru');
    const tankNow = Number(bn.tank) || 0;
    // A Bernal is a dirt crawler that can hold water too, so adding dirt to a
    // water tank is fine: it flips to dirt grade and stays burnable (no dump).
    const bdry = bernalDryMass(bn);
    // Dirt burns down the same black ladder, so loading it walks UP the red line
    // one step per FT, landing the wet chit on a node (not a linear top-up).
    const broom = redStepsBetween(bdry + tankNow);
    if (broom <= 0) return fail('tank_full');
    const bwant = Number(op && op.amount);
    const bsteps = Number.isFinite(bwant) && bwant > 0 ? Math.min(Math.floor(bwant), broom) : broom;
    if (bsteps <= 0) return fail('tank_full');
    const bres = loadFuelUpLadder(bdry, tankNow, bsteps);
    bn.tank = bres.tank;
    bn.tankGrade = 'dirt';
    return {
      ok: true, state,
      log: `${player.name} loaded +${bres.steps} dirt FT${bres.steps === 1 ? '' : 's'} into the Bernal (tank ${round6(bn.tank)} dirt).`,
    };
  }
  const tid = player.rocket.activeThrusterId;
  const slot = tid && player.rocket.stack.find((s) => s.id === tid);
  if (!slot) return fail('no_thruster');
  if (!faceBurnsDirt(thrusterFaceOf(slot))) return fail('not_dirt_thruster');
  // The NASRDA moon cable pipes dirt up at a fuel depot: LEO OR docked at your
  // own anchored Home Bernal (the cable comment + the water side both treat a
  // Home Bernal as a depot, so dirt matches). Away from a depot you need a
  // factory here or an ISRU rig aboard instead.
  if (rocketAtRefuelDepot(state, player)) {
    if (!stackHasMoonCable(player.rocket)) return fail('dirt_needs_mooncable');
  } else {
    if (!siteById(player.rocket.siteId)) return fail('not_at_site');
    const factoryHere = !!state.factories[player.rocket.siteId];
    const isruAboard = player.rocket.stack.some(slotHasIsruRig);
    if (!factoryHere && !isruAboard) return fail('dirt_needs_isru');
  }
  // M2 Core Rule Addenda (d): dirt scooped at a Factory Dirtside to one of the
  // player's own Anchored Bernals may land straight in that Bernal's tank
  // instead of the rocket's. Opt-in via op.toBernal.
  let bernalDest = null;
  if (op && op.toBernal && state.m2 && player.rocket.siteId != null) {
    bernalDest = playerBernalDirtsideAt(state, player, player.rocket.siteId);
    if (!bernalDest) return fail('not_dirtside');
  }
  const tank = bernalDest ? (Number(bernalDest.tank) || 0) : (Number(player.rocket.tank) || 0);
  // Adding dirt to a tank that already holds WATER is allowed: the dirt
  // thruster required above burns dirt OR water, so the mixed tank flips to
  // dirt grade (it "sums up to dirt") and stays fully burnable - no need to
  // dump the water first. The client warns before converting a water tank.
  const dry = bernalDest ? bernalDryMass(bernalDest)
    : rocketDryMass(player.rocket.stack.reduce((m, s) => m + slotMass(s), 0));
  // Dirt burns down the same black ladder, so loading it walks UP the red line
  // one step per FT, landing the wet chit on a node (not a linear top-up).
  const room = redStepsBetween(dry + tank);
  if (room <= 0) return fail('tank_full');
  const want = Number(op && op.amount);
  let steps = Number.isFinite(want) && want > 0 ? Math.min(Math.floor(want), room) : room;
  // A CREW dirt thruster scoops only 1 dirt FT per turn; a card dirt thruster
  // scoops as much as the tank holds, any number of times. Track the crew load
  // per turn (reset in openTurnFor, replayed correctly on undo like
  // refueledSites) and cap the cumulative crew scoop at 1 fuel step.
  const isCrewBurner = !!CREW_BY_ID[slot.id];
  if (isCrewBurner) {
    const already = Number(player.dirtTanksThisTurn) || 0;
    const allowance = Math.max(0, 1 - already);
    if (allowance <= 0) return fail('dirt_crew_cap');
    steps = Math.min(steps, allowance);
  }
  if (steps <= 0) return fail('tank_full');
  const res = loadFuelUpLadder(dry, tank, steps);
  if (bernalDest) {
    bernalDest.tank = res.tank;
    bernalDest.tankGrade = 'dirt';
  } else {
    player.rocket.tank = res.tank;
    player.rocket.tankGrade = 'dirt';
  }
  if (isCrewBurner) player.dirtTanksThisTurn = (Number(player.dirtTanksThisTurn) || 0) + res.steps;
  const destTank = bernalDest ? bernalDest.tank : player.rocket.tank;
  const destNote = bernalDest ? ' into the Bernal Stack' : '';
  return {
    ok: true, state,
    log: `${player.name} loaded +${res.steps} dirt FT${res.steps === 1 ? '' : 's'}${destNote} (tank ${round6(destTank)} dirt).`,
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
  const dcard = PATENTS_BY_ID[cardId];
  // Only a BLACK-side good delivers. The black face is SECONDARY for most cards
  // but PRIMARY for GW thrusters / Freighters, so read it off the card type
  // (a hard-coded 'secondary' here wrongly rejected a black GW thruster).
  if (slot.face !== blackSideFace(dcard)) return fail('not_black_side');
  const zones = zonesFromEarth(site.solarZone);
  const cost = zones * 2 + (nodeSizeNumber(siteId) > 7 ? 1 : 0);
  const have = Number(outpost.tank) || 0;
  if (have < cost) return fail('insufficient_outpost_water', { cost, have });
  outpost.tank = round6(have - cost);
  outpost.cards.splice(idx, 1);
  player.leo = player.leo || [];
  // Preserve the card's black face (primary for GW / freighter, secondary else)
  // so it lands in LEO as the same black good, not flipped to its purple side.
  // Whole slot, so a delivered radiator keeps the side it deployed on (radSide)
  // and nothing else silently drops on the way to LEO.
  player.leo.push({ ...slot, kind: slot.kind || 'patent', face: slot.face });
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
  // The colonising settler (a Crew OR, under M2, a Colonist - rulebook G3) is
  // colocated with the factory whether it's ABOARD the rocket OR in an OUTPOST
  // stack at this site (a figure cargo-transferred to the outpost still
  // counts). Search the rocket first, then any outpost here, honouring the
  // requested cardId when given.
  const settlerOk = (s) => isCrewSlot(s) || isColonistSlot(s);
  const match = (s) => cardId0 ? (s.id === cardId0 && settlerOk(s)) : settlerOk(s);
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
  const settlerIsColonist = isColonistSlot(slot);
  // A Colony needs a Human settler (rulebook G3). A Robot Colonist is a
  // machine, not a settler, so it can't found a Colony - UNLESS the Uplift
  // Future has emancipated the robots (2C2b): from then on every Robot
  // colonist counts as a Human for every Human-gated rule, colonizing
  // included (the client only offers valid settlers; this keeps the rule
  // against a hand-built op).
  if (settlerIsColonist && (PATENTS_BY_ID[cardId] || {}).colonistKind === 'Robot' && !state.robotsEmancipated) {
    return fail('robot_cannot_settle');
  }
  if (fromOutpost) {
    const o = player.outposts[fromOutpost];
    o.cards = (o.cards || []).filter((s) => s.id !== cardId);
  } else {
    player.rocket.stack = player.rocket.stack.filter((s) => s.id !== cardId);
    if (player.rocket.activeThrusterId === cardId) player.rocket.activeThrusterId = null;
    if (player.rocket.activeProspectorId === cardId) player.rocket.activeProspectorId = null;
    clipTank(player.rocket);
  }
  // The settler has left its stack to found the colony. A glory chit is tied to
  // the Human that carried it, so settle the chit HOME at front (lowest) value
  // NOW - while the carrier pool is at its minimum, BEFORE a recovered crew card
  // re-enters the pool at LEO below (user 2026-07-08: colonised -> chit home at
  // lowest side). Without this the chit wrongly followed the recovered crew back
  // to LEO and stayed in play.
  const colonyGloryNotes = homeOrphanedGloryChits(state);
  let m2ColonyLog = '';
  if (settlerIsColonist) {
    // A settled colonist retires out of play (2A4b's model; 2C2a routes a
    // Robot to the hand, a Human to the bottom of the queue).
    retireColonistId(state, player, cardId);
    // Founding a Colony with a Human Colonist seats a delegate for the Colony
    // (G3c) and runs the vote tally. It also OPENS a colonist berth (the settler
    // left play), but exomigration is NOT forced (user 2026-07-02): the player
    // exomigrates when ready as a free action from the Colonists tab, which
    // pulses while a berth is open. Don't auto-exomigrate here.
    if (state.m2) {
      const home = (state.homeIdeology || {})[player.profileId];
      const gotColonyDelegate = grantDelegate(state, player, home);
      const starMoved = quietVoteTally(state);
      const bits = [];
      if (gotColonyDelegate) bits.push(`a delegate joins ${(IDEOLOGY_BY_KEY[home] || {}).name || home} for the Colony`);
      if (starMoved) bits.push(`the active-law star moves to ${starMoved}`);
      if (bits.length) m2ColonyLog = ` ${bits.join('; ')}.`;
    }
  } else {
    // The colonising crew leaves its stack and re-settles at the player's CHOSEN
    // station (user 2026-07-07): their Home Bernal (op.crewTo = 'bernal<i>') or
    // the LEO Stack (default). Crew is never lost.
    const crewSlot = { id: cardId, kind: 'crew', face: slot.face === 'secondary' ? 'secondary' : 'primary' };
    let placed = false;
    if (typeof op.crewTo === 'string' && op.crewTo.startsWith('bernal')) {
      const bn = (player.bernals || [])[Number(op.crewTo.slice('bernal'.length)) || 0];
      if (bn && bn.anchored && isHomeBernal(bn)) { bn.stack = bn.stack || []; bn.stack.push(crewSlot); placed = true; }
    }
    if (!placed) { player.leo = player.leo || []; player.leo.push(crewSlot); }
  }
  // Store the colony's location type (sent by the client, which has the site
  // flags) so the endgame scorer can value it by type - a site bonus ABOVE the
  // +1 dome token: astrobiology +1, submarine / Bernal +2, plain colony none.
  const cType = ['astrobiology', 'submarine', 'bernal'].includes(op.colonyType) ? op.colonyType : 'other';
  state.colonies[siteId] = { ownerId: player.profileId, type: cType };
  const crew = CREW_BY_ID[cardId];
  const crewName = crew ? ((crew.faces && crew.faces[slot.face === 'secondary' ? 'secondary' : 'primary'] || {}).name || crew.id) : cardNameOf(cardId);
  let log = `${player.name} founded a Colony at ${site.name} (settled ${crewName}).${m2ColonyLog}`;
  if (colonyGloryNotes.length) log += ' ' + colonyGloryNotes.join(' ');
  return { ok: true, state, log };
}

// EVAC_CREW_HOME (free action): move crew who evacuated to the LEO Stack (e.g.
// after a rocket was destroyed) onto the player's anchored Home Bernal. The
// post-death choice the client offers (user 2026-07-07) - crew always land in
// LEO first, then the player may relocate them home. op = { cardIds }.
function applyEvacCrewHome(state, op, player) {
  const home = (player.bernals || []).find(isHomeBernal);
  if (!home) return fail('no_home_bernal');
  const ids = Array.isArray(op.cardIds) ? op.cardIds.map(String) : [];
  if (!ids.length) return fail('bad_transfer');
  player.leo = player.leo || [];
  home.stack = home.stack || [];
  let moved = 0;
  for (const id of ids) {
    const idx = player.leo.findIndex((s) => s.id === id && isCrewSlot(s));
    if (idx < 0) continue;
    const [slot] = player.leo.splice(idx, 1);
    home.stack.push(slot);
    moved++;
  }
  if (!moved) return fail('not_in_source');
  const homeName = (PATENTS_BY_ID[home.cardId] || {}).name || 'Home Bernal';
  return { ok: true, state, log: `${player.name} relocated ${moved} evacuated crew from LEO to the ${homeName}.` };
}

// Did a completed Future grant this player a standing effect (e.g.
// 'freeHomestead' from the Aerostat / TNO Futures)? Effects are stamped onto
// player.futureEffects by the Epic Hazard op when the Future completes.
function hasFutureEffect(player, key) {
  return Array.isArray(player.futureEffects) && player.futureEffects.includes(key);
}

// SETI Future (freeInspiration standing effect): "as a free action perform 1
// inspiration + 1 homestead" - the homestead half is freeHomestead (above);
// this is the inspiration half. The player may trigger an Inspiration (the
// market-deck cycle) as a FREE ACTION, mirroring freeHomestead's "every one
// this player does is free" shape rather than a one-shot. Does NOT touch
// state.lastEvent (that is the dice-driven Sunspot Cube's own record) or the
// Regime Change prompt (a CEO Solitaire mechanic; Futures are not wired for
// ceoSolo - see CLAUDE.md). Turn-gated like any functional op (a free action
// is still only taken on your own turn), just spends no operation.
function applyFreeInspiration(state, op, player) {
  if (!state.m2) return fail('m2_off');
  if (!hasFutureEffect(player, 'freeInspiration')) return fail('no_free_inspiration');
  const cycled = cycleMarketDecks(state);
  if (!cycled.length) return fail('decks_too_thin');
  const lines = cycled.map((c) => `${cardNameOf(c.out)} sank to the bottom of the ${c.deck} deck; ${cardNameOf(c.in)} is the new top.`);
  return {
    ok: true, state,
    log: `${player.name} triggered a free Inspiration (SETI Future): ${lines.join(' ')}`,
  };
}

// Homesteading (rule 2A4, M2 operation): a new way to build a Colony. Three
// steps: (a) return a Black-Side product from LEO (or your Home Bernal) to
// the bottom of its patent deck and place a Colony dome on one of your
// uncolonized Factories; (b) retire one of your Colonists (anywhere) to the
// bottom of the queue - it settles the new Colony; (c) exomigrate a fresh
// replacement. op = { siteId, productCardId, colonistCardId? }. Some Futures
// (Aerostat / TNO) make homesteading a free action.
function applyHomestead(state, op, player) {
  if (!state.m2) return fail('m2_off');
  const freeAction = hasFutureEffect(player, 'freeHomestead');
  if (!freeAction && player.opsRemaining <= 0) return fail('no_ops_left');
  const siteId = String(op.siteId || '');
  const site = siteById(siteId);
  if (!site) return fail('unknown_site');
  const fac = state.factories[siteId];
  if (!fac || fac.ownerId !== player.profileId) return fail('no_factory');
  if (state.colonies[siteId]) return fail('already_colony');
  if (ownedSiteCount(state.colonies, player.profileId) >= COLONY_DOMES) return fail('no_colony_domes');
  // Step a: the surrendered Black-Side product. It sits in the LEO Stack or in
  // the Home Bernal's stack, on its installed (black) face - the PRIMARY face
  // for GW thrusters / freighters, the secondary face for everything else.
  const productId = String(op.productCardId || '');
  const prodCard = PATENTS_BY_ID[productId];
  if (!prodCard || !decksFor(state, player)[prodCard.type]) return fail('bad_product');
  const blackFace = (prodCard.type === 'gw-thruster' || prodCard.type === 'freighter') ? 'primary' : 'secondary';
  const home = (player.bernals || []).find(isHomeBernal);
  const hosts = [
    { arr: player.leo || [], name: 'LEO' },
    ...(home ? [{ arr: home.stack || [], name: 'the Home Bernal' }] : []),
  ];
  let taken = null;
  for (const h of hosts) {
    const i = h.arr.findIndex((s) => s.id === productId && !isCrewSlot(s) && !isColonistSlot(s)
      && (s.face === 'secondary' ? 'secondary' : 'primary') === blackFace);
    if (i >= 0) { h.arr.splice(i, 1); taken = h; break; }
  }
  if (!taken) return fail('no_black_side_card');
  decksFor(state, player)[prodCard.type].push(productId);
  // Step b: retire a Colonist (the player's pick, else the first found).
  const wantId = op.colonistCardId != null ? String(op.colonistCardId) : null;
  let retire = null;
  for (const e of colonistLocations(player)) {
    if (!wantId || e.slot.id === wantId) { retire = e; break; }
  }
  if (!retire) return fail('no_colonist');
  removeColonistSlot(player, retire);
  retireColonistId(state, player, retire.slot.id);
  const settler = PATENTS_BY_ID[retire.slot.id];
  // The settling colonist has left the carrier pool: settle its glory chit HOME
  // at front (lowest) value NOW, before step c's exomigration restores a fresh
  // colonist to the pool below (which would otherwise keep the chit in play).
  // (User 2026-07-08: colonised -> chit home at lowest side.)
  const homesteadGloryNotes = homeOrphanedGloryChits(state);
  // The dome lands; the colony's location class comes from the site itself.
  state.colonies[siteId] = { ownerId: player.profileId, type: colonyClassOfSite(siteId) || 'other' };
  if (!freeAction) player.opsRemaining -= 1;
  let log = `${player.name} homesteaded ${site.name}: returned ${prodCard.name} from ${taken.name}, `
    + `settled ${(settler && settler.name) || 'a colonist'} at the new Colony.`;
  if (homesteadGloryNotes.length) log += ' ' + homesteadGloryNotes.join(' ');
  if (freeAction) log += ' (Free action: a completed Future.)';
  // Step c: exomigration restores parity with the Bernals.
  const exo = exomigrateOne(state, player);
  if (exo.ok) log += ` ${exo.log}`;
  return { ok: true, state, log };
}

// Nanofacture (rule 1A7, M1+M2 operation): an Anchored non-Home Bernal
// produces its own Mobile Factory. Requires the player's PROMOTED Freighter;
// decommissions an operational robonaut + refinery (plus supports) from the
// Bernal's stack (returned to hand, the Industrialize build-set model) and
// places a Mobile Factory cube at the Bernal. op = { cardId (the Bernal),
// cardIds (the build set) }.
function applyNanofacture(state, op, player) {
  if (!state.m1 || !state.m2) return fail(state.m1 ? 'm2_off' : 'm1_off');
  const fr = player.freighter;
  if (!fr || !(fr.promoted || fr.face === 'secondary')) return fail('freighter_not_promoted');
  const cardId = op.cardId != null ? String(op.cardId) : null;
  const bn = cardId ? (player.bernals || []).find((b) => b && b.cardId === cardId) : null;
  if (!bn) return fail('no_bernal');
  if (!bn.anchored) return fail('not_anchored');
  if (isHomeBernal(bn)) return fail('home_bernal');
  const slug = bn.siteId;
  // Nanofacture is an operation, but an Industrialist colonist colocated with the
  // Bernal performs it FREE once per turn per Industrialist (2C1), same as its
  // free Industrialize / Anchor. Otherwise it spends the turn's operation.
  const freeViaColonist = canColonistFreeOp(state, player, slug, 'Industrialist');
  if (!freeViaColonist && player.opsRemaining <= 0) return fail('no_ops_left');
  const ids = Array.isArray(op.cardIds) ? op.cardIds.map(String) : [];
  let hasRefinery = false, hasRobonaut = false;
  for (const id of ids) {
    const slot = (bn.stack || []).find((s) => s.id === id && !isCrewSlot(s) && !isColonistSlot(s));
    if (!slot) return fail('not_in_stack');
    const c = PATENTS_BY_ID[id];
    if (c && c.type === 'refinery') hasRefinery = true;
    if (c && c.type === 'robonaut') hasRobonaut = true;
  }
  if (!hasRefinery || !hasRobonaut) return fail('cannot_nanofacture');
  // Cube supply: the 7 cubes span factories + delegates + the first-player
  // marker (cubesInPlay) PLUS any cubes already flying as Mobile Factories.
  const mobileN = (state.mobileCubes || []).filter((c) => c && c.ownerId === player.profileId).length;
  if (cubesInPlay(state, player.profileId) + mobileN >= FACTORY_CUBES) return fail('no_factory_cubes');
  // No two cubes share a node.
  if (slug != null && (state.factories[slug]
      || (state.mobileCubes || []).some((c) => c && c.siteId === slug))) return fail('dest_occupied');
  for (const id of ids) {
    const idx = bn.stack.findIndex((s) => s.id === id);
    if (idx >= 0) { bn.stack.splice(idx, 1); player.hand.push(id); }
  }
  state.mobileCubeSeq = (state.mobileCubeSeq | 0) + 1;
  state.mobileCubes = state.mobileCubes || [];
  state.mobileCubes.push({
    id: `mf${state.mobileCubeSeq}`, ownerId: player.profileId, siteId: slug,
    spectralType: 'C', glitched: false, tag: nextFactoryTag(state, player.profileId),
  });
  if (freeViaColonist) spendColonistFreeOp(player, 'Industrialist');
  else player.opsRemaining -= 1;
  const card = PATENTS_BY_ID[cardId];
  const where = slug == null ? 'LEO' : ((siteById(slug) || {}).name || slug);
  let log = `${player.name} nanofactured a Mobile Factory at the ${(card && card.name) || 'Bernal'} (${where});`
    + ` decommissioned ${ids.length} card${ids.length === 1 ? '' : 's'} to hand.`;
  if (freeViaColonist) log += ' (Industrialist colonist: free action.)';
  return { ok: true, state, log };
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

// Per-type ownership caps. GW thrusters + Freighters are singletons (1A4: one
// each, anywhere). Bernals (2B3) cap at TWO Bernal Cards total - in hand, in
// play, or stowed in a Bernal's stack. countOwnedOfType already spans every
// zone (it walks ownedCardIds). null = uncapped.
const CARD_TYPE_OWNERSHIP_LIMIT = { 'gw-thruster': 1, 'freighter': 1, 'bernal': 2 };
function ownershipLimitFor(type) {
  return Object.prototype.hasOwnProperty.call(CARD_TYPE_OWNERSHIP_LIMIT, type)
    ? CARD_TYPE_OWNERSHIP_LIMIT[type] : null;
}
function atOwnershipCap(player, type) {
  const lim = ownershipLimitFor(type);
  return lim != null && countOwnedOfType(player, type) >= lim;
}
// The op error for hitting a type's ownership cap.
function ownershipCapError(type) {
  return type === 'bernal' ? 'bernal_limit'
    : type === 'freighter' ? 'already_own_freighter' : 'already_own_gw';
}

function applyBuyCard(state, op, player) {
  const cardId = String(op.cardId || '');
  const card = PATENTS_BY_ID[cardId];
  if (!card) return fail('unknown_card');
  if (card.type === 'gw-thruster' && !state.m1) return fail('expansion_card');
  if (card.type === 'freighter' && !state.m1) return fail('expansion_card');
  if (card.type === 'bernal' && !state.m2) return fail('expansion_card');
  if (CREW_BY_ID[cardId]) return fail('crew_card');
  if (atOwnershipCap(player, card.type)) {
    return fail(ownershipCapError(card.type));
  }
  if ((player.hand || []).includes(cardId)) return fail('already_in_hand');
  if ((player.rocket.stack || []).some((s) => s.id === cardId)) return fail('on_rocket');
  const free = op.free !== false;             // default: free action (no op spent)
  const cost = Math.max(0, Number(op.cost) | 0);  // default: 0 aqua
  if (!free && player.opsRemaining <= 0) return fail('no_ops_left');
  if (cost > 0 && (player.aqua | 0) < cost) return fail('cannot_pay');
  // Pull it out of its deck if present (keeps the shuffled library consistent;
  // a no-op in pure Free Library, where the deck is never drawn from).
  const deck = decksFor(state, player)[card.type];
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
  const fc = Math.floor(thrusterFuelPerBurn(player.rocket, playerCrewReactorKinds(player)));
  const tanks = 5 - fc;
  if (tanks <= 0) return fail('no_air_eater_gain', { fuelConsumption: fc });
  // Scooped atmosphere counts as water; can't pour onto a dirt / isotope tank.
  const tank = Number(player.rocket.tank) || 0;
  if (tank > 0 && tankGradeOf(player.rocket) !== 'water') return fail('cannot_mix_fuel');
  const dry = rocketDryMass(player.rocket.stack.reduce((m, s) => m + slotMass(s), 0));
  const room = redStepsBetween(dry + tank);   // fuel steps free on the red line
  if (room <= 0) return fail('tank_full');

  // Diver Orbit hazard: roll a d6 (a 1 destroys the stack) unless paid past with
  // FINAO. A parachute generator aboard (stackSafeAerobrake) carries the whole
  // stack safely through the dive - no roll, no FINAO - exactly as it waives the
  // aerobrake descent + the parked-turn hazard. (User 2026-06-27: the parachute
  // prevents parachute-hazard rolls.)
  const safeAero = stackSafeAerobrake(player.rocket);
  const wantPay = !safeAero && !!op.hazardPay;
  const finaoPer = finaoPerFor(state, player);
  if (wantPay && finaoPer > (player.aqua | 0)) return fail('insufficient_aqua');
  const gen = makeRng(state.seed, state.rng.cursor);
  const rolls = [];
  let destroyed = false;
  if (safeAero) {
    // Parachute generator: the dive is safe, no Diver Orbit roll.
  } else if (wantPay) {
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
      if (isCrewSlot(slot)) crewDeathToLeo(state, player, slot);   // aerobrake roll: a fatality in ceoSolo
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
  // Move the wet chit up the red line by (5 - fuel consumption) steps.
  const res = loadFuelUpLadder(dry, tank, Math.min(tanks, room));
  const gain = round6(res.tank - tank);
  player.rocket.tank = res.tank;
  player.rocket.tankGrade = 'water';
  player.opsRemaining -= 1;
  const safeNote = safeAero ? ' (parachute generator, no roll)' : wantPay ? ' (FINAO)' : '';
  return {
    ok: true, state, rolled: !safeAero && !wantPay,
    log: `${player.name} air-eater scooped +${gain} water at ${siteName}${safeNote} (tank ${round6(player.rocket.tank)}).`,
  };
}

// A site is a valid Promotion Site for a card needing colony `need`: it must
// carry a colony dome matching the need. Needs are the 5 dome-icon classes
// (2A3a): a spectral letter (the factory there must match), 'Submarine',
// 'Astrobiology', 'Atmospheric' (the site's location class), or 'Push' /
// unspecified (any colony).
function colonyPromotes(state, siteId, need) {
  if (!siteId || !state.colonies[siteId]) return false;
  if (!need || need === 'Push') return true;
  if (need === 'Submarine') {
    return state.colonies[siteId].type === 'submarine' || colonyClassOfSite(siteId) === 'submarine';
  }
  if (need === 'Astrobiology') {
    return state.colonies[siteId].type === 'astrobiology' || colonyClassOfSite(siteId) === 'astrobiology';
  }
  if (need === 'Atmospheric') {
    return isAtmosphericSite(siteId) || isAerostatSiteId(siteId);
  }
  const fac = state.factories[siteId];
  return !!(fac && (fac.spectralType || 'C') === need);
}
// Is a Promoted AND Anchored Bernal (a Lab) parked at this space? Rule 2A5c:
// such a Bernal is always a valid promotion colony for Colonist, Freighter,
// and GW-thruster cards - but never for other Bernals.
function promotedBernalAt(state, siteId) {
  if (siteId == null) return false;
  for (const p of state.players) {
    for (const bn of (p.bernals || [])) {
      if (bn && bn.anchored && (bn.promoted || bn.face === 'secondary') && bn.siteId === siteId) return true;
    }
  }
  return false;
}
// The full Promotion-Site test for a card standing at `siteId`.
// V9 Sirens: "regardless of dome icon, Siren cards promote ONLY at push colonies
// (2A3a) or promoted-and-anchored Bernals (2A3c)." The Push dome icon already
// means "any colony will do" in this implementation (see colonyPromotes), so a
// Siren's need is forced to 'Push' and the printed icon is ignored. The
// promoted-Bernal clause is the one already below.
//
// Note this can only ever be NARROWER or equal for a Siren: forcing 'Push'
// drops the spectral / Submarine / Astrobiology / Atmospheric requirements and
// accepts any colony instead, which is what the rule says.
function promotionSiteAt(state, siteId, need, cardType, player) {
  const want = isSirenPlayer(state, player) ? 'Push' : need;
  if (colonyPromotes(state, siteId, want)) return true;
  if (cardType !== 'bernal' && promotedBernalAt(state, siteId)) return true;
  return false;
}

// Does a single space satisfy a Bernal's dome-icon Promotion requirement
// (2A3a)? Unlike colonyPromotes (used by Colonist / Freighter / GW cards, which
// promote at an actual colony), a Bernal's dome names a LOCATION CLASS, so the
// location-class domes (Submarine / Astrobiology / Atmospheric) match the SITE'S
// own class with NO colony dome required (user 2026-07-04: "this site is
// astrobiology"). A spectral dome matches a Factory of that spectral; Push /
// unspecified takes any colony.
function bernalDomeMatchesSpace(state, siteId, need) {
  if (!siteId) return false;
  if (!need || need === 'Push') return !!state.colonies[siteId];
  if (need === 'Submarine')    return colonyClassOfSite(siteId) === 'submarine';
  if (need === 'Astrobiology') return colonyClassOfSite(siteId) === 'astrobiology';
  if (need === 'Atmospheric')  return isAtmosphericSite(siteId) || isAerostatSiteId(siteId);
  const fac = state.factories[siteId];
  return !!(fac && (fac.spectralType || 'C') === need);
}
// A Bernal may promote to its Lab side when it is COLOCATED with a space that
// matches its dome (2A3a) - its own node, or any site in its raygun line of
// sight (user 2026-07-04: the Bernal and its comet site "are now considered
// colocated"; user 2026-07-10: promotion colocation uses the SAME raygun reach
// as Dirtside anchoring - transparent waypoints, ignores atmosphere). The
// Bernal need not be anchored. Shares the raygun beam with adjacentFactorySlugs.
function bernalPromotionColocated(state, bn, need) {
  if (!bn || bn.siteId == null) return false;
  const start = String(bn.siteId);
  if (bernalDomeMatchesSpace(state, start, need)) return true;
  // includeBouncedSites: an aerostat / atmospheric site still counts (the beam
  // only has to touch it), so promotion ignores atmosphere for line of sight the
  // SAME way Dirtside anchoring does (adjacentFactorySlugs). Without this flag
  // the beam stopped at the atmosphere and a valid promotion space went unseen.
  for (const siteSlug of lineOfSightSites(start, { includeBouncedSites: true })) {
    if (bernalDomeMatchesSpace(state, siteSlug, need)) return true;
  }
  return false;
}

// Promotion Op (M1/M2, rule 2A3). Flip a card to its improved Purple-Side at
// its Promotion Site. Costs the turn's operation. Four unit classes:
//   - the Freighter unit (M1): op.unit = 'freighter'
//   - a Bernal unit -> its Lab (M2, rule 2A5e): op.unit = 'bernal', op.cardId
//   - a GW thruster in a stack (M1): op.cardId + op.from
//   - a Colonist anywhere in play (M2): op.cardId (searched across stacks).
//     Promoting a Colonist / GW thruster / Freighter unlocks its Future (1D).
// Spend a Promotion's operation: a Prospector colonist colocated with the
// promotion site grants one free promotion per turn (2C1b), else the turn's
// operation is consumed. Returns null when neither is available.
function takePromotionOp(state, player, siteId) {
  if (canColonistFreeOp(state, player, siteId, 'Prospector')) {
    spendColonistFreeOp(player, 'Prospector');
    return { free: true };
  }
  if (player.opsRemaining <= 0) return null;
  player.opsRemaining -= 1;
  return { free: false };
}

function applyPromote(state, op, player) {
  if (!state.m1 && !state.m2) return fail('m1_off');
  if (op.unit === 'freighter') {
    if (!state.m1) return fail('m1_off');
    const fr = player.freighter;
    if (!fr) return fail('no_freighter');
    if (fr.promoted || fr.face === 'secondary') return fail('already_promoted');
    const card = PATENTS_BY_ID[fr.cardId];
    if (!promotionSiteAt(state, fr.siteId, card && card.promotionColony, 'freighter', player)) return fail('no_promotion_colony');
    const spentFr = takePromotionOp(state, player, fr.siteId);
    if (!spentFr) return fail('no_ops_left');
    fr.face = 'secondary'; fr.promoted = true;
    // The instant the Freighter promotes, the fleet is born (1B6): name every
    // one of this player's factory cubes so each can be planned + moved.
    for (const f of Object.values(state.factories)) {
      if (f && f.ownerId === player.profileId && !f.tag) f.tag = nextFactoryTag(state, player.profileId);
    }
    const site = siteById(fr.siteId);
    const nm = card && card.faces && card.faces.secondary && card.faces.secondary.name;
    return { ok: true, state, log: `${player.name} promoted the Freighter${nm ? ` to ${nm}` : ''} at ${(site && site.name) || fr.siteId} - the factory fleet is now mobile.` };
  }
  if (op.unit === 'bernal') {
    // Lab Promotion (rule 2A5e / 2A3a): a Bernal flips to its Purple-Side Lab at
    // a Promotion Site matching its dome icon, unlocking its Lab ability and
    // raising its colonist allowance from 1 to 2 (2Ca). It may promote whether
    // ANCHORED or not, and the matching site need only be COLOCATED - its own
    // node OR a site in the Bernal's raygun line of sight, the same reach as
    // Dirtside anchoring (user 2026-07-04 / 2026-07-10). A location-class dome
    // (Submarine / Astrobiology / Atmospheric) matches the site's own CLASS with
    // no colony dome required.
    if (!state.m2) return fail('m2_off');
    const cardId = op.cardId != null ? String(op.cardId) : null;
    const bn = cardId ? (player.bernals || []).find((b) => b && b.cardId === cardId) : null;
    if (!bn) return fail('no_bernal');
    if (bn.promoted || bn.face === 'secondary') return fail('already_promoted');
    const card = PATENTS_BY_ID[cardId];
    const need = card && card.promotionColony;
    if (!bernalPromotionColocated(state, bn, need)) return fail('no_promotion_colony');
    const spentBn = takePromotionOp(state, player, bn.siteId);
    if (!spentBn) return fail('no_ops_left');
    bn.face = 'secondary'; bn.promoted = true;
    const nm = (card && card.faces && card.faces.secondary && card.faces.secondary.name) || 'its Lab side';
    const where = (siteById(bn.siteId) || {}).name || bn.siteId;
    return { ok: true, state, log: `${player.name} promoted the ${(card && card.name) || 'Bernal'} to ${nm} - the Lab is open and the colony now supports 2 colonists.` };
  }
  // Card promotion by id: a GW thruster in the rocket / an outpost (M1), or a
  // Colonist anywhere in play (M2).
  const cardId = String(op.cardId || '');
  const card = PATENTS_BY_ID[cardId];
  if (!card) return fail('not_promotable');
  if (card.type === 'colonist') {
    if (!state.m2) return fail('m2_off');
    let loc = null;
    for (const e of colonistLocations(player)) {
      if (e.slot.id === cardId) { loc = e; break; }
    }
    if (!loc) return fail('not_in_stack');
    if (loc.slot.face === 'secondary') return fail('already_promoted');
    if (!promotionSiteAt(state, loc.siteId, card.promotionColony, 'colonist', player)) return fail('no_promotion_colony');
    const spentCol = takePromotionOp(state, player, loc.siteId);
    if (!spentCol) return fail('no_ops_left');
    loc.slot.face = 'secondary';
    const site = loc.siteId ? siteById(loc.siteId) : null;
    const nm = (card.faces && card.faces.secondary && card.faces.secondary.name) || card.name;
    const fut = card.faces && card.faces.secondary && card.faces.secondary.future;
    const futName = fut ? String(fut).split(':')[0].trim() : null;
    let log = `${player.name} promoted ${card.name} to ${nm} (Colonist) at ${(site && site.name) || 'their colony'}.`;
    if (state.futures && futName) log += ` The ${futName} is unlocked.`;
    return { ok: true, state, log };
  }
  // GW thruster in the rocket stack or an outpost.
  if (!state.m1) return fail('m1_off');
  const from = String(op.from || 'rocket');
  let slot = null, siteId = null;
  if (from === 'rocket') { slot = player.rocket.stack.find((s) => s.id === cardId); siteId = player.rocket.siteId; }
  else if (from.startsWith('outpost')) {
    const o = player.outposts && player.outposts[from.slice('outpost'.length)];
    if (o) { slot = (o.cards || []).find((s) => s.id === cardId); siteId = o.siteId; }
  }
  if (!slot) return fail('not_in_stack');
  if (card.type !== 'gw-thruster') return fail('not_promotable');
  if (slot.face === 'secondary') return fail('already_promoted');
  if (!promotionSiteAt(state, siteId, card.promotionColony, 'gw-thruster', player)) return fail('no_promotion_colony');
  const spentGw = takePromotionOp(state, player, siteId);
  if (!spentGw) return fail('no_ops_left');
  slot.face = 'secondary';
  const site = siteById(siteId);
  const nm = card.faces && card.faces.secondary && card.faces.secondary.name;
  const fut = card.faces && card.faces.secondary && card.faces.secondary.future;
  const futName = fut ? String(fut).split(':')[0].trim() : null;
  let log = `${player.name} promoted ${nm || cardId} (GW thruster) at ${(site && site.name) || siteId}.`;
  if (state.futures && futName) log += ` The ${futName} is unlocked.`;
  return { ok: true, state, log };
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
// A promoted Martian Assembly (a Colonist whose ability "Acts as a Freighter
// when building a Space Elevator") the player has parked AT `slug`. M2-gated
// (colonists), and only the promoted face carries the ability. Returns the
// colonistLocations entry ({ slot, siteId, from }) or null.
function elevatorFreighterAt(state, player, slug) {
  if (!state.m2 || slug == null) return null;
  for (const e of colonistLocations(player)) {
    if (e.siteId !== slug) continue;
    const pw = colonistSlotPower(e.slot);
    if (pw && pw.elevatorFreighter) return e;
  }
  return null;
}
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
  // 1B9: one end must be INDUSTRIALIZED (a Factory - any owner; a landed Mobile
  // Factory is a Factory), and YOU must have a cube at the OTHER end. Your cube
  // is one of: a Factory, your Freighter (promotion NOT required), a Mobile
  // Factory (an in-transit cube in state.mobileCubes), or a Martian Assembly (a
  // promoted Colonist whose ability "Acts as a Freighter when building a Space
  // Elevator") parked there. (User 2026-07-08, 1B9.)
  const fr = player.freighter;
  const industrialized = (slug) => !!state.factories[slug];
  const myCubeAt = (slug) => {
    const f = state.factories[slug];
    if (f && f.ownerId === player.profileId) return 'factory';
    if (fr && fr.siteId === slug) return 'freighter';
    if ((state.mobileCubes || []).some((c) => c && c.ownerId === player.profileId && c.siteId === slug)) return 'mobile';
    if (elevatorFreighterAt(state, player, slug)) return 'martianAssembly';
    return null;
  };
  let factoryEnd = null, otherEnd = null, cubeKind = null;
  if (industrialized(pair.a) && myCubeAt(pair.b)) { factoryEnd = pair.a; otherEnd = pair.b; cubeKind = myCubeAt(pair.b); }
  else if (industrialized(pair.b) && myCubeAt(pair.a)) { factoryEnd = pair.b; otherEnd = pair.a; cubeKind = myCubeAt(pair.a); }
  if (!factoryEnd) {
    if (!industrialized(pair.a) && !industrialized(pair.b)) return fail('elevator_needs_factory');
    return fail('elevator_needs_cube');
  }
  const nameOf = (slug) => (siteById(slug) && siteById(slug).name) || slug;

  const wantPay = !!op.hazardPay;
  const finaoPer = finaoPerFor(state, player);
  if (wantPay && finaoPer > (player.aqua | 0)) return fail('insufficient_aqua');
  if (op.debug) {
    return { ok: true, state, log: '', calc: { pair: pair.key, factoryEnd, otherEnd, wouldPay: wantPay, performer: cubeKind } };
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
    // A failed roll loses YOUR cube at the other end - whichever kind it was.
    let lost;
    if (cubeKind === 'freighter') { player.freighter = null; player.freighterMovesRemaining = 0; lost = 'Freighter'; }
    else if (cubeKind === 'mobile') {
      state.mobileCubes = (state.mobileCubes || []).filter((c) => !(c && c.ownerId === player.profileId && c.siteId === otherEnd));
      lost = 'Mobile Factory';
    } else if (cubeKind === 'martianAssembly') {
      // The Martian Assembly acted as the Freighter, so on failure it is the unit
      // lost: retire the Colonist to the bottom of the queue.
      const e = elevatorFreighterAt(state, player, otherEnd);
      if (e) { removeColonistSlot(player, e); retireColonistId(state, player, e.slot.id); }
      lost = 'Martian Assembly';
    } else {
      delete state.factories[otherEnd]; if (state.colonies) delete state.colonies[otherEnd]; lost = 'Factory';
    }
    return { ok: true, state, rolled: true,
      log: `${player.name}'s Space Elevator build failed the Epic Hazard (rolled a 1) - the ${lost} at ${nameOf(otherEnd)} was lost.` };
  }
  state.elevators[pair.key] = { ownerId: player.profileId };
  // Auto-claim any unclaimed connected Site (even a Busted one) - EXCEPT the
  // three claims V9 Sirens seeds at setup, which "cannot be re-prospected with
  // special abilities" and an elevator's free claim is exactly that. They carry
  // busted:'sirens' so a claim a player actually busted in play is unaffected.
  let claimed = false;
  for (const slug of [pair.a, pair.b]) {
    const d = state.discs[slug];
    if (d && d.busted === 'sirens') continue;
    if (!d || d.outcome !== 'success') {
      state.discs[slug] = { outcome: 'success', ownerId: player.profileId, roll: 1, canReroll: false };
      claimed = true;
    }
  }
  const via = wantPay ? ' (paid FINAO)' : ` (Epic Hazard rolled ${d6})`;
  return { ok: true, state, rolled,
    log: `${player.name} built a Space Elevator between ${nameOf(pair.a)} and ${nameOf(pair.b)}${via}.${claimed ? ' Connected Site claimed.' : ''}` };
}

// ---- M2 Futures: the Epic Hazard operation (rules 1A6 + 1D) ----

// The ctx the shared futures checkers (data/future-goals.js) read: state +
// player + the movement graph accessors this side owns.
function buildFutureCtx(state, player) {
  return {
    state, player,
    neighborsOf: (slug) => (slug == null ? [] : neighborSlugs(slug)),
    zoneOf: (slug) => (slug == null ? 'Earth' : zoneOfSlug(slug)),
    // A Bernal's Dirtsides are the sites its anchoring beam reaches (line of
    // sight through lander burns / hazards / atmosphere), no factory required.
    dirtsideSitesOf: (slug) => (slug == null ? [] : [...lineOfSightSites(String(slug), { includeBouncedSites: true })]),
    cardsById: PATENTS_BY_ID,
  };
}

// Score one earned Future star. A COMPLETED Future is PERMANENT (rule 1D2):
// "Each Future has a set of effects that are enabled for you once you succeed
// in its Epic Hazard Roll (1A6a). These effects are permanent, even if the
// card with the Future is later Decommissioned/Discarded." The orange star is
// earned the moment the Epic Hazard succeeds and is tracked SEPARATELY from
// the card, so scoring never re-checks the card's location, a Human standing
// with it, or whether the requirement still holds. There is no "lapsed" state.
// `endgame` on a goal means only "this star's VP is computed at final scoring"
// (the dynamic endgameVp path below) - never a reason to score 0.
function futureStarScore(state, player, star, ctx) {
  const goal = futureGoalForCard(star && star.cardId);
  const dynamic = !!(goal && typeof goal.endgameVp === 'function');
  const label = (goal && goal.endgameVpLabel) || null;
  if (!goal) return { vp: (star && star.vp) | 0, dynamic: false, label: null };
  let vp = star.vp | 0;
  if (dynamic) { try { vp += goal.endgameVp(ctx) | 0; } catch { /* a broken bonus scores 0 */ } }
  return { vp, dynamic, label };
}

// Find the player's PROMOTED (purple) card carrying a Future, with where it
// stands. Colonists live in any stack; a GW thruster in the rocket / an
// outpost; the Freighter is its own unit. Returns { siteId, isHumanItself,
// kind } or null.
function locateFutureCard(state, player, cardId) {
  const card = PATENTS_BY_ID[cardId];
  if (!card) return null;
  if (card.type === 'colonist') {
    for (const e of colonistLocations(player)) {
      if (e.slot.id !== cardId) continue;
      if (e.slot.face !== 'secondary') return null;
      const human = card.colonistKind === 'Human' || !!state.robotsEmancipated;
      return { siteId: e.siteId, isHumanItself: human, kind: 'colonist' };
    }
    return null;
  }
  if (card.type === 'gw-thruster') {
    const inRocket = player.rocket.stack.find((s) => s.id === cardId);
    if (inRocket) return inRocket.face === 'secondary' ? { siteId: player.rocket.siteId, isHumanItself: false, kind: 'gw' } : null;
    for (const o of Object.values(player.outposts || {})) {
      const s = (o.cards || []).find((x) => x.id === cardId);
      if (s) return s.face === 'secondary' ? { siteId: o.siteId, isHumanItself: false, kind: 'gw' } : null;
    }
    return null;
  }
  if (card.type === 'freighter') {
    const fr = player.freighter;
    if (!fr || fr.cardId !== cardId) return null;
    if (!(fr.promoted || fr.face === 'secondary')) return null;
    return { siteId: fr.siteId, isHumanItself: false, kind: 'freighter' };
  }
  return null;
}

// A Human of THIS player at a location (crew or Human colonist). The player's
// HOME counts their home Stack plus a rocket parked at home.
//
// V9 Sirens: the "LEO Stack" (player.leo) is a per-player pile, not a place, so
// for a Siren it physically sits at Cordelia. That means the home stack has to
// be scanned when the caller asks about the player's OWN home site, not when it
// asks about LEO. Off-Sirens homeBaseSiteId is null, so this is the same
// `siteId == null` branch as before.
function playerHumanAt(state, player, siteId) {
  const scan = (slots) => (slots || []).find((s) => isHumanSlot(state, s)) || null;
  if (isAtHomeBase(state, player, siteId)) {
    const s = scan(player.leo) || (rocketAtLeo(state, player) ? scan(player.rocket.stack) : null);
    if (s) return s;
    // LEO is not a site row, so nothing else can be standing there - return, the
    // way this function always has. A Siren's home IS a real site though, so
    // fall through in that case: an outpost / freighter / Bernal can also sit at
    // Cordelia and the home-stack scan must not swallow the question.
    if (siteId == null) return null;
  }
  if (player.rocket.siteId === siteId) { const s = scan(player.rocket.stack); if (s) return s; }
  for (const o of Object.values(player.outposts || {})) {
    if (o && o.siteId === siteId) { const s = scan(o.cards); if (s) return s; }
  }
  if (player.freighter && player.freighter.siteId === siteId) { const s = scan(player.freighter.stack); if (s) return s; }
  for (const bn of (player.bernals || [])) {
    if (bn && bn.siteId === siteId) { const s = scan(bn.stack); if (s) return s; }
  }
  return null;
}

// Involuntarily decommission the Human who failed an Epic Hazard (1A6a): a
// crew card dies (recalls to LEO, a ceoSolo fatality); a colonist returns to
// the bottom of the queue.
function decommissionHuman(state, player, slot) {
  if (isCrewSlot(slot)) {
    // Pull the crew from wherever it stands, then run the death bookkeeping.
    for (const e of [player.rocket.stack, player.leo,
      ...Object.values(player.outposts || {}).map((o) => o && o.cards),
      player.freighter && player.freighter.stack,
      ...(player.bernals || []).map((b) => b && b.stack)]) {
      if (!e) continue;
      const i = e.findIndex((s) => s === slot || s.id === slot.id);
      if (i >= 0) { e.splice(i, 1); break; }
    }
    crewDeathToLeo(state, player, slot);
    recallIfEmpty(player);
    return `${cardNameOf(slot.id)} was lost in the attempt (the crew restarts at LEO)`;
  }
  for (const e of colonistLocations(player)) {
    if (e.slot === slot || e.slot.id === slot.id) {
      removeColonistSlot(player, e);
      const where = retireColonistId(state, player, e.slot.id);
      return `${cardNameOf(e.slot.id)} was lost in the attempt (${where})`;
    }
  }
  return `${cardNameOf(slot.id)} was lost in the attempt`;
}

// EPIC_HAZARD (M2 operation, rules 1A6 + 1D): attempt to complete a Future. A
// Human (Crew or Human Colonist) colocated with the promoted card runs a
// Hazard Roll (avoidable by paying FINAO). A 1 fails: the star is not gained
// and the attempting Human is involuntarily decommissioned (the purple card
// survives). Success grants the orange future star (endgame VP), stamps the
// Future's standing effects, and settles any printed cost (aqua / the
// decommissioned thruster / the Ad Astra stack). Each named Future completes
// once per game, by one player. op = { cardId, hazardPay, humanCardId? }.
function applyEpicHazard(state, op, player) {
  if (!state.m2) return fail('m2_off');
  // Futures are the long game (rule 1D d): a short M2 room (5-6 rounds) runs the
  // colonization loop WITHOUT Futures, so no Future can be completed there.
  if (!state.futures) return fail('futures_disabled');
  const cardId = String(op.cardId || '');
  const goal = futureGoalForCard(cardId);
  if (!goal) return fail('no_future');
  state.futuresCompleted = state.futuresCompleted || {};
  if (state.futuresCompleted[goal.name]) return fail('future_taken');
  const loc = locateFutureCard(state, player, cardId);
  if (!loc) return fail('future_card_not_ready');
  // The attempting Human: named, or the colonist card itself (Human Colonist
  // futures), or any of the player's Humans standing with the card.
  let human = null;
  if (op.humanCardId) {
    const want = String(op.humanCardId);
    const h = playerHumanAt(state, player, loc.siteId);
    human = (h && h.id === want) ? h : null;
    if (!human) {
      // scan all colocated humans for the named one
      const all = [];
      const collect = (slots, at) => { if (at === loc.siteId) for (const s of (slots || [])) if (isHumanSlot(state, s)) all.push(s); };
      collect(player.rocket.stack, player.rocket.siteId);
      collect(player.leo, null);
      for (const o of Object.values(player.outposts || {})) if (o) collect(o.cards, o.siteId);
      if (player.freighter) collect(player.freighter.stack, player.freighter.siteId);
      for (const bn of (player.bernals || [])) if (bn) collect(bn.stack, bn.siteId);
      human = all.find((s) => s.id === want) || null;
    }
  } else if (loc.isHumanItself) {
    for (const e of colonistLocations(player)) if (e.slot.id === cardId) { human = e.slot; break; }
  } else {
    human = playerHumanAt(state, player, loc.siteId);
  }
  if (!human) return fail('future_needs_human');
  // Iceworms (colonist power): performs the Epic Hazard as a FREE action and
  // survives a failed roll.
  const humanPw = colonistSlotPower(human) || {};
  const freeAction = !!humanPw.epicHazardFree;
  if (!freeAction && player.opsRemaining <= 0) return fail('no_ops_left');
  const ctx = buildFutureCtx(state, player);
  const chk = checkFutureGoal(goal, ctx);
  if (!chk.met) return fail('future_requirements', { items: chk.items });
  // Printed costs must be payable before the roll.
  const aquaCost = (goal.cost && goal.cost.aqua) | 0;
  if (aquaCost && (player.aqua | 0) < aquaCost) return fail('insufficient_aqua');
  let thrusterId = null;
  if (goal.cost && goal.cost.bigThruster) {
    // The operational 7+ thruster parked at the synodic-comet factory - it is
    // consumed on success.
    for (const s of (player.rocket.stack || [])) {
      const c = PATENTS_BY_ID[s.id];
      if (!c) continue;
      const face = slotFace(s, c);
      if ((Number(face.thrust != null ? face.thrust : c.thrust) || 0) >= 7) { thrusterId = s.id; break; }
    }
    if (!thrusterId) return fail('future_requirements');
  }

  // The Epic Hazard roll (or FINAO).
  const wantPay = !!op.hazardPay;
  const finaoPer = finaoPerFor(state, player);
  if (wantPay && finaoPer > (player.aqua | 0) - aquaCost) return fail('insufficient_aqua');
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
  if (!freeAction) player.opsRemaining -= 1;
  const futName = goal.name.replace(/\s*FUTURE\s*$/i, '');
  if (failed) {
    const lost = humanPw.epicHazardSurvives
      ? `${cardNameOf(human.id)} rode it out unharmed (Iceworms)`
      : decommissionHuman(state, player, human);
    return {
      ok: true, state, rolled: true,
      log: `${player.name}'s ${futName} attempt failed the Epic Hazard (rolled a 1) - ${lost}.`,
    };
  }
  // Success: settle costs, grant the star + effects.
  if (aquaCost) player.aqua -= aquaCost;
  let costNote = '';
  if (thrusterId) {
    const idx = player.rocket.stack.findIndex((s) => s.id === thrusterId);
    if (idx >= 0) player.rocket.stack.splice(idx, 1);
    if (player.rocket.activeThrusterId === thrusterId) player.rocket.activeThrusterId = null;
    destroyToDeckBottom(state, thrusterId);
    recallIfEmpty(player);
    costNote = ` ${cardNameOf(thrusterId)} was decommissioned in the attempt.`;
  }
  state.futuresCompleted[goal.name] = { ownerId: player.profileId, cardId };
  player.futureStars = player.futureStars || [];
  player.futureStars.push({ key: goal.name, cardId, vp: goal.vp | 0, endgame: !!goal.endgame });
  player.futureEffects = player.futureEffects || [];
  let migratedSeniority = 0;
  for (const eff of (goal.effects || [])) {
    // The Uplift Future runs the full Emancipation ceremony (2C2b): free every
    // hand Robot into the re-seeded queue and flip the Human flag. No draw here
    // (this is not an exomigration).
    if (eff === 'emancipateRobots') { if (!state.robotsEmancipated) emancipateRobots(state, null); continue; }
    // Supreme Cult: a one-time board action - every Seniority Disk on the
    // assembly migrates to the Authority space. Not an ongoing standing effect,
    // so it fires here rather than riding player.futureEffects.
    if (eff === 'migrateSeniorityAuthority') { migratedSeniority = migrateSeniorityTo(state, 'authority'); continue; }
    if (!player.futureEffects.includes(eff)) player.futureEffects.push(eff);
  }
  let log = `${player.name} completed the ${futName}${wantPay ? ' (paid FINAO)' : ` (Epic Hazard rolled ${d6})`} - an orange future star is earned`;
  log += goal.endgame ? ' (scored at endgame).' : `${goal.vp ? ` (+${goal.vp} VP)` : '.'}`;
  log += costNote;
  if ((goal.effects || []).includes('emancipateRobots')) log += ' Every Robot colonist is now Emancipated.';
  if (migratedSeniority > 0) log += ` All ${migratedSeniority} Seniority Disk${migratedSeniority === 1 ? '' : 's'} migrated to Authority.`;
  if (goal.casusBelli) {
    state.casusBelli = { name: goal.name, ownerId: player.profileId };
    log += ` Casus belli: ${player.name} declares independence from Earth.`;
  }
  // Ad Astra futures: the stack exits the map on its interstellar mission -
  // the whole operational stack is decommissioned (Brave New World: neither
  // Murder nor Felony). Cards return to their deck bottoms, colonists requeue
  // (their export triggers exomigration), crew restarts at LEO.
  if (goal.adAstra) {
    let exported = 0;
    for (const s of [...player.rocket.stack]) {
      if (isCrewSlot(s)) {
        player.leo.push({ id: s.id, kind: 'crew', face: s.face === 'secondary' ? 'secondary' : 'primary' });
      } else if (isColonistSlot(s)) {
        retireColonistId(state, player, s.id);
        exported += 1;
      } else {
        destroyToDeckBottom(state, s.id);
      }
    }
    player.rocket.stack = [];
    player.rocket.tank = 0;
    player.rocket.activeThrusterId = null;
    player.rocket.activeProspectorId = null;
    recallIfEmpty(player);
    log += ' The stack exits the map ad astra - godspeed.';
    for (let i = 0; i < exported; i++) {
      const exo = exomigrateOne(state, player);
      if (exo.ok) log += ` ${exo.log}`; else break;
    }
  }
  return { ok: true, state, rolled, log };
}

// dispatcher (not the handler) maintains turnActions / turnRedo.
const FUNCTIONAL = {
  INCOME: applyIncome,
  FUNDRAISE: applyFundraise,
  PROMOTE: applyPromote,
  SWAP_BIG_CUBE: applySwapBigCube,
  BUILD_ELEVATOR: applyBuildElevator,
  EPIC_HAZARD: applyEpicHazard,
  LOBBY: applyLobby,
  SITE_REFUEL: applySiteRefuel,
  AIR_EATER_REFUEL: applyAirEaterRefuel,
  DIRT_REFUEL: applyDirtRefuel,
  DELIVERY: applyDelivery,
  BUILD_COLONY: applyBuildColony,
  EVAC_CREW_HOME: applyEvacCrewHome,
  HOMESTEAD: applyHomestead,
  FREE_INSPIRATION: applyFreeInspiration,
  NANOFACTURE: applyNanofacture,
  EXOMIGRATE: applyExomigrate,
  SET_LAW_STAR: applySetLawStar,
  MOVE: applyMove,
  MOVE_FACTORY: applyMoveFactory,
  MOVE_FLEET: applyMoveFleet,
  BUILD_ROCKET: applyBuildRocket,
  BUY_CARD: applyBuyCard,
  BOOST: applyBoost,
  TRANSFER: applyTransfer,
  DIRTSIDE_ASCENT: applyDirtsideAscent,
  THE_MARTIAN: applyMartian,
  TRANSFER_FUEL: applyTransferFuel,
  DISSOLVE_OUTPOST: applyDissolveOutpost,
  CREATE_OUTPOST: applyCreateOutpost,
  DECOMMISSION: applyDecommission,
  CLAIM_JUMP: applyClaimJump,
  CONVERT_OUTPOST: applyConvertOutpost,
  REFUEL: applyRefuel,
  CASH_WATER: applyCashWater,
  DUMP: applyDump,
  CAN_FUEL: applyCanFuel,
  LOAD_FUEL: applyLoadFuel,
  DUMP_FUEL_CARD: applyDumpFuelCard,
  LOAD_FREIGHTER_WATER: applyLoadFreighterWater,
  TRANSFER_FUEL_CARD: applyTransferFuelCard,
  FREE_MARKET: applyFreeMarket,
  DISCARD: applyDiscard,
  SET_ROUTE: applySetRoute,
  CLEAR_ROUTE: applyClearRoute,
  SET_WIRING: applySetWiring,
  SET_CARD_GROUPS: applySetCardGroups,
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
  SURRENDER_GLORY: applySurrenderGlory,
  STOW_FREIGHTER: applyStowFreighter,
  DEPLOY_FREIGHTER: applyDeployFreighter,
  RIDE_ELEVATOR: applyRideElevator,
  STOW_BERNAL: applyStowBernal,
  DEPLOY_BERNAL: applyDeployBernal,
  ANCHOR_BERNAL: applyAnchorBernal,
  UNANCHOR_BERNAL: applyUnanchorBernal,
  SET_BERNAL_FIGURE: applySetBernalFigure,
  BUILD_BERNAL_ONTO_HOME: applyBuildBernalOntoHome,
};

function pickPayload(op) {
  switch (op.kind) {
    case 'MOVE': return { toSiteId: op.toSiteId, hazardPay: !!op.hazardPay, ...(Array.isArray(op.hazardChoices) ? { hazardChoices: op.hazardChoices.slice() } : {}), segments: op.segments, pickupChit: op.pickupChit !== false, ...(op.acetyleneLiftoff ? { acetyleneLiftoff: true } : {}), ...(op.unit ? { unit: op.unit } : {}) };
    case 'MOVE_FACTORY': return { fromSiteId: op.fromSiteId, toSiteId: op.toSiteId, hazardPay: !!op.hazardPay, segments: op.segments };
    case 'MOVE_FLEET': return { moves: op.moves };
    case 'AIR_EATER_REFUEL': return { hazardPay: !!op.hazardPay };
    case 'PROMOTE': return { unit: op.unit, cardId: op.cardId, from: op.from };
    case 'HOMESTEAD': return { siteId: op.siteId, productCardId: op.productCardId, colonistCardId: op.colonistCardId };
    case 'FREE_INSPIRATION': return {};
    case 'NANOFACTURE': return { cardId: op.cardId, cardIds: op.cardIds };
    case 'EXOMIGRATE': return { ...(op.to != null ? { to: op.to } : {}), ...(op.placeDelegate === false ? { placeDelegate: false } : {}) };
    case 'SET_LAW_STAR': return { star: op.star };
    case 'SWAP_BIG_CUBE': return { factorySiteId: op.factorySiteId };
    case 'BUILD_ELEVATOR': return { pairKey: op.pairKey, hazardPay: !!op.hazardPay };
    case 'EPIC_HAZARD': return { cardId: op.cardId, hazardPay: !!op.hazardPay, humanCardId: op.humanCardId };
    case 'LOAD_GLORY': return {};
    case 'SURRENDER_GLORY': return { zone: op.zone };
    case 'BUILD_ROCKET': return { cardId: op.cardId, face: op.face, radSide: op.radSide };
    case 'BUY_CARD': return { cardId: op.cardId, free: op.free, cost: op.cost };
    case 'BOOST': return { cardIds: op.cardIds, radSides: op.radSides || {}, figures: op.figures || {}, ...(op.to ? { to: op.to } : {}) };
    case 'TRANSFER': return { cardIds: op.cardIds, cardId: op.cardId, from: op.from, to: op.to, ...(op.newOutpostSite != null ? { newOutpostSite: op.newOutpostSite } : {}) };
    case 'DIRTSIDE_ASCENT': return { from: op.from, ...(op.bernalUnit != null ? { bernalUnit: op.bernalUnit } : {}) };
    case 'THE_MARTIAN': return { from: op.from, humanCardId: op.humanCardId, toSiteId: op.toSiteId };
    case 'STOW_FREIGHTER': return { to: op.to };
    case 'DEPLOY_FREIGHTER': return { from: op.from, cardId: op.cardId };
    case 'RIDE_ELEVATOR': return { unit: op.unit, to: op.to };
    case 'STOW_BERNAL': return { cardId: op.cardId, to: op.to };
    case 'DEPLOY_BERNAL': return { from: op.from, cardId: op.cardId, figure: op.figure };
    case 'ANCHOR_BERNAL': return { cardId: op.cardId, hazardPay: !!op.hazardPay };
    case 'BUILD_BERNAL_ONTO_HOME': return { cardId: op.cardId };
    case 'UNANCHOR_BERNAL': return { cardId: op.cardId, discardColonistIds: op.discardColonistIds };
    case 'SET_BERNAL_FIGURE': return { cardId: op.cardId, figure: op.figure };
    case 'TRANSFER_FUEL': return { letter: op.letter, amount: op.amount, direction: op.direction, from: op.from, to: op.to };
    case 'DISSOLVE_OUTPOST': return { letter: op.letter };
    case 'CREATE_OUTPOST': return { siteId: op.siteId };
    case 'DECOMMISSION': return { cardIds: op.cardIds, cardId: op.cardId, from: op.from };
    case 'CLAIM_JUMP': return { siteId: op.siteId };
    case 'REFUEL': return { amount: op.amount, ...(op.unit ? { unit: op.unit } : {}) };
    case 'CASH_WATER': return { amount: op.amount, ...(op.unit ? { unit: op.unit } : {}) };
    case 'DUMP': return { amount: op.amount, ...(op.unit ? { unit: op.unit } : {}) };
    case 'CAN_FUEL': return { amount: op.amount };
    // TRANSFER_FUEL_CARD and LOAD_FREIGHTER_WATER were MISSING here, so they
    // recorded an empty payload and an UNDO later in the same turn replayed them
    // with no arguments: TRANSFER_FUEL_CARD died on `bad_transfer` (no from/to),
    // which is what surfaced as undo_replay_failed. Any turn containing either op
    // could not be undone at all.
    case 'TRANSFER_FUEL_CARD': return { cardId: op.cardId, from: op.from, to: op.to, amount: op.amount };
    case 'LOAD_FREIGHTER_WATER': return { letter: op.letter, amount: op.amount };
    // These two genuinely carry nothing: both derive everything from the state
    // (CONVERT_OUTPOST picks the first free outpost letter itself). Listed
    // EXPLICITLY rather than left to the default so the audit below stays
    // meaningful - "no case" now means "someone forgot", not "takes no payload".
    case 'INCOME': return {};
    case 'CONVERT_OUTPOST': return {};
    case 'LOAD_FUEL': return { cardId: op.cardId, holder: op.holder };
    case 'DUMP_FUEL_CARD': return { cardId: op.cardId, holder: op.holder };
    case 'FREE_MARKET': return { cardId: op.cardId, cardIds: op.cardIds, leoCardId: op.leoCardId };
    case 'FUNDRAISE': return { place: op.place, moveFrom: op.moveFrom, moveTo: op.moveTo, freeDelegate: op.freeDelegate, discard: op.discard, star: op.star };
    case 'LOBBY': return { ideology: op.ideology };
    case 'DISCARD': return { cardId: op.cardId };
    case 'SET_ACTIVE_THRUSTER': return { cardId: op.cardId };
    case 'SET_ACTIVE_PROSPECTOR': return { cardId: op.cardId };
    case 'SET_RADIATOR_SIDE': return { cardId: op.cardId };
    case 'AFTERBURN': return {};
    case 'PROSPECT': return { siteId: op.siteId, turn: op.turn, round: op.round, relocateFrom: op.relocateFrom, ...(op.stackId ? { stackId: op.stackId } : {}), ...(op.prospectorId ? { prospectorId: op.prospectorId } : {}) };
    case 'PROSPECT_REROLL': return { siteId: op.siteId };
    case 'SITE_REFUEL': return { siteId: op.siteId, mode: op.mode, outpost: op.outpost, ...(op.toBernal ? { toBernal: true } : {}) };
    case 'DIRT_REFUEL': return { amount: op.amount, ...(op.unit ? { unit: op.unit } : {}), ...(op.toBernal ? { toBernal: true } : {}) };
    case 'DELIVERY': return { siteId: op.siteId, letter: op.letter, cardId: op.cardId };
    case 'BUILD_COLONY': return { cardId: op.cardId, colonyType: op.colonyType, ...(op.crewTo ? { crewTo: op.crewTo } : {}) };
    case 'EVAC_CREW_HOME': return { cardIds: op.cardIds };
    case 'INDUSTRIALIZE': return { siteId: op.siteId, cardIds: op.cardIds, freeDelegate: op.freeDelegate, from: op.from };
    case 'MINE_REVIVAL': return { siteId: op.siteId };
    case 'ET_PRODUCE': return { siteId: op.siteId, cardId: op.cardId, letter: op.letter, isNewOutpost: !!op.isNewOutpost, ...(op.radSide ? { radSide: op.radSide } : {}), ...(op.toBernal ? { toBernal: true } : {}) };
    // Route ops ride the undo stack like every other functional op, so
    // an UNDO/REDO replay (rebuildFromBase) must carry their payload or
    // the replay would re-run SET_ROUTE with no segments and silently
    // wipe a route the player still has planned.
    case 'SET_ROUTE': return { segments: op.segments, ...(op.unit ? { unit: op.unit } : {}) };
    case 'SET_WIRING': return { wiring: op.wiring };
    case 'SET_CARD_GROUPS': return { groups: op.groups };
    case 'CLEAR_ROUTE': return op.unit ? { unit: op.unit } : {};
    default:
      // Reaching here means an op rides the per-turn undo stack (this function is
      // called from exactly one place: recording an action onto it) but nobody
      // added a case. Its payload is dropped, so the first UNDO in any turn
      // containing it replays the op with no arguments - it fails and the whole
      // turn becomes un-undoable, or worse, replays as something else. Silent
      // until a player hit it in a real game, so make it noisy for the next one.
      console.warn(`[undo] ${op.kind} has no pickPayload case - its payload will be`
        + ' dropped and an UNDO in this turn will replay it with no arguments.');
      return {};
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
    // _replay tells handlers this action ALREADY happened and is being
    // reconstructed, not freshly judged. A rule that tightened mid-game (e.g. a
    // newly added factory-assist restriction) must not retroactively reject a
    // move that was legal when the player made it, or every later UNDO would die
    // with undo_replay_failed. Effects still apply; only the now-stricter VALIDATION
    // gate is trusted.
    const res = handler(s, { kind: a.kind, ...a.payload, _replay: true }, currentPlayer(s));
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
  // M2: each Bernal is its own independent dirt-crawler mover - one move per turn,
  // separate from the rocket + freighter. Harmless to refill when none are in play.
  for (const bn of (player.bernals || [])) bn.movesRemaining = MOVES_PER_TURN;
  player.discardsRemaining = DISCARDS_PER_TURN;
  // One refuel per site per turn: clear the per-turn ledger so the
  // sites this player tapped last turn are refuellable again.
  player.refueledSites = [];
  // Dirt refuel is capped per turn (7 tanks via the moon cable for a non-crew
  // triangle, else 1); reset the per-turn tally.
  player.dirtTanksThisTurn = 0;
  // Afterburn lasts one turn: clear it as the player's next turn opens.
  if (player.rocket) player.rocket.afterburnEngaged = false;
  // Solar-sail thrust is LOCKED at the START of the turn (user decision): record
  // the SLUG the ship begins the turn on. rocketSolarZone resolves the zone from
  // it fresh (via zoneOfSlug, which handles waypoints too), so a solar-driven
  // thruster's zone modifier stays fixed for the whole turn even as the ship
  // flies to other zones - AND an in-flight game with no stamp yet still resolves
  // correctly (rocketSolarZone falls back to the live position).
  if (player.rocket) player.rocket.turnStartSiteId = player.rocket.siteId != null ? player.rocket.siteId : null;
  // M0 Lobby is once per turn and its law-use lasts only this turn.
  player.lobbiedThisTurn = false;
  player.lobbiedLaws = [];
  // M2 colonist specialists' per-turn free operations (2C1) reset.
  player.colonistOpsUsed = { prospector: 0, industrialist: 0 };
  state.turnActions = [];
  state.turnRedo = [];
  // I4b No Double Moves: a component's one-move-per-turn lock lifts at the start
  // of its owner's next turn, so clear every movedThisTurn stamp now.
  clearMovedStamps(player);
  // A tied-vote pick that a PRIOR player opened but never resolved is dropped as
  // the turn passes (the star simply held where it was). But a pick that belongs
  // to the player whose turn is opening now is KEPT so they can break it at the
  // top of their turn - this is how an Anarchy vote tally hands the tie to the
  // first player as their lap reopens.
  if (state.pendingLawStar && String(state.pendingLawStar.chooserId) !== String(player.profileId)) {
    state.pendingLawStar = null;
  }
  // Scrum Troubleshooters (Norse): any glitch on this player's stacks is repaired
  // remotely as their turn opens, no Human needed.
  repairNorseGlitchesAtTurnStart(state, player);
  // A rocket parked on an aerobrake corridor takes a fresh descent hazard as the
  // turn opens (user 2026-06-27); the entry turn is never double-rolled (the
  // arriving move ran its own descent roll, and at that turn's open the rocket
  // was not yet on the corridor).
  aerobrakeParkingHazard(state, player);
  // Home Bernal Profits (2B3d, M2): +1 aqua at the start of every turn this
  // player has a Home Bernal anchored - the station earns its keep servicing
  // Earth. This is the RULEBOOK's one standing income, not the removed
  // invented factory income; it exists only while the Home Bernal stays
  // anchored (unanchoring forfeits it, 2B6d).
  if (state.m2 && (player.bernals || []).some((bn) => bn && bn.anchored && isHomeBernal(bn))) {
    player.aqua = (player.aqua | 0) + 1;
    pushNews(state, '\u{1F3E0}', `${player.name}'s Home Bernal earned 1 aqua servicing Earth (bank ${player.aqua}).`);
  }
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
    destroyRocket(player, state);
    pushNews(state, '☠️', `${player.name}'s stack burned up parked on the aerobrake at ${at} (rolled a 1).`);
  } else {
    pushNews(state, '\u{1FA82}', `${player.name}'s parked stack rode out the aerobrake descent (rolled ${d6}).`);
  }
}

// Rule 2A6: an open colonist berth (colonists < allowance) with a colonist
// available to draw MUST be filled by an exomigration (a free action) - so a
// player may not END their turn while one is open. Gated on a non-empty queue,
// matching the client's berth-open pulse; an impossible exomigration (empty
// queue) never soft-locks the turn.
function mustExomigrate(state, player) {
  return !!(state.m2
    && countColonists(player) < colonistAllowance(player)
    && colonistQueueFor(state, player).length > 0);
}
// ----- V9 Sirens: First Contact, Heroism, Technology Trade -----
//
// All three fire on the same trigger: ending your turn with one of YOUR Humans
// standing where a Human of the OTHER species stands. They only exist while both
// species are seated, which is exactly when the libraries are split, so
// state.sirenDecks doubles as the "is there another species to meet?" test.

// Every site where this player has a Human, as a set of slugs. LEO / the home
// base is deliberately EXCLUDED: two factions sitting in their own home stacks
// have not met anybody.
function humanSitesOf(state, p) {
  const out = new Set();
  const add = (siteId, slots) => {
    if (siteId == null) return;
    if (stackHasHuman(state, slots)) out.add(String(siteId));
  };
  add(p.rocket && p.rocket.siteId, p.rocket && p.rocket.stack);
  for (const o of Object.values(p.outposts || {})) add(o && o.siteId, o && o.cards);
  if (p.freighter) add(p.freighter.siteId, p.freighter.stack);
  for (const bn of (p.bernals || [])) add(bn && bn.siteId, bn && bn.stack);
  for (const [slug, c] of Object.entries(state.colonies || {})) {
    if (c && c.ownerId === p.profileId) out.add(String(slug));
  }
  return out;
}

// The first site where this player meets the OTHER species, or null.
function sirenContactSite(state, player) {
  if (!state.sirenDecks) return null;
  const mine = humanSitesOf(state, player);
  if (!mine.size) return null;
  for (const other of state.players) {
    if (other === player || other.species === player.species) continue;
    for (const slug of humanSitesOf(state, other)) {
      if (mine.has(slug)) return slug;
    }
  }
  return null;
}

// Which patent deck the Technology Trade draws from. The rule says "the top card
// of the other species' patent deck" without naming one, and this implementation
// has six-plus decks, so the player names it on the END_TURN op
// (op.techTradeDeck). With none named - the usual case, since ending a turn is
// one click - fall back to the FULLEST deck, which is deterministic, never a
// no-op while any card remains, and stays the same across an undo replay.
function techTradeDeckType(decks, want) {
  if (want && Array.isArray(decks[want]) && decks[want].length) return want;
  let best = null;
  for (const [type, cards] of Object.entries(decks || {})) {
    if (!Array.isArray(cards) || !cards.length) continue;
    if (!best || cards.length > decks[best].length
        || (cards.length === decks[best].length && type < best)) best = type;
  }
  return best;
}

// Resolve the contact rules for the player whose turn is ending. Returns log
// fragments; mutates state. No-op in every game without both species.
function resolveSirenContact(state, player, op = {}) {
  const slug = sirenContactSite(state, player);
  if (!slug) return [];
  const out = [];
  const site = siteById(slug);
  const where = (site && site.name) || slug;

  // Heroism (Lc): the FIRST time the two species meet, the active player takes a
  // chit. Once per game, tracked on the state so a later meeting does not repeat
  // it. Reuses the glory-chit pool - the published tracker calls them "Glory &
  // Heroism chits", so a heroism chit IS a zone chit.
  if (!state.sirenFirstContact) {
    state.sirenFirstContact = { siteId: slug, byId: player.profileId, round: state.round | 0 };
    // A HEROISM chit, not a zone chit: its own kind, worth a flat 2 VP, banked
    // straight away. It consumes no heliocentric zone, binds to no carrier, and
    // does not have to ride home - so it is pushed to `claimed` rather than to
    // the carried `chits` the zone glory uses.
    player.glory = player.glory || {};
    player.glory.claimed = player.glory.claimed || [];
    player.glory.claimed.push({
      kind: 'heroism', zone: HEROISM_CHIT_ZONE, side: 'back',
      vp: SIREN_HEROISM_VP, turn: state.turn | 0, crewId: null,
    });
    player.glory.vps = (player.glory.vps | 0) + SIREN_HEROISM_VP;
    out.push(`First contact at ${where}: ${player.name} takes a heroism chit (+${SIREN_HEROISM_VP} VP).`);
  }

  // Technology Trade: take the top card of the other species' patent deck.
  const theirs = isSirenFaction(player) ? state.decks : state.sirenDecks;
  const type = techTradeDeckType(theirs, op.techTradeDeck);
  if (type) {
    const cardId = theirs[type].shift();
    player.hand = player.hand || [];
    player.hand.push(cardId);
    out.push(`Technology Trade at ${where}: ${player.name} takes ${cardNameOf(cardId)} from the ${isSirenFaction(player) ? 'Earthling' : 'Sirenian'} ${type} deck.`);
  }
  return out;
}

// V9 First Contact, SOLO half (the V6/KPI route): "you automatically meet the
// board's KPI threshold for the solar cycle in which your Humans first land on a
// Uranian moon." Note this is a DIFFERENT trigger from the multiplayer Heroism
// rule above - landing on a Uranian moon, not meeting the other species.
//
// A "Uranian moon" is a site in the Uranus solar zone that is not the aerostat
// (a floating city is not a moon). Records the board cycle that is currently
// being played, which runBoardMeeting then reads to force `met`.
function noteSirenUranianLanding(state, player) {
  if (!state.sirens || !state.ceoSolo) return [];
  if (state.sirenKpiFreeCycle != null) return [];
  for (const slug of humanSitesOf(state, player)) {
    // A true MOON, not merely a site in the Uranus zone - that zone also holds
    // four centaurs, a comet and the aerostat, none of which is a moon.
    if (!isUranianMoon(slug)) continue;
    const cycle = ((state.ceoBoardHistory || []).length) + 1;
    state.sirenKpiFreeCycle = cycle;
    const site = siteById(slug);
    return [`First contact: Humans have landed on ${(site && site.name) || slug}. The Board's expectations for this Solar Cycle are met automatically.`];
  }
  return [];
}

function applyEndTurn(state, _op, player) {
  if (mustExomigrate(state, player)) return fail('must_exomigrate');
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

  // V9 Sirens: First Contact / Heroism / Technology Trade all resolve here,
  // because all three trigger on ENDING the turn colocated with the other
  // species. No-op in every game without both species seated.
  const contact = resolveSirenContact(state, player, _op || {});
  if (contact.length) log += ' ' + contact.join(' ');
  // The SOLO half of First Contact rides the same turn boundary, but on its own
  // trigger (a Uranian moon landing rather than a meeting).
  const landed = noteSirenUranianLanding(state, player);
  if (landed.length) log += ' ' + landed.join(' ');

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

  // CEO Solitaire (V6): the Board convenes each Solar Cycle. Run the KPI check
  // BEFORE the normal game-length cap so a missed number (fired) or the last
  // Seniority Disk leaving the cycle (tenure complete) ends the game here with a
  // verdict the board-meeting screen reads.
  if (state.ceoSolo) {
    const bm = runBoardMeeting(state, log);
    log = bm.logStr;
    if (!bm.met || (state.seniorityCycle | 0) <= 0) {
      const player = state.players[0];
      const finalVp = ceoSoloScore(state, player).total | 0;
      state.status = 'finished';
      state.finishedAt = Date.now();
      state.pendingFirstPlayer = null;
      state.turnActions = [];
      state.turnRedo = [];
      state.ceoVerdict = bm.met ? 'completed' : 'fired';
      computeFinalScores(state);
      log += bm.met
        ? ` The Board is satisfied after ${bm.cycle} cycles. Tenure judged ${ceoRating(finalVp)} (${finalVp} VP).`
        : ` The Board's KPI was not met. ${player.name} is removed as CEO.`;
      return { ok: true, state, log };
    }
    // Met, more cycles to run: fall through and open the next round.
  }

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

  // L1 Climate Control Bernal (white/HOME): "You are always the 1st player,
  // superseding all other claimants." Runs BEFORE Martial Law and the normal
  // rotation handoff so it wins over both - every round-close, whoever holds
  // an anchored, HOME (white-face) Climate Control Bernal becomes first
  // player directly, with no chooser prompt. Mirrors applySetFirstPlayer's
  // cube-overflow handoff (the marker is one of the holder's 7 cubes).
  if (state.m2) {
    const climateHolder = state.players.find((p) => (p.bernals || []).some((bn) => bn
      && isHomeBernal(bn) && bn.cardId === 'ber_l1_climate_control_bernal' && !(bn.promoted || bn.face === 'secondary')));
    if (climateHolder) {
      const idx = state.players.indexOf(climateHolder);
      state.firstPlayerIndex = idx;
      state.activeIndex = idx;
      state.pendingFirstPlayer = null;
      state.turnActions = [];
      state.turnRedo = [];
      const baseLog = ` ${climateHolder.name}'s Climate Control Bernal makes them first player.`;
      if (!state.ceoSolo && cubesInPlay(state, climateHolder.profileId) > FACTORY_CUBES) {
        state.pendingFreeCube = { playerId: climateHolder.profileId, reason: 'first_player' };
        return { ok: true, state, log: log + baseLog + ` ${climateHolder.name} has all 7 cubes in play - free one for the first-player marker.` };
      }
      openTurnFor(state, climateHolder);
      return { ok: true, state, log: log + baseLog };
    }
  }

  // O6b: Martial Law (Authority in force) prevents changing the 1st Player at the
  // end of a cycle. Skip the rotation handoff - the current first player simply
  // leads the next round again.
  if (state.firstPlayerRotation && n >= 2 && lawInForce(state, 'authority')) {
    state.activeIndex = firstIdx;
    state.turnActions = [];
    state.turnRedo = [];
    openTurnFor(state, state.players[firstIdx]);
    log += ` Martial Law holds the first player - ${state.players[firstIdx].name} leads again.`;
    return { ok: true, state, log };
  }

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
  // A "hazardous lander burn" Site (Individuality end-game award): its gravity
  // well descent reaches a burn pad that carries a landing hazard. The OLD check
  // read the SITE node's own hazard flag, which is never set (hazards ride the
  // burn / descent nodes, not the site), so the award always scored 0. Walk the
  // same well as siteHasLanderBurn and test the pad's hazard.
  return siteHasHazardousLanderBurn(
    String(siteId),
    (s) => neighborSlugs(s),
    (s) => { const n = nodeBySlug(s); return n ? n.type : null; },
    (s) => { const n = nodeBySlug(s); return !!(n && n.hazard); },
  );
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
// A player's total glory VP for scoring: the BANKED chits (glory.claimed, at
// the side they were banked on) PLUS chits a crew is still CARRYING in the
// field (glory.chits), which score their FRONT value. A carried chit was never
// hauled home to flip to its back (big) value, but it is still a claimed Glory
// space and MUST score at game end - otherwise VP riding on a crew that never
// returned to LEO silently vanished from the final tally (the reported
// "vp on crew not assigned at end game" bug).
function playerGloryVp(player) {
  const g = player && player.glory;
  if (!g) return 0;
  // A HEROISM chit (V9) carries its own flat value and is not a heliocentric
  // zone, so it is read off the chit. Every ZONE chit still revalues from the
  // shared table at scoring time, deliberately, so a table edit takes effect.
  const chitVp = (c, side) => (isHeroismChit(c)
    ? (c.vp | 0)
    : ((ZONE_CHIT_VPS[c.zone] || { front: 1, back: 1 })[side === 'back' ? 'back' : 'front']) | 0);
  let vp = 0;
  if (Array.isArray(g.claimed)) for (const c of g.claimed) vp += chitVp(c, c.side);
  if (Array.isArray(g.chits)) for (const c of g.chits) vp += chitVp(c, 'front');
  return vp;
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
  // M2 Futures endgame pass. Every earned star scores - a completed Future is
  // permanent (1D2) and is tracked apart from its card, so nothing re-checks
  // the card here. Dynamic stars (Beanstalk / Pan Sapiens / Dyson Bubble /
  // ET Life / Star Wisp) compute their VP at this point; New Venus / Footfall
  // clear the printed tokens BEFORE the market prices are read.
  const futuresVpBy = {};
  if (state.m2) {
    for (const p of state.players) {
      let vpSum = 0;
      const ctx = buildFutureCtx(state, p);
      for (const star of (p.futureStars || [])) {
        const sc = futureStarScore(state, p, star, ctx);
        star.scoredVp = sc.vp;
        vpSum += sc.vp;
        const goal = futureGoalForCard(star.cardId);
        if (goal && typeof goal.clearsTokensAt === 'function') {
          try {
            for (const sid of goal.clearsTokensAt(ctx)) {
              delete state.factories[sid];
              delete state.colonies[sid];
              delete state.discs[sid];
            }
          } catch { /* nothing to clear */ }
        }
      }
      futuresVpBy[p.profileId] = vpSum;
    }
  }
  // ALL factories on the map as the shared scorer's plain shape (the global
  // count of each spectral drives its Exploitation Track market price). Space-
  // Elevator-connected factories are flagged so the scorer doubles their price.
  const elevatorSet = elevatorConnectedFactorySet(state);
  const allFactories = Object.entries(state.factories || {})
    .map(([slug, f]) => ({ ownerId: f.ownerId, spectralType: f.spectralType || 'C', elevatorConnected: elevatorSet.has(slug) }));
  const firstIdx = state.firstPlayerIndex || 0;
  const scores = state.players.map((p, idx) => {
    const cubeVp = m0 ? playerDelegatesPlaced(asm, p.profileId) : 0;
    const awardVp = (m0 && winnerKey) ? ideologyAwardVp(state, p, winnerKey) : 0;
    // state.colonies is keyed BY site slug, so entries() (not values()) - the
    // slug is what tells a Sirenian dome whether it sits at an aerostat.
    const sirenScale = isSirenPlayer(state, p);
    const ownColonies = Object.entries(state.colonies || {})
      .filter(([, c]) => c && c.ownerId === p.profileId)
      .map(([slug, c]) => ({ type: c.type || 'other', solar: sirenDomeIsSolar(state, p.profileId, slug) }));
    const claims = ownedClaimCount(state.discs, p.profileId);
    const outposts = p.outposts ? Object.keys(p.outposts).length : 0;
    const rocket = (p.rocket && Array.isArray(p.rocket.stack) && p.rocket.stack.length > 0) ? 1 : 0;
    const firstPlayer = idx === firstIdx ? 1 : 0;
    // Glory VP is derived from the chits' zone + side via ZONE_CHIT_VPS (the
    // data source), not the running p.glory.vps snapshot, so a chit's value edit
    // revalues at scoring time. Counts BANKED chits AND chits still carried by a
    // crew in the field (front value) - see playerGloryVp.
    const gloryVp = playerGloryVp(p);
    const futuresVp = futuresVpBy[p.profileId] || 0;
    const bernalVp = bernalScoreVp(state, p);
    const b = scorePlayer({
      ownerId: p.profileId, factories: allFactories, ownColonies, sirenDomes: sirenScale,
      claims, outposts, rocket, firstPlayer, glory: gloryVp, cubeVp, awardVp, futuresVp, bernalVp,
    });
    return {
      profileId: p.profileId, name: p.name, color: p.color || null,
      cubeVp, awardVp, spectralVp: b.spectralVp, tokenVp: b.tokenVp,
      tokenBreakdown: b.tokenBreakdown, firstPlayer: b.firstPlayer,
      factoryVp: b.factoryCount, colonyVp: b.colonyVp, gloryVp, futuresVp, bernalVp,
      futureStars: (p.futureStars || []).map((s) => ({ key: s.key, vp: s.vp, endgame: !!s.endgame, scoredVp: s.scoredVp | 0, dynamic: typeof (futureGoalForCard(s.cardId) || {}).endgameVp === 'function', endgameVpLabel: (futureGoalForCard(s.cardId) || {}).endgameVpLabel || null })),
      total: b.total, aqua: p.aqua | 0,
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

// ----- CEO Solitaire (V6): board meetings + KPI -----

// The player's accumulated victory-point breakdown, mid-game, using the SAME
// scorer as the end-game tally (data/endgame-scoring.js). The end-game ideology
// award is not counted here (no winner is decided until the game ends), but M0
// delegate cubes are. Returns the full scorePlayer breakdown (so callers can
// build the board-meeting tally rows) plus a convenience `total`.
function ceoSoloScore(state, player) {
  const asm = assemblyOf(state);
  const m0 = !!state.m0;
  const elevatorSet = elevatorConnectedFactorySet(state);
  const allFactories = Object.entries(state.factories || {})
    .map(([slug, f]) => ({ ownerId: f.ownerId, spectralType: f.spectralType || 'C', elevatorConnected: elevatorSet.has(slug) }));
  const sirenScale = isSirenPlayer(state, player);
  const ownColonies = Object.entries(state.colonies || {})
    .filter(([, c]) => c && c.ownerId === player.profileId)
    .map(([slug, c]) => ({ type: c.type || 'other', solar: sirenDomeIsSolar(state, player.profileId, slug) }));
  const claims = ownedClaimCount(state.discs, player.profileId);
  const outposts = player.outposts ? Object.keys(player.outposts).length : 0;
  const rocket = (player.rocket && Array.isArray(player.rocket.stack) && player.rocket.stack.length > 0) ? 1 : 0;
  const gloryVp = playerGloryVp(player);
  const cubeVp = m0 ? playerDelegatesPlaced(asm, player.profileId) : 0;
  // Anchored Bernals + Futures stars count toward the live CEO tally too, so the
  // board KPI reflects ALL current game pieces (user 2026-07-05). Score the
  // stars through futureStarScore, the SAME helper the endgame tally and the
  // transparent live scoreboard use. Summing the raw printed `star.vp` instead
  // silently dropped every DYNAMIC Future (Biomechs, Boyle, Juiced Cosmonauts,
  // Lloyd's, Hiiper, Poodle all print 0 and carry their whole value in
  // goal.endgameVp), so a completed one scored 0, vanished from the board
  // meeting's tally rows, and left the CEO short against the KPI.
  const bernalVp = bernalScoreVp(state, player);
  const futureCtx = state.m2 ? buildFutureCtx(state, player) : null;
  const futureStars = state.m2 ? (player.futureStars || []).map((s) => {
    const sc = futureStarScore(state, player, s, futureCtx);
    return { key: s.key, vp: s.vp | 0, endgame: !!s.endgame, scoredVp: sc.vp, dynamic: sc.dynamic, endgameVpLabel: sc.label };
  }) : [];
  const futuresVp = futureStars.reduce((sum, s) => sum + (s.scoredVp | 0), 0);
  const b = scorePlayer({
    ownerId: player.profileId, factories: allFactories, ownColonies, sirenDomes: sirenScale,
    claims, outposts, rocket, firstPlayer: 1, glory: gloryVp, cubeVp, awardVp: 0,
    bernalVp, futuresVp,
  });
  // Carry the scored star list alongside the totals so the board meeting + the
  // CEO scoreboard can name the Futures they are crediting.
  b.futureStars = futureStars;
  return b;
}

// Add fatality disks to the demand pile (V6 rule E7). A Crew lost to a hazard /
// rad / flare roll is a fatality. No-op outside ceoSolo (and crew are always
// immune to pad explosions, so those never add a fatality).
function addFatality(state, n = 1) {
  if (!state.ceoSolo || !state.demandPile || n <= 0) return;
  state.demandPile.fatality = (state.demandPile.fatality | 0) + n;
}
// A Crew killed by a hazard / rad / flare roll DIES and respawns in the LEO
// Stack (it is never a hand card). In CEO Solitaire that death is also a
// FATALITY on the Board's record (a disk to the demand pile, +3 to the next
// KPI); other modes just respawn it. Use at every roll-death crew loss, NOT at
// a voluntary move (anarchy decommission, build colony, crew draft).
function crewDeathToLeo(state, owner, slot) {
  // Tragedy (rule L.b): a Human that dies carrying a glory chit does NOT ride it
  // home. The chit is dropped onto the board at its FRONT (low) value the moment
  // the crew is decommissioned. Resolve it BEFORE the crew card respawns at LEO,
  // otherwise the chit stays bound to the (respawned, still-in-play) crew and
  // sails home to score at BACK value later - the reported bug.
  resolveDeadCrewChits(state, owner, slot.id);
  (owner.leo = owner.leo || []).push({ id: slot.id, kind: 'crew', face: slot.face });
  addFatality(state, 1);
}
// Score at FRONT value + bank home every glory chit bound to a Human that just
// died (crewId === deadId). Mirror of the front-value settlement in
// homeOrphanedGloryChits / migrateGloryCrewBindings, but keyed on the specific
// dead carrier rather than "carriers all gone" (a death-respawn keeps the card
// in play, so the orphan check would never fire for it).
function resolveDeadCrewChits(state, owner, deadId) {
  if (!deadId || !owner.glory || !Array.isArray(owner.glory.chits)) return;
  const dead = owner.glory.chits.filter((c) => c && c.crewId === deadId);
  if (!dead.length) return;
  owner.glory.claimed = owner.glory.claimed || [];
  let vps = 0;
  const zones = [];
  for (const c of dead) {
    const vp = ((ZONE_CHIT_VPS[c.zone] || { front: 1, back: 1 }).front) | 0;
    owner.glory.claimed.push({ zone: c.zone, side: 'front', vp, turn: state.turn, crewId: null });
    vps += vp;
    zones.push(c.zone);
  }
  owner.glory.vps = (owner.glory.vps | 0) + vps;
  owner.glory.chits = owner.glory.chits.filter((c) => !dead.includes(c));
  const note = `${owner.name}'s glory chit${zones.length === 1 ? '' : 's'} (${zones.join(', ')}) scored at front value (+${vps} VP) - the crew died carrying ${zones.length === 1 ? 'it' : 'them'} (tragedy).`;
  pushNews(state, '🎖', note);
}

// The tally rows the board-meeting screen reads out one by one, and the same
// rows the turn-bar CEO scoreboard lists under "Where your VP comes from".
// They sum to the breakdown's `total` (awardVp is 0 mid-game), so the running
// total lands on the score. Empty lines are dropped. ONE builder for both
// surfaces so the meeting and the scoreboard can never disagree.
// The Futures row names the completed Futures, so a player who earned one can
// see WHICH star is being credited instead of a bare category total.
function ceoScoreSteps(b) {
  const stars = (b && Array.isArray(b.futureStars)) ? b.futureStars : [];
  const named = stars
    .map((s) => String(s.key || '').replace(/\s*FUTURE\s*$/i, '').trim())
    .filter(Boolean);
  return [
    { label: '🏭 Factories', vp: b.spectralVp | 0 },
    { label: '🎟 Tokens', vp: b.tokenVp | 0 },
    { label: '🏙 Colonies', vp: b.colonyVp | 0 },
    { label: '⚓ Bernals', vp: b.bernalVp | 0 },
    { label: named.length ? `⭐ Futures (${named.join(', ')})` : '⭐ Futures', vp: b.futuresVp | 0 },
    { label: '🏅 Glory', vp: b.glory | 0 },
    { label: '🏛 Delegates', vp: b.cubeVp | 0 },
  ].filter((s) => s.vp);
}

// One Board Meeting (V6, Sunspot Cycle Phase D2). Computes the KPI from the
// demand pile BEFORE the new Seniority Disk lands (so meeting N reads N-1
// seniority disks: 0, then 8, then 18, ... matching the rulebook's worked 21 =
// 2*(7+2) + 1*3), checks it against the player's accumulated VP, records the
// cycle, then clears fatalities and moves one Seniority Disk into the pile.
// Returns { met, kpi, score, cycle }. Mutates state; appends to the log string.
function runBoardMeeting(state, logStr) {
  const pile = state.demandPile || (state.demandPile = { seniority: 0, fatality: 0 });
  const seniority = pile.seniority | 0;
  const fatality = pile.fatality | 0;
  const kpi = seniority * (7 + seniority) + fatality * 3;
  const player = state.players[0];
  const b = ceoSoloScore(state, player);
  const score = b.total | 0;
  state.ceoBoardHistory = state.ceoBoardHistory || [];
  const cycle = state.ceoBoardHistory.length + 1;
  // V9 First Contact: the cycle in which this faction's Humans first landed on a
  // Uranian moon meets the Board's KPI automatically, whatever the tally says.
  const firstContact = state.sirenKpiFreeCycle === cycle;
  const met = firstContact || score >= kpi;
  const steps = ceoScoreSteps(b);
  state.ceoBoardHistory.push({
    cycle, kpi, score, income: player.aqua | 0, met,
    fatalities: fatality, seniorityInPile: seniority, steps,
  });
  // Remove all fatality disks; move one Seniority Disk from the cycle into the pile.
  pile.fatality = 0;
  pile.seniority = seniority + 1;
  state.seniorityCycle = Math.max(0, (state.seniorityCycle | 0) - 1);
  const tail = firstContact ? ' (First Contact: the Board is satisfied regardless)' : '';
  return { met, kpi, score, cycle, logStr: `${logStr} Board Meeting ${cycle}: KPI ${kpi}, delivered ${score} VP - ${met ? 'expectations met' : 'below expectations'}${tail}.` };
}
// Live CEO Solitaire scoreboard for the client: the CURRENT delivered VP and
// the KPI the NEXT Board Meeting will demand (read off the demand pile as it
// Per-player anchored-Bernal VP, keyed by profileId. The gameView stamps this
// onto each snapshot player as `bernalVp` so the client's live scoring panel can
// score anchored Bernals (Home = 6, Dirtside = its hydration, plus promoted
// bonuses) without re-deriving the server's map adjacency. Empty off M2.
export function bernalVpByPlayer(state) {
  const out = {};
  if (!state || !state.m2 || !Array.isArray(state.players)) return out;
  for (const p of state.players) out[p.profileId] = bernalScoreVp(state, p);
  return out;
}
// Live, transparent scoreboard for the client's scoring tab: every player's full
// "if the game ended now" VP breakdown, ranked. The SAME shared scorer
// (data/endgame-scoring.js#scorePlayer) the final tally runs, so the live panel
// can never drift from the authoritative end-game total. PURE read - mutates
// nothing (unlike the endgame path's Futures re-check, so it uses each player's
// running star VP). The winning-ideology award is undecided mid-game, so awardVp
// is 0 here; delegate cubes (cubeVp) are real and counted. Returns
// { globalPerSpectral, players: [{ ...breakdown, rank }] } sorted by total.
export function liveScoreboard(state) {
  if (!state || !Array.isArray(state.players)) return { globalPerSpectral: {}, players: [] };
  const m0 = !!state.m0;
  const m2 = !!state.m2;
  // Read the assembly directly (do NOT call assemblyOf, which lazily creates one
  // and would mutate the view snapshot this runs on). An m0 game always has an
  // assembly from setup; guard anyway so this stays a pure read.
  const asm = (m0 && state.assembly) ? state.assembly : null;
  const elevatorSet = elevatorConnectedFactorySet(state);
  const allFactories = Object.entries(state.factories || {})
    .map(([slug, f]) => ({ ownerId: f.ownerId, spectralType: f.spectralType || 'C', elevatorConnected: elevatorSet.has(slug) }));
  const globalPerSpectral = {};
  for (const f of allFactories) globalPerSpectral[f.spectralType] = (globalPerSpectral[f.spectralType] || 0) + 1;
  const firstIdx = state.firstPlayerIndex || 0;
  const players = state.players.map((p, idx) => {
    const sirenScale = isSirenPlayer(state, p);
    const ownColonies = Object.entries(state.colonies || {})
      .filter(([, c]) => c && c.ownerId === p.profileId)
      .map(([slug, c]) => ({ type: c.type || 'other', solar: sirenDomeIsSolar(state, p.profileId, slug) }));
    const claims = ownedClaimCount(state.discs, p.profileId);
    const outposts = p.outposts ? Object.keys(p.outposts).length : 0;
    const rocket = (p.rocket && Array.isArray(p.rocket.stack) && p.rocket.stack.length > 0) ? 1 : 0;
    const firstPlayer = idx === firstIdx ? 1 : 0;
    const gloryVp = playerGloryVp(p);
    const cubeVp = asm ? playerDelegatesPlaced(asm, p.profileId) : 0;
    const bernalVp = m2 ? bernalScoreVp(state, p) : 0;
    // Each accomplished Future scores its OWN current value (the same re-check +
    // dynamic endgameVp bonus the endgame tally runs), so the live scoring tab
    // shows what a Future is worth NOW instead of a bare "endgame" placeholder.
    const futureCtx = m2 ? buildFutureCtx(state, p) : null;
    const liveStars = m2 ? (p.futureStars || []).map((s) => {
      const sc = futureStarScore(state, p, s, futureCtx);
      return { key: s.key, vp: s.vp | 0, endgame: !!s.endgame, scoredVp: sc.vp, dynamic: sc.dynamic, endgameVpLabel: sc.label };
    }) : [];
    const futuresVp = liveStars.reduce((sum, s) => sum + (s.scoredVp | 0), 0);
    const b = scorePlayer({
      ownerId: p.profileId, factories: allFactories, ownColonies, sirenDomes: sirenScale,
      claims, outposts, rocket, firstPlayer, glory: gloryVp,
      cubeVp, awardVp: 0, futuresVp, bernalVp,
    });
    return {
      profileId: p.profileId, name: p.name, color: p.color || null,
      spectralRows: b.spectralRows, spectralVp: b.spectralVp,
      tokenBreakdown: b.tokenBreakdown, tokenVp: b.tokenVp,
      colonyByType: b.colonyByType, colonyCount: b.colonyCount, colonyVp: b.colonyVp,
      gloryVp, cubeVp, futuresVp, bernalVp,
      futureStars: liveStars,
      total: b.total, aqua: p.aqua | 0,
    };
  });
  const ranked = [...players].sort((a, b) => b.total - a.total || b.aqua - a.aqua);
  ranked.forEach((s, i) => { s.rank = i + 1; });
  return { globalPerSpectral, players };
}
// stands right now), plus the per-category VP breakdown. Pure read; used by the
// gameView to power the turn-bar "Scenario" score modal. Returns null off solo.
export function ceoSoloView(state) {
  if (!state || !state.ceoSolo) return null;
  const pile = state.demandPile || { seniority: 0, fatality: 0 };
  const seniority = pile.seniority | 0;
  const fatality = pile.fatality | 0;
  const kpi = seniority * (7 + seniority) + fatality * 3;
  const player = state.players && state.players[0];
  const b = player ? ceoSoloScore(state, player) : { total: 0 };
  const steps = ceoScoreSteps(b);
  return {
    score: b.total | 0,
    kpi,
    met: (b.total | 0) >= kpi,
    seniorityInPile: seniority,
    fatalities: fatality,
    cyclesLeft: state.seniorityCycle | 0,
    meetingsDone: (state.ceoBoardHistory || []).length,
    steps,
  };
}
// Victory-band rating for the no-Futures CEO Solitaire end (V6 e.).
function ceoRating(score) {
  if (score >= 60) return 'Legendary';
  if (score >= 40) return 'Memorable';
  if (score >= 35) return 'Good';
  if (score >= 30) return 'Controversial';
  return 'Unremarkable';
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
  for (const p of state.players) {
    // Each player deals from THEIR OWN library, which under a Sirens split is
    // their species' half. Same map for everyone in every other game.
    const decks = decksFor(state, p);
    const types = DECK_TYPES.filter((t) => Array.isArray(decks[t]));
    p.hand = p.hand || [];
    while (p.hand.length < DRAFT_HAND_SIZE) {
      const avail = types.filter((t) => decks[t].length);
      if (!avail.length) break;   // decks exhausted (only at absurd player counts)
      const t = avail[gen.int(avail.length)];
      p.hand.push(decks[t].shift());
    }
  }
  state.rng = state.rng || {};
  state.rng.cursor = gen.cursor;
}
function applyDraftPick(state, op, player) {
  const deckType = String(op.deckType || '');
  const deck = decksFor(state, player)[deckType];
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
  const deck = decksFor(state, player)[deckType];
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
  // Card groups are a cosmetic organizer edited outside the undo stack (by ANY
  // player, on or off turn), so carry every player's live groups across the
  // rebuild - including the ACTIVE player's - so an undo never wipes a relabel.
  for (let i = 0; i < rebuilt.players.length; i++) {
    const lp = live.players && live.players[i];
    if (lp && lp.rocket && rebuilt.players[i] && rebuilt.players[i].rocket && lp.rocket.groups) {
      rebuilt.players[i].rocket.groups = lp.rocket.groups;
    }
  }
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
  // Reveal barrier: an action that revealed hidden information (an
  // exomigration draws the next face-down colonist off the secret queue, so
  // undoing it would leak who is on top and the robot count) also can't be
  // taken back. (User 2026-07-06.)
  if (last.noUndo) return fail('reveal_blocks_undo');

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


// V9 Sirens: classify a colony dome for the Sirenian dome scale (M2b amended).
// A dome is "solar" - worth +3 rather than +1 - at a push colony or an aerostat.
// The aerostat half reads off the site id, which names them explicitly.
//
// A PUSH COLONY is a colony with a push-sat (user 2026-07-28: "push colony is
// push sat colony"). The push-sat is the `push` card property - the 🛰 badge -
// so a colony counts when its owner has a push-sat card standing at that site,
// in any unit they have there. Read live at scoring time rather than stamped on
// the colony at build time, because a push-sat can arrive or leave afterwards.
//
// Reuses the engine's own isAerostatSite (which takes a site OBJECT), so the
// aerostat definition here is the same one SCOOP powers already use rather than
// a second copy of the rule.
function pushSatAtSite(state, ownerId, siteId) {
  const owner = state.players.find((p) => p.profileId === ownerId);
  if (!owner || siteId == null) return false;
  const scan = (slots) => (slots || []).some((sl) => faceHasPush(slotFace(sl, PATENTS_BY_ID[sl.id])));
  if (owner.rocket && String(owner.rocket.siteId) === String(siteId) && scan(owner.rocket.stack)) return true;
  for (const o of Object.values(owner.outposts || {})) {
    if (o && String(o.siteId) === String(siteId) && scan(o.cards)) return true;
  }
  if (owner.freighter && String(owner.freighter.siteId) === String(siteId)
    && scan(owner.freighter.stack)) return true;
  for (const bn of (owner.bernals || [])) {
    if (bn && String(bn.siteId) === String(siteId) && scan(bn.stack)) return true;
  }
  return false;
}
function sirenDomeIsSolar(state, ownerId, siteId) {
  return isAerostatSite({ id: siteId }) || pushSatAtSite(state, ownerId, siteId);
}

// V9 Sirens (V9c): is this player the ONLY member of their species? With the
// libraries split, that means nobody else can bid on a lot off their deck, so
// the Research Auction falls back to the V4c substitute. Always false when the
// libraries are not split - an all-one-species table shares one library, so
// everyone can bid on everyone's lot.
function sirenSoleOfSpecies(state, player) {
  if (!state.sirenDecks || !player) return false;
  return !state.players.some((p) => p !== player && p.species === player.species);
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
  // The guided tutorial keeps auctions SIMPLE: the winner gets exactly the one
  // card that was up for bid, with NO bonus supports. The free bonus cards would
  // otherwise pile up in the 4-card hand and stall the acquire step (the player
  // ends up stuck, unable to auction the next part). In a tutorial the player
  // auctions each of the six parts directly (the generator included), one card
  // per auction, so the hand clears cleanly with one boost each.
  if (!state.tutorial) {
    // The bonus supports come from the same library the lot did. Under a Sirens
    // species split only same-species players may bid (see applyAuctionBid), so
    // the winner's library IS the auctioneer's.
    const decks = decksFor(state, winner);
    for (const t of supportBonusDecks(card)) {
      const deck = decks[t];
      if (deck && deck.length) bonusIds.push(deck.shift());
    }
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
  // A bidder who can no longer TAKE the lot - their hand filled (a mid-lot trade
  // can push them over the academia limit) or they're at the type's ownership
  // cap - is auto-passed and CANNOT win. Drop their standing bid to 0 so it
  // never sets the high bid, leads, or reads as "top"; a sale to them would just
  // fail (hand_limit). If they free a hand slot they simply re-bid. Aqua blocks
  // stay dynamic and aren't zeroed here (a priced-out bid is already sub-high).
  for (const p of (state.players || [])) {
    if ((a.bids[p.profileId] | 0) > 0
        && (biddingBlockedByHand(state, p) || biddingBlockedByOwnership(state, p))) {
      a.bids[p.profileId] = 0;
    }
  }
  const entries = Object.entries(a.bids);
  let high = 0;
  for (const [, amt] of entries) if (amt > high) high = amt;
  a.highBid = high;
  // Leader = whoever sits at the high bid; the auctioneer wins ties, but
  // only if they actually placed a bid. Bids can be 0, so the leader is
  // computed whenever ANY bid exists (not just when high > 0).
  let leader = null;
  if (entries.length) {
    // Object keys are always strings, but a profileId may be a number (real
    // games) or a string (the tutorial's bot seats). Resolve each bid key back
    // to the player's ACTUAL profileId so the leader compares equal to it later
    // (a bare Number() parse turned a string id into NaN).
    const pidOf = (key) => {
      const p = state.players.find((pp) => String(pp.profileId) === String(key));
      return p ? p.profileId : key;
    };
    // Marketeer (SpaceX) wins ties even over the auctioneer: a top-bid holder
    // of the privilege takes the lead. Else the auctioneer wins ties; else the
    // first bidder at the floor.
    const mktE = entries.find(([k, amt]) =>
      amt === high && hasPrivilege(state, playerByProfile(state, pidOf(k)), 'MARKETEER'));
    const aucBid = a.bids[a.auctioneerId];
    if (mktE) leader = pidOf(mktE[0]);
    else if (aucBid != null && aucBid === high) leader = a.auctioneerId;
    else { const e = entries.find(([, amt]) => amt === high); leader = e ? pidOf(e[0]) : null; }
  }
  a.highBidderId = leader;
  a.awaiting = allBiddersActed(state) ? 'auctioneer' : 'bidders';
}

// A player whose hand is already at the limit can't take the lot (they
// can neither bid nor be sold to), so they're auto-passed: they never
// hold up the auctioneer and don't need to act. Their hand can't change
// mid-auction (an open lot freezes every other op), so this is stable
// for the life of the lot.
// L4s Pharmaceutics Bernal (promoted, anchored anywhere): "...& impose
// academia hand limit on all opponents." Closes any Skunkworks-based hand-
// limit exemption an OPPONENT of the holder would otherwise have - the
// holder's own Skunkworks (gained by the same ability) still exempts them,
// since this only checks OTHER players' bernals.
function pharmaceuticsImposesOn(state, player) {
  return (state.players || []).some((p) => p !== player && (p.bernals || []).some((bn) => bn && bn.anchored
    && bn.cardId === 'ber_l4s_pharmaceutics_bernal' && (bn.promoted || bn.face === 'secondary')));
}
function biddingBlockedByHand(state, player) {
  // ignores the limit, unless a rival Pharmaceutics Bernal imposes it anyway
  if (hasPrivilege(state, player, 'SKUNKWORKS') && !pharmaceuticsImposesOn(state, player)) return false;
  return ((player.hand || []).length >= AUCTION_HAND_LIMIT);
}

// A player ALREADY at the lot type's ownership cap (a GW thruster or
// Freighter they own one of - 1A4; or two Bernal Cards - 2B3, counting hand /
// in play / a Bernal's stack) can never win it: their bid is rejected. So like
// a full-hand bidder they're auto-passed and never hold up the close. The lot's
// card and a player's ownership of that type can't change mid-lot (an open lot
// freezes every other op), so this is stable for the life of the lot.
function biddingBlockedByOwnership(state, player) {
  const a = state.auction;
  if (!a) return false;
  const lotCard = PATENTS_BY_ID[a.cardId];
  return !!(lotCard && atOwnershipCap(player, lotCard.type));
}

// A bidder OUTBID beyond their bank can neither tie nor raise the standing
// high bid, so they are auto-passed while that holds: the close is never held
// up on them and no nudge is sent. DELIBERATELY DYNAMIC (unlike the hand /
// ownership blocks): aqua can change mid-lot through a trade, and a player who
// gains the money re-enters automatically - they are waited on again and may
// bid. The standing leader is never blocked (their own bid IS the high).
function biddingBlockedByAqua(state, player) {
  const a = state.auction;
  if (!a) return false;
  if (a.highBidderId === player.profileId) return false;
  const high = a.highBid | 0;
  // The least a bidder must pay to actually TAKE the lot. When the AUCTIONEER
  // holds the high bid they win ties, so a rival has to EXCEED it (high + 1) - a
  // player who can only tie is priced out and auto-passes, so the auctioneer can
  // close. EXCEPT a Marketeer (SpaceX) wins ties even over the auctioneer, so a
  // tie (high) is enough for them to take the lot - they are not priced out at a
  // tie. Against a NON-auctioneer leader a tie can still contend (the auctioneer
  // names the buyer among equal bids), so matching the high is enough for anyone.
  const auctioneerLeads = a.highBidderId != null && a.highBidderId === a.auctioneerId;
  const marketeer = hasPrivilege(state, player, 'MARKETEER');
  const need = (auctioneerLeads && !marketeer) ? high + 1 : high;
  return (player.aqua | 0) < need;
}

// A bidder who can't take the lot right now (full hand, already owns its
// singleton, or priced out of the bidding) is auto-passed: they don't act and
// never hold up the close. Hand + ownership are stable for the life of the
// lot; the aqua block is dynamic (see biddingBlockedByAqua).
function cannotTakeLot(state, player) {
  return biddingBlockedBySpecies(state, player) || biddingBlockedByHand(state, player)
    || biddingBlockedByOwnership(state, player) || biddingBlockedByAqua(state, player);
}

// V9 Sirens: with the libraries split, a lot off one species' deck is closed to
// the other (V9b). Such a player is not merely refused if they try to bid - they
// must count as already-done, or the auctioneer could never close a lot that an
// ineligible seat is silently blocking. Always false in every other game.
function biddingBlockedBySpecies(state, player) {
  if (!state.sirenDecks || !state.auction) return false;
  const auctioneer = playerByProfile(state, state.auction.auctioneerId);
  return !!(auctioneer && player && auctioneer.species !== player.species);
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
  // players who can't take it (full hand, or already own the lot's
  // singleton) count as already acted so they never hold up the close,
  // even after a reopen resets `acted`.
  return others.every((p) =>
    acted.includes(p.profileId) || auto.includes(p.profileId) || cannotTakeLot(state, p));
}

// Players the open auction is currently waiting on, in seat order. During
// bidding: every non-auctioneer who has NOT yet acted / passed and can still
// take the lot (mirrors allBiddersActed's done-set). During the close phase
// (everyone has responded): the auctioneer, who must name a buyer. Empty when
// no auction is open. Used by the lobby "auction needed: @a, @b" line.
export function auctionWaitingOn(state) {
  const a = state && state.auction;
  if (!a || !Array.isArray(state.players)) return [];
  if (a.awaiting === 'auctioneer' || allBiddersActed(state)) {
    const auc = state.players.find((p) => p.profileId === a.auctioneerId);
    return auc ? [auc] : [];
  }
  const acted = a.acted || [];
  const auto = a.autoPassed || [];
  return state.players.filter((p) =>
    p.profileId !== a.auctioneerId
    && !acted.includes(p.profileId)
    && !auto.includes(p.profileId)
    && !cannotTakeLot(state, p));
}

// Highest standing bid that is NOT this player's own. The auctioneer wins
// ties, so this is the least they must match to lead - and therefore the
// floor they may walk an overbid back down to.
function highestOtherBid(state, profileId) {
  const bids = (state.auction && state.auction.bids) || {};
  let hi = 0;
  for (const [pid, amt] of Object.entries(bids)) {
    if (String(pid) !== String(profileId)) hi = Math.max(hi, amt | 0);
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
  // Skunkworks (Shimizu) ignores the academia hand limit when starting. The
  // Equality law (Research Grants: pay 1 aqua for the deck-top card) also ignores
  // it - it is a subsidized take, not a competitive auction, so no hand limit
  // applies (user 2026-07-07).
  const usingEquality = !!op.useEquality && playerCanUseLaw(state, player, 'equality');
  const exemptBySkunkworks = hasPrivilege(state, player, 'SKUNKWORKS') && !pharmaceuticsImposesOn(state, player);
  if ((player.hand || []).length >= AUCTION_HAND_LIMIT
      && !exemptBySkunkworks && !usingEquality) return fail('hand_limit');
  const deckType = String(op.deckType || '');
  // M1 games may also auction the two Terawatt decks; an m1-off game is the
  // base six only (zero bleed-through).
  const auctionableDecks = [...DECK_TYPES, ...(state.m1 ? M1_DECK_TYPES : []), ...(state.m2 ? M2_DECK_TYPES : [])];
  if (!auctionableDecks.includes(deckType)) return fail('bad_deck');
  // Under a Sirens species split you auction from YOUR OWN library; the other
  // species' decks are not yours to put up (V9b).
  const myDecks = decksFor(state, player);
  const deck = myDecks[deckType];
  if (!deck || !deck.length) return fail('deck_empty');
  // Can't initiate a research auction for a card type you're already at the
  // ownership cap for: a Freighter / GW thruster you own one of (1A4), or a
  // Bernal when you already hold two Bernal Cards (2B3). The singleton + Bernal
  // decks are single-type, so the deck name IS the card type being revealed.
  if (atOwnershipCap(player, deckType)) return fail(ownershipCapError(deckType));

  // The V4c substitute Research Auction. There is no competitive auction when
  // nobody else can bid, so instead of bidding you TAKE the top card of the
  // patent deck for your Operation, plus one card off the top of each of its
  // bonus support decks (I2g). The cost is a number of Aquas equal to the number
  // of cards taken. The academia hand limit (I2a) still applies (checked above).
  // Marketeer (SpaceX) privilege: buy 3 cards for 2 aqua (a 1-aqua rebate once
  // three or more cards are taken). The Equality "Research Grants" opt-in below
  // still wins when the player explicitly chose it.
  //
  // TWO ways to end up here: CEO Solitaire (one player at the table), and V9
  // Sirens where you are the ONLY member of your species - with the libraries
  // split, a lot off your deck is closed to everyone else, so an "auction" would
  // have exactly one eligible bidder. Same rule, same substitute.
  if ((state.ceoSolo || sirenSoleOfSpecies(state, player)) && !op.useEquality) {
    const topCard = PATENTS_BY_ID[deck[0]];
    // Which bonus support decks actually have a card to give (empty decks add no
    // card and no cost). Peek before mutating so an unaffordable take is rejected
    // cleanly without shifting any deck.
    let bonusTypes = supportBonusDecks(topCard).filter((t) => myDecks[t] && myDecks[t].length);
    // Subsidized Research (solitaire Equality law): the top card AND the first
    // bonus support are FREE; a SECOND bonus support may be bought for 2 aqua
    // (op.paySecondBonus). The law caps the take at two bonus supports.
    const subsidized = playerCanUseLaw(state, player, 'equality');
    let cost, dealTail = '';
    if (subsidized) {
      const wantSecond = !!op.paySecondBonus && bonusTypes.length >= 2;
      bonusTypes = bonusTypes.slice(0, wantSecond ? 2 : 1);
      cost = wantSecond ? 2 : 0;
      dealTail = ' (Subsidized Research)';
    } else {
      const taken = 1 + bonusTypes.length;
      const marketeer = hasPrivilege(state, player, 'MARKETEER');
      cost = (marketeer && taken >= 3) ? taken - 1 : taken;
      if (marketeer && taken >= 3) dealTail = ' (Marketeer: 3 cards for 2)';
    }
    if (player.aqua < cost) return fail('insufficient_aqua');
    const cardId = deck.shift();
    const bonusIds = bonusTypes.map((t) => myDecks[t].shift());
    (player.hand = player.hand || []).push(cardId, ...bonusIds);
    player.aqua -= cost;
    player.opsRemaining -= 1;
    // A research take commits the turn (it moves a deck + hand), like an auction.
    state.turnActions = [];
    state.turnRedo = [];
    const tc = PATENTS_BY_ID[cardId];
    const bonusTail = bonusIds.length ? ` plus ${bonusIds.length} bonus support${bonusIds.length === 1 ? '' : 's'}` : '';
    return {
      ok: true, state,
      log: `${player.name} took ${tc ? tc.name : cardId} from the ${deckType} deck${bonusTail} for ${cost} aqua${dealTail}.`,
    };
  }

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

  // Renaissance Man (colonist power, auctionDeckSearch): "If initiating a
  // research auction, can search through one patent deck and choose the card
  // to be auctioned" - pick any undrawn card from THIS deck instead of the
  // blind top. Splice it out (no reshuffle) so the rest of the deck order is
  // preserved.
  let cardId;
  const searchId = op.deckSearchCardId != null ? String(op.deckSearchCardId) : null;
  if (searchId && playerHasColonistPower(state, player, 'auctionDeckSearch')) {
    const idx = deck.indexOf(searchId);
    if (idx < 0) return fail('not_in_deck');
    cardId = deck.splice(idx, 1)[0];
  } else {
    cardId = deck.shift();
  }
  player.opsRemaining -= 1;
  state.auction = {
    deckType, cardId,
    auctioneerId: player.profileId,
    // The auctioneer opens holding the lot at 0 (they win ties), so their bid
    // reads 0 rather than "-" from the start and they lead until someone raises.
    // 0 is a valid bid; applyAuctionSell keys "no bids" off key-presence, so an
    // unraised close still keeps the lot free (price 0 / unopposed).
    bids: { [player.profileId]: 0 }, passed: [], acted: [], autoPassed: [],
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
  // V9 Sirens (V9b): with the libraries split, "Earthlings cannot touch Siren
  // decks and vice versa". The lot came off the auctioneer's library, so only
  // players of the auctioneer's OWN species can bid on it. Trade / negotiation
  // is the only route across, and that is a different op.
  if (state.sirenDecks) {
    const auctioneer = playerByProfile(state, a.auctioneerId);
    if (auctioneer && auctioneer.species !== bidder.species) return fail('other_species_deck');
  }
  // Skunkworks (Shimizu) ignores the academia hand limit when bidding, unless
  // a rival's Pharmaceutics Bernal imposes it anyway.
  const bidderExempt = hasPrivilege(state, bidder, 'SKUNKWORKS') && !pharmaceuticsImposesOn(state, bidder);
  if ((bidder.hand || []).length >= AUCTION_HAND_LIMIT && !bidderExempt) return fail('hand_limit');
  // Ownership cap: can't bid on a card type you're already at the limit for - a
  // GW thruster / Freighter you own one of (1A4), or a Bernal when you already
  // hold two Bernal Cards (2B3). Winning it would exceed the cap.
  const lotCard = PATENTS_BY_ID[a.cardId];
  if (lotCard && atOwnershipCap(bidder, lotCard.type)) {
    return fail(ownershipCapError(lotCard.type));
  }
  const amount = Number(op.amount);
  // Bids can be 0 (claim it free); only negatives are invalid.
  if (!Number.isInteger(amount) || amount < 0) return fail('bad_amount');

  a.bids = a.bids || {};
  const isAuctioneer = bidder.profileId === a.auctioneerId;
  const prevBid = (bidder.profileId in a.bids) ? a.bids[bidder.profileId] : null;
  // Floor: a non-auctioneer must at least tie the current high (ties are
  // allowed). Anyone who WINS TIES - the auctioneer, OR a Marketeer (SpaceX,
  // who wins ties even over the auctioneer) - has their floor exclude their own
  // bid: they only need to MATCH the top RIVAL bid to lead. That lets them walk
  // an accidental overbid back down to the real competition (e.g. a Marketeer
  // sitting at 3 dropping to tie the auctioneer's 2 and still winning) instead
  // of being trapped above it.
  const winsTies = isAuctioneer || hasPrivilege(state, bidder, 'MARKETEER');
  const rivalHigh = highestOtherBid(state, bidder.profileId);
  const floorBefore = winsTies ? rivalHigh : (a.highBid || 0);
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
        || cannotTakeLot(state, p))
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
  // Recompute right before resolving so a bidder who filled their hand mid-lot
  // (via a trade, the one op an open lot doesn't freeze) has their standing bid
  // dropped to 0 HERE too - not just on the bid/pass/trade that preceded. An
  // already-open lot that went stale before this dropped that bid then resolves
  // cleanly: the high / winner / Marketeer-tie checks below run off live bids, so
  // a "top" bidder who can no longer take the card no longer jams the close.
  recomputeAuction(state);
  const high = a.highBid || 0;
  // Resolve the named buyer by profileId, id-agnostically (bids/passes/acted all
  // key by the profileId value directly, so the close must too - a Number()
  // parse here rejected any non-numeric profileId, e.g. the tutorial's bot
  // seats). A numeric-id game still matches via the String() compare.
  const buyerPlayer = state.players.find((p) => String(p.profileId) === String(op.buyerId));
  if (!buyerPlayer) return fail('bad_buyer');
  const buyerId = buyerPlayer.profileId;

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
    // Marketeer (SpaceX): if a top bidder holds MARKETEER, they WIN the tie - the
    // auctioneer can't keep the lot or sell it to another tied bidder over them.
    // The auctioneer-wins-ties default is overridden here, so the close must name
    // the Marketeer. (The leader display already points at them; this enforces it
    // authoritatively at close, which is where the privilege was being ignored.)
    const mktPid = Object.keys(a.bids).find((pid) =>
      a.bids[pid] === high && hasPrivilege(state, state.players.find((p) => String(p.profileId) === String(pid)), 'MARKETEER'));
    if (mktPid != null && Number(mktPid) !== buyerId) return fail('marketeer_wins_tie');
    winner = playerByProfile(state, buyerId);
    if (!winner) return fail('winner_gone');
    price = high;
  }
  // Skunkworks (Shimizu) ignores the academia hand limit when taking the lot,
  // unless a rival's Pharmaceutics Bernal imposes it anyway.
  const winnerExempt = hasPrivilege(state, winner, 'SKUNKWORKS') && !pharmaceuticsImposesOn(state, winner);
  if ((winner.hand || []).length >= AUCTION_HAND_LIMIT && !winnerExempt) return fail('hand_limit');
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
    // Luna Treaty access can ride a deal: the FIRST PLAYER grants the other
    // party permission to prospect Luna as an atomic trade term (sealed with the
    // rest of the deal on accept). Abstract, so it trades anywhere (not in-space).
    lunaGrant: !!raw.lunaGrant,
  };
}

function sideHasInSpace(side) {
  return side.water > 0 || side.cargoCardIds.length > 0;
}
function sideIsEmpty(side) {
  return !side.aqua && !side.water && !side.handCardIds.length
    && !side.cargoCardIds.length && !side.abilities.length && !side.lunaGrant;
}

// Aqua a player can spend in a trade: their bank, plus - when parked at their
// HOME base - the water in their tank, which is 1:1 with aqua at the bank (so at
// home, fuel just IS aqua, for simplicity). Dirt has no cash value, so it never
// counts. A Siren's bank reaches Cordelia rather than LEO, which is why this
// asks rocketAtLeo (the home-base test) instead of `siteId == null`.
function spendableAqua(state, player) {
  let a = player.aqua | 0;
  const r = player.rocket;
  if (r && rocketAtLeo(state, player) && r.tankGrade !== 'dirt') a += Math.floor(r.tank || 0);
  return a;
}

// Validate that `owner` can currently deliver everything in `side`. Returns an
// error key, or null when the side is satisfiable. Re-run at accept time, since
// the board may have moved since the offer was made.
function validateTradeSide(state, owner, side) {
  if (spendableAqua(state, owner) < side.aqua) return 'insufficient_aqua';
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
  // Only the first player can grant Luna prospecting access (Luna Treaty), so a
  // lunaGrant term is deliverable only from the first player's side of the deal.
  if (side.lunaGrant) {
    const fp = lunaFirstPlayer(state);
    if (!fp || fp.profileId !== owner.profileId) return 'luna_not_first_player';
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
  if (side.lunaGrant) parts.push('Luna prospecting access');
  return parts.length ? parts.join(' + ') : 'nothing';
}

function applyTradeOffer(state, op, ctx) {
  // Trades are ALLOWED while an auction lot is open: a deal is how a bidder
  // priced out of the lot (auto-passed on aqua) gets back in - accepting a
  // trade recomputes the auction phase so a revived bidder is waited on
  // again. A winner who deals their aqua away can't break the close either:
  // AUCTION_SELL re-checks winner_cannot_pay before any aqua moves.
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
  // Luna Treaty access rides the deal: whichever side the first player put it on
  // grants the OTHER party permission to prospect Luna, sealed with the swap.
  if (t.give.lunaGrant) grantLunaAccess(state, partner.profileId);
  if (t.receive.lunaGrant) grantLunaAccess(state, initiator.profileId);
  reconcileRocketAfterTrade(initiator);
  reconcileRocketAfterTrade(partner);

  const giveSum = tradeSideSummary(state, t.give);
  const recvSum = tradeSideSummary(state, t.receive);
  state.trade = null;
  // A trade may re-open an auction for a priced-out bidder (aqua moved, and
  // the aqua auto-pass is dynamic): recompute the phase so `awaiting` flips
  // back to 'bidders' when someone can act again instead of leaving the
  // auctioneer's close armed against a revived bidder.
  if (state.auction) recomputeAuction(state);
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

// ---- Luna Treaty permission (base multiplayer rule) ----
// Consent-based, inert (they only flip a game-wide permission), so like the
// factory-access ops they run OFF TURN against the caller and bypass the turn
// guard. The first player answers a requester with GRANT / DENY; a granted
// player may then prospect Luna (see the gate in applyProspect).
function lunaFirstPlayer(state) {
  return (state.players || [])[state.firstPlayerIndex || 0] || null;
}
// Seal Luna prospecting permission for a player: set the grant + clear any
// pending request. Shared by the direct GRANT op and the trade-term path so both
// leave the same state.
function grantLunaAccess(state, granteeId) {
  const key = String(granteeId == null ? '' : granteeId);
  if (!key) return;
  state.lunaGrants = state.lunaGrants || {};
  state.lunaGrants[key] = true;
  if (state.lunaRequests) delete state.lunaRequests[key];
}
function applyRequestLunaProspect(state, op, ctx) {
  if ((state.players || []).length < 2) return fail('luna_treaty_solo');
  const caller = playerByProfile(state, ctx.profileId);
  if (!caller) return fail('not_a_player');
  const fp = lunaFirstPlayer(state);
  if (fp && fp.profileId === caller.profileId) return fail('you_are_first_player');
  const key = String(caller.profileId);
  if (state.lunaGrants && state.lunaGrants[key]) return fail('already_granted');
  state.lunaRequests = state.lunaRequests || {};
  state.lunaRequests[key] = true;
  return { ok: true, state, log: `${caller.name} requested the first player's permission to prospect Luna (Luna Treaty).` };
}
function applyGrantLunaProspect(state, op, ctx) {
  const caller = playerByProfile(state, ctx.profileId);
  if (!caller) return fail('not_a_player');
  const fp = lunaFirstPlayer(state);
  if (!fp || fp.profileId !== caller.profileId) return fail('not_first_player');
  const key = String(op.granteeId == null ? '' : op.granteeId);
  const grantee = state.players.find((p) => String(p.profileId) === key);
  if (!grantee) return fail('bad_grantee');
  grantLunaAccess(state, key);
  return { ok: true, state, log: `${caller.name} granted ${grantee.name} permission to prospect Luna (Luna Treaty).` };
}
function applyDenyLunaProspect(state, op, ctx) {
  const caller = playerByProfile(state, ctx.profileId);
  if (!caller) return fail('not_a_player');
  const fp = lunaFirstPlayer(state);
  if (!fp || fp.profileId !== caller.profileId) return fail('not_first_player');
  const key = String(op.granteeId == null ? '' : op.granteeId);
  if (state.lunaRequests) delete state.lunaRequests[key];
  const grantee = state.players.find((p) => String(p.profileId) === key);
  return { ok: true, state, log: `${caller.name} declined ${grantee ? grantee.name : 'a'} request to prospect Luna.` };
}
function applyRevokeLunaProspect(state, op, ctx) {
  const caller = playerByProfile(state, ctx.profileId);
  if (!caller) return fail('not_a_player');
  const fp = lunaFirstPlayer(state);
  if (!fp || fp.profileId !== caller.profileId) return fail('not_first_player');
  const key = String(op.granteeId == null ? '' : op.granteeId);
  if (state.lunaGrants) delete state.lunaGrants[key];
  const grantee = state.players.find((p) => String(p.profileId) === key);
  return { ok: true, state, log: `${caller.name} revoked ${grantee ? grantee.name : 'a player'}'s Luna prospecting permission.` };
}
const LUNA_ACCESS = {
  REQUEST_LUNA_PROSPECT: applyRequestLunaProspect,
  GRANT_LUNA_PROSPECT: applyGrantLunaProspect,
  DENY_LUNA_PROSPECT: applyDenyLunaProspect,
  REVOKE_LUNA_PROSPECT: applyRevokeLunaProspect,
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
  // An admin's promo-crew test pick (ctx.allowPromoCrew, see server/index.js)
  // may freely re-pick/swap a promo card at any time, draft phase or not -
  // that's the whole point of a test pick. A normal (non-promo) pick still
  // follows the regular draft-window rule.
  const isPromoPick = PROMO_CREW_IDS.has(String(op.cardId || ''));
  if (phase !== 'crew' && !(ctx.allowPromoCrew && isPromoPick)) return fail('crew_draft_closed');
  const player = playerByProfile(state, ctx.profileId);
  if (!player) return fail('not_a_player');
  const cardId = String(op.cardId || '');
  const face = op.face === 'secondary' ? 'secondary' : 'primary';
  const card = CREW_BY_ID[cardId];
  if (!card) return fail('unknown_crew');
  // Promo crew (data/crew.js#PROMO_CREW) is a Library-only reference set, not
  // a real starting faction - the client wizard already excludes it from a
  // normal pick, but never trust the client: reject here too unless the
  // caller is an admin's explicit test pick (ctx.allowPromoCrew, set by the
  // route layer from profileIsAdmin - see server/index.js) AND the game runs
  // the full m0+m1+m2 module stack the promo abilities depend on. Below that
  // bar the privilege can't fire, so the pick is refused.
  if (PROMO_CREW_IDS.has(cardId)) {
    if (!ctx.allowPromoCrew) return fail('promo_crew_admin_only');
    if (!(state.m0 && state.m1 && state.m2)) return fail('promo_crew_needs_modules');
  }
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
  // V9 The Sirens: the player also declares a SPECIES with their faction, and
  // the two Sirenian / Earthling rosters play out of different home bases -
  // Cordelia acts as LEO for a Siren (V9c). Only ever set in a Sirens game, so
  // player.species is absent everywhere else and homeBaseSiteId keeps returning
  // null for everyone.
  if (state.sirens) {
    // At most 2 Earthlings at the table (V9b); everyone else is a Siren, which
    // is also the default when the client names nothing.
    const wantEarth = String(op.species || '') === 'earthling';
    const otherEarthlings = state.players
      .filter((p) => p !== player && p.species === 'earthling').length;
    player.species = (wantEarth && otherEarthlings < 2) ? 'earthling' : 'siren';
    // Move the rocket to the home base the species implies. Safe to do here:
    // nothing has moved yet during the crew draft, so this is the rocket's
    // starting position rather than a teleport. A re-pick that switches species
    // re-homes it, which is why this reads the resolved species rather than
    // only ever setting Cordelia.
    player.rocket.siteId = homeBaseSiteId(state, player);
  }
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
    // CEO Solitaire (4G3a): seatStartingDelegate cleared all the player's cubes
    // before re-seating the home one, so re-add the additional Centrist delegate.
    if (state.ceoSolo) seatCeoSoloCentristDelegate(asm, player.profileId);
  }
  // Replace any previous crew slot in LEO with the new pick so a
  // re-pick during the draft doesn't leave a stale crew sitting in
  // the stack. First-time pickers just get one push.
  player.leo = (player.leo || []).filter((s) => s.kind !== 'crew');
  player.leo.push({ id: cardId, kind: 'crew', face });
  // The moment every player has a faction the crew draft is done. In a
  // draft-start game the card draft comes next ('draft'); otherwise play
  // begins ('play'). Server-side, not derived client-side, so spectators +
  // future joiners agree on the phase. Gated on phase === 'crew' (not just
  // "does everyone have a faction now") so an admin's promo-crew test
  // re-pick after the real draft already closed doesn't re-run the
  // draft-close transition (re-grant Secretary General's aqua, re-deal a
  // random draft, reset turn/round back to the opening state, ...).
  if (phase === 'crew' && state.players.every((p) => !!p.faction)) {
    // V9 Sirens (V9b): now that every species is known, cut the patent decks
    // and the colonist queue in two if both species are seated. Must run before
    // any deal below - a random draft would otherwise hand out cards from the
    // undivided library.
    splitLibrariesBySpecies(state);
    // Secretary General: start the game with +2 Aqua. Applied once, the moment
    // the crew draft closes (re-picks during the draft don't double it).
    // Module 2 moves the payout to the first anchoring of the Home Bernal
    // (see applyAnchorBernal), so an m2 game skips the opening credit.
    if (!state.m2) {
      for (const sg of playersWithPrivilege(state, 'SECRETARY_GENERAL')) {
        sg.aqua = (sg.aqua | 0) + 2;
      }
    }
    // Collective Bargaining (LEO Workers' Union promo crew, data/crew.js):
    // "Receive 2 Aqua at game start." Unlike Secretary General the printed
    // text carries no Module 2 deferral clause, so this pays out unconditionally.
    for (const cb of playersWithPrivilege(state, 'COLLECTIVE_BARGAINING')) {
      cb.aqua = (cb.aqua | 0) + 2;
    }
    // Base-game Solitaire variant (C5, B6a): a SOLO game (1 player, NOT the
    // separate CEO Solitaire V6 variant with its own fixed-budget economy)
    // whose chosen Faction carries Taxes, Secretary General, or Felonious
    // starts with an ADDITIONAL 6 Aqua, unconditionally - even under Module 2,
    // unlike Secretary General's own +2 above which Module 2 defers to the
    // first anchor.
    if (state.players.length === 1 && !state.ceoSolo) {
      const solo = state.players[0];
      const soloKey = privilegeOf(state, solo);
      if (soloKey === 'TAXES' || soloKey === 'SECRETARY_GENERAL' || soloKey === 'FELONIOUS') {
        solo.aqua = (solo.aqua | 0) + 6;
      }
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
  const baseLog = `${chooser ? chooser.name : 'The first player'} named ${next.name} first player.`;
  // The first-player marker IS one of the new leader's 7 cubes. If all 7 are
  // already on the board (factories + delegates), there's no cube for the
  // marker: freeze the table and prompt THEM to free one (remove a delegate, or
  // a factory when they hold no delegates) before their turn opens. cubesInPlay
  // already counts the marker for the current holder, so > 7 means over the cap.
  if (!state.ceoSolo && cubesInPlay(state, next.profileId) > FACTORY_CUBES) {
    state.pendingFreeCube = { playerId: next.profileId, reason: 'first_player' };
    return { ok: true, state, log: `${baseLog} ${next.name} has all 7 cubes in play - free one for the first-player marker.` };
  }
  openTurnFor(state, next);
  return { ok: true, state, log: baseLog };
}

// Free-cube handoff: when the first-player marker lands on a player who already
// has all 7 cubes deployed, applySetFirstPlayer freezes the table on
// pendingFreeCube and that player frees a cube here - removing an assembly
// delegate (op.delegate = the place) or, when they hold none, a factory
// (op.factory = the site). Clears the prompt and opens their turn. Validates its
// own caller (the pending player), so like SET_FIRST_PLAYER it runs while the
// table is frozen.
function applyFreeCube(state, op, ctx) {
  const pending = state.pendingFreeCube;
  if (!pending) return fail('no_free_cube_pending');
  const sameId = (a, b) => String(a) === String(b);
  if (!sameId(pending.playerId, ctx.profileId)) return fail('not_free_cube_chooser');
  const player = playerByProfile(state, ctx.profileId);
  if (!player) return fail('not_a_player');
  const delegate = op.delegate != null ? String(op.delegate) : null;
  const factory = op.factory != null ? String(op.factory) : null;
  let freedLog;
  if (delegate) {
    const asm = assemblyOf(state);
    if (!ASSEMBLY_PLACES.includes(delegate) || placeCount(asm, delegate, player.profileId) <= 0) {
      return fail('no_delegate_there');
    }
    setPlaceCount(asm, delegate, player.profileId, placeCount(asm, delegate, player.profileId) - 1);
    const nm = (IDEOLOGY_BY_KEY[delegate] || {}).name || (delegate === 'centrist' ? 'Centrist' : delegate);
    freedLog = `removed a delegate from ${nm}`;
  } else if (factory) {
    const fac = state.factories && state.factories[factory];
    if (!fac || !sameId(fac.ownerId, player.profileId)) return fail('not_your_factory');
    delete state.factories[factory];
    freedLog = `decommissioned the factory at ${(siteById(factory) || {}).name || factory}`;
  } else {
    return fail('bad_free_cube');
  }
  state.pendingFreeCube = null;
  const first = state.players[state.firstPlayerIndex || 0];
  if (first) openTurnFor(state, first);
  return { ok: true, state, log: `${player.name} ${freedLog} to seat the first-player marker.` };
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
  FREE_CUBE: applyFreeCube,
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
  if (prevState.pendingFreeCube) return fail('awaiting_free_cube');

  // Tutorial hard rails, applied to EVERY human op - including the auction /
  // trade / access ops that dispatch early below (they used to slip past the
  // functional-path rails check, which let the player auction the wrong deck,
  // bid against the bots, pass, or trade off-script). The human may take ONLY
  // the current step's scripted action; bots are server-driven and bypass, and
  // a debug sim bypasses. railsBlock only reads state, so prevState is fine.
  if (prevState.tutorial && !op.debug && !prevState.tutorial.bots.includes(ctx.profileId)) {
    const block = tutorialRailsBlock(prevState, op);
    if (block) return fail(block.error, { step: block.step, instruction: block.instruction });
  }

  // Auction ops bypass the turn guard below - bids/passes are sent
  // by non-active players, and each handler validates its own caller
  // against the auction roles.
  if (AUCTION[op.kind]) return tutorialAfterOp(AUCTION[op.kind](clone(prevState), op, ctx), op, ctx);

  // Trade ops are a side-channel deal: free, both-party consent, allowed at any
  // point on or off turn. Like auction ops they bypass the turn guard and
  // validate their own caller. They do NOT freeze the table - other players keep
  // playing - and they are ALLOWED while an auction is up (a bidder priced out of
  // the lot can trade for aqua to get back in; applyTradeAccept recomputes the
  // auction phase). The only self-block is another trade already open (one deal
  // surface at a time), which each handler checks via state.trade.
  if (TRADE[op.kind]) return TRADE[op.kind](clone(prevState), op, ctx);
  // Factory-access requests / grants are consent-based + inert (they only flip a
  // permission), so like trades they run off turn against the CALLER and bypass
  // the turn guard. An open auction does not block them (they touch no auction
  // state), matching trades.
  if (FACTORY_ACCESS[op.kind]) return FACTORY_ACCESS[op.kind](clone(prevState), op, ctx);
  // Luna Treaty request / grant / deny / revoke - same off-turn, consent-based
  // treatment as the factory-access ops (they only flip a game-wide permission).
  if (LUNA_ACCESS[op.kind]) return LUNA_ACCESS[op.kind](clone(prevState), op, ctx);

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

  // SET_CARD_GROUPS is a purely COSMETIC per-player organizer for the rocket-
  // stack view: it changes no rule and no shared state, so it ALWAYS runs against
  // the caller regardless of whose turn it is (a waiting player may relabel any
  // time) and it never rides the per-turn undo stack. The active player's own
  // groups are carried across an undo by carryOffTurnRoutes, like a route.
  if (op.kind === 'SET_CARD_GROUPS' && !op.debug) {
    const st = clone(prevState);
    const caller = playerByProfile(st, ctx.profileId);
    if (!caller) return fail('not_a_player');
    return applySetCardGroups(st, op, caller);
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
    // Bind any ownerless (legacy / in-progress) chit to a rocket crew, or score
    // it home at front when no crew is aboard to carry it. Runs BEFORE the orphan
    // check so a just-bound chit is then subject to the follow / orphan rules.
    const migrated = migrateGloryCrewBindings(res.state, { commit: true });
    if (migrated.length && res.log) res.log += ' ' + migrated.join(' ');
    // A chit whose carrier reached a Home Bernal scores at back (high) value,
    // just like riding home to LEO. Runs before the orphan check so a chit that
    // made it home is banked at back, not front.
    const homeBernaled = cashGloryAtHomeBernal(res.state);
    if (homeBernaled.length && res.log) res.log += ' ' + homeBernaled.join(' ');
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
      {
        kind: op.kind,
        payload: pickPayload(op),
        rolled: res.state.rng.cursor !== cursorBefore,
        // A handler may flag its action as a hard reveal barrier (exomigration
        // draws off the secret queue), so undo refuses even without a die roll.
        noUndo: !!res.noUndo,
      },
    ];
    res.state.turnRedo = [];
    return tutorialAfterOp(res, op, ctx);
  }
  return tutorialAfterOp(META[op.kind](state, op, player, ctx), op, ctx);
}

// Tutorial post-op: on the HUMAN's accepted op, set the current step's
// completion flags (sold / bought / rocketReady) off the result, then advance
// the mission step. No-op for bot callers and outside a tutorial game.
function tutorialAfterOp(res, op, ctx) {
  if (!res || !res.ok || !res.state || !res.state.tutorial) return res;
  const st = res.state;
  const t = st.tutorial;
  if (t.done || (ctx && t.bots.includes(ctx.profileId))) return res;
  const human = st.players.find((p) => !t.bots.includes(p.profileId));
  if (!human) return res;
  if (op.kind === 'AUCTION_SELL') {
    // Sold the bait lot to a bot -> the human banked the earn (soldThisStep
    // satisfies the 'sell' step). Winning a lot yourself doesn't set it.
    const buyer = st.players.find((p) => String(p.profileId) === String(op.buyerId));
    if (buyer && t.bots.includes(buyer.profileId)) t.soldThisStep = true;
  }
  // Assemble completes when the stack holds ALL FIVE kit parts, however the
  // cards got there - the granted parts sit in LEO and board via the free Cargo
  // Transfer (kind TRANSFER), not BUILD_ROCKET, so recompute on every accepted
  // op while the step is live. Both generators are required: the drive is a
  // chain (thruster <- capacitor bank <- photovoltaic) and a missing link means
  // an inactive rocket that stalls the fuel / fly steps.
  {
    const cur = tutorialCurrentStep(st);
    if (cur && cur.id === 'assemble') {
      const stackIds = new Set(((human.rocket && human.rocket.stack) || []).map((s) => s.id));
      if (TUTORIAL_STACK_PARTS.every((id) => stackIds.has(id))) t.rocketReady = true;
    }
  }
  // Grant the rest of the parts the moment the acquire step completes (Buggy
  // supplies what the player did not auction). Read the step BEFORE advancing,
  // then grant + narrate if that step was 'acquire' and it just advanced.
  const stepBefore = tutorialCurrentStep(st);
  const advanced = advanceTutorial(st, op, human);
  if (advanced && stepBefore && stepBefore.id === 'acquire') {
    const granted = tutorialGrantParts(st, human);
    if (granted.length && res.log) {
      res.log += ' Buggy supplied the rest: rocket parts to LEO, the two production cards to your hand.';
    }
  }
  // The tutorial is ONE continuous guided turn: the player never ends their turn
  // or passes (the rails block END_TURN). Refill the operation + move budget after
  // every action so the next scripted step is always affordable without a turn
  // boundary - no turn management, no Sunspot clock, no passing. The I4b
  // No-Double-Moves stamps normally lift at the next turn open too, so clear
  // them here as well - without this the Deimos-to-Phobos hop is rejected with
  // component_already_moved (the rocket already flew LEO-to-Deimos this "turn").
  human.opsRemaining = OPS_PER_TURN;
  human.movesRemaining = MOVES_PER_TURN;
  clearMovedStamps(human);
  return res;
}

// Drive the tutorial bots after a human op: bots bid/pass through an open
// auction until it waits on the human to close, and END_TURN on their own
// turns, so the round never stalls waiting on a fake seat. Returns the advanced
// state + any bot log lines. No-op outside a tutorial game.
export function driveTutorialBots(prevState) {
  if (!prevState || !prevState.tutorial) return { state: prevState, logs: [] };
  let cur = prevState;
  const logs = [];
  const bots = new Set((cur.tutorial.bots || []).map(String));
  let guard = 0;
  while (guard++ < 400) {
    const t = cur.tutorial;
    if (!t || t.done) break;
    // Crew draft: the bots have no real account to pick a faction, so the draft
    // would stall forever waiting on them (draft closes only when EVERY player
    // has a faction). Pick one for each factionless bot - a crew card of its
    // seat colour - through the same PICK_CREW path a human uses; the last pick
    // flips the draft to play and the human's mission can begin.
    if (cur.draftPhase === 'crew') {
      const botId = (cur.tutorial.bots || []).find((id) => {
        const p = cur.players.find((q) => String(q.profileId) === String(id));
        return p && !p.faction;
      });
      if (botId == null) break;                        // bots seated; waiting on the human
      const bp = cur.players.find((q) => String(q.profileId) === String(botId));
      const card = Object.values(CREW_BY_ID).find((c) => c.color === (bp && bp.color))
        || Object.values(CREW_BY_ID)[0];
      const res = applyOperation(cur, { kind: 'PICK_CREW', cardId: card.id, face: 'primary' }, { profileId: botId });
      if (!res.ok) break;
      cur = res.state; if (res.log) logs.push(res.log);
      continue;
    }
    if (cur.auction) {
      const waiting = auctionWaitingOn(cur).map((p) => String(p.profileId));
      const botId = (cur.tutorial.bots || []).find((id) => waiting.includes(String(id)));
      if (botId == null) break;                       // auction waits on the human to close
      const res = applyOperation(cur, { ...tutorialBotMove(cur, botId) }, { profileId: botId });
      if (!res.ok) break;
      cur = res.state; if (res.log) logs.push(res.log);
      continue;
    }
    const active = currentPlayer(cur);
    if (active && bots.has(String(active.profileId))) {
      const res = applyOperation(cur, { kind: 'END_TURN' }, { profileId: active.profileId });
      if (!res.ok) break;
      cur = res.state; if (res.log) logs.push(res.log);
      continue;
    }
    break;                                             // human's turn, no auction
  }
  return { state: cur, logs };
}

// Ops accepted over the wire. Functional + meta + auction + lifecycle + the
// draft-start pick (dispatched specially in applyOperation, so it's listed
// explicitly rather than via a group).
export const SUPPORTED_OPS = [
  ...Object.keys(FUNCTIONAL), ...Object.keys(META), ...Object.keys(AUCTION),
  ...Object.keys(TRADE), ...Object.keys(FACTORY_ACCESS), ...Object.keys(LUNA_ACCESS),
  ...Object.keys(CREW), ...Object.keys(LIFECYCLE), 'DRAFT_PICK', 'DRAFT_CYCLE', 'EVENT_CHOICE',
];
// Ops that require the caller to supply ctx.turnBaseState.
export const NEEDS_TURN_BASE = new Set(['UNDO', 'REDO']);

// Mass + thrust helpers reused by the /admin manage-state breakdown so it shows
// the SAME numbers the engine computes (no second mass/thrust model to drift):
//   slotMass(slot)            installed-face mass of one stack slot
//   rocketDryMass(massSum)    dry mass from a stack's mass sum (min 1)
//   activeNetThrust(rocket)   net thrust after all modifiers (0 if no thruster)
//   thrusterFuelPerBurn(rkt)  fuel steps spent per burn
export { slotMass, activeNetThrust, thrusterFuelPerBurn, rocketDryMass, rocketSolarZone, elevatorConnectedFactorySet, playerHasColonistPower, playerCrewReactorKinds, decksFor };
