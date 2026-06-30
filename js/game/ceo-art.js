// CEO Solitaire - outcome illustrations.
//
// Two hand-authored SVG "clip-art" pieces in the 1999-boardroom spirit, shared
// by the intro cutscene and the Board Meeting screen:
//   firedSvg()    - the CEO tumbling out of a skyscraper window (missed the KPI)
//   promotedSvg() - the CEO with a medal, raining stock options (met the KPI)
//
// Pure SVG strings (no DOM, no imports) so they render identically in the app
// and the preview harness. Sized by the caller via the wrapping element; the
// viewBox does the scaling.

// CEO fired: a tall building facade, one window blown open near the top, and a
// figure tumbling down past the glass with flailing limbs + motion streaks.
export function firedSvg(cls = '') {
  return `
  <svg class="ceo-art ceo-art-fired ${cls}" viewBox="0 0 220 240" role="img" aria-label="The CEO falling from a skyscraper window">
    <defs>
      <linearGradient id="firedSky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1a2a44"/><stop offset="100%" stop-color="#0a1322"/>
      </linearGradient>
      <linearGradient id="firedTower" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#33415f"/><stop offset="100%" stop-color="#1d2740"/>
      </linearGradient>
      ${figureOutline('firedFigOutline')}
    </defs>
    <rect x="0" y="0" width="220" height="240" fill="url(#firedSky)"/>
    <!-- skyscraper on the right -->
    <rect x="120" y="0" width="100" height="240" fill="url(#firedTower)" stroke="#46557a" stroke-width="1"/>
    ${windowGrid(132, 14, 4, 9, '#9fd0ff')}
    <!-- the shattered window the CEO fell out of (a clean hole in a uniform
         pane: dark interior + jagged glass shards + radiating cracks) -->
    ${brokenWindow(132, 14)}
    <!-- speed streaks trailing from the window down to the figure -->
    <g stroke="#7fa8d8" stroke-width="2" stroke-linecap="round" opacity="0.6">
      <line x1="118" y1="40" x2="100" y2="78"/>
      <line x1="104" y1="34" x2="88" y2="70"/>
      <line x1="92" y1="52" x2="80" y2="86"/>
    </g>
    <!-- scattered papers -->
    <g fill="#e9eefc" opacity="0.85">
      <rect x="40" y="44" width="12" height="9" transform="rotate(20 46 48)"/>
      <rect x="96" y="58" width="11" height="8" transform="rotate(-25 101 62)"/>
      <rect x="30" y="96" width="10" height="8" transform="rotate(40 35 100)"/>
    </g>
    <!-- the falling CEO, tumbling head-down (outlined so it reads on the sky) -->
    <g transform="rotate(28 78 150)" filter="url(#firedFigOutline)">
      <!-- flailing limbs -->
      <g stroke="#274b86" stroke-width="9" stroke-linecap="round">
        <line x1="78" y1="150" x2="52" y2="132"/>  <!-- left arm up -->
        <line x1="78" y1="150" x2="108" y2="138"/> <!-- right arm out -->
        <line x1="78" y1="178" x2="58" y2="206"/>  <!-- left leg -->
        <line x1="78" y1="178" x2="104" y2="204"/> <!-- right leg -->
      </g>
      <!-- suit torso -->
      <rect x="66" y="146" width="24" height="36" rx="7" fill="#2f3a55"/>
      <!-- tie -->
      <path d="M78 150 l5 8 -5 16 -5 -16 z" fill="#d23b4e"/>
      <!-- head -->
      <circle cx="78" cy="134" r="13" fill="#f0c9a4"/>
      <!-- shocked mouth + eyes -->
      <circle cx="73" cy="132" r="1.8" fill="#1b2233"/>
      <circle cx="83" cy="132" r="1.8" fill="#1b2233"/>
      <ellipse cx="78" cy="140" rx="3" ry="4" fill="#1b2233"/>
    </g>
  </svg>`;
}

