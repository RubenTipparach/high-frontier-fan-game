// Stage-3 Industrialize Operation (rulebook I7).
//
// Decommissions a refinery + robonaut + their support chain from
// a parked stack and creates a factory chit at the site. The
// factory inherits the site's spectral type and is owned by the
// player.
//
// Variant rules locked in industrialize.md:
//   - One Op per turn. Industrialize consumes that op (caller
//     enforces via requireOp).
//   - Decommission destination: the player's HAND (variant rule,
//     user 2026-05-24). The refinery + robonaut + their support
//     chain you spent are re-collectable, not consumed - they
//     return to hand (server applyIndustrialize pushes to hand;
//     the solo path calls addToHand), so the modal says "to hand".
//   - Radiator & Cooling Exception (rulebook J4, Industrial Use
//     Only): the SITE provides all cooling for an industrialize
//     build, so radiators are NOT required. The thermostat
//     requirement is treated as satisfied by the site and no
//     radiator is pulled into the decommission chain.
//   - The support chain is PLAYER-WIRED. When a refinery / robonaut
//     / reactor / generator has more than one card that could power
//     a requirement, the modal shows a picker so the player chooses
//     which supplier joins the chain (and is decommissioned). The
//     pick re-resolves the decommission list live, mirroring the
//     rocket stack's support-chain wiring picker.
//   - If a chain card was ALSO supporting some other card Z in
//     the stack, Z stays in the stack but becomes inactive
//     ("orphaned"). The modal warns the player about each Z so
//     the loss isn't silent.
//   - VP is endgame-only (rulebook M2) - this module does not
//     award VP.
//
// Public surface:
//   findIndustrializeOptions(stack) -> Option[]
//   resolveOption(stack, refIndex, robIndex, wiring) -> Option
//   openIndustrializeModal(siteId, stack, options, onCommit)
//
// Option shape:
//   {
//     refinery: { id, card, index },
//     robonaut: { id, card, index },
//     chainIndices: number[],          // stack indices to remove (excludes radiators)
//     keptRadiators: { id, card, index }[],
//     orphans: { id, card, index, missing: string[] }[],
//     edges: { consumerIndex, consumerId, groupKey, kinds,
//              candidates: number[], supplierIndex }[],   // wiring picker source
//     wiring: { [consumerId]: { [groupKey]: supplierId } },
//     valid, allSatisfied, coolingOk: boolean,
//   }

import { PATENTS_BY_ID } from '../../data/patents.js';
import { CREW_BY_ID } from '../../data/crew.js';
import { REQUIREMENT_VIS } from './card-ui.js';
import { facePower } from '../../data/card-abilities.js';
import { faceIsDirtFuelled } from '../../data/hermes.js';

// ---------- Pure-logic helpers ----------

// The face a stack slot is INSTALLED on (Tier-2 secondary when flipped, else
// primary). Mirrors rocket.js#installedFace so a flipped (black-side) refinery /
// robonaut / support card contributes its REAL stats to the build - its
// black-side requires + supplies + heat, not the white-side ones. A refinery's
// or robonaut's TYPE never changes between faces, so the pair detection still
// keys off card.type; only the requires / supplies / heat are face-specific.
function slotFace(slot) {
  const c = slot && PATENTS_BY_ID[slot.id];
  if (!c || !c.faces) return c || {};
  const key = (slot.face === 'secondary' && c.faces.secondary) ? 'secondary' : 'primary';
  return c.faces[key] || c.faces.primary || c;
}

function requiresOf(slot) {
  const f = slotFace(slot);
  return Array.isArray(f.requires) ? f.requires : [];
}

// On-board reactor Bernal ability ("Your Crew has an On-Board Nuclear X /
// ANY reactor"): a Crew card supplies its granted reactor kind(s) too,
// wherever it's stationed - so a refinery/robonaut chain resolves its
// reactor requirement through the crew exactly like the rocket's own
// support chain does (mirrors rocket.js's collectSupplied /
// chainCardsFromStack). `crewReactorKinds` is the caller's
// myCrewReactorKinds() result (null when no such ability is active).
function suppliesOf(slot, crewReactorKinds) {
  const f = slotFace(slot);
  const supplies = Array.isArray(f.supplies) ? f.supplies : [];
  if (CREW_BY_ID[slot.id] && crewReactorKinds) return [...supplies, ...crewReactorKinds];
  return supplies;
}

