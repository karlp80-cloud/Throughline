/**
 * Playback e2e — navigate through the campaign harness to a puzzle,
 * place a solving solution, hit Run, exercise pause + step + reset.
 */

import { expect, test } from '@playwright/test';

async function openFirstPuzzle(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('button[data-campaign-id="demo-two-act"]').click();
  await page.locator('button[data-role="begin-act"]').click();
  await page.locator('button[data-puzzle-id="a1_p1"]').click();
  await page.waitForFunction(() => typeof window.__editor !== 'undefined');
}

async function placeFourConveyors(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('button[data-tile-kind="conveyor"]').click();
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  for (let x = 0; x < 4; x++) {
    await page.mouse.click((box!.x + x * 48 + 24) | 0, (box!.y + 1 * 48 + 24) | 0);
  }
}

test('Run starts playback; frame advances; Reset returns to editor', async ({ page }) => {
  await openFirstPuzzle(page);
  await placeFourConveyors(page);

  await page.locator('#run-button').click();
  await page.waitForFunction(() => typeof window.__playback !== 'undefined');
  await page.waitForFunction(() => typeof window.__editor === 'undefined');

  await page.waitForFunction(() => (window.__playback?.animator().frame() ?? -2) >= 0, null, {
    timeout: 5000,
  });

  await page.locator('select[data-role="speed"]').selectOption('4');
  await page.waitForFunction(() => window.__playback?.animator().status() === 'finished', null, {
    timeout: 15000,
  });

  await page.locator('button', { hasText: '⟲ Reset' }).click();
  await page.waitForFunction(() => typeof window.__editor !== 'undefined');
  expect(await page.evaluate(() => typeof window.__playback)).toBe('undefined');
});

test('Step button advances one cycle at a time', async ({ page }) => {
  await openFirstPuzzle(page);
  await placeFourConveyors(page);
  await page.locator('#run-button').click();
  await page.waitForFunction(() => typeof window.__playback !== 'undefined');
  await page.locator('button', { hasText: '❚❚ Pause' }).click();

  const beforeFrame = await page.evaluate(() => window.__playback!.animator().frame());
  await page.locator('button', { hasText: 'Step ▸' }).click();
  const afterFrame = await page.evaluate(() => window.__playback!.animator().frame());
  expect(afterFrame).toBe(beforeFrame + 1);
});
