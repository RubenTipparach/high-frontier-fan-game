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
import { renderContractCard } from './contract-card.js';
import { augmentGlyph, AUGMENTS } from './contract-glyphs.js';
import { isM4, isM2 } from './online-mode.js';
import { COLONISTS_BY_ID } from '../../data/colonists.js';

let D = null;               // deps from browse.js (snapshot readers + submitters)
let _panelOpen = false;
const SLOTS = 12;

export function initContractsUi(deps) { D = deps; }

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const snap = () => (D && D.snapshot()) || null;
const me = () => (D && D.me()) || null;
const nameOf = (id) => ((snap() && snap().players || []).find((p) => p.profileId === id) || {}).name || 'a player';
const playerById = (id) => (snap() && snap().players || []).find((p) => p.profileId === id) || null;
const faceOf = (p, id) => contractFace(id, ((p.contractMeta || {})[id] || {}).side || 'blue');
const lawKeys = (s) => {
  const out = new Set();
  if (s && s.activeLawStar) out.add(s.activeLawStar);
  for (const k of (s && s.activeLaws) || []) out.add(k);
  return out;
};
const yearsFromNow = (s, slot) => ((slot - (s.turn | 0)) + SLOTS) % SLOTS;

// ---- toolbar tag ----------------------------------------------------------------
function ensureTag() {
  const host = document.getElementById('turn-budget');
  if (!host) return null;
  let tag = document.getElementById('turn-tag-contracts');
  if (!tag) {
    tag = document.createElement('button');
    tag.type = 'button';
    tag.id = 'turn-tag-contracts';
    tag.className = 'turn-tag';
    tag.title = 'Your contracts: timepiece, auction, boost, fulfill, late fees';
    tag.addEventListener('click', () => { _panelOpen = true; renderPanel(); });
    host.appendChild(tag);
  }
  return tag;
}

// Called on every snapshot apply (browse.js#applySnapshot).
export function refreshContractsUi() {
  const s = snap();
  const on = !!(s && isM4() && s.m4);
  const tag = ensureTag();
  if (tag) {
    tag.hidden = !on;
    if (on) {
      const p = me();
      const tp = p && p.timepiece;
      const late = tp && tp.deadbeat;
      const canAuction = p && D.myTurn() && p.fundraisedThisTurn && !p.contractAuctionDone && !tp;
      tag.textContent = late ? '⏰ contract LATE' : (canAuction ? '📜 contract auction' : '📜 contracts');
      tag.classList.toggle('turn-tag-alert', !!(late || canAuction));
    }
  }
  if (!on) { closePanel(); renderContractAuction(null); return; }
  renderContractAuction(s.auction && s.auction.kind === 'contract' ? s.auction : null);
  if (_panelOpen) renderPanel();
}

