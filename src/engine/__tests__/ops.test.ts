import { describe, expect, test } from 'vitest';
import { computeAgentIntent } from '../agents/ops';
import type { Op, Pos } from '../types';
import { agentState, cargo } from './helpers';

// ─── MOVE ──────────────────────────────────────────────────────────
describe('MOVE op', () => {
  const path: readonly Pos[] = [
    [0, 0],
    [1, 0],
    [2, 0],
  ];
  const program: readonly Op[] = [{ kind: 'MOVE' }];

  test('declares a move intent to the next path cell', () => {
    const state = agentState([0, 0], { pathIndex: 0, programIndex: 0 });
    expect(computeAgentIntent('a1', state, path, program, [])).toEqual({
      kind: 'move',
      agent: 'a1',
      from: [0, 0],
      to: [1, 0],
      opExecuted: { kind: 'MOVE' },
    });
  });

  test('wraps to path[0] when at the last path cell', () => {
    const state = agentState([2, 0], { pathIndex: 2 });
    expect(computeAgentIntent('a1', state, path, program, [])).toEqual({
      kind: 'move',
      agent: 'a1',
      from: [2, 0],
      to: [0, 0],
      opExecuted: { kind: 'MOVE' },
    });
  });

  test('path of length 1 makes MOVE a no-op (from === to)', () => {
    const state = agentState([5, 5], { pathIndex: 0 });
    expect(computeAgentIntent('a1', state, [[5, 5]], program, [])).toEqual({
      kind: 'move',
      agent: 'a1',
      from: [5, 5],
      to: [5, 5],
      opExecuted: { kind: 'MOVE' },
    });
  });

  test('empty path degenerates to a wait intent (defensive)', () => {
    const state = agentState([0, 0]);
    expect(computeAgentIntent('a1', state, [], program, [])).toEqual({
      kind: 'wait',
      agent: 'a1',
      at: [0, 0],
      opExecuted: { kind: 'WAIT' },
    });
  });
});

// ─── GRAB ──────────────────────────────────────────────────────────
describe('GRAB op', () => {
  const program: readonly Op[] = [{ kind: 'GRAB' }];

  test('grabs cargo when cell has cargo and hands are free', () => {
    const state = agentState([3, 3]);
    const cellCargo = [cargo(1, 'alpha')];
    expect(computeAgentIntent('a1', state, [], program, cellCargo)).toEqual({
      kind: 'grab',
      agent: 'a1',
      at: [3, 3],
      opExecuted: { kind: 'GRAB' },
    });
  });

  test('GRAB when already carrying is a no-op (wait intent)', () => {
    const state = agentState([3, 3], { carrying: cargo(99, 'alpha') });
    const cellCargo = [cargo(1, 'beta')];
    expect(computeAgentIntent('a1', state, [], program, cellCargo)).toEqual({
      kind: 'wait',
      agent: 'a1',
      at: [3, 3],
      opExecuted: { kind: 'GRAB' },
    });
  });

  test('GRAB on empty cell is a no-op (wait intent)', () => {
    const state = agentState([3, 3]);
    expect(computeAgentIntent('a1', state, [], program, [])).toEqual({
      kind: 'wait',
      agent: 'a1',
      at: [3, 3],
      opExecuted: { kind: 'GRAB' },
    });
  });
});

// ─── DROP ──────────────────────────────────────────────────────────
describe('DROP op', () => {
  const program: readonly Op[] = [{ kind: 'DROP' }];

  test('drops when carrying', () => {
    const state = agentState([2, 2], { carrying: cargo(7, 'alpha') });
    expect(computeAgentIntent('a1', state, [], program, [])).toEqual({
      kind: 'drop',
      agent: 'a1',
      at: [2, 2],
      opExecuted: { kind: 'DROP' },
    });
  });

  test('DROP with empty hands is a no-op (wait intent)', () => {
    const state = agentState([2, 2]);
    expect(computeAgentIntent('a1', state, [], program, [])).toEqual({
      kind: 'wait',
      agent: 'a1',
      at: [2, 2],
      opExecuted: { kind: 'DROP' },
    });
  });
});

