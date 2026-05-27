/**
 * Playback e2e.
 *
 * Drives the full Run → animate → Reset → edit cycle. Uses the
 * `window.__editor` and `window.__playback` test hooks; no
 * screenshot diff (that's Phase 2's job).
 */

import { expect, test } from '@playwright/test';

test('Run starts playback; frame advances; Reset returns to editor', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.__editor !== 'undefined');

  // Place a single conveyor so we have a solution to run (the default
  // puzzle's `fullPreRun` fixture already has tiles, but they cover
  // the whole pipeline; we don't actually need to add any here).
  // Just click Run.
  await page.locator('#run-button').click();

  // The editor handle is gone; the playback handle should be live.
  await page.waitForFunction(() => typeof window.__playback !== 'undefined');
  await page.waitForFunction(() => typeof window.__editor === 'undefined');

  // Frame should advance from -1 (pre-run) within a couple of seconds.
  await page.waitForFunction(() => (window.__playback?.animator().frame() ?? -2) >= 0, null, {
    timeout: 5000,
  });

  // Speed up the rest of the run via the speed selector to keep the
  // test fast.
  await page.locator('select[data-role="speed"]').selectOption('4');

  // Wait for the animator to finish (or hit cycle limit).
  await page.waitForFunction(() => window.__playback?.animator().status() === 'finished', null, {
    timeout: 15000,
  });

  // Click Reset to return to the editor.
  await page.locator('button', { hasText: '⟲ Reset' }).click();
  await page.waitForFunction(() => typeof window.__editor !== 'undefined');
  expect(await page.evaluate(() => typeof window.__playback)).toBe('undefined');
});

test('Step button advances one cycle at a time', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.__editor !== 'undefined');
  await page.locator('#run-button').click();
  await page.waitForFunction(() => typeof window.__playback !== 'undefined');

  // Pause immediately so Step is the only thing that advances.
  await page.locator('button', { hasText: '❚❚ Pause' }).click();

  // Step once and verify the frame index incremented.
  const beforeFrame = await page.evaluate(() => window.__playback!.animator().frame());
  await page.locator('button', { hasText: 'Step ▸' }).click();
  const afterFrame = await page.evaluate(() => window.__playback!.animator().frame());
  expect(afterFrame).toBe(beforeFrame + 1);
});
