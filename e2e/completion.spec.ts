/**
 * Completion e2e — runs the first puzzle to victory and verifies the
 * results panel + optional-challenge marks.
 */

import { expect, test } from '@playwright/test';

test('results panel shows after victory with the right challenge marks', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('button[data-campaign-id="demo-two-act"]').click();
  await page.locator('button[data-role="begin-act"]').click();
  await page.locator('button[data-puzzle-id="a1_p1"]').click();
  await page.waitForFunction(() => typeof window.__editor !== 'undefined');

  await page.locator('button[data-tile-kind="conveyor"]').click();
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  for (let x = 0; x < 4; x++) {
    await page.mouse.click((box!.x + x * 48 + 24) | 0, (box!.y + 1 * 48 + 24) | 0);
  }

  await page.locator('#run-button').click();
  await page.waitForFunction(() => typeof window.__playback !== 'undefined');
  await page.locator('select[data-role="speed"]').selectOption('4');
  await page.waitForFunction(() => window.__playback?.animator().status() === 'finished', null, {
    timeout: 15000,
  });

  // Both opt_fast and opt_lean should have passed for this solution.
  const opts = page.locator('div[data-role="optionals"] > div');
  await expect(opts).toHaveCount(2);
  await expect(page.locator('div[data-challenge-id="opt_fast"]')).toHaveAttribute(
    'data-passed',
    'true',
  );
  await expect(page.locator('div[data-challenge-id="opt_lean"]')).toHaveAttribute(
    'data-passed',
    'true',
  );
});
