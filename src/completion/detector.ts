/**
 * Compute per-puzzle stats and evaluate optional challenges.
 *
 * Pure function over (puzzle, solution, trace). The DSL evaluator
 * throws RuleEvalError on type mismatches / div-by-zero, but the
 * detector translates those into passed=false so the UI never sees
 * an error surface (the manifest loader in Phase 7 catches malformed
 * rules at load time; this is the defensive fallback).
 */

import type { CycleTrace, Puzzle, Solution } from '../engine';
import { evaluateRule } from '../dsl';

export interface CompletionStats {
  readonly cycles: number;
  readonly tiles_used: number;
  readonly agent_count: number;
  readonly ops_total: number;
}

export interface ChallengeResult {
  readonly id: string;
  readonly label: string;
  readonly passed: boolean;
}

export interface CompletionResult {
  readonly stats: CompletionStats;
  readonly optionals: readonly ChallengeResult[];
}

export function detectCompletion(
  puzzle: Puzzle,
  solution: Solution,
  trace: readonly CycleTrace[],
): CompletionResult {
  // ops_total counts every entry in every agent's program. SENSE
  // counts as one program slot per memo §9.
  let opsTotal = 0;
  for (const program of Object.values(solution.programs)) {
    opsTotal += program.length;
  }

  const stats: CompletionStats = {
    cycles: trace.length,
    tiles_used: solution.tiles.length,
    agent_count: Object.keys(solution.programs).length,
    ops_total: opsTotal,
  };

  const optionals = puzzle.optionalChallenges.map((c) => {
    let passed = false;
    try {
      passed = evaluateRule(c.rule, stats);
    } catch {
      // Malformed rule (RuleParseError) — defensive fallback. The
      // loader (Phase 7) is the canonical gate.
      passed = false;
    }
    return { id: c.id, label: c.label, passed };
  });

  return { stats, optionals };
}
