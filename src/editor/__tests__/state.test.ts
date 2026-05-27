// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { agentState, makePuzzle } from '../../engine/__tests__/helpers';
import type { Op } from '../../engine/types';
import { initialEditorState, reduce } from '../state';

const PUZZLE_WITH_AGENT = makePuzzle({
  grid: { w: 6, h: 4 },
  agents: [{ id: 'a1', startPos: [2, 2], maxOps: 6 }],
  inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 1 }],
  outputs: [{ pos: [5, 2], required: [{ type: 'alpha', count: 1 }] }],
  obstacles: [[3, 0]],
  constraints: { maxTiles: 5, maxCycles: 50 },
});

describe('initialEditorState', () => {
  test('starts with idle mode, no selection, empty solution', () => {
    const s = initialEditorState(PUZZLE_WITH_AGENT);
    expect(s.mode).toEqual({ kind: 'idle' });
    expect(s.selection).toEqual({ kind: 'none' });
    expect(s.draft.tiles).toEqual([]);
    expect(s.draft.paths['a1']).toEqual([[2, 2]]); // starts at agent's home cell
    expect(s.draft.programs['a1']).toEqual([]);
  });
});

describe('placing-tile mode', () => {
  test('SELECT_TILE_KIND enters placing-tile mode with E facing', () => {
    const s0 = initialEditorState(PUZZLE_WITH_AGENT);
    const s = reduce(s0, { type: 'SELECT_TILE_KIND', tileKind: 'conveyor' });
    expect(s.mode).toEqual({ kind: 'placing-tile', tileKind: 'conveyor', facing: 'E' });
  });

  test('ROTATE_PLACEMENT_FACING cycles N->E->S->W->N', () => {
    let s = reduce(initialEditorState(PUZZLE_WITH_AGENT), {
      type: 'SELECT_TILE_KIND',
      tileKind: 'conveyor',
    });
    expect((s.mode as { facing: string }).facing).toBe('E');
    s = reduce(s, { type: 'ROTATE_PLACEMENT_FACING' });
    expect((s.mode as { facing: string }).facing).toBe('S');
    s = reduce(s, { type: 'ROTATE_PLACEMENT_FACING' });
    expect((s.mode as { facing: string }).facing).toBe('W');
    s = reduce(s, { type: 'ROTATE_PLACEMENT_FACING' });
    expect((s.mode as { facing: string }).facing).toBe('N');
    s = reduce(s, { type: 'ROTATE_PLACEMENT_FACING' });
    expect((s.mode as { facing: string }).facing).toBe('E');
  });

  test('CLICK_CELL on empty in-grid cell places a tile of the active kind and facing', () => {
    let s = reduce(initialEditorState(PUZZLE_WITH_AGENT), {
      type: 'SELECT_TILE_KIND',
      tileKind: 'conveyor',
    });
    s = reduce(s, { type: 'CLICK_CELL', pos: [1, 1] });
    expect(s.draft.tiles).toEqual([{ pos: [1, 1], kind: 'conveyor', facing: 'E' }]);
    // Still in placing mode for sequential placement.
    expect(s.mode.kind).toBe('placing-tile');
  });

  test('CLICK_CELL on a cell that already has a tile REPLACES it', () => {
    let s = reduce(initialEditorState(PUZZLE_WITH_AGENT), {
      type: 'SELECT_TILE_KIND',
      tileKind: 'conveyor',
    });
    s = reduce(s, { type: 'CLICK_CELL', pos: [1, 1] });
    s = reduce(s, { type: 'SELECT_TILE_KIND', tileKind: 'filter' });
    s = reduce(s, { type: 'CLICK_CELL', pos: [1, 1] });
    expect(s.draft.tiles).toHaveLength(1);
    expect(s.draft.tiles[0]?.kind).toBe('filter');
  });

  test('CLICK_CELL on an obstacle is rejected', () => {
    let s = reduce(initialEditorState(PUZZLE_WITH_AGENT), {
      type: 'SELECT_TILE_KIND',
      tileKind: 'conveyor',
    });
    s = reduce(s, { type: 'CLICK_CELL', pos: [3, 0] });
    expect(s.draft.tiles).toEqual([]);
  });

  test('CLICK_CELL on an input or output cell is rejected', () => {
    let s = reduce(initialEditorState(PUZZLE_WITH_AGENT), {
      type: 'SELECT_TILE_KIND',
      tileKind: 'conveyor',
    });
    s = reduce(s, { type: 'CLICK_CELL', pos: [0, 0] }); // input
    expect(s.draft.tiles).toEqual([]);
    s = reduce(s, { type: 'CLICK_CELL', pos: [5, 2] }); // output
    expect(s.draft.tiles).toEqual([]);
  });

  test('CLICK_CELL out-of-grid is rejected', () => {
    let s = reduce(initialEditorState(PUZZLE_WITH_AGENT), {
      type: 'SELECT_TILE_KIND',
      tileKind: 'conveyor',
    });
    s = reduce(s, { type: 'CLICK_CELL', pos: [100, 100] });
    expect(s.draft.tiles).toEqual([]);
  });

  test('cannot exceed puzzle.constraints.maxTiles', () => {
    let s = reduce(initialEditorState(PUZZLE_WITH_AGENT), {
      type: 'SELECT_TILE_KIND',
      tileKind: 'conveyor',
    });
    for (let i = 0; i < 5; i++) {
      s = reduce(s, { type: 'CLICK_CELL', pos: [i, 1] });
    }
    expect(s.draft.tiles).toHaveLength(5);
    // 6th placement rejected
    s = reduce(s, { type: 'CLICK_CELL', pos: [1, 3] });
    expect(s.draft.tiles).toHaveLength(5);
  });

  test('SELECT_TILE_KIND with a kind not in availableTiles is rejected', () => {
    const restrictedPuzzle = makePuzzle({
      grid: { w: 4, h: 4 },
      availableTiles: ['conveyor'], // splitter not allowed
    });
    let s = initialEditorState(restrictedPuzzle);
    s = reduce(s, { type: 'SELECT_TILE_KIND', tileKind: 'splitter' });
    expect(s.mode.kind).toBe('idle'); // stays idle
  });

  test('CANCEL_MODE returns to idle', () => {
    let s = reduce(initialEditorState(PUZZLE_WITH_AGENT), {
      type: 'SELECT_TILE_KIND',
      tileKind: 'conveyor',
    });
    s = reduce(s, { type: 'CANCEL_MODE' });
    expect(s.mode).toEqual({ kind: 'idle' });
  });
});

