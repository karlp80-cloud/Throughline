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
  fill: string,
  stroke?: string,
  facing?: Direction,
): void {
  ensureGlyphPaths();
  const path = glyphPaths!.get(key);
  if (!path) return;
  const { x, y } = cellOrigin(pos);
  ctx.save();
  ctx.translate(snap(x), snap(y));
  // Glyphs are 0..100 viewBox; scale to cell.
  ctx.scale(CELL_SIZE / 100, CELL_SIZE / 100);
  if (facing !== undefined) {
    // Rotate around cell center.
    ctx.translate(50, 50);
    rotateForDirection(ctx, facing);
    ctx.translate(-50, -50);
  }
  ctx.fillStyle = fill;
  if (stroke !== undefined) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
  }
  ctx.fill(path);
  if (stroke !== undefined) ctx.stroke(path);
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
    drawGlyphAt(
      ctx,
      tileKindToGlyph(tile.kind),
      tile.pos,
      paletteColor('fg'),
      undefined,
      tile.facing,
    );
  }
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

export function render(
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  puzzle: Puzzle,
  solution: Solution,
): void {
  drawBackground(ctx, puzzle);
  drawGridLines(ctx, puzzle);
  drawObstacles(ctx, puzzle);
  drawInputsAndOutputs(ctx, puzzle);
  drawTiles(ctx, solution.tiles);
  drawCargo(ctx, world, puzzle);
  drawAgents(ctx, world);
  // facingArrowPath is unused for now but reserved for an overlay
  // facing-direction indicator. Reference it so eslint doesn't complain.
  void facingArrowPath;
}
