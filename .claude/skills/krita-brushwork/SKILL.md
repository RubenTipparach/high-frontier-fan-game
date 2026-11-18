---
name: krita-brushwork
description: Paint Fleet Command's hand-drawn art (the Vos Syndicate skin's ink, washes, hatching and claw tags, and any other piece that should look drawn) with Krita's real brush engines, driven by a committed Python script, headless under Xvfb. Install Krita, run a script inside it, paint seeded wobbly strokes with pressure taper, fills and layers with blend modes, export a transparent PNG, and check it. Use whenever a piece must look hand-drawn, inked, brushed or painted, when the Vos skin or any drawn skin changes, or when someone asks whether Krita can run here ("Krita", "brush strokes", "hand drawn", "ink it", "wash", "hatching", "painted look").
metadata:
  author: Fleet Command (Claude Code)
  version: "1.0"
---

## In High Frontier

Copied from Fleet Command (`RubenTipparach/fleet-command`, `.claude/skills/krita-brushwork` at `082ce32`,
2026-11-16) with `scripts/install-krita.sh` and `tools/krita/`, for art that should look drawn rather than
flat vector. The notes below are the source's, verbatim; where they disagree with this one, this one wins.

- The installer pins `KRITA_VERSION` inline (Fleet Command keeps it in `build.config`).
- Map and card glyphs that copy the published board (lander, skull, aerobrake) stay flat vector in
  `scripts/gen-map-icons.mjs`: the board draws them flat. Use Krita for painted or inked pieces.
- Any new art follows CLAUDE.md: render it and show the owner before it is used in the game.

---

## In Fleet Command

New in this repository (owner, 2026-10-31: "if you can run krita and if it helps, install that as well and add it to my
dopest ui skills"). CLAUDE.md section 7 says the Vos skin is "drawn by a committed script, never by hand". Until now
that script faked a brush with SVG wobble filters. Krita gives it real brush engines: a G-pen that swells with
pressure, rough ink that breaks up on the paper, sumi-e, wet washes. The strokes are still scripted and seeded, so
the art comes out the same on every run.

| Piece | Where |
|---|---|
| Installer (version pinned in `build.config`, `KRITA_VERSION`) | `scripts/install-krita.sh` |
| Runner: Krita under Xvfb, runs one script, exits with its code | `tools/krita/run.sh` |
| The plugin the runner relies on | `tools/krita/pykrita/fc_runner/` |
| The brush API every generator uses (one implementation) | `tools/krita/brush.py` |
| Self-test | `tools/krita/selftest.py` |

## Set up (once per session, about a minute)

```sh
bash scripts/install-krita.sh
tools/krita/run.sh tools/krita/selftest.py /tmp/krita-selftest.png   # prints "selftest: ink pixels N corner alpha 0"
```

## How it works, and why this way

- **The brush engines paint only through a view.** `kritarunner` has no main window, and `Node.paintLine` segfaults
  there (measured, 5.3.4.1). So the runner starts the full application under Xvfb. The `fc_runner` plugin waits for the
  first window by polling (connecting to `windowCreated` from `setup()` is too late and never fires), runs
  `FC_KRITA_SCRIPT`, prints `FC_KRITA_EXIT <code>` and quits.
- **The AppImage is extracted**, not mounted: a container has no FUSE. Its `AppRun` does not set the Python paths, so
  `run.sh` sets `LD_LIBRARY_PATH`, `PYTHONHOME` and `PYTHONPATH` to the bundle's own Python 3.13 and PyQt5.
- **Export needs batch mode on the document** (`doc.setBatchmode(True)`) as well as on Krita, or `exportImage` waits
  on a PNG options dialog that nobody can see, and the run times out.
- `brush.py`'s `Canvas` removes the white background layer, so pieces come out transparent and can be laid over
  rendered metal or a wash.

## Painting

```python
import random
from brush import Canvas, args, wobble
rng = random.Random(seed)                          # one seeded generator per piece, never the global one
c = Canvas(w, h, "vos_tag")
c.new_layer("wash", opacity=200, blend="multiply")
c.brush("d) Ink-2 Fineliner", 4, "#a8482a")
c.fill_path(wobble(outline, rng, 2.0))             # a wash inside a wobbly outline
c.new_layer("ink")
c.brush("d) Ink-7 Brush Rough", 7, "#2a1410")
c.polyline(wobble(outline, rng, 2.5), taper=(0.2, 1.0, 0.4))   # pressure rises, then trails off
c.save(out_png)
```

Presets used so far (Krita's bundled names, exact): `d) Ink-1 Precision`, `d) Ink-2 Fineliner`, `d) Ink-3 Gpen`,
`d) Ink-4 Pen Rough`, `d) Ink-7 Brush Rough`, `d) Ink-8 Sumi-e`. List them all with
`sorted(Krita.instance().resources("preset"))`. A missing preset is an error, never a fallback.

## Rules

- **Never paint by hand.** Every piece comes from a committed script and a seed. Re-running it gives the same image.
- **Fit inside the parent** (the `blender-ui-panels` skill, rule B and "children fit inside their parents"): a wobble
  pushes a stroke up to its amplitude plus half the brush size off its outline. Draw the outline inset by that much,
  and check the transparent margin on the PNG.
- **Look at it.** Read the PNG before you use it. A script can run without error and still produce nothing (a fill
  style name in the wrong case paints nothing: it is `ForegroundColor`, not `foregroundcolor`).
- Text is not painted. Labels are drawn live over the piece (CLAUDE.md section 7).
