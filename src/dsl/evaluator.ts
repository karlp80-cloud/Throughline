/**
 * Pure-function evaluator for rule DSL ASTs.
 *
 * Walks the AST against a `RuleContext`. Throws `RuleEvalError`
 * for type mismatches or division by zero — the public
 * `evaluateRule()` translates those into a "challenge not earned"
 * result so the player never sees an error surface.
 *
 * Determinism: no Math.random, no Date.now, no IO. Same (AST, ctx)
 * → same result.
 */

import type { AST, BinOp } from './ast';
import { RuleEvalError } from './errors';

export interface RuleContext {
  readonly cycles: number;
  readonly tiles_used: number;
  readonly agent_count: number;
  readonly ops_total: number;
}

export function evaluate(ast: AST, ctx: RuleContext): boolean | number {
  switch (ast.kind) {
    case 'num':
      return ast.value;
    case 'var':
      return ctx[ast.name];
    case 'unary':
      return evalUnary(ast.op, evaluate(ast.arg, ctx));
    case 'bin':
      return evalBin(ast.op, ast.lhs, ast.rhs, ctx);
  }
}

function evalUnary(op: '!' | '-', arg: boolean | number): boolean | number {
  if (op === '!') {
    if (typeof arg !== 'boolean') throw new RuleEvalError(`'!' requires a boolean operand`);
    return !arg;
  }
  // op === '-'
  if (typeof arg !== 'number') throw new RuleEvalError(`unary '-' requires a number operand`);
  return -arg;
}

function evalBin(op: BinOp, lhs: AST, rhs: AST, ctx: RuleContext): boolean | number {
  // Short-circuit for logical ops — evaluate rhs only if needed.
  if (op === '||' || op === '&&') {
    const l = evaluate(lhs, ctx);
    if (typeof l !== 'boolean') throw new RuleEvalError(`'${op}' requires boolean operands`);
    if (op === '||') {
      if (l) return true;
      const r = evaluate(rhs, ctx);
      if (typeof r !== 'boolean') throw new RuleEvalError(`'||' requires boolean operands`);
      return r;
    }
    // &&
    if (!l) return false;
    const r = evaluate(rhs, ctx);
    if (typeof r !== 'boolean') throw new RuleEvalError(`'&&' requires boolean operands`);
    return r;
  }

  // Eagerly evaluate both sides for other ops.
  const lVal = evaluate(lhs, ctx);
  const rVal = evaluate(rhs, ctx);

  if (op === '==' || op === '!=') {
    // Allow num==num or bool==bool only; mixed types are an eval error.
    if (typeof lVal !== typeof rVal) {
      throw new RuleEvalError(`'${op}' requires operands of matching types`);
    }
    return op === '==' ? lVal === rVal : lVal !== rVal;
  }

  if (op === '<' || op === '<=' || op === '>' || op === '>=') {
    if (typeof lVal !== 'number' || typeof rVal !== 'number') {
      throw new RuleEvalError(`'${op}' requires number operands`);
    }
    switch (op) {
      case '<':
        return lVal < rVal;
      case '<=':
        return lVal <= rVal;
      case '>':
        return lVal > rVal;
      case '>=':
        return lVal >= rVal;
    }
  }

  // Arithmetic
  if (typeof lVal !== 'number' || typeof rVal !== 'number') {
    throw new RuleEvalError(`'${op as string}' requires number operands`);
  }
  switch (op) {
    case '+':
      return lVal + rVal;
    case '-':
      return lVal - rVal;
    case '*':
      return lVal * rVal;
    case '/':
      if (rVal === 0) throw new RuleEvalError(`division by zero`);
      // Integer truncation per memo Q2.
      return Math.trunc(lVal / rVal);
  }

  throw new RuleEvalError(`unknown binary op '${op as string}'`);
}
