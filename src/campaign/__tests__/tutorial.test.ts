// @vitest-environment node
/**
 * Asserts every tutorial puzzle has a reference solution that
 * actually reports `victory` within the puzzle's max_cycles. Saves
 * Phase 9 reviewers (and the playtesters) from finding an
 * unsolvable puzzle the hard way.
 */

import { describe, expect, test } from 'vitest';
import { TUTORIAL_SOLUTIONS } from '../../../campaigns/tutorial.solutions';
import tutorialJson from '../../../campaigns/tutorial.json';
import { runUntilHalt } from '../../engine';
import { toEnginePuzzle } from '../load';
import { parseCampaign } from '../../schema/campaign';

const TUTORIAL = parseCampaign(tutorialJson);

describe('tutorial reference solutions', () => {
  for (const puzzle of TUTORIAL.acts[0]!.puzzles) {
    test(`${puzzle.id} (${puzzle.title}) solves with its reference solution`, () => {
      const solution = TUTORIAL_SOLUTIONS[puzzle.id];
      expect(solution, `missing reference solution for ${puzzle.id}`).toBeDefined();
      const result = runUntilHalt(toEnginePuzzle(puzzle), solution!);
      if (result.status !== 'victory') {
        const trace = result.trace;
        throw new Error(
          `${puzzle.id} ended in ${result.status} after ${trace.length} cycles. ` +
            `delivered: ${JSON.stringify(trace[trace.length - 1]?.worldAfter.deliveredCounts ?? {})}`,
        );
      }
      expect(result.status).toBe('victory');
      expect(result.trace.length).toBeLessThanOrEqual(puzzle.constraints.max_cycles);
    });
  }

  test('every puzzle has a reference solution registered', () => {
    const puzzleIds = TUTORIAL.acts[0]!.puzzles.map((p) => p.id);
    const solIds = Object.keys(TUTORIAL_SOLUTIONS);
    for (const pid of puzzleIds) {
      expect(solIds, `${pid} has no reference solution`).toContain(pid);
    }
  });
});
