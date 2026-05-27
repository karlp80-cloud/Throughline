/**
 * Filter tile.
 *
 * Cargo whose `type` matches `tile.filterType` moves one step in the
 * facing direction. Cargo of any other type stays on the cell —
 * the filter does NOT despawn them; it blocks them.
 *
 * Iteration is by cargo id for determinism. A filter without a
 * `filterType` field is a load-time validation error (caught by Phase 7
 * Zod schema); here we defensively treat it as "matches nothing".
 */

import type { PlacedTile, TileIntent, WorldState } from '../types';
import { neighbor, posKey } from '../types';

export function filterIntents(tile: PlacedTile, world: WorldState): readonly TileIntent[] {
  const cargoHere = world.cargoOnTiles[posKey(tile.pos)];
  if (!cargoHere || cargoHere.length === 0) return [];
  const allowed = tile.filterType;
  if (!allowed) return [];
  const to = neighbor(tile.pos, tile.facing);
  return cargoHere
    .slice()
    .sort((a, b) => a.id - b.id)
    .filter((c) => c.type === allowed)
    .map((c) => ({ kind: 'moveCargo' as const, cargo: c, from: tile.pos, to }));
}
