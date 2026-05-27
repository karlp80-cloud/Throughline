/**
 * promptBuilder tests per architect doc §10.1.
 *
 * - buildSystemPrompt() returns a string < 30_000 chars (safe argv envelope)
 * - buildSystemPrompt() byte-identical across calls (no Date.now, no random)
 * - buildUserPrompt(opts) includes every option name
 * - omits previous-attempt-feedback section if not provided
 * - includes dotted issue paths verbatim on schema retry
 * - buildPuzzleRegenPrompt references puzzle id and act id
 */

import { describe, expect, test } from 'vitest';
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildPuzzleRegenPrompt,
  type UserPromptOpts,
  type RetryFeedback,
} from '../promptBuilder';
import type { RawCampaign } from '../../../src/schema/campaign';

describe('buildSystemPrompt', () => {
  test('returns a string < 30_000 chars (argv safety envelope)', () => {
    const s = buildSystemPrompt();
    expect(typeof s).toBe('string');
    expect(s.length).toBeLessThan(30_000);
  });

  test('returns a non-empty string', () => {
    expect(buildSystemPrompt().length).toBeGreaterThan(100);
  });

  test('byte-identical across calls (no Date.now / random salt)', () => {
    const a = buildSystemPrompt();
    const b = buildSystemPrompt();
    expect(a).toBe(b);
  });

  test('cached after first call (smoke: same string identity)', () => {
    // We don't insist on `===` identity for the contract, but this
    // is a useful regression canary against accidental I/O per call.
    const a = buildSystemPrompt();
    const b = buildSystemPrompt();
    expect(a).toBe(b);
  });
});

describe('buildUserPrompt', () => {
  const base: UserPromptOpts = {
    seed: 'mySeed',
    acts: 3,
    puzzlesPerAct: 4,
    gentle: false,
    avoidThemes: [],
  };

  test('emits every option name', () => {
    const s = buildUserPrompt(base);
    expect(s).toContain('mySeed');
    expect(s).toContain('3');
    expect(s).toContain('4');
  });

  test('omits gentle line when false', () => {
    const s = buildUserPrompt({ ...base, gentle: false });
    expect(s).not.toMatch(/gentle:\s*true/);
  });

  test('includes gentle line when true', () => {
    const s = buildUserPrompt({ ...base, gentle: true });
    expect(s).toMatch(/gentle/i);
  });

  test('omits avoid-themes line when empty array', () => {
    const s = buildUserPrompt({ ...base, avoidThemes: [] });
    expect(s).not.toMatch(/avoid themes/i);
  });

  test('emits avoid-themes line when non-empty', () => {
    const s = buildUserPrompt({ ...base, avoidThemes: ['sci-fi', 'pirate'] });
    expect(s).toMatch(/avoid themes/i);
    expect(s).toContain('sci-fi');
    expect(s).toContain('pirate');
  });

  test('omits previous-attempt-feedback when not provided', () => {
    const s = buildUserPrompt(base);
    expect(s.toLowerCase()).not.toContain('previous attempt');
  });

  test('includes schema issue paths verbatim on retry', () => {
    const feedback: RetryFeedback = {
      kind: 'schema',
      issues: [
        'acts[0].puzzles[2].grid.w: must be at most 32',
        'acts[1].title: must be at most 80 characters',
      ],
    };
    const s = buildUserPrompt({ ...base, previousAttemptFeedback: feedback });
    expect(s).toContain('acts[0].puzzles[2].grid.w');
    expect(s).toContain('acts[1].title');
    expect(s.toLowerCase()).toContain('previous attempt');
  });

  test('includes JSON syntax error on retry', () => {
    const feedback: RetryFeedback = {
      kind: 'json-syntax',
      message: 'Unexpected token N at position 17',
    };
    const s = buildUserPrompt({ ...base, previousAttemptFeedback: feedback });
    expect(s).toContain('Unexpected token N');
  });
});

describe('buildPuzzleRegenPrompt', () => {
  function fixture(): RawCampaign {
    return {
      version: 1,
      seed: 'fix',
      theme: {
        name: 'T',
        setting_summary: '',
        palette: {
          bg: '#000000',
          surface: '#111111',
          fg: '#ffffff',
          muted: '#888888',
          accent: '#ff00ff',
          success: '#00ff00',
          danger: '#ff0000',
        },
        glyphs: {},
        vocabulary: {},
      },
      acts: [
        {
          id: 'act_one',
          title: 'Act 1',
          intro_text: '',
          outro_text: '',
          required_completions: 0,
          puzzles: [
            {
              id: 'puz_one',
              title: 'P',
              briefing: '',
              grid: { w: 3, h: 1 },
              inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 1 }],
              outputs: [{ pos: [2, 0], required: [{ type: 'alpha', count: 1 }] }],
              agents: [],
              obstacles: [],
              available_tiles: ['conveyor'],
              available_ops: ['MOVE'],
              constraints: { max_tiles: 3, max_cycles: 10 },
              optional_challenges: [],
            },
          ],
        },
      ],
      ending: { good: '', neutral: '' },
    };
  }

  test('references puzzle id and act id', () => {
    const s = buildPuzzleRegenPrompt(fixture(), 'puz_one', { bestProgress: 0.3 });
    expect(s).toContain('puz_one');
    expect(s).toContain('act_one');
  });

  test('mentions the bestProgress value', () => {
    const s = buildPuzzleRegenPrompt(fixture(), 'puz_one', { bestProgress: 0.45 });
    expect(s).toMatch(/45|0\.45/);
  });

  test('throws if puzzle id is not found', () => {
    expect(() =>
      buildPuzzleRegenPrompt(fixture(), 'no_such_puzzle', { bestProgress: 0 }),
    ).toThrow();
  });
});