// Requirement GROUPS the SITE provides for an industrialize build, so the
// stack needs no card of its own to satisfy them. Cooling (thermostat) is the
// J4 "Radiator & Cooling Exception, Industrial Use Only": the site cools the
// build, so a thermostat requirement is met and no radiator is pulled in.
const SITE_PROVIDES = new Set(['thermostat']);

// Cards barred from an industrialize build by their own text (Magnetoshell
// Plasma Parachute: "Cannot be used to support Bernals or during
// industrialization"). They are never counted as suppliers nor pulled into the
// chain, so the build the client sends never includes one - matching the
// server, which rejects such a build with card_no_industrialize.
function isNoIndustrialize(slot) {
  const pw = facePower(slotFace(slot).name);
  return !!(pw && pw.safeAerobrakeNoBernalOrIndustrialize);
}

// Group a requires array by supplier prefix (reactor-* / gen-* /
// etc.) so same-supplier kinds read as OR-alternatives. A card
// that requires X-pulse OR X-fusion is satisfied when any single
// supplier provides any of those kinds. Mirrors the OR rule used
// by rocket.js isRocketActive() so the engine behaves
// consistently.
function groupRequires(requires) {
  const groups = new Map();
  for (const r of requires) {
    const supplier = String(r.kind || '').split('-')[0];
    if (!groups.has(supplier)) groups.set(supplier, []);
    groups.get(supplier).push(r.kind);
  }
  return groups;
}

// Are all of `requires` satisfied by `supplied` (a Set of kinds)? Groups the
// SITE provides during industrialization (cooling) are skipped - the build
// needs no stack card to meet them.
function reqsSatisfied(requires, supplied, siteProvidesCooling = true) {
  const groups = groupRequires(requires);
  for (const [groupKey, kinds] of groups) {
    if (siteProvidesCooling && SITE_PROVIDES.has(groupKey)) continue;
    if (!kinds.some((k) => supplied.has(k))) return false;
  }
  return true;
}

// Build the set of supply-kinds the stack provides, optionally
// excluding a set of stack indices (used to ask "what would the
// supplies look like if we removed these cards?").
function suppliedSet(stack, excludeIndices, crewReactorKinds) {
  const excl = excludeIndices instanceof Set ? excludeIndices : new Set(excludeIndices || []);
  const out = new Set();
  for (let i = 0; i < stack.length; i++) {
    if (excl.has(i)) continue;
    const isCrew = !!CREW_BY_ID[stack[i].id];
    const c = PATENTS_BY_ID[stack[i].id];
    if (!c && !isCrew) continue;
    if (!isCrew && isNoIndustrialize(stack[i])) continue;   // can't be used in the build
    for (const k of suppliesOf(stack[i], crewReactorKinds)) out.add(k);
  }
  return out;
}

