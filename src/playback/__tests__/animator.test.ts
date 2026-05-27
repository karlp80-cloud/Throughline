// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { initialWorld } from '../../engine';
import { makePuzzle, makeSolution } from '../../engine/__tests__/helpers';
import { runUntilHalt } from '../../engine/run';
import { conveyor } from '../../engine/__tests__/helpers';
import { createAnimator, BASE_CYCLE_MS } from '../animator';

function makeTrivialAnim() {
  // Trivial 2-cycle puzzle: input → conveyor → output requires 2 alpha.
  // Cycle 0: emit + move + deliver (1). Cycle 1: emit + move + deliver (2). Victory.
  const puzzle = makePuzzle({
    grid: { w: 2, h: 1 },
    inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 1 }],
    outputs: [{ pos: [1, 0], required: [{ type: 'alpha', count: 2 }] }],
    constraints: { maxTiles: 4, maxCycles: 10 },
  });
  const solution = makeSolution([conveyor([0, 0], 'E')]);
  const r = runUntilHalt(puzzle, solution);
  return {
    puzzle,
    solution,
    result: r,
    animator: createAnimator({
      trace: r.trace,
      initialWorld: initialWorld(puzzle),
      haltStatus: r.status,
    }),
  };
}

describe('createAnimator initial state', () => {
  test('starts idle at frame -1 showing initialWorld', () => {
    const { animator, puzzle } = makeTrivialAnim();
    expect(animator.status()).toBe('idle');
    expect(animator.frame()).toBe(-1);
    expect(animator.speed()).toBe(1);
    expect(animator.currentWorld()).toEqual(initialWorld(puzzle));
  });

  test('haltStatus is exposed from the original RunResult', () => {
    const { animator, result } = makeTrivialAnim();
    expect(animator.haltStatus()).toBe(result.status);
    expect(animator.haltStatus()).toBe('victory');
  });

  test('an empty trace starts finished', () => {
    const puzzle = makePuzzle({ grid: { w: 1, h: 1 } });
    const a = createAnimator({
      trace: [],
      initialWorld: initialWorld(puzzle),
      haltStatus: 'cycle_limit_exceeded',
    });
    expect(a.status()).toBe('finished');
  });
});

describe('play / pause / tick', () => {
  test('play() transitions idle -> running', () => {
    const { animator } = makeTrivialAnim();
    animator.play();
    expect(animator.status()).toBe('running');
  });

  test('pause() transitions running -> paused', () => {
    const { animator } = makeTrivialAnim();
    animator.play();
    animator.pause();
    expect(animator.status()).toBe('paused');
  });

  test('tick() while idle is a no-op', () => {
    const { animator } = makeTrivialAnim();
    animator.tick(10_000);
    expect(animator.frame()).toBe(-1);
    expect(animator.status()).toBe('idle');
  });

  test('tick() while running advances exactly one frame per BASE_CYCLE_MS at speed 1', () => {
    const { animator } = makeTrivialAnim();
    animator.play();
    // Less than one cycle's worth → no advance.
    animator.tick(BASE_CYCLE_MS - 1);
    expect(animator.frame()).toBe(-1);
    // Now cross the boundary.
    animator.tick(1);
    expect(animator.frame()).toBe(0);
    // Another full cycle → reaches frame 1 (the last one). Status flips.
    animator.tick(BASE_CYCLE_MS);
    expect(animator.frame()).toBe(1);
    expect(animator.status()).toBe('finished');
  });

  test('tick can advance multiple frames in one call', () => {
    const { animator } = makeTrivialAnim();
    animator.play();
    animator.tick(BASE_CYCLE_MS * 5);
    // Trace only has 2 frames; status is finished.
    expect(animator.frame()).toBe(1);
    expect(animator.status()).toBe('finished');
  });

  test('higher speed advances faster', () => {
    const { animator } = makeTrivialAnim();
    animator.setSpeed(2);
    animator.play();
    animator.tick(BASE_CYCLE_MS / 2);
    expect(animator.frame()).toBe(0);
  });

  test('lower speed advances slower', () => {
    const { animator } = makeTrivialAnim();
    animator.setSpeed(0.5);
    animator.play();
    animator.tick(BASE_CYCLE_MS);
    expect(animator.frame()).toBe(-1); // not yet — needs 2 * BASE
    animator.tick(BASE_CYCLE_MS);
    expect(animator.frame()).toBe(0);
  });

  test('play() while finished is a no-op', () => {
    const { animator } = makeTrivialAnim();
    animator.play();
    animator.tick(BASE_CYCLE_MS * 10);
    expect(animator.status()).toBe('finished');
    animator.play();
    expect(animator.status()).toBe('finished');
  });
});

