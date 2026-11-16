// The printed FLAVOUR of a map Hazard, read off the caption the board prints
// beside it (data/map-labels.js#NODE_LABELS, transcribed from the published
// board: "electric geysers", "F ring spokes", "chaotic spin", "winds", ...).
// The engine's hazardKind only knows rad / aero / skull; a few rules care which
// hazard it is. Today that is POWER SERIES CHAOS MODEL (Heliocentricity promo
// crew): "Immune to Hazards mentioning geysers, rings, spin, and winds."
//
// Only Hazards count (skull and aerobrake spaces). Radiation Belts are a
// separate rule (the Belt Roll), so a belt captioned "dust ring" is not a
// Hazard that mentions rings. Pure data: no DOM, no node: imports.
import { NODE_LABELS, NODE_LABEL_KINDS } from './map-labels.js';

// Word stems the card names, matched as whole-word starts in the caption, so
// "ring crossing", "F ring spokes", "nitrogen geyser", "rapid spin" and
// "winds" all match, but "springs" or "Bering" would not.
const FLAVOR_WORDS = [
  ['geysers', /\bgeysers?\b/i],
  ['rings', /\brings?\b/i],
  ['spin', /\bspin\b/i],
  ['winds', /\bwinds?\b/i],
];

function flavorOfCaption(caption) {
  for (const [flavor, re] of FLAVOR_WORDS) if (re.test(caption)) return flavor;
  return null;
}

export const HAZARD_FLAVORS = Object.fromEntries(
  Object.entries(NODE_LABELS)
    .filter(([slug]) => {
      const k = NODE_LABEL_KINDS[slug] || [];
      return k.includes('skull') || k.includes('aero');
    })
    .map(([slug, caption]) => [slug, flavorOfCaption(caption)])
    .filter(([, flavor]) => !!flavor),
);

export function hazardFlavorOf(slug) {
  return HAZARD_FLAVORS[String(slug)] || null;
}

// Hazard Ignore contract ability (M4 4B2f): "Ignore Crash Hazards of the type
// listed. Text in quotes means that Crash Hazards with that text in their
// description are ignored." Does the board caption beside this Hazard mention
// any of `words` (whole-word start, so "ring" matches "ring rain" and "rings")?
// `kinds` picks Crash Hazards (skull) or Aerobrake Hazards (aero).
export function hazardCaptionMentions(slug, words, kinds = ['skull']) {
  if (!words || !words.length) return false;
  const k = NODE_LABEL_KINDS[String(slug)] || [];
  if (!kinds.some((x) => k.includes(x))) return false;
  const caption = NODE_LABELS[String(slug)];
  if (!caption) return false;
  return words.some((w) => new RegExp(`\\b${String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(caption));
}
