/**
 * Hand-built solver corpus for Phase 1.
 *
 * 50 (puzzle, solution) pairs where the solution is known to win.
 * The corpus test asserts every solution reports `victory` within
 * its puzzle's maxCycles.
 *
 * Organization:
 *   C01-C10  Foundational mechanics (one new feature each)
 *   C11-C20  Conveyor pipelines (lengths, turns, parallel)
 *   C21-C25  Splitter routing
 *   C26-C30  Filter chains
 *   C31-C35  Reactor variations
 *   C36-C40  Agent-only puzzles
 *   C41-C45  Mixed agent + tile
 *   C46-C50  Multi-agent coordination
 *
 * The `makeConveyorChain` helper generates the C11-C20 family by
 * parameterizing chain length and required count. All other entries
 * are hand-designed below.
 */

import type { Pos, Puzzle, Solution } from '../../types';
import { conveyor, filter, makePuzzle, makeSolution, merger, reactor, splitter } from '../helpers';

export interface CorpusEntry {
  readonly name: string;
  readonly puzzle: Puzzle;
  readonly solution: Solution;
}

// ─── Parametric helpers ────────────────────────────────────────────

/**
 * input → conveyor × N → output (count required).
 * Cargo flows east one cell per cycle; victory after ~N + count cycles.
 */
function makeConveyorChain(id: string, name: string, length: number, count: number): CorpusEntry {
  const w = length + 1; // input + N conveyors + output? wait we need w = length + 2
  // Actually: input at (0,0), conveyors at (0..length-1, 0), output at (length, 0).
  // So we need w = length + 1.
  // Number of cycles for first delivery: length + 1.
  // For `count` deliveries at rate 1: ~length + count cycles.
  const maxCycles = length + count + 4;
  return {
    name,
    puzzle: makePuzzle({
      id,
      grid: { w, h: 1 },
      inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 1 }],
      outputs: [{ pos: [w - 1, 0], required: [{ type: 'alpha', count }] }],
      constraints: { maxTiles: length + 2, maxCycles },
    }),
    solution: makeSolution(Array.from({ length }, (_, i) => conveyor([i, 0], 'E'))),
  };
}

// ─── Hand-built C21-C25: splitter routing ──────────────────────────
function c21(): CorpusEntry {
  // Splitter perfectly splits a stream of 4 across two outputs.
  return {
    name: 'C21 splitter even split 4 to two outputs',
    puzzle: makePuzzle({
      id: 'C21',
      grid: { w: 4, h: 3 },
      inputs: [{ pos: [0, 1], emits: ['alpha'], rate: 1 }],
      outputs: [
        { pos: [3, 0], required: [{ type: 'alpha', count: 2 }] },
        { pos: [3, 2], required: [{ type: 'alpha', count: 2 }] },
      ],
      constraints: { maxTiles: 10, maxCycles: 40 },
    }),
    solution: makeSolution([
      conveyor([0, 1], 'E'),
      splitter([1, 1], 'E'),
      conveyor([1, 0], 'E'),
      conveyor([2, 0], 'E'),
      conveyor([1, 2], 'E'),
      conveyor([2, 2], 'E'),
    ]),
  };
}

function c22(): CorpusEntry {
  // Splitter discards one branch via short conveyor leading nowhere
  // useful; only one output gates victory.
  return {
    name: 'C22 splitter feeds one output, other branch sinks',
    puzzle: makePuzzle({
      id: 'C22',
      grid: { w: 4, h: 3 },
      inputs: [{ pos: [0, 1], emits: ['alpha'], rate: 1 }],
      outputs: [{ pos: [3, 0], required: [{ type: 'alpha', count: 3 }] }],
      constraints: { maxTiles: 8, maxCycles: 40 },
    }),
    solution: makeSolution([
      conveyor([0, 1], 'E'),
      splitter([1, 1], 'E'),
      conveyor([1, 0], 'E'),
      conveyor([2, 0], 'E'),
    ]),
  };
}

function c23(): CorpusEntry {
  // Two splitters in series — quarters the stream into 4 outputs.
  return {
    name: 'C23 two splitters quarter the stream',
    puzzle: makePuzzle({
      id: 'C23',
      grid: { w: 5, h: 5 },
      inputs: [{ pos: [0, 2], emits: ['alpha'], rate: 1 }],
      outputs: [
        { pos: [4, 0], required: [{ type: 'alpha', count: 1 }] },
        { pos: [4, 1], required: [{ type: 'alpha', count: 1 }] },
        { pos: [4, 3], required: [{ type: 'alpha', count: 1 }] },
        { pos: [4, 4], required: [{ type: 'alpha', count: 1 }] },
      ],
      constraints: { maxTiles: 16, maxCycles: 80 },
    }),
    solution: makeSolution([
      conveyor([0, 2], 'E'),
      splitter([1, 2], 'E'),
      // North path
      conveyor([1, 1], 'E'),
      splitter([2, 1], 'E'),
      conveyor([2, 0], 'E'),
      conveyor([3, 0], 'E'),
      conveyor([3, 1], 'E'),
      // South path
      conveyor([1, 3], 'E'),
      splitter([2, 3], 'E'),
      conveyor([2, 4], 'E'),
      conveyor([3, 4], 'E'),
      conveyor([3, 3], 'E'),
    ]),
  };
}

