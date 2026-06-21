// RAT FRONTIER - card data set.
//
// Source of truth: the Unity "Rattus Space Program" prefab variants
// (Assets/Prefabs/Cards/*.prefab). Card names + the stats that the
// prefabs override (PatentName, wieght, radHardness, prospectingValue,
// thrustValue, fuelBurnPerThrust, afterburner) are carried verbatim;
// stats the prefabs leave on their base (spectral, supports, blurbs)
// are filled here as STARTER values and tuned later, the same way HF4
// card data is audited against the spreadsheet.
//
// Card model mirrors the HF card model so the renderer + engine can
// stay branch-free: { id, name, type, mass, radHardness, signature,
// spectralType, thrust, fuelRatio, nodesMax, afterburn,
// prospectingValue, requires, supplies, art, blurb }. fuelRatio is the
// rat-card "Fuel Ratio" stat (1 : N), the rat skin of HF isp; nodesMax
// is the rat "Nodes Max" stat (the burn-capacity number printed on the
// thrust bar). art is a file under assets/rat-frontier/art/.
//
// Rat spectral types (Unity SpectralType enum): H / B / T / A / C.

export const RAT_SPECTRAL = {
  H: { glyph: 'H', label: 'Hydrated cheese',  fill: '#0ea5e9', ink: '#f0f9ff' },
  B: { glyph: 'B', label: 'Brie / basaltic',  fill: '#60a5fa', ink: '#0c0a16' },
  T: { glyph: 'T', label: 'Tin / metallic',   fill: '#9ca3af', ink: '#0c0a16' },
  A: { glyph: 'A', label: 'Aged / volcanic',  fill: '#f97316', ink: '#0c0a16' },
  C: { glyph: 'C', label: 'Cheddar / carbon', fill: '#fbbf24', ink: '#1f2937' },
  None: { glyph: '?', fill: '#475569', ink: '#e5e7eb', label: 'No spectral type' },
};

