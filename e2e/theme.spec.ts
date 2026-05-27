/**
 * Theme e2e — verify palette injection, vocab substitution, glyph
 * variants, and (most importantly) no un-substituted `{{token}}`
 * placeholders leak into the rendered DOM.
 */

import { expect, test } from '@playwright/test';

const TOKEN_LEAK_RE = /\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}/;

async function freshGoto(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

test('default campaign: palette CSS vars match the manifest', async ({ page }) => {
  await freshGoto(page);
  await page.locator('button[data-campaign-id="demo-two-act"]').click();

  // The theme block's palette should now be live on documentElement.
  const palette = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return {
      bg: s.getPropertyValue('--bg').trim(),
      surface: s.getPropertyValue('--surface').trim(),
      fg: s.getPropertyValue('--fg').trim(),
    };
  });
  expect(palette).toEqual({ bg: '#1a1820', surface: '#241f29', fg: '#e8d8b0' });
});

test('alchemy campaign: vocab substitutes throughout the visible flow', async ({ page }) => {
  await freshGoto(page);
  await page.locator('button[data-campaign-id="demo-alchemy"]').click();

  // The act_intro renders intro_text which contains `{{essence}}` and
  // `{{phial}}`. After substitution neither should appear; both
  // replacements should be visible.
  const introText = await page.locator('p[data-role="act-intro-text"]').innerText();
  expect(introText).not.toMatch(TOKEN_LEAK_RE);
  expect(introText.toLowerCase()).toContain('essence');
  expect(introText.toLowerCase()).toContain('phial');

  // Drive forward to verify hub + puzzle title also substitute.
  await page.locator('button[data-role="begin-act"]').click();
  await page.locator('button[data-puzzle-id="a1_p1"]').click();

  const puzzleTitle = await page.locator('h2[data-role="puzzle-title"]').innerText();
  expect(puzzleTitle).not.toMatch(TOKEN_LEAK_RE);
  expect(puzzleTitle.toLowerCase()).toContain('essence');
});

test('no {{token}} leaks anywhere in the rendered DOM across visited screens', async ({ page }) => {
  await freshGoto(page);
  await page.locator('button[data-campaign-id="demo-alchemy"]').click();
  // Sweep act_intro.
  expect(await page.locator('#app').innerText()).not.toMatch(TOKEN_LEAK_RE);
  await page.locator('button[data-role="begin-act"]').click();
  // Sweep hub.
  expect(await page.locator('#app').innerText()).not.toMatch(TOKEN_LEAK_RE);
  await page.locator('button[data-puzzle-id="a1_p1"]').click();
  // Sweep puzzle.
  await page.waitForFunction(() => typeof window.__editor !== 'undefined');
  expect(await page.locator('#app').innerText()).not.toMatch(TOKEN_LEAK_RE);
});

test('applied theme exposes warnings array and palette via window.__theme', async ({ page }) => {
  await freshGoto(page);
  await page.locator('button[data-campaign-id="demo-alchemy"]').click();
  const applied = await page.evaluate(() => window.__theme);
  expect(applied).not.toBeNull();
  expect(applied?.palette.bg).toBe('#1a1820');
  // The alchemy manifest references valid families, so warnings should be empty.
  expect(applied?.warnings).toEqual([]);
});
