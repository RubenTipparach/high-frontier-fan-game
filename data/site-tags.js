// Player-driven location tags for the site-notes feature. The quick-pick tags
// players can stamp on a location; arbitrary custom tags are also allowed (the
// server sanitises them), so this list is just the suggested set. Add a new
// entry here to add a quick-pick tag - nothing else needs to change. Pure data:
// no DOM, no node imports, so both the client and the server import it.
export const SITE_TAGS = [
  { key: 'yellow',     label: 'Yellow',     color: '#f6b51e' },
  { key: 'red',        label: 'Red',        color: '#ef5350' },
  { key: 'blue',       label: 'Blue',       color: '#52caf2' },
  { key: 'aero-break', label: 'Aero-break', color: '#86efac' },
  { key: 'hazard',     label: 'Hazard',     color: '#fb7185' },
  { key: 'fly-by',     label: 'Fly-by',     color: '#c4b5fd' },
  { key: 'radiation',  label: 'Radiation',  color: '#a3e635' },
  { key: 'burn',       label: 'Burn',       color: '#fb923c' },
  { key: 'half-burn',  label: 'Half-burn',  color: '#fdba74' },
  { key: 'lander-burn', label: 'Lander-burn', color: '#f97316' },
];

export const SITE_TAG_KEYS = SITE_TAGS.map((t) => t.key);
export const SITE_TAG_BY_KEY = Object.fromEntries(SITE_TAGS.map((t) => [t.key, t]));

// Normalise an arbitrary tag string to a stable key: lowercased, spaces -> '-',
// stripped of anything but [a-z0-9-], collapsed dashes, capped length. Returns
// '' for empty/garbage. Used by both the picker and the server validator so a
// custom tag round-trips consistently.
export function normaliseTag(raw) {
  return String(raw || '')
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
}

// Display label + colour for a tag key (predefined or custom). Custom tags get a
// neutral colour and a title-cased label.
export function tagDisplay(key) {
  const known = SITE_TAG_BY_KEY[key];
  if (known) return known;
  const label = String(key || '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return { key, label, color: '#9aa3c0' };
}
