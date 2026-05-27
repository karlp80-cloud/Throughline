import { describe, expect, test } from 'vitest';
import { conveyorIntents } from '../tiles/conveyor';
import { cargo, cargoMap, conveyor, makeWorld } from './helpers';

describe('conveyor', () => {
  test('facing E moves a single cargo one step east', () => {
    const tile = conveyor([3, 4], 'E');
    const world = makeWorld({ cargo: cargoMap({ '3,4': [cargo(1, 'alpha')] }) });
    const intents = conveyorIntents(tile, world);
    expect(intents).toEqual([
      { kind: 'moveCargo', cargo: { id: 1, type: 'alpha' }, from: [3, 4], to: [4, 4] },
    ]);
  });

  test('facing W moves cargo one step west', () => {
    const tile = conveyor([3, 4], 'W');
    const world = makeWorld({ cargo: cargoMap({ '3,4': [cargo(7, 'beta')] }) });
    expect(conveyorIntents(tile, world)).toEqual([
      { kind: 'moveCargo', cargo: { id: 7, type: 'beta' }, from: [3, 4], to: [2, 4] },
    ]);
  });

  test('facing N moves cargo one step north (decreasing y)', () => {
    const tile = conveyor([3, 4], 'N');
    const world = makeWorld({ cargo: cargoMap({ '3,4': [cargo(1, 'alpha')] }) });
    expect(conveyorIntents(tile, world)).toEqual([
      { kind: 'moveCargo', cargo: { id: 1, type: 'alpha' }, from: [3, 4], to: [3, 3] },
    ]);
  });

  test('facing S moves cargo one step south (increasing y)', () => {
    const tile = conveyor([3, 4], 'S');
    const world = makeWorld({ cargo: cargoMap({ '3,4': [cargo(1, 'alpha')] }) });
    expect(conveyorIntents(tile, world)).toEqual([
      { kind: 'moveCargo', cargo: { id: 1, type: 'alpha' }, from: [3, 4], to: [3, 5] },
    ]);
  });

  test('moves all cargo on the cell, ordered by cargo id (determinism)', () => {
    const tile = conveyor([0, 0], 'E');
    const world = makeWorld({
      cargo: cargoMap({
        '0,0': [cargo(2, 'b'), cargo(1, 'a'), cargo(3, 'c')],
      }),
    });
    const intents = conveyorIntents(tile, world);
    expect(intents).toEqual([
      { kind: 'moveCargo', cargo: { id: 1, type: 'a' }, from: [0, 0], to: [1, 0] },
      { kind: 'moveCargo', cargo: { id: 2, type: 'b' }, from: [0, 0], to: [1, 0] },
      { kind: 'moveCargo', cargo: { id: 3, type: 'c' }, from: [0, 0], to: [1, 0] },
    ]);
  });

  test('emits no intents when its cell is empty', () => {
    const tile = conveyor([3, 4], 'E');
    expect(conveyorIntents(tile, makeWorld())).toEqual([]);
  });
});
