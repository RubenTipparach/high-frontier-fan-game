// Rig 2D: pose the colonist-art human rig in the browser, swap its assets, and
// export the figure (SVG, or the pose + look JSON the card build reads).
// Serve the repository root (python3 -m http.server) and open /tools/rig2d/.
import { drawFigure, poseFromMarks, restPose } from '../../scripts/rig2d/figure.mjs';
import { BONES } from '../../scripts/rig2d/rig.mjs';
import { artKit } from '../../scripts/colonist-art-m4-fronts.mjs';
import { poseKit } from '../../scripts/colonist-art-people.mjs';

const W = 300, H = 330;
const K = artKit({ W, H }), PK = poseKit({ W, H });
const heads = { bust: K.bust, profile: PK.profile };
const POSES = ['col_boston_hexapods', 'col_botany_bay_convicts', 'col_cobots', 'col_exoskeletalists', 'col_gabonese_mining_consortium',
  'col_heavy_water_survivalists', 'col_house_of_saud', 'col_lloyd_s_salvage_co', 'col_malcolm', 'col_rock_rats_miners_union',
  'col_teleoperators', 'col_vatican_observers', 'col_vr_simulcasters', 'col_vr_simulcasters_holo'];
const $ = (s) => document.querySelector(s);
const card = $('#card');

const state = {
  pose: restPose(),
  look: { sex: 'female', skin: '#c9946e', hair: '#2a1a10', hairStyle: 'short', profileHair: 'short', face: 'auto', top: 'tee',
    topColor: '#3a3f4c', sleeves: '', pants: '#2a2e36', shoes: '#22242a', hands: { l: 'relaxed', r: 'relaxed' }, eyesClosed: false, smile: false },
};
let scene = null, marks = null;

// children of each joint, for "drag moves children"
const CHILDREN = {};
for (const [a, b] of Object.values(BONES)) (CHILDREN[a] = CHILDREN[a] || []).push(b);
const subtree = (j) => [j, ...(CHILDREN[j] || []).flatMap(subtree)];

function render() {
  const look = { ...state.look, sleeves: state.look.sleeves || undefined };
  const f = drawFigure({ id: 'fig', pose: state.pose, look, heads });
  const bg = K.linear('bg', [['0%', '#e6eaee'], ['100%', '#8a94a0']], 1, 1);
  let joints = '';
  if ($('#showJoints').checked) {
    for (const [a, b] of Object.values(BONES)) {
      const p = state.pose.joints[a], q = state.pose.joints[b];
      if (p && q) joints += `<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" stroke="#ff5aa0" stroke-width="0.8" opacity="0.7"/>`;
    }
    for (const [k, p] of Object.entries(state.pose.joints)) if (p) joints += `<circle class="joint" data-j="${k}" cx="${p[0]}" cy="${p[1]}" r="3.2" fill="#ff5aa0" stroke="#fff" stroke-width="0.8"><title>${k}</title></circle>`;
  }
  card.innerHTML = `<defs>${bg}${f.defs}</defs><rect width="${W}" height="${H}" fill="url(#bg)"/>${f.svg}<g id="handles">${joints}</g>`;
  $('#json').value = JSON.stringify({ pose: state.pose, look: state.look }, null, 1);
}

// ---- dragging joints ----
let drag = null;
const toCard = (e) => { const r = card.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H]; };
card.addEventListener('pointerdown', (e) => {
  const j = e.target.dataset && e.target.dataset.j;
  if (!j) return;
  card.setPointerCapture(e.pointerId);
  drag = { j, last: toCard(e), set: $('#drag').checked ? subtree(j) : [j] };
});
card.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const p = toCard(e), d = [p[0] - drag.last[0], p[1] - drag.last[1]];
  for (const k of new Set(drag.set)) { const q = state.pose.joints[k]; if (q) state.pose.joints[k] = [q[0] + d[0], q[1] + d[1]]; }
  drag.last = p;
  render();
});
card.addEventListener('pointerup', () => { drag = null; });

// ---- controls ----
function syncControls() {
  $('#yaw').value = state.pose.yaw; $('#headYaw').value = state.pose.headYaw;
  $('#nearArm').value = state.pose.nearArm; $('#nearLeg').value = state.pose.nearLeg;
  for (const el of document.querySelectorAll('[data-look]')) {
    const v = state.look[el.dataset.look];
    if (el.type === 'checkbox') el.checked = !!v; else if (v != null) el.value = v;
  }
  for (const el of document.querySelectorAll('[data-hand]')) el.value = state.look.hands[el.dataset.hand] || 'relaxed';
  $('#visor').checked = !!state.look.visor;
}
for (const el of document.querySelectorAll('[data-look]')) el.addEventListener('input', () => { state.look[el.dataset.look] = el.type === 'checkbox' ? el.checked : el.value; render(); });
for (const el of document.querySelectorAll('[data-hand]')) el.addEventListener('input', () => { state.look.hands[el.dataset.hand] = el.value; render(); });
$('#visor').addEventListener('input', (e) => { state.look.visor = e.target.checked ? ['#f2f8ff', '#8ab0d0'] : undefined; render(); });
for (const id of ['yaw', 'headYaw']) $('#' + id).addEventListener('input', (e) => { state.pose[id] = +e.target.value; render(); });
for (const id of ['nearArm', 'nearLeg']) $('#' + id).addEventListener('input', (e) => { state.pose[id] = e.target.value; render(); });
$('#showJoints').addEventListener('input', render);
$('#reset').addEventListener('click', () => { state.pose = restPose(); syncControls(); render(); });

// load a pose exported from the posed 3D reference
const src = $('#poseSrc');
src.innerHTML = '<option value="">rest pose</option>' + POSES.map((p) => `<option>${p}</option>`).join('');
src.addEventListener('input', async () => {
  if (!src.value) { state.pose = restPose(); syncControls(); render(); return; }
  scene = src.value;
  marks = await (await fetch(`../../scripts/blender/poses/${scene}.json`)).json();
  const figs = [...new Set(Object.keys(marks).map((k) => k.split('.')[0]))];
  $('#fid').innerHTML = figs.map((f) => `<option>${f}</option>`).join('');
  loadFigure(figs[0]);
});
$('#fid').addEventListener('input', (e) => loadFigure(e.target.value));
async function loadFigure(fid) {
  state.pose = poseFromMarks(marks, fid);
  // the scene's own look, if the card build has saved one
  try {
    const saved = await (await fetch(`../../scripts/rig2d/figures/${scene}.${fid}.json`)).json();
    if (saved.look) state.look = { ...state.look, ...saved.look };
    if (saved.pose) state.pose = saved.pose;
  } catch { /* no saved figure yet */ }
  syncControls(); render();
}

// ---- export ----
$('#dlSvg').addEventListener('click', () => {
  const clone = card.cloneNode(true); clone.querySelector('#handles')?.remove();
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('width', W); clone.setAttribute('height', H);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([clone.outerHTML], { type: 'image/svg+xml' }));
  a.download = `${scene || 'figure'}.svg`; a.click();
});
$('#copy').addEventListener('click', () => navigator.clipboard && navigator.clipboard.writeText($('#json').value));
$('#apply').addEventListener('click', () => { try { const j = JSON.parse($('#json').value); state.pose = j.pose || state.pose; state.look = { ...state.look, ...(j.look || {}) }; syncControls(); render(); } catch (e) { alert('Bad JSON: ' + e.message); } });

syncControls();
render();
