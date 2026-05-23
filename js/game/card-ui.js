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
export const REQ_SUPPLIER_TYPE = {
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

export const REQUIREMENT_VIS = {
  // Power-source supports. These are the ONLY columns under the
  // spreadsheet's "Support Requirements" banner - operational
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

export function renderCard(card, { type, supplied, onSupportClick } = {}) {
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
  inner.appendChild(buildFace(card, 'primary', kind, supplied, { onSupportClick }));
  if (card.faces && card.faces.secondary) {
    inner.appendChild(buildFace(card, 'secondary', kind, supplied, { onSupportClick }));
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

  // Radiators carry TWO stat sets per face - Light Side
  // (upright) and Heavy Side (rotated 180°). The rotate button
  // toggles a data-rotated attribute that drives both the
  // CSS rotation transform and the Light↔Heavy stat swap. Only
  // emitted for cards flagged `rotatable: true` (radiators).
  // Radiators carry a data-rotated attribute on the root so the
  // CSS rotation transform + Light↔Heavy active-side dimming
  // still works. The dedicated rotate (↻) button was removed -
  // the Light(N) / Heavy(N) labels under each half's name now
  // act as the side toggle (see buildRadiatorFace).
  if (card.rotatable) el.dataset.rotated = '0';

  attachTipsTo(el);
  return el;
}

function buildFace(card, sideName, kind, supplied, opts = {}) {
  const face = document.createElement('div');
  face.className = 'card-face';
  face.dataset.face = sideName;

  // Radiators print as mirror-symmetric two-headed cards: each
  // face is really two complete mini-cards stacked, one for the
  // Light Side (upright) and one for the Heavy Side (upside-down
  // so it reads correctly when the whole card is physically
  // flipped 180°). Both halves carry their OWN typebar - and
  // the typebar's leading glyph row is one 🌡 per Therm of THAT
  // side - their own mass + rad-hardness stats, and a name
  // label. The inactive half (driven by data-rotated on the
  // card root) is dimmed.
  if (card.type === 'radiator') {
    return buildRadiatorFace(card, sideName);
  }

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
    face.querySelector('.m').textContent = c.mass != null ? c.mass : '-';
    face.querySelector('.r').textContent = c.radHardness != null ? c.radHardness : '-';
    face.querySelector('.card-spectral').appendChild(spectralHex(c.spectralType || 'C'));
    return face;
  }

  // Show the thrust triangle on any card that carries a thrust
  // value - that includes Missile-type robonauts (the spreadsheet
  // gives them their own Thrust / Fuel / Afterburn under the
  // "Thruster" banner), GW Thrusters, etc.
  const isThruster = card.type === 'thruster' || card.thrust != null;
  face.innerHTML = `
    <div class="card-typebar"></div>
    <div class="card-name-row"><span class="card-name"></span></div>
    <div class="card-statbox">
      <span><strong class="m"></strong> MASS</span>
      <span><strong class="r"></strong> RAD</span>
      <span class="card-spectral"></span>
    </div>
    <div class="card-body">
      ${isThruster ? '<div class="card-thrust"></div>' : '<div class="card-thrust-mod"></div>'}
      <div class="card-properties"></div>
      <ul class="card-stats"></ul>
      <div class="card-supports">
        <div class="card-supports-label">Supports</div>
        <div class="card-requires"></div>
      </div>
      <p class="card-blurb"></p>
    </div>
    <div class="card-footer"></div>
  `;
  // Typebar icon strategy: for cards that SUPPLY support chips
  // (reactors, generators, radiators) show the actual chip
  // glyphs this card supplies - so the player can immediately
  // see which chip-slots on a thruster this card satisfies.
  // For cards that don't supply chips (thrusters, refineries,
  // robonauts) we fall back to a generic type emoji.
  const TYPE_FALLBACK_ICON = {
    thruster: '🚀', refinery: '⚗️', robonaut: '🤖',
  };
  const tbar = face.querySelector('.card-typebar');
  const faceData = (card.faces && card.faces[sideName]) || {};
  const supplies = faceData.supplies || card.supplies || [];
  const supplyGlyphs = supplies
    .map((k) => (REQUIREMENT_VIS[k] || {}).glyph || '')
    .filter(Boolean)
    .join(' ');
  // Robonauts ARE their prospector role - show the missile / raygun
  // / buggy glyph (or stack of glyphs for dual-purpose cards like
  // Helical Railgun which is both missile + raygun on Tier-2)
  // instead of the generic 🤖. Crews aren't robonauts, so they
  // skip this branch and keep their existing icon.
  const ROBONAUT_KIND_GLYPHS = { missile: '🚀', raygun: '🔫', buggy: '🛺' };
  let robonautGlyphs = '';
  if (card.type === 'robonaut') {
    const props = faceData.properties || card.properties || [];
    const active = [];
    for (const key of ['missile', 'raygun', 'buggy']) {
      if (props.some((p) => p.key === key && p.value)) active.push(ROBONAUT_KIND_GLYPHS[key]);
    }
    robonautGlyphs = active.join(' ');
  }
  const fallback = robonautGlyphs || TYPE_FALLBACK_ICON[card.type] || '';
  const lead = supplyGlyphs || fallback;
  tbar.textContent = `${lead ? lead + '  ' : ''}${card.type.toUpperCase()}`;
  // Card name reads from the active face - the dark side carries
  // its own printed name on every HF4 card.
  const faceName = (card.faces && card.faces[sideName] && card.faces[sideName].name);
  face.querySelector('.card-name').textContent = faceName || card.name;
  // The Tier-2 face is a different tech with different numbers,
  // so mass + rad-hardness come from the face data when present.
  const faceMass = (card.faces && card.faces[sideName] && card.faces[sideName].mass);
  const faceRad  = (card.faces && card.faces[sideName] && card.faces[sideName].radHardness);
  const massVal  = (faceMass != null ? faceMass : card.mass);
  const radVal   = (faceRad  != null ? faceRad  : card.radHardness);
  face.querySelector('.m').textContent = massVal != null ? massVal : '-';
  face.querySelector('.r').textContent = radVal != null ? radVal : '-';

  face.querySelector('.card-spectral').appendChild(spectralHex(card.spectralType));

  if (isThruster) {
    const thrustHost = face.querySelector('.card-thrust');
    // Pass the face-specific data so the Tier-2 silhouette
    // reflects that face's own thrust/fuel/afterburn rather
    // than copying the primary face's.
    thrustHost.appendChild(thrustVisual(card, card.faces && card.faces[sideName]));
  } else if (card.faces && card.faces[sideName] &&
             card.faces[sideName].thrustMod != null) {
    // Reactor / generator pairing modifier: smaller black-tinted
    // triangle with a 🔧 wrench corner, showing the thrust +
    // fuel multipliers this card applies to whichever thruster
    // it's stacked with. Reuses the same SVG shape as the
    // normal thruster triangle so the visual idiom carries.
    const host = face.querySelector('.card-thrust-mod');
    if (host) host.appendChild(thrustModVisual(card.faces[sideName]));
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
  // Reach into the active face for stats that vary between
  // Tier-1 (white) and Tier-2 (black). The black side is a
  // genuinely different technology with different numbers.
  const fdata = (card.faces && card.faces[sideName]) || {};
  if (isThruster) {
    add('ISP', fdata.isp ?? card.isp);
    const f = fdata.fuel ?? card.fuel;
    add('Fuel', f != null && !Number.isInteger(f) ? f.toFixed(2) : f);
    add('Thrust', fdata.thrust ?? card.thrust);
    if (fdata.afterburn ?? card.afterburn) add('Afterburn', '🔥');
  } else if (card.type === 'reactor') {
    add('Power', card.power);
    add('Heat',  card.heat);
  } else if (card.type === 'radiator') {
    // Radiator cards are mirror-symmetric - the published HF4
    // card prints the light side at the top (upright) and the
    // heavy side at the bottom (upside-down). Both are always
    // visible; whichever is currently "up" (driven by the
    // rotate button and data-rotated) reads as active and the
    // other half greys out. Therms render as 🌡️ icons rather
    // than a numeric row.
    const sideMeta = card.faces && card.faces[sideName];
    const light = sideMeta && sideMeta.light;
    const heavy = sideMeta && sideMeta.heavy;
    if (light && heavy) {
      const addSide = (cls, label, block) => {
        const wrap = document.createElement('li');
        wrap.className = `side-block ${cls}`;
        const therms = block.therms ?? 0;
        const thermRow = therms > 0
          ? '🌡️'.repeat(Math.min(8, therms))
          : '-';
        wrap.innerHTML = `<header>${label}</header>`
          + `<div class="rad-therms">${thermRow}</div>`
          + `<span>Mass <strong>${block.mass ?? '-'}</strong></span>`
          + `<span>Rad-Hard <strong>${block.radHardness ?? '-'}</strong></span>`;
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
  // Pivots, Missile, Raygun, Buggy). These are NOT supports -
  // they describe what the card itself does. Each property's
  // glyph + label lives on the data record so we don't repeat
  // the catalogue here.
  const propHost  = face.querySelector('.card-properties');
  const faceMeta  = (card.faces && card.faces[sideName]) || {};
  const propsList = faceMeta.properties || card.properties || [];
  for (const p of propsList) {
    const b = document.createElement('span');
    b.className = 'card-prop';
    // ISRU has its own visual treatment: the chip reads as
    // "ISRU: N" text instead of a glyph + counter, since the
    // number IS the rule (site water must be >= this value to
    // refuel or prospect). Tooltip spells out the gating.
    if (p.key === 'isru') {
      b.classList.add('card-prop-isru');
      b.setAttribute(
        'data-tip',
        `ISRU ${p.value}. The site's water (💧) must be ≥ ${p.value} `
        + `to prospect or refuel with this rig. ISRU refuel yield = `
        + `1 + site water - ${p.value} fuel tanks per op.`,
      );
      b.innerHTML = `<strong>ISRU:</strong> <b>${p.value}</b>`;
      propHost.appendChild(b);
      continue;
    }
    b.setAttribute('data-tip', p.value === true ? p.label : `${p.label}: ${p.value}`);
    const count = (typeof p.value === 'number' && p.value > 1)
      ? `<b>×${p.value}</b>` : '';
    b.innerHTML = `<em>${p.glyph}</em>${count}`;
    propHost.appendChild(b);
  }

  // count of 1 omits the multiplier so a single-icon row reads as
  // a clean bare glyph.
  const reqHost = face.querySelector('.card-requires');
  const supportsRow = face.querySelector('.card-supports');
  // Each face carries its own supports - Tier-2 is a different
  // tech with potentially different chip requirements.
  const reqs = (faceData.requires) || card.requires || [];
  // Hide the whole supports row when the card needs nothing - a
  // bare "Supports required" heading over an empty chip row reads
  // as broken on cards like reactors (which supply, not require).
  if (!reqs.length) {
    if (supportsRow) supportsRow.classList.add('is-empty');
  } else {
    // Re-label so the row clearly reads as REQUIRED supports.
    // (Old label was just "Supports", ambiguous against the
    // typebar's "what this card supplies" glyphs.)
    const lab = supportsRow && supportsRow.querySelector('.card-supports-label');
    if (lab) lab.textContent = 'Supports required';
  }
  // Same-supplier supports are OR-alternatives, not AND-required.
  // A refinery that lists X / ∿ / 💣 reactor needs ANY ONE of the
  // three, so we collapse all reactor-* into one OR-chip with
  // the glyphs slash-separated. Generators do the same. Reqs
  // that don't share a supplier (e.g. one reactor + one
  // generator) stay as separate chips - those ARE both needed.
  const groups = new Map();
  const loose = [];
  for (const r of reqs) {
    const supplier = REQ_SUPPLIER_TYPE[r.kind];
    if (!supplier) { loose.push(r); continue; }
    if (!groups.has(supplier)) groups.set(supplier, []);
    groups.get(supplier).push(r);
  }
  // When the caller wires onSupportClick, each chip becomes a
  // tap target that hands back the requirement-kind(s) it covers.
  // OR-groups (e.g. a reactor chip stamped X/∿/💣) carry all
  // member kinds so the library can filter to any-of-the-above.
  const onSupportClick = opts && opts.onSupportClick;
  const makeChip = (visGlyphs, supplier, tip, satisfied, kinds) => {
    const span = document.createElement('span');
    span.className = 'req';
    span.setAttribute('data-tip', satisfied ? `${tip} - satisfied` : tip);
    if (supplier) span.dataset.supplier = supplier;
    if (satisfied) span.classList.add('is-satisfied');
    if (kinds && kinds.length) span.dataset.kinds = kinds.join(',');
    span.innerHTML = visGlyphs;
    if (onSupportClick && kinds && kinds.length) {
      span.classList.add('is-clickable');
      span.setAttribute('role', 'button');
      span.tabIndex = 0;
      span.addEventListener('click', (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        onSupportClick(kinds, { label: tip });
      });
      span.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          onSupportClick(kinds, { label: tip });
        }
      });
    }
    reqHost.appendChild(span);
  };
  for (const [supplier, group] of groups) {
    const parts = group.map((r) => {
      const vis = REQUIREMENT_VIS[r.kind] || { glyph: '◇', label: r.kind };
      const count = r.count > 1 ? `<b>×${r.count}</b>` : '';
      return `<em>${vis.glyph}</em>${count}`;
    });
    const labelParts = group.map((r) =>
      (REQUIREMENT_VIS[r.kind] || { label: r.kind }).label);
    const tip = group.length > 1
      ? `Any of: ${labelParts.join(' / ')}`
      : labelParts[0];
    // OR-group satisfied if ANY member kind is in the supplied set.
    const satisfied = !!supplied && group.some((r) => supplied.has(r.kind));
    const kinds = group.map((r) => r.kind);
    makeChip(parts.join('<span class="req-or">/</span>'), supplier, tip, satisfied, kinds);
  }
  for (const r of loose) {
    const vis = REQUIREMENT_VIS[r.kind] || { glyph: '◇', label: r.kind };
    let iconHtml;
    if (r.kind === 'beam-receiver')  iconHtml = svgSunChip(16);
    else if (r.kind === 'spin-grav') iconHtml = svgBallerinaChip(16);
    else                             iconHtml = `<em>${vis.glyph}</em>`;
    const count = r.count > 1 ? `<b>×${r.count}</b>` : '';
    const satisfied = !!supplied && supplied.has(r.kind);
    makeChip(`${iconHtml}${count}`, null,
      r.count > 1 ? `${vis.label} ×${r.count}` : vis.label,
      satisfied, [r.kind]);
  }

  // Blurb / ability text varies per face. The Tier-2 dark side
  // is a different technology with its own ability description.
  const meta = (card.faces && card.faces[sideName]) || {};
  face.querySelector('.card-blurb').textContent =
    meta.ability || meta.blurb || card.blurb || '';
  return face;
}

// Small flat-top hex with the spectral letter in the centre.
// Returns an SVG element the caller appends.
// Render one face of a radiator card. The face contains two
// stacked "half-cards" - Light Side at the top (upright) and
// Heavy Side at the bottom (rotated 180° via CSS). Each half
// has its own typebar, stat box, and name label so the card
// reads as two complete radiators sharing a physical body, the
// way the published HF4 card prints. data-rotated on the .card
// root dims whichever half is currently inactive.
function buildRadiatorFace(card, sideName) {
  const face = document.createElement('div');
  face.className = 'card-face is-radiator';
  face.dataset.face = sideName;
  if (card.flipOrientation === 'rotated180') face.classList.add('flip-rotates');

  const faceMeta = (card.faces && card.faces[sideName]) || {};
  const light = faceMeta.light || {};
  const heavy = faceMeta.heavy || {};
  const cardName = faceMeta.name || card.name;
  const ability  = faceMeta.ability || '';
  const therms = (n) => n > 0 ? '🌡️'.repeat(Math.min(8, n)) : '';

  // Name sits directly below the typebar so it reads as a
  // banner-and-title pair (matching the published radiator card
  // where "Bubble Membrane" hugs the cyan "Radiator" header).
  // Stats sit below, then ability text fills the remainder of
  // the half.
  const lightT = light.therms || 0;
  const heavyT = heavy.therms || 0;

  // Per-half toggle row: "Light (N) | Heavy (M)" with the
  // currently-active side bolded via CSS rule on the .card
  // root (which carries data-rotated). Tapping either label
  // sets data-rotated accordingly - the rotate (↻) button is
  // gone; these labels are the toggle.
  const toggleHtml = `
    <div class="rad-toggle">
      <button type="button" class="rad-side rad-side-light"
        data-rotated="0">Light (${lightT})</button>
      <span class="rad-sep">|</span>
      <button type="button" class="rad-side rad-side-heavy"
        data-rotated="1">Heavy (${heavyT})</button>
    </div>`;

  const halfHtml = (cls, block, showSpectral) => `
    <div class="rad-half ${cls}">
      <div class="card-typebar">${therms(block.therms || 0)}  RADIATOR</div>
      <div class="card-name-row"><span class="card-name">${escapeText(cardName)}</span></div>
      ${toggleHtml}
      <div class="card-statbox">
        <span><strong>${block.mass ?? '-'}</strong> MASS</span>
        <span><strong>${block.radHardness ?? '-'}</strong> RAD</span>
        ${showSpectral ? '<span class="card-spectral"></span>' : '<span></span>'}
      </div>
      <p class="card-blurb">${escapeText(ability)}</p>
    </div>`;

  face.innerHTML = halfHtml('half-light', light, true)
                 + halfHtml('half-heavy', heavy, false);
  const spec = face.querySelector('.card-spectral');
  if (spec) spec.appendChild(spectralHex(card.spectralType || 'C'));

  // Wire the Light/Heavy toggle buttons to set data-rotated on
  // the .card root. The CSS rules driven by data-rotated handle
  // the visual swap (dimmed inactive half + bold active label).
  face.querySelectorAll('.rad-side').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const cardRoot = face.closest('.card');
      if (cardRoot) cardRoot.dataset.rotated = btn.dataset.rotated;
    });
  });
  return face;
}

