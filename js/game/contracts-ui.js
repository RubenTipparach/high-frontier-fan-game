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
import { renderContractCard, richText, setContractProgressSource, setContractReadySource, setContractDebtSource, fulfillButtonHtml } from './contract-card.js';
import { SITES_BY_ID } from '../../data/sites.js';
import { lagrangeLabel } from '../../data/lagrange-labels.js';
import { nodeLabelOf } from '../../data/map-labels.js';
import { augmentGlyph, AUGMENTS, timepieceDialGlyph } from './contract-glyphs.js';
import { sunspotDialSvg, setSunspotMarkerSource } from './turn-clock-ui.js';
import { isM4, isM2 } from './online-mode.js';
import { COLONISTS_BY_ID } from '../../data/colonists.js';
import { IDEOLOGY_ORDER, IDEOLOGY_BY_KEY, activeLaws, usesSoloAssembly, voteWinners } from '../../data/assembly.js';
import { CREW_BY_ID } from '../../data/crew.js';
import { augmentSideSvg } from './augment-sides.js';
import { BERNALS_BY_ID } from '../../data/bernals.js';
import { NODE_TAGS } from '../../data/node-tags.js';
import { PATENTS_BY_ID } from '../../data/patents.js';
import { starshipArtSvg } from './starship-chit.js';
import { EXODUS_BANDS, EXODUS_RANK_VP } from '../../data/exodus.js';
import { exodusBand, exodusThresholds, EXODUS_BAND_NAMES } from '../../data/exodus.js';

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
// Mishap Insurance (4B5a): one late fee per late contract, on any late turn
// while this turn's fee is unpaid. Free to use while the law is in force,
// otherwise lobbied with a Centrist delegate. Returns null, or { free }.
function mishapOption(id) {
  const s = snap(); const p = me();
  if (!s || !p || !D || !D.myTurn() || !s.m0) return null;
  const tp = p.timepiece;
  const meta = (p.contractMeta || {})[id] || {};
  if (!tp || tp.contractId !== id || !tp.deadbeat || meta.default || meta.insuranceUsed || meta.insuredTurn) return null;
  if (!p.turnStartedLate || (p.lateFeePaidThisTurn | 0) > 0) return null;
  if (lawKeys(s, null).has('centrist')) return { free: true };
  if (p.lobbiedThisTurn || !delegateIn(s, 'centrist', p.profileId)) return null;
  const ok = (p.aqua | 0) >= 1 || (usesSoloAssembly(s) && lawKeys(s, null).has('unity'));
  return ok ? { free: false } : null;
}
const mishapLobbyable = (id) => !!mishapOption(id);
const mishapBtn = (id) => (mishapOption(id) || {}).free
  ? `<button type="button" data-act="mishap" data-id="${id}" title="Mishap Insurance is the active law: the Pool pays this late fee (once per contract).">🛡 Use Mishap Insurance</button>`
  : `<button type="button" data-act="mishap" data-id="${id}" title="Pay 1 aqua and discard a Centrist delegate: the Pool pays this late fee (once per contract).">🛡 Lobby Mishap Insurance</button>`;

// ---- fulfill readiness ----------------------------------------------------------
// Which boosted contracts of mine would announce a step (or be fulfilled) where
// they stand now: asked of the rules engine as a dry run, once per board change
// on my turn, so the card can carry a Fulfill button and End turn can remind me.
let _ready = new Map();   // cardId -> { final }
let _readyKey = null;
setContractReadySource((id) => _ready.get(id) || null);
// What I can pay on my own late or defaulted contract right now: this turn's
// late fee still owed, capped by the debt left. 0 when nothing can be paid.
function payNow(s, q, id, f, left) {
  const p = me();
  if (!p || q.profileId !== p.profileId || !D || !D.myTurn() || !contractFeeDue(id)) return 0;
  // In default the late fee cap is gone: pay off what the aqua covers.
  if (((p.contractMeta || {})[id] || {}).default) return Math.max(0, Math.min(left, p.aqua | 0));
  return Math.max(0, Math.min(f.lateFee - (p.lateFeePaidThisTurn | 0), left));
}
// The repaid line on a contract card: shown once a contract is late, in
// default, or has anything paid on it (any player's, the table can see it).
setContractDebtSource((id) => {
  const s = snap();
  if (!s || !s.m4) return null;
  for (const q of (s.players || [])) {
    const meta = (q.contractMeta || {})[id];
    if (!meta) continue;
    const late = !!(q.timepiece && q.timepiece.contractId === id && q.timepiece.deadbeat);
    if (!late && !meta.default && !(meta.paid > 0)) return null;
    const f = contractFace(id, meta.side || 'blue');
    if (!f) return null;
    const debt = (f.advance | 0) * (meta.boosted ? 1 : 2);
    return { paid: meta.paid | 0, debt, pay: payNow(s, q, id, f, debt - (meta.paid | 0)) };
  }
  return null;
});
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
  const b = e.target.closest && e.target.closest('.m4-pay-btn');
  if (!b) return;
  e.preventDefault();
  e.stopPropagation();
  b.disabled = true;
  document.querySelectorAll('.card-modal-overlay .modal-x').forEach((x) => { try { x.click(); } catch { /* ignore */ } });
  payContractFee(b.dataset.pay).finally(() => { b.disabled = false; });
}, true);
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
// A late contract whose fee this turn is still unpaid (4B5): ending the turn
// now defaults it and hands over the default chit. Null when nothing is owed.
function lateFeeOwed(s, p) {
  const tp = p && p.timepiece;
  if (!s || !s.m4 || !tp || !tp.deadbeat || !p.turnStartedLate) return null;
  const meta = (p.contractMeta || {})[tp.contractId] || {};
  if (meta.default || meta.insuredTurn) return null;
  const f = faceOf(p, tp.contractId);
  if (!f) return null;
  const owed = f.lateFee - (p.lateFeePaidThisTurn | 0);
  return owed > 0 ? { id: tp.contractId, side: meta.side || 'blue', name: f.name, owed, chitVp: meta.side === 'gold' ? 6 : 3 } : null;
}
function lateFeeWarning(s, p, due) {
  return new Promise((resolve) => {
    document.getElementById('m4-late-warning')?.remove();
    const ov = document.createElement('div');
    ov.id = 'm4-late-warning';
    ov.className = 'm4c-overlay m4c-fulfilled m4c-endturn m4c-late';
    const canPay = (p.aqua | 0) >= due.owed;
    const held = s.defaultChit && s.defaultChit.profileId === p.profileId;
    ov.innerHTML = `<div class="m4c-modal" role="dialog" aria-modal="true" aria-label="Late fee due">
      <div class="m4c-head"><h3>⏰ Late fee due</h3><button type="button" class="m4c-close" aria-label="Close">✕</button></div>
      <div class="m4c-body m4c-endturn-body"><div class="m4c-endturn-item">${cardThumb(due.id, due.side)}
        <p class="m4c-late-text">Pay <b>${due.owed} aqua</b> or <b>${esc(due.name)}</b> defaults${held ? '' : ` and you take the default chit (<b>-${due.chitVp} VP</b>)`}.</p>
        <button type="button" class="m4c-ful-ok" data-late="pay" ${canPay ? '' : 'disabled'}>💸 Pay late fee (${due.owed})</button>
        ${mishapLobbyable(due.id) ? `<button type="button" class="m4c-ful-ok" data-late="mishap">🛡 ${mishapOption(due.id).free ? 'Use' : 'Lobby'} Mishap Insurance</button>` : ''}
      </div></div>
      <div class="m4c-endturn-foot"><button type="button" class="m4c-endturn-skip m4c-late-skip">End turn and default</button></div></div>`;
    const done = (v) => { ov.remove(); resolve(v); };
    ov.addEventListener('click', async (e) => {
      if (e.target === ov || e.target.closest('.m4c-close')) { done(false); return; }
      if (e.target.closest('.m4c-late-skip')) { done(true); return; }
      const b = e.target.closest('[data-late]');
      if (!b || b.disabled) return;
      done(false);
      if (b.dataset.late === 'pay') await payContractFee(due.id);
      else await D.submitTurnOp({ kind: 'LOBBY', ideology: 'centrist' });
    });
    ov.querySelectorAll('.m4-fulfill-btn').forEach((x) => x.remove());
    document.body.appendChild(ov);
  });
}

