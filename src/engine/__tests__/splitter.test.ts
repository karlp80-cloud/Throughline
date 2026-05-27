import { describe, expect, test } from 'vitest';
import { splitterIntents } from '../tiles/splitter';
import { cargo, cargoMap, makeWorld, pk, splitter } from './helpers';

describe('splitter', () => {
  test('facing E with no prior state sends one cargo to N (first perpendicular)', () => {
    const tile = splitter([3, 4], 'E');
    const world = makeWorld({ cargo: cargoMap({ '3,4': [cargo(1, 'alpha')] }) });
    expect(splitterIntents(tile, world)).toEqual([
      { kind: 'moveCargo', cargo: { id: 1, type: 'alpha' }, from: [3, 4], to: [3, 3] },
      { kind: 'flipSplitter', at: [3, 4], nextOut: 'S' },
    ]);
  });

  test('facing E with prior nextOut=S sends cargo south', () => {
    const tile = splitter([3, 4], 'E');
    const world = makeWorld({
      cargo: cargoMap({ '3,4': [cargo(1, 'alpha')] }),
      tileState: { [pk(3, 4)]: { splitterNextOut: 'S' } },
    });
    expect(splitterIntents(tile, world)).toEqual([
      { kind: 'moveCargo', cargo: { id: 1, type: 'alpha' }, from: [3, 4], to: [3, 5] },
      { kind: 'flipSplitter', at: [3, 4], nextOut: 'N' },
    ]);
  });

  test('two cargo alternate per-cargo: first N, second S', () => {
    const tile = splitter([3, 4], 'E');
    const world = makeWorld({
      cargo: cargoMap({ '3,4': [cargo(1, 'a'), cargo(2, 'b')] }),
    });
    expect(splitterIntents(tile, world)).toEqual([
      { kind: 'moveCargo', cargo: { id: 1, type: 'a' }, from: [3, 4], to: [3, 3] },
      { kind: 'moveCargo', cargo: { id: 2, type: 'b' }, from: [3, 4], to: [3, 5] },
      { kind: 'flipSplitter', at: [3, 4], nextOut: 'N' },
    ]);
  });

  test('three cargo: N, S, N → next stored as S', () => {
    const tile = splitter([3, 4], 'E');
    const world = makeWorld({
      cargo: cargoMap({ '3,4': [cargo(1, 'a'), cargo(2, 'b'), cargo(3, 'c')] }),
    });
    expect(splitterIntents(tile, world)).toEqual([
      { kind: 'moveCargo', cargo: { id: 1, type: 'a' }, from: [3, 4], to: [3, 3] },
      { kind: 'moveCargo', cargo: { id: 2, type: 'b' }, from: [3, 4], to: [3, 5] },
      { kind: 'moveCargo', cargo: { id: 3, type: 'c' }, from: [3, 4], to: [3, 3] },
      { kind: 'flipSplitter', at: [3, 4], nextOut: 'S' },
    ]);
  });

  test('facing N: perpendiculars are E and W — first cargo goes E', () => {
    const tile = splitter([3, 4], 'N');
    const world = makeWorld({ cargo: cargoMap({ '3,4': [cargo(1, 'a')] }) });
    expect(splitterIntents(tile, world)).toEqual([
      { kind: 'moveCargo', cargo: { id: 1, type: 'a' }, from: [3, 4], to: [4, 4] },
      { kind: 'flipSplitter', at: [3, 4], nextOut: 'W' },
    ]);
  });

  test('empty cell emits no intents', () => {
    const tile = splitter([3, 4], 'E');
    expect(splitterIntents(tile, makeWorld())).toEqual([]);
  });

  test('cargo iteration order is by id (determinism), regardless of array order', () => {
    const tile = splitter([0, 0], 'E');
    const world = makeWorld({
      cargo: cargoMap({ '0,0': [cargo(3, 'c'), cargo(1, 'a'), cargo(2, 'b')] }),
    });
    const intents = splitterIntents(tile, world);
    // ids in order 1, 2, 3 → N, S, N
    expect(intents.slice(0, 3)).toEqual([
      { kind: 'moveCargo', cargo: { id: 1, type: 'a' }, from: [0, 0], to: [0, -1] },
      { kind: 'moveCargo', cargo: { id: 2, type: 'b' }, from: [0, 0], to: [0, 1] },
      { kind: 'moveCargo', cargo: { id: 3, type: 'c' }, from: [0, 0], to: [0, -1] },
    ]);
  });
});
