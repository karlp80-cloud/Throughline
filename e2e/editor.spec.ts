/**
 * Editor e2e.
 *
 * Loads the editor with the default puzzle and exercises the
 * scripted-construction path: pick a tile kind, click cells, edit
 * agent ops via the panel buttons, then read `window.__editor`
 * back to assert the draft state.
 */

import { expect, test } from '@playwright/test';

test('user can place tiles and add ops; draft state reflects the edits', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText('Throughline');
  await page.waitForFunction(() => typeof window.__editor !== 'undefined');

  await page.locator('button[data-tile-kind="conveyor"]').click();

  // Default fixture is `editorDefault` (5x3 grid, CELL_SIZE=48).
  // Cell (3,0) is empty and not on input/output/agent/obstacle.
  const canvas = page.locator('#app canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const gx = 3;
  const gy = 0;
  const targetX = (box!.x + gx * 48 + 24) | 0;
  const targetY = (box!.y + gy * 48 + 24) | 0;
  await page.mouse.click(targetX, targetY);

  await page.locator('button[data-agent-id="a1"]').click();
  const select = page.locator('select[data-role="append-op"]');
  await select.selectOption('WAIT');
  await page.locator('button', { hasText: 'Add' }).click();

  const draft = await page.evaluate(() => window.__editor?.getState().draft);
  expect(draft).toBeDefined();
  expect(draft!.tiles).toHaveLength(1);
  expect(draft!.tiles[0]?.kind).toBe('conveyor');
  expect(draft!.tiles[0]?.pos).toEqual([gx, gy]);
  expect(draft!.programs['a1']).toEqual([{ kind: 'WAIT' }]);
});
