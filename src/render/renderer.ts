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
  CargoInstance,
  CycleTrace,
  Direction,
  PlacedTile,
  Pos,
  PosKey,
  Puzzle,
  Solution,
  WorldState,
} from '../engine/types';
import { fromPosKey } from '../engine/types';
import { GLYPHS, type GlyphKey } from './glyphs';
import { paletteColor } from './palette';

/** Pixel size of one grid cell. Constant for Phase 2. */
export const CELL_SIZE = 48;

// Precomputed Path2D per glyph, lazily built on first render in a
// browser/jsdom context (Path2D isn't available in plain Node).
let glyphPaths: Map<GlyphKey, Path2D> | null = null;

function ensureGlyphPaths(): void {
  if (glyphPaths !== null) return;
  glyphPaths = new Map();
  for (const [key, d] of Object.entries(GLYPHS) as [GlyphKey, string][]) {
    glyphPaths.set(key, new Path2D(d));
  }
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

/**
 * Tiles whose base glyph is rotation-symmetric (no inherent visual
 * facing). The renderer overlays a `facing_arrow` glyph for these so
 * the player can tell which way they point.
 */
const ROTATION_SYMMETRIC_TILES = new Set<PlacedTile['kind']>(['filter', 'reactor']);

function drawTiles(ctx: CanvasRenderingContext2D, tiles: readonly PlacedTile[]): void {
  for (const tile of tiles) {
    drawGlyphAt(ctx, tileKindToGlyph(tile.kind), tile.pos, paletteColor('fg'), tile.facing);
    if (ROTATION_SYMMETRIC_TILES.has(tile.kind)) {
      drawGlyphAt(ctx, 'facing_arrow', tile.pos, paletteColor('accent'), tile.facing);
    }
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

function drawCargo(
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  puzzle: Puzzle,
  nextWorld?: WorldState,
  alpha?: number,
  trace?: CycleTrace,
): void {
  // No interpolation requested → discrete render.
  if (!nextWorld || !alpha || alpha <= 0) {
    for (let y = 0; y < puzzle.grid.h; y++) {
      for (let x = 0; x < puzzle.grid.w; x++) {
        const here = world.cargoOnTiles[`${x},${y}`];
        if (!here || here.length === 0) continue;
        drawCargoCluster(ctx, [x, y], here);
      }
    }
    return;
  }
  drawCargoInterpolated(ctx, world, nextWorld, alpha, trace);
}

function indexCargoById(
  cargoOnTiles: Readonly<Record<PosKey, readonly CargoInstance[]>>,
): Map<number, { cargo: CargoInstance; pos: Pos }> {
  const out = new Map<number, { cargo: CargoInstance; pos: Pos }>();
  for (const [key, list] of Object.entries(cargoOnTiles)) {
    const pos = fromPosKey(key as PosKey);
    for (const c of list) out.set(c.id, { cargo: c, pos });
  }
  return out;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function drawCargoInterpolated(
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  nextWorld: WorldState,
  alpha: number,
  trace?: CycleTrace,
): void {
  const fromBy = indexCargoById(world.cargoOnTiles);
  const toBy = indexCargoById(nextWorld.cargoOnTiles);

  // Source/dest hints from this cycle's events. Without these, new
  // cargo just fades in at its destination (which looks like it
  // teleports), and delivered cargo just fades out at its last seen
  // cell (which looks like it disappears short of the output).
  const emissionPos = new Map<number, Pos>();
  const deliveryPos = new Map<number, Pos>();
  if (trace) {
    for (const e of trace.emissions) emissionPos.set(e.cargo.id, e.inputPos);
    for (const d of trace.deliveries) deliveryPos.set(d.cargo.id, d.outputPos);
  }

  // Cargo present in `world` — lerp to next position, or animate
  // toward an output (delivery), or fade in place (reactor consume).
  for (const [id, { cargo, pos: fromPos }] of fromBy) {
    const to = toBy.get(id);
    if (to) {
      const gx = lerp(fromPos[0], to.pos[0], alpha);
      const gy = lerp(fromPos[1], to.pos[1], alpha);
      paintCargoAtCellFraction(ctx, gx, gy, cargo, 1);
      continue;
    }
    const out = deliveryPos.get(id);
    if (out) {
      // Slide from fromPos to the output cell; stay fully visible
      // until almost the end, then fade out over the last 20%.
      const gx = lerp(fromPos[0], out[0], alpha);
      const gy = lerp(fromPos[1], out[1], alpha);
      const op = alpha < 0.8 ? 1 : (1 - alpha) / 0.2;
      paintCargoAtCellFraction(ctx, gx, gy, cargo, op);
      continue;
    }
    // No delivery → consumed by a reactor. Fade out where it sat.
    paintCargoAtCellFraction(ctx, fromPos[0], fromPos[1], cargo, 1 - alpha);
  }

  // Cargo NEW in `nextWorld` — either emitted (slide from input cell)
  // or produced by a reactor (fade in at its destination).
  for (const [id, { cargo, pos }] of toBy) {
    if (fromBy.has(id)) continue;
    const inputPos = emissionPos.get(id);
    if (inputPos) {
      const gx = lerp(inputPos[0], pos[0], alpha);
      const gy = lerp(inputPos[1], pos[1], alpha);
      // Fade in over the first 20% so it eases into visibility
      // instead of popping in at the input cell.
      const op = alpha < 0.2 ? alpha / 0.2 : 1;
      paintCargoAtCellFraction(ctx, gx, gy, cargo, op);
      continue;
    }
    paintCargoAtCellFraction(ctx, pos[0], pos[1], cargo, alpha);
  }
}

function paintCargoAtCellFraction(
  ctx: CanvasRenderingContext2D,
  gx: number,
  gy: number,
  cargo: CargoInstance,
  opacity: number,
): void {
  const cx = gx * CELL_SIZE + CELL_SIZE / 2;
  const cy = gy * CELL_SIZE + CELL_SIZE / 2;
  ctx.save();
  ctx.globalAlpha = opacity;
  paintCargoDot(ctx, cx, cy, cargo);
  ctx.restore();
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

function drawAgents(
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  nextWorld?: WorldState,
  alpha?: number,
): void {
  ensureGlyphPaths();
  const ids = Object.keys(world.agents).sort();
  const useLerp = nextWorld !== undefined && alpha !== undefined && alpha > 0;
  for (const id of ids) {
    const agent = world.agents[id];
    if (!agent) continue;
    const nextAgent = useLerp ? nextWorld.agents[id] : undefined;
    if (useLerp && nextAgent) {
      const gx = lerp(agent.pos[0], nextAgent.pos[0], alpha);
      const gy = lerp(agent.pos[1], nextAgent.pos[1], alpha);
      drawAgentAt(ctx, gx, gy, agent.carrying ?? nextAgent.carrying ?? null);
    } else {
      drawAgentAt(ctx, agent.pos[0], agent.pos[1], agent.carrying);
    }
  }
}

function drawAgentAt(
  ctx: CanvasRenderingContext2D,
  gx: number,
  gy: number,
  carrying: CargoInstance | null,
): void {
  const x = gx * CELL_SIZE;
  const y = gy * CELL_SIZE;
  // Halo if carrying
  if (carrying !== null) {
    ctx.fillStyle = paletteColor('accent');
    ctx.beginPath();
    ctx.arc(x + CELL_SIZE / 2, y + CELL_SIZE / 2, 22, 0, Math.PI * 2);
    ctx.fill();
  }
  // Agent glyph — we draw at the lerped position via a save/translate
  // because drawGlyphAt expects an integer cell origin.
  ctx.save();
  ctx.translate(x, y);
  ensureGlyphPaths();
  const path = glyphPaths!.get('agent');
  if (path) {
    ctx.scale(CELL_SIZE / 100, CELL_SIZE / 100);
    ctx.fillStyle = paletteColor('fg');
    ctx.strokeStyle = paletteColor('fg');
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.fill(path);
    ctx.stroke(path);
  }
  ctx.restore();
  if (carrying !== null) {
    paintCargoDot(ctx, x + CELL_SIZE / 2, y + CELL_SIZE / 2, carrying);
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
  /**
   * Inter-cycle interpolation: world being interpolated TOWARD plus a
   * progress [0,1]. When set, cargo and agents are drawn at lerped
   * positions between `world` and `nextWorld`. Without these the
   * draws are discrete (cargo and agents snap to cell centers).
   */
  readonly nextWorld?: WorldState;
  readonly alpha?: number;
  /**
   * Events of the cycle being transitioned. Used to slide emitted
   * cargo from input cells and delivered cargo into output cells.
   * Omit for discrete renders or for animations where input/output
   * slides aren't needed.
   */
  readonly trace?: CycleTrace;
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
  drawCargo(ctx, world, puzzle, opts.nextWorld, opts.alpha, opts.trace);
  drawAgents(ctx, world, opts.nextWorld, opts.alpha);
  if (opts.preview) drawPreviewTile(ctx, opts.preview, puzzle, solution);
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

  drawGlyphAt(
    ctx,
    tileKindToGlyph(preview.tileKind),
    pos,
    paletteColor('fg'),
    preview.facing,
    0.35,
  );
  if (ROTATION_SYMMETRIC_TILES.has(preview.tileKind)) {
    drawGlyphAt(ctx, 'facing_arrow', pos, paletteColor('accent'), preview.facing, 0.35);
  }
}
