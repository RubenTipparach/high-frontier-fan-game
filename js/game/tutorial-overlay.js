// In-game tutorial coach: Buggy the Rover floats next to the control the
// current step wants you to use, points at it, and repositions himself so he
// never sits on top of that control (or a modal's action row). Driven by the
// server's tutorial progress (snapshot.state.tutorial.step) against the client
// step copy (tutorial-steps.js). Also renders the wrong-step modal when the
// engine rails reject an off-step op.
//
// Pure DOM, no game-state coupling: browse.js calls syncTutorialOverlay(state)
// on each snapshot and showTutorialWrongStep(detail) on a tutorial_wrong_step
// rejection. All gated by the caller on state.tutorial, so a normal game never
// mounts any of this.

import { buggySvg } from './buggy.js';
import { TUTORIAL_STEPS, tutorialStepAt } from './tutorial-steps.js';
import { toLayoutPx } from '../ui-scale.js';

let _el = null;
let _lastStep = -1;
let _lastDone = null;
let _target = null;         // logical target key of the current step
let _tick = null;           // reposition interval
let _pulsed = null;         // element currently wearing the pulse ring

// Candidate on-screen controls for each logical step target, MOST specific
// first. The coach points at the first one that is visible right now, so a step
// walks the player forward as sub-controls appear: e.g. the auction step points
// at the cart's Buy button, then the "Start auction" button once the confirm
// dialog opens, falling back to the Operations button before either is open.
// A control can also opt in directly with data-tut-target="<key>".
const TARGET_SELECTORS = {
  auction: ['.auction-commit', '.cart-buy-btn', '#turn-end'],
  refuel: ['[data-tut-target="refuel"]', '.ft-op-btn', '#turn-end'],
  move: ['#route-commit', '#turn-tag-move'],
  prospect: ['[data-tut-target="prospect"]', '#turn-end'],
  industrialize: ['[data-tut-target="industrialize"]', '#turn-end'],
  'et-produce': ['[data-tut-target="et-produce"]', '#turn-end'],
  stack: ['#rocket-stack-cards', '[data-tut-target="stack"]'],
};

function isVisible(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const st = getComputedStyle(el);
  if (st.visibility === 'hidden' || st.display === 'none' || +st.opacity === 0) return false;
  return true;
}

// The best on-screen control for a target key: explicit data-tut-target first,
// then the ordered candidate list. null if none is visible.
function resolveTargetEl(key) {
  if (!key) return null;
  const direct = document.querySelector(`[data-tut-target="${key}"]`);
  if (isVisible(direct)) return direct;
  for (const sel of (TARGET_SELECTORS[key] || [])) {
    const el = document.querySelector(sel);
    if (isVisible(el)) return el;
  }
  return null;
}

function ensurePanel() {
  if (_el && document.body.contains(_el)) return _el;
  _el = document.createElement('div');
  _el.className = 'tut-coach';
  _el.innerHTML = `
    <div class="tut-beak"></div>
    <div class="tut-buggy"></div>
    <div class="tut-body">
      <div class="tut-top"><span class="tut-step"></span></div>
      <div class="tut-title"></div>
      <div class="tut-instr"></div>
    </div>`;
  document.body.appendChild(_el);
  return _el;
}

function clearPulse() {
  if (_pulsed) { _pulsed.classList.remove('tut-target-ring'); _pulsed = null; }
}

