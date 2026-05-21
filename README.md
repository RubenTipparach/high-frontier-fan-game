# high-frontier-fan-game

A fan implementation of **High Frontier 4: All** — the rocket-physics solar
system board game by Phil Eklund (Sierra Madre Games). Educational /
non-commercial.

Play the latest commit at `https://<owner>.github.io/high-frontier-fan-game/`.
Every push to every branch redeploys, so the most recent commit on any
branch is what's live.

## Features

- 1–5 player solar system race for water, factories, and glory
- Solar system map covering Earth/Moon/Mars/Venus/Mercury, main belt,
  Jupiter system, Saturn system, near-earth asteroids, and KBOs
- Ship construction from a deck of ~80 patent cards (thrusters,
  reactors, radiators, refineries, robonauts, generators, labs)
- Delta-v movement with ISP-aware burn cost
- Auctions, prospects, industrialization, and Bernal stations
- **Both async and realtime play** — leave a game and come back days
  later, or play in real time over WebSocket
- **Lobby + chat + invites** — find friends by name or share a
  one-click invite link
- Pure static frontend; no build step
- Express + sqlite + ws backend, single Fly.io machine

## Run locally

Frontend:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Backend:

```sh
cd server
npm install
DATABASE_PATH=./hf-dev.db npm run dev
# listens on :8080
```

By default `index.html` points at the production Fly app. Edit the
`<meta name="hf-api-base">` tag to point at `http://localhost:8080`
for local dev.

## Project structure

See `CLAUDE.md` for the canonical architecture notes and rule-coverage
scope.

## Credits

High Frontier is © Phil Eklund / Sierra Madre Games. This repository is
a fan project for personal play and learning, distributed under no
license that would suggest ownership of the game's design. If the
publisher requests takedown, this repo will be removed.
