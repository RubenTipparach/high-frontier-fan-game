// Stage-3 sandbox card-economy mode + the two patent-trading
// ops (Research Auction I2, Free Market I3).
//
// Two modes (toggle in the solo / sandbox-setup panel):
//   - Free Library (default): patents are free draws. Research
//     Auction picks a deck top and claims it for 1 op + 0 aqua.
//     Free Market is not available.
//   - Card Market: drag-to-hand from the library is locked.
//     Patents must be acquired via Research Auction in the 🛒
//     Cart - same 1 op + 0 aqua cost in solo / sandbox mode
//     (the player wins immediately). Auction winners also
//     receive bonus cards from each support deck. Free Market
//     sells a Hand card for +$3 aqua (op).
// There is NO Hand-card sacrifice in either mode (user
// clarified 2026-05-24).
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
//   openAuctionConfirmModal({ card, mode, renderCardFn,
//                              bonusDeckTypes, onConfirm })
//   openFreeMarketModal({ handIds, lookupCard, onCommit })

import { PATENTS, PATENTS_BY_ID, PATENT_TYPES } from '../../data/patents.js';
import { getHandSlots, addToHand, removeFromHand, clearHand } from './hand.js';
import { getRocketStack, clearStack as rocketClearStack, setAqua } from './rocket.js';
import { getOutposts, resetStacks } from './stacks.js';
import { resetFactoriesAndColonies } from './factories.js';
import { resetLeoStack } from './leo-stack.js';
import { resetDiscs } from './discs.js';
import { resetGlory } from './glory.js';
import { resetLog } from './mission-log.js';
import { resetClock } from './turn-clock.js';
import {
  DECK_TYPES, peekTop, drawTop, addToBottom, cycleAllDecks,
  resetDecks, supportBonusDecks, onDeckChange,
} from './decks.js';

const STORAGE_MODE = 'hf-sandbox-card-market-mode';
const STORAGE_STARTER_CASH = 'hf-sandbox-starter-cash';
const STORAGE_FUEL_CONSUMPTION = 'hf-sandbox-fuel-consumption';

export const MARKET_MODE = { LIBRARY: 'library', MARKET: 'market' };
export const FREE_MARKET_AQUA = 3;
// New-game setting: how much aqua a fresh sandbox starts with
// when "starter cash" is enabled. When disabled the player
// starts at 0 and has to earn it via Income ops / Free Market.
export const STARTER_CASH_AMOUNT = 100;

let _mode = (() => {
  try {
    const raw = localStorage.getItem(STORAGE_MODE);
    return raw === MARKET_MODE.MARKET ? MARKET_MODE.MARKET : MARKET_MODE.LIBRARY;
  } catch { return MARKET_MODE.LIBRARY; }
})();

// Starter-cash preference. Default ON (true) - matches the
// historical behaviour where a fresh sandbox seeded 100 aqua.
let _starterCash = (() => {
  try {
    const raw = localStorage.getItem(STORAGE_STARTER_CASH);
    return raw == null ? true : raw === '1';
  } catch { return true; }
})();

export function getStarterCash() { return _starterCash; }
export function setStarterCash(on) {
  _starterCash = !!on;
  try { localStorage.setItem(STORAGE_STARTER_CASH, _starterCash ? '1' : '0'); }
  catch { /* private mode */ }
}

// Fuel-consumption preference. Default ON (true): a burn / move
// spends water from the tank (fuel-per-burn). When OFF, movement
// is free (no water deducted) - a sandbox convenience for laying
// out routes without juggling fuel.
let _fuelConsumption = (() => {
  try {
    const raw = localStorage.getItem(STORAGE_FUEL_CONSUMPTION);
    return raw == null ? true : raw === '1';
  } catch { return true; }
})();

export function getFuelConsumption() { return _fuelConsumption; }
export function setFuelConsumption(on) {
  _fuelConsumption = !!on;
  try { localStorage.setItem(STORAGE_FUEL_CONSUMPTION, _fuelConsumption ? '1' : '0'); }
  catch { /* private mode */ }
}

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
  // Starting aqua honours the new-game "starter cash" setting:
  // STARTER_CASH_AMOUNT when enabled, 0 when the player opted
  // to start broke.
  setAqua(_starterCash ? STARTER_CASH_AMOUNT : 0);
  // Reshuffle every market deck. Nothing is owned after the
  // wipes above, so we pass an empty owned-set.
  resetDecks(new Set());
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

// (DECK_TYPES imported from ./decks.js above - the deck module
// owns the canonical list. The duplicate const declaration
// that used to live here caused a 'Identifier DECK_TYPES has
// already been declared' SyntaxError on page load.)

