// Browse view: map + patent deck + milestones + events.
//
// Read-only, no engine dependency. Lets a user inspect Stage 2 data
// without needing to start a multiplayer game. Reachable from the
// topbar; also acts as the "preview" surface that Stage 3 will
// replace with the live game.

import { MapRenderer, LEO_ANCHOR } from './render.js';
import { appBase } from '../base.js';
import { loadPlannerMap } from './planner-map.js';
import { planRoute } from './planner-nav.js';
import {
  consumeMove, refundMove, getTurn, getMovesRemaining, onTurnChange,
  getEventForRoll, getSeasonForSlot, getSeason, resetClock,
  getOpsRemaining, consumeOp,
  getDiscardsRemaining, consumeDiscard, formatTurnNumber,
} from './turn-clock.js';
import { triggerEndTurn, confirmEndTurn, openTurnClockModal, buildDie, rollDie } from './turn-clock-ui.js';
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
  onRocketChange, isRocketActive,
  getActiveThrusterId, setActiveThruster,
  getTankWater, setTankWater, addFuel, removeFuel, getTankMax,
  getStackTotals, getActiveThrusterStats, setSolarZone,
  getProspectorCards, getActiveProspectorId, setActiveProspector,
  clearActiveProspector, getActiveProspectorStats,
  isAfterburnEngaged, setAfterburn,
  getAqua, spendAqua, addAqua, onAquaChange, resetAqua,
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
import { renderDetailTrack, massLabel } from './net-thrust-detail.js';
import { MILESTONES } from '../../data/glory.js';
import { SITES_BY_ID, SOLAR_ZONES, SOLAR_ZONE_INFO } from '../../data/sites.js';
import { ZONE_POLYGONS } from '../../data/zones.js';
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
  resolveChitsFront, resolveChitsForCrew,
  getChits, getClaimedChits, getVps, getChitSides,
  isZoneVisited, resetGlory,
  onChange as onGloryChange, ZONE_CHIT_VPS,
} from './glory.js';
import {
  getFactory, createFactory,
  getColony, createColony, countColoniesByOwner,
  allFactories, allColonies,
  onFactoryChange, onColonyChange,
  COLONY_CAP_PER_PLAYER, resetFactoriesAndColonies,
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
  OUTPOST_LETTERS, resetStacks,
} from './stacks.js';
import {
  getLeoCards, addCardToLeo, removeCardFromLeoById,
  onLeoChange, resetLeoStack,
} from './leo-stack.js';
import {
  findEtProduceOptions, openEtProduceModal,
} from './et-produce.js';
import {
  defaultSaveName, listSaves, createSave, overwriteSave,
  renameSave, deleteSave, loadSaveAndReload,
} from './saves.js';
import {
  computeEndgameScore, SPECTRAL_DIMINISHING_SCHEDULE, COLONY_VP,
} from './scoring.js';
import {
  MARKET_MODE, FREE_MARKET_AQUA, STARTER_CASH_AMOUNT,
  getMarketMode, setMarketMode, onMarketChange,
  getStarterCash, setStarterCash,
  getFuelConsumption, setFuelConsumption,
  resetSandboxEconomy,
  openAuctionConfirmModal, openFreeMarketModal, openSellConfirmModal,
  findAuctionableCards,
} from './card-market.js';
import {
  DECK_TYPES, getDeck, peekTop, drawTop, addToBottom, removeFromDeck,
  cycleAllDecks, supportBonusDecks, onDeckChange, resetDecks,
} from './decks.js';
// Multiplayer glue (the sandbox map, driven from a server game). These
// are inert until mountBrowse({ online:true }) flips _online on; the
// solo path never touches them.
import { setOnline, isOnline } from './online-mode.js';
import {
  buildIdMaps, hydrateFromSnapshot, toServerId, toPlannerId,
} from './net-bridge.js';
import { abandonSandboxGame, currentSandboxId } from './sandbox-games.js';
import { getGame, getGameOps, submitGameOp, fetchChat, sendChat, remindTurn } from '../api.js';
import { ws } from '../ws.js';

// Only one map mode now (planner / "classic"); the old
// "Cleaned up" variant was disorienting next to the canonical
// planner graph and has been removed. Kept as a single function
// rather than a config object so future modes are easy to slot.
async function loadMap() {
  return loadPlannerMap();
}

let _renderer = null;
let _sidebarWired = false;
// Opens the site-search modal. Assigned by wireSearch() on map mount;
// invoked by the 🔍 button in the sidepanel tab strip.
let _openMapSearch = null;

// Subscribe once: rocket state changes (cards added / removed)
// trigger a re-render of the sandbox rocket on the map.
let _rocketSubWired = false;

// ----- Multiplayer (online) mode state -----
//
// When `mountBrowse({ online:true, ... })` runs, the sandbox UI becomes
// a thin client over a server-authoritative game: every player action
// is translated to a server op, POSTed, and the resulting snapshot is
// hydrated back into the sandbox state modules (which redraws the same
// classic map + panels). Solo mode leaves all of this null/false and
// behaves exactly as before. Guard every online branch on `_online`.
let _online = false;          // are we driving from a server game?
let _onlineGameId = null;     // server game id
let _onlineMe = null;         // { id, name, token }
// Spectator mode: viewer is signed in but NOT in the game's roster.
// Set when mountBrowse({ spectator: true, ... }); blocks every action
// submission path + skips the crew-pick wizard (no faction to set).
let _spectator = false;
// Polling fallback for missed WS broadcasts. User reported 2026-05:
// "auction window didn't auto open either. I had to refresh". WS
// reconnect/resub races + flaky mobile networks can drop snapshots,
// so re-fetch the full game state every few seconds and re-apply.
// applySnapshot is idempotent. Cleared on unmountBrowseOnline.
//
// Two cadences:
//   ONLINE_POLL_MS         normal cadence (board moves at human speed)
//   ONLINE_POLL_AUCTION_MS fast cadence while an auction is open
//                          (bidders + auctioneer expect near-realtime
//                          feedback - 5s feels broken when you're
//                          waiting on the auctioneer to sell / keep).
// applyPollCadence() switches the interval based on the current
// snapshot's auction field.
let _onlinePoll = null;
let _onlinePollMs = 0;
// Tracks the previous snapshot's auction.awaiting so we can detect
// the bidders -> auctioneer transition and fire one eager fetch.
let _lastAuctionPhase = null;
const ONLINE_POLL_MS = 5000;
// 500 ms while an auction is live. The bidder UI gives a "stuck"
// feel any slower than that - users expect Sell / Keep to land
// near-instantly once the auctioneer has decided. Mobile networks
// easily handle two snapshot fetches per second; the snapshot is
// small JSON.
const ONLINE_POLL_AUCTION_MS = 500;
// Academia hand limit for auction participation (mirror of the server
// constant): can't start / bid / join an auction holding 4+ cards.
const AUCTION_HAND_LIMIT = 4;
let _onlineToast = null;      // (msg, level) => void, from the caller
let _onlineMaps = null;       // { serverToPlanner, plannerToServer }
let _onlineSnapshot = null;   // latest server snapshot (for turn checks)
// Op-log seq of the last snapshot we actually hydrated. applySnapshot
// short-circuits when an incoming snapshot carries the same seq, so a
// poll tick that finds nothing new is a TRUE no-op: no module
// re-hydrate, no re-render, no stomping on in-progress local UI
// (boost marks, open modals, etc). Reset on unmount.
let _lastAppliedSeq = -1;
let _onlineOffWS = null;      // unsubscribe handle for the game channel
let _onlineBusy = false;      // in-flight op guard (prevents double submit)
let _onlineRoom = null;       // table / lobby name for the multiplayer panel
let _onlineLobbyId = null;    // lobby id (for chat REST + WS channel)
let _onlineLeave = null;      // () => void callback wired by the host page
let _onlineChatOff = null;    // unsubscribe handle for the lobby chat WS
// In-memory mirror of the table chat. Kept module-level so a second
// chat surface (the auction overlay's side chat) can backfill from it
// when it mounts mid-conversation, without re-fetching history. Capped
// so a long session can't grow it without bound.
const _chatLog = [];
const CHAT_LOG_CAP = 200;

// Online auction state (kept module-level so it survives the snapshot
// re-renders that opponents' bids trigger): _bidDraft / _joinDraft
// preserve a half-typed amount; _auctionKey resets them when a new lot
// opens; _deckPickerOpen tracks the auctioneer's inline deck picker.
let _bidDraft = '';
let _joinDraft = '';
let _auctionKey = null;
let _deckPickerOpen = false;
// Minimize state for the two blocking MP overlays. When true the
// overlay collapses to a small floating chip docked at the map's left
// edge so the player can still pan the board, inspect cards, and chat
// while the draft / auction stays live. Persisted module-level so the
// crew-draft overlay (rebuilt every snapshot) keeps its minimized
// state across re-renders. The auction resets to expanded on each new
// lot so a fresh card always surfaces.
let _crewDraftMin = false;
let _auctionMin = false;
// Rising-edge tracker for auction turn notifications: remembers, per lot,
// whether it was already "my turn" (bid/pass) or "my close" so a re-render
// only toasts when the turn newly lands on me - e.g. the auctioneer raises
// (others get re-prompted) or the last bidder acts (auctioneer prompted to
// close). Reset when the lot (cardId) changes.
let _auctionTurnEdge = null;

// Patent decks the auctioneer can put up for auction (one per server
// deck type). Counts are read live from the snapshot.
const MP_AUCTION_DECKS = [
  ['thruster', 'Thruster'], ['reactor', 'Reactor'], ['radiator', 'Radiator'],
  ['refinery', 'Refinery'], ['robonaut', 'Robonaut'], ['generator', 'Generator'],
];

export function isBrowseOnline() { return _online; }

// True only while the game-room view is the on-screen view. The
// crew-draft / auction overlays attach to document.body, so without
// this gate a snapshot poll that arrives after the player walked back
// to the lobby would re-create the overlay (or its minimized chip)
// hovering over the lobby. They belong to the game room only.
function gameViewVisible() {
  const view = document.getElementById('view-browse');
  return !!view && !view.classList.contains('hidden');
}

// Re-evaluate the body-attached room overlays (crew draft + auction)
// against the current view + cached snapshot. Called on every view
// switch (main.js#showView) because the snapshot poll is seq-gated and
// won't fire when nothing changed - so leaving the game room would
// otherwise leave a stale chip hovering over the lobby. Both renderers
// gate on gameViewVisible() and handle a null/absent payload by
// removing themselves, so this both tears down (off-room) and restores
// (back in-room, still drafting/auctioning) from the cached snapshot.
export function refreshRoomOverlays() {
  syncCrewDraftOverlay(_online ? _onlineSnapshot : null);
  renderOnlineAuction(_online && _onlineSnapshot ? _onlineSnapshot.auction : null);
}

export function mountBrowse(opts = {}) {
  const view = document.getElementById('view-browse');
  if (!view) return;
  // Stash online context up front so the renderMap()/sync paths below
  // (which fire synchronously during mount) already see online mode.
  if (opts && opts.online) {
    _online = true;
    _spectator = !!opts.spectator;
    _onlineGameId = opts.gameId || null;
    _onlineMe = opts.me || null;
    _onlineToast = typeof opts.onToast === 'function' ? opts.onToast : (() => {});
    _onlineRoom = opts.room || null;
    _onlineLobbyId = opts.lobbyId || null;
    _onlineLeave = typeof opts.onLeave === 'function' ? opts.onLeave : null;
    setOnline(true);
  } else {
    // Mounting solo. Detach any prior online plumbing, then isolate this
    // session: the state modules are process-wide singletons, so an online
    // game's hydrated state would otherwise bleed straight into the
    // sandbox. Reset on an explicit new game (opts.newGame) OR whenever we
    // came from online. A plain resume (neither) keeps the saved solo game.
    const wasOnline = _online;
    if (_online) unmountBrowseOnline();
    if (opts.newGame || wasOnline) resetSoloGame();
  }
  if (!_rocketSubWired) {
    _rocketSubWired = true;
    onRocketChange(syncSandboxRocket);
    onRocketChange(refreshOpenSitePopup);
    onRocketChange(syncFocusedSite);
    // Per-crew chit reconciliation: when a crew leaves the rocket by
    // any path (transfer / decommission / back-to-hand), its carried
    // chits flip face-up to FRONT. Colonise is handled explicitly
    // (and suppressed here) so its rollback path stays clean.
    onRocketChange(reconcileChitOwners);
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
  syncMpTabVisibility();
  wireSidebar();
  wireHandStrip();
  // renderMap() is async (it awaits the map load that populates
  // _activeData). In online mode we have to wait for it before we can
  // build the id maps + hydrate the first snapshot, so chain the
  // bootstrap off the same promise. Solo mode just kicks it and returns.
  const mapReady = renderMap();
  if (_online) {
    mapReady.then(() => bootstrapOnlineGame());
  } else if (opts.newGame) {
    // Fresh solo game: run the setup wizard (card economy + house
    // rules) and then the mandatory crew pick before play starts, so
    // the player tweaks how they want to play and chooses a faction
    // instead of dropping onto a board with defaults and no crew.
    mapReady.then(() => openSandboxSetupWizard(() => openCrewWizard(() => showPane(null))));
  }
}

// One-time online bootstrap: build the server<->planner id maps from
// the freshly-loaded planner data, fetch the current game, hydrate it
// into the sandbox modules, then subscribe to live updates. Safe to
// no-op if mount raced an unmount.
async function bootstrapOnlineGame() {
  if (!_online || !_activeData || !_onlineGameId || !_onlineMe) return;
  _onlineMaps = buildIdMaps(_activeData);
  const r = await getGame(_onlineGameId, _onlineMe.token);
  if (!_online) return; // unmounted while the fetch was in flight
  if (!r.ok) {
    _onlineToast(humanizeOnlineOpError(r.error), 'error');
    return;
  }
  applySnapshot(r.data.game.state, r.data.game.seq);
  // Open the multiplayer panel so the player lands on the table (room,
  // turn, roster) rather than the solo game-mode pane.
  showPane('mp');
  // Live relay. Every server-applied op (ours or an opponent's) lands
  // here as the full game payload; re-hydrate from it.
  const channel = 'game:' + _onlineGameId;
  ws.subscribe(channel);
  const off = ws.on('game_update', (msg) => {
    if (!_online || !msg || msg.gameId !== _onlineGameId || !msg.game) return;
    // Route ops (SET_ROUTE / CLEAR_ROUTE) only change SECRET server state
    // the client already mirrors locally - re-hydrating from them is
    // pointless and causes a visible canvas blink (the hand reflow resizes
    // the map canvas). Absorb them quietly so the seq stays current.
    const kind = msg.op && msg.op.kind;
    if (kind === 'SET_ROUTE' || kind === 'CLEAR_ROUTE') {
      noteQuietSnapshot(msg.game.state, msg.game.seq);
      return;
    }
    applySnapshot(msg.game.state, msg.game.seq);
  });
  _onlineOffWS = () => { off(); ws.unsubscribe(channel); };

  // Polling fallback. WS is the primary path, but if a broadcast is
  // dropped (mobile network, tab backgrounded, server hiccup) the
  // user can sit with a stale board. Re-fetch on the active cadence
  // (5s normal, 1s while an auction is open) and re-apply.
  // applySnapshot is a no-op when the seq matches.
  setPollCadence(ONLINE_POLL_MS);

  // In-pane chat: fetch the lobby's chat history (table conversation)
  // and subscribe to live 'chat' broadcasts on the lobby channel. Both
  // are owned by browse.js so the mp pane stays self-contained.
  if (_onlineLobbyId && _onlineMe) {
    // New room: drop chat cached from any previously-open room so its
    // messages can't bleed into this table, and clear the mounted chat
    // surfaces before this room's history backfills below.
    _chatLog.length = 0;
    resetChatList(document.getElementById('mp-chat-list'));
    resetChatList(document.getElementById('mp-auction-chat-list'));
    const chatChannel = 'lobby:' + _onlineLobbyId;
    ws.subscribe(chatChannel);
    const offChat = ws.on('chat', (msg) => {
      if (!_online || !msg || !msg.message) return;
      if (msg.message.lobbyId !== _onlineLobbyId) return;
      appendMpChat(msg.message, { live: true });
    });
    _onlineChatOff = () => { offChat(); ws.unsubscribe(chatChannel); };
    const hist = await fetchChat(_onlineLobbyId, {}, _onlineMe.token);
    if (_online && hist && hist.ok && hist.data && Array.isArray(hist.data.entries)) {
      for (const m of hist.data.entries) appendMpChat(m);
    }
  }
}

// One-shot snapshot fetch outside the interval cadence. Used to
// shave the worst-case "I just placed the winning bid and now I
// wait a full tick before Sell lands" latency. Coalesced: a poll
// fetch already in flight pre-empts a duplicate.
let _eagerPollInFlight = false;
async function eagerPoll() {
  if (!_online || !_onlineGameId || !_onlineMe || _eagerPollInFlight) return;
  _eagerPollInFlight = true;
  try {
    const r = await getGame(_onlineGameId, _onlineMe.token);
    if (!_online) return;
    if (r && r.ok && r.data && r.data.game && r.data.game.state) {
      applySnapshot(r.data.game.state, r.data.game.seq);
    }
  } catch { /* next tick will retry */ }
  finally { _eagerPollInFlight = false; }
}

// Swap the poll interval to the requested cadence. Idempotent when
// the cadence already matches, so applySnapshot can call it on every
// snapshot without thrashing the interval.
function setPollCadence(ms) {
  if (_onlinePollMs === ms && _onlinePoll) return;
  if (_onlinePoll) clearInterval(_onlinePoll);
  _onlinePollMs = ms;
  _onlinePoll = setInterval(async () => {
    if (!_online || !_onlineGameId || !_onlineMe) return;
    try {
      const poll = await getGame(_onlineGameId, _onlineMe.token);
      if (!_online) return;
      if (poll && poll.ok && poll.data && poll.data.game && poll.data.game.state) {
        // Seq-gated: a poll that returns the same seq we already have
        // is a no-op inside applySnapshot - it won't touch local UI.
        applySnapshot(poll.data.game.state, poll.data.game.seq);
      }
    } catch (err) {
      // Network blips are expected; the next tick will retry.
    }
  }, ms);
}

// Replace all sandbox module state from a server snapshot, then repaint
// the rocket marker at the translated planner node (or LEO when the
// server site has no planner node / the ship is at LEO). Caches the
// snapshot so the action routers + turn checks can read activeIndex.
// `seq` is the server op-log sequence the snapshot was taken at (from
// the game wrapper). When it matches the last applied seq the server
// state hasn't advanced, so we skip the entire hydrate - polling must
// NOT invalidate local UI unless the server actually moved. Callers
// that need to force a re-hydrate (error snap-back to the cached
// state) pass seq = undefined.
// Absorb a snapshot WITHOUT re-hydrating any module: update the cached
// state + the applied-seq so later polls/echoes are seq-gated, but don't
// touch the DOM or canvas. Used for ops whose only change is invisible to
// this client (its own secret route), so they never trigger a redraw.
function noteQuietSnapshot(snapshot, seq) {
  if (!snapshot) return;
  if (seq != null && seq <= _lastAppliedSeq) return;
  if (seq != null) _lastAppliedSeq = seq;
  _onlineSnapshot = snapshot;
}

function applySnapshot(snapshot, seq) {
  if (!snapshot || !_onlineMaps || !_onlineMe) return;
  // Seq is monotonic: ignore a snapshot we've already passed. `===` alone
  // wasn't enough - an in-flight poll that resolves with an OLDER seq
  // AFTER a newer op applied would re-apply stale state and silently
  // revert the newer op (e.g. a fresh outpost vanishing). `<=` drops both
  // duplicates and out-of-order arrivals. A forced re-apply passes
  // seq = undefined (error snap-back) and is never gated.
  if (seq != null && seq <= _lastAppliedSeq) return;
  if (seq != null) _lastAppliedSeq = seq;
  // Hold the state we're about to replace so the transition animator
  // (below) can DIFF old -> new and replay the motion the player would
  // otherwise miss: a rocket sliding to its new site, an opponent's
  // move, the undo rewind, a prospect die, a card drifting between
  // stacks. Doctrine: animate the diff, then let the hydrate snap the
  // final state. A forced re-apply (error snap-back, seq omitted) gets
  // no prev so it snaps without animating.
  const prevSnapshot = (seq != null) ? _onlineSnapshot : null;
  _onlineSnapshot = snapshot;
  // Card economy is server-authoritative in multiplayer (state.economy).
  // Pin the client's MARKET_MODE to whatever the snapshot says BEFORE
  // any hydrators run so the cart tab + Free Market / Research Auction
  // gating reads the right value. skipReset so we don't wipe the
  // fresh server state. Defaults to 'market' if the snapshot is from
  // a pre-economy build.
  const targetMode = snapshot.economy === 'library'
    ? MARKET_MODE.LIBRARY : MARKET_MODE.MARKET;
  if (getMarketMode() !== targetMode) {
    setMarketMode(targetMode, { skipReset: true });
  }
  // hydrateFromSnapshot fans the snapshot out to every state module
  // (rocket/hand/outposts/glory/clock/discs/factories/decks/leo) and
  // returns the planner-node id our rocket sits on (null = LEO).
  const pid = hydrateFromSnapshot(snapshot, _onlineMe.id, _onlineMaps);
  // Drive the same code path the solo move-commit uses: set the
  // rocket's site id, persist (a no-op for storage while online), and
  // resync the sprite so the marker repaints at `pid` (LEO when null).
  _rocketSiteId = pid || null;
  persistRocketSite();
  syncSandboxRocket();
  // Paint the player's own seat colour across their chrome (top bar +
  // hand strip) so they always know "I am this colour".
  syncMeColor(snapshot);
  // Opponent rockets on the map (colour-coded, offset when colocated).
  syncMpRockets(snapshot);
  // Animate everything that MOVED between the last applied state and
  // this one: rockets sliding along their route (mine, opponents', and
  // the undo rewind), prospect dice, and cards drifting between stacks.
  // The hydrate above already snapped the final state; the animator
  // overrides the sprites back to their origin and tweens forward, so
  // the player SEES the change happen instead of it teleporting.
  animateOnlineTransitions(prevSnapshot, snapshot);
  // Refresh the multiplayer table panel (room / turn / roster) from the
  // same snapshot so opponents' positions + resources stay live.
  renderMpPanel(snapshot);
  // Big black turn banner above the hand. Mirrors the same source-of-
  // truth (snapshot.activeIndex) the panel uses so the two never drift.
  syncMpTurnBanner(snapshot);
  // Toolbar end-turn / op / move buttons: greyed out when it's not
  // my turn. Server is the source of truth for whose turn it is, so
  // we re-fire refreshTurnBudget on every snapshot.
  const mapHost = document.getElementById('browse-map');
  if (mapHost && typeof mapHost._refreshTurnBudget === 'function') {
    try { mapHost._refreshTurnBudget(); } catch (e) { /* ignore */ }
  }
  // Mission log pane: when open and we're online, re-fetch the server
  // op log so a newly-landed op (auction, end-turn, etc.) appears in
  // near-realtime. Local sandbox log changes don't fire in MP so the
  // existing onLogChange listener wouldn't catch this.
  const panel = document.getElementById('browse-sidepanel');
  if (panel && panel.dataset.active === 'log') {
    const logHost = document.getElementById('browse-log');
    if (logHost) paintOnlineMissionLog(logHost);
  }
  // Competitive auction overlay is wired separately (see the TODO hook).
  renderOnlineAuction(snapshot.auction);
  // Round-end first-player handoff + end-of-game standings. Both are
  // driven straight off the snapshot and idempotent, so they appear /
  // clear as the server state flips.
  renderFirstPlayerChooser(snapshot.pendingFirstPlayer);
  renderGameOver(snapshot);
  // Speed the snapshot poll up while an interactive freeze is open (an
  // auction, or a first-player handoff) so the waiting players see it
  // resolve in near-realtime even if the WS broadcast was dropped. Drop
  // back to the normal cadence otherwise.
  const fastPoll = snapshot.auction || snapshot.pendingFirstPlayer;
  setPollCadence(fastPoll ? ONLINE_POLL_AUCTION_MS : ONLINE_POLL_MS);
  // Eager one-shot fetch the moment the auctioneer's phase opens
  // (awaiting === 'auctioneer'). The accept can land within ms of
  // the bidder seeing this state; without a head-start the bidder
  // waits a full poll tick AFTER the auctioneer accepts. Skipped
  // for the auctioneer themself - their own submit response already
  // applied the post-sell state. _lastAuctionPhase guards against
  // re-firing on every snapshot in the same phase (would otherwise
  // loop at network speed).
  const auctionPhase = snapshot.auction ? snapshot.auction.awaiting : null;
  if (auctionPhase === 'auctioneer' && _lastAuctionPhase !== 'auctioneer') {
    const myId = _onlineMe && _onlineMe.id;
    if (snapshot.auction.auctioneerId !== myId) eagerPoll();
  }
  _lastAuctionPhase = auctionPhase;
  // If I haven't picked my starting crew yet, open the mandatory crew
  // wizard. Driven off the snapshot (player.faction) so it survives
  // reloads / late joins, and so a re-bootstrap won't reopen the
  // wizard once the pick is committed server-side.
  maybePromptCrewPick(snapshot);
  syncCrewDraftOverlay(snapshot);
}

// One-at-a-time guard so a flurry of snapshots (e.g. another player's
// PICK_CREW echoes) doesn't stack multiple wizard overlays. Cleared
// when the modal closes or when we unmount the online session.
let _crewWizardOpen = false;

function maybePromptCrewPick(snapshot) {
  if (!_online || _spectator || _crewWizardOpen || !snapshot || !_onlineMe) return;
  const myId = _onlineMe.id;
  const myp = (snapshot.players || []).find((p) => p.profileId === myId);
  if (!myp || myp.faction) return;
  _crewWizardOpen = true;
  // Server assigns each player one of the six crew-card colours at
  // game create. The wizard filters down to the two faces of the
  // crew card matching that colour - both faces are legal picks
  // (it's a single double-sided card), everything else is locked.
  const desc = myp.color
    ? 'Your faction colour is locked in by the server. Pick one of the two faces of your crew card.'
    : 'Pick your starting faction. Every player chooses one before play; your pick is permanent for this session.';
  openCrewWizard({
    description: desc,
    restrictToColor: myp.color || null,
    onCommit: ({ cardId, face }) => {
      submitMpCrewOp({ kind: 'PICK_CREW', cardId, face });
    },
    onDone: () => { _crewWizardOpen = false; },
  });
}

// Crew-draft waiting overlay. Visible whenever the snapshot says
// state.draftPhase === 'crew'. Shows live "Picked: X / Y" progress
// + which players still need to commit, and gives the local player
// a "Change pick" button while they're waiting (they can switch any
// number of times until the last player commits, at which point the
// server flips draftPhase to 'play' and the overlay clears).
function syncCrewDraftOverlay(snapshot) {
  const existing = document.getElementById('mp-crew-draft-overlay');
  const drafting = !!(snapshot && snapshot.draftPhase === 'crew') && !_spectator
    && gameViewVisible();
  if (!drafting) {
    if (existing) existing.remove();
    setMpTurnAction('crew', null);
    return;
  }
  const players = snapshot.players || [];
  const picked = players.filter((p) => !!p.faction);
  const waitingOn = players.filter((p) => !p.faction);
  const myId = _onlineMe && _onlineMe.id;
  const myp = players.find((p) => p.profileId === myId);
  const myFaction = myp && myp.faction;

  // Keep a single overlay element; rebuild the body each snapshot
  // so the "Picked: X / Y" counters stay live.
  let overlay = existing;
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'mp-crew-draft-overlay';
    overlay.className = 'mp-crew-draft-overlay';
    document.body.appendChild(overlay);
  }
  const fName = (p) => {
    const card = p.faction && CREW_BY_ID[p.faction.cardId];
    const face = card && card.faces && card.faces[p.faction.face];
    return (face && face.name) || (p.faction && p.faction.cardId) || '';
  };
  // While the wizard is open we keep the overlay there but dimmed
  // behind it - the wizard's own backdrop covers it. Otherwise
  // surface the "waiting" panel front and centre.
  overlay.innerHTML = `
    <div class="mp-crew-draft-panel" role="dialog" aria-label="Crew draft">
      <div class="mp-modal-titlebar">
        <h3>🧑‍🚀 Crew draft</h3>
        <button type="button" class="mp-mini-btn" title="Minimize" aria-label="Minimize">&minus;</button>
      </div>
      <p class="muted mp-crew-draft-count">
        Picked: <strong>${picked.length}</strong> /
        <strong>${players.length}</strong>
      </p>
      <ul class="mp-crew-draft-roster"></ul>
      ${myFaction
        ? `<p class="mp-crew-draft-me">You picked <strong>${esc(fName(myp))}</strong>.
             You can change while others are still deciding.</p>
           <button type="button" class="modal-btn mp-crew-draft-change">🔄 Change pick</button>`
        : `<p class="mp-crew-draft-me">Open the picker to commit your faction.</p>
           <button type="button" class="modal-btn primary mp-crew-draft-open">🧑‍🚀 Pick crew</button>`}
    </div>
    <button type="button" class="mp-mini-chip" aria-label="Restore crew draft">
      🧑‍🚀 Crew draft
      <span class="mp-mini-chip-meta">${picked.length}/${players.length}</span>
    </button>
  `;
  const roster = overlay.querySelector('.mp-crew-draft-roster');
  for (const p of players) {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'mp-crew-draft-dot';
    dot.style.background = p.color || '#888';
    const name = document.createElement('span');
    name.className = 'mp-crew-draft-name player-name';
    if (p.color) name.style.setProperty('--player-color', p.color);
    name.textContent = '@' + p.name + (p.profileId === myId ? ' (you)' : '');
    const status = document.createElement('span');
    status.className = 'mp-crew-draft-status';
    if (p.faction) {
      status.textContent = '✓ ' + fName(p);
      li.classList.add('is-picked');
    } else {
      status.textContent = '… deciding';
    }
    li.append(dot, name, status);
    roster.appendChild(li);
  }
  const openBtn = overlay.querySelector('.mp-crew-draft-open');
  const changeBtn = overlay.querySelector('.mp-crew-draft-change');
  const reopen = () => {
    // _crewWizardOpen guard would block a re-open; clear it first
    // so the user can change their mind.
    _crewWizardOpen = false;
    maybePromptCrewPickForced(snapshot);
  };
  if (openBtn) openBtn.addEventListener('click', reopen);
  if (changeBtn) changeBtn.addEventListener('click', reopen);
  // Minimize / restore. The overlay is rebuilt every snapshot, so the
  // persisted _crewDraftMin flag is re-applied here and the fresh
  // buttons are re-wired each pass.
  overlay.classList.toggle('is-minimized', _crewDraftMin);
  // Docked representation in the turn bar (the floating chip is hidden via
  // CSS). Present only while collapsed; the modal shows otherwise.
  setMpTurnAction('crew', _crewDraftMin ? {
    label: '🧑‍🚀 Crew',
    meta: `${picked.length}/${players.length}`,
    needsAction: !myFaction,
    onClick: () => { _crewDraftMin = false; syncCrewDraftOverlay(_onlineSnapshot); },
  } : null);
  const miniBtn = overlay.querySelector('.mp-mini-btn');
  const miniChip = overlay.querySelector('.mp-mini-chip');
  if (miniBtn) miniBtn.addEventListener('click', () => {
    _crewDraftMin = true;
    overlay.classList.add('is-minimized');
    syncCrewDraftOverlay(_onlineSnapshot);
  });
  if (miniChip) miniChip.addEventListener('click', () => {
    _crewDraftMin = false;
    overlay.classList.remove('is-minimized');
    setMpTurnAction('crew', null);
  });
  // Suppress the bare waiting overlay while the wizard's own modal
  // is open - the modal already says everything the overlay would.
  overlay.classList.toggle('is-behind-wizard', _crewWizardOpen);
}

// Open the wizard even when the player already has a faction. Used
// by the "Change pick" button on the draft overlay - the regular
// maybePromptCrewPick early-returns once myp.faction is set.
function maybePromptCrewPickForced(snapshot) {
  if (!_online || _spectator || _crewWizardOpen || !_onlineMe) return;
  const myId = _onlineMe.id;
  const myp = (snapshot.players || []).find((p) => p.profileId === myId);
  if (!myp) return;
  _crewWizardOpen = true;
  const desc = myp.faction
    ? 'Switch to the other face of your crew card. You can change as long as other players are still picking.'
    : 'Pick one of the two faces of your crew card.';
  openCrewWizard({
    description: desc,
    restrictToColor: myp.color || null,
    onCommit: ({ cardId, face }) => {
      submitMpCrewOp({ kind: 'PICK_CREW', cardId, face });
    },
    onDone: () => { _crewWizardOpen = false; syncCrewDraftOverlay(_onlineSnapshot); },
  });
}

// Crew-pick op submitter. Like submitMpAuctionOp, this bypasses the
// turn-check in submitOnlineOp: any player can pick their crew at
// any time, regardless of whose turn it is or whether an auction is
// open. The server validates that this player owns the pick.
async function submitMpCrewOp(op) {
  if (!_online || _onlineBusy) return false;
  if (_spectator) return false;
  _onlineBusy = true;
  let r;
  try {
    r = await submitGameOp(_onlineGameId, op, _onlineMe.token);
  } finally {
    _onlineBusy = false;
  }
  if (!r || !r.ok) {
    _onlineToast(humanizeOnlineOpError(r && r.error), 'error');
    // Reopen the wizard so they can pick again - the pick wasn't
    // committed and the snapshot still says faction === null.
    _crewWizardOpen = false;
    if (_onlineSnapshot) applySnapshot(_onlineSnapshot);
    return false;
  }
  applySnapshot(r.data.game.state, r.data.game.seq);
  return true;
}

// Dark or light ink for legible text on a seat-colour fill. Most seat colours
// are light (yellow / cream / mint), one is dark (magenta), so flip on
// perceived luminance.
function readableInk(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return '#2e0f02';
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.58 ? '#1a1206' : '#fff';
}

// The turn bar holds a centred label plus a slot for inline priority-action
// buttons. Lazily split #mp-turn-banner into those two parts and return the
// label span: syncMpTurnBanner writes the "whose turn" text to the label, and
// the auction / crew syncs own the actions slot (setMpTurnAction), so neither
// stomps the other when they run in the same snapshot apply.
function ensureTurnBannerParts(banner) {
  let label = banner.querySelector('.mp-turn-label');
  if (!label) {
    banner.textContent = '';
    label = document.createElement('span');
    label.className = 'mp-turn-label';
    const actions = document.createElement('span');
    actions.className = 'mp-turn-actions';
    banner.append(label, actions);
  }
  return label;
}

// Render (or clear) an inline priority-action button in the turn bar. `key`
// ('auction' | 'crew') lets the two coexist or replace independently; a null
// `spec` removes that key's button. This is the docked home for a collapsed
// activity: it lives inside the turn notification, glows while live, and
// pulses when it owes you an action. Clicking runs spec.onClick (reopen the
// full modal).
function setMpTurnAction(key, spec) {
  const banner = document.getElementById('mp-turn-banner');
  if (!banner) return;
  ensureTurnBannerParts(banner);
  const slot = banner.querySelector('.mp-turn-actions');
  if (!slot) return;
  let btn = slot.querySelector(`button[data-turn-action="${key}"]`);
  if (!spec) { if (btn) btn.remove(); return; }
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.turnAction = key;
    btn.className = 'mp-turn-action';
    slot.appendChild(btn);
  }
  btn.classList.toggle('needs-action', !!spec.needsAction);
  btn.onclick = spec.onClick;
  btn.textContent = '';
  const lab = document.createElement('span');
  lab.className = 'mp-turn-action-label';
  lab.textContent = spec.label;
  btn.appendChild(lab);
  if (spec.meta) {
    btn.appendChild(document.createTextNode(' '));
    const meta = document.createElement('span');
    meta.className = 'mp-turn-action-meta';
    meta.textContent = spec.meta;
    btn.appendChild(meta);
  }
}

