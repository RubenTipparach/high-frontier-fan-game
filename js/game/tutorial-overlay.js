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
  // Fuel flow: the Aqua bank -> Tank +5 / +1 buttons if the water tank is open
  // (resolveTargetEl picks +5 vs +1 by how much water is still needed), else the
  // wet-mass cell that opens the tank (rocket stack open), else the rocket chip
  // that opens the stack.
  refuel: ['#aqua-buy-5', '#aqua-buy-1', '.ft-op-btn', '.rocket-wetmass-cell', ROCKET_CHIP, '[data-tut-target="refuel"]', '#turn-end'],
  // Fly to a site: point at the site itself first (a transparent map marker the
  // camera keeper holds over the destination hex, so the ring pulses on the
  // site), then at the site popup's Plan-move button once the popup opens, then
  // at Save route once a route is drawn.
  move: ['.map-popup .popup-btn-rocket', '#route-commit', '[data-tut-target="tut-focus-site"]', '#turn-tag-move'],
  // fly-phobos phase A ("Load your kit"): point at the Send -> Rocket button once
  // the Deimos outpost stack is open, else the site popup's Open Outpost button,
  // else the ringed Deimos outpost marker to tap. Phase B reuses `move` (now
  // ringing Phobos). This never points at Plan move while the kit is unloaded.
  'load-kit': ['.stack-inspector-xfer-btn[data-dest="rocket"]', '[data-tut-target="outpost-open"]', '[data-tut-target="tut-focus-site"]', '#turn-end'],
  // Prospect / industrialize / ET need the rocket stack open first (to set the
  // active prospector), so offer the rocket chip when the site button isn't up.
  // Prospect: with the rocket stack open, point at the ROBONAUT's "Active
  // prospector" button (MET Steamer at Deimos, the ET-produced robonaut at
  // Phobos) - NOT the crew card's prospector. The tutorial crew is a buggy
  // prospector with ISRU 4, which can't even claim Deimos (ISRU must be <= the
  // site's hydration), so pointing there sends the player down a dead end. Point
  // at the robonaut whether or not it is already active (its button goes disabled
  // once set, but it stays the right card). Then the site's Prospect action; else
  // the rocket chip to open the stack.
  prospect: ['.rocket-activate-prospector[data-prosp-card-type="robonaut"]', '[data-tut-target="prospect"]', ROCKET_CHIP, '#turn-end'],
  industrialize: ['[data-tut-target="industrialize"]', '#turn-end'],
  // ET Produce walks two beats: first the site popup's ET Produce button (opens
  // the produce modal), then the modal's own controls once it is open - the
  // selected card, then the Produce commit button. resolveTargetEl swaps to the
  // in-modal targets whenever the produce modal is up, so the coach follows the
  // player into the modal instead of pointing at the now-covered popup button.
  'et-produce': ['.et-produce-overlay .et-commit', '.et-produce-overlay .et-card-pick.is-selected', '[data-tut-target="et-produce"]', '#turn-end'],
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
// The tutorial fuels the rocket to this much water (mirrors the server's
// TUTORIAL_FUEL_TARGET and the fuel step's copy: "fill ... to 8 water").
const TUTORIAL_FUEL_TARGET = 8;

