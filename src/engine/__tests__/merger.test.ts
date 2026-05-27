import { describe, expect, test } from 'vitest';
import { mergerIntents } from '../tiles/merger';
import { cargo, cargoMap, makeWorld, merger } from './helpers';

describe('merger', () => {
  test('moves a single cargo in its facing direction', () => {
    const tile = merger([3, 4], 'E');
    const world = makeWorld({ cargo: cargoMap({ '3,4': [cargo(1, 'alpha')] }) });
    expect(mergerIntents(tile, world)).toEqual([
      { kind: 'moveCargo', cargo: { id: 1, type: 'alpha' }, from: [3, 4], to: [4, 4] },
    ]);
  });

  test('moves all cargo on its cell (ordered by id)', () => {
    const tile = merger([0, 0], 'S');
    const world = makeWorld({
      cargo: cargoMap({ '0,0': [cargo(2, 'b'), cargo(1, 'a')] }),
    });
    expect(mergerIntents(tile, world)).toEqual([
      { kind: 'moveCargo', cargo: { id: 1, type: 'a' }, from: [0, 0], to: [0, 1] },
      { kind: 'moveCargo', cargo: { id: 2, type: 'b' }, from: [0, 0], to: [0, 1] },
    ]);
  });

  test('emits no intents when its cell is empty', () => {
    const tile = merger([3, 4], 'E');
    expect(mergerIntents(tile, makeWorld())).toEqual([]);
  });
});
