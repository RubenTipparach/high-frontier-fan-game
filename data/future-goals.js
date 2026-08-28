// Module 2 Futures (rule 1D) - the structured layer behind each card's
// printed `Future` text, the same text-to-flags pattern data/card-abilities.js
// uses for patent abilities. The TEXT is the spreadsheet's (rendered on the
// purple face); this module is the engine-readable interpretation: the
// requirement checklist, the star VP, the endgame re-check, and the standing
// effects a completed Future grants.
//
// Shared by BOTH the server engine (the Epic Hazard operation + endgame
// scoring) and the client (the missions tracker's live checklist), so it is
// pure data + pure functions. Anything that needs the movement graph
// (adjacency, zones) reads it through the ctx the CALLER injects:
//
//   ctx = {
//     state, player,              // the game state + the owning player
//     neighborsOf(slug) -> [slug] // map adjacency (planner graph)
//     zoneOf(slug) -> zoneName    // heliocentric zone of any node
//   }
//
// A Future completes ONCE per game per NAME (1D1a "Futures Exclusivity"):
// exclusivity keys off goal.name, so the four UPLIFT cards race for one star
// and the two SECESSION variants share one name.

import { SITES } from './sites.js';
import { slugify } from './planner-ids.js';
import { colonyClassOfSite, isAerostatSiteId, isAtmosphericSite } from './site-categories.js';
import { AD_ASTRA_ZONES, sunlensForZone } from './ad-astra.js';
import { COLONISTS_BY_ID } from './colonists.js';
import { PLANNER_SLUG_ALIASES } from './site-aliases.js';

// Two id spaces meet here: the curated tables key by data/sites.js id
// (underscored), while the game state's maps + unit positions key by the WIRE
// slug (the planner's makeRefId = slugify(name), hyphenated). Every lookup
// resolves both, and comparisons canonicalise to the sites.js id first.
const SITE_BY_ID = new Map();
const CANONICAL = new Map();
for (const s of SITES) {
  const wire = slugify(s.name);
  SITE_BY_ID.set(s.id, s);
  SITE_BY_ID.set(wire, s);
  CANONICAL.set(s.id, s.id);
  CANONICAL.set(wire, s.id);
}
// A handful of planner nodes are named differently from data/sites.js, so their
// WIRE slug is neither the sites.js id nor slugify(name) - and the game state is
// keyed by that wire slug. Fold those in or the tag tables below silently fail
// to match a state id (a Factory on `phaethon` never counted as a Synodic Comet).
for (const [wire, sid] of Object.entries(PLANNER_SLUG_ALIASES)) {
  const s = SITE_BY_ID.get(sid);
  if (!s) continue;
  SITE_BY_ID.set(wire, s);
  CANONICAL.set(wire, s.id);
}
const siteOf = (id) => SITE_BY_ID.get(id) || null;
const canonicalSiteId = (id) => CANONICAL.get(String(id)) || String(id);
// Both key forms for one canonical site id (for indexing state maps).
function wireForms(id) {
  const s = SITE_BY_ID.get(id);
  return s ? [...new Set([s.id, slugify(s.name), ...(ALIASES_BY_SITE.get(s.id) || [])])] : [String(id)];
}

// ---- Location tag tables (gazetteer-sourced) ----

// Every exported id list carries BOTH forms of each site id (sites.js
// underscore + wire hyphen), so membership tests accept either.
// Every form a state id can arrive in: the sites.js id, slugify(name), and any
// planner-node alias (see data/site-aliases.js). A table built from these matches
// whatever the game state hands it without the caller canonicalising first.
const ALIASES_BY_SITE = new Map();
for (const [wire, sid] of Object.entries(PLANNER_SLUG_ALIASES)) {
  if (!ALIASES_BY_SITE.has(sid)) ALIASES_BY_SITE.set(sid, []);
  ALIASES_BY_SITE.get(sid).push(wire);
}
const bothForms = (ids) => [...new Set(ids.flatMap((id) => {
  const s = SITE_BY_ID.get(id);
  return s ? [s.id, slugify(s.name), ...(ALIASES_BY_SITE.get(s.id) || [])] : [id];
}))];