function resolveTargetEl(key) {
  if (!key) return null;
  const direct = document.querySelector(`[data-tut-target="${key}"]`);
  if (isVisible(direct)) return direct;
  // Fuel step: when the water tank is open, walk the player through the fill -
  // point at +5 while 5 or more water is still needed, then +1 for the last
  // steps up to the target, so the coach follows "tap +5, then +1" live.
  if (key === 'refuel') {
    const now = document.querySelector('.fuel-tank-overlay .tank-now');
    if (isVisible(now)) {
      const have = parseFloat(now.textContent) || 0;
      const need = TUTORIAL_FUEL_TARGET - have;
      const pick = need >= 5 ? '#aqua-buy-5' : (need > 0 ? '#aqua-buy-1' : '#aqua-buy-max');
      const el = document.querySelector(pick);
      if (isVisible(el)) return el;
    }
  }
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
// Returns true when it placed the coach pointing at the target, false when an
// `avoid` rect was given and NO placement keeps the coach clear of it (the
// caller then switches to corner + long-arrow mode). The avoid decision is made
// from the target + avoid geometry only, never from the coach's own live
// (mid-transition) rect - that feedback was what made the corner arrow flicker
// on and off every reposition tick.
function positionCoach(target, avoid, force) {
  const el = _el; if (!el) return true;
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
    return true;
  }

  const r = target.getBoundingClientRect();
  const tx = s(r.left), ty = s(r.top), tw = s(r.width), th = s(r.height);
  const above = ty, below = vh - (ty + th), left = tx, right = vw - (tx + tw);
  const lowHalf = (ty + th / 2) > vh * 0.6;          // control sits low (modal action row)

  const clampX = (x) => Math.max(M, Math.min(x, vw - pw - M));
  const clampY = (y) => Math.max(M, Math.min(y, vh - ph - M));
  const cx = tx + tw / 2 - pw / 2;                   // horizontally centre on control
  const cy = ty + th / 2 - ph / 2;

  // The four candidate placements (coach below / above / right-of / left-of the
  // control) with their unclamped anchor and whether they naturally fit.
  const place = {
    up:    { lft: clampX(cx), top: ty + th + GAP, fit: below >= ph + GAP + M },
    down:  { lft: clampX(cx), top: ty - ph - GAP, fit: above >= ph + GAP + M },
    left:  { lft: tx + tw + GAP, top: clampY(cy),  fit: right >= pw + GAP + M },
    right: { lft: tx - pw - GAP, top: clampY(cy),  fit: left  >= pw + GAP + M },
  };
  // Fraction of the coach that would sit over `avoid` for a candidate.
  const ov = (d) => {
    if (!avoid) return 0;
    const bl = clampX(place[d].lft), bt = clampY(place[d].top);
    const ix = Math.max(0, Math.min(bl + pw, avoid.right) - Math.max(bl, avoid.left));
    const iy = Math.max(0, Math.min(bt + ph, avoid.bottom) - Math.max(bt, avoid.top));
    return (pw * ph) > 0 ? (ix * iy) / (pw * ph) : 0;
  };

  let dir;
  if (avoid) {
    // Point at a control inside a modal: prefer a side that tucks the coach into
    // the empty gutter beside the panel (horizontal first), and only accept a
    // placement that stays clear of the panel.
    dir = ['right', 'left', 'up', 'down'].find((d) => place[d].fit && ov(d) < 0.35);
    if (!dir) {
      // No placement clears the panel. With `force` (desktop: the user does NOT
      // want the long orange arrow, just the coach beside the button), sit to
      // the side of the control with more room - it never covers the control
      // itself, only sits over other modal content, and it is pointer-through.
      // Without force (mobile full-screen sheet) hand back false so the caller
      // draws the corner arrow instead.
      if (!force) return false;
      dir = (left >= right) ? 'right' : 'left';
    }
  } else if (lowHalf && place.down.fit) { dir = 'down'; }  // coach above, points down at a low control
  else if (place.up.fit) { dir = 'up'; }                   // coach below, points up
  else if (place.down.fit) { dir = 'down'; }
  else if (right >= pw + GAP + M) { dir = 'left'; }        // coach right, points left
  else { dir = 'right'; }                                  // coach left, points right

  const finalLeft = clampX(place[dir].lft);
  const finalTop = clampY(place[dir].top);
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
  return true;
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
  const targetInModal = !!(modal && target && modal.contains(target));
  const aside = !!modal && !targetInModal;
  _el.classList.toggle('tut-aside', aside);
  if (aside) { positionAside(); _el.classList.remove('tut-corner'); hideArrow(); return; }

  // Guiding WITHIN a modal (e.g. the auction step's Research Auction button, or
  // the LEO stack's "Send -> Rocket" button): try to tuck the coach into the
  // empty gutter beside the modal's content panel and point the beak at the
  // control. positionCoach makes that decision from the panel + target geometry
  // ONLY (not the coach's own live rect), so it is stable across ticks - the
  // corner arrow no longer flickers on and off. If NO gutter placement stays
  // clear of the panel (a wide, centred modal), it returns false and we fall
  // back to the solid corner dock + long leader arrow.
  const s = toLayoutPx;
  if (targetInModal) {
    const panel = modalPanelOf(modal, target);
    const p = panel.getBoundingClientRect();
    const avoid = { left: s(p.left), top: s(p.top), right: s(p.right), bottom: s(p.bottom) };
    // Desktop (a fine pointer): never draw the long arrow - just dock the coach
    // to the left or right of the button it points at (user 2026-07-10). Only a
    // touch device's full-screen sheet, where nothing fits beside the control,
    // falls back to the corner + arrow.
    const desktop = !!(window.matchMedia && window.matchMedia('(pointer: fine)').matches);
    if (positionCoach(target, avoid, desktop)) {
      _el.classList.remove('tut-corner');
      hideArrow();
    } else {
      positionCorner(target);
    }
    return;
  }
  positionCoach(target);
  _el.classList.remove('tut-corner');
  hideArrow();
}

