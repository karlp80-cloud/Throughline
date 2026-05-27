/**
 * Editor state + pure reducer.
 *
 * See docs/architecture/editor.md for the contract. The DOM layer
 * (dom/*.ts and index.ts) dispatches actions through `reduce()`;
 * nothing else mutates state.
 */

import type {
  AgentId,
  AgentSpec,
  Direction,
  Op,
  PlacedTile,
  Pos,
  Puzzle,
  Solution,
  TileKind,
} from '../engine/types';

// ─── Types ────────────────────────────────────────────────────────
export type Mode =
  | { readonly kind: 'idle' }
  | { readonly kind: 'placing-tile'; readonly tileKind: TileKind; readonly facing: Direction }
  | { readonly kind: 'drawing-path'; readonly agentId: AgentId }
  | { readonly kind: 'editing-ops'; readonly agentId: AgentId };

export type Selection =
  | { readonly kind: 'none' }
  | { readonly kind: 'tile'; readonly pos: Pos }
  | { readonly kind: 'agent'; readonly agentId: AgentId };

export interface EditorState {
  readonly puzzle: Puzzle;
  readonly draft: Solution;
  readonly mode: Mode;
  readonly selection: Selection;
}

export type EditorAction =
  // Tile palette toolbar
  | { readonly type: 'SELECT_TILE_KIND'; readonly tileKind: TileKind }
  | { readonly type: 'ROTATE_PLACEMENT_FACING' }
  | { readonly type: 'CANCEL_MODE' }
  // Grid clicks (dispatch is mode-aware)
  | { readonly type: 'CLICK_CELL'; readonly pos: Pos }
  // Path editor
  | { readonly type: 'BEGIN_PATH_FOR_AGENT'; readonly agentId: AgentId }
  | { readonly type: 'UNDO_PATH_VERTEX' }
  | { readonly type: 'COMMIT_PATH' }
  // Op list editor
  | { readonly type: 'BEGIN_OP_EDIT_FOR_AGENT'; readonly agentId: AgentId }
  | { readonly type: 'APPEND_OP'; readonly op: Op }
  | { readonly type: 'REPLACE_OP'; readonly index: number; readonly op: Op }
  | { readonly type: 'DELETE_OP'; readonly index: number }
  | { readonly type: 'MOVE_OP_UP'; readonly index: number }
  | { readonly type: 'MOVE_OP_DOWN'; readonly index: number }
  // Tile manipulation
  | { readonly type: 'ROTATE_SELECTED_TILE' }
  | { readonly type: 'DELETE_SELECTED_TILE' }
  // Misc
  | { readonly type: 'CLEAR_SELECTION' };

// ─── Helpers ──────────────────────────────────────────────────────
function rotateCW(d: Direction): Direction {
  switch (d) {
    case 'N':
      return 'E';
    case 'E':
      return 'S';
    case 'S':
      return 'W';
    case 'W':
      return 'N';
  }
}

function inGrid(p: Pos, puzzle: Puzzle): boolean {
  return p[0] >= 0 && p[0] < puzzle.grid.w && p[1] >= 0 && p[1] < puzzle.grid.h;
}

function isObstacleCell(p: Pos, puzzle: Puzzle): boolean {
  return puzzle.obstacles.some((o) => o[0] === p[0] && o[1] === p[1]);
}

function agentAt(p: Pos, puzzle: Puzzle): AgentSpec | undefined {
  return puzzle.agents.find((a) => a.startPos[0] === p[0] && a.startPos[1] === p[1]);
}

function tileAt(p: Pos, tiles: readonly PlacedTile[]): PlacedTile | undefined {
  return tiles.find((t) => t.pos[0] === p[0] && t.pos[1] === p[1]);
}

function isOpAllowed(op: Op, puzzle: Puzzle): boolean {
  return puzzle.availableOps.includes(op.kind);
}

function isTileKindAllowed(kind: TileKind, puzzle: Puzzle): boolean {
  return puzzle.availableTiles.includes(kind);
}

// ─── Public: initial state ────────────────────────────────────────
export function initialEditorState(puzzle: Puzzle): EditorState {
  const paths: Record<AgentId, readonly Pos[]> = {};
  const programs: Record<AgentId, readonly Op[]> = {};
  for (const a of puzzle.agents) {
    paths[a.id] = [a.startPos];
    programs[a.id] = [];
  }
  return {
    puzzle,
    draft: { tiles: [], paths, programs },
    mode: { kind: 'idle' },
    selection: { kind: 'none' },
  };
}

