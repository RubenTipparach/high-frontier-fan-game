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
    title: 'Win your rocket parts and boost up',
    instruction: 'Put each rocket part up for auction and bid 1 to beat the bots, then boost it to LEO. Repeat until all six parts are in orbit.' },
  { id: 'assemble',            pose: 'point', target: 'stack',
    title: 'Assemble the rocket',
    instruction: 'Open your rocket stack and add the thruster, its generator, a robonaut and a refinery. The generator powers everything.' },
  { id: 'fuel',                pose: 'point', target: 'refuel',
    title: 'Fuel up',
    instruction: 'Fill your tank from the Aqua bank so you can reach Deimos.' },
  { id: 'fly-deimos',          pose: 'point', target: 'move',
    title: 'Fly to Deimos',
    instruction: 'Tap Deimos, plan a rocket route, and launch. It is 3 delta-v from LEO.' },
  { id: 'prospect-deimos',     pose: 'point', target: 'prospect',
    title: 'Prospect Deimos',
    instruction: 'Prospect Deimos to claim it. Roll the die - the tutorial guarantees a claim.' },
  { id: 'industrialize-deimos', pose: 'point', target: 'industrialize',
    title: 'Industrialize Deimos',
    instruction: 'Decommission your robonaut + refinery at Deimos to build a Factory (1 VP).' },
  { id: 'et-robonaut',         pose: 'point', target: 'et-produce',
    title: 'Produce a robonaut',
    instruction: 'Use the Deimos Factory to ET-produce a robonaut from a hand card.' },
  { id: 'et-refinery',         pose: 'point', target: 'et-produce',
    title: 'Produce a refinery',
    instruction: 'ET-produce a refinery too, so you can industrialize a second site.' },
  { id: 'fly-phobos',          pose: 'point', target: 'move',
    title: 'Hop to Phobos',
    instruction: 'Phobos is one hop from Deimos. Carry the produced robonaut + refinery there.' },
  { id: 'prospect-phobos',     pose: 'point', target: 'prospect',
    title: 'Prospect Phobos',
    instruction: 'Prospect Phobos to claim it (guaranteed).' },
  { id: 'industrialize-phobos', pose: 'cheer', target: 'industrialize',
    title: 'Industrialize Phobos',
    instruction: 'Build your second Factory on Phobos. Mission complete!' },
];

export function tutorialStepAt(index) {
  return TUTORIAL_STEPS[index] || null;
}
