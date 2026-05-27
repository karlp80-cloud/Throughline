// @vitest-environment node
/**
 * Static canary: no shell-injection surface anywhere under cli/src/.
 *
 * Reviewer verifies by adding `exec('...')` in a scratch branch and
 * confirming this test fails. The architect doc §3.3 explains why
 * `shell: false` is a non-negotiable structural defense.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const FORBIDDEN: readonly { pattern: RegExp; name: string }[] = [
  // shell: true on a spawn/exec options object.
  { pattern: /\bshell\s*:\s*true\b/, name: 'shell: true' },
  // exec(...) / execSync(...) — even via child_process.exec.
  { pattern: /\bexec\s*\(/, name: 'exec(' },
  { pattern: /\bexecSync\s*\(/, name: 'execSync(' },
  // execFile/execFileSync are fine (argv-only), but we ban exec.
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

describe('cli/src purity — no shell injection surface', () => {
  test('no `shell: true`, `exec(`, `execSync(` anywhere under cli/src/', () => {
    const root = join(process.cwd(), 'cli', 'src');
    const offenders: { file: string; api: string; line: number }[] = [];
    for (const file of walkTs(root)) {
      const lines = readFileSync(file, 'utf-8').split('\n');
      for (const { pattern, name } of FORBIDDEN) {
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? '';
          const trimmed = line.trim();
          // Skip comments and JSDoc lines.
          if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
          if (pattern.test(line)) {
            offenders.push({ file, api: name, line: i + 1 });
          }
        }
      }
    }
    if (offenders.length > 0) {
      const msg = offenders.map((o) => `  ${o.file}:${o.line}  uses ${o.api}`).join('\n');
      throw new Error(`Forbidden shell API in CLI:\n${msg}`);
    }
    expect(offenders).toEqual([]);
  });
});