// ─── Reducer ──────────────────────────────────────────────────────
export function reduce(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'SELECT_TILE_KIND':
      if (!isTileKindAllowed(action.tileKind, state.puzzle)) return state;
      return {
        ...state,
        mode: { kind: 'placing-tile', tileKind: action.tileKind, facing: 'E' },
        selection: { kind: 'none' },
      };

    case 'ROTATE_PLACEMENT_FACING':
      if (state.mode.kind !== 'placing-tile') return state;
      return {
        ...state,
        mode: { ...state.mode, facing: rotateCW(state.mode.facing) },
      };

    case 'CANCEL_MODE':
      return { ...state, mode: { kind: 'idle' } };

    case 'CLICK_CELL':
      return handleClickCell(state, action.pos);

    case 'BEGIN_PATH_FOR_AGENT': {
      const agent = state.puzzle.agents.find((a) => a.id === action.agentId);
      if (!agent) return state;
      return {
        ...state,
        mode: { kind: 'drawing-path', agentId: action.agentId },
        // Reset path to just the start cell.
        draft: {
          ...state.draft,
          paths: { ...state.draft.paths, [action.agentId]: [agent.startPos] },
        },
        selection: { kind: 'agent', agentId: action.agentId },
      };
    }

    case 'UNDO_PATH_VERTEX': {
      if (state.mode.kind !== 'drawing-path') return state;
      const id = state.mode.agentId;
      const path = state.draft.paths[id] ?? [];
      if (path.length <= 1) return state;
      const next = path.slice(0, -1);
      return {
        ...state,
        draft: { ...state.draft, paths: { ...state.draft.paths, [id]: next } },
      };
    }

    case 'COMMIT_PATH':
      if (state.mode.kind !== 'drawing-path') return state;
      return { ...state, mode: { kind: 'idle' } };

    case 'BEGIN_OP_EDIT_FOR_AGENT': {
      const agent = state.puzzle.agents.find((a) => a.id === action.agentId);
      if (!agent) return state;
      return {
        ...state,
        mode: { kind: 'editing-ops', agentId: action.agentId },
        selection: { kind: 'agent', agentId: action.agentId },
      };
    }

    case 'APPEND_OP':
      return handleAppendOp(state, action.op);

    case 'REPLACE_OP':
      return handleReplaceOp(state, action.index, action.op);

    case 'DELETE_OP':
      return handleDeleteOp(state, action.index);

    case 'MOVE_OP_UP':
      return handleMoveOp(state, action.index, -1);

    case 'MOVE_OP_DOWN':
      return handleMoveOp(state, action.index, +1);

    case 'ROTATE_SELECTED_TILE':
      return handleRotateSelectedTile(state);

    case 'DELETE_SELECTED_TILE':
      return handleDeleteSelectedTile(state);

    case 'CLEAR_SELECTION':
      return { ...state, selection: { kind: 'none' } };
  }
}

// ─── Action handlers ──────────────────────────────────────────────
function handleClickCell(state: EditorState, pos: Pos): EditorState {
  if (!inGrid(pos, state.puzzle)) return state;

  switch (state.mode.kind) {
    case 'idle':
      return handleClickIdle(state, pos);
    case 'placing-tile':
      return handleClickPlacing(state, pos, state.mode.tileKind, state.mode.facing);
    case 'drawing-path':
      return handleClickDrawingPath(state, pos, state.mode.agentId);
    case 'editing-ops':
      // Clicks outside the op panel return to idle. Grid clicks ignored.
      return state;
  }
}

function handleClickIdle(state: EditorState, pos: Pos): EditorState {
  const t = tileAt(pos, state.draft.tiles);
  if (t) return { ...state, selection: { kind: 'tile', pos: t.pos } };
  const a = agentAt(pos, state.puzzle);
  if (a) return { ...state, selection: { kind: 'agent', agentId: a.id } };
  return { ...state, selection: { kind: 'none' } };
}

