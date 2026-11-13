// Mobile Factory fleet names (M1, rule 1B6). Each of a player's Factory cubes
// carries a stable tag (alpha, beta, ...) that it keeps as it lifts off and
// lands; players see it as a fleet number, F1, F2, ... (alpha = F1), so every
// menu, list and map label names a cube the same way. Pure data: imported by
// the server (which hands out the tags) and the client (which shows them).
export const GREEK_TAGS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'omicron', 'pi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega'];

// 'delta' -> 'F4'. A tag past the Greek list is stored as 'f<n>' and reads 'F<n>'.
export function fleetLabel(tag) {
  if (!tag) return '';
  const i = GREEK_TAGS.indexOf(String(tag));
  if (i >= 0) return `F${i + 1}`;
  const m = /^f(\d+)$/i.exec(String(tag));
  return m ? `F${m[1]}` : String(tag).toUpperCase();
}
