// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { RuleParseError } from '../errors';
import { tokenize } from '../lexer';

describe('tokenize: numbers', () => {
  test('single digit', () => {
    expect(tokenize('5')).toEqual([
      { kind: 'NUMBER', value: 5, offset: 0 },
      { kind: 'EOF', offset: 1 },
    ]);
  });

  test('multi-digit, no surprises with leading zero', () => {
    expect(tokenize('042')).toEqual([
      { kind: 'NUMBER', value: 42, offset: 0 },
      { kind: 'EOF', offset: 3 },
    ]);
  });
});

describe('tokenize: identifiers', () => {
  test('all four closed-set names tokenize as IDENT (membership is parser job)', () => {
    expect(tokenize('cycles').map((t) => t.kind)).toEqual(['IDENT', 'EOF']);
    expect(tokenize('tiles_used').map((t) => t.kind)).toEqual(['IDENT', 'EOF']);
    expect(tokenize('agent_count').map((t) => t.kind)).toEqual(['IDENT', 'EOF']);
    expect(tokenize('ops_total').map((t) => t.kind)).toEqual(['IDENT', 'EOF']);
  });

  test('lexer accepts unknown identifiers; parser will reject', () => {
    expect(tokenize('foo')).toEqual([
      { kind: 'IDENT', name: 'foo', offset: 0 },
      { kind: 'EOF', offset: 3 },
    ]);
  });

  test('identifier with digits and underscores', () => {
    expect(tokenize('a1_b_2')).toEqual([
      { kind: 'IDENT', name: 'a1_b_2', offset: 0 },
      { kind: 'EOF', offset: 6 },
    ]);
  });
});

describe('tokenize: operators (longest match)', () => {
  test('every single-char operator', () => {
    for (const op of ['+', '-', '*', '/', '!', '<', '>']) {
      const toks = tokenize(op);
      expect(toks[0]).toEqual({ kind: 'OP', op, offset: 0 });
    }
  });

  test('every multi-char operator', () => {
    for (const op of ['<=', '>=', '==', '!=', '&&', '||']) {
      const toks = tokenize(op);
      expect(toks[0]).toEqual({ kind: 'OP', op, offset: 0 });
    }
  });

  test('< vs <= disambiguation (longest match)', () => {
    expect(tokenize('<=').map((t) => 'op' in t && t.op)).toEqual(['<=', false]);
    expect(tokenize('<').map((t) => 'op' in t && t.op)).toEqual(['<', false]);
  });

  test('! vs != disambiguation', () => {
    expect(tokenize('!=').map((t) => 'op' in t && t.op)).toEqual(['!=', false]);
    expect(tokenize('!').map((t) => 'op' in t && t.op)).toEqual(['!', false]);
  });
});

describe('tokenize: parentheses', () => {
  test('LPAREN and RPAREN', () => {
    const toks = tokenize('()');
    expect(toks).toEqual([
      { kind: 'LPAREN', offset: 0 },
      { kind: 'RPAREN', offset: 1 },
      { kind: 'EOF', offset: 2 },
    ]);
  });
});

describe('tokenize: whitespace', () => {
  test('skips spaces and tabs between tokens', () => {
    expect(tokenize('  cycles \t < \t 40  ')).toEqual([
      { kind: 'IDENT', name: 'cycles', offset: 2 },
      { kind: 'OP', op: '<', offset: 11 },
      { kind: 'NUMBER', value: 40, offset: 15 },
      { kind: 'EOF', offset: 19 },
    ]);
  });

  test('empty input → just EOF', () => {
    expect(tokenize('')).toEqual([{ kind: 'EOF', offset: 0 }]);
  });

  test('whitespace-only → just EOF at end', () => {
    expect(tokenize('   ')).toEqual([{ kind: 'EOF', offset: 3 }]);
  });
});

describe('tokenize: rejection', () => {
  test('unknown character throws RuleParseError with offset', () => {
    expect(() => tokenize('@')).toThrow(RuleParseError);
    try {
      tokenize(' @');
    } catch (e) {
      expect(e).toBeInstanceOf(RuleParseError);
      expect((e as RuleParseError).offset).toBe(1);
    }
  });

  test('bare & is rejected (not the bitwise op)', () => {
    expect(() => tokenize('1 & 2')).toThrow(RuleParseError);
  });

  test('bare | is rejected', () => {
    expect(() => tokenize('1 | 2')).toThrow(RuleParseError);
  });

  test('= alone is rejected (would silently parse-fail later; we reject early)', () => {
    expect(() => tokenize('1 = 2')).toThrow(RuleParseError);
  });

  test('rejects emoji / non-ASCII', () => {
    expect(() => tokenize('cycles ❤ 5')).toThrow(RuleParseError);
  });
});

describe('tokenize: full expression', () => {
  test('a realistic rule', () => {
    const toks = tokenize('cycles < 40 && tiles_used <= 12');
    expect(toks.map((t) => t.kind)).toEqual([
      'IDENT',
      'OP',
      'NUMBER',
      'OP',
      'IDENT',
      'OP',
      'NUMBER',
      'EOF',
    ]);
  });

  test('with parens and unary', () => {
    const toks = tokenize('!(cycles < 40)');
    expect(toks.map((t) => t.kind)).toEqual([
      'OP',
      'LPAREN',
      'IDENT',
      'OP',
      'NUMBER',
      'RPAREN',
      'EOF',
    ]);
  });
});
