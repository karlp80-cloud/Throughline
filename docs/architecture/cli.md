# Throughline CLI Architecture (Phase 10)

> **Status:** Architect step. Awaiting user review before Coder begins.
> **Cycle:** Full — and the most important review pass in the project.
> **Companion:** [throughline-design.md](../../throughline-design.md) §9 (CLI design); [IMPLEMENTATION_PLAN.md § Phase 10](../../IMPLEMENTATION_PLAN.md); [docs/architecture/engine.md](engine.md) (reused unchanged); [docs/architecture/campaign-state.md](campaign-state.md) §1 (Zod schema, reused unchanged).

This memo locks in the pipeline, subprocess contract, prompt shape, validator surface, solver strategy, retry/regenerate logic, atomic-write semantics, CLI arguments, file layout, test strategy, and security-checklist-as-code for the Throughline companion CLI. Once approved, the Coder builds against these contracts via strict TDD.

Open decisions where the spec is silent are in §13; please respond before Coder begins.

---

## 1. Scope and trust boundary

`throughline-gen` is a **standalone Node CLI** that produces a `campaign.json` manifest by invoking `claude -p` as a subprocess. It is the **only** component in the project that talks to an LLM. The game engine never does.

This is the **entry point of the untrusted-input trust boundary.** Everything that flows into game code from `campaign.json` originates here, gated through:

1. **Strict subprocess invocation** — argv-only, never a shell string.
2. **Zod validation** — the shared schema (`src/schema/campaign.ts`), which already has `.strict()` everywhere, `.max()` on every string, and a closed identifier set for the rule DSL.
3. **Automated solvability check** — re-uses the Phase 1 engine; catches the LLM's most likely failure mode (over-constrained puzzles).
4. **Path safety** — every output path is `path.resolve`d and rejected if it escapes CWD.
5. **Atomic write** — temp-file + fsync + rename so partial-write corruption is structurally impossible.

The reviewer step is the most important in the project. §12 translates every reviewer check into an automated test or lint rule that catches regressions, so the reviewer phase verifies rather than discovers.

---

## 2. Top-level pipeline

```
                ┌──────────────┐
                │ promptBuilder│
                └──────┬───────┘
                       │   {system, user}
                       ▼
                ┌──────────────┐       stdout
                │ claudeSpawn  │────────────────┐
                └──────┬───────┘                │
                       │ stdout (bytes)         │
                       ▼                        │
                ┌──────────────┐                │
                │ validator    │ (Zod strict)   │
                └──────┬───────┘                │
                       │ RawCampaign            │
                       ▼                        │
                ┌──────────────┐                │
                │ solver       │ (per-puzzle)   │
                └──────┬───────┘                │
                       │ {solvable | regen}     │
                       ▼                        │
                ┌──────────────┐                │
                │ generator    │  retry loop ◄──┘
                └──────┬───────┘
                       │ valid + solvable
                       ▼
                ┌──────────────┐
                │ writer       │ (atomic)
                └──────────────┘
```

Steps 1–7 below trace the IMPLEMENTATION_PLAN §1 pipeline with explicit failure handling and rollback semantics at each step.

### 2.1 Step 1 — Build system prompt

`promptBuilder.buildSystemPrompt()` loads `cli/src/prompts/system.md` from disk **at startup**, not at every generation call (it is large; cache it). The contents are described in §4.

**Failure:** if the file is missing or unreadable, fail fast at CLI startup with a clear error pointing at the path. No retry — this is a packaging bug.

### 2.2 Step 2 — Build user prompt

`promptBuilder.buildUserPrompt(opts)` produces a short markdown payload describing the requested campaign:

```
Generate a Throughline campaign with the following parameters.

- seed: <opts.seed>
- acts: <opts.acts>
- puzzles per act: <opts.puzzlesPerAct>
- gentle: <true | false>           (omit line if false)
- avoid themes: <list>             (omit line if empty)
- previous attempt feedback:       (omit if first attempt)
  <serialized Zod issues or solver failure>

Output strictly: a single JSON object matching the schema in your
system prompt. Begin your reply with `{` and end with `}`. No prose
before or after the JSON. No code fences.
```

**Failure:** the builder is a pure function over the options object; no runtime failure modes beyond programmer error.

### 2.3 Step 3 — Spawn `claude -p`

`claudeSpawn.run(systemPrompt, userPrompt, signal)` invokes the subprocess. Full contract in §3.

**Failure handling:**

- **Non-zero exit code** → throw `ClaudeSpawnError` with `exitCode`, captured stderr (truncated to 4KB to defend against unbounded log growth), and stdout-so-far (also truncated).
- **Timeout (60s wall clock)** → `signal.abort()`, then `child.kill('SIGTERM')`; after 2s grace, `SIGKILL`. Throw `ClaudeSpawnError` with `reason: 'timeout'`.
- **Spawn failure (binary not found, EACCES)** → throw `ClaudeSpawnError` with `reason: 'spawn-failed'` and the underlying errno. The CLI's top-level error handler prints a helpful message ("Is `claude` installed and on PATH?").

**Rollback:** none. No state has been written yet.

### 2.4 Step 4 — Validate

`validator.validate(rawStdout: string) → RawCampaign | ValidationError`:

1. Strip trailing whitespace; reject if empty.
2. Strip a single optional Markdown code fence if present (`^```json\n` … `\n```$`). LLMs sometimes wrap output despite instructions to the contrary. Defense in depth: even if the prompt says "no fences," tolerate the most common deviation.
3. `JSON.parse` → on `SyntaxError`, return `ValidationError` with category `json-syntax` and the parser's message.
4. `parseCampaign(parsed)` (from `src/schema/campaign.ts`) → on `CampaignParseError`, return `ValidationError` with category `schema` and the full `issues[]` array.

**Failure:** structured `ValidationError` returned to the generator, which decides whether to retry (§2.6) or surface to the user.

### 2.5 Step 5 — Solvability check

For each puzzle in the validated manifest, `solver.solve(puzzle, opts) → SolveResult`. Full contract in §6.

**Result shape:**

```ts
type SolveResult =
  | { status: 'solvable'; solution: Solution; attempts: number; elapsedMs: number }
  | { status: 'unsolvable'; attempts: number; elapsedMs: number; bestProgress: number };
```

The solver does not throw on "unsolvable" — that's a *legal* outcome that triggers per-puzzle regeneration.

**Failure:** if the solver itself crashes (assertion failure inside the engine, OOM, etc.), the error bubbles up as `SolverError` to the generator, which logs it and terminates the CLI with a non-zero exit code. This is a Throughline bug, not an LLM failure mode; retrying would be useless.

### 2.6 Step 6 — Retry / regenerate

`generator.generate(opts)` orchestrates the loop. Full contract in §7. Two distinct retry budgets:

- **Manifest-level retries:** 3 total LLM calls per CLI invocation for the *full* manifest. Triggered by JSON syntax errors, schema validation failures, or — in v1 — by *any* unsolvable puzzle on the first pass (so the LLM gets at least one shot to fix the whole thing before we move to per-puzzle surgery). After 3 manifest attempts, drop to per-puzzle mode.
- **Per-puzzle regeneration:** 3 total calls *per unsolvable puzzle*. Each call takes the *full validated manifest* as context and asks for a replacement puzzle that fits the same act slot, preserving everything else.

Backoff: `500 * 2^attempt + jitter(0, 250)` ms between calls, computed via the seeded PRNG (§6.3) so retries are reproducible given the same seed.