// Walk the support graph rooted at `rootIndices`. For each card in the
// chain we satisfy ONE supplier per requirement GROUP (the supplier-prefix
// OR-grouping, so "reactor-fission OR reactor-fusion" is one group) and add
// that supplier to the chain, recursing on its own requires. Each card is
// visited ONCE so a cyclic support set (real in the card data) terminates
// without double-counting.
//
// The chosen supplier is player-wired: `wiring` is a
// `{ [consumerId]: { [groupKey]: supplierId } }` map (groupKey = the
// supplier prefix); when it names a still-valid candidate that wins,
// otherwise we fall back to the first matching card in stack order
// (deterministic). Returns the chain index Set AND the per-group `edges`
// (with the full candidate list) so the modal can render a picker wherever
// more than one card could power a group.
function walkChain(stack, rootIndices, wiring, siteProvidesCooling = true, crewReactorKinds) {
  const wire = wiring || {};
  const chain = new Set(rootIndices);
  const edges = [];   // { consumerIndex, consumerId, groupKey, kinds, candidates:[idx], supplierIndex }
  const queue = [...rootIndices];
  const seen = new Set(rootIndices);
  while (queue.length) {
    const idx = queue.shift();
    const card = PATENTS_BY_ID[stack[idx].id];
    if (!card) continue;
    const consumerId = stack[idx].id;
    const groups = groupRequires(requiresOf(stack[idx]));
    for (const [groupKey, kinds] of groups) {
      // Cooling and other site-provided groups need no stack supplier during
      // industrialization (J4): skip them, so no radiator is pulled in. A build
      // with NO site cooling (Nanofacture, at a Bernal in space) does NOT skip
      // them, so the thermostat/cooling requirement pulls a radiator into the
      // chain and must be satisfied for the build to be valid.
      if (siteProvidesCooling && SITE_PROVIDES.has(groupKey)) continue;
      // Every stack card (other than the consumer) that supplies one of the
      // group's kinds is a candidate the player can wire this group to. Cards
      // barred from the build (Magnetoshell) are never candidates.
      const candidates = [];
      for (let i = 0; i < stack.length; i++) {
        if (i === idx) continue;
        const isCrew = !!CREW_BY_ID[stack[i].id];
        const c = PATENTS_BY_ID[stack[i].id];
        if (!c && !isCrew) continue;
        if (!isCrew && isNoIndustrialize(stack[i])) continue;
        if (kinds.some((k) => suppliesOf(stack[i], crewReactorKinds).includes(k))) candidates.push(i);
      }
      let supplierIndex = -1;
      if (candidates.length) {
        const wired = wire[consumerId] && wire[consumerId][groupKey];
        const wiredIdx = (wired != null)
          ? candidates.find((i) => stack[i].id === wired)
          : undefined;
        supplierIndex = (wiredIdx !== undefined) ? wiredIdx : candidates[0];
        chain.add(supplierIndex);
        if (!seen.has(supplierIndex)) { seen.add(supplierIndex); queue.push(supplierIndex); }
      }
      edges.push({ consumerIndex: idx, consumerId, groupKey, kinds, candidates, supplierIndex });
    }
  }
  return { chain, edges };
}

// Given the chain we're about to decommission, find all cards
// outside the chain whose requires WOULD become unsatisfied
// once the chain is gone. Each entry returned is a card that
// stays in the stack but becomes inactive after the build.
function findOrphans(stack, chainIndices, crewReactorKinds) {
  const chain = chainIndices instanceof Set ? chainIndices : new Set(chainIndices);
  const afterSupplies = suppliedSet(stack, chain, crewReactorKinds);
  const orphans = [];
  for (let i = 0; i < stack.length; i++) {
    if (chain.has(i)) continue;
    const card = PATENTS_BY_ID[stack[i].id];
    if (!card) continue;
    const reqs = requiresOf(stack[i]);
    if (!reqs.length) continue;
    if (reqsSatisfied(reqs, afterSupplies)) continue;
    // Build a human-readable list of missing groups.
    const groups = groupRequires(reqs);
    const missing = [];
    for (const [supplier, kinds] of groups) {
      if (!kinds.some((k) => afterSupplies.has(k))) {
        missing.push(`${supplier} (${kinds.join(' / ')})`);
      }
    }
    orphans.push({
      id: stack[i].id,
      card,
      index: i,
      missing,
    });
  }
  return orphans;
}

// Resolve a single (refinery, robonaut) pair into a full Option under the
// given `wiring`. Walks the support chain, splits radiators off into
// keptRadiators (a radiator that lands in the chain is kept, not
// decommissioned), computes orphans against the actually-removed set, and
// reports validity (every requirement group has a supplier; cooling is
// provided by the site, J4). The same function backs both the initial option
// list and every live re-resolve the modal's wiring pickers trigger.
export function resolveOption(stack, refIndex, robIndex, wiring, siteProvidesCooling = true, crewReactorKinds) {
  const { chain, edges } = walkChain(stack, [refIndex, robIndex], wiring || {}, siteProvidesCooling, crewReactorKinds);
  // Every requirement group must have found a supplier. A group with no
  // candidate (supplierIndex -1) leaves the build unsupported. With no site
  // cooling (Nanofacture) the thermostat group is walked too, so a missing
  // radiator shows up here as an unsatisfied group.
  const allSatisfied = edges.every((e) => e.supplierIndex !== -1);
  const coolingOk = true;   // validity rides on allSatisfied, which now includes cooling when the site doesn't provide it
  // Radiator handling. On a normal industrialize (site cools, J4) a radiator in
  // the chain is KEPT, not decommissioned. On a Nanofacture (no site cooling)
  // the radiators ARE the cooling and are decommissioned with the rest of the
  // build set, so they are NOT kept.
  const removeIndices = [];
  const kept = [];
  for (const idx of chain) {
    const c = PATENTS_BY_ID[stack[idx].id];
    if (!c) continue;
    if (siteProvidesCooling && c.type === 'radiator') kept.push({ id: stack[idx].id, card: c, index: idx });
    else removeIndices.push(idx);
  }
  // Orphans are computed against the actually-removed set, not the full
  // chain (kept radiators are still supplying).
  const orphans = findOrphans(stack, removeIndices, crewReactorKinds);
  return {
    refinery: { id: stack[refIndex].id, card: PATENTS_BY_ID[stack[refIndex].id], index: refIndex },
    robonaut: { id: stack[robIndex].id, card: PATENTS_BY_ID[stack[robIndex].id], index: robIndex },
    chainIndices: removeIndices.sort((a, b) => a - b),
    keptRadiators: kept,
    orphans,
    edges,
    wiring: { ...(wiring || {}) },
    valid: allSatisfied && coolingOk,
    allSatisfied,
    coolingOk,
  };
}

