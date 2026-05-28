// @vitest-environment node
/**
 * Asserts every bundled sample campaign in `campaigns/samples/`:
 *
 *   1. Parses cleanly via `parseCampaign` (the shared Zod + DSL +
 *      reactor/filter-config check).
 *   2. Has a registered reference solution for every puzzle.
 *   3. Each reference solution drives the engine to `victory` within
 *      the puzzle's declared `max_cycles`.
 *
 * Samples ship in the desktop bundle as the no-`claude` fallback per
 * design doc §11; failing-to-load samples would brick the fallback.
 */

import { describe, expect, test } from 'vitest';
import { runUntilHalt } from '../../engine';
import { parseCampaign } from '../../schema/campaign';
import { toEnginePuzzle } from '../load';
import lighthouseJson from '../../../campaigns/samples/lighthouse-keepers.json';
import switchyardJson from '../../../campaigns/samples/switchyard.json';
import atriumJson from '../../../campaigns/samples/atrium-garden.json';
import { SAMPLE_SOLUTIONS } from '../../../campaigns/samples/solutions';

const SAMPLES = {
  'lighthouse-keepers': lighthouseJson,
  switchyard: switchyardJson,
  'atrium-garden': atriumJson,
};

describe('bundled sample campaigns', () => {
  for (const [name, json] of Object.entries(SAMPLES)) {
    describe(name, () => {
      test('parses cleanly via parseCampaign', () => {
        expect(() => parseCampaign(json)).not.toThrow();
      });

      const campaign = parseCampaign(json);
      const solutions = SAMPLE_SOLUTIONS[name];

      test('has a solutions table registered', () => {
        expect(solutions, `no SAMPLE_SOLUTIONS entry for ${name}`).toBeDefined();
      });

      for (const act of campaign.acts) {
        for (const puzzle of act.puzzles) {
          test(`${puzzle.id} (${puzzle.title}) solves with its reference solution`, () => {
            const solution = solutions?.[puzzle.id];
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
      }

      test('every puzzle has a reference solution registered', () => {
        const puzzleIds = campaign.acts.flatMap((a) => a.puzzles.map((p) => p.id));
        const solIds = Object.keys(solutions ?? {});
        for (const pid of puzzleIds) {
          expect(solIds, `${pid} has no reference solution`).toContain(pid);
        }
      });
    });
  }
});
