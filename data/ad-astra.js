// Ad Astra exits + gravitational sunlenses (Module 2 Futures locations).
//
// The published map prints three interstellar EXITS (Jupiter-Sol-Jupiter,
// Sol Exit Neptune, Sol Exit Oort) and two SUNLENS spots (neutrino / EM) at
// the outer map edge. The vendor planner data carries no nodes for them, so
// this implementation models each as a ZONE-EDGE location: a stack standing
// anywhere in the named heliocentric zone (its outermost band) qualifies as
// having reached that exit / lens. When map-edge nodes land in the planner
// data later, swap the zone fields for real slugs here - every reader goes
// through this table.
//
// Pure data (imported by data/future-goals.js and both sides); the caller
// supplies zone lookups.

export const AD_ASTRA_EXITS = [
  { key: 'jupiter-sol-jupiter', name: 'Jupiter-Sol-Jupiter Exit', zones: ['Jupiter'] },
  { key: 'sol-exit-neptune', name: 'Sol Exit Neptune', zones: ['Neptune'] },
  { key: 'sol-exit-oort', name: 'Sol Exit Oort', zones: ['Neptune'] },
];

export const SUNLENSES = [
  { key: 'neutrino-sunlens', name: 'Neutrino Sunlens', zones: ['Jupiter', 'Saturn'], vp: 6 },
  { key: 'em-sunlens', name: 'EM Sunlens', zones: ['Uranus', 'Neptune'], vp: 11 },
];

// Zones that count as "at an Ad Astra exit" for any of the three exits.
export const AD_ASTRA_ZONES = [...new Set(AD_ASTRA_EXITS.flatMap((e) => e.zones))];

// The sunlens a unit standing in `zone` has reached (the more valuable EM
// lens wins when both match), or null.
export function sunlensForZone(zone) {
  if (!zone) return null;
  const em = SUNLENSES.find((s) => s.key === 'em-sunlens');
  if (em.zones.includes(zone)) return em;
  const nu = SUNLENSES.find((s) => s.key === 'neutrino-sunlens');
  if (nu.zones.includes(zone)) return nu;
  return null;
}
