// Browse view: map + patent deck + milestones + events.
//
// Read-only, no engine dependency. Lets a user inspect Stage 2 data
// without needing to start a multiplayer game. Reachable from the
// topbar; also acts as the "preview" surface that Stage 3 will
// replace with the live game.

import { MapRenderer, LEO_ANCHOR } from './render.js';
import { loadPlannerMap } from './planner-map.js';
import { planRoute } from './planner-nav.js';
import {
  consumeMove, refundMove, getTurn, getMovesRemaining, onTurnChange,
  getEventForRoll, getSeasonForSlot, getSeason, resetClock,
  getOpsRemaining, consumeOp,
  getDiscardsRemaining, consumeDiscard,
} from './turn-clock.js';
import { triggerEndTurn, openTurnClockModal, buildDie, rollDie } from './turn-clock-ui.js';
import {
  getState as soloState, newGame as soloNewGame, abandonGame as soloAbandon,
  setTarget as soloSetTarget, commitMove as soloCommitMove,
  prospect as soloProspect, endRound as soloEndRound,
  bindData as soloBindData, onChange as soloOnChange, SOLO_CONFIG,
} from './solo.js';
import { PATENTS, PATENTS_BY_ID, PATENT_TYPES, patentsByType } from '../../data/patents.js';
import {
  getHandSlots, isInHand, addToHand, removeFromHandAt, removeFromHand,
  clearHand, onHandChange,
  isBoostMarked, getBoostMarked, toggleBoostMark, clearBoostMarks,
} from './hand.js';
import {
  getRocketStack, isInRocket, addToStack as rocketAddCard,
  removeFromStack as rocketRemoveCard, clearStack as rocketClearStack,
  onRocketChange, isRocketActive, findFunctionalThrusters,
  getActiveThrusterId, setActiveThruster,
  getTankWater, setTankWater, addFuel, removeFuel, getTankMax,
  getStackTotals, getActiveThrusterStats,
  getProspectorCards, getActiveProspectorId, setActiveProspector,
  clearActiveProspector, getActiveProspectorStats,
  isAfterburnEngaged, setAfterburn,
  getAqua, spendAqua, addAqua, onAquaChange,
} from './rocket.js';
import { canProspect, computeRaygunTargets } from './scan.js';
import {
  getDiscs, getDisc, placeDisc, removeDisc, resetDiscs,
  onChange as onDiscsChange,
} from './discs.js';
import { CREW, CREW_BY_ID, CREW_FACES } from '../../data/crew.js';
import {
  WEIGHT_CLASSES, weightClassForMass, TRACK_LEGEND,
  MIN_DRY_MASS, MAX_DRY_MASS, MAX_WET_MASS,
} from '../../data/net-thrust-track.js';
import { MILESTONES } from '../../data/glory.js';
import { SITES_BY_ID } from '../../data/sites.js';
import {
  renderCard, thrustVisual, attachTipsTo,
  REQUIREMENT_VIS, REQ_SUPPLIER_TYPE,
  svgSunChip, svgBallerinaChip,
} from './card-ui.js';
import {
  logAction, getActions, getHistory, popLastOfType,
  commitTurn as commitLogTurn, resetLog, onChange as onLogChange,
} from './mission-log.js';
import {
  awardChitForZone, revokeChitForZone, cashInChits, uncashChits,
  getChits, getVps, getChitVpValue, isZoneVisited, resetGlory,
  onChange as onGloryChange, ZONE_CHIT_VPS,
} from './glory.js';
import {
  getFactory, createFactory,
  getColony, createColony, countColoniesByOwner,
  allFactories, allColonies,
  onFactoryChange, onColonyChange,
  COLONY_CAP_PER_PLAYER,
} from './factories.js';
import {
  findIndustrializeOptions, openIndustrializeModal,
} from './industrialize.js';
import {
  findColonizeOptions, openColonizePicker,
} from './colonize.js';
import {
  getOutpost, getOutposts, getAvailableOutpostSlots,
  createOutpost, dissolveOutpost,
  addCardToOutpost, removeCardFromOutpost, setOutpostTank,
  getFocusedStackId, setFocusedStackId,
  onFocusChange, onOutpostsChange,
  OUTPOST_LETTERS,
} from './stacks.js';
import {
  getLeoCards, addCardToLeo, removeCardFromLeoById,
  onLeoChange,
} from './leo-stack.js';
import {
  findEtProduceOptions, openEtProduceModal,
} from './et-produce.js';
import {
  defaultSaveName, listSaves, createSave, overwriteSave,
  renameSave, deleteSave, loadSaveAndReload,
} from './saves.js';
import {
  computeEndgameScore, SPECTRAL_DIMINISHING_SCHEDULE,
} from './scoring.js';
import {
  MARKET_MODE, FREE_MARKET_AQUA, STARTER_CASH_AMOUNT,
  getMarketMode, setMarketMode, onMarketChange,
  getStarterCash, setStarterCash,
  getFuelConsumption, setFuelConsumption,
  resetSandboxEconomy,
  openAuctionConfirmModal, openFreeMarketModal,
  findAuctionableCards,
} from './card-market.js';
import {
  DECK_TYPES, getDeck, peekTop, drawTop, addToBottom, removeFromDeck,
  cycleAllDecks, supportBonusDecks, onDeckChange,
} from './decks.js';

// Only one map mode now (planner / "classic"); the old
// "Cleaned up" variant was disorienting next to the canonical
// planner graph and has been removed. Kept as a single function
// rather than a config object so future modes are easy to slot.
async function loadMap() {
  return loadPlannerMap();
}

let _renderer = null;
let _sidebarWired = false;

// Subscribe once: rocket state changes (cards added / removed)
// trigger a re-render of the sandbox rocket on the map.
let _rocketSubWired = false;

export function mountBrowse() {
  const view = document.getElementById('view-browse');
  if (!view) return;
  if (!_rocketSubWired) {
    _rocketSubWired = true;
    onRocketChange(syncSandboxRocket);
    onRocketChange(refreshOpenSitePopup);
    onRocketChange(syncFocusedSite);
    onDiscsChange(syncDiscs);
    onDiscsChange(refreshOpenSitePopup);
    // Turn-clock changes (end-turn, consumeMove, refundMove)
    // shift per-turn budgets. Refresh any open site popup so
    // disabled labels like "Refueled this turn" flip back when
    // the turn advances.
    onTurnChange(refreshOpenSitePopup);
    // Stage-3 chit / focus syncs - repaint the map layer when
    // factory / colony / outpost state changes, and refresh the
    // popup so newly-built factories surface their "Already
    // industrialized" / "ET Produce" buttons immediately.
    onFactoryChange(syncFactories);
    onFactoryChange(refreshOpenSitePopup);
    onColonyChange(syncColonies);
    onColonyChange(refreshOpenSitePopup);
    onOutpostsChange(syncOutposts);
    onOutpostsChange(syncFocusedSite);
    onOutpostsChange(refreshOpenSitePopup);
    onFocusChange(syncFocusedSite);
    // Card Market mode flip changes which LEO popup actions
    // surface (Free Market only in market mode) and the
    // Auction-button gating, so the popup needs a refresh.
    onMarketChange(refreshOpenSitePopup);
    // Same flip also toggles the 🛒 cart sidebar tab visible
    // / hidden - cart is market-mode-only.
    onMarketChange(syncCartTabVisibility);
    // LEO Stack changes need to refresh the popup so the
    // Transfer button enables / disables when cards or water
    // land in or out of LEO.
    onLeoChange(refreshOpenSitePopup);
  }
  // Initial pass to set the cart tab's visibility on mount;
  // the listener above keeps it in sync afterwards.
  syncCartTabVisibility();
  wireSidebar();
  wireHandStrip();
  renderMap();
}

// Sandbox hand strip wiring: drop target, slot rendering, +
// the grabber bar that lets the user drag the strip up to see
// more cards. Card-click opens the inspect modal instead of
// removing the slot directly - Discard lives in the modal.
// Touch-device check used to toggle UI between the desktop
// hover-driven flow and the mobile tap-to-select flow. Reads
// the standardised CSS media queries so an external keyboard
// or external mouse on a tablet still resolves to "hover".
function isTouchDevice() {
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

// On a phone, panning to a site / rocket / search result needs
// to land MUCH closer than the desktop default - the canvas is
// pixel-dense and a 4×-5× zoom leaves the target as a tiny dot.
// Every "find this thing on the map" call routes through here
// so the touch breakpoint can override in one place.
function locateZoom(desktopZoom = 4) {
  return isTouchDevice() ? 7 : desktopZoom;
}

let _handWired = false;
function wireHandStrip() {
  if (_handWired) return;
  _handWired = true;
  const strip    = document.getElementById('sandbox-hand');
  const host     = document.getElementById('sandbox-hand-cards');
  const countEl  = document.getElementById('hand-count');
  const grabber  = document.getElementById('hand-grabber');
  if (!strip || !host) return;

  const lookup = (id) => PATENTS_BY_ID[id]
    || CREW.find((c) => c.id === id) || null;
  const kindOf = (id) =>
    CREW.some((c) => c.id === id) ? 'crew' : 'patent';

  // Drag from the deck → drop onto the strip → append slot.
  // preventDefault unconditionally on dragover - dataTransfer
  // .types is normalised differently across browsers and the
  // "includes" check was silently rejecting valid drags in
  // Firefox + Safari. The drop handler still validates the
  // payload before mutating state.
  host.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    host.classList.add('is-drop-target');
  });
  host.addEventListener('dragleave', () => host.classList.remove('is-drop-target'));
  host.addEventListener('drop', (e) => {
    e.preventDefault();
    host.classList.remove('is-drop-target');
    const id = e.dataTransfer.getData('text/card-id');
    const card = id && lookup(id);
    if (!card) return;
    // Card Market mode locks the library to browse-only;
    // patents must be acquired via Research Auction. Flash the
    // strip red, surface the rule.
    if (getMarketMode() === MARKET_MODE.MARKET) {
      host.classList.add('flash-error');
      setTimeout(() => host.classList.remove('flash-error'), 700);
      setStatus('🃏 Card Market mode: drag-to-hand is disabled. Open the 🛒 Cart tab or use Research Auction at LEO.');
      return;
    }
    const r = addToHand(card);
    if (!r.ok) {
      host.classList.add('flash-error');
      setTimeout(() => host.classList.remove('flash-error'), 700);
    }
  });

  // Grabber: drag vertically to resize the strip between a
  // collapsed default height (152px) and ~60% of viewport so
  // the player can audit a many-card hand without leaving the
  // sandbox view.
  if (grabber) wireHandGrabber(grabber, strip);

  const repaintHand = () => {
    const slots = getHandSlots();
    host.innerHTML = '';
    if (countEl) countEl.textContent =
      `${slots.length} card${slots.length === 1 ? '' : 's'}`;
    slots.forEach((id, idx) => {
      const card = lookup(id);
      if (!card) return;
      const wrap = document.createElement('div');
      wrap.className = 'hand-slot';
      if (isBoostMarked(id)) wrap.classList.add('is-boost-marked');
      wrap.dataset.slotIdx = String(idx);
      const cardEl = renderCard(card, { type: kindOf(id) });
      wrap.appendChild(cardEl);

      // Quick-action row appended as a sibling of the card so
      // it CAN'T be clipped by .card's overflow:hidden when it
      // floats above the card top edge on hover. The slot's
      // 1.18 hover-scale carries both the card and this row so
      // they grow together. Positioning + reveal handled in
      // CSS via .hand-slot:hover.
      const quick = document.createElement('div');
      quick.className = 'hand-quick-actions';
      const qBtn = (cls, glyph, title, handler) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `hand-q ${cls}`;
        b.textContent = glyph;
        b.title = title;
        b.addEventListener('click', (ev) => { ev.stopPropagation(); handler(); });
        return b;
      };
      quick.append(
        qBtn('q-discard', '🗑', 'Discard', () => removeFromHandAt(idx)),
        // Sell is functionally Discard until the Stage-3
        // economy lands (it'll pay out water/VP for sold cards
        // then). Same removal action; separate verb so the
        // intent is preserved when the economy ships.
        qBtn('q-sell',    '💰', 'Sell card', () => removeFromHandAt(idx)),
        qBtn('q-produce', '🏭', `Exo produce (spectral ${card.spectralType || '?'})`,
          () => setStatus(`Exo-produce needs a Stage-3 factory matching spectral ${card.spectralType || '?'}.`)),
        qBtn('q-boost',   '🚀', isBoostMarked(id) ? 'Unmark boost' : 'Mark for boost',
          () => toggleBoostMark(id)),
      );
      wrap.appendChild(quick);

      // Mobile-only "View" button. On touch devices we drop
      // the hover affordances (no hover on touch) and replace
      // them with a two-step tap: first tap selects the card
      // (raised + ring); second tap on the View button opens
      // the inspect modal. Prevents accidental modal-opens on
      // a casual fingerprint.
      const viewBtn = document.createElement('button');
      viewBtn.type = 'button';
      viewBtn.className = 'hand-view-btn';
      viewBtn.textContent = 'View';
      viewBtn.title = 'Open this card';
      viewBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openCardModal(card, kindOf(id), idx);
      });
      wrap.appendChild(viewBtn);

      wrap.addEventListener('click', (ev) => {
        if (ev.target.closest('.card-flip, .card-rotate, .hand-q, .hand-view-btn')) return;
        if (isTouchDevice()) {
          // Tap toggles selection. Only one slot selected at a time.
          const wasSelected = wrap.classList.contains('is-selected');
          host.querySelectorAll('.hand-slot.is-selected').forEach((s) =>
            s.classList.remove('is-selected'));
          if (!wasSelected) wrap.classList.add('is-selected');
        } else {
          openCardModal(card, kindOf(id), idx);
        }
      });
      host.appendChild(wrap);
    });
    repaintBoostCommit();
  };

  const commitBoost = async () => {
    const marked = getBoostMarked();
    if (!marked.length) return;
    // Variant cargo flow (user, 2026-05-24): Boost moves cards
    // Hand -> LEO Stack (NOT directly onto the rocket). The
    // rocket loads from LEO via the free Transfer action when
    // parked at LEO. Boost can always fire; there is no rocket-
    // location gate.
    //
    // LEO Stack is cards-only - it has no water tank (the Aqua
    // Bank already lives at LEO), so there is no wet-mass /
    // spillage concern here. Cards just move across.
    //
    // Boost costs Aqua = the total mass of the boosted cards
    // (user, 2026-05): the player confirms the spend before any
    // money moves. Rulebook I4: Boost is also one Operation per
    // turn (the multi-card batch counts as one op).
    const massOf = (c) => {
      const f = (c && c.faces && c.faces.primary) || c || {};
      return (f.mass != null ? f.mass : (c && c.mass)) | 0;
    };
    const cards = marked.map((id) => lookup(id)).filter(Boolean);
    if (!cards.length) return;
    const cost = cards.reduce((sum, c) => sum + massOf(c), 0);
    const have = getAqua();
    const n = cards.length;
    if (cost > have) {
      await confirmModal({
        title: '💸 Not enough Aqua',
        body: `Boosting ${n} card${n === 1 ? '' : 's'} costs <strong>${cost}</strong> Aqua `
          + `(total mass), but your bank holds only <strong>${have}</strong>.`,
        yes: 'OK', no: '',
      });
      return;
    }
    const ok = await confirmModal({
      title: '🛰 Boost to LEO',
      body: `Boost <strong>${n}</strong> card${n === 1 ? '' : 's'} from your Hand to the LEO Stack `
        + `for <strong>${cost}</strong> Aqua (total mass ${cost})? `
        + `Bank: <strong>${have}</strong> → <strong>${have - cost}</strong>. Costs one operation.`,
      yes: `🛰 Boost (${cost} aqua)`,
      no: 'Cancel',
    });
    if (!ok) return;
    // Charge the Aqua first (affordability pre-checked above;
    // spendAqua is defence-in-depth). Then secure the op - if
    // none is left, refund the Aqua so the player isn't charged
    // for a boost that didn't happen.
    if (!spendAqua(cost)) {
      setStatus(`Boost aborted - not enough Aqua (need ${cost}).`);
      return;
    }
    if (!requireOp('Boost')) {
      addAqua(cost);
      return;
    }
    for (const id of marked) {
      const card = lookup(id);
      if (!card) continue;
      addCardToLeo({ id, kind: kindOf(id) });
      removeFromHand(id);
    }
    clearBoostMarks();
    setStatus(`🛰 Boosted <strong>${n}</strong> card${n === 1 ? '' : 's'} to LEO for <strong>${cost}</strong> Aqua. Bank: <strong>${getAqua()}</strong>.`);
    // Open the LEO inspector so the player sees the cards land
    // in LEO Stack. They'll Transfer LEO->Rocket separately
    // when the rocket is parked at LEO.
    openLeoStackModal();
  };
  const commitBtn = document.getElementById('hand-boost-commit');
  if (commitBtn) commitBtn.addEventListener('click', commitBoost);

  // The old #hand-stack-open and #hand-stack-locate top-level
  // buttons folded into the per-stack chips that the new
  // switcher renders below (each chip has its own 📍 pin); the
  // explicit listeners above are gone.

  repaintHand();
  onHandChange(repaintHand);

  // Stage-3 hand-bar stack switcher. Renders chips for LEO,
  // Rocket, and any active outposts. Re-renders on focus +
  // outpost change so newly-created outposts surface their
  // chip immediately and the focused chip stays highlighted.
  renderStackSwitcher();
  onFocusChange(renderStackSwitcher);
  onOutpostsChange(renderStackSwitcher);
  onRocketChange(renderStackSwitcher);
  onAquaChange(renderStackSwitcher);
  onHandChange(renderStackSwitcher);
  onFactoryChange(renderStackSwitcher);
  onColonyChange(renderStackSwitcher);
  onLeoChange(renderStackSwitcher);
}

// Render the hand-bar stack switcher. ALWAYS shows 6 buttons
// (LEO, Rocket, Outpost A/B/C/D); empty outpost slots stay
// visible but disabled. Each button is paired with a 📍 find-
// pin that flies the map to that stack without opening the
// modal - the old global Stack/Locate buttons fold into these
// per-stack controls.
//
// Click semantics:
//   - main button click  : focus this stack + open its inspector modal
//   - pin button click   : focus this stack + fly the map (no modal)
//   - empty outpost slot : the main button still opens a modal
//                          explaining how to create one; the pin is
//                          disabled (nowhere to fly).
function renderStackSwitcher() {
  const host = document.getElementById('hand-stack-switcher');
  if (!host) return;
  const focused = getFocusedStackId();
  const outposts = getOutposts();
  const rocketStack = getRocketStack();
  const rocketSite = getRocketSite();

  // Build one descriptor per stack slot. `siteAvailable` is what
  // the pin uses - false when there's no place to fly to (empty
  // outpost slot; rocket with no cards still has LEO as a sane
  // fallback, so we treat that as available).
  const slots = [
    {
      id: 'leo', label: '🌍', sub: 'LEO',
      title: `LEO Stack - ${getLeoCards().length} card${getLeoCards().length === 1 ? '' : 's'}. Aqua bank: ${getAqua()}. Hand: ${getHandSlots().length} card${getHandSlots().length === 1 ? '' : 's'} (not yet boosted).`,
      siteAvailable: true,
      isEmpty: false,
    },
    {
      id: 'rocket', label: '🚀', sub: 'Rocket',
      title: rocketStack.length
        ? `Rocket - ${rocketStack.length} card${rocketStack.length === 1 ? '' : 's'}, ${getTankWater()} water${rocketSite ? `, at ${rocketSite.name}` : ', at LEO'}`
        : 'Rocket - empty (boost cards from hand to build the stack)',
      siteAvailable: true,
      isEmpty: false,
    },
  ];
  for (const letter of ['A', 'B', 'C', 'D']) {
    const op = outposts[letter];
    if (op) {
      const opSite = _activeData?.byId?.[op.siteId];
      const factory = getFactory(op.siteId);
      const colony = getColony(op.siteId);
      const factoryTag = factory ? ` 🏭${factory.spectralType}` : '';
      const colonyTag  = colony  ? ' 🌐' : '';
      slots.push({
        id: `outpost${letter}`, label: '🏛', sub: letter,
        title: `Outpost ${letter} at ${opSite?.name || op.siteId} - ${op.cards.length} card${op.cards.length === 1 ? '' : 's'}, ${op.tank} water${factoryTag}${colonyTag}`,
        siteAvailable: !!opSite,
        isEmpty: false,
      });
    } else {
      slots.push({
        id: `outpost${letter}`, label: '🏛', sub: letter,
        title: `Outpost slot ${letter} is empty - convert a parked rocket here via 🚀→🏛`,
        siteAvailable: false,
        isEmpty: true,
      });
    }
  }

  host.innerHTML = slots.map((s) => {
    const focusedClass = s.id === focused ? 'is-focused' : '';
    const emptyClass   = s.isEmpty ? 'is-empty' : '';
    return `<span class="hand-stack-group ${focusedClass} ${emptyClass}" data-stack="${esc(s.id)}">
      <button type="button" class="hand-stack-chip" title="${esc(s.title)}">
        <span class="chip-glyph">${esc(s.label)}</span>
        <span class="chip-sub">${esc(s.sub)}</span>
      </button>
      <button type="button" class="hand-stack-pin" title="Fly map to ${esc(s.sub)}" ${s.siteAvailable ? '' : 'disabled'}>📍</button>
    </span>`;
  }).join('');

  host.querySelectorAll('.hand-stack-group').forEach((group) => {
    const id = group.getAttribute('data-stack');
    const chip = group.querySelector('.hand-stack-chip');
    const pin  = group.querySelector('.hand-stack-pin');
    if (chip) chip.addEventListener('click', () => focusAndOpenStack(id));
    if (pin)  pin.addEventListener('click',  () => focusAndFlyStack(id));
  });
}

// Focus a stack + open its inspector modal. Used by the chip
// click. Always sets focus, even if the stack is empty - the
// modal is the affordance that explains the empty state.
function focusAndOpenStack(id) {
  if (!id) return;
  // Only set focus when the slot can actually be focused (empty
  // outpost slots are not focusable per stacks.js#setFocusedStackId,
  // which rejects ids whose outpost doesn't exist). For empty
  // slots we still open the modal so the player learns how to
  // populate the slot.
  setFocusedStackId(id);
  openStackInspectorModal(id);
}

// Focus a stack + fly the map to its site. Used by the pin
// click - same as above but no modal.
function focusAndFlyStack(id) {
  if (!id) return;
  setFocusedStackId(id);
  flyToStack(id);
}

// Pan the map to the stack with the given id. LEO flies to
// LEO_ANCHOR; Rocket flies to the rocket's site (LEO when
// empty); an outpost flies to its site.
function flyToStack(id) {
  if (!_renderer) return;
  if (id === 'leo') {
    _renderer.flyTo(LEO_ANCHOR, locateZoom(4));
    return;
  }
  if (id === 'rocket') {
    const stack = getRocketStack();
    const site = stack.length ? getRocketSite() : null;
    if (site && Number.isFinite(site.x) && Number.isFinite(site.y)) {
      _renderer.flyTo(site, locateZoom(4));
    } else {
      _renderer.flyTo(LEO_ANCHOR, locateZoom(4));
    }
    return;
  }
  if (id && id.startsWith('outpost')) {
    const letter = id.slice('outpost'.length);
    const op = getOutpost(letter);
    if (!op || !_activeData) return;
    const site = _activeData.byId?.[op.siteId];
    if (site && Number.isFinite(site.x) && Number.isFinite(site.y)) {
      _renderer.flyTo(site, locateZoom(4));
    }
  }
}

// Stack inspector modal router. The Rocket case re-uses the
// existing full-featured openRocketStackModal; LEO and outposts
// get their own focused modals. Empty outpost slots get an
// affordance modal that explains how to populate the slot.
function openStackInspectorModal(id) {
  if (id === 'leo') { openLeoStackModal(); return; }
  if (id === 'rocket') { openRocketStackModal(); return; }
  if (id && id.startsWith('outpost')) {
    const letter = id.slice('outpost'.length);
    const op = getOutpost(letter);
    if (op) openOutpostStackModal(letter);
    else    openEmptyOutpostModal(letter);
  }
}

// ====== Stack inspector shared helpers ======
//
// Every stack (LEO / Rocket / Outpost A-D) holds the same shape
// of cards. The inspector modals share a card-display + select
// + transfer pattern: render each card with the same renderCard
// the patent library uses, give each card a "Select" toggle,
// and offer one transfer button per colocated destination stack.

const STACK_LABELS = {
  leo:      { glyph: '🌍', sub: 'LEO',     name: 'LEO Stack' },
  rocket:   { glyph: '🚀', sub: 'Rocket',  name: 'Rocket' },
  outpostA: { glyph: '🏛', sub: 'A',       name: 'Outpost A' },
  outpostB: { glyph: '🏛', sub: 'B',       name: 'Outpost B' },
  outpostC: { glyph: '🏛', sub: 'C',       name: 'Outpost C' },
  outpostD: { glyph: '🏛', sub: 'D',       name: 'Outpost D' },
};

// Where does a stack physically sit? Returns the siteId the
// stack is currently at, or null when the stack has no location
// (Hand is not a stack here; LEO is always at the LEO anchor).
function getStackSiteId(stackId) {
  if (stackId === 'leo') {
    // LEO Stack lives at the LEO anchor site. Return the LEO
    // site id (or 'leo' as a sentinel if _activeData isn't
    // ready yet).
    return getLeoSiteId();
  }
  if (stackId === 'rocket') {
    const site = getRocketSite();
    return site?.id || null;
  }
  if (stackId && stackId.startsWith('outpost')) {
    const letter = stackId.slice('outpost'.length);
    const op = getOutpost(letter);
    return op?.siteId || null;
  }
  return null;
}

// Return the site id of the LEO anchor (the dedicated lagrange
// "LEO" node in the site data). Used by getStackSiteId for the
// LEO Stack and for colocated-destination math.
function getLeoSiteId() {
  if (!_activeData) return 'leo';
  const leo = _activeData.sites.find(
    (s) => s.type === 'lagrange' && s.name === 'LEO'
  );
  return leo?.id || 'leo';
}

// Cards owned by a stack. Returns the same { id, kind, face? }
// shape used everywhere.
function getStackCards(stackId) {
  if (stackId === 'leo')    return getLeoCards();
  if (stackId === 'rocket') return getRocketStack();
  if (stackId && stackId.startsWith('outpost')) {
    const letter = stackId.slice('outpost'.length);
    const op = getOutpost(letter);
    return op ? op.cards.slice() : [];
  }
  return [];
}

// Destinations the given source stack can transfer cards to
// RIGHT NOW. A destination is valid when it's a different stack
// at the SAME site (colocation rule G1). Returns an array of
// { id, label } objects; empty array when nothing's colocated.
function getColocatedDestinations(sourceId) {
  const sourceSite = getStackSiteId(sourceId);
  if (!sourceSite) return [];
  const dests = [];
  // LEO is always at LEO. If source is at LEO and not LEO
  // itself, LEO is a destination. Skip when source IS LEO.
  if (sourceId !== 'leo' && sourceSite === getLeoSiteId()) {
    dests.push({ id: 'leo', label: 'LEO Stack' });
  }
  // Rocket is colocated when its site matches the source site
  // AND the source isn't the rocket.
  if (sourceId !== 'rocket') {
    const rs = getRocketSite();
    if (rs && rs.id === sourceSite) {
      dests.push({ id: 'rocket', label: 'Rocket' });
    }
  }
  // Outposts at the same site. Skip the source outpost itself.
  for (const letter of ['A', 'B', 'C', 'D']) {
    const opId = `outpost${letter}`;
    if (opId === sourceId) continue;
    const op = getOutpost(letter);
    if (op && op.siteId === sourceSite) {
      dests.push({ id: opId, label: `Outpost ${letter}` });
    }
  }
  return dests;
}

// Move ONE card by id from sourceStack to destStack. Returns
// true on success. Wet-mass clamps re-apply on the destination
// after the move; any spilled water is logged. Used by the
// transfer section's "Send selected" button.
function transferOneCard(sourceId, destId, cardId) {
  const TANK_MAX = 32;
  // Pull the slot out of the source first so we know exactly
  // what we're moving (id + kind + face).
  let slot = null;
  if (sourceId === 'leo') {
    slot = removeCardFromLeoById(cardId);
  } else if (sourceId === 'rocket') {
    const stack = getRocketStack();
    const idx = stack.findIndex((s) => s.id === cardId);
    if (idx === -1) return false;
    slot = { ...stack[idx] };
    rocketRemoveCard(idx);
  } else if (sourceId.startsWith('outpost')) {
    const letter = sourceId.slice('outpost'.length);
    const op = getOutpost(letter);
    if (!op) return false;
    const idx = op.cards.findIndex((s) => s.id === cardId);
    if (idx === -1) return false;
    slot = op.cards[idx];
    removeCardFromOutpost(letter, idx);
  }
  if (!slot) return false;
  // Drop it into the destination.
  let added = false;
  if (destId === 'leo') {
    added = addCardToLeo(slot);
  } else if (destId === 'rocket') {
    added = rocketAddCard(slot.id, slot.kind, slot.face) !== -1;
  } else if (destId.startsWith('outpost')) {
    const letter = destId.slice('outpost'.length);
    added = addCardToOutpost(letter, slot);
  }
  if (!added) {
    // Roll back to source on failure.
    if (sourceId === 'leo') addCardToLeo(slot);
    else if (sourceId === 'rocket') rocketAddCard(slot.id, slot.kind, slot.face);
    else if (sourceId.startsWith('outpost')) {
      addCardToOutpost(sourceId.slice('outpost'.length), slot);
    }
    return false;
  }
  // Wet-mass clamp on the destination tank. Only the rocket
  // has a water tank; LEO + outposts that receive cards have
  // no spillage concern (LEO has no tank; outpost-tank clamps
  // would live in stacks.js if needed).
  if (destId === 'rocket') {
    const cap = Math.max(0, TANK_MAX - rocketStackDryMass());
    if (getTankWater() > cap) setTankWater(cap);
  }
  return true;
}

// Pull a single slot (by id) out of a stack, returning the
// removed { id, kind, face } or null. Mirrors transferOneCard's
// source-removal so decommission + transfer stay consistent.
function pullSlotFromStack(stackId, id) {
  if (stackId === 'leo') return removeCardFromLeoById(id);
  if (stackId === 'rocket') {
    const stack = getRocketStack();
    const idx = stack.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    const slot = { ...stack[idx] };
    rocketRemoveCard(idx);
    return slot;
  }
  if (stackId.startsWith('outpost')) {
    const letter = stackId.slice('outpost'.length);
    const op = getOutpost(letter);
    if (!op) return null;
    const idx = op.cards.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    const slot = { ...op.cards[idx] };
    removeCardFromOutpost(letter, idx);
    return slot;
  }
  return null;
}

// Put a slot back into its source stack (rollback when a
// decommission can't complete - e.g. crew, which never enters
// the hand).
function readdSlotToStack(stackId, slot) {
  if (stackId === 'leo') addCardToLeo(slot);
  else if (stackId === 'rocket') rocketAddCard(slot.id, slot.kind, slot.face);
  else if (stackId.startsWith('outpost')) {
    addCardToOutpost(stackId.slice('outpost'.length), slot);
  }
}

// Decommission selected cards from a stack back to the player's
// hand (variant rule: voluntary stack removal returns cards to
// hand). Confirms first. Crew never enters the hand, so any crew
// in the selection is rolled back into the stack and reported.
async function decommissionSelectedToHand(stackId, ids, onDone) {
  const list = [...ids];
  if (!list.length) return;
  const ok = await confirmModal({
    title: '♻ Decommission to hand',
    body: `Return <strong>${list.length}</strong> selected card${list.length === 1 ? '' : 's'} `
      + `from this stack to your hand?`,
    yes: '♻ Decommission', no: 'Cancel',
  });
  if (!ok) return;
  let returned = 0;
  let blocked = 0;
  for (const id of list) {
    const slot = pullSlotFromStack(stackId, id);
    if (!slot) continue;
    const card = cardById(id);
    const r = card ? addToHand(card) : { ok: false };
    if (r && r.ok) returned++;
    else { readdSlotToStack(stackId, slot); blocked++; }
  }
  let msg = `♻ Decommissioned <strong>${returned}</strong> card${returned === 1 ? '' : 's'} to your hand.`;
  if (blocked) msg += ` <strong>${blocked}</strong> stayed (crew can't go to the hand).`;
  setStatus(msg);
  try { onDone && onDone(); } catch (e) { console.error('decommission onDone:', e); }
}

// LEO inspector. Same card-holder system as the rocket modal:
// each card is rendered via the shared renderCard() and gets a
// Select toggle so the player can mark cards for transfer. The
// transfer section at the bottom lists every colocated stack
// the player can ship the selected cards to. Free action - no
// op cost. Subscribes to onLeoChange / onRocketChange /
// onOutpostsChange so the modal re-renders live as state
// shifts.
function openLeoStackModal() {
  openUnifiedStackInspector('leo');
}

// Outpost inspector. Same unified shape as the LEO modal.
// Adds factory / colony attachment chips in the stats row.
function openOutpostStackModal(letter) {
  openUnifiedStackInspector(`outpost${letter}`);
}

// Unified inspector for any non-rocket stack (LEO, Outpost
// A-D). The rocket modal stays separate (it has the thruster
// picker + prospector + afterburn UI) but we layer the same
// select-and-transfer pattern into it as well via
// renderRocketTransferSection.
function openUnifiedStackInspector(stackId) {
  document.querySelector('.stack-inspector-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay stack-inspector-overlay';
  const selected = new Set();
  let unsubFns = [];
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    for (const fn of unsubFns) { try { fn(); } catch {} }
    unsubFns = [];
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const dialog = document.createElement('div');
  dialog.className = 'stack-inspector-modal';
  overlay.appendChild(dialog);

  const render = () => {
    const labelMeta = STACK_LABELS[stackId] || { glyph: '?', sub: stackId, name: stackId };
    const cards = getStackCards(stackId);
    // Prune selections of cards that are no longer in this
    // stack (e.g. moved out by a sibling subscriber).
    for (const id of [...selected]) {
      if (!cards.some((c) => c.id === id)) selected.delete(id);
    }
    const dests = getColocatedDestinations(stackId);

    // Stat row depends on which stack we're inspecting.
    let statsHtml = '';
    if (stackId === 'leo') {
      const aqua = getAqua();
      const handCount = getHandSlots().length;
      statsHtml = `
        <div class="stack-inspector-stat-row">
          <div class="stack-inspector-stat"><span class="muted">LEO cards</span><strong>${esc(String(cards.length))}</strong></div>
          <div class="stack-inspector-stat"><span class="muted">Aqua bank</span><strong class="stat-aqua">${esc(String(aqua))} 💧</strong></div>
          <div class="stack-inspector-stat"><span class="muted">Hand (not at LEO)</span><strong>${esc(String(handCount))}</strong></div>
        </div>`;
    } else if (stackId.startsWith('outpost')) {
      const letter = stackId.slice('outpost'.length);
      const op = getOutpost(letter);
      if (!op) { close(); return; }
      const factory = getFactory(op.siteId);
      const colony  = getColony(op.siteId);
      statsHtml = `
        <div class="stack-inspector-stat-row">
          <div class="stack-inspector-stat"><span class="muted">Cards</span><strong>${esc(String(cards.length))}</strong></div>
          <div class="stack-inspector-stat"><span class="muted">Water FT</span><strong class="stat-water">${esc(String(op.tank))} 💧</strong></div>
          <div class="stack-inspector-stat"><span class="muted">Factory</span><strong>${factory ? `🏭 <span class="industrialize-spectral-badge spectral-${esc(factory.spectralType)}">${esc(factory.spectralType)}</span>` : '<span class="muted">none</span>'}</strong></div>
          <div class="stack-inspector-stat"><span class="muted">Colony</span><strong>${colony ? '🌐 dome' : '<span class="muted">none</span>'}</strong></div>
        </div>`;
    }

    const headline = stackId === 'leo'
      ? '🌍 LEO Stack'
      : `🏛${esc(stackId.slice('outpost'.length))} - Outpost`;
    const locLabel = stackId === 'leo'
      ? 'orbital staging'
      : (() => {
          const letter = stackId.slice('outpost'.length);
          const op = getOutpost(letter);
          const site = _activeData?.byId?.[op?.siteId];
          return site?.name || op?.siteId || '';
        })();

    dialog.innerHTML = `
      <div class="stack-inspector-head">
        <h3>${headline}</h3>
        <span class="stack-inspector-loc">${esc(locLabel)}</span>
      </div>
      <div class="stack-inspector-body">
        ${statsHtml}
        <h4>Cards (${cards.length})</h4>
        <!-- Same #rocket-stack-cards container + .rocket-stack-row
             grid the rocket modal uses, so the cards render with
             identical look + spacing across every stack inspector. -->
        <div id="stack-inspector-cards">
          <div class="rocket-stack-row" id="stack-inspector-cards-row"></div>
        </div>
      </div>
      <!-- Footer: transfer + decommission + fuel + close all live
           in a pinned bar so they stay visible no matter how far
           the card list is scrolled. -->
      <div class="stack-inspector-footer">
        <div id="stack-inspector-transfer"></div>
        <div class="card-modal-actions">
          <button type="button" class="modal-btn decommission stack-decom-btn"
            title="Return the selected cards to your hand" disabled>♻ Decommission to hand</button>
          ${stackId === 'leo' && isLeoSite(getRocketSite())
            ? '<button type="button" class="modal-btn stack leo-fuel-tank" title="Open the docked rocket\'s water tank to transfer fuel">💧 Rocket fuel tank</button>'
            : ''}
          <button type="button" class="modal-btn stack-inspector-close">Close</button>
        </div>
      </div>
    `;

    // Footer buttons depend on the selection count. refreshFooter
    // updates them IN PLACE so toggling Select never rebuilds the
    // card list (and so never resets its scroll position).
    const refreshFooter = () => {
      const n = selected.size;
      dialog.querySelectorAll('.stack-inspector-xfer-btn').forEach((btn) => {
        btn.disabled = n === 0;
        btn.textContent = `Send ${n > 0 ? n + ' ' : ''}→ ${btn.dataset.destLabel || ''}`;
      });
      const decom = dialog.querySelector('.stack-decom-btn');
      if (decom) {
        decom.disabled = n === 0;
        decom.textContent = `♻ Decommission to hand${n ? ` (${n})` : ''}`;
      }
    };

    const row = dialog.querySelector('#stack-inspector-cards-row');
    if (!cards.length) {
      row.innerHTML = '<p class="muted">Stack is empty.</p>';
    } else {
      for (const slot of cards) {
        const card = cardById(slot.id);
        if (!card) continue;
        // Same .rocket-slot wrapper + renderCard the rocket
        // modal uses - one design language across every stack.
        const wrap = document.createElement('div');
        wrap.className = 'rocket-slot';
        if (selected.has(slot.id)) wrap.classList.add('is-selected');
        wrap.appendChild(renderCard(card, { type: slot.kind || 'patent', face: slot.face }));
        const actions = document.createElement('div');
        actions.className = 'rocket-slot-actions';
        const selBtn = document.createElement('button');
        selBtn.type = 'button';
        selBtn.className = 'rocket-select' + (selected.has(slot.id) ? ' is-on' : '');
        selBtn.textContent = selected.has(slot.id) ? '✓ Selected' : 'Select';
        selBtn.addEventListener('click', () => {
          const on = selected.has(slot.id);
          if (on) selected.delete(slot.id); else selected.add(slot.id);
          // Toggle in place - NO render() - so the card list's
          // scroll position is untouched.
          wrap.classList.toggle('is-selected', !on);
          selBtn.classList.toggle('is-on', !on);
          selBtn.textContent = !on ? '✓ Selected' : 'Select';
          refreshFooter();
        });
        actions.appendChild(selBtn);
        if (slot.face === 'secondary') {
          const tag = document.createElement('span');
          tag.className = 'card-face-tag';
          tag.title = 'Black-Side / Tier 2';
          tag.textContent = 'BS';
          actions.appendChild(tag);
        }
        wrap.appendChild(actions);
        row.appendChild(wrap);
      }
    }

    // Transfer section. Shown only when at least one
    // destination is colocated. The rule G1 covers card / FT
    // transfers between colocated stacks; this is the UI for
    // moving CARDS - water transfers stay on the existing fuel
    // modal for now (per-stack water move would be a future
    // unification).
    const transferHost = dialog.querySelector('#stack-inspector-transfer');
    if (dests.length === 0) {
      transferHost.innerHTML = `
        <div class="stack-inspector-transfer empty">
          <h4>🔄 Transfer</h4>
          <p class="muted">No colocated stacks to transfer to right now.${stackId === 'leo'
            ? ' Park the rocket at LEO to enable LEO ↔ Rocket transfers.'
            : ' Park the rocket at this site (or create a second outpost here) to enable transfers.'}</p>
        </div>`;
    } else {
      const destButtonsHtml = dests.map((d) =>
        `<button type="button" class="stack-inspector-xfer-btn" data-dest="${esc(d.id)}" data-dest-label="${esc(d.label)}" disabled>Send → ${esc(d.label)}</button>`
      ).join('');
      transferHost.innerHTML = `
        <div class="stack-inspector-transfer">
          <h4>🔄 Transfer (free action)</h4>
          <p class="muted">Select cards above, then send them to a colocated stack. Wet-mass clamps apply on the destination tank.</p>
          <div class="stack-inspector-xfer-row">${destButtonsHtml}</div>
        </div>`;
      transferHost.querySelectorAll('.stack-inspector-xfer-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const destId = btn.getAttribute('data-dest');
          if (!destId || selected.size === 0) return;
          // Snapshot ids first - the source array mutates as
          // we move each card so iteration over `selected` is
          // safe via spread.
          const toMove = [...selected];
          let moved = 0;
          for (const cardId of toMove) {
            if (transferOneCard(stackId, destId, cardId)) {
              moved++;
              selected.delete(cardId);
            }
          }
          const destMeta = STACK_LABELS[destId] || { name: destId };
          const sourceMeta = STACK_LABELS[stackId] || { name: stackId };
          setStatus(`🔄 Transferred <strong>${moved}</strong> card${moved === 1 ? '' : 's'} from <em>${esc(sourceMeta.name)}</em> to <em>${esc(destMeta.name)}</em>.`);
          logAction({
            type: 'transfer',
            icon: '🔄',
            summary: `Transferred ${moved} card${moved === 1 ? '' : 's'} from ${sourceMeta.name} to ${destMeta.name}`,
            undoable: false,
            data: { source: stackId, dest: destId, count: moved },
          });
          render();
        });
      });
    }

    dialog.querySelector('.stack-inspector-close').addEventListener('click', close);
    // When the rocket is docked at LEO, a shortcut into its water
    // tank (the aqua <-> tank transfer UI lives there). Close the
    // LEO inspector first so the two modals don't stack / fight
    // over the Escape key.
    const fuelBtn = dialog.querySelector('.leo-fuel-tank');
    if (fuelBtn) {
      fuelBtn.addEventListener('click', () => {
        close();
        openFuelTankModal();
      });
    }
    // Decommission: return the selected cards to hand (free,
    // any-time). Active only when something is selected.
    const decomBtn = dialog.querySelector('.stack-decom-btn');
    if (decomBtn) {
      decomBtn.addEventListener('click', () => {
        if (!selected.size) return;
        decommissionSelectedToHand(stackId, [...selected], render);
      });
    }
    // Initialise footer button states from the current selection.
    refreshFooter();
  };

  // Subscribe to every state change that could affect the
  // displayed cards or the colocated-destination list. The
  // modal re-renders in place so transfers feel instant.
  unsubFns.push(onLeoChange(render));
  unsubFns.push(onRocketChange(render));
  unsubFns.push(onOutpostsChange(render));
  unsubFns.push(onFactoryChange(render));
  unsubFns.push(onColonyChange(render));

  render();
  document.body.appendChild(overlay);
  overlay.focus();
}

// Empty-slot affordance modal. Explains how the player can
// populate the slot. Tells the player which other slots are
// occupied so they understand the constraint.
function openEmptyOutpostModal(letter) {
  document.querySelector('.stack-inspector-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay stack-inspector-overlay';
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const taken = Object.keys(getOutposts()).sort();
  const takenLabel = taken.length
    ? `Occupied slots: <strong>${taken.join(', ')}</strong>`
    : 'No outpost slots are occupied yet.';
  const dialog = document.createElement('div');
  dialog.className = 'stack-inspector-modal';
  dialog.innerHTML = `
    <div class="stack-inspector-head">
      <h3>🏛${esc(letter)} - Empty slot</h3>
    </div>
    <div class="stack-inspector-body">
      <p>Outpost slot <strong>${esc(letter)}</strong> isn't in use yet. To create an outpost in this slot:</p>
      <ol class="stack-inspector-howto">
        <li>Park your rocket at any non-LEO site with cards loaded.</li>
        <li>Open the site popup and tap <strong>🚀→🏛 Convert to Outpost</strong>.</li>
        <li>Pick slot <strong>${esc(letter)}</strong> from the picker.</li>
      </ol>
      <p class="muted">${takenLabel}</p>
      <p class="muted">
        ET Production at a player-owned factory can also create
        a fresh outpost when none exists at that site - the slot
        picker will offer this letter.
      </p>
    </div>
    <div class="card-modal-actions">
      <button type="button" class="modal-btn stack-inspector-close">Close</button>
    </div>
  `;
  overlay.appendChild(dialog);
  dialog.querySelector('.stack-inspector-close').addEventListener('click', close);
  document.body.appendChild(overlay);
  overlay.focus();
}

// Vertical resize grabber for the hand strip. Tracks a CSS
// variable on the strip element so the height is restored
// between repaints + survives onHandChange rerenders.
function wireHandGrabber(grabber, strip) {
  let startY = 0;
  let startH = 0;
  // Publish the live hand height as a CSS custom property on the
  // browse-shell so the sidepanel can stop its `bottom` at the
  // hand's top edge instead of overdrawing it.
  const shell = document.querySelector('.browse-shell');
  const publishHeight = (h) => {
    if (shell) shell.style.setProperty('--hand-height', `${h}px`);
  };
  publishHeight(strip.getBoundingClientRect().height || 320);
  const onMove = (clientY) => {
    const dy = startY - clientY;            // drag up = positive
    const next = Math.max(120, Math.min(window.innerHeight * 0.7, startH + dy));
    strip.style.height = `${next}px`;
    publishHeight(next);
  };
  const onPointerDown = (e) => {
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    startY = cy;
    startH = strip.getBoundingClientRect().height;
    document.body.style.userSelect = 'none';
    const moveEv = e.touches ? 'touchmove' : 'pointermove';
    const upEv   = e.touches ? 'touchend'  : 'pointerup';
    const onMoveEv = (ev) => onMove(ev.touches ? ev.touches[0].clientY : ev.clientY);
    const onUpEv   = () => {
      document.body.style.userSelect = '';
      document.removeEventListener(moveEv, onMoveEv);
      document.removeEventListener(upEv, onUpEv);
    };
    document.addEventListener(moveEv, onMoveEv);
    document.addEventListener(upEv, onUpEv);
  };
  grabber.addEventListener('pointerdown', onPointerDown);
  grabber.addEventListener('touchstart', onPointerDown, { passive: true });
}

// Modals + the drag-ghost append to the live overlay root, which
// is the fullscreen element when one is active (e.g. the user
// pressed ⛶ on the map toolbar) and document.body otherwise.
// Anything appended outside the fullscreen root is invisible
// while the Fullscreen API is engaged - so a modal mounted in
// body would just silently not show up. The watcher below
// re-parents any open overlays on fullscreenchange so they
// follow the user in / out of fullscreen too.
function overlayRoot() {
  return document.fullscreenElement || document.body;
}
function mountOverlay(el) {
  overlayRoot().appendChild(el);
  return el;
}
document.addEventListener('fullscreenchange', () => {
  const root = overlayRoot();
  // Move every known overlay class into the new root so a modal
  // that was open when the user toggled fullscreen stays visible.
  // Selectors cover the card / fuel-tank / rocket-stack /
  // confirm / hazard / turn-clock modals + the drag ghost.
  const selectors = [
    '.card-modal-overlay',
    '.fuel-tank-overlay',
    '.confirm-modal-overlay',
    '.rocket-stack-overlay',
    '.hazard-confirm-overlay',
    '.drag-ghost',
    '.card-tip',
  ];
  for (const sel of selectors) {
    for (const el of document.querySelectorAll(sel)) {
      if (el.parentNode !== root) root.appendChild(el);
    }
  }
});

// Custom drag-image. The browser's default drag-image is a
// faded snapshot of the element with no animation; we replace
// it with a fixed-position clone that follows the pointer, casts
// a heavy drop shadow, and wiggles with spring-damped rotation
// driven by horizontal velocity. The native HTML5 drop event
// still handles the actual data transfer - this only changes
// the visual the user sees while dragging.
let _dragGhost = null;
let _dragGhostState = null;

function startCustomDragGhost(srcEl, ev) {
  endCustomDragGhost();
  // 1×1 transparent canvas. setDragImage on a freshly-constructed
  // <img src=data:…> raced the browser in Safari + Firefox -
  // the drag started before the image loaded and the native
  // ghost flickered in. A canvas is fully painted synchronously
  // at the moment we hand it off, so the swap is reliable.
  const blank = document.createElement('canvas');
  blank.width = 1; blank.height = 1;
  try { ev.dataTransfer.setDragImage(blank, 0, 0); } catch { /* IE */ }

  const rect = srcEl.getBoundingClientRect();
  const ghost = srcEl.cloneNode(true);
  ghost.classList.add('drag-ghost');
  ghost.style.width  = rect.width + 'px';
  ghost.style.height = rect.height + 'px';
  // Anchor the ghost so the pointer "holds" the spot where the
  // user grabbed - feels less floaty than centring it.
  const offsetX = ev.clientX - rect.left;
  const offsetY = ev.clientY - rect.top;
  ghost.style.left = (ev.clientX - offsetX) + 'px';
  ghost.style.top  = (ev.clientY - offsetY) + 'px';
  mountOverlay(ghost);

  _dragGhost = ghost;
  _dragGhostState = {
    offsetX,
    offsetY,
    lastX: ev.clientX,
    lastY: ev.clientY,
    lastT: performance.now(),
    rotTarget: 0,
    rotCurrent: 0,
    raf: 0,
  };

  // Track pointer via document-level dragover (the only
  // drag-event with reliable clientX/clientY across browsers).
  document.addEventListener('dragover', onDragGhostMove);
  _dragGhostState.raf = requestAnimationFrame(animateDragGhost);
}

function onDragGhostMove(ev) {
  const s = _dragGhostState;
  if (!s || !_dragGhost) return;
  ev.preventDefault();   // also acts as dropEffect: copy
  const now = performance.now();
  const dt = Math.max(1, now - s.lastT);
  const vx = (ev.clientX - s.lastX) / dt;   // px/ms
  s.lastX = ev.clientX;
  s.lastY = ev.clientY;
  s.lastT = now;
  // Rotation target tilts toward the direction of horizontal
  // motion. Capped so a fast flick doesn't spin the card past
  // legibility. Wiggle comes from the spring lerp in animate().
  s.rotTarget = Math.max(-18, Math.min(18, vx * 28));
  _dragGhost.style.left = (ev.clientX - s.offsetX) + 'px';
  _dragGhost.style.top  = (ev.clientY - s.offsetY) + 'px';
}

function animateDragGhost() {
  const s = _dragGhostState;
  if (!s || !_dragGhost) return;
  // Critically-damped spring toward rotTarget. rotTarget decays
  // on its own so the rotation eases back to 0 when the user
  // pauses, giving the "wiggle settling" feel.
  s.rotCurrent += (s.rotTarget - s.rotCurrent) * 0.20;
  s.rotTarget *= 0.86;
  _dragGhost.style.transform = `translate3d(0,0,0) rotate(${s.rotCurrent.toFixed(2)}deg)`;
  s.raf = requestAnimationFrame(animateDragGhost);
}

function endCustomDragGhost() {
  document.removeEventListener('dragover', onDragGhostMove);
  if (_dragGhostState) cancelAnimationFrame(_dragGhostState.raf);
  if (_dragGhost) _dragGhost.remove();
  _dragGhost = null;
  _dragGhostState = null;
}

// Animate a card flying from its on-screen position to the
// hand strip's drop area, then commit it to the hand. Used by
// the deck-tap modal's "Add to hand" button so the player sees
// the card sail from the library / modal to the strip instead
// of it just popping into existence. srcEl is the card element
// inside the modal (or any DOM node we can read a bounding
// rect off); onLand fires AFTER the card has visually arrived.
//
// If we can't find a destination (no hand strip mounted, e.g.
// the player is on a non-browse view) we skip the animation
// and call onLand immediately so callers never block on a
// missing target.
function flyCardToHand(srcEl, card, onLand) {
  const land = () => { try { onLand?.(); } catch (e) { console.error('flyCardToHand land:', e); } };
  const dest = document.getElementById('sandbox-hand-cards')
    || document.getElementById('sandbox-hand');
  if (!srcEl || !dest) { land(); return; }
  const srcRect = srcEl.getBoundingClientRect();
  const dstRect = dest.getBoundingClientRect();
  if (!srcRect.width || !srcRect.height) { land(); return; }
  // Build a clone of the card art, fixed-position it over the
  // source, then transition it toward the hand strip. We use a
  // CSS transition (transform + opacity) because the runtime is
  // simple and the browser can keep the transform on the GPU.
  const ghost = (srcEl.cloneNode(true));
  ghost.classList.add('hand-flight-ghost');
  ghost.style.position = 'fixed';
  ghost.style.left = srcRect.left + 'px';
  ghost.style.top  = srcRect.top + 'px';
  ghost.style.width  = srcRect.width + 'px';
  ghost.style.height = srcRect.height + 'px';
  ghost.style.margin = '0';
  ghost.style.pointerEvents = 'none';
  ghost.style.zIndex = '120';
  ghost.style.transformOrigin = 'top left';
  ghost.style.transform = 'translate(0, 0) scale(1)';
  ghost.style.transition = 'transform 520ms cubic-bezier(0.22, 0.61, 0.36, 1), opacity 520ms ease-out';
  ghost.style.willChange = 'transform, opacity';
  // Land near the LEFT edge of the strip so the card looks
  // like it slots into the first position (cards stack
  // left-to-right; new hand cards appear at the left end of
  // the strip). The final scale (~0.4) matches the hand-
  // strip's visual card size.
  const targetX = dstRect.left + 24;
  const targetY = dstRect.top + (dstRect.height - srcRect.height * 0.4) / 2;
  const dx = targetX - srcRect.left;
  const dy = targetY - srcRect.top;
  document.body.appendChild(ghost);
  // Force layout before the transform change so the transition
  // actually fires (otherwise the browser collapses the two
  // styles and skips animation).
  void ghost.offsetWidth;
  ghost.style.transform = `translate(${dx}px, ${dy}px) scale(0.4) rotate(-6deg)`;
  ghost.style.opacity = '0.05';
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    ghost.remove();
    land();
  };
  ghost.addEventListener('transitionend', finish);
  // Safety net in case transitionend doesn't fire (off-screen,
  // tab inactive, prefers-reduced-motion suppressing the
  // transition).
  setTimeout(finish, 700);
}

// Tap modal for a card sitting in the deck. Confirms "add to
// hand" with a single primary action. Mobile-friendly because
// HTML5 drag-and-drop doesn't work reliably on touch; pointing
// + tapping is a more honest gesture for "I want this card."
function openDeckTapModal(card, kind, { allowAuction = false, inspectOnly = false } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay';
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const panel = document.createElement('div');
  panel.className = 'card-modal-panel';
  const cardEl = renderCard(card, {
    type: kind,
    onSupportClick: (kinds) => {
      close();
      openPatentsSupports(kinds);
    },
  });
  cardEl.classList.add('card-modal-card');
  panel.appendChild(cardEl);

  const actions = document.createElement('div');
  actions.className = 'card-modal-actions';

  // Action button depends on context + mode:
  //   - allowAuction (opened FROM the cart, market mode): a
  //     "🎯 Auction" button that buys this deck-top card.
  //   - market mode, opened from the LIBRARY (no allowAuction):
  //     strictly read-only - no add, no auction. Auctions only
  //     happen in the cart.
  //   - Free Library mode: "✋ Add to hand" + flight.
  const inMarket = getMarketMode() === MARKET_MODE.MARKET;
  if (inspectOnly) {
    // Crew library: pure reference. Crew enters play only through
    // the starting-crew wizard at New game, so there's no add /
    // auction here.
    const note = document.createElement('p');
    note.className = 'muted card-modal-note';
    note.textContent = '👥 Crew is chosen at New game via the starting-crew wizard.';
    actions.append(note);
  } else if (inMarket && allowAuction) {
    const auctionBtn = document.createElement('button');
    auctionBtn.type = 'button';
    auctionBtn.className = 'modal-btn stack';
    const bonus = supportBonusDecks(card).length;
    auctionBtn.textContent = bonus > 0 ? `🎯 Auction (+${bonus} bonus)` : '🎯 Auction';
    auctionBtn.title = 'Auction this card (1 op, 0 aqua in sandbox mode).';
    auctionBtn.addEventListener('click', () => {
      close();
      doAuctionCard(card);
    });
    actions.append(auctionBtn);
  } else if (inMarket) {
    const note = document.createElement('p');
    note.className = 'muted card-modal-note';
    note.textContent = '🛒 Card Market: patents are acquired from the Cart tab, not the library. This view is read-only.';
    actions.append(note);
  } else {
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'modal-btn stack';
    addBtn.textContent = '✋ Add to hand';
    addBtn.addEventListener('click', () => {
      // Validate up front: don't fly the animation just to bounce
      // (dup card, expansion card, etc). Surface the reason and
      // skip the flight.
      if (isInHand(card.id)) {
        setStatus(`Can't add: already in your hand.`);
        close();
        return;
      }
      // Close the modal first so the user sees the card take
      // flight against the underlying view, not against a fading
      // backdrop. The flight clones the modal card element so the
      // ghost survives the close.
      const srcEl = cardEl;
      overlay.classList.add('is-flying');
      flyCardToHand(srcEl, card, () => {
        const r = addToHand(card);
        if (!r.ok) setStatus(`Can't add: ${r.reason}.`);
      });
      // Fade the modal itself out in parallel with the flight so
      // the player's eye follows the card to the strip rather than
      // getting stuck on a still-open dialog.
      overlay.style.transition = 'opacity 220ms ease-out';
      overlay.style.opacity = '0';
      setTimeout(close, 240);
    });
    actions.append(addBtn);
  }

  panel.appendChild(actions);
  overlay.appendChild(panel);
  mountOverlay(overlay);
  // Tap the backdrop or press Escape to dismiss - no explicit ×
  // button. The card modal is small and the backdrop is the
  // obvious affordance.
  const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
}

// Inspect modal: enlarged copy of the clicked card with three
// actions - Discard (pop back to the deck), Exo produce (will
// need a factory location once Stage-3 builds them), and Add to
// stack (push onto the LEO rocket).
function openCardModal(card, kind, slotIdx) {
  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay';
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const panel = document.createElement('div');
  panel.className = 'card-modal-panel';
  const cardEl = renderCard(card, {
    type: kind,
    face: getPickedCrew()?.cardId === card.id ? getPickedCrew()?.face : undefined,
    onSupportClick: (kinds) => {
      close();
      openPatentsSupports(kinds);
    },
  });
  cardEl.classList.add('card-modal-card');
  panel.appendChild(cardEl);

  const actions = document.createElement('div');
  actions.className = 'card-modal-actions';

  // Crew has NO per-card actions (no Discard / Sell / Exo-produce
  // / Boost / Flip). Crew never enters the hand and can ONLY move
  // stack-to-stack (LEO <-> rocket <-> outpost) via the stack
  // inspector's transfer controls. Show a note and stop here.
  if (kind === 'crew') {
    const note = document.createElement('p');
    note.className = 'muted card-modal-note';
    note.textContent = '👥 Crew can only be transferred between stacks (LEO ↔ rocket ↔ outpost). It has no hand actions.';
    actions.append(note);
    panel.appendChild(actions);
    overlay.appendChild(panel);
    mountOverlay(overlay);
    const onKeyCrew = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKeyCrew); } };
    document.addEventListener('keydown', onKeyCrew);
    return;
  }

  // Four primary actions, emoji-led for the quick-icon row on
  // hand-slot hover (defined further down) to mirror the same
  // verbs. Boost flags the card for the next BOOST commit;
  // the commit lives on the hand strip's BOOST button (lit
  // when at least one card is marked).
  // Discard: voluntary free action, 1/turn, sends the Hand
  // card to the bottom of its corresponding patent deck (user,
  // 2026-05-24: "you can discard a card from your hand at a
  // ny time, 1 per turn, that goes to the back of the deck").
  // Crew cards don't have a deck to return to in this slice -
  // they just leave the hand. Per-turn budget tracked in
  // turn-clock.js.
  const discardBtn = document.createElement('button');
  discardBtn.type = 'button';
  discardBtn.className = 'modal-btn discard';
  const discardsLeft = getDiscardsRemaining();
  discardBtn.textContent = discardsLeft > 0
    ? '🗑 Discard'
    : '🗑 Discard (used this turn)';
  discardBtn.title = discardsLeft > 0
    ? `Send this card to the bottom of the ${card.type || 'corresponding'} deck. Free action, 1 per turn.`
    : `Discard already used this turn (1 per turn). End the turn to refresh.`;
  discardBtn.disabled = discardsLeft <= 0;
  discardBtn.addEventListener('click', () => {
    if (discardBtn.disabled) return;
    if (!consumeDiscard()) {
      setStatus('Discard already used this turn (1 per turn).');
      return;
    }
    removeFromHandAt(slotIdx);
    // Patents return to the bottom of their type's deck.
    // Crew don't have a deck in this slice; they just leave.
    if (PATENTS_BY_ID[card.id]) addToBottom(card.id);
    setStatus(`🗑 Discarded <em>${esc(card.name)}</em> to the bottom of the ${esc(card.type || 'crew')} deck.`);
    logAction({
      type: 'discard',
      icon: '🗑',
      summary: `Discarded ${card.name} to the bottom of the ${card.type || 'crew'} deck`,
      undoable: false,
      data: { cardId: card.id, deckType: card.type || null },
    });
    close();
  });

  const sellBtn = document.createElement('button');
  sellBtn.type = 'button';
  sellBtn.className = 'modal-btn sell';
  sellBtn.textContent = '💰 Sell';
  sellBtn.title = 'Sell card - same as discard until the Stage-3 economy lands';
  sellBtn.addEventListener('click', () => {
    removeFromHandAt(slotIdx);
    close();
  });

  const produceBtn = document.createElement('button');
  produceBtn.type = 'button';
  produceBtn.className = 'modal-btn produce';
  produceBtn.textContent = `🏭 Exo produce (${card.spectralType || '?'})`;
  produceBtn.title = `Use a factory matching spectral type ${card.spectralType || '?'} to produce the dark-side resource`;
  produceBtn.addEventListener('click', () => {
    setStatus(
      `Exo-produce needs a factory matching spectral type `
      + `<strong>${card.spectralType || '?'}</strong>. `
      + `Factories aren't buildable yet (Stage 3).`
    );
    close();
  });

  const boostBtn = document.createElement('button');
  boostBtn.type = 'button';
  boostBtn.className = 'modal-btn stack';
  const marked = isBoostMarked(card.id);
  boostBtn.textContent = marked ? '🚀 Unmark boost' : '🚀 Boost';
  boostBtn.title = marked
    ? 'Remove the boost mark on this card'
    : 'Mark this card to be boosted to the LEO rocket on the next BOOST commit';
  boostBtn.addEventListener('click', () => {
    toggleBoostMark(card.id);
    close();
  });

  actions.append(discardBtn, sellBtn, produceBtn, boostBtn);
  panel.appendChild(actions);
  overlay.appendChild(panel);
  mountOverlay(overlay);

  // Tap the backdrop or press Escape to dismiss - no explicit ×
  // button (the action row already crowds the bottom).
  const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
}

// Side panel: a vertical tab strip on the right edge of the
// browse view. Each tab pops a different pane in/out. Clicking the
// active tab closes the panel; clicking the × close button does
// the same. Pane content (patents / milestones / events) is
// rendered lazily on first open and then left mounted.
function wireSidebar() {
  if (_sidebarWired) return;
  _sidebarWired = true;
  const panel = document.getElementById('browse-sidepanel');
  const tabs  = document.getElementById('sidepanel-tabs');
  const close = document.getElementById('sidepanel-close');
  if (!panel || !tabs || !close) return;

  for (const btn of tabs.querySelectorAll('button')) {
    btn.addEventListener('click', () => {
      const pane = btn.dataset.pane;
      if (panel.dataset.active === pane) {
        // Toggle off if already active.
        showPane(null);
      } else {
        showPane(pane);
      }
    });
  }
  close.addEventListener('click', () => showPane(null));

  // Modal backdrop on mobile: tapping the dimmed area closes the
  // open pane. Backdrop is hidden on desktop via CSS so this is a
  // no-op there.
  const backdrop = document.getElementById('browse-modal-backdrop');
  if (backdrop) backdrop.addEventListener('click', () => showPane(null));
}

function showPane(pane) {
  const panel = document.getElementById('browse-sidepanel');
  if (!panel) return;
  panel.dataset.active = pane || '';
  for (const btn of panel.querySelectorAll('.sidepanel-tabs button')) {
    btn.classList.toggle('active', btn.dataset.pane === pane);
  }
  for (const el of panel.querySelectorAll('.panel-pane')) {
    el.classList.toggle('active', el.dataset.pane === pane);
  }
  // Backdrop tracks panel state - visible whenever a pane is open
  // (CSS gates it behind the mobile breakpoint so desktop never
  // sees it).
  const backdrop = document.getElementById('browse-modal-backdrop');
  if (backdrop) backdrop.classList.toggle('hidden', !pane);
  // Render the pane lazily on first reveal.
  if      (pane === 'patents')    renderPatents();
  else if (pane === 'cart')       renderCart();
  else if (pane === 'milestones') renderMilestones();
  else if (pane === 'log')        renderMissionLog();
  else if (pane === 'solo')       renderSolo();
}

// Route state: shared across renderer instances. Tapping the first
// site sets `from`, tapping the second sets `to` and triggers the
// pathfinder; tapping again starts a new route from that site.
let _routeFrom = null;     // origin once a route has been plotted
let _routeTo = null;       // destination once a route has been plotted
let _selectedId = null;    // currently-highlighted site (just info, no routing)
let _routingMode = false;  // true while the user is picking a destination
let _activeData = null;

// Rocket position state. The sandbox rocket sprite is drawn at
// whichever site the rocket currently occupies; defaults to LEO
// when no id is stored. Persisted so a reload doesn't teleport
// the rocket back to LEO mid-journey. _plannedRoute mirrors the
// segments most recently passed to the renderer so moveRocket()
// can consume them turn-by-turn, and _moveSnapshot lets the 🛸
// toggle's undo restore the previous position + route.
const STORAGE_ROCKET_SITE  = 'hf-sandbox-rocket-site';
const STORAGE_ROCKET_TRAIL = 'hf-sandbox-rocket-trail';
const STORAGE_ROCKET_ROUTE = 'hf-sandbox-planned-route';
const STORAGE_ROUTE_PRIORITY = 'hf-sandbox-route-priority';
// Routing metric priority. 'turns' minimizes turn-ends first (the
// snap-to-adjacent default); 'burns' minimizes water spend first
// (favours long Hohmann coasts at the cost of more turns). User-
// togglable via the ⚙ gear in the site popup; persisted so the
// pick survives reloads.
let _routePriority = (() => {
  try {
    const s = localStorage.getItem(STORAGE_ROUTE_PRIORITY);
    return s === 'burns' || s === 'turns' ? s : 'turns';
  } catch { return 'turns'; }
})();
function setRoutePriority(mode) {
  if (mode !== 'turns' && mode !== 'burns') return;
  _routePriority = mode;
  try { localStorage.setItem(STORAGE_ROUTE_PRIORITY, mode); } catch {}
}
function routeMetricPriority() {
  return _routePriority === 'burns'
    ? ['burns', 'turns', 'hazards', 'radHazards']
    : ['turns', 'burns', 'hazards', 'radHazards'];
}

// Manual move mode. Alternative to the auto-planner: the player
// taps neighbouring sites one at a time to build a route by
// hand. Burn budget = active thruster's `thrust` value. Each
// hop's cost obeys the rulebook's Hohmann + pivot rules:
//
//   - Entering a non-burn node (Hohmann, lagrange, site, radhaz,
//     venus, decorative) → 0 burns. They're "free" stops.
//   - Entering a burn node → its `landing` value (default 1,
//     half-landers cost 2 the second time).
//   - Pivoting at a Hohmann (changing direction at a labelled
//     edge node) → +1 burn. The first pivot of the manual route
//     is FREE if the active thruster has `bonusPivots > 0`
//     (pirouette thrusters in the rulebook).
//
// Each manual hop becomes a turn-1 segment in _plannedRoute;
// once the player hits Move the existing moveRocket flow consumes
// them all in one animation. Cancel = clear route. Fuel is not
// deducted (sandbox mode treats burns as free per the current
// rules); thrust is just the planning budget.
let _manualMode = false;
let _manualBudget = 0;
let _manualBudgetMax = 0;
let _manualOriginId = null;
let _manualDir = null;          // direction we entered the tip on
let _manualPivotsUsed = 0;
let _manualPirouettes = 0;      // free pivots remaining (bonusPivots)
function manualTipId() {
  if (_plannedRoute && _plannedRoute.length) {
    return _plannedRoute[_plannedRoute.length - 1].to;
  }
  return _manualOriginId;
}
function activeThrusterBonusPivots() {
  const id = getActiveThrusterId();
  if (!id) return 0;
  const card = PATENTS_BY_ID[id];
  if (!card) return 0;
  const f = (card.faces && card.faces.primary) || card;
  return Number(f.bonusPivots) || 0;
}
function enterManualMoveMode() {
  _routeFrom = null;
  _routeTo = null;
  _plannedRoute = null;
  persistPlannedRoute();
  const thrStats = getActiveThrusterStats();
  const thrust = thrStats && Number.isFinite(thrStats.thrust) ? thrStats.thrust : 4;
  _manualMode = true;
  _manualBudget = thrust;
  _manualBudgetMax = thrust;
  _manualDir = null;
  _manualPivotsUsed = 0;
  _manualPirouettes = activeThrusterBonusPivots();
  const here = getRocketSite();
  _manualOriginId = here ? here.id : null;
  _plannedRoute = [];
  persistPlannedRoute();
  if (_renderer) {
    _renderer.setRoute(null);
    _renderer.setRouteEndpoints(_manualOriginId, _manualOriginId);
  }
  const clearBtn = document.getElementById('route-clear');
  if (clearBtn) { clearBtn.hidden = false; clearBtn.textContent = '✕ Cancel'; }
  manualMoveStatus();
}
function exitManualMoveMode() {
  _manualMode = false;
  _manualBudget = 0;
  _manualBudgetMax = 0;
  _manualOriginId = null;
  _manualDir = null;
  _manualPivotsUsed = 0;
  _manualPirouettes = 0;
  const clearBtn = document.getElementById('route-clear');
  if (clearBtn) clearBtn.textContent = 'Clear route';
}
function manualMoveStatus() {
  if (!_manualMode) return;
  const placed = _plannedRoute ? _plannedRoute.length : 0;
  const pirouetteHint = _manualPirouettes > 0
    ? ` <em class="muted">(${_manualPirouettes} free pivot${_manualPirouettes === 1 ? '' : 's'} ready)</em>`
    : '';
  if (_manualBudget <= 0) {
    setStatus(`✋ Manual: <strong>${placed}</strong> hop${placed === 1 ? '' : 's'} plotted, <strong>0</strong>/${_manualBudgetMax} burns left. Tap <strong>🛸 Move</strong> or Cancel.`);
  } else {
    setStatus(`✋ Manual: <strong>${_manualBudget}</strong>/${_manualBudgetMax} burns left.${pirouetteHint} Tap an adjacent site to extend.`);
  }
}
// Cost calculator for a single manual hop. Returns:
//   { ok: false, reason } when the hop isn't allowed
//   { ok: true, cost, isPivot, freePivot, newDir } when it is
function manualHopCost(tipId, toId) {
  if (!_activeData) return { ok: false, reason: 'no map data' };
  const points = _activeData.byId || {};
  const edgeLabels = _activeData.edgeLabels || {};
  const fromNode = points[tipId];
  const toNode   = points[toId];
  if (!fromNode || !toNode) return { ok: false, reason: 'unknown site' };
  if (tipId === toId) return { ok: false, reason: 'already there' };
  const nbrs = _activeData.neighbors && _activeData.neighbors.get(tipId);
  if (!nbrs || !nbrs.has(toId)) {
    return { ok: false, reason: `not adjacent to ${esc(fromNode.name || tipId)}` };
  }
  const newDir = (edgeLabels[tipId] && edgeLabels[tipId][toId]) || null;
  let cost = 0;
  let isPivot = false;
  let freePivot = false;
  // Pivot: leaving a Hohmann (labelled edges) in a different
  // direction than the one we entered on.
  const tipHasLabels = !!edgeLabels[tipId];
  if (tipHasLabels && _manualDir != null && newDir != null && newDir !== _manualDir) {
    isPivot = true;
    if (_manualPirouettes - _manualPivotsUsed > 0) {
      freePivot = true;
    } else {
      cost += 1;
    }
  }
  // Burn nodes carry an entry cost. Default 1; half-landers
  // print 2 on their second face. Everything else (Hohmann,
  // lagrange, regular site, radhaz, venus, decorative) is 0.
  if (toNode.type === 'burn') {
    cost += toNode.landing != null ? toNode.landing : 1;
  }
  return { ok: true, cost, isPivot, freePivot, newDir };
}
function manualAppendSegment(toId) {
  if (!_manualMode || !_activeData) return false;
  const tipId = manualTipId();
  if (!tipId) return false;
  const r = manualHopCost(tipId, toId);
  if (!r.ok) {
    setStatus(`Manual: ${r.reason}.`);
    return false;
  }
  if (r.cost > _manualBudget) {
    const partsMissing = r.cost - _manualBudget;
    setStatus(`Manual: needs ${r.cost} burn${r.cost === 1 ? '' : 's'} (short ${partsMissing}). Tap Move to fly or Cancel.`);
    return false;
  }
  _plannedRoute = _plannedRoute || [];
  _plannedRoute.push({
    from: tipId, to: toId,
    turn: 1,
    burns: r.cost,
    dv: r.cost,
    isPivot: r.isPivot,
    freePivot: r.freePivot,
  });
  _manualBudget -= r.cost;
  if (r.isPivot) _manualPivotsUsed += 1;
  _manualDir = r.newDir;
  persistPlannedRoute();
  if (_renderer) {
    _renderer.setRoute(_plannedRoute);
    _renderer.setRouteEndpoints(_manualOriginId, toId);
  }
  manualMoveStatus();
  return true;
}
let _rocketSiteId = (() => {
  try { return localStorage.getItem(STORAGE_ROCKET_SITE) || null; }
  catch { return null; }
})();
// Planned route (turn-tagged segments) persists across reloads so
// a multi-turn plan survives the player putting the game down for
// a day and picking it back up. Reading it back is just JSON; we
// validate-on-use by checking that every endpoint resolves in the
// active data set before handing it to the renderer.
let _plannedRoute = (() => {
  try {
    const s = localStorage.getItem(STORAGE_ROCKET_ROUTE);
    const parsed = s ? JSON.parse(s) : null;
    return Array.isArray(parsed) && parsed.length ? parsed : null;
  } catch { return null; }
})();
let _moveSnapshot = null;
let _rocketTrail = (() => {
  try {
    const s = localStorage.getItem(STORAGE_ROCKET_TRAIL);
    return s ? JSON.parse(s) : [];
  } catch { return []; }
})();
// True while the rocket's animating along a path; blocks a second
// move/undo from racing with the in-flight tween.
let _rocketAnimating = false;

async function renderMap() {
  const host = document.getElementById('browse-map');
  if (!host) return;
  ensureMapShell(host);
  await mountMapFor();
}

// Build the toolbar + route panel skeleton once. Subsequent calls
// (e.g. after toggling view mode) reuse the same shell and just
// rebuild the map host inside it.
function ensureMapShell(host) {
  if (host.dataset.shellReady === '1') return;
  host.dataset.shellReady = '1';
  host.innerHTML = `
    <div class="map-toolbar">
      <div class="map-turn-controls">
        <button id="turn-move-rocket" title="Move the rocket one step along its planned route"
          aria-label="Move rocket">🛸</button>
        <button id="turn-end" title="End your turn"
          aria-label="End turn">⏭ End turn</button>
        <button id="turn-tracker" title="View turn tracker"
          aria-label="View turn tracker">🕐</button>
        <span id="turn-budget" class="map-turn-budget" aria-live="polite">
          <span class="turn-tag" id="turn-tag-op" title="Operations remaining this turn">op:1</span>
          <span class="turn-tag" id="turn-tag-move" title="Moves remaining this turn">move:1</span>
        </span>
        <span id="aqua-chip" class="map-aqua-chip"
          title="Aqua balance - spend 4 aqua per hazard to bypass rolls, or convert 1:1 to water at LEO">
          💧 <strong id="aqua-chip-balance">${getAqua()}</strong>
        </span>
      </div>
      <button id="map-search-toggle" class="map-search-toggle"
        title="Search sites" aria-label="Search sites">🔍</button>
      <div class="map-search">
        <input id="map-search-input" type="text" autocomplete="off"
          spellcheck="false" placeholder="Find site…" />
        <button id="map-search-go" title="Fly to site"
          aria-label="Fly to site">🔍</button>
        <button id="map-search-close" class="map-search-close"
          title="Close search" aria-label="Close search">×</button>
        <ul id="map-search-suggestions" class="hidden"></ul>
      </div>
      <div id="map-search-backdrop" class="map-search-backdrop hidden"></div>
      <div class="map-route">
        <span id="route-status" class="muted">Tap a site to plan a route.</span>
        <button id="route-clear" hidden>Clear route</button>
        <button id="game-settings" title="Game settings"
          aria-label="Game settings">⚙</button>
        <button id="route-debug" title="Toggle debug panel"
          aria-label="Toggle debug panel">🔧</button>
        <button id="route-fullscreen" title="Toggle fullscreen map"
          aria-label="Toggle fullscreen">⛶</button>
      </div>
    </div>
    <div class="browse-map-stage">
      <div id="browse-map-canvas" class="browse-map-canvas"></div>
      <div id="map-debug" class="map-debug hidden">
        <div class="dbg-header">
          <span>Debug</span>
          <button id="dbg-close" aria-label="Close">×</button>
        </div>
        <div class="dbg-row">
          <span>Zoom</span>
          <strong id="dbg-zoom">-</strong>
        </div>
        <div class="dbg-row">
          <span>FPS</span>
          <strong id="dbg-fps">-</strong>
        </div>
        <label class="dbg-slider">
          <span>Initial zoom <em id="dbg-init-zoom-val"></em></span>
          <input id="dbg-init-zoom" type="range" min="0.5" max="6" step="0.1" />
        </label>
        <label class="dbg-slider">
          <span>Label fade start <em id="dbg-fade-min-val"></em></span>
          <input id="dbg-fade-min" type="range" min="0.5" max="6" step="0.1" />
        </label>
        <label class="dbg-slider">
          <span>Label fade end <em id="dbg-fade-max-val"></em></span>
          <input id="dbg-fade-max" type="range" min="0.5" max="6" step="0.1" />
        </label>
        <label class="dbg-check">
          <input id="dbg-show-decoratives" type="checkbox" />
          <span>Show decoratives</span>
        </label>
        <button id="dbg-reset" class="dbg-reset">Reset view</button>
      </div>
    </div>
  `;
  host.querySelector('#route-clear').addEventListener('click', clearRoute);
  host.querySelector('#route-fullscreen').addEventListener('click', () => {
    // Promote the whole browse shell to fullscreen, not just the
    // map host -- this way the sidebar comes along for the ride.
    const shell = document.querySelector('.browse-shell') || host;
    toggleFullscreen(shell);
  });
  host.querySelector('#route-debug').addEventListener('click', () => {
    const panel = host.querySelector('#map-debug');
    panel.classList.toggle('hidden');
    const open = !panel.classList.contains('hidden');
    if (_renderer) _renderer.setOption('debug', open);
    try { localStorage.setItem(STORAGE_DBG_PANEL_OPEN, open ? '1' : '0'); }
    catch { /* private mode */ }
  });
  // Global game-settings gear on the toolbar. Opens the same
  // settings modal accessible from per-popup affordances; right
  // now only route options live there but future settings (UI
  // density, accessibility toggles, persistent dev flags) will
  // land in the same modal.
  host.querySelector('#game-settings').addEventListener('click', () => {
    openGameSettingsModal();
  });
  // Turn clock + rocket-movement controls. End turn pops a confirm
  // when the player still has unspent budget; if they confirm and
  // the new slot is an event, openTurnClockModal animates the d6.
  // Move rocket is a placeholder until the rocket-movement engine
  // lands - it just consumes the per-turn move budget for now so
  // the end-turn confirm reflects the spend.
  host.querySelector('#turn-end').addEventListener('click', async () => {
    // Capture the previous slot BEFORE advancing so the modal can
    // animate the Sunspot Cube sliding from old → new instead of
    // teleporting. If the player cancels the confirm, nothing
    // moved, so we skip the modal entirely.
    const prevTurn = getTurn();
    const result = await triggerEndTurn();
    if (!result) return;
    // Sunspot Cube landed on an event slot - apply the d6 outcome
    // (VP credit / debit + flavour log line) BEFORE we commit the
    // mission log so the event appears in this turn's record.
    if (result.event) {
      applyEventDieEffect(result.event);
    }
    // Commit the now-completed turn into the per-game history and
    // clear the live log for the next turn.
    commitLogTurn({
      turn: prevTurn,
      round: result.round,
      event: result.event,
    });
    // Wipe this turn's cyan rocket trail - each turn starts with a
    // clean slate so the ribbon reads as "where I went THIS turn",
    // not "everywhere I've ever been". Position + planned route
    // both stay put.
    _rocketTrail = [];
    persistRocketTrail();
    if (_renderer) _renderer.setRocketTrail(null);
    // A new turn refreshes per-turn operation budgets: move,
    // refuel-per-site, future ops. Any open site popup is now
    // stale (its disabled / "refueled this turn" labels were
    // computed from the previous turn's state); refresh it.
    refreshOpenSitePopup();
    openTurnClockModal({
      animateFrom: prevTurn,
      rolling: result.event ? { value: result.event.dieRoll } : null,
    });
  });
  host.querySelector('#turn-tracker').addEventListener('click', () => {
    openTurnClockModal();
  });
  // HF4: a turn is "operation, then move" OR "move, then operation"
  // - never split around the move. So the move stays reversible right
  // up until end-turn commits. The 🛸 button toggles between "Move"
  // and "↩ Undo move" based on whether the per-turn move budget has
  // been spent. End turn refills the budget, which calls back here
  // via onTurnChange and resets the button to "Move".
  const moveBtn = host.querySelector('#turn-move-rocket');
  function refreshMoveButton() {
    if (!moveBtn) return;
    const remaining = getMovesRemaining();
    if (remaining > 0) {
      moveBtn.textContent = '🛸 Move to';
      moveBtn.title = 'Move the rocket one step along its planned route';
      moveBtn.setAttribute('aria-label', 'Move rocket');
      moveBtn.dataset.state = 'move';
    } else {
      moveBtn.textContent = '↩ Undo';
      moveBtn.title = 'Undo move (operations can happen before OR after the move, not in the middle)';
      moveBtn.setAttribute('aria-label', 'Undo move');
      moveBtn.dataset.state = 'undo';
    }
  }
  refreshMoveButton();
  onTurnChange(refreshMoveButton);
  // Per-turn budget tags [op:N] [move:N] in the toolbar. Live-
  // update on any consume / refund / turn rollover (all route
  // through turn-clock's notify -> onTurnChange).
  const opTag = host.querySelector('#turn-tag-op');
  const moveTag = host.querySelector('#turn-tag-move');
  function refreshTurnBudget() {
    const ops = getOpsRemaining();
    const moves = getMovesRemaining();
    if (opTag) {
      opTag.textContent = `op:${ops}`;
      opTag.classList.toggle('is-spent', ops <= 0);
    }
    if (moveTag) {
      moveTag.textContent = `move:${moves}`;
      moveTag.classList.toggle('is-spent', moves <= 0);
    }
  }
  refreshTurnBudget();
  onTurnChange(refreshTurnBudget);
  // Tapping the op tag opens the operations menu - the player's
  // main aid for deciding what to spend their op on this turn.
  if (opTag) {
    opTag.style.cursor = 'pointer';
    opTag.title = 'Operations remaining - tap for the operations menu';
    opTag.addEventListener('click', openOpsMenu);
  }
  if (moveTag) {
    moveTag.style.cursor = 'pointer';
    moveTag.title = 'Moves remaining - tap for the operations menu';
    moveTag.addEventListener('click', openOpsMenu);
  }
  moveBtn.addEventListener('click', () => {
    if (moveBtn.dataset.state === 'undo') undoRocketMove();
    else                                  moveRocket();
  });
  // Aqua balance chip - live-updates on any spend / income so the
  // player sees the number tick down when a hazard bypass or an
  // aqua → water transfer commits.
  const aquaChipBal = host.querySelector('#aqua-chip-balance');
  if (aquaChipBal) {
    const refreshAqua = () => { aquaChipBal.textContent = String(getAqua()); };
    refreshAqua();
    onAquaChange(refreshAqua);
  }
  host.querySelector('#dbg-close').addEventListener('click', () => {
    host.querySelector('#map-debug').classList.add('hidden');
    try { localStorage.setItem(STORAGE_DBG_PANEL_OPEN, '0'); }
    catch { /* private mode */ }
    if (_renderer) _renderer.setOption('debug', false);
  });
  wireSearch(host);
  // Toolbar height drives where the side panel starts (panel is
  // top: var(--toolbar-h) so it sits flush below the toolbar
  // regardless of whether the toolbar has wrapped to a second row
  // on narrow viewports). Publish the measured height to the
  // browse shell so the CSS variable is in-scope for the sidepanel.
  const toolbarEl = host.querySelector('.map-toolbar');
  const shellEl   = host.closest('.browse-shell') || host;
  if (toolbarEl && shellEl && typeof ResizeObserver !== 'undefined') {
    const publishToolbarHeight = () => {
      const h = toolbarEl.getBoundingClientRect().height;
      shellEl.style.setProperty('--toolbar-h', `${Math.ceil(h)}px`);
    };
    publishToolbarHeight();
    new ResizeObserver(publishToolbarHeight).observe(toolbarEl);
  }
  document.addEventListener('fullscreenchange', () => {
    const btn = host.querySelector('#route-fullscreen');
    if (btn) btn.textContent = document.fullscreenElement ? '⤬' : '⛶';
  });
}

// Hook the debug-panel widgets to whichever renderer is currently
// active. Called from mountMapFor() each time the renderer is
// (re)built, so the panel's bound to the live instance.
// Persists every slider + checkbox to localStorage so the
// player's tweaks survive a reload - same pattern as the route
// priority above. Empty / out-of-range stored values fall back
// to the renderer's defaults.
const STORAGE_DBG_INIT_ZOOM   = 'hf-sandbox-map-init-zoom';
const STORAGE_DBG_FADE_MIN    = 'hf-sandbox-map-fade-min';
const STORAGE_DBG_FADE_MAX    = 'hf-sandbox-map-fade-max';
const STORAGE_DBG_SHOW_DECOR  = 'hf-sandbox-map-show-decoratives';
const STORAGE_DBG_PANEL_OPEN  = 'hf-sandbox-map-debug-open';
function persistDbg(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* private mode */ }
}
function loadDbgNumber(key, fallback, min, max) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    if (min != null && n < min) return fallback;
    if (max != null && n > max) return fallback;
    return n;
  } catch { return fallback; }
}
function loadDbgBool(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return raw === '1' || raw === 'true';
  } catch { return fallback; }
}
function wireDebugPanel(renderer) {
  const panel = document.getElementById('map-debug');
  if (!panel) return;
  const zoomEl    = panel.querySelector('#dbg-zoom');
  const fpsEl     = panel.querySelector('#dbg-fps');
  const initZoom  = panel.querySelector('#dbg-init-zoom');
  const fadeMin   = panel.querySelector('#dbg-fade-min');
  const fadeMax   = panel.querySelector('#dbg-fade-max');
  const initZoomVal = panel.querySelector('#dbg-init-zoom-val');
  const fadeMinVal  = panel.querySelector('#dbg-fade-min-val');
  const fadeMaxVal  = panel.querySelector('#dbg-fade-max-val');
  const showDec   = panel.querySelector('#dbg-show-decoratives');
  const resetBtn  = panel.querySelector('#dbg-reset');

  // Seed the renderer with any persisted values BEFORE we read
  // them back into the slider UI. Range bounds match the
  // HTML inputs (initialZoom 0.5-6, fade 0.5-6) so a corrupted
  // entry can't push the renderer out of band.
  const storedInit = loadDbgNumber(STORAGE_DBG_INIT_ZOOM, renderer.options.initialZoom, 0.5, 6);
  const storedFmin = loadDbgNumber(STORAGE_DBG_FADE_MIN,  renderer.options.labelFadeMin, 0.5, 6);
  const storedFmax = loadDbgNumber(STORAGE_DBG_FADE_MAX,  renderer.options.labelFadeMax, 0.5, 6);
  const storedDec  = loadDbgBool  (STORAGE_DBG_SHOW_DECOR, renderer.options.showDecoratives);
  renderer.setOption('initialZoom',     storedInit);
  renderer.setOption('labelFadeMin',    storedFmin);
  renderer.setOption('labelFadeMax',    storedFmax);
  renderer.setOption('showDecoratives', storedDec);

  initZoom.value = renderer.options.initialZoom;
  fadeMin.value  = renderer.options.labelFadeMin;
  fadeMax.value  = renderer.options.labelFadeMax;
  initZoomVal.textContent = Number(initZoom.value).toFixed(1) + 'x';
  fadeMinVal.textContent  = Number(fadeMin.value).toFixed(1) + 'x';
  fadeMaxVal.textContent  = Number(fadeMax.value).toFixed(1) + 'x';
  showDec.checked = renderer.options.showDecoratives;

  initZoom.oninput = () => {
    const v = Number(initZoom.value);
    renderer.setOption('initialZoom', v);
    initZoomVal.textContent = v.toFixed(1) + 'x';
    persistDbg(STORAGE_DBG_INIT_ZOOM, v);
  };
  fadeMin.oninput = () => {
    const v = Number(fadeMin.value);
    renderer.setOption('labelFadeMin', v);
    fadeMinVal.textContent = v.toFixed(1) + 'x';
    persistDbg(STORAGE_DBG_FADE_MIN, v);
  };
  fadeMax.oninput = () => {
    const v = Number(fadeMax.value);
    renderer.setOption('labelFadeMax', v);
    fadeMaxVal.textContent = v.toFixed(1) + 'x';
    persistDbg(STORAGE_DBG_FADE_MAX, v);
  };
  showDec.onchange = () => {
    renderer.setOption('showDecoratives', showDec.checked);
    persistDbg(STORAGE_DBG_SHOW_DECOR, showDec.checked ? '1' : '0');
  };
  resetBtn.onclick = () => {
    // Reset returns the renderer to its fit-to-data + default
    // options. We mirror that by clearing the stored slider
    // values so the next reload starts clean too.
    renderer.reset();
    try {
      localStorage.removeItem(STORAGE_DBG_INIT_ZOOM);
      localStorage.removeItem(STORAGE_DBG_FADE_MIN);
      localStorage.removeItem(STORAGE_DBG_FADE_MAX);
      localStorage.removeItem(STORAGE_DBG_SHOW_DECOR);
    } catch { /* private mode */ }
  };

  // Restore the persisted open / closed state for the debug
  // panel. wireDebugPanel runs every time the renderer is
  // rebuilt, so this also re-applies on mode toggles. If no
  // value was stored, we default to closed (the HTML class
  // already has .hidden in that case).
  const storedOpen = loadDbgBool(STORAGE_DBG_PANEL_OPEN, false);
  panel.classList.toggle('hidden', !storedOpen);
  const panelOpen = !panel.classList.contains('hidden');
  renderer.setOption('debug', panelOpen);

  let lastZoom = -1, lastFps = -1;
  renderer.onFrame(() => {
    const z = Math.round(renderer.getZoom() * 100) / 100;
    if (z !== lastZoom) { zoomEl.textContent = z.toFixed(2) + 'x'; lastZoom = z; }
    const f = renderer.getFps();
    if (f !== lastFps) { fpsEl.textContent = String(f); lastFps = f; }
  });
}

// Site search with reactive suggestions. Each keystroke filters the
// active dataset's named sites; the dropdown shows up to 8 matches
// ranked with starts-with first. Pressing Enter or the 🔍 button
// flies the renderer to the top hit at zoom 5. Suggestions hide
// when the user clicks outside the search area.
const SEARCH_FLY_ZOOM = 5;

function wireSearch(host) {
  const input    = host.querySelector('#map-search-input');
  const goBtn    = host.querySelector('#map-search-go');
  const list     = host.querySelector('#map-search-suggestions');
  const toggle   = host.querySelector('#map-search-toggle');
  const closeBtn = host.querySelector('#map-search-close');
  const backdrop = host.querySelector('#map-search-backdrop');
  const searchEl = host.querySelector('.map-search');
  if (!input || !goBtn || !list) return;
  let activeIndex = -1;
  let currentItems = [];

  // Mobile: search lives in a modal triggered by the toolbar 🔍 button.
  // CSS hides .map-search by default at <720px and shows it as a fixed
  // modal when .is-open is set. Desktop ignores all of this - the inline
  // search stays in the toolbar and the toggle/close/backdrop are hidden.
  function openSearchModal() {
    searchEl?.classList.add('is-open');
    backdrop?.classList.remove('hidden');
    // Defer focus so the keyboard pops AFTER layout settles.
    setTimeout(() => input.focus(), 0);
  }
  function closeSearchModal() {
    searchEl?.classList.remove('is-open');
    backdrop?.classList.add('hidden');
    list.classList.add('hidden');
  }
  toggle?.addEventListener('click', () => {
    if (searchEl?.classList.contains('is-open')) closeSearchModal();
    else openSearchModal();
  });
  closeBtn?.addEventListener('click', closeSearchModal);
  backdrop?.addEventListener('click', closeSearchModal);

  function searchSites(q) {
    if (!_activeData || !q) return [];
    const ql = q.toLowerCase().trim();
    if (!ql) return [];
    const startsWith = [];
    const includes   = [];
    for (const s of _activeData.sites) {
      if (s.isWaypoint || !s.name) continue;
      const nl = s.name.toLowerCase();
      if (nl.startsWith(ql))       startsWith.push(s);
      else if (nl.includes(ql))    includes.push(s);
      if (startsWith.length + includes.length >= 32) break;
    }
    return startsWith.concat(includes).slice(0, 8);
  }

  function renderList(items) {
    currentItems = items;
    activeIndex = items.length ? 0 : -1;
    list.innerHTML = '';
    if (!items.length) { list.classList.add('hidden'); return; }
    items.forEach((s, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<strong></strong> <em></em>`;
      li.querySelector('strong').textContent = s.name;
      li.querySelector('em').textContent = s.type;
      li.classList.toggle('active', i === activeIndex);
      li.addEventListener('mousedown', (e) => {
        // mousedown not click so the input doesn't blur before we
        // can read the selection.
        e.preventDefault();
        pickItem(s);
      });
      list.appendChild(li);
    });
    list.classList.remove('hidden');
  }

  function updateActive() {
    [...list.children].forEach((li, i) => {
      li.classList.toggle('active', i === activeIndex);
    });
  }

  function pickItem(site) {
    if (!site || !_renderer) return;
    _renderer.flyTo(site, locateZoom(SEARCH_FLY_ZOOM));
    input.value = site.name;
    list.classList.add('hidden');
    closeSearchModal();
  }

  function commit() {
    const hit = activeIndex >= 0 ? currentItems[activeIndex] : currentItems[0];
    if (hit) pickItem(hit);
  }

  input.addEventListener('input', () => {
    renderList(searchSites(input.value));
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (currentItems.length) {
        activeIndex = (activeIndex + 1) % currentItems.length;
        updateActive();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (currentItems.length) {
        activeIndex = (activeIndex - 1 + currentItems.length) % currentItems.length;
        updateActive();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      list.classList.add('hidden');
      if (searchEl?.classList.contains('is-open')) closeSearchModal();
    }
  });
  input.addEventListener('focus', () => {
    if (input.value) renderList(searchSites(input.value));
  });
  goBtn.addEventListener('click', commit);

  // Outside-click closes the dropdown.
  document.addEventListener('mousedown', (e) => {
    if (!host.querySelector('.map-search').contains(e.target)) {
      list.classList.add('hidden');
    }
  });
}

// Wire ResizeObservers on the bottom hand strip and the right
// sidebar so the renderer's logical centre stays at the midpoint of
// the unobstructed canvas region. Without this, opening the side
// panel (or dragging the hand strip taller) leaves the focused body
// hidden under the panel - the canvas itself doesn't reflow because
// both elements are absolute-positioned overlays on top of the map.
// Mobile (max-width: 720px) ignores the right inset because the
// sidepanel collapses into a centred modal there instead of an edge
// panel that visibly steals canvas width.
let _insetsWired = false;
function wireMapInsets(renderer) {
  if (typeof ResizeObserver === 'undefined') return;
  const hand    = document.getElementById('sandbox-hand');
  const sidebar = document.getElementById('browse-sidepanel');
  const mobileMQ = window.matchMedia('(max-width: 720px)');
  // apply() always reads the live _renderer (the module-level
  // singleton), so observers wired the first time keep working
  // across re-mounts without us holding a stale renderer reference.
  const apply = () => {
    const r = _renderer;
    if (!r) return;
    const isMobile = mobileMQ.matches;
    const handH    = hand    ? hand.getBoundingClientRect().height    : 0;
    const sideW    = sidebar ? sidebar.getBoundingClientRect().width  : 0;
    r.setInsets({
      bottom: handH,
      right:  isMobile ? 0 : sideW,
    });
  };
  if (!_insetsWired) {
    _insetsWired = true;
    if (hand)    new ResizeObserver(apply).observe(hand);
    if (sidebar) new ResizeObserver(apply).observe(sidebar);
    if (mobileMQ.addEventListener) mobileMQ.addEventListener('change', apply);
    else if (mobileMQ.addListener) mobileMQ.addListener(apply);
  }
  apply();
}

// Promote the map host into the browser's fullscreen mode. The
// ResizeObserver in the renderer picks up the new dimensions and
// re-fits the canvas. Falls back gracefully on browsers without
// the Fullscreen API.
function toggleFullscreen(host) {
  if (document.fullscreenElement) {
    document.exitFullscreen?.();
    return;
  }
  const req = host.requestFullscreen
    || host.webkitRequestFullscreen
    || host.mozRequestFullScreen;
  if (req) req.call(host).catch(() => {});
}

async function mountMapFor() {
  const host = document.getElementById('browse-map');
  const canvas = host.querySelector('#browse-map-canvas');
  canvas.innerHTML = '<div class="map-loading">Loading map…</div>';
  _renderer = null;
  _routeFrom = null;
  _routeTo = null;
  updateRouteStatus();
  try {
    _activeData = await loadMap();
    soloBindData(_activeData);
    _renderer = new MapRenderer(canvas, {
      data: _activeData,
      onSelect: onSiteSelect,
    });
    _renderer.onSandboxRocketClick = () => openRocketStackModal();
    wireDebugPanel(_renderer);
    wireMapInsets(_renderer);
    syncSoloShipMarker();
    syncSandboxRocket();
    syncDiscs();
    // Stage-3: push initial chit + focus state to the freshly-
    // built renderer so factories / colonies / outposts paint
    // on first frame (instead of waiting for the first state
    // change to fire the subscribers).
    syncFactories();
    syncColonies();
    syncOutposts();
    syncFocusedSite();
    // Initial camera: focus on the rocket's current site if the
    // player has built a stack, else LEO. Snap instantly (ms: 0)
    // because the user can't see the pre-mount state - animating
    // from a default fit-to-data position would just be a brief
    // flash. Uses the renderer's own initialZoom (which is
    // already device-aware: 5 on mobile, 6 on desktop).
    const initialFocus = getRocketSite() || LEO_ANCHOR;
    if (initialFocus && Number.isFinite(initialFocus.x) && Number.isFinite(initialFocus.y)) {
      _renderer.flyTo(initialFocus, _renderer.options.initialZoom, { ms: 0 });
    }
    // Push any persisted trail back into the renderer so a reload
    // mid-journey still shows the cyan ribbon for where the rocket
    // has already been.
    if (_rocketTrail && _rocketTrail.length) {
      _renderer.setRocketTrail(_rocketTrail);
    }
    // Restore the multi-turn planned route. Validate every segment
    // resolves in the active data set; if the dataset shape changed
    // (e.g. planner-map regeneration) drop the route so we don't
    // hand the renderer dangling ids that would draw to (0, 0).
    if (_plannedRoute && _plannedRoute.length) {
      const allValid = _plannedRoute.every((seg) =>
        _activeData.sites.find((s) => s.id === seg.from) &&
        _activeData.sites.find((s) => s.id === seg.to)
      );
      if (allValid) {
        _renderer.setRoute(_plannedRoute);
        const first = _plannedRoute[0];
        const last  = _plannedRoute[_plannedRoute.length - 1];
        _renderer.setRouteEndpoints(first.from, last.to);
        const fromSite = _activeData.sites.find((s) => s.id === first.from);
        const destSite = _activeData.sites.find((s) => s.id === last.to);
        _routeFrom = fromSite || null;
        _routeTo   = destSite || null;
        const clearBtn = document.getElementById('route-clear');
        if (clearBtn) clearBtn.hidden = false;
        if (destSite) {
          const burns = _plannedRoute.reduce((s, x) => s + (x.burns || 1), 0);
          const turns = _plannedRoute.reduce((m, x) => Math.max(m, x.turn || 1), 1);
          setStatus(
            `🛸 Resumed route to <strong>${esc(destSite.name)}</strong>: `
            + `<strong class="big">${burns}</strong> burns over `
            + `<strong>${turns}</strong> turn${turns === 1 ? '' : 's'}.`
          );
        }
      } else {
        _plannedRoute = null;
        persistPlannedRoute();
      }
    }
  } catch (err) {
    canvas.innerHTML = `<div class="map-loading error">Map failed to load: ${err.message}</div>`;
  }
}

// Paint the sandbox rocket on the map at LEO. Position is a
// fixed world-space coord that visually reads as "above Earth"
// on the cleaned-up zone-band layout. Colour stays yellow for
// now - multiplayer Stage 3 will pick from the 5-colour palette
// per player. canFly is recomputed from rocket.js on every
// rocket-state change.
// Centered modal that shows the rocket's stack - replaces the
// old sidepanel "rocket" pane. Same data, same actions (pull a
// card back to the hand), just opens in the middle of the map
// like the other inspect modals. Press × or Esc to dismiss.
function openRocketStackModal() {
  // Close any existing instance first so the modal doesn't
  // stack up if the player clicks the rocket twice fast.
  document.querySelector('.rocket-stack-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay rocket-stack-overlay';
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (_rocketModalUnsub) { _rocketModalUnsub(); _rocketModalUnsub = null; }
  };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const panel = document.createElement('div');
  panel.className = 'rocket-stack-panel';
  overlay.appendChild(panel);

  const xBtn = document.createElement('button');
  xBtn.type = 'button';
  xBtn.className = 'modal-x';
  xBtn.textContent = '×';
  xBtn.title = 'Close (Esc)';
  xBtn.addEventListener('click', close);
  panel.appendChild(xBtn);

  // Engagement is a transient UI flag - the player presses
  // "Engage" once supports are met to trigger the moving-rocket
  // animation. Any stack change (add / remove / re-pick active)
  // resets it so a freshly-flyable stack still needs the user to
  // confirm "yes, engage" before the animation runs.
  let engaged = false;
  // Transient selection set for the Transfer section. Cards
  // marked here can be shipped to a colocated stack (LEO if
  // at LEO; outposts at the rocket's current site). Cleared
  // when cards leave the stack (e.g. moved out by a transfer
  // or popped back to hand via the existing ↩ button).
  const selected = new Set();
  const repaint = () => {
    const stack = getRocketStack();
    const r = isRocketActive();
    const activeId = getActiveThrusterId();
    // The active thruster's "supplied" set is what the rest of
    // the stack contributes - used both by isRocketActive() and
    // by renderCard() to mark each support chip ✓.
    const supplied = new Set();
    for (const s of stack) {
      if (s.id === activeId) continue;
      const c = lookup(s.id);
      if (!c) continue;
      const sup = (c.faces && c.faces.primary && c.faces.primary.supplies) || c.supplies || [];
      for (const k of sup) supplied.add(k);
    }
    // Engagement is meaningless when supports aren't satisfied -
    // clear the flag so the button text + animation don't lie if
    // the player removes a card mid-flight.
    if (!r.active) engaged = false;
    const totals = getStackTotals();
    const thrStats = getActiveThrusterStats();
    // Preserve the scroll position across the rebuild so tapping
    // a button / card in the stack never jumps the list to the
    // top.
    const prevBody = panel.querySelector('.rocket-stack-body');
    const prevScroll = prevBody ? prevBody.scrollTop : 0;
    prevBody?.remove();
    // Engaged-border is painted by the panel (non-scrolling)
    // so it doesn't fragment when the body's content overflows.
    panel.classList.toggle('is-engaged', engaged && r.active);
    const body = document.createElement('div');
    body.className = 'rocket-stack-body';
    // Status banner: active + green when all three rules hold,
    // grounded + red otherwise with the specific reason inline.
    const status = r.active
      ? '<p class="rocket-status ok">✓ Active - rocket can move.</p>'
      : `<p class="rocket-status bad">🚫 Inactive - ${esc(r.reason)}.</p>
         ${r.missing.length
           ? `<ul class="rocket-issues">${r.missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>`
           : ''}`;

    // Totals row. Reorganized to surface the modified-thrust
    // triangle on the LEFT as the headline visual (the player
    // reads thrust-vs-wet-mass off it at a glance), with the
    // numeric cells stacked next to it. Fuel +/- buttons are
    // gone - refueling is the legitimate way to add water now;
    // the water droplet sits inside the wet-mass cell so the
    // current fuel value reads alongside the mass it's pushing.
    const fmt = (n) => Number.isFinite(n) ? (Math.round(n * 100) / 100) : '-';
    const tank = getTankWater();
    const tankMax = getTankMax();
    const fuelCapForRocket = Math.max(0, 32 - (totals.dryMass || 0));
    const modifierLines = thrStats && thrStats.modifiers.length
      ? thrStats.modifiers.map((m) => {
          if (m.kind === 'thrust') return `${m.delta > 0 ? '+' : ''}${m.delta} thrust from ${m.from}`;
          if (m.kind === 'fuel')   return `×${m.mult} fuel from ${m.from}`;
          return '';
        }).filter(Boolean).join(' · ')
      : '';
    // Per-cell formula text - shown in the "details" footer of
    // each profile card cell. Keep them short; the data-tip on
    // hover spells out the full story for power users.
    // Thrust equation: `base + N (class) → final` matches the
    // player's mental model - start from base, apply the net
    // modifier (cards + weight class), get the final number.
    let thrustEqn = '';
    if (thrStats) {
      const totalMod = thrStats.thrust - thrStats.baseThrust;
      const cls = String(thrStats.weightClass || '').toLowerCase();
      if (totalMod !== 0) {
        const sign = totalMod > 0 ? '+' : '−';
        thrustEqn = `base ${sign} ${fmt(Math.abs(totalMod))} (${cls}) → ${fmt(thrStats.thrust)}`;
      } else {
        thrustEqn = `base (${cls}) → ${fmt(thrStats.thrust)}`;
      }
    }
    const fuelEqn = (thrStats && thrStats.fuel != null && thrStats.fuel !== thrStats.baseFuel)
      ? `base ${fmt(thrStats.baseFuel)} → ${fmt(thrStats.fuel)} water/move`
      : (thrStats && thrStats.fuel != null ? 'water per move' : '');
    const thrustHtml = thrStats
      ? `<div class="rocket-totals-cell"
              data-tip="Thrust = base ${fmt(thrStats.baseThrust)} ${modifierLines ? '+ ' + modifierLines : ''}. Net thrust must be ≥ wet mass to lift."
              title="Modified thrust breakdown">
           <span class="lbl">Thrust</span>
           <strong class="${thrStats.canLift ? 'ok' : 'bad'}">${fmt(thrStats.thrust)}</strong>
           <small class="cell-eqn">${esc(thrustEqn)}</small>
         </div>
         <div class="rocket-totals-cell"
              data-tip="Fuel per burn = ${fmt(thrStats.fuel)} water per move."
              title="Fuel per burn">
           <span class="lbl">Fuel / burn</span>
           <strong>${thrStats.fuel != null ? fmt(thrStats.fuel) : '-'}</strong>
           <small class="cell-eqn">${esc(fuelEqn)}</small>
         </div>`
      : '';
    // Afterburn toggle - only shown when the active thruster has
    // an afterburn capability. Engaging spends fuel up front, so
    // the click handler runs through a confirm.
    const afterburnHtml = (thrStats && thrStats.afterburnAvailable)
      ? `<button type="button" class="rocket-afterburn-btn ${thrStats.afterburnEngaged ? 'is-engaged' : ''}"
           id="rocket-afterburn"
           title="${thrStats.afterburnEngaged
             ? 'Afterburn engaged this turn - tap to disengage'
             : 'Engage afterburn: spends fuel for bonus thrust this turn'}">
           🔥 Afterburn ${thrStats.afterburnEngaged ? 'ON' : 'OFF'}
         </button>` : '';
    // Wet mass equation - "dry + tank" so the player sees how
    // the wet number was built. Caps the tank value at the
    // fuel capacity for the rocket.
    const wetEqn = totals.dryMass != null
      ? `dry ${totals.dryMass} + tank ${tank}`
      : '';
    const totalsHtml = `
      <div class="rocket-totals">
        ${thrStats ? `
          <div class="rocket-profile-triangle">
            <span class="rocket-profile-triangle-label">Modified thrust</span>
            <div id="rocket-thrust-visual" class="rocket-totals-headliner"></div>
            <small class="rocket-profile-triangle-sub">${esc(modifierLines || 'no modifiers')}</small>
          </div>` : ''}
        <div class="rocket-totals-grid">
          <div class="rocket-totals-cell">
            <span class="lbl">Cards</span>
            <strong>${totals.count}</strong>
            <small class="cell-eqn">in stack</small>
          </div>
          <div class="rocket-totals-cell">
            <span class="lbl">Dry mass</span>
            <strong>${totals.dryMass}</strong>
            <small class="cell-eqn">card mass sum</small>
          </div>
          <div class="rocket-totals-cell rocket-wetmass-cell"
               role="button" tabindex="0"
               data-tip="Tap to open the fuel-tank view (max wet mass 32)"
               title="Tap to open the fuel-tank view (max wet mass 32)">
            <span class="lbl">Wet mass</span>
            <strong class="${thrStats && !thrStats.canLift ? 'bad' : ''}">${totals.wetMass}<small>/32</small></strong>
            <small class="cell-eqn">${esc(wetEqn)} · 💧 ${tank}/${fuelCapForRocket}</small>
          </div>
          <div class="rocket-totals-cell">
            <span class="lbl">Min rad-hard</span>
            <strong>${totals.minRadHard != null ? totals.minRadHard : '-'}</strong>
            <small class="cell-eqn">weakest card</small>
          </div>
          ${thrustHtml}
          ${afterburnHtml ? `<div class="rocket-totals-cell rocket-afterburn-cell">${afterburnHtml}</div>` : ''}
        </div>
      </div>
    `;

    // Locate / select-current-site buttons (top of the header).
    // "Find rocket" pans the camera to the sprite without
    // opening a popup; "Select site" (or "Select node" when the
    // rocket is parked on a routing waypoint) closes the modal,
    // pans the camera, and pops the site popup so the player can
    // immediately fire prospect / refuel / route from the
    // current location without hunting for it on the map.
    const here = getRocketSite();
    const hereIsSite = here && !here.isWaypoint
      && !['lagrange', 'burn', 'hohmann', 'decorative', 'radhaz'].includes(here.type);
    const hereLabel = hereIsSite ? 'Select site' : 'Select node';
    const hereDisabled = !here ? 'disabled' : '';
    body.innerHTML = `
      <div class="rocket-stack-header">
        <div class="rocket-stack-title-row">
          <h2 class="rocket-stack-title">🚀 LEO Rocket</h2>
          <div class="rocket-stack-locate">
            <button type="button" class="popup-btn popup-btn-secondary"
              id="rocket-find" ${hereDisabled}
              title="Pan the map to the rocket sprite">📍 Find rocket</button>
            <button type="button" class="popup-btn popup-btn-secondary"
              id="rocket-select-here" ${hereDisabled}
              title="Open the popup for the site / node the rocket is on">🎯 ${hereLabel}</button>
          </div>
        </div>
        ${totalsHtml}
        <div id="rocket-fuel-strip" class="rocket-fuel-strip"></div>
        ${status}
      </div>
      <div id="rocket-stack-cards">
        <div class="rocket-stack-row thrusters" id="rocket-stack-thrusters"></div>
        <div class="rocket-stack-row others" id="rocket-stack-others"></div>
      </div>
      <!-- Transfer section: shown when colocated stacks exist
           (LEO at LEO, outposts at the same site). Populated by
           the rocket-modal repaint loop. -->
      <div id="rocket-stack-transfer"></div>
    `;
    panel.appendChild(body);

    // Find / select wiring.
    const findBtn = body.querySelector('#rocket-find');
    if (findBtn) findBtn.addEventListener('click', () => {
      if (!here || !_renderer) return;
      close();
      _renderer.flyTo(here, locateZoom(4));
    });
    const selectBtn = body.querySelector('#rocket-select-here');
    if (selectBtn) selectBtn.addEventListener('click', () => {
      if (!here || !_renderer) return;
      close();
      _renderer.flyTo(here, locateZoom(4));
      onSiteSelect(here);
    });

    // Fuel-strip diagram. Mirrors the published Net Thrust track:
    // cells 1..32 coloured by weight class (WISP / PROBE / SCOUT /
    // TRANSPORT / TUG) with chits drawn for the rocket's current
    // dry-mass + wet-mass positions. Each cell is hoverable for
    // its weight-class modifier. Future iterations can wire drag
    // to relocate chits + react to factory refuel patterns.
    const stripHost = body.querySelector('#rocket-fuel-strip');
    if (stripHost) buildFuelStrip(stripHost, totals);

    // Afterburn toggle. Confirms before engaging (spends fuel up
    // front per the rulebook's "Afterburn (+ thrust for 2 fuel
    // steps shown)" cost). Disengaging is free.
    const abBtn = body.querySelector('#rocket-afterburn');
    if (abBtn && thrStats) {
      abBtn.addEventListener('click', async () => {
        if (thrStats.afterburnEngaged) {
          setAfterburn(false);
          logAction({ type: 'afterburn', icon: '🔥', summary: 'Afterburn disengaged', undoable: false });
          return;
        }
        // Confirm. Default afterburn cost = 2 water tanks (the
        // "2 fuel steps shown" wording in the rulebook). Bail
        // when the tank can't cover it.
        const cost = 2;
        if (getTankWater() < cost) {
          setStatus(`Afterburn needs ${cost} water; tank has ${getTankWater()}.`);
          return;
        }
        const ok = await confirmModal({
          title: '🔥 Engage afterburn?',
          body: `Spends ${cost} water now for a +${(thrStats.card?.faces?.primary?.afterburn) || 1} `
            + `thrust boost this turn. Disengage manually next turn.`,
          yes: 'Engage',
          no: 'Cancel',
        });
        if (!ok) return;
        removeFuel(cost);
        setAfterburn(true);
        logAction({
          type: 'afterburn',
          icon: '🔥',
          summary: `Afterburn engaged (-${cost} water)`,
          undoable: false,
        });
      });
    }

    // "Modified final" thrust triangle - shows the active
    // thruster with modifier-applied thrust + fuel numbers
    // baked in (instead of the base values painted on the
    // card). Reuses card-ui.thrustVisual via a synthetic face
    // so the silhouette + arrow / droplet idiom is identical
    // to the cards.
    const thrustHost = body.querySelector('#rocket-thrust-visual');
    if (thrustHost && thrStats) {
      const card = PATENTS_BY_ID[thrStats.cardId] || null;
      const baseFace = (card && card.faces && card.faces.primary) || card || {};
      const syntheticFace = {
        ...baseFace,
        thrust: thrStats.thrust,
        fuel:   thrStats.fuel,
        // Keep the original afterburn / fuelType so the icons
        // (🔥 / 💧 / 🪨) stay accurate; only thrust + fuel are
        // overridden with the modified numbers.
      };
      // Build per-element breakdown text so tapping the 11 inside
      // the pink circle pops "11 = 6 base + 3 reactor mod + 2
      // WISP mass class" - the exact "where did each number come
      // from" trail the player wants. Fuel + afterburn glyphs get
      // their own tap-tips below.
      const thrustParts = [`${fmt(thrStats.baseThrust)} base`];
      const fuelParts   = [`${fmt(thrStats.baseFuel)} base`];
      for (const m of thrStats.modifiers) {
        if (m.kind === 'thrust') {
          thrustParts.push(`${m.delta > 0 ? '+' : ''}${fmt(m.delta)} ${m.from}`);
        } else if (m.kind === 'fuel') {
          fuelParts.push(`×${fmt(m.mult)} ${m.from}`);
        }
      }
      const breakdown = {
        thrust: `Thrust ${fmt(thrStats.thrust)} = ${thrustParts.join(' ')}`,
        fuel:   `Fuel per burn ${fmt(thrStats.fuel)} = ${fuelParts.join(' ')}`,
      };
      const abVal = baseFace.afterburn;
      if (Number.isFinite(abVal) && abVal > 0) {
        breakdown.afterburn = thrStats.afterburnEngaged
          ? `🔥 Afterburn ENGAGED - +${abVal} thrust this turn (cost 2 water already spent)`
          : `🔥 Afterburn: spend 2 water for +${abVal} thrust this turn`;
      }
      const tv = thrustVisual(card || {}, syntheticFace, { breakdown });
      // Wrap-level tip too, for tapping the triangle outside any
      // specific element (whitespace inside the SVG).
      tv.dataset.tip = `${breakdown.thrust}. ${breakdown.fuel}.`;
      thrustHost.appendChild(tv);
      // Wire the [data-tip] hover + tap-to-show tooltips on the
      // freshly-inserted SVG so clicking the thrust circle / fuel
      // droplet / afterburn flame pops the per-element breakdown.
      attachTipsTo(tv);
    }

    // Wet-mass cell is clickable: pops the fuel-tank visual in
    // its "view current state" mode (no animation - fromWater
    // omitted defaults to the live tank reading).
    const wmCell = body.querySelector('.rocket-wetmass-cell');
    if (wmCell) {
      const openTank = () => openFuelTankModal();
      wmCell.addEventListener('click', openTank);
      wmCell.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTank(); }
      });
    }

    // Engage button: greyed out until supports are satisfied; tap
    // to ignite the moving-rocket animation. Lives in the pinned
    // header so it stays on screen even on a tall stack.
    const engageBtn = document.createElement('button');
    engageBtn.type = 'button';
    engageBtn.className = 'rocket-engage' + (engaged ? ' is-engaged' : '');
    engageBtn.disabled = !r.active;
    engageBtn.textContent = engaged && r.active
      ? '🔥 Engaged - rocket is moving!'
      : r.active ? '🔥 Engage rocket' : '🔥 Engage rocket (supports unmet)';
    engageBtn.addEventListener('click', () => {
      if (!r.active) return;
      engaged = !engaged;
      repaint();
    });
    body.querySelector('.rocket-stack-header').appendChild(engageBtn);

    const cards = body.querySelector('#rocket-stack-cards');
    const thrustersHost = body.querySelector('#rocket-stack-thrusters');
    const othersHost    = body.querySelector('#rocket-stack-others');
    if (!stack.length) {
      cards.innerHTML = '<p class="muted">Your rocket is empty. Mark cards 🚀 in your hand, then press BOOST to launch them up here.</p>';
      return;
    }

    // Pre-compute the set of kinds the active thruster requires -
    // any other card whose supplies intersect this set is an
    // "active supporter" and gets the supporting-card highlight in
    // sync with the thruster's ✓ chips. Robonauts that double as
    // thrusters (card.thrust != null) are treated as thrusters
    // too, both for the top-row layout and for active selection.
    const requiredKinds = new Set();
    if (thrStats) {
      const active = lookup(thrStats.cardId);
      const f = (active && active.faces && active.faces.primary) || active || {};
      const reqs = f.requires || (active && active.requires) || [];
      for (const r of reqs) if (r && r.kind) requiredKinds.add(r.kind);
    }

    stack.forEach((slot, idx) => {
      const card = lookup(slot.id);
      if (!card) return;
      // Crew can serve as the ship's thruster OR its robonaut.
      // Resolve the slot's chosen faction face so its thruster
      // block / prospector kind are recognised here, matching the
      // engine (rocket.js synthesises the same view).
      const crewFace = (slot.kind === 'crew' || CREW.some((c) => c.id === slot.id))
        ? (card.faces && card.faces[slot.face === 'secondary' ? 'secondary' : 'primary'])
        : null;
      const isThruster = card.type === 'thruster' || card.thrust != null
        || !!(crewFace && crewFace.thruster);

      const wrap = document.createElement('div');
      wrap.className = 'rocket-slot';
      if (isThruster && slot.id === activeId) wrap.classList.add('is-active-thruster');
      if (selected.has(slot.id)) wrap.classList.add('is-selected');
      // Non-thruster cards whose supplies satisfy any of the
      // active thruster's requires get an "is-supporting" wash so
      // the player can trace which specific cards are powering
      // their active thruster, not just see the ✓ chips on the
      // thruster card.
      if (!isThruster && requiredKinds.size) {
        const cf = (card.faces && card.faces.primary) || card;
        const supplies = cf.supplies || card.supplies || [];
        if (supplies.some((k) => requiredKinds.has(k))) {
          wrap.classList.add('is-supporting');
        }
      }
      // Only the active thruster's supports are validated against
      // the rest of the stack - passing `supplied` for others would
      // mark chips ✓ that aren't actually contributing to flight.
      // Wire support-chip taps so the player can jump straight
      // from "this thruster needs X" to the library view of every
      // card that supplies X. We close the rocket-stack modal
      // first so the patents pane comes up on a clean surface.
      const cardOpts = { type: slot.kind || 'patent', face: slot.face };
      if (isThruster && slot.id === activeId) cardOpts.supplied = supplied;
      cardOpts.onSupportClick = (kinds) => {
        close();
        openPatentsSupports(kinds);
      };
      wrap.appendChild(renderCard(card, cardOpts));

      const actions = document.createElement('div');
      actions.className = 'rocket-slot-actions';

      // Thrusters get a "Set as active" / "Active" toggle so
      // the player can pick which thruster the rocket runs on.
      // Non-thrusters skip this control.
      if (isThruster) {
        const activate = document.createElement('button');
        activate.type = 'button';
        activate.className = 'rocket-activate'
          + (slot.id === activeId ? ' is-active' : '');
        activate.textContent = slot.id === activeId
          ? '⚡ Active thruster'
          : 'Set as active';
        activate.disabled = slot.id === activeId;
        activate.addEventListener('click', () => setActiveThruster(slot.id));
        actions.appendChild(activate);
      }
      // Prospector toggle - same idiom as the thruster activator.
      // Cards qualify when their active face carries a missile /
      // raygun / buggy property. Clicking sets THIS card as the
      // active prospector for the turn.
      const prospKind = (() => {
        if (crewFace) return crewFace.prospector || null;
        const f = (card.faces && card.faces.primary) || card;
        const props = f.properties || [];
        for (const k of ['raygun', 'missile', 'buggy']) {
          if (props.some((p) => p.key === k && p.value)) return k;
        }
        return null;
      })();
      if (prospKind) {
        const activeProspId = getActiveProspectorId();
        const isActiveProsp = slot.id === activeProspId;
        const glyph = { missile: '🚀', raygun: '🔫', buggy: '🛺' }[prospKind];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'rocket-activate'
          + (isActiveProsp ? ' is-active' : '');
        btn.textContent = isActiveProsp
          ? `${glyph} Active prospector`
          : `Set as ${prospKind} prospector`;
        btn.disabled = isActiveProsp;
        btn.addEventListener('click', () => setActiveProspector(slot.id));
        actions.appendChild(btn);
      }

      // Select toggle for the transfer section. Same idiom as
      // the LEO / Outpost inspector's per-card Select button -
      // tap to mark, tap again to clear; the transfer section
      // below the stack picks up selected ids and offers one
      // "Send → <stack>" button per colocated destination.
      const selBtn = document.createElement('button');
      selBtn.type = 'button';
      selBtn.className = 'rocket-select' + (selected.has(slot.id) ? ' is-on' : '');
      selBtn.textContent = selected.has(slot.id) ? '✓ Selected' : 'Select';
      selBtn.addEventListener('click', () => {
        if (selected.has(slot.id)) selected.delete(slot.id);
        else selected.add(slot.id);
        repaint();
      });
      actions.appendChild(selBtn);

      // Crew never returns to the hand - it can only move stack-
      // to-stack (use Select + Transfer below). Non-crew cards get
      // the "Back to hand" shortcut.
      const isCrewSlot = slot.kind === 'crew' || CREW.some((c) => c.id === slot.id);
      if (!isCrewSlot) {
        const back = document.createElement('button');
        back.type = 'button';
        back.className = 'rocket-back-to-hand';
        back.textContent = '↩ Back to hand';
        back.addEventListener('click', () => {
          selected.delete(slot.id);
          rocketRemoveCard(idx);
          addToHand(card);
        });
        actions.appendChild(back);
      }

      wrap.appendChild(actions);
      // Thrusters (including missile-class robonauts that carry a
      // thrust value) live in the top row; everything else falls
      // through to the lower row.
      (isThruster ? thrustersHost : othersHost).appendChild(wrap);
    });
    // Hide the row containers when empty so we don't leave dead
    // grid space between sections.
    if (!thrustersHost.children.length) thrustersHost.style.display = 'none';
    if (!othersHost.children.length)    othersHost.style.display    = 'none';

    // Prune selections whose cards have left the stack (transfer,
    // back-to-hand, etc) so stale ids don't carry over.
    for (const id of [...selected]) {
      if (!stack.some((s) => s.id === id)) selected.delete(id);
    }

    // Transfer section: lists colocated stacks the rocket can
    // ship selected cards to. Same getColocatedDestinations
    // helper the LEO / Outpost inspectors use, so the rules
    // (rocket at LEO -> can ship to LEO; rocket at site X with
    // outposts -> can ship to those outposts) stay uniform.
    const xferHost = body.querySelector('#rocket-stack-transfer');
    if (xferHost) {
      const dests = getColocatedDestinations('rocket');
      if (dests.length === 0) {
        xferHost.innerHTML = `
          <div class="stack-inspector-transfer empty">
            <h4>🔄 Transfer</h4>
            <p class="muted">No colocated stacks here. Park at LEO or at a site with an outpost to enable transfers.</p>
          </div>`;
      } else {
        const n = selected.size;
        const dh = dests.map((d) =>
          `<button type="button" class="stack-inspector-xfer-btn" data-dest="${esc(d.id)}" ${n === 0 ? 'disabled' : ''}>Send ${n > 0 ? n + ' ' : ''}→ ${esc(d.label)}</button>`
        ).join('');
        xferHost.innerHTML = `
          <div class="stack-inspector-transfer">
            <h4>🔄 Transfer (free action)</h4>
            <p class="muted">Mark cards above with Select, then ship them to a colocated stack. Wet-mass clamps apply on the destination tank.</p>
            <div class="stack-inspector-xfer-row">${dh}</div>
          </div>`;
        xferHost.querySelectorAll('.stack-inspector-xfer-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            const destId = btn.getAttribute('data-dest');
            if (!destId || selected.size === 0) return;
            const toMove = [...selected];
            let moved = 0;
            for (const cardId of toMove) {
              if (transferOneCard('rocket', destId, cardId)) {
                moved++;
                selected.delete(cardId);
              }
            }
            const destMeta = STACK_LABELS[destId] || { name: destId };
            setStatus(`🔄 Transferred <strong>${moved}</strong> card${moved === 1 ? '' : 's'} from <em>Rocket</em> to <em>${esc(destMeta.name)}</em>.`);
            logAction({
              type: 'transfer',
              icon: '🔄',
              summary: `Transferred ${moved} card${moved === 1 ? '' : 's'} from Rocket to ${destMeta.name}`,
              undoable: false,
              data: { source: 'rocket', dest: destId, count: moved },
            });
            repaint();
          });
        });
      }
      // Decommission: return the selected cards to hand (free,
      // any-time). Sits next to the transfer controls and is
      // active only when something is selected. Always present,
      // even when there are no colocated transfer destinations.
      const nSel = selected.size;
      xferHost.insertAdjacentHTML('beforeend',
        `<div class="stack-decommission-row">
           <button type="button" class="modal-btn decommission rocket-decom-btn"
             title="Return the selected cards to your hand" ${nSel ? '' : 'disabled'}>
             ♻ Decommission to hand${nSel ? ` (${nSel})` : ''}</button>
         </div>`);
      const rdecom = xferHost.querySelector('.rocket-decom-btn');
      if (rdecom) {
        rdecom.addEventListener('click', () => {
          if (!selected.size) return;
          decommissionSelectedToHand('rocket', [...selected], repaint);
        });
      }
    }
    // Restore the pre-rebuild scroll position.
    body.scrollTop = prevScroll;
  };
  const lookup = (id) => PATENTS_BY_ID[id]
    || CREW.find((c) => c.id === id) || null;
  repaint();
  // Re-render the rocket modal on any state change that affects
  // its display or the colocated-destination list. Stack changes
  // (cards added / removed) AND outpost / LEO changes (transfer
  // destinations appearing or disappearing) all need to refresh.
  const unsubRocket  = onRocketChange(repaint);
  const unsubLeo     = onLeoChange(repaint);
  const unsubOutpost = onOutpostsChange(repaint);
  _rocketModalUnsub = () => {
    try { unsubRocket(); } catch {}
    try { unsubLeo(); } catch {}
    try { unsubOutpost(); } catch {}
  };

  mountOverlay(overlay);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
}
let _rocketModalUnsub = null;

// Resolve the site the rocket is currently sitting on. Falls back
// to LEO when nothing is stored (fresh session) or when the stored
// id no longer resolves (data set changed). Side-effects: clears
// a stale stored id so subsequent calls don't keep retrying it.
// Glory + log glue used by moveRocket / undoRocketMove. Kept
// in browse.js so glory.js doesn't need to know site shapes.
function isLeoSite(site) {
  return !!site && site.type === 'lagrange' && site.name === 'LEO';
}

// Hazard classification. A node is a "hazard" when entering it
// forces a survival roll (or 4 aqua to bypass). Three flavours
// today, all drawn with their own glyph in render.js:
//   - explicit hazard flag → ☠ skull (burn / lagrange nodes
//     flagged by the planner JSON's `hazard:true`)
//   - radhaz waypoint type → ☢ radiation trefoil
//   - venus waypoint type  → 🪂 aerobrake corridor
// Returns the glyph + a short label so the confirm modal can list
// what the player is about to fly through.
const HAZARD_COST_PER = 4;
function classifyHazard(site) {
  if (!site) return null;
  if (site.type === 'radhaz') return { glyph: '☢', label: 'Radiation hazard' };
  if (site.type === 'venus')  return { glyph: '🪂', label: 'Aerobrake corridor' };
  if (site.hazard)            return { glyph: '☠', label: 'Hazard node' };
  return null;
}
function isHazardSite(site) {
  return classifyHazard(site) !== null;
}

// Walk every endpoint a route's turn-1 segments would touch,
// collecting the distinct hazard sites along the way. We check
// only `to` endpoints (the rocket is leaving `from` and arriving
// at `to`, so the starting node is already paid-for) plus any
// shared intermediate node, deduped by id so a hazard touched by
// two adjacent segments doesn't double-charge.
function routeHazards(segments) {
  if (!_activeData || !segments || !segments.length) return [];
  const seen = new Set();
  const out = [];
  for (const seg of segments) {
    const site = _activeData.sites.find((x) => x.id === seg.to);
    if (!site) continue;
    const h = classifyHazard(site);
    if (!h) continue;
    if (seen.has(site.id)) continue;
    seen.add(site.id);
    out.push({ site, ...h });
  }
  return out;
}

// Once-per-turn flag: a move that was paid-out or rolled for at
// a hazard cannot be undone. Persisted so a reload mid-turn
// preserves the lockout; cleared on end-turn via onTurnChange.
const STORAGE_HAZARDOUS_MOVE = 'hf-sandbox-hazardous-move';
let _lastMoveHazardous = (() => {
  try { return localStorage.getItem(STORAGE_HAZARDOUS_MOVE) === '1'; }
  catch { return false; }
})();
function setHazardousMove(on) {
  _lastMoveHazardous = !!on;
  try {
    if (_lastMoveHazardous) localStorage.setItem(STORAGE_HAZARDOUS_MOVE, '1');
    else                    localStorage.removeItem(STORAGE_HAZARDOUS_MOVE);
  } catch { /* private mode */ }
}
// End-of-turn always clears the lockout - a fresh turn refunds
// the move budget too, but the hazardous flag stays scoped to
// the turn that flew through the hazard.
onTurnChange(() => {
  if (getMovesRemaining() > 0 && _lastMoveHazardous) setHazardousMove(false);
});

// Three-button modal for the "your route crosses hazards" prompt.
// Resolves to one of:
//   'pay'    - player pays HAZARD_COST_PER × N aqua to bypass
//   'roll'   - player rolls a d6 per hazard, no undo allowed
//   'cancel' - back to planning; move not consumed
// Pay button is disabled (but still rendered, with a help line)
// when the balance can't cover the bill. The wording leans hard
// on "cannot be undone" because the rulebook commits the dice as
// soon as they hit the table - same idiom here.
function hazardConfirmModal(hazards) {
  return new Promise((resolve) => {
    document.querySelector('.confirm-modal-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'card-modal-overlay confirm-modal-overlay hazard-confirm-overlay';
    const close = (val) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close('cancel'); });
    const onKey = (e) => {
      if (e.key === 'Escape') close('cancel');
    };
    document.addEventListener('keydown', onKey);

    const n = hazards.length;
    const cost = n * HAZARD_COST_PER;
    const have = getAqua();
    const canPay = have >= cost;
    const list = hazards.map((h) =>
      `<li><span class="haz-glyph">${h.glyph}</span> `
      + `${esc(h.site.name || h.label)} <em class="muted">${esc(h.label)}</em></li>`
    ).join('');

    const panel = document.createElement('div');
    panel.className = 'turn-confirm-panel hazard-confirm-panel';
    panel.innerHTML = `
      <h3>⚠ Hazard zone ahead</h3>
      <p>Your planned route passes through
        <strong>${n}</strong> hazard${n === 1 ? '' : 's'}:</p>
      <ul class="hazard-list">${list}</ul>
      <p class="hazard-warning">
        <strong>Whatever you pick, this move CANNOT be undone</strong>
        - hazard rolls and aqua spends commit the moment the dice
        leave the cup. End the turn to clear the lockout.
      </p>
      <div class="hazard-cost-row">
        <span>💎 Aqua balance: <strong>${have}</strong></span>
        <span>Bypass cost: <strong>${cost}</strong>
          <em class="muted">(${HAZARD_COST_PER}/hazard)</em></span>
      </div>
      <div class="turn-confirm-actions hazard-actions">
        <button type="button" class="popup-btn primary" data-act="pay"
          ${canPay ? '' : 'disabled'}
          title="${canPay ? 'Spend ' + cost + ' aqua to skip the rolls' : 'Not enough aqua to bypass all hazards'}">
          💎 Pay ${cost} aqua to bypass
        </button>
        <button type="button" class="popup-btn" data-act="roll"
          title="Roll a d6 for each hazard. 1 destroys the rocket. Cannot be undone.">
          🎲 Roll ${n} d6 (1 = boom, no undo)
        </button>
        <button type="button" class="popup-btn" data-act="cancel"
          title="Return to planning; no move spent">
          ✕ Cancel move
        </button>
      </div>
      ${canPay ? '' : '<p class="muted hazard-need-aqua">Pay disabled - need '
        + (cost - have) + ' more aqua. Roll or cancel instead.</p>'}
    `;
    for (const b of panel.querySelectorAll('button[data-act]')) {
      b.addEventListener('click', () => close(b.dataset.act));
    }
    overlay.appendChild(panel);
    mountOverlay(overlay);
  });
}

// Animated hazard-roll modal. One 3D die per hazard, rolled in
// parallel; once every die settles the player can confirm to
// apply the result (any 1 = critical, rocket explodes at that
// node). Cancel is intentionally absent - the player already
// committed to rolling in the prior confirm; this modal just
// reveals the dice.
function hazardRollModal(hazards) {
  return new Promise((resolve) => {
    document.querySelector('.hazard-roll-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'card-modal-overlay hazard-roll-overlay';
    let settled = false;
    let rolls = null;
    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(rolls || []);
    };
    const onKey = (e) => {
      // Enter confirms once the dice have all landed - keeps
      // the modal keyboard-friendly without letting the player
      // skip past the suspense.
      if (e.key === 'Enter' && settled) { e.preventDefault(); close(); }
    };
    document.addEventListener('keydown', onKey);

    // Pre-roll every die's outcome so the visual + the logged
    // result + the explosion decision all agree.
    rolls = hazards.map((h) => ({
      site: h.site, label: h.label, glyph: h.glyph,
      d6: 1 + Math.floor(Math.random() * 6),
    }));

    const panel = document.createElement('div');
    panel.className = 'turn-confirm-panel hazard-roll-panel';
    panel.innerHTML = `
      <h3>🎲 Hazard rolls</h3>
      <p class="muted hazard-roll-sub">
        Each die rolls separately. Any <strong>1</strong>
        destroys the rocket at that hazard.
      </p>
      <ul class="hazard-roll-list"></ul>
      <p class="hazard-roll-result muted">Rolling…</p>
      <div class="turn-confirm-actions">
        <button type="button" class="popup-btn primary hazard-roll-confirm" disabled>
          Confirm result
        </button>
      </div>
    `;
    const list = panel.querySelector('.hazard-roll-list');
    const resultLine = panel.querySelector('.hazard-roll-result');
    const confirmBtn = panel.querySelector('.hazard-roll-confirm');

    // Build the rows + dice. Dice spin together; row gets
    // `is-critical` / `is-safe` once its die settles so the
    // colour band updates inline.
    const rowEls = rolls.map((r) => {
      const li = document.createElement('li');
      li.className = 'hazard-roll-row';
      li.innerHTML = `
        <div class="hazard-roll-site">
          <span class="haz-glyph">${r.glyph}</span>
          <strong>${esc(r.site.name)}</strong>
          <em class="muted">${esc(r.label)}</em>
        </div>
        <div class="hazard-roll-die-host"></div>
        <div class="hazard-roll-verdict"></div>
      `;
      list.appendChild(li);
      const dieHost = li.querySelector('.hazard-roll-die-host');
      const verdict = li.querySelector('.hazard-roll-verdict');
      const die = buildDie(1);
      dieHost.appendChild(die);
      return { row: li, die, verdict, roll: r };
    });

    overlay.appendChild(panel);
    mountOverlay(overlay);

    // Spin every die in parallel; once they all land, update
    // each row's verdict + the summary line, and arm Confirm.
    Promise.all(rowEls.map(({ die, roll }) => rollDie(die, roll.d6)))
      .then(() => {
        let criticalCount = 0;
        for (const { row, verdict, roll } of rowEls) {
          const isCrit = roll.d6 === 1;
          if (isCrit) criticalCount++;
          row.classList.add(isCrit ? 'is-critical' : 'is-safe');
          verdict.innerHTML = isCrit
            ? `<strong class="bad">✗ destroyed</strong>`
            : `<strong class="ok">✓ survived</strong>`;
        }
        if (criticalCount > 0) {
          resultLine.innerHTML = `<strong class="bad">💥 Rocket destroyed</strong> `
            + `- ${criticalCount} critical roll${criticalCount === 1 ? '' : 's'}.`;
          confirmBtn.textContent = 'Confirm - lose the rocket';
          confirmBtn.classList.add('hazard-roll-confirm-bad');
        } else {
          resultLine.innerHTML = `<strong class="ok">All survived</strong> `
            + `- continue to destination.`;
          confirmBtn.textContent = 'Confirm - continue';
        }
        resultLine.classList.remove('muted');
        settled = true;
        confirmBtn.disabled = false;
      });
    confirmBtn.addEventListener('click', () => { if (settled) close(); });
  });
}

// Rad-hardness threshold: a card on the stack survives the rad
// zone iff its rad-hard >= the rolled d6. Cards that fail are
// decommissioned to the player's hand. Per the HF4 idiom, the
// active thruster's THRUST stat can skip the test entirely -
// a fast / hot rocket outruns the radiation. Red-season raises
// the bypass bar by 2 so the Sun is harder to dodge.
const RAD_BYPASS_THRUST     = 6;
const RAD_BYPASS_THRUST_RED = 8;
function radBypassThreshold() {
  let season = null;
  try { season = getSeason(); } catch { season = null; }
  return season && season.name === 'red' ? RAD_BYPASS_THRUST_RED : RAD_BYPASS_THRUST;
}

// Pre-roll confirm dialog for rad zones. Mirrors the
// hazardConfirmModal idiom (list of zones, scary warning,
// pick-an-action buttons) but tailored to the rad rules: no
// aqua bypass option, and the body explains the thrust + season
// math + whether the active thruster auto-clears the bar.
// Resolves to 'confirm' or 'cancel'. Always shown when the
// route crosses ≥1 rad zone so the player can back out before
// the dice roll.
function radConfirmModal(radHazards, thrust, seasonBonus, bypassThreshold) {
  return new Promise((resolve) => {
    document.querySelector('.confirm-modal-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'card-modal-overlay confirm-modal-overlay rad-confirm-overlay';
    const close = (val) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close('cancel'); });
    const onKey = (e) => { if (e.key === 'Escape') close('cancel'); };
    document.addEventListener('keydown', onKey);

    const n = radHazards.length;
    const list = radHazards.map((h) =>
      `<li><span class="haz-glyph">${h.glyph}</span> `
      + `${esc(h.site.name || h.label)} <em class="muted">${esc(h.label)}</em></li>`
    ).join('');
    const willBypass = thrust > bypassThreshold;
    const seasonLine = seasonBonus > 0
      ? `Red season adds <strong>+${seasonBonus}</strong> to every rad die.`
      : '';
    // Build the maths preview so the player sees the formula
    // before committing to roll. Active-thrust 0 reads as
    // "no subtraction" rather than "−0" which looks weird.
    const formulaParts = [`d6`];
    if (seasonBonus > 0) formulaParts.push(`+ ${seasonBonus}`);
    if (thrust > 0)      formulaParts.push(`− ${thrust}`);
    const formula = formulaParts.join(' ');
    const bypassNote = willBypass
      ? `<p class="rad-confirm-bypass ok">
          ✓ Active thrust <strong>${thrust}</strong> &gt; <strong>${bypassThreshold}</strong>
          - the rocket outruns the radiation. No roll, no
          decommissions.
         </p>`
      : `<p class="rad-confirm-warning">
          <strong>Cannot bypass.</strong> Active thrust
          <strong>${thrust}</strong> ≤ <strong>${bypassThreshold}</strong>
          - one d6 rolls per zone. Cards with rad-hard less
          than the worst <em>final</em> rad get decommissioned
          to your hand. <strong>Aqua cannot bypass a rad
          roll.</strong>
         </p>`;

    const panel = document.createElement('div');
    panel.className = 'turn-confirm-panel rad-confirm-panel';
    panel.innerHTML = `
      <h3>☢ Radiation zone${n === 1 ? '' : 's'} ahead</h3>
      <p>Your planned route passes through
        <strong>${n}</strong> rad zone${n === 1 ? '' : 's'}:</p>
      <ul class="hazard-list">${list}</ul>
      ${seasonLine ? `<p class="rad-confirm-season muted">${seasonLine}</p>` : ''}
      <p class="rad-confirm-formula muted">
        Final radiation per zone = <code>${formula}</code>
        (active thrust ${thrust || 0}, bypass at &gt; ${bypassThreshold}).
      </p>
      ${bypassNote}
      <div class="turn-confirm-actions hazard-actions">
        <button type="button" class="popup-btn primary" data-act="confirm"
          title="${willBypass ? 'Continue - the thrust check skips the roll' : 'Open the rad-hardness roll modal'}">
          ${willBypass ? '✓ Confirm - bypass' : '🎲 Confirm - roll rad check'}
        </button>
        <button type="button" class="popup-btn" data-act="cancel"
          title="Return to planning; no move spent">
          ✕ Cancel move
        </button>
      </div>
    `;
    for (const b of panel.querySelectorAll('button[data-act]')) {
      b.addEventListener('click', () => close(b.dataset.act));
    }
    overlay.appendChild(panel);
    mountOverlay(overlay);
  });
}

// Animated rad-hardness check modal. Different from the regular
// hazard-roll modal in three ways:
//   1. No aqua bypass - radiation can't be paid off.
//   2. Cards in the stack are checked individually against the
//      rolled d6 - rad-hard < d6 = decommissioned (sent to hand).
//   3. Resolves to a list of card-ids to decommission, not a
//      pass / fail flag.
// One d6 per rad zone; the worst die across all zones is the
// effective threshold per card (so two rad crossings = two
// chances to lose a card). Confirm button arms once every die
// has settled so the player has to acknowledge the outcome.
function radHardnessRollModal(radHazards, stackCards, thrust, seasonBonus) {
  return new Promise((resolve) => {
    document.querySelector('.rad-roll-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'card-modal-overlay rad-roll-overlay';
    let settled = false;
    let rolls = null;
    let toDecommission = [];
    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve({ rolls: rolls || [], decommission: toDecommission });
    };
    const onKey = (e) => {
      if (e.key === 'Enter' && settled) { e.preventDefault(); close(); }
    };
    document.addEventListener('keydown', onKey);

    // Pre-roll all dice so visual + log + decommission agree.
    // `rad` is the FINAL radiation strength per zone after the
    // season bonus is added and the active thruster's thrust is
    // subtracted - clamped at 0 because a "negative" radiation
    // strength can't hurt any non-negative rad-hard card. The
    // raw d6 stays alongside so the UI can show the maths.
    const t = Math.max(0, thrust | 0);
    const bonus = (seasonBonus | 0) || 0;
    rolls = radHazards.map((h) => {
      const d6 = 1 + Math.floor(Math.random() * 6);
      const rad = Math.max(0, d6 + bonus - t);
      return { site: h.site, glyph: h.glyph, d6, rad, bonus, thrust: t };
    });

    const seasonNote = bonus > 0
      ? `Red season adds <strong>+${bonus}</strong> to every die.` : '';
    const thrustNote = t > 0
      ? `Active thrust <strong>${t}</strong> is subtracted from the die.`
      : `No active thrust - no subtraction.`;

    const panel = document.createElement('div');
    panel.className = 'turn-confirm-panel rad-roll-panel';
    panel.innerHTML = `
      <h3>☢ Rad-hardness check</h3>
      <p class="muted rad-roll-sub">
        ${thrustNote} ${seasonNote}
        Final radiation = die${bonus > 0 ? ' + ' + bonus : ''}${t > 0 ? ' − ' + t : ''}.
        Cards whose rad-hard is <strong>less than</strong> the
        worst final radiation get decommissioned to your hand.
        Aqua cannot bypass a rad roll.
      </p>
      <ul class="rad-roll-dice"></ul>
      <p class="rad-roll-result muted">Rolling…</p>
      <ul class="rad-roll-cards"></ul>
      <div class="turn-confirm-actions">
        <button type="button" class="popup-btn primary rad-roll-confirm" disabled>
          Confirm result
        </button>
      </div>
    `;
    const diceList = panel.querySelector('.rad-roll-dice');
    const cardsList = panel.querySelector('.rad-roll-cards');
    const resultLine = panel.querySelector('.rad-roll-result');
    const confirmBtn = panel.querySelector('.rad-roll-confirm');

    // Build a die row per rad zone. The "math chip" to the
    // right of each die is filled in once the die settles so
    // the player can watch the formula resolve as the rolls
    // land.
    const dieEls = rolls.map((r) => {
      const li = document.createElement('li');
      li.className = 'rad-roll-die-row';
      li.innerHTML = `
        <div class="rad-roll-site">
          <span class="haz-glyph">${r.glyph}</span>
          <strong>${esc(r.site.name)}</strong>
        </div>
        <div class="rad-roll-die-host"></div>
        <div class="rad-roll-math muted">…</div>
      `;
      diceList.appendChild(li);
      const dieHost = li.querySelector('.rad-roll-die-host');
      const die = buildDie(1);
      dieHost.appendChild(die);
      return { die, mathEl: li.querySelector('.rad-roll-math'), roll: r };
    });

    // Build the per-card rows: name + rad-hard. Decorated
    // post-roll with safe / decommissioned tags.
    const cardRowEls = stackCards.map((c) => {
      const li = document.createElement('li');
      li.className = 'rad-roll-card';
      li.innerHTML = `
        <span class="rad-roll-card-name">${esc(c.name)}</span>
        <span class="rad-roll-card-rad">RAD <strong>${c.radHardness != null ? c.radHardness : '-'}</strong></span>
        <span class="rad-roll-card-verdict muted">…</span>
      `;
      cardsList.appendChild(li);
      return { el: li, card: c };
    });
    if (!cardRowEls.length) {
      cardsList.innerHTML = '<li class="muted">Empty stack - nothing to test.</li>';
    }

    overlay.appendChild(panel);
    mountOverlay(overlay);

    Promise.all(dieEls.map(({ die, roll }) => rollDie(die, roll.d6))).then(() => {
      // Worst (highest) FINAL radiation across rad zones is the
      // effective threshold per card. Bonus and thrust are
      // already baked into roll.rad above.
      const worst = rolls.reduce((m, r) => Math.max(m, r.rad), 0);
      // Fill in each math chip so the player can read the
      // breakdown: "5 + 2 - 7 = 0" etc.
      for (const { mathEl, roll } of dieEls) {
        const parts = [String(roll.d6)];
        if (roll.bonus > 0) parts.push(`+ ${roll.bonus}`);
        if (roll.thrust > 0) parts.push(`− ${roll.thrust}`);
        const formula = parts.join(' ');
        mathEl.classList.remove('muted');
        mathEl.innerHTML = `${formula} = <strong>rad ${roll.rad}</strong>`;
        if (roll.rad === worst && worst > 0) mathEl.classList.add('is-worst');
      }
      let lost = 0;
      for (const { el, card } of cardRowEls) {
        const v = el.querySelector('.rad-roll-card-verdict');
        const rh = card.radHardness != null ? card.radHardness : 0;
        // Decommission iff final radiation > card rad-hard.
        // A rad-hard 0 card survives a worst-rad of 0; fails
        // a worst-rad of 1.
        const failed = worst > rh;
        if (failed) {
          toDecommission.push(card.id);
          lost++;
          el.classList.add('is-decommissioned');
          v.classList.remove('muted');
          v.innerHTML = `<strong class="bad">✗ decommissioned</strong>`;
        } else {
          el.classList.add('is-safe');
          v.classList.remove('muted');
          v.innerHTML = `<strong class="ok">✓ safe</strong>`;
        }
      }
      const dCount = rolls.length;
      resultLine.classList.remove('muted');
      if (!cardRowEls.length) {
        resultLine.innerHTML = `${dCount} rad zone${dCount === 1 ? '' : 's'} rolled - nothing in stack.`;
      } else if (lost > 0) {
        resultLine.innerHTML = `Worst final radiation <strong>${worst}</strong>: `
          + `<strong class="bad">${lost} card${lost === 1 ? '' : 's'} decommissioned</strong>.`;
        confirmBtn.classList.add('rad-roll-confirm-bad');
        confirmBtn.textContent = `Confirm - lose ${lost} card${lost === 1 ? '' : 's'}`;
      } else {
        resultLine.innerHTML = `Worst final radiation <strong>${worst}</strong>: `
          + `<strong class="ok">stack survived intact</strong>.`;
        confirmBtn.textContent = 'Confirm - continue';
      }
      settled = true;
      confirmBtn.disabled = false;
    });
    confirmBtn.addEventListener('click', () => { if (settled) close(); });
  });
}

// Small info modal used when the player tries to undo a hazardous
// move. Single OK button; the lockout is informational only.
// Mid-route choice between hazards. Pops after each roll
// resolves (and the rocket survived) so the player can:
//   - Continue: roll the next hazard.
//   - Stop here: halt the route at the current node. Remaining
//     planned segments stay in the route so a later turn can
//     pick them up.
//   - Pay X aqua to bypass the remaining GENERIC hazards
//     (rad zones can't be paid, so they still roll). Only
//     enabled when generic hazards remain unresolved AND the
//     balance covers the cost.
// Resolves to 'continue' | 'stop' | 'pay'.
function midRouteChoiceModal({ atSiteName, remaining, aquaBalance }) {
  return new Promise((resolve) => {
    document.querySelector('.mid-route-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'card-modal-overlay confirm-modal-overlay mid-route-overlay';
    const close = (val) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close('stop'); });
    const onKey = (e) => {
      if (e.key === 'Escape') close('stop');
      else if (e.key === 'Enter') close('continue');
    };
    document.addEventListener('keydown', onKey);

    const remGeneric = remaining.filter((r) => r.hazard.site.type !== 'radhaz');
    const remRad     = remaining.filter((r) => r.hazard.site.type === 'radhaz');
    const payCost = remGeneric.length * HAZARD_COST_PER;
    const canPay = remGeneric.length > 0 && aquaBalance >= payCost;
    const list = remaining.map((r) =>
      `<li><span class="haz-glyph">${r.hazard.glyph}</span> `
      + `${esc(r.hazard.site.name || '')} <em class="muted">${esc(r.hazard.label)}</em></li>`
    ).join('');

    const panel = document.createElement('div');
    panel.className = 'turn-confirm-panel mid-route-panel';
    panel.innerHTML = `
      <h3>🛸 Pause at ${esc(atSiteName)}</h3>
      <p>Survived. <strong>${remaining.length}</strong> more
        hazard${remaining.length === 1 ? '' : 's'} along the
        route:</p>
      <ul class="hazard-list">${list}</ul>
      <div class="mid-route-balance muted">
        💧 Aqua balance: <strong>${aquaBalance}</strong>
        ${remRad.length ? ` · ${remRad.length} rad zone${remRad.length === 1 ? '' : 's'} can't be paid` : ''}
      </div>
      <div class="turn-confirm-actions mid-route-actions">
        <button type="button" class="popup-btn primary" data-act="continue"
          title="Roll the next hazard in line">
          ▶ Continue
        </button>
        ${remGeneric.length ? `
          <button type="button" class="popup-btn" data-act="pay"
            ${canPay ? '' : 'disabled'}
            title="${canPay ? 'Spend ' + payCost + ' aqua to skip the remaining generic rolls' : 'Not enough aqua to bypass remaining generic hazards'}">
            💧 Pay ${payCost} aqua to bypass ${remGeneric.length} generic
          </button>` : ''}
        <button type="button" class="popup-btn" data-act="stop"
          title="Halt the move here. Remaining segments stay in the planned route for a future turn.">
          ⏹ Stop here
        </button>
      </div>
    `;
    for (const b of panel.querySelectorAll('button[data-act]')) {
      b.addEventListener('click', () => close(b.dataset.act));
    }
    overlay.appendChild(panel);
    mountOverlay(overlay);
  });
}

function blockedUndoModal() {
  return confirmModal({
    title: '⚠ Move locked',
    body: 'This turn\'s move flew through a hazard spot. '
      + 'Hazard rolls and aqua bypasses commit the move - it '
      + 'cannot be undone. End the turn to start fresh.',
    yes: 'OK',
    no: '',
  });
}

// Sunspot Cube d6 events. Rules text + lookup live in turn-clock.js
// (single source of truth - the tracker modal reads the same table).
// **Sandbox mode**: we DO NOT apply the event to game state. The
// d6 still rolls so the player sees what the cube would have
// triggered at the table, but no decks rotate, no cards
// decommission, no Glitch disks get placed. Log entries are
// prefixed "Would fire:" to keep that distinction obvious. When
// the engine ships (Stage 3+) the application path goes here.
function applyEventDieEffect(event) {
  if (!event || typeof event.dieRoll !== 'number') return;
  const season = getSeasonForSlot(event.turn);
  const e = getEventForRoll(event.dieRoll, season && season.name);
  if (!e) return;
  // Inspiration (d6 = 1 or 2): cycle every patent deck - the
  // topmost card of each goes to the bottom. Auto-applies; the
  // player doesn't have to manually resolve it. This is the
  // only event with an automatic mechanical effect today;
  // others still log as "Would fire" until they get
  // implementations.
  let applied = false;
  if (e.rolls.includes(event.dieRoll) && e.name === 'Inspiration') {
    cycleAllDecks();
    applied = true;
  }
  logAction({
    type: 'event_d6',
    icon: e.icon,
    summary: applied
      ? `${e.name} fired (d6 = ${event.dieRoll}) - every market deck cycled top → bottom.`
      : `Would fire: ${e.name} (d6 = ${event.dieRoll}) - ${e.text}`,
    undoable: false,
    data: {
      dieRoll: event.dieRoll,
      eventName: e.name,
      season: season && season.name,
      applied,
    },
  });
}

// Prospect roll. The site's `siteSize` from the planner data
// encodes the difficulty as "<n><spectral>" (e.g. "9H", "11C",
// "1S"); we parse the leading integer as the prospect threshold.
// Falls back to a class-letter -> number map when siteSize is
// absent (the curated SITES table uses A/B/C/D letters).
//
// Rules: roll 1d6. If roll <= threshold, SUCCESS - player's
// colour disc lands over the site (claim marker). If roll >
// threshold, FAIL - a red disc lands (site exhausted, can't be
// re-prospected in this sandbox session until the player
// manually clears the disc).
const CLASS_TO_NUMBER = { A: 3, B: 5, C: 7, D: 9 };
function siteProspectThreshold(site) {
  if (!site) return 4;
  const ss = site.siteSize;
  if (typeof ss === 'string') {
    const m = ss.match(/^(\d+)/);
    if (m) return Math.max(1, Math.min(11, parseInt(m[1], 10)));
  }
  const cls = String(site.class || '').toUpperCase();
  if (cls in CLASS_TO_NUMBER) return CLASS_TO_NUMBER[cls];
  return 4;
}

// Refueling at a hydrated site. Two distinct refining sources
// per the HF4 rules:
//
//   1. A Refinery card (card.type === 'refinery') with its
//      supports met: a FLAT +7 water per op. Refineries are
//      dedicated processing plants, not water-rated rigs.
//
//   2. An active ISRU rig (the prospector with an ISRU property,
//      until dedicated refinery support lands in Stage 3): yield
//      = site number - ISRU + 1. The site number is the same
//      value the prospect roll checks against.
//
// Either path needs the rocket parked ON the site and the site's
// number > 0. The refinery path is preferred when both are
// available because it produces more water (7 > typical formula).
// One refining op per (turn, site) so a player can't strip-mine.
const STORAGE_REFUEL_LOG = 'hf-sandbox-refuel-log';   // {turn: number, sites: [id]}
function getRefuelLog() {
  try {
    const s = localStorage.getItem(STORAGE_REFUEL_LOG);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}
function markRefueledThisTurn(siteId) {
  const turn = getTurn();
  let log = getRefuelLog();
  if (!log || log.turn !== turn) log = { turn, sites: [] };
  if (!log.sites.includes(siteId)) log.sites.push(siteId);
  try { localStorage.setItem(STORAGE_REFUEL_LOG, JSON.stringify(log)); } catch {}
}
function hasRefueledThisTurn(siteId) {
  const log = getRefuelLog();
  if (!log || log.turn !== getTurn()) return false;
  return log.sites.includes(siteId);
}

// Flat yield of a refinery card per the rules.
const REFINERY_YIELD = 7;

// Pick the best refining source available in the rocket stack.
// Returns either:
//   { kind: 'refinery', card, rawGain: 7 }
//   { kind: 'isru', card, rawGain: 1 + hydration - ISRU, isru }
//   null - nothing usable
//
// The ISRU formula is the published HF4 Site Refuel Op (I5a):
// "An Operational card with an ISRU platform produces a number
// of water FTs equal to one plus the Site's Hydration minus the
// card's ISRU rating." Gate: ISRU <= hydration (so gain >= 1).
//
// Refinery wins when both are present (factory-refuel is up to 7,
// always strictly better at low-hydration sites). The refinery
// branch validates supports with the same supplier-grouped OR
// rule isRocketActive() uses; the ISRU branch leans on
// getActiveProspectorStats so the prospector's chip math applies.
function pickRefiningSource(site) {
  const water = Number.isFinite(site.hydration) ? site.hydration : 0;
  // Refinery path: any stacked card whose type is 'refinery' AND
  // whose requires are satisfied by the rest of the stack.
  const stack = getRocketStack();
  for (const slot of stack) {
    const c = PATENTS_BY_ID[slot.id];
    if (!c || c.type !== 'refinery') continue;
    if (!refineryHasSupports(slot.id, stack)) continue;
    return { kind: 'refinery', card: c, rawGain: REFINERY_YIELD };
  }
  // ISRU rig path: the active prospector with a positive ISRU
  // value, supports met, and ISRU <= site hydration so the
  // 1 + hydration - ISRU formula gives at least 1 water.
  const prosp = getActiveProspectorStats();
  if (prosp && prosp.canActivate) {
    const isru = prospectorIsruValue(prosp.card);
    if (isru > 0 && isru <= water) {
      return { kind: 'isru', card: prosp.card, rawGain: 1 + water - isru, isru };
    }
  }
  return null;
}

// Same supplier-grouped OR check isRocketActive() uses, scoped to
// one refinery card. Returns true when every required-supplier
// group has at least one matching supplier in the rest of the
// stack.
function refineryHasSupports(cardId, stack) {
  const c = PATENTS_BY_ID[cardId];
  if (!c) return false;
  const f = (c.faces && c.faces.primary) || c;
  const reqs = Array.isArray(f.requires) ? f.requires : (c.requires || []);
  if (!reqs.length) return true;
  const supplied = new Set();
  for (const slot of stack) {
    if (slot.id === cardId) continue;
    const oc = PATENTS_BY_ID[slot.id];
    if (!oc) continue;
    const of = (oc.faces && oc.faces.primary) || oc;
    const sups = of.supplies || oc.supplies || [];
    for (const k of sups) supplied.add(k);
  }
  const groups = new Map();
  for (const r of reqs) {
    const supplier = r.kind.split('-')[0];
    if (!groups.has(supplier)) groups.set(supplier, []);
    groups.get(supplier).push(r.kind);
  }
  for (const [, kinds] of groups) {
    if (!kinds.some((k) => supplied.has(k))) return false;
  }
  return true;
}

function canRefuelAt(site) {
  const water = Number.isFinite(site.hydration) ? site.hydration : 0;
  const tank  = getTankWater();
  const tmax  = getTankMax();
  if (water <= 0) {
    return { ok: false, label: `💧 Refuel (dry site)`, reason: 'Site has no water (hydration 0).' };
  }
  if (tank >= tmax) {
    return { ok: false, label: `💧 Tank full (${tank}/${tmax})`, reason: 'Tank is already at max.' };
  }
  const source = pickRefiningSource(site);
  if (!source) {
    return {
      ok: false,
      label: `💧 Refuel (no rig)`,
      reason: 'Need an active refinery, OR an ISRU prospector with ISRU ≤ site water.',
    };
  }
  if (hasRefueledThisTurn(site.id)) {
    return { ok: false, label: `💧 Refueled this turn`, reason: 'Already refined here this turn. End turn to refresh.' };
  }
  const gain = Math.min(source.rawGain, tmax - tank);
  const label = source.kind === 'refinery'
    ? `💧 Refuel (+${gain} via refinery)`
    : `💧 Refuel (+${gain} via ISRU)`;
  return { ok: true, label, reason: null, source };
}

function doRefuel(site) {
  const chk = canRefuelAt(site);
  if (!chk.ok) {
    setStatus(`Refuel blocked: ${chk.reason}`);
    return;
  }
  // Rulebook I5a: ISRU Refuel is an Operation, consumes the
  // per-turn op slot. Factory-Refuel (I5b) will route through
  // this same gate when it lands.
  if (!requireOp('ISRU Refuel')) return;
  const source = chk.source;
  const tankBefore = getTankWater();
  const tmax = getTankMax();
  const gain = Math.min(source.rawGain, tmax - tankBefore);
  if (gain <= 0) return;
  addFuel(gain);
  markRefueledThisTurn(site.id);
  const sourceName = source.card?.name || source.kind;
  const water = Number.isFinite(site.hydration) ? site.hydration : 0;
  const detail = source.kind === 'refinery'
    ? `flat +${REFINERY_YIELD} via <em>${esc(sourceName)}</em>`
    : `1 + water ${water} - ISRU ${source.isru} = ${source.rawGain}`;
  setStatus(
    `💧 Refined <strong>${gain}</strong> water at `
    + `<strong>${esc(site.name)}</strong> (${detail}). `
    + `Tank ${tankBefore} → <strong>${tankBefore + gain}</strong>/${tmax}.`
  );
  logAction({
    type: 'refuel',
    icon: '💧',
    summary: `Refined +${gain} water at ${site.name} via ${source.kind} (${sourceName}); tank ${tankBefore + gain}/${tmax}`,
    undoable: false,
    data: {
      siteId: site.id, gain, source: source.kind,
      tankAfter: tankBefore + gain,
    },
  });
  // Visual: pop the tank modal showing water flowing in. Player
  // can click to skip or dismiss whenever.
  openFuelTankModal({ fromWater: tankBefore, toWater: tankBefore + gain });
}

// Outpost slot picker. Returns a Promise<letter|null>; resolves
// null on cancel / Escape. Shows the four A/B/C/D buttons in a
// row, dimming the ones whose slots are already taken. Used by
// the Rocket -> Outpost convert flow (user picks which slot
// letter the new outpost takes - variant rule, see
// industrialize.md "Outpost slot assignment").
function pickOutpostSlot({ title = '🏛 Pick a slot for the new Outpost', body = '' } = {}) {
  return new Promise((resolve) => {
    document.querySelector('.outpost-slot-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'card-modal-overlay outpost-slot-overlay';
    overlay.tabIndex = -1;
    const close = (letter) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(letter || null);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(null); } };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
    const free = new Set(getAvailableOutpostSlots());
    const dialog = document.createElement('div');
    dialog.className = 'outpost-slot-modal';
    dialog.innerHTML = `
      <div class="outpost-slot-head"><h3>${esc(title)}</h3></div>
      ${body ? `<div class="outpost-slot-body">${body}</div>` : ''}
      <div class="outpost-slot-buttons">
        ${OUTPOST_LETTERS.map((L) => {
          const taken = !free.has(L);
          return `<button type="button" class="outpost-slot-btn ${taken ? 'is-taken' : ''}" data-letter="${L}" ${taken ? 'disabled' : ''}>${L}</button>`;
        }).join('')}
      </div>
      <div class="card-modal-actions">
        <button type="button" class="modal-btn outpost-slot-cancel">Cancel</button>
      </div>
    `;
    overlay.appendChild(dialog);
    dialog.querySelectorAll('.outpost-slot-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        close(btn.getAttribute('data-letter'));
      });
    });
    dialog.querySelector('.outpost-slot-cancel').addEventListener('click', () => close(null));
    document.body.appendChild(overlay);
    overlay.focus();
  });
}

// Rocket -> Outpost. Free action. Caller has validated the
// rocket has cards, is at a non-LEO site, and at least one
// outpost slot is free. Opens the slot picker; on confirm,
// snapshots the rocket stack + tank, dissolves the rocket
// (cards cleared, tank zeroed, rocket returns to LEO), and
// creates the outpost with the snapshotted state.
async function doConvertToOutpost(site) {
  const stack = getRocketStack();
  const tank  = getTankWater();
  if (!stack.length) return;
  const letter = await pickOutpostSlot({
    title: `🚀→🏛 Convert Rocket to Outpost at ${site.name}`,
    body: `<p>${stack.length} card${stack.length === 1 ? '' : 's'} + ${tank} water will move to the new outpost.</p>`,
  });
  if (!letter) return;
  if (!createOutpost(letter, site.id)) {
    setStatus(`Convert failed - slot ${esc(letter)} could not be created.`);
    return;
  }
  // Move cards in order so the outpost's stack mirrors the
  // rocket's. We do NOT route through the patent deck or hand -
  // cards pass directly from one stack to the other.
  for (const slot of stack) {
    addCardToOutpost(letter, { id: slot.id, kind: slot.kind });
  }
  setOutpostTank(letter, tank);
  // Dissolve the rocket: clear its card list + tank, return it
  // to LEO. Same wipe pattern as explodeRocket minus the boom.
  rocketClearStack();
  setTankWater(0);
  _rocketSiteId = null;
  persistRocketSite();
  _plannedRoute = null;
  persistPlannedRoute();
  exitManualMoveMode();
  _rocketTrail = [];
  persistRocketTrail();
  if (_renderer) {
    _renderer.setRoute(null);
    _renderer.setRouteEndpoints(null, null);
    _renderer.setRocketTrail(null);
  }
  setStatus(
    `🚀→🏛 Converted rocket to Outpost <strong>${esc(letter)}</strong> at `
    + `<strong>${esc(site.name)}</strong>. `
    + `${stack.length} card${stack.length === 1 ? '' : 's'} + ${tank} water moved across; `
    + `rocket returns to LEO empty.`
  );
  logAction({
    type: 'convert_outpost',
    icon: '🚀→🏛',
    summary: `Converted rocket to Outpost ${letter} at ${site.name} (${stack.length} cards, ${tank} water)`,
    undoable: false,
    data: { siteId: site.id, letter, cards: stack.length, tank },
  });
}

// Outpost -> Rocket. Free action. Caller has validated there's
// no current rocket (empty stack at LEO) and the outpost exists.
// Move the outpost's cards + tank to the rocket, place the
// rocket at the outpost's site, dissolve the outpost.
function doConvertToRocket(site, letter) {
  const op = getOutpost(letter);
  if (!op) {
    setStatus(`Lift failed - Outpost ${esc(letter)} not found.`);
    return;
  }
  if (op.siteId !== site.id) {
    setStatus(`Lift failed - Outpost ${esc(letter)} is not at this site.`);
    return;
  }
  if (getRocketStack().length > 0) {
    setStatus(`Lift failed - rocket must be empty before lifting an outpost.`);
    return;
  }
  // Variant rule: an outpost can only become a rocket if it
  // carries at least one functional thruster (a thruster whose
  // supports are satisfied by the rest of the outpost's stack).
  // Re-check here in case state shifted between popup-build and
  // click.
  const functional = findFunctionalThrusters(op.cards);
  if (!functional.length) {
    setStatus(`Lift failed - Outpost ${esc(letter)} has no functional thruster.`);
    return;
  }
  // Move cards over (preserve each slot's face so crew keep
  // their faction face + a Black-Side card keeps its tier).
  for (const slot of op.cards) {
    rocketAddCard(slot.id, slot.kind, slot.face);
  }
  // Explicitly pick the first functional thruster as the active
  // one. rocket.js auto-picks the FIRST thruster it sees on
  // add, but that's not necessarily a thruster whose supports
  // are satisfied; the lift would otherwise leave the rocket
  // immediately inactive.
  setActiveThruster(functional[0].id);
  setTankWater(op.tank);
  _rocketSiteId = op.siteId;
  persistRocketSite();
  // Dissolve outpost (returns the card list, but we already
  // moved them - discard the return value).
  dissolveOutpost(letter);
  setStatus(
    `🏛${esc(letter)}→🚀 Lifted Outpost ${esc(letter)} into your Rocket at `
    + `<strong>${esc(site.name)}</strong>. `
    + `${op.cards.length} card${op.cards.length === 1 ? '' : 's'} + ${op.tank} water transferred. `
    + `Active thruster: <em>${esc(functional[0].card.name)}</em>.`
  );
  logAction({
    type: 'convert_rocket',
    icon: '🏛→🚀',
    summary: `Lifted Outpost ${letter} into Rocket at ${site.name} (${op.cards.length} cards, ${op.tank} water, thruster ${functional[0].card.name})`,
    undoable: false,
    data: { siteId: site.id, letter, cards: op.cards.length, tank: op.tank, thrusterId: functional[0].id },
  });
}

// Factory-Refuel handler (rulebook I5b). Adds water FTs to the
// rocket tank up to the cap; consumes the per-turn op and the
// per-site refuel lock. The flat 7-water yield is the "blue FT"
// rulebook value; the gold-FT (isotope) variant lands when
// isotope storage exists. Caller has already validated that a
// player-owned factory exists at the site, the rocket is parked,
// and tank headroom > 0.
function doFactoryRefuel(site, gain) {
  if (gain <= 0) return;
  if (!requireOp('Factory-Refuel')) return;
  const tankBefore = getTankWater();
  const tmax = getTankMax();
  addFuel(gain);
  markRefueledThisTurn(site.id);
  setStatus(
    `🏭 Factory-Refuel at <strong>${esc(site.name)}</strong>: `
    + `<strong>+${gain}</strong> water (factory produces 7 blue FTs, clamped by tank cap). `
    + `Tank ${tankBefore} → <strong>${tankBefore + gain}</strong>/${tmax}.`
  );
  logAction({
    type: 'factory_refuel',
    icon: '🏭',
    summary: `Factory-Refuel at ${site.name}: +${gain} water; tank ${tankBefore + gain}/${tmax}`,
    undoable: false,
    data: { siteId: site.id, gain, tankAfter: tankBefore + gain },
  });
  openFuelTankModal({ fromWater: tankBefore, toWater: tankBefore + gain });
}

// Wipe browse.js module-local state that the global resets in
// card-market.js#resetSandboxEconomy can't reach: the rocket
// position, planned route, trail, the undo snapshot, the
// per-turn refuel-log key, and the renderer's overlay layers.
// Pure cleanup; safe to call multiple times.
function doBrowseLocalReset() {
  _rocketSiteId = null;
  persistRocketSite();
  _rocketTrail = [];
  persistRocketTrail();
  _plannedRoute = null;
  persistPlannedRoute();
  _moveSnapshot = null;
  if (_renderer) {
    _renderer.setRoute(null);
    _renderer.setRouteEndpoints(null, null);
    _renderer.setRocketTrail(null);
  }
  try { localStorage.removeItem(STORAGE_REFUEL_LOG); } catch {}
}

// Full sandbox reset (Reset-sandbox button). Composition of
// doBrowseLocalReset + the global resetSandboxEconomy from
// card-market.js. The Card Market mode flag is preserved so a
// player who has explicitly opted into Card Market doesn't get
// silently flipped back by a Reset click.
function doSandboxReset() {
  doBrowseLocalReset();
  resetSandboxEconomy({ keepMode: true });
}

// Research Auction handler (rulebook I2). Opens the auction
// modal in the current Card Market mode. On commit: the picked
// patent enters the player's hand; in Card Market mode the
// sacrificed Hand card returns to the library. Op gated inside
// the commit so cancel doesn't burn the turn.
// Research Auction entry point. Opens the 🛒 Cart pane - the
// cart IS the auction UI (only the top of each deck is
// auctionable, via each deck's Buy button). You CANNOT auction
// from the card library or from the deck-tap inspect modal;
// the cart is the single place purchases happen.
function doResearchAuction() {
  showPane('cart');
}

// Free Market handler (rulebook I3). Only callable in Card
// Market mode (UI gates on this). Sells one Hand card for
// FREE_MARKET_AQUA aqua. Op gated inside the commit.
// Income Operation handler (rulebook I1). Consumes the
// per-turn op and credits +1 aqua to the Bank. Simple; the
// op-budget check + the aqua mutation is the whole
// transaction.
const INCOME_AQUA = 1;
function doIncomeOp() {
  if (!requireOp('Income')) return;
  addAqua(INCOME_AQUA);
  setStatus(`💰 Income: <strong>+${INCOME_AQUA}</strong> aqua. Bank now <strong>${esc(String(getAqua()))}</strong>.`);
  logAction({
    type: 'income',
    icon: '💰',
    summary: `Income: +${INCOME_AQUA} aqua (bank ${getAqua()})`,
    undoable: false,
    data: { delta: INCOME_AQUA, bankAfter: getAqua() },
  });
}

// Operations menu - opened by tapping the toolbar "op:N" tag. The
// player's main decision aid: it lists what they can spend their
// one operation on this turn, with the always-available ops as
// one-tap shortcuts (Income first) and the context ops as hints.
function openOpsMenu() {
  document.querySelector('.ops-menu-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay ops-menu-overlay';
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const ops = getOpsRemaining();
  const moves = getMovesRemaining();
  const market = getMarketMode() === MARKET_MODE.MARKET;
  const handN = getHandSlots().length;
  const opCls = ops > 0 ? '' : ' class="muted"';

  const panel = document.createElement('div');
  panel.className = 'ops-menu-panel';
  panel.innerHTML = `
    <button type="button" class="modal-x" aria-label="Close (Esc)" title="Close (Esc)">×</button>
    <h2 class="ops-menu-title">⚙ Operations this turn</h2>
    <p class="muted ops-menu-sub">You have <strong${opCls}>op:${ops}</strong> and <strong>move:${moves}</strong> left. One operation per turn - pick wisely.</p>
    <div class="ops-menu-list" id="ops-menu-now"></div>
    <h4 class="ops-menu-head">At a site (1 op) - open the site you're parked at / colocated with</h4>
    <ul class="ops-menu-hints">
      <li>🔭 <strong>Prospect</strong> - roll to claim a site (needs an active prospector)</li>
      <li>⛽ <strong>ISRU / Factory Refuel</strong> - top up the rocket's water</li>
      <li>🏭 <strong>Industrialize</strong> - refinery + robonaut become a factory</li>
      <li>🧪 <strong>ET Produce</strong> - a hand card into a factory outpost (spectral match)</li>
      <li>🛰 <strong>Boost</strong> - mark cards in your Hand, then press BOOST (costs aqua = mass)</li>
    </ul>
    <h4 class="ops-menu-head">Free actions (no op)</h4>
    <ul class="ops-menu-hints">
      <li>🌐 Colonize a factory (consumes a colocated crew)</li>
      <li>🗑 Discard 1 hand card per turn · 🔄 Transfer · ♻ Decommission to hand</li>
      <li>🛸 Move the rocket (uses the move budget, not an op)</li>
    </ul>
  `;
  const now = panel.querySelector('#ops-menu-now');
  const addOp = (label, title, fn, enabled = true) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ops-menu-op modal-btn stack';
    b.disabled = !enabled;
    b.innerHTML = label;
    b.title = title;
    b.addEventListener('click', () => { close(); fn(); });
    now.appendChild(b);
  };
  addOp('💰 Income (+1 aqua)', 'Take 1 Aqua from the Pool into your Bank. Costs one operation.', doIncomeOp);
  addOp('🎯 Research Auction', 'Open the card market / auction. Costs one operation.', doResearchAuction);
  if (market) {
    addOp(`💱 Free Market (+${FREE_MARKET_AQUA} aqua)`,
      handN > 0 ? 'Sell a hand card for aqua. Costs one operation.' : 'No hand cards to sell.',
      doFreeMarket, handN > 0);
  }

  overlay.appendChild(panel);
  panel.querySelector('.modal-x').addEventListener('click', close);
  mountOverlay(overlay);
}

function doFreeMarket() {
  if (getMarketMode() !== MARKET_MODE.MARKET) {
    setStatus('Free Market is only available in Card Market mode.');
    return;
  }
  const handIds = getHandSlots();
  if (!handIds.length) return;
  openFreeMarketModal({
    handIds,
    lookupCard: cardById,
    onCommit: ({ cardId }) => {
      if (!cardId) return;
      if (!requireOp('Free Market')) return;
      const card = cardById(cardId);
      if (!card) {
        setStatus(`Free Market failed - unknown card ${esc(cardId)}.`);
        return;
      }
      if (!removeFromHand(cardId)) {
        setStatus(`Free Market failed - card not in hand.`);
        return;
      }
      // Sold card goes to the BOTTOM of its corresponding
      // deck (variant rule, user 2026-05-24: "free market
      // card ... goes to the back of the deck"). Routes by
      // type via addToBottom.
      addToBottom(cardId);
      addAqua(FREE_MARKET_AQUA);
      setStatus(
        `💱 Sold <em>${esc(card.name)}</em> for <strong>+${FREE_MARKET_AQUA}</strong> aqua. `
        + `Card returns to the bottom of the ${esc(card.type || 'patent')} deck.`
      );
      logAction({
        type: 'free_market',
        icon: '💱',
        summary: `Sold ${card.name} for +${FREE_MARKET_AQUA} aqua (Free Market)`,
        undoable: false,
        data: { cardId, aqua: FREE_MARKET_AQUA },
      });
    },
  });
}

// Resolve a hand/stack slot id to its underlying card record
// (patents or crew). Module-level helper so the popup builders
// and the Stage-3 op handlers all share one lookup; mirrors the
// two `const lookup` helpers that live inside the larger UI
// closures.
function cardById(id) {
  return PATENTS_BY_ID[id] || CREW_BY_ID[id] || null;
}

// ET Production handler (rulebook I8). Caller has validated
// that a player-owned factory is at the site, the rocket is
// parked, and there's at least one spectral-matching hand
// card with either an outpost present or a free slot. Op cost
// is committed inside the modal commit so cancelling doesn't
// burn the turn.
function doEtProduce(site, factory, options, outpostsAtSite, freeSlots) {
  const existingOutpost = outpostsAtSite.length > 0 ? outpostsAtSite[0].letter : null;
  openEtProduceModal({
    siteName: site.name,
    factorySpectral: factory.spectralType,
    options,
    existingOutpost,
    freeSlots,
    onCommit: ({ cardId, letter, isNewOutpost }) => {
      if (!cardId || !letter) return;
      if (!requireOp('ET Production')) return;
      // If we need to create the outpost first, do that BEFORE
      // moving cards - otherwise addCardToOutpost will reject.
      if (isNewOutpost) {
        if (!createOutpost(letter, site.id)) {
          setStatus(`ET Produce failed - could not create Outpost ${esc(letter)}.`);
          return;
        }
      }
      const card = cardById(cardId);
      if (!card) {
        setStatus(`ET Produce failed - unknown card ${esc(cardId)}.`);
        return;
      }
      // Card moves from hand to outpost, Black-Side-up
      // (face='secondary'). removeFromHand first so the
      // addCard call doesn't trip the "already in hand" guard
      // if anything reads back through.
      removeFromHand(cardId);
      const added = addCardToOutpost(letter, {
        id: cardId,
        kind: 'patent',
        face: 'secondary',
      });
      if (!added) {
        // Roll back: put card back in hand.
        addToHand(card);
        setStatus(`ET Produce failed - outpost ${esc(letter)} refused the card.`);
        return;
      }
      setStatus(
        `🏭 ET Produced <em>${esc(card.name)}</em> at <strong>${esc(site.name)}</strong> `
        + `into Outpost <strong>${esc(letter)}</strong> (Black-Side-up, spectral ${esc(factory.spectralType)}).`
        + (isNewOutpost ? ` New outpost created.` : '')
      );
      logAction({
        type: 'et_produce',
        icon: '🏭',
        summary: `ET Produced ${card.name} (Black-Side) at ${site.name} into Outpost ${letter}`
          + (isNewOutpost ? ' (new outpost)' : ''),
        undoable: false,
        data: {
          siteId: site.id, cardId, letter,
          factorySpectral: factory.spectralType,
          isNewOutpost,
        },
      });
    },
  });
}

// Single sandbox owner id - the local player. Used to tag
// factories + colonies until Stage 4 multi-player support
// arrives. Keeping it as a constant (rather than reading from a
// profile system that doesn't exist yet in the sandbox) is
// deliberate: when multi-player lands this becomes a parameter,
// not a runtime lookup.
const SANDBOX_OWNER_ID = 'sandbox-player';

// Industrialize handler (rulebook I7). The caller has already
// validated that the rocket is parked at a claimed site with no
// existing factory AND that findIndustrializeOptions(stack)
// returned at least one valid pair; we just open the modal and
// commit when the player confirms.
//
// Important: the op cost is consumed inside the modal commit
// callback (NOT at popup-click time) so cancelling the modal
// doesn't burn the turn. The chain cards are removed from the
// stack in reverse-index order so splices don't shift indices
// we haven't visited yet.
function doIndustrialize(site, stack, options) {
  openIndustrializeModal({
    siteName: site.name,
    spectralType: site.spectralType || 'C',
    stack,
    options,
    onCommit: (opt) => {
      if (!opt) return;
      if (!requireOp('Industrialize')) return;
      // Remove chain cards in reverse index order so earlier
      // indices stay valid as we splice. Radiators were already
      // filtered out into opt.keptRadiators and are NOT in
      // chainIndices.
      const removed = [];
      for (const idx of [...opt.chainIndices].sort((a, b) => b - a)) {
        const slot = stack[idx];
        if (!slot) continue;
        // Crew NEVER gets decommissioned / removed by industrialize
        // (it can only move stack-to-stack or become a colony). Hard
        // guard so a crew slot can never silently vanish here.
        if (slot.kind === 'crew' || CREW.some((c) => c.id === slot.id)) continue;
        const ok = rocketRemoveCard(idx);
        if (ok) {
          removed.push(slot.id);
          // Variant rule (user, 2026-05-24): industrialize-
          // decommissioned cards return to the player's HAND
          // (NOT to the deck bottom - that earlier reading
          // was the user's pre-clarification draft). The
          // refinery + robonaut + support chain you spent
          // are re-collectable, not consumed.
          const reclaim = PATENTS_BY_ID[slot.id];
          if (reclaim) addToHand(reclaim);
        }
      }
      const spectral = site.spectralType || 'C';
      const built = createFactory(site.id, SANDBOX_OWNER_ID, spectral);
      const refName = opt.refinery.card.name;
      const robName = opt.robonaut.card.name;
      const orphanNote = opt.orphans.length
        ? ` ⚠ ${opt.orphans.map((o) => o.card.name).join(', ')} now inactive (lost support).`
        : '';
      const keptNote = opt.keptRadiators.length
        ? ` Kept: ${opt.keptRadiators.map((r) => r.card.name).join(', ')}.`
        : '';
      if (built) {
        setStatus(
          `🏭 Industrialized <strong>${esc(site.name)}</strong> `
          + `(spectral ${esc(spectral)}). `
          + `Decommissioned <em>${esc(refName)}</em> + <em>${esc(robName)}</em>`
          + ` + ${removed.length - 2} support card${removed.length - 2 === 1 ? '' : 's'}.`
          + `${keptNote}${orphanNote}`
        );
        logAction({
          type: 'industrialize',
          icon: '🏭',
          summary: `Industrialized ${site.name} (spectral ${spectral}); `
            + `decommissioned ${removed.length} card${removed.length === 1 ? '' : 's'} `
            + `(refinery ${refName} + robonaut ${robName}` +
            (opt.orphans.length ? `; orphans: ${opt.orphans.map((o) => o.card.name).join(', ')}` : '') + ')',
          undoable: false,
          data: {
            siteId: site.id,
            spectralType: spectral,
            decommissioned: removed,
            keptRadiators: opt.keptRadiators.map((r) => r.id),
            orphans: opt.orphans.map((o) => o.id),
          },
        });
      } else {
        setStatus(`Industrialize failed to record - factory may already exist at ${esc(site.name)}.`);
      }
    },
  });
}

// Build Colony handler (rulebook G3, free action). The caller
// has already validated that the site has a player-owned
// factory, no existing colony, the player is under the cap,
// and at least one colocated Crew card exists.
//
// One crew -> auto-commit (picker is skipped). Multiple crews
// -> picker modal. On commit: the chosen crew slot is removed
// from the stack and the underlying crew card returns to the LEO
// Stack intact (crew always re-spawns in LEO). The colony dome is
// created on the factory.
//
// Free action: no requireOp call.
function doColonize(site, stack, options) {
  openColonizePicker({
    siteName: site.name,
    options,
    onCommit: (pick) => {
      if (!pick) return;
      // Re-find by id at commit time - splices may have shifted
      // indices since the modal opened, though in practice
      // nothing else mutates the stack during the modal's
      // lifetime. Defence-in-depth.
      const currentStack = getRocketStack();
      const idx = currentStack.findIndex((s) => s.id === pick.id && s.kind === 'crew');
      if (idx === -1) {
        setStatus(`Colonize aborted - crew ${esc(pick.id)} is no longer in the stack.`);
        return;
      }
      const crewFace = currentStack[idx].face;
      const crewCard = CREW_BY_ID[pick.id];
      if (!crewCard) {
        setStatus(`Colonize aborted - unknown crew id ${esc(pick.id)}.`);
        return;
      }
      const removed = rocketRemoveCard(idx);
      if (!removed) {
        setStatus(`Colonize aborted - could not remove crew from stack.`);
        return;
      }
      // Crew always re-spawns in the LEO Stack (variant rule,
      // user 2026-05). crewCard kept for naming only.
      void crewCard;
      const leoOk = addCardToLeo({ id: pick.id, kind: 'crew', face: crewFace });
      if (!leoOk) {
        // Roll back the stack removal so the crew isn't lost.
        rocketAddCard(pick.id, 'crew', crewFace);
        setStatus(`Colonize aborted - crew couldn't return to the LEO stack.`);
        return;
      }
      const created = createColony(site.id, SANDBOX_OWNER_ID);
      if (!created) {
        // Cap or duplicate. Roll back: pull crew back out of
        // the LEO stack, drop it back on the rocket stack.
        removeCardFromLeoById(pick.id);
        rocketAddCard(pick.id, 'crew', crewFace);
        setStatus(`Colonize failed at <strong>${esc(site.name)}</strong> - cap or duplicate.`);
        return;
      }
      const crewName = pick.primary?.name || pick.card.id;
      setStatus(
        `🌐 Built colony at <strong>${esc(site.name)}</strong>. `
        + `<em>${esc(crewName)}</em> returns to your LEO Stack. `
        + `Colonies: <strong>${countColoniesByOwner(SANDBOX_OWNER_ID)}</strong>/${COLONY_CAP_PER_PLAYER}.`
      );
      logAction({
        type: 'colonize',
        icon: '🌐',
        summary: `Built colony at ${site.name} (crew ${crewName} returned to LEO stack); `
          + `${countColoniesByOwner(SANDBOX_OWNER_ID)}/${COLONY_CAP_PER_PLAYER} colonies`,
        undoable: false,
        data: { siteId: site.id, crewId: pick.id },
      });
    },
  });
}

// Fuel-tank modal. SVG cylinder; water rect grows from
// `fromWater` to `toWater` over ~1100 ms. Capacity = active
// thruster's max-liftable fuel (thrust - dryMass) when present,
// falling back to the engine's hard tank cap. Tap / click /
// Escape closes; tapping mid-animation skips to the end-state
// without dismissing so the player sees the final level.
// Lightweight confirm modal. Returns a Promise<boolean> that
// resolves true on the "yes" path, false on cancel / Esc /
// backdrop tap. Used for the afterburn engage prompt; future
// destructive actions can reuse it.
function confirmModal({ title, body, yes = 'OK', no = 'Cancel' }) {
  return new Promise((resolve) => {
    document.querySelector('.confirm-modal-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'card-modal-overlay confirm-modal-overlay';
    const close = (val) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(!!val);
    };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
      else if (e.key === 'Enter') close(true);
    };
    document.addEventListener('keydown', onKey);
    const panel = document.createElement('div');
    panel.className = 'turn-confirm-panel';
    // Single-button (info) mode: pass no='' to hide the secondary
    // button so the modal reads as an acknowledge instead of a
    // yes/no. The remaining Yes resolves true on click + Enter.
    const noBtn = no
      ? `<button type="button" class="popup-btn" data-act="no">${esc(no)}</button>`
      : '';
    panel.innerHTML = `
      <h3>${esc(title)}</h3>
      <p>${body}</p>
      <div class="turn-confirm-actions">
        <button type="button" class="popup-btn primary" data-act="yes">${esc(yes)}</button>
        ${noBtn}
      </div>
    `;
    panel.querySelector('[data-act="yes"]').addEventListener('click', () => close(true));
    const noEl = panel.querySelector('[data-act="no"]');
    if (noEl) noEl.addEventListener('click', () => close(false));
    overlay.appendChild(panel);
    mountOverlay(overlay);
  });
}

// Interactive fuel-strip diagram for the rocket-stack header -
// the published HF4 "Net Thrust track". Mass positions 1..32 are
// grouped into the doubling weight-class bands (data/net-thrust-
// track.js is the single source of truth on the band boundaries
// and the per-band fuel-step fraction ladders):
//   WISP +2   mass 1       PROBE +1  mass 2-4
//   SCOUT 0   mass 5-8      TRANSPORT -1 mass 9-16
//   TUG -2    mass 17-32
// Each band shows its fraction ladder (the white sub-step ovals)
// stacked ABOVE its mass-position cells, matching the board's
// layered layout. Two chits overlay the cells: DRY at the
// rocket's dry mass, WET at the current wet mass. Black-line =
// FT spend (burn); red-dotted = refuel - see the legend. The
// strip is read-only for now.
function buildFuelStrip(host, totals) {
  host.innerHTML = '';
  const wm = Math.max(0, totals.wetMass | 0);
  const dm = Math.max(0, totals.dryMass | 0);

  const label = document.createElement('div');
  label.className = 'rocket-fuel-strip-label';
  label.textContent = 'Net Thrust track';
  host.appendChild(label);

  const bands = document.createElement('div');
  bands.className = 'fuel-strip-bands';
  for (const wc of WEIGHT_CLASSES) {
    const span = wc.massMax - wc.massMin + 1;
    const band = document.createElement('div');
    band.className = 'fuel-strip-band';
    band.dataset.band = wc.id;
    band.style.flexGrow = String(span);
    band.style.setProperty('--band-color', wc.color);

    const head = document.createElement('div');
    head.className = 'fuel-strip-band-head';
    const mod = wc.netThrust >= 0 ? `+${wc.netThrust}` : String(wc.netThrust);
    head.innerHTML = `<span class="fs-band-name">${wc.id}</span><span class="fs-band-mod">${mod}</span>`;
    band.appendChild(head);

    // Fraction ladder (fuel sub-steps). Whole-step bands (TUG)
    // show a single "1" to read as "whole fuel steps".
    const fracs = document.createElement('div');
    fracs.className = 'fuel-strip-fracs';
    const ladder = wc.fractions.length ? wc.fractions : ['1'];
    for (const fr of ladder) {
      const chip = document.createElement('span');
      chip.className = 'fs-frac';
      chip.textContent = fr;
      fracs.appendChild(chip);
    }
    band.appendChild(fracs);

    const cells = document.createElement('div');
    cells.className = 'fuel-strip-cells';
    cells.style.gridTemplateColumns = `repeat(${span}, 1fr)`;
    for (let i = wc.massMin; i <= wc.massMax; i++) {
      const cell = document.createElement('div');
      cell.className = 'fuel-strip-cell';
      let tip = `Mass ${i} - ${wc.id} weight class (${mod} net thrust)`;
      if (i === MIN_DRY_MASS) { cell.classList.add('is-min-dry'); tip += ' - MIN DRY MASS'; }
      if (i === MAX_DRY_MASS) { cell.classList.add('is-max-dry'); tip += ' - MAX DRY MASS'; }
      if (i === MAX_WET_MASS) { cell.classList.add('is-max-wet'); tip += ' - MAX WET MASS'; }
      cell.dataset.tip = tip;
      cell.title = tip;
      cell.textContent = String(i);
      if (i === dm) cell.classList.add('is-dry-chit');
      if (i === wm) cell.classList.add('is-wet-chit');
      if (i === dm && i === wm) cell.classList.add('is-co-chit');
      cells.appendChild(cell);
    }
    band.appendChild(cells);
    bands.appendChild(band);
  }
  host.appendChild(bands);

  const wc = weightClassForMass(wm || 1);
  const netMod = wc.netThrust >= 0 ? `+${wc.netThrust}` : String(wc.netThrust);
  const legend = document.createElement('div');
  legend.className = 'rocket-fuel-strip-legend';
  legend.innerHTML = `
    <span><i class="chit-dot is-dry-chit"></i> Dry ${dm}</span>
    <span><i class="chit-dot is-wet-chit"></i> Wet ${wm} (${wc.id} ${netMod})</span>
    <span class="muted">Max wet ${MAX_WET_MASS}</span>
    <span class="fs-line-key"><i class="fs-line black"></i> burn (FT spend)</span>
    <span class="fs-line-key"><i class="fs-line red"></i> refuel</span>
  `;
  host.appendChild(legend);
}

function openFuelTankModal({ fromWater = null, toWater = null } = {}) {
  document.querySelector('.fuel-tank-overlay')?.remove();
  const tankNow = Number.isFinite(toWater) ? toWater : getTankWater();
  // fromWater default is null (not 0): no-arg opens snap to the
  // current level immediately, no fill animation. Refuel calls
  // still pass fromWater explicitly to play the fill tween.
  const fromW   = Number.isFinite(fromWater) ? fromWater : tankNow;
  const totals  = getStackTotals();
  const thrStats = getActiveThrusterStats();
  // Tank visualisation model: the cylinder always represents the
  // full TANK_MAX wet-mass cap (32). Dry mass occupies the bottom
  // of the cylinder as an immutable block; water floats on top
  // of it. The room left over for water = TANK_MAX − dry mass.
  // A separate LIFT marker is drawn at the active thruster's
  // thrust line so the player can see when extra water would
  // push the rocket below liftable mass.
  const TANK_VIS_MAX = getTankMax();
  const dryMass = Math.max(0, Math.min(TANK_VIS_MAX, totals.dryMass || 0));
  const cap = Math.max(0, TANK_VIS_MAX - dryMass);
  const thrust = (thrStats && Number.isFinite(thrStats.thrust)) ? thrStats.thrust : null;
  const liftCap = (thrust != null) ? Math.max(0, thrust - dryMass) : null;

  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay fuel-tank-overlay';

  let animating = false;
  let raf = 0;
  let finalReached = (fromW === tankNow);

  const close = () => {
    if (raf) cancelAnimationFrame(raf);
    // Defensive - drops were appended to a child of the overlay
    // so they vanish with overlay.remove(), but null out the
    // array so a stale rAF can't touch detached nodes.
    activeDrops.length = 0;
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  // Net Thrust readout: wet mass -> weight class -> net thrust,
  // mirroring the published Net Thrust track (data/net-thrust-
  // track.js). Net thrust = base thrust + weight-class modifier.
  const wmNow = Math.max(0, totals.wetMass | 0);
  const wcNow = weightClassForMass(wmNow || 1);
  const ntMod = wcNow.netThrust >= 0 ? `+${wcNow.netThrust}` : String(wcNow.netThrust);
  const netThrustVal = (thrust != null) ? (thrust + wcNow.netThrust) : null;
  const fracLadder = wcNow.fractions.length ? wcNow.fractions.join(' ') : 'whole steps';

  const panel = document.createElement('div');
  panel.className = 'fuel-tank-panel';
  panel.innerHTML = `
    <button type="button" class="modal-x" aria-label="Close (Esc)" title="Close (Esc)">×</button>
    <h2 class="fuel-tank-title">💧 Water tank</h2>
    <p class="muted fuel-tank-sub">Tap outside or press Esc to close</p>
    <div class="fuel-tank-stage">
      <svg viewBox="0 0 120 220" class="fuel-tank-svg" preserveAspectRatio="xMidYMid meet">
        <!-- Outer cylinder (stroke only) -->
        <rect class="tank-shell" x="20" y="10" width="80" height="200" rx="14" ry="14" />
        <!-- Inner clip path so water doesn't bleed past the rim -->
        <defs>
          <clipPath id="tank-clip">
            <rect x="20" y="10" width="80" height="200" rx="14" ry="14" />
          </clipPath>
          <pattern id="tank-dry-hatch" patternUnits="userSpaceOnUse" width="8" height="8">
            <rect width="8" height="8" fill="rgba(120, 130, 170, 0.35)"/>
            <line x1="0" y1="8" x2="8" y2="0" stroke="rgba(180, 190, 210, 0.55)" stroke-width="1"/>
          </pattern>
        </defs>
        <!-- Dry-mass block: cards take up wet-mass capacity even
             before water arrives. Drawn at the bottom of the
             cylinder with a hatched fill so it reads as 'occupied
             by the hull' instead of water. -->
        <g clip-path="url(#tank-clip)">
          <rect class="tank-dry" x="20" y="200" width="80" height="10" fill="url(#tank-dry-hatch)" />
        </g>
        <!-- Falling droplet + splash layer. Sits ABOVE the water
             but inside the clip so the droplets disappear at the
             rim. JS spawns the droplet + splash <path>s during
             the fill animation. -->
        <g class="tank-drops" clip-path="url(#tank-clip)"></g>
        <!-- Water level. y + height are recomputed on each frame; the
             reference height (200) corresponds to 100% full. -->
        <g clip-path="url(#tank-clip)">
          <rect class="tank-water" x="20" y="200" width="80" height="10" />
          <rect class="tank-water-foam" x="20" y="195" width="80" height="6" />
        </g>
        <!-- Lift-mass marker: a thin amber line at the thrust
             level so the player sees the can-lift threshold. -->
        <line class="tank-lift-line" x1="20" y1="0" x2="100" y2="0"
              stroke="#fbbf24" stroke-width="1.5" stroke-dasharray="3 3"
              opacity="0" />
        <!-- Capacity tick marks every 5 units. -->
        <g class="tank-ticks"></g>
      </svg>
      <div class="fuel-tank-readout">
        <strong class="tank-now">${fromW}</strong>
        <span>/</span>
        <strong class="tank-cap">${cap}</strong>
        <em class="muted">water</em>
      </div>
    </div>
    <div class="fuel-tank-actions">
      <button type="button" class="popup-btn popup-btn-secondary" id="tank-dump-1"
        title="Drain 1 water from the tank">💧⤓ Dump 1</button>
      <button type="button" class="popup-btn popup-btn-secondary" id="tank-dump-all"
        title="Drain everything (future: forms an outpost stack once factories land)">💧⤓ Dump all</button>
    </div>
<div class="fuel-tank-aqua" id="tank-aqua-section" hidden>
      <div class="aqua-row">
        <span>🏦 Aqua bank</span>
        <strong id="aqua-balance">${getAqua()}</strong>
      </div>
      <p class="muted aqua-help">
        At LEO you can swap aqua between your bank and the
        rocket tank, 1:1, for free.
      </p>
      <div class="aqua-direction">
        <span class="aqua-direction-label">🏦 Bank → 💧 Tank</span>
        <div class="aqua-actions">
          <button type="button" class="popup-btn popup-btn-secondary" id="aqua-buy-1"
            title="Move 1 aqua from your bank into the tank">+1</button>
          <button type="button" class="popup-btn popup-btn-secondary" id="aqua-buy-5"
            title="Move 5 aqua from your bank into the tank">+5</button>
          <button type="button" class="popup-btn" id="aqua-buy-max"
            title="Fill the tank to its cap from your aqua bank">Max fill</button>
        </div>
      </div>
      <div class="aqua-direction aqua-direction-reverse">
        <span class="aqua-direction-label">💧 Tank → 🏦 Bank</span>
        <div class="aqua-actions">
          <button type="button" class="popup-btn popup-btn-secondary" id="aqua-cash-1"
            title="Drain 1 water from the tank back into your aqua bank">+1</button>
          <button type="button" class="popup-btn popup-btn-secondary" id="aqua-cash-5"
            title="Drain 5 water from the tank back into your aqua bank">+5</button>
          <button type="button" class="popup-btn" id="aqua-cash-all"
            title="Empty the tank back into your aqua bank">Cash out</button>
        </div>
      </div>
    </div>
    <p class="muted fuel-tank-dump-note">
      Dumped water is destroyed for now. Stage 3+ turns this into
      an outpost-stack drop once factories land.
    </p>
    <div class="fuel-tank-foot muted">
      Tank cap = <strong>${TANK_VIS_MAX}</strong> − dry mass
      <strong>${dryMass}</strong> = <strong>${cap}</strong> water room.
      ${thrust != null
        ? `Lift cap = thrust <strong>${thrust}</strong> − dry mass
           <strong>${dryMass}</strong> = <strong>${liftCap}</strong> liftable water.`
        : '(no active thruster)'}
    </div>
    <div class="fuel-tank-netthrust">
      <div class="ntt-head">🚀 Net Thrust track</div>
      <div class="ntt-row">
        Wet mass <strong>${wmNow}</strong> → <strong>${wcNow.id}</strong>
        weight class (<strong>${ntMod}</strong> net thrust)
      </div>
      ${thrust != null
        ? `<div class="ntt-row">Base thrust <strong>${thrust}</strong>
             ${ntMod} weight = net thrust <strong>${netThrustVal}</strong></div>`
        : '<div class="ntt-row muted">(no active thruster - no base thrust)</div>'}
      <div class="ntt-row muted">Fuel steps this band: <strong>${fracLadder}</strong></div>
      <p class="muted ntt-note">
        Heavier stacks read a lower net thrust. A burn spends fuel
        and walks the wet-mass chit toward dry mass (black line);
        refuelling walks it back up (red dotted). Each band spends
        fuel in finer fractions as mass grows.
      </p>
    </div>
  `;

  const waterRect = panel.querySelector('.tank-water');
  const foamRect  = panel.querySelector('.tank-water-foam');
  const dryRect   = panel.querySelector('.tank-dry');
  const liftLine  = panel.querySelector('.tank-lift-line');
  const nowReadout = panel.querySelector('.tank-now');
  const ticksG     = panel.querySelector('.tank-ticks');

  // Geometry: 200 svg units span TANK_VIS_MAX wet-mass units.
  // The dry-mass block fills the bottom; water sits above it.
  const unitPx = 200 / TANK_VIS_MAX;
  const dryHeightPx = dryMass * unitPx;
  const dryTopY = 210 - dryHeightPx;
  if (dryRect) {
    dryRect.setAttribute('y', String(dryTopY));
    dryRect.setAttribute('height', String(dryHeightPx));
  }
  // Lift-cap marker. Only show when the active thruster is set
  // AND the lift cap is BELOW the visual tank cap (i.e., the
  // rocket would be over-massed before the tank fills).
  if (liftLine) {
    if (thrust != null && liftCap < cap && thrust > 0) {
      const liftY = 210 - (dryMass + liftCap) * unitPx;
      liftLine.setAttribute('y1', String(liftY));
      liftLine.setAttribute('y2', String(liftY));
      liftLine.setAttribute('opacity', '0.85');
    } else {
      liftLine.setAttribute('opacity', '0');
    }
  }

  // Tick marks. One short hatch every 5 units on the right edge,
  // across the full TANK_VIS_MAX scale so the player sees the
  // absolute wet-mass position (matches the Net Thrust track).
  for (let v = 5; v <= TANK_VIS_MAX; v += 5) {
    const ty = 210 - v * unitPx;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', 100); line.setAttribute('x2', 110);
    line.setAttribute('y1', ty);  line.setAttribute('y2', ty);
    line.setAttribute('stroke', 'rgba(125, 211, 252, 0.55)');
    line.setAttribute('stroke-width', '1.5');
    ticksG.appendChild(line);
  }

  // Current water surface y (svg coord). Drops use this to know
  // when they've hit the surface. setLevel writes it each frame.
  // Water floats on top of the dry block, never inside it.
  let _surfaceY = dryTopY;
  function setLevel(level) {
    const clamped = Math.max(0, Math.min(cap, level));
    const h = clamped * unitPx;
    const waterTopY = dryTopY - h;
    _surfaceY = waterTopY;
    waterRect.setAttribute('y', String(waterTopY));
    waterRect.setAttribute('height', String(h));
    foamRect.setAttribute('y',  String(waterTopY - 3));
    foamRect.setAttribute('height', String(Math.min(6, h)));
    nowReadout.textContent = String(Math.round(clamped));
  }

  // Falling-droplet animation. Spawns teardrop <path>s at the
  // top of the tank and lets gravity drop them onto the water
  // surface. On impact, a quick splash ring expands + fades.
  // Two cadences:
  //   - fast (~110ms) while a fill / drain tween is running
  //   - ambient (~2-5s, random) while idle, so the modal has a
  //     bit of life without feeling like the tank is filling
  const dropsLayer = panel.querySelector('.tank-drops');
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const activeDrops = [];
  let lastSpawn = 0;
  let nextAmbient = 0;
  function spawnDrop(now, opts = {}) {
    const x = 30 + Math.random() * 60;      // within the tank interior
    const path = document.createElementNS(SVG_NS, 'path');
    // Teardrop shape ~6px tall, 4px wide at base.
    path.setAttribute('d', 'M 0 -3 C 2 0 2 3 0 3 C -2 3 -2 0 0 -3 Z');
    path.setAttribute('fill', '#7dd3fc');
    // Ambient drops are quieter (lower opacity, slower fall) so
    // the eye reads them as background pulse rather than fill.
    path.setAttribute('opacity', opts.ambient ? '0.55' : '0.9');
    path.setAttribute('transform', `translate(${x.toFixed(1)} 14)`);
    dropsLayer.appendChild(path);
    activeDrops.push({
      el: path, x, y: 14,
      vy: opts.ambient ? (20 + Math.random() * 15) : (60 + Math.random() * 30),
      bornAt: now,
    });
  }
  function spawnSplash(x, y) {
    const ring = document.createElementNS(SVG_NS, 'circle');
    ring.setAttribute('cx', String(x.toFixed(1)));
    ring.setAttribute('cy', String(y.toFixed(1)));
    ring.setAttribute('r', '1');
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', '#bae6fd');
    ring.setAttribute('stroke-width', '1.2');
    ring.setAttribute('opacity', '0.85');
    dropsLayer.appendChild(ring);
    const t0 = performance.now();
    const splashTick = (now) => {
      const t = Math.min(1, (now - t0) / 350);
      const r = 1 + t * 6;
      const op = 0.85 * (1 - t);
      ring.setAttribute('r', String(r.toFixed(2)));
      ring.setAttribute('opacity', String(op.toFixed(2)));
      if (t < 1) requestAnimationFrame(splashTick);
      else ring.remove();
    };
    requestAnimationFrame(splashTick);
  }
  function stepDrops(now, dtMs) {
    // Fill / drain mode: spawn rapidly so the column reads as
    // pouring water. Idle: spawn sparingly so the modal has a
    // bit of pulse without looking like the tank is refilling
    // on its own.
    if (animating) {
      if (now - lastSpawn > 110) {
        spawnDrop(now);
        lastSpawn = now;
      }
    } else if (nextAmbient && now >= nextAmbient) {
      spawnDrop(now, { ambient: true });
      nextAmbient = now + 2000 + Math.random() * 3000;
    } else if (!nextAmbient) {
      // First idle frame seeds the schedule so we don't spawn
      // a drop instantly on modal open - players see the still
      // tank first, then a quiet drop after a beat.
      nextAmbient = now + 1500 + Math.random() * 1500;
    }
    for (let i = activeDrops.length - 1; i >= 0; i--) {
      const d = activeDrops[i];
      const dts = dtMs / 1000;
      d.vy += 220 * dts;        // gravity (px/s^2)
      d.y  += d.vy * dts;
      // Landed on the water surface? Spawn splash + remove drop.
      if (d.y >= _surfaceY - 1) {
        spawnSplash(d.x, _surfaceY);
        d.el.remove();
        activeDrops.splice(i, 1);
        continue;
      }
      d.el.setAttribute('transform', `translate(${d.x.toFixed(1)} ${d.y.toFixed(1)})`);
    }
  }
  function clearDrops() {
    for (const d of activeDrops) d.el.remove();
    activeDrops.length = 0;
  }

  // Initial position.
  setLevel(fromW);

  // Skip / close. The first tap during animation jumps to the
  // final state; subsequent taps (or a tap when already final)
  // close the modal. Two-state click is intentional so the
  // player has a moment to read the result before dismissing.
  const onTap = (e) => {
    if (e.target.classList.contains('modal-x')) return;
    if (animating) {
      // Skip animation - snap the level to the active tween's
      // target and tear the tween down. The main rAF stays alive
      // (it's also driving ambient drops), so we only clear the
      // tween state + in-flight drops.
      const target = tween ? tween.to : tankNow;
      tween = null;
      animating = false;
      setLevel(target);
      clearDrops();
      finalReached = true;
      return;
    }
    if (finalReached) close();
  };
  overlay.addEventListener('click', onTap);
  panel.querySelector('.modal-x').addEventListener('click', close);

  overlay.appendChild(panel);
  mountOverlay(overlay);

  // Continuous tick. Runs from open to close so ambient drops
  // can fall while the modal sits idle. Level tweens (initial
  // refuel, drain on dump, aqua → water transfer) share this
  // loop via the `tween` slot below - they set { from, to, t0,
  // dur, onDone } and the step function handles the rest.
  // `animating` keys stepDrops's cadence so a running tween
  // pours drops fast and idle frames pour sparingly.
  let lastTick = performance.now();
  let tween = null;
  if (fromW !== tankNow) {
    tween = {
      from: fromW, to: tankNow,
      t0: performance.now(), dur: 1100,
    };
    animating = true;
  } else {
    finalReached = true;
  }
  const step = (now) => {
    const dt = now - lastTick;
    lastTick = now;
    if (tween) {
      const t = Math.min(1, (now - tween.t0) / tween.dur);
      const eased = 1 - Math.pow(1 - t, 3);  // ease-out cubic
      const v = tween.from + (tween.to - tween.from) * eased;
      setLevel(v);
      if (t >= 1) {
        const done = tween.onDone;
        tween = null;
        animating = false;
        finalReached = true;
        if (done) done();
      }
    }
    stepDrops(now, dt);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  // Note: close() already nulls activeDrops + removes the
  // overlay, so any in-flight drops vanish when the user
  // dismisses mid-animation.

  // Dump-fuel buttons. Drain water from the tank without forming
  // an outpost stack (that lands once factories ship in Stage
  // 3+). Each click: removeFuel(N), then animate the level
  // dropping from before-value to after-value over ~250ms. The
  // readout updates each frame; in-flight droplets are cleared
  // because dumping should feel like emptying, not filling.
  const dump1Btn   = panel.querySelector('#tank-dump-1');
  const dumpAllBtn = panel.querySelector('#tank-dump-all');
  const refreshDumpButtons = () => {
    const cur = getTankWater();
    if (dump1Btn)   dump1Btn.disabled   = cur <= 0;
    if (dumpAllBtn) dumpAllBtn.disabled = cur <= 0;
  };
  refreshDumpButtons();
  function drainTo(targetLevel, durationMs = 250) {
    // Hand off to the unified tween: the continuous step picks
    // it up next frame and animates setLevel without disturbing
    // ambient drops. Clearing in-flight drops keeps the visual
    // honest - emptying shouldn't look like pouring in.
    clearDrops();
    const fromLevel = parseFloat(nowReadout.textContent || String(getTankWater()));
    const toLevel = Math.max(0, targetLevel);
    if (fromLevel === toLevel) {
      refreshDumpButtons();
      return;
    }
    animating = true;
    tween = {
      from: fromLevel, to: toLevel,
      t0: performance.now(), dur: durationMs,
      onDone: () => refreshDumpButtons(),
    };
  }
  dump1Btn?.addEventListener('click', (e) => {
    // Stop the overlay's onTap handler from interpreting this
    // click as "skip animation / close" - that's why dump 1 / all
    // looked like it dismissed the modal.
    e.stopPropagation();
    if (getTankWater() <= 0) return;
    removeFuel(1);
    drainTo(getTankWater());
    logAction({
      type: 'dump',
      icon: '💧⤓',
      summary: `Dumped 1 water (tank ${getTankWater()}/${getTankMax()})`,
      undoable: false,
    });
  });
  dumpAllBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const drained = getTankWater();
    if (drained <= 0) return;
    removeFuel(drained);
    drainTo(0, 600);
    logAction({
      type: 'dump',
      icon: '💧⤓',
      summary: `Dumped ${drained} water (tank empty)`,
      undoable: false,
    });
  });

  // Aqua → water transfer panel. Gated behind LEO presence -
  // refilling water from the aqua reserve is a "back at port"
  // affordance, not something you can do mid-burn. Tank cap is
  // the lift-limit `cap` already computed above so the buttons
  // can't push past wet=32 or past thrust-mass.
  const aquaSection = panel.querySelector('#tank-aqua-section');
  const aquaBalEl   = panel.querySelector('#aqua-balance');
  const aquaBuy1Btn = panel.querySelector('#aqua-buy-1');
  const aquaBuy5Btn = panel.querySelector('#aqua-buy-5');
  const aquaBuyMaxBtn = panel.querySelector('#aqua-buy-max');
  const aquaCash1Btn  = panel.querySelector('#aqua-cash-1');
  const aquaCash5Btn  = panel.querySelector('#aqua-cash-5');
  const aquaCashAllBtn = panel.querySelector('#aqua-cash-all');
  const atLeo = isLeoSite(getRocketSite());
  if (atLeo && aquaSection) aquaSection.hidden = false;
  const refreshAquaButtons = () => {
    if (!aquaSection || aquaSection.hidden) return;
    const bal = getAqua();
    const cur = getTankWater();
    const room = Math.max(0, cap - cur);
    if (aquaBalEl) aquaBalEl.textContent = String(bal);
    if (aquaBuy1Btn)   aquaBuy1Btn.disabled   = bal < 1 || room < 1;
    if (aquaBuy5Btn)   aquaBuy5Btn.disabled   = bal < 5 || room < 1;
    if (aquaBuyMaxBtn) aquaBuyMaxBtn.disabled = bal < 1 || room < 1;
    // Reverse direction: tank → bank requires water in the tank
    // to drain back. No upper cap on the bank balance, so the
    // only gate is "do we have anything to cash out?".
    if (aquaCash1Btn)   aquaCash1Btn.disabled   = cur < 1;
    if (aquaCash5Btn)   aquaCash5Btn.disabled   = cur < 5;
    if (aquaCashAllBtn) aquaCashAllBtn.disabled = cur < 1;
  };
  refreshAquaButtons();
  // Reuse the same drainTo-style animation in reverse: get the
  // visual "from" off the on-screen readout and tween up to the
  // new tank water level. Wraps the spend + addFuel pair so a
  // failed spend doesn't leave the level mid-animation.
  const fillFromAqua = (amount, e) => {
    e?.stopPropagation();
    if (!atLeo) return;
    const cur = getTankWater();
    const room = Math.max(0, cap - cur);
    const want = Math.min(amount, room, getAqua());
    if (want <= 0) { refreshAquaButtons(); return; }
    if (!spendAqua(want)) { refreshAquaButtons(); return; }
    addFuel(want);
    const fromLevel = parseFloat(nowReadout.textContent || String(cur));
    const toLevel = getTankWater();
    if (fromLevel === toLevel) {
      refreshAquaButtons();
      return;
    }
    // Hand off to the unified tween. animating=true makes
    // stepDrops pour rapidly while the level climbs.
    animating = true;
    tween = {
      from: fromLevel, to: toLevel,
      t0: performance.now(), dur: 400,
      onDone: () => { refreshAquaButtons(); refreshDumpButtons(); },
    };
    logAction({
      type: 'aqua_transfer',
      icon: '💎→💧',
      summary: `Converted ${want} aqua → ${want} water (tank ${getTankWater()}/${cap})`,
      undoable: false,
    });
  };
  aquaBuy1Btn?.addEventListener('click',   (e) => fillFromAqua(1, e));
  aquaBuy5Btn?.addEventListener('click',   (e) => fillFromAqua(5, e));
  aquaBuyMaxBtn?.addEventListener('click', (e) => fillFromAqua(cap, e));
  // Reverse: drain water from the tank back into the aqua
  // bank (1:1). Only available at LEO. Same tween path as
  // dump-fuel, but credits the player's bank instead of
  // destroying the water.
  const cashOutToAqua = (amount, e) => {
    e?.stopPropagation();
    if (!atLeo) return;
    const cur = getTankWater();
    const want = Math.min(amount, cur);
    if (want <= 0) { refreshAquaButtons(); return; }
    removeFuel(want);
    addAqua(want);
    const fromLevel = parseFloat(nowReadout.textContent || String(cur));
    const toLevel = getTankWater();
    if (fromLevel === toLevel) {
      refreshAquaButtons();
      return;
    }
    animating = true;
    tween = {
      from: fromLevel, to: toLevel,
      t0: performance.now(), dur: 400,
      onDone: () => { refreshAquaButtons(); refreshDumpButtons(); },
    };
    logAction({
      type: 'aqua_cashout',
      icon: '💧→🏦',
      summary: `Cashed ${want} water → ${want} aqua (bank ${getAqua()})`,
      undoable: false,
    });
  };
  aquaCash1Btn?.addEventListener('click',   (e) => cashOutToAqua(1, e));
  aquaCash5Btn?.addEventListener('click',   (e) => cashOutToAqua(5, e));
  aquaCashAllBtn?.addEventListener('click', (e) => cashOutToAqua(getTankWater(), e));
  const unsubAqua = onAquaChange(refreshAquaButtons);
  const unsubRocket = onRocketChange(refreshAquaButtons);
  // Cleanup: detach listeners when the overlay tears down so a
  // closed modal doesn't keep responding to balance changes.
  const origRemove = overlay.remove.bind(overlay);
  overlay.remove = () => {
    unsubAqua();
    unsubRocket();
    origRemove();
  };
}

// Read the prospector's ISRU rating off the active face's
// properties. ISRU is a numeric property (1..N); missing /
// zero means "no water requirement". Returns the integer.
function prospectorIsruValue(card) {
  if (!card) return 0;
  const f = (card.faces && card.faces.primary) || card;
  const props = f.properties || card.properties || [];
  const e = props.find((p) => p.key === 'isru');
  if (!e) return 0;
  const v = typeof e.value === 'number' ? e.value : parseInt(e.value, 10);
  return Number.isFinite(v) ? v : 0;
}

function doProspect(site, prosp) {
  if (!prosp) return;
  // Already-prospected sites are off-limits in the sandbox; the UI
  // grays out the button when a disc is in place, but guard here
  // too so an autoclick can't double-spend.
  if (getDisc(site.id)) {
    setStatus(`This site already has a prospect disc - clear it first.`);
    return;
  }
  // ISRU rule re-validated against hydration (the "water" gate).
  // Defence-in-depth in case the popup button somehow ends up
  // enabled with a stale read.
  const prospIsru = prospectorIsruValue(prosp.card);
  const siteWater = Number.isFinite(site.hydration) ? site.hydration : 0;
  if (prospIsru > siteWater) {
    setStatus(
      `Prospect blocked: <em>${esc(prosp.card?.name || '')}</em> needs site water ≥ `
      + `${prospIsru}, site has ${siteWater}.`
    );
    return;
  }
  // Rulebook I6: Prospect is an Operation, consumes the per-turn
  // op slot regardless of dice outcome. Closing the roll modal
  // without placing the disc still costs the op (you committed to
  // the roll).
  if (!requireOp('Prospect')) return;
  const threshold = siteProspectThreshold(site);
  const roll = 1 + Math.floor(Math.random() * 6);
  const success = roll <= threshold;
  const cardName = prosp.card?.name || prosp.id;
  const kindGlyph = { missile: '🚀', raygun: '🔫', buggy: '🛺' }[prosp.kind] || '🔬';
  openProspectRollModal({ site, threshold, roll, success, kindGlyph, cardName }, () => {
    placeDisc(site.id, success ? 'success' : 'fail', {
      roll, threshold, kind: prosp.kind, by: cardName,
    });
    setStatus(
      `${kindGlyph} Prospected <strong>${esc(site.name)}</strong> `
      + `(target ≤ ${threshold}) with <em>${esc(cardName)}</em>: `
      + `rolled <strong class="big">${roll}</strong> - `
      + `<strong>${success ? 'success - claim placed' : 'failed - site exhausted'}</strong>.`
    );
    logAction({
      type: 'prospect',
      icon: kindGlyph,
      summary: `${success ? 'Claimed' : 'Exhausted'} ${site.name} (${prosp.kind}, rolled ${roll} vs ≤${threshold})`,
      undoable: false,
      data: { siteId: site.id, kind: prosp.kind, roll, threshold, success },
    });
  });
}

// Animated prospect-roll modal. Shows a 3D die on the left, the
// site's prospect target (≤ N) on the right, rolls the die for
// ~700 ms, then settles on the rolled value. The die's outer
// border tints green on success / red on fail so the player reads
// the outcome at a glance. Player then clicks "Place disc" to
// commit the result; onPlace fires once the disc lands.
function openProspectRollModal({ site, threshold, roll, success, kindGlyph, cardName }, onPlace) {
  document.querySelector('.prospect-roll-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay prospect-roll-overlay';
  const close = (placed) => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (placed && onPlace) onPlace();
  };
  // Roll animation isn't dismissible by clicking outside / Esc -
  // the player has to acknowledge the result with the Place button.
  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const btn = overlay.querySelector('.prospect-place-btn');
      if (btn && !btn.disabled) { e.preventDefault(); close(true); }
    }
  };
  document.addEventListener('keydown', onKey);

  const panel = document.createElement('div');
  panel.className = 'prospect-roll-panel';
  panel.innerHTML = `
    <h2 class="prospect-roll-title">${kindGlyph} Prospecting ${esc(site.name)}</h2>
    <p class="muted prospect-roll-sub">with <em>${esc(cardName)}</em></p>
    <div class="prospect-roll-stage">
      <div class="prospect-die-host"></div>
      <div class="prospect-roll-vs">≤</div>
      <div class="prospect-target">
        <strong>${threshold}</strong>
        <em>site size</em>
      </div>
    </div>
    <p class="prospect-roll-result muted">Rolling…</p>
    <div class="prospect-roll-actions">
      <button type="button" class="popup-btn primary prospect-place-btn" disabled>
        Place disc
      </button>
    </div>
  `;
  const dieHost = panel.querySelector('.prospect-die-host');
  const resultLine = panel.querySelector('.prospect-roll-result');
  const placeBtn = panel.querySelector('.prospect-place-btn');
  const die = buildDie(1);
  dieHost.appendChild(die);

  overlay.appendChild(panel);
  mountOverlay(overlay);

  rollDie(die, roll).then(() => {
    die.classList.add(success ? 'die-success' : 'die-fail');
    resultLine.innerHTML = success
      ? `Rolled <strong>${roll}</strong> ≤ ${threshold} - <strong class="ok">success</strong>. Claim disc ready.`
      : `Rolled <strong>${roll}</strong> > ${threshold} - <strong class="bad">failed</strong>. Site exhausted.`;
    resultLine.classList.remove('muted');
    placeBtn.disabled = false;
    placeBtn.textContent = success ? 'Place yellow claim disc' : 'Place red disc';
  });
  placeBtn.addEventListener('click', () => close(true));
}

function getRocketSite() {
  if (!_activeData) return null;
  if (_rocketSiteId) {
    const s = _activeData.sites.find((x) => x.id === _rocketSiteId);
    if (s) return s;
    _rocketSiteId = null;
    persistRocketSite();
  }
  return _activeData.sites.find(
    (x) => x.type === 'lagrange' && x.name === 'LEO'
  ) || null;
}
function persistRocketSite() {
  try {
    if (_rocketSiteId) localStorage.setItem(STORAGE_ROCKET_SITE, _rocketSiteId);
    else localStorage.removeItem(STORAGE_ROCKET_SITE);
  } catch { /* private mode */ }
}
function persistRocketTrail() {
  try {
    if (_rocketTrail && _rocketTrail.length) {
      localStorage.setItem(STORAGE_ROCKET_TRAIL, JSON.stringify(_rocketTrail));
    } else {
      localStorage.removeItem(STORAGE_ROCKET_TRAIL);
    }
  } catch { /* private mode */ }
}
// Planned route persistence. Called from every assignment to
// _plannedRoute so the multi-turn plan survives reloads - critical
// because the player might queue a 4-turn journey, end one turn,
// close the tab, come back tomorrow and expect to continue.
function persistPlannedRoute() {
  try {
    if (_plannedRoute && _plannedRoute.length) {
      localStorage.setItem(STORAGE_ROCKET_ROUTE, JSON.stringify(_plannedRoute));
    } else {
      localStorage.removeItem(STORAGE_ROCKET_ROUTE);
    }
  } catch { /* private mode */ }
}

// Tween the sandbox rocket sprite along a polyline derived from a
// list of segments. Each frame writes a new (x, y) to the renderer
// via setSandboxRocket. Resolves when the tween finishes; rejects
// silently if another animation pre-empts this one. Distance-
// weighted so longer segments take proportionally more time.
function animateRocketAlong(segments, totalMs = 700) {
  return new Promise((resolve) => {
    if (!_renderer || !_activeData || !segments || !segments.length) {
      resolve(); return;
    }
    // Build the polyline: start at segments[0].from, then walk
    // through each .to in order. Skip any segments whose endpoints
    // we can't resolve (data drift safety).
    const pts = [];
    const first = _activeData.sites.find((s) => s.id === segments[0].from);
    if (first && typeof first.x === 'number') {
      pts.push({ x: first.x, y: first.y });
    }
    for (const seg of segments) {
      const s = _activeData.sites.find((x) => x.id === seg.to);
      if (s && typeof s.x === 'number') pts.push({ x: s.x, y: s.y });
    }
    if (pts.length < 2) { resolve(); return; }
    const lens = [];
    let totalLen = 0;
    for (let i = 1; i < pts.length; i++) {
      const L = Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);
      lens.push(L);
      totalLen += L;
    }
    if (totalLen === 0) { resolve(); return; }
    const r = isRocketActive();
    const t0 = performance.now();
    _rocketAnimating = true;
    const step = (now) => {
      const t = Math.min(1, (now - t0) / totalMs);
      // ease-in-out cubic - accelerates off the launch site,
      // decelerates into the landing site.
      const eased = t < 0.5
        ? 4 * t * t * t
        : 1 - Math.pow(-2 * t + 2, 3) / 2;
      let traveled = eased * totalLen;
      let i = 0;
      while (i < lens.length - 1 && traveled > lens[i]) {
        traveled -= lens[i];
        i += 1;
      }
      const k = lens[i] > 0 ? traveled / lens[i] : 0;
      const pos = {
        x: pts[i].x + (pts[i+1].x - pts[i].x) * k,
        y: pts[i].y + (pts[i+1].y - pts[i].y) * k,
      };
      _renderer.setSandboxRocket({
        x: pos.x, y: pos.y,
        colour: 'yellow',
        canFly: r.active,
      });
      if (t < 1) requestAnimationFrame(step);
      else {
        _rocketAnimating = false;
        resolve();
      }
    };
    requestAnimationFrame(step);
  });
}

// BOOST commit button next to the hand title. Lit when at
// least one card is marked. Per the variant cargo flow (user,
// 2026-05-24): Boost moves cards Hand -> LEO Stack (not
// directly onto the rocket), so the button is rocket-location-
// independent - it just needs marked cards. The separate
// Transfer free action (LEO popup) moves cards LEO -> Rocket
// when the rocket is parked at LEO.
function repaintBoostCommit() {
  const btn = document.getElementById('hand-boost-commit');
  if (!btn) return;
  const n = getBoostMarked().length;
  btn.dataset.armed = n > 0 ? '1' : '0';
  btn.disabled = n === 0;
  btn.textContent = n > 0 ? `🛰 BOOST → LEO (${n})` : '🛰 BOOST → LEO';
  btn.title = n > 0
    ? `Boost ${n} marked card${n === 1 ? '' : 's'} from your hand into the LEO Stack. Costs one operation. Use the Transfer action at LEO to move them onto the rocket.`
    : 'Mark cards in your hand, then press BOOST to ship them up to your LEO Stack.';
}

// Dry mass of cards currently on the active rocket stack.
// Used to compute the rocket's water-tank cap (TANK_MAX - dry)
// when cards transfer onto the rocket (more cards = less room
// for water). LEO has no tank, so there's no LEO equivalent.
function rocketStackDryMass() {
  let mass = 0;
  for (const slot of getRocketStack()) {
    const c = PATENTS_BY_ID[slot.id];
    if (!c) continue;
    const f = (c.faces && c.faces.primary) || c;
    mass += ((f.mass != null ? f.mass : c.mass) | 0);
  }
  return mass;
}

function syncSandboxRocket() {
  if (!_renderer) return;
  // The boost button depends on the rocket's site (which
  // changes after every move), so refresh it whenever the
  // sandbox rocket sprite syncs.
  repaintBoostCommit();
  const stack = getRocketStack();
  // The rocket sprite is ALWAYS drawn (per user, 2026-05-24:
  // "need a rocket sprite here as well to show this is where my
  // rocket is, but it is not functional"). The 🚫 overlay
  // distinguishes empty / unactivatable vs active states; an
  // empty stack at LEO still reads as "your rocket lives here"
  // so the player isn't confused when their cards are sitting
  // in LEO Stack but the rocket itself looks gone.
  const r = isRocketActive();
  const site = getRocketSite();
  const x = site && typeof site.x === 'number' ? site.x : LEO_ANCHOR.x;
  const y = site && typeof site.y === 'number' ? site.y : LEO_ANCHOR.y;
  // Active prospector kind is forwarded to the renderer so it can
  // badge the rocket sprite with the right glyph (🚀 / 🔫 / 🛺).
  // Only badged when the prospector's supports are met - otherwise
  // it's just dead weight and shouldn't read as "active".
  const prosp = getActiveProspectorStats();
  const prospectorKind = (prosp && prosp.canActivate) ? prosp.kind : null;
  // Card name + ISRU travel with the sprite so the renderer's
  // badge-hover tooltip can show them without having to import
  // rocket state itself.
  const prospectorName = prosp && prosp.card ? prosp.card.name : null;
  const prospectorIsru = prosp ? prospectorIsruValue(prosp.card) : null;
  // Active thruster summary for the rocket-hover tooltip
  // (modifier-baked thrust + fuel-per-burn so the player sees
  // the "final" numbers, not the printed ones).
  const thrStats = getActiveThrusterStats();
  const thrusterSummary = thrStats ? {
    name:       thrStats.name,
    thrust:     thrStats.thrust,
    fuel:       thrStats.fuel,
    baseThrust: thrStats.baseThrust,
    baseFuel:   thrStats.baseFuel,
    canLift:    thrStats.canLift,
    wetMass:    thrStats.wetMass,
  } : null;
  _renderer.setSandboxRocket({
    x, y,
    colour: 'yellow',
    canFly: r.active,       // drives the 🚫 + transparency overlay
    prospectorKind,
    prospectorName,
    prospectorIsru,
    thruster: thrusterSummary,
  });
}

// Push the current disc state into the renderer so already-
// prospected sites paint a coloured chit. Subscribed once at
// mount time + on every disc change.
function syncDiscs() {
  if (!_renderer) return;
  _renderer.setDiscs(getDiscs());
}

// Stage-3 sync helpers: push factory / colony / outpost / focus
// state to the renderer so the chit layers repaint. Each is a
// thin wrapper around the corresponding all-state getter and
// setter pair; subscribed at mount time to the state stores.
function syncFactories() {
  if (!_renderer) return;
  const map = {};
  for (const f of allFactories()) map[f.siteId] = f;
  _renderer.setFactories(map);
}
function syncColonies() {
  if (!_renderer) return;
  const map = {};
  for (const c of allColonies()) map[c.siteId] = c;
  _renderer.setColonies(map);
}
function syncOutposts() {
  if (!_renderer) return;
  _renderer.setOutposts(getOutposts());
}
// Translate the focused-stack id ('rocket' | 'outpostA' | ...)
// into a site id for the renderer's focus ring. LEO focus has
// no map site, so we pass null.
function syncFocusedSite() {
  if (!_renderer) return;
  const id = getFocusedStackId();
  if (id === 'rocket') {
    const site = getRocketSite();
    _renderer.setFocusedSiteId(site ? site.id : null);
    return;
  }
  if (id && id.startsWith('outpost')) {
    const letter = id.slice('outpost'.length);
    const op = getOutpost(letter);
    _renderer.setFocusedSiteId(op ? op.siteId : null);
    return;
  }
  // LEO focus - clear the map ring.
  _renderer.setFocusedSiteId(null);
}

// Rocket exploded mid-move. Animation runs at the failed-hazard
// position; once the visual finishes (or in parallel, depending
// on timing), every card in the stack returns to the player's
// hand, the tank is dumped, and the rocket vanishes from the map
// (snapping back to LEO on next sync). Aqua is unaffected; the
// player's investment is the cards + the wet mass they were
// hauling. Move is consumed and locked - no undo path.
async function explodeRocket(siteId) {
  const site = _activeData && _activeData.sites.find((x) => x.id === siteId);
  const x = site && Number.isFinite(site.x) ? site.x : null;
  const y = site && Number.isFinite(site.y) ? site.y : null;
  const tankLost = getTankWater();
  // Snapshot stack BEFORE clearing so we know what to return.
  const stackSnapshot = getRocketStack().slice();
  // Pan the camera to the explosion so the player actually sees
  // it - mid-flight the camera may have followed but a
  // mid-modal scroll could've left the map elsewhere.
  if (_renderer && x != null && y != null) {
    if (typeof _renderer.flyTo === 'function') {
      _renderer.flyTo({ x, y }, locateZoom(Math.max(_renderer.zoom || 2, 3)));
    }
    _renderer.triggerExplosion(x, y);
  }
  setStatus(`💥 Rocket exploded at <strong>${esc(site ? site.name : siteId)}</strong>.`);
  // Wait roughly the explosion's lifetime so the sprite vanishing
  // doesn't pop before the burst plays out.
  await new Promise((res) => setTimeout(res, 1100));
  // Return cards to hand. addToHand rejects cards already there
  // or in the rocket; clearing the stack first keeps the second
  // check from blocking each addToHand call. We collect counts so
  // the log entry tells the player exactly what came back.
  // Crew is the exception: it always re-spawns in the LEO Stack
  // (variant rule, user 2026-05), even when it dies in a mishap.
  rocketClearStack();
  let returned = 0;
  let crewToLeo = 0;
  for (const slot of stackSnapshot) {
    if (slot.kind === 'crew' || CREW.some((c) => c.id === slot.id)) {
      if (addCardToLeo({ id: slot.id, kind: 'crew', face: slot.face })) crewToLeo++;
      continue;
    }
    const card = PATENTS_BY_ID[slot.id] || null;
    if (!card) continue;
    const r = addToHand(card);
    if (r && r.ok) returned++;
  }
  // Reset the rocket's position - getRocketSite() falls back to
  // LEO when _rocketSiteId is null, so the sprite redraws there.
  _rocketSiteId = null;
  persistRocketSite();
  // Wipe the planned route + walked trail - the rocket no
  // longer has a journey to continue. Trail clears too so the
  // cyan breadcrumbs don't dangle from a now-dead rocket.
  _plannedRoute = null;
  persistPlannedRoute();
  exitManualMoveMode();
  _rocketTrail = [];
  persistRocketTrail();
  if (_renderer) {
    _renderer.setRoute(null);
    _renderer.setRouteEndpoints(null, null);
    _renderer.setRocketTrail(null);
  }
  _moveSnapshot = null;
  const clearBtn = document.getElementById('route-clear');
  if (clearBtn) clearBtn.hidden = true;
  logAction({
    type: 'explode',
    icon: '💥',
    summary: `Rocket destroyed at ${site ? site.name : siteId}`
      + ` - ${returned} card${returned === 1 ? '' : 's'} returned to hand`
      + (crewToLeo > 0 ? `, ${crewToLeo} crew to LEO stack` : '')
      + (tankLost > 0 ? `, ${tankLost} water lost` : ''),
    undoable: false,
    data: { siteId, returnedCards: returned, crewToLeo, waterLost: tankLost },
  });
  syncSandboxRocket();
  refreshOpenSitePopup();
  // Acknowledge dialog - the explosion + state reset already
  // happened, but a player who looked away mid-animation needs a
  // clear "your ship is gone" beat before they go back to the
  // map. Single OK button; await so the caller's status text
  // doesn't get clobbered by anything that runs after this.
  await confirmModal({
    title: '💥 Spacecraft destroyed',
    body: `Your rocket was lost at <strong>${esc(site ? site.name : siteId)}</strong>. `
      + `<strong>${returned}</strong> card${returned === 1 ? '' : 's'} returned to your hand`
      + (crewToLeo > 0 ? `, <strong>${crewToLeo}</strong> crew re-spawned in your LEO stack` : '')
      + (tankLost > 0 ? `, <strong>${tankLost}</strong> water lost` : '')
      + `. Rebuild from the LEO stack to fly again.`,
    yes: 'OK',
    no: '',
  });
}

// Step the rocket through its planned route's "turn 1" segments
// (one move per turn, capped at BURNS_PER_TURN burns of cumulative
// dv). The remaining segments shift down a turn so the next move
// walks what was previously turn 2. Returns true on success.
async function moveRocket() {
  if (!_renderer || !_activeData) return false;
  if (_rocketAnimating) return false;
  if (!_plannedRoute || !_plannedRoute.length) {
    setStatus('No planned route - tap a site and pick "Plan rocket route" first.');
    return false;
  }
  const turn1 = _plannedRoute.filter((s) => s.turn === 1);
  if (!turn1.length) {
    setStatus('Planned route has no current-turn segments.');
    return false;
  }
  // Fuel consumption (new-game setting, default on): a move spends
  // fuel-per-burn × burns of water from the tank. Pre-flight block
  // when the tank can't cover it. When the setting is off, moves
  // are free.
  const turn1Burns = turn1.reduce((s, x) => s + (x.burns || 1), 0);
  const _thrFuel = getActiveThrusterStats();
  const fuelCost = (getFuelConsumption() && _thrFuel && Number.isFinite(_thrFuel.fuel))
    ? Math.ceil(_thrFuel.fuel * turn1Burns) : 0;
  if (fuelCost > 0 && getTankWater() < fuelCost) {
    const per = Math.round(_thrFuel.fuel * 100) / 100;
    setStatus(`⛽ Not enough water: this move needs <strong>${fuelCost}</strong> `
      + `(${turn1Burns} burn${turn1Burns === 1 ? '' : 's'} × ${per}), tank has <strong>${getTankWater()}</strong>. Refuel at LEO / a factory first.`);
    return false;
  }
  // Hazard pre-flight check. Two flavours along a route:
  //   - generic (☠ skull / 🪂 aerobrake) → aqua-payable, or
  //     roll d6 (1 = rocket destroyed at that node)
  //   - radiation (☢) → NOT payable; check the active thruster's
  //     thrust against a season-based bypass threshold, else roll
  //     d6 per zone and decommission any stack card whose
  //     rad-hard is less than the highest roll
  // Generic hazards prompt the pay/roll/cancel modal first; rad
  // hazards run their own check afterwards (always - they can't
  // be skipped by paying). Both, when actually resolved (paid OR
  // rolled), lock undo for the rest of the turn. The actual
  // dice DON'T roll here - they fire one at a time inside the
  // move-queue below, in route order, so an early rad failure
  // can stop the ship before a later generic hazard is reached.
  const hazards = routeHazards(turn1);
  const radHazards     = hazards.filter((h) => h.site.type === 'radhaz');
  const genericHazards = hazards.filter((h) => h.site.type !== 'radhaz');
  let hazardChoice = null;
  let lockUndo = false;
  if (genericHazards.length) {
    hazardChoice = await hazardConfirmModal(genericHazards);
    if (hazardChoice === 'cancel' || hazardChoice == null) {
      setStatus('Move cancelled - no aqua spent, no rolls made.');
      return false;
    }
    if (hazardChoice === 'pay') {
      const cost = genericHazards.length * HAZARD_COST_PER;
      if (!spendAqua(cost)) {
        setStatus(`Need ${cost} aqua to bypass - balance only ${getAqua()}.`);
        return false;
      }
      logAction({
        type: 'hazard_pay',
        icon: '💎',
        summary: `Paid ${cost} aqua to bypass ${genericHazards.length} hazard`
          + `${genericHazards.length === 1 ? '' : 's'}`,
        undoable: false,
        data: { cost, hazards: genericHazards.map((h) => h.site.id) },
      });
      lockUndo = true;
    } else if (hazardChoice === 'roll') {
      // Defer dice to the per-hazard queue. Just mark the
      // undo-lockout - the player has committed to rolling.
      lockUndo = true;
    }
  }
  // Rad confirm. Same shape as the generic confirm: player sees
  // the formula upfront, picks confirm or cancel. Actual rolls
  // happen one-at-a-time in the queue below.
  let radWillRoll = false;
  let radThrust = 0;
  let radSeasonBonus = 0;
  if (radHazards.length) {
    const thrStats = getActiveThrusterStats();
    radThrust = thrStats && Number.isFinite(thrStats.thrust) ? thrStats.thrust : 0;
    let season = null;
    try { season = getSeason(); } catch { season = null; }
    radSeasonBonus = season && season.name === 'red' ? 2 : 0;
    const threshold = radBypassThreshold();
    const radChoice = await radConfirmModal(radHazards, radThrust, radSeasonBonus, threshold);
    if (radChoice === 'cancel' || radChoice == null) {
      if (hazardChoice === 'pay') {
        // Generic hazards charged aqua already; refund so the
        // cancel doesn't leave the player out of pocket.
        const refundCost = genericHazards.length * HAZARD_COST_PER;
        addAqua(refundCost);
        logAction({
          type: 'hazard_refund',
          icon: '💧',
          summary: `Move cancelled at rad check - refunded ${refundCost} aqua`,
          undoable: false,
          data: { refund: refundCost },
        });
      }
      setStatus('Move cancelled at the rad check.');
      return false;
    }
    if (radThrust > threshold) {
      logAction({
        type: 'rad_bypass',
        icon: '☢',
        summary: `Thrust ${radThrust} > ${threshold} - bypassed `
          + `${radHazards.length} rad zone${radHazards.length === 1 ? '' : 's'} without rolling`,
        undoable: false,
        data: { thrust: radThrust, threshold, sites: radHazards.map((h) => h.site.id) },
      });
    } else {
      radWillRoll = true;
      lockUndo = true;
    }
  }
  if (lockUndo) setHazardousMove(true);
  if (!consumeMove()) {
    setStatus('No moves left this turn - end turn to refresh.');
    return false;
  }
  // Spend the move's fuel now that it's committed (refunded on undo).
  if (fuelCost > 0) removeFuel(fuelCost);
  // Snapshot for undo BEFORE mutating - both the rocket's site
  // and the full route shape + the segments we're about to walk,
  // so an undo can slide back along the exact path.
  const newSiteId = turn1[turn1.length - 1].to;
  const arrived = _activeData.sites.find((x) => x.id === newSiteId);
  const arrivedName = arrived ? arrived.name : newSiteId;
  const arrivedZone = arrived && arrived.solarZone ? arrived.solarZone : null;
  // Record everything we'll need to undo BEFORE mutating - site,
  // route, segments walked, the chit (if any) we're about to
  // award for first-time zone entry, and the auto-cash payload
  // (if we're landing back at LEO with chits in hand).
  const willAwardChit = arrivedZone && arrivedZone !== 'Earth' && !isZoneVisited(arrivedZone);
  const willCashIn = isLeoSite(arrived) && getChits().length > 0;
  const chitsToCash = willCashIn ? getChits() : [];
  _moveSnapshot = {
    siteId: _rocketSiteId,
    route: _plannedRoute.map((s) => ({ ...s })),
    movedSegments: turn1.map((s) => ({ ...s })),
    awardedZone: willAwardChit ? arrivedZone : null,
    cashedChits: null,        // filled in below if a cash-in fires
    cashedVps:   0,
    fuelSpent:   fuelCost,
  };
  // Move queue. Walk turn1 segments in order, pausing at each
  // hazard node to resolve it (animate-to + roll modal). An
  // early critical kills the ship before later hazards even
  // see the dice. Trail + _rocketSiteId update incrementally
  // so an explosion mid-route reports the right location.
  setStatus(`🛸 Moving rocket to <strong>${esc(arrivedName)}</strong>…`);
  const hazardIndexById = new Map();
  for (const h of hazards) {
    const idx = turn1.findIndex((s) => s.to === h.site.id);
    if (idx >= 0) hazardIndexById.set(h.site.id, { idx, hazard: h });
  }
  const orderedHazards = [...hazardIndexById.values()].sort((a, b) => a.idx - b.idx);
  let lastIdx = 0;
  const advanceTo = async (targetIdx) => {
    if (targetIdx < lastIdx) return;
    const slice = turn1.slice(lastIdx, targetIdx + 1);
    if (!slice.length) return;
    await animateRocketAlong(slice);
    _rocketTrail = _rocketTrail.concat(slice.map((s) => ({ from: s.from, to: s.to })));
    persistRocketTrail();
    _renderer.setRocketTrail(_rocketTrail);
    _rocketSiteId = slice[slice.length - 1].to;
    persistRocketSite();
    lastIdx = targetIdx + 1;
  };
  // Tracks whether the player switched to "pay for the rest"
  // mid-queue; flips remaining generic hazards to the paid path
  // without re-rolling. Starts true when the upfront choice was
  // already 'pay' so the queue uniformly checks one flag.
  let payRemainingGeneric = (hazardChoice === 'pay');
  let earlyHalt = false;
  let haltSite = null;
  for (let qi = 0; qi < orderedHazards.length; qi++) {
    const { idx, hazard } = orderedHazards[qi];
    await advanceTo(idx);
    const isRad = hazard.site.type === 'radhaz';
    if (isRad) {
      if (!radWillRoll) {
        // Bypass already logged upfront; just animate past.
      } else {
        const stackCards = getRocketStack()
          .map((slot) => {
            const card = PATENTS_BY_ID[slot.id]
              || CREW.find((c) => c.id === slot.id) || null;
            if (!card) return null;
            return {
              id: slot.id,
              name: card.name,
              radHardness: card.radHardness != null ? card.radHardness : 0,
            };
          })
          .filter(Boolean);
        const { rolls: radRolls, decommission } = await radHardnessRollModal(
          [hazard], stackCards, radThrust, radSeasonBonus,
        );
        for (const r of radRolls) {
          logAction({
            type: 'rad_roll',
            icon: '☢',
            summary: `☢ ${esc(r.site.name)} d6=${r.d6}`
              + (radSeasonBonus ? ` +${radSeasonBonus} (red)` : '')
              + (radThrust ? ` −${radThrust} thrust` : '')
              + ` = rad ${r.rad}`,
            undoable: false,
            data: { siteId: r.site.id, d6: r.d6, rad: r.rad, thrust: radThrust, seasonBonus: radSeasonBonus },
          });
        }
        if (decommission && decommission.length) {
          let lost = 0;
          for (const cardId of decommission) {
            const ridx = getRocketStack().findIndex((s) => s.id === cardId);
            if (ridx < 0) continue;
            rocketRemoveCard(ridx);
            const card = PATENTS_BY_ID[cardId]
              || CREW.find((c) => c.id === cardId) || null;
            if (card) {
              const r = addToHand(card);
              if (r && r.ok) lost++;
            }
          }
          logAction({
            type: 'rad_decommission',
            icon: '☢',
            summary: `☢ ${esc(hazard.site.name)}: ${lost} card${lost === 1 ? '' : 's'} decommissioned to hand`,
            undoable: false,
            data: { siteId: hazard.site.id, decommission, count: lost },
          });
        }
      }
    } else {
      // Generic hazard. Paid path animates past silently; rolled
      // path opens the dice modal. payRemainingGeneric flips when
      // the player switches to "pay the rest" mid-queue.
      if (!payRemainingGeneric) {
        const rolls = await hazardRollModal([hazard]);
        const r = rolls[0];
        const verdict = r.d6 === 1 ? '✗ critical (rolled 1)' : '✓ survived';
        logAction({
          type: 'hazard_roll',
          icon: r.glyph,
          summary: `${r.glyph} ${esc(r.site.name)} d6=${r.d6} ${verdict}`,
          undoable: false,
          data: { siteId: r.site.id, d6: r.d6 },
        });
        if (r.d6 === 1) {
          setStatus(`💥 Critical failure at <strong>${esc(r.site.name)}</strong>…`);
          await explodeRocket(r.site.id);
          return false;
        }
      }
    }
    // Post-resolve safety net: a decommissioned active thruster
    // (or its support cards) might have killed the rocket's
    // ability to fly. If so, halt right here - the rocket
    // strands on the hazard node, future turns can rebuild.
    const flyCheck = isRocketActive();
    if (!flyCheck.active) {
      earlyHalt = true;
      haltSite = hazard.site;
      logAction({
        type: 'stranded',
        icon: '🛰',
        summary: `Stranded at ${esc(hazard.site.name)} - ${esc(flyCheck.reason || 'rocket cannot fly')}`,
        undoable: false,
        data: { siteId: hazard.site.id, reason: flyCheck.reason, missing: flyCheck.missing },
      });
      setStatus(`🛰 Stranded at <strong>${esc(hazard.site.name)}</strong> - ${esc(flyCheck.reason)}.`);
      break;
    }
    // Mid-route choice if any hazards still ahead. The player
    // can Continue, Stop here, or Pay aqua to bypass the
    // remaining generic hazards.
    const remaining = orderedHazards.slice(qi + 1);
    if (remaining.length) {
      const choice = await midRouteChoiceModal({
        atSiteName: hazard.site.name,
        remaining,
        aquaBalance: getAqua(),
      });
      if (choice === 'stop') {
        earlyHalt = true;
        haltSite = hazard.site;
        logAction({
          type: 'manual_halt',
          icon: '⏹',
          summary: `Halted at ${esc(hazard.site.name)} - ${remaining.length} hazard${remaining.length === 1 ? '' : 's'} skipped`,
          undoable: false,
          data: { siteId: hazard.site.id, skipped: remaining.length },
        });
        setStatus(`⏹ Halted at <strong>${esc(hazard.site.name)}</strong>.`);
        break;
      }
      if (choice === 'pay') {
        const remGeneric = remaining.filter((r) => r.hazard.site.type !== 'radhaz');
        const cost = remGeneric.length * HAZARD_COST_PER;
        if (cost > 0 && spendAqua(cost)) {
          payRemainingGeneric = true;
          logAction({
            type: 'hazard_pay',
            icon: '💧',
            summary: `Paid ${cost} aqua mid-route to bypass ${remGeneric.length} remaining generic hazard${remGeneric.length === 1 ? '' : 's'}`,
            undoable: false,
            data: { cost, hazards: remGeneric.map((r) => r.hazard.site.id) },
          });
        }
      }
      // 'continue' falls through to the next iteration.
    }
  }
  // If we halted early, shift remaining segments (the ones we
  // never walked) into next-turn slots so the player can resume
  // the journey later. The destination for THIS move is the
  // last node we actually reached, not the original target.
  if (earlyHalt) {
    const haltedSiteId = (haltSite && haltSite.id) || _rocketSiteId;
    // Carry-over: every segment past `lastIdx` becomes turn 2+
    // in the planned route. The post-move "shift down" logic
    // later will turn those into the next turn's playables.
    const carry = turn1.slice(lastIdx).map((s, i) => ({ ...s, turn: 2 + Math.floor(i / 4) }));
    const futureTurns = _plannedRoute
      .filter((s) => s.turn > 1)
      .map((s) => ({ ...s, turn: s.turn + 1 }));
    _plannedRoute = carry.concat(futureTurns);
    persistPlannedRoute();
    if (_renderer) _renderer.setRoute(_plannedRoute);
    _rocketSiteId = haltedSiteId;
    persistRocketSite();
    // Log the move under the halted site so the audit trail
    // matches reality.
    logAction({
      type: 'move',
      icon: '🛸',
      summary: `Moved to ${esc(haltSite ? haltSite.name : haltedSiteId)} (halted early)`,
      undoable: false,
      data: { siteId: haltedSiteId, hazardous: true, halted: true },
    });
    syncSandboxRocket();
    refreshOpenSitePopup();
    return true;
  }
  // Animate the tail (everything past the last hazard) to the
  // final destination.
  if (lastIdx < turn1.length) {
    const tail = turn1.slice(lastIdx);
    await animateRocketAlong(tail);
    _rocketTrail = _rocketTrail.concat(tail.map((s) => ({ from: s.from, to: s.to })));
    persistRocketTrail();
    _renderer.setRocketTrail(_rocketTrail);
  }
  _rocketSiteId = newSiteId;
  persistRocketSite();
  // Log the move + award glory chit on first-time zone entry +
  // auto-cash any chits if we just landed at LEO. Each side-
  // effect appends to the mission log so the player can audit
  // (and undo) the whole sequence as one move.
  // Hazardous moves (paid generic, rolled generic, OR any rad
  // resolution that touched the dice) lock undo for the turn -
  // the lockout flag was already set above; here we just label
  // the log entry and flip undoable to match.
  logAction({
    type: 'move',
    icon: '🛸',
    summary: hazardChoice === 'pay'
      ? `Moved to ${arrivedName} (paid past ${genericHazards.length} hazard${genericHazards.length === 1 ? '' : 's'})`
      : hazardChoice === 'roll'
        ? `Moved to ${arrivedName} (rolled through ${genericHazards.length} hazard${genericHazards.length === 1 ? '' : 's'})`
        : lockUndo
          ? `Moved to ${arrivedName} (radiation crossed)`
          : `Moved to ${arrivedName}`,
    undoable: !lockUndo,
    data: { siteId: newSiteId, zone: arrivedZone, hazardous: lockUndo },
  });
  if (willAwardChit) {
    awardChitForZone(arrivedZone, getTurn());
    const vp = getChitVpValue(arrivedZone);
    logAction({
      type: 'glory_award',
      icon: '🏆',
      summary: `Glory chit earned - ${arrivedZone} (${vp} VP at cash-in)`,
      undoable: false,
    });
  }
  if (willCashIn) {
    const res = cashInChits(`returned to ${arrivedName}`);
    _moveSnapshot.cashedChits = chitsToCash;
    _moveSnapshot.cashedVps   = res.vps;
    logAction({
      type: 'glory_cash',
      icon: '💰',
      summary: `Cashed ${chitsToCash.length} chit${chitsToCash.length === 1 ? '' : 's'} for ${res.vps} VP`,
      undoable: false,
    });
  }
  // Shift remaining segments down a turn (T2→T1, T3→T2, …).
  const remaining = _plannedRoute
    .filter((s) => s.turn > 1)
    .map((s) => ({ ...s, turn: s.turn - 1 }));
  if (remaining.length) {
    _plannedRoute = remaining;
    persistPlannedRoute();
    _renderer.setRoute(remaining);
    const nextBurns = remaining.filter((s) => s.turn === 1).length;
    setStatus(
      `🛸 Moved to <strong>${esc(arrivedName)}</strong>. `
      + `${nextBurns} burn${nextBurns === 1 ? '' : 's'} queued for next turn.`
    );
  } else {
    _plannedRoute = null;
    persistPlannedRoute();
    _renderer.setRoute(null);
    _renderer.setRouteEndpoints(null, null);
    _routeFrom = null;
    _routeTo = null;
    // Manual mode wraps up here too - no remaining segments
    // means there's nothing more to plot, so the toolbar should
    // flip back to its normal "plan a route" labels.
    exitManualMoveMode();
    const clearBtn = document.getElementById('route-clear');
    if (clearBtn) clearBtn.hidden = true;
    setStatus(`🛸 Arrived at <strong>${esc(arrivedName)}</strong>.`);
  }
  // Final sync - the animation left the sprite at the destination's
  // pixel coords; this pins it back to the canonical site (x, y)
  // and ensures canFly reflects the live stack state.
  syncSandboxRocket();
  refreshOpenSitePopup();
  return true;
}

// Restore the pre-move state captured in _moveSnapshot. Wired to
// the 🛸 toggle's "undo" face (yellow ↩ 🛸) - the player can step
// back as long as they haven't ended the turn yet. The rocket
// slides backwards along the exact segments it walked.
async function undoRocketMove() {
  if (!_renderer) return false;
  if (_rocketAnimating) return false;
  // Hazard-lockout: if the last move spent aqua or rolled dice,
  // the undo is blocked for the rest of the turn. Show a clear
  // "why" dialog so the player isn't confused by the dead button.
  if (_lastMoveHazardous) {
    await blockedUndoModal();
    return false;
  }
  if (!_moveSnapshot) {
    // No snapshot but the budget is spent - just refund so the
    // button flips back to the move face. Rare path (e.g. moved
    // before a reload that dropped the snapshot).
    refundMove();
    return false;
  }
  // Animate back along the segments we walked, in reverse.
  const moved = _moveSnapshot.movedSegments || [];
  const reverseSegs = moved
    .slice()
    .reverse()
    .map((s) => ({ from: s.to, to: s.from }));
  // Pop the moved segments off the trail immediately so it doesn't
  // visually overshoot the rocket during the rewind tween.
  if (moved.length && _rocketTrail.length >= moved.length) {
    _rocketTrail = _rocketTrail.slice(0, _rocketTrail.length - moved.length);
    persistRocketTrail();
    _renderer.setRocketTrail(_rocketTrail);
  }
  // Unwind glory side-effects in reverse order: cash-in first
  // (restore chits to inventory + refund VPs), then revoke the
  // first-time-zone chit that was earned by the move. Each pops
  // its matching log entry so the audit trail stays consistent.
  if (_moveSnapshot.cashedChits && _moveSnapshot.cashedChits.length) {
    uncashChits(_moveSnapshot.cashedChits, _moveSnapshot.cashedVps || 0);
    popLastOfType('glory_cash');
  }
  if (_moveSnapshot.awardedZone) {
    revokeChitForZone(_moveSnapshot.awardedZone);
    popLastOfType('glory_award');
  }
  popLastOfType('move');
  setStatus('🛸 Rewinding rocket move…');
  await animateRocketAlong(reverseSegs);
  _rocketSiteId = _moveSnapshot.siteId;
  persistRocketSite();
  _plannedRoute = _moveSnapshot.route;
  persistPlannedRoute();
  if (_plannedRoute && _plannedRoute.length) {
    _renderer.setRoute(_plannedRoute);
    const first = _plannedRoute[0];
    const last  = _plannedRoute[_plannedRoute.length - 1];
    _renderer.setRouteEndpoints(first.from, last.to);
    const clearBtn = document.getElementById('route-clear');
    if (clearBtn) clearBtn.hidden = false;
  }
  if (_moveSnapshot.fuelSpent) addFuel(_moveSnapshot.fuelSpent);
  _moveSnapshot = null;
  refundMove();
  syncSandboxRocket();
  refreshOpenSitePopup();
  setStatus('🛸 Rocket move undone.');
  return true;
}

// Solo state change -> refresh the panel + the ship marker on the
// map. The listener is hooked once (sidebar wire-up time) and
// dispatches whenever solo.js calls emit().
function syncSoloShipMarker() {
  if (!_renderer) return;
  const s = soloState();
  if (s && !s.gameOver) {
    _renderer.setPlayerShipId(s.ship.at);
    _renderer.setRoute(s.pendingPath ? s.pendingPath.segments : null);
    _renderer.setRouteEndpoints(s.ship.at, s.pendingTargetId || null);
  } else {
    _renderer.setPlayerShipId(null);
  }
}


function enterRoutingMode(origin) {
  _routingMode = true;
  _routeFrom = origin;
  _routeTo = null;
  if (_renderer) {
    _renderer.setRoute(null);
    _renderer.setRouteEndpoints(origin.id, null);
  }
  document.querySelector('.browse-shell')?.classList.add('is-routing');
  document.getElementById('route-clear').hidden = false;
  setStatus(
    `Picking destination from <strong>${esc(origin.name)}</strong> - `
    + `tap any landable site. Press Clear route to cancel.`
  );
}

function exitRoutingMode() {
  _routingMode = false;
  document.querySelector('.browse-shell')?.classList.remove('is-routing');
}

function onSiteSelect(site) {
  // Manual move mode intercepts every tap: each one tries to
  // append a segment to the planned route from the current tip
  // (rocket position → last placed segment.to). Non-neighbours
  // and out-of-budget taps fall through to a status message,
  // they DON'T open the regular popup so the player doesn't
  // accidentally exit the planning flow.
  if (_manualMode && site && site.id) {
    if (site.isDecorative || site.isLandable === false) {
      setStatus(`<strong>${esc(site.name)}</strong> isn't a landable site.`);
      return;
    }
    manualAppendSegment(site.id);
    return;
  }

  // Solo mode hijacks clicks: every site you tap becomes the
  // proposed destination for your ship's current position.
  const s = soloState();
  if (s && !s.gameOver) {
    if (site.id === s.ship.at) {
      soloSetTarget(null);
    } else if (site.isLandable === false || site.isDecorative) {
      // Sun, Earth-as-flavour-body, decoratives -- not pickable.
    } else {
      soloSetTarget(site.id);
    }
    showPane('solo');
    return;
  }

  // Routing-pick mode: the user already pressed "Navigate to" on
  // an origin and now the next tap is the destination. Plot the
  // route and exit routing mode. The destination becomes the
  // currently-selected site so the popup + highlight stay in sync
  // with what the player most recently tapped.
  if (_routingMode && _routeFrom) {
    if (site.isDecorative || site.isLandable === false) {
      setStatus(`<strong>${esc(site.name)}</strong> is not landable - pick another site.`);
      return;
    }
    if (site.id === _routeFrom.id) {
      setStatus(`Destination must differ from <strong>${esc(_routeFrom.name)}</strong>.`);
      return;
    }
    _routeTo = site;
    const result = findPath(_activeData, _routeFrom.id, _routeTo.id);
    if (!result) {
      setStatus(`No route from <strong>${esc(_routeFrom.name)}</strong> to <strong>${esc(site.name)}</strong>.`);
      _renderer.setRoute(null);
      _renderer.setRouteEndpoints(_routeFrom.id, site.id);
      exitRoutingMode();
      return;
    }
    _renderer.setRoute(result.segments);
    _renderer.setRouteEndpoints(_routeFrom.id, _routeTo.id);
    _selectedId = _routeTo.id;
    showSitePopupFor(_routeTo);
    const hops = result.segments.length;
    setStatus(
      `<strong>${esc(_routeFrom.name)}</strong> → <strong>${esc(_routeTo.name)}</strong>: ` +
      `<strong class="big">${result.totalBurns}</strong> burns over ${hops} hop${hops === 1 ? '' : 's'}.`
    );
    exitRoutingMode();
    return;
  }

  // Default tap behaviour: tap a site to select + show popup;
  // tap the SAME site again to deselect. The on-map popup carries
  // the site stats + the "Navigate to" button, replacing the old
  // side-panel info pane.
  if (_selectedId === site.id) {
    _selectedId = null;
    if (_renderer) {
      _renderer.setRouteEndpoints(null, null);
      _renderer.clearSitePopup();
    }
    setStatus('Tap a site to see its info. Press "Navigate to" in the popup to plan a route.');
    return;
  }

  // Defensive: clear any stale popup BEFORE updating selection so
  // we can't end up with a popup pointing to the previous site
  // while the highlight has moved on. If the new tap turns out to
  // be a decorative (no popup needed), the stale one is already
  // gone instead of leaking forward.
  if (_renderer) _renderer.clearSitePopup();

  _selectedId = site.id;
  if (_renderer) {
    _renderer.setRouteEndpoints(site.id, null);
    // Smooth-pan the camera so the selected hex sits at the centre
    // of the map. Keeps the existing zoom - jumping zoom on every
    // tap would be disorienting.
    _renderer.panTo(site);
  }

  if (site.isDecorative) {
    setStatus(`Decorative routing node - not selectable.`);
    return;
  }

  showSitePopupFor(site);
  setStatus(`Selected <strong>${esc(site.name)}</strong>.`);
}

// Build the on-map popup for a selected site. Carries the same
// info the old "Site info" sidebar pane used to show, plus the
// "Navigate to" action that arms routing-pick mode.
// Re-render the currently-open site popup, if any. Called after
// per-turn state changes (end-turn refills budgets; refuel-this-
// turn log resets) and after rocket-state changes (new prospector
// active, tank empty/full, supports change) so the popup's
// enabled / disabled buttons stay in sync with reality. No-op when
// nothing is selected.
// Route-options modal: lets the player flip the metric priority
// the planner uses (turns-first vs burns-first). Persisted via
// setRoutePriority. onClose fires after the player picks so the
// site popup can re-render its gear tooltip.
// Top-level game-settings modal. Wraps the route-options chooser
// and reserves room for any future sandbox settings (display
// density, accessibility toggles, dev flags). Reachable from the
// toolbar ⚙ button as well as inline gears scattered through
// the popups; everything ends up here.
function openGameSettingsModal() {
  // For now the only setting block IS the route options; reuse
  // the same modal so the player sees one familiar surface.
  // When more settings land, this becomes the parent surface
  // and route-options collapses into a section heading.
  openRouteOptionsModal(() => {
    if (_selectedId) refreshOpenSitePopup();
  });
}

function openRouteOptionsModal(onClose) {
  document.querySelector('.route-options-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay route-options-overlay';
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (onClose) onClose();
  };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  const thrStats = getActiveThrusterStats();
  const thrust = thrStats && Number.isFinite(thrStats.thrust) ? thrStats.thrust : 4;
  const panel = document.createElement('div');
  panel.className = 'route-options-panel';
  panel.innerHTML = `
    <button type="button" class="modal-x" aria-label="Close (Esc)" title="Close (Esc)">×</button>
    <h2 class="route-options-title">⚙ Route options</h2>
    <p class="muted route-options-sub">
      Which metric should the planner minimize first? The other
      one becomes the tiebreaker.
    </p>
    <div class="route-options-choices">
      <label class="route-options-choice ${_routePriority === 'turns' ? 'is-active' : ''}">
        <input type="radio" name="route-priority" value="turns"
          ${_routePriority === 'turns' ? 'checked' : ''}>
        <div>
          <strong>Fewer turns first</strong>
          <em>Default. Adjacent nodes go in 1 hop even when a longer
          Hohmann path would be free in burns.</em>
        </div>
      </label>
      <label class="route-options-choice ${_routePriority === 'burns' ? 'is-active' : ''}">
        <input type="radio" name="route-priority" value="burns"
          ${_routePriority === 'burns' ? 'checked' : ''}>
        <div>
          <strong>Fewer burns first</strong>
          <em>Save water by riding free Hohmann transfers, even if it
          costs extra turn-ends to coast.</em>
        </div>
      </label>
    </div>
    <div class="route-options-manual">
      <button type="button" class="popup-btn route-options-manual-btn">
        ✋ Manual move - plot ${thrust} hops by hand
      </button>
      <p class="muted route-options-manual-help">
        Cancels any auto-planned route and lets you tap adjacent
        sites one at a time. Capped at the active thruster's
        thrust (${thrust}). Tap Move when you're ready to fly.
      </p>
    </div>
  `;
  panel.querySelector('.modal-x').addEventListener('click', close);
  panel.querySelectorAll('input[name="route-priority"]').forEach((el) => {
    el.addEventListener('change', () => {
      if (el.checked) {
        setRoutePriority(el.value);
        // Repaint highlight state on the labels.
        panel.querySelectorAll('.route-options-choice').forEach((c) => {
          c.classList.toggle('is-active',
            c.querySelector('input').value === _routePriority);
        });
      }
    });
  });
  panel.querySelector('.route-options-manual-btn').addEventListener('click', () => {
    close();
    // Close the underlying site popup too - manual mode plots
    // from the rocket's position, the popup site isn't relevant
    // any more and leaving it open would block taps under it.
    if (_renderer) _renderer.setSitePopup(null);
    enterManualMoveMode();
  });

  overlay.appendChild(panel);
  mountOverlay(overlay);
}

function refreshOpenSitePopup() {
  if (!_selectedId || !_activeData) return;
  const site = _activeData.byId && _activeData.byId[_selectedId];
  if (site) showSitePopupFor(site);
}

function showSitePopupFor(site) {
  if (!_renderer) return;
  const canNavigate = !(site.isDecorative || site.isLandable === false);
  const rocketReady = canPlanRocketRoute();
  // Order: rocket-plan FIRST - it's the game action and the one
  // the player will reach for most. Navigate-to is the secondary
  // "check distance" affordance. Rocket-plan is enabled whenever
  // the destination is landable; the turn breakdown uses a fixed
  // per-turn budget so we don't need an active thruster to draw
  // the route (the engage button on the stack modal is where
  // missing-rocket gating lives).
  // Build the action list in priority order. Navigate-to is the
  // pure-inspection affordance (no game state changes) and goes
  // LAST per the CLAUDE.md style rule - all real game actions
  // (Plan rocket route, Prospect, Refuel) precede it.
  const openRouteOptions = () => openRouteOptionsModal(() => {
    if (_selectedId) refreshOpenSitePopup();
  });
  const actions = [
    {
      // Plan the rocket's actual flight from LEO to this site,
      // broken into turns based on its active-thruster burn
      // budget. Turn-1 segments paint as the bright highlight;
      // later turns get a "T2 / T3" pill at midpoint so the
      // player can read the trip plan at a glance.
      label: '🛸 Plan rocket route',
      variant: 'rocket',
      disabled: !canNavigate,
      onClick: () => {
        if (!canNavigate) return;
        const ok = planRocketRouteTo(site);
        if (ok) _renderer.clearSitePopup();
      },
      // Inline ⚙ gear next to the plan-route button. Opens the
      // route-options modal so the player can flip the metric
      // priority (turns vs burns) without leaving the popup.
      // Same modal is also reachable from the toolbar's ⚙
      // game-settings button.
      trailing: {
        label: '⚙',
        variant: 'secondary',
        title: `Route options (current priority: ${_routePriority} first)`,
        onClick: openRouteOptions,
      },
    },
  ];
  // Prospect action - only show when there's an active prospector
  // in the stack AND it's eligible to scan this site. Missile /
  // buggy require the rocket to be parked on the target; raygun
  // does a line-of-sight check through transparent waypoints.
  // Disabled-but-visible when an active prospector exists but
  // can't reach, so the player gets a tooltip explaining why
  // (vs. silently dropping the button).
  const prosp = getActiveProspectorStats();
  const rocketSite = getRocketSite();
  if (prosp) {
    const check = canProspect(_activeData, rocketSite?.id, site.id, prosp.kind);
    const supportsOk = prosp.canActivate;
    const existingDisc = getDisc(site.id);
    // ISRU rule: the rig's ISRU must be <= the site's water
    // (hydration). ISRU 0 / missing clears the gate. This is the
    // "rig sensitivity" gate - a low-ISRU rig handles even dry
    // sites; a high-ISRU rig only works on wet ones. Note the
    // site's "number" (siteSize leading digit) is a DIFFERENT
    // value used for the prospect-roll threshold + the refining-
    // yield formula; don't confuse them.
    const prospIsru   = prospectorIsruValue(prosp.card);
    const siteWater   = Number.isFinite(site.hydration) ? site.hydration : 0;
    const isruOk      = prospIsru <= siteWater;
    const ok = check.ok && supportsOk && !existingDisc && isruOk;
    const kindGlyph = { missile: '🚀', raygun: '🔫', buggy: '🛺' }[prosp.kind] || '🔬';
    const reason = existingDisc
      ? `This site already has a ${existingDisc.outcome === 'success' ? 'claim' : 'failed-prospect'} disc.`
      : !supportsOk
        ? `Prospector needs ${(prosp.missingSuppliers || []).join(' + ')} support.`
        : !isruOk
          ? `Rig ISRU ${prospIsru} > site water ${siteWater}. Need a rig with ISRU ≤ water.`
          : check.reason;
    actions.push({
      label: `${kindGlyph} Prospect (${prosp.kind})`,
      // Blue rocket variant when the action is actually
      // available; dim secondary when something blocks. Reads
      // as a real game-action when live.
      variant: ok ? 'rocket' : 'secondary',
      disabled: !ok,
      title: reason || undefined,
      onClick: () => {
        if (!ok) return;
        doProspect(site, prosp);
        _renderer.clearSitePopup();
      },
    });
  }
  // Refuel action. The rocket can pull water from a hydrated site
  // when it's parked on it AND the site's water rating meets the
  // active prospector's ISRU floor (the ISRU rig drives both
  // prospecting AND refining capability in this sandbox until
  // dedicated refinery cards land in Stage 3+). Each refuel adds
  // water = site.hydration to the tank, capped at the tank max.
  // One refuel per (turn, site) so the player can't strip-mine
  // the site by hammering the button.
  if (rocketSite && site.id === rocketSite.id) {
    if (isLeoSite(site)) {
      // LEO refuel is a bank-to-tank transfer, not a turn op -
      // the player just moves water between their aqua bank and
      // the rocket for free. Skip canRefuelAt entirely + open
      // the fuel-tank modal so the transfer buttons are right
      // there.
      actions.push({
        label: '💧 Transfer fuel',
        variant: 'rocket',
        disabled: false,
        title: 'At LEO: move water between your aqua bank and the rocket tank for free (no turn op)',
        onClick: () => {
          _renderer.clearSitePopup();
          openFuelTankModal();
        },
      });
      // Card transfers happen inside each stack's inspector
      // modal (open the LEO or Rocket chip in the hand-bar
      // switcher and use the Transfer section there). The old
      // standalone "Transfer LEO <-> Rocket" popup button is
      // dropped to avoid duplicate UX surfaces - the inline
      // section in the inspector lives next to the cards being
      // moved, which reads cleaner.
      // Research Auction (rulebook I2). Always available at
      // LEO; opens the 🛒 Cart pane so the player picks from
      // the visible deck tops. Solo cost is 1 op + 0 aqua;
      // there is no Hand-card sacrifice.
      {
        const mode = getMarketMode();
        const reason = mode === MARKET_MODE.MARKET
          ? 'Card Market: pick a deck top in the 🛒 Cart.'
          : 'Free Library: pick a deck top in the 🛒 Cart. Costs 1 op.';
        actions.push({
          label: '🎯 Research Auction',
          variant: 'rocket',
          disabled: false,
          title: reason,
          onClick: () => {
            doResearchAuction();
            _renderer.clearSitePopup();
          },
        });
      }
      // Income Operation (rulebook I1). Always available at
      // LEO. Pays the player 1 aqua from the Pool, consumes
      // the per-turn op. Recovery path when the aqua bank is
      // running low - especially in Card Market mode where
      // running out of cards isn't recoverable, but income
      // keeps the aqua flowing for Free Market sells.
      {
        // Always enabled - the op-budget check happens in
        // doIncomeOp via requireOp, which pops the "no
        // operations left" modal when the budget is spent. (We
        // don't pre-disable on ops==0 because a disabled button
        // gives no feedback; the modal is the notification the
        // user asked for.)
        actions.push({
          label: '💰 Income (+1 aqua)',
          variant: 'rocket',
          disabled: false,
          title: 'Receive 1 Aqua from the Pool into your Bank. Costs one operation.',
          onClick: () => {
            doIncomeOp();
            _renderer.clearSitePopup();
          },
        });
      }
      // Free Market (rulebook I3). Only visible in Card Market
      // mode. Sells one Hand card for FREE_MARKET_AQUA aqua.
      if (getMarketMode() === MARKET_MODE.MARKET) {
        const handEmpty = getHandSlots().length === 0;
        const ok = !handEmpty;
        actions.push({
          label: `💱 Free Market (+${FREE_MARKET_AQUA} aqua)`,
          variant: ok ? 'rocket' : 'secondary',
          disabled: !ok,
          title: ok
            ? `Sell a Hand card for +${FREE_MARKET_AQUA} aqua. Costs one operation.`
            : 'Your hand is empty - nothing to sell.',
          onClick: () => {
            if (!ok) return;
            doFreeMarket();
            _renderer.clearSitePopup();
          },
        });
      }
    } else {
      // Factory refuel (below) requires a player-owned factory and
      // supersedes the site refuel. Without a factory, fall back to
      // the site refuel, which follows the robonaut/ISRU rules.
      const pf = getFactory(site.id);
      const hasPlayerFactory = pf && pf.ownerId === SANDBOX_OWNER_ID;
      if (!hasPlayerFactory) {
        const refuelChk = canRefuelAt(site);
        actions.push({
          label: refuelChk.label,
          // Blue rocket variant when the action is actually
          // available; dim secondary when blocked. Same idiom as
          // the prospect button so live ops read as live ops.
          variant: refuelChk.ok ? 'rocket' : 'secondary',
          disabled: !refuelChk.ok,
          title: refuelChk.reason || undefined,
          onClick: () => {
            if (!refuelChk.ok) return;
            doRefuel(site);
            _renderer.clearSitePopup();
          },
        });
      }
    }
  }
  // Factory-Refuel action (rulebook I5b). Shown when the rocket
  // is parked at a site with a player-owned factory. Produces a
  // flat 7 water FTs (the "blue FT" variant from the rulebook).
  // The gold-FT / isotope variant lands later when isotope
  // storage is modelled. Shares the per-site "already refueled
  // this turn" lock with ISRU Refuel since the player only has
  // one op per turn anyway.
  if (rocketSite && site.id === rocketSite.id) {
    const factory = getFactory(site.id);
    if (factory && factory.ownerId === SANDBOX_OWNER_ID) {
      const factoryGain = 7;
      const tank = getTankWater();
      const tmax = getTankMax();
      const headroom = Math.max(0, tmax - tank);
      const gain = Math.min(factoryGain, headroom);
      const refueledThisTurn = hasRefueledThisTurn(site.id);
      const ok = !refueledThisTurn && gain > 0;
      const reason = refueledThisTurn
        ? 'Already refueled at this site this turn.'
        : (gain <= 0 ? `Tank full (${tank}/${tmax}).` : null);
      actions.push({
        label: refueledThisTurn
          ? `🏭 Factory-Refuel done`
          : `🏭 Factory-Refuel (+${gain} water)`,
        variant: ok ? 'rocket' : 'secondary',
        disabled: !ok,
        title: reason || `Factory produces ${factoryGain} blue water FTs (clamped by tank cap).`,
        onClick: () => {
          if (!ok) return;
          doFactoryRefuel(site, gain);
          _renderer.clearSitePopup();
        },
      });
    }
  }
  // Industrialize action (rulebook I7). Shown only at sites where
  // the rocket is parked AND a successful claim disc exists. The
  // button gates on whether the stack has a valid refinery +
  // robonaut pair with their supports satisfied. The actual op +
  // op-budget cost is committed inside the modal so cancelling
  // doesn't burn the player's turn.
  if (rocketSite && site.id === rocketSite.id) {
    const disc = getDisc(site.id);
    const existingFactory = getFactory(site.id);
    if (disc && disc.outcome === 'success' && !existingFactory) {
      const stack = getRocketStack();
      const opts = findIndustrializeOptions(stack);
      const ok = opts.length > 0;
      const reason = ok
        ? null
        : 'Industrialize needs an active refinery + active robonaut in the stack (with their supports satisfied).';
      actions.push({
        label: '🏭 Industrialize',
        variant: ok ? 'rocket' : 'secondary',
        disabled: !ok,
        title: reason || undefined,
        onClick: () => {
          if (!ok) return;
          doIndustrialize(site, stack, opts);
          _renderer.clearSitePopup();
        },
      });
    } else if (existingFactory) {
      actions.push({
        label: '🏭 Already industrialized',
        variant: 'secondary',
        disabled: true,
        title: `A factory already exists at this site (spectral ${existingFactory.spectralType}).`,
        onClick: () => {},
      });
    }
  }
  // Colonize action (rulebook G3, free action). Shown when the
  // rocket is parked at a site with a player-owned factory and
  // no existing colony. Picker surfaces when 2+ crews are in
  // the stack; auto-commits when only one. Does NOT consume the
  // per-turn op (free action).
  if (rocketSite && site.id === rocketSite.id) {
    const factory = getFactory(site.id);
    const colony = getColony(site.id);
    if (factory && factory.ownerId === SANDBOX_OWNER_ID && !colony) {
      const colonized = countColoniesByOwner(SANDBOX_OWNER_ID);
      const capReached = colonized >= COLONY_CAP_PER_PLAYER;
      const stack = getRocketStack();
      const colonizeOptions = findColonizeOptions(stack);
      const hasCrew = colonizeOptions.crews.length > 0;
      const ok = hasCrew && !capReached;
      const reason = capReached
        ? `Colony cap reached (${COLONY_CAP_PER_PLAYER}).`
        : !hasCrew
          ? 'Need a Crew card colocated in the stack.'
          : null;
      actions.push({
        label: '🌐 Colonize',
        variant: ok ? 'rocket' : 'secondary',
        disabled: !ok,
        title: reason || `Build a colony dome here. Free action (does not cost an op).`,
        onClick: () => {
          if (!ok) return;
          doColonize(site, stack, colonizeOptions);
          _renderer.clearSitePopup();
        },
      });
    } else if (colony) {
      actions.push({
        label: '🌐 Colonized',
        variant: 'secondary',
        disabled: true,
        title: `Colony already established at this site.`,
        onClick: () => {},
      });
    }
  }
  // ET Production action (rulebook I8). Shown when the rocket
  // is parked at a player-owned factory AND the player's hand
  // has at least one card whose spectral matches the factory's
  // spectral. Card is produced Black-Side-up into the colocated
  // outpost (or a fresh outpost the player creates inline).
  if (rocketSite && site.id === rocketSite.id) {
    const factory = getFactory(site.id);
    if (factory && factory.ownerId === SANDBOX_OWNER_ID) {
      const handIds = getHandSlots();
      const etOptions = findEtProduceOptions(handIds, cardById, factory.spectralType);
      const outpostsAtSite = Object.values(getOutposts()).filter((o) => o.siteId === site.id);
      const freeSlots = getAvailableOutpostSlots();
      const hasOutpost = outpostsAtSite.length > 0;
      const canCreateNew = freeSlots.length > 0;
      const ok = etOptions.length > 0 && (hasOutpost || canCreateNew);
      const reason = !etOptions.length
        ? `No Hand cards match spectral ${factory.spectralType}.`
        : (!hasOutpost && !canCreateNew)
          ? `No colocated outpost AND all 4 outpost slots are in use.`
          : null;
      actions.push({
        label: `🏭 ET Produce (${factory.spectralType})`,
        variant: ok ? 'rocket' : 'secondary',
        disabled: !ok,
        title: reason
          || `Produce a spectral-${factory.spectralType} hand card Black-Side-up into the colocated outpost.`,
        onClick: () => {
          if (!ok) return;
          doEtProduce(site, factory, etOptions, outpostsAtSite, freeSlots);
          _renderer.clearSitePopup();
        },
      });
    }
  }
  // Rocket -> Outpost free action. Surfaces when the rocket is
  // parked at a non-LEO site with at least one card in the
  // stack, AND there's a free outpost slot. Cards + water tank
  // transfer to the new outpost; rocket returns to LEO empty.
  if (rocketSite && site.id === rocketSite.id && !isLeoSite(site)) {
    const stack = getRocketStack();
    const freeSlots = getAvailableOutpostSlots();
    const ok = stack.length > 0 && freeSlots.length > 0;
    const reason = !stack.length
      ? 'Rocket has no cards to convert.'
      : !freeSlots.length
        ? 'All 4 outpost slots are in use.'
        : null;
    actions.push({
      label: '🚀→🏛 Convert to Outpost',
      variant: ok ? 'rocket' : 'secondary',
      disabled: !ok,
      title: reason || `Park as an Outpost (slots ${freeSlots.join(', ')} free). Free action.`,
      onClick: () => {
        if (!ok) return;
        doConvertToOutpost(site);
        _renderer.clearSitePopup();
      },
    });
  }
  // Outpost -> Rocket free action. Surfaces when an outpost
  // exists at this site AND the rocket is empty (no cards) OR
  // is parked at LEO. The new rocket inherits the outpost's
  // cards + tank and is placed at this site.
  {
    const outposts = getOutposts();
    const localOutposts = Object.values(outposts).filter((o) => o.siteId === site.id);
    if (localOutposts.length > 0) {
      const rocketCardCount = getRocketStack().length;
      const rocketEmpty = rocketCardCount === 0;
      // Per the variant rule (user, 2026-05-24): an outpost can
      // become a rocket "at any time IF there is a functional
      // thruster". A functional thruster is one whose support
      // requires are satisfied by the rest of the outpost stack.
      for (const op of localOutposts) {
        const functional = findFunctionalThrusters(op.cards);
        const canConvert = rocketEmpty && functional.length > 0;
        let reason = null;
        if (!rocketEmpty) {
          reason = 'Convert your existing rocket first - only one rocket at a time.';
        } else if (functional.length === 0) {
          reason = `Outpost ${op.letter} has no functional thruster (need a thruster with its supports satisfied in the same stack).`;
        }
        actions.push({
          label: `🏛${op.letter}→🚀 Lift Outpost`,
          variant: canConvert ? 'rocket' : 'secondary',
          disabled: !canConvert,
          title: reason
            || `Lift Outpost ${op.letter} into your Rocket (${op.cards.length} card${op.cards.length === 1 ? '' : 's'}, ${op.tank} water, thruster: ${functional[0].card.name}). Free action.`,
          onClick: () => {
            if (!canConvert) return;
            doConvertToRocket(site, op.letter);
            _renderer.clearSitePopup();
          },
        });
      }
    }
  }
  // Navigate-to ALWAYS sits last (CLAUDE.md style rule). It's a
  // pure inspection affordance - no state mutation - so any new
  // game-action buttons land above it.
  actions.push({
    label: 'Navigate to →',
    variant: 'secondary',
    disabled: !canNavigate,
    onClick: () => {
      if (!canNavigate) return;
      enterRoutingMode(site);
      _renderer.clearSitePopup();
    },
  });
  // Push the player's current rig info so the popup can render
  // the ISRU chip ("Your ISRU 2 vs 4 water ✓") without the
  // renderer needing to import rocket state directly.
  _renderer.setPopupRocketInfo(prosp
    ? { isru: prospectorIsruValue(prosp.card), kind: prosp.kind }
    : null);
  _renderer.setSitePopup(site, actions);
  _renderer.onPopupClose(() => {
    _selectedId = null;
    if (_renderer) _renderer.setRouteEndpoints(null, null);
  });
}

// True when there's an active thruster (or missile-class robonaut
// with a thrust value) the player can fly from LEO. Doesn't
// require all supports satisfied yet - if the route is plannable
// in principle, show it even if the rocket can't actually engage
// today; the totals row in the stack modal still flags wet-mass
// vs thrust separately.
function canPlanRocketRoute() {
  const stack = getRocketStack();
  const activeId = getActiveThrusterId();
  if (!activeId) return false;
  return stack.some((s) => s.id === activeId);
}

// Plan a rocket route from the rocket's current site to `destSite`,
// using the ported vendor mission planner (planner-nav.js). The
// planner knows about Hohmann pivots, direction-change costs,
// burn budgets, hazard avoidance, and Venus flyby bonuses; our
// old nav.js was a flat Dijkstra over dv values and got all of
// those wrong. Per-turn burn budget = the active thruster's
// thrust value (defaults to 4 when no thruster is active).
function planRocketRouteTo(destSite) {
  if (!_renderer || !_activeData) return false;
  // Origin = wherever the rocket currently is (default LEO). Once
  // the rocket has moved, plans should start from its actual
  // position, not snap back to LEO.
  const origin = getRocketSite();
  if (!origin) {
    setStatus('Could not find a launch origin.');
    return false;
  }
  if (destSite.id === origin.id) {
    setStatus(`Rocket is already at ${esc(origin.name)} - pick a different destination.`);
    return false;
  }
  // Active-thruster thrust drives the per-turn burn budget. When
  // no thruster is selected we fall back to 4 (HF4's stock LEO
  // budget) so the route still computes - the rocket simply
  // won't be flyable until a thruster is assigned.
  const thrStats = getActiveThrusterStats();
  const thrust = thrStats && Number.isFinite(thrStats.thrust) ? thrStats.thrust : 4;
  const result = planRoute(_activeData, origin.id, destSite.id, {
    thrust,
    metricPriority: routeMetricPriority(),
  });
  if (!result || !result.segments.length) {
    setStatus(
      `No rocket route from <strong>${esc(origin.name)}</strong> to `
      + `<strong>${esc(destSite.name)}</strong>.`
    );
    _renderer.setRoute(null);
    _renderer.setRouteEndpoints(origin.id, destSite.id);
    return false;
  }
  _routeFrom = origin;
  _routeTo = destSite;
  _plannedRoute = result.segments;
  persistPlannedRoute();
  _renderer.setRoute(result.segments);
  _renderer.setRouteEndpoints(origin.id, destSite.id);
  document.getElementById('route-clear').hidden = false;
  const turns = result.totalTurns;
  setStatus(
    `🛸 <strong>${esc(origin.name)}</strong> → <strong>${esc(destSite.name)}</strong>: `
    + `<strong class="big">${result.totalBurns}</strong> burn${result.totalBurns === 1 ? '' : 's'} over `
    + `<strong>${turns}</strong> turn${turns === 1 ? '' : 's'} `
    + `(thrust ${thrust}).`
  );
  return true;
}

function clearRoute() {
  _routeFrom = null;
  _routeTo = null;
  _plannedRoute = null;
  persistPlannedRoute();
  _selectedId = null;
  exitRoutingMode();
  // Manual mode shares the planned-route store, so clearing the
  // route also drops the manual flag + budget.
  exitManualMoveMode();
  if (_renderer) {
    _renderer.setRoute(null);
    _renderer.setRouteEndpoints(null, null);
  }
  document.getElementById('route-clear').hidden = true;
  setStatus('Tap a site to see its info. Press "Navigate to" to plan a route.');
}

function setStatus(html) {
  const el = document.getElementById('route-status');
  if (el) el.innerHTML = html;
}

// Per-turn operation budget gate. Returns true and consumes one
// op when the player still has ops remaining; otherwise surfaces
// a status notice and returns false so the caller bails. Use this
// at the entry point of every rulebook Operation (I1, I4, I5a/b,
// I6, I7, I8) - Air-eater Refuel (I5c) is a free action in this
// variant and skips this gate.
function requireOp(label) {
  if (getOpsRemaining() > 0) {
    consumeOp();
    return true;
  }
  // Out of operations this turn. Pop an acknowledge modal so the
  // block is unmissable (a status-line note alone is easy to
  // overlook). confirmModal with no:'' renders a single OK
  // button; we fire-and-forget (requireOp is synchronous, the
  // caller bails on the false return immediately).
  const verb = label ? `${label} costs an operation` : 'That action costs an operation';
  confirmModal({
    title: '⛔ No operations left',
    body: `${esc(verb)}, but you've already used your operation for this turn. `
      + `End the turn to refresh your operation budget.`,
    yes: 'OK',
    no: '',
  });
  setStatus(`<strong>No operations left this turn.</strong> End the turn to reset the budget.`);
  return false;
}
function updateRouteStatus() {
  setStatus('Tap a site to plan a route.');
  const btn = document.getElementById('route-clear');
  if (btn) btn.hidden = true;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Kinds whose supplier is implicit ("any reactor", "any
// generator") - clicking the chip means filter to all members of
// the family. Used both by the card-grid filter and the sub-tab
// auto-select when a card chip points the library here.
const SUPPORT_KIND_EXPANSIONS = {
  'reactor-any': ['reactor-fission', 'reactor-fusion', 'reactor-antimatter'],
};
function expandSupportKinds(kinds) {
  const out = new Set();
  for (const k of kinds) {
    const exp = SUPPORT_KIND_EXPANSIONS[k];
    if (exp) for (const e of exp) out.add(e);
    else out.add(k);
  }
  return [...out];
}

// Build the canonical list of support kinds that have at least
// one supplier card. Driven off the live deck so the sub-tab row
// stays in sync with whatever the spreadsheet ships - new
// supplies show up automatically.
function listSupplyKinds() {
  const order = [
    'reactor-fission', 'reactor-fusion', 'reactor-antimatter',
    'gen-radioisotope', 'gen-electric',
    'thermostat',
    'beam-receiver', 'aerobrake-shroud', 'crew-quarters',
    'spin-grav', 'pulse-generator', 'sail',
  ];
  const present = new Set();
  for (const p of PATENTS) {
    const sup = (p.faces && p.faces.primary && p.faces.primary.supplies) || p.supplies || [];
    for (const k of sup) present.add(k);
  }
  // Sort: known order first, anything new appended.
  const known = order.filter((k) => present.has(k));
  for (const k of present) if (!order.includes(k)) known.push(k);
  return known;
}

// Cards whose primary face supplies at least one of the given
// kinds. Used to populate the grid under the supports tab.
function patentsThatSupply(kinds) {
  if (!kinds || !kinds.length) return [];
  const want = new Set(expandSupportKinds(kinds));
  const out = [];
  for (const p of PATENTS) {
    const sup = (p.faces && p.faces.primary && p.faces.primary.supplies) || p.supplies || [];
    if (sup.some((k) => want.has(k))) out.push(p);
  }
  return out;
}

// Inline glyph for a support kind, matching the card chip idiom
// (SVG for sun / ballerina, emoji for the rest). Wrapped <em> so
// CSS rules that key off `.req em` apply unchanged.
function supportKindGlyphHtml(kind) {
  if (kind === 'beam-receiver')  return svgSunChip(14);
  if (kind === 'spin-grav')      return svgBallerinaChip(14);
  const vis = REQUIREMENT_VIS[kind];
  return `<em>${(vis && vis.glyph) || '◇'}</em>`;
}

// Module-level seed for openPatentsSupports - lets the rocket-
// stack modal hand the library a starting selection. Consumed
// once by renderPatents.
let _pendingPatentSelection = null;
export function openPatentsSupports(kinds) {
  const want = expandSupportKinds(kinds || []);
  _pendingPatentSelection = { type: 'supports', kinds: want };
  showPane('patents');
}

// 🛒 Patent Market cart. Shown only in Card Market mode (the
// tab is hidden in Free Library mode). Renders one section per
// rulebook deck type (thruster / reactor / radiator / refinery
// / robonaut / generator) listing every patent NOT already
// owned by the player, with a per-deck "🎯 Auction" button that
// opens the auction-confirm modal for that deck's top card.
// Repaints
// on hand / rocket / outpost / LEO / market changes so the
// available pool stays current.
let _cartListenerHooked = false;
function renderCart() {
  if (!_cartListenerHooked) {
    _cartListenerHooked = true;
    const repaintIfActive = () => {
      const panel = document.getElementById('browse-sidepanel');
      if (panel && panel.dataset.active === 'cart') paintCart();
    };
    onHandChange(repaintIfActive);
    onRocketChange(repaintIfActive);
    onOutpostsChange(repaintIfActive);
    onLeoChange(repaintIfActive);
    onMarketChange(repaintIfActive);
    // Deck changes drive the cart's top-of-deck view directly,
    // so it must repaint on every cycle / draw / addToBottom.
    onDeckChange(repaintIfActive);
  }
  paintCart();
}
function paintCart() {
  const host = document.getElementById('browse-cart');
  if (!host) return;
  const mode = getMarketMode();
  if (mode !== MARKET_MODE.MARKET) {
    host.innerHTML = `<section class="cart-summary">
      <h3>🛒 Patent Market</h3>
      <p class="muted">The cart is empty - you're in 📚 Free Library mode. Switch to 🃏 Card Market in the sandbox panel to enable the patent marketplace.</p>
    </section>`;
    return;
  }
  const handIds = getHandSlots();
  const aqua = getAqua();

  host.innerHTML = `
    <section class="cart-summary">
      <h3>🛒 Patent Market</h3>
      <p class="muted">Card Market mode: each deck is shuffled, and only the <strong>top card</strong> is up for auction. Per-buy cost in sandbox / solo mode: <strong>1 operation</strong> + 0 aqua. The card lands in your Hand.</p>
      <p class="muted">Aqua bank: <strong class="stat-aqua">${esc(String(aqua))} 💧</strong>. Hand: <strong>${handIds.length}</strong> card${handIds.length === 1 ? '' : 's'}.</p>
      <p class="muted">Inspiration event (d6 roll 1-2): every deck's top card cycles to the bottom.</p>
    </section>
    <div class="cart-decks" id="cart-decks-host"></div>
  `;

  const decksHost = host.querySelector('#cart-decks-host');
  for (const type of DECK_TYPES) {
    const topId = peekTop(type);
    const card = topId ? cardById(topId) : null;
    const deckSize = getDeck(type).length;

    const section = document.createElement('section');
    section.className = 'cart-deck';
    section.dataset.type = type;

    const title = document.createElement('h4');
    title.className = 'cart-deck-title';
    title.innerHTML = `${esc(type)} <em>(${deckSize} card${deckSize === 1 ? '' : 's'})</em>`;
    section.appendChild(title);

    const body = document.createElement('div');
    body.className = 'cart-deck-body';

    // Left: deck-thickness SVG so the player gets a visual cue
    // of how thick the deck is.
    const deckArt = document.createElement('div');
    deckArt.className = 'cart-deck-art';
    deckArt.appendChild(renderDeckThicknessSvg(deckSize));
    body.appendChild(deckArt);

    // Right: the card art for the top card via the shared
    // renderCard. Same card-holder used elsewhere.
    // Click the card to open the deck-tap inspect modal -
    // same as the patent library. The modal's "Auction this
    // card" button (in market mode) routes back through the
    // auction-confirm flow so the player can buy from the
    // inspect view too.
    const cardSlot = document.createElement('div');
    cardSlot.className = 'cart-deck-topcard';
    if (card) {
      const ce = renderCard(card, { type: 'patent' });
      ce.classList.add('cart-deck-topcard-click');
      ce.setAttribute('role', 'button');
      ce.setAttribute('tabindex', '0');
      ce.title = 'Tap to inspect this card';
      // Opened from the cart -> the inspect modal gets an
      // Auction button (allowAuction:true). The library path
      // omits this so it stays read-only in market mode.
      ce.addEventListener('click', (ev) => {
        // Don't intercept clicks on interactive children of
        // the card (e.g. the flip button, support chips).
        if (ev.target.closest('.card-flip, .card-support-chip, .card-supports')) return;
        openDeckTapModal(card, 'patent', { allowAuction: true });
      });
      ce.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          openDeckTapModal(card, 'patent', { allowAuction: true });
        }
      });
      cardSlot.appendChild(ce);
    } else {
      cardSlot.innerHTML = '<p class="muted">Deck is empty.</p>';
    }
    body.appendChild(cardSlot);

    section.appendChild(body);

    // Auction button: opens the auction-confirm modal for this
    // deck's top card. Disabled when the deck is empty.
    const buy = document.createElement('button');
    buy.type = 'button';
    buy.className = 'cart-buy-btn';
    buy.disabled = !card;
    buy.title = !card
      ? `${type} deck is empty.`
      : 'Auction this card (1 op, 0 aqua in sandbox mode).';
    const supportCount = card ? supportBonusDecks(card).length : 0;
    buy.textContent = supportCount > 0
      ? `🎯 Auction (+${supportCount} bonus)`
      : '🎯 Auction';
    if (card) {
      buy.addEventListener('click', () => {
        if (buy.disabled) return;
        doAuctionCard(card);
      });
    }
    section.appendChild(buy);
    decksHost.appendChild(section);
  }
}

// SVG showing a stack of cards. Thicker stacks have more
// layered rectangles offset down-right so it reads as a
// physical pile. Capped at 5 layers (more would just clutter).
function renderDeckThicknessSvg(deckSize) {
  const layers = Math.max(1, Math.min(5, Math.ceil(deckSize / 3)));
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  const w = 60, h = 84;
  const cardW = 38, cardH = 56;
  const offset = 4;
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('class', 'cart-deck-svg');
  // Draw from back (deepest offset) to front (top of deck).
  for (let i = layers - 1; i >= 0; i--) {
    const r = document.createElementNS(svgNS, 'rect');
    r.setAttribute('x', String(2 + i * offset));
    r.setAttribute('y', String(2 + i * offset));
    r.setAttribute('width', String(cardW));
    r.setAttribute('height', String(cardH));
    r.setAttribute('rx', '4');
    r.setAttribute('fill', i === 0 ? '#1f2a44' : '#0f172a');
    r.setAttribute('stroke', i === 0 ? '#7dd3fc' : '#334155');
    r.setAttribute('stroke-width', '1.2');
    svg.appendChild(r);
  }
  // "?" mark on the top card to suggest "next draw is here".
  const txt = document.createElementNS(svgNS, 'text');
  txt.setAttribute('x', String(2 + cardW / 2));
  txt.setAttribute('y', String(2 + cardH / 2 + 6));
  txt.setAttribute('text-anchor', 'middle');
  txt.setAttribute('font-size', '20');
  txt.setAttribute('font-weight', '800');
  txt.setAttribute('fill', '#7dd3fc');
  txt.textContent = String(deckSize);
  svg.appendChild(txt);
  return svg;
}

// Open the auction-confirm modal for a specific card. Used by
// the Cart's Buy button + the deck-tap modal's "Auction this
// card" button. The deck draws happen on confirm.
function doAuctionCard(card) {
  if (!card) return;
  const mode = getMarketMode();
  openAuctionConfirmModal({
    card,
    mode,
    renderCardFn: renderCard,
    // Resolve each support deck's TOP card into its full
    // record so the confirm modal can render the actual card
    // art (user 2026-05-24: "please show the bonus cards in
    // full"). Empty decks contribute nothing; the modal just
    // shows fewer cards.
    bonusCards: supportBonusDecks(card)
      .map((t) => cardById(peekTop(t)))
      .filter(Boolean),
    onConfirm: () => {
      if (!requireOp('Research Auction')) return;
      // Auctions in sandbox / solo mode have NO Hand-card
      // sacrifice and NO aqua cost (user, 2026-05-24):
      // "auctions are cost 0 in sandbox mode". The player
      // wins the top of the chosen deck immediately on
      // confirm.
      const drawnId = drawTop(card.type);
      if (drawnId !== card.id) {
        // Deck shifted between modal-open and confirm (rare
        // race - e.g. an Inspiration cycle fired between
        // tap and confirm). Put the unexpected card back at
        // the bottom and tell the player.
        if (drawnId) addToBottom(drawnId);
        setStatus('Auction failed - deck state shifted. Try again.');
        return;
      }
      const handResult = addToHand(card);
      if (!handResult.ok) {
        addToBottom(card.id);
        setStatus(`Auction failed - ${esc(handResult.reason)}.`);
        return;
      }
      // Bonus draws: 1 card from the top of each support
      // deck. Empty support decks skip silently. The player
      // learns the bonus identities when the cards land in
      // hand (per the spec: don't pre-reveal).
      const bonusTypes = supportBonusDecks(card);
      const bonusCards = [];
      for (const t of bonusTypes) {
        const bId = drawTop(t);
        if (!bId) continue;
        const bCard = cardById(bId);
        if (!bCard) continue;
        const br = addToHand(bCard);
        if (br.ok) bonusCards.push(bCard);
        else addToBottom(bId);
      }
      const bonusNote = bonusCards.length
        ? ` Bonus: ${bonusCards.map((b) => `<em>${esc(b.name)}</em>`).join(', ')}.`
        : (bonusTypes.length ? ' (Bonus decks were empty.)' : '');
      const modeLabel = mode === MARKET_MODE.MARKET ? 'Card Market' : 'Free Library';
      setStatus(
        `🎯 Auctioned <em>${esc(card.name)}</em> into your Hand (${esc(modeLabel)}).`
        + bonusNote
      );
      logAction({
        type: 'auction',
        icon: '🎯',
        summary: `Auctioned ${card.name}`
          + (bonusCards.length ? `; bonus: ${bonusCards.map((b) => b.name).join(', ')}` : ''),
        undoable: false,
        data: {
          cardId: card.id,
          bonusCardIds: bonusCards.map((b) => b.id),
          mode,
        },
      });
    },
  });
}

// (removeFromDeckIfPresent helper deleted - no longer used
// now that auctions don't sacrifice a Hand card.)

// Show or hide the 🛒 sidebar tab based on the current Card
// Market mode. Called on mount + on every market mode flip.
// When hiding while the cart pane is open, redirect to patents
// so the panel doesn't go blank.
function syncCartTabVisibility() {
  const tab = document.getElementById('sidepanel-tab-cart');
  const panel = document.getElementById('browse-sidepanel');
  if (!tab || !panel) return;
  const market = getMarketMode() === MARKET_MODE.MARKET;
  tab.hidden = !market;
  if (!market && panel.dataset.active === 'cart') {
    showPane('patents');
  }
}

function renderPatents() {
  const host = document.getElementById('browse-patents');
  if (!host) return;
  host.innerHTML = '';

  // Filter bar: All / per-type / Crew. Crew lives in its own
  // deck (data/crew.js) but the card UI handles both.
  const bar = document.createElement('div');
  bar.className = 'patent-filter';
  bar.innerHTML = '';
  // Expansion types (currently 'gw-thruster') get their own tab
  // at the end so the player can preview the unlocked content
  // without it cluttering the buildable list. The tab label
  // marks it as soon-only so there's no surprise when grab
  // buttons refuse to engage.
  const expansionTypes = ['gw-thruster'];
  // 'supports' is a synthetic filter that groups every card
  // whose primary face SUPPLIES a stack-support chip (reactors,
  // generators, radiators today). A sub-row of kind chips lets
  // the player narrow to a single requirement. The rocket-stack
  // modal jumps directly here when the player taps a support
  // chip on a card so they can see what would fill that slot.
  const supplyKinds = listSupplyKinds();
  const types = [...PATENT_TYPES, 'supports', 'crew', ...expansionTypes];
  const counts = Object.fromEntries(PATENT_TYPES.map((t) => [t, patentsByType(t).length]));
  for (const t of expansionTypes) counts[t] = patentsByType(t).length;
  counts.crew = CREW_FACES.length;
  counts.supports = patentsThatSupply(supplyKinds).length;
  const TYPE_LABEL = {
    'gw-thruster': 'GW thrusters (soon)',
    'supports': 'Supports',
  };
  // Seed initial active tab from a pending programmatic open
  // (openPatentsSupports), falling back to the first type.
  const seed = _pendingPatentSelection;
  const initialType = (seed && types.includes(seed.type)) ? seed.type : types[0];
  types.forEach((t) => {
    const label = TYPE_LABEL[t] || cap(t);
    const active = t === initialType ? ' class="active"' : '';
    bar.innerHTML += `<button${active} data-type="${t}">${label} (${counts[t]})</button>`;
  });
  host.appendChild(bar);

  // Sub-filter row for the Supports tab: one chip per supply
  // kind, multi-select. Hidden when any other type tab is
  // active so the row doesn't clutter the non-supports views.
  const supportRow = document.createElement('div');
  supportRow.className = 'patent-supports-filter';
  const activeSupportKinds = new Set();
  if (seed && seed.type === 'supports' && seed.kinds) {
    for (const k of seed.kinds) if (supplyKinds.includes(k)) activeSupportKinds.add(k);
  }
  const renderSupportRow = () => {
    supportRow.innerHTML = '';
    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'patent-support-chip is-all'
      + (activeSupportKinds.size === 0 ? ' is-active' : '');
    allBtn.textContent = `All (${counts.supports})`;
    allBtn.addEventListener('click', () => {
      activeSupportKinds.clear();
      renderSupportRow();
      repaintActive();
    });
    supportRow.appendChild(allBtn);
    for (const k of supplyKinds) {
      const supplier = REQ_SUPPLIER_TYPE[k] || null;
      const vis = REQUIREMENT_VIS[k] || { label: k };
      const n = patentsThatSupply([k]).length;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'patent-support-chip';
      if (supplier) chip.dataset.supplier = supplier;
      if (activeSupportKinds.has(k)) chip.classList.add('is-active');
      chip.dataset.kind = k;
      chip.title = vis.label;
      chip.innerHTML = `${supportKindGlyphHtml(k)}<span class="lbl">${vis.label}</span><b>${n}</b>`;
      chip.addEventListener('click', () => {
        if (activeSupportKinds.has(k)) activeSupportKinds.delete(k);
        else activeSupportKinds.add(k);
        renderSupportRow();
        repaintActive();
      });
      supportRow.appendChild(chip);
    }
  };
  renderSupportRow();
  host.appendChild(supportRow);
  supportRow.classList.toggle('is-visible', initialType === 'supports');

  // Consume the programmatic seed so a later manual reopen of
  // the pane doesn't snap back to the supports tab.
  _pendingPatentSelection = null;

  const grid = document.createElement('div');
  grid.className = 'card-grid';
  host.appendChild(grid);

  // Each physical card exists in exactly one location: deck,
  // hand, or rocket. The library grid decorates every tile with
  // its current location so the player can see where each card
  // is at a glance - ✋ overlay for hand, 🛸 overlay for rocket.
  // Cards not in the deck have drag + tap disabled (no
  // duplicates allowed; pull them back from hand/rocket first).
  const decorateForHand = (card, asKind) => {
    const el = renderCard(card, { type: asKind });
    el.dataset.cardId  = card.id;
    el.dataset.cardKind = asKind;
    // Crew-face tiles are a display projection of a physical card
    // (card.srcId); location markers + drag must key off the real
    // card so both faces of one card light up when it's in hand.
    const locId = card.srcId || card.id;
    const inHand   = isInHand(locId);
    const inRocket = isInRocket(locId);
    if (inHand)   el.classList.add('in-hand');
    if (inRocket) el.classList.add('in-rocket');
    if (inHand || inRocket) return el;   // placeholder - not interactive
    // Expansion-only cards (GW thrusters today) preview but
    // can't be played. Mark + return early so the drag /
    // tap-to-add handlers don't bind. A CSS overlay tells the
    // player why.
    if (card.type === 'gw-thruster') {
      el.classList.add('is-expansion');
      const badge = document.createElement('div');
      badge.className = 'card-expansion-badge';
      badge.textContent = 'Coming soon';
      el.appendChild(badge);
      return el;
    }

    // Crew tiles are a visual reference: the 12 faction faces,
    // each flip-less. Crew enters play via the starting-crew
    // wizard, not by dragging from the library, so these tiles
    // are inspect-only (tap opens a read-only card view).
    if (asKind === 'crew') {
      el.classList.add('is-crew-tile');
      el.addEventListener('click', (ev) => {
        if (ev.target.closest('.card-flip, .card-rotate')) return;
        openDeckTapModal(card, asKind, { inspectOnly: true });
      });
      return el;
    }

    el.draggable = true;
    el.addEventListener('dragstart', (ev) => {
      ev.dataTransfer.setData('text/card-id', locId);
      ev.dataTransfer.setData('text/card-kind', asKind);
      ev.dataTransfer.effectAllowed = 'move';
      el.classList.add('is-dragging');
      startCustomDragGhost(el, ev);
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('is-dragging');
      endCustomDragGhost();
    });
    el.addEventListener('click', (ev) => {
      if (ev.target.closest('.card-flip, .card-rotate')) return;
      openDeckTapModal(card, asKind);
    });
    return el;
  };

  const repaint = (filter) => {
    grid.innerHTML = '';
    if (filter === 'crew') {
      // All 12 faction faces, each a flip-less single-face card.
      for (const c of CREW_FACES) grid.appendChild(decorateForHand(c, 'crew'));
      return;
    }
    if (filter === 'supports') {
      // No sub-chip selected = every card with a non-empty
      // supplies list. Sub-chips narrow further; multiple
      // selected chips OR together.
      const want = activeSupportKinds.size
        ? [...activeSupportKinds]
        : supplyKinds;
      for (const p of patentsThatSupply(want)) {
        grid.appendChild(decorateForHand(p, 'patent'));
      }
      return;
    }
    for (const p of PATENTS) {
      if (p.type !== filter) continue;
      grid.appendChild(decorateForHand(p, 'patent'));
    }
  };

  // Subscribe to hand + rocket changes so the library tiles'
  // ✋ / 🛸 location markers update as the player moves cards
  // around. Storing the unsubs on the host element means
  // remounting the pane doesn't stack listeners.
  if (host._libUnsubs) host._libUnsubs.forEach((u) => u());
  const repaintActive = () => {
    const active = bar.querySelector('button.active');
    repaint(active ? active.dataset.type : types[0]);
  };
  host._libUnsubs = [
    onHandChange(repaintActive),
    onRocketChange(repaintActive),
  ];

  bar.querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      bar.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      // Show the sub-filter chip row only on the Supports tab -
      // every other tab hides it so the row doesn't take vertical
      // space when it's meaningless.
      supportRow.classList.toggle('is-visible', b.dataset.type === 'supports');
      repaint(b.dataset.type);
    };
  });
  repaint(initialType);
}

// Legacy patent-card builder kept for now (unused after switch to
// renderCard; will be removed in a follow-up commit once nothing
// imports it). Pruning aggressively to keep the bundle small.
function legacyPatentCard(p) {
  const card = document.createElement('div');
  card.className = 'patent-card type-' + p.type;
  card.innerHTML = `
    <div class="pc-header">
      <span class="pc-type"></span>
      <span class="pc-name"></span>
    </div>
    <div class="pc-stats"></div>
    <p class="pc-blurb"></p>
  `;
  card.querySelector('.pc-type').textContent = p.type.toUpperCase();
  card.querySelector('.pc-name').textContent = p.name;
  card.querySelector('.pc-blurb').textContent = p.blurb;
  const stats = card.querySelector('.pc-stats');
  const rows = [];
  rows.push(`<span>Mass</span><strong>${p.mass}</strong>`);
  if (p.type === 'thruster') {
    rows.push(`<span>Thrust</span><strong>${p.thrust}</strong>`);
    rows.push(`<span>ISP</span><strong>${p.isp}</strong>`);
    if (p.power_req) rows.push(`<span>Power req</span><strong>${p.power_req}</strong>`);
  }
  if (p.type === 'reactor') {
    rows.push(`<span>Power</span><strong>${p.power}</strong>`);
    rows.push(`<span>Heat</span><strong>${p.heat}</strong>`);
  }
  if (p.type === 'radiator') {
    rows.push(`<span>Heat cap</span><strong>${p.heat_cap}</strong>`);
  }
  if (p.type === 'refinery') {
    rows.push(`<span>Water out</span><strong>${p.water_out}</strong>`);
  }
  if (p.type === 'robonaut') {
    rows.push(`<span>+Prospect</span><strong>${p.prospect_bonus}</strong>`);
  }
  if (p.type === 'lab' || p.type === 'generator') {
    rows.push(`<span>Science</span><strong>${p.science}</strong>`);
  }
  stats.innerHTML = rows.map((r) => `<div>${r}</div>`).join('');
  return card;
}

// Glory pane: live HF4-style ticker-tape readout plus the legacy
// milestone deck below for reference. Re-renders on every glory
// state change so the chit row + VP counter stay live.
let _gloryListenerHooked = false;
function renderMilestones() {
  if (!_gloryListenerHooked) {
    _gloryListenerHooked = true;
    // The endgame score depends on factory / colony / outpost
    // / rocket / disc state in addition to glory, so we repaint
    // on any of those changing too.
    const repaintIfActive = () => {
      const panel = document.getElementById('browse-sidepanel');
      if (panel && panel.dataset.active === 'milestones') paintGlory();
    };
    onGloryChange(repaintIfActive);
    onFactoryChange(repaintIfActive);
    onColonyChange(repaintIfActive);
    onOutpostsChange(repaintIfActive);
    onRocketChange(repaintIfActive);
    onDiscsChange(repaintIfActive);
  }
  paintGlory();
}
function paintGlory() {
  const host = document.getElementById('browse-milestones');
  if (!host) return;
  const chits = getChits();
  const vps   = getVps();
  const zonesEarned = chits.length
    ? chits.map((c) => `<span class="glory-chit" data-zone="${esc(c.zone)}">
          <strong>${esc(c.zone)}</strong>
          <em>+${getChitVpValue(c.zone)} VP</em>
        </span>`).join('')
    : '<p class="muted">No glory chits carried. Land the rocket on a new heliocentric zone to earn one.</p>';
  const zoneTableRows = Object.entries(ZONE_CHIT_VPS)
    .filter(([z]) => z !== 'Earth')
    .map(([z, v]) => `<li><span>${esc(z)}</span><strong>+${v} VP</strong></li>`)
    .join('');
  // Stage-3 endgame scoring: surfaces "if the game ended now"
  // VP breakdown. Tokens (+1 each) + spectral bonus per factory
  // (+4/+5/+8 per Exploitation Track) + the career glory VP
  // counter above. The values are recomputed every paint so
  // building a factory or running an op refreshes the total.
  const score = computeEndgameScore({ ownerId: SANDBOX_OWNER_ID });
  const tokenRows = [
    ['🚀 Rocket',    score.tokens.rocket],
    ['🟡 Claims',    score.tokens.claims],
    ['🏭 Factories', score.tokens.factories],
    ['🌐 Colonies',  score.tokens.colonies],
    ['🏛 Outposts',  score.tokens.outposts],
  ].map(([label, n]) =>
    `<li><span>${label}</span><strong>+${n} VP</strong></li>`
  ).join('');
  // Spectral bonus broken down by spectral letter, with the
  // factory count + diminishing schedule chips so the player
  // can see WHY the totals are what they are. Schedule is
  // shared across all six spectrals (1st=8, 2nd=5, 3rd+=4 per
  // SPECTRAL_DIMINISHING_SCHEDULE in scoring.js).
  const spectralRows = Object.entries(score.spectralBonus.byType)
    .filter(([, v]) => v > 0)
    .map(([spec, v]) => {
      const n = score.spectralBonus.perSpectralCount?.[spec] || 0;
      const factorLabel = n === 1 ? '1 factory' : `${n} factories`;
      return `<li>
        <span>
          <span class="industrialize-spectral-badge spectral-${esc(spec)}">${esc(spec)}</span>
          <span class="muted">${esc(factorLabel)}</span>
        </span>
        <strong>+${v} VP</strong>
      </li>`;
    })
    .join('');
  const scheduleHint = SPECTRAL_DIMINISHING_SCHEDULE
    .map((v, i) => i === SPECTRAL_DIMINISHING_SCHEDULE.length - 1 ? `${i + 1}+ → ${v}` : `${i + 1}st → ${v}`)
    .join(', ');
  const spectralBlock = score.spectralBonus.total > 0
    ? `<h4>Spectral bonus (factories)</h4>
       <ul class="glory-table glory-spectral-list">${spectralRows}</ul>
       <p class="muted glory-rules glory-schedule-hint">Per spectral: ${esc(scheduleHint)} VP (rulebook M2b).</p>`
    : '';
  host.innerHTML = `
    <section class="glory-summary">
      <h3>🏆 Glory</h3>
      <div class="glory-vp-row">
        <span class="muted">Career VP</span>
        <strong class="glory-vp">${vps}</strong>
      </div>
      <h4>Chits in hand</h4>
      <div class="glory-chits">${zonesEarned}</div>
      <h4>Ticker-tape table</h4>
      <ul class="glory-table">${zoneTableRows}</ul>
      <p class="muted glory-rules">
        Land the rocket in a heliocentric zone for the first time to
        earn a chit. Return to LEO to convert all chits to VP.
      </p>
    </section>
    <section class="endgame-summary">
      <h3>📊 If the game ended now</h3>
      <div class="glory-vp-row">
        <span class="muted">Endgame VP (tokens + spectral + glory)</span>
        <strong class="endgame-grand-vp">${score.grandTotal}</strong>
      </div>
      <h4>Tokens on the map (+1 each)</h4>
      <ul class="glory-table">${tokenRows}</ul>
      ${spectralBlock}
      <p class="muted glory-rules">
        Rulebook M2. VP is awarded only at endgame; ops don't tick the
        counter mid-game. Spectral bonus is per-spectral diminishing
        (M2b Exploitation Track): each successive factory of the
        same spectral pays less than the last.
      </p>
    </section>
  `;
}

// Mission log pane: every action the player took this turn, plus
// the per-turn history below. Undo Last calls the matching
// per-feature undo (currently only `move` is wired); the log entry
// is popped by the feature itself so we stay consistent. Re-paints
// on every log change.
let _logListenerHooked = false;
function renderMissionLog() {
  if (!_logListenerHooked) {
    _logListenerHooked = true;
    onLogChange(() => {
      const panel = document.getElementById('browse-sidepanel');
      if (panel && panel.dataset.active === 'log') paintMissionLog();
    });
  }
  paintMissionLog();
}
function paintMissionLog() {
  const host = document.getElementById('browse-log');
  if (!host) return;
  const actions = getActions();
  const history = getHistory();
  const lastUndoableIdx = (() => {
    for (let i = actions.length - 1; i >= 0; i--) {
      if (actions[i].type === 'move') return i;
    }
    return -1;
  })();
  const turnActions = actions.length
    ? actions.map((a, i) => `
        <li class="log-row ${i === lastUndoableIdx ? 'is-undoable-now' : ''}">
          <span class="log-icon">${esc(a.icon || '·')}</span>
          <span class="log-summary">${esc(a.summary)}</span>
        </li>`).join('')
    : '<li class="muted log-empty">No actions yet this turn.</li>';
  const historyRows = history.length
    ? history.slice().reverse().slice(0, 8).map((h) => {
        const ev = h.event ? ` · d6 = ${h.event.dieRoll}` : '';
        return `<li class="hist-row">
          <header>Round ${h.round ?? '?'} · Turn ${h.turn ?? '?'}${ev}</header>
          <ol>${
            h.actions.map((a) => `<li>${esc(a.icon)} ${esc(a.summary)}</li>`).join('')
          }</ol>
        </li>`;
      }).join('')
    : '';
  host.innerHTML = `
    <section class="log-current">
      <h3>📋 This turn</h3>
      <div class="log-actions-bar">
        <button class="popup-btn primary"
          id="log-undo-last" ${lastUndoableIdx < 0 ? 'disabled' : ''}>
          ↩ Undo last move
        </button>
        <button class="popup-btn"
          id="log-undo-all" ${actions.filter((a) => a.type === 'move').length === 0 ? 'disabled' : ''}>
          ⏪ Undo all moves this turn
        </button>
      </div>
      <ul class="log-list">${turnActions}</ul>
    </section>
    ${history.length ? `
      <section class="log-history">
        <h4>Past turns (${history.length})</h4>
        <ol class="hist-list">${historyRows}</ol>
      </section>` : ''
    }
  `;
  host.querySelector('#log-undo-last')?.addEventListener('click', () => {
    undoRocketMove();
  });
  host.querySelector('#log-undo-all')?.addEventListener('click', async () => {
    // Repeatedly undo while there are move entries. Each call
    // awaits the rewind animation before kicking the next so the
    // user can watch the rocket trace its way back home.
    while (getActions().some((a) => a.type === 'move')) {
      const ok = await undoRocketMove();
      if (!ok) break;
    }
  });
}

// Solo panel: stats + per-round actions when a game is running,
// "New game" button otherwise. Re-rendered on every solo state
// change via the soloOnChange listener wired in mountBrowse.
let _soloListenerHooked = false;
function renderSolo() {
  if (!_soloListenerHooked) {
    _soloListenerHooked = true;
    soloOnChange(() => {
      // Re-render only if the solo pane is currently visible; the
      // ship marker is updated separately.
      const panel = document.getElementById('browse-sidepanel');
      if (panel && panel.dataset.active === 'solo') paintSolo();
      syncSoloShipMarker();
    });
  }
  paintSolo();
}

function paintSolo() {
  const host = document.getElementById('solo-panel');
  if (!host) return;
  const s = soloState();
  if (!s) {
    const marketMode = getMarketMode();
    const marketOn = marketMode === MARKET_MODE.MARKET;
    // No more 'Start solo game' button - the sandbox itself
    // IS the solo game now. The legacy soloNewGame() flow
    // and its descriptive paragraph are gone; the panel just
    // surfaces the Reset + card-economy toggle.
    host.innerHTML = `
      <!-- Game-mode selector. Sandbox is the only playable mode
           today and is selected by default; Campaign is a
           placeholder for the published campaign variant
           (out of scope for now, see CLAUDE.md). These chips
           are passive indicators - tapping Sandbox just
           re-affirms the selection; they do NOT toggle the
           multiplayer view (that lives on the topbar). -->
      <div class="game-mode-row">
        <button class="game-mode-btn is-active" id="game-mode-sandbox"
          title="Sandbox / solo - always on. The single-player game.">🗺 Sandbox</button>
        <button class="game-mode-btn" id="game-mode-campaign" disabled
          title="Campaign variant - not implemented yet.">📖 Campaign (soon)</button>
      </div>
      <p class="muted">Sandbox / solo mode is always on. Start a
      new game to clear the board, and use the card economy
      toggle below to switch between Free Library and Card
      Market shopping rules.</p>
      <div class="solo-actions">
        <button class="primary" id="sandbox-reset"
          title="Clear the board and start a fresh sandbox game">🆕 New game</button>
      </div>
      <!-- New-game settings. Starter cash seeds the aqua bank
           on the next New game. Default ON (100 aqua). -->
      <div class="newgame-settings">
        <label class="newgame-toggle">
          <input type="checkbox" id="starter-cash-toggle" ${getStarterCash() ? 'checked' : ''} />
          <span>Start with $${STARTER_CASH_AMOUNT} starter cash</span>
        </label>
        <p class="muted newgame-hint">When off, a new game starts at $0 - earn aqua via Income ops and Free Market sales.</p>
        <label class="newgame-toggle">
          <input type="checkbox" id="fuel-consumption-toggle" ${getFuelConsumption() ? 'checked' : ''} />
          <span>Fuel consumption</span>
        </label>
        <p class="muted newgame-hint">When on (default), each move spends water (fuel-per-burn × burns) and is blocked without enough fuel. When off, movement is free.</p>
      </div>
      <!--
        Stage-3 Card Market toggle (industrialize.md "Sandbox
        card-economy toggle"). Flipping the mode RESETS the game
        - the economy is a setup-time decision, not a mid-game
        flip - so the click handler confirms first.
      -->
      <div class="sandbox-market-toggle">
        <h4>🃏 Card economy</h4>
        <p class="muted">
          <strong>Free Library</strong>: patents are free draws,
          auctions cost only the per-turn op.
          <strong>Card Market</strong>: auctions consume a Hand
          card; Free Market sells a Hand card for +${FREE_MARKET_AQUA} aqua.
          Toggling resets the game.
        </p>
        <div class="market-mode-row">
          <button id="market-mode-library" class="market-mode-btn ${marketOn ? '' : 'is-active'}">📚 Free Library</button>
          <button id="market-mode-market"  class="market-mode-btn ${marketOn ? 'is-active' : ''}">🃏 Card Market</button>
        </div>
      </div>
      <!-- Saved games. Save current state as a new slot or
           overwrite an existing one; click a save (or its Load
           button) to restore it. List is sorted newest-first. -->
      <div class="sandbox-saves">
        <h4>💾 Saved games</h4>
        <div class="saves-actions">
          <button id="save-new" class="primary" title="Snapshot the current game into a new save slot">💾 Save as new</button>
        </div>
        <ul id="saves-list" class="saves-list"></ul>
      </div>
    `;
    renderSavesList();
    // Sandbox mode chip: already the active mode, so tapping it
    // is a no-op confirmation - NOT a multiplayer toggle (that
    // lives on the topbar). Campaign is disabled (out of scope).
    const sandboxModeBtn = host.querySelector('#game-mode-sandbox');
    if (sandboxModeBtn) sandboxModeBtn.onclick = () => {
      setStatus('Sandbox is the active game mode.');
    };
    host.querySelector('#save-new').onclick = () => {
      const name = prompt('Name this save:', defaultSaveName());
      if (name === null) return; // cancelled
      const rec = createSave(name);
      setStatus(`💾 Saved game as "${esc(rec.name)}".`);
      renderSavesList();
    };
    // Starter-cash toggle: persists the new-game preference.
    // Takes effect on the NEXT New game (doesn't retroactively
    // change the current bank).
    const starterToggle = host.querySelector('#starter-cash-toggle');
    if (starterToggle) starterToggle.onchange = () => {
      setStarterCash(starterToggle.checked);
      setStatus(starterToggle.checked
        ? `New games will start with $${STARTER_CASH_AMOUNT} starter cash.`
        : 'New games will start with $0 - earn aqua via Income / Free Market.');
    };
    // Fuel-consumption toggle. Takes effect immediately (moves
    // start spending water) and persists for new games.
    const fuelToggle = host.querySelector('#fuel-consumption-toggle');
    if (fuelToggle) fuelToggle.onchange = () => {
      setFuelConsumption(fuelToggle.checked);
      setStatus(fuelToggle.checked
        ? '⛽ Fuel consumption on - moves now spend water (fuel-per-burn × burns).'
        : '⛽ Fuel consumption off - movement is free.');
    };
    host.querySelector('#sandbox-reset').onclick = () => {
      const cash = getStarterCash() ? `$${STARTER_CASH_AMOUNT}` : '$0';
      if (!confirm(`Start a new game? This clears your hand, rocket, position, planned route, outposts, factories, colonies, discs, glory, mission log, the turn clock, and reseeds the aqua bank to ${cash}.`)) return;
      doSandboxReset();
      setStatus(`🆕 New game - board cleared, aqua bank reseeded to ${cash}. Pick your starting crew.`);
      // Mandatory starting-crew pick (user 2026-05): the crew
      // wizard fires automatically on New game.
      openCrewWizard();
    };
    const flipMode = (next) => {
      if (next === marketMode) return;
      const label = next === MARKET_MODE.MARKET ? 'Card Market' : 'Free Library';
      if (!confirm(`Switch to ${label}? This RESETS the sandbox (hand, rocket, outposts, factories, colonies, discs, glory, log, clock, aqua).`)) return;
      // Reset browse-locals first, then flip the mode. setMarketMode
      // calls resetSandboxEconomy internally, which wipes the
      // global state stores but doesn't know about browse's
      // module-locals (_rocketSiteId, route, trail, etc).
      doBrowseLocalReset();
      setMarketMode(next);
      setStatus(`Card economy: ${label}. Sandbox reset.`);
      paintSolo();
    };
    host.querySelector('#market-mode-library').onclick = () => flipMode(MARKET_MODE.LIBRARY);
    host.querySelector('#market-mode-market').onclick  = () => flipMode(MARKET_MODE.MARKET);
    return;
  }
}

// Render the saved-games list inside the game manager panel.
// Sorted newest-first by saves.js#listSaves. Each row: name +
// timestamp, plus Load / Overwrite / Rename / Delete. Clicking
// the row's name loads it (after a confirm). Kept separate from
// paintSolo so the save actions can re-render just the list
// without repainting the whole panel.
// ---- Starting crew ----
//
// The player picks ONE faction face (of the 6 double-faced
// crew cards) at New-game time. The choice is recorded under
// hf-sandbox-crew-faction (so it rides along in saves) and the
// chosen crew card spawns in the LEO Stack (carrying the picked
// face) as their starting crew. Crew never enters the hand.
const STORAGE_CREW = 'hf-sandbox-crew-faction';

function getPickedCrew() {
  try {
    const raw = localStorage.getItem(STORAGE_CREW);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function setPickedCrew(cardId, face) {
  try { localStorage.setItem(STORAGE_CREW, JSON.stringify({ cardId, face })); }
  catch { /* private mode */ }
}

// Mandatory starting-crew wizard. Modal with no cancel/backdrop
// dismiss - the player MUST pick a faction before play. On
// confirm: records the chosen faction, drops the crew card into
// the Hand. onDone (optional) fires after the pick commits.
function openCrewWizard(onDone) {
  document.querySelector('.crew-wizard-overlay')?.remove();
  let selected = null; // { cardId, face }

  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay crew-wizard-overlay';
  overlay.tabIndex = -1;
  // No backdrop-close, no Escape-close: the pick is mandatory.
  const dialog = document.createElement('div');
  dialog.className = 'crew-wizard-modal';
  overlay.appendChild(dialog);

  const commit = () => {
    if (!selected) return;
    setPickedCrew(selected.cardId, selected.face);
    const card = CREW_BY_ID[selected.cardId];
    const faction = card?.faces?.[selected.face];
    // Crew always spawns in the LEO Stack (variant rule, user
    // 2026-05). The chosen faction is recorded separately as the
    // player's committed faction; the physical crew card carries
    // both faces.
    if (card) addCardToLeo({ id: card.id, kind: 'crew', face: selected.face });
    overlay.remove();
    setStatus(`🧑‍🚀 Starting crew: <strong>${esc(faction?.name || selected.cardId)}</strong> (${esc(faction?.bonus || '')}). Crew card spawned in your LEO Stack.`);
    logAction({
      type: 'crew_pick',
      icon: '🧑‍🚀',
      summary: `Picked starting faction: ${faction?.name || selected.cardId}`,
      undoable: false,
      data: { cardId: selected.cardId, face: selected.face },
    });
    try { onDone?.(); } catch (e) { console.error('crew wizard onDone:', e); }
  };

  const render = () => {
    const selName = selected
      ? esc(CREW_BY_ID[selected.cardId].faces[selected.face].name)
      : '...';
    dialog.innerHTML = `
      <div class="crew-wizard-head">
        <h3>🧑‍🚀 Pick your starting crew</h3>
        <p class="muted">Choose one faction. Its privilege is your edge for the game. (Required to start.)</p>
      </div>
      <div class="crew-faction-grid"></div>
      <div class="card-modal-actions">
        <button type="button" class="modal-btn primary crew-confirm" ${selected ? '' : 'disabled'}>🚀 Start with ${selName}</button>
      </div>
    `;
    // Show the actual crew cards (the 12 single-face faction
    // faces), each a selectable tile.
    const grid = dialog.querySelector('.crew-faction-grid');
    for (const c of CREW_FACES) {
      const isSel = selected && selected.cardId === c.srcId && selected.face === c.face;
      const tile = document.createElement('div');
      tile.className = 'crew-faction-card' + (isSel ? ' is-selected' : '');
      tile.setAttribute('role', 'button');
      tile.tabIndex = 0;
      tile.dataset.card = c.srcId;
      tile.dataset.face = c.face;
      tile.appendChild(renderCard(c, { type: 'crew' }));
      const pick = () => { selected = { cardId: c.srcId, face: c.face }; render(); };
      tile.addEventListener('click', pick);
      tile.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
      });
      grid.appendChild(tile);
    }
    dialog.querySelector('.crew-confirm').addEventListener('click', () => {
      if (selected) commit();
    });
  };

  render();
  document.body.appendChild(overlay);
  overlay.focus();
}

function renderSavesList() {
  const host = document.getElementById('saves-list');
  if (!host) return;
  const saves = listSaves();
  if (!saves.length) {
    host.innerHTML = '<li class="saves-empty muted">No saved games yet. Use "Save as new" to snapshot the current game.</li>';
    return;
  }
  const fmtTime = (ts) => {
    try { return new Date(ts).toLocaleString(); } catch { return ''; }
  };
  host.innerHTML = saves.map((s) => `
    <li class="saves-row" data-id="${esc(s.id)}">
      <button type="button" class="saves-load-name" title="Load this save">
        <span class="saves-name">${esc(s.name)}</span>
        <span class="saves-time muted">${esc(fmtTime(s.timestamp))}</span>
      </button>
      <div class="saves-row-actions">
        <button type="button" class="saves-overwrite" title="Overwrite this save with the current game">⤓ Overwrite</button>
        <button type="button" class="saves-rename" title="Rename this save">✎</button>
        <button type="button" class="saves-delete" title="Delete this save">🗑</button>
      </div>
    </li>
  `).join('');

  host.querySelectorAll('.saves-row').forEach((row) => {
    const id = row.getAttribute('data-id');
    const save = saves.find((s) => s.id === id);
    row.querySelector('.saves-load-name').addEventListener('click', () => {
      if (!confirm(`Load "${save.name}"? Your current game state will be replaced (save it first if you want to keep it).`)) return;
      // Restores localStorage + reloads the page so every
      // state module re-reads cleanly.
      loadSaveAndReload(id);
    });
    row.querySelector('.saves-overwrite').addEventListener('click', () => {
      if (!confirm(`Overwrite "${save.name}" with the current game state?`)) return;
      const rec = overwriteSave(id);
      if (rec) setStatus(`💾 Overwrote save "${esc(rec.name)}".`);
      renderSavesList();
    });
    row.querySelector('.saves-rename').addEventListener('click', () => {
      const next = prompt('Rename save:', save.name);
      if (next === null) return;
      if (renameSave(id, next)) {
        setStatus(`💾 Renamed save to "${esc(next.trim())}".`);
        renderSavesList();
      }
    });
    row.querySelector('.saves-delete').addEventListener('click', () => {
      if (!confirm(`Delete save "${save.name}"? This can't be undone.`)) return;
      deleteSave(id);
      setStatus(`🗑 Deleted save "${esc(save.name)}".`);
      renderSavesList();
    });
  });
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// Site count and edge count for debug surfaces.
export const STATS = {
  siteCount: Object.keys(SITES_BY_ID).length,
  patentCount: PATENTS.length,
  milestoneCount: MILESTONES.length,
};
