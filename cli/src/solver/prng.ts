/**
 * Seeded PRNG (splitmix64 step) + FNV-1a hash.
 *
 * Why custom rather than reaching for a library: zero dependency cost,
 * trivially auditable, and the determinism guarantee in architect §6.6
 * is easier to assert when the implementation is in-tree.
 *
 * Math.random is banned project-wide for the engine and now for the
 * solver — this is the only place where pseudo-randomness lives.
 */

/**
 * FNV-1a 32-bit string hash. Stable across runs and platforms;
 * matches the canonical reference vectors. Used to derive a numeric
 * seed from a string and to compute small hash digests for puzzle ids.
 */
export function hashString(input: string): number {
  let h = 0x811c9dc5; // FNV offset basis (32-bit)
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // 32-bit FNV prime = 16777619. Multiplied via the imul trick to
    // stay inside 32-bit unsigned semantics.
    h = Math.imul(h, 0x01000193);
  }
  // Convert to unsigned 32-bit.
  return h >>> 0;
}

export interface PRNG {
  /** Next float in [0, 1). */
  nextFloat(): number;
  /** Next integer uniformly in [lo, hi] inclusive. */
  nextInt(lo: number, hi: number): number;
  /** Pick one element uniformly. Throws on empty array. */
  pick<T>(arr: readonly T[]): T;
}

/**
 * Splitmix64-derived 32-bit PRNG.
 *
 * We work in 32-bit lanes throughout (BigInt is awkward + slow). The
 * splitmix64 mix function gives excellent statistical quality and is
 * trivial to seed deterministically.
 */
export function createPRNG(seed: string | number): PRNG {
  // Seed: hash a string seed; convert a number seed to unsigned 32-bit.
  let state = (typeof seed === 'string' ? hashString(seed) : seed >>> 0) || 0x9e3779b9; // golden ratio constant as a safety default if seed hashes to 0

  function next(): number {
    // 32-bit variant of the splitmix64 mix steps. Constants chosen to
    // mix bits aggressively while staying inside Math.imul.
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    z = (z ^ (z >>> 16)) >>> 0;
    return z;
  }

  return {
    nextFloat(): number {
      return next() / 0x100000000;
    },
    nextInt(lo: number, hi: number): number {
      if (hi < lo) throw new Error(`nextInt: hi (${hi}) < lo (${lo})`);
      const range = hi - lo + 1;
      // Bias is negligible for the small ranges the solver uses.
      return lo + Math.floor((next() / 0x100000000) * range);
    },
    pick<T>(arr: readonly T[]): T {
      if (arr.length === 0) throw new Error('pick: empty array');
      return arr[Math.floor((next() / 0x100000000) * arr.length)]!;
    },
  };
}