// ---- the panel --------------------------------------------------------------------
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
  if ((p.leo || []).some((s) => s.id === id)) return 'LEO';
  const r = p.rocket || {};
  if ((r.stack || []).some((s) => s.id === id)) return r.siteId ? `rocket at ${r.siteId}` : 'rocket at LEO';
  return null;
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
  const parts = [];
  // Timepiece + default chit
  let tpLine = 'Your timepiece is in your Reserve: you may win a contract auction.';
  if (tp) {
    const f = faceOf(p, tp.contractId);
    const tmeta = (p.contractMeta || {})[tp.contractId] || {};
    const owed = (f.advance * (tmeta.boosted ? 1 : 2)) - (tmeta.paid | 0);
    tpLine = tmeta.default
      ? `<b class="m4c-late">IN DEFAULT</b>: ${esc(f.name)} can never be fulfilled. ${owed} aqua of debt left (up to ${f.lateFee} a turn); the timepiece stays out until it is repaid.`
      : tp.deadbeat
      ? `<b class="m4c-late">LATE</b>: ${esc(f.name)} - pay its ${f.lateFee}-aqua late fee this turn or it defaults.`
      : `Timepiece on slot ${tp.slot} (${yearsFromNow(s, tp.slot)} year${yearsFromNow(s, tp.slot) === 1 ? '' : 's'} away) for ${esc(f.name)}.`;
  }
  const chit = s.defaultChit
    ? `Default chit: ${esc(nameOf(s.defaultChit.profileId))} (${s.defaultChit.side} side, ${s.defaultChit.side === 'gold' ? -6 : -3} VP).`
    : 'Default chit: unclaimed.';
  parts.push(`<div class="m4c-status"><div>⏱ ${tpLine}</div><div>🏷 ${chit}</div></div>`);

  // Contract auction (the Fundraise's final step)
  const laws = lawKeys(s);
  const auctionOpen = myTurn && p.fundraisedThisTurn && !p.contractAuctionDone && !tp && !s.auction;
  const decks = Object.keys(CONTRACT_PAIRS).map((pair) => {
    const deck = (s.contractDecks || {})[pair] || [];
    const open = CONTRACT_PAIRS[pair].some((k) => laws.has(k));
    const top = deck[0];
    const btns = auctionOpen && open && top ? `
      <div class="m4c-btns">
        <button type="button" data-act="auction" data-pair="${pair}">Auction it</button>
        <button type="button" data-act="discard-auction" data-pair="${pair}">Discard, auction next</button>
        <button type="button" data-act="walk" data-pair="${pair}">Walk away</button>
      </div>` : '';
    return `<div class="m4c-deck ${open ? 'open' : 'closed'}">
      <div class="m4c-deck-head"><b>${CONTRACT_PAIR_NAMES[pair]}</b>
        <span>${deck.length} left</span>
        <span class="m4c-law">${open ? 'shares the Active Law' : 'no Active Law here'}</span></div>
      ${top ? cardThumb(top, 'blue') : '<div class="muted">empty</div>'}${btns}</div>`;
  }).join('');
  const auctionNote = auctionOpen
    ? 'Your Fundraise lets you auction one contract from a deck that shares an ideology with an Active Law.'
    : (tp ? 'Your timepiece is out: no contract auctions until this contract is fulfilled or repaid.'
      : 'A Fundraise ends by letting you auction one contract.');
  parts.push(`<h4>Contract decks</h4><p class="muted">${auctionNote}</p><div class="m4c-decks">${decks}</div>`);

  // Contracts in hand live in the Hand area (4B3h: a won contract is a Hand
  // Card), so the panel only points there; boosted and fulfilled ones are here.
  const inHand = (p.contractHand || []).length;
  const boosted = Object.keys(p.contractMeta || {}).filter((id) => !(p.contractHand || []).includes(id)).map((id) => {
    const meta = p.contractMeta[id];
    const f = faceOf(p, id);
    const where = locationOf(p, id) || 'in a stack';
    const next = f.steps[meta.progress ? meta.progress.done : 0];
    const late = tp && tp.contractId === id && tp.deadbeat;
    const stepLine = next ? `Next: ${esc(next.verb === 'manual' ? next.why : next.raw)}` : '';
    return `<div class="m4c-item">${cardThumb(id, meta.side)}
      <div class="m4c-note">${esc(where)} - step ${meta.progress ? meta.progress.done : 0} of ${f.steps.length}. ${stepLine}</div>
      <div class="m4c-btns">${myTurn ? `<button type="button" data-act="fulfill" data-id="${id}">Fulfill here</button>` : ''}
      ${myTurn && late ? `<button type="button" data-act="pay" data-id="${id}" data-max="${f.lateFee}">Pay late fee (${f.lateFee})</button>` : ''}
      ${myTurn && abandonBlock(s, p, id) === null ? `<button type="button" data-act="abandon" data-id="${id}">Abandon (Anarchy)</button>` : ''}</div></div>`;
  }).join('');
  const fulfilled = (p.fulfilledContracts || []).map((x) => `<div class="m4c-item">${cardThumb(x.id, x.side)}</div>`).join('');
  parts.push(`<h4>In hand</h4><p class="muted">${inHand
    ? `${inHand} contract${inHand === 1 ? '' : 's'} in your Hand (the Hand area below the map): boost, pay toward or abandon ${inHand === 1 ? 'it' : 'them'} there.`
    : 'none'}</p>`);
  parts.push(`<h4>Boosted</h4><div class="m4c-row">${boosted || '<span class="muted">none</span>'}</div>`);
  parts.push(`<h4>Fulfilled</h4><div class="m4c-row">${fulfilled || '<span class="muted">none yet</span>'}</div>`);
  if (s.m2) parts.push(augmentationsHtml(s, p, myTurn));

  el.innerHTML = `<div class="m4c-modal" role="dialog" aria-label="Contracts">
    <div class="m4c-head"><h3>📜 Contracts</h3><button type="button" class="m4c-close" aria-label="Close">✕</button></div>
    <div class="m4c-body">${parts.join('')}</div></div>`;
  el.querySelector('.m4c-close').addEventListener('click', closePanel);
  el.querySelectorAll('button[data-act]').forEach((b) => b.addEventListener('click', () => onAct(b)));
}

