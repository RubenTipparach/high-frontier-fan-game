// Rig 2D: pose the colonist-art human rig in the browser, swap its assets, and
// export the figure (SVG, or the pose + look JSON the card build reads).
// Serve the repository root (python3 -m http.server) and open /tools/rig2d/.
import { drawFigure, restPose } from '../../scripts/rig2d/figure.mjs';
import { BONES, fkJoints, aimBone } from '../../scripts/rig2d/rig.mjs';
import { artKit } from '../../scripts/colonist-art-m4-fronts.mjs';
import { poseKit } from '../../scripts/colonist-art-people.mjs';

const W = 300, H = 330;
const K = artKit({ W, H }), PK = poseKit({ W, H });
const heads = { bust: K.bust, profile: PK.profile };
const $ = (s) => document.querySelector(s);
const card = $('#card');

const state = {
  pose: restPose(),
  look: { sex: 'female', skin: '#c9946e', hair: '#2a1a10', hairStyle: 'short', profileHair: 'short', face: 'front', top: 'tee',
    topColor: '#3a3f4c', sleeves: '', pants: '#2a2e36', shoes: '#22242a', hands: { l: 'relaxed', r: 'relaxed' }, eyesClosed: false, smile: false },
};
let scene = 'figure';

// the bone that ENDS at each joint: dragging that joint rotates that bone
const BONE_TO = {};
for (const [b, [, c]] of Object.entries(BONES)) BONE_TO[c] = b;

function render() {
  const look = { ...state.look, sleeves: state.look.sleeves || undefined };
  const f = drawFigure({ id: 'fig', pose: state.pose, look, heads });
  const bg = K.linear('bg', [['0%', '#e6eaee'], ['100%', '#8a94a0']], 1, 1);
  let joints = '';
  if ($('#showJoints').checked) {
    const PJ = fkJoints(state.pose).joints;
    for (const [a, b] of Object.values(BONES)) {
      const p = PJ[a], q = PJ[b];
      if (p && q) joints += `<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" stroke="#ff5aa0" stroke-width="0.8" opacity="0.7"/>`;
    }
    for (const [k, p] of Object.entries(PJ)) if (p && (BONE_TO[k] || k === 'pelvis')) joints += `<circle class="joint" data-j="${k}" cx="${p[0]}" cy="${p[1]}" r="3.2" fill="#ff5aa0" stroke="#fff" stroke-width="0.8"><title>${k}</title></circle>`;
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
  drag = { j };
});
card.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const p = toCard(e);
  if (drag.j === 'pelvis') state.pose.root = p;                       // move the whole figure
  else { const b = BONE_TO[drag.j]; state.pose.rot = { ...state.pose.rot, [b]: aimBone(state.pose, b, p) }; }
  render();
});
card.addEventListener('pointerup', () => { drag = null; });

// ---- controls ----
function syncControls() {
  $('#scale').value = state.pose.scale;
  $('#behindL').checked = (state.pose.armsBehind || []).includes('L'); $('#behindR').checked = (state.pose.armsBehind || []).includes('R');
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
$('#scale').addEventListener('input', (e) => { state.pose.scale = +e.target.value; render(); });
for (const s2 of ['L', 'R']) $('#behind' + s2).addEventListener('input', (e) => { const a = new Set(state.pose.armsBehind || []); e.target.checked ? a.add(s2) : a.delete(s2); state.pose.armsBehind = [...a]; render(); });
$('#showJoints').addEventListener('input', render);
$('#reset').addEventListener('click', () => { state.pose = restPose(); syncControls(); render(); });

// load / save a figure by name (scripts/rig2d/figures/<name>.json)
$('#load').addEventListener('click', async () => {
  scene = $('#name').value || 'figure';
  try { const j = await (await fetch(`../../scripts/rig2d/figures/${scene}.json`)).json(); state.pose = j.pose || state.pose; state.look = { ...state.look, ...(j.look || {}) }; syncControls(); render(); }
  catch { alert('No saved figure called ' + scene); }
});

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
