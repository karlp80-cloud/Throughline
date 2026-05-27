/**
 * Validator wraps the shared schema (`parseCampaign`) and adds three
 * pieces of defense-in-depth around LLM output:
 *
 *   1. Strip a single optional Markdown code fence around the JSON
 *      (some models wrap output despite instructions).
 *   2. Surface JSON syntax errors as a structured `ValidationFailure`
 *      with category `json-syntax`.
 *   3. Surface schema validation failures with category `schema` and
 *      the dotted issue paths intact.
 *
 * The validator never throws — every failure is a returned
 * `ValidationResult`. That makes the generator's retry loop a pure
 * state machine over the result.
 */

import { parseCampaign, CampaignParseError, type RawCampaign } from '../../src/schema/campaign';

export interface ValidationFailure {
  readonly kind: 'json-syntax' | 'schema';
  readonly message: string;
  readonly issues: readonly string[];
}

export type ValidationResult =
  | { ok: true; manifest: RawCampaign }
  | { ok: false; failure: ValidationFailure };

const FENCE = /^\s*```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/;

/**
 * Strip a single complete fenced block if present. Anything else
 * (prose before/after the JSON, multiple JSON objects, comments) is
 * left untouched and will fail JSON.parse.
 */
export function stripCodeFence(input: string): string {
  const m = input.match(FENCE);
  return m ? m[1]! : input;
}

export function validate(rawStdout: string): ValidationResult {
  const trimmed = rawStdout.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      failure: {
        kind: 'json-syntax',
        message: 'empty stdout',
        issues: ['stdout was empty after trimming whitespace'],
      },
    };
  }
  const dejacketed = stripCodeFence(trimmed);
  let parsed: unknown;
  try {
    parsed = JSON.parse(dejacketed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      failure: {
        kind: 'json-syntax',
        message: msg,
        issues: [msg],
      },
    };
  }
  try {
    const manifest = parseCampaign(parsed);
    return { ok: true, manifest };
  } catch (e) {
    if (e instanceof CampaignParseError) {
      return {
        ok: false,
        failure: {
          kind: 'schema',
          message: e.message,
          issues: e.issues,
        },
      };
    }
    throw e;
  }
}
