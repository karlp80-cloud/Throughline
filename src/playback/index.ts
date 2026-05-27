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
import type { AudioController } from '../audio';
import { detectCompletion } from '../completion/detector';
import { mountResultsPanel, type ResultsPanelHandle } from '../completion/dom/resultsPanel';
import { initialWorld, runUntilHalt } from '../engine';
import type { CycleTrace, Puzzle, Solution } from '../engine';
import { render } from '../render/renderer';
import { createAnimator, type Animator } from './animator';
import { mountControls } from './dom/controls';

export interface PlaybackHandle {
  destroy(): void;
  /** For tests/inspection — read-only-ish access to the underlying animator. */
  animator(): Animator;
  /** The precomputed trace this session was built from. */
  trace(): readonly CycleTrace[];
  /** The engine's halt status from the original computation. */
  haltStatus(): import('../engine').EngineStatus;
}

export function mountPlayback(
  container: HTMLElement,
  puzzle: Puzzle,
  solution: Solution,
  onReset: () => void,
  audio?: AudioController,
  onReturnToHub?: () => void,
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
  const resultsEl = document.createElement('div');
  container.append(controlsEl, canvasContainer, resultsEl);

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
  // Tracks the last frame we emitted SFX for so we don't re-trigger
  // sounds on every paint within a cycle.
  let rafId = 0;
  let lastTs = 0;
  let lastSfxFrame = animator.frame();
  function loop(ts: number): void {
    const dt = lastTs === 0 ? 0 : ts - lastTs;
    lastTs = ts;
    animator.tick(dt);
    paint();
    if (audio && animator.frame() !== lastSfxFrame) {
      // Emit SFX for every NEW frame since lastSfxFrame.
      for (let f = lastSfxFrame + 1; f <= animator.frame(); f++) {
        const ct = result.trace[f];
        if (ct) emitFrameSfx(ct, audio);
      }
      lastSfxFrame = animator.frame();
    }
    rafId = requestAnimationFrame(loop);
  }
  rafId = requestAnimationFrame(loop);

  // Repaint immediately on any animator update from a non-tick source
  // (manual step, reset, etc.).
  // Also mount the results panel on transition into 'finished'.
  let resultsPanel: ResultsPanelHandle | null = null;
  let lastStatus = animator.status();
  const offUpdate = animator.onUpdate(() => {
    paint();
    const s = animator.status();
    if (s === 'finished' && lastStatus !== 'finished') {
      const completion = detectCompletion(puzzle, solution, result.trace);
      resultsPanel = mountResultsPanel(
        resultsEl,
        completion,
        animator.haltStatus(),
        onReturnToHub ? { onReturnToHub } : {},
      );
      if (audio) {
        audio.playSfx(animator.haltStatus() === 'victory' ? 'success' : 'failure');
      }
    } else if (s !== 'finished' && lastStatus === 'finished') {
      // e.g. reset back to idle — clear the panel
      resultsPanel?.destroy();
      resultsPanel = null;
      resultsEl.replaceChildren();
    }
    lastStatus = s;
  });

  return {
    animator: () => animator,
    trace: () => result.trace,
    haltStatus: () => result.status,
    destroy() {
      cancelAnimationFrame(rafId);
      offUpdate();
      controls.destroy();
      resultsPanel?.destroy();
      container.replaceChildren();
    },
  };
}

function emitFrameSfx(trace: CycleTrace, audio: AudioController): void {
  // Per-agent SFX. Dedupe sounds so a busy frame doesn't spam — at
  // most one of each kind per cycle is plenty for the player to hear.
  let grabbed = false;
  let dropped = false;
  let moved = false;
  for (const e of trace.agentEvents) {
    const kind = e.opExecuted.kind;
    if (kind === 'GRAB' && !grabbed) {
      audio.playSfx('cargo_grab');
      grabbed = true;
    } else if (kind === 'DROP' && !dropped) {
      audio.playSfx('cargo_drop');
      dropped = true;
    } else if (kind === 'MOVE' && (e.from[0] !== e.to[0] || e.from[1] !== e.to[1]) && !moved) {
      audio.playSfx('agent_step');
      moved = true;
    }
  }
}

// Note: `window.__playback` is declared in src/main.ts (the canonical
// location for harness-owned globals). This module just exposes
// `PlaybackHandle` as the public type.
