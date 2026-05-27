// @vitest-environment jsdom
/**
 * Tests for the platform detection module.
 *
 * The test matrix per architect §11.2:
 *   1. detect-tauri — `__TAURI_INTERNALS__` set → isTauri() === true
 *   2. detect-tauri-legacy — only `__TAURI__` set → isTauri() === true
 *   3. detect-browser — no markers → isTauri() === false
 *   4. detect-ssr — no `window` (we approximate by deleting markers; full
 *      SSR is exercised via a node-env subtest)
 *   5. handle-throws-outside-tauri — `tauriHandle()` rejects with
 *      `PlatformNotTauriError`
 *
 * Detection is memoized inside the module, so each test runs in a
 * fresh module via `vi.resetModules()`.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  }
}

function clearMarkers(): void {
  const w = window as Window;
  delete w.__TAURI_INTERNALS__;
  delete w.__TAURI__;
}

describe('detectPlatform', () => {
  beforeEach(() => {
    clearMarkers();
    vi.resetModules();
  });
  afterEach(() => {
    clearMarkers();
  });

  test('detect-tauri: `__TAURI_INTERNALS__` present → tauri', async () => {
    (window as Window).__TAURI_INTERNALS__ = {};
    const mod = await import('./platform');
    expect(mod.detectPlatform()).toBe('tauri');
    expect(mod.isTauri()).toBe(true);
  });

  test('detect-tauri-legacy: only `__TAURI__` present → tauri', async () => {
    (window as Window).__TAURI__ = {};
    const mod = await import('./platform');
    expect(mod.detectPlatform()).toBe('tauri');
    expect(mod.isTauri()).toBe(true);
  });

  test('detect-browser: no markers → browser', async () => {
    clearMarkers();
    const mod = await import('./platform');
    expect(mod.detectPlatform()).toBe('browser');
    expect(mod.isTauri()).toBe(false);
  });
});

describe('detectPlatform — SSR (no window)', () => {
  test('returns "browser" when `window` is undefined', async () => {
    // Simulate SSR via a temporary undefined window. We can't actually
    // remove `window` in jsdom, so we vi.stub it. The implementation
    // must check `typeof window === 'undefined'` to handle the real
    // SSR case (Node/script bundlers); we exercise that check by
    // replacing window with `undefined` for one call.
    vi.resetModules();
    const original = globalThis.window;
    (globalThis as { window?: unknown }).window = undefined;
    try {
      const mod = await import('./platform');
      expect(mod.detectPlatform()).toBe('browser');
    } finally {
      (globalThis as { window?: unknown }).window = original;
    }
  });
});

describe('tauriHandle', () => {
  beforeEach(() => {
    clearMarkers();
    vi.resetModules();
  });
  afterEach(() => {
    clearMarkers();
  });

  test('handle-throws-outside-tauri: rejects with PlatformNotTauriError', async () => {
    const { tauriHandle, PlatformNotTauriError } = await import('./platform');
    await expect(tauriHandle()).rejects.toBeInstanceOf(PlatformNotTauriError);
    await expect(tauriHandle()).rejects.toMatchObject({ code: 'PLATFORM_NOT_TAURI' });
  });
});
