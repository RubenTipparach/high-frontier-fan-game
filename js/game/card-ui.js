// Game-style card renderer. Builds a DOM element for any of the
// component cards (patents, crew) that follows the published
// HF4 card silhouette: name bar, stats box (mass + rad), spectral
// hex, content area (thrust visualization for thrusters, type-
// specific for everything else), requirement icons, blurb.
//
// Cards are double-sided. The active face is stored as a data
// attribute on the root node; flipping just toggles it. Radiator
// secondaries render rotated 180° so the "stowed" face reads
// upside-down when installed.

// Spectral type -> { glyph, fill, ink }. Used for the per-card
// spectral hex. Falls back to 'unknown' for anything unmapped.
const SPECTRAL_STYLE = {
  C: { glyph: 'C', fill: '#1f2937', ink: '#e5e7eb' },  // carbonaceous
  S: { glyph: 'S', fill: '#fbbf24', ink: '#1f2937' },  // silicate
  M: { glyph: 'M', fill: '#9ca3af', ink: '#0c0a16' },  // metallic
  V: { glyph: 'V', fill: '#f97316', ink: '#0c0a16' },  // basaltic / volcanic
  B: { glyph: 'B', fill: '#60a5fa', ink: '#0c0a16' },  // alkaline
  D: { glyph: 'D', fill: '#67e8f9', ink: '#0c0a16' },  // icy / cometary
  unknown: { glyph: '?', fill: '#475569', ink: '#e5e7eb' },
};
const SPECTRAL_LABEL = {
  C: 'Carbonaceous',
  S: 'Silicate',
  M: 'Metallic',
  V: 'Basaltic / volcanic',
  B: 'Alkaline',
  D: 'Icy / cometary',
  unknown: 'Unknown',
};

// Requirement-kind -> { glyph, label }. Each entry describes the
// icon shown in the requirement row on a card. count is rendered
// next to the glyph (1 -> bare icon; >1 -> icon + "×N").
// Which card type supplies each requirement kind. Chips for a
// support requirement get the same accent colour as that card
// type's typebar, so a player sees at a glance "this thruster
// needs a purple-card (reactor) in the stack" without reading
// labels. Kinds that aren't supplied by a card type fall
// through to a neutral grey chip.
const REQ_SUPPLIER_TYPE = {
  'reactor-fission':    'reactor',
  'reactor-fusion':     'reactor',
  'reactor-antimatter': 'reactor',
  'reactor-any':        'reactor',
  'gen-radioisotope':   'generator',
  'gen-electric':       'generator',
  'pulse-generator':    'reactor',
  'thermostat':         'radiator',
  'crew-quarters':      'robonaut',
};

const REQUIREMENT_VIS = {
  // Power-source supports. These are the ONLY columns under the
  // spreadsheet's "Support Requirements" banner — operational
  // flags like Solar, Push, ISRU, Air Eater are card properties
  // (rendered separately as badges) rather than stack supports.
  'reactor-fission':    { glyph: 'X',  label: 'Fission reactor'        },
  'reactor-fusion':     { glyph: '∿',  label: 'Fusion reactor'         },
  'reactor-antimatter': { glyph: '💣', label: 'Antimatter reactor'     },
  'reactor-any':        { glyph: '⚛', label: 'Any reactor'             },
  'gen-radioisotope':   { glyph: '⟛', label: 'Radioisotope generator' },
  'gen-electric':       { glyph: 'e',  label: 'Electric generator'     },
  // Legacy / hand-written supports retained so older data still
  // loads cleanly.
  'pulse-generator':    { glyph: '⚡', label: 'Pulse generator'         },
  'thermostat':         { glyph: '🌡️', label: 'Thermostat'             },
  'crew-quarters':      { glyph: '👤', label: 'Crew quarters'          },
  'sail':               { glyph: '⛵', label: 'Sail rigging'           },
  'spin-grav':          { glyph: '💃', label: 'Spin gravity'           },
};

