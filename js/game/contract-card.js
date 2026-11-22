// Module 4 contract card renderer, shared by the game (card-ui.js#renderCard for
// a contract slot, the contract panel and auction) and the review mockup
// (docs/mockups/m4/index.html). Draws a contract face in the game's card language
// (css/cards.css: typebar, name row, stats, body, footer) from one face of a
// data/card-data.js Contracts / Exodus Contracts row. The art is the rendered
// destination backdrop (Blender) with the face's own SVG foreground over it.
import {
  ideologyPairHex, augmentGlyph, tophatGlyph, maskGlyph,
  lateFeeBadge, advanceBadge, vpBadge, mannedGlyph, abilityHtml,
} from './contract-glyphs.js';
import { assetUrl } from '../base.js';
import { contractFace, stepLabel } from '../../data/contracts.js';

// Where a contract in play stands: set by contracts-ui.js to read the viewing
// player's own contract progress ({ done, total } by card id) and to name map
// spaces. A contract with progress draws its destination as a checklist.
let _progressOf = () => null;
let _nameOf = (slug) => slug;
export function setContractProgressSource(progressOf, nameOf) {
  _progressOf = progressOf || (() => null);
  _nameOf = nameOf || ((slug) => slug);
}

// Late fees / debt repaid on a contract in play (4B5): { paid, debt } or null,
// set by contracts-ui.js from the owner's contract record.
let _debtOf = () => null;
export function setContractDebtSource(fn) { _debtOf = fn || (() => null); }

// Which of the viewer's contracts can be fulfilled (or a step announced) where
// they stand right now: set by contracts-ui.js. Returns null or { final }.
let _readyOf = () => null;
export function setContractReadySource(fn) { _readyOf = fn || (() => null); }
// The Fulfill button drawn on a ready contract card.
export function fulfillButtonHtml(cardId, ready) {
  return `<button type="button" class="m4-fulfill-btn" data-fulfill="${String(cardId).replace(/"/g, '&quot;')}">🏁 ${ready && ready.final ? 'Fulfill' : 'Announce step'}</button>`;
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');

// Inline [bracket] glyphs from the transcription -> readable tokens.
const BODY = {
  Sun: '☉', Mercury: '☿', Venus: '♀', Earth: '⊕', Moon: '☾', Mars: '♂',
  Ceres: '⚳', Jupiter: '♃', Saturn: '♄', Uranus: '♅', Neptune: '♆', Pluto: '♇',
};
export function richText(s) {
  return abilityHtml(s || '')
    .replace(/\[(Sun|Mercury|Venus|Earth|Moon|Mars|Ceres|Jupiter|Saturn|Uranus|Neptune|Pluto)\]/g,
      (_, b) => `<span class="m4-body-glyph" data-tip="${b}">${BODY[b]}</span>`)
    .replace(/\[hex ([A-Z])\]/g, (_, l) => `<span class="m4-hexchip">${l}</span>`)
    .replace(/\[([^\]]+)\]/g, (_, d) => {
      // A green-ringed hazard icon on a card means "this Hazard type no longer
      // rolls for you": drawn in the map's own hazard glyphs.
      const sym = /skull|hazard/i.test(d) ? '☠' : /aerobrake/i.test(d) ? '\u{1FA82}'
        : /air-eater/i.test(d) ? '\u{1F32C}' : /synodic|comet/i.test(d) ? '☄' : null;
      return sym ? `<span class="m4-immune" data-tip="${esc(d)}">${sym}</span>`
        : `<span class="m4-inline-icon" data-tip="${esc(d)}">◉</span>`;
    })
    .replace(/Season (Red|Yellow|Blue)/g, (m, c) => `<span class="m4-season m4-season-${c.toLowerCase()}">${m}</span>`);
}

