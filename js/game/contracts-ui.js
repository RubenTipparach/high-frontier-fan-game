// Module 4 contracts (4B): the player's Contracts panel and the contract auction
// overlay. Everything here is reachable ONLY in an m4 game (isM4()), and every
// action routes through the server (the engine validates each one): this module
// just reads the snapshot and submits ops.
//
// - Toolbar "contracts" tag (beside the move / undo tags) opens the panel.
// - Panel: your timepiece, the default chit, the contract auction a Fundraise
//   unlocks (pick a deck sharing an Active Law, optionally discard its top card,
//   auction it or walk away), your contract hand (Boost), your boosted contracts
//   (Fulfill / pay the late fee), and the ones you have fulfilled.
// - Overlay: the live contract auction, bid in YEARS from 10 down to 0, lowest
//   bid wins; the initiator closes it.
import {
  CONTRACTS_BY_ID, CONTRACT_PAIRS, CONTRACT_PAIR_NAMES, CONTRACT_BID_MAX, contractFace,
} from '../../data/contracts.js';
import { renderContractCard, richText, setContractProgressSource, setContractReadySource, fulfillButtonHtml } from './contract-card.js';
import { SITES_BY_ID } from '../../data/sites.js';
import { lagrangeLabel } from '../../data/lagrange-labels.js';
import { nodeLabelOf } from '../../data/map-labels.js';
import { augmentGlyph, AUGMENTS, timepieceDialGlyph } from './contract-glyphs.js';
import { sunspotDialSvg } from './turn-clock-ui.js';
import { isM4, isM2 } from './online-mode.js';
import { COLONISTS_BY_ID } from '../../data/colonists.js';
import { IDEOLOGY_ORDER, IDEOLOGY_BY_KEY, activeLaws, usesSoloAssembly, voteWinners } from '../../data/assembly.js';
import { CREW_BY_ID } from '../../data/crew.js';
import { augmentSideSvg } from './augment-sides.js';

let D = null;               // deps from browse.js (snapshot readers + submitters)
let _panelOpen = false;
const SLOTS = 12;

export function initContractsUi(deps) {
  D = deps;
  // A contract of mine that is out of my hand (boosted, aboard a stack) shows
  // its destination steps ticked off, wherever its card is drawn.
  setContractProgressSource((id) => {
    const p = me();
    const meta = p && (p.contractMeta || {})[id];
    if (!meta || (p.contractHand || []).includes(id) || (p.fulfilledContracts || []).some((f) => f.id === id)) return null;
    return { done: (meta.progress && meta.progress.done) | 0 };
  }, spaceName);
}
// The name a player reads for a map space: the site, the Lagrange point
// (numbered as on the board), the hazard by its board caption.
export function contractSpaceName(slug) { return spaceName(slug); }
function spaceName(slug) {
  const site = SITES_BY_ID[String(slug).replace(/-/g, '_')] || SITES_BY_ID[slug];
  if (site) return site.name;
  const lg = lagrangeLabel(slug);
  if (lg) return `Lagrange ${lg}`;
  const cap = nodeLabelOf(slug);
  if (cap) return `the "${cap.replace(/\s+/g, ' ')}" hazard`;
  const n = D && D.spaceName ? D.spaceName(slug) : null;
  return n && !/^(Lagrange|Burn point)$/i.test(n) ? n : 'the marked space';
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const snap = () => (D && D.snapshot()) || null;
const me = () => (D && D.me()) || null;
const nameOf = (id) => ((snap() && snap().players || []).find((p) => p.profileId === id) || {}).name || 'a player';
const playerById = (id) => (snap() && snap().players || []).find((p) => p.profileId === id) || null;
const faceOf = (p, id) => contractFace(id, ((p.contractMeta || {})[id] || {}).side || 'blue');
// The laws this player may use right now: the engine's playerCanUseLaw read,
// off the same shared resolver (the Active Law, every law Unity also activates,
// a law they lobbied this turn, and Emissaries' tied ideologies on their turn).
const lawKeys = (s, p) => {
  const out = new Set();
  if (!s) return out;
  const asm = s.assembly || { delegates: {} };
  for (const k of activeLaws(asm, s.activeLawStar, usesSoloAssembly(s), !!s.anarchy).active) out.add(k);
  for (const k of ((p && p.lobbiedLaws) || [])) out.add(k);
  if (p && Array.isArray(p.emissaryLaws) && p.emissaryLaws.length && D && D.myTurn()) {
    const tied = voteWinners(asm);
    if (tied.length >= 2) for (const k of p.emissaryLaws) if (tied.includes(k)) out.add(k);
  }
  return out;
};
const yearsFromNow = (s, slot) => ((slot - (s.turn | 0)) + SLOTS) % SLOTS;
// Does player `p` hold a fulfilled contract with ability `key` (4B2f)? Same
// read as the engine's contractAbilityCount.
const hasContractAbility = (p, key) => (p && p.fulfilledContracts || [])
  .some((f) => { const face = contractFace(f.id, f.side); return !!(face && face.abilities && face.abilities[key]); });
// Connections (4B2f): a deck is also open when you have a delegate in either
// of its ideologies.
const delegateIn = (s, k, pid) => (((s && s.assembly && s.assembly.delegates) || {})[k] || {})[pid] > 0;

// ---- fulfill readiness ----------------------------------------------------------
// Which boosted contracts of mine would announce a step (or be fulfilled) where
// they stand now: asked of the rules engine as a dry run, once per board change
// on my turn, so the card can carry a Fulfill button and End turn can remind me.
let _ready = new Map();   // cardId -> { final }
let _readyKey = null;
setContractReadySource((id) => _ready.get(id) || null);
function boostedContractIds(p) {
  if (!p) return [];
  return Object.keys(p.contractMeta || {}).filter((id) => !(p.contractHand || []).includes(id)
    && !(p.contractMeta[id] || {}).default);
}
async function checkReady(ids) {
  const out = new Map();
  for (const id of ids) {
    let r = null;
    try { r = await D.dryRun({ kind: 'FULFILL_CONTRACT', cardId: id }); } catch { r = null; }
    if (r && r.ok) out.set(id, { final: / fulfilled /.test(String(r.log || '')) });
  }
  return out;
}
async function refreshReady(s) {
  const p = me();
  const ids = (s && p && D.myTurn() && D.dryRun) ? boostedContractIds(p) : [];
  const key = ids.length ? `${s.round}:${s.turn}:${JSON.stringify(ids.map((id) => [id, (p.contractMeta[id].progress || {}).done | 0]))}:${JSON.stringify([p.rocket, p.outposts, p.freighter, p.bernals, p.leo].map((x) => x && JSON.stringify(x).length))}` : '';
  if (key === _readyKey) return;
  _readyKey = key;
  const next = ids.length ? await checkReady(ids) : new Map();
  if (key !== _readyKey) return;   // a newer board already took over
  const same = next.size === _ready.size && [...next].every(([k, v]) => _ready.get(k) && _ready.get(k).final === v.final);
  _ready = next;
  if (!same) { decorateReadyCards(); if (_panelOpen) renderPanel(); }
}
// Put (or take) the Fulfill button on every contract card already on screen.
function decorateReadyCards() {
  for (const el of document.querySelectorAll('.card.m4-contract[data-contract-id]')) {
    if (el.closest('.m4c-fulfilled')) continue;
    const ready = _ready.get(el.dataset.contractId);
    const btn = el.querySelector('.m4-fulfill-btn');
    el.classList.toggle('m4-ready', !!ready);
    if (!ready) { if (btn) btn.remove(); continue; }
    if (btn) btn.remove();
    const face = el.querySelector('.card-face');
    if (face) face.insertAdjacentHTML('beforeend', fulfillButtonHtml(el.dataset.contractId, ready));
  }
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('.m4-fulfill-btn');
  if (!b) return;
  // Capture phase: the card under the button (a hand tile, a stack card that
  // opens its zoom) never sees this tap.
  e.preventDefault();
  e.stopPropagation();
  if (b.closest('.m4c-fulfilled')) return;
  b.disabled = true;
  document.querySelectorAll('.card-modal-overlay .modal-x').forEach((x) => { try { x.click(); } catch { /* ignore */ } });
  fulfillContract(b.dataset.fulfill).finally(() => { b.disabled = false; });
}, true);

