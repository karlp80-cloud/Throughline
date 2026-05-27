/**
 * Mount the playback view: canvas + controls + RAF loop.
 *
 * `mountPlayback(container, puzzle, solution, onReset) → { destroy }`
 *
 * Precomputes the trace via `runUntilHalt`, mounts the canvas and
 * the playback controls, and starts a requestAnimationFrame loop
 * that ticks the animator with the wall-clock delta. The render
 * call only repaints when the animator's frame index changes; idle
 * ticks are no-ops.
 *
 * The harness owns the RAF; the animator stays platform-agnostic.
 */

import { mountCanvas } from '../app/canvasMount';
import { initialWorld, runUntilHalt } from '../engine';
import type { Puzzle, Solution } from '../engine';
import { render } from '../render/renderer';
import { createAnimator, type Animator } from './animator';
import { mountControls } from './dom/controls';

export interface PlaybackHandle {
  destroy(): void;
  /** For tests/inspection — read-only-ish access to the underlying animator. */
  animator(): Animator;
}

export function mountPlayback(
  container: HTMLElement,
  puzzle: Puzzle,
  solution: Solution,
  onReset: () => void,
): PlaybackHandle {
  const result = runUntilHalt(puzzle, solution);
  const init = initialWorld(puzzle);
  const animator = createAnimator({
    trace: result.trace,
    initialWorld: init,
    haltStatus: result.status,
  });

  // DOM scaffolding.
  container.replaceChildren();
  const controlsEl = document.createElement('div');
  const canvasContainer = document.createElement('div');
  container.append(controlsEl, canvasContainer);

  const canvas = mountCanvas(canvasContainer, puzzle, solution, init);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  function paint(): void {
    const next = animator.nextWorld();
    const a = animator.alpha();
    const tr = animator.nextTrace();
    render(ctx!, animator.currentWorld(), puzzle, solution, {
      showPaths: true,
      ...(next !== null ? { nextWorld: next, alpha: a } : {}),
      ...(tr !== null ? { trace: tr } : {}),
    });
  }
  paint();

  const controls = mountControls(controlsEl, animator, () => onReset());

  // Auto-start so Run → playback is a single click. User can hit
  // Pause in the controls if they want to inspect a frame.
  animator.play();

  // RAF driver. Ticks the animator with the wall-clock delta and
  // repaints every frame so cargo/agents lerp visibly between cycles.
  let rafId = 0;
  let lastTs = 0;
  function loop(ts: number): void {
    const dt = lastTs === 0 ? 0 : ts - lastTs;
    lastTs = ts;
    animator.tick(dt);
    paint();
    rafId = requestAnimationFrame(loop);
  }
  rafId = requestAnimationFrame(loop);

  // Repaint immediately on any animator update from a non-tick source
  // (manual step, reset, etc.).
  const offUpdate = animator.onUpdate(paint);

  return {
    animator: () => animator,
    destroy() {
      cancelAnimationFrame(rafId);
      offUpdate();
      controls.destroy();
      container.replaceChildren();
    },
  };
}

// Note: `window.__playback` is declared in src/main.ts (the canonical
// location for harness-owned globals). This module just exposes
// `PlaybackHandle` as the public type.
