// @vitest-environment node
import { describe, expect, test } from 'vitest';
import type { RawCampaign } from '../../schema/campaign';
import { parseCampaign } from '../../schema/campaign';
import { canFinishAct, initialState, isPuzzleComplete, reduce } from '../state';
import { emptySave, markPuzzleComplete } from '../saves';

function tinyCampaign(): RawCampaign {
  return parseCampaign({
    version: 1,
    seed: 's1',
    theme: {
      name: 't',
      setting_summary: '',
      palette: {
        bg: '#000000',
        surface: '#111111',
        fg: '#ffffff',
        muted: '#888888',
        accent: '#ff8800',
        success: '#00cc00',
        danger: '#cc0000',
      },
      glyphs: {},
      vocabulary: {},
    },
    acts: [
      {
        id: 'act1',
        title: 'A',
        intro_text: 'I1',
        outro_text: 'O1',
        required_completions: 1,
        puzzles: [
          {
            id: 'a1p1',
            title: 'P1',
            briefing: 'b',
            grid: { w: 2, h: 1 },
            inputs: [{ pos: [0, 0], emits: ['x'], rate: 1 }],
            outputs: [{ pos: [1, 0], required: [{ type: 'x', count: 1 }] }],
            agents: [],
            obstacles: [],
            available_tiles: ['conveyor'],
            available_ops: ['MOVE'],
            constraints: { max_tiles: 4, max_cycles: 10 },
            optional_challenges: [],
          },
          {
            id: 'a1p2',
            title: 'P2',
            briefing: 'b',
            grid: { w: 2, h: 1 },
            inputs: [{ pos: [0, 0], emits: ['y'], rate: 1 }],
            outputs: [{ pos: [1, 0], required: [{ type: 'y', count: 1 }] }],
            agents: [],
            obstacles: [],
            available_tiles: ['conveyor'],
            available_ops: ['MOVE'],
            constraints: { max_tiles: 4, max_cycles: 10 },
            optional_challenges: [],
          },
        ],
      },
      {
        id: 'act2',
        title: 'B',
        intro_text: 'I2',
        outro_text: 'O2',
        required_completions: 1,
        puzzles: [
          {
            id: 'a2p1',
            title: 'P1',
            briefing: 'b',
            grid: { w: 2, h: 1 },
            inputs: [{ pos: [0, 0], emits: ['z'], rate: 1 }],
            outputs: [{ pos: [1, 0], required: [{ type: 'z', count: 1 }] }],
            agents: [],
            obstacles: [],
            available_tiles: ['conveyor'],
            available_ops: ['MOVE'],
            constraints: { max_tiles: 4, max_cycles: 10 },
            optional_challenges: [],
          },
        ],
      },
    ],
    ending: { good: 'g', neutral: 'n' },
  });
}

