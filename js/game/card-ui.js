// Game-style card renderer. Builds a DOM element for any of the
// component cards (patents, crew) that follows the published
// card silhouette: name bar across the top, type / role badge,
// content area (thrust triangle for thrusters, body stats for
// everything else), and a footer strip with mass + rad hardness.
//
// Cards are double-sided. The active face is stored as a data
// attribute on the root node; flipping just toggles it. Radiator
// secondaries render rotated 180° so the "stowed" face reads
// upside-down when installed, matching the published convention.
//
// Returned DOM is plain HTML+CSS so it can be embedded in any
// pane / panel. The .card class + variants live in css/cards.css.

export function renderCard(card, { type } = {}) {
  // `type` lets the caller force patent vs crew handling; if
  // omitted we sniff for crew-specific fields.
  const kind = type || (card.faces && card.faces.primary && card.faces.primary.role ? 'crew' : 'patent');
  const el = document.createElement('div');
  el.className = `card kind-${kind}` + (kind === 'patent' ? ` type-${card.type}` : '');
  el.dataset.side = 'primary';
  if (card.flipOrientation === 'rotated180') el.classList.add('flip-rotates');

  el.appendChild(buildFace(card, 'primary', kind));
  if (card.faces && card.faces.secondary) {
    el.appendChild(buildFace(card, 'secondary', kind));
  }

  // Flip control: only show if the card has two faces.
  if (card.faces && card.faces.secondary) {
    const flip = document.createElement('button');
    flip.type = 'button';
    flip.className = 'card-flip';
    flip.textContent = 'Flip';
    flip.addEventListener('click', () => {
      el.dataset.side = el.dataset.side === 'primary' ? 'secondary' : 'primary';
    });
    el.appendChild(flip);
  }

  return el;
}

function buildFace(card, sideName, kind) {
  const face = document.createElement('div');
  face.className = 'card-face';
  face.dataset.face = sideName;

  // Crew: each face is a fully independent crew member; the
  // card-level fields don't carry over.
  if (kind === 'crew') {
    const c = card.faces[sideName];
    face.innerHTML = `
      <div class="card-header">
        <span class="card-role"></span>
        <span class="card-name"></span>
      </div>
      <div class="card-body">
        <p class="card-bonus"></p>
        <p class="card-blurb"></p>
      </div>
      <div class="card-footer">
        <span><em>M</em><strong class="m"></strong></span>
        <span><em>RAD</em><strong class="r"></strong></span>
      </div>
    `;
    face.querySelector('.card-role').textContent = c.role || '';
    face.querySelector('.card-name').textContent = c.name || '';
    face.querySelector('.card-bonus').textContent = c.bonus || '';
    face.querySelector('.card-blurb').textContent = c.blurb || '';
    face.querySelector('.m').textContent = c.mass != null ? c.mass : '—';
    face.querySelector('.r').textContent = c.radHardness != null ? c.radHardness : '—';
    return face;
  }

  // Patent / component card. Card-level fields (mass, radHardness)
  // apply across both faces; face-level only carries an optional
  // label + blurb (and any face-specific overrides set by the
  // engine's modifier composition later).
  const meta = (card.faces && card.faces[sideName]) || {};
  const isThruster = card.type === 'thruster';
  face.innerHTML = `
    <div class="card-header">
      <span class="card-type"></span>
      <span class="card-name"></span>
    </div>
    <div class="card-body">
      ${isThruster ? thrustTriangleSvg(card) : ''}
      <ul class="card-stats"></ul>
      <p class="card-blurb"></p>
    </div>
    <div class="card-footer">
      <span><em>M</em><strong class="m"></strong></span>
      <span><em>RAD</em><strong class="r"></strong></span>
      <span class="face-tag"></span>
    </div>
  `;
  face.querySelector('.card-type').textContent = card.type.toUpperCase();
  face.querySelector('.card-name').textContent = card.name;
  face.querySelector('.m').textContent = card.mass != null ? card.mass : '—';
  face.querySelector('.r').textContent = card.radHardness != null ? card.radHardness : '—';
  face.querySelector('.face-tag').textContent = meta.label || (sideName === 'primary' ? 'A' : 'B');

  // Component-specific stat rows.
  const stats = face.querySelector('.card-stats');
  const add = (k, v) => {
    if (v == null) return;
    const li = document.createElement('li');
    li.innerHTML = `<span></span><strong></strong>`;
    li.querySelector('span').textContent = k;
    li.querySelector('strong').textContent = v;
    stats.appendChild(li);
  };
  if (card.type === 'thruster') {
    add('Thrust', card.thrust);
    add('ISP',    card.isp);
    if (card.power_req) add('Power req', card.power_req);
  } else if (card.type === 'reactor') {
    add('Power', card.power);
    add('Heat',  card.heat);
  } else if (card.type === 'radiator') {
    add('Heat cap', card.heat_cap);
  } else if (card.type === 'refinery') {
    add('Water out', card.water_out);
  } else if (card.type === 'robonaut') {
    add('+Prospect', card.prospect_bonus);
  } else if (card.type === 'lab' || card.type === 'generator') {
    add('Science', card.science);
  } else if (card.type === 'modifier' && card.modifier) {
    const tgt = card.modifier.target === 'any' ? 'Any card' : cap(card.modifier.target);
    add('Attaches to', tgt);
    for (const [k, v] of Object.entries(card.modifier.effect || {})) {
      add('Δ ' + k, (v > 0 ? '+' : '') + v);
    }
  }
  face.querySelector('.card-blurb').textContent = meta.blurb || card.blurb || '';
  return face;
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// Thrust triangle: scales an isoceles triangle by the thruster's
// thrust value so the visual reads "more thrust = bigger triangle"
// at a glance. Matches the published-card convention without
// copying the specific size mapping.
function thrustTriangleSvg(card) {
  const t = Math.max(1, Math.min(15, card.thrust || 1));
  const maxW = 80, maxH = 60;
  const w = (t / 15) * maxW;
  const h = (t / 15) * maxH;
  const cx = maxW / 2;
  const baseY = maxH - 2;
  const topY = baseY - h;
  const leftX = cx - w / 2;
  const rightX = cx + w / 2;
  return `
    <svg class="thrust-triangle" viewBox="0 0 ${maxW} ${maxH}" aria-hidden="true">
      <polygon points="${cx},${topY} ${leftX},${baseY} ${rightX},${baseY}"
        fill="rgba(248,113,113,0.7)" stroke="#fde0ee" stroke-width="1.2"/>
      <text x="${cx}" y="${baseY - 4}" text-anchor="middle"
        font-size="13" font-weight="700" fill="#0c0a16">${card.thrust}</text>
    </svg>
  `;
}
