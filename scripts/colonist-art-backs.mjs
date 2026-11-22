// The promoted (purple) sides, second pass (owner 2026-11-20: "make sure all promo
// sides that are non-human get an upgraded pass too"). Same purple field every
// back shares, with the subject drawn in the richer style of the redrawn fronts:
// lit gradients, glows, depth. People come from the cut-out character kit.
import { artKit } from './colonist-art-m4-fronts.mjs';
import { drawCutout, drawHead, restPose, skeleton, fk, reach, ROBOT_LOOK } from './rig2d/cutout.mjs';

export const UPGRADED_BACKS = new Set([
  'col_babbage_halbonauts', 'col_biomechs', 'col_boyle_engineering_collective', 'col_calypso_2_seed_sail',
  'col_heavy_water_survivalists', 'col_house_of_saud', 'col_juiced_cosmonauts', 'col_microgravity_pantrophists',
  'col_programmable_matter', 'col_security_system', 'col_siren_cybernautics_inc', 'col_smart_pets',
  'col_transorbital_railworkers', 'col_vatican_observers', 'col_beowulf_internet', 'col_self_designing_heuristics',
  'col_combat_quadrupeds', 'col_sensor_web_sail', 'col_nano_3d_printers', 'col_lava_lamp_evangelists',
  'col_gabonese_mining_consortium', 'col_prehensilists', 'col_exoskeletalists', 'col_teleoperators',
  'col_neural_pilots', 'col_transhuman_activists', 'col_clone_entrepreneurs',
]);

