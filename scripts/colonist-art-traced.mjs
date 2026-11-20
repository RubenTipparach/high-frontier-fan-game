// Colonist fronts built from POSED 3D RENDERS (owner 2026-11-20: "pulling in
// human modeling skills from fps game demo ... and then drawing SVGs based on 3d
// human renders"). Each person is an MPFB body posed and rendered by
// scripts/blender/colonist_people.py, traced to flat-colour vector layers by
// scripts/trace_render.py, and stored as scripts/blender/traced/<scene>.svg with
// its key bone positions in <scene>.json (card units). This module puts each
// traced figure over its vector backdrop and attaches the props at those bone
// positions. A card whose traced files are missing is skipped (the earlier
// version of its art stays).
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { artKit } from './colonist-art-m4-fronts.mjs';

const TRACED = join(dirname(fileURLToPath(import.meta.url)), 'blender', 'traced');

export const TRACED_FRONTS = new Set([
  'col_malcolm', 'col_heavy_water_survivalists', 'col_botany_bay_convicts', 'col_vatican_observers',
  'col_lloyd_s_salvage_co', 'col_house_of_saud', 'col_rock_rats_miners_union',
  'col_cobots', 'col_gabonese_mining_consortium', 'col_teleoperators', 'col_boston_hexapods',
  'col_vr_simulcasters', 'col_exoskeletalists',
].filter((id) => existsSync(join(TRACED, `${id}.svg`))));

function figure(id) {
  const svg = readFileSync(join(TRACED, `${id}.svg`), 'utf8');
  const g = svg.slice(svg.indexOf('<g id="figure"'), svg.lastIndexOf('</svg>'));
  const marks = existsSync(join(TRACED, `${id}.json`)) ? JSON.parse(readFileSync(join(TRACED, `${id}.json`), 'utf8')) : {};
  return { g, m: (k) => marks[k] || [150, 160] };
}