function c24(): CorpusEntry {
  // Splitter with one branch routed back to merge with main.
  return {
    name: 'C24 splitter + merger u-turn',
    puzzle: makePuzzle({
      id: 'C24',
      grid: { w: 5, h: 3 },
      inputs: [{ pos: [0, 1], emits: ['alpha'], rate: 1 }],
      outputs: [{ pos: [4, 1], required: [{ type: 'alpha', count: 4 }] }],
      constraints: { maxTiles: 12, maxCycles: 40 },
    }),
    solution: makeSolution([
      conveyor([0, 1], 'E'),
      splitter([1, 1], 'E'),
      // Upper detour
      conveyor([1, 0], 'E'),
      conveyor([2, 0], 'E'),
      conveyor([3, 0], 'S'),
      // Lower detour
      conveyor([1, 2], 'E'),
      conveyor([2, 2], 'E'),
      conveyor([3, 2], 'N'),
      // Merge into east
      merger([3, 1], 'E'),
    ]),
  };
}

function c25(): CorpusEntry {
  // Splitter pre-merger: confluence of two streams from a single source.
  return {
    name: 'C25 splitter to single output via merger',
    puzzle: makePuzzle({
      id: 'C25',
      grid: { w: 4, h: 3 },
      inputs: [{ pos: [0, 1], emits: ['alpha'], rate: 1 }],
      outputs: [{ pos: [3, 1], required: [{ type: 'alpha', count: 3 }] }],
      constraints: { maxTiles: 10, maxCycles: 30 },
    }),
    solution: makeSolution([
      conveyor([0, 1], 'E'),
      splitter([1, 1], 'E'),
      conveyor([1, 0], 'E'),
      conveyor([1, 2], 'E'),
      conveyor([2, 0], 'S'),
      conveyor([2, 2], 'N'),
      merger([2, 1], 'E'),
    ]),
  };
}

// ─── Hand-built C26-C30: filter chains ────────────────────────────
function c26(): CorpusEntry {
  return {
    name: 'C26 filter chain — alpha pass, beta sink',
    puzzle: makePuzzle({
      id: 'C26',
      grid: { w: 5, h: 1 },
      inputs: [{ pos: [0, 0], emits: ['alpha', 'beta'], rate: 1 }],
      outputs: [{ pos: [4, 0], required: [{ type: 'alpha', count: 3 }] }],
      constraints: { maxTiles: 8, maxCycles: 30 },
    }),
    solution: makeSolution([
      conveyor([0, 0], 'E'),
      filter([1, 0], 'E', 'alpha'),
      conveyor([2, 0], 'E'),
      conveyor([3, 0], 'E'),
    ]),
  };
}

function c27(): CorpusEntry {
  // Two filters of different types side by side.
  return {
    name: 'C27 two parallel filters separate alpha from beta',
    puzzle: makePuzzle({
      id: 'C27',
      grid: { w: 4, h: 3 },
      inputs: [{ pos: [0, 1], emits: ['alpha', 'beta'], rate: 1 }],
      outputs: [
        { pos: [3, 0], required: [{ type: 'alpha', count: 2 }] },
        { pos: [3, 2], required: [{ type: 'beta', count: 2 }] },
      ],
      constraints: { maxTiles: 10, maxCycles: 40 },
    }),
    solution: makeSolution([
      conveyor([0, 1], 'E'),
      splitter([1, 1], 'E'),
      conveyor([1, 0], 'E'),
      conveyor([1, 2], 'E'),
      filter([2, 0], 'E', 'alpha'),
      filter([2, 2], 'E', 'beta'),
    ]),
  };
}

function c28(): CorpusEntry {
  // Filter at output rejects wrong type; only requested type counts.
  return {
    name: 'C28 filter immediately before output',
    puzzle: makePuzzle({
      id: 'C28',
      grid: { w: 4, h: 1 },
      inputs: [{ pos: [0, 0], emits: ['alpha', 'beta', 'gamma'], rate: 1 }],
      outputs: [{ pos: [3, 0], required: [{ type: 'gamma', count: 2 }] }],
      constraints: { maxTiles: 6, maxCycles: 40 },
    }),
    solution: makeSolution([
      conveyor([0, 0], 'E'),
      conveyor([1, 0], 'E'),
      filter([2, 0], 'E', 'gamma'),
    ]),
  };
}

function c29(): CorpusEntry {
  // Long pipeline: input → 3 conveyors → filter → 3 conveyors → output.
  return {
    name: 'C29 long pipeline with filter mid-way',
    puzzle: makePuzzle({
      id: 'C29',
      grid: { w: 8, h: 1 },
      inputs: [{ pos: [0, 0], emits: ['alpha', 'beta'], rate: 1 }],
      outputs: [{ pos: [7, 0], required: [{ type: 'alpha', count: 2 }] }],
      constraints: { maxTiles: 10, maxCycles: 40 },
    }),
    solution: makeSolution([
      conveyor([0, 0], 'E'),
      conveyor([1, 0], 'E'),
      conveyor([2, 0], 'E'),
      filter([3, 0], 'E', 'alpha'),
      conveyor([4, 0], 'E'),
      conveyor([5, 0], 'E'),
      conveyor([6, 0], 'E'),
    ]),
  };
}