// The 15 synodic (apparition-season) sites; the comet subset drives the
// "Synodic Comet" futures. Sourced from the season table the map markers use
// (data/node-seasons.json), keyed here by data/sites.js id.
export const SYNODIC_SITE_IDS = bothForms([
  'icarus', 'comet_phaethon', 'comet_holmes', 'comet_borrelly', 'comet_encke',
  'comet_hartley_2', 'comet_neujmin_1', 'hermes_a', 'hermes_b',
  'kreutz_sungrazer', 'comet_crommelin', 'asbolus', 'comet_halley',
  'pholus', 'bee_zed',
]);
export const SYNODIC_COMET_IDS = SYNODIC_SITE_IDS.filter((id) => {
  const s = siteOf(id);
  return !!(s && (s.type === 'comet' || s.body === 'Kreutz'));
});

// Centaurs (per the HF gazetteer): the small bodies between Jupiter and
// Neptune.
export const CENTAUR_SITE_IDS = bothForms(['chiron', 'elatus', 'pholus', 'asbolus', 'okyrhoe', 'echelus', 'bee_zed']);

// Jovian Trojan camps (gazetteer): Greek camp leads at L4 (Hektor is the
// classic exception - a Trojan name in the Greek camp), Trojan camp trails
// at L5 (Patroclus is the Greek-name exception there).
export const GREEK_CAMP_IDS = bothForms(['achilles', 'hektor', 'skamandrios_moonlet', 'telamon', 'nestor', 'icarion', 'philoctetes']);
export const TROJAN_CAMP_IDS = bothForms(['patroclus', 'menoetius', 'glaukos', 'laocoon', 'antenor', 'aeneas', 'tithonus']);

const MERCURY_SITE_IDS = SITES.filter((s) => s.body === 'Mercury').map((s) => s.id);

// ---- ctx helpers ----

