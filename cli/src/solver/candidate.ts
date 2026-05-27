/**
 * Random candidate-solution generator for the solver's iterated-restart
 * search (architect §6.2 / §6.4).
 *
 * The generator's job is to produce *plausible* Solution objects with
 * a connectivity bias (most random placements would never connect an
 * input to an output). It does NOT try to be smart — that's what the
 * iteration in solver/index.ts is for.
 *
 * All randomness flows through the injected PRNG. Math.random is
 * never called.
 */

import type {
  Direction,
  Op,
  PlacedTile,
  Pos,
  Puzzle,
  ReactorRecipe,
  Solution,
  TileKind,
  ThenOp,
  AgentId,
} from '../../../src/engine';
import type { PRNG } from './prng';

const DIRECTIONS: readonly Direction[] = ['N', 'E', 'S', 'W'];
const NON_SENSE_OPS: readonly ThenOp['kind'][] = ['MOVE', 'GRAB', 'DROP', 'WAIT'];

function posKey(p: Pos): string {
  return `${p[0]},${p[1]}`;
}

/** Cells that no tile may occupy: inputs, outputs, obstacles, agent starts. */
function forbiddenCells(puzzle: Puzzle): Set<string> {
  const s = new Set<string>();
  for (const i of puzzle.inputs) s.add(posKey(i.pos));
  for (const o of puzzle.outputs) s.add(posKey(o.pos));
  for (const ob of puzzle.obstacles) s.add(posKey(ob));
  for (const a of puzzle.agents) s.add(posKey(a.startPos));
  return s;
}

/** Manhattan-path cells from `from` to `to`, x-first then y. Inclusive of endpoints. */
function manhattanPath(from: Pos, to: Pos): readonly Pos[] {
  const path: Pos[] = [];
  let [x, y] = from;
  while (x !== to[0]) {
    path.push([x, y]);
    x += x < to[0] ? 1 : -1;
  }
  while (y !== to[1]) {
    path.push([x, y]);
    y += y < to[1] ? 1 : -1;
  }
  path.push([x, y]);
  return path;
}

/** Direction from a cell to the next cell. Returns 'E' as a safe default for equal cells. */
function dirFromTo(from: Pos, to: Pos): Direction {
  if (to[0] > from[0]) return 'E';
  if (to[0] < from[0]) return 'W';
  if (to[1] > from[1]) return 'S';
  if (to[1] < from[1]) return 'N';
  return 'E';
}

function chooseTileKind(puzzle: Puzzle, prng: PRNG, bias: 'conveyor' | 'any'): TileKind {
  // Connectivity bias: prefer conveyors on the input→output lane.
  if (bias === 'conveyor' && puzzle.availableTiles.includes('conveyor')) return 'conveyor';
  return prng.pick(puzzle.availableTiles);
}

function tileExtras(
  kind: TileKind,
  puzzle: Puzzle,
  prng: PRNG,
): {
  filterType?: string;
  recipe?: ReactorRecipe;
} {
  if (kind === 'filter' && puzzle.filterTypes && puzzle.filterTypes.length > 0) {
    return { filterType: prng.pick(puzzle.filterTypes) };
  }
  if (kind === 'reactor' && puzzle.reactorRecipes && puzzle.reactorRecipes.length > 0) {
    const r = prng.pick(puzzle.reactorRecipes);
    return { recipe: { inputs: [...r.inputs].sort(), output: r.output } };
  }
  return {};
}

function placeOne(
  pos: Pos,
  kind: TileKind,
  facing: Direction,
  extras: { filterType?: string; recipe?: ReactorRecipe },
): PlacedTile {
  // Avoid emitting `filterType: undefined` / `recipe: undefined` keys
  // — that violates `exactOptionalPropertyTypes` in our shared tsconfig.
  return {
    pos,
    kind,
    facing,
    ...(extras.filterType !== undefined ? { filterType: extras.filterType } : {}),
    ...(extras.recipe !== undefined ? { recipe: extras.recipe } : {}),
  };
}

function generateAgentPath(
  startPos: Pos,
  grid: { readonly w: number; readonly h: number },
  prng: PRNG,
): readonly Pos[] {
  const maxLen = 2 * (grid.w + grid.h);
  const len = prng.nextInt(1, maxLen);
  const path: Pos[] = [startPos];
  let [cx, cy] = startPos;
  for (let i = 1; i < len; i++) {
    const dir = prng.pick(DIRECTIONS);
    let [nx, ny] = [cx, cy];
    if (dir === 'N') ny--;
    else if (dir === 'S') ny++;
    else if (dir === 'E') nx++;
    else if (dir === 'W') nx--;
    if (nx < 0 || ny < 0 || nx >= grid.w || ny >= grid.h) {
      // Bounce: stay in place for this step.
      path.push([cx, cy]);
    } else {
      cx = nx;
      cy = ny;
      path.push([cx, cy]);
    }
  }
  return path;
}

