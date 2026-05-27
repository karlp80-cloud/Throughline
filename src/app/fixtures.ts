/**
 * Named scenarios used by the renderer's Playwright screenshot tests
 * and by the dev demo page. Each fixture provides a puzzle + a
 * (possibly partial) solution and an optional trace index — when
 * present, the renderer is shown the world AFTER that cycle ran.
 *
 * Fixtures intentionally cover different visual cases (empty grid,
 * a single tile, a full pre-run scene, a mid-run scene) so each
 * layer of the draw pipeline gets exercised by at least one test.
 */

import { runUntilHalt } from '../engine';
import type { Puzzle, Solution, WorldState } from '../engine';
import { initialWorld } from '../engine';
import {
  agentState,
  conveyor,
  filter,
  makePuzzle,
  makeSolution,
  reactor,
  splitter,
} from '../engine/__tests__/helpers';

export interface RenderFixture {
  readonly name: string;
  readonly puzzle: Puzzle;
  readonly solution: Solution;
  /**
   * Which world to render. `0` means the pre-run state (initialWorld).
   * Higher values run that many cycles first. If the puzzle wins
   * before reaching the requested index, the last cycle's world is used.
   */
  readonly cycleIndex: number;
}

export const FIXTURES: Readonly<Record<string, RenderFixture>> = {
  // 0. Editor default: a small puzzle that actually solves, so the
  // Run button produces a satisfying playthrough within a few cycles.
  // Used by `main.ts` for the default editor view and by playback e2e.
  editorDefault: {
    name: 'editor default — solvable',
    puzzle: makePuzzle({
      id: 'editorDefault',
      grid: { w: 5, h: 3 },
      inputs: [{ pos: [0, 1], emits: ['alpha'], rate: 1 }],
      outputs: [{ pos: [4, 1], required: [{ type: 'alpha', count: 3 }] }],
      agents: [{ id: 'a1', startPos: [2, 0] }],
      constraints: { maxTiles: 8, maxCycles: 30 },
    }),
    solution: makeSolution(
      [conveyor([0, 1], 'E'), conveyor([1, 1], 'E'), conveyor([2, 1], 'E'), conveyor([3, 1], 'E')],
      { a1: [[2, 0]] },
      { a1: [{ kind: 'WAIT' }] },
    ),
    cycleIndex: 0,
  },
  // 1. Empty 4x3 grid, no inputs/outputs/agents/tiles. Just background + grid.
  empty: {
    name: 'empty 4x3 grid',
    puzzle: makePuzzle({ id: 'F1-empty', grid: { w: 4, h: 3 } }),
    solution: makeSolution(),
    cycleIndex: 0,
  },

  // 2. Single tile (conveyor) on an otherwise empty 3x3 grid.
  singleTile: {
    name: 'one conveyor on 3x3',
    puzzle: makePuzzle({ id: 'F2-tile', grid: { w: 3, h: 3 } }),
    solution: makeSolution([conveyor([1, 1], 'E')]),
    cycleIndex: 0,
  },

  // 3. Full puzzle, pre-run — input, output, agent, mixed tiles.
  fullPreRun: {
    name: 'full puzzle pre-run',
    puzzle: makePuzzle({
      id: 'F3-pre',
      grid: { w: 6, h: 4 },
      inputs: [{ pos: [0, 1], emits: ['alpha'], rate: 2 }],
      outputs: [{ pos: [5, 2], required: [{ type: 'gamma', count: 3 }] }],
      obstacles: [[3, 0]],
      agents: [{ id: 'a1', startPos: [2, 3] }],
    }),
    solution: makeSolution(
      [
        conveyor([0, 1], 'E'),
        splitter([1, 1], 'E'),
        filter([2, 0], 'E', 'alpha'),
        reactor([2, 1], 'E', { inputs: ['alpha'], output: 'gamma' }),
        conveyor([3, 1], 'E'),
        conveyor([4, 1], 'S'),
        conveyor([4, 2], 'E'),
      ],
      { a1: [[2, 3]] },
      { a1: [{ kind: 'WAIT' }] },
    ),
    cycleIndex: 0,
  },

  // 4. Full puzzle, mid-run — cargo in motion + cargo on agents.
  fullMidRun: {
    name: 'full puzzle mid-run',
    puzzle: makePuzzle({
      id: 'F4-mid',
      grid: { w: 5, h: 2 },
      inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 1 }],
      outputs: [{ pos: [4, 0], required: [{ type: 'alpha', count: 10 }] }],
      agents: [{ id: 'b1', startPos: [2, 1] }],
    }),
    solution: makeSolution(
      [conveyor([0, 0], 'E'), conveyor([1, 0], 'E'), conveyor([2, 0], 'E'), conveyor([3, 0], 'E')],
      { b1: [[2, 1]] },
      { b1: [{ kind: 'WAIT' }] },
    ),
    cycleIndex: 3, // Three full cycles in.
  },
};

export function worldForFixture(f: RenderFixture): WorldState {
  if (f.cycleIndex === 0) return initialWorld(f.puzzle);
  const r = runUntilHalt(f.puzzle, f.solution);
  const wanted = r.trace[Math.min(f.cycleIndex - 1, r.trace.length - 1)];
  return wanted ? wanted.worldAfter : initialWorld(f.puzzle);
}

// Stub to keep agentState in the bundle so renderer-using devs can
// reference it without an extra import. Removed once Phase 3 lands
// the editor that brings AgentState helpers into the app proper.
void agentState;
