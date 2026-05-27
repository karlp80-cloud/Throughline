/**
 * Conveyor tile.
 *
 * Declares an intent to move EVERY cargo on its cell one step in its
 * facing direction. Cargo is yielded in ascending order by id, which
 * keeps multi-cargo iteration deterministic.
 *
 * Per engine.md §4.1: destination-validity (out of grid, obstacles)
 * is NOT checked here — Phase B of the cycle pipeline filters intents
 * before applying them.
 */

import type { PlacedTile, TileIntent, WorldState } from '../types';
import { neighbor, posKey } from '../types';

export function conveyorIntents(tile: PlacedTile, world: WorldState): readonly TileIntent[] {
  const cargoHere = world.cargoOnTiles[posKey(tile.pos)];
  if (!cargoHere || cargoHere.length === 0) return [];
  const to = neighbor(tile.pos, tile.facing);
  return cargoHere
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((c) => ({ kind: 'moveCargo' as const, cargo: c, from: tile.pos, to }));
}
