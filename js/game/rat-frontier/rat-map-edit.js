// RAT FRONTIER - edit/annotate ON THE LIVE MAP. Drives the original
// MapRenderer's node-edit hooks (setNodeEdit) so authoring happens directly on
// the real pan/zoom board with all the live nodes - no separate editor.
//
//   View      - normal map (pan / zoom / site popups).
//   Edit      - place / move / delete nodes, connect straight edges, draw curves.
//   Annotate  - tap a node to change its type, set server tags + season, comment.
//
// Mutates the shared rat map data (the loadRatMap cache the renderer holds) and
// calls renderer.refreshData()/redraw(). Server tags persist immediately
// (POST /rat-frontier/node-tags); comments via the site-annotations API.

import { activeProfile } from '../../auth.js';
import { ratSaveNodeTags, getSiteAnnotations, postSiteAnnotation } from '../../api.js';
import { NODE_TAGS } from '../../../data/node-tags.js';

const WP_TYPES = new Set(['burn', 'lagrange', 'hohmann', 'orbit', 'sun', 'decorative']);
const NODE_TOOLS = [
  ['select', 'Select'], ['delete', 'Delete'], ['site', 'Site'], ['sun', 'Sun'],
  ['burn', 'Burn'], ['lagrange', 'Lagrange'], ['hohmann', 'Hohmann'],
  ['orbit', 'Orbit'], ['straight', 'Connect'], ['curve', 'Curve'],
];
const SEASONS = ['', 'red', 'yellow', 'blue', 'green', 'beige'];

let _styled = false;
function injectStyle() {
  if (_styled) return; _styled = true;
  const css = `
  .rme-bar{position:absolute;left:0;right:0;top:0;z-index:6;display:flex;flex-wrap:wrap;gap:6px;
    padding:6px 8px;background:rgba(15,12,28,.82);backdrop-filter:blur(3px);align-items:center;}
  .rme-modes{display:flex;gap:4px;}
  .rme-btn{background:#2a2540;color:#e5e7eb;border:1px solid transparent;border-radius:7px;
    padding:6px 10px;font:600 12px system-ui;cursor:pointer;}
  .rme-btn.on{background:#3aa0ff;color:#04101f;}
  .rme-btn.mode-annotate.on{background:#e0218a;color:#fff;}
  .rme-tools{display:flex;flex-wrap:wrap;gap:4px;}
  .rme-tool{background:#221d33;color:#cdd;border:0;border-radius:6px;padding:5px 9px;font:600 12px system-ui;cursor:pointer;}
  .rme-tool.on{background:#e0218a;color:#fff;}
  .rme-hint{color:#aab;font:11px system-ui;margin-left:auto;}
  .rme-panel{position:absolute;right:10px;top:54px;z-index:7;width:230px;background:#171425;
    border:1px solid #2a2540;border-radius:10px;padding:10px;color:#e5e7eb;font:12px system-ui;
    box-shadow:0 8px 24px rgba(0,0,0,.5);max-height:78%;overflow:auto;}
  .rme-panel h4{margin:0 0 6px;font-size:13px;}
  .rme-panel label{display:block;color:#9aa;margin:6px 0 2px;font-size:11px;}
  .rme-panel select,.rme-panel input{width:100%;background:#0f0d1c;color:#e5e7eb;border:1px solid #2a2540;border-radius:5px;padding:5px;font-size:12px;}
  .rme-tags{display:grid;grid-template-columns:1fr 1fr;gap:3px;}
  .rme-tags label{display:flex;gap:4px;align-items:center;color:#cdd;margin:2px 0;}
  .rme-tags input{width:auto;}
  .rme-row{display:flex;gap:5px;margin-top:7px;}
  .rme-row button{flex:1;background:#2a2540;color:#e5e7eb;border:0;border-radius:6px;padding:6px;cursor:pointer;font-size:12px;}
  .rme-row button.go{background:#e0218a;color:#fff;}
  .rme-cmts{max-height:110px;overflow:auto;margin:4px 0;}
  .rme-cmts .c{border-top:1px solid #2a2540;padding:3px 0;color:#bcd;}
  .rme-cmts .c .a{color:#8a86a8;}
  .rme-status{color:#7c8;font-size:11px;margin-top:6px;min-height:14px;}
  .rme-edit-meta{font-size:11px;margin-bottom:4px;}
  .rme-edit-hint{font-size:11px;margin-bottom:6px;}
  .rme-row button.danger{background:#7a2540;color:#ffd9e4;}
  .rme-row button.danger:hover{background:#9a2f50;}
  @media (max-width:720px){ .rme-panel{width:auto;left:10px;right:10px;top:auto;bottom:10px;max-height:46%;} }
  `;
  const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
}

