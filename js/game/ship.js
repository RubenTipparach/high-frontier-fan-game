// Ship card composer.
//
// A "ship" is a stack of patent cards. To launch it must satisfy:
//   - exactly one thruster
//   - exactly one reactor (any reactor with power >= thruster.power_req)
//   - exactly one radiator (radiator.heat_cap >= reactor.heat)
//   - any number of refineries, robonauts, labs, generators
//   - tank water (a separate scalar, not a patent)
//
// Stage 2 ships this composer so the future builder UI and the engine
// agree on the validation rules, but no engine wires it yet - Stage 3
// will call validateShip() at BUILD time.

import { PATENTS_BY_ID } from '../../data/patents.js';

// Resolve a patent id into the full record, ignoring unknown ids
// quietly so a save file from a future version doesn't crash the UI.
function resolve(ids) {
  return ids.map((id) => PATENTS_BY_ID[id]).filter(Boolean);
}

// Build a derived summary of a candidate ship. Returns:
//   { ok, errors[], stats: { mass, thrust, isp, power_req, heat, water } }
// `ok` is false if any required slot is missing or any rule is violated;
// `errors` is a list of human-readable codes for the UI to render.
export function summarizeShip({ patentIds, tankWater = 0 }) {
  const patents = resolve(patentIds || []);
  const errors = [];

  const thrusters = patents.filter((p) => p.type === 'thruster');
  const reactors  = patents.filter((p) => p.type === 'reactor');
  const radiators = patents.filter((p) => p.type === 'radiator');

  if (thrusters.length !== 1) errors.push('need_one_thruster');
  if (reactors.length  !== 1) errors.push('need_one_reactor');
  if (radiators.length !== 1) errors.push('need_one_radiator');

  const thruster = thrusters[0];
  const reactor  = reactors[0];
  const radiator = radiators[0];

  if (thruster && reactor && reactor.power < thruster.power_req) {
    errors.push('reactor_underpowered');
  }
  if (reactor && radiator && radiator.heat_cap < reactor.heat) {
    errors.push('radiator_overloaded');
  }

  // Wet mass = sum of all patent.mass + water in tank. The thruster's
  // thrust rating must exceed wet mass for the ship to move.
  const dryMass = patents.reduce((sum, p) => sum + (p.mass || 0), 0);
  const mass    = dryMass + tankWater;
  if (thruster && thruster.thrust < mass) errors.push('thrust_too_low');

  const stats = {
    dryMass,
    mass,
    tankWater,
    thrust:    thruster ? thruster.thrust : 0,
    isp:       thruster ? thruster.isp    : 0,
    power_req: thruster ? thruster.power_req : 0,
    power:     reactor  ? reactor.power   : 0,
    heat:      reactor  ? reactor.heat    : 0,
    heat_cap:  radiator ? radiator.heat_cap : 0,
  };

  return { ok: errors.length === 0, errors, stats, patents };
}

// Compute the water cost of traversing one delta-v edge with this
// ship. Each "burn" of the edge consumes mass / (isp * scaleFactor)
// water units, rounded up. This is a deliberately simplified model;
// the real rocket equation is e^(dv/isp) but we use linear-with-ISP
// to keep the math board-game friendly.
//
// The engine calls this at MOVE time.
export function burnCost(shipStats, edgeDv) {
  if (!shipStats || !shipStats.isp) return Infinity;
  const perBurn = Math.max(1, Math.ceil(shipStats.mass / Math.max(1, shipStats.isp)));
  return perBurn * edgeDv;
}

// Human-readable error labels. Re-used by the builder UI in Stage 3.
export const SHIP_ERRORS = {
  need_one_thruster:    'Must install exactly one thruster.',
  need_one_reactor:     'Must install exactly one reactor.',
  need_one_radiator:    'Must install exactly one radiator.',
  reactor_underpowered: 'Reactor doesn\'t supply enough power for this thruster.',
  radiator_overloaded:  'Radiator can\'t dissipate this reactor\'s heat.',
  thrust_too_low:       'Thruster can\'t push this much wet mass.',
};
