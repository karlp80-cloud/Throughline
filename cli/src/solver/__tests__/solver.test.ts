/**
 * solve(puzzle, opts) tests per architect doc §6.5 / §10.4.
 *
 * Tests cover:
 *  - a hand-built solvable puzzle returns `solvable` within budget
 *  - a hand-built unsolvable puzzle returns `unsolvable` within
 *    budget + 1s
 *  - determinism: same seed → same (status, attempts, solution)
 *  - different seeds → different solutions (smoke)
 *  - the `bestProgress` field is in [0, 1]
 */

import { describe, expect, test } from 'vitest';
import { solve } from '../index';
import type { Puzzle } from '../../../../src/engine';

const solvable3x1: Puzzle = {
  id: 'solvable',
  grid: { w: 3, h: 1 },
  inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 1 }],
  outputs: [{ pos: [2, 0], required: [{ type: 'alpha', count: 1 }] }],
  agents: [],
  obstacles: [],
  availableTiles: ['conveyor'],
  availableOps: ['MOVE'],
  constraints: { maxTiles: 4, maxCycles: 20 },
  optionalChallenges: [],
};

const unsolvable: Puzzle = {
  id: 'unsolvable',
  grid: { w: 3, h: 1 },
  inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 1 }],
  // require 999 of an output type the input never emits, max_cycles: 1
  outputs: [{ pos: [2, 0], required: [{ type: 'beta', count: 999 }] }],
  agents: [],
  obstacles: [],
  availableTiles: ['conveyor'],
  availableOps: ['MOVE'],
  constraints: { maxTiles: 4, maxCycles: 1 },
  optionalChallenges: [],
};

describe('solve — solvable puzzle', () => {
  test('returns status=solvable within budget', () => {
    const r = solve(solvable3x1, { seed: 's1', timeBudgetMs: 30_000 });
    expect(r.status).toBe('solvable');
    if (r.status === 'solvable') {
      expect(r.solution).toBeDefined();
      expect(Array.isArray(r.solution.tiles)).toBe(true);
      expect(r.attempts).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('solve — unsolvable puzzle', () => {
  test('returns status=unsolvable within budget + small overhead', () => {
    const t0 = Date.now();
    const r = solve(unsolvable, { seed: 'u1', timeBudgetMs: 2000 });
    const elapsed = Date.now() - t0;
    expect(r.status).toBe('unsolvable');
    if (r.status === 'unsolvable') {
      expect(r.bestProgress).toBeGreaterThanOrEqual(0);
      expect(r.bestProgress).toBeLessThanOrEqual(1);
      expect(r.attempts).toBeGreaterThanOrEqual(1);
    }
    expect(elapsed).toBeLessThan(2500);
  }, 5_000);
});

describe('solve — determinism', () => {
  test('same seed produces identical result on solvable puzzle', () => {
    const a = solve(solvable3x1, { seed: 'det', timeBudgetMs: 10_000 });
    const b = solve(solvable3x1, { seed: 'det', timeBudgetMs: 10_000 });
    expect(a.status).toBe(b.status);
    if (a.status === 'solvable' && b.status === 'solvable') {
      expect(a.attempts).toBe(b.attempts);
      expect(JSON.stringify(a.solution)).toBe(JSON.stringify(b.solution));
    }
  });

  test('different seeds produce different solutions on solvable puzzle', () => {
    // Use a slightly larger puzzle to make divergence more likely.
    const big: Puzzle = {
      ...solvable3x1,
      grid: { w: 5, h: 3 },
      inputs: [{ pos: [0, 1], emits: ['alpha'], rate: 1 }],
      outputs: [{ pos: [4, 1], required: [{ type: 'alpha', count: 1 }] }],
      constraints: { maxTiles: 12, maxCycles: 30 },
    };
    const a = solve(big, { seed: 'one', timeBudgetMs: 10_000 });
    const b = solve(big, { seed: 'two', timeBudgetMs: 10_000 });
    expect(a.status).toBe('solvable');
    expect(b.status).toBe('solvable');
    if (a.status === 'solvable' && b.status === 'solvable') {
      // It IS possible two seeds happen to land on the same solution
      // on the first attempt. Loosen the assertion to "either solutions
      // differ OR attempt counts differ" — both being identical is a
      // strong signal of a determinism bug.
      const sameSolution = JSON.stringify(a.solution) === JSON.stringify(b.solution);
      const sameAttempts = a.attempts === b.attempts;
      expect(sameSolution && sameAttempts).toBe(false);
    }
  });
});

describe('solve — default seed', () => {
  test('uses hash of puzzle.id when seed omitted (deterministic across calls)', () => {
    // Same puzzle, no seed both times: should be deterministic.
    const a = solve(solvable3x1, { timeBudgetMs: 10_000 });
    const b = solve(solvable3x1, { timeBudgetMs: 10_000 });
    expect(a.status).toBe(b.status);
    if (a.status === 'solvable' && b.status === 'solvable') {
      expect(JSON.stringify(a.solution)).toBe(JSON.stringify(b.solution));
    }
  });
});
