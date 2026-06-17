// Human-readable "server tag" labels for a solar-map node: what each marker /
// symbol on the node MEANS. Shared by the notes modal (js/game/browse.js) and
// the site popup (js/game/render.js) so both read the same vocabulary. Pure
// data: imports only the generated NODE_TAGS, no DOM.
import { NODE_TAGS } from './node-tags.js';

// `node` is a planner node ({ id2, type, flybyBoost }), or any object carrying
// at least id2. Season is intentionally NOT included here; both callers render
// the season as its own coloured chip. Returns marker labels in glyph order.
export function serverTagLabels(node) {
  const nt = node && node.id2 ? NODE_TAGS[node.id2] : null;
  const out = [];
  if (nt) {
    if (nt.lander) out.push(nt.half ? 'half-lander-burn' : 'lander-burn');
    if (nt.aerobrake) out.push('aero-break');
    if (nt.hazard) out.push('hazard');
  }
  if (node) {
    // The node TYPE itself. A plain or hazardous burn IS a burn (the pink
    // circle); a lander burn already reads as "lander-burn" above, so don't
    // double it up.
    if (node.type === 'burn' && !(nt && nt.lander)) out.push('burn');
    if (node.type === 'venus') out.push('venus flyby');
    else if (node.flybyBoost != null) out.push('flyby +' + (node.flybyBoost === 'thrust' ? 'T' : node.flybyBoost));
    if (node.type === 'radhaz') out.push('radiation');
  }
  return out;
}

// A short gameplay description for a server-tag label, for popup / notes
// tooltips so a player can learn what an unfamiliar glyph means. Talks about
// the game, never the implementation.
const TAG_INFO = {
  'burn': 'Burn point: spend fuel here to change your velocity.',
  'lander-burn': 'Lander burn: a powered landing touchdown.',
  'half-lander-burn': 'Half-lander burn: a shallow touchdown.',
  'aero-break': 'Aerobrake: shed velocity in the atmosphere (itself a hazard).',
  'hazard': 'Hazard: roll (or pay) to pass through safely.',
  'venus flyby': 'Venus flyby: swing past Venus for a boost (Blue season only).',
  'radiation': 'Radiation zone: rad-soft cards risk damage here.',
};
export function tagInfo(label) {
  if (TAG_INFO[label]) return TAG_INFO[label];
  if (label && label.startsWith('flyby')) return 'Flyby: a gravity assist grants free burns when you swing past.';
  if (label && label.endsWith('season')) return 'Seasonal space: only enterable during this phase of the Sunspot cycle.';
  return '';
}
