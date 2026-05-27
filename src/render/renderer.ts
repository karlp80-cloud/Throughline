/**
 * Canvas renderer.
 *
 * Pure function `render(ctx, world, puzzle, solution)` that paints
 * the current world onto a 2D context. Reads palette colors via the
 * `paletteColor` indirection; resolves glyph paths from the glyph
 * library. No mutation, no state.
 *
 * See docs/architecture/renderer.md for the layering and the design.
 */

import type {
  AgentState,
  CargoInstance,
  Direction,
  PlacedTile,
  Pos,
  Puzzle,
  Solution,
  WorldState,
} from '../engine/types';
import { FACING_ARROW, GLYPHS, type GlyphKey } from './glyphs';
import { paletteColor } from './palette';

/** Pixel size of one grid cell. Constant for Phase 2. */
export const CELL_SIZE = 48;

// Precomputed Path2D per glyph, lazily built on first render in a
// browser/jsdom context (Path2D isn't available in plain Node).
let glyphPaths: Map<GlyphKey, Path2D> | null = null;
let facingArrowPath: Path2D | null = null;

function ensureGlyphPaths(): void {
  if (glyphPaths !== null) return;
  glyphPaths = new Map();
  for (const [key, d] of Object.entries(GLYPHS) as [GlyphKey, string][]) {
    glyphPaths.set(key, new Path2D(d));
  }
  facingArrowPath = new Path2D(FACING_ARROW);
}

export function canvasSizeFor(puzzle: Puzzle): { width: number; height: number } {
  return {
    width: puzzle.grid.w * CELL_SIZE,
    height: puzzle.grid.h * CELL_SIZE,
  };
}

/** Snap a number to its integer floor — kills half-pixel anti-aliasing. */
const snap = (n: number): number => n | 0;

/** Cell origin in canvas coords (top-left corner of the cell). */
function cellOrigin(p: Pos): { x: number; y: number } {
  return { x: p[0] * CELL_SIZE, y: p[1] * CELL_SIZE };
}

/** Apply ctx.rotate for a direction. Glyphs are designed at 0° = East. */
function rotateForDirection(ctx: CanvasRenderingContext2D, dir: Direction): void {
  // Canvas y grows down; rotate clockwise. East = 0, S = π/2, W = π, N = 3π/2.
  let angle = 0;
  if (dir === 'S') angle = Math.PI / 2;
  else if (dir === 'W') angle = Math.PI;
  else if (dir === 'N') angle = (3 * Math.PI) / 2;
  ctx.rotate(angle);
}

/** Map any string to a deterministic hue in [0, 360). */
function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  // Force unsigned, then mod.
  return ((h % 360) + 360) % 360;
}

function cargoColor(type: string): string {
  return `hsl(${hashHue(type)}, 65%, 60%)`;
}

// ─── Layer functions ───────────────────────────────────────────────

function drawBackground(ctx: CanvasRenderingContext2D, puzzle: Puzzle): void {
  const { width, height } = canvasSizeFor(puzzle);
  ctx.fillStyle = paletteColor('bg');
  ctx.fillRect(0, 0, width, height);
}

function drawGridLines(ctx: CanvasRenderingContext2D, puzzle: Puzzle): void {
  ctx.strokeStyle = paletteColor('muted');
  ctx.lineWidth = 1;
  const { width, height } = canvasSizeFor(puzzle);
  ctx.beginPath();
  for (let x = 0; x <= puzzle.grid.w; x++) {
    const px = snap(x * CELL_SIZE) + 0.5;
    ctx.moveTo(px, 0);
    ctx.lineTo(px, height);
  }
  for (let y = 0; y <= puzzle.grid.h; y++) {
    const py = snap(y * CELL_SIZE) + 0.5;
    ctx.moveTo(0, py);
    ctx.lineTo(width, py);
  }
  ctx.stroke();
}

function drawObstacles(ctx: CanvasRenderingContext2D, puzzle: Puzzle): void {
  ctx.fillStyle = paletteColor('muted');
  for (const obs of puzzle.obstacles) {
    const { x, y } = cellOrigin(obs);
    ctx.fillRect(snap(x + 4), snap(y + 4), CELL_SIZE - 8, CELL_SIZE - 8);
  }
}