export async function contractsBeforeEndTurn() {
  const s = snap(); const p = me();
  if (!s || !s.m4 || !p || !D) return true;
  // First the late fee: an unpaid one defaults the contract at the end of turn.
  const due = lateFeeOwed(s, p);
  if (due && !(await lateFeeWarning(s, p, due))) return false;
  if (!D.dryRun) return true;
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
  // The open timepiece window redraws with the board (a payment moves its
  // Repaid line); a contract that is gone (paid off, fulfilled) closes it.
  const where = document.getElementById('m4-contract-where');
  if (where) {
    const p = me(); const id = where.dataset.cid;
    if (p && id && (p.contractMeta || {})[id]) showContractWhere(id); else where.remove();
  }
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
// The Sunspot Cycle window shows every contract timepiece on its dial (M4 only).
setSunspotMarkerSource(() => { const s = snap(); return s && s.m4 ? timepieceMarkers(s, null) : []; });


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
  ov.dataset.cid = id;
  ov.innerHTML = `<div class="m4c-modal m4c-where" role="dialog" aria-label="Contract">
    <div class="m4c-head"><h3>⏱ ${esc((faceOf(p, id) || {}).name || '')}</h3><button type="button" class="m4c-close" aria-label="Close">✕</button></div>
    <div class="m4c-where-body">${cardThumb(id, meta.side)}<div class="m4c-where-loc">📍 ${esc(locationOf(p, id) || 'In a stack')}</div>
      ${mishapLobbyable(id) ? `<div class="m4c-btns">${mishapBtn(id)}</div>` : ''}</div></div>`;
  const close = () => ov.remove();
  ov.querySelector('[data-act="mishap"]')?.addEventListener('click', async () => {
    close();
    await D.submitTurnOp({ kind: 'LOBBY', ideology: 'centrist' });
  });
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.querySelector('.m4c-close').addEventListener('click', close);
  document.body.appendChild(ov);
}