**Hard upper bound:** `total_llm_calls ≤ 3 + 3 × max_puzzles`. With the schema's 16-puzzle-per-act × 8-act cap (128 puzzles max), that is 387 calls in the worst case. The reviewer's "hit retry cap" test verifies the generator exits cleanly at this ceiling rather than spinning forever.

**Rollback at retry exhaustion:** no file has been written. Print the categorized failure to stderr and exit with code 2 (validation/solver exhaustion — distinguishable from code 1, generic error).

### 2.7 Step 7 — Atomic write

`writer.write(absolutePath, manifest)`:

1. Resolve and verify the path is inside CWD (§8).
2. Compute `tmpPath = ${absolutePath}.tmp-${pid}-${counter}` (same directory, same volume — required for atomic rename on Windows).
3. `fs.writeFile(tmpPath, jsonString)`.
4. Open `tmpPath`, `fsync(fd)`, close. Forces buffer flush before rename.
5. `fs.rename(tmpPath, absolutePath)`. On POSIX this is atomic; on Windows it is atomic only when source and destination are on the same volume, which step 2 guarantees.
6. (Best-effort) fsync the *directory* on POSIX so the rename is durable across crashes. Skip on Windows where directory-fd APIs aren't available.

**Rollback:** if any step fails after the tmp file is created, delete the tmp file and rethrow. The destination is untouched.

---

## 3. Subprocess wrapper contract (`claudeSpawn.ts`)

```ts
export interface ClaudeSpawnOptions {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  /** Wall-clock budget in ms. Default 60_000. */
  readonly timeoutMs?: number;
  /** Optional AbortSignal — used by Phase 11 to cancel from UI. */
  readonly signal?: AbortSignal;
}

export interface ClaudeSpawnResult {
  readonly stdout: string;     // full subprocess stdout
  readonly stderr: string;     // captured, possibly truncated to 4KB
  readonly exitCode: number;
  readonly elapsedMs: number;
}

export class ClaudeSpawnError extends Error {
  readonly reason: 'non-zero-exit' | 'timeout' | 'spawn-failed' | 'aborted';
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly stdoutSoFar: string;
}

export async function run(opts: ClaudeSpawnOptions): Promise<ClaudeSpawnResult>;
```

### 3.1 Exact `spawn` invocation

```ts
import { spawn } from 'node:child_process';

const child = spawn(
  'claude',
  ['--print', '--append-system-prompt', opts.systemPrompt],
  {
    shell: false,                          // CRITICAL — see §3.3
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,                     // suppress flash on Win
    // No `env` override: inherits the user's env so `claude` can find its config.
  },
);
```

The user prompt is then written to **stdin**:

```ts
child.stdin.write(opts.userPrompt, 'utf8');
child.stdin.end();
```

### 3.2 Stdin vs argv for the system prompt — decision

**The system prompt goes through `--append-system-prompt` (argv); the user prompt goes through stdin.**

The system prompt is large — schema + glyph catalog + DSL grammar + ~3 examples will be 10–20 KB. Three approaches were considered:

| Approach | Pros | Cons |
|---|---|---|
| Both on stdin (concat) | Avoids argv size limits | Mixes role boundaries; LLM has no separate system context |
| System on argv via `--append-system-prompt`; user on stdin | Clean role separation; mirrors how the Anthropic API is structured; stdin handles arbitrarily long user prompts | argv has size limits |
| Both on argv | Simplest invocation | Hits Windows' 32 KB `CommandLine` ceiling at our prompt size |

**Choice: middle option.** The system prompt at ~10–20 KB is well below the ~128 KB POSIX `ARG_MAX` floor and the ~32 KB Windows `CommandLine` limit, **but** the reviewer's test in §12 includes a `prompt.length` assertion (`< 30_000`) that fails CI if the system prompt grows past the safe envelope. If a future feature pushes the system prompt past 30 KB, the test prompts a redesign: split the prompt into smaller stdin-passed turns, or migrate to the Anthropic SDK directly (out of scope for v1; design doc §4 commits to `claude -p`).

The user prompt is comparatively small (~500 bytes) and unbounded only via retry-feedback appendage; even the worst-case Zod issue array stays well under 8 KB. Stdin handles it cleanly.

### 3.3 Why `shell: false`

`shell: true` would invoke `cmd.exe` (Windows) or `/bin/sh` (POSIX) to parse the command line. Any prompt content reaching the shell unquoted would be interpreted as shell metacharacters. We pass argv as a single string in a JS array; with `shell: false` Node passes that string to the OS exec call **as one argument byte-for-byte**, no parsing.

Adversary scenario: a future feature adds a `--include-file` flag that takes a user-supplied filename and embeds the file contents into the user prompt. If `shell: true` were ever flipped on, an attacker who controls a file the player loads could include shell metacharacters in the prompt and break out. With `shell: false`, this attack is structurally impossible — there is no shell to break out of.

### 3.4 Stdout / stderr handling

- Both streams are captured into Node `Buffer` arrays as `'data'` events fire, then concatenated and decoded once at end-of-process. This avoids partial-UTF-8 codepoints across chunk boundaries.
- Stderr is **capped at 4 KB** during capture. Beyond that, additional chunks are dropped and a `… (stderr truncated)` marker is appended. This defends against a runaway subprocess writing GB of stderr.
- Stdout is **not capped during capture** — we need the full JSON. But after `JSON.parse`, the unstructured string is dropped; only the `RawCampaign` object lives onward.
- Both streams are forwarded to the CLI's progress logger only when `--verbose` is set. Default output is silent except for the final success line.

### 3.5 Timeout behavior

```ts
const timer = setTimeout(() => {
  controller.abort();                       // signal to whoever called us
  child.kill('SIGTERM');
  killTimer = setTimeout(() => child.kill('SIGKILL'), 2_000);
}, opts.timeoutMs ?? 60_000);

child.once('close', (code) => {
  clearTimeout(timer);
  clearTimeout(killTimer);
  // ... resolve / reject
});
```

The default wall-clock budget is **60 seconds**. This is generous for typical Claude responses (<15 s) and bounded enough that a hung subprocess never wedges CI or Phase 11's UI.

Configurable via `--llm-timeout-ms` (undocumented advanced flag; in `--help` under "advanced"). The Phase 11 UI passes a 5-minute timeout to account for retries.

### 3.6 Exit-code handling

| Exit code | Meaning | Generator response |
|---|---|---|
| 0 | Success | Parse stdout |
| Non-zero, killed by timeout | We timed out | Retry per §2.6 (`reason: 'timeout'` counted toward retry budget) |
| Non-zero, normal exit | `claude -p` itself errored (auth, rate limit, etc.) | Throw to top-level CLI; print stderr; exit 1 |

Auth errors aren't retried — they'll fail on every attempt. The generator distinguishes by examining stderr for auth-failure markers (best-effort string match, *not* used for security decisions, only to give the user a better error message).

---

## 4. Prompt construction (`promptBuilder.ts`)

### 4.1 What's in `cli/src/prompts/system.md`

Checked-in markdown, loaded at startup, **never concatenated from many small string literals at runtime**. Audit-friendly: a reviewer reads one file. (Reviewer checklist §12 verifies this contract — see test §10.3.)

The file is structured into **labeled sections** the LLM can navigate:

