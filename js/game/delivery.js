// Delivery picker modal. Replaces the old one-button-per-card delivery list in
// the site popup with a single "Deliver..." action that opens this chooser:
// pick one Black-Side card to ship from an outpost back to LEO, then commit.
// Modeled on openColonizePicker (colonize.js) and reuses its modal CSS classes.
//
//   openDeliveryPicker({ siteName, items, onCommit })
//     items: [{ letter, cardId, name, note, disabled }]
//     onCommit(item) is called with the chosen entry.

const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function openDeliveryPicker({ siteName, items, onCommit }) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return;

  document.querySelector('.delivery-overlay')?.remove();

  let selected = list.findIndex((it) => !it.disabled);
  if (selected < 0) selected = 0;

  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay delivery-overlay';
  overlay.tabIndex = -1;
  const close = (committed) => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (committed && list[selected] && !list[selected].disabled) onCommit?.(list[selected]);
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(false); } };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });

  const dialog = document.createElement('div');
  dialog.className = 'colonize-modal';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', `Deliver from ${siteName}`);
  overlay.appendChild(dialog);

  const render = () => {
    const rows = list.map((it, i) => {
      const chk = i === selected ? '⦿' : '◯';
      const cls = `colonize-crew ${i === selected ? 'is-selected' : ''}`;
      return `<button type="button" data-i="${i}" class="${cls}" ${it.disabled ? 'disabled' : ''} style="${it.disabled ? 'opacity:.5' : ''}">
        <span class="crew-radio">${chk}</span>
        <span class="crew-pri"><strong>${escapeHtml(it.name)}</strong></span>
        <span class="crew-sep">·</span>
        <span class="crew-sec"><em>${escapeHtml(it.note || '')}</em></span>
      </button>`;
    }).join('');
    dialog.innerHTML = `
      <div class="colonize-head"><h3>📦 Deliver from ${escapeHtml(siteName)}</h3></div>
      <div class="colonize-body">
        <div class="colonize-note">
          Pick a Black-Side card to ship to LEO. The cost is paid in water from its
          outpost, and delivery spends this turn's operation.
        </div>
        <div class="colonize-crews">${rows}</div>
      </div>
      <div class="card-modal-actions">
        <button type="button" class="modal-btn delivery-cancel">Cancel</button>
        <button type="button" class="modal-btn primary delivery-commit">📦 Deliver</button>
      </div>`;
    dialog.querySelectorAll('.colonize-crew').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.hasAttribute('disabled')) return;
        selected = parseInt(btn.getAttribute('data-i'), 10) || 0;
        render();
      });
    });
    dialog.querySelector('.delivery-cancel').addEventListener('click', () => close(false));
    dialog.querySelector('.delivery-commit').addEventListener('click', () => close(true));
  };

  render();
  document.body.appendChild(overlay);
  overlay.focus();
}
