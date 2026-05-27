// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { contrastRatio, relativeLuminance, validatePalette } from '../contrast';

describe('relativeLuminance', () => {
  test('black is 0', () => {
    expect(relativeLuminance(0, 0, 0)).toBeCloseTo(0, 4);
  });
  test('white is 1', () => {
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 4);
  });
  test('mid grey is between', () => {
    const m = relativeLuminance(128, 128, 128);
    expect(m).toBeGreaterThan(0.18);
    expect(m).toBeLessThan(0.25);
  });
});

describe('contrastRatio', () => {
  test('white on black is 21', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1);
  });
  test('black on white is 21 (order-independent)', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
  });
  test('same color is 1', () => {
    expect(contrastRatio('#aaaaaa', '#aaaaaa')).toBeCloseTo(1, 4);
  });
  test('accepts 3-digit hex', () => {
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 1);
  });
  test('case insensitive', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 1);
  });
});

describe('validatePalette', () => {
  const goodPalette = {
    bg: '#1a1820',
    surface: '#241f29',
    fg: '#e8d8b0',
    muted: '#7a6a55',
    accent: '#c87650',
    success: '#82c08a',
    danger: '#d06060',
  };

  test('default palette from design doc passes AA on body pairs', () => {
    expect(validatePalette(goodPalette).ok).toBe(true);
  });

  test('fg too close to bg is rejected with named failures', () => {
    const bad = { ...goodPalette, fg: '#1c1a22' }; // near-bg
    const v = validatePalette(bad);
    expect(v.ok).toBe(false);
    expect(v.failures.some((f) => f.includes('fg vs bg'))).toBe(true);
  });

  test('fg too close to surface is rejected', () => {
    const bad = { ...goodPalette, surface: '#e9d9b1' }; // near-fg
    const v = validatePalette(bad);
    expect(v.ok).toBe(false);
    expect(v.failures.some((f) => f.includes('fg vs surface'))).toBe(true);
  });

  test('accent / success / danger are decorative — not floor-checked', () => {
    // Set accent to something with terrible bg contrast; still ok overall.
    const v = validatePalette({ ...goodPalette, accent: '#1a1820' });
    expect(v.ok).toBe(true);
  });
});
