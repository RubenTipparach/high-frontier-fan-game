# M4 (Exodus) handoff

Written 2026-11-16 at the end of a long session, for whoever picks M4 up next.
Read CLAUDE.md first, then `docs/module-m4-plan.md` (the stage plan and the
"Stage 1 status" / "Stage 2 status" sections), then this.

## Where things are

- **Branch:** `claude/nodeploy-m4-contracts`. The `nodeploy` name means a push
  runs no CI and deploys nothing, so nothing here is live. Head is `5aa285a`.
- **PR:** #112 (draft, into `main`), "M4 (Exodus): admin-only preview gate +
  plan (Stage 1a)". Its title and body predate most of the work; update them
  before asking for review.
- **Playtest recordings:** https://claude.ai/artifact/PUHLBEe42L9GFcbXs92pcu,
  five reels with rule notes: the contract auction; boost, fly and fulfill; late fee
  and default; augmenting a colonist; a contract in hand being lost and then
  abandoned. The page is private to the owner.
- **Gate:** M4 is an ADMIN-ONLY preview (`profileIsAdmin` on create and room
  settings), and it forces M0 on. Stage 2 also needs `state.m2`. It does not
  combine with a variant yet (`m4_no_variants`).

## What works (all on `state.m4`, all with checks)

`node scripts/check-engine.mjs` runs 271 checks, all passing.
`node scripts/check-boot.mjs` passes.

**Contracts (Stage 1):**
- Three ideology-pair decks, built from the spreadsheet (see Card data below).
- The contract auction at the end of a Fundraise. It is the existing
  `state.auction` with `kind: 'contract'` and ops `AUCTION_CONTRACT_START / BID
  / PASS / CLOSE`. Bids are years, 10 down to 0, and the lowest bid wins.
  - The finder's fee is 1 aqua.
  - The lot resolves at 10 years when no rival can bid.
  - Auctions are refused during Anarchy or War.
  - You can't bid on a manned contract while holding the default chit.
- **A won contract is a Hand card (4B3h).** It is stored in
  `player.contractHand`, separate from `player.hand`, because it ignores the
  academia hand limit, pad explosions and budget cuts.
  - The client draws it in the Hand strip. `hand.js#hydrateHand(ids,
    contracts)` holds it and `getContractHandSlots()` reads it.
    `getHandSlots()` never returns contracts, so Free Market, ET Produce and
    the hand-limit count can't see them. Keep it that way.
  - A contract in default is drawn sideways in the hand.
- **Boost** uses the normal BOOST op and the hand's boost marks. A contract
  boosts on the side it was won on. Boosted, it is a stack slot
  `{ id, kind: 'contract', face }`.
- **Fulfilment:** `FULFILL_CONTRACT` checks the destination steps.
  - The Destination Steps language is described at the top of
    `data/contracts.js`. `at:` steps use PLANNER slugs (with hyphens).
  - 52 of the 84 faces can be checked by the engine. The other 32 are
    `manual:` steps and are refused with `destination_not_yet_supported`.
  - Fulfilling counts as a Glitch trigger.
- **Late fees and default:** the timepiece flips to deadbeat in
  `advanceClock`, and Mishap Insurance pays the first fee. The `PAY_LATE_FEE`
  op pays toward the fee or the debt.
  - Not paying in full by END_TURN puts the contract in default.
  - Debt repayment discards the contract and claims the default chit.
  - Endgame scoring: fulfilled VP, -1 per unpaid aqua, and -3 or -6 for the
    default chit.
- **Losing a contract (4B6a):** every path that takes a contract off a stack
  goes through `engine.js#decommissionSlotTo`. That covers DECOMMISSION, a
  destroyed rocket (a hazard, or parking on an aerobrake) and a lost Freighter.
  - An unmanned contract comes back to the contract hand, upright and
    boostable again.
  - A manned one comes back in default, and its owner claims the chit.
  - If you add a new way to lose cards, route contracts through that function.
