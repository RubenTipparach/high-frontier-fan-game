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

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Scan the stack for crew slots and return one entry per crew.
// Each crew card carries two independent crew members (faces.
// primary + faces.secondary); we surface both names for the
// picker so the player can read which physical card they are
// consuming.
export function findColonizeOptions(stack) {
  if (!Array.isArray(stack)) return { crews: [] };
  const crews = [];
  for (let i = 0; i < stack.length; i++) {
    const slot = stack[i];
    if (!slot || slot.kind !== 'crew') continue;
    const card = CREW_BY_ID[slot.id];
    if (!card) continue;
    crews.push({
      id: slot.id,
      index: i,
      card,
      primary: card.faces?.primary || null,
      secondary: card.faces?.secondary || null,
    });
  }
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
      const sec = c.secondary?.name || '?';
      const role1 = c.primary?.role || '';
      const role2 = c.secondary?.role || '';
      const chk = i === selected ? '⦿' : '◯';
      return `<button type="button" data-crew="${i}" class="colonize-crew ${i === selected ? 'is-selected' : ''}">
        <span class="crew-radio">${chk}</span>
        <span class="crew-pri"><strong>${escapeHtml(pri)}</strong> <em>(${escapeHtml(role1)})</em></span>
        <span class="crew-sep">/</span>
        <span class="crew-sec"><strong>${escapeHtml(sec)}</strong> <em>(${escapeHtml(role2)})</em></span>
      </button>`;
    }).join('');
    dialog.innerHTML = `
      <div class="colonize-head">
        <h3>🌐 Colonize ${escapeHtml(siteName)}</h3>
      </div>
      <div class="colonize-body">
        <div class="colonize-note">
          Pick a Crew card. It returns to your LEO Hand after the dome lands; the colony
          dome stays on the factory permanently.
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
