---
name: game-test-sandbox
description: Stand up a throwaway LOCAL copy of the game (server + site + scratch database) on any branch and play it for real in headless Chromium - make test players, pick any crew (promo included), build and fuel a rocket stack, teleport it anywhere with the admin game editor, plan a route, press Move, and read what the server did. Use whenever a change has to be EXERCISED end to end before it ships ("test it in the browser", "fly a ship through a hazard", "make a rocket stack", "test a crew ability", "e2e", "verify in game"). Never touches production.
metadata:
  author: Claude Code
  version: "1.0"
---

# Game test sandbox

CLAUDE.md says every change gets EXERCISED before a push (a push deploys to
prod). Engine tests (`scripts/check-*.mjs`) are not enough for anything a player
clicks: run the real client against a real server and drive it. This skill is
the recipe, with every trap already hit once (2026-11-14, promo crew hazards).

**Hard rules**
- LOCAL ONLY. Scratch DB, `localhost` server. Never point the scratch site at
  production, never mint tokens on the production DB, never edit a live game
  (CLAUDE.md "Don'ts").
- Test-only code (the hook below, the API-base rewrite) lives in a SCRATCH
  worktree and is never committed.

## 1. Worktree + local server + site

```bash
S=$SCRATCH/sbx                         # your scratchpad dir
git fetch -q origin <branch>
git worktree add -q $S origin/<branch>
cd $S
rmdir vendor/hf-mission-planner 2>/dev/null
ln -sfn $REPO/vendor/hf-mission-planner vendor/hf-mission-planner   # the map
# point the site at the local server (index.html meta), scratch copy only
sed -i 's|content="https://high-frontier-fan-game.fly.dev"|content="http://localhost:8790"|' index.html
(cd server && npm install --no-audit --no-fund)
cd server && (PORT=8790 DATABASE_PATH=$S/test.db RAT_ADMIN_NAMES=alice,bob \
  nohup node index.js > $S/server.log 2>&1 &)
cd $S && (nohup python3 -m http.server 8137 > /dev/null 2>&1 &)
```

- `RAT_ADMIN_NAMES` makes those profile names admins (promo crew picks need it).
- `vendor/hf-mission-planner` missing = the planner graph has 0 nodes and
  everything route-related silently fails.
- Background servers get reaped between tool calls sometimes; if a page load is
  `ERR_CONNECTION_REFUSED`, restart them in the same command as the test.

## 2. Players, games, crew: `setup.mjs`

`node .claude/skills/game-test-sandbox/setup.mjs <out.json> name:cardId:face [...]`
creates one admin profile + one SOLO game (m0+m1+m2, Free Library) per entry,
starts it, picks the crew through the real `PICK_CREW` op, and mints a local
EDIT token. Writes `{ editToken, users: { name: {token, profileId, code, gameId} } }`.

- Ops body is FLAT: `POST /games/:id/ops {kind:'PICK_CREW', cardId, face}` - not
  `{op:{...}}` (that is `unknown_op`).
- Promo crew needs an admin AND a game with m0+m1+m2 (`promo_crew_*` errors).

## 3. Build the rocket stack: presets, or the admin game editor

**Fast path:** `setup.mjs ... --db $S/test.db --rocket plasmoid --at <slug>`
builds a known stack from `rockets.json` and parks it. Add new presets there,
and mark one `verified` only after the planner accepted a route and the server
executed the MOVE with exactly that stack (say where and when).

By hand:

`POST /admin/games/:id/edit` with `Authorization: Bearer hfe_...` and
`{profileId, action, ...}`. Actions: `give_card {cardId,to}`,
`flip_card {cardId,from,face}`, `move_card {cardId,from,to}`,
`remove_card`, `set_water {value,grade}`, `set_aqua {value}`,
`teleport {node, unit?}` (unit `rocket` | `freighter` | `bernal:N`; node = slug),
`set_privilege {key,on}`, `place_claim`, `create_factory`, `promote_unit`, ...
Locations: `hand`, `leo`, `rocket`, `freighter`, `bernal:N`.

A stack that FLIES with no supports to wire:
`give_card thr_ponderomotive_vasimr -> rocket`, `flip_card ... face:'secondary'`
(Pulsed Plasmoid: thrust 3, fuel 1, no requirements), THEN switch it on with the
player op `SET_ACTIVE_THRUSTER {cardId}`. A thruster that is merely on the stack
gives net thrust 0: only zero-burn coasts plan, which looks like success on a
hazard test and isn't.
Other support-free thrusters: `thr_re_solar_moth` (white, solar),
`thr_photon_heliogyro` (black, Electric Sail).

- **Keep the tank small** (`set_water 6`). 30 water makes the stack heavy
  enough that net thrust reads 0 and the planner refuses ("net thrust 0").
- Landing on a big body needs lander thrust > its size; to test a hazard, fly
  INTO the hazard node (a Lagrange point) instead.

## 4. Module 2 faction privileges are LOCKED until a Home Bernal anchors

Every faction privilege (core and promo) is off in an M2 game until the player
has an anchored Home Bernal. There is no editor action for it; write the scratch
DB directly (`setup.mjs --anchor` does this):
`players[0].bernals = [{cardId:'ber_l1_climate_control_bernal', face:'primary',
siteId:'burn-9b26i', anchored:true, stack:[]}]`.

- The site MUST be a real Home Bernal node (`data/node-tags.js` `homeBernal`;
  `burn-9b26i` is one). The server also honours a `home:true` flag but the
  CLIENT (`isHomeBernalUnit`) does not, so a fake site unlocks the server and
  leaves the UI locked - a false failure.
- With an anchored Home Bernal, `END_TURN` can refuse `must_exomigrate`; teleport
  a fresh game rather than fighting it.

## 5. Drive the client: hook, plan, Move

Append a test hook to the scratch `js/game/browse.js` (never commit):

```js
globalThis.__hz = { data: () => _activeData, me: () => mySnapshotPlayer(),
  has: (k) => playerHasPrivilege(mySnapshotPlayer(), k),
  plan: (id) => planRocketRouteTo(_activeData.byId[id]), route: () => _plannedRoute,
  routeHazards, classify: classifyHazard };
```

Then `fly.cjs` (`node .claude/skills/game-test-sandbox/fly.cjs <out.json> <name> <destSlug> [--roll] [--shots dir]`):
log in by seeding `localStorage['hf.profile'] = {name, token, id}`, open
`/?room=<code>`, wait for the map, `__hz.plan(<dest planner id>)` (exactly what
"Plan rocket route" calls), screenshot, click `#turn-tag-move`, capture the
hazard checklist (if any), click "Roll all now", then read the server.

- Move can open a SEQUENCE of prompts (radiation zone first, then the hazard
  checklist, then unit-specific choices). `fly.cjs --roll` records and accepts
  each one; without `--roll` it stops at the first.
- Map ids: the client uses planner ids; find by slug with
  `D.sites.find(s => s.id2 === slug)`. Adjacency: `D.neighborsOf(id)`.
- Hazards: `__hz.classify(site)` -> `{glyph,label,aero?}`.

## 6. Read what the SERVER did

- `GET /games/:id/ops` -> `{entries:[{seq,kind,log,payload}]}` - the mission-log
  line says what the engine resolved (waivers, rolls, dice).
- `GET /games/:id` -> `{game:{state}}` - positions, aqua, tank.

Always run a CONTROL: same route, other face of the same card (or another seat),
so a pass is a real difference and not a missing hazard.

## 7. Clean up

```bash
pkill -f "node index.js"; pkill -f "http.server 8137"
git worktree remove --force $S && git worktree prune
```
