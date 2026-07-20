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

  // Rules 1 + 2 + J5.d: the modifier path is the power sources DIRECTLY feeding
  // the active thrust triangle. Walk OUT from the thruster following ONLY
  // power-source suppliers - every generator on that path modifies (rule 2) and
  // the FIRST reactor reached modifies and terminates the path (rule 1) - and
  // NEVER descend into a radiator, past a reactor into its own supports, or into
  // a Freighter / GW (or TW) thruster branch. A support that is needed only to
  // power one of those is off the thrust triangle's chain, so its
  // movement-modifier is ignored (J5.d exception d: "Ignore all
  // movement-modifiers for supports needed only for radiators, reactors,
  // Freighters, or GW thrusters"). Preorder + first-reactor-terminates matches
  // the old flat scan for the common linear stack (THRUSTER -> generator* ->
  // reactor), so single-reactor stacks read identically; the only change is that
  // a generator reached only via a radiator / reactor-support / freighter / GW
  // branch no longer counts.
  const childrenOf = new Map();
  for (const e of edges) {
    if (!childrenOf.has(e.from)) childrenOf.set(e.from, []);
    childrenOf.get(e.from).push(e.to);
  }
  let firstReactorId = null;
  const modifierChain = [];
  const modVisited = new Set();
  (function powerWalk(consumerId) {
    if (firstReactorId != null) return;         // first reactor terminates the path
    for (const supId of (childrenOf.get(consumerId) || [])) {
      if (firstReactorId != null) break;
      if (modVisited.has(supId)) continue;
      const c = byId.get(supId);
      if (!c) continue;
      if (c.type === 'generator') {
        modVisited.add(supId);
        modifierChain.push(supId);
        powerWalk(supId);                        // descend the generator's power chain
      } else if (c.type === 'reactor') {
        firstReactorId = supId;
        modifierChain.push(supId);
        break;                                   // do NOT descend past the reactor
      }
      // radiator / freighter / GW-TW thruster / anything else: off the power
      // path - skip it AND its subtree (its modifiers are ignored, J5.d).
    }
  })(activeId);
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
// Afterburn's Open-Cycle cooling rides in as a radiator card (1 Therm) the
// caller appends for the turn, but it is flagged `thrusterChainOnly`: its vent
// cools ONLY the active thruster's chain, never a prospector chain by itself
// (some prospectors ARE thrusters - a dual-role card is one chain and keeps it).
// So its therms are reserved for the chain at `thrusterOrderIndex`; every other
// radiator counts toward the shared pool all chains draw. `thrusterOrderIndex`
// is which `orders` entry is the active thruster's chain (default 0, the
// convention that the thruster chain is listed first).
export function resolveCoolingAcross({ cards = [], orders = [], thrusterOrderIndex = 0 } = {}) {
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
  const poweredRadiators = cards.filter((c) => c.type === 'radiator' && radiatorPowered(c));
  // The shared pool every chain may draw, plus the thruster-chain-only therms
  // (Afterburn's Open-Cycle vent) that ONLY the thruster's chain gets.
  const sharedRadiatorTotal = poweredRadiators
    .filter((c) => !c.thrusterChainOnly)
    .reduce((s, c) => s + (Number(c.therms) || 0), 0);
  const thrusterOnlyTherms = poweredRadiators
    .filter((c) => c.thrusterChainOnly)
    .reduce((s, c) => s + (Number(c.therms) || 0), 0);
  const radiatorTotal = sharedRadiatorTotal + thrusterOnlyTherms;

  const perChain = orders.map((order, chainIdx) => {
    // Each active chain shares the FULL radiator pool (rule 5: the thruster and
    // prospector chains run in parallel and MAY SHARE radiators freely - one
    // radiator can cool a reactor in the thruster chain AND the prospector's
    // heat with no contention). So cooling resolves PER CHAIN against the whole
    // pool; the chains never deplete each other. Dedicated reactor cooling
    // (rule 3) still holds WITHIN a chain - two reactors in the same chain can't
    // share the same therms. Afterburn's thruster-chain-only therms are added
    // only to the active thruster's chain (a prospector chain can't vent them).
    let pool = sharedRadiatorTotal + (chainIdx === thrusterOrderIndex ? thrusterOnlyTherms : 0);
    const reserved = new Set();
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
    // This chain's reactors, hottest-first, reserve dedicated therms from the
    // (full) pool; within the chain no two reactors can share the same therms.
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
    return { reactorCooling, reactorsCooled, reactorDemand, nonReactorHeat, nonReactorCooled, coolingOk, remaining: pool };
  });

  return {
    perChain,
    radiatorTotal,
    radiatorRemaining: perChain.length ? perChain[0].remaining : radiatorTotal,
  };
}
