// Client controller for a server-authoritative multiplayer game.
//
// REST is the source of truth: state arrives from GET /games/:id and
// every change is driven by POST /games/:id/ops, with the server
// broadcasting the resulting snapshot over the game:<id> WS channel.
// This module mirrors that snapshot, renders the shared map (the
// "clean" data/sites.js graph, whose site ids match what the server
// validates moves against), and exposes the ops wired so far: MOVE,
// END_TURN, and functional UNDO / REDO.
//
// Two history surfaces:
//   - Functional undo/redo: real, broadcast state changes the active
//     player makes within their own turn, up to the dice-roll barrier
//     and before END_TURN commits. Opponents see them.
//   - Review (read-only): scrub the git-style op log back to the start
//     by fetching the snapshot at any seq. Purely local; emits nothing
//     and never pulls you out of live until you press Return to live.

import { loadCleanMap } from './clean-map.js';
import { MapRenderer } from './render.js';
import { findPath } from './nav.js';
import { ws } from '../ws.js';
import { getGame, submitGameOp, getGameOps, getGameState } from '../api.js';
import { renderCard } from './card-ui.js';
import { PATENTS_BY_ID } from '../../data/patents.js';

let _gameId = null;
let _me = null;            // { id, name, token }
let _onToast = null;
let _data = null;          // clean-map graph
let _renderer = null;

let _state = null;         // live engine state snapshot
let _players = [];         // frozen roster [{ profileId, name, seat, color }]
let _seq = -1;             // last applied op seq (live)
let _committedSeq = 0;     // undo floor (last END_TURN)
let _ops = [];             // reflog entries [{ seq, kind, log, profileName }]
let _pending = null;       // { toSiteId, path } selected move

let _reviewSeq = null;     // null = live; otherwise the seq being reviewed
let _reviewState = null;   // fetched snapshot for review
let _newWhileReview = 0;   // ops that landed live while reviewing

let _offWS = null;
let _busy = false;

// Auction UI. Drafts keep a half-typed bid across the re-renders that
// other players' bids trigger; the key resets them when a new lot opens.
let _auctionKey = null;
let _bidDraft = '';
let _joinDraft = '';

// The patent decks a player may put up for auction.
const AUCTION_DECKS = [
  ['thruster', 'Thruster'], ['reactor', 'Reactor'], ['radiator', 'Radiator'],
  ['refinery', 'Refinery'], ['robonaut', 'Robonaut'], ['generator', 'Generator'],
];

export async function mountNetGame({ gameId, me, onToast }) {
  unmountNetGame();
  _gameId = gameId;
  _me = me;
  _onToast = onToast || (() => {});

  const channel = 'game:' + gameId;
  ws.subscribe(channel);
  const off = ws.on('game_update', onGameUpdate);
  _offWS = () => { off(); ws.unsubscribe(channel); };

  bindHudButtons();

  const host = document.getElementById('game-map');
  if (host) host.innerHTML = '<div class="map-loading">Loading game…</div>';

  let data;
  try {
    data = await loadCleanMap();
  } catch (err) {
    if (host) host.innerHTML = `<div class="map-loading error">Map failed: ${err.message}</div>`;
    return;
  }
  _data = data;

  const r = await getGame(gameId, me.token);
  if (!r.ok) {
    if (host) host.innerHTML = `<div class="map-loading error">Game failed to load (${r.error}).</div>`;
    return;
  }
  applyView(r.data.game);

  // Whole reflog (after=-1 includes the seq-0 START) so review can
  // scrub to the opening board.
  const ops = await getGameOps(gameId, { after: -1 }, me.token);
  if (ops.ok) _ops = ops.data.entries.slice();

  if (host) host.innerHTML = '';
  _renderer = new MapRenderer(host, { data, onSelect: onSiteSelect });
  render();
}