// Patent (component) cards. type drives the typebar + glyph language,
// exactly like HF patents.
export const RAT_PATENTS = [
  // ---- Thrusters ----
  {
    id: 'rat_thr_cheese', name: 'Nuclear Cheese Drive', type: 'thruster',
    mass: 2, radHardness: 6, signature: 3, spectralType: 'A',
    thrust: 5, fuelRatio: 3, nodesMax: 12, afterburn: 2,
    requires: [{ kind: 'reactor-fission', count: 1 }],
    art: 'cheese_thruster.png',
    blurb: 'A fondue reactor flung out the back. Smells incredible, melts the radiators.',
  },
  {
    id: 'rat_thr_fart', name: 'Magneto Fart Drive', type: 'thruster',
    mass: 2, radHardness: 4, signature: 2, spectralType: 'H',
    thrust: 4, fuelRatio: 2, nodesMax: 14, afterburn: 4,
    requires: [{ kind: 'gen-electric', count: 1 }],
    art: 'Magneto_Fart_Trhuster.png',
    blurb: 'Magnetoplasmadynamic. Pinches a bean-gas plasma to a screaming jet.',
  },
  {
    id: 'rat_thr_sail', name: 'Paper Towel Sail', type: 'thruster',
    mass: 0, radHardness: 99, signature: 1, spectralType: 'None',
    thrust: 1, fuelRatio: 0, nodesMax: 30, afterburn: 0,
    requires: [{ kind: 'sail', count: 1 }],
    supplies: ['sail'],
    art: 'Solar_Sail.png',
    blurb: 'Two-ply, quilted for thrust. Free push from sunlight, no fuel spent.',
  },
  // ---- Reactors ----
  {
    id: 'rat_rea_moldy', name: 'Moldy Fusion Tokamak', type: 'reactor',
    mass: 3, radHardness: 5, signature: 4, spectralType: 'C',
    requires: [{ kind: 'thermostat', count: 2 }],
    supplies: ['reactor-fusion'],
    art: 'moldy cheese fusion.png',
    blurb: 'A doughnut of penicillin plasma. Runs hot. Do not inhale.',
  },
  {
    id: 'rat_rea_cheese', name: 'Nuclear Cheese Reactor', type: 'reactor',
    mass: 2, radHardness: 7, signature: 3, spectralType: 'A',
    requires: [{ kind: 'thermostat', count: 1 }],
    supplies: ['reactor-fission'],
    art: 'nuclear_cheese_reactor.png',
    blurb: 'Fissile gouda in a lead crock. The smell is load-bearing.',
  },
  {
    id: 'rat_rea_whiskers', name: 'Magnetic Particle Collectors', type: 'reactor',
    mass: 2, radHardness: 4, signature: 2, spectralType: 'T',
    requires: [{ kind: 'thermostat', count: 1 }],
    supplies: ['reactor-fission'],
    art: 'whiskers array particle collector.png',
    blurb: 'A whisker array that rakes charged dust into the core.',
  },
  // ---- Generators ----
  {
    id: 'rat_gen_battery', name: 'Stolen Car Battery', type: 'generator',
    mass: 1, radHardness: 3, signature: 1, spectralType: 'T',
    supplies: ['gen-electric'],
    art: 'Battery.png',
    blurb: 'Twelve volts of pure crime. Jumper cables sold separately.',
  },
  {
    id: 'rat_gen_solar', name: 'Cat Butt Solar Collector', type: 'generator',
    mass: 2, radHardness: 5, signature: 1, spectralType: 'C',
    supplies: ['gen-electric'],
    properties: [{ key: 'solar', value: true, glyph: '☀', label: 'Solar' }],
    art: 'cat_butt.png',
    blurb: 'Maximum surface area achieved when the cat faces the sun. It always does.',
  },
  {
    id: 'rat_gen_wheel', name: 'Hamster Wheel', type: 'generator',
    mass: 2, radHardness: 3, signature: 1, spectralType: 'C',
    supplies: ['gen-electric'],
    requires: [{ kind: 'crew-quarters', count: 1 }],
    art: 'Hamster_wheel.png',
    blurb: 'One (1) motivated rodent. Snacks not included in delta-v budget.',
  },
  // ---- Radiators ----
  {
    id: 'rat_rad_chill', name: 'Chill Pill', type: 'radiator',
    mass: 1, radHardness: 2, signature: 1, spectralType: 'B',
    supplies: ['thermostat'], therms: 2, rotatable: true,
    art: 'chill_pill.png',
    blurb: 'Just relax, man. Sheds heat by simply not caring about it.',
  },
  {
    id: 'rat_rad_fridge', name: 'Fridge', type: 'radiator',
    mass: 2, radHardness: 4, signature: 1, spectralType: 'T',
    supplies: ['thermostat'], therms: 3, rotatable: true,
    art: 'refrigerator.png',
    blurb: 'Leftover-cooled. The light stays on the whole burn.',
  },
  {
    id: 'rat_rad_keanu', name: 'Keanu Ratts', type: 'radiator',
    mass: 3, radHardness: 5, signature: 1, spectralType: 'B',
    supplies: ['thermostat'], therms: 4, rotatable: true,
    art: 'cool_dude.png',
    blurb: 'Breathtaking heat rejection. You are all breathtaking.',
  },
  // ---- Refineries ----
  {
    id: 'rat_ref_bowl', name: 'Saturated Water Bowl', type: 'refinery',
    mass: 3, radHardness: 5, signature: 2, spectralType: 'H',
    art: 'water_bowl_saturation.png',
    blurb: 'Laps local ice into the tank. Hydration in, water out.',
  },
  {
    id: 'rat_ref_ratatooing', name: 'Ratatooing', type: 'refinery',
    mass: 3, radHardness: 6, signature: 2, spectralType: 'C',
    art: 'ratatooing.png',
    blurb: 'Anyone can refine. A small chef in the hull pulls the levers.',
  },
  // ---- Robonauts (prospectors) ----
  {
    id: 'rat_rob_laser', name: 'Cat Laser', type: 'robonaut',
    mass: 2, radHardness: 5, signature: 2, spectralType: 'T',
    prospectingValue: 1, prospector: 'raygun',
    requires: [{ kind: 'gen-electric', count: 1 }],
    art: 'cat_laser_pointer.png',
    blurb: 'Line-of-sight prospecting. Scans every site the dot can reach, free.',
  },
  {
    id: 'rat_rob_truck', name: 'Cyber Rat Truck', type: 'robonaut',
    mass: 2, radHardness: 3, signature: 2, spectralType: 'M',
    prospectingValue: 2, prospector: 'buggy',
    art: 'Cyber_rat_truck.png',
    blurb: 'Stainless, allegedly. Drives a buggy road to the next claim.',
  },
  {
    id: 'rat_rob_drill', name: 'Red Rocket Drill', type: 'robonaut',
    mass: 2, radHardness: 4, signature: 3, spectralType: 'A',
    prospectingValue: 3, prospector: 'missile',
    thrust: 6, fuelRatio: 7, nodesMax: 9, afterburn: 2,
    requires: [{ kind: 'reactor-fission', count: 1 }],
    art: 'Red_rocket_drill.png',
    blurb: 'A missile robonaut: it flies itself to the rock, then drills in.',
  },
];

// Crew / faction cards. Each rat captain is its own card (single-faced
// in play, like HF crew). color is the seat band.
export const RAT_CREW = [
  {
    id: 'rat_crew_walter', name: 'Walter Whisker', type: 'crew', color: '#c9a227',
    role: 'Chem Baron', mass: 1, radHardness: 4, prospector: 'buggy',
    art: 'Walter_white_rat.png',
    blurb: 'Cooks the purest monopropellant in the belt. Say his name.',
  },
  {
    id: 'rat_crew_elong', name: 'Elong Musk-Rat', type: 'crew', color: '#7c4dff',
    role: 'Disruptor', mass: 1, radHardness: 3, prospector: 'raygun',
    art: 'elong_musk_rat.png',
    blurb: 'Promises a colony by Tuesday. Boosts cheap, tweets cheaper.',
  },
  {
    id: 'rat_crew_boota', name: 'Boota the Bold', type: 'crew', color: '#2e9e74',
    role: 'Test Pilot', mass: 1, radHardness: 5, prospector: 'missile',
    art: 'boota_rat.png',
    blurb: 'Rode the first stack to orbit and came back asking for more.',
  },
  {
    id: 'rat_crew_pack', name: 'The Rat Pack', type: 'crew', color: '#b40054',
    role: 'Syndicate', mass: 2, radHardness: 4, prospector: 'buggy',
    art: 'rat_pack.png',
    blurb: 'A whole crew in one bunk. Cheese is the only currency they trust.',
  },
];

export const RAT_CARDS = [...RAT_PATENTS, ...RAT_CREW];
