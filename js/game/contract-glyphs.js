// Module 4 (Exodus) card glyphs - MOCKUP, not wired into the game yet.
//
// Hand-authored SVG in the published-card language, for review before any of it
// is used by js/game/card-ui.js (CLAUDE.md: "Generating an SVG? Show a rendered
// screenshot first"). Each export returns an SVG string sized by `size`.
//
// Tooltips: the M4 reference card's text (augmentation meanings, contract
// abilities, promotion requirements) rides on the glyph as data-tip, per the
// user (2026-11-15): "connections, augments descriptions, and promo
// requirements can be shoved into tool tips for respective elements/icons".

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// --- Ideology pair hex (4A3g) ------------------------------------------------
// A flat-topped hex ring cut into six edge segments. Each contract deck is one
// ideology PAIR, drawn as two coloured segments with their letters, exactly
// where the printed card puts them: I + F upper-left + top, H + U upper-right +
// lower-right, E + A lower-left + bottom. Colour only, no letters (user
// 2026-11-15: "no letters needed, colors is clear enough"); the tooltip names
// the pair.
export const IDEOLOGY = {
  F: { name: 'Freedom', color: '#c01f6e', ink: '#fff' },
  I: { name: 'Individuality', color: '#8b9099', ink: '#fff' },
  H: { name: 'Honor', color: '#e8e6df', ink: '#111' },
  U: { name: 'Unity', color: '#e8b81e', ink: '#111' },
  E: { name: 'Equality', color: '#9fdcbc', ink: '#111' },
  A: { name: 'Authority', color: '#c9a6dc', ink: '#111' },
};
// edge index -> ideology letter (edge k runs from vertex k to k+1, vertex 0 at
// the right, angles clockwise because SVG y points down)
const EDGE_OF = { U: 0, A: 1, E: 2, I: 3, F: 4, H: 5 };
export function ideologyPairHex(pair, { size = 40 } = {}) {
  if (!pair) return '';
  const cx = 20, cy = 20, R = 19.4, r = 7.6;
  const v = (rad, k) => {
    const a = (Math.PI / 3) * k;
    return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
  };
  const segs = [];
  for (let k = 0; k < 6; k++) {
    const letter = Object.keys(EDGE_OF).find((L) => EDGE_OF[L] === k);
    const on = pair.includes(letter);
    const pts = [v(R, k), v(R, k + 1), v(r, k + 1), v(r, k)].map((p) => p.map((n) => n.toFixed(2)).join(',')).join(' ');
    const fill = on ? IDEOLOGY[letter].color : '#1d1d22';
    segs.push(`<polygon points="${pts}" fill="${fill}" stroke="#77777d" stroke-width="0.8"/>`);
  }
  const tip = `${IDEOLOGY[pair[0]].name} / ${IDEOLOGY[pair[1]].name} deck: auctioned when either ideology holds an Active Law.`;
  return `<svg class="m4-ideo-hex" data-tip="${esc(tip)}" width="${size}" height="${size}" viewBox="0 0 40 40" aria-label="${esc(tip)}">${segs.join('')}</svg>`;
}

