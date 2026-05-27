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

  test('alternation persists across cycles via tileState', () => {
    // Two cycles, one cargo each. The first cycle should send the
    // cargo to perpendicular[0] (N for facing E) and write a
    // flipSplitter intent setting nextOut=S. The second cycle reads
    // that stored direction and sends cargo south, flipping back to N.
    const tile = splitter([2, 2], 'E');

    // Cycle 1: no prior state → uses perpendicular[0] = N
    const w1 = makeWorld({ cargo: cargoMap({ '2,2': [cargo(10, 'a')] }) });
    const i1 = splitterIntents(tile, w1);
    expect(i1).toEqual([
      { kind: 'moveCargo', cargo: { id: 10, type: 'a' }, from: [2, 2], to: [2, 1] },
      { kind: 'flipSplitter', at: [2, 2], nextOut: 'S' },
    ]);

    // Cycle 2: stored nextOut=S → cargo goes south, flips back to N.
    const w2 = makeWorld({
      cargo: cargoMap({ '2,2': [cargo(11, 'a')] }),
      tileState: { [pk(2, 2)]: { splitterNextOut: 'S' } },
    });
    const i2 = splitterIntents(tile, w2);
    expect(i2).toEqual([
      { kind: 'moveCargo', cargo: { id: 11, type: 'a' }, from: [2, 2], to: [2, 3] },
      { kind: 'flipSplitter', at: [2, 2], nextOut: 'N' },
    ]);
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
