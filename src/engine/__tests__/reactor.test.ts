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

  test('no reaction when an input type is missing; cargo transports facing-ward instead', () => {
    const tile = reactor([3, 4], 'E', { inputs: ['alpha', 'beta'], output: 'gamma' });
    const world = makeWorld({ cargo: cargoMap({ '3,4': [cargo(1, 'alpha')] }) });
    // Reactor acts as a conveyor for unreacted cargo.
    expect(reactorIntents(tile, world)).toEqual([
      { kind: 'moveCargo', cargo: { id: 1, type: 'alpha' }, from: [3, 4], to: [4, 4] },
    ]);
  });

  test('consumes ONE set even if extras present; extras transport facing-ward', () => {
    const tile = reactor([3, 4], 'E', { inputs: ['alpha', 'beta'], output: 'gamma' });
    const world = makeWorld({
      cargo: cargoMap({
        '3,4': [cargo(1, 'alpha'), cargo(2, 'alpha'), cargo(3, 'beta')],
      }),
    });
    // 1 alpha (id=1) + 1 beta (id=3) consumed → gamma produced.
    // Alpha id=2 isn't consumed; it transports east.
    expect(reactorIntents(tile, world)).toEqual([
      { kind: 'consumeCargo', cargo: { id: 1, type: 'alpha' }, at: [3, 4] },
      { kind: 'consumeCargo', cargo: { id: 3, type: 'beta' }, at: [3, 4] },
      { kind: 'produceCargo', cargoType: 'gamma', at: [3, 4] },
      { kind: 'moveCargo', cargo: { id: 2, type: 'alpha' }, from: [3, 4], to: [4, 4] },
    ]);
  });

  test('selects lowest-id cargo per type (determinism)', () => {
    const tile = reactor([0, 0], 'N', { inputs: ['x'], output: 'y' });
    const world = makeWorld({
      cargo: cargoMap({ '0,0': [cargo(7, 'x'), cargo(3, 'x'), cargo(5, 'x')] }),
    });
    // Consumes id=3 (lowest). Produces y. id=5 and id=7 transport north (facing).
    expect(reactorIntents(tile, world)).toEqual([
      { kind: 'consumeCargo', cargo: { id: 3, type: 'x' }, at: [0, 0] },
      { kind: 'produceCargo', cargoType: 'y', at: [0, 0] },
      { kind: 'moveCargo', cargo: { id: 5, type: 'x' }, from: [0, 0], to: [0, -1] },
      { kind: 'moveCargo', cargo: { id: 7, type: 'x' }, from: [0, 0], to: [0, -1] },
    ]);
  });

  test('recipe with duplicate input types requires that many cargo of the type', () => {
    const tile = reactor([0, 0], 'E', { inputs: ['alpha', 'alpha'], output: 'beta' });
    // 1 alpha → no reaction; the cargo transports east.
    let world = makeWorld({ cargo: cargoMap({ '0,0': [cargo(1, 'alpha')] }) });
    expect(reactorIntents(tile, world)).toEqual([
      { kind: 'moveCargo', cargo: { id: 1, type: 'alpha' }, from: [0, 0], to: [1, 0] },
    ]);
    // 2 alpha → consumes both (lowest ids first).
    world = makeWorld({
      cargo: cargoMap({ '0,0': [cargo(4, 'alpha'), cargo(2, 'alpha'), cargo(9, 'alpha')] }),
    });
    // Consumes ids 2 and 4 → produces beta. id=9 transports east.
    expect(reactorIntents(tile, world)).toEqual([
      { kind: 'consumeCargo', cargo: { id: 2, type: 'alpha' }, at: [0, 0] },
      { kind: 'consumeCargo', cargo: { id: 4, type: 'alpha' }, at: [0, 0] },
      { kind: 'produceCargo', cargoType: 'beta', at: [0, 0] },
      { kind: 'moveCargo', cargo: { id: 9, type: 'alpha' }, from: [0, 0], to: [1, 0] },
    ]);
  });

  test('non-input cargo on cell is transported even while reacting', () => {
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
      // Pre-existing gamma id=3 transports east this cycle.
      { kind: 'moveCargo', cargo: { id: 3, type: 'gamma' }, from: [3, 4], to: [4, 4] },
    ]);
  });

  test('empty cell emits no intents', () => {
    const tile = reactor([3, 4], 'E', { inputs: ['alpha'], output: 'beta' });
    expect(reactorIntents(tile, makeWorld())).toEqual([]);
  });

  test('reactor without a recipe field emits no intents (defensive)', () => {
    const tile = reactor([3, 4], 'E', { inputs: [], output: '' });
    const { recipe: _omitted, ...broken } = tile;
    void _omitted;
    const world = makeWorld({ cargo: cargoMap({ '3,4': [cargo(1, 'alpha')] }) });
    expect(reactorIntents(broken, world)).toEqual([]);
  });
});