// Find every valid (refinery, robonaut) pair in the stack and
// build an Option for each (under default, first-match wiring). An Option
// is valid when:
//   - The refinery's requires are satisfied by the rest of the
//     stack (not counting the chain we're about to walk - we just
//     check against the full stack supplies here, since the chain
//     INCLUDES the suppliers).
//   - Same for the robonaut.
// Cooling is provided by the site (J4), so radiators are never required and a
// radiator that does land in the chain is split into `keptRadiators` and
// excluded from `chainIndices` (the indices that actually get removed). The
// modal can re-resolve any option under player wiring via resolveOption().
// Index of an OPERATIONAL dirt rocket in the stack: a card whose INSTALLED face
// is dirt-fuelled and carries thrust. Mirrors the engine's buildSetHasDirtRocket,
// which reads the same two things off the faces of the ids the client sends.
function findDirtRocketIndex(stack) {
  for (let i = 0; i < stack.length; i++) {
    const slot = stack[i];
    if (!slot || slot.kind === 'crew') continue;
    const c = PATENTS_BY_ID[slot.id];
    if (!c) continue;
    const f = (c.faces && c.faces[slot.face === 'secondary' ? 'secondary' : 'primary']) || c;
    if (faceIsDirtFuelled(f) && f && f.thrust != null) return i;
  }
  return -1;
}
// `requireDirtRocket` is V5 Hermes Fall: a factory on the asteroid drives its
// thrusters off the local regolith, so the build must ALSO decommission an
// operational dirt rocket. The chain walk only ever pulls in the refinery, the
// robonaut and what supplies them, so the thruster was never in the set and the
// server refused every Hermes industrialize with hermes_needs_dirt_rocket (user
// 2026-08-03). Folded in here so the modal shows the true cost of the build and
// the op carries the card the engine is looking for.
export function findIndustrializeOptions(stack, siteProvidesCooling = true, crewReactorKinds = null, { requireDirtRocket = false } = {}) {
  if (!Array.isArray(stack) || !stack.length) return [];
  const dirtIdx = requireDirtRocket ? findDirtRocketIndex(stack) : -1;
  // No dirt rocket aboard means no legal build here at all - better an empty
  // option list (the modal says why) than one the server will refuse.
  if (requireDirtRocket && dirtIdx < 0) return [];
  const refineries = [];
  const robonauts  = [];
  for (let i = 0; i < stack.length; i++) {
    // Crew can PROSPECT (act as a robonaut) but can NOT build a
    // factory: industrialize needs a real refinery + robonaut
    // patent. Crew isn't in PATENTS_BY_ID, so it's already
    // excluded; the explicit skip documents the rule. Crew's
    // role at a factory is Colonize (a separate free action).
    if (stack[i].kind === 'crew') continue;
    const c = PATENTS_BY_ID[stack[i].id];
    if (!c) continue;
    if (c.type === 'refinery') refineries.push(i);
    if (c.type === 'robonaut') robonauts.push(i);
  }
  if (!refineries.length || !robonauts.length) return [];

  const stackSupplies = suppliedSet(stack, [], crewReactorKinds);
  const options = [];
  for (const ri of refineries) {
    if (!reqsSatisfied(requiresOf(stack[ri]), stackSupplies, siteProvidesCooling)) continue;
    for (const bi of robonauts) {
      if (!reqsSatisfied(requiresOf(stack[bi]), stackSupplies, siteProvidesCooling)) continue;
      const opt = resolveOption(stack, ri, bi, {}, siteProvidesCooling, crewReactorKinds);
      if (dirtIdx >= 0 && !opt.chainIndices.includes(dirtIdx)) {
        opt.chainIndices = [...opt.chainIndices, dirtIdx].sort((a, b) => a - b);
        opt.dirtRocket = { id: stack[dirtIdx].id, card: PATENTS_BY_ID[stack[dirtIdx].id], index: dirtIdx };
      }
      options.push(opt);
    }
  }
  // Stable sort: shortest decommission list first, then lowest
  // total mass. Lets the modal's default pick read as "least
  // destructive."
  options.sort((a, b) => {
    const d = a.chainIndices.length - b.chainIndices.length;
    if (d !== 0) return d;
    const massA = a.chainIndices.reduce((s, i) => s + (PATENTS_BY_ID[stack[i].id]?.mass || 0), 0);
    const massB = b.chainIndices.reduce((s, i) => s + (PATENTS_BY_ID[stack[i].id]?.mass || 0), 0);
    return massA - massB;
  });
  return options;
}

