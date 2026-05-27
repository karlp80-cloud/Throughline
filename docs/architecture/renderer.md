# Renderer Architecture Notes (Phase 2)

> **Light cycle.** Short notes only; the manual visual review is the reviewer.
> **Companion:** [IMPLEMENTATION_PLAN.md § Phase 2](../../IMPLEMENTATION_PLAN.md).

## Pipeline

```ts
render(ctx: CanvasRenderingContext2D, world: WorldState, puzzle: Puzzle, solution: Solution): void
```

Pure function. Stateless. Called by an app shell — never by the engine, never on a `requestAnimationFrame` loop here (Phase 4 wires the animator).

## Layering, top of stack last

1. **Background** (single fill from `--bg`)
2. **Grid lines** (between cells, `--muted`)
3. **Obstacles** (filled rects, `--fg` or a darker shade)
4. **Inputs / outputs** (glyphs + a colored frame; `--accent` for inputs, `--success` border for outputs while unmet)
5. **Tiles** (player-placed; glyph per kind; arrow indicating facing)
6. **Cargo** (small filled circles colored by cargo type; cargo type → palette color via a tiny hash)
7. **Agents** (glyph + a halo if carrying)

Layers are separate functions in `renderer.ts`. Each reads from the world snapshot only — no internal mutation.

## Palette indirection

A `paletteColor(name)` function reads CSS custom properties from `document.documentElement`. Results are cached in module-local state to avoid `getComputedStyle` per draw (it's slow). Phase 8 calls `clearPaletteCache()` when a new theme is applied.

Required palette tokens (matches design doc §5 theme block):
- `--bg`, `--surface`, `--fg`, `--muted`, `--accent`, `--success`, `--danger`

Default fallback values live in `palette.ts` so the renderer can boot before a theme is loaded.

## Glyph library

`src/render/glyphs/index.ts` exports `GLYPHS: Record<string, string>` — a flat map from glyph key (e.g. `tile_conveyor`, `input`, `agent`) to an SVG path-data string normalized to a `[0,100] × [0,100]` viewBox. Renderer creates `Path2D` instances once at module load and reuses them.

For Phase 2 the glyph set is the minimum needed for screenshot tests:
- `input`, `output`, `agent`
- `tile_conveyor`, `tile_splitter`, `tile_merger`, `tile_filter`, `tile_reactor`
- `cargo` (generic dot — colored by type)

Phase 8 expands to ~50 glyphs across thematic families.

## Cell size + integer rounding

Constant `CELL_SIZE = 48` px per grid cell. `canvas.width = grid.w * CELL_SIZE`, `canvas.height = grid.h * CELL_SIZE`. All draw calls round coordinates to integers via `| 0` to avoid half-pixel anti-aliasing artifacts that would flake screenshot diffs.

## Cargo color from type

Cargo types are opaque strings from the puzzle DSL. The renderer hashes the type to a hue (`hashType(type) % 360`) and renders cargo as an HSL circle. This means different campaigns see different colors per type without needing the theme to specify them. Phase 8 may override per theme.

## Screenshot diff strategy

Playwright's `toHaveScreenshot()`. Tolerance set generous initially (`maxDiffPixelRatio: 0.01`) and tightened if not flaky. Reference PNGs committed to `e2e/render-refs/`.

**Cross-platform note:** Playwright stores per-OS baselines automatically (`name-linux.png`, `name-darwin.png`, `name-win32.png`). CI runs on Linux. The first CI run will generate the Linux baseline; the developer commits whatever local OS they run on. If platform aliasing becomes a flake source, we'll either add a render preprocessor or fix the canvas-pixel-snap rules — both later.

## What's NOT here

- Animation (Phase 4 — animator interpolates between trace frames)
- Editor interaction (Phase 3)
- Theme application (Phase 8 — uses our palette + glyph indirection)
- Audio (Phase 6)

This module is read-only: world state in, pixels out.
