// RAT FRONTIER - card data set, in the ORIGINAL HF card model so the
// original renderer (js/game/card-ui.js#renderCard) draws it with no changes.
//
// Source of truth: the Unity "Rattus Space Program" prefab variants
// (Assets/Prefabs/Cards/*.prefab). Names + the stats the prefabs override
// (PatentName, wieght->mass, radHardness, prospectingValue->prospect_bonus,
// thrustValue->thrust, fuelBurnPerThrust->fuel, afterburner->afterburn) are
// carried verbatim; stats the prefabs leave on their base (isp, spectral,
// supports, blurbs) are STARTER values, tuned later like HF4 card data.
//
// Fields are the REAL ones renderCard reads: id, name, type, mass,
// radHardness, spectralType (HF letters C/S/M/V/B/D/H), thrust, isp, fuel,
// fuelType, afterburn, requires[{kind,count}], supplies[], properties[],
// prospector, prospect_bonus, therms, rotatable, blurb. `art` is rat-specific
// (a file under assets/rat-frontier/art/) and is ignored by renderCard.

export const RAT_PATENTS = [
  // ---- Thrusters ----
  {
    id: 'rat_thr_cheese', name: 'Nuclear Cheese Drive', type: 'thruster',
    mass: 2, radHardness: 6, spectralType: 'V',
    thrust: 5, isp: 2, fuel: 3, fuelType: 'Water', afterburn: 2,
    requires: [{ kind: 'reactor-fission', count: 1 }],
    art: 'cheese_thruster.png',
    blurb: 'A fondue reactor flung out the back. Smells incredible, melts the radiators.',
  },
  {
    id: 'rat_thr_fart', name: 'Magneto Fart Drive', type: 'thruster',
    mass: 2, radHardness: 4, spectralType: 'H',
    thrust: 4, isp: 2, fuel: 2, fuelType: 'Water', afterburn: 4,
    requires: [{ kind: 'gen-electric', count: 1 }],
    art: 'Magneto_Fart_Trhuster.png',
    blurb: 'Magnetoplasmadynamic. Pinches a bean-gas plasma to a screaming jet.',
  },
  {
    id: 'rat_thr_sail', name: 'Paper Towel Sail', type: 'thruster',
    mass: 0, radHardness: 9, spectralType: 'C',
    thrust: 1, isp: 1, fuel: 0, fuelType: 'Water', afterburn: 0,
    supplies: ['sail'],
    art: 'Solar_Sail.png',
    blurb: 'Two-ply, quilted for thrust. Free push from sunlight, no fuel spent.',
  },
  // ---- Reactors ----
  {
    id: 'rat_rea_moldy', name: 'Moldy Fusion Tokamak', type: 'reactor',
    mass: 3, radHardness: 5, spectralType: 'C', power: 4, heat: 3,
    requires: [{ kind: 'thermostat', count: 2 }],
    supplies: ['reactor-fusion'],
    art: 'moldy cheese fusion.png',
    blurb: 'A doughnut of penicillin plasma. Runs hot. Do not inhale.',
  },
  {
    id: 'rat_rea_cheese', name: 'Nuclear Cheese Reactor', type: 'reactor',
    mass: 2, radHardness: 7, spectralType: 'V', power: 3, heat: 2,
    requires: [{ kind: 'thermostat', count: 1 }],
    supplies: ['reactor-fission'],
    art: 'nuclear_cheese_reactor.png',
    blurb: 'Fissile gouda in a lead crock. The smell is load-bearing.',
  },
  {
    id: 'rat_rea_whiskers', name: 'Magnetic Particle Collectors', type: 'reactor',
    mass: 2, radHardness: 4, spectralType: 'M', power: 3, heat: 2,
    requires: [{ kind: 'thermostat', count: 1 }],
    supplies: ['reactor-fission'],
    art: 'whiskers array particle collector.png',
    blurb: 'A whisker array that rakes charged dust into the core.',
  },
  // ---- Generators ----
  {
    id: 'rat_gen_battery', name: 'Stolen Car Battery', type: 'generator',
    mass: 1, radHardness: 3, spectralType: 'M', science: 1,
    supplies: ['gen-electric'],
    art: 'Battery.png',
    blurb: 'Twelve volts of pure crime. Jumper cables sold separately.',
  },
  {
    id: 'rat_gen_solar', name: 'Cat Butt Solar Collector', type: 'generator',
    mass: 2, radHardness: 5, spectralType: 'C', science: 1,
    supplies: ['gen-electric'],
    properties: [{ key: 'solar', value: true, glyph: '☀', label: 'Solar' }],
    art: 'cat_butt.png',
    blurb: 'Maximum surface area achieved when the cat faces the sun. It always does.',
  },
  {
    id: 'rat_gen_wheel', name: 'Hamster Wheel', type: 'generator',
    mass: 2, radHardness: 3, spectralType: 'C', science: 1,
    supplies: ['gen-electric'],
    requires: [{ kind: 'crew-quarters', count: 1 }],
    art: 'Hamster_wheel.png',
    blurb: 'One (1) motivated rodent. Snacks not included in delta-v budget.',
  },
  // ---- Radiators ----
  {
    id: 'rat_rad_chill', name: 'Chill Pill', type: 'radiator',
    mass: 1, radHardness: 2, spectralType: 'B',
    supplies: ['thermostat'], therms: 2, rotatable: true,
    art: 'chill_pill.png',
    blurb: 'Just relax, man. Sheds heat by simply not caring about it.',
  },
  {
    id: 'rat_rad_fridge', name: 'Fridge', type: 'radiator',
    mass: 2, radHardness: 4, spectralType: 'M',
    supplies: ['thermostat'], therms: 3, rotatable: true,
    art: 'refrigerator.png',
    blurb: 'Leftover-cooled. The light stays on the whole burn.',
  },
  {
    id: 'rat_rad_keanu', name: 'Keanu Ratts', type: 'radiator',
    mass: 3, radHardness: 5, spectralType: 'B',
    supplies: ['thermostat'], therms: 4, rotatable: true,
    art: 'cool_dude.png',
    blurb: 'Breathtaking heat rejection. You are all breathtaking.',
  },
  // ---- Refineries ----
  {
    id: 'rat_ref_bowl', name: 'Saturated Water Bowl', type: 'refinery',
    mass: 3, radHardness: 5, spectralType: 'H', water_out: 3,
    art: 'water_bowl_saturation.png',
    blurb: 'Laps local ice into the tank. Hydration in, water out.',
  },
  {
    id: 'rat_ref_ratatooing', name: 'Ratatooing', type: 'refinery',
    mass: 3, radHardness: 6, spectralType: 'C', water_out: 2,
    art: 'ratatooing.png',
    blurb: 'Anyone can refine. A small chef in the hull pulls the levers.',
  },
  // ---- Robonauts (prospectors) ----
  {
    id: 'rat_rob_laser', name: 'Cat Laser', type: 'robonaut',
    mass: 2, radHardness: 5, spectralType: 'M',
    prospector: 'raygun', prospect_bonus: 1,
    properties: [{ key: 'raygun', value: true, glyph: '🔦', label: 'Raygun prospector' }],
    requires: [{ kind: 'gen-electric', count: 1 }],
    art: 'cat_laser_pointer.png',
    blurb: 'Line-of-sight prospecting. Scans every site the dot can reach, free.',
  },
  {
    id: 'rat_rob_truck', name: 'Cyber Rat Truck', type: 'robonaut',
    mass: 2, radHardness: 3, spectralType: 'M',
    prospector: 'buggy', prospect_bonus: 2,
    properties: [{ key: 'buggy', value: true, glyph: '🚙', label: 'Buggy prospector' }],
    art: 'Cyber_rat_truck.png',
    blurb: 'Stainless, allegedly. Drives a buggy road to the next claim.',
  },
  {
    id: 'rat_rob_drill', name: 'Red Rocket Drill', type: 'robonaut',
    mass: 2, radHardness: 4, spectralType: 'V',
    prospector: 'missile', prospect_bonus: 3,
    thrust: 6, isp: 1, fuel: 7, fuelType: 'Water', afterburn: 2,
    properties: [{ key: 'missile', value: true, glyph: '🚀', label: 'Missile prospector' }],
    requires: [{ kind: 'reactor-fission', count: 1 }],
    art: 'Red_rocket_drill.png',
    blurb: 'A missile robonaut: it flies itself to the rock, then drills in.',
  },
];

