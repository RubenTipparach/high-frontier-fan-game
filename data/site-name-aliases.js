// Misspelled / alternate site names in the vendored planner JSON
// (vendor/hf-mission-planner/assets/data-hf4.json) that don't match their
// data/sites.js entry (or the site-flags.json row) by name. Maps the planner's
// NORMALISED name (normalizeSiteName output) to the canonical normalised name.
//
// Shared so BOTH the client (js/game/planner-map.js) and the server
// (server/game/planner-graph.js) attach the SAME curated metadata - solarZone,
// vps, class, hydration - to these nodes. Without it they resolved to a null
// solarZone (so no glory chit could ever be claimed there) on the client and a
// geometry-guessed zone on the server, so the two disagreed on which zone the
// site sits in. (User 2026-07-19: couldn't claim the glory chit at Echedus,
// which is Echelus - a Saturn-zone site the planner spells "Echedus".)
//
// The planner NAME itself is NOT changed: makeRefId slugs the raw name into the
// node's load-bearing id2 (the key player annotations / node tags live under),
// so only the sites.js / flag-table LOOKUP is aliased, never the id2.
export const SITE_NAME_ALIASES = {
  'triton tuenela plantia': 'triton tuonela planitia',
  'comet bartley 2': 'comet hartley 2',
  'phaethon': 'comet phaethon',
  'teharoniawako': 'teharonhiawako',
  'echedus': 'echelus',
  'ultima thule': 'arrokoth',
};

// Repair a normalised planner name to its canonical normalised name for a
// sites.js / flag-table lookup. Pass-through when there is no alias.
export function aliasSiteName(norm) {
  return (norm && SITE_NAME_ALIASES[norm]) || norm;
}
