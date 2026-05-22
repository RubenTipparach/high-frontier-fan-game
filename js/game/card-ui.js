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

// Requirement-kind -> { glyph, label }. Each entry describes the
// icon shown in the requirement row on a card. count is rendered
// next to the glyph (1 -> bare icon; >1 -> icon + "×N").
const REQUIREMENT_VIS = {
  'pulse-generator':  { glyph: '⚡', label: 'Pulse generator' },
  'thermostat':       { glyph: '🌡️', label: 'Thermostat'      },
  'crew-quarters':    { glyph: '👤', label: 'Crew quarters'   },
  'sail':             { glyph: '⛵', label: 'Sail rigging'    },
  'beam-receiver':    { glyph: '☀️',  label: 'Beam receiver'   },
  'push-sat':         { glyph: '🛰️', label: 'Push-sat'        },
  'isru-rig':         { glyph: '🛢️', label: 'ISRU rig'        },
  'aerobrake-shroud': { glyph: '🪂', label: 'Aerobrake'       },
  'spin-grav':        { glyph: '🌀', label: 'Spin gravity'    },
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
      <ul class="card-stats"></ul>
      <div class="card-requires"></div>
      <p class="card-blurb"></p>
    </div>
    <div class="card-footer">
      <span class="card-name"></span>
      <span class="face-tag"></span>
    </div>
  `;
  face.querySelector('.card-typebar').textContent = card.type.toUpperCase();
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

  // Requirements row: icon + ×N for each requirement entry. A
  // count of 1 omits the multiplier so a single-icon row reads as
  // a clean bare glyph.
  const reqHost = face.querySelector('.card-requires');
  const reqs = card.requires || [];
  for (const r of reqs) {
    const vis = REQUIREMENT_VIS[r.kind] || { glyph: '◇', label: r.kind };
    const span = document.createElement('span');
    span.className = 'req';
    span.title = `${vis.label} ×${r.count}`;
    span.innerHTML = `<em></em>${r.count > 1 ? `<b>×${r.count}</b>` : ''}`;
    span.querySelector('em').textContent = vis.glyph;
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
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '-12 -14 24 28');
  svg.setAttribute('class', 'spectral-hex');
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

// Thrust visualisation: fixed-size blue triangle, pink thrust
// circle at the left vertex, water droplet at the right vertex
// with the per-burn fuel cost, arrow in between. If the card
// requires push-sat the satellite glyph appears in the triangle
// centre.
function thrustVisual(card) {
  const wrap = document.createElement('div');
  wrap.className = 'thrust-visual';
  const thrust = card.thrust ?? 0;
  // Fuel cost per burn: simple ceil(thrust / isp). For sail-class
  // cards with absurdly high ISP, render as 0 (free).
  const fuel = card.isp >= 50
    ? 0
    : Math.max(1, Math.ceil(thrust / Math.max(1, card.isp || 1)));
  const hasPushSat = (card.requires || []).some((r) => r.kind === 'push-sat');

  // The arrow + base line use currentColor so they read against
  // either the white primary face or the black secondary face.
  // The water droplet is the 💧 emoji with the fuel cost overlaid
  // (white halo for readability on any platform's emoji palette).
  wrap.innerHTML = `
    <svg viewBox="0 0 140 96" class="thrust-svg">
      <defs>
        <marker id="thrust-arrow" viewBox="0 0 8 8" refX="6" refY="4"
          markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill="currentColor"/>
        </marker>
      </defs>
      <polygon points="70,12 18,86 122,86"
        fill="rgba(96,165,250,0.35)" stroke="#60a5fa" stroke-width="2.5"
        stroke-linejoin="round"/>
      ${hasPushSat ? `<text x="70" y="62" text-anchor="middle"
        font-size="24">🛰️</text>` : ''}
      <line x1="35" y1="86" x2="100" y2="86"
        stroke="currentColor" stroke-width="1.8"
        marker-end="url(#thrust-arrow)"/>
      <circle cx="22" cy="86" r="13" fill="#ec4899" stroke="#fbcfe8" stroke-width="1.5"/>
      <text x="22" y="90" text-anchor="middle" font-size="14"
        font-weight="700" fill="#ffffff">${thrust}</text>
      <text x="116" y="98" text-anchor="middle" font-size="28">💧</text>
      <text x="116" y="93" text-anchor="middle" font-size="11"
        font-weight="700" fill="#0c1d34" stroke="#ffffff"
        stroke-width="2.6" paint-order="stroke">${fuel}</text>
    </svg>
  `;
  return wrap;
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