// ---- augmentations (4C) ------------------------------------------------------------
const SHAPES = ['heart', 'jar', 'hexagon', 'splat', 'battery', 'triangle'];
function portfolioOf(p) {
  const out = new Set();
  for (const f of (p.fulfilledContracts || [])) for (const c of ((contractFace(f.id, f.side) || {}).cybernetics || [])) out.add(c);
  return out;
}
const sideText = (shape, side) => ((AUGMENTS[shape] || {}).tip || '').split(' / ')[side - 1] || '';
function augmentationsHtml(s, p, myTurn) {
  const portfolio = portfolioOf(p);
  const aug = p.augments || {};
  const colName = (id) => (COLONISTS_BY_ID[id] || {}).name || id;
  const chips = SHAPES.map((sh) => {
    const a = aug[sh];
    const st = a ? `on ${esc(colName(a.colonistId))} (side ${a.side}: ${esc(sideText(sh, a.side))})`
      : (portfolio.has(sh) ? 'in your supply, ready to implant' : 'not in your portfolio');
    return `<div class="m4c-aug ${portfolio.has(sh) ? 'have' : 'lack'}">${augmentGlyph(sh, { size: 26 })}<span><b>${AUGMENTS[sh].name}</b> ${st}</span></div>`;
  }).join('');
  // The BEO Colony (4C2a) is, with Module 2, a Bernal anchored Dirtside: an
  // anchored Bernal that is not the Home Bernal (the engine decides; this is the hint).
  const beo = (p.bernals || []).filter((bn) => bn && bn.anchored).length >= 2;
  const bns = (p.bernals || []).map((bn, i) => ({ bn, i })).filter((x) => x.bn.anchored);
  let station = '<p class="muted">Implanting happens at your anchored Bernal, on the Colonists aboard it.</p>';
  if (bns.length) {
    const { bn, i } = bns[0];
    const cols = (bn.stack || []).filter((sl) => COLONISTS_BY_ID[sl.id]);
    const opts = [...portfolio].map((sh) => `<option value="${sh}">${AUGMENTS[sh].name}</option>`).join('');
    station = cols.length ? cols.map((sl) => {
      const mine = SHAPES.filter((sh) => aug[sh] && aug[sh].colonistId === sl.id).map((sh) => augmentGlyph(sh, { size: 22 })).join('');
      return `<div class="m4c-col"><b>${esc(colName(sl.id))}</b> <span class="muted">${esc((COLONISTS_BY_ID[sl.id] || {}).specialty || '')}</span> ${mine}
        ${myTurn && opts ? `<div class="m4c-controls"><select data-shape-for="${sl.id}">${opts}</select>
          <select data-side-for="${sl.id}"><option value="2">side 2</option><option value="1">side 1</option></select>
          <button type="button" data-act="implant" data-col="${sl.id}" data-bernal="${i}">Implant</button></div>` : ''}</div>`;
    }).join('') : '<p class="muted">No Colonists aboard your anchored Bernal.</p>';
  }
  return `<h4>Augmentations</h4>
    <p class="muted">Your portfolio is the cybernetics icons on your fulfilled contracts. Implant needs your anchored Bernal, a Colonist aboard it, and a Bernal anchored Dirtside (a BEO Colony)${beo ? '' : ' (you have none yet)'}. One chit of each shape.</p>
    <div class="m4c-augs">${chips}</div>${station}`;
}

