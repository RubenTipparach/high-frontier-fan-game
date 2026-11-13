# Third-party notices

## HF Mission Planner

This project incorporates [hf-mission-planner](https://github.com/nornagon/hf-mission-planner)
by Jeremy Apthorp (nornagon@nornagon.net), licensed under
**AGPL-3.0-only**.

The planner is included as a git submodule at `vendor/hf-mission-planner`.
Only the map data file (`assets/data-hf4.json`) is consumed at runtime by
this project's renderer; we do not bundle the planner's TypeScript source
or its UI.

As a consequence of incorporating this AGPL-licensed data file in a
network-served application, **this entire project is also licensed under
AGPL-3.0-only**. Source for the live site is available at the repo URL
referenced in `README.md`.

## High Frontier 4: All

This project is a fan implementation of *High Frontier 4: All*
(Sierra Madre Games, designed by Phil Eklund). The site list, manifest
PDFs, and branching rulebooks under `reference/` are publisher-authored
materials, stored for development reference only. The shipped product
(the static GH Pages site) does not include those PDFs. Takedown on
request from the publisher; see `reference/README.md`.
