// Space Elevator location pairs (M1, rule 1B9a). A built elevator spans the two
// map Spaces of a pair; a unit may ride between the ends as a FREE action, and a
// linked Factory scores the doubled stock price (scoring hook, later).
//
// Endpoints are SERVER SLUGS - slugify(siteName), the same id2 the engine keys
// state.factories / state.discs by (see data/planner-ids.js#makeRefId: a named
// site slugs to its bare name). Pure data: imported by both the browser client
// and the Node server, so keep it DOM-free / node-free.
//
// NOTE (incomplete by design): the published rule also defines pairs whose far
// end is a transit WAYPOINT - Luna <-> L1 lagrange, and the Pluto / Charon /
// Haumea <-> barycenter elevators. Those endpoints are hashed planner-graph
// waypoint slugs (lag-xxxxx / burn-xxxxx) that are NOT derivable from the static
// site table here, so they are left out until their slugs are resolved against
// the live planner graph. The four site<->site pairs below are fully resolvable
// and active now. Add a row here (no other code change) once a waypoint slug is
// known.
export const ELEVATOR_PAIRS = [
  { a: 'mars-arsia-mons-caves', b: 'phobos',     body: 'Mars' },
  { a: 'saturn-aerostat',       b: 'prometheus', body: 'Saturn' },
  { a: 'uranus-aerostat',       b: 'cordelia',   body: 'Uranus' },
  { a: 'neptune-aerostat',      b: 'despina',    body: 'Neptune' },
];

// Stable key for a pair: the two endpoint slugs sorted + joined, so a|b and b|a
// resolve to the same elevator regardless of order.
export function elevatorPairKey(a, b) {
  return [String(a), String(b)].sort().join('|');
}

// All pairs, each stamped with its key.
export function elevatorPairs() {
  return ELEVATOR_PAIRS.map((p) => ({ ...p, key: elevatorPairKey(p.a, p.b) }));
}

export function elevatorPairByKey(key) {
  return elevatorPairs().find((p) => p.key === key) || null;
}

// Pairs that touch a given site slug (0 or 1 in the current data).
export function elevatorPairsForSite(slug) {
  return elevatorPairs().filter((p) => p.a === slug || p.b === slug);
}

// The OTHER end of a pair given one end (null if `slug` is not on the pair).
export function elevatorOtherEnd(pair, slug) {
  if (!pair) return null;
  if (pair.a === slug) return pair.b;
  if (pair.b === slug) return pair.a;
  return null;
}
