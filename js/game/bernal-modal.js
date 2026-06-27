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

    // Figure selector: a Bernal is built on EITHER the Kalpana spindle or the
    // Stanford torus. For an in-play unit (opts.onSelectFigure given) picking a
    // figure COMMITS + locks it - the choice is saved, not a free both-ways
    // preview. The Library inspect view (no callback) just previews both.
    const locked = typeof opts.onSelectFigure === 'function';
    const toggle = document.createElement('div');
    toggle.className = 'bernal-type-toggle';
    for (const k of ['kalpana', 'stanford']) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bernal-type-btn' + (k === kind ? ' active' : '');
      b.textContent = KIND_LABEL[k];
      b.addEventListener('click', () => {
        if (k === kind) return;
        kind = k;
        if (locked) opts.onSelectFigure(k);   // commit + lock to the chosen figure
        repaint();
      });
      toggle.appendChild(b);
    }
    body.appendChild(toggle);

    const sub = document.createElement('div');
    sub.className = 'bernal-type-sub';
    sub.textContent = KIND_SUB[kind] + (locked ? ' · saved' : '');
    body.appendChild(sub);

    // Hero: the colony figure as the fully-opaque background (confined to the
    // thrust triangle's footprint), with the dirt thrust triangle at 50% on top
    // so the figure reads through it. ANCHORED: just the figure (anchored render,
    // with the colony dome), no thrust triangle.
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
      // The hero triangle shows the stack's ACTIVE THRUSTER (user 2026-06-27). A
      // Bernal modal only opens for a standalone Bernal stack (the card is not
      // carried in another ship), so the active thruster IS the Bernal card
      // itself, drawn from its own face: it crawls on dirt (Fuel Type "Dirt" in
      // the card data, so the wedge + droplet come out grey).
      const thrusterCard = opts.thrusterCard || card;
      const thrusterFace = opts.thrusterFace
        || (thrusterCard && thrusterCard.faces && thrusterCard.faces.primary)
        || thrusterCard || {};
      tvHost.appendChild(thrustVisual(thrusterCard || {}, thrusterFace, {}));
      hero.appendChild(tvHost);
    }
    body.appendChild(hero);

    // Dirt-fuel strip: the net-thrust node ladder cropped to a Bernal's 10-32
    // mass band (DRY + WET chits), no thrust-value circles (the triangle above
    // already shows thrust). MOBILE only: an anchored station doesn't move, so it
    // carries no fuel ladder.
    if (!anchored) {
      const stripWrap = document.createElement('div');
      stripWrap.className = 'bernal-strip-wrap';
      body.appendChild(stripWrap);
      renderBernalNetThrust(stripWrap, { dryMass, wetMass });
    }

    // The Bernal card itself, in its slot. Flip it to read the purple Lab face.
    const slot = document.createElement('div');
    slot.className = 'bernal-card-slot';
    const slotLabel = document.createElement('div');
    slotLabel.className = 'bernal-slot-label';
    slotLabel.textContent = 'Bernal card';
    slot.appendChild(slotLabel);
    if (card) {
      // No explicit type, exactly like the Library renders a Bernal: renderCard
      // then styles it kind-patent + type-bernal (the gold header) and honours
      // the side toggle / flip button.
      const cardEl = renderCard(card, { face: side });
      slot.appendChild(cardEl);
    }
    body.appendChild(slot);

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
