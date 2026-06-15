// Sol Political Assembly (Module 0) - functional data for the assembly panel +
// (later) the engine resolvers. The six ideologies sit in a hexagon around a
// Centrist center; each carries a Law (active when the ideology is in power)
// and an end-game VP award. Pure data: no DOM, no node imports, so both the
// client panel and the server engine can read it (mirrors data/zone-chits.js).
//
// Wording here is our own functional description of each effect (game
// mechanics), NOT a copy of the printed mat's layout or text.
//
// SCOPE: M0 is not in the shipped game yet (see CLAUDE.md "Variants we
// target"). This is the forward-design data behind docs/politics-m0-plan.md.

export const IDEOLOGIES = [
  {
    key: 'freedom', name: 'Freedom', color: '#c01f6e',
    law: { name: 'Free Trade Act', text: 'A Free Market op may sell 2 cards for 5 aqua.' },
    award: { text: '+1 VP per factory cube' },
  },
  {
    key: 'honor', name: 'Honor', color: '#b8bcc6',
    law: { name: 'Paleoconservative Directive', text: 'On a Fundraise op, aqua gained equals your glory-chit count.' },
    award: { text: '+1 VP per glory chit' },
  },
  {
    key: 'unity', name: 'Unity', color: '#e0a81e',
    law: { name: 'UN General Assembly', text: 'Every ideology with 2+ delegates has its Law active, but lobbying is disallowed.' },
    award: { text: '+1 VP per ideology you have a delegate in' },
  },
  {
    key: 'authority', name: 'Authority', color: '#b98fd0',
    law: { name: 'Martial Law', text: 'On a Fundraise op, may discard an opponent’s delegate.' },
    award: { text: '+1 VP per claim disc' },
  },
  {
    key: 'equality', name: 'Equality', color: '#74c79a',
    law: { name: 'Research Grants', text: 'When starting a Research Auction op, pay 1 aqua and take the top card with no support cards.' },
    award: { text: '+1 VP per colony dome' },
  },
  {
    key: 'individuality', name: 'Individuality', color: '#6b7280',
    law: { name: 'Freedom to Roam Treaty', text: 'Treat an opponent’s Factory or Bernal as your own for non-victory purposes.' },
    award: { text: '+1 VP per token on a Site with hazardous lander burns' },
  },
];

export const CENTRIST = {
  key: 'centrist', name: 'Centrist',
  law: {
    name: 'Pad Insurance',
    text: 'With a delegate here, the boost cost of any card you lose to a pad explosion is instantly repaid.',
  },
};

// Lobby free action: activate an inactive ideology's Law for a price.
export const LOBBY_RULE = 'Pay 1 aqua and discard a delegate in an inactive ideology to use its Law.';

// Clockwise from the top, matching the mat's seating, for the hex wheel layout.
export const IDEOLOGY_ORDER = ['freedom', 'honor', 'unity', 'authority', 'equality', 'individuality'];
export const IDEOLOGY_BY_KEY = Object.fromEntries(IDEOLOGIES.map((i) => [i.key, i]));

// Every place a delegate can sit: the six ideologies + the Centrist center.
export const ASSEMBLY_PLACES = [...IDEOLOGY_ORDER, 'centrist'];

// Hex adjacency for Fundraise's "move one space": each ideology touches its two
// ring neighbours and the Centrist center; the center touches every ideology.
export function adjacentPlaces(place) {
  if (place === 'centrist') return [...IDEOLOGY_ORDER];
  const i = IDEOLOGY_ORDER.indexOf(place);
  if (i < 0) return [];
  const n = IDEOLOGY_ORDER.length;
  return [IDEOLOGY_ORDER[(i + n - 1) % n], IDEOLOGY_ORDER[(i + 1) % n], 'centrist'];
}

// A player's wooden cubes are ONE shared pool of 7, used for BOTH factories and
// assembly delegates (so at most 7 delegates, fewer once factories are built).
// The engine enforces the factory+delegate sum against this; delegatesRemaining
// here is just the delegates-only upper bound.
export const DELEGATES_PER_PLAYER = 7;

// Empty assembly: delegate placements keyed by place, then profileId -> count;
// plus a neutral seniority-disc count per place. The round's first player drops
// one permanent seniority disc each round end (data/assembly.js stays pure: the
// engine mutates these). { delegates:{[place]:{[pid]:n}}, seniority:{[place]:n} }.
export function freshAssembly() {
  const delegates = {};
  const seniority = {};
  for (const place of ASSEMBLY_PLACES) { delegates[place] = {}; seniority[place] = 0; }
  return { delegates, seniority };
}
// Seniority discs sitting in a place (neutral; not owned by any player).
export function seniorityInPlace(assembly, place) {
  return ((assembly && assembly.seniority && assembly.seniority[place]) | 0);
}

