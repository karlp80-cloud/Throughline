# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Throughline** — a Zachtronic-style flow-routing puzzle game whose mechanics are fixed but whose themes, narrative, and puzzle layouts are LLM-generated per campaign. Two artifacts: a TypeScript/Canvas game (browser + Tauri desktop) and a Node CLI (`throughline-gen`) that produces `campaign.json` manifests via `claude -p`.

## Required reading, in order

1. [throughline-design.md](throughline-design.md) — vision, architecture, DSL schema, phased build plan. Source of truth for all design decisions.
2. [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) — the executable plan for delivering the design across phases 0–12.

## Current phase

**Phases 0–10 coder-complete; Phase 10 awaiting Reviewer.** Origin: https://github.com/karlp80-cloud/Throughline.

Phase 10 added the companion CLI under `cli/`. Modules:
- `solver/prng.ts` — splitmix64 PRNG + FNV-1a hash (the only place pseudo-randomness lives).
- `writer.ts` — atomic temp+fsync+rename; three-policy path safety (inside-CWD; parent must exist; parent's realpath inside CWD).
- `validator.ts` — wraps `parseCampaign`; strips a single optional Markdown code fence; returns `ValidationResult` (never throws).
- `solver/candidate.ts` + `solver/index.ts` — connectivity-biased random candidates, iterated until victory or budget exhausts. Reuses Phase 1's `runUntilHalt` unchanged.
- `promptBuilder.ts` + `prompts/system.md` — checked-in markdown (~15.5 KB, under the 30 KB argv envelope); all dynamic content in `buildUserPrompt`.
- `claudeSpawn.ts` — security-critical subprocess wrapper: `spawn('claude', argv, { shell: false, ... })`, user prompt via stdin, 4 KB stderr cap, 60 s timeout with SIGTERM → SIGKILL after 2 s grace.
- `generator.ts` — state machine: 3 manifest retries with feedback, then 3 per-puzzle regens. Seeded backoff for reproducible retry timing. Hard ceiling 3 + 3 × max_puzzles LLM calls.
- `index.ts` — CLI entry via `node:util.parseArgs`. Exit codes 0/1/2/3/4/5 per architect §9.3.

Built via `cli/build.mjs` (tsc --noEmit + esbuild bundle) → `dist-cli/throughline-gen.mjs`. Bin wrapper: `bin/throughline-gen`. Static-analysis canaries (`no-shell.test.ts`, `no-eval.test.ts`, `system-prompt-shape.test.ts`, `schema-shape.test.ts`) encode the reviewer checklist as tests.

**Tally:** 511 unit (+135 cli) + 15 e2e. Tsc + lint clean. 1 unit test skipped on Windows (symlink test — symlink creation needs admin). Live-LLM integration test gated by `RUN_LIVE_LLM=1`, never runs in CI.

**Pending:** Phase 9 human-playtester review (carried forward); Phase 10 Reviewer pass — checklist in IMPLEMENTATION_PLAN.md § Phase 10 Reviewer; every item cross-references a test under §10 / §12 of `docs/architecture/cli.md`. A real `claude -p` smoke run (`RUN_LIVE_LLM=1 npx vitest run cli/integration/`) should also happen before merge.

**Next:** Phase 11 — E2E procgen integration (Tauri side spawns `throughline-gen`, surfaces progress, loads the produced manifest into the game).

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
```

The Playwright web server uses `vite preview` against the built `dist/`, which is why `test:e2e` builds first. CI installs Playwright Chromium with `npx playwright install --with-deps chromium`.

## Load-bearing invariants

Don't violate these without updating [throughline-design.md](throughline-design.md) first.

1. **The game is a pure function of `campaign.json`.** No LLM calls from game code. No platform-specific game logic — only file IO differs between browser and Tauri.
2. **The CLI is the only LLM caller.** If you want to call an LLM from game code, you're doing the wrong thing.
3. **Engine determinism.** Identical `(puzzle, solution)` → identical `CycleTrace`. No `Math.random` / `Date.now` / `Map`-iteration anywhere under `src/engine/`.
4. **Cargo conservation.** Simultaneous-move resolution loses no cargo under any collision pattern. Property-tested, not just prose.
5. **Two-phase cycle resolution.** Phase A declares, Phase B resolves. Don't collapse them.
6. **LLM output is untrusted.** Zod-validated on load; narrative text always rendered via `textContent`, never `innerHTML`; rule DSL is a parsed AST — **no `eval`, no `Function()`, ever**; glyph keys resolve against a fixed library; manifest paths checked for traversal.
7. **Subprocess safety (CLI).** `child_process.spawn(cmd, argv, { shell: false })`. No `exec`, no shell strings.

## Platform notes

- Working directory: `C:\projects\Throughline` on Windows. PowerShell is default; Bash available via the Bash tool.
- Default branch: `main`. CI runs on push to `main` and on all pull requests.
- Node `>=20` (pinned in `package.json#engines`).
