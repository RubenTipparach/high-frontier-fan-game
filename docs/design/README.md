# Design pages

## M4 Exodus Tracker (survey)

https://claude.ai/artifact/36MzZDDtVQuVMidFrhE8QV

Module 4 progress (what is built, partly built, in design, to do), gameplay
footage of each M4 flow, and the open owner questions. Source:
`docs/design/m4-tracker.html` (built from `.claude/skills/html-survey/template.html`).
The reels are published with the page (`reels/*.mp4`), recorded from a local
two-seat M4 game; they are not checked in.

Answers land in the artifact's `answers` collection (one document per question
id). Read them with ArtifactData, fold each into the engine / docs, then move the
question into `DECIDED` and republish the same file path.
