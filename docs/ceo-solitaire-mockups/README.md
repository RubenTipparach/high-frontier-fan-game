# CEO Solitaire - mockup screenshots (for review)

Rendered previews of the CEO Solitaire UI built in this pass. Per CLAUDE.md, the
hand-authored SVG art (the boardroom table) is shown here for sign-off before it
is treated as final. Everything is admin-preview only for now.

## Intro cutscene (1999 boardroom pitch)

A staged slide deck the player sees once when a CEO Solitaire room starts, dressed
as a late-90s corporate PowerPoint (gradient title bars, serif headings, square
bullets, projector frame, CONFIDENTIAL footer).

- `cutscene-slide-0.png` - title slide ("ASTRA DYNAMICS", the 40-70 year plan)
- `cutscene-slide-1.png` - Agenda
- `cutscene-slide-2.png` - The Opportunity
- `cutscene-slide-3.png` - The Plan (prospect / claim / industrialize / settle)
- `cutscene-slide-4.png` - What the Board Expects (the KPI flavour)
- `cutscene-slide-5.png` - The Ask (Begin)
- `cutscene-scoring.png` - "Meet the Number, or Else": the per-meeting scoring
  consequences, with the promoted (met) vs. fired (missed) illustrations.

The title slide's horizon tracks the chosen game length (12 in-game years per
cycle: 4 rounds = 48 years, 7 = 84). Slides advance right to left.

## Board Meeting screen

The Board convenes around a round table to decide whether you remain CEO: an SVG
of board members (CEO seat gold, dashed ring), a stamped verdict that animates in,
KPI vs. delivered VP, and an income-vs-score line chart over the cycles.

The tally is revealed one row at a time (the running total counts up), then the
verdict stamps and the fired / promoted illustration drops in.

- `board-met.png` - expectations met: green stamp, promoted illustration, victory-band rating
- `board-missed.png` - below expectations: red stamp, fired illustration

## Room setup wizard

- `wizard-solo.png` - the solo room wizard, Sandbox (left) vs CEO Solitaire (right).
  Modules now live under an **Expansions** group placed **above House rules**.
  Choosing CEO Solitaire locks the sandbox options, force-checks Module 0
  (mandatory), and exposes the optional company modules (M1 / M2 / M4, M4 not
  implemented yet). The CEO Solitaire category is admin-preview gated.

These are demo renders with staged numbers; the V6 board-meeting engine (rising
KPI, seniority disks, fatalities) is documented in `../ceo-solitaire-plan.md` and
will feed real per-cycle figures when it lands.
