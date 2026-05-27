// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { RuleEvalError } from '../errors';
import { evaluateRule, parseRule, type RuleContext } from '../index';
import { evaluate } from '../evaluator';

const CTX: RuleContext = {
  cycles: 20,
  tiles_used: 8,
  agent_count: 1,
  ops_total: 6,
};

describe('evaluate: primary', () => {
  test('number literal', () => {
    expect(evaluate({ kind: 'num', value: 7 }, CTX)).toBe(7);
  });
  test('variable resolves from context', () => {
    expect(evaluate({ kind: 'var', name: 'cycles' }, CTX)).toBe(20);
    expect(evaluate({ kind: 'var', name: 'ops_total' }, CTX)).toBe(6);
  });
});

describe('evaluate: unary', () => {
  test('logical not on a boolean', () => {
    expect(evaluateRule('!(cycles < 5)', CTX)).toBe(true); // cycles=20, so cycles<5 is false → !false === true
  });
  test('unary minus on a number', () => {
    expect(evaluateRule('-5 < 0', CTX)).toBe(true);
  });
  test('! on a number is an eval error → returns false at boundary', () => {
    expect(evaluateRule('!cycles', CTX)).toBe(false);
  });
  test('unary - on a boolean is an eval error', () => {
    expect(() =>
      evaluate({ kind: 'unary', op: '-', arg: { kind: 'num', value: 0 } }, CTX),
    ).not.toThrow();
    expect(() =>
      evaluate(
        {
          kind: 'unary',
          op: '-',
          arg: {
            kind: 'bin',
            op: '<',
            lhs: { kind: 'num', value: 1 },
            rhs: { kind: 'num', value: 2 },
          },
        },
        CTX,
      ),
    ).toThrow(RuleEvalError);
  });
});

describe('evaluate: arithmetic', () => {
  test('addition and subtraction', () => {
    expect(evaluate(parseRule('1 + 2'), CTX)).toBe(3);
    expect(evaluate(parseRule('10 - 4'), CTX)).toBe(6);
  });
  test('multiplication', () => {
    expect(evaluate(parseRule('3 * 4'), CTX)).toBe(12);
  });
  test('division is integer truncation (Q2)', () => {
    expect(evaluate(parseRule('10 / 3'), CTX)).toBe(3);
    expect(evaluate(parseRule('7 / 2'), CTX)).toBe(3);
    expect(evaluate(parseRule('1 / 2'), CTX)).toBe(0);
  });
  test('division by zero throws RuleEvalError (Q3)', () => {
    expect(() => evaluate(parseRule('10 / 0'), CTX)).toThrow(RuleEvalError);
  });
  test('div-by-zero in evaluateRule wrapper returns false (fails closed)', () => {
    expect(evaluateRule('10 / 0 < 5', CTX)).toBe(false);
  });
});

describe('evaluate: comparison', () => {
  test('every cmpOp works', () => {
    expect(evaluateRule('cycles < 30', CTX)).toBe(true);
    expect(evaluateRule('cycles <= 20', CTX)).toBe(true);
    expect(evaluateRule('cycles > 30', CTX)).toBe(false);
    expect(evaluateRule('cycles >= 20', CTX)).toBe(true);
    expect(evaluateRule('cycles == 20', CTX)).toBe(true);
    expect(evaluateRule('cycles != 20', CTX)).toBe(false);
  });
  test('< on mixed types throws (caught by wrapper)', () => {
    // (cycles < 5) < 10 — left side is bool, right is num.
    expect(evaluateRule('(cycles < 5) < 10', CTX)).toBe(false);
  });
  test('== on bool == bool works', () => {
    expect(evaluateRule('(cycles < 30) == (tiles_used < 10)', CTX)).toBe(true);
  });
  test('== on mismatched types throws (caught by wrapper → false)', () => {
    expect(evaluateRule('cycles == (tiles_used < 10)', CTX)).toBe(false);
  });
});

describe('evaluate: logical', () => {
  test('&& both true', () => {
    expect(evaluateRule('cycles < 30 && tiles_used <= 10', CTX)).toBe(true);
  });
  test('&& one false → false', () => {
    expect(evaluateRule('cycles < 30 && tiles_used > 100', CTX)).toBe(false);
  });
  test('|| short-circuits — RHS never evaluated when LHS is true', () => {
    // RHS would be a div-by-zero error, which would surface if not short-circuited.
    expect(evaluateRule('cycles < 30 || 1 / 0 < 5', CTX)).toBe(true);
  });
  test('&& short-circuits — RHS never evaluated when LHS is false', () => {
    expect(evaluateRule('cycles > 100 && 1 / 0 < 5', CTX)).toBe(false);
  });
  test('logical op with number operand throws (caught by wrapper)', () => {
    expect(evaluateRule('cycles && cycles', CTX)).toBe(false);
  });
});

describe('evaluateRule: root-must-be-boolean', () => {
  test('a purely arithmetic root returns false', () => {
    // `cycles + 1` is a number AST; evaluateRule wraps and rejects.
    expect(evaluateRule('cycles + 1', CTX)).toBe(false);
  });
  test('a number literal root returns false', () => {
    expect(evaluateRule('42', CTX)).toBe(false);
  });
});

describe('evaluateRule: examples from the design doc', () => {
  test('"cycles < 40"', () => {
    expect(evaluateRule('cycles < 40', { ...CTX, cycles: 39 })).toBe(true);
    expect(evaluateRule('cycles < 40', { ...CTX, cycles: 40 })).toBe(false);
  });
  test('"tiles_used <= 12"', () => {
    expect(evaluateRule('tiles_used <= 12', { ...CTX, tiles_used: 12 })).toBe(true);
    expect(evaluateRule('tiles_used <= 12', { ...CTX, tiles_used: 13 })).toBe(false);
  });
});
