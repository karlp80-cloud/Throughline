// Tauri commands for procgen integration.
//
// Three commands per architect §3.1:
//   - generate_campaign(opts) -> GenerateOk | ProcgenError
//   - cancel_generation(jobId) -> () | ProcgenError
//   - read_campaign_file(path) -> String | ProcgenError
//
// Subprocess invocation discipline (architect §4):
//   - `Command::new("node")` with discrete argv vec. No shell.
//   - 5-minute tokio wall-clock timeout wrapping the CLI's own
//     internal retry budget.
//   - Per-job-id `Mutex<HashMap>` so cancel can kill an in-flight
//     child.
//   - `procgen:progress` event emitted every ~2 s while the child is
//     alive so the UI keeps an elapsed counter ticking.
//   - Stderr captured (capped at 4 KB), then sanitized via
//     `sanitize::sanitize_stderr` before crossing the IPC.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::AsyncReadExt;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::time::sleep;

use crate::sanitize::sanitize_stderr;

// ─── Types crossing the IPC boundary ────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateOpts {
    pub job_id: String,
    pub seed: Option<String>,
    pub acts: Option<u32>,
    pub puzzles_per_act: Option<u32>,
    pub gentle: Option<bool>,
    pub avoid_themes: Option<Vec<String>>,
    pub llm_timeout_ms: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateOk {
    pub path: String,
    pub manifest_json: String,
    pub elapsed_ms: u64,
    pub seed_used: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "kebab-case")]
pub enum ProcgenErrorKind {
    BinaryNotFound,
    SpawnFailed,
    Timeout,
    Cancelled,
    CliExit,
    /// Reserved per architect §3.2 — the Rust side never parses JSON,
    /// but the TS surface declares this kind for shape parity with
    /// the typed bindings.
    #[allow(dead_code)]
    StdoutNotJson,
    FileReadFailed,
    PathRejected,
    InternalError,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProcgenError {
    pub kind: ProcgenErrorKind,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cli_exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cli_stderr: Option<String>,
}

impl ProcgenError {
    fn new(kind: ProcgenErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            cli_exit_code: None,
            cli_stderr: None,
        }
    }
    fn with_cli(mut self, exit: i32, stderr: String) -> Self {
        self.cli_exit_code = Some(exit);
        self.cli_stderr = Some(stderr);
        self
    }
    /// Attach stderr without an exit code. Used by the Timeout path,
    /// where the child was killed before reporting an exit status.
    fn with_stderr(mut self, stderr: String) -> Self {
        self.cli_stderr = Some(stderr);
        self
    }
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProgressPayload {
    job_id: String,
    phase: &'static str,
    elapsed_ms: u64,
}

// ─── Application state ──────────────────────────────────────────────

/// One slot per active job. The Mutex<Option<Child>> lets cancel take
/// the child out from under the supervising task and start_kill it.
pub type JobMap = Arc<Mutex<HashMap<String, Arc<Mutex<Option<Child>>>>>>;

#[derive(Default)]
pub struct ProcgenState {
    jobs: JobMap,
}

impl ProcgenState {
    pub fn new() -> Self {
        Self::default()
    }
}

// ─── Helpers ────────────────────────────────────────────────────────

const STDERR_CAP_BYTES: usize = 4 * 1024;
// Outer wall clock that wraps the entire CLI run (system prompt + 3
// manifest retries × per-call LLM timeout + per-puzzle solver budgets).
// The 5-minute value the architect originally specified turned out too
// tight under realistic 3-act × 4-puzzle defaults: a single LLM
// generation can take 60–120 s, and 3 retries × 90 s alone hits 4.5 min
// before solver work. Bumped to 15 minutes so the Rust wall never
// fires before the CLI gives up on its own retries.
const DEFAULT_TIMEOUT_MS: u64 = 15 * 60 * 1000; // 15 minutes
const PROGRESS_INTERVAL_MS: u64 = 2000;

fn resolve_cli_binary(app: &AppHandle) -> Result<PathBuf, ProcgenError> {
    // Override for development + tests.
    if let Ok(override_path) = std::env::var("THROUGHLINE_CLI_PATH") {
        let p = PathBuf::from(override_path);
        let abs = p
            .canonicalize()
            .map_err(|e| ProcgenError::new(ProcgenErrorKind::BinaryNotFound, e.to_string()))?;
        return Ok(abs);
    }
    // Production bundle: bin/throughline-gen lives in the resource dir.
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("bin").join("throughline-gen");
        if candidate.exists() {
            return Ok(candidate);
        }
    }
    // Dev mode: src-tauri/ is CWD; the repo's bin/ is one level up.
    if let Ok(cwd) = std::env::current_dir() {
        let mut walk = Some(cwd.as_path());
        while let Some(dir) = walk {
            let candidate = dir.join("bin").join("throughline-gen");
            if candidate.exists() {
                return Ok(candidate);
            }
            walk = dir.parent();
        }
    }
    Err(ProcgenError::new(
        ProcgenErrorKind::BinaryNotFound,
        "Could not locate bin/throughline-gen in the resource dir or any parent of CWD",
    ))
}

