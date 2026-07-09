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
import { TUTORIAL_STEPS, tutorialStepAt, TUTORIAL_ASSEMBLE_PARTS } from './tutorial-steps.js';
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
const ROCKET_CHIP = '.hand-stack-group[data-stack="rocket"] .hand-stack-chip';
const LEO_CHIP = '.hand-stack-group[data-stack="leo"] .hand-stack-chip';
const TARGET_SELECTORS = {
  // Assemble: point at the LEO stack chip to open it; once the LEO stack modal
  // is open, follow in to its "Send -> Rocket" transfer button.
  'leo-transfer': ['.stack-inspector-xfer-btn[data-dest="rocket"]', LEO_CHIP, '#leo-stack-cards'],
  // The auction overlay's close-lot button (Keep / Sell to @...) is the real
  // "commit" here, so point at it FIRST while a lot is open; before the lot
  // opens, fall back to the Operations / cart controls that start one.
  auction: ['.mp-auction-close .modal-btn.primary', '.auction-commit', '.cart-buy-btn', '#turn-end'],
  boost: ['#hand-boost-commit'],
  // Fuel flow: the fuel-tank refill buttons if the tank view is open, else the
  // wet-mass cell that opens it (rocket stack open), else the rocket chip that
  // opens the stack.
  refuel: ['.ft-op-btn', '.rocket-wetmass-cell', ROCKET_CHIP, '[data-tut-target="refuel"]', '#turn-end'],
  move: ['#route-commit', '#turn-tag-move'],
  // Prospect / industrialize / ET need the rocket stack open first (to set the
  // active prospector), so offer the rocket chip when the site button isn't up.
  prospect: ['[data-tut-target="prospect"]', ROCKET_CHIP, '#turn-end'],
  industrialize: ['[data-tut-target="industrialize"]', '#turn-end'],
  'et-produce': ['[data-tut-target="et-produce"]', '#turn-end'],
  stack: ['#rocket-stack-cards', ROCKET_CHIP, '[data-tut-target="stack"]'],
};

function isVisible(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const st = getComputedStyle(el);
  if (st.visibility === 'hidden' || st.display === 'none' || +st.opacity === 0) return false;
  return true;
}

// Layers that can COVER the base screen: a modal's full-screen backdrop, the
// auction overlay, or the sidepanel (which is a full-screen sheet on mobile).
// When one covers the screen the coach must either point at a control INSIDE it
// (the guide belongs to that layer) or step aside (the guide is for the base
// screen the layer now covers). The coach's own wrong-step modal is excluded.
// NB: the sidepanel COVER on mobile is .sidepanel-content (a fixed, near-full
// -screen sheet), NOT #browse-sidepanel itself (which is only the little tab
// pill). Watch the content sheet; the coversViewport check keeps a desktop
// sidebar (narrow column) from counting.
const MODAL_LAYER_SELECTORS = '.card-modal-overlay, .mp-auction-overlay, .sidepanel-content';
// A layer only counts as "covering" when it actually spans most of the viewport:
// a modal backdrop and the mobile sidepanel do; a desktop sidebar (a narrow
// column) does not, so the coach keeps pointing at base controls on desktop.
function coversViewport(el) {
  const r = el.getBoundingClientRect();
  return r.width >= window.innerWidth * 0.7 && r.height >= window.innerHeight * 0.7;
}
function openModalEl() {
  const all = document.querySelectorAll(MODAL_LAYER_SELECTORS);
  let top = null;
  for (const el of all) {
    if (el.classList.contains('tut-wrong-overlay')) continue;   // the coach's own modal
    if (el.classList.contains('is-minimized')) continue;        // minimized auction = a chip, not a cover
    if (!isVisible(el)) continue;
    if (!coversViewport(el)) continue;
    top = el;   // later in DOM order reads as topmost
  }
  return top;
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
      <div class="tut-checklist" hidden></div>
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

  const finalLeft = clampX(lft);
  const finalTop = clampY(top);
  el.style.left = finalLeft + 'px';
  el.style.top = finalTop + 'px';
  el.classList.add('tut-dir-' + dir);
  if (dir === 'right') el.classList.add('tut-facing-left');   // face Buggy toward the control

  // Point the BEAK at the actual control, not the coach's centre. When the coach
  // is clamped to a screen edge (a target near the corner, e.g. the LEO chip at
  // the far left), a fixed 50% beak floats over a neighbouring control and reads
  // as pointing there instead. Anchor the beak to the target's centre, clamped
  // inside the coach so it never slides off the panel.
  const beakEdge = 14;
  if (dir === 'up' || dir === 'down') {
    const bx = Math.max(beakEdge, Math.min(pw - beakEdge, (tx + tw / 2) - finalLeft));
    el.style.setProperty('--tut-beak-x', bx + 'px');
  } else {
    const by = Math.max(beakEdge, Math.min(ph - beakEdge, (ty + th / 2) - finalTop));
    el.style.setProperty('--tut-beak-y', by + 'px');
  }

  // Persistent highlight ring on the pointed-at control.
  if (_pulsed !== target) { clearPulse(); _pulsed = target; target.classList.add('tut-target-ring'); }
}

// Dock the coach dimmed in a corner clear of a centred modal, pointing at
// nothing. Used when a modal covers the base screen and the current guidance is
// for that base screen (not the modal) - the coach must not block the modal.
function positionAside() {
  const el = _el; if (!el) return;
  el.classList.remove('tut-dir-up', 'tut-dir-down', 'tut-dir-left', 'tut-dir-right', 'tut-facing-left', 'tut-docked');
  el.style.left = '12px';
  el.style.top = '12px';
  clearPulse();
}

