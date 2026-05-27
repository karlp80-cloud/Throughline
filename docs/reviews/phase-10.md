# Phase 10 Review

## Verdict
**PASS-WITH-NOTES**

Phase 10 substantially meets the security checklist and the architect's contract. All security canaries function correctly and demonstrably catch the regressions they claim to. The subprocess wrapper, validator, solver budget enforcement, and writer path safety all pass careful examination. Issues found are minor — primarily test coverage gaps (SIGKILL escalation), dead code in error enums, and one redundant code path in `promptBuilder`. The single noteworthy invariant deviation (`innerHTML` in `src/editor/dom/opList.ts`) does not touch LLM-emitted text but contradicts the spirit of CLAUDE.md invariant #6 and should be discussed.

The Coder's flagged build-pipeline deviation (esbuild bundling) is **acceptable**.

---

## Checklist

### Verbatim from IMPLEMENTATION_PLAN.md § Phase 10 Reviewer

#### No `shell: true`, no `exec(`, no `execSync(` anywhere in CLI

**PASS.**

- Production source `cli/src/claudeSpawn.ts:74-78` invokes `spawn('claude', [...], { shell: false, ... })`.
- The canary test at `cli/src/__tests__/no-shell.test.ts:14-21` greps every non-test `.ts` file under `cli/src/` for three forbidden patterns:
  - `/\bshell\s*:\s*true\b/`
  - `/\bexec\s*\(/`
  - `/\bexecSync\s*\(/`
- The walker (lines 23-38) skips `__tests__` directories, `.test.ts`, and `.d.ts` files. Skips comments (`//`, `*`) inside files. Verified canary executes against 9 source files and reports 0 offenders.

**Mental falsification**: Adding `exec('rm -rf /');` to `cli/src/claudeSpawn.ts` would match `/\bexec\s*\(/`, not be a comment, and produce an offender record at the matching line, failing the test. Confirmed.

#### Every Zod schema uses `.strict()` and every string has `.max(...)`

**PASS.**

- `src/schema/campaign.ts` has `.strict()` on every `z.object(...)` (lines 30, 41, 55, 72, 80, 88, 110, 122, 137, 148, 161, 163).
- Every `z.string()` invocation has either `.max(...)` or `.regex(...)`. Confirmed across all string fields.
- The introspection test at `cli/src/__tests__/schema-shape.test.ts:22-80` walks the Zod `_def` tree:
  - **ZodObject** → asserts `def.unknownKeys === 'strict'`.
  - **ZodString** → asserts `checks` contains at least one `kind === 'max'` OR `kind === 'regex'`.
  - **ZodArray** → recurses into `def.type`.
  - **ZodOptional/Nullable/Readonly** → recurses into `def.innerType`.
  - **ZodEffects/Branded** → recurses into `def.schema ?? def.type`.
  - **ZodRecord** → recurses into both `keyType` and `valueType`.
  - **ZodTuple** → iterates items.
  - **ZodUnion/DiscriminatedUnion** → iterates options.
- Cross-check: `extra-field.json` fixture (root-level `"extra": "x"`) is rejected by the validator. Schema strict-mode works end-to-end.

#### Retry loop is bounded

**PASS.**

- `cli/src/generator.ts:33-34` declares `MANIFEST_RETRY_CAP = 3` and `PER_PUZZLE_REGEN_CAP = 3` as module-level constants.
- Manifest loop: `for (let attempt = 0; attempt < MANIFEST_RETRY_CAP; attempt++)` at line 197.
- Per-puzzle regen loop: `for (let r = 0; r < PER_PUZZLE_REGEN_CAP; r++)` at line 259.
- `cli/src/__tests__/generator.test.ts:235-256` injects 50 consecutive failures via `mockSpawn`; asserts `spawn.mock.calls.length === 3` on exhaustion. Test name: "50 consecutive failures observed → at most 3 manifest attempts".
- Per-puzzle exhaustion test at lines 201-231 asserts `GeneratorExhaustedError(category=solver)` is thrown after 3+3 = 6 calls.
- Architect's worst-case ceiling `3 + 3 × max_puzzles ≤ 3 + 3 × 128 = 387` is structurally enforced by the loop caps.

#### Solver time budget is honored

**PASS** (with one minor concern in Recommendations).

