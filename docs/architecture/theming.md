# Theme Applicator (Phase 8)

> **Moderate cycle.** Reviewer checks: no un-substituted `{{tokens}}` can leak into UI; palette validation maintains a readability floor (cheap AA-contrast insurance even though A11y is deferred); narrative text is HTML-escaped before rendering.
> **Companion:** [throughline-design.md](../../throughline-design.md) §7; [IMPLEMENTATION_PLAN.md § Phase 8](../../IMPLEMENTATION_PLAN.md).

This memo pins the glyph-library contract, palette-application path, vocabulary substitution rules, contrast validation, and audio-coupling hook for Phase 8 — **before** code.

## 1. Public surface

```ts
// src/theme/index.ts

export function applyTheme(theme: RawTheme, opts?: ApplyOptions): AppliedTheme;
export function substitute(template: string, vocab: Vocab): string;
export function contrastRatio(hex1: string, hex2: string): number;
export function validatePalette(p: Palette): PaletteValidation;

export interface AppliedTheme {
  readonly palette: Palette;             // possibly the safe fallback
  readonly vocab: Vocab;
  readonly resolvedGlyphs: Readonly<Record<GlyphKey, string>>;  // path-data per key
  readonly warnings: readonly string[];  // for debug surface; non-fatal
}
```

`applyTheme`:
1. Validates palette contrast against `DEFAULT_PALETTE` if anything fails the WCAG AA 4.5:1 floor.
2. Writes CSS custom properties on `document.documentElement` from the palette.
3. Rebuilds the renderer's `glyphPaths` Map using resolved variants from the glyph library.
4. Tells the audio controller (if injected) to switch to the theme's `progression_name`.
5. Returns the resolved state (used by tests + the harness for vocab lookups).

## 2. Glyph library contract

`src/render/glyphs/library.ts` exports:

```ts
export interface GlyphFamily {
  readonly id: string;             // 'alchemy' | 'forensics' | ...
  readonly displayName: string;
  /** Path-data per glyph_key. Missing keys fall back to the default family. */
  readonly variants: Readonly<Partial<Record<GlyphKey, string>>>;
}

export const GLYPH_FAMILIES: readonly GlyphFamily[];
export const DEFAULT_FAMILY_ID = 'default' as const;
```

Phase 8 ships ~50 glyph variants across 5 families:
- `default` — the minimal set already in `glyphs/index.ts` (current shapes); always complete (covers every key).
- `alchemy` — alembic, phial, homunculus, leyline, etc.
- `forensics` — evidence locker, suspect node, case file, etc.
- `scifi` — reactor inlet, fusion vessel, drone, etc.
- `mythic` — rune circle, sigil, oracle, etc.

The `default` family is **canonical and complete**. Other families may be partial; missing keys fall back to `default`.

Theme block's `glyphs: Record<glyph_key, variant_name>` references variant_names by family-qualified id, e.g. `"input": "alchemy.alembic"`. If the variant doesn't resolve, fall back to default-family for that key and emit a warning.

### `families.json` (Phase 10 reference)

`src/render/glyphs/families.json` is a flat catalog `[{family, key, variant}]` that the CLI's prompt builder reads — it gives the LLM the closed set of valid variant identifiers. Generated from `GLYPH_FAMILIES` at build time (or hand-maintained for Phase 8; auto-gen later).

## 3. Vocabulary substitution

```ts
function substitute(template: string, vocab: Vocab): string;
```

- Replaces every `{{key}}` (key is `[a-zA-Z_][a-zA-Z0-9_]*`) with `vocab[key]` if present.
- HTML-escapes every replacement value as defense-in-depth — even though all narrative-text rendering goes through `textContent`, the value could end up in attribute contexts in the future.
- **Missing key**: leave the placeholder `{{key}}` in place AND record it as a warning. The Playwright test asserts no leftover `{{...}}` tokens; if a template references a key the LLM didn't supply, that test fails.

Token grammar regex: `/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g`. No nested templates, no expressions, no conditionals.

## 4. Contrast

Pure functions in `contrast.ts`:

