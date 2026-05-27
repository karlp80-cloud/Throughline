import { describe, expect, test } from 'vitest';
import { stepOnce } from '../step';
import type { CargoInstance } from '../types';
import { posKey } from '../types';
import {
  agentState,
  cargo,
  cargoMap,
  conveyor,
  makePuzzle,
  makeSolution,
  makeWorld,
  reactor,
} from './helpers';

// ─── Phase 0: EMIT ─────────────────────────────────────────────────
describe('emission', () => {
  test('input with rate=1 emits at cycle 0 and auto-ejects east', () => {
    const puzzle = makePuzzle({
      grid: { w: 3, h: 1 },
      inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 1 }],
    });
    const { world, trace } = stepOnce(puzzle, makeSolution(), makeWorld());
    expect(trace.emissions).toEqual([{ inputPos: [0, 0], cargo: { id: 0, type: 'alpha' } }]);
    // Input auto-ejects: cargo ends up at the cell east of the input,
    // not at the input cell itself.
    expect(world.cargoOnTiles[posKey([0, 0])]).toBeUndefined();
    expect(world.cargoOnTiles[posKey([1, 0])]).toEqual([{ id: 0, type: 'alpha' }]);
    expect(world.cumulativeEmissions).toBe(1);
    expect(world.nextCargoId).toBe(1);
    expect(world.cycle).toBe(1);
  });

  test('input auto-eject respects the input.facing direction', () => {
    const puzzle = makePuzzle({
      grid: { w: 3, h: 3 },
      inputs: [{ pos: [1, 1], emits: ['alpha'], rate: 1, facing: 'S' }],
    });
    const { world } = stepOnce(puzzle, makeSolution(), makeWorld());
    expect(world.cargoOnTiles[posKey([1, 2])]).toEqual([{ id: 0, type: 'alpha' }]);
  });

  test('input auto-eject does NOT fire when an agent at the input grabs the cargo', () => {
    const puzzle = makePuzzle({
      grid: { w: 3, h: 1 },
      inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 1 }],
      agents: [{ id: 'a1', startPos: [0, 0] }],
    });
    const solution = makeSolution([], { a1: [[0, 0]] }, { a1: [{ kind: 'GRAB' }] });
    const world = makeWorld({ agents: { a1: agentState([0, 0]) } });
    const { world: w2 } = stepOnce(puzzle, solution, world);
    expect(w2.agents['a1']?.carrying).toEqual({ id: 0, type: 'alpha' });
    // Cargo grabbed by the agent — neither at input nor at neighbor.
    expect(w2.cargoOnTiles[posKey([0, 0])]).toBeUndefined();
    expect(w2.cargoOnTiles[posKey([1, 0])]).toBeUndefined();
  });

  test('input with rate=2 does NOT emit at cycle 1', () => {
    const puzzle = makePuzzle({
      grid: { w: 3, h: 1 },
      inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 2 }],
    });
    const { trace } = stepOnce(puzzle, makeSolution(), makeWorld({ cycle: 1 }));
    expect(trace.emissions).toEqual([]);
  });

  test('input with rate=2 emits at cycle 0 and cycle 2', () => {
    const puzzle = makePuzzle({
      grid: { w: 3, h: 1 },
      inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 2 }],
    });
    const c0 = stepOnce(puzzle, makeSolution(), makeWorld());
    expect(c0.trace.emissions).toHaveLength(1);
    const c1 = stepOnce(puzzle, makeSolution(), c0.world);
    expect(c1.trace.emissions).toEqual([]);
    const c2 = stepOnce(puzzle, makeSolution(), c1.world);
    expect(c2.trace.emissions).toHaveLength(1);
  });

  test('input rotates through its emits array (k-th emission)', () => {
    const puzzle = makePuzzle({
      grid: { w: 3, h: 1 },
      inputs: [{ pos: [0, 0], emits: ['a', 'b', 'c'], rate: 1 }],
    });
    let w = makeWorld();
    const types: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = stepOnce(puzzle, makeSolution(), w);
      types.push(r.trace.emissions[0]?.cargo.type ?? '');
      w = r.world;
    }
    expect(types).toEqual(['a', 'b', 'c', 'a', 'b']);
  });
});

