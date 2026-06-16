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

import { supportIconSvg, thermBadgeSvg, hasSupportIcon, typeIconSvg } from './support-icons.js';

// Spectral type -> { glyph, fill, ink }. Used for the per-card
// spectral hex. Falls back to 'unknown' for anything unmapped.
const SPECTRAL_STYLE = {
  C: { glyph: 'C', fill: '#1f2937', ink: '#e5e7eb' },  // carbonaceous
  S: { glyph: 'S', fill: '#fbbf24', ink: '#1f2937' },  // silicate
  M: { glyph: 'M', fill: '#9ca3af', ink: '#0c0a16' },  // metallic
  V: { glyph: 'V', fill: '#f97316', ink: '#0c0a16' },  // basaltic / volcanic
  B: { glyph: 'B', fill: '#60a5fa', ink: '#0c0a16' },  // alkaline
  D: { glyph: 'D', fill: '#67e8f9', ink: '#0c0a16' },  // icy / cometary
  H: { glyph: 'H', fill: '#0ea5e9', ink: '#f0f9ff' },  // hydrous (matches map + industrialize badge)
  Any: { glyph: 'any', fill: '#6b7280', ink: '#f3f4fa' },  // freighters: works at any spectral type
  unknown: { glyph: '?', fill: '#475569', ink: '#e5e7eb' },
};
const SPECTRAL_LABEL = {
  C: 'Carbonaceous',
  S: 'Silicate',
  M: 'Metallic',
  V: 'Basaltic / volcanic',
  B: 'Alkaline',
  D: 'Icy / cometary',
  H: 'Hydrous',
  Any: 'Any spectral type',
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
  'thermostat':         { glyph: '🌡️', label: 'Radiator therms'         },
  'crew-quarters':      { glyph: '👤', label: 'Crew quarters'          },
  'sail':               { glyph: '⛵', label: 'Sail rigging'           },
  'spin-grav':          { glyph: '💃', label: 'Spin gravity'           },
};

// Pick a readable ink (#0c0a16 vs #fff) for text laid over a hex
// fill, from the fill's perceived luminance.
function readableInk(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return '#0c0a16';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.6 ? '#0c0a16' : '#ffffff';
}

