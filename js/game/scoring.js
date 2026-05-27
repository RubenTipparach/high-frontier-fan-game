// Stage-3 endgame scoring (rulebook M2).
//
// Computes the player's "if the game ended now" VP breakdown.
// Per the variant spec (industrialize.md "VP timing"):
//   - +1 VP per owned token on the map: rocket (if built),
//     successful claims (discs), factories, colony domes, and
//     outposts.
//   - Spectral-based stock-price bonus per factory (rulebook M2b
//     Exploitation Track). Each spectral has its own diminishing
//     schedule: the 1st factory of spectral X pays 8 VP, the
//     2nd pays 5 VP, the 3rd and every subsequent factory pay
//     4 VP each. Schedule is the same for all six spectrals
//     (C / S / M / V / D / H).
//   - Career glory VP (the live glory.js counter) is added on
//     top so the panel shows a single grand total.
//
// VP is endgame-only: industrialize and colonize do not award
// instant VP at build time. This function is what surfaces the
// final tally.
//
// Public surface:
//   SPECTRAL_DIMINISHING_SCHEDULE  - [8, 5, 4]; last value
//                                    repeats indefinitely
//   spectralVpForCount(n)          - total VP for N factories
//                                    of one spectral
//   computeEndgameScore({ ownerId }) -> {
//     tokens: { rocket, claims, factories, colonies, outposts, total },
//     spectralBonus: { byType: { C, S, M, V, D, H }, perSpectralCount, total },
//     glory,
//     grandTotal,
//   }

import { getDiscs } from './discs.js';
import { allFactories, allColonies } from './factories.js';
import { getOutposts } from './stacks.js';
import { getRocketStack } from './rocket.js';
import { getVps } from './glory.js';

// Per-spectral diminishing schedule from rulebook M2b. Read
// position by position: index 0 = 1st factory of that spectral,
// index 1 = 2nd, anything past the end uses the last value.
// All six spectrals (C/S/M/V/D/H) share this schedule.
export const SPECTRAL_DIMINISHING_SCHEDULE = [8, 5, 4];

// Total VP for N factories of a single spectral. N <= 0 returns
// 0. The schedule's final value is the "floor" rate that
// repeats indefinitely.
export function spectralVpForCount(n) {
  if (!Number.isFinite(n) || n <= 0) return 0;
  const last = SPECTRAL_DIMINISHING_SCHEDULE[SPECTRAL_DIMINISHING_SCHEDULE.length - 1];
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += SPECTRAL_DIMINISHING_SCHEDULE[i] != null
      ? SPECTRAL_DIMINISHING_SCHEDULE[i]
      : last;
  }
  return total;
}

// Colony-location VP from the published tracker ("COLONY
// LOCATIONS"): Astrobiology +1, Submarine +2, Bernal +2 each.
// Anything else (a plain colony dome) scores +1, matching the old
// flat token value.
export const COLONY_VP = { astrobiology: 1, submarine: 2, bernal: 2, other: 1 };

export function computeEndgameScore({ ownerId, colonyTypeOf } = {}) {
  // Tokens: rocket counts if the player has any cards in it.
  // Claims count every success disc on the map (sandbox: all
  // discs belong to the local player; multi-player will gate on
  // disc.ownerId once that's modelled).
  const rocketCount = getRocketStack().length > 0 ? 1 : 0;

  const discs = getDiscs() || {};
  let claimCount = 0;
  for (const id in discs) {
    if (discs[id]?.outcome === 'success') claimCount++;
  }

  const factories = allFactories();
  const colonies  = allColonies();
  const outpostsMap = getOutposts();

  // Owner filtering. If ownerId is omitted we count every
  // record (handy for stats); when provided we restrict to
  // that owner.
  const factoryRecs  = ownerId ? factories.filter((f) => f.ownerId === ownerId) : factories;
  const colonyRecs   = ownerId ? colonies.filter((c)  => c.ownerId === ownerId) : colonies;
  const outpostList  = Object.values(outpostsMap);

  // Colonies score by location type, not a flat +1. The caller
  // injects colonyTypeOf(siteId) -> 'astrobiology' | 'submarine' |
  // 'bernal' | null (the flags live on the runtime-merged site
  // objects, not in data/sites.js, so scoring stays pure). Without
  // it, every colony scores the 'other' rate (+1).
  const colonyByType = { astrobiology: 0, submarine: 0, bernal: 0, other: 0 };
  for (const c of colonyRecs) {
    const t = (colonyTypeOf && colonyTypeOf(c.siteId)) || 'other';
    if (colonyByType[t] != null) colonyByType[t]++;
    else colonyByType.other++;
  }
  let colonyVp = 0;
  for (const [t, n] of Object.entries(colonyByType)) colonyVp += n * (COLONY_VP[t] || 1);

  // Token total: +1 per rocket / claim / factory / outpost.
  // Colonies are scored separately (by location type) below.
  const tokensTotal =
    rocketCount + claimCount + factoryRecs.length + outpostList.length;

  // Group factories by spectral, then apply the diminishing
  // schedule per group. Total per spectral and grand total are
  // both surfaced; the panel uses both (per-spectral row for
  // the breakdown, grand total for the headline number).
  const perSpectralCount = { C: 0, S: 0, M: 0, V: 0, D: 0, H: 0 };
  for (const f of factoryRecs) {
    if (perSpectralCount[f.spectralType] != null) {
      perSpectralCount[f.spectralType]++;
    }
  }
  const byType = { C: 0, S: 0, M: 0, V: 0, D: 0, H: 0 };
  let spectralTotal = 0;
  for (const [spec, n] of Object.entries(perSpectralCount)) {
    const vp = spectralVpForCount(n);
    byType[spec] = vp;
    spectralTotal += vp;
  }

  const glory = getVps();
  const grandTotal = tokensTotal + colonyVp + spectralTotal + glory;

  return {
    tokens: {
      rocket: rocketCount,
      claims: claimCount,
      factories: factoryRecs.length,
      outposts: outpostList.length,
      total: tokensTotal,
    },
    colonies: {
      count: colonyRecs.length,
      byType: colonyByType,
      vp: colonyVp,
    },
    spectralBonus: {
      byType,
      perSpectralCount,
      total: spectralTotal,
    },
    glory,
    grandTotal,
  };
}
