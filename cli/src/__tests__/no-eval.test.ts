// @vitest-environment node
/**
 * Static canary: no dynamic-code APIs anywhere under cli/src/.
 *
 * Mirrors the existing src/dsl/__tests__/no-eval.test.ts pattern.
 * Reviewer verifies by adding `eval('1')` in a scratch branch and
 * confirming this test fails.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const FORBIDDEN: readonly { pattern: RegExp; name: string }[] = [
  { pattern: /\beval\s*\(/, name: 'eval(' },
  { pattern: /\bnew\s+Function\s*\(/, name: 'new Function(' },
  // Catches a bare Function(...) call as an expression. Type annotations
  // like `: Function` won't match because of the `(`.
  { pattern: /(?<![\w.])Function\s*\(/, name: 'Function(' },
  // setTimeout / setInterval with a string first arg.
  { pattern: /\bsetTimeout\s*\(\s*['"]/, name: 'setTimeout(string,...)' },
  { pattern: /\bsetInterval\s*\(\s*['"]/, name: 'setInterval(string,...)' },
];

function* walkTs(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      yield* walkTs(path);
    } else if (
      entry.isFile() &&
      path.endsWith('.ts') &&
      !path.endsWith('.test.ts') &&
      !path.endsWith('.d.ts')
    ) {
      yield path;
    }
  }
}

describe('cli/src purity — no dynamic-code APIs', () => {
  test('no eval / Function() / string-arg setTimeout under cli/src/', () => {
    const root = join(process.cwd(), 'cli', 'src');
    const offenders: { file: string; api: string; line: number }[] = [];
    for (const file of walkTs(root)) {
      const lines = readFileSync(file, 'utf-8').split('\n');
      for (const { pattern, name } of FORBIDDEN) {
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? '';
          const trimmed = line.trim();
          if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
          if (pattern.test(line)) {
            offenders.push({ file, api: name, line: i + 1 });
          }
        }
      }
    }
    if (offenders.length > 0) {
      const msg = offenders.map((o) => `  ${o.file}:${o.line}  uses ${o.api}`).join('\n');
      throw new Error(`Forbidden dynamic-code API in CLI:\n${msg}`);
    }
    expect(offenders).toEqual([]);
  });
});