- **Discarding:** the only discard is `ABANDON_CONTRACT` (4B7d). The user ruled
  2026-11-16: "contract cannot be discarded unless in anarchy".
  - It is legal only during Anarchy or War, and never for a military contract.
  - It works from the hand, at LEO, or at any player's anchored Bernal.
  - The contract goes to the bottom of its deck and the timepiece comes home.
    No late fee or repayment is owed, and the owner claims the default chit.
- Inspiration cycles the contract decks too (K2a).

**Augmentations (Stage 2, `state.m4 && state.m2`):**
- `IMPLANT` places portfolio chits on Colonists aboard your anchored Bernal.
  - Your portfolio is the cybernetics icons on your fulfilled contracts.
  - You hold one chit per shape, and you can juggle a chit to another Colonist.
  - An Industrialist aboard makes implanting free once a turn.
- It needs a **BEO Colony**. The user ruled 2026-11-15 that with M2 this means
  one of your Bernals anchored Dirtside: an anchored Bernal that is NOT your
  Home Bernal. A colony dome does not count.
- Promoting a colonist needs at least one augmentation (4C7e).
- Retiring a colonist returns its chits.

**Client:**
- `js/game/contracts-ui.js`:
  - the toolbar "contracts" tag;
  - the Contracts panel: timepiece, default chit, decks, boosted, fulfilled and
    augmentations;
  - the contract auction overlay;
  - shared helpers the hand strip in `browse.js` uses (`abandonBlock`,
    `contractFeeDue`, `payContractFee`, `abandonContract`).
- `js/game/contract-card.js` renders contract cards.
- `MP_LOG_ICONS` and the `M4_ERRORS` messages in `browse.js` cover every M4 op.

## Next work, roughly in order

1. **Contract abilities (rest of Stage 1).** tophat (one free hazard per turn),
   Hazard / Aerobrake Ignore, Shielded (-2 belt and CME), Insight, Secured,
   Bailout, Connections, and the "When Fulfilling" effects. A contract in
   default has all its abilities switched off (4B6b). Each one needs a check.
2. **Rest of Stage 1:**
   - contract negotiation (4B2g);
   - a tie-winner picker in the auction overlay (the engine accepts `winnerId`);
   - Freighter / Bernal / outpost stacks carrying a contract. `findContractSlot`
     only looks in LEO and the rocket, and abandonment checks Bernal stacks by
     hand.
3. **The 32 `manual:` destination steps.** They need module pieces such as
   Bernals, Colonies, Freighters, the isobank and some map geometry. Extend the
   steps language in `data/contracts.js` and the sheet's Destination Steps
   column. Don't special-case cards in JS.
4. **Stage 2 remainder:**
   - the twelve augmentation side abilities (4C3);
   - Parenthood on the heart chit (4C5; heart side 1 is refused for now);
   - enterprises and partner enterprises (4B8);
   - the 4C7e promotion counts for Freighter / Bernal / GW;
   - drawing the chit glyph and the Spaceborn icon on the colonist card in the
     game UI.
5. **Stage 3:** isotope monetization, the isobank and isobanker, gold-side
   upheaval, Exodus contracts, the starship launch.
6. **Release later** with the four-step checklist in CLAUDE.md. Before that,
   look at CEO Solitaire's own M4 rules (4G), which are not wired.

## Open questions for the user

- **Abandoning from the hand.** 4B7d says you abandon "by taking its card to
  LEO or the Anchored Bernal of any player". I also allowed it straight from
  the hand, on the reading that the hand is with your Bank in LEO (4A7a). The
  user has not confirmed this. Requiring a boost to LEO first is a one-line
  change in `applyAbandonContract`.
- **Duplicate list in the Contracts panel.** The panel no longer lists in-hand
  contracts and points to the Hand area instead. The user said "There's an area
  for hand cards", which is how I read it.
- **Asking questions:** the `html-survey` skill is installed
  (`.claude/skills/html-survey`), but there is no survey page yet. Use it for
  owner-only decisions instead of asking in chat.
- **OpenSpec:** the user asked whether it is installed. It isn't. Fleet Command
  has an `openspec/` folder and seven `openspec-*` skills that could be brought
  in the same way html-survey was. Nobody has asked for that yet.

## Card data

- Contracts come from `reference/HF4-card-data.xlsx`, from the tabs
  `Contracts`, `Exodus Contracts` and `Spaceborn Colonists`.
