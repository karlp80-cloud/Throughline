# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Throughline** — a Zachtronic-style flow-routing puzzle game whose mechanics are fixed but whose themes, narrative, and puzzle layouts are LLM-generated per campaign. Two artifacts: a TypeScript/Canvas game (browser + Tauri desktop) and a Node CLI (`throughline-gen`) that produces `campaign.json` manifests via `claude -p`.

## Required reading, in order

1. [throughline-design.md](throughline-design.md) — vision, architecture, DSL schema, phased build plan. Source of truth for all design decisions.
2. [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) — the executable plan for delivering the design across phases 0–12.

## Current phase

**Phases 0–11 complete; Phase 11 reviewer-approved.** Origin: https://github.com/karlp80-cloud/Throughline.

Phase 11 added the Tauri desktop scaffold + procgen flow that ties the Phase 10 CLI to the game. The wiring is:

- **`src-tauri/`** — Tauri 2.x scaffold (`npx tauri init`). Identifier `org.throughline.app`. Three commands in `commands.rs`:
  - `generate_campaign(opts)` — spawns `Command::new("node")` (no shell) with discrete argv; 5-min tokio timeout; emits `procgen:progress` heartbeats every 2 s; per-job `Mutex<HashMap>` for cancel.
  - `cancel_generation(jobId)` — non-blocking `start_kill()`; cancelling a finished job is a no-op.
  - `read_campaign_file(path)` — canonicalize + reject outside the app data dir.
  - `sanitize.rs` — hand-rolled ANSI/control-char scrubber + 1 KB display cap (no `regex` dep).
  - `no_shell_test.rs` — Rust-side static-analysis canary mirroring `cli/src/__tests__/no-shell.test.ts`.
- **`src/platform.ts`** — the only file in shared code that knows Tauri exists. `detectPlatform()` / `isTauri()` synchronous + memoized; `tauriHandle()` dynamic-imports `@tauri-apps/api/{core,event}` on first call. `src/__tests__/no-tauri-static-import.test.ts` enforces the discipline.
- **`src/campaign/procgen/`** — `api.ts` (TS bindings for the three Rust commands), `hints.ts` (LibraryIndex → `--avoid-themes` + `--gentle`), `flow.ts` (composes the pre-gen modal + browser fallback into the harness's `NewCampaignFlowDeps`).
- **`src/campaign/dom/`** — `newCampaignButton.ts` (data-role="new-campaign", always visible — Q3), `newCampaignModal.ts` (form + generating view + 5:30 safety timer), `browserFallback.ts` (file picker + parseCampaign), `errorModal.ts` (per-class copy + button set, stderr via `textContent`).
- **Harness extension** (`src/campaign/dom/harness.ts`) — new methods `loadGeneratedManifest(json, sourcePath, seedUsed)` and `loadCampaignFromSourcePath(path, seed, reader)`; the reducer stays pure. The main menu now also renders a "Generated campaigns" section listing every procgen LibraryEntry with a Resume/Remove pair.
- **`LibraryEntry.sourcePath`** — additive optional string field; no `LIBRARY_VERSION` bump. Built-ins omit it; procgen entries carry the absolute on-disk path so the harness can resume on relaunch.
- **`tauri.conf.json#bundle.resources`** — ships `bin/throughline-gen` + `dist-cli/**/*` with the desktop build.

The Rust→Node→`claude` chain inherits the user's privileges; `claude` is the trust anchor for LLM calls (Q9 resolved: no Node sidecar — desktop expects `node` on PATH; `BinaryNotFound` modal points at the install docs when it's missing).

**Tauri requirement note:** the desktop build requires the Rust toolchain (`rustup`) and Tauri 2.x system prerequisites (MSVC build tools + WebView2 on Win10+). Browser build (`npm run dev`, `npm run build`) has zero Rust dependency.

**Tally:** 574 unit (+62 from Phase 11) + 21 e2e (+6 procgen). Tsc + lint clean. 1 unit test skipped on Windows (symlink test — symlink creation needs admin). Cargo: 13 Rust tests pass (+4 from reviewer follow-up: 3× argv construction + 1× timeout_kills_child). Live-LLM integration test gated by `RUN_LIVE_LLM=1`, never runs in CI.

