// Shared plumbing for the generated card art (scripts/gen-card-art.mjs):
// the card-body canvas, the space backdrop + seeded starfield, gradient
// helpers, nozzle / plume shapes, the spacecraft kit and the framing step.
// Each deck (scripts/card-art/<deck>.mjs) draws its faces with these.

// The card body is ~218x209 css px.
export const W = 300, H = 288;
export const f = (n) => Number(n.toFixed(1));

// ---- shared plumbing -------------------------------------------------------

export function svg(defs, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>
  ${defs}
</defs>
${body}
</svg>
`;
}

export function space(c1, c2, cx = '50%', cy = '45%') {
  return {
    defs: `<radialGradient id="bg" cx="${cx}" cy="${cy}" r="85%"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></radialGradient>`,
    body: `<rect width="${W}" height="${H}" fill="url(#bg)"/>`,
  };
}

export function stars(n, seed) {
  let s = 31 + seed * 977;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  let out = '';
  for (let i = 0; i < n; i++) {
    const x = rnd() * W, y = rnd() * H, r = rnd() < 0.18 ? 1.6 : 0.8;
    out += `<circle cx="${f(x)}" cy="${f(y)}" r="${r}" fill="#eef0ff" opacity="${f(0.2 + rnd() * 0.5)}"/>`;
  }
  return out + SUBJECT;   // everything after the starfield is the vessel
}
export const SUBJECT = '<!--subject-->';

export function lin(id, stops, x1 = 0, y1 = 0, x2 = 0, y2 = 1) {
  return `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${
    stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</linearGradient>`;
}
export function rad(id, stops, cx = '50%', cy = '50%', r = '50%') {
  return `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${
    stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</radialGradient>`;
}

// A convergent-divergent bell, opening DOWN. (cx, y) = top of the chamber.
export function bell(cx, y, { chamberW = 40, chamberH = 34, throatW = 16, exitW = 110, len = 120, fill, stroke = 'none' }) {
  const cw = chamberW / 2, tw = throatW / 2, ew = exitW / 2;
  const ty = y + chamberH + 14, ey = ty + len;
  return `<path d="M${cx - cw},${y} L${cx + cw},${y} L${cx + cw},${y + chamberH}
    Q${cx + cw},${ty - 4} ${cx + tw},${ty} Q${cx + tw + 4},${ty + len * 0.55} ${cx + ew},${ey}
    L${cx - ew},${ey} Q${cx - tw - 4},${ty + len * 0.55} ${cx - tw},${ty}
    Q${cx - cw},${ty - 4} ${cx - cw},${y + chamberH} Z" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
}

// A plume fanning out from (x, y) in direction `ang` degrees (0 = down).
export function plume(x, y, ang, len, w0, w1, fill, opacity = 1) {
  const r = (ang * Math.PI) / 180;
  const ux = Math.sin(r), uy = Math.cos(r), px = -uy, py = ux;
  const ex = x + ux * len, ey = y + uy * len;
  return `<path d="M${f(x + px * w0)},${f(y + py * w0)} L${f(ex + px * w1)},${f(ey + py * w1)}
    Q${f(ex + ux * 30)},${f(ey + uy * 30)} ${f(ex - px * w1)},${f(ey - py * w1)} L${f(x - px * w0)},${f(y - py * w0)} Z"
    fill="${fill}" opacity="${opacity}"/>`;
}


// ---- the spacecraft kit ---------------------------------------------------
// Every engine is bolted to a ship. A ship is drawn in its own frame: it
// attaches at (0,0) and its body runs FORWARD along -y (away from the engine).
// `kind` varies the silhouette so the deck is not 24 copies of one hull.

export const SHIP_DEFS = lin('shHull', [[0, '#e3e7ee'], [0.45, '#9aa3b2'], [1, '#3b424f']], 0, 0, 1, 0)
  + rad('shTank', [[0, '#f4f6fa'], [0.55, '#a7b0be'], [1, '#4b5260']], '35%', '35%', '70%')
  + lin('shRad', [[0, '#3a4252'], [1, '#262c38']])
  + lin('shPv', [[0, '#1e3a8a'], [1, '#172554']]);

export function truss(x1, x2, y1, y2, step = 12) {
  let d = `M${x1},${y1} L${x1},${y2} M${x2},${y1} L${x2},${y2}`;
  let flip = false;
  for (let y = y1; y > y2; y -= step) {
    const ny = Math.max(y - step, y2);
    d += flip ? ` M${x1},${y} L${x2},${ny}` : ` M${x2},${y} L${x1},${ny}`;
    flip = !flip;
  }
  return `<path d="${d}" stroke="#8e97a6" stroke-width="2" fill="none"/>`;
}
export function radiator(x, y, w, h) {
  let fins = '';
  for (let i = 1; i < 6; i++) fins += `<line x1="${f(x + (w * i) / 6)}" y1="${y}" x2="${f(x + (w * i) / 6)}" y2="${y + h}" stroke="#56627a" stroke-width="1"/>`;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#shRad)" stroke="#6b7487" stroke-width="1"/>${fins}`;
}
export function solarWing(x, y, w, h) {
  let cells = '';
  for (let i = 1; i < 5; i++) cells += `<line x1="${f(x + (w * i) / 5)}" y1="${y}" x2="${f(x + (w * i) / 5)}" y2="${y + h}" stroke="#60a5fa" stroke-width="0.8" opacity="0.6"/>`;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#shPv)" stroke="#93c5fd" stroke-width="1"/>${cells}`;
}
export function windows(x, y1, y2, step = 9) {
  let w = '';
  for (let y = y1; y > y2; y -= step) w += `<rect x="${x - 2}" y="${y - 3}" width="4" height="4" rx="1" fill="#fde68a"/>`;
  return w;
}
export function capsule(y) {
  return `<path d="M-16,${y} L16,${y} L12,${y - 26} L-12,${y - 26} Z" fill="url(#shHull)"/>
    <path d="M-12,${y - 26} L12,${y - 26} Q10,${y - 44} 0,${y - 50} Q-10,${y - 44} -12,${y - 26} Z" fill="url(#shHull)"/>
    <rect x="-8" y="${y - 22}" width="16" height="5" rx="2" fill="#fde68a"/>
    <line x1="-16" y1="${y - 3}" x2="16" y2="${y - 3}" stroke="#f97316" stroke-width="3"/>`;
}
export function dish(x, y, r = 12) {
  return `<line x1="${x}" y1="${y}" x2="${x + r + 6}" y2="${y - 6}" stroke="#8e97a6" stroke-width="2"/>
    <path d="M${x + r + 6},${y - 6 - r} Q${x + r + 16},${y - 6} ${x + r + 6},${y - 6 + r} Z" fill="#cbd2dc" stroke="#7b8494" stroke-width="1"/>`;
}

export function shipBody(kind) {
  const mount = `<path d="M-22,0 L22,0 L14,-14 L-14,-14 Z" fill="#4b5260" stroke="#8e97a6" stroke-width="1"/>`;
  if (kind === 'tug') {        // propellant tug: spherical tanks on a truss, capsule up front
    return `${mount}${truss(-9, 9, -14, -150)}
      ${radiator(-80, -128, 64, 16)}${radiator(16, -128, 64, 16)}
      <circle cx="0" cy="-42" r="24" fill="url(#shTank)"/><line x1="-24" y1="-42" x2="24" y2="-42" stroke="#6b7487" stroke-width="1.5"/>
      <circle cx="0" cy="-92" r="24" fill="url(#shTank)"/><line x1="-24" y1="-92" x2="24" y2="-92" stroke="#6b7487" stroke-width="1.5"/>
      ${capsule(-150)}${dish(14, -160)}`;
  }
  if (kind === 'crewed') {     // long-haul crewed ship: hab hull with window rows + spin ring
    return `${mount}${truss(-8, 8, -14, -46)}
      ${radiator(-74, -40, 60, 14)}${radiator(14, -40, 60, 14)}
      <rect x="-20" y="-150" width="40" height="104" rx="8" fill="url(#shHull)"/>
      ${windows(-10, -60, -140)}${windows(10, -60, -140)}
      <ellipse cx="0" cy="-104" rx="52" ry="12" fill="none" stroke="#c9d0db" stroke-width="5"/>
      <path d="M-52,-104 A52,12 0 0 0 52,-104" fill="none" stroke="#7b8494" stroke-width="5"/>
      <line x1="-20" y1="-104" x2="-52" y2="-104" stroke="#9aa3b2" stroke-width="2"/><line x1="20" y1="-104" x2="52" y2="-104" stroke="#9aa3b2" stroke-width="2"/>
      ${capsule(-150)}`;
  }
  if (kind === 'freighter') {  // cargo hauler: a stack of containers on a spine
    const boxes = [0, 1, 2, 3].map((i) => `<rect x="-24" y="${-44 - i * 26}" width="48" height="22" rx="2" fill="${['#b45309', '#64748b', '#0f766e', '#94a3b8'][i]}" stroke="#1f2430" stroke-width="1.5"/>`).join('');
    return `${mount}${truss(-6, 6, -14, -150)}${boxes}${radiator(-70, -24, 52, 12)}${radiator(18, -24, 52, 12)}${capsule(-150)}`;
  }
  // probe: a compact bus with solar wings and a big dish
  return `${mount}<rect x="-18" y="-50" width="36" height="36" rx="3" fill="#c8a86b" stroke="#8a6d38" stroke-width="1.5"/>
    ${solarWing(-86, -40, 66, 16)}${solarWing(20, -40, 66, 16)}
    <line x1="-20" y1="-32" x2="20" y2="-32" stroke="#8e97a6" stroke-width="2"/>
    <path d="M-26,-50 Q0,-74 26,-50 Z" fill="#dfe4ea" stroke="#7b8494" stroke-width="1.5"/><line x1="0" y1="-56" x2="0" y2="-70" stroke="#7b8494" stroke-width="2"/>`;
}

// mount: where the ship bolts on, in the scene's own coords; back: the
// direction the ship body runs from there (0 = up, 90 = right, -90 = left);
// comp: the framing applied to ship + engine together.

export function compose(rig, key, svgText) {
  const r = rig[key];
  const withDefs = svgText.replace('</defs>', `${SHIP_DEFS}\n</defs>`);
  if (!r) return withDefs;
  const i = withDefs.indexOf(SUBJECT);
  const head = withDefs.slice(0, i);
  const subject = withDefs.slice(i + SUBJECT.length).replace(/<\/svg>\s*$/, '');
  const ship = `<g transform="translate(${r.mount[0]} ${r.mount[1]}) rotate(${r.back}) scale(${r.s})">${shipBody(r.kind)}</g>`;
  const vessel = r.front ? `${subject}${ship}` : `${ship}${subject}`;
  return `${head}<g transform="${r.comp || ''}">${vessel}</g>\n</svg>\n`;
}

