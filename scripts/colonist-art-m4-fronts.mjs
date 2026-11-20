// M4 (Exodus) colonist FRONT art, second pass (owner 2026-11-20: "lava lamp guy
// looks cool, but everything else can look better"). Each front follows the
// subject of its printed Spaceborn card, drawn in the Lava Lamp style: shaded
// portraits (skin, hair and clothing gradients, a rim light) and lit scenes
// (layered grounds, glows, a vignette). Lava Lamp Evangelists itself stays in
// colonist-art-m4.mjs. Pure string builders; called from drawM4.

export const REDONE_FRONTS = new Set([
  'col_cobots', 'col_beowulf_internet', 'col_self_designing_heuristics', 'col_combat_quadrupeds',
  'col_sensor_web_sail', 'col_nano_3d_printers', 'col_gabonese_mining_consortium', 'col_prehensilists',
  'col_exoskeletalists', 'col_teleoperators', 'col_boston_hexapods', 'col_neural_pilots',
  'col_vr_simulcasters', 'col_transhuman_activists', 'col_clone_entrepreneurs',
]);

const f1 = (n) => (+n).toFixed(1);

export function artKit({ W, H }) {
  const rect = (fill, extra = '') => `<rect width="${W}" height="${H}" fill="${fill}" ${extra}/>`;
  const radial = (id, stops, cx = '50%', cy = '45%', r = '80%') =>
    `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</radialGradient>`;
  const linear = (id, stops, x2 = 0, y2 = 1) =>
    `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</linearGradient>`;
  const vignette = (id) => `${radial(id, [['55%', '#000', 0], ['100%', '#000', 0.6]], '50%', '45%', '75%')}`;
  const stars = (n, seed, y1 = H) => {
    let s = 31 + seed * 97; const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    return Array.from({ length: n }, () => `<circle cx="${f1(rnd() * W)}" cy="${f1(rnd() * y1)}" r="${rnd() < 0.15 ? 1.6 : 0.8}" fill="#eef2ff" opacity="${(0.3 + rnd() * 0.5).toFixed(2)}"/>`).join('');
  };
  const rng = (seed) => { let s = seed * 7919 + 13; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; };

  // ---- a shaded head-and-shoulders portrait -------------------------------------
  // p: { id, cx, cy (head centre), r, skin: [light, dark], hair, hairHi, style,
  //      female, shirt: [light, dark], collar, eyes, lips, visor, rim, turn }
  const bust = (p) => {
    const { id, cx, cy, r } = p;
    const s = r, t = p.turn || 0;            // turn: -1..1, nudges features sideways
    const [sk0, sk1] = p.skin, [sh0, sh1] = p.shirt;
    const defs = `${radial(`${id}-sk`, [['0%', sk0], ['100%', sk1]], `${40 - t * 10}%`, '35%', '75%')}
      ${linear(`${id}-sh`, [['0%', sh0], ['100%', sh1]], 0.4, 1)}
      ${linear(`${id}-hr`, [['0%', p.hairHi || p.hair], ['100%', p.hair]], 0.3, 1)}`;
    const neckW = s * (p.female ? 0.36 : 0.44);
    const shoulderY = cy + s * 1.55;
    const body = `<path d="M${f1(cx - s * 2.6)},${H + 2} Q${f1(cx - s * 2.3)},${f1(shoulderY + s * 0.1)} ${f1(cx - s * 0.9)},${f1(shoulderY - s * 0.12)} L${f1(cx + s * 0.9)},${f1(shoulderY - s * 0.12)} Q${f1(cx + s * 2.3)},${f1(shoulderY + s * 0.1)} ${f1(cx + s * 2.6)},${H + 2} Z" fill="${p.shirtFill || `url(#${id}-sh)`}"/>`;
    const neck = `<path d="M${f1(cx - neckW)},${f1(cy + s * 0.7)} L${f1(cx - neckW * 1.05)},${f1(shoulderY)} Q${f1(cx)},${f1(shoulderY + s * 0.32)} ${f1(cx + neckW * 1.05)},${f1(shoulderY)} L${f1(cx + neckW)},${f1(cy + s * 0.7)} Z" fill="${sk1}"/>
      <path d="M${f1(cx - neckW)},${f1(cy + s * 0.8)} Q${f1(cx)},${f1(cy + s * 1.15)} ${f1(cx + neckW)},${f1(cy + s * 0.8)}" fill="#000" opacity="0.18"/>`;
    const collar = p.collar === 'v'
      ? `<path d="M${f1(cx - s * 0.62)},${f1(shoulderY - s * 0.1)} L${f1(cx)},${f1(shoulderY + s * 0.62)} L${f1(cx + s * 0.62)},${f1(shoulderY - s * 0.1)}" fill="${sk1}" stroke="${sh1}" stroke-width="3"/>`
      : p.collar === 'coat'
        ? `<path d="M${f1(cx - s * 0.75)},${f1(shoulderY - s * 0.12)} L${f1(cx - s * 0.1)},${f1(shoulderY + s * 0.9)} L${f1(cx - s * 0.35)},${H} M${f1(cx + s * 0.75)},${f1(shoulderY - s * 0.12)} L${f1(cx + s * 0.1)},${f1(shoulderY + s * 0.9)} L${f1(cx + s * 0.35)},${H}" stroke="${sh1}" stroke-width="3" fill="none"/><path d="M${f1(cx - s * 0.5)},${f1(shoulderY - s * 0.05)} L${f1(cx)},${f1(shoulderY + s * 0.55)} L${f1(cx + s * 0.5)},${f1(shoulderY - s * 0.05)}" fill="#3a4658"/>`
        : `<path d="M${f1(cx - s * 0.5)},${f1(shoulderY - s * 0.08)} Q${f1(cx)},${f1(shoulderY + s * 0.3)} ${f1(cx + s * 0.5)},${f1(shoulderY - s * 0.08)}" fill="none" stroke="${sh1}" stroke-width="3"/>`;
    // hair behind the head (long / curly volume)
    let hairBack = '', hairFront = '';
    const hr = `url(#${id}-hr)`;
    switch (p.style) {
      case 'curly': {
        const g = rng(s * 3 + cx);
        hairBack = Array.from({ length: 22 }, (_, i) => {
          const a = Math.PI * (0.95 + (i / 21) * 1.1), d = s * (1.05 + g() * 0.18);
          return `<circle cx="${f1(cx + Math.cos(a) * d)}" cy="${f1(cy - s * 0.1 + Math.sin(a) * d * 0.95)}" r="${f1(s * (0.32 + g() * 0.12))}" fill="${hr}"/>`;
        }).join('') + `<ellipse cx="${cx}" cy="${f1(cy - s * 0.25)}" rx="${f1(s * 1.12)}" ry="${f1(s * 1.0)}" fill="${hr}"/>`
          + (p.female ? `<path d="M${f1(cx - s * 1.15)},${f1(cy)} Q${f1(cx - s * 1.5)},${f1(cy + s * 1.3)} ${f1(cx - s * 0.9)},${f1(cy + s * 1.6)} L${f1(cx + s * 0.9)},${f1(cy + s * 1.6)} Q${f1(cx + s * 1.5)},${f1(cy + s * 1.3)} ${f1(cx + s * 1.15)},${f1(cy)} Z" fill="${hr}"/>` : '');
        hairFront = `<path d="M${f1(cx - s * 0.98)},${f1(cy - s * 0.15)} Q${f1(cx - s * 0.6)},${f1(cy - s * 0.85)} ${cx},${f1(cy - s * 0.72)} Q${f1(cx + s * 0.6)},${f1(cy - s * 0.85)} ${f1(cx + s * 0.98)},${f1(cy - s * 0.15)} Q${f1(cx + s * 0.9)},${f1(cy - s * 1.25)} ${cx},${f1(cy - s * 1.22)} Q${f1(cx - s * 0.9)},${f1(cy - s * 1.25)} ${f1(cx - s * 0.98)},${f1(cy - s * 0.15)} Z" fill="${hr}"/>`;
        break;
      }
      case 'bun':
        hairBack = `<circle cx="${f1(cx + s * 0.15)}" cy="${f1(cy - s * 1.2)}" r="${f1(s * 0.45)}" fill="${hr}"/>`;
        hairFront = `<path d="M${f1(cx - s * 1.0)},${f1(cy - s * 0.05)} Q${f1(cx - s * 1.05)},${f1(cy - s * 1.15)} ${cx},${f1(cy - s * 1.15)} Q${f1(cx + s * 1.05)},${f1(cy - s * 1.15)} ${f1(cx + s * 1.0)},${f1(cy - s * 0.05)} Q${f1(cx + s * 0.75)},${f1(cy - s * 0.7)} ${f1(cx - s * 0.1)},${f1(cy - s * 0.66)} Q${f1(cx - s * 0.7)},${f1(cy - s * 0.6)} ${f1(cx - s * 1.0)},${f1(cy - s * 0.05)} Z" fill="${hr}"/>`;
        break;
      case 'long':
        // two curtains falling at the sides to the shoulders; nothing under the chin
        // (hair across the jaw read as a beard on the drawn women).
        hairBack = [-1, 1].map((k) => `<path d="M${f1(cx + k * s * 0.6)},${f1(cy - s * 0.9)} Q${f1(cx + k * s * 1.35)},${f1(cy - s * 0.2)} ${f1(cx + k * s * 1.25)},${f1(cy + s * 1.0)} Q${f1(cx + k * s * 1.2)},${f1(cy + s * 1.6)} ${f1(cx + k * s * 1.4)},${f1(cy + s * 2.0)} L${f1(cx + k * s * 0.82)},${f1(cy + s * 1.9)} Q${f1(cx + k * s * 0.8)},${f1(cy + s * 1.2)} ${f1(cx + k * s * 0.7)},${f1(cy + s * 0.6)} Z" fill="${hr}"/>`).join('');
        hairFront = `<path d="M${f1(cx - s * 1.02)},${f1(cy + s * 0.2)} Q${f1(cx - s * 1.08)},${f1(cy - s * 1.2)} ${cx},${f1(cy - s * 1.18)} Q${f1(cx + s * 1.08)},${f1(cy - s * 1.2)} ${f1(cx + s * 1.02)},${f1(cy + s * 0.2)} Q${f1(cx + s * 0.85)},${f1(cy - s * 0.5)} ${f1(cx + s * 0.2)},${f1(cy - s * 0.7)} Q${f1(cx - s * 0.5)},${f1(cy - s * 0.55)} ${f1(cx - s * 1.02)},${f1(cy + s * 0.2)} Z" fill="${hr}"/>`;
        break;
      case 'buzz':
        hairFront = `<path d="M${f1(cx - s * 0.97)},${f1(cy - s * 0.2)} Q${f1(cx - s * 0.98)},${f1(cy - s * 1.14)} ${cx},${f1(cy - s * 1.13)} Q${f1(cx + s * 0.98)},${f1(cy - s * 1.14)} ${f1(cx + s * 0.97)},${f1(cy - s * 0.2)} Q${f1(cx + s * 0.8)},${f1(cy - s * 0.78)} ${cx},${f1(cy - s * 0.8)} Q${f1(cx - s * 0.8)},${f1(cy - s * 0.78)} ${f1(cx - s * 0.97)},${f1(cy - s * 0.2)} Z" fill="${hr}" opacity="0.92"/>`;
        break;
      case 'bald':
        hairFront = '';
        break;
      case 'white':
      default:
        hairFront = `<path d="M${f1(cx - s * 1.0)},${f1(cy - s * 0.05)} Q${f1(cx - s * 1.06)},${f1(cy - s * 1.2)} ${f1(cx + s * 0.05)},${f1(cy - s * 1.2)} Q${f1(cx + s * 1.06)},${f1(cy - s * 1.15)} ${f1(cx + s * 1.0)},${f1(cy - s * 0.05)} Q${f1(cx + s * 0.85)},${f1(cy - s * 0.62)} ${f1(cx + s * 0.35)},${f1(cy - s * 0.66)} Q${f1(cx - s * 0.2)},${f1(cy - s * 0.85)} ${f1(cx - s * 1.0)},${f1(cy - s * 0.05)} Z" fill="${hr}"/>`;
    }
    const ex = (k) => f1(cx + t * s * 0.12 + k * s * 0.36);
    const eyeY = f1(cy - s * 0.05);
    const eyes = p.eyesClosed
      ? [-1, 1].map((k) => `<path d="M${f1(+ex(k) - s * 0.18)},${eyeY} Q${ex(k)},${f1(+eyeY + s * 0.1)} ${f1(+ex(k) + s * 0.18)},${eyeY}" stroke="#2a1a10" stroke-width="2" fill="none" stroke-linecap="round"/>
         <path d="M${f1(+ex(k) - s * 0.2)},${f1(+eyeY - s * 0.22)} Q${ex(k)},${f1(+eyeY - s * 0.3)} ${f1(+ex(k) + s * 0.22)},${f1(+eyeY - s * 0.22)}" stroke="${p.brow || p.hair}" stroke-width="${f1(s * 0.07)}" fill="none" stroke-linecap="round"/>`).join('')
      : p.visor
      ? `<rect x="${f1(cx - s * 0.98)}" y="${f1(cy - s * 0.32)}" width="${f1(s * 1.96)}" height="${f1(s * 0.48)}" rx="${f1(s * 0.22)}" fill="url(#${id}-vz)"/>
         <rect x="${f1(cx - s * 0.8)}" y="${f1(cy - s * 0.24)}" width="${f1(s * 1.0)}" height="${f1(s * 0.08)}" rx="2" fill="#fff" opacity="0.55"/>`
      : [-1, 1].map((k) => `<ellipse cx="${ex(k)}" cy="${eyeY}" rx="${f1(s * 0.17)}" ry="${f1(s * 0.1)}" fill="#f4efe8"/>
         <circle cx="${ex(k)}" cy="${eyeY}" r="${f1(s * 0.085)}" fill="${p.eyes || '#3a2414'}"/><circle cx="${ex(k)}" cy="${eyeY}" r="${f1(s * 0.04)}" fill="#0a0604"/>
         <circle cx="${f1(+ex(k) + s * 0.03)}" cy="${f1(+eyeY - s * 0.03)}" r="${f1(s * 0.025)}" fill="#fff"/>
         <path d="M${f1(+ex(k) - s * 0.2)},${f1(+eyeY - s * 0.04)} Q${ex(k)},${f1(+eyeY - s * 0.17)} ${f1(+ex(k) + s * 0.2)},${f1(+eyeY - s * 0.04)}" stroke="#2a1a10" stroke-width="1.6" fill="none" opacity="0.7"/>
         <path d="M${f1(+ex(k) - s * 0.2)},${f1(+eyeY - s * 0.24)} Q${ex(k)},${f1(+eyeY - s * 0.33)} ${f1(+ex(k) + s * 0.22)},${f1(+eyeY - s * 0.25)}" stroke="${p.brow || p.hair}" stroke-width="${f1(s * (p.female ? 0.05 : 0.08))}" fill="none" stroke-linecap="round"/>`).join('');
    const vz = p.visor ? linear(`${id}-vz`, [['0%', p.visor[0]], ['100%', p.visor[1]]], 1, 0) : '';
    const noseX = cx + t * s * 0.2;
    const face = `${eyes}
      <path d="M${f1(noseX)},${f1(cy + s * 0.02)} Q${f1(noseX - s * 0.06)},${f1(cy + s * 0.3)} ${f1(noseX - s * 0.13)},${f1(cy + s * 0.36)} Q${f1(noseX)},${f1(cy + s * 0.44)} ${f1(noseX + s * 0.12)},${f1(cy + s * 0.37)}" stroke="#000" stroke-width="1.6" fill="none" opacity="0.22"/>
      <path d="M${f1(noseX - s * 0.24)},${f1(cy + s * 0.6)} Q${f1(noseX)},${f1(cy + s * (p.smile ? 0.72 : 0.66))} ${f1(noseX + s * 0.24)},${f1(cy + s * 0.6)} Q${f1(noseX)},${f1(cy + s * 0.78)} ${f1(noseX - s * 0.24)},${f1(cy + s * 0.6)} Z" fill="${p.lips || '#a8584a'}" opacity="${p.female ? 0.95 : 0.6}"/>
      <ellipse cx="${f1(cx - s * 0.55)}" cy="${f1(cy + s * 0.35)}" rx="${f1(s * 0.2)}" ry="${f1(s * 0.11)}" fill="#e2645a" opacity="${p.female ? 0.18 : 0.08}"/>
      <ellipse cx="${f1(cx + s * 0.55)}" cy="${f1(cy + s * 0.35)}" rx="${f1(s * 0.2)}" ry="${f1(s * 0.11)}" fill="#e2645a" opacity="${p.female ? 0.18 : 0.08}"/>`;
    const ears = [-1, 1].map((k) => `<ellipse cx="${f1(cx + k * s * 0.98)}" cy="${f1(cy + s * 0.08)}" rx="${f1(s * 0.14)}" ry="${f1(s * 0.24)}" fill="${sk1}"/>`).join('')
      + (p.earring ? `<circle cx="${f1(cx - s * 0.98)}" cy="${f1(cy + s * 0.38)}" r="${f1(s * 0.07)}" fill="${p.earring}"/>` : '');
    const head = `<path d="M${f1(cx - s * 0.98)},${f1(cy - s * 0.2)} Q${f1(cx - s * 1.0)},${f1(cy + s * 0.65)} ${f1(cx - s * 0.45)},${f1(cy + s * 0.98)} Q${cx},${f1(cy + s * (p.female ? 1.12 : 1.16))} ${f1(cx + s * 0.45)},${f1(cy + s * 0.98)} Q${f1(cx + s * 1.0)},${f1(cy + s * 0.65)} ${f1(cx + s * 0.98)},${f1(cy - s * 0.2)} Q${f1(cx + s * 0.98)},${f1(cy - s * 1.1)} ${cx},${f1(cy - s * 1.1)} Q${f1(cx - s * 0.98)},${f1(cy - s * 1.1)} ${f1(cx - s * 0.98)},${f1(cy - s * 0.2)} Z" fill="url(#${id}-sk)"/>`;
    const rim = p.rim ? `<path d="M${f1(cx + s * 0.97)},${f1(cy - s * 0.2)} Q${f1(cx + s * 0.99)},${f1(cy + s * 0.65)} ${f1(cx + s * 0.45)},${f1(cy + s * 0.97)}" stroke="${p.rim}" stroke-width="3" fill="none" opacity="0.55" stroke-linecap="round"/>` : '';
    return { defs: defs + vz, svg: p.noBody ? `<g>${hairBack}${ears}${head}${face}${hairFront}${rim}${p.extra || ''}</g>` : `<g>${hairBack}${body}${neck}${collar}${ears}${head}${face}${hairFront}${rim}${p.extra || ''}</g>` };
  };

  // a white service robot head + shoulders, shaded
  const robotBust = ({ id, cx, cy, s = 1 }) => ({
    defs: `${radial(`${id}-shell`, [['0%', '#ffffff'], ['70%', '#d4dae2'], ['100%', '#8a96a4']], '35%', '30%', '80%')}${linear(`${id}-plate`, [['0%', '#222831'], ['100%', '#050608']])}${linear(`${id}-arm`, [['0%', '#4f8fc6'], ['100%', '#1d4f7e']], 1, 1)}`,
    svg: `<g>
      <path d="M${f1(cx - 95 * s)},${H + 2} Q${f1(cx - 92 * s)},${f1(cy + 70 * s)} ${f1(cx - 45 * s)},${f1(cy + 58 * s)} L${f1(cx + 45 * s)},${f1(cy + 58 * s)} Q${f1(cx + 92 * s)},${f1(cy + 70 * s)} ${f1(cx + 95 * s)},${H + 2} Z" fill="url(#${id}-shell)"/>
      <path d="M${f1(cx + 60 * s)},${f1(cy + 75 * s)} Q${f1(cx + 92 * s)},${f1(cy + 90 * s)} ${f1(cx + 95 * s)},${H + 2} L${f1(cx + 66 * s)},${H + 2} Z" fill="url(#${id}-arm)"/>
      <path d="M${f1(cx - 60 * s)},${f1(cy + 75 * s)} Q${f1(cx - 92 * s)},${f1(cy + 90 * s)} ${f1(cx - 95 * s)},${H + 2} L${f1(cx - 66 * s)},${H + 2} Z" fill="url(#${id}-arm)"/>
      <rect x="${f1(cx - 14 * s)}" y="${f1(cy + 34 * s)}" width="${f1(28 * s)}" height="${f1(30 * s)}" fill="#3a4250"/>
      <path d="M${f1(cx - 50 * s)},${f1(cy + 10 * s)} Q${f1(cx - 56 * s)},${f1(cy - 62 * s)} ${cx},${f1(cy - 66 * s)} Q${f1(cx + 56 * s)},${f1(cy - 62 * s)} ${f1(cx + 50 * s)},${f1(cy + 10 * s)} Q${f1(cx + 44 * s)},${f1(cy + 46 * s)} ${cx},${f1(cy + 46 * s)} Q${f1(cx - 44 * s)},${f1(cy + 46 * s)} ${f1(cx - 50 * s)},${f1(cy + 10 * s)} Z" fill="url(#${id}-shell)"/>
      <path d="M${f1(cx - 36 * s)},${f1(cy - 20 * s)} Q${f1(cx - 38 * s)},${f1(cy - 44 * s)} ${cx},${f1(cy - 45 * s)} Q${f1(cx + 38 * s)},${f1(cy - 44 * s)} ${f1(cx + 36 * s)},${f1(cy - 20 * s)} Q${f1(cx + 34 * s)},${f1(cy + 18 * s)} ${cx},${f1(cy + 20 * s)} Q${f1(cx - 34 * s)},${f1(cy + 18 * s)} ${f1(cx - 36 * s)},${f1(cy - 20 * s)} Z" fill="url(#${id}-plate)"/>
      <path d="M${f1(cx - 26 * s)},${f1(cy - 34 * s)} Q${f1(cx - 10 * s)},${f1(cy - 42 * s)} ${f1(cx + 14 * s)},${f1(cy - 38 * s)}" stroke="#fff" stroke-width="3" opacity="0.25" fill="none" stroke-linecap="round"/>
      <ellipse cx="${f1(cx - 15 * s)}" cy="${f1(cy - 10 * s)}" rx="${f1(7 * s)}" ry="${f1(9 * s)}" fill="#e8f4ff"/><ellipse cx="${f1(cx + 15 * s)}" cy="${f1(cy - 10 * s)}" rx="${f1(7 * s)}" ry="${f1(9 * s)}" fill="#e8f4ff"/>
      <circle cx="${f1(cx - 48 * s)}" cy="${f1(cy - 4 * s)}" r="${f1(7 * s)}" fill="#c4ccd6" stroke="#8a96a4" stroke-width="1.5"/>
      <circle cx="${f1(cx + 48 * s)}" cy="${f1(cy - 4 * s)}" r="${f1(7 * s)}" fill="#c4ccd6" stroke="#8a96a4" stroke-width="1.5"/>
    </g>`,
  });

  const earth = ({ id, cx, cy, r }) => ({
    defs: `${radial(`${id}-ocean`, [['0%', '#6ac4ff'], ['60%', '#1e6ab0'], ['100%', '#0a2a5a']], '38%', '32%', '75%')}${radial(`${id}-atm`, [['86%', '#7fd0ff', 0], ['93%', '#9fe0ff', 0.7], ['100%', '#9fe0ff', 0]], '50%', '50%', '50%')}`,
    svg: `<circle cx="${cx}" cy="${cy}" r="${f1(r * 1.08)}" fill="url(#${id}-atm)"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id}-ocean)"/>
      <path d="M${f1(cx - r * 0.55)},${f1(cy - r * 0.35)} q${f1(r * 0.2)},${f1(-r * 0.25)} ${f1(r * 0.45)},${f1(-r * 0.1)} q${f1(r * 0.15)},${f1(r * 0.25)} ${f1(-r * 0.05)},${f1(r * 0.45)} q${f1(-r * 0.25)},${f1(r * 0.1)} ${f1(-r * 0.4)},${f1(-r * 0.35)} Z
        M${f1(cx + r * 0.1)},${f1(cy + r * 0.05)} q${f1(r * 0.3)},${f1(-r * 0.15)} ${f1(r * 0.5)},${f1(r * 0.15)} q${f1(-r * 0.05)},${f1(r * 0.35)} ${f1(-r * 0.3)},${f1(r * 0.45)} q${f1(-r * 0.25)},${f1(-r * 0.2)} ${f1(-r * 0.2)},${f1(-r * 0.6)} Z" fill="#5fae6a" opacity="0.85"/>
      <path d="M${f1(cx - r * 0.8)},${f1(cy + r * 0.15)} q${f1(r * 0.5)},${f1(-r * 0.12)} ${f1(r * 0.9)},${f1(r * 0.05)} M${f1(cx - r * 0.3)},${f1(cy - r * 0.62)} q${f1(r * 0.4)},${f1(-r * 0.1)} ${f1(r * 0.75)},${f1(r * 0.05)}" stroke="#fff" stroke-width="${f1(r * 0.06)}" opacity="0.55" fill="none" stroke-linecap="round"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id}-night)"/>`,
  });
  const night = (id) => radial(`${id}-night`, [['55%', '#000', 0], ['100%', '#000', 0.55]], '35%', '30%', '80%');

  return { f1, rect, radial, linear, vignette, stars, rng, bust, robotBust, earth, night };
}

export function drawM4Fronts({ W, H, panel, emit }) {
  const CX = W / 2;
  const { rect, radial, linear, vignette, stars, rng, bust, robotBust, earth, night } = artKit({ W, H });

  // ================= ROBOTS =================
  // Cobots: a woman shoulder to shoulder with a white service robot, cool lab light.
  {
    const w = bust({ id: 'cbw', cx: 100, cy: 128, r: 36, skin: ['#9a6a4c', '#5a3624'], hair: '#140c08', hairHi: '#3a2618', style: 'curly', female: true, shirt: ['#f2f4f6', '#a8b0ba'], collar: 'round', eyes: '#2a1408', lips: '#7a3a34', rim: '#9fd8ff' });
    const r = robotBust({ id: 'cbr', cx: 205, cy: 120, s: 1.05 });
    emit('col_cobots', 'front', panel({
      defs: `${radial('cb-bg', [['0%', '#4a5866'], ['100%', '#0a0e12']], '60%', '30%')}${vignette('cb-v')}${w.defs}${r.defs}`,
      inner: `${rect('url(#cb-bg)')}<rect x="20" y="40" width="70" height="120" rx="6" fill="#7fd0ff" opacity="0.06"/><rect x="230" y="20" width="60" height="90" rx="6" fill="#7fd0ff" opacity="0.05"/>${r.svg}${w.svg}${rect('url(#cb-v)')}`,
    }));
  }
  // Beowulf Internet: relay satellites strung over Earth's limb by laser links.
  {
    const e = earth({ id: 'bw-e', cx: 150, cy: 470, r: 260 });
    const sats = [[70, 118], [150, 70], [238, 112], [115, 178], [205, 170], [262, 205], [40, 205]];
    const links = [[0, 1], [1, 2], [0, 3], [3, 4], [4, 2], [4, 5], [3, 6], [1, 4]];
    const sat = ([x, y], i) => `<g transform="translate(${x},${y}) rotate(${(i * 23) % 40 - 20})"><rect x="-16" y="-3" width="11" height="6" fill="#3a6aa8" stroke="#9fc8f0" stroke-width="0.8"/><rect x="5" y="-3" width="11" height="6" fill="#3a6aa8" stroke="#9fc8f0" stroke-width="0.8"/><rect x="-5" y="-5" width="10" height="10" rx="2" fill="#e8c27a"/><circle r="2" fill="#fff"/></g>`;
    emit('col_beowulf_internet', 'front', panel({
      defs: `${radial('bw-bg', [['0%', '#14284a'], ['100%', '#02040a']], '50%', '30%')}${e.defs}${night('bw-e')}${vignette('bw-v')}<filter id="bw-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.5"/></filter>`,
      inner: `${rect('url(#bw-bg)')}${stars(70, 2, 230)}${e.svg}
        <g stroke="#7fe0ff" stroke-width="3" opacity="0.5" filter="url(#bw-glow)">${links.map(([a, b]) => `<line x1="${sats[a][0]}" y1="${sats[a][1]}" x2="${sats[b][0]}" y2="${sats[b][1]}"/>`).join('')}</g>
        <g stroke="#dff8ff" stroke-width="1" opacity="0.9">${links.map(([a, b]) => `<line x1="${sats[a][0]}" y1="${sats[a][1]}" x2="${sats[b][0]}" y2="${sats[b][1]}"/>`).join('')}</g>
        ${sats.map(sat).join('')}${rect('url(#bw-v)')}`,
    }));
  }
  // Self-designing Heuristics: a brain of glowing nodes, rewriting itself.
  {
    const g = rng(5);
    const inBrain = (x, y) => { const dx = (x - 150) / 95, dy = (y - 150) / 78; return dx * dx + dy * dy < 1 && !(Math.abs(x - 150) < 3); };
    const pts = []; while (pts.length < 70) { const x = 55 + g() * 190, y = 72 + g() * 156; if (inBrain(x, y)) pts.push([x, y]); }
    const lines = []; pts.forEach((p, i) => pts.forEach((q, j) => { if (j > i && Math.hypot(p[0] - q[0], p[1] - q[1]) < 34 && (p[0] - 150) * (q[0] - 150) > 0) lines.push(`<line x1="${f1(p[0])}" y1="${f1(p[1])}" x2="${f1(q[0])}" y2="${f1(q[1])}"/>`); }));
    emit('col_self_designing_heuristics', 'front', panel({
      defs: `${radial('sh-bg', [['0%', '#2a2a6a'], ['100%', '#04040e']])}${radial('sh-core', [['0%', '#9fb4ff', 0.55], ['100%', '#6a5aff', 0]])}${vignette('sh-v')}<filter id="sh-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>`,
      inner: `${rect('url(#sh-bg)')}${stars(40, 3)}<ellipse cx="150" cy="150" rx="120" ry="100" fill="url(#sh-core)"/>
        <path d="M148,74 C110,62 66,82 58,122 C48,170 80,220 128,226 C140,228 146,220 148,214 Z M152,74 C190,62 234,82 242,122 C252,170 220,220 172,226 C160,228 154,220 152,214 Z" fill="none" stroke="#9fb4ff" stroke-width="2" opacity="0.7"/>
        <g stroke="#7fa8ff" stroke-width="2.5" opacity="0.35" filter="url(#sh-glow)">${lines.join('')}</g>
        <g stroke="#cfe0ff" stroke-width="0.9" opacity="0.8">${lines.join('')}</g>
        ${pts.map(([x, y], i) => `<circle cx="${f1(x)}" cy="${f1(y)}" r="${i % 7 ? 2.2 : 4}" fill="${i % 9 ? '#eef4ff' : '#c49aff'}"/>`).join('')}
        <path d="M128,228 Q140,252 150,258 Q160,252 172,228" fill="none" stroke="#9fb4ff" stroke-width="2" opacity="0.5"/>${rect('url(#sh-v)')}`,
    }));
  }
  // Combat Quadrupeds: a four-legged war machine stalking a red ridge at dusk.
  {
    const leg = (x, y, dir, k) => `<path d="M${x},${y} L${x + dir * 14},${y + 34} L${x + dir * 4 + k},${y + 70}" stroke="url(#cq-metal)" stroke-width="10" fill="none" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${x + dir * 14}" cy="${y + 34}" r="6.5" fill="#2a2e34" stroke="#9aa2ac" stroke-width="1.5"/><ellipse cx="${x + dir * 4 + k}" cy="${y + 72}" rx="8" ry="3.5" fill="#1a1c20"/>`;
    emit('col_combat_quadrupeds', 'front', panel({
      defs: `${linear('cq-sky', [['0%', '#2a1420'], ['55%', '#b0502a'], ['100%', '#f0a060']])}${linear('cq-metal', [['0%', '#c8ccd2'], ['100%', '#4a5058']], 0, 1)}${linear('cq-body', [['0%', '#9aa2ac'], ['100%', '#3a4048']])}${linear('cq-ground', [['0%', '#7a3a20'], ['100%', '#2a1008']])}${vignette('cq-v')}`,
      inner: `${rect('url(#cq-sky)')}<circle cx="235" cy="120" r="26" fill="#ffd8a0" opacity="0.8"/>
        <path d="M0,190 L40,170 L90,182 L140,160 L200,176 L250,158 L300,170 L300,${H} L0,${H} Z" fill="#5a2a18" opacity="0.8"/>
        <path d="M0,236 Q80,220 160,232 T300,226 L300,${H} L0,${H} Z" fill="url(#cq-ground)"/>
        <ellipse cx="150" cy="${236 + 6}" rx="90" ry="9" fill="#000" opacity="0.35"/>
        ${leg(96, 170, -1, -6)}${leg(118, 170, 1, 4)}
        <path d="M80,150 Q84,132 110,130 L196,130 Q222,132 224,150 L222,170 Q216,182 196,182 L106,182 Q84,182 80,170 Z" fill="url(#cq-body)"/>
        <rect x="110" y="140" width="80" height="6" rx="3" fill="#2a2e34" opacity="0.6"/><rect x="118" y="158" width="64" height="10" rx="3" fill="#c87a3a" opacity="0.55"/>
        ${leg(186, 170, -1, -4)}${leg(206, 170, 1, 6)}
        <path d="M214,140 L246,128 Q262,126 262,140 L258,152 Q252,160 238,158 L216,156 Z" fill="url(#cq-body)"/>
        <circle cx="251" cy="141" r="5" fill="#ff4a3a"/><circle cx="251" cy="141" r="10" fill="#ff4a3a" opacity="0.25"/>
        <path d="M224,132 L232,112" stroke="#9aa2ac" stroke-width="3"/><circle cx="232" cy="110" r="3" fill="#ffd8a0"/>
        ${rect('url(#cq-v)')}`,
    }));
  }
  // Sensor Web Sail: a gossamer square sail lit from behind by a beamed laser.
  {
    const mesh = []; for (let i = 1; i < 12; i++) { const k = i / 12; mesh.push(`M${f1(150 - 100 + k * 100)},${f1(150 - 0 + k * -95 + 95 - 95)}`); }
    const A = [150, 55], B = [250, 150], C = [150, 245], D = [50, 150];
    const lerp = (p, q, k) => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
    let grid = '';
    for (let i = 1; i < 14; i++) { const k = i / 14; const p1 = lerp(A, B, k), p2 = lerp(D, C, k), q1 = lerp(A, D, k), q2 = lerp(B, C, k); grid += `M${f1(p1[0])},${f1(p1[1])}L${f1(p2[0])},${f1(p2[1])}M${f1(q1[0])},${f1(q1[1])}L${f1(q2[0])},${f1(q2[1])}`; }
    emit('col_sensor_web_sail', 'front', panel({
      defs: `${radial('sw-bg', [['0%', '#1a2440'], ['100%', '#020308']])}${radial('sw-sail', [['0%', '#fff4e0'], ['30%', '#e8d4c0', 0.85], ['100%', '#8a96b4', 0.35]])}${radial('sw-burst', [['0%', '#ffffff'], ['25%', '#ffe0b0', 0.9], ['100%', '#ff9a5a', 0]])}${linear('sw-beam', [['0%', '#7fd0ff', 0], ['100%', '#7fd0ff', 0.55]], 1, -1)}${vignette('sw-v')}`,
      inner: `${rect('url(#sw-bg)')}${stars(80, 5)}
        <path d="M0,${H} L130,160 L170,140 L40,${H} Z" fill="url(#sw-beam)" opacity="0.6"/>
        <path d="M${A}L${B}L${C}L${D}Z" fill="url(#sw-sail)" stroke="#dfe8ff" stroke-width="1.5"/>
        <path d="${grid}" stroke="#6a7a9a" stroke-width="0.6" opacity="0.55"/>
        <path d="M${A}L${C}M${B}L${D}" stroke="#3a5a9a" stroke-width="2.2" opacity="0.8"/>
        <circle cx="150" cy="150" r="46" fill="url(#sw-burst)"/>
        ${[A, B, C, D].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" fill="#fff"/>`).join('')}${rect('url(#sw-v)')}`,
    }));
  }
  // Nano-3D Printers: a honeycomb build lattice with an object assembling in light.
  {
    let cells = '';
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      const x = c * 36 + (r % 2) * 18 - 4, y = r * 32 + 10, d = Math.hypot(x - 150, y - 160) / 170;
      cells += `<path d="M${x},${y - 18} l15.6,9 v18 l-15.6,9 l-15.6,-9 v-18 z" fill="url(#np-cell)" stroke="#b8c4d4" stroke-width="1.6" opacity="${f1(Math.max(0.12, 0.95 - d))}"/>`;
    }
    emit('col_nano_3d_printers', 'front', panel({
      defs: `${radial('np-bg', [['0%', '#3a4252'], ['100%', '#06070a']])}${linear('np-cell', [['0%', '#2a3240'], ['100%', '#0e1218']])}${radial('np-glow', [['0%', '#9ff0ff', 0.9], ['100%', '#3ab0ff', 0]])}${linear('np-cube', [['0%', '#f2f8ff'], ['100%', '#8ac8f0']])}${vignette('np-v')}`,
      inner: `${rect('url(#np-bg)')}${cells}<ellipse cx="150" cy="160" rx="80" ry="70" fill="url(#np-glow)"/>
        <g transform="translate(150,150)"><path d="M0,-34 L30,-17 L30,17 L0,34 L-30,17 L-30,-17 Z" fill="url(#np-cube)" opacity="0.95"/><path d="M0,0 L30,-17 M0,0 L-30,-17 M0,0 L0,34" stroke="#4a8ac0" stroke-width="1.5"/>
        <path d="M-30,-17 L0,-34 L30,-17" fill="none" stroke="#fff" stroke-width="1.5"/></g>
        ${[-60, -30, 0, 30, 60].map((x) => `<line x1="${150 + x}" y1="40" x2="${150 + x * 0.3}" y2="120" stroke="#9ff0ff" stroke-width="1.2" opacity="0.5"/>`).join('')}
        <rect x="70" y="30" width="160" height="12" rx="4" fill="#5a6474"/>${rect('url(#np-v)')}`,
    }));
  }

  // ================= SPACEBORN HUMANS =================
  // Gabonese Mining Consortium: a boy scanning the skyline through binoculars.
  {
    const b = bust({ id: 'gmb', cx: 150, cy: 132, r: 40, skin: ['#7a4a2c', '#3e2214'], hair: '#0e0806', style: 'buzz', shirt: ['#f6f2ea', '#bdb4a2'], collar: 'round', rim: '#fff6d8',
      extra: `<g>
        <path d="M52,330 Q62,250 98,150 L120,154 Q96,240 92,330 Z" fill="url(#gmb-sh)"/>
        <path d="M248,330 Q238,250 202,150 L180,154 Q204,240 208,330 Z" fill="url(#gmb-sh)"/>
        <ellipse cx="112" cy="140" rx="11" ry="13" fill="#5a3420"/><ellipse cx="188" cy="140" rx="11" ry="13" fill="#5a3420"/>
        <rect x="114" y="114" width="32" height="34" rx="9" fill="#26282c"/><rect x="154" y="114" width="32" height="34" rx="9" fill="#26282c"/>
        <rect x="142" y="120" width="16" height="12" rx="3" fill="#18191c"/>
        <circle cx="130" cy="131" r="12" fill="#1a2a3a" stroke="#4a4e56" stroke-width="2.5"/><circle cx="170" cy="131" r="12" fill="#1a2a3a" stroke="#4a4e56" stroke-width="2.5"/>
        <circle cx="130" cy="131" r="7" fill="#3a6a9a"/><circle cx="170" cy="131" r="7" fill="#3a6a9a"/>
        <circle cx="127" cy="128" r="2.5" fill="#fff" opacity="0.85"/><circle cx="167" cy="128" r="2.5" fill="#fff" opacity="0.85"/>
        <rect x="118" y="114" width="24" height="4" rx="2" fill="#4a4e56"/><rect x="158" y="114" width="24" height="4" rx="2" fill="#4a4e56"/></g>` });
    emit('col_gabonese_mining_consortium', 'front', panel({
      defs: `${linear('gm-sky', [['0%', '#7ab4dc'], ['70%', '#d8e8f0'], ['100%', '#f0e8d8']])}${vignette('gm-v')}${b.defs}`,
      inner: `${rect('url(#gm-sky)')}<g opacity="0.55" fill="#9ab0c4"><rect x="18" y="80" width="30" height="200"/><rect x="54" y="120" width="22" height="160"/><rect x="232" y="60" width="36" height="230"/><rect x="270" y="110" width="26" height="180"/></g>
        <g opacity="0.35" fill="#fff">${Array.from({ length: 20 }, (_, i) => `<rect x="${236 + (i % 4) * 8}" y="${72 + Math.floor(i / 4) * 18}" width="4" height="8"/>`).join('')}</g>${b.svg}${rect('url(#gm-v)')}`,
    }));
  }
  // Prehensilists: a single bead of water hanging in zero g, lit through.
  {
    emit('col_prehensilists', 'front', panel({
      defs: `${radial('ph-bg', [['0%', '#1a6aa0'], ['60%', '#08304e'], ['100%', '#02080e']], '50%', '55%')}${radial('ph-drop', [['0%', '#e8fbff'], ['35%', '#7ad0ff'], ['100%', '#0e5a9a']], '38%', '30%', '75%')}${radial('ph-glow', [['0%', '#7ad0ff', 0.6], ['100%', '#7ad0ff', 0]])}${vignette('ph-v')}`,
      inner: `${rect('url(#ph-bg)')}<ellipse cx="150" cy="170" rx="110" ry="100" fill="url(#ph-glow)"/>
        ${[0, 1, 2, 3].map((i) => `<ellipse cx="150" cy="250" rx="${30 + i * 26}" ry="${6 + i * 5}" fill="none" stroke="#9fe0ff" stroke-width="1.5" opacity="${(0.5 - i * 0.1).toFixed(2)}"/>`).join('')}
        <path d="M150,52 C150,52 96,128 96,172 C96,208 120,232 150,232 C180,232 204,208 204,172 C204,128 150,52 150,52 Z" fill="url(#ph-drop)" stroke="#cff4ff" stroke-width="1.5"/>
        <path d="M128,150 C122,170 124,194 138,210" stroke="#fff" stroke-width="7" fill="none" opacity="0.55" stroke-linecap="round"/>
        <ellipse cx="170" cy="196" rx="14" ry="8" fill="#fff" opacity="0.25"/>
        ${[[70, 90, 4], [232, 80, 6], [246, 210, 3], [60, 214, 5], [212, 48, 3]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#bff0ff" opacity="0.55"/><circle cx="${x - r * 0.3}" cy="${y - r * 0.3}" r="${r * 0.3}" fill="#fff" opacity="0.8"/>`).join('')}
        ${rect('url(#ph-v)')}`,
    }));
  }
  // Exoskeletalists: a hiker in a powered leg frame climbing a red canyon trail.
  {
    emit('col_exoskeletalists', 'front', panel({
      defs: `${linear('ex-sky', [['0%', '#f0b080'], ['100%', '#e07a4a']])}${linear('ex-far', [['0%', '#c0603a'], ['100%', '#8a3a20']])}${linear('ex-near', [['0%', '#7a3018'], ['100%', '#3a1408']])}${linear('ex-suit', [['0%', '#e8eaee'], ['100%', '#9aa0aa']], 1, 1)}${linear('ex-skin', [['0%', '#e8c0a0'], ['100%', '#a8785a']])}${vignette('ex-v')}`,
      inner: `${rect('url(#ex-sky)')}<path d="M0,120 L30,96 L60,110 L60,${H} L0,${H} Z M240,90 L270,70 L300,84 L300,${H} L240,${H} Z" fill="url(#ex-far)"/>
        <path d="M0,170 L50,150 L80,180 L220,170 L260,140 L300,150 L300,${H} L0,${H} Z" fill="#a84a28" opacity="0.8"/>
        <path d="M0,260 Q120,236 300,250 L300,${H} L0,${H} Z" fill="url(#ex-near)"/>
        <g transform="translate(150,0)">
          <path d="M-22,96 L-34,96 Q-40,98 -40,108 L-40,170 Q-38,178 -30,178 L-20,178 Z" fill="#3a4250"/>
          <path d="M-20,98 Q-24,150 -18,176 L18,176 Q22,150 18,98 Q0,90 -20,98 Z" fill="url(#ex-suit)"/>
          <path d="M-6,176 L-22,214 L-14,256" stroke="url(#ex-suit)" stroke-width="15" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M8,176 L20,214 L32,250" stroke="url(#ex-suit)" stroke-width="15" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M-12,176 L-28,214 L-20,258 M14,176 L28,214 L40,252" stroke="#3a4250" stroke-width="4" fill="none" stroke-linejoin="round"/>
          <circle cx="-28" cy="214" r="6" fill="#ffb84a" stroke="#3a4250" stroke-width="2"/><circle cx="28" cy="214" r="6" fill="#ffb84a" stroke="#3a4250" stroke-width="2"/>
          <path d="M-18,108 L-30,140 L-24,156" stroke="url(#ex-suit)" stroke-width="10" fill="none" stroke-linecap="round"/>
          <path d="M18,108 L32,132 L46,124" stroke="url(#ex-suit)" stroke-width="10" fill="none" stroke-linecap="round"/>
          <path d="M-8,96 L-6,86 L6,86 L8,96 Z" fill="url(#ex-skin)"/>
          <circle cx="0" cy="72" r="16" fill="url(#ex-skin)"/><path d="M-16,70 Q-14,52 0,54 Q14,52 16,68 Q8,60 -4,62 Q-12,62 -16,70 Z" fill="#c8a060"/>
          <path d="M-20,258 L-6,258 M32,252 L46,254" stroke="#1a1c20" stroke-width="7" stroke-linecap="round"/>
        </g>${rect('url(#ex-v)')}`,
    }));
  }
  // Teleoperators: an operator in a headset, and the white robot she drives
  // offering a red rose.
  {
    const w = bust({ id: 'tow', cx: 92, cy: 122, r: 34, skin: ['#6a4430', '#3a2214'], hair: '#140c08', style: 'buzz', female: true, shirt: ['#2a2e36', '#0e1014'], collar: 'round', visor: ['#e8f0f8', '#7fa8d0'], lips: '#6a2a2a', rim: '#9fd8ff' });
    const r = robotBust({ id: 'tor', cx: 208, cy: 116, s: 0.95 });
    emit('col_teleoperators', 'front', panel({
      defs: `${radial('to-bg', [['0%', '#5a7088'], ['100%', '#0c1218']], '55%', '35%')}${vignette('to-v')}${w.defs}${r.defs}`,
      inner: `${rect('url(#to-bg)')}<path d="M120,96 Q160,40 200,70" stroke="#9fd8ff" stroke-width="1.5" stroke-dasharray="4 5" fill="none" opacity="0.6"/>${r.svg}
        <g transform="translate(206,188)"><path d="M0,0 L-4,46" stroke="#3a7a3a" stroke-width="3"/><path d="M-2,22 q-12,-6 -16,4 q10,4 16,-4" fill="#4a9a4a"/>
        <circle cx="0" cy="-4" r="12" fill="#c8202e"/><path d="M-10,-6 Q0,-18 10,-6 Q4,2 0,-2 Q-4,2 -10,-6 Z" fill="#e8404a"/><path d="M-4,-4 Q0,-10 4,-4" stroke="#8a1018" stroke-width="1.5" fill="none"/></g>
        <path d="M180,250 Q200,214 206,196" stroke="url(#tor-shell)" stroke-width="14" fill="none" stroke-linecap="round"/>${w.svg}${rect('url(#to-v)')}`,
    }));
  }
  // Boston Hexapods: an engineer at a holo display showing her six-legged walker.
  {
    const w = bust({ id: 'bhw', cx: 210, cy: 126, r: 34, skin: ['#f0d0b8', '#b08068'], hair: '#e8e4e0', hairHi: '#ffffff', style: 'bun', female: true, shirt: ['#f4f6f8', '#b4bcc6'], collar: 'coat', eyes: '#3a5a7a', lips: '#b0605a', turn: -0.5, rim: '#9ff0ff' });
    const hx = (cx, cy) => {
      const legs = [0, 1, 2].map((i) => { const x = cx - 30 + i * 30; return `<path d="M${x},${cy + 6} L${x - 12},${cy + 22} L${x - 16},${cy + 40} M${x},${cy + 6} L${x + 12},${cy + 22} L${x + 16},${cy + 40}"/>`; }).join('');
      return `<g stroke="#9ff0ff" stroke-width="2" fill="none"><rect x="${cx - 44}" y="${cy - 8}" width="88" height="18" rx="7"/>${legs}<circle cx="${cx + 52}" cy="${cy - 6}" r="8"/></g>`;
    };
    emit('col_boston_hexapods', 'front', panel({
      defs: `${radial('bh-bg', [['0%', '#1e4a5e'], ['100%', '#040e14']], '35%', '40%')}${linear('bh-scr', [['0%', '#4ad8ff', 0.28], ['100%', '#1a7aa8', 0.12]], 1, 1)}${vignette('bh-v')}${w.defs}`,
      inner: `${rect('url(#bh-bg)')}<g transform="skewY(-6)"><rect x="18" y="80" width="140" height="120" rx="6" fill="url(#bh-scr)" stroke="#9ff0ff" stroke-width="1.5" opacity="0.95"/>
        <g opacity="0.35" stroke="#9ff0ff">${Array.from({ length: 7 }, (_, i) => `<line x1="18" y1="${92 + i * 16}" x2="158" y2="${92 + i * 16}"/>`).join('')}</g>${hx(84, 128)}
        <text x="26" y="96" fill="#9ff0ff" font-family="monospace" font-size="8">GAIT 6/6</text></g>
        ${w.svg}<path d="M168,236 Q150,200 130,176" stroke="#f4f6f8" stroke-width="12" fill="none" stroke-linecap="round"/><circle cx="128" cy="174" r="7" fill="#e8c4ac"/>${rect('url(#bh-v)')}`,
    }));
  }
  // Neural Pilots: a sleek spaceplane flown by thought, climbing out of the clouds.
  {
    emit('col_neural_pilots', 'front', panel({
      defs: `${linear('nl-sky', [['0%', '#5a4a8a'], ['55%', '#e89a8a'], ['100%', '#ffd8a8']])}${linear('nl-hull', [['0%', '#ffffff'], ['100%', '#9aa4b4']])}${linear('nl-trail', [['0%', '#fff', 0], ['100%', '#fff', 0.8]], 1, 0)}${vignette('nl-v')}`,
      inner: `${rect('url(#nl-sky)')}<circle cx="80" cy="200" r="30" fill="#fff4d8" opacity="0.7"/>
        <g fill="#fff" opacity="0.85">${[[40, 270, 60], [120, 286, 70], [220, 272, 64], [290, 290, 50]].map(([x, y, r]) => `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 0.38}"/>`).join('')}</g>
        <path d="M10,226 L150,150 L156,162 L20,236 Z" fill="url(#nl-trail)" opacity="0.6"/>
        <g transform="translate(176,140) rotate(-24)">
          <path d="M90,0 Q60,-14 -10,-14 L-60,-8 L-66,0 L-60,8 L-10,14 Q60,14 90,0 Z" fill="url(#nl-hull)"/>
          <path d="M10,-12 L-30,-46 L-44,-46 L-26,-12 Z M10,12 L-30,40 L-44,40 L-26,12 Z" fill="#c8ccd6"/>
          <path d="M-44,-6 L-66,-30 L-74,-30 L-60,-6 Z" fill="#c8ccd6"/>
          <path d="M40,-8 Q60,-8 72,-2 L40,-2 Z" fill="#2a3a5a"/>
          <rect x="-62" y="-5" width="8" height="10" fill="#ffb84a"/><ellipse cx="-70" cy="0" rx="10" ry="5" fill="#ffe0a0" opacity="0.8"/>
          <path d="M-10,4 L60,4" stroke="#7a8496" stroke-width="1.5"/></g>${rect('url(#nl-v)')}`,
    }));
  }
  // VR Simulcasters: a woman beside the holographic presence she streams.
  {
    const w = bust({ id: 'vrw', cx: 102, cy: 128, r: 36, skin: ['#8a5a3c', '#4a2a18'], hair: '#1a0e08', hairHi: '#3a2214', style: 'curly', female: true, shirt: ['#8a4aa8', '#4a1a6a'], collar: 'round', lips: '#7a3a3a', rim: '#7ff0ff', turn: 0.4 });
    const h = bust({ id: 'vrh', cx: 212, cy: 118, r: 34, skin: ['#9ff8ff', '#2ab0d0'], hair: '#5ad8f0', style: 'white', shirt: ['#7ff0ff', '#1a8ab0'], collar: 'round', eyes: '#ffffff', lips: '#5ad8f0', brow: '#e8fcff' });
    emit('col_vr_simulcasters', 'front', panel({
      defs: `${radial('vr-bg', [['0%', '#3a5a3e'], ['100%', '#081008']], '55%', '35%')}${radial('vr-halo', [['0%', '#7ff0ff', 0.45], ['100%', '#7ff0ff', 0]])}${vignette('vr-v')}${w.defs}${h.defs}`,
      inner: `${rect('url(#vr-bg)')}<path d="M0,0 L60,0 L40,${H} L0,${H} Z" fill="#5a3a20" opacity="0.4"/><ellipse cx="212" cy="160" rx="80" ry="120" fill="url(#vr-halo)"/>
        <g opacity="0.72">${h.svg}</g><g stroke="#e8fcff" opacity="0.18">${Array.from({ length: 30 }, (_, i) => `<line x1="140" y1="${60 + i * 9}" x2="290" y2="${60 + i * 9}"/>`).join('')}</g>
        <ellipse cx="212" cy="304" rx="60" ry="8" fill="#7ff0ff" opacity="0.5"/>${w.svg}${rect('url(#vr-v)')}`,
    }));
  }
  // Transhuman Activists: Earth ringed by people who have outgrown it.
  {
    const e = earth({ id: 'ta-e', cx: 150, cy: 150, r: 70 });
    const ring = Array.from({ length: 18 }, (_, i) => {
      const a = (i / 18) * Math.PI * 2, x = 150 + Math.cos(a) * 112, y = 150 + Math.sin(a) * 112, rot = (a * 180) / Math.PI + 90;
      return `<g transform="translate(${f1(x)},${f1(y)}) rotate(${f1(rot)})"><circle cx="0" cy="-9" r="4" fill="#fff"/><path d="M-4,-4 L4,-4 L5,6 L2,6 L1,12 L-1,12 L-2,6 L-5,6 Z" fill="#fff"/><path d="M-5,-2 L-12,2 M5,-2 L12,2" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></g>`;
    }).join('');
    emit('col_transhuman_activists', 'front', panel({
      defs: `${radial('ta-bg', [['0%', '#1e3050'], ['100%', '#03050c']])}${radial('ta-halo', [['0%', '#9ff0d0', 0.5], ['100%', '#9ff0d0', 0]])}${e.defs}${night('ta-e')}${vignette('ta-v')}`,
      inner: `${rect('url(#ta-bg)')}${stars(80, 9)}<circle cx="150" cy="150" r="140" fill="url(#ta-halo)"/>
        <circle cx="150" cy="150" r="112" fill="none" stroke="#9ff0d0" stroke-width="1.2" opacity="0.5"/>${e.svg}${ring}${rect('url(#ta-v)')}`,
    }));
  }
  // Clone Entrepreneurs: twin embryos curled in glowing growth pods.
  {
    const pod = (cx, id) => `<g>
      <rect x="${cx - 46}" y="54" width="92" height="196" rx="44" fill="url(#ce-fluid)"/>
      <ellipse cx="${cx}" cy="150" rx="46" ry="90" fill="url(#ce-light)"/>
      <g transform="translate(${cx},150)">
        <path d="M-6,-34 C-30,-30 -36,0 -26,22 C-18,40 10,44 22,30 C32,18 26,2 14,0 C24,-12 20,-34 -6,-34 Z" fill="url(#ce-body)"/>
        <circle cx="4" cy="-30" r="20" fill="url(#ce-body)"/>
        <path d="M-20,8 Q-8,18 6,10" stroke="#c0605a" stroke-width="3" fill="none" opacity="0.6"/>
        <circle cx="12" cy="-32" r="3" fill="#7a2a2a" opacity="0.6"/>
        <path d="M14,24 Q36,44 30,74" stroke="#d07070" stroke-width="3" fill="none" opacity="0.7"/></g>
      <rect x="${cx - 46}" y="54" width="92" height="196" rx="44" fill="none" stroke="#dff4ff" stroke-width="2.5" opacity="0.85"/>
      <path d="M${cx - 30},80 Q${cx - 36},150 ${cx - 28},220" stroke="#fff" stroke-width="5" fill="none" opacity="0.35" stroke-linecap="round"/>
      <rect x="${cx - 52}" y="40" width="104" height="20" rx="5" fill="url(#ce-cap)"/><rect x="${cx - 52}" y="244" width="104" height="22" rx="5" fill="url(#ce-cap)"/>
      ${[0, 1, 2].map((i) => `<circle cx="${cx - 20 + i * 18}" cy="${230 - i * 40}" r="${2 + i}" fill="#dff4ff" opacity="0.6"/>`).join('')}</g>`;
    emit('col_clone_entrepreneurs', 'front', panel({
      defs: `${radial('ce-bg', [['0%', '#1a3a44'], ['100%', '#030a0c']])}${linear('ce-fluid', [['0%', '#5ac8d8', 0.35], ['100%', '#1a5a6a', 0.55]])}${radial('ce-light', [['0%', '#ffd0c0', 0.55], ['100%', '#ff8a7a', 0]])}${radial('ce-body', [['0%', '#ffd8c8'], ['100%', '#e07a6a']], '40%', '35%')}${linear('ce-cap', [['0%', '#9aa8b4'], ['100%', '#3a4450']])}${vignette('ce-v')}`,
      inner: `${rect('url(#ce-bg)')}${pod(96)}${pod(204)}${rect('url(#ce-v)')}`,
    }));
  }
}