// Before the turn ends: a contract that could be fulfilled right here pops up
// with its Fulfill button. Resolves true to go on ending the turn.
export async function contractsBeforeEndTurn() {
  const s = snap(); const p = me();
  if (!s || !s.m4 || !p || !D || !D.dryRun) return true;
  const ids = boostedContractIds(p);
  if (!ids.length) return true;
  const ready = await checkReady(ids);
  if (!ready.size) return true;
  return new Promise((resolve) => {
    document.getElementById('m4-contract-endturn')?.remove();
    const ov = document.createElement('div');
    ov.id = 'm4-contract-endturn';
    ov.className = 'm4c-overlay m4c-fulfilled m4c-endturn';
    ov.innerHTML = `<div class="m4c-modal" role="dialog" aria-modal="true" aria-label="Contract ready">
      <div class="m4c-head"><h3>🏁 Contract ready</h3><button type="button" class="m4c-close" aria-label="Close">✕</button></div>
      <div class="m4c-body m4c-endturn-body">${[...ready].map(([id, r]) => `<div class="m4c-endturn-item">${cardThumb(id, (p.contractMeta[id] || {}).side || 'blue')}
        <button type="button" class="m4c-ful-ok" data-go="${esc(id)}">🏁 ${r.final ? 'Fulfill' : 'Announce step'}</button></div>`).join('')}</div>
      <div class="m4c-endturn-foot"><button type="button" class="m4c-endturn-skip">End turn anyway</button></div></div>`;
    const done = (v) => { ov.remove(); resolve(v); };
    ov.addEventListener('click', async (e) => {
      if (e.target === ov || e.target.closest('.m4c-close')) { done(false); return; }
      if (e.target.closest('.m4c-endturn-skip')) { done(true); return; }
      const go = e.target.closest('[data-go]');
      if (go) { done(false); await fulfillContract(go.dataset.go); }
    });
    // The ready card's own Fulfill button is not needed twice here.
    ov.querySelectorAll('.m4-fulfill-btn').forEach((b) => b.remove());
    document.body.appendChild(ov);
  });
}

// Called on every snapshot apply (browse.js#applySnapshot).
export function refreshContractsUi() {
  const s = snap();
  const on = !!(s && isM4() && s.m4);
  // No toolbar tag (owner 2026-11-18): the Contracts chip by the stacks and the
  // timepiece badge are the ways in.
  document.getElementById('turn-tag-contracts')?.remove();
  if (!on) { closePanel(); renderContractAuction(null); _seenFulfilled = null; _ready = new Map(); _readyKey = null; return; }
  refreshReady(s);
  announceFulfilled(s);
  renderContractAuction(s.auction && s.auction.kind === 'contract' ? s.auction : null);
  if (_panelOpen) renderPanel();
}

// ---- contract fulfilled (4B4f) ------------------------------------------------------
// A contract that newly lands in anyone's fulfilled splay pops a modal: yours as
// "Contract fulfilled", a rival's naming who did it. Read off the game state,
// not the button press, so it shows however the news arrives. The first look
// at a game only records what is already fulfilled (a refresh never replays it).
let _seenFulfilled = null;   // Set of "profileId:cardId"
let _fulfilledQueue = [];
function announceFulfilled(s) {
  const now = [];
  for (const q of s.players || []) for (const f of q.fulfilledContracts || []) now.push({ q, f, key: `${q.profileId}:${f.id}` });
  if (!_seenFulfilled) { _seenFulfilled = new Set(now.map((x) => x.key)); return; }
  const mine = me() && me().profileId;
  for (const x of now) {
    if (_seenFulfilled.has(x.key)) continue;
    _seenFulfilled.add(x.key);
    _fulfilledQueue.push({ ...x, mine: x.q.profileId === mine });
  }
  if (!document.getElementById('m4-contract-fulfilled')) showNextFulfilled();
}
function showNextFulfilled() {
  const x = _fulfilledQueue.shift();
  if (!x) return;
  const face = contractFace(x.f.id, x.f.side) || {};
  const who = `<span class="player-name" style="--player-color:${esc(x.q.color || '')}">@${esc(x.q.name)}</span>`;
  const el = document.createElement('div');
  el.id = 'm4-contract-fulfilled';
  el.className = 'm4c-overlay m4c-fulfilled';
  el.innerHTML = `<div class="m4c-modal" role="dialog" aria-modal="true" aria-labelledby="m4c-ful-title">
    <div class="m4c-head"><h3 id="m4c-ful-title">🏁 ${x.mine ? 'Contract fulfilled' : `${who}: contract fulfilled`}</h3>
      <button type="button" class="m4c-close" aria-label="Close">✕</button></div>
    <div class="m4c-body m4c-ful-body">
      <div class="m4c-ful-card">${cardThumb(x.f.id, x.f.side)}</div>
      <div class="m4c-ful-text">
        <p class="m4c-ful-name">${esc(face.name || x.f.id)}</p>
        <p class="m4c-ful-vp">+${face.vp | 0} VP</p>
        ${face.fulfilledAbility ? `<p>${richText(face.fulfilledAbility)}</p>` : ''}
        <button type="button" class="m4c-ful-ok">OK</button>
      </div>
    </div></div>`;
  const close = () => { el.remove(); showNextFulfilled(); };
  el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('.m4c-close, .m4c-ful-ok')) close(); });
  document.body.appendChild(el);
  const ok = el.querySelector('.m4c-ful-ok');
  if (ok) ok.focus();
}

