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

import { renderCard } from './card-ui.js';

// The BLACK installed face a card lands on when produced. Most cards: the
// secondary face. GW thrusters / freighters carry their working (black) card on
// the PRIMARY face (secondary is the PURPLE promoted side), so they land
// primary-side-up. Mirrors the server's blackFace choice in applyEtProduce.
function blackFaceOf(card) {
  // GW thrusters / Freighters carry the working (black) card on the FRONT;
  // so do ROBOT colonists (their unpromoted side IS their black side, 2C2a).
  return (card && (card.type === 'gw-thruster' || card.type === 'freighter' || card.type === 'colonist'))
    ? 'primary' : 'secondary';
}

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
// A card's spectral matches a factory when they're equal OR the card is the
// "Any" wildcard (freighters / some GW thrusters), which produces at a factory
// of ANY spectral type. Exported so the same rule gates the card-driven Exo
// produce button.
export function spectralProducibleAt(cardSpectral, factorySpectral) {
  if (!cardSpectral || !factorySpectral) return false;
  if (String(cardSpectral).toLowerCase() === 'any') return true;
  return cardSpectral === factorySpectral;
}

export function findEtProduceOptions(handIds, lookupCard, factorySpectral) {
  const out = [];
  if (!Array.isArray(handIds) || !factorySpectral) return out;
  for (const id of handIds) {
    const card = lookupCard(id);
    if (!card) continue;
    // Only ROBOT colonists build via ET production (2C2b); Humans never
    // sit in the hand, but guard anyway.
    if (card.type === 'colonist' && card.colonistKind !== 'Robot') continue;
    if (!spectralProducibleAt(card.spectralType, factorySpectral)) continue;
    out.push({ id, card, name: card.name || id, from: 'hand' });
  }
  return out;
}