// Factory / colony site lists come back CANONICALISED (sites.js ids) so the
// tag-table membership tests below match regardless of the wire form.
function myFactorySites(ctx) {
  const out = [];
  for (const [sid, f] of Object.entries(ctx.state.factories || {})) {
    if (f && f.ownerId === ctx.player.profileId) out.push(canonicalSiteId(sid));
  }
  return out;
}
function anyFactorySites(ctx) {
  return Object.keys(ctx.state.factories || {}).map(canonicalSiteId);
}
function factoryAt(ctx, canonicalId) {
  for (const form of wireForms(canonicalId)) {
    if (ctx.state.factories && ctx.state.factories[form]) return ctx.state.factories[form];
  }
  return null;
}
function myColonies(ctx) {
  const out = [];
  for (const [sid, c] of Object.entries(ctx.state.colonies || {})) {
    if (c && c.ownerId === ctx.player.profileId) out.push({ siteId: canonicalSiteId(sid), type: c.type || colonyClassOfSite(sid) || 'other' });
  }
  return out;
}
// The Dirtsides of one Bernal: the SITES it anchors over. A "Dirtside" is an
// anchored Bernal next to a site of some type - NOT the site itself, and NOT
// gated on a factory being there (user 2026-07-20). Reachability is the
// anchoring line-of-sight (the raygun beam that passes through lander burns /
// hazards / atmosphere), so the caller injects ctx.dirtsideSitesOf (server:
// lineOfSightSites; client: computeRaygunTargets) and we keep only real sites,
// Luna excluded (2Ba). A caller that supplies no resolver falls back to raw map
// neighbours (which only reaches immediately adjacent sites). Canonicalised ids.
function dirtsidesOf(ctx, bn) {
  if (!bn || bn.siteId == null) return [];
  const reach = ctx.dirtsideSitesOf
    ? (ctx.dirtsideSitesOf(bn.siteId) || [])
    : (ctx.neighborsOf(bn.siteId) || []);
  const out = [];
  for (const nb of reach) {
    const s = siteOf(nb);
    if (!s) continue;                 // waypoints / burns are not Dirtsides
    if (s.body === 'Luna') continue;  // Luna is never a Dirtside (2Ba)
    out.push(canonicalSiteId(nb));
  }
  return out;
}
function myBernals(ctx, { anchored = true, promoted = false } = {}) {
  return (ctx.player.bernals || []).filter((bn) => bn
    && (!anchored || bn.anchored)
    && (!promoted || bn.promoted || bn.face === 'secondary'));
}
// Does the player hold a promoted+anchored Bernal with a dirtside passing
// `pred(siteId)`? Returns the matching Bernal or null.
function promotedBernalWithDirtside(ctx, pred) {
  for (const bn of myBernals(ctx, { anchored: true, promoted: true })) {
    if (dirtsidesOf(ctx, bn).some(pred)) return bn;
  }
  return null;
}
function dirtsideHydrationOf(ctx, bn) {
  let n = 0;
  for (const sid of dirtsidesOf(ctx, bn)) {
    const s = siteOf(sid);
    let h = (s && Number.isFinite(s.hydration)) ? s.hydration : 0;
    if (hasEffect(ctx.player, 'doubleDirtsideHydration')) h *= 2;
    n += h;
  }
  return n;
}
// Promoted HUMAN colonists this player holds at a given site (any id form).
function promotedHumanColonistsAt(ctx, siteId) {
  let n = 0;
  const want = canonicalSiteId(siteId);
  const scan = (slots, at) => {
    if (at == null || canonicalSiteId(at) !== want) return;
    for (const s of (slots || [])) {
      const c = COLONISTS_BY_ID[s.id];
      if (!c) continue;
      if (s.face !== 'secondary') continue;
      if (c.colonistKind !== 'Human' && !ctx.state.robotsEmancipated) continue;
      n += 1;
    }
  };
  const p = ctx.player;
  scan(p.rocket && p.rocket.stack, p.rocket && p.rocket.siteId);
  for (const o of Object.values(p.outposts || {})) if (o) scan(o.cards, o.siteId);
  if (p.freighter) scan(p.freighter.stack, p.freighter.siteId);
  for (const bn of (p.bernals || [])) if (bn) scan(bn.stack, bn.siteId);
  return n;
}
// Promoted colonists (Human or Robot) at a site (any id form).
function promotedColonistsAt(ctx, siteId) {
  let n = 0;
  const want = canonicalSiteId(siteId);
  const scan = (slots, at) => {
    if (at == null || canonicalSiteId(at) !== want) return;
    for (const s of (slots || [])) {
      if (COLONISTS_BY_ID[s.id] && s.face === 'secondary') n += 1;
    }
  };
  const p = ctx.player;
  scan(p.rocket && p.rocket.stack, p.rocket && p.rocket.siteId);
  for (const o of Object.values(p.outposts || {})) if (o) scan(o.cards, o.siteId);
  if (p.freighter) scan(p.freighter.stack, p.freighter.siteId);
  for (const bn of (p.bernals || [])) if (bn) scan(bn.stack, bn.siteId);
  return n;
}
// Every built Space Elevator as { a, b } pairs, including the GEO Elevator
// Bernal's derived cable when anchored.
function elevatorPairs(ctx) {
  const out = [];
  for (const key of Object.keys(ctx.state.elevators || {})) {
    const [a, b] = String(key).split('|');
    if (a && b) out.push({ a, b });
  }
  for (const p of ctx.state.players) {
    for (const bn of (p.bernals || [])) {
      if (bn && bn.anchored && bn.cardId === 'ber_geo_elevator_bernal' && bn.siteId === 'burn-geo') {
        out.push({ a: 'burn-geo', b: 'lag-pr6v8' });
      }
    }
  }
  return out;
}
function factoriesConnectedToElevators(ctx, ownerId) {
  const ends = new Set();
  for (const pr of elevatorPairs(ctx)) { ends.add(pr.a); ends.add(pr.b); }
  let n = 0;
  for (const [sid, f] of Object.entries(ctx.state.factories || {})) {
    if (!f) continue;
    if (ownerId != null && f.ownerId !== ownerId) continue;
    if (ends.has(sid)) { n += 1; continue; }
    // A factory one step from a cable end is served by the same elevator head.
    if ((ctx.neighborsOf(sid) || []).some((nb) => ends.has(nb))) n += 1;
  }
  return n;
}
export function hasEffect(player, key) {
  return Array.isArray(player && player.futureEffects) && player.futureEffects.includes(key);
}
// The player's operational stack has a thruster with net thrust 7+ at siteId
// - approximated from the card's printed thrust on its installed face (the
// full modifier fold lives in the engine; the checklist only needs a signal).
// The printed requirement is "Decommission OPERATIONAL 7+ NET thrust thruster on
// Industrialized Synodic Comet (yours)". Both of those words come off the support
// chain: NET thrust folds the modifier path (a generator / the first reactor's
// thrustMod, rules 1+2), and OPERATIONAL means every requirement in the chain has
// a supplier. This used to read the raw thrust printed on the card face and never
// ask whether the stack worked at all, so a ship whose own stack panel reads NET
// THRUST 7 (a printed 5 under a +2 reactor) failed the checklist, while a
// printed-7 with no reactor to power it passed (reported 2026-08-25).
//
// The resolvers already exist on both callers - the engine's activeNetThrust +
// rocketSupportStatus, the client's getActiveThrusterStats + isRocketActive - so
// they are injected through ctx.rocketThrust() rather than folded a third time
// here. A caller that does not supply one falls back to the card-face read, which
// is what the endgame re-check and any older caller had before.
// ctx.rocketThrust() -> { cardId, thrust, operational } | null
function bigThrusterAt(ctx, siteId, cardsById) {
  const p = ctx.player;
  if (!p.rocket || p.rocket.siteId == null
      || canonicalSiteId(p.rocket.siteId) !== canonicalSiteId(siteId)) return null;
  if (typeof ctx.rocketThrust === 'function') {
    const st = ctx.rocketThrust();
    if (!st || !st.operational) return null;
    return (Number(st.thrust) || 0) >= 7 ? (st.cardId || p.rocket.activeThrusterId || null) : null;
  }
  for (const s of (p.rocket.stack || [])) {
    const c = cardsById[s.id];
    if (!c) continue;
    const face = (s.face === 'secondary' ? c.faces && c.faces.secondary : c.faces && c.faces.primary) || c;
    const thrust = Number(face.thrust != null ? face.thrust : c.thrust) || 0;
    if (thrust >= 7) return s.id;
  }
  return null;
}

