#!/usr/bin/env python3
"""Pre-compute the seasonal-corridor tag for every routing waypoint
in the planner graph.

Input:  vendor/hf-mission-planner/assets/data-hf4.json
Output: data/waypoint-seasons.json
        { "<waypoint id>": "red" | "yellow" | "blue", ... }

Why static: the planner JSON ships 15 seasonal sites (5 red, 5
yellow, 5 blue - comets plus Icarus / Phaethon / Pholus / Hermes
A/B / Bee-Zed / Asbolus / Kreutz Sungrazer) but only flags the
destination hex with siteSynodic. The lagrange + burn waypoints
along each approach corridor share the apparition window, so on
the published board they're drawn in the comet's seasonal colour
too. We walk that out once at build time so the runtime renderer
just looks up the season instead of recomputing a BFS every
page load.

Rules:
  - From each seasonal site (non-waypoint with siteSynodic), walk
    out through waypoints. Real destination sites act as
    boundaries - a waypoint between Earth and a comet picks up
    the comet's season, but propagation stops at Earth itself.
  - The waypoint graph is one giant connected mesh through the
    decorative chain-bend nodes, so naive BFS would mark every
    waypoint with every season. To match the published board's
    "linear approach corridor" idea we only continue propagation
    through degree-2 waypoints (chain links). A degree-3+
    waypoint is a junction; it's claimed by the season that
    reached it but propagation stops there. That keeps the
    seasonal tag confined to the approach lane and avoids
    bleeding into the wider waypoint network.
  - A waypoint claimed by exactly one season inherits that
    season. Waypoints claimed by two or more (rare junction
    cases) stay neutral so the player doesn't see a misleading
    single colour at a fork.

Run with:
    python3 scripts/extract-waypoint-seasons.py
"""

import json
import os
import sys
from collections import defaultdict, deque

REPO_ROOT  = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INPUT_PATH = os.path.join(REPO_ROOT, 'vendor', 'hf-mission-planner',
                          'assets', 'data-hf4.json')
OUT_PATH   = os.path.join(REPO_ROOT, 'data', 'waypoint-seasons.json')


def main():
    with open(INPUT_PATH) as f:
        raw = json.load(f)

    points = raw.get('points', {})
    edges_raw = raw.get('edges', [])

    # Adjacency: id -> list[id]. Edges are "from:to" strings.
    adj = defaultdict(list)
    for e in edges_raw:
        if ':' not in e:
            continue
        a, b = e.split(':', 1)
        if a not in points or b not in points:
            continue
        adj[a].append(b)
        adj[b].append(a)

    def is_waypoint(pid):
        # Anything not typed 'site' is a routing waypoint in the
        # planner data (lagrange, burn, hohmann, decorative, etc.).
        p = points.get(pid)
        return bool(p) and p.get('type') != 'site'

    # claims[waypoint_id] = set of seasons that reached it.
    claims = defaultdict(set)

    for src_id, p in points.items():
        if p.get('type') != 'site':
            continue
        season = p.get('siteSynodic')
        if not season:
            continue
        # Walk from this seasonal site through waypoints. Junction
        # waypoints (degree > 2) are claimed but not expanded
        # through, so we stay on the linear approach corridor.
        visited = {src_id}
        q = deque([src_id])
        while q:
            cur = q.popleft()
            # Source is always expanded. Past that, stop propagating
            # through degree-3+ waypoints (junctions out of the corridor).
            if cur != src_id and len(adj.get(cur, ())) > 2:
                continue
            for nxt in adj.get(cur, ()):
                if nxt in visited:
                    continue
                if not is_waypoint(nxt):
                    continue
                visited.add(nxt)
                q.append(nxt)
                claims[nxt].add(season)

    # Resolve: single-season waypoints inherit; multi-season stay
    # neutral and don't appear in the output.
    out = {}
    for wp_id, seasons in claims.items():
        if len(seasons) == 1:
            out[wp_id] = next(iter(seasons))

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, 'w') as f:
        json.dump(out, f, indent=2, sort_keys=True)

    # Friendly stats - useful when re-running the extractor after a
    # planner-data update.
    by_season = defaultdict(int)
    for season in out.values():
        by_season[season] += 1
    sys.stderr.write(
        f"Wrote {len(out)} waypoint seasons "
        f"(red={by_season['red']} yellow={by_season['yellow']} "
        f"blue={by_season['blue']}) to "
        f"{os.path.relpath(OUT_PATH, REPO_ROOT)}\n"
    )


if __name__ == '__main__':
    main()
