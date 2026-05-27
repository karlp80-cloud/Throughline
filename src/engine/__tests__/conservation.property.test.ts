/**
 * Cargo conservation property test.
 *
 * Per engine memo §6 the invariant is:
 *   onTiles + carried + delivered
 *     == cumulativeEmissions - reactorConsumed + reactorProduced
 *
 * This MUST hold at every cycle, for any valid puzzle + solution.
 * Property test generates 200 arbitrary scenarios and asserts the
 * invariant per cycle for up to 25 cycles each.
 *
 * If this test ever fails, a Phase B intent-application step is
 * dropping or duplicating cargo. The seed printed in the failure
 * lets a developer reproduce locally.
 */

import * as fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { initialWorld } from '../run';
import { stepOnce } from '../step';
import type { WorldState } from '../types';
import { buildScenario, scenarioSpecArb } from './genArbitrary';

function totalCargo(world: WorldState): number {
  let onTiles = 0;
  for (const arr of Object.values(world.cargoOnTiles)) onTiles += arr.length;
  let carried = 0;
  for (const a of Object.values(world.agents)) if (a.carrying !== null) carried += 1;
  let delivered = 0;
  for (const n of Object.values(world.deliveredCounts)) delivered += n;
  return onTiles + carried + delivered;
}

function netEmissions(world: WorldState): number {
  return (
    world.cumulativeEmissions - world.cumulativeReactorConsumed + world.cumulativeReactorProduced
  );
}

describe('conservation property', () => {
  test('invariant holds every cycle for arbitrary scenarios', () => {
    fc.assert(
      fc.property(scenarioSpecArb, (spec) => {
        const { puzzle, solution } = buildScenario(spec);
        let world = initialWorld(puzzle);
        // Invariant must hold at start.
        if (totalCargo(world) !== netEmissions(world)) return false;
        for (let i = 0; i < 25; i++) {
          const r = stepOnce(puzzle, solution, world);
          world = r.world;
          if (totalCargo(world) !== netEmissions(world)) return false;
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });

  test('edge cases — agents.length === 0', () => {
    const { puzzle, solution } = buildScenario({
      w: 4,
      h: 2,
      inputCount: 1,
      outputCount: 1,
      agentCount: 0,
      tileCount: 2,
      rate: 1,
      emitsType: 'alpha',
      outputType: 'alpha',
      tileSlots: [
        ['conveyor', 'E', 'alpha'],
        ['conveyor', 'E', 'alpha'],
      ],
      agentPrograms: [],
    });
    let world = initialWorld(puzzle);
    for (let i = 0; i < 10; i++) {
      world = stepOnce(puzzle, solution, world).world;
      expect(totalCargo(world)).toBe(netEmissions(world));
    }
  });

  test('edge cases — grid 2×2 minimal', () => {
    const { puzzle, solution } = buildScenario({
      w: 3,
      h: 2,
      inputCount: 1,
      outputCount: 1,
      agentCount: 1,
      tileCount: 1,
      rate: 1,
      emitsType: 'alpha',
      outputType: 'alpha',
      tileSlots: [['conveyor', 'E', 'alpha']],
      agentPrograms: [[{ kind: 'WAIT' }]],
    });
    let world = initialWorld(puzzle);
    for (let i = 0; i < 10; i++) {
      world = stepOnce(puzzle, solution, world).world;
      expect(totalCargo(world)).toBe(netEmissions(world));
    }
  });

  test('edge case — agent program of length 0 (defensive; engine must not crash)', () => {
    // The schema rejects empty programs upstream; the engine treats it
    // as an implicit WAIT and continues. This test bypasses the helper
    // builder to construct the empty-program puzzle directly.
    const puzzle = buildScenario({
      w: 3,
      h: 2,
      inputCount: 1,
      outputCount: 1,
      agentCount: 1,
      tileCount: 0,
      rate: 1,
      emitsType: 'alpha',
      outputType: 'alpha',
      tileSlots: [],
      agentPrograms: [[]], // empty program
    }).puzzle;
    const solution = {
      tiles: [],
      paths: { a0: [puzzle.agents[0]!.startPos] },
      programs: { a0: [] },
    };
    let world = initialWorld(puzzle);
    for (let i = 0; i < 5; i++) {
      world = stepOnce(puzzle, solution, world).world;
      expect(totalCargo(world)).toBe(netEmissions(world));
    }
  });

  test('edge case — agent startPos overlaps the input cell', () => {
    // buildScenario places inputs at the first cells and agents in the
    // "middle". To force overlap we hand-craft the puzzle so the agent
    // starts on the input.
    const puzzle = {
      id: 'overlap',
      grid: { w: 3, h: 1 },
      inputs: [{ pos: [0, 0] as const, emits: ['alpha'], rate: 1 }],
      outputs: [{ pos: [2, 0] as const, required: [{ type: 'alpha', count: 99 }] }],
      agents: [{ id: 'a0', startPos: [0, 0] as const, maxOps: 8 }],
      obstacles: [],
      availableTiles: ['conveyor' as const],
      availableOps: [
        'MOVE' as const,
        'GRAB' as const,
        'DROP' as const,
        'WAIT' as const,
        'SENSE' as const,
      ],
      constraints: { maxTiles: 4, maxCycles: 30 },
      optionalChallenges: [],
    };
    const solution = {
      tiles: [],
      paths: { a0: [[0, 0] as const] },
      programs: { a0: [{ kind: 'GRAB' as const }] },
    };
    let world = initialWorld(puzzle);
    for (let i = 0; i < 5; i++) {
      world = stepOnce(puzzle, solution, world).world;
      expect(totalCargo(world)).toBe(netEmissions(world));
    }
  });

  test('edge case — grid 1×1 with input==output==agent (degenerate)', () => {
    const puzzle = {
      id: '1x1',
      grid: { w: 1, h: 1 },
      inputs: [{ pos: [0, 0] as const, emits: ['alpha'], rate: 1 }],
      outputs: [{ pos: [0, 0] as const, required: [{ type: 'alpha', count: 2 }] }],
      agents: [{ id: 'a0', startPos: [0, 0] as const, maxOps: 4 }],
      obstacles: [],
      availableTiles: [] as const,
      availableOps: ['WAIT' as const],
      constraints: { maxTiles: 0, maxCycles: 10 },
      optionalChallenges: [],
    };
    const solution = {
      tiles: [],
      paths: { a0: [[0, 0] as const] },
      programs: { a0: [{ kind: 'WAIT' as const }] },
    };
    let world = initialWorld(puzzle);
    for (let i = 0; i < 5; i++) {
      world = stepOnce(puzzle, solution, world).world;
      expect(totalCargo(world)).toBe(netEmissions(world));
    }
  });

  test('edge case — agent program is just WAIT (effective deadlock)', () => {
    const { puzzle, solution } = buildScenario({
      w: 4,
      h: 2,
      inputCount: 1,
      outputCount: 1,
      agentCount: 1,
      tileCount: 0,
      rate: 2,
      emitsType: 'alpha',
      outputType: 'alpha',
      tileSlots: [],
      agentPrograms: [[{ kind: 'WAIT' }, { kind: 'WAIT' }]],
    });
    let world = initialWorld(puzzle);
    for (let i = 0; i < 15; i++) {
      world = stepOnce(puzzle, solution, world).world;
      expect(totalCargo(world)).toBe(netEmissions(world));
    }
  });
});
