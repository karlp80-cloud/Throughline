/**
 * Lexer for the rule DSL.
 *
 * Total function: returns Token[] ending in EOF, or throws
 * RuleParseError on the first unrecognized character.
 *
 * Operators are longest-match: `<=` before `<`, `&&` before `&`
 * (which is itself invalid on its own).
 *
 * Identifier membership is NOT validated here — the parser does
 * that. The lexer only enforces syntactic structure.
 */

import { RuleParseError } from './errors';

export type Token =
  | { readonly kind: 'NUMBER'; readonly value: number; readonly offset: number }
  | { readonly kind: 'IDENT'; readonly name: string; readonly offset: number }
  | { readonly kind: 'OP'; readonly op: OpString; readonly offset: number }
  | { readonly kind: 'LPAREN'; readonly offset: number }
  | { readonly kind: 'RPAREN'; readonly offset: number }
  | { readonly kind: 'EOF'; readonly offset: number };

export type OpString =
  | '||'
  | '&&'
  | '=='
  | '!='
  | '<='
  | '>='
  | '<'
  | '>'
  | '!'
  | '+'
  | '-'
  | '*'
  | '/';

const MULTI_OPS: readonly OpString[] = ['||', '&&', '==', '!=', '<=', '>='];
const SINGLE_OPS: readonly OpString[] = ['<', '>', '!', '+', '-', '*', '/'];

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    // Whitespace
    if (ch === ' ' || ch === '\t') {
      i += 1;
      continue;
    }
    // Parens
    if (ch === '(') {
      tokens.push({ kind: 'LPAREN', offset: i });
      i += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'RPAREN', offset: i });
      i += 1;
      continue;
    }
    // Multi-char operators (longest match)
    const two = input.slice(i, i + 2);
    const mop = MULTI_OPS.find((o) => o === two);
    if (mop) {
      tokens.push({ kind: 'OP', op: mop, offset: i });
      i += 2;
      continue;
    }
    // Single-char operators
    const sop = SINGLE_OPS.find((o) => o === ch);
    if (sop) {
      tokens.push({ kind: 'OP', op: sop, offset: i });
      i += 1;
      continue;
    }
    // Numbers
    if (isDigit(ch)) {
      const start = i;
      while (i < input.length && isDigit(input[i]!)) i += 1;
      tokens.push({ kind: 'NUMBER', value: Number(input.slice(start, i)), offset: start });
      continue;
    }
    // Identifiers
    if (isIdentStart(ch)) {
      const start = i;
      while (i < input.length && isIdentPart(input[i]!)) i += 1;
      tokens.push({ kind: 'IDENT', name: input.slice(start, i), offset: start });
      continue;
    }
    throw new RuleParseError(`unexpected character '${ch}'`, i);
  }
  tokens.push({ kind: 'EOF', offset: i });
  return tokens;
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}
function isIdentStart(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}
function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch);
}
