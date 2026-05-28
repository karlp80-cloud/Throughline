/**
 * Reference solutions for the bundled sample campaigns under
 * `campaigns/samples/`. Used by `src/campaign/__tests__/samples.test.ts`
 * to assert every sample puzzle is solvable within its declared
 * `max_cycles`. Without this guarantee the no-`claude` fallback would
 * be a foot-gun for fresh installs.
 *
 * Shape mirrors `campaigns/tutorial.solutions.ts` (same `sol`/`conv`
 * helpers; just nested under a campaign name).
 */

import type { Op, PlacedTile, Pos, Solution } from '../../src/engine';

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

export const SAMPLE_SOLUTIONS: Readonly<Record<string, Readonly<Record<string, Solution>>>> = {
  // ─── Lighthouse Keepers ────────────────────────────────────────────
  'lighthouse-keepers': {
    // 5×1 strip: input (0,0) E → output (4,0). 3 conveyors carry oil.
    p1_first_light: sol([conv([1, 0], 'E'), conv([2, 0], 'E'), conv([3, 0], 'E')]),

    // 5×3: input (0,1) → splitter at (2,1) alternates N/S. Two
    // conveyors out each arm to the (4,0) and (4,2) outputs.
    p2_two_wicks: sol([
      conv([1, 1], 'E'),
      split([2, 1], 'E'),
      conv([2, 0], 'E'),
      conv([3, 0], 'E'),
      conv([2, 2], 'E'),
      conv([3, 2], 'E'),
    ]),

    // 6×3: filter at (2,1) passes oil, blocks brine. 4 conveyors flank.
    p3_the_filter_grate: sol([
      conv([1, 1], 'E'),
      filt([2, 1], 'E', 'oil'),
      conv([3, 1], 'E'),
      conv([4, 1], 'E'),
    ]),
  },

  // ─── Switchyard ────────────────────────────────────────────────────
  switchyard: {
    // 4×1 strip: 2 conveyors carry boxcars E. opt_lean=≤2 challenge passes.
    p1_the_lead: sol([conv([1, 0], 'E'), conv([2, 0], 'E')]),

    // 6×3: filter at (2,1) passes boxcar, blocks gondola.
    p2_classification: sol([
      conv([1, 1], 'E'),
      filt([2, 1], 'E', 'boxcar'),
      conv([3, 1], 'E'),
      conv([4, 1], 'E'),
    ]),

    // 4×1: no tiles allowed. Switchman walks a 6-cell loop, GRAB at
    // (0,0) → MOVE×3 east → DROP at (3,0) → MOVE×3 west. Same shape as
    // tutorial p3_two_hands; 2 boxcars delivered within 40 cycles.
    p3_handheld_coupling: sol(
      [],
      {
        swm: [
          [0, 0],
          [1, 0],
          [2, 0],
          [3, 0],
          [2, 0],
          [1, 0],
        ],
      },
      {
        swm: [
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

    // 6×3: two leads (rows 0 and 2) merge at (3,1) → conveyor E → output.
    p4_the_yard: sol([
      conv([1, 0], 'E'),
      conv([2, 0], 'E'),
      conv([3, 0], 'S'),
      conv([1, 2], 'E'),
      conv([2, 2], 'E'),
      conv([3, 2], 'N'),
      merge([3, 1], 'E'),
      conv([4, 1], 'E'),
    ]),
  },

  // ─── Atrium Garden ─────────────────────────────────────────────────
  'atrium-garden': {
    // 5×1: 3 conveyors carry seedlings E.
    p1_first_bed: sol([conv([1, 0], 'E'), conv([2, 0], 'E'), conv([3, 0], 'E')]),

    // 5×3: splitter at (2,1) alternates N/S to two beds.
    p2_dividing_beds: sol([
      conv([1, 1], 'E'),
      split([2, 1], 'E'),
      conv([2, 0], 'E'),
      conv([3, 0], 'E'),
      conv([2, 2], 'E'),
      conv([3, 2], 'E'),
    ]),

    // 7×4: rootstock (row 1) + scion (row 3) → reactor at (4,2) → graft
    // → output (6,2). Agent at (3,0) stays put (path of length 1, WAIT).
    p3_the_grafting_table: sol(
      [
        conv([1, 1], 'E'),
        conv([2, 1], 'E'),
        conv([3, 1], 'E'),
        conv([4, 1], 'S'),
        conv([1, 3], 'E'),
        conv([2, 3], 'E'),
        conv([3, 3], 'E'),
        conv([4, 3], 'N'),
        react([4, 2], 'E', ['rootstock', 'scion'], 'graft'),
        conv([5, 2], 'E'),
      ],
      { g1: [[3, 0]] },
      { g1: [{ kind: 'WAIT' }] },
    ),
  },
};
