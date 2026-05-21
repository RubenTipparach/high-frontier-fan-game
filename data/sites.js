// Solar system sites for the delta-v map.
//
// Every site is a node on the delta-v graph; movement consumes one
// "burn" per edge weight, scaled by the active thruster's ISP. The
// layout is delta-v-from-LEO along the X axis so a site further right
// is genuinely harder to reach, and the Y axis spreads moons and
// neighbors so the graph doesn't collide visually.
//
// Fields:
//   id           stable string key, used in the engine's edge graph
//   name         display label
//   body         parent body (used to group factories for habitats)
//   type         planet | moon | asteroid | dwarf | tno | lagrange |
//                orbit | surface
//   class        prospect difficulty A (easy) -> D (hard)
//                S = special (no roll, auto-success on arrival)
//                or '' for orbits / lagrange points (not prospectable)
//   hydration    0..3, refinery yield per income phase once
//                industrialised. 0 = bone dry, 3 = comet-grade ice
//   vps          base victory points when prospected
//   surface      true if a lander can touch down (and a robonaut
//                can roll a prospect die there)
//   x, y         SVG coords for the renderer (viewBox 0 0 1400 900)
//   blurb        one-line flavor for the tooltip
//
// All values are reasonable approximations chosen for playability,
// not copied from any published game. Real-body data sources: NASA
// fact sheets, NSSDC, and the Mars/Jupiter/Saturn moon catalogs.

