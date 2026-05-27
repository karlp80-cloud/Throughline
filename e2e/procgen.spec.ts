/**
 * Procgen e2e — Tauri + browser fallback flows.
 *
 * The Tauri side is exercised via a minimal Page-side shim:
 * `page.addInitScript` plants `window.__TAURI_INTERNALS__` with an
 * `invoke` that routes by command name to canned per-test responses,
 * and a `transformCallback` that returns a global numeric id so the
 * event-plugin path works.
 *
 * The shim handles:
 *   - User commands (`generate_campaign`, `cancel_generation`,
 *     `read_campaign_file`) — return the canned response set up via
 *     `window.__procgenMock__.setResponses(...)`.
 *   - Tauri's internal `plugin:event|listen` / `unlisten` — registers
 *     the callback id; the test driver fires `procgen:progress` events
 *     by calling the registered callback's `payload` shape directly.
 *
 * Matrix (architect §11.3):
 *   - Tauri happy path
 *   - Tauri CLI error (exit 1)
 *   - Tauri CLI returns garbage manifest
 *   - Tauri cancellation
 *   - Browser fallback (valid manifest)
 *   - Browser fallback (Zod-failing manifest)
 *
 * The "Tauri CLI hangs" scenario is exercised in the unit suite
 * (newCampaignModal.test.ts safety-timer test); driving fake timers
 * in Playwright is more friction than it's worth.
 */

import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A minimal procgen manifest that passes `parseCampaign`.
const SMALL_MANIFEST = {
  version: 1,
  seed: 'e2e-seed',
  theme: {
    name: 'E2E Theme',
    setting_summary: '',
    palette: {
      bg: '#000000',
      surface: '#101010',
      fg: '#ffffff',
      muted: '#808080',
      accent: '#ff0000',
      success: '#00ff00',
      danger: '#ff00ff',
    },
    glyphs: { input: 'alembic' },
    vocabulary: { cargo: 'alpha' },
  },
  acts: [
    {
      id: 'a1',
      title: 'A1',
      intro_text: 'intro',
      outro_text: 'outro',
      required_completions: 1,
      puzzles: [
        {
          id: 'p1',
          title: 'P1',
          briefing: '',
          grid: { w: 5, h: 3 },
          inputs: [{ pos: [0, 1], emits: ['alpha'], rate: 1 }],
          outputs: [{ pos: [4, 1], required: [{ type: 'alpha', count: 3 }] }],
          agents: [],
          obstacles: [],
          available_tiles: ['conveyor'],
          available_ops: ['MOVE'],
          constraints: { max_tiles: 8, max_cycles: 30 },
          optional_challenges: [],
        },
      ],
    },
  ],
  ending: { good: 'good', neutral: 'neutral' },
};
const SMALL_MANIFEST_JSON = JSON.stringify(SMALL_MANIFEST);

type MockResponse =
  | { kind: 'ok'; value: unknown }
  | { kind: 'reject'; value: unknown }
  | { kind: 'never' };

declare global {
  interface Window {
    __procgenMock__?: {
      setResponse(cmd: string, response: MockResponse): void;
      lastArgs(cmd: string): unknown;
      firedCancel: boolean;
    };
  }
}

/**
 * The Tauri shim init script. Runs before any page script. Plants
 *   - `__TAURI_INTERNALS__` so `detectPlatform()` returns 'tauri'.
 *   - `__procgenMock__` so the test driver can set canned responses.
 */
function tauriShim(): string {
  return /* js */ `
(() => {
  const responses = new Map();
  const argsByCmd = new Map();
  let cancelFired = false;
  let callbackCounter = 1;
  const callbacks = new Map();

  function dispatchInvoke(cmd, args) {
    argsByCmd.set(cmd, args);
    if (cmd === 'cancel_generation') cancelFired = true;
    // Tauri-internal event plugin invocations.
    if (cmd === 'plugin:event|listen') {
      const handler = args && args.handler;
      const eventName = args && args.event;
      // Tauri assigns a numeric handler id; reuse the same id the
      // shim handed out from transformCallback. We just store under
      // the event name → handler id list.
      const listeners = callbacks.get(eventName) || [];
      listeners.push(handler);
      callbacks.set(eventName, listeners);
      return Promise.resolve(handler);
    }
    if (cmd === 'plugin:event|unlisten') {
      return Promise.resolve();
    }
    const r = responses.get(cmd);
    if (!r) {
      return Promise.reject({
        kind: 'internal-error',
        message: 'mock: no response set for ' + cmd,
      });
    }
    if (r.kind === 'ok') return Promise.resolve(r.value);
    if (r.kind === 'reject') return Promise.reject(r.value);
    // 'never'
    return new Promise(() => {});
  }

  window.__TAURI_INTERNALS__ = {
    invoke: (cmd, args) => dispatchInvoke(cmd, args || {}),
    transformCallback: (handler /* , once */) => {
      const id = callbackCounter++;
      const fn = (...passed) => handler(...passed);
      // Global accessor — Tauri's runtime convention uses
      // \`window['_' + id]\` but our shim stashes by id directly.
      callbacks.set(id, fn);
      return id;
    },
    unregisterCallback: (id) => callbacks.delete(id),
    convertFileSrc: (p) => p,
  };

  window.__procgenMock__ = {
    setResponse(cmd, response) { responses.set(cmd, response); },
    lastArgs(cmd) { return argsByCmd.get(cmd); },
    get firedCancel() { return cancelFired; },
    set firedCancel(v) { cancelFired = v; },
  };
})();
`;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(tauriShim());
});

