/**
 * Typed errors so callers branch on `err.kind` instead of string matching.
 */

export class RuleParseError extends Error {
  readonly kind = 'parse' as const;
  readonly offset: number;
  constructor(message: string, offset: number) {
    super(message);
    this.name = 'RuleParseError';
    this.offset = offset;
  }
}

export class RuleEvalError extends Error {
  readonly kind = 'eval' as const;
  constructor(message: string) {
    super(message);
    this.name = 'RuleEvalError';
  }
}
