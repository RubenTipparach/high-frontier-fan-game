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
import { thrustVisual, renderCard } from './card-ui.js';
import { renderBernalNetThrust } from './bernal-net-thrust.js';
import { getBernalSprite } from './bernal-sprite.js';

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

    // Top row: the Bernal CARD beside its thrust triangle (its active thruster),
    // mirroring the rocket stack modal's card + modified-thrust layout. Pinned to
    // the top of the scroll. On a narrow screen these wrap.
    const top = document.createElement('div');
    top.className = 'bernal-top-row';

    const slot = document.createElement('div');
    slot.className = 'bernal-card-slot';
    if (card) slot.appendChild(renderCard(card, { face: side }));
    top.appendChild(slot);

    // Hero: the colony figure behind its dirt thrust triangle at 50%. ANCHORED:
    // just the figure (anchored render, with the colony dome), no triangle.
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
      tvHost.appendChild(thrustVisual(thrusterCard || {}, thrusterFace, {}));
      hero.appendChild(tvHost);
    }
    top.appendChild(hero);
    body.appendChild(top);

    // Stats grid (parity with the rocket stack modal): cards / dry / wet / thrust
    // / fuel / min rad-hard, computed by the host and passed in via opts.stats.
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
      grid.appendChild(cell('WET MASS', fmt(st.wetMass), `dry ${fmt(st.dryMass)} + dirt ${fmt(st.tank)}`));
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

    // Cargo hold: a Bernal is a full STACK, so cards colocated with it move both
    // ways. This panel shows the colony's own cargo with a "send to ..." button
    // per colocated stack (the reverse direction - loading INTO the Bernal - is
    // done from that other stack's inspector, which lists the Bernal as a dest).
    // opts.cargo = [{ id, face, card }]; opts.transferDests = [{ id, label }].
    const cargo = Array.isArray(opts.cargo) ? opts.cargo : [];
    const dests = Array.isArray(opts.transferDests) ? opts.transferDests : [];
    if (typeof opts.onTransfer === 'function' || cargo.length) {
      const cargoSec = document.createElement('div');
      cargoSec.className = 'bernal-cargo-section';
      const h = document.createElement('div');
      h.className = 'bernal-slot-label';
      h.textContent = cargo.length ? '\u{1F501} Cargo' : '\u{1F501} Cargo (empty)';
      cargoSec.appendChild(h);
      // Two-column card grid (user 2026-06-27): cargo reads like a stack, not a
      // tall single column. Each cell is a card with its "send to ..." buttons.
      const grid = document.createElement('div');
      grid.className = 'bernal-cargo-grid';
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
      cargoSec.appendChild(grid);
      if (typeof opts.onTransfer === 'function' && !dests.length && cargo.length) {
        const note = document.createElement('div');
        note.className = 'bernal-type-sub';
        note.textContent = 'Park a stack here to transfer cargo.';
        cargoSec.appendChild(note);
      }
      body.appendChild(cargoSec);
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
