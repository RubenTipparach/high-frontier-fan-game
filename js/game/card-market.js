// Stage-3 sandbox card-economy mode + the two patent-trading
// ops (Research Auction I2, Free Market I3).
//
// Two modes (toggle in the solo / sandbox-setup panel):
//   - Free Library (default): patents are free draws. Research
//     Auction picks a deck and claims a card for free (op cost
//     only). Free Market is not available.
//   - Card Market: Research Auction requires the player to
//     sacrifice a Hand card to participate (in addition to the
//     op). Free Market sells a Hand card for $3 aqua (op).
//
// Toggling resets the full sandbox state (hand / rocket /
// outposts / factories / colonies / discs / glory / log /
// clock / aqua) so the economy starts from a clean state. The
// reset orchestrator lives here so the toggle can call it
// without duplicating the existing Reset-sandbox flow.
//
// Public surface:
//   MARKET_MODE                          'library' | 'market'
//   getMarketMode()                      string
//   setMarketMode(mode, { skipReset })   boolean (true on change)
//   onMarketChange(cb)                   unsubscribe
//   FREE_MARKET_AQUA                     3 (sell price)
//   AUCTION_AQUA_COST                    0 in library mode, 0 in market
//                                        mode (the cost is the card,
//                                        not aqua)
//   resetSandboxEconomy({ keepMode })    full reset; preserves the
//                                        mode toggle unless asked
//   findAuctionableCards(typeFilter)     library cards available to
//                                        auction (not in hand / rocket
//                                        / any outpost)
//   openAuctionModal({ mode, options,
//                       handIds, lookupCard, onCommit })
//   openFreeMarketModal({ handIds,
//                         lookupCard, onCommit })

import { PATENTS, PATENTS_BY_ID, PATENT_TYPES } from '../../data/patents.js';
import { getHandSlots, addToHand, removeFromHand, clearHand } from './hand.js';
import { getRocketStack, clearStack as rocketClearStack, resetAqua } from './rocket.js';
import { getOutposts, resetStacks } from './stacks.js';
import { resetFactoriesAndColonies } from './factories.js';
import { resetLeoStack } from './leo-stack.js';
import { resetDiscs } from './discs.js';
import { resetGlory } from './glory.js';
import { resetLog } from './mission-log.js';
import { resetClock } from './turn-clock.js';

const STORAGE_MODE = 'hf-sandbox-card-market-mode';

export const MARKET_MODE = { LIBRARY: 'library', MARKET: 'market' };
export const FREE_MARKET_AQUA = 3;

let _mode = (() => {
  try {
    const raw = localStorage.getItem(STORAGE_MODE);
    return raw === MARKET_MODE.MARKET ? MARKET_MODE.MARKET : MARKET_MODE.LIBRARY;
  } catch { return MARKET_MODE.LIBRARY; }
})();

let _listeners = [];

function persist() {
  try { localStorage.setItem(STORAGE_MODE, _mode); }
  catch { /* private mode */ }
}
function notify() {
  for (const cb of _listeners) {
    try { cb(); } catch (err) { console.error('card-market listener:', err); }
  }
}

export function getMarketMode() { return _mode; }

// Setting the mode usually triggers a full sandbox reset (per
// spec: "toggling this setting resets the game"). Callers that
// want to flip without resetting (e.g. the initial mount path
// reading from localStorage) pass { skipReset: true }.
export function setMarketMode(mode, { skipReset } = {}) {
  if (mode !== MARKET_MODE.LIBRARY && mode !== MARKET_MODE.MARKET) return false;
  if (mode === _mode) return false;
  _mode = mode;
  persist();
  if (!skipReset) {
    resetSandboxEconomy({ keepMode: true });
  }
  notify();
  return true;
}

export function onMarketChange(cb) {
  _listeners.push(cb);
  return () => { _listeners = _listeners.filter((x) => x !== cb); };
}

// Full sandbox state reset. Used by the Reset-sandbox button
// AND the Card Market toggle. By default the mode flag is
// PRESERVED across the reset (we don't want a Reset button to
// flip the player's library/market choice back to default).
// The toggle path passes { keepMode: true } too - the mode is
// already set; we just need state cleared.
export function resetSandboxEconomy({ keepMode = true } = {}) {
  clearHand();
  rocketClearStack();
  resetStacks();
  resetLeoStack();
  resetFactoriesAndColonies();
  resetDiscs();
  resetGlory();
  resetLog();
  resetClock();
  resetAqua();
  if (!keepMode) {
    _mode = MARKET_MODE.LIBRARY;
    persist();
    notify();
  }
}

