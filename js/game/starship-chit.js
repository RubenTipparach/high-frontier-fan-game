// The M4 starship chit (Isobank / Starship placard): the starship over a
// gold-rimmed disc, with the isovault hexagon on top. Each player's triangle
// carries their isovault count in their seat colour; the centre hexagon is the
// Speculator's isovault. Drawn on the map at the isobank and behind the Bank
// tab's isovault hexagon.
const ART = `<defs>
    <radialGradient id="ss-bg" cx="45%" cy="40%" r="70%"><stop offset="0%" stop-color="#2a2f5c"/><stop offset="100%" stop-color="#0b0d1f"/></radialGradient>
    <linearGradient id="ss-hull" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#9aa4b8"/><stop offset="50%" stop-color="#f2f5fa"/><stop offset="100%" stop-color="#8a94a8"/></linearGradient>
    <radialGradient id="ss-bead" cx="35%" cy="30%" r="70%"><stop offset="0%" stop-color="#fff4c0"/><stop offset="60%" stop-color="#ffd24a"/><stop offset="100%" stop-color="#a87a10"/></radialGradient>
    <radialGradient id="ss-flame" cx="50%" cy="0%" r="100%"><stop offset="0%" stop-color="#ffffff"/><stop offset="40%" stop-color="#9af0ff"/><stop offset="100%" stop-color="#3a7aff" stop-opacity="0"/></radialGradient>
  </defs>
  <g fill="#fff">
    <circle cx="22" cy="28" r="0.9"/><circle cx="74" cy="22" r="0.7"/><circle cx="80" cy="64" r="0.9"/><circle cx="18" cy="66" r="0.7"/><circle cx="30" cy="80" r="0.6"/><circle cx="70" cy="82" r="0.6"/><circle cx="62" cy="14" r="0.6"/>
  </g>
  <path d="M41,80 Q50,98 59,80 Z" fill="url(#ss-flame)"/>
  <ellipse cx="50" cy="77" rx="14" ry="3.2" fill="#6a7488"/>
  <ellipse cx="50" cy="76" rx="14" ry="2.6" fill="url(#ss-hull)"/>
  <rect x="47.6" y="24" width="4.8" height="52" rx="2" fill="url(#ss-hull)"/>
  <g>
    <circle cx="41.5" cy="58" r="4.2" fill="url(#ss-bead)"/><circle cx="58.5" cy="58" r="4.2" fill="url(#ss-bead)"/>
    <circle cx="41.5" cy="48" r="4.2" fill="url(#ss-bead)"/><circle cx="58.5" cy="48" r="4.2" fill="url(#ss-bead)"/>
    <circle cx="50" cy="53" r="4.6" fill="url(#ss-bead)"/>
  </g>
  <path d="M38,38 L62,38 L58,34 L42,34 Z" fill="#3a4250"/>
  <path d="M43.5,34 L56.5,34 L54,22 Q50,14 46,22 Z" fill="url(#ss-hull)"/>
  <circle cx="50" cy="26" r="2" fill="#5ad0ff"/>`;
