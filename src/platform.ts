/**
 * Platform detection — the *only* file in `src/` allowed to know
 * Tauri exists. Everything else gates on `isTauri()` and routes
 * Tauri invocations through `tauriHandle()`.
 *
 * Why this discipline:
 *   - A static `import from '@tauri-apps/...'` in shared code would
 *     either fail in the browser bundle or pull in dead JS. The
 *     dynamic-import-inside-this-module pattern makes the platform
 *     branch obvious at read time and the static-analysis canary
 *     (src/__tests__/no-tauri-static-import.test.ts) enforces it.
 *   - Detection is memoized: the marker can't appear or disappear
 *     mid-page-load. Tests call `vi.resetModules()` to re-run the
 *     module body with fresh markers.
 *
 * Companion: docs/architecture/procgen-integration.md §2.
 */

export type Platform = 'tauri' | 'browser';

export class PlatformNotTauriError extends Error {
  readonly code = 'PLATFORM_NOT_TAURI' as const;
  constructor(msg = 'tauriHandle() called outside Tauri') {
    super(msg);
    this.name = 'PlatformNotTauriError';
  }
}

export interface TauriHandle {
  /** Wraps `@tauri-apps/api/core#invoke`. */
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  /** Wraps `@tauri-apps/api/event#listen`. Resolves to an unlisten function. */
  listen<T>(event: string, cb: (payload: T) => void): Promise<() => void>;
}

interface TauriWindow {
  __TAURI_INTERNALS__?: unknown;
  __TAURI__?: unknown;
}

let cachedPlatform: Platform | null = null;
let cachedHandle: TauriHandle | null = null;

/**
 * Synchronous, memoized platform detection. Safe to call at module
 * load time even in environments where `window` is undefined (e.g.
 * SSR, vitest's `node` env).
 */
export function detectPlatform(): Platform {
  if (cachedPlatform !== null) return cachedPlatform;
  if (typeof window === 'undefined') {
    cachedPlatform = 'browser';
    return cachedPlatform;
  }
  const w = window as Window & TauriWindow;
  if (w.__TAURI_INTERNALS__ !== undefined) {
    cachedPlatform = 'tauri';
    return cachedPlatform;
  }
  if (w.__TAURI__ !== undefined) {
    cachedPlatform = 'tauri';
    return cachedPlatform;
  }
  cachedPlatform = 'browser';
  return cachedPlatform;
}

export function isTauri(): boolean {
  return detectPlatform() === 'tauri';
}

/**
 * Returns a thin, typed handle for the Tauri IPC surface. Throws
 * `PlatformNotTauriError` if called outside a Tauri webview. The
 * dynamic import is deferred to first call so the browser bundle
 * never even tries to resolve `@tauri-apps/api/*`.
 *
 * The handle is memoized after the first successful call — repeated
 * invocations return the same object.
 */
export async function tauriHandle(): Promise<TauriHandle> {
  if (!isTauri()) {
    throw new PlatformNotTauriError();
  }
  if (cachedHandle !== null) return cachedHandle;
  // Dynamic import: only resolved when we know we're inside Tauri.
  const core = await import('@tauri-apps/api/core');
  const event = await import('@tauri-apps/api/event');
  cachedHandle = {
    invoke: <T>(cmd: string, args?: Record<string, unknown>): Promise<T> =>
      core.invoke<T>(cmd, args),
    listen: async <T>(name: string, cb: (payload: T) => void): Promise<() => void> => {
      const un = await event.listen<T>(name, (e) => cb(e.payload));
      return un;
    },
  };
  return cachedHandle;
}