// --- Augmentation (cybernetics) shapes (4C3) ---------------------------------
// The six white silhouettes. On a contract they are its CYBERNETICS icons; on
// an implanted colonist they are augmentations. Each shape has two meanings, one
// per side of the augmentation chit, taken from the M4 reference card.
export const AUGMENTS = {
  heart:   { name: 'Heart',   tip: 'Parenthood (4D5) / +1 delegate move during fundraise.' },
  jar:     { name: 'Jar',     tip: 'This Colonist is 0 Mass / FTs may be spent for FINAO.' },
  hexagon: { name: 'Hexagon', tip: 'Gain ISRU 1 Raygun / Gain ISRU 2 Buggy.' },
  splat:   { name: 'Splat',   tip: 'Factory is also Carbon / +1 Hydration.' },
  battery: { name: 'Battery', tip: 'On-board pulse generator / On-board exotic reactor.' },
  triangle:{ name: 'Triangle',tip: 'Site refuel yields +1 Isotope / Site refuel yields +2 Aqua.' },
};
const AUG_PATH = {
  heart: '<path d="M12 21.2C6.6 17.6 2.2 13.6 2.2 8.9 2.2 5.9 4.5 3.6 7.4 3.6c1.9 0 3.6 1 4.6 2.6 1-1.6 2.7-2.6 4.6-2.6 2.9 0 5.2 2.3 5.2 5.3 0 4.7-4.4 8.7-9.8 12.3z"/>',
  jar: '<path d="M8.2 2.4h7.6v3.1H8.2z"/><path d="M7.4 5.5h9.2c.6 0 1 .4 1 1v.8c1 .7 1.6 1.8 1.6 3V20c0 1-.8 1.8-1.8 1.8H6.6c-1 0-1.8-.8-1.8-1.8v-9.7c0-1.2.6-2.3 1.6-3v-.8c0-.6.4-1 1-1z"/>',
  triangle: '<path d="M12 3.2 21.6 20H2.4z" stroke-linejoin="round"/>',
  hexagon: '<path d="M7 3.6h10l5 8.4-5 8.4H7L2 12z" stroke-linejoin="round"/>',
  splat: '<path d="M12 2.4c1.3 0 2 1.4 3.2 1.3 1.4-.1 2.1-1.5 3.5-.9 1.3.6.7 2.3 1.6 3.3.9 1 2.6.7 3 2 .4 1.4-1.1 2.1-1 3.5.1 1.3 1.6 2 1.2 3.4-.4 1.3-2 1.2-2.7 2.2-.8 1.1-.3 2.7-1.5 3.4-1.2.7-2.4-.5-3.7-.3-1.3.2-2 1.8-3.4 1.6-1.4-.2-1.6-1.8-2.8-2.4-1.2-.6-2.9 0-3.6-1.2-.7-1.2.6-2.4.4-3.7-.2-1.3-1.8-2-1.5-3.4.3-1.4 2-1.4 2.6-2.6.6-1.2-.2-2.8.9-3.6 1.1-.8 2.5.2 3.8-.2C10 3.6 10.7 2.4 12 2.4z"/>',
  battery: '<path d="M2.6 7.4h18.8v12.4H2.6z"/><path d="M5.4 4.2h4.2v3.2H5.4zM14.4 4.2h4.2v3.2h-4.2z"/>',
};
export function augmentGlyph(shape, { size = 20, dark = true } = {}) {
  const a = AUGMENTS[shape];
  if (!a) return '';
  const fill = dark ? '#fff' : '#fff';
  return `<svg class="m4-aug" data-tip="${esc(`${a.name} augmentation: ${a.tip} (Needs a Colocated implanted Colonist.)`)}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="#111" stroke-width="1.3">${AUG_PATH[shape]}</svg>`;
}

// --- Title-bar icons ----------------------------------------------------------
// Top hat (4B2e): the stack carrying this contract enters 1 Hazard per Turn
// without paying FINAO. Mask: an avatar / Felony contract (4B2d / 4B2e).
export function tophatGlyph({ size = 22 } = {}) {
  return `<svg class="m4-title-icon" data-tip="Top hat: a Stack carrying this contract safely enters 1 Hazard per Turn without paying FINAO (the trillionaire pays)." width="${size}" height="${size}" viewBox="0 0 24 24" fill="#fff"><path d="M7 3.5h10l-.6 13.2H7.6z"/><path d="M2.5 17.2c2.6 1.6 6 2.3 9.5 2.3s6.9-.7 9.5-2.3v1.6c-2.6 1.8-6 2.6-9.5 2.6s-6.9-.8-9.5-2.6z"/><rect x="7.4" y="13.2" width="9.2" height="1.6" fill="#2b2b2f"/></svg>`;
}
export function maskGlyph({ size = 22 } = {}) {
  return `<svg class="m4-title-icon" data-tip="Felony: this stack may commit Felonies (as Felonious). Lost on default." width="${size}" height="${size}" viewBox="0 0 24 24" fill="#fff"><path d="M2 8.5c3-1.7 6.5-1.6 10 .2 3.5-1.8 7-1.9 10-.2.2 3.8-1.3 7-4.6 7-2.4 0-3.6-1.8-5.4-1.8S9 15.5 6.6 15.5C3.3 15.5 1.8 12.3 2 8.5z"/><ellipse cx="7.4" cy="10.9" rx="2.2" ry="1.4" fill="#2b2b2f"/><ellipse cx="16.6" cy="10.9" rx="2.2" ry="1.4" fill="#2b2b2f"/></svg>`;
}

