// Module 4 contract card renderer - MOCKUP (docs/mockups/m4/index.html).
// Draws a contract face in the game's card language (css/cards.css: typebar,
// name row, stats, body, footer) from one face of a data/card-data.js
// Contracts / Exodus Contracts row. Not wired into js/game/card-ui.js until the
// glyphs and layout are signed off.
import {
  ideologyPairHex, augmentGlyph, tophatGlyph, maskGlyph,
  lateFeeBadge, advanceBadge, vpBadge, mannedGlyph, abilityHtml,
} from './glyphs.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');

// Inline [bracket] glyphs from the transcription -> readable tokens.
const BODY = {
  Sun: '☉', Mercury: '☿', Venus: '♀', Earth: '⊕', Moon: '☾', Mars: '♂',
  Ceres: '⚳', Jupiter: '♃', Saturn: '♄', Uranus: '♅', Neptune: '♆', Pluto: '♇',
};
function richText(s) {
  return abilityHtml(s || '')
    .replace(/\[(Sun|Mercury|Venus|Earth|Moon|Mars|Ceres|Jupiter|Saturn|Uranus|Neptune|Pluto)\]/g,
      (_, b) => `<span class="m4-body-glyph" data-tip="${b}">${BODY[b]}</span>`)
    .replace(/\[hex ([A-Z])\]/g, (_, l) => `<span class="m4-hexchip">${l}</span>`)
    .replace(/\[([^\]]+)\]/g, (_, d) => {
      // A green-ringed hazard icon on a card means "this Hazard type no longer
      // rolls for you": drawn in the map's own hazard glyphs.
      const sym = /skull|hazard/i.test(d) ? '☠' : /aerobrake/i.test(d) ? '\u{1FA82}'
        : /air-eater/i.test(d) ? '\u{1F32C}' : /synodic|comet/i.test(d) ? '☄' : null;
      return sym ? `<span class="m4-immune" data-tip="${esc(d)}">${sym}</span>`
        : `<span class="m4-inline-icon" data-tip="${esc(d)}">◉</span>`;
    })
    .replace(/Season (Red|Yellow|Blue)/g, (m, c) => `<span class="m4-season m4-season-${c.toLowerCase()}">${m}</span>`);
}

