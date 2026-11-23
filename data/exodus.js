// Module 4 Project Exodus tables (pure data, shared by the engine and the UI).
// Exodus Fueling Table (4E3): the minimum isototal (gold beads in all isovaults)
// for the Reckless / Crisis / Max bands, by player count, and the starship rank
// VP (1st / 2nd / 3rd most beads in an isovault) for each band.
export const EXODUS_BANDS = { 1: [6, 12, 18], 2: [11, 23, 34], 3: [16, 32, 49], 4: [21, 41, 62], 5: [24, 49, 73], 6: [28, 56, 84] };
export const EXODUS_RANK_VP = { reckless: [6, 3, 1], crisis: [12, 6, 3], max: [18, 9, 4] };
export const EXODUS_BAND_NAMES = { none: 'No launch', reckless: 'Reckless', crisis: 'Crisis', max: 'Max' };
export function exodusThresholds(nPlayers) {
  return EXODUS_BANDS[Math.max(1, Math.min(6, nPlayers | 0))] || EXODUS_BANDS[6];
}
export function exodusBand(isototal, nPlayers) {
  const t = exodusThresholds(nPlayers);
  if (isototal >= t[2]) return 'max';
  if (isototal >= t[1]) return 'crisis';
  if (isototal >= t[0]) return 'reckless';
  return 'none';
}
