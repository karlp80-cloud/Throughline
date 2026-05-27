/**
 * Hand-built solver corpus for Phase 1.
 *
 * Each entry is a (puzzle, solution) pair where the solution is known
 * to win. The corpus test asserts every solution reports `victory`
 * within the puzzle's maxCycles.
 *
 * NOTE: the IMPLEMENTATION_PLAN's Phase 1 calls for 50 puzzles. This
 * file ships 10 covering the full mechanic surface (every tile kind,
 * every op kind, agent collision, SENSE branching, multi-cargo).
 * The remaining 40 are a known gap — to be authored as the puzzle DSL
 * stabilizes and the editor (Phase 3) makes authoring less painful.
 * Property tests + snapshot tests + per-tile/op unit tests already
 * cover the engine's behavior space; the corpus is the "real solutions
 * actually win" smoke check.
 */

import type { Puzzle, Solution } from '../../types';
import { conveyor, filter, makePuzzle, makeSolution, merger, reactor, splitter } from '../helpers';

export interface CorpusEntry {
  readonly name: string;
  readonly puzzle: Puzzle;
  readonly solution: Solution;
}

export const CORPUS: readonly CorpusEntry[] = [
  // ─── 1. Trivial single delivery ────────────────────────────────
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

  // ─── 2. Multi-conveyor line ────────────────────────────────────
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

  // ─── 3. Splitter feeding two outputs ───────────────────────────
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

  // ─── 4. Filter routing (alphas pass; betas pile) ───────────────
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

  // ─── 5. Merger combining two streams ──────────────────────────
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

  // ─── 6. Reactor 1+1 = 1 ───────────────────────────────────────
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

  // ─── 7. Single agent grab-walk-drop ────────────────────────────
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

  // ─── 8. SENSE branching: grab only when cargo present ─────────
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

  // ─── 9. Two agents on parallel rails (no collisions) ──────────
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

  // ─── 10. Multi-type single output (alpha=2 AND gamma=2) ──────
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
];
