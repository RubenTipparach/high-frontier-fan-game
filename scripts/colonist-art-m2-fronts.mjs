// M2 colonist FRONT art, second pass (owner 2026-11-20: "Update existing
// colonist art too?"). Same subjects as the first pass in gen-colonist-art.mjs,
// redrawn with the shared shading kit (colonist-art-m4-fronts.mjs#artKit) so the
// M2 and M4 decks read as one family. Pure string builders.
import { artKit } from './colonist-art-m4-fronts.mjs';

export const REDONE_M2_FRONTS = new Set([
  'col_babbage_halbonauts', 'col_biomechs', 'col_botany_bay_convicts', 'col_boyle_engineering_collective',
  'col_calypso_2_seed_sail', 'col_heavy_water_survivalists', 'col_house_of_saud', 'col_juiced_cosmonauts',
  'col_lloyd_s_salvage_co', 'col_malcolm', 'col_microgravity_pantrophists', 'col_programmable_matter',
  'col_rock_rats_miners_union', 'col_security_system', 'col_siren_cybernautics_inc', 'col_smart_pets',
  'col_transorbital_railworkers', 'col_vatican_observers',
]);

export function drawM2Fronts({ W, H, panel, emit }) {
  const { f1, rect, radial, linear, vignette, stars, rng, bust, robotBust, earth, night } = artKit({ W, H });
  const glow = (id, sd = 3) => `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${sd}"/></filter>`;

  // 1. Babbage Halbonauts: a humanoid built from stacked cube modules, green-lit.
  {
    const cube = (x, y, k = 1, lit = true) => `<g transform="translate(${x},${y}) scale(${k})">
      <path d="M0,-14 L16,-6 L0,2 L-16,-6 Z" fill="#d8dee6"/><path d="M-16,-6 L0,2 L0,20 L-16,12 Z" fill="#8a96a4"/><path d="M16,-6 L0,2 L0,20 L16,12 Z" fill="#5a6474"/>
      ${lit ? '<path d="M3,6 L12,1.5 L12,11 L3,15.5 Z" fill="#6aff9a" opacity="0.9"/>' : ''}</g>`;
    // a clear humanoid: head, 2-wide torso, arms, legs (iso cubes, 32 wide, rows 18 apart)
    const parts = [[150, 64, 1.25], [134, 106], [166, 106], [134, 124], [166, 124], [102, 112], [198, 112], [94, 136], [206, 136], [134, 142], [166, 142], [138, 178], [162, 178], [134, 200], [166, 200], [130, 222], [170, 222], [126, 244], [174, 244]];
    emit('col_babbage_halbonauts', 'front', panel({
      defs: `${radial('bh2-bg', [['0%', '#1e3a2e'], ['100%', '#030806']])}${radial('bh2-g', [['0%', '#6aff9a', 0.35], ['100%', '#6aff9a', 0]])}${vignette('bh2-v')}`,
      inner: `${rect('url(#bh2-bg)')}${stars(30, 21)}<ellipse cx="150" cy="170" rx="110" ry="130" fill="url(#bh2-g)"/>
        <ellipse cx="150" cy="292" rx="70" ry="8" fill="#000" opacity="0.45"/>${parts.map(([x, y, k = 1], i) => cube(x, y, k, i % 3 !== 2)).join('')}
        ${rect('url(#bh2-v)')}`,
    }));
  }
  // 2. Biomechs: a biomechatronic arm reaching up, lit joints, circuit traces.
  {
    const finger = (x, ang, len) => `<g transform="translate(${x},140) rotate(${ang})">${[0, 1, 2].map((i) => `<rect x="-6" y="${-i * (len / 3) - len / 3}" width="12" height="${len / 3 - 2}" rx="5" fill="url(#bm-metal)"/><circle cx="0" cy="${-i * (len / 3) - 1}" r="3.2" fill="#7fe0ff"/>`).join('')}</g>`;
    emit('col_biomechs', 'front', panel({
      defs: `${radial('bm-bg', [['0%', '#16304a'], ['100%', '#02060c']])}${linear('bm-metal', [['0%', '#e8f2ff'], ['50%', '#7aa8d8'], ['100%', '#2a4a7a']], 1, 0)}${vignette('bm-v')}${glow('bm-gl', 2.5)}`,
      inner: `${rect('url(#bm-bg)')}<g stroke="#3a7aa8" stroke-width="1.5" fill="none" opacity="0.6">${[90, 130, 170, 210].map((y, i) => `<path d="M0,${y} H${50 + i * 8} L${70 + i * 8},${y - 12}"/><path d="M300,${y + 10} H${250 - i * 8} L${230 - i * 8},${y - 2}"/>`).join('')}</g>
        <path d="M118,330 L124,190 Q126,172 150,170 Q174,172 176,190 L182,330 Z" fill="url(#bm-metal)"/>
        ${[214, 250, 286].map((y) => `<rect x="120" y="${y}" width="60" height="5" fill="#1a3a5a" opacity="0.6"/>`).join('')}
        <rect x="138" y="232" width="24" height="14" rx="3" fill="#0a1a2a"/><rect x="142" y="236" width="16" height="6" fill="#7fe0ff" filter="url(#bm-gl)"/><rect x="142" y="236" width="16" height="6" fill="#bff4ff"/>
        <ellipse cx="150" cy="180" rx="30" ry="10" fill="#1a3a5a"/><circle cx="150" cy="180" r="9" fill="#7fe0ff" filter="url(#bm-gl)"/><circle cx="150" cy="180" r="5" fill="#dff8ff"/>
        <path d="M118,176 Q114,146 126,134 L176,134 Q188,146 182,176 Z" fill="url(#bm-metal)"/>
        ${finger(124, -18, 66)}${finger(140, -6, 80)}${finger(156, 4, 84)}${finger(172, 14, 74)}
        <g transform="translate(118,166) rotate(-62)">${[0, 1].map((i) => `<rect x="-6" y="${-i * 22 - 22}" width="12" height="20" rx="5" fill="url(#bm-metal)"/><circle cx="0" cy="${-i * 22 - 1}" r="3.2" fill="#7fe0ff"/>`).join('')}</g>
        ${rect('url(#bm-v)')}`,
    }));
  }
  // 3. Botany Bay Convicts: a convict in prison stripes, hard-faced.
  {
    const b = bust({ id: 'bb', cx: 150, cy: 128, r: 40, skin: ['#e0b090', '#9a6a4c'], hair: '#2a1a10', hairHi: '#4a3020', style: 'buzz', shirt: ['#f2f2f2', '#9a9a9a'], shirtFill: 'url(#bb-stripe)', collar: 'round', eyes: '#4a6a3a', rim: '#ffd8a0' });
    emit('col_botany_bay_convicts', 'front', panel({
      defs: `${radial('bb-bg', [['0%', '#4a3a2a'], ['100%', '#0a0806']], '50%', '35%')}<pattern id="bb-stripe" width="20" height="22" patternUnits="userSpaceOnUse"><rect width="20" height="22" fill="#eceae4"/><rect width="20" height="11" fill="#1e1e22"/></pattern>${vignette('bb-v')}${b.defs}`,
      inner: `${rect('url(#bb-bg)')}<g stroke="#1a140e" stroke-width="7" opacity="0.7">${[30, 70, 230, 270].map((x) => `<line x1="${x}" y1="0" x2="${x}" y2="${H}"/>`).join('')}</g>
        <rect x="0" y="0" width="${W}" height="${H}" fill="#ffd8a0" opacity="0.06"/>${b.svg}
        <rect x="118" y="236" width="64" height="20" rx="3" fill="#e8e0c8"/><text x="150" y="251" text-anchor="middle" font-family="monospace" font-size="13" font-weight="700" fill="#1a1a1a">BB-2189</text>${rect('url(#bb-v)')}`,
    }));
  }
  // 4. Boyle Engineering Collective: a glowing atom in a field of flux arrows.
  {
    let arrows = '';
    for (let r = 0; r < 5; r++) for (let c = 0; c < 2; c++) { const x = 30 + c * 34, y = 60 + r * 44, up = (r + c) % 2 === 0; arrows += `<path d="M${x},${up ? y + 16 : y - 16} L${x},${up ? y - 12 : y + 12} M${x - 6},${up ? y - 4 : y + 4} L${x},${up ? y - 14 : y + 14} L${x + 6},${up ? y - 4 : y + 4}" stroke="#ffd27a" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`; }
    emit('col_boyle_engineering_collective', 'front', panel({
      defs: `${radial('be-bg', [['0%', '#2a2440'], ['100%', '#05040a']], '62%', '45%')}${radial('be-core', [['0%', '#ffffff'], ['40%', '#9fe8ff'], ['100%', '#2a8ad0', 0]])}${vignette('be-v')}${glow('be-gl', 3)}`,
      inner: `${rect('url(#be-bg)')}${stars(40, 22)}<g opacity="0.85">${arrows}</g>
        <g transform="translate(190,160)"><circle r="70" fill="url(#be-core)" opacity="0.5"/>
        ${[0, 60, 120].map((a) => `<ellipse rx="82" ry="26" transform="rotate(${a})" fill="none" stroke="#7fd0ff" stroke-width="5" opacity="0.35" filter="url(#be-gl)"/><ellipse rx="82" ry="26" transform="rotate(${a})" fill="none" stroke="#dff4ff" stroke-width="1.6"/>`).join('')}
        ${[[82, 0, 0], [-41, 22, 60], [20, -25, 120]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="6" fill="#ffd27a"/>`).join('')}
        <circle r="16" fill="url(#be-core)"/></g>${rect('url(#be-v)')}`,
    }));
  }
  // 5. Calypso 2 Seed Sail: a green crystal seed sail scattering spores.
  {
    const g = rng(25);
    emit('col_calypso_2_seed_sail', 'front', panel({
      defs: `${radial('cs-bg', [['0%', '#0e3a2a'], ['100%', '#020806']])}${linear('cs-l', [['0%', '#c8ffe0'], ['100%', '#2ab070']], 1, 1)}${linear('cs-r', [['0%', '#4ad890'], ['100%', '#0a5a34']], 1, 1)}${radial('cs-g', [['0%', '#6affb0', 0.5], ['100%', '#6affb0', 0]])}${vignette('cs-v')}`,
      inner: `${rect('url(#cs-bg)')}${stars(70, 23)}<circle cx="150" cy="150" r="120" fill="url(#cs-g)"/>
        <path d="M150,48 L222,150 L150,252 Z" fill="url(#cs-r)"/><path d="M150,48 L78,150 L150,252 Z" fill="url(#cs-l)"/>
        <path d="M150,48 L150,252 M78,150 L222,150" stroke="#eafff2" stroke-width="1.5" opacity="0.7"/>
        <ellipse cx="150" cy="150" rx="18" ry="30" fill="#0a3a24" stroke="#c8ffe0" stroke-width="2"/>
        ${Array.from({ length: 24 }, () => { const x = 40 + g() * 220, y = 30 + g() * 260; return `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(1 + g() * 2.2)}" fill="#bfffd8" opacity="${(0.4 + g() * 0.5).toFixed(2)}"/>`; }).join('')}${rect('url(#cs-v)')}`,
    }));
  }
  // 6. Heavy Water Survivalists: a defiant survivalist between two cryo pods.
  {
    const b = bust({ id: 'hw', cx: 150, cy: 120, r: 36, skin: ['#e8c0a0', '#a87a5a'], hair: '#6a4a2a', hairHi: '#8a6a40', style: 'short', shirt: ['#f4f2ec', '#b8b2a4'], collar: 'round', eyes: '#3a5a7a', rim: '#9ff0ff',
      extra: `<g transform="translate(150,236)"><path d="M-14,-16 Q-26,-4 -10,4 Q10,10 4,22 Q-2,30 -12,26" stroke="#2a3a2a" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="-12" cy="-16" r="5" fill="#2a3a2a"/><text x="0" y="44" text-anchor="middle" font-family="serif" font-size="9" fill="#2a2a2a">DON'T TREAD</text></g>` });
    const pod = (x) => `<rect x="${x - 26}" y="40" width="52" height="250" rx="26" fill="url(#hw-pod)"/><rect x="${x - 16}" y="62" width="32" height="200" rx="16" fill="url(#hw-glass)"/><path d="M${x - 8},74 Q${x - 12},160 ${x - 8},246" stroke="#fff" stroke-width="3" opacity="0.5" fill="none"/>`;
    emit('col_heavy_water_survivalists', 'front', panel({
      defs: `${radial('hw-bg', [['0%', '#2a3e4a'], ['100%', '#05090c']])}${linear('hw-pod', [['0%', '#f2f6f8'], ['100%', '#8a98a4']], 1, 0)}${linear('hw-glass', [['0%', '#bff4ff'], ['100%', '#4aa8c8']])}${vignette('hw-v')}${b.defs}`,
      inner: `${rect('url(#hw-bg)')}${pod(42)}${pod(258)}${b.svg}${rect('url(#hw-v)')}`,
    }));
  }
  // 7. House of Saud: a young dynast, head bowed in prayer, in a halo of gold.
  {
    const b = bust({ id: 'hs', cx: 150, cy: 132, r: 38, skin: ['#d8a87a', '#8a5a3a'], hair: '#1a1008', style: 'bald', shirt: ['#b8a060', '#5a4a20'], collar: 'v', eyesClosed: true, rim: '#ffe0a0',
      extra: `<path fill-rule="evenodd" d="M104,140 Q102,82 150,80 Q198,82 196,140 L208,216 Q184,204 172,178 L128,178 Q116,204 92,216 Z M150,96 Q118,98 117,130 Q117,160 133,172 Q150,180 167,172 Q183,160 183,130 Q182,98 150,96 Z" fill="url(#hs-cloth)"/>
        <ellipse cx="150" cy="92" rx="44" ry="10" fill="none" stroke="#141414" stroke-width="6"/><ellipse cx="150" cy="99" rx="44" ry="10" fill="none" stroke="#141414" stroke-width="5"/>
        <path d="M120,250 L150,284 L180,250" stroke="#e8c870" stroke-width="2" fill="none"/><circle cx="150" cy="262" r="7" fill="#e8c870"/>` });
    emit('col_house_of_saud', 'front', panel({
      defs: `${radial('hs-bg', [['0%', '#ffe2a0'], ['35%', '#c89a40'], ['100%', '#2a1c08']], '50%', '30%')}${linear('hs-cloth', [['0%', '#ffffff'], ['100%', '#d0c8b8']])}${vignette('hs-v')}${b.defs}`,
      inner: `${rect('url(#hs-bg)')}<g stroke="#fff4c8" stroke-width="2" opacity="0.25">${Array.from({ length: 18 }, (_, i) => { const a = (i / 18) * Math.PI * 2; return `<line x1="150" y1="100" x2="${f1(150 + Math.cos(a) * 220)}" y2="${f1(100 + Math.sin(a) * 220)}"/>`; }).join('')}</g>${b.svg}${rect('url(#hs-v)')}`,
    }));
  }
  // 8. Juiced Cosmonauts: a propaganda-poster cosmonaut, fist raised, red sunburst.
  {
    const b = bust({ id: 'jc', cx: 132, cy: 138, r: 34, skin: ['#f0c8a0', '#b07850'], hair: '#3a2010', style: 'short', shirt: ['#ffffff', '#c8ccd2'], collar: 'round', smile: true, rim: '#ffd060', turn: 0.3,
      extra: `<path d="M88,128 Q86,76 132,72 Q178,76 176,128 L170,132 Q168,92 132,90 Q96,92 94,132 Z" fill="#f2f2f2" stroke="#9aa0aa" stroke-width="2"/>
        <path d="M120,80 L132,62 L144,80 Z" fill="#e8202a"/><text x="132" y="86" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="12" fill="#e8202a">CCCP</text>
        <path d="M178,236 L214,150 L236,78" stroke="url(#jc-sh)" stroke-width="22" fill="none" stroke-linecap="round"/><circle cx="238" cy="70" r="14" fill="#e0b48a"/>
        <path d="M236,58 L236,30 M226,40 Q238,24 250,40" stroke="#ffd060" stroke-width="5" fill="none" stroke-linecap="round"/>` });
    emit('col_juiced_cosmonauts', 'front', panel({
      defs: `${radial('jc-bg', [['0%', '#ff5a40'], ['100%', '#7a0a0a']], '50%', '40%')}${vignette('jc-v')}${b.defs}`,
      inner: `${rect('url(#jc-bg)')}<g fill="#ff8a5a" opacity="0.35">${Array.from({ length: 12 }, (_, i) => { const a0 = (i / 12) * Math.PI * 2, a1 = a0 + Math.PI / 24; return `<path d="M150,150 L${f1(150 + Math.cos(a0) * 300)},${f1(150 + Math.sin(a0) * 300)} L${f1(150 + Math.cos(a1) * 300)},${f1(150 + Math.sin(a1) * 300)} Z"/>`; }).join('')}</g>
        <path d="M244,250 L262,272 L280,250 L262,232 Z" fill="#ffd060" opacity="0.8"/>${b.svg}${rect('url(#jc-v)')}`,
    }));
  }
  // 9. Lloyd's Salvage Co.: two traders closing a deal over a hologram.
  {
    const a = bust({ id: 'ls1', cx: 66, cy: 150, r: 30, skin: ['#e8c4a4', '#a87a5a'], hair: '#5a3a1a', style: 'short', shirt: ['#3a4250', '#14181e'], collar: 'v', turn: 0.6, rim: '#9fffe0' });
    const c = bust({ id: 'ls2', cx: 234, cy: 146, r: 30, skin: ['#8a5a3c', '#4a2a18'], hair: '#140c08', style: 'buzz', shirt: ['#5a4a3a', '#1e1810'], collar: 'v', turn: -0.6, rim: '#9fffe0' });
    emit('col_lloyd_s_salvage_co', 'front', panel({
      defs: `${radial('ls-bg', [['0%', '#1e3a3a'], ['100%', '#040a0a']])}${radial('ls-h', [['0%', '#7fffe0', 0.4], ['100%', '#7fffe0', 0]])}${vignette('ls-v')}${a.defs}${c.defs}${glow('ls-gl', 2)}`,
      inner: `${rect('url(#ls-bg)')}<ellipse cx="150" cy="130" rx="60" ry="64" fill="url(#ls-h)"/>
        <g transform="translate(150,124)" stroke="#9fffe0" fill="none" stroke-width="2"><rect x="-38" y="-30" width="76" height="60" rx="6" fill="#7fffe0" fill-opacity="0.1"/>
        <text x="-22" y="-4" fill="#bfffe8" stroke="none" font-family="sans-serif" font-weight="700" font-size="20">¥</text><rect x="4" y="-20" width="22" height="18" rx="4"/><circle cx="11" cy="-11" r="2" fill="#9fffe0"/><circle cx="19" cy="-11" r="2" fill="#9fffe0"/>
        <path d="M-24,12 H24 M18,7 L24,12 L18,17 M24,22 H-24 M-18,17 L-24,22 L-18,27"/></g>
        <ellipse cx="150" cy="210" rx="40" ry="6" fill="#7fffe0" opacity="0.4"/>${a.svg}${c.svg}${rect('url(#ls-v)')}`,
    }));
  }
  // 10. Malcolm: a young man, chin in hand, lit by a bright window.
  {
    const b = bust({ id: 'ml', cx: 132, cy: 132, r: 38, skin: ['#e8c4a0', '#9a6a48'], hair: '#2a1a10', hairHi: '#4a3020', style: 'short', shirt: ['#3a3a44', '#14141a'], collar: 'round', eyes: '#4a3a2a', turn: 0.5, rim: '#eaf4ff',
      extra: `<path d="M110,330 Q104,250 124,206 L152,196 Q140,250 146,330 Z" fill="url(#ml-sh)"/><ellipse cx="150" cy="186" rx="16" ry="12" fill="#c8946a"/>` });
    emit('col_malcolm', 'front', panel({
      defs: `${linear('ml-bg', [['0%', '#1a1e28'], ['100%', '#3a4458']], 1, 0)}${linear('ml-win', [['0%', '#ffffff'], ['100%', '#bcd4ec']])}${linear('ml-ray', [['0%', '#fff', 0.35], ['100%', '#fff', 0]], -1, 0)}${vignette('ml-v')}${b.defs}`,
      inner: `${rect('url(#ml-bg)')}<rect x="200" y="30" width="78" height="200" fill="url(#ml-win)"/><path d="M239,30 V230 M200,130 H278" stroke="#5a6478" stroke-width="5"/>
        <path d="M200,30 L60,90 L60,330 L200,230 Z" fill="url(#ml-ray)"/>${b.svg}${rect('url(#ml-v)')}`,
    }));
  }
  // 11. Microgravity Pantrophists: a glossy cell, organelles floating in it.
  {
    const g = rng(31);
    emit('col_microgravity_pantrophists', 'front', panel({
      defs: `${radial('mp-bg', [['0%', '#0e2a3a'], ['100%', '#02070c']])}${radial('mp-cell', [['0%', '#dff4ff', 0.9], ['70%', '#8ac8e0', 0.6], ['100%', '#2a8a7a', 0.8]], '40%', '35%')}${radial('mp-nuc', [['0%', '#ffd0b0'], ['100%', '#b0503a']], '40%', '35%')}${vignette('mp-v')}`,
      inner: `${rect('url(#mp-bg)')}${stars(40, 31)}<circle cx="150" cy="156" r="112" fill="url(#mp-cell)" stroke="#5ad8a0" stroke-width="8"/>
        <circle cx="150" cy="156" r="112" fill="none" stroke="#bfffe0" stroke-width="2" opacity="0.7"/>
        ${Array.from({ length: 6 }, (_, i) => { const a = i * 1.1, x = 150 + Math.cos(a) * 64, y = 156 + Math.sin(a) * 56; return `<ellipse cx="${f1(x)}" cy="${f1(y)}" rx="16" ry="8" transform="rotate(${f1(a * 57)} ${f1(x)} ${f1(y)})" fill="#e88a6a" stroke="#a04a3a" stroke-width="1.5"/>`; }).join('')}
        ${Array.from({ length: 14 }, () => `<circle cx="${f1(80 + g() * 140)}" cy="${f1(90 + g() * 130)}" r="${f1(2 + g() * 3)}" fill="#4a7ad0" opacity="0.7"/>`).join('')}
        <circle cx="140" cy="146" r="34" fill="url(#mp-nuc)"/><circle cx="132" cy="138" r="9" fill="#7a2a1a" opacity="0.6"/>
        <path d="M84,96 Q110,72 150,68" stroke="#fff" stroke-width="6" opacity="0.4" fill="none" stroke-linecap="round"/>${rect('url(#mp-v)')}`,
    }));
  }
  // 12. Programmable Matter: a liquid-white droplet shaped by magnetic fields.
  {
    emit('col_programmable_matter', 'front', panel({
      defs: `${radial('pm-bg', [['0%', '#1a2440'], ['100%', '#02040a']])}${radial('pm-blob', [['0%', '#ffffff'], ['60%', '#d0dcec'], ['100%', '#7a8aa4']], '38%', '30%')}${vignette('pm-v')}${glow('pm-gl', 2.5)}`,
      inner: `${rect('url(#pm-bg)')}${stars(50, 32)}
        <g fill="none" stroke-linecap="round">${[40, 70, 100].map((d, i) => `<path d="M10,${150 - d} Q150,${150 - d * 0.2} 290,${150 - d}" stroke="#4aa8ff" stroke-width="4" opacity="0.3" filter="url(#pm-gl)"/><path d="M10,${150 - d} Q150,${150 - d * 0.2} 290,${150 - d}" stroke="#9fd8ff" stroke-width="1.6" stroke-dasharray="${8 + i * 2} 6"/><path d="M10,${150 + d} Q150,${150 + d * 0.2} 290,${150 + d}" stroke="#4aa8ff" stroke-width="4" opacity="0.3" filter="url(#pm-gl)"/><path d="M10,${150 + d} Q150,${150 + d * 0.2} 290,${150 + d}" stroke="#9fd8ff" stroke-width="1.6" stroke-dasharray="${8 + i * 2} 6"/>`).join('')}</g>
        <path d="M70,150 Q90,104 150,108 Q214,104 234,150 Q214,196 150,192 Q90,196 70,150 Z" fill="url(#pm-blob)"/>
        <path d="M98,132 Q130,112 176,118" stroke="#fff" stroke-width="7" opacity="0.7" fill="none" stroke-linecap="round"/>
        <circle cx="244" cy="128" r="9" fill="url(#pm-blob)"/><circle cx="58" cy="170" r="6" fill="url(#pm-blob)"/>${rect('url(#pm-v)')}`,
    }));
  }
  // 13. Rock Rats Miners' Union: a grinning miner in a lamp helmet with her cobot.
  {
    const w = bust({ id: 'rr', cx: 104, cy: 140, r: 34, skin: ['#8a5a3c', '#4a2a18'], hair: '#140c08', style: 'buzz', female: true, shirt: ['#e8902a', '#9a4a10'], collar: 'round', smile: true, lips: '#7a3a3a', rim: '#ffe0a0',
      extra: `<path d="M64,122 Q62,82 104,80 Q146,82 144,122 Z" fill="url(#rr-hat)"/><rect x="60" y="118" width="88" height="8" rx="4" fill="#c87a10"/><circle cx="104" cy="98" r="9" fill="#fff8d8"/><circle cx="104" cy="98" r="5" fill="#ffffff"/>
        <path d="M96,96 L20,40 L20,150 Z" fill="#fff8d8" opacity="0.18"/><circle cx="84" cy="236" r="10" fill="#2a4a8a" stroke="#fff" stroke-width="2"/><path d="M79,236 L89,236 M84,231 L84,241" stroke="#fff" stroke-width="2"/>` });
    const r = robotBust({ id: 'rrb', cx: 216, cy: 132, s: 0.85 });
    emit('col_rock_rats_miners_union', 'front', panel({
      defs: `${radial('rr-bg', [['0%', '#4a3a2a'], ['100%', '#0c0806']], '50%', '40%')}${linear('rr-hat', [['0%', '#ffd060'], ['100%', '#c88a10']])}${vignette('rr-v')}${w.defs}${r.defs}`,
      inner: `${rect('url(#rr-bg)')}<path d="M0,250 L60,220 L120,240 L200,214 L300,236 L300,${H} L0,${H} Z" fill="#2a1e14"/>${r.svg}${w.svg}${rect('url(#rr-v)')}`,
    }));
  }
  // 14. Security System: an unblinking red sentry lens.
  {
    emit('col_security_system', 'front', panel({
      defs: `${radial('ss-bg', [['0%', '#1a0a0a'], ['100%', '#020000']])}${radial('ss-bezel', [['0%', '#5a5e66'], ['80%', '#1a1c20'], ['100%', '#000']], '40%', '30%')}${radial('ss-lens', [['0%', '#ffd0c0'], ['15%', '#ff3a2a'], ['55%', '#8a0a0a'], ['100%', '#1a0000']])}${radial('ss-halo', [['0%', '#ff2a1a', 0.45], ['100%', '#ff2a1a', 0]])}${vignette('ss-v')}`,
      inner: `${rect('url(#ss-bg)')}<circle cx="150" cy="156" r="140" fill="url(#ss-halo)"/>
        <circle cx="150" cy="156" r="92" fill="url(#ss-bezel)"/><circle cx="150" cy="156" r="78" fill="#050505"/>
        <circle cx="150" cy="156" r="62" fill="url(#ss-lens)"/>
        ${[70, 54].map((r) => `<circle cx="150" cy="156" r="${r}" fill="none" stroke="#3a0a0a" stroke-width="1.5"/>`).join('')}
        <ellipse cx="128" cy="130" rx="22" ry="12" fill="#fff" opacity="0.35" transform="rotate(-30 128 130)"/><circle cx="176" cy="184" r="4" fill="#fff" opacity="0.4"/>
        ${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="146" y="${66}" width="8" height="10" fill="#3a3e46" transform="rotate(${i * 60} 150 156)"/>`).join('')}${rect('url(#ss-v)')}`,
    }));
  }
  // 15. Siren Cybernautics Inc.: a face submerged, dissolving into data.
  {
    const g = rng(41);
    const b = bust({ id: 'sc', cx: 150, cy: 130, r: 44, skin: ['#bff4ff', '#3aa0c8'], hair: '#7ad0e8', style: 'bald', female: true, shirt: ['#5ab8d8', '#0e4a6a'], collar: 'round', eyesClosed: true, lips: '#4a90b0', brow: '#5aa8c8', rim: '#e8fcff' });
    emit('col_siren_cybernautics_inc', 'front', panel({
      defs: `${linear('sc-bg', [['0%', '#0e3a5a'], ['100%', '#020a14']])}${vignette('sc-v')}${b.defs}`,
      inner: `${rect('url(#sc-bg)')}<g font-family="monospace" font-size="12" fill="#7ad0e8">${Array.from({ length: 60 }, () => `<text x="${f1(g() * 290)}" y="${f1(10 + g() * 320)}" opacity="${(0.15 + g() * 0.5).toFixed(2)}">${Math.floor(g() * 10)}</text>`).join('')}</g>
        <g opacity="0.88">${b.svg}</g>
        <path d="M0,70 Q75,60 150,72 T300,66" stroke="#dff8ff" stroke-width="2" fill="none" opacity="0.5"/>
        ${Array.from({ length: 10 }, () => { const x = 110 + g() * 90, y = 40 + g() * 60; return `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(1.5 + g() * 3)}" fill="none" stroke="#dff8ff" stroke-width="1" opacity="0.7"/>`; }).join('')}${rect('url(#sc-v)')}`,
    }));
  }
  // 16. Smart Pets: a clever lab rat in a little space helmet.
  {
    emit('col_smart_pets', 'front', panel({
      defs: `${radial('sp-bg', [['0%', '#2a2440'], ['100%', '#05040a']])}${radial('sp-fur', [['0%', '#f4eee8'], ['100%', '#a89a90']], '40%', '35%')}${radial('sp-glass', [['70%', '#bff0ff', 0.05], ['100%', '#bff0ff', 0.45]])}${vignette('sp-v')}`,
      inner: `${rect('url(#sp-bg)')}${stars(60, 42)}
        <path d="M200,250 Q260,240 270,190 Q276,160 250,150" stroke="#e8a0a8" stroke-width="6" fill="none" stroke-linecap="round"/>
        <ellipse cx="150" cy="232" rx="66" ry="56" fill="url(#sp-fur)"/>
        <circle cx="104" cy="104" r="26" fill="url(#sp-fur)"/><circle cx="104" cy="104" r="15" fill="#f0b0b8"/><circle cx="196" cy="104" r="26" fill="url(#sp-fur)"/><circle cx="196" cy="104" r="15" fill="#f0b0b8"/>
        <ellipse cx="150" cy="150" rx="54" ry="50" fill="url(#sp-fur)"/>
        <path d="M150,170 Q150,196 150,196" stroke="#a89a90"/><ellipse cx="150" cy="186" rx="10" ry="7" fill="#f08a9a"/>
        <circle cx="128" cy="146" r="9" fill="#1a1010"/><circle cx="172" cy="146" r="9" fill="#1a1010"/><circle cx="131" cy="143" r="3" fill="#fff"/><circle cx="175" cy="143" r="3" fill="#fff"/>
        <path d="M120,188 L86,182 M120,194 L88,198 M180,188 L214,182 M180,194 L212,198" stroke="#e8e0d8" stroke-width="1.5"/>
        <circle cx="150" cy="150" r="96" fill="url(#sp-glass)" stroke="#dff8ff" stroke-width="3" opacity="0.95"/>
        <path d="M86,100 Q110,64 160,58" stroke="#fff" stroke-width="7" opacity="0.5" fill="none" stroke-linecap="round"/>
        <rect x="80" y="236" width="140" height="18" rx="8" fill="#9aa8b8"/>${rect('url(#sp-v)')}`,
    }));
  }
  // 17. Transorbital Railworkers: a booster climbing hard over a red planet.
  {
    emit('col_transorbital_railworkers', 'front', panel({
      defs: `${radial('tr-bg', [['0%', '#1a1e34'], ['100%', '#02030a']])}${radial('tr-planet', [['0%', '#e08050'], ['100%', '#5a1e0e']], '45%', '20%', '70%')}${linear('tr-hull', [['0%', '#f2f4f8'], ['100%', '#8a94a4']], 1, 0)}${radial('tr-flame', [['0%', '#ffffff'], ['30%', '#ffd060'], ['100%', '#ff5a20', 0]])}${vignette('tr-v')}`,
      inner: `${rect('url(#tr-bg)')}${stars(80, 43)}<circle cx="150" cy="560" r="300" fill="url(#tr-planet)"/><circle cx="150" cy="560" r="302" fill="none" stroke="#ffb080" stroke-width="3" opacity="0.6"/>
        <g transform="translate(150,160) rotate(32)"><ellipse cx="0" cy="96" rx="16" ry="50" fill="url(#tr-flame)"/>
          <path d="M-14,60 L-14,-50 Q-14,-80 0,-96 Q14,-80 14,-50 L14,60 Z" fill="url(#tr-hull)"/>
          <path d="M-14,30 L-30,64 L-14,60 Z M14,30 L30,64 L14,60 Z" fill="#c8202a"/><rect x="-14" y="-30" width="28" height="6" fill="#c8202a"/>
          <circle cx="0" cy="-54" r="5" fill="#2a3a5a" stroke="#8a94a4" stroke-width="1.5"/></g>
        <path d="M70,300 Q100,250 130,236" stroke="#fff" stroke-width="10" opacity="0.18" fill="none" stroke-linecap="round"/>${rect('url(#tr-v)')}`,
    }));
  }
  // 18. Vatican Observers: robed observers around a glowing brass orrery.
  {
    const robe = (x, k) => `<g transform="translate(${x},0) scale(${k},1)"><path d="M-30,330 Q-34,250 -20,214 Q-16,196 0,194 Q16,196 20,214 Q34,250 30,330 Z" fill="#1a1414"/><circle cx="0" cy="186" r="14" fill="#2a2020"/><path d="M-16,186 Q-16,166 0,166 Q16,166 16,186" fill="#1a1414"/></g>`;
    emit('col_vatican_observers', 'front', panel({
      defs: `${radial('vo-bg', [['0%', '#3a2e1a'], ['100%', '#060402']], '50%', '40%')}${radial('vo-sun', [['0%', '#ffffff'], ['30%', '#ffe08a'], ['100%', '#ff9a2a', 0]])}${vignette('vo-v')}${glow('vo-gl', 2)}`,
      inner: `${rect('url(#vo-bg)')}<path d="M40,0 A110,110 0 0 1 260,0" fill="none" stroke="#5a4a2a" stroke-width="3" opacity="0.5"/>${stars(30, 44, 80)}
        <g transform="translate(150,140)"><circle r="70" fill="url(#vo-sun)" opacity="0.5"/>
        ${[[86, 22, -12], [62, 16, -12], [38, 10, -12]].map(([rx, ry, a]) => `<ellipse rx="${rx}" ry="${ry}" transform="rotate(${a})" fill="none" stroke="#e8c070" stroke-width="2.5"/>`).join('')}
        <circle r="14" fill="url(#vo-sun)"/><circle r="9" fill="#fff4c8"/>
        ${[[84, -18, 6, '#9ac8ff'], [-58, 12, 5, '#ffb07a'], [36, 9, 4, '#e8e0c8'], [-24, -12, 3.5, '#c8a8ff']].map(([x, y, r, c]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`).join('')}
        <path d="M0,24 L0,90 M-30,90 L30,90" stroke="#c8a050" stroke-width="5"/></g>
        ${robe(70, 1)}${robe(232, -1)}${rect('url(#vo-v)')}`,
    }));
  }
}