```ts
function relativeLuminance(r: number, g: number, b: number): number;
function contrastRatio(hex1: string, hex2: string): number;
function validatePalette(palette): { ok: boolean; failures: readonly string[] };
```

WCAG formula:
- `L = 0.2126·R' + 0.7152·G' + 0.0722·B'` where `X' = X/255 ≤ 0.03928 ? X'/12.92 : ((X'+0.055)/1.055)^2.4`
- Contrast = `(Llight + 0.05) / (Ldark + 0.05)`

Floor: **4.5:1** (WCAG AA for normal text). Failures checked:
- `fg` vs `bg`
- `fg` vs `surface`

Other pairs (accent, success, danger) are decorative and not floor-checked in v1 — they're used for icons and brief flashes, not body text.

If any check fails, `applyTheme` swaps the entire palette to `DEFAULT_PALETTE` and records a warning. **Never partial substitution** — half-applied palettes look broken.

## 5. CSS variable injection

Palette values map to CSS custom properties on `document.documentElement`:

```css
:root {
  --bg: #1a1820;
  --surface: #241f29;
  --fg: #e8d8b0;
  --muted: #7a6a55;
  --accent: #c87650;
  --success: #82c08a;
  --danger: #d06060;
}
```

Renderer reads these via the existing `paletteColor()` indirection (Phase 2). The applier just calls `documentElement.style.setProperty('--bg', value)` per key.

## 6. Audio coupling

When applying a theme:
- If `theme.progression_name` is set AND `PROGRESSIONS[name]` exists, the applier informs the audio controller (when provided).
- If a loop is currently playing, the controller restarts it with the new progression.

Implementation: AudioController gains `setProgressionByName(name)`. Internally stores the active progression; `startLoop` uses the current selection. Phase 6's controller used `DEFAULT_PROGRESSION` hardcoded; refactor to use a `currentProgression` field initialized to `DEFAULT_PROGRESSION`.

## 7. Where the applier is invoked

The campaign harness calls `applyTheme(campaign.theme, { audio })` once per campaign load. The vocab + warning surface is held on `window.__theme` so tests can inspect.

For Phase 7's existing two-act demo, the theme block already exists — applying it should be a no-op for the current default palette (it already matches the demo's palette). Phase 9's tutorial uses a deliberately generic palette.

## 8. Test plan

| File | What it covers |
|---|---|
| `contrast.test.ts` | Luminance + ratio for white/black/grey; perfect contrast = 21; sub-4.5 fails. |
| `vocabulary.test.ts` | Plain substitution; missing keys leave placeholder + warning; HTML escaping; multiple tokens; non-matching `{{}}` shapes ignored. |
| `applier.test.ts` | Palette CSS-var writes; good palette accepted; bad palette falls back; glyph resolution + warning on unknown variant; audio progression-name routing through an injected mock. |
| `e2e/theme.spec.ts` | Render the same default puzzle with 3 different theme blocks (default + alchemy + forensics); screenshot diff each; assert no `{{...}}` tokens in the rendered DOM via a regex sweep. |

## 9. What this phase does NOT do

- Theme editor UI (themes come from `campaign.json`).
- Per-cargo-type glyph variants (Phase 8 covers tiles/agent/input/output; cargo dots stay color-coded by `cargoColor(type)` from Phase 2).
- Animated theme transitions (snap-swap; if too jarring, polish later).
- Localization (English-only per design doc §12).
- Custom palettes from the UI.

## 10. Reviewer focus (verbatim from plan)

> Reviewer checks: no un-substituted `{{tokens}}` can leak into UI; palette validation maintains a readability floor (cheap AA-contrast insurance even though A11y is deferred); narrative text is HTML-escaped before rendering.

Operationalized for the reviewer:
- Token-leak regex runs over every screen (main menu, intro, hub, puzzle, results, outro, ending) — not just one.
- Contrast validation rejects a known-bad theme (a fixture) and falls back to the default.
- `substitute` HTML-escapes — verified by passing `<script>` as a vocab value and asserting the rendered DOM has `&lt;script&gt;`.
- No glyph uses `<foreignObject>`, `<script>`, or external references.
