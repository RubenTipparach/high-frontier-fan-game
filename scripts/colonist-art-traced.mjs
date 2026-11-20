import { artKit } from './colonist-art-m4-fronts.mjs';
import { drawCutout, skeleton, skeletonFor, restPose, fk, reach, POSES, ROBOT_LOOK } from './rig2d/cutout.mjs';

// Colonist fronts with people from the cut-out character kit (owner 2026-11-20:
// a 2D rig drawn once at rest and posed by rotating bones; see the
// character-kit skill). Each card lists its people (look + pose); the vector
// backdrops and props below hang off the posed joints.
export const TRACED_FRONTS = new Set([
  'col_malcolm', 'col_heavy_water_survivalists', 'col_botany_bay_convicts', 'col_vatican_observers',
  'col_lloyd_s_salvage_co', 'col_house_of_saud', 'col_rock_rats_miners_union',
  'col_cobots', 'col_gabonese_mining_consortium', 'col_teleoperators', 'col_boston_hexapods',
  'col_vr_simulcasters', 'col_exoskeletalists',
]);
const hasPose = (id) => !!FIGS[id];

// people per card: { fid, look, pose(sk) }. Full figures, about 46 px a head.
const at = (x, foot = 324, h = 46, rot = {}) => ({ ...restPose(x, foot, h), rot: { ...rot } });
const FIGS = {
  col_malcolm: [{ fid: 'malcolm', look: { body: 'male', skin: '#e2b48e', hair: '#5a3a22', hairStyle: 'tuft', face: 'sleepy', top: 'longsleeve', topColor: '#3a4a6a', bottomColor: '#2a2e36', hands: { L: 'fist', R: 'relaxed' } },
    pose: (sk) => { let p = at(140, 324, 46, { head: -6, upperR: 10, foreR: -10 }); const J = fk(sk, p).joints; return reach(sk, p, 'L', [J.headBase[0] + 4, J.headBase[1] + 4], { bend: -1 }); } }],
  col_heavy_water_survivalists: [{ fid: 'hw', look: { body: 'male', skin: '#c98a5e', hair: '#2a2420', hairStyle: 'buzz', face: 'neutral', top: 'tee', topColor: '#ecece8', bottomColor: '#4a5a3a', hands: { L: 'fist', R: 'fist' } },
    pose: () => at(206, 324, 46, POSES.hipsHands) }],
  col_botany_bay_convicts: [{ fid: 'bb', look: { body: 'male', skin: '#8a5a3a', hair: '#1e1a18', hairStyle: 'buzz', face: 'shout', top: 'jumpsuit', topColor: '#e8792a', hands: { L: 'fist', R: 'fist' } },
    pose: () => at(150, 324, 44, { upperL: -112, foreL: -12, upperR: 112, foreR: 12, thighL: -6, thighR: 6 }) }],
  col_vatican_observers: [
    { fid: 'colleague', look: { body: 'female', skin: '#f0cfb2', hair: '#9a9a9a', hairStyle: 'bun', face: 'smile', top: 'jacket', topColor: '#26262c', collar: '#ffffff', bottomColor: '#1e1e22', blush: false }, pose: () => at(30, 330, 44) },
    { fid: 'jesuit', look: { body: 'male', skin: '#e8c0a0', hair: '#bcbcbc', hairStyle: 'buzz', face: 'smile', top: 'jacket', topColor: '#1e1e24', collar: '#ffffff', bottomColor: '#1a1a1e', hands: { L: 'open', R: 'hold' }, blush: false },
      pose: () => at(140, 324, 46, { upperL: -145, foreL: -18, upperR: 8 }) }],
  col_lloyd_s_salvage_co: [
    { fid: 'partner', look: { body: 'male', skin: '#6a4430', hair: '#1a1614', hairStyle: 'buzz', face: 'smirk', top: 'jacket', topColor: '#5a5e66', collar: '#e8e8e8', bottomColor: '#33363c', hands: { L: 'fist', R: 'fist' } }, pose: () => at(252, 318, 42, POSES.hipsHands) },
    { fid: 'trader', look: { body: 'female', skin: '#f0c8a8', hair: '#d8b060', hairStyle: 'bob', face: 'grin', top: 'jacket', topColor: '#2a3a5a', collar: '#ffffff', bottomColor: '#232a3a', hands: { L: 'point', R: 'relaxed' } },
      pose: () => at(92, 326, 46, { upperL: -100, foreL: -10 }) }],
  col_house_of_saud: [{ fid: 'prince', look: { body: 'male', skin: '#c89468', hair: '#1a1410', hairStyle: 'buzz', face: 'sleepy', top: 'longsleeve', topColor: '#f6f4ee', bottomColor: '#ecebe4', shoes: '#c8b890', hands: { L: 'open', R: 'open' } },
    pose: (sk) => { let p = at(150, 300, 46, { thighL: -78, shinL: 150, thighR: 78, shinR: -150 }); const J = fk(sk, p).joints; p = reach(sk, p, 'L', [J.knL[0] - 6, J.knL[1] - 8], { bend: -1 }); return reach(sk, p, 'R', [J.knR[0] + 6, J.knR[1] - 8], { bend: 1 }); } }],
  col_rock_rats_miners_union: [{ fid: 'bot', look: { ...ROBOT_LOOK, topColor: '#f0c060', hands: { L: 'relaxed', R: 'open' } }, pose: () => at(236, 326, 44, { upperR: 130, foreR: 20 }) },
    { fid: 'miner', look: { body: 'female', skin: '#d8a07a', hair: '#8a3a1a', hairStyle: 'ponytail', face: 'smirk', top: 'jumpsuit', topColor: '#c8862a', hands: { L: 'fist', R: 'relaxed' } },
    pose: () => at(96, 326, 46, { upperL: -38, foreL: 78, handL: 20, upperR: 6 }) }],
  col_cobots: [{ fid: 'bot', look: { ...ROBOT_LOOK, hands: { L: 'relaxed', R: 'hold' } }, pose: (sk) => reach(sk, at(204, 326, 48), 'R', [152, 190], { bend: -1 }) },
    { fid: 'cobw', look: { body: 'female', skin: '#7a4a2e', hair: '#1a1210', hairStyle: 'curly', face: 'smile', top: 'tee', topColor: '#4a7ab0', bottomColor: '#2a2e3a', hands: { L: 'hold', R: 'relaxed' } },
    pose: (sk) => reach(sk, at(98, 326, 46, { head: -6 }), 'L', [150, 190], { bend: 1 }) }],
  col_gabonese_mining_consortium: [{ fid: 'boy', look: { body: 'male', skin: '#4a2e1e', hair: '#141010', hairStyle: 'buzz', face: 'smile', top: 'polo', topColor: '#2a8a5a', bottomColor: '#b8a070', hands: { L: 'fist', R: 'fist' } },
    pose: (sk) => { let p = { ...at(120, 326, 46), len: { upperL: 0.5, upperR: 0.5, foreL: 0.85, foreR: 0.85 } }; const J = fk(sk, p).joints, cy = J.headBase[1] - 0.45 * 46; p = reach(sk, p, 'L', [J.headBase[0] + 12, cy + 12], { bend: -1 }); return reach(sk, p, 'R', [J.headBase[0] - 12, cy + 12], { bend: 1 }); } }],
  col_teleoperators: [{ fid: 'bot', look: { ...ROBOT_LOOK, topColor: '#dfe6ee', collar: '#ff6a7a', hands: { L: 'relaxed', R: 'hold' } }, pose: (sk) => reach(sk, at(206, 326, 46), 'R', [154, 188], { bend: -1 }) },
    { fid: 'op', look: { body: 'female', skin: '#f0d0b0', hair: '#1e1a1a', hairStyle: 'bob', face: 'smile', top: 'jumpsuit', topColor: '#dfe2e8', hands: { L: 'open', R: 'relaxed' } },
    pose: (sk) => reach(sk, at(94, 326, 46), 'L', [146, 190], { bend: 1 }) }],
  col_boston_hexapods: [{ fid: 'eng', look: { body: 'female', skin: '#e8b890', hair: '#6a3a1e', hairStyle: 'bun', face: 'smile', top: 'longsleeve', topColor: '#d86a3a', bottomColor: '#2a3a5a', hands: { L: 'relaxed', R: 'point' } },
    pose: (sk) => reach(sk, at(222, 326, 46), 'R', [150, 150], { bend: -1 }) }],
  col_vr_simulcasters: [{ fid: 'sim', look: { body: 'female', skin: '#c8906a', hair: '#3a2418', hairStyle: 'long', face: 'grin', top: 'tee', topColor: '#8a2a6a', bottom: 'skirt', bottomColor: '#2a2a3a', hands: { L: 'open', R: 'relaxed' } },
    pose: (sk) => reach(sk, at(84, 326, 46), 'L', [178, 140], { bend: 1 }) }],
  col_vr_simulcasters_holo: [{ fid: 'holo', look: { body: 'male', skin: '#d0a080', hair: '#2a2a2a', hairStyle: 'tuft', face: 'grin', top: 'jacket', topColor: '#4a4a5a', bottomColor: '#2a2a32', hands: { L: 'relaxed', R: 'open' } },
    pose: () => at(228, 316, 44, { upperR: 100, foreR: 10, upperL: -6 }) }],
  col_exoskeletalists: [{ fid: 'hiker', look: { body: 'male', skin: '#a87050', hair: '#1a1414', hairStyle: 'tuft', face: 'grin', top: 'jacket', topColor: '#3a6a8a', collar: '#e0e4e8', bottomColor: '#3a3a42', hands: { L: 'fist', R: 'fist' } },
    pose: () => at(150, 316, 46, { thighL: -18, shinL: 10, thighR: 10, shinR: -2, upperL: 16, foreL: -24, upperR: -14, foreR: 20, root: -2 }) }],
};
// MPFB joint names (the props were placed off them) -> kit joints
const MAP = { pelvis: 'pelvis', spine_03: 'chest', spine_03_tip: 'neck', neck_01: 'neck', head: 'headBase', head_tip: 'headTop' };
for (const [m, s] of [['l', 'L'], ['r', 'R']]) Object.assign(MAP, { [`upperarm_${m}`]: 'sh' + s, [`lowerarm_${m}`]: 'el' + s, [`hand_${m}`]: 'wr' + s, [`hand_${m}_tip`]: 'tip' + s, [`thigh_${m}`]: 'hip' + s, [`calf_${m}`]: 'kn' + s, [`foot_${m}`]: 'an' + s, [`foot_${m}_tip`]: 'toe' + s });