function drawGlyphAt(
  ctx: CanvasRenderingContext2D,
  key: GlyphKey,
  pos: Pos,
  color: string,
  facing?: Direction,
  alpha: number = 1,
): void {
  ensureGlyphPaths();
  const path = glyphPaths!.get(key);
  if (!path) return;
  const { x, y } = cellOrigin(pos);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(snap(x), snap(y));
  // Glyphs are 0..100 viewBox; scale to cell.
  ctx.scale(CELL_SIZE / 100, CELL_SIZE / 100);
  if (facing !== undefined) {
    // Rotate around cell center.
    ctx.translate(50, 50);
    rotateForDirection(ctx, facing);
    ctx.translate(-50, -50);
  }
  // Always BOTH fill and stroke with `color`. Closed-shape glyphs
  // (filter hourglass, reactor hexagon, output square) read as filled
  // forms; stroke-only glyphs (splitter Y, merger ⋊, conveyor arrow)
  // become visible from the stroke. lineWidth is in glyph-space
  // coordinates (viewBox is 0..100), so 4 units ≈ 2 px at CELL_SIZE 48.
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.fill(path);
  ctx.stroke(path);
  ctx.restore();
}

function drawInputsAndOutputs(ctx: CanvasRenderingContext2D, puzzle: Puzzle): void {
  for (const input of puzzle.inputs) {
    drawGlyphAt(ctx, 'input', input.pos, paletteColor('accent'));
  }
  for (const output of puzzle.outputs) {
    drawGlyphAt(ctx, 'output', output.pos, paletteColor('success'));
  }
}

function tileKindToGlyph(kind: PlacedTile['kind']): GlyphKey {
  switch (kind) {
    case 'conveyor':
      return 'tile_conveyor';
    case 'splitter':
      return 'tile_splitter';
    case 'merger':
      return 'tile_merger';
    case 'filter':
      return 'tile_filter';
    case 'reactor':
      return 'tile_reactor';
  }
}

function drawTiles(ctx: CanvasRenderingContext2D, tiles: readonly PlacedTile[]): void {
  for (const tile of tiles) {
    drawGlyphAt(ctx, tileKindToGlyph(tile.kind), tile.pos, paletteColor('fg'), tile.facing);
  }
}

