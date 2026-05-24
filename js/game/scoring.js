// Stage-3 endgame scoring (rulebook M2).
//
// Computes the player's "if the game ended now" VP breakdown.
// Per the variant spec (industrialize.md "VP timing"):
//   - +1 VP per owned token on the map: rocket (if built),
//     successful claims (discs), factories, colony domes, and
//     outposts.
//   - Spectral-based stock-price bonus per factory (rulebook M2b
//     Exploitation Track): factories of common spectrals award
//     +4 VP each, mid-rarity +5, rare +8.
//   - Career glory VP (the live glory.js counter) is added on
//     top so the panel shows a single grand total.
//
// VP is endgame-only: industrialize and colonize do not award
// instant VP at build time. This function is what surfaces the
// final tally.
//
// IMPORTANT: the SPECTRAL_BONUS_VPS table below uses values
// pending confirmation against the published Exploitation Track
// (rulebook M2b). The buckets (+4/+5/+8) are correct; the
// per-spectral assignment is a rarity-inverse heuristic
// (commonest = lowest bonus, rarest = highest) which matches the
// spirit of the published track. Re-tune when the canonical
// table is wired in - the assignments here live in ONE place so
// it's a one-line change.
//
// Public surface:
//   SPECTRAL_BONUS_VPS  - table from spectral letter -> VP
//   computeEndgameScore({ ownerId }) -> {
//     tokens: { rocket, claims, factories, colonies, outposts, total },
//     spectralBonus: { byType, total },
//     glory,
//     grandTotal,
//   }

import { getDiscs } from './discs.js';
import { allFactories, allColonies } from './factories.js';
import { getOutposts } from './stacks.js';
import { getRocketStack } from './rocket.js';
import { getVps } from './glory.js';

// Rarity-inverse mapping (placeholder pending rulebook M2b
// confirmation). Site-population counts as of the May 2026 site
// manifest: D 50, S 46, C 45, V 24, M 13, H 10.
export const SPECTRAL_BONUS_VPS = {
  C: 4, S: 4, D: 4,
  V: 5,
  M: 8, H: 8,
};

export function computeEndgameScore({ ownerId } = {}) {
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

  const tokensTotal =
    rocketCount + claimCount + factoryRecs.length + colonyRecs.length + outpostList.length;

  // Spectral bonus per factory.
  const byType = { C: 0, S: 0, M: 0, V: 0, D: 0, H: 0 };
  let spectralTotal = 0;
  for (const f of factoryRecs) {
    const bonus = SPECTRAL_BONUS_VPS[f.spectralType] || 0;
    spectralTotal += bonus;
    if (byType[f.spectralType] != null) byType[f.spectralType] += bonus;
  }

  const glory = getVps();
  const grandTotal = tokensTotal + spectralTotal + glory;

  return {
    tokens: {
      rocket: rocketCount,
      claims: claimCount,
      factories: factoryRecs.length,
      colonies: colonyRecs.length,
      outposts: outpostList.length,
      total: tokensTotal,
    },
    spectralBonus: {
      byType,
      total: spectralTotal,
    },
    glory,
    grandTotal,
  };
}