export function unmountNetGame() {
  if (_offWS) { _offWS(); _offWS = null; }
  _renderer = null;
  _gameId = null;
  _state = null;
  _players = [];
  _seq = -1;
  _committedSeq = 0;
  _ops = [];
  _pending = null;
  _reviewSeq = null;
  _reviewState = null;
  _newWhileReview = 0;
  _busy = false;
  _auctionKey = null;
  _bidDraft = '';
  _joinDraft = '';
  const host = document.getElementById('game-map');
  if (host) host.innerHTML = '';
  const auc = document.getElementById('game-auction');
  if (auc) { auc.classList.add('hidden'); auc.innerHTML = ''; }
}

// ----- state plumbing -----

function applyView(view) {
  if (!view) return;
  if (typeof view.seq === 'number' && view.seq < _seq) return; // stale broadcast
  _state = view.state;
  _players = view.players || [];
  _seq = typeof view.seq === 'number' ? view.seq : _seq;
  if (typeof view.committedSeq === 'number') _committedSeq = view.committedSeq;
}

function addOp(entry) {
  if (!entry || typeof entry.seq !== 'number') return;
  if (_ops.some((o) => o.seq === entry.seq)) return; // dedupe (REST + WS)
  _ops.push(entry);
}

function onGameUpdate(msg) {
  if (!msg || msg.gameId !== _gameId) return;
  if (typeof msg.seq === 'number' && msg.seq <= _seq) return;
  applyView(msg.game);
  if (msg.op) {
    const who = _players.find((p) => p.profileId === msg.op.profileId);
    addOp({ seq: msg.op.seq, kind: msg.op.kind, log: msg.op.log, profileName: who ? who.name : '' });
  }
  if (_pending && !isMyTurn()) clearPending();
  if (_reviewSeq != null) {
    // Reviewing history: don't yank the player out; just note that live
    // moved on and refresh the log so the new entry is scrubbable.
    _newWhileReview += 1;
    renderReflog();
    renderReviewControls();
  } else {
    render();
  }
}

function me() {
  return _state && _state.players.find((p) => p.profileId === _me.id);
}
function currentPlayer() {
  return _state && _state.players[_state.activeIndex];
}
function isMyTurn() {
  const c = currentPlayer();
  return !!c && c.profileId === _me.id;
}
function reviewing() { return _reviewSeq != null; }

// Whether the most recent turn action can be unwound: there is one and
// it did not consume a die roll (the barrier).
function canUndo() {
  if (!_state || !_state.turnActions || !_state.turnActions.length) return false;
  const last = _state.turnActions[_state.turnActions.length - 1];
  return !last.rolled;
}
function canRedo() {
  return !!(_state && _state.turnRedo && _state.turnRedo.length);
}

// ----- map interaction -----

function onSiteSelect(site) {
  if (reviewing() || !site || site.isDecorative || !_state) return;
  const myp = me();
  if (!myp) return;
  const from = myp.rocket.siteId;
  if (site.id === from) { clearPending(); render(); return; }
  const path = findPath(_data, from, site.id);
  if (!path) {
    _pending = null;
    if (_renderer) { _renderer.setRoute(null); _renderer.setRouteEndpoints(from, null); }
    setMoveInfo(`No route to ${site.name}.`, true);
    updateButtons();
    return;
  }
  _pending = { toSiteId: site.id, path };
  if (_renderer) {
    _renderer.setRoute(path.segments);
    _renderer.setRouteEndpoints(from, site.id);
  }
  render();
}

function clearPending() {
  _pending = null;
  if (_renderer) { _renderer.setRoute(null); _renderer.setRouteEndpoints(null, null); }
}

// ----- ops -----

async function submitOp(op, errSink = setError) {
  if (_busy || reviewing()) return false;
  _busy = true;
  updateButtons();
  errSink('');
  const r = await submitGameOp(_gameId, op, _me.token);
  _busy = false;
  if (!r.ok) {
    errSink(humanizeOpError(r.error));
    updateButtons();
    return false;
  }
  applyView(r.data.game);
  addOp({ seq: r.data.seq, kind: op.kind, log: r.data.log, profileName: _me.name });
  return true;
}

