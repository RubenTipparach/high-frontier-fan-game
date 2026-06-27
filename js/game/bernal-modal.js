// Bernal stack modal (Module 2). A Bernal is a space colony: a physical figure
// (the Kalpana One spindle or the Stanford torus) that carries one Bernal card
// (its lab / ability) and can crawl on dirt fuel as a low-thrust cycler. This
// modal is the colony's "stack" view, the Bernal analogue of the rocket stack
// modal:
//
//   - the colony FIGURE as the hero, with the dirt thrust triangle drawn at 50%
//     on top of it (sign-off 2026-06-27: figure opaque, only the triangle is
//     transparent),
//   - the 10-32 dirt-fuel strip (the same net-thrust node ladder the rocket
//     uses, cropped to a Bernal's mass band), and
//   - a SLOT holding the Bernal card itself (flip it to read the purple Lab
//     back-face).
//
// A Bernal card is not intrinsically Kalpana or Stanford (any Bernal can be
// built on either colony figure), so the modal carries a Kalpana / Stanford
// toggle to preview both figures. When the M2 build mechanic lands it will open
// this modal with the figure the player actually placed.
//
// Pure UI: this only ever renders when M2 is on (the Library gates the trigger
// on isM2()), so it never bleeds into a non-M2 game. It depends only on clean
// data/render modules (no browse.js internals), so it is importable on its own.
import { thrustVisual, renderCard, attachTipsTo } from './card-ui.js';
import { renderBernalNetThrust } from './bernal-net-thrust.js';
import { getBernalSprite } from './bernal-sprite.js';
import { fuelTankCylinderMarkup, setFuelTankLevel } from './fuel-tank-view.js';

const KIND_LABEL = { kalpana: 'KALPANA', stanford: 'STANFORD TORUS' };
const KIND_SUB = { kalpana: 'Kalpana One spindle', stanford: 'Stanford torus' };

// Open the Bernal stack modal as a full overlay (backdrop + Esc + click-out to
// close), mirroring openRocketStackModal. Returns { close, panel }.
export function openBernalStackModal(card, opts = {}) {
  document.querySelector('.bernal-stack-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay bernal-stack-overlay';
  const onKey = (e) => { if (e.key === 'Escape') doClose(); };
  function doClose() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) doClose(); });
  document.addEventListener('keydown', onKey);
  const panel = buildBernalStackPanel(card, { ...opts, onClose: doClose });
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  return { close: doClose, panel };
}