export function renderCard(card, { type } = {}) {
  const kind = type || (card.faces && card.faces.primary && card.faces.primary.role ? 'crew' : 'patent');
  const el = document.createElement('div');
  el.className = `card kind-${kind}` + (kind === 'patent' ? ` type-${card.type}` : '');
  el.dataset.side = 'primary';
  if (card.flipOrientation === 'rotated180') el.classList.add('flip-rotates');

  // Both faces live inside a single .card-inner that rotates as
  // one rigid 3D body. Each face uses backface-visibility:hidden,
  // so only the side facing the viewer is painted.
  const inner = document.createElement('div');
  inner.className = 'card-inner';
  inner.appendChild(buildFace(card, 'primary', kind));
  if (card.faces && card.faces.secondary) {
    inner.appendChild(buildFace(card, 'secondary', kind));
  }
  el.appendChild(inner);

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

  // Radiators carry TWO stat sets per face — Light Side
  // (upright) and Heavy Side (rotated 180°). The rotate button
  // toggles a data-rotated attribute that drives both the
  // CSS rotation transform and the Light↔Heavy stat swap. Only
  // emitted for cards flagged `rotatable: true` (radiators).
  if (card.rotatable) {
    el.dataset.rotated = '0';
    const rot = document.createElement('button');
    rot.type = 'button';
    rot.className = 'card-rotate';
    rot.textContent = '↻';
    rot.title = 'Rotate to heavy side';
    rot.addEventListener('click', () => {
      el.dataset.rotated = el.dataset.rotated === '1' ? '0' : '1';
      rot.title = el.dataset.rotated === '1'
        ? 'Rotate to light side'
        : 'Rotate to heavy side';
    });
    el.appendChild(rot);
  }

  attachTipsTo(el);
  return el;
}