```markdown
# Throughline Campaign Generator — System Prompt

## Your role

You are generating a complete `campaign.json` manifest for the
Throughline puzzle game …

## Output format

You will output one JSON object, no prose, no code fences.
Begin with `{` and end with `}`.

## Schema reference

(Verbatim restatement of every field in CampaignSchema with type,
constraints, max length, and enum membership. Generated from a
small script that introspects the Zod schema and emits this section
at build time — `cli/scripts/build-prompt.ts`. Stored as the file
`cli/src/prompts/system.md` after generation; checked in so it's
auditable.)

## Mechanics summary

(Concise prose covering tile behaviors, agent ops, simultaneous-move
resolution, rate semantics, halt conditions — drawn from design doc
§6 and engine.md.)

## Glyph catalog

(Verbatim contents of `src/render/glyphs/families.json` — the closed
set of valid `glyphs` values. The LLM is told: pick variants only
from this list; an unknown variant is rejected.)

## Rule DSL grammar

(Verbatim EBNF from rule-dsl.md §3 plus the closed identifier set.
The LLM is told: rules must parse with this grammar. Identifiers
outside `cycles | tiles_used | agent_count | ops_total` cause
manifest rejection.)

## Diversity directives

(Re-skinned from design doc §11 mitigation: don't collapse to sci-fi;
avoid the themes listed in --avoid-themes; if --gentle is set, bias
toward easier puzzles by lowering tile counts, raising cycle
budgets, and avoiding multi-agent puzzles.)

## Worked examples

(Three full mini-manifests — one alchemy-themed, one forensics-themed,
one sci-fi — each with one act and one puzzle. Hand-authored.
These set the tone for narrative voice and the "good shape" of a
manifest.)

## Solvability hints

(Brief: how to avoid over-constrained puzzles. E.g. "max_cycles
should be 4–6× the minimum-path-length estimate"; "if you require
N cargo of type X, ensure the input emits X with a rate ≤
max_cycles / N".)

## Anti-instructions

You must NOT:
- Output any prose before or after the JSON.
- Use Markdown code fences.
- Include comments inside the JSON.
- Use unknown fields, unknown glyphs, or rule identifiers outside
  the closed set.
- Reference `eval`, `function`, `script`, or any JavaScript runtime
  capability — these would be schema violations and your output
  will be rejected.
```

The "Anti-instructions" section is **defense in depth, not the primary defense.** Even if the LLM ignores them, the Zod schema (`.strict()` everywhere) and the DSL parser (closed identifier set) reject every prohibited construct. The instructions just save a retry cycle.

### 4.2 What's templated at call time

`promptBuilder.buildUserPrompt(opts)` is a pure function returning a short string. Inputs:

```ts
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
```

The retry-feedback serialization is documented in §5.4. The variable bits are kept in the *user* prompt (the dynamic turn), never spliced into the system prompt — that way the system prompt is byte-identical across runs and trivially cacheable.

### 4.3 Per-puzzle regeneration prompt

A specialized user-prompt mode (`buildPuzzleRegenPrompt(manifest, puzzleId, solverFeedback)`):

```
The manifest you produced is well-formed. One puzzle is not solvable
within the time budget — the automated solver could only fill
<bestProgress>% of its outputs.

Replace the puzzle with id "<puzzleId>" in act "<actId>" with a new
puzzle. Keep:
- act intro/outro
- all other puzzles unchanged
- the same id and approximate difficulty slot

Output a single JSON object: the full manifest with the puzzle
replaced. Same constraints as before. Begin with `{` and end with
`}`. No prose.
```

The generator splices the LLM's response *back into* the in-memory manifest, preserving all other fields. Then re-runs the solver on the replaced puzzle only.

---

## 5. Validator (`validator.ts`)

### 5.1 Public surface

```ts
export interface ValidationFailure {
  readonly kind: 'json-syntax' | 'schema';
  readonly message: string;
  readonly issues: readonly string[];
}

export type ValidationResult =
  | { ok: true; manifest: RawCampaign }
  | { ok: false; failure: ValidationFailure };

export function validate(rawStdout: string): ValidationResult;
```

### 5.2 Reuses the shared schema

`validator.ts` imports `parseCampaign` from `src/schema/campaign.ts` (no fork, no override). This is non-negotiable: Phase 7's game-side loader and Phase 10's CLI **must** parse byte-identically. A schema divergence between the CLI and the game is a guaranteed regression vector.

The schema already enforces:
- `.strict()` on every object → unknown fields fail validation.
- `.max(N)` on every string field → narrative text at most 2000 chars; titles at most 80; rule strings at most 200; etc.
- Closed enums for `TileKind`, `Op['kind']`, `Direction`.
- `version: z.literal(1)` → future LLMs can't fake-upgrade us.
- Post-Zod: every `optional_challenges[].rule` parsed by the rule DSL; identifiers outside the closed set cause `CampaignParseError`.
- Post-Zod: reactor/filter puzzles must declare `reactor_recipes` / `filter_types`.

### 5.3 Markdown-fence tolerance

```ts
function stripCodeFence(s: string): string {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/;
  const m = s.match(fenced);
  return m ? m[1]! : s;
}
```

This is the *only* tolerance: a single complete fenced block. Anything else (prose before/after the JSON, multiple JSON objects, comments) is rejected. The reviewer's "JSON-with-prose-prefix" fixture verifies rejection — see §10.

### 5.4 Retry feedback serialization

When the validator fails, the generator constructs a `RetryFeedback` and passes it to `buildUserPrompt`. The serialized form the LLM sees:

```
Your previous attempt failed validation:

Category: schema
3 issues:
  - acts[0].puzzles[2].grid.w: must be at most 32
  - acts[0].puzzles[2].inputs[0].rate: must be at least 1
  - acts[1].title: must be at most 80 characters

Fix these specific problems and emit a fresh complete manifest.
```

The translation rules:

- Each Zod issue's `path` is rendered as a dotted path (already done in `CampaignParseError.issues`).
- The message is the Zod message verbatim (already human-readable).
- We do **not** include the previous (broken) manifest in the retry prompt — token bloat for unclear gain. The LLM regenerates from scratch with the issue list as guidance.

For JSON syntax errors, the feedback is:

```
Your previous attempt was not valid JSON: <SyntaxError.message at position N>.
Output a single JSON object only — no prose, no fences, no trailing commas.
```

For solver failures (per-puzzle regen), the feedback is the puzzle-id-specific prompt from §4.3.

### 5.5 Error surface contract

The validator never throws. All failures are returned as structured `ValidationResult` values. This makes the generator's retry loop a pure state machine over the result.

---

## 6. Solver (`solver.ts`)

### 6.1 Goal

Catch over-constrained puzzles before they ship. The bar is **"there exists *some* solution within the puzzle's `max_cycles`,"** not "play optimally." A weak solver suffices — its job is a regression guard, not gameplay.

### 6.2 Search space

For each puzzle the solver generates candidate `Solution` objects with three components:

1. **Tile placements.** A list of `PlacedTile` records. Constrained by:
   - Tile kinds drawn from `puzzle.availableTiles`.
   - Positions on the grid, excluding obstacles, inputs, outputs, and agent start positions.
   - Tile count between 0 and `puzzle.constraints.maxTiles`.
   - Filter tiles get a `filterType` from `puzzle.filterTypes`; reactor tiles get a `recipe` from `puzzle.reactorRecipes`.
   - Facing drawn from {N, E, S, W}.
2. **Agent paths.** For each agent, a polyline starting at `agent.startPos` of length 1 to (say) `2 * (grid.w + grid.h)`. Adjacent cells only; no diagonal; revisits allowed.
3. **Agent programs.** For each agent, an op list of length 1 to `agent.maxOps`, sampled from `puzzle.availableOps`. `SENSE` op gets random `expects` from observed cargo types and random `then`/`otherwise` from non-SENSE leaves.

### 6.3 Strategy: iterated random restarts with seeded PRNG