// The Bernal's "fuel tank" view, opened from the WET MASS cell like the rocket
// stack's fuel-tank button. This is the SAME cylinder the rocket fuel-tank modal
// draws (shared js/game/fuel-tank-view.js): dry-mass block at the bottom, the
// fuel level on top, a lift line at the thrust value, capacity ticks. The ONLY
// difference is the strip beside it is the Bernal's dirt ladder (and the
// dirt-scooping controls aren't wired yet, so the controls column is dropped).
//
// Fuel grade: a Bernal crawls on DIRT, and a dirt crawler can ALSO burn water
// (but a water tank can never take on dirt). The tank colours by what's loaded;
// an empty crawler defaults to dirt, the grade you'd scoop next (user 2026-06-27).
export function openBernalFuelTank(opts = {}) {
  document.querySelector('.bernal-tank-overlay')?.remove();
  const overlay = document.createElement('div');
  // Reuse the rocket fuel-tank overlay behaviour: it scrolls when the panel is
  // taller than the viewport (mobile), and layers above the Bernal stack modal.
  overlay.className = 'card-modal-overlay fuel-tank-overlay bernal-tank-overlay';
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);

  const cap = Math.max(1, opts.tankMax || 32);
  const dry = Math.max(0, Math.min(cap, opts.dryMass | 0));
  const tank = Math.max(0, Number(opts.tank) || 0);
  const wet = Math.max(dry, Math.min(cap, Number(opts.wetMass) || dry));
  const thrust = Number.isFinite(opts.thrust) ? opts.thrust : null;
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  // Default to dirt (the crawler grade); honour a loaded grade if the unit
  // tracks one. Water and isotope use the rocket's shared grade colouring.
  const grade = opts.grade === 'water' || opts.grade === 'isotope' ? opts.grade : 'dirt';
  const isDirt = grade === 'dirt';
  const isIso = grade === 'isotope';
  const fuelWord = isIso ? 'isotope' : (isDirt ? 'dirt' : 'water');
  const titleIcon = isIso ? '🟡' : (isDirt ? '🟤' : '💧');
  const titleWord = isIso ? 'Isotope tank' : (isDirt ? 'Dirt tank' : 'Water tank');

  const panel = document.createElement('div');
  panel.className = 'fuel-tank-panel bernal-tank-panel'
    + (isDirt ? ' is-dirt-fuel' : '') + (isIso ? ' is-isotope-fuel' : '');
  panel.innerHTML = `
    <button type="button" class="modal-x" aria-label="Close (Esc)" title="Close (Esc)">×</button>
    <h2 class="fuel-tank-title">${titleIcon} ${titleWord}</h2>
    <p class="muted fuel-tank-sub">Tap outside or press Esc to close</p>
    <div class="fuel-tank-body">
      <div class="fuel-tank-col fuel-tank-col-stage">
        <div class="fuel-tank-stage">
          ${fuelTankCylinderMarkup()}
          <div class="fuel-tank-readout">
            <div class="fuel-tank-amount">
              <strong class="tank-now">${round2(wet)}</strong>
              <span class="tank-sep">/</span>
              <strong class="tank-cap">${cap}</strong>
            </div>
            <em class="muted">${fuelWord}</em>
          </div>
        </div>
      </div>
      ${buildFuelControlsMarkup(opts.fuelControls, { tank, grade, cap })}
      <div class="fuel-tank-col fuel-tank-col-strip">
        <div class="ntd-title-mini muted">Fuel Strip Track</div>
        <div class="bernal-strip-wrap bernal-tank-strip"></div>
        <div class="fuel-tank-foot muted">
          Wet mass <strong>${round2(wet)}</strong> = dry mass <strong>${dry}</strong>
          + ${fuelWord} <strong>${round2(tank)}</strong>, capped at <strong>${cap}</strong>.
          ${thrust != null ? `The amber line marks the thrust lift level (<strong>${thrust}</strong>).` : ''}
        </div>
        <p class="muted ntt-note">
          A Bernal crawls on dirt: scoop dirt at a site (free Cargo Transfer) to
          fill the tank above the dry mass, up to ${cap} wet mass. A dirt crawler
          can also burn water, but a water tank can never take on dirt.
        </p>
      </div>
    </div>`;
  panel.querySelector('.modal-x').addEventListener('click', close);
  if (opts.fuelControls) panel.classList.add('has-fuel-controls');
  wireFuelControls(panel, opts.fuelControls, { tank, grade });
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  // Static positioning (no fill animation): the shared cylinder draws the
  // dry-block, the level, the lift line, and the ticks. The strip beside it is
  // the Bernal dirt ladder.
  setFuelTankLevel(panel.querySelector('.fuel-tank-svg'), { dryMass: dry, wet, cap, thrust });
  const stripHost = panel.querySelector('.bernal-tank-strip');
  if (stripHost) renderBernalNetThrust(stripHost, { dryMass: dry, wetMass: wet });
  return { close };
}