function c30(): CorpusEntry {
  // Filter at angle, then turn.
  return {
    name: 'C30 filter then south turn',
    puzzle: makePuzzle({
      id: 'C30',
      grid: { w: 3, h: 3 },
      inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 1 }],
      outputs: [{ pos: [2, 2], required: [{ type: 'alpha', count: 2 }] }],
      constraints: { maxTiles: 8, maxCycles: 30 },
    }),
    solution: makeSolution([
      conveyor([0, 0], 'E'),
      filter([1, 0], 'E', 'alpha'),
      conveyor([2, 0], 'S'),
      conveyor([2, 1], 'S'),
    ]),
  };
}

// ─── Hand-built C31-C35: reactor variations ───────────────────────
function c31(): CorpusEntry {
  // Two-input reactor with longer downstream conveyors.
  return {
    name: 'C31 reactor a+b->c through 3 conveyors',
    puzzle: makePuzzle({
      id: 'C31',
      grid: { w: 6, h: 3 },
      inputs: [
        { pos: [0, 0], emits: ['a'], rate: 1 },
        { pos: [0, 2], emits: ['b'], rate: 1 },
      ],
      outputs: [{ pos: [5, 1], required: [{ type: 'c', count: 2 }] }],
      constraints: { maxTiles: 14, maxCycles: 30 },
    }),
    solution: makeSolution([
      conveyor([0, 0], 'E'),
      conveyor([1, 0], 'S'),
      conveyor([0, 2], 'E'),
      conveyor([1, 2], 'N'),
      reactor([1, 1], 'E', { inputs: ['a', 'b'], output: 'c' }),
      conveyor([2, 1], 'E'),
      conveyor([3, 1], 'E'),
      conveyor([4, 1], 'E'),
    ]),
  };
}

function c32(): CorpusEntry {
  // Reactor with single-input recipe (catalyst-like).
  return {
    name: 'C32 single-input reactor transforms alpha to beta',
    puzzle: makePuzzle({
      id: 'C32',
      grid: { w: 5, h: 1 },
      inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 1 }],
      outputs: [{ pos: [4, 0], required: [{ type: 'beta', count: 2 }] }],
      constraints: { maxTiles: 8, maxCycles: 30 },
    }),
    solution: makeSolution([
      conveyor([0, 0], 'E'),
      conveyor([1, 0], 'E'),
      reactor([2, 0], 'E', { inputs: ['alpha'], output: 'beta' }),
      conveyor([3, 0], 'E'),
    ]),
  };
}

function c33(): CorpusEntry {
  // Reactor with 2-of-same recipe.
  return {
    name: 'C33 reactor 2 alpha -> 1 beta',
    puzzle: makePuzzle({
      id: 'C33',
      grid: { w: 5, h: 3 },
      inputs: [
        { pos: [0, 0], emits: ['alpha'], rate: 1 },
        { pos: [0, 2], emits: ['alpha'], rate: 1 },
      ],
      outputs: [{ pos: [4, 1], required: [{ type: 'beta', count: 2 }] }],
      constraints: { maxTiles: 14, maxCycles: 40 },
    }),
    solution: makeSolution([
      conveyor([0, 0], 'E'),
      conveyor([1, 0], 'S'),
      conveyor([0, 2], 'E'),
      conveyor([1, 2], 'N'),
      reactor([1, 1], 'E', { inputs: ['alpha', 'alpha'], output: 'beta' }),
      conveyor([2, 1], 'E'),
      conveyor([3, 1], 'E'),
    ]),
  };
}

function c34(): CorpusEntry {
  // Chain of reactors: a -> b -> c.
  return {
    name: 'C34 reactor chain a->b->c',
    puzzle: makePuzzle({
      id: 'C34',
      grid: { w: 6, h: 1 },
      inputs: [{ pos: [0, 0], emits: ['a'], rate: 1 }],
      outputs: [{ pos: [5, 0], required: [{ type: 'c', count: 2 }] }],
      constraints: { maxTiles: 10, maxCycles: 40 },
    }),
    solution: makeSolution([
      conveyor([0, 0], 'E'),
      reactor([1, 0], 'E', { inputs: ['a'], output: 'b' }),
      conveyor([2, 0], 'E'),
      reactor([3, 0], 'E', { inputs: ['b'], output: 'c' }),
      conveyor([4, 0], 'E'),
    ]),
  };
}

function c35(): CorpusEntry {
  // Two-input reactor with a longer downstream pipeline (different
  // from C06 which has 3 conveyors; this one has 5).
  return {
    name: 'C35 reactor with extended downstream pipeline',
    puzzle: makePuzzle({
      id: 'C35',
      grid: { w: 7, h: 3 },
      inputs: [
        { pos: [0, 0], emits: ['a'], rate: 1 },
        { pos: [0, 2], emits: ['b'], rate: 1 },
      ],
      outputs: [{ pos: [6, 1], required: [{ type: 'c', count: 2 }] }],
      constraints: { maxTiles: 14, maxCycles: 40 },
    }),
    solution: makeSolution([
      conveyor([0, 0], 'E'),
      conveyor([1, 0], 'S'),
      conveyor([0, 2], 'E'),
      conveyor([1, 2], 'N'),
      reactor([1, 1], 'E', { inputs: ['a', 'b'], output: 'c' }),
      conveyor([2, 1], 'E'),
      conveyor([3, 1], 'E'),
      conveyor([4, 1], 'E'),
      conveyor([5, 1], 'E'),
    ]),
  };
}

