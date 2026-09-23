// Structural diff / patch for game states, for storing the board history as
// DIFFS against a full "base" board instead of a full copy per operation
// (server/history.js). Pure: no DB, no I/O.
//
// A patch is a list of steps, applied in order:
//   ['s', path, value]   set the value at path (path [] replaces the root)
//   ['d', path]          delete the object key at path
//   ['a', path, items]   append items to the array at path
//   ['t', path, length]  truncate the array at path to length
// A path is a list of object keys and array indexes.
//
// Arrays are diffed index by index, with an append or a truncate for the
// length change. When that comes out bigger than the array itself (a deck that
// lost its TOP card shifts every index) the whole array is set instead.
//
// Both sides are expected to be plain JSON (what JSON.parse gives back), which
// is how the history is stored anyway.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function diffState(a, b) {
  const out = [];
  walk(a, b, [], out);
  return out;
}

function walk(a, b, path, out) {
  if (a === b) return;
  if (Array.isArray(a) && Array.isArray(b)) {
    const sub = [];
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) walk(a[i], b[i], path.concat(i), sub);
    if (b.length > n) sub.push(['a', path, b.slice(n)]);
    else if (a.length > n) sub.push(['t', path, n]);
    if (!sub.length) return;
    if (JSON.stringify(sub).length >= JSON.stringify(b).length) out.push(['s', path, b]);
    else for (const step of sub) out.push(step);
    return;
  }
  if (isObj(a) && isObj(b)) {
    for (const k of Object.keys(b)) {
      if (!Object.prototype.hasOwnProperty.call(a, k)) out.push(['s', path.concat(k), b[k]]);
      else walk(a[k], b[k], path.concat(k), out);
    }
    for (const k of Object.keys(a)) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) out.push(['d', path.concat(k)]);
    }
    return;
  }
  out.push(['s', path, b]);
}

// Own-property write that cannot reach a prototype, whatever the key is.
function put(target, key, value) {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
}

// Apply a patch to a COPY of base. base is never modified.
export function applyPatch(base, patch) {
  let root = structuredClone(base);
  for (const step of patch || []) {
    const [op, path] = step;
    if (!Array.isArray(path)) throw new Error('bad_patch');
    if (op === 's' && path.length === 0) { root = structuredClone(step[2]); continue; }
    const parentPath = op === 'a' || op === 't' ? path : path.slice(0, -1);
    let node = root;
    for (const k of parentPath) {
      if (node == null || typeof node !== 'object') throw new Error('bad_patch');
      node = node[k];
    }
    if (node == null || typeof node !== 'object') throw new Error('bad_patch');
    const last = path[path.length - 1];
    if (op === 's') put(node, last, structuredClone(step[2]));
    else if (op === 'd') delete node[last];
    else if (op === 'a') { if (!Array.isArray(node)) throw new Error('bad_patch'); node.push(...structuredClone(step[2])); }
    else if (op === 't') { if (!Array.isArray(node)) throw new Error('bad_patch'); node.length = step[2]; }
    else throw new Error('bad_patch');
  }
  return root;
}

// Deep equality for plain JSON, ignoring object key order.
export function sameState(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameState(a[i], b[i])) return false;
    return true;
  }
  if (isObj(a)) {
    if (!isObj(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) {
      if (!Object.prototype.hasOwnProperty.call(b, k) || !sameState(a[k], b[k])) return false;
    }
    return true;
  }
  return false;
}
