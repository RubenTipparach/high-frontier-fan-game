// One-way ("arrow") movement on the solar map (core rules B7e / aerobrake rule
// c): "A Spacecraft cannot move against the arrow's direction." An aerobrake's
// arrow always points DOWN the gravity well (you fall INTO the atmosphere to
// decelerate); a few other ramps are one-way too.
//
// These arrows are ALREADY ENCODED in the planner map: an edge labelled '0' from
// A to B (and not from B to A) is traversable A -> B ONLY. data/one-way-edges.js
// is the generated, authoritative list of those arrows in id2-slug space (run
// scripts/gen-one-way-edges.mjs to rebuild it from the planner JSON). We read it
// directly instead of re-deriving a heuristic direction, so the route planner,
// the manual plotter, the move commit, AND the server engine all honour the SAME
// printed arrows from one source of truth.
//
// Pure: no DOM, no node imports. Imported by BOTH js/game/* and server/game/*.
import { ONE_WAY_ARROWS } from './one-way-edges.js';

// Forward-arrow lookup: 'from>to' for every encoded one-way edge.
const FORWARD = new Set(ONE_WAY_ARROWS.map(([a, b]) => `${a}>${b}`));

// Is the hop FROM -> TO legal under the one-way arrow rule? Slugs are id2. A hop
// is illegal only when it runs AGAINST the sole arrow on that edge: an arrow
// TO -> FROM exists and there is no arrow FROM -> TO. A junction corridor with
// several descent exits simply has several FROM -> downX arrows, so every
// descent stays legal while climbing back out the top is blocked. Edges with no
// arrow (the vast majority) are always two-way.
export function aeroHopAllowed(from, to) {
  if (from == null || to == null) return true;
  if (FORWARD.has(`${to}>${from}`) && !FORWARD.has(`${from}>${to}`)) return false;
  return true;
}
