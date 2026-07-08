// Tutorial mission - the scripted core.
//
// PURE + self-contained: the mission script plus the small helpers the engine
// routes through when state.tutorial is set (forced dice, hard-rails step gate,
// step advancement, scripted bot moves). It touches NO other engine module, so
// it can be unit-tested on its own; state.js / engine.js / the routes import
// from here. See docs/tutorial-plan.md.
//
// Design (locked 2026-07-08): hard rails, scripted bot opponents that auto-pass
// (and can drive the auction), NO Module 0, the full 11-step mission
// (industrialize Deimos, ET-produce a robonaut + refinery, industrialize
// Phobos).

// Fixed seed so a restart deals the identical board (chance is forced anyway).
export const TUTORIAL_SEED = 424242;

// How many scripted bot seats sit with the human. They exist so the human has
// opponents to out-bid in the Research auction; they auto-pass by default.
export const TUTORIAL_BOT_COUNT = 2;

// A helper for a step's completion predicate: does the player own a factory at
// `siteId` in the post-op state? Kept loose (reads the same `state.factories`
// map the engine writes) so it survives snapshot shape tweaks.
function playerFactoryAt(state, player, siteId) {
  const f = state && state.factories && state.factories[siteId];
  return !!(f && player && f.ownerId === player.profileId);
}
function playerClaimAt(state, player, siteId) {
  const d = state && state.discs && state.discs[siteId];
  return !!(d && d.outcome === 'success' && player && d.ownerId === player.profileId);
}
function rocketAt(player, siteId) {
  return !!(player && player.rocket && player.rocket.siteId === siteId);
}

// The mission. Each step names the ONE op that advances it (hard rails reject
// anything else), the dice that step needs (queued when the step opens), a
// `satisfiedBy` run against the POST-op state, and a `hint` payload the UI can
// highlight / auto-fill. Free actions (routing, inspecting) are allowed at any
// step - see railsAllows.
//
// Site facts the mission leans on: Deimos + Phobos are the two Martian Moonlets,
// both class A (prospect threshold 3, so a forced 1 auto-claims), 3.0 dv from
// LEO, and directly adjacent. Deimos spectral D drives the ET-produce feedstock.
export const TUTORIAL_SCRIPT = [
  {
    id: 'sell', op: 'FREE_MARKET',
    title: 'Sell a card for money',
    instruction: 'You are short on Aqua. Sell a card from your hand on the Free Market for 3 Aqua.',
    hint: (state, player) => ({ kind: 'FREE_MARKET', cardId: (player.hand || [])[0] }),
    satisfiedBy: (op) => op.kind === 'FREE_MARKET',
  },
  {
    id: 'buy', op: 'AUCTION_START',
    title: 'Buy a card at auction',
    instruction: 'Put the top of a deck up for Research Auction and win it. Your rivals will bid, then drop out.',
    hint: () => ({ kind: 'AUCTION_START' }),
    // The buy completes when the auction the human started resolves to them; the
    // engine flags it on the tutorial state as `boughtThisStep`.
    satisfiedBy: (op, state) => !!(state.tutorial && state.tutorial.boughtThisStep),
  },
  {
    id: 'boost', op: 'BOOST',
    title: 'Boost cards to LEO',
    instruction: 'Boost your rocket parts up to Low Earth Orbit, paying their mass in Aqua.',
    hint: (state, player) => ({ kind: 'BOOST', cardIds: (player.hand || []).slice() }),
    satisfiedBy: (op) => op.kind === 'BOOST',
  },
  {
    id: 'assemble', op: 'BUILD_ROCKET',
    title: 'Assemble the rocket',
    instruction: 'Stack a thruster, its reactor + radiator, a robonaut and a refinery into a rocket.',
    hint: () => ({ kind: 'BUILD_ROCKET' }),
    // Assembly is multi-card; it completes when the stack holds a thruster + a
    // robonaut + a refinery (the industrialize kit). Flagged as `rocketReady`.
    satisfiedBy: (op, state) => !!(state.tutorial && state.tutorial.rocketReady),
  },
  {
    id: 'fuel', op: 'REFUEL',
    title: 'Fuel up',
    instruction: 'Fill your tank from the Aqua bank so you can reach Deimos.',
    hint: () => ({ kind: 'REFUEL' }),
    satisfiedBy: (op) => op.kind === 'REFUEL',
  },
  {
    id: 'fly-deimos', op: 'MOVE',
    title: 'Fly to Deimos',
    instruction: 'Plot a route to Deimos and launch. It is 3 delta-v from LEO.',
    hint: () => ({ kind: 'MOVE', toSiteId: 'deimos' }),
    satisfiedBy: (op, state, player) => rocketAt(player, 'deimos'),
  },
  {
    id: 'prospect-deimos', op: 'PROSPECT',
    title: 'Prospect Deimos',
    instruction: 'Prospect Deimos to claim it. Roll the die (the tutorial guarantees a claim).',
    forcedRolls: [1],
    hint: () => ({ kind: 'PROSPECT', siteId: 'deimos' }),
    satisfiedBy: (op, state, player) => playerClaimAt(state, player, 'deimos'),
  },
  {
    id: 'industrialize-deimos', op: 'INDUSTRIALIZE',
    title: 'Industrialize Deimos',
    instruction: 'Decommission your robonaut + refinery at Deimos to build a Factory (1 VP).',
    hint: () => ({ kind: 'INDUSTRIALIZE', siteId: 'deimos' }),
    satisfiedBy: (op, state, player) => playerFactoryAt(state, player, 'deimos'),
  },
  {
    id: 'et-robonaut', op: 'ET_PRODUCE',
    title: 'Produce a robonaut',
    instruction: 'Use the Deimos Factory to ET-produce a robonaut from a matching hand card.',
    hint: () => ({ kind: 'ET_PRODUCE', siteId: 'deimos' }),
    satisfiedBy: (op) => op.kind === 'ET_PRODUCE',
  },
  {
    id: 'et-refinery', op: 'ET_PRODUCE',
    title: 'Produce a refinery',
    instruction: 'ET-produce a refinery too, so you can industrialize a second site.',
    hint: () => ({ kind: 'ET_PRODUCE', siteId: 'deimos' }),
    satisfiedBy: (op) => op.kind === 'ET_PRODUCE',
  },
  {
    id: 'fly-phobos', op: 'MOVE',
    title: 'Hop to Phobos',
    instruction: 'Phobos is one hop from Deimos. Carry the produced robonaut + refinery there.',
    hint: () => ({ kind: 'MOVE', toSiteId: 'phobos' }),
    satisfiedBy: (op, state, player) => rocketAt(player, 'phobos'),
  },
  {
    id: 'prospect-phobos', op: 'PROSPECT',
    title: 'Prospect Phobos',
    instruction: 'Prospect Phobos to claim it (guaranteed).',
    forcedRolls: [1],
    hint: () => ({ kind: 'PROSPECT', siteId: 'phobos' }),
    satisfiedBy: (op, state, player) => playerClaimAt(state, player, 'phobos'),
  },
  {
    id: 'industrialize-phobos', op: 'INDUSTRIALIZE',
    title: 'Industrialize Phobos',
    instruction: 'Build your second Factory on Phobos. Mission complete!',
    hint: () => ({ kind: 'INDUSTRIALIZE', siteId: 'phobos' }),
    satisfiedBy: (op, state, player) => playerFactoryAt(state, player, 'phobos'),
    last: true,
  },
];

