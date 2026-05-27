# Editor Architecture Notes (Phase 3)

> **Light cycle.** Manual playtest is the reviewer.
> **Framework:** None (locked-in pre-Phase 0). Hand-written DOM + pure reducer.
> **Companion:** [IMPLEMENTATION_PLAN.md § Phase 3](../../IMPLEMENTATION_PLAN.md).

## Goal

Player can construct a complete `Solution` for a given `Puzzle` in-browser. Output: an `EditorState.draft: Solution` that can be passed to `runUntilHalt`.

## State shape

```ts
type Mode =
  | { kind: 'idle' }
  | { kind: 'placing-tile'; tileKind: TileKind; facing: Direction }
  | { kind: 'drawing-path'; agentId: AgentId }
  | { kind: 'editing-ops'; agentId: AgentId };

type Selection =
  | { kind: 'none' }
  | { kind: 'tile'; pos: Pos }
  | { kind: 'agent'; agentId: AgentId };

interface EditorState {
  puzzle: Puzzle;
  draft: Solution;
  mode: Mode;
  selection: Selection;
}
```

The reducer is pure: `(state, action) → state`. DOM event handlers dispatch actions; nothing mutates state directly.

## Action types

```ts
type EditorAction =
  // Tile palette toolbar
  | { type: 'SELECT_TILE_KIND'; tileKind: TileKind }
  | { type: 'ROTATE_PLACEMENT_FACING' }   // R key while placing
  | { type: 'CANCEL_MODE' }               // Esc

  // Grid clicks
  | { type: 'CLICK_CELL'; pos: Pos }      // dispatch is mode-aware

  // Path editor
  | { type: 'BEGIN_PATH_FOR_AGENT'; agentId: AgentId }
  | { type: 'UNDO_PATH_VERTEX' }          // Z key while drawing
  | { type: 'COMMIT_PATH' }               // Enter while drawing

  // Op list editor
  | { type: 'BEGIN_OP_EDIT_FOR_AGENT'; agentId: AgentId }
  | { type: 'APPEND_OP'; op: Op }
  | { type: 'REPLACE_OP'; index: number; op: Op }
  | { type: 'DELETE_OP'; index: number }
  | { type: 'MOVE_OP_UP'; index: number }
  | { type: 'MOVE_OP_DOWN'; index: number }

  // Tile manipulation
  | { type: 'ROTATE_SELECTED_TILE' }      // R key on a selected tile
  | { type: 'DELETE_SELECTED_TILE' }      // Backspace on a selected tile

  // Misc
  | { type: 'CLEAR_SELECTION' };
```

The `CLICK_CELL` action is dispatch-time polymorphic: the reducer reads `state.mode` and routes the click.

## Click semantics by mode

| Mode | CLICK_CELL on... | Action |
|---|---|---|
| `idle` | empty cell | no-op |
| `idle` | cell with tile | select that tile |
| `idle` | agent's home cell | select agent |
| `placing-tile` | any empty non-obstacle cell | place tile of the active kind/facing; stay in placing mode |
| `placing-tile` | cell that already has a tile | replace (only if same player, no overlap risk yet — v1 just overwrites) |
| `drawing-path` | any cell in-grid | append vertex |
| `editing-ops` | (any cell) | exit op-edit mode → idle |

Placing tiles on **input or output cells** is rejected (no-op). Placing on **obstacles** is rejected.

## Keyboard bindings

| Key | Action |
|---|---|
| `R` | rotate placement facing (in `placing-tile`) OR rotate selected tile (in `idle` + tile-selection) |
| `Esc` | CANCEL_MODE → idle |
| `Z` | UNDO_PATH_VERTEX (in `drawing-path`) |
| `Enter` | COMMIT_PATH (in `drawing-path`) |
| `Backspace` / `Delete` | DELETE_SELECTED_TILE (in `idle` + tile-selection) |

## Validation invariants (reducer enforces)

- `draft.tiles.length` never exceeds `puzzle.constraints.maxTiles`. A placement action that would overflow is silently dropped (UI surfaces a toast in a later phase).
- A tile's `kind` must be in `puzzle.availableTiles`. Toolbar only shows available kinds.
- An op's `kind` must be in `puzzle.availableOps`. Op-list editor only offers available ops.
- `draft.programs[agentId].length` never exceeds `puzzle.agents.find(a => a.id === agentId).maxOps`.
- No two tiles share a cell. Placing on an occupied non-obstacle cell **replaces** the existing tile (simpler than "select then replace").

These rules are tested at the reducer level — DOM is dumb.

## Op-list editor UI

A side panel per active agent (visible when `mode.kind === 'editing-ops'`). Buttons:
- Add op: shows available ops as a dropdown; appends.
- For each op in the list: up/down/delete buttons, plus (for SENSE) sub-editors for `then` and `otherwise`.
- Keyboard: arrow up/down to reorder the highlighted op; backspace to delete; number keys 1–N to insert by available-op index.

For v1, this is **basic and ugly**. Phase 4 adds polish; Phase 9 (tutorial) is when ergonomics matter.

## Dispatch + DOM wiring

`src/editor/index.ts` exports `mountEditor(puzzle, container) → { getState, dispatch, destroy }`. The harness owns:
- A reducer + state ref
- The render call (re-renders the canvas after every dispatch via the existing `render()` from Phase 2)
- DOM event listeners for the canvas, toolbar, op-list panel, and keyboard

Re-render strategy: on every dispatch, call `render(ctx, ...)`. The canvas is small; re-painting on each interaction is cheap. Phase 4 introduces requestAnimationFrame for animation; we don't need it here.

## Test contract

- **Unit (`state.test.ts`):** every action's effect on every legal mode/selection combination. Pure-function tests; no DOM.
- **e2e (`editor.spec.ts`):** Playwright drives a realistic construction: load a known puzzle, click palette → click cells → place tiles → click agent → draw path → open op list → add ops → assert final `state.draft` deep-equals an expected fixture. The editor exposes a `window.__editor` reference in dev/test builds so the test can read state.

## Test API

When mounted via `?editor=1` or as the default route, the editor stashes its handle on `window.__editor`:

```ts
declare global {
  interface Window {
    __editor?: {
      getState(): EditorState;
      dispatch(action: EditorAction): void;
      destroy(): void;
    };
  }
}
```

This is intended for Playwright tests AND for ad-hoc manual scripting from the browser console:

```js
// In DevTools, while at http://localhost:5173/
window.__editor.dispatch({ type: 'SELECT_TILE_KIND', tileKind: 'conveyor' });
window.__editor.dispatch({ type: 'CLICK_CELL', pos: [3, 2] });
window.__editor.getState().draft.tiles;
// → [{ pos: [3,2], kind: 'conveyor', facing: 'E' }]
```

See `e2e/editor.spec.ts` for the canonical pattern.

## What this phase does NOT do

- No undo/redo history. v1 has no global undo; the path-undo Z key is local to path-drawing only.
- No "save draft to localStorage" — Phase 7 handles persistence.
- No multi-select / box-select.
- No tile-tooltip on hover.
- No keyboard navigation of the grid (mouse-only for click-cell).
- No visual feedback for "would-place" preview tile. Phase 4 polish.
