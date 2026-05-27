/**
 * Unit tests for splitmix64 PRNG + FNV-1a hash.
 *
 * The solver needs randomness but the solver's `SolveResult` must be
 * deterministic given a `(puzzle, seed)` pair — see architect doc §6.6
 * and §6.8. So `Math.random` is banned and a seeded PRNG lives here.
 */

import { describe, expect, test } from 'vitest';
import { createPRNG, hashString } from '../prng';

describe('splitmix64 PRNG', () => {
  test('same seed produces identical output sequence', () => {
    const a = createPRNG('seed-1');
    const b = createPRNG('seed-1');
    for (let i = 0; i < 100; i++) {
      expect(a.nextFloat()).toBe(b.nextFloat());
    }
  });

  test('different seeds produce different sequences', () => {
    const a = createPRNG('seed-1');
    const b = createPRNG('seed-2');
    const aSeq: number[] = [];
    const bSeq: number[] = [];
    for (let i = 0; i < 20; i++) {
      aSeq.push(a.nextFloat());
      bSeq.push(b.nextFloat());
    }
    // Not every single value need differ, but the sequences must.
    expect(aSeq).not.toEqual(bSeq);
  });

  test('nextFloat is always in [0, 1)', () => {
    const p = createPRNG('range-test');
    for (let i = 0; i < 10_000; i++) {
      const v = p.nextFloat();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test('nextFloat is approximately uniform across 10000 draws', () => {
    const p = createPRNG('uniform');
    const buckets = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const n = 10_000;
    for (let i = 0; i < n; i++) {
      buckets[Math.floor(p.nextFloat() * 10)]!++;
    }
    const expected = n / 10;
    for (const count of buckets) {
      // Wide tolerance — uniformity check, not chi-square.
      expect(count).toBeGreaterThan(expected * 0.85);
      expect(count).toBeLessThan(expected * 1.15);
    }
  });

  test('nextInt(lo, hi) returns integer in [lo, hi]', () => {
    const p = createPRNG('intrange');
    for (let i = 0; i < 1000; i++) {
      const v = p.nextInt(5, 10);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThanOrEqual(10);
    }
  });

  test('nextInt(lo, hi) covers the full range over many draws', () => {
    const p = createPRNG('intcover');
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(p.nextInt(0, 4));
    expect(seen.has(0)).toBe(true);
    expect(seen.has(1)).toBe(true);
    expect(seen.has(2)).toBe(true);
    expect(seen.has(3)).toBe(true);
    expect(seen.has(4)).toBe(true);
  });

  test('nextInt(n, n) always returns n', () => {
    const p = createPRNG('single');
    for (let i = 0; i < 10; i++) {
      expect(p.nextInt(7, 7)).toBe(7);
    }
  });

  test('pick selects from non-empty array deterministically', () => {
    const a = createPRNG('pick-seed');
    const b = createPRNG('pick-seed');
    const arr = ['a', 'b', 'c', 'd', 'e'];
    for (let i = 0; i < 20; i++) {
      expect(a.pick(arr)).toBe(b.pick(arr));
    }
  });

  test('pick throws on empty array', () => {
    const p = createPRNG('empty');
    expect(() => p.pick([])).toThrow();
  });
});

describe('hashString (FNV-1a)', () => {
  test('returns identical 32-bit unsigned int for identical input', () => {
    expect(hashString('hello')).toBe(hashString('hello'));
    expect(hashString('')).toBe(hashString(''));
  });

  test('returns different hashes for different inputs', () => {
    expect(hashString('foo')).not.toBe(hashString('bar'));
    expect(hashString('a')).not.toBe(hashString('b'));
  });

  test('matches the hand-computed FNV-1a 32-bit value for known inputs', () => {
    // Reference values from FNV-1a 32-bit spec:
    //   "" → 0x811c9dc5
    //   "a" → 0xe40c292c
    //   "foobar" → 0xbf9cf968
    // These are the canonical test vectors.
    expect(hashString('')).toBe(0x811c9dc5);
    expect(hashString('a')).toBe(0xe40c292c);
    expect(hashString('foobar')).toBe(0xbf9cf968);
  });

  test('is stable across many calls', () => {
    const v = hashString('throughline');
    for (let i = 0; i < 10; i++) {
      expect(hashString('throughline')).toBe(v);
    }
  });
});
