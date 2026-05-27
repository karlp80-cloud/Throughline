/**
 * CLI entry point: throughline-gen.
 *
 * Argument parsing via `node:util.parseArgs` — zero dependencies, no
 * argv parsing surface to audit. Strict mode is on; unknown flags
 * throw. Positionals are disallowed.
 *
 * Top-level error handling maps exhaustion / spawn / writer errors to
 * exit codes per architect §9.3:
 *
 *     0  success
 *     1  generic error (uncaught bug)
 *     2  LLM produced unvalidatable output after retry exhaustion
 *     3  solver could not find a solution after regen exhaustion
 *     4  path safety violation
 *     5  subprocess failed to launch
 */

import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';
import { generate, GeneratorExhaustedError } from './generator';
import { writeManifest, WriterPathError } from './writer';
import { ClaudeSpawnError } from './claudeSpawn';

const VERSION = '0.1.0';

const HELP = `throughline-gen — generate a Throughline campaign manifest via Claude

Usage:
  throughline-gen --out <path> [options]

Required:
  --out, -o <path>            Output path for campaign.json

Options:
  --seed <string>             RNG seed (default: random)
  --acts <n>                  Number of acts (1-8, default: 3)
  --puzzles-per-act <n>       Puzzles per act (1-16, default: 4)
  --time-budget-per-puzzle <s>  Solver budget per puzzle (default: 30)
  --gentle                    Bias toward easier puzzles
  --avoid-themes <a,b,c>      Themes to avoid (comma-separated)
  --llm-timeout-ms <n>        Advanced: subprocess timeout (default: 180000)
  --verbose                   Stream subprocess output
  --help, -h                  Show this help
  --version, -v               Show version

Exit codes:
  0  success    2  validation exhausted    3  solver exhausted
  4  path error 5  subprocess launch failed
`;

interface ParsedFlags {
  out: string;
  seed: string;
  acts: number;
  puzzlesPerAct: number;
  timeBudgetPerPuzzleMs: number;
  gentle: boolean;
  avoidThemes: readonly string[];
  llmTimeoutMs: number;
  verbose: boolean;
}

function parseIntInRange(name: string, raw: string, lo: number, hi: number): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < lo || n > hi) {
    throw new Error(`--${name} must be an integer in [${lo}, ${hi}]; got "${raw}"`);
  }
  return n;
}

function parseFlags(argv: readonly string[]): ParsedFlags | { help: true } | { version: true } {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      out: { type: 'string', short: 'o' },
      seed: { type: 'string' },
      acts: { type: 'string' },
      'puzzles-per-act': { type: 'string' },
      'time-budget-per-puzzle': { type: 'string' },
      gentle: { type: 'boolean', default: false },
      'avoid-themes': { type: 'string' },
      'llm-timeout-ms': { type: 'string' },
      verbose: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help) return { help: true };
  if (values.version) return { version: true };

  if (typeof values.out !== 'string' || values.out.length === 0) {
    throw new Error('--out is required. See --help.');
  }

  const seed =
    typeof values.seed === 'string' && values.seed.length > 0
      ? values.seed
      : randomBytes(8).toString('hex');
  const acts = typeof values.acts === 'string' ? parseIntInRange('acts', values.acts, 1, 8) : 3;
  const puzzlesPerAct =
    typeof values['puzzles-per-act'] === 'string'
      ? parseIntInRange('puzzles-per-act', values['puzzles-per-act'], 1, 16)
      : 4;
  const timeBudgetPerPuzzleS =
    typeof values['time-budget-per-puzzle'] === 'string'
      ? parseIntInRange('time-budget-per-puzzle', values['time-budget-per-puzzle'], 1, 300)
      : 30;
  // Default kept in sync with claudeSpawn.DEFAULT_TIMEOUT_MS (180s).
  // The 60s default was too tight under Tauri-launched runs once the
  // CLI started getting realistic full-manifest prompts; bumping here
  // because the argv layer overrides claudeSpawn's constant.
  const llmTimeoutMs =
    typeof values['llm-timeout-ms'] === 'string'
      ? parseIntInRange('llm-timeout-ms', values['llm-timeout-ms'], 1_000, 600_000)
      : 180_000;
  const avoidThemes =
    typeof values['avoid-themes'] === 'string' && values['avoid-themes'].length > 0
      ? values['avoid-themes']
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : [];

  return {
    out: values.out,
    seed,
    acts,
    puzzlesPerAct,
    timeBudgetPerPuzzleMs: timeBudgetPerPuzzleS * 1000,
    gentle: values.gentle ?? false,
    avoidThemes,
    llmTimeoutMs,
    verbose: values.verbose ?? false,
  };
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  let parsed: ParsedFlags | { help: true } | { version: true };
  try {
    parsed = parseFlags(argv);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`error: ${msg}\n`);
    return 1;
  }

  if ('help' in parsed) {
    process.stdout.write(HELP);
    return 0;
  }
  if ('version' in parsed) {
    process.stdout.write(`throughline-gen ${VERSION}\n`);
    return 0;
  }

  const flags = parsed;
  if (flags.verbose) {
    process.stderr.write(
      `throughline-gen: seed=${flags.seed} acts=${flags.acts} puzzles-per-act=${flags.puzzlesPerAct}\n`,
    );
  }

  try {
    const result = await generate({
      seed: flags.seed,
      acts: flags.acts,
      puzzlesPerAct: flags.puzzlesPerAct,
      timeBudgetPerPuzzleMs: flags.timeBudgetPerPuzzleMs,
      llmTimeoutMs: flags.llmTimeoutMs,
      gentle: flags.gentle,
      avoidThemes: flags.avoidThemes,
    });
    await writeManifest(flags.out, result.manifest);
    if (flags.verbose) {
      process.stderr.write(
        `throughline-gen: ${result.stats.totalLlmCalls} LLM calls, ${result.stats.elapsedMs}ms\n`,
      );
    }
    process.stdout.write(flags.out + '\n');
    return 0;
  } catch (e) {
    if (e instanceof GeneratorExhaustedError) {
      process.stderr.write(`error: ${e.message}\n`);
      for (const issue of e.issues) process.stderr.write(`  - ${issue}\n`);
      return e.category === 'solver' ? 3 : 2;
    }
    if (e instanceof WriterPathError) {
      process.stderr.write(`error: refused to write to "${e.path}" — ${e.kind}\n`);
      return 4;
    }
    if (e instanceof ClaudeSpawnError) {
      if (e.reason === 'spawn-failed') {
        process.stderr.write(`error: ${e.message}\n`);
        return 5;
      }
      process.stderr.write(`error: claude -p subprocess: ${e.reason} (exit ${e.exitCode})\n`);
      if (e.stderr) process.stderr.write(e.stderr + '\n');
      return 1;
    }
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`error: ${msg}\n`);
    return 1;
  }
}

// Invoked as a script (the bin wrapper imports this module and the
// import side-effect runs main). This guard makes the file importable
// from tests without launching main().
const isMain =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  /throughline-gen|index\.(js|mjs|ts)$/.test(process.argv[1]);
if (isMain) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
}