// Total delegates sitting in a place (across all players).
export function delegatesInPlace(assembly, place) {
  const m = (assembly && assembly.delegates && assembly.delegates[place]) || {};
  return Object.values(m).reduce((s, n) => s + (n | 0), 0);
}
// A player's delegates in a place.
export function playerDelegatesInPlace(assembly, place, profileId) {
  const m = (assembly && assembly.delegates && assembly.delegates[place]) || {};
  return (m[profileId] | 0);
}
// A player's total placed delegates (all places).
export function playerDelegatesPlaced(assembly, profileId) {
  return ASSEMBLY_PLACES.reduce((s, p) => s + playerDelegatesInPlace(assembly, p, profileId), 0);
}
// Delegates a player still has in hand.
export function delegatesRemaining(assembly, profileId) {
  return Math.max(0, DELEGATES_PER_PLAYER - playerDelegatesPlaced(assembly, profileId));
}

// Which ideology Laws are in force, plus whether lobbying is disabled.
//
// RULE MODEL (mechanics; tune to the M0 rulebook):
//  - Base: the ideology(ies) holding the MOST delegates are in power. Ties put
//    every tied ideology in power. Zero delegates = not in power.
//  - Unity override: when Unity is in power, EVERY ideology with 2+ delegates is
//    also in power and lobbying is disabled (the printed UN General Assembly law).
//  - The Centrist center is not an ideology law; its pad insurance is keyed off
//    a delegate sitting there, handled separately.
//
// Returns { active: Set<ideologyKey>, lobbyingDisabled: boolean }.
export function activeLaws(assembly) {
  const totals = {};
  let max = 0;
  for (const key of IDEOLOGY_ORDER) {
    const n = delegatesInPlace(assembly, key);
    totals[key] = n;
    if (n > max) max = n;
  }
  const active = new Set();
  if (max > 0) {
    for (const key of IDEOLOGY_ORDER) if (totals[key] === max) active.add(key);
  }
  let lobbyingDisabled = false;
  if (active.has('unity')) {
    lobbyingDisabled = true;
    for (const key of IDEOLOGY_ORDER) if (totals[key] >= 2) active.add(key);
  }
  return { active, lobbyingDisabled };
}

// The single ideology whose law is "in power" - the strict delegate plurality
// leader. A tie or an empty board has no leader, so the active-law marker sits
// at the Centrist center (its starting position). Returns a place key.
export function lawLeader(assembly) {
  let leader = null;
  let best = 0;
  let tie = false;
  for (const key of IDEOLOGY_ORDER) {
    const n = delegatesInPlace(assembly, key);
    if (n > best) { best = n; leader = key; tie = false; }
    else if (n === best && n > 0) tie = true;
  }
  return (leader && !tie && best > 0) ? leader : 'centrist';
}

// End-game political vote. For each IDEOLOGY space (Centrist is not in the
// running), votes = every player's delegate cubes there + neutral seniority
// discs there. The winner is the space with the most votes; a tie is broken by
// the most seniority discs; any remaining tie falls to IDEOLOGY_ORDER. The
// winning ideology's end-game award is then applied (by the engine, which holds
// the holdings the award counts). Returns:
//   { winner: key|null, totals: { [key]: { cubes, discs, votes } }, tied: [keys] }
export function finalVote(assembly) {
  const totals = {};
  for (const key of IDEOLOGY_ORDER) {
    const cubes = delegatesInPlace(assembly, key);
    const discs = seniorityInPlace(assembly, key);
    totals[key] = { cubes, discs, votes: cubes + discs };
  }
  let winner = null;
  let bestVotes = 0;
  let bestDiscs = -1;
  for (const key of IDEOLOGY_ORDER) {
    const t = totals[key];
    if (t.votes <= 0) continue;
    if (t.votes > bestVotes
        || (t.votes === bestVotes && t.discs > bestDiscs)) {
      winner = key; bestVotes = t.votes; bestDiscs = t.discs;
    }
  }
  // Report any spaces still tied with the winner on BOTH votes and discs (the
  // engine can surface "tie broken by seat order" in the breakdown).
  const tied = winner
    ? IDEOLOGY_ORDER.filter((k) => totals[k].votes === bestVotes && totals[k].discs === bestDiscs)
    : [];
  return { winner, totals, tied };
}