export function renderCard(card, { type, supplied, onSupportClick, face, radSide } = {}) {
  const kind = type || (card.faces && card.faces.primary && card.faces.primary.role ? 'crew' : 'patent');
  const el = document.createElement('div');
  el.className = `card kind-${kind}` + (kind === 'patent' ? ` type-${card.type}` : '');
  // Stamp the physical card id (crew faces are a projection of one
  // physical card via srcId) so callers can find a rendered card on the
  // map - e.g. the multiplayer transfer drift-in animation keys off it.
  el.dataset.cardId = card.srcId || card.id;
  // Default to the primary face, but honor an explicit secondary
  // request (e.g. an ET-Produced card lands Black-Side-up) so the
  // card opens showing its black face instead of needing a manual
  // flip. Only meaningful when a secondary face actually exists.
  el.dataset.side = (face === 'secondary' && card.faces && card.faces.secondary)
    ? 'secondary' : 'primary';
  if (card.flipOrientation === 'rotated180') el.classList.add('flip-rotates');
  // Crew cards carry a faction band colour (the player-colour
  // slot). Expose it (+ a readable ink colour derived from its
  // luminance) as CSS variables so the typebar + frame can tint
  // to match the printed card without illegible text.
  if (kind === 'crew' && card.color) {
    el.style.setProperty('--crew-color', card.color);
    el.style.setProperty('--crew-ink', readableInk(card.color));
  }

  const inner = document.createElement('div');
  inner.className = 'card-inner';

  // Crew is single-faced in play: each faction face is its own
  // crew member, and the player committed to ONE. Render just the
  // chosen face (defaults to primary) and emit NO flip button -
  // crew cards never flip.
  if (kind === 'crew') {
    const showSide = (face === 'secondary' && card.faces && card.faces.secondary)
      ? 'secondary' : 'primary';
    el.dataset.side = showSide;
    inner.appendChild(buildFace(card, showSide, kind, supplied, { onSupportClick }));
    el.appendChild(inner);
    attachTipsTo(el);
    return el;
  }

  // Both faces live inside a single .card-inner that rotates as
  // one rigid 3D body. Each face uses backface-visibility:hidden,
  // so only the side facing the viewer is painted.
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
  // Open the radiator on its DEPLOYED side: data-rotated='1' brings the heavy
  // side upright (active), '0' the light side. Callers rendering a STACK slot
  // pass radSide (default heavy = max cooling, matching the boost + the server);
  // a bare catalog/auction preview passes nothing and keeps the light-up
  // default. Without this a heavy-deployed radiator rendered light-side-up
  // everywhere (LEO / rocket stack / outpost).
  if (card.rotatable) el.dataset.rotated = (radSide === 'heavy') ? '1' : '0';

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
        <span class="crew-isru"></span>
      </div>
      <div class="card-body">
        <h4 class="card-name"></h4>
        <p class="card-role"></p>
        <p class="card-bonus"></p>
        <p class="card-blurb"></p>
      </div>
      <div class="crew-thrust"></div>
    `;
    face.querySelector('.card-name').textContent = c.name || '';
    face.querySelector('.card-role').textContent = c.role || '';
    face.querySelector('.card-bonus').textContent = c.bonus || '';
    face.querySelector('.card-blurb').textContent = c.blurb || '';
    face.querySelector('.m').textContent = c.mass != null ? c.mass : '-';
    face.querySelector('.r').textContent = c.radHardness != null ? c.radHardness : '-';
    // Crews have NO spectral type. The third stat cell instead
    // shows the prospector kind icon + ISRU rating (the same
    // missile / raygun / buggy badge a robonaut uses) when the
    // face carries one.
    const isruCell = face.querySelector('.crew-isru');
    if (isruCell && c.isru != null) {
      const pk = (c.prospector === 'raygun' || c.prospector === 'missile')
        ? c.prospector : 'buggy';
      const icon = supportIconSvg(pk, { size: 21 }) || '';
      isruCell.innerHTML = `${icon}${escapeText(String(c.isru))}`;
    }
    // Thrust triangle. Crew that double as a thruster carry a
    // { thrust, fuelPerBurn, afterburn, dirt } block; render it
    // with the same thrustVisual the patent thrusters use, via
    // a synthetic face that maps the crew field names onto what
    // thrustVisual expects (fuel = fuelPerBurn; fuelType drives
    // the 💧 vs 🪨 droplet for dirt thrusters). Lander faces
    // (thruster == null, e.g. Shimizu) get no triangle + a
    // "lander" note.
    const thrustHost = face.querySelector('.crew-thrust');
    if (thrustHost) {
      if (c.thruster) {
        const t = c.thruster;
        const synthetic = {
          thrust: t.thrust,
          fuel: t.fuelPerBurn,
          afterburn: t.afterburn || false,
          fuelType: t.dirt ? 'Dirt' : 'Water',
        };
        thrustHost.appendChild(thrustVisual(card, synthetic));
        if (t.name) {
          const rk = document.createElement('p');
          rk.className = 'crew-rocket';
          rk.textContent = t.dirt ? `${t.name} (dirt)` : t.name;
          thrustHost.appendChild(rk);
        }
      } else {
        const note = document.createElement('p');
        note.className = 'crew-rocket muted';
        note.textContent = 'Lander (no thruster)';
        thrustHost.appendChild(note);
      }
    }
    return face;
  }

  // Show the thrust triangle on any card whose CURRENT face carries a thrust
  // value - that includes Missile-type robonauts (the spreadsheet gives them
  // their own Thrust / Fuel / Afterburn under the "Thruster" banner), GW
  // Thrusters, and cards that only gain thrust on their BLACK side (Rock
  // Splitter flips to MagBeam, thrust 4). Read the per-FACE thrust, not the
  // card-level (primary) value, so a black-side-only thruster still draws its
  // triangle on the face that actually has the thrust.
  const faceData = (card.faces && card.faces[sideName]) || {};
  const faceThrust = faceData.thrust != null ? faceData.thrust : card.thrust;
  const isThruster = card.type === 'thruster' || faceThrust != null;
  face.innerHTML = `
    <div class="card-typebar"></div>
    <div class="card-name-row"><span class="card-name"></span></div>
    <div class="card-statbox">
      <span data-tip="Mass: wet mass this card adds to your ship stack. Heavier stacks need more thrust to move.">
        <strong class="m"></strong> MASS</span>
      <span data-tip="Rad-hardness: how well this card resists radiation. Lower values degrade faster near radiation hazards.">
        <strong class="r"></strong> RAD</span>
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
  // robonauts) we fall back to the card-type icon.
  const tbar = face.querySelector('.card-typebar');
  const supplies = faceData.supplies || card.supplies || [];
  // The leading glyph row uses the custom support icons (reactor squares /
  // generator circles / therm badge / robonaut prospector squares), falling
  // back to the text glyph or a generic type emoji only where no icon exists.
  const iconFor = (k) => (k === 'thermostat')
    ? thermBadgeSvg(1, { size: 22 })
    : (supportIconSvg(k, { size: 22 }) || `<em>${(REQUIREMENT_VIS[k] || {}).glyph || ''}</em>`);
  const supplyGlyphs = supplies.map(iconFor).filter(Boolean).join('');
  // Robonauts ARE their prospector role - show the missile / raygun / buggy
  // icon(s) (dual-purpose cards stack both) instead of the generic robonaut
  // head. Crews aren't robonauts, so they skip this branch.
  let robonautGlyphs = '';
  if (card.type === 'robonaut') {
    const props = faceData.properties || card.properties || [];
    const active = [];
    for (const key of ['missile', 'raygun', 'buggy']) {
      if (props.some((p) => p.key === key && p.value)) active.push(supportIconSvg(key, { size: 22 }));
    }
    robonautGlyphs = active.join('');
  }
  const fallback = robonautGlyphs || (typeIconSvg(card.type, { size: 22 }) || '');
  const lead = supplyGlyphs || fallback;
  // GW Thrusters promote to a TW (Terawatt) thruster on their purple back, so
  // that face's typebar reads "TW THRUSTER"; the white front reads "GW THRUSTER".
  let typeLabel = card.type.toUpperCase();
  if (card.type === 'gw-thruster') typeLabel = sideName === 'secondary' ? 'TW THRUSTER' : 'GW THRUSTER';
  tbar.innerHTML = `${lead ? `<span class="typebar-icons">${lead}</span>` : ''}${escapeText(typeLabel)}`;
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

  // Spectral hex shows on both faces normally, but GW Thrusters / Freighters
  // drop it on their purple (promoted) BACK - that side doesn't use spectral
  // matching, so the published cards leave it off.
  const isPromoCard = card.type === 'gw-thruster' || card.type === 'freighter';
  if (!(isPromoCard && sideName === 'secondary')) {
    face.querySelector('.card-spectral').appendChild(spectralHex(card.spectralType));
  }
  // Promotion colony dome - FRONT (white) face only. The purple Tier-2 side is
  // already promoted, so per the published cards it drops the promotion symbol.
  if (sideName === 'primary' && card.promotionColony) {
    face.querySelector('.card-spectral').appendChild(colonyDomeGlyph(card.promotionColony));
  }

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
  const add = (k, v, color) => {
    if (v == null) return;
    const li = document.createElement('li');
    li.innerHTML = `<span></span><strong></strong>`;
    li.querySelector('span').textContent = k;
    const strong = li.querySelector('strong');
    strong.textContent = v;
    if (color) strong.style.color = color;
    stats.appendChild(li);
  };
  // Reach into the active face for stats that vary between
  // Tier-1 (white) and Tier-2 (black). The black side is a
  // genuinely different technology with different numbers.
  const fdata = (card.faces && card.faces[sideName]) || {};
  if (isThruster) {
    add('ISP', fdata.isp ?? card.isp);
    const f = fdata.fuel ?? card.fuel;
    // Order + colour these to match the thrust triangle: Thrust (left, magenta
    // like the thrust circle) then Fuel (right, blue/grey like the fuel droplet
    // - blue for water, grey for dirt).
    const isDirtFuel = (fdata.fuelType ?? card.fuelType) === 'Dirt';
    // GW Thrusters burn ISO (isotope) fuel - colour the value gold like the
    // droplet, not the water-blue / dirt-grey of the other thrusters.
    const fuelColor = card.type === 'gw-thruster' ? '#e0aa2c' : (isDirtFuel ? '#6b7280' : '#0089bd');
    add('Thrust', fdata.thrust ?? card.thrust, '#d6017a');
    add('Fuel', f != null && !Number.isInteger(f) ? f.toFixed(2) : f, fuelColor);
    // Afterburn is shown by the flame on the thrust triangle (with its own
    // tooltip), so it no longer needs a separate stat line here.
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
          ? thermBadgeSvg(Math.min(8, therms), { size: 24 })
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
  } else if (card.type === 'freighter') {
    // Freighters haul cargo, not thrust: the Load-Limit is the headline stat.
    add('Load limit', fdata.loadLimit ?? card.loadLimit);
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
    // GW afterburn reads as the thrust GAINED ("+N", burn 1 fuel step), not a
    // "×N" multiplier like the other numeric properties - and carries its own
    // tooltip explaining the inverted cost.
    const isGwAfterburn = card.type === 'gw-thruster' && p.key === 'afterburn';
    b.setAttribute('data-tip', isGwAfterburn
      ? `Afterburn: burn 1 fuel step to add +${p.value} net thrust this turn. This number is the thrust gained, not a fuel cost.`
      : (p.desc || (p.value === true ? p.label : `${p.label}: ${p.value}`)));
    const count = isGwAfterburn
      ? `<b>+${p.value}</b>`
      : ((typeof p.value === 'number' && p.value > 1) ? `<b>×${p.value}</b>` : '');
    // Robonaut prospector types (missile / raygun / buggy) get the custom
    // support-icon glyph; everything else keeps its emoji.
    const propIcon = supportIconSvg(p.key, { size: 27 });
    if (propIcon) { b.classList.add('has-support-icon'); b.innerHTML = `${propIcon}${count}`; }
    else b.innerHTML = `<em>${p.glyph}</em>${count}`;
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
  // A requirement's visual: the custom support icon (reactor / generator /
  // robonaut), the ×N therm badge for the radiator thermostat, else the text
  // glyph. The count rides as ×N except for therms (the N thermometers ARE
  // the count).
  const reqGlyphHtml = (kind, count) => {
    if (kind === 'thermostat') return thermBadgeSvg(count, { size: 27 });
    const icon = supportIconSvg(kind, { size: 27 });
    const cnt = count > 1 ? `<b>×${count}</b>` : '';
    if (icon) return `${icon}${cnt}`;
    const vis = REQUIREMENT_VIS[kind] || { glyph: '◇' };
    return `<em>${vis.glyph}</em>${cnt}`;
  };
  const makeChip = (visGlyphs, supplier, tip, satisfied, kinds) => {
    const span = document.createElement('span');
    span.className = 'req';
    span.setAttribute('data-tip', satisfied ? `${tip} - satisfied` : tip);
    if (supplier) span.dataset.supplier = supplier;
    if (satisfied) span.classList.add('is-satisfied');
    if (kinds && kinds.length) span.dataset.kinds = kinds.join(',');
    // Chips that hold a custom icon drop the supplier-tinted pill background -
    // the icon carries its own colour.
    if (visGlyphs.includes('support-icon')) span.classList.add('has-support-icon');
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
    const parts = group.map((r) => reqGlyphHtml(r.kind, r.count));
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
    let chipHtml;
    if (r.kind === 'beam-receiver')  chipHtml = svgSunChip(16) + (r.count > 1 ? `<b>×${r.count}</b>` : '');
    else if (r.kind === 'spin-grav') chipHtml = svgBallerinaChip(16) + (r.count > 1 ? `<b>×${r.count}</b>` : '');
    else if (hasSupportIcon(r.kind)) chipHtml = reqGlyphHtml(r.kind, r.count);
    else                             chipHtml = `<em>${vis.glyph}</em>${r.count > 1 ? `<b>×${r.count}</b>` : ''}`;
    const satisfied = !!supplied && supplied.has(r.kind);
    makeChip(chipHtml, null,
      r.count > 1 ? `${vis.label} ×${r.count}` : vis.label,
      satisfied, [r.kind]);
  }

  // Blurb / ability text varies per face. The Tier-2 dark side
  // is a different technology with its own ability description.
  const meta = (card.faces && card.faces[sideName]) || {};
  face.querySelector('.card-blurb').textContent =
    meta.ability || meta.blurb || card.blurb || '';
  // Future mission: the end-game objective printed on the Tier-2 (purple /
  // promoted) side. Rendered as a blue callout below the ability, with the
  // mission name (before the colon) emphasised. Only the secondary face carries
  // a `future`, so it never shows on the white side.
  if (meta.future) {
    const fut = document.createElement('div');
    fut.className = 'card-future';
    const ci = meta.future.indexOf(':');
    if (ci > 0) {
      fut.innerHTML = `<span class="card-future-head">${escapeText(meta.future.slice(0, ci))}</span> `
        + escapeText(meta.future.slice(ci + 1).trim());
    } else {
      fut.textContent = meta.future;
    }
    // On a GW Thruster's purple (TW) back the FULL-SIZE thrust triangle shifts
    // to the right (CSS) and the future fills the freed column on the left - no
    // overlap with the gold, and the afterburn "+N" stays visible on the
    // triangle. Everywhere else (e.g. freighters, no triangle) it goes below.
    const thrustEl = (card.type === 'gw-thruster' && sideName === 'secondary')
      ? face.querySelector('.card-thrust') : null;
    if (thrustEl) {
      fut.classList.add('card-future-side');
      thrustEl.appendChild(fut);
    } else {
      const body = face.querySelector('.card-body');
      if (body) body.appendChild(fut);
    }
  }
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
  // Therm-supply badges in the cyan typebar: kept compact so the radiator's
  // cyan banner reads clearly (the 50%-larger icon pass washed it out).
  const therms = (n) => n > 0 ? thermBadgeSvg(Math.min(8, n), { size: 15 }) : '';

  // Name sits directly below the typebar so it reads as a
  // banner-and-title pair (matching the published radiator card
  // where "Bubble Membrane" hugs the cyan "Radiator" header).
  // Stats sit below, then ability text fills the remainder of
  // the half.
  const lightT = light.therms || 0;
  const heavyT = heavy.therms || 0;

  // Power-source requirements (e.g. an active refrigerator's e-generator) DO
  // apply to radiators - render them as a supports-required row so the card
  // shows what the support chain enforces. Therms are SUPPLIED by a radiator,
  // never required, so they're not here (the typebar therm badge is the supply).
  const reqs = Array.isArray(faceMeta.requires) ? faceMeta.requires : [];
  const reqChip = (r) => {
    const icon = supportIconSvg(r.kind, { size: 17 })
      || `<em>${(REQUIREMENT_VIS[r.kind] || { glyph: '◇' }).glyph}</em>`;
    const cnt = (r.count > 1) ? `<b>×${r.count}</b>` : '';
    return `<span class="req has-support-icon">${icon}${cnt}</span>`;
  };
  const reqHtml = reqs.length
    ? `<div class="card-supports"><div class="card-supports-label">Supports required</div>`
      + `<div class="card-requires">${reqs.map(reqChip).join('')}</div></div>`
    : '';

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
      ${reqHtml}
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
  // Single spectral letters render large; a multi-character glyph (e.g. "any")
  // shrinks to fit inside the hex.
  text.setAttribute('font-size', style.glyph.length > 1 ? '8' : '12');
  text.setAttribute('font-weight', '700');
  text.setAttribute('fill', '#ffffff');
  text.textContent = style.glyph;
  svg.appendChild(text);
  return svg;
}

let _domeSeq = 0;
// Promotion colony dome. GW Thrusters and Freighters flip to their purple
// (promoted) side at a Colony of a given type; the published cards mark that
// with a teal colony dome (matching the map's colony sprite) carrying the
// colony's letter - a spectral class (C/S/M/V/B/D/H) - or a beamed-power symbol
// for "Push". Rendered on the FRONT face only: the purple side is already
// promoted and drops the symbol.
function colonyDomeGlyph(promo) {
  const p = String(promo || '').trim();
  const isPush = p.toLowerCase() === 'push';
  const letter = isPush ? '' : p.charAt(0).toUpperCase();
  const gid = 'dome' + (_domeSeq++);
  // Letter sits low inside the dome body (dominant-baseline central + text-anchor
  // middle), a touch smaller so it reads as inside the dome, not on top of it.
  const inner = isPush
    ? '<g transform="translate(0,2)" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" fill="none"><path d="M-4.5 -2.5 L0 2 L4.5 -2.5"/><path d="M-4.5 2.5 L0 7 L4.5 2.5"/></g>'
    : `<text x="0" y="3.6" text-anchor="middle" dominant-baseline="central" font-family="ui-sans-serif, system-ui, sans-serif" font-size="12" font-weight="800" fill="#ffffff" stroke="#0e3f4f" stroke-width="0.7" paint-order="stroke">${escapeText(letter)}</text>`;
  const tip = isPush
    ? 'Promotion: flips to its purple side at a push-sat colony.'
    : `Promotion: flips to its purple side at a ${p} colony.`;
  const str = `<svg viewBox="-15 -14 30 29" class="colony-dome-glyph" data-tip="${escapeText(tip)}">`
    + `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#46c4df"/><stop offset="1" stop-color="#15697f"/></linearGradient></defs>`
    + '<ellipse cx="0" cy="8.5" rx="13" ry="3" fill="#0c4554"/>'
    + `<path d="M -12.5 8.5 A 12.5 12.5 0 0 1 12.5 8.5 Z" fill="url(#${gid})" stroke="#0c3a48" stroke-width="1.4"/>`
    + inner
    + '</svg>';
  const tpl = document.createElement('template');
  tpl.innerHTML = str.trim();
  return tpl.content.firstElementChild;
}

// Small inline glyphs that echo the card's thrust triangle: the pink thrust
// circle (number inside) and the fuel water-droplet (number on the droplet,
// 🪨 for dirt). Used in the at-a-glance chips so a thruster reads like its card.
function thrustCircleGlyph(value) {
  return '<svg class="gl-thrust" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">'
    + '<circle cx="12" cy="12" r="10" fill="#ec4899" stroke="#fbcfe8" stroke-width="1.6"/>'
    + `<text x="12" y="16.3" text-anchor="middle" font-size="12.5" font-weight="700" fill="#fff">${escapeText(String(value))}</text>`
    + '</svg>';
}
// Inline afterburn flame for the at-a-glance chips (no emoji).
function flameGlyphInline() {
  return '<svg class="gl-flame" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">'
    + '<path d="M12 2 C16 8 21 9.5 17 17 C15.5 21 8.5 21 7 16 C5.8 12 9 11 10 7 C11 10 13 8.5 12 2 Z" fill="#e07d1e" stroke="#ffd9a0" stroke-width="0.8"/>'
    + '<path d="M12 11 C14 13.5 15 15 13.5 18 C12.5 20 9 20 8.5 16.5 C8 13.5 11 13 12 11 Z" fill="#f4a93a"/>'
    + '</svg>';
}
function fuelDropletGlyph(value, dirt) {
  // Inline vector droplet matching the card's fuel glyph: light-blue for water,
  // grey for dirt. No emoji, so it scales crisply at any chip size.
  const fill = dirt ? '#b6bcc4' : '#52caf2';
  const rim = dirt ? '#e6e9ee' : '#d6f3ff';
  const s = String(value);
  const fs = s.length <= 2 ? 9.5 : 7.5;
  return `<svg class="gl-fuel-svg" viewBox="0 0 24 28" width="15" height="17.5" aria-hidden="true">`
    + `<path d="M12 3 C12 3 20 13.2 20 18.5 A8 8 0 0 1 4 18.5 C4 13.2 12 3 12 3 Z" fill="${fill}" stroke="${rim}" stroke-width="1.1"/>`
    + `<ellipse cx="9" cy="18" rx="1.9" ry="2.6" fill="#ffffff" opacity="0.55"/>`
    + `<text x="12" y="22.2" text-anchor="middle" font-size="${fs}" font-weight="800" fill="#0a2230" stroke="#f2fbff" stroke-width="2.2" paint-order="stroke">${escapeText(s)}</text></svg>`;
}
// Reactor / generator thrust MODIFIER: the dark-pink circle from the card's
// wrench triangle, showing how much thrust it adds to the thruster it powers.
function modThrustGlyph(value) {
  const txt = (value > 0 ? '+' : '') + value;
  return '<svg class="gl-thrust gl-thrust-mod" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">'
    + '<circle cx="12" cy="12" r="10" fill="#831843" stroke="#fbcfe8" stroke-width="1.6"/>'
    + `<text x="12" y="16.3" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">${escapeText(txt)}</text>`
    + '</svg>';
}

// Compact "at a glance" summary of a card for list/overview chips (e.g. the
// All cards view). Reuses the SAME glyph language as the full card: the
// typebar lead icon (supplied chips / robonaut role icons / type icon), the
// spectral hex, and the type-specific headline numbers (the pink thrust circle
// + fuel droplet for thrusters, therms for radiators, ISRU + role for
// robonauts, etc.). Reads the ACTIVE face so a flipped (installed / Tier-2)
// card reports its own stats. Returns ready-to-inject HTML (statsHtml).
export function cardGlanceSummary(card, faceName = 'primary', radSide = null) {
  const sideName = (faceName === 'secondary' && card.faces && card.faces.secondary)
    ? 'secondary' : 'primary';
  const fdata = (card.faces && card.faces[sideName]) || {};
  const props = fdata.properties || card.properties || [];
  const supplies = fdata.supplies || card.supplies || [];
  const propByKey = (k) => props.find((p) => p && p.key === k);
  const type = card.type || (fdata.role != null ? 'crew' : 'card');
  const thr = fdata.thrust ?? card.thrust;
  const isThruster = type === 'thruster' || thr != null;

  // Icon: the same typebar lead the full card draws.
  const iconFor = (k) => (k === 'thermostat')
    ? thermBadgeSvg(1, { size: 14 })
    : (supportIconSvg(k, { size: 14 }) || `<em>${(REQUIREMENT_VIS[k] || {}).glyph || ''}</em>`);
  let icon = supplies.map(iconFor).filter(Boolean).join('');
  if (!icon && type === 'robonaut') {
    icon = ['missile', 'raygun', 'buggy']
      .filter((k) => { const p = propByKey(k); return p && p.value; })
      .map((k) => supportIconSvg(k, { size: 14 })).join('');
  }
  if (!icon) icon = typeIconSvg(type, { size: 14 }) || '';
  // Thrust-bearing cards with no chip / type icon of their own (e.g. GW
  // thrusters) borrow the thruster icon; crew fall back to a person glyph.
  if (!icon && isThruster) icon = typeIconSvg('thruster', { size: 14 }) || '';
  if (!icon && type === 'crew') icon = '👤';

  // Type-specific headline stats, then ISRU, then notable flags. Each entry is
  // HTML: thrust / fuel use the card's glyphs, text entries are escaped.
  const stats = [];
  const txt = (s) => escapeText(String(s));
  if (isThruster) {
    const fuel = fdata.fuel ?? card.fuel;
    const fuelType = fdata.fuelType ?? card.fuelType;
    const dirt = !!(fuelType && /dirt/i.test(String(fuelType)));
    if (thr != null) stats.push(thrustCircleGlyph(thr));
    if (fuel != null) stats.push(fuelDropletGlyph(Number.isInteger(fuel) ? fuel : fuel.toFixed(2), dirt));
    if (fdata.afterburn ?? card.afterburn) stats.push(flameGlyphInline());
  } else if (type === 'radiator') {
    // A radiator cools by the side it's deployed on (light vs heavy therms).
    // Prefer the radSide block when the caller knows which side is in play.
    const sideBlk = (radSide === 'light' || radSide === 'heavy') ? fdata[radSide] : null;
    const therms = (sideBlk && sideBlk.therms != null) ? sideBlk.therms
      : (card.therms ?? card.heat_cap ?? fdata.therms
        ?? (fdata.light && fdata.light.therms) ?? (fdata.heavy && fdata.heavy.therms));
    if (therms != null) stats.push(`🌡 ${txt(therms)} therm${therms === 1 ? '' : 's'}`);
  } else if (type === 'crew') {
    if (fdata.role) stats.push(txt(cap(fdata.role)));
    // Crew that doubles as a thruster reads like a thruster: pink thrust
    // circle + fuel droplet (rock for a dirt thruster) + afterburn.
    const t = fdata.thruster;
    if (t && t.thrust != null) {
      stats.push(thrustCircleGlyph(t.thrust));
      const fuel = t.fuelPerBurn ?? t.fuel;
      if (fuel != null) {
        stats.push(fuelDropletGlyph(Number.isInteger(fuel) ? fuel : fuel.toFixed(2), !!t.dirt));
      }
      if (t.afterburn) stats.push('🔥');
    }
  }
  const isru = propByKey('isru');
  if (isru && isru.value != null) stats.push(`ISRU ${txt(isru.value)}`);
  if (type === 'robonaut') {
    for (const k of ['missile', 'raygun', 'buggy']) {
      const p = propByKey(k);
      if (p && p.value) stats.push(txt(p.label || cap(k)));
    }
    if (card.prospect_bonus != null) stats.push(`+prospect ${txt(card.prospect_bonus)}`);
  }
  // Reactor / generator thrust + fuel MODIFIER (the card's wrench triangle):
  // how much it boosts / throttles whatever thruster it powers in the chain.
  // Shown as the dark-pink mod circle + a ×fuel multiplier.
  const tMod = fdata.thrustMod ?? card.thrustMod;
  const fMod = fdata.fuelMod ?? card.fuelMod;
  if (tMod != null && tMod !== 0) stats.push(modThrustGlyph(tMod));
  if (fMod != null && fMod !== 1) {
    stats.push('🔧×' + txt(Number.isInteger(fMod) ? fMod : fMod.toFixed(2)));
  }
  // Reactors / generators carry their meaning in what chip they SUPPLY; if no
  // numeric headline landed, name the supplied chip(s) so the row isn't blank.
  if (!stats.length && supplies.length) {
    for (const k of supplies) stats.push(txt((REQUIREMENT_VIS[k] || {}).label || k));
  }

  const spectralHtml = (type !== 'crew' && card.spectralType)
    ? spectralHex(card.spectralType).outerHTML : '';
  return {
    icon,
    statsHtml: stats.join('<span class="acc-sep"> · </span>'),
    hasStats: stats.length > 0,
    spectralHtml,
    type,
  };
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
// ---------------------------------------------------------------------------
// Thrust-triangle glyph kit. All-vector (no emoji) so the wedge scales cleanly.
// Layout: a tall wedge (cyan = water thruster, grey = dirt thruster, dark =
// modifier); a magenta thrust circle + a fuel droplet share the base; an
// optional centre symbol (Sun = solar, Push-sat = beamed) and an optional top
// symbol (afterburn flame, or a wrench on a modifier). Colours are centralised
// here so they can be retuned in one place.
// ---------------------------------------------------------------------------
const TVC = {
  cyanTri: '#00aeef', cyanTri2: '#00aeef', cyanStroke: '#0089bd',
  greyTri: '#a3a9b1', greyTri2: '#7d838c',
  // GW Thrusters run isotope fuel: a gold wedge + gold fuel droplet, set apart
  // from the cyan (water) / grey (dirt) thrusters.
  goldTri: '#f8cf3b', goldTri2: '#e0aa2c', goldStroke: '#a8761a',
  goldFuel: '#e0aa2c', goldFuelRim: '#f6e3a8',
  darkTri: '#1b2030', magenta: '#e60a7e', magentaRim: '#f7a8cf', modPink: '#831843',
  water: '#52caf2', waterRim: '#d6f3ff', dirt: '#b6bcc4', dirtRim: '#e6e9ee',
  orange: '#e07d1e', orange2: '#f4a93a', wrench: '#eef2f8', sun: '#f6b51e',
};
const TV_VB = '0 0 140 114';
const TV_TRI = 'M 63 16 L 23 94 Q 18 102 28 102 L 112 102 Q 122 102 117 94 L 77 16 Q 70 6 63 16 Z';
const TV_BASE = 99, TV_CXL = 46, TV_CXR = 95, TV_R = 13, TV_DS = 1.35, TV_TOP = 24, TV_CTR = 60;
let _tvSeq = 0;   // unique gradient ids so a removed card SVG never breaks others

function tvWedge(g1, g2, stroke, id) {
  return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0" stop-color="${g1}"/><stop offset="1" stop-color="${g2}"/></linearGradient></defs>`
    + `<path d="${TV_TRI}" fill="url(#${id})" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round"/>`;
}
function tvDarkWedge() {
  return `<path d="${TV_TRI}" fill="${TVC.darkTri}" stroke="#3c465e" stroke-width="2.5" stroke-linejoin="round"/>`;
}
// Magenta thrust circle (or the dark-pink modifier circle), bottom-aligned to `by`.
function tvCircle(cx, by, n, fill, rim) {
  const cy = by - TV_R;
  const s = String(n);
  const fs = s.length <= 2 ? 16 : 12;
  return `<circle cx="${cx}" cy="${cy}" r="${TV_R}" fill="${fill}" stroke="${rim}" stroke-width="2"/>`
    + `<text x="${cx}" y="${cy + 5.6}" text-anchor="middle" font-size="${fs}" font-weight="800" fill="#fff">${escapeText(s)}</text>`;
}
// Fuel water-droplet (light blue = water, grey = dirt), bottom-aligned to `by`.
function tvDroplet(cx, by, n, fill, rim) {
  const cy = by - 12 * TV_DS;
  const s = String(n);
  const fs = s.length <= 2 ? 9 : 7;
  return `<g transform="translate(${cx},${cy}) scale(${TV_DS})">`
    + `<path d="M0 -12 C0 -12 8.5 -1.5 8.5 4 A8.5 8.5 0 0 1 -8.5 4 C-8.5 -1.5 0 -12 0 -12 Z" fill="${fill}" stroke="${rim}" stroke-width="1.1"/>`
    + `<ellipse cx="-2.8" cy="2.6" rx="2.2" ry="3" fill="#ffffff" opacity="0.55"/>`
    + `<text x="0" y="6.6" text-anchor="middle" font-size="${fs}" font-weight="800" fill="#0a2230" stroke="#f2fbff" stroke-width="2.2" paint-order="stroke">${escapeText(s)}</text></g>`;
}
function tvFlame(cx, cy, n) {
  const s = 1.35;
  return `<g transform="translate(${cx},${cy}) scale(${s})">`
    + `<path d="M0 -12 C4.5 -5 9 -4 6 4 C5 9 -5 9 -6.5 3 C-7.5 -1 -3.2 -2 -2 -6 C-1 -3 1 -4 0 -12 Z" fill="${TVC.orange}" stroke="#ffd9a0" stroke-width="0.8"/>`
    + `<path d="M0 -4 C2 -1 3 1 1.5 4 C0.5 6 -2 6 -2.4 3 C-2.7 0 -0.8 -1 0 -4 Z" fill="${TVC.orange2}"/>`
    + (n != null ? `<text x="0" y="3" text-anchor="middle" font-size="7.5" font-weight="800" fill="#3a1500" stroke="#ffe2bf" stroke-width="1.8" paint-order="stroke">${escapeText(String(n))}</text>` : '')
    + '</g>';
}
// Open-end wrench: solid head with a U/semicircle jaw notch (notch = wedge bg).
function tvWrench(cx, cy, s) {
  s = s || 1.25;
  // Handle + rounded jaw head, with a U-notch cut from the tip. The notch top
  // runs ABOVE the head so the jaw opens cleanly (no leftover bridge of metal
  // across the opening).
  return `<g transform="translate(${cx},${cy}) rotate(-28) scale(${s})">`
    + `<rect x="-2.4" y="-1" width="4.8" height="13" rx="2.4" fill="${TVC.wrench}"/>`
    + `<ellipse cx="0" cy="-7" rx="6.2" ry="5.8" fill="${TVC.wrench}"/>`
    + `<path d="M -3.7 -15 L -3.7 -7.2 A 3.7 3.7 0 0 0 3.7 -7.2 L 3.7 -15 Z" fill="${TVC.darkTri}"/></g>`;
}
function tvSun(cx, cy, s) {
  s = s || 1.3;
  let rays = '';
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    rays += `<line x1="${(Math.cos(a) * 7.5).toFixed(2)}" y1="${(Math.sin(a) * 7.5).toFixed(2)}" x2="${(Math.cos(a) * 11).toFixed(2)}" y2="${(Math.sin(a) * 11).toFixed(2)}" stroke="${TVC.sun}" stroke-width="2.4" stroke-linecap="round"/>`;
  }
  return `<g transform="translate(${cx},${cy}) scale(${s})">${rays}<circle r="6" fill="${TVC.sun}" stroke="#fff3c4" stroke-width="1"/><circle cx="-1.8" cy="-1.8" r="1.8" fill="#fde68a"/></g>`;
}
function tvPushsat(cx, cy, s) {
  s = s || 1.25;
  return `<g transform="translate(${cx},${cy}) scale(${s})">`
    + `<rect x="-9.5" y="-3.2" width="6" height="6.4" rx="0.6" fill="#5aa0e0" stroke="#cde6ff" stroke-width="0.8"/>`
    + `<rect x="3.5" y="-3.2" width="6" height="6.4" rx="0.6" fill="#5aa0e0" stroke="#cde6ff" stroke-width="0.8"/>`
    + `<rect x="-3" y="-4.2" width="6" height="8.4" rx="1.2" fill="#cbd5e1" stroke="#7b8aa3" stroke-width="0.8"/><circle cx="0" cy="-0.2" r="1.5" fill="#7b8aa3"/>`
    + `<g stroke="#9fd0ff" stroke-width="1.5" stroke-linecap="round" fill="none"><path d="M-3 6.2 L0 8.6 L3 6.2"/><path d="M-3 8.8 L0 11.2 L3 8.8"/></g></g>`;
}

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
  // Fuel type drives the wedge + droplet colour: water = cyan wedge + light-blue
  // droplet; dirt = grey wedge + grey droplet. Read off the face's Fuel Type.
  const ftype = (face && face.fuelType) || card.fuelType;
  const isDirt = ftype === 'Dirt';
  // GW Thrusters burn isotope (ISO) fuel and afterburn differently from the rest.
  const isGw = card && card.type === 'gw-thruster';
  // Afterburn. Normal thrusters: the number is the FUEL STEPS spent to gain a
  // fixed +1 net thrust. GW Thrusters invert it - burn ONE fuel step to gain
  // that many net thrust - so the number is the thrust GAINED and reads as "+N".
  const afterVal = (face && face.afterburn != null) ? face.afterburn : (card ? card.afterburn : null);
  const afterN = Number(afterVal) || 0;
  const showAfter = afterN > 0;
  const afterTip = isGw
    ? `Afterburn: burn 1 fuel step to add +${afterN} net thrust this turn. This number is the thrust gained, not a fuel cost.`
    : `Afterburn: spend ${afterN} fuel step${afterN === 1 ? '' : 's'} to add +1 net thrust this turn. `
      + `This number is the fuel steps spent to perform afterburn, not a water or aqua cost.`;
  // Centre symbol: Sun (solar power) or Push-sat (beamed power), from the
  // installed face's property booleans.
  const props = (face && face.properties) || card.properties || [];
  const hasProp = (k) => props.some((p) => p && p.key === k && p.value);
  const solar = hasProp('solar');
  const push = hasProp('push');

  // GW gold wedge + gold droplet (isGw computed above), regardless of the
  // water/dirt split that colours the other thrusters.
  const uid = 'tv' + (_tvSeq++);
  const wedge = isGw
    ? tvWedge(TVC.goldTri, TVC.goldTri2, TVC.goldStroke, uid)
    : isDirt
      ? tvWedge(TVC.greyTri, TVC.greyTri2, '#6b7280', uid)
      : tvWedge(TVC.cyanTri, TVC.cyanTri2, TVC.cyanStroke, uid);
  const fuelFill = isGw ? TVC.goldFuel : (isDirt ? TVC.dirt : TVC.water);
  const fuelRim = isGw ? TVC.goldFuelRim : (isDirt ? TVC.dirtRim : TVC.waterRim);
  const center = solar ? tvSun(70, TV_CTR) : (push ? tvPushsat(70, TV_CTR) : '');
  // GW afterburn shows the thrust GAIN as "+N" sitting ON TOP of the flame
  // (centred, drawn over it), not crammed inside it; other thrusters keep the
  // fuel-step count inside.
  const flameGlyph = isGw
    ? tvFlame(70, TV_TOP + 5, null)
      + `<text x="70" y="${TV_TOP + 1}" text-anchor="middle" dominant-baseline="central" font-size="13" font-weight="800" fill="#ffffff" stroke="#3a1500" stroke-width="2.8" paint-order="stroke">+${afterN}</text>`
    : tvFlame(70, TV_TOP, afterN);
  const top = showAfter
    ? `<g data-tip="${escapeText(opts.breakdown?.afterburn || afterTip)}">${flameGlyph}</g>`
    : '';
  const thrustTip = escapeText(opts.breakdown?.thrust || `Thrust: ${thrust}`);
  const fuelTip = escapeText(opts.breakdown?.fuel || `Fuel per burn: ${fuelText} ${ftype || (isGw ? 'ISO' : 'Water')}`);

  wrap.innerHTML = `
    <svg viewBox="${TV_VB}" class="thrust-svg">
      ${wedge}
      ${top}
      ${center}
      <g data-tip="${thrustTip}">${tvCircle(TV_CXL, TV_BASE, thrust, TVC.magenta, TVC.magentaRim)}</g>
      <g data-tip="${fuelTip}">${tvDroplet(TV_CXR, TV_BASE, fuelText, fuelFill, fuelRim)}</g>
    </svg>
  `;
  return wrap;
}