- Run `python3 scripts/extract-card-data.py` to regenerate
  `data/card-data.json` / `.js`. Never hand-author stats.
- The blue side is the primary face and the gold side the secondary face.
- `Destination Steps` is the engine's restatement of the printed destination.

## Art status (task still open)

- **Contract cards:** each card has a unique SVG foreground
  (`scripts/gen-contract-craft.mjs`, writing to
  `assets/cards/contracts/craft/<code>.svg`) drawn over a Blender backdrop
  (`assets/cards/contracts/<code>-3d.webp`).
  - The Blender scripts are `scripts/card-art/blender/render_contracts.py` and
    `composite.py`.
  - The user approved the direction: 3D planets as backdrops, SVG craft in
    front, black see-through text boxes, unique art per card.
- **Colonists:** the SVG set was chosen (`data/colonist-art.js`).
- **Mockup with the originals side by side:** `docs/mockups/m4/index.html`.
- **Not yet in the game UI:** the Spaceborn icon and the augmentation chit
  glyph on colonist cards. Per CLAUDE.md a new glyph needs the user's sign-off
  on a rendered preview before it is wired in. Putting the Spaceborn glyph in
  `card-ui.js` was refused once for this reason.

## Gotchas learned the hard way

- **`check-engine.mjs` verdict.** Until `5aa285a`, the exit check sat midway
  through the file. Checks below it could fail without failing the run. There
  is now a final verdict at the end; keep new checks above it.
- **Site ids.** `rocket.siteId` and contract `at:` steps use planner slugs
  (with hyphens, e.g. `mars-north-pole`), not `data/sites.js` underscores. Read
  CLAUDE.md "Site IDs" before touching destination steps.
- **"Moon" vs "Luna".** The body is `Luna`.
- **`FUNDRAISE` can come back `star_choice_required`.** Tests retry with a star;
  see `fundraise()` in check-engine.
- **Undo.** A contract auction is a commit point and cannot be undone. BOOST and
  TRANSFER of a contract can be undone.

## Testing locally (never touches production)

Use the `game-test-sandbox` skill. The recipe that worked:

- **Server:**
  `cd server && PORT=8790 DATABASE_PATH=<scratch>.db RAT_ADMIN_NAMES=alice,bob node index.js`.
  Admin names are needed because M4 is admin-only.
- **Site:** `python3 -m http.server 8137` from the repo root.
- **Pointing the page at the local server:** `index.html` points at the
  production API, so in Playwright route
  `https://high-frontier-fan-game.fly.dev/**` to `http://localhost:8790`. Seed
  `localStorage['hf.profile']` with `{name, token, id, createdAt, lastSeenAt}`.
- **Game setup:**
  - Create profiles, a lobby with `m4: true`, start, and `PICK_CREW` over REST.
  - For the editor, put a local `hfe_` edit token straight into the scratch
    database's `read_tokens` table with `scope 'edit'`.
  - The first seat is random. Script against "the holder", not a fixed name.
- **Repeatable dice:** set `state.rng.cursor` in the scratch database. To find
  a cursor that gives the roll you want, run `applyOperation` on a copy of the
  state.
  - Changes made straight to the database don't advance the op sequence, and
    the client only re-reads a board when the sequence moves. Follow a database
    change with a harmless op, such as `SET_CARD_GROUPS` with `groups: []`.
- **Recording:** use Playwright `recordVideo`, put the caption in an injected
  fixed `<div>`, then convert with
  `ffmpeg -ss <load time> -c:v libx264 -pix_fmt yuv420p`.
- The scratch scripts from this session lived in the session scratchpad and
  are gone. The recipe above is enough to rebuild them.

## Standing rules from the user (also in CLAUDE.md)

- Never change a live game without the admin's explicit approval, through MCP
  or anything else.
- Don't use `send_later` check-ins.
- No em dashes and no unicode arrows in prose or commits.
- No model ids in commits or PRs.
- Show a rendered preview of any new SVG glyph before wiring it in.
- Exercise every change before pushing.
- Keep M4 work on a `nodeploy` branch until the user says otherwise.