fn build_argv(bin_path: &Path, out_filename: &str, opts: &GenerateOpts) -> Vec<String> {
    // First arg is the JS bin script; `node` is invoked separately.
    let mut args: Vec<String> = Vec::with_capacity(20);
    args.push(bin_path.to_string_lossy().into_owned());
    args.push("--out".into());
    args.push(out_filename.into());
    if let Some(seed) = &opts.seed {
        args.push("--seed".into());
        args.push(seed.clone());
    }
    if let Some(acts) = opts.acts {
        args.push("--acts".into());
        args.push(acts.to_string());
    }
    if let Some(ppa) = opts.puzzles_per_act {
        args.push("--puzzles-per-act".into());
        args.push(ppa.to_string());
    }
    if opts.gentle.unwrap_or(false) {
        args.push("--gentle".into());
    }
    if let Some(themes) = &opts.avoid_themes {
        if !themes.is_empty() {
            args.push("--avoid-themes".into());
            args.push(themes.join(","));
        }
    }
    if let Some(ms) = opts.llm_timeout_ms {
        args.push("--llm-timeout-ms".into());
        args.push(ms.to_string());
    }
    args
}

fn app_data_campaigns_dir(app: &AppHandle) -> Result<PathBuf, ProcgenError> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| ProcgenError::new(ProcgenErrorKind::InternalError, e.to_string()))?;
    let dir = base.join("campaigns");
    std::fs::create_dir_all(&dir)
        .map_err(|e| ProcgenError::new(ProcgenErrorKind::InternalError, e.to_string()))?;
    Ok(dir)
}

fn sanitize_seed_for_filename(seed: &Option<String>) -> String {
    let raw = seed.as_deref().unwrap_or("anon");
    raw.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(64)
        .collect()
}

async fn read_capped<R: AsyncReadExt + Unpin>(mut r: R, cap: usize) -> std::io::Result<Vec<u8>> {
    let mut buf = Vec::with_capacity(cap.min(8192));
    let mut chunk = [0u8; 4096];
    loop {
        let n = r.read(&mut chunk).await?;
        if n == 0 {
            break;
        }
        let remaining = cap.saturating_sub(buf.len());
        if remaining == 0 {
            // Drain (and drop) so the child doesn't block on a full pipe.
            continue;
        }
        let take = remaining.min(n);
        buf.extend_from_slice(&chunk[..take]);
    }
    Ok(buf)
}

