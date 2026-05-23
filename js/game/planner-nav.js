// Rocket pathfinding - ported from the vendor mission planner so
// our routing matches the published board game's burn / turn /
// pivot semantics. Source: vendor/hf-mission-planner/src/index.js
// (the findPath / drawPath / getNeighbors / nodeWeight family).
// The vendor code is intertwined with React UI hooks; we extract
// just the routing logic and parameterise it so multiple callers
// (sandbox map + Stage 3 engine) can drive it cleanly.
//
// Algorithm: multi-objective Dijkstra over the augmented state
// space {node, dir, bonus, burnsRemaining, wait, done}, with
// Pareto-front dominance pruning. The optimization vector is
// lexicographic over `metricPriority` (default
// ['turns','burns','hazards','radHazards']) plus 'segments' as
// the final tiebreaker.
//
// NOTE on the default: the vendor's UI defaults to BURNS first
// (water is precious in HF4) but for our sandbox the more
// intuitive default is TURNS first - the burns-first ordering
// happily takes you 16 hops through free Hohmann transfers to
// save 1 water, which surprises players who clicked a node that
// was literally adjacent to their rocket. Stage 3+ should expose
// a UI knob for this; for now we ship the turns-first default.
//
// Hohmann pivot semantics (the bit our old nav.js missed): each
// edge between Hohmann-marked nodes carries a *direction label*
// (a string id, NOT a numeric burn cost). Two adjacent nodes
// sharing a label sit on the same Hohmann transfer; moving along
// it (no direction change) is free. Switching to a different
// label costs 2 burns. Stopping ('wait') on a Hohmann resets dir
// to null, so the next turn you can leave on any direction -
// matching the table-game pivot rule.

import { dijkstra } from './planner-dijkstra.js';

const PATH_ID = Symbol('pathId');

// Lexicographic tuple arithmetic. Each weight is a number[] whose
// entries correspond to the metricPriority order (with `segments`
// appended as the final tiebreaker).
const tupleNs = {
  zero: [],
  add(a, b) {
    const n = Math.max(a.length, b.length);
    const r = [];
    for (let i = 0; i < n; i++) r[i] = (a[i] ?? 0) + (b[i] ?? 0);
    return r;
  },
  lessThan(a, b) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const ai = a[i] ?? 0;
      const bi = b[i] ?? 0;
      if (ai !== bi) return ai < bi;
    }
    return false;
  },
  equals(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return false;
    return true;
  },
  lessThanEq(a, b) { return tupleNs.lessThan(a, b) || tupleNs.equals(a, b); },
};

// Pareto-front dominance check. The vendor module maintains a
// frontier of (weight, burnsRemaining, bonus) tuples per
// dominance key; we keep the same logic so search behaviour
// matches verbatim.
function makeDominancePrune() {
  const dominanceKey = (node) => {
    const dir = node.dir ?? '';
    const wait = node.wait ? 'w' : '';
    const done = node.done ? 'd' : '';
    return `${node.node}|${dir}|${wait}|${done}`;
  };
  const frontier = new Map();
  return (node, weight) => {
    const key = dominanceKey(node);
    const br  = node.burnsRemaining ?? 0;
    const bonus = node.bonus ?? 0;
    const entries = frontier.get(key);
    if (entries) {
      for (const e of entries) {
        if (tupleNs.lessThanEq(e.weight, weight)
            && e.burnsRemaining >= br
            && e.bonus >= bonus) {
          return true;
        }
      }
      const kept = entries.filter((e) =>
        !(tupleNs.lessThanEq(weight, e.weight)
          && br >= e.burnsRemaining
          && bonus >= e.bonus));
      kept.push({ weight, burnsRemaining: br, bonus });
      frontier.set(key, kept);
    } else {
      frontier.set(key, [{ weight, burnsRemaining: br, bonus }]);
    }
    return false;
  };
}

function pathId(p) {
  if (p[PATH_ID]) return p[PATH_ID];
  const id = p.done
    ? p.node
    : `s:${p.node}|${p.dir ?? ''}|${p.bonus}|${p.burnsRemaining}|${p.wait ? 1 : 0}`;
  Object.defineProperty(p, PATH_ID, { value: id });
  return id;
}

