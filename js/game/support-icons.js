// Support / requirement / card-type glyph SVGs - ONE source for the rendered
// card chips (card-ui.js) AND the standalone asset generator
// (scripts/gen-support-icons.mjs). Pure: no DOM, no node imports; every export
// returns an inline-SVG string.
//
// Category visual language (flat fills, no gradients):
//   reactor   = purple SQUARE, white glyph
//   generator = orange CIRCLE, white glyph
//   radiator  = BLUE thermometer(s) on a WHITE rounded badge (×N therms)
//   robonaut  = BLACK square, PINK glyph
//   thruster  = DARK square, AMBER rocket-engine bell (chamber + ribbed nozzle)
//   refinery  = SLATE square, white flask glyph
// See assets/support-icons/ for the rendered review sheet.

const THERM_BLUE = '#59abeb';
const ROBO_PINK = '#eec1a8';
const BELL_AMBER = '#e9aa55';

// shape: 'square' | 'circle'. ink: glyph colour. fill/ring: flat coin colours.
export const SUPPORT_CAT = {
  reactor:   { shape: 'square', fill: '#8b5cf6', ring: '#6d28d9', ink: '#ffffff' },
  generator: { shape: 'circle', fill: '#f97316', ring: '#c2410c', ink: '#ffffff' },
  robonaut:  { shape: 'square', fill: '#0c0a16', ring: '#be185d', ink: ROBO_PINK },
  thruster:  { shape: 'square', fill: '#222a3d', ring: '#0c0a16', ink: BELL_AMBER },
  refinery:  { shape: 'square', fill: '#94a3b8', ring: '#64748b', ink: '#ffffff' },
};