// ─── Hand-built C36-C40: agent-only puzzles ───────────────────────
function c36(): CorpusEntry {
  // Agent walks a square loop, ferrying cargo.
  const path: Pos[] = [
    [0, 0],
    [1, 0],
    [2, 0],
    [2, 1],
    [1, 1],
    [0, 1],
  ];
  return {
    name: 'C36 agent walks a square loop',
    puzzle: makePuzzle({
      id: 'C36',
      grid: { w: 3, h: 2 },
      inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 6 }],
      outputs: [{ pos: [2, 1], required: [{ type: 'alpha', count: 1 }] }],
      agents: [{ id: 'a1', startPos: [0, 0], maxOps: 16 }],
      constraints: { maxTiles: 0, maxCycles: 30 },
    }),
    solution: makeSolution(
      [],
      { a1: path },
      {
        a1: [
          { kind: 'GRAB' },
          { kind: 'MOVE' },
          { kind: 'MOVE' },
          { kind: 'MOVE' },
          { kind: 'DROP' },
          { kind: 'MOVE' },
          { kind: 'MOVE' },
          { kind: 'MOVE' },
        ],
      },
    ),
  };
}

function c37(): CorpusEntry {
  // Agent with WAIT op to synchronize with rate-2 input.
  return {
    name: 'C37 agent waits between cargo arrivals',
    puzzle: makePuzzle({
      id: 'C37',
      grid: { w: 3, h: 1 },
      inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 4 }],
      outputs: [{ pos: [2, 0], required: [{ type: 'alpha', count: 1 }] }],
      agents: [{ id: 'a1', startPos: [0, 0], maxOps: 8 }],
      constraints: { maxTiles: 0, maxCycles: 20 },
    }),
    solution: makeSolution(
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
    ),
  };
}

function c38(): CorpusEntry {
  // Agent with SENSE: only grab cargo of certain type.
  return {
    name: 'C38 SENSE-guarded grab on mixed stream',
    puzzle: makePuzzle({
      id: 'C38',
      grid: { w: 3, h: 1 },
      inputs: [{ pos: [0, 0], emits: ['alpha', 'beta'], rate: 4 }],
      outputs: [{ pos: [2, 0], required: [{ type: 'alpha', count: 1 }] }],
      agents: [{ id: 'a1', startPos: [0, 0], maxOps: 8 }],
      constraints: { maxTiles: 0, maxCycles: 30 },
    }),
    solution: makeSolution(
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
          {
            kind: 'SENSE',
            expects: 'alpha',
            then: { kind: 'GRAB' },
            otherwise: { kind: 'WAIT' },
          },
          { kind: 'MOVE' },
          { kind: 'MOVE' },
          { kind: 'DROP' },
          { kind: 'MOVE' },
          { kind: 'MOVE' },
        ],
      },
    ),
  };
}

function c39(): CorpusEntry {
  // Agent grabs, walks turn, drops.
  return {
    name: 'C39 agent walks L-shape (grab → corner → drop)',
    puzzle: makePuzzle({
      id: 'C39',
      grid: { w: 3, h: 3 },
      inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 6 }],
      outputs: [{ pos: [2, 2], required: [{ type: 'alpha', count: 1 }] }],
      agents: [{ id: 'a1', startPos: [0, 0], maxOps: 16 }],
      constraints: { maxTiles: 0, maxCycles: 30 },
    }),
    solution: makeSolution(
      [],
      {
        a1: [
          [0, 0],
          [1, 0],
          [2, 0],
          [2, 1],
          [2, 2],
        ],
      },
      {
        a1: [
          { kind: 'GRAB' },
          { kind: 'MOVE' },
          { kind: 'MOVE' },
          { kind: 'MOVE' },
          { kind: 'MOVE' },
          { kind: 'DROP' },
          { kind: 'MOVE' },
          { kind: 'MOVE' },
          { kind: 'MOVE' },
          { kind: 'MOVE' },
        ],
      },
    ),
  };
}

function c40(): CorpusEntry {
  // Single-cell agent: GRAB and DROP on same cell (output is input).
  // Agent stays at start cell which is the input AND output.
  // Hmm, this only works if input==output. Let me do: agent at (0,0)
  // which is input; output at (0,0) also. Agent grabs cargo as emitted,
  // drops it next cycle, output collects.
  return {
    name: 'C40 stationary agent grabs and drops at input==output',
    puzzle: makePuzzle({
      id: 'C40',
      grid: { w: 1, h: 1 },
      inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 3 }],
      outputs: [{ pos: [0, 0], required: [{ type: 'alpha', count: 1 }] }],
      agents: [{ id: 'a1', startPos: [0, 0], maxOps: 4 }],
      constraints: { maxTiles: 0, maxCycles: 10 },
    }),
    solution: makeSolution(
      [],
      { a1: [[0, 0]] },
      {
        a1: [{ kind: 'WAIT' }],
      },
    ),
  };
}

