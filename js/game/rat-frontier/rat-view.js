// RAT FRONTIER - variant view. Two surfaces behind one admin-gated entry:
//   - Cards: the full rat deck rendered through the rat card renderer.
//   - Map:   the Alpha Centauri board (the recovered pixel-art image) with
//            the extracted sites overlaid as clickable, spectral-coded hexes.
//
// This is the rat variant's own front-end surface; it deliberately reuses
// the rat card renderer and the same site model the HF map uses, so the
// engine can stay branch-free when full play lands.

import { assetUrl } from '../../base.js';
import { RAT_PATENTS, RAT_CREW, RAT_SPECTRAL } from '../../../data/rat-frontier/rat-cards.js';
import { renderRatCard } from './rat-card-ui.js';
import { ALPHA_CENTAURI_MAP } from '../../../data/rat-frontier/alpha-centauri-map.js';

const ART_BASE = assetUrl('assets/rat-frontier/art/') ;
const MAP_IMG = assetUrl('assets/rat-frontier/map/alpha-centauri.png');

let _styleInjected = false;
function injectStyle() {
  if (_styleInjected) return;
  _styleInjected = true;
  const css = `
  #view-rat-frontier{position:absolute;inset:0;background:#1a140d;color:#fef3c0;
    display:flex;flex-direction:column;font-family:'Trebuchet MS',sans-serif;}
  .rat-topbar{display:flex;align-items:center;gap:10px;padding:8px 14px;background:#322b28;
    border-bottom:3px solid #71413b;}
  .rat-topbar h2{margin:0;font-size:17px;letter-spacing:.04em;}
  .rat-topbar .grow{flex:1;}
  .rat-tab{background:#71413b;color:#fef3c0;border:0;border-radius:8px;padding:6px 14px;
    font-weight:700;cursor:pointer;font-size:13px;}
  .rat-tab.is-active{background:#e6c34a;color:#322b28;}
  .rat-back{background:transparent;color:#cdb988;border:0;cursor:pointer;font-size:13px;}
  .rat-pane{flex:1;min-height:0;overflow:auto;}
  .rat-cards-pane{padding:18px;display:flex;flex-wrap:wrap;gap:18px;align-content:flex-start;
    background:repeating-linear-gradient(45deg,#211910 0 18px,#1a140d 18px 36px);}
  .rat-section-label{width:100%;font-size:13px;letter-spacing:.08em;color:#e6c34a;
    font-weight:700;margin:8px 2px 0;}
  .rat-map-pane{position:relative;overflow:hidden;background:#0c0a08;cursor:grab;}
  .rat-map-pane.dragging{cursor:grabbing;}
  .rat-map-world{position:absolute;left:0;top:0;transform-origin:0 0;}
  .rat-map-world img{display:block;image-rendering:pixelated;}
  .rat-map-world svg{position:absolute;left:0;top:0;}
  .rat-map-hint{position:absolute;left:12px;bottom:10px;background:rgba(50,43,40,.85);
    padding:5px 10px;border-radius:7px;font-size:12px;color:#cdb988;pointer-events:none;}
  .rat-site-pop{position:absolute;z-index:5;background:#fef3c0;color:#322b28;border:3px solid #71413b;
    border-radius:10px;padding:8px 11px;font-size:12px;min-width:150px;box-shadow:0 6px 16px rgba(0,0,0,.5);}
  .rat-site-pop b{font-size:14px;}
  .rat-site-pop .row{display:flex;justify-content:space-between;gap:12px;margin-top:3px;}
  .rat-site-pop .sp{display:inline-block;width:18px;height:20px;text-align:center;}
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
    for (const c of cards) pane.appendChild(renderRatCard(c, { assetBase: ART_BASE }));
  };
  add('PATENTS', RAT_PATENTS);
  add('CREW', RAT_CREW);
  return pane;
}

// Pixel-art board (523x352) with clickable site hexes. Pan via drag, zoom
// via wheel. Sites are placed by their source pixel, scaled with the image.
function mapPane() {
  const SRC_W = ALPHA_CENTAURI_MAP.meta.srcSize[0];
  const SRC_H = ALPHA_CENTAURI_MAP.meta.srcSize[1];
  const pane = document.createElement('div');
  pane.className = 'rat-pane rat-map-pane';

  const world = document.createElement('div');
  world.className = 'rat-map-world';
  const img = document.createElement('img');
  img.src = MAP_IMG;
  img.width = SRC_W; img.height = SRC_H;
  world.appendChild(img);

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', SRC_W);
  svg.setAttribute('height', SRC_H);
  svg.setAttribute('viewBox', `0 0 ${SRC_W} ${SRC_H}`);

  const hexPath = (cx, cy, r) => {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + i * Math.PI / 3;
      pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
    }
    return pts.join(' ');
  };

  for (const s of ALPHA_CENTAURI_MAP.sites) {
    const [px, py] = s.srcPx;
    if (s.type === 'star') {
      const c = document.createElementNS(svgNS, 'circle');
      c.setAttribute('cx', px); c.setAttribute('cy', py);
      c.setAttribute('r', Math.max(7, (s.srcN ? Math.sqrt(s.srcN / Math.PI) : 8)));
      c.setAttribute('fill', 'none');
      c.setAttribute('stroke', '#fff'); c.setAttribute('stroke-width', '1.2');
      svg.appendChild(c);
      continue;
    }
    const sp = RAT_SPECTRAL[s.spectralType] || RAT_SPECTRAL.None;
    const r = s.type === 'planet' ? 6 : (s.type === 'moon' ? 4.5 : 3.5);
    const poly = document.createElementNS(svgNS, 'polygon');
    poly.setAttribute('points', hexPath(px, py, r));
    poly.setAttribute('fill', sp.fill + 'cc');
    poly.setAttribute('stroke', '#0c0a08');
    poly.setAttribute('stroke-width', '0.8');
    poly.style.cursor = 'pointer';
    poly.addEventListener('click', (ev) => {
      ev.stopPropagation();
      showSitePopup(pane, world, s);
    });
    svg.appendChild(poly);
  }
  world.appendChild(svg);
  pane.appendChild(world);

  const hint = document.createElement('div');
  hint.className = 'rat-map-hint';
  hint.textContent = `Alpha Centauri · ${ALPHA_CENTAURI_MAP.meta.stars} stars · ${ALPHA_CENTAURI_MAP.meta.planets} bodies · ${ALPHA_CENTAURI_MAP.meta.asteroids} belt sites · drag to pan, scroll to zoom`;
  pane.appendChild(hint);

  // Camera: scale + translate on the world layer.
  let scale = 1, tx = 0, ty = 0;
  const apply = () => { world.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`; };
  const fit = () => {
    const r = pane.getBoundingClientRect();
    scale = Math.max(0.4, Math.min(r.width / SRC_W, r.height / SRC_H) * 0.96);
    tx = (r.width - SRC_W * scale) / 2;
    ty = (r.height - SRC_H * scale) / 2;
    apply();
  };
  pane.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = pane.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const ns = Math.max(0.3, Math.min(8, scale * f));
    tx = mx - (mx - tx) * (ns / scale);
    ty = my - (my - ty) * (ns / scale);
    scale = ns; apply();
  }, { passive: false });
  let dragging = false, lx = 0, ly = 0;
  pane.addEventListener('pointerdown', (e) => {
    dragging = true; lx = e.clientX; ly = e.clientY;
    pane.classList.add('dragging'); pane.setPointerCapture(e.pointerId);
    clearPopup(pane);
  });
  pane.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    tx += e.clientX - lx; ty += e.clientY - ly; lx = e.clientX; ly = e.clientY; apply();
  });
  pane.addEventListener('pointerup', (e) => {
    dragging = false; pane.classList.remove('dragging');
    try { pane.releasePointerCapture(e.pointerId); } catch {}
  });
  // Fit once the pane has a size (after it's shown).
  pane._fit = fit;
  return pane;
}

