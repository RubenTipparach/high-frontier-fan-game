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
import { contractFace } from '../../data/contracts.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');

// Inline [bracket] glyphs from the transcription -> readable tokens.
const BODY = {
  Sun: '☉', Mercury: '☿', Venus: '♀', Earth: '⊕', Moon: '☾', Mars: '♂',
  Ceres: '⚳', Jupiter: '♃', Saturn: '♄', Uranus: '♅', Neptune: '♆', Pluto: '♇',
};
function richText(s) {
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

const SIDE_LABEL = { blue: 'Blue side', gold: 'Gold side', exodus: 'Project Exodus' };

export function renderContractFace(face) {
  const side = face.Side;
  const el = document.createElement('div');
  el.className = `card m4-contract side-${side}`;
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
        <div class="m4-box m4-dest"><b>Destination</b>${richText(face.Destination)}</div>
        ${face['Fulfilled Ability'] ? `<div class="m4-box m4-ability"><b>Fulfilled ability</b>${richText(face['Fulfilled Ability'])}</div>` : ''}
        ${face['When Fulfilling'] ? `<div class="m4-box m4-when"><b>When fulfilling</b>${richText(face['When Fulfilling'])}</div>` : ''}
      </div>
      <div class="m4-money">
        <span class="m4-pay">${lateFeeBadge(face['Late Fee'])}<span>Late fee</span></span>
        ${face.Manned ? mannedGlyph() : '<span></span>'}
        <span class="m4-pay">${advanceBadge(face.Advance)}<span>Advance</span></span>
      </div>
      <div class="card-footer m4-footer"><span>${SIDE_LABEL[side] || side}</span><code>${esc(face.Code)}</code></div>
    </div></div>`;
  return el;
}

// The game's contract record (data/contracts.js) on one side, as a card element.
export function renderContractCard(cardId, side = 'blue') {
  const f = contractFace(cardId, side);
  if (!f) return null;
  return renderContractFace({
    Side: f.side, Code: f.code, Name: f.name, 'Contract Type': f.contractType, 'Ideology Pair': f.pair,
    Manned: f.manned, Mass: f.mass, 'Rad-Hard': f.radHardness, VP: f.vp, 'Late Fee': f.lateFee,
    Advance: f.advance, Cybernetics: f.cybernetics.join(', '), 'Title Icon': f.titleIcon,
    Destination: f.destination, 'Fulfilled Ability': f.fulfilledAbility, 'When Fulfilling': f.whenFulfilling,
  });
}
