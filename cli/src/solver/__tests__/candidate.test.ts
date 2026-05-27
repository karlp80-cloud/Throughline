/**
 * Candidate-generator tests per architect doc §6.2 / §6.4.
 *
 * The generator returns a `Solution` (tile placements + per-agent
 * paths + per-agent programs). The schema honored:
 *   - tile kinds drawn from puzzle.availableTiles
 *   - positions on grid, excluding obstacles, inputs, outputs, agent
 *     start positions
 *   - tile count between 0 and maxTiles
 *   - filter tiles get a filterType from puzzle.filterTypes
 *   - reactor tiles get a recipe from puzzle.reactorRecipes
 *   - agent paths start at startPos
 *   - programs sampled from availableOps
 */

import { describe, expect, test } from 'vitest';
import { generateRandomSolution } from '../candidate';
import { createPRNG } from '../prng';
import type { Puzzle } from '../../../../src/engine';

function tinyPuzzle(overrides: Partial<Puzzle> = {}): Puzzle {
  return {
    id: 'tiny',
    grid: { w: 5, h: 3 },
    inputs: [{ pos: [0, 1], emits: ['alpha'], rate: 1 }],
    outputs: [{ pos: [4, 1], required: [{ type: 'alpha', count: 1 }] }],
    agents: [],
    obstacles: [],
    availableTiles: ['conveyor'],
    availableOps: ['MOVE'],
    constraints: { maxTiles: 8, maxCycles: 30 },
    optionalChallenges: [],
    ...overrides,
  };
}

describe('generateRandomSolution — shape', () => {
  test('returns a Solution with tiles, paths, programs', () => {
    const p = tinyPuzzle();
    const sol = generateRandomSolution(p, createPRNG('s1'));
    expect(Array.isArray(sol.tiles)).toBe(true);
    expect(typeof sol.paths).toBe('object');
    expect(typeof sol.programs).toBe('object');
  });
});

describe('generateRandomSolution — tile constraints', () => {
  test('tile count never exceeds maxTiles', () => {
    const p = tinyPuzzle({ constraints: { maxTiles: 3, maxCycles: 30 } });
    for (let i = 0; i < 50; i++) {
      const sol = generateRandomSolution(p, createPRNG('seed-' + i));
      expect(sol.tiles.length).toBeLessThanOrEqual(3);
    }
  });

  test('only draws tile kinds from availableTiles', () => {
    const p = tinyPuzzle({ availableTiles: ['conveyor'] });
    for (let i = 0; i < 30; i++) {
      const sol = generateRandomSolution(p, createPRNG('k-' + i));
      for (const t of sol.tiles) {
        expect(['conveyor']).toContain(t.kind);
      }
    }
  });

  test('never places tiles on input cells', () => {
    const p = tinyPuzzle();
    for (let i = 0; i < 30; i++) {
      const sol = generateRandomSolution(p, createPRNG('inp-' + i));
      for (const t of sol.tiles) {
        expect(t.pos).not.toEqual([0, 1]);
      }
    }
  });

  test('never places tiles on output cells', () => {
    const p = tinyPuzzle();
    for (let i = 0; i < 30; i++) {
      const sol = generateRandomSolution(p, createPRNG('out-' + i));
      for (const t of sol.tiles) {
        expect(t.pos).not.toEqual([4, 1]);
      }
    }
  });

  test('never places tiles on obstacles', () => {
    const p = tinyPuzzle({ obstacles: [[2, 1]] });
    for (let i = 0; i < 30; i++) {
      const sol = generateRandomSolution(p, createPRNG('obs-' + i));
      for (const t of sol.tiles) {
        expect(t.pos).not.toEqual([2, 1]);
      }
    }
  });

  test('never places tiles on agent start positions', () => {
    const p = tinyPuzzle({
      agents: [{ id: 'a1', startPos: [2, 1], maxOps: 4 }],
      availableOps: ['MOVE', 'GRAB', 'DROP'],
    });
    for (let i = 0; i < 30; i++) {
      const sol = generateRandomSolution(p, createPRNG('ag-' + i));
      for (const t of sol.tiles) {
        expect(t.pos).not.toEqual([2, 1]);
      }
    }
  });

  test('does not place duplicate tiles at the same position', () => {
    const p = tinyPuzzle({ constraints: { maxTiles: 50, maxCycles: 30 } });
    for (let i = 0; i < 30; i++) {
      const sol = generateRandomSolution(p, createPRNG('dup-' + i));
      const seen = new Set<string>();
      for (const t of sol.tiles) {
        const k = `${t.pos[0]},${t.pos[1]}`;
        expect(seen.has(k)).toBe(false);
        seen.add(k);
      }
    }
  });

  test('filter tiles receive a filterType from puzzle.filterTypes', () => {
    const p = tinyPuzzle({
      availableTiles: ['conveyor', 'filter'],
      filterTypes: ['alpha', 'beta'],
    });
    let sawFilter = false;
    for (let i = 0; i < 100; i++) {
      const sol = generateRandomSolution(p, createPRNG('filt-' + i));
      for (const t of sol.tiles) {
        if (t.kind === 'filter') {
          sawFilter = true;
          expect(t.filterType).toBeDefined();
          expect(['alpha', 'beta']).toContain(t.filterType);
        }
      }
    }
    expect(sawFilter).toBe(true);
  });

  test('reactor tiles receive a recipe from puzzle.reactorRecipes', () => {
    const recipe = { inputs: ['alpha', 'beta'], output: 'gamma' };
    const p = tinyPuzzle({
      availableTiles: ['conveyor', 'reactor'],
      reactorRecipes: [recipe],
    });
    let sawReactor = false;
    for (let i = 0; i < 100; i++) {
      const sol = generateRandomSolution(p, createPRNG('rx-' + i));
      for (const t of sol.tiles) {
        if (t.kind === 'reactor') {
          sawReactor = true;
          expect(t.recipe).toBeDefined();
          expect(t.recipe!.output).toBe('gamma');
        }
      }
    }
    expect(sawReactor).toBe(true);
  });
});

