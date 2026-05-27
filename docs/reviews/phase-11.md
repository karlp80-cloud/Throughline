# Phase 11 Review

## Verdict
**PASS-WITH-NOTES**

Phase 11 lands cleanly. The two new load-bearing invariants (#8 Rust no-shell, #9 dynamic-Tauri-import) each have a working static-analysis canary; the failure-mode matrix from architect §5.1 is covered end-to-end; the spinner is always cancellable; stderr is sanitized in Rust and re-rendered via `textContent`; the browser fallback is wired and tested. Three minor follow-ups were identified; all three were addressed before merge (see "Issues found" + the post-review commit). Tauri 2.x `bundle.resources` wildcard validity is deferred to Phase 12's packaging step per the Coder's own flag.

## Checklist (the 5 verbatim items)

### 1. Each documented failure mode has an automated test that exercises the user-visible path. **PASS-WITH-NOTES**

Mapping of the architect §5.1 matrix to test files:

| Error kind | Unit test proof | E2E test proof |
|---|---|---|
| `BinaryNotFound` | `src/campaign/dom/errorModal.test.ts:48–55` ("binary-not-found: copy mentions Node.js; only Close button") | — (covered by errorModal copy assertion) |
| `SpawnFailed` | `src/campaign/dom/errorModal.ts:58–64` produces copy; no dedicated unit test of the class, but errorModal `spec()` covered by line-coverage from cli-exit/timeout tests | — |
| `Timeout` | `src/campaign/dom/errorModal.test.ts:57–65` (timeout: Retry button present); `src/campaign/dom/newCampaignModal.test.ts:184–201` (safety-timer fires → `safety-timeout`) | — (intentionally deferred to unit per e2e docstring) |
| `Cancelled` | `errorModal.test.ts:93–98` (cancelled — close only); `newCampaignModal.test.ts:159–182` (Cancel during generating); | `procgen.spec.ts:256–274` (Cancel mid-flight) |
| `CliExit` exit=1 | `flow.test.ts:115–132` (cli-exit modal renders); `errorModal.test.ts:100–116` (stderr render path) | `procgen.spec.ts:209–231` (CLI exit 1 → Retry button + stderr text) |
| `CliExit` exit=2 | `errorModal.test.ts:67–74` ("fresh seed" reroll-retry) | — |
| `CliExit` exit=3 | Covered by the same `cli-exit` switch in `errorModal.ts:86–92`; no dedicated test but copy is symmetric to exit=2 | — |
| `CliExit` exit=4 | `errorModal.ts:93–98` (close-only); no dedicated unit test | — |
| `CliExit` exit=5 | `errorModal.test.ts:76–82` (claude not found, no automatic retry → close only) | — |
| `StdoutNotJson` (TS-side schema route) | `browserFallback.test.ts:133–142` (JSON syntax error); `flow.ts:97–103` maps `SyntaxError` → 'stdout-not-json' | — |
| Schema-fail (`parseCampaign` throws) | `errorModal.test.ts:84–91`; `newCampaign.test.ts:133–137` (CampaignParseError); `browserFallback.test.ts:144–154` | `procgen.spec.ts:233–254` (garbage manifest → schema-fail modal); `procgen.spec.ts:315–330` (browser bad file) |
| `FileReadFailed` | `errorModal.ts:126–131` produces copy; no dedicated unit test | — |
| `PathRejected` | `errorModal.ts:132–137` produces copy; no dedicated unit test | — |
| `InternalError` | `errorModal.ts:138–145` produces copy; surfaced as final fallback from `flow.ts` | — |

**FLAG (minor):** `cli-exit` exit codes 3 and 4 and the `spawn-failed`/`file-read-failed`/`path-rejected`/`internal-error` classes only get coverage by virtue of `specFor`'s exhaustive switch being shared with the tested classes (exit 1, 2, 5). No dedicated tests assert the per-code copy or button-set for exits 3 and 4 specifically. Acceptable — same code path serves all `cli-exit` codes — but a bug in those branches would slip past CI. Not a blocker.

### 2. Spinners always have a "cancel" affordance; no infinite spinner is possible. **PASS**

`newCampaignModal.ts:251–258` always appends a `data-role="cancel-generation"` button (unconditional). Cancel handler at lines 286–291 fires `deps.cancel(jobId)` and resolves with `kind: 'cancelled'`.

Safety-timer test at `newCampaignModal.test.ts:184–201` confirms the UI escapes within `DEFAULT_SAFETY_MS = 330000` (5:30) even if both `invoke` and `cancelGeneration` hang. The timer (newCampaignModal.ts:276–284) fires `void deps.cancel(opts.jobId).catch(() => undefined)` (fire-and-forget) and calls `finalize({ kind: 'safety-timeout' })` unconditionally. `flow.ts:75–78` maps `safety-timeout` → `showErrorModal({ errorClass: 'timeout' })`, closing the loop.

### 3. Stderr from the CLI is sanitized before being shown. **PASS**

Rust side: `sanitize.rs:22–26` runs the pipeline (UTF-8 lossy decode → strip ANSI CSI/OSC + control chars → 1 KB cap). 8 unit tests at `sanitize.rs:100–158` cover ANSI CSI/OSC strip (both BEL- and ST-terminated), control-char strip, length cap, lone ESC, printable-text passthrough, and lossy UTF-8.

`commands.rs:354` calls `sanitize_stderr(&stderr_bytes)` before `with_cli(exit_code, stderr_sanitized)`; the post-sanitize string crosses the IPC, never raw bytes. Capture cap (`STDERR_CAP_BYTES = 4 * 1024`) at lines 415–420.

TS render side: `errorModal.ts:185–196` — `pre.textContent = opts.stderr`. Comment at line 188 makes the discipline explicit. `errorModal.test.ts:100–116` asserts: stderr `'<img src=x onerror=alert(1)>'` produces a `<pre>` whose `textContent` matches the raw string verbatim and `pre.querySelectorAll('img').length === 0`.

### 4. Browser fallback path actually works. **PASS**

`browserFallback.ts` mounts a hidden `<input type="file" accept="application/json,.json">` triggered by a visible button. On change: `FileReader.readAsText` → `JSON.parse` → `parseCampaign` (lines 132–159). Returns `imported` / `closed` / `error` (errorClass `stdout-not-json` for JSON syntax, `schema-fail` for `CampaignParseError`).

Unit tests at `browserFallback.test.ts:120–154` cover all three outcomes. E2E "valid manifest via file picker → loads + act_intro 0" at `procgen.spec.ts:291–313`; bad-file test at `procgen.spec.ts:315–330`.

Glue: `flow.ts:106–128` (`openBrowserFlow`) wires `result.manifestJson` + `'' as path` + `result.seedUsed` into `harness.loadGeneratedManifest`. Empty path is the deliberate "no on-disk location" signal (architect §10.1 step 4); `harness.ts:357` checks `activeProcgen.sourcePath.length > 0` before persisting `sourcePath` to the LibraryEntry.

### 5. No code paths assume Tauri exists at module-load time. **PASS**

`src/__tests__/no-tauri-static-import.test.ts:43–67` walks `src/**/*.ts`, excludes `platform.ts` (allowlist) + `__tests__/` + `.test.ts`/`.d.ts`, asserts no offenders.

**Mental falsification.** Adding `import { invoke } from '@tauri-apps/api/core';` at the top of `harness.ts`: walked → not commented → regex matches → canary fires. **Canary would fire. Confirmed.**

**FLAG (minor canary gap):** original regex `\bfrom\s+` missed side-effect imports `import '@tauri-apps/...';`. **Addressed post-review** — see "Issues found / Issue 3".

Production wiring: `platform.ts:81–98` (`tauriHandle`) is the only place that does `await import('@tauri-apps/api/{core,event}')` — dynamic imports only, gated on `isTauri()`. Cached after first call. All procgen modules import only from `'./platform'`, never `'@tauri-apps/'`.

## Architect's additional invariants

### 6. The Rust spawn has no shell. **PASS**

`src-tauri/src/no_shell_test.rs:17–28` lists forbidden patterns: `Command::new("sh"`, `Command::new("cmd"`, `Command::new("cmd.exe"`, `Command::new("/bin/sh"`, `Command::new("bash"`, `Command::new("powershell"`, `Command::new("pwsh"`. Recursive collection skips `target/`, hidden dirs, the canary itself. Skips `//` comments per line.

`commands.rs:262` confirms `Command::new("node")` with discrete `cmd.args(&argv)` (line 263) — no shell, no string concat. CWD set to app-data campaigns dir (line 264). `kill_on_drop: true` and standard `Stdio` config.

### 7. The manifest passes `parseCampaign` before any game code touches it. **PASS**

Read path in `harness.ts:217–240` (`loadGeneratedManifest`):
1. Line 219: `JSON.parse(manifestJson)` — `SyntaxError` propagates.
2. Line 221: `parseCampaign(parsedJson)` — `CampaignParseError` propagates.
3. Lines 222–238: synthesize id, build empty save, write save, assign to `campaign`/`save`/`activeProcgen`, apply theme, set state to `act_intro`. **None of this happens if either parse step throws.**

Caller (`flow.ts:94–103`): `try { harness.loadGeneratedManifest(...) } catch (e) { showErrorModal({...}) }` — `SyntaxError` → `stdout-not-json`; `CampaignParseError` → `schema-fail`.

"Tauri CLI returns garbage" e2e at `procgen.spec.ts:233–254` sets `manifestJson: JSON.stringify({ hello: 'world' })`, expects `data-error-class="schema-fail"`. Confirmed.

## Seam-focused checks

### 8. Seam 1: CLI → Rust. **PASS**

`commands.rs:247` calls `app_data_campaigns_dir(&app)`. The function (lines 200–209) does `app.path().app_data_dir()` → `.join("campaigns")` → `std::fs::create_dir_all(&dir)` (creates if absent). Rust then `cmd.current_dir(&campaigns_dir)` (line 264); `--out` receives `out_filename` (bare filename) at line 253. CLI's path-safety check resolves against CWD and accepts.

### 9. Seam 2: Rust → TS. **PASS**

`commands.rs:75–84` — `ProcgenError` is `#[derive(Serialize)] #[serde(rename_all = "camelCase")]` with `cli_exit_code` and `cli_stderr` as `Option<T>` + `skip_serializing_if = "Option::is_none"`. Becomes `cliExitCode: number | undefined` / `cliStderr: string | undefined` JS-side — matches `api.ts:48–53` (`ProcgenError`).

Tauri 2.x `invoke<T>` rejects the promise (not resolves) when the Rust handler returns `Err`. Rejection value is the *same JSON shape* as success. TS-side at `flow.ts:79–88` destructures `result.error.kind`, `result.error.message`, `result.error.cliExitCode`, `result.error.cliStderr`. `newCampaignModal.ts:323–336` catches and packages into `result.error`.

`api.test.ts:98–109` exercises the rejection-shape contract: `mockInvoke(async () => { throw err; })` where `err` is a `ProcgenError`, `await expect(...).rejects.toEqual(err)` passes — confirming the TS binding preserves the rejection shape.

### 10. Seam 3: TS → game state. **PASS**

`harness.ts:217–240`:
- **id synthesis**: `procgen-${seedUsed}-${now()}` (line 224). Collision-resistant: requires two runs in the same millisecond with the same seed. `newCampaign.test.ts:112–127` confirms uniqueness via injected counter.
- **save before transition**: `save = emptySave(...)` then `writeSave(storage, save)` (lines 226–227) happen *before* `state = { kind: 'act_intro', actIndex: 0 }` (line 238). Reload in the gap sees the save but no active state.

The library upsert happens inside `render()` → `persist()` (line 451), after the state transition. Slightly different ordering from architect §7.4 spec, but no behavioral consequence (sync storage write, no async window). **Issue 4 (informational)** below.

### 11. Graceful degradation: what if Node is missing? **PASS**

`commands.rs:276–283` — on spawn, `cmd.spawn().map_err(|e| ...)`. `ErrorKind::NotFound` → `BinaryNotFound`; else → `SpawnFailed`. `CreateProcess`/`execvp` failing to find `node` returns `ENOENT` (NotFound).

User copy at `errorModal.ts:53–57`: `"Couldn't find the campaign generator on your system. Make sure Node.js 20+ is installed and available on your PATH, then try again."` — explicitly mentions Node.js. `errorModal.test.ts:48–55` asserts the regex match.

### 12. Graceful degradation: what if claude is missing or not authed? **PASS**

CLI's exit 5 is "claude not reachable" per cli.md. Rust handler at `commands.rs:357–362` returns `ProcgenError { kind: CliExit, cli_exit_code: Some(5), ... }`.

`errorModal.ts:99–104` for exit 5: title "Couldn't reach claude"; body mentions install + auth; `actions: ['close']` only — **no Retry button**. `errorModal.test.ts:76–82` asserts `buttons.map((b) => b.dataset['action'])` exactly equals `['close']`. No auto-retry.

### 13. Graceful degradation: manifest too big to JSON.parse. **NOT A REAL CONCERN**

`manifest_json` is a `String` in Rust, read via `tokio::fs::read_to_string` and passed inline. Schema caps (max acts × max puzzles × per-field string lengths) bound a worst-case manifest at a few MB. `JSON.parse` on 3 MB is single-digit-millisecond. No additional guardrail needed.

## Coder-flagged items

### `tauri.conf.json#bundle.resources` wildcard

`["../bin/throughline-gen", "../dist-cli/**/*"]` — Tauri 2.x's bundler config does accept glob patterns under `bundle.resources`. The `**/*` form is correct syntax. Coder's caveat — `cargo build` passes but `tauri build` (bundling) was not validated — is the right stance. Deferred to Phase 12 packaging.

**Recommendation:** Add to Phase 12 checklist: "verify `tauri build` produces a bundle containing `bin/throughline-gen` and `dist-cli/throughline-gen.mjs` at the expected resource paths; the Rust `resolve_cli_binary` looks for `bin/throughline-gen` inside `resource_dir()`."

### `src-tauri/gen/schemas/` is gitignored

Right call. Tauri 2.x's capabilities pipeline generates these files at build time; they're reproducible from `src-tauri/capabilities/*.json`. The `.gitignore` entry is conventional.

Cosmetic note: `src-tauri/capabilities/default.json` references `../gen/schemas/desktop-schema.json` in `$schema`; IDEs will get a missing-file warning on a fresh checkout until `tauri dev` is first run. Not a blocker.

## Issues found

Sorted by severity. None blocking. All three low-severity items **were addressed in the post-review commit**.

### Issue 1 (low) — `read_campaign_file` path-safety can over-reject on first run. **ADDRESSED.**

`commands.rs:514–532` (pre-fix): when the app-data dir doesn't exist on disk yet, `base.canonicalize()` fails; the fallback `.unwrap_or(base)` returns the non-canonicalized base. On Windows, `resolved` has the `\\?\` UNC prefix; `base_canon` does not. `resolved.starts_with(&base_canon)` returns false → wrong error class (`PathRejected` instead of `FileReadFailed`).

In the normal flow this is unreachable (generate_campaign creates the dir). The resume-on-launch path (`harness.ts:298–303` → `loadCampaignFromSourcePath` → `readCampaignFile`) didn't first ensure the dir exists.

**Fix:** `commands.rs` now calls `std::fs::create_dir_all(&base)` before `canonicalize()`, and fails fast with `FileReadFailed` if canonicalization itself fails (the silent `.unwrap_or(base)` mask is gone).

### Issue 2 (low) — two architect-listed Rust unit tests absent. **ADDRESSED.**

Architect §11.5 listed `argv_construction` and `timeout_kills_child`. Neither existed in the initial Phase 11 commit.

**Fix:** `src-tauri/src/commands.rs` now has 4 new `#[cfg(test)]` tests:
- `argv_construction_pushes_flags_in_expected_order` — covers all flags.
- `argv_construction_omits_unset_flags` — confirms `None` options don't emit.
- `argv_construction_skips_empty_avoid_themes` — confirms empty list + `gentle:false` are omitted.
- `timeout_kills_child` — spawns `node -e "setTimeout(() => process.exit(0), 30000)"`, races against a 500 ms tokio timeout, confirms timeout fires and the child is killable. Gracefully skips with a log line if `node` isn't on PATH.

Rust suite goes from 9 → 13 tests.

### Issue 3 (low) — static-import canary regex misses side-effect imports. **ADDRESSED.**

Original `STATIC_IMPORT_RE = /^\s*import\b[^;]*\bfrom\s+['"]@tauri-apps\//m` required `from`. A side-effect import like `import '@tauri-apps/api/core';` slipped past.

**Fix:** Regex broadened to `/^\s*import\b(.+\bfrom\s+)?['"]@tauri-apps\//m` (the `from` clause is now optional). Both forms caught.

### Issue 4 (informational) — library upsert ordering

Architect §7.4 sequenced as: parse → synthesize id → save → library upsert → in-memory state → render. Implementation has the library upsert happen inside `render()` → `persist()`, after the state transition. Functionally equivalent (sync storage write); no behavioral consequence. Flagged only for completeness.

## Recommendations before merge

**Merge as-is.** Three low-severity items already addressed in the post-review commit. The fourth was informational only.

Carried into Phase 12 packaging checklist:

1. Verify `tauri build` produces a bundle containing `bin/throughline-gen` and `dist-cli/throughline-gen.mjs` at the expected resource paths.

## What I did NOT check

- Did NOT run `tauri dev`, `tauri build`, or any live LLM calls.
- Did NOT redo Phase 10's deep security pass (no-eval, no-shell on the CLI side, Zod-strict, retry-bound). Those are encoded in tests; confirmed only that Phase 11 doesn't *bypass* them.
- Did NOT validate `bundle.resources` wildcard against the actual Tauri bundler — deferred to Phase 12.
- Did NOT inspect every Rust dependency in `Cargo.toml` for security advisories.
- Did NOT manually walk through the 30+ minute playtest checkpoint — that's the user's manual checkpoint.
- Did NOT verify the `procgen:progress` event subscription handles network/IPC drops gracefully (non-load-bearing; best-effort by design).

---

**Summary (≤100 words):** Phase 11's procgen integration lands cleanly: the failure-mode matrix has near-complete unit + e2e coverage, the spinner is always cancellable with a 5:30 safety timer, stderr is sanitized in Rust and re-rendered via `textContent`, the browser fallback works end-to-end, and both new load-bearing invariants (no-shell Rust spawn; no-static-Tauri-import in shared code) have working static-analysis canaries. Three minor follow-ups identified and addressed in the post-review commit: path-safety edge case in `read_campaign_file`, missing Rust unit tests (`argv_construction` ×3 + `timeout_kills_child`), broadened static-import canary to catch side-effect imports. Verdict: **PASS-WITH-NOTES** — merge as-is.