// ---- the Sunspot dial (4B3e: bids and deadlines are years from the Cube) --------
const DIAL_GLYPH = 32;
// Every OTHER player's timepiece already out on the cycle (their contract's
// deadline), so the table can see how much time each has left.
function timepieceMarkers(s, skipId) {
  return (s.players || []).filter((q) => q.timepiece && q.profileId !== skipId).map((q) => ({
    slot: ((q.timepiece.slot % SLOTS) + SLOTS) % SLOTS,
    svg: timepieceDialGlyph({ color: q.color || '#e5e7eb', size: DIAL_GLYPH, deadbeat: !!q.timepiece.deadbeat }),
    title: `@${q.name}'s timepiece${q.timepiece.deadbeat ? ' (late)' : `: ${yearsFromNow(s, q.timepiece.slot)} years left`}`,
  }));
}
const turnLine = (s) => `Turn ${(s.turn | 0) + 1}`;


// ---- the panel --------------------------------------------------------------------
export function closeContractsPanel() { closePanel(); }
function closePanel() {
  _panelOpen = false;
  const el = document.getElementById('m4-contracts-panel');
  if (el) el.remove();
}

function cardThumb(id, side) {
  const el = renderContractCard(id, side);
  return el ? el.outerHTML : `<div class="m4c-missing">${esc(id)}</div>`;
}

function locationOf(p, id) {
  if ((p.contractHand || []).includes(id)) return 'Hand';
  if ((p.leo || []).some((s) => s.id === id)) return 'LEO';
  const r = p.rocket || {};
  if ((r.stack || []).some((s) => s.id === id)) return r.siteId ? `Rocket at ${spaceName(r.siteId)}` : 'Rocket at LEO';
  for (const o of Object.values(p.outposts || {})) {
    if ((o.cards || []).some((s) => s.id === id)) return `Outpost ${o.letter} at ${spaceName(o.siteId)}`;
  }
  const fr = p.freighter;
  if (fr && (fr.stack || []).some((s) => s.id === id)) return fr.siteId ? `Freighter at ${spaceName(fr.siteId)}` : 'Freighter at LEO';
  for (const bn of (p.bernals || [])) {
    if (bn && (bn.stack || []).some((s) => s.id === id)) return bn.siteId ? `Bernal at ${spaceName(bn.siteId)}` : 'Bernal at LEO';
  }
  return null;
}

// The Completed contracts tab, opened from the Contracts chip in the stack row.
export function openCompletedContracts() {
  // Nothing completed or in play yet: the market is what there is to see.
  const p = me();
  const mine = p && ((p.fulfilledContracts || []).length || Object.keys(p.contractMeta || {}).length);
  _tab = mine ? 'yours' : 'market';
  _panelOpen = true;
  renderPanel();
}
// The timepiece badge (turn bar): the contract on the clock, and where it is.
export function timepieceBadge() {
  const s = snap(); const p = me();
  if (!s || !s.m4 || !p || !p.timepiece) return null;
  const id = p.timepiece.contractId;
  const left = yearsFromNow(s, p.timepiece.slot);
  return {
    label: p.timepiece.deadbeat ? '⏱ Late' : `⏱ ${left} turn${left === 1 ? '' : 's'} left`,
    meta: (faceOf(p, id) || {}).name || '',
    late: !!p.timepiece.deadbeat,
    onClick: () => showContractWhere(id),
  };
}
export function showContractWhere(id) {
  const p = me();
  if (!p || !(p.contractMeta || {})[id]) return;
  document.getElementById('m4-contract-where')?.remove();
  const meta = p.contractMeta[id];
  const ov = document.createElement('div');
  ov.id = 'm4-contract-where';
  ov.className = 'm4c-overlay';
  ov.innerHTML = `<div class="m4c-modal m4c-where" role="dialog" aria-label="Contract">
    <div class="m4c-head"><h3>⏱ ${esc((faceOf(p, id) || {}).name || '')}</h3><button type="button" class="m4c-close" aria-label="Close">✕</button></div>
    <div class="m4c-where-body">${cardThumb(id, meta.side)}<div class="m4c-where-loc">📍 ${esc(locationOf(p, id) || 'In a stack')}</div></div></div>`;
  const close = () => ov.remove();
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.querySelector('.m4c-close').addEventListener('click', close);
  document.body.appendChild(ov);
}

let _tab = null;        // 'market' | 'yours'
// May the viewer start a contract auction now (the end of their Fundraise)?
function canAuctionNow(s, p, myTurn) {
  return !!(s && p && myTurn && p.fundraisedThisTurn && !p.contractAuctionDone && !p.timepiece && !s.auction
    && !s.anarchy && !s.war);
}
// The three pair decks, top card up. A deck you may auction carries one
// Auction button; one you may not is greyed out with none (owner 2026-11-18).
function decksHtml(s, p, auctionOpen) {
  const laws = lawKeys(s, p);
  return `<div class="m4c-decks">${Object.keys(CONTRACT_PAIRS).map((pair) => {
    const deck = (s.contractDecks || {})[pair] || [];
    const byLaw = CONTRACT_PAIRS[pair].some((k) => laws.has(k));
    const byConnections = !byLaw && hasContractAbility(p, 'connections')
      && CONTRACT_PAIRS[pair].some((k) => delegateIn(s, k, p.profileId));
    const top = deck[0];
    const open = (byLaw || byConnections) && !!top;
    const btn = auctionOpen && open
      ? `<div class="m4c-btns"><button type="button" data-act="auction" data-pair="${pair}">Auction</button></div>` : '';
    return `<div class="m4c-deck ${open ? 'open' : 'closed'}" ${open ? '' : 'aria-disabled="true"'}>
      <div class="m4c-deck-head"><b>${CONTRACT_PAIR_NAMES[pair]}</b>
        <span>${deck.length} left</span>
        <span class="m4c-law">${byLaw ? 'Active Law' : byConnections ? 'Connections' : ''}</span></div>
      ${top ? cardThumb(top, s.contractSide === 'gold' ? 'gold' : 'blue') : '<div class="muted">empty</div>'}${btn}</div>`;
  }).join('')}</div>`;
}
// The contract auction step of a Fundraise (owner 2026-11-18: the auction is
// part of the Fundraise). The Fundraise window renders it into `host` once the
// Fundraise lands; `done` closes the window (picking nothing skips the auction).
export function canStartContractAuction() { return canAuctionNow(snap(), me(), D && D.myTurn()); }
export function renderContractAuctionStep(host, done) {
  const s = snap(); const p = me();
  host.innerHTML = '';
  if (!canAuctionNow(s, p, D.myTurn())) return false;
  const wrap = document.createElement('div');
  wrap.className = 'm4c-fr-step';
  wrap.innerHTML = `<h4>📜 Contract auction</h4>${decksHtml(s, p, true)}
    <div class="m4c-btns m4c-fr-skip"><button type="button" data-skip>No auction</button></div>`;
  wrap.querySelectorAll('button[data-act="auction"]').forEach((b) => b.addEventListener('click', async () => {
    done();
    await D.submitTurnOp({ kind: 'AUCTION_CONTRACT_START', pair: b.dataset.pair });
  }));
  wrap.querySelector('[data-skip]').addEventListener('click', done);
  host.appendChild(wrap);
  return true;
}


