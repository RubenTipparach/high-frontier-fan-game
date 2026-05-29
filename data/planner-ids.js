// Stable slug generator for planner-map nodes. Lives in data/ so both
// the browser (js/game/planner-map.js) and the Node server
// (server/game/graph.js) import THE SAME implementation - the slug a
// client sends MUST be the slug the server expects, end of story.
//
// Slug rules:
//   - Named sites slug their name: "Itokawa" -> "itokawa".
//   - Named waypoints get a type prefix: LEO lagrange -> "lag-leo".
//   - Unnamed waypoints get a `<typePrefix>-<5-char position hash>`
//     so two same-type waypoints can't collide unless their (x, y)
//     are byte-identical (which never happens in the canonical data).
//   - disambiguateRefIds() suffixes "-2", "-3", ... if two raw
//     entries still collide after the rules above.

const TYPE_PREFIX = {
  site: 'site', lagrange: 'lag', burn: 'burn', hohmann: 'hoh',
  decorative: 'dec', radhaz: 'rad', venus: 'venus', unknown: 'wp',
};

export function slugify(name) {
  return String(name).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// djb2 -> base36, 5 chars. ~60M buckets for ~1500 waypoints.
function shortHash5(s) {
  let h = 5381 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h.toString(36).padStart(5, '0').slice(-5);
}

export function makeRefId(p, rawType) {
  if (p && p.siteName) {
    const slug = slugify(p.siteName);
    if (slug) {
      if (rawType !== 'site') {
        return `${TYPE_PREFIX[rawType] || 'wp'}-${slug}`;
      }
      return slug;
    }
  }
  const prefix = TYPE_PREFIX[rawType] || 'wp';
  const posKey = `${((p && p.x) || 0).toFixed(6)},${((p && p.y) || 0).toFixed(6)}`;
  return `${prefix}-${shortHash5(posKey)}`;
}

// Pure: returns an array of { id, raw } pairs, disambiguated. Caller
// can attach the slug back to its original entry.
export function disambiguate(slugs) {
  const seen = new Map();
  return slugs.map((s) => {
    const base = s;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n > 1 ? `${base}-${n}` : base;
  });
}