test.describe('Tauri flow', () => {
  test('happy path: Generate → manifest loaded → act_intro 0', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.evaluate(
      ({ manifest }) => {
        window.__procgenMock__!.setResponse('generate_campaign', {
          kind: 'ok',
          value: {
            path: '/x/p.json',
            manifestJson: manifest,
            elapsedMs: 1234,
            seedUsed: 'e2e-seed',
          },
        });
      },
      { manifest: SMALL_MANIFEST_JSON },
    );
    // Click New Campaign → form opens.
    await page.locator('button[data-role="new-campaign"]').click();
    // Click Generate.
    await page.locator('button[data-role="generate"]').click();
    // Wait for the harness to transition to act_intro.
    await page.waitForFunction(
      () => {
        const s = window.__campaign?.state();
        return s && s.kind === 'act_intro';
      },
      null,
      { timeout: 10_000 },
    );
    const state = await page.evaluate(() => window.__campaign?.state());
    expect(state).toEqual({ kind: 'act_intro', actIndex: 0 });
    const themeName = await page.evaluate(() => window.__campaign?.campaign()?.theme?.name);
    expect(themeName).toBe('E2E Theme');
  });

  test('CLI exit 1 surfaces the error modal with Retry', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.evaluate(() => {
      window.__procgenMock__!.setResponse('generate_campaign', {
        kind: 'reject',
        value: { kind: 'cli-exit', message: 'oops', cliExitCode: 1, cliStderr: 'boom' },
      });
    });
    await page.locator('button[data-role="new-campaign"]').click();
    await page.locator('button[data-role="generate"]').click();
    // The error modal should appear.
    const modal = page.locator('[data-role="procgen-error-modal"]');
    await expect(modal).toBeVisible({ timeout: 10_000 });
    await expect(modal).toHaveAttribute('data-error-class', 'cli-exit');
    // Has a Retry affordance.
    await expect(modal.locator('button[data-action="retry"]')).toBeVisible();
    // Stderr rendered through textContent.
    await expect(modal.locator('pre[data-role="stderr"]')).toHaveText('boom');
    // Close to clean up.
    await modal.locator('button[data-action="close"]').click();
  });

  test('garbage manifest fails parseCampaign → schema-fail error modal', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.evaluate(() => {
      window.__procgenMock__!.setResponse('generate_campaign', {
        kind: 'ok',
        value: {
          path: '/x/p.json',
          manifestJson: JSON.stringify({ hello: 'world' }), // fails parseCampaign
          elapsedMs: 0,
          seedUsed: 'garbage',
        },
      });
    });
    await page.locator('button[data-role="new-campaign"]').click();
    await page.locator('button[data-role="generate"]').click();
    const modal = page.locator('[data-role="procgen-error-modal"]');
    await expect(modal).toBeVisible({ timeout: 10_000 });
    await expect(modal).toHaveAttribute('data-error-class', 'schema-fail');
    await modal.locator('button[data-action="close"]').click();
  });

  test('Cancel mid-flight kills the job and returns to main menu', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    // Generate never resolves so we can click Cancel.
    await page.evaluate(() => {
      window.__procgenMock__!.setResponse('generate_campaign', { kind: 'never' });
      window.__procgenMock__!.setResponse('cancel_generation', { kind: 'ok', value: undefined });
    });
    await page.locator('button[data-role="new-campaign"]').click();
    await page.locator('button[data-role="generate"]').click();
    // Generating view shows up.
    await expect(page.locator('[data-role="generating"]')).toBeVisible();
    await page.locator('button[data-role="cancel-generation"]').click();
    // Modal goes away, cancel was fired.
    await expect(page.locator('[data-role="generating"]')).toHaveCount(0);
    const cancelFired = await page.evaluate(() => window.__procgenMock__!.firedCancel);
    expect(cancelFired).toBe(true);
  });
});

test.describe('Browser fallback', () => {
  // Override the init script so __TAURI_INTERNALS__ is not present in
  // browser-mode tests. We do this by replacing the init script with
  // one that *only* declares the procgen mock without the Tauri marker.
  test.beforeEach(async ({ page, context }) => {
    // Playwright applies init scripts in the order they were added.
    // The outer `beforeEach` already added the Tauri shim — we layer
    // a "delete marker" script on top to flip back to browser mode.
    await context.clearCookies();
    await page.addInitScript(() => {
      delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    });
  });

  test('valid manifest via file picker → loads + act_intro 0', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    // The New Campaign button is still present in browser mode (Q3
    // resolved: always visible). Click → fallback modal.
    await page.locator('button[data-role="new-campaign"]').click();
    await expect(page.locator('[data-role="browser-fallback-modal"]')).toBeVisible();
    // Upload a valid manifest via the hidden <input type="file">.
    await page.locator('input[data-role="file-input"]').setInputFiles({
      name: 'campaign.json',
      mimeType: 'application/json',
      buffer: Buffer.from(SMALL_MANIFEST_JSON, 'utf-8'),
    });
    await page.waitForFunction(
      () => {
        const s = window.__campaign?.state();
        return s && s.kind === 'act_intro';
      },
      null,
      { timeout: 10_000 },
    );
  });

  test('Zod-failing manifest → schema-fail error modal', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.locator('button[data-role="new-campaign"]').click();
    await expect(page.locator('[data-role="browser-fallback-modal"]')).toBeVisible();
    await page.locator('input[data-role="file-input"]').setInputFiles({
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ hello: 'world' }), 'utf-8'),
    });
    const modal = page.locator('[data-role="procgen-error-modal"]');
    await expect(modal).toBeVisible({ timeout: 10_000 });
    await expect(modal).toHaveAttribute('data-error-class', 'schema-fail');
    await modal.locator('button[data-action="close"]').click();
  });
});

// Reference to silence "unused import" warnings — readFileSync / join
// are reserved for fixture loading if the e2e ever wants to share with
// the unit-test corpus.
void readFileSync;
void join;
