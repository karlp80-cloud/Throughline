// @vitest-environment node
/**
 * Static canary: system.md has the expected section headings.
 *
 * Architect §4.1 spells out exactly which sections must appear. This
 * test catches the "split into many runtime string literals"
 * anti-pattern by asserting the SINGLE markdown file has the labeled
 * sections, AND that promptBuilder.ts does NOT contain large
 * multi-line string literals (heuristic: no string literal > 500
 * chars).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const SYSTEM_MD_PATH = join(process.cwd(), 'cli', 'src', 'prompts', 'system.md');
const PROMPT_BUILDER_PATH = join(process.cwd(), 'cli', 'src', 'promptBuilder.ts');

const REQUIRED_SECTIONS: readonly string[] = [
  '## Your role',
  '## Output format',
  '## Schema reference',
  '## Mechanics summary',
  '## Glyph catalog',
  '## Rule DSL grammar',
  '## Diversity directives',
  '## Worked examples',
  '## Solvability hints',
  '## Anti-instructions',
];

describe('system prompt shape', () => {
  test('system.md contains every required section heading', () => {
    const md = readFileSync(SYSTEM_MD_PATH, 'utf8');
    for (const section of REQUIRED_SECTIONS) {
      expect(md).toContain(section);
    }
  });

  test('system.md is < 30 KB (argv safety envelope)', () => {
    const md = readFileSync(SYSTEM_MD_PATH, 'utf8');
    expect(md.length).toBeLessThan(30_000);
  });

  test('system.md is > 1 KB (catches accidental truncation)', () => {
    const md = readFileSync(SYSTEM_MD_PATH, 'utf8');
    expect(md.length).toBeGreaterThan(1024);
  });

  test('contains at least 3 worked examples', () => {
    const md = readFileSync(SYSTEM_MD_PATH, 'utf8');
    // Each worked example contains the literal `"version": 1`.
    const matches = md.match(/"version":\s*1/g);
    expect((matches ?? []).length).toBeGreaterThanOrEqual(3);
  });

  test('promptBuilder.ts has no source line over 500 chars (heuristic against inlined prompts)', () => {
    // A real system prompt inlined in TS code would manifest as either
    // a very long single-line string literal OR a template literal
    // that spans many lines. The simpler check: no source LINE is over
    // 500 chars (an inlined single-line literal would explode here).
    // Multi-line template literals are still permitted, but the next
    // test asserts the *file* stays small (promptBuilder.ts is the
    // logic; the prompt content lives in system.md).
    const src = readFileSync(PROMPT_BUILDER_PATH, 'utf8');
    const lines = src.split('\n');
    const long = lines.map((l, i) => ({ line: i + 1, len: l.length })).filter((e) => e.len > 500);
    if (long.length > 0) {
      throw new Error(
        `promptBuilder.ts lines > 500 chars:\n` +
          long.map((e) => `  line ${e.line}: ${e.len} chars`).join('\n'),
      );
    }
    expect(long).toEqual([]);
  });

  test('promptBuilder.ts source file is under 8 KB (forces system-prompt content into system.md)', () => {
    const src = readFileSync(PROMPT_BUILDER_PATH, 'utf8');
    expect(src.length).toBeLessThan(8192);
  });
});