// Controls column for the Bernal fuel tank (parity with the rocket fuel tank):
// SCOOP dirt at a site, DUMP fuel, and TRANSFER water with a colocated stack.
// `fc` is supplied only for an in-play, my-turn unit (the Library inspect passes
// none, so the tank stays read-only). Grade gates the rows the same way the
// server does: dirt scoops/dumps but can't transfer; water transfers/dumps but
// can't be scooped over; an empty tank can do either.
function buildFuelControlsMarkup(fc, { tank, grade, cap }) {
  if (!fc) return '';
  const gradeNow = tank > 0 ? grade : 'empty';
  const showScoop = fc.canScoop && gradeNow !== 'water';
  const showTransfer = (fc.transfers || []).length > 0 && gradeNow !== 'dirt';
  const showDump = tank > 0;
  const disAttr = fc.myTurn ? '' : 'disabled';
  let html = '<div class="fuel-tank-col fuel-tank-col-controls">';
  // SCOOP dirt
  if (showScoop || (!fc.canScoop && gradeNow !== 'water')) {
    html += `<div class="fuel-tank-aqua">
      <div class="aqua-direction">
        <span class="aqua-direction-label">⛏ Scoop dirt → tank</span>
        <div class="aqua-actions">
          <button type="button" class="popup-btn popup-btn-secondary bn-fuel-scoop" data-amt="1" ${showScoop ? disAttr : 'disabled'}>+1</button>
          <button type="button" class="popup-btn popup-btn-secondary bn-fuel-scoop" data-amt="5" ${showScoop ? disAttr : 'disabled'}>+5</button>
          <button type="button" class="popup-btn bn-fuel-scoop" data-amt="max" ${showScoop ? disAttr : 'disabled'}>Max fill</button>
        </div>
      </div>
      <p class="muted aqua-help">${fc.canScoop
        ? 'Scoop dirt at this site to crawl on. Dirt is free and has no aqua value; it can\'t mix with water.'
        : (fc.scoopReason || 'Park at a site with a factory or an ISRU rig aboard to scoop dirt.')}</p>
    </div>`;
  }
  // AQUA BANK (LEO only): swap the colony's water with the aqua bank 1:1, like
  // the rocket's fuel tank at LEO. A dirt tank can't take water, so gate on grade.
  const showAqua = fc.atLeo && gradeNow !== 'dirt';
  if (showAqua) {
    html += `<div class="fuel-tank-aqua">
      <div class="aqua-row"><span>🏦 Aqua bank</span><strong>${fc.aqua | 0}</strong></div>
      <p class="muted aqua-help">At LEO you can swap aqua between the bank and the colony tank, 1:1, for free.</p>
      <div class="aqua-direction">
        <span class="aqua-direction-label">🏦 Bank → 💧 Tank</span>
        <div class="aqua-actions"><button type="button" class="popup-btn popup-btn-secondary bn-fuel-aqua-fill" ${disAttr}>Fill from bank</button></div>
      </div>
      <div class="aqua-direction aqua-direction-reverse">
        <span class="aqua-direction-label">💧 Tank → 🏦 Bank</span>
        <div class="aqua-actions"><button type="button" class="popup-btn popup-btn-secondary bn-fuel-aqua-cash" ${tank > 0 && grade === 'water' ? disAttr : 'disabled'}>Cash to bank</button></div>
      </div>
    </div>`;
  }
  // TRANSFER water with each colocated stack
  if (showTransfer) {
    for (const t of fc.transfers) {
      html += `<div class="fuel-tank-aqua bn-fuel-xfer" data-target="${t.id}">
        <div class="aqua-row"><span>${t.icon || '💧'} ${t.label}</span></div>
        <div class="aqua-direction">
          <span class="aqua-direction-label">${t.label} → Bernal</span>
          <div class="aqua-actions"><button type="button" class="popup-btn popup-btn-secondary bn-fuel-pull" data-target="${t.id}" ${disAttr}>Pull water</button></div>
        </div>
        <div class="aqua-direction aqua-direction-reverse">
          <span class="aqua-direction-label">Bernal → ${t.label}</span>
          <div class="aqua-actions"><button type="button" class="popup-btn popup-btn-secondary bn-fuel-send" data-target="${t.id}" ${tank > 0 && grade === 'water' ? disAttr : 'disabled'}>Send water</button></div>
        </div>
      </div>`;
    }
  }
  // DUMP (jettison)
  if (showDump) {
    html += `<div class="fuel-tank-actions">
      <div class="aqua-direction aqua-direction-reverse fuel-tank-dump-row">
        <span class="aqua-direction-label">⤓ DUMP</span>
        <div class="aqua-actions">
          <button type="button" class="popup-btn popup-btn-secondary bn-fuel-dump" data-amt="1" ${disAttr}>-1</button>
          <button type="button" class="popup-btn popup-btn-secondary bn-fuel-dump" data-amt="5" ${disAttr}>-5</button>
          <button type="button" class="popup-btn bn-fuel-dump" data-amt="all" ${disAttr}>all</button>
        </div>
      </div>
    </div>`;
  }
  if (!showScoop && !showTransfer && !showDump && !showAqua) {
    html += '<p class="muted aqua-help">Nothing to transfer yet. Scoop dirt at a site, swap aqua at LEO, or park beside a stack to move water.</p>';
  }
  html += '</div>';
  return html;
}