// CEO promoted: a proud figure with a gold medal, a rising green stock arrow
// behind, and stock-option dollar tokens raining down.
export function promotedSvg(cls = '') {
  return `
  <svg class="ceo-art ceo-art-promoted ${cls}" viewBox="0 0 220 240" role="img" aria-label="The CEO promoted, with a medal and riches">
    <defs>
      <linearGradient id="promoSky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#10331f"/><stop offset="100%" stop-color="#0a1f14"/>
      </linearGradient>
      <radialGradient id="promoGlow" cx="50%" cy="34%" r="55%">
        <stop offset="0%" stop-color="rgba(245,197,66,0.30)"/><stop offset="100%" stop-color="rgba(245,197,66,0)"/>
      </radialGradient>
      ${figureOutline('promoFigOutline')}
    </defs>
    <rect x="0" y="0" width="220" height="240" fill="url(#promoSky)"/>
    <rect x="0" y="0" width="220" height="240" fill="url(#promoGlow)"/>
    <!-- rising stock arrow behind -->
    <polyline points="24,196 70,156 100,176 168,96" fill="none" stroke="#4ade80" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>
    <polygon points="168,92 184,92 168,108" fill="#4ade80" opacity="0.85"/>
    <!-- raining stock-option $ tokens -->
    <g font-family="Georgia, serif" font-weight="700" font-size="15" fill="#0a1f14">
      ${coin(40, 50)} ${coin(186, 60)} ${coin(150, 36)} ${coin(64, 30)}
    </g>
    <!-- pedestal -->
    <rect x="74" y="214" width="72" height="14" rx="3" fill="#caa23a"/>
    <rect x="84" y="206" width="52" height="10" rx="2" fill="#e6c451"/>
    <!-- the promoted CEO (outlined so it reads on the dark ground) -->
    <g filter="url(#promoFigOutline)">
      <!-- legs -->
      <g stroke="#2f3a55" stroke-width="11" stroke-linecap="round">
        <line x1="103" y1="182" x2="98" y2="206"/>
        <line x1="117" y1="182" x2="122" y2="206"/>
      </g>
      <!-- one arm raised in triumph -->
      <g stroke="#2f3a55" stroke-width="10" stroke-linecap="round">
        <line x1="98" y1="150" x2="78" y2="120"/>
        <line x1="122" y1="150" x2="138" y2="166"/>
      </g>
      <circle cx="76" cy="116" r="6" fill="#f0c9a4"/> <!-- raised fist -->
      <!-- torso (suit) -->
      <rect x="92" y="140" width="36" height="46" rx="9" fill="#2f3a55"/>
      <!-- tie -->
      <path d="M110 146 l5 8 -5 20 -5 -20 z" fill="#3b82c4"/>
      <!-- head -->
      <circle cx="110" cy="128" r="15" fill="#f0c9a4"/>
      <!-- smile + eyes -->
      <circle cx="104" cy="125" r="1.9" fill="#1b2233"/>
      <circle cx="116" cy="125" r="1.9" fill="#1b2233"/>
      <path d="M103 132 q7 7 14 0" fill="none" stroke="#1b2233" stroke-width="2" stroke-linecap="round"/>
    </g>
  </svg>`;
}

// A reusable SVG filter that draws a crisp light outline around whatever group
// it is applied to: dilate the source alpha, flood it light, and lay the
// original art back on top. Reads on any background (the navy CEO otherwise
// blends into the dark sky / green). Plus a soft drop shadow for depth.
function figureOutline(id) {
  return `<filter id="${id}" x="-25%" y="-25%" width="150%" height="150%">
      <feMorphology in="SourceAlpha" operator="dilate" radius="2.2" result="o"/>
      <feFlood flood-color="#eef3ff" result="oc"/>
      <feComposite in="oc" in2="o" operator="in" result="outline"/>
      <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity="0.45"/>
      <feMerge><feMergeNode in="outline"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>`;
}

// A uniform grid of lit windows on a tower face.
function windowGrid(x0, y0, cols, rows, fill) {
  let s = '<g fill="' + fill + '" opacity="0.55">';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      s += `<rect x="${x0 + c * 22}" y="${y0 + r * 24}" width="14" height="15" rx="1"/>`;
    }
  }
  return s + '</g>';
}

// A shattered window: a clean dark hole punched in one uniform pane, with a few
// jagged glass shards still clinging to the frame and cracks radiating out.
// Drawn over the top-left window cell (x0,y0) so it reads as where he fell out.
function brokenWindow(x0, y0) {
  const x = x0, y = y0, w = 14, h = 15;
  return `<g>
    <!-- dark interior showing through the hole -->
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1" fill="#060b14"/>
    <!-- jagged glass shards clinging to the frame -->
    <g fill="#bfe0ff" opacity="0.8">
      <polygon points="${x},${y} ${x + 5},${y} ${x},${y + 6}"/>
      <polygon points="${x + w},${y} ${x + w},${y + 7} ${x + w - 5},${y}"/>
      <polygon points="${x},${y + h} ${x + 6},${y + h} ${x},${y + h - 6}"/>
      <polygon points="${x + w},${y + h} ${x + w - 5},${y + h} ${x + w},${y + h - 6}"/>
    </g>
    <!-- cracks radiating into the neighbouring panes -->
    <g stroke="#cfe6ff" stroke-width="0.9" opacity="0.7">
      <line x1="${x}" y1="${y + h / 2}" x2="${x - 6}" y2="${y + h / 2 - 3}"/>
      <line x1="${x + w / 2}" y1="${y + h}" x2="${x + w / 2 + 2}" y2="${y + h + 6}"/>
    </g>
  </g>`;
}

// A gold $ coin token at (x,y).
function coin(x, y) {
  return `<g><circle cx="${x}" cy="${y}" r="11" fill="#f5c542" stroke="#caa23a" stroke-width="1.5"/><text x="${x}" y="${y + 5}" text-anchor="middle">$</text></g>`;
}
