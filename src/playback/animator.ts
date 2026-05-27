/**
 * Discrete-frame animator.
 *
 * Consumes a precomputed `CycleTrace[]` and drives playback by
 * accumulating wall-clock time via `tick(deltaMs)`. The frame index
 * advances when accumulated time crosses `cycleDurationMs(speed)`.
 *
 * Pure: no Date.now / RAF / setTimeout internally. The harness owns
 * the RAF loop and passes deltas in. Tests inject deltas directly.
 *
 * See docs/architecture/playback.md for the design.
 */

import type { CycleTrace, EngineStatus, WorldState } from '../engine';

export type AnimatorStatus = 'idle' | 'running' | 'paused' | 'finished';
export type Speed = 0.5 | 1 | 2 | 4;

/** Cycle duration at ×1 speed. ~1.67 cycles/sec. */
export const BASE_CYCLE_MS = 600;

export function cycleDurationMs(speed: Speed): number {
  return BASE_CYCLE_MS / speed;
}

export interface AnimatorOptions {
  readonly trace: readonly CycleTrace[];
  readonly initialWorld: WorldState;
  readonly haltStatus: EngineStatus;
}

export interface Animator {
  status(): AnimatorStatus;
  /** Index of the "from" frame for interpolation. -1 = initialWorld. */
  frame(): number;
  currentWorld(): WorldState;
  /** World we're interpolating TO; null when there's no next frame. */
  nextWorld(): WorldState | null;
  /** Progress [0,1] from currentWorld → nextWorld within this cycle. */
  alpha(): number;
  haltStatus(): EngineStatus;
  speed(): Speed;
  play(): void;
  pause(): void;
  step(): void;
  setSpeed(s: Speed): void;
  reset(): void;
  tick(deltaMs: number): void;
  onUpdate(handler: () => void): () => void;
}

export function createAnimator(opts: AnimatorOptions): Animator {
  let status: AnimatorStatus = opts.trace.length === 0 ? 'finished' : 'idle';
  let frame = -1;
  let speed: Speed = 1;
  let accumMs = 0;
  const handlers = new Set<() => void>();

  function emit(): void {
    for (const h of handlers) h();
  }

  function world(): WorldState {
    if (frame < 0) return opts.initialWorld;
    const t = opts.trace[frame];
    return t ? t.worldAfter : opts.initialWorld;
  }

  // Advance by one frame; updates status if we hit the end. Returns
  // true iff the frame index actually moved.
  function advanceOne(): boolean {
    if (frame >= opts.trace.length - 1) {
      status = 'finished';
      return false;
    }
    frame += 1;
    if (frame >= opts.trace.length - 1) {
      status = 'finished';
    }
    return true;
  }

  function nextWorld(): WorldState | null {
    const next = frame + 1;
    if (next < 0 || next >= opts.trace.length) return null;
    const t = opts.trace[next];
    return t ? t.worldAfter : null;
  }

  return {
    status: () => status,
    frame: () => frame,
    currentWorld: world,
    nextWorld,
    alpha: () => {
      if (status === 'finished') return 0;
      const dur = cycleDurationMs(speed);
      const a = accumMs / dur;
      return a < 0 ? 0 : a > 1 ? 1 : a;
    },
    haltStatus: () => opts.haltStatus,
    speed: () => speed,

    play() {
      if (status === 'finished') return;
      status = 'running';
      accumMs = 0;
      emit();
    },

    pause() {
      if (status === 'running') {
        status = 'paused';
        emit();
      }
    },

    step() {
      if (status === 'running' || status === 'finished') return;
      const moved = advanceOne();
      if (!moved) return;
      // advanceOne flipped status to 'finished' iff we landed on the
      // last frame. Otherwise we want a manual step to land in 'paused'.
      if (frame < opts.trace.length - 1) status = 'paused';
      emit();
    },

    setSpeed(s) {
      speed = s;
      accumMs = 0;
      emit();
    },

    reset() {
      status = opts.trace.length === 0 ? 'finished' : 'idle';
      frame = -1;
      accumMs = 0;
      emit();
    },

    tick(deltaMs) {
      if (status !== 'running') return;
      accumMs += deltaMs;
      const dur = cycleDurationMs(speed);
      const startFrame = frame;
      const startStatus = status;
      while (accumMs >= dur) {
        accumMs -= dur;
        const moved = advanceOne();
        if (!moved) {
          accumMs = 0;
          break;
        }
        if (status !== 'running') break;
      }
      if (frame !== startFrame || status !== startStatus) emit();
    },

    onUpdate(h) {
      handlers.add(h);
      return () => {
        handlers.delete(h);
      };
    },
  };
}
