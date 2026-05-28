# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Throughline** — a Zachtronic-style flow-routing puzzle game whose mechanics are fixed but whose themes, narrative, and puzzle layouts are LLM-generated per campaign. Two artifacts: a TypeScript/Canvas game (browser + Tauri desktop) and a Node CLI (`throughline-gen`) that produces `campaign.json` manifests via `claude -p`.

## Required reading, in order

1. [throughline-design.md](throughline-design.md) — vision, architecture, DSL schema, phased build plan. Source of truth for all design decisions.
2. [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) — the executable plan for delivering the design across phases 0–12.

## Current phase

**Phases 0–12 complete.** Origin: https://github.com/karlp80-cloud/Throughline.

Phase 12 packaged the project for v0.1.0 release: Tauri bundle metadata, hand-built sample campaigns as the no-`claude` fallback, README rewrite, per-OS CI matrix, release-on-tag workflow. The wiring is:

- **`src-tauri/tauri.conf.json`** — `productName: "Throughline"`, `bundle.targets: [msi, nsis, dmg, deb, appimage]`, `bundle.category: "Game"`, `licenseFile: "../LICENSE"`, `copyright`, `publisher`, `shortDescription`, `longDescription`. `bundle.resources` extended to ship the samples too: `["../bin/throughline-gen", "../dist-cli/**/*", "../campaigns/samples/**/*.json"]`. `src-tauri/Cargo.toml` package renamed `app → throughline` with proper metadata.
- **`campaigns/samples/`** — 3 hand-built sample campaigns + `solutions.ts`. Themes: Lighthouse Keepers (maritime, 3 puzzles), Switchyard (industrial, 4 puzzles incl. agent + merger), Atrium Garden (botanical, 3 puzzles incl. reactor). All registered in `src/campaign/builtins.ts` so the main menu lists them. `src/campaign/__tests__/samples.test.ts` parameterizes 19 cases: parse + reference-solution victory within `max_cycles`.
- **`vite.config.ts`** — `base: './'` for the Tauri webview (relative `./assets/...` paths), `target: 'esnext'`, `sourcemap: false`. `package.json` adds `build:web`, `build:desktop`, `build:desktop:debug` scripts.
- **`cli/build.mjs`** — now `rmSync(dist-cli)` at the top so stale tsc emit (from a misfired `tsc -p cli/tsconfig.json` without `--noEmit`) doesn't bloat `bundle.resources`. Pre-fix, the MSI carried ~70 stray files from `dist-cli/cli/...` and `dist-cli/src/...`.
- **`.github/workflows/ci.yml`** — matrix on `[ubuntu-latest, windows-latest]`, `fail-fast: false`. Adds explicit `tsc --noEmit` for game + CLI, splits build into web/CLI. Cargo tests stay out of CI (heavyweight system prereqs).
- **`.github/workflows/release.yml`** — triggered on `v*` tags. Per-OS matrix (ubuntu/windows/macos) installs Rust + Tauri prereqs, runs `tauri build`, uploads bundle glob via `softprops/action-gh-release@v2`. Ships UNSIGNED for v0.1.0 (code signing deferred).
- **`README.md`** — replaced phase-0 placeholder. v0.1.0-shaped: install (desktop + browser), sample campaigns, run-from-source (Node-only for browser, Rust + Tauri prereqs for desktop), tests, links into `docs/architecture/`. Screenshots placeholder left as `<!-- TODO -->`.

**Phase 11 carryover validated.** Local `npx tauri build --debug --bundles msi` on Windows produces `Throughline_0.1.0_x64_en-US.msi` (~4.6 MB). MSI extraction confirms `bin/throughline-gen`, `dist-cli/throughline-gen.mjs`, `dist-cli/prompts/system.md`, and all three `campaigns/samples/*.json` ship inside `_up_/`.

**Pending for user (manual actions outside Phase 12 scope):**
1. Capture README screenshots before tagging.
2. Run a clean-install smoke test on a non-dev machine.
3. Run `RUN_LIVE_LLM=1 npm run test:cli:live` once.
4. Tag `v0.1.0` — the release workflow fires on tag-push.

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

**Tally:** 593 unit (+19 from Phase 12 sample-campaign tests) + 21 e2e + 14 cargo tests. Tsc + lint clean. 1 unit test skipped on Windows (symlink test — symlink creation needs admin). Live-LLM integration test gated by `RUN_LIVE_LLM=1`, never runs in CI.

Phase 10 reviewer verdict: **PASS-WITH-NOTES**; full report in [docs/reviews/phase-10.md](docs/reviews/phase-10.md).
Phase 11 reviewer verdict: **PASS-WITH-NOTES**; full report in [docs/reviews/phase-11.md](docs/reviews/phase-11.md). Three low-severity items addressed in wrap-up commit:
- `commands.rs` `read_campaign_file` now creates the app-data dir before canonicalizing (fixes a first-run Windows UNC-prefix edge case).
- `commands.rs` adds 4 new `#[cfg(test)]` tests: 3× argv-construction + 1× timeout_kills_child. Rust suite now 13 tests.
- `no-tauri-static-import.test.ts` regex broadened to also catch side-effect imports (`import '@tauri-apps/...'`).

Phase 9 playtest closed (single-tester pass, log at [docs/playtest/tutorial-karlp.md](docs/playtest/tutorial-karlp.md)).

Phase 11 manual checkpoint closed: pipeline pass at 3×2 = 6 puzzles. Six issues surfaced and were fixed inline during the playtest (timeout layering, Claude-Code parent-session env strip, `WaitOutcome::Timeout` stderr preservation, etc.). Log at [docs/playtest/procgen-first-pass.md](docs/playtest/procgen-first-pass.md). One quality limitation deferred to a post-Phase-12 polish round: the 12-puzzle default doesn't reliably succeed because cumulative work hits the 15-min Rust wall at ~75 s per puzzle.

**Next:** v0.1.0 release. After the manual items above land, push a `v0.1.0` tag and let `release.yml` produce per-OS bundles for the GitHub Release.

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
