/**
 * Tile-palette toolbar. Hand-written DOM (no framework).
 *
 * Renders a button per `puzzle.availableTiles` value. Clicking a
 * button dispatches `SELECT_TILE_KIND`; the currently-selected kind
 * gets an `.active` class.
 */

import type { TileKind } from '../../engine/types';
import type { EditorAction, EditorState } from '../state';

const TILE_LABELS: Record<TileKind, string> = {
  conveyor: 'Conveyor',
  splitter: 'Splitter',
  merger: 'Merger',
  filter: 'Filter',
  reactor: 'Reactor',
};

export function mountPalette(
  container: HTMLElement,
  getState: () => EditorState,
  dispatch: (a: EditorAction) => void,
): { update: () => void; destroy: () => void } {
  container.classList.add('palette');
  container.style.cssText = `
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 8px;
    background: var(--surface);
    border-radius: 6px;
    margin: 8px 0;
  `;
  const buttons = new Map<TileKind, HTMLButtonElement>();
  const state0 = getState();
  for (const kind of state0.puzzle.availableTiles) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset['tileKind'] = kind;
    btn.textContent = TILE_LABELS[kind];
    btn.style.cssText = `
      padding: 6px 12px;
      background: var(--bg);
      color: var(--fg);
      border: 1px solid var(--muted);
      border-radius: 4px;
      cursor: pointer;
      font: inherit;
    `;
    btn.addEventListener('click', () => {
      dispatch({ type: 'SELECT_TILE_KIND', tileKind: kind });
    });
    container.appendChild(btn);
    buttons.set(kind, btn);
  }

  function update(): void {
    const s = getState();
    const activeKind = s.mode.kind === 'placing-tile' ? s.mode.tileKind : null;
    for (const [kind, btn] of buttons) {
      if (kind === activeKind) {
        btn.style.background = 'var(--accent)';
        btn.style.color = 'var(--bg)';
      } else {
        btn.style.background = 'var(--bg)';
        btn.style.color = 'var(--fg)';
      }
    }
  }
  update();

  return {
    update,
    destroy() {
      container.replaceChildren();
    },
  };
}
