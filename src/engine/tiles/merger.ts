/**
 * Merger tile.
 *
 * Passive: cargo arrives via neighbors' own transport declarations
 * (a conveyor or splitter pointing into the merger). The merger's
 * only job is to send whatever lands on its cell out in the facing
 * direction. Functionally equivalent to a conveyor today; lives in
 * its own module for future divergence (e.g. preserving "merged"
 * metadata) and for renderer/editor classification.
 */

import type { PlacedTile, TileIntent, WorldState } from '../types';
import { neighbor, posKey } from '../types';

export function mergerIntents(tile: PlacedTile, world: WorldState): readonly TileIntent[] {
  const cargoHere = world.cargoOnTiles[posKey(tile.pos)];
  if (!cargoHere || cargoHere.length === 0) return [];
  const to = neighbor(tile.pos, tile.facing);
  return cargoHere
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((c) => ({ kind: 'moveCargo' as const, cargo: c, from: tile.pos, to }));
}