// The starship art alone (defs + stars + ship), in a 100 x 100 box.
export function starshipArtSvg() { return ART; }
const ORDER = [[4, 5], [5, 0], [0, 1], [1, 2], [2, 3], [3, 4]];   // top seat, then clockwise
const NUM = 'font-family="Inter,Arial,sans-serif" font-weight="800" text-anchor="middle" stroke="#0b0d1f" paint-order="stroke"';
// players: [{ color, isovault }] in seat order; market: the Speculator's count.
export function starshipChitSvg(players, market) {
  const C = 50, R = 40, r = 15;
  const v = (k, rad = R) => [C + rad * Math.cos(Math.PI / 3 * k), C + rad * Math.sin(Math.PI / 3 * k)];
  const pt = (q) => `${q[0].toFixed(2)},${q[1].toFixed(2)}`;
  const list = Array.isArray(players) ? players : [];
  let cells = '';
  ORDER.forEach(([a, b], i) => {
    const q = list[i];
    const A = v(a), B = v(b);
    const col = q ? (q.color || '#9aa4b8') : '#c9a227';
    cells += `<polygon points="${pt([C, C])} ${pt(A)} ${pt(B)}" fill="${col}" fill-opacity="${q ? 0.32 : 0}" stroke="${col}" stroke-opacity="${q ? 1 : 0.35}" stroke-width="2" stroke-linejoin="round"/>`;
    if (q) {
      const m = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
      const at = [C + 0.68 * (m[0] - C), C + 0.68 * (m[1] - C)];
      cells += `<text x="${at[0].toFixed(1)}" y="${(at[1] + 4.2).toFixed(1)}" ${NUM} font-size="12" fill="#fff" stroke-width="2.2">${Math.max(0, q.isovault | 0)}</text>`;
    }
  });
  const inner = Array.from({ length: 6 }, (_, k) => pt(v(k, r))).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">`
    + `<circle cx="50" cy="50" r="48" fill="#c9a227"/><circle cx="50" cy="50" r="44.5" fill="url(#ss-bg)"/>${ART}`
    + `${cells}<polygon points="${inner}" fill="#0f1120" fill-opacity="0.45" stroke="#c9a227" stroke-width="1.6"/>`
    + `<text x="50" y="55" ${NUM} font-size="13" fill="#ffd24a" stroke-width="2.4">${Math.max(0, market | 0)}</text></svg>`;
}

// The map form: the isovault hexagon alone, flat-top, the same size as a site
// hexagon, with the starship behind it. Corners touch the 100 x 100 box edge.
export function starshipHexSvg(players, market, rim = '#c9a227') {
  const C = 50, R = 49, r = 18;
  const v = (k, rad = R) => [C + rad * Math.cos(Math.PI / 3 * k), C + rad * Math.sin(Math.PI / 3 * k)];
  const pt = (q) => `${q[0].toFixed(2)},${q[1].toFixed(2)}`;
  const list = Array.isArray(players) ? players : [];
  const outer = Array.from({ length: 6 }, (_, k) => pt(v(k))).join(' ');
  let cells = '';
  ORDER.forEach(([a, b], i) => {
    const q = list[i];
    const A = v(a, R - 2), B = v(b, R - 2);
    const col = q ? (q.color || '#9aa4b8') : '#c9a227';
    cells += `<polygon points="${pt([C, C])} ${pt(A)} ${pt(B)}" fill="${col}" fill-opacity="${q ? 0.34 : 0}" stroke="${col}" stroke-opacity="${q ? 1 : 0.35}" stroke-width="2.4" stroke-linejoin="round"/>`;
    if (q) {
      const m = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
      const at = [C + 0.68 * (m[0] - C), C + 0.68 * (m[1] - C)];
      cells += `<text x="${at[0].toFixed(1)}" y="${(at[1] + 5).toFixed(1)}" ${NUM} font-size="15" fill="#fff" stroke-width="2.8">${Math.max(0, q.isovault | 0)}</text>`;
    }
  });
  const inner = Array.from({ length: 6 }, (_, k) => pt(v(k, r))).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">`
    + `<defs><clipPath id="ss-hexclip"><polygon points="${outer}"/></clipPath></defs>`
    + `<polygon points="${outer}" fill="url(#ss-bg)"/><g clip-path="url(#ss-hexclip)">${ART}</g>`
    + `${cells}<polygon points="${inner}" fill="#0f1120" fill-opacity="0.5" stroke="#c9a227" stroke-width="2"/>`
    + `<polygon points="${outer}" fill="none" stroke="#0b0d1f" stroke-width="6" stroke-linejoin="round"/>`
    + `<polygon points="${outer}" fill="none" stroke="${rim}" stroke-width="3.6" stroke-linejoin="round"/>`
    + `<text x="50" y="56" ${NUM} font-size="16" fill="#ffd24a" stroke-width="3">${Math.max(0, market | 0)}</text></svg>`;
}
