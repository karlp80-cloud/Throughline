/**
 * Writes a (puzzle, solution, run-result) bundle to disk as JSON so
 * property-test failures can be inspected after the fact. Property
 * tests use this to persist the failing scenario; CI uploads the
 * resulting directory as an artifact.
 *
 * Returns the written file path so the calling test can log it.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Puzzle, RunResult, Solution } from '../types';

export function dumpTrace(
  testName: string,
  puzzle: Puzzle,
  solution: Solution,
  result: RunResult,
): string {
  const dir = join(process.cwd(), 'test-results', 'engine');
  mkdirSync(dir, { recursive: true });
  const safe = testName.replace(/[^a-z0-9-]/gi, '_');
  const path = join(dir, `${safe}.json`);
  writeFileSync(path, JSON.stringify({ puzzle, solution, result }, null, 2));
  return path;
}
