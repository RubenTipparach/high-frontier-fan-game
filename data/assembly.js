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
    law: { name: 'Research Grants', text: 'When starting a Research Auction op, pay 1 aqua and take the top card, with no support cards and no hand limit.' },
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

// Solitaire Module 0 (4G3, the Solitaire Sol Political Assembly playmat). The
// solo mat keeps the SAME six end-game awards but swaps the LAWS so every
// ideology is relevant for one player (no opponent-facing effects, less luck).
// Used when a game runs the solo assembly (state.ceoSolo); multiplayer M0 keeps
// the base IDEOLOGIES laws above. Keyed by ideology key. Centrist (Mishap /
// Pad Insurance) is unchanged. Wording is our own functional description.
export const SOLO_LAWS = {
  freedom: { name: 'Free Trade Act II', text: 'A Free Market op may sell 2 cards (3 aqua each).' },
  honor: { name: 'Paleoconservative Directive', text: 'On a Fundraise op, the aqua gained equals the glory chits you have brought back to LEO.' },
  unity: { name: 'Sol Unification', text: 'Lobbying costs 0 aqua. The season-blue Anarchy event becomes International Assistance: FINAO costs are halved until the end of season blue.' },
  authority: { name: 'Regime Change', text: 'After an event roll, discard a delegate here to change or cancel the inspiration (may be the same delegate used to lobby).' },
  equality: { name: 'Subsidized Research', text: 'When you start a Research Auction op, take the top card of a patent deck and one bonus support for free; you may pay 2 aqua for a second bonus support.' },
  individuality: { name: 'Launch Contracts', text: 'Boosting is a free action: it does not spend your turn\'s operation.' },
};

// The Law shown/used for an ideology, choosing the solitaire set when `solo` is
// true. Single source of truth so the client mat + engine read the same law.
export function lawForIdeology(key, solo) {
  if (solo && SOLO_LAWS[key]) return SOLO_LAWS[key];
  const ide = IDEOLOGY_BY_KEY[key];
  return ide ? ide.law : null;
}

// Does this game run the SOLITAIRE Sol Political Assembly (4G3) rather than the
// multiplayer one? Two games do:
//
//  - CEO Solitaire (V6), where the board-meeting loop IS that assembly.
//  - A ONE-SEAT V5 Hermes Fall room whose host opted into Module 0. Hermes is
//    cooperative and plays at any table size, but the multiplayer laws are
//    written around a contested tally - "discard an OPPONENT's delegate",
//    "every OTHER player pays" - and with one player at the table half of them
//    are dead text. The solitaire mat exists precisely so every ideology still
//    means something to a single player, so that is the set a solo Hermes runs.
//    At two or more seats Hermes is not offered Module 0 at all (user
//    2026-08-04: "only available in solo mode").
//
// Reads a flag DECIDED ONCE at setup rather than re-deriving "is this solo?"
// from the player list at each of its dozen call sites - the same reason
// isHomeBernal stores its answer. `state.ceoSolo` is still honoured directly so
// games already in flight need no migration.
export function usesSoloAssembly(state) {
  return !!(state && (state.ceoSolo || state.soloAssembly));
}

// Faction colour -> ideology. A faction's seat-band colour IS its ideology
// (the two palettes pair by hue, even though the hex values differ slightly:
// crew #b40054 vs ideology #c01f6e, etc.). Used in SOLO to seat the starting
// delegate in the picked faction's ideology; this colour=ideology theme recurs
// in later modules. Keyed by the crew/faction colour (lowercased).
export const IDEOLOGY_BY_FACTION_COLOR = {
  '#b40054': 'freedom',        // magenta
  '#e3e0d4': 'honor',          // cream / silver
  '#fccc00': 'unity',          // gold
  '#c09cc0': 'authority',      // mauve / purple
  '#a8d8c0': 'equality',       // mint / green
  '#9c9c9c': 'individuality',  // grey
};
export function ideologyForFactionColor(color) {
  if (!color) return null;
  return IDEOLOGY_BY_FACTION_COLOR[String(color).toLowerCase()] || null;
}