function drawPaths(
  ctx: CanvasRenderingContext2D,
  paths: Readonly<Record<string, readonly Pos[]>>,
): void {
  ctx.save();
  ctx.strokeStyle = paletteColor('accent');
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const id of Object.keys(paths).sort()) {
    const path = paths[id];
    if (!path || path.length === 0) continue;
    ctx.beginPath();
    const head = path[0]!;
    const start = cellOrigin(head);
    ctx.moveTo(snap(start.x + CELL_SIZE / 2), snap(start.y + CELL_SIZE / 2));
    for (let i = 1; i < path.length; i++) {
      const p = path[i]!;
      const c = cellOrigin(p);
      ctx.lineTo(snap(c.x + CELL_SIZE / 2), snap(c.y + CELL_SIZE / 2));
    }
    ctx.stroke();
    // Vertex markers
    ctx.fillStyle = paletteColor('accent');
    for (let i = 1; i < path.length; i++) {
      const p = path[i]!;
      const c = cellOrigin(p);
      ctx.beginPath();
      ctx.arc(snap(c.x + CELL_SIZE / 2), snap(c.y + CELL_SIZE / 2), 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawCargo(ctx: CanvasRenderingContext2D, world: WorldState, puzzle: Puzzle): void {
  for (let y = 0; y < puzzle.grid.h; y++) {
    for (let x = 0; x < puzzle.grid.w; x++) {
      const here = world.cargoOnTiles[`${x},${y}`];
      if (!here || here.length === 0) continue;
      drawCargoCluster(ctx, [x, y], here);
    }
  }
}

function drawCargoCluster(
  ctx: CanvasRenderingContext2D,
  pos: Pos,
  cargo: readonly CargoInstance[],
): void {
  const { x, y } = cellOrigin(pos);
  const cx = x + CELL_SIZE / 2;
  const cy = y + CELL_SIZE / 2;
  // Multiple cargo on a cell: pack into a small ring.
  const radius = 6;
  if (cargo.length === 1) {
    paintCargoDot(ctx, cx, cy, cargo[0]!);
    return;
  }
  const ringRadius = 12;
  for (let i = 0; i < cargo.length; i++) {
    const angle = (i / cargo.length) * Math.PI * 2;
    const px = cx + Math.cos(angle) * ringRadius;
    const py = cy + Math.sin(angle) * ringRadius;
    paintCargoDot(ctx, px, py, cargo[i]!);
  }
  void radius;
}

function paintCargoDot(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  cargo: CargoInstance,
): void {
  ctx.fillStyle = cargoColor(cargo.type);
  ctx.strokeStyle = paletteColor('bg');
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(snap(cx), snap(cy), 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawAgents(ctx: CanvasRenderingContext2D, world: WorldState): void {
  ensureGlyphPaths();
  // Iterate deterministically.
  const ids = Object.keys(world.agents).sort();
  for (const id of ids) {
    const agent = world.agents[id];
    if (!agent) continue;
    drawAgent(ctx, agent);
  }
}

function drawAgent(ctx: CanvasRenderingContext2D, agent: AgentState): void {
  const { x, y } = cellOrigin(agent.pos);
  // Halo if carrying something
  if (agent.carrying !== null) {
    ctx.fillStyle = paletteColor('accent');
    ctx.beginPath();
    ctx.arc(snap(x + CELL_SIZE / 2), snap(y + CELL_SIZE / 2), 22, 0, Math.PI * 2);
    ctx.fill();
  }
  drawGlyphAt(ctx, 'agent', agent.pos, paletteColor('fg'));
  // If carrying, draw a small cargo dot on the agent's center.
  if (agent.carrying !== null) {
    paintCargoDot(ctx, x + CELL_SIZE / 2, y + CELL_SIZE / 2, agent.carrying);
  }
}

// ─── Public API ───────────────────────────────────────────────────

export interface RenderOptions {
  /** Show agent paths as polylines. Defaults to true. */
  readonly showPaths?: boolean;
  /** A "ghost tile" preview (e.g. during placing-tile mode). */
  readonly preview?: {
    readonly pos: Pos;
    readonly tileKind: PlacedTile['kind'];
    readonly facing: Direction;
  };
}

export function render(
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  puzzle: Puzzle,
  solution: Solution,
  opts: RenderOptions = {},
): void {
  drawBackground(ctx, puzzle);
  drawGridLines(ctx, puzzle);
  drawObstacles(ctx, puzzle);
  drawInputsAndOutputs(ctx, puzzle);
  drawTiles(ctx, solution.tiles);
  if (opts.showPaths !== false) drawPaths(ctx, solution.paths);
  drawCargo(ctx, world, puzzle);
  drawAgents(ctx, world);
  if (opts.preview) drawPreviewTile(ctx, opts.preview, puzzle, solution);
  // facingArrowPath is reserved for a future facing overlay; reference
  // it so eslint doesn't complain about an unused-vars warning.
  void facingArrowPath;
}

function drawPreviewTile(
  ctx: CanvasRenderingContext2D,
  preview: NonNullable<RenderOptions['preview']>,
  puzzle: Puzzle,
  solution: Solution,
): void {
  // Hide preview on cells where placement would be rejected.
  const { pos } = preview;
  if (pos[0] < 0 || pos[0] >= puzzle.grid.w || pos[1] < 0 || pos[1] >= puzzle.grid.h) return;
  if (puzzle.obstacles.some((o) => o[0] === pos[0] && o[1] === pos[1])) return;
  if (puzzle.inputs.some((i) => i.pos[0] === pos[0] && i.pos[1] === pos[1])) return;
  if (puzzle.outputs.some((o) => o.pos[0] === pos[0] && o.pos[1] === pos[1])) return;
  // If a tile already occupies the cell, preview the REPLACEMENT (which
  // is the current behavior); skip the ghost so the existing tile is
  // still visible.
  if (solution.tiles.some((t) => t.pos[0] === pos[0] && t.pos[1] === pos[1])) return;

  drawGlyphAt(ctx, tileKindToGlyph(preview.tileKind), pos, paletteColor('fg'), preview.facing, 0.35);
}