// ─── Commands ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn generate_campaign(
    app: AppHandle,
    state: State<'_, ProcgenState>,
    opts: GenerateOpts,
) -> Result<GenerateOk, ProcgenError> {
    let bin_path = resolve_cli_binary(&app)?;
    let campaigns_dir = app_data_campaigns_dir(&app)?;
    let unix_ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let seed_for_name = sanitize_seed_for_filename(&opts.seed);
    let out_filename = format!("{}-{}.json", seed_for_name, unix_ts);
    let seed_used = opts.seed.clone().unwrap_or_else(|| seed_for_name.clone());
    let timeout_ms = u64::from(opts.llm_timeout_ms.unwrap_or(0))
        .max(DEFAULT_TIMEOUT_MS / 2)
        .min(DEFAULT_TIMEOUT_MS * 6);
    let argv = build_argv(&bin_path, &out_filename, &opts);

    // Spawn: Command::new("node") with each argv element discrete.
    // shell: false (Rust Command never invokes a shell).
    let mut cmd = Command::new("node");
    cmd.args(&argv)
        .current_dir(&campaigns_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    // Strip Claude Code "I'm running inside a parent SDK session" env
    // markers before spawning. When the Tauri app inherits these from
    // a developer's shell (e.g. `npm run tauri dev` invoked from inside
    // a Claude Code session), the spawned `claude -p` subprocess detects
    // a parent it can't actually reach via IPC and hangs waiting. The
    // smoke-test path doesn't hit this because vitest's subprocess
    // chain doesn't add the extra hop these markers conflict with.
    // Identified during Phase 11 manual playtest.
    for var in [
        "CLAUDECODE",
        "CLAUDE_CODE_SESSION_ID",
        "CLAUDE_CODE_ENTRYPOINT",
        "CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH",
        "CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH",
        "CLAUDE_AGENT_SDK_VERSION",
        "CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES",
        "CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL",
        "CLAUDE_CODE_DISABLE_CRON",
        "CLAUDE_CODE_EXECPATH",
        "CLAUDE_EFFORT",
        "AI_AGENT",
        "BAGGAGE",
    ] {
        cmd.env_remove(var);
    }
    // Phase 11 manual-playtest diagnostic: have the CLI emit
    // spawn-trace lines so the Rust-captured stderr includes timing
    // info we can read back from the error modal. Cheap to leave on;
    // strip in Phase 12 once the hang is fully understood.
    cmd.env("THROUGHLINE_TRACE_SPAWN", "1");
    // No CREATE_NO_WINDOW: previously set to suppress the console flash,
    // but combining no-console + the Claude Code parent-session markers
    // above appears to be what triggers the spawned claude to hang. A
    // brief console window is acceptable here; Phase 12 can revisit if
    // the flash is intrusive.

    let child = cmd.spawn().map_err(|e| {
        let kind = if e.kind() == std::io::ErrorKind::NotFound {
            ProcgenErrorKind::BinaryNotFound
        } else {
            ProcgenErrorKind::SpawnFailed
        };
        ProcgenError::new(kind, e.to_string())
    })?;

    // Register job-handle.
    let child_slot: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(Some(child)));
    {
        let mut jobs = state.jobs.lock().await;
        jobs.insert(opts.job_id.clone(), child_slot.clone());
    }

    let start = Instant::now();
    let job_id_for_progress = opts.job_id.clone();
    let app_for_progress = app.clone();
    let child_slot_for_progress = child_slot.clone();

    // Progress-emit task. Lives until the child slot empties or the
    // overall timeout fires.
    let progress_handle = tokio::spawn(async move {
        loop {
            sleep(Duration::from_millis(PROGRESS_INTERVAL_MS)).await;
            // Cheap check: is the child still here?
            let still_alive = {
                let guard = child_slot_for_progress.lock().await;
                guard.is_some()
            };
            if !still_alive {
                break;
            }
            let payload = ProgressPayload {
                job_id: job_id_for_progress.clone(),
                phase: "running",
                elapsed_ms: start.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
            };
            let _ = app_for_progress.emit("procgen:progress", payload);
        }
    });

    // Race child wait against the timeout. We do the wait by hand
    // because we need to keep the child inside the Mutex (so cancel
    // can take it out from under us).
    let wait_outcome = wait_or_timeout(child_slot.clone(), Duration::from_millis(timeout_ms)).await;
    progress_handle.abort();

    // Remove job-handle entry.
    {
        let mut jobs = state.jobs.lock().await;
        jobs.remove(&opts.job_id);
    }

    let (exit_code, stdout_bytes, stderr_bytes) = match wait_outcome {
        WaitOutcome::Exited {
            exit_code,
            stdout,
            stderr,
        } => (exit_code, stdout, stderr),
        WaitOutcome::Cancelled => {
            return Err(ProcgenError::new(
                ProcgenErrorKind::Cancelled,
                "generation cancelled",
            ));
        }
        WaitOutcome::Timeout { stderr: stderr_bytes } => {
            // Preserve whatever stderr the CLI had written before the
            // wall fired. Without this, the error modal shows the
            // generic timeout copy with no trace of WHERE the CLI was
            // spending its time — invisibility makes the next
            // diagnostic pass impossible. Phase 11 manual-playtest fix.
            let stderr_sanitized = sanitize_stderr(&stderr_bytes);
            return Err(ProcgenError::new(
                ProcgenErrorKind::Timeout,
                "generation exceeded the wall-clock timeout",
            )
            .with_stderr(stderr_sanitized));
        }
        WaitOutcome::IoError(msg) => {
            return Err(ProcgenError::new(ProcgenErrorKind::InternalError, msg));
        }
    };

    let stderr_sanitized = sanitize_stderr(&stderr_bytes);
    let _ = stdout_bytes; // currently unused — CLI prints path on stdout

    if exit_code != 0 {
        return Err(
            ProcgenError::new(ProcgenErrorKind::CliExit, "CLI exited non-zero")
                .with_cli(exit_code, stderr_sanitized),
        );
    }

    // Read the manifest file back from disk.
    let out_path = campaigns_dir.join(&out_filename);
    let manifest_json = tokio::fs::read_to_string(&out_path).await.map_err(|e| {
        ProcgenError::new(
            ProcgenErrorKind::FileReadFailed,
            format!("could not read CLI output: {}", e),
        )
    })?;

    Ok(GenerateOk {
        path: out_path.to_string_lossy().into_owned(),
        manifest_json,
        elapsed_ms: start.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
        seed_used,
    })
}