describe('selection and tile manipulation in idle mode', () => {
  function withTileAt(): ReturnType<typeof initialEditorState> {
    let s = reduce(initialEditorState(PUZZLE_WITH_AGENT), {
      type: 'SELECT_TILE_KIND',
      tileKind: 'conveyor',
    });
    s = reduce(s, { type: 'CLICK_CELL', pos: [1, 1] });
    s = reduce(s, { type: 'CANCEL_MODE' });
    return s;
  }

  test('CLICK_CELL on a tile in idle mode selects it', () => {
    const s = reduce(withTileAt(), { type: 'CLICK_CELL', pos: [1, 1] });
    expect(s.selection).toEqual({ kind: 'tile', pos: [1, 1] });
  });

  test('ROTATE_SELECTED_TILE cycles the tile facing', () => {
    let s = reduce(withTileAt(), { type: 'CLICK_CELL', pos: [1, 1] });
    s = reduce(s, { type: 'ROTATE_SELECTED_TILE' });
    expect(s.draft.tiles[0]?.facing).toBe('S');
    s = reduce(s, { type: 'ROTATE_SELECTED_TILE' });
    expect(s.draft.tiles[0]?.facing).toBe('W');
  });

  test('DELETE_SELECTED_TILE removes the tile and clears selection', () => {
    let s = reduce(withTileAt(), { type: 'CLICK_CELL', pos: [1, 1] });
    s = reduce(s, { type: 'DELETE_SELECTED_TILE' });
    expect(s.draft.tiles).toEqual([]);
    expect(s.selection).toEqual({ kind: 'none' });
  });

  test('CLICK_CELL on agent home cell in idle mode selects the agent', () => {
    const s = reduce(withTileAt(), { type: 'CLICK_CELL', pos: [2, 2] });
    expect(s.selection).toEqual({ kind: 'agent', agentId: 'a1' });
  });

  test('CLICK_CELL on empty cell in idle mode clears selection', () => {
    let s = reduce(withTileAt(), { type: 'CLICK_CELL', pos: [1, 1] });
    s = reduce(s, { type: 'CLICK_CELL', pos: [4, 3] });
    expect(s.selection).toEqual({ kind: 'none' });
  });
});