// ---- requirement-item builders (each returns { id, label, test }) ----

// `hint(ctx)` is optional and is only read when the item is UNMET: a short line
// naming WHERE the requirement could be satisfied. A location requirement is
// judged from the site the Future card is standing at, so "not met" on its own
// leaves the player staring at two facts (the card is here, the requirement
// wants a Bernal) with nothing joining them. The hint joins them.
const item = (id, label, test, hint) => ({ id, label, test, ...(hint ? { hint } : {}) });
// Display name for a site id, falling back to the raw id for map nodes that have
// no curated data/sites.js row (a lagrange / radiation space is a real place a
// Bernal can anchor at, and the player reads it by its slug on the map).
const siteLabel = (id) => (siteOf(id) || {}).name || String(id);

function reqPromotedBernalDirtside(label, pred) {
  return item('bernal-dirtside', label, (ctx) => !!promotedBernalWithDirtside(ctx, pred),
    (ctx) => {
      const mine = myBernals(ctx, { anchored: true, promoted: true });
      if (!mine.length) return 'You have no promoted anchored Bernal in play.';
      const ok = mine.filter((bn) => dirtsidesOf(ctx, bn).some(pred));
      if (!ok.length) return `Your promoted Bernal (${mine.map((bn) => siteLabel(bn.siteId)).join(', ')}) has no Dirtside of the required kind.`;
      return `Take the card to ${ok.map((bn) => siteLabel(bn.siteId)).join(' or ')}.`;
    });
}

// ---- The goals, keyed by CARD id ----
// name = the printed Future name (the once-per-game exclusivity key).
// vp = the star's printed VP (null when dynamic; use endgameVp).
// endgame = true when the star's VP / effect re-checks at final scoring (1D2b).
// casusBelli = sparks the War of Independence (flagged + logged; the war
// rules themselves are out of scope until Module 3 - see docs).
// effects = standing effect keys stamped onto player.futureEffects.
// cost = { aqua } or { bigThruster: true } - paid/consumed by the Epic Hazard.
// requirements = the checklist (beyond the generic "card + Human colocated,
// Operational" that the engine always enforces).

const UPLIFT = {
  name: 'UPLIFT FUTURE', vp: 12, casusBelli: true,
  effects: ['emancipateRobots'],
  cost: { aqua: 20 },
  location: 'A promoted Bernal',
  requirements: [
    item('robots', 'Robots not yet Emancipated', (ctx) => !ctx.state.robotsEmancipated),
    // The Human has to be standing AT one, not merely own one somewhere. ctx
    // carries the attempt's site; when it does not (the mission checklist and
    // endgame scoring have no single attempt in view) fall back to "do you own
    // one", so the checklist still reads. The SERVER always passes the site, so
    // the real gate is the strict one.
    item('at-bernal', 'The attempting Human stands at your promoted Bernal', (ctx) => {
      const mine = myBernals(ctx, { anchored: true, promoted: true });
      if (ctx.atSiteId === undefined) return mine.length > 0;
      return mine.some((bn) => (bn.siteId ?? null) === (ctx.atSiteId ?? null));
    }, (ctx) => {
      const mine = myBernals(ctx, { anchored: true, promoted: true });
      if (!mine.length) return 'You have no promoted anchored Bernal in play - promote and anchor one first.';
      return `Take the card to ${mine.map((bn) => siteLabel(bn.siteId)).join(' or ')}, where your promoted Bernal is anchored.`;
    }),
    item('aqua', 'Spend 20 aqua', (ctx) => (ctx.player.aqua | 0) >= 20),
  ],
};
const BEANSTALK = {
  name: 'BEANSTALK FUTURE', vp: 0, endgame: true,
  effects: [],
  location: 'Anywhere (elevators may be anyone\'s)',
  requirements: [
    item('elevators', '3 or more Space Elevators built (any player)', (ctx) => elevatorPairs(ctx).length >= 3),
  ],
  endgameVp: (ctx) => 3 * factoriesConnectedToElevators(ctx, ctx.player.profileId),
  endgameVpLabel: '+3 VP per Factory connected to a Space Elevator',
};