// Glyphs use currentColor (set per category) + "__HOLE__" for negative space.
const GLYPH = {
  'reactor-fission': () => `
    <line x1="10.5" y1="10.5" x2="21.5" y2="21.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
    <line x1="21.5" y1="10.5" x2="10.5" y2="21.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
    <circle cx="16" cy="16" r="2.5" fill="currentColor"/>`,
  'reactor-fusion': () => `
    <path d="M5.5 16 C 7.7 9.6, 10.3 9.6, 12.5 16 C 14.7 22.4, 17.3 22.4, 19.5 16 C 21.7 9.6, 24.3 9.6, 26.5 16"
          fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`,
  'reactor-antimatter': () => `
    <g transform="translate(16 16) scale(0.8) translate(-16 -16)">
      <circle cx="14.5" cy="19" r="7" fill="currentColor"/>
      <path d="M16.6 12.1 L19.5 9.2 L21.8 11.5 L18.9 14.4 Z" fill="currentColor"/>
      <path d="M20.7 10.5 Q 24 8.4, 23 4.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
      <g stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
        <line x1="23" y1="4.6" x2="23" y2="2.3"/>
        <line x1="23" y1="4.6" x2="25" y2="3.5"/>
        <line x1="23" y1="4.6" x2="21" y2="3.5"/>
      </g>
      <circle cx="11.8" cy="16.4" r="1.7" fill="__HOLE__" opacity="0.5"/>
    </g>`,
  'gen-radioisotope': () => `
    <g fill="currentColor">
      <rect x="13.4" y="10.5" width="2.2" height="11" rx="0.4"/>
      <rect x="16.4" y="10.5" width="2.2" height="11" rx="0.4"/>
    </g>
    <g stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
      <line x1="7" y1="16" x2="13.4" y2="16"/>
      <line x1="18.6" y1="16" x2="25" y2="16"/>
    </g>`,
  'gen-electric': () => `
    <path d="M 20.8 19.9 A 6 6 0 1 1 21.9 16 L 10.1 16"
          fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  'missile': () => `
    <g transform="translate(16 16) scale(0.8) translate(-16 -16)">
      <path d="M16 3.5 L19.3 11 L12.7 11 Z" fill="currentColor"/>
      <rect x="12.7" y="10.5" width="6.6" height="10.5" rx="0.7" fill="currentColor"/>
      <path d="M12.7 16 L8.6 22 L12.7 20.2 Z" fill="currentColor"/>
      <path d="M19.3 16 L23.4 22 L19.3 20.2 Z" fill="currentColor"/>
      <path d="M14.1 20.8 L16 25.8 L17.9 20.8 Z" fill="currentColor" opacity="0.85"/>
      <rect x="12.7" y="13.6" width="6.6" height="1.5" fill="__HOLE__"/>
    </g>`,
  'raygun': () => `
    <path d="M7 13 H19 V15.8 H13.6 L11.8 21 H8.6 L10.4 15.8 H7 Z" fill="currentColor"/>
    <rect x="19" y="13.2" width="3.4" height="2.4" fill="currentColor"/>
    <g fill="currentColor"><circle cx="24.6" cy="14.4" r="1.05"/><circle cx="27.4" cy="14.4" r="0.8"/></g>`,
  'buggy': () => `
    <rect x="8.5" y="13" width="15" height="5" rx="1.6" fill="currentColor"/>
    <rect x="12" y="10.3" width="6.4" height="3.2" rx="1" fill="currentColor"/>
    <circle cx="12" cy="20" r="2.7" fill="currentColor"/>
    <circle cx="20" cy="20" r="2.7" fill="currentColor"/>
    <circle cx="12" cy="20" r="1.05" fill="__HOLE__"/>
    <circle cx="20" cy="20" r="1.05" fill="__HOLE__"/>
    <line x1="22.2" y1="13" x2="25.4" y2="7.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    <circle cx="25.4" cy="7.6" r="1.1" fill="currentColor"/>`,
  // Thruster type: a rocket engine bell - the combustion chamber pinching to a
  // throat, then a curved, ribbed nozzle flaring to a wide exit. Bold amber
  // silhouette with the stiffening rings cut back to the coin colour. Scaled to
  // 0.8 so it sits a touch smaller in the coin.
  'thruster': () => `
    <g transform="translate(16 16) scale(0.8) translate(-16 -16)">
      <path d="M13.5 5 H18.5 Q19.7 5 19.7 6.2 V10.3 Q19.7 11.8 18.7 12.4 L18.5 13
               C19.2 18, 21.5 23.5, 27.5 27.5 H4.5
               C10.5 23.5, 12.8 18, 13.5 13 L13.3 12.4 Q12.3 11.8 12.3 10.3 V6.2 Q12.3 5 13.5 5 Z" fill="currentColor"/>
      <g stroke="__HOLE__" stroke-width="1.3" stroke-linecap="round">
        <line x1="12" y1="20" x2="20" y2="20"/>
        <line x1="10.3" y1="23" x2="21.7" y2="23"/>
        <line x1="7.8" y1="26" x2="24.2" y2="26"/>
      </g>
    </g>`,
  // Refinery type: an Erlenmeyer flask with liquid - the local water plant.
  'refinery': () => `
    <path d="M12.8 7.8 H19.2 M14 7.8 V13.6 L8.6 24 Q8 26.4 10.4 26.4 H21.6 Q24 26.4 23.4 24 L18 13.6 V7.8"
          fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="M11.2 20.8 L8.6 24 Q8 26.4 10.4 26.4 H21.6 Q24 26.4 23.4 24 L20.8 20.8 Z" fill="currentColor"/>`,
  // Generic robonaut (the rare card with no missile / raygun / buggy property):
  // a simple robot head so the type icon never falls back to an emoji.
  'robonaut-generic': () => `
    <line x1="16" y1="11.4" x2="16" y2="7.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    <circle cx="16" cy="6.8" r="1.5" fill="currentColor"/>
    <rect x="9.3" y="11.2" width="13.4" height="12" rx="3.2" fill="currentColor"/>
    <g fill="__HOLE__"><circle cx="13" cy="16.2" r="1.9"/><circle cx="19" cy="16.2" r="1.9"/></g>
    <rect x="12.8" y="19.4" width="6.4" height="1.7" rx="0.85" fill="__HOLE__"/>`,
};

export const SUPPORT_KIND_CAT = {
  'reactor-fission': 'reactor', 'reactor-fusion': 'reactor', 'reactor-antimatter': 'reactor',
  'gen-radioisotope': 'generator', 'gen-electric': 'generator',
  'missile': 'robonaut', 'raygun': 'robonaut', 'buggy': 'robonaut',
};

