/**
 * Tutorial e2e — scripted playthrough of all six puzzles, applying
 * each puzzle's reference solution via LOAD_SOLUTION + Run + wait
 * for finished, then advancing through hub / outro / ending.
 *
 * Validates that the tutorial campaign can in fact be completed
 * end-to-end with the reference solutions baked into
 * `campaigns/tutorial.solutions.ts`.
 */

import { expect, test } from '@playwright/test';
import { TUTORIAL_SOLUTIONS } from '../campaigns/tutorial.solutions';

const TUTORIAL_PUZZLE_IDS = [
  'p1_first_flow',
  'p2_branching',
  'p3_two_hands',
  'p4_sorters_eye',
  'p5_confluence',
  'p6_graduation',
] as const;

test.setTimeout(120_000);

test('tutorial campaign can be completed end-to-end', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('button[data-campaign-id="tutorial"]').click();
  await page.locator('button[data-role="begin-act"]').click();

  for (const pid of TUTORIAL_PUZZLE_IDS) {
    await page.locator(`button[data-puzzle-id="${pid}"]`).click();
    await page.waitForFunction(() => typeof window.__editor !== 'undefined');

    // Inject the reference solution via the editor's window-exposed
    // dispatch. This bypasses click-by-click reconstruction (and the
    // filter-type config which the editor doesn't yet surface).
    const solution = TUTORIAL_SOLUTIONS[pid]!;
    await page.evaluate((s) => {
      window.__editor?.dispatch({
        type: 'LOAD_SOLUTION',
        solution: s as unknown as Parameters<
          NonNullable<typeof window.__editor>['dispatch']
        >[0] extends {
          solution: infer S;
        }
          ? S
          : never,
      });
    }, solution);

    await page.locator('#run-button').click();
    await page.waitForFunction(() => typeof window.__playback !== 'undefined');
    await page.locator('select[data-role="speed"]').selectOption('4');
    await page.waitForFunction(() => window.__playback?.animator().status() === 'finished', null, {
      timeout: 20_000,
    });
    const halt = await page.evaluate(() => window.__playback?.animator().haltStatus());
    expect(halt, `${pid} did not reach victory (got ${halt ?? 'undefined'})`).toBe('victory');

    // Reset playback view → back to hub.
    await page.locator('button', { hasText: '⟲ Reset' }).click();
    await page.waitForFunction(() => typeof window.__editor !== 'undefined');
    await page.locator('button[data-role="back-to-hub"]').click();
  }

  // All six puzzles done → required_completions=6 satisfied → Finish act.
  await page.locator('button[data-role="finish-act"]').click();
  await page.locator('button[data-role="act-outro-next"]').click();

  // Single act → next state is ending.
  const stateAfter = await page.evaluate(() => window.__campaign?.state());
  expect(stateAfter).toEqual({ kind: 'ending' });

  // Ending text rendered.
  const endingText = await page.locator('p[data-role="ending-text"]').innerText();
  expect(endingText).toMatch(/Apprentice's Manual/);
});