// The two SECESSION variants (same name, one star between them).
const SECESSION_SOLDIER = {
  name: 'SECESSION FUTURE', vp: 10, casusBelli: true, effects: [],
  location: 'Your anchored Bernal with dirtside hydration 5+',
  requirements: [
    item('secession-bernal', 'An anchored Bernal with dirtside hydration 5+ hosting 2 of your promoted Human colonists', (ctx) => myBernals(ctx, { anchored: true })
      .some((bn) => dirtsideHydrationOf(ctx, bn) >= 5 && promotedHumanColonistsAt(ctx, bn.siteId) >= 2)),
  ],
};
const SECESSION_ATTICA = {
  name: 'SECESSION FUTURE', vp: 7, casusBelli: true, effects: [],
  location: 'Your promoted anchored Bernal',
  requirements: [
    item('secession-bernal', 'Your promoted anchored Bernal hosting 2 of your promoted Human colonists', (ctx) => myBernals(ctx, { anchored: true, promoted: true })
      .some((bn) => promotedHumanColonistsAt(ctx, bn.siteId) >= 2)),
  ],
};
// NEW VENUS / FOOTFALL share the decommission-a-big-thruster cost shape.
function synodicCometFactoryReqs() {
  return [
    item('synodic-factory', 'Your Factory on a Synodic Comet', (ctx) => myFactorySites(ctx).some((sid) => SYNODIC_COMET_IDS.includes(sid))),
    item('thruster', 'An operational thruster of net thrust 7+ parked there (decommissioned on success)', (ctx) => myFactorySites(ctx)
      .some((sid) => SYNODIC_COMET_IDS.includes(sid) && !!bigThrusterAt(ctx, sid, ctx.cardsById || {}))),
  ];
}