// Tiny safe-escape so radiator-card text drops into innerHTML
// without re-introducing the XSS attack surface that text
// content would otherwise prevent.
function escapeText(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function spectralHex(type) {
  const style = SPECTRAL_STYLE[type] || SPECTRAL_STYLE.unknown;
  const label = SPECTRAL_LABEL[type] || SPECTRAL_LABEL.unknown;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  // viewBox swapped to a wider-than-tall box because the hex is
  // now FLAT-TOP (a 30° rotation from the pointy-top default).
  // All hexes use the same black fill regardless of spectral
  // letter - the letter alone reads the type; colour-coding
  // turned out to confuse the read against the saturated
  // typebars sitting next to it.
  svg.setAttribute('viewBox', '-14 -12 28 24');
  svg.setAttribute('class', 'spectral-hex');
  svg.setAttribute('data-tip', `Spectral type ${style.glyph} - ${label}`);
  const r = 12;
  const points = [];
  for (let i = 0; i < 6; i++) {
    // No -π/2 offset → first vertex points right (0°), giving
    // horizontal flats on top + bottom (flat-top hex).
    const t = (i / 6) * Math.PI * 2;
    points.push(`${(Math.cos(t) * r).toFixed(1)},${(Math.sin(t) * r).toFixed(1)}`);
  }
  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  poly.setAttribute('points', points.join(' '));
  poly.setAttribute('fill', '#0c0a16');
  poly.setAttribute('stroke', '#1f1b2e');
  poly.setAttribute('stroke-width', '1.2');
  svg.appendChild(poly);
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', '0');
  text.setAttribute('y', '4');
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('font-size', '12');
  text.setAttribute('font-weight', '700');
  text.setAttribute('fill', '#ffffff');
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
export function svgSunChip(size) {
  return `<svg class="req-svg" viewBox="-12 -12 24 24" `
    + `width="${size}" height="${size}">${svgSunContent(0, 0, 22)}</svg>`;
}
export function svgBallerinaChip(size) {
  return `<svg class="req-svg" viewBox="-12 -12 24 24" `
    + `width="${size}" height="${size}">${svgBallerinaContent(0, 1, 22)}</svg>`;
}

// Thrust visualisation: rounded blue triangle. The pink thrust
// circle + 💧 fuel droplet sit INSIDE the triangle, in the wider
// lower portion where they fit comfortably above the base.
// Support icons live in a separate supports box outside the
// triangle - they're never drawn here.
// Public so callers (rocket-stack modal totals row, hover
// tooltip on the rocket sprite) can render the same triangle
// with overridden numbers - synthesise a face-like object with
// the effective thrust / fuel / afterburn / fuelType values.
// Optional `opts.breakdown` lets callers override the per-element
// data-tip text (used by the rocket-stack headliner so clicks on
// the thrust / fuel / afterburn glyphs surface the full modifier
// math: "11 = 6 base + 3 reactor mod + 2 WISP mass class").
// Shape: { thrust?, fuel?, afterburn? } strings; missing keys
// fall back to the short default text.
export function thrustVisual(card, face, opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'thrust-visual';
  // The Tier-2 face is a different technology with different
  // stats. Prefer face-specific thrust/fuel/afterburn when the
  // caller passes a face block; fall back to top-level fields
  // for legacy hand-written cards that don't carry faces.
  const thrust = (face && face.thrust != null ? face.thrust : card.thrust) ?? 0;
  const rawFuel = face && face.fuel != null ? face.fuel : card.fuel;
  const isp = face && face.isp != null ? face.isp : card.isp;
  // Fuel cost per burn. Published-card sheet stores Fuel
  // Consumption directly, so use the face's fuel when present.
  // Fall back to the legacy ceil(thrust / isp) derivation for
  // any hand-written card still on the old ISP schema. Render
  // fractional values to two decimal places (so 0.33 displays
  // as "0.33" instead of being rounded to "0.3" or "1").
  let fuel;
  if (rawFuel != null) {
    fuel = rawFuel;
  } else if (isp >= 50) {
    fuel = 0;
  } else {
    fuel = Math.max(1, Math.ceil(thrust / Math.max(1, isp || 1)));
  }
  const fuelText = Number.isInteger(fuel) ? `${fuel}` : fuel.toFixed(2);
  // Fuel-type emoji: 💧 for water (the default), 🪨 for dirt /
  // regolith eaters (mass drivers and similar). Driven straight
  // off the spreadsheet's "Fuel Type" column on each face.
  const ftype = (face && face.fuelType) || card.fuelType;
  const fuelEmoji = ftype === 'Dirt' ? '🪨' : '💧';
  const showAfter = (face && face.afterburn) || (!face && card.afterburn);

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
      ${showAfter ? `<text x="70" y="42" text-anchor="middle"
        font-size="22" data-tip="${escapeText(opts.breakdown?.afterburn || 'Afterburn')}">🔥</text>` : ''}
      <line x1="63" y1="72" x2="76" y2="72"
        stroke="currentColor" stroke-width="1.6"
        marker-end="url(#thrust-arrow)"/>
      <g data-tip="${escapeText(opts.breakdown?.thrust || `Thrust: ${thrust}`)}">
        <circle cx="50" cy="72" r="10" fill="#ec4899" stroke="#fbcfe8" stroke-width="1.5"/>
        <text x="50" y="76" text-anchor="middle" font-size="13"
          font-weight="700" fill="#ffffff">${thrust}</text>
      </g>
      <g data-tip="${escapeText(opts.breakdown?.fuel || `Fuel per burn: ${fuelText} ${ftype || 'Water'}`)}">
        <text x="88" y="79" text-anchor="middle" font-size="22">${fuelEmoji}</text>
        <text x="88" y="75" text-anchor="middle" font-size="9"
          font-weight="700" fill="#0c1d34" stroke="#ffffff"
          stroke-width="2.4" paint-order="stroke">${fuelText}</text>
      </g>
    </svg>
  `;
  return wrap;
}

// Modifier triangle for reactor / generator cards that pair
// with a thruster. Same rounded-triangle silhouette as the
// regular thrust visual but rendered in slate-grey + capped
// with a 🔧 wrench glyph so the player reads it as "this
// modifies a thruster I'm stacked with" rather than "this is
// my own thrust." Thrust mod (+N / -N) sits in a darker
// pink-circle clone; fuel mod (×N or fraction) sits next to
// a 💧 droplet just like the regular triangle.
function thrustModVisual(face) {
  const wrap = document.createElement('div');
  wrap.className = 'thrust-visual is-modifier';
  const tm = face.thrustMod;
  const fm = face.fuelMod;
  const tmText = (tm > 0 ? '+' : '') + tm;
  const fmText = fm == null
    ? ''
    : (Number.isInteger(fm) ? `×${fm}` : `×${fm.toFixed(2)}`);
  const trianglePath = 'M 64.25 20.18 L 23.75 77.82 ' +
    'Q 18 86 28 86 L 112 86 ' +
    'Q 122 86 116.25 77.82 L 75.75 20.18 ' +
    'Q 70 12 64.25 20.18 Z';
  wrap.innerHTML = `
    <svg viewBox="0 0 140 96" class="thrust-svg thrust-svg-mod">
      <path d="${trianglePath}"
        fill="rgba(51, 65, 85, 0.55)" stroke="#94a3b8"
        stroke-width="2.5" stroke-linejoin="round"/>
      <text x="70" y="40" text-anchor="middle" font-size="22"
        data-tip="Thruster modifier">🔧</text>
      <g data-tip="Thrust modifier: ${tmText}">
        <circle cx="50" cy="72" r="10" fill="#831843" stroke="#fbcfe8" stroke-width="1.5"/>
        <text x="50" y="76" text-anchor="middle" font-size="12"
          font-weight="700" fill="#ffffff">${tmText}</text>
      </g>
      ${fm != null ? `
      <g data-tip="Fuel modifier: ${fmText}">
        <text x="88" y="79" text-anchor="middle" font-size="22">💧</text>
        <text x="88" y="75" text-anchor="middle" font-size="9"
          font-weight="700" fill="#0c1d34" stroke="#ffffff"
          stroke-width="2.4" paint-order="stroke">${fmText}</text>
      </g>` : ''}
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
// Exported so external callers that render data-tip nodes
// outside renderCard (the rocket-stack headliner triangle, the
// modified-thrust hover tooltip) can wire the hover / tap
// pop-up handlers consistently.
export function attachTipsTo(root) {
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
