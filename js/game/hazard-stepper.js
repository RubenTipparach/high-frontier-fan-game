// "Decide as I go" for a move's hazards: the player takes each hazard (or
// each group of hazards that resolve at the same arrival) in travel order and
// picks pay or roll for it, or stops the move short.
//
// Nothing is charged or rolled while deciding - a rolled hazard can never be
// undone, so incrementally submitting (and maybe reverting) real rolls isn't
// safe. The whole plan is decided first, then the move is made once. That is
// what makes a genuine "stop here, nothing spent past this point" possible.
//
// Pure orchestration: the dialog and the map questions are passed in, so the
// rule for WHERE the move ends can be checked without a browser
// (scripts/check-planner.mjs). The dialog itself is browse.js#hazardStepModal.
//
//   items       ordered hazard items, each with segIndex = the segment of this
//               turn's route that ENTERS it (liftoff assist 0, landing assist
//               the last segment)
//   turn1Segs   this turn's route segments ({ to: plannerId, ... })
//   isCleanHalt (plannerId) -> true when the ship may simply stop there: not a
//               lander burn (H6c "cannot halt on a lander burn") and not a site
//               that would need its own factory-assist roll to land on
//   askGroup    (prompt) -> Promise of ['pay'|'roll', ...] for the group,
//               'stop', or 'cancel' / null
//   siteName    (plannerId) -> a display name, for "currently at"
//   aqua        the player's aqua now; finaoPer the FINAO cost per hazard
//
// Resolves { uptoSegIndex, choices } - the last segment to fly, and one
// choice per hazard on the flown stretch, in order - or null when the player
// backs out of the whole move.
export async function runHazardStepper(items, { turn1Segs, isCleanHalt, askGroup, siteName, aqua, finaoPer }) {
  const groups = [];
  for (const it of items) {
    const last = groups[groups.length - 1];
    if (last && last.segIndex === it.segIndex) last.items.push(it);
    else groups.push({ segIndex: it.segIndex, items: [it] });
  }
  // A group's stop point merges forward into the next group whenever it isn't
  // a clean, free halt, so "Stop here" is always an unconditional halt that
  // never opens a new hazard decision of its own. If the last group still is
  // not clean, "Stop here" simply never appears there - that node is the
  // move's real destination either way.
  for (let i = 0; i < groups.length - 1; i++) {
    if (isCleanHalt(turn1Segs[groups[i].segIndex].to)) continue;
    groups[i + 1].items = groups[i].items.concat(groups[i + 1].items);
    groups.splice(i, 1);
    i -= 1;
  }
  const choices = [];
  let committedSegIndex = -1;
  for (let g = 0; g < groups.length; g++) {
    const group = groups[g];
    const atSiteLabel = committedSegIndex < 0
      ? 'your current position'
      : (siteName(turn1Segs[committedSegIndex].to) || 'the last stop');
    const pick = await askGroup({
      group, groupNumber: g + 1, totalGroups: groups.length, atSiteLabel,
      stopOffered: g > 0,
      costPer: finaoPer,
      aquaLeft: aqua - choices.filter((c) => c === 'pay').length * finaoPer,
    });
    if (pick === 'stop') {
      return committedSegIndex >= 0 ? { uptoSegIndex: committedSegIndex, choices } : null;
    }
    if (pick === 'cancel' || pick == null) return null;
    choices.push(...pick);
    committedSegIndex = group.segIndex;
  }
  // Every hazard decided and never stopped: the ship flies the WHOLE turn, not
  // just up to the last hazard. committedSegIndex is only the stop point for a
  // "Stop here"; returning it here cut the route off AT the last hazard, so a
  // player who paid the first hazard and rolled a 3 on the second (an
  // aerobrake) was parked on the aerobrake with the rest of the route pushed to
  // next turn (reported 2026-09-23).
  return { uptoSegIndex: turn1Segs.length - 1, choices };
}