function renderPanel() {
  const s = snap();
  const p = me();
  if (!s || !p) return;
  let el = document.getElementById('m4-contracts-panel');
  if (!el) {
    el = document.createElement('div');
    el.id = 'm4-contracts-panel';
    el.className = 'm4c-overlay';
    document.body.appendChild(el);
    el.addEventListener('click', (e) => { if (e.target === el) closePanel(); });
  }
  const myTurn = D.myTurn();
  const tp = p.timepiece;
  // Two tabs (owner 2026-11-18): Market contracts (dial + decks) and Completed
  // contracts (fulfilled, enterprises, the augmentations they give; boosted ones
  // in play sit at the top, with their Fulfill buttons).
  const market = [];
  const parts = [];
  // Market contracts: the three decks only (owner 2026-11-18: the dial shows in
  // the auction itself). A claimed default chit is named.
  const auctionOpen = false;   // the auction starts only in the Fundraise window
  if (s.defaultChit) market.push(`<p class="muted">🏷 Default chit: ${esc(nameOf(s.defaultChit.profileId))} (${s.defaultChit.side === 'gold' ? -6 : -3} VP)</p>`);
  market.push(decksHtml(s, p, auctionOpen));
  market.push(isotopesHtml(s, p, myTurn));

  // Contracts in hand live in the Hand area (4B3h: a won contract is a Hand
  // Card), so the panel only points there; boosted and fulfilled ones are here.
  const boosted = Object.keys(p.contractMeta || {}).filter((id) => !(p.contractHand || []).includes(id)).map((id) => {
    const meta = p.contractMeta[id];
    const f = faceOf(p, id);
    const where = locationOf(p, id) || 'in a stack';
    const late = tp && tp.contractId === id && tp.deadbeat;
    return `<div class="m4c-item">${cardThumb(id, meta.side)}
      <div class="m4c-note">${esc(where)}</div>
      <div class="m4c-btns">${myTurn ? `<button type="button" data-act="fulfill" data-id="${id}">Fulfill here</button>` : ''}
      ${myTurn && late ? `<button type="button" data-act="pay" data-id="${id}" data-max="${f.lateFee}">Pay late fee (${f.lateFee})</button>` : ''}
      ${myTurn && abandonBlock(s, p, id) === null ? `<button type="button" data-act="abandon" data-id="${id}">Abandon (Anarchy)</button>` : ''}</div></div>`;
  }).join('');
  const partnerLine = (x) => ((x.partners || []).length
    ? `<div class="m4c-note">🤝 ${x.partners.map((id) => { const q = playerById(id) || {}; return `<span class="player-name" style="--player-color:${esc(q.color || 'currentColor')}">@${esc(q.name || nameOf(id))}</span>`; }).join(', ')}</div>`
    : '');
  const fulfilled = (p.fulfilledContracts || []).map((x) => `<div class="m4c-item">${cardThumb(x.id, x.side)}${partnerLine(x)}</div>`).join('');
  // My partner enterprises: other players' fulfilled contracts carrying my delegate.
  const partnered = [];
  for (const q of (s.players || [])) {
    if (q.profileId === p.profileId) continue;
    for (const x of (q.fulfilledContracts || [])) {
      if ((x.partners || []).includes(p.profileId)) partnered.push(`<div class="m4c-item">${cardThumb(x.id, x.side)}<div class="m4c-note"><span class="player-name" style="--player-color:${esc(q.color || 'currentColor')}">@${esc(q.name)}</span> · no VP</div></div>`);
    }
  }
  // No In hand section (the Hand shows them; the timepiece badge finds the one
  // on the clock), and empty sections are left out (owner 2026-11-18).
  if (boosted) parts.push(`<h4>Boosted</h4><div class="m4c-row">${boosted}</div>`);
  parts.push(augmentationsHtml(s, p, myTurn));
  if (fulfilled) parts.push(`<h4>Fulfilled</h4><div class="m4c-row">${fulfilled}</div>`);
  if (partnered.length) parts.push(`<h4>Enterprises</h4><div class="m4c-row">${partnered.join('')}</div>`);

  // The tab the player last chose (Completed contracts at first).
  const tab = _tab || 'yours';
  if (!parts.length) parts.push('<p class="muted">None yet.</p>');
  el.innerHTML = `<div class="m4c-modal" role="dialog" aria-label="Contracts">
    <div class="m4c-head"><h3>📜 Contracts</h3>
      <div class="m4c-tabs" role="tablist">
        <button type="button" role="tab" data-tab="market" class="${tab === 'market' ? 'sel' : ''}">Market contracts</button>
        <button type="button" role="tab" data-tab="yours" class="${tab === 'yours' ? 'sel' : ''}">Completed contracts</button>
      </div>
      <button type="button" class="m4c-close" aria-label="Close">✕</button></div>
    <div class="m4c-body">${(tab === 'market' ? market : parts).join('')}</div></div>`;
  el.querySelector('.m4c-close').addEventListener('click', closePanel);
  el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { _tab = b.dataset.tab; renderPanel(); }));
  el.querySelectorAll('button[data-act]').forEach((b) => b.addEventListener('click', () => onAct(b)));
}

// ---- isotope monetization (3B5, 4D1) ------------------------------------------------
// Gold beads at your Bank are worth 10 aqua each. Blue/Gold Exchange: sell one to
// the Earth market for 10 aqua, or buy one from it for 10 aqua (free actions).
function isotopesHtml(s, p, myTurn) {
  const bank = Math.max(0, p.isotopes | 0);
  const market = Math.max(0, s.earthMarket | 0);
  const r = p.rocket || {};
  const tankIso = (r.tankGrade === 'isotope') ? Math.floor(Number(r.tank) || 0) : 0;
  const status = s.isotopeMonetized
    ? 'Isotope is monetized: FINAO costs are doubled.'
    : 'Isotope is not monetized yet: the first gold bead refined monetizes it.';
  const btn = (act, label, ok, tip) => `<button type="button" data-act="${act}"${ok ? '' : ' disabled'} data-tip="${esc(tip)}">${label}</button>`;
  return `<h4>Isotopes</h4>
    <p class="muted">${status}</p>
    <p>🟡 At your Bank: <b>${bank}</b> (worth ${bank * 10} aqua) · Earth market: <b>${market}</b></p>
    <div class="m4c-controls">
      ${btn('iso-sell', 'Sell 1 for 10 aqua', myTurn && bank > 0, 'Sell a gold bead to the Earth market for 10 aqua. Free action.')}
      ${btn('iso-buy', 'Buy 1 for 10 aqua', myTurn && market > 0 && (p.aqua | 0) >= 10, 'Buy a gold bead from the Earth market into your Bank. Free action.')}
      ${tankIso > 0 ? btn('iso-tank', `Bring ${tankIso} from the tank to the Bank`, myTurn, 'Unload the whole isotope units in your rocket tank into your Bank. Your rocket must be at your Bank (LEO or your Home Bernal).') : ''}
    </div>`;
}

