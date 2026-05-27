/**
 * Validator corpus tests.
 *
 * Parameterized over `cli/test-fixtures/llm-outputs/`. Each fixture
 * file has an expected result encoded by name:
 *   - `good*.json` → ok: true
 *   - `unsolvable.json` → ok: true  (validator accepts; solver decides)
 *   - `injection-attempt-*.json` → ok: true (rendering layer escapes)
 *   - `prose-prefix.json` / `trailing-prose.json` → ok: false, json-syntax
 *   - everything else → ok: false, schema
 *
 * Adding a new fixture: drop the file in `test-fixtures/llm-outputs/`
 * and (if it doesn't fit the rules above) register it in the
 * `expected` map below.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { validate, stripCodeFence } from '../validator';

const FIXTURES_DIR = join(process.cwd(), 'cli', 'test-fixtures', 'llm-outputs');

type Expected =
  | { ok: true }
  | { ok: false; kind: 'json-syntax' | 'schema'; issueMatches?: readonly string[] };

/**
 * Per-fixture expectations. Files starting with `_` are templates and
 * skipped (handy for hand-editing without inflating the corpus).
 */
const expected: Record<string, Expected> = {
  'good.json': { ok: true },
  'good-with-fence.json': { ok: true },
  'missing-field.json': { ok: false, kind: 'schema', issueMatches: ['version'] },
  'extra-field.json': { ok: false, kind: 'schema', issueMatches: ['extra'] },
  'oversize-text.json': { ok: false, kind: 'schema', issueMatches: ['briefing'] },
  'malformed-rule-dsl.json': { ok: false, kind: 'schema', issueMatches: ['rule'] },
  'unknown-identifier.json': { ok: false, kind: 'schema', issueMatches: ['rule'] },
  'unsolvable.json': { ok: true },
  'injection-attempt-script.json': { ok: true },
  'injection-attempt-html.json': { ok: true },
  'prose-prefix.json': { ok: false, kind: 'json-syntax' },
  'trailing-prose.json': { ok: false, kind: 'json-syntax' },
  'wrong-version.json': { ok: false, kind: 'schema', issueMatches: ['version'] },
  'reactor-no-recipe.json': { ok: false, kind: 'schema', issueMatches: ['reactor_recipes'] },
  'filter-no-types.json': { ok: false, kind: 'schema', issueMatches: ['filter_types'] },
  'negative-cycle.json': { ok: false, kind: 'schema', issueMatches: ['max_cycles'] },
  'zero-rate.json': { ok: false, kind: 'schema', issueMatches: ['rate'] },
};

describe('validator — fixture corpus', () => {
  const files = readdirSync(FIXTURES_DIR).filter((n) => n.endsWith('.json') && !n.startsWith('_'));

  test('every fixture has a registered expectation', () => {
    const orphans = files.filter((f) => !(f in expected));
    expect(orphans).toEqual([]);
  });

  for (const file of files) {
    const exp = expected[file];
    if (!exp) continue;
    test(`${file} → ${exp.ok ? 'ok' : `fail(${exp.kind})`}`, () => {
      const raw = readFileSync(join(FIXTURES_DIR, file), 'utf8');
      const result = validate(raw);
      if (exp.ok) {
        if (!result.ok) {
          // Surface issues for easier debugging.
          throw new Error(
            `expected ok but got ${result.failure.kind}: ${result.failure.issues.join('; ')}`,
          );
        }
        expect(result.ok).toBe(true);
      } else {
        if (result.ok) throw new Error('expected validation failure but got ok');
        expect(result.failure.kind).toBe(exp.kind);
        if (exp.issueMatches) {
          // Each match string must appear somewhere across the issues.
          const joined = result.failure.issues.join(' || ');
          for (const m of exp.issueMatches) {
            expect(joined).toContain(m);
          }
        }
      }
    });
  }
});

describe('validator — direct unit tests', () => {
  test('empty stdout → json-syntax failure', () => {
    const r = validate('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.kind).toBe('json-syntax');
  });

  test('whitespace-only stdout → json-syntax failure', () => {
    const r = validate('   \n\n  \t');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.kind).toBe('json-syntax');
  });

  test('plain JSON without fences round-trips', () => {
    const r = validate('not-json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.kind).toBe('json-syntax');
  });

  test('stripCodeFence returns content of a single ```json fence', () => {
    const inner = '{"foo":1}';
    expect(stripCodeFence('```json\n' + inner + '\n```')).toBe(inner);
    expect(stripCodeFence('```\n' + inner + '\n```')).toBe(inner);
  });

  test('stripCodeFence is a no-op for plain JSON', () => {
    expect(stripCodeFence('{"x":1}')).toBe('{"x":1}');
  });

  test('stripCodeFence does NOT touch text with backticks but no full fence', () => {
    const s = 'pretend `code` in text';
    expect(stripCodeFence(s)).toBe(s);
  });
});
