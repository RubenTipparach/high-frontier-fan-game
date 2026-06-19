// Support-chain resolver. PURE (no DOM, no stateful imports) so it drives BOTH
// the rocket engine (modifier + cooling rules) AND the chain visualizer, and is
// shared by the client (js/game/rocket.js) and the server (server/game/engine.js)
// - the single source of truth for the support-chain rules. Lives in data/ for
// the same reason data/fuel-graph.js does: both runtimes import it.
//
// Everything reads off plain card descriptors, so callers normalise their own
// stack into this shape (reading the INSTALLED face for each slot):
//
//   card = {
//     id,                       // stable id
//     type,                     // thruster | reactor | generator | radiator | ...
//     supplies:  [kind],        // support kinds this card PROVIDES
//     requires:  [{kind}|kind], // support kinds this card NEEDS
//     thrustMod, fuelMod,       // power-source modifier (additive / multiplicative)
//     therms,                   // heat GENERATED (reactor/gen/thruster) OR, for a
//                               //   radiator, the cooling it SUPPLIES
//   }
//
// resolveSupportChain({ cards, activeId, wiring }) walks the chain that powers
// the active thruster. Each consumer's requires are matched to a supplier - the
// player's wiring wins, otherwise the first matching card (deterministic). It
// returns the ordered chain, the edges, any cycles (each card is VISITED ONCE so
// a cycle never double-counts or breaks the walk), the modifier path (generators
// before the first reactor + the first reactor: rules 1+2 - only those modify
// the thruster), and the cooling verdict (rule 3 - each reactor reserves its OWN
// dedicated radiator therms; non-reactor heat draws the shared remainder).