// Card art, the procedural-SVG way the patent art is made (scripts/
// gen-card-art.mjs): a deterministic little scene from the destination, not a
// copy of the printed illustration.
function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function sceneSvg(face) {
  const d = `${face.Destination || ''} ${face.Name}`;
  const h = hash(face.Code || face.Name);
  const rnd = (i) => ((h >> (i % 24)) & 255) / 255;
  const pick = [
    [/Mars|Phobos|Deimos/i, ['#c1440e', '#7a2a0c'], 'planet'],
    [/Venus/i, ['#e9c46a', '#b07d2c'], 'planet'],
    [/Jupiter|Io|Ganymede|Europa|Callisto/i, ['#d9a066', '#8a5a3a'], 'banded'],
    [/Saturn|Titan|Rhea|ring/i, ['#e6cf8b', '#9c8250'], 'ringed'],
    [/Uranus|Miranda|Sycorax|Cordelia/i, ['#9ad7e0', '#4c8f9c'], 'planet'],
    [/Neptune|Triton|Pluto|Charon|Quaoar|Arrokoth|2002 TX|Larissa/i, ['#4f7cff', '#1f3a8f'], 'planet'],
    [/Mercury|Icarus|Phaethon/i, ['#9c9c9c', '#4d4d4d'], 'planet'],
    [/Luna|Moon/i, ['#cfcfcf', '#6e6e6e'], 'planet'],
    [/Comet|Crommelin|Holmes|Kreutz/i, ['#bfe6ff', '#4a7c99'], 'comet'],
    [/Bernal|Lagrange|LEO|Isobank/i, ['#b9c0cc', '#5a6270'], 'station'],
    [/Sun|Solar|Oberth/i, ['#ffb347', '#d2481a'], 'sun'],
  ].find(([re]) => re.test(d)) || [null, ['#8d7f6e', '#3f382f'], 'rock'];
  const [, [c1, c2], kind] = pick;
  const stars = Array.from({ length: 26 }, (_, i) => {
    const x = (hash(`${h}x${i}`) % 300), y = (hash(`${h}y${i}`) % 200), r = 0.4 + (hash(`${h}r${i}`) % 10) / 12;
    return `<circle cx="${x}" cy="${y}" r="${r.toFixed(2)}" fill="#fff" opacity="${(0.35 + (i % 5) / 8).toFixed(2)}"/>`;
  }).join('');
  const cx = 150 + (rnd(3) - 0.5) * 90, cy = 120 + (rnd(7) - 0.5) * 40, R = 46 + rnd(11) * 26;
  let body = '';
  if (kind === 'sun') body = `<circle cx="${cx}" cy="${cy}" r="${R + 30}" fill="url(#g)" opacity=".35"/><circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#g)"/>`;
  else if (kind === 'comet') body = `<path d="M${cx} ${cy} L${cx + 160} ${cy - 70} L${cx + 160} ${cy - 30} Z" fill="${c1}" opacity=".35"/><circle cx="${cx}" cy="${cy}" r="9" fill="${c1}"/>`;
  else if (kind === 'station') body = `<g transform="translate(${cx} ${cy}) rotate(${Math.round(rnd(5) * 50 - 25)})"><rect x="-70" y="-5" width="140" height="10" rx="3" fill="${c1}"/><circle r="26" fill="none" stroke="${c1}" stroke-width="7"/><rect x="-96" y="-18" width="22" height="36" fill="#3b6aa8" stroke="${c1}"/><rect x="74" y="-18" width="22" height="36" fill="#3b6aa8" stroke="${c1}"/></g>`;
  else if (kind === 'rock') body = `<path d="M${cx - R} ${cy} q${R * 0.3} -${R} ${R} -${R * 0.8} t${R} ${R * 0.6} t-${R * 0.4} ${R} t-${R * 1.4} -${R * 0.2} z" fill="url(#g)"/>`;
  else {
    body = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#g)"/>`;
    if (kind === 'banded') body += [0.3, 0.5, 0.72].map((t) => `<rect x="${cx - R}" y="${cy - R + 2 * R * t}" width="${2 * R}" height="${R * 0.12}" fill="${c2}" opacity=".45" clip-path="url(#pc)"/>`).join('');
    if (kind === 'ringed') body = `<ellipse cx="${cx}" cy="${cy}" rx="${R * 1.9}" ry="${R * 0.42}" fill="none" stroke="${c1}" stroke-width="5" opacity=".75"/>` + body;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200" preserveAspectRatio="xMidYMid slice"><defs><radialGradient id="g" cx="35%" cy="35%" r="70%"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></radialGradient><clipPath id="pc"><circle cx="${cx}" cy="${cy}" r="${R}"/></clipPath></defs><rect width="300" height="200" fill="#07070d"/>${stars}${body}</svg>`;
}

const SIDE_LABEL = { blue: 'Blue side', gold: 'Gold side', exodus: 'Project Exodus' };

export function renderContractFace(face) {
  const side = face.Side;
  const el = document.createElement('div');
  el.className = `card m4-contract side-${side}`;
  const icon = face['Title Icon'] === 'tophat' ? tophatGlyph() : face['Title Icon'] === 'mask' ? maskGlyph() : '';
  const cyb = String(face.Cybernetics || '').split(',').map((s) => s.trim()).filter(Boolean)
    .map((s) => augmentGlyph(s)).join('');
  // The Blender render of the destination (scripts/card-art/blender/
  // render_contracts.py), over the procedural scene as a fallback while a face
  // has no render yet.
  const art = `url("../../../assets/cards/contracts/${face.Code}-3d.webp"), `
    + `url("data:image/svg+xml;utf8,${encodeURIComponent(sceneSvg(face))}")`;
  el.innerHTML = `
    <div class="card-inner"><div class="card-face">
      <div class="card-typebar m4-typebar">
        <span class="m4-title-left">${icon}</span>
        <span class="m4-type">${esc(String(face['Contract Type']).replace(/ Contract$/, ''))}<small>Contract</small></span>
        <span class="m4-title-right">${ideologyPairHex(face['Ideology Pair'])}</span>
      </div>
      <div class="card-name-row"><span class="card-name">${esc(face.Name)}</span></div>
      <div class="m4-stats">
        <span class="m4-stat"><strong>${face.Mass}</strong> MASS</span>
        <span class="m4-stat"><strong>${face['Rad-Hard']}</strong> RAD</span>
        <span class="m4-cyb" data-tip="Cybernetics: the augmentation shapes this contract adds to your portfolio once fulfilled.">${cyb}</span>
        ${vpBadge(face.VP)}
      </div>
      <div class="card-body m4-body" style='background-image:${art}'>
        <div class="m4-box m4-dest"><b>Destination</b>${richText(face.Destination)}</div>
        ${face['Fulfilled Ability'] ? `<div class="m4-box m4-ability"><b>Fulfilled ability</b>${richText(face['Fulfilled Ability'])}</div>` : ''}
        ${face['When Fulfilling'] ? `<div class="m4-box m4-when"><b>When fulfilling</b>${richText(face['When Fulfilling'])}</div>` : ''}
      </div>
      <div class="m4-money">
        <span class="m4-pay">${lateFeeBadge(face['Late Fee'])}<span>Late fee</span></span>
        ${face.Manned ? mannedGlyph() : '<span></span>'}
        <span class="m4-pay">${advanceBadge(face.Advance)}<span>Advance</span></span>
      </div>
      <div class="card-footer m4-footer"><span>${SIDE_LABEL[side] || side}</span><code>${esc(face.Code)}</code></div>
    </div></div>`;
  return el;
}