export const SITES = [
  // ----- Earth-Moon system -----
  { id: 'leo',         name: 'Low Earth Orbit',  body: 'earth',  type: 'orbit',    class: '',  hydration: 0, vps: 0, surface: false, x:  80, y: 440, blurb: 'Your launch point. Free to enter, expensive to leave.' },
  { id: 'gto',         name: 'Geostationary',    body: 'earth',  type: 'orbit',    class: '',  hydration: 0, vps: 0, surface: false, x: 130, y: 380, blurb: '36,000 km orbit. Useful relay point.' },
  { id: 'l1',          name: 'Earth-Moon L1',    body: 'earth',  type: 'lagrange', class: '',  hydration: 0, vps: 0, surface: false, x: 200, y: 360, blurb: 'Saddle point between Earth and the Moon.' },
  { id: 'moon',        name: 'Luna',             body: 'moon',   type: 'moon',     class: 'C', hydration: 0, vps: 1, surface: true,  x: 260, y: 340, blurb: 'Dry regolith. Look for shadowed-crater ice.' },
  { id: 'moon_south',  name: 'Lunar South Pole', body: 'moon',   type: 'surface',  class: 'B', hydration: 2, vps: 2, surface: true,  x: 290, y: 305, blurb: 'Shackleton-region ice deposits.' },

  // ----- Inner planets -----
  { id: 'venus_orbit', name: 'Venus orbit',      body: 'venus',  type: 'orbit',    class: '',  hydration: 0, vps: 0, surface: false, x: 220, y: 540, blurb: 'Aerobrake corridor — pivot or perish.' },
  { id: 'venus',       name: 'Venus',            body: 'venus',  type: 'planet',   class: 'D', hydration: 0, vps: 2, surface: true,  x: 250, y: 580, blurb: 'Hellscape. Hydrogen-rich upper cloud deck.' },
  { id: 'mercury',     name: 'Mercury',          body: 'mercury',type: 'planet',   class: 'C', hydration: 1, vps: 2, surface: true,  x: 180, y: 640, blurb: 'Poles ice-locked. Surface is solar-rich.' },

  // ----- Mars system -----
  { id: 'mars_orbit',  name: 'Mars orbit',       body: 'mars',   type: 'orbit',    class: '',  hydration: 0, vps: 0, surface: false, x: 400, y: 440, blurb: 'Trans-Mars insertion node.' },
  { id: 'mars',        name: 'Mars',             body: 'mars',   type: 'planet',   class: 'B', hydration: 2, vps: 2, surface: true,  x: 440, y: 460, blurb: 'Permafrost everywhere; some near-surface ice.' },
  { id: 'phobos',      name: 'Phobos',           body: 'mars',   type: 'moon',     class: 'A', hydration: 1, vps: 1, surface: true,  x: 410, y: 390, blurb: 'Carbonaceous rubble. Cheap to land on.' },
  { id: 'deimos',      name: 'Deimos',           body: 'mars',   type: 'moon',     class: 'A', hydration: 1, vps: 1, surface: true,  x: 460, y: 370, blurb: 'Smaller, drier, slightly cheaper escape.' },

  // ----- Near-Earth asteroids -----
  { id: 'eros',        name: '433 Eros',         body: 'nea',    type: 'asteroid', class: 'B', hydration: 0, vps: 1, surface: true,  x: 330, y: 220, blurb: 'S-type silicate. Big enough to walk on.' },
  { id: 'apophis',     name: '99942 Apophis',    body: 'nea',    type: 'asteroid', class: 'B', hydration: 0, vps: 1, surface: true,  x: 290, y: 260, blurb: '370 m peanut. Famous flyby.' },
  { id: 'ryugu',       name: '162173 Ryugu',     body: 'nea',    type: 'asteroid', class: 'A', hydration: 2, vps: 2, surface: true,  x: 370, y: 200, blurb: 'C-type. Hayabusa2 confirmed hydrated minerals.' },
  { id: 'bennu',       name: '101955 Bennu',     body: 'nea',    type: 'asteroid', class: 'A', hydration: 2, vps: 2, surface: true,  x: 420, y: 230, blurb: 'OSIRIS-REx target. Carbonaceous, wet clays.' },

  // ----- Main belt -----
  { id: 'ceres',       name: 'Ceres',            body: 'ceres',  type: 'dwarf',    class: 'B', hydration: 3, vps: 3, surface: true,  x: 600, y: 380, blurb: 'Dwarf planet, briny mantle, plenty of water.' },
  { id: 'vesta',       name: 'Vesta',            body: 'vesta',  type: 'asteroid', class: 'C', hydration: 1, vps: 2, surface: true,  x: 580, y: 460, blurb: 'V-type basaltic. Dry, but Bernal-grade real estate.' },
  { id: 'pallas',      name: 'Pallas',           body: 'pallas', type: 'asteroid', class: 'B', hydration: 2, vps: 2, surface: true,  x: 630, y: 300, blurb: 'B-type, weakly hydrated.' },
  { id: 'hygiea',      name: 'Hygiea',           body: 'hygiea', type: 'asteroid', class: 'A', hydration: 3, vps: 2, surface: true,  x: 670, y: 520, blurb: 'C-type, very wet. Quietly massive.' },
  { id: 'psyche',      name: '16 Psyche',        body: 'psyche', type: 'asteroid', class: 'C', hydration: 0, vps: 3, surface: true,  x: 700, y: 360, blurb: 'M-type metal core. Dry but priceless.' },

  // ----- Jupiter family / Trojans -----
  { id: 'hilda',       name: 'Hilda Cluster',    body: 'hilda',  type: 'asteroid', class: 'B', hydration: 2, vps: 1, surface: true,  x: 780, y: 280, blurb: '3:2 resonance with Jupiter. Cold and icy.' },
  { id: 'l4_trojans',  name: 'Jovian L4 Trojans',body: 'jupiter',type: 'lagrange', class: 'B', hydration: 2, vps: 2, surface: true,  x: 830, y: 230, blurb: 'Greek camp. Carbonaceous, ice-laden.' },
  { id: 'l5_trojans',  name: 'Jovian L5 Trojans',body: 'jupiter',type: 'lagrange', class: 'B', hydration: 2, vps: 2, surface: true,  x: 870, y: 550, blurb: 'Trojan camp. Carbonaceous, ice-laden.' },

  // ----- Jupiter system -----
  { id: 'jupiter',     name: 'Jupiter',          body: 'jupiter',type: 'planet',   class: 'D', hydration: 3, vps: 3, surface: false, x: 900, y: 400, blurb: 'Hydrogen scoop. Magnetosphere will kill you.' },
  { id: 'io',          name: 'Io',               body: 'jupiter',type: 'moon',     class: 'C', hydration: 0, vps: 2, surface: true,  x: 870, y: 360, blurb: 'Volcanic. Sulfur, no water.' },
  { id: 'europa',      name: 'Europa',           body: 'jupiter',type: 'moon',     class: 'B', hydration: 3, vps: 3, surface: true,  x: 910, y: 350, blurb: 'Subsurface ocean. Pristine ice crust.' },
  { id: 'ganymede',    name: 'Ganymede',         body: 'jupiter',type: 'moon',     class: 'A', hydration: 3, vps: 3, surface: true,  x: 950, y: 380, blurb: 'Largest moon. Layered ice + magnetic field.' },
  { id: 'callisto',    name: 'Callisto',         body: 'jupiter',type: 'moon',     class: 'A', hydration: 2, vps: 2, surface: true,  x: 970, y: 450, blurb: 'Geologically dead, crater-saturated, safe.' },

  // ----- Saturn system -----
  { id: 'saturn',      name: 'Saturn',           body: 'saturn', type: 'planet',   class: 'D', hydration: 3, vps: 3, surface: false, x: 1080, y: 410, blurb: 'Helium scoop. Rings make navigation tricky.' },
  { id: 'titan',       name: 'Titan',            body: 'saturn', type: 'moon',     class: 'B', hydration: 3, vps: 3, surface: true,  x: 1050, y: 360, blurb: 'Methane lakes, thick atmosphere, aerobrake friendly.' },
  { id: 'enceladus',   name: 'Enceladus',        body: 'saturn', type: 'moon',     class: 'A', hydration: 3, vps: 3, surface: true,  x: 1100, y: 350, blurb: 'Geyser plumes feed a global ocean.' },
  { id: 'iapetus',     name: 'Iapetus',          body: 'saturn', type: 'moon',     class: 'B', hydration: 2, vps: 2, surface: true,  x: 1130, y: 460, blurb: 'Two-tone walnut. Stable, distant orbit.' },

  // ----- Kuiper belt / centaurs -----
  { id: 'chiron',      name: '2060 Chiron',      body: 'centaur',type: 'asteroid', class: 'B', hydration: 3, vps: 2, surface: true,  x: 1180, y: 280, blurb: 'Centaur, comet-like activity, very wet.' },
  { id: 'pluto',       name: 'Pluto',            body: 'pluto',  type: 'dwarf',    class: 'A', hydration: 3, vps: 3, surface: true,  x: 1280, y: 350, blurb: 'Nitrogen glaciers. End of the line.' },
  { id: 'charon',      name: 'Charon',           body: 'pluto',  type: 'moon',     class: 'A', hydration: 3, vps: 2, surface: true,  x: 1320, y: 410, blurb: 'Tidally locked partner of Pluto.' },
];