export function resolveSupportChain({ cards = [], activeId = null, wiring = {} } = {}) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const reqKindsOf = (c) => (c.requires || [])
    .map((r) => (r && typeof r === 'object') ? r.kind : r)
    .filter(Boolean);
  // Requirements that share a supplier-prefix (the reactor-* kinds, or the two
  // gen-* kinds) form ONE OR-group: the consumer needs ANY ONE supplier of
  // those kinds, not all of them. This matches the activation gate
  // (isRocketActive), which has always grouped by prefix; the chain walk now
  // agrees. A generator that accepts "fusion OR antimatter" therefore pulls in
  // exactly ONE reactor (the player's wired pick, else the first match) and the
  // other reactor is a spare, not a second forced chain member. The group is
  // keyed by its FIRST kind (a real kind), so edges / wiring / display use a
  // concrete kind rather than a bare prefix.
  const reqGroupsByPrefix = (c) => {
    const groups = new Map();   // prefix -> [kinds]
    for (const k of reqKindsOf(c)) {
      const p = String(k).split('-')[0];
      if (!groups.has(p)) groups.set(p, []);
      if (!groups.get(p).includes(k)) groups.get(p).push(k);
    }
    return groups;
  };
  const suppliesAny = (c, kinds) => Array.isArray(c.supplies)
    && kinds.some((k) => c.supplies.includes(k));

  // Every OTHER card in the stack that could satisfy an OR-group.
  const candidatesFor = (consumerId, kinds) => cards
    .filter((c) => c.id !== consumerId && suppliesAny(c, kinds))
    .map((c) => c.id);

  // The chosen supplier for an OR-group: player wiring (keyed by the group key)
  // if it's still a valid candidate, otherwise the first match (stack order =
  // deterministic).
  const supplierFor = (consumerId, groupKey, kinds) => {
    const cands = candidatesFor(consumerId, kinds);
    const wired = wiring[consumerId] && wiring[consumerId][groupKey];
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
      for (const [, kinds] of reqGroupsByPrefix(c)) {
        const groupKey = kinds[0];
        const sup = supplierFor(consumerId, groupKey, kinds);
        if (sup) {
          edges.push({ from: consumerId, to: sup, kind: groupKey, kinds });
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
  // therms. Resolved through the shared `resolveCoolingAcross` pass (a single
  // chain is just the one-element case), so the dedicated-cooling math is
  // identical whether one chain or two parallel chains draw the pool.
  const cool = resolveCoolingAcross({ cards, orders: [order] });
  const pc = cool.perChain[0] || {
    reactorCooling: [], reactorsCooled: true, nonReactorHeat: 0,
    nonReactorCooled: true, coolingOk: true,
  };

  return {
    order,
    edges,
    cycles,
    firstReactorId,
    modifierChain,
    modifiers: { thrustDelta, fuelMult },
    reactorCooling: pc.reactorCooling,
    reactorsCooled: pc.reactorsCooled,
    nonReactorHeat: pc.nonReactorHeat,
    nonReactorCooled: pc.nonReactorCooled,
    coolingOk: pc.coolingOk,
    radiatorTotal: cool.radiatorTotal,
    radiatorRemaining: cool.radiatorRemaining,
  };
}

// Dedicated reactor cooling across one or more chains that share ONE stack-wide
// radiator pool. `orders` is a list of chain `order` arrays in PRIORITY order
// (the active thruster's chain first, then the active prospector's): the active
// thruster gets first claim on the radiators (user decision: prioritize
// thruster), and a lower-priority chain reserves its reactors' dedicated therms
// from whatever remains. A reactor shared by two chains is cooled ONCE - the
// higher-priority chain reserves it and the other reads it as already cooled
// (the "may share a reactor" case). Non-reactor heat (thruster + generators)
// draws the shared remainder. A chain whose reactor can't secure dedicated
// cooling reads `coolingOk: false`, which makes that active card inactive
// WITHOUT dragging down a higher-priority chain that was already cooled.
// Afterburn's Open-Cycle cooling rides in as a normal radiator card (1 Therm)
// that the caller appends to `cards` for the turn, so no special bonus-pool
// path is needed here: it counts toward radiatorTotal like any other radiator.
export function resolveCoolingAcross({ cards = [], orders = [] } = {}) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  // A radiator only COOLS if it can run: its own support requirements (e.g. an
  // active refrigerator's e-generator) must be suppliable somewhere in the
  // stack. An unpowered radiator contributes 0 therms, so the reactor it was
  // meant to cool stays hot and the active card reads inactive - matching the
  // chain visualizer's "needs a generator - no supplier" flag.
  const supplierExists = (kind) =>
    cards.some((c) => Array.isArray(c.supplies) && c.supplies.includes(kind));
  // A radiator runs iff EACH of its OR-groups (same prefix = one group, like
  // the chain walk) has at least one supplier in the stack.
  const radiatorPowered = (c) => {
    const groups = new Map();
    for (const r of (c.requires || [])) {
      const k = (r && typeof r === 'object') ? r.kind : r;
      if (!k) continue;
      const p = String(k).split('-')[0];
      if (!groups.has(p)) groups.set(p, []);
      groups.get(p).push(k);
    }
    return [...groups.values()].every((kinds) => kinds.some((k) => supplierExists(k)));
  };
  const radiatorTotal = cards
    .filter((c) => c.type === 'radiator' && radiatorPowered(c))
    .reduce((s, c) => s + (Number(c.therms) || 0), 0);
  let pool = radiatorTotal;
  const reserved = new Set(); // reactor ids a higher-priority chain already cooled

  const perChain = orders.map((order) => {
    const reactorIds = order.filter((id) => {
      const c = byId.get(id); return c && c.type === 'reactor';
    });
    // Generators self-cooled by a `coolsOwnSupports` radiator in this chain
    // (Magnetocaloric Refrigerator): a generator supplying a kind that radiator
    // requires is cooled by the radiator itself, so its heat does NOT draw the
    // shared pool. Matched by first-match supply in chain order, like the
    // resolver's default supplier choice.
    const selfCooled = new Set();
    for (const id of order) {
      const c = byId.get(id);
      if (!c || c.type !== 'radiator' || !c.coolsOwnSupports) continue;
      const reqKinds = (c.requires || [])
        .map((r) => (r && typeof r === 'object') ? r.kind : r).filter(Boolean);
      for (const kind of reqKinds) {
        for (const sid of order) {
          if (sid === id || selfCooled.has(sid)) continue;
          const s = byId.get(sid);
          if (s && s.type === 'generator' && Array.isArray(s.supplies) && s.supplies.includes(kind)) {
            selfCooled.add(sid);
            break;
          }
        }
      }
    }
    const reactorCooling = [];
    // Reactors a higher-priority chain already reserved: shared, already cooled.
    for (const id of reactorIds) {
      if (reserved.has(id)) {
        reactorCooling.push({ reactorId: id, demand: Number(byId.get(id).therms) || 0, ok: true, shared: true });
      }
    }
    // This chain's own reactors, hottest-first, reserve from the remaining pool.
    const own = reactorIds.filter((id) => !reserved.has(id))
      .sort((a, b) => (Number(byId.get(b).therms) || 0) - (Number(byId.get(a).therms) || 0));
    for (const id of own) {
      const demand = Number(byId.get(id).therms) || 0;
      const ok = pool >= demand;
      if (ok) { pool -= demand; reserved.add(id); }
      reactorCooling.push({ reactorId: id, demand, ok });
    }
    const reactorsCooled = reactorCooling.every((r) => r.ok);
    const reactorDemand = reactorIds.reduce((s, id) => s + (Number(byId.get(id).therms) || 0), 0);
    // Non-reactor heat = every heat-generating chain card that is NOT a reactor
    // (the thruster + generators). Radiators supply cooling, so they're excluded;
    // so is any generator a coolsOwnSupports radiator self-cools.
    const nonReactorHeat = order
      .map((id) => byId.get(id))
      .filter((c) => c && c.type !== 'reactor' && c.type !== 'radiator' && !selfCooled.has(c.id))
      .reduce((s, c) => s + (Number(c.therms) || 0), 0);
    const nonReactorCooled = nonReactorHeat <= pool;
    const coolingOk = reactorsCooled && nonReactorCooled;
    return { reactorCooling, reactorsCooled, reactorDemand, nonReactorHeat, nonReactorCooled, coolingOk };
  });

  return { perChain, radiatorTotal, radiatorRemaining: pool };
}