```ts
export interface SolverOptions {
  /** Wall-clock budget in ms. Default 30_000. */
  readonly timeBudgetMs?: number;
  /** Deterministic seed for the PRNG. Default: hash of puzzle.id. */
  readonly seed?: string;
}

export type SolveResult =
  | { status: 'solvable'; solution: Solution; attempts: number; elapsedMs: number }
  | { status: 'unsolvable'; attempts: number; elapsedMs: number; bestProgress: number };

export function solve(puzzle: Puzzle, opts?: SolverOptions): SolveResult;
```

Algorithm:

```
seed PRNG from (opts.seed ?? hash(puzzle.id))
best = { progress: 0, solution: null }
while elapsed < budget:
  candidate = generateRandomSolution(puzzle, prng)
  result = runUntilHalt(puzzle, candidate)        // PHASE 1 ENGINE
  if result.status === 'victory':
    return { status: 'solvable', solution: candidate, attempts, elapsedMs }
  progress = fractionOfRequirementsFilled(puzzle, result.trace)
  if progress > best.progress:
    best = { progress, solution: candidate }
  attempts++
return { status: 'unsolvable', attempts, elapsedMs, bestProgress: best.progress }
```

**Why random restarts and not a smarter solver (A*, SAT, beam search)?**

- The puzzles are tiny (32×32 max grid; 0–8 agents; 0–256 tiles). Random restarts cover the space in seconds.
- A smarter solver is more code to write, test, and prove deterministic.
- The spec is unambiguous about weakness: design doc §9 calls this a "brute-force routing plan within time budget."
- An LLM-emitted over-constrained puzzle (the failure mode we care about) usually requires *trivial* solutions; the solver doesn't need to play optimally to find one.

### 6.4 Generation biases

Pure uniform random over the search space would almost never connect inputs to outputs. The generator biases toward **connectivity**:

- For each input → nearest output, lay down a candidate conveyor chain along the Manhattan path with 70% probability.
- Sprinkle remaining tiles randomly.
- For agents, bias paths toward an input → output traversal.

This is heuristic, not exhaustive — but it dramatically reduces the wasted attempts of pure random.

### 6.5 Termination

| Condition | Action |
|---|---|
| `runUntilHalt` returns `victory` | Return `solvable` immediately. |
| `Date.now() - startMs >= timeBudgetMs` | Return `unsolvable` with `bestProgress`. |
| `attempts > 100_000` | Return `unsolvable` (safety net — should never trigger before time budget). |

The wall-clock check uses `Date.now()` inside `solver.ts`. This is fine — the **engine** is forbidden from `Date.now`, the *solver* is not. The solver lives in `cli/src/`, not `src/engine/`.

### 6.6 Determinism

Two solver runs on the same `(puzzle, seed)` pair produce byte-identical `SolveResult` values, **including** the `elapsedMs` measurement? No — elapsed-ms varies with system load. The contract is:

- `status` is deterministic given `(puzzle, seed, timeBudgetMs ≥ T)` for any T larger than the solver's "find time" on that input. For inputs that are unsolvable, `status` is deterministic given the time budget.
- The `solution` field (when `solvable`) is byte-identical across runs — same seed → same PRNG sequence → same candidates in the same order → same first winner.
- `attempts` is deterministic.
- `elapsedMs` is *not* part of the determinism contract; it's reported for diagnostics.

This buys us a reproducible-failure property: if CI says a puzzle is unsolvable, you can rerun locally with the same seed and time budget and see the same result.

### 6.7 Reuses the engine — never forks

The solver imports `runUntilHalt` from `src/engine/index.ts`. It does not reimplement engine logic. If the engine evolves (Phase 11+ bug fixes, etc.), the solver tracks for free.

The solver also imports `Puzzle` and `Solution` types directly. The schema-to-engine translation (`toEnginePuzzle` in `src/campaign/load.ts`) is reused as-is — the validated `RawPuzzle` is converted before being passed to the solver.

### 6.8 No `Math.random` — seeded PRNG

The solver needs randomness but must be deterministic. **Implementation: splitmix64-style 64-bit PRNG, ~30 lines of code, no dependency.** Seed derived from `hashString(seed)` (FNV-1a, also stdlib-free).

This is the only place in the project where pseudo-randomness is welcome. It lives in `cli/src/solver/prng.ts` with a 100% unit-test coverage requirement (see §10).

### 6.9 Memory pressure

`runUntilHalt` allocates a `CycleTrace[]` per attempt, which for a maxed-out puzzle (10,000 cycles × 8 agents) could be ~50 MB. The solver discards the trace after each attempt; `attempts × 50 MB` would OOM. Mitigation:

- The solver passes a `traceCollect: false` option to a future variant of `runUntilHalt` that skips trace accumulation. **Engine change required:** add an option to `runUntilHalt` that returns only `{ status, finalWorld }` without building the trace array. This is a small, additive change to `src/engine/run.ts`; the existing trace-collecting form remains the default.
- Without that change, the solver instead recomputes progress from the final-world state only (no trace inspection). Spec'd in §6.10 below — chosen as the v1 path so Phase 10 doesn't have to touch Phase 1 engine code.

### 6.10 Progress metric (no-trace variant)

`fractionOfRequirementsFilled(puzzle, finalWorld)`:

```
required_total = sum of all OutputRequirement.count
delivered_total = sum of finalWorld.deliveredCounts[type] capped at required[type]
return delivered_total / required_total
```

