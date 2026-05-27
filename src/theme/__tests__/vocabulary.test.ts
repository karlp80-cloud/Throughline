// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { findMissingTokens, substitute } from '../vocabulary';

describe('substitute', () => {
  test('replaces a single token', () => {
    expect(substitute('Hello {{name}}', { name: 'World' })).toBe('Hello World');
  });

  test('replaces multiple distinct tokens', () => {
    expect(
      substitute('{{cargo}} delivered to {{output}}', { cargo: 'essence', output: 'phial' }),
    ).toBe('essence delivered to phial');
  });

  test('replaces repeated tokens', () => {
    expect(substitute('{{x}} + {{x}} = 2{{x}}', { x: 'foo' })).toBe('foo + foo = 2foo');
  });

  test('missing token leaves the placeholder in place', () => {
    expect(substitute('Hi {{name}}!', {})).toBe('Hi {{name}}!');
  });

  test('HTML-escapes values (defense in depth)', () => {
    expect(substitute('Said: {{q}}', { q: '<script>alert(1)</script>' })).toBe(
      'Said: &lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  test('escapes &, <, >, ", and \' in values', () => {
    expect(substitute('{{x}}', { x: `<>&"'` })).toBe('&lt;&gt;&amp;&quot;&#39;');
  });

  test('non-token braces are left alone', () => {
    expect(substitute('{ not a token } {{}}', {})).toBe('{ not a token } {{}}');
  });

  test('numeric values stringify before escape', () => {
    expect(substitute('count: {{n}}', { n: 42 as unknown as string })).toBe('count: 42');
  });

  test('empty template is empty string', () => {
    expect(substitute('', {})).toBe('');
  });
});

describe('findMissingTokens', () => {
  test('reports tokens with no vocab entry', () => {
    expect(findMissingTokens('Hi {{a}} {{b}}', { a: 'x' })).toEqual(['b']);
  });

  test('dedupes repeated missing tokens', () => {
    expect(findMissingTokens('{{x}} {{x}} {{y}}', {})).toEqual(['x', 'y']);
  });

  test('empty when all tokens resolve', () => {
    expect(findMissingTokens('{{a}}', { a: 'x' })).toEqual([]);
  });

  test('empty when no tokens at all', () => {
    expect(findMissingTokens('plain text', {})).toEqual([]);
  });
});