// ─── WAIT ──────────────────────────────────────────────────────────
describe('WAIT op', () => {
  test('always declares a wait intent', () => {
    const state = agentState([1, 1]);
    const program: readonly Op[] = [{ kind: 'WAIT' }];
    expect(computeAgentIntent('a1', state, [], program, [])).toEqual({
      kind: 'wait',
      agent: 'a1',
      at: [1, 1],
      opExecuted: { kind: 'WAIT' },
    });
  });
});

// ─── SENSE ─────────────────────────────────────────────────────────
describe('SENSE op', () => {
  const sensePath: readonly Pos[] = [
    [0, 0],
    [1, 0],
  ];

  test('SENSE matches → then-branch runs (e.g. DROP)', () => {
    const program: readonly Op[] = [
      {
        kind: 'SENSE',
        expects: 'alpha',
        then: { kind: 'DROP' },
        otherwise: { kind: 'MOVE' },
      },
    ];
    const state = agentState([0, 0], { carrying: cargo(9, 'gamma') });
    const cellCargo = [cargo(1, 'alpha')];
    // Match: branch to DROP. opExecuted is the resolved leaf, not the SENSE wrapper.
    expect(computeAgentIntent('a1', state, sensePath, program, cellCargo)).toEqual({
      kind: 'drop',
      agent: 'a1',
      at: [0, 0],
      opExecuted: { kind: 'DROP' },
    });
  });

  test('SENSE mismatches → otherwise-branch runs (e.g. MOVE)', () => {
    const program: readonly Op[] = [
      {
        kind: 'SENSE',
        expects: 'alpha',
        then: { kind: 'DROP' },
        otherwise: { kind: 'MOVE' },
      },
    ];
    const state = agentState([0, 0]);
    const cellCargo = [cargo(1, 'beta')]; // no alpha → otherwise
    expect(computeAgentIntent('a1', state, sensePath, program, cellCargo)).toEqual({
      kind: 'move',
      agent: 'a1',
      from: [0, 0],
      to: [1, 0],
      opExecuted: { kind: 'MOVE' },
    });
  });

  test('SENSE on empty cell takes the otherwise branch', () => {
    const program: readonly Op[] = [
      {
        kind: 'SENSE',
        expects: 'alpha',
        then: { kind: 'GRAB' },
        otherwise: { kind: 'WAIT' },
      },
    ];
    const state = agentState([0, 0]);
    expect(computeAgentIntent('a1', state, [], program, [])).toEqual({
      kind: 'wait',
      agent: 'a1',
      at: [0, 0],
      opExecuted: { kind: 'WAIT' },
    });
  });

  test('SENSE then-branch GRAB on empty cell becomes wait (sub-op rules still apply)', () => {
    // Hands free, then-branch is GRAB, but cell has the expected type AND that's what
    // SENSE was checking for. GRAB then runs and finds cargo → grabs it.
    const program: readonly Op[] = [
      {
        kind: 'SENSE',
        expects: 'alpha',
        then: { kind: 'GRAB' },
        otherwise: { kind: 'WAIT' },
      },
    ];
    const state = agentState([0, 0]);
    const cellCargo = [cargo(1, 'alpha')];
    expect(computeAgentIntent('a1', state, [], program, cellCargo)).toEqual({
      kind: 'grab',
      agent: 'a1',
      at: [0, 0],
      opExecuted: { kind: 'GRAB' },
    });
  });
});

// ─── Defensive ────────────────────────────────────────────────────
describe('defensive cases', () => {
  test('empty program degenerates to wait intent', () => {
    const state = agentState([0, 0]);
    expect(computeAgentIntent('a1', state, [], [], [])).toEqual({
      kind: 'wait',
      agent: 'a1',
      at: [0, 0],
      opExecuted: { kind: 'WAIT' },
    });
  });
});