// ---- augmentations (4C) ------------------------------------------------------------
const SHAPES = ['heart', 'jar', 'hexagon', 'splat', 'battery', 'triangle'];
function portfolioOf(p) {
  const out = new Set();
  for (const f of (p.fulfilledContracts || [])) for (const c of ((contractFace(f.id, f.side) || {}).cybernetics || [])) out.add(c);
  // Partner enterprises (4B8d): other players' fulfilled contracts with my delegate.
  for (const q of ((snap() && snap().players) || [])) {
    if (q.profileId === p.profileId) continue;
    for (const f of (q.fulfilledContracts || [])) {
      if ((f.partners || []).includes(p.profileId)) for (const c of ((contractFace(f.id, f.side) || {}).cybernetics || [])) out.add(c);
    }
  }
  return out;
}
const sideText = (shape, side) => ((AUGMENTS[shape] || {}).tip || '').split(' / ')[side - 1] || '';
function augmentationsHtml(s, p, myTurn) {
  const portfolio = portfolioOf(p);
  const aug = p.augments || {};
  const colName = (id) => (COLONISTS_BY_ID[id] || {}).name || id;
  const chips = SHAPES.map((sh) => {
    const a = aug[sh];
    const have = portfolio.has(sh);
    const on = a && (a.crewId ? crewName(a.crewId) : a.colonySite ? `${spaceName(a.colonySite)} Colony` : colName(a.colonistId));
    const st = a ? `<span class="m4c-aug-tag">Augmented</span> ${esc(on)} · side ${a.side}` : (have ? 'ready' : '');
    // Without M2, any chit in your possession opens the Augment operation.
    const click = !s.m2 && myTurn && have;
    const glyph = a ? augmentSideSvg(sh, a.side, { size: 34 }) : augmentGlyph(sh, { size: 26 });
    // Every other chit, held or not, opens a look at its two sides.
    const act = click ? 'augment' : 'chit-view';
    return `<button type="button" data-act="${act}" data-shape="${sh}" class="m4c-aug ${have ? 'have' : 'lack'}${a ? ' on' : ''}"${a ? ` data-tip="${esc(sideText(sh, a.side))}"` : ''}>${glyph}<span><b>${AUGMENTS[sh].name}</b> ${st}</span></button>`;
  }).join('');
  const opts = [...portfolio].map((sh) => `<option value="${sh}">${AUGMENTS[sh].name}</option>`).join('');
  const controls = (key, attrs) => (myTurn && opts ? `<div class="m4c-controls"><select data-shape-for="${key}">${opts}</select>
    <select data-side-for="${key}"><option value="2">side 2</option><option value="1">side 1</option></select>
    <button type="button" data-act="implant" ${attrs}>Implant</button></div>` : '');
  // Without Module 2 a chit goes on a Crew at a BEO Colony (owner 2026-11-18):
  // click a chit you hold to start the Augment operation.
  if (!s.m2) return `<h4>Augmentations</h4><div class="m4c-augs">${chips}</div>`;
  const bns = (p.bernals || []).map((bn, i) => ({ bn, i })).filter((x) => x.bn.anchored);
  let station = '<p class="muted">No anchored Bernal.</p>';
  if (bns.length) {
    const { bn, i } = bns[0];
    const cols = (bn.stack || []).filter((sl) => COLONISTS_BY_ID[sl.id]);
    station = cols.length ? cols.map((sl) => {
      const mine = SHAPES.filter((sh) => aug[sh] && aug[sh].colonistId === sl.id).map((sh) => augmentGlyph(sh, { size: 22 })).join('');
      return `<div class="m4c-col"><b>${esc(colName(sl.id))}</b> <span class="muted">${esc((COLONISTS_BY_ID[sl.id] || {}).specialty || '')}</span> ${mine}
        ${myTurn && opts ? `<div class="m4c-controls"><select data-shape-for="${sl.id}">${opts}</select>
          <select data-side-for="${sl.id}"><option value="2">side 2</option><option value="1">side 1</option></select>
          <button type="button" data-act="implant" data-col="${sl.id}" data-bernal="${i}">Implant</button></div>` : ''}</div>`;
    }).join('') : '<p class="muted">No Colonists aboard.</p>';
  }
  return `<h4>Augmentations</h4>
    <div class="m4c-augs">${chips}</div>${station}`;
}

async function onAct(b) {
  const act = b.dataset.act;
  const id = b.dataset.id;
  const pair = b.dataset.pair;
  if (act === 'auction') await D.submitTurnOp({ kind: 'AUCTION_CONTRACT_START', pair });
  else if (act === 'boost') await D.submitTurnOp({ kind: 'BOOST', cardIds: [id] });
  else if (act === 'fulfill') await fulfillContract(id);
  else if (act === 'implant') {
    const col = b.dataset.col;
    const panel = document.getElementById('m4-contracts-panel');
    const shape = panel.querySelector(`[data-shape-for="${col}"]`).value;
    const side = Number(panel.querySelector(`[data-side-for="${col}"]`).value);
    const p = me();
    const a = p && p.augments && p.augments[shape];
    if (b.dataset.colony) {
      // Juggling only off this same Colony.
      const remove = a && a.colonySite === col ? [shape] : [];
      await D.submitTurnOp({ kind: 'IMPLANT', colony: col, remove, implants: [{ shape, side }] });
    } else {
      // Juggling (4C4e): a chit already on another Colonist aboard comes off first.
      const remove = a && a.colonistId !== col ? [shape] : [];
      await D.submitTurnOp({ kind: 'IMPLANT', bernal: Number(b.dataset.bernal), remove, implants: [{ colonistId: col, shape, side }] });
    }
  }
  else if (act === 'augment') { openAugmentWizard(b.dataset.shape); return; }
  else if (act === 'chit-view') { openChitSides(b.dataset.shape); return; }
  else if (act === 'iso-sell') await D.submitTurnOp({ kind: 'ISOTOPE_EXCHANGE', action: 'sell', amount: 1 });
  else if (act === 'iso-buy') await D.submitTurnOp({ kind: 'ISOTOPE_EXCHANGE', action: 'buy', amount: 1 });
  else if (act === 'iso-tank') await D.submitTurnOp({ kind: 'ISOTOPE_EXCHANGE', action: 'deposit' });
  else if (act === 'pay') await payContractFee(id);
  else if (act === 'abandon') await abandonContract(id);
  if (act === 'auction') closePanel();
  else if (_panelOpen) renderPanel();
}

