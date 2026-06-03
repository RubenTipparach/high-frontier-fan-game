# High Frontier Fan Game - agent notes

Persistent project rules for future sessions. Read this first.

This is a fan implementation of **High Frontier 4: All** (Sierra Madre Games,
designed by Phil Eklund). Pure educational / fan project, not for sale, not
affiliated with the publisher.

## Design language - CRITICAL

The audience for this implementation is people who already play HF4 at the
table. **Every visual and interaction must feel like the published game.**
If a returning player can't tell at a glance what a glyph means, what a
hexagon represents, or what step of a turn they're in, the design is wrong.

Concretely:
- Card glyphs (thrust triangle + pink circle, water-droplet fuel,
  spectral hex, requirement-icon row, half-rocket for half-lander,
  ☠ skull, 🪂 aerobrake, 🛰 push-sat, the ⚡ pulse / 🌡 thermostat
  family for stack requirements) must use the same shapes / colour
  language as the published cards. If a glyph means N on the
  table, it must mean N here.
- Map idioms - flat-top hexagons over body halos, magenta burn
  pads with rockets, orange Lagrange rings, green Hohmann dots,
  Saturn ring tilt + Cassini gap, pulsing red hazards - exist
  because the published board uses them. Don't invent
  replacements that "look better"; align with the board.
- When you introduce a new affordance, ask: "would a tabletop
  player recognise this without a tutorial?" If no, redesign.
- Mechanics-only changes (engine, scoring, balance tuning) are
  fine to invent; visual language is not.

- Core rules PDF (publisher-hosted):
  https://gamers-hq.de/media/pdf/c5/f2/cf/HF4-Core-Rules.pdf
- Variants & scenarios appendix:
  https://geekach.com.ua/content/files/varanti-ta-scenar-high-frontier-4-all-anglyskou-movou-62879102.pdf
- BGG entry: https://boardgamegeek.com/boardgame/281837/high-frontier-4-all
- **HF gazetteer (heliocentric zones, site classifications):**
  https://www.iandrea.co.uk/sf/resources/hf/HFgazetteer.html
  - canonical reference for which solar zone (Mercury / Venus /
  Earth / Mars / Ceres / Jupiter / Saturn / etc.) each named
  site sits in, plus apparition / synodic season tags. The
  popup tags rendered in `js/game/render.js#_buildSitePopup`
  (`<site> zone`, `<season> season`) read from
  `data/sites.js`'s `solarZone` + `siteSynodic` fields, which
  are sourced from this gazetteer.
- **HF reference hub (iandrea):** https://www.iandrea.co.uk/sf/highfrontier/
  - the author's High Frontier index page: rules summaries, maps,
    the gazetteer above, and other play aids.
- Reference repo for architecture/login/deploy patterns:
  https://github.com/RubenTipparach/murdoku-companion

See `reference/references.md` for this same link list alongside the
checked-in reference assets (manuals, maps, spreadsheets).

## Variants we target

Scope is intentionally narrow - only two play modes ship in this
implementation right now:

- **Standard** - the base multiplayer game described in the core
  rulebook. Drives the lobby / multiplayer engine.
- **CEO Solitaire** - the published one-player variant. Drives
  the solo mode (`js/game/solo.js`); a single player runs one
  ship against a round clock with no AI opponent. Engine is
  original; only the structural concept (manage water, prospect,
  claim, end-of-round income) is taken from the variant's design.

Other variants (campaign, scenarios) are explicitly out of scope
for now. Don't pull them in without a discussion first.

## Card data - single source of truth

**Card data MUST come from the spreadsheet.** The authoritative
source is `reference/HF4-card-data.xlsx` (kept in sync with the
shared Google Sheet). The importer
`scripts/extract-card-data.py` emits `data/card-data.json`
(for human audit) and `data/card-data.js` (for the browser).
`data/patents.js` consumes only the `.js` bridge - do not
hand-author patent records in `patents.js` and do not embed
literal stat tables in any other file.

If a card concept (a new column, a new card type, a balance
tweak) doesn't appear in the spreadsheet, it doesn't exist yet
- either edit the spreadsheet and re-run the importer, or push
back on the request. Don't paper over missing sheet data with
ad-hoc constants in JS.

Two structural rules that fall out of the sheet:
- **Labs and "modifier" cards aren't HF4 cards.** The
  spreadsheet has no Labs or Modifiers tab. Lab effects live
  as abilities on the parent card; modifier-style upgrades are
  the Tier-2 (dark-side) face of an existing card.
- **The "dark side" is a real second technology.** Every
  card-row in the spreadsheet is followed by a second row
  carrying a different name + different stats - that's the
  Tier-2 tech the same physical card flips to. Render both
  faces; don't treat the back as a re-skin of the front.
