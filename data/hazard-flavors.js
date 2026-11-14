// The printed FLAVOUR of a map Hazard: the word the board prints beside the
// skull / parachute (e.g. "electric geysers" by Enceladus, "F ring" by
// Prometheus, "chaotic spin" by Hyperion, "winds" by the Neptune aerostat).
// The engine's hazardKind only knows rad / aero / skull; a few rules care which
// hazard it is. Today that is POWER SERIES CHAOS MODEL (Heliocentricity promo
// crew): "Immune to Hazards mentioning geysers, rings, spin, and winds."
//
// Keyed by the planner node id2 (the SERVER slug, the same key data/node-tags.js
// uses). Transcribed from the outer solar system map sheet
// (reference/HF4-outer-solar-system-maps.pdf): each Hazard node beside a label
// naming one of the four words. The inner-system sheet is not checked in, so an
// inner hazard that mentions winds (if any) is not listed yet. Pure data: no DOM,
// no node: imports.
export const HAZARD_FLAVORS = {
  // geysers
  'lag-qeogw': 'geysers',   // Enceladus, "electric geysers"
  'burn-0ktq5': 'geysers',  // Triton, "nitrogen geyser"
  'lag-mdelw': 'geysers',   // Triton, "nitrogen geyser"
  'lag-wx5rf': 'geysers',   // Triton Mahilani Plume, "nitrogen geyser"
  'burn-bh269': 'geysers',  // Io, "sulfur geyser"
  'burn-jis7t': 'geysers',  // Europa, "geyser"
  // rings
  'lag-cfzlh': 'rings',     // Prometheus / Pandora, "F ring"
  'lag-tphnu': 'rings',     // Janus / Epimetheus, Saturn "ring crossing"
  'burn-opo7v': 'rings',    // Rhea, "debris ring"
  'lag-4b5ej': 'rings',     // Larissa / Galatea, Neptune "ring crossing"
  'lag-8cwyu': 'rings',     // Larissa / Galatea, Neptune "ring crossing"
  'lag-f1v9f': 'rings',     // Chariklo, "ring crossing"
  'lag-lqd3p': 'rings',     // Haumea moons, "ring"
  // spin
  'lag-j9xww': 'spin',      // Hyperion, "chaotic spin"
  'lag-xrng4': 'spin',      // Nereid, "chaotic spin"
  'burn-b2645': 'spin',     // Haumea, "rapid spin"
  'lag-liadb': 'spin',      // Uranian irregulars (Sycorax / Prospero), "rapid spin"
  // winds
  'lag-e9ydu': 'winds',     // Neptune aerostat aerobrake, "winds"
};

export function hazardFlavorOf(slug) {
  return HAZARD_FLAVORS[String(slug)] || null;
}
