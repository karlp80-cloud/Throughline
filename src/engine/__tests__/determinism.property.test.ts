/**
 * Determinism property test.
 *
 * Per engine memo §10: given identical (puzzle, solution), two engine
 * runs must produce identical CycleTrace arrays. Compared via a
 * canonical-stringify (sorted keys) to immunize against any chance
 * difference in JS key insertion order.
 *
 * Reviewer note: a deliberate use of Math.random or Date.now in any
 * engine module would surface here. The property is the engine's
 * single most load-bearing invariant after conservation.
 */

import * as fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { initialWorld } from '../run';
import { stepOnce } from '../step';
import type { CycleTrace } from '../types';
import { buildScenario, scenarioSpecArb } from './genArbitrary';

function canonicalStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalStringify).join(',') + ']';
  const keys = Object.keys(v as object).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + canonicalStringify((v as Record<string, unknown>)[k]))
      .join(',') +
    '}'
  );
}

function runTrace(
  puzzle: ReturnType<typeof buildScenario>['puzzle'],
  solution: ReturnType<typeof buildScenario>['solution'],
): CycleTrace[] {
  const trace: CycleTrace[] = [];
  let world = initialWorld(puzzle);
  for (let i = 0; i < 25; i++) {
    const r = stepOnce(puzzle, solution, world);
    trace.push(r.trace);
    world = r.world;
  }
  return trace;
}

describe('determinism property', () => {
  test('identical inputs produce byte-identical (canonical) traces', () => {
    fc.assert(
      fc.property(scenarioSpecArb, (spec) => {
        const { puzzle, solution } = buildScenario(spec);
        const t1 = runTrace(puzzle, solution);
        const t2 = runTrace(puzzle, solution);
        return canonicalStringify(t1) === canonicalStringify(t2);
      }),
      { numRuns: 200 },
    );
  });

  test('the same scenario re-built from the spec also produces an identical trace', () => {
    // Sanity: buildScenario itself is deterministic in its spec.
    const spec = {
      w: 5,
      h: 3,
      inputCount: 2,
      outputCount: 1,
      agentCount: 1,
      tileCount: 3,
      rate: 2,
      emitsType: 'alpha' as const,
      outputType: 'alpha' as const,
      tileSlots: [
        ['conveyor', 'E', 'alpha'] as const,
        ['splitter', 'E', 'alpha'] as const,
        ['filter', 'S', 'alpha'] as const,
      ],
      agentPrograms: [[{ kind: 'MOVE' } as const, { kind: 'GRAB' } as const]],
    };
    const a = buildScenario(spec);
    const b = buildScenario(spec);
    const ta = runTrace(a.puzzle, a.solution);
    const tb = runTrace(b.puzzle, b.solution);
    expect(canonicalStringify(ta)).toBe(canonicalStringify(tb));
  });
});
