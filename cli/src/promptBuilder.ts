/**
 * Prompt construction.
 *
 * Three public functions:
 *   - buildSystemPrompt()                — loads cli/src/prompts/system.md once, caches.
 *   - buildUserPrompt(opts)              — short markdown payload describing the request.
 *   - buildPuzzleRegenPrompt(M, id, fb)  — per-puzzle regeneration prompt.
 *
 * The system prompt is checked-in markdown, never concatenated from many
 * runtime literals. It is loaded ONCE at module init and cached as a
 * module-level constant. The reviewer's audit can read one file
 * (`prompts/system.md`) and see the whole thing.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RawCampaign } from '../../src/schema/campaign';

/**
 * Load the system prompt from `cli/src/prompts/system.md`.
 *
 * Two resolution strategies, tried in order:
 *  1. Bundle-relative: when the CLI is built by esbuild into a single
 *     .mjs, the bundle ships beside a copied `prompts/system.md`.
 *  2. Source-relative: in dev / tests we run from source; the file
 *     lives in `cli/src/prompts/system.md` relative to this file.
 *
 * The file content is checked in (architect §4.1) — never built from
 * many string literals at runtime.
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CANDIDATE_PATHS: readonly string[] = [
  // When bundled to dist-cli/throughline-gen.mjs, copy prompts beside it.
  join(__dirname, 'prompts', 'system.md'),
  // Dev / vitest: source layout.
  join(__dirname, 'prompts', 'system.md'),
  // Repo root fallback (used by tests running from cwd).
  join(process.cwd(), 'cli', 'src', 'prompts', 'system.md'),
];

let cachedSystemPrompt: string | null = null;

export function buildSystemPrompt(): string {
  if (cachedSystemPrompt !== null) return cachedSystemPrompt;
  let lastErr: unknown;
  for (const p of CANDIDATE_PATHS) {
    try {
      cachedSystemPrompt = readFileSync(p, 'utf8');
      return cachedSystemPrompt;
    } catch (e) {
      lastErr = e;
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(
    `Throughline CLI: failed to load system prompt. Tried: ${CANDIDATE_PATHS.join(', ')}. Last error: ${msg}. ` +
      `This is a packaging bug; the prompts/ folder must ship alongside the CLI.`,
  );
}

export interface UserPromptOpts {
  readonly seed: string;
  readonly acts: number;
  readonly puzzlesPerAct: number;
  readonly gentle: boolean;
  readonly avoidThemes: readonly string[];
  /** Set on retry; serialized validator / solver feedback. */
  readonly previousAttemptFeedback?: RetryFeedback;
}

export type RetryFeedback =
  | { kind: 'json-syntax'; message: string }
  | { kind: 'schema'; issues: readonly string[] }
  | { kind: 'solver'; puzzleId: string; bestProgress: number };

export function buildUserPrompt(opts: UserPromptOpts): string {
  const lines: string[] = [];
  lines.push('Generate a Throughline campaign with the following parameters.');
  lines.push('');
  lines.push(`- seed: ${opts.seed}`);
  lines.push(`- acts: ${opts.acts}`);
  lines.push(`- puzzles per act: ${opts.puzzlesPerAct}`);
  if (opts.gentle) {
    lines.push('- gentle: true (bias toward easier puzzles)');
  }
  if (opts.avoidThemes.length > 0) {
    lines.push(`- avoid themes: ${opts.avoidThemes.join(', ')}`);
  }
  if (opts.previousAttemptFeedback) {
    lines.push('');
    lines.push('Your previous attempt failed. Address this feedback in the new attempt:');
    lines.push('');
    const fb = opts.previousAttemptFeedback;
    if (fb.kind === 'json-syntax') {
      lines.push('Category: json-syntax');
      lines.push(`Error: ${fb.message}`);
      lines.push('');
      lines.push('Output a single JSON object only — no prose, no fences, no trailing commas.');
    } else if (fb.kind === 'schema') {
      lines.push('Category: schema');
      lines.push(`${fb.issues.length} issue${fb.issues.length === 1 ? '' : 's'}:`);
      for (const issue of fb.issues) lines.push(`  - ${issue}`);
      lines.push('');
      lines.push('Fix these specific problems and emit a fresh complete manifest.');
    } else if (fb.kind === 'solver') {
      lines.push('Category: solver');
      lines.push(
        `Puzzle "${fb.puzzleId}" was unsolvable within the time budget (best progress ${(fb.bestProgress * 100).toFixed(0)}%).`,
      );
      lines.push('Loosen its constraints: more cycles, more tiles, simpler ops.');
    }
  }
  lines.push('');
  lines.push('Output strictly: a single JSON object matching the schema in your');
  lines.push('system prompt. Begin your reply with `{` and end with `}`. No prose');
  lines.push('before or after the JSON. No code fences.');
  return lines.join('\n');
}

/**
 * Build the per-puzzle regeneration prompt. The LLM is asked to emit
 * a full new manifest, but the generator splices in only the target
 * puzzle (architect §7.3 / Q1=a).
 */
export function buildPuzzleRegenPrompt(
  manifest: RawCampaign,
  puzzleId: string,
  feedback: { bestProgress: number },
): string {
  let actId: string | undefined;
  for (const act of manifest.acts) {
    for (const p of act.puzzles) {
      if (p.id === puzzleId) {
        actId = act.id;
        break;
      }
    }
    if (actId) break;
  }
  if (!actId) {
    throw new Error(`buildPuzzleRegenPrompt: puzzle id "${puzzleId}" not found in manifest`);
  }
  const pct = (feedback.bestProgress * 100).toFixed(0);
  const lines: string[] = [];
  lines.push('The manifest you produced is well-formed. One puzzle is not solvable');
  lines.push(
    `within the time budget — the automated solver could only fill ${pct}% of its outputs.`,
  );
  lines.push('');
  lines.push(`Replace the puzzle with id "${puzzleId}" in act "${actId}" with a new puzzle. Keep:`);
  lines.push('- act intro/outro');
  lines.push('- all other puzzles unchanged');
  lines.push('- the same id and approximate difficulty slot');
  lines.push('');
  lines.push('Loosen constraints: more cycles, more tiles, simpler ops, fewer cargo types.');
  lines.push('');
  lines.push(
    'Output a single JSON object: the full manifest with the puzzle replaced. Same constraints as before. Begin with `{` and end with `}`. No prose.',
  );
  lines.push('');
  lines.push('Current manifest (for context):');
  lines.push(JSON.stringify(manifest));
  return lines.join('\n');
}
