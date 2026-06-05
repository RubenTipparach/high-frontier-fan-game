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
//   - Decommission destination: bottom of patent deck (rulebook
//     G6). In this sandbox there is no ordered deck, so this
//     reduces to "card returns to the library pool" - i.e. we
//     just remove from the stack and don't route to hand. The
//     player can re-draw later if they want.
//   - Radiators in the chain are KEPT (flipped semantics in HF4;
//     in our sandbox we simply skip them when decommissioning).
//   - If a chain card was ALSO supporting some other card Z in
//     the stack, Z stays in the stack but becomes inactive
//     ("orphaned"). The modal warns the player about each Z so
//     the loss isn't silent.
//   - VP is endgame-only (rulebook M2) - this module does not
//     award VP.
//
// Public surface:
//   findIndustrializeOptions(stack) -> Option[]
//   openIndustrializeModal(siteId, stack, options, onCommit)
//
// Option shape:
//   {
//     refinery: { id, card, index },
//     robonaut: { id, card, index },
//     chainIndices: number[],          // stack indices to remove (excludes radiators)
//     keptRadiators: { id, card, index }[],
//     orphans: { id, card, index, missing: string[] }[],
//   }

import { PATENTS_BY_ID, thermsRequired, thermsSupplied } from '../../data/patents.js';

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

