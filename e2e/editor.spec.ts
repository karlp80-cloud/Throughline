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
  await page.goto('/?editor=1');
  await expect(page.locator('h1')).toHaveText('Throughline');
  // Wait for the editor to mount and expose its handle on window.
  await page.waitForFunction(() => typeof window.__editor !== 'undefined');

  // Click the Conveyor button in the palette.
  await page.locator('button[data-tile-kind="conveyor"]').click();

  // Grid: default fixture has fullPreRun puzzle (6x4), CELL_SIZE=48.
  // Empty cell (4,3) is a valid placement target.
  const canvas = page.locator('#app canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const targetX = (box!.x + 4 * 48 + 24) | 0;
  const targetY = (box!.y + 3 * 48 + 24) | 0;
  await page.mouse.click(targetX, targetY);

  // Begin op-edit for agent a1.
  await page.locator('button[data-agent-id="a1"]').click();
  // Append a WAIT op via the dropdown + Add button.
  const select = page.locator('select[data-role="append-op"]');
  await select.selectOption('WAIT');
  await page.locator('button', { hasText: 'Add' }).click();

  // Read draft from window.__editor.
  const draft = await page.evaluate(() => window.__editor?.getState().draft);
  expect(draft).toBeDefined();
  expect(draft!.tiles).toHaveLength(1);
  expect(draft!.tiles[0]?.kind).toBe('conveyor');
  expect(draft!.tiles[0]?.pos).toEqual([4, 3]);
  expect(draft!.programs['a1']).toEqual([{ kind: 'WAIT' }]);
});