function figure(id) {
  let g = ''; const J = {};
  for (const f of FIGS[id]) {
    const sk = skeletonFor(f.look), pose = f.pose(sk);
    g += drawCutout({ id: `${id}-${f.fid}`, look: f.look, pose });
    const { joints } = fk(sk, pose);
    for (const [k, v] of Object.entries(MAP)) J[`${f.fid}.${k}`] = joints[v];
  }
  return { g, m: (k) => J[k] };
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
    const r = { defs: '', svg: '' };
    const c = F.m('miner.spine_03');
    out('col_rock_rats_miners_union', `${linear('rr-bg', [['0%', '#e4e8ec'], ['100%', '#9aa2ac']], 1, 1)}${r.defs}${soft('rr-v')}`,
      `${rect('url(#rr-bg)')}<rect x="200" width="100" height="${H}" fill="#fff" opacity="0.35"/>${r.svg}${F.g}
       <circle cx="${f1(c[0] + 16)}" cy="${f1(c[1] + 8)}" r="10" fill="#2a4a8a" stroke="#fff" stroke-width="2"/><text x="${f1(c[0] + 16)}" y="${f1(c[1] + 11.5)}" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="8" fill="#fff">RR</text>${rect('url(#rr-v)')}`);
  }
  // Cobots: she glances down; her service robot shoulder to shoulder.
  if (has('col_cobots')) {
    const F = figure('col_cobots');
    const r = { defs: '', svg: '' };
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
       <g transform="translate(${f1(e[0])},${f1(e[1] + 3 * sc)}) scale(${f1(sc)})"><rect x="-21" y="-9" width="42" height="18" rx="7" fill="#26282c"/><circle cx="-10" cy="0" r="10" fill="#1e2024"/><circle cx="10" cy="0" r="10" fill="#1e2024"/><circle cx="-10" cy="0" r="6.5" fill="#3a6a9a"/><circle cx="10" cy="0" r="6.5" fill="#3a6a9a"/><circle cx="-12" cy="-2" r="2" fill="#fff"/><circle cx="8" cy="-2" r="2" fill="#fff"/></g>${rect('url(#gm-v)')}`);
  }
  // Teleoperators: visor down, reaching toward the robot that holds her rose.
  if (has('col_teleoperators')) {
    const F = figure('col_teleoperators');
    const e = eyes(F, 'op'), hh = F.m('op.head'), ht = F.m('op.head_tip');
    const s = Math.hypot(ht[0] - hh[0], ht[1] - hh[1]);
    const r = { defs: '', svg: '' };
    out('col_teleoperators', `${linear('to-bg', [['0%', '#d8dde2'], ['100%', '#6a7480']], 1, 1)}${linear('to-vz', [['0%', '#f2f8ff'], ['100%', '#8ab0d0']], 1, 0)}${r.defs}${soft('to-v')}`,
      `${rect('url(#to-bg)')}<rect width="${W}" height="80" fill="#fff" opacity="0.35"/>${r.svg}
       ${F.g}${(() => {
         // the rose stands up out of the robot's grip, bloom above the joined hands;
         // the robot's fingers close over the stem
         const w = F.m('bot.hand_r'), t = F.m('bot.hand_r_tip'), g = [(w[0] + t[0]) / 2, (w[1] + t[1]) / 2];
         return `<g transform="translate(${f1(g[0])},${f1(g[1])})"><path d="M3,14 Q0,-10 -4,-34" stroke="#3a7a3a" stroke-width="3" fill="none"/>
           <path d="M-1,-14 q-14,-6 -18,4 q12,4 18,-4" fill="#4a9a4a"/><path d="M-2,-22 q12,-8 16,0 q-10,6 -16,0" fill="#4a9a4a"/>
           <circle cx="-4" cy="-42" r="11" fill="#c8202e"/><path d="M-13,-44 Q-4,-55 5,-44 Q0,-36 -4,-40 Q-8,-36 -13,-44 Z" fill="#e8404a"/><path d="M-10,-36 q6,6 12,0" stroke="#9a1020" stroke-width="1.5" fill="none"/>
           <rect x="-6" y="-4" width="12" height="9" rx="4" fill="#3a4250"/></g>`; })()}<rect x="${f1(e[0] - s * 0.62)}" y="${f1(e[1] - s * 0.16)}" width="${f1(s * 1.24)}" height="${f1(s * 0.32)}" rx="${f1(s * 0.15)}" fill="url(#to-vz)"/>${rect('url(#to-v)')}`);
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
    const Hg = hasPose('col_vr_simulcasters_holo') ? figure('col_vr_simulcasters_holo') : null;
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

// ---- promoted (purple) sides with people, drawn with the same kit ------------------
export const KIT_BACKS = new Set(['col_malcolm', 'col_botany_bay_convicts', 'col_lloyd_s_salvage_co', 'col_rock_rats_miners_union',
  'col_cobots', 'col_boston_hexapods', 'col_vr_simulcasters']);
const BACKS = {
  // Renaissance Man: a bearded polymath at his glowing blueprints.
  col_malcolm: [{ fid: 'rm', look: { body: 'male', skin: '#e2b48e', hair: '#4a2c18', hairStyle: 'tuft', beard: 'full', face: 'smile', top: 'jacket', topColor: '#4a3a6a', collar: '#e8e0f0', bottomColor: '#2a2236', hands: { L: 'point', R: 'relaxed' }, blush: false },
    pose: () => at(150, 326, 46, { upperL: -95, foreL: -30 }) }],
  // Soldier Caste: an armoured trooper, blade across the chest.
  col_botany_bay_convicts: [{ fid: 'sol', look: { ...ROBOT_LOOK, topColor: '#c9ced8', bottomColor: '#4a4e5a', collar: '#ff4a6a', hands: { L: 'fist', R: 'fist' } },
    pose: () => at(150, 326, 48, { upperL: -20, foreL: 120, upperR: 14, foreR: -60 }) }],
  // Svalbard Caretakers: asleep upright in a glowing pod.
  col_lloyd_s_salvage_co: [{ fid: 'pod', look: { body: 'female', skin: '#f0d6c4', hair: '#e8e0d0', hairStyle: 'long', face: 'sleepy', top: 'jumpsuit', topColor: '#f4f0fa', collar: '#c8b8e8', hands: { L: 'relaxed', R: 'relaxed' } },
    pose: () => at(150, 306, 40, { upperL: -6, upperR: 6 }) }],
  // Alchemist Aviatrices: a pilot in her flight suit, goggles up.
  col_rock_rats_miners_union: [{ fid: 'av', look: { body: 'female', skin: '#d8a07a', hair: '#8a3a1a', hairStyle: 'ponytail', face: 'grin', top: 'jacket', topColor: '#7a4a2a', collar: '#f0e0c8', bottomColor: '#3a2a20', shoes: '#2a1a12', hands: { L: 'fist', R: 'thumb' } },
    pose: () => at(150, 326, 46, { upperL: -38, foreL: 78, handL: 20, upperR: 30, foreR: 120 }) }],
  // Singularity: a family against a dawn of their own making.
  col_cobots: [
    { fid: 'a', look: { body: 'male', hairStyle: 'tuft' }, pose: () => at(70, 330, 44, { upperL: -10 }) },
    { fid: 'b', look: { body: 'female', hairStyle: 'bob' }, pose: () => at(130, 330, 42, { upperR: 10 }) },
    { fid: 'c', look: { body: 'male', hairStyle: 'curly' }, pose: () => at(190, 330, 30, { upperL: -120, foreL: -10 }) },
    { fid: 'd', look: { body: 'female', hairStyle: 'ponytail' }, pose: () => at(240, 330, 26, { upperR: 40 }) }],
  // Zombie Wanderers: shuffling on, arms out, by the dead screens.
  col_boston_hexapods: [{ fid: 'zw', look: { body: 'male', skin: '#b8c8a8', hair: '#4a4a3a', hairStyle: 'buzz', face: 'sleepy', top: 'longsleeve', topColor: '#ece8f0', bottomColor: '#c8c4d0', shoes: '#5a5660', hands: { L: 'relaxed', R: 'relaxed' }, blush: false },
    pose: () => at(196, 326, 46, { upperL: -62, foreL: -6, handL: 30, upperR: 58, foreR: 4, handR: -30, head: 10, root: 3 }) }],
  // The Presence: two people meeting through a point of light.
  col_vr_simulcasters: [
    { fid: 'l', look: { body: 'female', skin: '#d8b090', hair: '#3a2418', hairStyle: 'long', face: 'smile', top: 'longsleeve', topColor: '#2a1c44', bottomColor: '#1e1430', hands: { L: 'open', R: 'relaxed' } }, pose: (sk) => reach(sk, at(82, 326, 44), 'L', [138, 190], { bend: 1 }) },
    { fid: 'r', look: { body: 'male', skin: '#5a3a26', hair: '#141010', hairStyle: 'buzz', face: 'smile', top: 'longsleeve', topColor: '#2a1c44', bottomColor: '#1e1430', hands: { L: 'relaxed', R: 'open' } }, pose: (sk) => reach(sk, at(218, 326, 46), 'R', [162, 190], { bend: -1 }) }],
};

export function drawKitBacks({ W, H, panel, emit }) {
  const { f1, rect, radial, linear, stars } = artKit({ W, H });
  const bg = (id) => radial(id, [['0%', '#655ca8'], ['100%', '#652d91']], '50%', '44%', '80%');
  const people = (id) => { const save = FIGS[id]; FIGS[id] = BACKS[id]; const F = figure(id); FIGS[id] = save; return F; };
  const out = (id, defs, inner) => emit(id, 'back', panel({ defs, inner }));

  { const F = people('col_malcolm');
    out('col_malcolm', bg('rm-bg'), `${rect('url(#rm-bg)')}${stars(10, 41)}
      <g fill="none" stroke="#bfe6ff" stroke-width="1.6" opacity="0.8"><circle cx="232" cy="70" r="26"/><path d="M206,70 H258 M232,44 V96"/><rect x="34" y="52" width="58" height="44"/><path d="M34,74 H92 M63,52 V96"/><path d="M200,140 l26,-14 l26,14 l-26,14 z"/></g>${F.g}`); }
  { const F = people('col_botany_bay_convicts'), h = F.m('sol.hand_r'), g = F.m('sol.hand_l');
    out('col_botany_bay_convicts', bg('sc-bg'), `${rect('url(#sc-bg)')}${stars(10, 42)}${F.g}
      <path d="M${f1(h[0])},${f1(h[1])} L${f1(g[0] + 30)},${f1(g[1] - 70)}" stroke="#e8ecf2" stroke-width="6" stroke-linecap="round"/><path d="M${f1(h[0] - 8)},${f1(h[1] + 6)} L${f1(h[0] + 8)},${f1(h[1] - 6)}" stroke="#3a3e48" stroke-width="5"/>`); }
  { const F = people('col_lloyd_s_salvage_co');
    out('col_lloyd_s_salvage_co', `${bg('sv-bg')}${radial('sv-pod', [['0%', '#ffffff', 0.55], ['100%', '#c8b8f0', 0.15]])}${radial('sv-glow', [['0%', '#e8d8ff', 0.6], ['100%', '#e8d8ff', 0]])}`,
      `${rect('url(#sv-bg)')}${stars(10, 43)}<ellipse cx="150" cy="170" rx="120" ry="160" fill="url(#sv-glow)"/>${F.g}
      <rect x="92" y="22" width="116" height="296" rx="58" fill="url(#sv-pod)" stroke="#f4eeff" stroke-width="3"/>${[60, 120, 200, 260].map((y, i) => `<circle cx="${i % 2 ? 214 : 86}" cy="${y}" r="5" fill="#f0e6ff"/>`).join('')}`); }
  { const F = people('col_rock_rats_miners_union'), e = F.m('av.head'), t = F.m('av.head_tip');
    const s = Math.hypot(t[0] - e[0], t[1] - e[1]), gy = e[1] + (t[1] - e[1]) * 0.78;
    out('col_rock_rats_miners_union', bg('aa-bg'), `${rect('url(#aa-bg)')}${stars(12, 44)}<path d="M20,300 Q150,250 290,120" stroke="#ffd08a" stroke-width="2" fill="none" stroke-dasharray="6 6" opacity="0.7"/>${F.g}
      <g transform="translate(${f1(e[0])},${f1(gy)})"><rect x="${f1(-s * 0.46)}" y="${f1(-s * 0.06)}" width="${f1(s * 0.92)}" height="${f1(s * 0.08)}" fill="#3a2a20"/><circle cx="${f1(-s * 0.16)}" cy="0" r="${f1(s * 0.13)}" fill="#7ad0e8" stroke="#c8a060" stroke-width="2"/><circle cx="${f1(s * 0.16)}" cy="0" r="${f1(s * 0.13)}" fill="#7ad0e8" stroke="#c8a060" stroke-width="2"/></g>`); }
  { const F = people('col_cobots');
    out('col_cobots', `${bg('sg-bg')}${linear('sg-dawn', [['0%', '#ffd59a', 0], ['100%', '#ffd59a', 0.75]])}<filter id="sg-sil" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 0.16  0 0 0 0 0.11  0 0 0 0 0.27  0 0 0 1 0"/></filter>`,
      `${rect('url(#sg-bg)')}${stars(12, 45)}<rect y="${H * 0.5}" width="${W}" height="${H * 0.5}" fill="url(#sg-dawn)"/><g filter="url(#sg-sil)">${F.g}</g>`); }
  { const F = people('col_boston_hexapods');
    out('col_boston_hexapods', bg('zw-bg'), `${rect('url(#zw-bg)')}${stars(8, 46)}${Array.from({ length: 6 }, (_, i) => `<rect x="24" y="${70 + i * 22}" width="${70 - (i % 3) * 14}" height="8" rx="3" fill="#9af0ff" opacity="0.5"/>`).join('')}${F.g}`); }
  { const F = people('col_vr_simulcasters');
    out('col_vr_simulcasters', `${bg('pr-bg')}${radial('pr-orb', [['0%', '#ffffff'], ['100%', '#9af0ff', 0]])}`,
      `${rect('url(#pr-bg)')}${stars(8, 47)}${F.g}<circle cx="150" cy="186" r="46" fill="url(#pr-orb)"/>`); }
}