async function doMove() {
  if (!_pending || !isMyTurn()) return;
  const target = _pending.toSiteId;
  if (await submitOp({ kind: 'MOVE', toSiteId: target })) {
    clearPending();
    render();
  }
}
async function doEndTurn() {
  if (!isMyTurn()) return;
  if (await submitOp({ kind: 'END_TURN' })) { clearPending(); render(); }
}
async function doUndo() {
  if (!isMyTurn() || !canUndo()) return;
  if (await submitOp({ kind: 'UNDO' })) { clearPending(); render(); }
}
async function doRedo() {
  if (!isMyTurn() || !canRedo()) return;
  if (await submitOp({ kind: 'REDO' })) { clearPending(); render(); }
}

// ----- auction -----

function setAuctionError(text) {
  const el = document.getElementById('auction-error');
  if (el) el.textContent = text || '';
}

function noteEl(text) {
  const d = document.createElement('div');
  d.className = 'hud-move-info muted';
  d.textContent = text;
  return d;
}

// A draft amount clamped to at least min (falls back to min when blank
// or no longer high enough after someone else raised).
function clampInt(draft, min) {
  const v = parseInt(draft, 10);
  return (Number.isInteger(v) && v >= min) ? v : min;
}

// The auctioneer picks which deck's top card to put up. Toggling shows
// the six patent decks with their remaining counts.
function toggleDeckPicker() {
  if (!isMyTurn() || _busy || (_state && _state.auction) || reviewing()) return;
  const picker = document.getElementById('auction-deck-picker');
  if (!picker) return;
  if (!picker.classList.contains('hidden')) { hideDeckPicker(); return; }
  picker.innerHTML = '';
  picker.appendChild(noteEl('Auction the top of which deck? (costs 1 op)'));
  const row = document.createElement('div');
  row.className = 'hud-actions auction-deck-row';
  for (const [type, label] of AUCTION_DECKS) {
    const n = (_state && _state.decks && _state.decks[type]) ? _state.decks[type].length : 0;
    const b = document.createElement('button');
    b.className = 'modal-btn';
    b.textContent = `${label} (${n})`;
    b.disabled = n === 0 || _busy;
    b.addEventListener('click', () => doStartAuction(type));
    row.appendChild(b);
  }
  picker.appendChild(row);
  picker.classList.remove('hidden');
}

function hideDeckPicker() {
  const picker = document.getElementById('auction-deck-picker');
  if (picker && !picker.classList.contains('hidden')) {
    picker.classList.add('hidden');
    picker.innerHTML = '';
  }
}

async function doStartAuction(deckType) {
  if (!isMyTurn() || _busy) return;
  hideDeckPicker();
  if (await submitOp({ kind: 'AUCTION_START', deckType })) render();
}

async function doBid() {
  const input = document.getElementById('auction-bid-input');
  if (!input) return;
  const amount = parseInt(input.value, 10);
  if (!Number.isInteger(amount)) { setAuctionError('Enter a whole number.'); return; }
  if (await submitOp({ kind: 'AUCTION_BID', amount }, setAuctionError)) render();
}

async function doPass() {
  if (await submitOp({ kind: 'AUCTION_PASS' }, setAuctionError)) render();
}

async function doJoin(amount) {
  if (!Number.isInteger(amount)) { setAuctionError('Enter a whole number.'); return; }
  if (await submitOp({ kind: 'AUCTION_JOIN', amount }, setAuctionError)) render();
}

async function doSell() {
  if (await submitOp({ kind: 'AUCTION_SELL' }, setAuctionError)) render();
}

