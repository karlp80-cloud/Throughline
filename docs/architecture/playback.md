# Playback Architecture Notes (Phase 4)

> **Light cycle.** Manual feel review is the reviewer.
> **Companion:** [IMPLEMENTATION_PLAN.md § Phase 4](../../IMPLEMENTATION_PLAN.md).

## Strategy

The engine produces a `CycleTrace[]` from `runUntilHalt` BEFORE animation starts — the engine and the renderer never step in lockstep at frame rate. The animator just advances which trace frame is shown on a wall-clock timer; the renderer paints the corresponding `worldAfter`.

v1 is **discrete frame stepping** (no inter-cycle interpolation). Each cycle's `worldAfter` is rendered for `frameDuration / speed` ms, then the next is shown. Cargo and agents "teleport" cell-to-cell on cycle boundaries. If the feel review says this is too jarring, Phase 4 will iterate to interpolated positions; the public animator API stays the same.

## State machine

```
idle ──▶ running ──▶ paused
   ▲       │
   │       └──▶ finished (last frame, status === victory or limit-exceeded)
   │
   └── reset ── any state
```

`step()` works in `idle` and `paused`. `setSpeed` works in any state. `reset()` returns to `idle` and restores the editor.

Speeds: **×0.5, ×1, ×2, ×4**. ×1 = one cycle per 600 ms (~1.67 cycles/sec). All speeds scale the cycle duration linearly.

## Module layout

```
src/playback/
├── animator.ts          # pure-ish state + tick; no DOM
├── animator.test.ts     # fake-clock unit tests
├── dom/
│   └── controls.ts      # toolbar (Run, Pause, Step, Speed, Reset)
└── index.ts             # mountPlayback: wires animator + controls + renderer
```

## Animator API

```ts
type AnimatorStatus = 'idle' | 'running' | 'paused' | 'finished';

interface Animator {
  status(): AnimatorStatus;
  /** Index of the current `CycleTrace`; -1 before cycle 0 has been displayed. */
  frame(): number;
  /** Currently-displayed WorldState; the initial world before cycle 0 runs. */
  currentWorld(): WorldState;
  /** RunResult.status from the original computation. */
  haltStatus(): EngineStatus;
  speed(): 0.5 | 1 | 2 | 4;

  play(): void;
  pause(): void;
  step(): void;
  setSpeed(s: 0.5 | 1 | 2 | 4): void;
  reset(): void;

  /** Advance internal clock by deltaMs. Called from the RAF driver. */
  tick(deltaMs: number): void;

  /** Subscribe to state changes; fires after every tick that advances the frame. */
  onUpdate(handler: () => void): () => void;
}
```

The animator is pure-ish: `tick` is deterministic given `(animator state, deltaMs)`. No `Date.now`, no `Math.random`. Unit tests inject a fake `Clock` interface and assert frame advances against expected `deltaMs` sequences.

## RAF driver

`mountPlayback` owns a `requestAnimationFrame` loop. On each frame:

```ts
const dt = ts - lastTs;
animator.tick(dt);
if (animator.frame() !== lastFrame) {
  render(ctx, animator.currentWorld(), puzzle, solution);
  lastFrame = animator.frame();
}
```

The render call is the same `render()` from Phase 2 — playback reuses the renderer, no separate paint code. Animation only RE-paints when the displayed frame index changes; mid-frame ticks are no-ops.

## Editor integration

The editor (Phase 3) has a **Run** button (added this phase) that:

1. Reads `state.draft` from the editor handle.
2. Calls `runUntilHalt(puzzle, draft)` → `RunResult`.
3. Hides the editor's input handlers (clicks no longer dispatch).
4. Mounts the playback controls + RAF loop.
5. Animation begins at speed ×1, status `running`.

**Reset** unmounts the playback layer and restores the editor — the editor's reducer state is preserved (we never destroyed it), so the player picks up exactly where they left off.

## Test contract

- **Unit (`animator.test.ts`):** every state transition; tick semantics at each speed; `step()` outside running mode; `reset()` from each state.
- **E2E (`playback.spec.ts`):** load the editor, place a trivial solving solution, click Run, wait N animation ticks, assert agent has moved on the canvas via `window.__editor`-style hook OR via screenshot diff.

## What this phase does NOT do

- Smooth between-frame interpolation (deferred unless feel review demands it)
- Sound effects on cycle boundaries (Phase 6)
- Visual "cycle counter" or progress bar (could fit in this phase as polish)
- Bookmarking specific frames
- Undo/redo of cycles (the trace is immutable; reset is the only "rewind")
