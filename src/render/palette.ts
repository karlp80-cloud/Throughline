/**
 * Palette indirection.
 *
 * Reads CSS custom properties from `document.documentElement` and
 * caches them. Phase 8's theme applier calls `clearPaletteCache()`
 * when a new theme is set.
 *
 * Defaults live here so the renderer boots before any theme is
 * applied. Defaults intentionally produce a usable monochrome with
 * one accent — every theme will override these.
 */

export type PaletteToken = 'bg' | 'surface' | 'fg' | 'muted' | 'accent' | 'success' | 'danger';

const DEFAULTS: Readonly<Record<PaletteToken, string>> = {
  bg: '#1a1820',
  surface: '#241f29',
  fg: '#e8d8b0',
  muted: '#7a6a55',
  accent: '#c87650',
  success: '#82c08a',
  danger: '#d06060',
};

let cache: Map<PaletteToken, string> | null = null;

export function paletteColor(token: PaletteToken): string {
  if (cache === null) cache = new Map();
  let v = cache.get(token);
  if (v !== undefined) return v;
  v = readCssVar(token) ?? DEFAULTS[token];
  cache.set(token, v);
  return v;
}

export function clearPaletteCache(): void {
  cache = null;
}

function readCssVar(token: PaletteToken): string | null {
  if (typeof document === 'undefined') return null;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--${token}`).trim();
  return raw.length > 0 ? raw : null;
}