// Wire the fuel-control buttons to the host callbacks. Each button stops the
// overlay click-out, fires the callback, and lets the host reopen the tank with
// fresh stats (so the cylinder + strip repaint after the op resolves).
function wireFuelControls(panel, fc, { tank, grade }) {
  if (!fc) return;
  const amtOf = (el) => { const a = el.dataset.amt; return a === 'max' || a === 'all' ? a : (Number(a) || 1); };
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  panel.querySelectorAll('.bn-fuel-scoop').forEach((b) => b.addEventListener('click', (e) => { stop(e); if (!b.disabled && fc.onScoop) fc.onScoop(amtOf(b)); }));
  panel.querySelectorAll('.bn-fuel-dump').forEach((b) => b.addEventListener('click', (e) => { stop(e); if (!b.disabled && fc.onDump) fc.onDump(amtOf(b)); }));
  panel.querySelectorAll('.bn-fuel-pull').forEach((b) => b.addEventListener('click', (e) => { stop(e); if (!b.disabled && fc.onPull) fc.onPull(b.dataset.target); }));
  panel.querySelectorAll('.bn-fuel-send').forEach((b) => b.addEventListener('click', (e) => { stop(e); if (!b.disabled && fc.onSend) fc.onSend(b.dataset.target); }));
  const aFill = panel.querySelector('.bn-fuel-aqua-fill');
  if (aFill) aFill.addEventListener('click', (e) => { stop(e); if (!aFill.disabled && fc.onAquaFill) fc.onAquaFill(); });
  const aCash = panel.querySelector('.bn-fuel-aqua-cash');
  if (aCash) aCash.addEventListener('click', (e) => { stop(e); if (!aCash.disabled && fc.onAquaCash) fc.onAquaCash(); });
}