describe('generateRandomSolution — agent constraints', () => {
  const ap = tinyPuzzle({
    agents: [{ id: 'a1', startPos: [0, 0], maxOps: 4 }],
    availableOps: ['MOVE', 'GRAB', 'DROP', 'WAIT'],
  });

  test('agent path starts at startPos', () => {
    for (let i = 0; i < 30; i++) {
      const sol = generateRandomSolution(ap, createPRNG('path-' + i));
      const path = sol.paths['a1']!;
      expect(path[0]).toEqual([0, 0]);
    }
  });

  test('agent path step is to a neighbor (no diagonals)', () => {
    for (let i = 0; i < 30; i++) {
      const sol = generateRandomSolution(ap, createPRNG('step-' + i));
      const path = sol.paths['a1']!;
      for (let j = 1; j < path.length; j++) {
        const [px, py] = path[j - 1]!;
        const [cx, cy] = path[j]!;
        const dx = Math.abs(cx - px);
        const dy = Math.abs(cy - py);
        expect(dx + dy).toBeLessThanOrEqual(1); // staying or one-step
      }
    }
  });

  test('agent path stays inside the grid', () => {
    for (let i = 0; i < 30; i++) {
      const sol = generateRandomSolution(ap, createPRNG('inside-' + i));
      const path = sol.paths['a1']!;
      for (const [x, y] of path) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(ap.grid.w);
        expect(y).toBeLessThan(ap.grid.h);
      }
    }
  });

  test('agent program length is between 1 and maxOps', () => {
    for (let i = 0; i < 30; i++) {
      const sol = generateRandomSolution(ap, createPRNG('prog-' + i));
      const prog = sol.programs['a1']!;
      expect(prog.length).toBeGreaterThanOrEqual(1);
      expect(prog.length).toBeLessThanOrEqual(4);
    }
  });

  test('agent ops are drawn from availableOps', () => {
    for (let i = 0; i < 30; i++) {
      const sol = generateRandomSolution(ap, createPRNG('ops-' + i));
      const prog = sol.programs['a1']!;
      for (const op of prog) {
        expect(['MOVE', 'GRAB', 'DROP', 'WAIT', 'SENSE']).toContain(op.kind);
      }
    }
  });
});

describe('generateRandomSolution — determinism', () => {
  test('same seed → identical solution', () => {
    const p = tinyPuzzle();
    const a = generateRandomSolution(p, createPRNG('det'));
    const b = generateRandomSolution(p, createPRNG('det'));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test('different seeds → different solutions across many draws', () => {
    const p = tinyPuzzle({ constraints: { maxTiles: 6, maxCycles: 30 } });
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const s = generateRandomSolution(p, createPRNG('div-' + i));
      seen.add(JSON.stringify(s));
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});