function buildFace(card, sideName, kind) {
  const face = document.createElement('div');
  face.className = 'card-face';
  face.dataset.face = sideName;

  // Crew faces are functionally independent: each face is a
  // complete crew record. Keep the layout simple (header, bonus,
  // blurb, mass/rad/spectral footer).
  if (kind === 'crew') {
    const c = card.faces[sideName];
    face.innerHTML = `
      <div class="card-typebar">CREW</div>
      <div class="card-statbox">
        <span><strong class="m"></strong> MASS</span>
        <span><strong class="r"></strong> RAD</span>
        <span class="card-spectral"></span>
      </div>
      <div class="card-body">
        <h4 class="card-name"></h4>
        <p class="card-role"></p>
        <p class="card-bonus"></p>
        <p class="card-blurb"></p>
      </div>
    `;
    face.querySelector('.card-name').textContent = c.name || '';
    face.querySelector('.card-role').textContent = c.role || '';
    face.querySelector('.card-bonus').textContent = c.bonus || '';
    face.querySelector('.card-blurb').textContent = c.blurb || '';
    face.querySelector('.m').textContent = c.mass != null ? c.mass : '—';
    face.querySelector('.r').textContent = c.radHardness != null ? c.radHardness : '—';
    face.querySelector('.card-spectral').appendChild(spectralHex(c.spectralType || 'C'));
    return face;
  }

  const isThruster = card.type === 'thruster';
  face.innerHTML = `
    <div class="card-typebar"></div>
    <div class="card-statbox">
      <span><strong class="m"></strong> MASS</span>
      <span><strong class="r"></strong> RAD</span>
      <span class="card-spectral"></span>
    </div>
    <div class="card-body">
      ${isThruster ? '<div class="card-thrust"></div>' : ''}
      <div class="card-properties"></div>
      <ul class="card-stats"></ul>
      <div class="card-supports">
        <div class="card-supports-label">Supports</div>
        <div class="card-requires"></div>
      </div>
      <p class="card-blurb"></p>
    </div>
    <div class="card-footer">
      <span class="card-name"></span>
      <span class="face-tag"></span>
    </div>
  `;
  // Per-type icon glyph in the typebar, matched to the
  // published-card iconography (🌡️ thermometer for radiators,
  // etc.). Keeps the "what kind of card am I looking at" read
  // working even when the type label is occluded.
  const TYPE_ICON = {
    thruster: '🚀', reactor: '⚛️', radiator: '🌡️',
    refinery: '⚗️', robonaut: '🤖', generator: '🔋',
  };
  const tbar = face.querySelector('.card-typebar');
  const icon = TYPE_ICON[card.type] || '';
  tbar.textContent = `${icon ? icon + ' ' : ''}${card.type.toUpperCase()}`;
  face.querySelector('.card-name').textContent = card.name;
  face.querySelector('.m').textContent = card.mass != null ? card.mass : '—';
  face.querySelector('.r').textContent = card.radHardness != null ? card.radHardness : '—';
  face.querySelector('.face-tag').textContent =
    (card.faces && card.faces[sideName] && card.faces[sideName].label) ||
    (sideName === 'primary' ? 'A' : 'B');

  face.querySelector('.card-spectral').appendChild(spectralHex(card.spectralType));

  if (isThruster) {
    const thrustHost = face.querySelector('.card-thrust');
    thrustHost.appendChild(thrustVisual(card));
  }

  // Type-specific stat list (everything that doesn't fit in the
  // thrust visual / requirement row).
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
    add('ISP', card.isp);
    add('Fuel', card.fuel);
    if (card.afterburn)  add('Afterburn', '🔥');
  } else if (card.type === 'reactor') {
    add('Power', card.power);
    add('Heat',  card.heat);
  } else if (card.type === 'radiator') {
    // Radiators carry separate Light Side / Heavy Side stat
    // blocks per face. Render both — each wrapped in a small
    // <ul class="side-block"> sub-list — and let CSS toggle
    // which one is visible based on data-rotated. The "Therms"
    // row is the rated heat dissipation for that orientation.
    const sideMeta = card.faces && card.faces[sideName];
    const light = sideMeta && sideMeta.light;
    const heavy = sideMeta && sideMeta.heavy;
    if (light && heavy) {
      const addSide = (cls, label, block) => {
        const wrap = document.createElement('li');
        wrap.className = `side-block ${cls}`;
        wrap.innerHTML = `<header>${label}</header>`
          + `<span>Therms <strong>${block.therms ?? '—'}</strong></span>`
          + `<span>Mass   <strong>${block.mass ?? '—'}</strong></span>`
          + `<span>Rad    <strong>${block.radHardness ?? '—'}</strong></span>`;
        stats.appendChild(wrap);
      };
      addSide('side-light', 'Light side', light);
      addSide('side-heavy', 'Heavy side', heavy);
    } else {
      add('Therms', card.therms ?? card.heat_cap);
    }
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

  // Requirements row: icon + ×N for each requirement entry. A
  // Card-properties row: small badges for the card's per-face
  // capabilities (Push, Solar, Air-Eater, ISRU, Afterburn, Bonus
  // Pivots, Missile, Raygun, Buggy). These are NOT supports —
  // they describe what the card itself does. Each property's
  // glyph + label lives on the data record so we don't repeat
  // the catalogue here.
  const propHost  = face.querySelector('.card-properties');
  const faceMeta  = (card.faces && card.faces[sideName]) || {};
  const propsList = faceMeta.properties || card.properties || [];
  for (const p of propsList) {
    const b = document.createElement('span');
    b.className = 'card-prop';
    b.setAttribute('data-tip', p.value === true ? p.label : `${p.label}: ${p.value}`);
    const count = (typeof p.value === 'number' && p.value > 1)
      ? `<b>×${p.value}</b>` : '';
    b.innerHTML = `<em>${p.glyph}</em>${count}`;
    propHost.appendChild(b);
  }

  // count of 1 omits the multiplier so a single-icon row reads as
  // a clean bare glyph.
  const reqHost = face.querySelector('.card-requires');
  const reqs = card.requires || [];
  for (const r of reqs) {
    const vis = REQUIREMENT_VIS[r.kind] || { glyph: '◇', label: r.kind };
    const span = document.createElement('span');
    span.className = 'req';
    span.setAttribute('data-tip', r.count > 1 ? `${vis.label} ×${r.count}` : vis.label);
    // data-supplier drives the chip's tint colour via cards.css
    // (same palette as the card-typebar of the supplier type).
    const supplier = REQ_SUPPLIER_TYPE[r.kind];
    if (supplier) span.dataset.supplier = supplier;
    let iconHtml;
    if (r.kind === 'beam-receiver')  iconHtml = svgSunChip(16);
    else if (r.kind === 'spin-grav') iconHtml = svgBallerinaChip(16);
    else                             iconHtml = `<em>${vis.glyph}</em>`;
    span.innerHTML = `${iconHtml}${r.count > 1 ? `<b>×${r.count}</b>` : ''}`;
    reqHost.appendChild(span);
  }

  const meta = (card.faces && card.faces[sideName]) || {};
  face.querySelector('.card-blurb').textContent = meta.blurb || card.blurb || '';
  return face;
}