function suppliesOf(slot) {
  const f = slotFace(slot);
  return Array.isArray(f.supplies) ? f.supplies : [];
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

// Are all of `requires` satisfied by `supplied` (a Set of kinds)?
function reqsSatisfied(requires, supplied) {
  const groups = groupRequires(requires);
  for (const [, kinds] of groups) {
    if (!kinds.some((k) => supplied.has(k))) return false;
  }
  return true;
}

// Build the set of supply-kinds the stack provides, optionally
// excluding a set of stack indices (used to ask "what would the
// supplies look like if we removed these cards?").
function suppliedSet(stack, excludeIndices) {
  const excl = excludeIndices instanceof Set ? excludeIndices : new Set(excludeIndices || []);
  const out = new Set();
  for (let i = 0; i < stack.length; i++) {
    if (excl.has(i)) continue;
    const c = PATENTS_BY_ID[stack[i].id];
    if (!c) continue;
    for (const k of suppliesOf(stack[i])) out.add(k);
  }
  return out;
}

// Walk the support graph rooted at `rootIndices`. Returns the
// set of indices in the chain (including the roots). For each
// card in the chain, we pick ONE supplier per requirement group;
// that supplier is added to the chain (and we recurse on its
// own requires). Deterministic: scan stack in index order and
// take the first matching supplier. This matches what a player
// would intuitively pick if they tapped "decommission the
// shortest chain".
function walkChain(stack, rootIndices) {
  const chain = new Set(rootIndices);
  const queue = [...rootIndices];
  while (queue.length) {
    const idx = queue.shift();
    const card = PATENTS_BY_ID[stack[idx].id];
    if (!card) continue;
    const reqs = requiresOf(stack[idx]);
    const groups = groupRequires(reqs);
    for (const [, kinds] of groups) {
      // For this requirement group, find the first stack card
      // (not already in the chain) that supplies one of the kinds.
      let picked = -1;
      for (let i = 0; i < stack.length; i++) {
        if (chain.has(i)) continue;
        const c = PATENTS_BY_ID[stack[i].id];
        if (!c) continue;
        const supplies = suppliesOf(stack[i]);
        if (kinds.some((k) => supplies.includes(k))) {
          picked = i;
          break;
        }
      }
      if (picked !== -1) {
        chain.add(picked);
        queue.push(picked);
      }
    }
  }
  return chain;
}

// Given the chain we're about to decommission, find all cards
// outside the chain whose requires WOULD become unsatisfied
// once the chain is gone. Each entry returned is a card that
// stays in the stack but becomes inactive after the build.
function findOrphans(stack, chainIndices) {
  const chain = chainIndices instanceof Set ? chainIndices : new Set(chainIndices);
  const afterSupplies = suppliedSet(stack, chain);
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

// Thermal balance for an industrialize chain: the heat generated by the
// chain's cards (refinery / robonaut / the reactors + generators walked
// in to power them) must be dissipated by the stack's radiators. Same
// hard rule the rocket's thruster chain uses. Radiators contribute 0 to
// demand (they cool, never heat) and supply their cooling capacity.
function chainThermBalanced(stack, chain) {
  let demand = 0;
  for (const idx of chain) {
    const c = PATENTS_BY_ID[stack[idx].id];
    if (c) demand += thermsRequired(slotFace(stack[idx]));
  }
  if (demand <= 0) return true;
  let supply = 0;
  for (let i = 0; i < stack.length; i++) {
    const c = PATENTS_BY_ID[stack[i].id];
    if (c && c.type === 'radiator') supply += thermsSupplied(c, slotFace(stack[i]));
  }
  return demand <= supply;
}

// Find every valid (refinery, robonaut) pair in the stack and
// build an Option for each. An Option is valid when:
//   - The refinery's requires are satisfied by the rest of the
//     stack (not counting the chain we're about to walk - we just
//     check against the full stack supplies here, since the chain
//     INCLUDES the suppliers).
//   - Same for the robonaut.
// Radiators in the chain are split off into `keptRadiators` and
// excluded from `chainIndices` (the indices that actually get
// removed).
export function findIndustrializeOptions(stack) {
  if (!Array.isArray(stack) || !stack.length) return [];
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
    if (c.type === 'refinery') refineries.push({ id: stack[i].id, card: c, index: i });
    if (c.type === 'robonaut') robonauts.push({ id: stack[i].id, card: c, index: i });
  }
  if (!refineries.length || !robonauts.length) return [];

  const stackSupplies = suppliedSet(stack, []);
  const options = [];
  for (const ref of refineries) {
    if (!reqsSatisfied(requiresOf(stack[ref.index]), stackSupplies)) continue;
    for (const rob of robonauts) {
      if (!reqsSatisfied(requiresOf(stack[rob.index]), stackSupplies)) continue;
      const chain = walkChain(stack, [ref.index, rob.index]);
      // Heat the chain generates must be cooled by the stack's
      // radiators, else the build can't run.
      if (!chainThermBalanced(stack, chain)) continue;
      // Split radiators out: they're in the chain (their
      // supplies matter to the build) but they don't get
      // decommissioned (variant rule, see industrialize.md).
      const removeIndices = [];
      const kept = [];
      for (const idx of chain) {
        const c = PATENTS_BY_ID[stack[idx].id];
        if (!c) continue;
        if (c.type === 'radiator') {
          kept.push({ id: stack[idx].id, card: c, index: idx });
        } else {
          removeIndices.push(idx);
        }
      }
      // Orphans are computed against the actually-removed set,
      // not the full chain (kept radiators are still supplying).
      const orphans = findOrphans(stack, removeIndices);
      options.push({
        refinery: ref,
        robonaut: rob,
        chainIndices: removeIndices.sort((a, b) => a - b),
        keptRadiators: kept,
        orphans,
      });
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

// Render the modal for the given site + stack + options. `onCommit`
// is called with the selected Option when the player confirms.
// `siteName` is just for the title. Closes itself on confirm/cancel
// and is dismissible via Escape / overlay click.
export function openIndustrializeModal({ siteName, spectralType, stack, options, onCommit }) {
  document.querySelector('.industrialize-overlay')?.remove();

  // Selected pair index. Defaults to 0 (least-destructive after
  // sort).
  let selected = 0;

  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay industrialize-overlay';
  overlay.tabIndex = -1;

  const close = (committed) => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (committed) onCommit?.(options[selected]);
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
  dialog.setAttribute('aria-label', `Industrialize ${siteName}`);
  overlay.appendChild(dialog);

  const render = () => {
    const opt = options[selected];
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
    const chainHtml = opt.chainIndices.map((idx) => {
      const card = PATENTS_BY_ID[stack[idx].id];
      return `<li><span class="decom-icon">✕</span> <strong>${escapeHtml(card?.name || stack[idx].id)}</strong> <span class="decom-type">(${escapeHtml(card?.type || '')})</span></li>`;
    }).join('');
    const keptHtml = opt.keptRadiators.length
      ? opt.keptRadiators.map((r) =>
          `<li><span class="decom-icon decom-kept">◐</span> <strong>${escapeHtml(r.card.name)}</strong> <span class="decom-type">(radiator, KEPT)</span></li>`
        ).join('')
      : '';
    const orphansHtml = opt.orphans.length
      ? `<div class="industrialize-warn">
           <div class="industrialize-section-label">⚠ Side effect: these cards lose support</div>
           <ul class="industrialize-orphans">
             ${opt.orphans.map((o) =>
               `<li><strong>${escapeHtml(o.card.name)}</strong> will become <em>inactive</em> (needs ${escapeHtml(o.missing.join(' + '))})</li>`
             ).join('')}
           </ul>
         </div>`
      : '';

    dialog.innerHTML = `
      <div class="industrialize-head">
        <h3>🏭 Industrialize at ${escapeHtml(siteName)}</h3>
      </div>
      <div class="industrialize-body">
        <div class="industrialize-spectral">
          Factory will inherit spectral type
          <strong class="industrialize-spectral-badge spectral-${escapeHtml(spectralType || 'C')}">${escapeHtml(spectralType || 'C')}</strong>.
        </div>
        ${pickerHtml}
        <div class="industrialize-section-label">Cards to decommission (back to deck):</div>
        <ul class="industrialize-decom">${chainHtml}${keptHtml}</ul>
        ${orphansHtml}
      </div>
      <div class="card-modal-actions">
        <button type="button" class="modal-btn industrialize-cancel">Cancel</button>
        <button type="button" class="modal-btn primary industrialize-commit">🏭 Industrialize</button>
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
    dialog.querySelector('.industrialize-cancel').addEventListener('click', () => close(false));
    dialog.querySelector('.industrialize-commit').addEventListener('click', () => close(true));
  };

  render();
  document.body.appendChild(overlay);
  overlay.focus();
}
