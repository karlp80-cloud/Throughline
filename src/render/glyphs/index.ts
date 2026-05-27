/**
 * Glyph library.
 *
 * Each glyph is an SVG path-data string normalized to a `[0,100] x
 * [0,100]` viewBox. The renderer creates Path2D objects from these
 * once at module load and reuses them for every draw.
 *
 * Phase 2 ships the minimum set needed for the renderer to draw
 * every entity type. Phase 8 expands to thematic families (~50 glyphs).
 *
 * Direction is the renderer's job — glyphs are designed in a
 * "neutral" orientation; `renderer.ts` applies `ctx.rotate()` when
 * a tile faces N/E/S/W. Glyphs that imply a direction (conveyor
 * arrow, filter funnel) are drawn pointing East at 0° rotation.
 */

export type GlyphKey =
  | 'input'
  | 'output'
  | 'agent'
  | 'tile_conveyor'
  | 'tile_splitter'
  | 'tile_merger'
  | 'tile_filter'
  | 'tile_reactor';

export const GLYPHS: Readonly<Record<GlyphKey, string>> = {
  // Input: rightward chevron (cargo flows OUT into the grid)
  input: 'M 30 25 L 30 75 L 75 50 Z',

  // Output: framed square (collection bin)
  output: 'M 20 20 H 80 V 80 H 20 Z M 35 35 H 65 V 65 H 35 Z',

  // Agent: head — circle with smaller inner circle (eye)
  agent: 'M 50 20 A 30 30 0 1 1 49.99 20 Z M 50 38 A 12 12 0 1 1 49.99 38 Z',

  // Conveyor: forward arrow (points East at 0° rotation)
  tile_conveyor: 'M 25 50 L 60 50 M 50 35 L 65 50 L 50 65',

  // Splitter: Y-shape (one in from west, two out to N and S)
  tile_splitter: 'M 25 50 L 50 50 M 50 50 L 75 25 M 50 50 L 75 75',

  // Merger: inverted Y (two in from N and S, one out east)
  tile_merger: 'M 25 25 L 50 50 M 25 75 L 50 50 M 50 50 L 75 50',

  // Filter: hourglass — wide at left, narrow middle, wide at right
  tile_filter: 'M 25 25 L 25 75 L 50 50 L 75 75 L 75 25 L 50 50 Z',

  // Reactor: hexagonal frame around a dot
  tile_reactor: 'M 50 18 L 78 34 L 78 66 L 50 82 L 22 66 L 22 34 Z M 50 42 A 8 8 0 1 1 49.99 42 Z',
};

// Direction indicator (small arrow at edge of cell, used as facing overlay)
export const FACING_ARROW = 'M 75 50 L 92 50 M 85 43 L 92 50 L 85 57';
