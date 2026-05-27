/**
 * Public surface of the rule DSL.
 *
 * Phase 7's manifest loader calls `parseRule` per `optional_challenges`
 * entry at load time; Phase 5's completion detector calls
 * `evaluateRule` post-victory.
 */

import type { AST } from './ast';
import { evaluate, type RuleContext } from './evaluator';
import { RuleEvalError } from './errors';
import { tokenize } from './lexer';
import { parse } from './parser';

export type { AST, BinOp, UnaryOp, VarName } from './ast';
export type { RuleContext } from './evaluator';
export { RuleEvalError, RuleParseError } from './errors';

export function parseRule(input: string): AST {
  const tokens = tokenize(input);
  return parse(tokens);
}

/**
 * Parse + evaluate against the player's puzzle stats. Returns
 * boolean. Fails-closed:
 *   - parse error → throws (caller decides; Phase 7 rejects manifest)
 *   - eval error  → returns false (challenge not earned; no UI surprise)
 *   - non-boolean root → returns false
 */
export function evaluateRule(input: string, ctx: RuleContext): boolean {
  const ast = parseRule(input);
  let result: boolean | number;
  try {
    result = evaluate(ast, ctx);
  } catch (e) {
    if (e instanceof RuleEvalError) return false;
    throw e;
  }
  return typeof result === 'boolean' && result;
}
