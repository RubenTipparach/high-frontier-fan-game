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
import { fuelTankCylinderMarkup, setFuelTankLevel, fuelTransferSectionMarkup } from './fuel-tank-view.js';

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
              <strong class="tank-now">${round2(tank)}</strong>
              <span class="tank-sep">/</span>
              <strong class="tank-cap">${Math.max(0, cap - dry)}</strong>
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
  wireFuelControls(panel, opts.fuelControls);
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
  const scoopReasonOnly = !fc.canScoop && gradeNow !== 'water';   // shown disabled, with the reason
  const showAqua = fc.atLeo && gradeNow !== 'dirt';
  const showTransfer = (fc.transfers || []).length > 0 && gradeNow !== 'dirt';
  const showDump = tank > 0;
  const myTurn = !!fc.myTurn;
  const water = tank > 0 && grade === 'water';                    // tank holds water (transferable / cashable)
  const sections = [];
  // SCOOP dirt -> tank (+1 / +5 / Max fill), the rocket dirt section's idiom.
  if (showScoop || scoopReasonOnly) {
    const dis = !showScoop || !myTurn;
    sections.push(fuelTransferSectionMarkup({
      rows: [{ label: '⛏ Scoop dirt → tank', act: 'scoop', btns: [
        { amt: '1', text: '+1', disabled: dis }, { amt: '5', text: '+5', disabled: dis }, { amt: 'max', text: 'Max fill', primary: true, disabled: dis } ] }],
      help: fc.canScoop
        ? 'Scoop dirt at this site to crawl on. Dirt is free and has no aqua value; it can\'t mix with water.'
        : (fc.scoopReason || 'Park at a site with a factory or an ISRU rig aboard to scoop dirt.'),
    }));
  }
  // AQUA BANK (LEO): Bank -> Tank (+1/+5/Max fill), Tank -> Bank (-1/-5/Cash out),
  // the rocket fuel-tank aqua section's idiom exactly.
  if (showAqua) {
    sections.push(fuelTransferSectionMarkup({
      icon: '🏦', title: 'Aqua bank', balance: fc.aqua | 0,
      help: 'At LEO you can swap aqua between the bank and the colony tank, 1:1, for free.',
      rows: [
        { label: '🏦 Bank → 💧 Tank', act: 'aquaFill', btns: [
          { amt: '1', text: '+1', disabled: !myTurn }, { amt: '5', text: '+5', disabled: !myTurn }, { amt: 'max', text: 'Max fill', primary: true, disabled: !myTurn } ] },
        { label: '💧 Tank → 🏦 Bank', reverse: true, act: 'aquaCash', btns: [
          { amt: '1', text: '-1', disabled: !water || !myTurn }, { amt: '5', text: '-5', disabled: !water || !myTurn }, { amt: 'all', text: 'Cash out', primary: true, disabled: !water || !myTurn } ] },
      ],
    }));
  }
  // TRANSFER water with each colocated stack: <stack> -> Bernal (+1/+5/Max fill),
  // Bernal -> <stack> (-1/-5/Store all), the rocket outpost section's idiom.
  if (showTransfer) {
    for (const t of fc.transfers) {
      sections.push(fuelTransferSectionMarkup({
        icon: t.icon || '💧', title: t.label,
        rows: [
          { label: `${t.label} → Bernal`, act: `pull:${t.id}`, btns: [
            { amt: '1', text: '+1', disabled: !myTurn }, { amt: '5', text: '+5', disabled: !myTurn }, { amt: 'max', text: 'Max fill', primary: true, disabled: !myTurn } ] },
          { label: `Bernal → ${t.label}`, reverse: true, act: `send:${t.id}`, btns: [
            { amt: '1', text: '-1', disabled: !water || !myTurn }, { amt: '5', text: '-5', disabled: !water || !myTurn }, { amt: 'all', text: 'Store all', primary: true, disabled: !water || !myTurn } ] },
        ],
      }));
    }
  }
  // DUMP (jettison) -1 / -5 / max, the rocket dump row's idiom.
  if (showDump) {
    sections.push(fuelTransferSectionMarkup({
      wrapClass: 'fuel-tank-actions',
      rows: [{ label: '💧⤓ DUMP', reverse: true, act: 'dump', btns: [
        { amt: '1', text: '-1', disabled: !myTurn }, { amt: '5', text: '-5', disabled: !myTurn }, { amt: 'max', text: 'max', primary: true, disabled: !myTurn } ] }],
    }));
  }
  const inner = sections.join('')
    || '<p class="muted aqua-help">Nothing to transfer yet. Scoop dirt at a site, swap aqua at LEO, or park beside a stack to move water.</p>';
  return `<div class="fuel-tank-col fuel-tank-col-controls">${inner}</div>`;
}