// --- Bottom badges ------------------------------------------------------------
// Late fee: the alarm-clock timepiece (4B5). Advance: the blue Aqua droplet
// paid up front (4A3h). VP: the printed VP box (4E2a).
export function lateFeeBadge(n, { size = 26 } = {}) {
  return `<svg class="m4-latefee" data-tip="Late fee: once your timepiece is passed, pay ${n} Aqua each Turn until fulfilled or repaid, or default." width="${size}" height="${size}" viewBox="0 0 28 28"><rect x="1" y="1" width="26" height="26" rx="5" fill="#111"/><path d="M5.6 6.8 8.8 4M22.4 6.8 19.2 4" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="14" cy="15" r="8.6" fill="#fff"/><circle cx="14" cy="15" r="7" fill="#111"/><path d="M9 23.8 7.6 25.6M19 23.8l1.4 1.8" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/><text x="14" y="18.6" text-anchor="middle" font-size="10" font-weight="800" font-family="Inter,system-ui,sans-serif" fill="#fff">${n}</text></svg>`;
}
export function advanceBadge(n, { size = 26 } = {}) {
  return `<svg class="m4-advance" data-tip="Cash advance: win the auction and take ${n} Aqua from the Pool up front." width="${size}" height="${Math.round(size * 1.18)}" viewBox="0 0 26 31"><path d="M13 1.5C9 8 3.5 13.4 3.5 19.6a9.5 9.5 0 0 0 19 0C22.5 13.4 17 8 13 1.5z" fill="#2f8fd6" stroke="#fff" stroke-width="1.6"/><text x="13" y="24" text-anchor="middle" font-size="${String(n).length > 1 ? 10 : 11}" font-weight="800" font-family="Inter,system-ui,sans-serif" fill="#fff">${n}</text></svg>`;
}
export function vpBadge(n, { size = 30 } = {}) {
  return `<svg class="m4-vp" data-tip="${n} VP when fulfilled." width="${size}" height="${size}" viewBox="0 0 30 30"><rect x="1" y="1" width="28" height="28" rx="6" fill="#111" stroke="#cfcfd4" stroke-width="1.4"/><text x="12" y="22" text-anchor="middle" font-size="18" font-weight="800" font-family="Inter,system-ui,sans-serif" fill="#fff">${n}</text><text x="23.5" y="13" text-anchor="middle" font-size="7.5" font-weight="800" font-family="Inter,system-ui,sans-serif" fill="#fff">V</text><text x="23.5" y="21" text-anchor="middle" font-size="7.5" font-weight="800" font-family="Inter,system-ui,sans-serif" fill="#fff">P</text></svg>`;
}
// Humans on board (manned, 4B2d): the yellow warning triangle.
export function mannedGlyph({ size = 22 } = {}) {
  return `<svg class="m4-manned" data-tip="Manned contract: a Human rides with it. Decommissioning it involuntarily is a default; discarding it voluntarily is a Felony. No bids while you hold the default chit." width="${size}" height="${size}" viewBox="0 0 24 24"><path d="M12 2.2 22.6 21H1.4z" fill="#f5c400" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/><circle cx="9.4" cy="11.4" r="1.7" fill="#111"/><path d="M7.3 18.6v-3.8c0-1.2.9-2 2.1-2s2.1.8 2.1 2v3.8z" fill="#111"/><circle cx="14.8" cy="11.9" r="1.4" fill="#111"/><path d="M13.1 18.6v-3.2c0-1 .7-1.7 1.7-1.7s1.7.7 1.7 1.7v3.2z" fill="#111"/></svg>`;
}

// --- Contract abilities (4B2f) for tooltips ------------------------------------
// The reference card's one-liners, keyed by the keyword printed on a card.
export const CONTRACT_ABILITIES = {
  Bailout: 'Immune to budget cuts. Negotiable.',
  Connections: 'During fundraise, select any contract deck where you have a corresponding delegate.',
  Insight: 'When performing a research auction, you may cycle 1 patent deck before auctioning.',
  Secured: 'During Anarchy, retain your faction privilege; immune to Felonies but may still commit them.',
  Shielded: '-2 to Belt and CME Rolls (cumulative with multiple copies of this Ability).',
  Transport: 'Cargo transfer along a buggy road, or between a Bernal and its Dirtside (1/turn).',
};
// Promotion requirements (4C7), for the promote-button tooltip later.
export const PROMOTION_AUGMENTS = {
  colonist: 'Colonist: 1 augmentation (on the Colonist being promoted).',
  freighter: 'Freighter: 2 augmentations.',
  bernal: 'Bernal: 3 augmentations.',
  gwThruster: 'GW Thruster: 4 augmentations, at least 1 from a Gold-Side contract.',
};
// Wrap any printed ability keyword in a tooltip span.
export function abilityHtml(text) {
  let out = esc(text || '');
  for (const [k, tip] of Object.entries(CONTRACT_ABILITIES)) {
    out = out.replace(new RegExp(`\\b${k}\\b`, 'g'), `<span class="m4-kw" data-tip="${esc(`${k}: ${tip}`)}">${k}</span>`);
  }
  return out;
}