// Small flat-top hex with the spectral letter in the centre.
// Returns an SVG element the caller appends.
function spectralHex(type) {
  const style = SPECTRAL_STYLE[type] || SPECTRAL_STYLE.unknown;
  const label = SPECTRAL_LABEL[type] || SPECTRAL_LABEL.unknown;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '-12 -14 24 28');
  svg.setAttribute('class', 'spectral-hex');
  svg.setAttribute('data-tip', `Spectral type ${style.glyph} — ${label}`);
  // Pointy-top hex so it reads as a gem rather than a planet hex.
  const r = 12;
  const points = [];
  for (let i = 0; i < 6; i++) {
    const t = (i / 6) * Math.PI * 2 - Math.PI / 2;
    points.push(`${(Math.cos(t) * r).toFixed(1)},${(Math.sin(t) * r).toFixed(1)}`);
  }
  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  poly.setAttribute('points', points.join(' '));
  poly.setAttribute('fill', style.fill);
  poly.setAttribute('stroke', '#0c0a16');
  poly.setAttribute('stroke-width', '1.2');
  svg.appendChild(poly);
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', '0');
  text.setAttribute('y', '4');
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('font-size', '12');
  text.setAttribute('font-weight', '700');
  text.setAttribute('fill', style.ink);
  text.textContent = style.glyph;
  svg.appendChild(text);
  return svg;
}

// Hand-drawn sun glyph: filled disc + 8 rays. Returns just the
// shape elements (no wrapper) so callers can drop it into either
// a triangle, a chip, or anywhere else and add their own data-tip.
function svgSunContent(cx, cy, size) {
  const r = size * 0.28;
  const inner = r + size * 0.06;
  const outer = size * 0.46;
  const rays = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const x1 = cx + Math.cos(a) * inner;
    const y1 = cy + Math.sin(a) * inner;
    const x2 = cx + Math.cos(a) * outer;
    const y2 = cy + Math.sin(a) * outer;
    rays.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" `
      + `x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="#fde047" `
      + `stroke-width="1.4" stroke-linecap="round"/>`);
  }
  return rays.join('')
    + `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(2)}" `
    + `fill="#fbbf24" stroke="#f59e0b" stroke-width="0.6"/>`;
}