// Find every patent that is NOT currently in a player's
// possession (hand / rocket / any outpost). Optionally filter
// by deck type ('thruster' / 'reactor' / etc). Returns the
// underlying card records so the modal can show them straight.
export function findAuctionableCards(typeFilter) {
  const owned = new Set();
  for (const id of getHandSlots()) owned.add(id);
  for (const slot of getRocketStack()) owned.add(slot.id);
  for (const op of Object.values(getOutposts())) {
    for (const slot of op.cards) owned.add(slot.id);
  }
  const wantType = typeFilter || null;
  const out = [];
  for (const card of PATENTS) {
    if (owned.has(card.id)) continue;
    if (wantType && card.type !== wantType) continue;
    // Expansion-only cards (gw-thruster) stay out of the market;
    // they're not buyable in this build.
    if (card.type === 'gw-thruster') continue;
    out.push(card);
  }
  return out;
}

// ---------- Auction modal ----------

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const DECK_TYPES = ['thruster', 'reactor', 'radiator', 'refinery', 'robonaut', 'generator'];

// Open the auction modal. In library mode the user picks a
// deck type + a specific card; the card enters hand on confirm.
// In market mode the user ALSO picks a hand card to sacrifice
// (sent back to the library pool). Both modes consume the op
// budget (caller enforces via requireOp inside onCommit).
//
// onCommit fires { cardId, sacrificeId } - sacrificeId is null
// in library mode.
export function openAuctionModal({
  mode, handIds, lookupCard, onCommit,
}) {
  document.querySelector('.auction-overlay')?.remove();
  let selectedType  = DECK_TYPES[0];
  let selectedCard  = null;
  let selectedSacrifice = null;

  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay auction-overlay';
  overlay.tabIndex = -1;
  const close = (committed) => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (!committed) return;
    if (!selectedCard) return;
    if (mode === MARKET_MODE.MARKET && !selectedSacrifice) return;
    onCommit?.({ cardId: selectedCard, sacrificeId: selectedSacrifice });
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(false); } };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });

  const dialog = document.createElement('div');
  dialog.className = 'auction-modal';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'Research Auction');
  overlay.appendChild(dialog);

  const render = () => {
    const auctionable = findAuctionableCards(selectedType);
    // If the previously-selected card is no longer in this
    // type's list, clear it so the modal doesn't ship a stale
    // pick.
    if (selectedCard && !auctionable.some((c) => c.id === selectedCard)) {
      selectedCard = null;
    }
    const tabsHtml = DECK_TYPES.map((t) => {
      const count = findAuctionableCards(t).length;
      const active = t === selectedType ? 'is-active' : '';
      return `<button type="button" data-deck="${t}" class="auction-tab ${active}" title="${count} cards available">${escapeHtml(t)} <em>${count}</em></button>`;
    }).join('');
    const cardsHtml = auctionable.length
      ? auctionable.map((c) => {
          const sel = c.id === selectedCard ? '⦿' : '◯';
          return `<button type="button" data-card="${escapeHtml(c.id)}" class="auction-card ${c.id === selectedCard ? 'is-selected' : ''}">
            <span class="auction-radio">${sel}</span>
            <strong>${escapeHtml(c.name)}</strong>
            <span class="auction-spectral industrialize-spectral-badge spectral-${escapeHtml(c.spectralType || 'C')}">${escapeHtml(c.spectralType || 'C')}</span>
          </button>`;
        }).join('')
      : '<p class="muted">No cards available in this deck.</p>';
    const sacrificeHtml = (mode === MARKET_MODE.MARKET)
      ? `<div class="auction-sacrifice">
           <div class="auction-section-label">⚠ Card Market mode: sacrifice a Hand card to participate</div>
           ${handIds.length
             ? `<div class="auction-sac-cards">
                 ${handIds.map((id) => {
                   const c = lookupCard(id);
                   if (!c) return '';
                   const sel = id === selectedSacrifice ? '⦿' : '◯';
                   return `<button type="button" data-sacrifice="${escapeHtml(id)}" class="auction-card ${id === selectedSacrifice ? 'is-selected' : ''}">
                     <span class="auction-radio">${sel}</span>
                     <strong>${escapeHtml(c.name)}</strong>
                     <span class="muted">(${escapeHtml(c.type || '')})</span>
                   </button>`;
                 }).join('')}
               </div>`
             : '<p class="muted">Your hand is empty - boost a card to LEO Hand first, or auction in Free Library mode.</p>'}
         </div>`
      : '';
    const okEnabled = !!selectedCard
      && (mode === MARKET_MODE.LIBRARY || !!selectedSacrifice);
    dialog.innerHTML = `
      <div class="auction-head">
        <h3>🎯 Research Auction</h3>
        <span class="auction-mode">${escapeHtml(mode === MARKET_MODE.MARKET ? 'Card Market' : 'Free Library')}</span>
      </div>
      <div class="auction-body">
        <div class="auction-tabs">${tabsHtml}</div>
        <div class="auction-section-label">Available cards in <strong>${escapeHtml(selectedType)}</strong> deck:</div>
        <div class="auction-cards">${cardsHtml}</div>
        ${sacrificeHtml}
      </div>
      <div class="card-modal-actions">
        <button type="button" class="modal-btn auction-cancel">Cancel</button>
        <button type="button" class="modal-btn primary auction-commit" ${okEnabled ? '' : 'disabled'}>🎯 Claim</button>
      </div>
    `;
    dialog.querySelectorAll('.auction-tab').forEach((b) => {
      b.addEventListener('click', () => {
        selectedType = b.getAttribute('data-deck');
        render();
      });
    });
    dialog.querySelectorAll('.auction-cards .auction-card').forEach((b) => {
      b.addEventListener('click', () => {
        selectedCard = b.getAttribute('data-card');
        render();
      });
    });
    dialog.querySelectorAll('.auction-sac-cards .auction-card').forEach((b) => {
      b.addEventListener('click', () => {
        selectedSacrifice = b.getAttribute('data-sacrifice');
        render();
      });
    });
    dialog.querySelector('.auction-cancel').addEventListener('click', () => close(false));
    dialog.querySelector('.auction-commit').addEventListener('click', () => close(true));
  };

  render();
  document.body.appendChild(overlay);
  overlay.focus();
}

