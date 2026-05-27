/**
 * One puzzle's full edit-and-play session.
 *
 * Owns the editor↔playback view toggle that previously lived in
 * `main.ts`. The campaign harness mounts a fresh session per puzzle.
 *
 * Lifecycle:
 *   mount → editor → Run → playback → Reset → editor → …
 *   `onVictory` fires the FIRST time playback finishes with victory
 *   for a given session; subsequent Run/Reset rounds don't re-fire.
 *
 * `destroy()` tears down both views and clears the container.
 */

import type { AudioController } from '../audio';
import { detectCompletion, type ChallengeResult } from '../completion/detector';
import type { Puzzle, Solution } from '../engine';
import { mountEditor, type EditorHandle } from '../editor';
import { mountPlayback, type PlaybackHandle } from '../playback';

export interface PuzzleSessionCallbacks {
  /**
   * Fires the first time the puzzle is solved this session.
   * Receives the per-challenge results so the campaign harness can
   * record earned optionals.
   */
  readonly onVictory?: (optionals: readonly ChallengeResult[]) => void;
  /**
   * Fires when the player clicks "Back to hub" in the results panel.
   * The harness routes this to a LEAVE_PUZZLE dispatch.
   */
  readonly onLeave?: () => void;
}

export interface PuzzleSessionHandle {
  readonly editor: () => EditorHandle | null;
  readonly playback: () => PlaybackHandle | null;
  readonly runButton: HTMLButtonElement;
  destroy(): void;
}

export function mountPuzzleSession(
  container: HTMLElement,
  puzzle: Puzzle,
  callbacks: PuzzleSessionCallbacks = {},
  audio?: AudioController,
): PuzzleSessionHandle {
  container.replaceChildren();
  container.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';

  const actions = document.createElement('div');
  actions.style.cssText = 'display: flex; gap: 8px; align-items: center;';
  const runBtn = document.createElement('button');
  runBtn.type = 'button';
  runBtn.id = 'run-button';
  runBtn.textContent = '▶ Run';
  runBtn.style.cssText = `
    padding: 6px 14px; background: var(--accent); color: var(--bg);
    border: 1px solid var(--accent); border-radius: 4px; cursor: pointer;
    font: inherit; font-weight: 600;
  `;
  actions.appendChild(runBtn);
  container.appendChild(actions);

  const sub = document.createElement('div');
  container.appendChild(sub);

  let editorHandle: EditorHandle | null = null;
  let playbackHandle: PlaybackHandle | null = null;
  let lastDraft: Solution | undefined;
  let victoryFired = false;

  function switchToEdit(): void {
    if (playbackHandle) {
      playbackHandle.destroy();
      playbackHandle = null;
      if (typeof window !== 'undefined') delete window.__playback;
    }
    editorHandle = mountEditor(sub, puzzle, lastDraft, audio);
    if (typeof window !== 'undefined') window.__editor = editorHandle;
    runBtn.disabled = false;
  }

  function switchToPlay(): void {
    if (!editorHandle) return;
    lastDraft = editorHandle.getState().draft;
    editorHandle.destroy();
    editorHandle = null;
    if (typeof window !== 'undefined') delete window.__editor;
    audio?.startLoop('puzzle');
    const handle = mountPlayback(
      sub,
      puzzle,
      lastDraft,
      () => switchToEdit(),
      audio,
      callbacks.onLeave,
    );
    playbackHandle = handle;
    if (typeof window !== 'undefined') window.__playback = handle;
    runBtn.disabled = true;
    if (callbacks.onVictory && !victoryFired) {
      const animator = handle.animator();
      const off = animator.onUpdate(() => {
        if (
          !victoryFired &&
          animator.status() === 'finished' &&
          handle.haltStatus() === 'victory'
        ) {
          victoryFired = true;
          const completion = detectCompletion(puzzle, lastDraft!, handle.trace());
          callbacks.onVictory?.(completion.optionals);
          off();
        }
      });
    }
  }

  runBtn.addEventListener('click', () => switchToPlay());
  switchToEdit();

  return {
    editor: () => editorHandle,
    playback: () => playbackHandle,
    runButton: runBtn,
    destroy() {
      playbackHandle?.destroy();
      playbackHandle = null;
      editorHandle?.destroy();
      editorHandle = null;
      if (typeof window !== 'undefined') {
        delete window.__editor;
        delete window.__playback;
      }
      container.replaceChildren();
    },
  };
}