// Colonist cards (M2) print their Ideology as a colour NAME (the sheet's
// Ideology column: Red / White / Yellow / Purple / Green / Grey), the same
// hue pairing as IDEOLOGY_BY_FACTION_COLOR. An exomigrated colonist may seat
// a delegate of the owner's colour in this ideology (O2a).
export const IDEOLOGY_BY_COLOR_NAME = {
  red: 'freedom',
  white: 'honor',
  yellow: 'unity',
  purple: 'authority',
  green: 'equality',
  grey: 'individuality',
  gray: 'individuality',
};
export function ideologyForColorName(name) {
  if (!name) return null;
  return IDEOLOGY_BY_COLOR_NAME[String(name).trim().toLowerCase()] || null;
}

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
// Seat (or re-seat) a player's SINGLE starting delegate in the ideology that
// matches their faction / seat colour - colour IS ideology, so the cube's
// colour lines up with the zone it sits in. Clears any delegate that player
// already has on the board first (so a re-pick moves the cube rather than
// adding a second), then drops one cube in the colour's ideology. Falls back to
// `fallbackIdeology` when the colour has no mapping. Returns the ideology key
// used, or null if nothing could be seated. Single source of truth for "where
// does a player's opening cube start": both createInitialState
// (server/game/state.js) and PICK_CREW (server/game/engine.js) call it.
export function seatStartingDelegate(assembly, profileId, color, fallbackIdeology = null) {
  if (!assembly || !profileId) return null;
  const ide = ideologyForFactionColor(color) || fallbackIdeology;
  if (!ide) return null;
  for (const place of ASSEMBLY_PLACES) {
    const m = assembly.delegates[place];
    if (m && m[profileId] != null) delete m[profileId];
  }
  assembly.delegates[ide] = assembly.delegates[ide] || {};
  assembly.delegates[ide][profileId] = 1;
  return ide;
}

// CEO Solitaire (4G3a setup): on top of the faction-ideology starting delegate,
// the solo player seats an ADDITIONAL delegate in Centrist. Set to exactly one so
// a crew re-pick (which re-runs seatStartingDelegate) stays idempotent.
export function seatCeoSoloCentristDelegate(assembly, profileId) {
  if (!assembly || !profileId) return;
  const m = assembly.delegates.centrist || (assembly.delegates.centrist = {});
  m[profileId] = 1;
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

// Vote tally: the spaces tied for the MOST delegates (the spaces that win the
// vote). Centrist is a full participant here (it holds delegates and can win the
// vote); starring it means no ideology law is in force, only the always-on
// Centrist passive. Empty when no space has a delegate. The fundraiser moves the
// active-law star onto the winner; on a tie they pick which tied space gets it.
export function voteWinners(assembly) {
  const totals = {};
  let max = 0;
  for (const key of ASSEMBLY_PLACES) {
    const n = delegatesInPlace(assembly, key);
    totals[key] = n;
    if (n > max) max = n;
  }
  if (max <= 0) return [];
  return ASSEMBLY_PLACES.filter((k) => totals[k] === max);
}

// Which Laws are in force, plus whether lobbying is disabled. Driven by the
// active-law STAR (the marker the fundraiser moves on the vote tally): the
// starred space's law is in power. A star on Centrist puts Centrist - Pad
// Insurance in power; a star on an ideology puts that ideology's law in power.
// Unity's override still applies when Unity is starred (every 2+ ideology
// active, no lobbying). A null star = no law in force. When `star` is undefined
// (legacy state with no stored star) this falls back to the old plurality
// reading.
//
// Returns { active: Set<placeKey>, lobbyingDisabled: boolean }.
export function activeLaws(assembly, star, solo = false, anarchy = false) {
  const active = new Set();
  // Anarchy / Lawlessness (Module 0): while the Sunspot Cube sits in season
  // blue, the Law indicated by the Active Law is inactivated. The star can still
  // move (the vote tally still runs) and every Law may still be lobbied, so no
  // law is in force here and lobbying is never disabled.
  if (anarchy) return { active, lobbyingDisabled: false };
  if (star === undefined) {
    for (const key of voteWinners(assembly)) active.add(key);   // legacy fallback
  } else if (star === 'centrist') {
    active.add('centrist');   // Centrist - Pad Insurance is the law in power
  } else if (star && IDEOLOGY_ORDER.includes(star)) {
    active.add(star);
  }
  let lobbyingDisabled = false;
  // Base M0 Unity (UN General Assembly) cascades every 2+ ideology's law and
  // disables lobbying. The SOLITAIRE Unity (Sol Unification) does neither - it
  // just zeroes the lobby cost - so skip the override when solo.
  if (active.has('unity') && !solo) {
    lobbyingDisabled = true;
    for (const key of IDEOLOGY_ORDER) if (delegatesInPlace(assembly, key) >= 2) active.add(key);
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
