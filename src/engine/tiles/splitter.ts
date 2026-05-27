/**
 * Splitter tile.
 *
 * Sends cargo alternately down its two perpendicular outputs. The
 * alternation is **per cargo**, not per cycle: the first cargo on
 * the cell this cycle goes to perpendicular[0], the second to
 * perpendicular[1], the third back to perpendicular[0], etc. After
 * processing, a `flipSplitter` intent records the direction the next
 * arriving cargo (in a future cycle) should go.
 *
 * The current "next out" direction lives in `WorldState.tileState`,
 * which Phase B updates from `flipSplitter` intents.
 */

import type { Direction, PlacedTile, TileIntent, WorldState } from '../types';
import { neighbor, perpendiculars, posKey } from '../types';

export function splitterIntents(tile: PlacedTile, world: WorldState): readonly TileIntent[] {
  const key = posKey(tile.pos);
  const cargoHere = world.cargoOnTiles[key];
  if (!cargoHere || cargoHere.length === 0) return [];

  const [first, second] = perpendiculars(tile.facing);
  const startDir: Direction = world.tileState[key]?.splitterNextOut ?? first;
  // toggleFrom: given a direction, return the other one
  const toggle = (d: Direction): Direction => (d === first ? second : first);

  const sorted = cargoHere.slice().sort((a, b) => a.id - b.id);
  const intents: TileIntent[] = [];
  let dir = startDir;
  for (const c of sorted) {
    intents.push({ kind: 'moveCargo', cargo: c, from: tile.pos, to: neighbor(tile.pos, dir) });
    dir = toggle(dir);
  }
  // After this cycle's cargo, `dir` is the direction the NEXT arrival
  // should use — record it in a flipSplitter intent.
  intents.push({ kind: 'flipSplitter', at: tile.pos, nextOut: dir });
  return intents;
}