// ─── Phase A: agents see Phase 0 emissions (Q1=yes) ────────────────
describe('phase A visibility', () => {
  test('an agent can GRAB cargo emitted at its cell in the same cycle', () => {
    const puzzle = makePuzzle({
      grid: { w: 3, h: 1 },
      inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 1 }],
      agents: [{ id: 'a1', startPos: [0, 0] }],
    });
    const solution = makeSolution([], { a1: [[0, 0]] }, { a1: [{ kind: 'GRAB' }] });
    const world = makeWorld({ agents: { a1: agentState([0, 0]) } });
    const { world: w2, trace } = stepOnce(puzzle, solution, world);
    // Cargo emitted, then grabbed by agent in the same cycle.
    expect(w2.agents['a1']?.carrying).toEqual({ id: 0, type: 'alpha' });
    expect(w2.cargoOnTiles[posKey([0, 0])] ?? []).toEqual([]);
    expect(trace.agentEvents).toEqual([
      { agent: 'a1', from: [0, 0], to: [0, 0], opExecuted: { kind: 'GRAB' } },
    ]);
  });
});

// ─── Agent movement & collisions ───────────────────────────────────
describe('agent movement', () => {
  test('agent with MOVE advances along its path', () => {
    const puzzle = makePuzzle({
      grid: { w: 3, h: 1 },
      agents: [{ id: 'a1', startPos: [0, 0] }],
    });
    const solution = makeSolution(
      [],
      {
        a1: [
          [0, 0],
          [1, 0],
        ],
      },
      { a1: [{ kind: 'MOVE' }] },
    );
    const world = makeWorld({ agents: { a1: agentState([0, 0]) } });
    const { world: w2 } = stepOnce(puzzle, solution, world);
    expect(w2.agents['a1']?.pos).toEqual([1, 0]);
    expect(w2.agents['a1']?.pathIndex).toBe(1);
  });

  test('two agents trying to swap cells are BOTH blocked', () => {
    const puzzle = makePuzzle({
      grid: { w: 3, h: 1 },
      agents: [
        { id: 'a', startPos: [0, 0] },
        { id: 'b', startPos: [1, 0] },
      ],
    });
    const solution = makeSolution(
      [],
      {
        a: [
          [0, 0],
          [1, 0],
        ],
        b: [
          [1, 0],
          [0, 0],
        ],
      },
      {
        a: [{ kind: 'MOVE' }],
        b: [{ kind: 'MOVE' }],
      },
    );
    const world = makeWorld({
      agents: { a: agentState([0, 0]), b: agentState([1, 0]) },
    });
    const { world: w2, trace } = stepOnce(puzzle, solution, world);
    expect(w2.agents['a']?.pos).toEqual([0, 0]);
    expect(w2.agents['b']?.pos).toEqual([1, 0]);
    // Path indices do NOT advance for blocked moves (memo §5 Phase B)
    expect(w2.agents['a']?.pathIndex).toBe(0);
    expect(w2.agents['b']?.pathIndex).toBe(0);
    expect(trace.collisions.length).toBeGreaterThan(0);
  });

  test('two agents targeting the same cell: lex-earlier wins; other blocked', () => {
    const puzzle = makePuzzle({
      grid: { w: 3, h: 3 },
      agents: [
        { id: 'a', startPos: [0, 0] },
        { id: 'b', startPos: [2, 0] },
      ],
    });
    const solution = makeSolution(
      [],
      {
        a: [
          [0, 0],
          [1, 0],
        ],
        b: [
          [2, 0],
          [1, 0],
        ],
      },
      {
        a: [{ kind: 'MOVE' }],
        b: [{ kind: 'MOVE' }],
      },
    );
    const world = makeWorld({
      agents: { a: agentState([0, 0]), b: agentState([2, 0]) },
    });
    const { world: w2, trace } = stepOnce(puzzle, solution, world);
    // 'a' < 'b' lexicographically → 'a' wins.
    expect(w2.agents['a']?.pos).toEqual([1, 0]);
    expect(w2.agents['b']?.pos).toEqual([2, 0]);
    const collision = trace.collisions.find((c) => c.pos[0] === 1 && c.pos[1] === 0);
    expect(collision?.winner).toBe('a');
    expect(collision?.blocked).toEqual(['b']);
  });

  test('agent moving onto an obstacle is blocked', () => {
    const puzzle = makePuzzle({
      grid: { w: 3, h: 1 },
      obstacles: [[1, 0]],
      agents: [{ id: 'a', startPos: [0, 0] }],
    });
    const solution = makeSolution(
      [],
      {
        a: [
          [0, 0],
          [1, 0],
        ],
      },
      { a: [{ kind: 'MOVE' }] },
    );
    const world = makeWorld({ agents: { a: agentState([0, 0]) } });
    const { world: w2 } = stepOnce(puzzle, solution, world);
    expect(w2.agents['a']?.pos).toEqual([0, 0]);
  });

  test('three-way race for one cell: lex-earliest wins; other two blocked', () => {
    const puzzle = makePuzzle({
      grid: { w: 3, h: 3 },
      agents: [
        { id: 'a', startPos: [0, 1] },
        { id: 'b', startPos: [1, 0] },
        { id: 'c', startPos: [2, 1] },
      ],
    });
    const solution = makeSolution(
      [],
      {
        a: [
          [0, 1],
          [1, 1],
        ],
        b: [
          [1, 0],
          [1, 1],
        ],
        c: [
          [2, 1],
          [1, 1],
        ],
      },
      {
        a: [{ kind: 'MOVE' }],
        b: [{ kind: 'MOVE' }],
        c: [{ kind: 'MOVE' }],
      },
    );
    const world = makeWorld({
      agents: {
        a: agentState([0, 1]),
        b: agentState([1, 0]),
        c: agentState([2, 1]),
      },
    });
    const { world: w2, trace } = stepOnce(puzzle, solution, world);
    expect(w2.agents['a']?.pos).toEqual([1, 1]); // 'a' < 'b' < 'c' → 'a' wins
    expect(w2.agents['b']?.pos).toEqual([1, 0]);
    expect(w2.agents['c']?.pos).toEqual([2, 1]);
    const coll = trace.collisions.find((cl) => cl.pos[0] === 1 && cl.pos[1] === 1);
    expect(coll?.winner).toBe('a');
    expect(coll?.blocked.slice().sort()).toEqual(['b', 'c']);
  });

  test('agent moving off the grid is blocked', () => {
    const puzzle = makePuzzle({
      grid: { w: 2, h: 1 },
      agents: [{ id: 'a', startPos: [1, 0] }],
    });
    const solution = makeSolution(
      [],
      {
        a: [
          [1, 0],
          [2, 0],
        ],
      },
      { a: [{ kind: 'MOVE' }] },
    );
    const world = makeWorld({ agents: { a: agentState([1, 0]) } });
    const { world: w2 } = stepOnce(puzzle, solution, world);
    expect(w2.agents['a']?.pos).toEqual([1, 0]);
  });
});