describe('path drawing', () => {
  test('BEGIN_PATH_FOR_AGENT enters drawing-path mode and clears existing path beyond start', () => {
    const s = reduce(initialEditorState(PUZZLE_WITH_AGENT), {
      type: 'BEGIN_PATH_FOR_AGENT',
      agentId: 'a1',
    });
    expect(s.mode).toEqual({ kind: 'drawing-path', agentId: 'a1' });
    expect(s.draft.paths['a1']).toEqual([[2, 2]]); // resets to start
  });

  test('CLICK_CELL in drawing-path appends a vertex', () => {
    let s = reduce(initialEditorState(PUZZLE_WITH_AGENT), {
      type: 'BEGIN_PATH_FOR_AGENT',
      agentId: 'a1',
    });
    s = reduce(s, { type: 'CLICK_CELL', pos: [3, 2] });
    s = reduce(s, { type: 'CLICK_CELL', pos: [4, 2] });
    expect(s.draft.paths['a1']).toEqual([
      [2, 2],
      [3, 2],
      [4, 2],
    ]);
  });

  test('UNDO_PATH_VERTEX removes the last vertex (keeps the start)', () => {
    let s = reduce(initialEditorState(PUZZLE_WITH_AGENT), {
      type: 'BEGIN_PATH_FOR_AGENT',
      agentId: 'a1',
    });
    s = reduce(s, { type: 'CLICK_CELL', pos: [3, 2] });
    s = reduce(s, { type: 'CLICK_CELL', pos: [4, 2] });
    s = reduce(s, { type: 'UNDO_PATH_VERTEX' });
    expect(s.draft.paths['a1']).toEqual([
      [2, 2],
      [3, 2],
    ]);
    s = reduce(s, { type: 'UNDO_PATH_VERTEX' });
    expect(s.draft.paths['a1']).toEqual([[2, 2]]);
    // Cannot undo past the start cell
    s = reduce(s, { type: 'UNDO_PATH_VERTEX' });
    expect(s.draft.paths['a1']).toEqual([[2, 2]]);
  });

  test('COMMIT_PATH returns to idle, preserving the path', () => {
    let s = reduce(initialEditorState(PUZZLE_WITH_AGENT), {
      type: 'BEGIN_PATH_FOR_AGENT',
      agentId: 'a1',
    });
    s = reduce(s, { type: 'CLICK_CELL', pos: [3, 2] });
    s = reduce(s, { type: 'COMMIT_PATH' });
    expect(s.mode).toEqual({ kind: 'idle' });
    expect(s.draft.paths['a1']).toEqual([
      [2, 2],
      [3, 2],
    ]);
  });

  test('CLICK_CELL out of grid in drawing-path is rejected', () => {
    let s = reduce(initialEditorState(PUZZLE_WITH_AGENT), {
      type: 'BEGIN_PATH_FOR_AGENT',
      agentId: 'a1',
    });
    s = reduce(s, { type: 'CLICK_CELL', pos: [100, 100] });
    expect(s.draft.paths['a1']).toEqual([[2, 2]]);
  });

  test('CLICK_CELL on obstacle in drawing-path is rejected', () => {
    let s = reduce(initialEditorState(PUZZLE_WITH_AGENT), {
      type: 'BEGIN_PATH_FOR_AGENT',
      agentId: 'a1',
    });
    s = reduce(s, { type: 'CLICK_CELL', pos: [3, 0] }); // obstacle
    expect(s.draft.paths['a1']).toEqual([[2, 2]]);
  });
});