- `cli/src/solver/index.ts:89` checks `Date.now() - start >= budget` inside the `while` loop, after each `runUntilHalt` attempt.
- Budget check is *between* attempts, not *during* a single `runUntilHalt`. Since `runUntilHalt` is bounded by `puzzle.constraints.maxCycles` (schema max 10000), a single iteration is bounded. Worst-case overshoot is the wall-time of one full `runUntilHalt`.
- `cli/src/solver/__tests__/solver.test.ts:56-69` asserts unsolvable termination within `budget + 500ms` — *tighter* than the architect's "+1s" requirement.
- Hard attempt-cap safety net (`HARD_ATTEMPT_CAP = 100_000`) at line 41 / 70.

#### Game-side rendering of `campaign.json` narrative fields uses `textContent` everywhere, never `innerHTML`

**FLAG.**

- Grep of `src/` for `innerHTML` finds three hits:
  - `src/completion/dom/resultsPanel.ts:10` — comment line documenting the contract. Not a real use.
  - `src/campaign/dom/harness.ts:7` — comment line documenting the contract. Not a real use.
  - `src/editor/dom/opList.ts:81` — **actual assignment** `hint.innerHTML = [...].join('<br>')`.
- Read of `src/editor/dom/opList.ts:79-91`: the content is hardcoded developer-authored help text. It does NOT interpolate any data from `campaign.json`, the puzzle, the theme, or any LLM-emitted source. Static string literal joined with `<br>`.
- **Verdict**: Not a vulnerability — no untrusted data flows into this assignment. But CLAUDE.md invariant #6 states "narrative text always rendered via `textContent`, never `innerHTML`". The spirit of the rule (banning `innerHTML` outright as a defense-in-depth measure) is contradicted here.
- The static help text could trivially be rewritten using `createElement` + `textContent` per line, restoring the invariant without losing functionality.

#### Writer rejects every traversal case

**PASS** (with one nomenclature note).

- `cli/src/writer.ts:48-78` (`safeResolve`) enforces three policies:
  1. **Resolved path inside CWD** (line 56) — catches `../` and absolute outside CWD.
  2. **Parent directory exists** (line 64) — catches missing parents.
  3. **Parent's realpath inside CWD's realpath** (line 73) — catches symlink escapes.
- `cli/src/__tests__/writer.test.ts:101-148` covers each error class with parameterized fixtures; symlink test `test.skipIf(isWindows)` because symlink creation requires admin.
- The implementation uses `realpath(dirname(resolved))` not `realpath(resolved)` — correct since the destination file may not exist yet.
- **Nomenclature note**: `WriterPathErrorKind` includes a `'traversal'` member that is never thrown. The implementation lumps `../` together with `absolute-outside-cwd`. Dead code; not a security issue.

#### System prompt is checked-in source

**PASS.**

- `cli/src/prompts/system.md` exists as a single checked-in markdown file (15485 bytes).
- All 10 sections from architect §4.1 present: `## Your role`, `## Output format`, `## Schema reference`, `## Mechanics summary`, `## Glyph catalog`, `## Rule DSL grammar`, `## Diversity directives`, `## Worked examples`, `## Solvability hints`, `## Anti-instructions`.
- `cli/src/promptBuilder.ts` (6430 bytes) loads it via `readFileSync` and caches; no inline concatenation. Three resolution candidate paths (one redundant — see Recommendations).
- `system-prompt-shape.test.ts` asserts: every required section heading present; `1024 < length < 30_000`; at least 3 worked examples; `promptBuilder.ts` has no line over 500 chars; `promptBuilder.ts` source file is under 8192 bytes.

### Architect's additional reviewer responsibilities

#### `claudeSpawn.ts` test coverage matches the contract

**PASS-WITH-NOTES.**

Verified at `cli/src/__tests__/claudeSpawn.test.ts`:
- **Argv shape**: `expect(argv).toEqual(['--print', '--append-system-prompt', 'SYS'])`. ✓
- **`shell: false`**: explicitly tested with both `expect(opts.shell).toBe(false)` and `expect(opts.shell === false).toBe(true)`. ✓
- **`windowsHide: true`**: asserted. ✓
- **stdin write + end**: verified. ✓
- **Non-zero exit**: error class and reason verified. ✓
- **Timeout fires**: SIGTERM verified, reason verified. ✓
- **Spawn failure**: ENOENT scenario, reason verified. ✓
- **Stderr 4KB cap**: 10000-byte stderr → result.stderr ≤ 4160 bytes, contains "truncated" marker. ✓
- **AbortSignal propagation**: `ac.abort()` → child killed. ✓