// Card TYPE -> { category, glyph } for the header icon. Reactor / generator /
// radiator cards already show the chips they SUPPLY, so only the
// non-supplying types need a type icon here.
const TYPE_ICON = {
  thruster: { cat: 'thruster', glyph: 'thruster' },
  refinery: { cat: 'refinery', glyph: 'refinery' },
  robonaut: { cat: 'robonaut', glyph: 'robonaut-generic' },
};

// True when `kind` has a custom icon (reactor-*/gen-*/missile/raygun/buggy or
// the radiator thermostat), so the renderer can pick SVG over the text glyph.
export function hasSupportIcon(kind) {
  return kind === 'thermostat' || !!SUPPORT_KIND_CAT[kind];
}

// True when `type` has a header type icon (thruster / refinery / robonaut).
export function hasTypeIcon(type) {
  return !!TYPE_ICON[type];
}

// Coin body for a category: square or circle, filled + ringed.
function shapeBody(c) {
  if (c.shape === 'circle') {
    return `<circle cx="16" cy="16" r="15" fill="${c.fill}" stroke="${c.ring}" stroke-width="1.5"/>`;
  }
  return `<rect x="1.5" y="1.5" width="29" height="29" rx="7" fill="${c.fill}" stroke="${c.ring}" stroke-width="1.5"/>`;
}

// Render a category coin + glyph. `cat` keys SUPPORT_CAT; `glyphKey` keys GLYPH.
function coin(cat, glyphKey, { size = 18, cls = 'support-icon' } = {}) {
  const c = SUPPORT_CAT[cat];
  if (!c) return null;
  const glyph = GLYPH[glyphKey] ? GLYPH[glyphKey]().replaceAll('__HOLE__', c.fill) : '';
  return `<svg xmlns="http://www.w3.org/2000/svg"${cls ? ` class="${cls}"` : ''} viewBox="0 0 32 32" width="${size}" height="${size}">${shapeBody(c)}<g color="${c.ink}">${glyph}</g></svg>`;
}

// Inline icon for a reactor / generator / robonaut SUPPORT kind. Square /
// circle / triangle coin + the glyph. Returns null for kinds without an icon.
// `cls` lets the card mark it for CSS; the generator passes '' for clean asset
// files.
export function supportIconSvg(kind, opts = {}) {
  const cat = SUPPORT_KIND_CAT[kind];
  if (!cat) return null;
  return coin(cat, kind, opts);
}

// Inline icon for a card TYPE (thruster / refinery / robonaut) shown next to
// the card-header label. Returns null for types that render their supplied
// chips instead.
export function typeIconSvg(type, opts = {}) {
  const t = TYPE_ICON[type];
  if (!t) return null;
  return coin(t.cat, t.glyph, opts);
}

// One blue thermometer centred at x (32-tall coords).
function thermo(cx) {
  return `<path d="M${cx - 2.2} 9 a2.2 2.2 0 0 1 4.4 0 v8.6 a3.6 3.6 0 1 1 -4.4 0 Z"
          fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>`
    + `<circle cx="${cx}" cy="21.6" r="2.4" fill="currentColor"/>`
    + `<rect x="${cx - 0.8}" y="12.4" width="1.6" height="8.6" rx="0.8" fill="currentColor"/>`;
}

// Radiator therms: N blue thermometers on a WHITE rounded badge (the readable
// backing). Variable width (viewBox 0 0 W 32); width scales to keep aspect.
export function thermBadgeSvg(n = 1, { size = 18, cls = 'support-icon therm-badge' } = {}) {
  const count = Math.max(1, n | 0);
  const slot = 13, w = count * slot + 8;
  let therms = '';
  for (let i = 0; i < count; i++) therms += thermo(4 + slot * i + slot / 2);
  const width = (size * w / 32).toFixed(1);
  return `<svg xmlns="http://www.w3.org/2000/svg"${cls ? ` class="${cls}"` : ''} viewBox="0 0 ${w} 32" width="${width}" height="${size}">`
    + `<rect x="1" y="3" width="${w - 2}" height="26" rx="9" fill="#ffffff" stroke="${THERM_BLUE}" stroke-width="1.2"/>`
    + `<g color="${THERM_BLUE}">${therms}</g></svg>`;
}
