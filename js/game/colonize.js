// Stage-3 Build Colony free action (rulebook G3).
//
// A free action (NOT an Operation - does not consume the per-
// turn op budget) that converts one colocated Crew card into a
// Colony dome at a factory the player owns. The crew card
// returns to the player's LEO Hand intact; the colony dome is
// the persistent state.
//
// Gating:
//   - There must be a factory at the site, owned by the player.
//   - The site must not already have a colony.
//   - The player must be under COLONY_CAP_PER_PLAYER (7).
//   - The player's colocated stack (the rocket, in this sandbox
//     slice) must contain at least one Crew card.
//
// The Promotion Colony field on the Colonists table is
// reference-only in this variant - promotion is expansion-only,
// crews are NEVER promoted in this variant (see
// industrialize.md). All crews colonize any factory.
//
// Public surface:
//   findColonizeOptions(stack)
//     -> { crews: [{ id, index, primary, secondary }] }
//   openColonizePicker({ siteName, options, onCommit })
//     opens a small picker modal (auto-commits when only one
//     crew is available)

import { CREW_BY_ID } from '../../data/crew.js';
import { COLONISTS_BY_ID } from '../../data/colonists.js';

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Scan the stack for settlers that can found a Colony: a Crew card, OR (M2) a
// HUMAN Colonist. Both are Humans, so both may settle (rulebook G3). Robot
// Colonists are machines, not settlers, so they are skipped - UNLESS the
// Uplift Future has emancipated the robots (robotsEmancipated), from which
// point every Robot colonist counts as a Human for colonizing too, same as
// the server's isHumanColonistSlot. A Crew card carries two independent
// members (faces.primary + faces.secondary), so both names are surfaced; a
// Colonist is one figure, so only its name shows. Each entry is tagged
// `settlerKind` ('crew' | 'colonist') so the caller can settle it the right
// way (a Crew re-spawns in LEO; a Colonist returns to the bottom of the
// colonist deck, or to hand if it's a Robot). The returned key stays `crews`
// for callers.
export function findColonizeOptions(stack, outposts = [], robotsEmancipated = false) {
  const crews = [];
  // A settler is colocated with the factory whether it's ABOARD the rocket OR
  // sitting in a colocated OUTPOST stack at the same site (one cargo-transferred
  // to the outpost still counts). Tag each with its source so the caller removes
  // it from the right stack. The test is by card id (CREW_BY_ID / COLONISTS_BY_ID),
  // not slot.kind, since an outpost slot may not carry the kind tag.
  const scan = (cards, source) => {
    if (!Array.isArray(cards)) return;
    for (let i = 0; i < cards.length; i++) {
      const slot = cards[i];
      if (!slot) continue;
      const crew = CREW_BY_ID[slot.id];
      if (crew) {
        crews.push({
          id: slot.id, index: i, source, card: crew, settlerKind: 'crew',
          primary: crew.faces?.primary || null,
          secondary: crew.faces?.secondary || null,
        });
        continue;
      }
      const col = COLONISTS_BY_ID[slot.id];
      if (col && (col.colonistKind !== 'Robot' || robotsEmancipated)) {
        // Show the face the figure is currently on (white working / purple Lab).
        const face = slot.face === 'secondary'
          ? (col.faces?.secondary || col.faces?.primary) : (col.faces?.primary || col);
        crews.push({
          id: slot.id, index: i, source, card: col, settlerKind: 'colonist',
          primary: { name: col.name, role: (face && face.role) || 'Colonist' },
          secondary: null,
        });
      }
    }
  };
  scan(stack, 'rocket');
  for (const o of (outposts || [])) scan(o && o.cards, { outpost: o.letter });
  return { crews };
}

// Picker modal. When options.crews.length === 1 it skips the
// modal and commits immediately (the user already implicitly
// chose by tapping the action). With 2+ crews it surfaces a
// radio picker. onCommit is called with the chosen
// { id, index, card } entry.
export function openColonizePicker({ siteName, options, onCommit }) {
  const crews = options.crews || [];
  if (!crews.length) return;
  if (crews.length === 1) { onCommit?.(crews[0]); return; }

  document.querySelector('.colonize-overlay')?.remove();

  let selected = 0;

  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay colonize-overlay';
  overlay.tabIndex = -1;
  const close = (committed) => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (committed) onCommit?.(crews[selected]);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(false); }
  };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close(false);
  });

  const dialog = document.createElement('div');
  dialog.className = 'colonize-modal';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', `Colonize ${siteName}`);
  overlay.appendChild(dialog);

  const render = () => {
    const crewHtml = crews.map((c, i) => {
      const pri = c.primary?.name || '?';
      const role1 = c.primary?.role || '';
      const chk = i === selected ? '⦿' : '◯';
      // A Crew card shows both of its members; a single-figure Colonist shows one.
      const tail = c.secondary
        ? `<span class="crew-sep">/</span>
           <span class="crew-sec"><strong>${escapeHtml(c.secondary.name || '?')}</strong> <em>(${escapeHtml(c.secondary.role || '')})</em></span>`
        : `<span class="crew-sep">·</span><span class="crew-sec"><em>Colonist</em></span>`;
      return `<button type="button" data-crew="${i}" class="colonize-crew ${i === selected ? 'is-selected' : ''}">
        <span class="crew-radio">${chk}</span>
        <span class="crew-pri"><strong>${escapeHtml(pri)}</strong> <em>(${escapeHtml(role1)})</em></span>
        ${tail}
      </button>`;
    }).join('');
    dialog.innerHTML = `
      <div class="colonize-head">
        <h3>🌐 Colonize ${escapeHtml(siteName)}</h3>
      </div>
      <div class="colonize-body">
        <div class="colonize-note">
          Pick a settler. A Crew returns to your LEO Stack after the dome lands; a
          Colonist returns to the bottom of the colonist deck. The colony dome stays
          on the factory permanently.
        </div>
        <div class="colonize-crews">${crewHtml}</div>
      </div>
      <div class="card-modal-actions">
        <button type="button" class="modal-btn colonize-cancel">Cancel</button>
        <button type="button" class="modal-btn primary colonize-commit">🌐 Build Colony</button>
      </div>
    `;
    dialog.querySelectorAll('.colonize-crew').forEach((btn) => {
      btn.addEventListener('click', () => {
        selected = parseInt(btn.getAttribute('data-crew'), 10) || 0;
        render();
      });
    });
    dialog.querySelector('.colonize-cancel').addEventListener('click', () => close(false));
    dialog.querySelector('.colonize-commit').addEventListener('click', () => close(true));
  };

  render();
  document.body.appendChild(overlay);
  overlay.focus();
}
