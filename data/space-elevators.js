// Space Elevator locations (M1, rule 1B9a). Each pair marks the two map Spaces
// an elevator cable spans. A pair listed here is only a map MARKER until the
// cable is actually built (state.elevators, via BUILD_ELEVATOR / the Epic
// Hazard) or is the implicit GEO cable (an anchored GEO Elevator Bernal); only
// a BUILT cable colocates its two ends for movement (RIDE_ELEVATOR) or cargo
// (server/game/engine.js#elevatorColocated). Owning a Factory at one end of an
// unbuilt pair does NOT bridge it - that exception was removed (user
// 2026-07-29: "the option to send stuff up the space elevator shouldn't exist
// before I build it").
//
// Endpoints are SERVER SLUGS - a named site is slugify(siteName) (its bare name,
// see data/planner-ids.js#makeRefId); a transit waypoint keeps its planner id2
// (lag-xxxxx / burn-xxxxx, confirmed present in data/planner-nodes.json). Pure
// data: imported by both the browser client and the Node server, so keep it
// DOM-free / node-free. Slugs supplied by the user (2026-06-26).
export const ELEVATOR_PAIRS = [
  // GEO elevator: a special anchoring spot for the GEO Elevator Bernal, NOT a
  // movement elevator. burn-geo <-> Earth (the LEO end). The LEO end points at
  // lag-pr6v8 (the Earth-Moon +2 assist node by the Earth SVG), per user
  // 2026-06-26, so the cable lands right on Earth instead of the bare LEO tag.
  { a: 'burn-geo',         b: 'lag-pr6v8',                body: 'Earth',   geo: true },
  { a: 'lag-qofv5',        b: 'luna-aristarchus-plateau', body: 'Luna' },
  { a: 'phobos',           b: 'mars-arsia-mons-caves',    body: 'Mars' },
  { a: 'saturn-aerostat',  b: 'prometheus',               body: 'Saturn' },
  { a: 'uranus-aerostat',  b: 'cordelia',                 body: 'Uranus' },
  { a: 'lag-xum2h',        b: 'charon',                   body: 'Pluto' },
  { a: 'lag-xum2h',        b: 'pluto',                    body: 'Pluto' },
  { a: 'neptune-aerostat', b: 'despina',                  body: 'Neptune' },
  { a: 'haumea',           b: 'lag-lqd3p',                body: 'Haumea' },
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
