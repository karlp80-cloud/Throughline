/**
 * Solver corpus test: every hand-built (puzzle, solution) pair in
 * fixtures/corpus.ts must report `victory` within the puzzle's
 * maxCycles. If a future engine change breaks any solution, the
 * failing entry surfaces the regression with a named scenario.
 *
 * See fixtures/corpus.ts for the size note (10 vs. plan's 50).
 */

import { describe, expect, test } from 'vitest';
import { runUntilHalt } from '../run';
import { CORPUS } from './fixtures/corpus';

describe('solver corpus', () => {
  for (const entry of CORPUS) {
    test(entry.name, () => {
      const result = runUntilHalt(entry.puzzle, entry.solution);
      if (result.status !== 'victory') {
        // Helpful diagnostic for failures.
        const cycles = result.trace.length;
        const lastWorld = result.trace[cycles - 1]?.worldAfter;
        const delivered = lastWorld?.deliveredCounts ?? {};
        throw new Error(
          `expected victory but got ${result.status} after ${cycles} cycles. delivered: ${JSON.stringify(delivered)}`,
        );
      }
      expect(result.status).toBe('victory');
      expect(result.trace.length).toBeLessThanOrEqual(entry.puzzle.constraints.maxCycles);
    });
  }
});
