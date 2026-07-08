// Buggy the Rover - the tutorial mascot, as reusable SVG. Pure string builders
// so the tutorial overlay can drop a pose inline (no asset fetch). Poses:
//   'idle'   - arm relaxed
//   'point'  - arm extended right (points at the highlighted control)
//   'cheer'  - both arms up, happy closed eyes (a factory went up / mission done)
// Warm Mars-rover look: cream hull, two camera eyes, mast + antenna, 3 near
// wheels over 3 shadow wheels. No background (drops onto any surface).

export function buggySvg(pose = 'idle', { size = 96 } = {}) {
  const happy = pose === 'cheer';
  const eyes = happy
    ? `<path d="M132 96 q7 7 14 0" fill="none" stroke="#23203a" stroke-width="3.4" stroke-linecap="round"/>
       <path d="M158 96 q7 7 14 0" fill="none" stroke="#23203a" stroke-width="3.4" stroke-linecap="round"/>`
    : `<circle cx="139" cy="97" r="8.5" fill="#23203a"/><circle cx="165" cy="97" r="8.5" fill="#23203a"/>
       <circle cx="136.5" cy="94" r="3" fill="#eaf7ff"/><circle cx="162.5" cy="94" r="3" fill="#eaf7ff"/>`;
  const arm = pose === 'point'
    ? `<g stroke="#33304a" stroke-width="5" fill="none" stroke-linecap="round"><path d="M196 150 q34 -6 60 6"/></g>
       <g fill="#f2812f" stroke="#33304a" stroke-width="4"><circle cx="258" cy="156" r="8"/></g>
       <path d="M262 156 l16 -4 l-6 12 z" fill="#f2812f" stroke="#33304a" stroke-width="3"/>`
    : happy
      ? `<path d="M120 150 q-14 -18 -8 -40" fill="none" stroke="#c99700" stroke-width="6" stroke-linecap="round"/>
         <path d="M180 150 q14 -18 8 -40" fill="none" stroke="#c99700" stroke-width="6" stroke-linecap="round"/>`
      : `<g stroke="#33304a" stroke-width="5" fill="none" stroke-linecap="round"><path d="M120 150 q-20 20 -10 44"/></g>
         <g fill="#c9b892" stroke="#33304a" stroke-width="4"><circle cx="110" cy="196" r="9"/></g>
         <rect x="104" y="196" width="12" height="10" rx="2" fill="#f2812f" stroke="#33304a" stroke-width="3"/>`;
  const vbW = pose === 'point' ? 252 : 250;
  return `<svg width="${size}" height="${Math.round(size * 180 / vbW)}" viewBox="46 46 ${vbW} 180" class="buggy buggy-${pose}" aria-hidden="true">
    <g opacity="0.5">
      ${[104, 150, 196].map((x) => `<circle cx="${x + 16}" cy="205" r="15" fill="#2b2740" stroke="#241f38" stroke-width="3"/>`).join('')}
    </g>
    <g stroke="#33304a" stroke-width="5" stroke-linecap="round" fill="none">
      <path d="M122 178 L104 206 M150 180 L150 206 M178 178 L196 206 M122 178 L150 180 L178 178"/>
    </g>
    <g>${[104, 150, 196].map((x) => `<circle cx="${x}" cy="212" r="17" fill="#3a3652" stroke="#33304a" stroke-width="4"/><circle cx="${x}" cy="212" r="6.5" fill="#f2812f" stroke="#33304a" stroke-width="2.5"/>`).join('')}</g>
    <rect x="96" y="140" width="108" height="44" rx="12" fill="#eaddc4" stroke="#33304a" stroke-width="4.5"/>
    <rect x="104" y="150" width="40" height="26" rx="5" fill="#d8c4a0" stroke="#33304a" stroke-width="3"/>
    <rect x="172" y="150" width="24" height="26" rx="4" fill="#f2812f" stroke="#33304a" stroke-width="3"/>
    <rect x="96" y="132" width="108" height="12" rx="5" fill="#1e3a8a" stroke="#33304a" stroke-width="3"/>
    <line x1="120" y1="132" x2="120" y2="144" stroke="#3b82f6" stroke-width="1.5"/>
    <line x1="150" y1="132" x2="150" y2="144" stroke="#3b82f6" stroke-width="1.5"/>
    <line x1="180" y1="132" x2="180" y2="144" stroke="#3b82f6" stroke-width="1.5"/>
    <path d="M150 132 l-4 -26" stroke="#33304a" stroke-width="5" stroke-linecap="round"/>
    <rect x="122" y="80" width="60" height="30" rx="10" fill="#eaddc4" stroke="#33304a" stroke-width="4.5"/>
    ${eyes}
    <line x1="178" y1="84" x2="196" y2="60" stroke="#33304a" stroke-width="4" stroke-linecap="round"/>
    <circle cx="197" cy="58" r="5" fill="#f2812f" stroke="#33304a" stroke-width="2.5"/>
    ${arm}
  </svg>`;
}
