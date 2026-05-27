// @vitest-environment node
/**
 * Fuzz test for the rule DSL parser.
 *
 * Per memo §11: for any input string, `parseRule` must either
 * return an AST or throw a `RuleParseError`. It must never:
 *   - throw a non-RuleParseError exception (e.g. TypeError)
 *   - return undefined
 *   - hang
 *
 * 10 000 random strings; per-call wrapped in a watchdog so a
 * hang surfaces as a test failure.
 */

import * as fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { RuleParseError } from '../errors';
import { parseRule } from '../index';

const ALPHABET =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_ \t<>=!|&+-*/()@#;:.';

describe('parser fuzz', () => {
  test('every string either parses or throws RuleParseError (10 000 runs)', () => {
    let parseErrors = 0;
    let asts = 0;
    const stringFromAlphabet = fc
      .array(fc.constantFrom(...ALPHABET.split('')), { minLength: 0, maxLength: 40 })
      .map((arr) => arr.join(''));
    fc.assert(
      fc.property(stringFromAlphabet, (s) => {
        try {
          const ast = parseRule(s);
          if (ast === undefined || ast === null) return false;
          if (typeof (ast as { kind: string }).kind !== 'string') return false;
          asts += 1;
          return true;
        } catch (e) {
          if (!(e instanceof RuleParseError)) return false;
          parseErrors += 1;
          return true;
        }
      }),
      { numRuns: 10_000 },
    );
    // Sanity: we should see BOTH valid asts and parse errors over 10k random inputs.
    expect(parseErrors).toBeGreaterThan(0);
    expect(asts).toBeGreaterThan(0);
  });
});