describe('state transitions', () => {
  const c = tinyCampaign();

  test('main_menu → SELECT_CAMPAIGN → act_intro 0', () => {
    const s = reduce(initialState(), { type: 'SELECT_CAMPAIGN' }, c);
    expect(s).toEqual({ kind: 'act_intro', actIndex: 0 });
  });

  test('act_intro → BEGIN_ACT → hub', () => {
    const s = reduce({ kind: 'act_intro', actIndex: 0 }, { type: 'BEGIN_ACT' }, c);
    expect(s).toEqual({ kind: 'hub', actIndex: 0 });
  });

  test('hub → OPEN_PUZZLE → puzzle', () => {
    const s = reduce({ kind: 'hub', actIndex: 0 }, { type: 'OPEN_PUZZLE', puzzleIndex: 1 }, c);
    expect(s).toEqual({ kind: 'puzzle', actIndex: 0, puzzleIndex: 1 });
  });

  test('OPEN_PUZZLE with out-of-range index is rejected (state unchanged)', () => {
    const hub = { kind: 'hub' as const, actIndex: 0 };
    expect(reduce(hub, { type: 'OPEN_PUZZLE', puzzleIndex: 99 }, c)).toEqual(hub);
    expect(reduce(hub, { type: 'OPEN_PUZZLE', puzzleIndex: -1 }, c)).toEqual(hub);
  });

  test('puzzle → LEAVE_PUZZLE → hub', () => {
    const s = reduce({ kind: 'puzzle', actIndex: 0, puzzleIndex: 0 }, { type: 'LEAVE_PUZZLE' }, c);
    expect(s).toEqual({ kind: 'hub', actIndex: 0 });
  });

  test('hub → FINISH_ACT → act_outro', () => {
    const s = reduce({ kind: 'hub', actIndex: 0 }, { type: 'FINISH_ACT' }, c);
    expect(s).toEqual({ kind: 'act_outro', actIndex: 0 });
  });

  test('act_outro of last act → ACT_OUTRO_NEXT → ending', () => {
    const s = reduce({ kind: 'act_outro', actIndex: 1 }, { type: 'ACT_OUTRO_NEXT' }, c);
    expect(s).toEqual({ kind: 'ending' });
  });

  test('act_outro of non-last act → ACT_OUTRO_NEXT → next act_intro', () => {
    const s = reduce({ kind: 'act_outro', actIndex: 0 }, { type: 'ACT_OUTRO_NEXT' }, c);
    expect(s).toEqual({ kind: 'act_intro', actIndex: 1 });
  });

  test('RETURN_TO_MENU from any state goes to main_menu', () => {
    const states = [
      { kind: 'act_intro' as const, actIndex: 0 },
      { kind: 'hub' as const, actIndex: 0 },
      { kind: 'puzzle' as const, actIndex: 0, puzzleIndex: 0 },
      { kind: 'act_outro' as const, actIndex: 0 },
      { kind: 'ending' as const },
    ];
    for (const s of states) {
      expect(reduce(s, { type: 'RETURN_TO_MENU' }, c)).toEqual({ kind: 'main_menu' });
    }
  });
});

describe('invalid actions are no-ops', () => {
  const c = tinyCampaign();
  test('SELECT_CAMPAIGN outside main_menu', () => {
    const hub = { kind: 'hub' as const, actIndex: 0 };
    expect(reduce(hub, { type: 'SELECT_CAMPAIGN' }, c)).toBe(hub);
  });
  test('BEGIN_ACT outside act_intro', () => {
    const main = { kind: 'main_menu' as const };
    expect(reduce(main, { type: 'BEGIN_ACT' }, c)).toBe(main);
  });
  test('LEAVE_PUZZLE outside puzzle', () => {
    const hub = { kind: 'hub' as const, actIndex: 0 };
    expect(reduce(hub, { type: 'LEAVE_PUZZLE' }, c)).toBe(hub);
  });
});

describe('canFinishAct / isPuzzleComplete', () => {
  const c = tinyCampaign();

  test('canFinishAct false until threshold met', () => {
    let save = emptySave('c1', c);
    expect(canFinishAct({ kind: 'hub', actIndex: 0 }, c, save)).toBe(false);
    save = markPuzzleComplete(save, 'act1', 'a1p1', [], 1);
    expect(canFinishAct({ kind: 'hub', actIndex: 0 }, c, save)).toBe(true);
  });

  test('canFinishAct only true in hub state', () => {
    const save = markPuzzleComplete(emptySave('c1', c), 'act1', 'a1p1', [], 1);
    expect(canFinishAct({ kind: 'main_menu' }, c, save)).toBe(false);
    expect(canFinishAct({ kind: 'act_intro', actIndex: 0 }, c, save)).toBe(false);
  });

  test('isPuzzleComplete reflects save state', () => {
    let save = emptySave('c1', c);
    expect(isPuzzleComplete(c, save, 0, 0)).toBe(false);
    save = markPuzzleComplete(save, 'act1', 'a1p1', [], 1);
    expect(isPuzzleComplete(c, save, 0, 0)).toBe(true);
    expect(isPuzzleComplete(c, save, 0, 1)).toBe(false);
  });
});