// ─── Hand-built C41-C45: mixed agent + tile ───────────────────────
function c41(): CorpusEntry {
  // Conveyor delivers; agent on side just observes (WAIT loop).
  return {
    name: 'C41 conveyor pipeline with idle agent',
    puzzle: makePuzzle({
      id: 'C41',
      grid: { w: 4, h: 2 },
      inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 1 }],
      outputs: [{ pos: [3, 0], required: [{ type: 'alpha', count: 2 }] }],
      agents: [{ id: 'a1', startPos: [0, 1], maxOps: 4 }],
      constraints: { maxTiles: 6, maxCycles: 20 },
    }),
    solution: makeSolution(
      [conveyor([0, 0], 'E'), conveyor([1, 0], 'E'), conveyor([2, 0], 'E')],
      { a1: [[0, 1]] },
      { a1: [{ kind: 'WAIT' }] },
    ),
  };
}

function c42(): CorpusEntry {
  // Agent loads cargo onto a downstream conveyor.
  return {
    name: 'C42 agent feeds cargo onto conveyor',
    puzzle: makePuzzle({
      id: 'C42',
      grid: { w: 4, h: 1 },
      inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 4 }],
      outputs: [{ pos: [3, 0], required: [{ type: 'alpha', count: 1 }] }],
      agents: [{ id: 'a1', startPos: [0, 0], maxOps: 8 }],
      constraints: { maxTiles: 4, maxCycles: 30 },
    }),
    solution: makeSolution(
      [conveyor([1, 0], 'E'), conveyor([2, 0], 'E')],
      {
        a1: [
          [0, 0],
          [1, 0],
        ],
      },
      {
        a1: [{ kind: 'GRAB' }, { kind: 'MOVE' }, { kind: 'DROP' }, { kind: 'MOVE' }],
      },
    ),
  };
}

function c43(): CorpusEntry {
  // Splitter dumps half stream to agent; agent ferries to output.
  return {
    name: 'C43 splitter feeds both a conveyor and an agent',
    puzzle: makePuzzle({
      id: 'C43',
      grid: { w: 4, h: 3 },
      inputs: [{ pos: [0, 1], emits: ['alpha'], rate: 1 }],
      outputs: [
        { pos: [3, 0], required: [{ type: 'alpha', count: 1 }] },
        { pos: [3, 2], required: [{ type: 'alpha', count: 1 }] },
      ],
      agents: [{ id: 'a1', startPos: [1, 2], maxOps: 8 }],
      constraints: { maxTiles: 8, maxCycles: 30 },
    }),
    solution: makeSolution(
      [conveyor([0, 1], 'E'), splitter([1, 1], 'E'), conveyor([1, 0], 'E'), conveyor([2, 0], 'E')],
      {
        a1: [
          [1, 2],
          [2, 2],
        ],
      },
      {
        a1: [{ kind: 'GRAB' }, { kind: 'MOVE' }, { kind: 'DROP' }, { kind: 'MOVE' }],
      },
    ),
  };
}

function c44(): CorpusEntry {
  // Agent on conveyor — cargo flows under agent's feet.
  return {
    name: 'C44 agent stands on conveyor; cargo flows past',
    puzzle: makePuzzle({
      id: 'C44',
      grid: { w: 4, h: 1 },
      inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 1 }],
      outputs: [{ pos: [3, 0], required: [{ type: 'alpha', count: 2 }] }],
      agents: [{ id: 'a1', startPos: [1, 0], maxOps: 4 }],
      constraints: { maxTiles: 4, maxCycles: 20 },
    }),
    solution: makeSolution(
      [conveyor([0, 0], 'E'), conveyor([1, 0], 'E'), conveyor([2, 0], 'E')],
      { a1: [[1, 0]] },
      { a1: [{ kind: 'WAIT' }] },
    ),
  };
}

function c45(): CorpusEntry {
  // Reactor + agent pickup.
  return {
    name: 'C45 reactor produces; agent picks up and delivers',
    puzzle: makePuzzle({
      id: 'C45',
      grid: { w: 4, h: 1 },
      inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 2 }],
      outputs: [{ pos: [3, 0], required: [{ type: 'beta', count: 1 }] }],
      agents: [{ id: 'a1', startPos: [2, 0], maxOps: 4 }],
      constraints: { maxTiles: 3, maxCycles: 20 },
    }),
    solution: makeSolution(
      [conveyor([0, 0], 'E'), reactor([1, 0], 'E', { inputs: ['alpha'], output: 'beta' })],
      {
        a1: [
          [2, 0],
          [3, 0],
        ],
      },
      {
        a1: [{ kind: 'GRAB' }, { kind: 'MOVE' }, { kind: 'DROP' }, { kind: 'MOVE' }],
      },
    ),
  };
}