// Corner + long-arrow mode: dock the coach solid in the upper-right corner
// (upper-left when the target itself lives up-right), then draw a long leader
// arrow from the box to the target - the same line + arrowhead language the
// assembly's law callouts use. The coach stays fully readable and the modal
// stays fully visible; only the thin arrow crosses it.
function positionCorner(target) {
  const el = _el; if (!el) return;
  const s = toLayoutPx;
  const vw = s(window.innerWidth);
  const pw = el.offsetWidth, ph = el.offsetHeight;
  const M = 12;
  const t = target.getBoundingClientRect();
  const tcx = s(t.left + t.width / 2), tcy = s(t.top + t.height / 2);
  // Upper-right unless the target is in the upper-right quadrant already.
  const upRight = !(tcx > vw * 0.55 && tcy < s(window.innerHeight) * 0.45);
  const left = upRight ? (vw - pw - M) : M;
  el.classList.remove('tut-dir-up', 'tut-dir-down', 'tut-dir-left', 'tut-dir-right', 'tut-facing-left', 'tut-docked');
  el.classList.add('tut-corner');
  el.style.left = left + 'px';
  el.style.top = M + 'px';
  // Arrow from the coach's border toward the target, stopping at the target's
  // edge so the arrowhead touches (not covers) the control.
  const box = { x: left, y: M, w: pw, h: ph };
  const from = rectEdgePoint(box, { x: tcx, y: tcy });
  const tBox = { x: s(t.left), y: s(t.top), w: s(t.width), h: s(t.height) };
  const to = rectEdgePoint(tBox, from);
  drawArrow(from, to);
  if (_pulsed !== target) { clearPulse(); _pulsed = target; target.classList.add('tut-target-ring'); }
}

// Where the border of rect {x,y,w,h} meets the segment from its centre to `pt`.
function rectEdgePoint(box, pt) {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const dx = pt.x - cx, dy = pt.y - cy;
  const kx = dx !== 0 ? (box.w / 2) / Math.abs(dx) : Infinity;
  const ky = dy !== 0 ? (box.h / 2) / Math.abs(dy) : Infinity;
  const k = Math.min(kx, ky, 1);
  return { x: cx + dx * k, y: cy + dy * k };
}

// Full-viewport SVG carrying the leader arrow (pointer-events: none, so it can
// never block a tap). Lazily created; hidden whenever no arrow is needed.
let _arrowSvg = null;
function drawArrow(from, to) {
  if (!_arrowSvg || !document.body.contains(_arrowSvg)) {
    _arrowSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    _arrowSvg.setAttribute('class', 'tut-arrow-svg');
    _arrowSvg.innerHTML = `
      <defs><marker id="tut-arrowhead" viewBox="0 0 10 10" refX="8" refY="5"
        markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" fill="#f2812f"/></marker></defs>
      <line marker-end="url(#tut-arrowhead)"/>`;
    document.body.appendChild(_arrowSvg);
  }
  _arrowSvg.style.display = '';
  const line = _arrowSvg.querySelector('line');
  line.setAttribute('x1', from.x); line.setAttribute('y1', from.y);
  line.setAttribute('x2', to.x);   line.setAttribute('y2', to.y);
}
function hideArrow() {
  if (_arrowSvg) _arrowSvg.style.display = 'none';
}

