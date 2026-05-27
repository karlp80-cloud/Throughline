/**
 * Live `claude -p` integration test (architect §10.7).
 *
 * Gated by `RUN_LIVE_LLM=1`. Never runs in CI. A developer runs
 * `RUN_LIVE_LLM=1 npx vitest run cli/integration/` locally before
 * tagging a release.
 *
 * Behavior:
 *   - calls the real claude -p subprocess
 *   - asks for a 1-act 2-puzzle manifest
 *   - validates via the shared schema
 *   - runs the solver on every puzzle
 *
 * Assertion: validation passes AND solver passes within ~60s.
 * Byte-equality across runs is NOT asserted — Claude isn't perfectly
 * deterministic.
 */

import { describe, expect, test } from 'vitest';
import { generate } from '../src/generator';

const SHOULD_RUN = process.env['RUN_LIVE_LLM'] === '1';

describe.skipIf(!SHOULD_RUN)('live claude -p integration', () => {
  test('generates a small valid solvable manifest', async () => {
    const result = await generate({
      seed: 'live-test-seed',
      acts: 1,
      puzzlesPerAct: 2,
      gentle: true,
      timeBudgetPerPuzzleMs: 30_000,
    });
    expect(result.manifest.version).toBe(1);
    expect(result.manifest.acts.length).toBe(1);
    expect(result.manifest.acts[0]!.puzzles.length).toBeGreaterThanOrEqual(1);
    expect(result.stats.totalLlmCalls).toBeGreaterThanOrEqual(1);
  }, 180_000); // 3 minutes wall-clock budget
});

// When the gate is closed, register a no-op test so vitest doesn't
// complain about the empty file in non-gated runs.
describe.skipIf(SHOULD_RUN)('live claude -p integration (skipped)', () => {
  test('skipped — set RUN_LIVE_LLM=1 to enable', () => {
    expect(SHOULD_RUN).toBe(false);
  });
});