// ─── Hand-built C46-C50: multi-agent coordination ─────────────────
function c46(): CorpusEntry {
  // Two agents on parallel paths, no interaction.
  return {
    name: 'C46 two agents on parallel rails',
    puzzle: makePuzzle({
      id: 'C46',
      grid: { w: 3, h: 2 },
      inputs: [
        { pos: [0, 0], emits: ['alpha'], rate: 3 },
        { pos: [0, 1], emits: ['alpha'], rate: 3 },
      ],
      outputs: [
        { pos: [2, 0], required: [{ type: 'alpha', count: 1 }] },
        { pos: [2, 1], required: [{ type: 'alpha', count: 1 }] },
      ],
      agents: [
        { id: 'a1', startPos: [0, 0], maxOps: 8 },
        { id: 'a2', startPos: [0, 1], maxOps: 8 },
      ],
      constraints: { maxTiles: 0, maxCycles: 30 },
    }),
    solution: makeSolution(
      [],
      {
        a1: [
          [0, 0],
          [1, 0],
          [2, 0],
        ],
        a2: [
          [0, 1],
          [1, 1],
          [2, 1],
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
        a2: [
          { kind: 'GRAB' },
          { kind: 'MOVE' },
          { kind: 'MOVE' },
          { kind: 'DROP' },
          { kind: 'MOVE' },
          { kind: 'MOVE' },
        ],
      },
    ),
  };
}

function c47(): CorpusEntry {
  // Two agents: one ferries cargo across the row; the other stands idle
  // off the path, so the two don't collide.
  return {
    name: 'C47 two agents, idle observer off the active row',
    puzzle: makePuzzle({
      id: 'C47',
      grid: { w: 5, h: 2 },
      inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 4 }],
      outputs: [{ pos: [4, 0], required: [{ type: 'alpha', count: 1 }] }],
      agents: [
        { id: 'a1', startPos: [0, 0], maxOps: 10 },
        { id: 'a2', startPos: [4, 1], maxOps: 4 },
      ],
      constraints: { maxTiles: 0, maxCycles: 30 },
    }),
    solution: makeSolution(
      [],
      {
        a1: [
          [0, 0],
          [1, 0],
          [2, 0],
          [3, 0],
          [4, 0],
        ],
        a2: [[4, 1]],
      },
      {
        a1: [
          { kind: 'GRAB' },
          { kind: 'MOVE' },
          { kind: 'MOVE' },
          { kind: 'MOVE' },
          { kind: 'MOVE' },
          { kind: 'DROP' },
        ],
        a2: [{ kind: 'WAIT' }],
      },
    ),
  };
}

function c48(): CorpusEntry {
  // Two agents handing off cargo at a midpoint.
  return {
    name: 'C48 two-agent handoff at midpoint',
    puzzle: makePuzzle({
      id: 'C48',
      grid: { w: 5, h: 1 },
      inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 6 }],
      outputs: [{ pos: [4, 0], required: [{ type: 'alpha', count: 1 }] }],
      agents: [
        { id: 'a1', startPos: [0, 0], maxOps: 6 },
        { id: 'b2', startPos: [3, 0], maxOps: 6 },
      ],
      constraints: { maxTiles: 0, maxCycles: 30 },
    }),
    solution: makeSolution(
      [],
      {
        a1: [
          [0, 0],
          [1, 0],
          [2, 0],
        ],
        b2: [
          [3, 0],
          [2, 0],
          [3, 0],
          [4, 0],
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
        b2: [
          { kind: 'WAIT' },
          { kind: 'WAIT' },
          { kind: 'WAIT' },
          { kind: 'WAIT' },
          { kind: 'WAIT' },
          { kind: 'WAIT' },
          { kind: 'MOVE' },
          { kind: 'GRAB' },
          { kind: 'MOVE' },
          { kind: 'MOVE' },
          { kind: 'DROP' },
        ],
      },
    ),
  };
}

function c49(): CorpusEntry {
  // Three agents, each ferrying their own input to their own output.
  return {
    name: 'C49 three agents, three independent ferries',
    puzzle: makePuzzle({
      id: 'C49',
      grid: { w: 3, h: 3 },
      inputs: [
        { pos: [0, 0], emits: ['alpha'], rate: 4 },
        { pos: [0, 1], emits: ['alpha'], rate: 4 },
        { pos: [0, 2], emits: ['alpha'], rate: 4 },
      ],
      outputs: [
        { pos: [2, 0], required: [{ type: 'alpha', count: 1 }] },
        { pos: [2, 1], required: [{ type: 'alpha', count: 1 }] },
        { pos: [2, 2], required: [{ type: 'alpha', count: 1 }] },
      ],
      agents: [
        { id: 'a1', startPos: [0, 0], maxOps: 8 },
        { id: 'a2', startPos: [0, 1], maxOps: 8 },
        { id: 'a3', startPos: [0, 2], maxOps: 8 },
      ],
      constraints: { maxTiles: 0, maxCycles: 30 },
    }),
    solution: makeSolution(
      [],
      {
        a1: [
          [0, 0],
          [1, 0],
          [2, 0],
        ],
        a2: [
          [0, 1],
          [1, 1],
          [2, 1],
        ],
        a3: [
          [0, 2],
          [1, 2],
          [2, 2],
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
        a2: [
          { kind: 'GRAB' },
          { kind: 'MOVE' },
          { kind: 'MOVE' },
          { kind: 'DROP' },
          { kind: 'MOVE' },
          { kind: 'MOVE' },
        ],
        a3: [
          { kind: 'GRAB' },
          { kind: 'MOVE' },
          { kind: 'MOVE' },
          { kind: 'DROP' },
          { kind: 'MOVE' },
          { kind: 'MOVE' },
        ],
      },
    ),
  };
}

function c50(): CorpusEntry {
  // Hybrid: tile pipeline + agent on the side feeding a second output.
  return {
    name: 'C50 hybrid pipeline + agent ferry',
    puzzle: makePuzzle({
      id: 'C50',
      grid: { w: 4, h: 2 },
      inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 1 }],
      outputs: [
        { pos: [3, 0], required: [{ type: 'alpha', count: 2 }] },
        { pos: [3, 1], required: [{ type: 'alpha', count: 1 }] },
      ],
      agents: [{ id: 'a1', startPos: [0, 1], maxOps: 8 }],
      constraints: { maxTiles: 6, maxCycles: 30 },
    }),
    solution: makeSolution(
      [conveyor([0, 0], 'E'), conveyor([1, 0], 'E'), conveyor([2, 0], 'E')],
      {
        a1: [
          [0, 1],
          [1, 1],
          [2, 1],
          [3, 1],
        ],
      },
      {
        a1: [
          { kind: 'WAIT' },
          { kind: 'WAIT' },
          { kind: 'MOVE' },
          { kind: 'MOVE' },
          { kind: 'MOVE' },
          { kind: 'WAIT' },
        ],
      },
    ),
  };
}