A value in [0, 1]. Used only to track `bestProgress` on the unsolvable branch (helps the LLM's regen prompt know "how close" it was).

---

## 7. Generator pipeline (`generator.ts`)

### 7.1 Public surface

```ts
export interface GenerateOptions {
  readonly seed: string;
  readonly acts: number;
  readonly puzzlesPerAct: number;
  readonly timeBudgetPerPuzzleMs?: number;     // default 30_000
  readonly llmTimeoutMs?: number;              // default 60_000
  readonly gentle?: boolean;
  readonly avoidThemes?: readonly string[];
  /** Allows tests to inject a fake claudeSpawn. */
  readonly spawn?: typeof claudeSpawn.run;
  /** Allows tests to inject a fake solver. */
  readonly solve?: typeof solver.solve;
}

export interface GenerateResult {
  readonly manifest: RawCampaign;
  readonly stats: GenerateStats;
}

export interface GenerateStats {
  readonly manifestAttempts: number;
  readonly puzzleRegenAttempts: Record<string, number>;
  readonly elapsedMs: number;
  readonly totalLlmCalls: number;
}

export async function generate(opts: GenerateOptions): Promise<GenerateResult>;
```

The `spawn` and `solve` injection points exist solely so unit tests can mock the LLM and the solver — production code never passes them. (Reviewer §12 verifies this with a "no test hook left in production exports" check.)

### 7.2 State machine

```
START
  │
  ▼
ATTEMPT_MANIFEST
  ├──── on validate ok + all puzzles solvable ───▶ EMIT
  ├──── on validate fail, attempt < 3 ───────────▶ retry with feedback
  ├──── on validate fail, attempt = 3 ────────────▶ FAIL
  ├──── on validate ok, ≥1 unsolvable, attempt < 3 ▶ retry full manifest
  └──── on validate ok, ≥1 unsolvable, attempt = 3 ▶ REGEN_PUZZLES

REGEN_PUZZLES (per puzzle p):
  ├──── on regen ok + solvable ──▶ splice in; next puzzle
  ├──── on fail, regen < 3 ───────▶ retry with feedback
  └──── on fail, regen = 3 ───────▶ FAIL (cite p.id)

EMIT
  └──▶ writer.write(out, manifest); print success line.

FAIL
  └──▶ print categorized error to stderr; exit 2.
```

The choice to attempt the full manifest 3× before falling back to per-puzzle regen is deliberate. **Rationale:** if puzzle P1 is unsolvable, the cause is often a *theme-level* miscalibration (the LLM chose an "alchemy" theme that drove it to over-constrain) that gets fixed by a fresh manifest. Per-puzzle surgery should be a last resort, used when only one specific puzzle is the problem.

### 7.3 Per-puzzle preservation contract

When regenerating puzzle P inside manifest M:

1. Build the regen prompt with the *full* M as context (so the LLM sees the act's flavor and the surrounding puzzles' difficulty).
2. The LLM emits a full M′.
3. Splice: `M[P.act].puzzles[P.index] = M′[P.act].puzzles[P.index]`. Everything else in M stays.
4. Re-validate the spliced M (the schema check is cheap; do not skip — the LLM's other puzzles could have drifted).
5. Re-run the solver on the *replaced puzzle only*. We trust that previously-solvable puzzles remain solvable (their puzzle data is byte-identical to the previous M).

**Open question Q1 in §13:** is "splice in only the targeted puzzle" the right boundary, vs. "accept whichever puzzle slot in M′ has the same id"? Locked default: index-based splice, since `id` could legally repeat across acts if the LLM gets creative.

### 7.4 Exponential backoff with jitter

Computed via the PRNG seeded with `opts.seed`:

```ts
function backoffMs(attempt: number, prng: PRNG): number {
  const base = 500 * Math.pow(2, attempt);   // 500, 1000, 2000, ...
  const jitter = prng.nextInt(0, 250);
  return base + jitter;
}
```

The jitter is part of the seeded PRNG sequence, so a given `(seed, attempt-index)` always produces the same delay. This means a failing CI run reproduces locally with identical pacing — useful for debugging timeout-adjacent bugs.

### 7.5 Telemetry stub

`GenerateStats` is populated as the pipeline runs and returned even on success. Phase 11 surfaces these in its UI ("Generated in 47s, 1 retry needed"). For v1 nothing reads it but the CLI's final log line.

---

## 8. Writer (`writer.ts`)

### 8.1 Public surface

```ts
export class WriterPathError extends Error {
  readonly kind: 'traversal' | 'symlink' | 'absolute-outside-cwd' | 'parent-missing';
}

export async function write(absolutePath: string, manifest: RawCampaign): Promise<void>;
```

### 8.2 Path resolution and safety

```ts
import { resolve, dirname, sep } from 'node:path';
import { realpath } from 'node:fs/promises';

async function safeResolve(userPath: string): Promise<string> {
  const cwd = process.cwd();
  const resolved = resolve(cwd, userPath);

  // 1. Resolved path must be inside CWD.
  if (!resolved.startsWith(cwd + sep) && resolved !== cwd) {
    throw new WriterPathError('absolute-outside-cwd', resolved);
  }

  // 2. Parent directory must exist.
  const parent = dirname(resolved);
  let realParent: string;
  try {
    realParent = await realpath(parent);
  } catch {
    throw new WriterPathError('parent-missing', parent);
  }

  // 3. Realpath of parent must also be inside CWD
  //    (catches symlink jumping out).
  const realCwd = await realpath(cwd);
  if (!realParent.startsWith(realCwd + sep) && realParent !== realCwd) {
    throw new WriterPathError('symlink', realParent);
  }

  return resolved;
}
```

Test fixtures (§10) exercise each error class:

- `../../escape.json` → `traversal` (rejected by step 1 after resolve).
- `/etc/passwd` (POSIX) / `C:\Windows\System32\evil.json` (Windows) → `absolute-outside-cwd`.
- A symlink whose target resolves to `/tmp/elsewhere` → `symlink` (resolved parent escapes CWD).
- A path whose parent directory doesn't exist → `parent-missing`. The CLI does **not** auto-create parent directories — explicit `mkdir -p` is the user's responsibility, which keeps the surface minimal.

The full filename is **not** real-pathed (only the parent), because the destination may not yet exist. Spec: `realpath(dirname(resolved))` must stay inside `realpath(cwd)`.

### 8.3 Atomic write

```ts
async function atomicWrite(target: string, body: string): Promise<void> {
  const tmp = `${target}.tmp-${process.pid}-${counter++}`;
  let fh: FileHandle | null = null;
  try {
    fh = await fs.open(tmp, 'w', 0o644);          // explicit mode
    await fh.write(body, 0, 'utf8');
    await fh.sync();                              // flush to disk
  } finally {
    await fh?.close();
  }
  try {
    await fs.rename(tmp, target);                 // atomic on same volume
  } catch (e) {
    await fs.unlink(tmp).catch(() => {});         // best-effort cleanup
    throw e;
  }
}
```

The serialized JSON is computed with `JSON.stringify(manifest, null, 2)` for human-readability. Re-validating the output by re-parsing it is *not* done in production — that doubles latency on the happy path. The validator's correctness is the test suite's responsibility.

### 8.4 Concurrency

The CLI is single-tenant — one invocation per shell. The `pid + counter` tmp suffix is paranoid defense against unusual scenarios (the user backgrounds two simultaneous `throughline-gen` runs to the same output path). The rename collision is harmless: whichever finishes last wins.

---

## 9. CLI surface (`index.ts`)

### 9.1 Argument parser — `node:util.parseArgs`

```ts
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    out: { type: 'string', short: 'o' },
    seed: { type: 'string' },
    acts: { type: 'string' },                             // parse to number after
    'puzzles-per-act': { type: 'string' },
    'time-budget-per-puzzle': { type: 'string' },
    gentle: { type: 'boolean', default: false },
    'avoid-themes': { type: 'string' },                   // comma-separated
    'llm-timeout-ms': { type: 'string' },
    verbose: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
    version: { type: 'boolean', short: 'v', default: false },
  },
  strict: true,
  allowPositionals: false,
});
```

**Rationale: zero dependencies.** `parseArgs` is in Node ≥18 (we target ≥20). Adds no security surface and no install cost. The alternative (`yargs`, `commander`, `meow`) would add an npm dependency that touches argv parsing — exactly the surface we want to keep tiny.

**Strict mode** means unknown flags throw. Combined with `allowPositionals: false`, the user cannot pass an extra positional that might be misinterpreted as a filename.

### 9.2 Flags

| Flag | Type | Default | Notes |
|---|---|---|---|
| `--out, -o` | path | required | Output path; resolved + checked per §8.2. |
| `--seed` | string | random | If omitted, a default seed is generated from `crypto.randomBytes(8).toString('hex')`. This is *only* for seeding diversity; it's not security-sensitive. |
| `--acts` | int | 3 | 1 ≤ N ≤ 8. |
| `--puzzles-per-act` | int | 4 | 1 ≤ N ≤ 16. |
| `--time-budget-per-puzzle` | seconds | 30 | 1 ≤ N ≤ 300. |
| `--gentle` | bool | false | See §4.1 Diversity Directives. |
| `--avoid-themes` | csv | "" | Comma-separated theme names; trimmed and passed to the prompt. |
| `--llm-timeout-ms` | int | 60000 | Advanced; for Phase 11 / debugging. |
| `--verbose` | bool | false | Streams subprocess stdout/stderr to console. |
| `--help, -h` | bool | false | Prints usage; exits 0. |
| `--version, -v` | bool | false | Prints version (from `package.json`); exits 0. |

Random-seed default uses `crypto.randomBytes` from Node stdlib. This is not the engine — the engine's determinism ban is scoped to `src/engine/`; CLI seeding is fine.

### 9.3 Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Generic error (uncaught exception, programmer bug — should never happen in production) |
| 2 | LLM produced unvalidatable output after retry exhaustion |
| 3 | Solver could not find a solution for a puzzle after regen exhaustion |
| 4 | Path safety violation (refused to write outside CWD, etc.) |
| 5 | Subprocess failed to launch (claude not on PATH, EACCES, etc.) |

Phase 11 reads the exit code to decide which user-facing error modal to show.

### 9.4 `--help` content

```
throughline-gen — generate a Throughline campaign manifest via Claude

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
  --verbose                   Stream subprocess output
  --help, -h                  Show this help
  --version, -v               Show version

Exit codes:
  0  success    2  validation exhausted    3  solver exhausted
  4  path error 5  subprocess launch failed
```

---

## 10. Test strategy

### 10.1 `cli/src/__tests__/promptBuilder.test.ts`

- `buildSystemPrompt()` returns a string whose `.length < 30_000` (the safe-argv envelope).
- `buildSystemPrompt()` is byte-identical across calls (no `Date.now`, no random salt).
- `buildUserPrompt(opts)` includes every option name in the output (smoke test against silent regressions).
- `buildUserPrompt({ avoidThemes: ['a'] })` does **not** emit the `previous attempt feedback:` line.
- `buildUserPrompt({ previousAttemptFeedback: <schema> })` includes the dotted issue paths verbatim.
- `buildPuzzleRegenPrompt(M, 'p1', solverFeedback)` references puzzle id and act id.

### 10.2 `cli/src/__tests__/claudeSpawn.test.ts`

- Mocks `node:child_process.spawn` and asserts:
  - Call shape: `spawn('claude', ['--print', '--append-system-prompt', sysPrompt], { shell: false, ... })`.
  - The user prompt is written to `child.stdin` and `stdin.end()` is called.
  - **`shell: true` never appears.** (Asserts on the third argument's `shell` field.)
- Non-zero exit code throws `ClaudeSpawnError` with the right `reason`.
- Timeout fires at the configured budget and kills the child.
- Stderr is captured and truncated at 4 KB.
- `AbortSignal.abort()` propagates to the child.

### 10.3 `cli/src/__tests__/validator.test.ts`

Parameterized over `cli/test-fixtures/llm-outputs/`. Each fixture file has a sibling `.expected.json` describing the expected `ValidationResult`. The test enumerates files and asserts:

**Fixtures (the corpus from the spec, plus additions):**

| File | Expected |
|---|---|
| `good.json` | `ok: true` |
| `good-with-fence.json` | `ok: true` (strip-fence path) |
| `missing-field.json` (no `version`) | `ok: false, kind: schema` |
| `extra-field.json` (`{ extra: "x" }` at root) | `ok: false, kind: schema` |
| `oversize-text.json` (10 KB briefing) | `ok: false, kind: schema` |
| `malformed-rule-dsl.json` (`rule: "eval(1)"`) | `ok: false, kind: schema` (post-Zod DSL parse) |
| `unknown-identifier.json` (`rule: "foo < 5"`) | `ok: false, kind: schema` |
| `unsolvable.json` | `ok: true` (validator accepts; solver handles) |
| `injection-attempt-script.json` (`name: "<script>"`)| `ok: true` (rendering layer escapes; validator just checks length) |
| `injection-attempt-html.json` (`briefing: "&lt;img"`) | `ok: true` (likewise) |
| `prose-prefix.json` (`"Sure! Here is your JSON: {...}"`) | `ok: false, kind: json-syntax` |
| `trailing-prose.json` (`{...}\n\nNote: ...`) | `ok: false, kind: json-syntax` |
| `wrong-version.json` (`version: 2`) | `ok: false, kind: schema` |
| `reactor-no-recipe.json` | `ok: false, kind: schema` (post-Zod config check) |
| `filter-no-types.json` | `ok: false, kind: schema` |
| `negative-cycle.json` (`max_cycles: -1`) | `ok: false, kind: schema` |
| `zero-rate.json` (`rate: 0`) | `ok: false, kind: schema` |

Adding a new fixture is a one-file change; the test enumerator picks it up automatically. This makes adding regression fixtures (when a bug is found in the wild) trivial.

### 10.4 `cli/src/__tests__/solver.test.ts`

- `solve(handBuiltSolvablePuzzle, { seed: 's1' })` returns `solvable` within 30 s.
- `solve(handBuiltUnsolvablePuzzle, { seed: 's1', timeBudgetMs: 2000 })` returns `unsolvable` within 2.5 s. (Reviewer check: budget honored.)
- `solve(p, { seed: 's1' })` twice produces identical `solution`, identical `attempts` (determinism).
- `solve(p, { seed: 's1' })` and `solve(p, { seed: 's2' })` produce different `solution`s (PRNG actually drives variation).
- PRNG unit tests: same seed → same output sequence; different seeds → different sequences; output distribution is approximately uniform across [0, 1) for 10 000 draws.
- Connectivity bias: 80% of generated tile placements have at least one conveyor adjacent to an input (smoke test against the bias actually doing something).

### 10.5 `cli/src/__tests__/generator.test.ts`

`claudeSpawn` and `solver.solve` injected as mocks. Tests:

- **Happy path:** one canned good manifest, all puzzles "solvable" → emits the manifest; one LLM call.
- **Validate retry:** first response is malformed JSON; second is good → emits; two calls; retry feedback in second prompt.
- **Schema retry:** first response is `extra-field.json`; second is good → emits; two calls.
- **Manifest-level unsolvable → full retry:** first response valid but one puzzle unsolvable; second response all solvable → emits; two calls.
- **Per-puzzle regen success:** three manifest attempts all have the same unsolvable puzzle; first regen succeeds → emits with the regen-spliced puzzle; 4 total calls.
- **Per-puzzle regen exhaustion:** three manifest attempts all unsolvable on puzzle P; three regen attempts also unsolvable → fails with exit code 3; 6 total calls.
- **Manifest validation exhaustion:** three consecutive schema failures → fails with exit code 2; three calls.
- **Retry cap is hard:** inject 50 consecutive failures into the mock → assert exactly 3 are observed before exit (no infinite loops).
- **Backoff is timed:** spy on `setTimeout`; assert the call between attempts uses `500 + jitter` for attempt 0 and `1000 + jitter` for attempt 1.
- **Backoff is seeded:** two generator runs with the same seed produce the same jitter sequence.

### 10.6 `cli/src/__tests__/writer.test.ts`

- Atomic write: monkey-patch `fs.rename` to throw after `fs.writeFile` succeeds → tmp file is unlinked; target unchanged.
- Path safety, parameterized:
  - `../escape.json` → `WriterPathError(kind: 'traversal')`. (POSIX and Windows both.)
  - `/etc/passwd` → `WriterPathError(kind: 'absolute-outside-cwd')` on POSIX.
  - `C:\Windows\evil.json` → same on Windows.
  - A symlink at `<cwd>/link` pointing to `/tmp` and target `link/evil.json` → `WriterPathError(kind: 'symlink')`. Skipped on Windows where symlink creation is admin-only; documented.
  - `<cwd>/missing-dir/out.json` (parent doesn't exist) → `WriterPathError(kind: 'parent-missing')`.
- Round-trip: write a known manifest; read back; `JSON.parse` and re-validate via the shared schema → byte-identical.

### 10.7 `cli/integration/live-claude.test.ts` (gated)

Skipped by default. Runs when `RUN_LIVE_LLM=1`. Calls the *real* `claude -p` with the standard system prompt, asks for a 1-act 2-puzzle manifest, runs the solver on the output. Asserts:

- Validation passes.
- All puzzles solvable within 30 s each.
- The output is byte-stable across runs **with a fixed seed** (this may be too strict — Claude is not perfectly deterministic; the assertion is `validation passes AND solver passes`, not byte equality).

**CI policy (resolved Q5):** never runs in CI. The test lives under `cli/integration/` and is gated behind `RUN_LIVE_LLM=1`. A developer runs `RUN_LIVE_LLM=1 npm test` locally before tagging a release; the burden is on the human to remember (documented in the release checklist). Rationale: live-LLM tests cost money and add PR-time flakiness from rate limits; the value of nightly cadence is unclear when the prompt and schema are checked-in source that doesn't drift on its own.

### 10.8 Static analysis tests (lives next to source)

- `cli/src/__tests__/no-shell.test.ts`: reads every `.ts` file under `cli/src/` and `node:fs.readFile`-greps for `\bshell:\s*true\b`, `\bexec\s*\(`, `\bexecSync\b`. Expected matches: 0. **Reviewer verifies by adding `exec(...)` in a scratch branch and confirming the test fails.**
- `cli/src/__tests__/no-eval.test.ts`: same idea, `\beval\s*\(`, `\bnew\s+Function\b`, `\bFunction\s*\(`. (The DSL parser already has its own no-eval test under `src/dsl/__tests__/`; this is the CLI surface check.)
- `cli/src/__tests__/system-prompt-shape.test.ts`: reads `cli/src/prompts/system.md` and asserts it contains the section headings we documented in §4.1 (`## Schema reference`, `## Glyph catalog`, etc.). Catches the "split into many string literals at runtime" anti-pattern.

These three tests collectively encode §11's reviewer checklist. The reviewer's job is to verify the tests catch what they claim to catch, not to redo the checks manually.

---

## 11. File layout

```
cli/
├── package.json                    # SEE §11.2 — share root or split?
├── tsconfig.json                   # extends root; outDir: ../dist-cli
├── bin/
│   └── throughline-gen             # Node shebang wrapper to dist-cli/index.js
├── src/
│   ├── index.ts                    # arg parsing; top-level orchestration
│   ├── promptBuilder.ts
│   ├── claudeSpawn.ts
│   ├── validator.ts
│   ├── solver/
│   │   ├── index.ts                # solve(puzzle, opts)
│   │   ├── prng.ts                 # splitmix64 + fnv1a
│   │   └── candidate.ts            # generateRandomSolution
│   ├── generator.ts
│   ├── writer.ts
│   ├── prompts/
│   │   └── system.md               # checked-in markdown system prompt
│   ├── scripts/
│   │   └── build-prompt.ts         # regenerates system.md sections from
│   │                               # schema/families.json/dsl grammar
│   └── __tests__/
│       ├── promptBuilder.test.ts
│       ├── claudeSpawn.test.ts
│       ├── validator.test.ts
│       ├── solver.test.ts
│       ├── generator.test.ts
│       ├── writer.test.ts
│       ├── no-shell.test.ts
│       ├── no-eval.test.ts
│       └── system-prompt-shape.test.ts
├── test-fixtures/
│   └── llm-outputs/
│       ├── good.json
│       ├── good-with-fence.json
│       ├── missing-field.json
│       └── … (per §10.3 table)
└── integration/
    └── live-claude.test.ts         # gated by RUN_LIVE_LLM=1
```

### 11.1 Imports across the boundary

The CLI imports from the existing source tree:

- `src/schema/campaign.ts` → `parseCampaign`, `RawCampaign`, `CampaignParseError`. **Unchanged.**
- `src/engine/index.ts` → `runUntilHalt`, `Puzzle`, `Solution`, types. **Unchanged.**
- `src/campaign/load.ts` → `toEnginePuzzle`. **Unchanged.**
- `src/render/glyphs/families.json` → read by `build-prompt.ts` to render the glyph catalog section into `system.md`.

The CLI never imports DOM, Canvas, Tone.js, Tauri, Vite, or anything browser-only. (Linted by checking import graph; tested by `vitest run` succeeding under `node` environment without jsdom.)

### 11.2 `package.json` — share root, or split?

**Decision: share root.** Rationale:

- Schema imports (`src/schema/campaign.ts`) and engine imports (`src/engine/index.ts`) need to be cross-package-friendly. With a separate package we'd either need `npm link`, a monorepo tool (`pnpm workspaces`), or duplicated source — all add tooling cost for zero benefit.
- The root `package.json` already has Zod as a runtime dep. The CLI's only additional production dep would be — nothing, actually. All needs are met by Node stdlib + Zod.
- `node:util.parseArgs`, `node:child_process`, `node:fs/promises`, `node:path` are all stdlib.
- The `bin` field in root's `package.json` exposes the binary:

  ```json
  "bin": { "throughline-gen": "./bin/throughline-gen" }
  ```

- `npm run build:cli` runs `tsc -p cli/tsconfig.json` producing `dist-cli/`; the bin wrapper does `import('./dist-cli/index.js')`.

The downside is that `npm install` for the *game* now installs a CLI's runtime deps too. Since both share Zod and Node stdlib, the actual install bloat is zero. Reconsider if the CLI ever needs a large dep (e.g. a real solver library).

### 11.3 Build target

A new tsconfig file `cli/tsconfig.json`:

```jsonc
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "outDir": "../dist-cli",
    "rootDir": ".."
  },
  "include": ["src/**/*", "../src/schema/**/*", "../src/engine/**/*", "../src/dsl/**/*", "../src/campaign/load.ts"]
}
```

The root `tsconfig.json` produces the browser build (via Vite, type-check only). The CLI tsconfig produces an actual emitted JS tree under `dist-cli/`. They don't compete — Vite ignores `dist-cli` and the CLI ignores `dist`.

---

## 12. Security checklist as code

Every item from the reviewer's checklist translates to one or more tests already enumerated in §10. The grid below is the cross-reference the reviewer will check against:

| Reviewer item (verbatim, paraphrased headings) | Verified by |
|---|---|
| "subprocess handling has no shell-injection surface (prompt content must never reach a shell unquoted)" | `cli/src/__tests__/claudeSpawn.test.ts` (asserts `spawn` is called with `shell: false`); `cli/src/__tests__/no-shell.test.ts` (greps source for `shell: true`, `exec(`, `execSync(`) |
| "Zod schemas reject every malformed example, not just accept valid ones" | `cli/src/__tests__/validator.test.ts` parameterized over `test-fixtures/llm-outputs/`; every malformed fixture has an expected `ok: false` |
| "retry loop has bounded backoff and a hard attempt cap" | `cli/src/__tests__/generator.test.ts` retry-cap tests (3 schema fails → exit 2; 3 regen fails → exit 3); backoff-spied tests |
| "solvability check has a hard time budget per puzzle" | `cli/src/__tests__/solver.test.ts` unsolvable-within-budget test; `cli/src/__tests__/generator.test.ts` propagates the option correctly |
| "generated narrative text is treated as untrusted — HTML-escaped before rendering, never inserted as innerHTML" | Phase 7 + Phase 8 owned this contract; the CLI has nothing to do here beyond validating that text *length* fits the schema. Cross-check: `cli/src/__tests__/validator.test.ts` accepts `<script>` in narrative fields and lets them flow to the writer (game-side rendering is the defense) |
| "the manifest file's path is validated (no traversal)" | `cli/src/__tests__/writer.test.ts` path-safety parameterized fixtures |
| "Every schema in `src/schema/campaign.ts` uses `.strict()` and every string field has a `.max(...)`" | Property-based schema test (new): `cli/src/__tests__/schema-shape.test.ts` introspects the Zod schema tree and asserts every `ZodObject` has the strict flag and every `ZodString` has a max. **Falsifiable** — failed if anyone adds an open object or unbounded string. |
| "System prompt is checked-in source ... not concatenated from many small strings — easier to audit" | `cli/src/__tests__/system-prompt-shape.test.ts` (asserts `system.md` has expected sections and length); a separate grep test asserts `promptBuilder.ts` does **not** contain large multi-line template strings (heuristic: no string literal > 500 chars) |
| "No `eval`, `Function()`, `new Function` anywhere in CLI source" | `cli/src/__tests__/no-eval.test.ts` |

The `schema-shape.test.ts` mentioned above is new in this phase. It introspects the Zod `_def` tree of the exported schemas:

```ts
function assertEverywhere(schema: z.ZodTypeAny): void {
  if (schema._def.typeName === 'ZodObject') {
    if (schema._def.unknownKeys !== 'strict') {
      throw new Error(`non-strict object at ${path()}`);
    }
    for (const [k, v] of Object.entries(schema._def.shape())) {
      assertEverywhere(v);
    }
  }
  if (schema._def.typeName === 'ZodString') {
    const hasMax = (schema._def.checks ?? []).some((c) => c.kind === 'max');
    if (!hasMax) throw new Error(`unbounded string at ${path()}`);
  }
  // … and so on for arrays, optionals, records, etc.
}
```

Approximate, but enforces "no open object, no unbounded string" mechanically rather than via manual review.

---

## 13. Open questions / decisions made

These are calls where the spec is silent or admits multiple reasonable answers. **Recommended answers in bold;** flag for human review only if you disagree.

**Q1. Per-puzzle splice strategy: index vs id.**
When the LLM emits a full M′ during per-puzzle regen, which puzzle from M′ replaces the failing puzzle in M?
- **(a) Index-based: `M[a].puzzles[p]` ← `M′[a].puzzles[p]`.** Recommended. Robust to the LLM duplicating an id across the manifest.
- (b) Id-based match: find a puzzle in M′ whose id matches the failing puzzle's id. Brittle if the LLM "fixes" by renaming.

**Q2. Validate the spliced manifest entirely vs just the new puzzle?**
- **(a) Validate the full spliced M.** Recommended. Cheap; defends against the LLM altering an unrelated field on the side.
- (b) Validate only the new puzzle. Faster; trusts the LLM more than necessary.

**Q3. Does `--gentle` propagate as a hint in the system prompt or only the user prompt?**
- **(a) User prompt only.** Recommended. Keeps the system prompt invariant across runs; system-prompt-shape tests stay stable.
- (b) Toggle a system-prompt section. More structural but blurs the "system = stable, user = variable" line.

**Q4. Where do the build scripts for the system prompt run?**
The `cli/src/scripts/build-prompt.ts` regenerates the schema-reference and glyph-catalog sections from source. Options:
- **(a) Run on demand by a developer; commit the result.** Recommended. The generated prompt is checked-in and reviewable.
- (b) Run as a prebuild step every CLI build. Output never committed; harder to audit.

**Q5. Live LLM integration test runs how often?**
- **(a) Nightly only.** Recommended. Cheap (≈$0.05 per run); a single non-stale check that the real `claude -p` works.
- (b) On every PR. Costs money; flakes on rate limits.

**Q6. Solver progress metric: trace-based or final-world-only?**
- **(a) Final-world-only `deliveredCounts`.** Recommended for v1 — no engine change required; matches the §6.9 memory-pressure note.
- (b) Trace-based "longest streak of progress." Better LLM feedback but requires the engine's `traceCollect: false` option (a small Phase 1 engine addition).

**Q7. What seed does the solver default to?**
- **(a) Hash of `puzzle.id`.** Recommended. Determinism per-puzzle; running the solver on the same puzzle twice gives the same result.
- (b) The campaign's top-level `seed`. Couples solver determinism to the manifest seed; less helpful for debugging a single puzzle.

**Q8. `--gentle` mechanics: which dimensions to bias?**
- **(a) Lower tile counts, higher cycle budgets, single-agent puzzles only.** Recommended.
- (b) Also force `available_tiles` to a curated easy set (conveyor + splitter + merger only). More aggressive; might break difficulty progression across acts.

**Q9. Should the CLI ever print to stdout in normal mode?**
- **(a) Only the absolute final-output path on success.** Recommended. Quiet mode for scripting. Phase 11's UI parses stdout for the path.
- (b) Verbose log of every step. Use `--verbose` instead.

**Q10. Are CLI tests run by `npm test`, or a separate `npm test:cli`?**
- **(a) Run by `npm test:unit` automatically.** Recommended. Vitest's project mode handles this — `vitest.config.ts` already includes everything; no opt-in friction.
- (b) Separate script. More ceremony for no benefit.

**Resolved by human review:**

- **Q5 (live LLM cadence) — RESOLVED: manual only.** The live-LLM test never runs automatically. It lives under `cli/integration/` gated behind `RUN_LIVE_LLM=1`; a developer runs it locally before tagging a release. Documented in §10.7.
- **Q6 (engine change for trace-free runUntilHalt) — RESOLVED: keep engine unchanged.** Phase 10 doesn't touch Phase 1 code. Solver uses the final-world `deliveredCounts` progress metric (§6.10). Per-attempt trace memory is allocated and discarded; OOM risk is acceptable for typical puzzle sizes.

---

## 14. What this phase does NOT do

Out of scope for Phase 10 (each goes elsewhere):

- Tauri integration of the CLI. Phase 11 calls `bin/throughline-gen` as a subprocess from Rust; the CLI itself doesn't know it's being run from Tauri.
- Game-side rendering of LLM-emitted text. Phase 7's loader and Phase 8's theme applier own the "treat narrative as untrusted" contract; the CLI's only responsibility is *length-validating* via Zod.
- Live preview of generated campaigns. Phase 11.
- Sharing or publishing generated campaigns. Out of scope per design doc §12.
- An "edit and regenerate" workflow. v1 is one-shot generation; if you don't like the output, run the CLI again with a different seed.
- Caching system prompts on the Anthropic side. Out of scope; `claude -p` handles its own cache.

---

## 15. Definition of done for Phase 10

Coder advances only when:

1. All tests in §10 pass (`npm run test:unit -- cli` is green).
2. Static-grep tests under §10.8 pass.
3. The schema-shape introspection test passes (no open objects, no unbounded strings).
4. The reviewer's checklist (verbatim from IMPLEMENTATION_PLAN.md § Phase 10 Reviewer) is signed off in `docs/reviews/phase-10.md` — every item cross-references to a test, not to manual inspection.
5. A live-LLM run with `RUN_LIVE_LLM=1` succeeds at least once. The output manifest is loadable by the game (Phase 7's loader accepts it).
6. The end-to-end manual check: generate 5 campaigns, eyeball coherence + theme diversity, file findings in `docs/playtest/cli-generation-pass.md`.

---

### Critical Files for Implementation

- `C:\projects\Throughline\cli\src\claudeSpawn.ts`
- `C:\projects\Throughline\cli\src\generator.ts`
- `C:\projects\Throughline\cli\src\solver\index.ts`
- `C:\projects\Throughline\cli\src\writer.ts`
- `C:\projects\Throughline\cli\src\prompts\system.md`

---