- **"Support Requirements" banner only.** Only the columns
  under that banner (the reactor/generator-type matrix) are
  stack supports. Other booleans like Push / Solar / Air Eater
  / ISRU describe what a card IS / DOES - render them as
  card-property badges, never as supports.

## Card model

Every card on the map / in a hand carries the same minimum set of
fields so the renderer + engine don't need per-card-type branches
for the common stats:

- `id` - stable string key
- `name` - display label
- `type` - `thruster | reactor | radiator | refinery | robonaut |
  generator | lab | crew | ...`
- `mass` - wet mass added to the ship stack (integer units)
- `radHardness` - rad-hardness rating (integer); cards with low
  values degrade faster near radiation hazards
- `faces` - `{ primary, secondary }`. Every component card is
  double-sided. By convention the **secondary face is the "black"
  / installed face**. Faces can carry their own stats so a
  flipped card behaves differently (e.g. a radiator opened vs
  stowed, or a thruster with a mode change).
- `flipOrientation` - `'standard'` (default) or `'rotated180'`.
  Radiators are typically `'rotated180'`: their secondary face is
  drawn upside-down, matching the published cards.

Thruster-specific fields (carried on whichever face is active):
- `thrust` - push capacity (rendered as the value inside the pink
  thrust circle on the card). Triangle silhouette is fixed-size
  per the published convention; only the number inside the
  pink circle changes per card.