// ---------- Modal UI ----------

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Friendly name for a requirement GROUP (the supplier-prefix OR-grouping).
const GROUP_LABEL = {
  reactor: 'Reactor', gen: 'Generator', pulse: 'Pulse generator',
  thermostat: 'Radiator therms', crew: 'Crew quarters', sail: 'Sail',
  spin: 'Spin gravity', beam: 'Beam receiver', push: 'Push-sat',
  isru: 'ISRU rig', aerobrake: 'Aerobrake',
};
function groupLabel(groupKey, kinds) {
  return GROUP_LABEL[groupKey] || (REQUIREMENT_VIS[kinds[0]] || {}).label || groupKey;
}
function groupGlyph(kinds) {
  return (REQUIREMENT_VIS[kinds[0]] || {}).glyph || '◇';
}

// Build a nested support-chain tree rooted at the refinery + robonaut so the
// player SEES the WHOLE walk, not just the immediate suppliers: each card pulls
// in the supplier that powers it, that supplier pulls in its own, down to the
// radiators. This is the "why" behind the decommission list - every node here
// leaves the stack (to hand) EXCEPT kept radiators (◐), which stay to cool the
// build. A card reached a second time (a shared supplier, or a support cycle,
// which is real in the card data) renders once and then as a muted reference
// leaf, mirroring the visit-once walk in walkChain so the tree always
// terminates. An unmet requirement group shows as an amber "no supplier" edge.
function buildChainTree(stack, opt) {
  const edges = opt.edges || [];
  const keptSet = new Set((opt.keptRadiators || []).map((r) => r.index));
  const byConsumer = new Map();
  for (const e of edges) {
    if (!byConsumer.has(e.consumerIndex)) byConsumer.set(e.consumerIndex, []);
    byConsumer.get(e.consumerIndex).push(e);
  }
  const expanded = new Set();
  const nodeLabel = (idx, roleLabel) => {
    // A crew supplier (the on-board reactor ability) isn't in PATENTS_BY_ID;
    // fall back to CREW_BY_ID so it renders with a real name/type instead of
    // the raw card id and a blank type.
    const card = PATENTS_BY_ID[stack[idx].id] || CREW_BY_ID[stack[idx].id];
    const kept = keptSet.has(idx);
    const icon = kept
      ? '<span class="decom-icon decom-kept">◐</span>'
      : '<span class="decom-icon">✕</span>';
    const typeLabel = kept ? `${card?.type || 'radiator'}, KEPT` : (card?.type || (CREW_BY_ID[stack[idx].id] ? 'crew' : ''));
    const role = roleLabel
      ? ` <span class="chain-role">${escapeHtml(roleLabel)}</span>` : '';
    const name = card?.name
      || (CREW_BY_ID[stack[idx].id] && CREW_BY_ID[stack[idx].id].faces?.primary?.name)
      || stack[idx].id;
    return `${icon} <strong>${escapeHtml(name)}</strong>`
      + ` <span class="decom-type">(${escapeHtml(typeLabel)})</span>${role}`;
  };
  const renderNode = (idx, edgeHtml, roleLabel) => {
    const edgeBlock = edgeHtml ? `<div class="chain-edge">${edgeHtml}</div>` : '';
    if (expanded.has(idx)) {
      return `<li class="chain-li">${edgeBlock}`
        + `<div class="chain-node chain-ref">${nodeLabel(idx, 'shown above')}</div></li>`;
    }
    expanded.add(idx);
    const childLis = (byConsumer.get(idx) || []).map((e) => {
      const glyph = `<em class="chain-picker-ic">${escapeHtml(groupGlyph(e.kinds))}</em>`;
      const label = escapeHtml(groupLabel(e.groupKey, e.kinds));
      if (e.supplierIndex === -1) {
        return `<li class="chain-li"><div class="chain-edge chain-edge-missing">`
          + `⚠ needs ${glyph} ${label} - no supplier in the stack</div></li>`;
      }
      return renderNode(e.supplierIndex, `needs ${glyph} ${label}`, null);
    }).join('');
    const childUl = childLis ? `<ul class="chain-children">${childLis}</ul>` : '';
    return `<li class="chain-li">${edgeBlock}`
      + `<div class="chain-node${roleLabel ? ' chain-node-root' : ''}">${nodeLabel(idx, roleLabel)}</div>`
      + `${childUl}</li>`;
  };
  const roots = renderNode(opt.refinery.index, '', 'refinery')
    + renderNode(opt.robonaut.index, '', 'robonaut');
  return `<ul class="industrialize-chain-tree">${roots}</ul>`;
}