// The legacy openAuctionModal (deck tabs + per-card picker +
// Hand-card sacrifice block) lived here. Removed because the
// sacrifice rule is not in the rules - the user clarified
// multiple times. The auction flow now lives entirely in the
// 🛒 Cart pane + openAuctionConfirmModal below: pick from a
// visible deck top, confirm in a focused modal, no sacrifice.


// ---------- Auction confirmation modal ----------
//
// Reusable confirmation dialog used by the Cart's Buy button.
// Will also be used by future Research Auction flows. Shows
// the card being acquired with its full art and a COUNT of
// bonus cards drawn from the corresponding support decks -
// but NEVER the identities of those bonus cards (per user
// 2026-05-24: "DO NOT SHOW player WHAT Cards are coming up on
// the support decks").
//
// `renderCardFn(card, opts)` is passed in by the caller so the
// modal doesn't have to import card-ui.js itself; this keeps
// card-market.js's import graph shallow.
//
// No Hand-card sacrifice (user clarified 2026-05-24:
// "there's no sacrificing, auctions are cost 0 in sandbox
// mode"). onConfirm fires with no payload; the deck draws
// (main card + bonus) are the caller's responsibility.
export function openAuctionConfirmModal({
  card, mode, renderCardFn, bonusCards, onConfirm,
}) {
  if (!card) return;
  document.querySelector('.auction-confirm-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay auction-confirm-overlay';
  overlay.tabIndex = -1;
  const close = (confirmed) => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (!confirmed) return;
    onConfirm?.({});
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(false); } };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });

  const dialog = document.createElement('div');
  dialog.className = 'auction-confirm-modal';
  overlay.appendChild(dialog);

  const inMarket = mode === MARKET_MODE.MARKET;
  // bonusCards is an array of full card records (the top of
  // each support deck at the moment the modal opened). The
  // player sees each one IN FULL via the shared renderCardFn -
  // no longer hidden (user reversed the "DO NOT SHOW" rule on
  // 2026-05-24).
  const bonus = Array.isArray(bonusCards) ? bonusCards.filter(Boolean) : [];

  dialog.innerHTML = `
    <div class="auction-head">
      <h3>🎯 Confirm Auction</h3>
      <span class="auction-mode">${escapeHtml(inMarket ? 'Card Market' : 'Free Library')}</span>
    </div>
    <div class="auction-body">
      <div class="auction-section-label">Card up for auction</div>
      <div class="auction-confirm-card" id="auction-confirm-card"></div>
      <div class="auction-cost-line">
        <strong>Cost:</strong> 1 operation + 0 aqua (solo / sandbox mode).
      </div>
      <div class="auction-bonus-section">
        <div class="auction-section-label">Bonus cards (drawn on confirm)</div>
        ${bonus.length === 0
          ? `<p class="muted">No support requirements - no bonus cards.</p>`
          : `<p class="muted">
               This card has <strong>${bonus.length}</strong> support
               requirement${bonus.length === 1 ? '' : 's'}. Confirming
               also draws the top of each support deck shown below;
               all of these land in your Hand alongside the main card.
             </p>
             <div class="auction-bonus-cards" id="auction-bonus-cards"></div>`}
      </div>
    </div>
    <div class="card-modal-actions">
      <button type="button" class="modal-btn auction-cancel">Cancel</button>
      <button type="button" class="modal-btn primary auction-commit">🎯 Confirm</button>
    </div>
  `;
  // Mount the main card art.
  const cardSlot = dialog.querySelector('#auction-confirm-card');
  if (cardSlot && renderCardFn) {
    try { cardSlot.appendChild(renderCardFn(card, { type: 'patent' })); }
    catch (e) { cardSlot.textContent = card.name || card.id; }
  }
  // Mount the bonus card art (one per support deck). Flex
  // layout in the CSS handles horizontal-on-desktop / vertical-
  // on-narrow + a scrollable region when the total exceeds the
  // modal height.
  const bonusHost = dialog.querySelector('#auction-bonus-cards');
  if (bonusHost && renderCardFn) {
    for (const b of bonus) {
      const wrap = document.createElement('div');
      wrap.className = 'auction-bonus-card';
      try { wrap.appendChild(renderCardFn(b, { type: 'patent' })); }
      catch (e) { wrap.textContent = b.name || b.id; }
      bonusHost.appendChild(wrap);
    }
  }
  dialog.querySelector('.auction-cancel').addEventListener('click', () => close(false));
  dialog.querySelector('.auction-commit').addEventListener('click', () => close(true));

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
