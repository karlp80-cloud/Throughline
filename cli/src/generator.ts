/**
 * Top-level generator pipeline (architect doc §7).
 *
 * Drives the state machine:
 *   1. Build prompts.
 *   2. Call claudeSpawn.
 *   3. Validate via shared Zod schema.
 *   4. If valid, run solver on every puzzle.
 *   5. If all solvable, return manifest.
 *   6. If validation fails: retry full manifest, up to 3 attempts.
 *   7. If one or more puzzles unsolvable, retry full manifest up to 3
 *      attempts. After that, switch to per-puzzle regen (3 per
 *      puzzle).
 *
 * Both `spawn` and `solve` are injectable so tests can drive every
 * branch without subprocesses or engine runs.
 */

import { run as defaultSpawn, type ClaudeSpawnResult } from './claudeSpawn';
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildPuzzleRegenPrompt,
  type RetryFeedback,
  type UserPromptOpts,
} from './promptBuilder';
import { validate } from './validator';
import { solve as defaultSolve, type SolveResult } from './solver';
import { createPRNG, type PRNG } from './solver/prng';
import { toEnginePuzzle } from '../../src/campaign/load';
import type { RawCampaign, RawPuzzle } from '../../src/schema/campaign';

const MANIFEST_RETRY_CAP = 3;
const PER_PUZZLE_REGEN_CAP = 3;

export type ExhaustionCategory = 'validation' | 'solver';

export class GeneratorExhaustedError extends Error {
  readonly category: ExhaustionCategory;
  readonly issues: readonly string[];
  readonly lastFeedback: RetryFeedback | null;
  constructor(
    category: ExhaustionCategory,
    message: string,
    issues: readonly string[],
    lastFeedback: RetryFeedback | null,
  ) {
    super(message);
    this.name = 'GeneratorExhaustedError';
    this.category = category;
    this.issues = issues;
    this.lastFeedback = lastFeedback;
  }
}

export type SpawnFn = (opts: {
  systemPrompt: string;
  userPrompt: string;
  timeoutMs?: number;
}) => Promise<ClaudeSpawnResult>;

export type SolveFn = (
  puzzle: ReturnType<typeof toEnginePuzzle>,
  opts?: { timeBudgetMs?: number; seed?: string },
) => SolveResult;

export interface GenerateOptions {
  readonly seed: string;
  readonly acts: number;
  readonly puzzlesPerAct: number;
  readonly timeBudgetPerPuzzleMs?: number;
  readonly llmTimeoutMs?: number;
  readonly gentle?: boolean;
  readonly avoidThemes?: readonly string[];
  /** Test hook. */
  readonly spawn?: SpawnFn;
  /** Test hook. */
  readonly solve?: SolveFn;
  /** Test hook: returns backoff ms for retry attempt i (0-based). Default uses 500*2^i + prng jitter. */
  readonly backoffMs?: (attempt: number, prng: PRNG) => number;
}

export interface GenerateStats {
  readonly manifestAttempts: number;
  readonly puzzleRegenAttempts: Record<string, number>;
  readonly elapsedMs: number;
  readonly totalLlmCalls: number;
}

export interface GenerateResult {
  readonly manifest: RawCampaign;
  readonly stats: GenerateStats;
}

function defaultBackoff(attempt: number, prng: PRNG): number {
  return 500 * Math.pow(2, attempt) + prng.nextInt(0, 250);
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}

/**
 * Solve every puzzle in the validated manifest. Returns the first
 * unsolvable puzzle's id + best progress, or null on full success.
 */
function checkSolvability(
  manifest: RawCampaign,
  solve: SolveFn,
  budgetMs: number,
): { unsolvablePuzzleId: string; bestProgress: number } | null {
  for (const act of manifest.acts) {
    for (const p of act.puzzles) {
      const enginePuzzle = toEnginePuzzle(p);
      const result = solve(enginePuzzle, { timeBudgetMs: budgetMs });
      if (result.status !== 'solvable') {
        return { unsolvablePuzzleId: p.id, bestProgress: result.bestProgress };
      }
    }
  }
  return null;
}

