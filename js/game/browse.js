// Browse view: map + patent deck + milestones + events.
//
// Read-only, no engine dependency. Lets a user inspect Stage 2 data
// without needing to start a multiplayer game. Reachable from the
// topbar; also acts as the "preview" surface that Stage 3 will
// replace with the live game.

import { MapRenderer } from './render.js';
import { PATENTS, PATENT_TYPES, patentsByType } from '../../data/patents.js';
import { MILESTONES } from '../../data/glory.js';
import { POLITICS } from '../../data/politics.js';
import { SITES_BY_ID } from '../../data/sites.js';

let _renderer = null;
let _activeTab = 'map';

export function mountBrowse() {
  const view = document.getElementById('view-browse');
  if (!view) return;
  setupTabs();
  showTab(_activeTab);
}

function setupTabs() {
  const tabs = document.querySelectorAll('#browse-tabs button');
  tabs.forEach((btn) => {
    btn.onclick = () => showTab(btn.dataset.tab);
  });
}

function showTab(id) {
  _activeTab = id;
  document.querySelectorAll('#browse-tabs button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === id);
  });
  document.querySelectorAll('.browse-panel').forEach((p) => {
    p.classList.toggle('hidden', p.dataset.tab !== id);
  });
  switch (id) {
    case 'map':         renderMap(); break;
    case 'patents':     renderPatents(); break;
    case 'milestones':  renderMilestones(); break;
    case 'events':      renderEvents(); break;
  }
}

function renderMap() {
  const host = document.getElementById('browse-map');
  if (!host) return;
  if (!_renderer) {
    _renderer = new MapRenderer(host, {
      onSelect: (site) => {
        const info = document.getElementById('browse-map-info');
        info.innerHTML = `
          <h3></h3>
          <p class="muted"></p>
          <ul class="kv">
            <li><span>Body</span><strong></strong></li>
            <li><span>Type</span><strong class="type"></strong></li>
            <li><span>Class</span><strong class="cls"></strong></li>
            <li><span>Hydration</span><strong class="hyd"></strong></li>
            <li><span>Base VPs</span><strong class="vps"></strong></li>
          </ul>
        `;
        info.querySelector('h3').textContent = site.name;
        info.querySelector('p').textContent = site.blurb;
        info.querySelector('li:nth-child(1) strong').textContent = site.body;
        info.querySelector('.type').textContent = site.type;
        info.querySelector('.cls').textContent = site.class || '—';
        info.querySelector('.hyd').textContent = '💧'.repeat(site.hydration) || '—';
        info.querySelector('.vps').textContent = site.vps;
      },
    });
  }
}

function renderPatents() {
  const host = document.getElementById('browse-patents');
  if (!host) return;
  host.innerHTML = '';

  // Filter bar.
  const bar = document.createElement('div');
  bar.className = 'patent-filter';
  bar.innerHTML = `<button class="active" data-type="all">All (${PATENTS.length})</button>`;
  for (const t of PATENT_TYPES) {
    const n = patentsByType(t).length;
    bar.innerHTML += `<button data-type="${t}">${cap(t)} (${n})</button>`;
  }
  host.appendChild(bar);
  bar.querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      bar.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      const filter = b.dataset.type;
      grid.innerHTML = '';
      for (const p of PATENTS) {
        if (filter !== 'all' && p.type !== filter) continue;
        grid.appendChild(patentCard(p));
      }
    };
  });

  // Grid.
  const grid = document.createElement('div');
  grid.className = 'patent-grid';
  host.appendChild(grid);
  for (const p of PATENTS) grid.appendChild(patentCard(p));
}

function patentCard(p) {
  const card = document.createElement('div');
  card.className = 'patent-card type-' + p.type;
  card.innerHTML = `
    <div class="pc-header">
      <span class="pc-type"></span>
      <span class="pc-name"></span>
    </div>
    <div class="pc-stats"></div>
    <p class="pc-blurb"></p>
  `;
  card.querySelector('.pc-type').textContent = p.type.toUpperCase();
  card.querySelector('.pc-name').textContent = p.name;
  card.querySelector('.pc-blurb').textContent = p.blurb;
  const stats = card.querySelector('.pc-stats');
  const rows = [];
  rows.push(`<span>Mass</span><strong>${p.mass}</strong>`);
  if (p.type === 'thruster') {
    rows.push(`<span>Thrust</span><strong>${p.thrust}</strong>`);
    rows.push(`<span>ISP</span><strong>${p.isp}</strong>`);
    if (p.power_req) rows.push(`<span>Power req</span><strong>${p.power_req}</strong>`);
  }
  if (p.type === 'reactor') {
    rows.push(`<span>Power</span><strong>${p.power}</strong>`);
    rows.push(`<span>Heat</span><strong>${p.heat}</strong>`);
  }
  if (p.type === 'radiator') {
    rows.push(`<span>Heat cap</span><strong>${p.heat_cap}</strong>`);
  }
  if (p.type === 'refinery') {
    rows.push(`<span>Water out</span><strong>${p.water_out}</strong>`);
  }
  if (p.type === 'robonaut') {
    rows.push(`<span>+Prospect</span><strong>${p.prospect_bonus}</strong>`);
  }
  if (p.type === 'lab' || p.type === 'generator') {
    rows.push(`<span>Science</span><strong>${p.science}</strong>`);
  }
  stats.innerHTML = rows.map((r) => `<div>${r}</div>`).join('');
  return card;
}

function renderMilestones() {
  const host = document.getElementById('browse-milestones');
  if (!host) return;
  host.innerHTML = '<ul class="ms-list"></ul>';
  const list = host.querySelector('ul');
  for (const m of MILESTONES) {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="ms-head">
        <strong></strong>
        <span class="ms-vp">+${m.vps} VP</span>
      </div>
      <p class="muted"></p>
    `;
    li.querySelector('strong').textContent = m.name;
    li.querySelector('p').textContent = m.blurb;
    list.appendChild(li);
  }
}

function renderEvents() {
  const host = document.getElementById('browse-events');
  if (!host) return;
  host.innerHTML = '<ul class="ev-list"></ul>';
  const list = host.querySelector('ul');
  for (const e of POLITICS) {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="ev-head">
        <strong></strong>
        <span class="ev-kind"></span>
      </div>
      <p class="muted"></p>
    `;
    li.querySelector('strong').textContent = e.name;
    li.querySelector('.ev-kind').textContent = e.kind;
    li.querySelector('p').textContent = e.blurb;
    list.appendChild(li);
  }
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// Site count and edge count for debug surfaces.
export const STATS = {
  siteCount: Object.keys(SITES_BY_ID).length,
  patentCount: PATENTS.length,
  milestoneCount: MILESTONES.length,
  eventCount: POLITICS.length,
};