// Big bold "YOUR TURN" / "@<name>'s turn" banner anchored above the
// hand strip. Visible only in online mode; hidden otherwise so solo
// play doesn't show a stale label. The "whose turn" text writes to the
// label span; collapsed auction / crew activities dock their own inline
// buttons into the actions slot via setMpTurnAction.
function syncMpTurnBanner(snapshot) {
  const banner = document.getElementById('mp-turn-banner');
  if (!banner) return;
  const label = ensureTurnBannerParts(banner);
  if (!_online || !snapshot || !Array.isArray(snapshot.players)) {
    banner.hidden = true;
    banner.classList.remove('is-your-turn');
    banner.style.removeProperty('--mp-turn-color');
    label.textContent = '';
    setMpTurnAction('auction', null);
    setMpTurnAction('crew', null);
    return;
  }
  const myId = _onlineMe && _onlineMe.id;
  // Game over takes over the banner: no one is "up" any more.
  if (snapshot.status === 'finished') {
    label.textContent = '🏁 Game over';
    banner.classList.remove('is-your-turn');
    banner.style.removeProperty('--mp-turn-color');
    banner.hidden = false;
    return;
  }
  // Round-end first-player handoff: the chooser is "up" to pick, not to
  // play. Reflect that so the big banner agrees with the overlay.
  if (snapshot.pendingFirstPlayer) {
    const chooser = snapshot.players.find((p) => p.profileId === snapshot.pendingFirstPlayer.chooserId);
    const mine = !!(chooser && chooser.profileId === myId);
    if (chooser && chooser.color) banner.style.setProperty('--mp-turn-color', chooser.color);
    else banner.style.removeProperty('--mp-turn-color');
    label.textContent = mine
      ? '⭐ Pick the first player'
      : '@' + (chooser ? chooser.name : '?') + ' is picking first player';
    banner.classList.toggle('is-your-turn', mine);
    banner.hidden = false;
    return;
  }
  const active = snapshot.players[snapshot.activeIndex] || null;
  const myTurn = !!(active && active.profileId === myId);
  // Stripe colour = the active player's server-assigned seat colour
  // (PLAYER_COLORS in server/game/state.js). Same colour the roster dot
  // uses, so the banner becomes a giant glance-version of the dot.
  if (active && active.color) {
    banner.style.setProperty('--mp-turn-color', active.color);
  } else {
    banner.style.removeProperty('--mp-turn-color');
  }
  // Compact turn number (round.slot/maxRounds, slot 1-based) so the
  // banner always shows where in the game we are.
  const tn = formatTurnNumber(snapshot.round, snapshot.turn, snapshot.maxRounds);
  if (!active) {
    label.textContent = `Waiting… · ${tn}`;
    banner.classList.remove('is-your-turn');
  } else if (myTurn) {
    label.textContent = `Your turn · ${tn}`;
    banner.classList.add('is-your-turn');
  } else {
    label.textContent = `@${active.name}'s turn · ${tn}`;
    banner.classList.remove('is-your-turn');
  }
  banner.hidden = false;
}

// A player at the hand limit can't take the lot, so the server
// auto-passes them: they never owe an action and never block the close.
// Hands are open info in the snapshot, so this reads for any seat.
function auctionHandFull(player) {
  return !!player && Array.isArray(player.hand) && player.hand.length >= AUCTION_HAND_LIMIT;
}

// Has every non-auctioneer acted, so the auctioneer may close? Mirrors the
// server's allBiddersActed: a player counts as done if they bid/passed at
// the current floor, permanently auto-passed, or are full-hand. Computed
// from the snapshot rather than trusting auction.awaiting, so a lot whose
// stored phase is stale (e.g. one opened before this logic shipped, where
// every opponent is already full-hand) still lets the auctioneer close.
function auctionAllBiddersActed(auction, players) {
  if (!auction) return false;
  const acted = auction.acted || [];
  const auto = auction.autoPassed || [];
  const others = (players || []).filter((p) => p.profileId !== auction.auctioneerId);
  if (!others.length) return false;
  return others.every((p) =>
    acted.includes(p.profileId) || auto.includes(p.profileId) || auctionHandFull(p));
}

// Whether the lot is currently waiting on ME, from the cached snapshot.
//   shouldAct   - I'm a bidder (not the auctioneer) still on the clock at
//                 the current floor (haven't bid/passed since it last
//                 reopened). A full hand clears this: I'm auto-passed and
//                 can't take the lot, so I owe nothing.
//   shouldClose - I'm the auctioneer and every bidder has acted, so the
//                 lot is waiting on me to close (or reset for another
//                 round).
// Spectators and players not at the table get neither.
function auctionTurnFlags(auction) {
  const me = _onlineMe && _onlineMe.id;
  const players = (_onlineSnapshot && _onlineSnapshot.players) || [];
  const myp = players.find((p) => p.profileId === me);
  if (!me || !auction || !myp) {
    return { shouldAct: false, shouldClose: false };
  }
  if (auction.auctioneerId === me) {
    return { shouldAct: false, shouldClose: auctionAllBiddersActed(auction, players) };
  }
  const acted = auction.acted || [];
  const autoPassed = (auction.autoPassed || []).includes(me);
  return {
    shouldAct: !acted.includes(me) && !autoPassed && !auctionHandFull(myp),
    shouldClose: false,
  };
}

// Toast the player when the turn NEWLY lands on them for this lot (rising
// edge only, so a no-op re-render or an unrelated snapshot doesn't nag).
// Covers both directions the user asked for: an auctioneer raising their
// bid reopens the floor and re-prompts every bidder; the last bidder
// acting flips the lot to the auctioneer to close.
function notifyAuctionTurn(auction) {
  const flags = auctionTurnFlags(auction);
  const prev = _auctionTurnEdge;
  const sameLot = prev && prev.cardId === auction.cardId;
  if (flags.shouldAct && !(sameLot && prev.shouldAct)) {
    _onlineToast('Auction: it is your turn - bid or pass.');
  } else if (flags.shouldClose && !(sameLot && prev.shouldClose)) {
    _onlineToast('Auction: every bidder has acted - close the lot.');
  }
  _auctionTurnEdge = { cardId: auction.cardId, shouldAct: flags.shouldAct, shouldClose: flags.shouldClose };
  return flags;
}

// Competitive multiplayer auction overlay. The sandbox's solo auction
// modal is single-player only and is NOT reused here. Driven straight
// off state.auction in the snapshot: appears when a lot opens, refreshes
// on every update, clears when it resolves. Render is idempotent.
function renderOnlineAuction(auction) {
  const existing = document.getElementById('mp-auction-overlay');
  if (!auction || !_online || !gameViewVisible()) {
    if (existing) existing.remove();
    _auctionKey = null;
    _auctionTurnEdge = null;
    _bidDraft = '';
    _joinDraft = '';
    setMpTurnAction('auction', null);
    return;
  }
  if (_auctionKey !== auction.cardId) {
    _auctionKey = auction.cardId;
    _bidDraft = '';
    _joinDraft = '';
    // Surface each new lot expanded so a fresh card isn't missed while
    // the player has an earlier lot's overlay minimized.
    _auctionMin = false;
  }

  let overlay = existing;
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'mp-auction-overlay';
    overlay.className = 'mp-auction-overlay';
    overlay.innerHTML = `
      <div class="mp-auction-modal" role="dialog" aria-label="Patent auction">
        <div class="mp-auction-head">
          <h3>Patent Auction</h3>
          <span class="mp-auction-mode"></span>
          <button type="button" class="mp-mini-btn" title="Minimize" aria-label="Minimize">&minus;</button>
        </div>
        <div class="mp-auction-body">
          <div class="mp-auction-lot" id="mp-auction-lot"></div>
          <div class="mp-auction-side">
            <div class="mp-auction-status">
              <div class="mp-auction-bid"></div>
              <div class="muted mp-auction-phase"></div>
            </div>
            <div class="mp-auction-controls" id="mp-auction-controls"></div>
            <div class="hud-error" id="mp-auction-error"></div>
          </div>
          <div class="mp-auction-chat">
            <div class="mp-detail-label">Table chat</div>
            <ul id="mp-auction-chat-list" class="mp-chat-list mp-auction-chat-list">
              <li class="muted mp-chat-empty">No messages yet.</li>
            </ul>
          </div>
        </div>
      </div>
      <button type="button" class="mp-mini-chip" aria-label="Restore auction">
        ⚖️ Auction
        <span class="mp-mini-chip-meta"></span>
      </button>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.mp-mini-btn').addEventListener('click', () => {
      _auctionMin = true;
      overlay.classList.add('is-minimized');
      renderOnlineAuction(_onlineSnapshot && _onlineSnapshot.auction);
    });
    overlay.querySelector('.mp-mini-chip').addEventListener('click', () => {
      _auctionMin = false;
      overlay.classList.remove('is-minimized');
      setMpTurnAction('auction', null);
    });
    // Mount the side chat once: backfill from the in-memory log and wire
    // its own send form (live messages fan in via appendMpChat).
    overlay.querySelector('.mp-auction-chat').appendChild(buildChatForm());
    fillChatList(overlay.querySelector('#mp-auction-chat-list'));
  }

  const players = (_onlineSnapshot && _onlineSnapshot.players) || [];
  const auctioneer = players.find((p) => p.profileId === auction.auctioneerId);
  const lot = PATENTS_BY_ID[auction.cardId];

  const modeEl = overlay.querySelector('.mp-auction-mode');
  modeEl.textContent = auctioneer
    ? `@${auctioneer.name}'s lot` : 'Lot';
  if (auctioneer && auctioneer.color) {
    modeEl.classList.add('player-name');
    modeEl.style.setProperty('--player-color', auctioneer.color);
  } else {
    modeEl.classList.remove('player-name');
    modeEl.style.removeProperty('--player-color');
  }

  const lotHost = overlay.querySelector('#mp-auction-lot');
  lotHost.innerHTML = '';
  const lotMain = document.createElement('div');
  lotMain.className = 'mp-auction-lot-main';
  if (lot) {
    try { lotMain.appendChild(renderCard(lot, { type: 'patent' })); }
    catch { lotMain.textContent = lot.name || auction.cardId; }
  } else {
    lotMain.textContent = auction.cardId;
  }
  lotHost.appendChild(lotMain);

  // Support bonus cards that come with the lot: one off the top of each
  // support deck the card requires (the server awards these to the
  // winner when the lot resolves). We PEEK the current deck tops - an
  // open auction freezes every other op, so the tops are exactly what
  // the winner will draw, and peeking (not drawing) means we never
  // reveal what sits BEHIND the bonus cards in the deck.
  const bonusCards = lot
    ? supportBonusDecks(lot).map((t) => cardById(peekTop(t))).filter(Boolean)
    : [];
  // Always render the "Comes with" section while a lot is shown, so the
  // bonus reveal is visible even for a lot that happens to have no
  // support requirements (a note explains the empty case rather than
  // showing nothing, which reads as broken).
  if (lot) {
    const sec = document.createElement('div');
    sec.className = 'mp-auction-bonus';
    const label = document.createElement('div');
    label.className = 'mp-auction-bonus-label';
    label.textContent = bonusCards.length ? `Comes with (${bonusCards.length})` : 'Comes with';
    sec.appendChild(label);
    if (bonusCards.length) {
      const cardsRow = document.createElement('div');
      cardsRow.className = 'mp-auction-bonus-cards';
      for (const b of bonusCards) {
        const w = document.createElement('div');
        w.className = 'mp-auction-bonus-card';
        try { w.appendChild(renderCard(b, { type: 'patent' })); }
        catch { w.textContent = b.name || b.id; }
        cardsRow.appendChild(w);
      }
      sec.appendChild(cardsRow);
    } else {
      const none = document.createElement('div');
      none.className = 'mp-auction-bonus-none muted';
      none.textContent = 'No bonus cards - this lot has no support requirements.';
      sec.appendChild(none);
    }
    lotHost.appendChild(sec);
  }

  // Every player's standing bid is public now (incl. the auctioneer's),
  // so render the full table - amount, the top marker, who passed, and
  // who still has to act - each tinted with its seat colour.
  const bidEl = overlay.querySelector('.mp-auction-bid');
  bidEl.classList.remove('player-name');
  bidEl.style.removeProperty('--player-color');
  bidEl.innerHTML = '';
  const bids = auction.bids || {};
  const high = auction.highBid | 0;
  const acted = auction.acted || [];
  const list = document.createElement('div');
  list.className = 'mp-auction-bidlist';
  for (const p of players) {
    const line = document.createElement('div');
    line.className = 'mp-auction-bidline';
    const nm = document.createElement('span');
    nm.className = 'player-name mp-auction-bidwho';
    if (p.color) nm.style.setProperty('--player-color', p.color);
    nm.textContent = '@' + p.name + (p.profileId === auction.auctioneerId ? ' (auctioneer)' : '');
    const amt = document.createElement('span');
    amt.className = 'mp-auction-bidamt';
    const b = bids[p.profileId];
    const didPass = Array.isArray(auction.passed) && auction.passed.includes(p.profileId);
    const autoPassed = Array.isArray(auction.autoPassed) && auction.autoPassed.includes(p.profileId);
    // Top marker: this player placed the high bid. 0 is a valid bid, so
    // the test is "has a bid equal to the high", not "high > 0".
    const isTop = (p.profileId in bids) && b === high;
    const isAuctioneer = p.profileId === auction.auctioneerId;
    const handFull = !isAuctioneer && auctionHandFull(p);
    // Status suffix on a standing bid, or the standalone status when the
    // player has no bid. Auto-pass (out for the lot) reads over a plain
    // floor pass.
    const tag = autoPassed ? 'auto-passed' : (didPass ? 'passed' : (handFull ? 'auto-passed (hand full)' : ''));
    if (b != null) {
      amt.textContent = `${b} aqua${isTop ? ' ◄ top' : ''}${tag ? ' · ' + tag : ''}`;
    } else {
      amt.textContent = tag || '-';
    }
    if (isTop) line.classList.add('is-top');
    // A non-auctioneer who has not acted at the current floor is still on
    // the clock - unless they've auto-passed or their hand is full, in
    // which case they're out and never hold up the close.
    if (!isAuctioneer && !acted.includes(p.profileId) && !autoPassed && !handFull) {
      line.classList.add('is-waiting');
    }
    line.append(nm, amt);
    list.appendChild(line);
  }
  bidEl.appendChild(list);
  overlay.querySelector('.mp-auction-phase').textContent =
    auctionAllBiddersActed(auction, players)
      ? 'All bidders have acted - the auctioneer can close.'
      : 'Bidding is open - anyone can bid or raise (ties allowed).';

  buildMpAuctionControls(
    overlay.querySelector('#mp-auction-controls'),
    auction, { auctioneer },
  );

  // Notify on the rising edge when the lot lands on me (also returns the
  // current flags so the chip can echo the call to action when minimized).
  const turn = notifyAuctionTurn(auction);
  const actionNeeded = turn.shouldAct || turn.shouldClose;

  // Minimized chip: surface the call to action when the lot is waiting on
  // me (so a docked overlay still tells me to act), otherwise show the
  // live high-bid summary. Re-apply the persisted minimize state.
  const chip = overlay.querySelector('.mp-mini-chip');
  const chipMeta = overlay.querySelector('.mp-mini-chip-meta');
  const metaText = turn.shouldAct
    ? 'your turn - bid or pass'
    : turn.shouldClose
      ? 'ready to close'
      : (auction.highBid > 0 ? `high bid ${auction.highBid}` : 'no bids');
  if (chipMeta) chipMeta.textContent = metaText;
  if (chip) chip.classList.toggle('needs-action', actionNeeded);
  overlay.classList.toggle('is-minimized', _auctionMin);
  // Docked representation: an inline button in the turn bar (the floating
  // chip is hidden via CSS). Present only while collapsed; the full modal
  // shows otherwise.
  setMpTurnAction('auction', _auctionMin ? {
    label: '⚖️ Auction',
    meta: metaText,
    needsAction: actionNeeded,
    onClick: () => { _auctionMin = false; renderOnlineAuction(auction); },
  } : null);
}

function setMpAuctionError(text) {
  const el = document.getElementById('mp-auction-error');
  if (el) el.textContent = text || '';
}

// ----- first-player handoff overlay (round-end) -----
//
// When a round (Sunspot cycle) closes the server sets
// snapshot.pendingFirstPlayer = { chooserId } and freezes the table.
// The player who led the round names the next first player here;
// everyone else sees a waiting note. Idempotent + driven straight off
// the snapshot, mirroring the auction overlay: appears when the handoff
// opens, clears when the pick lands. SET_FIRST_PLAYER bypasses the turn
// guard server-side, so this submit (like the auction submit) does not
// gate on isOnlineMyTurn.
function setFirstPlayerError(text) {
  const el = document.getElementById('mp-first-player-error');
  if (el) el.textContent = text || '';
}

async function submitSetFirstPlayer(profileId) {
  if (!_online || _onlineBusy) return false;
  if (_spectator) { _onlineToast('Spectator - view only.', 'error'); return false; }
  _onlineBusy = true;
  setFirstPlayerError('');
  let r;
  try {
    r = await submitGameOp(_onlineGameId, { kind: 'SET_FIRST_PLAYER', profileId }, _onlineMe.token);
  } finally {
    _onlineBusy = false;
  }
  if (!r || !r.ok) {
    setFirstPlayerError(humanizeOnlineOpError(r && r.error));
    if (_onlineSnapshot) applySnapshot(_onlineSnapshot);
    return false;
  }
  applySnapshot(r.data.game.state, r.data.game.seq);
  return true;
}

function renderFirstPlayerChooser(pending) {
  const existing = document.getElementById('mp-first-player-overlay');
  if (!pending || !_online || !gameViewVisible()) {
    if (existing) existing.remove();
    return;
  }
  const players = (_onlineSnapshot && _onlineSnapshot.players) || [];
  const chooser = players.find((p) => p.profileId === pending.chooserId);
  const myId = _onlineMe && _onlineMe.id;
  const amChooser = !!myId && pending.chooserId === myId;

  let overlay = existing;
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'mp-first-player-overlay';
    overlay.className = 'mp-first-player-overlay';
    overlay.innerHTML = `
      <div class="mp-first-player-modal" role="dialog" aria-label="First player">
        <h3 class="mp-first-player-title">⭐ First player</h3>
        <p class="mp-first-player-sub"></p>
        <div class="mp-first-player-choices" id="mp-first-player-choices"></div>
        <div class="hud-error" id="mp-first-player-error"></div>
      </div>`;
    document.body.appendChild(overlay);
  }

  const sub = overlay.querySelector('.mp-first-player-sub');
  const choices = overlay.querySelector('#mp-first-player-choices');
  choices.innerHTML = '';

  if (amChooser) {
    sub.textContent = 'A new round begins. Name the next first player.';
    for (const p of players) {
      if (p.profileId === myId) continue;          // "another player" only
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mp-first-player-pick player-name';
      if (p.color) btn.style.setProperty('--player-color', p.color);
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = p.color || '#888';
      const label = document.createElement('span');
      label.textContent = '@' + p.name;
      btn.append(dot, label);
      btn.disabled = _onlineBusy;
      btn.addEventListener('click', () => submitSetFirstPlayer(p.profileId));
      choices.appendChild(btn);
    }
  } else {
    sub.textContent = 'Waiting for ';
    const nm = document.createElement('span');
    nm.className = 'player-name';
    if (chooser && chooser.color) nm.style.setProperty('--player-color', chooser.color);
    nm.textContent = '@' + (chooser ? chooser.name : '?');
    sub.append(nm, document.createTextNode(' to name the next first player.'));
  }
}

// ----- end-of-game standings -----
//
// The server marks the state finished once the round cap is reached.
// Show a final standings overlay ranked by current VPs. Provisional:
// full end-game scoring (Exploitation Track etc.) is a later stage; this
// tallies what the engine tracks today (career glory + map tokens),
// reusing the solo scoring module's spectral / colony rates so the
// numbers line up.
let _gameOverDismissed = false;

function computeSnapshotScore(snapshot, profileId) {
  const player = (snapshot.players || []).find((p) => p.profileId === profileId);
  const glory = (player && player.glory && player.glory.vps) || 0;
  let claims = 0;
  const discs = snapshot.discs || {};
  for (const id in discs) {
    const d = discs[id];
    if (d && d.outcome === 'success' && d.ownerId === profileId) claims += 1;
  }
  const facs = Object.values(snapshot.factories || {}).filter((f) => f.ownerId === profileId);
  const cols = Object.values(snapshot.colonies || {}).filter((c) => c.ownerId === profileId);
  const rocket = player && player.rocket && (player.rocket.stack || []).length > 0 ? 1 : 0;
  const outposts = player && player.outposts ? Object.keys(player.outposts).length : 0;
  const byType = {};
  for (const f of facs) { const t = f.spectralType || 'C'; byType[t] = (byType[t] || 0) + 1; }
  let spectralBonus = 0;
  for (const t in byType) spectralBonus += spectralVpForCount(byType[t]);
  let colonyVp = 0;
  for (const c of cols) colonyVp += (COLONY_VP[c.type] || COLONY_VP.other);
  const tokens = rocket + claims + facs.length + outposts;
  return {
    glory, claims, factories: facs.length, colonies: cols.length,
    rocket, outposts, spectralBonus, colonyVp, tokens,
    total: tokens + spectralBonus + colonyVp + glory,
  };
}

function renderGameOver(snapshot) {
  const existing = document.getElementById('mp-game-over-overlay');
  const finished = !!(snapshot && snapshot.status === 'finished') && _online && gameViewVisible();
  if (!finished || _gameOverDismissed) {
    if (existing) existing.remove();
    return;
  }
  const myId = _onlineMe && _onlineMe.id;
  const scored = (snapshot.players || [])
    .map((p) => ({ p, s: computeSnapshotScore(snapshot, p.profileId) }))
    .sort((a, b) => b.s.total - a.s.total);

  let overlay = existing;
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'mp-game-over-overlay';
    overlay.className = 'mp-game-over-overlay';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div class="mp-game-over-modal" role="dialog" aria-label="Final standings">
      <button type="button" class="modal-x" aria-label="Close" title="Close">&times;</button>
      <h2 class="mp-game-over-title">🏁 Game over</h2>
      <p class="muted mp-game-over-sub">Final standings after ${snapshot.maxRounds || ''} rounds, ranked by victory points.</p>
      <ol class="mp-game-over-list"></ol>
      <p class="muted mp-game-over-note">Provisional tally - full end-game scoring lands in a later update.</p>
    </div>`;
  const list = overlay.querySelector('.mp-game-over-list');
  scored.forEach(({ p, s }, i) => {
    const li = document.createElement('li');
    li.className = 'mp-go-row' + (i === 0 ? ' is-winner' : '');
    const rank = document.createElement('span');
    rank.className = 'mp-go-rank';
    rank.textContent = i === 0 ? '🏆' : `${i + 1}.`;
    const name = document.createElement('span');
    name.className = 'mp-go-name player-name';
    if (p.color) name.style.setProperty('--player-color', p.color);
    name.textContent = '@' + p.name + (p.profileId === myId ? ' (you)' : '');
    const total = document.createElement('span');
    total.className = 'mp-go-total';
    total.textContent = `${s.total} VP`;
    const brk = document.createElement('span');
    brk.className = 'mp-go-break muted';
    brk.textContent = `glory ${s.glory} · factories ${s.factories} · colonies ${s.colonies} · claims ${s.claims}`;
    li.append(rank, name, total, brk);
    list.appendChild(li);
  });
  overlay.querySelector('.modal-x').addEventListener('click', () => {
    _gameOverDismissed = true;
    overlay.remove();
  });
}

// Clamp a typed amount up to at least `min`; used so the input re-seeds
// to a valid value after an opponent's bid raises the floor.
function clampAuctionInt(draft, min) {
  const v = parseInt(draft, 10);
  return (Number.isInteger(v) && v >= min) ? v : min;
}

// Small muted note line used throughout the auction controls. (This
// helper was referenced before it existed - the auction overlay
// threw "noteEl is not defined" on every snapshot. Defining it here.)
function noteEl(text) {
  const p = document.createElement('p');
  p.className = 'muted mp-auction-note';
  p.textContent = text;
  return p;
}

// Prominent call-to-action banner (accent, not muted) for the player the
// lot is currently waiting on. Distinct from noteEl so "it's your turn"
// can't be mistaken for the passive status notes around it.
function promptEl(text) {
  const p = document.createElement('p');
  p.className = 'mp-auction-prompt';
  p.textContent = text;
  return p;
}

// Role + phase aware controls inside the auction modal. Mirrors the
// engine's state machine (server/game/engine.js auction handlers).
function buildMpAuctionControls(host, a, { auctioneer } = {}) {
  host.innerHTML = '';
  if (!_onlineMe || !_onlineSnapshot) {
    host.appendChild(noteEl('Spectating this auction.'));
    return;
  }
  const myId = _onlineMe.id;
  const players = _onlineSnapshot.players || [];
  const myp = players.find((p) => p.profileId === myId);
  if (!myp) { host.appendChild(noteEl('Spectating this auction.')); return; }
  const iAmAuctioneer = a.auctioneerId === myId;
  const myHandFull = auctionHandFull(myp);
  const iAutoPassed = Array.isArray(a.autoPassed) && a.autoPassed.includes(myId);
  // Call-to-action banner at the top of the controls when the lot is
  // waiting on me, so a glance says whether I owe an action. A bidder is
  // "on the clock" until they bid or pass at the current floor; the
  // auctioneer is prompted once every bidder has acted. Auto-passed and
  // full-hand bidders owe nothing.
  const iShouldAct = !iAmAuctioneer && !myHandFull && !iAutoPassed && !(a.acted || []).includes(myId);
  const iShouldClose = iAmAuctioneer && auctionAllBiddersActed(a, players);
  if (iShouldAct) {
    host.appendChild(promptEl('Your turn - bid or pass below to continue the auction.'));
  } else if (iShouldClose) {
    host.appendChild(promptEl('Every bidder has acted - close the lot below.'));
  } else if (iAutoPassed) {
    host.appendChild(promptEl("You auto-passed - you're out for the rest of this lot."));
  } else if (myHandFull && !iAmAuctioneer) {
    host.appendChild(promptEl('Your hand is full - you are auto-passed for this lot.'));
  }
  const myAqua = myp.aqua | 0;
  const myHandCount = Array.isArray(myp.hand) ? myp.hand.length : 0;
  const bids = a.bids || {};
  const high = a.highBid | 0;
  const myBid = bids[myId] | 0;
  // Distinguish "haven't bid yet" from a real standing bid of 0, so an
  // opening 0-bid still goes through while re-affirming an existing bid
  // is treated as no change.
  const hasBid = (myId in bids);
  const passed = Array.isArray(a.passed) && a.passed.includes(myId);

  // --- Your bid (ANY player, the auctioneer included) ---
  // Ties are allowed, so the floor is the high bid itself (>=), not +1.
  // Bids can be 0 (claim it free), so the floor is never below 0. The
  // auctioneer is the exception: they win ties, so their floor is the top
  // RIVAL bid, letting them walk an overbid back down to it and still take
  // the lot. (iAmAuctioneer is already computed above.)
  const rivalHigh = Object.entries(bids).reduce(
    (hi, [pid, amt]) => (Number(pid) !== myId ? Math.max(hi, amt | 0) : hi), 0);
  const minBid = iAmAuctioneer ? rivalHigh : Math.max(0, high);
  if (iAutoPassed) {
    // Out for the lot - the banner above says so; offer no bid/pass
    // controls (a fresh lot resets this).
  } else if (myHandCount >= AUCTION_HAND_LIMIT) {
    host.appendChild(noteEl(`Hand full (${myHandCount}/${AUCTION_HAND_LIMIT}) - you're auto-passed and can't take this lot. Build or transfer cards first.`));
  } else {
    const row = document.createElement('div');
    row.className = 'mp-auction-bidrow';
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'mp-auction-input';
    input.min = String(minBid);
    input.value = String(clampAuctionInt(_bidDraft, minBid));
    const bidBtn = document.createElement('button');
    bidBtn.type = 'button';
    bidBtn.className = 'modal-btn primary';
    bidBtn.textContent = 'Bid';
    const sync = () => {
      const v = parseInt(input.value, 10);
      const okAmt = Number.isInteger(v) && v >= minBid && v <= myAqua;
      // Same as your standing bid: there's nothing to send. Re-placing the
      // identical amount would only reopen the floor and make everyone bid
      // again (an auctioneer's bid always reopens it), so block it here.
      const unchanged = hasBid && Number.isInteger(v) && v === myBid;
      const lowering = iAmAuctioneer && hasBid && Number.isInteger(v) && v < myBid;
      const tie = !lowering && Number.isInteger(v) && v === high && high > 0;
      bidBtn.textContent = !Number.isInteger(v) ? 'Bid'
        : unchanged ? `Your bid: ${v}`
        : lowering ? `Lower to ${v}`
        : tie ? `Tie at ${v}`
        : myBid ? `Change to ${v}`
        : `Bid ${v}`;
      bidBtn.disabled = !okAmt || unchanged || _onlineBusy;
    };
    input.addEventListener('input', () => { _bidDraft = input.value; sync(); });
    bidBtn.addEventListener('click', () => {
      const amt = parseInt(input.value, 10);
      if (!Number.isInteger(amt)) { setMpAuctionError('Enter a whole number.'); return; }
      // No change from your standing bid: do nothing, so an accidental
      // re-click can't reset the lot. To clear the others' bids on
      // purpose, use the Reset others' bids button below.
      if (hasBid && amt === myBid) return;
      submitMpAuctionOp({ kind: 'AUCTION_BID', amount: amt });
    });
    row.append(input, bidBtn);
    host.appendChild(row);
    const canLower = iAmAuctioneer && hasBid && myBid > minBid;
    const floor = canLower
      ? ` You can lower your bid to ${minBid} (the top rival bid) and still take the lot.`
      : high > 0
        ? ` Bids must be ${minBid}+ (ties allowed).`
        : ' Open the bidding at 0+ (bid 0 to claim it free).';
    const mine = (myId in bids) ? ` Your bid: ${bids[myId]}.` : '';
    host.appendChild(noteEl(`You have ${myAqua} aqua.${floor}${mine}`));
    sync();
  }

  // --- Pass options (non-auctioneer only). A full-hand or already
  // auto-passed player is out, so the buttons are omitted. ---
  //   Pass       - won't raise at the current floor; re-prompted if the
  //                auctioneer raises (reopens the floor).
  //   Auto-pass  - won't raise for the rest of the lot; never re-prompted
  //                (a permanent pass). A later bid opts back in.
  if (!iAmAuctioneer && !myHandFull && !iAutoPassed) {
    const passBtn = document.createElement('button');
    passBtn.type = 'button';
    passBtn.className = 'modal-btn';
    passBtn.textContent = passed ? "Passed (you won't raise)" : 'Pass';
    passBtn.disabled = passed || _onlineBusy;
    passBtn.addEventListener('click', () => submitMpAuctionOp({ kind: 'AUCTION_PASS' }));
    host.appendChild(passBtn);

    const autoBtn = document.createElement('button');
    autoBtn.type = 'button';
    autoBtn.className = 'modal-btn';
    autoBtn.textContent = 'Auto-pass (stay out)';
    autoBtn.title = "Pass for the rest of this lot - you won't be asked again when the bid is raised.";
    autoBtn.disabled = _onlineBusy;
    autoBtn.addEventListener('click', () => submitMpAuctionOp({ kind: 'AUCTION_PASS', permanent: true }));
    host.appendChild(autoBtn);
  }

  // --- Close the lot (auctioneer only). Name a top bidder to sell to;
  // the auctioneer may pick themselves on a tie (they win ties), which
  // keeps the lot and pays the bank. ---
  if (iAmAuctioneer) {
    const closeWrap = document.createElement('div');
    closeWrap.className = 'mp-auction-close';
    // The lot can only close once every other player has bid or passed.
    // Until then the close buttons are disabled (the server enforces the
    // same rule); the auctioneer can still Reset to start a fresh round.
    const canClose = auctionAllBiddersActed(a, players);
    const lbl = document.createElement('div');
    lbl.className = 'mp-auction-close-label';
    lbl.textContent = canClose
      ? 'Close the lot:'
      : 'Waiting on bidders - everyone must bid or pass before you can close:';
    closeWrap.appendChild(lbl);
    // "No bids" = nobody placed one (0 is a real bid now, not "no bid").
    const anyBids = Object.keys(bids).length > 0;
    if (!anyBids) {
      const keepBtn = document.createElement('button');
      keepBtn.type = 'button';
      keepBtn.className = 'modal-btn primary';
      keepBtn.textContent = 'Keep (no bids)';
      keepBtn.disabled = _onlineBusy || !canClose;
      keepBtn.addEventListener('click', () => submitMpAuctionOp({ kind: 'AUCTION_SELL', buyerId: myId }));
      closeWrap.appendChild(keepBtn);
    } else {
      const topIds = players.filter((p) => (p.profileId in bids) && bids[p.profileId] === high).map((p) => p.profileId);
      for (const tid of topIds) {
        const tp = players.find((p) => p.profileId === tid);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'modal-btn primary';
        if (tid === myId) {
          btn.textContent = `Keep it yourself (${high})`;
          btn.title = `You're tied at the top - keep the lot and pay ${high} to the bank.`;
        } else {
          btn.textContent = `Sell to @${tp ? tp.name : '?'} (${high})`;
        }
        btn.disabled = _onlineBusy || !canClose;
        btn.addEventListener('click', () => submitMpAuctionOp({ kind: 'AUCTION_SELL', buyerId: tid }));
        closeWrap.appendChild(btn);
      }
    }
    if (!canClose) {
      closeWrap.appendChild(noteEl('Bidders still on the clock - close unlocks once they have all acted.'));
    }
    // Reset: clear the OTHER players' bids so they must re-bid (higher)
    // or pass. Shown when someone else has a standing bid to clear.
    const othersBid = players.some((p) => p.profileId !== myId && bids[p.profileId] != null);
    if (othersBid) {
      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'modal-btn';
      resetBtn.textContent = '↺ Reset others’ bids';
      resetBtn.title = "Clear the other players' bids and prompt them to bid again (higher) or pass. If they all pass, you win the lot.";
      resetBtn.disabled = _onlineBusy;
      resetBtn.addEventListener('click', () => submitMpAuctionOp({ kind: 'AUCTION_RESET' }));
      closeWrap.appendChild(resetBtn);
    }
    host.appendChild(closeWrap);
    // Nudge for a response (auctioneer): ping the bidders still on the
    // clock, or everyone else at the table, to keep the lot moving. The
    // waiting set is the bidders who have not bid or passed yet; nudge-all
    // covers every other seat. Per-player cooldown is enforced server-side.
    const allOthers = players.map((p) => p.profileId).filter((pid) => pid !== myId);
    if (allOthers.length) {
      const waiting = actorsNeededClient(_onlineSnapshot).filter((pid) => pid !== myId);
      const nudgeWrap = document.createElement('div');
      nudgeWrap.className = 'mp-auction-close';
      const nlbl = document.createElement('div');
      nlbl.className = 'mp-auction-close-label';
      nlbl.textContent = 'Nudge for a response:';
      nudgeWrap.appendChild(nlbl);
      nudgeWrap.appendChild(makeAuctionNudgeButton(
        _onlineSnapshot, '👋 Nudge waiting', { waiting: true }, waiting,
        'Remind the bidders who have not bid or passed yet.'));
      nudgeWrap.appendChild(makeAuctionNudgeButton(
        _onlineSnapshot, '👋 Nudge all', { all: true }, allOthers,
        'Remind every other player at the table.'));
      host.appendChild(nudgeWrap);
    }
  }
}

// Auction op submitter. Bypasses submitOnlineOp's turn-check: BID/PASS
// come from NON-active players, and the server has its own caller
// validation against the auction roles. Re-hydrates on success; on
// failure surfaces the error in the auction overlay and snaps back to
// the last-known snapshot so the UI matches authority.
async function submitMpAuctionOp(op) {
  if (!_online || _onlineBusy) return false;
  if (_spectator) { _onlineToast('Spectator - view only.', 'error'); return false; }
  _onlineBusy = true;
  setMpAuctionError('');
  let r;
  try {
    r = await submitGameOp(_onlineGameId, op, _onlineMe.token);
  } finally {
    _onlineBusy = false;
  }
  if (!r || !r.ok) {
    setMpAuctionError(humanizeOnlineOpError(r && r.error));
    if (_onlineSnapshot) applySnapshot(_onlineSnapshot);
    return false;
  }
  applySnapshot(r.data.game.state, r.data.game.seq);
  return true;
}

// Helper used by the Multiplayer pane: an inline element listing the
// patent decks with their counts; tapping one fires AUCTION_START. The
// _deckPickerOpen flag (cleared on auction commit / leave) keeps the
// picker open across the snapshot re-renders during selection.
function buildMpDeckPicker(host, snapshot) {
  host.innerHTML = '';
  const label = document.createElement('div');
  label.className = 'mp-detail-label';
  label.textContent = 'Auction the top of which deck? (costs 1 op)';
  host.appendChild(label);
  const row = document.createElement('div');
  row.className = 'mp-deck-row';
  for (const [type, name] of MP_AUCTION_DECKS) {
    const deck = (snapshot.decks && snapshot.decks[type]) || [];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'modal-btn';
    b.textContent = `${name} (${deck.length})`;
    b.disabled = !deck.length || _onlineBusy;
    b.addEventListener('click', () => {
      _deckPickerOpen = false;
      submitOnlineOp({ kind: 'AUCTION_START', deckType: type });
    });
    row.appendChild(b);
  }
  host.appendChild(row);
}

// ----- multiplayer table panel (online sidepanel pane) -----

// Show the multiplayer tab + hide the solo "game mode / new game" tab
// while online; reverse for solo. Mirrors syncCartTabVisibility.
function syncMpTabVisibility() {
  const mpTab = document.getElementById('sidepanel-tab-mp');
  const soloTab = document.querySelector('#sidepanel-tabs button[data-pane="solo"]');
  const panel = document.getElementById('browse-sidepanel');
  if (mpTab) mpTab.hidden = !_online;
  if (soloTab) soloTab.hidden = !!_online;
  if (!panel) return;
  if (_online && panel.dataset.active === 'solo') showPane('mp');
  if (!_online && panel.dataset.active === 'mp') showPane(null);
}

