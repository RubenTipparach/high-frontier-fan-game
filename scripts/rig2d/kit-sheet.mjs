// Build a character kit sheet (the "constructor" layout): the character at rest,
// the exploded parts, head expressions, hand set, arm poses and posed examples.
//   node scripts/rig2d/kit-sheet.mjs [figureLook.json] [out.svg]
// With no look file it writes the default female and male kits.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { drawCutout, drawHead, drawHand, restPose, POSES, OPTIONS, DEFAULT_LOOK } from './cutout.mjs';

export function kitSheet(look, { bg = '#b8a79e', panel = '#c9bab2' } = {}) {
  const W = 1500, H = 1000, L = { ...DEFAULT_LOOK, ...look };
  const box = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${panel}" stroke="#8d7c74" stroke-dasharray="6 5" stroke-width="1.5"/>`;
  let s = '';
  // 1. rest figure
  s += box(30, 30, 260, 700);
  s += drawCutout({ id: 'rest', look: L, pose: restPose(160, 690, 98) });
  // 2. exploded parts
  s += box(310, 30, 300, 700);
  s += drawCutout({ id: 'expl', look: L, pose: restPose(460, 615, 80), explode: 1 });
  // 3. head expressions
  s += box(630, 30, 840, 190);
  OPTIONS.face.forEach((f, i) => { s += drawHead({ id: `f${i}`, look: { ...L, face: f }, x: 690 + i * 90, y: 130, size: 120 }); });
  // 4. hair swaps
  s += box(630, 240, 840, 180);
  OPTIONS.hairStyle.forEach((h, i) => { s += drawHead({ id: `hs${i}`, look: { ...L, hairStyle: h }, x: 700 + i * 102, y: 335, size: 112 }); });
  // 5. hands
  s += box(30, 750, 600, 220);
  OPTIONS.hand.forEach((k, i) => { s += drawHand({ id: `hd${i}`, kind: k, skin: L.skin, x: 80 + i * 84, y: 795, size: 300 }); });
  // 6. posed examples
  s += box(650, 440, 820, 530);
  const poses = ['wave', 'point', 'hipsHands', 'cheer', 'think', 'shrug'];
  poses.forEach((p, i) => {
    const pose = { ...restPose(735 + i * 130, 945, 70), rot: POSES[p] };
    const hands = p === 'point' ? { L: 'point', R: 'relaxed' } : p === 'wave' ? { L: 'relaxed', R: 'open' } : p === 'hipsHands' ? { L: 'fist', R: 'fist' } : p === 'cheer' ? { L: 'fist', R: 'fist' } : p === 'think' ? { L: 'fist', R: 'point' } : p === 'shrug' ? { L: 'open', R: 'open' } : L.hands;
    const face = { wave: 'grin', point: 'smile', hipsHands: 'smirk', cheer: 'shout', think: 'sleepy', shrug: 'neutral' }[p];
    s += drawCutout({ id: `p${i}`, look: { ...L, hands, face }, pose });
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${bg}"/>${s}</svg>`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [lookFile, out] = process.argv.slice(2);
  if (lookFile) {
    const look = JSON.parse(readFileSync(lookFile, 'utf8'));
    mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, kitSheet(look.look || look));
  } else {
    mkdirSync('docs/design/kits', { recursive: true });
    writeFileSync('docs/design/kits/kit-female.svg', kitSheet({ body: 'female', hairStyle: 'bob' }));
    writeFileSync('docs/design/kits/kit-male.svg', kitSheet({ body: 'male', hairStyle: 'tuft', skin: '#f3c6a2', face: 'smile' }));
  }
  console.log('kit sheets written');
}
