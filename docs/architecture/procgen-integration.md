# Throughline Procgen Integration (Phase 11)

> **Status:** Architect step. Awaiting user review before Coder begins.
> **Cycle:** Moderate. Architect step is the integration test plan; reviewer focuses on seams (CLI → JSON → game) and graceful degradation when each link fails.
> **Companion:** [throughline-design.md](../../throughline-design.md) §9 (CLI), §11 (procgen risks), §10 Phase 11 (reviewer checklist); [IMPLEMENTATION_PLAN.md § Phase 11](../../IMPLEMENTATION_PLAN.md); [docs/architecture/cli.md](cli.md) (the Phase 10 CLI contract — argv shape, exit codes, stderr discipline); [docs/architecture/campaign-state.md](campaign-state.md) (campaign state machine, LibraryIndex).

This memo locks in the platform-detection contract, the Tauri command surface, the subprocess invocation discipline on the Rust side, the manifest-persistence layout, the UI flow for "New Campaign", the per-error-class UX, the diversity/difficulty hint wiring, the browser fallback path, and the integration test matrix for Phase 11. Once approved, the Coder builds against these contracts via TDD; the Reviewer verifies the failure-mode tests cover the seam list at the bottom of this doc.

Open decisions where the spec is silent are in §13; flag for human review if you disagree with the recommended default.

---

## 0. Prerequisites the user must install before Coder dispatch

**Rust / cargo is not installed on this machine.** Tauri 2.x desktop builds require the Rust toolchain and several platform-specific system packages. Before the Coder begins, the user must install:

1. **Rust toolchain** — via [rustup](https://rustup.rs/). The Coder will not attempt to install Rust itself.
2. **Tauri 2.x system prerequisites** for the user's OS — documented at <https://v2.tauri.app/start/prerequisites/>. On Windows this is Microsoft C++ Build Tools and WebView2 (usually present on Win10+).
3. After install, `rustc --version` and `cargo --version` should both succeed in the shell that will run `npm run tauri dev`.

The Coder doc and PR description should restate this so it's clear to anyone landing on a clean machine. **There is currently no `src-tauri/` directory in the repo** — the Coder scaffolds it from scratch via `npm create tauri-app@latest` (or `npm install -D @tauri-apps/cli` + `npx tauri init`) into the existing project. Tauri's init knows how to colonize an existing Vite project; the Coder's first commit should be the unmodified scaffold so a reviewer can diff against subsequent customization.

The browser build (`npm run build`, `npm run dev`) does **not** depend on Rust and continues to work without it. The browser fallback flow (§10) must keep working end-to-end even when Rust is absent from the build host.

---

## 1. Goal and trust boundary

**Goal (from design doc Phase 11 DoD):** From a fresh install, the user hits one button and gets a unique 3–6 hour campaign.

**Trust boundary unchanged.** The CLI remains the only LLM caller. The game treats the manifest the Rust side delivers as untrusted bytes that must pass `parseCampaign` (the shared Zod schema) before any game code touches them. The fact that Tauri spawned the CLI does not make its output trusted — a buggy or compromised `claude -p` could still emit garbage, and the Phase 10 retry/regen logic already runs *inside* the CLI; what crosses the Tauri boundary is just stdout bytes plus a path string.

Concretely, three trust gates apply on the game-side load:

1. The Rust command returns the manifest's text or path. The Rust side does **not** parse or validate the manifest — it's a dumb conduit.
2. The TypeScript handler reads the file (or takes the inline JSON the Rust command returned), `JSON.parse`s it, then calls `parseCampaign(parsed)`. **Any failure here lands on the schema-failure modal** (§5), not a happy path.
3. Narrative text rendered via `textContent`, never `innerHTML` — Phase 7's invariant restated. The harness already enforces this; the only new render surface in Phase 11 is the modals (§5), and they must adhere.

---

## 2. Platform detection (`src/platform.ts`)

A single TypeScript module with the smallest possible public surface. **No top-level Tauri imports anywhere in shared code**; this module is the only file in `src/` allowed to know Tauri exists, and even it does so via dynamic import.

### 2.1 Public surface

```ts
// src/platform.ts
export type Platform = 'tauri' | 'browser';

/** Synchronous detection. Safe to call at module load time. */
export function detectPlatform(): Platform;

/** Convenience boolean. Used to gate UI branches. */
export function isTauri(): boolean;

/**
 * Returns a thin, typed handle for invoking Tauri commands.
 * Throws `PlatformNotTauriError` if called outside Tauri.
 *
 * Implementation: dynamic import of `@tauri-apps/api/core`, cached.
 * The first call does the import; subsequent calls return the cached
 * handle. This is the *only* place in shared code that imports a
 * Tauri module.
 */
export async function tauriHandle(): Promise<TauriHandle>;

export interface TauriHandle {
  /** Wraps `@tauri-apps/api/core#invoke`. */
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  /** Wraps `@tauri-apps/api/event#listen`. */
  listen<T>(event: string, cb: (payload: T) => void): Promise<() => void>;
}

export class PlatformNotTauriError extends Error {
  readonly code = 'PLATFORM_NOT_TAURI' as const;
}
```

### 2.2 Detection method

Tauri 2.x injects `window.__TAURI_INTERNALS__` (the IPC bridge) into the webview at load time; `window.__TAURI__` is also present but is considered legacy in 2.x. To be robust across minor releases, `detectPlatform()` checks **both**:

```ts
export function detectPlatform(): Platform {
  if (typeof window === 'undefined') return 'browser';   // SSR / Node test env
  const w = window as Window & {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  };
  if (w.__TAURI_INTERNALS__ !== undefined) return 'tauri';
  if (w.__TAURI__ !== undefined) return 'tauri';
  return 'browser';
}
```

`isTauri()` is `detectPlatform() === 'tauri'`. Memoized inside the module; the result cannot change during the lifetime of the page.

### 2.3 The dynamic-import discipline (reviewer-checked invariant)

**Rule:** no file under `src/` (other than `src/platform.ts` itself) may have a static `import` of any module under `@tauri-apps/`. The reviewer verifies this with a grep test (§11.4): a static-analysis canary that fails CI if a `from '@tauri-apps/` import appears outside `src/platform.ts`. This mirrors the CLI's `no-shell.test.ts` pattern from Phase 10.