// ---------- Free Market modal ----------

// Open the free-market sell modal (Card Market mode only). The
// player picks one Hand card; on confirm the card goes back to
// the library and the player gains FREE_MARKET_AQUA aqua. Op
// budget consumed by the caller.
export function openFreeMarketModal({ handIds, lookupCard, onCommit }) {
  if (!handIds.length) return;
  document.querySelector('.free-market-overlay')?.remove();

  let selected = handIds[0];

  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay free-market-overlay';
  overlay.tabIndex = -1;
  const close = (committed) => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (!committed || !selected) return;
    onCommit?.({ cardId: selected });
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(false); } };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });

  const dialog = document.createElement('div');
  dialog.className = 'free-market-modal';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'Free Market');
  overlay.appendChild(dialog);

  const render = () => {
    const cardsHtml = handIds.map((id) => {
      const c = lookupCard(id);
      if (!c) return '';
      const sel = id === selected ? '⦿' : '◯';
      return `<button type="button" data-card="${escapeHtml(id)}" class="auction-card ${id === selected ? 'is-selected' : ''}">
        <span class="auction-radio">${sel}</span>
        <strong>${escapeHtml(c.name)}</strong>
        <span class="muted">(${escapeHtml(c.type || '')})</span>
      </button>`;
    }).join('');
    dialog.innerHTML = `
      <div class="auction-head">
        <h3>💱 Free Market</h3>
        <span class="auction-mode">Sell for +${FREE_MARKET_AQUA} aqua</span>
      </div>
      <div class="auction-body">
        <div class="auction-section-label">Pick a Hand card to sell:</div>
        <div class="auction-cards">${cardsHtml}</div>
      </div>
      <div class="card-modal-actions">
        <button type="button" class="modal-btn auction-cancel">Cancel</button>
        <button type="button" class="modal-btn primary auction-commit">💱 Sell (+${FREE_MARKET_AQUA} aqua)</button>
      </div>
    `;
    dialog.querySelectorAll('.auction-cards .auction-card').forEach((b) => {
      b.addEventListener('click', () => {
        selected = b.getAttribute('data-card');
        render();
      });
    });
    dialog.querySelector('.auction-cancel').addEventListener('click', () => close(false));
    dialog.querySelector('.auction-commit').addEventListener('click', () => close(true));
  };

  render();
  document.body.appendChild(overlay);
  overlay.focus();
}
