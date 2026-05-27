import { describe, expect, test } from 'vitest';
import { reactorIntents } from '../tiles/reactor';
import { cargo, cargoMap, makeWorld, reactor } from './helpers';

describe('reactor', () => {
  test('consumes recipe inputs and produces output at-cell when inputs present', () => {
    const tile = reactor([3, 4], 'E', { inputs: ['alpha', 'beta'], output: 'gamma' });
    const world = makeWorld({
      cargo: cargoMap({ '3,4': [cargo(1, 'alpha'), cargo(2, 'beta')] }),
    });
    expect(reactorIntents(tile, world)).toEqual([
      { kind: 'consumeCargo', cargo: { id: 1, type: 'alpha' }, at: [3, 4] },
      { kind: 'consumeCargo', cargo: { id: 2, type: 'beta' }, at: [3, 4] },
      { kind: 'produceCargo', cargoType: 'gamma', at: [3, 4] },
    ]);
  });

  test('no reaction when an input type is missing', () => {
    const tile = reactor([3, 4], 'E', { inputs: ['alpha', 'beta'], output: 'gamma' });
    const world = makeWorld({ cargo: cargoMap({ '3,4': [cargo(1, 'alpha')] }) });
    expect(reactorIntents(tile, world)).toEqual([]);
  });

  test('consumes ONE set even if extras present; leftover stays (per memo Q8a)', () => {
    const tile = reactor([3, 4], 'E', { inputs: ['alpha', 'beta'], output: 'gamma' });
    const world = makeWorld({
      cargo: cargoMap({
        '3,4': [cargo(1, 'alpha'), cargo(2, 'alpha'), cargo(3, 'beta')],
      }),
    });
    // Only 1 alpha + 1 beta consumed; alpha id=2 stays on cell.
    expect(reactorIntents(tile, world)).toEqual([
      { kind: 'consumeCargo', cargo: { id: 1, type: 'alpha' }, at: [3, 4] },
      { kind: 'consumeCargo', cargo: { id: 3, type: 'beta' }, at: [3, 4] },
      { kind: 'produceCargo', cargoType: 'gamma', at: [3, 4] },
    ]);
  });

  test('selects lowest-id cargo per type (determinism)', () => {
    const tile = reactor([0, 0], 'N', { inputs: ['x'], output: 'y' });
    const world = makeWorld({
      cargo: cargoMap({ '0,0': [cargo(7, 'x'), cargo(3, 'x'), cargo(5, 'x')] }),
    });
    expect(reactorIntents(tile, world)).toEqual([
      { kind: 'consumeCargo', cargo: { id: 3, type: 'x' }, at: [0, 0] },
      { kind: 'produceCargo', cargoType: 'y', at: [0, 0] },
    ]);
  });

  test('recipe with duplicate input types requires that many cargo of the type', () => {
    const tile = reactor([0, 0], 'E', { inputs: ['alpha', 'alpha'], output: 'beta' });
    // 1 alpha → no reaction
    let world = makeWorld({ cargo: cargoMap({ '0,0': [cargo(1, 'alpha')] }) });
    expect(reactorIntents(tile, world)).toEqual([]);
    // 2 alpha → consumes both (lowest ids first)
    world = makeWorld({
      cargo: cargoMap({ '0,0': [cargo(4, 'alpha'), cargo(2, 'alpha'), cargo(9, 'alpha')] }),
    });
    expect(reactorIntents(tile, world)).toEqual([
      { kind: 'consumeCargo', cargo: { id: 2, type: 'alpha' }, at: [0, 0] },
      { kind: 'consumeCargo', cargo: { id: 4, type: 'alpha' }, at: [0, 0] },
      { kind: 'produceCargo', cargoType: 'beta', at: [0, 0] },
    ]);
  });

  test('output already on cell does not block reaction (just produces another)', () => {
    const tile = reactor([3, 4], 'E', { inputs: ['alpha', 'beta'], output: 'gamma' });
    const world = makeWorld({
      cargo: cargoMap({
        '3,4': [cargo(1, 'alpha'), cargo(2, 'beta'), cargo(3, 'gamma')],
      }),
    });
    expect(reactorIntents(tile, world)).toEqual([
      { kind: 'consumeCargo', cargo: { id: 1, type: 'alpha' }, at: [3, 4] },
      { kind: 'consumeCargo', cargo: { id: 2, type: 'beta' }, at: [3, 4] },
      { kind: 'produceCargo', cargoType: 'gamma', at: [3, 4] },
    ]);
  });

  test('empty cell emits no intents', () => {
    const tile = reactor([3, 4], 'E', { inputs: ['alpha'], output: 'beta' });
    expect(reactorIntents(tile, makeWorld())).toEqual([]);
  });

  test('reactor without a recipe field emits no intents (defensive)', () => {
    const tile = reactor([3, 4], 'E', { inputs: [], output: '' });
    // Strip `recipe` cleanly so the resulting object is `PlacedTile` shaped
    // under exactOptionalPropertyTypes (no `recipe: undefined` field).
    const { recipe: _omitted, ...broken } = tile;
    void _omitted;
    const world = makeWorld({ cargo: cargoMap({ '3,4': [cargo(1, 'alpha')] }) });
    expect(reactorIntents(broken, world)).toEqual([]);
  });
});