const round1 = (n) => Math.round(n * 10) / 10;
function nextIdSeed(data) {
  let max = 0;
  for (const s of data.sites) { const m = /_(\d+)$/.exec(s.id); if (m) max = Math.max(max, +m[1]); }
  return max + 1;
}

export function attachMapEditor(renderer, data, host) {
  injectStyle();
  let mode = 'view';        // view | edit | annotate
  let tool = 'select';
  let selected = null;      // node id (annotate)
  let edgePick = null;      // first node of a straight edge
  let curve = null;         // { ids: [...] } in-progress chain
  let seq = nextIdSeed(data);

  const ensureNbr = (a, b) => {
    if (!data.neighbors) data.neighbors = new Map();
    if (!data.neighbors.has(a)) data.neighbors.set(a, new Set());
    data.neighbors.get(a).add(b);
  };

  function placeNode(type, wx, wy) {
    const id = `rat_${type}_${seq++}`;
    const wp = WP_TYPES.has(type);
    const node = {
      id, id2: id, serverId: wp ? null : id, name: '', type,
      isWaypoint: wp, isDecorative: type === 'decorative',
      x: round1(wx), y: round1(wy), bodyKey: id, solarZone: null, aeroLandable: false, hazard: false,
      tags: {},
    };
    if (type === 'site') { node.spectralType = 'C'; node.hydration = 1; node.siteSize = 3; node.landing = 1; }
    data.sites.push(node); data.byId[id] = node;
    renderer.refreshData();
    return id;
  }
  function deleteNode(id) {
    const i = data.sites.findIndex((s) => s.id === id);
    if (i >= 0) data.sites.splice(i, 1);
    delete data.byId[id];
    data.edges = (data.edges || []).filter(([a, b]) => a !== id && b !== id);
    data.straightEdges = (data.straightEdges || []).filter(([a, b]) => a !== id && b !== id);
    data.chains = (data.chains || []).map((ch) => ch.filter((x) => x !== id)).filter((ch) => ch.length >= 2);
    data.neighbors = new Map();
    for (const [a, b] of data.edges) { ensureNbr(a, b); ensureNbr(b, a); }
    if (selected === id) closePanel();
    if (editSelId === id) clearEditSelection();
    renderer.refreshData();
  }
  function connect(a, b) {
    if (a === b) return;
    if (!data.edges) data.edges = [];
    if (!data.straightEdges) data.straightEdges = [];
    data.edges.push([a, b]); data.straightEdges.push([a, b]);
    ensureNbr(a, b); ensureNbr(b, a);
    // Edges live in the renderer's STATIC layer, so refreshStatic() - NOT
    // redraw() - is what repaints them. (redraw() only touches the live layer,
    // which is why a connection used to stay invisible until a mode change
    // forced a static rebuild.)
    renderer.refreshStatic();
  }
  function commitCurve() {
    if (curve && curve.ids.length >= 2) {
      if (!data.chains) data.chains = [];
      data.chains.push(curve.ids.slice());
      for (let i = 0; i < curve.ids.length - 1; i++) {
        data.edges.push([curve.ids[i], curve.ids[i + 1]]);
        ensureNbr(curve.ids[i], curve.ids[i + 1]); ensureNbr(curve.ids[i + 1], curve.ids[i]);
      }
    }
    curve = null;
    renderer.setEditPreview(null);
    renderer.refreshData(); syncHooks();
  }

  // ---- UI ----
  const bar = document.createElement('div');
  bar.className = 'rme-bar';
  bar.innerHTML = `
    <div class="rme-modes">
      <button class="rme-btn mode-view on" data-mode="view">View</button>
      <button class="rme-btn mode-edit" data-mode="edit">✏️ Edit</button>
      <button class="rme-btn mode-annotate" data-mode="annotate">🏷️ Annotate</button>
    </div>
    <div class="rme-tools" id="rme-tools"></div>
    <span class="rme-hint" id="rme-hint"></span>`;
  host.appendChild(bar);
  const toolsWrap = bar.querySelector('#rme-tools');
  const hint = bar.querySelector('#rme-hint');
  for (const [id, label] of NODE_TOOLS) {
    const b = document.createElement('button');
    b.className = 'rme-tool'; b.dataset.tool = id; b.textContent = label;
    b.onclick = () => setTool(id);
    toolsWrap.appendChild(b);
  }
  const finishBtn = document.createElement('button');
  finishBtn.className = 'rme-tool'; finishBtn.textContent = '✓ Finish curve'; finishBtn.style.display = 'none';
  finishBtn.onclick = () => commitCurve();
  toolsWrap.appendChild(finishBtn);

  bar.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  let panel = null;
  function closePanel() { selected = null; if (panel) { panel.remove(); panel = null; } }

  // Edit-mode selection: the highlighted node (ring + move arrows on the map,
  // drawn by the renderer) plus a side panel carrying a Delete button. Distinct
  // from the annotate panel above.
  let editSelId = null;
  let editPanel = null;
  function clearEditSelection() {
    editSelId = null;
    renderer.setEditHighlight(null);
    if (editPanel) { editPanel.remove(); editPanel = null; }
  }
  function selectEditNode(id) {
    if (!data.byId[id]) return;
    editSelId = id;
    renderer.setEditHighlight(id);   // ring + move arrows on the map
    openEditPanel(id);
  }
  function openEditPanel(id) {
    const n = data.byId[id]; if (!n) return;
    if (editPanel) editPanel.remove();
    editPanel = document.createElement('div');
    editPanel.className = 'rme-panel rme-edit-panel';
    editPanel.innerHTML = `
      <h4>${id}</h4>
      <div class="rme-edit-meta muted">${n.type}${n.name ? ' · ' + escapeHtml(n.name) : ''}</div>
      <div class="rme-edit-hint muted">Drag the node on the map to move it.</div>
      <div class="rme-row"><button class="p-del danger">🗑 Delete node</button></div>`;
    host.appendChild(editPanel);
    editPanel.querySelector('.p-del').onclick = () => deleteNode(id);
  }

  function setMode(m) {
    mode = m; edgePick = null; if (curve) commitCurve();
    clearEditSelection(); renderer.setEditPreview(null);
    bar.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    toolsWrap.style.display = m === 'edit' ? '' : 'none';
    if (m !== 'annotate') closePanel();
    if (m === 'edit') setTool('select');
    else hint.textContent = m === 'view' ? 'Pan + zoom the live board.'
      : 'Tap a node to retype / tag / comment.';
    syncHooks();
  }
  const TOOL_HINTS = {
    select: 'Tap a node to select it, then drag to move or Delete it on the side.',
    delete: 'Tap a node to delete it.',
    straight: 'Tap node A, then node B - they connect.',
    curve: 'Tap a node to start, tap empty space to add points, tap a node to finish.',
  };
  function setTool(t) {
    tool = t; edgePick = null; if (curve) commitCurve();
    clearEditSelection(); renderer.setEditPreview(null);
    toolsWrap.querySelectorAll('.rme-tool').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    finishBtn.style.display = t === 'curve' ? '' : 'none';
    hint.textContent = TOOL_HINTS[t] || `Tap empty space to place a ${t}.`;
    syncHooks();
  }

  // Wire the renderer's edit hooks for the current mode/tool.
  function syncHooks() {
    if (mode === 'view') { renderer.setNodeEdit(null); return; }
    if (mode === 'annotate') {
      renderer.setNodeEdit({ active: true, allowDrag: false,
        onClickNode: (id) => openPanel(id), onClickEmpty: () => closePanel() });
      return;
    }
    // edit mode
    renderer.setNodeEdit({
      active: true,
      allowDrag: tool === 'select',
      onPickNode: () => tool === 'select',
      onMoveNode: (id, wx, wy) => { const n = data.byId[id]; if (n) { n.x = round1(wx); n.y = round1(wy); } },
      // Edges sit in the static layer, so rebuild it when a moved node lands
      // so its connections follow to the new position.
      onDropNode: () => renderer.refreshStatic(),
      onClickNode: (id) => {
        if (tool === 'select') { selectEditNode(id); return; }
        if (tool === 'delete') return deleteNode(id);
        if (tool === 'straight') {
          // Click node A then node B: connect. A is highlighted while we wait.
          if (!edgePick) { edgePick = id; renderer.setEditHighlight(id); }
          else { connect(edgePick, id); edgePick = null; renderer.setEditHighlight(null); }
          return;
        }
        if (tool === 'curve') {
          // First node starts the curve; a later node click ends + commits it.
          if (!curve) { curve = { ids: [id] }; renderer.setEditPreview(curve.ids); return; }
          curve.ids.push(id);
          renderer.setEditPreview(curve.ids);
          commitCurve();
          return;
        }
      },
      onClickEmpty: (wx, wy) => {
        if (tool === 'select') { clearEditSelection(); return; }
        if (tool === 'curve') {
          if (!curve) return;   // a curve starts on a node, not empty space
          const id = placeNode('decorative', wx, wy);
          curve.ids.push(id);
          renderer.setEditPreview(curve.ids);   // live segment to the new point
          return;
        }
        if (['site', 'sun', 'burn', 'lagrange', 'hohmann', 'orbit'].includes(tool)) placeNode(tool, wx, wy);
      },
    });
  }

  // ---- annotate panel ----
  function openPanel(id) {
    const n = data.byId[id]; if (!n) return;
    selected = id; n.tags = n.tags || {};
    if (panel) panel.remove();
    panel = document.createElement('div');
    panel.className = 'rme-panel';
    panel.innerHTML = `
      <h4>${id}</h4>
      <label>Name</label><input class="p-name" value="${(n.name || '').replace(/"/g, '&quot;')}">
      <label>Type</label>
      <select class="p-type">${['site','sun','burn','lagrange','hohmann','orbit']
        .map((t) => `<option ${t === n.type ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <label>Server tags</label>
      <div class="rme-tags">
        ${['lander','half','hazard','aerobrake'].map((k) =>
          `<label><input type="checkbox" data-tag="${k}" ${n.tags[k] ? 'checked' : ''}>${k}</label>`).join('')}
      </div>
      <label>Season</label>
      <select class="p-season">${SEASONS.map((s) =>
        `<option value="${s}" ${(n.tags.season || '') === s ? 'selected' : ''}>${s || '(none)'}</option>`).join('')}</select>
      <label>Comments</label>
      <div class="rme-cmts">sign in to load</div>
      <input class="p-cmt" placeholder="Add a comment...">
      <div class="rme-row"><button class="p-post">Comment</button><button class="p-del">Delete</button></div>
      <div class="rme-row"><button class="go p-save">💾 Save tags → server</button></div>
      <div class="rme-status"></div>`;
    host.appendChild(panel);
    const status = panel.querySelector('.rme-status');
    const setStatus = (t) => { status.textContent = t; };

    panel.querySelector('.p-name').addEventListener('input', (e) => { n.name = e.target.value; renderer.redraw(); });
    panel.querySelector('.p-type').addEventListener('change', (e) => {
      n.type = e.target.value; n.isWaypoint = WP_TYPES.has(n.type); n.serverId = n.isWaypoint ? null : id;
      if (n.type === 'site' && n.spectralType == null) { n.spectralType = 'C'; n.hydration = 1; n.siteSize = 3; }
      renderer.refreshData();
    });
    panel.querySelectorAll('[data-tag]').forEach((cb) => cb.addEventListener('change', () => {
      n.tags[cb.dataset.tag] = cb.checked;
      if (n.tags.aerobrake) { n.tags.hazard = true; const hz = panel.querySelector('[data-tag="hazard"]'); if (hz) hz.checked = true; }
      stampTag(n); renderer.refreshData();
    }));
    panel.querySelector('.p-season').addEventListener('change', (e) => {
      n.tags.season = e.target.value || undefined; stampTag(n); renderer.refreshData();
    });
    panel.querySelector('.p-del').onclick = () => deleteNode(id);
    panel.querySelector('.p-save').onclick = async () => {
      const me = activeProfile();
      if (!me || !me.token) { setStatus('Sign in to save.'); return; }
      setStatus('Saving...');
      const t = n.tags || {};
      const r = await ratSaveNodeTags(me.token, { [id]: {
        lander: !!t.lander, half: !!t.half, hazard: !!t.hazard, aerobrake: !!t.aerobrake,
        season: t.season || null, site_name: n.name || n.type } });
      setStatus(r.ok ? 'Saved to server.' : (r.status === 403 ? 'Not admin.' : 'Save failed (' + r.status + ').'));
    };
    panel.querySelector('.p-post').onclick = async () => {
      const me = activeProfile(); const inp = panel.querySelector('.p-cmt'); const body = inp.value.trim();
      if (!body) return; if (!me || !me.token) { setStatus('Sign in to comment.'); return; }
      const r = await postSiteAnnotation(id, { kind: 'message', body, siteName: n.name || n.type }, me.token);
      if (r.ok) { inp.value = ''; loadComments(); setStatus('Comment posted.'); } else setStatus('Comment failed.');
    };
    async function loadComments() {
      const box = panel.querySelector('.rme-cmts'); const me = activeProfile();
      if (!me || !me.token) { box.textContent = 'sign in to load'; return; }
      const r = await getSiteAnnotations(id, me.token);
      box.innerHTML = '';
      const msgs = (r.ok && r.data && r.data.messages) || [];
      if (!msgs.length) { box.innerHTML = '<div class="c">no comments yet</div>'; return; }
      for (const m of msgs) {
        const d = document.createElement('div'); d.className = 'c';
        d.innerHTML = `<span class="a">@${(m.author || '?')}:</span> ${escapeHtml(m.body)}`;
        box.appendChild(d);
      }
    }
    loadComments();
  }

  function stampTag(n) {
    const t = n.tags || {};
    if (t.lander || t.half || t.hazard || t.aerobrake || t.season) {
      NODE_TAGS[n.id2] = { lander: !!t.lander, half: !!t.half, hazard: !!t.hazard, aerobrake: !!t.aerobrake, season: t.season || null };
    } else { delete NODE_TAGS[n.id2]; }
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // ---- export the authored board ----
  function exportData() {
    const out = {
      meta: { src: 'hand-authored-live', view: [1400, 900], counts: {}, edges: (data.edges || []).length, chains: (data.chains || []).length },
      sites: data.sites.map((s) => {
        const rec = { id: s.id, id2: s.id2 || s.id, serverId: s.serverId ?? null, name: s.name || '',
          type: s.type, isWaypoint: !!s.isWaypoint, isDecorative: !!s.isDecorative,
          x: round1(s.x), y: round1(s.y), srcPx: [round1(s.x * 523 / 1400), round1(s.y * 352 / 900)] };
        if (s.type === 'site') { rec.spectralType = s.spectralType || 'C'; rec.hydration = s.hydration ?? 1; rec.siteSize = s.siteSize ?? 3; rec.landing = 1; }
        const t = s.tags || {};
        if (t.lander || t.half || t.hazard || t.aerobrake || t.season) rec.tags = { lander: !!t.lander, half: !!t.half, hazard: !!t.hazard, aerobrake: !!t.aerobrake, season: t.season || null };
        return rec;
      }),
      edges: data.edges || [], straightEdges: data.straightEdges || [], chains: data.chains || [],
    };
    for (const s of out.sites) out.meta.counts[s.type] = (out.meta.counts[s.type] || 0) + 1;
    const js = '// Hand-authored on the live map (Rat Frontier edit mode).\n\n'
      + 'export const ALPHA_CENTAURI_MAP = ' + JSON.stringify(out, null, 2) + ';\n\n'
      + 'export const ALPHA_CENTAURI_SITES = ALPHA_CENTAURI_MAP.sites;\n'
      + 'export const ALPHA_CENTAURI_EDGES = ALPHA_CENTAURI_MAP.edges;\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([js], { type: 'text/javascript' }));
    a.download = 'alpha-centauri-map.js'; a.click();
  }
  const exportBtn = document.createElement('button');
  exportBtn.className = 'rme-btn'; exportBtn.textContent = '⬇ Export';
  exportBtn.onclick = exportData;
  bar.querySelector('.rme-modes').appendChild(exportBtn);

  setMode('view');
  return {
    destroy() { renderer.setNodeEdit(null); bar.remove(); closePanel(); },
  };
}
