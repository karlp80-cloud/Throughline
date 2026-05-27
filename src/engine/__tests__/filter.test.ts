import { describe, expect, test } from 'vitest';
import { filterIntents } from '../tiles/filter';
import { cargo, cargoMap, filter, makeWorld } from './helpers';

describe('filter', () => {
  test('cargo of the allowed type moves in the facing direction', () => {
    const tile = filter([3, 4], 'E', 'alpha');
    const world = makeWorld({ cargo: cargoMap({ '3,4': [cargo(1, 'alpha')] }) });
    expect(filterIntents(tile, world)).toEqual([
      { kind: 'moveCargo', cargo: { id: 1, type: 'alpha' }, from: [3, 4], to: [4, 4] },
    ]);
  });

  test('cargo of a different type stays (no intent emitted)', () => {
    const tile = filter([3, 4], 'E', 'alpha');
    const world = makeWorld({ cargo: cargoMap({ '3,4': [cargo(1, 'beta')] }) });
    expect(filterIntents(tile, world)).toEqual([]);
  });

  test('mixed cargo: matching ones move, others stay', () => {
    const tile = filter([3, 4], 'E', 'alpha');
    const world = makeWorld({
      cargo: cargoMap({
        '3,4': [cargo(1, 'alpha'), cargo(2, 'beta'), cargo(3, 'alpha'), cargo(4, 'gamma')],
      }),
    });
    expect(filterIntents(tile, world)).toEqual([
      { kind: 'moveCargo', cargo: { id: 1, type: 'alpha' }, from: [3, 4], to: [4, 4] },
      { kind: 'moveCargo', cargo: { id: 3, type: 'alpha' }, from: [3, 4], to: [4, 4] },
    ]);
  });

  test('empty cell emits no intents', () => {
    const tile = filter([3, 4], 'E', 'alpha');
    expect(filterIntents(tile, makeWorld())).toEqual([]);
  });

  test('matching cargo iterated by id (determinism)', () => {
    const tile = filter([0, 0], 'S', 'alpha');
    const world = makeWorld({
      cargo: cargoMap({ '0,0': [cargo(5, 'alpha'), cargo(2, 'alpha'), cargo(8, 'beta')] }),
    });
    expect(filterIntents(tile, world)).toEqual([
      { kind: 'moveCargo', cargo: { id: 2, type: 'alpha' }, from: [0, 0], to: [0, 1] },
      { kind: 'moveCargo', cargo: { id: 5, type: 'alpha' }, from: [0, 0], to: [0, 1] },
    ]);
  });
});
