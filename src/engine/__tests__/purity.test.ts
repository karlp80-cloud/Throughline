/**
 * Static purity check for src/engine/.
 *
 * The engine's determinism contract (memo §10) forbids these APIs.
 * This test greps the engine source for them; failure means a piece
 * of nondeterminism slipped in.
 *
 * Reviewer note: temporarily add `Math.random()` to any engine module
 * and confirm this test catches it.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const FORBIDDEN: readonly { pattern: RegExp; name: string }[] = [
  { pattern: /\bMath\.random\b/, name: 'Math.random' },
  { pattern: /\bDate\.now\b/, name: 'Date.now' },
  { pattern: /\bperformance\.now\b/, name: 'performance.now' },
  { pattern: /\bcrypto\.randomUUID\b/, name: 'crypto.randomUUID' },
  { pattern: /\bcrypto\.getRandomValues\b/, name: 'crypto.getRandomValues' },
  { pattern: /\bnew\s+Date\s*\(/, name: 'new Date()' },
];

function* walkTs(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip tests and debug helpers — they may legitimately use timestamps etc.
      if (entry.name === '__tests__' || entry.name === 'debug') continue;
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

describe('engine purity', () => {
  test('no nondeterministic API usage under src/engine/', () => {
    const root = join(process.cwd(), 'src', 'engine');
    const offenders: { file: string; api: string; line: number }[] = [];
    for (const file of walkTs(root)) {
      const lines = readFileSync(file, 'utf-8').split('\n');
      for (const { pattern, name } of FORBIDDEN) {
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? '';
          if (pattern.test(line)) {
            offenders.push({ file, api: name, line: i + 1 });
          }
        }
      }
    }
    if (offenders.length > 0) {
      const msg = offenders.map((o) => `  ${o.file}:${o.line}  uses ${o.api}`).join('\n');
      throw new Error(`Forbidden nondeterministic API found in engine code:\n${msg}`);
    }
    expect(offenders).toEqual([]);
  });
});
