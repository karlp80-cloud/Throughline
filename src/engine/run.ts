/**
 * Engine entry: build an initial WorldState from a puzzle, then loop
 * `stepOnce` until the puzzle either reports victory or hits the
 * cycle limit.
 *
 * v1 halt set per memo §7 / Q3=a: { victory, cycle_limit_exceeded }.
 * Agent deadlock detection is deferred — the cycle limit covers it
 * for the Phase 10 solvability check.
 */

import { stepOnce } from './step';
import type {
  AgentId,
  AgentState,
  CycleTrace,
  Puzzle,
  RunResult,
  Solution,
  WorldState,
} from './types';

export function initialWorld(puzzle: Puzzle): WorldState {
  const agents: Record<AgentId, AgentState> = {};
  for (const a of puzzle.agents) {
    agents[a.id] = {
      pos: a.startPos,
      pathIndex: 0,
      programIndex: 0,
      carrying: null,
    };
  }
  return {
    cycle: 0,
    cargoOnTiles: {},
    agents,
    tileState: {},
    deliveredCounts: {},
    cumulativeEmissions: 0,
    cumulativeReactorConsumed: 0,
    cumulativeReactorProduced: 0,
    nextCargoId: 0,
  };
}

export function checkVictory(world: WorldState, puzzle: Puzzle): boolean {
  for (const out of puzzle.outputs) {
    for (const req of out.required) {
      if ((world.deliveredCounts[req.type] ?? 0) < req.count) return false;
    }
  }
  // A puzzle with no output requirements is trivially "won".
  // Schema validation in Phase 7 should reject this; engine is defensive.
  return true;
}

export function runUntilHalt(puzzle: Puzzle, solution: Solution): RunResult {
  const trace: CycleTrace[] = [];
  let world = initialWorld(puzzle);
  // Defensive: a puzzle that's already at victory state pre-cycle 0.
  if (checkVictory(world, puzzle) && puzzle.outputs.length > 0) {
    return { status: 'victory', trace };
  }
  const maxCycles = puzzle.constraints.maxCycles;
  while (world.cycle < maxCycles) {
    const next = stepOnce(puzzle, solution, world);
    trace.push(next.trace);
    world = next.world;
    if (checkVictory(world, puzzle)) {
      return { status: 'victory', trace };
    }
  }
  return { status: 'cycle_limit_exceeded', trace };
}
