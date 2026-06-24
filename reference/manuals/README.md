# HF4 branching manuals - extracted text reference

Searchable markdown extracted from the checked-in branching-manuals source
(`reference/HF4-branching-manuals-v0.3.zip`, file
`HF4A branching manuals_v0.3.lyx`). The published PDFs are not grep-able, so
this is a text form of the SAME content already in the repo, for design
reference while we plan the modules.

The manuals are "branching": one LyX source produces every build (Core, Core+M0,
Core+M0+M1, ... up to QS+M0-M4+Futures+Exodus) by toggling LyX **branches**. We
split that source by branch:

- **`hf4-branching-manual.md`** - the whole document in order. Module/variant
  text is tagged inline as `` `[Branch]` ``; untagged text is shared (Core).
  Start here when you want full context around a rule.
- **`branch-<name>.md`** - just the paragraphs that belong to one branch:
  - `branch-shared-core.md` (untagged shared rules), `branch-core.md`
  - `branch-module-0.md` .. `branch-module-4.md`, `branch-futures.md`
  - combo / negation branches: `branch-modules-1-2.md`, `branch-module-1or2.md`,
    `branch-no-module-1.md`, etc.
  - variants: `branch-v1-quick-start.md`, `branch-v9-the-sirens.md`,
    `branch-v11-diamonds-4-all.md`, `branch-v12-panspermia.md`,
    `branch-ageofpiracy.md`, `branch-exodus.md`, `branch-interstellar.md`.

Module map (per the operations table in CLAUDE.md): **M0** = Politics / Assembly,
**M1** = Terawatt & Futures (Freighters, GW thrusters, isotope/gold-bead fuel,
Mobile Factories, Space Elevator, Big Cube Swap, Futures), **M2** = Colonization
(Bernals, Colonists, anchoring), **M3** = Conflict, **M4** = the isostandard /
late-game layer.

## Caveats

Auto-converted, so treat it as a reference, not the typeset rulebook:

- Tables and figures are omitted; cross-references read as bare section codes
  (e.g. "1B6d", "G1").
- Inline formatting (bold/colour) is mostly dropped; `Description`-style rule
  entries render as `- **label** text`.
- Wording is the manual's; for our own implementation notes (functional, in our
  words) see the `docs/module-*-plan.md` design docs.

## Regenerate

```
python3 scripts/extract-branching-manuals.py \
  "reference/HF4-branching-manuals-v0.3.zip-extracted/HF4A branching manuals_v0.3.lyx" \
  reference/manuals
```

(Unzip the manuals archive first; the script reads the `.lyx` and writes the
markdown here. Re-run it if a newer manuals version lands.)
