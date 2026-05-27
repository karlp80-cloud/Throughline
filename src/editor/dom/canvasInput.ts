/**
 * Mouse + keyboard handlers on the canvas.
 *
 * Mouse: convert click coords to grid cell, dispatch CLICK_CELL.
 * Keyboard: R = rotate, Esc = cancel, Z = undo path vertex,
 * Enter = commit path, Backspace/Delete = delete selected tile.
 *
 * Keyboard listener is attached to `window` so the user doesn't have
 * to focus the canvas first.
 */

import { CELL_SIZE } from '../../render/renderer';
import type { EditorAction, EditorState } from '../state';

export function attachCanvasInput(
  canvas: HTMLCanvasElement,
  getState: () => EditorState,
  dispatch: (a: EditorAction) => void,
): () => void {
  function onClick(ev: MouseEvent): void {
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    // Use the canvas's intrinsic vs CSS size in case of zoom.
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const gx = ((x * scaleX) / CELL_SIZE) | 0;
    const gy = ((y * scaleY) / CELL_SIZE) | 0;
    dispatch({ type: 'CLICK_CELL', pos: [gx, gy] });
  }
  canvas.addEventListener('click', onClick);

  function onKey(ev: KeyboardEvent): void {
    const s = getState();
    if (ev.key === 'r' || ev.key === 'R') {
      if (s.mode.kind === 'placing-tile') {
        ev.preventDefault();
        dispatch({ type: 'ROTATE_PLACEMENT_FACING' });
      } else if (s.selection.kind === 'tile') {
        ev.preventDefault();
        dispatch({ type: 'ROTATE_SELECTED_TILE' });
      }
    } else if (ev.key === 'Escape') {
      dispatch({ type: 'CANCEL_MODE' });
    } else if (ev.key === 'z' || ev.key === 'Z') {
      if (s.mode.kind === 'drawing-path') {
        ev.preventDefault();
        dispatch({ type: 'UNDO_PATH_VERTEX' });
      }
    } else if (ev.key === 'Enter') {
      if (s.mode.kind === 'drawing-path') {
        ev.preventDefault();
        dispatch({ type: 'COMMIT_PATH' });
      }
    } else if (ev.key === 'Backspace' || ev.key === 'Delete') {
      if (s.selection.kind === 'tile') {
        ev.preventDefault();
        dispatch({ type: 'DELETE_SELECTED_TILE' });
      }
    }
  }
  window.addEventListener('keydown', onKey);

  return () => {
    canvas.removeEventListener('click', onClick);
    window.removeEventListener('keydown', onKey);
  };
}