export function drawTracedFronts({ W, H, panel, emit }) {
  const { f1, rect, radial, linear, stars, rng, robotBust } = artKit({ W, H });
  const soft = (id) => radial(id, [['60%', '#000', 0], ['100%', '#000', 0.28]], '50%', '45%', '75%');
  const mid = (a, b, t = 0.5) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const eyes = (F, fig) => mid(F.m(`${fig}.head`), F.m(`${fig}.head_tip`), 0.42);
  const out = (id, defs, inner) => { if (TRACED_FRONTS.has(id)) emit(id, 'front', panel({ defs, inner })); };
  const has = (id) => TRACED_FRONTS.has(id);

  // Malcolm: chin on his fist, gazing up into a bright window.
  if (has('col_malcolm')) {
    const F = figure('col_malcolm');
    out('col_malcolm', `${linear('ml-bg', [['0%', '#fbfaf6'], ['60%', '#e6e4dc'], ['100%', '#b8bcc4']], 1, 1)}${soft('ml-v')}`,
      `${rect('url(#ml-bg)')}<rect x="236" y="0" width="64" height="${H}" fill="#fff" opacity="0.75"/>${F.g}${rect('url(#ml-v)')}`);
  }
  // Heavy Water Survivalists: between two white cryo-shelter doors, snake tee.
  if (has('col_heavy_water_survivalists')) {
    const F = figure('col_heavy_water_survivalists');
    const c = mid(F.m('hw.spine_03'), F.m('hw.spine_03_tip'), 0.1);
    out('col_heavy_water_survivalists', `${linear('hw-bg', [['0%', '#f4f6f8'], ['100%', '#c8d0d8']])}${linear('hw-door', [['0%', '#ffffff'], ['100%', '#a8b2bc']], 1, 0)}${soft('hw-v')}`,
      `${rect('url(#hw-bg)')}<path d="M10,330 L10,96 Q10,24 66,20 Q122,24 122,96 L122,330 Z" fill="url(#hw-door)"/><path d="M36,330 L36,110 Q36,60 66,58 Q96,60 96,110 L96,330 Z" fill="#dfe6ec"/>
       <path d="M284,330 L284,80 Q284,40 300,30 L300,330 Z" fill="#7a8794"/>${F.g}
       <g transform="translate(${f1(c[0])},${f1(c[1] + 18)}) scale(0.75)" fill="#2a2a2a"><path d="M-16,-6 Q-24,8 -8,12 Q12,16 6,30 Q-2,40 -16,34 Q-6,32 -2,26 Q2,20 -10,18 Q-30,12 -20,-6 Z"/><circle cx="-14" cy="-8" r="5"/></g>${rect('url(#hw-v)')}`);
  }
  // Botany Bay Convicts: arms flung wide, the chain between the fists snapping.
  if (has('col_botany_bay_convicts')) {
    const F = figure('col_botany_bay_convicts');
    const a = F.m('bb.hand_r_tip'), b = F.m('bb.hand_l_tip');
    const g = rng(71);
    const link = (x, y, ang) => `<g transform="translate(${f1(x)},${f1(y)}) rotate(${f1(ang)})"><rect x="-8" y="-4.5" width="16" height="9" rx="4.5" fill="none" stroke="#3a3a40" stroke-width="3"/></g>`;
    let chain = '';
    for (let i = 0; i <= 10; i++) { if (i === 5) continue; const p = mid(a, b, i / 10); chain += link(p[0], p[1] + Math.sin(i / 10 * Math.PI) * 4, i % 2 ? 90 : 0); }
    let fly = ''; const c = mid(a, b);
    for (let i = 0; i < 7; i++) fly += link(c[0] + (g() - 0.5) * 70, c[1] - 20 - g() * 60, g() * 180);
    out('col_botany_bay_convicts', `${radial('bb-bg', [['0%', '#fff4e0'], ['55%', '#f0c890'], ['100%', '#a86a3a']], '50%', '40%')}${soft('bb-v')}`,
      `${rect('url(#bb-bg)')}<g stroke="#fff" stroke-width="2" opacity="0.4">${Array.from({ length: 16 }, (_, i) => { const t = (i / 16) * Math.PI * 2; return `<line x1="${f1(c[0])}" y1="${f1(c[1] - 30)}" x2="${f1(c[0] + Math.cos(t) * 90)}" y2="${f1(c[1] - 30 + Math.sin(t) * 90)}"/>`; }).join('')}</g>
       ${F.g}${chain}${fly}${rect('url(#bb-v)')}`);
  }
  // Vatican Observers: the Jesuit's raised hand by a gold IHS medallion, a
  // flashlight in the other hand, a colleague at the edge.
  if (has('col_vatican_observers')) {
    const F = figure('col_vatican_observers');
    const up = F.m('jesuit.hand_l_tip'), lo = F.m('jesuit.hand_r_tip');
    const med = [Math.min(258, up[0] + 52), up[1] + 70];
    out('col_vatican_observers', `${linear('vo-bg', [['0%', '#4a3a26'], ['50%', '#8a6a40'], ['100%', '#3a2a18']], 1, 0)}${radial('vo-med', [['0%', '#fff0b0'], ['55%', '#e8b040'], ['100%', '#8a5a10']], '40%', '35%')}${radial('vo-glow', [['0%', '#ffd070', 0.7], ['100%', '#ffd070', 0]])}${soft('vo-v')}`,
      `${rect('url(#vo-bg)')}<rect x="118" y="0" width="34" height="${H}" fill="#c89a50" opacity="0.3"/><circle cx="${f1(med[0])}" cy="${f1(med[1])}" r="70" fill="url(#vo-glow)"/>
       ${F.g}<g transform="translate(${f1(med[0])},${f1(med[1])})"><circle r="34" fill="url(#vo-med)" stroke="#8a5a10" stroke-width="2"/><circle r="25" fill="none" stroke="#fff4c8" stroke-width="1.2" opacity="0.8"/>
       ${Array.from({ length: 12 }, (_, i) => `<path d="M0,-27 l3,-7 l-6,0 z" fill="#fff4c8" transform="rotate(${i * 30})"/>`).join('')}<text x="0" y="5" text-anchor="middle" font-family="serif" font-weight="700" font-size="14" fill="#7a4a10">IHS</text></g>
       <rect x="${f1(lo[0] - 6)}" y="${f1(lo[1] - 6)}" width="24" height="10" rx="4" fill="#9aa0a8"/><path d="M${f1(lo[0] + 16)},${f1(lo[1])} L${f1(lo[0] + 70)},${f1(lo[1] + 28)} L${f1(lo[0] + 58)},${f1(lo[1] + 44)} Z" fill="#fff6c8" opacity="0.3"/>${rect('url(#vo-v)')}`);
  }
  // Lloyd's Salvage Co.: the trader points into a deal hologram; partner behind.
  if (has('col_lloyd_s_salvage_co')) {
    const F = figure('col_lloyd_s_salvage_co');
    const t = F.m('trader.hand_l_tip');
    const h = [Math.min(240, t[0] + 34), t[1] - 34];
    out('col_lloyd_s_salvage_co', `${linear('ls-bg', [['0%', '#e8ecef'], ['100%', '#9aa4ae']], 1, 1)}${linear('ls-holo', [['0%', '#7ae0ff', 0.8], ['100%', '#2a9ad0', 0.6]], 1, 1)}${soft('ls-v')}`,
      `${rect('url(#ls-bg)')}<rect width="${W}" height="70" fill="#fff" opacity="0.5"/>${F.g}
       <g transform="translate(${f1(h[0])},${f1(h[1])}) rotate(-4)"><rect x="-44" y="-36" width="88" height="66" rx="9" fill="url(#ls-holo)" stroke="#dff8ff" stroke-width="2"/>
       <circle cx="-17" cy="-2" r="17" fill="#0e8ab8"/><text x="-17" y="5" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="19" fill="#fff">¥</text>
       <rect x="8" y="-15" width="24" height="20" rx="7" fill="#fff"/><circle cx="16" cy="-5" r="2.6" fill="#2a5a8a"/><circle cx="24" cy="-5" r="2.6" fill="#2a5a8a"/>
       <path d="M-26,-25 H-6 M-20,-30 L-26,-25 L-20,-20 M10,18 H30 M24,13 L30,18 L24,23" stroke="#fff" stroke-width="2.6" fill="none"/></g>
       <path d="M${f1(t[0])},${f1(t[1])} L${f1(h[0] - 44)},${f1(h[1] + 30)}" stroke="#7ae0ff" stroke-width="1.5" stroke-dasharray="3 3"/>${rect('url(#ls-v)')}`);
  }
  // House of Saud: levitating in meditation in a column of gold light.
  if (has('col_house_of_saud')) {
    const F = figure('col_house_of_saud');
    const c = F.m('prince.spine_03');
    out('col_house_of_saud', `${radial('hs-bg', [['0%', '#fffbe8'], ['45%', '#e8dca0'], ['100%', '#8a7a3a']], '50%', '30%')}${radial('hs-aura', [['0%', '#fff', 0.9], ['100%', '#fff4c0', 0]])}`,
      `${rect('url(#hs-bg)')}<g stroke="#fff" stroke-width="3" opacity="0.4">${Array.from({ length: 10 }, (_, i) => `<line x1="${60 + i * 20}" y1="0" x2="${100 + i * 12}" y2="${H}"/>`).join('')}</g>
       <ellipse cx="${f1(c[0])}" cy="${f1(c[1])}" rx="110" ry="130" fill="url(#hs-aura)"/>${F.g}<ellipse cx="${f1(c[0])}" cy="312" rx="80" ry="8" fill="#5a4a1a" opacity="0.25"/>`);
  }
  // Rock Rats Miners' Union: hand on hip, her cobot beside her.
  if (has('col_rock_rats_miners_union')) {
    const F = figure('col_rock_rats_miners_union');
    const r = robotBust({ id: 'rr3', cx: 232, cy: 112, s: 0.82 });
    const c = F.m('miner.spine_03');
    out('col_rock_rats_miners_union', `${linear('rr-bg', [['0%', '#e4e8ec'], ['100%', '#9aa2ac']], 1, 1)}${r.defs}${soft('rr-v')}`,
      `${rect('url(#rr-bg)')}<rect x="200" width="100" height="${H}" fill="#fff" opacity="0.35"/>${r.svg}${F.g}
       <circle cx="${f1(c[0] + 16)}" cy="${f1(c[1] + 8)}" r="10" fill="#2a4a8a" stroke="#fff" stroke-width="2"/><text x="${f1(c[0] + 16)}" y="${f1(c[1] + 11.5)}" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="8" fill="#fff">RR</text>${rect('url(#rr-v)')}`);
  }
  // Cobots: she glances down; her service robot shoulder to shoulder.
  if (has('col_cobots')) {
    const F = figure('col_cobots');
    const r = robotBust({ id: 'cb3', cx: 218, cy: 106, s: 1.0 });
    out('col_cobots', `${linear('cb-bg', [['0%', '#e2e6ea'], ['100%', '#7a8490']], 1, 1)}${r.defs}${soft('cb-v')}`,
      `${rect('url(#cb-bg)')}<rect y="220" width="${W}" height="110" fill="#5a6470" opacity="0.35"/>${r.svg}${F.g}${rect('url(#cb-v)')}`);
  }
  // Gabonese Mining Consortium: binoculars up, scanning the skyline.
  if (has('col_gabonese_mining_consortium')) {
    const F = figure('col_gabonese_mining_consortium');
    const e = eyes(F, 'boy'), hh = F.m('boy.head'), ht = F.m('boy.head_tip');
    const sc = Math.hypot(ht[0] - hh[0], ht[1] - hh[1]) / 40;
    out('col_gabonese_mining_consortium', `${linear('gm-sky', [['0%', '#7ab4dc'], ['70%', '#d8e8f0'], ['100%', '#f0e8d8']])}${soft('gm-v')}`,
      `${rect('url(#gm-sky)')}<g opacity="0.55" fill="#9ab0c4"><rect x="196" y="70" width="34" height="260"/><rect x="236" y="40" width="40" height="290"/><rect x="280" y="110" width="22" height="220"/></g>
       <g opacity="0.4" fill="#fff">${Array.from({ length: 24 }, (_, i) => `<rect x="${240 + (i % 4) * 9}" y="${54 + Math.floor(i / 4) * 20}" width="4" height="9"/>`).join('')}</g>${F.g}
       <g transform="translate(${f1(e[0] + 8 * sc)},${f1(e[1])}) scale(${f1(sc)})"><rect x="-6" y="-13" width="36" height="16" rx="6" fill="#26282c"/><rect x="-6" y="2" width="36" height="16" rx="6" fill="#1e2024"/>
       <circle cx="30" cy="-5" r="7" fill="#3a6a9a" stroke="#4a4e56" stroke-width="2"/><circle cx="30" cy="10" r="7" fill="#3a6a9a" stroke="#4a4e56" stroke-width="2"/><circle cx="28" cy="-7" r="2" fill="#fff"/></g>${rect('url(#gm-v)')}`);
  }
  // Teleoperators: visor down, reaching toward the robot that holds her rose.
  if (has('col_teleoperators')) {
    const F = figure('col_teleoperators');
    const e = eyes(F, 'op'), hh = F.m('op.head'), ht = F.m('op.head_tip');
    const s = Math.hypot(ht[0] - hh[0], ht[1] - hh[1]);
    const r = robotBust({ id: 'to3', cx: 236, cy: 112, s: 0.9 });
    out('col_teleoperators', `${linear('to-bg', [['0%', '#d8dde2'], ['100%', '#6a7480']], 1, 1)}${linear('to-vz', [['0%', '#f2f8ff'], ['100%', '#8ab0d0']], 1, 0)}${r.defs}${soft('to-v')}`,
      `${rect('url(#to-bg)')}<rect width="${W}" height="80" fill="#fff" opacity="0.35"/>${r.svg}
       <g transform="translate(204,150)"><path d="M0,0 L-6,30" stroke="#3a7a3a" stroke-width="3"/><path d="M-3,14 q-12,-4 -14,6 q10,2 14,-6" fill="#4a9a4a"/><circle cx="0" cy="-6" r="11" fill="#c8202e"/><path d="M-9,-8 Q0,-19 9,-8 Q4,0 0,-4 Q-4,0 -9,-8 Z" fill="#e8404a"/></g>
       ${F.g}<rect x="${f1(e[0] - s * 0.62)}" y="${f1(e[1] - s * 0.16)}" width="${f1(s * 1.24)}" height="${f1(s * 0.32)}" rx="${f1(s * 0.15)}" fill="url(#to-vz)"/>${rect('url(#to-v)')}`);
  }
  // Boston Hexapods: in profile, pointing into the holo screen of her walker.
  if (has('col_boston_hexapods')) {
    const F = figure('col_boston_hexapods');
    const legs = [0, 1, 2].map((i) => { const x = 46 + i * 34; return `<path d="M${x},146 L${x - 12},164 L${x - 16},186 M${x},146 L${x + 12},164 L${x + 16},186"/>`; }).join('');
    out('col_boston_hexapods', `${linear('bh-bg', [['0%', '#e8eef2'], ['100%', '#8a9aa6']], 1, 1)}${linear('bh-scr', [['0%', '#4ad8ff', 0.5], ['100%', '#1a7aa8', 0.3]], 1, 1)}${soft('bh-v')}`,
      `${rect('url(#bh-bg)')}<g transform="skewY(-5)"><rect x="8" y="80" width="146" height="128" rx="6" fill="url(#bh-scr)" stroke="#2a8ab8" stroke-width="2"/>
       <g stroke="#0e5a8a" stroke-width="2.2" fill="none"><rect x="30" y="130" width="100" height="18" rx="7"/>${legs}<circle cx="140" cy="132" r="8"/></g>
       <g stroke="#0e5a8a" opacity="0.25">${Array.from({ length: 7 }, (_, i) => `<line x1="8" y1="${92 + i * 17}" x2="154" y2="${92 + i * 17}"/>`).join('')}</g></g>${F.g}${rect('url(#bh-v)')}`);
  }
  // VR Simulcasters: she reaches for the life-size hologram she streams.
  if (has('col_vr_simulcasters')) {
    const F = figure('col_vr_simulcasters');
    const Hg = existsSync(join(TRACED, 'col_vr_simulcasters_holo.svg')) ? figure('col_vr_simulcasters_holo') : null;
    out('col_vr_simulcasters', `${linear('vr-bg', [['0%', '#c8b890'], ['100%', '#4a3a28']], 1, 1)}${soft('vr-v')}
       <filter id="vr-holo"><feColorMatrix type="matrix" values="0.2 0.2 0.2 0 0.25  0.35 0.35 0.35 0 0.55  0.4 0.4 0.4 0 0.6  0 0 0 0.75 0"/></filter>`,
      `${rect('url(#vr-bg)')}<path d="M0,0 L80,0 L60,${H} L0,${H} Z" fill="#6a4a2a" opacity="0.35"/>
       ${Hg ? `<g filter="url(#vr-holo)">${Hg.g}</g>` : ''}<g stroke="#e8fcff" opacity="0.18">${Array.from({ length: 30 }, (_, i) => `<line x1="150" y1="${60 + i * 9}" x2="300" y2="${60 + i * 9}"/>`).join('')}</g>
       <ellipse cx="226" cy="318" rx="56" ry="8" fill="#7ff0ff" opacity="0.6"/>${F.g}${rect('url(#vr-v)')}`);
  }
  // Exoskeletalists: mid-stride up a red canyon in a powered leg frame.
  if (has('col_exoskeletalists')) {
    const F = figure('col_exoskeletalists');
    const strut = (side) => {
      const p = F.m('hiker.pelvis'), k = F.m(`hiker.calf_${side}`), f = F.m(`hiker.foot_${side}`);
      return `<path d="M${f1(p[0])},${f1(p[1])} L${f1(k[0])},${f1(k[1])} L${f1(f[0])},${f1(f[1])}" stroke="#3a4250" stroke-width="4" fill="none" stroke-linejoin="round"/><circle cx="${f1(k[0])}" cy="${f1(k[1])}" r="5" fill="#ffb84a" stroke="#3a4250" stroke-width="2"/>`;
    };
    const sp = F.m('hiker.spine_03');
    out('col_exoskeletalists', `${linear('ex-sky', [['0%', '#f6d8b0'], ['100%', '#e8925a']])}${linear('ex-far', [['0%', '#d07848'], ['100%', '#9a4a28']])}${linear('ex-near', [['0%', '#a8502a'], ['100%', '#4a1a0a']])}${soft('ex-v')}`,
      `${rect('url(#ex-sky)')}<path d="M0,140 L40,96 L80,120 L80,${H} L0,${H} Z M220,110 L260,70 L300,96 L300,${H} L220,${H} Z" fill="url(#ex-far)"/>
       <path d="M0,300 L120,286 L300,262 L300,${H} L0,${H} Z" fill="url(#ex-near)"/>
       <rect x="${f1(sp[0] + 4)}" y="${f1(sp[1] - 12)}" width="26" height="46" rx="6" fill="#3a4a5e"/>${F.g}${strut('l')}${strut('r')}${rect('url(#ex-v)')}`);
  }
}