// Build a closure-bound search environment from a graph + config.
// Returns { findPath, drawPath, pathWeight } - same surface as
// the vendor but parameterised on map data + search config.
//
// `graph` shape:
//   {
//     byId: { [id]: point },       // points keyed by id
//     edgeLabels: { [from]: { [to]: string } },
//     neighbors: Map<string, Set<string>>
//   }
// where each point has at least { type, hazard?, landing?, flybyBoost? }.
//
// `config`:
//   thrust: per-turn burn budget (set this to the active thruster's
//     thrust value; defaults to 4 to match HF4's free-LEO burns)
//   solarSeason: 'blue' | 'yellow' | 'red'; used to gate the Venus
//     flyby bonus.
//   metricPriority: order of optimization metrics. Default matches
//     the vendor's UI default.
export function buildPlanner(graph, {
  thrust = 4,
  solarSeason = 'red',
  metricPriority = ['turns', 'burns', 'hazards', 'radHazards'],
} = {}) {
  const points = graph.byId;
  const edgeLabels = graph.edgeLabels || {};
  const neighbors = graph.neighbors;

  function neighborsOf(id) {
    const s = neighbors.get(id);
    return s ? Array.from(s) : [];
  }

  // Same logic as the vendor's `allowed` filter (verbatim port).
  // - Same-node transitions (changing state without moving) are
  //   always allowed; getNeighbors prevents infinite cycles.
  // - If we previously entered a 'site' node, the turn must end -
  //   you can't keep flying after landing on a site.
  // - Otherwise: walk back to the first node that differs from u,
  //   then walk the rest of the path. If v's node appears anywhere
  //   with the same direction (or null), this would be a loop.
  function allowed(u, v, id, previous) {
    const uId = u.node;
    const vId = v.node;
    const prev = (n) => previous[id(n)];
    if (uId === vId) return true;
    if (prev(u) && points[u.node]?.type === 'site') return false;
    let n = prev(u);
    while (n && n.node === uId) n = prev(n);
    while (n) {
      if (n.node === vId && (n.dir === v.dir || n.dir == null)) return false;
      n = prev(n);
    }
    return true;
  }

  function getNeighbors(p) {
    if (p.done) return [];
    const { node, dir, bonus, burnsRemaining, wait } = p;
    const ns = [{ node, dir: null, bonus: 0, done: true, burnsRemaining }];
    const venusFlybyAvailable = solarSeason === 'blue';
    // Hohmann direction-change branch.
    if (edgeLabels[node] && dir != null && !wait) {
      for (const otherNode of Object.keys(edgeLabels[node])) {
        if (edgeLabels[node][otherNode] !== dir) {
          const otherPoint = points[otherNode];
          if (!otherPoint) continue;
          const directionChangeCost =
            (edgeLabels[node][otherNode] === '0' ? 0 : 2)
            + (otherPoint.type === 'burn' ? (otherPoint.landing ?? 1) : 0);
          const bonusAfter = Math.max(bonus - directionChangeCost, 0);
          const bonusUsed = bonus - bonusAfter;
          const brAfter = burnsRemaining - directionChangeCost + bonusUsed;
          const otherType = otherPoint.type;
          const newDir = (otherType === 'hohmann' || otherType === 'decorative')
            ? edgeLabels[node][otherNode]
            : null;
          if (directionChangeCost <= burnsRemaining) {
            ns.push({ node: otherNode, dir: newDir, bonus: bonusAfter, burnsRemaining: brAfter });
          }
        }
      }
    }
    // Wait-a-turn branch. End-turn is legal at Hohmann nodes, or at
    // burn/lagrange nodes once the budget is fully spent. Resets
    // dir to null so the rocket can pivot freely next turn -
    // exactly the "Hohmann stop to pivot" rule the user called out.
    if (!wait && (points[node]?.type === 'hohmann'
        || ((points[node]?.type === 'burn' || points[node]?.type === 'lagrange') && burnsRemaining === 0))) {
      ns.push({ node, dir: null, bonus: 0, wait: true, burnsRemaining: thrust });
    }
    // Move to a neighbour (non-Hohmann-pivot path).
    for (const other of neighborsOf(node)) {
      const otherPoint = points[other];
      if (!otherPoint) continue;
      if (edgeLabels[other] && edgeLabels[other][node] === '0') continue;
      const sameDirOrFree =
        !(node in edgeLabels)
        || !(other in edgeLabels[node])
        || edgeLabels[node][other] === dir
        || dir == null;
      if (!sameDirOrFree) continue;
      const newDir = (edgeLabels[other] && edgeLabels[other][node])
        ? edgeLabels[other][node] : null;
      const entryCost = otherPoint.type === 'burn' ? (otherPoint.landing ?? 1) : 0;
      const rawFlyby = (otherPoint.type === 'venus' && !venusFlybyAvailable)
        ? 0
        : (otherPoint.flybyBoost ?? 0);
      const flybyBoost = rawFlyby === 'thrust' ? thrust : rawFlyby;
      const bonusUsed = otherPoint.landing ? 0 : Math.min(bonus, entryCost);
      const bonusAfter = Math.max(bonus - bonusUsed + flybyBoost, 0);
      if (burnsRemaining >= entryCost - bonusUsed) {
        ns.push({ node: other, dir: newDir, bonus: bonusAfter, burnsRemaining: burnsRemaining - (entryCost - bonusUsed) });
      }
    }
    return ns;
  }

  function burnWeight(u, v) {
    if (v.burnsRemaining < u.burnsRemaining) return u.burnsRemaining - v.burnsRemaining;
    return 0;
  }
  function turnWeight(u, v) { return v.wait ? 1 : 0; }
  function hazardWeight(u, v) {
    if (u.node === v.node) return 0;
    return points[v.node]?.hazard ? 1 : 0;
  }
  function radHazardWeight(u, v) {
    if (u.node === v.node) return 0;
    return points[v.node]?.type === 'radhaz' ? 1 : 0;
  }
  function segmentWeight(u, v) {
    return points[v.node]?.type === 'decorative' ? 0 : 1;
  }
  function edgeWeights(u, v) {
    return {
      burns:      burnWeight(u, v),
      turns:      turnWeight(u, v),
      hazards:    hazardWeight(u, v),
      radHazards: radHazardWeight(u, v),
      segments:   segmentWeight(u, v),
    };
  }
  function nodeWeight(u, v) {
    const w = edgeWeights(u, v);
    return [...metricPriority.map((k) => w[k]), w.segments];
  }

  function findPath(fromId) {
    const source = { node: fromId, dir: null, bonus: 0, burnsRemaining: thrust };
    return dijkstra(getNeighbors, nodeWeight, tupleNs, pathId, source, allowed, makeDominancePrune());
  }

  function drawPath(pathData, fromId, toId) {
    const { distance, previous } = pathData;
    const source = { node: fromId, dir: null, bonus: 0, burnsRemaining: thrust };
    const target = { node: toId, dir: null, bonus: 0, done: true };
    const targetId = pathId(target);
    if (!(targetId in distance)) return null;
    const path = [target];
    let cur = target;
    while (pathId(cur) !== pathId(source)) {
      const n = previous[pathId(cur)];
      if (!n) return null;
      path.unshift(n);
      cur = n;
    }
    return path;
  }

  function pathWeight(path) {
    const total = { burns: 0, turns: 0, hazards: 0, radHazards: 0 };
    if (!path) return total;
    for (let i = 1; i < path.length; i++) {
      const e = edgeWeights(path[i - 1], path[i]);
      total.burns      += e.burns;
      total.turns      += e.turns;
      total.hazards    += e.hazards;
      total.radHazards += e.radHazards;
    }
    return total;
  }

  return { findPath, drawPath, pathWeight, edgeWeights };
}

