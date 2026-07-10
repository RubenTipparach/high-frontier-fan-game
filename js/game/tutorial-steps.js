// Client-side tutorial step copy + guidance, indexed to match the server's
// TUTORIAL_SCRIPT (server/game/tutorial.js) step order. The engine is the source
// of truth for PROGRESS (state.tutorial.step); this module carries the
// player-facing copy + which on-screen control Buggy points at, which the server
// has no business knowing. Keep the order identical to the server script.
//
// pose:   Buggy's pose ('point' | 'cheer').
// target: a logical control key the overlay highlights when "Show me" is tapped
//         (mapped to a real element by the overlay). null = no single control.

export const TUTORIAL_STEPS = [
  { id: 'sell',                 pose: 'point', target: 'auction',
    title: 'Auction a card to earn Aqua',
    instruction: 'Put a card up for Research Auction. Your two rivals bid it up to 6 Aqua - sell to the top bidder to bank the money.' },
  { id: 'acquire',             pose: 'point', target: 'auction',
    title: 'Win a part, Buggy supplies the rest',
    instruction: 'Put a rocket part up for auction, keep it for free (the rivals pass), and boost it to LEO. Buggy hands you the other parts. These parts form a support chain: a thruster only fires when a generator or reactor powers it, and power flows down the chain to the thruster.' },
  { id: 'assemble',            pose: 'point', target: 'leo-transfer',
    title: 'Assemble the rocket',
    instruction: 'Open your LEO stack and Send all five parts to the Rocket (a free Cargo Transfer). Power flows in a chain to the thruster. You need every part aboard before you can fly to Deimos.' },
  { id: 'fuel',                pose: 'point', target: 'refuel',
    title: 'Fuel up',
    instruction: 'Open your rocket stack, tap the Wet mass cell to open the fuel tank, and fill from the Aqua bank to 8 water (tap +5, then +1 three times, or Max fill). That is enough for Deimos AND Phobos - you cannot refuel again until you land.' },
  { id: 'fly-deimos',          pose: 'point', target: 'move',
    title: 'Fly to Deimos',
    instruction: 'Tap Deimos, plan a rocket route, and launch. It is 3 delta-v from LEO.' },
  { id: 'prospect-deimos',     pose: 'point', target: 'prospect',
    title: 'Prospect Deimos',
    instruction: 'Open your rocket stack and set your robonaut as the Active Prospector (the orange button on its card). Then tap Deimos and hit Prospect to claim it. Roll the die - the tutorial guarantees a claim.' },
  { id: 'industrialize-deimos', pose: 'point', target: 'industrialize',
    title: 'Industrialize Deimos',
    instruction: 'Decommission your robonaut + refinery at Deimos to build a Factory (1 VP).' },
  { id: 'et-robonaut',         pose: 'point', target: 'et-produce',
    title: 'Produce a robonaut',
    instruction: 'Open the Deimos site and tap ET Produce. In the modal, pick the robonaut card (its spectral type matches the factory), then hit Produce. It lands Black-Side-up in the Deimos outpost, ready to reload for Phobos.' },
  { id: 'et-refinery',         pose: 'point', target: 'et-produce',
    title: 'Produce a refinery',
    instruction: 'ET Produce again and pick the refinery this time. A robonaut prospects a site and a refinery makes the water, so you need both in the outpost to industrialize Phobos next.' },
  { id: 'et-generator',        pose: 'point', target: 'et-produce',
    title: 'Produce a generator',
    instruction: 'ET Produce one more time and pick the generator. Building a Factory decommissions the refinery + robonaut AND their generator, so your Phobos kit needs its own power source. Produce it into the outpost with the others.' },
  { id: 'fly-phobos',          pose: 'point', target: 'move',
    title: 'Hop to Phobos',
    instruction: 'Load your kit FIRST: move the produced robonaut + refinery + generator from the Deimos outpost onto your rocket (a free Cargo Transfer). You cannot leave without the full kit. Then plot a route and hop to Phobos.' },
  { id: 'prospect-phobos',     pose: 'point', target: 'prospect',
    title: 'Prospect Phobos',
    instruction: 'Set your robonaut as the Active Prospector again, then tap Phobos and Prospect to claim it (guaranteed).' },
  { id: 'industrialize-phobos', pose: 'cheer', target: 'industrialize',
    title: 'Industrialize Phobos',
    instruction: 'Build your second Factory on Phobos. Mission complete!' },
];

export function tutorialStepAt(index) {
  return TUTORIAL_STEPS[index] || null;
}

// The five parts that must board the rocket at the Assemble step, in stack
// order, with a short display name. Mirrors the server's TUTORIAL_STACK_PARTS
// (server/game/tutorial.js) - keep the ids in sync. Drives the coach's live
// "parts still to load" checklist so the player knows exactly what is left
// before they can fly to Deimos.
export const TUTORIAL_ASSEMBLE_PARTS = [
  { id: 'thr_pulsed_inductive',    name: 'Pulsed Inductive (thruster)' },
  { id: 'gen_marx_capacitor_bank', name: 'Marx Capacitor Bank (generator)' },
  { id: 'gen_cascade_photovoltaic', name: 'Cascade Photovoltaic (generator)' },
  { id: 'rob_met_steamer',         name: 'MET Steamer (robonaut)' },
  { id: 'ref_cvd_molding',         name: 'CVD Molding (refinery)' },
];