describe('op-list editing', () => {
  function inOpEdit(): ReturnType<typeof initialEditorState> {
    return reduce(initialEditorState(PUZZLE_WITH_AGENT), {
      type: 'BEGIN_OP_EDIT_FOR_AGENT',
      agentId: 'a1',
    });
  }

  test('BEGIN_OP_EDIT_FOR_AGENT enters editing-ops mode', () => {
    expect(inOpEdit().mode).toEqual({ kind: 'editing-ops', agentId: 'a1' });
  });

  test('APPEND_OP appends to the agent program', () => {
    let s = inOpEdit();
    s = reduce(s, { type: 'APPEND_OP', op: { kind: 'GRAB' } });
    s = reduce(s, { type: 'APPEND_OP', op: { kind: 'MOVE' } });
    expect(s.draft.programs['a1']).toEqual([{ kind: 'GRAB' }, { kind: 'MOVE' }]);
  });

  test('APPEND_OP rejects an op not in availableOps', () => {
    const restricted = makePuzzle({
      agents: [{ id: 'a1', startPos: [0, 0], maxOps: 4 }],
      availableOps: ['MOVE', 'WAIT'], // no GRAB
    });
    let s = reduce(initialEditorState(restricted), {
      type: 'BEGIN_OP_EDIT_FOR_AGENT',
      agentId: 'a1',
    });
    s = reduce(s, { type: 'APPEND_OP', op: { kind: 'GRAB' } });
    expect(s.draft.programs['a1']).toEqual([]);
  });

  test('APPEND_OP cannot exceed agent.maxOps', () => {
    let s = inOpEdit();
    for (let i = 0; i < 6; i++) {
      s = reduce(s, { type: 'APPEND_OP', op: { kind: 'WAIT' } });
    }
    expect(s.draft.programs['a1']).toHaveLength(6);
    s = reduce(s, { type: 'APPEND_OP', op: { kind: 'WAIT' } });
    expect(s.draft.programs['a1']).toHaveLength(6);
  });

  test('DELETE_OP removes the op at the index', () => {
    let s = inOpEdit();
    s = reduce(s, { type: 'APPEND_OP', op: { kind: 'GRAB' } });
    s = reduce(s, { type: 'APPEND_OP', op: { kind: 'MOVE' } });
    s = reduce(s, { type: 'APPEND_OP', op: { kind: 'DROP' } });
    s = reduce(s, { type: 'DELETE_OP', index: 1 });
    expect(s.draft.programs['a1']).toEqual([{ kind: 'GRAB' }, { kind: 'DROP' }]);
  });

  test('REPLACE_OP swaps the op at the index', () => {
    let s = inOpEdit();
    s = reduce(s, { type: 'APPEND_OP', op: { kind: 'GRAB' } });
    s = reduce(s, { type: 'REPLACE_OP', index: 0, op: { kind: 'DROP' } });
    expect(s.draft.programs['a1']).toEqual([{ kind: 'DROP' }]);
  });

  test('MOVE_OP_UP and MOVE_OP_DOWN reorder', () => {
    let s = inOpEdit();
    s = reduce(s, { type: 'APPEND_OP', op: { kind: 'GRAB' } });
    s = reduce(s, { type: 'APPEND_OP', op: { kind: 'MOVE' } });
    s = reduce(s, { type: 'MOVE_OP_UP', index: 1 });
    expect(s.draft.programs['a1']).toEqual([{ kind: 'MOVE' }, { kind: 'GRAB' }]);
    s = reduce(s, { type: 'MOVE_OP_DOWN', index: 0 });
    expect(s.draft.programs['a1']).toEqual([{ kind: 'GRAB' }, { kind: 'MOVE' }]);
  });

  test('MOVE_OP_UP at index 0 is a no-op', () => {
    let s = inOpEdit();
    s = reduce(s, { type: 'APPEND_OP', op: { kind: 'GRAB' } });
    s = reduce(s, { type: 'MOVE_OP_UP', index: 0 });
    expect(s.draft.programs['a1']).toEqual([{ kind: 'GRAB' }]);
  });

  test('MOVE_OP_DOWN at the last index is a no-op', () => {
    let s = inOpEdit();
    s = reduce(s, { type: 'APPEND_OP', op: { kind: 'GRAB' } });
    s = reduce(s, { type: 'APPEND_OP', op: { kind: 'MOVE' } });
    s = reduce(s, { type: 'MOVE_OP_DOWN', index: 1 });
    expect(s.draft.programs['a1']).toEqual([{ kind: 'GRAB' }, { kind: 'MOVE' }]);
  });

  test('DELETE_OP with out-of-range index is a no-op', () => {
    let s = inOpEdit();
    s = reduce(s, { type: 'APPEND_OP', op: { kind: 'GRAB' } });
    s = reduce(s, { type: 'DELETE_OP', index: 7 });
    expect(s.draft.programs['a1']).toEqual([{ kind: 'GRAB' }]);
  });
});

describe('SENSE op append and edit', () => {
  test('APPEND_OP with a SENSE op stores branches', () => {
    let s = reduce(initialEditorState(PUZZLE_WITH_AGENT), {
      type: 'BEGIN_OP_EDIT_FOR_AGENT',
      agentId: 'a1',
    });
    const sense: Op = {
      kind: 'SENSE',
      expects: 'alpha',
      then: { kind: 'GRAB' },
      otherwise: { kind: 'WAIT' },
    };
    s = reduce(s, { type: 'APPEND_OP', op: sense });
    expect(s.draft.programs['a1']).toEqual([sense]);
  });
});

describe('cross-mode invariants', () => {
  test('CANCEL_MODE from any mode returns to idle', () => {
    const modes = [
      { type: 'SELECT_TILE_KIND' as const, tileKind: 'conveyor' as const },
      { type: 'BEGIN_PATH_FOR_AGENT' as const, agentId: 'a1' },
      { type: 'BEGIN_OP_EDIT_FOR_AGENT' as const, agentId: 'a1' },
    ];
    for (const enter of modes) {
      const s0 = reduce(initialEditorState(PUZZLE_WITH_AGENT), enter);
      const s1 = reduce(s0, { type: 'CANCEL_MODE' });
      expect(s1.mode).toEqual({ kind: 'idle' });
    }
  });

  test('reducer is pure: same input produces same output', () => {
    const s0 = initialEditorState(PUZZLE_WITH_AGENT);
    const a: import('../state').EditorAction = {
      type: 'SELECT_TILE_KIND',
      tileKind: 'conveyor',
    };
    const r1 = reduce(s0, a);
    const r2 = reduce(s0, a);
    expect(r1).toEqual(r2);
    // And the input is unchanged.
    expect(s0.mode).toEqual({ kind: 'idle' });
  });
});

// Suppress unused-import lint on agentState — kept around for future tests.
void agentState;
