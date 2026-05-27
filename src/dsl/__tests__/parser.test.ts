// @vitest-environment node
import { describe, expect, test } from 'vitest';
import type { AST } from '../ast';
import { RuleParseError } from '../errors';
import { parseRule } from '../index';

// ─── Literals & vars ───────────────────────────────────────────────
describe('primary expressions', () => {
  test('number literal', () => {
    expect(parseRule('42')).toEqual({ kind: 'num', value: 42 });
  });

  test('identifier from the closed set', () => {
    expect(parseRule('cycles')).toEqual({ kind: 'var', name: 'cycles' });
  });

  test('unknown identifier rejected at parse time', () => {
    expect(() => parseRule('foo')).toThrow(RuleParseError);
  });

  test('parens just group', () => {
    expect(parseRule('(5)')).toEqual({ kind: 'num', value: 5 });
  });

  test('case sensitive — Cycles is rejected', () => {
    expect(() => parseRule('Cycles')).toThrow(RuleParseError);
  });
});

// ─── Unary ─────────────────────────────────────────────────────────
describe('unary', () => {
  test('logical not', () => {
    expect(parseRule('!cycles')).toEqual({
      kind: 'unary',
      op: '!',
      arg: { kind: 'var', name: 'cycles' },
    });
  });

  test('unary minus', () => {
    expect(parseRule('-5')).toEqual({
      kind: 'unary',
      op: '-',
      arg: { kind: 'num', value: 5 },
    });
  });

  test('chained unary', () => {
    expect(parseRule('!!cycles')).toEqual({
      kind: 'unary',
      op: '!',
      arg: { kind: 'unary', op: '!', arg: { kind: 'var', name: 'cycles' } },
    });
  });
});

// ─── Arithmetic precedence & associativity ─────────────────────────
describe('arithmetic', () => {
  test('add is left-associative', () => {
    const ast = parseRule('1 + 2 + 3');
    expect(ast).toEqual({
      kind: 'bin',
      op: '+',
      lhs: {
        kind: 'bin',
        op: '+',
        lhs: { kind: 'num', value: 1 },
        rhs: { kind: 'num', value: 2 },
      },
      rhs: { kind: 'num', value: 3 },
    });
  });

  test('* binds tighter than +', () => {
    const ast = parseRule('1 + 2 * 3');
    expect(ast).toEqual({
      kind: 'bin',
      op: '+',
      lhs: { kind: 'num', value: 1 },
      rhs: {
        kind: 'bin',
        op: '*',
        lhs: { kind: 'num', value: 2 },
        rhs: { kind: 'num', value: 3 },
      },
    });
  });

  test('parens override precedence', () => {
    const ast = parseRule('(1 + 2) * 3') as Extract<AST, { kind: 'bin' }>;
    expect(ast.kind).toBe('bin');
    expect(ast.op).toBe('*');
    expect(ast.lhs).toEqual({
      kind: 'bin',
      op: '+',
      lhs: { kind: 'num', value: 1 },
      rhs: { kind: 'num', value: 2 },
    });
  });

  test('division', () => {
    expect(parseRule('10 / 3')).toEqual({
      kind: 'bin',
      op: '/',
      lhs: { kind: 'num', value: 10 },
      rhs: { kind: 'num', value: 3 },
    });
  });
});

// ─── Comparisons ───────────────────────────────────────────────────
describe('comparison', () => {
  test('cycles < 40', () => {
    expect(parseRule('cycles < 40')).toEqual({
      kind: 'bin',
      op: '<',
      lhs: { kind: 'var', name: 'cycles' },
      rhs: { kind: 'num', value: 40 },
    });
  });

  test('every cmpOp is a binary op', () => {
    for (const op of ['<', '<=', '>', '>=', '==', '!=']) {
      const ast = parseRule(`cycles ${op} 5`) as Extract<AST, { kind: 'bin' }>;
      expect(ast.kind).toBe('bin');
      expect(ast.op).toBe(op);
    }
  });

  test('comparisons are NON-associative (no chaining)', () => {
    expect(() => parseRule('1 < 2 < 3')).toThrow(RuleParseError);
    expect(() => parseRule('cycles < tiles_used < 5')).toThrow(RuleParseError);
  });

  test('arithmetic binds tighter than comparison', () => {
    const ast = parseRule('cycles + 1 < 40') as Extract<AST, { kind: 'bin' }>;
    expect(ast.op).toBe('<');
    expect(ast.lhs).toEqual({
      kind: 'bin',
      op: '+',
      lhs: { kind: 'var', name: 'cycles' },
      rhs: { kind: 'num', value: 1 },
    });
  });
});

// ─── Logical ───────────────────────────────────────────────────────
describe('logical', () => {
  test('&& binds tighter than ||', () => {
    const ast = parseRule('1 || 2 && 3') as Extract<AST, { kind: 'bin' }>;
    expect(ast.op).toBe('||');
    expect(ast.rhs).toEqual({
      kind: 'bin',
      op: '&&',
      lhs: { kind: 'num', value: 2 },
      rhs: { kind: 'num', value: 3 },
    });
  });

  test('comparison binds tighter than &&', () => {
    const ast = parseRule('cycles < 5 && tiles_used <= 10') as Extract<AST, { kind: 'bin' }>;
    expect(ast.op).toBe('&&');
    expect((ast.lhs as Extract<AST, { kind: 'bin' }>).op).toBe('<');
    expect((ast.rhs as Extract<AST, { kind: 'bin' }>).op).toBe('<=');
  });

  test('|| and && are left-associative', () => {
    const ast = parseRule('1 || 2 || 3') as Extract<AST, { kind: 'bin' }>;
    expect(ast.op).toBe('||');
    expect((ast.lhs as Extract<AST, { kind: 'bin' }>).op).toBe('||');
    expect(ast.rhs).toEqual({ kind: 'num', value: 3 });
  });
});

// ─── Error cases (memo §11) ────────────────────────────────────────
describe('parse errors', () => {
  test('empty input', () => {
    expect(() => parseRule('')).toThrow(RuleParseError);
    expect(() => parseRule('   ')).toThrow(RuleParseError);
  });

  test('unbalanced parens', () => {
    expect(() => parseRule('(1')).toThrow(RuleParseError);
    expect(() => parseRule('1)')).toThrow(RuleParseError);
    expect(() => parseRule('((1)')).toThrow(RuleParseError);
  });

  test('missing operand', () => {
    expect(() => parseRule('1 +')).toThrow(RuleParseError);
    expect(() => parseRule('+ 1')).toThrow(RuleParseError);
    expect(() => parseRule('1 < ')).toThrow(RuleParseError);
    expect(() => parseRule('< 1')).toThrow(RuleParseError);
  });

  test('trailing tokens after expression', () => {
    expect(() => parseRule('1 + 2 3')).toThrow(RuleParseError);
    expect(() => parseRule('cycles < 40 garbage')).toThrow(RuleParseError);
  });

  test('lone equals (not a comparator)', () => {
    expect(() => parseRule('1 = 2')).toThrow(RuleParseError);
  });

  test('lone & or | (not the logical op)', () => {
    expect(() => parseRule('1 & 2')).toThrow(RuleParseError);
    expect(() => parseRule('1 | 2')).toThrow(RuleParseError);
  });
});