**Gap (one missing test, FLAG)**: The architect's contract specifies "SIGTERM → SIGKILL grace" after 2s. The implementation at `cli/src/claudeSpawn.ts:139-141` does set up the SIGKILL escalation timer, but the test only verifies SIGTERM is sent. No test advances time past the grace period to confirm SIGKILL is actually issued. A regression that broke the SIGKILL escalation would not be caught.

#### Solver determinism

**PASS.**

Tests at `cli/src/solver/__tests__/solver.test.ts:71-105` cover same-seed determinism, different-seed variation, and default-seed reproducibility.

#### No `Math.random` in `cli/src/`

**PASS.** Zero hits.

#### No `eval`, `new Function`, `Function(` in `cli/src/`

**PASS.** `no-eval.test.ts` checks five patterns with a lookbehind that correctly excludes `: Function` type annotations.

#### Validator never throws

**FLAG (minor architectural deviation).**

- `cli/src/validator.ts:41-84` exposes `validate(rawStdout): ValidationResult` which returns a discriminated union.
- **However**: line 82 contains a `throw e;` inside the catch block, executed if `parseCampaign` throws something that is NOT a `CampaignParseError`.
- Audit of `parseCampaign` shows it only throws `CampaignParseError`. So the `throw e;` path is unreachable in practice.
- Architect doc §5.5 commits: "The validator never throws. All failures are returned as structured `ValidationResult` values."
- **Verdict**: defensive code that violates the documented contract on paper but is unreachable in practice. Worth changing to wrap-and-return rather than re-throw, to align with the architectural commitment.

#### Atomic write actually atomic

**PASS.**

- Same-volume tmp + fsync + rename + unlink-on-failure all confirmed.
- Rollback test forces a real OS-level rename failure (directory destination); confirms no `.tmp-*` files remain. **Stronger than monkey-patching** in that it tests the real failure path.

#### `shell: false` is asserted in `claudeSpawn.test.ts`

**PASS.** Both `expect(opts.shell).toBe(false)` and `expect(opts.shell === false).toBe(true)` — catches `shell: undefined` regressions.

---

## Build-pipeline deviation

### Coder's flagged deviation: esbuild bundling instead of tsc emit

The CLI is built by `cli/build.mjs` rather than plain `tsc`. The script:
1. Runs `tsc --noEmit` for type-checking.
2. Bundles `cli/src/index.ts` to `dist-cli/throughline-gen.mjs` via esbuild.
3. Copies `cli/src/prompts/system.md` to `dist-cli/prompts/system.md`.

#### Analysis

**esbuild is a non-optional transitive dep.** `npm ls esbuild` shows `vite@5.4.21 → esbuild@0.21.5`. Removing esbuild would require removing Vite. **Zero net dependency cost.**

**Bundle output matches the bin wrapper.** `bin/throughline-gen` does `import('../dist-cli/throughline-gen.mjs')`; the build script emits to that exact path.

**Reproducibility (qualitative).** esbuild and tsc are deterministic given identical input source. No timestamp injection. High confidence the build is reproducible; not empirically verified.

**Security implications**: None. `--external:node:*` externalizes Node built-ins. No third-party JS deps in production except Zod (already part of the project). The bundle output is reviewable: a single 185 KB JS file, no minification, no source-map injection.

**Path-resolution robustness.** The `promptBuilder.ts:35-42` `CANDIDATE_PATHS` array has three paths; two are byte-identical (redundant). After build, `__dirname` resolves to `dist-cli/`. In dev/tests, `__dirname` resolves to `cli/src/`.

**`prompts/system.md` copy step verified present.**

#### Verdict on the deviation

**Acceptable**, with one nit: the duplicate `CANDIDATE_PATHS` entry should be cleaned up. The bundling approach is well-motivated, security-neutral, and the system.md copy is correctly handled.

---

## Issues found

Sorted by severity. None are merge-blockers.

### Severity: Low

