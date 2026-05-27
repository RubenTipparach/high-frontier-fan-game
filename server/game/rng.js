// Seeded RNG for deterministic games.
//
// Every game stores an integer seed (games.seed). All randomness the
// engine consumes (deck shuffles, the Sunspot-Cube d6, future prospect
// rolls) runs through a generator derived from that seed, so a game can
// be replayed from its operation log and land in the exact same state.
//
// mulberry32 is a tiny, fast, well-distributed 32-bit PRNG. It is NOT
// cryptographic and must never gate auth; it only drives game chance.
//
// IMPORTANT: the generator is stateful. The engine advances it as it
// consumes random values and persists the resulting cursor on the
// state (state.rng.cursor) so a later operation resumes the exact
// same stream rather than re-seeding from scratch.

export function randomSeed() {
  // 31-bit non-negative integer; comfortably inside a SQLite INTEGER
  // and JSON-safe. Math.random is fine here: this only picks the seed
  // once at game creation, it doesn't drive in-game chance.
  return Math.floor(Math.random() * 0x7fffffff);
}

// Build a generator from (seed, cursor). cursor is how many draws have
// already been consumed; we fast-forward to that point so resuming a
// persisted stream is deterministic. Returns an object whose .next()
// yields a float in [0, 1) and tracks .cursor.
export function makeRng(seed, cursor = 0) {
  let a = (seed >>> 0) + 0x6d2b79f5 * (cursor >>> 0);
  let count = cursor >>> 0;
  const gen = {
    get cursor() { return count; },
    next() {
      count = (count + 1) >>> 0;
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    // Integer in [0, n).
    int(n) {
      return Math.floor(gen.next() * n);
    },
    // 1d6.
    d6() {
      return 1 + gen.int(6);
    },
  };
  return gen;
}

// Fisher-Yates over a copy, driven by the supplied generator so the
// shuffle is reproducible. Mutates nothing the caller passed in.
export function shuffle(gen, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = gen.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
