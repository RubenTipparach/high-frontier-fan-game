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
- Reference repo for architecture/login/deploy patterns:
  https://github.com/RubenTipparach/murdoku-companion

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
- `isp` - burns per fuel unit. The card's fuel droplet shows
  `ceil(thrust / isp)`, the water cost of one burn.
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
│ static ES modules, no build    │   WS (wss://)  │  Express + ws + better-sqlite3│
│ index.html, css/*, js/*        │ <------------> │  volume: /data/hf.db          │
│ deployed on every branch       │                │  admin at /admin              │
└────────────────────────────────┘                └────────────────────────────────┘
```

- **Frontend**: pure HTML/CSS/ES modules. No bundler, no framework, no build
  step. Static files under repo root deploy to GH Pages on every push to
  every branch.
- **Backend**: Node 20 Express server with `better-sqlite3` for persistence
  and the `ws` library for WebSocket gameplay. One SQLite file on a Fly
  volume (`/data/hf.db`). Single-writer; do not horizontally scale.
- **Deploy**: `.github/workflows/deploy.yml` runs on every push. Pages and
  Fly deploys are independent jobs; Fly job is gated on the canonical repo.

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

Server-authoritative engine in `server/game/engine.js`:

- Round structure: **Income → Operations (each player, 4 ops) →
  Politics → Hand reset**.
- Operation kinds: `MOVE`, `BURN`, `PROSPECT`, `INDUSTRIALIZE`,
  `BUILD_FACTORY`, `BUILD_REFINERY`, `AUCTION_START`, `AUCTION_BID`,
  `AUCTION_PASS`, `BUILD_ROCKET`, `DECOMMISSION`, `BUY_FUTURE`,
  `END_TURN`.
- Movement uses the delta-v graph; each "burn" consumes 1 tank unit
  scaled by the active thruster's ISP. Aerobrakes and pivots have
  special edges.
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

## Don'ts

- Don't add a frontend build step. ES modules, plain CSS, plain HTML.
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
