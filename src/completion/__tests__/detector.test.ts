// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { conveyor, makePuzzle, makeSolution } from '../../engine/__tests__/helpers';
import { runUntilHalt } from '../../engine/run';
import { detectCompletion } from '../detector';

describe('detectCompletion: stats', () => {
  test('cycles == trace length', () => {
    const puzzle = makePuzzle({
      grid: { w: 2, h: 1 },
      inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 1 }],
      outputs: [{ pos: [1, 0], required: [{ type: 'alpha', count: 1 }] }],
    });
    const solution = makeSolution([conveyor([0, 0], 'E')]);
    const r = runUntilHalt(puzzle, solution);
    const result = detectCompletion(puzzle, solution, r.trace);
    expect(result.stats.cycles).toBe(r.trace.length);
  });

  test('tiles_used counts placed tiles', () => {
    const puzzle = makePuzzle();
    const solution = makeSolution([
      conveyor([0, 0], 'E'),
      conveyor([1, 0], 'E'),
      conveyor([2, 0], 'E'),
    ]);
    expect(detectCompletion(puzzle, solution, []).stats.tiles_used).toBe(3);
  });

  test('agent_count counts agent programs', () => {
    const puzzle = makePuzzle({
      agents: [
        { id: 'a1', startPos: [0, 0] },
        { id: 'a2', startPos: [1, 0] },
      ],
    });
    const solution = makeSolution(
      [],
      { a1: [[0, 0]], a2: [[1, 0]] },
      { a1: [{ kind: 'WAIT' }], a2: [{ kind: 'MOVE' }] },
    );
    expect(detectCompletion(puzzle, solution, []).stats.agent_count).toBe(2);
  });

  test('ops_total sums across agents (SENSE counts as 1)', () => {
    const puzzle = makePuzzle({
      agents: [
        { id: 'a', startPos: [0, 0], maxOps: 8 },
        { id: 'b', startPos: [1, 0], maxOps: 8 },
      ],
    });
    const solution = makeSolution(
      [],
      { a: [[0, 0]], b: [[1, 0]] },
      {
        a: [{ kind: 'GRAB' }, { kind: 'MOVE' }, { kind: 'DROP' }],
        b: [
          { kind: 'WAIT' },
          {
            kind: 'SENSE',
            expects: 'alpha',
            then: { kind: 'GRAB' },
            otherwise: { kind: 'WAIT' },
          },
        ],
      },
    );
    expect(detectCompletion(puzzle, solution, []).stats.ops_total).toBe(5);
  });
});

describe('detectCompletion: optional challenges', () => {
  test('a challenge that passes is marked passed=true', () => {
    const puzzle = makePuzzle({
      optionalChallenges: [{ id: 'opt_cycles', label: 'Solve in <40 cycles', rule: 'cycles < 40' }],
    });
    const fakeTrace = Array.from({ length: 10 }, (_, i) => ({
      cycle: i,
      emissions: [],
      agentEvents: [],
      collisions: [],
      deliveries: [],
      worldAfter: {
        cycle: i,
        cargoOnTiles: {},
        agents: {},
        tileState: {},
        deliveredCounts: {},
        cumulativeEmissions: 0,
        cumulativeReactorConsumed: 0,
        cumulativeReactorProduced: 0,
        nextCargoId: 0,
      },
    }));
    const result = detectCompletion(puzzle, makeSolution(), fakeTrace);
    expect(result.optionals).toEqual([
      { id: 'opt_cycles', label: 'Solve in <40 cycles', passed: true },
    ]);
  });

  test('a challenge that fails is marked passed=false', () => {
    const puzzle = makePuzzle({
      optionalChallenges: [{ id: 'opt_tiles', label: 'Use ≤2 tiles', rule: 'tiles_used <= 2' }],
    });
    const solution = makeSolution([
      conveyor([0, 0], 'E'),
      conveyor([1, 0], 'E'),
      conveyor([2, 0], 'E'),
    ]);
    const result = detectCompletion(puzzle, solution, []);
    expect(result.optionals[0]?.passed).toBe(false);
  });

  test('a malformed rule produces passed=false rather than throwing', () => {
    // Phase 7's loader is supposed to reject these manifests; the
    // detector is defensive in case one slips through.
    const puzzle = makePuzzle({
      optionalChallenges: [{ id: 'bad', label: 'Broken', rule: 'not a real rule' }],
    });
    const result = detectCompletion(puzzle, makeSolution(), []);
    expect(result.optionals[0]?.passed).toBe(false);
  });

  test('no challenges → empty optionals array', () => {
    const result = detectCompletion(makePuzzle(), makeSolution(), []);
    expect(result.optionals).toEqual([]);
  });

  test('preserves challenge order from the puzzle', () => {
    const puzzle = makePuzzle({
      optionalChallenges: [
        { id: 'a', label: 'A', rule: 'cycles < 1000' },
        { id: 'b', label: 'B', rule: 'tiles_used < 1000' },
        { id: 'c', label: 'C', rule: 'agent_count < 1000' },
      ],
    });
    const result = detectCompletion(puzzle, makeSolution(), []);
    expect(result.optionals.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });
});
