// Module 4 (Exodus) colonists: the SVG version of their card-body art, drawn
// with the same recipe and primitives as the M2 deck (scripts/gen-colonist-art.mjs
// calls drawM4 and hands it its helpers; docs/colonist-art-guide.md). 16 cards:
// six robots (black fronts) and ten spaceborn humans, front + promoted back.
//
// Planets and asteroids are NEVER drawn here: they are Blender renders
// (user 2026-11-15). Where a concept needs a world, the scene stays on the
// people and machines instead.
//
// These are a CANDIDATE set, shown beside the Blender versions
// (scripts/card-art/blender/render_colonists_m4.py) for the user to choose;
// none of them is in COLONIST_ART_IDS until then.

export const M4_COLONIST_IDS = [
  'col_cobots', 'col_beowulf_internet', 'col_self_designing_heuristics', 'col_combat_quadrupeds',
  'col_sensor_web_sail', 'col_nano_3d_printers', 'col_lava_lamp_evangelists',
  'col_gabonese_mining_consortium', 'col_prehensilists', 'col_exoskeletalists', 'col_teleoperators',
  'col_boston_hexapods', 'col_neural_pilots', 'col_vr_simulcasters', 'col_transhuman_activists',
  'col_clone_entrepreneurs',
];

export function drawM4(h) {
  const { W, H, panel, starsField, purpleBackDefs, emit, beardedManFace, biomechArm, profileHeadChip, sailScene } = h;
  const CX = W * 0.5, CY = H * 0.46;
  const bg = (id, c0, c1, cx = '50%', cy = '40%') =>
    `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="85%"><stop offset="0%" stop-color="${c0}"/><stop offset="100%" stop-color="${c1}"/></radialGradient>`;
  const rect = (fill) => `<rect width="${W}" height="${H}" fill="${fill}"/>`;

  // ---- M4 primitives ----
  // A standing person in a soft suit: head, torso, legs; `pose` lifts an arm.
  const person = ({ cx, base, s = 1, suit, skin = '#c9a888', visor = null, armUp = false }) => {
    const hy = base - 150 * s;
    return `<g>
      <path d="M${cx - 22 * s},${base} L${cx - 18 * s},${base - 70 * s} L${cx - 28 * s},${hy + 40 * s} Q${cx},${hy + 26 * s} ${cx + 28 * s},${hy + 40 * s} L${cx + 18 * s},${base - 70 * s} L${cx + 22 * s},${base} Z" fill="${suit}"/>
      <path d="M${cx - 28 * s},${hy + 42 * s} L${cx - 42 * s},${base - 64 * s}" stroke="${suit}" stroke-width="${12 * s}" stroke-linecap="round"/>
      <path d="M${cx + 28 * s},${hy + 42 * s} ${armUp ? `L${cx + 46 * s},${hy + 4 * s}` : `L${cx + 42 * s},${base - 64 * s}`}" stroke="${suit}" stroke-width="${12 * s}" stroke-linecap="round"/>
      <circle cx="${cx}" cy="${hy + 16 * s}" r="${17 * s}" fill="${skin}"/>
      ${visor ? `<rect x="${cx - 14 * s}" y="${hy + 10 * s}" width="${28 * s}" height="${8 * s}" rx="${4 * s}" fill="${visor}"/>` : ''}
    </g>`;
  };
  // A round-headed service robot (the white "cobot" body plan).
  const cobot = ({ cx, cy, s = 1, shell = '#eef1f4', face = '#14161a', eye = '#7fd0ff' }) => `<g>
      <rect x="${cx - 34 * s}" y="${cy}" width="${68 * s}" height="${90 * s}" rx="${26 * s}" fill="${shell}"/>
      <ellipse cx="${cx}" cy="${cy - 28 * s}" rx="${40 * s}" ry="${34 * s}" fill="${shell}"/>
      <ellipse cx="${cx}" cy="${cy - 26 * s}" rx="${30 * s}" ry="${20 * s}" fill="${face}"/>
      <circle cx="${cx - 11 * s}" cy="${cy - 27 * s}" r="${5 * s}" fill="${eye}"/><circle cx="${cx + 11 * s}" cy="${cy - 27 * s}" r="${5 * s}" fill="${eye}"/>
      <rect x="${cx - 52 * s}" y="${cy + 10 * s}" width="${16 * s}" height="${56 * s}" rx="${8 * s}" fill="${shell}"/>
      <rect x="${cx + 36 * s}" y="${cy + 10 * s}" width="${16 * s}" height="${56 * s}" rx="${8 * s}" fill="${shell}"/>
    </g>`;
  // A legged walker: a body bar on N legs (4 = quadruped, 6 = hexapod).
  const walker = ({ cx, cy, legs = 4, s = 1, body = '#5a5f66', joint = '#c8ccd2', head = true }) => {
    const span = 140 * s;
    const out = [`<rect x="${cx - span / 2}" y="${cy - 16 * s}" width="${span}" height="${32 * s}" rx="${14 * s}" fill="${body}"/>`];
    for (let i = 0; i < legs; i++) {
      const x = cx - span / 2 + 14 * s + (i * (span - 28 * s)) / (legs - 1);
      const dir = i < legs / 2 ? -1 : 1;
      out.push(`<path d="M${x},${cy + 8 * s} L${x + dir * 18 * s},${cy + 46 * s} L${x + dir * 6 * s},${cy + 86 * s}" stroke="${body}" stroke-width="${10 * s}" fill="none" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${x + dir * 18 * s}" cy="${cy + 46 * s}" r="${6 * s}" fill="${joint}"/>`);
    }
    if (head) out.push(`<rect x="${cx + span / 2 - 6 * s}" y="${cy - 34 * s}" width="${40 * s}" height="${26 * s}" rx="${8 * s}" fill="${body}"/><circle cx="${cx + span / 2 + 24 * s}" cy="${cy - 21 * s}" r="${6 * s}" fill="#ff5a4a"/>`);
    return out.join('');
  };
  // A web of glowing nodes joined by lines, deterministic from `seed`.
  const nodeWeb = ({ cx, cy, r, n, seed, line = '#7fd0ff', node = '#e6f6ff' }) => {
    let s = seed * 7919 + 13;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    const pts = Array.from({ length: n }, () => { const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r; return [cx + Math.cos(a) * d, cy + Math.sin(a) * d * 1.1]; });
    const lines = [];
    pts.forEach((p, i) => pts.forEach((q, j) => { if (j > i && Math.hypot(p[0] - q[0], p[1] - q[1]) < r * 0.55) lines.push(`<line x1="${p[0].toFixed(1)}" y1="${p[1].toFixed(1)}" x2="${q[0].toFixed(1)}" y2="${q[1].toFixed(1)}" stroke="${line}" stroke-width="1.2" opacity="0.55"/>`); }));
    return lines.join('') + pts.map(([x, y], i) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${i % 5 ? 2.6 : 4.4}" fill="${node}"/>`).join('');
  };
  // A glass growth vat with a glowing fluid and a curled form inside.
  const vat = ({ cx, cy, fluid = '#7fe0c0', form = '#f2b8a8' }) => `<g>
      <rect x="${cx - 34}" y="${cy - 80}" width="68" height="160" rx="30" fill="${fluid}" opacity="0.35"/>
      <rect x="${cx - 34}" y="${cy - 80}" width="68" height="160" rx="30" fill="none" stroke="#e6f2f0" stroke-width="3" opacity="0.8"/>
      <ellipse cx="${cx}" cy="${cy + 4}" rx="20" ry="28" fill="${form}" opacity="0.9"/><circle cx="${cx + 4}" cy="${cy - 22}" r="13" fill="${form}"/>
      <rect x="${cx - 40}" y="${cy + 78}" width="80" height="14" rx="4" fill="#5a6470"/><rect x="${cx - 40}" y="${cy - 92}" width="80" height="14" rx="4" fill="#5a6470"/>
    </g>`;
  // A sleek delta spacecraft, nose to the right.
  const deltaShip = ({ cx, cy, s = 1, hull = '#d8dde4', trim = '#3a4250', glowC = '#7fd0ff' }) => `<g>
      <path d="M${cx + 90 * s},${cy} L${cx - 60 * s},${cy - 34 * s} L${cx - 40 * s},${cy} L${cx - 60 * s},${cy + 34 * s} Z" fill="${hull}"/>
      <path d="M${cx + 90 * s},${cy} L${cx - 40 * s},${cy} L${cx - 60 * s},${cy + 34 * s} Z" fill="${trim}" opacity="0.5"/>
      <path d="M${cx + 30 * s},${cy - 6 * s} L${cx + 56 * s},${cy - 2 * s} L${cx + 30 * s},${cy + 2 * s} Z" fill="${glowC}"/>
      <ellipse cx="${cx - 52 * s}" cy="${cy}" rx="${16 * s}" ry="${8 * s}" fill="${glowC}" opacity="0.85"/>
    </g>`;

  // ---- ROBOTS (black working fronts) ----
  // 1. Cobots / Singularity: a service robot shoulder to shoulder with a person;
  // back, a family silhouetted against a dawn of their own making.
  emit('col_cobots', 'front', panel({ defs: bg('cb-bg', '#20262e', '#06080b'),
    inner: `${rect('url(#cb-bg)')}${starsField(10, 101)}${person({ cx: CX - 46, base: H - 10, s: 1.1, suit: '#2e3d55', skin: '#7a4e34' })}${cobot({ cx: CX + 48, cy: CY + 10, s: 1.15 })}` }));
  emit('col_cobots', 'back', panel({ defs: `${purpleBackDefs('cb2-bg')}<linearGradient id="cb2-dawn" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#ffd59a" stop-opacity="0"/><stop offset="100%" stop-color="#ffd59a" stop-opacity="0.7"/></linearGradient>`,
    inner: `${rect('url(#cb2-bg)')}${starsField(12, 102)}<rect y="${H * 0.55}" width="${W}" height="${H * 0.45}" fill="url(#cb2-dawn)"/>
      ${[[-60, 1.0], [-10, 0.75], [40, 1.05], [80, 0.6]].map(([dx, s]) => person({ cx: CX + dx, base: H - 6, s, suit: '#2a1c44', skin: '#2a1c44' })).join('')}` }));
  // 2. Beowulf Internet / Grendel: a mesh of relay nodes; back, the mesh grown
  // into one creature-like superorganism.
  emit('col_beowulf_internet', 'front', panel({ defs: bg('bw-bg', '#12243a', '#04070c'),
    inner: `${rect('url(#bw-bg)')}${starsField(14, 103)}${nodeWeb({ cx: CX, cy: CY, r: 120, n: 34, seed: 4 })}` }));
  emit('col_beowulf_internet', 'back', panel({ defs: purpleBackDefs('bw2-bg'),
    inner: `${rect('url(#bw2-bg)')}${starsField(8, 104)}${nodeWeb({ cx: CX, cy: CY, r: 90, n: 46, seed: 9, line: '#e6d6ff', node: '#ffffff' })}
      <path d="M${CX - 90},${CY + 90} Q${CX},${CY - 140} ${CX + 90},${CY + 90}" stroke="#e6d6ff" stroke-width="3" fill="none" opacity="0.6"/>
      <circle cx="${CX - 22}" cy="${CY - 30}" r="7" fill="#ffe08a"/><circle cx="${CX + 22}" cy="${CY - 30}" r="7" fill="#ffe08a"/>` }));
  // 3. Self-designing Heuristics / Apex Algorithms: a brain of nodes rewriting
  // itself; back, the pure logic glyphs it distilled.
  emit('col_self_designing_heuristics', 'front', panel({ defs: bg('sh-bg', '#1c2440', '#05060c'),
    inner: `${rect('url(#sh-bg)')}${starsField(10, 105)}
      <path d="M${CX - 80},${CY + 20} Q${CX - 96},${CY - 70} ${CX - 10},${CY - 84} Q${CX + 70},${CY - 92} ${CX + 86},${CY - 10} Q${CX + 96},${CY + 60} ${CX + 20},${CY + 70} Q${CX - 60},${CY + 84} ${CX - 80},${CY + 20} Z" fill="none" stroke="#8fb4ff" stroke-width="2" opacity="0.7"/>
      ${nodeWeb({ cx: CX, cy: CY - 6, r: 78, n: 30, seed: 11, line: '#8fb4ff', node: '#dfe8ff' })}
      ${[[-50, -40], [40, -50], [10, 30]].map(([dx, dy]) => `<text x="${CX + dx}" y="${CY + dy}" font-family="monospace" font-size="18" font-weight="700" fill="#ffd36b">+</text>`).join('')}` }));
  emit('col_self_designing_heuristics', 'back', panel({ defs: purpleBackDefs('sh2-bg'),
    inner: `${rect('url(#sh2-bg)')}${starsField(10, 106)}
      <path d="M${CX - 90},${CY - 40} l40,40 m0,-40 l-40,40" stroke="#ff8fc8" stroke-width="10" stroke-linecap="round"/>
      <path d="M${CX + 40},${CY - 60} v50 m-25,-25 h50" stroke="#ffffff" stroke-width="10" stroke-linecap="round"/>
      <rect x="${CX - 30}" y="${CY + 30}" width="60" height="60" fill="none" stroke="#8fe0ff" stroke-width="8"/>
      <circle cx="${CX}" cy="${CY - 100}" r="14" fill="#e6d6ff"/>` }));
  // 4. Combat Quadrupeds / Lernaean Warbots: a four-legged hunter; back, the
  // many-headed Hydra version.
  emit('col_combat_quadrupeds', 'front', panel({ defs: bg('cq-bg', '#5a3a26', '#120a06', '50%', '70%'),
    inner: `${rect('url(#cq-bg)')}<path d="M0,${H - 60} Q${W * 0.4},${H - 90} ${W},${H - 70} L${W},${H} L0,${H} Z" fill="#3a2414"/>${walker({ cx: CX - 10, cy: CY + 20, legs: 4, s: 1.05 })}` }));
  emit('col_combat_quadrupeds', 'back', panel({ defs: purpleBackDefs('cq2-bg'),
    inner: `${rect('url(#cq2-bg)')}${starsField(8, 108)}${walker({ cx: CX - 20, cy: CY + 50, legs: 4, s: 0.95, body: '#d8dce2', joint: '#5a4a8a', head: false })}
      ${[-50, 0, 50].map((dx, i) => `<path d="M${CX + 40},${CY + 40} Q${CX + 40 + dx},${CY - 20} ${CX + 40 + dx * 1.2},${CY - 70 + i * 10}" stroke="#d8dce2" stroke-width="10" fill="none" stroke-linecap="round"/><rect x="${CX + 26 + dx * 1.2}" y="${CY - 92 + i * 10}" width="30" height="20" rx="6" fill="#d8dce2"/><circle cx="${CX + 48 + dx * 1.2}" cy="${CY - 82 + i * 10}" r="4" fill="#ff5a4a"/>`).join('')}` }));
  // 5. Sensor Web Sail / Wisp: a fine-mesh sail riding a beam; back, a tiny
  // probe trailing a gossamer wisp.
  emit('col_sensor_web_sail', 'front', panel({ defs: bg('sw-bg', '#1a2030', '#04050a'),
    inner: `${rect('url(#sw-bg)')}${starsField(16, 109)}${sailScene({ cx: CX, cy: CY, sailColor: '#c8d0dc', sailColor2: '#8a94a4', ribColor: '#3a4250', glyphColor: '#ff8a6a', rx: 92, ry: 96 })}
      ${Array.from({ length: 5 }, (_, i) => `<line x1="${CX - 120 + i * 12}" y1="${H}" x2="${CX - 10 + i * 6}" y2="${CY + 40}" stroke="#ff8a6a" stroke-width="1.5" opacity="0.35"/>`).join('')}` }));
  emit('col_sensor_web_sail', 'back', panel({ defs: purpleBackDefs('sw2-bg'),
    inner: `${rect('url(#sw2-bg)')}${starsField(14, 110)}
      <path d="M${CX + 40},${CY - 40} Q${CX - 40},${CY - 10} ${CX - 120},${CY + 90}" stroke="#e6d6ff" stroke-width="14" fill="none" opacity="0.25" stroke-linecap="round"/>
      <path d="M${CX + 40},${CY - 40} Q${CX - 30},${CY} ${CX - 100},${CY + 70}" stroke="#ffffff" stroke-width="3" fill="none" opacity="0.7"/>
      <rect x="${CX + 26}" y="${CY - 54}" width="28" height="28" fill="#f2f0ff" transform="rotate(45 ${CX + 40} ${CY - 40})"/>` }));
  // 6. Nano-3D Printers / Offworld Replicators: the printer's hex lattice;
  // back, twin towers rising layer by layer.
  emit('col_nano_3d_printers', 'front', panel({ defs: bg('np-bg', '#2a2e36', '#08090c'),
    inner: `${rect('url(#np-bg)')}${Array.from({ length: 70 }, (_, i) => { const c = i % 10, r = Math.floor(i / 10); const x = 18 + c * 30 + (r % 2) * 15, y = 30 + r * 40; return `<path d="M${x},${y - 14} l12,7 v14 l-12,7 l-12,-7 v-14 z" fill="none" stroke="#9aa4b4" stroke-width="2" opacity="${(0.3 + ((i * 3) % 7) * 0.08).toFixed(2)}"/>`; }).join('')}` }));
  emit('col_nano_3d_printers', 'back', panel({ defs: purpleBackDefs('np2-bg'),
    inner: `${rect('url(#np2-bg)')}${starsField(8, 112)}
      ${[[CX - 40, 210], [CX + 40, 250]].map(([x, hgt]) => Array.from({ length: Math.round(hgt / 12) }, (_, i) => `<rect x="${x - 26}" y="${H - 20 - i * 12}" width="52" height="10" fill="#e6e8f2" opacity="${(0.55 + (i % 3) * 0.15).toFixed(2)}"/>`).join('')).join('')}
      <rect x="${CX + 10}" y="${H - 270}" width="60" height="4" fill="#ffe08a"/><circle cx="${CX + 40}" cy="${H - 276}" r="5" fill="#ffe08a"/>` }));

  // ---- SPACEBORN HUMANS ----
  // 7. Lava Lamp Evangelists / Sunburn League: a preacher before a glowing
  // laurel emblem; back, the nanite "goo" glowing in an arm.
  emit('col_lava_lamp_evangelists', 'front', panel({ defs: `${bg('ll-bg', '#5a3a1e', '#140a04')}<linearGradient id="ll-skin" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#d8a07a"/><stop offset="100%" stop-color="#8a5a3c"/></linearGradient>`,
    inner: `${rect('url(#ll-bg)')}${beardedManFace({ hcx: CX, hcy: CY - 20, r: 44, skin: 'url(#ll-skin)', hair: '#3a2414', body: '#2a2a32', beard: 'goatee' })}
      <g transform="translate(${CX},${CY + 104})" fill="none" stroke="#ff9a3a" stroke-width="4" stroke-linecap="round">${[-1, 1].map((d) => `<path d="M${d * 8},18 Q${d * 46},0 ${d * 30},-40"/>`).join('')}</g>
      <circle cx="${CX}" cy="${CY + 78}" r="8" fill="#ffb35a"/><path d="M${CX},${CY + 86} v26 M${CX - 12},${CY + 96} h24" stroke="#ffb35a" stroke-width="5" stroke-linecap="round"/>` }));
  emit('col_lava_lamp_evangelists', 'back', panel({ defs: purpleBackDefs('ll2-bg'),
    inner: `${rect('url(#ll2-bg)')}${starsField(8, 114)}${biomechArm({ cx: CX, cy: CY, skinColor: '#d8a07a', skinColor2: '#8a5a3c', chipColor: '#ff9a5a', traceColor: '#ffd08a' })}` }));
  // 8. Gabonese Mining Consortium / Bubbleopolis: a young prospector with
  // binoculars; back, the bubble-dome colony at night.
  emit('col_gabonese_mining_consortium', 'front', panel({ defs: bg('gm-bg', '#8ab4cc', '#2a4a5e', '50%', '20%'),
    inner: `${rect('url(#gm-bg)')}<rect x="${W - 90}" y="${CY - 40}" width="50" height="190" fill="#c8d4dc" opacity="0.6"/><rect x="${W - 150}" y="${CY + 10}" width="44" height="140" fill="#c8d4dc" opacity="0.45"/>
      ${person({ cx: CX - 30, base: H - 4, s: 0.95, suit: '#f2ece0', skin: '#5a3a26', armUp: true })}
      <rect x="${CX - 4}" y="${CY - 50}" width="34" height="16" rx="6" fill="#2a2a2a"/>` }));
  emit('col_gabonese_mining_consortium', 'back', panel({ defs: `${purpleBackDefs('gm2-bg')}<radialGradient id="gm2-dome" cx="40%" cy="30%" r="70%"><stop offset="0%" stop-color="#ffffff" stop-opacity="0.6"/><stop offset="100%" stop-color="#9adcff" stop-opacity="0.15"/></radialGradient>`,
    inner: `${rect('url(#gm2-bg)')}${starsField(14, 116)}<rect y="${H - 70}" width="${W}" height="70" fill="#2a1c44"/>
      ${[[CX - 70, 46], [CX + 10, 70], [CX + 90, 38]].map(([x, r]) => `<path d="M${x - r},${H - 70} A${r},${r} 0 0 1 ${x + r},${H - 70} Z" fill="url(#gm2-dome)" stroke="#e6f6ff" stroke-width="1.5"/><rect x="${x - r * 0.4}" y="${H - 70 - r * 0.35}" width="${r * 0.8}" height="${r * 0.35}" fill="#ffe08a" opacity="0.7"/>`).join('')}` }));
  // 9. Prehensilists / Transplaneteers: a single water drop held in curling
  // tendrils (zero-g life); back, a long-limbed body floating free.
  emit('col_prehensilists', 'front', panel({ defs: `${bg('ph-bg', '#0e3a5a', '#02101c')}<radialGradient id="ph-drop" cx="40%" cy="35%" r="70%"><stop offset="0%" stop-color="#c8f0ff"/><stop offset="100%" stop-color="#1a7ab0"/></radialGradient>`,
    inner: `${rect('url(#ph-bg)')}<path d="M${CX},${CY - 90} Q${CX + 64},${CY} ${CX + 44},${CY + 44} A48,48 0 0 1 ${CX - 44},${CY + 44} Q${CX - 64},${CY} ${CX},${CY - 90} Z" fill="url(#ph-drop)"/>
      ${Array.from({ length: 6 }, (_, i) => { const a = (i / 6) * Math.PI * 2; const x = CX + Math.cos(a) * 110, y = CY + 20 + Math.sin(a) * 120; return `<path d="M${x},${y} q${-Math.cos(a) * 40},${-Math.sin(a) * 10} ${-Math.cos(a) * 50},${-Math.sin(a) * 50} q10,-10 4,-18" stroke="#3ac0e0" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.8"/>`; }).join('')}` }));
  emit('col_prehensilists', 'back', panel({ defs: purpleBackDefs('ph2-bg'),
    inner: `${rect('url(#ph2-bg)')}${starsField(16, 118)}<g transform="rotate(-30 ${CX} ${CY})">${person({ cx: CX, base: CY + 110, s: 1.2, suit: '#e6e0f6', skin: '#d8b090', visor: '#3a5a8a', armUp: true })}</g>` }));
  // 10. Exoskeletalists / Space Jockeys: a hiker in a powered frame on a red
  // canyon trail; back, a sleek jockey ship dropping through the sky.
  emit('col_exoskeletalists', 'front', panel({ defs: bg('ex-bg', '#d87a4a', '#5a2410', '50%', '15%'),
    inner: `${rect('url(#ex-bg)')}<path d="M0,${H - 90} L${W * 0.3},${H - 140} L${W * 0.55},${H - 110} L${W},${H - 160} L${W},${H} L0,${H} Z" fill="#8a3418"/>
      ${person({ cx: CX, base: H - 30, s: 1.0, suit: '#3a4a5a', skin: '#c9a888' })}
      <path d="M${CX - 24},${H - 30} L${CX - 26},${H - 110} L${CX + 26},${H - 110} L${CX + 24},${H - 30}" stroke="#e6e8ec" stroke-width="3" fill="none"/><circle cx="${CX}" cy="${H - 112}" r="5" fill="#ffd36b"/>` }));
  emit('col_exoskeletalists', 'back', panel({ defs: purpleBackDefs('ex2-bg'),
    inner: `${rect('url(#ex2-bg)')}${starsField(10, 120)}<g transform="rotate(25 ${CX} ${CY})">${deltaShip({ cx: CX, cy: CY, s: 1.15, hull: '#1c1c24', trim: '#5a5a6a', glowC: '#ffb35a' })}</g>` }));
  // 11. Teleoperators / Drone Queen: an operator in a headset with the robot
  // she drives; back, a profile wired into a drone swarm.
  emit('col_teleoperators', 'front', panel({ defs: bg('to-bg', '#2a3a48', '#0a1016'),
    inner: `${rect('url(#to-bg)')}${person({ cx: CX - 62, base: H - 6, s: 0.95, suit: '#1c2430', skin: '#5a3a26', visor: '#7fd0ff' })}${cobot({ cx: CX + 52, cy: CY + 30, s: 1.0 })}
      <path d="M${CX - 50},${CY - 30} Q${CX},${CY - 70} ${CX + 40},${CY - 10}" stroke="#7fd0ff" stroke-width="2" stroke-dasharray="4 5" fill="none"/>` }));
  emit('col_teleoperators', 'back', panel({ defs: `${purpleBackDefs('to2-bg')}<linearGradient id="to2-skin" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#c88a6a"/><stop offset="100%" stop-color="#6a3a2a"/></linearGradient>`,
    inner: `${rect('url(#to2-bg)')}${starsField(8, 122)}${profileHeadChip({ cx: CX - 20, cy: CY + 30, skinGrad: 'url(#to2-skin)', chipColor: '#e6d6ff', glowColor: '#9af0ff' })}
      ${[[60, -90], [100, -50], [80, 0]].map(([dx, dy]) => `<rect x="${CX + dx - 12}" y="${CY + dy - 6}" width="24" height="12" rx="4" fill="#f2f0ff"/><line x1="${CX + 10}" y1="${CY - 20}" x2="${CX + dx}" y2="${CY + dy}" stroke="#9af0ff" stroke-width="1.5" opacity="0.7"/>`).join('')}` }));
  // 12. Boston Hexapods / Zombie Wanderers: a six-legged walker beside its
  // designer's holo-plan; back, a printed body under a medic's scan.
  emit('col_boston_hexapods', 'front', panel({ defs: bg('bh-bg', '#1a3a4a', '#04101a'),
    inner: `${rect('url(#bh-bg)')}<rect x="${CX - 120}" y="${CY - 110}" width="150" height="100" fill="#7fd0ff" opacity="0.12" stroke="#7fd0ff" stroke-width="1.5"/>${walker({ cx: CX - 46, cy: CY - 60, legs: 6, s: 0.55, body: '#7fd0ff', joint: '#e6f6ff', head: false })}
      ${walker({ cx: CX, cy: CY + 70, legs: 6, s: 0.95, body: '#d8dee6', joint: '#3a4a5a' })}` }));
  emit('col_boston_hexapods', 'back', panel({ defs: purpleBackDefs('bh2-bg'),
    inner: `${rect('url(#bh2-bg)')}${starsField(8, 124)}${person({ cx: CX + 40, base: H - 4, s: 1.05, suit: '#f2f0f6', skin: '#e0c0a0' })}
      ${Array.from({ length: 6 }, (_, i) => `<rect x="${CX - 120}" y="${CY - 70 + i * 22}" width="${70 - (i % 3) * 14}" height="8" rx="3" fill="#9af0ff" opacity="0.6"/>`).join('')}` }));
  // 13. Neural Pilots / Shipbrain: a ship flown by a thought-link; back, the
  // pilot's head open to the ship's systems.
  emit('col_neural_pilots', 'front', panel({ defs: bg('np2a-bg', '#ffcf9a', '#6a4a8a', '50%', '80%'),
    inner: `${rect('url(#np2a-bg)')}${deltaShip({ cx: CX, cy: CY, s: 1.1, hull: '#e8ecf2', trim: '#7a7f8a', glowC: '#ff9a5a' })}
      ${Array.from({ length: 4 }, (_, i) => `<path d="M${CX - 120},${CY + 90 - i * 12} Q${CX - 40},${CY + 40} ${CX},${CY}" stroke="#ffffff" stroke-width="1.2" fill="none" opacity="${0.25 + i * 0.12}"/>`).join('')}` }));
  emit('col_neural_pilots', 'back', panel({ defs: `${purpleBackDefs('np3-bg')}<radialGradient id="np3-skull" cx="45%" cy="35%" r="70%"><stop offset="0%" stop-color="#f2f0ff"/><stop offset="100%" stop-color="#9a8ac8"/></radialGradient>`,
    inner: `${rect('url(#np3-bg)')}${starsField(8, 126)}
      <path d="M${CX - 70},${CY + 60} Q${CX - 90},${CY - 80} ${CX},${CY - 96} Q${CX + 90},${CY - 80} ${CX + 74},${CY + 20} L${CX + 50},${CY + 40} L${CX + 52},${CY + 90} L${CX - 40},${CY + 96} Z" fill="url(#np3-skull)" opacity="0.85"/>
      ${nodeWeb({ cx: CX, cy: CY - 30, r: 50, n: 18, seed: 13, line: '#3a2c6a', node: '#5a3aa0' })}
      <path d="M${CX + 74},${CY - 10} q40,0 60,-30" stroke="#9af0ff" stroke-width="3" fill="none"/><rect x="${CX + 128}" y="${CY - 52}" width="22" height="22" rx="4" fill="#9af0ff"/>` }));
  // 14. VR Simulcasters / The Presence: a woman beside her holographic
  // double; back, two people meeting through a point of light.
  emit('col_vr_simulcasters', 'front', panel({ defs: bg('vr-bg', '#3a4a3a', '#0c140c'),
    inner: `${rect('url(#vr-bg)')}${person({ cx: CX - 44, base: H - 4, s: 1.05, suit: '#7a3a4a', skin: '#8a5a3a' })}
      <g opacity="0.55">${person({ cx: CX + 56, base: H - 4, s: 1.05, suit: '#7fe0ff', skin: '#7fe0ff' })}</g>
      ${Array.from({ length: 8 }, (_, i) => `<line x1="${CX + 20}" y1="${H - 20 - i * 26}" x2="${CX + 92}" y2="${H - 20 - i * 26}" stroke="#7fe0ff" stroke-width="1" opacity="0.4"/>`).join('')}` }));
  emit('col_vr_simulcasters', 'back', panel({ defs: `${purpleBackDefs('vr2-bg')}<radialGradient id="vr2-orb" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#9af0ff" stop-opacity="0"/></radialGradient>`,
    inner: `${rect('url(#vr2-bg)')}${starsField(8, 128)}${person({ cx: CX - 70, base: H - 4, s: 1.0, suit: '#2a1c44', skin: '#d8b090' })}${person({ cx: CX + 70, base: H - 4, s: 1.0, suit: '#2a1c44', skin: '#5a3a26' })}
      <circle cx="${CX}" cy="${CY + 30}" r="46" fill="url(#vr2-orb)"/>` }));
  // 15. Transhuman Activists / Jarhead Insurgents: a ring of linked people
  // around a beacon; back, a helmeted fighter behind a targeting display.
  emit('col_transhuman_activists', 'front', panel({ defs: `${bg('ta-bg', '#1e2a44', '#05070e')}<radialGradient id="ta-core" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#9af0c0"/><stop offset="100%" stop-color="#1a5a4a" stop-opacity="0"/></radialGradient>`,
    inner: `${rect('url(#ta-bg)')}${starsField(10, 129)}<circle cx="${CX}" cy="${CY}" r="60" fill="url(#ta-core)"/>
      ${Array.from({ length: 14 }, (_, i) => { const a = (i / 14) * Math.PI * 2; const x = CX + Math.cos(a) * 110, y = CY + Math.sin(a) * 110; return `<circle cx="${x.toFixed(1)}" cy="${(y - 10).toFixed(1)}" r="6" fill="#e6f2ec"/><path d="M${(x - 7).toFixed(1)},${(y + 10).toFixed(1)} q7,-14 14,0" fill="#e6f2ec"/>`; }).join('')}
      <circle cx="${CX}" cy="${CY}" r="110" fill="none" stroke="#9af0c0" stroke-width="1.5" opacity="0.5"/>` }));
  emit('col_transhuman_activists', 'back', panel({ defs: purpleBackDefs('ta2-bg'),
    inner: `${rect('url(#ta2-bg)')}${starsField(6, 130)}
      <path d="M${CX - 60},${H} L${CX - 54},${CY + 40} Q${CX},${CY + 20} ${CX + 54},${CY + 40} L${CX + 60},${H} Z" fill="#2a2a34"/>
      <ellipse cx="${CX}" cy="${CY - 10}" rx="52" ry="58" fill="#3a3a48"/><rect x="${CX - 40}" y="${CY - 22}" width="80" height="26" rx="10" fill="#9af0ff" opacity="0.85"/>
      <rect x="${CX - 120}" y="${CY - 120}" width="90" height="64" rx="6" fill="none" stroke="#9af0ff" stroke-width="2"/><circle cx="${CX - 75}" cy="${CY - 88}" r="14" fill="none" stroke="#ff8a8a" stroke-width="2"/>` }));
  // 16. Clone Entrepreneurs / Death Insurers: twin forms growing in vats;
  // back, a sleeper in a hibernation pod.
  emit('col_clone_entrepreneurs', 'front', panel({ defs: bg('ce-bg', '#2a3a3a', '#081010'),
    inner: `${rect('url(#ce-bg)')}${vat({ cx: CX - 52, cy: CY + 20 })}${vat({ cx: CX + 52, cy: CY + 20 })}` }));
  emit('col_clone_entrepreneurs', 'back', panel({ defs: `${purpleBackDefs('ce2-bg')}<linearGradient id="ce2-pod" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#f2f6fa"/><stop offset="100%" stop-color="#9aa8b8"/></linearGradient>`,
    inner: `${rect('url(#ce2-bg)')}${starsField(8, 132)}
      <rect x="${CX - 120}" y="${CY - 10}" width="240" height="90" rx="44" fill="url(#ce2-pod)"/>
      <rect x="${CX - 96}" y="${CY + 4}" width="190" height="56" rx="28" fill="#9adcff" opacity="0.55"/>
      <circle cx="${CX - 66}" cy="${CY + 32}" r="18" fill="#c89a7a"/><rect x="${CX - 48}" y="${CY + 18}" width="120" height="28" rx="14" fill="#e6e0f6"/>
      <rect x="${CX - 40}" y="${CY + 86}" width="80" height="10" rx="4" fill="#5a6470"/>` }));
}