// ─── Tile transport ────────────────────────────────────────────────
describe('tile transport', () => {
  test('conveyor moves cargo one step facing-ward each cycle', () => {
    const puzzle = makePuzzle({ grid: { w: 3, h: 1 } });
    const solution = makeSolution([conveyor([0, 0], 'E')]);
    const world = makeWorld({
      cargo: cargoMap({ '0,0': [cargo(1, 'alpha')] }),
      nextCargoId: 2,
    });
    const { world: w2 } = stepOnce(puzzle, solution, world);
    expect(w2.cargoOnTiles[posKey([0, 0])] ?? []).toEqual([]);
    expect(w2.cargoOnTiles[posKey([1, 0])]).toEqual([{ id: 1, type: 'alpha' }]);
  });

  test('cargo conveyor-moved off-grid stays at source', () => {
    const puzzle = makePuzzle({ grid: { w: 2, h: 1 } });
    const solution = makeSolution([conveyor([1, 0], 'E')]); // edge → off-grid
    const world = makeWorld({
      cargo: cargoMap({ '1,0': [cargo(1, 'alpha')] }),
      nextCargoId: 2,
    });
    const { world: w2 } = stepOnce(puzzle, solution, world);
    expect(w2.cargoOnTiles[posKey([1, 0])]).toEqual([{ id: 1, type: 'alpha' }]);
  });

  test('cargo conveyor-moved onto obstacle stays at source', () => {
    const puzzle = makePuzzle({ grid: { w: 3, h: 1 }, obstacles: [[1, 0]] });
    const solution = makeSolution([conveyor([0, 0], 'E')]);
    const world = makeWorld({
      cargo: cargoMap({ '0,0': [cargo(1, 'alpha')] }),
      nextCargoId: 2,
    });
    const { world: w2 } = stepOnce(puzzle, solution, world);
    expect(w2.cargoOnTiles[posKey([0, 0])]).toEqual([{ id: 1, type: 'alpha' }]);
  });
});

