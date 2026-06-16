// Custom UI icon set for the toolbar tabs and the stack switcher. Pure: every
// export returns an inline-SVG string (no DOM, no node imports), so it can be
// injected into a button or a chip. Base lines use `currentColor` (a tab tints
// grey when idle, white / blue when active); accent fills are fixed palette
// colours so they pop. No emoji anywhere.

const GOLD = '#f6b51e';
const MAG = '#e60a7e';
const CY = '#52caf2';
const RED = '#ef5350';
const GRN = '#46c46a';
const ORA = '#f4902a';

// 8-tooth cog silhouette for the config gear (alternating tip / valley radii).
function gearPath(cx, cy, rO, rI, teeth) {
  const n = teeth * 2;
  const p = [];
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const r = (i % 2 === 0) ? rO : rI;
    p.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${p.join(' L')} Z`;
}
const GEAR = gearPath(12, 12, 10, 6.4, 8);

export const UI_ICONS = {
  // ---- toolbar tabs ----
  cart: `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3.5h2.2l2 11h10l2-8H7"/></g><circle cx="9" cy="20" r="1.7" fill="${GOLD}"/><circle cx="17" cy="20" r="1.7" fill="${GOLD}"/>`,
  patents: `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M5 7v11a2 2 0 0 0 2 2h8"/><rect x="8" y="4" width="11" height="15" rx="2"/></g><rect x="8" y="4" width="11" height="3.4" rx="2" fill="${CY}"/>`,
  mp: `<g stroke="none"><circle cx="8" cy="9" r="2.7" fill="${MAG}"/><path d="M3.5 19a4.5 4.5 0 0 1 9 0z" fill="${MAG}"/><circle cx="16" cy="9" r="2.7" fill="${CY}"/><path d="M11.5 19a4.5 4.5 0 0 1 9 0z" fill="${CY}"/></g>`,
  assembly: `<g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round"><line x1="3" y1="20" x2="21" y2="20"/><line x1="6" y1="10" x2="6" y2="18"/><line x1="10" y1="10" x2="10" y2="18"/><line x1="14" y1="10" x2="14" y2="18"/><line x1="18" y1="10" x2="18" y2="18"/></g><path d="M3 9 12 4l9 5z" fill="${GOLD}" stroke="${GOLD}" stroke-width="1.5" stroke-linejoin="round"/>`,
  // Game mode: all white (currentColor), per request.
  solo: `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="8" width="19" height="9.5" rx="4.5"/><line x1="7" y1="11" x2="7" y2="14.5"/><line x1="5.2" y1="12.7" x2="8.8" y2="12.7"/></g><circle cx="15.5" cy="11.8" r="1.3" fill="currentColor"/><circle cx="18" cy="14" r="1.3" fill="currentColor"/>`,
  milestones: `<path d="M7 4h10v4a5 5 0 0 1-10 0z" fill="${GOLD}"/><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 5.5H4.5A2.5 2.5 0 0 0 7 9.5"/><path d="M17 5.5h2.5A2.5 2.5 0 0 1 17 9.5"/><line x1="12" y1="13" x2="12" y2="16"/><path d="M8.5 20h7l-1-3.5h-5z"/></g>`,
  log: `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><rect x="5" y="4.5" width="14" height="16" rx="2"/><line x1="8.5" y1="11" x2="15.5" y2="11"/><line x1="8.5" y1="14.5" x2="13.5" y2="14.5"/></g><rect x="9" y="2.6" width="6" height="3.4" rx="1.4" fill="${RED}"/>`,
  search: `<circle cx="11" cy="11" r="6" fill="${CY}" fill-opacity="0.22"/><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6"/><line x1="15.5" y1="15.5" x2="20.5" y2="20.5"/></g>`,
  config: `<path d="${GEAR}" fill="currentColor"/><circle cx="12" cy="12" r="3" fill="#0b1020"/>`,
  // ---- stack switcher ----
  leo: `<circle cx="11" cy="13" r="5.2" fill="${CY}"/><g fill="none" stroke="currentColor" stroke-width="1.7"><ellipse cx="12" cy="12" rx="10.5" ry="4.4" transform="rotate(-24 12 12)"/></g><circle cx="20.4" cy="7.6" r="1.7" fill="${GOLD}"/>`,
  rocket: `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M12 2c3 2.6 4 7 4 10.5L8 12.5C8 9 9 4.6 12 2Z"/><path d="M8 12.5 5 16l3-0.8"/><path d="M16 12.5 19 16l-3-0.8"/></g><circle cx="12" cy="9" r="1.8" fill="${CY}"/><path d="M10 16.4 12 21l2-4.6z" fill="${ORA}"/>`,
  outpost: `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17a8 8 0 0 1 16 0"/><line x1="2.5" y1="17.5" x2="21.5" y2="17.5"/><line x1="12" y1="9.5" x2="12" y2="5"/></g><circle cx="12" cy="4.4" r="1.7" fill="${GRN}"/>`,
};

// Inline <svg> string for an icon name. `size` sets width/height (the viewBox is
// always 24x24). Returns '' for an unknown name.
export function uiIcon(name, { size = 24 } = {}) {
  const g = UI_ICONS[name];
  if (!g) return '';
  return `<svg class="ui-icon ui-icon-${name}" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${g}</svg>`;
}