// Render the modal for the given site + stack + options. `onCommit`
// is called with the resolved Option (under the player's current wiring)
// when the player confirms. `siteName` is just for the title. Closes itself
// on confirm/cancel and is dismissible via Escape / overlay click.
export function openIndustrializeModal({ siteName, spectralType, stack, options, onCommit, verb = 'Industrialize', coolingNote = 'the site provides cooling, so no radiator is needed', siteProvidesCooling = true, crewReactorKinds = null }) {
  document.querySelector('.industrialize-overlay')?.remove();

  // Selected pair index. Defaults to 0 (least-destructive after sort).
  let selected = 0;
  // Per-pair wiring map ({ consumerId: { groupKey: supplierId } }), seeded
  // from each option's default (first-match) wiring. A support picker writes
  // into the selected pair's map and re-resolves the chain live.
  const wirings = options.map((o) => ({ ...(o.wiring || {}) }));
  // The option resolved under the current pair + wiring; recomputed every
  // render and handed to onCommit so the decommission list the player saw is
  // exactly what gets built.
  let currentOpt = options[0];

  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay industrialize-overlay';
  overlay.tabIndex = -1;

  const close = (committed) => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (committed) onCommit?.(currentOpt);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(false); }
  };
  document.addEventListener('keydown', onKey);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close(false);
  });

  const dialog = document.createElement('div');
  dialog.className = 'industrialize-modal';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', `${verb} ${siteName}`);
  overlay.appendChild(dialog);

  const render = () => {
    const base = options[selected];
    // Re-resolve the selected pair under its current wiring. This is the
    // single source the rest of the modal (and onCommit) reads from.
    const opt = resolveOption(stack, base.refinery.index, base.robonaut.index, wirings[selected], siteProvidesCooling, crewReactorKinds);
    currentOpt = opt;

    const pickerHtml = options.length > 1
      ? `<div class="industrialize-pairs">
           <div class="industrialize-section-label">Multiple refinery + robonaut pairs - pick one:</div>
           ${options.map((o, i) => {
             const chk = i === selected ? '⦿' : '◯';
             const label = `${escapeHtml(o.refinery.card.name)} + ${escapeHtml(o.robonaut.card.name)} (${o.chainIndices.length} cards)`;
             return `<button type="button" data-pair="${i}" class="industrialize-pair ${i === selected ? 'is-selected' : ''}"><span class="pair-radio">${chk}</span> ${label}</button>`;
           }).join('')}
         </div>`
      : '';

    // Support wiring: one picker per requirement group that more than one
    // card in the stack could power. Single-candidate groups are forced
    // (nothing to choose) and just ride the decommission list below.
    const wireRows = opt.edges.filter((e) => e.candidates.length > 1).map((e) => {
      const consumer = PATENTS_BY_ID[e.consumerId];
      const opts = e.candidates.map((idx) => {
        const c = PATENTS_BY_ID[stack[idx].id];
        const sel = idx === e.supplierIndex ? ' selected' : '';
        return `<option value="${escapeHtml(stack[idx].id)}"${sel}>${escapeHtml(c?.name || stack[idx].id)}</option>`;
      }).join('');
      return `<div class="industrialize-wire-row">
        <span class="wire-consumer">${escapeHtml(consumer?.name || e.consumerId)}</span>
        <span class="wire-needs"><em class="chain-picker-ic">${escapeHtml(groupGlyph(e.kinds))}</em> ${escapeHtml(groupLabel(e.groupKey, e.kinds))}</span>
        <select class="industrialize-wire-select" data-consumer="${escapeHtml(e.consumerId)}" data-group="${escapeHtml(e.groupKey)}">${opts}</select>
      </div>`;
    }).join('');
    const wiringHtml = wireRows
      ? `<div class="industrialize-section-label">Support wiring - pick which card powers each support</div>
         <div class="industrialize-wiring">${wireRows}</div>`
      : '';

    // Full support-chain tree (rooted at the refinery + robonaut) so the player
    // can trace why every card is pulled in, not just the immediate supplier.
    const chainTreeHtml = buildChainTree(stack, opt);
    const decomCount = opt.chainIndices.length;
    // The "these cards lose support" side-effect warning was misleading at
    // industrialize time (it flagged cards as going inactive that aren't
    // actually affected by decommissioning the refinery+robonaut chain), so
    // it's suppressed. (opt.orphans stays computed for any other reader.)
    const orphansHtml = '';
    // Validity banner: a wiring choice that leaves a (non-cooling) support
    // unmet blocks the build. Cooling is provided by the site (J4), so it's
    // never the blocker here.
    const invalidHtml = opt.valid
      ? ''
      : `<div class="industrialize-warn industrialize-invalid">
           ⚠ A support is unpowered with this wiring. Pick a supplier for every requirement.
         </div>`;

    dialog.innerHTML = `
      <div class="industrialize-head">
        <h3>🏭 ${escapeHtml(verb)} at ${escapeHtml(siteName)}</h3>
      </div>
      <div class="industrialize-body">
        <div class="industrialize-spectral">
          Factory will inherit spectral type
          <strong class="industrialize-spectral-badge spectral-${escapeHtml(spectralType || 'C')}">${escapeHtml(spectralType || 'C')}</strong>.
        </div>
        ${pickerHtml}
        ${wiringHtml}
        <div class="industrialize-section-label">Support chain - the ${decomCount} card${decomCount === 1 ? '' : 's'} below go back to your hand (${escapeHtml(coolingNote)}):</div>
        ${chainTreeHtml}
        ${orphansHtml}
        ${invalidHtml}
      </div>
      <div class="card-modal-actions">
        <button type="button" class="modal-btn industrialize-cancel">Cancel</button>
        <button type="button" class="modal-btn primary industrialize-commit"${opt.valid ? '' : ' disabled'}>🏭 ${escapeHtml(verb)}</button>
      </div>
    `;

    if (options.length > 1) {
      dialog.querySelectorAll('.industrialize-pair').forEach((btn) => {
        btn.addEventListener('click', () => {
          selected = parseInt(btn.getAttribute('data-pair'), 10) || 0;
          render();
        });
      });
    }
    dialog.querySelectorAll('.industrialize-wire-select').forEach((sel) => {
      sel.addEventListener('change', () => {
        const consumerId = sel.getAttribute('data-consumer');
        const groupKey = sel.getAttribute('data-group');
        const w = wirings[selected];
        w[consumerId] = { ...(w[consumerId] || {}), [groupKey]: sel.value };
        render();
      });
    });
    dialog.querySelector('.industrialize-cancel').addEventListener('click', () => close(false));
    const commitBtn = dialog.querySelector('.industrialize-commit');
    commitBtn.addEventListener('click', () => { if (!commitBtn.disabled) close(true); });
  };

  render();
  document.body.appendChild(overlay);
  overlay.focus();
}