// Render the live auction overlay from state.auction. It is fully
// server-driven: the panel appears for every player when a lot opens
// and clears when it resolves, so there is no open/close handshake.
function renderAuction() {
  const overlay = document.getElementById('game-auction');
  if (!overlay) return;
  const a = (!reviewing() && _state && _state.auction) ? _state.auction : null;
  if (!a) {
    if (!overlay.classList.contains('hidden')) {
      overlay.classList.add('hidden');
      overlay.innerHTML = '';
    }
    _auctionKey = null; _bidDraft = ''; _joinDraft = '';
    return;
  }
  if (_auctionKey !== a.cardId) { _auctionKey = a.cardId; _bidDraft = ''; _joinDraft = ''; }

  const auctioneer = _state.players.find((p) => p.profileId === a.auctioneerId);
  const highBidder = a.highBidderId
    ? _state.players.find((p) => p.profileId === a.highBidderId) : null;
  const lot = PATENTS_BY_ID[a.cardId];

  overlay.classList.remove('hidden');
  overlay.innerHTML = `
    <div class="net-auction-modal" role="dialog" aria-label="Patent auction">
      <div class="auction-head">
        <h3>Patent Auction</h3>
        <span class="auction-mode"></span>
      </div>
      <div class="net-auction-body">
        <div class="net-auction-lot" id="net-auction-lot"></div>
        <div class="net-auction-side">
          <div class="net-auction-status">
            <div class="net-auction-bid"></div>
            <div class="muted net-auction-phase"></div>
          </div>
          <div class="net-auction-controls" id="net-auction-controls"></div>
          <div class="hud-error" id="auction-error"></div>
        </div>
      </div>
    </div>
  `;
  overlay.querySelector('.auction-mode').textContent =
    auctioneer ? `@${auctioneer.name}'s lot` : 'lot';

  const lotHost = overlay.querySelector('#net-auction-lot');
  if (lot) {
    try { lotHost.appendChild(renderCard(lot, { type: 'patent' })); }
    catch { lotHost.textContent = lot.name || a.cardId; }
  } else {
    lotHost.textContent = a.cardId;
  }

  overlay.querySelector('.net-auction-bid').textContent = a.highBid > 0
    ? `High bid: ${a.highBid} aqua by @${highBidder ? highBidder.name : '?'}`
    : 'No bids yet.';
  overlay.querySelector('.net-auction-phase').textContent =
    a.awaiting === 'bidders' ? 'Bidding is open.' : 'The auctioneer is deciding.';

  buildAuctionControls(
    overlay.querySelector('#net-auction-controls'),
    a, { auctioneer, highBidder }
  );
}

