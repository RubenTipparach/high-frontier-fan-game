// Support-chain resolver. PURE (no DOM, no stateful imports) so it drives BOTH
// the rocket engine (modifier + cooling rules) AND the chain visualizer, and
// can later be shared with the server. Everything reads off plain card
// descriptors, so callers normalise their own stack into this shape:
//
//   card = {
//     id,                       // stable id
//     type,                     // thruster | reactor | generator | radiator | ...
//     supplies:  [kind],        // support kinds this card PROVIDES
//     requires:  [{kind}|kind], // support kinds this card NEEDS
//     thrustMod, fuelMod,       // power-source modifier (additive / multiplicative)
//     therms,                   // heat GENERATED (reactor/gen) or cooling SUPPLIED (radiator)
//   }
//
// resolveSupportChain({ cards, activeId, wiring }) walks the chain that powers
// the active thruster. Each consumer's requires are matched to a supplier -
// the player's wiring wins, otherwise the first matching card (deterministic).
// It returns the ordered chain, the edges, any cycles (each card is VISITED
// ONCE so a cycle never double-counts or breaks the walk), the modifier path
// (generators before the first reactor + the first reactor: rules 1+2 - only
// those modify the thruster), and the per-reactor DEDICATED cooling check
// (rule 3 - a radiator's therms reserved to one reactor can't cover another).

export function resolveSupportChain({ cards = [], activeId = null, wiring = {} } = {}) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const reqKindsOf = (c) => (c.requires || [])
    .map((r) => (r && typeof r === 'object') ? r.kind : r)
    .filter(Boolean);
  const supplies = (c, kind) => Array.isArray(c.supplies) && c.supplies.includes(kind);

  // Every OTHER card in the stack that could satisfy (consumer, kind).
  const candidatesFor = (consumerId, kind) => cards
    .filter((c) => c.id !== consumerId && supplies(c, kind))
    .map((c) => c.id);

  // The chosen supplier for (consumer, kind): player wiring if it's still a
  // valid candidate, otherwise the first match (stack order = deterministic).
  const supplierFor = (consumerId, kind) => {
    const cands = candidatesFor(consumerId, kind);
    const wired = wiring[consumerId] && wiring[consumerId][kind];
    if (wired && cands.includes(wired)) return wired;
    return cands.length ? cands[0] : null;
  };

  const edges = [];      // { from: consumerId, to: supplierId, kind }
  const order = [];      // chain order, thruster first, each id once
  const cycles = [];     // [[id, ..., id]] rings (first id repeated at the end)
  const visited = new Set();
  const stack = [];      // current DFS path, for back-edge (cycle) detection
  const onStack = new Set();

  function walk(consumerId) {
    if (onStack.has(consumerId)) {
      const i = stack.indexOf(consumerId);
      if (i >= 0) cycles.push(stack.slice(i).concat(consumerId));
      return;                       // visited-once: don't recurse into the cycle
    }
    if (visited.has(consumerId)) return;
    visited.add(consumerId);
    order.push(consumerId);
    stack.push(consumerId); onStack.add(consumerId);
    const c = byId.get(consumerId);
    if (c) {
      for (const kind of reqKindsOf(c)) {
        const sup = supplierFor(consumerId, kind);
        if (sup) {
          edges.push({ from: consumerId, to: sup, kind });
          walk(sup);
        }
      }
    }
    stack.pop(); onStack.delete(consumerId);
  }
  if (activeId && byId.has(activeId)) walk(activeId);

  // Rules 1 + 2: the modifier path is the power sources feeding the thruster,
  // in chain order - every generator UNTIL the first reactor, plus that first
  // reactor; later reactors/generators stay in the chain but do NOT modify.
  let firstReactorId = null;
  const modifierChain = [];
  for (const id of order) {
    if (id === activeId) continue;
    const c = byId.get(id);
    if (!c) continue;
    if (c.type === 'reactor') {
      if (firstReactorId == null) { firstReactorId = id; modifierChain.push(id); }
      // any reactor after the first contributes support but not a modifier
    } else if (c.type === 'generator') {
      if (firstReactorId == null) modifierChain.push(id);
    }
  }
  let thrustDelta = 0;
  let fuelMult = 1;
  for (const id of modifierChain) {
    const c = byId.get(id);
    if (c && c.thrustMod != null) thrustDelta += Number(c.thrustMod) || 0;
    if (c && c.fuelMod != null && c.fuelMod !== 1) fuelMult *= Number(c.fuelMod);
  }

  // Rule 3: each reactor in the chain needs DEDICATED radiator cooling for its
  // therms - a radiator's therms reserved to one reactor can't cover another.
  // Greedy: walk reactors in chain order, reserve from the shared radiator
  // therm supply. (Reactors only; generator/thruster therms aren't modelled
  // here.) Reactors are assumed pre-sorted to reserve for the hottest first so
  // a tight budget fails predictably.
  const radiators = cards.filter((c) => c.type === 'radiator');
  let radiatorPool = radiators.reduce((s, c) => s + (Number(c.therms) || 0), 0);
  const reactorIds = order.filter((id) => { const c = byId.get(id); return c && c.type === 'reactor'; });
  reactorIds.sort((a, b) => (Number(byId.get(b).therms) || 0) - (Number(byId.get(a).therms) || 0));
  const reactorCooling = [];
  for (const id of reactorIds) {
    const demand = Number(byId.get(id).therms) || 0;
    const ok = radiatorPool >= demand;
    if (ok) radiatorPool -= demand;
    reactorCooling.push({ reactorId: id, demand, ok });
  }
  const reactorsCooled = reactorCooling.every((r) => r.ok);

  return {
    order,
    edges,
    cycles,
    firstReactorId,
    modifierChain,
    modifiers: { thrustDelta, fuelMult },
    reactorCooling,
    reactorsCooled,
    radiatorTotal: radiators.reduce((s, c) => s + (Number(c.therms) || 0), 0),
    radiatorRemaining: radiatorPool,
  };
}