// ---- hand-card actions (shared with the Hand area in browse.js) --------------------
// Why a contract can't be abandoned right now, or null when it can (4B7d: only
// during Anarchy / War, never a military contract; the game also checks it is in
// hand, at LEO or at an anchored Bernal).
export function abandonBlock(s, p, id) {
  s = s || snap(); p = p || me();
  if (!s || !s.m4 || !p || !(p.contractMeta || {})[id]) return 'not yours';
  if (/military/i.test((faceOf(p, id) || {}).contractType || '')) return 'A military contract can never be abandoned.';
  if (!(s.anarchy || s.war)) return 'A contract can only be abandoned during Anarchy.';
  return null;
}
// Is this contract late (deadbeat timepiece) or in default? Then a fee is due.
export function contractFeeDue(id) {
  const p = me();
  if (!p) return false;
  const meta = (p.contractMeta || {})[id] || {};
  const tp = p.timepiece;
  return !!(meta.default || (tp && tp.contractId === id && tp.deadbeat));
}
// FULFILL_CONTRACT. Planetary Protection's last step also seats up to 2
// delegates in one Ideology (M0), so pick it first.
async function fulfillContract(id) {
  const p = me();
  const f = p && faceOf(p, id);
  const meta = (p && (p.contractMeta || {})[id]) || {};
  const last = f && Array.isArray(f.steps) && ((meta.progress && meta.progress.done) | 0) >= f.steps.length - 1;
  const s = snap();
  if (f && last && f.onFulfill && f.onFulfill.bustAndDelegates && s && s.m0 !== false) {
    const ideology = await pickIdeology(f.name);
    if (ideology === undefined) return;
    await D.submitTurnOp({ kind: 'FULFILL_CONTRACT', cardId: id, ...(ideology ? { ideology, delegates: 2 } : {}) });
    return;
  }
  await D.submitTurnOp({ kind: 'FULFILL_CONTRACT', cardId: id });
}
// One Ideology for 2 delegates, or none. Resolves the key, null (none) or
// undefined (cancelled).
function pickIdeology(title) {
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.className = 'card-modal-overlay confirm-modal-overlay';
    ov.innerHTML = `<div class="turn-confirm-panel m4-ideo-pick" role="dialog" aria-label="${esc(title)}">
      <h3>${esc(title)}</h3><p>2 delegates:</p>
      <div class="m4-ideo-row">${IDEOLOGY_ORDER.map((k) => `<button type="button" data-ideo="${k}" style="--ideo:${IDEOLOGY_BY_KEY[k].color}">${esc(IDEOLOGY_BY_KEY[k].name)}</button>`).join('')}</div>
      <div class="turn-confirm-actions"><button type="button" class="popup-btn" data-ideo="">None</button><button type="button" class="popup-btn" data-cancel>Cancel</button></div>
    </div>`;
    const done = (v) => { ov.remove(); resolve(v); };
    ov.addEventListener('click', (e) => {
      if (e.target === ov) return done(undefined);
      const b = e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-cancel')) return done(undefined);
      done(b.dataset.ideo || null);
    });
    document.body.appendChild(ov);
  });
}
export async function payContractFee(id) {
  const p = me();
  const f = p && faceOf(p, id);
  if (!f) return;
  const owedTurn = f.lateFee - ((p.lateFeePaidThisTurn) | 0);
  if (owedTurn <= 0) { D.toast('You have paid this turn\'s late fee.', 'info'); return; }
  await D.submitTurnOp({ kind: 'PAY_LATE_FEE', cardId: id, amount: Math.min(owedTurn, p.aqua | 0) || owedTurn });
}
export async function abandonContract(id) {
  const p = me();
  const why = abandonBlock(null, p, id);
  if (why) { D.toast(why, 'info'); return; }
  const meta = (p.contractMeta || {})[id] || {};
  const f = faceOf(p, id);
  const ok = await D.confirm({
    title: '🗑 Abandon contract',
    body: `Abandon <strong>${esc(f.name)}</strong>? It goes to the bottom of its deck and your timepiece comes home. `
      + 'You pay no late fee and owe nothing back, but you take the default chit '
      + `(<strong>${meta.side === 'gold' ? '-6' : '-3'} VP</strong> at game end).`,
    yes: '🗑 Abandon', no: 'Keep it',
  });
  if (ok) await D.submitTurnOp({ kind: 'ABANDON_CONTRACT', cardId: id });
}