// Role + phase aware controls. A bidder sees Bid / Pass during the
// bidding round; the auctioneer sees Sell / Join (or Keep when no one
// bid) once everyone has passed. Everyone else sees a waiting note.
function buildAuctionControls(host, a, { auctioneer, highBidder }) {
  host.innerHTML = '';
  const myId = _me.id;
  const myp = me();
  if (!myp) { host.appendChild(noteEl('You are spectating this auction.')); return; }
  const iAmAuctioneer = a.auctioneerId === myId;
  const myAqua = myp.aqua | 0;

  if (a.awaiting === 'bidders') {
    if (iAmAuctioneer) {
      host.appendChild(noteEl('Waiting for the other players to bid or pass.'));
      return;
    }
    if (a.highBidderId === myId) {
      host.appendChild(noteEl('You hold the high bid. Waiting for the others.'));
      return;
    }
    const minBid = a.highBid + 1;
    const passed = a.passed.includes(myId);
    const row = document.createElement('div');
    row.className = 'net-auction-bidrow';
    const input = document.createElement('input');
    input.type = 'number';
    input.id = 'auction-bid-input';
    input.className = 'net-auction-input';
    input.min = String(minBid);
    input.value = String(clampInt(_bidDraft, minBid));
    const bidBtn = document.createElement('button');
    bidBtn.className = 'modal-btn primary';
    const passBtn = document.createElement('button');
    passBtn.className = 'modal-btn';
    passBtn.textContent = passed ? 'Passed' : 'Pass';
    passBtn.disabled = passed || _busy;
    const sync = () => {
      const v = parseInt(input.value, 10);
      const okAmt = Number.isInteger(v) && v >= minBid && v <= myAqua;
      bidBtn.textContent = Number.isInteger(v) ? `Bid ${v}` : 'Bid';
      bidBtn.disabled = !okAmt || _busy;
    };
    input.addEventListener('input', () => { _bidDraft = input.value; sync(); });
    bidBtn.addEventListener('click', doBid);
    passBtn.addEventListener('click', doPass);
    row.append(input, bidBtn, passBtn);
    host.appendChild(row);
    host.appendChild(noteEl(`You have ${myAqua} aqua. Minimum bid ${minBid}.`));
    sync();
    return;
  }

  // awaiting === 'auctioneer'
  if (!iAmAuctioneer) {
    host.appendChild(noteEl(
      `Waiting for @${auctioneer ? auctioneer.name : 'the auctioneer'} to sell or keep.`
    ));
    return;
  }
  if (a.highBid === 0) {
    const keepBtn = document.createElement('button');
    keepBtn.className = 'modal-btn primary';
    keepBtn.textContent = 'Keep (no bids)';
    keepBtn.disabled = _busy;
    keepBtn.addEventListener('click', () => doJoin(0));
    host.appendChild(keepBtn);
    host.appendChild(noteEl('No one bid. Keep it for free (one more pass-round, then it is yours).'));
    return;
  }
  const sellBtn = document.createElement('button');
  sellBtn.className = 'modal-btn primary';
  sellBtn.textContent = `Sell to @${highBidder ? highBidder.name : '?'} (${a.highBid} aqua)`;
  sellBtn.disabled = _busy;
  sellBtn.addEventListener('click', doSell);
  host.appendChild(sellBtn);

  const minJoin = a.highBid;
  const row = document.createElement('div');
  row.className = 'net-auction-bidrow';
  const input = document.createElement('input');
  input.type = 'number';
  input.id = 'auction-join-input';
  input.className = 'net-auction-input';
  input.min = String(minJoin);
  input.value = String(clampInt(_joinDraft, minJoin));
  const joinBtn = document.createElement('button');
  joinBtn.className = 'modal-btn';
  const sync = () => {
    const v = parseInt(input.value, 10);
    const okAmt = Number.isInteger(v) && v >= minJoin && v <= myAqua;
    joinBtn.textContent = Number.isInteger(v) ? `Join at ${v}` : 'Join';
    joinBtn.disabled = !okAmt || _busy;
  };
  input.addEventListener('input', () => { _joinDraft = input.value; sync(); });
  joinBtn.addEventListener('click', () => doJoin(parseInt(input.value, 10)));
  row.append(input, joinBtn);
  host.appendChild(row);
  host.appendChild(noteEl(
    `Join at ${minJoin}+ to keep bidding (you pay the bank if you win). You have ${myAqua} aqua.`
  ));
  sync();
}

// ----- history review (read-only) -----

async function enterReview(seq) {
  if (seq === _seq) { returnToLive(); return; } // tapping the live tip = back to live
  const r = await getGameState(_gameId, seq, _me.token);
  if (!r.ok) { _onToast('Could not load that point in history.', 'error'); return; }
  _reviewSeq = seq;
  _reviewState = r.data.state;
  _newWhileReview = 0;
  clearPending();
  renderReview();
}

function returnToLive() {
  _reviewSeq = null;
  _reviewState = null;
  _newWhileReview = 0;
  render();
}

// ----- render -----

