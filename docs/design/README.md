# Design pages

## M4 Exodus Tracker (survey)

https://claude.ai/artifact/GpwQCLPnNoR53x1jfESwDe

(Republished 2026-11-19 from a different account as a new page. The earlier page,
https://claude.ai/artifact/36MzZDDtVQuVMidFrhE8QV, keeps the answers given before
that date; this account cannot read it.)

Module 4 progress (what is built, partly built, in design, to do), gameplay
footage of each M4 flow, and the open owner questions. Source:
`docs/design/m4-tracker.html` (built from `.claude/skills/html-survey/template.html`).
The reels are published with the page (`reels/*.mp4`, five clips recorded
2026-11-15/16 from a local two-seat M4 game); they are not checked in.

Answers land in the artifact's `answers` collection (one document per question
id). Read them with ArtifactData, fold each into the engine / docs, then move the
question into `DECIDED` and republish the same file path.

## M4 Contract Destinations (verification)

https://claude.ai/artifact/4hHtBz7odjF5UsSq1LfVcy

The contract destinations the engine cannot check yet, each with a proposed
rule and the board spaces it resolves to (copyable ids, hazard captions), for
the owner to mark Right / Wrong. Source: `docs/design/m4-destinations.html`.
Verdicts land in the artifact's `answers` collection, keyed by contract code.