function reposition() {
  if (!_el) return;
  // _target is null on the done step, so this docks the celebrating coach in the
  // safe corner instead of leaving it pointing at a now-irrelevant control.
  const target = resolveTargetEl(_target);
  // Modal awareness: if a modal covers the screen and the target we would point
  // at is NOT inside it, the guidance is for the base screen behind the modal -
  // step aside (dim + corner-dock) so the modal is fully visible and usable. If
  // the target IS inside the modal (e.g. the Boost confirm button), the guide
  // belongs to the modal, so point at it normally.
  const modal = openModalEl();
  const aside = !!modal && !(target && modal.contains(target));
  _el.classList.toggle('tut-aside', aside);
  if (aside) positionAside();
  else positionCoach(target);
}

// Update the coach from a game state. No-op if the state carries no tutorial.
let _lastBoostPhase = false;
export function syncTutorialOverlay(state) {
  const t = state && state.tutorial;
  if (!t) { removeTutorialOverlay(); return; }
  const el = ensurePanel();
  const done = !!t.done;
  const idx = done ? TUTORIAL_STEPS.length - 1 : (t.step | 0);
  const step = tutorialStepAt(idx) || TUTORIAL_STEPS[TUTORIAL_STEPS.length - 1];
  // Acquire's BOOST phase: the won part sits in the human's hand, so the next
  // move is boosting it - point Buggy at the BOOST button, not the auction. In a
  // tutorial the hand can only ever hold won rocket parts (no bonus supports,
  // the bait is sold), so "hand is non-empty" IS the signal.
  const bots = t.bots || [];
  const human = ((state && state.players) || []).find((p) => !bots.includes(p.profileId));
  const boostPhase = !done && step.id === 'acquire' && !!human && ((human.hand || []).length > 0);
  const stepChanged = idx !== _lastStep || done !== _lastDone || boostPhase !== _lastBoostPhase;
  if (stepChanged) {
    _lastStep = idx; _lastDone = done; _lastBoostPhase = boostPhase;
    _target = done ? null : (boostPhase ? 'boost' : step.target);
    el.classList.toggle('is-done', done);
    el.querySelector('.tut-buggy').innerHTML = buggySvg(done ? 'cheer' : (step.pose || 'point'), { size: 66 });
    el.querySelector('.tut-step').textContent = done
      ? 'Mission complete' : `Step ${idx + 1} / ${TUTORIAL_STEPS.length}`;
    el.querySelector('.tut-title').textContent = done ? 'Well done!'
      : (boostPhase ? 'Boost your part to LEO' : step.title);
    el.querySelector('.tut-instr').textContent = done
      ? 'You industrialized Deimos and Phobos. You are ready for a real game.'
      : (boostPhase
        ? 'You won it! Open your Hand, tap the card to mark it, then hit BOOST to LEO. Buggy hands you the rest once it reaches orbit.'
        : step.instruction);
    if (done) clearPulse();
  }
  // Live parts checklist for the Assemble step (runs every sync, not just on a
  // step change, so it ticks off each part the moment it lands on the rocket).
  renderAssembleChecklist(el, done ? null : step, human);
  reposition();
  if (!_tick) {
    // Track controls that appear later (menus / modals open, the map pans): the
    // coach re-anchors to the best visible target a few times a second.
    _tick = setInterval(reposition, 350);
    window.addEventListener('resize', reposition, { passive: true });
    window.addEventListener('scroll', reposition, { passive: true, capture: true });
  }
}

// Render the Assemble-step parts checklist into the coach: one row per required
// part, ticked when it is aboard the rocket, with a "N left to load" header. The
// player cannot fly to Deimos until all five are aboard (the rails enforce it),
// so this is the at-a-glance "what is left" the checklist promises. Cleared on
// every other step.
function renderAssembleChecklist(el, step, human) {
  const host = el.querySelector('.tut-checklist');
  if (!host) return;
  if (!step || step.id !== 'assemble') { host.hidden = true; host.innerHTML = ''; return; }
  const stack = (human && human.rocket && human.rocket.stack) || [];
  const ids = new Set(stack.map((s) => String((s && s.id) || s)));
  const rows = TUTORIAL_ASSEMBLE_PARTS.map((p) => {
    const on = ids.has(p.id);
    return `<li class="${on ? 'is-on' : ''}"><span class="tut-check-box">${on ? '✓' : '○'}</span><span>${p.name}</span></li>`;
  }).join('');
  const left = TUTORIAL_ASSEMBLE_PARTS.filter((p) => !ids.has(p.id)).length;
  host.innerHTML = `<div class="tut-check-head">${left
    ? `${left} part${left === 1 ? '' : 's'} still to load onto the rocket`
    : 'All parts aboard - ready to fly to Deimos!'}</div><ul>${rows}</ul>`;
  host.hidden = false;
}

export function removeTutorialOverlay() {
  if (_tick) { clearInterval(_tick); _tick = null; }
  window.removeEventListener('resize', reposition);
  window.removeEventListener('scroll', reposition, { capture: true });
  clearPulse();
  if (_el) { _el.remove(); _el = null; }
  _lastStep = -1; _lastDone = null; _lastBoostPhase = false; _target = null;
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