// Hand-drawn ballerina stick-figure: head + torso + outstretched
// arms + V-spread legs, the published-card "spin gravity" glyph.
// Avoids the 💃 emoji which renders as a balloon-shaped figure
// on several platforms.
function svgBallerinaContent(cx, cy, size) {
  const s = size / 18;
  const headR = 2.0 * s;
  const headY = cy - 6 * s;
  const shoulderY = cy - 3 * s;
  const armSpan = 6 * s;
  const hipY = cy + 2 * s;
  const footSpread = 3.2 * s;
  const footY = cy + 6 * s;
  const stroke = (1.4 * s).toFixed(2);
  return `<g stroke="#ec4899" stroke-width="${stroke}" `
    + `stroke-linecap="round" fill="none">`
    + `<circle cx="${cx}" cy="${headY.toFixed(2)}" r="${headR.toFixed(2)}" `
    + `fill="#ec4899" stroke="#9d174d" stroke-width="0.5"/>`
    + `<line x1="${cx}" y1="${(headY + headR).toFixed(2)}" `
    + `x2="${cx}" y2="${hipY.toFixed(2)}"/>`
    + `<line x1="${(cx - armSpan).toFixed(2)}" y1="${shoulderY.toFixed(2)}" `
    + `x2="${(cx + armSpan).toFixed(2)}" y2="${shoulderY.toFixed(2)}"/>`
    + `<line x1="${cx}" y1="${hipY.toFixed(2)}" `
    + `x2="${(cx - footSpread).toFixed(2)}" y2="${footY.toFixed(2)}"/>`
    + `<line x1="${cx}" y1="${hipY.toFixed(2)}" `
    + `x2="${(cx + footSpread).toFixed(2)}" y2="${footY.toFixed(2)}"/></g>`;
}

// Inline SVG wrapper for use inside HTML chips.
function svgSunChip(size) {
  return `<svg class="req-svg" viewBox="-12 -12 24 24" `
    + `width="${size}" height="${size}">${svgSunContent(0, 0, 22)}</svg>`;
}
function svgBallerinaChip(size) {
  return `<svg class="req-svg" viewBox="-12 -12 24 24" `
    + `width="${size}" height="${size}">${svgBallerinaContent(0, 1, 22)}</svg>`;
}

