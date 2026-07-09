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

// The pinned mission cards (all real deck cards). The human auctions one from
// the market; Buggy supplies the rest. The drive is a two-hop support chain -
// Pulsed Inductive thruster (thrust 4) fed by the Marx Capacitor Bank fed by the
// Cascade Photovoltaic - which teaches chains AND keeps enough net thrust to
// lift back off Deimos with the Phobos kit aboard (Deimos sits behind a lander
// burn, so an under-thrust ship gets no factory assist there: the hop needs
// net thrust 2 after the transport-band and off-Earth solar penalties, i.e.
// base thrust 4. The old Hall Effect at 3 dead-ended the mission). The last two
// cards are the ET-produce feedstock for Phobos.
export const TUTORIAL_BAIT_CARD = 'thr_de_laval_nozzle';       // auctioned first for +6 (unused by the mission)
export const TUTORIAL_MISSION_CARDS = [
  'thr_pulsed_inductive', 'gen_marx_capacitor_bank', 'gen_cascade_photovoltaic',
  'rob_met_steamer', 'ref_cvd_molding',
  'rob_flywheel_tractor', 'ref_foamglass_sintering',
];
// The two Phobos-kit cards are ET-PRODUCE feedstock: ET Production consumes a
// card from the HAND, so Buggy's grant delivers these two to the hand (mass-free
// for the flight out) while the five stack parts land in LEO.
export const TUTORIAL_ET_FEEDSTOCK = ['rob_flywheel_tractor', 'ref_foamglass_sintering'];
// The stack parts (everything that must board the rocket at assembly).
export const TUTORIAL_STACK_PARTS = TUTORIAL_MISSION_CARDS.filter((id) => !TUTORIAL_ET_FEEDSTOCK.includes(id));
// Deck top order per deck type, so each auction surfaces the intended card
// (bait first on the thruster deck, then the mission cards in acquisition order).
export const TUTORIAL_DECK_TOPS = {
  thruster: ['thr_de_laval_nozzle', 'thr_pulsed_inductive'],
  generator: ['gen_marx_capacitor_bank', 'gen_cascade_photovoltaic'],
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
    // The player learns the BUY side of the auction ONCE: auction one part, keep
    // it (the bots pass, so it is free - no bidding), and boost it to LEO. On
    // completion Buggy supplies the remaining five parts straight to LEO, so the
    // whole rocket kit is on hand without grinding through six identical auctions
    // (user 2026-07-08: "auction 2 times and grant the player the rest").
    id: 'acquire', op: 'BOOST',
    title: 'Win a rocket part at auction',
    instruction: 'Put a rocket part up for Research Auction. Your rivals pass, so keep it for free (no bidding), then boost it to LEO. Buggy will supply the rest of the parts.',
    hint: (state, player) => ({ kind: 'BOOST', cardIds: (player.hand || []).slice() }),
    // Completes as soon as ONE rocket part has been boosted to LEO. The
    // onComplete grant (engine.js tutorialAfterOp) then fills in the other five.
    satisfiedBy: (op, state, player) => {
      if (op.kind !== 'BOOST') return false;
      const leo = (player && player.leo) || [];
      return leo.some((s) => TUTORIAL_MISSION_CARDS.includes((s && s.id) || s));
    },
  },
  {
    // The parts sit in the LEO Stack; moving one onto the rocket is the free
    // Cargo Transfer (kind TRANSFER, leo -> rocket), which TRANSFER_STEPS
    // whitelists for this step. BUILD_ROCKET stays the headline op for a player
    // who builds from hand instead.
    id: 'assemble', op: 'BUILD_ROCKET',
    title: 'Assemble the rocket',
    instruction: 'Open the LEO stack and move all five parts onto your rocket (a free Cargo Transfer): the thruster, both generators, the robonaut and the refinery. Power flows in a chain - the photovoltaic feeds the capacitor bank, which feeds the thruster.',
    hint: () => ({ kind: 'TRANSFER', from: 'leo', to: 'rocket' }),
    // Assembly is multi-card; it completes when the stack holds the full kit
    // (thruster + generator + robonaut + refinery). Flagged as `rocketReady`
    // after every accepted op while this step is live (engine tutorialAfterOp).
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
    instruction: 'Move the produced robonaut + refinery from the Deimos outpost onto your rocket (a free Cargo Transfer), then hop to Phobos - one space from Deimos.',
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

// Buggy supplies the rocket parts the player did not auction: every mission card
// not already in LEO is moved there (pulled out of its deck / the player's hand
// first, so the game state stays consistent). Boosted cards land as a plain
// { id, kind: 'patent' } LEO slot, matching applyBoost. Returns the granted ids.
// Called once, when the acquire step completes (see engine.js tutorialAfterOp).
export function grantRemainingParts(state, player) {
  if (!player) return [];
  const leoIds = new Set((player.leo || []).map((s) => (s && s.id) || s));
  const handIds = new Set(player.hand || []);
  const granted = [];
  for (const id of TUTORIAL_MISSION_CARDS) {
    if (leoIds.has(id) || handIds.has(id)) continue;
    // Remove it from whatever deck holds it so the decks never re-offer a part
    // the player already owns.
    for (const type of Object.keys(state.decks || {})) {
      const d = state.decks[type];
      const idx = d ? d.indexOf(id) : -1;
      if (idx >= 0) { d.splice(idx, 1); break; }
    }
    // The Phobos production kit goes to the HAND (ET_PRODUCE consumes hand
    // cards, and hand cards ride mass-free); the stack parts land in LEO.
    if (TUTORIAL_ET_FEEDSTOCK.includes(id)) {
      (player.hand = player.hand || []).push(id);
    } else {
      (player.leo = player.leo || []).push({ id, kind: 'patent' });
    }
    granted.push(id);
  }
  return granted;
}

// The card currently on top of a deck (the one an auction would reveal).
function deckTop(state, type) {
  const d = state && state.decks && state.decks[type];
  return (d && d.length) ? d[0] : null;
}

// The one human seat in a tutorial game (everyone not in the bot roster).
function tutorialHuman(state) {
  const bots = (state && state.tutorial && state.tutorial.bots) || [];
  return ((state && state.players) || []).find((p) => !bots.includes(p.profileId)) || null;
}

// Is the human holding a won-but-not-boosted rocket part? While they are, the
// acquire step is in its BOOST phase: no further auction may open (the mission
// is exactly two auctions - the sell and one part), the next move is boosting.
function holdingWonPart(state) {
  const human = tutorialHuman(state);
  return !!human && (human.hand || []).some((id) => TUTORIAL_MISSION_CARDS.includes(String(id)));
}

// Does the CURRENT step permit this exact op (kind + key params)? The default is
// the single named step.op; the two auction steps allow a tightly-scoped set of
// auction ops instead. The player never bids, passes, resets, or auctions a deck
// whose top is not the scripted card - those all fall through to `false`.
// Steps where the free Cargo Transfer between the player's OWN colocated stacks
// is part of the lesson: assembling moves the parts LEO -> rocket, the Phobos
// leg moves the ET-produced kit outpost -> rocket (INDUSTRIALIZE consumes from
// the rocket stack). ET Production is grouped in so a player may load the fresh
// product right away instead of waiting for the fly step.
const TRANSFER_STEPS = new Set(['assemble', 'et-robonaut', 'et-refinery', 'fly-phobos']);

function stepAllows(step, op, state) {
  const kind = op && op.kind;
  const auctionOpen = !!(state && state.auction);
  // Cargo Transfer rides along on the steps that need it (it moves cards between
  // the player's own colocated stacks - no rule effect beyond loading).
  if (kind === 'TRANSFER' && TRANSFER_STEPS.has(step.id)) return true;
  if (step.id === 'sell') {
    // Auction ONLY the bait (top of the thruster deck), then close - the engine
    // forces the close to the top bot, and the bots drive the price to 6.
    if (kind === 'AUCTION_START') return !auctionOpen && op.deckType === 'thruster' && deckTop(state, 'thruster') === TUTORIAL_BAIT_CARD;
    if (kind === 'AUCTION_SELL') return auctionOpen;
    return false;
  }
  if (step.id === 'acquire') {
    // Auction ONE deck whose top is a rocket part, keep it (the bots pass), then
    // BOOST it up to LEO. Once a part is in hand no further auction may open -
    // the mission is exactly two auctions total, and the stuck loop of
    // re-auctioning while the won part sits in hand is closed off.
    if (kind === 'AUCTION_START') {
      return !auctionOpen && !holdingWonPart(state)
        && TUTORIAL_MISSION_CARDS.includes(deckTop(state, op.deckType));
    }
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
  // Phase-aware guidance: mid-acquire with the won part in hand, the generic
  // "put a part up for auction" line is exactly the wrong advice - name the
  // real next move (boost) instead.
  let instruction = step.instruction;
  if (step.id === 'acquire' && holdingWonPart(state)) {
    instruction = 'You won your rocket part - now boost it to LEO: open your Hand, tap the card to mark it, then hit BOOST to LEO. Buggy hands you the rest once it reaches orbit.';
  }
  return { error: 'tutorial_wrong_step', step: step.id, instruction };
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