- `isp` - thrust per fuel step. The card's fuel droplet shows
  `ceil(thrust / isp)` (= the card's `fuel`), the FUEL STEPS one burn
  spends - NOT a water cost. See "Fuel steps vs water / aqua" below.
- `requires` - array of `{ kind, count }`. Stack constraints the
  ship's other cards must collectively satisfy. The card UI
  renders the requirement icons in a row (with an ×N badge for
  count > 1). `data/patents.js` exports `REQUIREMENT_KINDS` as
  the canonical enum (pulse-generator, thermostat,
  crew-quarters, sail, beam-receiver, push-sat, isru-rig,
  aerobrake-shroud, spin-grav). Other cards "supply" these
  kinds at BUILD time; thrusters consume them.
- `supports` (string array) is accepted as shorthand and auto-
  expanded into `requires` with count: 1 per entry.

**Fuel steps vs water / aqua - NOT the same unit.** A *fuel step* is
one black (burn) connection on the detailed fuel graph
(`js/game/net-thrust-detail.js`, the published net-thrust ladder).
Entering a burn node spends the thruster's `fuel` fuel steps, walking
the wet-mass chit that many black connections down toward dry mass. The
rocket's total burnable capacity is the count of black connections from
the WET chit to the DRY chit (`blackStepsBetween`). *Water* and *aqua*
are 1-to-1 mass units (tank water = wet mass - dry mass; aqua converts
1:1 to water). Fuel steps map to water only NON-linearly through the
ladder (a step buys less mass-fraction the heavier the ship: ninths in
WISP ... whole units in TUG), so "N fuel steps" is never "N water". Burn
costs in logs / UI are denominated in fuel steps, not water.

**When the user says "FT", STOP and ask which they mean.** "FT" is
ambiguous - it can mean AQUA (the bank currency) or fuel steps. Don't
guess: say it's ambiguous and ask whether they mean aqua or fuel steps
before acting.

**Fuel economy rules (the target model):**
- **Burning** walks the BLACK connections (fuel steps). A burn spends
  the thruster's `fuel` fuel steps; the water that costs is the
  non-linear mass-drop of those steps, so the tank can end on a
  fractional position (a sub-1-unit *remainder*).
- **Fuelling / unfuelling** walks the RED (refuel) connections. Water
  moved to an outpost or back to the bank moves in WHOLE water units
  only; any sub-1-unit remainder CANNOT be transferred and stays in the
  source tank. Show that remainder in the fuel-tank modal.
- A stack can be **scrapped** when it has no cards AND less than 1 unit
  of water left.

RECONCILE IN PROGRESS (user chose "full reconcile" 2026-06-03; the
canonical count is `blackStepsBetween`, the detail graph): until it
lands, `data/net-thrust-track.js#fuelStepsBetween` (used by the stack
readout + `getActiveThrusterStats().burnsAvailable`) still returns a
DIFFERENT count than the detail graph, and MOVE still deducts the
per-burn cost from the water tank 1-to-1 (`ceil(fuel * burns)` vs
`tank`). The reconcile moves the detail-graph node model into a shared
dir (so client AND server share it), switches capacity + burn cost to
the black/red connections, and makes burns leave a fractional remainder.

NOTE: there is NO `power_req` field. Older drafts had one; it
was removed because requirements are gated through the kind/
count system instead.

Spectral type:
- Every card carries a `spectralType` (default 'C'). One of
  C / S / M / V / B / D. Rendered as a coloured hex glyph in
  the card's stat box; the engine (Stage 3+) can use it for
  refuelling / matching at sites.

Crew cards: still double-sided, but the two faces are
**functionally independent** - each face is its own crew member
with their own role / skills, sharing only the physical card.
Use `faces.primary` and `faces.secondary` as fully-formed crew
records; nothing should treat the "back" of a crew card as a
secondary mode of the front.

Some cards (boosters, augments, certain robonauts) **modify**
another card's stats while attached. The engine handles this via
a `modifier` block on the modifying card; see
`server/game/engine.js` (Stage 3+) for how those compose.

## Stages - build incrementally

Verify each stage before starting the next. Don't conflate stages in a
single PR.

- **Stage 1 (done):** Identity + social layer. Profiles, lobby
  (create / list / join), chat, friend search, invite links. Game
  surface was a placeholder.
- **Stage 2 (current):** Static data + read-only renderer. The
  solar-system map (`data/sites.js`), patent deck (`data/patents.js`),
  and milestones (`data/glory.js`); an SVG renderer with pan/zoom;
  a ship-card composer (validation rules + burn-cost math) ready
  for Stage 3 to call. A Browse view on the topbar lets anyone
  inspect the data; the lobby's game-overlay now mounts the map
  (read-only) when the host starts.

  NOTE: there is no separate "politics / events deck". The only
  events in this game are the Sunspot Cube events surfaced by the
  turn-clock modal (Inspiration / Glitch / Pad Explosion / Anarchy
  / Budget Cuts / Solar Flare - see `EVENT_TABLE` in
  `js/game/turn-clock.js`). An earlier `data/politics.js` with a
  "Solar Storm / Mining Boom / Trade War" deck was a fabrication
  and has been deleted; do not reintroduce it.
- **Stage 3:** Server-authoritative engine. Operations phase, MOVE /
  BURN / PROSPECT / INDUSTRIALIZE / AUCTION / BUILD ops. Validated
  on the server; optimistic mirror on the client. New tables in
  `server/db.js` for games, operations, and per-game state.
- **Stage 4:** Full coverage. Refineries, habitat / Bernal stations,
  Sunspot-Cube event resolution, milestone awards, futures market,
  end-of-game scoring.

If you're adding a feature, mark the stage it belongs to in the
commit message so the boundaries stay legible.

## Architecture

Mirrors the murdoku-companion split:

```
┌────────────────────────────────┐   HTTPS+CORS   ┌────────────────────────────────┐
│ GitHub Pages                   │ <------------> │ Fly.io app: high-frontier-fan-game  │
│ esbuild bundle -> dist/ (hashed)│  WS (wss://)  │  Express + ws + better-sqlite3│
│ index.html, css/*, js/*        │ <------------> │  volume: /data/hf.db          │
│ deployed on every branch       │                │  admin at /admin              │
└────────────────────────────────┘                └────────────────────────────────┘
```

- **Frontend**: plain HTML/CSS/ES modules, no framework. Local dev is
  build-free (serve the repo root; `index.html` loads the raw `./js/main.js`
  as ES modules). PRODUCTION runs one build step: `scripts/build.mjs` bundles
  + minifies with esbuild into `dist/` using content-hashed filenames, and CI
  deploys `dist/` to GH Pages on every push to every branch. The hash is the
  cache-bust: a changed module gets a new URL, so clients can never get stuck
  on a stale deep module (the failure that `?v=` on the entry alone could not
  fix - deep imports carried no version). See "Build + cache-busting" below.
- **Backend**: Node 20 Express server with `better-sqlite3` for persistence
  and the `ws` library for WebSocket gameplay. One SQLite file on a Fly
  volume (`/data/hf.db`). Single-writer; do not horizontally scale.
- **Deploy**: `.github/workflows/deploy.yml` runs on every push. Pages and
  Fly deploys are independent jobs; Fly job is gated on the canonical repo.

### Build + cache-busting

Production is bundled; local dev is not.

- **Local dev (no build):** serve the repo root (`python3 -m http.server`).
  `index.html` loads `./js/main.js` as raw ES modules - edit + refresh, no
  build. Keep the source runnable this way.
- **Production (`scripts/build.mjs`, esbuild):** bundles + minifies into
  `dist/` with content-hashed names (`js/main-<hash>.js`, `css/*-<hash>.css`).
  The build keeps the entry at `dist/js/` depth ON PURPOSE, so `base.js`'s
  `import.meta.url` `'../'` still resolves to the app root from inside the
  bundle. It rewrites the dist `index.html` to the hashed names, writes
  `version.json`, injects the commit SHA into version-check (esbuild
  `--define`), and copies the runtime-fetched assets (rocket PNGs, planner
  `data-hf4.json`, `site-flags.json`) to their app-root-relative paths - they
  are NOT imported, so the bundler never sees them; `base.js#assetUrl`
  resolves them at runtime.
- **Why hashing:** ES module imports carried no `?v=`, so a deploy only
  cache-busted `main.js`, never the modules it imported - clients got stuck on
  a stale deep module after a deploy. Content hashes make a changed module a
  new URL (always re-fetched); `version-check.js` still reloads kept-open tabs
  so they pick up the new `index.html`.
- **CI gates (both must pass before deploy):** `node scripts/check-boot.mjs`
  links the source module graph, and the esbuild build itself fails on any
  parse/link error. The deploy uploads `dist/`, not the repo root.
- Adding a runtime-fetched asset? Load it via `assetUrl(...)` AND add it to
  the copy list in `scripts/build.mjs`, or it will not exist in `dist/`.

## Two play modes - async and realtime

The game supports both:

- **Async** (default): players submit one operation at a time via REST.
  When it's your turn the lobby/email/in-app notification flips. Games
  can sit dormant for days. State lives in SQLite.
- **Realtime**: when 2+ players are subscribed to the same game over
  WebSocket, operations broadcast immediately and the UI animates in
  the other player's session.

REST is the source of truth. WebSocket is a real-time relay on top of
the same operation log - every WS-applied operation is also written to
SQLite, and every REST operation is broadcast to any open WS clients.
A player who walks away and comes back gets the same state by REST as
if they'd been live the whole time.

### Async-multiplayer doctrine - WS is unreliable

WebSocket is for **fast updates, NOT async play**. It is a
best-effort optimisation that makes live sessions feel snappy; it
is NOT a reliable transport and it is NOT how async-multiplayer
events arrive at the other player. Treat every WS broadcast as a
nice-to-have. Failure modes we've actually observed:

- **Browsers fail the WSS handshake outright.** "Firefox can't
  establish a connection to the server at wss://..." - the player
  never receives any push for the whole session.
- **Mobile networks silently drop frames.** Backgrounded tabs,
  walking out of wifi range, captive portals - the socket stays
  "open" but no data arrives.
- **Server hiccups + proxy timeouts close the channel.** Reconnect
  fires eventually but the missed broadcasts are gone.
- **WS broadcasts cause desync.** A push that arrives at one player
  but not another leaves the two clients showing different boards;
  same for an op that the local client applied optimistically but
  the server rejected. Any UX decision that "the broadcast will
  arrive" is a bug waiting to fire.

So: WS is a UX accelerator on top of REST. REST is the source of
truth. The client MUST NOT assume a WS event implies the
server's current state, and MUST NOT block a UX decision on
"the broadcast will arrive". Concrete rules:

- **Poll the server on an interval.** `js/game/browse.js` runs a
  snapshot poll while online: 5s normal, 500ms while an auction is
  open. The cadence switches in `applySnapshot` based on
  `snapshot.auction`. Don't disable polling because WS "should
  cover it".
- **Cache the last snapshot.** `_onlineSnapshot` holds the most
  recent server state; every turn-ownership check, action gate, and
  budget read goes through it instead of trusting transient WS
  events.
- **Polling must NOT invalidate local state unless the server
  actually advanced.** This is the rule, learned the hard way: a
  naive `applySnapshot` that re-hydrates every module on every poll
  tick stomps on in-progress local UI (it wiped the player's boost
  selection every 5s - boost marks were cleared inside `hydrateHand`
  on every snapshot). The fix is two-layered:
  1. **Seq-gate the whole apply.** `applySnapshot(state, seq)` takes
     the server op-log `seq` (from the game wrapper) and returns
     immediately when `seq === _lastAppliedSeq`. Every meaningful
     change (any op: MOVE / END_TURN / AUCTION_* / PICK_CREW)
     advances the seq, so a poll that returns the same seq is a
     genuine no-op: no module re-hydrate, no re-render, nothing
     touched. Error snap-back calls pass no seq to force a re-apply.
  2. **Make each hydrator idempotent + non-destructive.** Even when
     the seq DOES advance (an opponent moved), re-hydrating my own
     stacks must preserve my in-progress selections. `hydrateHand`
     keeps boost marks for cards still in the hand and only fires
     its change listeners when the hand or marks actually changed.
     Apply the same discipline to any new hydrator: diff, preserve
     local-only UI state, and only notify on a real delta.
- **Eager one-shot fetches** on phase transitions where latency
  matters (e.g. auction `bidders → auctioneer`) shave the
  worst-case wait below one tick.
- **Never let a player take a turn without server validation.**
  Action buttons (End turn, op menu, move, BUILD_ROCKET, PROSPECT,
  AUCTION_*) are disabled in the toolbar when `isOnlineMyTurn()`
  is false. `submitOnlineOp` re-checks turn ownership against the
  cached snapshot and refuses if it's stale. The server then
  re-validates and rejects any racing op with `not_your_turn` /
  `auction_in_progress`. UI + client + server all enforce the
  same rule.

If you're adding a new multiplayer action, follow the chain:
1. Disable the control in the toolbar when not my turn.
2. Gate the submit helper on the cached snapshot.
3. Validate again on the server in the engine handler.

### Room routing + version reload - DON'T kick players to the lobby

The active room lives in the URL as a real path segment:
`/<base>/room/<CODE>` (e.g.
`rubentipparach.github.io/high-frontier-fan-game/room/DPAT3R`). This
is load-bearing: it's what lets a refresh, a restored tab, a
dropped-WS reconnect, AND a **version-bump auto-reload** drop the
player back into the SAME room instead of the lobby list. Breaking
any link in this chain regresses to "every deploy kicks everyone
out mid-game", which is the exact failure we're guarding against.

The chain (do not sever any piece):

- **`setRoomInUrl(code)` (js/lobby.js)** writes `/<base>/room/<code>`
  via `history.replaceState` on `openLobby`, clears it on
  `leaveCurrent`. It preserves the `?v=<sha>` version pin. The app
  base is resolved from `import.meta.url`, NEVER from the address
  bar (the bar can already be a deep `/room/...` path).
- **Codes are lowercase + Crockford base32.** `CODE_ALPHABET` in
  `server/index.js` is `0123456789abcdefghjkmnpqrstvwxyz`, and the
  DB stores codes verbatim. SQLite's `=` is case-sensitive, so the
  URL form MUST be lowercase or the lookup misses. `setRoomInUrl`
  lowercases on write; the server's `/lobbies/by-code/:code` (and
  the two invite-link endpoints) run params through `normaliseCode`
  which lowercases + alphabet-validates before any query, so a
  mixed-case shared link still resolves and a garbage segment
  short-circuits with `bad_code`. Don't reintroduce
  `.toUpperCase()` on either side - cosmetic uppercase made the
  URL case-sensitive and broke `/room/DPAT3R` resume.