Phase 10 reviewer verdict: **PASS-WITH-NOTES**; full report in [docs/reviews/phase-10.md](docs/reviews/phase-10.md).
Phase 11 reviewer verdict: **PASS-WITH-NOTES**; full report in [docs/reviews/phase-11.md](docs/reviews/phase-11.md). Three low-severity items addressed in wrap-up commit:
- `commands.rs` `read_campaign_file` now creates the app-data dir before canonicalizing (fixes a first-run Windows UNC-prefix edge case).
- `commands.rs` adds 4 new `#[cfg(test)]` tests: 3× argv-construction + 1× timeout_kills_child. Rust suite now 13 tests.
- `no-tauri-static-import.test.ts` regex broadened to also catch side-effect imports (`import '@tauri-apps/...'`).

Phase 12 inherits one carryover: validate `tauri.conf.json#bundle.resources` against an actual `tauri build` (Phase 11 verified `cargo build`; bundling step deferred).

Phase 9 playtest closed (single-tester pass, log at [docs/playtest/tutorial-karlp.md](docs/playtest/tutorial-karlp.md)).

**Pending:** Phase 11 manual checkpoint — hit `npm run tauri dev` on a clean profile, play through one generated campaign 30+ minutes, file findings in `docs/playtest/procgen-first-pass.md`.

**Next:** Phase 12 — Packaging.

When a phase completes, update this section to point at the next phase.

## Tech stack

| Layer | Tool |
|---|---|
| Language | TypeScript (strict) |
| Build | Vite |
| Rendering | HTML5 Canvas 2D |
| Audio | Web Audio + Tone.js |
| Desktop | Tauri 2.x |
| Unit tests | Vitest |
| E2E / screenshot diff | Playwright |
| CLI | Node + Zod |
| LLM access (CLI only) | `claude -p` subprocess |
| Package manager | npm |
| UI framework | None (hand-written DOM + reducer) |
| License | MIT |
| Tauri app id | `org.throughline.app` |
| Repository host | GitHub |

## Test commands

```
npm run lint          # eslint + prettier check
npm run test:unit     # vitest run
npm run test:e2e      # playwright test (auto-builds via pretest:e2e hook)
npm test              # unit + e2e
npm run build         # tsc --noEmit + vite build
npm run dev           # local dev server (port 5173)
npm run tauri         # delegates to @tauri-apps/cli (e.g. `npm run tauri dev`)
cargo test --manifest-path src-tauri/Cargo.toml  # Rust-side tests
```

The Playwright web server uses `vite preview` against the built `dist/`, which is why `test:e2e` builds first. CI installs Playwright Chromium with `npx playwright install --with-deps chromium`.

The Rust-side tests (sanitize + no-shell canary) require `rustup` + Tauri 2.x system prerequisites (MSVC build tools, WebView2 on Win10+). They're separate from the Node test suite; CI runs both.

## Load-bearing invariants

Don't violate these without updating [throughline-design.md](throughline-design.md) first.

1. **The game is a pure function of `campaign.json`.** No LLM calls from game code. No platform-specific game logic — only file IO differs between browser and Tauri.
2. **The CLI is the only LLM caller.** If you want to call an LLM from game code, you're doing the wrong thing.
3. **Engine determinism.** Identical `(puzzle, solution)` → identical `CycleTrace`. No `Math.random` / `Date.now` / `Map`-iteration anywhere under `src/engine/`.
4. **Cargo conservation.** Simultaneous-move resolution loses no cargo under any collision pattern. Property-tested, not just prose.
5. **Two-phase cycle resolution.** Phase A declares, Phase B resolves. Don't collapse them.
6. **LLM output is untrusted.** Zod-validated on load; narrative text always rendered via `textContent`, never `innerHTML`; rule DSL is a parsed AST — **no `eval`, no `Function()`, ever**; glyph keys resolve against a fixed library; manifest paths checked for traversal.
7. **Subprocess safety (CLI).** `child_process.spawn(cmd, argv, { shell: false })`. No `exec`, no shell strings.
8. **Subprocess safety (Rust).** `Command::new("node").args(&argv)`. Never `Command::new("sh")`/`"cmd"`/`"-c"`/`"/C"`. Verified by `src-tauri/src/no_shell_test.rs`.
9. **Tauri imports only in `src/platform.ts`.** Other files route Tauri IPC through `tauriHandle()` (dynamic import). Verified by `src/__tests__/no-tauri-static-import.test.ts`.

## Platform notes

- Working directory: `C:\projects\Throughline` on Windows. PowerShell is default; Bash available via the Bash tool.
- Default branch: `main`. CI runs on push to `main` and on all pull requests.
- Node `>=20` (pinned in `package.json#engines`).
