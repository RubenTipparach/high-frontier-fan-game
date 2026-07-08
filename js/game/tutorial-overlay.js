// In-game tutorial overlay: Buggy the Rover's guide banner docked under the
// board, driven by the server's tutorial progress (snapshot.state.tutorial.step)
// against the client step copy (tutorial-steps.js). Also renders the
// wrong-step modal when the engine rails reject an off-step op.
//
// Pure DOM, no game-state coupling: browse.js calls syncTutorialOverlay(state)
// on each snapshot and showTutorialWrongStep(detail) on a tutorial_wrong_step
// rejection. All gated by the caller on state.tutorial, so a normal game never
// mounts any of this.

import { buggySvg } from './buggy.js';
import { TUTORIAL_STEPS, tutorialStepAt } from './tutorial-steps.js';

let _el = null;
let _lastStep = -1;
let _lastDone = null;

function ensureBanner() {
  if (_el && document.body.contains(_el)) return _el;
  _el = document.createElement('div');
  _el.className = 'tut-overlay';
  _el.innerHTML = `
    <div class="tut-buggy"></div>
    <div class="tut-body">
      <div class="tut-top"><span class="tut-step"></span></div>
      <div class="tut-title"></div>
      <div class="tut-instr"></div>
    </div>
    <button type="button" class="tut-cta">Show me</button>`;
  _el.querySelector('.tut-cta').addEventListener('click', onShowMe);
  document.body.appendChild(_el);
  return _el;
}

let _target = null;
function onShowMe() {
  // Flash the control the current step points at, if it's on screen. Controls
  // opt in with data-tut-target="<key>"; missing targets just no-op (the banner
  // copy still tells the player what to do).
  if (!_target) return;
  const node = document.querySelector(`[data-tut-target="${_target}"]`);
  if (!node) return;
  node.classList.remove('tut-pulse');
  // reflow so the animation restarts even on a repeat tap
  void node.offsetWidth;
  node.classList.add('tut-pulse');
  node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  setTimeout(() => node.classList.remove('tut-pulse'), 2400);
}

// Update the banner from a game state. No-op if the state carries no tutorial.
export function syncTutorialOverlay(state) {
  const t = state && state.tutorial;
  if (!t) { removeTutorialOverlay(); return; }
  const el = ensureBanner();
  const done = !!t.done;
  const idx = done ? TUTORIAL_STEPS.length - 1 : (t.step | 0);
  if (idx === _lastStep && done === _lastDone) return;   // nothing changed
  _lastStep = idx; _lastDone = done;
  const step = tutorialStepAt(idx) || TUTORIAL_STEPS[TUTORIAL_STEPS.length - 1];
  _target = done ? null : step.target;
  el.classList.toggle('is-done', done);
  el.querySelector('.tut-buggy').innerHTML = buggySvg(done ? 'cheer' : (step.pose || 'point'), { size: 84 });
  el.querySelector('.tut-step').textContent = done
    ? 'Mission complete' : `Step ${idx + 1} / ${TUTORIAL_STEPS.length}`;
  el.querySelector('.tut-title').textContent = done ? 'Well done!' : step.title;
  el.querySelector('.tut-instr').textContent = done
    ? 'You industrialized Deimos and Phobos. You are ready for a real game.'
    : step.instruction;
  const cta = el.querySelector('.tut-cta');
  cta.textContent = done ? 'Done' : 'Show me';
  cta.classList.toggle('is-done', done);
}

export function removeTutorialOverlay() {
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
}