let _tab = null;        // 'market' | 'yours'
// May the viewer start a contract auction now (the end of their Fundraise)?
// Why a fundraised player may not start the contract auction, or ''.
function auctionBar(s, p) {
  if (!s || !p || !D.myTurn() || !p.fundraisedThisTurn || p.contractAuctionDone || s.auction) return '';
  if (s.anarchy || s.war) return `No contract auctions during ${s.war ? 'War' : 'Anarchy'}.`;
  if (p.timepiece) return 'Your timepiece is on the Sunspot Cycle.';
  return '';
}
function canAuctionNow(s, p, myTurn) {
  return !!(s && p && myTurn && p.fundraisedThisTurn && !p.contractAuctionDone && !p.timepiece && !s.auction
    && !s.anarchy && !s.war);
}
// The three pair decks, top card up. A deck you may auction carries one
// Auction button; one you may not is greyed out with none (owner 2026-11-18).
function decksHtml(s, p, auctionOpen) {
  const laws = lawKeys(s, p);
  // The Exodus deck joins once the isobank is founded (4D2c), open to everyone.
  const pairs = [...Object.keys(CONTRACT_PAIRS), ...(s.isobank && (s.contractDecks || {}).EX ? ['EX'] : [])];
  return `<div class="m4c-decks">${pairs.map((pair) => {
    const deck = (s.contractDecks || {})[pair] || [];
    const exodus = pair === 'EX';
    const byLaw = exodus || CONTRACT_PAIRS[pair].some((k) => laws.has(k));
    const byConnections = !byLaw && hasContractAbility(p, 'connections')
      && CONTRACT_PAIRS[pair].some((k) => delegateIn(s, k, p.profileId));
    const top = deck[0];
    const open = (byLaw || byConnections) && !!top;
    // The default-chit holder may not put a manned contract up (4B2d).
    const exSide = exodus && top ? 'exodus' : null;
    const topFace = top ? contractFace(top, exSide || (s.contractSide === 'gold' ? 'gold' : 'blue')) : null;
    const stigma = !!(topFace && topFace.manned && s.defaultChit && s.defaultChit.profileId === p.profileId);
    const btn = auctionOpen && open
      ? `<div class="m4c-btns"><button type="button" data-act="auction" data-pair="${pair}" ${stigma ? 'disabled title="Default chit: no manned contracts."' : ''}>Auction</button></div>` : '';
    return `<div class="m4c-deck ${open ? 'open' : 'closed'}" ${open ? '' : 'aria-disabled="true"'}>
      <div class="m4c-deck-head"><b>${CONTRACT_PAIR_NAMES[pair]}</b>
        <span>${deck.length} left</span>
        <span class="m4c-law">${exodus ? '' : byLaw ? 'Active Law' : byConnections ? 'Connections' : ''}</span></div>
      ${top ? cardThumb(top, exSide || (s.contractSide === 'gold' ? 'gold' : 'blue')) : '<div class="muted">empty</div>'}${btn}</div>`;
  }).join('')}</div>`;
}
// The contract auction step of a Fundraise (owner 2026-11-18: the auction is
// part of the Fundraise). The Fundraise window renders it into `host` once the
// Fundraise lands; `done` closes the window (picking nothing skips the auction).
export function canStartContractAuction() { return canAuctionNow(snap(), me(), D && D.myTurn()); }
export function renderContractAuctionStep(host, done) {
  const s = snap(); const p = me();
  host.innerHTML = '';
  if (!canAuctionNow(s, p, D.myTurn())) {
    // Fundraised, auction not yet held, but barred: say why (4B3b) instead
    // of the step silently not appearing.
    const why = auctionBar(s, p);
    if (!why) return false;
    const wrap = document.createElement('div');
    wrap.className = 'm4c-fr-step';
    wrap.innerHTML = `<h4>📜 Contract auction</h4><p class="m4c-bar">${why}</p>
      <div class="m4c-btns m4c-fr-skip"><button type="button" data-again>Check again</button><button type="button" data-skip>No auction</button></div>`;
    wrap.querySelector('[data-again]').addEventListener('click', () => renderContractAuctionStep(host, done));
    wrap.querySelector('[data-skip]').addEventListener('click', done);
    host.appendChild(wrap);
    return true;
  }
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
      ${myTurn && contractFeeDue(id) ? `<button type="button" data-act="pay" data-id="${id}" data-max="${f.lateFee}">${late ? `Pay late fee (${f.lateFee})` : 'Pay off debt'}</button>` : ''}
      ${mishapLobbyable(id) ? mishapBtn(id) : ''}
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
        <button type="button" role="tab" data-tab="bank" class="${tab === 'bank' ? 'sel' : ''}">Bank</button>
      </div>
      <button type="button" class="m4c-close" aria-label="Close">✕</button></div>
    <div class="m4c-body">${(tab === 'market' ? market : tab === 'bank' ? [bankHtml(s, p, myTurn)] : parts).join('')}</div></div>`;
  el.querySelector('.m4c-close').addEventListener('click', closePanel);
  el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { _tab = b.dataset.tab; renderPanel(); }));
  el.querySelectorAll('button[data-act]').forEach((b) => b.addEventListener('click', () => onAct(b)));
}

// ---- the Bank, isotopes and the isobank (3B5, 4D1, 4D2, 4E3) ------------------------
// Your Bank: where your aqua and gold beads are (LEO, or your Home Bernal). Beads
// are worth 10 aqua and pay like aqua once isotope is monetized. The isobank (a
// BEO Bernal) holds every player's isovault; the isototal sets the starshot band.
export function openBankTab() { _tab = 'bank'; _panelOpen = true; renderPanel(); }
// Your Bank is at your Home Bernal once one is anchored, else LEO (4A7a). Mirrors
// the game's Home Bernal test (the GEO Elevator at GEO, or a home-orbit space; a
// Sirens game records the answer on the unit).
function isHomeUnit(bn) {
  if (!bn || !bn.anchored) return false;
  if (typeof bn.home === 'boolean') return bn.home;
  if (bn.cardId === 'ber_geo_elevator_bernal' && bn.siteId === 'burn-geo') return true;
  return !!(bn.siteId && NODE_TAGS[String(bn.siteId)] && NODE_TAGS[String(bn.siteId)].homeBernal);
}
// Is the rocket at the Bank (LEO, or docked at the Home Bernal)?
function atBank(p) {
  const r = p.rocket || {};
  if (r.siteId == null) return true;
  const home = (p.bernals || []).find(isHomeUnit);
  return !!(home && home.siteId === r.siteId);
}
function bankWhere(p) {
  const home = (p.bernals || []).find(isHomeUnit);
  return home ? `${(BERNALS_BY_ID[home.cardId] || {}).name || 'Home Bernal'}` : 'LEO';
}
// ---- the Isobank / Starship placard (Module 4), drawn after the printed one ----
// Isovaults: a hexagon of six triangles, one per player colour, around the
// Speculator's isovault (buy / sell at 10 aqua, 4D1d). Beside it the Exodus
// contracts slot, the Exodus starship phases, the Exodus Fueling Table (4E3) and
// the starship stack (4D3).
const HEX_ORDER = [[4, 5], [5, 0], [0, 1], [1, 2], [2, 3], [3, 4]];   // top, then clockwise
function hexVaultsSvg(s) {
  const C = [150, 132], R = 128, r = 50;
  const v = (k, rad = R) => [C[0] + rad * Math.cos((Math.PI / 3) * k), C[1] + rad * Math.sin((Math.PI / 3) * k)];
  const pt = (q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`;
  const players = s.players || [];
  let tris = '';
  HEX_ORDER.forEach(([a, b], i) => {
    const q = players[i];
    const col = q ? (q.color || '#9aa4b8') : null;
    const A = v(a), B = v(b);
    tris += `<polygon points="${pt(C)} ${pt(A)} ${pt(B)}" fill="${col || '#2a2e3a'}" fill-opacity="${col ? 0.34 : 0.3}" stroke="${col || '#4a5060'}" stroke-width="5" stroke-linejoin="round"/>`;
    if (q) {
      const m = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
      const at = [C[0] + 0.7 * (m[0] - C[0]), C[1] + 0.7 * (m[1] - C[1])];
      const n = Math.max(0, q.isovault | 0);
      tris += `<g transform="translate(${pt(at)})"><circle r="15" fill="url(#ib-bead)"/><text y="5.5" text-anchor="middle" font-size="15" font-weight="800" fill="#3a2600">${n}</text>`
        + `<text y="${a === 4 ? -21 : 29}" text-anchor="middle" font-size="10" fill="#eef" >${esc(q.name)}</text></g>`;
    }
  });
  const inner = Array.from({ length: 6 }, (_, k) => pt(v(k, r))).join(' ');
  const market = Math.max(0, s.earthMarket | 0);
  return `<svg class="m4p-hex" viewBox="0 0 300 264" role="img" aria-label="Isovaults">
    <defs><radialGradient id="ib-bead" cx="35%" cy="30%" r="70%"><stop offset="0%" stop-color="#fff4c0"/><stop offset="60%" stop-color="#ffd24a"/><stop offset="100%" stop-color="#b8860b"/></radialGradient></defs>
    <g opacity=".6" transform="translate(150 134) scale(2.75) translate(-50 -50)">${starshipArtSvg()}</g>
    ${tris}
    <polygon points="${inner}" fill="#15171e" fill-opacity=".72" stroke="#2c303a" stroke-width="3"/>
    <text x="150" y="118" text-anchor="middle" font-size="9.5" font-weight="800" fill="#fff" letter-spacing=".5">SPECULATOR'S</text>
    <text x="150" y="130" text-anchor="middle" font-size="9.5" font-weight="800" fill="#fff" letter-spacing=".5">ISOVAULT</text>
    <circle cx="150" cy="150" r="12" fill="url(#ib-bead)"/><text x="150" y="155" text-anchor="middle" font-size="13" font-weight="800" fill="#3a2600">${market}</text>
  </svg>`;
}
// The stacks standing at the isobank: TW thrusters (Promoted GW thrusters) and
// augmented Colonists, for the starship stack box.
function atIsobank(s) {
  const ib = s.isobank;
  const tws = [], cols = [];
  if (!ib) return { tws, cols };
  for (const q of (s.players || [])) {
    const stacks = [];
    if (q.rocket && q.rocket.siteId === ib.siteId) stacks.push(q.rocket.stack || []);
    for (const b of (q.bernals || [])) if (b && b.siteId === ib.siteId) stacks.push(b.stack || []);
    if (q.freighter && q.freighter.siteId === ib.siteId) stacks.push(q.freighter.stack || []);
    for (const o of Object.values(q.outposts || {})) if (o && o.siteId === ib.siteId) stacks.push(o.cards || []);
    const augOn = new Set(Object.values(q.augments || {}).map((a) => a && (a.colonistId || a.crewId)).filter(Boolean).map(String));
    for (const st of stacks) for (const sl of st) {
      const card = sl && PATENTS_BY_ID[sl.id];
      if (card && card.type === 'gw-thruster' && sl.face === 'secondary') tws.push({ q, name: ((card.faces || {}).secondary || {}).name || card.name });
      if (sl && augOn.has(String(sl.id))) cols.push({ q, name: (COLONISTS_BY_ID[sl.id] || CREW_BY_ID[sl.id] || {}).name || sl.id });
    }
  }
  return { tws, cols };
}
// 4D3b, mirror of the engine's starshipCommanderOf: among players with a
// completed Exodus contract, the most isofuel (the isobanker breaks ties).
function starshipCommander(s) {
  const ok = (s.players || []).filter((q) => (q.fulfilledContracts || []).some((f) => f && (f.side === 'exodus' || (CONTRACTS_BY_ID[f.id] || {}).exodus)));
  if (!ok.length) return null;
  const max = Math.max(...ok.map((q) => q.isovault | 0));
  const top = ok.filter((q) => (q.isovault | 0) === max);
  return top.find((q) => s.isobank && q.profileId === s.isobank.ownerId) || top[0];
}
// My augmented Colonists standing at a place.
function myAugmentedColonistsAt(p, place) {
  const aug = new Set(Object.values(p.augments || {}).map((a) => a && a.colonistId).filter(Boolean).map(String));
  const out = [];
  const scan = (slots, at) => { if (at != null && String(at) === String(place)) for (const sl of (slots || [])) if (sl && aug.has(String(sl.id))) out.push(sl.id); };
  scan(p.rocket && p.rocket.stack, p.rocket && p.rocket.siteId);
  for (const o of Object.values(p.outposts || {})) if (o) scan(o.cards, o.siteId);
  if (p.freighter) scan(p.freighter.stack, p.freighter.siteId);
  for (const bn of (p.bernals || [])) if (bn) scan(bn.stack, bn.siteId);
  return out;
}
function starshipBoxHtml(s, p, myTurn, { req, aboard, band }) {
  const sh = s.starship;
  const btn = (act, label, ok, extra = '') => `<button type="button" data-act="${act}"${extra}${ok ? '' : ' disabled'}>${label}</button>`;
  if (!sh) {
    const cmd = starshipCommander(s);
    const mine = cmd && cmd.profileId === p.profileId;
    const crew = s.isobank ? myAugmentedColonistsAt(p, s.isobank.siteId) : [];
    const who = cmd ? `<div class="m4p-aboard">Commander: <span class="player-name" style="--player-color:${esc(cmd.color || 'currentColor')}">@${esc(cmd.name)}</span></div>` : '';
    return `<ul class="m4p-req">${req}</ul>${aboard.length ? `<div class="m4p-aboard">${aboard.join('<br>')}</div>` : ''}${who}
      ${mine ? `<div class="m4c-controls">${btn('ship-launch', '🚀 Launch', myTurn && crew.length > 0 && band !== 'none', ` data-colonist="${esc(crew[0] || '')}"`)}</div>` : ''}`;
  }
  const cmdP = (s.players || []).find((q) => q.profileId === sh.commanderId) || {};
  const state = sh.destroyed ? 'Destroyed' : sh.exited ? 'Left the map' : sh.jsjTurns != null ? `Solar oberth (${sh.jsjTurns})` : esc(spaceName(sh.siteId));
  const cards = (sh.cards || []).map((c) => esc((PATENTS_BY_ID[c.slot.id] || COLONISTS_BY_ID[c.slot.id] || {}).name || c.slot.id));
  const flying = !sh.exited && !sh.destroyed;
  const imCmd = sh.commanderId === p.profileId;
  const crew = flying ? myAugmentedColonistsAt(p, sh.siteId) : [];
  const canBoard = flying && !(sh.passengers || {})[p.profileId] && crew.length > 0;
  return `<div class="m4p-aboard"><b>${state}</b> · <span class="player-name" style="--player-color:${esc(cmdP.color || 'currentColor')}">@${esc(cmdP.name || '?')}</span></div>
    <div class="m4p-aboard">${cards.join(', ')}</div>
    <div class="m4c-controls">
      ${imCmd && flying && sh.jsjTurns == null ? btn('ship-fly', '🚀 Fly', myTurn) : ''}
      ${canBoard ? btn('ship-board', 'Board', myTurn, ` data-colonist="${esc(crew[0])}"`) : ''}
    </div>`;
}
function isobankPlacardHtml(s, p, myTurn, tankIso) {
  const ib = s.isobank;
  const n = Math.max(1, Math.min(6, (s.players || []).length));
  const total = (s.players || []).reduce((t, q) => t + Math.max(0, q.isovault | 0), 0);
  const band = exodusBand(total, n);
  const market = Math.max(0, s.earthMarket | 0);
  const beads = Math.max(0, p.isotopes | 0);
  const isos = p.isostandards || [];
  const btn = (act, label, ok, tip) => `<button type="button" data-act="${act}"${ok ? '' : ' disabled'}${tip ? ` data-tip="${esc(tip)}"` : ''}>${label}</button>`;
  const tick = (on) => `<span class="m4p-tick ${on ? 'on' : ''}">${on ? '✓' : ''}</span>`;
  // Exodus starship phases, as printed; each lights once reached.
  const beo = (s.players || []).some((q) => (q.bernals || []).some((b) => b && b.anchored && !isHomeUnit(b)));
  const exodusDone = (s.players || []).some((q) => (q.fulfilledContracts || []).some((f) => f && (f.side === 'exodus' || (CONTRACTS_BY_ID[f.id] || {}).exodus)));
  const phases = [
    [beo, 'Anchored Bernal &amp; BEO Colony', 'May implant; may join spacer union.'],
    [!!s.isotopeMonetized, '1st Isotope produced', 'Isotope monetization; gold-side contracts.'],
    [!!ib, '1st Anchored Bernal with isostandard Dirtside', 'Must found isobank &amp; activate <i>Exodus</i> contracts.'],
    [!!s.starship, '<i>Exodus</i> contract fulfilled &amp; most Isotope at isobank', 'Starship launch (4D3); remove all but 1 Seniority Disk.'],
  ].map(([on, a, b]) => `<div class="m4p-phase ${on ? 'on' : ''}">${tick(on)}<b>${a}</b><span>${b}</span></div>`).join('');
  // Exodus contracts slot.
  const ex = (s.contractDecks || {}).EX;
  const exBox = ib && ex
    ? `<div class="m4p-ex-count">${ex.length} left</div>${ex[0] ? cardThumb(ex[0], 'exodus') : '<div class="muted">empty</div>'}`
    : `<div class="m4p-locked">🔒</div><p class="m4p-small"><b>Inactive until isobank founded (4D2).</b></p>`;
  // Fueling table, the player-count column and the current band lit.
  const rows = [['max', 2], ['crisis', 1], ['reckless', 0], ['none', -1]];
  const cell = (k, i) => {
    const t = EXODUS_BANDS[k];
    if (i === 2) return `${t[2]}+`;
    if (i === 1) return `${t[1]} - ${t[2] - 1}`;
    if (i === 0) return `${t[0]} - ${t[1] - 1}`;
    return `0 - ${t[0] - 1}`;
  };
  const table = `<table class="m4p-fuel"><tbody>${rows.map(([b, i]) => `<tr class="${b === band ? 'now' : ''}"><th>${EXODUS_BAND_NAMES[b]}</th><td>${cell(n, i)}</td><td>${b === 'none' ? '-' : `${EXODUS_RANK_VP[b].join(' / ')} VP`}</td></tr>`).join('')}</tbody></table>`;
  // Starship stack.
  const { tws, cols } = atIsobank(s);
  const req = [
    [tws.length > 0, 'Operational TW thruster'],
    [band !== 'none', `Isototal ${total} (Reckless ${EXODUS_BANDS[n][0]}+)`],
    [exodusDone, '1 completed <i>Exodus</i> contract'],
    [cols.length > 0, 'Augmented Colonist'],
  ].map(([on, t]) => `<li class="${on ? 'on' : ''}">${tick(on)}${t}</li>`).join('');
  const aboard = [...tws.map((x) => `🚀 ${esc(x.name)} <span class="player-name" style="--player-color:${esc(x.q.color || 'currentColor')}">@${esc(x.q.name)}</span>`),
    ...cols.map((x) => `👩‍🚀 ${esc(x.name)} <span class="player-name" style="--player-color:${esc(x.q.color || 'currentColor')}">@${esc(x.q.name)}</span>`)];
  const r = p.rocket || {};
  const atIb = ib && r.siteId && r.siteId === ib.siteId;
  const banker = ib ? (playerById(ib.ownerId) || {}) : null;
  return `<div class="m4p">
    <div class="m4p-title">ISOBANK/STARSHIP <small>(MODULE 4)</small>${ib ? `<div class="m4p-where">${esc((BERNALS_BY_ID[ib.bernalId] || {}).name || 'Bernal')} · ${esc(spaceName(ib.siteId))} · <span class="player-name" style="--player-color:${esc(banker.color || 'currentColor')}">@${esc(banker.name || '?')}</span></div>` : ''}</div>
    <div class="m4p-ex"><h5>EXODUS<br>CONTRACTS</h5>${exBox}</div>
    <div class="m4p-vaults"><h5>ISOVAULTS</h5>${hexVaultsSvg(s)}
      <div class="m4c-controls m4p-spec">
        ${btn('iso-trade-sell', 'Deposit', myTurn && beads > 0)}
        ${btn('iso-trade-buy', 'Withdraw', myTurn && market > 0 && (p.aqua | 0) >= ((s.isotopeRate | 0) || 10) && isos.length > 0, isos.length ? '' : 'Needs an isostandard')}
        ${atIb && tankIso > 0 ? btn('iso-vault', `Store ${tankIso} in your isovault`, myTurn) : ''}
      </div></div>
    <div class="m4p-phases"><h5>EXODUS STARSHIP PHASES</h5>${phases}</div>
    <div class="m4p-table"><h5>EXODUS FUELING TABLE (4E3) <small>${n} Player${n > 1 ? 's' : ''}</small></h5>${table}<div class="m4p-total">Isototal <b>${total}</b> · ${EXODUS_BAND_NAMES[band]}</div></div>
    <div class="m4p-ship"><h5>STARSHIP STACK</h5>${starshipBoxHtml(s, p, myTurn, { req, aboard, band, tws, cols })}</div>
  </div>`;
}