function clearPopup(pane) {
  pane.querySelectorAll('.rat-site-pop').forEach((n) => n.remove());
}
function showSitePopup(pane, world, s) {
  clearPopup(pane);
  const sp = RAT_SPECTRAL[s.spectralType] || RAT_SPECTRAL.None;
  const pop = document.createElement('div');
  pop.className = 'rat-site-pop';
  pop.innerHTML = `
    <b>${s.name}</b>
    <div class="row"><span>Type</span><span>${s.type}${s.kind ? ' · ' + s.kind : ''}</span></div>
    <div class="row"><span>Spectral</span><span><span class="sp" style="background:${sp.fill};color:${sp.ink};border-radius:3px;">${sp.glyph}</span> ${sp.label}</span></div>
    <div class="row"><span>Hydration</span><span>${s.hydration}</span></div>
    <div class="row"><span>VPs</span><span>${s.vps}</span></div>`;
  // Position near the site in pane space (world transform maps src px -> screen).
  const m = new DOMMatrixReadOnly(getComputedStyle(world).transform);
  const px = s.srcPx[0] * m.a + m.e;
  const py = s.srcPx[1] * m.d + m.f;
  pop.style.left = Math.round(px + 10) + 'px';
  pop.style.top = Math.round(py - 10) + 'px';
  pane.appendChild(pop);
}

export function mountRatFrontier(container, { onBack } = {}) {
  injectStyle();
  container.innerHTML = '';

  const top = document.createElement('div');
  top.className = 'rat-topbar';
  top.innerHTML = `<h2>🐀 Rat Frontier</h2>
    <button class="rat-tab is-active" data-tab="cards">Cards</button>
    <button class="rat-tab" data-tab="map">Alpha Centauri map</button>
    <span class="grow"></span>
    <button class="rat-back">← Back to menu</button>`;
  container.appendChild(top);

  const cards = cardsPane();
  const map = mapPane();
  map.style.display = 'none';
  container.appendChild(cards);
  container.appendChild(map);

  top.querySelectorAll('.rat-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      top.querySelectorAll('.rat-tab').forEach((b) => b.classList.toggle('is-active', b === btn));
      const isMap = btn.dataset.tab === 'map';
      cards.style.display = isMap ? 'none' : '';
      map.style.display = isMap ? '' : 'none';
      if (isMap && map._fit) requestAnimationFrame(() => map._fit());
    });
  });
  top.querySelector('.rat-back').addEventListener('click', () => { if (onBack) onBack(); });
  return { cards, map };
}
