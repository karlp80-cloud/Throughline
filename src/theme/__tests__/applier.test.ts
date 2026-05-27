// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { applyTheme, DEFAULT_PALETTE } from '../applier';

interface MockTarget {
  readonly style: { setProperty(prop: string, value: string): void };
  readonly written: Record<string, string>;
}

function makeTarget(): MockTarget {
  const written: Record<string, string> = {};
  return {
    style: {
      setProperty(prop, value) {
        written[prop] = value;
      },
    },
    written,
  };
}

const VALID_PALETTE = {
  bg: '#1a1820',
  surface: '#241f29',
  fg: '#e8d8b0',
  muted: '#7a6a55',
  accent: '#c87650',
  success: '#82c08a',
  danger: '#d06060',
};

const BAD_PALETTE = {
  bg: '#101010',
  surface: '#121212',
  fg: '#111111', // basically invisible against bg/surface
  muted: '#555555',
  accent: '#ff5500',
  success: '#00aa00',
  danger: '#aa0000',
};

function themeWith(
  palette: typeof VALID_PALETTE,
  extras: object = {},
): Parameters<typeof applyTheme>[0] {
  return {
    name: 'Test',
    setting_summary: '',
    palette,
    glyphs: {},
    vocabulary: {},
    ...extras,
  } as Parameters<typeof applyTheme>[0];
}

describe('applyTheme: palette', () => {
  test('writes CSS variables for every palette slot', () => {
    const t = makeTarget();
    applyTheme(themeWith(VALID_PALETTE), { target: t });
    expect(t.written).toEqual({
      '--bg': VALID_PALETTE.bg,
      '--surface': VALID_PALETTE.surface,
      '--fg': VALID_PALETTE.fg,
      '--muted': VALID_PALETTE.muted,
      '--accent': VALID_PALETTE.accent,
      '--success': VALID_PALETTE.success,
      '--danger': VALID_PALETTE.danger,
    });
  });

  test('a palette that fails contrast falls back to DEFAULT_PALETTE', () => {
    const t = makeTarget();
    const result = applyTheme(themeWith(BAD_PALETTE), { target: t });
    expect(result.palette).toEqual(DEFAULT_PALETTE);
    expect(t.written['--bg']).toBe(DEFAULT_PALETTE.bg);
    expect(result.warnings.some((w) => w.includes('AA contrast'))).toBe(true);
  });
});

describe('applyTheme: glyphs', () => {
  test('default-family resolution when no theme.glyphs entries', () => {
    const r = applyTheme(themeWith(VALID_PALETTE), { target: makeTarget() });
    // Every glyph_key should be present.
    expect(Object.keys(r.resolvedGlyphs).sort()).toContain('input');
    expect(Object.keys(r.resolvedGlyphs).sort()).toContain('tile_reactor');
    expect(r.warnings).toEqual([]);
  });

  test('valid family-qualified variant resolves', () => {
    const r = applyTheme(themeWith(VALID_PALETTE, { glyphs: { input: 'alchemy.input' } }), {
      target: makeTarget(),
    });
    // Alchemy's input path starts with M 30 35 A ... (alembic).
    expect(r.resolvedGlyphs.input.startsWith('M 30 35')).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  test('unknown family falls back to default with a warning', () => {
    const r = applyTheme(themeWith(VALID_PALETTE, { glyphs: { input: 'made_up.thing' } }), {
      target: makeTarget(),
    });
    expect(r.warnings.some((w) => w.includes("unknown glyph family 'made_up'"))).toBe(true);
  });
});

describe('applyTheme: vocab pass-through', () => {
  test('vocab is returned unchanged for the harness to consume', () => {
    const r = applyTheme(
      themeWith(VALID_PALETTE, { vocabulary: { cargo: 'essence', agent: 'homunculus' } }),
      { target: makeTarget() },
    );
    expect(r.vocab).toEqual({ cargo: 'essence', agent: 'homunculus' });
  });
});

describe('applyTheme: audio coupling', () => {
  test('valid progression_name routes through audio.setProgressionByName', () => {
    let received: string | null = null;
    const mock = {
      setProgressionByName(name: string) {
        received = name;
        return true;
      },
    } as unknown as import('../../audio').AudioController;
    applyTheme(themeWith(VALID_PALETTE, { progression_name: 'alchemy_mystical' }), {
      audio: mock,
      target: makeTarget(),
    });
    expect(received).toBe('alchemy_mystical');
  });

  test('unknown progression_name produces a warning', () => {
    const mock = {
      setProgressionByName() {
        return false;
      },
    } as unknown as import('../../audio').AudioController;
    const r = applyTheme(themeWith(VALID_PALETTE, { progression_name: 'made_up' }), {
      audio: mock,
      target: makeTarget(),
    });
    expect(r.warnings.some((w) => w.includes('made_up'))).toBe(true);
  });

  test('no audio controller → progression_name silently ignored', () => {
    const r = applyTheme(themeWith(VALID_PALETTE, { progression_name: 'alchemy_mystical' }), {
      target: makeTarget(),
    });
    expect(r.warnings).toEqual([]);
  });
});