describe('step', () => {
  test('step() in idle advances to frame 0 and pauses', () => {
    const { animator } = makeTrivialAnim();
    animator.step();
    expect(animator.frame()).toBe(0);
    expect(animator.status()).toBe('paused');
  });

  test('step() in paused advances one frame', () => {
    const { animator } = makeTrivialAnim();
    animator.play();
    animator.tick(BASE_CYCLE_MS);
    animator.pause();
    expect(animator.frame()).toBe(0);
    animator.step();
    expect(animator.frame()).toBe(1);
    // Reached last frame; should be finished.
    expect(animator.status()).toBe('finished');
  });

  test('step() in running is ignored', () => {
    const { animator } = makeTrivialAnim();
    animator.play();
    const f0 = animator.frame();
    animator.step();
    expect(animator.frame()).toBe(f0);
    expect(animator.status()).toBe('running');
  });

  test('step() at the last frame leaves status finished', () => {
    const { animator } = makeTrivialAnim();
    animator.step();
    animator.step();
    expect(animator.frame()).toBe(1);
    expect(animator.status()).toBe('finished');
    // Further steps are no-ops.
    animator.step();
    expect(animator.frame()).toBe(1);
  });
});

describe('reset', () => {
  test('reset() from running returns to idle at frame -1', () => {
    const { animator } = makeTrivialAnim();
    animator.play();
    animator.tick(BASE_CYCLE_MS);
    animator.reset();
    expect(animator.status()).toBe('idle');
    expect(animator.frame()).toBe(-1);
  });

  test('reset() from finished returns to idle', () => {
    const { animator } = makeTrivialAnim();
    animator.play();
    animator.tick(BASE_CYCLE_MS * 10);
    expect(animator.status()).toBe('finished');
    animator.reset();
    expect(animator.status()).toBe('idle');
    expect(animator.frame()).toBe(-1);
  });

  test('reset() clears any accumulated tick time', () => {
    const { animator } = makeTrivialAnim();
    animator.play();
    animator.tick(BASE_CYCLE_MS - 1);
    animator.reset();
    animator.play();
    animator.tick(1); // not enough on its own; would have been if leftover were kept
    expect(animator.frame()).toBe(-1);
  });
});

describe('setSpeed', () => {
  test('setSpeed clears accumulated time so the new pacing starts cleanly', () => {
    const { animator } = makeTrivialAnim();
    animator.play();
    animator.tick(BASE_CYCLE_MS - 50);
    animator.setSpeed(2);
    // Old accumulator would have been 550ms; new pacing wants 300ms per cycle.
    // We zero accum to avoid surprise jumps.
    animator.tick(BASE_CYCLE_MS / 2 - 50);
    expect(animator.frame()).toBe(-1);
    animator.tick(50);
    expect(animator.frame()).toBe(0);
  });
});

describe('onUpdate', () => {
  test('fires when the frame advances', () => {
    const { animator } = makeTrivialAnim();
    let calls = 0;
    animator.onUpdate(() => {
      calls += 1;
    });
    animator.play();
    animator.tick(BASE_CYCLE_MS);
    // Called at least once after play and once after the frame advance.
    expect(calls).toBeGreaterThanOrEqual(1);
  });

  test('fires on reset', () => {
    const { animator } = makeTrivialAnim();
    let fired = false;
    animator.onUpdate(() => {
      fired = true;
    });
    animator.reset();
    expect(fired).toBe(true);
  });

  test('unsubscribe stops further calls', () => {
    const { animator } = makeTrivialAnim();
    let calls = 0;
    const off = animator.onUpdate(() => {
      calls += 1;
    });
    animator.play();
    off();
    animator.tick(BASE_CYCLE_MS * 5);
    expect(calls).toBeLessThanOrEqual(1); // only the play() call counted
  });
});