// ---- the auction overlay ----------------------------------------------------------
let _yearsDraft = null;
// Minimize, as every auction does: the overlay collapses to an Auction button
// in the turn bar. A new lot always opens expanded.
let _caMin = false;
let _caKey = null;
let _caLast = null;
export function setContractAuctionMinimized(on) {
  _caMin = !!on;
  if (_caLast) renderContractAuction(_caLast);
}
export function renderContractAuction(a) {
  let el = document.getElementById('m4-contract-auction');
  if (!a) {
    if (el) el.remove();
    _yearsDraft = null; _caMin = false; _caKey = null; _caLast = null;
    if (D && D.setTurnAction) D.setTurnAction('contract-auction', null);
    return;
  }
  _caLast = a;
  if (_caKey !== a.cardId) { _caKey = a.cardId; _caMin = false; }
  const s = snap();
  const p = me();
  if (!el) {
    el = document.createElement('div');
    el.id = 'm4-contract-auction';
    el.className = 'm4c-overlay m4c-auction';
    document.body.appendChild(el);
  }
  const face = contractFace(a.cardId, a.side || 'blue');
  const myId = p && p.profileId;
  const iAmAuctioneer = myId === a.auctioneerId;
  const blocked = p && (p.timepiece ? 'Timepiece out.'
    : (face.manned && s.defaultChit && s.defaultChit.profileId === myId ? 'Default chit: no manned bids.' : null));
  const waiting = (s.players || []).filter((q) => q.profileId !== a.auctioneerId && !(a.acted || []).includes(q.profileId)
    && !q.timepiece && !(face.manned && s.defaultChit && s.defaultChit.profileId === q.profileId));
  const settled = !waiting.length;
  if (_yearsDraft == null || _yearsDraft > a.low) _yearsDraft = Math.max(0, a.low - (iAmAuctioneer ? 0 : 1));
  // The dial: each bid is its bidder's timepiece on the slot that many years
  // from the Cube; your draft is a faded timepiece you set by tapping a slot.
  const turn = s.turn | 0;
  const slotFor = (y) => (turn + y) % SLOTS;
  const markers = timepieceMarkers(s, null);
  for (const [id, y] of Object.entries(a.bids || {})) {
    const q = playerById(Number(id)) || {};
    markers.push({ slot: slotFor(y), svg: timepieceDialGlyph({ color: q.color || '#e5e7eb', size: DIAL_GLYPH }), title: `@${q.name || nameOf(Number(id))} bid ${y} year${y === 1 ? '' : 's'}` });
  }
  const canBid = !blocked;
  // The bid winning right now (bold + underlined): the lowest; the initiator
  // wins ties they are in (4B3g).
  const lowIds = Object.entries(a.bids || {}).filter(([, y]) => y === a.low).map(([id]) => Number(id));
  const leaderId = lowIds.includes(a.auctioneerId) ? a.auctioneerId : lowIds[0];
  const myBid = (a.bids || {})[myId];
  if (canBid && myBid !== _yearsDraft) {
    markers.push({ slot: slotFor(_yearsDraft), svg: timepieceDialGlyph({ color: (p && p.color) || '#e5e7eb', size: DIAL_GLYPH, ghost: true }), title: `Your bid: ${_yearsDraft} years` });
  }
  const dial = sunspotDialSvg({
    turn, markers,
    band: _yearsDraft > 0 ? { from: (turn + 1) % SLOTS, to: slotFor(_yearsDraft), color: '#34d399' } : null,
    pick: canBid ? { from: turn, to: slotFor(a.low), title: (slot) => { const y = ((slot - turn) + SLOTS) % SLOTS; return `Bid ${y} year${y === 1 ? '' : 's'} (due turn ${slot + 1})`; } } : null,
    // The bids, lowest first, inside the dial in each bidder's colour.
    center: [turnLine(s),
      ...Object.entries(a.bids || {}).map(([id, y]) => {
        const q = playerById(Number(id)) || {};
        return { text: `@${esc(q.name || nameOf(Number(id)))} ${y}`, color: q.color || null, strong: Number(id) === leaderId };
      }),
      ...(canBid && myBid !== _yearsDraft ? [{ text: `you ${_yearsDraft}`, color: '#34d399' }] : [])],
  });
  const opts = Array.from({ length: a.low + 1 }, (_, y) => `<option value="${y}" ${y === _yearsDraft ? 'selected' : ''}>${y} yr</option>`).join('');
  let controls = '';
  if (blocked) controls = `<p class="muted">${blocked}</p>`;
  else {
    // What you have set now: your standing bid, and a greyed button while the
    // picker still shows that same bid.
    const isSet = myBid != null && myBid === _yearsDraft;
    controls = `<select id="m4c-years" aria-label="Your bid in years">${opts}</select>
      <button type="button" data-act="bid" ${isSet ? 'disabled' : ''}>${isSet ? `✓ ${myBid} yr set` : `Submit ${_yearsDraft} yr`}</button>
      ${iAmAuctioneer ? '' : '<button type="button" data-act="pass">Pass</button>'}`;
  }
  const mine = myBid != null
    ? `<p class="m4c-mybid">Your bid: <b style="color:${esc((p && p.color) || '#e5e7eb')}">${myBid} yr</b>${myId === leaderId ? ' · winning' : ''}</p>`
    : (p && (a.passed || []).includes(myId) ? '<p class="m4c-mybid">You passed</p>' : '');
  if (iAmAuctioneer) {
    // Ties (4B3g), as in a patent auction: the initiator wins a tie they are in;
    // otherwise they name the winner among the tied bidders.
    const tied = Object.keys(a.bids || {}).map(Number).filter((id) => a.bids[id] === a.low);
    const pick = tied.length > 1 && !tied.includes(a.auctioneerId);
    controls += pick
      ? `<div class="m4c-btns">${tied.map((id) => `<button type="button" data-act="close" data-winner="${id}" ${settled ? '' : 'disabled'}>Award to @${esc(nameOf(id))} (${a.low} yr)</button>`).join('')}</div>`
      : `<div class="m4c-btns"><button type="button" data-act="close" ${settled ? '' : 'disabled'}>Close</button></div>`;
  }
  el.innerHTML = `<div class="m4c-modal" role="dialog" aria-label="Contract auction">
    <div class="m4c-head"><h3>📜 Auction</h3><span class="muted">${CONTRACT_PAIR_NAMES[a.pair] || ''}</span>
      <button type="button" class="mp-mini-btn m4c-mini" title="Minimize" aria-label="Minimize">&minus;</button></div>
    <div class="m4c-auction-body">
      <div class="m4c-auction-card">${cardThumb(a.cardId, a.side || 'blue')}</div>
      <div class="m4c-auction-play">
        <div class="m4c-dial m4c-auction-dial">${dial}</div>
        ${mine}
        <div class="m4c-controls">${controls}</div>
        <p class="m4c-wait">${settled ? `${esc(nameOf(a.auctioneerId))} to close` : `Waiting: ${waiting.map((q) => '@' + esc(q.name)).join(', ')}`}</p>
      </div></div></div>`;
  // Docked: the overlay hides and the turn bar carries the Auction button.
  const myMove = !blocked && myId !== a.auctioneerId && !(a.acted || []).includes(myId);
  const myClose = iAmAuctioneer && settled;
  el.classList.toggle('m4c-minimized', _caMin);
  if (D && D.setTurnAction) {
    D.setTurnAction('contract-auction', _caMin ? {
      label: '📜 Auction',
      meta: myBid != null ? `you ${myBid} yr` : `${a.low} yr`,
      needsAction: myMove || myClose,
      onClick: () => setContractAuctionMinimized(false),
    } : null);
  }
  const mini = el.querySelector('.m4c-mini');
  if (mini) mini.addEventListener('click', () => setContractAuctionMinimized(true));
  const sel = el.querySelector('#m4c-years');
  if (sel) sel.addEventListener('change', () => { _yearsDraft = Number(sel.value); renderContractAuction(a); });
  el.querySelectorAll('.dial-hit').forEach((h) => h.addEventListener('click', () => {
    _yearsDraft = ((Number(h.dataset.slot) - turn) + SLOTS) % SLOTS;
    const body = el.querySelector('.m4c-auction-body');
    const top = body ? body.scrollTop : 0;
    renderContractAuction(a);
    const nb = el.querySelector('.m4c-auction-body');
    if (nb) nb.scrollTop = top;
  }));
  el.querySelectorAll('button[data-act]').forEach((b) => b.addEventListener('click', async () => {
    const act = b.dataset.act;
    if (act === 'bid') await D.submitAuctionOp({ kind: 'AUCTION_CONTRACT_BID', years: Number(sel.value) });
    else if (act === 'pass') await D.submitAuctionOp({ kind: 'AUCTION_CONTRACT_PASS' });
    else if (act === 'close') await D.submitAuctionOp({ kind: 'AUCTION_CONTRACT_CLOSE', ...(b.dataset.winner ? { winnerId: Number(b.dataset.winner) } : {}) });
  }));
}

