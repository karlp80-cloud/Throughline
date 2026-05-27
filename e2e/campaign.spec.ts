/**
 * Campaign e2e: two-act flow + persistence.
 *
 * 1. Load demo-two-act
 * 2. Complete act 1's puzzle (programmatic dispatch via window.__editor)
 * 3. Click through hub → finish-act → act_outro → next
 * 4. End up in act_intro 1
 * 5. Reload the page, re-select the campaign — should resume to act_intro 1
 */

import { expect, test } from '@playwright/test';

test('two-act flow advances correctly and resumes on reload', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // Open the first puzzle by clicking through the UI.
  await page.locator('button[data-campaign-id="demo-two-act"]').click();
  await page.locator('button[data-role="begin-act"]').click();
  await page.locator('button[data-puzzle-id="a1_p1"]').click();
  await page.waitForFunction(() => typeof window.__editor !== 'undefined');

  // Place 4 conveyors via the editor's window-exposed dispatch
  // (matches docs/architecture/editor.md § Test API).
  await page.evaluate(() => {
    const e = window.__editor!;
    e.dispatch({ type: 'SELECT_TILE_KIND', tileKind: 'conveyor' });
    for (let x = 0; x < 4; x++) {
      e.dispatch({ type: 'CLICK_CELL', pos: [x, 1] });
    }
  });

  // Run + wait for victory.
  await page.locator('#run-button').click();
  await page.waitForFunction(() => typeof window.__playback !== 'undefined');
  await page.locator('select[data-role="speed"]').selectOption('4');
  await page.waitForFunction(() => window.__playback?.animator().status() === 'finished', null, {
    timeout: 15000,
  });

  // Back to the editor, then leave the puzzle.
  await page.locator('button', { hasText: '⟲ Reset' }).click();
  await page.waitForFunction(() => typeof window.__editor !== 'undefined');
  await page.locator('button[data-role="back-to-hub"]').click();

  // Hub should now offer Finish act since we hit required_completions=1.
  await page.locator('button[data-role="finish-act"]').click();
  await expect(page.locator('button[data-role="act-outro-next"]')).toBeVisible();
  await page.locator('button[data-role="act-outro-next"]').click();

  // We should now be at act 2 intro.
  const stateAfter = await page.evaluate(() => window.__campaign?.state());
  expect(stateAfter).toEqual({ kind: 'act_intro', actIndex: 1 });

  // ─── Persistence: reload, re-select, expect resume to act 2 intro ───
  await page.reload();
  await page.locator('button[data-campaign-id="demo-two-act"]').click();
  const resumed = await page.evaluate(() => window.__campaign?.state());
  expect(resumed).toEqual({ kind: 'act_intro', actIndex: 1 });
});