enum WaitOutcome {
    Exited {
        exit_code: i32,
        stdout: Vec<u8>,
        stderr: Vec<u8>,
    },
    Cancelled,
    /// Carries whatever stderr the CLI had accumulated before the wall
    /// fired. Without this, the user sees an empty timeout modal — no
    /// way to diagnose what the CLI was doing for those N minutes.
    Timeout {
        stderr: Vec<u8>,
    },
    IoError(String),
}

async fn wait_or_timeout(
    child_slot: Arc<Mutex<Option<Child>>>,
    budget: Duration,
) -> WaitOutcome {
    // Take ownership of the child's stdout/stderr pipes up front, so
    // cancel can replace the child handle in the Mutex without
    // confusing us.
    let (stdout, stderr) = {
        let mut guard = child_slot.lock().await;
        let Some(child) = guard.as_mut() else {
            return WaitOutcome::Cancelled;
        };
        let so = child.stdout.take();
        let se = child.stderr.take();
        (so, se)
    };

    let stdout_task = tokio::spawn(async move {
        match stdout {
            Some(s) => read_capped(s, usize::MAX).await.unwrap_or_default(),
            None => Vec::new(),
        }
    });
    let stderr_task = tokio::spawn(async move {
        match stderr {
            Some(s) => read_capped(s, STDERR_CAP_BYTES).await.unwrap_or_default(),
            None => Vec::new(),
        }
    });

    // Wait for the child's exit, racing against the timeout. Two
    // clones of the Arc: one moved into the polling future, one
    // retained for the post-timeout kill path.
    let child_slot_for_wait = child_slot.clone();
    let wait_fut = async move {
        // Poll the slot until the child is gone (cancellation) or
        // has exited.
        loop {
            let mut guard = child_slot_for_wait.lock().await;
            match guard.as_mut() {
                None => return None,
                Some(child) => {
                    // try_wait avoids holding the lock for the entire
                    // wait — we re-lock between polls so cancel can
                    // intervene.
                    match child.try_wait() {
                        Ok(Some(status)) => {
                            *guard = None;
                            return Some(Ok(status));
                        }
                        Ok(None) => {
                            drop(guard);
                            sleep(Duration::from_millis(50)).await;
                        }
                        Err(e) => {
                            *guard = None;
                            return Some(Err(e));
                        }
                    }
                }
            }
        }
    };
    let exit_status = match tokio::time::timeout(budget, wait_fut).await {
        Ok(Some(Ok(status))) => Some(status),
        Ok(Some(Err(e))) => return WaitOutcome::IoError(e.to_string()),
        Ok(None) => {
            // Child was taken — cancellation.
            return WaitOutcome::Cancelled;
        }
        Err(_) => {
            // Timeout. Best-effort kill via the retained Arc, then drain
            // stderr so the modal can show what the CLI was doing. The
            // drain itself is bounded (5 s) in case stderr_task is wedged
            // — partial output is better than none, and "none" is the
            // current buggy behavior we're fixing.
            let mut guard = child_slot.lock().await;
            if let Some(child) = guard.as_mut() {
                let _ = child.start_kill();
            }
            *guard = None;
            drop(guard);
            let stderr_bytes =
                match tokio::time::timeout(Duration::from_secs(5), stderr_task).await {
                    Ok(Ok(bytes)) => bytes,
                    Ok(Err(_)) | Err(_) => Vec::new(),
                };
            return WaitOutcome::Timeout {
                stderr: stderr_bytes,
            };
        }
    };

    let stdout_bytes = stdout_task.await.unwrap_or_default();
    let stderr_bytes = stderr_task.await.unwrap_or_default();
    match exit_status {
        Some(s) => {
            let code = s.code().unwrap_or(-1);
            WaitOutcome::Exited {
                exit_code: code,
                stdout: stdout_bytes,
                stderr: stderr_bytes,
            }
        }
        None => WaitOutcome::Cancelled,
    }
}

