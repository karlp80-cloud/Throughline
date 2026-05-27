// @vitest-environment node
/**
 * Static-analysis canary: no static `import from '@tauri-apps/...'`
 * anywhere under `src/` except `platform.ts`.
 *
 * Why: shared code must remain platform-agnostic at module-load time.
 * Routing every Tauri call through `tauriHandle()` keeps the platform
 * branch obvious in the diff and prevents Vite from accidentally
 * pulling Tauri stubs into the browser bundle.
 *
 * Reviewer verifies by adding a static `import` in (say) `harness.ts`
 * and confirming this test fails. Companion: architect §2.3 / §11.4.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const SRC_ROOT = join(process.cwd(), 'src');
const ALLOWED_FILES = new Set<string>([join(SRC_ROOT, 'platform.ts')]);

const STATIC_IMPORT_RE = /^\s*import\b[^;]*\bfrom\s+['"]@tauri-apps\//m;

function* walkTs(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Tests don't ship into the bundle; permit them to import directly
      // if a future test needs to (none currently do).
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

describe('shared src/ purity — no static @tauri-apps imports', () => {
  test('only src/platform.ts may statically import @tauri-apps/*', () => {
    const offenders: { file: string; line: number; text: string }[] = [];
    for (const file of walkTs(SRC_ROOT)) {
      if (ALLOWED_FILES.has(file)) continue;
      const text = readFileSync(file, 'utf-8');
      // Multiline test: split on lines so we can report line numbers.
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        // Skip comments — JSDoc lines and EOL `//` notes can legitimately
        // reference the package name without importing it.
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
        if (STATIC_IMPORT_RE.test(line)) {
          offenders.push({ file, line: i + 1, text: line.trim() });
        }
      }
    }
    if (offenders.length > 0) {
      const msg = offenders.map((o) => `  ${o.file}:${o.line}  ${o.text}`).join('\n');
      throw new Error(`Forbidden static @tauri-apps import in shared code:\n${msg}`);
    }
    expect(offenders).toEqual([]);
  });
});
