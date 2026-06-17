// Classify a planner site by its NAME into a body category (comet / gas-giant /
// inner-planet / dwarf / moon / asteroid). Shared so the client renderer
// (js/game/planner-map.js) and the server (the admin site-tags node list) agree
// on a node's type - the same reason makeRefId is shared in planner-ids.js.
// Pure: no DOM, no node imports.
const GAS_GIANT_KEYS = ['jupiter', 'saturn', 'uranus', 'neptune'];
const INNER_PLANET_KEYS = ['mercury', 'venus', 'earth', 'mars', 'luna'];
const DWARF_KEYS = [
  'pluto', 'ceres', 'eris', 'sedna', 'makemake',
  'haumea', 'orcus', 'quaoar', 'gonggong',
];
const MOON_KEYS = [
  'luna', 'phobos', 'deimos',
  'io ', 'europa', 'ganymede', 'callisto',
  'titan', 'enceladus', 'iapetus', 'rhea', 'mimas',
  'hyperion', 'dione', 'tethys', 'phoebe',
  'charon', 'nix', 'hydra',
  'miranda', 'ariel', 'umbriel', 'titania', 'oberon',
  'triton', 'nereid', 'proteus',
];

export function classifyBody(name) {
  const n = (name || '').toLowerCase();
  if (!n) return 'site';
  if (n.startsWith('comet')) return 'comet';
  for (const k of GAS_GIANT_KEYS)  if (n.startsWith(k)) return 'gas-giant';
  for (const k of INNER_PLANET_KEYS) if (n.startsWith(k)) return 'inner-planet';
  for (const k of DWARF_KEYS)  if (n.includes(k))  return 'dwarf';
  for (const k of MOON_KEYS)   if (n.includes(k))  return 'moon';
  return 'asteroid';
}