function generateAgentProgram(
  availableOps: readonly Op['kind'][],
  maxOps: number,
  prng: PRNG,
): readonly Op[] {
  const len = prng.nextInt(1, maxOps);
  const program: Op[] = [];
  // SENSE branches only sample non-SENSE leaves.
  const branchableOps = availableOps.filter((k) => k !== 'SENSE') as readonly ThenOp['kind'][];
  const usableBranchable = branchableOps.length > 0 ? branchableOps : NON_SENSE_OPS;
  for (let i = 0; i < len; i++) {
    const kind = prng.pick(availableOps);
    if (kind === 'SENSE') {
      const expects = 'alpha';
      const thenK = prng.pick(usableBranchable);
      const otherK = prng.pick(usableBranchable);
      program.push({
        kind: 'SENSE',
        expects,
        then: { kind: thenK } as ThenOp,
        otherwise: { kind: otherK } as ThenOp,
      });
    } else {
      program.push({ kind } as Op);
    }
  }
  return program;
}

/** Top-level entry: produce a Solution for `puzzle` using `prng`. */
export function generateRandomSolution(puzzle: Puzzle, prng: PRNG): Solution {
  const forbidden = forbiddenCells(puzzle);
  const placed = new Set<string>(); // tile positions chosen so far
  const tiles: PlacedTile[] = [];

  // Phase 1: connectivity-biased Manhattan paths from each input to its
  // nearest output. With ~70% probability per cell, lay down a conveyor.
  for (const input of puzzle.inputs) {
    if (puzzle.outputs.length === 0) break;
    // Closest output by Manhattan distance.
    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < puzzle.outputs.length; i++) {
      const o = puzzle.outputs[i]!;
      const d = Math.abs(o.pos[0] - input.pos[0]) + Math.abs(o.pos[1] - input.pos[1]);
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = i;
      }
    }
    const target = puzzle.outputs[nearestIdx]!.pos;
    const path = manhattanPath(input.pos, target);
    // Skip the input cell itself (path[0]) and the output cell (path[last]).
    for (let i = 1; i < path.length - 1; i++) {
      if (tiles.length >= puzzle.constraints.maxTiles) break;
      const cell = path[i]!;
      const key = posKey(cell);
      if (forbidden.has(key) || placed.has(key)) continue;
      if (prng.nextFloat() < 0.7) {
        const next = path[i + 1] ?? cell;
        const facing = dirFromTo(cell, next);
        const kind = chooseTileKind(puzzle, prng, 'conveyor');
        const extras = tileExtras(kind, puzzle, prng);
        tiles.push(placeOne(cell, kind, facing, extras));
        placed.add(key);
      }
    }
  }

  // Phase 2: sprinkle remaining tiles randomly to fill out the budget.
  const remainingBudget = puzzle.constraints.maxTiles - tiles.length;
  const additional = remainingBudget > 0 ? prng.nextInt(0, remainingBudget) : 0;
  let placedCount = 0;
  let safety = 0;
  while (placedCount < additional && safety < 200) {
    safety++;
    const x = prng.nextInt(0, puzzle.grid.w - 1);
    const y = prng.nextInt(0, puzzle.grid.h - 1);
    const pos: Pos = [x, y];
    const key = posKey(pos);
    if (forbidden.has(key) || placed.has(key)) continue;
    const kind = chooseTileKind(puzzle, prng, 'any');
    const facing = prng.pick(DIRECTIONS);
    const extras = tileExtras(kind, puzzle, prng);
    tiles.push(placeOne(pos, kind, facing, extras));
    placed.add(key);
    placedCount++;
  }

  // Phase 3: agent paths and programs.
  const paths: Record<AgentId, readonly Pos[]> = {};
  const programs: Record<AgentId, readonly Op[]> = {};
  for (const a of puzzle.agents) {
    paths[a.id] = generateAgentPath(a.startPos, puzzle.grid, prng);
    programs[a.id] = generateAgentProgram(puzzle.availableOps, a.maxOps, prng);
  }

  return { tiles, paths, programs };
}
