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

// The human opens with 6 Aqua.
export const TUTORIAL_START_AQUA = 6;

// The two scripted bot seats (synthetic ids - never real accounts, so only the
// server ever drives them).
export const TUTORIAL_BOT_IDS = ['tut-bot-a', 'tut-bot-b'];
export const TUTORIAL_BOT_NAMES = { 'tut-bot-a': 'Cosmo Corp', 'tut-bot-b': 'Orbital Rival' };

// The pinned mission cards (all real deck cards). The human auctions these from
// the market. A single solar generator powers the whole rocket (no reactor /
// radiator lesson); the last two are the ET-produce feedstock for Phobos.
export const TUTORIAL_BAIT_CARD = 'thr_de_laval_nozzle';       // auctioned first for +6 (unused by the mission)
export const TUTORIAL_MISSION_CARDS = [
  'thr_hall_effect', 'gen_cascade_photovoltaic',
  'rob_met_steamer', 'ref_cvd_molding',
  'rob_flywheel_tractor', 'ref_foamglass_sintering',
];
// Deck top order per deck type, so each auction surfaces the intended card
// (bait first on the thruster deck, then the mission cards in acquisition order).
export const TUTORIAL_DECK_TOPS = {
  thruster: ['thr_de_laval_nozzle', 'thr_hall_effect'],
  generator: ['gen_cascade_photovoltaic'],
  robonaut: ['rob_met_steamer', 'rob_flywheel_tractor'],
  refinery: ['ref_cvd_molding', 'ref_foamglass_sintering'],
};

// Reorder shuffled decks so the tutorial cards sit on top in the scripted order
// (the rest follow, still shuffled). Pure: returns a new decks map.
export function tutorialReorderDecks(decks) {
  const out = {};
  for (const type of Object.keys(decks || {})) {
    const have = decks[type] || [];
    const tops = (TUTORIAL_DECK_TOPS[type] || []).filter((id) => have.includes(id));
    const rest = have.filter((id) => !tops.includes(id));
    out[type] = [...tops, ...rest];
  }
  return out;
}

// The fresh tutorial progress block for a new game.
export function freshTutorialState() {
  return {
    step: 0, done: false,
    rolls: (TUTORIAL_SCRIPT[0] && TUTORIAL_SCRIPT[0].forcedRolls || []).slice(),
    bots: TUTORIAL_BOT_IDS.slice(),
    soldThisStep: false, boughtThisStep: false, rocketReady: false,
    won: [],   // mission card ids the human has won at auction
  };
}