// ---- the Augment operation (4C4, without Module 2) ---------------------------------
// Owner 2026-11-18: click a chit you hold to begin. A chit goes on a Crew card
// standing at a BEO Colony; during the operation you may take chits off anyone
// and put them on anyone, as many as you like, for the one operation.
function crewSlotsOf(p) {
  const out = [];
  const add = (arr, site, where) => {
    for (const sl of (arr || [])) if (sl && CREW_BY_ID[sl.id]) out.push({ slot: sl, site: site == null ? 'leo' : String(site), where });
  };
  if (p.rocket) add(p.rocket.stack, p.rocket.siteId, 'Rocket');
  add(p.leo, null, 'LEO');
  for (const o of Object.values(p.outposts || {})) if (o) add(o.cards, o.siteId, `Outpost ${o.letter}`);
  if (p.freighter) add(p.freighter.stack, p.freighter.siteId, 'Freighter');
  for (const bn of (p.bernals || [])) if (bn) add(bn.stack, bn.siteId, 'Bernal');
  return out;
}
function crewName(id) {
  const p = me();
  const e = p && crewSlotsOf(p).find((x) => String(x.slot.id) === String(id));
  const card = CREW_BY_ID[id];
  if (!card) return String(id);
  const face = card.faces && card.faces[e && e.slot.face === 'secondary' ? 'secondary' : 'primary'];
  return (face && face.name) || card.name || String(id);
}
let _aug = null;   // { shape, plan: { [shape]: { crewId, side } | null } }
export function openAugmentWizard(shape) {
  const p = me();
  if (!p) return;
  const plan = {};
  for (const [sh, a] of Object.entries(p.augments || {})) plan[sh] = a ? { crewId: a.crewId || null, side: a.side, colonySite: a.colonySite || null } : null;
  _aug = { shape, plan };
  renderAugmentWizard();
}
function renderAugmentWizard() {
  const s = snap(); const p = me();
  if (!s || !p || !_aug) return;
  let ov = document.getElementById('m4-augment-wizard');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'm4-augment-wizard';
    ov.className = 'm4c-overlay';
    ov.addEventListener('click', (e) => { if (e.target === ov) closeAugmentWizard(); });
    document.body.appendChild(ov);
  }
  const portfolio = portfolioOf(p);
  const cur = p.augments || {};
  const { shape, plan } = _aug;
  const same = (a, b) => (!a && !b) || (a && b && a.crewId === b.crewId && a.side === b.side && (a.crewId || a.colonySite === b.colonySite));
  const changes = SHAPES.filter((sh) => !same(cur[sh] ? { crewId: cur[sh].crewId || null, side: cur[sh].side, colonySite: cur[sh].colonySite || null } : null, plan[sh] || null));
  const chits = SHAPES.filter((sh) => portfolio.has(sh)).map((sh) => {
    const pl = plan[sh];
    const tag = pl ? (pl.crewId ? crewName(pl.crewId) : `${spaceName(pl.colonySite)} Colony`) : '';
    return `<button type="button" class="m4c-aw-chit${sh === shape ? ' sel' : ''}${pl ? ' on' : ''}${changes.includes(sh) ? ' changed' : ''}" data-aw-shape="${sh}">
      ${augmentGlyph(sh, { size: 30 })}<span>${AUGMENTS[sh].name}</span>${pl ? `<small>${esc(tag)}</small>` : ''}</button>`;
  }).join('');
  // Targets: Crew at a Colony (not LEO). The chit's current Crew stays listed.
  const crews = crewSlotsOf(p).filter((x) => x.site !== 'leo' && (s.colonies || {})[x.site]);
  const pl = plan[shape] || null;
  const targets = crews.map((x) => `<button type="button" class="m4c-aw-target${pl && pl.crewId === x.slot.id ? ' sel' : ''}" data-aw-crew="${esc(x.slot.id)}">
      <b>${esc(crewName(x.slot.id))}</b><small>${esc(x.where)} · ${esc(spaceName(x.site))} Colony</small></button>`).join('')
    || '<p class="muted">No Crew at a Colony.</p>';
  const sides = [1, 2].map((n) => {
    const blocked = shape === 'heart' && n === 1;   // Parenthood needs M2
    return `<button type="button" class="m4c-aw-side${pl && pl.side === n ? ' sel' : ''}" data-aw-side="${n}" ${!pl || blocked ? 'disabled' : ''}${blocked ? ' data-tip="Needs M2"' : ''}>
      ${augmentSideSvg(shape, n, { size: 44 })}<span><b>Side ${n}</b><small>${esc(sideText(shape, n))}</small></span></button>`;
  }).join('');
  ov.innerHTML = `<div class="m4c-modal m4c-aw" role="dialog" aria-label="Augment">
    <div class="m4c-head"><h3>Augment</h3><button type="button" class="m4c-close" aria-label="Close">✕</button></div>
    <div class="m4c-aw-chits">${chits}</div>
    <div class="m4c-aw-step"><h4>${AUGMENTS[shape].name}: Crew</h4><div class="m4c-aw-targets">${targets}
      ${pl ? '<button type="button" class="m4c-aw-target off" data-aw-off="1"><b>Unaugment</b></button>' : ''}</div></div>
    <div class="m4c-aw-step"><h4>Side</h4><div class="m4c-aw-sides">${sides}</div></div>
    <div class="m4c-btns m4c-aw-go"><button type="button" data-aw-cancel>Cancel</button>
      <button type="button" class="primary" data-aw-submit ${changes.length ? '' : 'disabled'}>Augment${changes.length > 1 ? ` (${changes.length} chits)` : ''}</button></div>
  </div>`;
  ov.querySelector('.m4c-close').addEventListener('click', closeAugmentWizard);
  ov.querySelector('[data-aw-cancel]').addEventListener('click', closeAugmentWizard);
  ov.querySelectorAll('[data-aw-shape]').forEach((b) => b.addEventListener('click', () => { _aug.shape = b.dataset.awShape; renderAugmentWizard(); }));
  ov.querySelectorAll('[data-aw-crew]').forEach((b) => b.addEventListener('click', () => {
    const prev = plan[shape];
    plan[shape] = { crewId: b.dataset.awCrew, side: prev && prev.side ? prev.side : 2, colonySite: null };
    renderAugmentWizard();
  }));
  ov.querySelector('[data-aw-off]')?.addEventListener('click', () => { plan[shape] = null; renderAugmentWizard(); });
  ov.querySelectorAll('[data-aw-side]').forEach((b) => b.addEventListener('click', () => {
    if (plan[shape]) { plan[shape] = { ...plan[shape], side: Number(b.dataset.awSide) }; renderAugmentWizard(); }
  }));
  ov.querySelector('[data-aw-submit]').addEventListener('click', async () => {
    const remove = changes.filter((sh) => cur[sh]);
    const implants = changes.filter((sh) => plan[sh] && plan[sh].crewId).map((sh) => ({ shape: sh, side: plan[sh].side, crewId: plan[sh].crewId }));
    closeAugmentWizard();
    await D.submitTurnOp({ kind: 'IMPLANT', remove, implants });
    if (_panelOpen) renderPanel();
  });
}
// A look at a chit's two sides (any chit, held or not).
function openChitSides(shape) {
  if (!AUGMENTS[shape]) return;
  document.getElementById('m4-chit-sides')?.remove();
  const ov = document.createElement('div');
  ov.id = 'm4-chit-sides';
  ov.className = 'm4c-overlay';
  const close = () => ov.remove();
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  const sides = [1, 2].map((n) => `<div class="m4c-aw-side m4c-cs-side">${augmentSideSvg(shape, n, { size: 96 })}
      <span><b>Side ${n}</b><small>${esc(sideText(shape, n))}</small></span></div>`).join('');
  ov.innerHTML = `<div class="m4c-modal m4c-aw" role="dialog" aria-label="${esc(AUGMENTS[shape].name)}">
    <div class="m4c-head"><h3>${esc(AUGMENTS[shape].name)}</h3><button type="button" class="m4c-close" aria-label="Close">✕</button></div>
    <div class="m4c-aw-sides">${sides}</div></div>`;
  ov.querySelector('.m4c-close').addEventListener('click', close);
  document.body.appendChild(ov);
}
function closeAugmentWizard() {
  _aug = null;
  document.getElementById('m4-augment-wizard')?.remove();
}