// Build just the panel (header + body), so a harness or an embedded host can
// reuse the exact same DOM the overlay shows. opts: { kind, colour, face,
// dryMass, wetMass, onClose }.
export function buildBernalStackPanel(card, opts = {}) {
  const panel = document.createElement('div');
  panel.className = 'bernal-stack-panel';

  let kind = opts.kind === 'stanford' ? 'stanford' : 'kalpana';
  const side = opts.face === 'secondary' ? 'secondary' : 'primary';
  const colour = opts.colour || 'gold';
  // An ANCHORED Bernal is a fixed space station: it does not crawl, so the modal
  // drops the thrust triangle + the dirt-fuel ladder and just shows the figure
  // (the anchored render carries the colony dome). A MOBILE Bernal keeps all the
  // thrust boxes (user 2026-06-27).
  const anchored = !!opts.anchored;
  const face = (card && card.faces && card.faces.primary) || card || {};
  const dryMass = opts.dryMass != null ? opts.dryMass : (face.mass || 10);
  const wetMass = opts.wetMass != null ? opts.wetMass : dryMass;

  // Window-style title bar: colony name on the left (Bernal gold), close on the
  // right. The name is the Bernal card's name (e.g. "GEO Elevator Bernal").
  const header = document.createElement('div');
  header.className = 'modal-header';
  const titleEl = document.createElement('h2');
  titleEl.className = 'modal-title';
  titleEl.textContent = `🏙 ${card && card.name ? card.name : 'Bernal'}`;
  header.appendChild(titleEl);
  const xBtn = document.createElement('button');
  xBtn.type = 'button';
  xBtn.className = 'modal-x';
  xBtn.textContent = '×';
  xBtn.title = 'Close (Esc)';
  xBtn.setAttribute('aria-label', 'Close');
  xBtn.addEventListener('click', () => { if (opts.onClose) opts.onClose(); });
  header.appendChild(xBtn);
  panel.appendChild(header);

  const body = document.createElement('div');
  body.className = 'bernal-stack-body';
  panel.appendChild(body);

  function repaint() {
    body.innerHTML = '';

    // Figure is chosen at CREATION (boost / stack separation), not here, so this
    // is a read-only label - no Kalpana/Stanford toggle (user 2026-06-27).
    const figLabel = document.createElement('div');
    figLabel.className = 'bernal-type-sub';
    figLabel.textContent = `Built on the ${KIND_SUB[kind]}${anchored ? ' · anchored station' : ''}`;
    body.appendChild(figLabel);

    // Hero: the colony figure beside its dirt thrust triangle (both opaque).
    // ANCHORED: just the figure (anchored render, with its colony dome), no
    // triangle. The Bernal CARD itself now lives in the Stack section below.
    const hero = document.createElement('div');
    hero.className = 'bernal-thrust-hero' + (anchored ? ' is-anchored' : '');
    const figImg = document.createElement('img');
    figImg.className = 'bernal-figbg';
    figImg.alt = '';
    figImg.src = getBernalSprite(colour, { kind, anchored }).src;
    hero.appendChild(figImg);
    if (!anchored) {
      const tvHost = document.createElement('div');
      tvHost.className = 'bernal-tv';
      const thrusterCard = opts.thrusterCard || card;
      const thrusterFace = opts.thrusterFace
        || (thrusterCard && thrusterCard.faces && thrusterCard.faces.primary)
        || thrusterCard || {};
      // Hover / tap breakdown on the thrust triangle, like the rocket stack
      // modal. A Bernal crawls on dirt and its active thruster IS the colony
      // card, so the numbers come straight off that card's face (no support
      // chain). (user 2026-06-27)
      const tThr = thrusterFace.thrust, tFuel = thrusterFace.fuel;
      const breakdown = {
        thrust: `Thrust ${tThr != null ? tThr : '-'} (the colony's dirt crawler)`,
        fuel: `Fuel per burn ${tFuel != null ? tFuel : '-'} (dirt steps)`,
      };
      const tv = thrustVisual(thrusterCard || {}, thrusterFace, { breakdown });
      tv.dataset.tip = `${breakdown.thrust}. ${breakdown.fuel}.`;
      tvHost.appendChild(tv);
      attachTipsTo(tv);
      hero.appendChild(tvHost);
    }
    body.appendChild(hero);

    // Stats grid (parity with the rocket stack totals): cards / dry / wet /
    // thrust / fuel / min rad-hard.
    const st = opts.stats;
    if (st) {
      const fmt = (n) => Number.isFinite(n) ? (Math.round(n * 100) / 100) : '-';
      const cell = (label, val, sub) => {
        const c = document.createElement('div');
        c.className = 'bernal-stat';
        c.innerHTML = `<span class="bernal-stat-label">${label}</span>`
          + `<strong class="bernal-stat-val">${val}</strong>`
          + (sub ? `<span class="bernal-stat-sub">${sub}</span>` : '');
        return c;
      };
      const grid = document.createElement('div');
      grid.className = 'bernal-stats-grid';
      grid.appendChild(cell('CARDS', st.cards, 'in stack'));
      grid.appendChild(cell('DRY MASS', fmt(st.dryMass), 'card mass sum'));
      // WET MASS is a button: opens the dirt-tank view, like the rocket stack.
      const tankMax = st.tankMax || 32;
      const wetCell = cell('WET MASS', `${fmt(st.wetMass)}<small>/${tankMax}</small>`, `dry ${fmt(st.dryMass)} + dirt ${fmt(st.tank)}`);
      wetCell.classList.add('bernal-wetmass-cell');
      wetCell.setAttribute('role', 'button');
      wetCell.tabIndex = 0;
      wetCell.dataset.tip = 'Tap to open the dirt-tank view';
      wetCell.title = 'Tap to open the dirt-tank view';
      // In-play units pass an opener that wires the live fuel controls + the
      // refresh-after-op loop (onOpenFuelTank); the Library inspect passes none,
      // so the tank opens read-only.
      const openTank = () => {
        if (typeof opts.onOpenFuelTank === 'function') { opts.onOpenFuelTank(); return; }
        openBernalFuelTank({ dryMass: st.dryMass, wetMass: st.wetMass, tank: st.tank, thrust: st.thrust, tankMax, grade: st.tankGrade });
      };
      wetCell.addEventListener('click', openTank);
      wetCell.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTank(); } });
      grid.appendChild(wetCell);
      if (!anchored) {
        grid.appendChild(cell('THRUST', st.thrust, 'dirt crawler'));
        grid.appendChild(cell('FUEL', st.fuel, 'steps / burn'));
      }
      grid.appendChild(cell('MIN RAD-HARD', st.minRad, 'weakest card'));
      body.appendChild(grid);
    }

    // Dirt-fuel strip (mobile only): rendered at FULL size - the whole modal
    // scrolls if it doesn't fit, no horizontal squish (user 2026-06-27).
    if (!anchored) {
      const stripWrap = document.createElement('div');
      stripWrap.className = 'bernal-strip-wrap';
      body.appendChild(stripWrap);
      renderBernalNetThrust(stripWrap, { dryMass, wetMass });
    }

    // STACK: the Bernal CARD (the colony's top card) followed by its cargo, in a
    // grid - two-up on desktop, ONE per row on a phone (user 2026-06-27). Cargo
    // cards carry the "send to ..." transfer buttons; the colony card does not.
    const cargo = Array.isArray(opts.cargo) ? opts.cargo : [];
    const dests = Array.isArray(opts.transferDests) ? opts.transferDests : [];
    {
      const stackSec = document.createElement('div');
      stackSec.className = 'bernal-cargo-section';
      const h = document.createElement('div');
      h.className = 'bernal-slot-label';
      h.textContent = '\u{1F501} Stack';
      stackSec.appendChild(h);
      const grid = document.createElement('div');
      grid.className = 'bernal-cargo-grid';
      // The Bernal card itself leads the stack (its top card; no transfer row).
      if (card) {
        const selfCell = document.createElement('div');
        selfCell.className = 'bernal-cargo-cell bernal-stack-self';
        selfCell.appendChild(renderCard(card, { face: side }));
        grid.appendChild(selfCell);
      }
      for (const item of cargo) {
        const cell = document.createElement('div');
        cell.className = 'bernal-cargo-cell';
        if (item.card) cell.appendChild(renderCard(item.card, { face: item.face === 'secondary' ? 'secondary' : 'primary' }));
        if (typeof opts.onTransfer === 'function' && dests.length) {
          const btns = document.createElement('div');
          btns.className = 'bernal-cargo-xfer';
          for (const d of dests) {
            const tb = document.createElement('button');
            tb.type = 'button';
            tb.className = 'bernal-stow-btn';
            tb.textContent = `→ ${d.label}`;
            tb.title = `Transfer ${item.card ? item.card.name : 'this card'} to ${d.label}.`;
            tb.addEventListener('click', () => opts.onTransfer(item.id, d.id));
            btns.appendChild(tb);
          }
          cell.appendChild(btns);
        }
        grid.appendChild(cell);
      }
      stackSec.appendChild(grid);
      if (typeof opts.onTransfer === 'function' && !dests.length && cargo.length) {
        const note = document.createElement('div');
        note.className = 'bernal-type-sub';
        note.textContent = 'Park a stack here to transfer cargo.';
        stackSec.appendChild(note);
      }
      body.appendChild(stackSec);
    }

    // In-play units pass action callbacks; the Library inspect view passes none.
    // Each spec: { cb, label, title, disabled }. Built in the order an anchored
    // colony would want them (anchor toggle, then movement / stow). A null cb is
    // skipped, so the host gates an action just by not passing it.
    const actionSpecs = [
      anchored
        ? { cb: opts.onUnanchor, label: '⚓ Unanchor', title: 'Unanchor this Bernal: it becomes a mobile cycler again (free action).' }
        : { cb: opts.onAnchor, label: '⚓ Anchor', title: 'Anchor this Bernal as a fixed space station here and gain its colony ability. Costs your operation.' },
      { cb: opts.onStow, label: '\u{1F4E6} Stow in rocket', title: 'Carry this Bernal inside the rocket. Convert it back to its own stack from the rocket.' },
      { cb: opts.onStowLeo, label: '\u{1F6F0} Stow in LEO', title: 'Park this Bernal in the LEO Stack: it becomes a card there with its cargo.' },
      { cb: opts.onRecall, label: '♻️ Recall to hand', title: 'Recall the Bernal card to your hand. Empty it first (no cargo, no water). The colony leaves the map.' },
    ].filter((a) => typeof a.cb === 'function');
    if (actionSpecs.length) {
      const actions = document.createElement('div');
      actions.className = 'bernal-modal-actions';
      for (const a of actionSpecs) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bernal-stow-btn';
        btn.textContent = a.label;
        if (a.title) btn.title = a.title;
        if (a.disabled) btn.disabled = true;
        btn.addEventListener('click', () => { if (!btn.disabled) a.cb(); });
        actions.appendChild(btn);
      }
      body.appendChild(actions);
    }
  }
  repaint();
  return panel;
}