// Server site id (data/sites.js slug) -> display name. LEO / unknown
// fall back gracefully.
function onlineSiteLabel(serverSiteId) {
  if (!serverSiteId) return 'LEO';
  const s = SITES_BY_ID[serverSiteId];
  return (s && s.name) || serverSiteId;
}

function mpCardName(id) {
  const c = PATENTS_BY_ID[id];
  return c ? c.name : id;
}

// Render the multiplayer table panel from the latest snapshot: room,
// whose turn, the clock, and a roster where each player expands to show
// their rocket / outposts / resources. Opponent hands stay hidden
// (count only). Re-rendered on every snapshot (applySnapshot).
// One-time skeleton inside #mp-panel: a #mp-table region (room / turn /
// roster) which renderMpPanel rewrites on every snapshot, and a
// persistent #mp-chat (history + input) so the chat survives the
// per-snapshot re-render. Returns the table region.
function ensureMpPanelStructure() {
  const host = document.getElementById('mp-panel');
  if (!host) return null;
  let tableEl = host.querySelector('#mp-table');
  if (!tableEl) {
    host.innerHTML = '';
    tableEl = document.createElement('div');
    tableEl.id = 'mp-table';
    const chatEl = document.createElement('div');
    chatEl.id = 'mp-chat';
    host.append(tableEl, chatEl);
    setupMpChat(chatEl);
  }
  return tableEl;
}

// In-pane chat shell built once: label + message list + send form. The
// form posts to the lobby chat REST endpoint; the WS 'chat' broadcast
// (subscribed in bootstrapOnlineGame) re-renders for everyone including
// the sender, so we don't append locally on submit.
// Build the send form shared by every chat surface. Posts to the lobby
// chat REST endpoint; the WS 'chat' broadcast re-renders for everyone
// (sender included), so we never append locally on submit.
function buildChatForm() {
  const form = document.createElement('form');
  form.className = 'mp-chat-form';
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 500;
  input.placeholder = 'Message the table…';
  input.autocomplete = 'off';
  const send = document.createElement('button');
  send.type = 'submit';
  send.textContent = 'Send';
  form.append(input, send);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const body = input.value.trim();
    if (!body || !_online || !_onlineLobbyId || !_onlineMe) return;
    input.value = '';
    send.disabled = true;
    const r = await sendChat(_onlineLobbyId, body, _onlineMe.token);
    send.disabled = false;
    if (!r || !r.ok) {
      if (_onlineToast) _onlineToast('Chat failed: ' + ((r && r.error) || 'network'), 'error');
      input.value = body;
    }
  });
  return form;
}

function setupMpChat(host) {
  host.innerHTML = '';
  const label = document.createElement('div');
  label.className = 'mp-detail-label';
  label.textContent = 'Table chat';
  const list = document.createElement('ul');
  list.id = 'mp-chat-list';
  list.className = 'mp-chat-list';
  const empty = document.createElement('li');
  empty.className = 'muted mp-chat-empty';
  empty.textContent = 'No messages yet.';
  list.appendChild(empty);
  host.append(label, list, buildChatForm());
  // Backfill from the in-memory log so the pane shows prior messages
  // even when it mounts after the conversation already started.
  fillChatList(list);
}

// Build one chat <li> for a message, tinting the speaker's @name with
// their seat colour (resolved from the cached snapshot). Shared by every
// chat surface so they render identically.
function chatMsgEl(msg) {
  const li = document.createElement('li');
  li.className = 'mp-chat-msg';
  const who = document.createElement('span');
  who.className = 'mp-chat-who player-name';
  const speaker = (_onlineSnapshot && _onlineSnapshot.players || [])
    .find((p) => p.profileId === msg.profileId);
  if (speaker && speaker.color) who.style.setProperty('--player-color', speaker.color);
  who.textContent = '@' + (msg.profileName || 'someone');
  const body = document.createElement('span');
  body.className = 'mp-chat-body';
  body.textContent = msg.body || '';
  li.append(who, document.createTextNode(' '), body);
  return li;
}

// Append a message to a given chat list element (drops the empty-state
// placeholder, then sticks the scroll to the bottom). No-op if the list
// isn't mounted.
function appendChatToList(list, msg) {
  if (!list || !msg) return;
  const empty = list.querySelector('.mp-chat-empty');
  if (empty) empty.remove();
  list.appendChild(chatMsgEl(msg));
  list.scrollTop = list.scrollHeight;
}

// Reset a chat list back to its empty state. Used when switching rooms so a
// previous table's messages don't linger in the DOM (the _chatLog cache is
// cleared alongside it).
function resetChatList(list) {
  if (!list) return;
  list.innerHTML = '';
  const empty = document.createElement('li');
  empty.className = 'muted mp-chat-empty';
  empty.textContent = 'No messages yet.';
  list.appendChild(empty);
}

// Backfill a freshly-mounted chat list from the in-memory log (used by
// the auction overlay's side chat so it isn't blank when it opens after
// the conversation has already started).
function fillChatList(list) {
  if (!list) return;
  for (const m of _chatLog) appendChatToList(list, m);
}

function appendMpChat(msg, opts = {}) {
  if (!msg) return;
  _chatLog.push(msg);
  if (_chatLog.length > CHAT_LOG_CAP) _chatLog.splice(0, _chatLog.length - CHAT_LOG_CAP);
  // Fan the message out to every chat surface that's currently mounted:
  // the Multiplayer pane and (when a lot is open) the auction overlay.
  appendChatToList(document.getElementById('mp-chat-list'), msg);
  appendChatToList(document.getElementById('mp-auction-chat-list'), msg);
  // Live message from someone else while the MP pane isn't open -> pulse
  // the 🛰 tab so the player notices. (History backfill passes no `live`
  // flag; my own messages don't self-notify.)
  const myId = _onlineMe && _onlineMe.id;
  if (opts.live && msg.profileId !== myId) flagMpChatUnread();
}

// Pulsing-star "new chat" badge on the 🛰 (satellite) tab. Skipped when
// the MP pane is already open (the player is reading it).
function flagMpChatUnread() {
  const panel = document.getElementById('browse-sidepanel');
  if (panel && panel.dataset.active === 'mp') return;
  const tab = document.getElementById('sidepanel-tab-mp');
  if (tab) tab.classList.add('has-unread');
}
function clearMpChatUnread() {
  const tab = document.getElementById('sidepanel-tab-mp');
  if (tab) tab.classList.remove('has-unread');
}

// Manual turn-nudge cooldown (client mirror of the server's 3h gate).
// _localNudges optimistically records nudges this client learned about
// (from the POST response) so a button greys out + shows the timer right
// away, before the next snapshot carries state.reminders. One 3h window
// for everything, auctions included (no separate auction throttle).
const NUDGE_COOLDOWN_MS = 3 * 60 * 60 * 1000;
// Short "2m" / "45s" label for how long until a cooled-down nudge frees up.
function fmtNudgeWait(ms) {
  if (ms <= 0) return '';
  return ms < 60000 ? `${Math.ceil(ms / 1000)}s` : `${Math.ceil(ms / 60000)}m`;
}
let _localNudges = {}; // `${gameId}:${targetId}` -> sentAt
function recordLocalNudge(targetId, sentAt) {
  if (sentAt) _localNudges[`${_onlineGameId}:${targetId}`] = sentAt;
}

// Everyone the game is waiting on (mirrors the server's actorsNeeded):
// nobody during the crew draft; the first-player chooser; during an
// auction the auctioneer (all bidders acted) or every bidder still on
// the clock; otherwise the active seat. Returns an array of profileIds.
function actorsNeededClient(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.players)) return [];
  const draftDone = snapshot.draftPhase === 'play'
    || (snapshot.draftPhase == null && snapshot.players.every((p) => !!p.faction));
  if (!draftDone) return [];
  if (snapshot.pendingFirstPlayer) {
    return snapshot.pendingFirstPlayer.chooserId != null ? [snapshot.pendingFirstPlayer.chooserId] : [];
  }
  const a = snapshot.auction;
  if (a) {
    if (auctionAllBiddersActed(a, snapshot.players)) return [a.auctioneerId];
    const acted = a.acted || [];
    const auto = a.autoPassed || [];
    return snapshot.players
      .filter((p) => p.profileId !== a.auctioneerId
        && !acted.includes(p.profileId) && !auto.includes(p.profileId) && !auctionHandFull(p))
      .map((p) => p.profileId);
  }
  const active = snapshot.players[snapshot.activeIndex];
  return active ? [active.profileId] : [];
}

// Who I can manually nudge - mirrors the server's nudgeTargets. Same as
// actorsNeededClient normally, but during an auction EVERY other player
// is nudgable (user: "all players are nudgable during auctions"), since
// the on-the-clock set churns as bids land and you may want to ping the
// auctioneer or an already-acted bidder to keep things moving.
function nudgeTargetsClient(snapshot) {
  if (snapshot && snapshot.auction && Array.isArray(snapshot.players)) {
    return snapshot.players.map((p) => p.profileId);
  }
  return actorsNeededClient(snapshot);
}

// Effective last-nudge timestamp for a target: the later of the
// snapshot's reminder record and this client's optimistic local record.
function lastNudgeAt(snapshot, targetId) {
  let t = 0;
  const rem = snapshot && snapshot.reminders && snapshot.reminders[targetId];
  if (rem && rem.sentAt) t = rem.sentAt;
  const loc = _localNudges[`${_onlineGameId}:${targetId}`];
  if (loc && loc > t) t = loc;
  return t;
}

// Fire a nudge (one player via { targetId }, or everyone on the clock
// via { all:true }), then refresh the panel. Always names who got
// nudged so a mis-target is obvious.
async function doNudge(opts, btn) {
  if (!_onlineMe) return;
  if (btn) btn.disabled = true;
  const r = await remindTurn(_onlineGameId, _onlineMe.token, opts);
  if (r && r.ok) {
    const nudged = r.nudged || [];
    const skipped = r.skipped || [];
    for (const n of [...nudged, ...skipped]) recordLocalNudge(n.targetId, n.sentAt);
    if (nudged.length) {
      _onlineToast(`👋 Nudged ${nudged.map((n) => '@' + (n.targetName || '?')).join(', ')}.`);
    } else if (skipped.length) {
      _onlineToast(`Already nudged recently: ${skipped.map((s) => '@' + (s.targetName || '?')).join(', ')}.`, 'error');
    } else {
      _onlineToast('No one to nudge right now.', 'error');
    }
  } else {
    const err = (r && r.error) || 'unknown error';
    const msg = err === 'nobody_to_nudge' ? 'No one needs nudging right now.'
      : err === 'not_actionable' ? "That player isn't on the clock."
      : 'Nudge failed: ' + err + '.';
    _onlineToast(msg, 'error');
  }
  renderMpPanel(_onlineSnapshot);
  // If a lot is open, refresh the auction overlay too so its nudge buttons
  // reflect the new cooldown right away (render is idempotent; the
  // turn-edge notify is guarded, so this won't re-toast).
  if (_onlineSnapshot && _onlineSnapshot.auction) renderOnlineAuction(_onlineSnapshot.auction);
}

// One nudge button. Pass a single targetPlayer for a per-player nudge,
// or allPlayers (+ targetPlayer null) for a "Nudge all" button.
function makeNudgeButton(snapshot, targetPlayer, allPlayers) {
  const cd = NUDGE_COOLDOWN_MS;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mp-leave mp-nudge';
  if (targetPlayer) {
    const last = lastNudgeAt(snapshot, targetPlayer.profileId);
    const onCd = last && (Date.now() - last) < cd;
    const who = document.createElement('span');
    who.className = 'player-name';
    if (targetPlayer.color) who.style.setProperty('--player-color', targetPlayer.color);
    who.textContent = '@' + targetPlayer.name;
    btn.append('👋 Nudge ', who);
    if (onCd) {
      btn.disabled = true;
      btn.title = `Reminded ${relTime(last)} ago. Available again in ${fmtNudgeWait(cd - (Date.now() - last))}.`;
      const note = document.createElement('span');
      note.className = 'mp-nudge-note muted';
      note.textContent = ` · ${relTime(last)} ago`;
      btn.appendChild(note);
    } else {
      btn.title = `Send @${targetPlayer.name} a turn reminder (Discord DM).`;
      btn.addEventListener('click', () => doNudge({ targetId: targetPlayer.profileId }, btn));
    }
  } else {
    const allOnCd = (allPlayers || []).length > 0 && (allPlayers || []).every((p) => {
      const l = lastNudgeAt(snapshot, p.profileId);
      return l && (Date.now() - l) < cd;
    });
    btn.textContent = `👋 Nudge all (${(allPlayers || []).length})`;
    btn.disabled = allOnCd;
    btn.title = allOnCd ? 'Everyone here was nudged recently.'
      : 'Nudge every listed player (skips anyone on cooldown).';
    if (!allOnCd) btn.addEventListener('click', () => doNudge({ all: true }, btn));
  }
  return btn;
}

// Multi-target auction nudge button for the auctioneer: "Nudge waiting"
// (the bidders still owing a response) or "Nudge all" (every other seat).
// targetIds is the set this would ping - the button shows the count and
// greys out when that set is empty or every target is still inside the
// per-player cooldown (the server skips any that are). Reuses doNudge so
// the toast + optimistic cooldown record match the roster-panel nudges.
function makeAuctionNudgeButton(snapshot, label, opts, targetIds, title) {
  const cd = NUDGE_COOLDOWN_MS;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'modal-btn';
  // Soonest any target frees up (0 = at least one is nudgable right now).
  let soonest = Infinity;
  for (const pid of targetIds) {
    const l = lastNudgeAt(snapshot, pid);
    const left = l ? cd - (Date.now() - l) : 0;
    if (left <= 0) { soonest = 0; break; }
    soonest = Math.min(soonest, left);
  }
  const onCd = targetIds.length > 0 && soonest > 0;
  btn.textContent = `${label} (${targetIds.length})`;
  btn.disabled = _onlineBusy || targetIds.length === 0 || onCd;
  if (onCd) {
    // Surface WHY it's greyed right on the button - the hover tooltip is
    // invisible on touch: everyone in this set was nudged within the
    // cooldown, and here's when another nudge frees up.
    const note = document.createElement('span');
    note.className = 'mp-nudge-note muted';
    note.textContent = ` · ready in ${fmtNudgeWait(soonest)}`;
    btn.appendChild(note);
    btn.title = `Everyone here was nudged recently. Another nudge frees up in ${fmtNudgeWait(soonest)}.`;
  } else {
    btn.title = targetIds.length === 0
      ? 'No one is waiting on a response right now.'
      : title;
  }
  if (!btn.disabled) btn.addEventListener('click', () => doNudge(opts, btn));
  return btn;
}

function renderMpPanel(snapshot) {
  const tableEl = ensureMpPanelStructure();
  if (!tableEl) return;
  if (!snapshot || !Array.isArray(snapshot.players)) {
    tableEl.innerHTML = '<p class="muted">Connecting to the table…</p>';
    return;
  }
  const players = snapshot.players;
  const active = players[snapshot.activeIndex] || null;
  const myId = _onlineMe && _onlineMe.id;
  const myp = players.find((p) => p.profileId === myId) || null;
  // Auctioneer-side gating mirrors the server (AUCTION_START needs your
  // turn, at least one op left, no auction open, AND under the
  // academia hand limit (can't start with 4+ cards - winning would
  // overflow the hand; the server enforces the same).
  const myHandCount = (myp && Array.isArray(myp.hand)) ? myp.hand.length : 0;
  const canStartAuction = !!(active && active.profileId === myId
    && myp && myp.opsRemaining > 0 && !snapshot.auction
    && myHandCount < AUCTION_HAND_LIMIT);
  tableEl.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'mp-head';
  const row = document.createElement('div');
  row.className = 'mp-head-row';
  const room = document.createElement('div');
  room.className = 'mp-room';
  room.textContent = _onlineRoom || 'Multiplayer table';
  row.appendChild(room);
  if (_onlineLeave) {
    const leave = document.createElement('button');
    leave.type = 'button';
    leave.className = 'mp-leave';
    leave.textContent = '← Lobbies';
    leave.title = 'Back to the multiplayer lobbies list (the game stays running; you can resume)';
    leave.addEventListener('click', () => {
      try { _onlineLeave(); } catch (err) { console.error('mp leave:', err); }
    });
    row.appendChild(leave);
  }
  if (canStartAuction) {
    const startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.className = 'mp-leave mp-auction-start';
    startBtn.textContent = _deckPickerOpen ? 'Cancel' : '🎯 Start auction';
    startBtn.title = 'Put the top of a patent deck up for auction (costs 1 op)';
    startBtn.addEventListener('click', () => {
      _deckPickerOpen = !_deckPickerOpen;
      renderMpPanel(_onlineSnapshot);
    });
    row.appendChild(startBtn);
  }
  const myTurn = !!(active && active.profileId === myId);
  const turn = document.createElement('div');
  turn.className = 'mp-turn' + (myTurn ? ' mp-your-turn' : '');
  turn.textContent = active
    ? (myTurn ? 'Your turn' : '@' + active.name + "'s turn")
    : 'Waiting…';
  const clock = document.createElement('div');
  clock.className = 'muted mp-clock';
  clock.textContent = `Turn ${formatTurnNumber(snapshot.round, snapshot.turn, snapshot.maxRounds)} · slot ${(snapshot.turn | 0) + 1}/12`;
  head.append(row, turn, clock);
  tableEl.appendChild(head);

  if (_deckPickerOpen && canStartAuction) {
    const picker = document.createElement('div');
    picker.className = 'mp-deck-picker';
    buildMpDeckPicker(picker, snapshot);
    tableEl.appendChild(picker);
  }

  const roster = document.createElement('div');
  roster.className = 'mp-roster';
  for (const p of players) {
    roster.appendChild(renderMpPlayer(
      p, p.profileId === myId, !!(active && p.profileId === active.profileId)
    ));
  }
  tableEl.appendChild(roster);

  // Footer: turn nudge(s). Ping whoever can be nudged with a turn DM.
  // Normally that's whoever the table is waiting on; during an auction
  // it's every other player (user: "all players are nudgable during
  // auctions"), so each gets a button plus a "Nudge all". Otherwise it's
  // the single active player / chooser. Always shows WHO is being nudged
  // (user: "show who you're nudging in case we need to fix it") and the
  // per-target cooldown timer. I am never a nudge target.
  const needed = nudgeTargetsClient(snapshot).filter((pid) => pid !== myId);
  const needP = needed.map((pid) => players.find((p) => p.profileId === pid)).filter(Boolean);
  if (needP.length) {
    const footer = document.createElement('div');
    footer.className = 'mp-notify-test mp-nudge-wrap';
    // "Nudge all" once more than one player is nudgable (auction rounds,
    // or several actors on the clock); a single actor just gets a button.
    if (needP.length > 1) footer.appendChild(makeNudgeButton(snapshot, null, needP));
    for (const tp of needP) footer.appendChild(makeNudgeButton(snapshot, tp, null));
    tableEl.appendChild(footer);
  }
}


function renderMpPlayer(p, isMe, isActive) {
  const wrap = document.createElement('div');
  wrap.className = 'mp-player' + (isActive ? ' mp-active' : '');
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'mp-player-head';
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.style.background = p.color || '#888';
  const name = document.createElement('span');
  name.className = 'mp-name player-name';
  if (p.color) name.style.setProperty('--player-color', p.color);
  name.textContent = '@' + p.name + (isMe ? ' (you)' : '');
  const stats = document.createElement('span');
  stats.className = 'mp-stats';
  const rkt = p.rocket || {};
  const vp = (p.glory && p.glory.vps) || 0;
  // 💧 is the AQUA icon in the sandbox top-bar chip (see the
  // aqua-chip-balance widget), so use it the same way here. Tank water
  // lives in the expanded detail so the icon means the same thing
  // everywhere.
  stats.textContent = `📍${onlineSiteLabel(rkt.siteId)} · 💧${p.aqua || 0} · ${vp}vp`;
  head.append(dot, name, stats);
  const detail = document.createElement('div');
  detail.className = 'mp-player-detail';
  detail.hidden = true;
  head.addEventListener('click', () => {
    detail.hidden = !detail.hidden;
    if (!detail.hidden && !detail.dataset.built) {
      buildMpPlayerDetail(detail, p, isMe);
      detail.dataset.built = '1';
    }
  });
  wrap.append(head, detail);
  return wrap;
}

function buildMpPlayerDetail(host, p, isMe) {
  host.innerHTML = '';
  const rkt = p.rocket || {};
  const outposts = p.outposts || {};
  // All six stacks as clickable inspect chips: LEO, Rocket, Outpost
  // A-D. Rocket / LEO / outpost cards are OPEN information - any player
  // can inspect them (openMpStackModal). An outpost that isn't built
  // shows as a disabled "not built" chip so the six slots always read
  // consistently. The grid lives in .mp-stack-grid.
  const grid = document.createElement('div');
  grid.className = 'mp-stack-grid';

  // LEO Stack lives at LEO; Rocket sits at its siteId (null = LEO by
  // default - "rocket is at LEO unless assembled on an outpost or not
  // yet disassembled at a site"). Each chip carries a 📍 find button
  // that flies the map to that stack's location.
  grid.appendChild(mpStackChip('🛰 LEO Stack', p.leo || [], {
    who: p.name, hasLocation: true, findServerSite: null,
  }));
  grid.appendChild(mpStackChip(
    `🚀 Rocket${rkt.tank ? ` (💧${rkt.tank})` : ''}`,
    rkt.stack || [], { who: p.name, hasLocation: true, findServerSite: rkt.siteId || null },
  ));
  for (const letter of ['A', 'B', 'C', 'D']) {
    const op = outposts[letter];
    if (op) {
      grid.appendChild(mpStackChip(
        `🏛 Outpost ${letter} · ${onlineSiteLabel(op.siteId)}${op.tank ? ` (💧${op.tank})` : ''}`,
        op.cards || [], { who: p.name, hasLocation: true, findServerSite: op.siteId },
      ));
    } else {
      // Not built -> no location, so the find button is disabled.
      grid.appendChild(mpStackChip(`🏛 Outpost ${letter}: none`, [], {
        who: p.name, hasLocation: false,
      }));
    }
  }
  host.appendChild(grid);

  // Hand is OPEN information (user 2026-05-29: "hand cards SHOULD NOT
  // BE HIDDEN") - inspectable for every player, same as the other
  // stacks. Not on the map, so no find button.
  const count = Array.isArray(p.hand) ? p.hand.length : 0;
  const cell = mpStackChip(`✋ Hand (${count})`, p.hand || [], { who: p.name, hasLocation: false });
  cell.classList.add('mp-stack-hand');
  host.appendChild(cell);
}

// One stack cell: an inspect chip (label + count, opens a read-only
// card modal) plus an optional 📍 find button that flies the map to
// the stack's location. findServerSite is the server siteId (null =
// LEO); hasLocation=false (e.g. an unbuilt outpost, or the hand)
// renders the find button disabled. Returns the wrapper cell.
function mpStackChip(title, slots, { who, hasLocation, findServerSite } = {}) {
  const arr = Array.isArray(slots) ? slots : [];
  const cell = document.createElement('div');
  cell.className = 'mp-stack-cell';

  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'mp-stack-chip';
  const label = document.createElement('span');
  label.className = 'mp-stack-chip-label';
  label.textContent = title;
  const n = document.createElement('span');
  n.className = 'mp-stack-chip-count';
  n.textContent = String(arr.length);
  chip.append(label, n);
  if (!arr.length) {
    chip.classList.add('is-empty');
    chip.disabled = true;
  } else {
    chip.addEventListener('click', () => openMpStackModal(`${who ? '@' + who + ' - ' : ''}${title}`, arr));
  }
  cell.appendChild(chip);

  // 📍 find button. Always rendered (so the six cells line up), but
  // disabled when the stack has no map location.
  const find = document.createElement('button');
  find.type = 'button';
  find.className = 'mp-stack-find';
  find.textContent = '📍';
  find.title = hasLocation ? 'Fly the map to this stack' : 'No location yet';
  find.disabled = !hasLocation;
  if (hasLocation) {
    find.addEventListener('click', () => {
      const pos = mpRocketCoords(findServerSite); // null -> LEO anchor
      if (pos && _renderer) _renderer.flyTo(pos, locateZoom(4));
    });
  }
  cell.appendChild(find);
  return cell;
}