// ─── Reactor end-to-end ────────────────────────────────────────────
describe('reactor', () => {
  test('consumes inputs and produces output at-cell with fresh id', () => {
    const puzzle = makePuzzle({ grid: { w: 3, h: 1 } });
    const solution = makeSolution([reactor([1, 0], 'E', { inputs: ['a', 'b'], output: 'c' })]);
    const world = makeWorld({
      cargo: cargoMap({ '1,0': [cargo(0, 'a'), cargo(1, 'b')] }),
      nextCargoId: 2,
    });
    const { world: w2 } = stepOnce(puzzle, solution, world);
    expect(w2.cargoOnTiles[posKey([1, 0])]).toEqual([{ id: 2, type: 'c' }]);
    expect(w2.cumulativeReactorConsumed).toBe(2);
    expect(w2.cumulativeReactorProduced).toBe(1);
    expect(w2.nextCargoId).toBe(3);
  });
});

// ─── Phase C: delivery ─────────────────────────────────────────────
describe('delivery', () => {
  test('matching cargo on an output is consumed and counted', () => {
    const puzzle = makePuzzle({
      grid: { w: 2, h: 1 },
      outputs: [{ pos: [1, 0], required: [{ type: 'alpha', count: 3 }] }],
    });
    const solution = makeSolution();
    const world = makeWorld({
      cargo: cargoMap({ '1,0': [cargo(0, 'alpha')] }),
      nextCargoId: 1,
    });
    const { world: w2, trace } = stepOnce(puzzle, solution, world);
    expect(w2.cargoOnTiles[posKey([1, 0])] ?? []).toEqual([]);
    expect(w2.deliveredCounts['alpha']).toBe(1);
    expect(trace.deliveries).toEqual([{ outputPos: [1, 0], cargo: { id: 0, type: 'alpha' } }]);
  });

  test('cargo of non-required type stays on the output cell (Q2a)', () => {
    const puzzle = makePuzzle({
      grid: { w: 2, h: 1 },
      outputs: [{ pos: [1, 0], required: [{ type: 'alpha', count: 1 }] }],
    });
    const solution = makeSolution();
    const world = makeWorld({
      cargo: cargoMap({ '1,0': [cargo(0, 'beta')] }),
      nextCargoId: 1,
    });
    const { world: w2 } = stepOnce(puzzle, solution, world);
    expect(w2.cargoOnTiles[posKey([1, 0])]).toEqual([{ id: 0, type: 'beta' }]);
    expect(w2.deliveredCounts['beta']).toBeUndefined();
  });

  test('cargo arriving once requirement is already met stays on cell', () => {
    const puzzle = makePuzzle({
      grid: { w: 2, h: 1 },
      outputs: [{ pos: [1, 0], required: [{ type: 'alpha', count: 1 }] }],
    });
    const solution = makeSolution();
    const world = makeWorld({
      cargo: cargoMap({ '1,0': [cargo(0, 'alpha'), cargo(1, 'alpha')] }),
      delivered: {},
      nextCargoId: 2,
    });
    const { world: w2 } = stepOnce(puzzle, solution, world);
    expect(w2.deliveredCounts['alpha']).toBe(1);
    // Second alpha stays.
    const here = w2.cargoOnTiles[posKey([1, 0])] ?? [];
    expect(here.length).toBe(1);
    expect(here[0]?.type).toBe('alpha');
  });
});

// ─── Conservation invariant (single-cycle smoke) ───────────────────
describe('cargo conservation per cycle', () => {
  test('total cargo (on tiles + carried + delivered) equals emissions minus reactor net loss', () => {
    const puzzle = makePuzzle({
      grid: { w: 3, h: 1 },
      inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 1 }],
      outputs: [{ pos: [2, 0], required: [{ type: 'alpha', count: 1 }] }],
    });
    const solution = makeSolution([conveyor([0, 0], 'E'), conveyor([1, 0], 'E')]);
    let world = makeWorld();
    for (let i = 0; i < 5; i++) {
      const r = stepOnce(puzzle, solution, world);
      world = r.world;
      const onTiles = Object.values(world.cargoOnTiles).flat().length;
      const carried = Object.values(world.agents).filter(
        (
          a,
        ): a is {
          pos: [number, number];
          pathIndex: number;
          programIndex: number;
          carrying: CargoInstance;
        } => a.carrying !== null,
      ).length;
      const delivered = Object.values(world.deliveredCounts).reduce((s, n) => s + n, 0);
      const net =
        world.cumulativeEmissions -
        world.cumulativeReactorConsumed +
        world.cumulativeReactorProduced;
      expect(onTiles + carried + delivered).toBe(net);
    }
  });
});
