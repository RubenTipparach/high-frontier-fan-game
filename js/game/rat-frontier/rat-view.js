// RAT FRONTIER - variant view. A THIN host that mounts the ORIGINAL game
// components with rat data swapped in (no bespoke renderers):
//   - Cards: the full rat deck via the original renderCard (js/game/card-ui.js).
//   - Map:   the Alpha Centauri board via the original MapRenderer
//            (js/game/render.js), fed the rat planner-map data.
// Only the DATA is new (data/rat-frontier/*). The rendering is reused.

import { assetUrl } from '../../base.js';
import { renderCard } from '../card-ui.js';
import { MapRenderer } from '../render.js';
import { RAT_PATENTS, RAT_CREW } from '../../../data/rat-frontier/rat-cards.js';
import { loadRatMap } from './rat-planner-map.js';
import { attachMapEditor } from './rat-map-edit.js';

const MAP_IMG = assetUrl('assets/rat-frontier/map/alpha-centauri.png');

let _styleInjected = false;
function injectStyle() {
  if (_styleInjected) return;
  _styleInjected = true;
  const css = `
  #view-rat-frontier{position:absolute;inset:0;display:flex;flex-direction:column;
    background:#0c0a16;color:#e5e7eb;font-family:system-ui,sans-serif;}
  .rat-topbar{display:flex;align-items:center;gap:10px;padding:8px 14px;background:#171425;
    border-bottom:1px solid #2a2540;}
  .rat-topbar h2{margin:0;font-size:16px;letter-spacing:.03em;}
  .rat-topbar .grow{flex:1;}
  .rat-tab{background:#2a2540;color:#e5e7eb;border:0;border-radius:7px;padding:6px 14px;
    font-weight:600;cursor:pointer;font-size:13px;}
  .rat-tab.is-active{background:#e0218a;color:#fff;}
  .rat-back{background:transparent;color:#9aa;border:0;cursor:pointer;font-size:13px;}
  .rat-pane{flex:1;min-height:0;position:relative;}
  .rat-cards-pane{overflow:auto;padding:18px;display:flex;flex-wrap:wrap;gap:16px;
    align-content:flex-start;}
  .rat-section-label{width:100%;font-size:12px;letter-spacing:.1em;color:#e0218a;
    font-weight:700;margin:6px 2px 2px;text-transform:uppercase;}
  .rat-map-pane{overflow:hidden;}
  .rat-map-pane .browse-map{position:absolute;inset:0;}
  @media (max-width:720px){
    .rat-topbar{flex-wrap:wrap;gap:6px;padding:6px 8px;}
    .rat-topbar h2{font-size:14px;width:100%;}
    .rat-tab{padding:6px 10px;font-size:12px;}
  }
  `;
  const s = document.createElement('style');
  s.textContent = css;
  document.head.appendChild(s);
}

function cardsPane() {
  const pane = document.createElement('div');
  pane.className = 'rat-pane rat-cards-pane';
  const add = (label, cards) => {
    const l = document.createElement('div');
    l.className = 'rat-section-label';
    l.textContent = label;
    pane.appendChild(l);
    for (const c of cards) {
      // Original renderer. Crew cards are detected via type==='crew'.
      pane.appendChild(renderCard(c, { type: c.type === 'crew' ? 'crew' : undefined }));
    }
  };
  add('Patents', RAT_PATENTS);
  add('Crew', RAT_CREW);
  return pane;
}

function mapPane() {
  const pane = document.createElement('div');
  pane.className = 'rat-pane rat-map-pane';
  const host = document.createElement('div');
  host.className = 'browse-map';
  pane.appendChild(host);
  // Mount the ORIGINAL MapRenderer with the rat planner-map data.
  let renderer = null;
  pane._mount = () => {
    if (renderer) {
      // Re-fit on re-show (the host may have resized while hidden).
      try { renderer.reset(); } catch { /* mid-teardown */ }
      return;
    }
    renderer = new MapRenderer(host, {
      data: loadRatMap(),
      onSelect: (id) => { console.log('[rat-map] selected', id); },
    });
    pane._renderer = renderer;
    // The app default zoom is 6 (it flies to the rocket); with no rocket we
    // browse the whole board, so drop the initial zoom and fit to data once
    // the pane is sized.
    renderer.options.initialZoom = 1;
    // Mount the pixel-art board as a world-space backdrop (default ON), so the
    // nodes sit over the drawn map instead of the procedural starfield.
    renderer.setBackdropImage(MAP_IMG, { visible: pane._bgOn !== false });
    renderer.setBodiesVisible(false);   // no HF body spheres / sun discs on the rat board
    // Edit/Annotate live on this map (View / Edit / Annotate overlay bar).
    pane._editor = attachMapEditor(renderer, loadRatMap(), host);
    requestAnimationFrame(() => { try { renderer.reset(); } catch {} });
    setTimeout(() => { try { renderer.reset(); } catch {} }, 250);
  };
  pane._bgOn = true;
  pane.toggleBackdrop = () => {
    pane._bgOn = !pane._bgOn;
    if (pane._renderer) pane._renderer.setBackdropVisible(pane._bgOn);
    return pane._bgOn;
  };
  return pane;
}

export function mountRatFrontier(container, { onBack } = {}) {
  injectStyle();
  container.innerHTML = '';

  const top = document.createElement('div');
  top.className = 'rat-topbar';
  top.innerHTML = `<h2>🐀 Rat Frontier</h2>
    <button class="rat-tab is-active" data-tab="cards">Cards</button>
    <button class="rat-tab" data-tab="map">Map</button>
    <button class="rat-tab is-active" id="rat-bg-toggle" hidden>🗺 Map art</button>
    <span class="grow"></span>
    <button class="rat-back">← Back</button>`;
  container.appendChild(top);

  const cards = cardsPane();
  const map = mapPane();   // the live map carries View / Edit / Annotate modes
  map.style.display = 'none';
  container.appendChild(cards);
  container.appendChild(map);

  const bgToggle = top.querySelector('#rat-bg-toggle');
  top.querySelectorAll('.rat-tab[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      top.querySelectorAll('.rat-tab[data-tab]').forEach((b) => b.classList.toggle('is-active', b === btn));
      const which = btn.dataset.tab;
      cards.style.display = which === 'cards' ? '' : 'none';
      map.style.display = which === 'map' ? '' : 'none';
      bgToggle.hidden = which !== 'map';        // map-art toggle only on the map tab
      if (which === 'map') requestAnimationFrame(() => map._mount());
    });
  });
  bgToggle.addEventListener('click', () => {
    const on = map.toggleBackdrop();
    bgToggle.classList.toggle('is-active', on);
    bgToggle.textContent = on ? '🗺 Map art' : '🗺 Map art (off)';
  });
  top.querySelector('.rat-back').addEventListener('click', () => { if (onBack) onBack(); });
  return { cards, map };
}