// The Speculator's isovault trade (4D1d): Deposit sells gold beads into it,
// Withdraw buys them out, 10 aqua each. A stepper like the water transfer one,
// with the Bank aqua before and after. Resolves to the count, or null.
function pickIsoTrade(action) {
  const s = snap(), p = me();
  if (!s || !p) return Promise.resolve(null);
  const aqua = p.aqua | 0, beads = Math.max(0, p.isotopes | 0), market = Math.max(0, s.earthMarket | 0);
  const sell = action === 'sell';
  const rate = (s.isotopeRate | 0) || 10;   // Isotope Cartel: 12
  const max = sell ? beads : Math.min(market, Math.floor(aqua / rate));
  if (max < 1) return Promise.resolve(null);
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.className = 'card-modal-overlay confirm-modal-overlay m4-iso-trade';
    let n = 1;
    const close = (v) => { ov.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); else if (e.key === 'Enter') close(n); };
    document.addEventListener('keydown', onKey);
    const step = (d) => `<button type="button" class="popup-btn popup-btn-secondary fa-step" data-step="${d}">${d > 0 ? '+' : '−'}${Math.abs(d)}</button>`;
    ov.innerHTML = `<div class="turn-confirm-panel">
      <h3>${sell ? '🟡 Deposit in the Speculator\'s isovault' : '🟡 Withdraw from the Speculator\'s isovault'}</h3>
      <div class="dump-stepper">${step(-10)}${step(-5)}${step(-1)}
        <input type="number" class="fa-amount" min="1" max="${max}" value="1" inputmode="numeric" aria-label="Isotopes" />
        ${step(1)}${step(5)}${step(10)}
        <button type="button" class="popup-btn fa-all">Max (${max})</button></div>
      <div class="m4-iso-ledger"></div>
      <div class="turn-confirm-actions">
        <button type="button" class="popup-btn primary" data-act="yes"></button>
        <button type="button" class="popup-btn" data-act="no">Cancel</button></div></div>`;
    const input = ov.querySelector('.fa-amount'), ledger = ov.querySelector('.m4-iso-ledger'), yes = ov.querySelector('[data-act="yes"]');
    const set = (v) => {
      n = Math.max(1, Math.min(max, Math.round(Number(v)) || 1));
      input.value = String(n);
      const dA = sell ? n * rate : -n * rate;
      ledger.innerHTML = `<div><span>💧 Bank aqua</span><b>${aqua} -&gt; ${aqua + dA}</b><em class="${dA > 0 ? 'up' : 'down'}">${dA > 0 ? '+' : ''}${dA}</em></div>`
        + `<div><span>🟡 Gold beads</span><b>${beads} -&gt; ${beads + (sell ? -n : n)}</b></div>`
        + `<div><span>Speculator's isovault</span><b>${market} -&gt; ${market + (sell ? n : -n)}</b></div>`;
      yes.textContent = sell ? `Deposit ${n} (+${n * rate} aqua)` : `Withdraw ${n} (−${n * rate} aqua)`;
    };
    ov.querySelectorAll('.fa-step').forEach((b) => b.addEventListener('click', () => set(n + Number(b.dataset.step))));
    ov.querySelector('.fa-all').addEventListener('click', () => set(max));
    input.addEventListener('input', () => set(input.value));
    yes.addEventListener('click', () => close(n));
    ov.querySelector('[data-act="no"]').addEventListener('click', () => close(null));
    ov.addEventListener('click', (e) => { if (e.target === ov) close(null); });
    set(1);
    document.body.appendChild(ov);
  });
}