// Wire EVERY control button through ONE delegated handler: each carries
// data-fuelact + data-amt (the shared rocket idiom), so the host gets a single
// onFuelAction(act, amt) and reopens the tank with fresh stats after the op.
function wireFuelControls(panel, fc) {
  if (!fc || typeof fc.onFuelAction !== 'function') return;
  panel.querySelectorAll('[data-fuelact]').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (b.disabled) return;
    fc.onFuelAction(b.dataset.fuelact, b.dataset.amt);
  }));
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
      // The triangle now shows NET thrust (base thrust shifted by the wet-mass
      // weight class, like the rocket). Spell that out in the breakdown when the
      // stats carry the base + band, so tapping the pink circle reads "1 = 3 base
      // - 2 TUG weight class" instead of a bare number.
      const st = opts.stats || {};
      const wcMod = Number(st.weightClassMod) || 0;
      const thrustText = (st.baseThrust != null && tThr != null)
        ? `Thrust ${tThr} = ${st.baseThrust} base${wcMod !== 0 ? ` ${wcMod > 0 ? '+' : ''}${wcMod} ${st.weightClass} weight class` : ''} (the colony's dirt crawler)`
        : `Thrust ${tThr != null ? tThr : '-'} (the colony's dirt crawler)`;
      const breakdown = {
        thrust: thrustText,
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
      // WET MASS is a button: opens the fuel-tank view, like the rocket stack.
      // The equation names the loaded grade (a crawler defaults to dirt, but it
      // can also hold water) so "dry + <grade> <tank>" reads truthfully.
      const tankMax = st.tankMax || 32;
      const gradeWord = st.tankGrade === 'water' ? 'water' : st.tankGrade === 'isotope' ? 'isotope' : 'dirt';
      const wetCell = cell('WET MASS', `${fmt(st.wetMass)}<small>/${tankMax}</small>`, `dry ${fmt(st.dryMass)} + ${gradeWord} ${fmt(st.tank)}`);
      wetCell.classList.add('bernal-wetmass-cell');
      wetCell.setAttribute('role', 'button');
      wetCell.tabIndex = 0;
      wetCell.dataset.tip = 'Tap to open the fuel tank: scoop dirt at a site, or fill with water from the aqua bank at LEO';
      wetCell.title = 'Tap to open the fuel tank (dirt at a site, or water from the aqua bank at LEO)';
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
    // grid - two-up on desktop, ONE per row on a phone (user 2026-06-27). Cargo is
    // a read-only preview here; transfers go through the shared stack inspector
    // (the SAME select + send UI the LEO Stack / Outposts use) via onManageCargo.
    const cargo = Array.isArray(opts.cargo) ? opts.cargo : [];
    {
      const stackSec = document.createElement('div');
      stackSec.className = 'bernal-cargo-section';
      const h = document.createElement('div');
      h.className = 'bernal-slot-label';
      h.textContent = '\u{1F501} Stack';
      stackSec.appendChild(h);
      // The Bernal CARD itself leads the SAME card grid as the cargo, read-only:
      // it's just the first cell, with no Select toggle (the colony card can't be
      // transferred out). Built as a .rocket-slot so it sits in the grid exactly
      // like the cargo cards instead of standing apart (user 2026-06-28).
      let leadEl = null;
      if (card) {
        leadEl = document.createElement('div');
        leadEl.className = 'rocket-slot';
        leadEl.appendChild(renderCard(card, { face: side }));
      }
      if (typeof opts.mountTransfer === 'function') {
        // In-play unit: mount the SAME select + send transfer surface the LEO
        // Stack / Outposts use, INLINE here (cargo cards + Send buttons) - not a
        // second modal (user 2026-06-28). The colony card rides as the lead cell.
        const cardsHost = document.createElement('div');
        cardsHost.className = 'rocket-stack-row bernal-cargo-cards';
        const footerHost = document.createElement('div');
        footerHost.className = 'bernal-cargo-transfer';
        stackSec.appendChild(cardsHost);
        stackSec.appendChild(footerHost);
        opts.mountTransfer(cardsHost, footerHost, leadEl);
      } else {
        // Library inspect (no transfer): read-only grid, colony card + cargo.
        const grid = document.createElement('div');
        grid.className = 'rocket-stack-row';
        if (leadEl) grid.appendChild(leadEl);
        for (const item of cargo) {
          const cell = document.createElement('div');
          cell.className = 'rocket-slot';
          if (item.card) cell.appendChild(renderCard(item.card, { face: item.face === 'secondary' ? 'secondary' : 'primary' }));
          grid.appendChild(cell);
        }
        stackSec.appendChild(grid);
      }
      body.appendChild(stackSec);
    }

    // In-play units pass action callbacks; the Library inspect view passes none.
    // Each spec: { cb, label, title, disabled }. Built in the order an anchored
    // colony would want them (anchor toggle, then movement / stow). A null cb is
    // skipped, so the host gates an action just by not passing it.
    const actionSpecs = [
      anchored
        ? { cb: opts.onUnanchor, label: '⚓ Unanchor', title: 'Unanchor this Bernal: it becomes a mobile cycler again (free action). Colonists above the new allowance return to the queue.' }
        : { cb: opts.onAnchor, label: '⚓ Anchor', title: 'Anchor this Bernal as a fixed space station here and gain its colony ability (a colonist berth opens - exomigrate from the Colonists tab when ready). Needs a home orbit or an adjacent fresh factory. Costs your operation.' },
      { cb: opts.onPromoteLab, label: '🟣 Promote to Lab', title: 'Flip this anchored Bernal to its purple Lab side at its promotion colony (a matching colony on an adjacent Dirtside). The Lab ability opens and the colony supports 2 colonists. Costs your operation.' },
      { cb: opts.onNanofacture, label: '🏭 Nanofacture', title: 'The anchored colony prints its own Mobile Factory: decommission a robonaut + refinery from its stack and place a mobile factory cube here. Needs your promoted Freighter; not at a Home Bernal. Costs your operation.' },
      { cb: opts.onBuildHere, label: opts.buildHereLabel || '🏙 Build 2nd Bernal here', title: 'Bernals Building Bernals: move a second Bernal card from your hand into this Home Bernal\'s stack (free action). Free at the GEO Elevator, otherwise 10 aqua.' },
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
