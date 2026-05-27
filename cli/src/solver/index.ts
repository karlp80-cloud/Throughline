/**
 * Top-level solver (architect doc §6.3 / §6.5).
 *
 * Strategy: iterated random restarts, seeded PRNG, budget-bounded.
 *   - generate a candidate Solution via candidate.ts
 *   - run the Phase 1 engine's `runUntilHalt`
 *   - on victory, return immediately
 *   - on cycle_limit_exceeded, record best progress and try again
 *
 * Termination conditions:
 *   - `runUntilHalt` returns 'victory' → `solvable`
 *   - elapsed ≥ timeBudgetMs → `unsolvable` with bestProgress
 *   - attempts > 100_000 → `unsolvable` (safety net)
 *
 * Determinism contract (§6.6):
 *   - `status` is deterministic for any time-budget ≥ T (the
 *     find-time on that input).
 *   - `solution` (when solvable) is byte-identical across runs
 *     given the same seed.
 *   - `attempts` is deterministic.
 *   - `elapsedMs` is NOT part of the determinism contract.
 */

import { runUntilHalt } from '../../../src/engine';
import type { Puzzle, Solution, WorldState } from '../../../src/engine';
import { generateRandomSolution } from './candidate';
import { createPRNG, hashString, type PRNG } from './prng';

export interface SolverOptions {
  /** Wall-clock budget in ms. Default 30_000. */
  readonly timeBudgetMs?: number;
  /** Deterministic seed for the PRNG. Default: hash of puzzle.id. */
  readonly seed?: string;
}

export type SolveResult =
  | { status: 'solvable'; solution: Solution; attempts: number; elapsedMs: number }
  | { status: 'unsolvable'; attempts: number; elapsedMs: number; bestProgress: number };

const DEFAULT_BUDGET_MS = 30_000;
const HARD_ATTEMPT_CAP = 100_000;

/**
 * fractionOfRequirementsFilled — §6.10 progress metric. Uses only
 * `deliveredCounts` so we don't need a trace.
 */
function progressOf(puzzle: Puzzle, world: WorldState): number {
  let requiredTotal = 0;
  let deliveredTotal = 0;
  for (const out of puzzle.outputs) {
    for (const req of out.required) {
      requiredTotal += req.count;
      const got = world.deliveredCounts[req.type] ?? 0;
      deliveredTotal += Math.min(got, req.count);
    }
  }
  if (requiredTotal === 0) return 1;
  return deliveredTotal / requiredTotal;
}

export function solve(puzzle: Puzzle, opts: SolverOptions = {}): SolveResult {
  const budget = opts.timeBudgetMs ?? DEFAULT_BUDGET_MS;
  const seed = opts.seed ?? `${puzzle.id}-${hashString(puzzle.id).toString(16)}`;
  const prng: PRNG = createPRNG(seed);

  const start = Date.now();
  let attempts = 0;
  let bestProgress = 0;

  while (attempts < HARD_ATTEMPT_CAP) {
    const candidate = generateRandomSolution(puzzle, prng);
    attempts++;
    const result = runUntilHalt(puzzle, candidate);
    if (result.status === 'victory') {
      return {
        status: 'solvable',
        solution: candidate,
        attempts,
        elapsedMs: Date.now() - start,
      };
    }
    // Final world is the last trace frame's worldAfter; if no trace,
    // we never stepped, so progress is 0.
    const lastTrace = result.trace[result.trace.length - 1];
    if (lastTrace) {
      const p = progressOf(puzzle, lastTrace.worldAfter);
      if (p > bestProgress) bestProgress = p;
    }
    if (Date.now() - start >= budget) {
      return {
        status: 'unsolvable',
        attempts,
        elapsedMs: Date.now() - start,
        bestProgress,
      };
    }
  }
  return {
    status: 'unsolvable',
    attempts,
    elapsedMs: Date.now() - start,
    bestProgress,
  };
}
