/**
 * Reactor tile.
 *
 * Consumes one full set of recipe inputs from its cell and produces
 * one output cargo at the same cell. Per the user's choice on memo
 * §11 Q8 (option a): consumes exactly ONE set per cycle even if
 * extras are present; leftover cargo stays on the cell.
 *
 * Does NOT transport — produced cargo sits at-cell until something
 * else moves it. Players place an adjacent conveyor to route output.
 * This keeps reaction and transport orthogonal, simpler than the
 * dual conveyor/reactor model originally sketched in the memo §5.
 *
 * Determinism: when multiple cargo of an input type are present,
 * the lowest-id ones are consumed first.
 */

import type { CargoInstance, CargoType, PlacedTile, TileIntent, WorldState } from '../types';
import { posKey } from '../types';

export function reactorIntents(tile: PlacedTile, world: WorldState): readonly TileIntent[] {
  const recipe = tile.recipe;
  if (!recipe || recipe.inputs.length === 0) return [];
  const cargoHere = world.cargoOnTiles[posKey(tile.pos)];
  if (!cargoHere || cargoHere.length === 0) return [];

  // Required count per input type.
  const required = new Map<CargoType, number>();
  for (const t of recipe.inputs) {
    required.set(t, (required.get(t) ?? 0) + 1);
  }

  // Sort cargo by id so we deterministically pick the lowest-id cargo per type.
  const sorted = cargoHere.slice().sort((a, b) => a.id - b.id);

  // Walk sorted cargo, picking up to `required[type]` of each type.
  const taken: CargoInstance[] = [];
  const remaining = new Map(required);
  for (const c of sorted) {
    const need = remaining.get(c.type) ?? 0;
    if (need > 0) {
      taken.push(c);
      remaining.set(c.type, need - 1);
    }
  }

  // Check all input requirements satisfied.
  for (const need of remaining.values()) {
    if (need > 0) return [];
  }

  const intents: TileIntent[] = taken.map((c) => ({
    kind: 'consumeCargo' as const,
    cargo: c,
    at: tile.pos,
  }));
  intents.push({ kind: 'produceCargo', cargoType: recipe.output, at: tile.pos });
  return intents;
}