// Read-only modal listing the cards in a stack (opponent inspection).
// Renders each slot via the shared renderCard so it looks like every
// other card surface. No actions - pure inspection.
function openMpStackModal(title, slots) {
  document.querySelector('.mp-stack-modal-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay mp-stack-modal-overlay';
  overlay.tabIndex = -1;
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const dialog = document.createElement('div');
  dialog.className = 'mp-stack-modal';
  const head = document.createElement('div');
  head.className = 'mp-stack-modal-head';
  const h = document.createElement('h3');
  h.textContent = title;
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'modal-x';
  x.textContent = '×';
  x.title = 'Close (Esc)';
  x.addEventListener('click', close);
  head.append(h, x);
  dialog.appendChild(head);

  const body = document.createElement('div');
  body.className = 'mp-stack-modal-cards';
  for (const slot of slots) {
    // The HAND ships as bare id strings; LEO / rocket / outpost ship as
    // { id, kind, face } slot objects. Normalise so both render.
    const id = (typeof slot === 'string') ? slot : (slot && slot.id);
    const face = (slot && typeof slot === 'object') ? slot.face : undefined;
    const card = PATENTS_BY_ID[id] || CREW_BY_ID[id];
    if (!card) {
      const t = document.createElement('div');
      t.className = 'mp-line';
      t.textContent = id || '?';
      body.appendChild(t);
      continue;
    }
    const kind = CREW_BY_ID[id] ? 'crew' : 'patent';
    const wrap = document.createElement('div');
    wrap.className = 'mp-stack-modal-card';
    try { wrap.appendChild(renderCard(card, { type: kind, face })); }
    catch { wrap.textContent = card.name || id; }
    body.appendChild(wrap);
  }
  dialog.appendChild(body);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  overlay.focus();
}

// Whether it is the local player's turn in the cached snapshot.
function isOnlineMyTurn() {
  if (!_online || _spectator || !_onlineSnapshot || !_onlineMe) return false;
  const players = _onlineSnapshot.players || [];
  const active = players[_onlineSnapshot.activeIndex];
  return !!active && active.profileId === _onlineMe.id;
}

// Shared online action router. Translates nothing (caller builds the
// op), POSTs it, and on success re-hydrates from the returned snapshot
// while SKIPPING any local mutation/animation. On failure it toasts a
// humanized error and re-applies the last snapshot so the UI snaps
// back. Returns true on success. Guards re-entrancy with _onlineBusy.
async function submitOnlineOp(op) {
  if (!_online) return false;
  if (_spectator) { _onlineToast('Spectator - view only.', 'error'); return false; }
  if (!isOnlineMyTurn()) { _onlineToast('Not your turn.', 'error'); return false; }
  if (_onlineBusy) return false;
  _onlineBusy = true;
  let r;
  try {
    r = await submitGameOp(_onlineGameId, op, _onlineMe.token);
  } finally {
    _onlineBusy = false;
  }
  if (!r || !r.ok) {
    _onlineToast(humanizeOnlineOpError(r && r.error), 'error');
    // Snap the UI back to the authoritative last-known state.
    if (_onlineSnapshot) applySnapshot(_onlineSnapshot);
    return false;
  }
  applySnapshot(r.data.game.state, r.data.game.seq);
  return true;
}

// Op-error code -> human message for server rejections surfaced in the
// online sandbox.
function humanizeOnlineOpError(code) {
  return ({
    api_unavailable: 'The game server is unavailable.',
    network: 'Network error - check your connection.',
    not_your_turn: 'It is not your turn.',
    no_moves_left: 'No moves left this turn. End your turn.',
    insufficient_water: 'Not enough water for that burn.',
    no_route: 'No route to that site.',
    unknown_site: 'Unknown site.',
    already_here: 'Your ship is already there.',
    nothing_to_undo: 'Nothing to undo.',
    nothing_to_redo: 'Nothing to redo.',
    roll_blocks_undo: 'Can\'t undo past a dice roll.',
    game_not_active: 'This game has ended.',
    not_a_player: 'You are not in this game.',
    unknown_op: 'Unsupported operation.',
    rocket_not_at_leo: 'Park the rocket at LEO to move cards between LEO and the rocket.',
    bad_transfer: 'Invalid transfer.',
    not_in_leo: 'That card is not in your LEO Stack.',
    not_in_rocket: 'That card is not on your rocket.',
    empty_rocket: 'Your rocket is empty - build or board a thruster before moving.',
    nothing_to_boost: 'Mark at least one hand card to boost.',
    tank_full: 'The rocket tank is full.',
    no_water: 'No water in the tank to cash out.',
    unknown_card: 'That card does not exist.',
    crew_already_picked: 'You have already picked your starting crew.',
    crew_draft_closed: 'Crew picks are locked - the game has started.',
    awaiting_crew_picks: 'Waiting for every player to pick a starting crew.',
    unknown_crew: 'That crew card does not exist.',
    unknown_crew_face: 'Pick the primary or secondary face.',
    wrong_crew_colour: 'That crew card is not your assigned colour.',
    auction_in_progress: 'An auction is already underway.',
    need_opponent: 'Need another player to hold an auction.',
    hand_limit: 'Hand limit reached (4) - you cannot start or join an auction. Build or transfer cards first.',
    no_ops_left: 'No operations left this turn.',
    bad_deck: 'Pick a valid deck to auction.',
    deck_empty: 'That deck is empty.',
    no_auction: 'No auction is open.',
    not_bidding_phase: 'Bidding is closed right now.',
    bidders_pending: 'You can\'t close the lot yet - every other player must bid or pass first.',
    no_discards_left: 'You\'ve already discarded this turn (1 per turn).',
    bid_too_low: 'Bid must beat the current high bid.',
    insufficient_aqua: 'Not enough aqua.',
    bad_amount: 'Enter a whole number.',
    not_owner: 'You do not own that.',
    not_in_hand: 'That card is not in your hand.',
    not_in_stack: 'That card is not on your rocket.',
    cannot_build: 'That card cannot be built right now.',
    rocket_at_leo: 'Park out in space to make an outpost - at LEO, use the LEO Stack.',
    no_outpost_slot: 'All 4 outpost slots are in use.',
    not_in_source: 'That card is not in the source stack.',
    not_colocated: 'Park the rocket at that stack\'s site to transfer.',
    no_outpost: 'That outpost does not exist.',
    outpost_not_empty: 'Empty the outpost first (move its cards out), then decommission it.',
    crew_no_decommission: 'Crew can\'t be decommissioned here - that happens via an event.',
    bad_decommission: 'Pick a card to decommission.',
    nothing_decommissioned: 'Nothing decommissioned (crew can\'t return to the hand).',
    cannot_liftoff: 'Not enough thrust to lift off (and no factory here to assist).',
    cannot_land: 'Not enough thrust to land there (and no factory to assist).',
    raygun_out_of_range: 'The raygun can only scan your site or one adjacent to it.',
    no_disc: 'There is no prospect disc to re-roll.',
    not_buggy: 'Only a buggy prospector can re-roll.',
    already_rerolled: 'The buggy has already re-rolled this claim.',
    reroll_window_closed: 'The buggy re-roll is only available the turn you prospect.',
  })[code] || (code ? String(code) : 'Something went wrong.');
}

// Active-thruster click: online routes a SET_ACTIVE_THRUSTER op (the
// server flips it and broadcasts; applySnapshot redraws). Solo flips
// the local rocket state directly, unchanged.
function onSetActiveThrusterClick(cardId) {
  if (_online) { submitOnlineOp({ kind: 'SET_ACTIVE_THRUSTER', cardId }); return; }
  setActiveThruster(cardId);
}

// Active-prospector click: same split as the thruster activator.
function onSetActiveProspectorClick(cardId) {
  if (_online) { submitOnlineOp({ kind: 'SET_ACTIVE_PROSPECTOR', cardId }); return; }
  setActiveProspector(cardId);
}

// Tear down the online layer so the page can leave a multiplayer game
// cleanly. Unsubscribes the WS relay, flips the shared online flag off,
// and clears the online module vars.
//
// NOTE: returning to the SOLO sandbox in the same page load is NOT
// fully handled here - the state modules were hydrated from the server
// snapshot, so they need to be reloaded from localStorage (each module
// re-reading its persisted save) before solo play resumes. That
// reload is the caller's responsibility (e.g. a full re-mount / reload);
// this teardown only detaches the online plumbing. Flagging, not solving.
export function unmountBrowseOnline() {
  if (_onlineOffWS) { try { _onlineOffWS(); } catch { /* ignore */ } _onlineOffWS = null; }
  if (_onlinePoll) { clearInterval(_onlinePoll); _onlinePoll = null; }
  _onlinePollMs = 0;
  _lastAuctionPhase = null;
  _eagerPollInFlight = false;
  setOnline(false);
  _online = false;
  _spectator = false;
  _onlineGameId = null;
  _onlineMe = null;
  _onlineToast = null;
  if (_onlineChatOff) { try { _onlineChatOff(); } catch { /* ignore */ } _onlineChatOff = null; }
  // Drop the cached conversation so the next room doesn't inherit it.
  _chatLog.length = 0;
  resetChatList(document.getElementById('mp-chat-list'));
  resetChatList(document.getElementById('mp-auction-chat-list'));
  _onlineMaps = null;
  _onlineSnapshot = null;
  _lastAppliedSeq = -1;
  if (_renderer) {
    try { _renderer.setMpRockets(null); _renderer.setSandboxRocketOffset(0); } catch { /* ignore */ }
  }
  const shell = document.querySelector('.browse-shell');
  if (shell) { shell.style.removeProperty('--me-color'); shell.classList.remove('has-me-color'); }
  _onlineBusy = false;
  _onlineRoom = null;
  _onlineLobbyId = null;
  _onlineLeave = null;
  // Tear down the auction overlay + drafts so nothing lingers when the
  // player returns to the lobby list.
  _bidDraft = '';
  _joinDraft = '';
  _auctionKey = null;
  _deckPickerOpen = false;
  const auctionOverlay = document.getElementById('mp-auction-overlay');
  if (auctionOverlay) auctionOverlay.remove();
  // Tear down the first-player handoff + end-of-game overlays too.
  const fpOverlay = document.getElementById('mp-first-player-overlay');
  if (fpOverlay) fpOverlay.remove();
  const goOverlay = document.getElementById('mp-game-over-overlay');
  if (goOverlay) goOverlay.remove();
  _gameOverDismissed = false;
  // Tear down any open crew-pick wizard so it doesn't leak across
  // sessions when the player returns to the lobby list.
  const crewOverlay = document.querySelector('.crew-wizard-overlay');
  if (crewOverlay) crewOverlay.remove();
  const draftOverlay = document.getElementById('mp-crew-draft-overlay');
  if (draftOverlay) draftOverlay.remove();
  _crewWizardOpen = false;
  const banner = document.getElementById('mp-turn-banner');
  if (banner) {
    banner.hidden = true;
    banner.classList.remove('is-your-turn');
    banner.style.removeProperty('--mp-turn-color');
    banner.textContent = '';
  }
  syncMpTabVisibility();
}

// Reset every shared game-state module to a fresh solo new-game. The
// state modules are process-wide singletons, so without this an online
// game's hydrated state (rocket / hand / discs / factories / ...) bleeds
// straight into a "Sandbox (solo)" session. Called when starting a fresh
// sandbox so each session is self-contained. (Server-authoritative MP
// re-hydrates from its snapshot, so a reset there is harmless too.)
export function resetSoloGame() {
  const safe = (fn) => { try { fn(); } catch { /* module not ready */ } };
  safe(() => rocketClearStack());
  safe(() => clearActiveProspector());
  safe(() => clearHand());
  safe(() => clearBoostMarks());
  safe(() => resetLeoStack());
  safe(() => resetDiscs());
  safe(() => resetStacks());                 // outposts
  safe(() => resetGlory());
  safe(() => resetFactoriesAndColonies());
  safe(() => resetDecks(new Set()));         // full fresh shuffled decks
  safe(() => resetClock());
  safe(() => resetAqua());
  safe(() => setTankWater(0));
  // Rocket position / route / trail module-locals + their saves.
  _rocketSiteId = null;
  _plannedRoute = null;
  _rocketTrail = [];
  _moveSnapshot = null;
  setHazardousMove(false);
  try {
    localStorage.removeItem(STORAGE_ROCKET_SITE);
    localStorage.removeItem(STORAGE_ROCKET_TRAIL);
    localStorage.removeItem(STORAGE_ROCKET_ROUTE);
    localStorage.removeItem(STORAGE_PENDING_MOVE);
  } catch { /* private mode */ }
  if (_renderer) {
    safe(() => { _renderer.setRoute(null); _renderer.setRouteEndpoints(null, null); _renderer.setRocketTrail(null); });
  }
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
      const discardQ = qBtn('q-discard', '🗑',
        getDiscardsRemaining() > 0 ? 'Discard (free, 1 per turn)' : 'Discard already used this turn',
        () => discardHandCard(card, idx));
      discardQ.disabled = getDiscardsRemaining() <= 0;
      quick.append(
        discardQ,
        // Free Market: effectively sells the card for +$3 (to the
        // bottom of its deck), via the shared op-gated confirm flow.
        qBtn('q-sell',    '💱', `Free Market: effectively sells this card to gain $${FREE_MARKET_AQUA} (costs 1 operation)`,
          () => freeMarketSellFromHand(card)),
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
    // Online: the BOOST is a server op. Submit the marked ids; the
    // server moves Hand -> LEO, charges aqua, spends the op, and
    // broadcasts. Skip the local mutation below - the snapshot
    // re-hydrate is the source of truth (and other players see it).
    if (_online) {
      const sent = await submitOnlineOp({ kind: 'BOOST', cardIds: marked });
      if (sent) clearBoostMarks();
      return;
    }
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
      // 💧 on the chip when the outpost holds water, so a parked rocket
      // can tell at a glance there's fuel to pump.
      const hasWater = (op.tank | 0) > 0;
      slots.push({
        id: `outpost${letter}`, label: hasWater ? '🏛💧' : '🏛', sub: letter,
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
  // Rocket is a destination when:
  //  - it's colocated (its site matches the source site), loading
  //    the existing rocket, OR
  //  - the rocket stack is empty AND the source is an outpost: the
  //    first card transferred FORMS a new rocket at the outpost's
  //    site. (You can't form a new rocket while one is already
  //    active - the empty-stack check enforces "one rocket".)
  if (sourceId !== 'rocket') {
    const rs = getRocketSite();
    const rocketEmpty = getRocketStack().length === 0;
    if ((rs && rs.id === sourceSite)
        || (rocketEmpty && sourceId.startsWith('outpost'))) {
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
// Online batch transfer: submit ALL selected cards in ONE TRANSFER op.
// Returns true if it handled the click (online), false to fall through
// to the solo per-card loop. Fixes "only one card at a time" - the
// per-card loop fired N submitOnlineOps but _onlineBusy dropped every
// one after the first. LEO<->Rocket only; other combos toast.
function transferSelectedOnline(sourceId, destId, ids) {
  if (!_online) return false;
  // The server understands leo / rocket / outpostX as endpoints; one side
  // must be the rocket (the mobile carrier). It validates colocation.
  if (sourceId !== 'rocket' && destId !== 'rocket') {
    _onlineToast('Card transfers must involve the rocket.', 'error');
    return true;
  }
  submitOnlineOp({ kind: 'TRANSFER', cardIds: [...ids], from: sourceId, to: destId });
  return true;
}

function transferOneCard(sourceId, destId, cardId) {
  // Online: LEO <-> Rocket transfers map to the server TRANSFER op
  // (valid only while the rocket is parked at LEO; the server enforces
  // that). Fire-and-forget - the broadcast / poll snapshot re-hydrates
  // the stacks and repaints the open inspector. Return false so the
  // local move below is skipped. Other combos (outpost <-> *) have no
  // server op yet, so they toast rather than mutating local state the
  // next snapshot would clobber.
  //
  // NB: LEO -> Rocket is NOT BUILD_ROCKET - that op pulls from the
  // hand. The crew PICK_CREW staged in LEO lives in player.leo, so it
  // must travel via TRANSFER.
  if (_online) {
    // Any colocated stack <-> rocket move (LEO or an outpost). The server
    // validates colocation + forms the rocket at an outpost when empty.
    if (sourceId === 'rocket' || destId === 'rocket') {
      submitOnlineOp({ kind: 'TRANSFER', cardId, from: sourceId, to: destId });
    } else {
      _onlineToast('Card transfers must involve the rocket.', 'error');
    }
    return false;
  }
  const TANK_MAX = 32;
  // Forming a rocket: an empty rocket stack adopts its location from
  // the first card transferred in from an outpost. Capture intent +
  // the previous site (for rollback) before mutating any stacks.
  const formingRocket = destId === 'rocket'
    && sourceId.startsWith('outpost')
    && getRocketStack().length === 0;
  const sourceSiteId = getStackSiteId(sourceId);
  const prevRocketSiteId = _rocketSiteId;
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
    // Place the (empty) rocket at the source site BEFORE adding the
    // card, so the onRocketChange sync that rocketAddCard fires
    // draws the sprite at the freshly-formed location.
    if (formingRocket && sourceSiteId) {
      _rocketSiteId = sourceSiteId;
      persistRocketSite();
    }
    added = rocketAddCard(slot.id, slot.kind, slot.face) !== -1;
    if (!added && formingRocket) {
      _rocketSiteId = prevRocketSiteId;
      persistRocketSite();
    }
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
  // Online: rocket / LEO decommission routes through the server so the
  // hand actually gains the cards (a local mutation would be clobbered by
  // the next snapshot). Outpost decommission has no server op yet.
  if (_online) {
    if (stackId !== 'rocket' && stackId !== 'leo') {
      _onlineToast('Decommission from there is not available online yet.', 'error');
      return;
    }
    const okOp = await submitOnlineOp({ kind: 'DECOMMISSION', cardIds: list, from: stackId });
    if (okOp) { try { onDone && onDone(); } catch (e) { /* ignore */ } }
    return;
  }
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
          ${outpostPumpBtnHtml(stackId)}
          ${outpostDissolveBtnHtml(stackId)}
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
        wrap.appendChild(actions);
        row.appendChild(wrap);
      }
    }
    // Resolved glory chits live in the LEO stack as cards, shown on
    // their front or back side (back = a crew brought it home).
    if (stackId === 'leo') {
      const claimedChits = getClaimedChits();
      if (claimedChits.length) {
        if (!cards.length) row.innerHTML = '';
        for (const c of claimedChits) row.appendChild(buildChitToken(c.zone, { side: c.side, crewId: c.crewId }));
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
          <div class="stack-inspector-selrow">
            <button type="button" class="modal-btn stack-selall">Select all</button>
            <button type="button" class="modal-btn stack-deselall">Deselect all</button>
          </div>
          <div class="stack-inspector-xfer-row">${destButtonsHtml}</div>
        </div>`;
      // Select-all / deselect-all over the source stack's cards.
      const selAll = transferHost.querySelector('.stack-selall');
      const deselAll = transferHost.querySelector('.stack-deselall');
      if (selAll) selAll.addEventListener('click', () => {
        for (const c of cards) selected.add(c.id);
        render();
      });
      if (deselAll) deselAll.addEventListener('click', () => {
        selected.clear();
        render();
      });
      transferHost.querySelectorAll('.stack-inspector-xfer-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const destId = btn.getAttribute('data-dest');
          if (!destId || selected.size === 0) return;
          // Online: one batch op for all selected cards.
          if (transferSelectedOnline(stackId, destId, [...selected])) {
            selected.clear();
            return;
          }
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
    // Pump the outpost's water into a colocated rocket.
    const pumpBtn = dialog.querySelector('.stack-pump-fuel');
    if (pumpBtn) {
      pumpBtn.addEventListener('click', () => {
        const letter = pumpBtn.dataset.letter;
        const max = Number(pumpBtn.dataset.max) || 0;
        if (max <= 0) return;
        close();
        doPumpOutpostFuel(letter, max);
      });
    }
    // Decommission an empty outpost (dissolve it, free the slot).
    const dissolveBtn = dialog.querySelector('.stack-dissolve-outpost');
    if (dissolveBtn) {
      dissolveBtn.addEventListener('click', async () => {
        const letter = dissolveBtn.dataset.letter;
        const op = getOutpost(letter);
        const waterNote = op && (op.tank | 0) > 0
          ? ` Its ${op.tank} water will be lost.` : '';
        const ok = await confirmModal({
          title: `🗑 Decommission Outpost ${letter}`,
          body: `Free outpost slot ${letter}?${waterNote}`,
          yes: '🗑 Decommission', no: 'Cancel',
        });
        if (!ok) return;
        if (_online) { await submitOnlineOp({ kind: 'DISSOLVE_OUTPOST', letter }); close(); return; }
        dissolveOutpost(letter);
        close();
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
    // Read-only reference views. Crew enters play only through the
    // starting-crew wizard at New game; GW thrusters are an upcoming
    // expansion you can preview (flip to see both faces) but not yet
    // play. Either way there's no add / auction here.
    const note = document.createElement('p');
    note.className = 'muted card-modal-note';
    note.textContent = card.type === 'gw-thruster'
      ? '🚧 GW thrusters are an upcoming expansion. Preview only for now - flip to see both faces.'
      : '👥 Crew is chosen at New game via the starting-crew wizard.';
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
  // Shared discard path (online routes the DISCARD server op so it
  // persists; solo mutates locally). Same helper the hand quick-action
  // trash icon uses, so the two can't drift.
  discardBtn.addEventListener('click', () => {
    if (discardBtn.disabled) return;
    discardHandCard(card, slotIdx, close);
  });

  const sellBtn = document.createElement('button');
  sellBtn.type = 'button';
  sellBtn.className = 'modal-btn sell';
  sellBtn.textContent = '💱 Free Market';
  sellBtn.title = `Free Market: effectively sells this card to gain $${FREE_MARKET_AQUA}, returning it to the bottom of its deck. Costs 1 operation.`;
  sellBtn.addEventListener('click', () => {
    freeMarketSellFromHand(card, close);
  });

  const produceBtn = document.createElement('button');
  produceBtn.type = 'button';
  produceBtn.className = 'modal-btn produce';
  // ET / Exo produce: flip this hand card Black-Side-up into an
  // outpost at a colocated factory whose spectral type matches the
  // card. Same op as the site-popup "ET Produce", just driven from
  // the card. Gated on the rocket being parked at a matching,
  // player-owned factory with outpost room; greyed-out + explained
  // otherwise.
  const cardSpectral = card.spectralType || 'C';
  const exoSite = (kind !== 'crew') ? getRocketSite() : null;
  const exoFactory = exoSite ? getFactory(exoSite.id) : null;
  const exoOwned = exoFactory && exoFactory.ownerId === SANDBOX_OWNER_ID;
  const exoSpectralOk = exoOwned && exoFactory.spectralType === cardSpectral;
  const exoOutposts = exoSite
    ? Object.values(getOutposts()).filter((o) => o.siteId === exoSite.id) : [];
  const exoFreeSlots = getAvailableOutpostSlots();
  const exoRoom = exoOutposts.length > 0 || exoFreeSlots.length > 0;
  const canExo = !!(exoSpectralOk && exoRoom);
  produceBtn.textContent = `🏭 Exo produce (${cardSpectral})`;
  produceBtn.disabled = !canExo;
  produceBtn.title = !exoSite
    ? 'Park the rocket at a site with your factory to ET Produce.'
    : !exoOwned
      ? `No factory you own at ${exoSite.name}. Industrialize a site first.`
      : !exoSpectralOk
        ? `Factory at ${exoSite.name} is spectral ${exoFactory.spectralType}; this card is ${cardSpectral}.`
        : !exoRoom
          ? 'No colocated outpost and all 4 outpost slots are in use.'
          : `Produce this card Black-Side-up into the outpost at ${exoSite.name}.`;
  produceBtn.addEventListener('click', () => {
    if (!canExo) return;
    close();
    doEtProduce(exoSite, exoFactory,
      [{ id: card.id, card, name: card.name }], exoOutposts, exoFreeSlots);
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
    // The 🔍 search button isn't a pane - it opens the search modal.
    if (btn.id === 'sidepanel-search') {
      btn.addEventListener('click', () => { _openMapSearch?.(); });
      continue;
    }
    // The ⚙ config button isn't a pane - it opens the config modal.
    if (btn.id === 'sidepanel-config') {
      btn.addEventListener('click', () => openConfigModal());
      continue;
    }
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
  else if (pane === 'mp')         renderMpPanel(_onlineSnapshot);
  // Opening the table pane clears the "new chat" pulse.
  if (pane === 'mp') clearMpChatUnread();
}

// Float a "+N" aqua indicator above the balance chip, then remove it
// once the CSS rise-and-fade animation ends. Purely cosmetic feedback
// for a credited sale / income.
function spawnAquaGainFloat(anchor, delta) {
  if (!anchor || delta <= 0) return;
  const float = document.createElement('span');
  float.className = 'aqua-gain-float';
  float.textContent = `+${delta}`;
  anchor.appendChild(float);
  float.addEventListener('animationend', () => float.remove());
  // Safety net in case animationend doesn't fire (reduced-motion etc).
  setTimeout(() => float.remove(), 1500);
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
// Pre-move snapshot written while a (possibly hazardous) move is
// being resolved. If the tab is closed / refreshed mid-resolution
// the queue is abandoned, so on the next load we roll the move back
// to this snapshot (refunding the move + fuel) rather than stranding
// the player with a spent turn. Cleared at every move exit path.
const STORAGE_PENDING_MOVE = 'hf-sandbox-pending-move';
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
  // Keep the server's copy of the plan in step with each manual hop.
  submitSetRouteOnline();
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
        <button id="turn-end" title="End your turn"
          aria-label="End turn">⏭ End turn</button>
        <span id="turn-budget" class="map-turn-budget" aria-live="polite">
          <button type="button" class="turn-tag" id="turn-tag-move" title="Moves remaining this turn">move:1</button>
        </span>
        <button id="turn-tracker" title="View turn tracker"
          aria-label="View turn tracker">🕐</button>
        <button type="button" class="turn-tag turn-tag-gear" id="game-settings" title="Game settings" aria-label="Game settings">⚙</button>
        <span id="aqua-chip" class="map-aqua-chip"
          title="Aqua balance - spend 4 aqua per hazard to bypass rolls, or convert 1:1 to water at LEO">
          💧 <strong id="aqua-chip-balance">${getAqua()}</strong>
        </span>
      </div>
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
        <div class="dbg-prof">
          <div class="dbg-prof-title">Frame breakdown (ms/frame)</div>
          <div id="dbg-prof-body" class="dbg-prof-body">- pan or zoom the map -</div>
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
        <div class="dbg-zone">
          <div class="dbg-zone-title">Zone polygon painter</div>
          <label class="dbg-check">
            <input id="dbg-zone-edit" type="checkbox" />
            <span>Zone edit mode (show + edit polygons)</span>
          </label>
          <label class="dbg-slider">
            <span>Paint zone</span>
            <select id="dbg-zone-select">
              <option value="">- off -</option>
            </select>
          </label>
          <p class="dbg-zone-hint" id="dbg-zone-hint">Each zone is ONE polygon. Pick a zone, then <strong>Shift+click</strong> to add points to it; drag a point to move it; plain-drag pans. Switch zones to edit another polygon. Zones nest inner→outer: a node takes the <strong>innermost</strong> polygon that contains it (inside Venus but not Mercury = Venus). <strong>Export</strong> dumps all zone polygons; everything persists across refreshes until you Clear.</p>
          <div class="dbg-zone-btns">
            <button id="dbg-zone-clearzone" type="button">Clear zone</button>
            <button id="dbg-zone-undo" type="button">Undo point</button>
          </div>
          <div class="dbg-zone-btns">
            <button id="dbg-zone-clear" type="button">Clear all</button>
            <button id="dbg-zone-export" type="button">Export to console</button>
          </div>
          <div class="dbg-row">
            <span>Zones</span>
            <strong id="dbg-zone-count">0 poly · 0 nodes</strong>
          </div>
        </div>
        <button id="dbg-reset" class="dbg-reset">Reset view</button>
      </div>
    </div>
  `;
  host.querySelector('#route-clear').addEventListener('click', () => {
    // Explicit clear is the one place we tell the server to forget the
    // plan too (the post-move clearRoute stays local - the server
    // already truncates the consumed route on MOVE, and a CLEAR_ROUTE
    // there would land on the undo stack ahead of the move).
    submitClearRouteOnline();
    clearRoute();
  });
  // Debug-panel toggle now lives in the hamburger menu (#btn-debug-panel)
  // rather than on the map toolbar. Bind it here since browse.js owns
  // the #map-debug panel; close the menu so the panel is visible.
  const debugMenuBtn = document.getElementById('btn-debug-panel');
  if (debugMenuBtn && !debugMenuBtn.dataset.wired) {
    debugMenuBtn.dataset.wired = '1';
    debugMenuBtn.addEventListener('click', () => {
      const panel = host.querySelector('#map-debug');
      if (!panel) return;
      panel.classList.toggle('hidden');
      const open = !panel.classList.contains('hidden');
      if (_renderer) _renderer.setOption('debug', open);
      try { localStorage.setItem(STORAGE_DBG_PANEL_OPEN, open ? '1' : '0'); }
      catch { /* private mode */ }
      document.getElementById('main-menu-modal')?.classList.add('hidden');
    });
  }
  // Global game-settings gear, a standalone toolbar chip. Opens the
  // same settings modal accessible from per-popup affordances; right
  // now route + fuel options live there but future settings (UI
  // density, accessibility toggles, persistent dev flags) will land
  // in the same modal. Tap wiring (touchend + click) happens below
  // alongside the op / move / aqua controls for mobile reliability.
  // Turn clock + rocket-movement controls. End turn pops a confirm
  // when the player still has unspent budget; if they confirm and
  // the new slot is an event, openTurnClockModal animates the d6.
  // Move rocket is a placeholder until the rocket-movement engine
  // lands - it just consumes the per-turn move budget for now so
  // the end-turn confirm reflects the spend.
  host.querySelector('#turn-end').addEventListener('click', async () => {
    // An open auction freezes the turn: the lot must resolve first. The
    // button is disabled + reads "Auctioning" in this state, but guard the
    // click too in case a stale enabled state slips through.
    if (_onlineSnapshot && _onlineSnapshot.auction) {
      setStatus('An auction is open - resolve it before ending your turn.');
      return;
    }
    // While an operation is still in hand this button IS the ops-menu opener
    // (its label reads "Ops"): use the op first. Only once ops are spent does
    // tapping it end the turn.
    if (getOpsRemaining() > 0) { openOpsMenu(); return; }
    // Confirm before ending with budget the player could still use: an
    // operational rocket (active thruster) plus an unspent move. (Ops are
    // always 0 here, since ops > 0 opens the menu above.)
    let hasRocket = false;
    try { const ra = isRocketActive(); hasRocket = !!(ra && ra.active); } catch { hasRocket = false; }
    // Online: the server advances the turn (and resolves any Sunspot
    // Cube event), broadcasting the new snapshot. Send END_TURN and let
    // applySnapshot redraw; skip the local clock/event/log flow below.
    if (_online) {
      if (hasRocket && (getMovesRemaining() > 0 || getOpsRemaining() > 0)
        && !(await confirmEndTurn())) return;
      await submitOnlineOp({ kind: 'END_TURN' });
      return;
    }
    // Capture the previous slot BEFORE advancing so the modal can
    // animate the Sunspot Cube sliding from old → new instead of
    // teleporting. If the player cancels the confirm, nothing
    // moved, so we skip the modal entirely.
    const prevTurn = getTurn();
    const result = await triggerEndTurn({ hasRocket });
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
  // Per-turn move:N tag in the toolbar. The move tag IS the move
  // control now (the old 🛸 button is gone): tap to move when a
  // move is left, or to undo when it's spent. Operations are driven
  // from the End turn button (it reads "Ops" while one is unspent),
  // so there is no separate op tag. Live-updates on any consume /
  // refund / turn rollover.
  const moveTag = host.querySelector('#turn-tag-move');
  const endTurnBtn = host.querySelector('#turn-end');
  function refreshTurnBudget() {
    const ops = getOpsRemaining();
    const moves = getMovesRemaining();
    // Online: lock End turn / op / move when it's not the local
    // player's turn (or in spectator mode). The server-authoritative
    // engine would refuse the op anyway, but greying the controls
    // makes it obvious the action isn't available right now.
    // CLAUDE.md: async multiplayer can't trust the WS to be live,
    // so the turn-ownership read uses the cached snapshot the
    // polling loop refreshes.
    // A first-player handoff or a finished game freezes the normal
    // action toolbar even for the player the active pointer rests on
    // (the chooser acts through the handoff overlay, not these buttons).
    const onlineFrozen = _online && !!_onlineSnapshot
      && (_onlineSnapshot.pendingFirstPlayer || _onlineSnapshot.status === 'finished');
    const lockedByOnline = _online && (_spectator || !isOnlineMyTurn() || onlineFrozen);
    // An open auction is its own call to action (bid / pass / close), so the
    // End turn nudge stays dark while a lot is up - even with operations spent.
    const auctionInProgress = !!(_onlineSnapshot && _onlineSnapshot.auction);
    if (moveTag) {
      // Once the move is spent the tag IS the undo control - it reads
      // "↩ undo move" so the player knows tapping rewinds this turn's
      // move (the rocket slides back to where it started). With a move
      // still in hand it shows the budget and moves the rocket.
      const spent = moves <= 0;
      // The rocket can only fly with a valid thruster support chain
      // engaged (a thruster whose reactor / generator / heat supports
      // are all satisfied). Until then the move control is dark - no glow -
      // so the player isn't nudged toward a move that can't happen. It stays
      // ENABLED (not disabled) in this state so the hover tip + the tap hint
      // still fire (a disabled button shows neither). (Undo stays available
      // so a spent move can rewind.)
      let canMove = true;
      try { const ra = isRocketActive(); canMove = !!(ra && ra.active); } catch { canMove = true; }
      const blocked = !spent && !canMove;
      moveTag.textContent = spent ? '↩ undo move' : `move:${moves}`;
      moveTag.classList.toggle('is-spent', spent);
      moveTag.classList.toggle('is-undo', spent && !lockedByOnline);
      moveTag.classList.toggle('is-locked', lockedByOnline);
      moveTag.classList.toggle('is-nomove', blocked && !lockedByOnline);
      moveTag.disabled = lockedByOnline;
      moveTag.title = lockedByOnline
        ? 'Waiting for your turn.'
        : (blocked
          ? 'To move, install an operational thruster into the rocket (a thruster with all its supports satisfied).'
          : (spent
            ? 'Move spent - tap to undo this turn\'s move (rewinds the rocket)'
            : 'Move remaining - tap to move the rocket along its route'));
    }
    if (endTurnBtn) {
      // An open auction freezes End turn (the lot must resolve before the
      // turn can pass), so the button reads "Auctioning" and is disabled
      // until it closes - the auction overlay is where the action is.
      endTurnBtn.disabled = lockedByOnline || auctionInProgress;
      endTurnBtn.classList.toggle('is-locked', lockedByOnline);
      endTurnBtn.classList.toggle('is-auctioning', auctionInProgress && !lockedByOnline);
      // Colour the End turn button (and its glow) with the active player's
      // seat colour - the same colour the turn banner uses - so it reads as
      // "whose turn it is". Solo / no active player falls back to the default.
      const activePlayer = _onlineSnapshot && Array.isArray(_onlineSnapshot.players)
        ? _onlineSnapshot.players[_onlineSnapshot.activeIndex] : null;
      const seat = activePlayer && activePlayer.color;
      if (seat) {
        endTurnBtn.style.setProperty('--mp-turn-color', seat);
        endTurnBtn.style.color = readableInk(seat);
      } else {
        endTurnBtn.style.removeProperty('--mp-turn-color');
        endTurnBtn.style.removeProperty('color');
      }
      // Label priority: an open auction overrides everything (you can't end
      // the turn yet). Otherwise, an unspent operation reads "Ops" (and opens
      // the operations menu); only once ops are spent is it the End turn
      // button, which can glow when no auction lot is waiting on a bid.
      const hasOps = ops > 0;
      endTurnBtn.textContent = auctionInProgress
        ? '🔨 Auctioning'
        : (hasOps ? '⚙ Ops' : '⏭ End turn');
      endTurnBtn.classList.toggle('is-ops', hasOps && !lockedByOnline && !auctionInProgress);
      endTurnBtn.classList.toggle('needs-end',
        ops <= 0 && !auctionInProgress && !lockedByOnline);
      endTurnBtn.title = lockedByOnline
        ? 'Waiting for your turn.'
        : (auctionInProgress
          ? 'An auction is open - resolve it before ending your turn.'
          : (hasOps ? 'You still have an operation - tap to use it' : 'End your turn'));
    }
  }
  // Stash on the host so applySnapshot can re-trigger after a fresh
  // server snapshot flips active player. The hand off lives on the
  // DOM element so it survives this closure's GC.
  host._refreshTurnBudget = refreshTurnBudget;
  refreshTurnBudget();
  onTurnChange(refreshTurnBudget);
  // Also refresh when the rocket stack changes: adding / removing a
  // thruster (or its supports) flips whether the rocket can move, which
  // enables or disables the move tag.
  onRocketChange(refreshTurnBudget);
  // Robust cross-device tap: some mobile browsers don't deliver a
  // reliable `click` on these toolbar controls, so also handle
  // `touchend` (preventing the ghost click that would double-fire).
  const onTap = (el, fn) => {
    if (!el) return;
    let touched = false;
    el.addEventListener('touchend', (e) => {
      touched = true;
      e.preventDefault();
      fn(e);
      setTimeout(() => { touched = false; }, 500);
    }, { passive: false });
    el.addEventListener('click', (e) => { if (!touched) fn(e); });
  };
  if (moveTag) {
    moveTag.style.cursor = 'pointer';
    onTap(moveTag, () => {
      if (getMovesRemaining() > 0) {
        // Guard the tap too (not just the disabled state): no thruster
        // support chain means there's nothing to move.
        let canMove = true;
        try { const ra = isRocketActive(); canMove = !!(ra && ra.active); } catch { canMove = true; }
        if (!canMove) { setStatus('To move, install an operational thruster into the rocket (a thruster with all its supports satisfied).'); return; }
        moveRocket();
      } else undoRocketMove();
    });
  }
  // Aqua balance chip - live-updates on any spend / income. Tapping
  // it opens the LEO Stack (the bank lives at LEO).
  const aquaChip = host.querySelector('#aqua-chip');
  const aquaChipBal = host.querySelector('#aqua-chip-balance');
  if (aquaChipBal) {
    aquaChipBal.textContent = String(getAqua());
    let aquaAnimRaf = null;
    // Tween the displayed number toward the live balance instead of
    // snapping. A gain (sale / income) also pulses the chip green and
    // floats a "+N" so the money visibly goes up. Mid-flight changes
    // restart the tween from whatever is currently shown.
    const refreshAqua = () => {
      const target = getAqua();
      const shown = parseInt(aquaChipBal.textContent, 10);
      const from = Number.isFinite(shown) ? shown : target;
      if (from === target) { aquaChipBal.textContent = String(target); return; }
      const delta = target - from;
      if (delta > 0 && aquaChip) {
        aquaChip.classList.remove('aqua-gain');
        void aquaChip.offsetWidth; // restart the animation if re-fired
        aquaChip.classList.add('aqua-gain');
        spawnAquaGainFloat(aquaChip, delta);
      }
      const dur = Math.min(900, 250 + Math.abs(delta) * 60);
      const t0 = performance.now();
      if (aquaAnimRaf) cancelAnimationFrame(aquaAnimRaf);
      const step = (now) => {
        const p = Math.min(1, (now - t0) / dur);
        const e = 1 - Math.pow(1 - p, 3); // ease-out cubic
        aquaChipBal.textContent = String(Math.round(from + delta * e));
        if (p < 1) { aquaAnimRaf = requestAnimationFrame(step); }
        else { aquaChipBal.textContent = String(target); aquaAnimRaf = null; }
      };
      aquaAnimRaf = requestAnimationFrame(step);
    };
    onAquaChange(refreshAqua);
  }
  if (aquaChip) {
    aquaChip.style.cursor = 'pointer';
    onTap(aquaChip, () => openLeoStackModal());
  }
  const gearBtn = host.querySelector('#game-settings');
  if (gearBtn) onTap(gearBtn, () => openGameSettingsModal());
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
// Zone-painter assignments ({ nodeId: zone }) + the last-picked zone.
// Persisted so the labels survive reloads / map-mode toggles until
// the data is exported and the painter is cleared.
const STORAGE_ZONE_POLYGONS = 'hf-sandbox-zone-polygons'; // per-zone polygons
const STORAGE_ZONE_ACTIVE = 'hf-sandbox-zone-active';
// Zone-view config (config panel): show the canonical zone overlay,
// fill on/off, border opacity (1..100 %), and the painter edit mode.
const STORAGE_ZONE_VIZ     = 'hf-sandbox-zone-viz';
const STORAGE_ZONE_FILL    = 'hf-sandbox-zone-fill';
const STORAGE_ZONE_VIZ_OP  = 'hf-sandbox-zone-viz-opacity';
const STORAGE_ZONE_CURVED  = 'hf-sandbox-zone-curved';
const STORAGE_ZONE_EDIT     = 'hf-sandbox-zone-edit';
function persistDbg(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* private mode */ }
}
// Push the saved zone-view config into a (possibly freshly-built)
// renderer. Defaults: overlay on, fill on, 10% opacity, edit off.
function applyZoneViewConfig(renderer) {
  if (!renderer) return;
  renderer.setOption('visualizeZones', loadDbgBool(STORAGE_ZONE_VIZ, true));
  renderer.setOption('zoneFill', loadDbgBool(STORAGE_ZONE_FILL, true));
  renderer.setOption('zoneOpacity', loadDbgNumber(STORAGE_ZONE_VIZ_OP, 10, 1, 100) / 100);
  renderer.setOption('zoneCurved', loadDbgBool(STORAGE_ZONE_CURVED, true));
  renderer.setOption('zoneEditMode', loadDbgBool(STORAGE_ZONE_EDIT, false));
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

  wireZonePainter(renderer, panel);

  // Restore the persisted open / closed state for the debug
  // panel. wireDebugPanel runs every time the renderer is
  // rebuilt, so this also re-applies on mode toggles. If no
  // value was stored, we default to closed (the HTML class
  // already has .hidden in that case).
  const storedOpen = loadDbgBool(STORAGE_DBG_PANEL_OPEN, false);
  panel.classList.toggle('hidden', !storedOpen);
  const panelOpen = !panel.classList.contains('hidden');
  renderer.setOption('debug', panelOpen);

  const profBody = panel.querySelector('#dbg-prof-body');
  let lastZoom = -1, lastFps = -1, lastProfT = 0;
  renderer.onFrame(() => {
    const z = Math.round(renderer.getZoom() * 100) / 100;
    if (z !== lastZoom) { zoomEl.textContent = z.toFixed(2) + 'x'; lastZoom = z; }
    const f = renderer.getFps();
    if (f !== lastFps) { fpsEl.textContent = String(f); lastFps = f; }
    // Per-step frame breakdown. The snapshot only changes ~twice a
    // second (it's averaged over the fps window), so we rebuild the
    // rows on a throttle rather than every frame.
    if (profBody) {
      const now = performance.now();
      if (now - lastProfT > 300) {
        lastProfT = now;
        const p = renderer.getProfile();
        const keys = Object.keys(p);
        if (!keys.length) {
          profBody.textContent = '- pan or zoom the map -';
        } else {
          const frame = p.frame || 0;
          const rows = keys.filter((k) => k !== 'frame').sort((a, b) => p[b] - p[a]);
          let html = `<div class="dbg-prof-row dbg-prof-total"><span>frame</span><b>${frame.toFixed(2)}</b></div>`;
          for (const k of rows) {
            html += `<div class="dbg-prof-row"><span>${k}</span><b>${p[k].toFixed(2)}</b></div>`;
          }
          profBody.innerHTML = html;
        }
      }
    }
  });
}

// Debug zone painter: a dropdown + lasso tool for hand-labelling the
// solar zone of waypoint nodes (burns / lagranges / hohmanns), which
// the planner data doesn't carry. Pick a zone, click the map to drop
// polygon vertices, Finish to stamp every node inside, then Export to
// dump the accumulated id2 -> zone map to the console for wiring into
// planner-map.js. Real (named) sites are never touched.
function wireZonePainter(renderer, panel) {
  const select   = panel.querySelector('#dbg-zone-select');
  const clearZoneBtn = panel.querySelector('#dbg-zone-clearzone');
  const undoBtn   = panel.querySelector('#dbg-zone-undo');
  const clearBtn  = panel.querySelector('#dbg-zone-clear');
  const exportBtn = panel.querySelector('#dbg-zone-export');
  const countEl   = panel.querySelector('#dbg-zone-count');
  // Zone edit mode reveals the live painter overlay (off = editor data
  // hidden, tools still present). Persisted + applied to the renderer.
  const editCb = panel.querySelector('#dbg-zone-edit');
  if (editCb) {
    editCb.checked = loadDbgBool(STORAGE_ZONE_EDIT, false);
    renderer.setOption('zoneEditMode', editCb.checked);
    editCb.onchange = () => {
      persistDbg(STORAGE_ZONE_EDIT, editCb.checked ? '1' : '0');
      renderer.setOption('zoneEditMode', editCb.checked);
    };
  }
  if (!select || !clearZoneBtn) return;

  // Populate the dropdown + hand the per-zone palette to the renderer
  // so the overlay paints in the published zone colours.
  if (select.options.length <= 1) {
    for (const z of SOLAR_ZONES) {
      const opt = document.createElement('option');
      opt.value = z;
      opt.textContent = z;
      select.appendChild(opt);
    }
  }
  const colors = {};
  for (const z of SOLAR_ZONES) colors[z] = (SOLAR_ZONE_INFO[z] || {}).color || '#22d3ee';
  renderer.setZonePaintColors(colors);
  // Zones nest inner -> outer (SOLAR_ZONES is Mercury..Neptune), so a
  // node is labelled by the innermost polygon containing it. Set the
  // order BEFORE restoring polygons (restore re-derives assignments).
  renderer.setZoneOrder(SOLAR_ZONES);

  // Persist the per-zone polygons (the source data) + the picked
  // zone. Node assignments are NOT persisted - they're derived from
  // the polygons on load.
  const saveAll = () => {
    try {
      const polys = renderer.getZonePolygons();
      if (polys.length) localStorage.setItem(STORAGE_ZONE_POLYGONS, JSON.stringify(polys));
      else localStorage.removeItem(STORAGE_ZONE_POLYGONS);
      if (select.value) localStorage.setItem(STORAGE_ZONE_ACTIVE, select.value);
      else localStorage.removeItem(STORAGE_ZONE_ACTIVE);
    } catch { /* private mode */ }
  };

  // Restore prior work into this (possibly freshly-rebuilt) renderer
  // BEFORE wiring the change handler so the restore doesn't re-save.
  try {
    const rawPolys = localStorage.getItem(STORAGE_ZONE_POLYGONS);
    if (rawPolys) {
      renderer.setZonePolygons(JSON.parse(rawPolys));
    } else {
      // No local scratch yet - seed the painter from the canonical
      // zone data so edits continue from the source of truth.
      const seed = [];
      for (const z in ZONE_POLYGONS) {
        const arr = ZONE_POLYGONS[z];
        if (arr && arr[0] && arr[0].length) seed.push({ zone: z, points: arr[0] });
      }
      renderer.setZonePolygons(seed);
    }
    const savedZone = localStorage.getItem(STORAGE_ZONE_ACTIVE);
    if (savedZone && SOLAR_ZONES.includes(savedZone)) {
      select.value = savedZone;
      renderer.setZonePaintZone(savedZone);
    }
  } catch { /* corrupt / private mode */ }

  const refreshCount = () => {
    if (countEl) {
      const np = renderer.zonePolygonCount();
      const nn = renderer.zoneAssignmentCount();
      countEl.textContent = `${np} poly · ${nn} nodes`;
    }
  };
  refreshCount();

  // Every future edit (add / move / undo a point, switch / clear a
  // zone) funnels through this handler to persist + refresh the count.
  renderer.setZonePaintChangeHandler(() => { saveAll(); refreshCount(); });

  select.onchange = () => {
    renderer.setZonePaintZone(select.value || null); // emits -> saveAll
  };
  clearZoneBtn.onclick = () => renderer.clearActiveZonePolygon(); // emits
  undoBtn.onclick = () => renderer.undoZonePolyPoint();           // emits
  clearBtn.onclick = () => renderer.clearZoneAssignments();       // emits
  exportBtn.onclick = () => {
    // Polygons are the source data the user uploads; assignments are
    // derived (point-in-polygon) and emitted as a convenience.
    const polygons = renderer.getZonePolygons();
    const byZonePolys = {};
    for (const p of polygons) (byZonePolys[p.zone] = byZonePolys[p.zone] || []).push(p.points);
    const records = renderer.getZoneAssignments();
    const byRef = {};
    for (const r of records) byRef[r.id2] = r.zone;
    /* eslint-disable no-console */
    console.log(`[zone painter] ${polygons.length} polygon(s); ${records.length} derived node(s)`);
    console.log('[zone painter] POLYGONS by zone (copy below - this is the data):');
    console.log(JSON.stringify(byZonePolys));
    console.log('[zone painter] derived id2 -> zone map (convenience):');
    console.log(JSON.stringify(byRef, null, 2));
    /* eslint-enable no-console */
  };
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
  const closeBtn = host.querySelector('#map-search-close');
  const backdrop = host.querySelector('#map-search-backdrop');
  const searchEl = host.querySelector('.map-search');
  if (!input || !goBtn || !list) return;
  let activeIndex = -1;
  let currentItems = [];

  // Search is a fixed-position modal on every viewport, opened by the
  // 🔍 button in the sidepanel tab strip (via _openMapSearch). CSS
  // hides .map-search until .is-open is set, then shows it as a
  // centered card with a dimmed backdrop.
  function openSearchModal() {
    searchEl?.classList.add('is-open');
    backdrop?.classList.remove('hidden');
    // Defer focus so the keyboard pops AFTER layout settles.
    setTimeout(() => { input.focus(); input.select(); }, 0);
  }
  function closeSearchModal() {
    searchEl?.classList.remove('is-open');
    backdrop?.classList.add('hidden');
    list.classList.add('hidden');
  }
  // Expose the opener for the sidepanel 🔍 tab button.
  _openMapSearch = openSearchModal;
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
    // A move that was mid-hazard-resolution when the tab closed gets
    // resumed (per-roll) if its saved state still resolves, else
    // rolled back so the turn isn't wasted. Rollback only touches
    // state, so it runs now (before the renderer reads position);
    // the actual resume animates + opens modals, so it fires AFTER
    // the renderer + route are restored (see _resumeMoveCtx below).
    const _savedMove = loadMoveProgress();
    let _resumeMoveCtx = null;
    if (_savedMove) {
      if (canResumeMove(_savedMove)) _resumeMoveCtx = _savedMove;
      else rollbackMove(_savedMove);
    }
    _renderer = new MapRenderer(canvas, {
      data: _activeData,
      onSelect: onSiteSelect,
    });
    _renderer.onSandboxRocketClick = () => openRocketStackModal();
    wireDebugPanel(_renderer);
    wireMapInsets(_renderer);
    // Hand the canonical zone polygons + palette to the renderer so
    // the "visualize zone data" config option can draw them behind
    // the map, then apply the player's saved zone-view config.
    const zoneColors = {};
    for (const z of SOLAR_ZONES) zoneColors[z] = (SOLAR_ZONE_INFO[z] || {}).color || '#22d3ee';
    _renderer.setCanonicalZones({ polys: ZONE_POLYGONS, colors: zoneColors, order: SOLAR_ZONES });
    applyZoneViewConfig(_renderer);
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
          // Actual burns = sum of the planner's per-segment burns
          // (coast/Hohmann hops are 0). NOT a per-segment fallback
          // of 1, which counted every coast hop as a burn (e.g. a
          // resumed Hohmann showing "23 burns" instead of 4).
          const burns = _plannedRoute.reduce((s, x) => s + (Number(x.burns) || 0), 0);
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
    // Resume an interrupted hazard queue now that the renderer +
    // route + trail are live. Fire-and-forget: it animates and opens
    // the roll modals for the remaining hazards. If it throws, fall
    // back to rolling the move back so the turn isn't lost.
    if (_resumeMoveCtx) {
      runMoveQueue(_resumeMoveCtx, true).catch((e) => {
        // eslint-disable-next-line no-console
        console.error('move resume failed:', e);
        rollbackMove(_resumeMoveCtx);
        syncSandboxRocket();
      });
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
    const totals = getStackTotals();
    const thrStats = getActiveThrusterStats();
    // Preserve the scroll position across the rebuild so tapping
    // a button / card in the stack never jumps the list to the
    // top.
    const prevBody = panel.querySelector('.rocket-stack-body');
    const prevScroll = prevBody ? prevBody.scrollTop : 0;
    prevBody?.remove();
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
    // Fuel/burn cell shows "N FT (B burns)" with the fuel-strip math
    // underneath. B is counted along the net-thrust ladder (fuel steps
    // from wet to dry / fuel-per-burn), NOT tank ÷ fuel - a lighter ship
    // squeezes more burns out of the same water.
    const hasBurns = !!(thrStats && thrStats.fuel != null && thrStats.burnsAvailable != null);
    const burnsLabel = hasBurns
      ? `${thrStats.burnsAvailable} burn${thrStats.burnsAvailable === 1 ? '' : 's'}` : '';
    const fuelValHtml = (thrStats && thrStats.fuel != null)
      ? `${fmt(thrStats.fuel)} FT${hasBurns ? ` <span class="muted">(${burnsLabel})</span>` : ''}`
      : '-';
    const fuelStepEqn = hasBurns
      ? `${thrStats.fuelSteps}/${fmt(thrStats.fuel)} FT steps = ${burnsLabel}`
      : fuelEqn;
    const fuelTip = hasBurns
      ? `Each burn spends ${fmt(thrStats.fuel)} fuel steps; from wet ${totals.wetMass} to dry ${totals.dryMass} the strip has ${thrStats.fuelSteps} steps, so ${burnsLabel} (leftover steps can't finish another).`
      : (thrStats && thrStats.fuel != null ? `Fuel per burn = ${fmt(thrStats.fuel)} water per move.` : '');
    const thrustHtml = thrStats
      ? `<div class="rocket-totals-cell"
              data-tip="Thrust = base ${fmt(thrStats.baseThrust)} ${modifierLines ? '+ ' + modifierLines : ''}. Net thrust must be ≥ wet mass to lift."
              title="Modified thrust breakdown">
           <span class="lbl">Thrust</span>
           <strong class="${thrStats.canLift ? 'ok' : 'bad'}">${fmt(thrStats.thrust)}</strong>
           <small class="cell-eqn">${esc(thrustEqn)}</small>
         </div>
         <div class="rocket-totals-cell"
              data-tip="${esc(fuelTip)}"
              title="Fuel per burn">
           <span class="lbl">Fuel / burn</span>
           <strong>${fuelValHtml}</strong>
           <small class="cell-eqn">${esc(fuelStepEqn)}</small>
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
        activate.addEventListener('click', () => onSetActiveThrusterClick(slot.id));
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
        btn.addEventListener('click', () => onSetActiveProspectorClick(slot.id));
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
          // Online: route through the server (DECOMMISSION) so the hand
          // actually gains the card; the snapshot re-hydrates the stacks.
          if (_online) { submitOnlineOp({ kind: 'DECOMMISSION', cardId: slot.id, from: 'rocket' }); return; }
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
    // Carried glory chits ride in the stack like cards. They're
    // two-sided in transit: a crew aboard flips them to the BACK
    // value at home; if the last crew leaves they flip face-up to
    // the FRONT value. Flag them when no crew is aboard to carry them.
    const carriedChits = getChits();
    if (carriedChits.length) {
      const present = new Set(stack.filter(isCrewSlot).map((s) => s.id));
      for (const c of carriedChits) {
        const tok = buildChitToken(c.zone, { transit: true, crewId: c.crewId });
        // Dim a chit whose owning crew is no longer aboard (it will
        // score its front value): owned + owner gone, or ownerless
        // with no crew at all.
        const ownerGone = c.crewId ? !present.has(c.crewId) : present.size === 0;
        if (ownerGone) tok.classList.add('chit-no-crew');
        othersHost.appendChild(tok);
      }
    }
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
            <div class="stack-inspector-selrow">
              <button type="button" class="modal-btn stack-selall">Select all</button>
              <button type="button" class="modal-btn stack-deselall">Deselect all</button>
            </div>
            <div class="stack-inspector-xfer-row">${dh}</div>
          </div>`;
        const selAll = xferHost.querySelector('.stack-selall');
        const deselAll = xferHost.querySelector('.stack-deselall');
        if (selAll) selAll.addEventListener('click', () => {
          for (const s of stack) selected.add(s.id);
          repaint();
        });
        if (deselAll) deselAll.addEventListener('click', () => {
          selected.clear();
          repaint();
        });
        xferHost.querySelectorAll('.stack-inspector-xfer-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            const destId = btn.getAttribute('data-dest');
            if (!destId || selected.size === 0) return;
            // Online: one batch op for all selected cards.
            if (transferSelectedOnline('rocket', destId, [...selected])) {
              selected.clear();
              return;
            }
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
// forces a survival roll. Per the rulebook only two kinds are
// payable (4 aqua bypass): the ☠ skull and the 🪂 aerobrake. The
// ☢ radiation hazard rolls but CANNOT be paid for. Flyby /
// gravity-assist lagrange points are NOT hazards even when the
// planner JSON flags them `hazard:true`, so they're excluded here.
//   - radhaz waypoint type → ☢ radiation (roll only, unpayable)
//   - venus waypoint type  → 🪂 aerobrake corridor (payable)
//   - hazard-flagged burn  → ☠ skull (payable)
// Returns the glyph + a short label so the confirm modal can list
// what the player is about to fly through.
const HAZARD_COST_PER = 4;
function classifyHazard(site) {
  if (!site) return null;
  if (site.type === 'radhaz') return { glyph: '☢', label: 'Radiation hazard' };
  if (site.type === 'venus')  return { glyph: '🪂', label: 'Aerobrake corridor' };
  // Skull hazards live on hazard-flagged burn spaces. Lagrange
  // (flyby / gravity-assist) nodes are flybys, not hazards, even
  // when the planner flags them.
  if (site.hazard && site.type !== 'lagrange') return { glyph: '☠', label: 'Hazard node' };
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

// Factory-assist confirm. Surfaces when a land / liftoff maneuver is
// under-thrust (net thrust <= site size) but a factory at the site
// can carry it. Each such maneuver is a hazard roll; the player may
// pay FINAO (aqua, like the hazard bypass) to guarantee them all,
// roll the dice (a 1 destroys the rocket), or cancel. Colony-waived
// maneuvers never reach this modal. Resolves 'pay' | 'roll' | 'cancel'.
function factoryAssistModal(maneuvers, netThrust) {
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
    const onKey = (e) => { if (e.key === 'Escape') close('cancel'); };
    document.addEventListener('keydown', onKey);

    const n = maneuvers.length;
    const cost = n * HAZARD_COST_PER;
    const have = getAqua();
    const canPay = have >= cost;
    const list = maneuvers.map((m) =>
      `<li><span class="haz-glyph">🏭</span> `
      + `${esc(m.kind === 'liftoff' ? 'Lift off from' : 'Land on')} `
      + `<strong>${esc(m.site.name || m.site.id)}</strong> `
      + `<em class="muted">net thrust ${netThrust} ≤ size ${m.size}</em></li>`
    ).join('');

    const panel = document.createElement('div');
    panel.className = 'turn-confirm-panel hazard-confirm-panel';
    panel.innerHTML = `
      <h3>🏭 Factory assist required</h3>
      <p>Your thrust can't manage ${n === 1 ? 'this maneuver' : 'these maneuvers'} alone,
        but a factory can carry ${n === 1 ? 'it' : 'them'} as a hazard roll:</p>
      <ul class="hazard-list">${list}</ul>
      <p class="hazard-warning">
        <strong>Whatever you pick, this move CANNOT be undone.</strong>
        End the turn to clear the lockout.
      </p>
      <div class="hazard-cost-row">
        <span>💎 Aqua balance: <strong>${have}</strong></span>
        <span>FINAO cost: <strong>${cost}</strong>
          <em class="muted">(${HAZARD_COST_PER}/assist)</em></span>
      </div>
      <div class="turn-confirm-actions hazard-actions">
        <button type="button" class="popup-btn primary" data-act="pay"
          ${canPay ? '' : 'disabled'}
          title="${canPay ? 'Spend ' + cost + ' aqua (FINAO) to guarantee the assist' : 'Not enough aqua for FINAO'}">
          💎 Pay ${cost} aqua (FINAO)
        </button>
        <button type="button" class="popup-btn" data-act="roll"
          title="Roll a d6 for each assist. 1 destroys the rocket. Cannot be undone.">
          🎲 Roll ${n} d6 (1 = boom, no undo)
        </button>
        <button type="button" class="popup-btn" data-act="cancel"
          title="Return to planning; no move spent">
          ✕ Cancel move
        </button>
      </div>
      ${canPay ? '' : '<p class="muted hazard-need-aqua">FINAO disabled - need '
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
// Highest face of the rad die. The worst a single zone can throw is a 6
// (plus the red-season bonus), so a card is "at risk" of being lost when
// its rad-hard plus the active thruster's FINAL thrust can't clear that
// worst case: radHard + thrust < MAX_RAD_DIE + seasonBonus.
const MAX_RAD_DIE = 6;
function radBypassThreshold() {
  let season = null;
  try { season = getSeason(); } catch { season = null; }
  return season && season.name === 'red' ? RAD_BYPASS_THRUST_RED : RAD_BYPASS_THRUST;
}

// Resolve the current rocket stack into [{id, name, radHardness}] rows for
// the rad-hardness check - used both by the upfront at-risk preview in the
// confirm modal and by the per-zone roll modal. Patents read rad-hard off
// the card; crew read name + rad-hard off the chosen FACE (they live on the
// face, not the physical card), so a flipped crew row is never blank.
function radStackCards() {
  return getRocketStack()
    .map((slot) => {
      const patent = PATENTS_BY_ID[slot.id];
      if (patent) {
        return { id: slot.id, name: patent.name, radHardness: patent.radHardness != null ? patent.radHardness : 0 };
      }
      const crew = CREW_BY_ID[slot.id];
      if (crew) {
        const f = crew.faces[slot.face === 'secondary' ? 'secondary' : 'primary'] || crew.faces.primary || {};
        return { id: slot.id, name: f.name || crew.id, radHardness: f.radHardness != null ? f.radHardness : 0 };
      }
      return null;
    })
    .filter(Boolean);
}

// Cards from `stackCards` that could be decommissioned on the worst roll of
// a single zone (d6 = 6): rad-hard < MAX_RAD_DIE + seasonBonus - thrust.
// `thrust` is the active thruster's final modified thrust; clamping the
// worst rad at 0 means a stack that out-thrusts the die returns [].
function radAtRiskCards(stackCards, thrust, seasonBonus) {
  const worstRad = Math.max(0, MAX_RAD_DIE + (seasonBonus | 0) - Math.max(0, thrust | 0));
  if (worstRad <= 0) return [];
  return (stackCards || [])
    .filter((c) => (c.radHardness || 0) < worstRad)
    .sort((a, b) => (a.radHardness || 0) - (b.radHardness || 0));
}

// Pre-roll confirm dialog for rad zones. Mirrors the
// hazardConfirmModal idiom (list of zones, scary warning,
// pick-an-action buttons) but tailored to the rad rules: no
// aqua bypass option, and the body explains the thrust + season
// math + whether the active thruster auto-clears the bar.
// Resolves to 'confirm' or 'cancel'. Always shown when the
// route crosses ≥1 rad zone so the player can back out before
// the dice roll.
function radConfirmModal(radHazards, thrust, seasonBonus, bypassThreshold, stackCards) {
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

    // Up-front "what could I lose" list. A card is at risk when its
    // rad-hard plus the final thrust can't clear the worst die (a 6, plus
    // the red-season bonus). Only meaningful when the stack actually rolls;
    // a bypassing rocket loses nothing, so the list is skipped there.
    let atRiskNote = '';
    if (!willBypass) {
      const atRisk = radAtRiskCards(stackCards, thrust, seasonBonus);
      // Right-hand side of the at-risk test: a card is lost when its
      // rad-hard + thrust can't reach the worst die (6) plus the season bonus.
      const riskThreshold = MAX_RAD_DIE + (seasonBonus | 0);
      if (atRisk.length) {
        const items = atRisk.map((c) =>
          `<li><span class="rad-atrisk-name">${esc(c.name)}</span>`
          + `<span class="rad-atrisk-rh">rad-hard ${c.radHardness || 0}</span></li>`
        ).join('');
        atRiskNote = `
          <div class="rad-confirm-atrisk">
            <p class="rad-confirm-atrisk-head">
              ⚠ At risk on the worst roll
              <span class="muted">(rad-hard + thrust ${thrust || 0}
              &lt; ${riskThreshold})</span>:
            </p>
            <ul class="rad-confirm-atrisk-list">${items}</ul>
          </div>`;
      } else if (Array.isArray(stackCards) && stackCards.length) {
        atRiskNote = `
          <p class="rad-confirm-atrisk-safe">
            ✓ No cards at risk - every card clears even a ${MAX_RAD_DIE}.
          </p>`;
      }
    }

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
      ${atRiskNote}
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

// The site's "size" - the integer printed in the board hexagon
// (the leading digit of siteSize, e.g. "9H" -> 9). Used by the
// land / liftoff thrust gate: a rocket needs net thrust strictly
// greater than this to settle onto or climb off the site. Orbital
// waypoints (LEO + lagranges) have no siteSize, so they return 0
// and are always free to enter / leave.
function siteSizeNumber(site) {
  if (!site) return 0;
  const ss = site.siteSize;
  if (typeof ss === 'string') {
    const m = ss.match(/^(\d+)/);
    if (m) return Math.max(0, parseInt(m[1], 10));
  }
  if (typeof ss === 'number' && Number.isFinite(ss)) return Math.max(0, ss | 0);
  return 0;
}

// Land / liftoff gate for a single site given the rocket's current
// net (band-adjusted) thrust. The rule: net thrust must strictly
// exceed the site's size to settle onto or climb off it. When it
// doesn't, a FACTORY at the site permits the maneuver anyway as a
// "factory assist" - a hazard roll. A COLONY at the site waives the
// roll. Returns:
//   ok        - the maneuver is allowed (true unless under-thrust
//               with no factory to assist)
//   assist    - true when a factory is carrying the maneuver
//   needsRoll - true when the assist still requires a hazard roll
//               (i.e. no colony to waive it)
//   size      - the site size used for the comparison
function maneuverGate(site, netThrust) {
  const size = siteSizeNumber(site);
  if (size <= 0 || netThrust > size) {
    return { ok: true, assist: false, needsRoll: false, size };
  }
  // Rule exception: a size-1 site can always be landed on or lifted
  // off by any rocket with an operational thruster. Operational means
  // thrust > 0 (netThrust is the active thruster's net thrust) AND
  // its supports satisfied (isRocketActive().active). No factory
  // assist or roll required.
  if (size === 1 && netThrust > 0 && isRocketActive().active) {
    return { ok: true, assist: false, needsRoll: false, size };
  }
  const factory = site && getFactory(site.id);
  if (!factory) return { ok: false, assist: false, needsRoll: false, size };
  const colony = getColony(site.id);
  return { ok: true, assist: true, needsRoll: !colony, size };
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
// Site Refuel (I5a) uses ONLY the active prospector's ISRU rig.
// A REFINERY card is just a build part for a Factory - it is NOT
// a refuel source. The flat +7 refuel is Factory-only (I5b), and
// requires a built factory at the site.
function pickRefiningSource(site) {
  const water = Number.isFinite(site.hydration) ? site.hydration : 0;
  // ISRU rig path: the active prospector with an ISRU rating (0 or
  // more), supports met, and ISRU <= site hydration so the
  // 1 + hydration - ISRU formula gives at least 1 water.
  const prosp = getActiveProspectorStats();
  if (prosp && prosp.canActivate) {
    const isru = prospectorIsruValue(prosp.card);
    // ISRU 0 is a valid rig (gain = 1 + water), so it refuels anywhere the
    // gate ISRU <= water allows - which for 0 is every site.
    if (isru >= 0 && isru <= water) {
      return { kind: 'isru', card: prosp.card, rawGain: 1 + water - isru, isru };
    }
  }
  return null;
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
      reason: 'Need an active ISRU prospector with ISRU ≤ site water (a Factory gives the +7 refuel instead).',
    };
  }
  if (hasRefueledThisTurn(site.id)) {
    return { ok: false, label: `💧 Refueled this turn`, reason: 'Already refined here this turn. End turn to refresh.' };
  }
  const gain = Math.min(source.rawGain, tmax - tank);
  return { ok: true, label: `💧 Refuel (+${gain} via ISRU)`, reason: null, source };
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
  const detail = `1 + water ${water} - ISRU ${source.isru} = ${source.rawGain} via <em>${esc(sourceName)}</em>`;
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
  // Online: the server parks the stack as an outpost (it picks the slot)
  // and recalls the rocket. Confirm, submit, let the snapshot re-hydrate.
  if (_online) {
    const ok = await confirmModal({
      title: `🚀→🏛 Convert Rocket to Outpost at ${site.name}`,
      body: `<p>${stack.length} card${stack.length === 1 ? '' : 's'} + ${tank} water will park as a new outpost here; your rocket returns to LEO empty.</p>`,
      yes: '🚀→🏛 Convert', no: 'Cancel',
    });
    if (!ok) return;
    await submitOnlineOp({ kind: 'CONVERT_OUTPOST' });
    return;
  }
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


// Pump water from a colocated outpost into the rocket tank. Prompts for
// an amount (capped by the outpost's water + the rocket's tank room),
// then routes through the server (TRANSFER_FUEL) online or mutates the
// local stacks in solo.
async function doPumpOutpostFuel(letter, max) {
  if (max <= 0) return;
  const amount = await pickFuelAmount({
    title: `💧 Pump fuel from Outpost ${letter}`,
    max,
  });
  if (!amount) return;
  if (_online) {
    await submitOnlineOp({ kind: 'TRANSFER_FUEL', letter, amount });
    return;
  }
  const op = getOutpost(letter);
  if (!op) return;
  const amt = Math.min(amount, op.tank | 0, max);
  if (amt <= 0) return;
  setOutpostTank(letter, (op.tank | 0) - amt);
  addFuel(amt);
  setStatus(`💧 Pumped ${amt} water from Outpost ${letter} into the rocket.`);
}

// Footer button for the outpost inspector: pump the outpost's water into
// a colocated rocket. Empty string when not applicable (not an outpost,
// no rocket here, no water, or no tank room).
function outpostPumpBtnHtml(stackId) {
  if (!stackId.startsWith('outpost')) return '';
  const letter = stackId.slice('outpost'.length);
  const op = getOutpost(letter);
  if (!op || (op.tank | 0) <= 0) return '';
  const rs = getRocketSite();
  if (!rs || rs.id !== op.siteId || getRocketStack().length === 0) return '';
  const totals = getStackTotals();
  const room = Math.max(0, getTankMax() - (totals.dryMass || 0) - getTankWater());
  const max = Math.min(op.tank | 0, room);
  const disabled = max <= 0 ? 'disabled' : '';
  const title = max > 0 ? `Pump up to ${max} water into the rocket` : 'Rocket tank is full';
  return `<button type="button" class="modal-btn stack stack-pump-fuel" data-letter="${esc(letter)}" data-max="${max}" ${disabled} title="${title}">💧 Pump ${max > 0 ? max + ' ' : ''}→ rocket</button>`;
}

// Pump buttons for the ROCKET fuel-tank modal: one per colocated outpost
// that holds water (when the rocket has tank room). This is where players
// look to fill the rocket, so the outpost-water source surfaces here too.
function fuelTankPumpBtns() {
  const rs = getRocketSite();
  if (!rs || getRocketStack().length === 0) return '';
  const totals = getStackTotals();
  const room = Math.max(0, getTankMax() - (totals.dryMass || 0) - getTankWater());
  if (room <= 0) return '';
  let html = '';
  for (const letter of OUTPOST_LETTERS) {
    const op = getOutpost(letter);
    if (!op || op.siteId !== rs.id || (op.tank | 0) <= 0) continue;
    const max = Math.min(op.tank | 0, room);
    html += `<button type="button" class="popup-btn fuel-pump-from" data-letter="${esc(letter)}" data-max="${max}" title="Pump up to ${max} water from Outpost ${esc(letter)} into the rocket">💧⤒ Pump from Outpost ${esc(letter)} (${op.tank})</button>`;
  }
  return html;
}

// Footer button for an EMPTY outpost: decommission (dissolve) it to free
// the slot. Empty string when the outpost still holds cards.
function outpostDissolveBtnHtml(stackId) {
  if (!stackId.startsWith('outpost')) return '';
  const letter = stackId.slice('outpost'.length);
  const op = getOutpost(letter);
  if (!op || (op.cards && op.cards.length > 0)) return '';
  const waterNote = (op.tank | 0) > 0 ? ` (forfeits ${op.tank} water)` : '';
  return `<button type="button" class="modal-btn decommission stack-dissolve-outpost" data-letter="${esc(letter)}" title="Decommission this empty outpost and free the slot${waterNote}">🗑 Decommission outpost</button>`;
}

// Minimal amount-picker modal (stepper + "All"). Resolves to a positive
// integer or null on cancel.
function pickFuelAmount({ title = '💧 Transfer water', max = 1 } = {}) {
  return new Promise((resolve) => {
    document.querySelector('.fuel-amount-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'card-modal-overlay confirm-modal-overlay fuel-amount-overlay';
    let amount = Math.min(1, max);
    const close = (val) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
    const onKey = (e) => { if (e.key === 'Escape') close(null); else if (e.key === 'Enter') close(amount); };
    document.addEventListener('keydown', onKey);
    const panel = document.createElement('div');
    panel.className = 'turn-confirm-panel';
    panel.innerHTML = `
      <h3>${esc(title)}</h3>
      <div class="dump-stepper">
        <button type="button" class="popup-btn popup-btn-secondary fa-step" data-step="-1" aria-label="Less">−</button>
        <input type="number" class="fa-amount" min="1" max="${max}" value="${amount}" inputmode="numeric" aria-label="Water to transfer" />
        <button type="button" class="popup-btn popup-btn-secondary fa-step" data-step="1" aria-label="More">+</button>
        <button type="button" class="popup-btn fa-all" title="Transfer the maximum">All (${max})</button>
      </div>
      <div class="turn-confirm-actions">
        <button type="button" class="popup-btn primary" data-act="yes">💧 Transfer <span class="fa-n">${amount}</span></button>
        <button type="button" class="popup-btn" data-act="no">Cancel</button>
      </div>
    `;
    const input = panel.querySelector('.fa-amount');
    const nLabel = panel.querySelector('.fa-n');
    const clamp = (v) => Math.max(1, Math.min(max, Math.round(Number(v)) || 1));
    const set = (v) => { amount = clamp(v); input.value = String(amount); nLabel.textContent = String(amount); };
    panel.querySelectorAll('.fa-step').forEach((b) => b.addEventListener('click', () => set(amount + Number(b.dataset.step))));
    panel.querySelector('.fa-all').addEventListener('click', () => set(max));
    input.addEventListener('input', () => set(input.value));
    panel.querySelector('[data-act="yes"]').addEventListener('click', () => close(amount));
    panel.querySelector('[data-act="no"]').addEventListener('click', () => close(null));
    overlay.appendChild(panel);
    mountOverlay(overlay);
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
    <h4 class="ops-menu-head">At a site (1 op) - prospect · refuel · industrialize · ET produce</h4>
    <div class="ops-menu-list" id="ops-menu-sites"></div>
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

  // Site-op shortcuts: sites where a site-op is possible (your
  // factories - refuel / ET / colonize; claimed discs without a
  // factory - industrialize). Each flies the map there and opens
  // the site popup, where the actual op buttons live.
  const sitesHost = panel.querySelector('#ops-menu-sites');
  const siteById = (id) => (_activeData && (_activeData.byId?.[id] || _activeData.sites.find((s) => s.id === id))) || null;
  const opSites = [];
  const seen = new Set();
  for (const f of (allFactories() || [])) {
    if (f.ownerId !== SANDBOX_OWNER_ID || seen.has(f.siteId)) continue;
    const site = siteById(f.siteId); if (!site) continue;
    seen.add(f.siteId);
    opSites.push({ site, hint: `🏭 factory${getColony(f.siteId) ? ' + 🌐' : ''} · refuel / ET / colonize` });
  }
  // getDiscs() is a { siteId: disc } map, not an array.
  const discs = getDiscs() || {};
  for (const siteId of Object.keys(discs)) {
    const d = discs[siteId];
    if (!d || d.outcome !== 'success' || seen.has(siteId) || getFactory(siteId)) continue;
    const site = siteById(siteId); if (!site) continue;
    seen.add(siteId);
    opSites.push({ site, hint: '🔭 claimed · industrialize here' });
  }
  if (sitesHost) {
    if (!opSites.length) {
      sitesHost.innerHTML = '<p class="muted ops-menu-emptyhint">No site-ops yet. Prospect (roll) at the rocket\'s site to claim it, then industrialize there. Refuel needs water + a rig/factory.</p>';
    } else {
      for (const { site, hint } of opSites) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ops-menu-op ops-menu-site modal-btn stack';
        b.innerHTML = `📍 ${esc(site.name)} <span class="ops-site-hint">${esc(hint)}</span>`;
        b.title = `Fly to ${site.name} and open its site actions`;
        b.addEventListener('click', () => {
          close();
          if (_renderer && typeof _renderer.flyTo === 'function') _renderer.flyTo(site, locateZoom(4));
          showSitePopupFor(site);
        });
        sitesHost.appendChild(b);
      }
    }
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
    renderCardFn: renderCard,
    onCommit: ({ cardId }) => {
      if (!cardId) return;
      // Online: Free Market is the server FREE_MARKET op (sells the
      // card, credits aqua, spends the op). Submit + re-hydrate; skip
      // the local mutation that never persisted.
      if (_online) { submitOnlineOp({ kind: 'FREE_MARKET', cardId }); return; }
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
      // Suppress per-crew reconciliation across the mutation dance:
      // we remove the crew, and roll it back on failure. Colonise
      // resolves the crew's own chits explicitly on success below.
      _suppressChitReconcile = true;
      try {
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
      // The colonising crew leaves the rocket: ITS glory chits flip
      // face-up to their FRONT value (published rule: front = crew
      // colonised or died). Chits owned by other crews still aboard
      // stay carried and can still be brought home for the back value.
      const frontRes = resolveChitsForCrew(pick.id, 'front', `${crewName} colonised ${site.name}`);
      if (frontRes.vps) {
        logAction({
          type: 'glory_front',
          icon: '🎖',
          summary: `${frontRes.chits.length} glory chit${frontRes.chits.length === 1 ? '' : 's'} flipped face-up `
            + `for ${frontRes.vps} VP (${crewName} colonised instead of returning home)`,
          undoable: false,
        });
      }
      } finally {
        _suppressChitReconcile = false;
      }
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

// Stepper modal for dumping water. The player dials in how much to
// drain (1..max) with the +/- steppers, types a value directly, or
// taps "All" to jump to the full tank, then confirms. Resolves to
// the chosen amount, or null if cancelled. Dumped water is destroyed
// for now (Stage 3+ turns this into an outpost-stack drop).
function openDumpWaterModal(maxWater) {
  return new Promise((resolve) => {
    const max = Math.max(0, maxWater | 0);
    if (max <= 0) { resolve(null); return; }
    document.querySelector('.dump-water-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'card-modal-overlay confirm-modal-overlay dump-water-overlay';
    // Current wet mass drives the preview: dumping water lowers the
    // wet mass, which can drop the rocket into a lighter weight class
    // with a better net-thrust modifier.
    const totals = getStackTotals();
    const curWet = Math.max(0, totals.wetMass | 0);
    const tankCap = getTankMax();
    let amount = Math.min(1, max);
    const close = (val) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
    const onKey = (e) => {
      if (e.key === 'Escape') close(null);
      else if (e.key === 'Enter') close(amount);
    };
    document.addEventListener('keydown', onKey);
    const panel = document.createElement('div');
    panel.className = 'turn-confirm-panel dump-water-panel';
    panel.innerHTML = `
      <h3>💧⤓ Dump water</h3>
      <p class="muted">Drain water from the rocket tank. Dumped water is
      destroyed for now (Stage 3+ turns this into an outpost-stack drop
      once factories land).</p>
      <div class="dump-stepper">
        <button type="button" class="popup-btn popup-btn-secondary dump-step" data-step="-1" aria-label="Dump one less">−</button>
        <input type="number" class="dump-amount" min="1" max="${max}" value="${amount}" inputmode="numeric" aria-label="Water to dump" />
        <button type="button" class="popup-btn popup-btn-secondary dump-step" data-step="1" aria-label="Dump one more">+</button>
        <button type="button" class="popup-btn dump-all" title="Dump the entire tank">All (${max})</button>
      </div>
      <div class="dump-preview">
        <span class="dump-preview-mass">Wet mass <strong>${curWet}</strong> →
          <strong class="dump-after-wet">${curWet}</strong><small>/${tankCap}</small></span>
        <span class="dump-preview-class"></span>
      </div>
      <div class="turn-confirm-actions">
        <button type="button" class="popup-btn primary" data-act="yes">💧⤓ Dump <span class="dump-confirm-n">${amount}</span></button>
        <button type="button" class="popup-btn" data-act="no">Cancel</button>
      </div>
    `;
    const input = panel.querySelector('.dump-amount');
    const confirmN = panel.querySelector('.dump-confirm-n');
    const afterWetEl = panel.querySelector('.dump-after-wet');
    const classEl = panel.querySelector('.dump-preview-class');
    const clamp = (v) => Math.max(1, Math.min(max, Math.round(Number(v)) || 1));
    // Reflect the resulting wet mass + the weight class (net-thrust
    // modifier) the rocket would fall into after dumping `n` water.
    const updatePreview = (n) => {
      const afterWet = Math.max(0, curWet - n);
      afterWetEl.textContent = String(afterWet);
      const wc = weightClassForMass(Math.max(1, afterWet));
      const mod = wc.netThrust >= 0 ? `+${wc.netThrust}` : String(wc.netThrust);
      classEl.innerHTML = `Class <strong>${esc(wc.id)} ${mod}</strong> net thrust`;
    };
    const setAmount = (v) => {
      amount = clamp(v);
      input.value = String(amount);
      confirmN.textContent = String(amount);
      updatePreview(amount);
    };
    panel.querySelectorAll('.dump-step').forEach((b) => {
      b.addEventListener('click', () => setAmount(amount + Number(b.dataset.step)));
    });
    panel.querySelector('.dump-all').addEventListener('click', () => setAmount(max));
    input.addEventListener('input', () => {
      // Allow free typing; only snap to the clamped value on the
      // confirm/step paths so the field doesn't fight the user
      // mid-keystroke. Keep the confirm label + preview in sync though.
      const v = clamp(input.value);
      amount = v;
      confirmN.textContent = String(v);
      updatePreview(v);
    });
    input.addEventListener('blur', () => setAmount(input.value));
    panel.querySelector('[data-act="yes"]').addEventListener('click', () => close(amount));
    panel.querySelector('[data-act="no"]').addEventListener('click', () => close(null));
    updatePreview(amount);
    overlay.appendChild(panel);
    mountOverlay(overlay);
    setTimeout(() => { input.focus(); input.select(); }, 0);
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
  label.textContent = 'Fuel Strip Track';
  host.appendChild(label);

  // The whole strip is a button into the detailed node track.
  const bands = document.createElement('div');
  bands.className = 'fuel-strip-bands is-clickable';
  bands.title = 'Click to open the detailed Fuel Strip Track';
  bands.addEventListener('click', () => openNetThrustDetailModal());
  // Cap how many mass cells a band lays out per row. Wide bands
  // (TUG spans 16) wrap onto extra rows instead of stretching the
  // strip past its box / off-screen on narrow viewports.
  const MAX_STRIP_COLS = 8;
  for (const wc of WEIGHT_CLASSES) {
    const span = wc.massMax - wc.massMin + 1;
    const cols = Math.min(span, MAX_STRIP_COLS);
    const band = document.createElement('div');
    band.className = 'fuel-strip-band';
    band.dataset.band = wc.id;
    // Width tracks the column count (not the full span) so a wrapped
    // band keeps the same cell size as the others rather than
    // hogging horizontal room for cells it stacks vertically.
    band.style.flexGrow = String(cols);
    band.style.setProperty('--band-color', wc.color);

    const head = document.createElement('div');
    head.className = 'fuel-strip-band-head';
    const mod = wc.netThrust >= 0 ? `+${wc.netThrust}` : String(wc.netThrust);
    head.innerHTML = `<span class="fs-band-name">${wc.id}</span><span class="fs-band-mod">${mod}</span>`;
    band.appendChild(head);

    // Fraction ladder (fuel sub-steps), ordered least -> greatest.
    // Whole-step bands (TUG) show a single "1".
    const fracs = document.createElement('div');
    fracs.className = 'fuel-strip-fracs';
    const ladder = (wc.fractions.length ? wc.fractions.slice() : ['1'])
      .slice()
      .sort((a, b) => fracValue(a) - fracValue(b));
    for (const fr of ladder) {
      const chip = document.createElement('span');
      chip.className = 'fs-frac';
      chip.textContent = fr;
      fracs.appendChild(chip);
    }
    band.appendChild(fracs);

    const cells = document.createElement('div');
    cells.className = 'fuel-strip-cells';
    // minmax(0, 1fr) lets the cells shrink to share the band's width
    // so the strip never overflows its box on narrow viewports.
    cells.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    for (let i = wc.massMin; i <= wc.massMax; i++) {
      const cell = document.createElement('div');
      cell.className = 'fuel-strip-cell';
      let tip = `Mass ${i} - ${wc.id} weight class (${mod} net thrust)`;
      if (i === MIN_DRY_MASS) { cell.classList.add('is-min-dry'); tip += ' - MIN DRY MASS'; }
      if (i === MAX_DRY_MASS) { cell.classList.add('is-max-dry'); tip += ' - MAX DRY MASS'; }
      if (i === MAX_WET_MASS) { cell.classList.add('is-max-wet'); tip += ' - MAX WET MASS'; }
      // Dry / wet chit cells report their actual mass value on hover.
      if (i === dm) { cell.classList.add('is-dry-chit'); tip = `Dry mass: ${massLabel(dm)}`; }
      if (i === wm) { cell.classList.add('is-wet-chit'); tip = `Wet mass: ${massLabel(wm)}`; }
      if (i === dm && i === wm) { cell.classList.add('is-co-chit'); tip = `Dry + wet mass: ${massLabel(wm)}`; }
      cell.dataset.tip = tip;
      cell.title = tip;
      cell.textContent = String(i);
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
    <span class="fs-detail-hint">🔍 click for detail</span>
  `;
  host.appendChild(legend);
}

// Parse a "k/d" (or "1") fraction string to a number, for sorting.
function fracValue(s) {
  const str = String(s).trim();
  if (str.includes('/')) { const [a, b] = str.split('/').map(Number); return b ? a / b : 0; }
  return Number(str) || 0;
}

// Modal: the full Net Thrust node track (dark), opened by clicking
// the simplified strip. Shows two chits - DRY + WET - at the
// rocket's current masses, with the node connections (black burn /
// red refuel) the fuel logic follows.
function openNetThrustDetailModal() {
  document.querySelector('.ntd-overlay')?.remove();
  const totals = getStackTotals();
  const dm = Math.max(0, totals.dryMass | 0);
  const wm = Math.max(0, totals.wetMass | 0);
  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay ntd-overlay';
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const panel = document.createElement('div');
  panel.className = 'ntd-panel';
  panel.innerHTML = `
    <button type="button" class="modal-x" aria-label="Close (Esc)" title="Close (Esc)">×</button>
    <h2 class="ntd-title">Fuel Strip Track</h2>
    <p class="muted ntd-sub">Dry mass <strong>${esc(massLabel(dm))}</strong> · Wet mass <strong>${esc(massLabel(wm))}</strong>. Hover any node or chit for its value.</p>
    <div class="ntd-scroll"></div>
    <div class="ntd-legend">
      <span><i class="ntd-line burn"></i> burn (spend FT → dry mass)</span>
      <span><i class="ntd-line refuel"></i> refuel (load FT → wet mass)</span>
      <span><i class="ntd-chit dry"></i> dry</span>
      <span><i class="ntd-chit wet"></i> wet</span>
    </div>
  `;
  renderDetailTrack(panel.querySelector('.ntd-scroll'), { dryMass: dm, wetMass: wm });
  panel.querySelector('.modal-x').addEventListener('click', close);
  overlay.appendChild(panel);
  mountOverlay(overlay);
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
      <button type="button" class="popup-btn popup-btn-secondary" id="tank-dump"
        title="Drain a chosen amount of water from the tank">💧⤓ Dump water</button>
      ${fuelTankPumpBtns()}
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
      <div class="ntt-head">🚀 Fuel Strip Track</div>
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
  const dumpBtn = panel.querySelector('#tank-dump');
  const refreshDumpButtons = () => {
    const cur = getTankWater();
    if (dumpBtn) dumpBtn.disabled = cur <= 0;
  };
  refreshDumpButtons();
  // Pump-from-outpost buttons (when a colocated outpost holds water).
  panel.querySelectorAll('.fuel-pump-from').forEach((btn) => {
    btn.addEventListener('click', () => {
      const letter = btn.dataset.letter;
      const max = Number(btn.dataset.max) || 0;
      if (max <= 0) return;
      close();
      doPumpOutpostFuel(letter, max);
    });
  });
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
  dumpBtn?.addEventListener('click', async (e) => {
    // Stop the overlay's onTap handler from interpreting this
    // click as "skip animation / close" - that's why dump looked
    // like it dismissed the modal.
    e.stopPropagation();
    const max = getTankWater();
    if (max <= 0) return;
    const amount = await openDumpWaterModal(max);
    if (!amount || amount <= 0) return;
    // Re-clamp in case the tank changed while the picker was open.
    const drain = Math.min(amount, getTankWater());
    if (drain <= 0) return;
    removeFuel(drain);
    const left = getTankWater();
    drainTo(left, left <= 0 ? 600 : 250);
    logAction({
      type: 'dump',
      icon: '💧⤓',
      summary: left <= 0
        ? `Dumped ${drain} water (tank empty)`
        : `Dumped ${drain} water (tank ${left}/${getTankMax()})`,
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
  // Tween the visible tank level from whatever's displayed to the
  // current tank value (fill OR drain - the tween handles both).
  // Shared by the solo + online aqua<->water paths so every transfer
  // animates the same way, including the free server REFUEL /
  // CASH_WATER ops in multiplayer.
  const animateTankLevel = () => {
    const fromLevel = parseFloat(nowReadout.textContent || String(getTankWater()));
    const toLevel = getTankWater();
    if (fromLevel === toLevel) { refreshAquaButtons(); return; }
    animating = true;
    tween = {
      from: fromLevel, to: toLevel,
      t0: performance.now(), dur: 400,
      onDone: () => { refreshAquaButtons(); refreshDumpButtons(); },
    };
  };
  const fillFromAqua = async (amount, e) => {
    e?.stopPropagation();
    if (!atLeo) return;
    const cur = getTankWater();
    const room = Math.max(0, cap - cur);
    const want = Math.min(amount, room, getAqua());
    if (want <= 0) { refreshAquaButtons(); return; }
    // Online: aqua->water is the server REFUEL op. AWAIT it so the
    // snapshot re-hydrates the tank first, THEN play the same fill
    // animation from the old displayed level to the new tank value
    // (previously it returned early and the tank just snapped).
    if (_online) {
      const ok = await submitOnlineOp({ kind: 'REFUEL', amount: want });
      if (!ok) { refreshAquaButtons(); return; }
      animateTankLevel();
      return;
    }
    if (!spendAqua(want)) { refreshAquaButtons(); return; }
    addFuel(want);
    animateTankLevel();
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
  const cashOutToAqua = async (amount, e) => {
    e?.stopPropagation();
    if (!atLeo) return;
    const cur = getTankWater();
    const want = Math.min(amount, cur);
    if (want <= 0) { refreshAquaButtons(); return; }
    // Online: water->aqua is the server CASH_WATER op. Await it so the
    // snapshot updates the tank, then drain-animate to the new level.
    if (_online) {
      const ok = await submitOnlineOp({ kind: 'CASH_WATER', amount: want });
      if (!ok) { refreshAquaButtons(); return; }
      animateTankLevel();
      return;
    }
    removeFuel(want);
    addAqua(want);
    animateTankLevel();
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

// Free-market a single already-chosen Hand card. Same cost + payout
// as the Free Market operation (1 op, +FREE_MARKET_AQUA aqua, card to
// the bottom of its deck), but skips the picker and goes straight to
// Discard one hand card to the bottom of its deck (free action, 1 per
// turn). Online routes the DISCARD server op so the discard persists and
// is validated/budgeted server-side; solo mutates locally. Shared by the
// hand quick-action trash icon and the card modal's Discard button so the
// two behave identically. afterFn runs once the discard fires (e.g. to
// close the card popup).
async function discardHandCard(card, idx, afterFn) {
  if (!card) return;
  // Locally we know the budget up front, so don't even prompt when the
  // turn's discard is already spent. (Online the server is authoritative.)
  if (!_online && getDiscardsRemaining() <= 0) {
    setStatus('Discard already used this turn (1 per turn).');
    return;
  }
  const dest = PATENTS_BY_ID[card.id]
    ? `the bottom of the ${card.type || 'patent'} deck`
    : 'out of play';
  const ok = await confirmModal({
    title: '🗑 Discard card',
    body: `Discard <strong>${esc(card.name)}</strong> to ${dest}? This uses your one discard for the turn.`,
    yes: '🗑 Discard', no: 'Cancel',
  });
  if (!ok) return;
  if (_online) {
    submitOnlineOp({ kind: 'DISCARD', cardId: card.id });
    if (afterFn) afterFn();
    return;
  }
  if (getDiscardsRemaining() <= 0 || !consumeDiscard()) {
    setStatus('Discard already used this turn (1 per turn).');
    return;
  }
  removeFromHandAt(idx);
  // Patents return to the bottom of their type's deck; crew just leave.
  if (PATENTS_BY_ID[card.id]) addToBottom(card.id);
  setStatus(`🗑 Discarded <em>${esc(card.name)}</em> to the bottom of the ${esc(card.type || 'crew')} deck.`);
  logAction({
    type: 'discard',
    icon: '🗑',
    summary: `Discarded ${card.name} to the bottom of the ${card.type || 'crew'} deck`,
    undoable: false,
    data: { cardId: card.id, deckType: card.type || null },
  });
  if (afterFn) afterFn();
}

// the irreversible-sale confirm. afterFn runs once the sale commits
// (e.g. to close the card popup).
function freeMarketSellFromHand(card, afterFn) {
  if (!card) return;
  openSellConfirmModal({
    card,
    aqua: FREE_MARKET_AQUA,
    renderCardFn: renderCard,
    onConfirm: () => {
      // Online: route to the server FREE_MARKET op (was client-only).
      if (_online) {
        submitOnlineOp({ kind: 'FREE_MARKET', cardId: card.id });
        if (afterFn) afterFn();
        return;
      }
      if (!requireOp('Free Market')) return;
      removeFromHand(card.id);
      addToBottom(card.id);
      addAqua(FREE_MARKET_AQUA);
      setStatus(
        `💱 Free Market: <em>${esc(card.name)}</em> nets `
        + `<strong>+${FREE_MARKET_AQUA}</strong> aqua and returns to the `
        + `bottom of the ${esc(card.type || 'patent')} deck.`
      );
      logAction({
        type: 'free_market',
        icon: '💱',
        summary: `Free Market: ${card.name} for +${FREE_MARKET_AQUA} aqua`,
        undoable: false,
        data: { cardId: card.id, aqua: FREE_MARKET_AQUA },
      });
      if (afterFn) afterFn();
    },
  });
}

function doProspect(site, prosp) {
  if (!prosp) return;
  // Online: the server rolls the prospect die and resolves the disc.
  // Send PROSPECT for the target site and let the snapshot repaint;
  // skip the local roll modal + disc placement below.
  if (_online) {
    const siteId = toServerId(_onlineMaps, site.id);
    if (!siteId) { _onlineToast('That site is not on the map.', 'error'); return; }
    submitOnlineOp({ kind: 'PROSPECT', siteId });
    return;
  }
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
  // Raygun is a free, unlimited remote scan (rulebook: the beam
  // fires through line-of-sight, including lander burn spaces). It
  // never consumes the per-turn operation, so the player can keep
  // firing it at every reachable site and still spend their op on
  // something else, and it never touches the move budget. Missile /
  // buggy land on the target site and DO cost the op (rulebook I6).
  const isRaygun = prosp.kind === 'raygun';
  if (!isRaygun && !requireOp('Prospect')) return;
  const threshold = siteProspectThreshold(site);
  const roll = 1 + Math.floor(Math.random() * 6);
  const success = roll <= threshold;
  const cardName = prosp.card?.name || prosp.id;
  const kindGlyph = { missile: '🚀', raygun: '🔫', buggy: '🛺' }[prosp.kind] || '🔬';
  // The buggy can re-roll the prospect die once (optional).
  const canReroll = prosp.kind === 'buggy';
  openProspectRollModal({ site, threshold, roll, success, kindGlyph, cardName, canReroll }, (finalRoll, finalSuccess) => {
    placeDisc(site.id, finalSuccess ? 'success' : 'fail', {
      roll: finalRoll, threshold, kind: prosp.kind, by: cardName,
    });
    setStatus(
      `${kindGlyph} Prospected <strong>${esc(site.name)}</strong> `
      + `(target ≤ ${threshold}) with <em>${esc(cardName)}</em>: `
      + `rolled <strong class="big">${finalRoll}</strong> - `
      + `<strong>${finalSuccess ? 'success - claim placed' : 'failed - site exhausted'}</strong>.`
    );
    logAction({
      type: 'prospect',
      icon: kindGlyph,
      summary: `${finalSuccess ? 'Claimed' : 'Exhausted'} ${site.name} (${prosp.kind}, rolled ${finalRoll} vs ≤${threshold})`,
      undoable: false,
      data: { siteId: site.id, kind: prosp.kind, roll: finalRoll, threshold, success: finalSuccess },
    });
  });
}

// Animated prospect-roll modal. Shows a 3D die on the left, the
// site's prospect target (≤ N) on the right, rolls the die for
// ~700 ms, then settles on the rolled value. The die's outer
// border tints green on success / red on fail so the player reads
// the outcome at a glance. Player then clicks "Place disc" to
// commit the result; onPlace fires once the disc lands.
function openProspectRollModal({ site, threshold, roll, success, kindGlyph, cardName, canReroll = false }, onPlace) {
  document.querySelector('.prospect-roll-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay prospect-roll-overlay';
  // Live result the Place button commits. The buggy reroll mutates
  // these in place, so onPlace always receives the FINAL roll.
  let curRoll = roll;
  let curSuccess = success;
  let rerollUsed = false;
  const close = (placed) => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (placed && onPlace) onPlace(curRoll, curSuccess);
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
      ${canReroll ? `<button type="button" class="popup-btn prospect-reroll-btn" disabled>🎲 Reroll (buggy)</button>` : ''}
      <button type="button" class="popup-btn primary prospect-place-btn" disabled>
        Place disc
      </button>
    </div>
  `;
  const dieHost = panel.querySelector('.prospect-die-host');
  const resultLine = panel.querySelector('.prospect-roll-result');
  const placeBtn = panel.querySelector('.prospect-place-btn');
  const rerollBtn = panel.querySelector('.prospect-reroll-btn');
  const die = buildDie(1);
  dieHost.appendChild(die);

  overlay.appendChild(panel);
  mountOverlay(overlay);

  // Settle the UI on a finished roll: tint the die, show the verdict,
  // and re-enable the action buttons.
  const showResult = (r, ok) => {
    die.classList.remove('die-success', 'die-fail');
    die.classList.add(ok ? 'die-success' : 'die-fail');
    resultLine.innerHTML = ok
      ? `Rolled <strong>${r}</strong> ≤ ${threshold} - <strong class="ok">success</strong>. Claim disc ready.`
      : `Rolled <strong>${r}</strong> > ${threshold} - <strong class="bad">failed</strong>. Site exhausted.`;
    resultLine.classList.remove('muted');
    placeBtn.disabled = false;
    placeBtn.textContent = ok ? 'Place yellow claim disc' : 'Place red disc';
    if (rerollBtn && !rerollUsed) rerollBtn.disabled = false;
  };
  // Animate a roll to `r`, locking the buttons until it settles.
  const animateRoll = (r, ok) => {
    placeBtn.disabled = true;
    if (rerollBtn) rerollBtn.disabled = true;
    die.classList.remove('die-success', 'die-fail');
    resultLine.textContent = 'Rolling…';
    resultLine.classList.add('muted');
    rollDie(die, r).then(() => showResult(r, ok));
  };

  animateRoll(curRoll, curSuccess);

  if (rerollBtn) {
    rerollBtn.addEventListener('click', () => {
      if (rerollUsed) return;
      rerollUsed = true;
      curRoll = 1 + Math.floor(Math.random() * 6);
      curSuccess = curRoll <= threshold;
      animateRoll(curRoll, curSuccess);
      // One reroll only - retire the button once spent.
      rerollBtn.style.display = 'none';
    });
  }
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
  if (isOnline()) return; // online state is server-owned; don't touch the solo save
  try {
    if (_rocketSiteId) localStorage.setItem(STORAGE_ROCKET_SITE, _rocketSiteId);
    else localStorage.removeItem(STORAGE_ROCKET_SITE);
  } catch { /* private mode */ }
}
function persistRocketTrail() {
  if (isOnline()) return; // online state is server-owned; don't touch the solo save
  try {
    if (_rocketTrail && _rocketTrail.length) {
      localStorage.setItem(STORAGE_ROCKET_TRAIL, JSON.stringify(_rocketTrail));
    } else {
      localStorage.removeItem(STORAGE_ROCKET_TRAIL);
    }
  } catch { /* private mode */ }
}
// Move-progress helpers. The full resumable queue context (ctx) is
// persisted as each roll / choice commits, so a tab close mid-
// resolution can pick up where it left off on the next load (per-roll
// resume). Committed rolls aren't re-rolled.
function persistMoveProgress(ctx) {
  try { localStorage.setItem(STORAGE_PENDING_MOVE, JSON.stringify(ctx)); }
  catch { /* private mode */ }
}
function clearMoveProgress() {
  try { localStorage.removeItem(STORAGE_PENDING_MOVE); }
  catch { /* private mode */ }
}
function loadMoveProgress() {
  try {
    const s = localStorage.getItem(STORAGE_PENDING_MOVE);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}
// True when a saved move ctx still resolves against the active data
// set (so we can safely re-enter the queue). If not, the move is
// rolled back instead.
function canResumeMove(ctx) {
  if (!ctx || !_activeData || !Array.isArray(ctx.turn1) || !ctx.turn1.length) return false;
  const has = (id) => !!(_activeData.byId ? _activeData.byId[id]
    : _activeData.sites.find((x) => x.id === id));
  return ctx.turn1.every((s) => has(s.from) && has(s.to)) && has(ctx.newSiteId);
}
// Roll a move that can't be resumed (data changed, etc.) back to its
// pre-move state so the turn isn't wasted: rocket returns to origin,
// route + trail restored, move budget + fuel refunded, hazard lock
// cleared. Mutates only module state + persistence.
function rollbackMove(ctx) {
  clearMoveProgress();
  if (!ctx) return;
  _rocketSiteId = ctx.fromSiteId || null;
  persistRocketSite();
  _rocketTrail = Array.isArray(ctx.trail) ? ctx.trail : [];
  persistRocketTrail();
  _plannedRoute = Array.isArray(ctx.route) && ctx.route.length ? ctx.route : null;
  persistPlannedRoute();
  if (Number(ctx.fuelCost) > 0) addFuel(Number(ctx.fuelCost));
  refundMove();
  setHazardousMove(false);
  setStatus(
    '⚠ Your last move could not be resumed and was rolled back. The '
    + 'move budget and fuel were refunded - replay the move when ready.'
  );
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
        colour: myRocketColour(),
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
  const marked = getBoostMarked();
  const n = marked.length;
  // Boost costs Aqua = the total mass of the marked cards (see
  // commitBoost). Show the cost on the button, not the card count, so the
  // player sees the spend before committing.
  let cost = 0;
  for (const id of marked) {
    const c = PATENTS_BY_ID[id];
    if (!c) continue;
    const f = (c.faces && c.faces.primary) || c;
    cost += ((f.mass != null ? f.mass : c.mass) | 0);
  }
  btn.dataset.armed = n > 0 ? '1' : '0';
  btn.disabled = n === 0;
  btn.textContent = n > 0 ? `🛰 BOOST → LEO 💧${cost}` : '🛰 BOOST → LEO';
  btn.title = n > 0
    ? `Boost ${n} marked card${n === 1 ? '' : 's'} from your hand into the LEO Stack for ${cost} aqua (total mass). Costs one operation. Use the Transfer action at LEO to move them onto the rocket.`
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

// Colour for the local player's rocket sprite. Online: the player's
// server-assigned seat colour (the crew-card hex), so the rocket on
// the map matches their roster dot + turn banner + name tint. Solo:
// the legacy 'yellow' named palette. getRocketSprite accepts either a
// named key or a raw #rrggbb.
function myRocketColour() {
  if (_online && _onlineSnapshot && _onlineMe) {
    const me = (_onlineSnapshot.players || []).find((p) => p.profileId === _onlineMe.id);
    if (me && me.color) return me.color;
  }
  return 'yellow';
}

// Publish the local player's seat colour as --me-color on the browse
// shell so the player's own chrome (top bar, hand strip, hand title)
// can tint to it - a persistent "you are this colour" cue. Cleared
// (removed) in solo so the sandbox keeps its default palette.
function syncMeColor(snapshot) {
  const shell = document.querySelector('.browse-shell');
  if (!shell) return;
  let color = null;
  if (_online && snapshot && Array.isArray(snapshot.players) && _onlineMe) {
    const me = snapshot.players.find((p) => p.profileId === _onlineMe.id);
    const active = snapshot.players[snapshot.activeIndex];
    const myTurn = !!(active && active.profileId === _onlineMe.id);
    // Only light the player's own seat-colour chrome ON THEIR TURN, so a
    // glance at the top bar / hand tells you whether it's your move. Off-
    // turn the chrome goes neutral (the bottom banner still names whose
    // turn it is, tinted in their colour).
    color = (myTurn && me && me.color) || null;
  }
  if (color) shell.style.setProperty('--me-color', color);
  else shell.style.removeProperty('--me-color');
  shell.classList.toggle('has-me-color', !!color);
}

// World-space coords for a server rocket siteId (null = LEO anchor).
// Translates the server slug -> planner node -> {x, y}.
function mpRocketCoords(serverSiteId) {
  if (!_activeData) return null;
  if (!serverSiteId) return { x: LEO_ANCHOR.x, y: LEO_ANCHOR.y };  // at LEO
  const pid = _onlineMaps && _onlineMaps.serverToPlanner.get(serverSiteId);
  const site = pid && (_activeData.byId?.[pid]
    || _activeData.sites.find((s) => s.id === pid));
  if (site && typeof site.x === 'number') return { x: site.x, y: site.y };
  return { x: LEO_ANCHOR.x, y: LEO_ANCHOR.y };  // unknown -> LEO
}

// Lay out every player's rocket on the map. Ships sharing a site are
// arranged in a CENTRED HORIZONTAL ROW (not a ring) so colocated
// rockets - everyone at LEO especially - line up side by side at the
// same size. The local player's own rocket keeps its full-featured
// draw (badges, hover, click) but gets a horizontal offset so it
// takes its slot in the row; opponents are colour-coded sprites with
// a 🚫 when inactive (no active thruster), mirroring the local cue.
const MP_ROCKET_SPACING = 30;   // screen px between colocated ships
// Lay out every player's rocket: the colocation row + local offset.
// Returns { opponents: [{profileId, x, y, offsetX, colour, name, inactive}],
// localOffsetX }. Factored out of syncMpRockets so the move animator can
// reuse the SAME final layout while it tweens one ship across the map.
function computeMpRockets(snapshot) {
  const myId = _onlineMe && _onlineMe.id;
  const groups = new Map();
  for (const p of (snapshot && snapshot.players) || []) {
    const pos = mpRocketCoords(p.rocket && p.rocket.siteId);
    if (!pos) continue;
    const key = `${Math.round(pos.x)}:${Math.round(pos.y)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      profileId: p.profileId,
      seat: p.seat || 0,
      x: pos.x, y: pos.y,
      colour: p.color || 'white',
      name: p.name,
      inactive: !(p.rocket && p.rocket.activeThrusterId),
      isLocal: p.profileId === myId,
    });
  }
  const opponents = [];
  let localOffsetX = 0;
  for (const group of groups.values()) {
    group.sort((a, b) => a.seat - b.seat);      // stable left-to-right
    const n = group.length;
    group.forEach((r, i) => {
      const offsetX = (i - (n - 1) / 2) * MP_ROCKET_SPACING;
      if (r.isLocal) {
        localOffsetX = offsetX;
      } else {
        opponents.push({
          profileId: r.profileId, x: r.x, y: r.y, offsetX,
          colour: r.colour, name: r.name, inactive: r.inactive,
        });
      }
    });
  }
  return { opponents, localOffsetX };
}

function syncMpRockets(snapshot) {
  if (!_renderer) return;
  if (!_online || !snapshot || !Array.isArray(snapshot.players) || !_onlineMe) {
    _renderer.setMpRockets(null);
    _renderer.setSandboxRocketOffset(0);
    return;
  }
  const { opponents, localOffsetX } = computeMpRockets(snapshot);
  _renderer.setSandboxRocketOffset(localOffsetX);
  _renderer.setMpRockets(opponents);
}

// ----- online transition animation (animate the diff, don't snap) -----
//
// applySnapshot has already hydrated + snapped the FINAL state by the
// time these run. Each animator diffs the previous applied snapshot
// against the new one and replays the motion the player would otherwise
// miss, overriding the relevant sprites back to their origin and
// tweening forward. CLAUDE.md doctrine: "animate the transition, then
// commit". One mechanism covers opponents' moves, the local player's
// own move, AND the undo rewind (an UNDO lands a snapshot whose rocket
// sits at the pre-move site, so the same diff slides it back).

// Planner node id of the LEO lagrange (the "at LEO" anchor, server
// siteId === null). Used as the origin / destination when a ship
// launches from or returns to LEO.
function leoPlannerId() {
  if (!_activeData) return null;
  const s = _activeData.sites.find((x) => x.type === 'lagrange' && x.name === 'LEO');
  return s ? s.id : null;
}
// World coords for a planner node id (null when it has none).
function coordOfPlanner(pid) {
  if (!_activeData || pid == null) return null;
  const s = _activeData.byId?.[pid] || _activeData.sites.find((x) => x.id === pid);
  return (s && typeof s.x === 'number') ? { x: s.x, y: s.y } : null;
}
// Planner node id -> the id the SERVER speaks for it: the node's id2
// (the shared mission-planner slug). Same wire id buildIdMaps/toServerId
// use, so SET_ROUTE segments line up with MOVE destinations + the
// server's route continuity check.
function plannerIdToSlug(pid) {
  if (!_activeData || pid == null) return null;
  const s = _activeData.byId?.[pid] || _activeData.sites.find((x) => x.id === pid);
  return (s && s.id2) || null;
}

// ----- route sync (feature: SET_ROUTE / CLEAR_ROUTE) -----
//
// The planned route is server state (player.rocket.route) so it
// survives a reload / device switch and so the server can truncate it
// as the rocket walks it. It is SECRET (opponents see the rocket but
// not the plan), so syncing it changes nothing on their screens; we
// only sync the local player's own plan. These fire-and-forget (the
// route drives no hydrated visual, so we don't apply the response - the
// next poll/WS tick carries the new seq harmlessly). Gated on "my turn"
// because SET_ROUTE is a turn-functional op the server would reject
// otherwise.

// Translate the local _plannedRoute (planner node ids) to the server's
// slug space (id2, universal across sites + waypoints). null when any
// endpoint can't be translated, so we abort rather than send a partial.
function routeSegmentsForServer() {
  if (!_plannedRoute || !_plannedRoute.length) return [];
  const out = [];
  for (const s of _plannedRoute) {
    const from = plannerIdToSlug(s.from);
    const to = plannerIdToSlug(s.to);
    if (!from || !to) return null;
    out.push({ from, to, burns: Number(s.burns) || 0, turn: Number(s.turn) || 1 });
  }
  return out;
}
function submitSetRouteOnline() {
  if (!_online || _spectator || !_onlineGameId || !_onlineMe) return;
  if (!isOnlineMyTurn()) return;
  const segments = routeSegmentsForServer();
  if (!segments || !segments.length) return;
  submitGameOp(_onlineGameId, { kind: 'SET_ROUTE', segments }, _onlineMe.token)
    .then((r) => {
      // Absorb our own op's snapshot quietly (no re-hydrate / no canvas
      // blink); the route is already drawn locally. Covers the case where
      // the HTTP response lands before/without the WS echo.
      if (r && r.ok && r.data && r.data.game) noteQuietSnapshot(r.data.game.state, r.data.game.seq);
    })
    .catch(() => {});
}
function submitClearRouteOnline() {
  if (!_online || _spectator || !_onlineGameId || !_onlineMe) return;
  if (!isOnlineMyTurn()) return;
  submitGameOp(_onlineGameId, { kind: 'CLEAR_ROUTE' }, _onlineMe.token)
    .then((r) => {
      if (r && r.ok && r.data && r.data.game) noteQuietSnapshot(r.data.game.state, r.data.game.seq);
    })
    .catch(() => {});
}

// Shortest-path planner segments [{from, to}] between two server site
// ids (null = LEO) for animation. Falls back to a single straight
// segment when the planner can't route it (visually fine - a slide).
function animPathSegments(fromServerId, toServerId) {
  const fromPid = fromServerId ? toPlannerId(_onlineMaps, fromServerId) : leoPlannerId();
  const toPid = toServerId ? toPlannerId(_onlineMaps, toServerId) : leoPlannerId();
  if (!fromPid || !toPid || fromPid === toPid) return null;
  let segs = null;
  try {
    // Generous thrust so the planner always finds the geometric path
    // (we only need a polyline to slide along, not a legal burn plan).
    const r = planRoute(_activeData, fromPid, toPid, { thrust: 12 });
    if (r && r.segments && r.segments.length) {
      segs = r.segments.map((s) => ({ from: s.from, to: s.to }));
    }
  } catch { /* fall through to straight line */ }
  if (!segs) segs = [{ from: fromPid, to: toPid }];
  return segs;
}
// Planner segments -> world-space polyline points for the opponent tween.
function segmentsToWorldPts(segs) {
  const pts = [];
  const first = coordOfPlanner(segs[0].from);
  if (first) pts.push(first);
  for (const sg of segs) {
    const c = coordOfPlanner(sg.to);
    if (c) pts.push(c);
  }
  return pts;
}

// Animate the local player's own rocket along `segs`, then re-pin the
// canonical state (offset + canFly) the hydrate already computed.
function animateLocalMoveAlong(segs) {
  // Pre-set to the origin synchronously so the first paint shows the
  // launch site, not the (already-hydrated) destination - otherwise
  // the rocket flashes at the target for one frame before sliding.
  const o = coordOfPlanner(segs[0].from);
  if (o) {
    _renderer.setSandboxRocket({
      x: o.x, y: o.y, colour: myRocketColour(), canFly: isRocketActive().active,
    });
  }
  animateRocketAlong(segs).then(() => {
    if (!_online) return;
    syncSandboxRocket();
    syncMpRockets(_onlineSnapshot);   // restore colocation offset
  });
}

// Animate ONE opponent ship across the map while the rest hold at their
// final positions. `finalOpponents` is computeMpRockets()'s layout for
// the new snapshot; we override the moving entry's coords each frame.
function tweenMpRocketAlong(profileId, pts, finalOpponents, totalMs = 700) {
  if (!_renderer || pts.length < 2) { _renderer.setMpRockets(finalOpponents); return; }
  const idx = finalOpponents.findIndex((o) => o.profileId === profileId);
  if (idx < 0) { _renderer.setMpRockets(finalOpponents); return; }
  const lens = [];
  let totalLen = 0;
  for (let i = 1; i < pts.length; i++) {
    const L = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    lens.push(L); totalLen += L;
  }
  if (totalLen === 0) { _renderer.setMpRockets(finalOpponents); return; }
  const frameAt = (pos) => finalOpponents.map((o, i) => (
    i === idx ? { ...o, x: pos.x, y: pos.y, offsetX: 0 } : o
  ));
  _renderer.setMpRockets(frameAt(pts[0]));   // origin, this frame
  const t0 = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - t0) / totalMs);
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    let traveled = eased * totalLen;
    let i = 0;
    while (i < lens.length - 1 && traveled > lens[i]) { traveled -= lens[i]; i += 1; }
    const k = lens[i] > 0 ? traveled / lens[i] : 0;
    const pos = {
      x: pts[i].x + (pts[i + 1].x - pts[i].x) * k,
      y: pts[i].y + (pts[i + 1].y - pts[i].y) * k,
    };
    if (t < 1) { _renderer.setMpRockets(frameAt(pos)); requestAnimationFrame(step); }
    else { _renderer.setMpRockets(finalOpponents); }   // pin final layout
  };
  requestAnimationFrame(step);
}

// Diff rocket positions for every player; slide each ship that moved.
// When the local player's move rolled hazard dice (rocket.lastMove), play
// those FIRST (the server already resolved them) so the player sees the
// rolls before the rocket settles - or, if a roll destroyed the ship,
// instead of a (non-existent) slide.
function animateSnapshotMoves(prev, snapshot) {
  // A local move/undo tween already in flight - let it land; the next
  // real seq advance will re-diff. (Opponent tweens don't set this.)
  if (_rocketAnimating) return;
  const prevById = new Map((prev.players || []).map((p) => [p.profileId, p]));
  const myId = _onlineMe && _onlineMe.id;
  const finalMp = computeMpRockets(snapshot);

  const meNow = (snapshot.players || []).find((p) => p.profileId === myId);
  const lm = meNow && meNow.rocket && meNow.rocket.lastMove;

  const slides = () => {
    for (const p of (snapshot.players || [])) {
      const before = prevById.get(p.profileId);
      if (!before) continue;
      const fromSite = (before.rocket && before.rocket.siteId) || null;
      const toSite = (p.rocket && p.rocket.siteId) || null;
      if (fromSite === toSite) continue;          // this ship didn't move
      // A ship destroyed by a hazard roll didn't travel - it blew up and
      // its cards recalled to LEO; the dice modal already told that story.
      if (p.profileId === myId && lm && lm.destroyed) continue;
      const segs = animPathSegments(fromSite, toSite);
      if (!segs) continue;
      if (p.profileId === myId) {
        animateLocalMoveAlong(segs);
      } else {
        tweenMpRocketAlong(p.profileId, segmentsToWorldPts(segs), finalMp.opponents);
      }
    }
  };

  // Local player's own hazard dice (if this move rolled any). Keyed off
  // the per-move nonce, and only when it INCREASES - a real new move bumps
  // it; an UNDO rebuilds to a lower nonce, which must NOT replay the dice.
  const meBefore = prevById.get(myId);
  const prevNonce = (meBefore && meBefore.rocket && meBefore.rocket.lastMove
    && meBefore.rocket.lastMove.nonce) || 0;
  if (lm && lm.nonce > prevNonce && Array.isArray(lm.rolls) && lm.rolls.length) {
    playHazardRolls(lm).then(slides);
  } else {
    slides();
  }
}

// Read-only playback of the server's hazard dice for the local player's
// move. The server rolled every die (seeded, authoritative) and recorded
// them in rocket.lastMove; this shows them with the same glyph language as
// the sandbox and the verdict (survived / decommissioned / DESTROYED).
// Resolves when dismissed so the rocket slide can follow.
// Display name for a decommissioned card id (patent name, else crew name).
function decommCardName(id) {
  const p = PATENTS_BY_ID[id];
  if (p) return p.name || id;
  const crew = CREW_BY_ID[id];
  if (crew) {
    const f = (crew.faces && crew.faces.primary) || {};
    return f.name || id;
  }
  return id;
}
function playHazardRolls(lm) {
  return new Promise((resolve) => {
    const rolls = (lm.rolls || []).filter((r) => typeof r.d6 === 'number');
    if (!rolls.length) { resolve(); return; }
    document.querySelector('.rad-roll-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'card-modal-overlay rad-roll-overlay hazard-rolls-overlay';
    const glyphFor = (k) => (k === 'rad' ? '☢' : k === 'aero' ? '🪂' : '☠');
    const nameFor = (slug) => {
      const pid = toPlannerId(_onlineMaps, slug);
      const s = pid && (_activeData.byId?.[pid] || _activeData.sites.find((x) => x.id === pid));
      return (s && s.name) || slug;
    };
    const panel = document.createElement('div');
    panel.className = 'turn-confirm-panel rad-roll-panel';
    const title = lm.destroyed ? '💥 Hazard roll - critical!' : '🎲 Hazard rolls';
    panel.innerHTML = `
      <h2 class="rad-roll-title">${title}</h2>
      <p class="muted rad-roll-sub">The server rolled one die per hazard space.</p>
      <ul class="rad-roll-dice"></ul>
      <p class="rad-roll-result muted">Rolling…</p>
      <div class="rad-roll-actions">
        <button type="button" class="popup-btn primary haz-rolls-ok" disabled>Continue</button>
      </div>
    `;
    const list = panel.querySelector('.rad-roll-dice');
    const resultLine = panel.querySelector('.rad-roll-result');
    const okBtn = panel.querySelector('.haz-rolls-ok');
    const dice = [];
    for (const r of rolls) {
      const li = document.createElement('li');
      li.className = 'rad-roll-die-row';
      const label = document.createElement('div');
      label.className = 'rad-roll-site';
      label.innerHTML = `<span class="haz-glyph">${glyphFor(r.kind)}</span> ${esc(nameFor(r.slug))}`;
      const host = document.createElement('div');
      host.className = 'rad-roll-die-host';
      const die = buildDie(1);
      host.appendChild(die);
      li.append(label, host);
      list.appendChild(li);
      dice.push({ die, r });
    }
    overlay.appendChild(panel);
    mountOverlay(overlay);
    const close = () => { overlay.remove(); resolve(); };
    Promise.all(dice.map(({ die, r }) => rollDie(die, r.d6).then(() => {
      const bad = r.crit || (r.rad != null && r.rad > 0);
      die.classList.add(bad ? 'die-fail' : 'die-success');
    }))).then(() => {
      resultLine.classList.remove('muted');
      if (lm.destroyed) {
        resultLine.innerHTML = '<strong class="bad">Critical (rolled a 1) - rocket destroyed.</strong> Cards returned to your hand / LEO.';
      } else if (lm.decommissioned && lm.decommissioned.length) {
        const names = lm.decommissioned.map(decommCardName);
        resultLine.innerHTML = `Radiation decommissioned <strong>${names.map(esc).join('</strong>, <strong>')}</strong> to your hand / LEO.`;
      } else {
        resultLine.innerHTML = '<strong class="ok">Survived</strong> - the rocket flew through unscathed.';
      }
      okBtn.disabled = false;
      okBtn.addEventListener('click', close);
    });
    // Auto-dismiss safety net.
    setTimeout(() => { if (document.body.contains(overlay)) close(); }, 8000);
  });
}

// Show the prospect die for a NEWLY landed disc, so every player (the
// prospector and the watchers) sees the roll happen instead of a disc
// blinking onto the map. The server already publishes roll + outcome in
// state.discs, so this is pure read-only playback (no Place button).
function animateSnapshotProspects(prev, snapshot) {
  const prevDiscs = prev.discs || {};
  const newDiscs = snapshot.discs || {};
  // A disc to play: freshly added, OR an existing one whose roll changed
  // (a buggy re-roll). Either way it's a single op, so only the
  // incremental case (skip bulk resume / late-join catch-up).
  const changed = Object.keys(newDiscs).filter((k) => {
    const a = prevDiscs[k];
    const b = newDiscs[k];
    if (!a) return true;                       // newly added
    return b && a.roll !== b.roll;             // re-rolled
  });
  if (changed.length !== 1) return;
  const serverSiteId = changed[0];
  const disc = newDiscs[serverSiteId];
  if (!disc || typeof disc.roll !== 'number') return;
  const pid = toPlannerId(_onlineMaps, serverSiteId);
  const site = pid && (_activeData.byId?.[pid] || _activeData.sites.find((x) => x.id === pid));
  if (!site) return;
  // Offer the buggy re-roll only to the disc's owner while it's still
  // available (server tracks canReroll, this turn, once).
  const myId = _onlineMe && _onlineMe.id;
  const canReroll = !!disc.canReroll && disc.kind === 'buggy'
    && disc.ownerId === myId && isOnlineMyTurn();
  playRemoteProspectRoll(site, disc, { serverSiteId, canReroll });
}

// Prospect-roll playback. The disc is already authoritative in the
// snapshot, so this is read-only - EXCEPT a buggy's owner gets a one-time
// re-roll button (submits PROSPECT_REROLL; the resulting snapshot replays
// the new die). Without a re-roll it auto-dismisses once the die settles.
function playRemoteProspectRoll(site, disc, opts = {}) {
  document.querySelector('.prospect-roll-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay prospect-roll-overlay';
  const ok = disc.outcome === 'success';
  const kindGlyph = { missile: '🚀', raygun: '🔫', buggy: '🛺' }[disc.kind] || '🔬';
  const who = disc.by ? `by <em>${esc(disc.by)}</em>` : '';
  const panel = document.createElement('div');
  panel.className = 'prospect-roll-panel';
  panel.innerHTML = `
    <h2 class="prospect-roll-title">${kindGlyph} Prospecting ${esc(site.name)}</h2>
    <p class="muted prospect-roll-sub">${who}</p>
    <div class="prospect-roll-stage">
      <div class="prospect-die-host"></div>
      <div class="prospect-roll-vs">≤</div>
      <div class="prospect-target"><strong>${disc.threshold}</strong><em>site size</em></div>
    </div>
    <p class="prospect-roll-result muted">Rolling…</p>
    <div class="prospect-roll-actions">
      ${opts.canReroll ? '<button type="button" class="popup-btn prospect-reroll-btn" disabled>🎲 Re-roll (buggy)</button>' : ''}
      ${opts.canReroll ? '<button type="button" class="popup-btn primary prospect-keep-btn" disabled>Keep</button>' : ''}
    </div>
  `;
  const dieHost = panel.querySelector('.prospect-die-host');
  const resultLine = panel.querySelector('.prospect-roll-result');
  const rerollBtn = panel.querySelector('.prospect-reroll-btn');
  const keepBtn = panel.querySelector('.prospect-keep-btn');
  const die = buildDie(1);
  dieHost.appendChild(die);
  overlay.appendChild(panel);
  mountOverlay(overlay);
  const close = () => overlay.remove();
  rollDie(die, disc.roll).then(() => {
    die.classList.add(ok ? 'die-success' : 'die-fail');
    resultLine.classList.remove('muted');
    resultLine.innerHTML = ok
      ? `Rolled <strong>${disc.roll}</strong> ≤ ${disc.threshold} - <strong class="ok">claim placed</strong>.`
      : `Rolled <strong>${disc.roll}</strong> > ${disc.threshold} - <strong class="bad">site exhausted</strong>.`;
    if (opts.canReroll) {
      if (rerollBtn) {
        rerollBtn.disabled = false;
        rerollBtn.addEventListener('click', () => {
          close();
          // The new roll's snapshot will replay through this same path.
          submitOnlineOp({ kind: 'PROSPECT_REROLL', siteId: opts.serverSiteId });
        });
      }
      if (keepBtn) { keepBtn.disabled = false; keepBtn.addEventListener('click', close); }
    } else {
      // Linger on the verdict, then clear - the disc is already on the map.
      setTimeout(close, 1500);
    }
  });
  // Safety net: never leave a non-interactive overlay stuck.
  if (!opts.canReroll) setTimeout(() => { if (document.body.contains(overlay)) close(); }, 4000);
}

// Cards the local player just gained in a stack (LEO / rocket), so the
// next stack repaint can drift them in instead of having them pop. Keyed
// by location; consumed (cleared) by the renderer that reads it.
let _driftInRocket = new Set();
let _driftInLeo = new Set();
function animateSnapshotCardDrift(prev, snapshot) {
  const myId = _onlineMe && _onlineMe.id;
  const before = (prev.players || []).find((p) => p.profileId === myId);
  const after = (snapshot.players || []).find((p) => p.profileId === myId);
  if (!before || !after) return;
  const ids = (slots) => new Set((slots || []).map((s) => s.id));
  const newcomers = (prevSlots, nextSlots) => {
    const had = ids(prevSlots);
    return (nextSlots || []).map((s) => s.id).filter((id) => !had.has(id));
  };
  for (const id of newcomers(before.rocket && before.rocket.stack, after.rocket && after.rocket.stack)) {
    _driftInRocket.add(id);
  }
  for (const id of newcomers(before.leo, after.leo)) _driftInLeo.add(id);
  // Tag any matching card elements already on screen (open stack modal /
  // LEO panel) so they drift in now; the repaint path also reads the sets.
  applyCardDriftClass();
}
// Add the drift-in class to any rendered card whose id is queued. Cards
// carry data-card-id (renderCard); the class self-clears via animation.
function applyCardDriftClass() {
  const tag = (set, selectorRoot) => {
    if (!set.size) return;
    for (const id of [...set]) {
      const els = document.querySelectorAll(
        `${selectorRoot} [data-card-id="${CSS.escape(id)}"]`
      );
      els.forEach((el) => {
        el.classList.remove('card-drift-in');
        // reflow so re-adding the class restarts the keyframe
        void el.offsetWidth;
        el.classList.add('card-drift-in');
      });
      if (els.length) set.delete(id);
    }
  };
  // Drift in wherever the card is currently on screen: the rocket-stack
  // modal, the hand strip, and any open transfer / stack inspector.
  tag(_driftInRocket, '#rocket-stack-cards, .stack-inspect-cards');
  tag(_driftInLeo, '#sandbox-hand-cards, .stack-inspect-cards');
}

// The Sunspot Cube advanced (a full table wrap). Slide the cube on the
// turn wheel from the old slot to the new one and, if the new slot rolled
// a Sunspot event, animate the d6 - the same beat the sandbox shows on
// end-turn, surfaced to every player when the shared clock ticks. The
// server owns the event's effect; this only surfaces the roll.
function animateSnapshotClock(prev, snapshot) {
  const prevTurn = prev.turn | 0;
  const newTurn = snapshot.turn | 0;
  if (newTurn === prevTurn) return;          // clock didn't advance
  const pe = prev.lastEvent;
  const ne = snapshot.lastEvent;
  const evChanged = !!ne && (!pe
    || pe.turn !== ne.turn || pe.round !== ne.round || pe.dieRoll !== ne.dieRoll);
  openTurnClockModal({
    animateFrom: prevTurn,
    rolling: evChanged ? { value: ne.dieRoll } : null,
  });
}

// Orchestrator: run every diff-animation for one applied snapshot.
// Wrapped individually so one failing animator can't block the others
// or the hydrate that already committed the final state.
function animateOnlineTransitions(prev, snapshot) {
  if (!prev || !snapshot || !_renderer || !_activeData || !_onlineMaps) return;
  try { animateSnapshotMoves(prev, snapshot); } catch { /* non-fatal */ }
  try { animateSnapshotProspects(prev, snapshot); } catch { /* non-fatal */ }
  try { animateSnapshotCardDrift(prev, snapshot); } catch { /* non-fatal */ }
  try { animateSnapshotClock(prev, snapshot); } catch { /* non-fatal */ }
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
  // Tell the rocket engine which heliocentric zone it's in so solar-
  // driven thrusters get the zone's solar-power thrust modifier.
  setSolarZone(site && site.solarZone ? site.solarZone : null);
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
    colour: myRocketColour(),
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
  const list = allFactories();
  const map = {};
  for (const f of list) map[f.siteId] = f;
  _renderer.setFactories(map);
  syncAmbientRockets(list.length);
}

// Ambient decorative rockets: 10 baseline + 10 per factory built.
function syncAmbientRockets(factoryCount) {
  if (!_renderer || typeof _renderer.setAmbientRocketCount !== 'function') return;
  const n = (factoryCount == null ? allFactories().length : factoryCount);
  _renderer.setAmbientRocketCount(10 + 5 * n);
}
function syncColonies() {
  if (!_renderer) return;
  const map = {};
  for (const c of allColonies()) map[c.siteId] = c;
  _renderer.setColonies(map);
}
function syncOutposts() {
  if (!_renderer) return;
  // Tint the local player's outpost cubes with their seat colour (the
  // same colour as their rocket) so a cube reads as "mine" at a glance.
  _renderer.setOutpostColor(myRocketColour());
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
  // Supports must be chained before anything moves. Check this BEFORE the
  // fuel math (and before the server round-trip) so a broken stack reports
  // the real reason - a missing reactor / radiator / unmet therm balance -
  // instead of falling through to a misleading "not enough water" error.
  const act = isRocketActive();
  if (!act.active) {
    const why = (act.missing && act.missing.length)
      ? act.missing.join('; ')
      : (act.reason || 'support chain not satisfied');
    setStatus(`⛓️ Can't move - support chain broken: ${why}`);
    return false;
  }
  // Online: the server owns movement, fuel, and the hazard dice (seeded,
  // authoritative). The CLIENT still runs the same pre-flight the sandbox
  // does - it lists the hazards the route crosses, warns that each rad /
  // hazard space rolls individually, and offers FINAO (pay aqua) to skip
  // the generic ones - then sends the destination + the pay choice. The
  // server resolves every die and publishes the results in rocket.lastMove,
  // which the snapshot animator plays back. Skip the local dice path below.
  if (_online) {
    // Execute ONLY this turn's segments - a multi-turn Hohmann transfer's
    // later legs are NOT charged now. The server is sent these segments
    // (with the planner's Hohmann-aware burns) and charges just them.
    const turn1Segs = _plannedRoute.filter((s) => (s.turn || 1) === 1);
    if (!turn1Segs.length) { setStatus('Planned route has no current-turn segments.'); return false; }
    const destPlannerId = turn1Segs[turn1Segs.length - 1].to;
    const toSiteId = toServerId(_onlineMaps, destPlannerId);
    if (!toSiteId) { _onlineToast('That destination is not on the map.', 'error'); return false; }
    const segments = [];
    for (const s of turn1Segs) {
      const f = plannerIdToSlug(s.from);
      const t = plannerIdToSlug(s.to);
      if (!f || !t) { _onlineToast('That route is not on the map.', 'error'); return false; }
      segments.push({ from: f, to: t, burns: Number(s.burns) || 0, turn: 1 });
    }
    // Hazards along THIS turn's segments only.
    const hz = routeHazards(turn1Segs);
    const radHz = hz.filter((h) => h.site.type === 'radhaz');
    // Factory-assist maneuvers: an under-thrust liftoff (current site) or
    // landing (destination) is only legal with a factory there and is a
    // hazard roll unless a colony waives it. These join the generic
    // (skull / aerobrake) hazards for the pay-or-roll decision; the server
    // hard-blocks (and we toast) when there's no factory to assist.
    const thrStatsA = getActiveThrusterStats();
    const netThrust = thrStatsA && Number.isFinite(thrStatsA.thrust) ? thrStatsA.thrust : 0;
    const curSite = getRocketSite();
    const destSite = _activeData.byId?.[destPlannerId]
      || _activeData.sites.find((s) => s.id === destPlannerId);
    const assistHz = [];
    const liftG = curSite ? maneuverGate(curSite, netThrust) : { ok: true };
    if (curSite && !liftG.ok) { _onlineToast(`Can't lift off from ${curSite.name} - not enough thrust and no factory to assist.`, 'error'); return false; }
    if (liftG.assist && liftG.needsRoll && curSite) assistHz.push({ site: curSite, glyph: '🏭', label: 'liftoff assist' });
    const landG = destSite ? maneuverGate(destSite, netThrust) : { ok: true };
    if (destSite && !landG.ok) { _onlineToast(`Can't land on ${destSite.name} - not enough thrust and no factory to assist.`, 'error'); return false; }
    if (landG.assist && landG.needsRoll && destSite) assistHz.push({ site: destSite, glyph: '🏭', label: 'landing assist' });
    const genericHz = hz.filter((h) => h.site.type !== 'radhaz').concat(assistHz);
    let hazardPay = false;
    // Generic (skull / aerobrake / factory assist): pay aqua, roll, or
    // cancel. Each is a separate d6 - the modal says "cannot be undone".
    if (genericHz.length) {
      const choice = await hazardConfirmModal(genericHz);
      if (choice === 'cancel' || choice == null) {
        setStatus('Move cancelled - no aqua spent, no rolls made.');
        return false;
      }
      hazardPay = choice === 'pay';
      if (hazardPay) {
        const cost = genericHz.length * HAZARD_COST_PER;
        if (getAqua() < cost) {
          setStatus(`Need ${cost} aqua for FINAO - balance only ${getAqua()}.`);
          return false;
        }
      }
    }
    // Rad zones roll regardless (aqua can't bypass). Confirm so the
    // player sees the thrust/season math + that each zone rolls.
    if (radHz.length) {
      const thrStats = getActiveThrusterStats();
      const radThrust = thrStats && Number.isFinite(thrStats.thrust) ? thrStats.thrust : 0;
      let season = null;
      try { season = getSeason(); } catch { season = null; }
      const seasonBonus = season && season.name === 'red' ? 2 : 0;
      const choice = await radConfirmModal(
        radHz, radThrust, seasonBonus, radBypassThreshold(), radStackCards());
      if (choice === 'cancel' || choice == null) {
        setStatus('Move cancelled at the rad check.');
        return false;
      }
    }
    const ok = await submitOnlineOp({ kind: 'MOVE', toSiteId, hazardPay, segments });
    if (ok) {
      // Advance the local plan past this turn so a multi-turn route stays
      // visible for the next move (mirrors the server's route shift); clear
      // it when nothing's left.
      const remaining = _plannedRoute
        .filter((s) => (s.turn || 1) > 1)
        .map((s) => ({ ...s, turn: (s.turn || 1) - 1 }));
      if (remaining.length) {
        _plannedRoute = remaining;
        persistPlannedRoute();
        if (_renderer) _renderer.setRoute(remaining);
      } else {
        clearRoute();
      }
    }
    return ok;
  }
  const turn1 = _plannedRoute.filter((s) => s.turn === 1);
  if (!turn1.length) {
    setStatus('Planned route has no current-turn segments.');
    return false;
  }
  // Fuel consumption (new-game setting, default on): a move spends
  // fuel-per-burn × burns of water from the tank. Only THIS turn's
  // burns are charged - a Hohmann transfer spans multiple turns,
  // so coast/wait hops (burns: 0) cost nothing and the later turns
  // are charged when their Move fires. Use the planner's real
  // per-segment `burns` (NOT a per-segment fallback of 1, which
  // wrongly counted every coast hop as a burn).
  const turn1Burns = turn1.reduce((s, x) => s + (Number(x.burns) || 0), 0);
  const _thrFuel = getActiveThrusterStats();
  const fuelCost = (getFuelConsumption() && _thrFuel && Number.isFinite(_thrFuel.fuel))
    ? Math.ceil(_thrFuel.fuel * turn1Burns) : 0;
  if (fuelCost > 0 && getTankWater() < fuelCost) {
    const per = Math.round(_thrFuel.fuel * 100) / 100;
    setStatus(`⛽ Not enough water: this turn's move needs <strong>${fuelCost}</strong> `
      + `(${turn1Burns} burn${turn1Burns === 1 ? '' : 's'} this turn × ${per}), tank has <strong>${getTankWater()}</strong>. Refuel at LEO / a factory first.`);
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
  // Factory-assist pre-flight. A maneuver where net thrust <= site
  // size is permitted only because a factory is carrying it - this
  // turn's liftoff (departing the rocket's current site) and/or
  // landing (arriving at the journey's destination this turn). Each
  // such maneuver is a hazard roll unless a colony waives it. The
  // player can pay FINAO (aqua) to skip the rolls, roll (a 1 destroys
  // the rocket), or cancel.
  {
    const assistNet = (_thrFuel && Number.isFinite(_thrFuel.thrust)) ? _thrFuel.thrust : 0;
    const assistManeuvers = [];
    const curSite = getRocketSite();
    const liftG = maneuverGate(curSite, assistNet);
    if (liftG.assist && liftG.needsRoll && curSite) {
      assistManeuvers.push({ site: curSite, kind: 'liftoff', label: 'liftoff assist', glyph: '🏭', size: liftG.size });
    }
    const destId = _plannedRoute[_plannedRoute.length - 1].to;
    if (turn1[turn1.length - 1].to === destId) {
      const destSite = _activeData.sites.find((s) => s.id === destId);
      const landG = maneuverGate(destSite, assistNet);
      if (landG.assist && landG.needsRoll && destSite) {
        assistManeuvers.push({ site: destSite, kind: 'landing', label: 'landing assist', glyph: '🏭', size: landG.size });
      }
    }
    if (assistManeuvers.length) {
      const choice = await factoryAssistModal(assistManeuvers, assistNet);
      if (choice === 'cancel' || choice == null) {
        setStatus('Move cancelled - factory assist declined.');
        return false;
      }
      if (choice === 'pay') {
        const cost = assistManeuvers.length * HAZARD_COST_PER;
        if (!spendAqua(cost)) {
          setStatus(`Need ${cost} aqua for FINAO - balance only ${getAqua()}.`);
          return false;
        }
        logAction({
          type: 'factory_assist_finao',
          icon: '🏭',
          summary: `Paid ${cost} aqua (FINAO) for factory assist: ${assistManeuvers.map((m) => m.kind).join(' + ')}`,
          undoable: false,
          data: { cost, maneuvers: assistManeuvers.map((m) => ({ siteId: m.site.id, kind: m.kind })) },
        });
        lockUndo = true;
      } else if (choice === 'roll') {
        const rolls = await hazardRollModal(assistManeuvers);
        lockUndo = true;
        let boom = null;
        for (let i = 0; i < rolls.length; i++) {
          const r = rolls[i];
          const kind = assistManeuvers[i] ? assistManeuvers[i].kind : 'assist';
          logAction({
            type: 'factory_assist_roll',
            icon: '🏭',
            summary: `🏭 Factory assist ${kind} at ${r.site.name} d6=${r.d6}${r.d6 === 1 ? ' - MISHAP' : ' ✓'}`,
            undoable: false,
            data: { siteId: r.site.id, d6: r.d6, kind },
          });
          if (r.d6 === 1 && !boom) boom = r;
        }
        if (boom) {
          await explodeRocket(boom.site.id);
          return false;
        }
      }
    }
  }
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
    // FINAL thrust after every modifier (reactor thrustMod, weight class,
    // afterburn, solar zone) - getActiveThrusterStats folds them all in, so
    // the rad bypass + at-risk math uses the same number the triangle shows,
    // not the raw card thrust.
    const thrStats = getActiveThrusterStats();
    radThrust = thrStats && Number.isFinite(thrStats.thrust) ? thrStats.thrust : 0;
    let season = null;
    try { season = getSeason(); } catch { season = null; }
    radSeasonBonus = season && season.name === 'red' ? 2 : 0;
    const threshold = radBypassThreshold();
    const radChoice = await radConfirmModal(
      radHazards, radThrust, radSeasonBonus, threshold, radStackCards());
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
  // Capture the pre-move position for the rollback fallback (used if
  // a saved move can't be resumed). The full resumable ctx is built
  // and persisted just below, after the move commits.
  const preMoveSiteId = _rocketSiteId;
  const preMoveRoute = _plannedRoute.map((s) => ({ ...s }));
  const preMoveTrail = _rocketTrail.map((t) => ({ ...t }));
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
  // A chit is only retrieved if a crew is aboard to carry it. On
  // return to LEO any carried chits resolve: BACK (flipped) if a crew
  // brought them home, FRONT (face-up) if no crew is aboard.
  const crewAboard = stackHasCrew();
  const willAwardChit = arrivedZone && arrivedZone !== 'Earth' && !isZoneVisited(arrivedZone) && crewAboard;
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
  // Resumable queue context. Persisted after every committed roll /
  // choice so a tab close mid-resolution can pick up at the next
  // unresolved hazard on reload (per-roll resume). fromSiteId / route
  // / trail are the rollback fallback if the saved state can't be
  // safely resumed.
  const ctx = {
    turn1: turn1.map((s) => ({ ...s })),
    qi: 0,
    lastIdx: 0,
    payRemainingGeneric: (hazardChoice === 'pay'),
    radWillRoll, radThrust, radSeasonBonus,
    hazardChoice,
    genericCount: genericHazards.length,
    newSiteId, arrivedName, arrivedZone,
    willAwardChit, willCashIn, chitsToCash,
    fuelCost, lockUndo,
    fromSiteId: preMoveSiteId,
    route: preMoveRoute,
    trail: preMoveTrail,
  };
  persistMoveProgress(ctx);
  return runMoveQueue(ctx, false);
}

// Hazard-resolution queue + move completion, factored out of
// moveRocket so it can be re-entered on reload (per-roll resume).
// `ctx` carries the saved progress; a fresh run starts at qi 0, a
// resume at the next unresolved hazard. The locals below re-bind the
// values the loop reads so its body is identical either way. Persists
// ctx after each committed step; clears it at every exit.
async function runMoveQueue(ctx, resuming) {
  const turn1 = ctx.turn1;
  const newSiteId = ctx.newSiteId;
  const arrivedName = ctx.arrivedName;
  const arrivedZone = ctx.arrivedZone;
  const willAwardChit = ctx.willAwardChit;
  const willCashIn = ctx.willCashIn;
  const chitsToCash = ctx.chitsToCash;
  const radWillRoll = ctx.radWillRoll;
  const radThrust = ctx.radThrust;
  const radSeasonBonus = ctx.radSeasonBonus;
  const hazardChoice = ctx.hazardChoice;
  const lockUndo = ctx.lockUndo;
  const genericHazards = { length: ctx.genericCount };
  const hazards = routeHazards(turn1);
  // Move queue. Walk turn1 segments in order, pausing at each
  // hazard node to resolve it (animate-to + roll modal). An
  // early critical kills the ship before later hazards even
  // see the dice. Trail + _rocketSiteId update incrementally
  // so an explosion mid-route reports the right location.
  setStatus(resuming
    ? `🛸 Resuming move to <strong>${esc(arrivedName)}</strong>…`
    : `🛸 Moving rocket to <strong>${esc(arrivedName)}</strong>…`);
  const hazardIndexById = new Map();
  for (const h of hazards) {
    const idx = turn1.findIndex((s) => s.to === h.site.id);
    if (idx >= 0) hazardIndexById.set(h.site.id, { idx, hazard: h });
  }
  const orderedHazards = [...hazardIndexById.values()].sort((a, b) => a.idx - b.idx);
  let lastIdx = ctx.lastIdx;
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
    ctx.lastIdx = lastIdx;
    persistMoveProgress(ctx);
  };
  // Tracks whether the player switched to "pay for the rest"
  // mid-queue; flips remaining generic hazards to the paid path
  // without re-rolling. Starts true when the upfront choice was
  // already 'pay' so the queue uniformly checks one flag.
  let payRemainingGeneric = ctx.payRemainingGeneric;
  let earlyHalt = false;
  let haltSite = null;
  for (let qi = ctx.qi; qi < orderedHazards.length; qi++) {
    const { idx, hazard } = orderedHazards[qi];
    await advanceTo(idx);
    const isRad = hazard.site.type === 'radhaz';
    if (isRad) {
      if (!radWillRoll) {
        // Bypass already logged upfront; just animate past.
      } else {
        const { rolls: radRolls, decommission } = await radHardnessRollModal(
          [hazard], radStackCards(), radThrust, radSeasonBonus,
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
          let crewToLeo = 0;
          for (const cardId of decommission) {
            const stack = getRocketStack();
            const ridx = stack.findIndex((s) => s.id === cardId);
            if (ridx < 0) continue;
            const slot = stack[ridx];
            const isCrew = slot.kind === 'crew' || CREW.some((c) => c.id === cardId);
            rocketRemoveCard(ridx);
            if (isCrew) {
              // Crew never goes to the hand - a rad-failed crew
              // re-spawns in the LEO Stack (keeping its face).
              addCardToLeo({ id: cardId, kind: 'crew', face: slot.face });
              crewToLeo++;
            } else {
              const card = PATENTS_BY_ID[cardId];
              if (card) { const r = addToHand(card); if (r && r.ok) lost++; }
            }
          }
          logAction({
            type: 'rad_decommission',
            icon: '☢',
            summary: `☢ ${esc(hazard.site.name)}: ${lost} card${lost === 1 ? '' : 's'} decommissioned to hand`
              + (crewToLeo ? `, ${crewToLeo} crew to LEO stack` : ''),
            undoable: false,
            data: { siteId: hazard.site.id, decommission, count: lost, crewToLeo },
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
          // Committed outcome - the rocket is destroyed, so there's
          // nothing to resume.
          clearMoveProgress();
          await explodeRocket(r.site.id);
          return false;
        }
      }
    }
    // This hazard is resolved + logged. Advance the checkpoint so a
    // reload resumes at the NEXT hazard and never re-rolls this one.
    ctx.qi = qi + 1;
    ctx.payRemainingGeneric = payRemainingGeneric;
    persistMoveProgress(ctx);
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
          ctx.payRemainingGeneric = true;
          persistMoveProgress(ctx);
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
    // Resolved outcome (stop / stranded) - carry-over handled below,
    // so there's nothing left to resume.
    clearMoveProgress();
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
    lastIdx = turn1.length;
    ctx.lastIdx = lastIdx;
    persistMoveProgress(ctx);
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
    const ownerId = firstCrewId();
    awardChitForZone(arrivedZone, getTurn(), ownerId);
    const s = getChitSides(arrivedZone);
    const owner = crewDisplayName(ownerId);
    logAction({
      type: 'glory_award',
      icon: '🏆',
      summary: `Glory chit earned - ${arrivedZone} (front ${s.front} / back ${s.back} VP)`
        + (owner ? `, held by ${owner}` : ''),
      undoable: false,
    });
  }
  if (willCashIn) {
    // Crew aboard at home -> flip to the BACK value; no crew -> the
    // chits score their FRONT value face-up.
    const broughtHome = stackHasCrew();
    const res = broughtHome
      ? cashInChits(`returned to ${arrivedName}`)
      : resolveChitsFront(`returned crewless to ${arrivedName}`);
    // _moveSnapshot is null on a resumed move (it lives only in memory);
    // undo is locked for hazardous moves anyway, so guard the write.
    if (_moveSnapshot) {
      _moveSnapshot.cashedChits = chitsToCash;
      _moveSnapshot.cashedVps   = res.vps;
    }
    const n = (chitsToCash || []).length;
    logAction({
      type: 'glory_cash',
      icon: broughtHome ? '💰' : '🎖',
      summary: broughtHome
        ? `Flipped ${n} chit${n === 1 ? '' : 's'} (back) for ${res.vps} VP`
        : `${n} crewless chit${n === 1 ? '' : 's'} score face-up (front) for ${res.vps} VP`,
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
  // Move fully resolved - clear the resume checkpoint.
  clearMoveProgress();
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
  // Online: the server UNDO op unwinds the most recent functional op
  // on the turn (rebuilds from turnBaseState), which is exactly what
  // the local sandbox undo does - except the server is authoritative.
  // The snapshot re-hydrate will restore the rocket position, tank,
  // and the move budget, and refreshTurnBudget will flip the tag back
  // from "↩ Undo move" to "move:1". roll_blocks_undo / nothing_to_undo
  // come back via humanizeOnlineOpError.
  if (_online) {
    if (!isOnlineMyTurn()) return false;
    return await submitOnlineOp({ kind: 'UNDO' });
  }
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
// Config modal (sidepanel ⚙). Fullscreen toggle, a jump to the nav /
// route settings, and the canonical zone-data visualisation controls
// (show overlay, fill, border opacity). All zone-view settings persist
// and apply live to the active renderer.
function openConfigModal() {
  document.querySelector('.config-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay config-overlay';
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  const isFs = !!document.fullscreenElement;
  const viz = loadDbgBool(STORAGE_ZONE_VIZ, true);
  const fill = loadDbgBool(STORAGE_ZONE_FILL, true);
  const op = loadDbgNumber(STORAGE_ZONE_VIZ_OP, 10, 1, 100);
  const curved = loadDbgBool(STORAGE_ZONE_CURVED, true);

  const panel = document.createElement('div');
  panel.className = 'config-panel';
  panel.innerHTML = `
    <button type="button" class="modal-x" aria-label="Close (Esc)" title="Close (Esc)">×</button>
    <h2 class="config-title">⚙ Config</h2>
    <div class="config-section">
      <button type="button" class="modal-btn config-fs">${isFs ? '⤬ Exit fullscreen' : '⛶ Fullscreen'}</button>
      <button type="button" class="modal-btn config-nav">🧭 Nav settings</button>
    </div>
    <div class="config-section">
      <div class="config-section-title">Zone data</div>
      <label class="dbg-check"><input type="checkbox" class="cfg-zone-viz" ${viz ? 'checked' : ''}><span>Visualize zone data</span></label>
      <label class="dbg-check"><input type="checkbox" class="cfg-zone-fill" ${fill ? 'checked' : ''}><span>Fill zones</span></label>
      <label class="dbg-check"><input type="checkbox" class="cfg-zone-curved" ${curved ? 'checked' : ''}><span>Curved zone border</span></label>
      <label class="dbg-slider"><span>Zone opacity <em class="cfg-zone-op-val">${op}%</em></span>
        <input type="range" class="cfg-zone-op" min="1" max="100" step="1" value="${op}"></label>
      <button type="button" class="modal-btn cfg-zone-reset">↺ Reset to default</button>
    </div>
  `;
  overlay.appendChild(panel);
  panel.querySelector('.modal-x').addEventListener('click', close);
  panel.querySelector('.config-fs').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.();
    close();
  });
  panel.querySelector('.config-nav').addEventListener('click', () => { close(); openGameSettingsModal(); });
  const vizCb  = panel.querySelector('.cfg-zone-viz');
  const fillCb = panel.querySelector('.cfg-zone-fill');
  const curvedCb = panel.querySelector('.cfg-zone-curved');
  const opEl   = panel.querySelector('.cfg-zone-op');
  const opValEl = panel.querySelector('.cfg-zone-op-val');
  vizCb.onchange = () => {
    persistDbg(STORAGE_ZONE_VIZ, vizCb.checked ? '1' : '0');
    if (_renderer) _renderer.setOption('visualizeZones', vizCb.checked);
  };
  fillCb.onchange = () => {
    persistDbg(STORAGE_ZONE_FILL, fillCb.checked ? '1' : '0');
    if (_renderer) _renderer.setOption('zoneFill', fillCb.checked);
  };
  curvedCb.onchange = () => {
    persistDbg(STORAGE_ZONE_CURVED, curvedCb.checked ? '1' : '0');
    if (_renderer) _renderer.setOption('zoneCurved', curvedCb.checked);
  };
  opEl.oninput = () => {
    const v = Number(opEl.value);
    opValEl.textContent = v + '%';
    persistDbg(STORAGE_ZONE_VIZ_OP, v);
    if (_renderer) _renderer.setOption('zoneOpacity', v / 100);
  };
  // Reset the zone visuals to defaults (visualize on, fill on, 10%,
  // curved on). Clears the saved keys so the defaults persist, then
  // re-applies to the renderer and the modal controls.
  panel.querySelector('.cfg-zone-reset').addEventListener('click', () => {
    for (const k of [STORAGE_ZONE_VIZ, STORAGE_ZONE_FILL, STORAGE_ZONE_VIZ_OP, STORAGE_ZONE_CURVED]) {
      try { localStorage.removeItem(k); } catch { /* private mode */ }
    }
    if (_renderer) applyZoneViewConfig(_renderer);
    vizCb.checked = true;
    fillCb.checked = true;
    curvedCb.checked = true;
    opEl.value = 10;
    opValEl.textContent = '10%';
  });
  mountOverlay(overlay);
}

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
    ${_online ? `
    <div class="route-options-debug">
      <button type="button" class="popup-btn route-options-sim-btn">
        🧪 Simulate planned move (debug)
      </button>
      <p class="muted route-options-manual-help">
        Dry-runs this turn's planned move and reports the fuel-step cost
        without spending anything. Plan a route first.
      </p>
      <p class="route-options-sim-result" hidden></p>
    </div>` : ''}
    ${(!_online && currentSandboxId()) ? `
    <div class="route-options-danger">
      <button type="button" class="popup-btn danger route-options-abandon-btn">
        🗑 Abandon this sandbox game
      </button>
      <p class="muted route-options-manual-help">
        Permanently deletes this solo game and returns to the lobby.
        This can't be undone.
      </p>
    </div>` : ''}
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
  const simBtn = panel.querySelector('.route-options-sim-btn');
  if (simBtn) {
    const resEl = panel.querySelector('.route-options-sim-result');
    const showRes = (txt, cls) => {
      if (!resEl) return;
      resEl.hidden = false;
      resEl.textContent = txt;
      resEl.className = `route-options-sim-result ${cls || 'muted'}`;
    };
    simBtn.addEventListener('click', async () => {
      // Dry-run THIS turn's planned move against the server (debug:true)
      // so the player can preview the fuel-step cost before committing.
      const turn1 = (_plannedRoute || []).filter((s) => (s.turn || 1) === 1);
      if (!turn1.length) { showRes('Plan a route first - no current-turn segments to simulate.'); return; }
      const toSiteId = _plannedRoute[_plannedRoute.length - 1].to;
      const segments = turn1.map((s) => ({ from: s.from, to: s.to, burns: s.burns, turn: s.turn }));
      simBtn.disabled = true;
      showRes('Simulating…');
      try {
        const r = await submitGameOp(
          _onlineGameId, { kind: 'MOVE', toSiteId, segments, debug: true }, _onlineMe.token);
        if (r && r.ok) {
          const delta = (r.tankBefore != null && r.tankAfter != null)
            ? `  (tank ${r.tankBefore} -> ${r.tankAfter})` : '';
          showRes(`✓ ${r.log || 'Move would succeed.'}${delta}`, 'ok');
        } else {
          showRes(`✗ Would fail: ${humanizeOnlineOpError(r && r.error)}`, 'bad');
        }
      } catch {
        showRes('Simulation failed - server unreachable.', 'bad');
      } finally {
        simBtn.disabled = false;
      }
    });
  }
  const abandonBtn = panel.querySelector('.route-options-abandon-btn');
  if (abandonBtn) {
    abandonBtn.addEventListener('click', async () => {
      const ok = await confirmModal({
        title: '🗑 Abandon sandbox game',
        body: 'Permanently delete this solo game and return to the lobby? This can\'t be undone.',
        yes: '🗑 Abandon', no: 'Cancel',
      });
      if (!ok) return;
      abandonSandboxGame(currentSandboxId());
      close();
      // Full navigation to the lobby (drops this game's /sandbox/<id>
      // URL); a fresh boot lands on the lobby list.
      try {
        const cur = new URL(window.location.href);
        const v = cur.searchParams.get('v');
        const url = appBase() + 'lobby'
          + (v ? '?v=' + encodeURIComponent(v) : '');
        window.location.assign(url);
      } catch { window.location.assign('../../lobby'); }
    });
  }

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
  // ET Production action (rulebook I8). Shown whenever the player
  // owns a factory at this site (the factory does the producing, so
  // the rocket need not be parked here) AND the player's hand has at
  // least one card whose spectral matches the factory's spectral.
  // Card is produced Black-Side-up into the colocated outpost (or a
  // fresh outpost the player creates inline).
  {
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
  // Pump fuel from a colocated outpost into the rocket. Surfaces one
  // action per owned outpost at the rocket's site that holds water, when
  // the rocket has tank room. Free action.
  if (rocketSite && site.id === rocketSite.id && getRocketStack().length > 0) {
    const totals = getStackTotals();
    const room = Math.max(0, getTankMax() - (totals.dryMass || 0) - getTankWater());
    for (const letter of OUTPOST_LETTERS) {
      const op = getOutpost(letter);
      if (!op || op.siteId !== site.id || (op.tank | 0) <= 0) continue;
      const max = Math.min(op.tank | 0, room);
      actions.push({
        label: `💧 Pump from Outpost ${letter} (${op.tank})`,
        variant: max > 0 ? 'rocket' : 'secondary',
        disabled: max <= 0,
        title: max > 0
          ? `Transfer up to ${max} water from Outpost ${letter} into the rocket tank.`
          : 'Rocket tank is full.',
        onClick: () => {
          if (max <= 0) return;
          doPumpOutpostFuel(letter, max);
          _renderer.clearSitePopup();
        },
      });
    }
  }
  // (Forming a rocket from an outpost is no longer a bulk "lift"
  // action. Per the user's model an outpost transfers cards to the
  // rocket stack ONE at a time via the stack inspector's transfer
  // buttons; the first card sent to an empty rocket forms it at the
  // outpost's site. See getColocatedDestinations + transferOneCard.)
  // Outpost inspector shortcut. When an outpost sits at this site,
  // surface a button that opens its stack inspector directly - a
  // convenience so the player doesn't have to hunt for the stack
  // switcher. Pure inspection, so it lands just before Navigate-to.
  {
    const localOutposts = Object.values(getOutposts()).filter((o) => o.siteId === site.id);
    for (const op of localOutposts) {
      const n = op.cards.length;
      actions.push({
        label: `🏛${op.letter} Open Outpost`,
        variant: 'secondary',
        inspect: true,   // viewing is allowed any time, even off-turn
        title: `Open Outpost ${op.letter}'s stack (${n} card${n === 1 ? '' : 's'}, ${op.tank} water).`,
        onClick: () => {
          openOutpostStackModal(op.letter);
          _renderer.clearSitePopup();
        },
      });
    }
  }
  // Navigate-to ALWAYS sits last (CLAUDE.md style rule). It's a
  // pure inspection affordance - no state mutation - so any new
  // game-action buttons land above it.
  actions.push({
    label: 'Navigate to →',
    variant: 'secondary',
    inspect: true,   // pure inspection - always available
    disabled: !canNavigate,
    onClick: () => {
      if (!canNavigate) return;
      enterRoutingMode(site);
      _renderer.clearSitePopup();
    },
  });
  // Online: grey out every state-mutating action when it isn't my turn
  // (or in spectator mode) so the player isn't confused by a button that
  // the server will just reject. Pure-inspection actions (inspect:true -
  // Navigate-to, Open Outpost) stay live. Mirrors the toolbar lock.
  if (_online && (_spectator || !isOnlineMyTurn())) {
    for (const a of actions) {
      if (a.inspect) continue;
      a.disabled = true;
      a.title = _spectator ? 'Spectator - view only.' : 'Waiting for your turn.';
    }
  }
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
  // Land / liftoff thrust gate. Net (band-adjusted) thrust must
  // strictly exceed a real site's size to lift off from the origin
  // or land on the destination. A factory at the site can carry an
  // under-thrust maneuver (factory assist, resolved as a hazard roll
  // at move time) so we only HARD-block here when the maneuver is
  // under-thrust AND no factory is present. Orbital waypoints have
  // size 0 so they never block.
  const netThrust = thrStats && Number.isFinite(thrStats.thrust) ? thrStats.thrust : 0;
  const liftGate = maneuverGate(origin, netThrust);
  const landGate = maneuverGate(destSite, netThrust);
  if (!liftGate.ok) {
    setStatus(
      `🚀 Can't lift off from <strong>${esc(origin.name)}</strong>: net thrust `
      + `<strong>${netThrust}</strong> must exceed its size <strong>${liftGate.size}</strong> `
      + `(or build a factory there for an assist). Shed mass or fit a stronger thruster.`
    );
    _renderer.setRoute(null);
    _renderer.setRouteEndpoints(origin.id, destSite.id);
    return false;
  }
  if (!landGate.ok) {
    setStatus(
      `🛬 Can't land on <strong>${esc(destSite.name)}</strong>: net thrust `
      + `<strong>${netThrust}</strong> must exceed its size <strong>${landGate.size}</strong> `
      + `(or a factory there for an assist).`
    );
    _renderer.setRoute(null);
    _renderer.setRouteEndpoints(origin.id, destSite.id);
    return false;
  }
  const assistNote = (liftGate.assist || landGate.assist)
    ? ` <em class="muted">(🏭 factory assist${(liftGate.needsRoll || landGate.needsRoll) ? ' - hazard roll on the move' : ' - free, colony present'})</em>`
    : '';
  const metricPriority = routeMetricPriority();
  const result = planRoute(_activeData, origin.id, destSite.id, {
    thrust,
    metricPriority,
  });
  if (!result || !result.segments.length) {
    // Every map location is reachable from LEO (the route graph has no
    // disjoint nodes), so a genuine "no path" is almost impossible.
    // When the planner still comes back empty it's nearly always that
    // one endpoint isn't a recognised graph node (a stale board, or a
    // rocket position that didn't resync from the server). Dump the
    // specifics to the console so the failure is explainable, then give
    // the player the actual reason instead of a blanket "no route".
    const g = _activeData;
    const inGraph = (id) => !!(g && g.byId && g.byId[id]);
    const degree = (id) =>
      (g && g.neighbors && g.neighbors.get(id)) ? g.neighbors.get(id).size : 0;
    const diag = {
      origin: { id: origin.id, name: origin.name, inGraph: inGraph(origin.id), neighbors: degree(origin.id) },
      dest: { id: destSite.id, name: destSite.name, inGraph: inGraph(destSite.id), neighbors: degree(destSite.id) },
      thrust,
      metricPriority,
      resultNull: !result,
      segments: result ? result.segments.length : 0,
      online: _online,
      graph: g
        ? { sites: Array.isArray(g.sites) ? g.sites.length : null, hasNeighbors: !!g.neighbors, hasEdgeLabels: !!g.edgeLabels }
        : null,
    };
    console.warn('[route] planRoute returned no path', diag);
    let msg;
    if (!diag.origin.inGraph) {
      msg = `🚀 The rocket's position isn't on the map right now. Reload the page, then plan the route again.`;
    } else if (!diag.dest.inGraph) {
      msg = `🛸 Couldn't find <strong>${esc(destSite.name)}</strong> on the map. Reload the page, then try again.`;
    } else {
      msg = `No route found from <strong>${esc(origin.name)}</strong> to `
        + `<strong>${esc(destSite.name)}</strong> at thrust <strong>${thrust}</strong>.`;
    }
    setStatus(msg);
    _renderer.setRoute(null);
    _renderer.setRouteEndpoints(origin.id, destSite.id);
    return false;
  }
  _routeFrom = origin;
  _routeTo = destSite;
  _plannedRoute = result.segments;
  persistPlannedRoute();
  // Mirror the freshly-planned route up to the server so it persists +
  // truncates as the rocket walks it (online only, no-op solo).
  submitSetRouteOnline();
  _renderer.setRoute(result.segments);
  _renderer.setRouteEndpoints(origin.id, destSite.id);
  document.getElementById('route-clear').hidden = false;
  const turns = result.totalTurns;
  setStatus(
    `🛸 <strong>${esc(origin.name)}</strong> → <strong>${esc(destSite.name)}</strong>: `
    + `<strong class="big">${result.totalBurns}</strong> burn${result.totalBurns === 1 ? '' : 's'} over `
    + `<strong>${turns}</strong> turn${turns === 1 ? '' : 's'} `
    + `(thrust ${thrust}).${assistNote}`
  );
  logRouteBudget(origin, destSite, result, thrStats, thrust);
  return true;
}

// Console breakdown of how a planned route reaches its burn + fuel
// verdict. Console-only (players never open it): it spells out the gross
// burns, the flyby credit applied, the net total, and the tank's burn
// capacity BOTH ways - the FT-step model (TOTAL CAN BURN) and the actual
// water gate the move charges - so any disagreement between the two is
// visible at a glance. Wrapped in try/catch: logging must never break a
// plan.
function logRouteBudget(origin, destSite, result, thrStats, thrust) {
  try {
    const fpb     = thrStats && Number.isFinite(thrStats.fuel) ? thrStats.fuel : null;          // FTs per burn
    const ftTotal = thrStats && Number.isFinite(thrStats.fuelSteps) ? thrStats.fuelSteps : null;
    const canBurn = thrStats && Number.isFinite(thrStats.burnsAvailable) ? thrStats.burnsAvailable : null;
    const wet     = thrStats && Number.isFinite(thrStats.wetMass) ? thrStats.wetMass : null;
    const dry     = thrStats && Number.isFinite(thrStats.dryMass) ? thrStats.dryMass : null;
    const tank    = getTankWater();
    const gross   = Number.isFinite(result.grossBurns) ? result.grossBurns : result.totalBurns;
    const flyby   = Number.isFinite(result.flybyBonus) ? result.flybyBonus : 0;
    const net     = result.totalBurns;
    // Water the move gate would charge for the WHOLE journey (it actually
    // charges per turn; this is the all-turns figure for the verdict).
    const fuelOn  = getFuelConsumption();
    const water   = (fuelOn && fpb != null) ? Math.ceil(fpb * net) : 0;
    console.group(`[route] ${origin.name} → ${destSite.name} (thrust ${thrust})`);
    console.log(`BURNS:        ${gross}`);
    console.log(`FLY BY BONUS: +${flyby}`);
    console.log(`TOTAL Burns:  ${net}   (over ${result.totalTurns} turn${result.totalTurns === 1 ? '' : 's'})`);
    console.log(`Fuel (wet mass): ${wet}`);
    console.log(`dry Mass:        ${dry}`);
    console.log(`Number of FTs total: ${ftTotal}`);
    console.log(`FTs per BURN:    ${fpb}`);
    console.log(`TOTAL CAN BURN:  ${canBurn}`);
    console.log(`tank water: ${tank}   whole-route water cost: ${water}${fuelOn ? '' : ' (fuel-spend off)'}`);
    const okFt    = canBurn == null ? null : net <= canBurn;
    const okWater = !fuelOn ? true : tank >= water;
    console.log(`-> enough fuel (FT-step model): ${okFt == null ? 'n/a' : (okFt ? 'YES' : 'NO')}  (need ${net}, can burn ${canBurn})`);
    console.log(`-> enough water (move gate):    ${okWater ? 'YES' : 'NO'}  (need ${water}, tank ${tank})`);
    console.groupEnd();
  } catch { /* logging must never break planning */ }
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
//
// In ONLINE mode the confirm button instead dispatches the
// server's AUCTION_START op for the card's deck type - the
// server pops the top of that deck and opens a competitive
// auction for every player. Note the auctioned card may not
// be the specific `card` the user clicked (the server always
// goes off the deck top), so the confirm modal shows a note
// surfacing that.
function doAuctionCard(card) {
  if (!card) return;
  const mode = getMarketMode();
  const online = _online;
  openAuctionConfirmModal({
    card,
    mode,
    renderCardFn: renderCard,
    multiplayer: online,
    // Resolve each support deck's TOP card into its full
    // record so the confirm modal can render the actual card
    // art (user 2026-05-24: "please show the bonus cards in
    // full"). Empty decks contribute nothing; the modal just
    // shows fewer cards.
    bonusCards: supportBonusDecks(card)
      .map((t) => cardById(peekTop(t)))
      .filter(Boolean),
    onConfirm: () => {
      if (online) {
        // Multiplayer path: fire the server's AUCTION_START for
        // this card's deck type. The server's auction overlay
        // (renderOnlineAuction) takes over from here for all
        // players. submitOnlineOp handles turn / busy guards
        // and toasts errors.
        submitOnlineOp({ kind: 'AUCTION_START', deckType: card.type });
        return;
      }
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
    // Expansion-only cards (GW thrusters today) can't be played
    // yet, but they're fully inspectable: tap opens the read-only
    // card view and the Flip button shows both faces up close. Only
    // the drag / tap-to-ADD handlers are skipped (the engine refuses
    // to stack them); a CSS badge signals the "coming soon" intent.
    if (card.type === 'gw-thruster') {
      el.classList.add('is-expansion');
      const badge = document.createElement('div');
      badge.className = 'card-expansion-badge';
      badge.textContent = 'Coming soon';
      el.appendChild(badge);
      el.addEventListener('click', (ev) => {
        if (ev.target.closest('.card-flip, .card-rotate')) return;
        openDeckTapModal(card, asKind, { inspectOnly: true });
      });
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
// A glory chit needs a crew aboard to be retrieved / carried home.
// Crew slots carry kind 'crew' (older records fall back to the
// CREW id list).
function isCrewSlot(s) {
  return s.kind === 'crew' || CREW.some((c) => c.id === s.id);
}
function stackHasCrew() {
  return getRocketStack().some(isCrewSlot);
}
// The crew that retrieves a chit on a first-landing. We assign the
// chit to the first crew aboard; its fate (returns home vs. leaves)
// then drives that chit's front/back resolution.
function firstCrewId() {
  const slot = getRocketStack().find(isCrewSlot);
  return slot ? slot.id : null;
}
// Display name for a crew id (primary face), for chit-token owner tags.
function crewDisplayName(crewId) {
  const c = crewId ? CREW_BY_ID[crewId] : null;
  return (c && c.faces && c.faces.primary && c.faces.primary.name) || crewId || '';
}
// Suppress reconciliation during the colonize commit, which removes
// the crew then re-adds it on a rollback path; colonize resolves its
// own crew's chits explicitly after success.
let _suppressChitReconcile = false;
// When a chit's owning crew is no longer aboard, flip that chit
// face-up (FRONT). Ownerless (legacy) chits flip only when no crew
// is aboard at all. Fires on every rocket-stack change.
function reconcileChitOwners() {
  if (_suppressChitReconcile) return;
  const carried = getChits();
  if (!carried.length) return;
  const present = new Set(getRocketStack().filter(isCrewSlot).map((s) => s.id));
  const anyCrew = present.size > 0;
  // Group orphaned chits by owning crew so each resolves with its
  // own log line; ownerless ones resolve as a synthetic group.
  const orphanCrews = new Set();
  let ownerlessOrphan = false;
  for (const c of carried) {
    if (c.crewId) { if (!present.has(c.crewId)) orphanCrews.add(c.crewId); }
    else if (!anyCrew) ownerlessOrphan = true;
  }
  for (const crewId of orphanCrews) {
    const res = resolveChitsForCrew(crewId, 'front', 'crew left the rocket');
    if (res.vps) {
      logAction({
        type: 'glory_front',
        icon: '🎖',
        summary: `${res.chits.length} glory chit${res.chits.length === 1 ? '' : 's'} flipped face-up `
          + `for ${res.vps} VP (${crewDisplayName(crewId)} left the rocket)`,
        undoable: false,
      });
    }
  }
  if (ownerlessOrphan) {
    const res = resolveChitsFront('no crew aboard to carry chits');
    if (res.vps) {
      logAction({
        type: 'glory_front',
        icon: '🎖',
        summary: `${res.chits.length} glory chit${res.chits.length === 1 ? '' : 's'} flipped face-up for ${res.vps} VP (no crew aboard)`,
        undoable: false,
      });
    }
  }
}

// Card-like DOM token for a glory chit. Used in the rocket stack
// (transit = in-transit, two-sided, needs a crew to bring home) and
// in the LEO stack (resolved to its front/back side).
function buildChitToken(zone, { side = null, transit = false, crewId = null } = {}) {
  const sides = getChitSides(zone);
  const el = document.createElement('div');
  el.className = 'chit-token' + (transit ? ' chit-transit' : ` chit-${side}`);
  const vp = transit
    ? `${sides.front} / ${sides.back}`
    : `+${side === 'back' ? sides.back : sides.front}`;
  const sideLabel = transit ? 'in transit' : side;
  const owner = crewId ? crewDisplayName(crewId) : '';
  el.innerHTML = `
    <span class="chit-token-emoji" aria-hidden="true">🎖</span>
    <span class="chit-token-zone">${esc(zone)}</span>
    <span class="chit-token-vp">${esc(vp)} VP</span>
    <span class="chit-token-side">${esc(sideLabel)}</span>
    ${owner ? `<span class="chit-token-owner" title="Earned by ${esc(owner)}">${esc(owner)}</span>` : ''}`;
  return el;
}

// Classify a colony's site for VP: submarine (+2) beats astrobiology
// (+1) when a site is both (e.g. Europa). Bernal isn't a flag yet, so
// it falls through to the default rate. Flags live on the runtime-
// merged site objects (_activeData), not data/sites.js.
function colonyTypeOfSite(siteId) {
  const site = _activeData && (_activeData.byId?.[siteId]
    || _activeData.sites?.find((s) => s.id === siteId));
  if (!site) return null;
  if (site.submarine)    return 'submarine';
  if (site.astrobiology) return 'astrobiology';
  return null;
}

function paintGlory() {
  const host = document.getElementById('browse-milestones');
  if (!host) return;
  const vps   = getVps();
  const score = computeEndgameScore({
    ownerId: SANDBOX_OWNER_ID,
    colonyTypeOf: colonyTypeOfSite,
  });

  // --- Spectrum exploitation track ----------------------------------
  // One column per spectral; a translucent red disc sits on the cell
  // matching the factory count (1 -> 8, 2 -> 5, 3+ -> 4). 0 factories
  // -> no disc. Steps down as more factories of that spectral land.
  const SPECTRALS = ['C', 'S', 'M', 'V', 'D', 'H'];
  const spectrumCols = SPECTRALS.map((spec) => {
    const n  = score.spectralBonus.perSpectralCount?.[spec] || 0;
    const vp = score.spectralBonus.byType?.[spec] || 0;
    const step = n <= 0 ? -1 : Math.min(n, SPECTRAL_DIMINISHING_SCHEDULE.length) - 1;
    const cells = SPECTRAL_DIMINISHING_SCHEDULE.map((v, i) => {
      const active = i === step;
      return `<div class="spectrum-cell${active ? ' is-active' : ''}">
        ${v}${active ? '<span class="spectrum-disc" aria-hidden="true"></span>' : ''}
      </div>`;
    }).join('');
    return `<div class="spectrum-col${n > 0 ? ' has-factories' : ''}">
      <span class="industrialize-spectral-badge spectral-${esc(spec)}">${esc(spec)}</span>
      <div class="spectrum-track">${cells}</div>
      <span class="spectrum-count">${n}×</span>
      <span class="spectrum-vp">+${vp}</span>
    </div>`;
  }).join('');

  // --- Tokens (+1 each) ---------------------------------------------
  const tokenRows = [
    ['🚀 Rocket',    score.tokens.rocket],
    ['🟡 Claims',    score.tokens.claims],
    ['🏭 Factories', score.tokens.factories],
    ['🏛 Outposts',  score.tokens.outposts],
  ].map(([label, n]) =>
    `<li><span>${label}</span><strong>+${n} VP</strong></li>`
  ).join('');

  // --- Colony locations (by type) -----------------------------------
  const cb = score.colonies.byType;
  const colonyRows = [
    ['🌿 Astrobiology', cb.astrobiology, COLONY_VP.astrobiology],
    ['🌊 Submarine',    cb.submarine,    COLONY_VP.submarine],
    ['🏙 Bernal',       cb.bernal,       COLONY_VP.bernal],
    ['🌐 Other',        cb.other,        COLONY_VP.other],
  ].filter(([, n]) => n > 0)
    .map(([label, n, per]) =>
      `<li><span>${label} <span class="muted">×${n}</span></span><strong>+${n * per} VP</strong></li>`)
    .join('');
  const colonyBlock = score.colonies.count > 0
    ? `<h4>Colony locations</h4>
       <ul class="glory-table">${colonyRows}</ul>`
    : '';

  // --- Glory chits: carried + claimed + ticker tape -----------------
  const chits = getChits();
  const carried = chits.length
    ? chits.map((c) => {
        const s = getChitSides(c.zone);
        return `<span class="glory-chit" data-zone="${esc(c.zone)}">
          <strong>${esc(c.zone)}</strong>
          <em>${s.front} / ${s.back} VP</em>
        </span>`;
      }).join('')
    : '<p class="muted">No chits carried. Land a crew in a new heliocentric zone to earn one.</p>';

  const claimed = getClaimedChits();
  const claimedTable = claimed.length
    ? `<ul class="glory-table glory-claimed">${
        claimed.map((c) =>
          `<li>
            <span><span class="chit-side chit-${esc(c.side)}">${esc(c.side)}</span> ${esc(c.zone)}</span>
            <strong>+${c.vp} VP</strong>
          </li>`).join('')
      }</ul>`
    : '<p class="muted">No chits claimed yet.</p>';

  const zoneTableRows = Object.entries(ZONE_CHIT_VPS)
    .map(([z, v]) => `<li><span>${esc(z)}</span><strong>${v.front} / ${v.back} VP</strong></li>`)
    .join('');

  const scheduleHint = SPECTRAL_DIMINISHING_SCHEDULE
    .map((v, i) => i === SPECTRAL_DIMINISHING_SCHEDULE.length - 1 ? `${i + 1}+ → ${v}` : `${i + 1} → ${v}`)
    .join(', ');

  host.innerHTML = `
    <section class="score-summary">
      <h3>🏆 Scoring</h3>
      <div class="glory-vp-row">
        <span class="muted">Endgame VP (live)</span>
        <strong class="endgame-grand-vp">${score.grandTotal}</strong>
      </div>

      <h4>Spectrum exploitation track</h4>
      <div class="spectrum-tracker">${spectrumCols}</div>
      <p class="muted glory-rules glory-schedule-hint">
        Factories per spectral. The disc steps down the track:
        ${esc(scheduleHint)} VP. Spectral total +${score.spectralBonus.total} VP (rulebook M2b).
      </p>

      <h4>Tokens on the map (+1 each)</h4>
      <ul class="glory-table">${tokenRows}</ul>
      ${colonyBlock}
    </section>

    <section class="glory-summary">
      <h3>🎖 Glory &amp; Heroism chits</h3>
      <div class="glory-vp-row">
        <span class="muted">Career glory VP</span>
        <strong class="glory-vp">${vps}</strong>
      </div>
      <h4>Carried (in hand)</h4>
      <div class="glory-chits">${carried}</div>
      <h4>Claimed</h4>
      ${claimedTable}
      <h4>Ticker-tape (front / back VP)</h4>
      <ul class="glory-table glory-ticker">${zoneTableRows}</ul>
      <p class="muted glory-rules">
        Earn a chit the first time a crew lands in a heliocentric zone.
        Bring it home alive to flip it for the BACK value; if the crew
        colonises or dies, it scores the FRONT value.
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
  // Online mode: the sandbox getActions/getHistory localStorage cache
  // is the player's SOLO history, which would otherwise bleed into a
  // multiplayer game's panel (user 2026-05: "did you add fake data to
  // production? lol"). Render from the server's op log instead so the
  // log reflects this game.
  if (_online) {
    paintOnlineMissionLog(host);
    return;
  }
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
          <header>Round ${h.round ?? '?'} · slot ${h.turn != null ? h.turn + 1 : '?'}${ev}</header>
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

// Online mission log: renders from the server op log via
// getGameOps. Each op already carries a human log line written by
// the engine handler (e.g. "ruben-firefox put X up for auction"),
// so we just stream the most recent ops without trying to
// recreate the sandbox's turn-grouped layout. Auto-refreshes when
// a new snapshot lands (applySnapshot triggers a paintMissionLog
// rerun for the active pane).
// Per-op-kind glyph for the log icon column. Anything missing falls
// back to a neutral bullet so a new op kind doesn't disappear.
const MP_LOG_ICONS = {
  AUCTION_START: '🎯', AUCTION_BID: '💰', AUCTION_PASS: '🚫',
  AUCTION_RESET: '↺', AUCTION_SELL: '✅',
  PICK_CREW: '🧑‍🚀',
  END_TURN: '⏭', MOVE: '🛸', BURN: '🔥',
  SET_ACTIVE_THRUSTER: '🔥', SET_ACTIVE_PROSPECTOR: '⛏',
  BUILD_ROCKET: '🚀', PROSPECT: '⛏',
  INDUSTRIALIZE: '🏭', BUILD_FACTORY: '🏭', BUILD_REFINERY: '💧',
  DECOMMISSION: '🗑', BUY_FUTURE: '📈',
  UNDO: '↩', REDO: '↪',
};

// Short relative-time string for the log row. Cap at days so the
// label fits in a tight gutter; precise timestamp lives on the
// title attribute for hover.
function relTime(ms) {
  if (!ms) return '';
  const d = Date.now() - ms;
  if (d < 0) return 'now';
  if (d < 60_000) return Math.max(1, Math.round(d / 1000)) + 's';
  if (d < 3600_000) return Math.round(d / 60_000) + 'm';
  if (d < 86_400_000) return Math.round(d / 3600_000) + 'h';
  return Math.round(d / 86_400_000) + 'd';
}

// Lazily-built index of patent card names -> id, plus a single
// alternation regex (longest names first, so the most specific name
// wins at a given position). Used to turn card names in the mission
// log into clickable links.
let _cardNameIndex = null;
function cardNameIndex() {
  if (_cardNameIndex) return _cardNameIndex;
  const byName = new Map();
  const add = (nm, id) => { if (nm && id && !byName.has(nm)) byName.set(nm, id); };
  for (const id of Object.keys(PATENTS_BY_ID)) {
    const c = PATENTS_BY_ID[id];
    if (!c) continue;
    add(c.name, id);
    if (c.faces) {
      add(c.faces.primary && c.faces.primary.name, id);
      add(c.faces.secondary && c.faces.secondary.name, id);
    }
  }
  const names = [...byName.keys()].filter(Boolean).sort((a, b) => b.length - a.length);
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = names.length ? new RegExp(names.map(reEsc).join('|'), 'g') : null;
  _cardNameIndex = { re, byName };
  return _cardNameIndex;
}

// Render log text with any patent card names wrapped in clickable
// links (data-card-id). Everything else is HTML-escaped as usual; a
// name embedded inside a larger word is left as plain text.
function linkifyCardsHtml(raw) {
  if (!raw) return '';
  const { re, byName } = cardNameIndex();
  if (!re) return esc(raw);
  const wordish = (ch) => /[A-Za-z0-9]/.test(ch || '');
  let out = '';
  let last = 0;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const name = m[0];
    const start = m.index;
    const end = start + name.length;
    if (wordish(raw[start - 1]) || wordish(raw[end])) continue; // mid-word hit
    out += esc(raw.slice(last, start));
    out += `<button type="button" class="mp-log-cardlink" data-card-id="${esc(byName.get(name))}">${esc(name)}</button>`;
    last = end;
  }
  out += esc(raw.slice(last));
  return out;
}

// Read-only card detail popup for log links: the full card art (both
// faces, flippable) with a Close button - none of the hand-management
// actions of openCardModal (Discard / Sell / Boost / Flip-in-hand),
// which would be meaningless for inspecting another player's lot.
function openCardInfoModal(card) {
  if (!card) return;
  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay';
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const panel = document.createElement('div');
  panel.className = 'card-modal-panel';
  let cardEl;
  try { cardEl = renderCard(card, { type: 'patent' }); }
  catch { cardEl = document.createElement('div'); cardEl.textContent = card.name || card.id; }
  cardEl.classList.add('card-modal-card');
  panel.appendChild(cardEl);
  const actions = document.createElement('div');
  actions.className = 'card-modal-actions';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'modal-btn';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', close);
  actions.appendChild(closeBtn);
  panel.appendChild(actions);
  overlay.appendChild(panel);
  mountOverlay(overlay);
  document.addEventListener('keydown', onKey);
}

async function paintOnlineMissionLog(host) {
  if (!_online || !_onlineGameId || !_onlineMe) {
    host.innerHTML = '<p class="muted">Mission log will appear once the game starts.</p>';
    return;
  }
  // Preserve any previous render's scroll position so the user
  // doesn't get yanked to the top on every poll tick.
  const list = host.querySelector('.mp-log-list');
  const scrollTop = list ? list.scrollTop : null;
  const r = await getGameOps(_onlineGameId, {}, _onlineMe.token);
  if (!_online) return; // unmounted mid-fetch
  if (!r || !r.ok) {
    host.innerHTML = '<p class="muted">Could not load mission log.</p>';
    return;
  }
  const entries = (r.data && r.data.entries) || [];
  // Resolve a profileId -> seat colour map so each @name in the log
  // can render in that player's seat colour (CLAUDE.md doctrine:
  // "Player names track the player's seat colour"). Falls back to
  // currentColor when no snapshot is cached yet.
  const colourFor = new Map();
  for (const p of (_onlineSnapshot && _onlineSnapshot.players) || []) {
    if (p.color) colourFor.set(p.profileId, p.color);
  }
  // The engine's log line already starts with the actor's name
  // ("Ruben put X up for auction."). The dedicated @name column
  // would then duplicate that. Strip the leading name (and the
  // following space) so the summary reads cleanly next to the
  // coloured @name in its own column.
  const stripLeadName = (line, name) => {
    if (!line || !name) return line;
    if (line.indexOf(name) !== 0) return line;
    return line.slice(name.length).replace(/^\s+/, '');
  };
  // Server returns ops in seq ASC order. Render newest-first.
  const rows = entries
    .filter((e) => e.kind !== 'START' && e.log)
    .reverse()
    .map((e) => {
      const col = colourFor.get(e.profileId);
      const style = col ? ` style="--player-color:${esc(col)}"` : '';
      const icon = MP_LOG_ICONS[e.kind] || '·';
      const kindClass = 'mp-log-kind-' + esc(e.kind.toLowerCase().replace(/_/g, '-'));
      const when = relTime(e.createdAt);
      const whenTitle = e.createdAt
        ? new Date(e.createdAt).toLocaleString() : '';
      const summary = stripLeadName(e.log, e.profileName);
      // Auction lines name the lot + its bonus cards; linkify those so
      // the card names open the read-only detail modal. Other op lines
      // stay plain escaped text (no card-name guessing in free prose).
      const summaryHtml = (e.kind && e.kind.indexOf('AUCTION_') === 0)
        ? linkifyCardsHtml(summary) : esc(summary);
      return `
      <li class="mp-log-row ${kindClass}"${style}>
        <span class="mp-log-icon" aria-hidden="true">${icon}</span>
        <span class="mp-log-body">
          <span class="mp-log-who player-name">@${esc(e.profileName || '?')}</span>
          <span class="mp-log-summary">${summaryHtml}</span>
        </span>
        <span class="mp-log-when" title="${esc(whenTitle)}">${esc(when)}</span>
      </li>`;
    }).join('');
  host.innerHTML = `
    <div class="mp-log-head">
      <h3>📋 Mission log</h3>
      <p class="muted">Live from the server. Newest first.</p>
    </div>
    <ul class="mp-log-list">
      ${rows || '<li class="mp-log-empty muted">No actions yet.</li>'}
    </ul>
  `;
  // Clicking a linkified card name opens its read-only detail modal.
  // Delegated off the freshly-rendered list (re-bound each paint).
  const listEl = host.querySelector('.mp-log-list');
  if (listEl) {
    listEl.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('.mp-log-cardlink');
      if (!btn) return;
      const card = cardById(btn.dataset.cardId);
      if (card) openCardInfoModal(card);
    });
    if (scrollTop != null) listEl.scrollTop = scrollTop;
  }
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
      // wizard fires automatically on New game. Once the crew is
      // committed, close the solo pane so the player drops straight
      // onto the fresh board with no panels left open.
      openCrewWizard(() => showPane(null));
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
//
// Two callers:
//   - Sandbox / solo: no options passed, runs the legacy commit
//     path (setPickedCrew localStorage + addCardToLeo + logAction).
//   - Multiplayer: pass { onCommit({cardId, face}), description? }
//     and the wizard skips all local side effects, handing the
//     selection off so the caller can dispatch PICK_CREW. onDone
//     still fires for both modes.
function openCrewWizard(arg, maybeOnDone) {
  // Back-compat: openCrewWizard(onDoneFn) keeps working.
  const opts = typeof arg === 'function' ? { onDone: arg } : (arg || {});
  if (maybeOnDone) opts.onDone = maybeOnDone;
  const { onDone, onCommit, description, restrictToColor } = opts;

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
    const card = CREW_BY_ID[selected.cardId];
    const faction = card?.faces?.[selected.face];
    if (onCommit) {
      // Multiplayer path: hand the choice to the caller and let
      // them dispatch PICK_CREW. We don't touch localStorage / LEO
      // / the mission log here - the server is authoritative and
      // the eventual snapshot will hydrate the crew slot through
      // net-bridge.
      try { onCommit({ cardId: selected.cardId, face: selected.face }); }
      catch (e) { console.error('crew wizard onCommit:', e); }
      overlay.remove();
      try { onDone?.(); } catch (e) { console.error('crew wizard onDone:', e); }
      return;
    }
    setPickedCrew(selected.cardId, selected.face);
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
    const descText = description
      || 'Choose one faction. Its privilege is your edge for the game. (Required to start.)';
    dialog.innerHTML = `
      <div class="crew-wizard-head">
        <h3>🧑‍🚀 Pick your starting crew</h3>
        <p class="muted">${esc(descText)}</p>
      </div>
      <div class="crew-faction-grid"></div>
      <div class="card-modal-actions">
        <button type="button" class="modal-btn primary crew-confirm" ${selected ? '' : 'disabled'}>🚀 Start with ${selName}</button>
      </div>
    `;
    // Show the actual crew cards (the 12 single-face faction
    // faces), each a selectable tile. In multiplayer the server
    // assigns each player one of the six PLAYER_COLORS (which
    // map 1:1 to the six crew cards), and the player can only
    // pick from the two faces of the card matching their colour
    // (restrictToColor). Solo mode passes no restriction and
    // sees every face.
    const grid = dialog.querySelector('.crew-faction-grid');
    const faces = restrictToColor
      ? CREW_FACES.filter((c) => c.color === restrictToColor)
      : CREW_FACES;
    for (const c of faces) {
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

// Sandbox setup wizard. Runs once at the start of a fresh solo game
// (mountBrowse with opts.newGame), BEFORE the mandatory crew pick, so
// the player configures how they want to play up front instead of
// hunting through the game-manager pane after the board is already
// dealt. Collects the card economy (Free Library vs Card Market) plus
// the starter-cash and fuel-consumption house rules, applies them,
// reseeds the board to match (so starter cash / mode take effect from
// turn one), then chains into the crew wizard via onDone. Same
// modal idiom as the crew wizard: no backdrop / Escape dismiss, since
// setup is part of starting the game.
function openSandboxSetupWizard(onDone) {
  document.querySelector('.sandbox-setup-overlay')?.remove();
  let mode = getMarketMode();
  let starter = getStarterCash();
  let fuel = getFuelConsumption();

  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay sandbox-setup-overlay';
  overlay.tabIndex = -1;
  const dialog = document.createElement('div');
  dialog.className = 'sandbox-setup-modal';
  overlay.appendChild(dialog);

  const render = () => {
    const marketOn = mode === MARKET_MODE.MARKET;
    dialog.innerHTML = `
      <div class="crew-wizard-head">
        <h3>🛠 New sandbox game</h3>
        <p class="muted">Set how you want to play. You can change these later in the game-manager pane (it resets the board).</p>
      </div>
      <div class="setup-section">
        <h4>🃏 Card economy</h4>
        <p class="muted">
          <strong>Free Library</strong>: patents are free draws; auctions
          cost only the per-turn op.
          <strong>Card Market</strong>: auctions consume a Hand card;
          Free Market sells a Hand card for +${FREE_MARKET_AQUA} aqua.
        </p>
        <div class="market-mode-row">
          <button type="button" class="market-mode-btn ${marketOn ? '' : 'is-active'}" data-mode="library">📚 Free Library</button>
          <button type="button" class="market-mode-btn ${marketOn ? 'is-active' : ''}" data-mode="market">🃏 Card Market</button>
        </div>
      </div>
      <div class="setup-section">
        <h4>⚙️ House rules</h4>
        <label class="setup-toggle">
          <input type="checkbox" class="setup-starter" ${starter ? 'checked' : ''}>
          <span>Start with $${STARTER_CASH_AMOUNT} starter cash
            <span class="muted">(off = start at $0, earn via Income / Free Market)</span></span>
        </label>
        <label class="setup-toggle">
          <input type="checkbox" class="setup-fuel" ${fuel ? 'checked' : ''}>
          <span>Fuel consumption
            <span class="muted">(moves spend water: fuel-per-burn × burns)</span></span>
        </label>
      </div>
      <div class="card-modal-actions">
        <button type="button" class="modal-btn primary setup-confirm">Continue to crew pick →</button>
      </div>
    `;
    dialog.querySelector('[data-mode="library"]').onclick = () => { mode = MARKET_MODE.LIBRARY; render(); };
    dialog.querySelector('[data-mode="market"]').onclick = () => { mode = MARKET_MODE.MARKET; render(); };
    dialog.querySelector('.setup-starter').onchange = (e) => { starter = e.target.checked; };
    dialog.querySelector('.setup-fuel').onchange = (e) => { fuel = e.target.checked; };
    dialog.querySelector('.setup-confirm').onclick = () => {
      // Persist the prefs, set the economy without a redundant reset,
      // then reseed once so aqua / mode reflect the choices from the
      // first turn.
      setStarterCash(starter);
      setFuelConsumption(fuel);
      setMarketMode(mode, { skipReset: true });
      doSandboxReset();
      overlay.remove();
      try { onDone?.(); } catch (e) { console.error('sandbox setup onDone:', e); }
    };
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