export function drawUpgradedBacks({ W, H, panel, emit }) {
  const { f1, rect, radial, linear, stars, rng } = artKit({ W, H });
  const CX = W / 2, CY = H / 2;
  const bg = (id) => radial(id, [['0%', '#655ca8'], ['100%', '#652d91']], '50%', '44%', '80%');
  const glow = (id, c, a = 0.8) => radial(id, [['0%', c, a], ['100%', c, 0]], '50%', '50%', '50%');
  const vig = (id) => radial(id, [['60%', '#1a0a30', 0], ['100%', '#1a0a30', 0.45]], '50%', '45%', '75%');
  const out = (id, defs, inner) => emit(id, 'back', panel({ defs: `${bg(id + '-bg')}${vig(id + '-vg')}${defs}`, inner: `${rect(`url(#${id}-bg)`)}${stars(14, id.length)}${inner}${rect(`url(#${id}-vg)`)}` }));
  const at = (x, foot = 324, h = 46, rot = {}, extra = {}) => ({ ...restPose(x, foot, h), rot, ...extra });
  const fig = (id, look, pose) => drawCutout({ id, look, pose });
  const sil = (id, col) => `<filter id="${id}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 ${col[0]}  0 0 0 0 ${col[1]}  0 0 0 0 ${col[2]}  0 0 0 1 0"/></filter>`;
  const R = rng(5);

  // Utility Fog Halbonaut: a figure made of a cloud of glowing motes.
  { const g = rng(11); let motes = '';
    for (let i = 0; i < 520; i++) { const x = 70 + g() * 160, y = 20 + g() * 300; motes += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(1 + g() * 2.2)}" fill="#e8f6ff" opacity="${f1(0.4 + g() * 0.6)}"/>`; }
    out('col_babbage_halbonauts', `${glow('uf-g', '#bfe8ff', 0.55)}<mask id="uf-m">${fig('uf-f', { body: 'male', hairStyle: 'buzz' }, at(150, 318, 46, { upperL: -50, foreL: -40, upperR: 30 }))}</mask>${sil('uf-w', [1, 1, 1])}`,
      `<ellipse cx="150" cy="170" rx="120" ry="160" fill="url(#uf-g)"/><g mask="url(#uf-m)"><g filter="url(#uf-w)" opacity="0.18">${fig('uf-f2', { body: 'male', hairStyle: 'buzz' }, at(150, 318, 46, { upperL: -50, foreL: -40, upperR: 30 }))}</g>${motes}</g>
       ${Array.from({ length: 40 }, () => `<circle cx="${f1(60 + R() * 180)}" cy="${f1(30 + R() * 280)}" r="1.2" fill="#e8f6ff" opacity="0.5"/>`).join('')}`); }

  // Group Mind Immortalists: three heads sharing one lit mind.
  { const looks = [{ skin: '#e8c0a0', hair: '#c8c8c8', hairStyle: 'bald', face: 'sleepy' }, { skin: '#8a5a3a', hair: '#1a1410', hairStyle: 'buzz', face: 'sleepy', body: 'female' }, { skin: '#d8a888', hair: '#5a3a22', hairStyle: 'bob', face: 'sleepy', body: 'female' }];
    const pos = [[150, 150, 120], [72, 220, 90], [228, 220, 90]];
    out('col_biomechs', `${glow('gm-g', '#d8c8ff', 0.85)}`,
      `<circle cx="150" cy="120" r="110" fill="url(#gm-g)"/><g stroke="#e8dcff" stroke-width="2.5" opacity="0.8" fill="none"><path d="M150,96 Q110,120 72,184 M150,96 Q190,120 228,184 M72,184 Q150,230 228,184"/></g>
       ${pos.map(([x, y, s], i) => `${drawHead({ id: `gm${i}`, look: { blush: false, ...looks[i] }, x, y, size: s })}<circle cx="${x}" cy="${y - s * 0.52}" r="6" fill="#fff" stroke="#b8a0ff" stroke-width="2"/>`).join('')}
       <circle cx="150" cy="96" r="12" fill="#fff" opacity="0.9"/>`); }

  // Martian Assembly: a space elevator rising off Mars.
  out('col_boyle_engineering_collective', `${radial('ma-mars', [['0%', '#ffb07a'], ['60%', '#c8562a'], ['100%', '#5a1a0a']], '35%', '25%', '80%')}${glow('ma-g', '#ffd8b0', 0.6)}${linear('ma-t', [['0%', '#ffffff', 0.2], ['100%', '#ffffff', 0.95]])}`,
    `<circle cx="150" cy="430" r="220" fill="url(#ma-mars)"/><path d="M-60,300 Q150,190 360,300" stroke="#ffb07a" stroke-width="3" fill="none" opacity="0.4"/>
     <rect x="148" y="40" width="4" height="200" fill="url(#ma-t)"/><circle cx="150" cy="40" r="40" fill="url(#ma-g)"/>
     <g transform="translate(150,40)"><rect x="-26" y="-8" width="52" height="16" rx="6" fill="#e8ecf2"/><rect x="-6" y="-22" width="12" height="44" rx="4" fill="#c8ced8"/><rect x="-46" y="-4" width="18" height="8" fill="#7ab0ff"/><rect x="28" y="-4" width="18" height="8" fill="#7ab0ff"/></g>
     <g transform="translate(150,150)"><rect x="-9" y="-12" width="18" height="24" rx="3" fill="#f2f4f8"/><rect x="-6" y="-7" width="12" height="6" fill="#ffb84a"/></g>
     <g fill="#3a1408" opacity="0.6"><path d="M70,250 l14,-18 l14,18 z"/><path d="M200,245 l10,-14 l10,14 z"/></g>`);

  // Wet-Nano Seed Sail: a living seed trailing a wet membrane sail.
  out('col_calypso_2_seed_sail', `${radial('ws-seed', [['0%', '#e0fff0'], ['50%', '#5ad8a0'], ['100%', '#0e5a40']], '40%', '35%', '70%')}${linear('ws-sail', [['0%', '#9af0d0', 0.7], ['100%', '#9af0d0', 0.05]])}${glow('ws-g', '#7affc8', 0.5)}`,
    `<circle cx="150" cy="120" r="100" fill="url(#ws-g)"/><path d="M150,120 Q40,180 30,320 L270,320 Q260,180 150,120 Z" fill="url(#ws-sail)"/>
     ${Array.from({ length: 9 }, (_, i) => `<path d="M150,120 Q${60 + i * 22},220 ${30 + i * 30},320" stroke="#c8ffe8" stroke-width="1" fill="none" opacity="0.5"/>`).join('')}
     <ellipse cx="150" cy="120" rx="42" ry="50" fill="url(#ws-seed)"/><ellipse cx="136" cy="102" rx="12" ry="8" fill="#fff" opacity="0.6"/>
     ${Array.from({ length: 14 }, () => `<circle cx="${f1(50 + R() * 200)}" cy="${f1(150 + R() * 160)}" r="${f1(2 + R() * 4)}" fill="#c8ffe8" opacity="0.6"/>`).join('')}`);

  // New Attica Secessionists: a settler plants the flag of a breakaway rock, Earth behind.
  out('col_heavy_water_survivalists', `${radial('na-e', [['0%', '#9ad8ff'], ['60%', '#2a6aa8'], ['100%', '#0a1a3a']], '35%', '30%')}${radial('na-rock', [['0%', '#b8b0c8'], ['100%', '#4a4258']], '40%', '20%', '90%')}`,
    `<circle cx="60" cy="80" r="56" fill="url(#na-e)"/><path d="M30,64 q16,-10 28,4 q-8,14 -22,10 z M70,96 q12,-4 18,8 q-10,6 -18,-8 z" fill="#5ab06a" opacity="0.8"/>
     <path d="M-10,330 L-10,290 Q60,250 150,262 Q240,250 310,286 L310,330 Z" fill="url(#na-rock)"/>
     ${fig('na-f', { body: 'male', skin: '#c98a5e', hair: '#2a2420', hairStyle: 'buzz', face: 'grin', top: 'jacket', topColor: '#3a4a3a', collar: '#e8e0c8', bottomColor: '#2a2e2a', hands: { L: 'fist', R: 'relaxed' } }, at(170, 300, 40, { upperL: -150, foreL: -10 }))}
     <path d="M232,268 L232,96" stroke="#e8e4dc" stroke-width="3"/><path d="M232,98 L292,110 L232,124 Z" fill="#c8202e"/><circle cx="252" cy="111" r="5" fill="#fff"/>`);

  // Iceworms: a glossy segmented worm boring out of a comet's ice.
  { let seg = ''; for (let i = 0; i < 9; i++) { const t = i / 8, x = 60 + t * 170, y = 250 - Math.sin(t * Math.PI) * 140 - t * 30, r = 14 + t * 22;
      seg += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}" fill="url(#iw-s)"/><circle cx="${f1(x - r * 0.3)}" cy="${f1(y - r * 0.35)}" r="${f1(r * 0.28)}" fill="#fff" opacity="0.55"/>`; }
    out('col_house_of_saud', `${radial('iw-s', [['0%', '#f4eaff'], ['60%', '#b89ae8'], ['100%', '#5a3a9a']], '35%', '30%')}${linear('iw-ice', [['0%', '#e8f6ff'], ['100%', '#7aa8d0']])}`,
      `<path d="M-10,330 L-10,262 L40,236 L90,258 L120,236 L170,262 L230,240 L310,270 L310,330 Z" fill="url(#iw-ice)"/><g fill="#fff" opacity="0.5"><path d="M40,236 l10,30 l-20,0 z M230,240 l8,26 l-18,0 z"/></g>
       ${seg}<g transform="translate(230,80)"><circle r="36" fill="#3a1a5a"/>${Array.from({ length: 10 }, (_, i) => `<path d="M0,-30 l4,-12 l4,12 z" fill="#f4eaff" transform="rotate(${i * 36})"/>`).join('')}<circle r="14" fill="#140a24"/></g>
       ${Array.from({ length: 12 }, () => `<path d="M${f1(40 + R() * 220)},${f1(240 + R() * 60)} l3,-6 l3,6 z" fill="#fff" opacity="0.7"/>`).join('')}`); }

  // Rental Body Guild: sleeping bodies for hire, each in its numbered rack.
  out('col_juiced_cosmonauts', `${linear('rb-pod', [['0%', '#ffffff', 0.35], ['100%', '#b8a8e8', 0.12]])}`,
    [70, 150, 230].map((x, i) => `<rect x="${x - 36}" y="30" width="72" height="290" rx="34" fill="#2a1a4a" opacity="0.6"/>
      ${fig(`rb${i}`, { body: i === 1 ? 'female' : 'male', skin: ['#e8c0a0', '#8a5a3a', '#d0a080'][i], hair: '#2a2420', hairStyle: ['buzz', 'bob', 'tuft'][i], face: 'sleepy', top: 'jumpsuit', topColor: '#e8e4f0', hands: { L: 'relaxed', R: 'relaxed' }, blush: false }, at(x, 306, 38))}
      <rect x="${x - 36}" y="30" width="72" height="290" rx="34" fill="url(#rb-pod)" stroke="#e8dcff" stroke-width="2"/>
      <rect x="${x - 18}" y="14" width="36" height="14" rx="4" fill="#ffd84a"/><text x="${x}" y="25" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="10" fill="#3a2a00">${i + 1}¤</text>`).join(''));

  // Blue Goo Sybonts: a glowing blue colony of cells.
  out('col_microgravity_pantrophists', `${radial('bg-goo', [['0%', '#c8f0ff'], ['50%', '#3a9ae8'], ['100%', '#0a3a8a']], '40%', '35%')}${glow('bg-g', '#7ad0ff', 0.7)}`,
    `<circle cx="150" cy="170" r="140" fill="url(#bg-g)"/><path d="M150,70 C230,60 260,150 230,210 C210,270 120,290 80,240 C40,190 70,80 150,70 Z" fill="url(#bg-goo)"/>
     ${Array.from({ length: 16 }, () => { const x = 100 + R() * 110, y = 110 + R() * 130, r = 6 + R() * 12; return `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}" fill="#e8faff" opacity="0.35"/><circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r * 0.35)}" fill="#0a3a8a" opacity="0.6"/>`; }).join('')}
     <ellipse cx="124" cy="104" rx="26" ry="12" fill="#fff" opacity="0.5"/>
     ${Array.from({ length: 6 }, () => { const x = 40 + R() * 220, y = 260 + R() * 50; return `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(4 + R() * 6)}" fill="url(#bg-goo)"/>`; }).join('')}`);

  // Neumann Matter: cubes copying themselves outward from a seed.
  { let cubes = ''; const cube = (x, y, s, a) => `<g transform="translate(${f1(x)},${f1(y)}) scale(${f1(s)})" opacity="${f1(a)}"><path d="M0,-12 L12,-6 L0,0 L-12,-6 Z" fill="#f4eaff"/><path d="M-12,-6 L0,0 L0,14 L-12,8 Z" fill="#b89ae8"/><path d="M12,-6 L0,0 L0,14 L12,8 Z" fill="#7a5ac8"/></g>`;
    for (let r = 0; r < 5; r++) for (let k = 0; k < 6 + r * 6; k++) { const a = (k / (6 + r * 6)) * Math.PI * 2 + r; cubes += cube(150 + Math.cos(a) * r * 26, 170 + Math.sin(a) * r * 26, 1.3 - r * 0.15, 1 - r * 0.16); }
    out('col_programmable_matter', `${glow('nm-g', '#e8d8ff', 0.8)}`, `<circle cx="150" cy="170" r="90" fill="url(#nm-g)"/>${cubes}${cube(150, 170, 2.2, 1)}`); }

  // Frankenstein Navigator: the face split down the middle, flesh on his right,
  // all machine on his left: the metal half takes the head's own outline.
  { const look = { style: 'slim', body: 'male', skin: '#c8d0a8', hair: '#1a1a1a', hairStyle: 'buzz', face: 'neutral', blush: false };
    const head = (id) => drawHead({ id, look, x: 150, y: 170, size: 230 });
    const ey = 170 + 0.02 * 230, mx = 150 + 0.15 * 230;
    out('col_security_system', `${linear('fn-plate', [['0%', '#f2f5f9'], ['55%', '#b8c0cc'], ['100%', '#5a6474']], 1, 0)}${glow('fn-eye', '#ff3a3a', 0.9)}
      <filter id="fn-w" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0"/></filter>
      <mask id="fn-m"><g filter="url(#fn-w)">${head('fnm')}</g></mask><clipPath id="fn-r"><rect x="150" y="0" width="150" height="${H}"/></clipPath>`,
      `${head('fn')}
       <g clip-path="url(#fn-r)"><rect width="${W}" height="${H}" fill="url(#fn-plate)" mask="url(#fn-m)"/>
         <g stroke="#7a8494" stroke-width="2" fill="none" opacity="0.8"><path d="M150,${f1(ey - 70)} Q210,${f1(ey - 60)} 254,${f1(ey - 30)}"/><path d="M150,${f1(ey + 58)} Q200,${f1(ey + 64)} 240,${f1(ey + 40)}"/></g>
         <circle cx="${f1(mx)}" cy="${f1(ey)}" r="30" fill="url(#fn-eye)"/><circle cx="${f1(mx)}" cy="${f1(ey)}" r="15" fill="#2a2e36"/><circle cx="${f1(mx)}" cy="${f1(ey)}" r="9" fill="#ff2020"/><circle cx="${f1(mx - 3)}" cy="${f1(ey - 3)}" r="2.5" fill="#fff"/>
         <g fill="#3a4250">${[0, 1, 2, 3].map((k) => `<rect x="${154 + k * 7}" y="${f1(ey + 52)}" width="4" height="12" rx="1.5"/>`).join('')}</g>
         <g fill="#5a6474">${[[200, ey - 92], [236, ey - 6], [214, ey + 86], [174, ey + 104]].map(([x, y]) => `<circle cx="${x}" cy="${f1(y)}" r="4"/>`).join('')}</g></g>
       <path d="M150,${f1(ey - 118)} V${f1(ey + 118)}" stroke="#2a2a2a" stroke-width="3"/>
       <g stroke="#2a2a2a" stroke-width="3">${[-90, -60, -30, 0, 30, 60, 90].map((d) => `<path d="M142,${f1(ey + d)} H150"/>`).join('')}</g>`); }

  // Josephson Implants: a bearded man with a crown of humming implants.
  out('col_siren_cybernautics_inc', `${glow('ji-g', '#9af0ff', 0.6)}`,
    `<circle cx="150" cy="132" r="120" fill="url(#ji-g)"/>${fig('ji', { body: 'male', skin: '#8a5a3a', hair: '#1e1612', hairStyle: 'bald', beard: 'full', face: 'smile', top: 'longsleeve', topColor: '#2a2a4a', bottomColor: '#1a1a2e', blush: false }, at(150, 572, 86))}
     ${[-0.95, -0.48, 0, 0.48, 0.95].map((a) => { const bx = 150 + Math.sin(a) * 38, by = 78 - Math.cos(a) * 42, x = 150 + Math.sin(a) * 56, y = 78 - Math.cos(a) * 60; return `<path d="M${f1(bx)},${f1(by)} L${f1(x)},${f1(y)}" stroke="#9af0ff" stroke-width="2.5" stroke-linecap="round"/><circle cx="${f1(x)}" cy="${f1(y)}" r="6" fill="#e8fcff" stroke="#3ab8d8" stroke-width="2"/>`; }).join('')}`);

  // Creeper Neogen: a curious vine creature with leaf-hands and eye-buds.
  out('col_smart_pets', `${linear('cn-v', [['0%', '#b8f08a'], ['100%', '#3a8a3a']], 1, 0)}${glow('cn-g', '#c8ff9a', 0.5)}`,
    `<circle cx="150" cy="160" r="130" fill="url(#cn-g)"/><path d="M60,330 C40,240 140,250 130,180 C120,110 200,110 210,70" stroke="url(#cn-v)" stroke-width="14" fill="none" stroke-linecap="round"/>
     <path d="M130,180 C170,190 220,170 250,200" stroke="url(#cn-v)" stroke-width="8" fill="none" stroke-linecap="round"/>
     ${[[90, 250, -30], [150, 210, 20], [180, 120, -40], [240, 196, 30], [110, 300, 40]].map(([x, y, a]) => `<path d="M0,0 Q14,-20 32,0 Q14,16 0,0 Z" fill="#7ad85a" transform="translate(${x},${y}) rotate(${a})"/>`).join('')}
     ${[[212, 66, 15], [254, 202, 10]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#f4fff0"/><circle cx="${x + 2}" cy="${y + 1}" r="${r * 0.55}" fill="#1a3a1a"/><circle cx="${x - 1}" cy="${y - 3}" r="${r * 0.2}" fill="#fff"/>`).join('')}`);

  // Kaluga Naniteers: a nanite swarm laying an orbital rail around a world.
  out('col_transorbital_railworkers', `${radial('kn-p', [['0%', '#d8c8ff'], ['60%', '#6a4ab8'], ['100%', '#1a0a4a']], '35%', '30%')}${glow('kn-g', '#ffe8a8', 0.8)}`,
    `<circle cx="150" cy="200" r="80" fill="url(#kn-p)"/><ellipse cx="150" cy="200" rx="130" ry="36" fill="none" stroke="#e8e0ff" stroke-width="7" stroke-dasharray="300 600" opacity="0.9"/>
     <ellipse cx="150" cy="200" rx="130" ry="36" fill="none" stroke="#e8e0ff" stroke-width="2" stroke-dasharray="4 8" opacity="0.5"/><path d="M50,212 A130,36 0 0 0 250,212" fill="none" stroke="#e8e0ff" stroke-width="7"/>
     <circle cx="262" cy="196" r="26" fill="url(#kn-g)"/>${Array.from({ length: 50 }, () => { const a = R() * Math.PI * 2, d = R() * 26; return `<circle cx="${f1(262 + Math.cos(a) * d)}" cy="${f1(196 + Math.sin(a) * d)}" r="1.6" fill="#fff4c8"/>`; }).join('')}`);

  // Eugenic Pilgrims: a hooded procession walking toward a star.
  out('col_vatican_observers', `${glow('ep-g', '#fff4c8', 0.95)}${sil('ep-s', [0.13, 0.08, 0.22])}`,
    `<circle cx="230" cy="70" r="70" fill="url(#ep-g)"/><circle cx="230" cy="70" r="8" fill="#fff"/><path d="M-10,330 L-10,300 Q150,262 310,250 L310,330 Z" fill="#2a1a4a" opacity="0.7"/>
     <g filter="url(#ep-s)">${[[40, 316, 40], [100, 304, 34], [152, 294, 28], [196, 284, 22]].map(([x, f, h], i) => fig(`ep${i}`, { body: i % 2 ? 'female' : 'male', hairStyle: 'bald', top: 'longsleeve' }, at(x, f, h, { upperL: -8, thighL: -10, shinL: 6, thighR: 8 }))).join('')}</g>
     <g fill="#2a1a4a">${[[40, 316, 40], [100, 304, 34], [152, 294, 28], [196, 284, 22]].map(([x, f, h]) => { const top = f - 6.4 * h; return `<path d="M${f1(x - h * 0.55)},${f1(top + h * 1.3)} Q${f1(x)},${f1(top - h * 0.2)} ${f1(x + h * 0.55)},${f1(top + h * 1.3)} L${f1(x + h * 0.7)},${f1(top + h * 3)} L${f1(x - h * 0.7)},${f1(top + h * 3)} Z"/>`; }).join('')}</g>`);

  // Grendel: the relay mesh grown into one beast, eyes lit, over the Earth.
  { const g = rng(31), pts = []; for (let i = 0; i < 46; i++) { const a = g() * Math.PI * 2, r = Math.sqrt(g()); pts.push([150 + Math.cos(a) * r * 110, 150 + Math.sin(a) * r * 90 - (Math.abs(Math.cos(a)) < 0.3 ? 20 : 0)]); }
    let net = ''; for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) { const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]); if (d < 40) net += `<line x1="${f1(pts[i][0])}" y1="${f1(pts[i][1])}" x2="${f1(pts[j][0])}" y2="${f1(pts[j][1])}"/>`; }
    out('col_beowulf_internet', `${radial('gr-e', [['0%', '#7ab8ff'], ['100%', '#0a2a6a']], '50%', '20%')}${glow('gr-g', '#ff5a8a', 0.9)}`,
      `<circle cx="150" cy="520" r="250" fill="url(#gr-e)"/><g stroke="#e8dcff" stroke-width="1.2" opacity="0.7">${net}</g>${pts.map(([x, y]) => `<circle cx="${f1(x)}" cy="${f1(y)}" r="3" fill="#f4eaff"/>`).join('')}
       <path d="M60,90 L80,50 L96,86 M240,90 L220,50 L204,86" stroke="#e8dcff" stroke-width="3" fill="none"/>
       ${[[118, 128], [182, 128]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="20" fill="url(#gr-g)"/><circle cx="${x}" cy="${y}" r="7" fill="#fff"/>`).join('')}
       <path d="M110,190 L130,178 L150,192 L170,178 L190,190" stroke="#ff8ab0" stroke-width="3" fill="none"/>`); }

  // Apex Algorithms: a crystal pyramid of thought with an open eye.
  out('col_self_designing_heuristics', `${linear('aa-l', [['0%', '#f4eaff'], ['100%', '#9a7ae8']], 1, 1)}${linear('aa-r', [['0%', '#8a6ad8'], ['100%', '#3a1a8a']], 1, 1)}${glow('aa-g', '#e8d8ff', 0.8)}`,
    `<circle cx="150" cy="170" r="130" fill="url(#aa-g)"/><path d="M150,50 L60,270 L150,250 Z" fill="url(#aa-l)"/><path d="M150,50 L240,270 L150,250 Z" fill="url(#aa-r)"/>
     <g stroke="#fff" stroke-width="1" opacity="0.4">${Array.from({ length: 6 }, (_, i) => `<path d="M${f1(150 - (i + 1) * 14)},${f1(50 + (i + 1) * 34)} L${f1(150 + (i + 1) * 14)},${f1(50 + (i + 1) * 34)}"/>`).join('')}</g>
     <path d="M118,150 Q150,124 182,150 Q150,176 118,150 Z" fill="#fff"/><circle cx="150" cy="150" r="12" fill="#3a1a8a"/><circle cx="146" cy="146" r="4" fill="#fff"/>
     <path d="M90,300 H210" stroke="#e8dcff" stroke-width="2" opacity="0.5"/>`);

  // Lernaean Warbots: a hydra of gun-necked robot heads on one chassis.
  out('col_combat_quadrupeds', `${linear('lw-b', [['0%', '#e8ecf2'], ['100%', '#6a7484']])}${glow('lw-e', '#ff3a3a', 0.9)}`,
    `<g stroke="#3a4250" stroke-width="10" fill="none" stroke-linecap="round">${[[90, 70], [150, 50], [210, 70], [60, 120], [240, 120]].map(([x, y]) => `<path d="M150,210 Q${f1((x + 150) / 2)},${f1(y + 70)} ${x},${y + 14}"/>`).join('')}</g>
     ${[[90, 70], [150, 50], [210, 70], [60, 120], [240, 120]].map(([x, y]) => `<g transform="translate(${x},${y})"><rect x="-20" y="-12" width="40" height="26" rx="8" fill="url(#lw-b)"/><rect x="-14" y="-4" width="28" height="9" rx="4" fill="#141821"/><circle cx="0" cy="0" r="8" fill="url(#lw-e)"/><circle cx="0" cy="0" r="3" fill="#fff"/></g>`).join('')}
     <rect x="88" y="196" width="124" height="44" rx="14" fill="url(#lw-b)"/>${[100, 130, 170, 200].map((x, i) => `<path d="M${x},234 L${x + (i < 2 ? -14 : 14)},272 L${x + (i < 2 ? -8 : 8)},306" stroke="#3a4250" stroke-width="8" fill="none" stroke-linecap="round"/>`).join('')}`);

  // Wisp: a feather of sail fanned behind a bright mote.
  out('col_sensor_web_sail', `${linear('wp-s', [['0%', '#ffffff', 0.9], ['100%', '#c8b8ff', 0]], 1, 1)}${glow('wp-g', '#ffffff', 1)}`,
    `${Array.from({ length: 22 }, (_, i) => `<path d="M220,90 Q${f1(140 - i * 4)},${f1(120 + i * 6)} ${f1(30 + i * 3)},${f1(200 + i * 6)}" stroke="#f4eaff" stroke-width="1.2" fill="none" opacity="${f1(0.15 + (i % 4) * 0.12)}"/>`).join('')}
     <path d="M220,90 Q120,130 40,230 Q130,190 220,90 Z" fill="url(#wp-s)"/><circle cx="220" cy="90" r="40" fill="url(#wp-g)"/><circle cx="220" cy="90" r="8" fill="#fff"/>`);

  // Offworld Replicators: a printer arm building a second arm, layer by layer.
  out('col_nano_3d_printers', `${linear('or-m', [['0%', '#f2f4f8'], ['100%', '#8a94a6']], 1, 0)}${linear('or-new', [['0%', '#ffd08a'], ['100%', '#ff8a3a']])}`,
    `<rect x="20" y="276" width="260" height="20" rx="6" fill="#3a2a5a"/><path d="M60,276 V200 L120,140 L170,160" stroke="url(#or-m)" stroke-width="18" fill="none" stroke-linejoin="round" stroke-linecap="round"/>
     <circle cx="60" cy="200" r="13" fill="#3a4250"/><circle cx="120" cy="140" r="13" fill="#3a4250"/><path d="M170,160 L184,186" stroke="#3a4250" stroke-width="7"/><circle cx="186" cy="190" r="6" fill="#ffe8a8"/>
     <path d="M186,196 L200,236" stroke="#ffe8a8" stroke-width="2" opacity="0.8"/>
     <g opacity="0.95"><rect x="214" y="246" width="30" height="30" rx="4" fill="url(#or-new)"/><rect x="222" y="236" width="14" height="10" fill="url(#or-new)"/>${[240, 244, 248, 252, 256, 260, 264, 268].map((y) => `<path d="M214,${y} H244" stroke="#fff" stroke-width="0.6" opacity="0.5"/>`).join('')}</g>`);

  // Sunburn League: sun-worshippers lounging by a sun that fills the sky.
  out('col_lava_lamp_evangelists', `${radial('sl-s', [['0%', '#fffbe0'], ['40%', '#ffd04a'], ['100%', '#ff6a2a', 0]], '50%', '50%', '50%')}`,
    `<circle cx="150" cy="70" r="140" fill="url(#sl-s)"/>${fig('sl', { body: 'male', skin: '#e8784a', hair: '#e8c060', hairStyle: 'curly', face: 'grin', top: 'tee', topColor: '#ff4a8a', bottom: 'shorts', bottomColor: '#2ab0c8', shoes: '#f4f4f4', hands: { L: 'thumb', R: 'open' } }, at(150, 326, 46, { upperL: -40, foreL: -100, upperR: 150, foreR: 10 }))}
     <g transform="translate(150,${f1(326 - 3.26 * 46 - 2.47 * 46)})"><rect x="-20" y="-4" width="17" height="9" rx="4" fill="#1a1a1a"/><rect x="3" y="-4" width="17" height="9" rx="4" fill="#1a1a1a"/><path d="M-3,0 H3" stroke="#1a1a1a" stroke-width="2"/></g>`);

  // Bubbleopolis: a city of glass domes, lit from within.
  out('col_gabonese_mining_consortium', `${radial('bb-d', [['0%', '#ffffff', 0.6], ['70%', '#9adcff', 0.25], ['100%', '#9adcff', 0.5]], '35%', '30%')}${linear('bb-gr', [['0%', '#3a2a5a'], ['100%', '#140a24']])}${glow('bb-l', '#ffd890', 0.8)}`,
    `<rect y="250" width="${W}" height="80" fill="url(#bb-gr)"/>${[[150, 250, 90], [60, 252, 52], [244, 252, 56], [110, 254, 34], [196, 254, 30]].map(([x, y, r]) => `<ellipse cx="${x}" cy="${y - r * 0.3}" rx="${r * 0.8}" ry="${r * 0.5}" fill="url(#bb-l)"/>
       ${Array.from({ length: Math.round(r / 12) }, (_, i) => `<rect x="${f1(x - r * 0.6 + i * 14)}" y="${f1(y - 10 - (i % 3) * 12)}" width="10" height="${f1(10 + (i % 3) * 12)}" fill="#e8dcff" opacity="0.8"/>`).join('')}
       <path d="M${x - r},${y} A${r},${r} 0 0 1 ${x + r},${y} Z" fill="url(#bb-d)" stroke="#e8f6ff" stroke-width="2"/><path d="M${f1(x - r * 0.6)},${f1(y - r * 0.6)} Q${f1(x - r * 0.3)},${f1(y - r * 0.9)} ${x},${f1(y - r * 0.95)}" stroke="#fff" stroke-width="3" fill="none" opacity="0.7"/>`).join('')}`);

  // Transplaneteers: a spacer at home in free fall, hands and feet both gripping.
  out('col_prehensilists', `${radial('tp-p', [['0%', '#ffd8a8'], ['100%', '#a85a2a']], '35%', '30%')}`,
    `<circle cx="250" cy="270" r="90" fill="url(#tp-p)"/><path d="M20,60 H280" stroke="#d8d0e8" stroke-width="8" stroke-linecap="round"/>
     ${fig('tp', { body: 'female', skin: '#c8906a', hair: '#2a1a12', hairStyle: 'bun', face: 'grin', top: 'jumpsuit', topColor: '#f2f0f8', hands: { L: 'hold', R: 'open' } }, { root: [150, 150], scale: 40, rot: { root: 200, upperL: 10, foreL: 4, upperR: -60, foreR: -30, thighL: -40, shinL: 90, thighR: 30, shinR: -70 } })}`);

  // Space Jockeys: a rider astride a rocket, hat in hand.
  { const sk = skeleton('male'); let p = at(150, 238, 40, { thighL: -70, shinL: 80, thighR: 70, shinR: -80, upperR: 140, foreR: 20 });
    out('col_exoskeletalists', `${linear('sj-r', [['0%', '#ffffff'], ['100%', '#a8b0c0']])}${radial('sj-f', [['0%', '#fff4c8'], ['60%', '#ff9a3a'], ['100%', '#ff4a2a', 0]], '50%', '50%', '50%')}`,
      `<ellipse cx="30" cy="250" rx="60" ry="22" fill="url(#sj-f)"/><path d="M60,232 L250,232 Q290,250 250,268 L60,268 Z" fill="url(#sj-r)"/><path d="M60,232 L40,214 L90,232 Z M60,268 L40,286 L90,268 Z" fill="#c8202e"/><circle cx="220" cy="250" r="8" fill="#5ab0ff" stroke="#3a4250" stroke-width="2"/>
       ${fig('sj', { body: 'male', skin: '#a87050', hair: '#1a1414', hairStyle: 'tuft', face: 'shout', top: 'jacket', topColor: '#c8862a', collar: '#f0e0c8', bottomColor: '#3a4a6a', shoes: '#5a3a1a', hands: { L: 'fist', R: 'open' } }, p)}
       <g transform="translate(${f1(fk(sk, p).joints.tipR[0])},${f1(fk(sk, p).joints.tipR[1] - 6)})"><ellipse rx="22" ry="6" fill="#7a4a1a"/><path d="M-12,0 Q-10,-18 0,-18 Q10,-18 12,0 Z" fill="#8a5a2a"/></g>`); }

  // Drone Queen: her mind steering a crown of drones.
  out('col_teleoperators', `${glow('dq-g', '#9af0ff', 0.6)}`,
    `<circle cx="150" cy="170" r="120" fill="url(#dq-g)"/>${drawHead({ id: 'dq', look: { body: 'female', skin: '#c88a6a', hair: '#1a1210', hairStyle: 'bun', face: 'sleepy' }, x: 150, y: 200, size: 170 })}
     ${Array.from({ length: 7 }, (_, i) => { const a = Math.PI + (i / 6) * Math.PI, x = 150 + Math.cos(a) * 120, y = 140 + Math.sin(a) * 100; return `<path d="M150,${110} L${f1(x)},${f1(y)}" stroke="#9af0ff" stroke-width="1.2" stroke-dasharray="3 3"/><g transform="translate(${f1(x)},${f1(y)})"><rect x="-10" y="-4" width="20" height="8" rx="3" fill="#e8ecf2"/><path d="M-16,-6 H-4 M4,-6 H16" stroke="#3a4250" stroke-width="2"/><circle r="2.4" fill="#ff4a6a"/></g>`; }).join('')}`);

  // Shipbrain: a sleeping pilot wired into the ship she has become.
  out('col_neural_pilots', `${linear('sb-h', [['0%', '#f2f4f8'], ['100%', '#7a8494']])}${glow('sb-g', '#9af0ff', 0.7)}`,
    `<path d="M300,60 L120,120 L40,170 L120,220 L300,280 Z" fill="url(#sb-h)" opacity="0.95"/><path d="M300,120 L200,140 L200,200 L300,220 Z" fill="#3a4250" opacity="0.3"/>
     <circle cx="120" cy="170" r="70" fill="url(#sb-g)"/>${drawHead({ id: 'sb', look: { body: 'female', skin: '#e0b090', hair: '#e8e0d0', hairStyle: 'buzz', face: 'sleepy', blush: false }, x: 120, y: 170, size: 120 })}
     ${[150, 165, 180].map((y, i) => `<path d="M${150 + i * 2},${y} C200,${y} 220,${y - 20 + i * 20} 290,${y - 30 + i * 30}" stroke="#9af0ff" stroke-width="2.5" fill="none"/>`).join('')}`);

  // Jarhead Insurgents: a helmeted trooper behind a targeting display.
  out('col_transhuman_activists', `${glow('jh-g', '#ff6a5a', 0.5)}`,
    `${fig('jh', { ...ROBOT_LOOK, topColor: '#5a6a5a', bottomColor: '#2a302a', collar: '#ff6a3a', hands: { L: 'fist', R: 'fist' } }, at(150, 326, 46, { upperL: -30, foreL: 110, upperR: 20, foreR: -90 }))}
     <path d="M84,192 L216,170" stroke="#2a2a2a" stroke-width="8" stroke-linecap="round"/><path d="M196,174 L230,168" stroke="#2a2a2a" stroke-width="4"/>
     <g transform="translate(232,74)" stroke="#ff8a6a" stroke-width="2" fill="none"><circle r="26"/><circle r="10"/><path d="M-36,0 H-16 M16,0 H36 M0,-36 V-16 M0,16 V36"/></g><circle cx="232" cy="74" r="40" fill="url(#jh-g)"/>`);

  // Death Insurers: identical clones on the shelf, the policy pinned below.
  out('col_clone_entrepreneurs', `${linear('di-pod', [['0%', '#ffffff', 0.35], ['100%', '#c8f0ff', 0.12]])}`,
    `${[60, 150, 240].map((x, i) => `<rect x="${x - 34}" y="40" width="68" height="240" rx="30" fill="#1a3a4a" opacity="0.5"/>${fig(`di${i}`, { body: 'male', skin: '#e8c0a0', hair: '#c8a060', hairStyle: 'tuft', face: 'sleepy', top: 'jumpsuit', topColor: '#e8f4f8', blush: false }, at(x, 270, 33))}<rect x="${x - 34}" y="40" width="68" height="240" rx="30" fill="url(#di-pod)" stroke="#d8f4ff" stroke-width="2"/>`).join('')}
     <g transform="translate(150,300) rotate(-3)"><rect x="-60" y="-16" width="120" height="32" rx="3" fill="#f4f0e4"/><path d="M-48,-6 H30 M-48,2 H40 M-48,10 H10" stroke="#8a8478" stroke-width="2"/><circle cx="44" cy="6" r="8" fill="#c8202e"/></g>`);
}
