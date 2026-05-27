/**
 * Phase 5 e2e: run the default puzzle to victory and assert the
 * results panel renders with the right pass/fail checkmarks.
 */

import { expect, test } from '@playwright/test';

test('results panel shows after victory with the right challenge marks', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.__editor !== 'undefined');

  // Build a solution that pipes alphas through 4 conveyors (one per
  // E-going cell along row 1).
  await page.locator('button[data-tile-kind="conveyor"]').click();
  const canvas = page.locator('#app canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  // Place conveyors at (0,1), (1,1), (2,1), (3,1).
  for (let x = 0; x < 4; x++) {
    const tx = (box!.x + x * 48 + 24) | 0;
    const ty = (box!.y + 1 * 48 + 24) | 0;
    await page.mouse.click(tx, ty);
  }

  await page.locator('#run-button').click();
  await page.waitForFunction(() => typeof window.__playback !== 'undefined');
  await page.locator('select[data-role="speed"]').selectOption('4');

  await page.waitForFunction(() => window.__playback?.animator().status() === 'finished', null, {
    timeout: 15000,
  });

  // Results panel should be visible with both challenges.
  const opts = page.locator('div[data-role="optionals"] > div');
  await expect(opts).toHaveCount(2);

  // Both passed for this solution (4 tiles, <10 cycles).
  const fast = page.locator('div[data-challenge-id="opt_fast"]');
  await expect(fast).toHaveAttribute('data-passed', 'true');
  const lean = page.locator('div[data-challenge-id="opt_lean"]');
  await expect(lean).toHaveAttribute('data-passed', 'true');
});
