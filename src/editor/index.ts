/**
 * Editor mount point.
 *
 * `mountEditor(container, puzzle)` sets up:
 *   - the canvas (via Phase 2's mountCanvas)
 *   - the tile palette toolbar
 *   - the op-list / path-edit panel
 *   - canvas + window input handlers
 * and returns { getState, dispatch, destroy } so callers can drive
 * the editor (Playwright uses this via `window.__editor`).
 *
 * The mounted editor re-renders the canvas on every dispatch.
 */

import type { AudioController } from '../audio';
import type { Pos, Puzzle, Solution } from '../engine/types';
import { initialWorld } from '../engine';
import { render, type RenderOptions } from '../render/renderer';
import { mountCanvas } from '../app/canvasMount';
import { attachCanvasInput } from './dom/canvasInput';
import { mountOpList } from './dom/opList';
import { mountPalette } from './dom/palette';
import { initialEditorState, reduce, type EditorAction, type EditorState } from './state';

export interface EditorHandle {
  getState(): EditorState;
  dispatch(a: EditorAction): void;
  destroy(): void;
}

/**
 * Mount the editor. If `initialDraft` is provided, seed the reducer
 * with that draft so the user's previous tiles/paths/programs are
 * preserved (e.g. across a Run → Reset round-trip). `audio` is
 * optional; when provided the editor triggers SFX on tile placement,
 * rotation, and deletion.
 */
export function mountEditor(
  container: HTMLElement,
  puzzle: Puzzle,
  initialDraft?: Solution,
  audio?: AudioController,
): EditorHandle {
  let state = initialEditorState(puzzle);
  if (initialDraft) {
    state = { ...state, draft: initialDraft };
  }
  let hoverCell: Pos | null = null;

  // DOM scaffolding.
  container.replaceChildren();
  const paletteEl = document.createElement('div');
  const canvasContainer = document.createElement('div');
  const opListEl = document.createElement('div');
  container.appendChild(paletteEl);
  container.appendChild(canvasContainer);
  container.appendChild(opListEl);

  const world = initialWorld(puzzle);
  const canvas = mountCanvas(canvasContainer, puzzle, state.draft, world);
  const ctx = canvas.getContext('2d')!;

  function rerenderCanvas(): void {
    const opts: RenderOptions =
      state.mode.kind === 'placing-tile' && hoverCell !== null
        ? {
            showPaths: true,
            preview: {
              pos: hoverCell,
              tileKind: state.mode.tileKind,
              facing: state.mode.facing,
            },
          }
        : { showPaths: true };
    render(ctx, world, puzzle, state.draft, opts);
  }

  const palette = mountPalette(paletteEl, () => state, dispatch);
  const opList = mountOpList(opListEl, () => state, dispatch);
  const detachInput = attachCanvasInput(
    canvas,
    () => state,
    dispatch,
    (cell) => {
      hoverCell = cell;
      rerenderCanvas();
    },
  );

  function dispatch(action: EditorAction): void {
    const prev = state;
    state = reduce(state, action);
    if (audio) emitSfxFor(prev, state, action, audio);
    rerenderCanvas();
    palette.update();
    opList.update();
  }

  // Initial paint with paths visible.
  rerenderCanvas();

  return {
    getState: () => state,
    dispatch,
    destroy: () => {
      detachInput();
      palette.destroy();
      opList.destroy();
      container.replaceChildren();
    },
  };
}

function emitSfxFor(
  prev: EditorState,
  next: EditorState,
  action: EditorAction,
  audio: AudioController,
): void {
  const prevTileCount = prev.draft.tiles.length;
  const nextTileCount = next.draft.tiles.length;
  if (nextTileCount > prevTileCount) {
    audio.playSfx('tile_place');
    return;
  }
  if (nextTileCount < prevTileCount) {
    audio.playSfx('tile_delete');
    return;
  }
  // Same count but a tile was replaced (CLICK_CELL in placing mode on
  // an existing tile): also a "place" sound.
  if (action.type === 'CLICK_CELL' && prev.mode.kind === 'placing-tile') {
    const replaced = next.draft.tiles.some((t, i) => {
      const p = prev.draft.tiles[i];
      return !p || p.kind !== t.kind || p.facing !== t.facing;
    });
    if (replaced) {
      audio.playSfx('tile_place');
      return;
    }
  }
  if (action.type === 'ROTATE_PLACEMENT_FACING' || action.type === 'ROTATE_SELECTED_TILE') {
    audio.playSfx('tile_rotate');
  }
}