// Thrust visualisation: rounded blue triangle. The pink thrust
// circle + 💧 fuel droplet sit INSIDE the triangle, in the wider
// lower portion where they fit comfortably above the base.
// Support icons live in a separate supports box outside the
// triangle — they're never drawn here.
function thrustVisual(card) {
  const wrap = document.createElement('div');
  wrap.className = 'thrust-visual';
  const thrust = card.thrust ?? 0;
  // Fuel cost per burn. Published-card sheet stores Fuel
  // Consumption directly, so use `card.fuel` when present.
  // Fall back to the legacy ceil(thrust / isp) derivation for
  // any hand-written card still on the old ISP schema.
  let fuel;
  if (card.fuel != null) {
    fuel = card.fuel;
  } else if (card.isp >= 50) {
    fuel = 0;
  } else {
    fuel = Math.max(1, Math.ceil(thrust / Math.max(1, card.isp || 1)));
  }

  // Rounded-triangle path. Apex at (70,12); base (18,86)–(122,86).
  // Each corner is curved with a small quadratic; tangent points
  // are pre-computed ~10 units along each edge so the silhouette
  // reads as a soft equilateral wedge instead of a sharp pennant.
  const trianglePath = 'M 64.25 20.18 L 23.75 77.82 ' +
    'Q 18 86 28 86 L 112 86 ' +
    'Q 122 86 116.25 77.82 L 75.75 20.18 ' +
    'Q 70 12 64.25 20.18 Z';

  // Pink circle at (50, 72) r=10 and droplet at (88, 79) sit
  // safely inside the triangle: at y≈72 the interior is ~70
  // viewBox-units wide (32 to 108), giving each icon room.
  // The arrow connects them at y=72.
  wrap.innerHTML = `
    <svg viewBox="0 0 140 96" class="thrust-svg">
      <defs>
        <marker id="thrust-arrow" viewBox="0 0 8 8" refX="6" refY="4"
          markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill="currentColor"/>
        </marker>
      </defs>
      <path d="${trianglePath}"
        fill="rgba(96,165,250,0.35)" stroke="#60a5fa" stroke-width="2.5"
        stroke-linejoin="round"/>
      ${card.afterburn ? `<text x="70" y="42" text-anchor="middle"
        font-size="22" data-tip="Afterburn">🔥</text>` : ''}
      <line x1="63" y1="72" x2="76" y2="72"
        stroke="currentColor" stroke-width="1.6"
        marker-end="url(#thrust-arrow)"/>
      <g data-tip="Thrust: ${thrust}">
        <circle cx="50" cy="72" r="10" fill="#ec4899" stroke="#fbcfe8" stroke-width="1.5"/>
        <text x="50" y="76" text-anchor="middle" font-size="13"
          font-weight="700" fill="#ffffff">${thrust}</text>
      </g>
      <g data-tip="Fuel per burn: ${fuel}">
        <text x="88" y="79" text-anchor="middle" font-size="22">💧</text>
        <text x="88" y="75" text-anchor="middle" font-size="10"
          font-weight="700" fill="#0c1d34" stroke="#ffffff"
          stroke-width="2.4" paint-order="stroke">${fuel}</text>
      </g>
    </svg>
  `;
  return wrap;
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// Tooltip layer for card icons. One floating div per page; we
// reuse it across every [data-tip] target. Hover (mouse) shows
// after a small delay so it doesn't flicker on accidental
// crossings; tap (touch) shows immediately and auto-dismisses
// after TIP_HOLD_MS, or when the user taps somewhere else.
const TIP_HOVER_DELAY = 200;
const TIP_HOLD_MS = 2800;
let _tipEl = null;
let _tipTarget = null;
let _tipHideTimer = null;

function ensureTip() {
  if (_tipEl) return _tipEl;
  _tipEl = document.createElement('div');
  _tipEl.className = 'card-tip';
  _tipEl.setAttribute('role', 'tooltip');
  document.body.appendChild(_tipEl);
  document.addEventListener('pointerdown', (e) => {
    if (!_tipTarget) return;
    if (_tipTarget === e.target || _tipTarget.contains(e.target)) return;
    hideTip();
  });
  return _tipEl;
}

function showTip(target, text) {
  const tip = ensureTip();
  tip.textContent = text;
  tip.classList.add('visible');
  // Position above the target; flip below if it'd clip off-screen.
  const r = target.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  let left = r.left + r.width / 2 - t.width / 2;
  let top = r.top - t.height - 8;
  if (top < 8) top = r.bottom + 8;
  left = Math.max(8, Math.min(window.innerWidth - t.width - 8, left));
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
  _tipTarget = target;
  clearTimeout(_tipHideTimer);
}

function hideTip() {
  if (_tipEl) _tipEl.classList.remove('visible');
  _tipTarget = null;
  clearTimeout(_tipHideTimer);
}

// Bind hover + tap tooltip behaviour to every [data-tip]
// descendant of `root`. Safe to call once per card after build.
function attachTipsTo(root) {
  const targets = root.querySelectorAll('[data-tip]');
  for (const el of targets) {
    let hoverTimer = null;
    el.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'touch') return;
      clearTimeout(hoverTimer);
      const text = el.getAttribute('data-tip');
      if (!text) return;
      hoverTimer = setTimeout(() => showTip(el, text), TIP_HOVER_DELAY);
    });
    el.addEventListener('pointerleave', (e) => {
      clearTimeout(hoverTimer);
      if (e.pointerType === 'touch') return;
      hideTip();
    });
    el.addEventListener('click', (e) => {
      const text = el.getAttribute('data-tip');
      if (!text) return;
      showTip(el, text);
      clearTimeout(_tipHideTimer);
      _tipHideTimer = setTimeout(hideTip, TIP_HOLD_MS);
    });
  }
}