function handleClickPlacing(
  state: EditorState,
  pos: Pos,
  tileKind: TileKind,
  facing: Direction,
): EditorState {
  if (isObstacleCell(pos, state.puzzle)) return state;
  // Tiles CAN be placed on input and output cells — the engine processes
  // them uniformly with stand-alone tiles, and the input/output cell
  // still emits/receives cargo. Putting a conveyor on the input is the
  // natural way to start a pipeline.
  const existingIdx = state.draft.tiles.findIndex(
    (t) => t.pos[0] === pos[0] && t.pos[1] === pos[1],
  );
  const newTile: PlacedTile = { pos, kind: tileKind, facing };
  let tiles: PlacedTile[];
  if (existingIdx >= 0) {
    tiles = state.draft.tiles.slice();
    tiles[existingIdx] = newTile;
  } else {
    if (state.draft.tiles.length >= state.puzzle.constraints.maxTiles) return state;
    tiles = state.draft.tiles.concat(newTile);
  }
  return { ...state, draft: { ...state.draft, tiles } };
}

function handleClickDrawingPath(state: EditorState, pos: Pos, agentId: AgentId): EditorState {
  if (isObstacleCell(pos, state.puzzle)) return state;
  const path = state.draft.paths[agentId] ?? [];
  const next: readonly Pos[] = [...path, pos];
  return {
    ...state,
    draft: { ...state.draft, paths: { ...state.draft.paths, [agentId]: next } },
  };
}

function handleAppendOp(state: EditorState, op: Op): EditorState {
  if (state.mode.kind !== 'editing-ops') return state;
  if (!isOpAllowed(op, state.puzzle)) return state;
  const agentId = state.mode.agentId;
  const agent = state.puzzle.agents.find((a) => a.id === agentId);
  if (!agent) return state;
  const existing = state.draft.programs[agentId] ?? [];
  if (existing.length >= agent.maxOps) return state;
  const programs = { ...state.draft.programs, [agentId]: existing.concat(op) };
  return { ...state, draft: { ...state.draft, programs } };
}

function handleReplaceOp(state: EditorState, index: number, op: Op): EditorState {
  if (state.mode.kind !== 'editing-ops') return state;
  if (!isOpAllowed(op, state.puzzle)) return state;
  const agentId = state.mode.agentId;
  const existing = state.draft.programs[agentId] ?? [];
  if (index < 0 || index >= existing.length) return state;
  const next = existing.slice();
  next[index] = op;
  const programs = { ...state.draft.programs, [agentId]: next };
  return { ...state, draft: { ...state.draft, programs } };
}

function handleDeleteOp(state: EditorState, index: number): EditorState {
  if (state.mode.kind !== 'editing-ops') return state;
  const agentId = state.mode.agentId;
  const existing = state.draft.programs[agentId] ?? [];
  if (index < 0 || index >= existing.length) return state;
  const next = existing.slice(0, index).concat(existing.slice(index + 1));
  const programs = { ...state.draft.programs, [agentId]: next };
  return { ...state, draft: { ...state.draft, programs } };
}

function handleMoveOp(state: EditorState, index: number, delta: -1 | 1): EditorState {
  if (state.mode.kind !== 'editing-ops') return state;
  const agentId = state.mode.agentId;
  const existing = state.draft.programs[agentId] ?? [];
  const target = index + delta;
  if (index < 0 || index >= existing.length) return state;
  if (target < 0 || target >= existing.length) return state;
  const next = existing.slice();
  const a = next[index];
  const b = next[target];
  if (a === undefined || b === undefined) return state;
  next[index] = b;
  next[target] = a;
  const programs = { ...state.draft.programs, [agentId]: next };
  return { ...state, draft: { ...state.draft, programs } };
}

function handleRotateSelectedTile(state: EditorState): EditorState {
  if (state.selection.kind !== 'tile') return state;
  const tileIdx = state.draft.tiles.findIndex(
    (t) =>
      t.pos[0] === (state.selection as { pos: Pos }).pos[0] &&
      t.pos[1] === (state.selection as { pos: Pos }).pos[1],
  );
  if (tileIdx < 0) return state;
  const existing = state.draft.tiles[tileIdx];
  if (!existing) return state;
  const rotated: PlacedTile = { ...existing, facing: rotateCW(existing.facing) };
  const tiles = state.draft.tiles.slice();
  tiles[tileIdx] = rotated;
  return { ...state, draft: { ...state.draft, tiles } };
}

function handleDeleteSelectedTile(state: EditorState): EditorState {
  if (state.selection.kind !== 'tile') return state;
  const sel = state.selection;
  const tiles = state.draft.tiles.filter((t) => t.pos[0] !== sel.pos[0] || t.pos[1] !== sel.pos[1]);
  return { ...state, draft: { ...state.draft, tiles }, selection: { kind: 'none' } };
}