// The map places a destination names, as tokens for the map link: a listed
// site or space (`at:` / `enter:`) by its slug, and a "<Body> Site" step as
// `body:<Body>` (every site on that body). Steps with no named place (any
// unexplored site, a flyby count) add nothing.
export function destinationPlaces(steps) {
  const out = [];
  const add = (t) => { if (t && !out.includes(t)) out.push(t); };
  for (const st of (steps || [])) {
    if (st.verb === 'at') st.sites.forEach(add);
    else if (st.verb === 'enter') add(st.node);
    else if (st.verb === 'site' && st.filters && st.filters.body) add(`body:${st.filters.body}`);
  }
  return out;
}
// The destination text, as a map link when it names a place.
function destHtml(face) {
  const text = richText(face.Destination);
  const places = Array.isArray(face.Places) ? face.Places : [];
  // Filter destinations ("Unexplored Synodic Site") resolve to their matching
  // sites in play, so any step that names a kind of place links too.
  const kinds = (face.Steps || []).some((st) => ['site', 'space', 'flybys'].includes(st.verb));
  if (!places.length && !(kinds && face.CardId)) return text;
  const q = (v) => esc(v).replace(/"/g, '&quot;');
  return `<span class="m4-dest-link" role="link" tabindex="0" data-places="${q(places.join('|'))}"${face.CardId ? ` data-card="${q(face.CardId)}" data-side="${q(face.Side)}"` : ''} data-contract="${q(face.Name)}" data-tip="Show on the map">${text}</span>`;
}

const SIDE_LABEL = { blue: 'Blue side', gold: 'Gold side', exodus: 'Project Exodus' };

// The destination steps as a checklist (✅ announced, ⬜ to go), in the same
// tick language as the Futures checklist. Only for a contract in play.
function stepsHtml(face) {
  const prog = face.Progress;
  const steps = face.Steps;
  if (!prog || !Array.isArray(steps) || !steps.length) return '';
  const rows = steps.map((s, i) => {
    const done = i < (prog.done | 0);
    return `<li class="${done ? 'done' : ''}${i === (prog.done | 0) ? ' next' : ''}">${done ? '✅' : '⬜'} ${esc(stepLabel(s, _nameOf))}</li>`;
  }).join('');
  return `<ul class="m4-steps" aria-label="Destination steps">${rows}</ul>`;
}

const M4_DENSE = [100, 145, 190, 250];

export function renderContractFace(face) {
  const side = face.Side;
  const el = document.createElement('div');
  // Text-size step from how much text the body carries (the card itself never
  // grows): destination, abilities, and the step checklist when in play.
  const textLen = String(face.Destination || '').length + String(face['Fulfilled Ability'] || '').length
    + String(face['When Fulfilling'] || '').length
    + (face.Progress && Array.isArray(face.Steps) ? face.Steps.reduce((n, s) => n + 14 + stepLabel(s, _nameOf).length, 0) : 0)
    + (face['Fulfilled Ability'] ? 30 : 0) + (face['When Fulfilling'] ? 30 : 0);
  const dense = textLen > M4_DENSE[3] ? 4 : textLen > M4_DENSE[2] ? 3 : textLen > M4_DENSE[1] ? 2 : textLen > M4_DENSE[0] ? 1 : 0;
  el.className = `card m4-contract side-${side}${dense ? ` m4-dense-${dense}` : ''}`;
  const icon = face['Title Icon'] === 'tophat' ? tophatGlyph() : face['Title Icon'] === 'mask' ? maskGlyph() : '';
  const cyb = String(face.Cybernetics || '').split(',').map((s) => s.trim()).filter(Boolean)
    .map((s) => augmentGlyph(s)).join('');
  // Card art is ALWAYS the Blender render of the destination
  // (scripts/card-art/blender/render_contracts.py): planets, asteroids and
  // comets are rendered, never drawn in SVG (user 2026-11-15).
  // Over it, this face's OWN foreground, drawn after its printed illustration
  // (scripts/gen-contract-craft.mjs, one SVG per face, never shared).
  const artUrl = (rel) => (globalThis.M4_ART_BASE != null
    ? `${globalThis.M4_ART_BASE}assets/cards/contracts/${rel}` : assetUrl(`assets/cards/contracts/${rel}`));
  const art = `url("${artUrl(`craft/${face.Code}.svg`)}"), url("${artUrl(`${face.Code}-3d.webp`)}")`;
  el.innerHTML = `
    <div class="card-inner"><div class="card-face">
      <div class="card-typebar m4-typebar">
        <span class="m4-title-left">${icon}</span>
        <span class="m4-type">${esc(String(face['Contract Type']).replace(/ Contract$/, ''))}<small>Contract</small></span>
        <span class="m4-title-right">${ideologyPairHex(face['Ideology Pair'])}</span>
      </div>
      <div class="card-name-row"><span class="card-name">${esc(face.Name)}</span></div>
      <div class="m4-stats">
        <span class="m4-stat"><strong>${face.Mass}</strong> MASS</span>
        <span class="m4-stat"><strong>${face['Rad-Hard']}</strong> RAD</span>
        <span class="m4-cyb" data-tip="Cybernetics: the augmentation shapes this contract adds to your portfolio once fulfilled.">${cyb}</span>
        ${vpBadge(face.VP)}
      </div>
      <div class="card-body m4-body has-craft" style='background-image:${art}'>
        <div class="m4-box m4-dest"><b>Destination</b>${destHtml(face)}${stepsHtml(face)}</div>
        ${face['Fulfilled Ability'] ? `<div class="m4-box m4-ability"><b>Fulfilled ability</b>${richText(face['Fulfilled Ability'])}</div>` : ''}
        ${face['When Fulfilling'] ? `<div class="m4-box m4-when"><b>When fulfilling</b>${richText(face['When Fulfilling'])}</div>` : ''}
      </div>
      <div class="m4-money">
        <span class="m4-pay">${lateFeeBadge(face['Late Fee'])}<span>Late fee</span></span>
        ${face.Manned ? mannedGlyph() : '<span></span>'}
        <span class="m4-pay">${advanceBadge(face.Advance)}<span>Advance</span></span>
      </div>
      ${face.Debt ? `<div class="m4-repaid" data-tip="Aqua paid toward the advance (late fees). Paid off, the contract is discarded.">💧 Repaid <b>${face.Debt.paid | 0}</b> / ${face.Debt.debt | 0} aqua${face.Debt.pay > 0 ? `<button type="button" class="m4-pay-btn" data-pay="${esc(face.CardId)}">💸 Pay ${face.Debt.pay}</button>` : ''}</div>` : ''}
      <div class="card-footer m4-footer"><span>${SIDE_LABEL[side] || side}</span><code>${esc(face.Code)}</code></div>
    </div></div>`;
  if (face.Ready && face.CardId) {
    el.classList.add('m4-ready');
    el.querySelector('.card-face').insertAdjacentHTML('beforeend', fulfillButtonHtml(face.CardId, face.Ready));
  }
  return el;
}

// The game's contract record (data/contracts.js) on one side, as a card element.
export function renderContractCard(cardId, side = 'blue') {
  const f = contractFace(cardId, side);
  if (!f) return null;
  const el = renderContractFace({
    Side: f.side, Code: f.code, Name: f.name, 'Contract Type': f.contractType, 'Ideology Pair': f.pair,
    Manned: f.manned, Mass: f.mass, 'Rad-Hard': f.radHardness, VP: f.vp, 'Late Fee': f.lateFee,
    Advance: f.advance, Cybernetics: f.cybernetics.join(', '), 'Title Icon': f.titleIcon,
    Destination: f.destination, 'Fulfilled Ability': f.fulfilledAbility, 'When Fulfilling': f.whenFulfilling,
    Steps: f.steps, Progress: _progressOf(cardId), Places: destinationPlaces(f.steps),
    CardId: cardId, Ready: _readyOf(cardId), Debt: _debtOf(cardId),
  });
  if (el) el.dataset.contractId = cardId;
  return el;
}
