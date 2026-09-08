// The Kreutz Sungrazer's two board rules, in one pure place so the engine and
// the client read the same thing (the same reason data/fuel-graph.js and
// data/lander-burn.js live here).
//
// Printed on the board beside the 1H hex:
//
//   "Sungrazer: size rolls auto-succeed, but at the end of each season yellow,
//    all tokens on it are decommissioned as it makes a solar close pass."
//
// So:
//   1. SIZE ROLLS AUTO-SUCCEED. The site is size 1, which would otherwise need
//      a d6 of exactly 1 - the hardest survey on the map. Only the SIZE roll is
//      waived; the ISRU-vs-hydration gate still applies (hydration 4).
//   2. SOLAR CLOSE PASS. When the Sunspot Cube leaves season yellow, everything
//      standing on the site is decommissioned - EXCEPT the Claim (user
//      2026-09-08: "everything but the claim by end of season yellow"). The
//      comet swings past the sun and what was parked on it does not survive;
//      the claim disc is a survey record, not a thing sitting on the rock.
//
// A third sungrazer rule lives elsewhere because it is a Colony rule, not a
// site rule: G3a makes it a FELONY to colonize the kreutz sungrazer.
//
// Keyed by BOTH id forms, because the same site is written two ways in this
// codebase (data/sites.js's underscored id and the planner's hyphenated wire
// slug) - the recurring id-space bug this file refuses to reintroduce.
export const SUNGRAZER_SITE_IDS = ['kreutz_sungrazer', 'kreutz-sungrazer'];

const SET = new Set(SUNGRAZER_SITE_IDS);

// Is this the Kreutz Sungrazer, in either id space?
export function isSungrazerSite(id) {
  return id != null && SET.has(String(id));
}

// The season the close pass happens at the END of.
export const SUNGRAZER_CLOSE_PASS_SEASON = 'yellow';

// Did the cube just leave that season? `before` / `after` are season names.
export function closePassFires(before, after) {
  return before === SUNGRAZER_CLOSE_PASS_SEASON && after !== SUNGRAZER_CLOSE_PASS_SEASON;
}
