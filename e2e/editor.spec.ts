/**
 * Editor e2e — exercise the scripted-construction path inside the
 * Phase 7 campaign harness:
 *   main menu → select campaign → begin act → open puzzle.
 * Then test the editor handle that the puzzle session published.
 */

import { expect, test } from '@playwright/test';

test('user can place tiles inside a campaign puzzle session', async ({ page }) => {
  await page.goto('/');
  // Reset persisted progress to start each run fresh.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('h1')).toHaveText('Throughline');

  await page.locator('button[data-campaign-id="demo-two-act"]').click();
  await page.locator('button[data-role="begin-act"]').click();
  await page.locator('button[data-puzzle-id="a1_p1"]').click();
  await page.waitForFunction(() => typeof window.__editor !== 'undefined');

  await page.locator('button[data-tile-kind="conveyor"]').click();
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  // a1_p1 is a 5x3 grid; (3,0) is an empty non-input/output cell.
  const gx = 3;
  const gy = 0;
  await page.mouse.click((box!.x + gx * 48 + 24) | 0, (box!.y + gy * 48 + 24) | 0);

  const draft = await page.evaluate(() => window.__editor?.getState().draft);
  expect(draft).toBeDefined();
  expect(draft!.tiles).toHaveLength(1);
  expect(draft!.tiles[0]?.kind).toBe('conveyor');
  expect(draft!.tiles[0]?.pos).toEqual([gx, gy]);
});