- **`404.html`** is the GitHub-Pages SPA fallback. GH Pages has no
  server routing, so a hard load / version reload of `/room/<CODE>`
  has no file and hits 404.html, which stashes the code in
  `sessionStorage['hf-room-redirect']` and redirects to the app
  root, carrying `?v=` + hash. Keep 404.html dependency-free (inline
  script, no module imports) - it runs before the app exists.
- **`maybeResumeRoomFromUrl()` (js/main.js)** runs on boot, reads
  the code via `readRoomCode()` (sessionStorage stash -> `/room/`
  path -> legacy `?room=` query), and re-opens the lobby. `openLobby`
  then calls `setRoomInUrl` to restore the visible `/room/<CODE>`.
- **`js/version-check.js`** force-navigates to `location.href` with
  a new `?v=<sha>` when a deploy lands. Because that keeps the
  `/room/<CODE>` path, the reload flows back through 404.html ->
  stash -> resume. CRITICAL: version.json is fetched against the
  SCRIPT's own URL (`new URL('../version.json', currentScript.src)`),
  NOT a relative `./version.json` - a relative fetch resolves against
  the deep `/room/...` address bar and 404s, silently disabling the
  version check.

Net: a `git push` that bumps the deployed SHA reloads every open
client AND keeps each one in its room. If you touch routing,
version-check, or the boot landing logic, re-verify this end to end.

