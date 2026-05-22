# High Frontier Fan Game — agent notes

Persistent project rules for future sessions. Read this first.

This is a fan implementation of **High Frontier 4: All** (Sierra Madre Games,
designed by Phil Eklund). Pure educational / fan project, not for sale, not
affiliated with the publisher.

- Core rules PDF (publisher-hosted):
  https://gamers-hq.de/media/pdf/c5/f2/cf/HF4-Core-Rules.pdf
- BGG entry: https://boardgamegeek.com/boardgame/281837/high-frontier-4-all
- Reference repo for architecture/login/deploy patterns:
  https://github.com/RubenTipparach/murdoku-companion

## Stages — build incrementally

Verify each stage before starting the next. Don't conflate stages in a
single PR.

- **Stage 1 (done):** Identity + social layer. Profiles, lobby
  (create / list / join), chat, friend search, invite links. Game
  surface was a placeholder.
- **Stage 2 (current):** Static data + read-only renderer. The
  solar-system map (`data/sites.js`), patent deck (`data/patents.js`),
  milestones (`data/glory.js`), and events (`data/politics.js`); an
  SVG renderer with pan/zoom; a ship-card composer (validation
  rules + burn-cost math) ready for Stage 3 to call. A Browse view
  on the topbar lets anyone inspect the data; the lobby's
  game-overlay now mounts the map (read-only) when the host starts.
- **Stage 3:** Server-authoritative engine. Operations phase, MOVE /
  BURN / PROSPECT / INDUSTRIALIZE / AUCTION / BUILD ops. Validated
  on the server; optimistic mirror on the client. New tables in
  `server/db.js` for games, operations, and per-game state.
- **Stage 4:** Full coverage. Refineries, habitat / Bernal stations,
  politics resolution, milestone awards, futures market,
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

## Two play modes — async and realtime

The game supports both:

- **Async** (default): players submit one operation at a time via REST.
  When it's your turn the lobby/email/in-app notification flips. Games
  can sit dormant for days. State lives in SQLite.
- **Realtime**: when 2+ players are subscribed to the same game over
  WebSocket, operations broadcast immediately and the UI animates in
  the other player's session.

REST is the source of truth. WebSocket is a real-time relay on top of
the same operation log — every WS-applied operation is also written to
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
  1. **Search by name** — type a profile name; if it exists you can
     invite them directly. Invite shows up in their /notifications
     feed and pings any open WS session.
  2. **Invite link** — generate a 12-char share code (`/i/<code>`)
     that anyone can paste into the game lobby to join the table.
     Links can be single-use or unlimited; host picks at create.

## High Frontier — implementation scope

We aim for **maximum coverage** of the HF4 core rules in `server/game/`
and `js/game/`. Authoritative tables in `data/`:

- `data/sites.js` — solar system map. Each site has `{id, name, body,
  class, hydration, type, vps, dvFromLEO, isSurface}`. Class drives
  the prospect die roll; hydration tells the refinery how much water
  it makes per turn; `dvFromLEO` and adjacency edges feed the
  delta-v movement engine. Covers inner planets, Mars system, main
  belt (Ceres, Vesta, Pallas, Hygiea, Psyche, ~12 more), Jupiter
  Trojans, Galilean moons, Saturn system, KBOs.
- `data/patents.js` — patent deck. Each patent is one of:
  `thruster`, `reactor`, `radiator`, `refinery`, `robonaut`,
  `generator`, `lab`. Thrusters carry `{thrust, isp, mass}`. The
  deck is shuffled per game from a seeded RNG so replays match.
- `data/glory.js` — glory cards (first-to-X awards).
- `data/politics.js` — politics deck drawn at the end of each round.

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

## Don'ts

- Don't add a frontend build step. ES modules, plain CSS, plain HTML.
- Don't trust client moves. Every game mutation goes through
  `server/game/engine.js#applyOperation`, validated against the
  current `state`. WS clients send operation intents; the server
  validates, persists, then broadcasts the resulting state diff.
- Don't store raw tokens. Always `sha256(token)`.
- Don't horizontally scale the API process — single-writer sqlite.
- Don't break the murdoku-style "every branch deploys" promise.
- **Hexagons are independent entities.** When the user says "hex"
  or "hexagon" they mean the gameplay-token marker drawn for each
  site. Its size lives at `TYPE_VIS[type].r` (or the shared
  `HEX_R` constant in `js/game/render.js`) and is independent of
  everything else — body sphere size (`haloR`), halo glow,
  asteroid silhouette, ring radius, edge width, label font size.
  Tuning the hex must never resize the bodies behind them, and
  vice versa. Same goes when the user mentions "halos" / "bodies"
  / "rings" — those are their own knobs.
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
    politics.js         politics deck
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
the server (Node ESM). Keep it pure data — no DOM, no `node:` imports.

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