// Two scripted bot seats sit with the human. They run the auction economy:
//   EARN  - the human auctions a card, the two bots bid it up to 6, and the
//           human sells to the top bot to collect 6 Aqua (the auctioneer banks
//           the winning bid, engine.js applyAuctionSell).
//   BUY   - a bot auctions a Deimos-spectral (D) card the human needs; the bots
//           sit at the floor and the human bids 1 to BEAT them and win it for 1.
// The bots never belong to a real account, so the server drives their scripted
// starts / bids / passes / closes (botMove) - no AI.
export const TUTORIAL_BOT_COUNT = 2;
export const TUTORIAL_SELL_PRICE = 6;   // the price the bots drive the first lot to

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
    id: 'sell', op: 'AUCTION_START',
    title: 'Auction a card to earn Aqua',
    instruction: 'Put a card up for Research Auction. Your two rivals will bid it up to 6 Aqua - sell to the top bidder to bank the money.',
    hint: () => ({ kind: 'AUCTION_START' }),
    // Completes when the human CLOSES the sale to a bot (auctioneer banks the
    // bid). The engine flags it as `soldThisStep`.
    satisfiedBy: (op, state) => !!(state.tutorial && state.tutorial.soldThisStep),
  },
  {
    // Buy + boost interleave: you can only hold a few cards, so win a part at
    // auction (bid 1 to beat the passing bots), boost it up to LEO to clear your
    // hand, and repeat until all six rocket parts are in orbit.
    id: 'acquire', op: 'BOOST',
    title: 'Win your rocket parts and boost them up',
    instruction: 'Put each rocket part up for auction and bid 1 to beat the bots, then boost it to LEO (paying its mass in Aqua). Repeat until all six parts are in orbit.',
    hint: (state, player) => ({ kind: 'BOOST', cardIds: (player.hand || []).slice() }),
    // Completes when every mission card sits in the human's LEO stack.
    satisfiedBy: (op, state, player) => {
      const leo = (player && player.leo) || [];
      const ids = new Set(leo.map((s) => (s && s.id) || s));
      return TUTORIAL_MISSION_CARDS.every((id) => ids.has(id));
    },
  },
  {
    id: 'assemble', op: 'BUILD_ROCKET',
    title: 'Assemble the rocket',
    instruction: 'Stack the thruster, its generator, a robonaut and a refinery into a rocket. The generator powers everything.',
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

// Pure-prep ops with NO game-state consequence: route planning, wiring, active-
// card selection, cosmetic grouping. These are the only ops allowed at every
// step (the player needs them to line up a move / activate the thruster before
// fuelling). Everything else must be exactly what the current step wants -
// notably the player can never end the turn / pass, undo, bid, or auction a deck
// off-script. (The budget auto-refills after each op, so no turn ever ends.)
const PREP_OPS = new Set([
  'SET_ROUTE', 'CLEAR_ROUTE', 'SET_WIRING', 'SET_CARD_GROUPS',
  'SET_ACTIVE_THRUSTER', 'SET_ACTIVE_PROSPECTOR', 'SET_RADIATOR_SIDE',
]);

export function currentStep(state) {
  const t = state && state.tutorial;
  if (!t || t.done) return null;
  return TUTORIAL_SCRIPT[t.step] || null;
}

// The card currently on top of a deck (the one an auction would reveal).
function deckTop(state, type) {
  const d = state && state.decks && state.decks[type];
  return (d && d.length) ? d[0] : null;
}

// Does the CURRENT step permit this exact op (kind + key params)? The default is
// the single named step.op; the two auction steps allow a tightly-scoped set of
// auction ops instead. The player never bids, passes, resets, or auctions a deck
// whose top is not the scripted card - those all fall through to `false`.
function stepAllows(step, op, state) {
  const kind = op && op.kind;
  const auctionOpen = !!(state && state.auction);
  if (step.id === 'sell') {
    // Auction ONLY the bait (top of the thruster deck), then close - the engine
    // forces the close to the top bot, and the bots drive the price to 6.
    if (kind === 'AUCTION_START') return !auctionOpen && op.deckType === 'thruster' && deckTop(state, 'thruster') === TUTORIAL_BAIT_CARD;
    if (kind === 'AUCTION_SELL') return auctionOpen;
    return false;
  }
  if (step.id === 'acquire') {
    // Auction ONLY a deck whose top is a still-needed rocket part, keep it (the
    // bots pass), then boost it up to LEO. No other deck, no bidding.
    if (kind === 'AUCTION_START') return !auctionOpen && TUTORIAL_MISSION_CARDS.includes(deckTop(state, op.deckType));
    if (kind === 'AUCTION_SELL') return auctionOpen;
    if (kind === 'BOOST') return true;   // only mission cards are ever in hand here
    return false;
  }
  // Every other step is a single scripted operation.
  return kind === step.op;
}

// Hard rails: may this op be attempted at the current step? Returns null when
// allowed, else a guidance object the route turns into a 4xx. Applied to EVERY
// human op (engine hoists this above the auction dispatch), so nothing slips
// through - the player is locked to the step's exact action.
export function railsBlock(state, op) {
  if (!state || !state.tutorial || state.tutorial.done) return null;
  const kind = op && op.kind;
  if (PREP_OPS.has(kind)) return null;
  const step = currentStep(state);
  if (!step) return null;
  if (stepAllows(step, op, state)) return null;
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

// The scripted move for a bot whose turn it is. Returns an op INTENT; the server
// driver fills concrete ids (which deck to auction, the buyerId to close to).
//
//  - EARN lot (human is auctioneer, 'sell' step): each bot bids the lot UP in +3
//    jumps until it reaches TUTORIAL_SELL_PRICE (6), then passes. The human
//    closes to the top bot and banks 6.
//  - BUY lot (a bot is auctioneer, 'buy' step): bidder bots PASS (sit at the
//    floor) so the human wins by bidding 1; the auctioneer bot CLOSES to the
//    human once the bidders have acted.
//  - A bot's own turn with no auction during the 'buy' step: the bot STARTS an
//    auction of the next card the human needs.
//  - Otherwise: pass the turn.
export function botMove(state, botProfileId) {
  const step = currentStep(state);
  const a = state && state.auction;
  // The human is the auctioneer for every lot; bots only ever bid or pass.
  //  - SELL step (the bait): bid the lot UP in +3 jumps to 6, then pass, so the
  //    human sells it to the top bot and banks 6.
  //  - Everything else (the ACQUIRE lots): pass, so the human wins at their 1 bid.
  if (a && a.auctioneerId !== botProfileId) {
    if (step && step.id === 'sell') {
      const high = a.highBid || 0;
      if (high < TUTORIAL_SELL_PRICE) return { kind: 'AUCTION_BID', amount: Math.min(TUTORIAL_SELL_PRICE, high + 3) };
    }
    return { kind: 'AUCTION_PASS' };
  }
  return { kind: 'END_TURN' };
}

// Public step list for the client overlay (no functions).
export function tutorialStepsPublic() {
  return TUTORIAL_SCRIPT.map((s, i) => ({ index: i, id: s.id, title: s.title, instruction: s.instruction, op: s.op }));
}