// Place the coach next to `target`, choosing the side with room and keeping it
// clear of the control itself and (by preferring "above" for low controls) a
// modal's bottom action row. No target -> dock in a safe corner. All geometry
// converts gBCR / innerWidth (VISUAL px under UI zoom) to layout px before it
// becomes a style value, per the js/ui-scale.js coordinate contract.
function positionCoach(target) {
  const el = _el; if (!el) return;
  const s = toLayoutPx;
  const vw = s(window.innerWidth), vh = s(window.innerHeight);
  const pw = el.offsetWidth, ph = el.offsetHeight;   // offset* are already layout px
  const M = 12;                                      // viewport margin
  const GAP = 14;                                    // gap between coach and control

  el.classList.remove('tut-dir-up', 'tut-dir-down', 'tut-dir-left', 'tut-dir-right', 'tut-facing-left', 'tut-docked');

  if (!target) {
    // No control to point at (e.g. assembling the stack): dock bottom-left, out
    // of the way of centre / bottom-right modal buttons.
    el.style.left = M + 'px';
    el.style.top = (vh - ph - M) + 'px';
    el.classList.add('tut-docked');
    clearPulse();
    return;
  }

  const r = target.getBoundingClientRect();
  const tx = s(r.left), ty = s(r.top), tw = s(r.width), th = s(r.height);
  const above = ty, below = vh - (ty + th), left = tx, right = vw - (tx + tw);
  const lowHalf = (ty + th / 2) > vh * 0.6;          // control sits low (modal action row)

  let dir, lft, top;
  const fitV = (space) => space >= ph + GAP + M;
  if (lowHalf && fitV(above)) { dir = 'down'; }      // coach above, points down at a low control
  else if (fitV(below)) { dir = 'up'; }              // coach below, points up
  else if (fitV(above)) { dir = 'down'; }
  else if (right >= pw + GAP + M) { dir = 'left'; }  // coach right, points left
  else { dir = 'right'; }                            // coach left, points right

  const clampX = (x) => Math.max(M, Math.min(x, vw - pw - M));
  const clampY = (y) => Math.max(M, Math.min(y, vh - ph - M));
  const cx = tx + tw / 2 - pw / 2;                   // horizontally centre on control
  const cy = ty + th / 2 - ph / 2;

  if (dir === 'up')    { top = ty + th + GAP;      lft = clampX(cx); }
  else if (dir === 'down') { top = ty - ph - GAP;  lft = clampX(cx); }
  else if (dir === 'left') { lft = tx + tw + GAP;  top = clampY(cy); }
  else                 { lft = tx - pw - GAP;      top = clampY(cy); }

  el.style.left = clampX(lft) + 'px';
  el.style.top = clampY(top) + 'px';
  el.classList.add('tut-dir-' + dir);
  if (dir === 'right') el.classList.add('tut-facing-left');   // face Buggy toward the control

  // Persistent highlight ring on the pointed-at control.
  if (_pulsed !== target) { clearPulse(); _pulsed = target; target.classList.add('tut-target-ring'); }
}

function reposition() {
  if (!_el) return;
  // _target is null on the done step, so this docks the celebrating coach in the
  // safe corner instead of leaving it pointing at a now-irrelevant control.
  positionCoach(resolveTargetEl(_target));
}

// Update the coach from a game state. No-op if the state carries no tutorial.
export function syncTutorialOverlay(state) {
  const t = state && state.tutorial;
  if (!t) { removeTutorialOverlay(); return; }
  const el = ensurePanel();
  const done = !!t.done;
  const idx = done ? TUTORIAL_STEPS.length - 1 : (t.step | 0);
  const stepChanged = idx !== _lastStep || done !== _lastDone;
  if (stepChanged) {
    _lastStep = idx; _lastDone = done;
    const step = tutorialStepAt(idx) || TUTORIAL_STEPS[TUTORIAL_STEPS.length - 1];
    _target = done ? null : step.target;
    el.classList.toggle('is-done', done);
    el.querySelector('.tut-buggy').innerHTML = buggySvg(done ? 'cheer' : (step.pose || 'point'), { size: 66 });
    el.querySelector('.tut-step').textContent = done
      ? 'Mission complete' : `Step ${idx + 1} / ${TUTORIAL_STEPS.length}`;
    el.querySelector('.tut-title').textContent = done ? 'Well done!' : step.title;
    el.querySelector('.tut-instr').textContent = done
      ? 'You industrialized Deimos and Phobos. You are ready for a real game.'
      : step.instruction;
    if (done) clearPulse();
  }
  reposition();
  if (!_tick) {
    // Track controls that appear later (menus / modals open, the map pans): the
    // coach re-anchors to the best visible target a few times a second.
    _tick = setInterval(reposition, 350);
    window.addEventListener('resize', reposition, { passive: true });
    window.addEventListener('scroll', reposition, { passive: true, capture: true });
  }
}

export function removeTutorialOverlay() {
  if (_tick) { clearInterval(_tick); _tick = null; }
  window.removeEventListener('resize', reposition);
  window.removeEventListener('scroll', reposition, { capture: true });
  clearPulse();
  if (_el) { _el.remove(); _el = null; }
  _lastStep = -1; _lastDone = null; _target = null;
}

// The rails rejected an off-step op: pop a modal telling the player what the
// CURRENT step wants. detail = { step, instruction } from the engine.
export function showTutorialWrongStep(detail) {
  document.querySelector('.tut-wrong-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay tut-wrong-overlay';
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const panel = document.createElement('div');
  panel.className = 'turn-confirm-panel tut-wrong-panel';
  const instr = (detail && detail.instruction)
    || 'That is not this step. Follow Buggy to the next move.';
  panel.innerHTML = `
    <div class="tut-wrong-buggy">${buggySvg('point', { size: 76 })}</div>
    <h3>Not yet - here is the next move</h3>
    <p>${instr.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>
    <div class="turn-confirm-actions"><button type="button" class="popup-btn primary" data-act="ok">Got it</button></div>`;
  panel.querySelector('[data-act="ok"]').addEventListener('click', close);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  // After the modal closes the coach should re-point at whatever is on screen.
  setTimeout(reposition, 60);
}
