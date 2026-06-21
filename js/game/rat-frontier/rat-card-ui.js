// RAT FRONTIER - card renderer.
//
// A rat-skinned port of the HF4 card renderer (js/game/card-ui.js): same
// card silhouette and glyph language (thrust triangle + pink thrust
// circle, fuel droplet, spectral hex, requirement-icon row, type bar,
// blurb) re-skinned to the Rattus Space Program look - cream parchment
// body (#fef3c0), brown rails (#71413b / #322b28), pixel card artwork in
// the art window. Reads the same card model HF cards use, so the engine
// stays branch-free.
//
// renderRatCard(card, opts) -> HTMLDivElement. art is resolved relative
// to assetBase (default assets/rat-frontier/art/) so a harness, the
// Browse catalog, and the app can all point it wherever they serve from.

import { RAT_SPECTRAL } from '../../../data/rat-frontier/rat-cards.js';

const TYPE_LABEL = {
  thruster: 'THRUSTER', reactor: 'REACTOR', radiator: 'RADIATOR',
  refinery: 'REFINERY', robonaut: 'ROBONAUT', generator: 'GENERATOR',
  crew: 'CREW',
};
// Rat typebar accent per card type (echoes HF's per-type typebar colour).
const TYPE_ACCENT = {
  thruster: '#b40054', reactor: '#6d28d9', radiator: '#0e7490',
  refinery: '#1d6f42', robonaut: '#a16207', generator: '#b45309',
  crew: '#71413b',
};
// Requirement-kind -> rat glyph + label (rat skin of REQUIREMENT_VIS).
const REQ_VIS = {
  'reactor-fission':  { glyph: 'X', label: 'Fission reactor' },
  'reactor-fusion':   { glyph: '∿', label: 'Fusion reactor' },
  'reactor-any':      { glyph: '⚛', label: 'Any reactor' },
  'gen-electric':     { glyph: 'e', label: 'Electric generator' },
  'thermostat':       { glyph: '🌡', label: 'Radiator therms' },
  'crew-quarters':    { glyph: '🐀', label: 'Crew quarters' },
  'sail':             { glyph: '⛵', label: 'Sail rigging' },
};
const PROSPECTOR_GLYPH = { raygun: '🔦', buggy: '🚙', missile: '🚀' };

let _styleInjected = false;
function injectStyle() {
  if (_styleInjected) return;
  _styleInjected = true;
  const css = `
  .rat-card{position:relative;width:240px;height:336px;border-radius:14px;
    background:#fef3c0;border:6px solid #71413b;box-shadow:0 6px 18px rgba(0,0,0,.45);
    font-family:'Trebuchet MS',system-ui,sans-serif;color:#322b28;overflow:hidden;
    image-rendering:pixelated;display:flex;flex-direction:column;}
  .rat-card .rat-typebar{display:flex;align-items:center;justify-content:space-between;
    background:#322b28;color:#fef3c0;padding:5px 8px;font-weight:700;letter-spacing:.06em;
    font-size:12px;border-bottom:3px solid #71413b;}
  .rat-card .rat-typebar .accent{width:10px;height:10px;border-radius:50%;margin-right:6px;}
  .rat-card .rat-typelabel{display:flex;align-items:center;}
  .rat-card .rat-hex{width:26px;height:30px;flex:0 0 auto;}
  .rat-card .rat-body{flex:1;display:flex;min-height:0;}
  .rat-card .rat-main{flex:1;display:flex;flex-direction:column;min-width:0;padding:6px;}
  .rat-card .rat-art{flex:1;border:3px solid #71413b;border-radius:8px;background:
    repeating-conic-gradient(#d8c79a 0% 25%,#cdb988 0% 50%) 0/16px 16px;
    display:flex;align-items:center;justify-content:center;overflow:hidden;min-height:0;}
  .rat-card .rat-art img{max-width:100%;max-height:100%;image-rendering:pixelated;}
  .rat-card .rat-name{background:#71413b;color:#fef3c0;text-align:center;font-weight:700;
    font-size:13px;padding:4px 4px;margin-top:6px;border-radius:6px;line-height:1.05;}
  .rat-card .rat-rail{width:46px;flex:0 0 auto;background:#bb7547;border-left:3px solid #71413b;
    display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 0;}
  .rat-card .rat-stat{display:flex;flex-direction:column;align-items:center;line-height:1;}
  .rat-card .rat-stat .chip{width:26px;height:26px;border-radius:50%;display:flex;
    align-items:center;justify-content:center;font-weight:800;font-size:13px;color:#fff;
    border:2px solid #322b28;}
  .rat-card .rat-stat .lab{font-size:8px;color:#322b28;font-weight:700;margin-top:1px;
    letter-spacing:.02em;}
  .rat-card .rat-foot{padding:5px 7px 7px;}
  .rat-card .rat-thrustbar{display:flex;align-items:center;gap:5px;background:#322b28;
    border-radius:9px;padding:4px 7px;color:#fef3c0;}
  .rat-card .rat-thrustbar .burns{background:#a82a2a;color:#fff;font-weight:800;font-size:13px;
    padding:2px 9px;border-radius:7px;white-space:nowrap;}
  .rat-card .rat-reqs{display:flex;gap:4px;flex-wrap:wrap;margin-top:5px;}
  .rat-card .rat-req{display:flex;align-items:center;gap:2px;background:#322b28;color:#fef3c0;
    border-radius:6px;padding:1px 5px;font-size:11px;font-weight:700;}
  .rat-card .rat-supplies{display:flex;gap:4px;flex-wrap:wrap;margin-top:4px;}
  .rat-card .rat-supply{background:#1d6f42;color:#eafff2;border-radius:6px;padding:1px 5px;
    font-size:10px;font-weight:700;}
  .rat-card .rat-blurb{font-size:9.5px;font-style:italic;color:#5a4636;margin-top:5px;
    line-height:1.2;}
  `;
  const s = document.createElement('style');
  s.textContent = css;
  document.head.appendChild(s);
}

