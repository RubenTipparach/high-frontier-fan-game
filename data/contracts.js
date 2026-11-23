// Module 4 contract cards (4A3, 4B), built from the spreadsheet's Contracts and
// Exodus Contracts tabs (data/card-data.js - never hand-author stats here).
//
// Pure data + pure helpers, imported by BOTH the server engine and the client,
// the same reason fuel-graph / support-chain live in data/. No DOM, no node:.
//
// A contract card is double-sided like every other card: the BLUE side is the
// card's `primary` face and the GOLD side its `secondary` face (4B1b). Decks are
// dealt blue side up; a contract is boosted on the side it was auctioned on
// (4B2b) and keeps that side for its whole life.
//
// Destination steps (the sheet's "Destination Steps" column) are a small,
// engine-checkable restatement of the printed destination. Steps run in order,
// separated by ";":
//   at:<slug>|<slug> [unexplored]   the stack is at one of these sites
//   site <filters>                  the stack is at any site matching ALL filters
//   enter:<node>                    the stack entered that space this turn
//   flybys:N [beyond=Zone]          the stack entered N different flyby spaces this turn
//   liftoff                         the stack has left the previous step's site
//   colony <filters>                the stack is at a Colony: without Module 2 a
//                                   colony dome on a site; with Module 2 an
//                                   anchored Bernal (owner 2026-11-23). Filters:
//                                   own, beo, zone=, notzone=, atmospheric,
//                                   submarine, body=, road (buggy road to
//                                   another Colony), augmented (an augmented
//                                   Colonist / Crew there), buggy (the stack
//                                   has an operational buggy), different
//   isobank [augmented] [spaceborn] the stack is at the isobank (M4 + M2)
//   belt [beyond=Zone]              the stack entered a Radiation Belt space this turn
//                                   (a different one from earlier belt steps)
//   return                          the contract is back at LEO / your Bank
//   manual:<why>                    not engine-checkable yet (refused until it is)
// Site filters: unexplored, size>=N, atmospheric, submarine, astrobiology,
// synodic, elevator, spectral=X, hydration=N, body=Name, zone=Name,
// notzone=Name, beyond=Zone, glory=unclaimed, different (not a site an earlier
// step of this contract used).
import { CARD_DATA } from './card-data.js';

export const CONTRACT_PAIRS = {
  IF: ['individuality', 'freedom'],
  HU: ['honor', 'unity'],
  EA: ['equality', 'authority'],
};
export const CONTRACT_PAIR_NAMES = {
  IF: 'Individuality / Freedom', HU: 'Honor / Unity', EA: 'Equality / Authority', EX: 'Exodus',
};
// Heliocentric zones, Sun outward, for "beyond <zone>" (farther from the Sun).
export const ZONE_ORDER = ['Mercury', 'Venus', 'Earth', 'Mars', 'Ceres', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];
// Flyby spaces (the planner graph's nodes with a flyby boost,
// data/planner-nodes.json `flybyBoost`), for "enter N different flyby Spaces".
export const FLYBY_NODES = new Set(["burn-utoma", "lag-34x0a", "lag-7e40f", "lag-8x13a", "lag-dzxes",
  "lag-h1i9d", "lag-h2v5y", "lag-iaxli", "lag-iq24g", "lag-noz3h", "lag-okomr", "lag-pr6v8", "lag-uj65f",
  "lag-x28s9", "venus-2lgjk"]);
// A bid is in YEARS from the Sunspot Cube, 10 (opening) down to 0 (4B3e).
export const CONTRACT_BID_MAX = 10;