// A human label for where an ET Produce source card is coming from, so the
// picker shows Hand vs Rocket vs which Outpost at a glance. 'rocket' is called
// out because producing a card that sits in the rocket stack pulls it out of
// the rocket, which can strand the ship.
export function etSourceLabel(from) {
  if (from === 'rocket') return '🚀 Rocket';
  if (typeof from === 'string' && from.startsWith('outpost')) return `🏛 Outpost ${from.slice('outpost'.length)}`;
  return '🃏 Hand';
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
// Enlarged read-only view of one card, stacked over the produce
// modal. Esc / click-away / the close button dismiss only the zoom;
// the picker underneath keeps its state.
function openCardZoom(card) {
  document.querySelector('.et-zoom-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay et-zoom-overlay';
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  };
  // Capture phase so the zoom's Esc wins over the produce modal's.
  document.addEventListener('keydown', onKey, true);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const panel = document.createElement('div');
  panel.className = 'card-modal-panel et-zoom-panel';
  try {
    // renderCard's `type` is the card KIND ('patent' / 'crew'), not the card's
    // own .type - ET Produce options are always patents. Passing the specific
    // type (e.g. 'gw-thruster') dropped the type-* class, so GW thruster /
    // freighter cards lost their black/purple styling and fell back to parchment.
    const el = renderCard(card, { type: 'patent', face: blackFaceOf(card) });
    el.classList.add('card-modal-card');
    panel.appendChild(el);
  } catch {
    panel.textContent = card.name || '';
  }
  const xBtn = document.createElement('button');
  xBtn.type = 'button';
  xBtn.className = 'modal-x';
  xBtn.textContent = '×';
  xBtn.setAttribute('aria-label', 'Close');
  xBtn.addEventListener('click', close);
  panel.appendChild(xBtn);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

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
  // Radiators land Black-Side-up but still choose a deployed side (Light =
  // lighter / less cooling, Heavy = more therms). Default Heavy (max cooling);
  // reset when the player picks a different card.
  let radSide = 'heavy';
  const isRad = (i) => !!(options[i] && options[i].card && options[i].card.type === 'radiator');
  const secFace = (card) => (card && card.faces && card.faces.secondary) || card || {};
  const sideTherms = (card, which) => { const b = secFace(card)[which]; return (b && b.therms != null) ? b.therms : 0; };
  const sideRad = (card, which) => { const b = secFace(card)[which]; return (b && b.radHardness != null) ? b.radHardness : 0; };

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
      radSide: (opt.card && opt.card.type === 'radiator') ? radSide : undefined,
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
      <div class="modal-header">
        <h2 class="modal-title">🏭 ET Produce at ${escapeHtml(siteName)}</h2>
        <button type="button" class="modal-x et-cancel" aria-label="Close">×</button>
      </div>
      <div class="et-produce-body">
        <div class="et-spectral">
          Factory spectral
          <strong class="industrialize-spectral-badge spectral-${escapeHtml(factorySpectral || 'C')}">${escapeHtml(factorySpectral || 'C')}</strong>.
          Card lands Black-Side-up in the outpost.
        </div>
        <div class="et-section-label">Pick a card to produce:</div>
        <div class="et-cards"></div>
        ${options[selectedCard] && options[selectedCard].from === 'rocket' ? `
        <div class="et-rocket-warn">⚠ This card is in your <strong>Rocket</strong> stack. Producing it pulls it out of the rocket, which can leave the ship unable to fly - it may be the active thruster or a card another card needs to work. Make sure the rocket still flies without it (or produce a Hand card instead).</div>` : ''}
        ${isRad(selectedCard) ? `
        <div class="et-radside-block">
          <div class="et-section-label">Deploy this radiator's side:</div>
          <div class="et-radside-toggle">
            <button type="button" class="et-radside-btn ${radSide === 'light' ? 'is-active' : ''}" data-side="light">Light · ${sideTherms(options[selectedCard].card, 'light')}🌡 · rad ${sideRad(options[selectedCard].card, 'light')}</button>
            <button type="button" class="et-radside-btn ${radSide === 'heavy' ? 'is-active' : ''}" data-side="heavy">Heavy · ${sideTherms(options[selectedCard].card, 'heavy')}🌡 · rad ${sideRad(options[selectedCard].card, 'heavy')}</button>
          </div>
        </div>` : ''}
        ${slotHtml}
      </div>
      <div class="card-modal-actions">
        <button type="button" class="modal-btn primary et-commit" ${selectedSlot ? '' : 'disabled'}>🏭 Produce</button>
      </div>
    `;
    // Real card visuals, Black-Side-up (the face the card lands on). Each
    // option is a selectable button wrapping a scaled-down renderCard; the
    // card's own pointer events are off so the wrapper owns the click.
    const cardsHost = dialog.querySelector('.et-cards');
    options.forEach((opt, i) => {
      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'et-card-pick' + (i === selectedCard ? ' is-selected' : '');
      pick.dataset.card = String(i);
      pick.setAttribute('aria-pressed', i === selectedCard ? 'true' : 'false');
      try {
        // The selected radiator previews its currently-chosen side; others
        // show the default (heavy / max cooling).
        const rs = (opt.card.type === 'radiator' && i === selectedCard) ? radSide : 'heavy';
        // type is the card KIND ('patent'), not opt.card.type - see the zoom note.
        pick.appendChild(renderCard(opt.card, { type: 'patent', face: blackFaceOf(opt.card), radSide: rs }));
      } catch {
        pick.textContent = opt.name;
      }
      const tick = document.createElement('span');
      tick.className = 'et-pick-tick';
      tick.textContent = '✓';
      pick.appendChild(tick);
      // Source chip: Hand / Rocket / Outpost X, so the player sees where each
      // card is pulled FROM. Rocket-sourced cards are flagged red (producing one
      // strips the rocket).
      const src = document.createElement('span');
      src.className = 'et-card-source' + (opt.from === 'rocket' ? ' is-rocket' : '');
      src.textContent = etSourceLabel(opt.from);
      pick.appendChild(src);
      pick.addEventListener('click', () => {
        if (selectedCard !== i) { selectedCard = i; radSide = 'heavy'; }
        render();
      });
      // Magnifier: enlarged read-only look at the card, Black-Side-up
      // (the face it lands on). A SIBLING of the pick button inside a
      // positioning wrapper (nested buttons are invalid HTML), so
      // zooming never changes the selection.
      const wrap = document.createElement('div');
      wrap.className = 'et-card-wrap';
      wrap.appendChild(pick);
      const zoom = document.createElement('button');
      zoom.type = 'button';
      zoom.className = 'et-card-zoom';
      zoom.title = 'Examine card';
      zoom.setAttribute('aria-label', `Examine ${opt.name}`);
      zoom.textContent = '🔍';
      zoom.addEventListener('click', () => openCardZoom(opt.card));
      wrap.appendChild(zoom);
      cardsHost.appendChild(wrap);
    });
    dialog.querySelectorAll('.et-slot-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedSlot = btn.getAttribute('data-slot');
        render();
      });
    });
    dialog.querySelectorAll('.et-radside-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        radSide = btn.getAttribute('data-side') === 'light' ? 'light' : 'heavy';
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