// The modal's visible content panel that holds `target`: walk up from the target
// to the direct child of the modal (a .card-modal-overlay wraps a centred panel,
// so its bounds are the real content, not the full-screen backdrop).
function modalPanelOf(modal, target) {
  let node = target;
  while (node && node.parentElement && node.parentElement !== modal) node = node.parentElement;
  return node || target;
}

// Update the coach from a game state. No-op if the state carries no tutorial.
let _lastBoostPhase = false;
let _lastKitPhase = null;

// Has the tutorial's Phobos kit been loaded onto the rocket? The ET-produced
// robonaut + refinery + generator sit in the Deimos outpost until transferred;
// the kit is loaded once that outpost holds no cards. Mirrors browse.js
// tutorialKitLoaded (kept local so the overlay imports nothing from browse).
function tutKitLoaded(state, human) {
  const h = human || null;
  if (!h) return false;
  const deimos = Object.values(h.outposts || {}).find((o) => o && o.siteId === 'deimos');
  return !(deimos && Array.isArray(deimos.cards) && deimos.cards.length > 0);
}
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
  // fly-phobos runs in two beats: LOAD the Deimos kit onto the rocket, THEN hop
  // to Phobos. 'loading' until the kit is aboard, then 'loaded'. Drives which
  // control Buggy points at (the Deimos outpost vs Phobos) and the copy, and it
  // matches the camera keeper's single-site ring so only one place is lit at a time.
  const kitPhase = (!done && step.id === 'fly-phobos')
    ? (tutKitLoaded(state, human) ? 'loaded' : 'loading') : null;
  const stepChanged = idx !== _lastStep || done !== _lastDone
    || boostPhase !== _lastBoostPhase || kitPhase !== _lastKitPhase;
  if (stepChanged) {
    _lastStep = idx; _lastDone = done; _lastBoostPhase = boostPhase; _lastKitPhase = kitPhase;
    const flyTarget = kitPhase === 'loading' ? 'load-kit' : 'move';
    _target = done ? null : (boostPhase ? 'boost' : (kitPhase ? flyTarget : step.target));
    el.classList.toggle('is-done', done);
    el.querySelector('.tut-buggy').innerHTML = buggySvg(done ? 'cheer' : (step.pose || 'point'), { size: 66 });
    el.querySelector('.tut-step').textContent = done
      ? 'Mission complete' : `Step ${idx + 1} / ${TUTORIAL_STEPS.length}`;
    const title = done ? 'Well done!'
      : (boostPhase ? 'Boost your part to LEO'
        : (kitPhase === 'loading' ? 'Load your Phobos kit'
          : (kitPhase === 'loaded' ? 'Hop to Phobos' : step.title)));
    el.querySelector('.tut-title').textContent = title;
    const instr = done
      ? 'You industrialized Deimos and Phobos. You are ready for a real game.'
      : (boostPhase
        ? 'You won it! Open your Hand, tap the card to mark it, then hit BOOST to LEO. Buggy hands you the rest once it reaches orbit.'
        : (kitPhase === 'loading'
          ? 'Open the Deimos outpost (Outpost A) and Send the robonaut + refinery + generator to your Rocket (a free Cargo Transfer). You cannot leave without the full kit.'
          : (kitPhase === 'loaded'
            ? 'Kit aboard. Now tap Phobos, plan a rocket route, and launch. You will industrialize it once you land.'
            : step.instruction)));
    el.querySelector('.tut-instr').textContent = instr;
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
  if (_arrowSvg) { _arrowSvg.remove(); _arrowSvg = null; }
  if (_el) { _el.remove(); _el = null; }
  _lastStep = -1; _lastDone = null; _lastBoostPhase = false; _lastKitPhase = null; _target = null;
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