const slug = (s) => 'con_' + String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const num = (v, d = 0) => (v == null || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

// Step filters: `key` (a flag), `key=value`, `key>=n`. `either=a,b` holds
// alternatives, each itself a filter (`either=beyond=Mars,size>=9`: beyond the
// Mars zone OR size 9+).
function parseFilters(tokens) {
  const filters = {};
  for (const t of tokens) {
    const m = t.match(/^([a-z]+)(>=|=)(.+)$/);
    if (m && m[1] === 'either') filters.either = m[3].split(',').map((alt) => parseFilters([alt]));
    else if (m) filters[m[1]] = m[2] === '>=' ? { min: Number(m[3]) } : m[3];
    else filters[t] = true;
  }
  return filters;
}

export function parseSteps(text) {
  return String(text || '').split(';').map((s) => s.trim()).filter(Boolean).map((raw) => {
    if (raw.startsWith('manual:')) return { verb: 'manual', why: raw.slice(7).trim(), raw };
    const [head, ...rest] = raw.split(/\s+/);
    const filters = parseFilters(rest);
    if (head.startsWith('at:')) return { verb: 'at', sites: head.slice(3).split('|'), filters, raw };
    if (head.startsWith('enter:')) return { verb: 'enter', node: head.slice(6), filters, raw };
    if (head.startsWith('flybys:')) return { verb: 'flybys', count: Number(head.slice(7)) || 1, filters, raw };
    if (head === 'site') return { verb: 'site', filters, raw };
    if (head === 'space') return { verb: 'space', filters, raw };
    if (head === 'return') return { verb: 'return', raw };
    if (head === 'liftoff') return { verb: 'liftoff', raw };
    if (head === 'belt') return { verb: 'belt', filters, raw };
    if (head === 'colony') return { verb: 'colony', filters, raw };
    if (head === 'isobank') return { verb: 'isobank', filters, raw };
    return { verb: 'manual', why: `unreadable step "${raw}"`, raw };
  });
}

// Contract abilities (4B2e/f), read off the printed "Fulfilled Ability" text so
// no card is special-cased in code. Returns an object of the abilities the
// engine understands; anything it cannot read yet is left out (the text still
// shows on the card).
//   shielded / bailout / secured / insight / connections / transport : true
//   hazardIgnore / aerobrakeIgnore : [quoted hazard words]   (4B2f)
//   fundraiseAqua : N   ("Gain N additional Aqua when fundraising")
//   skullNearFactory : N (Crash hazards next to an industrialized Site, N/stack/turn)
//   aerobrakeZones : [zone]  (Aerobrake hazards in that zone are ignored)
//   privilege : key     (a faction-style ability, e.g. POWERSAT)
//   lunaFree / murderSuicide / acetyleneFactories / elevatorLanderBurns : true
//   isruBody : { body, n }   (-n ISRU prospecting that body)
//   beltFlyby : N       (+1 flyby bonus from the first N Radiation Belts/turn)
export function parseFulfilledAbility(text) {
  const t = String(text || '').trim();
  const ab = {};
  const named = t.replace(/\.$/, '').trim().toLowerCase();
  for (const k of ['shielded', 'bailout', 'secured', 'insight', 'connections', 'transport']) {
    if (named === k) ab[k] = true;
  }
  const icon = t.match(/^\[([^\]]*)\]\s*(.*)$/);
  if (icon) {
    const tag = icon[1].toLowerCase();
    const quoted = [...icon[2].matchAll(/"([^"]+)"/g)].map((m) => m[1].toLowerCase());
    const aero = /aerobrake/.test(tag);
    if (quoted.length && (aero || /skull/.test(tag))) ab[aero ? 'aerobrakeIgnore' : 'hazardIgnore'] = [...new Set(quoted)];
  }
  const fr = t.match(/^Gain (\d+) additional Aquas? when fundraising/i);
  if (fr) ab.fundraiseAqua = Number(fr[1]);
  if (icon) {
    const tag = icon[1].toLowerCase(); const rest = icon[2];
    // New Horizons: Crash hazards next to any industrialized Site, 1 per
    // spacecraft per turn.
    if (/skull/.test(tag) && /adjacent to industrialized sites/i.test(rest)) ab.skullNearFactory = 1;
    // Inner Tour (the Earth-zone corridors into LEO) / HAVOC (a named zone).
    if (/aerobrake/.test(tag)) {
      if (/leading to LEO/i.test(rest)) ab.aerobrakeZones = ['Earth'];
      const z = rest.match(/^(\w+) zone/i);
      if (z) ab.aerobrakeZones = [z[1][0].toUpperCase() + z[1].slice(1).toLowerCase()];
    }
    // The push icon: the Powersat ability (Sun-fired Laser, "Negotiable").
    if (/beam|play triangle|push/.test(tag) && !/air-eater/.test(tag)) ab.privilege = 'POWERSAT';
  }
  if (/^You may prospect Luna without permission/i.test(t)) ab.lunaFree = true;
  const isru = t.match(/^-(\d+) ISRU when prospecting (\w+)/i);
  if (isru) ab.isruBody = { body: isru[2], n: Number(isru[1]) };
  const belt = t.match(/^\+1 flyby bonus from Radiation Belt \((once|twice)/i);
  if (belt) ab.beltFlyby = belt[1].toLowerCase() === 'twice' ? 2 : 1;
  if (/allowed Murder\/Suicide/i.test(t)) ab.murderSuicide = true;
  // Exodus contract abilities.
  if (/^If your GW\/TW thruster ends its move on an Aerobrake Hazard, that Stack gains 1 Isotope/i.test(t)) ab.aeroIsotope = true;
  if (/^Produce your isostandard during a site refuel op at any Factory/i.test(t)) ab.isostandardAnyFactory = true;
  if (/^Your GW\/TW thruster receives a Bonus Pivot/i.test(t)) ab.twBonusPivot = true;
  if (/^Your Bernals add to Colonist limit even when unanchored/i.test(t)) ab.bernalLimitUnanchored = true;
  if (/^Your Stacks are immune to Belt\/CME Rolls/i.test(t)) ab.beltCmeImmune = true;
  if (/^Before exomigrating, you may Discard the top card from the queue/i.test(t)) ab.exomigrateDiscard = true;
  if (/^Acetylene rocketplane liftoff is possible from all your Factories/i.test(t)) ab.acetyleneFactories = true;
  if (/factory-assist landings\/liftoffs at Elevator Sites treat lander burns as normal Burn Spaces/i.test(t)) ab.elevatorLanderBurns = true;
  return ab;
}
// "When Fulfilling" effects (4B4f) the engine can enact, read off the text.
//   gainAqua : N   ("Gain N Aquas.")
export function parseWhenFulfilling(text) {
  const t = String(text || '').trim();
  const fx = {};
  const g = t.match(/^Gain (\d+) Aquas?\.?$/i);
  if (g) fx.gainAqua = Number(g[1]);
  //   bustAndDelegates : true  (Planetary Protection)
  //   beehive : true           (remove the Busted disk, prospect at ISRU 0 w/reroll)
  if (/^Bust the destination Site & place up to 2 delegates in any 1 Ideology/i.test(t)) fx.bustAndDelegates = true;
  if (/^Remove Busted disk; prospect here at ISRU 0 w\/reroll/i.test(t)) fx.beehive = true;
  //   isoBank : N   ("Gain N Isotopes at your Bank")
  //   isoSite : N   ("Gain N Isotopes at this Site": isotope fuel in the stack there)
  //   bernalSwap : true (Life Support Reconfig: "you may swap your Bernal cards")
  const ib = t.match(/^Gain (\d+) Isotopes? at your Bank/i);
  if (ib) fx.isoBank = Number(ib[1]);
  const is = t.match(/^Gain (\d+) Isotopes? at this Site/i);
  if (is) fx.isoSite = Number(is[1]);
  if (/swap your Bernal cards/i.test(t)) fx.bernalSwap = true;
  return fx;
}

function buildFace(row, pair, exodus) {
  if (!row) return null;
  return {
    name: row.Name,
    side: row.Side || (exodus ? 'exodus' : 'blue'),
    code: row.Code,
    contractType: row['Contract Type'] || '',
    pair: row['Ideology Pair'] || pair,
    manned: !!row.Manned,
    mass: num(row.Mass, 1),
    radHardness: num(row['Rad-Hard'], 5),
    vp: num(row.VP),
    lateFee: num(row['Late Fee']),
    advance: num(row.Advance),
    cybernetics: String(row.Cybernetics || '').split(',').map((s) => s.trim()).filter(Boolean),
    titleIcon: row['Title Icon'] || null,
    tophat: row['Title Icon'] === 'tophat',
    felony: row['Title Icon'] === 'mask',
    destination: row.Destination || '',
    steps: parseSteps(row['Destination Steps']),
    fulfilledAbility: row['Fulfilled Ability'] || '',
    whenFulfilling: row['When Fulfilling'] || '',
    abilities: parseFulfilledAbility(row['Fulfilled Ability']),
    onFulfill: parseWhenFulfilling(row['When Fulfilling']),
    properties: [],
    requires: [],
    supplies: [],
  };
}

function build(tab, exodus) {
  return (CARD_DATA[tab] || []).filter((r) => r && r.tier1).map((r) => {
    const pair = r.tier1['Ideology Pair'] || null;
    const primary = buildFace(r.tier1, pair, exodus);
    const secondary = buildFace(r.tier2, pair, exodus);
    return {
      id: slug(r.tier1.Name),
      name: r.tier1.Name,
      type: 'contract',
      pair: exodus ? 'EX' : pair,
      exodus,
      mass: primary.mass,
      radHardness: primary.radHardness,
      spectralType: null,
      requires: [], supplies: [], properties: [],
      faces: { primary, secondary },
    };
  });
}

export const CONTRACTS = [...build('Contracts', false), ...build('Exodus Contracts', true)];
export const CONTRACTS_BY_ID = Object.fromEntries(CONTRACTS.map((c) => [c.id, c]));
export const isContractId = (id) => !!CONTRACTS_BY_ID[id];
// The face a contract is on: 'blue' / 'exodus' -> primary, 'gold' -> secondary.
export const sideFace = (side) => (side === 'gold' ? 'secondary' : 'primary');
export function contractFace(cardId, side = 'blue') {
  const c = CONTRACTS_BY_ID[cardId];
  return c ? c.faces[sideFace(side)] : null;
}
// A face whose destination needs something an M4 game cannot have right now: a
// Bernal / Colony (M2), a Freighter / GW thruster / Space Elevator (M1), the
// isobank (Stage 3), or a body that is not on our map. Read off the sheet's
// Destination Steps (the manual: reason). Owner 2026-11-17: these contracts are
// dealt out of M4 for now, and M4 does not combine with M2.
const NEEDS_ABSENT = /bernal|colon|BEO|freighter|isobank|isotop|\(M1\)|\(M2\)|not on this map/i;
export function faceUnplayable(face, mods = {}) {
  if (!face) return false;
  if (face.steps.some((s) => s.verb === 'manual' && NEEDS_ABSENT.test(s.why || ''))) return true;
  // The isobank exists only with Module 2 (4D2 founds it on a BEO Bernal).
  if (!mods.m2 && face.steps.some((s) => s.verb === 'isobank')) return true;
  return false;
}
// The three ideology-pair decks, blue side up, unshuffled (the server shuffles).
// Cards are dealt and auctioned blue side up, so a card whose BLUE face cannot
// be played is left out.
export function contractDeckIds(mods = {}) {
  const decks = { IF: [], HU: [], EA: [] };
  for (const c of CONTRACTS) if (!c.exodus && decks[c.pair] && !faceUnplayable(c.faces.primary, mods)) decks[c.pair].push(c.id);
  return decks;
}

const zoneIdx = (z) => ZONE_ORDER.indexOf(String(z || ''));

// Does `site` (a data/sites.js record) pass a step's filters? `ctx` supplies the
// game-state questions: unexplored(slug), size(site), gloryUnclaimed(zone),
// atmospheric / submarine / astrobiology / elevator (slug), and for the stack
// carrying the contract: stackHuman(), stackOperational(type), hazardRolled().
// `slug` is the map space the stack is on; claims, factories and discs are
// keyed by it (a curated site record's own id can differ: venus_aerostat_xity).
export function siteMatches(site, filters, ctx, usedSites = [], slug = null) {
  if (!site) return false;
  const f = filters || {};
  const id = slug || site.id;
  // Unexplored Signposted Site (owner ruling 2026-11-17): once every
  // signposted site has been explored, any site will do.
  const anySite = !!(f.orany && f.signposted && ctx.noUnexploredSignposted && ctx.noUnexploredSignposted());
  if (!anySite) {
    if (f.unexplored && !ctx.unexplored(id)) return false;
    if (f.signposted && !(ctx.signposted && ctx.signposted(id))) return false;
  }
  if (f.size && (typeof f.size === 'object' ? ctx.size(site, id) < f.size.min : ctx.size(site, id) !== Number(f.size))) return false;
  if (f.adjacent === 'hazard' && !(ctx.adjacentHazard && ctx.adjacentHazard(id))) return false;
  if (f.busted && !(ctx.busted && ctx.busted(id))) return false;
  if (f.ownfactory && !(ctx.ownFactory && ctx.ownFactory(id))) return false;
  if (f.farthestglory) {
    const z = ctx.farthestGloryZone ? ctx.farthestGloryZone() : null;
    if (!z || site.solarZone !== z) return false;
  }
  if (f.human && !(ctx.stackHuman && ctx.stackHuman())) return false;
  if (f.rolled && !(ctx.hazardRolled && ctx.hazardRolled())) return false;
  if (f.robonaut && !(ctx.stackOperational && ctx.stackOperational('robonaut'))) return false;
  if (f.refinery && !(ctx.stackOperational && ctx.stackOperational('refinery'))) return false;
  if (f.either && !f.either.some((alt) => siteMatches(site, alt, ctx, usedSites, slug))) return false;
  if (f.atmospheric && !ctx.atmospheric(id)) return false;
  if (f.submarine && !ctx.submarine(id)) return false;
  if (f.astrobiology && !ctx.astrobiology(id)) return false;
  if (f.elevator && !ctx.elevator(id)) return false;
  if (f.synodic && !(ctx.synodic ? ctx.synodic(id) : (site.body === 'Comet' || site.siteSynodic))) return false;
  if (f.spectral && String(site.spectralType || '').toUpperCase() !== String(f.spectral).toUpperCase()) return false;
  if (f.hydration != null && Number(site.hydration || 0) !== Number(f.hydration)) return false;
  if (f.body && String(site.body || '') !== String(f.body)) return false;
  if (f.zone && site.solarZone !== f.zone) return false;
  if (f.notzone && String(f.notzone).split('|').includes(site.solarZone)) return false;
  if (f.beyond && !(zoneIdx(site.solarZone) > zoneIdx(f.beyond))) return false;
  if (f.glory === 'unclaimed' && !ctx.gloryUnclaimed(site.solarZone)) return false;
  if (f.different && usedSites.includes(id)) return false;
  if (f.augmented && !(ctx.augmentedAt && ctx.augmentedAt(id, !!f.own))) return false;
  return true;
}

// A destination step in plain words, for the checklist drawn on the card
// (4B4d: each step is announced in order). `nameOf(slug)` names a map space.
function siteAdjectives(f) {
  const a = [];
  if (f.unexplored) a.push('unexplored');
  if (f.signposted) a.push('signposted');
  if (f.busted) a.push('busted');
  if (f.synodic) a.push('synodic');
  if (f.submarine) a.push('submarine');
  if (f.atmospheric) a.push('atmospheric');
  if (f.astrobiology) a.push('astrobiology');
  if (f.elevator) a.push('space elevator');
  if (f.spectral) a.push(`${f.spectral}-type`);
  if (f.size) a.push(typeof f.size === 'object' ? `size ${f.size.min}+` : `size-${f.size}`);
  return a;
}
function sitePlace(f) {
  const w = [];
  if (f.body) w.push(`on ${f.body}`);
  if (f.zone) w.push(`in the ${f.zone} zone`);
  if (f.notzone) w.push(`outside the ${String(f.notzone).split('|').join(' / ')} zone`);
  if (f.beyond) w.push(`beyond the ${f.beyond} zone`);
  if (f.hydration != null) w.push(`with hydration ${f.hydration}`);
  if (f.either) w.push(f.either.map((alt) => [...sitePlace(alt), ...siteAdjectives(alt)].join(' ')).join(' or '));
  if (f.adjacent === 'hazard') w.push('next to a hazard');
  if (f.farthestglory) w.push('in the farthest zone with a claimed glory chit');
  if (f.glory === 'unclaimed') w.push('in a zone whose glory chit is unclaimed');
  if (f.different) w.push('(a different site)');
  return w;
}
function stackTerms(f) {
  const w = [];
  if (f.human) w.push('a Human aboard');
  if (f.robonaut && f.refinery) w.push('an operational robonaut and refinery');
  else if (f.robonaut) w.push('an operational robonaut');
  else if (f.refinery) w.push('an operational refinery');
  return w;
}
const article = (word) => (/^[aeiou]/i.test(word) ? 'an' : 'a');
export function stepLabel(step, nameOf = (s) => s) {
  const f = step.filters || {};
  const same = f.sameturn ? ' the same turn' : '';
  const withs = stackTerms(f);
  const withTail = withs.length ? ` with ${withs.join(' and ')}` : '';
  const rolled = f.rolled ? ', after a hazard roll this turn' : '';
  switch (step.verb) {
    case 'at': return `Reach ${step.sites.map(nameOf).join(' or ')}${withTail}${same}`;
    case 'site': {
      if (f.ownfactory) return `Land at your Factory${withTail}${rolled}${same}`;
      const adj = siteAdjectives(f);
      const noun = [...adj, 'site'].join(' ');
      const place = sitePlace(f);
      const fallback = f.orany ? ' (any site once none is left)' : '';
      return `Reach ${article(noun)} ${noun}${place.length ? ' ' + place.join(', ') : ''}${fallback}${withTail}${rolled}${same}`;
    }
    case 'space': {
      if (f.beo) return `Reach ${f.different ? 'another' : 'one'} of your Anchored non-Home Bernals`;
      const kind = f.aero ? 'an aerobrake space' : f.hazard ? 'a hazard space' : 'a space';
      return `Reach ${kind}${f.beyond ? ` beyond the ${f.beyond} zone` : ''}${same}`;
    }
    case 'enter': return `Pass through ${nameOf(step.node)}${same}`;
    case 'flybys': return `${step.count} flyby${step.count === 1 ? '' : 's'}${f.beyond ? ` beyond the ${f.beyond} zone` : ''} in one turn`;
    case 'liftoff': return 'Lift off from there';
    case 'belt': return `Enter a Radiation Belt${f.beyond ? ` beyond the ${f.beyond} zone` : ''}`;
    case 'colony': {
      const who = f.own ? 'your' : 'a';
      const kind = [f.beo ? 'BEO' : '', 'Colony'].filter(Boolean).join(' ');
      const bits = [];
      if (f.atmospheric) bits.push('at an atmospheric site');
      if (f.submarine) bits.push('at a submarine site');
      if (f.zone) bits.push(`in the ${f.zone} zone`);
      if (f.notzone) bits.push(`outside the ${String(f.notzone).split('|').join(' / ')} zones`);
      if (f.road) bits.push('on a buggy road to another Colony');
      if (f.augmented) bits.push('with an augmented Colonist');
      if (f.buggy) bits.push('with an operational buggy');
      if (f.different) bits.push('(a different one)');
      return `Reach ${who} ${kind}${bits.length ? ' ' + bits.join(', ') : ''}`;
    }
    case 'isobank': return `Reach the isobank${f.augmented ? ' with an augmented Colonist' : ''}${f.spaceborn ? ' with a spaceborn or Promoted Colonist' : ''}`;
    case 'return': return 'Return to LEO';
    default: return step.why || step.raw;
  }
}

// Is step `step` satisfied right now? `where` describes the stack carrying the
// contract: { siteId (a site slug, or null / a space node), atLeo, entered: [nodes
// entered this turn] } ; `progress` = { sites: [site per done step] }.
// `prev` is the step before this one: a `sameturn` step also needs that one to
// hold this turn (Sun-fired Laser: Mercury L1 to Mercury L3 in one turn), so an
// earlier announcement can never strand the contract.
// Returns { ok, siteId?, why? }.
export function stepSatisfied(step, where, progress, ctx, prev = null) {
  const used = (progress && progress.sites) || [];
  if (step.filters && step.filters.sameturn && prev) {
    const before = { ...progress, sites: used.slice(0, -1) };
    if (!stepSatisfied(prev, where, before, ctx).ok) return { ok: false, why: 'not_same_turn' };
  }
  switch (step.verb) {
    case 'at': {
      const id = where.siteId;
      if (!id || !step.sites.includes(id)) return { ok: false, why: 'not_at_destination' };
      // A listed space (a hazard, a Lagrange point) has no site record; only a
      // site carries conditions to check.
      const site = ctx.site(id);
      const conds = Object.keys(step.filters || {}).filter((k) => k !== 'sameturn');
      if (site ? !siteMatches(site, step.filters, ctx, used, id) : conds.length) return { ok: false, why: 'destination_conditions' };
      return { ok: true, siteId: id };
    }
    case 'site': {
      const id = where.siteId;
      const site = id ? ctx.site(id) : null;
      if (!site) return { ok: false, why: 'not_at_a_site' };
      if (!siteMatches(site, step.filters, ctx, used, id)) return { ok: false, why: 'destination_conditions' };
      return { ok: true, siteId: id };
    }
    // A map space of a kind: `aero` (an aerobrake space), `hazard` (a crash
    // hazard), `beyond=<zone>` (farther from the Sun than that zone).
    case 'space': {
      const id = where.atLeo ? null : where.siteId;
      if (!id) return { ok: false, why: 'not_at_destination' };
      const f = step.filters || {};
      const kind = ctx.nodeHazard ? ctx.nodeHazard(id) : null;
      if (f.aero && kind !== 'aero') return { ok: false, why: 'destination_conditions' };
      if (f.hazard && kind !== 'skull') return { ok: false, why: 'destination_conditions' };
      if (f.beyond && !(zoneIdx(ctx.nodeZone(id)) > zoneIdx(f.beyond))) return { ok: false, why: 'destination_conditions' };
      // Your Anchored non-Home Bernal (a BEO Bernal, 4A7d) stands here.
      if (f.beo && !(ctx.ownBeoBernal && ctx.ownBeoBernal(id))) return { ok: false, why: 'destination_conditions' };
      // Chipjack: your Colonist here with another player's augmented one.
      if (f.target && !(ctx.targetHere && ctx.targetHere(id))) return { ok: false, why: 'destination_conditions' };
      if (f.different && used.includes(id)) return { ok: false, why: 'destination_conditions' };
      return { ok: true, siteId: id };
    }
    case 'colony': {
      const here = where.atLeo ? null : where.siteId;
      if (!here) return { ok: false, why: 'not_at_a_colony' };
      const f = step.filters || {};
      if (f.different && used.includes(here)) return { ok: false, why: 'destination_conditions' };
      const list = (ctx.coloniesAt ? ctx.coloniesAt(here) : []);
      if (!list.length) return { ok: false, why: 'not_at_a_colony' };
      const siteF = Object.fromEntries(['atmospheric', 'submarine', 'body'].filter((k) => f[k] != null).map((k) => [k, f[k]]));
      const ok = list.some((c) => {
        if (f.own && !c.own) return false;
        if (f.beo && !c.beo) return false;
        const z = ctx.nodeZone(here);
        if (f.zone && z !== f.zone) return false;
        if (f.notzone && String(f.notzone).split('|').includes(z)) return false;
        if (Object.keys(siteF).length && !c.sites.some((sl) => { const st = ctx.site(sl); return st && siteMatches(st, siteF, ctx, [], sl); })) return false;
        if (f.road && !(ctx.roadToOtherColony && ctx.roadToOtherColony(c))) return false;
        return true;
      });
      if (!ok) return { ok: false, why: 'destination_conditions' };
      if (f.augmented && !(ctx.augmentedAt && ctx.augmentedAt(here, false))) return { ok: false, why: 'no_augmented_colonist' };
      if (f.buggy && !(ctx.stackBuggy && ctx.stackBuggy())) return { ok: false, why: 'no_operational_buggy' };
      return { ok: true, siteId: here };
    }
    case 'isobank': {
      const here = where.atLeo ? null : where.siteId;
      const ib = ctx.isobankSite ? ctx.isobankSite() : null;
      if (!ib || here !== ib) return { ok: false, why: 'not_at_isobank' };
      const f = step.filters || {};
      if (f.augmented && !(ctx.augmentedAt && ctx.augmentedAt(here, false))) return { ok: false, why: 'no_augmented_colonist' };
      if (f.spaceborn && !(ctx.spacebornOrPromotedAt && ctx.spacebornOrPromotedAt(here))) return { ok: false, why: 'no_spaceborn_colonist' };
      return { ok: true, siteId: here };
    }
    // A Radiation Belt space entered this turn (or where the stack stands),
    // one an earlier step has not already counted.
    case 'belt': {
      const f = step.filters || {};
      const seen = [...(where.entered || []), ...(where.siteId && !where.atLeo ? [where.siteId] : [])];
      const hit = seen.find((n) => ctx.nodeHazard && ctx.nodeHazard(n) === 'rad' && !used.includes(n)
        && (!f.beyond || zoneIdx(ctx.nodeZone(n)) > zoneIdx(f.beyond)));
      return hit ? { ok: true, siteId: hit } : { ok: false, why: 'no_radiation_belt' };
    }
    case 'enter':
      return (where.entered || []).includes(step.node) ? { ok: true } : { ok: false, why: 'not_entered_this_turn' };
    case 'flybys': {
      const beyond = step.filters && step.filters.beyond;
      const hits = new Set((where.entered || []).filter((n) => FLYBY_NODES.has(n)
        && (!beyond || zoneIdx(ctx.nodeZone(n)) > zoneIdx(beyond))));
      return hits.size >= step.count ? { ok: true } : { ok: false, why: 'not_enough_flybys', detail: { have: hits.size, need: step.count } };
    }
    case 'liftoff': {
      const last = used[used.length - 1];
      return last && where.siteId !== last ? { ok: true } : { ok: false, why: 'not_lifted_off' };
    }
    case 'return':
      return where.atLeo ? { ok: true } : { ok: false, why: 'not_returned' };
    default:
      return { ok: false, why: 'destination_not_yet_supported', detail: { step: step.why || step.raw } };
  }
}

// Acetylene Rocketplane Liftoff terms (H6c), with the M4 Equatorial Launch
// Railway ability folded in: it is allowed from an atmospheric Site, or from
// any of your own Factories with the ability; it costs 2 x wet mass in water
// stored at the Site, halved (round up) on an atmospheric Site with the ability.
// Shared by the engine and the client so the cost always agrees.
export function acetyleneTerms({ atmospheric, ownFactory, railway, wetMass }) {
  const full = Math.ceil(2 * (Number(wetMass) || 0));
  const allowed = !!atmospheric || !!(railway && ownFactory);
  const cost = (railway && atmospheric) ? Math.ceil(full / 2) : full;
  return { allowed, cost };
}