function spectralHex(type) {
  const sp = RAT_SPECTRAL[type] || RAT_SPECTRAL.None;
  return `<svg class="rat-hex" viewBox="0 0 26 30" title="${sp.label}">
    <polygon points="13,1 25,8 25,22 13,29 1,22 1,8" fill="${sp.fill}" stroke="#322b28" stroke-width="2"/>
    <text x="13" y="20" text-anchor="middle" font-size="14" font-weight="800"
      fill="${sp.ink}" font-family="Trebuchet MS,sans-serif">${sp.glyph}</text>
  </svg>`;
}

// HF-style thrust visual: triangle wedge with a pink thrust circle and a
// water-droplet fuel pip. Re-skinned but using the same glyph language.
function thrustBar(card) {
  const fuelTxt = card.fuelRatio ? `1:${card.fuelRatio}` : '0';
  const aft = card.afterburn ? `<span title="Afterburn">🔥${card.afterburn}</span>` : '';
  return `<div class="rat-thrustbar">
    <svg width="34" height="30" viewBox="0 0 34 30">
      <polygon points="2,28 32,28 2,4" fill="#e6c34a" stroke="#322b28" stroke-width="1.5"/>
      <circle cx="9" cy="22" r="6.5" fill="#e0218a" stroke="#fff" stroke-width="1.5"/>
      <text x="9" y="25.5" text-anchor="middle" font-size="9" font-weight="800" fill="#fff">${card.thrust ?? 0}</text>
      <path d="M24 12 q4 6 0 9 q-4 -3 0 -9z" fill="#7fc7ff" stroke="#322b28" stroke-width="1"/>
      <text x="24" y="24" text-anchor="middle" font-size="6" font-weight="800" fill="#0c0a16">${card.fuelRatio ?? 0}</text>
    </svg>
    <span class="burns">${card.nodesMax ?? 0} Burns</span>
    <span style="font-size:10px;line-height:1.1;">Ratio<br><b>${fuelTxt}</b></span>
    ${aft}
  </div>`;
}

function statRail(card) {
  const stat = (val, lab, color) => val == null ? '' :
    `<div class="rat-stat"><div class="chip" style="background:${color}">${val}</div><div class="lab">${lab}</div></div>`;
  return `<div class="rat-rail">
    ${stat(card.mass, 'MASS', '#322b28')}
    ${stat(card.radHardness, 'SHIELD', '#588dbe')}
    ${stat(card.signature, 'SIG', '#4a3b30')}
    ${card.prospectingValue != null ? stat(card.prospectingValue, 'PROSP', '#a16207') : ''}
    ${card.therms != null ? stat(card.therms, 'THERM', '#0e7490') : ''}
  </div>`;
}

export function renderRatCard(card, { assetBase = 'assets/rat-frontier/art/' } = {}) {
  injectStyle();
  const el = document.createElement('div');
  el.className = `rat-card rat-type-${card.type}`;
  el.dataset.cardId = card.id;
  const accent = TYPE_ACCENT[card.type] || '#71413b';
  const isCrew = card.type === 'crew';
  const label = isCrew
    ? `CREW · ${(card.role || '').toUpperCase()}`
    : (TYPE_LABEL[card.type] || card.type.toUpperCase());

  const reqs = (card.requires || []).map(r => {
    const v = REQ_VIS[r.kind] || { glyph: '•', label: r.kind };
    return `<span class="rat-req" title="${v.label}">${v.glyph}${r.count > 1 ? '×' + r.count : ''}</span>`;
  }).join('');
  const supplies = (card.supplies || []).map(s => {
    const v = REQ_VIS[s] || { glyph: '•', label: s };
    return `<span class="rat-supply" title="Supplies ${v.label}">▸ ${v.glyph}</span>`;
  }).join('');
  const props = (card.properties || []).map(p =>
    `<span class="rat-supply" style="background:#b45309" title="${p.label}">${p.glyph} ${p.label}</span>`).join('');

  const prospGlyph = card.prospector ? PROSPECTOR_GLYPH[card.prospector] || '' : '';
  const hasThrust = card.thrust != null && card.thrust > 0;

  el.innerHTML = `
    <div class="rat-typebar">
      <span class="rat-typelabel"><span class="accent" style="background:${accent}"></span>${label}</span>
      ${isCrew && prospGlyph ? `<span title="Prospector">${prospGlyph}</span>` : spectralHex(card.spectralType)}
    </div>
    <div class="rat-body">
      <div class="rat-main">
        <div class="rat-art"><img src="${assetBase}${card.art}" alt="${card.name}"></div>
        <div class="rat-name">${card.name}${card.prospector && !isCrew ? ' ' + prospGlyph : ''}</div>
      </div>
      ${statRail(card)}
    </div>
    <div class="rat-foot">
      ${hasThrust ? thrustBar(card) : ''}
      ${reqs ? `<div class="rat-reqs">Needs ${reqs}</div>` : ''}
      ${supplies || props ? `<div class="rat-supplies">${supplies}${props}</div>` : ''}
      ${card.blurb ? `<div class="rat-blurb">${card.blurb}</div>` : ''}
    </div>`;
  return el;
}
