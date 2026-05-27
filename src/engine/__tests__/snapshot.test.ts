/**
 * Snapshot tests: given a hand-built (puzzle, solution) pair, the
 * engine produces a deterministic CycleTrace[]. Any change to the
 * cycle pipeline, tile/op semantics, or determinism rule that alters
 * a trace shape will fail one of these.
 *
 * Snapshots live in `__snapshots__/snapshot.test.ts.snap` (managed
 * by Vitest). Update intentionally with `vitest -u`.
 */
import { describe, expect, test } from 'vitest';
import { runUntilHalt } from '../run';
import { conveyor, filter, makePuzzle, makeSolution, reactor, splitter } from './helpers';

describe('snapshot scenarios', () => {
  test('S1: conveyor line — input → 2 conveyors → output', () => {
    const puzzle = makePuzzle({
      id: 'S1',
      grid: { w: 4, h: 1 },
      inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 1 }],
      outputs: [{ pos: [3, 0], required: [{ type: 'alpha', count: 2 }] }],
      constraints: { maxTiles: 4, maxCycles: 20 },
    });
    const solution = makeSolution([
      conveyor([0, 0], 'E'),
      conveyor([1, 0], 'E'),
      conveyor([2, 0], 'E'),
    ]);
    const result = runUntilHalt(puzzle, solution);
    expect({
      status: result.status,
      traceLen: result.trace.length,
      trace: result.trace,
    }).toMatchSnapshot();
  });

  test('S2: splitter feeds two outputs', () => {
    const puzzle = makePuzzle({
      id: 'S2',
      grid: { w: 3, h: 3 },
      inputs: [{ pos: [0, 1], emits: ['alpha'], rate: 1 }],
      outputs: [
        { pos: [1, 0], required: [{ type: 'alpha', count: 2 }] },
        { pos: [1, 2], required: [{ type: 'alpha', count: 2 }] },
      ],
      constraints: { maxTiles: 4, maxCycles: 30 },
    });
    const solution = makeSolution([conveyor([0, 1], 'E'), splitter([1, 1], 'E')]);
    const result = runUntilHalt(puzzle, solution);
    expect({
      status: result.status,
      traceLen: result.trace.length,
      trace: result.trace,
    }).toMatchSnapshot();
  });

  test('S3: filter passes alphas only; betas pile up at filter cell', () => {
    const puzzle = makePuzzle({
      id: 'S3',
      grid: { w: 4, h: 1 },
      inputs: [{ pos: [0, 0], emits: ['alpha', 'beta'], rate: 1 }],
      outputs: [{ pos: [3, 0], required: [{ type: 'alpha', count: 2 }] }],
      constraints: { maxTiles: 4, maxCycles: 20 },
    });
    const solution = makeSolution([
      conveyor([0, 0], 'E'),
      filter([1, 0], 'E', 'alpha'),
      conveyor([2, 0], 'E'),
    ]);
    const result = runUntilHalt(puzzle, solution);
    expect({
      status: result.status,
      traceLen: result.trace.length,
      trace: result.trace,
    }).toMatchSnapshot();
  });

  test('S4: single agent grabs from input, walks, drops on output', () => {
    const puzzle = makePuzzle({
      id: 'S4',
      grid: { w: 3, h: 1 },
      inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 2 }],
      outputs: [{ pos: [2, 0], required: [{ type: 'alpha', count: 1 }] }],
      agents: [{ id: 'a1', startPos: [0, 0], maxOps: 8 }],
      constraints: { maxTiles: 0, maxCycles: 20 },
    });
    const solution = makeSolution(
      [],
      {
        a1: [
          [0, 0],
          [1, 0],
          [2, 0],
        ],
      },
      {
        a1: [
          { kind: 'GRAB' },
          { kind: 'MOVE' },
          { kind: 'MOVE' },
          { kind: 'DROP' },
          { kind: 'MOVE' },
          { kind: 'MOVE' },
        ],
      },
    );
    const result = runUntilHalt(puzzle, solution);
    expect({
      status: result.status,
      traceLen: result.trace.length,
      trace: result.trace,
    }).toMatchSnapshot();
  });

  test('S5: reactor combines two streams into one', () => {
    const puzzle = makePuzzle({
      id: 'S5',
      grid: { w: 5, h: 3 },
      inputs: [
        { pos: [0, 0], emits: ['a'], rate: 1 },
        { pos: [0, 2], emits: ['b'], rate: 1 },
      ],
      outputs: [{ pos: [4, 1], required: [{ type: 'c', count: 2 }] }],
      constraints: { maxTiles: 12, maxCycles: 30 },
    });
    const solution = makeSolution([
      conveyor([0, 0], 'E'),
      conveyor([1, 0], 'S'),
      conveyor([0, 2], 'E'),
      conveyor([1, 2], 'N'),
      reactor([1, 1], 'E', { inputs: ['a', 'b'], output: 'c' }),
      conveyor([2, 1], 'E'),
      conveyor([3, 1], 'E'),
    ]);
    const result = runUntilHalt(puzzle, solution);
    expect({
      status: result.status,
      traceLen: result.trace.length,
      trace: result.trace,
    }).toMatchSnapshot();
  });
});