// The Spaceborn icon: a curled infant on a white disc, ringed by an orbit with
// a small moon ("born in space"), printed beside the thrust triangle on both
// faces of every human Spaceborn colonist. Mockup-only until signed off; the
// game's card renderer does not draw it yet.
export function spacebornGlyph({ size = 24 } = {}) {
  return `<span class="m4-spaceborn" data-tip="Spaceborn: a colonist born and raised in space.">
<svg viewBox="0 0 28 28" width="${size}" height="${size}" aria-hidden="true">
  <ellipse cx="13" cy="15" rx="13" ry="4.2" transform="rotate(-28 13 15)" fill="none" stroke="#111" stroke-width="3"/>
  <circle cx="13" cy="15" r="10" fill="#fff" stroke="#111" stroke-width="1.6"/>
  <circle cx="11.2" cy="10.6" r="3" fill="#111"/>
  <path d="M13.4 12.6 C 17.2 13, 18.2 17.6, 15.2 19.6 C 12.2 21.6, 8 20, 7.8 16.6 C 7.6 14.6, 8.8 13.2, 10 13.2 C 10.6 14.8, 12 15.2, 13.4 12.6 Z" fill="#111"/>
  <path d="M17.8 9.6 A 13 4.2 -28 0 1 24.8 9.3" fill="none" stroke="#fff" stroke-width="1.4"/>
  <ellipse cx="13" cy="15" rx="13" ry="4.2" transform="rotate(-28 13 15)" fill="none" stroke="#fff" stroke-width="1.2" stroke-dasharray="0 17 22 100"/>
  <circle cx="23.6" cy="5.2" r="2.6" fill="#fff" stroke="#111" stroke-width="1.3"/>
</svg></span>`;
}

// The M4 timepiece (4A2, 4B3h): an alarm clock in the owner's seat colour, the
// marker a player sets on the Sunspot Cycle to bid on a contract and that sits
// at the contract's deadline. Same alarm-clock silhouette as the late-fee badge
// (bells, face, legs), so a table player reads it as the same token. Returns an
// SVG <g> centred on (0,0) for use inside the Sunspot dial; `ghost` draws the
// unplaced draft (dashed, see-through), `deadbeat` the flipped late side.
export function timepieceDialGlyph({ color = '#e5e7eb', size = 26, ghost = false, deadbeat = false } = {}) {
  const k = size / 28;
  const ink = '#111';
  const op = ghost ? ' opacity="0.55"' : '';
  const dash = ghost ? ' stroke-dasharray="2.5 2"' : '';
  const face = deadbeat ? '#c23b30' : '#fff';
  const hands = deadbeat
    ? `<path d="M-3.6 -3.6 3.6 3.6M3.6 -3.6 -3.6 3.6" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>`
    : `<path d="M0 0V-5.4M0 0 3.8 2.2" stroke="${ink}" stroke-width="2" stroke-linecap="round"/><circle r="1.3" fill="${ink}"/>`;
  return `<g class="m4-timepiece" transform="scale(${k.toFixed(3)})"${op}>`
    + `<path d="M-6.5 9.6-8.6 12.6M6.5 9.6 8.6 12.6" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>`
    + `<path d="M-6.5 9.6-8.6 12.6M6.5 9.6 8.6 12.6" stroke="${color}" stroke-width="1.6" stroke-linecap="round"/>`
    + `<path d="M-11.6-6.2a5.4 5.4 0 0 1 7.6-6.4zM11.6-6.2a5.4 5.4 0 0 0-7.6-6.4z" fill="${color}" stroke="${ink}" stroke-width="1.2"${dash}/>`
    + `<circle r="10.6" fill="${color}" stroke="${ink}" stroke-width="1.4"${dash}/>`
    + `<circle r="7.6" fill="${face}" stroke="${ink}" stroke-width="0.8"/>`
    + hands
    + '</g>';
}