async function onAct(b) {
  const act = b.dataset.act;
  const id = b.dataset.id;
  const pair = b.dataset.pair;
  if (act === 'auction') await D.submitTurnOp({ kind: 'AUCTION_CONTRACT_START', pair });
  else if (act === 'discard-auction') await D.submitTurnOp({ kind: 'AUCTION_CONTRACT_START', pair, discardTop: true });
  else if (act === 'walk') await D.submitTurnOp({ kind: 'AUCTION_CONTRACT_START', pair, abandon: true });
  else if (act === 'boost') await D.submitTurnOp({ kind: 'BOOST', cardIds: [id] });
  else if (act === 'fulfill') await D.submitTurnOp({ kind: 'FULFILL_CONTRACT', cardId: id });
  else if (act === 'implant') {
    const col = b.dataset.col;
    const panel = document.getElementById('m4-contracts-panel');
    const shape = panel.querySelector(`[data-shape-for="${col}"]`).value;
    const side = Number(panel.querySelector(`[data-side-for="${col}"]`).value);
    const p = me();
    const a = p && p.augments && p.augments[shape];
    // Juggling (4C4e): a chit already on another Colonist aboard comes off first.
    const remove = a && a.colonistId !== col ? [shape] : [];
    await D.submitTurnOp({ kind: 'IMPLANT', bernal: Number(b.dataset.bernal), remove, implants: [{ colonistId: col, shape, side }] });
  }
  else if (act === 'pay') await payContractFee(id);
  else if (act === 'abandon') await abandonContract(id);
  if (act === 'auction' || act === 'discard-auction') closePanel();
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
export function renderContractAuction(a) {
  let el = document.getElementById('m4-contract-auction');
  if (!a) { if (el) el.remove(); _yearsDraft = null; return; }
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
  const blocked = p && (p.timepiece ? 'Your timepiece is out: you cannot bid.'
    : (face.manned && s.defaultChit && s.defaultChit.profileId === myId ? 'The default chit bars you from manned contracts.' : null));
  const bids = Object.entries(a.bids || {}).map(([id, y]) => `<li><span class="player-name" style="--player-color:${esc((playerById(Number(id)) || {}).color || '')}">@${esc(nameOf(Number(id)))}</span> ${y} year${y === 1 ? '' : 's'}</li>`).join('');
  const waiting = (s.players || []).filter((q) => q.profileId !== a.auctioneerId && !(a.acted || []).includes(q.profileId)
    && !q.timepiece && !(face.manned && s.defaultChit && s.defaultChit.profileId === q.profileId));
  const settled = !waiting.length;
  if (_yearsDraft == null || _yearsDraft > a.low) _yearsDraft = Math.max(0, a.low - (iAmAuctioneer ? 0 : 1));
  const opts = Array.from({ length: a.low + 1 }, (_, y) => `<option value="${y}" ${y === _yearsDraft ? 'selected' : ''}>${y} year${y === 1 ? '' : 's'}</option>`).join('');
  let controls = '';
  if (blocked) controls = `<p class="muted">${blocked}</p>`;
  else {
    controls = `<label>Your bid <select id="m4c-years">${opts}</select></label>
      <button type="button" data-act="bid">Bid</button>
      ${iAmAuctioneer ? '' : '<button type="button" data-act="pass">Pass</button>'}`;
  }
  if (iAmAuctioneer) {
    controls += `<div class="m4c-btns"><button type="button" data-act="close" ${settled ? '' : 'disabled'}>Close the auction</button></div>`;
  }
  el.innerHTML = `<div class="m4c-modal" role="dialog" aria-label="Contract auction">
    <div class="m4c-head"><h3>📜 Contract auction</h3><span class="muted">${CONTRACT_PAIR_NAMES[a.pair] || ''}</span></div>
    <div class="m4c-auction-body">
      <div>${cardThumb(a.cardId, a.side || 'blue')}</div>
      <div class="m4c-side">
        <p>Bids are in <b>years</b> until the deadline, from ${CONTRACT_BID_MAX} down to 0. The <b>lowest</b> bid wins; ${esc(nameOf(a.auctioneerId))} wins ties.</p>
        <p class="m4c-low">Low bid: <b>${a.low} year${a.low === 1 ? '' : 's'}</b></p>
        <ul class="m4c-bids">${bids}</ul>
        <p class="muted">${settled ? `Waiting on ${esc(nameOf(a.auctioneerId))} to close.` : `Waiting on ${waiting.map((q) => '@' + esc(q.name)).join(', ')}.`}</p>
        <p class="muted">Winner: timepiece that many years ahead, ${face.advance} aqua advance${'' } (1 less if not the initiator).</p>
        <div class="m4c-controls">${controls}</div>
      </div></div></div>`;
  const sel = el.querySelector('#m4c-years');
  if (sel) sel.addEventListener('change', () => { _yearsDraft = Number(sel.value); });
  el.querySelectorAll('button[data-act]').forEach((b) => b.addEventListener('click', async () => {
    const act = b.dataset.act;
    if (act === 'bid') await D.submitAuctionOp({ kind: 'AUCTION_CONTRACT_BID', years: Number(sel.value) });
    else if (act === 'pass') await D.submitAuctionOp({ kind: 'AUCTION_CONTRACT_PASS' });
    else if (act === 'close') await D.submitAuctionOp({ kind: 'AUCTION_CONTRACT_CLOSE' });
  }));
}