function render() {
  if (!_state) return;
  if (reviewing()) { renderReview(); return; }
  const myp = me();
  if (_renderer && myp) _renderer.setPlayerShipId(myp.rocket.siteId);
  renderBanner(_state, false);
  renderRoster(_state);
  renderMoveInfo();
  renderReflog();
  renderReviewControls();
  renderAuction();
  updateButtons();
  if (!isMyTurn() || _state.auction) hideDeckPicker();
}

function renderReview() {
  const st = _reviewState;
  if (!st) return;
  const myp = st.players.find((p) => p.profileId === _me.id);
  if (_renderer && myp) _renderer.setPlayerShipId(myp.rocket.siteId);
  if (_renderer) { _renderer.setRoute(null); _renderer.setRouteEndpoints(null, null); }
  renderBanner(st, true);
  renderRoster(st);
  setMoveInfo('Reviewing history (read-only). Return to live to act.', false);
  renderReflog();
  renderReviewControls();
  renderAuction();
  hideDeckPicker();
  updateButtons();
}

function renderBanner(st, isReview) {
  const el = document.getElementById('game-turn-banner');
  if (!el) return;
  const slot = `round ${st.round} · slot ${st.turn}`;
  if (isReview) {
    el.textContent = `Reviewing seq ${_reviewSeq} (${slot})`;
    el.className = 'game-turn-banner reviewing';
    return;
  }
  const c = st.players[st.activeIndex];
  if (isMyTurn()) {
    el.textContent = `Your turn (${slot})`;
    el.className = 'game-turn-banner your-turn';
  } else {
    el.textContent = `Waiting for @${c ? c.name : '?'} (${slot})`;
    el.className = 'game-turn-banner muted';
  }
}

function renderRoster(st) {
  const ul = document.getElementById('hud-roster');
  if (!ul) return;
  ul.innerHTML = '';
  const activeId = st.players[st.activeIndex]?.profileId;
  for (const p of st.players) {
    const site = _data.byId[p.rocket.siteId];
    const li = document.createElement('li');
    if (p.profileId === activeId) li.classList.add('active');
    const you = p.profileId === _me.id;
    li.innerHTML = `
      <span class="dot" style="background:${p.color}"></span>
      <span class="who"></span>
      <span class="where muted"></span>
      <span class="water"></span>
    `;
    li.querySelector('.who').textContent = '@' + p.name + (you ? ' (you)' : '');
    li.querySelector('.where').textContent = site ? site.name : (p.rocket.siteId || 'LEO');
    const glory = p.glory && p.glory.vps ? ` · ${p.glory.vps}vp` : '';
    li.querySelector('.water').textContent = `${p.rocket.tank}💧${glory}`;
    ul.appendChild(li);
  }
}

function renderMoveInfo() {
  if (!_pending) {
    setMoveInfo(isMyTurn() ? 'Tap a site to plan a burn.' : 'Not your turn.', false);
    return;
  }
  const dest = _data.byId[_pending.toSiteId];
  const cost = _pending.path.totalBurns; // perBurn=1 until BUILD lands
  const hops = _pending.path.segments.length;
  setMoveInfo(
    `→ ${dest ? dest.name : _pending.toSiteId}: ${cost} burn${cost === 1 ? '' : 's'} `
    + `over ${hops} hop${hops === 1 ? '' : 's'} (needs ${cost}💧).`,
    false
  );
}

function setMoveInfo(text, isWarn) {
  const el = document.getElementById('hud-move-info');
  if (!el) return;
  el.textContent = text;
  el.className = 'hud-move-info ' + (isWarn ? 'warn' : 'muted');
}

function setError(text) {
  const el = document.getElementById('hud-move-error');
  if (el) el.textContent = text || '';
}

