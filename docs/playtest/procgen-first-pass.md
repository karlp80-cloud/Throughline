# Procgen first-pass playtest — karlp (sole tester)

**Status:** closed, **PASS-WITH-CAVEAT.** Phase 11 manual checkpoint shipped.
**Date:** 2026-05-27.
**Build:** Phase 11 wrap (commits `7a9a2ea`, `f2f8a6e`).

## What worked

End-to-end procgen pipeline functions. From a clean profile:

1. `npm run tauri dev` launches the desktop app.
2. Main menu shows the **New Campaign** button above the built-in list.
3. Click → pre-gen modal opens with seed, acts, puzzles-per-act, gentle.
4. Click Generate → progress modal with elapsed counter and Cancel.
5. Rust spawns `node bin/throughline-gen` (after stripping the
   `CLAUDE_CODE_*` parent-session env markers — see "What broke" below).
6. CLI spawns `claude -p` with the system prompt via argv, user prompt
   via stdin. Real LLM call.
7. Manifest comes back, `parseCampaign` validates, solver verifies,
   harness loads, transition to act_intro.

Verified working configurations:

| Acts × puzzles | Total | Outcome | Wall time |
|---|---|---|---|
| 1 × 1 | 1 | ✅ | ~30 s |
| 1 × 4 | 4 | ✅ | ~3 min |
| 2 × 2 | 4 | ✅ | ~3 min |
| 3 × 2 | 6 | ✅ | 7.5 min |
| 3 × 3 | 9 | ❌ | hits Rust wall (15 min) |
| 3 × 4 (default) | 12 | ❌ | hits Rust wall |

## What broke (and got fixed) during the playtest

Six issues surfaced and were addressed inline; all required commits.

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | "claude -p subprocess: timeout (exit null)" on first generation | CLI per-call timeout was 60 s (set in `cli/src/index.ts`); real Claude responses for full manifests take 60–120 s | Bumped CLI argv default to 180 s, matching `claudeSpawn.DEFAULT_TIMEOUT_MS`. Bumped Rust wall to 15 min and UI safety timer to 15:30 to stay above. Commit `deee697`. |
| 2 | Even after #1, claude hung indefinitely producing zero bytes | Tauri-spawned CLI inherited `CLAUDECODE=1`, `CLAUDE_CODE_SESSION_ID=…`, `CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH=1`, etc.; the spawned `claude -p` tried to attach to a parent SDK session that doesn't exist outside Claude Code | `commands.rs` now `env_remove`s 13 known markers before spawn. Also dropped `CREATE_NO_WINDOW` flag (combined with no-console parent, contributed to the hang). Commit `258a895`. |
| 3 | After #1 + #2, generation succeeds at small N but fails silently at 9+ puzzles | Cumulative work (LLM + solver per puzzle) hits the Rust 15-min wall | Not fixed in Phase 11. See "Carry-forward" below. |
| 4 | When the wall fires, modal shows "Try again" with no error log | `WaitOutcome::Timeout` returned without awaiting `stderr_task`; CLI's spawn-trace + solver-trace lines were discarded | `WaitOutcome::Timeout` now carries `stderr: Vec<u8>`; the timeout branch drains `stderr_task` (bounded 5 s); `ProcgenError::with_stderr` attaches to the resulting modal. New Rust test `timeout_preserves_stderr`. Commit `f2f8a6e`. |
| 5 | First-run resume could surface wrong error class on Windows | `read_campaign_file` did `base.canonicalize().unwrap_or(base)` — silent failure leaked the `\\?\` UNC mismatch | Now `create_dir_all` + canonicalize-or-fail with `FileReadFailed`. Commit `25c4bc6` (Phase 11 reviewer follow-up). |
| 6 | `[solver-trace]` lines wouldn't appear because static-import canary regex missed side-effect imports | Original regex required `from` keyword | Broadened to `^\s*import\b(.+\bfrom\s+)?['"]@tauri-apps\//m`. Commit `25c4bc6`. |

Plus diagnostic-only commits (kept; gated by `THROUGHLINE_TRACE_SPAWN=1` env var
set by Rust only — does NOT fire in the CLI's vitest smoke test):

- Spawn-trace lines in `cli/src/claudeSpawn.ts` capturing pre-spawn, PID,
  stdin write/end callbacks, first-stdout/stderr arrival times, timeout fires.
  Commit `2f3b77d`.
- `[solver-trace]` line in `cli/src/generator.ts` when a manifest validates
  but the solver rejects. Commit `7a9a2ea`.

## What didn't ship — known limitations

**The 12-puzzle default doesn't reliably work.** The pipeline is sound;
the bottleneck is cumulative wall time at ~75 s per puzzle (LLM + solver
combined). At 12 puzzles that's nominally 15 min, right at the Rust
wall, and any retry busts it.

For the playtest, 3×2 = 6 puzzles is the largest reliable config and
gives ~1.5–3 hours of play, covering the Phase 11 "30+ minutes" goal.

This matches the design doc §11 risk register ("tutorial → procgen
difficulty cliff"). The mitigation in §11 was a `--gentle` flag,
which is already wired (defaults to `true` for first-time generation)
but isn't enough on its own to clear the cliff.

## Carry-forward — procgen quality work for a post-Phase-12 polish round

1. **Re-examine the per-puzzle solver budget.** Currently 30 s. Halving
   it might let the LLM regenerate harder puzzles faster, since solver
   exhaustion currently dominates the wall time.

2. **Tune `cli/src/prompts/system.md`** — bias the LLM toward sparser
   puzzles when `--gentle` is set (lower `max_tiles`, larger grids,
   shorter `available_tiles`).

3. **Smarter solver heuristics.** Current implementation is random
   restarts with connectivity bias (per cli.md §6.4). A proper A*
   search over tile placements would be a real engineering project
   but would crack puzzles the random walk can't.

4. **Drop the default puzzle count.** Until the above ship, the modal's
   default could honestly be 3×2 = 6 puzzles. The "3×4 = 12 puzzles
   = 3-6 hours" line in the design doc DoD is aspirational, not yet
   delivered.

## Carried forward to Phase 12

- Validate `tauri.conf.json#bundle.resources` against an actual `tauri build`
  (Phase 11 verified `cargo build` works; full bundling step is Phase 12's job).

## Limitations of this pass

- **Single tester.** Same caveat as the tutorial playtest: no fresh
  eyes, no think-aloud, builder-as-tester bias.
- **Did not play a full 30 min of the 3×2 generated campaign.** The
  pipeline-validation portion of the manual checkpoint succeeded;
  the in-game playthrough portion was deferred. A future pass should
  generate a 3×2 campaign and actually play it to the end to surface
  any in-game procgen quality issues (reactor recipes that don't
  flow, glyph collisions, narrative tone problems, etc.).
