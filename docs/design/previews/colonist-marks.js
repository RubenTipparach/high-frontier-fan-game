// Laurel leaves along an arc, mirrored.
function laurel(side) {
  let s = '';
  for (let i = 0; i < 7; i++) {
    const t = (125 + i * 19) * Math.PI / 180;           // left arc, bottom to top
    let x = 40 + Math.cos(t) * 27, y = 44 + Math.sin(t) * 27;
    let rot = (125 + i * 19) + 90 + 25;
    if (side < 0) { x = 80 - x; rot = -rot; }
    s += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="3" ry="6.5" transform="rotate(${rot.toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="#ff8a2a" stroke="#ffd08a" stroke-width="0.8"/>`;
  }
  return s;
}
export const SHIRT_LAUREL = `<svg width="80" height="80" viewBox="0 0 80 80">
  <defs><radialGradient id="sbg"><stop offset="0" stop-color="#ffb347" stop-opacity=".9"/><stop offset="1" stop-color="#ff6a00" stop-opacity="0"/></radialGradient></defs>
  <circle cx="40" cy="40" r="34" fill="url(#sbg)"/>
  ${laurel(1)}${laurel(-1)}
  <g fill="#fff3d6" stroke="#ff8a2a" stroke-width="1.2">
    <circle cx="40" cy="22" r="5.5"/>
    <path d="M40 29 L28 18 L25.5 20.5 L36 32 L36 50 L31 62 L34.5 63.5 L40 52 L45.5 63.5 L49 62 L44 50 L44 32 L54.5 20.5 L52 18 Z"/>
  </g>
</svg>`;
function gear(cx, cy, r, teeth) {
  let d = '';
  for (let i = 0; i < teeth * 2; i++) {
    const a0 = (i / (teeth * 2)) * Math.PI * 2, a1 = ((i + 1) / (teeth * 2)) * Math.PI * 2;
    const rr = i % 2 ? r : r * 1.22;
    d += `${i ? 'L' : 'M'}${(cx + Math.cos(a0) * rr).toFixed(1)} ${(cy + Math.sin(a0) * rr).toFixed(1)} L${(cx + Math.cos(a1) * rr).toFixed(1)} ${(cy + Math.sin(a1) * rr).toFixed(1)} `;
  }
  return d + 'Z';
}
export const ROBOT_GEAR = `<svg width="48" height="48" viewBox="0 0 48 48">
  <path d="${gear(24, 24, 16, 10)}" fill="#7d6a9e" stroke="#4b3d66" stroke-width="1.2"/>
  <circle cx="24" cy="24" r="7" fill="#2b2238" stroke="#4b3d66" stroke-width="1.2"/>
</svg>`;

// Spaceborn emblem: a baby curled in a ball (white disc, black figure), as printed.
export const SPACEBORN_EMBLEM = `<svg width="31" height="31" viewBox="0 0 26 26">
  <circle cx="12" cy="14" r="10.5" fill="#fff" stroke="#111" stroke-width="1.6"/>
  <circle cx="20.5" cy="5" r="3.2" fill="#fff" stroke="#111" stroke-width="1.4"/>
  <circle cx="14.6" cy="9.4" r="2.9" fill="#111"/>
  <path d="M12.6 12.2c-3.2.2-5.6 2.4-5.6 5.2 0 2.3 1.9 3.6 4.4 3.6h4.8c1.3 0 1.9-1.3 1.1-2.2l-1.9-1.8 1.6-.6c1-.4 1.1-1.6.2-2.1l-2.4-1.5z" fill="#111"/>
  <path d="M8.6 19.6l-2.4 1.6M15.6 15.2l3 .6" stroke="#111" stroke-width="1.6" stroke-linecap="round"/>
</svg>`;