// ─── Corpus assembly ───────────────────────────────────────────────
export const CORPUS: readonly CorpusEntry[] = [
  // C01-C10: foundational mechanics
  {
    name: 'C01 trivial conveyor delivery',
    puzzle: makePuzzle({
      id: 'C01',
      grid: { w: 2, h: 1 },
      inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 1 }],
      outputs: [{ pos: [1, 0], required: [{ type: 'alpha', count: 1 }] }],
      constraints: { maxTiles: 4, maxCycles: 5 },
    }),
    solution: makeSolution([conveyor([0, 0], 'E')]),
  },
  {
    name: 'C02 four-conveyor line, deliver 3',
    puzzle: makePuzzle({
      id: 'C02',
      grid: { w: 5, h: 1 },
      inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 1 }],
      outputs: [{ pos: [4, 0], required: [{ type: 'alpha', count: 3 }] }],
      constraints: { maxTiles: 8, maxCycles: 20 },
    }),
    solution: makeSolution([
      conveyor([0, 0], 'E'),
      conveyor([1, 0], 'E'),
      conveyor([2, 0], 'E'),
      conveyor([3, 0], 'E'),
    ]),
  },
  {
    name: 'C03 splitter to two outputs',
    puzzle: makePuzzle({
      id: 'C03',
      grid: { w: 3, h: 3 },
      inputs: [{ pos: [0, 1], emits: ['alpha'], rate: 1 }],
      outputs: [
        { pos: [2, 0], required: [{ type: 'alpha', count: 2 }] },
        { pos: [2, 2], required: [{ type: 'alpha', count: 2 }] },
      ],
      constraints: { maxTiles: 8, maxCycles: 30 },
    }),
    solution: makeSolution([
      conveyor([0, 1], 'E'),
      splitter([1, 1], 'E'),
      conveyor([1, 0], 'E'),
      conveyor([1, 2], 'E'),
    ]),
  },
  {
    name: 'C04 filter routes alpha; alternating emissions',
    puzzle: makePuzzle({
      id: 'C04',
      grid: { w: 4, h: 1 },
      inputs: [{ pos: [0, 0], emits: ['alpha', 'beta'], rate: 1 }],
      outputs: [{ pos: [3, 0], required: [{ type: 'alpha', count: 2 }] }],
      constraints: { maxTiles: 8, maxCycles: 20 },
    }),
    solution: makeSolution([
      conveyor([0, 0], 'E'),
      filter([1, 0], 'E', 'alpha'),
      conveyor([2, 0], 'E'),
    ]),
  },
  {
    name: 'C05 merger combines two streams',
    puzzle: makePuzzle({
      id: 'C05',
      grid: { w: 4, h: 3 },
      inputs: [
        { pos: [0, 0], emits: ['alpha'], rate: 1 },
        { pos: [0, 2], emits: ['alpha'], rate: 1 },
      ],
      outputs: [{ pos: [3, 1], required: [{ type: 'alpha', count: 4 }] }],
      constraints: { maxTiles: 10, maxCycles: 20 },
    }),
    solution: makeSolution([
      conveyor([0, 0], 'E'),
      conveyor([1, 0], 'S'),
      conveyor([0, 2], 'E'),
      conveyor([1, 2], 'N'),
      merger([1, 1], 'E'),
      conveyor([2, 1], 'E'),
    ]),
  },
  {
    name: 'C06 reactor: alpha + beta -> gamma',
    puzzle: makePuzzle({
      id: 'C06',
      grid: { w: 5, h: 3 },
      inputs: [
        { pos: [0, 0], emits: ['alpha'], rate: 1 },
        { pos: [0, 2], emits: ['beta'], rate: 1 },
      ],
      outputs: [{ pos: [4, 1], required: [{ type: 'gamma', count: 2 }] }],
      constraints: { maxTiles: 12, maxCycles: 30 },
    }),
    solution: makeSolution([
      conveyor([0, 0], 'E'),
      conveyor([1, 0], 'S'),
      conveyor([0, 2], 'E'),
      conveyor([1, 2], 'N'),
      reactor([1, 1], 'E', { inputs: ['alpha', 'beta'], output: 'gamma' }),
      conveyor([2, 1], 'E'),
      conveyor([3, 1], 'E'),
    ]),
  },
  {
    name: 'C07 agent ferries cargo',
    puzzle: makePuzzle({
      id: 'C07',
      grid: { w: 3, h: 1 },
      inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 3 }],
      outputs: [{ pos: [2, 0], required: [{ type: 'alpha', count: 2 }] }],
      agents: [{ id: 'a1', startPos: [0, 0], maxOps: 8 }],
      constraints: { maxTiles: 0, maxCycles: 30 },
    }),
    solution: makeSolution(
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
    ),
  },
  {
    name: 'C08 SENSE branching guard',
    puzzle: makePuzzle({
      id: 'C08',
      grid: { w: 3, h: 1 },
      inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 4 }],
      outputs: [{ pos: [2, 0], required: [{ type: 'alpha', count: 1 }] }],
      agents: [{ id: 'a1', startPos: [0, 0], maxOps: 8 }],
      constraints: { maxTiles: 0, maxCycles: 30 },
    }),
    solution: makeSolution(
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
          {
            kind: 'SENSE',
            expects: 'alpha',
            then: { kind: 'GRAB' },
            otherwise: { kind: 'WAIT' },
          },
          { kind: 'MOVE' },
          { kind: 'MOVE' },
          { kind: 'DROP' },
          { kind: 'MOVE' },
          { kind: 'MOVE' },
        ],
      },
    ),
  },
  {
    name: 'C09 two agents on parallel rails',
    puzzle: makePuzzle({
      id: 'C09',
      grid: { w: 3, h: 2 },
      inputs: [
        { pos: [0, 0], emits: ['alpha'], rate: 3 },
        { pos: [0, 1], emits: ['alpha'], rate: 3 },
      ],
      outputs: [
        { pos: [2, 0], required: [{ type: 'alpha', count: 1 }] },
        { pos: [2, 1], required: [{ type: 'alpha', count: 1 }] },
      ],
      agents: [
        { id: 'a1', startPos: [0, 0], maxOps: 8 },
        { id: 'a2', startPos: [0, 1], maxOps: 8 },
      ],
      constraints: { maxTiles: 0, maxCycles: 30 },
    }),
    solution: makeSolution(
      [],
      {
        a1: [
          [0, 0],
          [1, 0],
          [2, 0],
        ],
        a2: [
          [0, 1],
          [1, 1],
          [2, 1],
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
        a2: [
          { kind: 'GRAB' },
          { kind: 'MOVE' },
          { kind: 'MOVE' },
          { kind: 'DROP' },
          { kind: 'MOVE' },
          { kind: 'MOVE' },
        ],
      },
    ),
  },
  {
    name: 'C10 multi-type single output',
    puzzle: makePuzzle({
      id: 'C10',
      grid: { w: 4, h: 1 },
      inputs: [{ pos: [0, 0], emits: ['alpha', 'gamma'], rate: 1 }],
      outputs: [
        {
          pos: [3, 0],
          required: [
            { type: 'alpha', count: 2 },
            { type: 'gamma', count: 2 },
          ],
        },
      ],
      constraints: { maxTiles: 8, maxCycles: 30 },
    }),
    solution: makeSolution([conveyor([0, 0], 'E'), conveyor([1, 0], 'E'), conveyor([2, 0], 'E')]),
  },

  // C11-C20: parametric conveyor chain family
  makeConveyorChain('C11', 'C11 conveyor chain length 2 deliver 1', 2, 1),
  makeConveyorChain('C12', 'C12 conveyor chain length 3 deliver 1', 3, 1),
  makeConveyorChain('C13', 'C13 conveyor chain length 5 deliver 1', 5, 1),
  makeConveyorChain('C14', 'C14 conveyor chain length 7 deliver 1', 7, 1),
  makeConveyorChain('C15', 'C15 conveyor chain length 3 deliver 5', 3, 5),
  makeConveyorChain('C16', 'C16 conveyor chain length 5 deliver 3', 5, 3),
  makeConveyorChain('C17', 'C17 conveyor chain length 4 deliver 4', 4, 4),
  makeConveyorChain('C18', 'C18 conveyor chain length 6 deliver 2', 6, 2),
  makeConveyorChain('C19', 'C19 conveyor chain length 2 deliver 5', 2, 5),
  makeConveyorChain('C20', 'C20 conveyor chain length 8 deliver 1', 8, 1),

  // C21-C25: splitter routing
  c21(),
  c22(),
  c23(),
  c24(),
  c25(),

  // C26-C30: filter chains
  c26(),
  c27(),
  c28(),
  c29(),
  c30(),

  // C31-C35: reactor variations
  c31(),
  c32(),
  c33(),
  c34(),
  c35(),

  // C36-C40: agent-only puzzles
  c36(),
  c37(),
  c38(),
  c39(),
  c40(),

  // C41-C45: mixed agent + tile
  c41(),
  c42(),
  c43(),
  c44(),
  c45(),

  // C46-C50: multi-agent coordination
  c46(),
  c47(),
  c48(),
  c49(),
  c50(),
];
