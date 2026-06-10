// Stage-3 endgame scoring (rulebook M2).
//
// Computes the player's "if the game ended now" VP breakdown.
// Per the variant spec (industrialize.md "VP timing"):
//   - +1 VP per owned token on the map: rocket (if built),
//     your successful claims (discs), your factories, colony
//     domes, and outposts.
//   - Spectral-based stock-price bonus (rulebook M2b Exploitation
//     Track). The track is GLOBAL: every player's factory of a
//     spectral advances that spectral's shared disc and lowers its
//     price. Each spectral's diminishing schedule is 8 / 5 / 4 (the
//     market price once 1 / 2 / 3+ factories of that spectral exist
//     ANYWHERE). The player scores that price for each of THEIR OWN
//     factories of the spectral, so a rival building a factory of
//     your spectral moves your track and trims your payout. Schedule
//     is the same for all six spectrals (C / S / M / V / D / H).
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
//     spectralBonus: { byType, perSpectralCount (GLOBAL, drives the track
//                      disc), ownPerSpectralCount (this player's holdings),
//                      total },
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
  const rocketCount = getRocketStack().length > 0 ? 1 : 0;

  // Claims: each success disc scores +1 for ITS owner. Solo discs carry no
  // ownerId (every disc is the local player's), so a missing ownerId counts;
  // in multiplayer only the local player's success discs count as their claims.
  const discs = getDiscs() || {};
  let claimCount = 0;
  for (const id in discs) {
    const d = discs[id];
    if (d && d.outcome === 'success'
        && (!ownerId || d.ownerId == null || d.ownerId === ownerId)) claimCount++;
  }

  const factories = allFactories();
  const colonies  = allColonies();
  const outpostsMap = getOutposts();

  // Owner filtering for the player's OWN tokens (+1 each). The exploitation
  // track, though, is a GLOBAL market: every player's factory of a spectral
  // pushes the same track, so its disc position + per-factory price are read
  // from ALL factories on the map, not just this player's.
  const ownFactories = ownerId ? factories.filter((f) => f.ownerId === ownerId) : factories;
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

  // Token total: +1 per rocket / claim / OWN factory / outpost.
  // Colonies are scored separately (by location type) below.
  const tokensTotal =
    rocketCount + claimCount + ownFactories.length + outpostList.length;

  // Exploitation track (GLOBAL): the disc for each spectral sits at the total
  // count of that spectral's factories across ALL players, and the per-factory
  // market price is the diminishing schedule clamped to that count (more
  // factories of a spectral anywhere => a lower price). The player then scores
  // that price for each of THEIR OWN factories of the spectral, so an opponent
  // building a factory of your spectral moves your track and trims your price.
  const SPECS = ['C', 'S', 'M', 'V', 'D', 'H'];
  const globalPerSpectral = { C: 0, S: 0, M: 0, V: 0, D: 0, H: 0 };
  for (const f of factories) {
    if (globalPerSpectral[f.spectralType] != null) globalPerSpectral[f.spectralType]++;
  }
  const ownPerSpectral = { C: 0, S: 0, M: 0, V: 0, D: 0, H: 0 };
  for (const f of ownFactories) {
    if (ownPerSpectral[f.spectralType] != null) ownPerSpectral[f.spectralType]++;
  }
  const lastRate = SPECTRAL_DIMINISHING_SCHEDULE[SPECTRAL_DIMINISHING_SCHEDULE.length - 1];
  const priceFor = (globalCount) => {
    if (globalCount <= 0) return 0;
    return SPECTRAL_DIMINISHING_SCHEDULE[globalCount - 1] != null
      ? SPECTRAL_DIMINISHING_SCHEDULE[globalCount - 1] : lastRate;
  };
  const byType = { C: 0, S: 0, M: 0, V: 0, D: 0, H: 0 };
  let spectralTotal = 0;
  for (const spec of SPECS) {
    const vp = ownPerSpectral[spec] * priceFor(globalPerSpectral[spec]);
    byType[spec] = vp;
    spectralTotal += vp;
  }

  const glory = getVps();
  const grandTotal = tokensTotal + colonyVp + spectralTotal + glory;

  return {
    tokens: {
      rocket: rocketCount,
      claims: claimCount,
      factories: ownFactories.length,
      outposts: outpostList.length,
      total: tokensTotal,
    },
    colonies: {
      count: colonyRecs.length,
      byType: colonyByType,
      vp: colonyVp,
    },
    spectralBonus: {
      byType,                              // the player's VP per spectral (own holdings @ market price)
      perSpectralCount: globalPerSpectral, // GLOBAL count - drives the track disc
      ownPerSpectralCount: ownPerSpectral, // the player's own holdings per spectral
      total: spectralTotal,
    },
    glory,
    grandTotal,
  };
}
