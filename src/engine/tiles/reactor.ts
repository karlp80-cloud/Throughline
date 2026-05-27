/**
 * Reactor tile (dual behavior).
 *
 * On each cycle the reactor does TWO things:
 *
 *  1. If the multiset of cargo on its cell ⊇ recipe.inputs, declare
 *     consumeCargo intents for one set of inputs (lowest-id per type)
 *     plus a produceCargo intent for the output AT-CELL. Per memo
 *     Q8 (a) only ONE set is consumed per cycle even when extras
 *     are present.
 *
 *  2. For every cargo NOT being consumed this cycle, declare a
 *     moveCargo intent in the facing direction — i.e. the reactor
 *     also acts as a conveyor for non-recipe cargo. This is what
 *     makes pipelines like `input → conveyor → reactor → conveyor
 *     → output` work: the gamma produced at-cell this cycle sits
 *     for one cycle, then transports out facing-ward next cycle.
 *
 * Without the dual behavior, a reactor placed inline with conveyors
 * would trap its own output forever — the cell is occupied by the
 * reactor tile, so no other transport tile can sit there.
 *
 * Determinism: cargo iterated by ascending id; recipe consumption
 * picks lowest-id cargo per input type.
 */

import type { CargoInstance, CargoType, PlacedTile, TileIntent, WorldState } from '../types';
import { neighbor, posKey } from '../types';

export function reactorIntents(tile: PlacedTile, world: WorldState): readonly TileIntent[] {
  const recipe = tile.recipe;
  if (!recipe) return [];
  const cargoHere = world.cargoOnTiles[posKey(tile.pos)];
  if (!cargoHere || cargoHere.length === 0) return [];

  const sorted = cargoHere.slice().sort((a, b) => a.id - b.id);

  // ─── Try to react ───────────────────────────────────────────────
  const consumed: CargoInstance[] = [];
  if (recipe.inputs.length > 0) {
    const required = new Map<CargoType, number>();
    for (const t of recipe.inputs) required.set(t, (required.get(t) ?? 0) + 1);
    for (const c of sorted) {
      const need = required.get(c.type) ?? 0;
      if (need > 0) {
        consumed.push(c);
        required.set(c.type, need - 1);
      }
    }
    // If not all input requirements satisfied, abort the reaction.
    let satisfied = true;
    for (const need of required.values()) {
      if (need > 0) {
        satisfied = false;
        break;
      }
    }
    if (!satisfied) consumed.length = 0;
  }

  const intents: TileIntent[] = [];
  const consumedIds = new Set(consumed.map((c) => c.id));

  // Reaction intents
  for (const c of consumed) {
    intents.push({ kind: 'consumeCargo', cargo: c, at: tile.pos });
  }
  if (consumed.length > 0) {
    intents.push({ kind: 'produceCargo', cargoType: recipe.output, at: tile.pos });
  }

  // Conveyor-like transport intents for non-consumed cargo
  const to = neighbor(tile.pos, tile.facing);
  for (const c of sorted) {
    if (consumedIds.has(c.id)) continue;
    intents.push({ kind: 'moveCargo', cargo: c, from: tile.pos, to });
  }

  return intents;
}
