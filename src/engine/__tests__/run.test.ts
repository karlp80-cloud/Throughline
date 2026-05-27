import { describe, expect, test } from 'vitest';
import { initialWorld, runUntilHalt } from '../run';
import { conveyor, makePuzzle, makeSolution } from './helpers';

describe('initialWorld', () => {
  test('places each agent at its startPos with empty hands and zeroed indices', () => {
    const puzzle = makePuzzle({
      agents: [
        { id: 'a', startPos: [3, 4] },
        { id: 'b', startPos: [0, 0] },
      ],
    });
    const w = initialWorld(puzzle);
    expect(w.agents['a']).toEqual({
      pos: [3, 4],
      pathIndex: 0,
      programIndex: 0,
      carrying: null,
    });
    expect(w.agents['b']).toEqual({
      pos: [0, 0],
      pathIndex: 0,
      programIndex: 0,
      carrying: null,
    });
    expect(w.cycle).toBe(0);
    expect(w.cumulativeEmissions).toBe(0);
    expect(w.nextCargoId).toBe(0);
  });

  test('starts with no cargo on tiles', () => {
    const w = initialWorld(makePuzzle());
    expect(w.cargoOnTiles).toEqual({});
  });
});

describe('runUntilHalt', () => {
  test('trivial solvable puzzle returns victory at the expected cycle', () => {
    const puzzle = makePuzzle({
      grid: { w: 2, h: 1 },
      inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 1 }],
      outputs: [{ pos: [1, 0], required: [{ type: 'alpha', count: 1 }] }],
      constraints: { maxTiles: 4, maxCycles: 10 },
    });
    const solution = makeSolution([conveyor([0, 0], 'E')]);
    const result = runUntilHalt(puzzle, solution);
    expect(result.status).toBe('victory');
    // Cycle 0: emit + conveyor + deliver in same cycle.
    expect(result.trace).toHaveLength(1);
  });

  test('mismatched-type output → cycle_limit_exceeded; trace has maxCycles entries', () => {
    const puzzle = makePuzzle({
      grid: { w: 3, h: 1 },
      inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 1 }],
      outputs: [{ pos: [2, 0], required: [{ type: 'beta', count: 1 }] }],
      constraints: { maxTiles: 4, maxCycles: 5 },
    });
    const solution = makeSolution();
    const result = runUntilHalt(puzzle, solution);
    expect(result.status).toBe('cycle_limit_exceeded');
    expect(result.trace).toHaveLength(5);
  });

  test('puzzle requiring multiple deliveries victories after enough cycles', () => {
    const puzzle = makePuzzle({
      grid: { w: 2, h: 1 },
      inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 1 }],
      outputs: [{ pos: [1, 0], required: [{ type: 'alpha', count: 3 }] }],
      constraints: { maxTiles: 4, maxCycles: 20 },
    });
    const solution = makeSolution([conveyor([0, 0], 'E')]);
    const result = runUntilHalt(puzzle, solution);
    expect(result.status).toBe('victory');
    // Each cycle delivers 1 alpha; need 3 cycles.
    expect(result.trace).toHaveLength(3);
  });

  test('every CycleTrace cycle counter matches its slot', () => {
    const puzzle = makePuzzle({
      grid: { w: 2, h: 1 },
      inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 1 }],
      outputs: [{ pos: [1, 0], required: [{ type: 'beta', count: 1 }] }],
      constraints: { maxTiles: 4, maxCycles: 4 },
    });
    const result = runUntilHalt(puzzle, makeSolution());
    expect(result.trace.map((t) => t.cycle)).toEqual([0, 1, 2, 3]);
  });
});