// Convenience wrapper: plan + drawPath + post-process into our
// renderer's segment format. Returns { segments, totalBurns,
// totalTurns } or null if unreachable.
//
// Segment shape: { from, to, turn, burns, dv } where:
//   - from/to are point ids
//   - turn is the 1-indexed turn number this segment fires on
//   - burns is the burns-spent on this transition
//   - dv mirrors burns (kept for compatibility with code that
//     reads .dv off a segment)
// 'wait' transitions are NOT emitted as segments (they don't
// physically move the rocket); they advance the turn counter.
export function planRoute(graph, fromId, toId, config = {}) {
  const planner = buildPlanner(graph, config);
  const data = planner.findPath(fromId);
  const path = planner.drawPath(data, fromId, toId);
  if (!path) return null;
  const segments = [];
  let turn = 1;
  for (let i = 1; i < path.length; i++) {
    const u = path[i - 1];
    const v = path[i];
    if (v.wait) { turn += 1; continue; }
    if (v.done) continue;
    if (v.node === u.node) continue;
    const burns = u.burnsRemaining > v.burnsRemaining
      ? u.burnsRemaining - v.burnsRemaining
      : 0;
    segments.push({
      from: u.node,
      to: v.node,
      turn,
      burns,
      dv: burns,
    });
  }
  const weight = planner.pathWeight(path);
  return {
    segments,
    totalBurns: weight.burns,
    totalTurns: weight.turns + 1,    // +1 for the implicit first turn
  };
}