function updateButtons() {
  const rev = reviewing();
  const myTurn = !rev && isMyTurn();
  const auctionOpen = !!(_state && _state.auction);
  // An open auction freezes the active player's normal ops until the
  // lot resolves (the server enforces this too).
  const free = myTurn && !_busy && !auctionOpen;
  const myp = me();
  const moveBtn = document.getElementById('btn-game-move');
  const endBtn = document.getElementById('btn-game-endturn');
  const undoBtn = document.getElementById('btn-game-undo');
  const redoBtn = document.getElementById('btn-game-redo');
  const startBtn = document.getElementById('btn-auction-start');
  if (moveBtn) {
    moveBtn.disabled = !(free && _pending && myp
      && myp.movesRemaining > 0
      && _pending.path.totalBurns <= myp.rocket.tank);
  }
  if (endBtn) endBtn.disabled = !free;
  if (undoBtn) undoBtn.disabled = !(free && canUndo());
  if (redoBtn) redoBtn.disabled = !(free && canRedo());
  if (startBtn) startBtn.disabled = !(free && myp && myp.opsRemaining > 0);
}

let _hudBound = false;
function bindHudButtons() {
  if (_hudBound) return;
  _hudBound = true;
  document.getElementById('btn-game-move')?.addEventListener('click', doMove);
  document.getElementById('btn-game-endturn')?.addEventListener('click', doEndTurn);
  document.getElementById('btn-game-undo')?.addEventListener('click', doUndo);
  document.getElementById('btn-game-redo')?.addEventListener('click', doRedo);
  document.getElementById('btn-return-live')?.addEventListener('click', returnToLive);
  document.getElementById('btn-auction-start')?.addEventListener('click', toggleDeckPicker);
}

// ----- reflog (clickable history) -----

function renderReflog() {
  const ul = document.getElementById('hud-log');
  if (!ul) return;
  ul.innerHTML = '';
  // Newest-first. Each entry is a point in history you can review.
  const entries = _ops.slice().sort((a, b) => b.seq - a.seq);
  for (const e of entries) {
    const li = document.createElement('li');
    li.className = 'reflog-entry kind-' + String(e.kind || '').toLowerCase();
    if (e.seq === _reviewSeq) li.classList.add('reviewing');
    if (!reviewing() && e.seq === _seq) li.classList.add('live-tip');
    li.textContent = e.log || e.kind;
    li.title = `seq ${e.seq}: click to review this point`;
    li.addEventListener('click', () => enterReview(e.seq));
    ul.appendChild(li);
  }
}

function renderReviewControls() {
  const btn = document.getElementById('btn-return-live');
  const note = document.getElementById('hud-review-note');
  if (btn) {
    btn.classList.toggle('hidden', !reviewing());
    btn.textContent = _newWhileReview > 0
      ? `● Return to live (${_newWhileReview} new)`
      : '● Return to live';
  }
  if (note) {
    note.classList.toggle('hidden', !reviewing());
    if (reviewing()) note.textContent = 'Read-only. Nothing here changes the game.';
  }
}

function humanizeOpError(code) {
  return ({
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
    auction_in_progress: 'An auction is already underway.',
    need_opponent: 'Need another player to hold an auction.',
    no_ops_left: 'No operations left this turn.',
    bad_deck: 'Pick a valid deck to auction.',
    deck_empty: 'That deck is empty.',
    no_auction: 'No auction is open.',
    not_bidding_phase: 'Bidding is closed right now.',
    auctioneer_cannot_bid: 'You are the auctioneer; join after bidding.',
    auctioneer_cannot_pass: 'The auctioneer does not pass.',
    cannot_pass_leading: 'You already hold the high bid.',
    bid_too_low: 'Bid must beat the current high bid.',
    insufficient_aqua: 'Not enough aqua.',
    bad_amount: 'Enter a whole number.',
    not_auctioneer_phase: 'Wait for bidding to finish.',
    not_auctioneer: 'Only the auctioneer can do that.',
    must_match_or_raise: 'You must match or beat the high bid.',
    no_bid_to_accept: 'There is no bid to accept.',
    winner_gone: 'The high bidder is no longer available.',
    winner_cannot_pay: 'The high bidder can no longer pay.',
  })[code] || code;
}
