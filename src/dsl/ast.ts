/**
 * Rule DSL AST.
 *
 * Closed identifier set + closed operator set. See
 * docs/architecture/rule-dsl.md §3-§4 for the grammar and design.
 */

export type VarName = 'cycles' | 'tiles_used' | 'agent_count' | 'ops_total';

export const VAR_NAMES: readonly VarName[] = [
  'cycles',
  'tiles_used',
  'agent_count',
  'ops_total',
] as const;

export type BinOp = '||' | '&&' | '==' | '!=' | '<' | '<=' | '>' | '>=' | '+' | '-' | '*' | '/';

export type UnaryOp = '!' | '-';

export type AST =
  | { readonly kind: 'num'; readonly value: number }
  | { readonly kind: 'var'; readonly name: VarName }
  | { readonly kind: 'bin'; readonly op: BinOp; readonly lhs: AST; readonly rhs: AST }
  | { readonly kind: 'unary'; readonly op: UnaryOp; readonly arg: AST };