/** Look up [actIndex, puzzleIndex] for a given puzzle id; throws if not found. */
function locatePuzzle(
  manifest: RawCampaign,
  puzzleId: string,
): {
  actIdx: number;
  puzzleIdx: number;
  actId: string;
} {
  for (let a = 0; a < manifest.acts.length; a++) {
    const act = manifest.acts[a]!;
    for (let p = 0; p < act.puzzles.length; p++) {
      if (act.puzzles[p]!.id === puzzleId) {
        return { actIdx: a, puzzleIdx: p, actId: act.id };
      }
    }
  }
  throw new Error(`locatePuzzle: id "${puzzleId}" not found in manifest`);
}

/**
 * Splice the replacement puzzle from M' into M at the index where the
 * original puzzle id lived (Q1=a, index-based splice). Returns a NEW
 * manifest with the splice applied; does not mutate the input.
 */
function spliceReplacement(
  manifest: RawCampaign,
  puzzleId: string,
  replacement: RawCampaign,
): RawCampaign {
  const loc = locatePuzzle(manifest, puzzleId);
  // Find the same index in M'.
  const replAct = replacement.acts[loc.actIdx];
  const replPuzzle = replAct?.puzzles[loc.puzzleIdx];
  if (!replPuzzle) {
    throw new Error(
      `replacement manifest missing puzzle at acts[${loc.actIdx}].puzzles[${loc.puzzleIdx}]`,
    );
  }
  const updatedActs = manifest.acts.map((act, a) => {
    if (a !== loc.actIdx) return act;
    return {
      ...act,
      puzzles: act.puzzles.map((p, i) => (i === loc.puzzleIdx ? (replPuzzle as RawPuzzle) : p)),
    };
  });
  return { ...manifest, acts: updatedActs };
}

