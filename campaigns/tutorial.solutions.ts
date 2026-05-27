/**
 * Reference solutions for the tutorial campaign, in engine form
 * (camelCase). Used by `e2e/tutorial.spec.ts` to drive a scripted
 * playthrough and by a unit test that asserts each reference
 * solution actually reports victory.
 */

import type { Op, PlacedTile, Pos, Solution } from '../src/engine';

const conv = (pos: Pos, facing: 'N' | 'E' | 'S' | 'W'): PlacedTile => ({
  pos,
  kind: 'conveyor',
  facing,
});
const split = (pos: Pos, facing: 'N' | 'E' | 'S' | 'W'): PlacedTile => ({
  pos,
  kind: 'splitter',
  facing,
});
const merge = (pos: Pos, facing: 'N' | 'E' | 'S' | 'W'): PlacedTile => ({
  pos,
  kind: 'merger',
  facing,
});
const filt = (pos: Pos, facing: 'N' | 'E' | 'S' | 'W', filterType: string): PlacedTile => ({
  pos,
  kind: 'filter',
  facing,
  filterType,
});
const react = (
  pos: Pos,
  facing: 'N' | 'E' | 'S' | 'W',
  inputs: string[],
  output: string,
): PlacedTile => ({ pos, kind: 'reactor', facing, recipe: { inputs, output } });

const sol = (
  tiles: PlacedTile[],
  paths: Record<string, readonly Pos[]> = {},
  programs: Record<string, readonly Op[]> = {},
): Solution => ({ tiles, paths, programs });

export const TUTORIAL_SOLUTIONS: Readonly<Record<string, Solution>> = {
  // P1: four conveyors carrying alpha left-to-right.
  p1_first_flow: sol([conv([0, 1], 'E'), conv([1, 1], 'E'), conv([2, 1], 'E'), conv([3, 1], 'E')]),

  // P2: splitter at (2,1) fans N/S; rails out to (4,0) and (4,2).
  p2_branching: sol([
    conv([0, 1], 'E'),
    conv([1, 1], 'E'),
    split([2, 1], 'E'),
    conv([2, 0], 'E'),
    conv([3, 0], 'E'),
    conv([2, 2], 'E'),
    conv([3, 2], 'E'),
  ]),

  // P3: agent walks 0→1→2→3→2→1, GRAB at start, DROP at far end.
  // Path length = 6, program has 6 MOVEs → pathIndex resets each loop.
  p3_two_hands: sol(
    [],
    {
      a1: [
        [0, 0],
        [1, 0],
        [2, 0],
        [3, 0],
        [2, 0],
        [1, 0],
      ],
    },
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

  // P4: filter passes alpha, blocks beta.
  p4_sorters_eye: sol([
    conv([0, 1], 'E'),
    conv([1, 1], 'E'),
    filt([2, 1], 'E', 'alpha'),
    conv([3, 1], 'E'),
    conv([4, 1], 'E'),
  ]),

  // P5: two streams converge into a single merger.
  p5_confluence: sol([
    conv([0, 0], 'E'),
    conv([1, 0], 'S'),
    conv([0, 2], 'E'),
    conv([1, 2], 'N'),
    merge([1, 1], 'E'),
    conv([2, 1], 'E'),
    conv([3, 1], 'E'),
    conv([4, 1], 'E'),
  ]),

  // P6: graduation — both streams to a reactor at (3,2), output east.
  p6_graduation: sol(
    [
      conv([0, 1], 'E'),
      conv([1, 1], 'E'),
      conv([2, 1], 'E'),
      conv([3, 1], 'S'),
      conv([0, 3], 'E'),
      conv([1, 3], 'E'),
      conv([2, 3], 'E'),
      conv([3, 3], 'N'),
      react([3, 2], 'E', ['alpha', 'beta'], 'gamma'),
      conv([4, 2], 'E'),
      conv([5, 2], 'E'),
    ],
    { a1: [[3, 0]] },
    { a1: [{ kind: 'WAIT' }] },
  ),
};