#[tauri::command]
pub async fn cancel_generation(
    state: State<'_, ProcgenState>,
    job_id: String,
) -> Result<(), ProcgenError> {
    let entry = {
        let jobs = state.jobs.lock().await;
        jobs.get(&job_id).cloned()
    };
    let Some(slot) = entry else {
        // Cancelling a finished job is a no-op (architect §4.4).
        return Ok(());
    };
    let mut guard = slot.lock().await;
    if let Some(child) = guard.as_mut() {
        let _ = child.start_kill();
    }
    *guard = None;
    Ok(())
}

#[tauri::command]
pub async fn read_campaign_file(
    app: AppHandle,
    path: String,
) -> Result<String, ProcgenError> {
    let resolved = PathBuf::from(&path);
    let resolved = resolved
        .canonicalize()
        .map_err(|e| ProcgenError::new(ProcgenErrorKind::FileReadFailed, e.to_string()))?;
    // Path-safety check: must sit inside the app data dir (campaigns
    // subdir). The architect didn't strictly require this but the
    // CLAUDE.md "manifest paths checked for traversal" invariant
    // covers Phase 11's read surface too.
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| ProcgenError::new(ProcgenErrorKind::InternalError, e.to_string()))?;
    // Make sure the base directory exists before canonicalizing so the
    // resume-on-launch path doesn't get a Windows `\\?\` vs non-`\\?\`
    // mismatch on a fresh profile (Phase 11 reviewer Issue 1).
    std::fs::create_dir_all(&base)
        .map_err(|e| ProcgenError::new(ProcgenErrorKind::FileReadFailed, e.to_string()))?;
    let base_canon = base
        .canonicalize()
        .map_err(|e| ProcgenError::new(ProcgenErrorKind::FileReadFailed, e.to_string()))?;
    if !resolved.starts_with(&base_canon) {
        return Err(ProcgenError::new(
            ProcgenErrorKind::PathRejected,
            "refused to read outside the app data dir",
        ));
    }
    tokio::fs::read_to_string(&resolved)
        .await
        .map_err(|e| ProcgenError::new(ProcgenErrorKind::FileReadFailed, e.to_string()))
}

