// Rig 2D: the cut-out character kit in the browser. The character stands at rest
// facing you; drag a joint to rotate the bone that ends there (drag the pelvis to
// move it), swap heads, hair, hands and clothes, and export SVG or figure JSON.
// Serve the repository root (python3 -m http.server) and open /tools/rig2d/.
import { drawCutout, restPose, skeleton, skeletonFor, fk, aim, BONES, OPTIONS, DEFAULT_LOOK, POSES } from '../../scripts/rig2d/cutout.mjs';

const W = 300, H = 330;
const $ = (s) => document.querySelector(s);
const card = $('#card');
const state = { pose: restPose(150, 318, 46), look: JSON.parse(JSON.stringify(DEFAULT_LOOK)) };
let scene = 'figure';
const BONE_TO = {};
for (const [b, [, c]] of Object.entries(BONES)) BONE_TO[c] = b;

// look controls, generated from the kit's OPTIONS
const lookBox = $('#look');
const sel = (key, opts) => `<label>${key} <select data-look="${key}">${opts.map((o) => `<option>${o}</option>`).join('')}</select></label>`;
const col = (key) => `<label>${key} <input type="color" data-look="${key}"></label>`;
lookBox.innerHTML = '<legend>Look</legend>' + sel('style', OPTIONS.style) + sel('body', OPTIONS.body) + sel('beard', OPTIONS.beard) + sel('face', OPTIONS.face) + sel('hairStyle', OPTIONS.hairStyle)
  + sel('top', OPTIONS.top) + sel('bottom', OPTIONS.bottom)
  + `<label>left hand <select data-hand="L">${OPTIONS.hand.map((o) => `<option>${o}</option>`).join('')}</select></label>`
  + `<label>right hand <select data-hand="R">${OPTIONS.hand.map((o) => `<option>${o}</option>`).join('')}</select></label>`
  + ['skin', 'hair', 'topColor', 'collar', 'bottomColor', 'shoes'].map(col).join('')
  + '<label>blush <input type="checkbox" data-look="blush"></label>';
$('#preset').innerHTML = Object.keys(POSES).map((p) => `<option>${p}</option>`).join('');

function render() {
  const sk = skeletonFor(state.look);
  const fig = drawCutout({ id: 'fig', look: state.look, pose: state.pose });
  let joints = '';
  if ($('#showJoints').checked) {
    const PJ = fk(sk, state.pose).joints;
    for (const [a, b] of Object.values(BONES)) { const p = PJ[a], q = PJ[b]; joints += `<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" stroke="#ff5aa0" stroke-width="0.8" opacity="0.7"/>`; }
    for (const [k, p] of Object.entries(PJ)) if (BONE_TO[k] || k === 'pelvis') joints += `<circle class="joint" data-j="${k}" cx="${p[0]}" cy="${p[1]}" r="3.2" fill="#ff5aa0" stroke="#fff" stroke-width="0.8"><title>${k}</title></circle>`;
  }
  card.innerHTML = `<rect width="${W}" height="${H}" fill="#c9bab2"/>${fig}<g id="handles">${joints}</g>`;
  $('#json').value = JSON.stringify({ pose: state.pose, look: state.look }, null, 1);
}

let drag = null;
const toCard = (e) => { const r = card.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H]; };
card.addEventListener('pointerdown', (e) => { const j = e.target.dataset && e.target.dataset.j; if (!j) return; card.setPointerCapture(e.pointerId); drag = { j }; });
card.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const p = toCard(e);
  if (drag.j === 'pelvis') state.pose.root = p;
  else { const b = BONE_TO[drag.j]; state.pose.rot = { ...state.pose.rot, [b]: Math.round(aim(skeletonFor(state.look), state.pose, b, p)) }; }
  render();
});
card.addEventListener('pointerup', () => { drag = null; });

function syncControls() {
  $('#scale').value = state.pose.scale;
  for (const s2 of ['L', 'R']) $('#behind' + s2).checked = (state.pose.armsBehind || []).includes(s2);
  for (const el of document.querySelectorAll('[data-look]')) { const v = state.look[el.dataset.look]; if (el.type === 'checkbox') el.checked = !!v; else if (v != null) el.value = v; }
  for (const el of document.querySelectorAll('[data-hand]')) el.value = state.look.hands[el.dataset.hand] || 'relaxed';
}
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.look) { state.look[el.dataset.look] = el.type === 'checkbox' ? el.checked : el.value; render(); }
  else if (el.dataset.hand) { state.look.hands = { ...state.look.hands, [el.dataset.hand]: el.value }; render(); }
});
$('#scale').addEventListener('input', (e) => { state.pose.scale = +e.target.value; render(); });
for (const s2 of ['L', 'R']) $('#behind' + s2).addEventListener('input', (e) => { const a = new Set(state.pose.armsBehind || []); e.target.checked ? a.add(s2) : a.delete(s2); state.pose.armsBehind = [...a]; render(); });
$('#showJoints').addEventListener('input', render);
$('#reset').addEventListener('click', () => { state.pose = { ...state.pose, rot: {}, armsBehind: [] }; syncControls(); render(); });
$('#applyPreset').addEventListener('click', () => { state.pose = { ...state.pose, rot: { ...POSES[$('#preset').value] } }; render(); });
$('#load').addEventListener('click', async () => {
  scene = $('#name').value || 'figure';
  try { const j = await (await fetch(`../../scripts/rig2d/figures/${scene}.json`)).json(); state.pose = j.pose || state.pose; state.look = { ...state.look, ...(j.look || {}) }; syncControls(); render(); }
  catch { alert('No saved figure called ' + scene); }
});
$('#dlSvg').addEventListener('click', () => {
  const clone = card.cloneNode(true); clone.querySelector('#handles')?.remove();
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('width', W); clone.setAttribute('height', H);
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([clone.outerHTML], { type: 'image/svg+xml' })); a.download = `${scene}.svg`; a.click();
});
$('#copy').addEventListener('click', () => navigator.clipboard && navigator.clipboard.writeText($('#json').value));
$('#apply').addEventListener('click', () => { try { const j = JSON.parse($('#json').value); state.pose = j.pose || state.pose; state.look = { ...state.look, ...(j.look || {}) }; syncControls(); render(); } catch (e) { alert('Bad JSON: ' + e.message); } });
syncControls();
render();