// Modifier triangle for reactor / generator cards that pair with a thruster.
// Dark wedge capped with an open-end WRENCH (this card modifies a thruster I'm
// stacked with, not its own thrust), plus a Sun in the centre when the modifier
// is solar. Thrust mod (+N / -N) sits in a dark-pink circle; fuel mod (×N) in a
// grey droplet, same base row as the regular thrust visual.
export function thrustModVisual(face) {
  const wrap = document.createElement('div');
  wrap.className = 'thrust-visual is-modifier';
  const tm = face.thrustMod;
  const fm = face.fuelMod;
  const tmText = (tm > 0 ? '+' : '') + tm;
  const fmText = fm == null
    ? ''
    : (Number.isInteger(fm) ? `×${fm}` : `×${fm.toFixed(2)}`);
  const props = face.properties || [];
  const solar = props.some((p) => p && p.key === 'solar' && p.value);
  const center = solar ? tvSun(70, TV_CTR) : '';
  const wrenchTop = tvWrench(70, solar ? 40 : 50, 1.25);
  wrap.innerHTML = `
    <svg viewBox="${TV_VB}" class="thrust-svg thrust-svg-mod">
      ${tvDarkWedge()}
      <g data-tip="Thruster modifier">${wrenchTop}</g>
      ${center}
      <g data-tip="Thrust modifier: ${escapeText(tmText)}">${tvCircle(TV_CXL, TV_BASE, tmText, TVC.modPink, TVC.magentaRim)}</g>
      ${fm != null ? `<g data-tip="Fuel modifier: ${escapeText(fmText)}">${tvDroplet(TV_CXR, TV_BASE, fmText, TVC.dirt, TVC.dirtRim)}</g>` : ''}
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
  (document.fullscreenElement || document.body).appendChild(_tipEl);
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