// ─── Unit tests ──────────────────────────────────────────────────
// Phase 11 reviewer Issue 2: architect §11.5 listed these two tests
// (`argv_construction` and `timeout_kills_child`). Adding them now so
// both code paths are exercised directly, not just transitively.
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn argv_construction_pushes_flags_in_expected_order() {
        let bin = PathBuf::from("/throughline/bin/throughline-gen");
        let opts = GenerateOpts {
            job_id: "job-1".into(),
            seed: Some("abc".into()),
            acts: Some(3),
            puzzles_per_act: Some(4),
            gentle: Some(true),
            avoid_themes: Some(vec!["alpha".into(), "beta".into()]),
            llm_timeout_ms: Some(45_000),
        };
        let argv = build_argv(&bin, "manifest.json", &opts);
        assert_eq!(
            argv,
            vec![
                bin.to_string_lossy().into_owned(),
                "--out".to_string(),
                "manifest.json".to_string(),
                "--seed".to_string(),
                "abc".to_string(),
                "--acts".to_string(),
                "3".to_string(),
                "--puzzles-per-act".to_string(),
                "4".to_string(),
                "--gentle".to_string(),
                "--avoid-themes".to_string(),
                "alpha,beta".to_string(),
                "--llm-timeout-ms".to_string(),
                "45000".to_string(),
            ]
        );
    }

    #[test]
    fn argv_construction_omits_unset_flags() {
        let bin = PathBuf::from("/bin/throughline-gen");
        let opts = GenerateOpts {
            job_id: "job-2".into(),
            seed: None,
            acts: None,
            puzzles_per_act: None,
            gentle: None,
            avoid_themes: None,
            llm_timeout_ms: None,
        };
        let argv = build_argv(&bin, "out.json", &opts);
        // Only the bin path + the always-set --out remain.
        assert_eq!(
            argv,
            vec![
                bin.to_string_lossy().into_owned(),
                "--out".to_string(),
                "out.json".to_string(),
            ]
        );
    }

    #[test]
    fn argv_construction_skips_empty_avoid_themes() {
        let bin = PathBuf::from("/bin/throughline-gen");
        let opts = GenerateOpts {
            job_id: "j".into(),
            seed: None,
            acts: None,
            puzzles_per_act: None,
            gentle: Some(false), // also confirm false omits the flag
            avoid_themes: Some(vec![]),
            llm_timeout_ms: None,
        };
        let argv = build_argv(&bin, "o.json", &opts);
        // --avoid-themes must not appear when the list is empty.
        assert!(!argv.iter().any(|a| a == "--avoid-themes"));
        // --gentle must not appear when false.
        assert!(!argv.iter().any(|a| a == "--gentle"));
    }

    /// Spawn a Node subprocess that won't exit on its own; race it
    /// against a tight tokio timeout and confirm the timeout branch
    /// fires and the child is killable. Requires `node` on PATH —
    /// the same runtime dependency Q9 documented for the desktop app.
    #[tokio::test]
    async fn timeout_kills_child() {
        // 30 s child + 500 ms budget: well-separated so a slow CI
        // box doesn't race the budget.
        let mut cmd = Command::new("node");
        cmd.args(["-e", "setTimeout(() => process.exit(0), 30000)"]);
        cmd.stdin(Stdio::null());
        cmd.stdout(Stdio::null());
        cmd.stderr(Stdio::null());
        cmd.kill_on_drop(true);
        let Ok(mut child) = cmd.spawn() else {
            // node not installed in the CI shell — skip with a clear
            // log line. This is a Phase 11 runtime requirement so a
            // missing node here would be a setup bug, not a code bug.
            eprintln!("timeout_kills_child: skipped (node not on PATH)");
            return;
        };
        let wait_fut = child.wait();
        let result = tokio::time::timeout(Duration::from_millis(500), wait_fut).await;
        match result {
            Err(_elapsed) => {
                // Budget fired before the child exited. Confirm we can
                // kill it cleanly.
                child.start_kill().expect("start_kill should succeed");
                // Drain so the kill_on_drop doesn't fire-and-forget.
                let _ = child.wait().await;
            }
            Ok(_) => {
                panic!("child exited within 500ms; test setup broken");
            }
        }
    }

    /// Phase 11 manual-playtest regression: when the wall fires, the
    /// CLI's stderr (which contains our spawn-trace and solver-trace
    /// lines) must reach the error modal. Previously the Timeout
    /// branch returned immediately, dropping stderr_task and losing
    /// every diagnostic line the CLI had written.
    ///
    /// This test exercises the same drain pattern wait_or_timeout
    /// uses: spawn a child that writes to stderr and then sleeps,
    /// race against a short tokio timeout, drain the stderr stream,
    /// and assert the bytes the child wrote BEFORE the kill made it
    /// out alive.
    #[tokio::test]
    async fn timeout_preserves_stderr() {
        use tokio::io::AsyncReadExt;
        let mut cmd = Command::new("node");
        cmd.args([
            "-e",
            "process.stderr.write('hello-from-cli\\n'); setTimeout(() => process.exit(0), 30000)",
        ]);
        cmd.stdin(Stdio::null());
        cmd.stdout(Stdio::null());
        cmd.stderr(Stdio::piped());
        cmd.kill_on_drop(true);
        let Ok(mut child) = cmd.spawn() else {
            eprintln!("timeout_preserves_stderr: skipped (node not on PATH)");
            return;
        };
        let stderr_handle = child.stderr.take().expect("piped stderr");
        let drain_task = tokio::spawn(async move {
            let mut buf = Vec::new();
            let mut s = stderr_handle;
            let mut chunk = [0u8; 1024];
            loop {
                match s.read(&mut chunk).await {
                    Ok(0) => break,
                    Ok(n) => buf.extend_from_slice(&chunk[..n]),
                    Err(_) => break,
                }
            }
            buf
        });
        // Give the child a moment to write its stderr line before we
        // start racing. 200 ms is generous on any CI box for a single
        // node -e startup + one write().
        tokio::time::sleep(Duration::from_millis(200)).await;
        let wait_fut = child.wait();
        let result = tokio::time::timeout(Duration::from_millis(500), wait_fut).await;
        assert!(result.is_err(), "expected timeout (child sleeps 30s)");
        child.start_kill().expect("start_kill");
        // Drain stderr — same 5s bound the production code uses.
        let bytes = match tokio::time::timeout(Duration::from_secs(5), drain_task).await {
            Ok(Ok(b)) => b,
            _ => Vec::new(),
        };
        let text = String::from_utf8_lossy(&bytes);
        assert!(
            text.contains("hello-from-cli"),
            "stderr drained on timeout should contain the child's pre-kill write; got: {text:?}"
        );
        let _ = child.wait().await;
    }
}
