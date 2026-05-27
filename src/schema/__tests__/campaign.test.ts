// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { CampaignParseError, parseCampaign } from '../campaign';

function validManifest(): unknown {
  return {
    version: 1,
    seed: 'abc123',
    theme: {
      name: 'The Aetherium Heist',
      setting_summary: 'Renaissance alchemy meets heist caper',
      palette: {
        bg: '#1a1820',
        surface: '#241f29',
        fg: '#e8d8b0',
        muted: '#7a6a55',
        accent: '#c87650',
        success: '#82c08a',
        danger: '#d06060',
      },
      glyphs: { input: 'alembic' },
      vocabulary: { cargo: 'essence' },
    },
    acts: [
      {
        id: 'act1',
        title: 'The Unsealed Vault',
        intro_text: 'Begin.',
        outro_text: 'Done.',
        required_completions: 1,
        puzzles: [
          {
            id: 'act1_p1',
            title: 'First Distillation',
            briefing: 'Move one cargo from input to output.',
            grid: { w: 4, h: 1 },
            inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 1 }],
            outputs: [{ pos: [3, 0], required: [{ type: 'alpha', count: 1 }] }],
            agents: [],
            obstacles: [],
            available_tiles: ['conveyor'],
            available_ops: ['MOVE'],
            constraints: { max_tiles: 4, max_cycles: 10 },
            optional_challenges: [
              { id: 'opt_fast', label: 'Solve in <10 cycles', rule: 'cycles < 10' },
            ],
          },
        ],
      },
    ],
    ending: { good: 'Victory.', neutral: 'It was fine.' },
  };
}

describe('parseCampaign: happy path', () => {
  test('a fully-valid manifest parses', () => {
    const m = parseCampaign(validManifest());
    expect(m.version).toBe(1);
    expect(m.acts).toHaveLength(1);
  });
});

describe('parseCampaign: structural rejections', () => {
  test('missing version', () => {
    const m = validManifest() as Record<string, unknown>;
    delete m['version'];
    expect(() => parseCampaign(m)).toThrow(CampaignParseError);
  });

  test('wrong version literal', () => {
    const m = validManifest() as Record<string, unknown>;
    m['version'] = 2;
    expect(() => parseCampaign(m)).toThrow(CampaignParseError);
  });

  test('unknown top-level field (strict mode)', () => {
    const m = validManifest() as Record<string, unknown>;
    m['evil'] = 'data';
    expect(() => parseCampaign(m)).toThrow(CampaignParseError);
  });

  test('bad palette hex', () => {
    const m = validManifest() as { theme: { palette: Record<string, string> } };
    m.theme.palette['bg'] = 'red';
    expect(() => parseCampaign(m)).toThrow(CampaignParseError);
  });

  test('puzzle id with disallowed characters', () => {
    const m = validManifest() as { acts: { puzzles: { id: string }[] }[] };
    m.acts[0]!.puzzles[0]!.id = 'a b c!';
    expect(() => parseCampaign(m)).toThrow(CampaignParseError);
  });

  test('empty acts array', () => {
    const m = validManifest() as { acts: unknown[] };
    m.acts = [];
    expect(() => parseCampaign(m)).toThrow(CampaignParseError);
  });

  test('grid out of bounds (33x1)', () => {
    const m = validManifest() as { acts: { puzzles: { grid: { w: number; h: number } }[] }[] };
    m.acts[0]!.puzzles[0]!.grid = { w: 33, h: 1 };
    expect(() => parseCampaign(m)).toThrow(CampaignParseError);
  });

  test('text-length cap on intro_text', () => {
    const m = validManifest() as { acts: { intro_text: string }[] };
    m.acts[0]!.intro_text = 'x'.repeat(2001);
    expect(() => parseCampaign(m)).toThrow(CampaignParseError);
  });
});

describe('parseCampaign: rule DSL validation', () => {
  test('malformed rule in an optional_challenge rejects the manifest', () => {
    const m = validManifest() as {
      acts: { puzzles: { optional_challenges: { rule: string }[] }[] }[];
    };
    m.acts[0]!.puzzles[0]!.optional_challenges[0]!.rule = '1 << 5'; // unknown op
    expect(() => parseCampaign(m)).toThrow(CampaignParseError);
  });

  test('rule referencing an unknown identifier rejects', () => {
    const m = validManifest() as {
      acts: { puzzles: { optional_challenges: { rule: string }[] }[] }[];
    };
    m.acts[0]!.puzzles[0]!.optional_challenges[0]!.rule = 'foo < 10';
    expect(() => parseCampaign(m)).toThrow(CampaignParseError);
  });

  test('error issues list includes the offending path', () => {
    const m = validManifest() as {
      acts: { puzzles: { optional_challenges: { rule: string }[] }[] }[];
    };
    m.acts[0]!.puzzles[0]!.optional_challenges[0]!.rule = '+++';
    try {
      parseCampaign(m);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(CampaignParseError);
      const ce = e as CampaignParseError;
      expect(ce.issues.some((i) => i.includes('optional_challenges[0].rule'))).toBe(true);
    }
  });
});

describe('parseCampaign: error shape', () => {
  test('CampaignParseError carries issues array', () => {
    try {
      parseCampaign({});
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(CampaignParseError);
      expect((e as CampaignParseError).issues.length).toBeGreaterThan(0);
    }
  });
});