function bankHtml(s, p, myTurn) {
  const beads = Math.max(0, p.isotopes | 0);
  const market = Math.max(0, s.earthMarket | 0);
  const r = p.rocket || {};
  const tankIso = (r.tankGrade === 'isotope') ? Math.floor(Number(r.tank) || 0) : 0;
  const isos = p.isostandards || [];
  const btn = (act, label, ok, tip) => `<button type="button" data-act="${act}"${ok ? '' : ' disabled'}${tip ? ` data-tip="${esc(tip)}"` : ''}>${label}</button>`;
  const ib = s.isobank;
  const out = [];
  out.push(`<div class="m4b-grid">
    <div class="m4b-stat"><span>🏦 Bank</span><b>${esc(bankWhere(p))}</b></div>
    <div class="m4b-stat"><span>💧 Aqua</span><b>${p.aqua | 0}</b></div>
    <div class="m4b-stat"><span>🟡 Gold beads</span><b>${beads}</b><small>${beads * ((s.isotopeRate | 0) || 10)} aqua</small></div>
    <div class="m4b-stat"><span>Isostandard</span><b>${isos.length ? isos.map((x) => esc(x)).join(' ') : 'none'}</b></div>
    <div class="m4b-stat"><span>FINAO</span><b>${s.isotopeMonetized ? '×2' : '×1'}</b><small>${s.isotopeMonetized ? 'monetized' : 'not monetized'}</small></div>
  </div>
  <div class="m4c-controls">
    ${btn('iso-withdraw', 'Withdraw 1 as fuel', myTurn && beads > 0 && isos.length > 0, isos.length ? '' : 'Needs an isostandard')}
    ${tankIso > 0 && atBank(p) ? btn('iso-tank', `Tank to Bank (${tankIso})`, myTurn) : ''}
  </div>`);
  out.push(isobankPlacardHtml(s, p, myTurn, tankIso));
  return out.join('');
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
    <div class="m4c-augs">${chips}</div>${station}${childHtml(s, p, myTurn)}`;
}
// Parenthood (4C5): the child chit sits on the Sunspot Cycle 9 years on. Once it
// is passed, pick an earthborn Human from the queue to take the parent's place.
function childHtml(s, p, myTurn) {
  const c = p.childChit;
  if (!c) return '';
  const parent = (COLONISTS_BY_ID[c.parentId] || {}).name || c.parentId;
  if (!c.grown) {
    const left = Math.max(0, (c.due | 0) - (s.clockTicks | 0));
    return `<div class="m4c-child">${augmentGlyph('heart', { size: 22 })} <b>${esc(parent)}</b>'s child: ${left} year${left === 1 ? '' : 's'} to go</div>`;
  }
  const picks = (s.colonistQueue || []).filter((id) => {
    const col = COLONISTS_BY_ID[id] || {};
    return col.colonistKind === 'Human' && !col.spaceborn;
  });
  const opts = picks.map((id) => `<option value="${esc(id)}">${esc(COLONISTS_BY_ID[id].name)}</option>`).join('');
  return `<div class="m4c-child grown">${augmentGlyph('heart', { size: 22 })} <b>${esc(parent)}</b>'s child comes of age
    ${myTurn && opts ? `<div class="m4c-controls"><select data-child-pick>${opts}</select>
      <button type="button" class="primary" data-act="child">Take the parent's place</button></div>` : ''}</div>`;
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
  else if (act === 'child') {
    const v = document.querySelector('#m4-contracts-panel [data-child-pick]');
    if (v && v.value) await D.submitTurnOp({ kind: 'CHILD_COMES_OF_AGE', colonistId: v.value });
  }
  else if (act === 'augment') { openAugmentWizard(b.dataset.shape); return; }
  else if (act === 'chit-view') { openChitSides(b.dataset.shape); return; }
  else if (act === 'iso-trade-sell' || act === 'iso-trade-buy') {
    const action = act === 'iso-trade-sell' ? 'sell' : 'buy';
    const amount = await pickIsoTrade(action);
    if (amount) await D.submitTurnOp({ kind: 'ISOTOPE_EXCHANGE', action, amount });
  }
  else if (act === 'iso-tank') await D.submitTurnOp({ kind: 'ISOTOPE_EXCHANGE', action: 'deposit' });
  else if (act === 'iso-withdraw') await D.submitTurnOp({ kind: 'ISOTOPE_EXCHANGE', action: 'withdraw', amount: 1 });
  else if (act === 'iso-vault') await D.submitTurnOp({ kind: 'ISOTOPE_EXCHANGE', action: 'vault' });
  else if (act === 'ship-launch') await D.submitTurnOp({ kind: 'STARSHIP_LAUNCH', colonists: [b.dataset.colonist] });
  else if (act === 'ship-board') await D.submitTurnOp({ kind: 'STARSHIP_BOARD', colonistId: b.dataset.colonist });
  else if (act === 'ship-fly') { closePanel(); if (D.planStarship) D.planStarship(); }
  else if (act === 'pay') await payContractFee(id);
  else if (act === 'mishap') await D.submitTurnOp({ kind: 'LOBBY', ideology: 'centrist' });
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
  // Life Support Reconfig Team: you may swap your two Bernal cards.
  if (f && last && f.onFulfill && f.onFulfill.bernalSwap && (p.bernals || []).filter(Boolean).length >= 2) {
    const names = (p.bernals || []).filter(Boolean).slice(0, 2).map((b) => (BERNALS_BY_ID[b.cardId] || {}).name || 'Bernal');
    const swap = await askSwapBernals(f.name, names);
    if (swap === undefined) return;
    await D.submitTurnOp({ kind: 'FULFILL_CONTRACT', cardId: id, ...(swap ? { swapBernals: true } : {}) });
    return;
  }
  await D.submitTurnOp({ kind: 'FULFILL_CONTRACT', cardId: id });
}
// One Ideology for 2 delegates, or none. Resolves the key, null (none) or
// undefined (cancelled).
// Life Support Reconfig Team: swap the two Bernal cards? true / false, or
// undefined when cancelled.
function askSwapBernals(title, names) {
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.className = 'card-modal-overlay confirm-modal-overlay';
    ov.innerHTML = `<div class="turn-confirm-panel" role="dialog" aria-label="${esc(title)}">
      <h3>${esc(title)}</h3><p>Swap ${esc(names[0])} and ${esc(names[1])}?</p>
      <div class="turn-confirm-actions"><button type="button" class="popup-btn primary" data-v="1">Swap</button><button type="button" class="popup-btn" data-v="0">Keep</button><button type="button" class="popup-btn" data-cancel>Cancel</button></div>
    </div>`;
    const done = (v) => { ov.remove(); resolve(v); };
    ov.addEventListener('click', (e) => {
      if (e.target === ov) return done(undefined);
      const b = e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-cancel')) return done(undefined);
      done(b.dataset.v === '1');
    });
    document.body.appendChild(ov);
  });
}
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
// Aqua plus gold beads at the Bank once monetized (4D1b), mirror of the
// engine's bankFunds.
function bankAqua(p) {
  const s = snap();
  const beads = (s && s.m4 && s.isotopeMonetized) ? Math.max(0, p.isotopes | 0) * ((s.isotopeRate | 0) || 10) : 0;
  return (p.aqua | 0) + beads;
}
export async function payContractFee(id) {
  const p = me();
  const f = p && faceOf(p, id);
  if (!f) return;
  const meta = (p.contractMeta || {})[id] || {};
  const left = (f.advance | 0) * (meta.boosted ? 1 : 2) - (meta.paid | 0);
  if (left <= 0) return;
  // In default: no per-turn cap, pay off as much as the aqua covers.
  if (meta.default) {
    const amt = Math.min(left, bankAqua(p));
    if (amt <= 0) { D.toast('No aqua to pay with.', 'info'); return; }
    await D.submitTurnOp({ kind: 'PAY_LATE_FEE', cardId: id, amount: amt });
    return;
  }
  const owedTurn = f.lateFee - ((p.lateFeePaidThisTurn) | 0);
  if (owedTurn <= 0) { D.toast('You have paid this turn\'s late fee.', 'info'); return; }
  const cap = Math.max(1, Math.min(owedTurn, left));
  await D.submitTurnOp({ kind: 'PAY_LATE_FEE', cardId: id, amount: Math.min(cap, bankAqua(p)) || cap });
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
  // Who may not bid (4B3): a timepiece already out (a contract on the clock),
  // or the default chit on a manned contract. No hand limit on contracts.
  const barOf = (q) => (!q ? null : q.timepiece ? 'Timepiece out.'
    : (face.manned && s.defaultChit && s.defaultChit.profileId === q.profileId) ? 'Default chit: no manned bids.' : null);
  const blocked = iAmAuctioneer ? null : barOf(p);
  // The bidders still owed an answer: the engine's own list when it is there.
  const waitIds = Array.isArray(a.waitingOn) ? a.waitingOn.filter((id) => id !== a.auctioneerId) : null;
  const waiting = (s.players || []).filter((q) => q.profileId !== a.auctioneerId && (waitIds
    ? waitIds.includes(q.profileId)
    : (!(a.acted || []).includes(q.profileId) && !barOf(q))));
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
  // Who sits this lot out, and why.
  const out = (s.players || []).filter((q) => q.profileId !== a.auctioneerId && barOf(q));
  const outLine = out.length
    ? `<p class="m4c-wait">Out: ${out.map((q) => `<span class="player-name" style="--player-color:${esc(q.color || 'currentColor')}">@${esc(q.name)}</span> (${esc(barOf(q).replace(/\.$/, '').replace(/:.*/, '').toLowerCase())})`).join(', ')}</p>`
    : '';
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
        ${outLine}
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
  // Nudges, as in a patent auction: the auctioneer can ping the bidders still
  // owed an answer, or everyone else at the table.
  if (iAmAuctioneer && D.nudgeButton) {
    const others = (s.players || []).map((q) => q.profileId).filter((id) => id !== myId);
    if (others.length) {
      const wrap = document.createElement('div');
      wrap.className = 'm4c-btns m4c-nudges';
      wrap.append(
        D.nudgeButton('👋 Nudge waiting', { waiting: true }, waiting.map((q) => q.profileId), 'Remind the bidders who have not bid or passed yet.'),
        D.nudgeButton('👋 Nudge all', { all: true }, others, 'Remind every other player at the table.'),
      );
      const play = el.querySelector('.m4c-auction-play');
      if (play) play.appendChild(wrap);
    }
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