// Delta-v edges. Each edge represents one corridor on the map; the
// engine's MOVE op walks along edges, costing `dv` burns per traversal.
// Edges are undirected; the renderer draws them as lines and the engine
// uses Dijkstra over them.
//
// Numbers are *playability dv*, expressed as integer burns. They're
// not raw km/s; they're scaled so a typical chemical rocket gets you
// around the inner system in ~10 burns of fuel.

export const EDGES = [
  // Earth-Moon
  ['leo', 'gto', 2],
  ['leo', 'l1', 3],
  ['gto', 'l1', 2],
  ['l1', 'moon', 1],
  ['moon', 'moon_south', 1],

  // Inner planets
  ['leo', 'venus_orbit', 4],
  ['venus_orbit', 'venus', 2],
  ['leo', 'mercury', 6],
  ['venus_orbit', 'mercury', 4],

  // Mars system
  ['leo', 'mars_orbit', 4],
  ['mars_orbit', 'mars', 2],
  ['mars_orbit', 'phobos', 1],
  ['mars_orbit', 'deimos', 1],
  ['phobos', 'deimos', 1],

  // Near-Earth asteroids
  ['leo', 'eros', 3],
  ['leo', 'apophis', 2],
  ['leo', 'bennu', 3],
  ['leo', 'ryugu', 3],
  ['eros', 'apophis', 2],
  ['eros', 'bennu', 2],
  ['bennu', 'ryugu', 2],

  // NEA to Mars / belt
  ['eros', 'mars_orbit', 2],
  ['bennu', 'mars_orbit', 2],
  ['ryugu', 'mars_orbit', 2],

  // Main belt
  ['mars_orbit', 'vesta', 4],
  ['mars_orbit', 'ceres', 5],
  ['vesta', 'ceres', 2],
  ['ceres', 'pallas', 2],
  ['ceres', 'hygiea', 2],
  ['ceres', 'psyche', 2],
  ['vesta', 'psyche', 2],
  ['pallas', 'hygiea', 2],

  // Jupiter family
  ['ceres', 'hilda', 3],
  ['psyche', 'hilda', 3],
  ['hilda', 'l4_trojans', 2],
  ['hilda', 'l5_trojans', 2],
  ['l4_trojans', 'jupiter', 2],
  ['l5_trojans', 'jupiter', 2],

  // Jupiter moons
  ['jupiter', 'io', 2],
  ['jupiter', 'europa', 2],
  ['jupiter', 'ganymede', 2],
  ['jupiter', 'callisto', 2],
  ['io', 'europa', 1],
  ['europa', 'ganymede', 1],
  ['ganymede', 'callisto', 1],

  // Saturn (long transit)
  ['jupiter', 'saturn', 4],
  ['saturn', 'titan', 2],
  ['saturn', 'enceladus', 2],
  ['saturn', 'iapetus', 2],
  ['titan', 'enceladus', 1],
  ['enceladus', 'iapetus', 2],

  // Outer
  ['saturn', 'chiron', 3],
  ['chiron', 'pluto', 4],
  ['pluto', 'charon', 1],
];

// Convenience: build a quick lookup by id. Used by the renderer and
// the engine alike to resolve a site reference.
export const SITES_BY_ID = Object.fromEntries(SITES.map((s) => [s.id, s]));

// Quick lookup: every body group (for Habitat / Bernal scoring).
// One body can host multiple sites (e.g. Mars + Phobos + Deimos all
// count as "mars" body for the orbital-cluster habitat bonus).
export function sitesByBody(bodyId) {
  return SITES.filter((s) => s.body === bodyId);
}