**L1.** `src/editor/dom/opList.ts:81` uses `.innerHTML =` for static developer-authored help text. The content is hardcoded — no LLM/manifest data flows in — so this is not a security vulnerability. However, CLAUDE.md invariant #6 ("LLM output is untrusted ... never `innerHTML`") is treated as project-wide. Recommend rewriting as `createElement` + `textContent` per row.

**L2.** `cli/src/validator.ts:82` re-throws unrecognized exceptions, violating the architectural commitment "validator never throws" (cli.md §5.5). In practice the path is unreachable because `parseCampaign` only throws `CampaignParseError`. Recommend wrapping into a `kind: 'json-syntax'` failure with a "unexpected error" message, fully honoring the never-throw contract.

**L3.** No test verifies the SIGTERM → SIGKILL grace-period escalation. The implementation at `cli/src/claudeSpawn.ts:139-141` schedules SIGKILL 2s after SIGTERM, but a regression that removed this block would not be caught by the test suite. Recommend adding a fake-timer test that advances past `KILL_GRACE_MS` and asserts `child.killSignals` contains `'SIGKILL'`.

### Severity: Trivial

**T1.** `cli/src/promptBuilder.ts:35-42`: `CANDIDATE_PATHS[0]` and `CANDIDATE_PATHS[1]` are byte-identical. One can be deleted.

**T2.** `cli/src/writer.ts:24-28`: `WriterPathErrorKind` includes a `'traversal'` member that the implementation never throws. Dead code; remove or wire through.

**T3.** `cli/src/generator.ts:251-314`: the per-puzzle regen outer `while` loop has no explicit global iteration cap; only a per-puzzle regen cap (3). If the splice repeatedly destabilizes other puzzles, the loop could iterate `actCount × puzzlesPerAct` times. Still bounded by the architect's "3 + 3 × max_puzzles" ceiling but not explicitly tested for the full worst case.

---

## Recommendations before merge

1. **Add a SIGKILL escalation test** to `cli/src/__tests__/claudeSpawn.test.ts`. Use fake timers; advance past `KILL_GRACE_MS + timeoutMs`; assert `child.killSignals` includes both `'SIGTERM'` and `'SIGKILL'`.
2. **Rewrite `src/editor/dom/opList.ts:79-91`** to use `createElement('strong')` + `textContent` per row.
3. **Wrap the validator's stray `throw e;` (line 82)** into a returned `ValidationFailure`.
4. **Delete the duplicate `CANDIDATE_PATHS` entry** at `cli/src/promptBuilder.ts:39` and the unused `'traversal'` from `WriterPathErrorKind`.
5. (Optional) **Add a generator test** that injects multiple distinct unsolvable puzzles to exercise the outer regen loop bound.

None of the above is required to merge. They tighten an already-solid implementation.

---

## What I did NOT check

- **Did not run the live-LLM integration test** (`RUN_LIVE_LLM=1`). Per the review instructions I did not invoke it. A live smoke run is required before tagging release per CLAUDE.md.
- **Did not run the full e2e suite** (Playwright).
- **Did not rebuild the CLI bundle** to verify byte-reproducible output.
- **Did not verify TypeScript strict-mode soundness** of every file.
- **Did not audit the worked examples in `system.md`** for correctness against the schema.
- **Did not exhaustively review `cli/src/solver/candidate.ts`** — confirmed it uses only the PRNG; did not audit the search-space coverage claims.
- **Did not check whether `cli/build.mjs`** is subject to the canary tests. (It is not — canaries scope to `cli/src/`.)

---

## Summary

Phase 10 is **PASS-WITH-NOTES**. Every reviewer-checklist item is verified either directly or via a working static-analysis canary. The four canaries (`no-shell`, `no-eval`, `schema-shape`, `system-prompt-shape`) all run green and would catch the regressions they claim to catch. Subprocess safety, schema strictness, retry caps, solver budget, atomic write, and path safety all hold. The single architectural ambiguity worth a discussion is `src/editor/dom/opList.ts:81` using `innerHTML` for static developer help text — not exploitable, but contradicts the spirit of CLAUDE.md invariant #6. Three trivial gaps (no SIGKILL escalation test, an unreachable `throw e;` in the validator, dead `'traversal'` enum member) are all simple fixes. The esbuild build pipeline is a justified deviation; esbuild is already a transitive dep via Vite. Ready to merge after the live-LLM smoke run.
