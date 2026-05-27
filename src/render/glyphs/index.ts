/**
 * Glyph library.
 *
 * Each glyph is an SVG path-data string normalized to a `[0,100] x
 * [0,100]` viewBox. The renderer creates Path2D objects from these
 * once at module load and reuses them for every draw.
 *
 * All glyphs are designed at 0° = facing East. The renderer applies
 * `ctx.rotate()` around the cell center for N/S/W facing. To stay
 * legibly directional after rotation, each glyph is asymmetric on
 * the E-W axis — splitters have a marker at the input (W) side,
 * mergers have a marker at the output (E) side, and rotation-
 * invariant glyphs (filter, reactor) get a `facing_arrow` overlay
 * drawn by the renderer.
 *
 * Phase 2 ships the minimum set needed; Phase 8 expands to
 * thematic families (~50 glyphs).
 */

export type GlyphKey =
  | 'input'
  | 'output'
  | 'agent'
  | 'tile_conveyor'
  | 'tile_splitter'
  | 'tile_merger'
  | 'tile_filter'
  | 'tile_reactor'
  | 'facing_arrow';

export const GLYPHS: Readonly<Record<GlyphKey, string>> = {
  // Input: rightward chevron (cargo flows OUT into the grid)
  input: 'M 30 25 L 30 75 L 75 50 Z',

  // Output: framed square (collection bin)
  output: 'M 20 20 H 80 V 80 H 20 Z M 35 35 H 65 V 65 H 35 Z',

  // Agent: head — circle with smaller inner circle (eye)
  agent: 'M 50 20 A 30 30 0 1 1 49.99 20 Z M 50 38 A 12 12 0 1 1 49.99 38 Z',

  // Conveyor: forward arrow (already directional at 0°)
  tile_conveyor: 'M 25 50 L 60 50 M 50 35 L 65 50 L 50 65',

  // Splitter: T on its side (⊢) — input trunk from W, perpendicular
  // output bar N-S. Filled square at the W end MARKS the INPUT side.
  // The square is what visually distinguishes it from the merger.
  tile_splitter: 'M 50 20 L 50 80 M 18 50 L 50 50 M 8 44 L 18 44 L 18 56 L 8 56 Z',

  // Merger: T on its side mirrored (⊣) — perpendicular input bar N-S,
  // output trunk to E. Filled triangle (arrowhead) at the E end MARKS
  // the OUTPUT side, distinguishing it from the splitter.
  tile_merger: 'M 50 20 L 50 80 M 50 50 L 82 50 M 82 44 L 92 50 L 82 56 Z',

  // Filter: hourglass — narrow waist, wide ends. Rotation-symmetric
  // on E-W axis so the renderer adds a `facing_arrow` overlay.
  tile_filter: 'M 25 25 L 25 75 L 50 50 L 75 75 L 75 25 L 50 50 Z',

  // Reactor: hexagonal frame around a dot. Also rotation-symmetric;
  // gets a `facing_arrow` overlay from the renderer.
  tile_reactor: 'M 50 18 L 78 34 L 78 66 L 50 82 L 22 66 L 22 34 Z M 50 42 A 8 8 0 1 1 49.99 42 Z',

  // Small chevron at the E edge — used as a facing-direction overlay
  // for rotation-symmetric tile glyphs.
  facing_arrow: 'M 78 50 L 95 50 M 88 43 L 95 50 L 88 57',
};