// Crew / faction cards. renderCard's crew path reads card.faces[side] as a
// full crew record (name/role/bonus/blurb/mass/radHardness/isru/prospector/
// thruster) and card.color for the faction band. Each rat captain is one card.
export const RAT_CREW = [
  {
    id: 'rat_crew_walter', type: 'crew', color: '#c9a227', art: 'Walter_white_rat.png',
    faces: { primary: {
      name: 'Walter Whisker', role: 'Chem Baron', bonus: 'Pure Propellant',
      blurb: 'Cooks the purest monopropellant in the belt. Say his name.',
      mass: 1, radHardness: 4, isru: 4, prospector: 'buggy',
    } },
  },
  {
    id: 'rat_crew_elong', type: 'crew', color: '#7c4dff', art: 'elong_musk_rat.png',
    faces: { primary: {
      name: 'Elong Musk-Rat', role: 'Disruptor', bonus: 'Cheap Boost',
      blurb: 'Promises a colony by Tuesday. Boosts cheap, tweets cheaper.',
      mass: 1, radHardness: 3, isru: 4, prospector: 'raygun',
    } },
  },
  {
    id: 'rat_crew_boota', type: 'crew', color: '#2e9e74', art: 'boota_rat.png',
    faces: { primary: {
      name: 'Boota the Bold', role: 'Test Pilot', bonus: 'Steady Hands',
      blurb: 'Rode the first stack to orbit and came back asking for more.',
      mass: 1, radHardness: 5, isru: 4, prospector: 'missile',
    } },
  },
  {
    id: 'rat_crew_pack', type: 'crew', color: '#b40054', art: 'rat_pack.png',
    faces: { primary: {
      name: 'The Rat Pack', role: 'Syndicate', bonus: 'Cheese Standard',
      blurb: 'A whole crew in one bunk. Cheese is the only currency they trust.',
      mass: 2, radHardness: 4, isru: 4, prospector: 'buggy',
    } },
  },
];

export const RAT_CARDS = [...RAT_PATENTS, ...RAT_CREW];