export const FUTURE_GOALS = {
  // ---- Colonists (keyed by the card's white-face id; the Future is printed
  // on the purple face it flips to) ----
  col_babbage_halbonauts: UPLIFT,           // -> Utility Fog Halbonaut
  col_programmable_matter: UPLIFT,          // -> Neumann Matter
  col_security_system: UPLIFT,              // -> Frankenstein Navigator
  col_smart_pets: UPLIFT,                   // -> Creeper Neogen
  col_biomechs: {                           // -> Group Mind Immortalists
    name: 'PAN SAPIENS FUTURE', vp: 0, endgame: true, casusBelli: true, effects: [],
    location: 'Anywhere',
    requirements: [
      item('elevator-factories', '3 of your Factories connected to Space Elevators', (ctx) => factoriesConnectedToElevators(ctx, ctx.player.profileId) >= 3),
    ],
    endgameVp: (ctx) => 2 * (((ctx.player.glory || {}).chits || []).length + ((ctx.player.glory || {}).claimed || []).length),
    endgameVpLabel: '+2 VP per glory chit owned',
  },
  col_botany_bay_convicts: SECESSION_SOLDIER,   // -> Soldier Caste
  col_heavy_water_survivalists: SECESSION_ATTICA, // -> New Attica Secessionists
  col_boyle_engineering_collective: BEANSTALK,  // -> Martian Assembly
  col_calypso_2_seed_sail: {                // -> Wet-Nano Seed Sail
    name: 'NEW VENUS FUTURE', vp: 12, endgame: true, effects: [],
    cost: { bigThruster: true },
    location: 'Your industrialized Synodic Comet',
    requirements: synodicCometFactoryReqs(),
    clearsTokensAt: (ctx) => {
      const venus = SITES.filter((s) => s.solarZone === 'Venus').map((s) => s.id);
      const comet = myFactorySites(ctx).filter((sid) => SYNODIC_COMET_IDS.includes(sid));
      // Both key forms per site: the caller deletes state-map entries by key.
      return [...venus, ...comet].flatMap(wireForms);
    },
  },
  col_house_of_saud: {                      // -> Iceworms
    name: 'SUBMARINER FUTURE', vp: 0, effects: ['doubleDirtsideHydration'],
    location: 'Anywhere',
    requirements: [
      item('submarines', '3 Submarine Colonies built', (ctx) => myColonies(ctx).filter((c) => c.type === 'submarine').length >= 3),
    ],
  },
  col_juiced_cosmonauts: {                  // -> Rental Body Guild
    name: 'ET LIFE FUTURE', vp: 0, endgame: true, effects: [],
    location: 'Anywhere',
    requirements: [
      item('astro-colonies', '2 or more Astrobiological Colonies', (ctx) => myColonies(ctx).filter((c) => c.type === 'astrobiology').length >= 2),
    ],
    endgameVp: (ctx) => 2 * myColonies(ctx).filter((c) => c.type === 'astrobiology').length,
    endgameVpLabel: '+2 VP per Astrobiological Colony',
  },
  col_lloyd_s_salvage_co: {                 // -> Svalbard Caretakers
    name: 'DYSON BUBBLE FUTURE', vp: 0, effects: [],
    location: 'Mercury',
    requirements: [
      item('mercury', 'Both Sites of Mercury industrialized (any player)', (ctx) => MERCURY_SITE_IDS.every((sid) => !!factoryAt(ctx, sid))),
    ],
    endgameVp: (ctx) => 5 * myFactorySites(ctx).filter((sid) => MERCURY_SITE_IDS.includes(sid)).length,
    endgameVpLabel: '5 VP per Factory you own on Mercury',
  },
  col_malcolm: {                            // -> Renaissance Man
    name: 'ARTIFICIAL CONSCIOUSNESS FUTURE', vp: 10, effects: ['freeMarketUnlimited'],
    location: 'An Astrobiology Dirtside',
    requirements: [
      item('promoted-colonists', '2 promoted Colonists at an Astrobiology Dirtside', (ctx) => anyFactorySites(ctx)
        .some((sid) => colonyClassOfSite(sid) === 'astrobiology' && promotedColonistsAt(ctx, sid) >= 2)),
    ],
  },
  col_microgravity_pantrophists: {          // -> Blue Goo Sybonts
    name: 'SETI FUTURE', vp: 10, effects: ['freeHomestead', 'freeInspiration'],
    location: 'The Jovian Trojan camps',
    requirements: [
      item('greek', 'A Factory of yours in the Greek camp', (ctx) => myFactorySites(ctx).some((sid) => GREEK_CAMP_IDS.includes(sid))),
      item('trojan', 'A Factory of yours in the Trojan camp', (ctx) => myFactorySites(ctx).some((sid) => TROJAN_CAMP_IDS.includes(sid))),
    ],
  },
  col_rock_rats_miners_union: {             // -> Alchemist Aviatrices
    name: 'AEROSTAT FUTURE', vp: 14, effects: ['freeHomestead'],
    location: 'Your promoted Bernal with an Aerostat Dirtside',
    requirements: [
      reqPromotedBernalDirtside('Your promoted Bernal with an Aerostat Dirtside', (sid) => isAerostatSiteId(sid)),
    ],
  },
  col_siren_cybernautics_inc: {             // -> Josephson Implants
    name: 'SUPREME CULT FUTURE', vp: 10, endgame: true, effects: ['lobbyKeepDelegate', 'migrateSeniorityAuthority'],
    location: 'Anywhere',
    requirements: [
      item('authority-law', 'The Active Law sits in Authority', (ctx) => ctx.state.activeLawStar === 'authority'),
    ],
  },
  col_transorbital_railworkers: {           // -> Kaluga Naniteers
    name: 'TNO FUTURE', vp: 12, effects: ['freeHomestead'],
    location: 'The Neptune zone',
    requirements: [
      item('neptune-factories', '2 of your Factories in the Neptune zone', (ctx) => myFactorySites(ctx)
        .filter((sid) => (siteOf(sid) || {}).solarZone === 'Neptune').length >= 2),
    ],
  },
  col_vatican_observers: {                  // -> Eugenic Pilgrims
    name: 'FOOTFALL FUTURE', vp: 10, endgame: true, casusBelli: true, effects: [],
    cost: { bigThruster: true },
    location: 'Your industrialized Synodic Comet',
    requirements: synodicCometFactoryReqs(),
    clearsTokensAt: (ctx) => myFactorySites(ctx).filter((sid) => SYNODIC_COMET_IDS.includes(sid)).flatMap(wireForms),
  },

  // ---- GW thrusters ----
  'gw-_amat_catalyzed_fission_fusion': {    // -> Amat-Initiated H-B Magnetic-Inertial
    name: 'MINI-BLACK HOLE FUTURE', vp: 10, effects: ['doubleIsotopeRefuel'],
    location: 'Your industrialized centaur',
    requirements: [
      item('centaur', 'Your Factory on a centaur', (ctx) => myFactorySites(ctx).some((sid) => CENTAUR_SITE_IDS.includes(sid))),
      item('isotope', '10 isotope fuel tanks aboard', (ctx) => ctx.player.rocket && ctx.player.rocket.tankGrade === 'isotope' && (ctx.player.rocket.tank | 0) >= 10),
    ],
  },
  'gw-_dense_plasma_h_b_focus_fusion': {    // -> Crossfire H-B Focus Fusion
    name: 'PROTIUM FUSION FUTURE', vp: 10, effects: ['doubleIsotopeRefuel'],
    location: 'Your promoted Bernal with an H Dirtside',
    requirements: [
      reqPromotedBernalDirtside('Your promoted Bernal with an H-spectral Dirtside', (sid) => (siteOf(sid) || {}).spectralType === 'H'),
    ],
  },
  'gw-_levitated_dipole_6li_h_fusion': {    // -> Dusty Plasma
    name: 'MASS BEAM FUTURE', vp: 7, effects: ['powersatPlus2'],
    location: 'Your promoted Bernal with an Io or Triton Dirtside',
    requirements: [
      reqPromotedBernalDirtside('Your promoted Bernal with an Io or Triton Dirtside', (sid) => ['Io', 'Triton'].includes((siteOf(sid) || {}).body)),
    ],
  },
  'gw-_mini_mag_orion_z_pinch_fission': {   // -> Solem Medusa Tugged Orion
    name: 'LITHIATED AMMONIA ICE STARSHIP FUTURE', vp: 14, effects: [],
    adAstra: true,
    location: 'An Ad Astra exit (the outer zones)',
    requirements: [
      item('exit', 'The stack stands at an Ad Astra exit zone', (ctx) => AD_ASTRA_ZONES.includes(ctx.zoneOf(ctx.player.rocket && ctx.player.rocket.siteId))),
      item('isotope', '10 isotope fuel aboard', (ctx) => ctx.player.rocket && ctx.player.rocket.tankGrade === 'isotope' && (ctx.player.rocket.tank | 0) >= 10),
    ],
  },
  'gw-_salt_water_zubrin': {                // -> Zubrin-GDM
    name: 'SPACEFARING FUTURE', vp: 7, effects: ['extraColonist'],
    location: 'Your Bernal with dirtside hydration 8+',
    requirements: [
      item('hydration', 'An anchored Bernal with total dirtside hydration 8+', (ctx) => myBernals(ctx, { anchored: true }).some((bn) => dirtsideHydrationOf(ctx, bn) >= 8)),
    ],
  },
  'gw-_spheromak_3he_d_magnetic_fusion': {  // -> Colliding FRC 3He-D Fusion
    name: 'ENZMANN STARSHIP FUTURE', vp: 12, effects: [],
    adAstra: true,
    location: 'An Ad Astra exit (the outer zones)',
    requirements: [
      item('exit', 'The stack stands at an Ad Astra exit zone', (ctx) => AD_ASTRA_ZONES.includes(ctx.zoneOf(ctx.player.rocket && ctx.player.rocket.siteId))),
      item('colonists', '2 promoted Colonists aboard the stack', (ctx) => {
        const r = ctx.player.rocket;
        if (!r) return false;
        return (r.stack || []).filter((s) => COLONISTS_BY_ID[s.id] && s.face === 'secondary').length >= 2;
      }),
      item('mobile-factory', 'A Mobile Factory of yours in play', (ctx) => (ctx.state.mobileCubes || []).some((c) => c && c.ownerId === ctx.player.profileId)),
    ],
  },
  'gw-_vista_d_t_inertial_fusion': {        // -> Daedalus 3He-D Inertial Fusion
    name: 'FUSION CANDLE FUTURE', vp: 14, effects: ['doubleIsotopeRefuel'],
    location: 'Triton + a Neptune Aerostat Dirtside',
    requirements: [
      item('triton-colony', 'A Colony of yours on Triton', (ctx) => myColonies(ctx).some((c) => (siteOf(c.siteId) || {}).body === 'Triton')),
      reqPromotedBernalDirtside('Your promoted Bernal with the Neptune Aerostat as a Dirtside', (sid) => isAerostatSiteId(sid) && (siteOf(sid) || {}).solarZone === 'Neptune'),
    ],
  },

  // ---- Freighters ----
  fre_fission_heated_steam: {               // -> Fission GCR
    name: 'EXOPLANET HUNT FUTURE', vp: 12, endgame: true, effects: [],
    location: 'Sedna',
    requirements: [
      item('sedna', 'Your Claim on Sedna', (ctx) => Object.entries(ctx.state.discs || {})
        .some(([sid, d]) => canonicalSiteId(sid) === 'sedna'
          && d && d.outcome === 'success' && d.ownerId === ctx.player.profileId)),
    ],
  },
  fre_fusion_fragment_sail: {               // -> Antiproton Sail and Harvester
    name: 'ANTIMATTER FUTURE', vp: 10, effects: ['doubleIsotopeRefuel'],
    location: 'Your promoted Bernal with an S Dirtside',
    requirements: [
      reqPromotedBernalDirtside('Your promoted Bernal with an S-spectral Dirtside', (sid) => (siteOf(sid) || {}).spectralType === 'S'),
    ],
  },
  fre_hiiper_beam_rider: {                  // -> Magnetic Mirror Beam Rider
    name: 'STAR WISP FUTURE', vp: 0, endgame: true, effects: [],
    location: 'A sunlens (the outer zones)',
    requirements: [
      item('sunlens', 'Your promoted Freighter parked at a sunlens zone', (ctx) => {
        const fr = ctx.player.freighter;
        if (!fr || !(fr.promoted || fr.face === 'secondary')) return false;
        return !!sunlensForZone(ctx.zoneOf(fr.siteId));
      }),
    ],
    endgameVp: (ctx) => {
      const fr = ctx.player.freighter;
      if (!fr || !(fr.promoted || fr.face === 'secondary')) return 0;
      const lens = sunlensForZone(ctx.zoneOf(fr.siteId));
      return lens ? lens.vp : 0;
    },
    endgameVpLabel: '6 VP at the neutrino sunlens / 11 VP at the EM sunlens (checked at endgame)',
  },
  fre_inflatable_solar_heated: {            // -> Archimedes Palmer Lens
    name: 'TERRAFORM FUTURE', vp: 8, effects: [],
    location: 'A non-Martian Atmospheric Dirtside',
    requirements: [
      reqPromotedBernalDirtside('Your promoted Bernal at a non-Martian Atmospheric Dirtside', (sid) => {
        const s = siteOf(sid);
        return !!s && s.body !== 'Mars' && (isAtmosphericSite(sid) || isAerostatSiteId(sid));
      }),
    ],
  },
  fre_poodle_steam: BEANSTALK,              // -> D-Nanotube Dirt Launcher
  fre_rotary_dirt_launcher: {               // -> KESTS Hoop Dirt Launcher
    name: 'BEEHIVE ARK FUTURE', vp: 7, effects: [],
    location: 'A Synodic Comet',
    requirements: [
      item('comet-bernal', 'Your promoted Bernal anchored beside a Synodic Comet', (ctx) => myBernals(ctx, { anchored: true, promoted: true })
        .some((bn) => (ctx.neighborsOf(bn.siteId) || []).some((nb) => SYNODIC_COMET_IDS.includes(canonicalSiteId(nb))))),
    ],
  },
  fre_z_pinch_d_t_6li_fusion: {             // -> Z-Pinch 3He-D Target Fusion
    name: 'GOLDEN APPLES FUTURE', vp: 14, effects: ['ignoreSolarFlares'],
    location: 'Kreutz Sungrazer',
    requirements: [
      item('kreutz', 'Your Factory on the Kreutz Sungrazer', (ctx) => {
        const f = factoryAt(ctx, 'kreutz_sungrazer');
        return !!(f && f.ownerId === ctx.player.profileId);
      }),
    ],
  },
};

// Resolve the goal for a card id (null when the card carries no Future).
export function futureGoalForCard(cardId) {
  return FUTURE_GOALS[cardId] || null;
}

// Evaluate a goal's checklist. Returns { met, items: [{ id, label, met }] }.
export function checkFutureGoal(goal, ctx) {
  if (!goal) return { met: false, items: [] };
  const items = (goal.requirements || []).map((r) => {
    let met = false;
    try { met = !!r.test(ctx); } catch { met = false; }
    // Only an UNMET item carries its hint - a met one has nothing to point at.
    let hint = null;
    if (!met && typeof r.hint === 'function') {
      try { hint = r.hint(ctx) || null; } catch { hint = null; }
    }
    return { id: r.id, label: r.label, met, ...(hint ? { hint } : {}) };
  });
  return { met: items.every((i) => i.met), items };
}