The reason: a static top-level `import` resolves at module load time. In the browser build, `@tauri-apps/api/core` is either not bundled or is a stub — but a top-level import in `harness.ts` would still bind a name and (depending on Vite's tree-shaking) potentially keep dead JS in the browser bundle. More importantly, **a developer reading `harness.ts` should be able to tell at a glance whether the code path is platform-agnostic**. The dynamic-import discipline makes that diff obvious.

### 2.4 Test mocking strategy

In `vitest`, set `globalThis.window.__TAURI_INTERNALS__ = {}` to flip detection. Mock the dynamic import via `vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))`. The production code never knows it's mocked — it only sees the `TauriHandle` interface.

In `playwright`, set the marker in a `page.addInitScript(() => { (window as any).__TAURI_INTERNALS__ = {}; })` before any navigation. Combined with a `page.exposeBinding` shim for `invoke` and `listen`, the entire desktop flow can be driven from a browser-based e2e (§11.3). Production code never touches the binding directly — the shim sits inside the dynamic-import target that `tauriHandle()` resolves to.

---

## 3. Tauri command surface

The Rust side exposes exactly **three** commands. The surface is intentionally tiny — the more code that lives on the Rust side, the more we duplicate logic that already lives in the CLI, and the more game logic risks creeping into Rust (violating CLAUDE.md invariant #1: "the game is a pure function of `campaign.json`").

### 3.1 Commands

| Command | Args | Returns |
|---|---|---|
| `generate_campaign` | `GenerateOpts` (see below) | `Result<GenerateOk, ProcgenError>` |
| `cancel_generation` | `{ jobId: string }` | `Result<(), ProcgenError>` |
| `read_campaign_file` | `{ path: string }` | `Result<String, ProcgenError>` |

### 3.2 Rust types

```rust
// src-tauri/src/commands.rs

use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct GenerateOpts {
    pub job_id: String,                     // UUID generated frontend-side
    pub seed: Option<String>,
    pub acts: Option<u32>,
    pub puzzles_per_act: Option<u32>,
    pub gentle: Option<bool>,
    pub avoid_themes: Option<Vec<String>>,
    pub llm_timeout_ms: Option<u32>,        // forwarded as --llm-timeout-ms
}

#[derive(Serialize)]
pub struct GenerateOk {
    pub path: String,           // absolute path inside the app data dir
    pub manifest_json: String,  // the raw stdout we read back from `path`
    pub elapsed_ms: u64,
    pub seed_used: String,      // echoed so the UI can display "Seed: abc123"
}

#[derive(Serialize)]
pub struct ProcgenError {
    pub kind: ProcgenErrorKind,
    pub message: String,             // sanitized; see §6
    pub cli_exit_code: Option<i32>,  // present when kind == cli_exit
    pub cli_stderr: Option<String>,  // sanitized + truncated; see §6
}

#[derive(Serialize)]
pub enum ProcgenErrorKind {
    BinaryNotFound,        // exec failed at spawn
    SpawnFailed,           // exec failed with errno
    Timeout,               // Rust-side wall clock fired
    Cancelled,             // user clicked cancel
    CliExit,               // CLI exited non-zero — cli_exit_code populated
    StdoutNotJson,         // not used: leave parsing to TS, but reserved
    FileReadFailed,        // read_campaign_file failed
    PathRejected,          // read_campaign_file refused for path safety
    InternalError,         // bug
}
```

### 3.3 TypeScript binding shape

The Tauri 2.x `invoke<T>(cmd, args)` already returns `Promise<T>` and **rejects** on the Rust side's `Err`. The TS handler awaits and pattern-matches the rejected value (which Tauri serializes to the same JSON shape as the success case):

```ts
// src/campaign/procgen/api.ts
import { tauriHandle } from '../../platform';

export interface GenerateOpts {
  readonly jobId: string;
  readonly seed?: string;
  readonly acts?: number;
  readonly puzzlesPerAct?: number;
  readonly gentle?: boolean;
  readonly avoidThemes?: readonly string[];
  readonly llmTimeoutMs?: number;
}

export interface GenerateOk {
  readonly path: string;
  readonly manifestJson: string;
  readonly elapsedMs: number;
  readonly seedUsed: string;
}

export type ProcgenErrorKind =
  | 'binary-not-found' | 'spawn-failed' | 'timeout' | 'cancelled'
  | 'cli-exit' | 'stdout-not-json' | 'file-read-failed' | 'path-rejected'
  | 'internal-error';

export interface ProcgenError {
  readonly kind: ProcgenErrorKind;
  readonly message: string;
  readonly cliExitCode?: number;
  readonly cliStderr?: string;
}

export async function generateCampaign(opts: GenerateOpts): Promise<GenerateOk>;
export async function cancelGeneration(jobId: string): Promise<void>;
export async function readCampaignFile(path: string): Promise<string>;
```

Rust serde converts `snake_case` ↔ `camelCase` via a `#[serde(rename_all = "camelCase")]` attribute on every struct; this is the standard Tauri convention.

### 3.4 Decision: return both `path` and `manifest_json`

The Rust command writes the CLI stdout to disk (under the app data dir, §8) **and** returns the JSON inline in `GenerateOk.manifest_json`. Why both:

- **Inline JSON** is what the handler immediately needs to feed into `parseCampaign`. Re-reading from disk after writing would be redundant.
- **Path** is what the LibraryIndex (Phase 7) needs to find the file again later — for resume on next launch, for re-display in the library list, and for export.

The alternative ("write to disk, return only path; let TS re-read") doubles disk I/O on the happy path and forces a `read_campaign_file` call that could itself fail. The alternative ("return only JSON, no disk write") would lose the manifest on app restart unless we also wrote a copy via `localStorage` or similar, which doesn't survive across browser/desktop modes. Writing + returning both is one disk write and zero extra I/O.

The `read_campaign_file` command exists for the **resume-on-launch** path: after the app restarts, the LibraryIndex still has the path; the harness calls `readCampaignFile(entry.path)` to reload. It's also useful for any future "import a manifest someone else generated" flow on desktop.

---

## 4. Subprocess invocation from Rust

### 4.1 Binary resolution

The Rust command must find `bin/throughline-gen` (which is a Node shebang wrapper around `dist-cli/throughline-gen.mjs`). The resolution policy:

1. **Dev mode** (`tauri dev`): the Rust process's CWD is `src-tauri/`. Resolve via `cwd().parent().join("bin").join("throughline-gen")` — i.e. `<repo-root>/bin/throughline-gen`. Walk up to find it; fail with `ProcgenErrorKind::BinaryNotFound` if not present.

2. **Bundled desktop build** (`tauri build`): Tauri's `tauri.conf.json` lists `bin/throughline-gen` and `dist-cli/` under `bundle.resources`. At runtime, Tauri's `tauri::path::resource_dir()` returns the bundle's resource root. The Rust code resolves the binary relative to that:

   ```rust
   let bin_path = app.path().resource_dir()?
       .join("bin").join("throughline-gen");
   ```

3. **Override for testing**: an env var `THROUGHLINE_CLI_PATH`, if set, is used verbatim (after `PathBuf::canonicalize` to absolutize). The override exists so a developer can point at a local build of the CLI without re-bundling. Tests use this to point at a fake-CLI executable that emits canned stdout.

The actually-executed binary on every platform is **`node bin/throughline-gen`** (or the system `node` resolving the Node shebang on POSIX). On Windows the shebang isn't honored by `CreateProcess`, so the Rust code calls `node` explicitly:

```rust
let mut cmd = Command::new("node");
cmd.arg(&bin_path);
cmd.args(&cli_args);
```

This requires Node ≥20 on the user's PATH on **desktop too**. Documented in the desktop install instructions. If `node` isn't present, the spawn fails with `BinaryNotFound`; the modal copy explicitly says "Node.js 20+ required on your PATH" (§5).

### 4.2 Argv construction

The Rust side translates `GenerateOpts` into the CLI's flag set documented in cli.md §9.2:

```rust
let mut args = Vec::<String>::new();
args.push("--out".into());
args.push(out_path.to_string_lossy().into_owned());
if let Some(seed) = opts.seed.as_ref() {
    args.push("--seed".into());
    args.push(seed.clone());
}
if let Some(acts) = opts.acts {
    args.push("--acts".into());
    args.push(acts.to_string());
}
// ... etc.
if opts.gentle.unwrap_or(false) {
    args.push("--gentle".into());
}
if let Some(themes) = opts.avoid_themes.as_ref() {
    if !themes.is_empty() {
        args.push("--avoid-themes".into());
        args.push(themes.join(","));
    }
}
if let Some(ms) = opts.llm_timeout_ms {
    args.push("--llm-timeout-ms".into());
    args.push(ms.to_string());
}
```

Each argument is pushed as a **separate** Vec entry. `Command::args(&args)` then passes each to the OS exec call as a discrete argv element — exactly the same byte-for-byte argv discipline Phase 10 enforces on the Node side.

### 4.3 `shell: false` — Rust restatement

**Rule:** the Rust side **never** uses `Command::new("sh")` / `Command::new("cmd")` followed by `-c` / `/C`. Always `Command::new("node").args(&argv)`. The `--avoid-themes` value (which originates from `LibraryEntry.themeName` in localStorage — i.e. data the LLM produced) is passed as a single argv element; no shell parses it. This is the **same `shell: false` invariant** the CLI enforces, restated on the Rust spawn side.

A static-analysis canary `src-tauri/src/__tests__/no-shell.rs` (Rust test, not Vitest) greps the Rust sources for `"sh"`, `"cmd"`, `"-c"`, `"/C"`, `Command::new("sh"`, etc. — same regression-guard pattern as `cli/src/__tests__/no-shell.test.ts`. The reviewer verifies by attempting to add `Command::new("sh")` in a scratch branch and confirming the test fails.

### 4.4 Process supervision

The Rust command holds the child handle in a `Mutex<HashMap<JobId, Child>>` stored on the Tauri app state. Lookups:

- On spawn, insert under `opts.job_id`.
- On the `cancel_generation` command, look up `job_id` and call `child.kill()`. If absent, return `Ok(())` — cancelling a finished job is a no-op.
- On normal exit, remove the entry.

This pattern is standard for Tauri-managed children. The frontend generates `jobId` (UUID) before invoking `generate_campaign`; it passes the same id to `cancel_generation`. **The frontend cannot cancel a job it did not start** (no global "cancel everything" command) — the job-id correlation makes this explicit.

### 4.5 Wall-clock timeout (Rust side)

The Rust command races the child's exit against a Rust-side tokio timeout. **Default budget: 5 minutes (300 s).** This is far larger than the CLI's *own* 60 s per LLM call, because the CLI may retry up to 3 + 3 × max_puzzles times (cli.md §2.6) — the worst case is several minutes of cumulative subprocess wall time.

```rust
use tokio::time::{timeout, Duration};

let wait_fut = child.wait_with_output();
let result = timeout(Duration::from_millis(opts.timeout_ms_or_default()), wait_fut).await;
match result {
    Ok(Ok(output)) => { /* normal exit; check status */ },
    Ok(Err(e)) => { /* tokio I/O error */ },
    Err(_elapsed) => {
        // Hard timeout. Kill the child, drain its output, error out.
        let _ = child_handle.kill().await;
        return Err(ProcgenError {
            kind: ProcgenErrorKind::Timeout,
            ..
        });
    }
}
```

The frontend overrides via `GenerateOpts.llmTimeoutMs`, but the *Rust wall clock* always wraps the *CLI's own timeouts*. A defense-in-depth layering: even if the CLI's internal 60 s timer is broken, the Rust 5-minute timer rescues us.

### 4.6 Progress events

The CLI doesn't currently expose structured progress over stdout (cli.md §9 — stdout is silent in non-verbose mode, prints only the path on success). For Phase 11 we don't add structured progress to the CLI (that's churn for a v1 nicety); instead, the Rust side emits a heartbeat event every 2 seconds while the child is alive:

```rust
app.emit("procgen:progress", ProgressPayload {
    job_id: opts.job_id.clone(),
    phase: "running",      // future: "spawning" | "running" | "validating" | "writing"
    elapsed_ms,
})?;
```

The frontend listens via `tauriHandle().listen<ProgressPayload>('procgen:progress', cb)` and updates the modal's elapsed-time display. Since the CLI's actual sub-phase is opaque to Rust, all events carry `phase: "running"` — but the elapsed time keeps the UI alive (the user sees the seconds tick, knows the app isn't frozen). This is intentionally minimal; a future "stream progress" upgrade slots in here without changing the API surface.

The frontend tears down the listener when the modal closes or the promise resolves.

### 4.7 Streams capture

Stdout is captured into a `Vec<u8>` and decoded as UTF-8 at the end (lossy decode → replacement char on bad bytes, then validated by the schema parse downstream). Stderr is captured into a separate `Vec<u8>`, **capped at 4 KB** — same envelope as the CLI's own internal cap (cli.md §3.4). The cap is enforced via a chunked read; once 4 KB is buffered, additional bytes are silently dropped (a `… (stderr truncated)` marker is appended once at end).

Stderr is then **sanitized** before being returned across the IPC boundary — §6.

---

## 5. Error surface (per-failure UX)

Every failure that crosses the Rust→TS boundary lands on a single modal with category-specific copy and a category-specific retry affordance. The modal lives in `src/campaign/dom/errorModal.ts`.

### 5.1 Error class → user-facing copy + retry

| Rust error kind | CLI exit code | User sees | Retry button? | Suggested action |
|---|---|---|---|---|
| `BinaryNotFound` | n/a | "Couldn't find the campaign generator on your system. Make sure Node.js 20+ is installed and try again." | No | Suggest visiting the install docs (link out). |
| `SpawnFailed` | n/a | "Failed to launch the campaign generator: \<sanitized message\>." | Yes | Retry with the same args. |
| `Timeout` (Rust) | killed | "Generation took longer than 5 minutes and was cancelled. Try a smaller seed or fewer acts." | Yes, with note "consider lowering --acts/--puzzles-per-act" | Re-open the pre-gen modal. |
| `Cancelled` | killed | "Cancelled." | No (this *is* the user clicking cancel) | Returns to main menu. |
| `CliExit` exit=1 | 1 | "The generator hit an internal error: \<sanitized stderr\>" | Yes | Retry with a fresh seed. |
| `CliExit` exit=2 | 2 | "Couldn't get a valid campaign from the LLM after retries. Try a fresh seed." | Yes, **with auto-rerolled seed** | Re-open the pre-gen modal with a new random seed prefilled. |
| `CliExit` exit=3 | 3 | "One or more puzzles couldn't be solved. Try a fresh seed or enable Gentle mode." | Yes, **with auto-rerolled seed + gentle=true suggested** | Re-open the pre-gen modal. |
| `CliExit` exit=4 | 4 | "The generator refused to write to the requested path. This is an app bug; please file an issue." | No | Reported as a bug. |
| `CliExit` exit=5 | 5 | "Couldn't reach Claude. Is the `claude` CLI installed and signed in?" | Yes after fix | Link to `claude` install docs. **No automatic retry** — auth/install failures will fail identically. |
| `StdoutNotJson` (TS-side, not Rust) | 0 | "The generator returned malformed data. Try a fresh seed." | Yes | Auto-reroll seed. |
| Schema fails `parseCampaign` (TS-side) | 0 | "The generated campaign failed validation. Try a fresh seed." | Yes | Auto-reroll seed. Show issue count in body. |
| `FileReadFailed` | n/a | "Couldn't read the campaign file: \<sanitized message\>." | No | Resume path failed; main menu. |
| `PathRejected` | n/a | "Refused to read from that location. This is an app bug; please file an issue." | No | Bug report. |
| `InternalError` | n/a | "An unexpected error occurred: \<sanitized message\>" | Yes | Generic recovery. |

The "auto-reroll seed" affordance is important: a single fresh seed often fixes the failure class (over-constrained puzzles, theme collapse). The pre-gen modal re-opens with a newly-generated seed in the text field, and the user can still edit it before clicking Generate again.

### 5.2 Modal shape

`errorModal.ts` exports `showErrorModal(opts: ErrorModalOpts): Promise<ErrorAction>` where `ErrorAction = 'retry' | 'reroll-retry' | 'close'`. The promise resolves with the user's choice. The modal:

- Uses `<dialog>` (native HTML modal) with palette CSS vars for styling — same approach the rest of the harness uses.
- Title (textContent) per-class from the table above.
- Body (textContent) showing the message and sanitized stderr if present.
- Buttons: per-class — "Try a fresh seed" (rerolls + reopens pre-gen), "Retry" (same args), or "Close" (returns to main menu).
- Stderr is rendered in a `<pre>` styled with `white-space: pre-wrap` and a max-height + scrollbar. It's rendered via `textContent` (defense in depth — the sanitization in §6 already strips dangerous bytes, but `textContent` is the second layer).

### 5.3 Spinners are always cancellable

The "Generating…" modal (`src/campaign/dom/newCampaignModal.ts`) **always** has a visible Cancel button. The reviewer's checklist explicitly forbids any code path that reaches a state where the user cannot escape. The Cancel button calls `cancelGeneration(jobId)` (which kills the Rust child and returns the user to the pre-gen form). The Promise from `generateCampaign` rejects with `kind: 'cancelled'`; the handler catches and closes the modal.

A safety timer is overlaid: after 5 min 30 s of UI time (Rust-side timeout is 5 min, with 30 s margin for IPC drain), the modal **forces** the Cancel path even if the user hasn't clicked it. This is a defense-in-depth against the Rust-side timeout not firing for any reason (tokio bug, system clock skew). The reviewer verifies via a test that mocks the Rust side to hang indefinitely; the UI must escape within the safety window.

---

## 6. Stderr sanitization

The CLI's stderr is capped at 4 KB by the Phase 10 CLI itself (cli.md §3.4), but is **not currently sanitized** for terminal escapes or control characters. The architect doc explicitly notes this gap. Phase 11 closes it on the Rust side (so by the time stderr reaches TypeScript, it's already safe).

### 6.1 Sanitization pipeline (Rust)

```rust
fn sanitize_stderr(raw: &[u8]) -> String {
    // 1. UTF-8 decode (lossy).
    let s = String::from_utf8_lossy(raw);

    // 2. Strip ANSI CSI / OSC escape sequences.
    let re = regex::Regex::new(r"\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07").unwrap();
    let stripped = re.replace_all(&s, "");

    // 3. Drop other control chars (keep \n, \t).
    let cleaned: String = stripped.chars()
        .filter(|c| !c.is_control() || *c == '\n' || *c == '\t')
        .collect();

    // 4. Length-cap to 1 KB for display (the 4 KB cap was for capture
    //    safety; the display cap is for UI sanity).
    let mut out = cleaned;
    if out.len() > 1024 {
        out.truncate(1024);
        out.push_str("\n… (truncated)");
    }
    out
}
```

`regex` is a standard Rust crate; alternatively a hand-rolled scanner (~30 lines) avoids the dep. The reviewer prefers the hand-rolled scanner since adding `regex` for one use is overhead — leave that as a Coder-time choice but document the trade-off.

### 6.2 Defense in depth at render time

Even after sanitization, the TS error modal renders stderr via `textContent` (never `innerHTML`). This is the same Phase 7/8 contract for all LLM-derived text restated for stderr. The combination (sanitize on the way out of Rust + textContent on the way into the DOM) means even if the sanitizer has a bug, an attacker who controls the CLI's stderr cannot inject HTML.

### 6.3 No prompt content in stderr (the upstream invariant)

The CLI's *internal* discipline is to not echo prompt content to stderr (verbose mode prints metadata only — seed, acts, elapsed; per cli.md §9). The Phase 11 sanitization assumes prompt content might still leak through (e.g. a future bug in the spawn wrapper that pipes user prompt to stderr) and treats stderr as untrusted regardless. The Coder writes a unit test that feeds ANSI-laden, HTML-laden, and control-char-laden bytes through `sanitize_stderr` and asserts the output is clean printable text.

---

## 7. UI flow

### 7.1 Entry point — the New Campaign button

The button lives **on the main menu**, in the existing `renderMainMenu` (currently in `harness.ts` lines 261–292). It appears **above** the built-in campaign list, separated by a small divider. Order rationale: the player's most likely intent after the tutorial completion is "generate a new campaign"; built-in campaigns are the secondary option. (Phase 12 may reshuffle this when the demo-campaigns story lands, but the Phase 11 placement is "above the list".)

The button is **always visible** — on both Tauri and browser. The branch happens on click: in Tauri the pre-gen modal opens; in browser the fallback modal (§10) opens.

A test data-attribute on the button: `data-role="new-campaign"`, used by the e2e harness.

### 7.2 Pre-generation modal (`src/campaign/dom/newCampaignModal.ts`)

Opens on button click. Form fields:

| Field | Type | Default | Validation |
|---|---|---|---|
| Seed | text input | random hex string (regenerated each modal open) | Non-empty; ≤ 64 chars; alphanumeric + hyphen/underscore |
| Acts | number input | `3` | Integer 1–8 |
| Puzzles per act | number input | `4` | Integer 1–16 |
| Gentle mode | checkbox | `true` if LibraryIndex empty (first-ever procgen run); `false` otherwise | n/a |

Buttons: **Generate** (primary) and **Cancel** (secondary, returns to main menu).

Validation is client-side; invalid values display inline error text and disable Generate. The Rust side also validates (defense in depth) and returns `InternalError` on bad values, but the user should never see that — the client-side validation catches it first.

A small **"Avoid themes"** display below the form: shows the comma-separated theme names being auto-passed from the LibraryIndex (§9). Read-only; informational. If the list is empty, the section is hidden entirely.

### 7.3 Generating modal

On Generate click, the form modal transitions to a "Generating…" state (same `<dialog>`, content replaced):

- Spinner (CSS animation — no external dep, just a rotating border).
- Text: "Generating a fresh campaign. This usually takes 30 seconds to 2 minutes."
- Live elapsed counter: incremented on each `procgen:progress` event.
- Cancel button (always present).

On promise resolution:

- **Success**: dispatch `LOAD_GENERATED_CAMPAIGN` (§7.4), close modal, transition to the new campaign's act_intro.
- **Failure**: close generating modal, open error modal (§5).

### 7.4 Hand-off to the campaign state machine

A new action is added to the harness — **not** to the pure reducer (which doesn't know about disk I/O), but to the harness's `dispatch` / load surface:

```ts
// In CampaignHarnessHandle (src/campaign/dom/harness.ts):
loadGeneratedManifest(
  manifestJson: string,
  path: string,   // for LibraryIndex
  seedUsed: string,
): void;
```

The implementation:

1. `JSON.parse(manifestJson)`. On `SyntaxError`, surface as a `stdout-not-json`-equivalent error to the error modal.
2. `parseCampaign(parsed)`. On `CampaignParseError`, surface to the error modal.
3. Synthesize a `campaignId`: `procgen-${seedUsed}-${Date.now()}` (collision-resistant; the timestamp suffix prevents id reuse across regenerations with the same seed).
4. Build an empty `CampaignSave` for the new id; store via `writeSave`.
5. Insert a new `LibraryEntry`: `{ campaignId, themeName: parsed.theme.name, lastPlayed: now(), completed: false, sourcePath: path }`. **`sourcePath` is a new optional field on `LibraryEntry` added in Phase 11** — see §8.3 for migration.
6. Synthesize a `BuiltInCampaign`-shaped record for the in-memory `campaign` variable: `{ id: campaignId, displayName: parsed.theme.name, manifest: parsed }`. The harness's existing `loadCampaign(id)` flow then takes over, since the harness's internal `campaign` and `save` state are set the same way they would be for a built-in.
7. `applyTheme(parsed.theme, ...)`, set initial state to `{ kind: 'act_intro', actIndex: 0 }`, render.

The reducer is untouched — the only new public method on the harness is `loadGeneratedManifest`. The pure reducer's contract (manifest is constant for a campaign session, no I/O) is preserved.

### 7.5 Resume on next launch

On next app launch, the main menu reads `LibraryIndex` and renders generated entries alongside built-in ones (Phase 7's `renderMainMenu` already supports library entries — Phase 11 adds the case where `LibraryEntry.sourcePath` is present and points to an on-disk file). Clicking such an entry:

1. Calls `readCampaignFile(entry.sourcePath)` (Tauri only — browser-loaded manifests don't survive reload; see §10 for browser limitations).
2. Calls `harness.loadGeneratedManifest(json, sourcePath, /* seedUsed inferred from manifest.seed */)`.
3. If the file is missing (user moved/deleted it), the entry's "Load" button shows a tooltip "File not found at \<path\>" and a "Remove from library" affordance.

---

## 8. Manifest persistence

### 8.1 Storage location (Tauri)

Generated manifests live under the app data directory:

- **Windows**: `%APPDATA%\org.throughline.app\campaigns\`
- **macOS**: `~/Library/Application Support/org.throughline.app/campaigns/`
- **Linux**: `~/.local/share/org.throughline.app/campaigns/`

The path is resolved Rust-side via `tauri::path::app_data_dir()` (or the 2.x equivalent on the `AppHandle`). The directory is created on first use (`mkdir -p` equivalent).

File naming: `<seed>-<unix-ts>.json`. Example: `procgen-a3f9b1-1748365200.json`. The Unix-timestamp suffix ensures even identical seeds don't collide.

### 8.2 Atomic write (Rust side)

The Rust command does **not** re-implement the CLI's atomic-write logic — instead, it passes `--out` to the CLI as the target path. The CLI's `writer.ts` (cli.md §8) already does temp + fsync + rename atomically. **Caveat:** the CLI's path safety check (cli.md §8.2) requires the path to be inside CWD. When Rust spawns the CLI, the CLI's CWD is the **app data dir** (the Rust code sets `Command::current_dir(app_data_campaigns_dir)`); the `--out` path is then a bare filename relative to that. The CLI's path-resolution code resolves it against CWD and accepts it.

Why set CWD instead of passing an absolute path? Two reasons:

1. The CLI's path-safety check rejects absolute paths that don't sit inside CWD. Passing an absolute path through means the CLI would reject — we'd need a special "trusted host" flag, which adds a security-relevant surface.
2. Setting CWD is a single point of authority. The Rust side is the only thing that decides which dir the CLI may write to; the CLI itself doesn't need to know about Tauri.

After CLI exit, Rust reads the file back from `app_data_campaigns_dir.join("<seed>-<ts>.json")` and includes the contents in `GenerateOk.manifest_json`.

### 8.3 LibraryEntry shape change (additive)

The Phase 7 `LibraryEntry` shape:

```ts
interface LibraryEntry {
  readonly campaignId: string;
  readonly themeName: string;
  readonly lastPlayed: number;
  readonly completed: boolean;
}
```

Phase 11 adds an optional field:

```ts
interface LibraryEntry {
  readonly campaignId: string;
  readonly themeName: string;
  readonly lastPlayed: number;
  readonly completed: boolean;
  readonly sourcePath?: string;   // absolute path on disk; absent for built-ins
}
```

This is purely additive — existing entries without `sourcePath` continue to work (their `campaignId` resolves against `BUILT_IN_CAMPAIGNS`). No migration is needed at the persistence layer; the optional field is read with a nullish-coalesce. The `LIBRARY_VERSION` constant stays at `1`.

The defensive filter in `readLibrary` (saves.ts lines 175–183) must be updated to *allow* the optional `sourcePath` field without rejecting otherwise-valid entries that have it. The new shape check:

```ts
typeof (e as LibraryEntry).sourcePath === 'undefined'
  || typeof (e as LibraryEntry).sourcePath === 'string'
```

### 8.4 Browser path: no persistence (deliberate limitation)

In browser mode, the file picker (§10) loads a manifest into memory but does **not** persist it to localStorage (the manifest could be 100–500 KB; localStorage is small and persisting raw manifest text is wasteful). The browser flow is "single-session play" — closing the tab loses the manifest, but the player's *save progress* (CampaignSave) persists keyed by the synthesized `campaignId`. On next tab open, the library shows the entry but the "Resume" button is disabled with a tooltip "Re-import the manifest file to continue." Users wanting persistent generated campaigns use the desktop app — that's the intentional product boundary.

(Future enhancement: IndexedDB persistence for browser-mode manifests. Out of scope for v1.)

---

## 9. Diversity + difficulty hints (LibraryIndex wiring)

### 9.1 The query

The pre-gen modal's handler, on Generate click, computes both flags from the LibraryIndex before invoking `generate_campaign`:

```ts
import { readLibrary } from '../saves';

function computeHintsFromLibrary(storage: StorageBackend): {
  avoidThemes: readonly string[];
  gentle: boolean;
} {
  const lib = readLibrary(storage);
  // Filter out the tutorial — its theme name shouldn't push procgen
  // toward avoiding "The Workshop" themed campaigns.
  const playedEntries = lib.entries.filter(
    (e) => e.campaignId !== 'tutorial' && !e.campaignId.startsWith('demo-'),
  );
  const avoidThemes = Array.from(
    new Set(playedEntries.map((e) => e.themeName))
  ).slice(0, 8);   // cap; CLI's user-prompt envelope is finite
  const gentle = playedEntries.length === 0;
  return { avoidThemes, gentle };
}
```

### 9.2 Why this logic

- **`avoidThemes`** excludes built-in and tutorial themes so the first procgen run doesn't get a `--avoid-themes "The Apprentice's Manual"` instruction, which would do nothing useful.
- **`gentle`** is true exactly when no procgen campaign has ever been completed before. Phase 9's tutorial → procgen transition is the most common entry point; for that first run, easier puzzles smooth the cliff. The user can untick the gentle checkbox in the modal if they want a sterner first run.
- **Cap at 8 themes** prevents unbounded growth of the `--avoid-themes` flag value, which would eventually push the CLI's user prompt over the argv envelope. After 8 played campaigns, the *oldest* themes drop off (entries are sorted most-recently-played first per Phase 7, so the `slice(0, 8)` keeps the recent 8).

### 9.3 Test coverage

A unit test in `src/campaign/__tests__/newCampaign.test.ts`:

```ts
test('first run defaults gentle=true; subsequent runs default gentle=false', () => {
  const empty = new MemoryStorageBackend();
  expect(computeHintsFromLibrary(empty).gentle).toBe(true);
  upsertLibraryEntry(empty, { campaignId: 'procgen-x-1', themeName: 'T', lastPlayed: 1, completed: false });
  expect(computeHintsFromLibrary(empty).gentle).toBe(false);
});

test('built-in / tutorial themes are excluded from avoid-themes', () => {
  const s = new MemoryStorageBackend();
  upsertLibraryEntry(s, { campaignId: 'tutorial', themeName: 'The Apprentice\'s Manual', lastPlayed: 1, completed: true });
  expect(computeHintsFromLibrary(s).avoidThemes).toEqual([]);
});

test('avoid-themes capped at 8 entries', () => {
  const s = new MemoryStorageBackend();
  for (let i = 0; i < 12; i++) {
    upsertLibraryEntry(s, { campaignId: `procgen-${i}`, themeName: `Theme${i}`, lastPlayed: i, completed: false });
  }
  expect(computeHintsFromLibrary(s).avoidThemes).toHaveLength(8);
});
```

---

## 10. Browser fallback (no Tauri)

When `isTauri()` returns false, the New Campaign button opens a **fallback modal** explaining the limitation and offering a file-picker import path.

### 10.1 Fallback modal copy

```
New Campaign requires the desktop app.

The generator needs to call Claude on your machine, which only works
in the Throughline desktop app. To play a campaign generated
elsewhere, choose a manifest file below.

[Choose campaign.json file...]
[Cancel]
```

The file picker is a hidden `<input type="file" accept="application/json">` that's triggered by the visible button. On file selection:

1. `FileReader.readAsText(file)` → JSON string.
2. `JSON.parse` → object. On failure, show the same `stdout-not-json` error class (§5.1).
3. `parseCampaign(parsed)` → `RawCampaign` or throws. On `CampaignParseError`, show the schema-failure error modal.
4. `harness.loadGeneratedManifest(json, /* path */ '', /* seedUsed */ parsed.seed)`. The empty path signals "no persistent location"; the library entry's `sourcePath` is left undefined.

### 10.2 The browser entry persists for the session only

Per §8.4, the manifest itself isn't written anywhere. The library entry is still created so the in-memory state machine works; on tab close + reopen, the entry is in the library but "Resume" is disabled with a tooltip "Re-import the file to continue."

### 10.3 Documentation in Phase 12 README

The Phase 12 README documents this as the recommended path for users without `claude` installed: "Don't have Claude Code? You can still play campaigns generated by someone else — install the browser version and use the file picker." This was anticipated by design doc §11's "ship 3–5 sample campaigns" mitigation.

---

## 11. Integration test plan

Test files and what each one asserts:

### 11.1 `src/campaign/__tests__/newCampaign.test.ts` (unit, vitest)

The hint-computation tests from §9.3 plus the per-error-class modal lookup. Mocks `tauriHandle` to return canned promises:

| Test | Scenario | Assertion |
|---|---|---|
| `first-run-defaults` | empty library | `gentle=true`, `avoidThemes=[]` |
| `themes-accumulate` | library with one procgen entry | `gentle=false`, `avoidThemes=['T1']` |
| `themes-capped` | library with 12 entries | `avoidThemes` has 8 items |
| `tutorial-excluded` | library with tutorial only | `avoidThemes=[]` |
| `error-class-binary-not-found` | mock invoke rejects with `kind:'binary-not-found'` | error modal shown; copy contains "Node.js"; no Retry button |
| `error-class-cli-exit-2` | mock invoke rejects with `kind:'cli-exit', cliExitCode:2` | error modal shown; "Try a fresh seed" button visible; clicking it reopens pre-gen modal with a new seed |
| `error-class-timeout` | mock invoke rejects with `kind:'timeout'` | error modal shown; Retry button present |
| `error-class-schema-fail` | mock invoke resolves with garbage `manifestJson` | `parseCampaign` throws; error modal shown; copy mentions "validation"; Retry with fresh seed |
| `cancel-mid-flight` | mock invoke that never resolves; user clicks cancel | `cancelGeneration` invoked with the right jobId; generating modal closes; return to main menu |
| `safety-timer` | mock invoke that never resolves and doesn't honor cancel | UI escape happens at safety-window expiry; error modal shown with `timeout` class |

### 11.2 `src/platform.test.ts` (unit, vitest)

| Test | Scenario | Assertion |
|---|---|---|
| `detect-tauri` | `window.__TAURI_INTERNALS__` set | `isTauri() === true` |
| `detect-tauri-legacy` | only `window.__TAURI__` set | `isTauri() === true` |
| `detect-browser` | no markers | `isTauri() === false` |
| `detect-ssr` | no `window` | `isTauri() === false` |
| `handle-throws-outside-tauri` | browser mode | `tauriHandle()` rejects with `PlatformNotTauriError` |

### 11.3 `e2e/procgen.spec.ts` (Playwright)

Drives the full desktop flow with a Tauri bridge mock. The page is loaded with `page.addInitScript` that:

1. Sets `window.__TAURI_INTERNALS__ = {}`.
2. Stubs out the `@tauri-apps/api/core` dynamic import via a Vite intercept (or alternatively a `page.exposeBinding` shim).
3. The shim's `invoke` is a JS function that pattern-matches on the command name and returns canned promises configurable per-test.

Test scenarios (one per row from the IMPLEMENTATION_PLAN §1 matrix):

| Scenario | Setup | Steps | Assertion |
|---|---|---|---|
| **Tauri happy path** | `invoke('generate_campaign')` resolves with a small canned manifest (one act, one puzzle) | click New Campaign → fill seed → click Generate → wait | UI transitions to act_intro of the new campaign; `window.__campaign?.state()` shows `{ kind: 'act_intro', actIndex: 0 }` |
| **Tauri CLI errors (exit 1)** | `invoke` rejects with `{kind:'cli-exit', cliExitCode:1, message:'oops'}` | same | error modal shown; body contains "internal error"; Retry button present |
| **Tauri CLI hangs** | `invoke` returns a promise that never resolves; mocked `setTimeout` advances by 5 min | start gen → wait | safety timer fires; error modal shown; `cancelGeneration` was called |
| **Tauri CLI returns garbage** | `invoke` resolves with `manifestJson: '{"not":"a campaign"}'` | start gen → wait | error modal "validation failed"; Retry with fresh seed |
| **Tauri cancellation** | `invoke` returns a slow-resolving promise; user clicks Cancel | start gen → click Cancel | `cancelGeneration` called; back to main menu |
| **Browser fallback** | no Tauri marker set; instead use the real `<input type="file">` via `setInputFiles` | click New Campaign → see fallback modal → upload a known-good manifest | UI transitions to act_intro |
| **Browser fallback with bad file** | upload a JSON that fails Zod | click New Campaign → upload | error modal "validation failed" |

The shim is intentionally minimal — it replaces only `invoke` and `listen`. Production code never knows it's mocked; the harness's call sites are identical.

### 11.4 `src/__tests__/no-tauri-static-import.test.ts` (static-analysis canary)

```ts
test('no static import of @tauri-apps/* in shared code', async () => {
  const sources = await glob('src/**/*.ts', { ignore: ['src/platform.ts', '**/__tests__/**'] });
  for (const path of sources) {
    const text = await readFile(path, 'utf8');
    expect(text).not.toMatch(/^\s*import .* from '@tauri-apps\//m);
  }
});
```

This is the reviewer-checked invariant from §2.3.

### 11.5 `src-tauri/src/__tests__/` (Rust unit tests)

A small Rust test suite under `#[cfg(test)]`:

| Test | Assertion |
|---|---|
| `argv_construction` | Given a `GenerateOpts` with all fields, the constructed argv has the expected flag/value pairs in the expected order |
| `argv_no_shell` | Static-analysis grep (via `cargo test` against source files) for `Command::new("sh"`, `"/bin/sh"`, `"cmd.exe"`, etc. — zero matches |
| `sanitize_stderr_strips_ansi` | Input with `\x1b[31m` → output without |
| `sanitize_stderr_strips_control_chars` | Input with bell, null bytes → cleaned |
| `sanitize_stderr_caps_length` | Input > 1 KB → truncated with marker |
| `timeout_kills_child` | Spawn `sleep 10` with 1 s timeout → child killed, error returned |

### 11.6 Live integration (manual, not CI)

Documented in the Phase 11 manual checkpoint: "hit New Campaign on a clean profile; play for 30+ minutes; note any seams that feel rough." Results filed in `docs/playtest/procgen-first-pass.md`. This is the "five generated campaigns" smoke equivalent from cli.md §15.

---

## 12. File layout

```
src/
├── platform.ts                            # NEW — §2
├── campaign/
│   ├── procgen/                           # NEW directory for Phase 11 surface
│   │   ├── api.ts                         # TS bindings for Tauri commands
│   │   └── hints.ts                       # computeHintsFromLibrary
│   ├── dom/
│   │   ├── newCampaignButton.ts           # NEW — mounts onto main menu
│   │   ├── newCampaignModal.ts            # NEW — pre-gen + generating modals
│   │   ├── errorModal.ts                  # NEW — per-class error UX
│   │   └── harness.ts                     # MODIFIED — adds loadGeneratedManifest + new-campaign button
│   ├── saves.ts                           # MODIFIED — additive sourcePath field on LibraryEntry
│   └── __tests__/
│       ├── newCampaign.test.ts            # NEW — unit tests for the integration
│       └── persistence.test.ts            # MODIFIED — covers sourcePath round-trip
├── __tests__/
│   └── no-tauri-static-import.test.ts     # NEW — static-analysis canary
└── platform.test.ts                       # NEW
src-tauri/                                  # NEW — scaffolded by tauri init
├── Cargo.toml                              # generated by scaffold
├── tauri.conf.json                         # generated; modified to include bundle.resources
├── build.rs
├── src/
│   ├── main.rs                             # generated; modified to register the three commands
│   ├── commands.rs                         # NEW — the three command implementations
│   ├── sanitize.rs                         # NEW — sanitize_stderr
│   └── __tests__/                          # (optional convention; Rust tests usually inline)
e2e/
└── procgen.spec.ts                        # NEW
docs/
├── architecture/
│   └── procgen-integration.md             # this file
└── playtest/
    └── procgen-first-pass.md              # written manually after the playtest
```

Modified files outside this list: `src/main.ts` (none, actually — the harness owns the button mount), `package.json` (adds `@tauri-apps/cli` to `devDependencies`, `@tauri-apps/api` to `dependencies`; adds `tauri:dev`, `tauri:build` scripts).

---

## 13. Open questions / decisions made

Calls where the spec is silent or admits multiple reasonable answers. Recommended defaults in bold; flag only if you disagree.

**Q1. Where does the Rust side resolve the bundled CLI binary in production builds?**
- **(a) Tauri's `resource_dir()`, with `bin/` and `dist-cli/` declared under `tauri.conf.json#bundle.resources`.** Recommended. Standard Tauri pattern; the resources are copied into the bundle and resolved at runtime.
- (b) `sidecar` (Tauri's external-binary feature): bundles `throughline-gen` as a sidecar. More complex; intended for sidecars that aren't Node scripts.

**Q2. Should the manifest path be configurable by the user via the pre-gen modal?**
- **(a) No.** Recommended. The path lives in the app data dir; the user doesn't see it. Reduces decisions in the modal.
- (b) Yes — show a "Save to:" field. Adds another path-safety surface (the CLI's `--out` would receive user input).

**Q3. Does the New Campaign button appear before or after the tutorial is completed? — RESOLVED: always visible.**
- **(a) Before — always visible.** *Locked in.* Simpler UI; modal copy guides the user. The tutorial outro's existing "you are sent into the field" line *mentions* the New Campaign button but visibility is unconditional. The design doc Phase 9 "unlocks" line is interpreted as narrative framing rather than a literal gate.
- (b) Gated until tutorial completion. Not taken.

**Q4. Do we keep the generating modal's progress as just an elapsed counter, or expose CLI sub-phases?**
- **(a) Elapsed counter only.** Recommended for v1. The CLI's internal phases (build prompt / spawn / validate / solver / write) aren't exposed over IPC; adding that machinery is churn.
- (b) Parse CLI verbose stdout / stderr for phase markers. Adds a new IPC contract between CLI and Rust; defers to a future phase.

**Q5. What's the safety-timer margin over the Rust-side timeout?**
- **(a) 30 s.** Recommended. Enough for IPC drain on slow systems.
- (b) 5 s. Tighter; risks racing the Rust-side error response.

**Q6. Where does the LibraryEntry `sourcePath` field get its absolute path from — Rust or TS?**
- **(a) Rust returns the absolute path in `GenerateOk.path`; TS stores it verbatim.** Recommended. Rust is the only side that knows the app data dir's absolute resolution.
- (b) Both sides compute it independently. Risks divergence.

**Q7. Cancel semantics: does the Rust side delete the in-flight manifest file?**
- **(a) No — Rust just kills the child; any half-written file is the CLI writer's atomic-rename responsibility.** Recommended. The CLI's atomic writer (cli.md §8.3) deletes its own tmp file on failure; the target file never appears.
- (b) Rust does best-effort `unlink` of the target path on cancel. Defense in depth; harmless but redundant.

**Q8. Should the pre-gen modal expose `--time-budget-per-puzzle` and `--llm-timeout-ms`?**
- **(a) No.** Recommended. Advanced flags; clutter for the common case.
- (b) Yes, behind an "Advanced" disclosure. Optional polish; consider in Phase 12.

**Q9. Does Phase 11 add `node` as a Tauri sidecar (bundled binary) or rely on user-installed Node? — RESOLVED: rely on user-installed Node.**
- **(a) Rely on user-installed Node ≥ 20.** *Locked in.* The desktop app expects `node` on PATH; the README documents it; the `BinaryNotFound` modal copy points at the install docs when it's missing. Saves ~50 MB bundle weight + the sidecar build complexity. Phase 12 can revisit if installation friction proves to be a real problem.
- (b) Bundle Node as a sidecar. Deferred to a possible Phase 12 followup if needed.

**Q10. Should the browser fallback's file picker also display a "drag-and-drop" zone?**
- **(a) Just the button.** Recommended for v1.
- (b) Drop zone. Polish; out of scope.

**Q11. Should `cancel_generation` block until the child has exited, or return immediately?**
- **(a) Return immediately after sending `kill()`.** Recommended. The frontend doesn't need to wait. The child's `wait` in the generation command resolves with `Cancelled`, which is the source of truth.
- (b) Block on `wait`. Cleaner semantics but blocks IPC on slow process death.

---

## 14. What this phase does NOT do

Out of scope for Phase 11 (each lands later or never):

- A library / browse UI for previously-generated campaigns beyond what Phase 7 already provides. Phase 7's library list already displays entries; Phase 11 just adds new entries to it.
- Editing or regenerating an existing campaign. "Give me a different one" is a fresh-seed re-run from the menu.
- Sharing or publishing generated campaigns. Out of scope per design doc §12.
- Bundling Node as a desktop sidecar. Deferred (Q9 decision).
- Real-time progress phases from the CLI (current/of-N puzzles being generated). Out of scope (Q4 decision).
- A "wizard" mode that asks the player a few questions ("what mood?", "what setting?") and translates to seed/avoid-themes. Out of scope; the auto-derived avoidThemes is the v1 implementation of that idea.
- Sandboxing or restricting the `claude -p` subprocess beyond Phase 10's existing discipline. The Rust→Node→`claude` chain inherits the user's privileges; `claude` itself is the trust anchor for LLM calls.

---

## 15. Definition of done for Phase 11

Coder advances only when:

1. All unit tests in `src/campaign/__tests__/newCampaign.test.ts`, `src/platform.test.ts`, and `src/__tests__/no-tauri-static-import.test.ts` pass.
2. The Playwright e2e at `e2e/procgen.spec.ts` passes locally with the Tauri-bridge mock.
3. The static-analysis canary fails when (in a scratch branch) someone adds a static `import from '@tauri-apps/'` outside `src/platform.ts`. The reviewer verifies this manually.
4. The Rust unit tests (`cargo test` in `src-tauri/`) pass — including the argv-construction, sanitization, and timeout tests.
5. `npm run tauri dev` launches the app on the developer's machine and the happy path produces a played-through campaign (manual checkpoint).
6. One full end-to-end manual playthrough of a generated campaign is filed in `docs/playtest/procgen-first-pass.md`.
7. Reviewer checklist (verbatim from IMPLEMENTATION_PLAN §Phase 11) signed off in `docs/reviews/phase-11.md`. Every item cross-references to a test or a documented file.

---

## 16. Critical invariants the reviewer must check

A condensed restatement of the invariants the reviewer focuses on, per IMPLEMENTATION_PLAN §Phase 11 Reviewer:

- **Each failure mode has an automated test** (the §11 matrix above).
- **Spinners are always cancellable.** The Cancel button and safety timer are both verified in tests.
- **Stderr is sanitized before display.** Verified by Rust unit tests; defense-in-depth verified by the textContent render path.
- **Browser fallback works end-to-end.** The Playwright fallback test loads a manifest via the file picker and plays one puzzle to victory.
- **No code path assumes Tauri exists at module-load time.** Verified by the static-analysis canary.
- **The Rust spawn has no shell.** Verified by the Rust grep canary and by Cargo test scrutiny.
- **The manifest passes `parseCampaign` before any game code touches it.** Verified by the "Tauri CLI returns garbage" Playwright test.
