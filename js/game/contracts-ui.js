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
import { renderContractCard, richText, setContractProgressSource } from './contract-card.js';
import { SITES_BY_ID } from '../../data/sites.js';
import { lagrangeLabel } from '../../data/lagrange-labels.js';
import { nodeLabelOf } from '../../data/map-labels.js';
import { augmentGlyph, AUGMENTS, timepieceDialGlyph } from './contract-glyphs.js';
import { sunspotDialSvg } from './turn-clock-ui.js';
import { isM4, isM2 } from './online-mode.js';
import { COLONISTS_BY_ID } from '../../data/colonists.js';

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
const lawKeys = (s) => {
  const out = new Set();
  if (s && s.activeLawStar) out.add(s.activeLawStar);
  for (const k of (s && s.activeLaws) || []) out.add(k);
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
  if (!on) { closePanel(); renderContractAuction(null); _seenFulfilled = null; return; }
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

// The Contracts panel's own dial: your timepiece on its deadline, a band from
// the Cube to it, and everyone else's timepieces.
function panelDial(s, p) {
  const tp = p.timepiece;
  const turn = s.turn | 0;
  const markers = timepieceMarkers(s, p.profileId);
  let center = [turnLine(s), 'Timepiece', 'in Reserve'];
  let band = null;
  if (tp) {
    const slot = ((tp.slot % SLOTS) + SLOTS) % SLOTS;
    const left = yearsFromNow(s, tp.slot);
    markers.push({ slot, svg: timepieceDialGlyph({ color: p.color || '#e5e7eb', size: DIAL_GLYPH, deadbeat: !!tp.deadbeat }), title: 'Your timepiece' });
    if (tp.deadbeat) center = [turnLine(s), 'LATE'];
    else {
      center = [turnLine(s), `${left} yr left`];
      if (left > 0) band = { from: (turn + 1) % SLOTS, to: slot, color: '#fbbf24' };
    }
  }
  return `<div class="m4c-dial">${sunspotDialSvg({ turn, markers, band, center })}</div>`;
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
  if ((r.stack || []).some((s) => s.id === id)) return r.siteId ? `Rocket at ${spaceName(r.siteId)}` : 'Rocket at LEO';
  for (const o of Object.values(p.outposts || {})) {
    if ((o.cards || []).some((s) => s.id === id)) return `Outpost ${o.letter} at ${spaceName(o.siteId)}`;
  }
  const fr = p.freighter;
  if (fr && (fr.stack || []).some((s) => s.id === id)) return fr.siteId ? `Freighter at ${spaceName(fr.siteId)}` : 'Freighter at LEO';
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
  let tpLine = 'Timepiece in Reserve.';
  if (tp) {
    const f = faceOf(p, tp.contractId);
    const tmeta = (p.contractMeta || {})[tp.contractId] || {};
    const owed = (f.advance * (tmeta.boosted ? 1 : 2)) - (tmeta.paid | 0);
    tpLine = tmeta.default
      ? `<b class="m4c-late">DEFAULT</b> ${esc(f.name)}: ${owed} aqua owed.`
      : tp.deadbeat
      ? `<b class="m4c-late">LATE</b> ${esc(f.name)}: ${f.lateFee} aqua due.`
      : `${esc(f.name)}: ${yearsFromNow(s, tp.slot)} yr left.`;
  }
  const chit = s.defaultChit
    ? `Default chit: ${esc(nameOf(s.defaultChit.profileId))} (${s.defaultChit.side === 'gold' ? -6 : -3} VP).`
    : 'Default chit: unclaimed.';
  parts.push(`<div class="m4c-status-row">${panelDial(s, p)}<div class="m4c-status"><div>⏱ ${tpLine}</div><div>🏷 ${chit}</div></div></div>`);

  // Contract auction (the Fundraise's final step)
  const laws = lawKeys(s);
  const auctionOpen = myTurn && p.fundraisedThisTurn && !p.contractAuctionDone && !tp && !s.auction;
  const decks = Object.keys(CONTRACT_PAIRS).map((pair) => {
    const deck = (s.contractDecks || {})[pair] || [];
    const byLaw = CONTRACT_PAIRS[pair].some((k) => laws.has(k));
    const byConnections = !byLaw && hasContractAbility(p, 'connections')
      && CONTRACT_PAIRS[pair].some((k) => delegateIn(s, k, p.profileId));
    const open = byLaw || byConnections;
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
        <span class="m4c-law">${byLaw ? 'Active Law' : byConnections ? 'Connections' : ''}</span></div>
      ${top ? cardThumb(top, 'blue') : '<div class="muted">empty</div>'}${btns}</div>`;
  }).join('');
  const auctionNote = auctionOpen
    ? '' : (tp ? 'Timepiece out.' : '');
  parts.push(`<h4>Contract decks</h4>${auctionNote ? `<p class="muted">${auctionNote}</p>` : ''}<div class="m4c-decks">${decks}</div>`);

  // Contracts in hand live in the Hand area (4B3h: a won contract is a Hand
  // Card), so the panel only points there; boosted and fulfilled ones are here.
  const inHand = (p.contractHand || []).length;
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
      if ((x.partners || []).includes(p.profileId)) partnered.push(`<div class="m4c-item">${cardThumb(x.id, x.side)}<div class="m4c-note">@${esc(q.name)}</div></div>`);
    }
  }
  parts.push(`<h4>In hand</h4><p class="muted">${inHand
    ? `${inHand} in your Hand.`
    : 'none'}</p>`);
  parts.push(`<h4>Boosted</h4><div class="m4c-row">${boosted || '<span class="muted">none</span>'}</div>`);
  parts.push(`<h4>Fulfilled</h4><div class="m4c-row">${fulfilled || '<span class="muted">none yet</span>'}</div>`);
  if (partnered.length) parts.push(`<h4>Partner</h4><div class="m4c-row">${partnered.join('')}</div>`);
  parts.push(augmentationsHtml(s, p, myTurn));

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
    const on = a && (a.colonySite ? `${spaceName(a.colonySite)} Colony` : colName(a.colonistId));
    const st = a ? `${esc(on)} (side ${a.side}: ${esc(sideText(sh, a.side))})`
      : (portfolio.has(sh) ? 'ready' : '');
    return `<div class="m4c-aug ${portfolio.has(sh) ? 'have' : 'lack'}">${augmentGlyph(sh, { size: 26 })}<span><b>${AUGMENTS[sh].name}</b> ${st}</span></div>`;
  }).join('');
  const opts = [...portfolio].map((sh) => `<option value="${sh}">${AUGMENTS[sh].name}</option>`).join('');
  const controls = (key, attrs) => (myTurn && opts ? `<div class="m4c-controls"><select data-shape-for="${key}">${opts}</select>
    <select data-side-for="${key}"><option value="2">side 2</option><option value="1">side 1</option></select>
    <button type="button" data-act="implant" ${attrs}>Implant</button></div>` : '');
  // Without Module 2 (no Colonists / Bernals) chits go on your Colonies (user
  // ruling 2026-11-17).
  if (!s.m2) {
    const mine = Object.entries(s.colonies || {}).filter(([, c]) => c && c.ownerId === p.profileId).map(([site]) => site);
    const rows = mine.map((site) => {
      const here = SHAPES.filter((sh) => aug[sh] && aug[sh].colonySite === site).map((sh) => augmentGlyph(sh, { size: 22 })).join('');
      return `<div class="m4c-col"><b>${esc(spaceName(site))} Colony</b> ${here}${controls(site, `data-col="${esc(site)}" data-colony="1"`)}</div>`;
    }).join('');
    return `<h4>Augmentations</h4><div class="m4c-augs">${chips}</div>${rows || '<p class="muted">No Colony.</p>'}`;
  }
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
    controls = `<select id="m4c-years" aria-label="Your bid in years">${opts}</select>
      <button type="button" data-act="bid">Submit ${_yearsDraft} yr</button>
      ${iAmAuctioneer ? '' : '<button type="button" data-act="pass">Pass</button>'}`;
  }
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
    <div class="m4c-head"><h3>📜 Contract auction</h3><span class="muted">${CONTRACT_PAIR_NAMES[a.pair] || ''}</span></div>
    <div class="m4c-auction-body">
      <div class="m4c-auction-card">${cardThumb(a.cardId, a.side || 'blue')}</div>
      <div class="m4c-auction-play">
        <div class="m4c-dial m4c-auction-dial">${dial}</div>
        <div class="m4c-controls">${controls}</div>
        <p class="m4c-wait">${settled ? `${esc(nameOf(a.auctioneerId))} to close` : `Waiting: ${waiting.map((q) => '@' + esc(q.name)).join(', ')}`}</p>
      </div></div></div>`;
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
