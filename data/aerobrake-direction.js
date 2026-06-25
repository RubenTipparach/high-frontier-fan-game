// Aerobrake one-way direction (core rules B7e / aerobrake rule c): "A Spacecraft
// cannot move against the arrow's direction on an aerobrake path." The arrow
// always points DOWN the gravity well (you fall INTO the atmosphere to
// decelerate); you can never aerobrake the wrong way to climb out.
//
// The published board prints an arrow on each corridor, but that direction is
// NOT in the planner graph data. We derive it: an aerobrake serves a specific
// body, so the descent ("down") side is the corridor neighbor that is CLOSER to
// a landing site / lander burn (BFS over the graph). That heuristic matches
// every corridor whose direction is otherwise unambiguous (a site / lander-burn
// neighbor), and resolves 27 of 30 corridors. The 3 it can't (a body is
// equidistant on both sides) are left out and stay BIDIRECTIONAL - better an
// un-enforced corridor than a wrongly-rejected legal route. Keys + values are
// the shared id2 planner slugs (makeRefId), so the same map gates the client
// planner AND the server MOVE.
//
// To override / extend (e.g. fill the 3 ties from the board), edit AERO_DOWN:
// key = the aerobrake corridor slug, value = the neighbor slug you descend toward.
export const AERO_DOWN = {
  'lag-c3cha': 'burn-5eobz',
  'lag-968np': 'lag-m0sea',
  'lag-6r4sx': 'dec-ek0ud',
  'lag-7dh9f': 'burn-ue3lc',
  'lag-dzgne': 'dec-ct329',
  'lag-lozeb': 'burn-3ylxe',   // Phobos
  'lag-5pmg4': 'lag-fp0u6',    // Mars: Hellas Basin
  'lag-6jjmn': 'dec-078jp',    // Mars: Arsia Mons
  'lag-9uw56': 'lag-k88xf',    // Elara
  'lag-pzen6': 'rad-pt38y',    // Elara
  'lag-5rcv3': 'lag-55ra2',
  'lag-exzgn': 'burn-3sdm1',
  'lag-3hf9y': 'lag-3y19p',    // Setebos
  'lag-u1kzp': 'lag-zb2km',
  'lag-60v7l': 'burn-337ap',   // Nereid
  'lag-e9ydu': 'dec-o6mrg',    // Neptune Aerostat
  'lag-p5ep5': 'mars-north-pole', // Mars: north pole
  'lag-vlqer': 'dec-8fmef',
  'lag-w6ybr': 'lag-leo',      // Earth / LEO
  'lag-m01cm': 'dec-4ax2q',    // Titan Aerostat
  'lag-7xipc': 'lag-u3g7x',
  'lag-tspde': 'lag-f1g82',
  'lag-25q0c': 'burn-fklp9',
  'lag-0n050': 'dec-6n33k',    // Triton: Tuenela Plantia
  'lag-n95ot': 'dec-7fc7e',    // Triton: Mahilani plume
  'lag-3tls2': 'dec-ex9a2',    // Pluto
  'lag-m9db0': 'lag-xum2h',
  // Ties (body equidistant both sides) left bidirectional: lag-8fg84,
  // lag-jb3sl, lag-pzmun. Add them here once their board arrows are known.
};

// Is the hop FROM -> TO legal under the one-way aerobrake rule? Slugs are id2.
// A corridor with no known direction (not in AERO_DOWN) is always allowed.
//   - Leaving an aerobrake: you may only continue toward its DOWN neighbor.
//   - Entering an aerobrake: you may not come FROM its DOWN neighbor (that would
//     be climbing up into / out of the corridor against the arrow).
export function aeroHopAllowed(from, to) {
  if (from == null || to == null) return true;
  const downFrom = AERO_DOWN[from];
  if (downFrom && to !== downFrom) return false;
  const downTo = AERO_DOWN[to];
  if (downTo && from === downTo) return false;
  return true;
}
