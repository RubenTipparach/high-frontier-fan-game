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
  IF: 'Individuality / Freedom', HU: 'Honor / Unity', EA: 'Equality / Authority',
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

export function parseSteps(text) {
  return String(text || '').split(';').map((s) => s.trim()).filter(Boolean).map((raw) => {
    if (raw.startsWith('manual:')) return { verb: 'manual', why: raw.slice(7).trim(), raw };
    const [head, ...rest] = raw.split(/\s+/);
    const filters = {};
    for (const t of rest) {
      const m = t.match(/^([a-z]+)(>=|=)(.+)$/);
      if (m) filters[m[1]] = m[2] === '>=' ? { min: Number(m[3]) } : m[3];
      else filters[t] = true;
    }
    if (head.startsWith('at:')) return { verb: 'at', sites: head.slice(3).split('|'), filters, raw };
    if (head.startsWith('enter:')) return { verb: 'enter', node: head.slice(6), filters, raw };
    if (head.startsWith('flybys:')) return { verb: 'flybys', count: Number(head.slice(7)) || 1, filters, raw };
    if (head === 'site') return { verb: 'site', filters, raw };
    if (head === 'return') return { verb: 'return', raw };
    if (head === 'liftoff') return { verb: 'liftoff', raw };
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
  return ab;
}
// "When Fulfilling" effects (4B4f) the engine can enact, read off the text.
//   gainAqua : N   ("Gain N Aquas.")
export function parseWhenFulfilling(text) {
  const t = String(text || '').trim();
  const fx = {};
  const g = t.match(/^Gain (\d+) Aquas?\.?$/i);
  if (g) fx.gainAqua = Number(g[1]);
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
// The three ideology-pair decks, blue side up, unshuffled (the server shuffles).
export function contractDeckIds() {
  const decks = { IF: [], HU: [], EA: [] };
  for (const c of CONTRACTS) if (!c.exodus && decks[c.pair]) decks[c.pair].push(c.id);
  return decks;
}

const zoneIdx = (z) => ZONE_ORDER.indexOf(String(z || ''));

// Does `site` (a data/sites.js record) pass a step's filters? `ctx` supplies the
// game-state questions: unexplored(siteId), size(site), gloryUnclaimed(zone),
// atmospheric / submarine / astrobiology / elevator (siteId).
export function siteMatches(site, filters, ctx, usedSites = []) {
  if (!site) return false;
  const f = filters || {};
  const id = site.id;
  if (f.unexplored && !ctx.unexplored(id)) return false;
  if (f.size && ctx.size(site) < f.size.min) return false;
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
  return true;
}

// Is step `step` satisfied right now? `where` describes the stack carrying the
// contract: { siteId (a site slug, or null / a space node), atLeo, entered: [nodes
// entered this turn] } ; `progress` = { sites: [site per done step] }.
// Returns { ok, siteId?, why? }.
export function stepSatisfied(step, where, progress, ctx) {
  const used = (progress && progress.sites) || [];
  switch (step.verb) {
    case 'at': {
      const id = where.siteId;
      if (!id || !step.sites.includes(id)) return { ok: false, why: 'not_at_destination' };
      if (!siteMatches(ctx.site(id), step.filters, ctx, used)) return { ok: false, why: 'destination_conditions' };
      return { ok: true, siteId: id };
    }
    case 'site': {
      const id = where.siteId;
      const site = id ? ctx.site(id) : null;
      if (!site) return { ok: false, why: 'not_at_a_site' };
      if (!siteMatches(site, step.filters, ctx, used)) return { ok: false, why: 'destination_conditions' };
      return { ok: true, siteId: id };
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