// Ops that are ALWAYS allowed regardless of the current step: inspection +
// route planning + the undo of a mis-step. Everything else must match the step.
const ALWAYS_ALLOWED = new Set([
  'SET_ROUTE', 'CLEAR_ROUTE', 'SET_WIRING', 'SET_CARD_GROUPS',
  'SET_ACTIVE_THRUSTER', 'SET_ACTIVE_PROSPECTOR', 'SET_RADIATOR_SIDE',
  'UNDO', 'REDO', 'END_TURN',
  // The auction is a multi-op exchange; once it is open the bid/pass/sell ops
  // flow (bots included) even though the step's headline op is AUCTION_START.
  'AUCTION_BID', 'AUCTION_PASS', 'AUCTION_SELL', 'AUCTION_RESET',
]);

export function currentStep(state) {
  const t = state && state.tutorial;
  if (!t || t.done) return null;
  return TUTORIAL_SCRIPT[t.step] || null;
}

// Hard rails: may this op be attempted at the current step? Returns null when
// allowed, else a guidance object the route turns into a 4xx.
export function railsBlock(state, op) {
  if (!state || !state.tutorial || state.tutorial.done) return null;
  const kind = op && op.kind;
  if (ALWAYS_ALLOWED.has(kind)) return null;
  const step = currentStep(state);
  if (!step) return null;
  if (kind === step.op) return null;
  return { error: 'tutorial_wrong_step', step: step.id, instruction: step.instruction };
}

// Forced d6: pop the scripted queue when a tutorial is running, else fall back
// to the seeded generator. The engine routes every tutorial-reachable d6 here.
export function tutorialD6(state, gen) {
  const t = state && state.tutorial;
  if (t && Array.isArray(t.rolls) && t.rolls.length) return t.rolls.shift();
  return gen.d6();
}

// After an accepted op, advance the step if it satisfied the current one, and
// open the next step (queue its forced rolls). Returns true if a step advanced.
export function advanceTutorial(state, op, player) {
  const t = state && state.tutorial;
  if (!t || t.done) return false;
  const step = TUTORIAL_SCRIPT[t.step];
  if (!step) return false;
  if (!step.satisfiedBy(op, state, player)) return false;
  // clear the per-step flags the satisfiedBy predicates read
  t.boughtThisStep = false;
  t.rocketReady = false;
  if (step.last) { t.done = true; return true; }
  t.step += 1;
  const next = TUTORIAL_SCRIPT[t.step];
  if (next && Array.isArray(next.forcedRolls)) t.rolls = (t.rolls || []).concat(next.forcedRolls);
  return true;
}

// The scripted move for a bot whose turn it is. Default: pass the turn. During
// the human's auction the bot bids per the current step's `botAuction` script
// (a later increment wires the bid values); for now bots simply pass so the
// human wins the lot at the floor.
export function botMove(state, botProfileId) {
  if (state && state.auction) return { kind: 'AUCTION_PASS' };
  return { kind: 'END_TURN' };
}

// Public step list for the client overlay (no functions).
export function tutorialStepsPublic() {
  return TUTORIAL_SCRIPT.map((s, i) => ({ index: i, id: s.id, title: s.title, instruction: s.instruction, op: s.op }));
}