## Lobby + social

- **Profiles** are token-based, mirroring murdoku-companion exactly:
  client generates 32 random bytes, server stores `sha256(token)` in
  the `tokens` table. Multi-device per profile via the "add device
  code" flow. Names are case-insensitive unique, 3-20 chars
  `[A-Za-z0-9_-]`, reserved list at the top of `server/index.js`.
- **Lobby**: a list of in-progress games. Each game has a host, a
  player count, a join policy (`open` / `invite-only`), a chat
  channel, and a join code.
- **Chat**: per-lobby (open chat) and per-game (table chat). Messages
  persist in SQLite, broadcast over WS to subscribed clients.
- **Invites**: two paths.
  1. **Search by name** - type a profile name; if it exists you can
     invite them directly. Invite shows up in their /notifications
     feed and pings any open WS session.
  2. **Invite link** - generate a 12-char share code (`/i/<code>`)
     that anyone can paste into the game lobby to join the table.
     Links can be single-use or unlimited; host picks at create.

### Snapshot apply is INTERPRETATION, not replacement

Critical lesson (user 2026-05-29: "you are eagerly updating the
simulation/game state ... server will give you the state, but you
must interpret state gracefully and smoothly without doing abrupt
updates").

REST is the source of truth, but `applySnapshot` is NOT licensed to
slam the new state into every module and call it done. The user sees
each diff as a CHANGE that needs an animation - the rocket sliding
along its route, the dice tumbling on a prospect, the cards drifting
between stacks. A direct hydrate from a server snapshot SKIPS every
one of those, and play feels jarring and disconnected from intent.

Doctrine:

- **Diff first, apply second.** Before re-hydrating from a new
  snapshot, compare the relevant slice to `_onlineSnapshot` (the
  last applied state) and identify what changed at the granularity
  the player perceives: a rocket move, a card transfer, a dice roll
  outcome, a deck top consumed, etc.
- **Animate the transition, then commit.** Drive the same animation
  the sandbox does (e.g. `animateRocketAlong`, the prospect dice
  modal, the fuel-tank tween) FROM the previous state TO the new
  state. The hydrators run AFTER the animation completes, so the
  final DOM matches the server. If the player skips / interrupts,
  jump to the final state at once but never *start* by snapping.
- **Guard against double-animation.** A poll tick that returns the
  same `seq` as `_lastAppliedSeq` is a no-op; only a real seq
  advance triggers an animation pass. Sandbox-style "consume your
  own move locally first then await server" is fine when the
  server response confirms; the snapshot diff just re-uses the
  animation infrastructure for OPPONENTS' moves and for any move
  the client didn't initiate (a refresh-resume, a spectator view).
- **Animation reads from the op log when needed.** The snapshot
  state has the final position but not the intermediate hops; for
  multi-segment MOVE the server publishes the planned route
  segments alongside the snapshot (or the client recomputes via
  the same planner graph). For dice (PROSPECT, hazard), the op
  payload carries the roll value(s) so the animation plays the
  same outcome the engine resolved.
- **Default to in-place layout updates** for everything else (turn
  banner, roster, mp panel, mission log). Those aren't "events" in
  the player's mind, they're status reads; treat them as live but
  passive.

When you wire a new op in multiplayer, the question to answer is
NEVER "does the snapshot apply correctly?" - the engine already
guarantees that. The question is "what does the player SEE happen,
and does my code reproduce that motion before the state snaps?"

## High Frontier - implementation scope

We aim for **maximum coverage** of the HF4 core rules in `server/game/`
and `js/game/`. Authoritative tables in `data/`:

- `data/sites.js` - solar system map. Each site has `{id, name, body,
  class, hydration, type, vps, dvFromLEO, isSurface}`. Class drives
  the prospect die roll; hydration tells the refinery how much water
  it makes per turn; `dvFromLEO` and adjacency edges feed the
  delta-v movement engine. Covers inner planets, Mars system, main
  belt (Ceres, Vesta, Pallas, Hygiea, Psyche, ~12 more), Jupiter
  Trojans, Galilean moons, Saturn system, KBOs.
- `data/patents.js` - patent deck. Each patent is one of:
  `thruster`, `reactor`, `radiator`, `refinery`, `robonaut`,
  `generator`, `lab`. Thrusters carry `{thrust, isp, mass}`. The
  deck is shuffled per game from a seeded RNG so replays match.
- `data/glory.js` - glory cards (first-to-X awards).

**The server engine mirrors the sandbox.** Other than the auction
(built fresh server-side) and the future M0 + trading mechanics, almost
all of the stack, build, transfer, and move logic is the same as the
single-player sandbox (`js/game/*`, e.g. `stacks.js`, `rocket.js`,
`hand.js`). Don't re-derive those rules on the server; port the sandbox
logic so the two modes stay in lockstep. `server/game/state.js` already
carries the same per-player shape for exactly this reason.

**The multiplayer UI IS the sandbox UI - reuse it, never rebuild it.**
Learned the hard way: do NOT build a separate or "simpler" multiplayer
front-end. Multiplayer must mount the SAME view as the single-player
sandbox - the classic solar-system map (the sandbox renderer + map
data, not a stripped-down delta-v graph), the same rocket-stack / hand /
outpost / factory / disc panels, the same card rendering and site
popups. The ONLY differences are that actions route through the
multiplayer server API (`submitGameOp`) instead of mutating local state,
and the board hydrates from the server snapshot each update. The
competitive auction is the lone exception (the sandbox auction is solo),
so it gets bespoke multiplayer UI layered on top of the shared sandbox
surface; everything else is sandbox code driven by the multiplayer API.

Server-authoritative engine in `server/game/engine.js`:

- Round structure: **Income → Operations (each player, 4 ops) →
  Politics → Hand reset**.
- Operation kinds: `MOVE`, `BURN`, `PROSPECT`, `INDUSTRIALIZE`,
  `BUILD_FACTORY`, `BUILD_REFINERY`, `AUCTION_START`, `AUCTION_BID`,
  `AUCTION_PASS`, `BUILD_ROCKET`, `DECOMMISSION`, `BUY_FUTURE`,
  `END_TURN`.
- **Debug dry-run.** `POST /games/:id/ops` with `debug: true` on the body
  SIMULATES the op: the engine runs it on a throwaway clone (applyOperation
  already clones, so the live state is untouched) and returns
  `{ ok, log, tankBefore, tankAfter, siteAfter }` (or `{ ok:false, error }`)
  WITHOUT persisting or broadcasting. The route-options modal's "Simulate
  planned move" button uses it to preview a move's fuel-step cost before the
  player commits. Read-only; safe to call anytime.
- Movement uses the delta-v graph; each "burn" consumes 1 tank unit
  scaled by the active thruster's ISP. Aerobrakes and pivots have
  special edges.

  **Movement authority - current trust model + eventual TODO.**
  Routing is split between client and server right now. The CLIENT
  (the vendored mission-planner port, `js/game/planner-nav.js` +
  `planner-dijkstra.js`) is the source of truth for the *hard* routing
  math: the Hohmann-aware burn counts (free coasting along a transfer =
  0 burns, pivots cost extra) and the per-turn split (which legs fire
  on which turn, bounded by thrust burns/turn). MOVE sends the SERVER
  this turn's segments `[{from, to, burns, turn}]`; the server VALIDATES
  structure (node existence, continuity from the rocket's position),
  charges the fuel-step cost (`ceil(fuel * thisTurnBurns)` from the
  active thruster face's `fuel`; see the fuel-steps-vs-water note - this
  cost is currently deducted from the water tank 1-to-1, a known
  inconsistency), resolves hazards / factory-assist /
  dice authoritatively, and executes only that one turn - but it TRUSTS
  the client's `burns` + `turn` values. The server's own
  `server/game/planner-graph.js` only does a naive burns-Dijkstra used
  for the bare-destination fallback (a tap with no planned route).
  Consequence: a modified client could send fake burns (e.g. 0) and
  move for free. Fine for friends, not cheat-hardened.
  **TODO (eventually): make movement fully server-authoritative.** Port
  `planner-nav.js` + `planner-dijkstra.js` into a shared module (under
  `data/` or a shared dir both import), have the engine independently
  recompute the route `from -> dest` with the same Hohmann/pivot/
  per-turn semantics, and reject any MOVE whose client-supplied
  `burns` / `turn` don't match. Until then, treat client routing as
  trusted input. (User OK'd the trust model 2026-05-29.)
- Prospect: roll Nd6 (N = site class size); thresholds defined per
  site type. Success = place prospect marker; site becomes claimable
  by the prospector for industrialization.
- Industrialize: deliver a robonaut or crew + reactor to the site;
  flip prospect to factory (1 VP, generates patent income).
- Refinery upgrade: deliver a refinery; factory becomes hydrated
  source of water (income each Income phase).
- Bernal station: 5 factories on the same body collapse into a
  Bernal (5 VP + colonist promotion).
- VPs at game end: factories + refineries + Bernals + glory cards.

Random-numbered seeds are stored per game so replays are deterministic.

## Style

- **Game text describes GAMEPLAY, never implementation.** Player-
  facing copy (modal body text, tooltips / `data-tip`, status
  toasts, button labels, info blurbs) must talk about the game -
  what a card does, what an action costs, whose turn it is, what
  a glyph means. It must NOT narrate the architecture: don't say
  "the server" does X, don't mention snapshots, WebSockets,
  decks-as-data-structures, op logs, validation, or any
  client/server split. A returning tabletop player reads these
  strings; "the server puts the top of the deck up for auction"
  is wrong - "the top of the deck goes up for auction" is right.
  Tooltips in particular MUST be gameplay hints, not notes about
  what the code is doing. (Legitimate exceptions: genuine
  connection / account / service messages like "Server is
  unreachable" or "name taken on this server" - those are about
  the live service the player is interacting with, not gameplay
  mechanics narrated as implementation.)
- **No em dashes (`-`).** Anywhere. Source code, comments,
  commit messages, UI strings, docs. Use a period, a hyphen
  with spaces (` - `), a colon, or parentheses depending on
  what the sentence wants. Em dashes are a tic that betrays
  AI-generated prose and the project explicitly disowns them.
  When you find existing ones, replace them.
- **Navigate-to is always the LAST button in a site popup.** It's
  a pure inspection affordance (no game state changes), so any
  real game actions (Plan rocket route, Prospect, Refuel, etc.)
  must precede it. New site-popup buttons land before
  Navigate-to, never after.
- **Player names track the player's seat colour.** Every render
  of `@<name>` in the multiplayer UI tints the text in that
  player's server-assigned seat colour (the same six crew-card
  colours, see PLAYER_COLORS). Use the shared `.player-name`
  CSS class and set `--player-color` on the element from
  `player.color`. Falls back to currentColor when the seat
  colour isn't known. Touches every surface: turn banner, mp
  roster, mp chat, mission log who-name, auction overlay
  (auctioneer / high bidder), crew-draft roster. Add the class
  + the var on any new "@name" render so the convention holds.
- **Sidebar panes stay where the user put them.** Sidepanel
  navigation is user-driven: bootstrap can open the MP pane
  once, but no automatic path (snapshot apply, market-mode
  flip, op response, WS event) is allowed to switch panes out
  from under the player. If you need to draw attention to a
  pane, use the existing tab-strip badge / pulse affordances,
  never showPane(...).

## Don'ts

- **Don't build a separate multiplayer UI.** Multiplayer reuses the
  sandbox front-end (classic map + all panels + card rendering); only
  the data source (server snapshot) and action sink (`submitGameOp`)
  change. See "The multiplayer UI IS the sandbox UI" above. The
  competitive auction is the sole bespoke-MP exception.
- Don't break local dev's build-free flow. The SOURCE stays plain ES
  modules + CSS + HTML: `index.html` references the raw `./js/main.js`, so
  `python3 -m http.server` runs the app with no build. The esbuild build
  (`scripts/build.mjs`) is PRODUCTION-only and reads the same source. Don't
  introduce framework/JSX/TS syntax that only works after a build, or import
  CSS/assets into JS - keep the source runnable raw. See "Build +
  cache-busting".
- Don't recompute the app base or asset paths inline. Import `appBase()` /
  `assetUrl()` from `js/base.js`. It is the ONLY `import.meta.url`-relative
  path computation in the app (besides version-check.js's sibling
  `version.json`); inline `new URL('../', import.meta.url)` breaks under
  bundling because the bundle collapses every module to one depth.
- Don't trust client moves. Every game mutation goes through
  `server/game/engine.js#applyOperation`, validated against the
  current `state`. WS clients send operation intents; the server
  validates, persists, then broadcasts the resulting state diff.
- Don't store raw tokens. Always `sha256(token)`.
- Don't horizontally scale the API process - single-writer sqlite.
- Don't break the murdoku-style "every branch deploys" promise.
- **Hexagons are independent entities.** When the user says "hex"
  or "hexagon" they mean the gameplay-token marker drawn for each
  site. Its size lives at `TYPE_VIS[type].r` (or the shared
  `HEX_R` constant in `js/game/render.js`) and is independent of
  everything else - body sphere size (`haloR`), halo glow,
  asteroid silhouette, ring radius, edge width, label font size.
  Tuning the hex must never resize the bodies behind them, and
  vice versa. Same goes when the user mentions "halos" / "bodies"
  / "rings" - those are their own knobs.
- **Every hexagon is the same size.** All `TYPE_VIS` entries with
  `kind: 'hex'` use the shared `HEX_R` constant for their `r`
  field - planets, moons, dwarfs, asteroids, sites, surface sites,
  everything. Body class differentiation lives in `haloR` and the
  palette; the hex marker itself is uniform. Don't ship per-type
  hex sizes again.
  The point is that any commit pushed to any branch is live at the
  GH Pages URL within ~1 minute.

## File layout

```
/                       static frontend (deployed to GH Pages)
  index.html            shell: menu, lobby, game, chat panels
  css/style.css         dark space theme
  js/
    main.js             bootstrap
    api.js              REST wrapper
    ws.js               WebSocket client + reconnect
    storage.js          localStorage helpers
    auth.js             profile create / claim / device codes
    lobby.js            lobby UI, game list, create-game flow
    chat.js             chat panel
    invites.js          invite-by-name + invite-link UI
    game/
      render.js         SVG map renderer
      controls.js       op buttons + side panels
      state.js          client mirror of server state
  data/
    sites.js            solar system sites (server reads via import)
    patents.js          patent deck
    glory.js            glory cards
/server/                Fly.io node app
  package.json
  Dockerfile
  fly.toml
  index.js              Express + WS routes
  db.js                 SQLite schema + migrations
  game/
    engine.js           authoritative rules engine
    state.js            empty-state + helpers
    rng.js              seeded RNG
/.github/workflows/
  deploy.yml            Pages + Fly, every branch
```

The `data/` directory is imported by both the frontend (ES modules) and
the server (Node ESM). Keep it pure data - no DOM, no `node:` imports.

## Local dev

```
# Frontend (any static server works)
python3 -m http.server 8000

# Backend (writes to ./server/hf-dev.db locally)
cd server
npm install
DATABASE_PATH=./hf-dev.db npm run dev
```

Frontend points at the API via `<meta name="hf-api-base">` in
`index.html`. Empty value = local-only mode (no lobby, no multiplayer,
but the solo "hot-seat" game still runs entirely in the browser).
