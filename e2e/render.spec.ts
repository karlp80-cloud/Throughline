/**
 * Renderer screenshot diff tests.
 *
 * Each test loads a named fixture (`src/app/fixtures.ts`) via query
 * string and screenshots the #app element. Baselines are stored
 * under `e2e/render.spec.ts-snapshots/` (Playwright's default).
 *
 * Tolerance is set generous (`maxDiffPixelRatio: 0.01`) to absorb
 * minor anti-aliasing differences across runs. Tighten later if not
 * flaky.
 */

import { expect, test } from '@playwright/test';

const FIXTURES = ['empty', 'singleTile', 'fullPreRun', 'fullMidRun'] as const;

for (const name of FIXTURES) {
  test(`renders fixture "${name}"`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });
    await page.goto(`/?fixture=${name}`);
    const container = page.locator('#canvas-container canvas');
    try {
      await expect(container).toBeVisible();
    } catch (e) {
      if (errors.length > 0) {
        throw new Error(`Canvas not visible. Errors:\n${errors.join('\n')}`);
      }
      throw e;
    }
    await expect(page.locator('#app')).toHaveScreenshot(`${name}.png`, {
      maxDiffPixelRatio: 0.01,
    });
  });
}
