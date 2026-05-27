/**
 * Recursive-descent parser for the rule DSL.
 *
 * Implements the grammar in docs/architecture/rule-dsl.md §3.
 * Single-pass: validates identifier membership against the closed
 * VarName set as it builds the AST.
 *
 * `parse(tokens)` returns an AST or throws RuleParseError. The
 * lexer guarantees a trailing EOF token; the parser uses that to
 * detect trailing-junk errors.
 */

import type { AST, BinOp, VarName } from './ast';
import { VAR_NAMES } from './ast';
import { RuleParseError } from './errors';
import type { OpString, Token } from './lexer';

export function parse(tokens: Token[]): AST {
  const p = new Parser(tokens);
  const ast = p.parseExpr();
  const tail = p.peek();
  if (tail.kind !== 'EOF') {
    throw new RuleParseError(`unexpected token after expression`, tail.offset);
  }
  return ast;
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  peek(): Token {
    return this.tokens[this.pos] ?? this.tokens[this.tokens.length - 1]!;
  }

  consume(): Token {
    const t = this.peek();
    if (t.kind !== 'EOF') this.pos += 1;
    return t;
  }

  /** Consume the next token only if it's an OP with the given symbol. */
  matchOp(op: OpString): boolean {
    const t = this.peek();
    if (t.kind === 'OP' && t.op === op) {
      this.pos += 1;
      return true;
    }
    return false;
  }

  // ─── Grammar ───────────────────────────────────────────────────
  parseExpr(): AST {
    return this.parseOr();
  }

  private parseOr(): AST {
    let lhs = this.parseAnd();
    while (this.matchOp('||')) {
      lhs = { kind: 'bin', op: '||', lhs, rhs: this.parseAnd() };
    }
    return lhs;
  }

  private parseAnd(): AST {
    let lhs = this.parseCmp();
    while (this.matchOp('&&')) {
      lhs = { kind: 'bin', op: '&&', lhs, rhs: this.parseCmp() };
    }
    return lhs;
  }

  private parseCmp(): AST {
    const lhs = this.parseSum();
    const t = this.peek();
    if (t.kind === 'OP' && isCmpOp(t.op)) {
      this.pos += 1;
      const rhs = this.parseSum();
      // Non-associative: another cmpOp here is a parse error.
      const next = this.peek();
      if (next.kind === 'OP' && isCmpOp(next.op)) {
        throw new RuleParseError(
          `chained comparison '${next.op}' is not allowed; use '&&' instead`,
          next.offset,
        );
      }
      return { kind: 'bin', op: t.op as BinOp, lhs, rhs };
    }
    return lhs;
  }

  private parseSum(): AST {
    let lhs = this.parseMul();
    for (;;) {
      const t = this.peek();
      if (t.kind === 'OP' && (t.op === '+' || t.op === '-')) {
        this.pos += 1;
        lhs = { kind: 'bin', op: t.op, lhs, rhs: this.parseMul() };
      } else {
        return lhs;
      }
    }
  }

  private parseMul(): AST {
    let lhs = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.kind === 'OP' && (t.op === '*' || t.op === '/')) {
        this.pos += 1;
        lhs = { kind: 'bin', op: t.op, lhs, rhs: this.parseUnary() };
      } else {
        return lhs;
      }
    }
  }

  private parseUnary(): AST {
    const t = this.peek();
    if (t.kind === 'OP' && (t.op === '!' || t.op === '-')) {
      this.pos += 1;
      return { kind: 'unary', op: t.op, arg: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): AST {
    const t = this.peek();
    switch (t.kind) {
      case 'NUMBER':
        this.pos += 1;
        return { kind: 'num', value: t.value };
      case 'IDENT': {
        if (!isVarName(t.name)) {
          throw new RuleParseError(
            `unknown identifier '${t.name}' (allowed: ${VAR_NAMES.join(', ')})`,
            t.offset,
          );
        }
        this.pos += 1;
        return { kind: 'var', name: t.name };
      }
      case 'LPAREN': {
        this.pos += 1;
        const inner = this.parseExpr();
        const close = this.peek();
        if (close.kind !== 'RPAREN') {
          throw new RuleParseError(`expected ')'`, close.offset);
        }
        this.pos += 1;
        return inner;
      }
      case 'RPAREN':
        throw new RuleParseError(`unexpected ')'`, t.offset);
      case 'OP':
        throw new RuleParseError(`unexpected operator '${t.op}'`, t.offset);
      case 'EOF':
        throw new RuleParseError(`unexpected end of input`, t.offset);
    }
  }
}

function isCmpOp(op: string): op is '<' | '<=' | '>' | '>=' | '==' | '!=' {
  return op === '<' || op === '<=' || op === '>' || op === '>=' || op === '==' || op === '!=';
}

function isVarName(name: string): name is VarName {
  return (VAR_NAMES as readonly string[]).includes(name);
}