export async function generate(opts: GenerateOptions): Promise<GenerateResult> {
  const start = Date.now();
  const spawn = opts.spawn ?? defaultSpawn;
  const solve = opts.solve ?? defaultSolve;
  const backoff = opts.backoffMs ?? defaultBackoff;
  const timeBudget = opts.timeBudgetPerPuzzleMs ?? 30_000;
  const prng = createPRNG(opts.seed);

  const systemPrompt = buildSystemPrompt();
  const baseUserOpts: UserPromptOpts = {
    seed: opts.seed,
    acts: opts.acts,
    puzzlesPerAct: opts.puzzlesPerAct,
    gentle: opts.gentle ?? false,
    avoidThemes: opts.avoidThemes ?? [],
  };

  let manifestAttempts = 0;
  let totalLlmCalls = 0;
  let lastFeedback: RetryFeedback | null = null;
  const puzzleRegenAttempts: Record<string, number> = {};

  // ─── Manifest-level attempts ────────────────────────────────────
  let manifest: RawCampaign | null = null;
  for (let attempt = 0; attempt < MANIFEST_RETRY_CAP; attempt++) {
    if (attempt > 0) await sleep(backoff(attempt - 1, prng));
    const userOpts: UserPromptOpts =
      lastFeedback === null
        ? baseUserOpts
        : { ...baseUserOpts, previousAttemptFeedback: lastFeedback };
    const userPrompt = buildUserPrompt(userOpts);
    const r = await spawn({
      systemPrompt,
      userPrompt,
      ...(opts.llmTimeoutMs !== undefined ? { timeoutMs: opts.llmTimeoutMs } : {}),
    });
    totalLlmCalls++;
    manifestAttempts++;

    const v = validate(r.stdout);
    if (!v.ok) {
      lastFeedback =
        v.failure.kind === 'json-syntax'
          ? { kind: 'json-syntax', message: v.failure.message }
          : { kind: 'schema', issues: v.failure.issues };
      continue;
    }

    // Validated. Try the solver.
    const solveResult = checkSolvability(v.manifest, solve, timeBudget);
    if (solveResult === null) {
      // All solvable — ship. Clear feedback so the post-loop branch
      // doesn't accidentally fall into per-puzzle regen.
      manifest = v.manifest;
      lastFeedback = null;
      break;
    }
    if (process.env['THROUGHLINE_TRACE_SPAWN'] === '1') {
      process.stderr.write(
        `[solver-trace] manifest attempt ${manifestAttempts} unsolvable: ` +
          `puzzleId=${solveResult.unsolvablePuzzleId} bestProgress=${solveResult.bestProgress}\n`,
      );
    }
    lastFeedback = {
      kind: 'solver',
      puzzleId: solveResult.unsolvablePuzzleId,
      bestProgress: solveResult.bestProgress,
    };
    // Keep the manifest around for the regen phase in case we exhaust
    // manifest retries below.
    manifest = v.manifest;
  }

  if (manifest === null) {
    throw new GeneratorExhaustedError(
      'validation',
      `manifest validation failed after ${manifestAttempts} attempts`,
      lastFeedback && 'issues' in lastFeedback ? lastFeedback.issues : [],
      lastFeedback,
    );
  }

  // If we exited the loop with manifest set but lastFeedback is a solver
  // failure, we need to drop to per-puzzle regen.
  if (lastFeedback && lastFeedback.kind === 'solver') {
    // ─── Per-puzzle regeneration ────────────────────────────────
    let unsolvableId: string | null = lastFeedback.puzzleId;
    let unsolvableProgress = lastFeedback.bestProgress;
    while (unsolvableId !== null) {
      const id: string = unsolvableId;
      puzzleRegenAttempts[id] = puzzleRegenAttempts[id] ?? 0;
      let spliced: RawCampaign | null = null;
      for (let r = 0; r < PER_PUZZLE_REGEN_CAP; r++) {
        if (manifestAttempts + totalLlmCalls > 0) {
          await sleep(backoff(r, prng));
        }
        const userPrompt = buildPuzzleRegenPrompt(manifest, id, {
          bestProgress: unsolvableProgress,
        });
        const resp = await spawn({
          systemPrompt,
          userPrompt,
          ...(opts.llmTimeoutMs !== undefined ? { timeoutMs: opts.llmTimeoutMs } : {}),
        });
        totalLlmCalls++;
        puzzleRegenAttempts[id]!++;
        const v = validate(resp.stdout);
        if (!v.ok) {
          // Treat as a failed regen attempt; loop.
          continue;
        }
        // Splice the new puzzle into the existing manifest.
        let candidate: RawCampaign;
        try {
          candidate = spliceReplacement(manifest, id, v.manifest);
        } catch {
          continue;
        }
        // Re-solve only the spliced puzzle (architect §7.3).
        const loc = locatePuzzle(candidate, id);
        const puzzle = candidate.acts[loc.actIdx]!.puzzles[loc.puzzleIdx]!;
        const enginePuzzle = toEnginePuzzle(puzzle);
        const solveResult = solve(enginePuzzle, { timeBudgetMs: timeBudget });
        if (solveResult.status === 'solvable') {
          spliced = candidate;
          break;
        }
        unsolvableProgress = solveResult.bestProgress;
      }
      if (spliced === null) {
        throw new GeneratorExhaustedError(
          'solver',
          `puzzle "${id}" still unsolvable after ${PER_PUZZLE_REGEN_CAP} regeneration attempts`,
          [`puzzle ${id} bestProgress=${unsolvableProgress.toFixed(2)}`],
          { kind: 'solver', puzzleId: id, bestProgress: unsolvableProgress },
        );
      }
      manifest = spliced;
      // Re-check ALL puzzles — the regen could in principle have
      // disturbed nothing else, but be defensive.
      const recheck = checkSolvability(manifest, solve, timeBudget);
      if (recheck === null) {
        unsolvableId = null;
      } else {
        unsolvableId = recheck.unsolvablePuzzleId;
        unsolvableProgress = recheck.bestProgress;
      }
    }
  }

  return {
    manifest,
    stats: {
      manifestAttempts,
      puzzleRegenAttempts,
      elapsedMs: Date.now() - start,
      totalLlmCalls,
    },
  };
}
