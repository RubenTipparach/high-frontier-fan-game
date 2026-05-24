// Stage-3 ET Production Operation (rulebook I8).
//
// Produces a Hand card Black-Side-up at a factory, into the
// colocated outpost stack (creating a new outpost if needed).
// The card's spectral type must match the factory's spectral
// type (the factory's inheritance from the site, see
// data/sites.js + factories.js).
//
// Black-Side-up means the card's `faces.secondary` is the
// active face. In this sandbox we track the face via a new
// optional `face: 'primary' | 'secondary'` field on outpost
// stack slots; default 'primary' when absent. Rocket stack
// slots do not carry face yet - ET Production only writes to
// outposts.
//
// Consumes the per-turn op (caller enforces via requireOp).
//
// Public surface:
//   findEtProduceOptions(handIds, lookupCard, factorySpectral)
//     -> { id, card, name }[]
//   openEtProduceModal({ siteName, factorySpectral, options,
//                        existingOutpost, freeSlots, onCommit })

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Scan the player's hand for cards that match the factory's
// spectral type. lookupCard is a callback that turns a hand id
// into the underlying card record (patents or crew); we accept
// it injected rather than importing the lookup ourselves so
// this module stays decoupled from the deck data and easy to
// reason about / smoke-test.
export function findEtProduceOptions(handIds, lookupCard, factorySpectral) {
  const out = [];
  if (!Array.isArray(handIds) || !factorySpectral) return out;
  for (const id of handIds) {
    const card = lookupCard(id);
    if (!card) continue;
    const spec = card.spectralType;
    if (!spec || spec !== factorySpectral) continue;
    out.push({ id, card, name: card.name || id });
  }
  return out;
}

// Combined card-picker + slot-picker modal. When the site
// already has an outpost we hide the slot picker entirely.
//
// Args:
//   siteName          string
//   factorySpectral   string (single letter)
//   options           [{ id, card, name }] producible hand cards
//   existingOutpost   string | null - letter of the outpost at
//                     this site, if any (auto-fills the target)
//   freeSlots         string[] - letters of free slots, used to
//                     populate the slot picker when no outpost
//   onCommit          ({ cardId, letter, isNewOutpost }) => void
//
// onCommit is called with the picked card id + the destination
// letter; isNewOutpost is true when the modal is creating a new
// outpost (the caller must run createOutpost first).
export function openEtProduceModal({
  siteName, factorySpectral, options,
  existingOutpost, freeSlots, onCommit,
}) {
  if (!options.length) return;
  document.querySelector('.et-produce-overlay')?.remove();

  let selectedCard = 0;
  let selectedSlot = existingOutpost
    ? existingOutpost
    : (freeSlots[0] || null);

  const needsSlotPick = !existingOutpost;

  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay et-produce-overlay';
  overlay.tabIndex = -1;
  const close = (committed) => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (!committed) return;
    const opt = options[selectedCard];
    if (!opt || !selectedSlot) return;
    onCommit?.({
      cardId: opt.id,
      letter: selectedSlot,
      isNewOutpost: needsSlotPick,
    });
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(false); } };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });

  const dialog = document.createElement('div');
  dialog.className = 'et-produce-modal';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', `ET Produce at ${siteName}`);
  overlay.appendChild(dialog);

  const render = () => {
    const cardsHtml = options.map((opt, i) => {
      const chk = i === selectedCard ? '⦿' : '◯';
      return `<button type="button" data-card="${i}" class="et-card ${i === selectedCard ? 'is-selected' : ''}">
        <span class="et-radio">${chk}</span>
        <strong>${escapeHtml(opt.name)}</strong>
        <span class="et-type">(${escapeHtml(opt.card.type || '')})</span>
      </button>`;
    }).join('');
    const slotHtml = needsSlotPick
      ? `<div class="et-slot-block">
           <div class="et-section-label">No outpost here yet - pick a slot for the new one:</div>
           <div class="et-slot-buttons">
             ${freeSlots.map((L) => `<button type="button" data-slot="${L}" class="et-slot-btn ${L === selectedSlot ? 'is-selected' : ''}">${L}</button>`).join('')}
           </div>
         </div>`
      : `<div class="et-slot-block">
           <div class="et-section-label">Target outpost: <strong>${escapeHtml(existingOutpost)}</strong></div>
         </div>`;
    dialog.innerHTML = `
      <div class="et-produce-head">
        <h3>🏭 ET Produce at ${escapeHtml(siteName)}</h3>
      </div>
      <div class="et-produce-body">
        <div class="et-spectral">
          Factory spectral
          <strong class="industrialize-spectral-badge spectral-${escapeHtml(factorySpectral || 'C')}">${escapeHtml(factorySpectral || 'C')}</strong>.
          Card lands Black-Side-up in the outpost.
        </div>
        <div class="et-section-label">Pick a Hand card to produce:</div>
        <div class="et-cards">${cardsHtml}</div>
        ${slotHtml}
      </div>
      <div class="card-modal-actions">
        <button type="button" class="modal-btn et-cancel">Cancel</button>
        <button type="button" class="modal-btn primary et-commit" ${selectedSlot ? '' : 'disabled'}>🏭 Produce</button>
      </div>
    `;
    dialog.querySelectorAll('.et-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedCard = parseInt(btn.getAttribute('data-card'), 10) || 0;
        render();
      });
    });
    dialog.querySelectorAll('.et-slot-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedSlot = btn.getAttribute('data-slot');
        render();
      });
    });
    dialog.querySelector('.et-cancel').addEventListener('click', () => close(false));
    dialog.querySelector('.et-commit').addEventListener('click', () => close(true));
  };

  render();
  document.body.appendChild(overlay);
  overlay.focus();
}
