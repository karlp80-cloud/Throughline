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

import type { Pos, Puzzle } from '../engine/types';
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

export function mountEditor(container: HTMLElement, puzzle: Puzzle): EditorHandle {
  let state = initialEditorState(puzzle);
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
    state = reduce(state, action);
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
