import { expect, test } from '@playwright/test';

test('home page shows the project name', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toContainText('Throughline');
});
