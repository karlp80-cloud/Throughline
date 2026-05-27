// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { clearPaletteCache, paletteColor } from '../palette';

afterEach(() => {
  document.documentElement.style.cssText = '';
  clearPaletteCache();
});

describe('paletteColor', () => {
  test('returns the documented default when no CSS var is set', () => {
    expect(paletteColor('bg')).toBe('#1a1820');
    expect(paletteColor('accent')).toBe('#c87650');
  });

  test('reads a CSS custom property set on :root', () => {
    document.documentElement.style.setProperty('--bg', '#ff00ff');
    expect(paletteColor('bg')).toBe('#ff00ff');
  });

  test('cache returns same value for a token; clearPaletteCache forces re-read', () => {
    document.documentElement.style.setProperty('--accent', '#aaa');
    expect(paletteColor('accent')).toBe('#aaa');
    document.documentElement.style.setProperty('--accent', '#bbb');
    // Cached — still aaa
    expect(paletteColor('accent')).toBe('#aaa');
    clearPaletteCache();
    expect(paletteColor('accent')).toBe('#bbb');
  });

  test('whitespace in CSS var values is trimmed', () => {
    document.documentElement.style.setProperty('--fg', '   #abc   ');
    expect(paletteColor('fg')).toBe('#abc');
  });

  test('empty CSS var value falls back to default', () => {
    // Per CSS spec, setting an empty property still creates it but
    // getPropertyValue returns '' — our reader treats that as "no value".
    document.documentElement.style.setProperty('--danger', '');
    expect(paletteColor('danger')).toBe('#d06060');
  });
});
