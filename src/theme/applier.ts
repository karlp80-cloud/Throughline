/**
 * Apply a theme: palette → CSS vars, resolved glyphs → renderer
 * overrides, vocab → exposed for the harness, optional audio
 * progression routing.
 *
 * On any failure (bad contrast, missing palette field), the applier
 * falls back to DEFAULT_PALETTE for the whole palette and records
 * a warning. Glyph variant misses fall back per-key (NOT whole
 * palette swap) — readability matters globally, glyph fidelity
 * doesn't.
 */

import type { AudioController } from '../audio';
import type { GlyphKey } from '../render/glyphs';
import { resolveGlyph } from '../render/glyphs/library';
import { setGlyphPathOverrides } from '../render/renderer';
import type { RawTheme } from '../schema/campaign';
import { validatePalette } from './contrast';
import type { Vocab } from './vocabulary';

export interface Palette {
  readonly bg: string;
  readonly surface: string;
  readonly fg: string;
  readonly muted: string;
  readonly accent: string;
  readonly success: string;
  readonly danger: string;
}

export const DEFAULT_PALETTE: Palette = {
  bg: '#1a1820',
  surface: '#241f29',
  fg: '#e8d8b0',
  muted: '#7a6a55',
  accent: '#c87650',
  success: '#82c08a',
  danger: '#d06060',
};

const GLYPH_KEYS: readonly GlyphKey[] = [
  'input',
  'output',
  'agent',
  'tile_conveyor',
  'tile_splitter',
  'tile_merger',
  'tile_filter',
  'tile_reactor',
  'facing_arrow',
];

export interface ApplyOptions {
  /** Audio controller; if present, the theme's progression is routed. */
  readonly audio?: AudioController;
  /**
   * DOM root to write CSS variables on. Defaults to
   * `document.documentElement` when a DOM is present; omit in pure
   * Node tests.
   */
  readonly target?: { style: { setProperty(prop: string, value: string): void } };
}

export interface AppliedTheme {
  readonly palette: Palette;
  readonly vocab: Vocab;
  readonly resolvedGlyphs: Readonly<Record<GlyphKey, string>>;
  readonly warnings: readonly string[];
}

export function applyTheme(theme: RawTheme, opts: ApplyOptions = {}): AppliedTheme {
  const warnings: string[] = [];

  // ─── Palette validation ────────────────────────────────────────
  const v = validatePalette(theme.palette);
  let palette = theme.palette;
  if (!v.ok) {
    warnings.push(`palette failed AA contrast: ${v.failures.join('; ')}. Using DEFAULT_PALETTE.`);
    palette = DEFAULT_PALETTE;
  }

  // ─── CSS variable injection ────────────────────────────────────
  const target =
    opts.target ?? (typeof document !== 'undefined' ? document.documentElement : undefined);
  if (target) {
    for (const [k, value] of Object.entries(palette)) {
      target.style.setProperty(`--${k}`, value);
    }
  }

  // ─── Glyph resolution ──────────────────────────────────────────
  const resolvedGlyphs = {} as Record<GlyphKey, string>;
  for (const key of GLYPH_KEYS) {
    const variantRef = theme.glyphs[key];
    resolvedGlyphs[key] = resolveGlyph(key, variantRef, warnings);
  }
  setGlyphPathOverrides(resolvedGlyphs);

  // ─── Audio progression routing ─────────────────────────────────
  if (opts.audio && theme.progression_name) {
    const ok = opts.audio.setProgressionByName(theme.progression_name);
    if (!ok) {
      warnings.push(
        `progression_name '${theme.progression_name}' unknown; using DEFAULT_PROGRESSION`,
      );
    }
  }

  return {
    palette,
    vocab: theme.vocabulary,
    resolvedGlyphs,
    warnings,
  };
}
